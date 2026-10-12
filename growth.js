const XP_BY_RANK = {
  minion: [0,5,15,30,50,80,110,200,320,400,570,740,950,1200,1400,1600,1800,2100,2400,2700,3000,3500,4000,4500,5000,5500],
  elite:  [0,10,30,70,100,150,210,320,600,800,1200,1600,2000,2500,3000,3500,4000,4500,5000,5500,6000,6600,7200,7800,8400,9200],
  boss:   [0,30,80,200,400,600,1200,2400,3500,5000,7000,9000,11000,14000,16000,18000,20000,22000,25000,27000,30000,34000,38000,42000,46000,50000]
};

const ENEMY_RANK = {
  guard_sword: "minion", guard_gun: "minion", thug_knife: "minion", thug_hammer: "minion",
  boomcar: "minion", sand_beast: "minion", sand_human: "minion", buoy: "minion",
  dumpdrone: "minion", swarm: "minion", crow: "minion", patrol_car: "minion",
  mecha_mg: "elite", mecha_gl: "elite", bandit_boss: "elite", captain_wolf: "elite",
  captain_ox: "elite", captain_lizard: "elite", bigsand: "elite", livesand: "elite",
  giant: "elite", patrolboat: "elite", spreader: "elite", watchcrow: "elite", dustbody: "elite",
  outlaw_king: "boss", chixia: "boss", sand_aggregate: "boss",
  ufo_body: "boss", ufo_leg: "minion"
};

function enemyRankOf(u) {
  if (!u || u.isPlayer) return null;
  return ENEMY_RANK[u.kit] || "minion";
}

function enemyActBudget(u) {
  if (!u || u.isPlayer) return { ap: 1, bonus: 1 };
  // 手册：没写「一回合几动」的都是 1 行动点。赤牙是指挥官（第九章：每回合 3 行动点 + 1 附赠）；
  // 亡命之王不是指挥官，一回合一动。
  if (u.kit === "chixia") return { ap: 3, bonus: 1 };
  // 扬尘体：原本是 2 行动点 0 附赠，靠行动点移动。改成移动只能用附赠之后，
  // 给它 1 附赠保持「移动 + 一次攻击」的原有强度，否则它完全动不了。
  if (u.kit === "dustbody") return { ap: 1, bonus: 1 };
  if (u.kit === "sand_aggregate") {
    const ph = (u.resources && u.resources.phase) || 1;
    if (ph === 2 || ph === 3) return { ap: 2, bonus: 1 };
    return { ap: 1, bonus: 1 };
  }
  const r = enemyRankOf(u);
  if (r === "minion") return { ap: 1, bonus: 0 };
  if (r === "elite") return { ap: 1, bonus: 1 };
  return { ap: 1, bonus: 1 };
}

function xpDrop(rank, level) {
  const t = XP_BY_RANK[rank] || XP_BY_RANK.minion;
  const lv = Math.max(1, Math.min(25, Number(level) || 1));
  return t[lv] || t[t.length - 1];
}

// 升级所需经验的倍率。跑团版 / 战斗原型为 1；Roguelike 单局里由 rogue.js 设成配置值（目前 1/3）。
let XP_REQ_SCALE = 1;
function setXpRequirementScale(s) {
  XP_REQ_SCALE = Number(s) > 0 ? Number(s) : 1;
}

function xpToNext(lv) {
  const n = Math.max(1, Number(lv) || 1);
  const need = {
    1: 155, 2: 390, 3: 700, 4: 1050, 5: 2100, 6: 4100, 7: 6600, 8: 9600, 9: 12000,
    10: 17000, 11: 21000, 12: 26000, 13: 30000, 14: 38000, 15: 44000, 16: 52000,
    17: 58000, 18: 67000, 19: 73000
  };
  return need[n] ? Math.max(1, Math.ceil(need[n] * XP_REQ_SCALE)) : 0;
}

function ceilDiv2(n) {
  return Math.ceil(n / 2);
}

/** 六维属性的硬性上限：作者定不设上限 */
const ATTR_HARD_MAX = Infinity;

function derivedFromAttrs(attrs, level) {
  attrs = attrs || {};
  const str = Number(attrs.str) || 5;
  const con = Number(attrs.con) || 5;
  const dex = Number(attrs.dex) || 5;
  const wil = Number(attrs.wil) || 5;
  const intel = Number(attrs.int) || 5;
  const sta = Number(attrs.sta) || 5;
  const lv = Math.max(1, Number(level) || 1);
  const up = lv - 1;
  return {
    hp: con * 2 + 2 + con * up,
    personalAtk: Math.ceil(4 + (str - 5) / 2) + Math.ceil(str * up / 7),
    def: Math.ceil(4 + (sta - 5) / 2) + Math.floor(lv / 10),
    shp: 10 + (wil - 5) + wil * up,
    cyber: Math.max(0, Math.min(99, 50 + (intel - 5) * 10)),
    dex, str, con, wil, intel, sta
  };
}

