// 实战测试：四人队打一整局（四幕），用比朴素打法聪明的策略，记下每场战斗和整局的情况，顺便抓 bug。
//
//   node tools/playtest.js [种子] [队伍，逗号分隔]
//   例：node tools/playtest.js PLAY1 tou,yuito,xia,ruby
//
// 战斗策略：每次行动前，把能用的技能 × 目标（含分步选择）在一份状态副本上各预演一遍，
//   按「本场评分的增量 − 我方掉血 × 1.5 + 给敌人上的状态 × 6」打分，挑最高的；附赠动作没有明显收益时留着协助格挡。
//   够不着时朝敌人走一格。协助格挡挑成功率最高的人；协助攻击挑攻击力最高的人。
// 单局策略：能接支线且不耽误主线就接（挑每天报酬最高的），否则做主线；进战斗前血量低就先长休 / 短休；
//   休息点血量低长休、不低就直接走拿奎支；商店 / 休整补够两次长休的水和食物、一个维修包、两个医疗包；
//   余钱找工匠升武器（留 2500 应急）；诊所 / 休整时有人血量 < 70% 就治疗；检定派成功率最高的人，
//   会受伤的检定成功率低于 50% 就绕过去；升级时属性加在主属性，职责 / 熟练项选第一个。
"use strict";
const vm = require("vm");
const H = require("../tests/headless");

const SEED = process.argv[2] || "PLAYTEST";
const PARTY = (process.argv[3] || "tou,yuito,xia,ruby").split(",");
// 单人模式：node tools/playtest.js 种子 主角 伙伴1,伙伴2,伙伴3 [第二副职责]
const SOLO_PARTNERS = process.argv[4] ? process.argv[4].split(",") : null;
const SOLO_ROLE2 = process.argv[5] || null;
const c = H.load();
const st = () => c.S.state;
const R = c.Rogue;

// 在规则环境里做深拷贝（照 game.js · saveState / restoreState）
vm.runInContext(`
  var __clone = function deepClone(o, seen) {
    if (o === null || typeof o !== "object") return o;
    seen = seen || new WeakMap();
    if (seen.has(o)) return seen.get(o);
    if (Array.isArray(o)) { const a = []; seen.set(o, a); for (let i = 0; i < o.length; i++) a.push(deepClone(o[i], seen)); return a; }
    const proto = Object.getPrototypeOf(o);
    if (proto !== Object.prototype && proto !== null) return o;
    const out = {}; seen.set(o, out);
    for (const k of Object.keys(o)) out[k] = deepClone(o[k], seen);
    return out;
  };
  var __SKIP = ["roster", "history", "logPages", "floaters"];
  var __save = function () {
    const keys = Object.keys(state); const data = {};
    keys.forEach(k => { data[k] = __SKIP.includes(k) ? state[k] : __clone(state[k]); });
    return { keys, data, ledger: LEDGER.save(), rnd: Math.random };
  };
  var __restore = function (s) {
    Object.keys(state).forEach(k => { if (!s.keys.includes(k)) delete state[k]; });
    s.keys.forEach(k => { state[k] = s.data[k]; });
    LEDGER.load(s.ledger);
    Math.random = s.rnd;
  };
`, c);

/* ---------------- 记录 ---------------- */
const report = { battles: [], events: [], bugs: [], levelUps: [] };
const bug = (what, detail) => { report.bugs.push({ what, detail: String(detail || "").slice(0, 300), act: run && run.act, day: run && run.day }); };
const ev = (t) => report.events.push(`[第${run.act}幕 第${run.day}天] ${t}`);

