// 决一死战 / 嘲讽牵制下的远程敌人：不再整场规划移动、空过；没有近身攻击就抵近射击（×0.6）；选区攻击只能选牵制者所在的区
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(id, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: ["tou", "kolt"], seed: "DUEL", zoneMode: opt.zoneMode || 2, enemies: [{ id, lv: 10, zone: 2 }] });
  c.startCombat();
  const st = c.S.state;
  const tou = c.findKit("tou", st.units), kolt = c.findKit("kolt", st.units);
  const a = st.units.find(u => u.kit === id);
  tou.zone = 2; kolt.zone = 1; a.zone = 2;
  [tou, kolt].forEach(u => u.layers.forEach(l => { l.max = 999; l.current = 999; }));
  return { c, st, tou, kolt, a, logs: () => st.logPages.flatMap(p => p.lines).map(l => l.text).join("\n") };
}
const noBlock = { pickBlocker: () => null, pickAssister: l => l[0].id };

test("决一死战里的远程敌人（蚁型戒备兵种）不再规划移动，抵近射击打灯，倍率 ×0.6", () => {
  const { c, st, tou, a, logs } = field("ant_guard");
  assert.ok(c.touDuelVictim(a), "被决一死战锁住");
  assert.equal(c.enemyForcedPointBlank(a, tou), true, "没有近身攻击：可以抵近射击");
  st.combatPhase = "enemy"; c.refreshEnemyEconomy(a);
  const p = c.EnemyAI.plan(a);
  assert.doesNotMatch(p.meta.skillName, /移动/);
  const hp0 = tou.layers.reduce((n, l) => n + l.current, 0);
  p.thunk(); c.BattleSim.resolveQueues(noBlock);
  assert.ok(tou.layers.reduce((n, l) => n + l.current, 0) < hp0, "打到灯了");
  assert.match(logs(), /抵近射击：远距离攻击打同区，倍率 ×0\.6/);
});

test("有近身攻击的敌人不吃抵近射击；没被牵制的远程敌人照旧打不到同区", () => {
  const { c, tou, a } = field("thug_knife");
  assert.equal(c.enemyForcedPointBlank(a, tou), false, "匕首狂徒有近身攻击");
  const g = field("ant_guard");
  g.tou.zone = 1;   // 灯走开：不再牵制
  assert.equal(g.c.enemyForcedTarget(g.a), null);
  assert.equal(g.c.enemyForcedPointBlank(g.a, g.kolt), false);
});

test("选区攻击（榴弹）被牵制时只能选牵制者所在的区：AI 这样选，主持人手动选别的区也会改过来", () => {
  const { c, st, a, logs } = field("mecha_gl", { zoneMode: 3 });
  st.combatPhase = "enemy"; c.refreshEnemyEconomy(a);
  const p = c.EnemyAI.plan(a);
  assert.match(p.meta.skillName, /榴弹/);
  p.thunk();
  assert.equal(a.resources.glZone, 2, "灯所在的 2 区");
  // 嘲讽：手动把落点选在 1 区
  const t = field("mecha_gl", { zoneMode: 3 });
  t.tou.zone = 3; t.a.tauntTo = t.kolt.id;   // 灯走开，柯尔特嘲讽它（柯尔特在 1 区）
  t.st.combatPhase = "enemy"; t.a.ap = 1; t.st.attackerId = t.a.id; t.st.targetId = t.kolt.id;
  t.st.skillFlow = { id: "en_gl", actorId: t.a.id, picks: { dest: 3 }, index: 99 };
  try { t.c.runSkill("en_gl"); } finally { t.st.skillFlow = null; }
  assert.equal(t.a.resources.glZone, 1, "只能选嘲讽者所在的 1 区");
  assert.match(t.st.logPages.flatMap(p => p.lines).map(l => l.text).join("\n"), /被 柯尔特 牵制：落点只能选 1 区/);
  assert.ok(logs());
});

test("高压巡逻艇被牵制在同区：电弧扫射抵近打自己所在的区（×0.6），感电先给牵制者", () => {
  const { c, st, tou, a, logs } = field("patrolboat");
  st.combatPhase = "enemy"; c.refreshEnemyEconomy(a);
  const p = c.EnemyAI.plan(a);
  assert.match(p.meta.skillName, /电弧扫射/);
  p.thunk(); c.BattleSim.resolveQueues(noBlock);
  assert.match(logs(), /电弧扫射抵近打自己所在的 2 区/);
  assert.equal(tou.statuses.shock, true);
});

test("已经标定好的榴弹 / 大酸液弹：被牵制时落点不在牵制者所在的区，发射改成重新标定", () => {
  const { c, st, a, tou, logs } = field("mecha_gl", { zoneMode: 3 });
  Object.assign(a.resources, { glZone: 1, glPending: true, glReady: true });
  st.combatPhase = "enemy"; a.ap = 1; st.attackerId = a.id; st.targetId = tou.id;
  c.runSkill("en_gl_fire");
  assert.equal(a.resources.glZone, 2);
  assert.equal(a.resources.glReady, false, "下个敌人回合才发射");
  assert.match(logs(), /放弃原来的 1 区，榴弹重新标定在 2 区/);
});

