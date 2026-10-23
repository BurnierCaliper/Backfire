/* ---------- 义体（cyberware）：数据 + 规则框架，不画界面 ----------
 * 规则（夕夏 2026-10-20，issue #52 / kits/cyberware-design-doc.md 第 0 节；#262 夕夏定：单体伤害型模板做进游戏）：
 *   改造率占用 = Σ(扣除的生命上限 ÷ 原生命上限) + 各义体固定占用；和血量层改造（growth.js · cyberPlan）共用上限
 *   上限 = 义体改造率（growth.js · cyberRateOf，例：6 智力 60%）
 *   分档 5/10/15/20（名字后缀 .vol1–.vol4）；主动义体每次短休 1 次；无被动、无部位 / 槽位；可选 conflict 标签（同标签不能同时装）
 *   单体伤害型（kind "attack"）：近战 tier/5×10 + (tier/5)d20；远程每颗 d20 换成 d12+2；2 击破；发动 −2 坚毅；装着每天 −2 坚毅；不吃 atk
 *   过度安装：要专长（CYBERWARE_OVERINSTALL_FEAT，占位）；不封顶；每超 5% 每天多 −1 坚毅；拆掉就解除
 *   义体扣坚毅最少留 1（CYBERWARE_SHP_FLOOR），永不致死
 *   诊所购买 / 拆除（花钱、完全可逆）；不能升级：同一系列（line）只能装一件，换等级只能以新换旧（拆除费 + 新的价格）
 *   角色 5 级起才能在诊所安装 / 拆除（CYBERWARE_UNLOCK_LEVEL，#315）；已经装着的照常生效、照常每天消耗，只是到 5 级前拆不掉；
 *   血量层改造（growth.js · cyberPlan）1 级就能用，不受这个限制
 * 红线：坚毅（shp）数值永远不给玩家看。cyberwareView / cyberwareInstallPreview 只给档位文字；
 *   图鉴（cyberwareCodexInfo）只写固定的规则（可以写坚毅生命的具体消耗），不碰任何角色当前的坚毅生命。
 *
 * 种类表 CYBERWARE_KINDS：每种义体自己管默认数值、效果说明、战斗里选谁、怎么发动。诊所、图鉴、战斗、联机都按这张表走，
 *   加新种类（状态效果、主动位移、移动其他单位……）只在表里加一项，下面的逻辑不用改。
 * 目录：正式目录 CYBERWARE 由「系列 × 等级」生成（CYBERWARE_LINES，名字是占位）；示例在 CYBERWARE_EXAMPLES，
 *   用 cyberwareLoadExamples() 注册进目录（测试 / UI 截图用）。新义体在 CYBERWARE_LINES 加一行，或用 cyberwareRegister(def)。
 * def 字段：{ id, name, tier(5|10|15|20), kind(CYBERWARE_KINDS 的键，默认 attack), line?(系列：同系列只能装一件),
 *   hpCut?, shpCut?, occupancy?(0–1), price?, removePrice?, dailyShp?, fireShp?, usesPerShortRest?, cost?, conflict?, text?,
 *   再加种类自己的字段（单体伤害型：range "melee"|"ranged"、element(7 属性之一)、break） }
 *   省略的数值按 CYBERWARE_TIER 的档位默认值、种类的 defaults 补。
 * 战斗：装着的义体是技能 "cw_<id>"（party.js · skillList / skillCost，app.js · skillFlowSteps / skillRequirementError /
 *   skillTargetError / runSkillInner 调这里的 cyberware* 函数），和专长动作（feats.js · "feat_<id>"）分开。
 *   次数记在 LEDGER.shortOnce[kit]["cw:<id>"]（和专长「每次短休 N 次」同一张表、不同的键）：短休 / 长休刷新，跟着存档走，
 *   单局每场重新摆队伍也不会丢。 */
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
/** 等级 ↔ 名字后缀 .volN：5 / 10 / 15 / 20 级 = .vol1 / .vol2 / .vol3 / .vol4 */
const CYBERWARE_VOL = { 5: 1, 10: 2, 15: 3, 20: 4 };
/** 单体伤害型：伤害 = 每 5 级 flatPerStep 点 + 每 5 级一颗骰（近战 d20，远程 d12+2），不吃 atk；击破、坚毅消耗 */
const CYBERWARE_ATTACK = { break: 2, fireShp: 2, dailyShp: 2, flatPerStep: 10, melee: { sides: 20, plus: 0 }, ranged: { sides: 12, plus: 2 } };
/** 所有主动义体的默认：发动花多少（设计没写，先按 1 行动点，占位）、每次短休能用几次 */
const CYBERWARE_ACTIVE = { cost: { ap: 1 }, usesPerShortRest: 1 };
const CYBERWARE_UNLOCK_LEVEL = 5;            // 角色几级起能在诊所安装 / 拆除义体（#315）；血量层改造 1 级就能用，不看这个
const CYBERWARE_SHP_FLOOR = 1;               // 义体扣坚毅最少留 1：义体导致的坚毅损失不会致死
const CYBERWARE_OVER_STEP = 0.05;            // 每超 5% 每天多扣 1
const CYBERWARE_OVERINSTALL_FEAT = "overinstall";   // 占位专长 id（feats.js 里还没有；也可设 u.cyberOverinstall = true）
const CYBERWARE_SKILL_PREFIX = "cw_";        // 战斗里的技能 id：cw_<义体 id>（专长动作是 feat_）
const CYBERWARE_USE_KEY = "cw:";             // LEDGER.shortOnce 里的次数键：cw:<义体 id>（专长是 feat:）
const CYBERWARE_RANGE_NAME = { melee: "近战", ranged: "远程" };
const CYBERWARE_CODEX_HP = [30, 60, 90];     // 图鉴举例用的原生命上限（改造率占用随它变）

