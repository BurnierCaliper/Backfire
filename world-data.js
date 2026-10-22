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

/* ===== 战斗所在的区域、场景、光影（只是画面用的标签：HD-2D 战场默认地台的地面、远景、灯、天空；不改任何结算） =====
 * BATTLE_REGIONS：战斗状态的 state.region 只认这里的区域名，联机白名单（online-view.js · projectState）也只放行这些。
 *   区域名用游戏里现成的：单局各幕 / 幕间改走的采矿场（rogue-data.js 的 regions / altRegions）、遭遇的 region。
 *   地图地点 id（跑团 LEDGER.place：mine_1、outer_city……）、地点名（天网塔）按上面的 WORLD_REGION_PLACE / WORLD_PLACES 对到区域；
 *   地图上别的地点（星际港口、极北禁区、太阳能板群……）不是区域，认不得。
 *   HD-2D 战场的地面主题表（hd2d/hd2d-layout.js 的 REGIONS / REGION_ALIAS）和这里一一对上（tests/region-light.test.js 核对）。 */
const BATTLE_REGIONS = ["外城区", "沙漠", "巨人城", "天网设施", "第一采矿场", "第二采矿场", "第三采矿场",
  "下水道"];   // 下水道：隶属巨人城的专门区域（run.js · SUB_REGIONS），狂鼠的遭遇带着这个区域名；地图上怎么进去另做，主持人也可以在战场配置里选
/** 区域名 / 地图地点 id / 地点名 → 区域名（BATTLE_REGIONS 里的）；认不得的返回 null */
function battleRegionName(x) {
  if (typeof x !== "string") return null;
  const s = x.trim();
  if (BATTLE_REGIONS.indexOf(s) >= 0) return s;
  const p = worldPlaceOf(s);
  return p ? BATTLE_REGIONS.find(r => (worldPlaceOf(r) || {}).id === p.id) || null : null;
}
/* 场景（issue #239）：同一个区域里画面完全不同的几个地方（也只是画面用的标签，不改任何结算；各场景的美术另做）。
 * BATTLE_SCENES：区域名（BATTLE_REGIONS 里的）→ 这个区域的场景 [{ id, name }]，第一个是跑团 / 战斗原型默认的场景。
 *   id 只要在同一个区域里不重复（三个采矿场都用 rim 矿外 / mid 矿内 / floor 矿底）；name 是战场配置下拉框里写的中文名。
 *   state.scene 只认当前区域的 id，联机白名单（online-view.js · projectState）也只放行这些。
 *   field：场上（棋盘上的区）有这种场地时固定用这个场景，画面和场地对得上（沙漠：有沙珊瑚台地 state.fields[z].coral → 沙珊瑚台地）。
 *   HD-2D 战场的地面主题表（hd2d/hd2d-layout.js 的 SCENES）和这里一一对上（tests/region-scene.test.js 核对）。 */
const BATTLE_SCENES = {
  "外城区": [{ id: "street", name: "街区" }],          // 外城区、巨人城、天网设施、下水道：暂时各只有一个场景，以后可以再加
  "沙漠": [{ id: "dune", name: "沙丘" }, { id: "coral", name: "沙珊瑚台地", field: "coral" }],
  "巨人城": [{ id: "city", name: "城区" }],
  "天网设施": [{ id: "facility", name: "设施" }],
  // 矿外：站在矿坑边缘的砂岩上；矿内：矿坑内部大约一半深度的矿道；矿底：矿坑底部。第二采矿场一样，色调更红
  "第一采矿场": [{ id: "rim", name: "矿外" }, { id: "mid", name: "矿内" }, { id: "floor", name: "矿底" }],
  "第二采矿场": [{ id: "rim", name: "矿外" }, { id: "mid", name: "矿内" }, { id: "floor", name: "矿底" }],
  "第三采矿场": [{ id: "rim", name: "矿外" }, { id: "floor", name: "矿底" }],   // 矿坑浅：没有矿内，矿内和矿底算一起
  "下水道": [{ id: "tunnel", name: "水道" }]
};
/** 这个区域的场景列表（区域名 / 地图地点 id 都认；认不得的区域 = 空） */
function battleScenes(region) {
  const r = battleRegionName(region);
  return r && Object.prototype.hasOwnProperty.call(BATTLE_SCENES, r) ? BATTLE_SCENES[r] : [];
}
/** 这个区域有的场景 id 原样返回；别的区域的、乱写的返回 null */
function battleSceneId(region, id) {
  return typeof id === "string" && battleScenes(region).some(s => s.id === id) ? id : null;
}
/** 场景的中文名（认不得的返回 null） */
function battleSceneName(region, id) {
  const s = battleScenes(region).find(x => x.id === id);
  return s ? s.name : null;
}
/** 这个区域默认的场景（主持人没选时用它）：场上有对应场地的（BATTLE_SCENES 的 field：沙漠的沙珊瑚台地）
 *  → 单局：开战时按这场战斗的种子抽的数（state.sceneRoll）在列表里挑 → 表里第一个（采矿场 = 矿外）。没有区域 = null */
