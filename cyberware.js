/* ---------- 义体（cyberware）：数据 + 规则框架，不画界面 ----------
 * 规则（夕夏 2026-10-20，issue #52 / kits/cyberware-design-doc.md 第 0 节）：
 *   改造率占用 = Σ(扣除的生命上限 ÷ 原生命上限) + 各义体固定占用；和血量层改造（growth.js · cyberPlan）共用上限
 *   上限 = 义体改造率（growth.js · cyberRateOf，例：6 智力 60%）
 *   分档 5/10/15/20；主动义体每次短休 1 次；无被动、无槽位；可选 conflict 标签（同标签不能同时装）
 *   攻击义体：近战 tier/5×10 + (tier/5)d20；远程每颗 d20 换成 d12+2；2 击破；开火 −2 坚毅；装着每天 −2 坚毅；不吃 atk
 *   过度安装：要专长（CYBERWARE_OVERINSTALL_FEAT，占位）；不封顶；每超 5% 每天多 −1 坚毅；拆掉就解除
 *   义体扣坚毅最少留 1，永不致死
 *   诊所购买 / 拆除（花钱、完全可逆）
 * 红线：坚毅（shp）数值永远不给玩家看。cyberwareView / cyberwareInstallPreview 只给档位文字。
 *
 * 数据：CYBERWARE 正式目录目前是空的（内容未设计）。示例在 CYBERWARE_EXAMPLES，
 *   用 cyberwareLoadExamples() 注册进目录（测试 / UI 截图用）。新义体用 cyberwareRegister(def) 或直接写进 CYBERWARE。
 * def 字段：{ id, name, tier(5|10|15|20), kind:"attack", range:"melee"|"ranged", element(7 属性之一),
 *   hpCut?, shpCut?, occupancy?(0–1), price?, removePrice?, dailyShp?, fireShp?, break?, conflict?, text? }
 *   省略的数值按 CYBERWARE_TIER 的档位默认值补。 */
"use strict";

const CYBERWARE_TIERS = [5, 10, 15, 20];
const CYBERWARE_ELEMENTS = ["fire", "acid", "electric", "ice", "energy", "physical", "harmonic"];
/** 档位默认值。hpCut / occupancy 来自设计文档 0.4；shpCut（扣坚毅上限）只说「高级义体扣」，数值是占位；价格占位 */
const CYBERWARE_TIER = {
  5:  { hpCut: 5,  shpCut: 0, occupancy: 0.15, price: 3000,  removePrice: 1000 },
  10: { hpCut: 10, shpCut: 1, occupancy: 0.15, price: 6000,  removePrice: 2000 },
  15: { hpCut: 15, shpCut: 2, occupancy: 0.15, price: 9000,  removePrice: 3000 },
  20: { hpCut: 20, shpCut: 3, occupancy: 0.15, price: 12000, removePrice: 4000 }
};
const CYBERWARE_ATTACK = { break: 2, fireShp: 2, dailyShp: 2 };
const CYBERWARE_OVER_STEP = 0.05;            // 每超 5% 每天多扣 1
const CYBERWARE_OVERINSTALL_FEAT = "overinstall";   // 占位专长 id（feats.js 里还没有；也可设 u.cyberOverinstall = true）

/** 正式目录：空。 */
const CYBERWARE = {};
/** 示例（不是正式内容）：一件 5 级近战攻击义体 */
const CYBERWARE_EXAMPLES = {
  example_t5_melee: { id: "example_t5_melee", name: "【示例】5级近战攻击义体", example: true,
    tier: 5, kind: "attack", range: "melee", element: "physical", conflict: "arm", text: "示例条目，内容未设计。" }
};

function cyberwareNormalize(def) {
  if (!def || !def.id) throw new Error("义体缺少 id");
  const tier = Number(def.tier);
  if (CYBERWARE_TIERS.indexOf(tier) < 0) throw new Error("义体等级只能是 5/10/15/20");
  if (def.element && CYBERWARE_ELEMENTS.indexOf(def.element) < 0) throw new Error("未知属性：" + def.element);
  const t = CYBERWARE_TIER[tier], atk = def.kind === "attack";
  return Object.assign({ kind: "attack", range: "melee", element: "physical", conflict: null,
    hpCut: t.hpCut, shpCut: t.shpCut, occupancy: t.occupancy, price: t.price, removePrice: t.removePrice,
    dailyShp: atk ? CYBERWARE_ATTACK.dailyShp : 0, fireShp: atk ? CYBERWARE_ATTACK.fireShp : 0, break: atk ? CYBERWARE_ATTACK.break : 0,
    usesPerShortRest: 1 }, def, { tier });
}
function cyberwareRegister(def) { const d = cyberwareNormalize(def); CYBERWARE[d.id] = d; return d; }
function cyberwareLoadExamples() { Object.keys(CYBERWARE_EXAMPLES).forEach(k => cyberwareRegister(CYBERWARE_EXAMPLES[k])); return Object.keys(CYBERWARE_EXAMPLES); }
function cyberwareDef(id) { return CYBERWARE[id] ? cyberwareNormalize(CYBERWARE[id]) : null; }
function cyberwareCatalog() { return Object.keys(CYBERWARE).map(cyberwareDef); }

