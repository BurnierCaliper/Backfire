// 角鳞星地图（world-data.js）：地点数据、游戏区域对到地图上、跑团主持人设定队伍位置（跟着存档走）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./headless");

test("地点数据：id 不重复、坐标在图里；地图图片在仓库里", () => {
  const c = H.load();
  const P = c.S.WORLD_PLACES;
  const ids = P.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length);
  P.forEach(p => {
    assert.ok(p.x > 0 && p.x < 100 && p.y > 0 && p.y < 100, p.id);
    assert.ok(p.name && p.desc, p.id);
  });
  assert.ok(fs.existsSync(path.join(H.ROOT, "art", "world-map.webp")));
});

test("单局各幕的区域、遭遇的区域都能对到地图上的地点", () => {
  const c = H.load();
  const regions = new Set(c.S.ROGUE_CONFIG.regions);
  ["外城区", "沙漠", "巨人城", "天网设施"].forEach(r => regions.add(r));
  regions.forEach(r => assert.ok(c.worldPlaceOf(r), "没对上：" + r));
  assert.equal(c.worldPlaceOf("天网设施").name, "天网塔");
  assert.equal(c.worldPlaceOf("巨人城").id, "giant_city");
  assert.equal(c.worldPlaceOf("casino").name, "沙穹赌场");
  assert.equal(c.worldPlaceOf("沙穹赌场").id, "casino", "按名字也认");
  assert.equal(c.worldPlaceOf("火星"), null);
});

test("跑团：主持人设定队伍位置（经过指令层），写进记录，存档读档后还在；不认识的地点被拦下", () => {
  const c = H.load();
  const notes = c.Commands.dispatch({ type: "trpg", action: "setPlace", place: "mine_1" });
  assert.equal(c.LEDGER.place, "mine_1");
  assert.match(notes.join(), /队伍移动到 第一采矿场/);
  c.Commands.dispatch({ type: "trpg", action: "setPlace", place: "casino" });
  assert.match(c.trpgSetPlace("casino").join(), /沙穹赌场/);
  const saved = c.LEDGER.save();
  c.LEDGER.reset();
  assert.equal(c.LEDGER.place, null);
  c.LEDGER.load(saved);
  assert.equal(c.LEDGER.place, "casino");
  assert.throws(() => c.Commands.dispatch({ type: "trpg", action: "setPlace", place: "mars" }), /没有这个地点/);
  c.Commands.dispatch({ type: "trpg", action: "setPlace", place: null });
  assert.equal(c.LEDGER.place, null);
});

test("跑团：标记可以拖到地图上任意位置（记最近的地点、显示「附近」）；坐标越界被拦下", () => {
  const c = H.load();
  const near = c.worldNearestPlace(66, 81);
  assert.equal(near.place.id, "mine_1");
  const notes = c.Commands.dispatch({ type: "trpg", action: "setPlace", place: "mine_1", x: 70.04, y: 85 });
  assert.equal(c.LEDGER.place, "mine_1");
  assert.equal(c.LEDGER.placePos.x, 70);
  assert.equal(c.LEDGER.placePos.y, 85);
  assert.match(notes.join(), /第一采矿场 附近/);
  const saved = c.LEDGER.save();
  c.LEDGER.reset();
  assert.equal(c.LEDGER.placePos, null);
  c.LEDGER.load(saved);
  assert.equal(c.LEDGER.placePos.x, 70);
  // 吸到地点上：不带坐标
  c.Commands.dispatch({ type: "trpg", action: "setPlace", place: "casino" });
  assert.equal(c.LEDGER.placePos, null);
  assert.throws(() => c.Commands.dispatch({ type: "trpg", action: "setPlace", place: "casino", x: 120, y: 5 }), /0–100/);
});
