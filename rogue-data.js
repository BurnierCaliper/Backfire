/* 角鳞：四幕 · 单局数据（所有可调数值都在这里）
 *
 * rogue.js 只读这些表，不写死数字。调平衡、换设计只改这个文件：
 *   ROGUE_CONFIG      一局的节奏：幕数、天数、敌人等级曲线、区域、BOSS 池、时间消耗
 *   ROGUE_BATTLEFIELD 战场上的随机配置物与地形（越往后越常见）
 *   ROGUE_TASK_WEATHER 带天气的任务
 *   ROGUE_NODE_TYPES  任务里会遇到的节点种类（加一种节点：这里加一行 + rogue.js / rogue-ui.js 各加一个处理）
 *   ROGUE_CHECKS      熟练项检定事件：难度、奖励、受伤
 *   ROGUE_SOLO        单人模式：行动点、支援系统、第二副职责、额外成长
 *   ROGUE_TASKS       支线任务模板
 *   ROGUE_MAIN_TASK   主线任务模板（每幕开局自动接下）
 *   ROGUE_SHOP        商店卖什么、多少钱
 *   ROGUE_MATERIALS   材料价格（物品表）
 *   ROGUE_SMITH       武器升级表：每级要的材料和加工费
 *   ROGUE_SMITHS      工匠名单与各自的客制化图纸（ROGUE_SMITH_RULES：出现几位、几次解锁图纸、安装价）
 *   ROGUE_CLINIC      诊所治疗与义体改造的价格
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

  // 敌人等级：每幕从 [起, 止] 随本幕已用天数上涨，首领战见下面 bossLevelOffset。
  // 已定：正常流程最后到 15 级；额外幕到 20、25 级。中间的分段是占位。
  actLevels: [[1, 4], [5, 8], [9, 12], [12, 15]],
  extraActLevels: [[16, 20], [21, 25]],
  eliteLevelBonus: 1,             // 精英战比同时期的普通战斗高几级
  // 首领战。首领等级 = 本幕「止」+ bossLevelOffset；bossEscortTokens：随从按代币抽的首领用几枚
  // （亡命之王的随从是手册写死的，不看这个）。
  // 之前首领难是因为亡命之王被误设成一回合三动；改回一动之后，朴素打法验算（首领前约 5–6 级）
  // 用本幕上限等级：4 人队胜率约 96%，3 人队约 75%。所以等级偏移回到 0，留着这个旋钮以后调。
  bossLevelOffset: 0,
  bossEscortTokens: 1,

  // 各幕所在区域（占位，之后会改）。额外幕依次沿用这张表。
  regions: ["外城区", "沙漠", "巨人城", "天网设施"],
  // 每个区域的轮换 BOSS 池（占位：目前只接入了 3 个 BOSS，没有 BOSS 的区域从全部 BOSS 里抽）
  bosses: {
    "外城区": ["outlaw_king"],
    "沙漠": ["sand_aggregate"],
    "巨人城": [],
    "天网设施": ["ufo_boss"]
  },

  // 休息点不休息、直接离开：省下的时间换成一笔奎支（打零工 / 捡到的东西）
  restSkipKuizhi: 250,

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
  /* ---------- 经济（验算工具：node tools/economy.js） ---------- */
  // 任务之间的休整等于回到城里：可以买补给、用维修工具包（已定）
  campShop: true,
  // 任务报酬（奎支）与委托方补给按人数给（已定）。模板里的数字是 perHeadBase 人队的量，
  // 实际 = 模板 × 队伍人数 / perHeadBase。经验本来就是每人一份，不受影响。
  perHeadBase: 2,
  // 任务奎支报酬随幕数上涨（已定方向，倍率占位，刻意克制）。额外幕接着往后排
  rewardActScale: [1, 1.2, 1.4, 1.6, 1.8, 2.0],
  // 工匠费用 = (材料按物品表折价 + 加工费) × 这个倍率（已定：单局里便宜很多，先试 1/6），按 100 取整。见 ROGUE_SMITH
  smithPriceScale: 1 / 6,
  // ARMS 成员身份（特蕾莎 8 折）。单局还没有阵营系统，先关着
  armsMember: false,
  // 敌人掉落：单局里统一按杂兵 / 精英 / 首领三档（已定）。
  // 已定：任务报酬是收入大头，掉落不超过收入的一半。三档的比例沿用主持人手册敌人表里各档掉落最多的
  // （杂兵 200 空投蜂群 · 精英 1150 巨人期望 · 首领占位 2300），整体乘 0.4，
  // 让最吃亏的 2 人队掉落也只占收入的四成左右（验算见 tools/economy.js 的「掉落占比」）。
  lootByRank: { minion: 80, elite: 460, boss: 920 },
  // 个别敌人不按三档、用自己的掉落（成群出现的穴鸦按杂兵给太多）
  lootByKit: { crow: 15 },
  // 诊所：任务之间回到城里时可以去（节点里也可能遇到，见 ROGUE_NODE_TYPES.clinic）
  campClinic: true,

  // 撤退：规则按手册（app.js · RETREAT_RULES）。撤退后这个战斗节点算跳过（没有奖励），任务继续。
  retreatSkipsNode: true,
  bossRetreat: false              // 首领战不能撤退
};

