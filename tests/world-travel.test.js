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
  assert.equal(m.legs.length, 1, "两座矿场之间直接走，不绕回聚落边缘");
  assert.ok(m.tbd);
  const walk = c.worldTravel(m, "walk");
  near(walk.days[0], 160 / 35, "没有设定天数：按每天 25–35 km 算");
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

/* ---------- 地图上任意两点：按透视倒推的估算 ---------- */
test("地图估算：设定表里确认过的地点，从城中心量过去正好是 9.6 km + 表里距离的中值", () => {
  const c = H.load();
  c.S.WORLD_TRAVEL_EDGES.filter(e => e.a === "rim" && !e.tbd).forEach(e => {
    const p = c.worldPlaceAnchor(e.b);
    const g = c.worldGround(p.x, p.y);
    near(Math.round((Math.hypot(g[0], g[1]) - 9.6) * 100) / 100, (e.km[0] + e.km[1]) / 2, e.b);
  });
  const g0 = c.worldGround(c.S.WORLD_GEO.center.x, c.S.WORLD_GEO.center.y);
  assert.ok(Math.hypot(g0[0], g0[1]) < 1e-6, "城中心是原点");
});

test("地图估算：太空里的点不算；城里、雪原、沙漠认得出来", () => {
  const c = H.load();
  assert.equal(c.worldTerrainAt(20, 8), "space");
  assert.equal(c.worldGround(20, 8), null);
  assert.equal(c.worldTerrainAt(60, 42), "city");
  assert.equal(c.worldTerrainAt(92, 10), "snow");
  assert.equal(c.worldTerrainAt(78, 70), "desert");
  const bad = c.worldEstimate({ x: 20, y: 8 }, "casino");
  assert.equal(bad.ok, false);
  assert.match(bad.why, /太空/);
});

test("地图估算：任意一点到任意一点给出路程范围和四种交通方式的用时；路况可选", () => {
  const c = H.load();
  const e = c.worldEstimate("mine_1", { x: 78, y: 70 });
  assert.ok(e.ok);
  assert.ok(e.straightKm > 5 && e.straightKm < 150, String(e.straightKm));
  assert.ok(e.km[0] < e.straightKm && e.km[1] > e.straightKm, "直线 ±12%");
  assert.equal(e.modes.length, 4);
  assert.ok(e.modes.find(m => m.mode === "car").warn.some(w => w.includes("陷车")), "默认沙地");
  const paved = c.worldEstimate("mine_1", { x: 78, y: 70 }, "paved");
  assert.equal(paved.modes.find(m => m.mode === "car").warn.length, 0);
  assert.ok(paved.modes[1].hours[1] < e.modes[1].hours[1], "铺装公路开车更快");
  assert.deepEqual(plain(paved.modes[0].days), plain(e.modes[0].days), "徒步不管路况");
});

test("地图估算：离城越远（同一个方向）越远；穿过城里那段按城内街道", () => {
  const c = H.load();
  const C = c.S.WORLD_GEO.center;
  [[1, 0], [-1, 0], [0, 1], [0.6, 0.8], [-0.6, 0.8]].forEach(([dx, dy]) => {
    let last = 0;
    for (let s = 1.1; s < 3; s += 0.2) {
      const x = C.x + dx * 17.5 * s, y = C.y + dy * 9.5 * s;
      if (x < 0 || x > 100 || y > 95) break;
      const g = c.worldGround(x, y);
      const r = Math.hypot(g[0], g[1]);
      assert.ok(r >= last - 2, `方向 ${dx},${dy} 在 ${s.toFixed(1)}：${r} < ${last}`);
      last = r;
    }
  });
  const gc = c.worldEstimate("giant_city", "outer_city");
  assert.ok(gc.straightKm > 7 && gc.straightKm < 10.5, "核心到外城区 ≈ 9 km：" + gc.straightKm);
  assert.equal(gc.route.legs.length, 1);
  assert.ok(gc.route.legs[0].road.city === 1);
  const cross = c.worldEstimate("power_plant", "mine_3");
  assert.ok(cross.cityKm > 3 && cross.cityKm <= 19.2, "从东穿城到西：" + cross.cityKm);
});

test("地图估算：极北禁区方向有一段雪原，车辆用不上", () => {
  const c = H.load();
  const e = c.worldEstimate("starport", "north_zone");
  assert.ok(e.snowShare > 0.1 && e.snowShare < 0.9, String(e.snowShare));
  assert.ok(e.modes.find(m => m.mode === "hover").warn.some(w => w.includes("弃车徒步")));
});
