/* =========================================================
 * 专长（手册 · 角色升级：9 / 13 / 16 / 19 级各得一项）
 * ---------------------------------------------------------
 * 和 DnD 的专长一样：不限职责和属性，谁都能选。一项专长可以是
 *   passive  被动：hooks.apply(u) 上场时改数值；也可以挂别的钩子
 *   action   战斗中的新动作：skill = { name, hint, cost, uses, bare, steps, why, targetWhy, run }
 *            技能 id 自动是 "feat_<专长 id>"，会出现在技能列表里，按 cost 扣行动点 / 附赠行动
 *   explore  探索：hooks.check(h, perks, ctx) 改熟练项检定（重掷、优势、失败减伤……）
 * 一项专长可以同时带几种效果（kind 只决定在选择界面里怎么归类）。
 *
 * 一条专长：
 *   { id, name, kind, text,
 *     repeatable: false,         // true：可以重复选，效果叠加（每选一次 u.feats 里多一条）
 *     requires(h) → "原因" | null, // 前置条件（可选）：返回原因就不出现在选项里
 *     hooks: { apply(u), battleStart(u, _, notes), roundStart(u, _, notes), check(h, perks, ctx) },
 *     skill: { … } }
 * 钩子（featHook）：都是 fn(u, value, ctx)，按 u.feats 里的顺序挨个调用，返回值不是 undefined 就接着往下传。
 *   apply        growth.js · applyLevelStats：属性、等级算完之后（每次都从头重算，所以直接改 u 的数值不会叠加）
 *   battleStart  app.js · startCombat：开战时（我方每名角色一次）
 *   roundStart   app.js · beginRound：每回合开始
 *   check        rogue.js · checkOdds：熟练项检定的优势 / 劣势 / 重掷（perks 见 party.js · checkPerksFor）
 * 战斗动作（skill）：
 *   cost         { ap: 1 } / { bonus: 1 } / {}（不耗行动），默认 1 行动点
 *   uses         每场战斗能用几次（不写就不限）
 *   steps(a, picks)    分步选择（同 app.js · skillFlowSteps 的格式），可选
 *   why(a)             现在不能用的原因，可选
 *   targetWhy(a, t, picks)  目标不合法的原因（扣点前拦下），可选
 *   run(a, ctx)        结算：ctx = { t, picks, lines, hitOne }，把战斗记录 push 进 lines
 *
 * FEATS 现在是空的：具体专长等策划写进来。空着的时候升级只记下「欠一项专长」，
 * 写进内容以后自动变成升级选择（旧存档里欠着的也会补成待选，见 rogue.js · settleOwedFeats）。
 * ========================================================= */

const FEATS = {};

const FEAT_KIND_NAME = { passive: "被动", action: "战斗动作", explore: "探索" };
const FEAT_SKILL_PREFIX = "feat_";

function featDef(id) {
  return Object.prototype.hasOwnProperty.call(FEATS, id) ? FEATS[id] : null;
}
/** 有没有任何专长可选（没有就继续只记欠账） */
function featsReady() {
  return Object.keys(FEATS).length > 0;
}
/** 身上的专长（u 可以是战斗单位，也可以是单局里的角色档案 h：都读 .feats） */
function featIds(u) {
  return ((u && u.feats) || []).filter(id => featDef(id));
}
function featCount(u, id) {
  return featIds(u).filter(x => x === id).length;
}
/** 这名角色现在能选的专长（不能重复的已经有了就不列；前置条件不满足也不列） */
function featChoicesFor(h) {
  return Object.keys(FEATS).filter(id => {
    const f = FEATS[id];
    if (!f.repeatable && featCount(h, id) > 0) return false;
    if (typeof f.requires === "function" && f.requires(h)) return false;
    return true;
  });
}
/** 按身上的专长依次调用某个钩子；返回值不是 undefined 就作为新的 value 往下传 */
function featHook(u, name, value, ctx) {
  featIds(u).forEach(id => {
    const fn = (FEATS[id].hooks || {})[name];
    if (typeof fn !== "function") return;
    const out = fn(u, value, ctx);
    if (out !== undefined) value = out;
  });
  return value;
}

/* ---------- 战斗动作 ---------- */
function featOfSkill(skillId) {
  const s = String(skillId || "");
  if (s.indexOf(FEAT_SKILL_PREFIX) !== 0) return null;
  const f = featDef(s.slice(FEAT_SKILL_PREFIX.length));
  return f && f.skill ? f : null;
}
function featSkillCost(skillId) {
  const f = featOfSkill(skillId);
  return f ? Object.assign({}, f.skill.cost || { ap: 1 }) : null;
}
function featUsesLeft(u, f) {
  if (!f.skill.uses) return Infinity;
  const used = Number((((u && u.resources) || {}).featUsed || {})[f.id]) || 0;
  return Math.max(0, f.skill.uses * Math.max(1, featCount(u, f.id)) - used);
}
/** 技能列表里的条目（party.js · skillList） */
function featSkills(u) {
  const seen = {};
  return featIds(u).filter(id => FEATS[id].skill && !seen[id] && (seen[id] = true)).map(id => {
    const f = FEATS[id];
    const left = featUsesLeft(u, f);
    const usesText = left === Infinity ? "" : ` · 本场剩 ${left} 次`;
    return { id: FEAT_SKILL_PREFIX + id, name: f.skill.name || f.name, hint: `专长 · ${f.skill.hint || f.text || ""}${usesText}`,
      bare: !!f.skill.bare, feat: true };
  });
}
function featSkillWhy(a, skillId) {
  const f = featOfSkill(skillId);
  if (!f) return null;
  if (featCount(a, f.id) <= 0) return "没有这项专长";
  if (featUsesLeft(a, f) <= 0) return "本场次数已用完";
  return typeof f.skill.why === "function" ? (f.skill.why(a) || null) : null;
}
function featSkillTargetWhy(a, skillId, t, picks) {
  const f = featOfSkill(skillId);
  return f && typeof f.skill.targetWhy === "function" ? (f.skill.targetWhy(a, t, picks || {}) || null) : null;
}
function featSkillSteps(a, skillId, picks) {
  const f = featOfSkill(skillId);
  return f && typeof f.skill.steps === "function" ? (f.skill.steps(a, picks || {}) || []) : [];
}
/** 结算一次专长动作（行动点已经由 runSkillInner 扣过） */
function runFeatSkill(a, skillId, ctx) {
  const f = featOfSkill(skillId);
  if (!f) return;
  if (f.skill.uses) {
    a.resources = a.resources || {};
    a.resources.featUsed = Object.assign({}, a.resources.featUsed || {});
    a.resources.featUsed[f.id] = (Number(a.resources.featUsed[f.id]) || 0) + 1;
  }
  if (typeof f.skill.run === "function") f.skill.run(a, ctx);
}

/** 资料面板 / 选择界面用的一行说明 */
function featLabel(id) {
  const f = featDef(id);
  return f ? `${f.name}（${FEAT_KIND_NAME[f.kind] || "专长"}）` : id;
}