/* 战场上的随机配置物与地形（已定方向：越往后越常见；数值占位）。
 *   chanceByAct  普通 / 精英战斗带这些东西的概率，按幕（额外幕接着往后）
 *   countByAct   带的话放几样 [最少, 最多]
 *   bossChance   首领战带的概率
 * 每一项：
 *   type    prop 配置物 / field 场地效果（放在某个区）/ gap 区与区之间的地形
 *   what    配置物种类（props.js · makeProp）/ 场地（app.js · emptyField 的键）/ 间隔种类（bridge 不稳桥梁、wall 危墙）
 *   faction 配置物属于哪边（电池、炮台）：enemy / player
 *   weight  抽中的权重；regions 只在这些区域出现（不写＝哪都有）；minAct 从第几幕开始出现 */
const ROGUE_BATTLEFIELD = {
  chanceByAct: [0.25, 0.4, 0.55, 0.7, 0.8, 0.9],
  countByAct: [[1, 1], [1, 2], [1, 2], [2, 3], [2, 3], [2, 3]],
  bossChance: 0.4,
  pool: [
    { type: "prop",  what: "boom",    name: "爆炸桶",           weight: 3 },
    { type: "prop",  what: "acid",    name: "酸液桶",           weight: 2 },
    { type: "prop",  what: "battery", name: "超充能电池（敌方）", faction: "enemy",  weight: 1, regions: ["巨人城", "天网设施"] },
    { type: "prop",  what: "battery", name: "超充能电池（我方）", faction: "player", weight: 1, regions: ["巨人城", "天网设施"] },
    { type: "prop",  what: "turret",  name: "防卫自律炮台（敌方）", faction: "enemy",  weight: 1, minAct: 2 },
    { type: "prop",  what: "turret",  name: "防卫自律炮台（我方）", faction: "player", weight: 1, minAct: 2 },
    { type: "field", what: "fire",     name: "火场",     weight: 2 },
    { type: "field", what: "acid",     name: "酸液地面", weight: 2 },
    { type: "field", what: "ice",      name: "冻土",     weight: 1, regions: ["外城区", "巨人城"] },
    { type: "field", what: "electric", name: "高压场地", weight: 2, regions: ["巨人城", "天网设施", "外城区"] },
    { type: "field", what: "energy",   name: "能量场",   weight: 1, regions: ["天网设施"] },
    { type: "field", what: "harmonic", name: "干涉场地", weight: 1, minAct: 2 },
    { type: "field", what: "heal",     name: "治愈场地", weight: 1 },
    { type: "field", what: "highland", name: "高地",     weight: 2 },
    { type: "field", what: "collapseOn", name: "塌陷区域", weight: 2, regions: ["沙漠"] },
    { type: "gap",   what: "bridge",   name: "不稳桥梁", weight: 2 },
    { type: "gap",   what: "wall",     name: "危墙",     weight: 2 }
  ]
};

/* 带天气的任务（已定：少部分任务标注某种天气，任务里的每一场战斗都是这种天气）。
 *   chance    一个任务带天气的概率
 *   byRegion  每个区域可能出现的天气（额外幕沿用第 1–4 幕的区域） */
