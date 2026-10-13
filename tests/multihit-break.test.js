// 复数攻击加次数的额外击破、拉斯缪尔普攻 / 逃离、扭矩强化输出
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(party, foes) {
  const c = H.load();
  c.BattleSim.setup({ party, enemies: foes || [{ id: "thug_hammer", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 2 }], seed: "MB" });
  c.startCombat();
  const st = c.S.state;
  st.units.filter(u => !u.isPlayer).forEach(u => { u.layers.forEach(l => { l.current = l.max = 999; }); u.def = u.defMax = 10; });
  return { c, st };
}
const skill = (c, actor, id, target, picks) => { actor.ap = 3; return c.dispatch({ type: "skill", actor: actor.id, skill: id, target: target ? target.id : null, picks: picks || {} }); };

test("规则：「共 N 击破」的复数攻击被加了次数，额外击破 = 多出的次数 × 原击破 / 原次数，向上取整", () => {
  const { c, st } = field(["ras"]);
  const ras = c.findKit("ras", st.units);
  const foe = st.units.find(u => !u.isPlayer && Number(u.zone) === 2);
  ras.zone = 1;
  const r0 = c.resolveAttack({ attacker: ras, target: foe, atk: 10, mult: 0.5, hits: 2, baseBreak: 1, breakOnce: true, element: "energy", flags: { action: true }, weather: "none", zoneMode: 2, attackerField: {}, targetField: {}, dist: 1, atkRange: "any" });
  assert.equal(r0.breakDealt, 1);
  const r1 = c.resolveAttack({ attacker: ras, target: foe, atk: 10, mult: 0.5, hits: 4, baseHits: 2, baseBreak: 1, breakOnce: true, element: "energy", flags: { action: true }, weather: "none", zoneMode: 2, attackerField: {}, targetField: {}, dist: 1, atkRange: "any" });
  assert.equal(r1.breakDealt, 2, "2 → 4 次：额外 ceil(2 × 1/2) = 1");
  const r2 = c.resolveAttack({ attacker: ras, target: foe, atk: 10, mult: 0.4, hits: 4, baseHits: 3, baseBreak: 2, breakOnce: true, element: "electric", flags: { action: true }, weather: "none", zoneMode: 2, attackerField: {}, targetField: {}, dist: 0, atkRange: "any" });
  assert.equal(r2.breakDealt, 3, "3 → 4 次：额外 ceil(1 × 2/3) = 1");
  // 过载：复数攻击额外多打一次，也按比例加击破
  ras.instant = Object.assign({}, ras.instant, { overload: true });
  const r3 = c.resolveAttack({ attacker: ras, target: foe, atk: 10, mult: 0.5, hits: 2, baseBreak: 1, breakOnce: true, element: "energy", flags: { action: true }, weather: "none", zoneMode: 2, attackerField: {}, targetField: {}, dist: 1, atkRange: "any" });
  assert.equal(r3.perHit.length, 3);
  assert.equal(r3.breakDealt, 2, "过载 2 → 3 次：额外 ceil(1 × 1/2) = 1");
});

test("拉斯缪尔普通攻击：两次 0.5atk 共 1 击破；不稳时四次共 2 击破", () => {
  const { c, st } = field(["ras"]);
  const ras = c.findKit("ras", st.units);
  ras.zone = 1;
  const foe = st.units.find(u => !u.isPlayer && Number(u.zone) === 2);
  const d0 = foe.def;
  skill(c, ras, "ras_aa", foe);
  assert.equal(d0 - foe.def, 1);
  ras.resources.unstable = true;
  const d1 = foe.def;
  skill(c, ras, "ras_aa", foe);
  assert.equal(d1 - foe.def, 2);
});

test("拉斯缪尔逃离：先移动，再打原区域的敌人", () => {
  const { c, st } = field(["ras"]);
  const ras = c.findKit("ras", st.units);
  ras.zone = 1;
  const near = st.units.find(u => !u.isPlayer && Number(u.zone) === 1);
  const h0 = c.totalHp(near);
  skill(c, ras, "ras_flee", near, { dest: 2, target: near.id });
  assert.ok(c.totalHp(near) < h0, "打到了原区域的敌人");
  assert.equal(ras.zone, 2);
  // 原区域没敌人也能逃
  const f2 = field(["ras"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const r2 = f2.c.findKit("ras", f2.st.units);
  r2.zone = 1;
  const step = f2.c.skillFlowSteps("ras_flee", r2, { dest: 2 }).find(s => s.key === "target");
  assert.equal(step.optional, true);
});

function torque(bit) {
  const { c, st } = field(["kolt"], [{ id: "thug_hammer", lv: 1, zone: 2 }, { id: "thug_knife", lv: 1, zone: 2 }]);
  const kolt = c.findKit("kolt", st.units);
  kolt.zone = 1; kolt.resources.bit = bit;
  const tq = c.spawnWeapon(kolt, "torque");
  tq.zone = 1;
  return { c, st, kolt, tq, foes: st.units.filter(u => !u.isPlayer) };
}

test("扭矩电钻强化输出：突进后自己选敌人；1d4+1 次 0.5atk，共 2 击破", () => {
  for (let i = 0; i < 6; i++) {
    const { c, tq, foes } = torque("drill");
    const steps = c.skillFlowSteps("torque_boost", tq, { dest: 2 });
    const tStep = steps.find(s => s.key === "target");
    assert.ok(tStep && tStep.units.length === 2, "能选终点区的敌人");
    const second = foes[1];
    const d0 = second.def, h0 = c.totalHp(second), h1 = c.totalHp(foes[0]);
    const dealt = [];
    const deal = c.dealTo;
    c.dealTo = (a, t, o) => { if (t === second) dealt.push(o.hits); return deal(a, t, o); };
    skill(c, tq, "torque_boost", second, { dest: 2, target: second.id });
    assert.equal(tq.zone, 2);
    assert.ok(c.totalHp(second) < h0, "打的是选的那个");
    assert.equal(c.totalHp(foes[0]), h1, "没打第一个");
    assert.ok(dealt[0] >= 2 && dealt[0] <= 5, "次数 1d4+1：" + dealt[0]);
    assert.equal(d0 - second.def, 2, "共 2 击破");
  }
});

test("扭矩酸液炮强化输出：可以选任意区域，不限距离", () => {
  const { c, st, tq } = torque("acid");
  st.zoneMode = 3;
  const step = c.skillFlowSteps("torque_boost", tq, {})[0];
  assert.equal(step.zones.join(","), "1,2,3");
  skill(c, tq, "torque_boost", null, { dest: 3 });
  assert.equal(tq.resources.acidCharge, 3);
});
