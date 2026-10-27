// 全队集结：施放者晕眩 / 濒死 / 死亡时全体增益结束（主人确认：看施放者）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

const plain = x => JSON.parse(JSON.stringify(x));
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));
const kit = (S, k) => S.units.find(u => u.kit === k);

function field(opt) {
  opt = opt || {};
  const c = H.load();
  // 结人（辅助·全队集结）+ Helumica（改成直伤拿 +15）
  const party = opt.party || ["yuito", "helu"];
  c.BattleSim.setup({ party, enemies: [{ id: "thug_knife", lv: 3, zone: 1 }], seed: opt.seed || "RALLY-END" });
  c.startCombat();
  const S = c.S.state;
  const y = kit(S, "yuito");
  const h = kit(S, party.includes("helu") ? "helu" : party[1]);
  if (y) { y.zone = 1; y.roles = { primary: "辅助", secondary: "辅助" }; y.level = 15; c.resetBattleFlags(y); y.ap = 3; y.bonus = 3; }
  if (h) { h.zone = 1; h.roles = Object.assign({}, h.roles, { primary: opt.heluRole || "直伤" }); }
  return { c, S, y, h };
}

function castRally(c, y) {
  cmd(c, { actor: y.id, skill: "role_rally" });
  assert.ok(y.resources && y.resources.rallyOn, "施放者挂了 rallyOn");
}

test("全队集结：施放者晕眩 → 全体直伤 +15 结束（队员自己没晕）", () => {
  const { c, y, h } = field();
  const before = c.effectiveAtk(h, c.S.state.units);
  castRally(c, y);
  assert.equal(c.effectiveAtk(h, c.S.state.units), before + 15);
  assert.equal(h.rallyAtk, 15);
  // 施放者被打进失衡（真实 dealBreak）
  const notes = [];
  c.dealBreak(y, 99, "physical", notes, "测试");
  assert.equal(!!y.stunned, true);
  assert.equal(!!y.resources.rallyOn, false);
  assert.equal(h.rallyAtk || 0, 0);
  assert.equal(c.effectiveAtk(h, c.S.state.units), before);
  assert.ok(notes.some(s => /全队集结结束：施放者晕眩/.test(s)), notes.join("\n"));
});

test("全队集结：队员自己晕眩 → 加成还在（不是看每个拿到的人）", () => {
  const { c, y, h } = field();
  const before = c.effectiveAtk(h, c.S.state.units);
  castRally(c, y);
  assert.equal(c.effectiveAtk(h, c.S.state.units), before + 15);
  const notes = [];
  c.dealBreak(h, 99, "physical", notes, "测试");
  assert.equal(!!h.stunned, true);
  assert.ok(y.resources.rallyOn, "施放者还在场上，rallyOn 还在");
  assert.equal(h.rallyAtk, 15, "队员自己晕眩不丢集结");
  assert.equal(c.effectiveAtk(h, c.S.state.units), before + 15);
  assert.ok(!notes.some(s => /全队集结结束/.test(s)), notes.join("\n"));
});

test("全队集结：施放者濒死 → 全体加成结束", () => {
  const { c, y, h } = field();
  const before = c.effectiveAtk(h, c.S.state.units);
  castRally(c, y);
  assert.equal(c.effectiveAtk(h, c.S.state.units), before + 15);
  // 打空最内层 → applyKnockdown → dying
  (y.layers || []).forEach(l => { l.current = 0; });
  const notes = [];
  const out = c.applyKnockdown(y, notes);
  assert.equal(out, "dying");
  assert.equal(!!y.dying, true);
  assert.equal(!!y.resources.rallyOn, false);
  assert.equal(h.rallyAtk || 0, 0);
  assert.equal(c.effectiveAtk(h, c.S.state.units), before);
  assert.ok(notes.some(s => /全队集结结束：施放者濒死/.test(s)), notes.join("\n"));
});

test("异常集结：持续期间每回合 +1 附赠；倒下精确扣回不误伤正常附赠", () => {
  // Q1：refreshEconomy 按 rallyBy 份额每回合加；倒下 clearRallyShare 扣 bonusGranted
  const { c, y, h } = field();
  h.roles = Object.assign({}, h.roles, { primary: "异常" });
  castRally(c, y);
  assert.equal(h.rallyBuff, "异常");
  assert.ok(h.rallyBy && h.rallyBy[y.id] && h.rallyBy[y.id].bonusGranted === 1);
  // 施放当回合已 +1；下一玩家回合 refreshEconomy 仍应带集结份额 → 正常 1 + 集结 1 = 2
  c.refreshEconomy(h);
  assert.equal(h.bonus, 2, "集结持续期间每回合都有异常 +1");
  assert.equal(h.rallyBuff, "异常", "标记还在");
  const notes = [];
  c.dealBreak(y, 99, "physical", notes, "测试");
  assert.equal(!!y.stunned, true);
  assert.equal(!!y.resources.rallyOn, false);
  assert.equal(h.rallyBuff, undefined);
  assert.equal(h.bonus, 1, "清集结只扣份额，正常附赠仍在");
  c.refreshEconomy(h);
  assert.equal(h.bonus, 1, "结束后 refreshEconomy 不再加集结附赠");
});