const WEAPON_GROWTH = {
  mint:     { layer: "armor",  baseHp: 8,  hp: 4, baseAtk: 8, atk: 4, baseDef: 3, baseDur: 5 },
  latte:    { layer: "armor",  baseHp: 8,  hp: 4, baseAtk: 4, atk: 3, baseDef: 3, baseDur: 6 },
  niu:      { layer: "armor",  baseHp: 8,  hp: 4, baseAtk: 5, atk: 4, baseDef: 3, baseDur: 5 },
  naruto:   { layer: "armor",  baseHp: 7,  hp: 4, baseAtk: 4, atk: 3, baseDef: 3, baseDur: 5 },
  mochi:    { layer: "armor",  baseHp: 12, hp: 5, baseAtk: 5, atk: 3, baseDef: 4, baseDur: 6 },
  berniel:  { layer: "armor",  baseHp: 10, hp: 6, baseAtk: 5, atk: 0, baseDef: 3, baseDur: 5 },
  bili:     { layer: "shield", baseHp: 10, hp: 4, baseAtk: 3, atk: 0, baseDef: 3, baseDur: 6 },
  // 维塔斯：内层装甲每级 +1，外层护盾每级 +4
  vitas:    { layer: "armor",  baseHp: 5,  hp: 1, baseDef: 4, baseDur: 4,
              extra: [{ layer: "shield", baseHp: 6, hp: 4 }] },
  torque:   { layer: "armor",  baseHp: 14, hp: 6, baseDef: 4, baseDur: 6 },
  ecmo:     { layer: "armor",  baseHp: 8,  hp: 4, baseDef: 3, baseDur: 4 },
  edc:      { layer: "armor",  baseHp: 10, hp: 4, baseDef: 4, baseDur: 5 },
  // 小朋友（龙哥的武器）：装甲 12、每级 +5；耐久 5、和其他武器一样每两级 +1；架势 4
  xiaoxiao: { layer: "armor",  baseHp: 12, hp: 5, baseDef: 4, baseDur: 5 }
};
/** 武器的耐久上限（没装图纸时）：基础耐久 + 每 durEvery 级 +1（没写就是每两级） */
function weaponBaseDur(kit, lv) {
  const g = WEAPON_GROWTH[kit] || {};
  return (g.baseDur || 5) + Math.floor((Math.max(1, Number(lv) || 1)) / (g.durEvery || 2));
}

const WEAPON_FORMULA = {
  mint: { base: 4, mainAttr: "int", mainCoef: 0.5, subAttr: "dex", subCoef: 0.3 },
  latte: { base: 2, mainAttr: "int", mainCoef: 0.5 },
  niu: { base: 4, mainAttr: "str", mainCoef: 0.6 },
  naruto: { base: 3, mainAttr: "str", mainCoef: 0.4, subAttr: "dex", subCoef: 0.2 },
  mochi: { base: 3, mainAttr: "str", mainCoef: 0.6 },
  berniel: { base: 5, mainAttr: "str", mainCoef: 0.8 },
  bili: { base: 3, mainAttr: "dex", mainCoef: 0.5 },
  vitas: { base: 4, mainAttr: "int", mainCoef: 0.4, subAttr: "dex", subCoef: 0.2 },
  torque: { base: 2, mainAttr: "str", mainCoef: 0.3, subAttr: "int", subCoef: 0.2 },
  ecmo: { base: 2, mainAttr: "int", mainCoef: 0.8 },
  edc: { base: 3, mainAttr: "int", mainCoef: 0.6, subAttr: "con", subCoef: 0.2 },
  xiaoxiao: { base: 3, mainAttr: "int", mainCoef: 0.4, subAttr: "dex", subCoef: 0.2 }
};

function weaponTier(lv) {
  return 0.5 * Math.max(1, Number(lv) || 1);
}

/* ===== 武器改装槽 =====
 * 武器 3 级多 1 个改装槽，7 级再多 1 个。改装件修改武器的补正系数：
 *   coef = { 属性: 增减量 }，正数加正补正，负数是负补正（例：配重块-beta 力量 +0.1、敏捷 −0.1）。
 * 装了什么记在角色身上：hero.weaponParts[武器kit] = [改装件 id 或 null, …]（按槽位）。
 * 改装件平时放在背包里（物品 id = "part_" + 改装件 id），装上从背包拿走，拆下放回背包。
 * C / B 级是程序生成的「凑数件」：主补正（力量 / 敏捷 / 智力）+ 一个不同属性的负补正（六维任意一个）。
 *   C 级：主补正 +0.1，负补正 −0.1，名字后缀 beta；B 级：±0.15，后缀 alpha。
 *   id = 等级_主属性_负属性（例：c_str_dex = 配重块-beta，力量 +0.1、敏捷 −0.1）。
 * 每个改装件另外固定加武器 atk（WEAPON_PART_FLAT_ATK：C / B 级 +1，A / S 级 +2），不随等级、属性变动——
 *   装上立刻就有感觉，不用等升很多级补正才显出来。
 * 另有两种「功能件」，不加正补正，同样带一个随机属性的负补正（C −0.1 / B −0.15 / A −0.2 / S −0.25）和固定 atk：
 *   格挡件（缓冲护板）：武器的格挡加成 +5% / +8% / +10% / +12%（C / B / A / S）——拿在手里时加到角色的协助格挡，
 *     武器人独立在场时加到它自己的格挡率；
 *   生命件（加固框架）：武器人每级装甲 +3 / +6 / +8 / +11（按武器等级算，装甲层；必哩没有装甲就加在护盾上）。
 *   id = 等级_block_负属性 / 等级_hp_负属性（例：c_block_dex = 缓冲护板-beta）。
 * 补正件的 A / S 级之后再设计；功能件的 A / S 级已经有数据（跑团主持人可以直接给），单局商店 / 工匠 / 奖励暂时只出 C / B。 */
