// 伤害弹字标出「攻击动作本身那一下」：高压场地这类连带伤害先弹出来时，预览 / 总伤害计数仍按攻击本身的属性
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function hitInHv(kit, zone) {
  const c = H.load();
  c.BattleSim.setup({ party: [kit], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "MAIN-POP" });
  c.startCombat();
  const k = c.findKit(kit, c.S.state.units); k.zone = zone || 1;
  const f = c.S.state.units.find(u => !u.isPlayer);
  f.layers.forEach(l => { l.current = l.max = 300; });
  c.setZoneField(1, "electric");
  const pops = [];
  c.spawnPopup = (u, spec) => { if (spec.kind === "dmg") pops.push({ value: spec.value, element: spec.element, main: !!spec.main }); };
  c.Commands.dispatch({ type: "skill", actor: k.id, skill: c.skillList(k)[0].id, target: f.id });
  return pops;
}

test("灯的物理普攻打在高压场地上：先弹电伤，攻击本身那一下标 main、属性是物理", () => {
  const pops = hitInHv("tou");
  assert.ok(pops.length >= 2, JSON.stringify(pops));
  assert.equal(pops[0].element, "electric");
  assert.equal(pops[0].main, false, "高压场地的连带伤害不是攻击本身");
  const main = pops.filter(p => p.main);
  assert.equal(main.length, 1);
  assert.equal(main[0].element, "physical");
});

test("诺拉的冰属性普攻同理", () => {
  // 诺拉普攻（没有刺入时）照说明只能打距离 1 的敌人：站在隔壁 2 区打（audit-P4-heroes）
  const main = hitInHv("nora", 2).filter(p => p.main);
  assert.equal(main.length, 1);
  assert.equal(main[0].element, "ice");
});
