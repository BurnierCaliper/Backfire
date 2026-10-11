// 敌人 AI 找站位：在原地打不到人、走一步就能打到时主动移动；瞄准时考虑危墙 / 关着的门
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function setup(kit, ez, pz, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "ras"], enemies: [{ id: kit, lv: 3, zone: 1 }], seed: "AIPOS", zoneMode: 3 });
  c.startCombat();
  const S = c.S.state;
  S.zoneMode = 3;
  S.combatPhase = "enemy";
  (opt.walls || []).forEach(w => { S.gaps[w] = Object.assign(c.emptyGap(), { type: "wall", hp: 50, maxHp: 50, level: 1 }); });
  const e = S.units.find(u => !u.isPlayer && u.kit === kit);
  const ps = S.units.filter(u => u.isPlayer && !u.hidden);
  e.zone = ez; ps[0].zone = pz[0]; ps[1].zone = pz[1];
  e.ap = opt.ap != null ? opt.ap : 1; e.bonus = opt.bonus != null ? opt.bonus : 1; e.stunned = false;
  return { c, S, e, ps };
}
const planOf = (c, e) => c.EnemyAI.plan(e);

test("只有远程攻击的精英：同区的人打不到、隔一区的人被危墙挡住 → 走到另一边去打", () => {
  const { c, e } = setup("captain_lizard", 2, [2, 1], { walls: ["1-2"] });
  const plan = planOf(c, e);
  assert.ok(plan, "要有动作");
  assert.match(plan.meta.skillName, /移动到 3 区/);
});

test("远程精英：隔墙的人不瞄准，改打不隔墙的那个", () => {
  const { c, e, ps } = setup("captain_lizard", 2, [1, 3], { walls: ["1-2"] });
  const plan = planOf(c, e);
  assert.ok(plan && plan.meta.targetId === ps[1].id, "打 3 区那个不隔墙的人");
});

test("远程杂兵有近战手段：同区有人就近战，不乱走", () => {
  const { c, e } = setup("guard_gun", 2, [2, 1], { walls: ["1-2"] });
  const plan = planOf(c, e);
  assert.ok(plan && !/移动/.test(plan.meta.skillName));
});

test("没有固定射程的精英（机枪机甲）：人都在两区外 → 先走过去，不原地干等", () => {
  const { c, e } = setup("mecha_mg", 1, [3, 3]);
  const plan = planOf(c, e);
  assert.ok(plan, "要有动作");
  assert.match(plan.meta.skillName, /移动到 2 区/);
});

test("精英没有附赠行动就不打算移动（走不了）", () => {
  const { c, e } = setup("mecha_mg", 1, [3, 3], { bonus: 0 });
  const plan = planOf(c, e);
  assert.ok(!plan || !/移动/.test(plan.meta.skillName));
});

test("站位要能走过去：隔着危墙的区不算", () => {
  // 机枪机甲在 2 区，人都在 3 区之外的 1 区，1-2 之间是墙：走不过去也打不到，不会提议移动到 1 区
  const { c, e } = setup("mecha_mg", 2, [1, 1], { walls: ["1-2"] });
  const plan = planOf(c, e);
  assert.ok(!plan || !/移动到 1 区/.test(plan.meta.skillName));
});

test("榴弹落点：不选隔着危墙的区", () => {
  const { c, e } = setup("mecha_gl", 2, [1, 3], { walls: ["1-2"] });
  const plan = planOf(c, e);
  plan.thunk();
  assert.equal(e.resources.glZone, 3);
});

/* 沙暴风向：飞行单位顺风 +1 行动点、逆风 −1 行动点，飞行敌人会自己走出逆风、走进顺风 */
function windSetup(ez, pz, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "ras"], board: "square4", enemies: [{ id: "buoy", lv: 3, zone: ez }], seed: "AIWIND" });
  c.startCombat();
  const S = c.S.state;
  S.combatPhase = "enemy";
  S.weather = opt.weather || "sand"; S.sandDir = "E";   // 往右吹：左边一列（1、3 区）顺风，右边一列（2、4 区）逆风
  const e = S.units.find(u => !u.isPlayer && u.kit === "buoy");
  const ps = S.units.filter(u => u.isPlayer && !u.hidden);
  e.zone = ez; ps.forEach(p => { p.zone = pz; });
  e.ap = 1; e.bonus = 1; e.stunned = false;
  return { c, S, e, ps };
}
test("飞行敌人：两条一样近的路，挑顺风那条（不刮沙暴时照旧按区号走）", () => {
  const calm = windSetup(1, 4, { weather: "none" });
  assert.match(calm.c.EnemyAI.plan(calm.e).meta.skillName, /移动到 2 区/);
  const { c, e } = windSetup(1, 4);
  assert.equal(c.sandWindLabel(c.sandWind(3, 4, "E")), "顺风");
  assert.equal(c.sandWindLabel(c.sandWind(2, 4, "E")), "逆风");
  assert.match(c.EnemyAI.plan(e).meta.skillName, /移动到 3 区/);
});
test("飞行敌人：这一步没事可做时从逆风区飞到顺风区；地面敌人不管风向", () => {
  const { c, e, ps } = windSetup(2, 4);
  ps.forEach(p => { p.dying = true; p.upOnShp = false; });   // 没有能打的人
  const plan = c.EnemyAI.plan(e);
  assert.ok(plan, "要动");
  assert.match(plan.meta.skillName, /移动到 1 区/);
  e.flying = false;
  assert.equal(c.EnemyAI.plan(e), null);
});
test("飞行敌人：已经在顺风区、同区有人就直接打，不乱飞", () => {
  const { c, e } = windSetup(1, 1);
  const plan = c.EnemyAI.plan(e);
  assert.ok(plan && !/移动/.test(plan.meta.skillName));
});