const WEAPON_PART_SLOT_LEVELS = [3, 7];
const WEAPON_PART_ATTRS = ["str", "con", "dex", "wil", "int", "sta"];
const WEAPON_PART_GEN = {
  mains: { str: "配重块", dex: "轻量骨架", int: "调谐芯片" },
  grades: { C: { step: 0.1, suffix: "beta" }, B: { step: 0.15, suffix: "alpha" }, A: { step: 0.2, suffix: "gamma" }, S: { step: 0.25, suffix: "omega" } },
  coefGrades: ["C", "B"],   // 补正件目前只有 C / B 级
  // 功能件：每个等级的效果数值
  kinds: {
    block: { name: "缓冲护板", field: "block", grades: { C: 5, B: 8, A: 10, S: 12 } },
    hp: { name: "加固框架", field: "hpPerLv", grades: { C: 3, B: 6, A: 8, S: 11 } }
  }
};
const WEAPON_PART_FLAT_ATK = { C: 1, B: 1, A: 2, S: 2 };
/** 改装件固定加的 atk（写了 spec.atk 就用它，否则按等级） */
function weaponPartFlatAtk(id) {
  const p = WEAPON_PARTS[id];
  if (!p) return 0;
  return p.atk != null ? Number(p.atk) || 0 : (WEAPON_PART_FLAT_ATK[p.grade] || 0);
}
const WEAPON_PARTS = {};
WEAPON_PART_GEN.coefGrades.forEach(g => {
  const G = WEAPON_PART_GEN.grades[g];
  Object.keys(WEAPON_PART_GEN.mains).forEach(main => {
    WEAPON_PART_ATTRS.filter(a => a !== main).forEach(neg => {
      WEAPON_PARTS[`${g.toLowerCase()}_${main}_${neg}`] = {
        name: `${WEAPON_PART_GEN.mains[main]}-${G.suffix}`, grade: g, main, neg,
        coef: { [main]: G.step, [neg]: -G.step }, gen: true, kind: "coef"
      };
    });
  });
});
Object.keys(WEAPON_PART_GEN.kinds).forEach(kind => {
  const K = WEAPON_PART_GEN.kinds[kind];
  Object.keys(K.grades).forEach(g => {
    const G = WEAPON_PART_GEN.grades[g];
    WEAPON_PART_ATTRS.forEach(neg => {
      WEAPON_PARTS[`${g.toLowerCase()}_${kind}_${neg}`] = {
        name: `${K.name}-${G.suffix}`, grade: g, main: kind, neg, kind,
        coef: { [neg]: -G.step }, [K.field]: K.grades[g], gen: true
      };
    });
  });
});
/** 随机生成一个改装件 id。grades：可选的等级和权重，例 { C: 3, B: 1 }（默认各一半） */
function rollWeaponPart(grades, rnd) {
  rnd = rnd || Math.random;
  grades = grades || { C: 1, B: 1 };
  const keys = Object.keys(grades).filter(k => grades[k] > 0 && WEAPON_PART_GEN.grades[k]);
  const total = keys.reduce((s, k) => s + grades[k], 0);
  let r = rnd() * total, g = keys[keys.length - 1];
  for (const k of keys) { r -= grades[k]; if (r < 0) { g = k; break; } }
  // 这个等级有的种类：补正件（力量 / 敏捷 / 智力）+ 功能件（格挡 / 生命）
  const mains = (WEAPON_PART_GEN.coefGrades.includes(g) ? Object.keys(WEAPON_PART_GEN.mains) : [])
    .concat(Object.keys(WEAPON_PART_GEN.kinds).filter(k => WEAPON_PART_GEN.kinds[k].grades[g] != null));
  const main = mains[Math.floor(rnd() * mains.length)];
  const negs = WEAPON_PART_ATTRS.filter(a => a !== main);
  const neg = negs[Math.floor(rnd() * negs.length)];
  return `${g.toLowerCase()}_${main}_${neg}`;
}
const WEAPON_PART_ATTR_CN = { str: "力量", con: "体质", dex: "敏捷", wil: "意志", int: "智力", sta: "耐力" };
function weaponPartSpec(id) { return WEAPON_PARTS[id] || null; }
function weaponPartIds() { return Object.keys(WEAPON_PARTS); }
/* ===== 羁绊：玩家角色和自己的武器（武器人）之间，0–5 级，跑团模式由主持人改 =====
 * 羁绊等级直接加在武器等级上，只用来解锁武器升级奖励（改装槽、被动升级），
 * 不算武器升级：atk、武器人血量、耐久、补正都还是按武器本身的等级算。 */