const ROGUE_TASK_WEATHER = {
  chance: 0.25,
  byRegion: {
    "外城区": ["heat", "acid", "thunder", "snow"],
    "沙漠": ["sand", "heat"],
    "巨人城": ["thunder", "acid", "snow", "glow"],
    "天网设施": ["glow", "phase", "thunder"]
  }
};

/* 节点种类。hours：这个节点本身花的时间（战斗按一场算）。 */
const ROGUE_NODE_TYPES = {
  battle: { label: "战斗",   hours: 2 },
  elite:  { label: "精英战", hours: 3, tokens: 5 },   // 5 枚代币的遭遇
  rest:   { label: "休息",   hours: 0 },               // 长休 / 短休的时间单独算
  shop:   { label: "商店",   hours: 1 },
  smith:  { label: "工匠",   hours: 1 },
  clinic: { label: "诊所",   hours: 2 },
  check:  { label: "检定",   hours: 1 }                // 熟练项检定事件，见 ROGUE_CHECKS
};

/* 熟练项检定事件（已定：插在两场战斗之间；事件文字占位）。
 *   insertChance  任务里每一处「战斗 → 战斗」之间插一个检定的概率；maxPerTask 一个任务最多几个
 *   diffs         四档难度（手册第一章）：名字、成功奖励（奎支）
 *   weightsByAct  每幕各难度出现的权重（额外幕接着往后）：第一幕只有简单、普通；第二幕出现困难；
 *                 第三幕不再有简单、出现极难；第四幕困难、极难略多一点
 *   chance        成功率（手册第一章）：行 = 熟练等级 0–3，列 = 简单 / 普通 / 困难 / 极难。0 = 无法尝试
 *   injure        会受伤的检定：出现概率、成功额外奖励、失败时对检定者的伤害（按幕 [最少, 最多]，属性随机、
 *                 走克制表、不致死），以及下一场战斗开始时结算的击破
 *   profs         随机抽一项熟练项挂在事件上（占位：事件内容之后再写）
 * 谁有哪项熟练、几级，种族的优势 / 重掷，见 party.js · HERO_PROFILES / RACE_CHECK_PERKS。 */
const ROGUE_CHECKS = {
  insertChance: 0.5,
  maxPerTask: 2,
  diffs: {
    easy:    { name: "简单", reward: 600 },
    normal:  { name: "普通", reward: 1200 },
    hard:    { name: "困难", reward: 2000 },
    extreme: { name: "极难", reward: 3000 }
  },
  weightsByAct: [
    { easy: 3, normal: 2 },
    { easy: 2, normal: 3, hard: 1.5 },
    { normal: 3, hard: 2, extreme: 1 },
    { normal: 2.6, hard: 2.4, extreme: 1.3 },
    { normal: 2.6, hard: 2.4, extreme: 1.3 },
    { normal: 2.6, hard: 2.4, extreme: 1.3 }
  ],
  chance: [
    [0.5, 0,   0,    0],
    [1,   0.5, 0.25, 0.125],
    [1,   1,   0.5,  0.25],
    [1,   1,   0.75, 0.5]
  ],
  injure: {
    chance: 0.5,
    bonus: 500,
    dmgByAct: [[5, 8], [8, 13], [10, 18], [15, 30], [15, 30], [15, 30]],
    brk: 1
  },
  elements: ["fire", "acid", "electric", "ice", "energy", "physical", "harmonic"],
  profs: PROF_LIST                 // 手册里的全部熟练项（party.js）
};

/* 单人模式（规则和单局一样，只有下面这些不同；已定）
 *   apPerRound      主角每回合几个行动点
 *   partners        开局选几名伙伴（支援技能从他们里面挑）
 *   supportScore    每得到多少分（本场战斗的评分）多一次支援机会
 *   supportCost     支援技能花几个行动点
 *   supportBreak    支援的协助攻击额外造成几点（对应属性的）击破
 *   battleXp        每场战斗胜利额外给多少经验（击杀经验照常）
 *   attrEvery       每升几级额外选一次六维属性（和普通的 4 / 8 级属性点叠加）
 *   role2Every      每升几级从第二副职责里额外学一个技能
 *   role2MaxSkill   第二副职责能学到技能几（技能四只有专精能拿） */
