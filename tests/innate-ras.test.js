// 固有天气 / 固有场地 / 深渊塌陷不可改变；拉斯缪尔「能量流向」「失控暴走」
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(opt) {
  const c = H.load();
  c.BattleSim.setup(Object.assign({ party: ["ras", "helu"], enemies: [{ id: "thug_hammer", lv: 1, zone: 2 }], seed: "IR" }, opt || {}));
  return { c, st: c.S.state };
}

test("固有天气：开战时就有的天气整场无法被改变；主持人后台可以强制改", () => {
  const { c, st } = field({ weather: "heat" });
  c.startCombat();
  assert.equal(st.weatherInnate, "heat");
  assert.match(c.setWeather("phase") || "", /固有天气/);
  assert.equal(st.weather, "heat");
  assert.equal(c.setWeather("snow", { force: true }), null);
  assert.equal(st.weather, "snow");
});

test("开战时没有天气：之后可以正常改变天气", () => {
  const { c, st } = field();
  c.startCombat();
  assert.equal(st.weatherInnate, null);
  assert.equal(c.setWeather("phase"), null);
  assert.equal(st.weather, "phase");
});

test("固有场地：开战时就有的场地无法被改变；开战后新铺的场地照常可以覆盖", () => {
  const { c, st } = field();
  c.setZoneField(1, "acid");
  c.startCombat();
  assert.equal(st.fields[1].innate, true);
  assert.match(c.setZoneField(1, "fire") || "", /固有场地/);
  assert.equal(st.fields[1].acid, true);
  assert.equal(c.setZoneField(1, "acid"), null, "重复施加同一种照常");
  assert.equal(c.setZoneField(2, "ice"), null);
  assert.equal(c.setZoneField(2, "fire"), null, "开战后铺的不是固有场地");
  assert.equal(st.fields[2].fireOn, true);
});

test("深渊、塌陷区域：场地无法被改变", () => {
  const { c, st } = field();
  st.fields[1].abyss = true;
  st.fields[2].collapseOn = true;
  c.startCombat();
  assert.match(c.setZoneField(1, "energy") || "", /深渊/);
  assert.match(c.setZoneField(2, "energy") || "", /塌陷/);
});

test("只有高地的区不算固有场地", () => {
  const { c, st } = field();
  st.fields[1].highland = true;
  c.startCombat();
  assert.ok(!st.fields[1].innate);
  assert.equal(c.setZoneField(1, "fire"), null);
});

test("能量流向：场上任何高能爆炸都回收等量光能（不需要是拉斯缪尔施加的）", () => {
  const { c, st } = field();
  c.startCombat();
  const ras = c.findKit("ras", st.units);
  ras.resources.light = 0;
  const foe = st.units.find(u => !u.isPlayer);
  foe.highEnergy = 9; foe.highTags = [];
  c.explodeHigh(foe);
  assert.equal(ras.resources.light, 9);
});

test("失控暴走：+40% 能量；因此进入不稳态 → 同区变能量场；已在不稳态 → 全场变能量场", () => {
  const { c, st } = field({ zoneMode: 3 });
  c.startCombat();
  const ras = c.findKit("ras", st.units);
  ras.level = 6; ras.zone = 1;
  const go = () => { ras.ap = 3; c.dispatch({ type: "skill", actor: ras.id, skill: "ras_rampage", target: null, picks: {} }); };
  ras.resources.energyPct = 0;
  go();
  assert.equal(ras.resources.energyPct, 40);
  assert.ok(!st.fields[1].energy, "没进不稳态就不变场地");
  ras.resources.energyPct = 70; ras.resources.unstable = false;
  go();
  assert.equal(ras.resources.unstable, true);
  assert.equal(st.fields[1].energy, true);
  assert.ok(!st.fields[2].energy);
  go();
  assert.ok([1, 2, 3].every(z => st.fields[z].energy), "已在不稳态：全场能量场");
  assert.ok(c.skillList(ras).some(s => s.id === "ras_rampage"));
});
