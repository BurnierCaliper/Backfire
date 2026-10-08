/* Antlerscale: Backfire · 角鳞星的路程与用时（跑团测距用；地图界面在 world-map.js）
 *
 * 地图是带透视的鸟瞰图，画面上的远近不等于真实距离，所以这里不量图，距离全部按设定写在表里：
 *   WORLD_TRAVEL_EDGES：路段。每段 { a, b, km: [最少, 最多], road: { 路况: 占比 }, walkDays?, walkKmh?, note?, tbd? }
 *     - 「rim」是聚落边缘（外城区外圈，出去就是沙漠）：城外地点的距离都从这里量（设定：起点按聚落边缘算）。
 *     - road 的路况：paved 铺装公路 / dirt 压实土路、矿区便道 / sand 松软沙地 / snow 雪山 / city 城内街道。
 *     - walkDays：设定里确认过的徒步天数（有就直接用，不按步速算）；walkKmh：城内步行（4–5 km/h，绕路系数 1.4）。
 *     - tbd: true = 暂定，还要和作者商讨（界面上会写「暂定」）。
 *   两地之间按路段连起来找最短路（Dijkstra，按距离中值），没有直达的就经由聚落边缘。
 *   WORLD_TRAVEL_MODES：交通方式和各路况的速度（km/h，[最慢, 最快]）。
 *
 * 设定依据（作者给的参考数据）：
 *   巨人城核心半径约 9.0 km，外城区是厚约 600 m 的环（外半径约 9.6 km）；外城区之外直接是沙漠。
 *   城内步行 4–5 km/h、绕路系数 1.4；沙漠徒步 25–35 km/天。磁悬浮地铁只在核心区、人类和类人不能坐。
 *   普通车容易陷沙（重量按 k³ 涨、接地面积按 k² 涨，接地压强是人类车辆的 4 倍）。雪山段车辆用不上，要弃车徒步。 */
"use strict";

const WORLD_TRAVEL = {
  walkKmPerDay: [25, 35],     // 城外徒步：每天走多远（含休息、找路）
  cityWalkKmh: [4, 5],        // 城内步行
  cityDetour: 1.4,            // 城内绕路系数
  rimName: "聚落边缘"
};

/** 路况的中文名 */
const WORLD_ROAD_NAME = { paved: "铺装公路", dirt: "压实土路 / 矿区便道", sand: "松软沙地", snow: "雪山", city: "城内街道" };

/** 交通方式。speed：各路况的速度 km/h [最慢, 最快]；不写的路况 = 走不了（要弃车步行那一段） */
const WORLD_TRAVEL_MODES = {
  walk: { name: "徒步", note: "城外按每天 25–35 km 算（设定里确认过天数的地点直接用设定的天数）" },
  car: { name: "巨人油车", note: "普通车，松软沙地上随时可能陷车",
    speed: { paved: [60, 70], city: [30, 40], dirt: [30, 40], sand: [10, 20] }, warn: { sand: "沙地上随时可能陷车" } },
  atv: { name: "全地形巡逻车", note: "铺装公路按普通车算（设定没写，暂定）",
    speed: { paved: [60, 70], city: [30, 40], dirt: [50, 60], sand: [40, 55] }, tbd: ["paved"] },
  hover: { name: "巡逻车·应急悬浮", note: "无视地形（雪山段除外：车辆用不上）",
    speed: { paved: [70, 90], city: [30, 40], dirt: [70, 90], sand: [70, 90] } }
};

