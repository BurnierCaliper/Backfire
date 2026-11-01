function livePartyCards() {
  return [
    {
      kit: "ruby",
      enName: "Rabbie",
      name: "瑞比",
      level: 1,
      zone: 1,
      personalAtk: 5,
      weaponAtk: 7,
      atk: 12,
      def: 3,
      defMax: 3,
      flying: false,
      isPlayer: true,
      range: "any",
      suggest: { element: "energy", dice: [1, 4], flat: 0, baseBreak: 1 },
      layers: [{ type: "flesh", hp: 12 }],
      shp: 11,
      shpMax: 11,
      resources: { nano: 40, prepared: false, smashNext: false },
      linkedKits: ["mint"],
      note: "人类黑客 · 能量/电 · 直伤专精",
      attrs: { str: 6, con: 5, dex: 8, wil: 6, int: 9, sta: 4 },
      roles: { primary: "直伤", secondary: "直伤" },
      xp: 0,
      attrPoints: 0
    },
    {
      kit: "mint",
      enName: "M1NT-C4D",
      name: "M1NT-C4D",
      level: 1,
      zone: 1,
      personalAtk: 7,
      weaponAtk: 0,
      atk: 7,
      def: 3,
      defMax: 3,
      flying: false,
      isPlayer: true,
      range: "any",
      suggest: { element: "electric", dice: [0, 4], flat: 0, baseBreak: 0 },
      layers: [{ type: "armor", hp: 8 }],
      resources: { durability: 5 },
      weaponOf: "ruby",
      note: "瑞比的武器"
    },
    {
      kit: "yuito",
      enName: "Yuhito",
      name: "结人",
      level: 1,
      zone: 1,
      personalAtk: 3,
      weaponAtk: 4,
      atk: 7,
      def: 5,
      defMax: 5,
      flying: false,
      isPlayer: true,
      range: "any",
      suggest: { element: "ice", dice: [0, 4], flat: 0, baseBreak: 1 },
      layers: [{ type: "flesh", hp: 14 }],
      shp: 11,
      shpMax: 11,
      resources: { bean: 1, liquid: 0, bondId: null },
      linkedKits: ["latte"],
      note: "猫类人医生 · 冰/酸 · 辅助生存",
      attrs: { str: 3, con: 6, dex: 7, wil: 6, int: 8, sta: 7 },
      roles: { primary: "辅助", secondary: "生存" },
      xp: 0,
      attrPoints: 0
    },
    {
      kit: "latte",
      enName: "Latte",
      name: "拿铁",
      level: 1,
      zone: 1,
      personalAtk: 4,
      weaponAtk: 0,
      atk: 4,
      def: 3,
      defMax: 3,
      flying: false,
      isPlayer: true,
      range: "any",
      suggest: { element: "acid", dice: [0, 4], flat: 0, baseBreak: 1 },
      layers: [{ type: "armor", hp: 8 }],
      resources: { durability: 6 },
      weaponOf: "yuito",
      note: "结人的武器"
    },
    {
      kit: "hiaki",
      enName: "Hiaki",
      name: "绯秋",
      level: 1,
      zone: 1,
      personalAtk: 6,
      weaponAtk: 6,
      atk: 12,
      def: 5,
      defMax: 5,
      flying: false,
      isPlayer: true,
      range: "any",
      suggest: { element: "fire", dice: [0, 4], flat: 0, baseBreak: 1 },
      layers: [{ type: "flesh", hp: 14 }],
      shp: 13,
      shpMax: 13,
      resources: { stance: "draw", blade: "niu", smashOnce: true, niuOut: false, narutoOut: false },
      linkedKits: ["niu", "naruto"],
      note: "狐类人流民 · 火/冰 · 击破护卫",
      attrs: { str: 8, con: 6, dex: 5, wil: 8, int: 5, sta: 6 },
      roles: { primary: "击破", secondary: "护卫" },
      xp: 0,
      attrPoints: 0
    },
    {
      kit: "niu",
      enName: "Nibutani",
      name: "丹生谷",
      level: 1,
      zone: 1,
      personalAtk: 6,
      weaponAtk: 0,
      atk: 6,
      def: 3,
      defMax: 3,
      flying: false,
      isPlayer: true,
      range: "melee",
      suggest: { element: "fire", dice: [0, 4], flat: 0, baseBreak: 1 },
      layers: [{ type: "armor", hp: 8 }],
      resources: { durability: 5 },
      weaponOf: "hiaki",
      note: "绯秋 · 火刀"
    },
    {
      kit: "naruto",
      enName: "Naruto",
      name: "鳴門",
      level: 1,
      zone: 1,
      personalAtk: 5,
      weaponAtk: 0,
      atk: 5,
      def: 3,
      defMax: 3,
      flying: false,
      isPlayer: true,
      range: "any",
      suggest: { element: "ice", dice: [0, 4], flat: 0, baseBreak: 1 },
      layers: [{ type: "armor", hp: 7 }],
      resources: { durability: 5 },
      weaponOf: "hiaki",
      note: "绯秋 · 冰刀"
    },
    {
      kit: "tou",
      enName: "Akari",
      name: "灯",
      level: 1,
      zone: 1,
      personalAtk: 5,
      weaponAtk: 5,
      atk: 10,
      def: 6,
      defMax: 6,
      flying: false,
      isPlayer: true,
      range: "any",
      suggest: { element: "physical", dice: [0, 4], flat: 0, baseBreak: 1 },
      layers: [{ type: "flesh", hp: 20 }],
      shp: 13,
      shpMax: 13,
      resources: { shield: 1, tauntLeft: 2 },
      linkedKits: ["mochi"],
      note: "犬类人士兵 · 物理/谐波 · 坦克控场",
      attrs: { str: 6, con: 9, dex: 4, wil: 8, int: 3, sta: 8 },
      roles: { primary: "坦克", secondary: "控场" },
      xp: 0,
      attrPoints: 0
    },
    {
      kit: "mochi",
      enName: "Mochi",
      name: "年糕",
      level: 1,
      zone: 1,
      personalAtk: 5,
      weaponAtk: 0,
      atk: 5,
      def: 4,
      defMax: 4,
      flying: false,
      isPlayer: true,
      range: "any",
      suggest: { element: "physical", dice: [1, 4], flat: 0, baseBreak: 1 },
      layers: [{ type: "armor", hp: 12 }],
      resources: { durability: 6 },
      weaponOf: "tou",
      note: "灯的武器"
    },
    {
      kit: "xia",
      enName: "Xia",
      name: "夕夏",
      level: 1,
      zone: 1,
      personalAtk: 5,
      weaponAtk: 8,
      atk: 13,
      def: 5,
      defMax: 5,
      flying: false,
      isPlayer: true,
      range: "melee",
      suggest: { element: "physical", dice: [1, 4], flat: 0, baseBreak: 2 },
      layers: [{ type: "flesh", hp: 14 }],
      shp: 14,
      shpMax: 14,
      resources: { engine: false, attackedThisTurn: false, prepared: false },
      linkedKits: ["berniel"],
      note: "人类汽修工 · 火/物理 · 直伤击破",
      attrs: { str: 7, con: 6, dex: 4, wil: 9, int: 5, sta: 7 },
      roles: { primary: "直伤", secondary: "击破" },
      xp: 0,
      attrPoints: 0
    },
    {
      kit: "berniel",
      enName: "Berniel",
      name: "柏妮尔·卡莉帕",
      level: 1,
      zone: 1,
      personalAtk: 8,
      weaponAtk: 0,
      atk: 8,
      def: 3,
      defMax: 3,
      flying: false,
      isPlayer: true,
      range: "melee",
      suggest: { element: "fire", dice: [0, 4], flat: 0, baseBreak: 0 },
      layers: [{ type: "armor", hp: 10 }],
      resources: { durability: 5 },
      weaponOf: "xia",
      note: "夕夏的武器"
    },
    {
      kit: "chuan",
      enName: "Harley",
      name: "川川",
      level: 1,
      zone: 1,
      personalAtk: 3,
      weaponAtk: 5,
      atk: 8,
      def: 6,
      defMax: 6,
      flying: false,
      isPlayer: true,
      range: "any",
      suggest: { element: "electric", dice: [1, 4], flat: 0, baseBreak: 1 },
      layers: [{ type: "flesh", hp: 16 }],
      shp: 10,
      shpMax: 10,
      resources: { charge: 0 },
      linkedKits: ["bili"],
      note: "犬类人电工 · 电/能量 · 护卫控场",
      attrs: { str: 3, con: 7, dex: 8, wil: 5, int: 7, sta: 8 },
      roles: { primary: "护卫", secondary: "控场" },
      xp: 0,
      attrPoints: 0
    },
    {
      kit: "bili",
      enName: "Bili",
      name: "哔哩哩&滋啦啦",
      level: 1,
      zone: 1,
      personalAtk: 5,
      weaponAtk: 0,
      atk: 5,
      def: 3,
      defMax: 3,
      flying: false,
      isPlayer: true,
      range: "ranged",
      suggest: { element: "electric", dice: [0, 4], flat: 0, baseBreak: 0 },
      layers: [{ type: "shield", hp: 10 }],
      resources: { durability: 6 },
      weaponOf: "chuan",
      note: "川川的武器"
    },
    {
      kit: "nora",
      enName: "Nora",
      name: "诺拉",
      level: 1,
      zone: 1,
      personalAtk: 3,
      weaponAtk: 7,
      atk: 10,
      def: 5,
      defMax: 5,
      flying: false,
      isPlayer: true,
      range: "ranged",
      suggest: { element: "ice", dice: [1, 4], flat: 0, baseBreak: 1 },
      layers: [{ type: "flesh", hp: 10 }],
      shp: 12,
      shpMax: 12,
      // mood：温和 gentle / 残忍 cruel；piercedId：当前被刺入的单位
      resources: { mood: "gentle", piercedId: null },
      linkedKits: ["vitas"],
      note: "猫类人档案员 · 冰/谐波 · 异常生存",
      attrs: { str: 3, con: 4, dex: 8, wil: 7, int: 9, sta: 6 },
      roles: { primary: "异常", secondary: "生存" },
      xp: 0,
      attrPoints: 0
    },
    {
      kit: "vitas",
      enName: "Vitas",
      name: "维塔斯",
      level: 1,
      zone: 1,
      personalAtk: 7,
      weaponAtk: 0,
      atk: 7,
      def: 4,
      defMax: 4,
      flying: false,
      isPlayer: true,
      range: "melee",
      suggest: { element: "ice", dice: [0, 4], flat: 0, baseBreak: 1 },
      // 左侧为内层：装甲 5 是内层，护盾 6 在外
      layers: [{ type: "shield", hp: 6 }, { type: "armor", hp: 5 }],
      resources: { durability: 4 },
      weaponOf: "nora",
      note: "诺拉的武器"
    },
    {
      kit: "kolt",
      enName: "Kolt",
      name: "柯尔特",
      level: 1,
      zone: 1,
      personalAtk: 6,
      weaponAtk: 4,
      atk: 10,
      def: 6,
      defMax: 6,
      flying: false,
      isPlayer: true,
      range: "any",
      suggest: { element: "electric", dice: [0, 4], flat: 0, baseBreak: 2 },
      layers: [{ type: "flesh", hp: 20 }],
      shp: 8,
      shpMax: 8,
      resources: { bit: "drill", tauntLeft: 2 },
      linkedKits: ["torque"],
      note: "兽人-狼士兵 · 电/酸 · 坦克专精",
      attrs: { str: 8, con: 9, dex: 3, wil: 3, int: 7, sta: 9 },
      roles: { primary: "坦克", secondary: "坦克" },
      xp: 0,
      attrPoints: 0
    },
    {
      kit: "torque",
      enName: "Torque",
      name: "扭矩",
      level: 1,
      zone: 1,
      personalAtk: 4,
      weaponAtk: 0,
      atk: 4,
      def: 4,
      defMax: 4,
      flying: false,
      isPlayer: true,
      range: "any",
      suggest: { element: "electric", dice: [0, 4], flat: 0, baseBreak: 2 },
      layers: [{ type: "armor", hp: 14 }],
      resources: { durability: 6 },
      weaponOf: "kolt",
      note: "柯尔特的武器"
    },
    {
      kit: "helu",
      enName: "Helumica",
      name: "Helumica",
      level: 1,
      zone: 1,
      personalAtk: 3,
      weaponAtk: 6,
      atk: 9,
      def: 5,
      defMax: 5,
      flying: false,
      isPlayer: true,
      range: "ranged",
      suggest: { element: "harmonic", dice: [0, 4], flat: 0, baseBreak: 1 },
      layers: [{ type: "flesh", hp: 16 }],
      shp: 12,
      shpMax: 12,
      resources: { scanned: false, lockLeft: 1 },
      linkedKits: ["ecmo"],
      note: "猫类人电工 · 谐波/物理 · 环境手专精",
      attrs: { str: 3, con: 7, dex: 4, wil: 7, int: 9, sta: 7 },
      roles: { primary: "环境手", secondary: "环境手" },
      xp: 0,
      attrPoints: 0
    },
    {
      kit: "ecmo",
      enName: "Ecmo",
      name: "Ecmo/7418",
      level: 1,
      zone: 1,
      personalAtk: 6,
      weaponAtk: 0,
      atk: 6,
      def: 3,
      defMax: 3,
      flying: true,
      isPlayer: true,
      range: "melee",
      suggest: { element: "physical", dice: [0, 4], flat: 0, baseBreak: 1 },
      layers: [{ type: "armor", hp: 8 }],
      resources: { durability: 4 },
      weaponOf: "helu",
      note: "Helumica的武器"
    },
    {
      kit: "ras",
      enName: "Rasmur",
      name: "拉斯缪尔",
      level: 1,
      zone: 1,
      personalAtk: 6,
      weaponAtk: 6,
      atk: 12,
      def: 3,
      defMax: 3,
      flying: false,
      isPlayer: true,
      range: "ranged",
      suggest: { element: "energy", dice: [0, 4], flat: 0, baseBreak: 1 },
      layers: [{ type: "flesh", hp: 16 }],
      shp: 13,
      shpMax: 13,
      resources: { energyPct: 0, light: 0, unstable: false },
      linkedKits: ["edc"],
      note: "人类科学家 · 能量/电 · 直伤专精",
      attrs: { str: 8, con: 7, dex: 3, wil: 8, int: 9, sta: 3 },
      roles: { primary: "直伤", secondary: "直伤" },
      xp: 0,
      attrPoints: 0
    },
    {
      kit: "edc",
      enName: "EDC30k",
      name: "EDC30k",
      level: 1,
      zone: 1,
      personalAtk: 6,
      weaponAtk: 0,
      atk: 6,
      def: 4,
      defMax: 4,
      flying: false,
      isPlayer: true,
      range: "any",
      suggest: { element: "electric", dice: [0, 4], flat: 0, baseBreak: 1 },
      layers: [{ type: "armor", hp: 10 }],
      resources: { durability: 5 },
      weaponOf: "ras",
      note: "拉斯缪尔的武器"
    },
    {
      kit: "longge",
      enName: "Longfei",
      name: "龙哥",
      level: 1,
      zone: 1,
      personalAtk: 4,
      weaponAtk: 5,
      atk: 9,
      def: 5,
      defMax: 5,
      flying: false,
      isPlayer: true,
      range: "any",
      suggest: { element: "ice", dice: [0, 4], flat: 0, baseBreak: 1 },
      layers: [{ type: "flesh", hp: 16 }],
      shp: 11,
      shpMax: 11,
      // trigger：扳机解锁（霰弹枪模式）；ammo：剩下的胶囊弹药（按顺序，"red" 火 / "blue" 冰）；known：从队首数已经窥探到的枚数
      resources: { trigger: false, ammo: [], seen: [], known: 0, spitUsed: false },
      linkedKits: ["xiaoxiao"],
      note: "兽人-蜥蜴典当行 · 冰/火 · 生存专精",
      attrs: { str: 5, con: 7, dex: 6, wil: 6, int: 8, sta: 7 },
      roles: { primary: "生存", secondary: "生存" },
      xp: 0,
      attrPoints: 0
    },
    {
      kit: "xiaoxiao",
      enName: "Xiaoxiao",
      name: "小朋友",
      level: 1,
      zone: 1,
      personalAtk: 5,
      weaponAtk: 0,
      atk: 5,
      def: 4,
      defMax: 4,
      flying: false,
      isPlayer: true,
      range: "melee",
      suggest: { element: "physical", dice: [0, 4], flat: 0, baseBreak: 2 },
      layers: [{ type: "armor", hp: 12 }],
      resources: { durability: 5 },
      weaponOf: "longge",
      note: "龙哥的武器（小小）"
    }
  ];
}

