/* 角鳞：四幕 · 单局数据（所有可调数值都在这里）
 *
 * rogue.js 只读这些表，不写死数字。调平衡、换设计只改这个文件：
 *   ROGUE_CONFIG      一局的节奏：幕数、天数、敌人等级曲线、区域、BOSS 池、时间消耗
 *   ROGUE_NODE_TYPES  任务里会遇到的节点种类（加一种节点：这里加一行 + rogue.js / rogue-ui.js 各加一个处理）
 *   ROGUE_TASKS       支线任务模板
 *   ROGUE_MAIN_TASK   主线任务模板（每幕开局自动接下）
 *   ROGUE_SHOP        商店卖什么、多少钱
 *   ROGUE_SMITH       工匠升级武器的费用
 *   ROGUE_LEVEL_REWARDS 升级时要做的选择（手册第三章）
 *
 * 注释里写「手册」的是照手册填的；写「占位」的是为了先跑通流程临时定的。
 */

const ROGUE_CONFIG = {
  acts: 4,                        // 正常流程的幕数
  extraActs: 2,                   // 通关后可以继续挑战的额外幕数
  daysPerAct: 8,                  // 已定（可能会改）：每幕 8 天
  restDays: 1,                    // 任务之间休整算几天
  sideTasksOnBoard: 2,            // 任务板上同时挂几个支线
  xpReqScale: 1 / 3,              // 已定（试行）：升级所需经验为原来的 1/3

  // 敌人等级：每幕从 [起, 止] 随本幕已用天数上涨，首领战用「止」。
  // 已定：正常流程最后到 15 级；额外幕到 20、25 级。中间的分段是占位。
  actLevels: [[1, 4], [5, 8], [9, 12], [12, 15]],
  extraActLevels: [[16, 20], [21, 25]],
  eliteLevelBonus: 1,             // 精英战比同时期的普通战斗高几级

  // 各幕所在区域（占位，之后会改）。额外幕依次沿用这张表。
  regions: ["外城区", "沙漠", "巨人城", "天网设施"],
  // 每个区域的轮换 BOSS 池（占位：目前只接入了 3 个 BOSS，没有 BOSS 的区域从全部 BOSS 里抽）
  bosses: {
    "外城区": ["outlaw_king"],
    "沙漠": ["sand_aggregate"],
    "巨人城": [],
    "天网设施": ["ufo_boss"]
  },

  // 时间（小时）：计入「距上次长休」，用来判力竭（手册：20/40/60/80 小时）
  hours: {
    travel: 3,          // 占位：每走到下一个节点
    shortRest: 1,       // 手册：短休 1 小时
    longRest: 8         // 手册：长休 8–12 小时，这里取 8
  },

  // 开局物资（占位）。水以毫升计，食物是手册里的四档
  start: {
    kuizhi: 3000,
    water: 6000,
    items: { food_liquid: 8, food_can: 2, repair_kit: 1, medkit: 1 }
  },

  // 主线：天数用完还没完成，本局结束
  mainDeadlineEndsRun: true,
  // 团灭：任何战斗团灭都直接结束本局（已定）
  wipeEndsRun: true,
  // 撤退：规则按手册（app.js · RETREAT_RULES）。撤退后这个战斗节点算跳过（没有奖励），任务继续。
  retreatSkipsNode: true,
  bossRetreat: false              // 首领战不能撤退
};

/* 节点种类。hours：这个节点本身花的时间（战斗按一场算）。 */
const ROGUE_NODE_TYPES = {
  battle: { label: "战斗",   hours: 2 },
  elite:  { label: "精英战", hours: 3, tokens: 5 },   // 5 枚代币的遭遇
  rest:   { label: "休息",   hours: 0 },               // 长休 / 短休的时间单独算
  shop:   { label: "商店",   hours: 1 },
  smith:  { label: "工匠",   hours: 1 }
};

/* 支线任务模板（文字与数值都是占位）
 *   nodes    节点数范围 [最少, 最多]
 *   mix      中间节点的抽取权重（最后一个节点固定是战斗，elite: true 则是精英战）
 *   days     需要几天
 *   diff     敌人等级额外 +几
 *   reward   完成奖励：奎支、每人经验
 *   supply   接任务时委托方提供的补给：水（毫升）、物品 */
const ROGUE_TASKS = [
  { kind: "clear",  name: "清剿", goal: "清掉盘踞在{region}的一伙敌人", nodes: [2, 3], days: 1, diff: 0,
    mix: { battle: 5, shop: 1 },
    reward: { kuizhi: 1500, xp: 15 }, supply: { water: 1000, items: { food_liquid: 2 } } },
  { kind: "escort", name: "护送", goal: "护送一批货穿过{region}", nodes: [3, 5], days: 2, diff: 0,
    mix: { battle: 4, rest: 2, shop: 1, smith: 1 },
    reward: { kuizhi: 3000, xp: 25 }, supply: { water: 3000, items: { food_liquid: 4 } } },
  { kind: "scout",  name: "侦察", goal: "摸清{region}深处的动静", nodes: [3, 4], days: 1, diff: 1,
    mix: { battle: 3, rest: 1, smith: 1 },
    reward: { kuizhi: 2000, xp: 20 }, supply: { water: 1500, items: { food_can: 2 } } },
  { kind: "bounty", name: "悬赏", goal: "在{region}找到并击败悬赏目标", nodes: [2, 3], days: 1, diff: 1, elite: true,
    mix: { battle: 3, shop: 1 },
    reward: { kuizhi: 3500, xp: 30 }, supply: { water: 1000, items: { food_liquid: 2 } } }
];