const BOND_MAX = 5;
function weaponBond(owner, kit) {
  const v = Math.floor(Number(((owner && owner.bonds) || {})[kit]) || 0);
  return Math.max(0, Math.min(BOND_MAX, v));
}
/** 解锁奖励用的等级 = 武器等级 + 羁绊 */
function weaponRewardLevel(owner, kit) {
  const lv = Number(((owner && owner.weaponLevels) || {})[kit]) || 1;
  return lv + weaponBond(owner, kit);
}
/** 改羁绊等级（0–5）。降下来槽位变少时多出来的改装件退回背包，atk 照改装件重算 */
function setWeaponBond(owner, kit, v, notes) {
  if (!owner || !kit) return 0;
  owner.bonds = owner.bonds || {};
  owner.bonds[kit] = Math.max(0, Math.min(BOND_MAX, Math.floor(Number(v) || 0)));
  if (typeof ejectExtraWeaponParts === "function") ejectExtraWeaponParts(owner, kit, notes);
  refreshOwnerWeaponAtk(owner, kit);
  return owner.bonds[kit];
}
function weaponPartSlots(lv) {
  lv = Math.max(1, Number(lv) || 1);
  return WEAPON_PART_SLOT_LEVELS.filter(x => lv >= x).length;
}
function weaponPartItemId(id) { return "part_" + id; }
function weaponPartCoefText(coef) {
  return Object.keys(coef || {}).filter(a => Number(coef[a])).map(a => {
    const v = Math.round(Number(coef[a]) * 100) / 100;
    return `${WEAPON_PART_ATTR_CN[a] || a}补正 ${v > 0 ? "+" : "−"}${Math.abs(v)}`;
  }).join("，");
}
/** 改装件效果的一行字：「atk +1，力量补正 +0.1，敏捷补正 −0.1」 */
function weaponPartText(id) {
  const p = WEAPON_PARTS[id];
  if (!p) return "";
  const flat = weaponPartFlatAtk(id);
  return [flat ? `atk +${flat}` : "", p.block ? `格挡率 +${p.block}%` : "", p.hpPerLv ? `武器人每级装甲 +${p.hpPerLv}` : "",
    weaponPartCoefText(p.coef)].filter(Boolean).join("，");
}
/** 装着的格挡件一共加多少格挡率（%） */
function partsBlock(parts) { return (parts || []).reduce((s, id) => s + (Number((WEAPON_PARTS[id] || {}).block) || 0), 0); }
/** 装着的生命件一共让武器人每级多多少装甲 */
function partsHpPerLv(parts) { return (parts || []).reduce((s, id) => s + (Number((WEAPON_PARTS[id] || {}).hpPerLv) || 0), 0); }
/** 武器人的血量层（按武器等级 + 生命件）：{ 层类型: 上限 } */
function weaponUnitHp(kit, lv, parts) {
  const g = WEAPON_GROWTH[kit];
  if (!g) return null;
  lv = Math.max(1, Number(lv) || 1);
  const out = { [g.layer]: g.baseHp + g.hp * (lv - 1) };
  (g.extra || []).forEach(ex => { out[ex.layer] = ex.baseHp + ex.hp * (lv - 1); });
  const add = partsHpPerLv(parts) * lv;
  if (add) { const t = out.armor != null ? "armor" : g.layer; out[t] = (out[t] || 0) + add; }
  return out;
}
/** 把武器人场上的血量层上限调到「等级 + 生命件」该有的值（按比例保留当前血量） */
function refreshWeaponUnitHp(u, owner) {
  if (!u || !WEAPON_GROWTH[u.kit]) return;
  const hp = weaponUnitHp(u.kit, u.level, owner ? weaponPartsOf(owner, u.kit) : []);
  (u.layers || []).forEach(l => {
    if (hp[l.type] == null) return;
    const ratio = l.max ? l.current / l.max : 1;
    l.max = hp[l.type];
    l.current = Math.max(0, Math.min(l.max, Math.round(l.max * ratio)));
  });
}
function weaponPartLabel(id) {
  const p = WEAPON_PARTS[id];
  return p ? `【${p.name}】${p.grade ? p.grade + "级" : ""}` : id;
}
/** 武器槽位原样（含空槽），长度补齐到当前等级的槽数 */
function weaponPartRow(owner, kit) {
  const lv = weaponRewardLevel(owner, kit);   // 武器等级 + 羁绊
  const n = weaponPartSlots(lv);
  const raw = ((owner && owner.weaponParts) || {})[kit] || [];
  const row = [];
  for (let i = 0; i < n; i++) row.push(raw[i] && WEAPON_PARTS[raw[i]] ? raw[i] : null);
  return row;
}
/** 实际生效的改装件 id 列表（只算当前等级开放的槽） */
function weaponPartsOf(owner, kit) {
  return weaponPartRow(owner, kit).filter(Boolean);
}
/** 武器的补正系数表 { 属性: 系数 }：武器本身的主 / 副 / 负补正 + 改装件 */
function weaponCoefs(kit, parts) {
  const f = WEAPON_FORMULA[kit];
  const c = {};
  const add = (a, v) => { if (a) c[a] = Math.round(((c[a] || 0) + (Number(v) || 0)) * 1000) / 1000; };
  if (f) { add(f.mainAttr, f.mainCoef); add(f.subAttr, f.subCoef); add(f.negAttr, f.negCoef); }
  (parts || []).forEach(id => {
    const p = WEAPON_PARTS[id];
    if (p) Object.keys(p.coef || {}).forEach(a => add(a, p.coef[a]));
  });
  return c;
}

function computeWeaponAtk(kit, attrs, lv, parts) {
  const f = WEAPON_FORMULA[kit];
  const g = WEAPON_GROWTH[kit];
  lv = Math.max(1, Number(lv) || 1);
  if (f) {
    attrs = attrs || {};
    const coefs = weaponCoefs(kit, parts);
    const sum = Object.keys(coefs).reduce((s, a) => s + (Number(attrs[a]) || 0) * coefs[a], 0);
    const base = (Number(f.base) || 3) + (lv - 1) * 1;
    return Math.max(0, Math.round(base + sum * weaponTier(lv)) + partsFlatAtk(parts));
  }
  if (g) return (g.baseAtk || 0) + (g.atk || 0) * (lv - 1) + partsFlatAtk(parts);
  return 0;
}
/** 装着的改装件一共固定加多少 atk */
function partsFlatAtk(parts) { return (parts || []).reduce((s, id) => s + weaponPartFlatAtk(id), 0); }

/** 武器 atk 的明细（武器页用）：和 computeWeaponAtk 同一个算法，逐项列出来
 *  { formula, base, lvBase, tier, rows: [{ attr, name, value, coef, baseCoef, partCoef, part }], sum, raw, flat（改装件固定 atk）, atk } */
