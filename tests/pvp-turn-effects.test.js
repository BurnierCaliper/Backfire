// PvP：每回合 / 下回合 / 本回合的效果、即时效果、护盾回满跟着各队自己的回合（#476，作者 10/29，docs/pvp.md 第 2.1 节）。
// 在敌人回合行动的玩家阵营（下面都叫「乙」）自己的回合是敌人回合：
//   A 每回合开始 / 下回合开始的效果在乙自己的回合开始（敌人回合开始）结算，整轮开始（beginRound）不结算；
//   B 乙放的「本回合」效果撑过对手（我方）的下一个回合，到乙下一个回合开始之前才失效；
//   C 乙施加的即时效果同样撑到乙下一个回合开始之前（黄金时间照样再多一回合）；
//   D 乙的护盾层在乙自己的回合开始时判「从上一个回合开始到现在没挨打」就回满。
// 我方回合行动的人、非玩家单位的 A、B、D 照旧；普通 PvE（没有在敌人回合行动的玩家阵营）A、B、D 一切照旧。
// C 普通 PvE 也改（作者 10/29 追加）：敌人（非玩家单位，在敌人回合行动）施加的即时效果撑过下一个我方回合，到下一个敌人回合开始之前才失效。
// #482 起 C 看施加时是谁的回合、不看是谁施加的（这里的都是在自己的回合里施加的）；在对手的回合里施加的见 tests/opponent-turn-instant.test.js。
// 规则在 app.js · lateTurn / instantLateNow / ownRound / markTurnFx / lateRoundEnd / lateRoundStart（startEnemyPhase 调），beginRound / turnEnd 跳过乙
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");
const plain = v => JSON.parse(JSON.stringify(v));
const run = (c, expr) => vm.runInContext(expr, c);

const faction = (c, cmd) => c.Commands.dispatch(Object.assign({ type: "battle.playerFaction" }, cmd));
const skill = (c, a, id, t, picks) => c.Commands.dispatch({ type: "skill", actor: a.id, skill: id, target: t ? t.id : null, picks: picks || {} });
const logText = c => c.S.state.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
/** 从现在起新写的日志（fn 执行期间） */
const logOf = (c, fn) => { const before = logText(c).length; fn(); return logText(c).slice(before); };
/** 我方回合结束 → 敌人回合开始（乙自己的回合开始） */
const toEnemy = c => c.endPlayerTurn();
/** 敌人回合结束 → 整轮结束 → 下一回合的整轮开始、我方回合开始 */
const toPlayer = c => c.endEnemyTurn();
/** 一下打在 t 身上的攻击（不排格挡队列） */
const hit = (c, a, t, n) => c.dealTo(a, t, { atk: n || 4, mult: 1, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });
/** 敌人 a 对 t 用自己的招式 id（我方不格挡，和 tests/riot-force.test.js 一样） */
const enemyUse = (c, a, id, t) => {
  const S = c.S.state;
  a.ap = Math.max(1, a.ap || 0); S.attackerId = a.id; S.targetId = t ? t.id : null;
  c.runSkill(id);
  c.BattleSim.resolveQueues({ pickBlocker: () => null, pickAssister: l => l[0].id });
};

/** 布置战场：party 全在 1 区（三区直排），加一个血厚、架势高的狂徒（打不死也打不进失衡）。
 *  late：分到「乙」（在敌人回合行动）的角色（武器人跟着持有者）；null = 不配置阵营（普通 PvE）。
 *  lv：角色等级（解锁技能）；wlv：武器等级（被动升级，5 级 1+、10 级 2+） */
function field(opt) {
  const party = opt.party;
  const c = H.load();
  c.BattleSim.setup({ party, enemies: opt.enemies || [{ id: "thug_knife", lv: 1, zone: 1 }], zoneMode: 3, seed: opt.seed || "PVP476" });
  const S = c.S.state;
  const heroes = party.map(k => c.findKit(k, S.units));
  heroes.forEach(h => { h.level = opt.lv || 15; });
  if (opt.wlv) heroes.forEach(h => (h.linkedKits || []).forEach(k => { h.weaponLevels[k] = opt.wlv; }));
  const foes = S.units.filter(u => !u.isPlayer);
  [...heroes, ...foes].forEach(u => { u.zone = 1; });
  foes.forEach(f => { f.layers = [{ type: "flesh", current: 500, max: 500 }]; f.def = f.defMax = 30; });
  if (opt.late) opt.late.forEach(k => faction(c, { faction: "乙", phase: "enemy", unit: c.findKit(k, S.units).id }));
  c.startCombat();
  return { c, S, foe: foes[0], k: kit => c.findKit(kit, S.units) };
}
/** 换职责、等级，并按新等级重置本场的次数（和 tests/audit-P2-roles.test.js 一样） */
function asRole(c, u, role, lv) {
  u.roles = { primary: role, secondary: role };
  u.level = lv;
  c.resetBattleFlags(u);
}