/* ---------------- 战斗策略 ---------------- */
const hpOf = (u) => (u.layers || []).reduce((s, l) => s + Math.max(0, Number(l.current) || 0), 0);
const alive = (u) => u && !u.dead && !u.hidden && !u._removed;
function snapshotEval(onlyIds) {
  const s = st();
  let allyHp = 0, foeStatus = 0;
  s.units.forEach(u => {
    if (u.isPlayer && alive(u) && (!onlyIds || onlyIds.has(u.id))) allyHp += hpOf(u) + (u.dying ? -30 : 0);
    if (!u.isPlayer && alive(u) && u.statuses) foeStatus += Object.keys(u.statuses).filter(k => u.statuses[k] && k !== "latestElement").length;
  });
  // 评分里「用了行动点 / 附赠行动」的行动分不算收益（不然随便做点什么都划算）
  const bs = s.battleScore || { total: 0, parts: {} };
  // 危墙 / 桥梁 / 敌方配置物的耐久：打掉挡路的墙也算收益
  const structHp = Object.values(s.gaps || {}).reduce((a, g) => a + ((g && (g.type === "wall")) ? (Number(g.hp) || 0) : 0), 0)
    + (s.props || []).filter(p => p.faction === "enemy").reduce((a, p) => a + (Number(p.hp) || 0), 0);
  return { score: (bs.total || 0) - ((bs.parts && bs.parts.action) || 0), allyHp, foeStatus, structHp, foes: s.units.filter(u => !u.isPlayer && alive(u)).length };
}
/** 一个动作的价值：按「顺利」（骰子偏大、格挡没挡住）和「不顺」（骰子偏小、容易被挡）各预演一次取平均 */
function tryAction(thunk) {
  const hi = tryOnce(thunk, 0.95), lo = tryOnce(thunk, 0.3);
  if (hi <= -999 || lo <= -999) return -999;
  return (hi + lo) / 2;
}
function tryOnce(thunk, rnd) {
  const saved = c.__save();
  const ids = new Set(st().units.filter(u => u.isPlayer).map(u => u.id));   // 新唤出的武器人不算「回血」
  const before = snapshotEval(ids);
  let ok = true;
  vm.runInContext(`Math.random = () => ${rnd};`, c);
  try { thunk(); } catch (e) { ok = false; }
  const after = snapshotEval(ids);
  c.__restore(saved);
  if (!ok) return -999;
  return (after.score - before.score) + Math.min(0, after.allyHp - before.allyHp) * 1.5 + Math.max(0, after.allyHp - before.allyHp) * 0.5
    + (after.foeStatus - before.foeStatus) * 6 + (before.foes - after.foes) * 30 + (before.structHp - after.structHp) * 12;
}
function enumeratePicks(id, u, limit) {
  // 分步选择：深度优先，每一步最多试几个选项
  const out = [];
  const walk = (picks, depth) => {
    if (out.length >= limit || depth > 4) return;
    let steps = [];
    try { steps = c.skillFlowSteps(id, u, picks) || []; } catch (e) { steps = []; }
    const step = steps.find(s => picks[s.key] === undefined);
    if (!step) { out.push(Object.assign({}, picks)); return; }
    let vals = [];
    if (step.type === "zone") vals = (step.zones || []).slice();
    else if (step.type === "unit") vals = (step.units || []).map(x => x.id);
    else vals = (step.options || []).map(o => o.value);
    if (step.optional) vals.push(null);
    vals.slice(0, 6).forEach(v => walk(Object.assign({}, picks, { [step.key]: v }), depth + 1));
  };
  walk({}, 0);
  return out;
}
function run1(u, id, targetId, picks) {
  return () => {
    const s = st();
    s.attackerId = u.id; s.selectedId = u.id; s.targetId = targetId || null;
    if (picks && Object.keys(picks).length) s.skillFlow = { id, actorId: u.id, picks, index: 99 };
    try { c.runSkill(id); } finally { s.skillFlow = null; }
  };
}
function candidates(u) {
  const s = st();
  let list = [];
  try { list = c.skillList(u) || []; } catch (e) { bug("skillList 报错", e.message); return []; }
  const out = [];
  const foes = s.units.filter(x => !x.isPlayer && alive(x) && !x.untargetable);
  const allies = s.units.filter(x => x.isPlayer && alive(x));
  list.forEach(sk => {
    if (!sk || !sk.id || sk.id === "__item") return;
    if (/summon/.test(sk.id) && !process.env.SUMMON) return;   // 不主动唤出武器人：主角之后整场空手，一步预演看不出好坏（SUMMON=1 允许）
    const cost = c.skillCost(sk.id) || {};
    if ((cost.ap || 0) > (u.ap || 0) || (cost.bonus || 0) > (u.bonus || 0)) return;
    if (c.skillRequirementError(u, sk.id)) return;
    const flows = enumeratePicks(sk.id, u, 8);
    const hasFlow = flows.length && Object.keys(flows[0]).length;
    if (hasFlow) {
      flows.forEach(p => {
        const tid = p.target || p.target1 || p.target2 || null;
        out.push({ sk, cost, thunk: run1(u, sk.id, tid, p), label: `${sk.name}${tid ? "→" + ((c.unitById(tid) || {}).name || tid) : ""}` });
      });
      // 分步之后还要单独选目标的技能：再配一遍目标
      foes.slice(0, 6).forEach(f => out.push({ sk, cost, thunk: run1(u, sk.id, f.id, flows[0]), label: `${sk.name}→${f.name}` }));
    } else {
      out.push({ sk, cost, thunk: run1(u, sk.id, null, null), label: sk.name });
      foes.forEach(f => out.push({ sk, cost, thunk: run1(u, sk.id, f.id, null), label: `${sk.name}→${f.name}` }));
      // 危墙和敌方配置物也能打
      (c.structureTargets(u, 0, 1) || []).forEach(x => out.push({ sk, cost, thunk: run1(u, sk.id, x.id, null), label: `${sk.name}→${x.name}` }));
      allies.forEach(a => out.push({ sk, cost, thunk: run1(u, sk.id, a.id, null), label: `${sk.name}→${a.name}` }));
    }
  });
  return out;
}
const SMART = {
  name: "smart",
  act(u0) {
    // 预演会把场上单位换成副本：手里的对象一律按 id 重新取
    const id = u0.id;
    let u = c.unitById(id);
    if (u.dying && !c.isWeaponUnit(u)) return (Number(u.shp) || 0) > 0 && !u.upOnShp ? () => c.standUp(c.unitById(id)) : null;
    if (u.stunned) return null;
    const s = st();
    const foes = s.units.filter(x => !x.isPlayer && alive(x));
    if (!foes.length) return null;
    const cands = candidates(u);   // 先把候选列出来（这时 u 还是场上的那个）
    let best = null, bestV = 0;
    cands.forEach(cd => {
      const v = tryAction(cd.thunk);
      const usesBonusOnly = !cd.cost.ap && cd.cost.bonus;
      const need = usesBonusOnly ? 15 : 1;          // 附赠动作没明显收益就留着格挡
      if (v >= need && v > bestV) { bestV = v; best = cd; }
    });
    u = c.unitById(id);
    if (process.env.TRACE) console.error(`  T${st().turnNo} ${u.name} ap${u.ap} b${u.bonus} z${u.zone}: ` + (best ? `${best.label} (${Math.round(bestV)})` : "无") + `  [候选 ${cands.length}]`);
    if (best) { u._lastPlan = best.label; return best.thunk; }
    // 够不着：朝最近的敌人走一格（用附赠动作）
    if ((u.bonus || 0) > 0 && !u.noMove && (u.ap || 0) > 0) {
      const zm = Number(st().zoneMode) || 2;
      const near = st().units.filter(x => !x.isPlayer && alive(x)).slice().sort((a, b) => c.zoneDist(u.zone, a.zone, zm) - c.zoneDist(u.zone, b.zone, zm))[0];
      const d = c.zoneDist(u.zone, near.zone, zm);
      if (d >= 1) {
        const dest = Number(u.zone) + (Number(near.zone) > Number(u.zone) ? 1 : -1);
        return () => { const uu = c.unitById(id); st().attackerId = id; c.doMove(uu, dest); };
      }
    }
    return null;
  },
  pickBlocker(helpers, attacker, target) {
    return helpers.slice().sort((a, b) => c.finalBlockChance(b, attacker, target) - c.finalBlockChance(a, attacker, target))[0].id;
  },
  pickAssister(list) {
    return list.slice().sort((a, b) => (c.effectiveAtk(b, st().units) || 0) - (c.effectiveAtk(a, st().units) || 0))[0].id;
  }
};