/* ---------- 出身与熟练项（手册第一章「检定」、第四步「出身职业」、第五步「熟练项」） ----------
 * 数据照作者给的角色资料：瑞比 / 结人 / 绯秋 / 灯（实况组测试）、夕夏 / 川川 / 诺拉（武器商），
 * 柯尔特 / Helumica / 拉斯缪尔（角色卡表格）。熟练项已经算进了本职、种族自带和两项业余。
 *   柯尔特：表格里追踪只填了 1；士兵本职的追踪 + 兽人·狼自带的追踪叠成 2（同灯的算法）。
 *   Helumica：电工本职两项 + 猫自带侦察 + 业余欺瞒、躲藏（躲藏是作者补的，表格里漏了）。 */
const PROFICIENCIES = {
  "行动类": ["运动", "攀爬", "躲藏", "盗窃", "巧手", "载具驾驶", "求生"],
  "知识类": ["历史", "科技理论"],
  "技术类": ["机械维修", "电器维修", "数据操作", "植入体研究", "医疗"],
  "调查类": ["侦察", "聆听", "洞悉", "追踪", "评估"],
  "交涉类": ["威吓", "说服", "欺瞒", "表演"]
};
const PROF_LIST = Object.keys(PROFICIENCIES).reduce((a, k) => a.concat(PROFICIENCIES[k]), []);
const PROF_MAX = 3;
const PROF_ALIAS = { "生存": "求生", "侦查": "侦察" };
const profName = (n) => PROF_ALIAS[n] || n;
function profCategory(name) {
  name = profName(name);
  return Object.keys(PROFICIENCIES).find(k => PROFICIENCIES[k].indexOf(name) >= 0) || null;
}

const HERO_PROFILES = {
  ruby:  { race: "人类",      job: "黑客",   profs: { "数据操作": 2, "巧手": 1, "追踪": 1 } },
  yuito: { race: "猫类人-猫", job: "医生",   profs: { "侦察": 1, "医疗": 2, "聆听": 1, "载具驾驶": 1 } },
  hiaki: { race: "犬类人-狐", job: "流民",   profs: { "躲藏": 1, "求生": 1, "欺瞒": 1, "巧手": 1, "洞悉": 1 } },
  tou:   { race: "犬类人-犬", job: "士兵",   profs: { "运动": 1, "追踪": 2, "侦察": 1, "说服": 1 } },
  xia:   { race: "人类",      job: "汽修工", profs: { "机械维修": 1, "巧手": 1, "运动": 1, "侦察": 1 } },
  chuan: { race: "犬类人-犬", job: "电工",   profs: { "追踪": 1, "电器维修": 1, "评估": 1, "求生": 1, "聆听": 1 } },
  nora:  { race: "猫类人-猫", job: "档案员", profs: { "历史": 1, "聆听": 1, "医疗": 1, "说服": 1, "侦察": 1 } },
  kolt:  { race: "兽人-狼",   job: "士兵",   profs: { "运动": 1, "追踪": 2, "机械维修": 1, "电器维修": 1 } },
  helu:  { race: "猫类人-猫", job: "电工",   profs: { "电器维修": 1, "评估": 1, "侦察": 1, "欺瞒": 1, "躲藏": 1 } },
  ras:   { race: "人类",      job: "科学家", profs: { "科技理论": 1, "数据操作": 1, "运动": 1, "电器维修": 1 } },
  // 龙哥：角色卡表格（典当行本职评估 / 盗窃，业余医疗 + 评估再一次 → 评估 2）
  longge: { race: "兽人-蜥蜴", job: "典当行", profs: { "评估": 2, "盗窃": 1, "医疗": 1 } }
};
function heroProfile(kit) { return HERO_PROFILES[kit] || null; }

/* 种族特长里和检定有关的部分（手册第一步「种族」）
 *   reroll    检定失败后重掷一次（人类 · 迎难直上）
 *   adv       这些熟练项 / 这一类检定带优势；dis 带劣势
 *   lowHpDis  血量低于一半时所有检定劣势（牛类人）
 *   softFail  检定失败往往不会撞上最严重的后果（鼠 · 环境适应）：受伤减半 */
const RACE_CHECK_PERKS = {
  "人类":      { reroll: true, text: "迎难直上：失败后重掷一次" },
  "猫类人-猫": { adv: ["侦察", "躲藏"], text: "夜视：侦察 / 躲藏类检定优势" },
  "鼠类人-鼠": { softFail: true, text: "环境适应：检定失败受伤减半" },
  "鼠类人-兔": { adv: ["调查类"], text: "听觉敏锐：调查类检定优势" },
  "牛类人-牛": { lowHpDis: true, text: "血量低于一半时检定劣势" },
  "牛类人-马": { lowHpDis: true, text: "血量低于一半时检定劣势" },
  "牛类人-羊": { lowHpDis: true, adv: ["说服"], dis: ["威吓"], text: "温和气场：说服优势、威吓劣势；血量低于一半时检定劣势" }
};
/** 这个人做这项检定有没有优势 / 劣势、能不能重掷。hpLow：血量是否低于一半 */
function checkPerksFor(kit, prof, hpLow) {
  const p = heroProfile(kit);
  const r = (p && RACE_CHECK_PERKS[p.race]) || {};
  const hit = (list) => (list || []).some(x => x === profName(prof) || x === profCategory(prof));
  let adv = hit(r.adv), dis = hit(r.dis) || (!!r.lowHpDis && !!hpLow);
  if (adv && dis) { adv = false; dis = false; }   // 优劣相抵
  return { adv, dis, reroll: !!r.reroll, softFail: !!r.softFail, text: r.text || "" };
}