test("普通 PvE 的 A、B、D 一切照旧：没有在敌人回合行动的阵营时 lateTurn 永远是 false、ownRound 就是回合数、我方施加的什么都不记；同一种子整场自动对打（受影响的角色都在，这几场的敌人不施加即时效果），不配置 / 全在「我方」/ 多一个没人的敌人回合阵营 / 两个阵营都在我方回合，结果和整场记录一模一样", () => {
  const { c, S, k } = field({ party: ["tou", "nora", "xia", "chuan"], late: null });
  assert.equal(c.lateTurn(k("tou")), false);
  assert.equal(c.ownRound(k("tou")), S.turnNo);
  assert.equal(c.instantLateNow(), false, "我方回合里施加的即时效果不记");
  toEnemy(c);
  assert.equal(c.instantLateNow(), true, "敌人回合里施加的即时效果记（#482：不看是谁施加的）");
  assert.equal(c.ownRound(k("tou")), S.turnNo, "敌人回合里也是回合数");
  assert.ok(S.units.every(u => !u.lateFx), "什么都不记");
  const parties = [["tou", "nora", "xia", "chuan"], ["ruby", "yuito", "hiaki", "kolt"], ["longge", "helu", "tou", "ras"]];
  for (const party of parties) {
    const sim = mode => {
      const c2 = H.load();
      c2.BattleSim.setup({ party, enemies: [{ id: "thug_knife", lv: 8, zone: 2 }, { id: "thug_hammer", lv: 8, zone: 2 }, { id: "guard_gun", lv: 8, zone: 1 }], seed: "PVP476-PVE-" + party[0] });
      c2.S.state.units.filter(u => u.isPlayer).forEach(u => { u.level = 15; (u.linkedKits || []).forEach(kk => { u.weaponLevels[kk] = 10; }); });
      if (mode === "all") faction(c2, { faction: "我方" });
      if (mode === "empty") faction(c2, { faction: "乙", phase: "enemy" });
      // 两个阵营都在我方回合行动（互相友好）：按阵营判胜负那些照 #445 会变，这里只看没有人「在敌人回合行动」
      if (mode === "both") { const h = c2.findKit(party[1], c2.S.state.units); faction(c2, { faction: "乙", phase: "player", unit: h.id }); faction(c2, { faction: "乙", other: "我方", hostile: false }); }
      const late = [];
      const plan = c2.EnemyAI.plan;
      c2.EnemyAI.plan = u => { c2.S.state.units.forEach(x => { if (c2.lateTurn(x)) late.push(x.id); }); return plan(u); };
      const r = c2.BattleSim.run({ maxRounds: 25 });
      return { r: plain(r), log: logText(c2), marks: c2.S.state.units.some(u => u.lateFx), late: late.length };
    };
    const off = sim(null);
    assert.notEqual(off.r.winner, "timeout", party.join("+") + "：分出了胜负");
    for (const mode of ["all", "empty", "both"]) {
      const o = sim(mode);
      if (mode !== "both") {
        assert.deepEqual(o.r, off.r, party.join("+") + "：" + mode + " 结果一样");
        assert.equal(o.log, off.log, party.join("+") + "：" + mode + " 整场记录一样");
      }
      assert.equal(o.marks, false, party.join("+") + "：" + mode + " 没有记任何「撑到下一个敌人回合开始」");
      assert.equal(o.late, 0, party.join("+") + "：" + mode + " 没有人算在敌人回合行动");
    }
  }
});

