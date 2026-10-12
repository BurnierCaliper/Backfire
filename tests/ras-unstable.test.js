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

test("高能状态的敌人在攻击行动中被打死：行动结束后照样高能自爆（余波、光能回收）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ras", "kolt"], enemies: [{ id: "thug_hammer", lv: 1, zone: 2 }, { id: "thug_hammer", lv: 1, zone: 2 }], seed: "RHK" });
  c.startCombat();
  const st = c.S.state;
  const ras = c.findKit("ras", st.units);
  const [foe, mate] = st.units.filter(u => !u.isPlayer);
  ras.zone = 1; foe.zone = 2; mate.zone = 2; ras.ap = 3;
  foe.layers = [{ type: "flesh", current: 1, max: 20 }];   // 第一段就打死
  foe.statuses = Object.assign({}, foe.statuses, { high: true });
  foe.highEnergy = 30;
  mate.layers = [{ type: "flesh", current: 100, max: 100 }];
  const lightBefore = Number(ras.resources.light) || 0;
  const pops = [];
  c.spawnPopup = (u, spec) => { if (u && u.id === foe.id) pops.push(spec.kind); };
  st.attackerId = ras.id; st.targetId = foe.id;
  c.runSkill("ras_aa");
  assert.ok(pops.includes("highboom"), "打死后照样自爆：" + pops.join(","));
  assert.equal(foe.dead, true);
  assert.equal(foe.highEnergy, 0);
  assert.ok((Number(ras.resources.light) || 0) >= lightBefore + 30, "拉斯缪尔回收光能");
  assert.ok(c.totalHp(mate) < 100, "余波打到同区的同阵营敌人");
});

test("联机投影：带高能被打死、还没自爆的敌人不算死（玩家画面等自爆后才淡出）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ras", "kolt"], enemies: [{ id: "thug_hammer", lv: 1, zone: 2 }], seed: "RHP" });
  c.startCombat();
  const foe = c.S.state.units.find(u => !u.isPlayer);
  foe.layers.forEach(l => { l.current = 0; });
  foe.dead = true; foe._removed = true;
  foe.statuses = Object.assign({}, foe.statuses, { high: true });
  foe.highEnergy = 12;
  globalThis.highBoomValue = c.highBoomValue;
  try {
    const OV = require("../online-view.js");
    let p = OV.projectUnit(foe);
    assert.equal(p.dead, false, "还带着高能：先不算死");
    assert.equal(!!p.hidden, false);
    foe.highEnergy = 0; foe.statuses.high = false;
    p = OV.projectUnit(foe);
    assert.equal(p.dead, true, "自爆之后算死");
  } finally { delete globalThis.highBoomValue; }
});