/* ---- 伤害 ---- */
/** 档位伤害公式：{ flat, dice:[{sides,plus}], text, avg } */
function cyberwareDamageSpec(tier, range) {
  const n = Number(tier) / 5;
  const die = range === "ranged" ? { sides: 12, plus: 2 } : { sides: 20, plus: 0 };
  const dice = Array.from({ length: n }, () => Object.assign({}, die));
  const flat = n * 10;
  const text = range === "ranged" ? `${flat} + ${n}×(d12+2)` : `${flat} + ${n}d20`;
  return { flat, dice, text, avg: flat + n * ((die.sides + 1) / 2 + die.plus) };
}
/** 掷一次伤害。rng() 返回 [0,1)。不吃 atk */
function cyberwareRollDamage(tier, range, rng) {
  rng = rng || Math.random;
  const s = cyberwareDamageSpec(tier, range);
  const rolls = s.dice.map(d => 1 + Math.floor(rng() * d.sides) + d.plus);
  return { total: s.flat + rolls.reduce((a, b) => a + b, 0), rolls, flat: s.flat };
}

/* ---- 改造率 ---- */
function cwList(u) { return ((u && u.cyberware) || []).map(x => cyberwareDef(typeof x === "string" ? x : x && x.id)).filter(Boolean); }
function cwAttrs(u) { return (u && u.attrs) || {}; }
/** 原生命上限（没有义体、没有血量层改造时的肉体上限） */
function cyberwareBaseHp(u) {
  if (u && u.growth && !u.attrs) return (u.baseHp || 14) + (u.growth.hp || 0) * Math.max(0, (u.level || 1) - 1);
  return derivedFromAttrs(cwAttrs(u), u && u.level).hp;
}
function cyberwareCap(u) { return cyberRateOf(cwAttrs(u), u && u.level); }
function cyberwareHpCut(u) { return cwList(u).reduce((s, d) => s + d.hpCut, 0); }
function cyberwareShpCut(u) { return cwList(u).reduce((s, d) => s + d.shpCut, 0); }
function cwPlanOf(u) { return (u && (u.cyberPlan || u.cyber && typeof u.cyber === "object" && u.cyber)) || null; }
/** 血量层改造占用（换掉的肉体点数 ÷ 原生命上限；星灵不受改造率限制，不算） */
function cyberwareLayerUse(u, plan) {
  const p = plan || cwPlanOf(u) || {};
  const used = ["armor", "shield", "sand"].reduce((s, t) => s + (Number(p[t]) || 0), 0);
  const base = cyberwareBaseHp(u);
  return base > 0 ? used / base : 0;
}
/** 义体占用 = Σ(hpCut ÷ 原生命上限 + occupancy) */
function cyberwareOccupancy(u, list) {
  const base = cyberwareBaseHp(u);
  return (list || cwList(u)).reduce((s, d) => s + (base > 0 ? d.hpCut / base : 0) + d.occupancy, 0);
}
/** 完整改造率：{ cap, cyberware, layers, total, over, overSteps, remaining, remainingHp, baseHp } */
function cyberwareRate(u, list, plan) {
  const cap = cyberwareCap(u), base = cyberwareBaseHp(u);
  const cw = cyberwareOccupancy(u, list), layers = cyberwareLayerUse(u, plan);
  const total = cw + layers, over = Math.max(0, total - cap);
  return { cap, cyberware: cw, layers, total, over, overSteps: cwOverSteps(over),
    remaining: Math.max(0, cap - total), remainingHp: Math.max(0, base * (cap - total)), baseHp: base };
}
function cwOverSteps(over) { return over > 1e-9 ? Math.ceil(over / CYBERWARE_OVER_STEP - 1e-9) : 0; }
/** 血量层改造在 growth.js · cyberPlanError 里用的改造率（扣掉义体占用后，换算到当前肉体上限） */
function cyberwareLayerRateFor(u, fleshMax) {
  if (!cwList(u).length) return cyberwareCap(u);
  const base = cyberwareBaseHp(u);
  const left = Math.max(0, cyberwareCap(u) - cyberwareOccupancy(u)) * base;
  return fleshMax > 0 ? Math.min(0.99, left / fleshMax) : 0;
}
function cyberwareCanOverinstall(u) {
  // 专长还没设计：feats.js · featHas 只认 FEATS 里有的专长，所以占位 id 直接查 u.feats
  return !!(u && (u.cyberOverinstall || (u.feats || []).indexOf(CYBERWARE_OVERINSTALL_FEAT) >= 0 || (typeof featHas === "function" && featHas(u, CYBERWARE_OVERINSTALL_FEAT))));
}

