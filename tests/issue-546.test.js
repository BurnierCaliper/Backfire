// issue #546：夕夏被动「背水一战」（濒死后继续战斗时……不会失去架势值）以前只写在攻击结算里（engine.js · applyResultToUnit 的击破、猛击反震），
// 不经过攻击的击破（app.js · dealBreak：破势、冻伤、激活冻伤 / 震荡……）、不稳（只剩 1 架势就失衡、叠加两个不稳转晕眩、高压场地里不稳转晕眩）、
// 直接打进失衡的技能 / 道具（击破预告失败、闪光震撼弹、擒拿、流沙漩涡、牛协助格挡的反击）都能把起身中的夕夏打进失衡。
// 现在都看 engine.js · xiaBackwater 这一处；没起身、被动被图纸关掉时一切照旧。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

/** 主人 11/01 手操的那场 2v2 决斗：1 队 夕夏 / 拉斯缪尔，2 队 诺拉 / 绯秋，Lv10；1 队先手，2 队在敌人回合行动。
 *  夕夏、诺拉、绯秋站 2 区（拉斯缪尔留在 1 区，不来协助格挡）；天气关掉，冻伤固定 1 击破 */
function duel() {
  const party = ["xia", "ras", "nora", "hiaki"];
  const c = H.load();
  c.BattleSim.setup({ party, enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "brawl-2v2-1101" });
  const S = c.S.state;
  const [x, r, n, h] = party.map(k => c.findKit(k, S.units));
  [x, r, n, h].forEach(u => { u.level = 10; });
  c.Commands.dispatch({ type: "battle.duel", teams: { "1队": [x.id, r.id], "2队": [n.id, h.id] } });
  const keep = c.Math.random;
  c.Math.random = () => 0.1;   // 抛硬币：1 队先手
  try { c.startCombat(); } finally { c.Math.random = keep; }
  S.weather = "none";
  [x, n, h].forEach(u => { u.zone = 2; });
  const logs = () => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
  return { c, S, x, r, n, h, logs };
}
/** 夕夏倒地以后起身（靠坚毅生命继续战斗），架势改成 def */
function standXia(c, x, def) {
  x.layers.forEach(l => { l.current = 0; });
  x.dying = true; x.upOnShp = false; x.shp = x.shpMax = 999;
  c.standUp(x);
  assert.equal(x.upOnShp, true, "起身了");
  x.def = def;
}
/** 换成单一职责（两个职责一样）、等级 lv，按新等级重置本场的次数（resetBattleFlags 连起身、状态一起清掉：要起身的人先换职责再起身） */
function asRole(c, u, role, lv) {
  u.roles = { primary: role, secondary: role };
  u.rolePicks = null;
  u.level = lv;
  c.resetBattleFlags(u);
  u.ap = 3; u.bonus = 3;
}
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));
/** 排进了协助攻击（打的是这个人） */
const assistOn = (S, u) => (S.assistQueue || []).some(j => j.targetId === u.id);

test("破势：起身中的夕夏只剩 1 架势，被破势打也不掉架势、不失衡，诺拉没有协助攻击（#546 的现场）", () => {
  const { c, S, x, h, logs } = duel();
  standXia(c, x, 1);
  assert.match(logs(), /背水一战：引擎强制启动，起身期间不失去架势。/);
  c.endPlayerTurn();   // 敌人回合：2 队行动
  asRole(c, h, "击破", 10);
  cmd(c, { actor: h.id, skill: "role_breakwave" });
  assert.equal(x.def, 1, "架势不变");
  assert.equal(x.stunned, false, "不失衡");
  assert.equal(assistOn(S, x), false, "不排协助攻击");
  assert.match(logs(), /背水一战：起身中不失去架势（破势的 1 击破无效）。/);
  assert.doesNotMatch(logs(), /夕夏 受到 1 击破（破势）/);
  assert.doesNotMatch(logs(), /夕夏 失衡。可协助攻击的玩家角色：诺拉/);
});

