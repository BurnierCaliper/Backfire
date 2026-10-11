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

test("高能自爆在一次完整的攻击行动之后才判：拉斯缪尔普通攻击每一段都打完、高能继续累积，再爆炸", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ras", "kolt"], enemies: [{ id: "thug_hammer", lv: 1, zone: 2 }], seed: "RHB" });
  c.startCombat();
  const st = c.S.state;
  const ras = c.findKit("ras", st.units), foe = st.units.find(u => !u.isPlayer);
  ras.zone = 1; foe.zone = 2; ras.ap = 3;
  foe.layers = [{ type: "flesh", current: 20, max: 20 }];
  foe.statuses = Object.assign({}, foe.statuses, { high: true });
  foe.highEnergy = 19;   // 第一段打下去血量就低于高能值
  const pops = [];
  c.spawnPopup = (u, spec) => { if (u && u.id === foe.id) pops.push(spec.kind); };
  c.S.state.attackerId = ras.id; c.S.state.targetId = foe.id;
  c.runSkill("ras_aa");
  const dmgBeforeBoom = pops.indexOf("highboom") < 0 ? -1 : pops.slice(0, pops.indexOf("highboom")).filter(k => k === "dmg").length;
  assert.ok(pops.includes("highboom"), "最后高能自爆了：" + pops.join(","));
  assert.equal(dmgBeforeBoom, 2, "两段都打完才爆炸：" + pops.join(","));
  assert.equal(foe.dead || foe.dying || c.totalHp(foe) === 0, true);
});

test("不稳超导：已经处于导体状态时不能再放", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ras", "kolt"], enemies: [{ id: "thug_hammer", lv: 1, zone: 2 }], seed: "RSU" });
  c.startCombat();
  const ras = c.findKit("ras", c.S.state.units);
  ras.level = 5;
  assert.equal(c.skillRequirementError(ras, "ras_super"), null);
  ras.self = "conductor";
  assert.match(c.skillRequirementError(ras, "ras_super"), /导体/);
});