/* ---- 坚毅消耗（最少留 1）---- */
function cyberwareDrainShp(u, n) {
  n = Math.max(0, Number(n) || 0);
  if (!u || !n) return 0;
  const cur = Number(u.shp) || 0;
  const next = Math.max(Math.min(cur, 1), cur - n);
  u.shp = next;
  return cur - next;
}
/** 每天的坚毅消耗（主持人 / 测试用数值，不进玩家视图） */
function cyberwareDailyCost(u) {
  return cwList(u).reduce((s, d) => s + d.dailyShp, 0) + cyberwareRate(u).overSteps;
}
/** 过一天（ledger.js 长休时调用）。返回实际扣掉的值 */
function cyberwareDayTick(u) { return cyberwareDrainShp(u, cyberwareDailyCost(u)); }
/** 短休 / 长休：主动义体次数刷新 */
function cyberwareShortRest(u) { if (u) u.cyberwareUsed = {}; }

/* ---- 开火 ---- */
function cyberwareUsesLeft(u, id) {
  const d = cyberwareDef(id); if (!d) return 0;
  return Math.max(0, d.usesPerShortRest - (Number(((u && u.cyberwareUsed) || {})[id]) || 0));
}
/** 开火：{ ok, error?, damage:{total,rolls}, element, break, range } */
function cyberwareFire(u, id, rng) {
  if (!cwHas(u, id)) return { ok: false, error: "没有装这件义体" };
  const d = cyberwareDef(id);
  if (d.kind !== "attack") return { ok: false, error: "不是攻击义体" };
  if (cyberwareUsesLeft(u, id) <= 0) return { ok: false, error: "短休前不能再用" };
  u.cyberwareUsed = u.cyberwareUsed || {};
  u.cyberwareUsed[id] = (Number(u.cyberwareUsed[id]) || 0) + 1;
  cyberwareDrainShp(u, d.fireShp);
  return { ok: true, damage: cyberwareRollDamage(d.tier, d.range, rng), element: d.element, break: d.break, range: d.range };
}