function weaponAtkBreakdown(kit, attrs, lv, parts) {
  const f = WEAPON_FORMULA[kit];
  lv = Math.max(1, Number(lv) || 1);
  attrs = attrs || {};
  if (!f) {
    const atk = computeWeaponAtk(kit, attrs, lv, parts);
    const flat = partsFlatAtk(parts);
    return { formula: false, base: atk - flat, lvBase: 0, tier: weaponTier(lv), rows: [], sum: 0, flat, raw: atk, atk };
  }
  const own = weaponCoefs(kit, []), all = weaponCoefs(kit, parts);
  const order = ["str", "con", "dex", "wil", "int", "sta"].filter(a => a in all);
  const tier = weaponTier(lv);
  const rows = order.map(a => {
    const coef = all[a], baseCoef = own[a] || 0;
    const value = Number(attrs[a]) || 0;
    return { attr: a, name: WEAPON_PART_ATTR_CN[a] || a, value, coef, baseCoef,
      partCoef: Math.round((coef - baseCoef) * 1000) / 1000, part: Math.round(value * coef * tier * 100) / 100 };
  });
  const sum = rows.reduce((s, r) => s + r.value * r.coef, 0);
  const base = Number(f.base) || 3, lvBase = lv - 1;
  const raw = base + lvBase + sum * tier;
  const flat = partsFlatAtk(parts);   // 改装件的固定 atk：取整之后再加，和 computeWeaponAtk 一样
  return { formula: true, base, lvBase, tier, rows, sum: Math.round(sum * 1000) / 1000, raw: Math.round(raw * 100) / 100,
    flat, atk: Math.max(0, Math.round(raw)) + flat };
}

/** 改装件变了 / 等级变了：重算这把武器给角色和武器人带来的攻击力 */
function refreshOwnerWeaponAtk(owner, kit) {
  if (!owner) return;
  const lv = Number((owner.weaponLevels || {})[kit]) || 1;
  const atk = computeWeaponAtk(kit, owner.attrs, lv, weaponPartsOf(owner, kit));
  const units = (typeof state !== "undefined" && state.units) || [];
  const wu = units.find(u => u.kit === kit && u.weaponOf === owner.kit);
  if (wu) { wu.personalAtk = atk; wu.atk = atk; refreshWeaponUnitHp(wu, owner); }   // 生命件：武器人的装甲跟着变
  if (owner.kit === "hiaki") { if (typeof refreshHiakiAtk === "function") refreshHiakiAtk(owner); return; }
  if ((owner.linkedKits || [])[0] !== kit) return;
  owner.weaponAtk = atk;
  if (owner.weaponHeld !== false && (typeof weaponIsOut !== "function" || !weaponIsOut(owner))) {
    owner.atk = (owner.personalAtk || 0) + atk;
  }
}
/** 等级降了槽位变少：多出来的改装件退回背包 */
function ejectExtraWeaponParts(owner, kit, notes) {
  const raw = ((owner && owner.weaponParts) || {})[kit];
  if (!raw) return;
  const n = weaponPartSlots(weaponRewardLevel(owner, kit));
  raw.slice(n).forEach(id => {
    if (id && WEAPON_PARTS[id] && typeof bagAdd === "function") {
      bagAdd(weaponPartItemId(id), 1);
      if (notes) notes.push(`${weaponPartLabel(id)} 槽位不够，退回背包。`);
    }
  });
  owner.weaponParts[kit] = raw.slice(0, n);
}
/** 装上改装件（从背包拿）。slot 不填就找第一个空槽；槽里原有的件退回背包。返回说明文字数组 */
function installWeaponPart(owner, kit, slot, partId, free) {
  if (!owner) return ["没有这个角色。"];
  const p = WEAPON_PARTS[partId];
  if (!p) return ["没有这种改装件。"];
  if (!(owner.linkedKits || []).includes(kit)) return ["这把武器不属于这个角色。"];
  const row = weaponPartRow(owner, kit);
  if (!row.length) return [`武器等级 + 羁绊要到 ${WEAPON_PART_SLOT_LEVELS[0]} 级才有改装槽。`];
  let i = slot == null || slot === "" ? row.indexOf(null) : Math.floor(Number(slot));
  if (i < 0) i = 0;
  if (!(i < row.length)) return [`这把武器只有 ${row.length} 个改装槽。`];
  const item = weaponPartItemId(partId);
  if (!free && typeof bagCount === "function" && bagCount(item) < 1) return [`背包里没有${weaponPartLabel(partId)}。`];
  const notes = [];
  if (!free && typeof bagAdd === "function") bagAdd(item, -1);
  if (row[i] && typeof bagAdd === "function") { bagAdd(weaponPartItemId(row[i]), 1); notes.push(`拆下 ${weaponPartLabel(row[i])} 放回背包。`); }
  row[i] = partId;
  owner.weaponParts = owner.weaponParts || {};
  owner.weaponParts[kit] = row;
  refreshOwnerWeaponAtk(owner, kit);
  notes.push(`${owner.name || owner.kit} 的武器第 ${i + 1} 槽装上 ${weaponPartLabel(partId)}（${weaponPartText(partId)}）。`);
  return notes;
}
/** 拆下改装件（放回背包） */
function removeWeaponPart(owner, kit, slot) {
  if (!owner) return ["没有这个角色。"];
  const row = weaponPartRow(owner, kit);
  const i = Math.floor(Number(slot));
  if (!(i >= 0 && i < row.length) || !row[i]) return ["这个槽是空的。"];
  const id = row[i];
  if (typeof bagAdd === "function") bagAdd(weaponPartItemId(id), 1);
  row[i] = null;
  owner.weaponParts = owner.weaponParts || {};
  owner.weaponParts[kit] = row;
  refreshOwnerWeaponAtk(owner, kit);
  return [`${owner.name || owner.kit} 的武器第 ${i + 1} 槽拆下 ${weaponPartLabel(id)}，放回背包。`];
}