/* ---- 种类表 ----
 * 每种一项（除了 name 都可以省）：
 *   name                 种类名（诊所、图鉴、技能说明）
 *   defaults             这一种的默认字段（def 里写了的优先）
 *   validate(d)          注册时检查这一种自己的字段，写错直接报错（不然会悄悄按默认值算）
 *   target               战斗里选谁：engine.js · SKILL_TARGET_SIDE 的写法（enemy / ally / allySelf / any / anySelf）；不写 = 不选单位
 *   range(d)             射程 { min, max }（engine.js · SKILL_RANGE）；不写 = 按提示文字推断
 *   facts(d)             诊所 / 已装列表多给的展示字段（联机要在 online-view.js · projectCyberware 的白名单里放行才发得出去）
 *   summary(d)           一行效果（诊所、战斗的技能列表）
 *   short(d)             更短的一句（图鉴卡片）
 *   tags(d)              图鉴详情的小标签
 *   lines(d)             图鉴的效果说明（固定的规则文字）
 *   steps(u, d, picks)   战斗里的分步选择（app.js · skillFlowSteps 的写法），不写 = 没有分步
 *   why(u, d)            战斗里现在不能用的原因（没有返回 null）
 *   targetWhy(u, d, t, picks)  这个目标不能用的原因（在扣行动点之前拦下）
 *   run(u, d, ctx)       发动（ctx = { t, picks, lines, hitOne }，行动点已经扣过）；返回 false = 没选好对象：不记次数、不扣坚毅。
 *                        没有 run 的种类不进战斗的技能列表
 *   roll(d, rng)         不在战斗里发动（cyberwareFire）时顺带算出的结果
 * 以后的种类照这个写：状态效果 = target + run 里挂状态；主动位移 = steps 选区 + run 里 displaceTo(u, …)；
 *   移动其他单位 = target + steps 选区 + run 里 displaceTo(t, …)。和专长（推搡、勾索、跃迁、挑衅、震慑、地震）是两套东西：
 *   技能 id、次数各记各的；位移照专长一样走 app.js · displaceTo / canDisplace（千钧不能被位移、首领推不动这类限制保持一致）。 */
const CYBERWARE_KINDS = {
  attack: {
    name: "单体伤害型",
    defaults: { range: "melee", element: "physical", break: CYBERWARE_ATTACK.break, fireShp: CYBERWARE_ATTACK.fireShp, dailyShp: CYBERWARE_ATTACK.dailyShp },
    validate: d => {
      if (!Object.prototype.hasOwnProperty.call(CYBERWARE_RANGE_NAME, d.range)) throw new Error(`单体伤害型的射程只能是 ${Object.keys(CYBERWARE_RANGE_NAME).join(" / ")}：${d.range}`);
    },
    target: "enemy",
    range: d => (d.range === "ranged" ? { min: 1, max: 1 } : { min: 0, max: 0 }),
    // 打不出去的目标在扣行动点之前拦下（和 app.js · dealTo 的判定一致）：躲藏中的不能被选作攻击目标，下潜中的只有谐波攻击打得到。
    // 到 dealTo 才拦的话，行动点、短休前的次数、坚毅生命都白扣了
    targetWhy: (u, d, t) => {
      if (!t || !t.id || t.isPlayer || t.isStructure || t.kind) return null;
      if (t.statuses && t.statuses.hide) return `${t.name} 躲藏中，不能被选作攻击目标`;
      if (t.submerged && d.element !== "harmonic") return `${t.name} 下潜中，只有谐波攻击打得到`;
      return null;
    },
    facts: d => ({ range: d.range, element: d.element, damageText: cyberwareDamageSpec(d.tier, d.range).text, break: d.break }),
    summary: d => `${cwRangeName(d)} · 打${cwReach(d)}一名敌人 · ${cyberwareDamageSpec(d.tier, d.range).text} ${cwEleName(d.element)} · ${d.break} 击破（不吃 atk）`,
    short: d => `${cwRangeName(d)} · ${cyberwareDamageSpec(d.tier, d.range).text} ${cwEleName(d.element)}`,
    tags: d => [cwRangeName(d), `${d.break} 击破`, "不吃 atk"],
    lines: d => [
      `对${cwReach(d)}一名敌人造成 ${cyberwareDamageSpec(d.tier, d.range).text} 点${cwEleName(d.element)}伤害、${d.break} 击破。伤害是固定的，不吃 atk（虚弱、振奋这类改 atk 的效果不影响）。`,
      "算一次攻击行动：属性克制、天气、格挡、飞行，以及挂在下一击上的效果照常结算。"
    ],
    roll: (d, rng) => ({ damage: cyberwareRollDamage(d.tier, d.range, rng), element: d.element, break: d.break, range: d.range }),
    run(u, d, ctx) {
      const t = ctx.t;
      if (!t || (t.isPlayer && !t.isStructure)) { ctx.lines.push(`先选「${d.name}」打哪一名敌人。`); return false; }
      const s = cyberwareDamageSpec(d.tier, d.range);
      ctx.lines.push(`${u.name} 发动义体「${d.name}」。`);
      ctx.hitOne(u, t, { atk: 0, mult: 0, flat: s.flat, diceN: s.dice.length, diceS: s.die.sides, diceB: s.dice.length * s.die.plus,
        element: d.element, baseBreak: d.break, atkRange: d.range, hits: 1 });
    }
  }
};

