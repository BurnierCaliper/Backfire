// 首领机制·死刑（boss-mechanics.js）：标记血量上限最高的单位、倒计时、回合开始落下、每段各自格挡、
// 倒下立刻转标、首领失衡推迟一回合、落下后重新标记 / 只放一次、战场配置指令、联机投影
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

const hp = (u) => u.layers.reduce((a, l) => a + (Number(l.current) || 0), 0);
function field(cfg, party) {
  const c = H.load();
  c.BattleSim.setup({ party: party || ["tou", "kolt", "helu"], enemies: [{ id: "thug_knife", lv: 5, zone: 1 }], seed: "EXEC-T" });
  const S = c.S.state;
  S.units.forEach(u => { u.zone = 1; });
  const boss = S.units.find(u => !u.isPlayer);
  boss.layers.forEach(l => { l.current = l.max = 999; });
  boss.def = boss.defMax = 99;
  c.addBossMechanic(boss, Object.assign({ turns: 2, hits: [{ mult: 1 }, { mult: 1 }] }, cfg || {}));
  c.startCombat();
  return { c, S, boss, unit: (kit) => S.units.find(u => u.kit === kit) };
}
/** 把玩家回合结束，所有格挡都按 answer(job, i) 回答（返回 null = 不格挡，或 [helperId, forced]） */
function endPlayer(c, S, answer) {
  c.endPlayerTurn();
  let i = 0;
  while (S.blockQueue && S.blockQueue.length) {
    const a = answer ? answer(S.blockQueue[0], i++) : null;
    if (a) c.finishBlock(a[0], a[1]); else c.finishBlock(null);
  }
}

test("开战就标记我方血量上限最高的单位，倒计时按回合走", () => {
  const { c, S, unit } = field();
  const max = Math.max(...S.units.filter(u => u.isPlayer).map(c.unitMaxHp));
  const marked = S.units.filter(u => c.executionMarksOn(u).length);
  assert.equal(marked.length, 1);
  assert.equal(c.unitMaxHp(marked[0]), max);
  assert.equal(c.executionMarksOn(marked[0])[0].left, 2);
  endPlayer(c, S); c.endEnemyTurn();
  assert.equal(c.executionMarksOn(marked[0])[0].left, 1);
  void unit;
});

test("到时间在敌人回合开始落下：每一段都是独立的攻击，各自问协助格挡；挡住的那段全免", () => {
  const { c, S, boss } = field();
  const t = S.units.find(u => c.executionMarksOn(u).length);
  endPlayer(c, S); c.endEnemyTurn();        // 第 2 回合
  endPlayer(c, S); c.endEnemyTurn();        // 第 3 回合：这回合敌人回合开始时落下
  const before = hp(t);
  let jobs = 0;
  endPlayer(c, S, (job, i) => {
    jobs++;
    assert.equal(job.attackerId, boss.id);
    assert.equal(job.targetId, t.id);
    assert.equal(job.opt.flags.execution, true);
    if (i === 0) { const h = c.eligibleBlockers(t, job).find(x => !c.isUnarmed(x)); return h ? [h.id, { roll: 1, ok: true }] : null; }
    return null;
  });
  assert.equal(jobs, 2, "两段各排一次格挡");
  const lost = before - hp(t);
  assert.ok(lost > 0, "第二段没挡，挨了伤害");
  const log = S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
  assert.match(log, /【死刑】/);
  // 落下后重新标记（默认 repeat）
  assert.ok(S.units.some(u => c.executionMarksOn(u).length), "重新标记了");
});

test("两段都没人格挡：比只挨一段多", () => {
  const one = field({ hits: [{ mult: 1 }] }), two = field({ hits: [{ mult: 1 }, { mult: 1 }] });
  const lose = ({ c, S }) => {
    const t = S.units.find(u => c.executionMarksOn(u).length); const b = hp(t);
    endPlayer(c, S); c.endEnemyTurn(); endPlayer(c, S); c.endEnemyTurn(); endPlayer(c, S); return b - hp(t);
  };
  assert.ok(lose(two) > lose(one));
});

test("落在我方回合开始：敌人回合结束、下一回合一开始就落下", () => {
  const { c, S } = field({ phase: "player", turns: 1, hits: [{ mult: 1 }] });
  const t = S.units.find(u => c.executionMarksOn(u).length);
  const b = hp(t);
  endPlayer(c, S);
  assert.equal(hp(t), b, "敌人回合开始时不落");
  c.endEnemyTurn();
  while (S.blockQueue && S.blockQueue.length) c.finishBlock(null);
  assert.ok(hp(t) < b, "第 2 回合我方回合开始时落下");
  assert.equal(S.combatPhase, "player");
});