test("守卫：没起身的夕夏被破势打照常掉架势、失衡，诺拉可以协助攻击", () => {
  const { c, S, x, h, logs } = duel();
  x.def = 1;
  c.endPlayerTurn();
  asRole(c, h, "击破", 10);
  cmd(c, { actor: h.id, skill: "role_breakwave" });
  assert.equal(x.def, 0);
  assert.equal(x.stunned, true);
  assert.equal(assistOn(S, x), true, "诺拉可以接协助攻击");
  assert.match(logs(), /夕夏 受到 1 击破（破势）：架势 1 → 0/);
  assert.doesNotMatch(logs(), /背水一战：起身中不失去架势/);
});

test("守卫：图纸关掉了夕夏的被动，起身中被破势打照常失衡", () => {
  const { c, S, x, h, logs } = duel();
  S.weaponMods = { berniel: { noPassive: true } };
  x.weaponLevels = Object.assign({}, x.weaponLevels, { berniel: 5 });   // 图纸武器 4 级起才生效
  assert.equal(c.passiveOn(x), false);
  standXia(c, x, 1);
  c.endPlayerTurn();
  asRole(c, h, "击破", 10);
  cmd(c, { actor: h.id, skill: "role_breakwave" });
  assert.equal(x.def, 0);
  assert.equal(x.stunned, true);
  assert.doesNotMatch(logs(), /背水一战：起身中不失去架势/);
});

test("冻伤：起身中回合结束的冻伤击破、「激活」冻伤 / 震荡都不扣架势", () => {
  const { c, S, x, n, logs } = duel();
  standXia(c, x, 1);
  x.statuses.frostbite = true;
  c.endPlayerTurn();
  c.endEnemyTurn();   // 回合结束：冻伤 1 冰击破；下一回合开始
  assert.match(logs(), /背水一战：起身中不失去架势（冻伤的 1 击破无效）。/);
  assert.doesNotMatch(logs(), /夕夏 受到 1 击破（冻伤）/);
  assert.equal(x.def, 1, "架势不变（没有失衡，也就没有晕眩结束回满架势）");
  assert.equal(x.stunned, false);
  assert.doesNotMatch(logs(), /夕夏 晕眩：本回合不获得行动点与附赠动作/);
  assert.ok(x.ap > 0, "新的一回合照常拿到行动点");

  // 激活（职责「异常」）：冻伤 1 冰击破、震荡 1 击破
  const notes = c.triggerOneStatus(x, n, "frostbite");
  assert.equal(x.def, 1);
  assert.equal(x.stunned, false);
  assert.match(notes.join("\n"), /背水一战：起身中不失去架势（冻伤的 1 击破无效）。/);
  x.statuses.shockwave = true;
  c.syncShockwave(x, []);
  const notes2 = c.triggerOneStatus(x, n, "shockwave");
  assert.equal(x.def, 1);
  assert.equal(x.stunned, false);
  assert.match(notes2.join("\n"), /背水一战：起身中不失去架势（激活震荡的 1 击破无效）。/);
  assert.equal(assistOn(S, x), false);
});

test("不稳：起身中只剩 1 架势挨撼动不失衡；叠加两个不稳、高压场地里的不稳都不转晕眩；不稳照旧扣下回合的附赠", () => {
  const { c, S, x, n, logs } = duel();
  standXia(c, x, 1);
  c.endPlayerTurn();
  asRole(c, n, "控场", 10);
  cmd(c, { actor: n.id, skill: "role_shake" });
  assert.equal(x.statuses.unstable, true, "不稳挂上了");
  assert.equal(x.stunned, false, "只剩 1 架势也不失衡");
  assert.equal(assistOn(S, x), false);
  assert.match(logs(), /背水一战：起身中不失去架势（不稳：架势只剩 1 也不失衡）。/);
  assert.doesNotMatch(logs(), /夕夏 不稳：架势只剩 1，直接失衡/);

  // 已经不稳，再挂一个：不转晕眩，照旧是一个不稳
  x.def = 3;
  const n1 = [];
  assert.equal(c.applyUnstable(x, n1), true, "现在还是不稳");
  assert.equal(x.statuses.unstable, true);
  assert.equal(x.stunned, false);
  assert.match(n1.join("\n"), /背水一战：起身中不失去架势（叠加两个不稳也不转晕眩）。/);

  // 高压场地：不稳不直接转晕眩
  S.fields[x.zone] = Object.assign(S.fields[x.zone] || {}, { electric: true });
  const n2 = [];
  c.convertUnstableInHv(x, n2);
  assert.equal(x.statuses.unstable, true);
  assert.equal(x.stunned, false);
  assert.match(n2.join("\n"), /背水一战：起身中不失去架势（高压场地：不稳也不转晕眩）。/);

  // 不稳本身照旧：下回合附赠动作 −1，用掉就没了
  assert.equal(c.applyBonusPenalties(x, 2, []), 1);
  assert.equal(x.statuses.unstable, false);
});

