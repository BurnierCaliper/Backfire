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

const B = require("./balance-common");
/** 任务板怎么接（自动策略）。返回 { pick: "main" | 任务下标 | null, fallback: 兜底接下的任务名 }
 *  R = Rogue 接口；单独拿出来是为了能直接测兜底分支（固定种子不一定走得到） */
function pickBoardTask(R, run) {
  const avgLv = run.party.reduce((a, h) => a + (h.level || 1), 0) / Math.max(1, run.party.length);
  const legal = (run.board || []).map((t, i) => ({ t, i }))
    .filter(x => !R.taskBlocked(run, x.t) && !R.taskWarning(run, x.t))
    .sort((a, b) => R.taskPay(run, b.t).kuizhi / b.t.days - R.taskPay(run, a.t).kuizhi / a.t.days);
  const side = legal
    // 精英支线（悬赏）：等级没高过敌人一截就不接
    .filter(x => !(x.t.nodeTypes.includes("elite") || x.t.hunt) || avgLv > R.enemyLevel(run, (x.t.diff || 0) + 1) + 1)   // 悬赏路线不预先给出，最后照样是精英战
    .sort((a, b) => R.taskPay(run, b.t).kuizhi / b.t.days - R.taskPay(run, a.t).kuizhi / a.t.days);
  if (!run.main.done && R.daysLeft(run) - (side[0] ? side[0].t.days + run.CONFIG_restDays : 0) < run.main.days + 1) return { pick: "main" };
  if (side.length) return { pick: side[0].i };
  // Once the main task is complete there is no legal "wait for boss" API on
  // the board. A danger preference must not erase the remaining legal actions.
  // Accept the best-paying legal side task and let the normal camp/boss flow run.
  if (run.main.done && legal.length) return { pick: legal[0].i, fallback: legal[0].t.name };
  return { pick: run.main.done ? null : "main" };
}