function skillCost(id) {
  if (id === "sand_pull") return { bonus: 1 };
  if (/^veh_/.test(String(id)) && typeof vehicleSkillCost === "function") return vehicleSkillCost(id);   // 载具：上车 / 拉人 1 行动点，下车不花，冲撞 1 附赠（vehicle.js）
  // 人器一心（feats.js）：唤出武器人只花附赠（每场一次），武器人变回武器不花行动点
  const featAdj = typeof featCostAdjust === "function" ? featCostAdjust(id) : null;
  if (featAdj) return featAdj;
  // 专长动作：按专长里写的消耗（默认 1 行动点）
  const featCost = typeof featSkillCost === "function" ? featSkillCost(id) : null;
  if (featCost) return featCost;
  // 义体（cyberware.js）：按义体表里写的消耗（默认 1 行动点）
  const cwCost = typeof cyberwareSkillCost === "function" ? cyberwareSkillCost(id) : null;
  if (cwCost) return cwCost;
  // 不稳超导：拉斯缪尔已经处于不稳态时免费释放
  if (id === "ras_super") {
    const r = typeof state !== "undefined" && typeof findKit === "function" ? findKit("ras", state.units) : null;
    if (r && r.resources && r.resources.unstable) return {};
  }
  // 汲取：汲取生效时再用一次不耗行动点（结束汲取）
  if (id === "edc_siphon") {
    const r = typeof state !== "undefined" && typeof findKit === "function" ? findKit("ras", state.units) : null;
    if (r && r.resources && r.resources.siphon) return {};
    return { ap: 1 };
  }
  if (id === "yuito_inspire") {
    const fl = typeof state !== "undefined" ? state.skillFlow : null;
    if (fl && fl.picks && fl.picks.mode === "stay") return { ap: 1 };
    return { bonus: 1 };
  }
  // 不倒战意 15 级：选「全部友方」时改用行动点
  if (id === "role_sturdy") {
    const fl = typeof state !== "undefined" ? state.skillFlow : null;
    // 兼修·鼓劲（feats.js · rouse）是 feat_rouse 调用 role_sturdy，分步的 id 是 feat_rouse，选全部友方同样改收行动点
    const isSturdy = fl && (fl.id === "role_sturdy" || (typeof featDelegateBaseOf === "function" && featDelegateBaseOf(fl.id) === "role_sturdy"));
    if (isSturdy && fl.picks && fl.picks.mode === "all") return { ap: 1 };
    return { bonus: 1 };
  }
  const map = {
    ruby_aa: { ap: 1 }, ruby_trigger: { ap: 1 }, ruby_prep: { bonus: 1 }, ruby_assist: {},
    ruby_summon: { ap: 1, bonus: 1 }, ruby_boom: {}, wing_aa: { ap: 1 }, wing_steal: { ap: 1 },
    wing_assist: {}, ruby_unmecha: {},
    mint_mecha: {}, mint_steal: { ap: 1 }, mint_return: { ap: 1 },
    yuito_aa: { ap: 1 }, yuito_amer: { ap: 1 }, yuito_assist: {},
    yuito_summon: { ap: 1, bonus: 1 },
    latte_puff: { ap: 1 }, latte_ice: { ap: 1 }, latte_return: { ap: 1 },
    hiaki_aa: { ap: 1 }, hiaki_sheath: { ap: 1 }, hiaki_allin: { bonus: 1 }, hiaki_assist: {},
    hiaki_summon: { ap: 1, bonus: 1 },
    niu_slash: { ap: 1 }, niu_return: { ap: 1 },
    naruto_wind: { ap: 1 }, naruto_return: { ap: 1 },
    tou_aa: { ap: 1 }, tou_start: { ap: 1 }, tou_taunt: { bonus: 1 }, tou_assist: {},
    tou_summon: { ap: 1, bonus: 1 }, tou_range: {},
    mochi_pounce: { ap: 1 }, mochi_roar: { ap: 1 }, mochi_return: { ap: 1 },
    assist_block: { bonus: 1 },
    bare_aa: { ap: 1 },
    ruby_surge: { ap: 1 }, ruby_short: { ap: 1 }, wing_surge: { ap: 1 },
    mint_banish: { ap: 1 },
    yuito_espresso: { ap: 1 }, yuito_extract: { ap: 1 }, latte_love: { ap: 1 },
    hiaki_flash: { ap: 1 }, hiaki_pot: { ap: 1 }, niu_tsubame: { ap: 1 }, naruto_fly: { ap: 1 },
    tou_sonic: { ap: 1 }, tou_ultra: { ap: 1 }, mochi_boom: { ap: 1 },
    role_refine: { bonus: 1 }, role_firstaid: { ap: 1 }, role_cover: { bonus: 1 }, role_pull: { bonus: 1 },
    role_pierce: { bonus: 1 }, role_gambit: { ap: 1 },
    role_double_dot: { bonus: 1 }, role_self_doom: { bonus: 1 },
    role_halve: { ap: 1 }, role_omen: { ap: 1 },
    role_grit: { bonus: 1 }, role_stand: { ap: 1 },
    role_guard_strike: { ap: 1 }, role_all_reflect: { ap: 1 },
    role_dome: { ap: 1 }, role_renew: { ap: 1 },
    role_harsh: { bonus: 1 }, role_apocalypse: { ap: 1 },
    role_shake: { ap: 1 }, role_rearrange: { ap: 1 },
    role_gold: { bonus: 1 }, role_rally: { ap: 1 },
    role_spread: { ap: 1 }, role_breakwave: { bonus: 1 },
    role_lockdown: { ap: 1 }, role_fear: { ap: 1 },
    role_buffer: { bonus: 1 }, role_shelter: { bonus: 1 },
    role_boost: { bonus: 1 }, role_sturdy: { bonus: 1 },
    role_activate: { bonus: 1 }, role_lock: { bonus: 1 },
    fx_combust: {}, fx_icebreak: {}, fx_bolt: {}, fx_etch: {}, fx_backflow: {}, fx_inertia: {}, fx_diffract: {},
    xia_aa: { ap: 1 }, xia_engine: { ap: 1 }, xia_prep: { bonus: 1 }, xia_assist: {},
    xia_selfburn: { ap: 1 }, xia_crush: { ap: 1 },
    chuan_pulse: { ap: 1 }, chuan_blade: { ap: 1 },
    xia_summon: { ap: 1, bonus: 1 }, xia_execute: { ap: 1 }, xia_ram: { ap: 1 },
    berniel_spit: { ap: 1 }, berniel_ignite: { ap: 1 }, berniel_dash: { ap: 1 }, berniel_flare: { ap: 1 }, berniel_return: { ap: 1 },
    chuan_aa: { ap: 1 }, chuan_whip: { ap: 1 }, chuan_cover: { bonus: 1 }, chuan_assist: {},
    chuan_summon: { ap: 1, bonus: 1 }, chuan_wall: { ap: 1 }, chuan_over: { ap: 1 }, chuan_reclaim: { bonus: 1 }, ruby_refuel: { bonus: 1 },
    bili_beam: { ap: 1 }, bili_magnet: { ap: 1 }, bili_field: { ap: 1 }, bili_storm: { ap: 1 }, bili_return: { ap: 1 },
    nora_aa: { ap: 1 }, nora_needle: { ap: 1 }, nora_assist: {},
    nora_summon: { ap: 1, bonus: 1 },
    nora_soothe: { bonus: 1 }, nora_indwell: { ap: 1 },
    nora_pressure: { ap: 1 }, nora_sonic: { ap: 1 },
    vitas_infuse: { ap: 1 }, vitas_rip: { ap: 1 }, vitas_slash: { ap: 1 }, vitas_dance: { ap: 1 },
    vitas_return: { ap: 1 },
    kolt_aa: { ap: 1 }, kolt_short: { ap: 1 }, kolt_chase: { bonus: 1 },
    kolt_assist: {}, kolt_summon: { ap: 1, bonus: 1 }, kolt_scrap: { ap: 1 }, kolt_rot: { ap: 1 }, kolt_mod: { ap: 1 },
    torque_boost: { ap: 1 }, torque_swap: { ap: 1 }, torque_strip: { ap: 1 }, torque_return: { ap: 1 },
    helu_aa: { ap: 1 }, helu_wave: { ap: 1 }, helu_storm: { ap: 1 }, helu_scan: { ap: 1 }, helu_assist: {},
    helu_rule: { ap: 1 }, helu_forge: { ap: 1 },   // 卡面特别写出来的技能都花行动点（作者 10/23）
    helu_summon: { ap: 1, bonus: 1 },
    ecmo_bite: { ap: 1 }, ecmo_focus: { ap: 1 }, ecmo_boom: { ap: 1 }, ecmo_return: { ap: 1 },
    ras_aa: { ap: 1 }, ras_dump: { ap: 1 }, ras_flee: { ap: 1 }, ras_super: { ap: 1 }, ras_rampage: { ap: 1 }, ras_assist: {},
    ras_summon: { ap: 1, bonus: 1 },
    edc_drain: { ap: 1 }, edc_shock: { ap: 1 }, edc_flash: { ap: 1 }, edc_return: { ap: 1 },
    longge_aa: { ap: 1 }, longge_chill: { ap: 1 }, longge_spit: { bonus: 1 }, longge_assist: {}, longge_safety: { ap: 1 },
    longge_heat: { ap: 1 }, longge_drink: { ap: 1 }, longge_shuffle: { ap: 1 }, longge_reload: { ap: 1 },
    xiaoxiao_burst: { ap: 1 },
    kolt_cannon: { ap: 1 }, torque_divert: { ap: 1 }, ecmo_probe: { ap: 1 }, ras_torrent: { ap: 1 },
    ruby_algo: { ap: 1 }, ruby_relay: { ap: 1 }, wing_relay: { ap: 1 }, mint_repair: { ap: 1 }, wing_boost: {},
    yuito_cold: { ap: 1 }, yuito_duet: { ap: 1 }, latte_claw: { ap: 1 }, hiaki_barrage: { ap: 1 }, hiaki_powder: { ap: 1 },
    niu_standby: { ap: 1 }, naruto_frost: { ap: 1 }, tou_bash: { ap: 1 }, tou_accuse: { ap: 1 }, mochi_bite: { ap: 1 },
    longge_summon: { ap: 1, bonus: 1 },
    xiaoxiao_punch: { ap: 1 }, xiaoxiao_heal: { ap: 1 }, xiaoxiao_combo: { ap: 1 }, xiaoxiao_return: { ap: 1 }
  };
  return map[id] || { ap: 1 };
}

/* 格挡率（玩家手册第二章「空手」「协助格挡」）：
 *   空手格挡 = 30% +（敏捷 − 5）× 5%，最低 15%，最高 50%；
 *   协助格挡 = 空手格挡 + 手里武器的格挡加成。
 * 角色的敏捷读 attrs.dex（升级加点会改变格挡率）；武器人独立在场时用自己的敏捷 + 自己的格挡加成。 */