/** 正式目录：系列（line）× 等级（.vol1–.vol4）。名字是占位，改名 / 改属性只改这里；
 *  改名只改 name：line 是义体 id 的前缀（strike_v1……），存档里记的是 id，改了 line 旧存档装着的义体就认不出来了。
 *  加系列 = 加一行（种类要先在 CYBERWARE_KINDS 里有）。属性先都用物理（框架的默认值），别的属性加一行就有 */
const CYBERWARE_LINES = [
  { line: "strike", name: "打击义体", kind: "attack", range: "melee", element: "physical" },
  { line: "shot", name: "射击义体", kind: "attack", range: "ranged", element: "physical" }
];

/** 正式目录（启动时由 CYBERWARE_LINES 生成，见文件末尾） */
const CYBERWARE = {};
/** 示例（不是正式内容）：一件 5 级近战攻击义体 */
const CYBERWARE_EXAMPLES = {
  example_t5_melee: { id: "example_t5_melee", name: "【示例】5级近战攻击义体", example: true,
    tier: 5, kind: "attack", range: "melee", element: "physical", conflict: "arm", text: "示例条目，内容未设计。" }
};

const cwClone = v => JSON.parse(JSON.stringify(v));
function cwKind(d) { return (d && Object.prototype.hasOwnProperty.call(CYBERWARE_KINDS, d.kind) && CYBERWARE_KINDS[d.kind]) || {}; }
function cwEleName(el) { return (typeof ELE !== "undefined" && ELE[el]) || el || ""; }
function cwRangeName(d) { return CYBERWARE_RANGE_NAME[d.range] || d.range || ""; }
function cwReach(d) { return d.range === "ranged" ? "距离 1 的" : "同区的"; }

function cyberwareNormalize(def) {
  if (!def || !def.id) throw new Error("义体缺少 id");
  const tier = Number(def.tier);
  if (CYBERWARE_TIERS.indexOf(tier) < 0) throw new Error("义体等级只能是 5/10/15/20");
  const kind = def.kind || "attack";
  if (!Object.prototype.hasOwnProperty.call(CYBERWARE_KINDS, kind)) throw new Error("没有这种义体：" + kind);
  if (def.element && CYBERWARE_ELEMENTS.indexOf(def.element) < 0) throw new Error("未知属性：" + def.element);
  const t = CYBERWARE_TIER[tier];
  const d = Object.assign({ line: null, conflict: null,
    hpCut: t.hpCut, shpCut: t.shpCut, occupancy: t.occupancy, price: t.price, removePrice: t.removePrice,
    dailyShp: 0, fireShp: 0, usesPerShortRest: CYBERWARE_ACTIVE.usesPerShortRest, cost: cwClone(CYBERWARE_ACTIVE.cost) },
    cwClone(CYBERWARE_KINDS[kind].defaults || {}), def, { tier, kind, vol: CYBERWARE_VOL[tier] });
  if (typeof CYBERWARE_KINDS[kind].validate === "function") CYBERWARE_KINDS[kind].validate(d);
  return d;
}
function cyberwareRegister(def) { const d = cyberwareNormalize(def); CYBERWARE[d.id] = d; cwRegisterSkill(d); return d; }
function cyberwareLoadExamples() { Object.keys(CYBERWARE_EXAMPLES).forEach(k => cyberwareRegister(CYBERWARE_EXAMPLES[k])); return Object.keys(CYBERWARE_EXAMPLES); }
function cyberwareDef(id) { return Object.prototype.hasOwnProperty.call(CYBERWARE, id) ? cyberwareNormalize(CYBERWARE[id]) : null; }
function cyberwareCatalog() { return Object.keys(CYBERWARE).map(cyberwareDef); }
/** 系列表展开成一件件义体：id = <系列>_v<N>，名字 = <系列名>.volN（lineName 记系列名） */
function cyberwareLineDefs(lines) {
  return (lines || CYBERWARE_LINES).reduce((out, l) => out.concat(CYBERWARE_TIERS.map(tier => {
    const vol = CYBERWARE_VOL[tier];
    return Object.assign({}, l, { id: `${l.line}_v${vol}`, name: `${l.name}.vol${vol}`, lineName: l.name, tier });
  })), []);
}