function applyWeaponLevel(u) {
  if (!u) return;
  const g = WEAPON_GROWTH[u.kit];
  if (!g) return;
  const lv = Math.max(1, Number(u.level) || 1);
  let owner = null;
  if (typeof state !== "undefined" && u.weaponOf) {
    owner = (typeof findKit === "function") ? findKit(u.weaponOf, state.units) : null;
  }
  // 血量层：等级 + 生命件（找不到某层就改第一层，和以前一样）
  const hp = weaponUnitHp(u.kit, lv, owner ? weaponPartsOf(owner, u.kit) : []);
  (u.layers || []).forEach((l, i) => {
    const want = hp[l.type] != null ? hp[l.type] : (i === 0 && !(u.layers || []).some(x => x.type === g.layer) ? hp[g.layer] : null);
    if (want == null) return;
    const ratio = l.max ? l.current / l.max : 1;
    l.max = want;
    l.current = Math.max(0, Math.min(want, Math.round(want * ratio)));
  });
  const watk = computeWeaponAtk(u.kit, owner && owner.attrs, lv, owner ? weaponPartsOf(owner, u.kit) : []);
  u.personalAtk = watk;
  u.atk = watk;
  if (owner && owner.kit === "hiaki" && typeof refreshHiakiAtk === "function") {
    refreshHiakiAtk(owner);
  } else if (owner && owner.weaponHeld !== false && (typeof weaponIsOut !== "function" || !weaponIsOut(owner))) {
    const primary = (owner.linkedKits || [])[0];
    if (!primary || primary === u.kit) {
      owner.weaponAtk = watk;
      owner.atk = (owner.personalAtk || 0) + watk;
    }
  }
  const def = g.baseDef + Math.floor(lv / 5);
  const defRatio = u.defMax ? u.def / u.defMax : 1;
  u.defMax = def;
  u.def = Math.max(0, Math.min(def, Math.round(def * defRatio)));
  u.resources = u.resources || {};
  u.resources.durability = weaponBaseDur(u.kit, lv);
}

/* ---------- 义体改造 ----------
 * 把一部分肉体血量换成别的血量层：
 *   肉体 8 : 装甲 7 : 护盾 6 : 沙尘 6（例：8 点肉体换 7 点装甲）
 *   可换的肉体上限 = 义体改造率 × 肉体血量上限
 *   也可以把（剩下的）肉体按 肉体 8 : 星灵 7 完全换成星灵，不受改造率限制
 *   一个角色最多 3 种血量；内层必须是肉体或星灵其中一种
 *   排列：肉体 / 星灵在最内层，外面依次是装甲、护盾、沙尘
 * 改造方案记在 u.cyberPlan = { armor, shield, sand, spirit }（前三个是用掉的肉体点数），
 * 每次按等级重算血量时（applyLevelStats）照方案重建血量层，所以升级后改造依然有效。 */
const CYBER_RATIO = { flesh: 8, armor: 7, shield: 6, sand: 6, spirit: 7 };
const CYBER_OUTER = ["sand", "shield", "armor"];     // 数组从外到内
const CYBER_MAX_TYPES = 3;

/** 义体改造率（0–0.99）：50% + (智力 − 5) × 10% */
function cyberRateOf(attrs, level) {
  return derivedFromAttrs(attrs || {}, level || 1).cyber / 100;
}
function cyberConvertLimit(fleshMax, rate) {
  return Math.floor((Number(fleshMax) || 0) * (Number(rate) || 0));
}
/** 方案不合法返回原因，合法返回 null */
function cyberPlanError(plan, fleshMax, rate) {
  plan = plan || {};
  const amounts = CYBER_OUTER.map(t => Number(plan[t]) || 0);
  if (amounts.some(n => n < 0 || Math.floor(n) !== n)) return "改造量必须是非负整数";
  const used = amounts.reduce((s, n) => s + n, 0);
  const limit = cyberConvertLimit(fleshMax, rate);
  if (used > limit) return `最多只能改造 ${limit} 点肉体（改造率 ${Math.round(rate * 100)}%）`;
  if (fleshMax - used < 1) return "内层必须留下肉体或星灵";
  const types = 1 + amounts.filter(n => n > 0).length;
  if (types > CYBER_MAX_TYPES) return `一个角色最多 ${CYBER_MAX_TYPES} 种血量`;
  return null;
}
/** 按方案算出的血量层（从外到内），fleshMax 是没改造时的肉体上限 */
function cyberLayersFor(fleshMax, plan) {
  plan = plan || {};
  const out = [];
  let left = Number(fleshMax) || 0;
  CYBER_OUTER.forEach(t => {
    const n = Math.min(left - 1, Math.max(0, Number(plan[t]) || 0));
    if (n <= 0) return;
    left -= n;
    out.push({ type: t, max: Math.max(1, Math.floor(n * CYBER_RATIO[t] / CYBER_RATIO.flesh)) });
  });
  out.push(plan.spirit
    ? { type: "spirit", max: Math.max(1, Math.floor(left * CYBER_RATIO.spirit / CYBER_RATIO.flesh)) }
    : { type: "flesh", max: left });
  return out;
}
/** 照 u.cyberPlan 重建血量层。同类型的层保留当前值（超过新上限的截掉），新出现的层是满的 */
function applyCyberLayers(u, fleshMax) {
  if (!u || !u.cyberPlan) return;
  const old = u.layers || [];
  const target = cyberLayersFor(fleshMax, u.cyberPlan);
  u.layers = target.map((t, i) => {
    const prev = old.find(l => l.type === t.type);
    const cur = prev ? Math.max(0, Math.min(Number(prev.current) || 0, t.max)) : t.max;
    return { type: t.type, current: cur, max: t.max, inner: i === target.length - 1 };
  });
}