test("守卫：攻击结算原来的保护照样有效（起身中挨 2 击破的攻击不掉架势，写「背水一战：起身中不失去架势。」）", () => {
  const { c, x, h, logs } = duel();
  standXia(c, x, 1);
  c.endPlayerTurn();
  const out = c.dealTo(h, x, { atk: 10, mult: 1, element: "physical", baseBreak: 2, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });
  const text = (out.extra || []).join("\n") + "\n" + logs();
  assert.equal(x.def, 1);
  assert.equal(x.stunned, false);
  assert.match(text, /背水一战：起身中不失去架势。/);
});

test("起身时架势是 0（千钧在身，起身回不了架势）：挨攻击、挨击破也不会被打进失衡", () => {
  const { c, S, x, h, logs } = duel();
  x.self = "anchor";
  x.def = 0; x.stunned = true;
  standXia(c, x, 0);
  assert.equal(x.stunned, false, "起身解除晕眩");
  c.endPlayerTurn();
  c.dealTo(h, x, { atk: 10, mult: 1, element: "physical", baseBreak: 1, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });
  assert.equal(x.stunned, false, "攻击打不进失衡");
  assert.equal(assistOn(S, x), false);
  const notes = [];
  c.dealBreak(x, 1, "none", notes, "折戟", { by: h });
  assert.equal(x.stunned, false, "击破也打不进失衡");
  assert.match(notes.join("\n"), /背水一战：起身中不失去架势（折戟的 1 击破无效）。/);
  assert.doesNotMatch(logs(), /夕夏 架势归零，进入失衡/);
});

test("决不后退：起身中的击破被背水一战挡下，不再白花附赠动作去 +2 架势", () => {
  const { c, x, h } = duel();
  x.feats = ["unbowed"];
  standXia(c, x, 1);
  x.bonus = 1;
  const notes = [];
  c.dealBreak(x, 1, "none", notes, "破势", { by: h });
  assert.equal(x.bonus, 1, "附赠动作没花");
  assert.equal(x.def, 1);
  assert.equal(x.stunned, false);
  assert.match(notes.join("\n"), /背水一战：起身中不失去架势（破势的 1 击破无效）。/);
  assert.doesNotMatch(notes.join("\n"), /决不后退/);
});

test("直接打进失衡的：起身中挨闪光震撼弹、自己的击破预告失败都不失衡、不掉架势", () => {
  const { c, S, x, n, logs } = duel();
  asRole(c, x, "击破", 15);   // 先换职责，再起身
  standXia(c, x, 3);
  // 闪光震撼弹
  const notes = [];
  c.itemStun(x, notes);
  assert.equal(x.stunned, false);
  assert.equal(x.def, 3);
  assert.equal(assistOn(S, x), false);
  assert.match(notes.join("\n"), /背水一战：起身中不失去架势（闪光震撼弹无效）。/);

  // 击破预告：夕夏预告诺拉，这一回合没打掉诺拉的架势 → 预告失败
  cmd(c, { actor: x.id, skill: "role_omen", target: n.id });
  assert.equal(n.instant.omenArmed, true, "预告挂上了");
  c.endPlayerTurn();
  c.endEnemyTurn();
  assert.match(logs(), /背水一战：起身中不失去架势（击破预告失败也不被击破）。/);
  assert.doesNotMatch(logs(), /击破预告失败：夕夏 架势被击破/);
  assert.equal(x.def, 3, "架势不变");
  assert.equal(x.stunned, false);
  assert.ok(x.ap > 0, "新的一回合照常拿到行动点");
});

