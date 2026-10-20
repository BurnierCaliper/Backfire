/* 背包、掉落、道具使用。计算器和游戏共用。 */

const ITEM_CATALOG = {
  // heal：治疗骰（n 个 s 面骰 + flat），用道具 / 休整用道具 / 专长「拉一把」都读这一处（itemHealSpec）
  medkit:     { name: "简易医疗包", hint: "治疗一名友方 1d4+6 内层生命", target: "ally", combat: true, heal: { n: 1, s: 4, flat: 6 } },
  clinic:     { name: "诊所医疗包", hint: "治疗一名友方 2d4+6 内层生命", target: "ally", combat: true, heal: { n: 2, s: 4, flat: 6 } },
  stim:       { name: "强心注射剂", hint: "自身恢复 16 生命，消耗一些坚毅生命（不会致死）", target: "self", combat: true },
  steroid:    { name: "强化注射剂", hint: "自身 ATK +3 至战斗结束，消耗一些坚毅生命（不会致死）", target: "self", combat: true },
  bomb_e:     { name: "简易电手榴弹", hint: "对一个区域全部单位造成 1d6+6 电击", target: "zone", combat: true },
  bomb_a:     { name: "简易酸液瓶", hint: "对一个区域全部单位造成 1d6+6 酸液", target: "zone", combat: true },
  shockbomb:  { name: "冲击炸弹", hint: "对一个区域全部单位造成 2 击破", target: "zone", combat: true }
};

/** 医疗道具的治疗骰；没有 heal 的（如只能自己用的强心注射剂）不算医疗道具，返回 null */
function itemHealSpec(itemId) {
  const h = ITEM_CATALOG[itemId] && ITEM_CATALOG[itemId].heal;
  return h && Number(h.n) > 0 && Number(h.s) > 0 ? { n: Number(h.n), s: Number(h.s), flat: Number(h.flat) || 0 } : null;
}
/** 掷一件医疗道具的治疗骰 → { total, text }；不是医疗道具返回 null */
function rollItemHeal(itemId) {
  const h = itemHealSpec(itemId);
  return h ? takeDice(h.n, h.s, h.flat) : null;
}

/* ===== 效果道具（作者 10/15 定稿，docs/workshop-design.md）=====
 * 游戏里现有的每一种效果对应一个道具，共 36 个。全部花附赠动作（game.js / battle-commands.js 的 __item）。
 *   kind  status 属性状态（投掷罐：一个区域内全部单位，不分敌我）
 *         instant 即时效果（弹针：一个敌人）
 *         common 通用状态（增益给自己 / 友方，减益给敌人；烟雾弹给一个区域的友方）
 *         stun 晕眩（一个敌人；首领无效，要攒 2 个晕眩标记的精英只推进 1 个）
 *         field 场地（一个区域）
 *         self 自我效果（只能对自己用；商店不卖，积分兑换或制作）
 *   target zone / enemy / ally / self；range 距离几区以内（自我效果没有）
 *   price 商店价（奎支）；points 积分（自我效果）；prof / diff 制作要的熟练项和难度（第 4 步用） */