/** 每把武器（武器人）的格挡加成 */
const WEAPON_BLOCK_BONUS = {
  mint: 5, latte: 20, niu: 40, naruto: 30, mochi: 45, berniel: 35,
  bili: 35, vitas: 5, torque: 35, ecmo: 20, edc: 25, xiaoxiao: 30
};
/** 武器人自己的敏捷（独立在场时决定空手那一段） */
const WEAPON_DEX = {
  mint: 6, latte: 3, niu: 2, naruto: 2, mochi: 2, berniel: 2,
  bili: 2, vitas: 8, torque: 4, ecmo: 3, edc: 4, xiaoxiao: 5   // 小朋友：空手 30% + 武器 30% = 角色卡的 60%
};
/** 不是玩家角色、也没有敏捷的友方单位（剧情 NPC）沿用固定格挡率 */
const FIXED_BLOCK = { captain_ox: 40, patrol_car: 40, chixia: 70 };   // 赤牙：受击时为自己格挡 70%（第九章）

function unitDex(unit) {
  if (!unit) return 5;
  if (unit.attrs && unit.attrs.dex != null) return Number(unit.attrs.dex) || 0;
  if (WEAPON_DEX[unit.kit] != null) return WEAPON_DEX[unit.kit];
  return 5;
}
/** 空手格挡率：只看敏捷 */
function bareBlockFromDex(dex) {
  return Math.max(15, Math.min(50, 30 + (Number(dex) - 5) * 5));
}
function bareBlockChance(unit) {
  return bareBlockFromDex(unitDex(unit));
}
/** 格挡率不封顶（作者实测不影响平衡）：武器格挡加成不设上限，协助格挡率最多 100% */
const WEAPON_BLOCK_CAP = Infinity;
const BLOCK_CHANCE_CAP = 100;
/** 一把武器的格挡加成：武器本身 + 装在上面的格挡件（growth.js · partsBlock）。owner：持有者（角色单位） */
function weaponBlockBonusOf(kit, owner) {
  const base = WEAPON_BLOCK_BONUS[kit];
  if (base == null) return null;
  const parts = owner && typeof weaponPartsOf === "function" ? weaponPartsOf(owner, kit) : [];
  return Math.min(WEAPON_BLOCK_CAP, base + (typeof partsBlock === "function" ? partsBlock(parts) : 0));
}
/** 武器人的持有者（角色单位）。唤出时记了持有者的单位 id（ownerId，app.js · spawnWeapon）就按 id 找：
 *  争斗（brawl.js）两队可以有同一个角色，按 kit 找会找到对面那一个 */
function weaponOwnerUnit(u) {
  if (!u || !u.weaponOf) return null;
  const units = (typeof state !== "undefined" && state && state.units) || [];
  if (u.ownerId != null) {
    const o = units.find(x => x.id === u.ownerId && !x.weaponOf);
    if (o) return o;
  }
  return units.find(x => x.kit === u.weaponOf && !x.weaponOf) || null;
}
/** x 是不是 owner 的武器人：kit 对得上，唤出时记了持有者的还要是这个人（争斗两队同一个角色时，对面那把不算） */
function isWeaponOfOwner(x, owner) {
  if (!x || !owner || !x.weaponOf || x.weaponOf !== owner.kit) return false;
  return x.ownerId == null || x.ownerId === owner.id;
}
/** 手里那把武器的格挡加成；空手、武器人已分出去 → 0 */
function heldWeaponBlockBonus(unit) {
  const v = heldWeaponBlockBonusRaw(unit);
  if (!v || !unit || unit.weaponOf || typeof weaponHalved !== "function") return v;
  // 倒下过一次（取回后）的武器：格挡加成减半
  const kit = unit.kit === "hiaki" ? ((unit.resources || {}).blade || "niu") : (unit.linkedKits || [])[0];
  return kit && weaponHalved(kit, unit) ? Math.floor(v / 2) : v;
}
function heldWeaponBlockBonusRaw(unit) {
  if (!unit || !unit.kit) return 0;
  if (WEAPON_BLOCK_BONUS[unit.kit] != null && (unit.weaponOf || !unit.attrs)) return weaponBlockBonusOf(unit.kit, weaponOwnerUnit(unit));   // 武器人自己
  if (isUnarmed(unit)) return 0;
  const r = unit.resources || {};
  if (unit.kit === "hiaki") {
    const blade = r.blade || "niu";
    if (weaponIsOut(unit)) return 0;
    return weaponBlockBonusOf(blade, unit) || 0;
  }
  if (r.mecha) return weaponBlockBonusOf((unit.linkedKits || [])[0], unit) || 0;
  const kits = unit.linkedKits || [];
  let best = 0;
  kits.forEach(k => {
    if (WEAPON_BLOCK_BONUS[k] == null) return;
    const units = (typeof state !== "undefined" && state && state.units) || [];
    const out = units.some(u => u.kit === k && !u.hidden && !u.fused && !u.dead && (u.ownerId == null || u.ownerId === unit.id));   // 只看自己的武器人（争斗两队同一个角色）
    if (out) return;
    best = Math.max(best, weaponBlockBonusOf(k, unit));
  });
  return best;
}
/** 夕夏引擎（加重）：格挡成功率 +10% */
function blockStatusBonus(unit) {
  return unit && unit.kit === "xia" && unit.resources && unit.resources.engine ? 10 : 0;
}

/** 不封顶的协助格挡率（空手 + 武器 + 状态）：最终格挡率在 app.js · finalBlockChance 里加完各项修正再封顶 */
function blockChanceRaw(unit) {
  if (!unit || !unit.kit) return null;
  // 敌人的种族敏捷修正（enemies.js · setEnemyRace）：只加给本来就会格挡的敌人
  const race = Number(unit.raceBlock) || 0;
  if (FIXED_BLOCK[unit.kit] != null) return FIXED_BLOCK[unit.kit] + race;
  if (!unit.isPlayer && !unit.weaponOf) return null;
  if (!unit.attrs && WEAPON_BLOCK_BONUS[unit.kit] == null) return null;
  return bareBlockChance(unit) + heldWeaponBlockBonus(unit) + blockStatusBonus(unit) + race;
}
/** 协助格挡率（资料面板等显示用），最多 100% */
function blockChance(unit) {
  const c = blockChanceRaw(unit);
  return c == null ? null : Math.min(BLOCK_CHANCE_CAP, c);
}
/** 给资料面板用：拆成空手 / 武器 / 其他三段 */
function blockBreakdown(unit) {
  const total = blockChance(unit);
  if (total == null) return null;
  return { bare: bareBlockChance(unit), weapon: heldWeaponBlockBonus(unit), extra: blockStatusBonus(unit), total, dex: unitDex(unit) };
}