const ROGUE_SOLO = {
  apPerRound: 2,
  partners: 3,
  supportScore: 500,
  supportCost: 1,
  supportBreak: 3,
  battleXp: 50,
  attrEvery: 4,
  role2Every: 5,
  role2MaxSkill: 3
};

/* 诊所（数值占位，按「一人一次改造平均约 3000 奎支」定）
 *   healPerHp   治疗：每恢复 1 点生命的价格（手册简易医疗包 600 奎支约治 8.5 点，约 70 / 点）
 *   cyberPerHp  义体改造：每改动 1 点肉体的价格（加、减都算；换成星灵按被换掉的肉体点数算）
 * 改造的比例、上限、层数、排列是角色规则，在 growth.js · CYBER_RATIO 等。 */
const ROGUE_CLINIC = {
  healPerHp: 60,
  cyberPerHp: 200
};

/* 支线任务模板（文字与数值都是占位）。报酬和补给是 ROGUE_CONFIG.perHeadBase 人队的量
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
    mix: { battle: 4, rest: 2, shop: 1, smith: 1, clinic: 1 },
    reward: { kuizhi: 3000, xp: 25 }, supply: { water: 3000, items: { food_liquid: 4 } } },
  { kind: "scout",  name: "侦察", goal: "摸清{region}深处的动静", nodes: [3, 4], days: 1, diff: 1,
    mix: { battle: 3, rest: 1, smith: 1 },
    reward: { kuizhi: 2000, xp: 20 }, supply: { water: 1500, items: { food_can: 2 } } },
  { kind: "bounty", name: "悬赏", goal: "在{region}找到并击败悬赏目标", nodes: [2, 3], days: 1, diff: 1, elite: true,
    mix: { battle: 3, shop: 1 },
    reward: { kuizhi: 3500, xp: 30 }, supply: { water: 1000, items: { food_liquid: 2 } } }
];

const ROGUE_MAIN_TASK = {
  kind: "main", name: "主线", goal: "在本幕结束前完成关键目标，期限到了还没完成，本局结束。本幕的天数用完时迎战首领。",
  nodes: [4, 5], days: 3, diff: 1, elite: true, key: true,
  mix: { battle: 4, rest: 2, shop: 1, smith: 1, clinic: 1 },
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

/* 材料（物品表的价格）。单局里升级不收实物材料，按这张表折成奎支。 */
const ROGUE_MATERIALS = HANDBOOK_MATERIALS;   // 与跑团模式共用（trpg-data.js）

/* 武器升级表（照设定：升到某一级要的材料 + 工匠的加工费）。
 * 4 级以下本来可以自己在工作站升，没有加工费；5 级起只能找武器工匠，加工费是设定里「××奎支上下」的数。
 * 单局里实际收费 = (材料按物品表折价 + 加工费 × 工匠的加工费倍率) × ROGUE_CONFIG.smithPriceScale，按 100 取整。 */
const ROGUE_SMITH = {
  maxLevel: HANDBOOK_WEAPON_UPGRADE.maxLevel,
  recipe: HANDBOOK_WEAPON_UPGRADE.recipe       // 与跑团模式共用（trpg-data.js）
};

/* 武器工匠（设定照作者给的人物表）。
 *   ROGUE_SMITH_RULES.onBoard        每次回到任务板时随机出现几位不同的工匠（已定：3）
 *   ROGUE_SMITH_RULES.blueprintAfter 在同一位工匠那里升级满几次，就能从他的客制化里挑一张图纸（已定：5，代替设定里的任务线）
 *   ROGUE_SMITH_RULES.installCost    把图纸装到武器上的价格（已定：5000）
 * 每位工匠：
 *   home      所在的地方（单局在这个区域时出现的机会翻倍）       weight  出现的权重（默认 1）
 *   price     收费规则：
 *     priceMul        总价倍率                 laborMul   加工费倍率
 *     extraMats       每次升级多消耗几个材料（加最便宜的那种）
 *     laborHours      不收加工费，改为帮忙干活，花这么多小时（算进「距上次长休」）
 *     needsIntro      不帮陌生人：要先「给他看看武器」，之后价格正常
 *     friendAfter / friendDiscount  在他这里升级满几次后关系变好，总价打折
 *     armsDiscount    ARMS 成员的折扣（单局还没有阵营，ROGUE_CONFIG.armsMember 打开才生效）
 *   canInstall  能不能帮你装图纸（努尔&哈米德不是武器工匠，装不了）
 *   blueprints  客制化图纸，mod 字段的含义见 mods.js 开头 */