const EFFECT_ITEMS = [
  // ① 属性状态 → 投掷罐
  { id: "fx_burn",      name: "燃烧瓶",     kind: "status",  key: "burn",       target: "zone",  price: 1200, prof: "科技理论", diff: "easy" },
  { id: "fx_corr",      name: "腐蚀喷雾",   kind: "status",  key: "corr",       target: "zone",  price: 1200, prof: "科技理论", diff: "easy" },
  { id: "fx_shock",     name: "电解液罐",   kind: "status",  key: "shock",      target: "zone",  price: 1200, prof: "电器维修", diff: "easy" },
  { id: "fx_high",      name: "辐能粉尘",   kind: "status",  key: "high",       target: "zone",  price: 1800, prof: "电器维修", diff: "easy" },
  { id: "fx_quake",     name: "震荡雷",     kind: "status",  key: "shockwave",  target: "zone",  price: 1500, prof: "机械维修", diff: "easy" },
  { id: "fx_frost",     name: "液氮罐",     kind: "status",  key: "frostbite",  target: "zone",  price: 1200, prof: "医疗",     diff: "easy" },
  { id: "fx_reso",      name: "共鸣音叉",   kind: "status",  key: "reso",       target: "zone",  price: 1800, prof: "数据操作", diff: "easy" },
  // ② 即时效果 → 弹针
  { id: "fx_melt",      name: "铝热弹",     kind: "instant", key: "melt",       target: "enemy", price: 1500, prof: "科技理论", diff: "normal" },
  { id: "fx_neutral",   name: "中和凝胶",   kind: "instant", key: "neutralize", target: "enemy", price: 2000, prof: "科技理论", diff: "normal" },
  { id: "fx_overload",  name: "超频针",     kind: "instant", key: "overload",   target: "enemy", price: 1500, prof: "电器维修", diff: "normal" },
  { id: "fx_spread",    name: "散能弹",     kind: "instant", key: "spread",     target: "enemy", price: 2000, prof: "电器维修", diff: "normal" },
  { id: "fx_shift",     name: "相位钉",     kind: "instant", key: "shift",      target: "enemy", price: 1800, prof: "机械维修", diff: "normal" },
  { id: "fx_sting",     name: "冰锥弹",     kind: "instant", key: "sting",      target: "enemy", price: 1500, prof: "巧手",     diff: "normal" },
  { id: "fx_refract",   name: "棱镜弹",     kind: "instant", key: "refract",    target: "enemy", price: 1800, prof: "数据操作", diff: "normal" },
  // ③ 通用状态 → 增益 / 减益
  { id: "fx_trip",      name: "绊索",       kind: "common",  key: "unstable",   target: "enemy", price: 1800, prof: "机械维修", diff: "easy" },
  { id: "fx_beacon",    name: "追踪信标",   kind: "common",  key: "chase",      target: "enemy", price: 1500, prof: "机械维修", diff: "normal" },
  { id: "fx_calm",      name: "镇定剂",     kind: "common",  key: "sturdy",     target: "ally",  price: 1500, prof: "医疗",     diff: "easy" },
  { id: "fx_rouse",     name: "兴奋剂",     kind: "common",  key: "inspire",    target: "ally",  price: 1800, prof: "医疗",     diff: "normal" },
  { id: "fx_weak",      name: "麻痹毒针",   kind: "common",  key: "weak",       target: "enemy", price: 1800, prof: "医疗",     diff: "normal" },
  { id: "fx_smoke",     name: "烟雾弹",     kind: "common",  key: "hide",       target: "zone",  price: 1500, prof: "巧手",     diff: "easy", alliesOnly: true },
  { id: "fx_scope",     name: "瞄准镜贴片", kind: "common",  key: "advantage",  target: "ally",  price: 1500, prof: "巧手",     diff: "easy" },
  { id: "fx_flash",     name: "闪光震撼弹", kind: "stun",    key: "stun",       target: "enemy", price: 4000, prof: "巧手",     diff: "hard" },
  // ④ 场地
  { id: "fx_f_fire",    name: "凝固汽油罐", kind: "field",   key: "fire",       target: "zone",  price: 2000, prof: "科技理论", diff: "hard" },
  { id: "fx_f_electric",name: "高压桩",     kind: "field",   key: "electric",   target: "zone",  price: 2000, prof: "电器维修", diff: "hard" },
  { id: "fx_f_acid",    name: "酸液桶",     kind: "field",   key: "acid",       target: "zone",  price: 2000, prof: "机械维修", diff: "hard" },
  { id: "fx_f_heal",    name: "医疗雾化器", kind: "field",   key: "heal",       target: "zone",  price: 2500, prof: "医疗",     diff: "hard" },
  { id: "fx_f_ice",     name: "冷凝弹",     kind: "field",   key: "ice",        target: "zone",  price: 2000, prof: "巧手",     diff: "hard" },
  { id: "fx_f_harmonic",name: "谐波发生器", kind: "field",   key: "harmonic",   target: "zone",  price: 2500, prof: "数据操作", diff: "hard" },
  { id: "fx_f_energy",  name: "能量核心",   kind: "field",   key: "energy",     target: "zone",  price: 3000, prof: "数据操作", diff: "hard" },
  // ⑤ 自我效果
  { id: "fx_s_burn",     name: "点火核心",   kind: "self",   key: "burn",      target: "self",  points: 3, prof: "科技理论", diff: "extreme" },
  { id: "fx_s_conductor",name: "超导线圈",   kind: "self",   key: "conductor", target: "self",  points: 4, prof: "电器维修", diff: "extreme" },
  { id: "fx_s_anchor",   name: "配重块",     kind: "self",   key: "anchor",    target: "self",  points: 4, prof: "机械维修", diff: "extreme" },
  { id: "fx_s_frost",    name: "冰封外壳",   kind: "self",   key: "frost",     target: "self",  points: 3, prof: "医疗",     diff: "extreme" },
  { id: "fx_s_splash",   name: "酸液涂层",   kind: "self",   key: "splash",    target: "self",  points: 3, prof: "巧手",     diff: "extreme" },
  { id: "fx_s_store",    name: "蓄能电池",   kind: "self",   key: "store",     target: "self",  points: 4, prof: "数据操作", diff: "extreme" },
  { id: "fx_s_doppler",  name: "共振频发器", kind: "self",   key: "doppler",   target: "self",  points: 4, prof: "数据操作", diff: "extreme" }
];
/** 道具的射程（区）：自我效果之外都是距离 1 以内 */
const EFFECT_ITEM_RANGE = 1;
const EFFECT_STATUS_CN = { burn: "灼烧", corr: "腐蚀", shock: "感电", high: "高能", shockwave: "震荡", frostbite: "冻伤", reso: "共振",
  unstable: "不稳", chase: "紧追", sturdy: "坚挺", inspire: "振奋", weak: "虚弱", hide: "躲藏", advantage: "优势" };
const EFFECT_INSTANT_CN = { melt: "熔融", neutralize: "中和", overload: "过载", spread: "扩散", shift: "错位", sting: "刺骨", refract: "折射" };
const EFFECT_FIELD_CN = { fire: "火场", electric: "高压场地", acid: "酸液地面", heal: "治愈场地", ice: "冻土", harmonic: "干涉场", energy: "能量场" };
const EFFECT_SELF_CN = { burn: "自焚", conductor: "导体", anchor: "千钧", frost: "霜结", splash: "溅射", store: "蓄能", doppler: "多普勒" };
/** 状态对应的属性（扩散按「最新施加」的属性结算） */
const EFFECT_STATUS_ELEMENT = { burn: "fire", corr: "acid", shock: "electric", high: "energy", shockwave: "physical", frostbite: "ice", reso: "harmonic" };
function effectItemHint(it) {
  const r = `距离 ${EFFECT_ITEM_RANGE} 以内`;
  if (it.kind === "status") return `对${r}的一个区域内全部单位（不分敌我）施加${EFFECT_STATUS_CN[it.key]}`;
  if (it.kind === "instant") return `对${r}的一个敌人施加${EFFECT_INSTANT_CN[it.key]}`;
  if (it.kind === "stun") return `让${r}的一个敌人晕眩。首领无效；要攒 2 个晕眩标记的精英只推进 1 个标记`;
  if (it.kind === "common") return it.alliesOnly ? `${r}的一个区域内全部友方获得${EFFECT_STATUS_CN[it.key]}`
    : it.target === "ally" ? `自己或${r}的一名友方获得${EFFECT_STATUS_CN[it.key]}` : `对${r}的一个敌人施加${EFFECT_STATUS_CN[it.key]}`;
  if (it.kind === "field") return `把${r}的一个区域变成${EFFECT_FIELD_CN[it.key]}（固有场地、深渊、损毁地面改不了）`;
  if (it.kind === "self") return `自己获得自我效果「${EFFECT_SELF_CN[it.key]}」`;
  return "";
}
EFFECT_ITEMS.forEach(it => {
  ITEM_CATALOG[it.id] = { name: it.name, hint: effectItemHint(it) + "。附赠动作。", target: it.target, combat: true, effect: it };
});