/** 这个单位的技能列表。在它的结算上下文里列（争斗两队同一个角色：柯尔特的刀头这些按 kit 找到的是他自己，withKitScope） */
function skillList(unit) {
  return withKitScope(unit, () => skillListScoped(unit));
}
function skillListScoped(unit) {
  if (!unit || !unit.kit) return [];
  // 坐在车上的人只能用车的武器（vehicle.js）
  if (unit.vehId && typeof vehicleSkillList === "function") return vehicleSkillList(unit);
  const mecha = !!(unit.resources && unit.resources.mecha);
  const held = unit.weaponHeld !== false && !weaponIsOut(unit);
  const list = [];
  const add = (s) => {
    if (s.minLv && (unit.level || 1) < s.minLv) return;
    list.push(s);
  };

  if (unit.kit === "ruby") {
    if (!mecha) {
      add({ id: "ruby_aa", name: "普通攻击", hint: "距离1 · 两次 0.5atk 能量 · 共 1 击破" });
      add({ id: "ruby_trigger", name: "扳机", hint: "距离1以内 · 施加高能" });
      add({ id: "ruby_summon", name: "唤出明特", hint: "武器生物化（需同区收回）" });
      add({ id: "ruby_surge", name: "电流激荡", hint: "距离1 · 1atk 电 1击破 · 打到护盾 +10纳米", minLv: 2 });
      add({ id: "ruby_short", name: "短路", hint: "距离1以内 · 施加感电", minLv: 3 });
      add({ id: "ruby_algo", name: "算法改变", hint: "任意距离 · 施加扩散 · 此回合它每次受伤瑞比 +5 纳米", minLv: 6 });
      add({ id: "ruby_relay", name: "收发代理", hint: "放出小型无人机：每回合 +10 纳米，不限时间（机甲时改为激光）", minLv: 9 });
    } else {
      add({ id: "wing_aa", name: "银翼·普通攻击", hint: "距离1以内 · 1atk+1d4 能量 1击破 · 同区其他 0.3atk" });
      add({ id: "wing_steal", name: "银翼·电力夺取", hint: "同区每个敌人 0.5atk 电 · 每人 +10纳米" });
      add({ id: "wing_surge", name: "银翼·电流激荡", hint: "距离1-2 · 1atk 电 1击破 · 打到护盾 +20纳米", minLv: 2 });
      add({ id: "wing_boost", name: "银翼·机体强化", hint: "不耗行动 · 每回合纳米多耗 20 · atk +20% · 普攻溅射倍率 +0.1 · 无人机攻击次数 +1", minLv: 4 });
      add({ id: "wing_relay", name: "银翼·收发代理", hint: "无人机每回合结束激光：高能敌人（没有就血最少的）两次 0.2atk+1d12 能量 · 耗 10 纳米", minLv: 9 });
      add({ id: "ruby_unmecha", name: "解除机甲", hint: "立刻分开瑞比与明特" });
    }
  }
  if (unit.kit === "mint") {
    if (!mecha) {
      add({ id: "mint_mecha", name: "机甲模式", hint: "不耗行动 · 需与瑞比同区且纳米足够" });
      add({ id: "mint_steal", name: "电力夺取", hint: "距离1以内 · 1atk 电击 · +20纳米" });
      add({ id: "mint_banish", name: "驱逐", hint: "同区两次 0.5atk 电 · 共 1 击破 · 推开 1 格", minLv: 2 });
      add({ id: "mint_repair", name: "机体修复", hint: "耗 20 纳米 · 自身恢复 50% 生命上限 · +1 架势", minLv: 4 });
      add({ id: "mint_return", name: "收回为武器", hint: "需与瑞比同区" });
    }
  }
  if (unit.kit === "yuito") {
    add({ id: "yuito_aa", name: "普通攻击", hint: "距离1 · 1atk 冰 +1击破 · 豆→液" });
    add({ id: "yuito_amer", name: "冰美式", hint: "消耗 1 咖啡液 · 治疗同伴 +1 架势 或 清场 0.75atk 冰 +1击破" });
    add({ id: "yuito_espresso", name: "意式浓缩", hint: "消耗 1 咖啡液 · 友方行动点+1 或 1atk 酸 +2击破", minLv: 2 });
    add({ id: "yuito_extract", name: "酸萃", hint: `消耗 1 咖啡液 · 区域变酸液 · 友方 ${typeof addedDiceByLevel === "function" ? addedDiceByLevel(unit.level || 1) : 1}d4 治疗 / 敌人同样骰数的酸`, minLv: 3 });
    add({ id: "yuito_cold", name: "冷萃", hint: "消耗 1 咖啡液 · 距离≤1 的区变冻土 · 敌人 0.5atk 冰 +1击破 / 友方 +1 架势", minLv: 6 });
    add({ id: "yuito_duet", name: "双重奏", hint: "消耗 2 咖啡液 · 任意友方恢复 等级×1d6 · 溢出的治疗变成 atk，下回合开始失去", minLv: 9 });
    add({ id: "yuito_summon", name: "唤出拿铁", hint: "武器生物化" });
  }
  if (unit.kit === "nora") {
    const lv = unit.level || 1;
    add({ id: "nora_aa", name: "普通攻击", hint: "距离1 · 1atk 冰 +1击破 · 有刺入则只能打刺入目标（温和治疗／残忍加伤）" });
    add({ id: "nora_needle", name: "发射针尖", hint: "距离1以内 · 施加刺入 · 温和则自己移到目标区／残忍则附加冻伤" });
    add({ id: "nora_summon", name: "唤出维塔斯", hint: "武器生物化" });
    add({ id: "nora_soothe", name: "安抚", hint: "附赠 · 安抚维塔斯，切换为温和", minLv: 2, bare: true });
    add({ id: "nora_indwell", name: "留置针", hint: "对刺入目标施加刺骨与 1 冻伤", minLv: 3 });
    add({ id: "nora_pressure", name: "压力升高", hint: "下回合开始必定转为残忍 · 下一击带衍射", minLv: 6 });
    add({ id: "nora_sonic", name: "声波震击", hint: "同区全体 0.5atk 谐波 +1击破 · 刺入目标额外再吃一次", minLv: 9 });
  }
  if (unit.kit === "vitas") {
    add({ id: "vitas_infuse", name: "加压灌输", hint: "对刺入目标 · 温和 2d4+2 治疗并 +1 架势／残忍 1atk 冰 +1击破与两次冻伤" });
    add({ id: "vitas_rip", name: "扯下", hint: "对刺入目标 1.5atk 谐波 +2击破 · 结束刺入" });
    add({ id: "vitas_slash", name: "针尖剑斩", hint: "同区 1atk 谐波 +1击破 · 有刺入则只能打刺入目标并先移动过去", minLv: 2 });
    add({ id: "vitas_dance", name: "寒气剑舞", hint: "场上无刺入才能用 · 三次 0.2atk 冰 共1击破 · 温和治疗同区友方／残忍每击冻伤", minLv: 4 });
    add({ id: "vitas_return", name: "收回为武器", hint: "需与诺拉同区" });
  }
  if (unit.kit === "latte") {
    add({ id: "latte_puff", name: "毛球攻击", hint: "距离1 · atk 酸 +1击破 · 豆→液" });
    add({ id: "latte_ice", name: "制冰机", hint: "天气变为雪天" });
    add({ id: "latte_love", name: "爱意", hint: "移到友方同区 · 2d4 生命 +1 架势 · 牵挂（已有牵挂则拿铁也恢复同量）· 每五级骰面升级", minLv: 2 });
    add({ id: "latte_claw", name: "猫爪挥打", hint: "同区 · 1atk 酸 +1击破 · 击退 1 · +1 咖啡豆（打出失衡再 +1）", minLv: 4 });
    add({ id: "latte_return", name: "收回为武器", hint: "需与结人同区" });
  }
  if (unit.kit === "hiaki") {
    add({ id: "hiaki_aa", name: "普通攻击", hint: "按刀势：拔刀 1atk+1击破 / 居合 移动后 1.5atk / 胁构 1atk+2击破" });
    add({ id: "hiaki_sheath", name: "收刀", hint: "选一把刀，进入居合" });
    add({ id: "hiaki_summon", name: "分出当前刀", hint: "武器生物化其中一把，另一把仍可持用" });
    add({ id: "hiaki_flash", name: "一闪", hint: "仅居合 · 同区全体 1atk +1击破 · 进入拔刀", minLv: 2 });
    add({ id: "hiaki_pot", name: "热锅", hint: "仅丹生谷 · 同区施加熔融", minLv: 3 });
    add({ id: "hiaki_barrage", name: "特盛乱打", hint: "仅胁构 · 同区每个敌人 1 击破并标记 · 进入拔刀 · 下次进入居合时被标记的各挨 0.5atk（无视距离和障碍）", minLv: 6 });
    add({ id: "hiaki_powder", name: "粉落汤气", hint: "仅居合 · 下回合之前格挡成功不切刀势，并用另一把刀反击 1atk（鳴門 +1 击破）", minLv: 9 });
  }
  if (unit.kit === "niu") {
    add({ id: "niu_slash", name: "斩炎", hint: "同区 · 1atk 火 +1击破 · 灼烧 · 变回武器" });
    add({ id: "niu_tsubame", name: "燕返", hint: "距离1 · 1atk 火 +1击破 · 收回并换持丹生谷，鳴門出场", minLv: 2 });
    add({ id: "niu_standby", name: "待命", hint: "下一次协助格挡必定成功 · 成功则变回武器，绯秋换丹生谷居合", minLv: 4 });
    add({ id: "niu_return", name: "变回武器", hint: "需与绯秋同区" });
  }
  if (unit.kit === "naruto") {
    add({ id: "naruto_wind", name: "寒风", hint: "距离1 · 1atk 冰 +1击破 · 冻伤 · 变回武器" });
    add({ id: "naruto_fly", name: "燕飞", hint: "同区 0.5atk 冰 +1击破 · 然后移动 1 格", minLv: 2 });
    add({ id: "naruto_frost", name: "霜取", hint: "同区 · 3 冰击破 · 打出失衡则收回，绯秋换鳴門胁构", minLv: 4 });
    add({ id: "naruto_return", name: "变回武器", hint: "需与绯秋同区" });
  }
  if (unit.kit === "tou") {
    add({ id: "tou_aa", name: "普通攻击", hint: "同区 · 1atk 物理 +1击破 · 可在技能里耗圣盾打邻区" });
    add({ id: "tou_start", name: "圣战起始", hint: "移动≤1（可耗圣盾带一人同行）→ 同区施加错位" });
    add({ id: "tou_sonic", name: "声波切割", hint: "同区目标 1atk 谐波、距离1 目标 0.5atk 谐波，可只选其一 · 耗 1 圣盾", minLv: 2 });
    add({ id: "tou_ultra", name: "超音波", hint: "同区施加折射", minLv: 3 });
    add({ id: "tou_bash", name: "盾击突进", hint: "移动≤1 · 同区敌人先震荡再 1atk 物理 · 可耗圣盾再盾突：1 击破 + 不稳", minLv: 6 });
    add({ id: "tou_accuse", name: "赤诚控诉", hint: "距离1以内 · 1atk 谐波 · 嘲讽 · 圣盾 +2 · 决一死战中的敌人再虚弱", minLv: 9 });
    add({ id: "tou_summon", name: "唤出年糕", hint: "武器生物化" });
    /* 圣盾延射程已并入普通攻击的分步选择 */
  }
  if (unit.kit === "mochi") {
    add({ id: "mochi_pounce", name: "猛扑", hint: "跃向距离1敌人，或带走同区敌人 · atk+1d4 物理 +1击破" });
    add({ id: "mochi_roar", name: "吼叫", hint: "同区 atk+1d4 谐波 +1击破 · 强制换区" });
    add({ id: "mochi_boom", name: "音爆", hint: "同区每个敌人 0.5atk 谐波 +1击破 · 可再耗圣盾一次", minLv: 2 });
    add({ id: "mochi_bite", name: "紧咬不放", hint: "同区 · 1atk 物理 +1击破 · 嘲讽 · 无法移动", minLv: 4 });
    add({ id: "mochi_return", name: "收回为武器", hint: "需与灯同区" });
  }
  if (unit.kit === "xia") {
    add({ id: "xia_aa", name: "普通攻击", hint: "近战 1d4+atk 物理 2击破 · 引擎时火焰 3击破" });
    if ((unit.resources || {}).engine && typeof passivePlus === "function" && passivePlus(unit, 1)) add({ id: "xia_engine", name: "加油", hint: "获得 2 燃油 · 不会导致引擎熄火" });
    else add({ id: "xia_engine", name: "拉响引擎", hint: "发动引擎" });
    add({ id: "xia_execute", name: "处决", hint: "引擎+目标晕眩 · 1d8+1.5atk 火焰 · 穿刺", minLv: 2 });
    add({ id: "xia_ram", name: "全速撞击", hint: "引擎 · 移动≤2 · 先震荡再 atk物理 · 每移1格+1击破", minLv: 3 });
    add({ id: "xia_selfburn", name: "引火烧身", hint: "需引擎 · 进入自焚，可选立刻移动 1 距离", minLv: 6, bare: true });
    add({ id: "xia_crush", name: "狂怒碾压", hint: "同区 · 需引擎 · 0.75atk 物理 +2击破 · 抓住后每回合自动 1.5atk+1d8 +3击破", minLv: 9 });
    add({ id: "xia_summon", name: "唤出柏妮尔", hint: "武器生物化" });
  }
  if (unit.kit === "berniel") {
    add({ id: "berniel_spit", name: "喷火", hint: "近距离全体 atk/2 火焰 · 引擎时各 1 击破" });
    add({ id: "berniel_ignite", name: "燃点", hint: "距离≤1 的一名敌人灼烧 · 引擎时 2 层" });
    add({ id: "berniel_dash", name: "点火突进", hint: "喷火并飞到另一区，可带走单位 · 启动引擎", minLv: 2 });
    add({ id: "berniel_flare", name: "焰袭", hint: "引擎且与夕夏不同区 · 先收回再打 1.5夕夏atk+1d6 火 +2击破", minLv: 4 });
    add({ id: "berniel_return", name: "收回为武器", hint: "需与夕夏同区" });
  }
  if (unit.kit === "chuan") {
    add({ id: "chuan_aa", name: "普通攻击", hint: "近距离 · 两次 atk/2+1d4 电击 共1击破 · 耗1电能变三次共2击破" });
    add({ id: "chuan_whip", name: "电能鞭", hint: "距离1以内 · atk/2 能量 1击破 · +1电能 · 可耗1电能把自己拉到敌人区" });
    add({ id: "chuan_wall", name: "铁壁", hint: "耗1电能 · 同区挡伤盾 atk+1d6 装甲 · 电能≥3可多耗1加 atk 护盾", minLv: 2 });
    add({ id: "chuan_over", name: "电站超频", hint: "任意单位（可对自己）过载 · +2电能；已有≥3电能则改为 atk/2 护盾", minLv: 3 });
    add({ id: "chuan_pulse", name: "高能脉冲", hint: "对自身施加蓄能", minLv: 6 });
    add({ id: "chuan_blade", name: "巨刃划空", hint: "1距离以内 · 耗3电能 · 2atk 电击 +2击破 · 对配置物伤害翻倍 · 敌人躲在屏障后改砍屏障 · 危墙 / 桥梁固定 −10 耐久 · 击穿血量层或摧毁配置物返还1电能", minLv: 9 });
    add({ id: "chuan_summon", name: "唤出哔哩哩", hint: "武器生物化" });
  }
  // 被动升级后才有的技能
  if (unit.kit === "chuan" && typeof passivePlus === "function" && passivePlus(unit, 2)) {
    add({ id: "chuan_reclaim", name: "回收护盾", hint: "附赠 · 清除一名友方的护盾，得到 2 电能，并触发磁场护盾" });
  }
  if (unit.kit === "ruby" && !(unit.resources && unit.resources.mecha) && typeof passivePlus === "function" && passivePlus(unit, 1)) {
    add({ id: "ruby_refuel", name: "补充能源", hint: "附赠 · 纳米 +10，或把全部纳米压缩成储备能源（没有上限，纳米不够时自动用）", bare: true });
  }
  if (unit.kit === "bili") {
    add({ id: "bili_beam", name: "电光束", hint: "任意距离 · 1atk 电击 · 感电" });
    add({ id: "bili_magnet", name: "磁力移动", hint: "任意距离 · 同区推远或他区拉到身边 · 1击破" });
    add({ id: "bili_field", name: "磁场盾", hint: "耗川川1电能 · 同区友方 +atk+1d4 护盾 · 可多耗1再加等级", minLv: 2 });
    add({ id: "bili_storm", name: "雷电风暴", hint: "耗全部电能 · 电能×2 次 0.4atk 电击 · 每2电能1击破 · 目标感电则+2电能", minLv: 4 });
    add({ id: "bili_return", name: "收回为武器", hint: "需与川川同区" });
  }
  if (unit.kit === "kolt") {
    const bit = (unit.resources && unit.resources.bit) || "drill";
    add({ id: "kolt_aa", name: "普通攻击", hint: bit === "acid" ? "距离1 · 1atk 酸 +1击破" : "同区 · 0.3/0.3/0.4atk 三次电 · 共2击破" });
    add({ id: "kolt_short", name: "直流短接", hint: "需电钻 · 可先移≤1，再对同区铺高压场地" });
    add({ id: "kolt_chase", name: "紧追", hint: "附赠 · 对一个敌人施加紧追：它移动时柯尔特自动跟上", bare: true });
    add({ id: "kolt_scrap", name: "废物利用", hint: "领取被摧毁的敌人血量层累积的废料，获得对应血量（每次最多生命上限50%，没领完的留着）· 另领腐坏抛射的记录", minLv: 2 });
    add({ id: "kolt_rot", name: "腐坏抛射", hint: "需酸液炮 · 距离1 · 施加腐蚀（不造成伤害，仍会嘲讽）· 腐蚀伤害记给下一次废物利用", minLv: 3 });
    add({ id: "kolt_mod", name: "「非法」改装", hint: "需电钻 · 1距离以内任意单位施加过载 · 废料达到上限时，可再耗等量废料让我方目标 +1 行动点（可超上限）", minLv: 6 });
    add({ id: "kolt_cannon", name: "碎渣重炮", hint: bit === "acid"
      ? "耗全部废料 · 距离1-2 · 越墙迫击炮：废料量的酸 +2击破，同区其他敌人 1/3 溅射 · 主目标掉血超过上限 25% 再 +2击破"
      : "耗全部废料 · 选距离1以内一个区域 · 废料分成每颗（扭矩atk/3+1d10）电击的子弹，随机打该区敌人 · 每2颗1击破", minLv: 9 });
    add({ id: "kolt_summon", name: "唤出扭矩", hint: "武器生物化" });
  }
  if (unit.kit === "torque") {
    const bit = koltBit();
    add({ id: "torque_boost", name: "强化输出", hint: bit === "acid" ? "任意区域蓄力（越墙），下回合开始对该区酸液AOE" : "移动1后选一名敌人 · 1d4+1 次 0.5atk 电 · 共2击破" });
    add({ id: "torque_swap", name: "拆装部件", hint: "更换刀头，再打对应距离 1atk +1击破，强制收回" });
    add({ id: "torque_strip", name: "拆卸模式", hint: "需电钻 · 同区 2击破，外层血量转给同区友方，或变成废料（不受上限）", minLv: 2 });
    add({ id: "torque_divert", name: "转移注意", hint: "全场被嘲讽的单位改打扭矩 · 自保：受伤 −25%、架势不低于1 · 下回合开始变回武器，失去的装甲记为废料", minLv: 4 });
    add({ id: "torque_return", name: "收回为武器", hint: "需与柯尔特同区" });
  }
  if (unit.kit === "helu") {
    add({ id: "helu_aa", name: "普通攻击", hint: "远距离 · 1atk 谐波 +1击破 · 有聚焦则打聚焦层" });
    add({ id: "helu_wave", name: "驻波", hint: "进入相位；已扫描战场则可推进相位阶段" });
    add({ id: "helu_storm", name: "大气干扰", hint: "进入沙暴；已环境扫描过则可在沙暴中调转风向", minLv: 3 });
    add({ id: "helu_scan", name: "环境扫描", hint: "选一区：扫描出配置物，或远程引爆 / 操控配置物、震动危墙桥梁、激发场地", minLv: 2 });
    add({ id: "helu_rule", name: "规则干涉", hint: "1距离以内一区变成干涉场 · 已扫描战场且取代了别的场地：同区自选任意单位（敌我都行）+1 附赠动作，可超上限", minLv: 6 });
    add({ id: "helu_forge", name: "频域造物", hint: "需扫描过战场 · 任意间隙创造驻波墙（不挡移动，暂时取代危墙 / 门 / 桥 / 空隙）· 选一种属性：降幅（穿过的伤害减半、无击破，穿过者不稳+虚弱）/ 增幅（+25%，穿过者坚挺+振奋）· 聚焦穿过推进一步 · 这一整轮结束时消失", minLv: 9 });
    add({ id: "helu_summon", name: "唤出 Ecmo", hint: "武器生物化" });
  }
  if (unit.kit === "ecmo") {
    add({ id: "ecmo_bite", name: "叮咬", hint: "同区 · 1atk 物理 +1击破 · 造成失衡返还行动点" });
    add({ id: "ecmo_focus", name: "相控阵探头", hint: "任意敌人的任意血量层施加聚焦" });
    add({ id: "ecmo_boom", name: "音爆", hint: "同区全体 0.5atk 谐波 · 触发配置物 · 聚焦层打两次", minLv: 2 });
    add({ id: "ecmo_probe", name: "探测模式", hint: "移动不耗附赠 · 每回合开始扫描所在区 · 变回武器时触发经过的每个区的一个配置物", minLv: 4 });
    add({ id: "ecmo_return", name: "收回为武器", hint: "需与 Helumica 同区" });
  }
  if (unit.kit === "ras") {
    add({ id: "ras_aa", name: "普通攻击", hint: "远距离 · 两次 0.5atk 能量 共1击破 · 累积20%能量" });
    add({ id: "ras_dump", name: "泄能", hint: "任意距离 · 施加高能 · 转化20%能量为光能" });
    add({ id: "ras_flee", name: "逃离", hint: "移动1 → +20%能量 → 原区一名敌人 1atk 电（远距离）· 不触发借机攻击。不稳则移动不限", minLv: 2 });
    add({ id: "ras_super", name: "不稳超导", hint: "20%能量转光能 · 自身导体 · 不稳态下免费", minLv: 3 });
    add({ id: "ras_rampage", name: "失控暴走", hint: "+40%能量 · 因此进入不稳态则同区变能量场；已在不稳态则全场变能量场", minLv: 6 });
    add({ id: "ras_torrent", name: "狂瀑", hint: "任意距离 · 选高能状态的敌人 · 能量直接累积到 100%，每 20% 打 0.2atk 能量、自己失去 10% 血量", minLv: 9 });
    add({ id: "ras_summon", name: "唤出 EDC30k", hint: "武器生物化" });
  }
  if (unit.kit === "edc") {
    add({ id: "edc_drain", name: "引流", hint: "需与拉斯缪尔同区 · 累积能量全转光能 · 不稳+25%" });
    add({ id: "edc_shock", name: "电流冲击", hint: "距离1 · 1atk 电 +1击破 · 有光能则再打等量电击" });
    add({ id: "edc_flash", name: "爆闪", hint: "释放全部光能 · 同区每名敌人 光能/2 电击 +1击破", minLv: 2 });
    add({ id: "edc_siphon", name: "汲取", hint: "拉斯缪尔每回合结束自动把 20% 累积能量转光能 · 变回武器 · 生效中再用：不耗行动点并结束汲取", minLv: 4 });
    add({ id: "edc_return", name: "收回为武器", hint: "需与拉斯缪尔同区" });
  }
  if (unit.kit === "longge") {
    const r = unit.resources || {};
    const gun = !!r.trigger && (r.ammo || []).length > 0;
    const near = typeof passivePlus === "function" && passivePlus(unit, 1);   // 枪管手杖+：霰弹枪普攻也能打近距离
    add({ id: "longge_aa", name: "普通攻击", hint: gun ? `手杖：近距离 1atk 冰 +1击破 · 窥探1 / 霰弹枪：${near ? "近 / 远距离" : "远距离"} 1.5atk 子弹属性 +1击破（耗 1 弹）${near ? " · 近距离火弹溅射同区其他敌人 0.75atk" : ""}` : "手杖 · 近距离 · 1atk 冰 +1击破 · 窥探1（扳机解锁后可用霰弹枪）" });
    add({ id: "longge_chill", name: "冷气穿刺", hint: gun ? "手杖：近距离施加刺骨 / 霰弹枪：远距离特殊射击（蓝弹刺骨并治疗该区友方，红弹 0.5atk 火）" : "手杖 · 近距离 · 施加刺骨" });
    add({ id: "longge_spit", name: "吐酸", hint: "附赠 · 近距离 · 角色本身 atk 的酸液伤害 · 每场一次（兽人-蜥蜴种族特长）", bare: true });
    add({ id: "longge_safety", name: "解开保险", hint: "解锁扳机 · 查看最后一发子弹，可以把它移到最前面", minLv: 2 });
    add({ id: "longge_heat", name: "热能轰击", hint: gun ? "手杖：近距离施加熔融 / 霰弹枪：近距离特殊射击（红弹：同区敌人熔融、同区友方治疗；蓝弹：同区友方各 1 冰击破）" : "手杖 · 近距离 · 施加熔融", minLv: 3 });
    add({ id: "longge_drink", name: "饮弹", hint: "枪口对准自己 · 耗 1 弹 · 蓝弹：霜结并按蓝弹治疗自己 / 红弹：自己受 1atk 火，返还行动点", minLv: 6 });
    add({ id: "longge_shuffle", name: "洗牌", hint: "把剩下的子弹重新随机排列 · 连续 2 红：随机敌人 1atk 火（3 红再一次） · 连续 2 蓝：治疗血量最低的队友（3 蓝再一次） · 都没有就窥探 1 · 子弹数量没变过不能连续洗", minLv: 9 });
    if (typeof passivePlus === "function" && passivePlus(unit, 2)) add({ id: "longge_reload", name: "完全换弹", hint: "子弹打光时 · 重新装上随机的 6 发（胶囊弹药+）" });
    add({ id: "longge_summon", name: "唤出小朋友", hint: "武器生物化" });
  }
  if (unit.kit === "xiaoxiao") {
    add({ id: "xiaoxiao_punch", name: "直冲拳", hint: "耗 1 弹 · 近距离 · 1atk 子弹属性 +2击破" });
    add({ id: "xiaoxiao_heal", name: "治疗支援", hint: "耗 1 弹 · 同区友方按子弹颜色治疗 · 然后收回武器" });
    add({ id: "xiaoxiao_combo", name: "连续拳", hint: "耗 3 弹 · 近距离 · 全红升龙拳 3atk 火 +3击破 / 全蓝撼地拳 2atk 冰 +5击破 / 混合每发红 0.75atk 火、蓝 0.5atk 冰 +1击破", minLv: 2 });
    add({ id: "xiaoxiao_burst", name: "爆发治疗", hint: "耗 3 弹 · 接下来 3 发不同色则白扣行动点 · 同区友方：全红回满生命 / 全蓝获得 2×（龙哥等级 + 5）临时护盾", minLv: 4 });
    add({ id: "xiaoxiao_return", name: "收回为武器", hint: "需与龙哥同区" });
  }
  if (isUnarmed(unit)) {
    add({ id: "bare_aa", name: "空手攻击", hint: "同区 · 1×atk 物理。未持武器时的基本攻击。" });
  }
  (roleSkillsUnlocked(unit) || []).forEach(rs => {
    const def = roleSkillDef(rs.role, rs.n, unit);
    if (def && !list.some(s => s.id === def.id)) add(def);   // 第二副职责可能和角色自带的技能重复
  });
  // 武器人倒下后：主人走到它倒下的区，花 1 行动点取回（本场不能再唤出，武器 atk / 格挡加成减半）
  if (typeof fallenWeapons === "function" && fallenWeapons(unit).length) {
    add({ id: "weapon_retrieve", name: "取回武器", hint: "同区 · 取回倒下的武器人 · 本场不能再唤出，武器 atk 和格挡加成减半", bare: true });
  }
  // 流沙（app.js · QUICKSAND）：把陷住的同伴拉出来
  if (typeof sandPullTargets === "function" && sandPullTargets(unit).length) {
    add({ id: "sand_pull", name: "拉出流沙", hint: "附赠 · 距离1以内 · 一名陷在流沙里的友方下陷清零（在相邻区就拉到自己这一区）", bare: true });
  }
  // 专长带的战斗动作（feats.js）
  if (typeof featSkills === "function") featSkills(unit).forEach(add);
  // 装着的义体（cyberware.js）：长在身上，空手也能用
  if (typeof cyberwareSkills === "function") cyberwareSkills(unit).forEach(add);
  // 单人模式：支援（呼叫伙伴的协助攻击）
  if (typeof soloSupportSkill === "function") {
    const sup = soloSupportSkill(unit);
    if (sup) add(sup);
  }
  if (isUnarmed(unit)) {
    return list.filter(s => s.id === "bare_aa" || s.bare || (s.id && s.id.indexOf("role_") === 0) || (s.id && s.id.indexOf("fx_") === 0));
  }
  return list;
}