test("牵挂：结人代扛进失衡 → 集结立刻结束", () => {
  const { c, S, y, h } = field();
  const foe = S.units.find(u => !u.isPlayer);
  castRally(c, y);
  c.setBond(y, h);
  assert.equal(y.resources.bondId, h.id);
  y.def = 1;
  foe.zone = 1;
  // 真实 dealTo：击破由结人代扛 → 结人失衡 → 集结立刻结束
  const out = c.dealTo(foe, h, {
    element: "physical", mult: 1, atk: 1, baseBreak: 5, atkRange: "melee",
    flags: { action: true, block: "none", blockResolved: true }
  });
  assert.equal(!!y.stunned, true, "结人因牵挂失衡");
  assert.equal(!!y.resources.rallyOn, false);
  assert.equal(h.rallyAtk || 0, 0);
  assert.ok(out.extra.some(s => /全队集结结束/.test(s)), out.extra.join("\n"));
});

test("闪光震撼弹：施放者被 itemStun → 集结立刻结束", () => {
  const { c, y, h } = field();
  castRally(c, y);
  const notes = [];
  c.itemStun(y, notes);
  assert.equal(!!y.stunned, true);
  assert.equal(!!y.resources.rallyOn, false);
  assert.equal(h.rallyAtk || 0, 0);
  assert.ok(notes.some(s => /全队集结结束：施放者晕眩/.test(s)), notes.join("\n"));
});

test("捏碎颅骨：力竭 3 施放者直接死亡 → 集结结束（beginRound 也能兜住）", () => {
  const { c, y, h } = field();
  castRally(c, y);
  c.S.state.exhaustTier = 3;   // exhaustTierOf 读 state.exhaustTier
  const notes = [];
  c.crushSkullDown(y, notes);
  assert.equal(!!y.dead, true, "力竭 3 捏碎颅骨直接死亡");
  assert.equal(!!y.resources.rallyOn, false);
  assert.equal(h.rallyAtk || 0, 0);
  assert.ok(notes.some(s => /全队集结结束：施放者死亡/.test(s)), notes.join("\n"));
});

test("捏碎颅骨死亡漏钩时：beginRound 对已死施放者仍清掉集结", () => {
  // 模拟「死了但没调 endRallyIfCasterDown」：rallyOn 仍 true，队友还有加成
  const { c, y, h } = field({ seed: "RALLY-DEAD-SWEEP" });
  castRally(c, y);
  const before = c.effectiveAtk(h, c.S.state.units);
  y.dead = true;
  y.dying = false;
  // 故意不调 endRallyIfCasterDown，只靠 beginRound 兜底
  assert.equal(!!y.resources.rallyOn, true);
  assert.equal(h.rallyAtk, 15);
  const notes = [];
  c.beginRound(notes);
  assert.equal(!!y.resources.rallyOn, false);
  assert.equal(h.rallyAtk || 0, 0);
  assert.equal(c.effectiveAtk(h, c.S.state.units), before - 15);
  assert.ok(notes.some(s => /全队集结结束：施放者死亡/.test(s)), notes.join("\n"));
});

test("坦克队员自己失衡：rallyDr 仍生效（engine 与施放者还在）", () => {
  // 在 main 上失败：engine 以前在自己失衡时丢掉 rallyDr
  const { c, y, h } = field({ seed: "RALLY-TANK" });
  h.roles = Object.assign({}, h.roles, { primary: "坦克" });
  castRally(c, y);
  assert.equal(!!h.resources.rallyDr, true);
  // 队员自己失衡
  const notes = [];
  c.dealBreak(h, 99, "physical", notes, "测试");
  assert.equal(!!h.stunned, true);
  assert.ok(y.resources.rallyOn, "施放者还在");
  assert.equal(!!h.resources.rallyDr, true, "自己失衡不丢坦克减伤");
  // 真实 resolveAttack：加算百分比应含 −15%
  const foe = c.S.state.units.find(u => !u.isPlayer);
  const r = c.resolveAttack({
    attacker: foe, target: h, atk: 10, mult: 1, flat: 0, diceValue: 0,
    element: "physical", baseBreak: 0, hits: 1, flags: {},
    weather: "none", phaseStep: 1, zoneMode: 2, targetField: {}, attackerField: {}
  });
  const log = (r.log || []).join("\n");
  assert.match(log, /全队集结（坦克）/, log);
  assert.match(log, /加算百分比合计 -15%/, log);
});