/* ---- 伤害 ---- */
/** 档位伤害公式：{ flat, dice:[{sides,plus}], die, text, avg } */
function cyberwareDamageSpec(tier, range) {
  const n = Number(tier) / 5;
  const die = range === "ranged" ? CYBERWARE_ATTACK.ranged : CYBERWARE_ATTACK.melee;
  const dice = Array.from({ length: n }, () => Object.assign({}, die));
  const flat = n * CYBERWARE_ATTACK.flatPerStep;
  const text = die.plus ? `${flat} + ${n}×(d${die.sides}+${die.plus})` : `${flat} + ${n}d${die.sides}`;
  return { flat, dice, die: Object.assign({}, die), text, avg: flat + n * ((die.sides + 1) / 2 + die.plus) };
}
/** 掷一次伤害。rng() 返回 [0,1)。不吃 atk */
function cyberwareRollDamage(tier, range, rng) {
  rng = rng || Math.random;
  const s = cyberwareDamageSpec(tier, range);
  const rolls = s.dice.map(d => 1 + Math.floor(rng() * d.sides) + d.plus);
  return { total: s.flat + rolls.reduce((a, b) => a + b, 0), rolls, flat: s.flat };
}

/* ---- 改造率 ---- */
function cwIdOf(x) { return typeof x === "string" ? x : x && x.id; }
function cwList(u) { return ((u && u.cyberware) || []).map(x => cyberwareDef(cwIdOf(x))).filter(Boolean); }
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

/* ---- 坚毅消耗（最少留 1，不会致死）---- */
function cyberwareDrainShp(u, n) {
  n = Math.max(0, Number(n) || 0);
  if (!u || !n) return 0;
  const cur = Number(u.shp) || 0;
  const next = Math.max(Math.min(cur, CYBERWARE_SHP_FLOOR), cur - n);
  u.shp = next;
  return cur - next;
}
/** 每天的坚毅消耗（主持人 / 测试用数值，不进玩家视图） */
function cyberwareDailyCost(u) {
  return cwList(u).reduce((s, d) => s + d.dailyShp, 0) + cyberwareRate(u).overSteps;
}
/** 过一天（ledger.js 长休时调用）。返回实际扣掉的值 */
function cyberwareDayTick(u) { return cyberwareDrainShp(u, cyberwareDailyCost(u)); }

/* ---- 次数：每次短休 N 次 ----
 * 记在 LEDGER.shortOnce[kit]["cw:<id>"]（ledger.js · shortOnceUsed / useShortOnce），短休 / 长休刷新（守夜的人不刷新），
 * 跟着存档走；单局每场重新摆队伍、跑团重新开战都不会丢。没有队伍档案的规则环境才记在单位身上（u.cyberwareUsed）。
 * 拆掉再装回来不刷新（次数跟着这个人和这件义体）。 */
function cwUseKey(id) { return CYBERWARE_USE_KEY + id; }
function cwUsed(u, id) {
  if (u && u.kit && typeof shortOnceUsed === "function") return shortOnceUsed(u.kit, cwUseKey(id));
  return Number(((u && u.cyberwareUsed) || {})[id]) || 0;
}
function cwMarkUsed(u, d) {
  if (u.kit && typeof useShortOnce === "function") { useShortOnce(u.kit, cwUseKey(d.id), d.usesPerShortRest); return; }
  u.cyberwareUsed = Object.assign({}, u.cyberwareUsed || {});
  u.cyberwareUsed[d.id] = (Number(u.cyberwareUsed[d.id]) || 0) + 1;
}
function cyberwareUsesLeft(u, id) {
  const d = cyberwareDef(id); if (!d) return 0;
  return Math.max(0, d.usesPerShortRest - cwUsed(u, id));
}
/** 短休 / 长休：主动义体次数刷新（ledger.js 调；ledgerShortRest 本来就会整行清掉这个人的 LEDGER.shortOnce） */
function cyberwareShortRest(u) {
  if (!u) return;
  if (u.cyberwareUsed) u.cyberwareUsed = {};
  const row = u.kit && typeof LEDGER !== "undefined" && LEDGER.shortOnce ? LEDGER.shortOnce[u.kit] : null;
  if (row) Object.keys(row).filter(k => k.indexOf(CYBERWARE_USE_KEY) === 0).forEach(k => { delete row[k]; });
}