const ROGUE_SMITH_RULES = {
  onBoard: 3,
  blueprintAfter: 5,
  installCost: 5000
};
const ROGUE_SMITHS = [
  { id: "trevor", name: "“独眼”崔佛", home: "外城区",
    blurb: "戴着夸张高倍观察镜的独眼老人，从地球被抓来的焊接工。孤僻排外，常帮狂徒改武器，风格狂野。",
    price: { needsIntro: true, friendAfter: 3, friendDiscount: 0.15 },
    blueprints: [
      { id: "bp_trevor_bigkill", name: "大杀器", text: "耐久减半，减去的数值 +2 加在 atk 上",
        mod: { bigKill: true } },
      { id: "bp_trevor_romance", name: "狂徒浪漫", text: "打近距离敌人伤害掷骰 +1d8；承受伤害总是 +1d10；架势 −2，耐久 −3",
        mod: { meleeDice: [1, 8], takenDice: [1, 10], def: -2, dur: -3 } }
    ] },
  { id: "teresa", name: "特蕾莎·特雷丝", home: null,
    blurb: "ARMS 的武器工匠，靠机械背包上的机械腿走路的小个子鼠类人。对新奇科技着迷，不问阵营。喜欢西瓜。",
    price: { armsDiscount: 0.2 },
    blueprints: [
      { id: "bp_teresa_light", name: "轻量化处理", text: "atk −4，架势 −1，耐久 −2；持有者每回合多 1 附赠动作，武器人形态每回合多 1 行动点",
        mod: { atk: -4, def: -1, dur: -2, bonusPerRound: 1, weaponApPerRound: 1 } },
      { id: "bp_teresa_exp", name: "实验性选项", text: "行动点 +1！失去附赠动作；atk 减少 1/4，架势 −1，耐久 −2",
        mod: { apPerRound: 1, noBonus: true, atkPct: -0.25, def: -1, dur: -2 } }
    ] },
  { id: "zekahr", name: "“双面”泽卡尔", home: "巨人城",
    blurb: "满身改装件和霓虹涂鸦的蜥蜴，住在巨人城的废弃下水道里。自诩艺术家，也是情报商。价格合理。",
    price: {},
    blueprints: [
      { id: "bp_zekahr_evil", name: "恶眼 רַע־עַיִן", text: "无法为其他角色协助格挡；协助攻击伤害 +50%；耐久 −3",
        mod: { noAssistBlock: true, assistAtkPct: 0.5, dur: -3 } },
      { id: "bp_zekahr_fool", name: "蠢货 כְּסִיל", text: "协助格挡成功率 +10%，无法协助攻击；架势 +1；敌人更倾向于攻击你；成功格挡后恢复 2d4 生命",
        mod: { block: 10, noAssistAttack: true, def: 1, aggro: true, healOnBlock: [2, 4] } }
    ] },
  { id: "tima", name: "“愚人”季玛", home: "沙漠",
    blurb: "戴着奇怪金属帽的瘦小巨人，唯一不在蜂巢思维里的巨人，被同族通缉，躲在沙漠。不收钱，但要你帮他建庇护所。",
    price: { laborHours: 4 },
    blueprints: [
      { id: "bp_tima_camo", name: "安全的迷彩", text: "显著降低被敌人当做目标的概率，武器人形态一定不会被攻击；耐久 −2，格挡成功率 −10%",
        mod: { stealth: true, dur: -2, block: -10 } },
      { id: "bp_tima_range", name: "稳妥的距离", text: "远距离攻击伤害掷骰 +1d4，近距离攻击伤害 −3；有敌人进入你所在的区时自动移到另一个区；架势 −1",
        mod: { rangedDice: [1, 4], meleeFlat: -3, autoRetreat: true, def: -1 } }
    ] },
  { id: "morma", name: "摩尔玛", home: "巨人城", weight: 0.3,
    blurb: "巨腕军火工业军火设计开发部组长，穿着装满水的制式工作服的粉色触灵。严厉权威，嫌弃拼凑的武器，一切按制式标准改。",
    price: {},
    blueprints: [
      { id: "bp_morma_wam56", name: "WAM-56", text: "放弃角色自身的被动。借机攻击单元：敌人离开你所在区时自动攻击 atk+1d6；近距离压制单元：同区敌人 atk −4",
        mod: { noPassive: true, oppAttack: true, suppress: 4 } },
      { id: "bp_morma_mr2165", name: "MR-2165", text: "放弃角色自身的被动。团队协作单元：成功协助格挡时被保护的队友清除负面状态；坚守阵地单元：第一次被击破架势时不触发敌人的协助攻击，并恢复 2 架势",
        mod: { noPassive: true, blockCleanse: true, firstBreakGuard: true } }
    ] },
  { id: "nurhamid", name: "努尔 & 哈米德", home: null,
    blurb: "第一采矿场的熊兽人姐弟，替巨人维护大型机械的机械护理师。努尔直爽，哈米德寡言。加工费便宜两成，但多耗两个材料；装不了图纸。",
    price: { laborMul: 0.8, extraMats: 2 }, canInstall: false,
    blueprints: [
      { id: "bp_nur_safe", name: "愿你无恙（努尔）", text: "被队友协助格挡时成功率 +10%；被属性克制时额外伤害只算 25%；受到和施加的治疗都 +2d4；攻击伤害 −1d6，耐久 −2",
        mod: { protectedBlock: 10, weaknessCap: 0.25, healBonus: [2, 4], attackDice: [1, 6, -1], dur: -2 } },
      { id: "bp_hamid_win", name: "愿你常胜（哈米德）", text: "攻击属性效果不好时额外 +1 击破；效果绝佳时 50% 施加对应的状态效果；atk −3，耐久 −2",
        mod: { resistBreak: 1, greatStatus: 0.5, atk: -3, dur: -2 } }
    ] }
];