test("决一死战（#44 违规）：被决斗的敌人范围攻击只打得到灯，同区的其他人不被波及", () => {
  const { c, st, tou, kolt, a, logs } = field("patrolboat");
  kolt.zone = 2;   // 柯尔特也站在灯这一区
  const k0 = c.totalHp(kolt), t0 = c.totalHp(tou);
  st.combatPhase = "enemy"; c.refreshEnemyEconomy(a);
  const p = c.EnemyAI.plan(a);
  p.thunk(); c.BattleSim.resolveQueues(noBlock);
  assert.ok(c.totalHp(tou) < t0, "灯挨打");
  assert.equal(c.totalHp(kolt), k0, "柯尔特没被波及");
  assert.match(logs(), /决一死战：.*只打得到 灯/);
});

test("决一死战：单体攻击、借机攻击、协助攻击也只打得到灯，同区的其他人不被波及（不只是范围攻击）", () => {
  const { c, st, tou, kolt, a } = field("thug_knife");
  kolt.zone = 2;
  assert.ok(c.touDuelVictim(a));
  st.combatPhase = "enemy";
  const k0 = c.totalHp(kolt);
  const opt = (flags) => ({ element: "physical", mult: 1, diceN: 1, diceS: 6, baseBreak: 1, atkRange: "melee", flags: Object.assign({ action: true }, flags) });
  const r1 = c.dealTo(a, kolt, opt({}));
  const r2 = c.dealTo(a, kolt, opt({ opportunity: true, blockResolved: true }));
  const r3 = c.dealTo(a, kolt, opt({ assist: true }));
  [r1, r2, r3].forEach(r => assert.equal(r.res.ok, false, "打不出去"));
  assert.equal(c.totalHp(kolt), k0, "柯尔特没挨打");
  const t0 = c.totalHp(tou);
  c.dealTo(a, tou, opt({}));
  c.BattleSim.resolveQueues(noBlock);
  assert.ok(c.totalHp(tou) < t0, "灯照样挨打");
});

test("决一死战：同区的中立生物和友军不算『敌人』——不占名额，自己也不被牵制", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["tou", "kolt"], seed: "DUELN", zoneMode: 2, enemies: [{ id: "thug_knife", lv: 5, zone: 2 }, { id: "dust_bug", lv: 3, zone: 2 }, { id: "thug_knife", lv: 5, zone: 2 }] });
  c.startCombat();
  const st = c.S.state;
  const tou = c.findKit("tou", st.units);
  const [k1, k2] = st.units.filter(u => u.kit === "thug_knife");
  const bug = st.units.find(u => u.kit === "dust_bug");
  tou.zone = 2; st.units.filter(u => !u.isPlayer).forEach(u => { u.zone = 2; });
  k2.zone = 1;   // 同区只剩一只匕首 + 一只尘虫
  assert.equal(c.touDuelVictim(k1), tou, "尘虫不算，匕首狂徒是唯一的敌人");
  assert.equal(c.touDuelVictim(bug), null, "中立生物不被牵制");
  assert.equal(c.shouldDiceMin(k1), true, "同区只有它一个敌人：伤害骰取最低");
  // 友军：和我方同阵营
  st.playerAllies = [c.factionOf(k1)];
  assert.equal(c.touDuelVictim(k1), null, "友军不被牵制");
});

test("播撒者被决一死战 / 嘲讽牵制在同区：喷洒抵近打自己所在的区（×0.6），不再空放", () => {
  const { c, st, tou, a, logs } = field("spreader");
  assert.ok(c.touDuelVictim(a));
  const hp0 = c.totalHp(tou);
  st.combatPhase = "enemy"; c.refreshEnemyEconomy(a);
  const p = c.EnemyAI.plan(a);
  assert.match(p.meta.skillName, /喷洒/);
  p.thunk(); c.BattleSim.resolveQueues(noBlock);
  assert.ok(c.totalHp(tou) < hp0, "打到灯了");
  assert.match(logs(), /喷洒抵近打自己所在的 2 区/);
  assert.doesNotMatch(logs(), /打不到距离 0/);
  // 嘲讽：灯走开，柯尔特在同区嘲讽它
  const t = field("spreader");
  t.tou.zone = 1; t.kolt.zone = 2; t.a.tauntTo = t.kolt.id;
  const k0 = t.c.totalHp(t.kolt);
  t.st.combatPhase = "enemy"; t.a.ap = 1; t.st.attackerId = t.a.id; t.st.targetId = t.kolt.id;
  t.c.runSkill("en_spread"); t.c.BattleSim.resolveQueues(noBlock);
  assert.ok(t.c.totalHp(t.kolt) < k0, "嘲讽下也打到了");
  // 没被牵制时同区照旧打不到
  const g = field("spreader");
  g.tou.zone = 1;
  assert.equal(g.c.enemyZoneInRange(g.a, "en_spread", 2), false);
});