/* ---------------- 单局策略 ---------------- */
let run;
const partyHpRatio = () => {
  const vs = run.party.map(h => R.heroView(run, h));
  return vs.reduce((a, v) => a + v.hp, 0) / Math.max(1, vs.reduce((a, v) => a + v.hpMax, 0));
};
const minHpRatio = () => Math.min(...run.party.map(h => { const v = R.heroView(run, h); return v.hp / Math.max(1, v.hpMax); }));
const kz = () => Number(st().kuizhi) || 0;
function tryDo(label, fn) {
  try { return fn(); } catch (e) { if (!/奎支不够|补给不足|不能|没有|已经|不够|用完/.test(e.message)) bug(`${label} 报错`, e.message); return null; }
}
function shopping() {
  if (!R.canShop(run)) return;
  const need = R.restPlan(run);
  const sup = R.supplies();
  // 两次长休的水和食物
  const waterNeed = (need.water || 3000) * 2;
  let guard = 0;
  while (R.supplies().water < waterNeed && kz() > 4000 + 1000 && guard++ < 10) tryDo("买水", () => R.buy(run, "water_5000", 1));
  const foodNeed = Object.values(need.food || {}).reduce((a, b) => a + b, 0) * 2 || 8;
  guard = 0;
  while (R.supplies().foodTotal < foodNeed && kz() > 300 + 1000 && guard++ < 20) tryDo("买食物", () => R.buy(run, "food_liquid", 1));
  if (c.bagCount("repair_kit") < 1 && kz() > 2500) tryDo("买维修包", () => R.buy(run, "repair_kit", 1));
  if (c.bagCount("medkit") < 2 && kz() > 2500) tryDo("买医疗包", () => R.buy(run, "medkit", 1));
  void sup;
}
function repairs() {
  R.brokenWeapons(run).forEach(w => {
    if (c.bagCount("repair_kit") < 1 && R.canShop(run) && kz() > 1000) tryDo("买维修包", () => R.buy(run, "repair_kit", 1));
    if (c.bagCount("repair_kit") > 0) tryDo("修武器", () => R.repairWeapon(run, w.kit));
  });
}
function clinic() {
  if (!R.canClinic(run)) return;
  run.party.forEach(h => {
    const v = R.heroView(run, h);
    const cost = R.healCost(run, h.kit);
    if (cost && v.hp / v.hpMax < 0.7 && kz() - cost > 2500) { tryDo("诊所治疗", () => R.healHero(run, h.kit)); ev(`诊所治疗 ${v.name}（${cost} 奎支）`); }
  });
}
function smithing() {
  const ids = R.presentSmiths(run) || [];
  ids.forEach(id => {
    const info = R.smithInfo(run, id);
    if (!info) return;
    if (info.needsIntro) tryDo("介绍工匠", () => R.introduceSmith(run, id));
    let guard = 0;
    while (guard++ < 6) {
      const opts = R.smithOptions(run, id).filter(o => !o.max && o.cost != null).sort((a, b) => a.level - b.level || a.cost - b.cost);
      const o = opts[0];
      if (!o || kz() - o.cost < 2500) break;
      const r = tryDo("升级武器", () => R.upgradeWeapon(run, o.kit, id));
      if (!r) break;
      ev(`在 ${info.name} 处把 ${o.name} 升到 Lv${o.level + 1}（${o.cost} 奎支）`);
    }
  });
}
const MAIN_ATTR = { tou: "con", yuito: "int", xia: "str", ruby: "int", hiaki: "str", chuan: "int", nora: "int", kolt: "str", helu: "int", ras: "int" };
function levelChoices() {
  let guard = 0;
  while (guard++ < 40) {
    const pend = R.pendingChoices(run);
    if (!pend.length) return;
    const p = pend[0];
    const opts = R.choiceOptions(run, p.kit, p.index);
    if (!opts.length) { bug("升级选择没有选项", JSON.stringify(p.choice)); return; }
    let pick = opts[0];
    if (p.choice.type === "attr") pick = opts.find(o => o.value === MAIN_ATTR[p.kit]) || opts.find(o => o.value === "con") || opts[0];
    tryDo("升级选择", () => R.choose(run, p.kit, p.index, pick.value));
    report.levelUps.push(`${R.heroName(p.kit)} ${p.choice.level} 级：${pick.label}`);
  }
}
function boardPick() {
  const avgLv = run.party.reduce((a, h) => a + (h.level || 1), 0) / Math.max(1, run.party.length);
  const side = (run.board || []).map((t, i) => ({ t, i }))
    .filter(x => !R.taskBlocked(run, x.t) && !R.taskWarning(run, x.t))
    // 精英支线（悬赏）：等级没高过敌人一截就不接
    .filter(x => !x.t.nodeTypes.includes("elite") || avgLv > R.enemyLevel(run, (x.t.diff || 0) + 1) + 1)
    .sort((a, b) => R.taskPay(run, b.t).kuizhi / b.t.days - R.taskPay(run, a.t).kuizhi / a.t.days);
  if (!run.main.done && R.daysLeft(run) - (side[0] ? side[0].t.days + run.CONFIG_restDays : 0) < run.main.days + 1) return "main";
  if (side.length) return side[0].i;
  return run.main.done ? null : "main";
}
function prepareFor(boss) {
  levelChoices();
  repairs();
  // 进战斗前只能短休（长休只在任务的休息点）：有人 < 80% 就短休
  if ((minHpRatio() < 0.8 || boss) && R.canShortRestBefore(run).ok) {
    tryDo("战前短休", () => R.shortRestBeforeNode(run));
  }
  levelChoices();
}
function fight(kind) {
  const spec = R.battleSpec(run);
  if (!spec) { bug("battleSpec 为空", kind); return "lose"; }
  c.BattleSim.setup(spec);
  const s = st();
  const foes0 = s.units.filter(u => !u.isPlayer).map(u => `${u.name} Lv${u.level}`);
  const partyBefore = run.party.map(h => { const v = R.heroView(run, h); return `${v.name} ${v.hp}/${v.hpMax}`; });
  const errs0 = c.__errors.length;
  let res, retreated = false;
  const foeHp0 = s.units.filter(u => !u.isPlayer).reduce((a, u) => a + hpOf(u), 0);
  try {
    // 一回合一回合打：局势崩了（有人倒地 / 血量低于 30%，敌人还剩一半以上的血）就撤退（首领战不能撤）
    for (let r = 1; r <= 25; r++) {
      res = c.BattleSim.run({ maxRounds: r, policy: SMART });
      if (res.winner !== "timeout") break;
      if (spec.retreat === false) continue;
      const heroes = s.units.filter(u => u.isPlayer && !c.isWeaponUnit(u) && alive(u));
      const bad = heroes.some(u => u.dying || u.upOnShp || hpOf(u) < 0.3 * c.baseMaxHp(u));
      const foeHp = s.units.filter(u => !u.isPlayer && alive(u)).reduce((a, u) => a + hpOf(u), 0);
      if (bad && foeHp > foeHp0 * 0.5) {
        const pv = c.retreatPreview();
        c.performRetreat();
        retreated = true;
        ev(`撤退（${pv.rule.name}）：${spec.title}，第 ${s.turnNo} 回合，敌人还剩 ${Math.round(foeHp / foeHp0 * 100)}% 血`);
        res = { winner: "retreat" };
        break;
      }
    }
  }
  catch (e) { bug("战斗中报错", e.stack || e.message); res = { winner: "lose" }; }
  if (c.__errors.length > errs0) bug("战斗中 console.error", c.__errors.slice(errs0).join(" | "));
  const outcome = res.winner === "player" ? "win" : res.winner === "timeout" || retreated ? "retreat" : "lose";
  if (res.winner === "timeout") {
    const dump = { zoneMode: s.zoneMode, gaps: s.gaps, props: (s.props || []).map(p => p.name + "@" + p.zone + " hp" + p.hp),
      fields: Object.keys(s.fields || {}).map(z => z + ":" + Object.keys(s.fields[z]).filter(k => s.fields[z][k]).join("/")),
      units: s.units.filter(alive).map(u => `${u.name}${u.isPlayer ? "(我)" : ""} z${u.zone} hp${hpOf(u)} ${u.flying ? "飞" : ""} ap${u.ap} b${u.bonus}${u.stunned ? " 晕" : ""}${u.dying ? " 濒死" : ""}`) };
    bug("战斗超过 25 回合没打完（按撤退处理）", `${spec.title} ${foes0.join("、")} ` + JSON.stringify(dump));
    if (process.env.DUMP) require("fs").writeFileSync(process.env.DUMP, JSON.stringify({ spec, log: (s.logPages || []).slice(-3).map(p => p.lines.map(l => l.text || l).join("\n")) }, null, 1));
  }
  if (outcome === "win") c.applyFinishBonus();
  const g = c.battleGrade();
  // 日志里的可疑字样
  const text = (s.logPages || []).map(p => (p.lines || []).map(l => l.text || l).join("\n")).join("\n");
  const sus = text.split("\n").filter(t => /NaN|undefined|\[object Object\]/.test(t));
  if (sus.length) bug("战斗日志里有 NaN / undefined", sus.slice(0, 3).join(" | "));
  const xpBefore = run.party.map(h => h.level);
  const stats = Object.values(s.battleStats || {}).filter(x => !x.weaponOf).map(x => `${x.name} 伤${x.dmg}/破${x.brk}/承${x.taken}/杀${x.kills}/疗${x.heal}`);
  const turns = s.turnNo, score = s.battleScore.total;   // 结算会重摆战场（升级重算血量），先记下
  const supports = (text.match(/支援登场|登场支援|支援：/g) || []).length;
  const selfAssist = (text.match(/协助攻击/g) || []).length, selfBlock = (text.match(/协助格挡成功|格挡成功/g) || []).length;
  let notes = [];
  try { notes = R.finishBattle(run, outcome); } catch (e) { bug("finishBattle 报错", e.stack || e.message); }
  report.battles.push({
    act: run.act, day: run.day, kind, title: spec.title, level: spec.level, foes: foes0, weather: s.weather,
    outcome, turns, score, grade: g.grade, partyBefore,
    partyAfter: run.party.map(h => { const v = R.heroView(run, h); return `${v.name} ${v.hp}/${v.hpMax}`; }),
    stats, supports, selfAssist, selfBlock, supportUsed: s.solo ? (s.solo.used || []).slice() : null, deaths: notes.filter(n => /永久死亡|阵亡/.test(n)), lvUp: run.party.filter((h, i) => h.level > (xpBefore[i] || 0)).map(h => `${R.heroName(h.kit)}→${h.level}`)
  });
  return outcome;
}

