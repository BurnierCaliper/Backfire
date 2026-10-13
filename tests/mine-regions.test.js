// 采矿场的敌人分区（run.js · ENEMY_INFO / regionWeather）：第一采矿场 = 用酸的安保部队
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

test("第一采矿场：只出用酸的安保部队，天气只会是酸雨或无", () => {
  const c = H.load();
  const pool = c.regionPool("第一采矿场");
  assert.deepEqual([...pool].sort(), ["ant_guard", "dumpdrone", "mine_guard", "spreader"]);
  const presets = c.enemyPresets();
  pool.forEach(k => {
    assert.equal(c.enemyInfo(k).faction, "安保", k);
    const u = presets.find(p => p.id === k).build(5, 1);
    assert.equal(u.suggest.element, "acid", k);
  });
  for (let i = 0; i < 50; i++) assert.ok(["acid", "none"].includes(c.regionWeather("第一采矿场")));
  assert.ok(c.worldPlaceOf("第一采矿场"), "能对到地图上的第一采矿场");
});

test("不再有笼统的「矿场」区域", () => {
  const c = H.load();
  assert.equal(c.regionPool("矿场").length, 0);
});

test("第一采矿场的随机遭遇能抽出敌人", () => {
  const c = H.load();
  for (let i = 0; i < 20; i++) {
    const spec = c.rollEncounter({ region: "第一采矿场" });
    assert.ok(spec.enemies.length > 0);
    spec.enemies.forEach(e => assert.ok(["ant_guard", "dumpdrone", "mine_guard", "spreader"].includes(e.preset), e.preset));
  }
});

test("第二采矿场：只出用火的安保部队；随机遭遇抽得出", () => {
  const c = H.load();
  const kits = ["ant_hunter", "flint_sweeper", "gas_collector", "mine_overseer"];
  assert.deepEqual([...c.regionPool("第二采矿场")].sort(), kits);
  c.regionPool("第二采矿场").forEach(k => assert.equal(c.enemyInfo(k).faction, "安保", k));
  for (let i = 0; i < 20; i++) {
    const spec = c.rollEncounter({ region: "第二采矿场" });
    assert.ok(spec.enemies.length > 0);
    spec.enemies.forEach(e => assert.ok(kits.includes(e.preset), e.preset));
  }
  assert.ok(c.worldPlaceOf("第二采矿场"), "能对到地图上的第二采矿场");
});

test("第三采矿场：30% 微光、20% 有一个区是能量场", () => {
  const c = H.load();
  let glow = 0, energy = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const w = c.regionWeather("第三采矿场");
    assert.ok(["glow", "none"].includes(w));
    if (w === "glow") glow++;
    const f = c.regionFeatures("第三采矿场", 3);
    if (f.length) {
      energy++;
      assert.equal(f.length, 1);
      assert.equal(f[0].what, "energy");
      assert.ok(f[0].zone >= 1 && f[0].zone <= 3);
    }
  }
  assert.ok(Math.abs(glow / N - 0.3) < 0.05, "微光约 30%：" + glow / N);
  assert.ok(Math.abs(energy / N - 0.2) < 0.05, "能量场约 20%：" + energy / N);
  assert.equal(c.regionFeatures("第一采矿场", 3).length, 0, "其他区域不带");
});
