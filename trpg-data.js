/* 角鳞 · 手册里的物价、材料、武器升级表（跑团模式照这个；单局在 rogue-data.js 里另外折算）
 *
 *   HANDBOOK_MATERIALS       材料和价格
 *   HANDBOOK_WEAPON_UPGRADE  武器升级表：每级要的材料、工匠的参考费用
 *   HANDBOOK_SHOP            物品表（商店）：分组、价格、买到什么
 *
 * 数字照作者给的物品表 / 武器升级表。改价格只改这里。 */

const HANDBOOK_MATERIALS = {
  metal:   { name: "金属",     price: 1000 },
  alloy:   { name: "精炼合金", price: 5000 },
  polymer: { name: "聚合材料", price: 10000 },
  crystal: { name: "稀有晶体", price: 50000,  note: "黑市售价" },
  heart:   { name: "赫心结晶", price: 100000, note: "黑市售价" }
};

/* 升级武器需要找到工作站。4 级以上无法靠自己升级，要找专门的武器工匠：材料 + 加工费。
 * labor 是设定里「××奎支上下」的参考费用；不同工匠的费用要求不一样，主持人按剧情改。 */
const HANDBOOK_WEAPON_UPGRADE = {
  maxLevel: 10,
  selfMaxLevel: 4,
  recipe: {
    2:  { mats: { metal: 3 } },
    3:  { mats: { metal: 6 } },
    4:  { mats: { alloy: 1, metal: 1 } },
    5:  { mats: { alloy: 2, metal: 2 },     labor: 8000 },
    6:  { mats: { polymer: 1, alloy: 3 },   labor: 10000 },
    7:  { mats: { polymer: 2, alloy: 3 },   labor: 12000 },
    8:  { mats: { crystal: 1, polymer: 3 }, labor: 15000 },
    9:  { mats: { crystal: 2, polymer: 3 }, labor: 17000 },
    10: { mats: { heart: 1, crystal: 3 },   labor: 20000 }
  }
};

/* 物品表。give：water 毫升；item 背包物品 id。
 * 没有战斗效果的东西（照明、绳子、衣服、携讯机、地图……）也放进背包，只记数量，用途由主持人裁定。 */
const HANDBOOK_SHOP = [
  { group: "水与食物", key: "water_500",  name: "瓶装水 500 ml",  price: 600,  give: { water: 500 } },
  { group: "水与食物", key: "water_1000", name: "罐装水 1000 ml", price: 1000, give: { water: 1000 } },
  { group: "水与食物", key: "water_5000", name: "桶装水 5000 ml", price: 4000, give: { water: 5000 } },
  { group: "水与食物", key: "food_liquid",  price: 300,  give: { item: "food_liquid" } },
  { group: "水与食物", key: "food_can",     price: 500,  give: { item: "food_can" } },
  { group: "水与食物", key: "food_organic", price: 1000, give: { item: "food_organic" } },
  { group: "水与食物", key: "food_gourmet", price: 2000, give: { item: "food_gourmet" } },
  { group: "医疗与战斗", key: "medkit",    price: 600,  give: { item: "medkit" } },
  { group: "医疗与战斗", key: "clinic",    price: 1200, give: { item: "clinic" } },
  { group: "医疗与战斗", key: "stim",      price: 1200, give: { item: "stim" },    note: "黑市货" },
  { group: "医疗与战斗", key: "steroid",   price: 1200, give: { item: "steroid" }, note: "黑市货" },
  { group: "医疗与战斗", key: "bomb_e",    price: 1000, give: { item: "bomb_e" } },
  { group: "医疗与战斗", key: "bomb_a",    price: 1000, give: { item: "bomb_a" } },
  { group: "医疗与战斗", key: "shockbomb", price: 1200, give: { item: "shockbomb" } },
  { group: "工具与杂物", key: "repair_kit", price: 1000, give: { item: "repair_kit" } },
  { group: "工具与杂物", key: "sleepbag",   price: 800,  give: { item: "sleepbag" } },
  { group: "工具与杂物", key: "lamp",       price: 800,  give: { item: "lamp" } },
  { group: "工具与杂物", key: "flashlight", price: 800,  give: { item: "flashlight" } },
  { group: "工具与杂物", key: "rope",       price: 500,  give: { item: "rope" } },
  { group: "工具与杂物", key: "cracker",    price: 2000, give: { item: "cracker" } },
  { group: "工具与杂物", key: "lockpick",   price: 800,  give: { item: "lockpick" } },
  { group: "服装", key: "cloth_worn",  price: 600,  give: { item: "cloth_worn" } },
  { group: "服装", key: "cloth_work",  price: 800,  give: { item: "cloth_work" } },
  { group: "服装", key: "cloth_used",  price: 1000, give: { item: "cloth_used" } },
  { group: "服装", key: "cloth_new",   price: 1500, give: { item: "cloth_new" } },
  { group: "服装", key: "cloth_fancy", price: 6000, give: { item: "cloth_fancy" }, note: "6000 起" },
  { group: "携讯机与植入体", key: "comm_low_used", price: 1500,  give: { item: "comm_low_used" } },
  { group: "携讯机与植入体", key: "comm_low",      price: 3000,  give: { item: "comm_low" } },
  { group: "携讯机与植入体", key: "comm_mid_used", price: 6000,  give: { item: "comm_mid_used" } },
  { group: "携讯机与植入体", key: "comm_mid",      price: 8000,  give: { item: "comm_mid" } },
  { group: "携讯机与植入体", key: "comm_high",     price: 20000, give: { item: "comm_high" } },
  { group: "携讯机与植入体", key: "implant_basic", price: 15000, give: { item: "implant_basic" } },
  { group: "携讯机与植入体", key: "implant_adv",   price: 50000, give: { item: "implant_adv" } },
  { group: "地图与票券", key: "map_outer",      price: 1000,  give: { item: "map_outer" } },
  { group: "地图与票券", key: "map_desert",     price: 2000,  give: { item: "map_desert" } },
  { group: "地图与票券", key: "map_pipeline",   price: 5000,  give: { item: "map_pipeline" } },
  { group: "地图与票券", key: "map_mine1",      price: 8000,  give: { item: "map_mine1" } },
  { group: "地图与票券", key: "map_mine2",      price: 10000, give: { item: "map_mine2" } },
  { group: "地图与票券", key: "map_mine3",      price: 10000, give: { item: "map_mine3" } },
  { group: "地图与票券", key: "map_sewage",     price: 10000, give: { item: "map_sewage" } },
  { group: "地图与票券", key: "map_giant",      price: 5000,  give: { item: "map_giant" } },
  { group: "地图与票券", key: "map_giant_full", price: 15000, give: { item: "map_giant_full" } },
  { group: "地图与票券", key: "ticket_dome",    price: 5000,  give: { item: "ticket_dome" } },
  { group: "材料", key: "mat_metal",   price: 1000,   give: { item: "mat_metal" } },
  { group: "材料", key: "mat_alloy",   price: 5000,   give: { item: "mat_alloy" } },
  { group: "材料", key: "mat_polymer", price: 10000,  give: { item: "mat_polymer" } },
  { group: "材料", key: "mat_crystal", price: 50000,  give: { item: "mat_crystal" }, note: "黑市售价" },
  { group: "材料", key: "mat_heart",   price: 100000, give: { item: "mat_heart" },   note: "黑市售价" }
];