/* ---- 发动 ---- */
/** 现在不能发动的原因（能发动返回 null）：没装 / 短休前次数用完 / 种类自己的限制 */
function cwUseWhy(u, id) {
  if (!cwHas(u, id)) return "没有装这件义体";
  const d = cyberwareDef(id);
  if (cyberwareUsesLeft(u, id) <= 0) return "短休前不能再用";
  const k = cwKind(d);
  return typeof k.why === "function" ? (k.why(u, d) || null) : null;
}
/** 记一次发动：次数 + 发动的坚毅消耗（最少留 1）。返回实际扣掉的坚毅（只给主持人 / 测试看） */
function cwSpend(u, d) {
  cwMarkUsed(u, d);
  return cyberwareDrainShp(u, d.fireShp);
}
/** 不在战斗里发动（规则 / 测试用）：{ ok, error? } + 种类的 roll 结果（单体伤害型：damage:{total,rolls}, element, break, range） */
function cyberwareFire(u, id, rng) {
  const why = cwUseWhy(u, id);
  if (why) return { ok: false, error: why };
  const d = cyberwareDef(id), k = cwKind(d);
  const out = typeof k.roll === "function" ? k.roll(d, rng) : {};
  cwSpend(u, d);
  return Object.assign({ ok: true }, out);
}

/* ---- 战斗：装着的义体 = 技能 cw_<id> ---- */
/** 技能 id → 义体（有 run 的种类才是战斗技能）；不是义体技能返回 null */
function cyberwareOfSkill(skillId) {
  const s = String(skillId || "");
  if (s.indexOf(CYBERWARE_SKILL_PREFIX) !== 0) return null;
  const d = cyberwareDef(s.slice(CYBERWARE_SKILL_PREFIX.length));
  return d && typeof cwKind(d).run === "function" ? d : null;
}
/** 注册时把选目标的一边、射程登记进 engine.js 的两张表（和专长技能一样） */
function cwRegisterSkill(d) {
  const k = cwKind(d), sid = CYBERWARE_SKILL_PREFIX + d.id;
  if (typeof SKILL_TARGET_SIDE !== "undefined" && k.target) SKILL_TARGET_SIDE[sid] = k.target;
  const rg = typeof k.range === "function" ? k.range(d) : null;
  if (typeof SKILL_RANGE !== "undefined" && rg) SKILL_RANGE[sid] = rg;
}
function cwCostText(c) {
  c = c || {};
  const out = [];
  if (c.ap) out.push(`${c.ap} 行动点`);
  if (c.bonus) out.push(`${c.bonus} 附赠`);
  return out.join(" + ") || "不花行动";
}
function cwSummary(d) { const k = cwKind(d); return typeof k.summary === "function" ? k.summary(d) : (k.name || d.kind); }
/** 技能列表里的条目（party.js · skillList）：义体长在身上，空手也能用（bare）。说明里的坚毅消耗是固定的规则文字 */
function cyberwareSkills(u) {
  return cwList(u).filter(d => typeof cwKind(d).run === "function").map(d => ({
    id: CYBERWARE_SKILL_PREFIX + d.id, name: d.name,
    hint: `义体 · ${cwSummary(d)} · ${cwCostText(d.cost)}${d.fireShp ? ` · 发动消耗 ${d.fireShp} 点坚毅生命（最少留 ${CYBERWARE_SHP_FLOOR}）` : ""} · 短休前还能用 ${cyberwareUsesLeft(u, d.id)} 次`,
    bare: true, cyberware: true
  }));
}
function cyberwareSkillCost(skillId) { const d = cyberwareOfSkill(skillId); return d ? Object.assign({}, d.cost) : null; }
function cyberwareSkillWhy(u, skillId) { const d = cyberwareOfSkill(skillId); return d ? cwUseWhy(u, d.id) : null; }
/** 目标选错边在扣行动点之前拦下；还没选目标交给 run 里的「先选……」（画面靠它判断还要选目标） */
function cyberwareSkillTargetWhy(u, skillId, t, picks) {
  const d = cyberwareOfSkill(skillId);
  if (!d) return null;
  const k = cwKind(d);
  if (t && t.id && !t.isStructure && !t.kind) {
    if ((k.target === "ally" || k.target === "allySelf") && !t.isPlayer) return "只能对友方使用";
    if (k.target === "ally" && t.id === u.id) return "要选其他友方";
    if (k.target === "enemy" && t.isPlayer) return "只能对敌人使用";
  }
  return typeof k.targetWhy === "function" ? (k.targetWhy(u, d, t, picks || {}) || null) : null;
}
function cyberwareSkillSteps(u, skillId, picks) {
  const d = cyberwareOfSkill(skillId);
  if (!d) return [];
  const k = cwKind(d);
  return typeof k.steps === "function" ? (k.steps(u, d, picks || {}) || []) : [];
}
/** 战斗日志里的坚毅消耗：游戏版（app.js · shpHidden）只写一句固定的话，不写实际扣了多少（扣到 1 就扣不动，写数字会露出剩余值） */
function cwShpLossText(u, d, lost) {
  if (typeof shpHidden === "function" && shpHidden()) return `${u.name} 的义体消耗了一些坚毅生命（不会致死）。`;
  return `${u.name} 坚毅 −${lost}（义体发动消耗 ${d.fireShp}，最少留 ${CYBERWARE_SHP_FLOOR}，不会致死）。`;
}
/** 发动消耗是技能说明里写好的固定规则，不算这次行动的效果：在战斗画面的事件带上记一笔 selfCost，
 *  预演（game.js · previewOf）把它加回来——起身中的人坚毅扣到 1 就扣不动，按前后差写「伤到坚毅」会露出是不是只剩 1，
 *  打不出去的目标也会被当成有效果。只在本机：不进日志，联机发给玩家的事件带（online-view.js · projectTape）只放行弹字 */