test("载具驾驶员标记没攒满：stunShrugged 时集结不结束", () => {
  const { c, y, h } = field({ seed: "RALLY-VEH" });
  castRally(c, y);
  // 假装结人和载具合并（isBossUnit 对 vehMerged 为 true）
  y.vehMerged = true;
  y.stunMarks = 0;
  y._bossMarked = false;
  assert.equal(!!c.isBossUnit(y), true);
  assert.equal(!!c.stunShrugged(y), true);
  y.stunned = true;
  const notes = [];
  const ended = c.endRallyIfCasterDown(y, notes);
  assert.equal(ended, false);
  assert.equal(!!y.resources.rallyOn, true);
  assert.equal(h.rallyAtk, 15);
  assert.ok(!notes.some(s => /全队集结结束/.test(s)));
});

test("直伤集结结束：召唤武器重算 atk 后再清，不把 atk 扣到基础以下", () => {
  // 旧 clearRallyBuff 做 u.atk − rallyAtk：柯尔特 10→25→召唤扭矩重算成 6→再 −15 = −9
  const c = H.load();
  c.BattleSim.setup({ party: ["yuito", "kolt"], enemies: [{ id: "thug_knife", lv: 3, zone: 1 }], seed: "RALLY-ATK-FLOOR" });
  c.startCombat();
  const S = c.S.state;
  const y = kit(S, "yuito");
  const k = kit(S, "kolt");
  y.zone = 1; k.zone = 1;
  y.roles = { primary: "辅助", secondary: "辅助" }; y.level = 15;
  c.resetBattleFlags(y); y.ap = 3; y.bonus = 3;
  k.roles = Object.assign({}, k.roles, { primary: "直伤" });
  const personal = Number(k.personalAtk) || 0;
  assert.equal(k.atk, personal + (Number(k.weaponAtk) || 0));
  castRally(c, y);
  assert.equal(k.rallyAtk, 15);
  assert.equal(k.atk, personal + (Number(k.weaponAtk) || 0) + 15);
  // 召唤扭矩：owner.atk = personalAtk，集结的 +15 从字段里消失，但 rallyAtk 还在
  cmd(c, { actor: k.id, skill: "kolt_summon" });
  assert.equal(k.atk, personal, "召唤后 atk 被重算成 personalAtk");
  assert.equal(k.rallyAtk, 15);
  const notes = [];
  c.dealBreak(y, 99, "physical", notes, "测试");
  assert.equal(!!y.resources.rallyOn, false);
  assert.equal(k.rallyAtk || 0, 0);
  assert.ok(k.atk >= personal, `atk 不应低于 personalAtk（实际 ${k.atk}）`);
  assert.equal(k.atk, personal);
  assert.equal(c.effectiveAtk(k, S.units), personal);
  // 再清一次应幂等
  c.clearRallyBuff(k, []);
  assert.equal(k.atk, personal);
});

test("异常集结：每回合 refreshEconomy 都加 +1（多回合）", () => {
  const { c, y, h } = field();
  h.roles = Object.assign({}, h.roles, { primary: "异常" });
  castRally(c, y);
  c.refreshEconomy(h);
  assert.equal(h.bonus, 2);
  c.refreshEconomy(h);
  assert.equal(h.bonus, 2, "第二回合仍是 1+1");
  c.refreshEconomy(h);
  assert.equal(h.bonus, 2, "第三回合仍是 1+1");
});