/** 路段表。距离、天数按作者确认过的表；tbd 的是暂定值，待商讨 */
const WORLD_TRAVEL_EDGES = [
  // —— 城里 ——
  { a: "outer_city", b: "rim", km: [0, 0.6], road: { city: 1 }, walkKmh: true, note: "外城区就在聚落边缘（环厚约 600 m）" },
  { a: "giant_city", b: "outer_city", km: [9.0, 9.0], road: { city: 1 }, walkKmh: true,
    note: "核心区中心到外城区：半径约 9 km，按城内街道绕路系数 1.4 步行；磁悬浮只在核心区、人类和类人不能坐" },
  // —— 城外（从聚落边缘量）——
  { a: "rim", b: "starport", km: [15, 25], road: { paved: 1 }, walkDays: [0.5, 1], note: "有铺装路" },
  { a: "rim", b: "solar_w", km: [30, 50], road: { sand: 1 }, walkDays: [1, 2], note: "西侧太阳能板群，可当日往返", tbdRoad: true },
  { a: "rim", b: "mine_1", km: [40, 60], road: { paved: 1 }, walkDays: [1, 2], note: "有铺装路" },
  { a: "rim", b: "power_plant", km: [40, 60], road: { dirt: 1 }, walkDays: [1, 2], note: "能走到，但进不去", tbdRoad: true },
  { a: "rim", b: "casino", km: [50, 70], road: { paved: 1 }, walkDays: [1, 2], note: "有铺装路" },
  { a: "rim", b: "mine_2", km: [180, 220], road: { paved: 0.6, dirt: 0.4 }, walkDays: [3, 5], note: "公路加矿区便道，地形破碎", tbdRoad: true },
  { a: "rim", b: "mine_3", km: [180, 220], road: { paved: 0.6, dirt: 0.4 }, walkDays: [3, 5], note: "和第二采矿场同一片区域", tbdRoad: true },
  { a: "rim", b: "ruins", km: [250, 300], road: { sand: 1 }, walkDays: [6, 10], note: "无路" },
  { a: "rim", b: "skynet", km: [280, 320], road: { sand: 1 }, walkDays: [6, 10], note: "无路（沙漠塔）" },
  { a: "rim", b: "north_zone", km: [700, 900], road: { sand: 0.7, snow: 0.3 }, walkDays: [15, 20], note: "无路，沙漠转雪山；雪山段要弃车徒步", tbdRoad: true },
  // —— 暂定，待商讨 ——
  { a: "rim", b: "solar_c", km: [20, 40], road: { sand: 1 }, note: "南边的太阳能板群（距离暂定）", tbd: true },
  { a: "rim", b: "solar_e", km: [60, 80], road: { sand: 1 }, note: "东边的太阳能板群（距离暂定）", tbd: true },
  { a: "mine_2", b: "mine_3", km: [20, 40], road: { dirt: 1 }, note: "同一片矿区之间的便道（距离暂定）", tbd: true }
];

/* ---------- 找路 ---------- */
const mid = (r) => (Number(r[0]) + Number(r[1])) / 2;
function travelNodeName(id) {
  if (id === "rim") return WORLD_TRAVEL.rimName;
  const p = typeof worldPlace === "function" ? worldPlace(id) : null;
  return p ? p.name : id;
}
/** 能参与测距的地点（「沙漠」是泛指，没有固定距离） */
function travelPlaceIds() {
  const ids = new Set();
  WORLD_TRAVEL_EDGES.forEach(e => { ids.add(e.a); ids.add(e.b); });
  ids.delete("rim");
  return [...ids];
}
/** 从 from 到 to 的路线：{ ok, from, to, legs: [{ a, b, km, road, walkDays, walkKmh, note, tbd }], km: [lo, hi], tbd } */
function worldRoute(from, to) {
  if (!from || !to) return { ok: false, why: "要选起点和终点" };
  if (from === to) return { ok: true, from, to, legs: [], km: [0, 0], tbd: false };
  const nodes = new Set(["rim"].concat(travelPlaceIds()));
  if (!nodes.has(from)) return { ok: false, why: `${travelNodeName(from)}没有固定的距离（「沙漠」是泛指）` };
  if (!nodes.has(to)) return { ok: false, why: `${travelNodeName(to)}没有固定的距离（「沙漠」是泛指）` };
  const dist = {}, prev = {}, done = new Set();
  nodes.forEach(n => { dist[n] = Infinity; });
  dist[from] = 0;
  while (done.size < nodes.size) {
    let u = null;
    nodes.forEach(n => { if (!done.has(n) && (u == null || dist[n] < dist[u])) u = n; });
    if (u == null || dist[u] === Infinity) break;
    done.add(u);
    if (u === to) break;
    WORLD_TRAVEL_EDGES.forEach(e => {
      if (e.a !== u && e.b !== u) return;
      const v = e.a === u ? e.b : e.a;
      const d = dist[u] + mid(e.km);
      if (d < dist[v]) { dist[v] = d; prev[v] = { from: u, edge: e }; }
    });
  }
  if (dist[to] === Infinity) return { ok: false, why: "这两地之间没有路" };
  const legs = [];
  for (let n = to; n !== from; n = prev[n].from) {
    const e = prev[n].edge;
    legs.unshift(Object.assign({}, e, { a: prev[n].from, b: n }));
  }
  const km = legs.reduce((s, l) => [s[0] + l.km[0], s[1] + l.km[1]], [0, 0]);
  return { ok: true, from, to, legs, km: km.map(v => Math.round(v * 10) / 10), tbd: legs.some(l => l.tbd || l.tbdRoad) };
}