function cwTapeSelfCost(u, lost) {
  if (lost > 0 && typeof window !== "undefined" && window.GAME && window.GAME.tape) window.GAME.tape.push({ type: "selfCost", unitId: u.id, shp: lost });
}
/** 结算一次发动（行动点已经由 app.js · runSkillInner 扣过）。run 返回 false = 没选好对象：不记次数、不扣坚毅 */
function runCyberwareSkill(u, skillId, ctx) {
  const d = cyberwareOfSkill(skillId);
  if (!d) return;
  if (cwKind(d).run(u, d, ctx) === false) return;
  const lost = cwSpend(u, d);
  cwTapeSelfCost(u, lost);
  if (d.fireShp) ctx.lines.push(cwShpLossText(u, d, lost));
}

/* ---- 诊所：安装 / 拆除 / 以新换旧 ---- */
function cwHas(u, id) { return cwList(u).some(d => d.id === id); }
/** 同一系列已经装着的那件：义体不能升级，换等级只能以新换旧 */
function cwSameLine(u, d) { return d && d.line ? cwList(u).find(x => x.line === d.line && x.id !== d.id) || null : null; }
/** 等级门槛（#315）：角色不到 CYBERWARE_UNLOCK_LEVEL 级时诊所不给装、不给拆，返回原因（够了返回 null）。
 *  只管诊所里的装 / 拆：已经装着的义体照常生效、照常每天消耗；opt.free（主持人免费安排）不看等级 */
function cyberwareLockWhy(u, opt) {
  if (opt && opt.free) return null;
  return (Number(u && u.level) || 1) < CYBERWARE_UNLOCK_LEVEL ? `${CYBERWARE_UNLOCK_LEVEL} 级解锁义体安装 / 拆除` : null;
}
/** 安装预览（玩家可见，不含坚毅数值）：{ ok, error, locked, cost, price, burden, warning, rateBefore, rateAfter, cap, overinstall,
 *  hpCut, conflictWith, replaces, replaceName, replaceCost }。
 *  locked：等级不够（cyberwareLockWhy），error 就是它的原因；改造率这些照样算好，诊所目录照常能看。
 *  replaces：同系列装着另一件时，这次是以新换旧——先拆掉它（cost 含它的拆除费），改造率按拆掉以后算 */