test("两人全队集结叠加：直伤 +30；一人倒下留 +15；两人都倒下清零", () => {
  const c = H.load();
  c.BattleSim.setup({
    party: ["yuito", "nora", "helu"],
    enemies: [{ id: "thug_knife", lv: 3, zone: 1 }],
    seed: "RALLY-STACK"
  });
  c.startCombat();
  const S = c.S.state;
  const y = kit(S, "yuito");
  const m = kit(S, "nora");
  const h = kit(S, "helu");
  for (const u of [y, m, h]) u.zone = 1;
  y.roles = { primary: "辅助", secondary: "辅助" }; y.level = 15;
  m.roles = { primary: "辅助", secondary: "辅助" }; m.level = 15;
  h.roles = Object.assign({}, h.roles, { primary: "直伤" });
  c.resetBattleFlags(y); y.ap = 3; y.bonus = 3;
  c.resetBattleFlags(m); m.ap = 3; m.bonus = 3;
  const baseAtk = Number(h.atk) || 0;
  const beforeEff = c.effectiveAtk(h, S.units);

  castRally(c, y);
  assert.equal(h.rallyAtk, 15);
  assert.equal(h.atk, baseAtk + 15);
  assert.ok(h.rallyBy && h.rallyBy[y.id] && h.rallyBy[y.id].atkGranted === 15);

  castRally(c, m);
  assert.equal(h.rallyAtk, 30, "两人各 +15 叠加");
  assert.equal(h.atk, baseAtk + 30);
  assert.equal(c.effectiveAtk(h, S.units), beforeEff + 30);
  assert.ok(h.rallyBy[y.id] && h.rallyBy[m.id]);

  // 结人倒下：只清结人那份
  const notes = [];
  c.dealBreak(y, 99, "physical", notes, "测试");
  assert.equal(!!y.resources.rallyOn, false);
  assert.equal(!!m.resources.rallyOn, true, "诺拉的 rallyOn 还在");
  assert.equal(h.rallyAtk, 15, "留下诺拉的 +15");
  assert.equal(h.atk, baseAtk + 15);
  assert.ok(!h.rallyBy[y.id] && h.rallyBy[m.id]);
  assert.equal(c.effectiveAtk(h, S.units), beforeEff + 15);

  // 薄荷也倒下：全清
  c.dealBreak(m, 99, "physical", notes, "测试");
  assert.equal(!!m.resources.rallyOn, false);
  assert.equal(h.rallyAtk || 0, 0);
  assert.equal(h.rallyBuff, undefined);
  assert.equal(h.atk, baseAtk);
  assert.equal(c.effectiveAtk(h, S.units), beforeEff);
});

test("两人全队集结·异常：一人倒下留下另一人的 +1 附赠", () => {
  const c = H.load();
  c.BattleSim.setup({
    party: ["yuito", "nora", "helu"],
    enemies: [{ id: "thug_knife", lv: 3, zone: 1 }],
    seed: "RALLY-STACK-BONUS"
  });
  c.startCombat();
  const S = c.S.state;
  const y = kit(S, "yuito");
  const m = kit(S, "nora");
  const h = kit(S, "helu");
  for (const u of [y, m, h]) u.zone = 1;
  y.roles = { primary: "辅助", secondary: "辅助" }; y.level = 15;
  m.roles = { primary: "辅助", secondary: "辅助" }; m.level = 15;
  h.roles = Object.assign({}, h.roles, { primary: "异常" });
  c.resetBattleFlags(y); y.ap = 3; y.bonus = 3;
  c.resetBattleFlags(m); m.ap = 3; m.bonus = 3;

  castRally(c, y);
  castRally(c, m);
  c.refreshEconomy(h);
  assert.equal(h.bonus, 3, "正常1 + 两份额各+1");
  assert.equal(Object.keys(h.rallyBy || {}).length, 2);

  c.dealBreak(y, 99, "physical", [], "测试");
  assert.equal(h.bonus, 2, "扣回结人份额后剩 正常1+诺拉1");
  assert.ok(h.rallyBy && h.rallyBy[m.id] && !h.rallyBy[y.id]);
  c.refreshEconomy(h);
  assert.equal(h.bonus, 2, "诺拉还在时每回合仍 +1");

  c.dealBreak(m, 99, "physical", [], "测试");
  assert.equal(h.bonus, 1);
  assert.equal(h.rallyBuff, undefined);
  c.refreshEconomy(h);
  assert.equal(h.bonus, 1);
});

test("直伤集结结束：atk 托底不用 effectiveAtk（不把 bond/duet 写进 u.atk）", () => {
  const { c, S, y, h } = field();
  h.roles = Object.assign({}, h.roles, { primary: "直伤" });
  const personal = Number(h.personalAtk) || 0;
  const weapon = Number(h.weaponAtk) || 0;
  const base = personal + weapon;
  h.bondAtk = 10;
  h.duetAtk = 7;
  castRally(c, y);
  assert.equal(h.rallyAtk, 15);
  assert.equal(h.atk, base + 15, "u.atk 只含基础+集结，不含 bond/duet");
  assert.equal(c.effectiveAtk(h, S.units), c.baseEffectiveAtk(h, S.units) + 10 + 7 + 15);
  c.dealBreak(y, 99, "physical", [], "测试");
  assert.equal(h.rallyAtk || 0, 0);
  assert.equal(h.atk, base, "清掉后 u.atk 回到基础，bond/duet 仍只在 effectiveAtk");
  assert.ok(!h.bondAtk || h.bondAtk === 10);
});