test("A：托乌「圣盾荣耀」+1、蓄能（川川「高能脉冲」）+等级、诺拉「压力升高」——乙的在自己的回合开始（敌人回合开始）结算，整轮开始不结算；我方的照旧在整轮开始", () => {
  const read = (f) => ({ shield: Number(f.k("tou").resources.shield) || 0, he: Number(f.k("chuan").highEnergy) || 0, mood: f.k("nora").resources.mood });
  const prime = f => {
    const ch = f.k("chuan"), n = f.k("nora");
    ch.self = "store"; ch.highEnergy = 0; ch.layers = [{ type: "flesh", current: 999, max: 999 }];
    n.resources.mood = "gentle"; n.resources.forceCruelNext = true;
  };
  // 乙：托乌、诺拉、川川在敌人回合行动
  const p = field({ party: ["tou", "nora", "chuan", "kolt"], late: ["tou", "nora", "chuan"] });
  const lv = Number(p.k("chuan").level) || 1;
  prime(p);
  const s0 = read(p);
  assert.equal(s0.shield, 0, "开战的整轮开始：乙的托乌不加圣盾（还没轮到它）");
  toEnemy(p.c);
  const s1 = read(p);
  assert.equal(s1.shield, 1, "乙自己的回合开始：圣盾 +1");
  assert.equal(s1.he, lv, "蓄能 +等级");
  assert.equal(s1.mood, "cruel", "压力升高：自己的回合开始必定残忍");
  assert.equal(p.k("nora").resources.forceCruelNext, false);
  toPlayer(p.c);
  assert.deepEqual(read(p), s1, "整轮开始（我方回合之前）：乙的这些效果都不结算");
  toEnemy(p.c);
  assert.equal(read(p).shield, 2, "下一个敌人回合开始：再 +1");
  assert.equal(read(p).he, 2 * lv);
  // 对照：都在我方（普通 PvE）——整轮开始结算，敌人回合开始不结算
  const q = field({ party: ["tou", "nora", "chuan", "kolt"], late: null });
  prime(q);
  const t0 = read(q);
  assert.equal(t0.shield, 1, "开战的整轮开始就 +1");
  toEnemy(q.c);
  assert.deepEqual(read(q), t0, "敌人回合开始不结算");
  toPlayer(q.c);
  assert.equal(read(q).shield, 2);
  assert.equal(read(q).he, lv);
  assert.equal(read(q).mood, "cruel", "压力升高在整轮开始");
});

test("A：夕夏引擎「一回合没攻击就熄火」——乙的从自己上一个回合开始算：自己的回合里启动过 / 攻击过，撑过对手的回合，自己下一个回合开始才判", () => {
  const f = field({ party: ["xia", "kolt"], late: ["xia"] });
  const xia = f.k("xia");
  toEnemy(f.c);   // 第 1 个敌人回合：夕夏启动引擎
  xia.resources.engine = true; xia.resources.engineJustOn = true; xia.resources.attackedThisTurn = false;
  toPlayer(f.c);
  assert.equal(xia.resources.engine, true, "整轮开始不判");
  assert.equal(xia.resources.engineJustOn, true, "「刚启动」留到自己的回合开始");
  toEnemy(f.c);   // 第 2 个敌人回合开始：刚启动，不熄火
  assert.equal(xia.resources.engine, true);
  assert.equal(xia.resources.engineJustOn, false);
  // 第 2 个敌人回合里没有攻击
  toPlayer(f.c);
  assert.equal(xia.resources.engine, true, "整轮开始还是不判（以前在这里就熄火了）");
  const log = logOf(f.c, () => toEnemy(f.c));
  assert.equal(xia.resources.engine, false, "自己的回合开始：从上一个回合开始到现在没攻击，熄火");
  assert.match(log, /夕夏一回合未攻击，引擎关闭/);
  // 攻击过就不熄火
  xia.resources.engine = true; xia.resources.attackedThisTurn = true;
  toPlayer(f.c); toEnemy(f.c);
  assert.equal(xia.resources.engine, true, "攻击过：不熄火");
});

