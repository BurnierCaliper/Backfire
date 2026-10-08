// 角鳞星测距（world-travel.js）：按设定表找路、算路程和徒步 / 各种车的用时；地图有透视，不量图
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);

test("路段表：两端都是地图上的地点（或聚落边缘），km 是 [少, 多]，路况占比合计 1", () => {
  const c = H.load();
  const ids = new Set(c.S.WORLD_PLACES.map(p => p.id).concat("rim"));
  c.S.WORLD_TRAVEL_EDGES.forEach(e => {
    assert.ok(ids.has(e.a) && ids.has(e.b), `${e.a}–${e.b}`);
    assert.ok(e.km[0] <= e.km[1], `${e.a}–${e.b}`);
    const sum = Object.values(e.road).reduce((s, v) => s + v, 0);
    near(sum, 1, `${e.a}–${e.b} 路况占比`);
  });
  assert.ok(!c.travelPlaceIds().includes("desert"), "「沙漠」是泛指，不参与测距");
  assert.ok(!c.travelPlaceIds().includes("rim"));
});

test("城外两地经由聚落边缘：第一采矿场 → 沙穹赌场 = 90–130 km，徒步 2–4 天", () => {
  const c = H.load();
  const r = c.worldRoute("mine_1", "casino");
  assert.ok(r.ok);
  assert.deepEqual(plain(r.legs.map(l => [l.a, l.b])), [["mine_1", "rim"], ["rim", "casino"]]);
  assert.deepEqual(plain(r.km), [90, 130]);
  const walk = c.worldTravel(r, "walk");
  assert.deepEqual(plain(walk.days), [2, 4]);
  assert.equal(walk.text, "约 2–4 天");
  const car = c.worldTravel(r, "car");
  near(car.hours[0], 90 / 70, "全程铺装 最快"); near(car.hours[1], 130 / 60, "最慢");
  assert.equal(car.warn.length, 0);
});

test("巨人城核心区到外城区：9 km × 绕路 1.4，步行 4–5 km/h ≈ 2.5–3 小时", () => {
  const c = H.load();
  const r = c.worldRoute("giant_city", "outer_city");
  const w = c.worldTravel(r, "walk");
  near(w.hours[0], 9 * 1.4 / 5, "快"); near(w.hours[1], 9 * 1.4 / 4, "慢");
  assert.equal(w.days[1], 0);
  assert.equal(w.text, "约 2.5–3 小时");
  // 城里出发去星际港口：城内几小时 + 城外半天到一天
  const s = c.worldTravel(c.worldRoute("giant_city", "starport"), "walk");
  assert.deepEqual(plain(s.days), [0.5, 1]);
  assert.ok(s.hours[0] > 2 && s.text.includes("天 +"), s.text);
});

test("普通车在沙地上会陷车；全地形车沙地 40–55 km/h；悬浮无视地形", () => {
  const c = H.load();
  const r = c.worldRoute("outer_city", "ruins");
  const [walk, car, atv, hover] = c.worldTravelPlan("outer_city", "ruins").modes;
  assert.equal(walk.mode, "walk"); assert.deepEqual(plain(walk.days), [6, 10]);
  assert.ok(car.warn.some(w => w.includes("陷车")));
  near(atv.hours[0], 250 / 55 + 0 / 40, "全地形车 快");   // 外城区到边缘 0 km 起
  near(atv.hours[1], 300 / 40 + 0.6 / 30, "全地形车 慢");
  near(hover.hours[0], 250 / 90, "悬浮 快");
  assert.ok(hover.hours[1] < car.hours[1] && atv.hours[1] < car.hours[1]);
  assert.equal(r.tbd, false);
});

test("极北禁区：雪山段车辆用不上，要弃车徒步（天数 + 小时），带「路况暂定」", () => {
  const c = H.load();
  const r = c.worldRoute("outer_city", "north_zone");
  assert.ok(r.tbd);
  const hover = c.worldTravel(r, "hover");
  near(hover.days[0], 700 * 0.3 / 35, "雪山 快"); near(hover.days[1], 900 * 0.3 / 25, "雪山 慢");
  assert.ok(hover.hours[0] > 0, "沙漠那段开车");
  assert.ok(hover.warn.some(w => w.includes("弃车徒步")));
  assert.match(hover.text, /开车 .*小时 \+ 弃车徒步 .*天/);
  assert.deepEqual(plain(c.worldTravel(r, "walk").days), [15, 20], "徒步直接用设定的天数");
});

test("暂定数据：太阳能板群（南 / 东）、第二↔第三采矿场；全地形车铺装路速度暂定", () => {
  const c = H.load();
  assert.ok(c.worldRoute("outer_city", "solar_c").tbd);
  const m = c.worldRoute("mine_2", "mine_3");
  assert.equal(m.legs.length, 1, "同一片矿区直接走便道，不绕回聚落边缘");
  assert.ok(m.tbd);
  const walk = c.worldTravel(m, "walk");
  near(walk.days[0], 20 / 35, "没有设定天数：按每天 25–35 km 算");
  assert.equal(c.worldTravel(c.worldRoute("outer_city", "starport"), "atv").tbd, true);
  assert.equal(c.worldTravel(c.worldRoute("outer_city", "ruins"), "atv").tbd, false);
});

test("走不了的：沙漠是泛指；同一地点是原地", () => {
  const c = H.load();
  const bad = c.worldRoute("desert", "casino");
  assert.equal(bad.ok, false);
  assert.match(bad.why, /泛指/);
  assert.equal(c.worldTravelPlan("desert", "casino").modes.length, 0);
  const same = c.worldRoute("casino", "casino");
  assert.ok(same.ok);
  assert.equal(c.worldTravel(same, "walk").text, "原地");
  assert.equal(c.worldRoute("casino", null).ok, false);
});

test("用时文字：不到 1 小时写分钟", () => {
  const c = H.load();
  assert.equal(c.travelTimeText({ days: [0, 0], hours: [0.2, 0.5] }), "约 10–30 分钟");
  assert.equal(c.travelTimeText({ days: [1, 1], hours: [0, 0] }), "约 1 天");
});

test("用时文字：开车开到一半要弃车，分开写；走好几天的路不写城里的几分钟", () => {
  const c = H.load();
  const r = c.worldRoute("outer_city", "north_zone");
  assert.match(c.worldTravel(r, "hover").text, /^约 开车 .+小时 \+ 弃车徒步 .+天$/);
  assert.equal(c.worldTravel(r, "walk").text, "约 15–20 天");
});