/* ---- 诊所：安装 / 拆除 ---- */
function cwHas(u, id) { return cwList(u).some(d => d.id === id); }
/** 安装预览（玩家可见，不含坚毅数值）：{ ok, error, cost, burden, warning, rateBefore, rateAfter, over, conflictWith } */
function cyberwareInstallPreview(u, id) {
  const d = cyberwareDef(id);
  if (!d) return { ok: false, error: "没有这件义体" };
  if (cwHas(u, id)) return { ok: false, error: "已经装了" };
  const clash = d.conflict ? cwList(u).find(x => x.conflict === d.conflict) : null;
  const before = cyberwareRate(u), after = cyberwareRate(u, cwList(u).concat([d]));
  const over = after.over > 1e-9;
  let error = null;
  if (clash) error = `和「${clash.name}」冲突，不能同时安装`;
  else if (over && !cyberwareCanOverinstall(u)) error = "超出改造率上限（需要专长才能过度安装）";
  const burden = over ? "heavy" : (d.dailyShp || d.shpCut ? "strain" : "none");
  return { ok: !error, error, cost: d.price, id: d.id, name: d.name, tier: d.tier,
    rateBefore: pct(before.total), rateAfter: pct(after.total), cap: pct(after.cap), overinstall: over,
    hpCut: d.hpCut, conflictWith: clash ? clash.id : null, burden,
    warning: burden === "none" ? "" : (burden === "heavy" ? "这会给身体带来极大负担。" : "这会给身体带来负担。") };
}
function pct(x) { return Math.round(x * 1000) / 10; }
/** 安装：purse = { kuizhi } 之类的钱包对象，key 默认 "kuizhi"；opt.free 免费（主持人） */
function cyberwareInstall(u, id, purse, opt) {
  opt = opt || {};
  const pv = cyberwareInstallPreview(u, id);
  if (!pv.ok) throw new Error(pv.error);
  const key = opt.key || "kuizhi";
  if (!opt.free) {
    if (!purse || (Number(purse[key]) || 0) < pv.cost) throw new Error("奎支不够");
    purse[key] -= pv.cost;
  }
  const hpBefore = cwFleshCap(u);
  u.cyberware = (u.cyberware || []).concat([{ id }]);
  cwRefresh(u, hpBefore);
  return pv;
}
function cyberwareRemoveCost(u, id) { const d = cyberwareDef(id); return d ? d.removePrice : 0; }
/** 拆除：花钱，完全可逆（生命 / 坚毅上限还回来） */
function cyberwareRemove(u, id, purse, opt) {
  opt = opt || {};
  if (!cwHas(u, id)) throw new Error("没有装这件义体");
  const cost = cyberwareRemoveCost(u, id), key = opt.key || "kuizhi";
  if (!opt.free) {
    if (!purse || (Number(purse[key]) || 0) < cost) throw new Error("奎支不够");
    purse[key] -= cost;
  }
  const hpBefore = cwFleshCap(u);
  u.cyberware = (u.cyberware || []).filter(x => (typeof x === "string" ? x : x.id) !== id);
  if (u.cyberwareUsed) delete u.cyberwareUsed[id];
  cwRefresh(u, hpBefore);
  return { cost };
}
function cwFleshCap(u) { return cyberwareBaseHp(u) - cyberwareHpCut(u); }
/** 有血量层的单位：照 growth.js 重算；拆掉时把还回来的上限加到当前血量（同 PR #78 规则） */
function cwRefresh(u, hpBefore) {
  if (u && u.layers && typeof applyLevelStats === "function") {
    applyLevelStats(u);
    const gain = cwFleshCap(u) - hpBefore;
    const inner = u.layers.find(l => l.inner) || u.layers[u.layers.length - 1];
    if (gain > 0 && inner && !u.cyberPlan) inner.current = Math.min(inner.max, (Number(inner.current) || 0) + gain);
  }
}

/* ---- 玩家视图（白名单，绝无坚毅数值）---- */
const CYBERWARE_BURDEN_TEXT = { none: "身体还算适应。", strain: "义体在持续消耗你的精神。", heavy: "身体承受着极大负担。" };
function cyberwareView(u) {
  const r = cyberwareRate(u);
  const list = cwList(u);
  const burden = r.overSteps > 0 ? "heavy" : (list.some(d => d.dailyShp) ? "strain" : "none");
  return {
    rate: pct(r.total), cap: pct(r.cap), cyberwareRate: pct(r.cyberware), layerRate: pct(r.layers),
    remainingHp: Math.floor(r.remainingHp + 1e-9), overinstall: r.over > 1e-9, canOverinstall: cyberwareCanOverinstall(u),
    burden, burdenText: CYBERWARE_BURDEN_TEXT[burden],
    installed: list.map(d => ({ id: d.id, name: d.name, tier: d.tier, kind: d.kind, range: d.range, element: d.element,
      damageText: cyberwareDamageSpec(d.tier, d.range).text, break: d.break, hpCut: d.hpCut, conflict: d.conflict,
      usesLeft: cyberwareUsesLeft(u, d.id), removeCost: d.removePrice, example: !!d.example }))
  };
}
/** 诊所目录（玩家可见） */
function cyberwareShopView(u) {
  return cyberwareCatalog().map(d => {
    const pv = cyberwareInstallPreview(u, d.id);
    return { id: d.id, name: d.name, tier: d.tier, kind: d.kind, range: d.range, element: d.element,
      damageText: cyberwareDamageSpec(d.tier, d.range).text, break: d.break, hpCut: d.hpCut, conflict: d.conflict,
      price: d.price, text: d.text || "", example: !!d.example, installed: cwHas(u, d.id),
      canInstall: !!pv.ok, error: pv.ok ? null : pv.error, warning: pv.warning || "", rateAfter: pv.rateAfter };
  });
}
/** 联机：房主算好再白名单（online-view.js · projectCyberware 再过一遍 scrubHidden） */
function cyberwarePacket(u) { return { kit: u && u.kit, view: cyberwareView(u), shop: cyberwareShopView(u) }; }

if (typeof module !== "undefined" && module.exports) {
  module.exports = { CYBERWARE, CYBERWARE_EXAMPLES, CYBERWARE_TIER, CYBERWARE_TIERS, cyberwareRegister, cyberwareLoadExamples,
    cyberwareDamageSpec, cyberwareRollDamage };
}