test("A：专长的 roundStart 钩子——乙的在自己的回合开始调，我方的在整轮开始调", () => {
  const f = field({ party: ["kolt", "helu"], late: ["kolt"] });
  const calls = [];
  run(f.c, "FEATS").test476 = { name: "测试", kind: "passive", tier: 1, text: "测试", hooks: { roundStart(u) { calls.push([u.kit, f.S.combatPhase, f.S.turnNo]); } } };
  f.k("kolt").feats = ["test476"]; f.k("helu").feats = ["test476"];
  toEnemy(f.c); toPlayer(f.c); toEnemy(f.c);
  assert.deepEqual(calls, [["kolt", "enemy", 1], ["helu", "enemy", 2], ["kolt", "enemy", 2]],
    "柯尔特（乙）在敌人回合开始；赫鲁米卡（我方）在第 2 回合的整轮开始（这时还没进我方回合）");
});

test("B：咬牙坚持——乙在自己的回合放的撑过我方的下一个回合（受伤照样减半），到乙下一个回合开始之前才结束；我方放的照旧在整轮结束", () => {
  const f = field({ party: ["kolt", "helu"], late: ["kolt"] });
  const kolt = f.k("kolt"), helu = f.k("helu");
  asRole(f.c, kolt, "坦克", 10);
  toEnemy(f.c);
  skill(f.c, kolt, "role_grit");
  assert.equal(kolt.resources.gritTurn, true);
  toPlayer(f.c);
  assert.equal(kolt.resources.gritTurn, true, "整轮结束：乙放的还在（以前在这里就结束了，对手的回合挡不到）");
  // 我方回合：赫鲁米卡打柯尔特，减半照样生效
  const out = hit(f.c, helu, kolt, 10);
  assert.ok(out && out.res, "打到了");
  assert.equal(kolt.resources.gritTurn, true);
  const log = logOf(f.c, () => toEnemy(f.c));
  assert.equal(kolt.resources.gritTurn, false, "乙下一个回合开始之前结束");
  assert.match(log, /柯尔特 咬牙坚持结束/);
  // 对照：普通 PvE（柯尔特在我方回合放）
  const g = field({ party: ["kolt", "helu"], late: null });
  const k2 = g.k("kolt");
  asRole(g.c, k2, "坦克", 10);
  k2.ap = 3; k2.bonus = 3;
  skill(g.c, k2, "role_grit");
  assert.equal(k2.resources.gritTurn, true);
  toEnemy(g.c);
  assert.equal(k2.resources.gritTurn, true, "敌人回合里还在");
  toPlayer(g.c);
  assert.equal(k2.resources.gritTurn, false, "整轮结束：结束（照旧）");
});

test("B：禁足怒吼（对敌人用的）——乙放的禁足和「只能攻击施放者」撑过对手的回合，到乙下一个回合开始才解开", () => {
  const f = field({ party: ["kolt", "helu"], late: ["kolt"] });
  const kolt = f.k("kolt"), helu = f.k("helu");
  asRole(f.c, kolt, "坦克", 5);
  toEnemy(f.c);
  skill(f.c, kolt, "role_lockdown");
  assert.equal(helu.noMove, true, "对面阵营的赫鲁米卡被禁足");
  assert.equal(helu.lockdownBy, kolt.id);
  assert.equal(f.foe.noMove, true, "狂徒也被禁足");
  toPlayer(f.c);
  assert.equal(helu.noMove, true, "整轮结束：还在——赫鲁米卡自己的回合（我方回合）也不能移动");
  assert.equal(helu.lockdownBy, kolt.id);
  assert.equal(f.foe.noMove, true);
  toEnemy(f.c);
  assert.equal(helu.noMove, false, "乙下一个回合开始之前解开");
  assert.equal(helu.lockdownBy, null);
  assert.equal(f.foe.noMove, false);
  assert.ok(!helu.lateFx && !f.foe.lateFx, "记号也清掉");
});

test("B：击破预告——乙放的判定窗口撑过对手的回合，到乙下一个回合开始之前才判（没打进失衡 → 施放者失衡，这一回合没有行动点）", () => {
  const f = field({ party: ["hiaki", "helu"], late: ["hiaki"] });
  const hk = f.k("hiaki");
  asRole(f.c, hk, "击破", 15);
  toEnemy(f.c);
  skill(f.c, hk, "role_omen", f.foe);
  assert.equal(f.foe.instant.omenArmed, true);
  const end = logOf(f.c, () => toPlayer(f.c));
  assert.doesNotMatch(end, /击破预告失败/, "整轮结束不判（以前在这里判，对手的回合打不到双倍击破）");
  assert.equal(hk.stunned, false);
  assert.equal(f.foe.instant.doubleBreak, true, "我方回合里目标照样受到双倍击破");
  const start = logOf(f.c, () => toEnemy(f.c));
  assert.match(start, /击破预告失败：绯秋 架势被击破/, "乙下一个回合开始之前判：失败");
  assert.equal(f.foe.instant.omenArmed, false);
  assert.equal(hk.ap, 0, "失衡：这一回合不获得行动点");
});

