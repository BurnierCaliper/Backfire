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
      growth: { hp: 6, shp: 5 },
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
      enName: "Chuan",
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
      suggest: { element: "energy", dice: [1, 4], flat: 0, baseBreak: 1 },
      layers: [{ type: "flesh", hp: 16 }],
      shp: 10,
      shpMax: 10,
      resources: { charge: 0 },
      linkedKits: ["bili"],
      note: "犬类人电工 · 能量/电 · 护卫控场",
      attrs: { str: 3, con: 7, dex: 8, wil: 5, int: 7, sta: 8 },
      roles: { primary: "护卫", secondary: "控场" },
      growth: { hp: 7, shp: 5 },
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
      growth: { hp: 5, shp: 6 },
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
    }
  ];
}

function skillCost(id) {
  if (id === "yuito_inspire") {
    const fl = typeof state !== "undefined" ? state.skillFlow : null;
    if (fl && fl.picks && fl.picks.mode === "stay") return { ap: 1 };
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
    chuan_summon: { ap: 1, bonus: 1 }, chuan_wall: { ap: 1 }, chuan_over: { ap: 1 },
    bili_beam: { ap: 1 }, bili_magnet: { ap: 1 }, bili_field: { ap: 1 }, bili_storm: { ap: 1 }, bili_return: { ap: 1 },
    nora_aa: { ap: 1 }, nora_needle: { ap: 1 }, nora_assist: {},
    nora_summon: { ap: 1, bonus: 1 },
    nora_soothe: { bonus: 1 }, nora_indwell: { ap: 1 },
    nora_pressure: { ap: 1 }, nora_sonic: { ap: 1 },
    vitas_infuse: { ap: 1 }, vitas_rip: { ap: 1 }, vitas_slash: { ap: 1 }, vitas_dance: { ap: 1 },
    vitas_return: { ap: 1 },
    kolt_aa: { ap: 1 }, kolt_short: { ap: 1 }, kolt_chase: { bonus: 1 },
    kolt_assist: {}, kolt_summon: { ap: 1, bonus: 1 }, kolt_scrap: { ap: 1 },
    torque_boost: { ap: 1 }, torque_swap: { ap: 1 }, torque_strip: { ap: 1 }, torque_return: { ap: 1 },
    helu_aa: { ap: 1 }, helu_wave: { ap: 1 }, helu_scan: { ap: 1 }, helu_assist: {},
    helu_summon: { ap: 1, bonus: 1 },
    ecmo_bite: { ap: 1 }, ecmo_focus: { ap: 1 }, ecmo_boom: { ap: 1 }, ecmo_return: { ap: 1 },
    ras_aa: { ap: 1 }, ras_dump: { ap: 1 }, ras_flee: { ap: 1 }, ras_assist: {},
    ras_summon: { ap: 1, bonus: 1 },
    edc_drain: { ap: 1 }, edc_shock: { ap: 1 }, edc_flash: { ap: 1 }, edc_return: { ap: 1 }
  };
  return map[id] || { ap: 1 };
}

/* 空手格挡率（角色自身）。持武器时 = 空手格挡率 + 武器提供的格挡率。 */
const BARE_BLOCK = { kolt: 20, helu: 25, ras: 20 };
/* 武器人持在手里时提供给主人的格挡率。
   它自己作为独立单位在场时的格挡率，写在下面 blockChance 的 map 里。 */
const WEAPON_PROVIDE_BLOCK = { torque: 35, ecmo: 20, edc: 25 };

function bareBlockChance(unit) {
  if (!unit || !unit.kit) return 30;
  return BARE_BLOCK[unit.kit] != null ? BARE_BLOCK[unit.kit] : 30;
}
/** 主人手里那把武器提供的格挡率；武器人已分出去就不提供 */
function heldWeaponBlockBonus(unit) {
  if (!unit) return 0;
  const kits = unit.linkedKits || [];
  let best = 0;
  kits.forEach(k => {
    if (WEAPON_PROVIDE_BLOCK[k] == null) return;
    const out = (state.units || []).some(u => u.kit === k && !u.hidden && !u.fused && !u.dead);
    if (out) return;
    best = Math.max(best, WEAPON_PROVIDE_BLOCK[k]);
  });
  return best;
}