/** 职责技能的定义（手册第六步职责表）。unit 用来算与等级有关的提示文字。 */
function roleSkillDef(role, n, unit) {
  unit = unit || {};
  const lv = unit.level || 1;
  if (role === "直伤" && n === 1) return { id: "xia_prep", name: "准备", hint: "附赠 · 下回合伤害骰 +1d6（每5级提高骰子）· 对复数攻击只生效一次", bare: true };
  if (role === "直伤" && n === 2) return { id: "role_refine", name: "精益求精", hint: `附赠 · 下一击弱点特效 · 每场${lv >= 15 ? "两次" : "一次"}` };
  if (role === "直伤" && n === 3) return { id: "role_pierce", name: "一击制敌", hint: "附赠 · 下一击穿刺 · 每场一次" };
  if (role === "直伤" && n === 4) return { id: "role_gambit", name: "破釜沉舟", hint: "行动点 · 下回合攻击双倍，自己受伤双倍 · 每场一次" };
  if (role === "异常" && n === 1) return { id: "role_activate", name: "激活", hint: "附赠 · 立刻触发目标一种状态" };
  if (role === "异常" && n === 2) return { id: "role_spread", name: "传播", hint: "行动点 · 把一个单位身上的属性状态效果复制给另一个单位（灼烧层数叠加，高能值取较大）" };
  if (role === "异常" && n === 3) return { id: "role_double_dot", name: "加倍计量", hint: "附赠 · 一个敌人身上的状态本回合效果翻倍 · 每场一次" };
  if (role === "异常" && n === 4) return { id: "role_self_doom", name: "自我毁灭", hint: "附赠开关 · 施加状态翻倍，自己也吃一层" };
  if (role === "击破" && n === 1) return { id: "hiaki_allin", name: "全力以赴", hint: "附赠 · 下一击猛击 · 可空手", bare: true };
  if (role === "击破" && n === 2) return { id: "role_breakwave", name: "破势", hint: "附赠 · 同区架势=1（15级≤2）的敌人各 1 无属性击破" };
  if (role === "击破" && n === 3) return { id: "role_halve", name: "折戟", hint: "行动点 · 造成当前架势一半击破 · 每场一次" };
  if (role === "击破" && n === 4) return { id: "role_omen", name: "击破预告", hint: "行动点 · 下回合双倍击破，失败则自己失衡 · 每场一次" };
  if (role === "坦克" && n === 1) return { id: "tou_taunt", name: "嘲讽", hint: `附赠 · 距离1以内敌人下次必须打自己 · 每场${lv >= 15 ? 4 : lv >= 5 ? 3 : 2}次${lv >= 10 ? "，一回合可用多次" : "，每回合限一次"} · 可空手`, bare: true };
  if (role === "坦克" && n === 2) return { id: "role_lockdown", name: "禁足怒吼", hint: "行动点 · 同区敌人本回合不能移动且必须打坦克" };
  if (role === "坦克" && n === 3) return { id: "role_grit", name: "咬牙坚持", hint: "附赠 · 本回合减伤 50% · 每场两次" };
  if (role === "坦克" && n === 4) return { id: "role_stand", name: "屹立不倒", hint: "行动点 · 本回合免疫伤害和击破 · 每场一次" };
  if (role === "护卫" && n === 1) return { id: "role_cover", name: "掩护", hint: "附赠 · 此回合免费为指定队友协助格挡" };
  if (role === "护卫" && n === 2) return { id: "role_fear", name: "恐惧怒吼", hint: `行动点 · 距离1内敌人本回合虚弱 · 每场${lv >= 15 ? "三" : "两"}次` };
  if (role === "护卫" && n === 3) return { id: "role_guard_strike", name: "防守反击", hint: "行动点 · 本回合首次成功格挡追加一次协助攻击" };
  if (role === "护卫" && n === 4) return { id: "role_all_reflect", name: "全反击", hint: "行动点 · 本回合全队成功格挡反伤伤害与击破 · 每场一次" };
  if (role === "生存" && n === 1) return { id: "role_firstaid", name: "应急处理", hint: "行动点 · 距离1以内友方 1d4+2（半血取最大）" };
  if (role === "生存" && n === 2) return { id: "role_buffer", name: "缓冲", hint: `附赠 · 距离1以内友方 2d4+4 护盾 · 每场${lv >= 15 ? "两次 · 可自选血量种类" : "一次"}` };
  if (role === "生存" && n === 3) return { id: "role_dome", name: "防护罩", hint: "行动点 · 同区 atk+10 护盾罩 · 每场一次" };
  if (role === "生存" && n === 4) return { id: "role_renew", name: "续命", hint: "行动点 · 任意距离一名友方恢复最大生命 50%，濒死则救回濒死前的状态并恢复 25% · 每场一次" };
  if (role === "环境手" && n === 1) return { id: "role_lock", name: "锁定", hint: "附赠 · 锁定一种天气或场地本回合不被修改" };
  if (role === "环境手" && n === 2) return { id: "role_shelter", name: "保释", hint: `附赠 · 一名友方本回合豁免天气场地 · 每场${lv >= 15 ? 3 : 2}次，一次附赠可连保多人` };
  if (role === "环境手" && n === 3) return { id: "role_harsh", name: "恶劣环境", hint: "附赠 · 一名单位本回合场地天气双倍 · 每场一次" };
  if (role === "环境手" && n === 4) return { id: "role_apocalypse", name: "末日", hint: "行动点 · 整场天气与场地翻倍且无法停止 · 每场一次" };
  if (role === "控场" && n === 1) return { id: "role_pull", name: "拉拽", hint: "附赠 · 把目标拉到自己区域" };
  if (role === "控场" && n === 2) return { id: "role_boost", name: "借力", hint: "附赠 · 任意位置的一名其他友方移到任意区域" };
  if (role === "控场" && n === 3) return { id: "role_shake", name: "撼动", hint: "行动点 · 同区所有敌人不稳 · 每场一次" };
  if (role === "控场" && n === 4) return { id: "role_rearrange", name: "重整", hint: "行动点 · 距离1内单位各可移1区，并可改两名飞行 · 每场一次" };
  if (role === "辅助" && n === 1) return { id: "yuito_inspire", name: "助威", bare: true, hint: (unit.level || 1) >= 10 ? "10级：附赠=本回合振奋，或行动点=持续振奋" : "附赠 · 一名其他友方 · 本回合振奋" };
  if (role === "辅助" && n === 2) return { id: "role_sturdy", name: "不倒战意", hint: lv >= 15 ? "附赠 · 同区友方本回合坚挺 · 15级可改用行动点让全部友方坚挺" : "附赠 · 同区友方本回合坚挺" };
  if (role === "辅助" && n === 3) return { id: "role_gold", name: "黄金时间", hint: "附赠 · 一个单位身上一种即时效果延长一回合 · 每场两次" };
  if (role === "辅助" && n === 4) return { id: "role_rally", name: "全队集结", hint: "行动点 · 同区队员获得主职责增益直到施放者晕眩或濒死 · 长休一次" };
  return null;
}

