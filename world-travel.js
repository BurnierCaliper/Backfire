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
  // —— 设定表里没有：按地图推算（下面的 worldEstimate），暂定，待商讨 ——
  { a: "rim", b: "solar_c", km: [25, 40], road: { sand: 1 }, note: "南边的太阳能板群（按地图推算，暂定）", tbd: true },
  { a: "rim", b: "solar_e", km: [85, 110], road: { sand: 1 }, note: "东边的太阳能板群（按地图推算，暂定）", tbd: true },
  { a: "mine_2", b: "mine_3", km: [160, 200], road: { dirt: 1 }, note: "两座矿场之间直接走（按地图推算，暂定）", tbd: true }
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

/* ---------- 地图上任意两点：按透视倒推的地面距离（粗估） ----------
 * 地图是带透视、而且不按比例画的鸟瞰图（巨人城画得特别大，西边被拉得很远），没法用一个简单的透视公式还原。
 * 所以倒过来做：把设定表里确认过的距离当「控制点」——
 *   · 巨人城中心 = 地面原点；外城区外圈（图上的椭圆）= 半径 9.6 km 的圆；
 *   · 每个地点：方向按图上相对城中心的方向（竖直方向乘透视系数还原成俯视），离城中心 = 9.6 km + 表里距离的中值；
 *   · 地平线附近（星球边缘）当作约 700 km 外；城北巨塔那片空档补几个点，免得插值在那里往回折。
 * 再用薄板样条（thin-plate spline）把图上坐标插值成地面坐标（km），任意两点的直线距离就是地面坐标的距离。
 * 在控制点上和设定表完全一致，其他地方是平滑插值，误差可能有两三成：给主持人估时间用。 */
const WORLD_GEO = {
  center: { x: 60.2, y: 42 },      // 巨人城中心（图上 %）
  ring: { a: 17.5, b: 9.5 },       // 外城区外圈在图上的椭圆半轴（%）
  tilt: 1.84,                      // 竖直方向的透视压缩：图上竖着 1% 约等于横着 1.84%
  ringKm: 9.6,                     // 外城区外半径
  // 额外的控制点 [x, y, 离聚落边缘的 km]：城北巨塔挡住的空档、地平线
  extra: [[54, 25, 8], [60.2, 25, 8], [66, 25, 9],
    [4, 42, 700], [15, 33, 700], [25, 24.5, 700], [35, 18, 700], [45, 11.5, 700], [55, 7, 700], [65, 3, 700]],
  // 星球边缘（地平线）：图上这条线以上是太空
  limb: [[0, 43.6], [10, 35], [20, 27], [30, 19], [40, 12.8], [50, 8], [60, 3.7], [70, 0.5], [75, -1], [100, -1]],
  // 雪原：x ≥ 68 且在这条线以上
  snow: [[68, 0], [72, 11], [80, 17], [90, 21], [100, 22]],
  // 估算路程的上下浮动（直线 → 实际要走的路）
  spread: [0.88, 1.12]
};
/** 每个地点在图上当作哪一点（巨人城的图钉画在塔尖上，量距离用城中心） */
function worldPlaceAnchor(id) {
  const G = WORLD_GEO;
  if (id === "giant_city") return { x: G.center.x, y: G.center.y };
  const p = typeof worldPlace === "function" ? worldPlace(id) : null;
  if (!p) return null;
  if (id === "outer_city") {
    // 外城区的图钉在环里面：量距离时放到外圈上（外城区就在聚落边缘）
    const e = Math.hypot((p.x - G.center.x) / G.ring.a, (p.y - G.center.y) / G.ring.b) / 0.97;
    return { x: G.center.x + (p.x - G.center.x) / e, y: G.center.y + (p.y - G.center.y) / e };
  }
  return { x: p.x, y: p.y };
}
function lerpLine(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return pts[pts.length - 1][1];
}
/** 图上这一点是什么地方：space 太空 / city 城里（外城区外圈以内）/ snow 雪原 / desert 沙漠 */
function worldTerrainAt(x, y) {
  const G = WORLD_GEO;
  if (y < lerpLine(G.limb, x)) return "space";
  if (Math.hypot((x - G.center.x) / G.ring.a, (y - G.center.y) / G.ring.b) <= 1) return "city";
  if (x >= G.snow[0][0] && y < lerpLine(G.snow, x)) return "snow";
  return "desert";
}
let worldGeoFit = null;
function worldGeoModel() {
  if (worldGeoFit) return worldGeoFit;
  const G = WORLD_GEO, R = G.ringKm;
  const norm = (x, y) => [x - G.center.x, (y - G.center.y) * G.tilt];
  const ctrl = [{ p: [0, 0], g: [0, 0] }];
  const at = (x, y, r) => { const p = norm(x, y), l = Math.hypot(p[0], p[1]); ctrl.push({ p, g: [p[0] / l * r, p[1] / l * r] }); };
  for (let i = 0; i < 16; i++) { const t = i / 16 * 2 * Math.PI; at(G.center.x + G.ring.a * Math.cos(t), G.center.y + G.ring.b * Math.sin(t), R); }
  // 设定表里确认过的、从聚落边缘量的距离（暂定的不算）
  WORLD_TRAVEL_EDGES.forEach(e => {
    if (e.a !== "rim" || e.tbd) return;
    const q = worldPlaceAnchor(e.b);
    if (q) at(q.x, q.y, R + mid(e.km));
  });
  G.extra.forEach(([x, y, km]) => at(x, y, R + km));
  const U = (r) => r < 1e-9 ? 0 : r * r * Math.log(r);
  const n = ctrl.length, N = n + 3;
  const M = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) M[i][j] = U(Math.hypot(ctrl[i].p[0] - ctrl[j].p[0], ctrl[i].p[1] - ctrl[j].p[1]));
    M[i][n] = M[n][i] = 1;
    M[i][n + 1] = M[n + 1][i] = ctrl[i].p[0];
    M[i][n + 2] = M[n + 2][i] = ctrl[i].p[1];
  }
  const solve = (rhs) => {
    const A = M.map((r, i) => r.concat([rhs[i]]));
    for (let c = 0; c < N; c++) {
      let piv = c;
      for (let r = c + 1; r < N; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]];
      for (let r = 0; r < N; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= N; k++) A[r][k] -= f * A[c][k]; }
    }
    return A.map((r, i) => r[N] / r[i]);
  };
  const wx = solve(ctrl.map(c => c.g[0]).concat([0, 0, 0]));
  const wy = solve(ctrl.map(c => c.g[1]).concat([0, 0, 0]));
  const evalAt = (w, p) => { let s = w[n] + w[n + 1] * p[0] + w[n + 2] * p[1]; for (let i = 0; i < n; i++) s += w[i] * U(Math.hypot(p[0] - ctrl[i].p[0], p[1] - ctrl[i].p[1])); return s; };
  worldGeoFit = (x, y) => { const p = norm(x, y); return [evalAt(wx, p), evalAt(wy, p)]; };
  return worldGeoFit;
}
/** 图上一点（%）→ 地面坐标（km，以巨人城中心为原点）；太空里的点返回 null */
function worldGround(x, y) {
  if (worldTerrainAt(x, y) === "space") return null;
  return worldGeoModel()(x, y);
}
/** 测距的端点：地点 id 或 { x, y } → 图上坐标 */
function worldEndpointXY(e) {
  if (!e) return null;
  if (typeof e === "string") return worldPlaceAnchor(e);
  const x = Number(e.x), y = Number(e.y);
  return isFinite(x) && isFinite(y) ? { x, y } : null;
}
/** 线段 a→b 在以原点为圆心、半径 r 的圆里的那段长度 */
function chordInCircle(a, b, r) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const A = dx * dx + dy * dy;
  if (A < 1e-12) return 0;
  const B = 2 * (a[0] * dx + a[1] * dy), C = a[0] * a[0] + a[1] * a[1] - r * r;
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return 0;
  const t0 = Math.max(0, (-B - Math.sqrt(disc)) / (2 * A)), t1 = Math.min(1, (-B + Math.sqrt(disc)) / (2 * A));
  return t1 > t0 ? (t1 - t0) * Math.sqrt(A) : 0;
}
/** 地图估算：两点直线（越野）的路程和用时。terrain：城外不是雪原的部分按什么路况（默认 sand 松软沙地）
 *  返回 { ok, why?, straightKm, km: [lo, hi], cityKm, snowShare, route（和 worldRoute 一样的格式）, modes } */