test("被标记的人一倒地就立刻转标，还在等格挡的后几段也跟着转", () => {
  const { c, S, boss } = field({ turns: 1, hits: [{ mult: 1 }, { mult: 1 }] });
  const t = S.units.find(u => c.executionMarksOn(u).length);
  // 直接把他打到濒死
  c.dealTo(boss, t, { atk: 0, mult: 0, flat: 999, element: "physical", baseBreak: 0, flags: { action: false, block: "none", blockResolved: true } });
  assert.ok(t.dying);
  const nt = S.units.find(u => c.executionMarksOn(u).length);
  assert.ok(nt && nt.id !== t.id, "转到别人身上");
  assert.equal(c.executionMarksOn(nt)[0].left, 1, "倒计时不变");
  // 第一段把新目标打倒后，第二段跟着转（第 2 回合敌人回合开始落下）
  endPlayer(c, S); c.endEnemyTurn();
  c.endPlayerTurn();
  assert.equal(S.blockQueue.length ? S.blockQueue[0].targetId : nt.id, nt.id);
  if (S.blockQueue.length) {
    nt.layers.forEach(l => { l.current = 1; });
    c.finishBlock(null);   // 第一段打倒 nt
    if (S.blockQueue.length) assert.notEqual(S.blockQueue[0].targetId, nt.id, "后一段转到还站着的人身上");
    while (S.blockQueue.length) c.finishBlock(null);
  }
});

test("该落下时首领失衡：推迟一回合", () => {
  const { c, S, boss } = field({ turns: 1, hits: [{ mult: 1 }] });
  const t = S.units.find(u => c.executionMarksOn(u).length);
  const b = hp(t);
  endPlayer(c, S); c.endEnemyTurn();       // 第 2 回合
  boss.stunned = true;
  endPlayer(c, S);
  assert.equal(hp(t), b, "失衡：这回合不落");
  assert.match(S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n"), /推迟一回合/);
  c.endEnemyTurn();
  boss.stunned = false;
  endPlayer(c, S);
  assert.ok(hp(t) < b, "下一回合落下");
});

test("只放一次：落下后不再标记；repeat 限次数", () => {
  const once = field({ turns: 1, then: "once", hits: [{ mult: 1 }] });
  endPlayer(once.c, once.S); once.c.endEnemyTurn(); endPlayer(once.c, once.S);
  assert.ok(!once.S.units.some(u => once.c.executionMarksOn(u).length));
  const lim = field({ turns: 1, then: "repeat", times: 2, hits: [{ mult: 1 }] });
  for (let i = 0; i < 6; i++) { endPlayer(lim.c, lim.S); lim.c.endEnemyTurn(); }
  const m = lim.boss.mechanics[0];
  assert.equal(m.st.casts, 2);
  assert.equal(m.st.done, true);
});

test("无视射程、阻隔和躲藏：不在同一区也打得到", () => {
  const { c, S, boss } = field({ turns: 1, hits: [{ mult: 1 }] });
  const t = S.units.find(u => c.executionMarksOn(u).length);
  boss.zone = 2;
  t.statuses = Object.assign({}, t.statuses, { hide: true });
  const b = hp(t);
  endPlayer(c, S); c.endEnemyTurn(); endPlayer(c, S);
  assert.ok(hp(t) < b);
});

test("首领死了：标记消失", () => {
  const { c, S, boss } = field();
  boss.dead = true;
  assert.ok(!S.units.some(u => c.executionMarksOn(u).length));
});

test("战场配置指令：挂上 / 去掉死刑，格式不对被拦下", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["tou", "kolt"], enemies: [{ id: "thug_knife", lv: 5, zone: 1 }], seed: "EXEC-P" });
  c.startCombat();
  const S = c.S.state, boss = S.units.find(u => !u.isPlayer);
  const r = c.Commands.dispatch({ type: "battle.panel", action: "setExecution", actor: boss.id, cfg: { phase: "player", turns: 2, then: "once", hits: [{ mult: 2 }, { mult: 1 }] } });
  assert.match(r.notes.join(), /死刑/);
  assert.equal(boss.mechanics[0].phase, "player");
  assert.equal(boss.mechanics[0].hits.length, 2);
  assert.ok(S.units.some(u => c.executionMarksOn(u).length), "加上就立刻标记");
  assert.throws(() => c.Commands.dispatch({ type: "battle.panel", action: "setExecution", actor: boss.id, cfg: { phase: "x", turns: 2, then: "once", hits: [{ mult: 1 }] } }), /phase/);
  assert.throws(() => c.Commands.dispatch({ type: "battle.panel", action: "setExecution", actor: boss.id, cfg: { phase: "enemy", turns: 0, then: "once", hits: [{ mult: 1 }] } }), /turns/);
  c.Commands.dispatch({ type: "battle.panel", action: "setExecution", actor: boss.id, cfg: null });
  assert.equal(boss.mechanics, undefined);
});

test("自动对打（BattleSim）能把带死刑的战斗打完", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["tou", "kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 1 }], seed: "EXEC-SIM" });
  c.addBossMechanic(c.S.state.units.find(u => !u.isPlayer), { turns: 1, hits: [{ mult: 2 }, { mult: 1 }] });
  const r = c.BattleSim.run({ maxRounds: 20 });
  assert.ok(["player", "enemy", "timeout"].includes(r.winner));
});