function blockChance(unit) {
  if (!unit || !unit.kit) return null;
  if (isUnarmed(unit)) return bareBlockChance(unit);
  // 新角色按「空手 + 武器提供」算；老角色沿用下面写死的值
  if (BARE_BLOCK[unit.kit] != null) return bareBlockChance(unit) + heldWeaponBlockBonus(unit);
  const map = {
    ruby: 50, mint: 40, yuito: 60, latte: 40,
    hiaki: unit.resources && unit.resources.blade === "naruto" ? 60 : 70,
    niu: 50, naruto: 40, tou: 70, mochi: 60,
    xia: unit.resources && unit.resources.engine ? 70 : 60,
    berniel: 40,
    chuan: 80,
    bili: 50,
    nora: 50,
    vitas: 50,
    kolt: 55,
    torque: 60,
    helu: 45,
    ecmo: 40,
    ras: 45,
    edc: 50,
    captain_ox: 40,
    patrol_car: 40
  };
  return map[unit.kit];
}

function skillList(unit) {
  if (!unit || !unit.kit) return [];
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
    } else {
      add({ id: "wing_aa", name: "银翼·普通攻击", hint: "距离1以内 · 1atk+1d4 能量 1击破 · 同区其他 0.3atk" });
      add({ id: "wing_steal", name: "银翼·电力夺取", hint: "同区每个敌人 0.5atk 电 · 每人 +10纳米" });
      add({ id: "wing_surge", name: "银翼·电流激荡", hint: "距离1-2 · 1atk 电 1击破 · 打到护盾 +20纳米", minLv: 2 });
      add({ id: "ruby_unmecha", name: "解除机甲", hint: "立刻分开瑞比与明特" });
    }
  }
  if (unit.kit === "mint") {
    if (!mecha) {
      add({ id: "mint_mecha", name: "机甲模式", hint: "不耗行动 · 需与瑞比同区且纳米足够" });
      add({ id: "mint_steal", name: "电力夺取", hint: "距离1以内 · 1atk 电击 · +20纳米" });
      add({ id: "mint_banish", name: "驱逐", hint: "同区两次 0.5atk 电 · 共 1 击破 · 推开 1 格", minLv: 2 });
      add({ id: "mint_return", name: "收回为武器", hint: "需与瑞比同区" });
    }
  }
  if (unit.kit === "yuito") {
    add({ id: "yuito_aa", name: "普通攻击", hint: "距离1 · 1atk 冰 +1击破 · 豆→液" });
    add({ id: "yuito_amer", name: "冰美式", hint: `消耗 1 咖啡液 · 治疗 2d${typeof leveledSides === "function" ? leveledSides(unit.level || 1, 4) : 4} 或 清场 0.75atk 冰 +1击破` });
    add({ id: "yuito_espresso", name: "意式浓缩", hint: "消耗 1 咖啡液 · 友方行动点+1 或 1atk 酸 +2击破", minLv: 2 });
    add({ id: "yuito_extract", name: "酸萃", hint: `消耗 1 咖啡液 · 区域变酸液 · 友方 ${typeof addedDiceByLevel === "function" ? addedDiceByLevel(unit.level || 1) : 1}d4 治疗 / 敌人同样骰数的酸`, minLv: 3 });
    add({ id: "yuito_summon", name: "唤出拿铁", hint: "武器生物化" });
  }
  if (unit.kit === "nora") {
    const lv = unit.level || 1;
    add({ id: "nora_aa", name: "普通攻击", hint: "距离1 · 1atk 冰 +1击破 · 有刺入则只能打刺入目标（温和治疗／残忍加伤）" });
    add({ id: "nora_needle", name: "发射针尖", hint: "距离1 · 施加刺入 · 温和则自己移到目标区／残忍则附加冻伤" });
    add({ id: "nora_summon", name: "唤出维塔斯", hint: "武器生物化" });
    add({ id: "nora_soothe", name: "安抚", hint: "附赠 · 安抚维塔斯，切换为温和", minLv: 2, bare: true });
    add({ id: "nora_indwell", name: "留置针", hint: "对刺入目标施加刺骨与 1 冻伤", minLv: 3 });
    add({ id: "nora_pressure", name: "压力升高", hint: "下回合开始必定转为残忍 · 下一击带衍射", minLv: 6 });
    add({ id: "nora_sonic", name: "声波震击", hint: "同区全体 0.5atk 谐波 +1击破 · 刺入目标额外再吃一次", minLv: 11 });
  }
  if (unit.kit === "vitas") {
    add({ id: "vitas_infuse", name: "加压灌输", hint: "对刺入目标 · 温和 2d4 治疗并 +1 架势／残忍 1atk 冰 +1击破与两次冻伤" });
    add({ id: "vitas_rip", name: "扯下", hint: "仅残忍 · 对刺入目标 1.5atk 谐波 +2击破 · 结束刺入" });
    add({ id: "vitas_slash", name: "针尖剑斩", hint: "同区 1atk 谐波 +1击破 · 有刺入则只能打刺入目标并先移动过去", minLv: 2 });
    add({ id: "vitas_dance", name: "寒气剑舞", hint: "场上无刺入才能用 · 三次 0.2atk 冰 共1击破 · 温和治疗同区友方／残忍每击冻伤", minLv: 4 });
    add({ id: "vitas_return", name: "收回为武器", hint: "需与诺拉同区" });
  }
  if (unit.kit === "latte") {
    add({ id: "latte_puff", name: "毛球攻击", hint: "距离1 · atk 酸 +1击破 · 豆→液" });
    add({ id: "latte_ice", name: "制冰机", hint: "天气变为雪天" });
    add({ id: "latte_love", name: "爱意", hint: "移到友方同区 · 2d4 生命 +1 架势 · 牵挂", minLv: 2 });
    add({ id: "latte_return", name: "收回为武器", hint: "需与结人同区" });
  }
  if (unit.kit === "hiaki") {
    add({ id: "hiaki_aa", name: "普通攻击", hint: "按刀势：拔刀 1atk+1击破 / 居合 移动后 1.5atk / 胁构 1atk+2击破" });
    add({ id: "hiaki_sheath", name: "收刀", hint: "选一把刀，进入居合" });
    add({ id: "hiaki_summon", name: "分出当前刀", hint: "武器生物化其中一把，另一把仍可持用" });
    add({ id: "hiaki_flash", name: "一闪", hint: "仅居合 · 同区全体 1atk +1击破 · 进入拔刀", minLv: 2 });
    add({ id: "hiaki_pot", name: "热锅", hint: "仅丹生谷 · 同区施加熔融", minLv: 3 });
  }
  if (unit.kit === "niu") {
    add({ id: "niu_slash", name: "斩炎", hint: "同区 · 1atk 火 +1击破 · 灼烧 · 变回武器" });
    add({ id: "niu_tsubame", name: "燕返", hint: "距离1 · 1atk 火 +1击破 · 收回并换持丹生谷，鳴門出场", minLv: 2 });
    add({ id: "niu_return", name: "变回武器", hint: "需与绯秋同区" });
  }
  if (unit.kit === "naruto") {
    add({ id: "naruto_wind", name: "寒风", hint: "距离1 · 1atk 冰 +1击破 · 冻伤 · 变回武器" });
    add({ id: "naruto_fly", name: "燕飞", hint: "同区 0.5atk 冰 +1击破 · 然后移动 1 格", minLv: 2 });
    add({ id: "naruto_return", name: "变回武器", hint: "需与绯秋同区" });
  }
  if (unit.kit === "tou") {
    add({ id: "tou_aa", name: "普通攻击", hint: "同区 · 1atk 物理 +1击破 · 可在技能里耗圣盾打邻区" });
    add({ id: "tou_start", name: "圣战起始", hint: "移动≤1 · 同区施加错位 · 可耗圣盾带一人" });
    add({ id: "tou_sonic", name: "声波切割", hint: "同区 1atk 谐波 + 距离1 另目标 0.5atk 谐波 · 耗 1 圣盾", minLv: 2 });
    add({ id: "tou_ultra", name: "超音波", hint: "同区施加折射", minLv: 3 });
    add({ id: "tou_summon", name: "唤出年糕", hint: "武器生物化" });
    /* 圣盾延射程已并入普通攻击的分步选择 */
  }
  if (unit.kit === "mochi") {
    add({ id: "mochi_pounce", name: "猛扑", hint: "跃向距离1敌人，或带走同区敌人 · atk+1d4 物理 +1击破" });
    add({ id: "mochi_roar", name: "吼叫", hint: "同区 atk+1d4 谐波 +1击破 · 强制换区" });
    add({ id: "mochi_boom", name: "音爆", hint: "同区每个敌人 0.5atk 谐波 +1击破 · 可再耗圣盾一次", minLv: 2 });
    add({ id: "mochi_return", name: "收回为武器", hint: "需与灯同区" });
  }
  if (unit.kit === "xia") {
    add({ id: "xia_aa", name: "普通攻击", hint: "近战 1d4+atk 物理 2击破 · 引擎时火焰 3击破" });
    add({ id: "xia_engine", name: "拉响引擎", hint: "发动引擎" });
    add({ id: "xia_execute", name: "处决", hint: "引擎+目标晕眩 · 1d8+1.5atk 火焰 · 穿刺", minLv: 2 });
    add({ id: "xia_ram", name: "全速撞击", hint: "引擎 · 移动≤2 · atk物理+震荡 · 每移1格+1击破", minLv: 3 });
    add({ id: "xia_selfburn", name: "引火烧身", hint: "需引擎 · 进入自焚，可选立刻移动 1 距离", minLv: 6, bare: true });
    add({ id: "xia_crush", name: "狂怒碾压", hint: "同区 · 需引擎 · 1.5atk 物理 +3击破 · 未死未失衡则抓住敌人，每回合自动重复", minLv: 11 });
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
    add({ id: "chuan_aa", name: "普通攻击", hint: "近距离 · 两次 atk/2+1d4 能量 共1击破 · 耗1电能变三次共2击破" });
    add({ id: "chuan_whip", name: "电击鞭", hint: "距离1以内 · atk/2 电击 1击破 · +1电能" });
    add({ id: "chuan_wall", name: "铁壁", hint: "耗1电能 · 同区挡伤盾 atk+1d6 装甲", minLv: 2 });
    add({ id: "chuan_over", name: "电站超频", hint: "友方（可对自己）过载 · +1电能；已有≥3电能则改为 atk/2 护盾", minLv: 3 });
    add({ id: "chuan_pulse", name: "高能脉冲", hint: "距离1以内 · 对一个敌人施加高能", minLv: 6 });
    add({ id: "chuan_blade", name: "巨刃划空", hint: "同区 · 耗3电能 · 2atk 电击 +2击破 · 对配置物伤害翻倍 · 击穿血量层或摧毁配置物返还1电能", minLv: 11 });
    add({ id: "chuan_summon", name: "唤出哔哩哩", hint: "武器生物化" });
  }
  if (unit.kit === "bili") {
    add({ id: "bili_beam", name: "电光束", hint: "任意距离 · 1atk 电击 · 感电" });
    add({ id: "bili_magnet", name: "磁力移动", hint: "任意距离 · 同区推远或他区拉到身边 · 1击破" });
    add({ id: "bili_field", name: "磁场盾", hint: "耗川川1电能 · 同区友方 +atk 护盾", minLv: 2 });
    add({ id: "bili_storm", name: "雷电风暴", hint: "耗全部电能 · 电能×2 次 0.4atk 电击 · 每2电能1击破 · 目标感电则+2电能", minLv: 4 });
    add({ id: "bili_return", name: "收回为武器", hint: "需与川川同区" });
  }
  if (unit.kit === "kolt") {
    const bit = (unit.resources && unit.resources.bit) || "drill";
    add({ id: "kolt_aa", name: "普通攻击", hint: bit === "acid" ? "距离1 · 1atk 酸 +1击破" : "同区 · 三次 0.4atk 电 · 共2击破" });
    add({ id: "kolt_short", name: "直流短接", hint: "需电钻 · 可先移≤1，再对同区铺高压场地" });
    add({ id: "kolt_chase", name: "紧追", hint: "附赠 · 对一个敌人施加紧追", bare: true });
    add({ id: "kolt_scrap", name: "废物利用", hint: "取上场上一个被摧毁血量层×2 的对应生命", minLv: 2 });
    add({ id: "kolt_summon", name: "唤出扭矩", hint: "武器生物化" });
  }
  if (unit.kit === "torque") {
    const bit = koltBit();
    add({ id: "torque_boost", name: "强化输出", hint: bit === "acid" ? "选定区域蓄力，下回合开始对该区酸液AOE" : "移动1后三次 0.5atk 电 · 共2击破" });
    add({ id: "torque_swap", name: "拆装部件", hint: "更换刀头，再打对应距离 1atk +1击破，强制收回" });
    add({ id: "torque_strip", name: "拆卸模式", hint: "需电钻 · 同区 2击破，外层血量转给同区友方", minLv: 2 });
    add({ id: "torque_return", name: "收回为武器", hint: "需与柯尔特同区" });
  }
  if (unit.kit === "helu") {
    add({ id: "helu_aa", name: "普通攻击", hint: "远距离 · 1atk 谐波 +1击破 · 有聚焦则打聚焦层" });
    add({ id: "helu_wave", name: "驻波", hint: "进入相位；已扫描战场则可推进相位阶段" });
    add({ id: "helu_scan", name: "环境扫描", hint: "检查一区：可能出现配置物，或远程操作已有配置物", minLv: 2 });
    add({ id: "helu_summon", name: "唤出 Ecmo", hint: "武器生物化" });
  }
  if (unit.kit === "ecmo") {
    add({ id: "ecmo_bite", name: "叮咬", hint: "同区 · 1atk 物理 +1击破 · 造成失衡返还行动点" });
    add({ id: "ecmo_focus", name: "频谱分析", hint: "任意敌人的任意血量层施加聚焦" });
    add({ id: "ecmo_boom", name: "音爆", hint: "同区全体 0.5atk 谐波 · 触发配置物 · 聚焦层打两次", minLv: 2 });
    add({ id: "ecmo_return", name: "收回为武器", hint: "需与 Helumica 同区" });
  }
  if (unit.kit === "ras") {
    add({ id: "ras_aa", name: "普通攻击", hint: "远距离 · 两次 0.5atk 能量 共1击破 · 累积20%能量" });
    add({ id: "ras_dump", name: "泄能", hint: "任意距离 · 施加高能 · 转化20%能量为光能" });
    add({ id: "ras_flee", name: "逃离", hint: "移动1 · +20%能量 · 原区一名敌人 1atk 电。不稳则移动不限", minLv: 2 });
    add({ id: "ras_summon", name: "唤出 EDC30k", hint: "武器生物化" });
  }
  if (unit.kit === "edc") {
    add({ id: "edc_drain", name: "引流", hint: "需与拉斯缪尔同区 · 累积能量全转光能 · 不稳+25%" });
    add({ id: "edc_shock", name: "电流冲击", hint: "距离1 · 1atk 电 +1击破 · 有光能则再打等量电击" });
    add({ id: "edc_flash", name: "爆闪", hint: "释放全部光能 · 同区每名敌人 光能/2 能量 +1击破", minLv: 2 });
    add({ id: "edc_return", name: "收回为武器", hint: "需与拉斯缪尔同区" });
  }
  if (isUnarmed(unit)) {
    add({ id: "bare_aa", name: "空手攻击", hint: "同区 · 1×atk 物理。未持武器时的基本攻击。" });
  }
  (roleSkillsUnlocked(unit) || []).forEach(rs => {
    const def = roleSkillDef(rs.role, rs.n, unit);
    if (def) add(def);
  });
  if (isUnarmed(unit)) {
    return list.filter(s => s.id === "bare_aa" || s.bare || (s.id && s.id.indexOf("role_") === 0) || (s.id && s.id.indexOf("fx_") === 0));
  }
  return list;
}