const ROGUE_MAIN_TASK = {
  kind: "main", name: "主线", goal: "在期限内完成本幕的关键目标。完成后进入幕末首领战；期限到了还没完成，本局结束。",
  nodes: [4, 5], days: 3, diff: 1, elite: true, key: true,
  mix: { battle: 4, rest: 2, shop: 1, smith: 1 },
  reward: { kuizhi: 5000, xp: 40 }, supply: { water: 4000, items: { food_liquid: 6 } }
};

/* 商店。价格照手册「常见物价」。give：water 是毫升；item 是背包物品 id（ITEM_CATALOG / 补给物品）。 */
const ROGUE_SHOP = [
  { key: "water_500",  name: "瓶装水 500 ml",  price: 600,  give: { water: 500 } },
  { key: "water_1000", name: "罐装水 1000 ml", price: 1000, give: { water: 1000 } },
  { key: "water_5000", name: "桶装水 5000 ml", price: 4000, give: { water: 5000 } },
  { key: "food_liquid",  price: 300,  give: { item: "food_liquid" } },
  { key: "food_can",     price: 500,  give: { item: "food_can" } },
  { key: "food_organic", price: 1000, give: { item: "food_organic" } },
  { key: "food_gourmet", price: 2000, give: { item: "food_gourmet" } },
  { key: "repair_kit",   price: 1000, give: { item: "repair_kit" } },
  { key: "sleepbag",     price: 800,  give: { item: "sleepbag" } },
  { key: "medkit",       price: 600,  give: { item: "medkit" } },
  { key: "clinic",       price: 1200, give: { item: "clinic" } },
  { key: "stim",         price: 1200, give: { item: "stim" } },
  { key: "steroid",      price: 1200, give: { item: "steroid" } },
  { key: "bomb_e",       price: 1000, give: { item: "bomb_e" } },
  { key: "bomb_a",       price: 1000, give: { item: "bomb_a" } },
  { key: "shockbomb",    price: 1200, give: { item: "shockbomb" } }
];

/* 工匠：升到某一级要花多少奎支。已定：单局里不要材料，只花钱。
 * 5–10 级照手册「参考费用」；2–4 级手册只写了材料，这里按材料基准价折算（金属 1000、精炼合金 5000），占位。 */
const ROGUE_SMITH = {
  maxLevel: 10,
  cost: { 2: 3000, 3: 6000, 4: 6000, 5: 8000, 6: 10000, 7: 12000, 8: 15000, 9: 17000, 10: 20000 }
};

/* 升级时要做的选择（手册第三章「升级时你会得到什么」）。
 * 角色卡上 minLv 的技能（lv2、lv11、lv17 的「一项技能」、效果位技能）到级自动解锁，不在这里。
 *   attr      可分配的六维属性点；noRepeat：不能加在之前加过的同一项上（lv8）
 *   role      职责技能二选一（lv5 副一/主二，lv10 主二/主三，lv15 主三/主四）
 *   note      系统还没做的奖励：先记在角色身上，等对应系统做好再兑现 */
const ROGUE_LEVEL_REWARDS = {
  3:  [{ type: "note", key: "proficiency", text: "一个自选熟练项" }],
  4:  [{ type: "attr" }],
  5:  [{ type: "role" }],
  7:  [{ type: "note", key: "proficiency", text: "一个自选熟练项" }],
  8:  [{ type: "attr", noRepeat: true }],
  9:  [{ type: "note", key: "feat", text: "一项专长" }],
  10: [{ type: "role" }],
  12: [{ type: "note", key: "proficiency", text: "一个自选熟练项" }],
  13: [{ type: "note", key: "feat", text: "一项专长" }],
  14: [{ type: "note", key: "lv14", text: "空手格挡成功率提高到 50%；自己回合内可用 1 行动点转化为 1 附赠动作" }],
  15: [{ type: "role" }],
  16: [{ type: "note", key: "feat", text: "一项专长" }],
  18: [{ type: "note", key: "proficiency", text: "一个自选熟练项" }],
  19: [{ type: "note", key: "feat", text: "一项专长" }],
  20: [{ type: "note", key: "ultimate", text: "强力终极技能" }]
};

const ATTR_NAMES = { str: "力量", con: "体质", dex: "敏捷", wil: "意志", int: "智力", sta: "耐力" };