function koltBit() {
  const k = (typeof findKit === "function" && typeof state !== "undefined") ? findKit("kolt", state.units) : null;
  return (k && k.resources && k.resources.bit) || "drill";
}

function isUnarmed(unit) {
  if (!unit || !unit.isPlayer) return false;
  if (unit.resources && unit.resources.mecha) return false;
  if (typeof isWeaponUnit === "function" && isWeaponUnit(unit)) return false;
  if (unit.kit === "hiaki") {
    const r = unit.resources || {};
    return !!(r.niuOut && r.narutoOut);
  }
  return unit.weaponHeld === false;
}

function weaponIsOut(owner) {
  if (!owner || !owner.kit) return false;
  if (owner.kit === "hiaki") {
    const r = owner.resources || {};
    const blade = r.blade || "niu";
    return blade === "niu" ? !!r.niuOut : !!r.narutoOut;
  }
  return false;
}

function ownerOfWeapon(weapon, units) {
  if (!weapon || !weapon.weaponOf) return null;
  if (weapon.ownerId != null) {   // 唤出时记了持有者（争斗两队同一个角色，app.js · spawnWeapon）
    const o = (units || []).find(u => u.id === weapon.ownerId && !u.hidden);
    if (o) return o;
  }
  return units.find(u => u.kit === weapon.weaponOf && !u.hidden);
}