function cyberwareInstallPreview(u, id, opt) {
  const d = cyberwareDef(id);
  if (!d) return { ok: false, error: "没有这件义体" };
  if (cwHas(u, id)) return { ok: false, error: "已经装了" };
  const old = cwSameLine(u, d);
  const keep = cwList(u).filter(x => !old || x.id !== old.id);
  const clash = d.conflict ? keep.find(x => x.conflict === d.conflict) : null;
  const before = cyberwareRate(u), after = cyberwareRate(u, keep.concat([d]));
  const over = after.over > 1e-9;
  const lock = cyberwareLockWhy(u, opt);
  let error = null;
  if (lock) error = lock;
  else if (clash) error = `和「${clash.name}」冲突，不能同时安装`;
  else if (over && !cyberwareCanOverinstall(u)) error = "超出改造率上限（需要专长才能过度安装）";
  const burden = over ? "heavy" : (d.dailyShp || d.shpCut ? "strain" : "none");
  const replaceCost = old ? old.removePrice : 0;
  return { ok: !error, error, locked: !!lock, cost: d.price + replaceCost, price: d.price, id: d.id, name: d.name, tier: d.tier,
    rateBefore: pct(before.total), rateAfter: pct(after.total), cap: pct(after.cap), overinstall: over,
    hpCut: d.hpCut, conflictWith: clash ? clash.id : null, burden,
    replaces: old ? old.id : null, replaceName: old ? old.name : "", replaceCost,
    warning: burden === "none" ? "" : (burden === "heavy" ? "这会给身体带来极大负担。" : "这会给身体带来负担。") };
}
function pct(x) { return Math.round(x * 1000) / 10; }
/** 安装（以新换旧时连旧的一起拆掉）：purse = { kuizhi } 之类的钱包对象，key 默认 "kuizhi"；opt.free 免费（主持人），也不看等级门槛 */
function cyberwareInstall(u, id, purse, opt) {
  opt = opt || {};
  const pv = cyberwareInstallPreview(u, id, opt);
  if (!pv.ok) throw new Error(pv.error);
  const key = opt.key || "kuizhi";
  if (!opt.free) {
    if (!purse || (Number(purse[key]) || 0) < pv.cost) throw new Error("奎支不够");
    purse[key] -= pv.cost;
  }
  const hpBefore = cwFleshCap(u), shpBefore = Number(u.shp) || 0;
  u.cyberware = (u.cyberware || []).filter(x => !pv.replaces || cwIdOf(x) !== pv.replaces).concat([{ id }]);
  cwRefresh(u, hpBefore, shpBefore);
  return pv;
}
function cyberwareRemoveCost(u, id) { const d = cyberwareDef(id); return d ? d.removePrice : 0; }
/** 拆除：花钱，完全可逆（生命 / 坚毅上限还回来）；不到 5 级拆不了（cyberwareLockWhy，主持人 opt.free 不看等级） */
function cyberwareRemove(u, id, purse, opt) {
  opt = opt || {};
  if (!cwHas(u, id)) throw new Error("没有装这件义体");
  const lock = cyberwareLockWhy(u, opt);
  if (lock) throw new Error(lock);
  const cost = cyberwareRemoveCost(u, id), key = opt.key || "kuizhi";
  if (!opt.free) {
    if (!purse || (Number(purse[key]) || 0) < cost) throw new Error("奎支不够");
    purse[key] -= cost;
  }
  const hpBefore = cwFleshCap(u), shpBefore = Number(u.shp) || 0;
  u.cyberware = (u.cyberware || []).filter(x => cwIdOf(x) !== id);
  cwRefresh(u, hpBefore, shpBefore);
  return { cost };
}
/** 诊所的记录（rogue.js / trpg.js 共用）：安装，或者以新换旧 */
function cyberwareInstallNote(who, pv) {
  const warn = pv.warning || "";
  if (pv.replaces) return `${who} 以新换旧：拆掉「${pv.replaceName}」，装上「${pv.name}」，花掉 ${pv.cost} 奎支（拆除费 ${pv.replaceCost} + 新义体 ${pv.price}）。${warn}`;
  return `${who} 安装了义体「${pv.name}」，花掉 ${pv.cost} 奎支。${warn}`;
}
function cwFleshCap(u) { return cyberwareBaseHp(u) - cyberwareHpCut(u); }
/** 有血量层的单位：照 growth.js 重算；拆掉时把还回来的上限加到当前血量（同 PR #78 规则）。
 *  装上扣坚毅上限时 growth.js 按比例缩放当前坚毅：原来至少 1 的，缩放后也至少留 1（义体导致的坚毅损失不会致死） */
function cwRefresh(u, hpBefore, shpBefore) {
  if (u && u.layers && typeof applyLevelStats === "function") {
    applyLevelStats(u);
    const gain = cwFleshCap(u) - hpBefore;
    const inner = u.layers.find(l => l.inner) || u.layers[u.layers.length - 1];
    if (gain > 0 && inner && !u.cyberPlan) inner.current = Math.min(inner.max, (Number(inner.current) || 0) + gain);
  }
  if (u && shpBefore >= CYBERWARE_SHP_FLOOR && (Number(u.shp) || 0) < CYBERWARE_SHP_FLOOR) u.shp = CYBERWARE_SHP_FLOOR;
}

