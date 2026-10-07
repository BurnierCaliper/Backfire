/* Antlerscale: Backfire · 角鳞星地图的地点（world-map.js 画地图，这里只放数据和规则）
 *
 * WORLD_PLACES：地图上的地点。x / y 是在地图图片（art/world-map.webp）上的位置，按百分比（0–100）。
 *   desc 是一句话简介（先按地图画面写的占位，设定定了再改）。
 * WORLD_REGION_PLACE：游戏里用的区域名（单局各幕的区域、遭遇的区域）→ 地图上的地点。
 * 当前位置：单局 = 这一幕的区域；跑团 = 主持人在地图上设的（LEDGER.place，跟着存档走）。
 *   跑团的标记可以拖到地图上任何位置：LEDGER.placePos = { x, y }（百分比），LEDGER.place 记最近的地点（「××附近」）。 */
"use strict";

const WORLD_MAP_IMAGE = "art/world-map.webp";
const WORLD_PLACES = [
  { id: "giant_city",   name: "巨人城",     x: 60.6, y: 31.0, desc: "角鳞星最大的城市，高楼和尖塔围着中央的巨塔。" },
  { id: "outer_city",   name: "外城区",     x: 69.6, y: 45.5, desc: "环绕巨人城的外圈街区，低矮的房屋一层层铺开。" },
  { id: "starport",     name: "星际港口",   x: 57.0, y: 17.2, desc: "巨人城北边的港口，起降往来星外的船。" },
  { id: "north_zone",   name: "极北禁区",   x: 83.0, y: 10.5, desc: "北方冰原上被环形高墙围起来的禁区。" },
  { id: "power_plant",  name: "发电厂",     x: 83.6, y: 35.0, desc: "冒着浓烟的发电厂。" },
  { id: "casino",       name: "沙穹赌场",   x: 86.0, y: 51.5, desc: "金色玻璃穹顶下的赌场。" },
  { id: "mine_3",       name: "第三采矿场", x: 32.4, y: 47.0, desc: "闪着紫色晶光的矿场。" },
  { id: "ruins",        name: "遗迹",       x: 13.4, y: 48.0, desc: "沙海里残存的古老建筑。" },
  { id: "skynet",       name: "天网塔",     x: 8.6,  y: 68.0, desc: "孤零零立在沙漠里的高塔，天网设施所在。" },
  { id: "mine_2",       name: "第二采矿场", x: 35.8, y: 77.0, desc: "熔岩翻涌的矿场。" },
  { id: "mine_1",       name: "第一采矿场", x: 66.4, y: 80.0, desc: "地面上挖出的巨大露天矿坑。" },
  { id: "solar_w",      name: "太阳能板群", x: 40.6, y: 58.0, desc: "成片的太阳能板。" },
  { id: "solar_c",      name: "太阳能板群", x: 52.8, y: 64.0, desc: "成片的太阳能板。" },
  { id: "solar_e",      name: "太阳能板群", x: 90.4, y: 67.2, desc: "成片的太阳能板。" },
  { id: "desert",       name: "沙漠",       x: 84.0, y: 84.0, desc: "包围一切的无边沙海。" }
];
const WORLD_REGION_PLACE = {
  "外城区": "outer_city",
  "沙漠": "desert",
  "巨人城": "giant_city",
  "天网设施": "skynet",
  "天网塔": "skynet"
};

function worldPlace(id) { return WORLD_PLACES.find(p => p.id === id) || null; }
/** 游戏里的区域名 / 地点 id → 地点（不认识的返回 null） */
function worldPlaceOf(regionOrId) {
  if (!regionOrId) return null;
  return worldPlace(WORLD_REGION_PLACE[regionOrId] || regionOrId) ||
    WORLD_PLACES.find(p => p.name === regionOrId) || null;
}

/** 离 (x, y) 最近的地点（按地图图片上的实际距离算） */
function worldNearestPlace(x, y) {
  let best = null, bd = Infinity;
  WORLD_PLACES.forEach(p => {
    const d = Math.hypot((p.x - x) * 1672 / 100, (p.y - y) * 941 / 100);
    if (d < bd) { bd = d; best = p; }
  });
  return best ? { place: best, dist: bd } : null;
}
/** 跑团：主持人把队伍移到某个地点（id 为空 = 不显示位置）。
 *  带 x / y（0–100）= 标记拖到了地图上任意位置，id 是最近的地点，显示成「××附近」 */
function trpgSetPlace(id, x, y) {
  if (id && !worldPlace(id)) throw new Error("地图上没有这个地点：" + id);
  const free = id && x != null && y != null;
  if (free && !([x, y].every(v => isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100))) throw new Error("地图坐标要在 0–100 之间");
  const before = worldPlace(LEDGER.place);
  LEDGER.place = id || null;
  LEDGER.placePos = free ? { x: Math.round(Number(x) * 10) / 10, y: Math.round(Number(y) * 10) / 10 } : null;
  const now = worldPlace(LEDGER.place);
  const note = now ? `队伍移动到 ${now.name}${free ? " 附近" : ""}${before && before.id !== now.id ? `（之前在 ${before.name}）` : ""}。` : "地图上不再标出队伍的位置。";
  if (typeof appendLog === "function") appendLog(note);
  return [note];
}