/* 升级时要做的选择（手册第三章「升级时你会得到什么」）。
 * 角色卡上 minLv 的技能（lv2、lv11、lv17 的「一项技能」、效果位技能）到级自动解锁，不在这里。
 *   attr      可分配的六维属性点；noRepeat：不能加在之前加过的同一项上（lv8）
 *   role      职责技能二选一（lv5 副一/主二，lv10 主二/主三，lv15 主三/主四）
 *   prof      一个自选熟练项：新学一项，或把已有的一项升一级（最高三级）
 *   note      系统还没做的奖励：先记在角色身上，等对应系统做好再兑现 */
const ROGUE_LEVEL_REWARDS = {
  3:  [{ type: "prof" }],                      // 一个自选熟练项（已有的再选一次 = 升一级，最高三级）
  4:  [{ type: "attr" }],
  5:  [{ type: "role" }],
  7:  [{ type: "prof" }],                      // 一个自选熟练项（已有的再选一次 = 升一级，最高三级）
  8:  [{ type: "attr", noRepeat: true }],
  9:  [{ type: "note", key: "feat", text: "一项专长" }],
  10: [{ type: "role" }],
  12: [{ type: "prof" }],                      // 一个自选熟练项（已有的再选一次 = 升一级，最高三级）
  13: [{ type: "note", key: "feat", text: "一项专长" }],
  14: [{ type: "note", key: "lv14", text: "空手格挡成功率提高到 50%；自己回合内可用 1 行动点转化为 1 附赠动作" }],
  15: [{ type: "role" }],
  16: [{ type: "note", key: "feat", text: "一项专长" }],
  18: [{ type: "prof" }],                      // 一个自选熟练项（已有的再选一次 = 升一级，最高三级）
  19: [{ type: "note", key: "feat", text: "一项专长" }],
  20: [{ type: "note", key: "ultimate", text: "强力终极技能" }]
};

const ATTR_NAMES = { str: "力量", con: "体质", dex: "敏捷", wil: "意志", int: "智力", sta: "耐力" };