function applyLevelStats(u) {
  if (!u || !u.isPlayer || isWeaponUnit(u)) return;
  // 固定成长（每级固定加血）只给没有六项属性的老卡用；有属性的角色一律按属性公式算，
  // 加体质 / 意志 / 耐力点才会生效，10 / 20 级也会加架势（夕夏、川川、诺拉以前带着 growth 走了这条路）
  if (u.growth && !u.attrs) {
    const up = Math.max(0, (u.level || 1) - 1);
    const hp = (u.baseHp || 14) + (u.growth.hp || 0) * up;
    const flesh = (u.layers || []).find(l => l.type === "flesh");
    if (flesh && !u.cyberPlan) {
      const ratio = flesh.max ? flesh.current / flesh.max : 1;
      flesh.max = hp;
      flesh.current = Math.max(0, Math.min(hp, Math.round(hp * ratio)));
    }
    applyCyberLayers(u, hp);
    u.cyber = u.attrs ? derivedFromAttrs(u.attrs, u.level).cyber : 50;
    if (u.attrs) {
      u.personalAtk = derivedFromAttrs(u.attrs, u.level).personalAtk;
    } else if (Number(u.growth.atk) > 0) {
      u.personalAtk = (u.baseAtk || u.personalAtk || 5) + u.growth.atk * up;
    }
    const primary = (u.linkedKits || [])[0];
    if (primary && typeof computeWeaponAtk === "function") {
      u.weaponAtk = computeWeaponAtk(primary, u.attrs, (u.weaponLevels && u.weaponLevels[primary]) || 1, weaponPartsOf(u, primary));
    }
    u.atk = (u.personalAtk || 0) + (u.weaponHeld === false ? 0 : (u.weaponAtk || 0));
    if (u.growth.shp) {
      const shp = (u.baseShp || u.shpMax || 10) + u.growth.shp * up + (Number(u.shpBonus) || 0);
      const shpRatio = u.shpMax ? u.shp / u.shpMax : 1;
      u.shpMax = shp;
      u.shp = Math.max(0, Math.min(shp, Math.round(shp * shpRatio)));
    }
    if (u.kit === "hiaki" && typeof refreshHiakiAtk === "function") refreshHiakiAtk(u);
    return;
  }
  if (!u.attrs) return;
  const d = derivedFromAttrs(u.attrs, u.level);
  const flesh = (u.layers || []).find(l => l.type === "flesh");
  if (flesh && !u.cyberPlan) {
    const ratio = flesh.max ? flesh.current / flesh.max : 1;
    flesh.max = d.hp;
    flesh.current = Math.max(0, Math.min(d.hp, Math.round(d.hp * ratio)));
  }
  applyCyberLayers(u, d.hp);
  u.personalAtk = d.personalAtk;
  const primary = (u.linkedKits || [])[0];
  if (primary && typeof computeWeaponAtk === "function") {
    u.weaponAtk = computeWeaponAtk(primary, u.attrs, (u.weaponLevels && u.weaponLevels[primary]) || 1, weaponPartsOf(u, primary));
  }
  u.atk = (u.personalAtk || 0) + (u.weaponHeld === false ? 0 : (u.weaponAtk || 0));
  const defRatio = u.defMax ? u.def / u.defMax : 1;
  u.defMax = d.def;
  u.def = Math.max(0, Math.min(d.def, Math.round(d.def * defRatio)));
  const shpRatio = u.shpMax ? u.shp / u.shpMax : 1;
  const shpMax = d.shp + (Number(u.shpBonus) || 0);   // 额外坚毅生命上限（单人模式主角 +15）
  u.shpMax = shpMax;
  u.shp = Math.max(0, Math.min(shpMax, Math.round(shpMax * shpRatio)));
  u.cyber = d.cyber;
  if (u.kit === "hiaki" && typeof refreshHiakiAtk === "function") refreshHiakiAtk(u);
}

function unspentForLevel(lv) {
  let n = 0;
  if (lv >= 4) n += 1;
  if (lv >= 8) n += 1;
  return n;
}

function grantXpToPlayers(amount, reason) {
  amount = Math.floor(Number(amount) || 0);
  if (amount <= 0) return;
  const heroes = fieldUnits().filter(u => u.isPlayer && !isWeaponUnit(u) && !u.dead);
  // 跑团模式照手册第三章：战斗经验「全队平分」（Roguelike 单局按自己的调校，每人拿全额）
  const split = typeof TRPG !== "undefined" && TRPG.active && heroes.length > 1;
  const each = split ? Math.ceil(amount / heroes.length) : amount;
  if (split) appendLog(`${amount} 经验${reason ? "（" + reason + "）" : ""}由 ${heroes.length} 人平分，每人 ${each}。`);
  heroes.forEach(u => {
    u.xp = (u.xp || 0) + each;
    const need = xpToNext(u.level);
    appendLog(`${u.name} 获得 ${each} 经验${reason && !split ? "（" + reason + "）" : ""}。当前 ${u.xp}/${need || "满级"}`);
  });
  if (state.battleGains) state.battleGains.xp += each;
}

function tryLevelUp(u) {
  if (!u || isWeaponUnit(u)) return false;
  let changed = false;
  // 升级提示（levelup.js）：升级前的能力，升完了比一比
  const before = typeof LevelUp !== "undefined" && xpToNext(u.level) > 0 && (u.xp || 0) >= xpToNext(u.level) ? LevelUp.snapshot(u) : null;
  while (xpToNext(u.level) > 0 && (u.xp || 0) >= xpToNext(u.level)) {
    u.xp -= xpToNext(u.level);
    u.level += 1;
    if (u.level === 4 || u.level === 8) u.attrPoints = (u.attrPoints || 0) + 1;
    applyLevelStats(u);
    appendLog(`${u.name} 升到 ${u.level} 级。`);
    changed = true;
  }
  if (changed && before) LevelUp.note("level", u, before);
  return changed;
}