/* ===== 制作材料（作者 10/15 定稿，docs/workshop-design.md 第 4 节）=====
 * 结构材料（金属 → 赫心结晶）照旧只用于武器升级；道具制作另用这 7 种。队伍公用（supply：联机时不按需求分配，直接进公用背包）。
 *   cls：chem 化学 / elec 电子 / bio 生物；tier：1 常见、2 精制；price 参考价（黑市按 CRAFT_BLACK_MARKET 倍出售） */
const CRAFT_MATERIALS = [
  { id: "cm_scrap",  name: "废料",       price: 100, cls: "shell", tier: 0, hint: "道具的壳体。机械敌人掉落；拆解道具也能拿回" },
  { id: "cm_chem",   name: "化工残液",   price: 200, cls: "chem",  tier: 1, hint: "化学 · 常见。酸 / 火系敌人掉落" },
  { id: "cm_gas",    name: "燃气浓缩物", price: 600, cls: "chem",  tier: 2, hint: "化学 · 精制。精英、首领，第二采矿场的燃气机械掉落" },
  { id: "cm_coil",   name: "废线圈",     price: 200, cls: "elec",  tier: 1, hint: "电子 · 常见。电 / 能量系机械掉落" },
  { id: "cm_cell",   name: "电芯",       price: 600, cls: "elec",  tier: 2, hint: "电子 · 精制。精英、首领，第三采矿场、巨人城机械掉落" },
  { id: "cm_scale",  name: "沙鱼鳞",     price: 200, cls: "bio",   tier: 1, hint: "生物 · 常见。带沙尘层的沙漠生物掉落" },
  { id: "cm_spirit", name: "星灵组织",   price: 600, cls: "bio",   tier: 2, hint: "生物 · 精制。带星灵层的敌人（触灵、陨体衍蛛、弦蚣……）掉落" }
];
const CRAFT_BLACK_MARKET = 3;   // 道具材料普通商店不卖，黑市按参考价的几倍卖
/* 打倒一个敌人掉多少材料：按档次。common / refined 是每个材料类别各掷一次的概率（≥1 表示保底这么多份）；scrap 是废料 [最少, 最多]（有装甲 / 护盾的机械才掉） */
const CRAFT_DROPS = {
  minion: { common: 0.4, refined: 0.03, scrap: [0, 1] },
  elite:  { common: 1,   refined: 0.4,  scrap: [1, 2] },
  boss:   { common: 2,   refined: 1,    scrap: [2, 3] }
};
CRAFT_MATERIALS.forEach(m => { ITEM_CATALOG[m.id] = { name: m.name, hint: m.hint, combat: false, supply: true, material: "craft" }; });
/** 这个敌人属于哪些材料类别：酸 / 火 → 化学；电 / 能量 → 电子；沙尘层 → 生物（沙鱼鳞）；星灵层 → 生物（星灵组织）；装甲 / 护盾 → 机械（废料） */
function craftClassesOf(u) {
  const el = String((u.suggest && u.suggest.element) || u.element || "physical");
  const types = (u.layers || []).map(l => l.type);
  return {
    chem: el === "acid" || el === "fire",
    elec: el === "electric" || el === "energy",
    sand: types.includes("sand"),
    spirit: types.includes("spirit"),
    mech: types.includes("armor") || types.includes("shield")
  };
}
/** 掷一个敌人的材料掉落 → [{ id, qty }]（用调用方装好的随机数） */
function rollCraftMaterials(u) {
  if (!u || u.isPlayer) return [];
  const rank = typeof enemyRankOf === "function" ? enemyRankOf(u) : "minion";
  const D = CRAFT_DROPS[rank] || CRAFT_DROPS.minion;
  const c = craftClassesOf(u), out = {};
  const add = (id, n) => { if (n > 0) out[id] = (out[id] || 0) + n; };
  const roll = (p) => p >= 1 ? Math.floor(p) : (Math.random() < p ? 1 : 0);
  if (c.mech) add("cm_scrap", D.scrap[0] + Math.floor(Math.random() * (D.scrap[1] - D.scrap[0] + 1)));
  if (c.chem) { add("cm_chem", roll(D.common)); add("cm_gas", roll(D.refined)); }
  if (c.elec) { add("cm_coil", roll(D.common)); add("cm_cell", roll(D.refined)); }
  if (c.sand) add("cm_scale", roll(D.common));
  if (c.spirit) add("cm_spirit", roll(Math.max(D.refined, D.common * 0.5)));
  return Object.keys(out).map(id => ({ id, qty: out[id] }));
}

/* ===== 制作配方（docs/workshop-design.md 第 3、5 节）=====
 * 键是道具 id，值是 { 材料 id: 份数 }。mat_metal 是结构材料「金属」（单局里没有实物时按参考价付奎支）。
 * 难度、熟练项读 EFFECT_ITEMS 上的 prof / diff */