/* ---------- 用时 ---------- */
/** 一段路按某种交通方式要多久：{ hours: [lo, hi], days: [lo, hi], walkKm: [lo, hi], warn: [] } */
function legTravel(leg, modeId) {
  const out = { hours: [0, 0], days: [0, 0], warn: [], walkedKm: [0, 0] };
  const kmLo = leg.km[0], kmHi = leg.km[1];
  const road = leg.road || { sand: 1 };
  if (modeId === "walk") {
    if (leg.walkKmh || road.city) {
      const k = WORLD_TRAVEL.cityDetour, v = WORLD_TRAVEL.cityWalkKmh;
      out.hours = [kmLo * k / v[1], kmHi * k / v[0]];
    } else if (leg.walkDays) {
      out.days = leg.walkDays.slice();
    } else {
      const v = WORLD_TRAVEL.walkKmPerDay;
      out.days = [kmLo / v[1], kmHi / v[0]];
    }
    return out;
  }
  const M = WORLD_TRAVEL_MODES[modeId];
  Object.keys(road).forEach(r => {
    const share = Number(road[r]) || 0;
    if (!share) return;
    const sp = M.speed[r];
    if (!sp) {
      // 车开不了这段（雪山）：弃车徒步
      const v = WORLD_TRAVEL.walkKmPerDay;
      out.days[0] += kmLo * share / v[1];
      out.days[1] += kmHi * share / v[0];
      out.walkedKm[0] += kmLo * share; out.walkedKm[1] += kmHi * share;
      out.warn.push(`${WORLD_ROAD_NAME[r] || r}段车辆用不上，要弃车徒步`);
      return;
    }
    out.hours[0] += kmLo * share / sp[1];
    out.hours[1] += kmHi * share / sp[0];
    if (M.warn && M.warn[r]) out.warn.push(M.warn[r]);
  });
  return out;
}
/** 整条路线按某种交通方式：{ mode, name, hours: [lo, hi], days: [lo, hi], warn: [], text } */
function worldTravel(route, modeId) {
  const M = modeId === "walk" ? WORLD_TRAVEL_MODES.walk : WORLD_TRAVEL_MODES[modeId];
  if (!route || !route.ok || !M) return null;
  const t = { mode: modeId, name: M.name, hours: [0, 0], days: [0, 0], warn: [], tbd: !!(M.tbd && route.legs.some(l => M.tbd.some(r => (l.road || {})[r]))) };
  route.legs.forEach(l => {
    const r = legTravel(l, modeId);
    t.hours[0] += r.hours[0]; t.hours[1] += r.hours[1];
    t.days[0] += r.days[0]; t.days[1] += r.days[1];
    r.warn.forEach(w => { if (!t.warn.includes(w)) t.warn.push(w); });
  });
  t.text = travelTimeText(t);
  return t;
}
function roundTo(v, step) { return Math.round(v / step) * step; }
/** 「约 3–5 天」「约 1.5–2 小时」「约 0.5–1 天 + 2.5–3 小时」；车开到一半要弃车：「约 开车 9–16 小时 + 弃车徒步 6–11 天」 */
function travelTimeText(t) {
  const parts = [];
  const rng = (a, b, unit, step) => {
    const x = roundTo(a, step), y = roundTo(b, step);
    const f = (v) => String(Math.round(v * 10) / 10);
    return x === y ? `${f(x)} ${unit}` : `${f(x)}–${f(y)} ${unit}`;
  };
  const drive = t.mode && t.mode !== "walk";
  const hours = t.hours[1] <= 0 ? "" : t.hours[1] < 1 ? rng(t.hours[0] * 60, t.hours[1] * 60, "分钟", 5) : rng(t.hours[0], t.hours[1], "小时", 0.5);
  if (t.days[1] > 0) {
    if (drive && hours) return `约 开车 ${hours} + 弃车徒步 ${rng(t.days[0], t.days[1], "天", 0.5)}`;
    parts.push(rng(t.days[0], t.days[1], "天", 0.5));
    if (hours && t.hours[1] >= 1) parts.push(hours);   // 走好几天的路，城里那几分钟不写
  } else if (hours) parts.push(hours);
  return parts.length ? "约 " + parts.join(" + ") : "原地";
}
/** 测距：起点、终点 → 路线和每种交通方式的用时 */
function worldTravelPlan(from, to) {
  const route = worldRoute(from, to);
  if (!route.ok) return { route, modes: [] };
  return { route, modes: ["walk", "car", "atv", "hover"].map(m => worldTravel(route, m)) };
}