/* ---- 玩家视图（白名单，绝无坚毅数值）---- */
const CYBERWARE_BURDEN_TEXT = { none: "身体还算适应。", strain: "义体在持续消耗你的精神。", heavy: "身体承受着极大负担。" };
/** 一件义体给玩家看的字段：通用字段 + 种类自己的展示字段（facts） */
function cwPublic(d) {
  const k = cwKind(d);
  return Object.assign({ id: d.id, name: d.name, tier: d.tier, vol: d.vol, line: d.line || null, kind: d.kind, kindName: k.name || d.kind,
    summary: cwSummary(d), hpCut: d.hpCut, conflict: d.conflict, example: !!d.example },
    typeof k.facts === "function" ? k.facts(d) : {});
}
function cyberwareView(u) {
  const r = cyberwareRate(u);
  const list = cwList(u);
  const burden = r.overSteps > 0 ? "heavy" : (list.some(d => d.dailyShp) ? "strain" : "none");
  return {
    rate: pct(r.total), cap: pct(r.cap), cyberwareRate: pct(r.cyberware), layerRate: pct(r.layers),
    remainingHp: Math.floor(r.remainingHp + 1e-9), overinstall: r.over > 1e-9, canOverinstall: cyberwareCanOverinstall(u),
    locked: !!cyberwareLockWhy(u), unlockLevel: CYBERWARE_UNLOCK_LEVEL,   // 不到 5 级：诊所的装 / 拆按钮灰掉（#315）
    burden, burdenText: CYBERWARE_BURDEN_TEXT[burden],
    installed: list.map(d => Object.assign(cwPublic(d), { usesLeft: cyberwareUsesLeft(u, d.id), removeCost: d.removePrice }))
  };
}
/** 诊所目录（玩家可见）。replaces：装这件就是以新换旧（会先拆掉同系列的那件） */
function cyberwareShopView(u) {
  return cyberwareCatalog().map(d => {
    const pv = cyberwareInstallPreview(u, d.id);
    return Object.assign(cwPublic(d), { price: d.price, text: d.text || "", installed: cwHas(u, d.id),
      canInstall: !!pv.ok, error: pv.ok ? null : pv.error, locked: !!pv.locked, warning: pv.warning || "", rateAfter: pv.rateAfter,
      replaces: pv.replaces || null, replaceName: pv.replaceName || "", replaceCost: pv.replaceCost || 0 });
  });
}
/** 联机：房主算好再白名单（online-view.js · projectCyberware 再过一遍 scrubHidden） */
function cyberwarePacket(u) { return { kit: u && u.kit, view: cyberwareView(u), shop: cyberwareShopView(u) }; }

/* ---- 图鉴（codex.js · codexCyberwareEntries）：固定的规则文字，可以写坚毅生命的具体消耗；不碰任何角色当前的坚毅生命 ---- */
function cyberwareCodexInfo(d) {
  const k = cwKind(d);
  const samples = CYBERWARE_CODEX_HP.map(hp => ({ hp, rate: pct(d.hpCut / hp + d.occupancy) }));
  const sameLine = d.line ? cyberwareCatalog().filter(x => x.line === d.line) : [];
  const grit = [];
  if (d.fireShp) grit.push(`发动一次消耗 ${d.fireShp} 点坚毅生命。`);
  if (d.dailyShp) grit.push(`装着的每一天（每次长休算一天）消耗 ${d.dailyShp} 点坚毅生命。`);
  if (d.shpCut) grit.push(`坚毅生命上限 −${d.shpCut}（拆掉后还回来）。`);
  grit.push(`过度安装（超出改造率上限，要专长）：每超 ${pct(CYBERWARE_OVER_STEP)}%，每天再多消耗 1 点坚毅生命；拆掉就解除。`);
  grit.push(`义体扣坚毅生命最少留 ${CYBERWARE_SHP_FLOOR}，不会致死。`);
  const clinic = [`${CYBERWARE_UNLOCK_LEVEL} 级起可以在诊所安装 / 拆除。`, `在诊所安装：${d.price} 奎支；拆除：${d.removePrice} 奎支（花钱拆除，完全可逆）。`];
  if (sameLine.length > 1) clinic.push(`不能升级：「${d.lineName || d.line}」系列共 ${sameLine.length} 个等级，同时只能装其中一件；换等级要在诊所以新换旧（付旧的拆除费 + 新的价格）。`);
  clinic.push(d.conflict ? `冲突标签「${d.conflict}」：同标签的义体不能同时安装。` : "没有部位 / 槽位限制：装几件只看改造率。");
  return {
    kindName: k.name || d.kind,
    short: typeof k.short === "function" ? k.short(d) : cwSummary(d),
    tags: typeof k.tags === "function" ? k.tags(d) : [],
    effect: typeof k.lines === "function" ? k.lines(d) : [cwSummary(d)],
    use: `发动：${cwCostText(d.cost)}，每次短休 ${d.usesPerShortRest} 次（短休、长休后恢复）。`,
    rate: `占用改造率：固定 ${pct(d.occupancy)}% + 生命上限 −${d.hpCut} 按原生命上限折算（${samples.map(s => `原生命上限 ${s.hp} 时约 ${s.rate}%`).join("，")}）。和血量层改造共用上限（义体改造率）。`,
    rateSamples: samples, grit, clinic
  };
}

cyberwareLineDefs().forEach(cyberwareRegister);

if (typeof module !== "undefined" && module.exports) {
  module.exports = { CYBERWARE, CYBERWARE_EXAMPLES, CYBERWARE_TIER, CYBERWARE_TIERS, CYBERWARE_KINDS, CYBERWARE_LINES, cyberwareRegister, cyberwareLoadExamples,
    cyberwareDamageSpec, cyberwareRollDamage, cyberwareLineDefs };
}