test("B：瑞比「收发代理」无人机——乙的瑞比在她自己的回合结束（敌人回合结束、整轮结束之前）提取纳米，每回合一次；我方的照旧在整轮结束", () => {
  const order = late => {
    const f = field({ party: ["ruby", "helu"], late: late ? ["ruby"] : null });
    const ruby = f.k("ruby");
    ruby.resources.drone = true; ruby.resources.mecha = false;
    toEnemy(f.c);
    const n0 = Number(ruby.resources.nano) || 0;
    const log = logOf(f.c, () => toPlayer(f.c));
    assert.equal(ruby.resources.nano, n0 + 10, "一回合只提取一次");
    return { drone: log.indexOf("收发代理：无人机提取纳米"), end: log.indexOf("—— 回合结束 ——") };
  };
  const p = order(true);
  assert.ok(p.drone >= 0 && p.end >= 0 && p.drone < p.end, "乙：敌人回合结束（她自己的回合结束）时，在整轮结束之前");
  const q = order(false);
  assert.ok(q.drone > q.end, "普通 PvE：照旧在整轮结束里");
});

test("B：川川「铁壁」——乙展开的撑过对手的回合（一回合内挡），到乙下一个回合开始之前撤掉、积攒电能", () => {
  const f = field({ party: ["chuan", "helu"], late: ["chuan"] });
  const ch = f.k("chuan");
  toEnemy(f.c);
  ch.resources.charge = 2;
  skill(f.c, ch, "chuan_wall");
  const wall = () => (f.S.props || []).find(p => p.kind === "ironwall");
  assert.ok(wall(), "铁壁展开");
  toPlayer(f.c);
  assert.ok(wall(), "整轮结束：还在（我方回合照样挡）");
  const c0 = ch.resources.charge;
  const log = logOf(f.c, () => toEnemy(f.c));
  assert.ok(!wall(), "乙下一个回合开始之前撤掉");
  assert.ok(ch.resources.charge > c0, "撑过了：积攒电能");
  assert.match(log, /铁壁撑过回合，川川电能/);
});

test("B：结人「思念+」——被牵挂的队友在乙：按它自己的一回合（上一个敌人回合开始到这一个）判有没有受伤，在敌人回合开始结算", () => {
  const f = field({ party: ["yuito", "kolt", "helu"], late: ["yuito", "kolt"], wlv: 10 });
  const y = f.k("yuito"), kolt = f.k("kolt"), helu = f.k("helu");
  y.resources.bondId = kolt.id;
  toEnemy(f.c);
  assert.equal(Number(kolt.bondAtk) || 0, 0, "第一个敌人回合开始：它自己还没过一整回合");
  toPlayer(f.c);
  assert.equal(Number(kolt.bondAtk) || 0, 0, "整轮结束不判");
  toEnemy(f.c);
  assert.equal(kolt.bondAtk, 10, "自己这一回合没受伤：+10");
  // 对手（我方）的回合里受了伤
  toPlayer(f.c);
  hit(f.c, helu, kolt, 6);
  assert.equal(kolt._hurtRound, f.c.ownRound(kolt), "受伤记在它自己的一回合上");
  toEnemy(f.c);
  assert.equal(kolt.bondAtk, 10, "这一回合受过伤：不加");
});

test("B：绯秋「剑术+」——乙的绯秋自己这一回合切换刀势得到、没用掉的附赠，到她下一个回合开始才留到下回合（整轮结束不算）", () => {
  const f = field({ party: ["hiaki", "helu"], late: ["hiaki"], wlv: 10 });
  const h = f.k("hiaki");
  toEnemy(f.c);
  const b0 = h.bonus;
  f.c.setHiakiStance(h, h.resources.stance === "iai" ? "draw" : "iai");
  assert.equal(h.bonus, b0 + 1, "切换刀势 +1 附赠");
  toPlayer(f.c);
  assert.ok(!h.resources.stanceCarry, "整轮结束不算（她的附赠在我方回合里还能用来协助格挡）");
  assert.ok(h.resources.stanceGrant, "这一回合的记录还在");
  const log = logOf(f.c, () => toEnemy(f.c));
  assert.ok(log.includes(`剑术+：${h.name} 还有 1 个切换刀势得到的附赠动作，留到下回合`), log);
  assert.equal(h.bonus, b0 + 1, "自己的下一个回合：附赠 +1");
});