const CRAFT_RECIPES = (() => {
  const S = "cm_scrap", CH = "cm_chem", GA = "cm_gas", CO = "cm_coil", CE = "cm_cell", SC = "cm_scale", SP = "cm_spirit", ME = "mat_metal";
  return {
  fx_burn: { [S]: 1, [GA]: 1, [CH]: 1 },   fx_corr: { [S]: 1, [CH]: 2 },          fx_shock: { [S]: 1, [CO]: 2 },
  fx_high: { [S]: 1, [CE]: 1, [CO]: 1 },   fx_quake: { [S]: 2, [CO]: 1 },         fx_frost: { [S]: 1, [CH]: 1, [CE]: 1 },
  fx_reso: { [S]: 1, [CE]: 2 },
  fx_melt: { [S]: 2, [GA]: 1, [CH]: 1 },   fx_neutral: { [S]: 1, [CH]: 2, [SC]: 1 }, fx_overload: { [S]: 2, [CE]: 1, [CO]: 1 },
  fx_spread: { [S]: 2, [CE]: 1, [GA]: 1 }, fx_shift: { [S]: 3, [CE]: 1 },         fx_sting: { [S]: 2, [CE]: 1, [CH]: 1 },
  fx_refract: { [S]: 2, [CE]: 2 },
  fx_trip: { [S]: 2, [CO]: 1 },            fx_beacon: { [S]: 1, [CO]: 2 },        fx_calm: { [SC]: 1, [CH]: 1, [S]: 1 },
  fx_rouse: { [SP]: 1, [CE]: 1, [S]: 1 },  fx_weak: { [SP]: 1, [CH]: 1, [S]: 1 }, fx_smoke: { [S]: 1, [CH]: 2 },
  fx_scope: { [S]: 1, [CO]: 1, [CE]: 1 },  fx_flash: { [S]: 1, [GA]: 1, [CE]: 1 },
  fx_f_fire: { [S]: 3, [GA]: 2 },          fx_f_electric: { [S]: 3, [CE]: 1, [CO]: 2 }, fx_f_acid: { [S]: 3, [GA]: 1, [CH]: 2 },
  fx_f_heal: { [S]: 3, [SP]: 2 },          fx_f_ice: { [S]: 3, [CE]: 1, [CH]: 2 }, fx_f_harmonic: { [S]: 3, [CE]: 3 },
  fx_f_energy: { [S]: 3, [CE]: 2, [CO]: 1 },
  fx_s_burn: { [ME]: 1, [SP]: 1, [GA]: 2 },        fx_s_conductor: { [ME]: 1, [SP]: 1, [CE]: 1, [CO]: 2 },
  fx_s_anchor: { [ME]: 2, [SP]: 1, [CE]: 1 },      fx_s_frost: { [ME]: 1, [SP]: 1, [CE]: 1, [CH]: 2 },
  fx_s_splash: { [ME]: 1, [SP]: 1, [GA]: 1, [CH]: 2 }, fx_s_store: { [ME]: 1, [SP]: 1, [CE]: 2 },
  fx_s_doppler: { [ME]: 1, [SP]: 1, [CE]: 2, [CO]: 1 }
  };
})();
/* 制作规则：
 *   hours     每档难度花几小时（计入距上次长休）
 *   failLoss  失败时损失非壳体材料的比例（向上取整）；shells 是壳体，失败不损失
 *   benchKinds 要工作台（工坊）才能做的道具类别；休息点只能做其余的
 *   knownDiffs 一开始就会的难度 */
const CRAFT_RULES = {
  hours: { easy: 1, normal: 1, hard: 2, extreme: 3 },
  failLoss: 0.5,
  shells: ["cm_scrap", "mat_metal"],
  benchKinds: ["field", "self"],
  knownDiffs: ["easy"],
  /* 拆解（不花时间，工坊和休息点都能拆）：壳体全拿回；其余材料合起来拿回 salvage 的比例（向下取整，先给便宜的）；
   * 武器改装件按等级拆出 partScrap 份废料 */
  salvage: 0.5,
  partScrap: { C: 2, B: 3, A: 4, S: 6 }
};
function craftItem(id) { return EFFECT_ITEMS.find(it => it.id === id && CRAFT_RECIPES[id]) || null; }
/** 拆一件东西能拿回什么 → { 材料 id: 份数 }；拆不了返回 null。背包里的改装件 id 是 part_改装件id */
function salvageYield(itemId) {
  const spec = ITEM_CATALOG[itemId];
  if (!spec) return null;
  if (spec.part && typeof WEAPON_PARTS !== "undefined" && WEAPON_PARTS[spec.part]) {
    const n = CRAFT_RULES.partScrap[WEAPON_PARTS[spec.part].grade] || 0;
    return n ? { cm_scrap: n } : null;
  }
  const rc = CRAFT_RECIPES[itemId];
  if (!rc) return null;
  const out = {}, pool = [];
  Object.keys(rc).forEach(id => {
    if (CRAFT_RULES.shells.includes(id)) out[id] = rc[id];
    else for (let i = 0; i < rc[id]; i++) pool.push(id);
  });
  const price = id => (CRAFT_MATERIALS.find(m => m.id === id) || {}).price || 0;
  pool.sort((a, b) => price(a) - price(b));
  pool.slice(0, Math.floor(pool.length * CRAFT_RULES.salvage)).forEach(id => { out[id] = (out[id] || 0) + 1; });
  return out;
}
/** 失败时损失哪些材料：非壳体材料摊开成一份一份，用调用方装好的随机数挑 ceil(总份数 × failLoss) 份 → { id: 份数 } */
function craftFailLoss(recipe) {
  const pool = [];
  Object.keys(recipe).forEach(id => { if (!CRAFT_RULES.shells.includes(id)) for (let i = 0; i < recipe[id]; i++) pool.push(id); });
  let n = Math.ceil(pool.length * CRAFT_RULES.failLoss);
  const out = {};
  while (n-- > 0 && pool.length) {
    const id = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    out[id] = (out[id] || 0) + 1;
  }
  return out;
}

