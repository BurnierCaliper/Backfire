// 碎渣机炮：玩家或狂徒同区操控（1 行动点），打机炮 2 距离内的敌人 1d4 次 6+等级 物理、2 击破；耐久 5，每次受到攻击 −1
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(zoneMode) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_hammer", lv: 1, zone: 2 }], seed: "SCRAP" });
  c.startCombat();
  const st = c.S.state;
  if (zoneMode) st.zoneMode = zoneMode;
  const kolt = c.findKit("kolt", st.units), helu = c.findKit("helu", st.units);
  kolt.zone = 1; helu.zone = 2;
  const thug = st.units.find(u => !u.isPlayer);
  thug.zone = 2;
  [kolt, helu, thug].forEach(u => u.layers.forEach(l => { l.current = l.max = 300; }));
  thug.def = thug.defMax = 10;
  const p = c.makeProp("scrap", 1, 1);
  st.props = [p];
  return { c, st, kolt, helu, thug, p };
}
const use = (c, st, a, p, t) => { st.attackerId = a.id; st.targetId = t ? t.id : null; c.runSkill("use_scrap:" + p.id); };

test("玩家同区操控：花 1 行动点，打 1d4 次 7 物理（Lv1）和 2 击破", () => {
  const { c, st, kolt, thug, p } = field();
  kolt.ap = 2;
  const h0 = c.totalHp(thug), d0 = thug.def;
  use(c, st, kolt, p, thug);
  assert.equal(kolt.ap, 1);
  const dmg = h0 - c.totalHp(thug);
  assert.ok(dmg >= 7 && dmg <= 28 && dmg % 7 === 0, `伤害 ${dmg}`);
  assert.equal(thug.def, d0 - 2);
  assert.ok(st.battleStats[kolt.id].dmg >= 7, "伤害记在操控的人身上");
});

test("不同区不能操控；机炮 2 距离外的敌人打不到", () => {
  const { c, st, kolt, helu, thug, p } = field(3);
  helu.ap = 2;
  const h0 = c.totalHp(thug);
  use(c, st, helu, p, thug);              // helu 在 2 区，机炮在 1 区
  assert.equal(helu.ap, 2);
  assert.equal(c.totalHp(thug), h0);
  thug.zone = 3;                          // 三区制下 1 → 3 是 2 距离，可以
  kolt.ap = 2;
  use(c, st, kolt, p, thug);
  assert.ok(c.totalHp(thug) < h0);
  assert.equal(c.scrapTargets(p, kolt).length, 1);
});

test("狂徒也能操控，打玩家；AI 站在机炮旁边时会用", () => {
  const { c, st, kolt, thug, p } = field();
  thug.zone = 1; thug.ap = 1;
  st.combatPhase = "enemy";
  const plan = c.EnemyAI.plan(thug);
  assert.equal(plan.meta.skillName, "操控碎渣机炮");
  const h0 = c.totalHp(kolt);
  plan.thunk();
  assert.ok(c.totalHp(kolt) < h0);
  assert.equal(thug.ap, 0);
  void p;
});

test("非狂徒的敌人不能操控", () => {
  const { c } = field();
  assert.equal(c.canControlScrap({ isPlayer: false, kit: "bandit_boss" }), false);
  assert.equal(c.canControlScrap({ isPlayer: false, kit: "thug_knife" }), true);
});

test("耐久 5，每次受到攻击 −1，归零被摧毁", () => {
  const { c, st, kolt, p } = field();
  assert.equal(p.hp, 5);
  for (let i = 0; i < 4; i++) c.damageProp(p, { element: "fire", dmg: 50 }, kolt);
  assert.equal(p.hp, 1);
  c.damageProp(p, { element: "physical", dmg: 1 }, kolt);
  assert.ok(!st.props.includes(p));
});