test("C：即时效果（算法改变的扩散）——乙施加的撑过对手的回合（算法改变的纳米也是），到乙下一个回合开始之前才失效；我方施加的照旧在整轮开始失效", () => {
  const f = field({ party: ["ruby", "helu"], late: ["ruby"] });
  const ruby = f.k("ruby"), helu = f.k("helu");
  toEnemy(f.c);
  skill(f.c, ruby, "ruby_algo", helu);
  assert.equal(helu.instant.spread, true);
  toPlayer(f.c);
  assert.equal(helu.instant.spread, true, "整轮开始：乙施加的还在（以前在这里就失效了）");
  const n0 = Number(ruby.resources.nano) || 0;
  hit(f.c, f.foe, helu, 4);
  assert.equal(ruby.resources.nano, n0 + 5, "我方回合里赫鲁米卡受伤：瑞比照样 +5 纳米");
  const log = logOf(f.c, () => toEnemy(f.c));
  assert.equal(helu.instant.spread, false, "乙下一个回合开始之前失效");
  assert.ok(log.includes(`${helu.name} 扩散结束`), log);
  const n1 = Number(ruby.resources.nano) || 0;
  hit(f.c, f.foe, helu, 4);
  assert.equal(ruby.resources.nano, n1, "算法改变也过了");
  // 我方（在我方回合行动）施加的：照旧在整轮开始失效
  const g = field({ party: ["ruby", "helu"], late: ["helu"] });
  g.k("ruby").ap = 3;
  skill(g.c, g.k("ruby"), "ruby_algo", g.k("helu"));
  assert.equal(g.k("helu").instant.spread, true);
  toEnemy(g.c);
  assert.equal(g.k("helu").instant.spread, true, "敌人回合（乙的回合）里还在");
  toPlayer(g.c);
  assert.equal(g.k("helu").instant.spread, false, "整轮开始失效（照旧）");
});

test("C：黄金时间——乙施加的即时效果在「撑到乙下一个回合开始」的基础上再多保留一回合", () => {
  const f = field({ party: ["nora", "helu"], late: ["nora"] });
  const nora = f.k("nora"), helu = f.k("helu");
  toEnemy(f.c);
  f.c.applyInstantEffect(helu, "sting", [], nora);
  helu.instant.goldHold = "sting";
  toPlayer(f.c);
  assert.equal(helu.instant.sting, true);
  assert.equal(helu.instant.goldHold, "sting", "整轮开始不用掉黄金时间");
  const log = logOf(f.c, () => toEnemy(f.c));
  assert.equal(helu.instant.sting, true, "乙下一个回合开始：黄金时间再保留一回合");
  assert.match(log, /黄金时间：刺骨再保留一回合/);
  assert.ok(!helu.instant.goldHold, "只延长一回合");
  toPlayer(f.c);
  assert.equal(helu.instant.sting, true);
  toEnemy(f.c);
  assert.equal(helu.instant.sting, false, "再下一个乙的回合开始：失效");
});