/* ---------- 职责技能（手册第三章「升级时你会得到什么」、第六步「团队职责」） ----------
 * 等级表里的「或」不是每次随便挑，而是看是不是专精（主副职责同一项）：
 *   非专精：lv1 主一 → lv5 副一 → lv10 主二 → lv15 主三
 *   专精  ：lv1 主一 → lv5 主二 → lv10 主三 → lv15 主四   ← 技能四只有专精能拿到
 * 专精与否看角色卡（主副职责同项）。目前没有选择，按角色卡自动给。
 * （「5 级让玩家选走不走专精」的想法先砍掉了，记在 IDEAS.md，以后可能用上：
 *   把 ROLE_PATH_CHOICE 打开，5 级就会在副职责一 / 主职责二之间选，10、15 级按路线走。）
 * 学到的记在 u.rolePicks[5 / 10 / 15] = { role, n }。 */
const ROLE_PATH_CHOICE = false;
const ROLE_MILESTONES = [5, 10, 15];

/** 是否走专精路线：角色卡主副同项，或 5 级选了主职责二技能 */
function rolePathSpec(u) {
  if (!u || !u.roles) return false;
  const p = u.roles.primary, sec = u.roles.secondary || p;
  if (p === sec) return true;
  if (!ROLE_PATH_CHOICE) return false;
  const pick5 = (u.rolePicks || {})[5];
  return !!(pick5 && pick5.role === p && pick5.n === 2);
}

/** 某个里程碑能拿的职责技能。只有 5 级、而且角色卡不是专精时才有两个选项 */
function roleChoicesAt(u, milestone) {
  if (!u || !u.roles) return [];
  const p = u.roles.primary, sec = u.roles.secondary || p;
  if (milestone === 5) {
    if (p === sec) return [{ role: p, n: 2 }];
    return ROLE_PATH_CHOICE ? [{ role: sec, n: 1 }, { role: p, n: 2 }] : [{ role: sec, n: 1 }];
  }
  const spec = rolePathSpec(u);
  if (milestone === 10) return [{ role: p, n: spec ? 3 : 2 }];
  if (milestone === 15) return [{ role: p, n: spec ? 4 : 3 }];
  return [];
}

/** 全部职责（手册第六步） */
const ROLE_LIST = ["直伤", "异常", "击破", "坦克", "护卫", "生存", "环境手", "控场", "辅助"];

/** 单人模式的第二副职责：开局自选，升级时额外学到的技能记在 u.role2Picks（技能序号） */
function role2SkillsOf(u) {
  if (!u || !u.role2) return [];
  return (u.role2Picks || []).map(n => ({ role: u.role2, n: Number(n), role2: true }));
}

function roleSkillsUnlocked(u) {
  return roleSkillsBase(u).concat(role2SkillsOf(u));
}

function roleSkillsBase(u) {
  const out = [];
  if (!u || !u.roles) return out;
  if (u.rolePicks) {
    const lv = u.level || 1;
    out.push({ role: u.roles.primary, n: 1 });
    ROLE_MILESTONES.forEach(m => {
      if (lv < m) return;
      // 只认合规的选择（旧存档里可能记着按旧规则选的「主四」之类），否则按路线给
      const opts = roleChoicesAt(u, m);
      const saved = u.rolePicks[m];
      const pick = saved && opts.some(o => o.role === saved.role && o.n === saved.n) ? saved : opts[0];
      if (pick) out.push({ role: pick.role, n: pick.n });
    });
    return out;
  }
  const spec = u.roles.primary && u.roles.primary === u.roles.secondary;
  const lv = u.level || 1;
  const add = (role, n) => out.push({ role, n });
  if (spec) {
    add(u.roles.primary, 1);
    if (lv >= 5) add(u.roles.primary, 2);
    if (lv >= 10) add(u.roles.primary, 3);
    if (lv >= 15) add(u.roles.primary, 4);
  } else {
    add(u.roles.primary, 1);
    if (lv >= 5) add(u.roles.secondary, 1);
    if (lv >= 10) add(u.roles.primary, 2);
    if (lv >= 15) add(u.roles.primary, 3);
  }
  return out;
}


/* ===== 被动升级（被动名后面带 +）=====
 * 角色武器升到 5 级：被动 1 升级；升到 10 级：被动 2 升级。绯秋有两把刀，按等级较高的那把算。
 * 放弃被动（单局图纸）时不算升级。 */
const PASSIVE_PLUS_LEVEL = { 1: 5, 2: 10 };
function heroOfUnit(u) {
  if (!u) return null;
  if (u.weaponOf && typeof findKit === "function" && typeof state !== "undefined") return findKit(u.weaponOf, state.units) || null;
  return u;
}
function heroWeaponLevel(hero) {
  if (!hero) return 0;
  const kits = (hero.linkedKits && hero.linkedKits.length) ? hero.linkedKits : (typeof defaultLinkedKits === "function" ? defaultLinkedKits(hero.kit) : []);
  // 被动升级看「武器等级 + 羁绊」（羁绊不提高数值，但能更早解锁奖励）
  return kits.reduce((m, k) => Math.max(m, weaponRewardLevel(hero, k)), 0);
}
/** 这个角色（或它的武器人）的第 n 个被动是否已经升级 */
function passivePlus(u, n) {
  const hero = heroOfUnit(u);
  if (!hero || !hero.isPlayer) return false;
  if (typeof passiveOn === "function" && !passiveOn(hero)) return false;
  return heroWeaponLevel(hero) >= (PASSIVE_PLUS_LEVEL[n] || 99);
}
function passivePlusKit(kit, n) {
  return typeof findKit === "function" && typeof state !== "undefined" ? passivePlus(findKit(kit, state.units), n) : false;
}
