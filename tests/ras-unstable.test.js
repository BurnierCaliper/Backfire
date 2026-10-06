// 拉斯缪尔不稳态：受伤倒地（濒死）；起身后再受伤才直接死亡
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["ras", "kolt"], enemies: [{ id: "thug_hammer", lv: 1, zone: 1 }], seed: "RU" });
  c.startCombat();
  const st = c.S.state;
  const ras = c.findKit("ras", st.units), foe = st.units.find(u => !u.isPlayer);
  ras.zone = 1; foe.zone = 1;
  ras.resources.unstable = true; ras.resources.energyPct = 110;
  return { c, st, ras, foe };
}
const hit = (c, a, t, n) => c.dealTo(a, t, { atk: 0, mult: 0, flat: n, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true } });

test("不稳态受到伤害：倒地濒死，没有死亡", () => {
  const { c, ras, foe } = field();
  hit(c, foe, ras, 1);
  assert.equal(ras.dying, true);
  assert.equal(ras.dead, false);
  assert.equal(c.totalHp(ras), 0);
});

test("不稳态下起身后再受伤：直接死亡", () => {
  const { c, ras, foe } = field();
  hit(c, foe, ras, 1);
  c.standUp(ras);
  assert.equal(ras.upOnShp, true);
  assert.equal(ras.dying, false);
  hit(c, foe, ras, 1);
  assert.equal(ras.dead, true);
});

test("技能说明同步", () => {
  const c = H.load();
  const p = c.SkillText.kitInfo("ras").passives.find(x => x.name === "事故幸存");
  assert.match(p.text, /倒地（濒死）/);
  assert.match(p.text, /起身时再受到伤害则直接死亡/);
});