test("C（PvE 也改）：敌人在敌人回合打在我方身上的熔融（镇压队警棍盾「火焰警棍」）撑过下一个我方回合，到下一个敌人回合开始之前才失效；我方施加的照旧在整轮开始失效", () => {
  const f = field({ party: ["kolt", "helu"], late: null, enemies: [{ id: "riot_baton", lv: 5, zone: 1 }] });
  const kolt = f.k("kolt"), b = f.foe;
  assert.equal(b.kit, "riot_baton");
  toEnemy(f.c);
  assert.equal(f.c.instantLateNow(), true, "敌人回合");
  enemyUse(f.c, b, "en_riot_baton", kolt);
  assert.equal(kolt.instant.melt, true, "打中施加熔融");
  const end = logOf(f.c, () => toPlayer(f.c));
  assert.equal(kolt.instant.melt, true, "整轮开始：敌人施加的还在（以前在这里就失效了，只经过了敌人回合）");
  assert.ok(!end.includes(`${kolt.name} 熔融结束`), end);
  const log = logOf(f.c, () => toEnemy(f.c));
  assert.equal(kolt.instant.melt, false, "下一个敌人回合（施加时的那一方的回合）开始之前失效");
  assert.ok(log.includes(`${kolt.name} 熔融结束`), log);
  assert.ok(!kolt.lateFx, "记号也清掉");
  // 我方（在我方回合行动）施加的：照旧在整轮开始失效
  const g = field({ party: ["kolt", "helu"], late: null, enemies: [{ id: "riot_baton", lv: 5, zone: 1 }] });
  g.c.applyInstantEffect(g.foe, "melt", [], g.k("helu"));
  assert.equal(g.foe.instant.melt, true);
  assert.ok(!g.foe.lateFx, "我方施加的不记");
  toEnemy(g.c);
  assert.equal(g.foe.instant.melt, true, "敌人回合里还在");
  toPlayer(g.c);
  assert.equal(g.foe.instant.melt, false, "整轮开始失效（照旧）");
});

test("C（PvE）：敌人施加的刺骨 + 黄金时间——在「撑到下一个敌人回合开始」的基础上再多保留一回合", () => {
  const f = field({ party: ["kolt", "helu"], late: null });
  const kolt = f.k("kolt");
  kolt.layers = [{ type: "flesh", current: 300, max: 300, inner: true }];
  toEnemy(f.c);
  f.c.applyInstantEffect(kolt, "sting", [], f.foe);
  kolt.instant.goldHold = "sting";
  toPlayer(f.c);
  assert.equal(kolt.instant.sting, true, "整轮开始：还在");
  assert.equal(kolt.instant.goldHold, "sting", "整轮开始不用掉黄金时间");
  const log = logOf(f.c, () => toEnemy(f.c));
  assert.equal(kolt.instant.sting, true, "下一个敌人回合开始：黄金时间再保留一回合");
  assert.match(log, /黄金时间：刺骨再保留一回合/);
  assert.ok(!kolt.instant.goldHold, "只延长一回合");
  toPlayer(f.c);
  assert.equal(kolt.instant.sting, true);
  toEnemy(f.c);
  assert.equal(kolt.instant.sting, false, "再下一个敌人回合开始：失效");
});

test("C（PvE）：熔融打坏的护盾——敌人施加的熔融，护盾到下一个敌人回合开始才以一半恢复（以前在整轮开始）；之后照旧按「没挨打」回满", () => {
  const f = field({ party: ["kolt", "helu"], late: null });
  const kolt = f.k("kolt");
  kolt.layers = [{ type: "shield", current: 10, max: 10 }, { type: "flesh", current: 300, max: 300, inner: true }];
  const sh = () => kolt.layers[0].current;
  toEnemy(f.c);
  f.c.applyInstantEffect(kolt, "melt", [], f.foe);
  hit(f.c, f.foe, kolt, 12);   // 物理打护盾减半：6 点，过半但没打穿
  assert.equal(sh(), 0, "护盾累计受伤过半：立刻失效");
  toPlayer(f.c);
  assert.equal(sh(), 0, "整轮开始：还没恢复（我方回合里护盾还是空的）");
  const log = logOf(f.c, () => toEnemy(f.c));
  assert.equal(sh(), 5, "下一个敌人回合开始：以一半恢复");
  assert.match(log, /柯尔特 护盾以一半恢复/);
  toPlayer(f.c);
  assert.equal(sh(), 10, "整轮开始：上一轮没挨打 → 回满（照旧）");
});