/** 职责技能的定义（手册第六步职责表）。unit 用来算与等级有关的提示文字。 */
function roleSkillDef(role, n, unit) {
  unit = unit || {};
  if (role === "直伤" && n === 1) return { id: "xia_prep", name: "准备", hint: "附赠 · 下回合伤害骰 +1d6（每5级提高骰子）· 对复数攻击只生效一次", bare: true };
  if (role === "直伤" && n === 2) return { id: "role_refine", name: "精益求精", hint: `附赠 · 下一击弱点特效 · 每场${(unit.level || 1) >= 15 ? "两次" : "一次"}` };
  if (role === "直伤" && n === 3) return { id: "role_pierce", name: "一击制敌", hint: "附赠 · 下一击穿刺 · 每场一次" };
  if (role === "直伤" && n === 4) return { id: "role_gambit", name: "破釜沉舟", hint: "行动点 · 下回合攻击双倍，自己受伤双倍 · 每场一次" };
  if (role === "异常" && n === 1) return { id: "role_activate", name: "激活", hint: "附赠 · 立刻触发目标一种状态" };
  if (role === "异常" && n === 2) return { id: "role_spread", name: "传播", hint: "行动点 · 复制目标全部状态到另一单位" };
  if (role === "异常" && n === 3) return { id: "role_double_dot", name: "加倍计量", hint: "附赠 · 目标本回合状态效果翻倍 · 每局限一次" };
  if (role === "异常" && n === 4) return { id: "role_self_doom", name: "自我毁灭", hint: "附赠开关 · 施加状态翻倍，自己也吃一层" };
  if (role === "击破" && n === 1) return { id: "hiaki_allin", name: "全力以赴", hint: "附赠 · 下一击猛击" };
  if (role === "击破" && n === 2) return { id: "role_breakwave", name: "破势", hint: "附赠 · 同区架势=1（15级≤2）的敌人各 1 无属性击破" };
  if (role === "击破" && n === 3) return { id: "role_halve", name: "折戟", hint: "行动点 · 造成当前架势一半击破 · 每场一次" };
  if (role === "击破" && n === 4) return { id: "role_omen", name: "击破预告", hint: "行动点 · 下回合双倍击破，失败则自己失衡 · 每场一次" };
  if (role === "坦克" && n === 1) return { id: "tou_taunt", name: "嘲讽", hint: "附赠 · 距离1以内敌人下次必须打自己 · 每场2次（5级3次，15级4次）· 可空手", bare: true };
  if (role === "坦克" && n === 2) return { id: "role_lockdown", name: "禁足怒吼", hint: "行动点 · 同区敌人本回合不能移动且必须打坦克" };
  if (role === "坦克" && n === 3) return { id: "role_grit", name: "咬牙坚持", hint: "附赠 · 本回合减伤 50% · 每场两次" };
  if (role === "坦克" && n === 4) return { id: "role_stand", name: "屹立不倒", hint: "行动点 · 本回合免疫伤害和击破 · 每场一次" };
  if (role === "护卫" && n === 1) return { id: "role_cover", name: "掩护", hint: "附赠 · 此回合免费为指定队友协助格挡" };
  if (role === "护卫" && n === 2) return { id: "role_fear", name: "恐惧怒吼", hint: "行动点 · 距离1内敌人本回合虚弱 · 每场两次" };
  if (role === "护卫" && n === 3) return { id: "role_guard_strike", name: "防守反击", hint: "行动点 · 本回合首次成功格挡追加一次协助攻击" };
  if (role === "护卫" && n === 4) return { id: "role_all_reflect", name: "全反击", hint: "行动点 · 本回合全队成功格挡反伤伤害与击破 · 每场一次" };
  if (role === "生存" && n === 1) return { id: "role_firstaid", name: "应急处理", hint: "行动点 · 距离1以内友方 1d4+2（半血取最大）" };
  if (role === "生存" && n === 2) return { id: "role_buffer", name: "缓冲", hint: "附赠 · 距离1以内友方 2d4+4 护盾 · 每场一次" };
  if (role === "生存" && n === 3) return { id: "role_dome", name: "防护罩", hint: "行动点 · 同区 atk+10 护盾罩 · 每场一次" };
  if (role === "生存" && n === 4) return { id: "role_renew", name: "续命", hint: "行动点 · 恢复最大生命 50%，濒死则起身并恢复 25% · 每场一次" };
  if (role === "环境手" && n === 1) return { id: "role_lock", name: "锁定", hint: "附赠 · 锁定一种天气或场地本回合不被修改" };
  if (role === "环境手" && n === 2) return { id: "role_shelter", name: "保释", hint: "附赠 · 一名友方本回合豁免天气场地" };
  if (role === "环境手" && n === 3) return { id: "role_harsh", name: "恶劣环境", hint: "附赠 · 一名单位本回合场地天气双倍 · 每场一次" };
  if (role === "环境手" && n === 4) return { id: "role_apocalypse", name: "末日", hint: "行动点 · 整场天气与场地翻倍且无法停止 · 每场一次" };
  if (role === "控场" && n === 1) return { id: "role_pull", name: "拉拽", hint: "附赠 · 把目标拉到自己区域" };
  if (role === "控场" && n === 2) return { id: "role_boost", name: "借力", hint: "附赠 · 把一名友方移到任意区域" };
  if (role === "控场" && n === 3) return { id: "role_shake", name: "撼动", hint: "行动点 · 同区所有敌人不稳 · 每场一次" };
  if (role === "控场" && n === 4) return { id: "role_rearrange", name: "重整", hint: "行动点 · 距离1内单位各可移1区，并可改两名飞行 · 每场一次" };
  if (role === "辅助" && n === 1) return { id: "yuito_inspire", name: "助威", bare: true, hint: (unit.level || 1) >= 10 ? "10级：附赠=本回合振奋，或行动点=持续振奋" : "附赠 · 一名其他友方 · 本回合振奋" };
  if (role === "辅助" && n === 2) return { id: "role_sturdy", name: "不倒战意", hint: "附赠 · 同区友方本回合坚挺" };
  if (role === "辅助" && n === 3) return { id: "role_gold", name: "黄金时间", hint: "附赠 · 一种即时效果延长一回合 · 每场两次" };
  if (role === "辅助" && n === 4) return { id: "role_rally", name: "全队集结", hint: "行动点 · 同区队员获得主职责增益直到自己晕眩或濒死 · 长休一次" };
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
  return units.find(u => u.kit === weapon.weaponOf && !u.hidden);
}