/* 没有战斗效果的物品，登记进背包物品表（ITEM_CATALOG，items.js） */
const HANDBOOK_GOODS = {
  lamp:           { name: "提灯",       hint: "在暗处可以照明" },
  flashlight:     { name: "手电筒",     hint: "可以照明" },
  rope:           { name: "绳子 10m",   hint: "各种用途" },
  cracker:        { name: "破解器",     hint: "可以破解低级的电子锁" },
  lockpick:       { name: "撬锁器",     hint: "可以撬些锁" },
  cloth_worn:     { name: "破旧的服装", hint: "" },
  cloth_work:     { name: "工作服",     hint: "" },
  cloth_used:     { name: "普通的服装（二手）", hint: "" },
  cloth_new:      { name: "崭新的服装", hint: "" },
  cloth_fancy:    { name: "华丽的服装", hint: "" },
  comm_low_used:  { name: "二手低级携讯机", hint: "状况没有保证" },
  comm_low:       { name: "低级携讯机", hint: "有基本的功能" },
  comm_mid_used:  { name: "二手中级携讯机", hint: "" },
  comm_mid:       { name: "中级携讯机", hint: "" },
  comm_high:      { name: "高级携讯机", hint: "" },
  implant_basic:  { name: "植入体基础款", hint: "" },
  implant_adv:    { name: "植入体高级款", hint: "" },
  map_outer:      { name: "外城区地图", hint: "" },
  map_desert:     { name: "沙漠地图", hint: "" },
  map_pipeline:   { name: "沙漠地下输油管路线图", hint: "" },
  map_mine1:      { name: "第一采矿区地图", hint: "" },
  map_mine2:      { name: "第二采矿区地图", hint: "" },
  map_mine3:      { name: "第三采矿区地图", hint: "只有大致情况" },
  map_sewage:     { name: "污水处理厂地图", hint: "" },
  map_giant:      { name: "巨人城市地图", hint: "" },
  map_giant_full: { name: "巨人城市详尽地图", hint: "" },
  ticket_dome:    { name: "沙穹入场券", hint: "" },
  mat_metal:      { name: "金属",     hint: "武器升级材料", material: "metal" },
  mat_alloy:      { name: "精炼合金", hint: "武器升级材料", material: "alloy" },
  mat_polymer:    { name: "聚合材料", hint: "武器升级材料", material: "polymer" },
  mat_crystal:    { name: "稀有晶体", hint: "武器升级材料", material: "crystal" },
  mat_heart:      { name: "赫心结晶", hint: "武器升级材料", material: "heart" }
};
(function registerGoods() {
  if (typeof ITEM_CATALOG === "undefined") return;
  Object.keys(HANDBOOK_GOODS).forEach(id => {
    if (!ITEM_CATALOG[id]) ITEM_CATALOG[id] = Object.assign({ goods: true }, HANDBOOK_GOODS[id]);
  });
})();