test("C + D：过载——乙的川川给乙的队友过载：护盾翻倍撑过对手的回合，到乙下一个回合开始才清零（这一次不按「没挨打」回满）", () => {
  const f = field({ party: ["chuan", "kolt", "helu"], late: ["chuan", "kolt"] });
  const ch = f.k("chuan"), kolt = f.k("kolt");
  f.c.addShieldLayer(kolt, 6);
  const shield = () => (kolt.layers || []).filter(l => l.type === "shield").reduce((n, l) => n + (Number(l.current) || 0), 0);
  toEnemy(f.c);
  ch.resources.charge = 0;
  skill(f.c, ch, "chuan_over", kolt);
  assert.equal(kolt.instant.overload, true);
  const doubled = shield();
  assert.ok(doubled >= 12, "护盾翻倍");
  toPlayer(f.c);
  assert.equal(kolt.instant.overload, true, "整轮开始：还在过载（以前这里就清零了）");
  assert.equal(shield(), doubled, "我方回合里护盾还是翻倍的");
  toEnemy(f.c);
  assert.ok(!kolt.instant.overload, "乙下一个回合开始：过载结束");
  assert.equal(shield(), 0, "护盾清零，这一次没挨打也不回满");
});

test("D：护盾层「没挨打就回满」——乙的在自己的回合开始判（从自己上一个回合开始到现在没挨打）；整轮开始不判；我方的照旧", () => {
  const prep = late => {
    const f = field({ party: ["kolt", "helu"], late: late ? ["kolt"] : null });
    const kolt = f.k("kolt");
    kolt.layers = [{ type: "shield", current: 10, max: 10 }, { type: "flesh", current: 300, max: 300, inner: true }];
    return { f, kolt, sh: () => kolt.layers[0].current };
  };
  const { f, kolt, sh } = prep(true);
  hit(f.c, f.foe, kolt, 6);   // 第 1 回合我方回合（对手的回合）里挨打
  const hurt = sh();
  assert.ok(hurt < 10, "护盾被打掉一些");
  toEnemy(f.c);
  assert.equal(sh(), hurt, "自己的第一个回合开始：从开战到现在挨过打，不回满");
  toPlayer(f.c);
  assert.equal(sh(), hurt, "整轮开始不判");
  toEnemy(f.c);
  assert.equal(sh(), 10, "自己的回合开始：上一个回合开始到现在没挨打 → 回满（以前要等到下一轮开始）");
  toPlayer(f.c);
  hit(f.c, f.foe, kolt, 6);   // 对手的回合里挨打
  toEnemy(f.c);
  assert.ok(sh() < 10, "挨过打：不回满");
  // 对照：普通 PvE
  const p = prep(false);
  hit(p.f.c, p.f.foe, p.kolt, 6);
  const h2 = p.sh();
  toEnemy(p.f.c);
  assert.equal(p.sh(), h2, "敌人回合开始不判");
  toPlayer(p.f.c);
  assert.equal(p.sh(), h2, "第 2 回合整轮开始：这一轮挨过打，不回满");
  toEnemy(p.f.c); toPlayer(p.f.c);
  assert.equal(p.sh(), 10, "第 3 回合整轮开始：上一轮没挨打 → 回满（照旧）");
});

test("两个敌对阵营（乙在敌人回合行动）整场自动对打：打得完、不报错；乙的托乌「圣盾 +1」都记在敌人回合里，我方的托乌记在整轮开始", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["tou", "nora", "xia", "chuan"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "PVP476-DUEL" });
  const S = c.S.state;
  S.units.filter(u => u.isPlayer).forEach(u => { u.level = 12; });
  ["tou", "nora"].forEach(kk => faction(c, { faction: "乙", phase: "enemy", unit: c.findKit(kk, S.units).id }));
  const r = c.BattleSim.run({ maxRounds: 12 });
  assert.deepEqual(plain(c.__errors || []), []);
  assert.ok(["player", "enemy", "timeout"].includes(r.winner));
  // 每一段日志属于哪个阶段：「—— 敌人回合 ——」到下一个「—— 回合结束 ——」之间是敌人回合
  let phase = "player";
  const where = [];
  S.logPages.flatMap(p => p.lines).forEach(l => String(l.text).split("\n").forEach(t => {
    if (/—— 敌人回合 ——/.test(t)) phase = "enemy";
    else if (/—— 回合结束 ——|—— 第 \d+ 回合开始 ——/.test(t)) phase = "round";
    else if (/—— 玩家回合 ——/.test(t)) phase = "player";
    if (/灯 圣盾 \+1/.test(t) || /圣盾 \+1 →/.test(t)) where.push(phase);
  }));
  assert.ok(where.length > 0, "托乌加过圣盾");
  assert.ok(where.every(p => p === "enemy"), "乙的托乌只在敌人回合（自己的回合）开始加圣盾：" + where.join(","));
});