/* ---------- 两队有同一个角色（争斗，brawl.js）：按 kit 找单位 ----------
 * 规则里很多地方按 kit 找「那个角色」（findKit("xia", state.units) 找夕夏的燃油、findKit("ruby") 加纳米……）。
 * 争斗两队可以用同一个角色，场上同一个 kit 有两个：这时先看「现在是谁的事」——near（调用的地方给了）或者结算上下文
 * （withKitScope：正在行动 / 格挡 / 协助 / 结算回合效果的那个单位），挑它自己、它的持有者 / 武器人、同一队的那一个。
 * 场上这个 kit 只有一个时（争斗以外的所有情况）和以前完全一样。上下文只记单位 id、不放进 state（沙盒试跑照样认得） */
const KIT_SCOPE = [];
/** 在 u 的上下文里做 fn（u 给 null 就照旧）：fn 里按 kit 找到的同名角色先挑 u 这一边的 */
function withKitScope(u, fn) {
  if (!u || u.id == null) return fn();
  KIT_SCOPE.push(u.id);
  try { return fn(); } finally { KIT_SCOPE.pop(); }
}
/** 现在的结算上下文（最里面那一层；单位不在场上了就往外找） */
function kitScopeUnit() {
  const units = (typeof state !== "undefined" && state && state.units) || [];
  for (let i = KIT_SCOPE.length - 1; i >= 0; i--) {
    const u = units.find(x => x && x.id === KIT_SCOPE[i]);
    if (u) return u;
  }
  return null;
}
/** 哪一边（同名角色挑同一边的）：决斗 / 争斗的队伍，其次玩家阵营，再其次玩家 / 敌人 */
function kitSideOf(u) {
  if (!u) return null;
  const t = typeof pvpDuelTeamOf === "function" ? pvpDuelTeamOf(u) : null;
  if (t) return "duel:" + t;
  if (typeof pvpOn === "function" && pvpOn() && typeof playerFactionOf === "function" && u.isPlayer) return "pvp:" + playerFactionOf(u);
  return u.isPlayer ? "player" : "enemy";
}
/** 同名的几个单位里挑 ref（单位）这一边的：ref 自己 → ref 的持有者 → ref（或它的持有者）的武器人 → 同一边的第一个；挑不出来返回 null */
function kitPick(list, ref) {
  if (!ref || !list.length) return null;
  if (list.includes(ref)) return ref;
  const hero = ref.weaponOf ? weaponOwnerUnit(ref) : ref;
  if (hero && list.includes(hero)) return hero;
  const mine = hero && list.find(x => x.weaponOf && weaponOwnerUnit(x) === hero);
  if (mine) return mine;
  const side = kitSideOf(hero || ref);
  return list.find(x => kitSideOf(x) === side) || null;
}
/** 按 kit 找场上的单位（没藏起来的）。near：「是谁那一边的」（单位；不给就看结算上下文 withKitScope），只在同一个 kit 有两个以上时才用 */
function findKit(kit, units, near) {
  if (!units) return undefined;
  let first, dup = false;
  for (const u of units) {
    if (!u || u.kit !== kit || u.hidden) continue;
    if (first === undefined) first = u;
    else { dup = true; break; }
  }
  if (!dup) return first;
  const list = units.filter(u => u && u.kit === kit && !u.hidden);
  return kitPick(list, near || kitScopeUnit()) || first;
}
/** 场上这个 kit 的所有单位（没藏起来的）：每回合 / 开战结算「这个角色」的效果时，两队同一个角色要各结算各的 */
function kitUnits(kit, units) {
  return (units || (typeof state !== "undefined" && state ? state.units : []) || []).filter(u => u && u.kit === kit && !u.hidden);
}

/** 实际 atk = 基础 atk − 力竭惩罚（力竭 2 起 atk −3，只对角色本人） */
function effectiveAtk(unit, units) {
  if (!unit) return 0;
  // 单局的客制化图纸（mods.js）：拿着装了图纸的武器时 atk 变化；同区敌人的近距离压制
  const raw = baseEffectiveAtk(unit, units);
  let base = typeof bpAtkAdjust === "function" ? bpAtkAdjust(unit, raw) : raw;
  // 更换刀头+：酸液炮模式下柯尔特 atk +5；思念+：被牵挂且回合内未受伤累积的 atk 加成
  if (unit.kit === "kolt" && (unit.resources || {}).bit === "acid" && typeof passivePlus === "function" && passivePlus(unit, 1)) base += 5;
  if (unit.bondAtk) base += Number(unit.bondAtk) || 0;
  if (unit.itemAtkBonus) base += Number(unit.itemAtkBonus) || 0;   // 强化注射剂（items.js）：ATK +3 至战斗结束（#340 第 16 条）
  if (unit.rallyAtk) base += Number(unit.rallyAtk) || 0;           // 全队集结·直伤（app.js · applyRallyBuff）：ATK +RALLY_BUFF.atk
  if (unit.duetAtk) base += Number(unit.duetAtk) || 0;   // 双重奏：溢出的治疗，下回合开始失去
  if (typeof frenzyAtkBonus === "function") base += frenzyAtkBonus(unit);   // 狂暴（effects.js · FRENZY）：ATK + 等级
  if (unit.race && typeof raceAtkAdjust === "function") base += raceAtkAdjust(unit, units);   // 种族被动·独狼（enemies.js）
  if (unit.resources && unit.resources.mecha && unit.resources.overdrive) base *= 1.2;   // 银翼·机体强化
  // 陨体衍蛛：除自己之外，场上每有一只活着的陨体衍蛛，atk +25%
  if (unit.kit === "meteor_spider") {
    const n = (units || []).filter(u => u && u !== unit && u.kit === "meteor_spider" && !u.dead && !u.hidden && !u._removed).length;
    if (n > 0) base = Math.round(base * (1 + 0.25 * n));
  }
  const tier = typeof exhaustTierOf === "function" ? exhaustTierOf(unit) : 0;
  return tier >= 2 ? Math.max(0, base - 3) : base;
}

function baseEffectiveAtk(unit, units) {
  if (!unit) return 0;
  // 倒下过一次（取回后）的武器：武器提供的 atk 减半（本场有效）
  const half = (kit, v) => (typeof weaponHalved === "function" && weaponHalved(kit, unit)) ? Math.floor((Number(v) || 0) / 2) : (Number(v) || 0);
  if (unit.resources && unit.resources.mecha) {
    const mint = units.find(u => u.kit === "mint" && (u.ownerId == null || u.ownerId === unit.id));   // 自己的明特（争斗两队都有瑞比）
    return (unit.personalAtk || 0) + half("mint", (mint && mint.personalAtk) || unit.weaponAtk || 8);
  }
  if (unit.kit === "hiaki") {
    const blade = (unit.resources && unit.resources.blade) || "niu";
    const out = blade === "niu" ? unit.resources.niuOut : unit.resources.narutoOut;
    const lv = (unit.weaponLevels && unit.weaponLevels[blade]) || 1;
    const wAtk = typeof computeWeaponAtk === "function"
      ? computeWeaponAtk(blade, unit.attrs, lv, weaponPartsOf(unit, blade))
      : (blade === "niu" ? 7 : 6);
    return (unit.personalAtk || 0) + (out ? 0 : half(blade, wAtk));
  }
  if (unit.weaponHeld === false) return unit.personalAtk || 0;
  return (unit.personalAtk || 0) + half((unit.linkedKits || [])[0], unit.weaponAtk || 0);
}

function resourceText(unit) {
  if (!unit || !unit.kit) return "";
  const r = unit.resources || {};
  if (unit.kit === "ruby") return `纳米 ${r.nano || 0}/100${Number(r.nanoReserve) > 0 ? " · 储备 " + r.nanoReserve : ""}${r.mecha ? " · 机甲中" : ""}${r.overdrive ? " · 机体强化" : ""}${r.drone ? (r.mecha ? " · 无人机（激光）" : " · 无人机") : ""}${r.preparedActive ? " · 准备生效" : (r.preparedPending || r.prepared) ? " · 已准备" : ""}`;
  if (unit.kit === "mint") return `耐久 ${r.durability != null ? r.durability : "—"}`;
  if (unit.kit === "yuito") {
    const bond = r.bondName ? ` · 牵挂 ${r.bondName}` : " · 无牵挂";
    return `咖啡豆 ${r.bean || 0} · 咖啡液 ${r.liquid || 0}${bond}`;
  }
  if (unit.kit === "hiaki") {
    const st = { draw: "拔刀", iai: "居合", waki: "胁构" }[r.stance || "draw"];
    const blade = r.blade === "naruto" ? "鳴門" : "丹生谷";
    const mx = typeof allinMaxUses === "function" ? allinMaxUses(unit) : 1;
    const us = Number(r.smashUsed) || 0;
    return `${blade} · ${st} · 全力 ${mx - us}/${mx}`;
  }
  if (unit.kit === "tou") return `圣盾 ${r.shield || 0}/3 · 嘲讽剩余 ${r.tauntLeft == null ? 2 : r.tauntLeft}`;
  if (unit.kit === "xia") return `${r.engine ? "引擎启动" : "引擎关闭"}${typeof passivePlus === "function" && passivePlus(unit, 1) ? " · 燃油 " + (Number(r.fuel) || 0) + "/5" : ""}${r.preparedActive ? " · 准备生效" : r.preparedPending || r.prepared ? " · 已准备" : ""}`;
  if (unit.kit === "chuan") return `电能 ${r.charge || 0}`;
  if (unit.kit === "nora") {
    const pin = typeof piercedTarget === "function" ? piercedTarget(unit) : null;
    return `${r.mood === "cruel" ? "残忍" : "温和"} · ${pin ? "刺入 " + pin.name : "无刺入"}${r.forceCruelNext ? " · 下回合转残忍" : ""}`;
  }
  if (unit.kit === "vitas") {
    // 双相状态属于维塔斯这套武器系统，分出来之后也要能看到
    const n = typeof noraOf === "function" ? noraOf() : null;
    const mood = typeof noraMood === "function" ? (noraMood(n) === "cruel" ? "残忍" : "温和") : "";
    const pin = typeof piercedTarget === "function" ? piercedTarget(n) : null;
    return `${mood} · ${pin ? "刺入 " + pin.name : "无刺入"} · 耐久 ${r.durability != null ? r.durability : "—"}`;
  }
  if (unit.kit === "kolt") {
    const bit = r.bit === "acid" ? "酸液炮" : "电钻";
    const scrap = (unit.level || 1) >= 2 && typeof koltScrapTotal === "function" ? ` · 废料 ${koltScrapTotal(unit)}` : "";
    return bit + scrap;
  }
  if (unit.kit === "longge") return `扳机${r.trigger ? "解锁" : "锁定"} · ${typeof longgeAmmoText === "function" ? longgeAmmoText(unit) : ""}${r.spitUsed ? " · 已吐酸" : ""}`;
  if (unit.kit === "xiaoxiao") {
    const lg = typeof longgeOf === "function" ? longgeOf() : null;
    return `${lg && typeof longgeAmmoText === "function" ? longgeAmmoText(lg) + " · " : ""}耐久 ${r.durability != null ? r.durability : "—"}`;
  }
  if (r.durability != null) return `耐久 ${r.durability}`;
  return "";
}