function battleSceneAuto(region) {
  const list = battleScenes(region);
  if (!list.length) return null;
  const fields = state.fields || {}, zones = typeof boardZoneIds === "function" ? boardZoneIds() : Object.keys(fields);
  const onField = list.find(s => s.field && zones.some(z => !!(fields[z] && fields[z][s.field])));
  if (onField) return onField.id;
  const roll = state.sceneRoll;
  return (typeof roll === "number" && roll >= 0 && roll < 1 ? list[Math.floor(roll * list.length)] : list[0]).id;
}
/*   state.region      这场战斗在哪个区域（BATTLE_REGIONS 里的名字；没有 / 认不得 = null）
 *   state.scene       区域里的哪个场景（BATTLE_SCENES 里当前区域的 id；没有区域 = null）
 *   state.light       光影：day 白天 / dusk 傍晚 / night 夜晚（daylight.js · LIGHTS）
 *   state.regionMap   开战时从地图来的区域（主持人没选时用它）：
 *                       单局 = 这一幕的区域（Rogue.region(run)，单局的遭遇都带着它：rogue.js · battleSpec → spec.encounter.region）；
 *                       战斗原型 / 遭遇 = spec.region（遭遇表、随机遭遇的 region；BattleSim.setup 也可以直接给 region）；
 *                       跑团 = 队伍在地图上的地点（LEDGER.place → 区域）；地图上没标队伍的位置时用遭遇的 region
 *   state.sceneRoll   单局：开战时按这场战斗的种子抽的数（0–1，spec.sceneSeed；同一场战斗读档、重开都是同一个数），没选场景时按它在当前区域的场景里挑；
 *                     不是单局 = null（跑团 / 战斗原型没选时用表里第一个）。用自己的随机数（run.js · makeRng），不碰战斗用的随机流
 *   state.regionPick / state.scenePick / state.lightPick   主持人在战场配置里选的（null = 跟着地图 / 默认 / 跟着时钟）；每场开战清掉
 * 光影跟着时钟（ledger.js · clockLight，和规则的昼夜同一张表 daylight.js）、场景跟着场上的场地（沙珊瑚台地）：开战时、主持人改了以后、
 * 联机每次发包前（online-game.js）重算，推进时间、换了场地以后也跟着变。规则上的白天 / 夜晚（沙漠生物等）只看时钟，不看这里选的光影。 */
/** 开战时写进战斗状态（battle-commands.js · battle.setup、sim.js · BattleSim.setup 布置完调用）。
 *  spec.region = 这场的区域（遭遇 / 战斗原型）；spec.scene / spec.light = 布置时就定好的场景 / 光影（和主持人选的一样；场景这个区域没有的不认，
 *  不给就按默认 / 跟着时钟）；spec.sceneSeed = 单局抽场景用的种子（rogue.js · battleSpec：这场战斗的种子 + ":scene"） */
function battleLookStart(spec) {
  spec = spec || {};
  const placed = typeof TRPG !== "undefined" && TRPG.active && typeof LEDGER !== "undefined" && LEDGER.place;
  state.regionMap = battleRegionName(placed ? LEDGER.place : spec.region);
  state.regionPick = null;
  state.scenePick = battleSceneId(state.regionMap, spec.scene);
  // 单局抽场景：用种子单独起一个随机数（makeRng），不调 Math.random（开战时已经换成战斗的种子随机数），结算和不抽时一模一样
  state.sceneRoll = typeof spec.sceneSeed === "string" && spec.sceneSeed && typeof makeRng === "function" ? makeRng(spec.sceneSeed)() : null;
  state.lightPick = DayLight.LIGHTS.indexOf(spec.light) >= 0 ? spec.light : null;
  return battleLookSync();
}
/** 这场战斗的区域：主持人选的，没选就是地图来的 */
function battleLookRegion(pick) { return battleRegionName(pick) || battleRegionName(state.regionMap); }
/** 按主持人选的 / 地图 / 场上的场地 / 单局抽的数 / 当前时钟重算 state.region、state.scene、state.light */
function battleLookSync() {
  state.region = battleLookRegion(state.regionPick);
  state.scene = battleSceneId(state.region, state.scenePick) || battleSceneAuto(state.region);
  state.light = DayLight.LIGHTS.indexOf(state.lightPick) >= 0 ? state.lightPick : clockLight(clockNow());
  return { region: state.region, scene: state.scene, light: state.light };
}
/** 主持人在战场配置里改（battle-commands.js · battle.panel 的 setRegion / setScene / setLight）：
 *  patch.region = 区域名，"" = 跟着地图；patch.scene = （改完以后的）当前区域的场景 id，"" = 回到默认；
 *  patch.light = day / dusk / night，"" = 跟着时钟。认不得的值抛错，什么都不改。
 *  换了区域：主持人选的场景新区域也有就留着，没有就回到新区域默认的场景 */
function battleLookSet(patch) {
  patch = patch || {};
  const has = k => Object.prototype.hasOwnProperty.call(patch, k);
  if (has("region") && patch.region !== "" && BATTLE_REGIONS.indexOf(patch.region) < 0) throw new Error("认不得的区域：" + patch.region);
  const region = battleLookRegion(has("region") ? patch.region : state.regionPick);
  if (has("scene") && patch.scene !== "" && !battleSceneId(region, patch.scene)) throw new Error("认不得的场景：" + patch.scene);
  if (has("light") && patch.light !== "" && DayLight.LIGHTS.indexOf(patch.light) < 0) throw new Error("认不得的光影：" + patch.light);
  if (has("region")) state.regionPick = patch.region || null;
  if (has("scene")) state.scenePick = patch.scene || null;
  if (!battleSceneId(region, state.scenePick)) state.scenePick = null;
  if (has("light")) state.lightPick = patch.light || null;
  return battleLookSync();
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