/* 武器改装件也放在背包里（growth.js 的 WEAPON_PARTS，物品 id = part_改装件id） */
function registerWeaponPartItems() {
  if (typeof WEAPON_PARTS === "undefined") return;
  Object.keys(WEAPON_PARTS).forEach(id => {
    const p = WEAPON_PARTS[id];
    const key = typeof weaponPartItemId === "function" ? weaponPartItemId(id) : "part_" + id;
    const neg = p.neg && typeof WEAPON_PART_ATTR_CN !== "undefined" ? ` · ${WEAPON_PART_ATTR_CN[p.neg]}−` : "";
    if (!ITEM_CATALOG[key]) ITEM_CATALOG[key] = { name: `改装件·${p.name}${p.grade ? `（${p.grade}级${neg}）` : ""}`,
      hint: typeof weaponPartText === "function" ? weaponPartText(id) : "", combat: false, part: id };
  });
}
registerWeaponPartItems();

/** 注射剂扣坚毅：玩家只看到「消耗了坚毅」，主持人看到具体数值 */
function shpLossText(lost) {
  if (typeof shpHidden === "function" && shpHidden()) return "消耗了一些坚毅生命（不会致死）";
  return `坚毅 −${lost}${lost < 6 ? "（自己扣坚毅的道具不会致死，至少留 1）" : ""}`;
}

function ensureBag() {
  if (!state.bag || typeof state.bag !== "object") state.bag = { items: [] };
  if (!Array.isArray(state.bag.items)) state.bag.items = [];
  state.kuizhi = Number(state.kuizhi) || 0;
  return state.bag;
}

function bagCount(id) {
  ensureBag();
  const row = state.bag.items.find(x => x.id === id);
  return row ? Number(row.qty) || 0 : 0;
}

function bagAdd(id, qty, notes) {
  ensureBag();
  qty = Math.floor(Number(qty) || 0);
  if (!id || qty === 0) return;
  const spec = ITEM_CATALOG[id];
  if (!spec) return;
  let row = state.bag.items.find(x => x.id === id);
  if (!row) {
    row = { id, qty: 0 };
    state.bag.items.push(row);
  }
  row.qty = Math.max(0, (Number(row.qty) || 0) + qty);
  if (row.qty === 0) state.bag.items = state.bag.items.filter(x => x.id !== id);
  if (notes) notes.push(`${qty > 0 ? "获得" : "消耗"} ${spec.name} ×${Math.abs(qty)}`);
}

/* 联机单局按角色分物品（online-rogue.js）：某名单位能用的数量 = 自己的 + 队伍公用的。没装就是整个背包 */
let itemAccess = null;
function setItemAccess(fn) { itemAccess = typeof fn === "function" ? fn : null; }
function itemCountFor(unit, id) {
  return itemAccess && unit ? Math.max(0, Math.min(bagCount(id), Number(itemAccess(unit, id)) || 0)) : bagCount(id);
}
/** 背包里的物品；给了 unit 就只算这名单位能用的（联机单局） */
function bagList(unit) {
  ensureBag();
  return state.bag.items
    .filter(x => (Number(x.qty) || 0) > 0 && ITEM_CATALOG[x.id])
    .map(x => Object.assign({ qty: unit ? itemCountFor(unit, x.id) : x.qty }, ITEM_CATALOG[x.id], { id: x.id }))
    .filter(x => x.qty > 0);
}

function addKuizhi(n, notes, reason) {
  n = Math.floor(Number(n) || 0);
  if (!n) return;
  state.kuizhi = (Number(state.kuizhi) || 0) + n;
  if (notes) notes.push(`获得 ${n} 奎支${reason ? "（" + reason + "）" : ""}。背包现有 ${state.kuizhi}。`);
}

function rollEnemyLoot(u) {
  if (!u || u.isPlayer) return 0;
  // 单局（Roguelike）统一按杂兵 / 精英 / 首领三档，由开战的一方写进 state.lootByRank
  if (typeof state !== "undefined" && state.lootByKit && state.lootByKit[u.kit] != null) return Number(state.lootByKit[u.kit]) || 0;
  if (typeof state !== "undefined" && state.lootByRank) {
    const rank = typeof enemyRankOf === "function" ? enemyRankOf(u) : "minion";
    return Number(state.lootByRank[rank]) || 0;
  }
  if (Number(u.lootKuizhi) > 0) return Number(u.lootKuizhi);
  const kit = u.kit || "";
  const roll = (n, s, b) => (typeof takeDice === "function" ? takeDice(n, s, b).total : n * Math.ceil(s / 2) + (b || 0));
  if (kit === "thug_knife" || kit === "thug_hammer" || kit === "mine_overseer") return roll(1, 4, 0) * 10;
  if (kit === "bandit_boss") return roll(3, 4, 0) * 50 + 50;
  // 主持人手册第十章（摧毁植入体的掉落；破解另计，由主持人给）
  if (kit === "mecha_mg" || kit === "mecha_gl" || kit === "gas_collector") return roll(2, 6, 0) * 100;
  if (kit === "captain_wolf" || kit === "captain_ox" || kit === "captain_lizard" || kit === "ant_guard" || kit === "ant_hunter" || kit === "sandfish_lead") return roll(1, 6, 0) * 50 + 100;
  if (kit === "giant") return roll(3, 6, 0) * 100 + 100;
  if (kit === "outlaw_king") return 0;
  const fixed = {
    guard_sword: 20, guard_gun: 20, patrol_car: 30, buoy: 20, dumpdrone: 35, mine_guard: 20, flint_sweeper: 20, alarm_bot: 20, meteor_miner: 35, meteor_spider: 10, meteor_centipede: 15,
    crow: 15, sandfish_drive: 20, sandfish_ambush: 20, swarm: 200, patrolboat: 200, spreader: 180, watchcrow: 350, dustbody: 120
  };
  return fixed[kit] || 0;
}