/** 普通战斗（PvE）：夕夏 + 柯尔特对 enemies；夕夏起身、坚毅生命给足 */
function field(enemies, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: ["xia", "kolt"], enemies, seed: "P546", zoneMode: opt.zoneMode || 2 });
  c.startCombat();
  const S = c.S.state;
  S.weather = "none";
  const x = c.findKit("xia", S.units), k = c.findKit("kolt", S.units);
  k.layers.forEach(l => { l.max = 999; l.current = 999; });
  const logs = () => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
  return { c, S, x, k, E: kit => S.units.find(u => !u.isPlayer && u.kit === kit && !u.dead), logs };
}

test("直接打进失衡的敌人技能：亡命之王的擒拿（两处）、流沙漩涡、牛协助格挡的反击，起身中的夕夏都不失衡、不掉架势；柯尔特照旧", () => {
  // 亡命之王「处死命令」后的擒拿 + 公开处刑落下后的擒拿（强盗头子在场才擒拿）
  const kg = field([{ id: "outlaw_king", lv: 5, zone: 2 }, { id: "bandit_boss", lv: 5, zone: 2 }]);
  const king = kg.E("outlaw_king");
  standXia(kg.c, kg.x, 3);
  kg.x.zone = 2; kg.k.zone = 1;
  kg.S.combatPhase = "enemy"; king.ap = 1; kg.S.attackerId = king.id; kg.S.targetId = kg.x.id;
  kg.c.Math.random = () => 0.1;   // 擒拿 50% / KING_CFG.exec.grab：成功
  kg.c.runSkill("en_king_kill");
  assert.equal(kg.x.stunned, false, "擒拿不让她失衡");
  assert.equal(kg.x.def, 3);
  assert.match(kg.logs(), /背水一战：起身中不失去架势（强盗头子擒拿无效）。/);
  const g = [];
  kg.c.kingExecutionGrab(king, { st: { lastTargetId: kg.x.id } }, g);
  assert.equal(kg.x.stunned, false);
  assert.match(g.join("\n"), /背水一战：起身中不失去架势（强盗头子 擒拿无效）。/);
  kg.c.kingExecutionGrab(king, { st: { lastTargetId: kg.k.id } }, g);
  assert.equal(kg.k.stunned, true, "柯尔特照旧被擒拿");

  // 巨型流沙漩涡：打中的人失去行动（失衡）
  const ls = field([{ id: "livesand", lv: 3, zone: 3 }], { zoneMode: 3 });
  const sand = ls.E("livesand");
  standXia(ls.c, ls.x, 3);
  ls.x.zone = 2; ls.k.zone = 2;
  sand.resources.giant = true; sand.resources.giantTurns = 3;
  ls.S.combatPhase = "enemy"; sand.ap = 1; ls.S.attackerId = sand.id; ls.S.targetId = ls.x.id;
  ls.c.runSkill("en_giant_sand_vortex");
  assert.equal(ls.x.stunned, false, "流沙漩涡困不住起身中的夕夏");
  assert.equal(ls.x.def, 3);
  assert.match(ls.logs(), /背水一战：起身中不失去架势（流沙漩涡困不住）。/);
  assert.equal(ls.k.stunned, true, "柯尔特照旧被困住");

  // 牛协助格挡成功：反击攻击者 1 击破
  const ox = field([{ id: "captain_ox", lv: 1, zone: 1 }]);
  const cap = ox.E("captain_ox");
  standXia(ox.c, ox.x, 1);
  ox.c.Math.random = () => 0.1;   // 40%：成功
  const lines = [];
  ox.c.runEnemyAction("en_ox_block", cap, ox.x, () => null, lines, () => true);
  assert.equal(ox.x.def, 1);
  assert.equal(ox.x.stunned, false);
  assert.match(lines.join("\n"), /背水一战：起身中不失去架势（牛协助格挡反击的 1 击破无效）。/);
});
