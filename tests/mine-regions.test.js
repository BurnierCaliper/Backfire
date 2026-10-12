// 采矿场的敌人分区（run.js · ENEMY_INFO / regionWeather）：第一采矿场 = 用酸的安保机械
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

test("第一采矿场：只出用酸的安保机械，天气只会是酸雨或无", () => {
  const c = H.load();
  const pool = c.regionPool("第一采矿场");
  assert.deepEqual([...pool].sort(), ["dumpdrone", "spreader"]);
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
    spec.enemies.forEach(e => assert.ok(["dumpdrone", "spreader"].includes(e.preset), e.preset));
  }
});