/** 维修工具包能修的武器：[{ kit, name, unit, owner, down, dur, max, need }]（need = 这次能用掉几点） */
function repairTargets() {
  const out = [];
  const units = state.units || [];
  partyHeroes().filter(h => !h.dead).forEach(h => (h.linkedKits || []).forEach(k => {
    const unit = units.find(u => u.kit === k && !u._removed && !u.fused && (!u.weaponOf || u.weaponOf === h.kit)) || null;
    const down = !!(unit && unit.dead);
    const dur = weaponDur(k), max = weaponDurMax(k);
    out.push({ kit: k, name: weaponName(k), unit, owner: h, down, dur, max, need: down ? reviveCost(unit) : Math.max(0, max - dur) });
  }));
  return out;
}
/** 修好倒地的武器人要用几点：恢复最大生命的 25%（至少 1 点），1 点维修量 = 1 点生命 */
const REPAIR_REVIVE_RATIO = 0.25;
function reviveCost(unit) {
  const max = (unit.layers || []).reduce((s, l) => s + (Number(l.max) || 0), 0);
  return Math.max(1, Math.ceil(max * REPAIR_REVIVE_RATIO));
}
/** 战斗中用维修工具包：kit 指定哪把武器（不给就按目标单位：武器人自己，角色手里那把） */
function useRepairKit(actor, target, kit, notes) {
  if (repairPoints() < 1) { notes.push("没有维修工具包。"); return notes; }
  const list = repairTargets();
  let row = typeof kit === "string" ? list.find(r => r.kit === kit) : null;
  if (!row && target) row = list.find(r => r.unit === target) || list.find(r => r.owner === target && typeof heldWeaponKit === "function" && r.kit === heldWeaponKit(target));
  if (!row) { notes.push("选一把要修的武器。"); return notes; }
  if (row.down) {
    // 倒地的武器人：修好重新站起来（从最内层开始补血），这回合没有行动
    const u = row.unit;
    const used = spendRepairPoints(row.need);
    u.dead = false; u.dying = false; u.stunned = false;
    u.ap = 0; u.bonus = 0;
    let left = used;
    for (let i = u.layers.length - 1; i >= 0 && left > 0; i--) {
      const l = u.layers[i];
      const add = Math.min(left, (Number(l.max) || 0) - (Number(l.current) || 0));
      l.current = (Number(l.current) || 0) + add;
      left -= add;
    }
    u.def = u.defMax != null ? u.defMax : u.def;
    notes.push(`${actor.name} 用维修工具包修好倒地的 ${row.name}：恢复 ${used} 点生命重新站起来，用掉 ${used} 点维修量（还剩 ${repairPoints()} 点）。`);
    return notes;
  }
  if (row.need <= 0) { notes.push(`${row.name} 耐久已满。`); return notes; }
  const before = row.dur;
  const used = spendRepairPoints(row.need);
  restoreDurability(row.kit, used);
  // 修好的武器回到主人手里——除非它正以武器人在场（以前修在场的武器人会把主人也设成持械，两边同时拿着）
  if (row.owner && row.owner.weaponHeld === false && !row.owner.dead && before <= 0 && typeof heldWeaponKit === "function" &&
      !(typeof weaponOutOnField === "function" && weaponOutOnField(row.kit))) row.owner.weaponHeld = true;
  notes.push(`${actor.name} 用维修工具包修 ${row.name}：耐久 ${before} → ${weaponDur(row.kit)}，用掉 ${used} 点维修量（还剩 ${repairPoints()} 点）。`);
  return notes;
}
/** 道具自己扣坚毅生命（强心 / 强化注射剂）：不会致死，坚毅最少留 1。返回实际扣掉的量 */
function selfShpCost(u, n) {
  const cur = Math.max(0, Number(u.shp) || 0);
  const next = Math.max(Math.min(1, cur), cur - n);
  u.shp = next;
  return cur - next;
}
function useItemOn(actor, itemId, target, zone) {
  const notes = [];
  // 濒死没起身的人不能用道具（以前规则层不拦，只靠界面）
  if (actor && actor.dying && !actor.upOnShp) { notes.push(`${actor.name} 濒死中。先点「起身」。`); return notes; }
  const spec = ITEM_CATALOG[itemId];
  if (!spec) { notes.push("没有这种道具。"); return notes; }
  if (spec.target === "weapon") return useRepairKit(actor, target, zone, notes);   // 维修工具包按点数用，不是一次一个
  if (bagCount(itemId) < 1) { notes.push(`没有${spec.name}。`); return notes; }
  // 效果道具：先看能不能用（射程、目标、场地能不能改……），不能用就不扣道具
  if (spec.effect) {
    const why = itemUseError(actor, itemId, target, zone);
    if (why) { notes.push(why); notes.unused = true; return notes; }   // 没用掉：不扣附赠动作（battle-commands.js）
    bagAdd(itemId, -1, notes);
    useEffectItem(actor, spec.effect, target, zone, notes);
    return notes;
  }
  // 投掷类道具（手榴弹、酸液瓶、冲击炸弹）：危墙 / 关着的门倒塌 / 打开之前影响不到对面，扔过去没用，道具不用掉
  if (spec.target === "zone" && typeof lineBlocked === "function") {
    const z = zone != null ? Number(zone) : Number((target && target.zone) || actor.zone);
    const block = lineBlocked(actor.zone, z);
    if (block) { notes.push(`${actor.name} 的${spec.name}影响不到 ${z} 区：${block}`); notes.unused = true; return notes; }
  }
  bagAdd(itemId, -1, notes);
  if (itemHealSpec(itemId)) {
    const t = target || actor;
    const r = rollItemHeal(itemId);
    // 和其他治疗一样从内往外补，可以治到外层（作者定）
    const got = typeof healUnit === "function" ? healUnit(t, r.total) : r.total;
    notes.push(`${actor.name} 对 ${t.name} 使用${spec.name}，掷出 ${r.text}，实际恢复 ${Math.floor(got || 0)}` +
      (t.dying ? "（濒死不能靠治疗恢复）" : t.upOnShp ? "（起身中，治疗不回坚毅生命）" : "") + "。");
  } else if (itemId === "stim") {
    const got = typeof healUnit === "function" ? healUnit(actor, 16) : 16;
    const lost = selfShpCost(actor, 6);
    notes.push(`${actor.name} 使用强心注射剂：恢复 ${Math.floor(got || 0)} 生命，${shpLossText(lost)}。`);
  } else if (itemId === "steroid") {
    actor.atk = (Number(actor.atk) || 0) + 3;
    actor.itemAtkBonus = (Number(actor.itemAtkBonus) || 0) + 3;
    const lost = selfShpCost(actor, 6);
    notes.push(`${actor.name} 使用强化注射剂：ATK +3 至战斗结束，${shpLossText(lost)}。`);
  } else if (itemId === "bomb_e" || itemId === "bomb_a" || itemId === "shockbomb") {
    const z = zone != null ? Number(zone) : Number((target && target.zone) || actor.zone);
    const units = (typeof fieldUnits === "function" ? fieldUnits() : state.units).filter(u =>
      Number(u.zone) === z && !u.dead && !u.hidden && !u.fused
    );
    notes.push(`${actor.name} 向 ${z} 区投出${spec.name}。`);
    // 范围攻击：这个区的按钮 / 拉杆触发一次（区里没人也会炸到）
    if (typeof markAoeZone === "function") {
      state.aoePulse = {};
      // 区里没人也会炸到配置物（震荡弹只有击破，打不动配置物）
      markAoeZone(z, itemId === "shockbomb" ? null : { element: itemId === "bomb_e" ? "electric" : "acid", dmg: 9, attacker: actor });
    }
    units.forEach(u => {
      // 被铁壁 / 废铁墙这类屏障保护的单位不受范围攻击（屏障在配置物那一轮挨打）；屏障只挡敌方扔过来的（自己人扔的不挡，app.js · barrierFoe）
      const shield = itemId === "shockbomb" && typeof aoeShieldFor === "function" ? aoeShieldFor(u, actor) : null;
      if (shield) {
        notes.push(`${u.name} 被${shield.name}护住，没受影响。`);
        return;
      }
      if (itemId === "shockbomb") {
        if (typeof dealBreak === "function") dealBreak(u, 2, "physical", notes, spec.name);
      } else {
        const ele = itemId === "bomb_e" ? "electric" : "acid";
        const r = takeDice(1, 6, 6);
        if (typeof dealTo === "function") {
          dealTo(actor, u, {
            atk: 0, mult: 0, flat: r.total, element: ele, baseBreak: 0,
            flags: { action: true, aoe: true, blockResolved: true }
          });
        }
        notes.push(`${u.name} 受到 ${r.text} ${ele}。`);
      }
    });
    if (typeof flushAoePulse === "function") flushAoePulse();
  }
  return notes;
}