function findKit(kit, units) {
  return units.find(u => u.kit === kit && !u.hidden);
}

/** 实际 atk = 基础 atk − 力竭惩罚（力竭 2 起 atk −3，只对角色本人） */
function effectiveAtk(unit, units) {
  if (!unit) return 0;
  // 单局的客制化图纸：拿着装了图纸的武器时 atk 加减
  const mod = typeof unitWeaponMod === "function" ? (Number(unitWeaponMod(unit).atk) || 0) : 0;
  const base = Math.max(0, baseEffectiveAtk(unit, units) + mod);
  const tier = typeof exhaustTierOf === "function" ? exhaustTierOf(unit) : 0;
  return tier >= 2 ? Math.max(0, base - 3) : base;
}

function baseEffectiveAtk(unit, units) {
  if (!unit) return 0;
  if (unit.resources && unit.resources.mecha) {
    const mint = units.find(u => u.kit === "mint");
    return (unit.personalAtk || 0) + ((mint && mint.personalAtk) || unit.weaponAtk || 8);
  }
  if (unit.kit === "hiaki") {
    const blade = (unit.resources && unit.resources.blade) || "niu";
    const out = blade === "niu" ? unit.resources.niuOut : unit.resources.narutoOut;
    const lv = (unit.weaponLevels && unit.weaponLevels[blade]) || 1;
    const wAtk = typeof computeWeaponAtk === "function"
      ? computeWeaponAtk(blade, unit.attrs, lv)
      : (blade === "niu" ? 7 : 6);
    return (unit.personalAtk || 0) + (out ? 0 : wAtk);
  }
  if (unit.weaponHeld === false) return unit.personalAtk || 0;
  return (unit.personalAtk || 0) + (unit.weaponAtk || 0);
}

function resourceText(unit) {
  if (!unit || !unit.kit) return "";
  const r = unit.resources || {};
  if (unit.kit === "ruby") return `纳米 ${r.nano || 0}/100${r.mecha ? " · 机甲中" : ""}${r.preparedActive ? " · 准备生效" : (r.preparedPending || r.prepared) ? " · 已准备" : ""}`;
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
  if (unit.kit === "xia") return `${r.engine ? "引擎启动" : "引擎关闭"}${r.preparedActive ? " · 准备生效" : r.preparedPending || r.prepared ? " · 已准备" : ""}`;
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
  if (r.durability != null) return `耐久 ${r.durability}`;
  return "";
}