function worldEstimate(a, b, terrain) {
  const A = worldEndpointXY(a), B = worldEndpointXY(b);
  if (!A || !B) return { ok: false, why: "要选起点和终点", modes: [] };
  if (worldTerrainAt(A.x, A.y) === "space" || worldTerrainAt(B.x, B.y) === "space") return { ok: false, why: "那里是太空，选星球表面上的点", modes: [] };
  const f = worldGeoModel();
  const gA = f(A.x, A.y), gB = f(B.x, B.y);
  const straight = Math.hypot(gA[0] - gB[0], gA[1] - gB[1]);
  // 沿图上的连线取样：按地面长度算城里、雪原各占多少
  const STEPS = 80;
  let total = 0, snow = 0, prev = gA;   // 雪原占比按沿途取样（地面长度加权）
  for (let i = 1; i <= STEPS; i++) {
    const t = (i - 0.5) / STEPS, t1 = i / STEPS;
    const g = f(A.x + (B.x - A.x) * t1, A.y + (B.y - A.y) * t1);
    const d = Math.hypot(g[0] - prev[0], g[1] - prev[1]);
    prev = g; total += d;
    const kind = worldTerrainAt(A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t);
    if (kind === "snow") snow += d;
  }
  // 城里那段：地面上直线穿过外城区外圈（半径 9.6 km 的圆）的弦长
  const cityKm = Math.round(chordInCircle(gA, gB, WORLD_GEO.ringKm) * 10) / 10;
  const outKm = straight - cityKm;
  const snowShare = outKm > 0 && total > 0 ? Math.min(1, snow / total) : 0;
  const road = WORLD_ROAD_NAME[terrain] && terrain !== "city" && terrain !== "snow" ? terrain : "sand";
  const legs = [];
  if (cityKm > 0.05) legs.push({ a: "city", b: "city", km: [cityKm, cityKm], road: { city: 1 }, walkKmh: true, note: "城里那段按城内街道算" });
  if (outKm > 0.05) {
    const r = {};
    if (snowShare < 0.999) r[road] = Math.round((1 - snowShare) * 100) / 100;
    if (snowShare > 0.001) r.snow = Math.round((1 - (r[road] || 0)) * 100) / 100;
    legs.push({ a: "out", b: "out", km: WORLD_GEO.spread.map(k => Math.round(outKm * k * 10) / 10), road: r, note: "直线越野，按地图粗估" });
  }
  const km = legs.reduce((s, l) => [s[0] + l.km[0], s[1] + l.km[1]], [0, 0]).map(v => Math.round(v * 10) / 10);
  const route = { ok: true, from: a, to: b, legs, km, tbd: false, estimate: true };
  return { ok: true, straightKm: Math.round(straight * 10) / 10, km, cityKm, snowShare, terrain: road, route,
    modes: legs.length ? ["walk", "car", "atv", "hover"].map(m => worldTravel(route, m)) : [] };
}