/* ===== 效果道具的目标、射程、使用 ===== */
function effectItemOf(itemId) { const spec = ITEM_CATALOG[itemId]; return spec && spec.effect ? spec.effect : null; }
function itemZoneDist(a, b) { return typeof zoneDist === "function" ? zoneDist(Number(a), Number(b), state.zoneMode) : Math.abs(Number(a) - Number(b)); }
function itemPresent(u) { return !!u && !u.dead && !u.hidden && !u.fused && !u._removed; }
/** 能被道具瞄准的敌人：在场、看得见、选得中（下潜、不可选中的不行） */
function itemEnemyOk(actor, u) {
  if (!itemPresent(u) || u.isPlayer || u.untargetable || u.submerged || u.kit === "ironwall") return false;
  if (typeof isNeutralCreature === "function" && isNeutralCreature(u)) return true;
  return !(typeof playerAllied === "function" && playerAllied(u));
}
/** 用这件道具的问题（空 = 可以用）。规则层、游戏界面、联机 / 热座的校验共用 */
function itemUseError(actor, itemId, target, zone) {
  const it = effectItemOf(itemId);
  if (!it || !actor) return null;
  const R = EFFECT_ITEM_RANGE;
  if (it.target === "self") return target && target !== actor ? `${it.name}只能对自己用。` : null;
  if (it.target === "zone") {
    const z = Number(zone);
    if (!(z >= 1)) return `${it.name}需要选一个区域。`;
    if (itemZoneDist(actor.zone, z) > R) return `${it.name}只能用在距离 ${R} 以内的区域。`;
    const block = typeof lineBlocked === "function" ? lineBlocked(actor.zone, z) : null;
    if (block) return `${it.name}影响不到 ${z} 区：${block}`;
    if (it.kind === "field" && typeof fieldChangeWhy === "function") return fieldChangeWhy(z, it.key) || null;
    return null;
  }
  if (!target) return `${it.name}需要选一个${it.target === "ally" ? "友方" : "敌人"}。`;
  if (itemZoneDist(actor.zone, target.zone) > R) return `${it.name}只能用在距离 ${R} 以内的目标。`;
  if (it.target === "ally") return itemPresent(target) && target.isPlayer ? null : `${it.name}要选在场的友方。`;
  if (!itemEnemyOk(actor, target)) return `${it.name}要选看得见、选得中的敌人。`;
  const block = typeof lineBlocked === "function" ? lineBlocked(actor.zone, target.zone) : null;
  if (block) return `${it.name}打不到 ${target.name}：${block}`;
  if (it.kind === "stun" && typeof enemyRankOf === "function" && enemyRankOf(target) === "boss") return `${target.name} 是首领，闪光震撼弹对首领无效。`;
  return null;
}
/** 界面用：这件道具能选的单位 / 区域 */
function itemTargetUnits(actor, itemId) {
  const it = effectItemOf(itemId);
  const list = (state.units || []).filter(itemPresent);
  if (!it) return list.filter(u => u.isPlayer);   // 旧道具（医疗包）：照旧任意友方
  if (it.target === "self") return [actor];
  return list.filter(u => (it.target === "ally" ? u.isPlayer : !u.isPlayer) && !itemUseError(actor, itemId, u, null));
}
function itemTargetZones(actor, itemId) {
  const all = typeof boardZoneIds === "function" ? boardZoneIds() : Array.from({ length: Number(state.zoneMode) || 2 }, (_, i) => i + 1);
  const it = effectItemOf(itemId);
  return it ? all.filter(z => !itemUseError(actor, itemId, null, z)) : all;
}
/** 给一个单位挂上道具的状态（属性状态、通用状态），连带的规则（灼烧层数、不稳叠加、震荡、共振共享、自我效果免疫……）照常结算 */
function itemApplyStatus(actor, u, key, notes) {
  u.statuses = u.statuses || {};
  if (key === "burn") {
    if (typeof grantBurn === "function") grantBurn(u, 1, notes);
    if (u.self !== "burn") notes.push(`${u.name} 灼烧 → ${u.statuses.burn} 层。`);
  } else if (key === "unstable") {
    if (typeof applyUnstable === "function" && applyUnstable(u, notes)) {
      notes.push(`${u.name} 陷入不稳。`);
      if (typeof convertUnstableInHv === "function") convertUnstableInHv(u, notes);
    }
  } else {
    if (key === "chase") u.chasers = (u.chasers || []).filter(id => id !== actor.id).concat(actor.id);
    if (key === "high") u.highApplyTurn = state.turnNo;
    u.statuses[key] = true;
    if (key === "shockwave" && typeof syncShockwave === "function") syncShockwave(u, notes);
    notes.push(`${u.name} 获得${EFFECT_STATUS_CN[key] || key}。`);
  }
  if (EFFECT_STATUS_ELEMENT[key]) u.statuses.latestElement = EFFECT_STATUS_ELEMENT[key];
  if (key !== "burn" && key !== "unstable" && typeof popStatus === "function") popStatus(u, key);
  if (typeof pulseResonanceStatus === "function") pulseResonanceStatus(u, key);
  if (typeof selfImmunities === "function") selfImmunities(u, notes);   // 自焚免疫灼烧、霜结免疫冻伤……
}
/** 闪光震撼弹：失衡晕眩。首领无效（itemUseError 已拦）；10 级起的精英按首领规则只推进 1 个晕眩标记（imbalanceLine 里记） */
function itemStun(u, notes) {
  if (u.stunned) { notes.push(`${u.name} 已经在失衡中。`); return; }
  if (u.noPosture || u.trainingDummy) { notes.push(`${u.name} 没有架势，不会失衡。`); return; }
  u.stunned = true;
  notes.push(typeof imbalanceLine === "function" ? imbalanceLine(u) : `${u.name} 失衡。`);
  if (typeof endSelfOnStun === "function") endSelfOnStun(u, notes);
  if (typeof queueAssistAttack === "function") queueAssistAttack(null, u);
}
function useEffectItem(actor, it, target, zone, notes) {
  if (it.target === "zone") {
    const z = Number(zone);
    if (it.kind === "field") {
      const why = typeof setZoneField === "function" ? setZoneField(z, it.key, { by: actor.id }) : null;
      notes.push(why || `${actor.name} 使用${it.name}：${z} 区变成${EFFECT_FIELD_CN[it.key]}。`);
      return;
    }
    notes.push(`${actor.name} 向 ${z} 区使用${it.name}。`);
    const units = (state.units || []).filter(u => itemPresent(u) && Number(u.zone) === z && u.kit !== "ironwall" && (!it.alliesOnly || u.isPlayer));
    if (!units.length) notes.push(`${z} 区没有单位。`);
    units.forEach(u => {
      // 下潜中的单位范围攻击打不到（effects.js · 下潜）；投掷罐不是谐波，也不例外
      if (u.submerged) { notes.push(`${u.name} 下潜中，没有被波及。`); return; }
      const shield = !it.alliesOnly && typeof aoeShieldFor === "function" ? aoeShieldFor(u, actor) : null;   // 屏障只挡敌方扔过来的
      if (shield) { notes.push(`${u.name} 被${shield.name}护住，没受影响。`); return; }
      itemApplyStatus(actor, u, it.key, notes);
    });
    return;
  }
  const t = it.target === "self" ? actor : target;
  notes.push(`${actor.name} 对 ${t === actor ? "自己" : t.name} 使用${it.name}。`);
  if (it.kind === "self") { if (typeof castSelfEffect === "function") castSelfEffect(actor, it.key, notes); notes.push(`${actor.name} 获得自我效果「${EFFECT_SELF_CN[it.key]}」。`); return; }
  if (it.kind === "stun") { itemStun(t, notes); return; }
  if (it.kind === "instant") {
    if (it.key === "neutralize") { if (typeof applyNeutralize === "function") notes.push(...applyNeutralize(t)); return; }
    if (it.key === "shift") { if (typeof applyShift === "function") applyShift(t); if (typeof popStatus === "function") popStatus(t, "shift"); notes.push(`${t.name} 错位：最外两层血量互换。`); return; }
    if (typeof applyInstantEffect === "function") applyInstantEffect(t, it.key, notes, actor);
    notes.push(`${t.name} 被施加${EFFECT_INSTANT_CN[it.key]}。`);
    return;
  }
  itemApplyStatus(actor, t, it.key, notes);
}

function cheatFillBag() {
  const notes = [];
  addKuizhi(1000, notes, "后台刷入");
  Object.keys(ITEM_CATALOG).forEach(id => bagAdd(id, 3, notes));
  return notes;
}