function runCampaign(options = {}) {
const SEED = options.seed || "PLAYTEST";
const env = options.env || {};
const maxRounds = B.positiveInt(options.maxRounds || 25, "maxRounds");
const maxSteps = B.positiveInt(options.maxSteps || 2000, "maxSteps");
const PARTY = options.party || ["tou", "yuito", "xia", "ruby"];
// 单人模式：node tools/playtest.js 种子 主角 伙伴1,伙伴2,伙伴3 [第二副职责]
const SOLO_PARTNERS = options.partners || null;
const SOLO_ROLE2 = options.role2 || null;
B.validateParty(PARTY, !!SOLO_PARTNERS);
const c = H.load();
c.S.RNG.install(SEED + ":campaign");
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
const report = { suite: "campaign", id: options.id || SEED, set: options.set || "adhoc", seed: SEED, party: PARTY.slice(), startingSize: PARTY.length, strategy: B.STRATEGIES.campaign.version, strategyDetails: B.STRATEGIES.campaign.description, diagnostics: { summon: !!env.SUMMON, tokens: env.TOKENS || null, bossTest: env.BOSSTEST || null, arena: env.ARENA || null }, maxRounds, maxSteps, battles: [], events: [], bugs: [], levelUps: [], reachedActs: [1] };
let terminalOutcome = null;
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
  // Candidate previews must not append to the real battle log retained by __save.
  // A fresh temporary page avoids cloning the entire growing log for every action.
  st().logPages = [{ turn: st().turnNo, lines: [] }];
  st().logIndex = 0;
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
    if (/summon/.test(sk.id) && !env.SUMMON) return;   // 不主动唤出武器人：主角之后整场空手，一步预演看不出好坏（SUMMON=1 允许）
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
    if (env.TRACE) console.error(`  T${st().turnNo} ${u.name} ap${u.ap} b${u.bonus} z${u.zone}: ` + (best ? `${best.label} (${Math.round(bestV)})` : "无") + `  [候选 ${cands.length}]`);
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
  try { return fn(); } catch (e) { bug(`${label} 报错`, e.message); throw e; }
}
function shopping() {
  if (!R.canShop(run)) return;
  const need = R.restPlan(run);
  const sup = R.supplies();
  // 两次长休的水和食物
  const waterNeed = (need.water || 3000) * 2;
  let guard = 0;
  while (R.supplies().water < waterNeed && kz() > 4000 + 1000 && guard++ < 10) tryDo("买水", () => R.buy(run, ["water_5000", "water_1000"].find(k => R.shopStock(run).some(r => r.key === k)) || "water_500", 1));
  const foodNeed = Object.values(need.food || {}).reduce((a, b) => a + b, 0) * 2 || 8;
  guard = 0;
  while (R.supplies().foodTotal < foodNeed && kz() > 300 + 1000 && guard++ < 20) tryDo("买食物", () => R.buy(run, "food_liquid", 1));
  // 商店每家随机进货：没有的就不买
  const inStock = (key) => R.shopStock(run).some(r => r.key === key);
  if (c.repairPoints() < 10 && kz() > 2500 && inStock("repair_kit")) tryDo("买维修包", () => R.buy(run, "repair_kit", 1));
  if (c.bagCount("medkit") < 2 && kz() > 2500 && inStock("medkit")) tryDo("买医疗包", () => R.buy(run, "medkit", 1));
  void sup;
}
function repairs() {
  R.brokenWeapons(run).forEach(w => {
    if (c.repairPoints() < 10 && R.canShop(run) && kz() > 1000 && R.shopStock(run).some(r => r.key === "repair_kit")) tryDo("买维修包", () => R.buy(run, "repair_kit", 1));
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
const MAIN_ATTR = { tou: "con", yuito: "int", xia: "str", ruby: "int", hiaki: "str", chuan: "int", nora: "int", kolt: "str", helu: "int", ras: "int", longge: "int" };
function levelChoices() {
  let guard = 0;
  while (guard++ < 40) {
    const pend = R.pendingChoices(run);
    if (!pend.length) return;
    const p = pend[0];
    const opts = R.choiceOptions(run, p.kit, p.index);
    if (!opts.length) throw new Error("升级选择没有选项：" + JSON.stringify(p.choice));
    let pick = opts[0];
    if (p.choice.type === "attr") pick = opts.find(o => o.value === MAIN_ATTR[p.kit]) || opts.find(o => o.value === "con") || opts[0];
    tryDo("升级选择", () => R.choose(run, p.kit, p.index, pick.value));
    report.levelUps.push(`${R.heroName(p.kit)} ${p.choice.level} 级：${pick.label}`);
  }
}
function boardPick() {
  const r = pickBoardTask(R, run);
  if (r.fallback) ev("常规偏好没有可选任务，按合法任务兜底：" + r.fallback);
  return r.pick;
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
  if (!spec) throw new Error("battleSpec 为空：" + kind);
  c.BattleSim.setup(spec);
  const s = st(), act = run.act, day = run.day;
  const before = B.fieldSnapshot(c), heroStateBefore = B.heroSnapshot(c, run);
  const row = { act, day, kind, title: spec.title, level: spec.level, battleSeed: spec.seed, seed: SEED, startingSize: PARTY.length, survivingHeroes: before.filter(u => u.isPlayer && !u.weaponOf && !u.dead).length, party: run.party.map(h => h.kit), strategy: report.strategy, actualUnitsBefore: before, heroStateBefore, foes: before.filter(u => !u.isPlayer).map(u => u.name + " Lv" + u.level), partyBefore: heroStateBefore.map(h => h.kit + " " + h.hp + "/" + h.hpMax), weather: s.weather, terrain: B.clone({ zoneMode: s.zoneMode, gaps: s.gaps, props: s.props, encounter: spec.encounter }), economyBefore: { kuizhi: kz(), supplies: B.clone(R.supplies()) } };
  report.battles.push(row);
  const errs0 = c.__errors.length;
  const foeHp0 = s.units.filter(u => !u.isPlayer).reduce((a, u) => a + hpOf(u), 0);
  let res;
  try {
    for (let round = 1; round <= maxRounds; round++) {
      res = c.BattleSim.run({ maxRounds: round, policy: SMART });
      if (res.winner !== "timeout") break;
      if (spec.retreat === false) continue;
      const heroes = s.units.filter(u => u.isPlayer && !c.isWeaponUnit(u) && alive(u));
      const bad = heroes.some(u => u.dying || u.upOnShp || hpOf(u) < .3 * c.baseMaxHp(u));
      const foeHp = s.units.filter(u => !u.isPlayer && alive(u)).reduce((a, u) => a + hpOf(u), 0);
      if (bad && foeHp > foeHp0 * .5) { const pv = c.retreatPreview(); c.performRetreat(); ev("主动撤退（" + pv.rule.name + "）：" + spec.title); res = { winner: "retreat" }; break; }
    }
    if (c.__errors.length > errs0) throw new Error("战斗中 console.error：" + c.__errors.slice(errs0).join(" | "));
    row.outcome = res.winner === "player" ? "win" : res.winner === "enemy" ? "lose" : res.winner === "retreat" ? "retreat" : "timeout";
    row.raw = s.battleScore.total;
    const settled = row.outcome === "timeout" ? { grade: c.battleGrade(), xpBonus: 0 } : c.settleBattleRewards(row.outcome);
    Object.assign(row, { score: s.battleScore.total, grade: settled.grade.grade, xpBonus: settled.xpBonus, turns: s.turnNo, actualUnitsAfter: B.fieldSnapshot(c), supportUsed: s.solo ? (s.solo.used || []).slice() : null });
    if (row.outcome === "timeout") { terminalOutcome = "timeout"; row.endReason = "Battle round limit reached; unresolved battle was not settled as retreat or loss"; row.terrainAfter = B.clone({ gaps: s.gaps, props: s.props, fields: s.fields }); row.lastRoundLog = (s.logPages || []).slice(-1).flatMap(p => (p.lines || []).map(l => l.text || String(l))); return row.outcome; }
    const notes = R.finishBattle(run, row.outcome);
    Object.assign(row, { heroStateAfter: B.heroSnapshot(c, run), partyAfter: run.party.map(h => h.kit + " Lv" + h.level), deaths: notes.filter(n => /永久死亡|阵亡/.test(n)), economyAfter: { kuizhi: kz(), supplies: B.clone(R.supplies()) } });
    return row.outcome;
  } catch (e) { row.outcome = "error"; row.error = e.stack || String(e); terminalOutcome = "error"; throw e; }
}

/* ---------------- 调试：TOKENS=n 把普通战斗的敌人代币改成 n（精英战、首领不变），用来试平衡 ---------------- */
if (env.TOKENS) {
  B.positiveInt(env.TOKENS, "TOKENS");
  vm.runInContext(`(function () {
    const orig = rollEncounter;
    rollEncounter = function (opt) { opt = Object.assign({}, opt || {}); if (opt.tokens == null) opt.tokens = ${Number(env.TOKENS)}; return orig(opt); };
  })();`, c);
}

/* ---------------- 主循环 ---------------- */
if (SOLO_PARTNERS) {
  const role2 = SOLO_ROLE2 || R.role2Options(PARTY[0])[0];
  run = R.newRun({ party: [PARTY[0]], seed: SEED, solo: true, partners: SOLO_PARTNERS, role2 });
} else {
  run = R.newRun({ party: PARTY, seed: SEED });
}
if (env.BOSSTEST) {
  // 调试：直接打某一幕的首领。BOSSTEST=幕:角色等级
  const [act, lv] = env.BOSSTEST.split(":").map(Number);
  if (![1, 2, 3, 4].includes(act)) throw new Error("BOSSTEST act must be 1–4");
  B.positiveInt(lv, "BOSSTEST level");
  run.act = act; run.actDay = 8; run.stage = "boss";
  run.party.forEach(h => { h.level = lv; Object.keys(h.weaponLevels).forEach(k => { h.weaponLevels[k] = Math.max(1, Math.round(lv * 0.6)); }); });
  const r = fight("boss");
  const b = report.battles[0];
  console.log(JSON.stringify(b, null, 1));
  return finishReport();
}
if (env.ARENA) {
  // 调试：竞技场。ARENA=幕:等级:场数 —— 把队伍直接拉到这个等级（升级选择照常做完、武器升到 等级×0.6），
  // 满血连打普通战斗、精英战和首领战各若干场，统计胜率
  const [act, lv, n] = env.ARENA.split(":").map(Number);
  if (![1, 2, 3, 4].includes(act)) throw new Error("ARENA act must be 1–4");
  B.positiveInt(lv, "ARENA level"); B.positiveInt(n, "ARENA count");
  run.act = act; run.actDay = 4;
  run.party.forEach(h => {
    const from = h.level || 1;
    h.level = lv; h.xp = 0;
    R.queueLevelRewards(h, from, lv, [], run);
    Object.keys(h.weaponLevels).forEach(k => { h.weaponLevels[k] = Math.max(1, Math.round(lv * 0.6)); });
  });
  levelChoices();
  const partyCopy = JSON.parse(JSON.stringify(run.party));   // 每场开打前还原（输了会永久死亡、被移出队伍）
  const fullHp = () => {
    run.party = JSON.parse(JSON.stringify(partyCopy)); run.fallen = [];
    // 武器耐久、武器人伤势、力竭也一起复原：每场都是满状态
    c.S.LEDGER.dur = {}; c.S.LEDGER.weapons = {}; c.S.LEDGER.hours = 0; c.S.LEDGER.heroes = {};
  };
  const tally = {};
  for (const kind of ["battle", "elite", "boss"]) {
    tally[kind] = { win: 0, lose: 0, retreat: 0, timeout: 0, error: 0, turns: 0 };
    for (let i = 0; i < n; i++) {
      fullHp();
      terminalOutcome = null;
      run.main.done = false;
      run.actDay = 0;
      run.stage = kind === "boss" ? "boss" : "board";   // acceptTask 只在任务板前才让接
      run.seed = SEED + ":" + kind + i;
      run.result = null;
      if (kind !== "boss") { tryDo("接任务", () => R.acceptTask(run, "main")); run.stage = "task"; run.task.nodes[run.task.index] = { type: kind, done: false }; }
      run.actDay = 4; run.act = act;
      run.party.forEach(h => { h.level = lv; });
      const o = fight(kind);
      tally[kind][o] += 1;
      tally[kind].turns += report.battles[report.battles.length - 1].turns;
      if (run.stage === "over") { run.stage = "task"; delete run.result; }
    }
  }
  fullHp();
  const v = R.heroView(run, run.party[0]);
  console.log(`ARENA 第${act}幕 Lv${lv}（${run.party.map(h => R.heroName(h.kit)).join("、")}${run.solo ? "，单人" : ""}，血量上限 ${v.hpMax}）：` +
    Object.keys(tally).map(k => `${k} 胜${tally[k].win}/败${tally[k].lose}/撤${tally[k].retreat}/超时${tally[k].timeout}/异常${tally[k].error}（平均 ${(tally[k].turns / n).toFixed(1)} 回合）`).join("；"));
  if (report.bugs.length) console.log("bugs: " + report.bugs.map(b => b.what + "：" + b.detail).join(" | "));
  return finishReport();
}
run.CONFIG_restDays = R.CONFIG.restDays;
ev(`出发：${PARTY.map(R.heroName).join("、")}，种子 ${SEED}`);
let steps = 0;
try {
while (run.stage !== "over" && !terminalOutcome && steps++ < maxSteps) {
  if (!report.reachedActs.includes(run.act)) report.reachedActs.push(run.act);
  levelChoices();
  const stage = run.stage;
  if (stage === "board") {
    shopping(); clinic(); smithing();
    const w = boardPick();
    if (w == null) { bug("任务板上没有能接的任务", JSON.stringify((run.board || []).map(t => t.name))); break; }
    tryDo("接任务", () => R.acceptTask(run, w));
    const lab = (t) => (c.S.ROGUE_NODE_TYPES[t] || {}).label || t;
    ev(`接下${w === "main" ? "主线" : "支线「" + run.task.name + "」"}：${run.task.cols.map(col => col.map(lab).join("/")).join(" → ")}`);
  } else if (stage === "task" && !R.currentNode(run)) {
    // 路线图岔路：血少先去诊所 / 商店，有钱找工匠，其余打仗拿经验，检定最后
    const opts = R.nodeChoices(run);
    const pref = partyHpRatio() < 0.6 ? ["clinic", "shop", "check", "smith", "battle"]
      : kz() > 4000 ? ["smith", "battle", "shop", "check", "clinic"] : ["battle", "check", "shop", "smith", "clinic"];
    const rank = t => pref.includes(t) ? pref.indexOf(t) : pref.length;
    const best = opts.slice().sort((a, b) => rank(a.type) - rank(b.type))[0];
    if (!best) throw new Error("路线分岔没有可选节点");
    tryDo("选路线", () => R.chooseNode(run, best.i));
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
      const nOpt = (info.options || [0]).length;
      const best = run.party.flatMap(h => Array.from({ length: nOpt }, (_, i) => R.checkOdds(run, h.kit, i))).sort((a, b) => b.chance - a.chance)[0];
      if (best && best.chance && (!info.injure || best.chance >= 0.5)) {
        const notes = tryDo("检定", () => R.attemptCheck(run, best.kit, best.opt)) || [];
        ev(`${best.diffName}「${best.prof}」检定 → ${best.name}（${Math.round(best.chance * 100)}%）：${/成功/.test(notes[0] || "") && !/失败/.test(notes[0] || "") ? "成功" : "失败"}`);
      } else { tryDo("绕过检定", () => R.skipCheck(run)); ev(`${info.diffName}「${info.prof}」检定：绕过（最好的成功率 ${best ? Math.round(best.chance * 100) : 0}%）`); }
    } else { throw new Error("没见过的节点：" + node.type); }
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
} catch (e) { bug("流程异常", e.stack || e.message); terminalOutcome = "error"; }
if (steps >= maxSteps && run.stage !== "over" && !terminalOutcome) { terminalOutcome = "timeout"; report.endReason = "Campaign step limit reached"; }

return finishReport();
function finishReport() {
  if (c.__errors.length) { bug("console.error", c.__errors.join(" | ")); terminalOutcome = "error"; }
  report.outcome = report.bugs.length ? "error" : terminalOutcome || (run.result ? run.result.win ? "win" : "lose" : "error");
  const presetDiagnostic = !!(env.BOSSTEST || env.ARENA);
  if (presetDiagnostic && !report.bugs.length) report.outcome = report.battles.some(b => b.outcome === "timeout") ? "timeout" : report.battles.some(b => b.outcome === "error") ? "error" : report.battles[report.battles.length - 1].outcome;
  report.legalStart = !presetDiagnostic;
  report.completed = run.stage === "over" && !!run.result;
  report.endReason = report.endReason || (report.outcome === "timeout" ? "Battle round limit reached" : run.result && run.result.text) || report.bugs.map(b => b.what + ": " + b.detail).join(" | ") || "Run did not reach a legal ending";
  if (presetDiagnostic) report.endReason = "Explicit preset-level diagnostic; not a natural-progression campaign";
  Object.assign(report, { act: run.act, day: run.day, stage: run.stage, result: B.clone(run.result || null), fallen: B.clone(run.fallen || []), finalHeroes: B.heroSnapshot(c, run), economy: { kuizhi: kz(), supplies: B.clone(R.supplies()), bag: B.clone(st().bag || {}) } });
  return B.clone(report);
}
}

function formatCampaign(report) {
  const lines = ["# 实战测试：" + report.party.join("、") + "（种子 " + report.seed + "）", "结果：" + report.outcome + " — " + report.endReason, "策略：" + report.strategy, report.strategyDetails, "开局人数：" + report.startingSize + "；到达幕：" + report.reachedActs.join("、"), "最终经济：" + JSON.stringify(report.economy), "\n## 战斗"];
  report.battles.forEach((b, i) => lines.push((i + 1) + ". 第" + b.act + "幕 " + b.title + "：" + b.outcome + "，" + b.turns + " 回合，原始/最终分 " + b.raw + "/" + b.score + "，" + b.grade + "；存活英雄 " + b.survivingHeroes));
  lines.push("\n## 过程", ...report.events.map(x => "- " + x), "\n## 升级选择", report.levelUps.join("；"), "\n## 异常", report.bugs.length ? JSON.stringify(report.bugs, null, 2) : "无");
  return lines.join("\n");
}
function main(argv = process.argv.slice(2)) {
  for (const flag of argv.filter(x => x.startsWith("--"))) if (flag !== "--json") throw new Error("Unknown or unimplemented option: " + flag);
  const args = argv.filter(x => !x.startsWith("--"));
  if (args.length > 4) throw new Error("Expected seed, party, optional solo partners and optional second role only");
  const report = runCampaign({ seed: args[0], party: args[1] ? args[1].split(",") : undefined, partners: args[2] ? args[2].split(",") : undefined, role2: args[3], env: process.env });
  console.log(argv.includes("--json") ? JSON.stringify(report) : formatCampaign(report));
  return report.outcome === "error" ? 1 : 0;
}
if (require.main === module) { try { process.exitCode = main(); } catch (e) { console.error(e.stack || e.message); process.exitCode = 1; } }
module.exports = { runCampaign, formatCampaign, main, pickBoardTask };