/* ---------------- 调试：TOKENS=n 把普通战斗的敌人代币改成 n（精英战、首领不变），用来试平衡 ---------------- */
if (process.env.TOKENS) {
  vm.runInContext(`(function () {
    const orig = rollEncounter;
    rollEncounter = function (opt) { opt = Object.assign({}, opt || {}); if (opt.tokens == null) opt.tokens = ${Number(process.env.TOKENS)}; return orig(opt); };
  })();`, c);
}

/* ---------------- 主循环 ---------------- */
if (SOLO_PARTNERS) {
  const role2 = SOLO_ROLE2 || R.role2Options(PARTY[0])[0];
  run = R.newRun({ party: [PARTY[0]], seed: SEED, solo: true, partners: SOLO_PARTNERS, role2 });
} else {
  run = R.newRun({ party: PARTY, seed: SEED });
}
if (process.env.BOSSTEST) {
  // 调试：直接打某一幕的首领。BOSSTEST=幕:角色等级
  const [act, lv] = process.env.BOSSTEST.split(":").map(Number);
  run.act = act; run.actDay = 8; run.stage = "boss";
  run.party.forEach(h => { h.level = lv; Object.keys(h.weaponLevels).forEach(k => { h.weaponLevels[k] = Math.max(1, Math.round(lv * 0.6)); }); });
  const r = fight("boss");
  const b = report.battles[0];
  console.log(JSON.stringify(b, null, 1));
  process.exit(0);
}
if (process.env.ARENA) {
  // 调试：竞技场。ARENA=幕:等级:场数 —— 把队伍直接拉到这个等级（升级选择照常做完、武器升到 等级×0.6），
  // 满血连打普通战斗、精英战和首领战各若干场，统计胜率
  const [act, lv, n] = process.env.ARENA.split(":").map(Number);
  run.act = act; run.actDay = 4;
  run.party.forEach(h => {
    const from = h.level || 1;
    h.level = lv; h.xp = 0;
    R.queueLevelRewards(h, from, lv, [], run);
    Object.keys(h.weaponLevels).forEach(k => { h.weaponLevels[k] = Math.max(1, Math.round(lv * 0.6)); });
  });
  levelChoices();
  const fullHp = () => run.party.forEach(h => { h.hp = null; h.shp = null; });
  const tally = {};
  for (const kind of ["battle", "elite", "boss"]) {
    tally[kind] = { win: 0, lose: 0, retreat: 0, turns: 0 };
    for (let i = 0; i < n; i++) {
      fullHp();
      run.stage = kind === "boss" ? "boss" : "task";
      run.seed = SEED + ":" + kind + i;
      run.result = null;
      if (kind !== "boss") { tryDo("接任务", () => R.acceptTask(run, "main")); run.stage = "task"; run.task.nodes[run.task.index] = { type: kind, done: false }; }
      run.actDay = 4; run.act = act;
      run.party.forEach(h => { h.level = lv; });
      const o = fight(kind);
      tally[kind][o] += 1;
      tally[kind].turns += report.battles[report.battles.length - 1].turns;
      if (run.stage === "over") { run.stage = "task"; delete run.result; }
      if (!run.party.length) break;
    }
  }
  const v = R.heroView(run, run.party[0]);
  console.log(`ARENA 第${act}幕 Lv${lv}（${run.party.map(h => R.heroName(h.kit)).join("、")}${run.solo ? "，单人" : ""}，血量上限 ${v.hpMax}）：` +
    Object.keys(tally).map(k => `${k} 胜${tally[k].win}/败${tally[k].lose}/撤${tally[k].retreat}（平均 ${(tally[k].turns / n).toFixed(1)} 回合）`).join("；"));
  if (report.bugs.length) console.log("bugs: " + report.bugs.map(b => b.what + "：" + b.detail).join(" | "));
  process.exit(0);
}
run.CONFIG_restDays = R.CONFIG.restDays;
ev(`出发：${PARTY.map(R.heroName).join("、")}，种子 ${SEED}`);
let steps = 0;
const T0 = Date.now();
while (run.stage !== "over" && steps++ < 2000) {
  levelChoices();
  const stage = run.stage;
  if (stage === "board") {
    shopping(); clinic(); smithing();
    const w = boardPick();
    if (w == null) { bug("任务板上没有能接的任务", JSON.stringify((run.board || []).map(t => t.name))); break; }
    tryDo("接任务", () => R.acceptTask(run, w));
    ev(`接下${w === "main" ? "主线" : "支线「" + run.task.name + "」"}：${run.task.nodes.map(n => (R.CONFIG && c.S.ROGUE_NODE_TYPES[n.type] || {}).label || n.type).join(" → ")}`);
  } else if (stage === "task") {
    const node = R.currentNode(run);
    if (!node) { bug("任务里没有当前节点", run.task && run.task.index); break; }
    if (node.type === "battle" || node.type === "elite") {
      prepareFor(false);
      fight(node.type);
    } else if (node.type === "rest" && run.ambush) {
      levelChoices();
      ev("休息点长休时被偷袭：遭遇战");
      fight("ambush");
    } else if (node.type === "rest") {
      levelChoices();
      // 被偷袭的概率高了（≥ 30%）就安排血最多的人守夜
      const watch = R.ambushChance(run) >= 0.3
        ? run.party.slice().sort((a, b) => R.heroView(run, b).hp / R.heroView(run, b).hpMax - R.heroView(run, a).hp / R.heroView(run, a).hpMax)[0].kit
        : null;
      if (R.canLongRest(run)) tryDo("休息点长休", () => R.restAtNode(run, "long", { watch }));
      else if (partyHpRatio() < 0.85) tryDo("休息点短休", () => R.restAtNode(run, "short"));
      else tryDo("休息点离开", () => R.restAtNode(run, "leave"));
    } else if (node.type === "shop") {
      shopping(); repairs(); tryDo("离开商店", () => R.leaveNode(run));
    } else if (node.type === "smith") {
      smithing(); repairs(); tryDo("离开工匠", () => R.leaveNode(run));
    } else if (node.type === "clinic") {
      clinic(); tryDo("离开诊所", () => R.leaveNode(run));
    } else if (node.type === "check") {
      const info = R.checkInfo(run);
      const best = run.party.map(h => R.checkOdds(run, h.kit)).sort((a, b) => b.chance - a.chance)[0];
      if (best && best.chance && (!info.injure || best.chance >= 0.5)) {
        const notes = tryDo("检定", () => R.attemptCheck(run, best.kit)) || [];
        ev(`${info.diffName}「${info.prof}」检定 → ${best.name}（${Math.round(best.chance * 100)}%）：${/成功/.test(notes[0] || "") && !/失败/.test(notes[0] || "") ? "成功" : "失败"}`);
      } else { tryDo("绕过检定", () => R.skipCheck(run)); ev(`${info.diffName}「${info.prof}」检定：绕过（最好的成功率 ${best ? Math.round(best.chance * 100) : 0}%）`); }
    } else { bug("没见过的节点", node.type); tryDo("离开", () => R.leaveNode(run)); }
  } else if (stage === "camp") {
    shopping(); repairs(); clinic(); smithing(); levelChoices();
    tryDo("休整", () => R.camp(run));
  } else if (stage === "boss") {
    shopping(); repairs(); prepareFor(true);
    ev(`迎战第 ${run.act} 幕首领`);
    fight("boss");
  } else if (stage === "interlude") {
    ev(`第 ${run.act} 幕结束`);
    tryDo("下一幕", () => R.nextAct(run));
  } else if (stage === "victory") {
    ev("四幕通关！");
    tryDo("收手", () => R.afterVictory(run, false));
    break;
  } else { bug("没见过的阶段", stage); break; }
}
if (steps >= 2000) bug("主循环超过 2000 步", run.stage);

