/* 角鳞 · 单局层（run.js）
 *
 * 这一层负责「一局之内」的东西，和战斗规则完全分开：
 *   1. 种子随机数：一个种子完整决定一局，方便复现与批量测试
 *   2. 遭遇数据：战斗由数据生成，不再写死在 setupBattle 里
 *   3. 单局状态：战斗之间保留血量、坚毅生命、武器耐久、补给、天数
 *   4. 休息：按手册的短休 / 长休 / 力竭结算
 *
 * 这里不含任何战斗规则。规则仍然全部在 engine/party/enemies/growth/app 里。
 */

/* ===== 1. 种子随机数 ============================================ */

/** 把任意字符串揉成 32 位整数，用作种子 */
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str == null ? "" : str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32：小、快、够用，且同一种子必定同一序列 */
function makeRng(seed) {
  let a = (hashSeed(seed) + 0x6D2B79F5) >>> 0;
  let draws = 0;
  const next = () => {
    draws++;
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.draws = () => draws;
  next.setDraws = (n) => {
    // 从头重放 n 次，用来把随机流恢复到某个位置（读档用）
    a = (hashSeed(seed) + 0x6D2B79F5) >>> 0;
    draws = 0;
    for (let i = 0; i < n; i++) next();
  };
  return next;
}

/** 画面效果（粒子、音效、动画令牌、骰子滚动动画……）用的随机数。
 *  RNG.install 会把 Math.random 换成战斗用的种子随机数，画面效果如果也从那里取，
 *  骰子结果就会跟着动画停了多久、开没开特效变；所以画面效果一律用这个，永远是系统自带的随机数。 */
const NATIVE_RANDOM = Math.random;
function fxRandom() { return NATIVE_RANDOM(); }

const RNG = {
  seed: null,
  fn: null,
  realRandom: null,
  /** 装上种子随机数。规则代码全部走 Math.random，所以在这里接管。 */
  install(seed) {
    if (this.realRandom == null) this.realRandom = Math.random;
    this.seed = String(seed);
    this.fn = makeRng(this.seed);
    Math.random = this.fn;
    return this.seed;
  },
  /** 还原成系统随机数 */
  uninstall() {
    if (this.realRandom) Math.random = this.realRandom;
    this.fn = null;
    this.seed = null;
  },
  draws() { return this.fn ? this.fn.draws() : 0; },
  /** 读档时把随机流拨回原位 */
  restore(seed, draws) {
    this.install(seed);
    this.fn.setDraws(Number(draws) || 0);
  },
  /** 生成一个可读的随机种子 */
  newSeed() {
    const src = this.realRandom || Math.random;
    return Math.floor(src() * 0xFFFFFFFF).toString(36).toUpperCase();
  }
};

/* ===== 2. 遭遇数据 ============================================== */

/** 亡命之王的狂徒援军（作者定）：开场就写着要赶来（chain.js），到王身边集合；战斗已经结束（场上全灭）就不来了 */
const OUTLAW_KING_WAVES = [
  { turns: 3, cancelOnClear: true, enemies: [{ preset: "thug_knife", zone: 2, near: "outlaw_king" }, { preset: "thug_hammer", zone: 2, near: "outlaw_king" }] },
  { turns: 6, cancelOnClear: true, enemies: [{ preset: "thug_knife", zone: 2, near: "outlaw_king" }, { preset: "thug_hammer", zone: 2, near: "outlaw_king" }] }
];

/* 一场战斗写成数据，setupBattle 照着摆。
 *   enemies: [{ preset, level, zone, count? }]
 *   zoneMode 2 或 3；weather 见 engine；fields 按区写场地
 *   level 支持相对值："+1" 表示比遭遇基准等级高 1 */
const ENCOUNTERS = [
  {
    id: "outer_thugs",
    name: "外城区巷战",
    region: "外城区",
    tier: "normal",
    zoneMode: 2,
    enemies: [
      { preset: "thug_knife", zone: 2 },
      { preset: "thug_hammer", zone: 2 },
      { preset: "bandit_boss", zone: 2 }
    ]
  },
  {
    id: "outer_patrol",
    name: "巡逻队拦截",
    region: "外城区",
    tier: "normal",
    zoneMode: 2,
    enemies: [
      { preset: "guard_sword", zone: 2 },
      { preset: "guard_gun", zone: 2 },
      { preset: "patrol_car", zone: 2 }
    ]
  },
  {
    id: "outer_sand",
    name: "沙灵游荡",
    region: "外城区",
    tier: "normal",
    zoneMode: 3,
    weather: "sand",
    enemies: [
      { preset: "sand_beast", zone: 2, count: 2 },
      { preset: "sand_human", zone: 3 }
    ]
  },
  {
    id: "outer_drones",
    name: "废料场无人机",
    region: "外城区",
    tier: "normal",
    zoneMode: 3,
    fields: { 2: { acid: true } },
    enemies: [
      { preset: "dumpdrone", zone: 2 },
      { preset: "buoy", zone: 3 },
      { preset: "crow", zone: 2, count: 2 }
    ]
  },
  {
    id: "elite_captain",
    name: "警卫队长巡查",
    region: "外城区",
    tier: "elite",
    zoneMode: 3,
    enemies: [
      { preset: "captain_wolf", zone: 2 },
      { preset: "guard_sword", zone: 2, count: 2 }
    ]
  },
  {
    id: "elite_mecha",
    name: "机甲触灵",
    region: "外城区",
    tier: "elite",
    zoneMode: 3,
    enemies: [
      { preset: "mecha_mg", zone: 2 },
      { preset: "mecha_gl", zone: 3 }
    ]
  },
  {
    id: "elite_boat",
    name: "高压巡逻艇",
    region: "外城区",
    tier: "elite",
    zoneMode: 3,
    weather: "thunder",
    enemies: [
      { preset: "patrolboat", zone: 3 },
      { preset: "swarm", zone: 2, count: 2 }
    ]
  },
  {
    id: "boss_king",
    name: "亡命之王",
    region: "外城区",
    tier: "boss",
    zoneMode: 3,
    enemies: [
      { preset: "outlaw_king", zone: 2 },
      { preset: "bandit_boss", zone: 2 },
      { preset: "thug_knife", zone: 2 },
      { preset: "thug_hammer", zone: 2 }
    ],
    waves: OUTLAW_KING_WAVES
  },
  {
    id: "boss_aggregate",
    name: "沙灵聚合体",
    region: "外城区",
    tier: "boss",
    zoneMode: 3,
    weather: "sand",
    enemies: [{ preset: "sand_aggregate", zone: 2 }]
  },
  {
    id: "boss_ufo",
    name: "飞碟触灵",
    region: "外城区",
    tier: "boss",
    zoneMode: 3,
    enemies: [{ preset: "ufo_boss", zone: 2 }]
  }
];

/* ===== 2b. 随机遭遇（代币制） ===================================
 * 每场战斗有 4 枚代币：杂兵 1 枚，精英 2 枚。
 * 所以一场可能是 4 杂兵 / 2 精英 / 1 精英 + 2 杂兵。
 * 空投蜂群三只算一组，整组记 1 枚。
 *   5% 概率这场变成 5 枚代币。
 *   5% 概率不受阵营限制，变成混战。
 * ============================================================== */

const ENCOUNTER_TOKENS = 4;
const CHANCE_EXTRA_TOKEN = 0.05;   // 变 5 代币
const CHANCE_MIXED = 0.05;         // 混战：无视阵营

/** 随机种族的权重表（写进 ENEMY_INFO.races；有哪些种族、小分支见 enemies.js · ENEMY_RACES）。
 *  race 可以写大支（"猫类人"，小分支再平分）、"类人"（四个大支平分）或带小分支的 "兽人·猫"；w 是权重，不必加到 100 */
const ENEMY_RACE_TABLES = {
  // 盗匪：人类 60 / 红皮人 20 / 类人 20（四个大支各 5%，大支里的小分支再平分）
  bandit: [{ race: "人类", w: 60 }, { race: "红皮人", w: 20 }, { race: "类人", w: 20 }],
  // 燃气收集机：类人四个大支各 25%
  humanoid: [{ race: "类人", w: 100 }],
  // 蚁型兵种：兽人五支，猫约 6.7%（其余的 2/7），狼 / 牛 / 蜥蜴 / 熊各约 23.3%
  ant: [{ race: "兽人·狼", w: 7 }, { race: "兽人·牛", w: 7 }, { race: "兽人·蜥蜴", w: 7 }, { race: "兽人·熊", w: 7 }, { race: "兽人·猫", w: 2 }]
};

/** 每个敌人的阵营、出没区域、代币、成组数量
 *  种族（有机体的敌人才写，没写 = 无种族；规则见 docs/enemy-race.md，换算在 enemies.js · applyEnemyRace）：
 *    race: "兽人·牛"                      固定种族（大支·小分支），不受个体值开关影响，不套六维
 *    races: ENEMY_RACE_TABLES.bandit      随机种族：[{ race: "人类", w: 60 }, …] 权重表，生成时抽
 *    raceAttrs: true                      随机种族的敌人再按种族的六维修正改数值（体质只加最内层肉体）；不写 = 只挂种族、不改数值
 *  新增兵种照这个格式加。 */
const ENEMY_INFO = {
  // —— 天网安保（机械）——
  guard_sword: { faction: "安保", regions: ["外城区", "巨人城"], tokens: 1 },
  guard_gun:   { faction: "安保", regions: ["外城区", "巨人城"], tokens: 1 },
  patrol_car:  { faction: "安保", regions: ["外城区", "巨人城"], tokens: 1 },
  boomcar:     { faction: "安保", regions: ["外城区", "巨人城"], tokens: 1 },
  buoy:        { faction: "安保", regions: ["巨人城"], tokens: 1 },
  swarm:       { faction: "安保", regions: ["外城区", "巨人城"], tokens: 1, group: 3 },
  patrolboat:  { faction: "安保", regions: ["巨人城"], tokens: 2 },
  // 第一采矿场：用酸的安保机械（工蚁的部下）
  dumpdrone:   { faction: "安保", regions: ["第一采矿场", "巨人城"], tokens: 1 },
  spreader:    { faction: "安保", regions: ["第一采矿场"], tokens: 2 },
  mine_guard:  { faction: "安保", regions: ["第一采矿场"], tokens: 1 },
  ant_guard:   { faction: "安保", regions: ["第一采矿场"], tokens: 2, races: ENEMY_RACE_TABLES.ant },
  // 第二采矿场：用火的安保部队
  mine_overseer: { faction: "安保", regions: ["第二采矿场"], tokens: 1, race: "兽人·熊" },
  flint_sweeper: { faction: "安保", regions: ["第二采矿场"], tokens: 1 },
  gas_collector: { faction: "安保", regions: ["第二采矿场"], tokens: 2, races: ENEMY_RACE_TABLES.humanoid, raceAttrs: true },
  ant_hunter:    { faction: "安保", regions: ["第二采矿场"], tokens: 2, races: ENEMY_RACE_TABLES.ant },
  // 第三采矿场：用能量的安保部队（还会有异星生物）
  alarm_bot:     { faction: "安保", regions: ["第三采矿场"], tokens: 1 },
  meteor_miner:  { faction: "安保", regions: ["第三采矿场"], tokens: 1 },
  // 第三采矿场：异星生物（星灵；和安保不是一伙的）。衍蛛两只一组记 1 枚代币
  meteor_spider:    { faction: "异星生物", regions: ["第三采矿场"], tokens: 1, group: 2 },
  meteor_centipede: { faction: "异星生物", regions: ["第三采矿场"], tokens: 1 },
  // —— 警卫队（有机体，可与安保混编）——
  captain_wolf:   { faction: "警卫队", regions: ["巨人城", "外城区"], tokens: 2, race: "兽人·狼" },
  captain_ox:     { faction: "警卫队", regions: ["巨人城", "外城区"], tokens: 2, race: "兽人·牛" },
  captain_lizard: { faction: "警卫队", regions: ["巨人城", "外城区"], tokens: 2, race: "兽人·蜥蜴" },
  // —— 镇压队（外城区；赤牙麾下的火属性部队，固定种族，docs/suppression-force.md）——
  riot_baton:    { faction: "镇压队", regions: ["外城区"], tokens: 1, race: "兽人·牛" },
  riot_rifle:    { faction: "镇压队", regions: ["外城区"], tokens: 1, race: "兽人·熊" },
  riot_molotov:  { faction: "镇压队", regions: ["外城区"], tokens: 1, race: "兽人·蜥蜴" },
  riot_flamer:   { faction: "镇压队", regions: ["外城区"], tokens: 2, race: "兽人·熊" },
  riot_captain:  { faction: "镇压队", regions: ["外城区"], tokens: 2, race: "兽人·狼" },
  // —— 盗匪 ——
  thug_knife:  { faction: "盗匪", regions: ["外城区"], tokens: 1, races: ENEMY_RACE_TABLES.bandit, raceAttrs: true },
  thug_hammer: { faction: "盗匪", regions: ["外城区"], tokens: 1, races: ENEMY_RACE_TABLES.bandit, raceAttrs: true },
  bandit_boss: { faction: "盗匪", regions: ["外城区"], tokens: 2, races: ENEMY_RACE_TABLES.bandit, raceAttrs: true },
  // 主持人手册：每次出场带强盗头子、匕首狂徒、锤狂徒各一，和他同区（固定随从，不按代币抽）
  outlaw_king: { faction: "盗匪", regions: ["外城区"], tokens: 4, boss: true,
                 races: ENEMY_RACE_TABLES.bandit, raceAttrs: true,
                 escorts: ["bandit_boss", "thug_knife", "thug_hammer"],
                 waves: OUTLAW_KING_WAVES },
  // —— 沙灵 ——
  sand_beast: { faction: "沙灵", regions: ["沙漠"], tokens: 1 },
  sand_human: { faction: "沙灵", regions: ["沙漠"], tokens: 1 },
  bigsand:    { faction: "沙灵", regions: ["沙漠"], tokens: 2 },
  livesand:   { faction: "沙灵", regions: ["沙漠"], tokens: 2 },
  dustbody:   { faction: "沙灵", regions: ["沙漠"], tokens: 2 },
  sand_aggregate: { faction: "沙灵", regions: ["沙漠"], tokens: 4, boss: true },
  // —— 触灵（天网造物）——
  mecha_mg: { faction: "触灵", regions: ["天网设施", "巨人城"], tokens: 2 },
  mecha_gl: { faction: "触灵", regions: ["天网设施", "巨人城"], tokens: 2 },
  ufo_boss: { faction: "触灵", regions: ["天网设施"], tokens: 4, boss: true },
  // —— 巨人 ——
  giant: { faction: "巨人", regions: ["巨人城"], tokens: 2 },
  // —— 野生动物：只在外城区与沙漠 ——
  // 穴鸦成群出现（4–6 只一群），一群占满一场的 4 枚代币；pack：成群的杂兵，不算精英战
  crow: { faction: "野生", regions: ["外城区", "沙漠"], tokens: 4, group: [4, 6], pack: true },
  // —— 沙漠生物（desert.js）：沙鱼群；和沙灵互相敌对 ——
  sandfish_lead:   { faction: "沙漠生物", regions: ["沙漠"], tokens: 2 },
  sandfish_drive:  { faction: "沙漠生物", regions: ["沙漠"], tokens: 1 },
  sandfish_ambush: { faction: "沙漠生物", regions: ["沙漠"], tokens: 1 },
  // —— 中立生物：不占代币，不进随机抽取；有沙鱼的沙漠遭遇按 DESERT.spawn 另外配 ——
  dust_bug:  { faction: "中立生物", regions: ["沙漠"], tokens: 0, neutral: true },
  tube_worm: { faction: "中立生物", regions: ["沙漠"], tokens: 0, neutral: true },
  // —— 古代造物：沙漠 ——
  watchcrow: { faction: "古代造物", regions: ["沙漠"], tokens: 2 }
};

/** 是一伙的阵营（安保、警卫队是一套体系的两个分支；镇压队是赤牙的部队，和它们是一伙）。
 *  「一伙」只管不互相敌对、友军判断；遭遇里能不能同场混编另看 FACTION_MIX_CHANCE */
const ALLIED_FACTIONS = [["安保", "警卫队", "镇压队"]];
/** 同场混编概率：写在这里的阵营不是想混就混——抽遭遇时它和同伙阵营只有这么大的概率混编，
 *  其余时候各打各的（抽到镇压队就只出镇压队；抽到安保 / 警卫队时，镇压队也只有这个概率加进来）。
 *  没写的阵营照旧想混就混（安保 + 警卫队） */
const FACTION_MIX_CHANCE = { "镇压队": 0.15 };
function alliesOf(faction) {
  const g = ALLIED_FACTIONS.find(a => a.indexOf(faction) >= 0);
  return g ? g.slice() : [faction];
}
/** 抽遭遇时这个阵营可以同场出现的阵营：alliesOf 去掉没掷中混编概率的阵营，每次调用各掷一次。
 *  抽到的是受限阵营（镇压队）：整个同伙（安保 + 警卫队）一起混进来或一起不来；
 *  抽到的是同伙：受限阵营各自掷一次决定加不加进来 */
function encounterFactions(faction) {
  const all = alliesOf(faction);
  const loose = all.filter(f => FACTION_MIX_CHANCE[f] != null);
  if (!loose.length) return all;
  if (loose.includes(faction)) return Math.random() < FACTION_MIX_CHANCE[faction] ? all : [faction];
  return all.filter(f => !loose.includes(f) || Math.random() < FACTION_MIX_CHANCE[f]);
}

function enemyInfo(preset) { return ENEMY_INFO[preset] || null; }
/** 一次出几只：group 可以是固定数，也可以是 [最少, 最多] */
function groupCount(info) {
  const g = info && info.group;
  if (Array.isArray(g)) return g[0] + Math.floor(Math.random() * (g[1] - g[0] + 1));
  return Number(g) || 1;
}
function enemyTokens(preset) {
  const i = enemyInfo(preset);
  return i ? (i.tokens || 1) : 1;
}
function regionPool(region, opt) {
  opt = opt || {};
  return Object.keys(ENEMY_INFO).filter(k => {
    const i = ENEMY_INFO[k];
    if (i.boss && !opt.boss) return false;
    if (i.neutral) return false;   // 中立生物不当敌人抽
    return !region || i.regions.indexOf(region) >= 0;
  });
}
function regionFactions(region) {
  const set = [];
  regionPool(region).forEach(k => {
    const f = ENEMY_INFO[k].faction;
    if (set.indexOf(f) < 0) set.push(f);
  });
  return set;
}

const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** 按代币从池子里抽敌人：[{ preset, count }] */
function pickByTokens(pool, tokens) {
  const enemies = [];
  let left = tokens;
  for (let guard = 0; guard < 40 && left > 0; guard++) {
    const ok = pool.filter(k => enemyTokens(k) <= left);
    if (!ok.length) break;
    const k = pickOne(ok);
    enemies.push({ preset: k, count: groupCount(ENEMY_INFO[k]) });
    left -= enemyTokens(k);
  }
  return enemies;
}

/* 三方混战（三区制）：玩家在中间 2 区，两个互相敌对的阵营各占一边，两边各 3 枚代币。
 *   sides：两边各自的阵营（可混编的阵营写在一起）。chance：这个区域三区制的遭遇变成三方混战的概率 */
const THREE_WAY = {
  tokens: 3,
  chance: 0.5,
  regions: {
    "第三采矿场": { name: "三方混战", sides: [["安保"], ["异星生物"]] },
    "外城区": { name: "三方混战", sides: [["安保", "警卫队"], ["盗匪"]] }
  }
};
function rollThreeWay(region, opt) {
  const cfg = THREE_WAY.regions[region];
  const sides = cfg.sides.slice();
  if (Math.random() < 0.5) sides.reverse();   // 谁在 1 区、谁在 3 区随机
  const enemies = [];
  sides.forEach((fs, i) => {
    const pool = regionPool(region).filter(k => fs.includes(ENEMY_INFO[k].faction));
    const zone = i === 0 ? 1 : 3;
    pickByTokens(pool, THREE_WAY.tokens).forEach(e => {
      for (let n = 0; n < Math.max(1, Number(e.count) || 1); n++) enemies.push({ preset: e.preset, count: 1, zone });
    });
  });
  const spec = {
    name: `${region}·${cfg.name}`, region, faction: cfg.name,
    tier: enemies.some(e => enemyTokens(e.preset) >= 2 && !(ENEMY_INFO[e.preset] || {}).pack) ? "elite" : "normal",
    tokens: THREE_WAY.tokens * 2, mixed: false, threeWay: true, enemies,
    layout: "threeway", layoutLocked: true, playerZone: 2
  };
  return finishEncounter(spec, Object.assign({}, opt, { zoneMode: 3 }));
}

/** 随机遭遇。opt: { region, tokens, mixed, faction, zoneMode, weather, level, threeWay } */
function rollEncounter(opt) {
  opt = opt || {};
  const region = opt.region || "外城区";

  // 第三采矿场 / 外城区：三区制的遭遇有 THREE_WAY.chance 的概率变成三方混战（指定了阵营 / 混战 / 不分地区的不算）。
  // 先定下区制（和平常一样两区 / 三区各一半），三区才掷三方混战
  if (THREE_WAY.regions[region] && !opt.anyRegion && !opt.faction && opt.mixed == null) {
    const zm = Number(opt.zoneMode) || (Math.random() < 0.5 ? 2 : 3);
    const want = zm === 3 && (opt.threeWay != null ? !!opt.threeWay : Math.random() < THREE_WAY.chance);
    if (want) return rollThreeWay(region, opt);
    opt = Object.assign({}, opt, { zoneMode: zm });
  }

  // 代币：5% 变 5 枚
  const extra = opt.tokens == null && Math.random() < CHANCE_EXTRA_TOKEN;
  let tokens = opt.tokens != null ? Number(opt.tokens) : (ENCOUNTER_TOKENS + (extra ? 1 : 0));

  // 5% 混战：不受阵营限制
  const mixed = opt.mixed != null ? !!opt.mixed : (Math.random() < CHANCE_MIXED);

  // anyRegion：敌人不分地区（遭遇战）；region 仍决定天气
  const poolRegion = opt.anyRegion ? null : region;
  let pool = regionPool(poolRegion);
  let faction = null;
  if (!mixed) {
    const fs = opt.faction ? [opt.faction] : regionFactions(region);
    faction = pickOne(fs);
    const allow = encounterFactions(faction);
    pool = pool.filter(k => allow.indexOf(ENEMY_INFO[k].faction) >= 0);
  }
  if (!pool.length) pool = regionPool(poolRegion);

  const enemies = pickByTokens(pool, tokens);

  return finishEncounter({
    name: opt.anyRegion ? (mixed ? "遭遇·混战" : `遭遇·${faction}`) : mixed ? `${region}·混战` : `${region}·${faction}`,
    region, faction: mixed ? "混战" : faction,
    tier: enemies.some(e => enemyTokens(e.preset) >= 2 && !(ENEMY_INFO[e.preset] || {}).pack) ? "elite" : "normal",
    tokens, mixed, extraToken: extra,
    enemies
  }, opt);
}

/** 悬赏目标（rogue.js 悬赏任务）：血量、atk 乘倍率，名字前加【目标】 */
function makeBountyTarget(u, cfg) {
  cfg = typeof cfg === "object" ? cfg : {};
  const hm = Number(cfg.hpMul) || 1.5, am = Number(cfg.atkMul) || 1.5;
  (u.layers || []).forEach(l => { l.max = Math.round((Number(l.max) || 0) * hm); l.current = Math.round((Number(l.current) || 0) * hm); });
  // 敌人出手用的是 personalAtk（+ weaponAtk），面板显示 atk：都乘上
  ["atk", "personalAtk", "weaponAtk", "baseAtk"].forEach(k => { if (u[k] != null) u[k] = Math.round((Number(u[k]) || 0) * am); });
  u.name = "【目标】" + u.name;
  u.bountyTarget = true;
  return u;
}
/** 悬赏目标那一战：目标 + 同阵营的其他敌人，目标多占 extraTokens 枚代币 */
function rollBountyEncounter(preset, opt) {
  opt = opt || {};
  const info = enemyInfo(preset) || {};
  const cost = enemyTokens(preset) + (Number(opt.extraTokens) || 0);
  const left = Math.max(0, (Number(opt.tokens) || 5) - cost);
  const enc = rollEncounter({ region: opt.region, tokens: left, faction: info.faction, mixed: false, weather: opt.weather, zoneMode: opt.zoneMode });
  enc.enemies.unshift({ preset, zone: 2, bounty: { hpMul: opt.hpMul, atkMul: opt.atkMul } });
  enc.tier = "elite";
  enc.tokens = Number(opt.tokens) || 5;
  enc.name = `悬赏 · ${opt.targetName || preset}`;
  enc.id = "bounty:" + enc.id;
  return enc;
}
/** 悬赏目标的资格：至少占几枚代币（本区域没有这么大的敌人时，退而取本区域里代币最多的） */
const BOUNTY_TARGET = { minTokens: 2 };
/** 本区域可以当悬赏目标的精英（不是首领、不是成群的；优先 minTokens 枚代币及以上）。
 *  只从本区域的敌人表里抽：第三采矿场的敌人都只占 1 枚代币，以前因此落到全部区域去抽，
 *  抽到别的区域的目标，随从又和目标不是一个阵营 */
function bountyCandidates(region) {
  const base = (k) => { const i = ENEMY_INFO[k]; return i && !i.boss && !i.pack; };
  const here = regionPool(region).filter(base);
  const big = here.filter(k => enemyTokens(k) >= BOUNTY_TARGET.minTokens);
  if (big.length) return big;
  if (here.length) {
    const top = Math.max(...here.map(enemyTokens));
    return here.filter(k => enemyTokens(k) === top);
  }
  return Object.keys(ENEMY_INFO).filter(k => base(k) && enemyTokens(k) >= BOUNTY_TARGET.minTokens);   // 区域没有敌人表（不应出现）
}

/** BOSS 遭遇：BOSS 本体不占代币，随从另给。手册写死了随从的 BOSS（ENEMY_INFO.escorts）照写的来，不抽代币。 */
function rollBossEncounter(bossPreset, opt) {
  opt = opt || {};
  const info = enemyInfo(bossPreset);
  const region = opt.region || (info && info.regions[0]) || "外城区";
  const tokens = opt.tokens != null ? Number(opt.tokens) : 2;
  const enemies = [{ preset: bossPreset, zone: 2 }];
  const allow = info ? encounterFactions(info.faction) : null;
  let pool = regionPool(region).filter(k => !allow || allow.indexOf(ENEMY_INFO[k].faction) >= 0);
  if (info && info.escorts) info.escorts.forEach(k => enemies.push({ preset: k, zone: 2 }));
  let left = info && info.escorts ? 0 : tokens;
  for (let guard = 0; guard < 20 && left > 0; guard++) {
    const ok = pool.filter(k => enemyTokens(k) <= left);
    if (!ok.length) break;
    const k = pickOne(ok);
    enemies.push({ preset: k, count: groupCount(ENEMY_INFO[k]) });
    left -= enemyTokens(k);
  }
  const spec = {
    name: (info && bossPreset) ? `${region}·首领战` : "首领战",
    region, faction: info ? info.faction : null, tier: "boss",
    tokens, mixed: false, enemies
  };
  if (info && Array.isArray(info.waves)) spec.waves = JSON.parse(JSON.stringify(info.waves));   // 首领自带的援军
  return finishEncounter(spec, opt);
}

/** 三区站位：全在 3 区 / 2+3 对半 / 玩家在 2、敌人 1+3 对半。飞碟触灵不改。 */
function applyEncounterLayout(spec) {
  if (!spec) return spec;
  const mode = Number(spec.zoneMode) || 2;
  if (mode < 3) {
    spec.playerZone = 1;
    (spec.enemies || []).forEach(e => {
      if (e.preset === "ufo_boss") return;
      if (!e.zone) e.zone = 2;
    });
    spec.layout = spec.layout || "front2";
    return spec;
  }
  if (spec.layoutLocked) return spec;
  // 带固定随从的 BOSS（亡命之王）：随从与他同区，不拆开
  const together = (spec.enemies || []).some(e => ENEMY_INFO[e.preset] && ENEMY_INFO[e.preset].escorts);
  const kind = together ? "all3" : spec.layout && spec.layout !== "front2"
    ? spec.layout
    : ["all3", "split23", "pincer"][Math.floor(Math.random() * 3)];
  spec.layout = kind;
  spec.playerZone = kind === "pincer" ? 2 : 1;
  spec.layoutLocked = true;
  const kept = [];
  const pool = [];
  (spec.enemies || []).forEach(e => {
    if (e.preset === "ufo_boss") { kept.push(e); return; }
    const n = Math.max(1, Number(e.count) || 1);
    for (let i = 0; i < n; i++) pool.push({ preset: e.preset, level: e.level, count: 1 });
  });
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  if (kind === "all3") {
    pool.forEach(e => { e.zone = 3; });
  } else {
    const left = kind === "split23" ? 2 : 1;
    const mid = Math.ceil(pool.length / 2);
    pool.forEach((e, i) => { e.zone = i < mid ? left : 3; });
  }
  spec.enemies = kept.concat(pool);
  return spec;
}

function layoutLabel(kind) {
  return ({
    all3: "全员 3 区",
    split23: "2 / 3 区对半",
    pincer: "夹击（玩家 2 区）",
    threeway: "三方混战（玩家 2 区，两个阵营各占一边）",
    front2: "敌人 2 区",
    custom: "主持人预设"
  })[kind] || kind;
}

/** 补上区制、天气和站位 */
function finishEncounter(spec, opt) {
  opt = opt || {};
  const zoneMode = Number(opt.zoneMode) || (Math.random() < 0.5 ? 2 : 3);
  spec.zoneMode = zoneMode;
  spec.weather = opt.weather != null ? opt.weather : regionWeather(spec.region);
  if (!spec.features) { const feats = regionFeatures(spec.region, zoneMode); if (feats.length) spec.features = feats; }
  applyEncounterLayout(spec);
  // 有沙鱼的沙漠遭遇：配上尘虫 / 管虫（中立生物，不占代币，desert.js · DESERT.spawn）
  if (typeof addDesertNeutrals === "function") addDesertNeutrals(spec);
  spec.id = "roll:" + spec.region + ":" + (spec.faction || "") + ":" + spec.enemies.map(e => e.preset).join("+");
  return spec;
}

/** 区域默认天气 */
function regionWeather(region) {
  if (region === "沙漠") return Math.random() < 0.6 ? "sand" : "none";
  if (region === "第一采矿场") return Math.random() < 0.4 ? "acid" : "none";
  if (region === "第二采矿场") return Math.random() < 0.4 ? "heat" : "none";
  if (region === "第三采矿场") return Math.random() < 0.3 ? "glow" : "none";
  if (region === "巨人城") return Math.random() < 0.3 ? "thunder" : "none";
  return "none";
}

/** 区域自带的场地：第三采矿场 20% 有一个区是能量场（随机一区） */
function regionFeatures(region, zoneMode) {
  const out = [];
  if (region === "沙漠" && typeof desertFeatures === "function") out.push(...desertFeatures(zoneMode));   // 沙珊瑚台地 / 沙珊瑚枝
  if (region === "第三采矿场" && Math.random() < 0.2) {
    const n = Number(zoneMode) || 2;
    out.push({ type: "field", what: "energy", zone: 1 + Math.floor(Math.random() * n) });
  }
  return out;
}

function encounterById(id) {
  return ENCOUNTERS.find(e => e.id === id) || null;
}
function encountersByTier(tier, region) {
  return ENCOUNTERS.filter(e => e.tier === tier && (!region || e.region === region));
}

/** 按数据把敌人摆上场。返回摆好的单位数组。 */
function buildEncounter(spec, baseLevel, partySize) {
  if (!spec) return [];
  state.zoneMode = Number(spec.zoneMode) || 2;
  state.board = null;
  state.weather = spec.weather || "none"; state.weatherBy = null;
  state.playerWeatherChanges = 0;   // 本场我方主动改天气的次数（长线养成每日任务用）
  if (state.weather === "sand" && typeof rollSandDir === "function") rollSandDir();   // 开场沙暴：风向随机
  // 我方同阵营（跑团战斗模板）：这个阵营和能和它混编的阵营都算友军
  state.playerAllies = spec.allyFaction ? alliesOf(spec.allyFaction) : [];
  buildEncounterField(spec);
  const made = spawnEncounterRows(spec.enemies, baseLevel, partySize);
  applyBattlefieldFeatures(spec.features, baseLevel);
  return made;
}
/** 遭遇的区、棋盘、场地（不动天气）。连续战斗换到下一个区域时也用这个（chain.js） */
function buildEncounterField(spec) {
  state.zoneMode = Number(spec.zoneMode) || 2;
  state.board = null;
  state.fields = { 1: emptyField(), 2: emptyField(), 3: emptyField() };
  if (spec.board) applyBoard(spec.board);   // 特殊棋盘的遭遇（大型 boss）
  else if (state.gaps) {
    // 普通直排：上一场特殊棋盘留下的连接（1-3、2-4 …）不要带过来
    Object.keys(state.gaps).forEach(k => { if (k !== "1-2" && k !== "2-3") delete state.gaps[k]; });
    ["1-2", "2-3"].forEach(k => { if (!state.gaps[k]) state.gaps[k] = emptyGap(); });
  }
  // 换区域开新的一场：上一场的危墙 / 空隙 / 桥梁 / 门不带过来（遭遇自己的 gap 在 applyBattlefieldFeatures 里再摆）
  if (state.gaps) Object.keys(state.gaps).forEach(k => { state.gaps[k] = emptyGap(); });
  if (spec.fields) {
    Object.keys(spec.fields).forEach(z => { if (state.fields[z]) Object.assign(state.fields[z], spec.fields[z]); });
  }
}
/** 按遭遇里的敌人行摆上场：[{ preset, level, zone, count, bounty, mechanics }]。援军（chain.js）也用这个。返回摆好的单位 */
function spawnEncounterRows(rows, baseLevel, partySize) {
  const lv = (v) => {
    if (v == null) return baseLevel;
    if (typeof v === "string" && /^[+-]/.test(v)) return Math.max(1, baseLevel + Number(v));
    return Math.max(1, Number(v) || baseLevel);
  };
  const presets = enemyPresets();
  const made = [];
  (rows || []).forEach(row => {
    const p = presets.find(x => x.id === row.preset);
    if (!p) return;
    const n = Math.max(1, Number(row.count) || 1);
    for (let i = 0; i < n; i++) {
      // ufo_boss 是一体多部件，由既有的生成器负责
      if (row.preset === "ufo_boss" && typeof spawnUfoBoss === "function") {
        const pack = spawnUfoBoss(lv(row.level));
        (pack || []).forEach(u => {
          if (u.kit === "ufo_body") u.zone = Number(row.zone) || u.zone || 2;
          state.units.push(u);
          made.push(u);
        });
        continue;
      }
      const u = p.build(lv(row.level), partySize);
      // 个体值（enemies.js）：模板里主持人写死的水平照写，没写的随机
      // 种族（enemies.js）：先种族、再个体值；模板里写了种族的照写，空着 = 随机（固定种族的敌人照固定）
      if (typeof applyEnemyIV === "function") applyEnemyIV(u, row.iv, row.race);
      // near：跟着某个单位进场（援军赶到亡命之王身边），那个单位不在了就照写的区
      const nearU = row.near ? (state.units || []).find(x => !x.isPlayer && !x.dead && !x.hidden && x.kit === row.near) : null;
      u.zone = nearU ? Number(nearU.zone) : (Number(row.zone) || 2);
      if (row.bounty) makeBountyTarget(u, row.bounty);
      // 战斗模板（battle-templates.js）里预先挂好的首领机制
      if (Array.isArray(row.mechanics) && typeof addBossMechanic === "function") row.mechanics.forEach(m => addBossMechanic(u, JSON.parse(JSON.stringify(m))));
      // 主持人定的富集与否（沙鱼，desert.js）；不写就开战时随机
      if (typeof row.enriched === "boolean" && typeof desertSetEnriched === "function") desertSetEnriched(u, row.enriched);
      state.units.push(u);
      made.push(u);
    }
  });
  made.forEach(u => { if (typeof refreshEnemyEconomy === "function") refreshEnemyEconomy(u); });
  return made;
}

/** 摆上遭遇里带的配置物、场地、地形（单局按幕随机生成，见 rogue.js · rollBattlefield）
 *  features：[{ type: "prop" | "field" | "gap", what, zone, key, faction }] */
function applyBattlefieldFeatures(features, level) {
  if (!features || !features.length) return;
  state.props = state.props || [];
  state.gaps = state.gaps || { "1-2": emptyGap(), "2-3": emptyGap() };
  const EFFECT = { fire: "fire", acid: "acid", ice: "ice", electric: "electric", energy: "energy", harmonic: "harmonic", heal: "heal", quicksand: "quicksand", coral: "coral" };
  features.forEach(f => {
    if (f.type === "prop" && typeof makeProp === "function") {
      const p = makeProp(f.what, f.zone, f.level != null ? f.level : level);
      if (f.faction) p.faction = f.faction;
      state.props.push(p);
    } else if (f.type === "field") {
      const fl = state.fields[f.zone];
      if (!fl) return;
      if (EFFECT[f.what] && typeof setZoneField === "function") setZoneField(f.zone, EFFECT[f.what]);
      else fl[f.what] = true;
      // 塌陷区域的伤害骰按战斗等级（每 4 级 +1d10），以前单局生成的一直是 1 级
      if (f.what === "collapseOn") fl.collapseLv = Math.max(1, Number(f.level != null ? f.level : level) || 1);
    } else if (f.type === "gap" && f.key) {
      // 战斗模板可以写死耐久、机关门开着
      const hp = f.hp != null ? Number(f.hp) : typeof defaultGapHp === "function" ? defaultGapHp(f.what) : 10;
      state.gaps[f.key] = Object.assign(emptyGap(), { type: f.what, hp, maxHp: hp, open: f.what === "door" ? !!f.open : false, level: Number(level) || 1 });
    }
  });
  if (features.some(f => f.what === "battery") && typeof syncBatteryShields === "function") syncBatteryShields();
}

/* ===== 3. 单局状态 ============================================== */

/* 与「角色档案」（等级、属性、经验，跨局保留）分开：
 * 这里只存一局之内会变、跑完就清空的东西。 */

const RACE_LONG_REST = {
  human: { water: 1000, food: 2 },
  red: { water: 750, food: 2 },
  canine: { water: 1000, food: 2 },
  feline: { water: 750, food: 2 },
  rodent: { water: 500, food: 1 },
  bovine: { water: 1250, food: 2 },
  beast: { water: 1250, food: 3 }
};
/** 角色卡上没写种族键时，按 note 里的字样猜 */
function raceOf(u) {
  if (u && u.race && RACE_LONG_REST[u.race]) return u.race;
  const n = (u && u.note) || "";
  // 兽人要先判：「兽人-狼」里的「狼」不能被当成犬类人（和 ledger.js · heroRace 一致）
  if (/兽人/.test(n)) return "beast";
  if (/鼠类人|兔/.test(n)) return "rodent";
  if (/猫类人|豹|虎/.test(n)) return "feline";
  if (/犬类人|狐|犬|狼/.test(n)) return "canine";
  if (/牛类人|马|羊/.test(n)) return "bovine";
  if (/红皮人/.test(n)) return "red";
  return "human";
}
function longRestCost(u) {
  return RACE_LONG_REST[raceOf(u)] || RACE_LONG_REST.human;
}

const RUN = {
  active: false,
  seed: null,
  day: 1,
  hours: 0,          // 距上次长休过了多久，用来算力竭
  supplies: { water: 0, food: 0, kuizhi: 0 },
  shortRestLeft: {}, // kit → 剩余短休次数
  carry: {},         // kit → 战斗之间保留的状态
  log: [],

  start(opt) {
    opt = opt || {};
    this.active = true;
    this.seed = RNG.install(opt.seed || RNG.newSeed());
    this.day = 1;
    this.hours = 0;
    // 默认起始补给：够四人队做一次长休（4000 ml 水 · 8 份食物）还剩一点余量
    this.supplies = Object.assign({ water: 5000, food: 10, kuizhi: 2000 }, opt.supplies || {});
    this.shortRestLeft = {};
    this.carry = {};
    this.log = [`开局 · 种子 ${this.seed}`];
    return this.seed;
  },

  stop() {
    this.active = false;
    RNG.uninstall();
  },

  /** 战斗结束后：把队伍现在的状态记下来 */
  capture() {
    if (!this.active) return;
    (state.units || []).filter(u => u.isPlayer).forEach(u => {
      this.carry[u.kit] = {
        layers: persistentLayers(u),
        shp: Math.max(0, Number(u.shp) || 0),
        dead: !!u.dead,
        dying: !!u.dying,
        upOnShp: !!u.upOnShp,
        durability: u.resources ? u.resources.durability : undefined,
        weaponLevels: u.weaponLevels ? JSON.parse(JSON.stringify(u.weaponLevels)) : undefined,
        weaponParts: u.weaponParts ? JSON.parse(JSON.stringify(u.weaponParts)) : undefined,
        xp: Number(u.xp) || 0,
        level: Number(u.level) || 1
      };
    });
  },

  /** 新战斗开始后：把保留下来的状态盖回去 */
  apply() {
    if (!this.active) return;
    (state.units || []).filter(u => u.isPlayer).forEach(u => {
      const c = this.carry[u.kit];
      if (!c) return;
      if (c.level) { u.level = c.level; if (typeof applyLevelStats === "function" && !isWeaponUnit(u)) applyLevelStats(u); }
      u.xp = c.xp || 0;
      (u.layers || []).forEach((l, i) => {
        const s = (c.layers || [])[i];
        if (s && s.type === l.type) l.current = Math.max(0, Math.min(Number(l.max) || 0, s.current));
      });
      u.shp = Math.max(0, Math.min(Number(u.shpMax) || 0, c.shp));
      u.dead = !!c.dead;
      u.dying = !!c.dying;
      u.upOnShp = !!c.upOnShp;
      if (c.durability != null && u.resources) u.resources.durability = c.durability;
      if (c.weaponLevels) u.weaponLevels = JSON.parse(JSON.stringify(c.weaponLevels));
      if (c.weaponParts) {
        u.weaponParts = JSON.parse(JSON.stringify(c.weaponParts));
        if (typeof refreshOwnerWeaponAtk === "function") Object.keys(u.weaponParts).forEach(k => refreshOwnerWeaponAtk(u, k));
      }
    });
  },

  /** 一场战斗结束：武器耐久 −1，时间推进 */
  afterBattle(hours) {
    if (!this.active) return [];
    const notes = [];
    (state.units || []).filter(u => u.isPlayer).forEach(u => {
      if (!u.resources || u.resources.durability == null) return;
      const before = u.resources.durability;
      u.resources.durability = Math.max(0, before - 1);
      if (u.resources.durability !== before) notes.push(`${u.name} 武器耐久 ${before} → ${u.resources.durability}`);
      if (u.resources.durability === 0) notes.push(`${u.name} 的武器耐久归零，无法使用。`);
    });
    this.advance(Number(hours) || 1, notes);
    this.capture();
    return notes;
  },

  /** 推进时间，顺便判力竭 */
  advance(hours, notes) {
    notes = notes || [];
    this.hours += Math.max(0, Number(hours) || 0);
    const t = this.exhaustTier();
    if (t) notes.push(`距上次长休 ${this.hours} 小时：${this.exhaustName(t)}`);
    return notes;
  },
  exhaustTier() {
    if (this.hours >= 80) return 4;
    if (this.hours >= 60) return 3;
    if (this.hours >= 40) return 2;
    if (this.hours >= 20) return 1;
    return 0;
  },
  exhaustName(t) {
    return ["", "力竭（无法用 shp 起身）", "力竭 2（atk −3，def −1）", "力竭 3（被击倒立刻死亡）", "力竭致死"][t] || "";
  },

  shortRestCap(u) {
    // 熊兽人每天只能一次
    return /熊/.test((u && u.note) || "") ? 1 : 2;
  },

  /** 短休：恢复 等级×2+体质 点血量，一天两次 */
  shortRest() {
    if (!this.active) return ["还没开始一局。"];
    const notes = [];
    (state.units || []).filter(u => u.isPlayer && !isWeaponUnit(u) && !u.dead).forEach(u => {
      const cap = this.shortRestCap(u);
      const left = this.shortRestLeft[u.kit] == null ? cap : this.shortRestLeft[u.kit];
      if (left <= 0) { notes.push(`${u.name} 今天的短休次数已用完。`); return; }
      const con = (u.attrs && Number(u.attrs.con)) || 0;
      const heal = (Number(u.level) || 1) * 2 + con;
      if (typeof healUnit === "function") healUnit(u, heal);
      this.shortRestLeft[u.kit] = left - 1;
      notes.push(`${u.name} 短休恢复 ${heal} 点（今日剩 ${left - 1} 次）。`);
    });
    this.advance(1, notes);
    this.capture();
    return notes;
  },

  /** 长休需要的补给总量 */
  longRestCost() {
    let water = 0, food = 0;
    (state.units || []).filter(u => u.isPlayer && !isWeaponUnit(u) && !u.dead).forEach(u => {
      const c = longRestCost(u);
      water += c.water;
      food += c.food;
    });
    return { water, food };
  },

  /** 长休：全回血、补满短休次数、耐久回满、shp 每小时 +2 */
  longRest(hours) {
    if (!this.active) return ["还没开始一局。"];
    hours = Math.min(12, Math.max(8, Number(hours) || 8));
    const cost = this.longRestCost();
    const notes = [];
    if (this.supplies.water < cost.water || this.supplies.food < cost.food) {
      notes.push(`补给不足，无法长休（需要 ${cost.water} ml 水 · ${cost.food} 份食物，现有 ${this.supplies.water} ml · ${this.supplies.food} 份）。只能消磨时间。`);
      this.advance(hours, notes);
      return notes;
    }
    this.supplies.water -= cost.water;
    this.supplies.food -= cost.food;
    notes.push(`长休 ${hours} 小时，消耗 ${cost.water} ml 水 · ${cost.food} 份食物。`);
    (state.units || []).filter(u => u.isPlayer && !u.dead).forEach(u => {
      (u.layers || []).forEach(l => { l.current = l.max; });
      u.dying = false;
      u.upOnShp = false;
      const shpBefore = Number(u.shp) || 0;
      u.shp = Math.min(Number(u.shpMax) || 0, shpBefore + hours * 2);
      if (u.resources && u.resources.durability != null && u.weaponOf) {
        u.resources.durability = durabilityMaxOf(u);
      }
      this.shortRestLeft[u.kit] = this.shortRestCap(u);
      notes.push(`${u.name} 血量回满，坚毅 ${shpBefore} → ${u.shp}。`);
    });
    this.hours = 0;
    this.day += 1;
    notes.push(`进入第 ${this.day} 天。`);
    this.capture();
    return notes;
  },

  /** 存档用 */
  save() {
    return {
      seed: this.seed,
      draws: RNG.draws(),
      day: this.day,
      hours: this.hours,
      supplies: JSON.parse(JSON.stringify(this.supplies)),
      shortRestLeft: JSON.parse(JSON.stringify(this.shortRestLeft)),
      carry: JSON.parse(JSON.stringify(this.carry)),
      log: this.log.slice(-50)
    };
  },
  load(s) {
    if (!s) return false;
    this.active = true;
    RNG.restore(s.seed, s.draws);
    this.seed = s.seed;
    this.day = s.day || 1;
    this.hours = s.hours || 0;
    this.supplies = Object.assign({ water: 0, food: 0, kuizhi: 0 }, s.supplies || {});
    this.shortRestLeft = s.shortRestLeft || {};
    this.carry = s.carry || {};
    this.log = s.log || [];
    return true;
  }
};

/** 武器人的耐久上限：按等级算，和 growth.js 的成长一致 */
function durabilityMaxOf(u) {
  if (!u || !u.weaponOf) return 0;
  if (typeof weaponBaseDur === "function") return weaponBaseDur(u.kit, u.level);
  const g = (typeof WEAPON_GROWTH !== "undefined") ? WEAPON_GROWTH[u.kit] : null;
  const base = g && g.baseDur != null ? g.baseDur : 5;
  return base + Math.floor((Number(u.level) || 1) / 2);
}