/* ---------------- 汇报 ---------------- */
const out = [];
out.push(`# 实战测试：${run.solo ? `单人模式 ${R.heroName(PARTY[0])}，伙伴 ${run.partners.map(R.heroName).join("、")}，第二副职责 ${run.party[0].role2}` : PARTY.map(R.heroName).join("、")}（种子 ${SEED}）`);
out.push(`结果：${run.result ? (run.result.win ? "通关" : "失败") + " — " + run.result.text : run.stage}；第 ${run.act} 幕第 ${run.day} 天；用时 ${Math.round((Date.now() - T0) / 1000)} 秒`);
out.push(`队伍：` + run.party.map(h => { const v = R.heroView(run, h); return `${v.name} Lv${v.level} 血${v.hp}/${v.hpMax} 武器${v.weapons.map(w => w.name + "Lv" + w.level).join("、")}`; }).join("；"));
if ((run.fallen || []).length) out.push(`阵亡：${run.fallen.map(f => R.heroName(f.kit) + "（第" + f.act + "幕第" + f.day + "天）").join("、")}`);
out.push(`奎支 ${kz()}，水 ${R.supplies().water} ml，食物 ${R.supplies().foodTotal}`);
out.push("\n## 战斗");
report.battles.forEach((b, i) => {
  out.push(`${i + 1}. 第${b.act}幕第${b.day}天 ${b.title}（Lv${b.level}${b.weather && b.weather !== "none" ? "，" + b.weather : ""}）：${b.foes.join("、")} → ${b.outcome === "win" ? "胜" : b.outcome === "retreat" ? "撤退/超时" : "败"}，${b.turns} 回合，${b.score} 分 ${b.grade}`);
  out.push(`   战前 ${b.partyBefore.join("，")}　战后 ${b.partyAfter.join("，")}${b.lvUp.length ? "　升级 " + b.lvUp.join("、") : ""}${b.deaths.length ? "　" + b.deaths.join("；") : ""}`);
  out.push(`   ${b.stats.join("；")}${b.supportUsed ? `　支援 ${b.supportUsed.length ? b.supportUsed.map(R.heroName).join("、") : "无"}；协助攻击字样 ${b.selfAssist}、格挡成功字样 ${b.selfBlock}` : ""}`);
});
out.push("\n## 过程");
report.events.forEach(e => out.push("- " + e));
out.push("\n## 升级选择");
out.push(report.levelUps.join("；"));
out.push("\n## 可疑问题 / bug");
if (!report.bugs.length) out.push("（没有）");
const seen = new Set();
report.bugs.forEach(b => { const k = b.what + b.detail; if (seen.has(k)) return; seen.add(k); out.push(`- [第${b.act}幕第${b.day}天] ${b.what}：${b.detail}`); });
console.log(out.join("\n"));
