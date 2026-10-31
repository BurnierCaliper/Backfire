// PvP 平衡模拟（issue #491）：两队玩家角色照决斗规则（#472 / PR #480）整场自动对打，测先手 / 后手胜率和「失衡滚雪球」（docs/pvp.md 第 7 节）。
// 只测量、不改任何规则和数值；「临时关掉」的对照（后手补偿、起身翻滚）只在这个工具里、每一场自己的规则环境里改（运行时替换配置），
// 游戏文件不动。固定种子，同一份代码重跑结果相同。
//
//   node tools/pvp-balance.js                                  全部预设情况 → docs/balance/pvp-balance-1030.{md,json}
//   node tools/pvp-balance.js --sizes 1,2 --levels 10 --pairs 50 --seed TRY --out docs/balance/try
//   node tools/pvp-balance.js --variants base,noLate           只跑这几种情况（见 VARIANTS）
//   node tools/pvp-balance.js --fixed 0                        不跑固定阵容
//   node tools/pvp-balance.js --rebuild docs/balance/pvp-balance-1030
//                                                              不重跑，用已有的 json 重新生成报告（改了报告格式时用）
//   node tools/pvp-balance.js --policy skill --pairs 10 --fixed 0 --pve 6
//                                                              两队都用看情况用技能的打法（#538，BattleSim.SKILL_POLICY）→ docs/balance/pvp-balance-skill-1031，
//                                                              和普攻版（--compare，默认 docs/balance/pvp-balance-1030）同一批阵容、种子并排对比；--pve N 另跑几场遭遇战对照
//
// 每一对阵容打两场：先手、后手对调（镜像），其余完全一样（同一个战斗种子），阵容强弱在先后手之间抵消；
// 阵容：两队互不重复的角色（同一个角色不能同时在两队），从 11 名角色里按种子随机抽，另有几组固定阵容。
// 同一个序号的阵容、种子对每种情况、每个等级都一样，情况之间可以直接比。偶数序号的阵容 A 站 1 队（1 区），奇数站 2 队（3 区）。
// 等级照 R1 单场矩阵（tools/score-by-act.js · one）：升级选主属性 / 第一个合法选项，武器等级 = 等级 × 0.6（最高 10），
// 满状态、不用道具、没有义体。抛硬币由工具定（先手是谁），其余照游戏：3 区制、1 队站 1 区、2 队站 3 区，后手补偿 1 个附赠……
// 打法：默认两队都是 BattleSim.BASIC_POLICY（能打到就普攻血最少的，打不到就用附赠走一格；能协助格挡就挡、能协助攻击就打），
// 另外补上起身：倒地能起身就起身；「起身翻滚」开着时按站位挑一个相邻区翻过去（远程躲开同区的对手、近战翻到有对手的区）。
// 不用技能、道具、召唤武器人，不会撤退、不会故意拖回合——结论的局限见报告最后的「注意」。
// --policy skill：两队都换成 BattleSim.SKILL_POLICY（会看情况用技能、召唤武器人；满状态不带道具），起身、翻滚和上面一样。
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const cp = require("node:child_process");
const { Worker, isMainThread, parentPort } = require("node:worker_threads");
const H = require("../tests/headless");
const B = require("./balance-common");

const CONFIG = {
  version: "pvp-balance-v1",
  seedPrefix: "PVP1030",
  sizes: [1, 2, 3, 4],     // 1v1 … 4v4
  levels: [3, 10, 18],     // 低 / 中 / 高
  pairs: 150,              // 每格（情况 × 人数 × 等级）随机阵容几对；每对先后手各打一场
  fixedPairs: 100,         // 每组固定阵容 × 每个等级几对（只换种子）；只跑「现在的规则」
  maxRounds: 60,           // 安全上限：不限回合的决斗打到这里还没分出胜负，记「超时」（不算平局）
  roundsLimit: 10,         // 「回合上限」那一组开的回合数（决斗默认 10 回合，enemies.js · PVP_DUEL_CFG.roundsDefault）
  workers: 4,
  out: "docs/balance/pvp-balance-1030",
  // 打法（--policy）：两队用同一种
  policy: "basic",
  skillOut: "docs/balance/pvp-balance-skill-1031",   // --policy skill 默认写到这里
  compare: "docs/balance/pvp-balance-1030",          // --policy skill 的报告和这份普攻版并排比（同一批阵容、种子）
  skillCfg: { items: false },                        // SKILL_POLICY 在决斗里的设置（盖在 SKILL_POLICY_CFG 上）：满状态 PvP 不带道具
  pveLimit: 30                                       // 遭遇战对照的回合上限
};
// 打法：报告里写的名字和说明
const POLICIES = {
  basic: { name: "普攻版", note: "BattleSim.BASIC_POLICY：能打到就普攻血最少的，打不到就用附赠走一格；不用技能、道具，不召唤武器人" },
  skill: { name: "技能版", note: "BattleSim.SKILL_POLICY：列出所有合法动作，在沙盒里几个平行世界试跑，一回合内往前看几步，按打分挑（sim-search.js）；会用技能、召唤武器人，决斗里不带道具" }
};
// 遭遇战（PvE）对照（--pve N：每一项 N 个种子，两种打法各打一场）：队伍照 R1 单场矩阵升到 level，敌人比队伍高 plus 级；
// 难度按普攻版挑的（10/31 用普攻版每项 6–8 个种子试过：P1–P5 普攻版有赢有输，P6 普攻版一场都打不赢），看技能版是不是更强、有没有乱放技能
const PVE_SCENARIOS = [
  { id: "P1", party: ["kolt", "helu"], level: 3, plus: 2, enemies: ["thug_knife", "thug_hammer", "bandit_boss"] },
  { id: "P2", party: ["ruby", "tou", "yuito"], level: 5, plus: 4, enemies: ["bandit_boss", "bandit_boss", "thug_hammer", "thug_knife"] },
  { id: "P3", party: ["hiaki", "xia", "nora", "ras"], level: 10, plus: 7, enemies: ["sand_beast", "sand_human", "bigsand"] },
  { id: "P4", party: ["chuan", "kolt", "helu", "longge"], level: 10, plus: 4, enemies: ["outlaw_king", "bandit_boss", "thug_hammer", "thug_knife"] },
  { id: "P5", party: ["tou", "yuito", "xia", "ruby"], level: 15, plus: 4, enemies: ["sand_aggregate"] },
  { id: "P6", party: ["chuan", "kolt", "helu", "longge"], level: 10, plus: 0, enemies: ["ufo_boss"] }
];
// 情况：每一项只改一处，其余和「现在的规则」一样
const VARIANTS = {
  base: { name: "现在的规则", note: "后手补偿 1 个附赠、允许起身、不限回合、起身可以翻滚", late: true, stand: true, rounds: false, roll: true },
  noLate: { name: "关掉后手补偿", note: "只在模拟里把 PVP_DUEL_CFG.lateBonus 改成 0", late: false, stand: true, rounds: false, roll: true },
  noStand: { name: "不允许起身", note: "决斗选项「允许起身」不勾", late: true, stand: false, rounds: false, roll: true },
  rounds: { name: "回合上限 10", note: "决斗选项「限定回合数」勾上，10 回合", late: true, stand: true, rounds: true, roll: true },
  noRoll: { name: "关掉起身翻滚", note: "只在模拟里让起身时都不翻滚（原地起身）", late: true, stand: true, rounds: false, roll: false },
  // 只改 AI 的对照（不在默认清单里，单独出报告：--variants base,hold --fixed 0 --out docs/balance/pvp-balance-1030-hold）
  hold: { name: "先手第一回合原地等", note: "只改 AI、规则和「现在的规则」一样：先手的人第 1 回合够不着就不走过去（够得着照常打），后手照常走过去", late: true, stand: true, rounds: false, roll: true, hold: true }
};
// 默认跑的情况（issue #491 要的那几种）
const DEFAULT_VARIANTS = ["base", "noLate", "noStand", "rounds", "noRoll"];
// 固定阵容（只跑「现在的规则」）：每组 × 每个等级打 fixedPairs 对，看先手优势是不是每种阵容都有
const FIXED = [
  { id: "F1", a: ["kolt"], b: ["hiaki"] },
  { id: "F2", a: ["xia"], b: ["ruby"] },
  { id: "F3", a: ["kolt", "helu"], b: ["hiaki", "tou"] },
  { id: "F4", a: ["tou", "yuito", "xia"], b: ["ruby", "kolt", "helu"] },
  { id: "F5", a: ["tou", "yuito", "xia", "ruby"], b: ["kolt", "helu", "hiaki", "nora"] },
  { id: "F6", a: ["chuan", "ras", "longge", "nora"], b: ["hiaki", "kolt", "yuito", "tou"] }
];
const TEAMS = ["1队", "2队"];
const other = t => (t === TEAMS[0] ? TEAMS[1] : TEAMS[0]);

/* ---------- 阵容与种子 ---------- */
/** 随机阵容：从 11 名角色里按种子抽 2 × size 个不重复的，前一半 A 队、后一半 B 队 */
function lineup(prefix, size, index) {
  const r = B.rng(`${prefix}:lineup:${size}:${index}`), pool = B.HEROES.slice(), out = [];
  while (out.length < size * 2) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return { a: out.slice(0, size), b: out.slice(size) };
}
/** 抽样计划：每格每对两场（A 先手 / B 先手） */
function plan(opt = {}) {
  const prefix = opt.seed || CONFIG.seedPrefix, sizes = opt.sizes || CONFIG.sizes, levels = opt.levels || CONFIG.levels;
  const pairs = opt.pairs || CONFIG.pairs, fixedPairs = opt.fixedPairs != null ? opt.fixedPairs : CONFIG.fixedPairs;
  const variants = opt.variants || DEFAULT_VARIANTS, jobs = [], policy = opt.policy || CONFIG.policy;
  const pair = (base, i) => ["a", "b"].forEach(first => jobs.push(Object.assign({}, base, { first, aTeam: i % 2 === 0 ? TEAMS[0] : TEAMS[1] }, policy !== "basic" ? { policy } : {})));
  for (const variant of variants) for (const size of sizes) for (const level of levels) for (let i = 0; i < pairs; i++) {
    const { a, b } = lineup(prefix, size, i);
    pair({ kind: "random", variant, size, level, index: i, a, b, seed: `${prefix}:${size}:${level}:${i}` }, i);
  }
  if (variants.includes("base")) for (const f of FIXED) {
    if (!sizes.includes(f.a.length)) continue;
    for (const level of levels) for (let i = 0; i < fixedPairs; i++) {
      pair({ kind: f.id, variant: "base", size: f.a.length, level, index: i, a: f.a.slice(), b: f.b.slice(), seed: `${prefix}:${f.id}:${level}:${i}` }, i);
    }
  }
  // 技能版 vs 普攻版对打（--h2h N）：每种人数 × 等级 N 对阵容，先后手对调 × 哪一队用技能版对调 = 每对 4 场，阵容强弱、先后手都抵消
  for (const size of opt.h2h ? sizes : []) for (const level of levels) for (let i = 0; i < opt.h2h; i++) {
    const { a, b } = lineup(prefix, size, i);
    for (const first of ["a", "b"]) for (const swap of [0, 1]) {
      jobs.push({ kind: "h2h", variant: "base", size, level, index: i, a, b, seed: `${prefix}:h2h:${size}:${level}:${i}`, first, aTeam: i % 2 === 0 ? TEAMS[0] : TEAMS[1], swap });
    }
  }
  // 遭遇战对照：每一项 pve 个种子，两种打法各打一场（同一个种子）
  for (const sc of opt.pve ? PVE_SCENARIOS : []) for (let i = 0; i < opt.pve; i++) for (const p of ["basic", "skill"]) {
    jobs.push({ kind: "pve", id: sc.id, party: sc.party.slice(), enemies: sc.enemies.slice(), level: sc.level, plus: sc.plus || 0, index: i, policy: p, seed: `${prefix}:pve:${sc.id}:${i}` });
  }
  return jobs;
}

/* ---------- 一场 ---------- */
/** 照 R1 单场矩阵把这些角色升到 level（SaveStore 一局 2–4 人：拆成几局，凑不够 2 人的补一个不上场的） */
function leveledRuns(c, kits, level, seed) {
  const R = c.Rogue, runs = [];
  let rest = kits.slice();
  while (rest.length) {
    const n = rest.length <= 4 ? rest.length : (rest.length - 4 >= 2 ? 4 : rest.length - 2);
    const chunk = rest.slice(0, n);
    rest = rest.slice(n);
    const party = chunk.length === 1 ? chunk.concat([B.HEROES.find(k => !kits.includes(k))]) : chunk;
    const run = R.newRun({ party, seed: `${seed}:${party.join(",")}` });
    run.party.forEach(h => {
      const from = h.level || 1;
      h.level = level; h.xp = 0; h.hp = null; h.shp = null;
      R.queueLevelRewards(h, from, level, [], run);
      Object.keys(h.weaponLevels || {}).forEach(k => { h.weaponLevels[k] = Math.max(1, Math.min(10, Math.round(level * .6))); });
    });
    B.chooseLevels(R, run, []);
    run.party.forEach(h => { h.hp = null; h.shp = null; h.weaponState = {}; });
    runs.push(run);
  }
  return runs;
}
const isHero = (c, u) => !!u && u.isPlayer && !u.escort && !c.isWeaponUnit(u);
/** 规则环境里装上计数（只读：不改任何结算，只在原函数前后记事件） */
function instrument(c) {
  const S = c.S, rec = { stag: [], downs: [], outs: [], asks: [], wipes: [], blocks: [] };
  // 技能版在沙盒里试跑（BattleSearch.busy）时不记：那些不是真的发生的事
  const wrap = (name, fn) => {
    const orig = c[name];
    if (typeof orig !== "function") throw new Error("missing rule function " + name);
    c[name] = (...args) => (c.BattleSearch && c.BattleSearch.busy() ? orig(...args) : fn(orig, args));
  };
  const teamOf = u => (isHero(c, u) ? c.pvpDuelTeamOf(u) : null);
  const ev = (list, u, extra) => { const t = teamOf(u); if (t) list.push(Object.assign({ team: t, turn: S.state.turnNo, phase: S.state.combatPhase, kit: u.kit }, extra || {})); };
  // 失衡：这一下把它从没失衡打成失衡（攻击结算 applyResultToUnit；只扣架势的 dealBreak：冻伤、反震、冲撞……）
  const stagger = (orig, args) => { const u = args[0], was = !!(u && u.stunned); const out = orig(...args); if (u && !was && u.stunned) ev(rec.stag, u); return out; };
  wrap("applyResultToUnit", stagger);
  wrap("dealBreak", stagger);
  // 倒地（濒死）：看从没倒地变成倒地（PvP 的攻击带着 flags.friendlyFire，战场数据 noteKnockdown 不记，所以不能只靠它）；起身后再倒地另算一次
  const down = new Set();
  const knock = (orig, args) => { const u = args[0], was = !!(u && u.dying); const out = orig(...args); if (u && !was && u.dying && !down.has(u.id)) { down.add(u.id); ev(rec.downs, u); } return out; };
  wrap("applyKnockdown", knock);
  wrap("noteKnockdown", (orig, args) => { const u = args[0]; if (u && u.dying && !down.has(u.id)) { down.add(u.id); ev(rec.downs, u); } return orig(...args); });
  wrap("pvpDuelKnockOut", (orig, args) => { const u = args[0], was = !!(u && u.pvpOut); const out = orig(...args); if (u && !was && u.pvpOut) ev(rec.outs, u); return out; });
  // 起身：这一队当时全员倒地（没人站着）就记一次「全员倒地后起身」——回合结束前被问（#470，answerWipeStand）或者在自己的回合里起身都算
  let asking = false;
  const allDown = team => c.pvpDuelMembers(team).every(x => x.dead || x.pvpOut || x._removed || (x.dying && !x.upOnShp));
  wrap("standUp", (orig, args) => {
    const u = args[0], team = teamOf(u), wiped = !!(team && u.dying && !u.upOnShp && allDown(team));
    const out = orig(...args);
    if (u && !u.dying) down.delete(u.id);
    if (wiped && u.upOnShp && !rec.wipes.some(w => w.team === team && w.turn === S.state.turnNo)) rec.wipes.push({ team, turn: S.state.turnNo, asked: asking });
    return out;
  });
  // 全员倒地还能起身（#470）：回合结束前问了哪一队、有没有人起身
  wrap("queueWipeStand", (orig, args) => {
    const seen = new Set((S.state.standQueue || []).map(j => j.unitId));
    const out = orig(...args);
    (S.state.standQueue || []).filter(j => !seen.has(j.unitId)).forEach(j => {
      const team = String(j.team);
      if (!rec.asks.some(a => a.team === team && a.turn === S.state.turnNo)) rec.asks.push({ team, turn: S.state.turnNo, stood: false });
    });
    return out;
  });
  wrap("answerWipeStand", (orig, args) => {
    const u = c.unitById(args[0]), was = !!(u && u.upOnShp);
    asking = true;
    let out;
    try { out = orig(...args); } finally { asking = false; }
    if (u && !was && u.upOnShp) { const a = rec.asks.filter(x => x.team === teamOf(u)).pop(); if (a) a.stood = true; }
    return out;
  });
  // 协助格挡（花了附赠的才算）
  wrap("performAssistBlock", (orig, args) => {
    const h = args[0], b0 = Number(h && h.bonus) || 0;
    const out = orig(...args);
    if (h && (Number(h.bonus) || 0) < b0) ev(rec.blocks, h);
    return out;
  });
  return rec;
}
/** 普攻的射程（BASIC 只用普攻；和 sim.js · skillRangeOf 一样） */
function aaRange(c, u) {
  let list = [];
  try { list = c.skillList(u) || []; } catch (e) { list = []; }
  const aa = list.find(s => s.id === u.kit + "_aa") || list.find(s => /_aa$/.test(s.id || ""));
  if (!aa) return { min: 0, max: 0 };
  return c.skillRangeFor(u, aa.id) || c.parseSkillRange(aa.hint) || { min: 0, max: 1 };
}
/** 起身翻滚翻到哪一区（#477）：能用普攻打到人 +10，同区每有一个对手 −3（远程）/ −1（近战）；一样就原地（返回 null） */
function rollPick(c, u, zones) {
  if (!zones || !zones.length) return null;
  const S = c.S.state, zm = Number(S.zoneMode), r = aaRange(c, u);
  const foes = c.hostilesOf(u).filter(f => !(f.dying && !f.upOnShp));
  const score = z => {
    const hit = foes.some(f => { const d = c.zoneDist(z, Number(f.zone), zm); return d >= r.min && d <= r.max; });
    return (hit ? 10 : 0) - foes.filter(f => Number(f.zone) === z).length * (r.max >= 1 ? 3 : 1);
  };
  const here = Number(u.zone);
  let best = here, bestV = score(here);
  zones.map(Number).forEach(z => { const v = score(z); if (v > bestV) { best = z; bestV = v; } });
  return best === here ? null : best;
}
/** 普攻现在打得到对手没有（倒地没起身的不算） */
function inReach(c, u) {
  const zm = Number(c.S.state.zoneMode), r = aaRange(c, u);
  return c.hostilesOf(u).some(f => {
    if ((f.dying && !f.upOnShp) || f.untargetable) return false;
    const d = c.zoneDist(Number(u.zone), Number(f.zone), zm);
    return d >= r.min && d <= r.max;
  });
}
/** 两队共用的打法：BASIC（--policy skill 换成 SKILL_POLICY，满状态不带道具）+ 起身（能起就起；翻滚开着时按 rollPick 翻）。
 *  只改 AI 的对照 hold：先手的人第 1 回合够不着就原地等（不走过去），够得着照常打 */
function duelPolicy(c, V, firstTeam, policy) {
  const base = policy === "skill" ? c.BattleSim.skillPolicy({ cfg: CONFIG.skillCfg }) : c.BattleSim.BASIC_POLICY;
  const dest = (u, zones) => (V.roll ? rollPick(c, u, zones || c.standRollZones(u)) : null);
  return Object.assign({}, base, {
    name: base.name + "-duel",
    act(u) {
      if (u.dying && !c.isWeaponUnit(u)) {
        if (u.upOnShp || c.standUpBlocked(u)) return null;
        const d = dest(u);
        return () => c.standUp(u, d);
      }
      if (V.hold && Number(c.S.state.turnNo) === 1 && c.pvpDuelTeamOf(u) === firstTeam && !inReach(c, u)) return null;
      return base.act(u);
    },
    standAsk(u, zones) { return { stand: true, dest: dest(u, zones) }; }
  });
}
/** 布置一场（开战前）：返回规则环境、记录、先手的队 */
function prepare(job) {
  const V = VARIANTS[job.variant];
  if (!V) throw new Error("Unknown variant " + job.variant);
  const c = H.load();
  // 临时关掉后手补偿：只改这一场自己的规则环境里的配置表（游戏文件不动）
  if (!V.late) vm.runInContext("PVP_DUEL_CFG.lateBonus = 0", c);
  const rec = instrument(c);
  c.S.RNG.install(job.seed + ":setup");
  const kits = job.a.concat(job.b);
  const runs = leveledRuns(c, kits, job.level, job.seed);
  c.S.LEDGER.dur = {}; c.S.LEDGER.weapons = {}; c.S.LEDGER.heroes = {}; c.S.LEDGER.hours = 0;
  c.BattleSim.setup({ party: kits, enemies: [], seed: job.seed + ":battle", before: () => runs.forEach(r => c.Rogue.applyPartyToField(r)) });
  const S = c.S.state, id = k => { const u = c.findKit(k, S.units); if (!u) throw new Error("hero not on field: " + k); return u.id; };
  const aTeam = job.aTeam, bTeam = other(aTeam);
  const cmd = { type: "battle.duel", teams: { [aTeam]: job.a.map(id), [bTeam]: job.b.map(id) } };
  if (!V.stand) cmd.stand = false;
  if (V.rounds) cmd.rounds = CONFIG.roundsLimit;
  c.Commands.dispatch(cmd);
  // 抛硬币：由工具定先手（镜像对局），其余照游戏
  const firstTeam = job.first === "a" ? aTeam : bTeam;
  const toss = c.pvpDuelToss;
  c.pvpDuelToss = () => { const keep = c.Math.random; c.Math.random = () => (firstTeam === TEAMS[0] ? 0.1 : 0.9); try { return toss(); } finally { c.Math.random = keep; } };
  return { c, S, V, rec, firstTeam };
}
const sideOf = (team, firstTeam) => (team === firstTeam ? "F" : "S");
const firstEvent = (list, firstTeam) => { const e = list[0]; return e ? { side: sideOf(other(e.team), firstTeam), turn: e.turn } : null; };   // 记给打出它的那一方（对面）
/** 技能版做了什么（BattleSim.skillPolicy 的 stats）：用了哪些技能（id → 次数）、召唤、移动、道具、想了几次、试跑了多少个候选 */
function policyStats(row, pol) {
  const st = pol && pol.stats;
  if (!st) return;
  Object.assign(row, { use: Object.assign({}, st.skills), sm: st.summons, mv: st.moves, it: st.items, dec: st.decisions, tr: st.tried });
  row.nm = JSON.parse(JSON.stringify(st.names || {}));   // 技能名：汇总进 report.skillNames 以后从行里拿掉（不写进 json 的 rows）
}
/** 技能版 vs 普攻版对打（镜像）：A 队（swap 时 B 队）用技能版、另一队用普攻版，起身 / 翻滚两边一样。w：X 技能版赢 / Y 普攻版赢 / D 平局 */
function runH2h(job) {
  const row = { k: "h2h", s: job.size, L: job.level, i: job.index, f: job.first, x: job.swap, w: "E" };
  try {
    const { c, V, firstTeam } = prepare(job);
    const X = duelPolicy(c, V, firstTeam, "skill"), Y = duelPolicy(c, V, firstTeam, "basic");
    const xTeam = job.swap ? other(job.aTeam) : job.aTeam;
    const pick = u => (c.pvpDuelTeamOf(u) === xTeam ? X : Y);
    const mixed = Object.assign({}, X, { name: "h2h", act: u => pick(u).act(u), standAsk: (u, z) => pick(u).standAsk(u, z) });
    const res = c.BattleSim.run({ maxRounds: CONFIG.maxRounds, policy: mixed });
    const duel = res.duel;
    row.w = !duel ? "T" : duel.winner ? (duel.winner === xTeam ? "X" : "Y") : "D";
    row.r = res.rounds;
    policyStats(row, X);
    if (c.__errors.length) row.bugs = ["规则 console.error：" + c.__errors.slice(0, 3).join(" | ").slice(0, 300)];
  } catch (e) { row.w = "E"; row.err = String(e && e.stack || e).split("\n").slice(0, 4).join(" | ").slice(0, 400); }
  return row;
}
/** 对打汇总：技能版赢了几场（只算分出胜负的），按人数分开 */
function h2hSummary(rows) {
  const out = {};
  rows.filter(r => r.k === "h2h").forEach(r => ["all", r.s].forEach(s => { (out[s] = out[s] || []).push(r); }));
  Object.keys(out).forEach(s => {
    const xs = out[s].filter(r => r.w !== "E"), dec = xs.filter(r => r.w === "X" || r.w === "Y"), won = dec.filter(r => r.w === "X").length;
    out[s] = { n: xs.length, dec: dec.length, won, rate: dec.length ? won / dec.length : null, ci: B.wilson(won, dec.length), draws: xs.length - dec.length, rounds: mean(xs.map(r => r.r).filter(Number.isFinite)), sm: mean(xs.map(r => r.sm || 0)) };
  });
  return out;
}
function runJob(job) {
  if (job.kind === "pve") return runPve(job);
  if (job.kind === "h2h") return runH2h(job);
  const row = { v: job.variant, k: job.kind, s: job.size, L: job.level, i: job.index, f: job.first, w: "E" };
  if (job.policy && job.policy !== "basic") row.p = job.policy;
  try {
    const { c, S, V, rec, firstTeam } = prepare(job);
    const pol = duelPolicy(c, V, firstTeam, job.policy);
    const res = c.BattleSim.run({ maxRounds: CONFIG.maxRounds, policy: pol });
    policyStats(row, pol);
    if (S.pvpDuel.first !== firstTeam) throw new Error("coin toss not forced");
    const duel = res.duel;
    row.w = !duel ? "T" : duel.winner ? sideOf(duel.winner, firstTeam) : "D";
    row.why = duel ? duel.why : "timeout";
    row.r = res.rounds;
    row.act = res.actions;
    const by = (list, side) => list.filter(e => sideOf(other(e.team), firstTeam) === side).length;   // side 打出的
    const st = firstEvent(rec.stag, firstTeam), dn = firstEvent(rec.downs, firstTeam), out = firstEvent(rec.outs, firstTeam);
    Object.assign(row, {
      st: st && st.side, stR: st && st.turn, dn: dn && dn.side, dnR: dn && dn.turn, out: out && out.side, outR: out && out.turn,
      stF: by(rec.stag, "F"), stS: by(rec.stag, "S"), dnF: by(rec.downs, "F"), dnS: by(rec.downs, "S"), outF: by(rec.outs, "F"), outS: by(rec.outs, "S"),
      // 后手补偿用在先手第一回合的协助格挡上（后手的人在第 1 回合我方回合里挡了几次）；整场两边各挡了几次
      blk1: rec.blocks.filter(e => e.team !== firstTeam && e.turn === 1 && e.phase === "player").length,
      blkF: rec.blocks.filter(e => e.team === firstTeam).length, blkS: rec.blocks.filter(e => e.team !== firstTeam).length,
      asks: rec.asks.map(a => ({ side: sideOf(a.team, firstTeam), r: a.turn, stood: a.stood })),
      wipes: rec.wipes.map(w => ({ side: sideOf(w.team, firstTeam), r: w.turn, asked: w.asked }))
    });
    if (duel && duel.pct) row.pct = [duel.pct[firstTeam], duel.pct[other(firstTeam)]].map(x => Math.round(x * 1000) / 1000);
    // 自检（撞到的 bug 记进报告）：决斗里不该有人真的死亡；全倒判的胜负，输的一队不该还有人站着；规则里不该报错
    const bugs = [];
    const heroes = S.units.filter(u => isHero(c, u));
    if (heroes.some(u => u.dead && !u.pvpOut)) bugs.push("决斗里有角色死亡（dead 但不是再起不能）");
    if (duel && duel.why === "wipe" && duel.winner && c.pvpDuelTeamUp(other(duel.winner))) bugs.push("全倒判负的一队还有人站着");
    if (c.__errors.length) bugs.push("规则 console.error：" + c.__errors.slice(0, 3).join(" | ").slice(0, 300));
    if (bugs.length) row.bugs = bugs;
  } catch (e) { row.w = "E"; row.err = String(e && e.stack || e).split("\n").slice(0, 4).join(" | ").slice(0, 400); }
  return row;
}

/** 遭遇战对照（PvE）：队伍照 R1 单场矩阵升到 level，敌人同等级站 2 区，我方用 job.policy、敌人照旧 ai.js。
 *  w：W 赢 / L 输 / T 回合上限；hp：我方角色剩下的血量合计 ÷ 上限合计（倒地的按 0）；hd：最后倒地 / 死亡的角色数 */
function runPve(job) {
  const row = { k: "pve", id: job.id, L: job.level, i: job.index, p: job.policy || "basic", w: "E" };
  try {
    const c = H.load();
    c.S.RNG.install(job.seed + ":setup");
    const runs = leveledRuns(c, job.party, job.level, job.seed);
    c.S.LEDGER.dur = {}; c.S.LEDGER.weapons = {}; c.S.LEDGER.heroes = {}; c.S.LEDGER.hours = 0;
    const lv = job.level + (Number(job.plus) || 0);   // 敌人比队伍高几级（plus）
    c.BattleSim.setup({ party: job.party, enemies: job.enemies.map(id => ({ id, lv, zone: 2 })), seed: job.seed + ":battle", before: () => runs.forEach(r => c.Rogue.applyPartyToField(r)) });
    const pol = row.p === "skill" ? c.BattleSim.skillPolicy() : c.BattleSim.BASIC_POLICY;
    const res = c.BattleSim.run({ maxRounds: CONFIG.pveLimit, policy: pol });
    row.w = res.winner === "player" ? "W" : res.winner === "enemy" ? "L" : "T";
    row.r = res.rounds;
    row.act = res.actions;
    const heroes = c.S.state.units.filter(u => isHero(c, u));
    const max = heroes.reduce((s, u) => s + c.totalMaxHp(u), 0);
    row.hp = max ? Math.round(heroes.reduce((s, u) => s + (u.dead || u.dying ? 0 : c.totalHp(u)), 0) / max * 1000) / 1000 : 0;
    row.hd = heroes.filter(u => u.dead || u.dying).length;
    policyStats(row, pol);
    if (c.__errors.length) row.bugs = ["规则 console.error：" + c.__errors.slice(0, 3).join(" | ").slice(0, 300)];
  } catch (e) { row.w = "E"; row.err = String(e && e.stack || e).split("\n").slice(0, 4).join(" | ").slice(0, 400); }
  return row;
}

if (!isMainThread) parentPort.on("message", msg => { const t0 = Date.now(); const row = runJob(msg.job); parentPort.postMessage({ i: msg.i, row, ms: Date.now() - t0 }); });
/** 跑一批；onRow(row, i, ms)：每场打完调一次（ms = 这一场花了多少毫秒，只拿来报速度，不写进 rows） */
async function runJobs(jobs, workers = 1, onRow) {
  const rows = Array(jobs.length);
  if (workers <= 1) { jobs.forEach((j, i) => { const t0 = Date.now(); rows[i] = runJob(j); if (onRow) onRow(rows[i], i, Date.now() - t0); }); return rows; }
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, () => new Promise((resolve, reject) => {
    const w = new Worker(__filename);
    const send = () => { if (next >= jobs.length) { w.terminate().then(resolve, reject); return; } const i = next++; w.postMessage({ i, job: jobs[i] }); };
    w.on("message", ({ i, row, ms }) => { rows[i] = row; if (onRow) onRow(row, i, ms); send(); });
    w.on("error", reject);
    send();
  })));
  return rows;
}

/* ---------- 汇总 ---------- */
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
/** 先打出 key（st 失衡 / dn 倒地 / out 再起不能）的那一方最后赢没赢（只看分出胜负的场次）；再按它是先手还是后手分开 */
function snowball(rows, key) {
  const dec = rows.filter(r => (r.w === "F" || r.w === "S") && r[key]);
  const part = list => { const won = list.filter(r => r.w === r[key]).length; return { n: list.length, won, rate: list.length ? won / list.length : null, ci: B.wilson(won, list.length) }; };
  return Object.assign(part(dec), { byFirst: part(dec.filter(r => r[key] === "F")), bySecond: part(dec.filter(r => r[key] === "S")),
    firstShare: dec.length ? dec.filter(r => r[key] === "F").length / dec.length : null, turn: mean(dec.map(r => r[key + "R"]).filter(Number.isFinite)) });
}
function summarize(rows) {
  const ok = rows.filter(r => r.w !== "E"), count = w => ok.filter(r => r.w === w).length;
  const F = count("F"), S = count("S"), D = count("D"), T = count("T");
  const rounds = ok.map(r => r.r).filter(Number.isFinite);
  // 全员倒地、回合结束前问过有人起身的那一队：最后赢了几场（「先问再判负」之后翻盘）；每场每一方只算第一次
  const firstPer = list => ["F", "S"].map(side => list.find(x => x.side === side)).filter(Boolean);
  const asks = ok.flatMap(r => firstPer((r.asks || []).filter(a => a.stood)).map(a => ({ won: r.w === a.side, drew: r.w === "D" || r.w === "T", side: a.side })));
  // 全员倒地后有人起身（被问时起身，或者后手在自己的回合里起身——后手在先手的回合里被打得全员倒地时轮到自己就能起身，不会被问）
  const wipes = ok.flatMap(r => firstPer(r.wipes || []).map(w => ({ won: r.w === w.side, drew: r.w === "D" || r.w === "T", side: w.side, asked: w.asked })));
  const wipeStat = list => ({ n: list.length, won: list.filter(a => a.won).length, drew: list.filter(a => a.drew).length, ci: B.wilson(list.filter(a => a.won).length, list.length),
    bySide: { F: list.filter(a => a.side === "F").length, S: list.filter(a => a.side === "S").length, Fwon: list.filter(a => a.side === "F" && a.won).length, Swon: list.filter(a => a.side === "S" && a.won).length } });
  return {
    n: rows.length, errors: rows.length - ok.length, bugs: rows.filter(r => r.bugs).length, F, S, D, T,
    firstRate: F + S ? F / (F + S) : null, ci: B.wilson(F, F + S), drawRate: ok.length ? D / ok.length : null, timeoutRate: ok.length ? T / ok.length : null,
    rounds: mean(rounds), roundsMed: B.quantile(rounds, 0.5), roundsP90: B.quantile(rounds, 0.9),
    stag: snowball(ok, "st"), down: snowball(ok, "dn"), out: snowball(ok, "out"),
    asks: wipeStat(asks), wipes: wipeStat(wipes), wipeGames: ok.filter(r => (r.wipes || []).length).length,
    blk1: mean(ok.map(r => r.blk1 || 0)), blkF: mean(ok.map(r => r.blkF || 0)), blkS: mean(ok.map(r => r.blkS || 0)),
    stagPerGame: mean(ok.map(r => (r.stF || 0) + (r.stS || 0))), stagF: mean(ok.map(r => r.stF || 0)), stagS: mean(ok.map(r => r.stS || 0))
  };
}
/** rows → { "variant|kind|size|level": 汇总 }；size / level 写 all 是合在一起；kind 只分 random / 各组固定阵容 */
function summarizeAll(rows) {
  const by = new Map(), add = (k, r) => { if (!by.has(k)) by.set(k, []); by.get(k).push(r); };
  rows.forEach(r => {
    if (r.k === "pve" || r.k === "h2h") return;   // 遭遇战对照、对打另算（pveSummary / h2hSummary）
    const kind = r.k === "random" ? "random" : r.k;
    for (const s of [r.s, "all"]) for (const L of [r.L, "all"]) add([r.v, kind, s, L].join("|"), r);
  });
  const out = {};
  by.forEach((list, k) => { out[k] = summarize(list); });
  return out;
}
/** 两个比例的差（a − b）和 95% 区间（正态近似；两组用的是同一批阵容和种子，实际区间更窄，这样算偏保守） */
function diff(a, b) {
  if (!a || !b || a.firstRate == null || b.firstRate == null) return null;
  const na = a.F + a.S, nb = b.F + b.S, d = a.firstRate - b.firstRate;
  const se = Math.sqrt(a.firstRate * (1 - a.firstRate) / na + b.firstRate * (1 - b.firstRate) / nb);
  return { d, ci: [d - 1.959963984540054 * se, d + 1.959963984540054 * se] };
}

/** 只改 AI 的对照（单独的报告 cp）里，哪几种人数和现在的打法（S 里的 base）差得明显（差值区间不含 0） */
function holdSig(cp, S, sizes) {
  return sizes.map(s => {
    const a = S && S[["base", "random", s, "all"].join("|")], b = cp.summary[["hold", "random", s, "all"].join("|")], d = diff(b, a);
    return d && (d.ci[0] > 0 || d.ci[1] < 0) ? `${s}v${s} ${pp(d.d)} 个百分点（${pct(a.firstRate)} → ${pct(b.firstRate)}）` : null;
  }).filter(Boolean);
}

/* ---------- 报告 ---------- */
const pct = x => (x == null ? "—" : (x * 100).toFixed(1) + "%");
const pp = x => (x == null ? "—" : (x >= 0 ? "+" : "") + (x * 100).toFixed(1));
const f1 = x => (x == null ? "—" : Number(x).toFixed(1));
const f2 = x => (x == null ? "—" : Number(x).toFixed(2));
const ciText = ci => (ci ? `${(ci[0] * 100).toFixed(1)}–${(ci[1] * 100).toFixed(1)}%` : "—");
const rateCell = s => `**${pct(s.firstRate)}**（${ciText(s.ci)}）`;
const SIZE_NAME = s => (s === "all" ? "合计" : `${s}v${s}`);
const LEVEL_NAME = L => (L === "all" ? "合计" : `${L} 级`);
/** 先手胜率的一句话判断：区间整个在 50% 以上 / 以下才算有优势 */
function edgeText(s) {
  if (!s || s.firstRate == null) return "没有样本";
  if (s.ci[0] > 0.5) return `先手占优（先手胜率 ${pct(s.firstRate)}，区间整个在 50% 以上）`;
  if (s.ci[1] < 0.5) return `后手占优（先手胜率 ${pct(s.firstRate)}，区间整个在 50% 以下）`;
  return `看不出先后手差别（先手胜率 ${pct(s.firstRate)}，区间包含 50%）`;
}
function cellTable(l, S, variant, kind, sizes, levels, extra) {
  l.push(`|人数|等级|场数|先手胜 / 后手胜 / 平局 / 超时|先手胜率（95% 区间）|平均回合（中位 / P90）|${extra ? extra.head + "|" : ""}`);
  l.push(`|---|---|---:|---|---|---|${extra ? "---|" : ""}`);
  for (const s of sizes.concat(sizes.length > 1 ? ["all"] : [])) for (const L of levels.concat(levels.length > 1 ? ["all"] : [])) {
    const x = S[[variant, kind, s, L].join("|")];
    if (!x) continue;
    l.push(`|${SIZE_NAME(s)}|${LEVEL_NAME(L)}|${x.n - x.errors}|${x.F} / ${x.S} / ${x.D} / ${x.T}|${rateCell(x)}|${f1(x.rounds)}（${f1(x.roundsMed)} / ${f1(x.roundsP90)}）|${extra ? extra.cell(x, s, L) + "|" : ""}`);
  }
}
function markdown(report) {
  const S = report.summary, o = report.options, sizes = o.sizes, levels = o.levels, has = v => o.variants.includes(v);
  const get = (v, s = "all", L = "all", kind = "random") => S[[v, kind, s, L].join("|")];
  const base = get("base"), l = [];
  l.push("# PvP 平衡模拟：先手 / 后手、失衡滚雪球（issue #491）", "");
  l.push(`工具 \`tools/pvp-balance.js\`（${report.version}），提交 \`${report.provenance.commit || "?"}\`${report.provenance.dirty ? "（工作区有未提交的改动）" : ""}，Node ${report.provenance.node}。` +
    `命令：\`${report.provenance.command}\`。规则源码 SHA256：\`${report.provenance.sourceHash.slice(0, 16)}…\`。`, "");
  l.push("**只测量、不改规则。** 「临时关掉」的对照（后手补偿、起身翻滚）只在模拟里、每一场自己的规则环境里改，游戏文件和配置都没动。", "");
  // ---- 一句话结论 ----
  l.push("## 一句话结论", "");
  if (base) {
    l.push(`- **先手 / 后手**：现在的规则下，${edgeText(base)}；随机阵容 ${base.n - base.errors} 场（${sizes.length} 种人数 × ${levels.length} 个等级，每对阵容先后手对调各打一场）。`);
    if (sizes.length > 1 || levels.length > 1) l.push(`- 按人数：${sizes.map(s => `${s}v${s} ${pct((get("base", s) || {}).firstRate)}`).join("、")}；按等级：${levels.map(L => `${L} 级 ${pct((get("base", "all", L) || {}).firstRate)}`).join("、")}（先手胜率）。`);
  }
  if (has("noLate") && base) { const x = get("noLate"), d = diff(base, x); if (x && d) l.push(`- **后手补偿**：关掉补偿时先手胜率 ${pct(x.firstRate)}，有补偿 ${pct(base.firstRate)}：补偿把先手胜率改变了 ${pp(d.d)} 个百分点（95% 区间 ${pp(d.ci[0])} ~ ${pp(d.ci[1])}）。`); }
  if (has("noStand") && base) { const x = get("noStand"); if (x) l.push(`- **不允许起身**：先手胜率 ${pct(x.firstRate)}（${ciText(x.ci)}），平均 ${f1(x.rounds)} 回合（允许起身 ${f1(base.rounds)} 回合）。`); }
  if (has("rounds") && base) { const x = get("rounds"); if (x) l.push(`- **回合上限 10**：${pct(x.drawRate)} 平局，${pct((x.n - x.errors) ? report.rows.filter(r => r.v === "rounds" && r.k === "random" && r.why === "rounds").length / (x.n - x.errors) : null)} 的场次打满 10 回合按剩余血量判；先手胜率 ${pct(x.firstRate)}（${ciText(x.ci)}）。`); }
  if (has("noRoll") && base) { const x = get("noRoll"), d = diff(base, x); if (x && d) l.push(`- **起身翻滚**：关掉翻滚时先手胜率 ${pct(x.firstRate)}，有翻滚 ${pct(base.firstRate)}（差 ${pp(d.d)} 个百分点，95% 区间 ${pp(d.ci[0])} ~ ${pp(d.ci[1])}）；平均回合 ${f1(x.rounds)} → ${f1(base.rounds)}。`); }
  if (base) l.push(`- **失衡滚雪球**：先打出第一次失衡的一方最后赢了 ${pct(base.stag.rate)}（${ciText(base.stag.ci)}）；先打倒对方第一个人的一方赢了 ${pct(base.down.rate)}（${ciText(base.down.ci)}）；全员倒地后又起身的一队最后翻盘 ${base.wipes.n ? pct(base.wipes.won / base.wipes.n) : "—"}。`);
  const holdCp = (report.companions || []).find(cp => cp.summary["hold|random|all|all"]);
  if (base && holdCp) {
    const h = holdCp.summary["hold|random|all|all"], dh = diff(h, base), sig = holdSig(holdCp, base ? S : null, sizes);
    l.push(`- **只改 AI：先手第一回合原地等**（不走过去，等对面过来）：先手胜率 ${pct(h.firstRate)}（${ciText(h.ci)}），和现在的打法比 ${pp(dh.d)} 个百分点（${pp(dh.ci[0])} ~ ${pp(dh.ci[1])}）——「谁先走过去」${dh.ci[0] <= 0 && dh.ci[1] >= 0 ? "合计看不出影响" : "有影响"}${sig.length ? `，${sig.join("、")}` : ""}（见第 9 节）。`);
  }
  l.push("");
  // ---- 怎么测的 ----
  l.push("## 怎么测的", "");
  l.push(`- **决斗规则照游戏**（#472 / PR #480）：3 区制，1 队站 1 区、2 队站 3 区；先手在我方回合、后手在敌人回合行动；后手开局每人 ${report.ruleSnapshot.lateBonus} 个附赠（先手的第一回合里就能协助格挡，没用掉的留着）；伤害不会致死（坚毅生命打到 ${report.ruleSnapshot.outShp} 再起不能、移出战场）；一队全部倒地另一队赢；全员倒地但还能起身时回合结束前先问（#470）；起身可以免费翻滚到相邻区（#477）。`);
  l.push(`- **镜像对局**：每对阵容打两场，只对调先后手（抛硬币由工具定），同一个战斗种子；所以「先手胜率」里阵容强弱正好抵消。偶数序号的阵容 A 站 1 队、奇数站 2 队，站位也抵消。`);
  l.push(`- **阵容**：随机阵容从 ${B.HEROES.length} 名角色（${B.HEROES.join("、")}）里按种子抽，两队角色不重复（同一个角色不能同时在两队）；每格 ${o.pairs} 对 = ${o.pairs * 2} 场。同一个序号的阵容、种子对每种情况、每个等级都一样。另有 ${FIXED.length} 组固定阵容，每组每个等级 ${o.fixedPairs} 对。`);
  l.push(`- **等级**：${levels.join(" / ")} 级，照 R1 单场矩阵：升级选主属性 / 第一个合法选项，武器等级 = 等级 × 0.6（最高 10），满状态、没有义体、不用道具。`);
  l.push(`- **打法**（两队一样）：\`BattleSim.BASIC_POLICY\`——能打到就普攻血量最少的对手，打不到就用附赠走一格；能协助格挡就挡（挑成功率最高的人），能协助攻击就打（挑攻击力最高的人）；倒地能起身就起身；起身翻滚开着时按站位翻（远程躲开同区的对手、近战翻到有对手的区）。不用技能、道具、召唤武器人。`);
  l.push(`- **胜率**：先手胜率 = 先手赢的场数 ÷ 分出胜负的场数（平局、超时不算进分母，另列）；区间是 Wilson 95%。差值的区间按两组独立算（实际两组用同一批阵容和种子，偏保守）。不限回合时打到 ${o.maxRounds} 回合还没分出胜负记「超时」。`);
  l.push(`- **情况**：${o.variants.map(v => `${VARIANTS[v].name}（\`${v}\`：${VARIANTS[v].note}）`).join("；")}。`);
  l.push(`- **原始数据**：同名的 \`.json\`（\`rows\` 每场一行，字段说明在 \`columns\`：情况、阵容序号、等级、谁先手、结果、回合、第一次失衡 / 倒地 / 再起不能是哪一方打出的和第几回合、双方打出的失衡 / 倒地数、协助格挡次数、全员倒地被问的记录）。重新生成报告：\`node tools/pvp-balance.js --rebuild ${o.out || CONFIG.out}\`。`, "");
  // ---- 各节 ----
  const section = (v, title, lead, extra) => {
    if (!has(v)) return;
    l.push(`## ${title}`, "");
    if (lead) l.push(lead, "");
    cellTable(l, S, v, "random", sizes, levels, extra);
    l.push("", `一句话：${edgeText(get(v))}。`, "");
  };
  section("base", "1. 先手 vs 后手（现在的规则）", "随机阵容，每对先后手各一场。", { head: "后手在先手第 1 回合协助格挡（次 / 场）", cell: x => f2(x.blk1) });
  if (base && report.lineups && report.heroes) {
    // 先手胜率和两队的近战人数（随机阵容；每对阵容先后手各一场，所以「先手近战多」和「先手近战少」的场数一样）
    const melee = k => /^近战/.test((report.heroes[k] || {}).range || "");
    const rows = report.rows.filter(r => r.v === "base" && r.k === "random" && (r.w === "F" || r.w === "S"));
    const tag = r => {
      const lu = report.lineups[`${r.s}:${r.i}`];
      if (!lu) return null;
      const first = r.f === "a" ? lu.a : lu.b, second = r.f === "a" ? lu.b : lu.a, d = first.filter(melee).length - second.filter(melee).length;
      return d > 0 ? "more" : d < 0 ? "less" : "same";
    };
    // 近战多的一方：先手时（tag more，赢 = 先手赢）、后手时（tag less，赢 = 后手赢）——同一批阵容对调先后手，阵容强弱抵消，只剩先后手的差别
    const part = (xs, t, w) => { const g = xs.filter(r => tag(r) === t), n = g.filter(r => r.w === w).length; return { n: g.length, won: n, rate: g.length ? n / g.length : null, ci: B.wilson(n, g.length) }; };
    l.push("**1b. 近战多的一方当先手 / 后手**（近战 / 远程按普攻射程分，见第 8 节；同一对阵容先后手对调，只看分出胜负的场次）", "");
    l.push("|人数|近战多的一方当先手：场数 / 这一方胜率|近战多的一方当后手：场数 / 这一方胜率|差（先手 − 后手，百分点）|两队近战一样多：场数 / 先手胜率|");
    l.push("|---|---|---|---:|---|");
    sizes.concat(["all"]).forEach(s => {
      const xs = rows.filter(r => s === "all" || r.s === s), a = part(xs, "more", "F"), b = part(xs, "less", "S"), e = part(xs, "same", "F");
      const cell = x => (x.n ? `${x.n} / **${pct(x.rate)}**（${ciText(x.ci)}）` : "—");
      l.push(`|${SIZE_NAME(s)}|${cell(a)}|${cell(b)}|${a.n && b.n ? pp(a.rate - b.rate) : "—"}|${cell(e)}|`);
    });
    const all = { a: part(rows, "more", "F"), b: part(rows, "less", "S") };
    l.push("", `一句话：这套打法下近战多的一方本来就占优（当先手赢 ${pct(all.a.rate)}、当后手赢 ${pct(all.b.rate)}），阵容的影响比先后手大得多；近战多的一方当后手${all.a.rate < all.b.rate ? "略好" : "并不更好"}（差 ${pp(all.a.rate - all.b.rate)} 个百分点，各人数见上表）。`, "");
  }
  if (has("base")) {
    const fixedRows = FIXED.filter(f => sizes.includes(f.a.length));
    if (fixedRows.length && o.fixedPairs) {
      l.push("## 2. 固定阵容（现在的规则）", "", "每组每个等级只换种子；A / B 两队各当一半先手。", "");
      l.push("|阵容|A 队|B 队|等级|场数|先手胜 / 后手胜 / 平局 / 超时|先手胜率（95% 区间）|A 队胜率|平均回合|");
      l.push("|---|---|---|---|---:|---|---|---:|---:|");
      fixedRows.forEach(f => levels.concat(levels.length > 1 ? ["all"] : []).forEach(L => {
        const x = S[["base", f.id, f.a.length, L].join("|")];
        if (!x) return;
        const rows = report.rows.filter(r => r.k === f.id && (L === "all" || r.L === L) && (r.w === "F" || r.w === "S"));
        const aWins = rows.filter(r => (r.w === "F") === (r.f === "a")).length;
        l.push(`|${f.id}|${f.a.map(report.heroNames).join("、")}|${f.b.map(report.heroNames).join("、")}|${LEVEL_NAME(L)}|${x.n - x.errors}|${x.F} / ${x.S} / ${x.D} / ${x.T}|${rateCell(x)}|${pct(rows.length ? aWins / rows.length : null)}|${f1(x.rounds)}|`);
      }));
      const all = fixedRows.map(f => S[["base", f.id, f.a.length, "all"].join("|")]).filter(Boolean);
      const adv = all.filter(x => x.ci && x.ci[0] > 0.5).length, dis = all.filter(x => x.ci && x.ci[1] < 0.5).length;
      l.push("", `一句话：${all.length} 组固定阵容里，${adv} 组先手明显占优、${dis} 组后手明显占优、${all.length - adv - dis} 组看不出差别（各组合计三个等级）。`, "");
    }
  }
  if (has("noLate") && base) {
    l.push("## 3. 后手补偿：有 vs 临时关掉", "", "关掉 = 只在模拟里把 `PVP_DUEL_CFG.lateBonus` 改成 0（后手开局没有附赠，先手的第一回合里不能协助格挡）。同一批阵容和种子。", "");
    l.push("|人数|等级|有补偿：先手胜率|关掉补偿：先手胜率|补偿把先手胜率改变（百分点，95% 区间）|有补偿时后手第 1 回合协助格挡（次 / 场）|");
    l.push("|---|---|---|---|---|---:|");
    for (const s of sizes.concat(["all"])) for (const L of levels.concat(["all"])) {
      const a = get("base", s, L), b = get("noLate", s, L);
      if (!a || !b) continue;
      const d = diff(a, b);
      l.push(`|${SIZE_NAME(s)}|${LEVEL_NAME(L)}|${rateCell(a)}|${rateCell(b)}|${d ? `${pp(d.d)}（${pp(d.ci[0])} ~ ${pp(d.ci[1])}）` : "—"}|${f2(a.blk1)}|`);
    }
    const d = diff(base, get("noLate"));
    l.push("", `一句话：${d ? `补偿让先手胜率${d.d < 0 ? "下降" : "上升"} ${Math.abs(d.d * 100).toFixed(1)} 个百分点（${pp(d.ci[0])} ~ ${pp(d.ci[1])}）${d.ci[0] <= 0 && d.ci[1] >= 0 ? "，区间包含 0：合计看不出补偿的作用" : ""}` : "没有样本"}；关掉补偿时${edgeText(get("noLate"))}。`, "");
  }
  section("noStand", "4. 决斗选项：不允许起身", "决斗选项「允许起身」不勾：倒地的人留在场上起不来，全队倒地就输。和第 1 节（允许起身）同一批阵容和种子。");
  if (has("rounds")) {
    const rows = report.rows.filter(r => r.v === "rounds" && r.k === "random" && r.w !== "E");
    const pick = (s, L) => rows.filter(r => (s === "all" || r.s === s) && (L === "all" || r.L === L));
    section("rounds", "5. 决斗选项：回合上限 10 回合", "决斗选项「限定回合数」勾上（默认 10 回合）：打满还没分出胜负，剩余血量百分比（只算各层血量，不算坚毅生命，倒地的按 0）多的一队赢，一样算平局。和第 1 节（不限回合）同一批阵容和种子。", {
      head: "打满 10 回合按血量判 / 其中平局", cell: (x, s, L) => {
        const xs = pick(s, L), limit = xs.filter(r => r.why === "rounds"), draw = limit.filter(r => r.w === "D");
        return `${pct(xs.length ? limit.length / xs.length : null)} / ${pct(xs.length ? draw.length / xs.length : null)}`;
      } });
    const limit = rows.filter(r => r.why === "rounds"), zero = limit.filter(r => r.pct && r.pct[0] === 0 && r.pct[1] === 0);
    if (limit.length) l.splice(l.length - 1, 0, `打满回合按血量判的 ${limit.length} 场里，${zero.length} 场两队剩余血量都是 0%（场上的人都在靠坚毅生命战斗或倒地）——这些都判成平局。`, "");
  }
  // 情况 vs 现在的规则（同一批阵容和种子）：起身翻滚，以及只改 AI 的对照（单独跑的报告里）
  const versus = (v, title, lead) => {
    const x = get(v);
    if (!x || !base) return;
    l.push(`## ${title}`, "", lead, "");
    l.push(`|人数|等级|现在：先手胜率|${VARIANTS[v].name}：先手胜率|差（百分点，95% 区间）|现在：平均回合|${VARIANTS[v].name}：平均回合|`);
    l.push("|---|---|---|---|---|---:|---:|");
    for (const s of sizes.concat(["all"])) for (const L of levels.concat(["all"])) {
      const a = get("base", s, L), b = get(v, s, L);
      if (!a || !b) continue;
      const d = diff(b, a);
      l.push(`|${SIZE_NAME(s)}|${LEVEL_NAME(L)}|${rateCell(a)}|${rateCell(b)}|${d ? `${pp(d.d)}（${pp(d.ci[0])} ~ ${pp(d.ci[1])}）` : "—"}|${f1(a.rounds)}|${f1(b.rounds)}|`);
    }
    const d = diff(x, base);
    l.push("", `一句话：${VARIANTS[v].name}时${edgeText(x)}${d ? `；和现在比，先手胜率 ${pp(d.d)} 个百分点（${pp(d.ci[0])} ~ ${pp(d.ci[1])}）${d.ci[0] <= 0 && d.ci[1] >= 0 ? "，区间包含 0：看不出影响" : ""}` : ""}。`, "");
  };
  if (has("noRoll")) versus("noRoll", "6. 起身翻滚：有 vs 临时关掉", "关掉 = 只在模拟里让起身时都原地起身（不翻滚）。同一批阵容和种子。");
  o.variants.filter(v => !DEFAULT_VARIANTS.includes(v)).forEach(v => versus(v, `6. 只改 AI 的对照：${VARIANTS[v].name}`, `${VARIANTS[v].note}。阵容、种子和第 1 节相同。`));
  // ---- 失衡滚雪球 ----
  if (base) {
    l.push("## 7. 失衡滚雪球（docs/pvp.md 第 7 节）", "", "「先打出第一次失衡的一方」= 对面第一个被打进失衡的人是谁打的；「先打倒对方第一个人」= 对面第一个倒地（濒死）的；「先让对方一人再起不能」= 对面第一个坚毅打到 1、移出战场的。只看分出胜负的场次。", "");
    l.push("|情况|人数|事件|有这件事的场数|这一方最后赢|其中先手打出：场数 / 赢|其中后手打出：场数 / 赢|平均第几回合|");
    l.push("|---|---|---|---:|---|---|---|---:|");
    const ev = [["stag", "第一次失衡"], ["down", "第一次打倒"], ["out", "第一次再起不能"]];
    for (const v of o.variants.filter(v => get(v))) for (const s of sizes.concat(["all"])) {
      const x = get(v, s);
      if (!x) continue;
      if (v !== "base" && s !== "all") continue;
      ev.forEach(([k, name]) => {
        const e = x[k];
        if (!e.n) return;
        l.push(`|${VARIANTS[v].name}|${SIZE_NAME(s)}|${name}|${e.n}|**${pct(e.rate)}**（${ciText(e.ci)}）|${e.byFirst.n} / ${pct(e.byFirst.rate)}|${e.bySecond.n} / ${pct(e.bySecond.rate)}|${f1(e.turn)}|`);
      });
    }
    l.push("", "「全员倒地后起身」：一队所有人都倒地（没人站着）以后又有人起身、接着打。照 #470，回合结束前会问全员倒地的那一队要不要起身；后手（在敌人回合行动）在先手的回合里被打得全员倒地时，轮到自己的回合就能起身，不会被问——两种都算进来，「被问」那一列只算回合结束前问的。每场每一方只算第一次。", "");
    l.push("|情况|人数|场数|平均回合（中位 / P90）|平局|超时|每场失衡（先手打出 / 后手打出）|全员倒地后起身：次数（先手 / 后手）|其中起身的一队最后赢（先手 / 后手）|其中回合结束前被问：次数 / 最后赢|");
    l.push("|---|---|---:|---|---:|---:|---|---|---|---|");
    for (const v of o.variants.filter(v => get(v))) for (const s of sizes.concat(["all"])) {
      const x = get(v, s);
      if (!x || (v !== "base" && s !== "all")) continue;
      const w = x.wipes, a = x.asks;
      l.push(`|${VARIANTS[v].name}|${SIZE_NAME(s)}|${x.n - x.errors}|${f1(x.rounds)}（${f1(x.roundsMed)} / ${f1(x.roundsP90)}）|${pct(x.drawRate)}|${pct(x.timeoutRate)}|${f2(x.stagPerGame)}（${f2(x.stagF)} / ${f2(x.stagS)}）|` +
        `${w.n}（${w.bySide.F} / ${w.bySide.S}）|${w.n ? `**${pct(w.won / w.n)}**（${ciText(w.ci)}；${w.bySide.Fwon} / ${w.bySide.Swon}）` : "—"}|${a.n ? `${a.n} / ${pct(a.won / a.n)}` : "—"}|`);
    }
    const w = base.wipes;
    l.push("", `一句话：现在的规则下，先打出第一次失衡的一方赢了 ${pct(base.stag.rate)}，先打倒对方第一个人的一方赢了 ${pct(base.down.rate)}，先让对方一人再起不能的一方赢了 ${pct(base.out.rate)}；全员倒地后又起身的一队最后翻盘 ${w.n ? pct(w.won / w.n) : "—"}（${w.n} 次${base.asks.n ? `，其中回合结束前被问后起身的 ${base.asks.n} 次翻盘 ${pct(base.asks.won / base.asks.n)}` : ""}）。`, "");
  }
  // ---- 角色 ----
  l.push("## 8. 参考：角色在这套打法下的普攻射程和血量", "");
  l.push("|角色|普攻射程|" + levels.map(L => `${L} 级 血量 / 架势`).join("|") + "|");
  l.push("|---|---|" + levels.map(() => "---").join("|") + "|");
  Object.keys(report.heroes).forEach(k => {
    const h = report.heroes[k];
    l.push(`|${h.name}（\`${k}\`）|${h.range}|${levels.map(L => (h.byLevel[L] ? `${h.byLevel[L].hp} / ${h.byLevel[L].def}` : "—")).join("|")}|`);
  });
  l.push("");
  // ---- 只改 AI 的对照（同名前缀的单独报告，companionsOf） ----
  const comps = (report.companions || []).filter(cp => (cp.options.variants || []).some(v => v !== "base"));
  if (comps.length) {
    l.push("## 9. 只改 AI 的对照（单独的报告）", "", "规则和「现在的规则」完全一样，只改 AI 的打法；阵容、种子和第 1 节相同，所以「现在的打法」那一列和第 1 节一样。", "");
    comps.forEach(cp => cp.options.variants.filter(v => v !== "base").forEach(v => {
      const V = VARIANTS[v] || { name: v, note: "" }, get2 = (vv, s) => cp.summary[[vv, "random", s, "all"].join("|")];
      l.push(`**${V.name}**（\`${v}\`：${V.note}；详见 [${cp.file}.md](${cp.file}.md)）`, "");
      l.push(`|人数|现在的打法：先手胜率|${V.name}：先手胜率|差（百分点，95% 区间）|平均回合（现在 → ${V.name}）|`);
      l.push("|---|---|---|---|---|");
      (cp.options.sizes || []).concat(["all"]).forEach(s => {
        const a = get2("base", s), b = get2(v, s);
        if (!a || !b) return;
        const d = diff(b, a);
        l.push(`|${SIZE_NAME(s)}|${rateCell(a)}|${rateCell(b)}|${d ? `${pp(d.d)}（${pp(d.ci[0])} ~ ${pp(d.ci[1])}）` : "—"}|${f1(a.rounds)} → ${f1(b.rounds)}|`);
      });
      const b = get2(v, "all");
      l.push("", `一句话：${b ? `${V.name}时${edgeText(b)}` : "没有样本"}。`, "");
    }));
  }
  // ---- bug ----
  l.push(`## ${comps.length ? 10 : 9}. 撞到的问题`, "");
  const errs = report.rows.filter(r => r.w === "E"), bugRows = report.rows.filter(r => r.bugs);
  if (!errs.length && !bugRows.length) l.push(`跑了 ${report.rows.length} 场，没有脚本异常，自检（没人真的死亡、全倒判负的一队没人站着、规则没有 console.error）都通过。`);
  else {
    const group = new Map();
    errs.forEach(r => { const k = "异常：" + r.err; group.set(k, (group.get(k) || []).concat([r])); });
    bugRows.forEach(r => r.bugs.forEach(b => group.set(b, (group.get(b) || []).concat([r]))));
    l.push(`跑了 ${report.rows.length} 场；异常 ${errs.length} 场，自检没通过 ${bugRows.length} 场（找 bug 是 #490，这里只记下来）：`, "");
    [...group.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 12).forEach(([k, list]) => {
      const r = list[0];
      l.push(`- ${list.length} 场：${k.replace(/\|/g, "／")}（例：\`${r.v}\` ${r.k} ${r.s}v${r.s} ${r.L} 级 序号 ${r.i} ${r.f === "a" ? "A" : "B"} 先手）`);
    });
  }
  l.push("");
  // ---- 建议 / 注意（按数据挑的方向 + 固定的局限说明，notesFor）；「注意」放在最后 ----
  if (report.notes && report.notes.suggest) l.push(`## ${comps.length ? 11 : 10}. 建议（只是建议，没有改）`, "", ...report.notes.suggest, "");
  if (report.notes && report.notes.caveats) l.push("## 注意", "", ...report.notes.caveats);
  return l.join("\n") + "\n";
}

/* ---------- 报告里的文字（建议 / 注意） ---------- */
// 建议按数据挑方向：先手 / 后手哪边明显占优就列对应的调整方向；都不明显就写「暂时不用调」。「注意」是固定的局限说明
function notesFor(report) {
  const S = report.summary, get = (v, s = "all", L = "all") => S[[v, "random", s, L].join("|")];
  const base = get("base"), noLate = get("noLate"), noStand = get("noStand"), sizes = report.options.sizes;
  const side = x => (x && x.ci ? (x.ci[0] > 0.5 ? "先手" : x.ci[1] < 0.5 ? "后手" : null) : null);
  const hold = (report.companions || []).map(cp => cp.summary["hold|random|all|all"]).find(Boolean);
  const suggest = [], caveats = [];
  if (base) {
    const lean = sizes.map(s => [s, get("base", s)]).filter(([, x]) => side(x)).map(([s, x]) => `${s}v${s} ${side(x)}占优（${pct(x.firstRate)}，${ciText(x.ci)}）`);
    const head = `现在的规则下合计先手胜率 ${pct(base.firstRate)}（${ciText(base.ci)}）`;
    const d = noLate ? diff(base, noLate) : null;
    if (side(base) === "先手") {
      suggest.push(`- **先后手**：${head}，先手明显占优${lean.length ? "；分人数：" + lean.join("、") : ""}。可以考虑（任选其一、先小步）：`);
      suggest.push("  - 加大后手补偿：开局给后手每人 2 个附赠（`PVP_DUEL_CFG.lateBonus` 1 → 2），或者 1 个附赠 + 第一回合架势 +1；");
      suggest.push("  - 削弱先手的第一回合：先手第一回合没有行动点（只能走位 / 格挡），类似很多对战游戏「先手第一回合不能攻击」。");
    } else if (side(base) === "后手") {
      const small = base.firstRate > 0.45;
      suggest.push(`- **先后手**：${head}，后手${small ? "略" : "明显"}占优${lean.length ? "（分人数：" + lean.join("、") + "）" : ""}${small ? "，差得不多（不到 5 个百分点，比阵容强弱的影响小得多，见第 2 节），可以先不动，等真人对局再看" : ""}。如果要调，可以考虑：`);
      suggest.push(`  - 补偿稍微减一点：${d ? `关掉补偿时先手胜率 ${pct(noLate.firstRate)}（先手占优），有补偿 ${pct(base.firstRate)}，1 个附赠的补偿略多了一点；` : ""}例如补偿的附赠只在先手的第一回合里有效（只能拿来协助格挡，不留到后手自己的回合），或者人多（3v3、4v4）时补偿的作用更大，可以只在 1v1、2v2 给。`);
    } else suggest.push(`- **先后手**：${head}，整体看不出明显的先后手优势，暂时不用为先后手调数值${lean.length ? `；分人数看 ${lean.join("、")}，可以等真人对局再确认` : ""}。`);
    if (d) {
      const how = d.ci[1] < 0 ? "明显把先手胜率往下拉" : d.ci[0] > 0 ? "反而把先手胜率往上推" : "作用不明显（区间包含 0）";
      suggest.push(`- **后手补偿**：关掉补偿时先手胜率 ${pct(noLate.firstRate)}（${side(noLate) ? side(noLate) + "明显占优" : "看不出差别"}），有补偿 ${pct(base.firstRate)}：补偿${how}，${pp(d.d)} 个百分点（${pp(d.ci[0])} ~ ${pp(d.ci[1])}）。` +
        (side(noLate) === "先手" && !side(base) ? "补偿正好把先手的优势抹平，现在的 1 个附赠合适，不用改。" : side(noLate) === "先手" && side(base) === "后手" ? "方向对，但力度略大：从先手占优变成了后手略占优。" : ""));
    }
    if (noStand && side(noStand) && (side(noStand) !== side(base) || Math.abs(noStand.firstRate - base.firstRate) > 0.05)) {
      const share = base.down.n ? base.down.bySecond.n / base.down.n : null;
      suggest.push(`- **不允许起身**：这个选项下先手胜率 ${pct(noStand.firstRate)}（${ciText(noStand.ci)}），${side(noStand)}明显占优（允许起身时 ${pct(base.firstRate)}）。倒地就再也起不来时，谁先打倒人更值钱，而先打倒对方第一个人的多半是后手（现在的规则下 ${pct(share)} 的「第一次打倒」是后手打出的：先手第一回合走到 2 区后没有附赠协助格挡，后手的补偿附赠又能挡）。如果这个选项常用，可以考虑选了「不允许起身」时${side(noStand) === "后手" ? "不给后手补偿，或者补偿只在先手的第一回合里有效" : "加大后手补偿"}，定之前可以先用这个工具跑一下（这里没有跑「不允许起身 + 关掉补偿」的组合）。`);
    }
    const rows = (report.rows || []).filter(r => r.v === "rounds" && r.k === "random" && r.w !== "E");
    const limit = rows.filter(r => r.why === "rounds"), zero = limit.filter(r => r.pct && r.pct[0] === 0 && r.pct[1] === 0);
    if (zero.length) suggest.push(`- **回合上限的平局**：打满 10 回合按剩余血量判的 ${limit.length} 场里有 ${zero.length} 场两队都是 0%（场上的人都在靠坚毅生命战斗或倒地），只能判平局。可以考虑加一条不用坚毅数值的判法，例如百分比一样时比「还站着的人数」（倒地、再起不能的不算），再一样才算平局——不会透露坚毅数值。`);
    const stag = base.stag, down = base.down;
    if (stag.rate != null) suggest.push(stag.rate > 0.65
      ? `- **失衡滚雪球**：先打出第一次失衡的一方赢了 ${pct(stag.rate)}（${ciText(stag.ci)}；1v1 里 ${pct((get("base", 1) || {}).stag ? get("base", 1).stag.rate : null)}），第一次失衡和胜负关系很强（不过先打出失衡往往也说明这一方本来就占上风，不全是失衡本身的作用）；先打倒对方第一个人的一方赢了 ${pct(down.rate)}。如果想减弱：PvP 里失衡只跳过行动点、保留附赠（还能协助格挡），或者 PvP 里协助攻击不回满协助者的架势，或者每回合每队只能接一次协助攻击。`
      : `- **失衡滚雪球**：先打出第一次失衡的一方赢了 ${pct(stag.rate)}，关系不算特别强，暂时不用专门调。`);
    if (hold) {
      const cp = report.companions.find(x => x.summary["hold|random|all|all"]), dh = diff(hold, base), sig = holdSig(cp, S, sizes), none = dh.ci[0] <= 0 && dh.ci[1] >= 0;
      suggest.push(`- **先走过去吃不吃亏**：只改 AI、让先手第一回合原地等对面过来时，先手胜率 ${pct(hold.firstRate)}（${ciText(hold.ci)}；和现在的打法比 ${pp(dh.d)} 个百分点，${pp(dh.ci[0])} ~ ${pp(dh.ci[1])}，见第 9 节）${sig.length ? `；分人数看 ${sig.join("、")}` : ""}。` +
        (none ? "合计看不出影响：后手略占优主要来自补偿，不是「先走过去」。" : "") + (sig.length ? "人多时先走过去的一方会先被集火，真人先手可以选择原地等。" : "") +
        "真人对局里如果双方都不愿先过去，开了回合上限时就是平局；这套打法下「先走过去」的影响不大，暂时不用为它改开局站位。");
    }
  }
  caveats.push("- **自动打法和真人差很多**：两队都是 `BASIC_POLICY`，只会普攻血量最少的对手、打不到就用附赠走一格，**不用任何技能、道具，不召唤武器人**。真人会用技能（很多技能的击破比普攻高，失衡会来得更早、更多）、集火、走位、留附赠格挡、故意拖回合等，先后手的差别可能更大也可能更小。");
  caveats.push("- **AI 总是主动走过去**：3 区开局两队隔一个区，先手第一回合会用附赠走到 2 区（近战还打不到人，也没有附赠协助格挡），后手接着就能打到它。第 9 节有只改 AI 的对照（先手第一回合原地等）；真人如果双方都等，结果取决于谁先忍不住，这里测不到。");
  caveats.push("- **这套打法下近战占便宜**：AI 不会拉开距离放风筝，远程角色（血量、架势普遍低一些）被近战贴上就吃亏，所以近战多的阵容胜率很高（第 1b 节）。先手胜率用镜像对局把阵容抵消了，但「哪个角色强」不要从这份报告里下结论。");
  caveats.push("- **协助格挡 / 协助攻击总是用**：AI 能挡就挡、能协助攻击就打，不会为了留附赠移动而不挡；真人会权衡。后手补偿的价值主要在协助格挡上，所以这里测出来的补偿作用依赖这一点。");
  caveats.push("- **起身翻滚的用法是简单规则**：远程翻离同区的对手、近战翻到有对手的区；真人可能用得更好（例如翻到对手够不着、自己又能打到的地方），所以翻滚的影响可能被低估。");
  caveats.push("- **角色培养是固定的**：升级选主属性 / 第一个合法选项，武器等级 = 等级 × 0.6，没有义体、图纸、改装件；真实的 PvP 里两边的养成差别可能比先后手的影响大得多（第 2 节固定阵容里，阵容强弱能把一方的胜率拉到 90% 以上）。");
  caveats.push("- **阵容**：随机阵容来自 11 名角色，两队角色不重复；没有测两队人数不一样（例 4 对 2）、没有测友伤开关；决斗本来就是空场地，没有地形 / 天气。");
  caveats.push("- **「失衡滚雪球」是相关、不是因果**：先打出失衡的一方往往本来就占上风（阵容、骰子），所以它的高胜率不全是失衡本身带来的；镜像对局只抵消了先后手和阵容的平均影响。");
  caveats.push("- **统计**：每格几百场，单格的 95% 区间大约 ±5–6 个百分点，单格的小差别不要过度解读，看合计和趋势；不同情况用的是同一批阵容和种子，差值的区间按独立样本算，偏保守。");
  return { suggest, caveats };
}

/* ---------- 技能版 vs 普攻版（#538） ---------- */
const meleeKit = (heroes, k) => /^近战/.test((heroes[k] || {}).range || "");
/** 普攻版里的随机阵容场次（只要技能版也跑了的情况、人数、等级）；paired：序号也在技能版的对数以内（同一批阵容、种子） */
function basicRows(report, basic, paired) {
  const o = report.options;
  return (basic ? basic.rows : []).filter(r => r.k === "random" && o.variants.includes(r.v) && o.sizes.includes(r.s) && o.levels.includes(r.L) && (!paired || r.i < o.pairs));
}
/** 近战多的一方（按普攻射程分，第 8 节）最后赢没赢：不分先后手合计，再分它当先手 / 当后手 */
function meleeStats(rows, lineups, heroes, size) {
  const xs = rows.filter(r => r.v === "base" && r.k === "random" && (r.w === "F" || r.w === "S") && (size === "all" || r.s === size));
  const o = { n: 0, won: 0, nF: 0, wF: 0, nS: 0, wS: 0, same: 0 };
  xs.forEach(r => {
    const lu = lineups && lineups[`${r.s}:${r.i}`];
    if (!lu) return;
    const first = r.f === "a" ? lu.a : lu.b, second = r.f === "a" ? lu.b : lu.a;
    const d = first.filter(k => meleeKit(heroes, k)).length - second.filter(k => meleeKit(heroes, k)).length;
    if (!d) { o.same++; return; }
    const side = d > 0 ? "F" : "S";
    o.n++; if (r.w === side) o.won++;
    if (side === "F") { o.nF++; if (r.w === "F") o.wF++; } else { o.nS++; if (r.w === "S") o.wS++; }
  });
  return Object.assign(o, { rate: o.n ? o.won / o.n : null, ci: B.wilson(o.won, o.n), rF: o.nF ? o.wF / o.nF : null, rS: o.nS ? o.wS / o.nS : null });
}
/** 每个角色在场的场次（现在的规则、随机阵容、分出胜负的）里，他那一队赢了几场 */
function heroWins(rows, lineups) {
  const out = {};
  rows.filter(r => r.v === "base" && r.k === "random" && (r.w === "F" || r.w === "S")).forEach(r => {
    const lu = lineups && lineups[`${r.s}:${r.i}`];
    if (!lu) return;
    const first = r.f === "a" ? lu.a : lu.b, second = r.f === "a" ? lu.b : lu.a;
    const add = (k, won) => { const x = out[k] || (out[k] = { n: 0, won: 0 }); x.n++; if (won) x.won++; };
    first.forEach(k => add(k, r.w === "F"));
    second.forEach(k => add(k, r.w === "S"));
  });
  return out;
}
const nonBasic = r => Object.keys(r.use || {}).filter(id => !/_aa$/.test(id)).reduce((s, id) => s + r.use[id], 0);
const basicUse = r => Object.keys(r.use || {}).filter(id => /_aa$/.test(id)).reduce((s, id) => s + r.use[id], 0);
/** 遭遇战对照：每一项 × 打法 */
function pveSummary(rows) {
  const by = {};
  rows.filter(r => r.k === "pve").forEach(r => { ["", r.id].forEach(id => { const k = (id || "all") + "|" + r.p; (by[k] = by[k] || []).push(r); }); });
  const out = {};
  Object.keys(by).forEach(k => {
    const xs = by[k].filter(r => r.w !== "E"), won = xs.filter(r => r.w === "W").length;
    out[k] = { n: xs.length, err: by[k].length - xs.length, won, lost: xs.filter(r => r.w === "L").length, rate: xs.length ? won / xs.length : null, ci: B.wilson(won, xs.length),
      rounds: mean(xs.map(r => r.r).filter(Number.isFinite)), roundsWin: mean(xs.filter(r => r.w === "W").map(r => r.r)), hp: mean(xs.map(r => r.hp || 0)), down: mean(xs.map(r => r.hd || 0)),
      skills: mean(xs.map(nonBasic)), aa: mean(xs.map(basicUse)), sm: mean(xs.map(r => r.sm || 0)), it: mean(xs.map(r => r.it || 0)), mv: mean(xs.map(r => r.mv || 0)), bugs: by[k].filter(r => r.bugs).length };
  });
  return out;
}
/** 技能版的报告：每一项和普攻版并排（同一批阵容、种子；另附普攻版 #491 全部样本） */
function compareMarkdown(report, basic) {
  const o = report.options, sizes = o.sizes, levels = o.levels, l = [], has = v => o.variants.includes(v);
  const S = report.summary, P1 = summarizeAll(basicRows(report, basic, true)), P0 = summarizeAll(basicRows(report, basic, false));
  const get = (X, v, s = "all", L = "all") => X[[v, "random", s, L].join("|")];
  const sk = get(S, "base"), bp = get(P1, "base"), b0 = get(P0, "base");
  const perVariant = o.pairs * 2 * sizes.length * levels.length;
  const timing = report.timing || {};
  const sec = k => (timing[k] ? (timing[k].meanMs / 1000).toFixed(1) + " 秒" : "—");
  const dtext = d => (d ? `${pp(d.d)}（${pp(d.ci[0])} ~ ${pp(d.ci[1])}）` : "—");
  const cell = x => (x ? rateCell(x) : "—");
  const basicName = basic ? `普攻版（同一批）` : "普攻版";
  const pve = pveSummary(report.rows);
  l.push("# PvP 平衡模拟：技能版（看情况用技能）对照普攻版（issue #538，#491 的对照）", "");
  l.push(`工具 \`tools/pvp-balance.js\`（${report.version}），提交 \`${report.provenance.commit || "?"}\`${report.provenance.dirty ? "（工作区有未提交的改动）" : ""}，Node ${report.provenance.node}。` +
    `命令：\`${report.provenance.command}\`。规则源码 SHA256：\`${report.provenance.sourceHash.slice(0, 16)}…\`。普攻版的数据：\`${basic ? basic.file + ".json" : "（没找到）"}\`（#491）。`, "");
  l.push("**只测量、不改规则。** 「临时关掉」的对照（后手补偿、起身翻滚）照 #491，只在模拟里、每一场自己的规则环境里改。两队都换成技能版（`BattleSim.SKILL_POLICY`），其余和 #491 一样。", "");
  // ---- 一句话结论 ----
  l.push("## 一句话结论", "");
  if (sk) l.push(`- **先后手**（现在的规则）：技能版${edgeText(sk)}；${basicName} ${pct(bp && bp.firstRate)}（${ciText(bp && bp.ci)}），普攻版 #491 全部 ${pct(b0 && b0.firstRate)}（${ciText(b0 && b0.ci)}）。技能版每种情况 ${perVariant} 场（${sizes.length} 种人数 × ${levels.length} 个等级 × ${o.pairs} 对 × 先后手），区间比 #491 宽。`);
  if (sk && has("noLate")) {
    const ds = diff(sk, get(S, "noLate")), db = diff(bp, get(P1, "noLate")), d0 = diff(b0, get(P0, "noLate"));
    l.push(`- **后手补偿的作用**（有补偿 − 关掉补偿的先手胜率）：技能版 ${dtext(ds)} 个百分点；${basicName} ${dtext(db)}；普攻版全部 ${dtext(d0)}。`);
  }
  if (sk) l.push(`- **滚雪球**：技能版先打出第一次失衡的一方赢了 ${pct(sk.stag.rate)}（${ciText(sk.stag.ci)}；普攻版同一批 ${pct(bp && bp.stag.rate)}），先打倒对方第一个人的一方赢了 ${pct(sk.down.rate)}（${ciText(sk.down.ci)}；普攻版同一批 ${pct(bp && bp.down.rate)}）。每场失衡 ${f2(sk.stagPerGame)} 次（普攻版同一批 ${f2(bp && bp.stagPerGame)}）。`);
  if (sk && report.lineups) {
    const ms = meleeStats(report.rows, report.lineups, report.heroes, "all"), mb = basic ? meleeStats(basicRows(report, basic, true), basic.lineups, report.heroes, "all") : null;
    l.push(`- **近战多 / 远程多**：两队近战人数不一样时，近战多的一方技能版赢 ${pct(ms.rate)}（${ciText(ms.ci)}），${basicName} ${pct(mb && mb.rate)}（${ciText(mb && mb.ci)}）——会用技能、会走位以后，远程${ms.rate != null && mb && mb.rate != null && ms.rate < mb.rate ? "没那么吃亏了" : "照样吃亏"}。`);
  }
  if (sk) l.push(`- **平均回合**：技能版 ${f1(sk.rounds)} 回合（中位 ${f1(sk.roundsMed)}），${basicName} ${f1(bp && bp.rounds)}，普攻版全部 ${f1(b0 && b0.rounds)}。`);
  const pa = pve["all|skill"], pb = pve["all|basic"], h2 = h2hSummary(report.rows).all;
  if (h2) l.push(`- **技能版是不是更强**（决斗里一队技能版、一队普攻版对打，镜像 ${h2.n} 场）：技能版赢 ${pct(h2.rate)}（${ciText(h2.ci)}）（第 9 节）。`);
  if (pa && pb) l.push(`- **遭遇战（PvE）对照**：同样的 ${(report.pveScenarios || PVE_SCENARIOS).length} 种遭遇、同一批种子，技能版胜率 ${pct(pa.rate)}（${ciText(pa.ci)}）、普攻版 ${pct(pb.rate)}（${ciText(pb.ci)}）；赢下来的平均 ${f1(pa.roundsWin)} 回合 vs ${f1(pb.roundsWin)} 回合，剩下的血量 ${pct(pa.hp)} vs ${pct(pb.hp)}（第 9 节）。`);
  l.push(`- **速度**（${o.workers || CONFIG.workers} 个线程一起跑，每场单独计时）：1v1 平均 ${sec("1v1")}、2v2 ${sec("2v2")}、3v3 ${sec("3v3")}、4v4 ${sec("4v4")} 一场；遭遇战 ${sec("pve:skill")}（普攻版 ${sec("pve:basic")}）。全部 ${report.rows.length} 场共 ${report.seconds} 秒。`);
  l.push("");
  // ---- 怎么测的 ----
  const cfg = report.skillCfg || {}, w = cfg.w || {};
  l.push("## 怎么测的", "");
  l.push(`- **技能版**（\`BattleSim.SKILL_POLICY\`，sim.js / sim-search.js）：轮到一个单位时，列出它所有的合法动作（每个技能 × 每种分步选择 × 每个目标、移动、召唤武器人；决斗满状态不带道具），每个动作在 ${cfg.worlds} 个平行世界（同一串动作、不同的骰子）里试跑取平均；一个回合之内往前看 ${cfg.depth} 步（束宽 ${cfg.width}），挑总分最高的那条路线，做它的第一步，骰子出来以后再从头看一遍。倒地起身、起身翻滚、协助格挡 / 协助攻击和普攻版完全一样（两边只差「轮到自己时做什么」）。`);
  l.push(`- **打分**（权重在 \`SKILL_POLICY_CFG.w\`）：对手掉的血（按血量上限算比例，一整条 = ${w.hp}）、架势（一整条 = ${w.def}）、打出失衡 ${w.stagger}、打倒 ${w.down}、再起不能 ${w.out}；自己一方掉的血（一整条 = ${w.ownHp}）、倒地 ${w.ownDown}；站位：普攻打得到对手 +${w.reach}，远程留在有对手近战的区每个近战 −${w.risk}；留着附赠（对面回合里能协助格挡）+${w.keepBonus}；召唤武器人 +${w.summon}（每过一个回合少 ${Math.round((w.summonDecay || 0) * 100)}%，最少 ${Math.round((w.summonMin || 0) * 100)}%）；状态效果按种类加减分，治疗回的血按自己掉血的权重算。`);
  l.push(`- **样本**：随机阵容，${sizes.map(s => s + "v" + s).join(" / ")} × ${levels.join(" / ")} 级 × 每格 ${o.pairs} 对 × 先后手对调 = 每种情况 ${perVariant} 场，情况：${o.variants.map(v => VARIANTS[v].name).join("、")}；${o.fixedPairs ? `固定阵容每组每级 ${o.fixedPairs} 对；` : "不跑固定阵容；"}种子前缀 \`${o.seed}\`。阵容、战斗种子和 #491 的前 ${o.pairs} 对完全一样，所以表里「${basicName}」一列是 #491 里同一批阵容、种子的普攻版结果（两种打法从第一步起就分开了，骰子不会一样）；「普攻版（全部）」是 #491 每格 150 对的结果，区间更窄。`);
  if (o.h2h || o.pve) l.push(`- **顺手验证**（第 9 节）：${o.h2h ? `决斗里一队技能版、一队普攻版对打（每种人数 × 等级 ${o.h2h} 对阵容，每对 4 场：先后手对调 × 哪一队用技能版对调）` : ""}${o.h2h && o.pve ? "；" : ""}${o.pve ? `${(report.pveScenarios || PVE_SCENARIOS).length} 种遭遇战（PvE）每种 ${o.pve} 个种子，两种打法同一个种子各打一场` : ""}。`);
  l.push(`- **胜率和区间**照 #491：先手胜率 = 先手赢的 ÷ 分出胜负的（平局、超时另列），Wilson 95% 区间；差值区间按两组独立算（偏保守）。技能版样本少，单格区间大约 ±${o.pairs <= 10 ? "15–20" : o.pairs <= 25 ? "10–13" : "6–9"} 个百分点，看合计和趋势。`);
  l.push(`- **原始数据**：同名的 \`.json\`（每场一行，字段说明在 \`columns\`；技能版多记了用了哪些技能 \`use\`、召唤 \`sm\`、移动 \`mv\`、想了几次 \`dec\`、试跑了几个候选 \`tr\`）。重新生成报告：\`node tools/pvp-balance.js --rebuild ${o.out}\`。`, "");
  // ---- 1. 先后手 ----
  l.push("## 1. 先后手胜率（现在的规则）：按人数、等级", "");
  l.push(`|人数|等级|技能版场数|技能版 先手胜 / 后手胜 / 平局 / 超时|技能版 先手胜率|${basicName} 先手胜率|普攻版（全部）先手胜率|`);
  l.push("|---|---|---:|---|---|---|---|");
  for (const s of sizes.concat(["all"])) for (const L of levels.concat(["all"])) {
    const x = get(S, "base", s, L);
    if (!x) continue;
    l.push(`|${SIZE_NAME(s)}|${LEVEL_NAME(L)}|${x.n - x.errors}|${x.F} / ${x.S} / ${x.D} / ${x.T}|${rateCell(x)}|${cell(get(P1, "base", s, L))}|${cell(get(P0, "base", s, L))}|`);
  }
  l.push("", `一句话：技能版${edgeText(sk)}；普攻版（全部）${edgeText(b0)}。`, "");
  // ---- 2. 后手补偿 ----
  if (has("noLate")) {
    l.push("## 2. 后手补偿的作用：有 vs 临时关掉", "", "关掉 = 只在模拟里把 `PVP_DUEL_CFG.lateBonus` 改成 0。「作用」= 有补偿的先手胜率 − 关掉补偿的先手胜率（负数 = 补偿把先手胜率往下拉）。", "");
    l.push(`|人数|技能版：有补偿|技能版：关掉|技能版：作用（百分点）|${basicName}：作用|普攻版（全部）：作用|技能版：后手第 1 回合协助格挡（次 / 场）|`);
    l.push("|---|---|---|---|---|---|---:|");
    for (const s of sizes.concat(["all"])) {
      const a = get(S, "base", s), b = get(S, "noLate", s);
      if (!a || !b) continue;
      l.push(`|${SIZE_NAME(s)}|${rateCell(a)}|${rateCell(b)}|${dtext(diff(a, b))}|${dtext(diff(get(P1, "base", s), get(P1, "noLate", s)))}|${dtext(diff(get(P0, "base", s), get(P0, "noLate", s)))}|${f2(a.blk1)}|`);
    }
    const x = get(S, "noLate");
    l.push("", `一句话：关掉补偿时技能版${edgeText(x)}；有补偿时${edgeText(sk)}。`, "");
  }
  // ---- 3. 决斗选项 ----
  const opts = ["noStand", "rounds", "noRoll"].filter(has);
  if (opts.length) {
    l.push("## 3. 决斗选项：不允许起身、回合上限 10、关掉起身翻滚", "", "每种情况只改一处，其余和「现在的规则」一样；同一批阵容和种子。", "");
    l.push(`|情况|人数|技能版 先手胜率|技能版 平均回合|${basicName} 先手胜率|${basicName} 平均回合|普攻版（全部）先手胜率|普攻版（全部）平均回合|`);
    l.push("|---|---|---|---:|---|---:|---|---:|");
    for (const v of ["base"].concat(opts)) for (const s of sizes.concat(["all"])) {
      const x = get(S, v, s);
      if (!x || (s !== "all" && v === "base")) continue;
      const y = get(P1, v, s), z = get(P0, v, s);
      l.push(`|${VARIANTS[v].name}|${SIZE_NAME(s)}|${rateCell(x)}|${f1(x.rounds)}|${cell(y)}|${f1(y && y.rounds)}|${cell(z)}|${f1(z && z.rounds)}|`);
    }
    if (has("rounds")) {
      const rr = report.rows.filter(r => r.v === "rounds" && r.k === "random" && r.w !== "E"), lim = rr.filter(r => r.why === "rounds");
      const br = basicRows(report, basic, true).filter(r => r.v === "rounds" && r.w !== "E"), blim = br.filter(r => r.why === "rounds");
      l.push("", `回合上限 10：技能版 ${pct(rr.length ? lim.length / rr.length : null)} 的场次打满 10 回合按剩余血量判（其中平局 ${lim.filter(r => r.w === "D").length} 场），${basicName} ${pct(br.length ? blim.length / br.length : null)}（平局 ${blim.filter(r => r.w === "D").length} 场）。`);
    }
    l.push("");
  }
  // ---- 4. 滚雪球 ----
  l.push("## 4. 滚雪球：第一次失衡、第一次打倒和最后胜负", "", "「先打出第一次失衡的一方」= 对面第一个被打进失衡的人是谁打的；「先打倒对方第一个人」= 对面第一个倒地的。只看分出胜负的场次（现在的规则）。", "");
  l.push(`|人数|事件|技能版：场数 / 这一方最后赢|技能版：平均第几回合|${basicName}：场数 / 赢|普攻版（全部）：赢|`);
  l.push("|---|---|---|---:|---|---|");
  const ev = [["stag", "第一次失衡"], ["down", "第一次打倒"], ["out", "第一次再起不能"]];
  for (const s of sizes.concat(["all"])) ev.forEach(([k, name]) => {
    const x = get(S, "base", s), y = get(P1, "base", s), z = get(P0, "base", s);
    if (!x || !x[k].n) return;
    l.push(`|${SIZE_NAME(s)}|${name}|${x[k].n} / **${pct(x[k].rate)}**（${ciText(x[k].ci)}）|${f1(x[k].turn)}|${y ? `${y[k].n} / ${pct(y[k].rate)}` : "—"}|${z ? `${pct(z[k].rate)}（${ciText(z[k].ci)}）` : "—"}|`);
  });
  if (sk) {
    const wp = bp ? bp.wipes : null;
    l.push("", `每场失衡：技能版 ${f2(sk.stagPerGame)}（先手打出 ${f2(sk.stagF)} / 后手 ${f2(sk.stagS)}），${basicName} ${f2(bp && bp.stagPerGame)}。全员倒地后又起身的一队最后翻盘：技能版 ${sk.wipes.n ? pct(sk.wipes.won / sk.wipes.n) : "—"}（${sk.wipes.n} 次），${basicName} ${wp && wp.n ? pct(wp.won / wp.n) : "—"}（${wp ? wp.n : 0} 次）。`);
  }
  l.push("");
  // ---- 5. 近战 / 远程 ----
  if (report.lineups && report.heroes) {
    l.push("## 5. 近战多 / 远程多的阵容", "", "近战 / 远程按普攻射程分（第 8 节）。两队近战人数不一样的场次里，近战多的一方最后赢了多少；再分它当先手 / 当后手（现在的规则，分出胜负的场次）。", "");
    l.push(`|人数|技能版：场数 / 近战多的一方胜率|技能版：当先手 / 当后手|${basicName}：近战多的一方胜率|普攻版（全部）：近战多的一方胜率|`);
    l.push("|---|---|---|---|---|");
    sizes.concat(["all"]).forEach(s => {
      const a = meleeStats(report.rows, report.lineups, report.heroes, s);
      const b = basic ? meleeStats(basicRows(report, basic, true), basic.lineups, report.heroes, s) : null;
      const c0 = basic ? meleeStats(basicRows(report, basic, false), basic.lineups, report.heroes, s) : null;
      l.push(`|${SIZE_NAME(s)}|${a.n} / **${pct(a.rate)}**（${ciText(a.ci)}）|${pct(a.rF)} / ${pct(a.rS)}|${b ? `${pct(b.rate)}（${ciText(b.ci)}）` : "—"}|${c0 ? `${pct(c0.rate)}（${ciText(c0.ci)}）` : "—"}|`);
    });
    l.push("");
  }
  // ---- 6. 平均回合 ----
  l.push("## 6. 平均回合数", "");
  l.push(`|情况|人数|技能版：平均（中位 / P90）|${basicName}：平均（中位 / P90）|普攻版（全部）：平均|`);
  l.push("|---|---|---|---|---:|");
  for (const v of o.variants) for (const s of sizes.concat(["all"])) {
    const x = get(S, v, s), y = get(P1, v, s), z = get(P0, v, s);
    if (!x) continue;
    if (v !== "base" && s !== "all") continue;
    l.push(`|${VARIANTS[v].name}|${SIZE_NAME(s)}|${f1(x.rounds)}（${f1(x.roundsMed)} / ${f1(x.roundsP90)}）|${y ? `${f1(y.rounds)}（${f1(y.roundsMed)} / ${f1(y.roundsP90)}）` : "—"}|${f1(z && z.rounds)}|`);
  }
  l.push("");
  // ---- 7. 角色 ----
  if (report.lineups) {
    const hs = heroWins(report.rows, report.lineups), hb = basic ? heroWins(basicRows(report, basic, true), basic.lineups) : {}, h0 = basic ? heroWins(basicRows(report, basic, false), basic.lineups) : {};
    l.push("## 7. 各角色出场时的胜率（只作参考）", "", "现在的规则、随机阵容、分出胜负的场次：这个角色在场时他那一队赢了多少。阵容是随机抽的、队友不一样，样本也少，**只作参考，不要拿来判角色强弱**。", "");
    l.push(`|角色|普攻射程|技能版：场数 / 胜率|${basicName}：场数 / 胜率|普攻版（全部）：胜率|`);
    l.push("|---|---|---|---|---|");
    Object.keys(report.heroes).forEach(k => {
      const a = hs[k], b = hb[k], c0 = h0[k];
      const cellW = x => (x && x.n ? `${x.n} / ${pct(x.won / x.n)}` : "—");
      l.push(`|${report.heroes[k].name}（\`${k}\`）|${report.heroes[k].range}|${a && a.n ? `${a.n} / **${pct(a.won / a.n)}**（${ciText(B.wilson(a.won, a.n))}）` : "—"}|${cellW(b)}|${c0 && c0.n ? pct(c0.won / c0.n) : "—"}|`);
    });
    l.push("");
    l.push("**参考：角色的普攻射程和血量**（和 #491 第 8 节一样的培养）", "");
    l.push("|角色|普攻射程|" + levels.map(L => `${L} 级 血量 / 架势`).join("|") + "|");
    l.push("|---|---|" + levels.map(() => "---").join("|") + "|");
    Object.keys(report.heroes).forEach(k => {
      const h = report.heroes[k];
      l.push(`|${h.name}（\`${k}\`）|${h.range}|${levels.map(L => (h.byLevel[L] ? `${h.byLevel[L].hp} / ${h.byLevel[L].def}` : "—")).join("|")}|`);
    });
    l.push("");
  }
  // ---- 8. 技能版做了什么 ----
  const duel = report.rows.filter(r => r.k !== "pve" && r.k !== "h2h" && r.w !== "E");
  if (duel.length) {
    l.push("## 8. 技能版做了什么（统计）", "", "两队合计、每场平均。「普攻以外的技能」不含普攻（`*_aa`），含召唤。", "");
    l.push("|人数|场数|想了几次|试跑的候选|普攻|普攻以外的技能|召唤武器人|移动|");
    l.push("|---|---:|---:|---:|---:|---:|---:|---:|");
    sizes.concat(["all"]).forEach(s => {
      const xs = duel.filter(r => s === "all" || r.s === s);
      if (!xs.length) return;
      l.push(`|${SIZE_NAME(s)}|${xs.length}|${f1(mean(xs.map(r => r.dec || 0)))}|${Math.round(mean(xs.map(r => r.tr || 0)))}|${f1(mean(xs.map(basicUse)))}|${f1(mean(xs.map(nonBasic)))}|${f2(mean(xs.map(r => r.sm || 0)))}|${f1(mean(xs.map(r => r.mv || 0)))}|`);
    });
    const tot = {};
    duel.forEach(r => Object.keys(r.use || {}).forEach(id => { tot[id] = (tot[id] || 0) + r.use[id]; }));
    const names = report.skillNames || {};
    const top = Object.keys(tot).sort((a, b) => tot[b] - tot[a]);
    const used = top.filter(id => !/_aa$/.test(id));
    l.push("", `用过的技能一共 ${top.length} 种（普攻以外 ${used.length} 种）。用得最多的普攻以外的技能：`, "");
    l.push("|技能|谁用的|次数|每场|");
    l.push("|---|---|---:|---:|");
    used.slice(0, 30).forEach(id => { const n = names[id] || {}; l.push(`|${n.name || id}（\`${id}\`）|${n.unit || "—"}|${tot[id]}|${f2(tot[id] / duel.length)}|`); });
    l.push("");
  }
  // ---- 9. 技能版是不是更强：对打 + PvE ----
  const hh = h2hSummary(report.rows);
  if (hh.all || (pa && pb)) l.push("## 9. 顺手验证：技能版是不是更强、有没有乱放技能", "");
  if (hh.all) {
    l.push("**9a. 决斗里技能版 vs 普攻版对打**（现在的规则；一队用技能版、一队用普攻版，同一对阵容打 4 场：先后手对调 × 哪一队用技能版对调，阵容强弱、先后手、站位都抵消；起身、翻滚两边一样）", "");
    l.push("|人数|场数|技能版赢（只算分出胜负的）|平局|平均回合|技能版每场召唤|");
    l.push("|---|---:|---|---:|---:|---:|");
    sizes.concat(["all"]).forEach(s => { const x = hh[s]; if (x) l.push(`|${SIZE_NAME(s)}|${x.n}|${x.won} / ${x.dec} = **${pct(x.rate)}**（${ciText(x.ci)}）|${x.draws}|${f1(x.rounds)}|${f2(x.sm)}|`); });
    l.push("", `一句话：技能版对普攻版赢 ${pct(hh.all.rate)}（${ciText(hh.all.ci)}）${hh.all.ci && hh.all.ci[0] > 0.5 ? "，区间整个在 50% 以上：技能版明显更强" : "，区间包含 50%：样本里看不出技能版更强"}。`, "");
  }
  if (pa && pb) {
    l.push("**9b. 遭遇战（PvE）里技能版 vs 普攻版**", "", `队伍照 R1 单场矩阵升到这个等级、敌人站 2 区（比队伍高几级见表），同一个种子两种打法各打一场（我方的打法不同，敌人照旧 ai.js），回合上限 ${CONFIG.pveLimit}。难度按普攻版挑：P1–P5 普攻版有赢有输，P6 普攻版一场都打不赢。PvE 里技能版可以用背包里的道具（R1 开局的补给）。`, "");
    l.push("|项|队伍|我方 / 敌人等级|敌人|场数|普攻版：胜率 / 平均回合 / 剩余血量|技能版：胜率 / 平均回合 / 剩余血量|技能版每场：普攻 / 普攻以外的技能 / 召唤 / 道具 / 移动|");
    l.push("|---|---|---|---|---:|---|---|---|");
    (report.pveScenarios || PVE_SCENARIOS).forEach(sc => {
      const a = pve[sc.id + "|basic"], b = pve[sc.id + "|skill"];
      if (!a || !b) return;
      const row = x => `**${pct(x.rate)}** / ${f1(x.rounds)} / ${pct(x.hp)}`;
      l.push(`|${sc.id}|${sc.party.map(report.heroNames).join("、")}|${sc.level} / ${sc.level + (sc.plus || 0)}|${sc.enemies.join("、")}|${b.n}|${row(a)}|${row(b)}|${f1(b.aa)} / ${f1(b.skills)} / ${f2(b.sm)} / ${f2(b.it)} / ${f1(b.mv)}|`);
    });
    l.push(`|合计|||||**${pct(pb.rate)}**（${ciText(pb.ci)}）/ ${f1(pb.rounds)} / ${pct(pb.hp)}|**${pct(pa.rate)}**（${ciText(pa.ci)}）/ ${f1(pa.rounds)} / ${pct(pa.hp)}|${f1(pa.aa)} / ${f1(pa.skills)} / ${f2(pa.sm)} / ${f2(pa.it)} / ${f1(pa.mv)}|`);
    const better = pa.rate > pb.rate || (pa.rate === pb.rate && pa.hp > pb.hp);
    l.push("", `一句话：技能版${better ? "更强" : "没有更强"}（胜率 ${pct(pa.rate)} vs ${pct(pb.rate)}，剩下的血量 ${pct(pa.hp)} vs ${pct(pb.hp)}，赢下来平均 ${f1(pa.roundsWin)} vs ${f1(pb.roundsWin)} 回合）；技能版每场平均用 ${f1(pa.skills)} 次普攻以外的技能、${f1(pa.aa)} 次普攻。`, "");
  }
  // ---- 10. 速度 ----
  l.push("## 10. 速度", "", `每场单独计时（${o.workers || CONFIG.workers} 个线程同时跑，单场的时间是在一个线程里打完它用的时间）。`, "");
  l.push("|对局|场数|平均每场|最长一场|");
  l.push("|---|---:|---:|---:|");
  Object.keys(timing).sort().forEach(k => l.push(`|${k.replace("pve:basic", "遭遇战·普攻版").replace("pve:skill", "遭遇战·技能版").replace(/^h2h:/, "对打（技能版 vs 普攻版）")}|${timing[k].n}|${(timing[k].meanMs / 1000).toFixed(2)} 秒|${(timing[k].maxMs / 1000).toFixed(1)} 秒|`));
  l.push("", `技能版的时间几乎都花在试跑上（每个候选在每个平行世界里存取一次局面、执行一次）：宽度、深度、平行世界数在 \`SKILL_POLICY_CFG\`，调小会快、但看得没那么远。`, "");
  // ---- 11. 撞到的问题 ----
  l.push("## 11. 撞到的问题", "");
  const errs = report.rows.filter(r => r.w === "E"), bugRows = report.rows.filter(r => r.bugs);
  if (!errs.length && !bugRows.length) l.push(`跑了 ${report.rows.length} 场，没有脚本异常，自检（没人真的死亡、全倒判负的一队没人站着、规则没有 console.error）都通过。`);
  else {
    const group = new Map();
    errs.forEach(r => { const k = "异常：" + r.err; group.set(k, (group.get(k) || []).concat([r])); });
    bugRows.forEach(r => r.bugs.forEach(b => group.set(b, (group.get(b) || []).concat([r]))));
    l.push(`跑了 ${report.rows.length} 场；异常 ${errs.length} 场，自检没通过 ${bugRows.length} 场：`, "");
    [...group.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 12).forEach(([k, list]) => {
      const r = list[0];
      l.push(`- ${list.length} 场：${k.replace(/\|/g, "／")}（例：${r.k === "pve" ? `遭遇战 ${r.id} 序号 ${r.i} ${r.p}` : `\`${r.v}\` ${r.s}v${r.s} ${r.L} 级 序号 ${r.i} ${r.f === "a" ? "A" : "B"} 先手`}）`);
    });
  }
  l.push("");
  // ---- 12. 建议 ----
  l.push("## 12. 建议（只是建议，没有改规则）", "");
  compareNotes(report, { S, P1, P0, get, pve }).forEach(t => l.push(t));
  l.push("", "## 注意", "");
  l.push("- **技能版也只是一个近似**：它只替轮到的那个单位往前看（这一回合自己的几步），不会和队友商量集火、不会预判对面下一回合怎么打；打分的权重是人定的（`SKILL_POLICY_CFG.w`），换一套权重结论可能会变。比普攻版接近真人，但不等于真人。");
  l.push("- **决斗里不带道具**（满状态 PvP 默认不带）；遭遇战对照里可以用背包里的道具。");
  l.push("- **打分用到了坚毅生命**：打到起身中的对手身上的伤害按它掉的坚毅生命算（不然 AI 看不出打起身中的人有用）。只在 AI 自己算分时用，报告和 json 里没有任何坚毅数值。");
  l.push("- **同一批阵容、种子，但骰子不一样**：两种打法从第一步起做的事就不一样，掷骰子的顺序也跟着变，所以同一个序号的对局没法逐场对照，只能比整体的比例。");
  l.push(`- **样本少**：技能版每格只有 ${o.pairs * 2} 场（#491 是 300 场），单格的小差别不要过度解读；要更窄的区间可以加大 \`--pairs\` 重跑（速度见第 10 节）。`);
  l.push("- **「滚雪球」是相关、不是因果**：先打出失衡的一方往往本来就占上风。");
  return l.join("\n") + "\n";
}
/** 技能版报告的建议：按数据挑方向（先后手、补偿、滚雪球、阵容、决斗选项），只写建议 */
function compareNotes(report, X) {
  const { S, P1, P0, get, pve } = X, o = report.options, out = [];
  const sk = get(S, "base"), b0 = get(P0, "base");
  if (!sk) return ["- 没有样本。"];
  const side = x => (x && x.ci ? (x.ci[0] > 0.5 ? "先手" : x.ci[1] < 0.5 ? "后手" : null) : null);
  const head = `技能版合计先手胜率 ${pct(sk.firstRate)}（${ciText(sk.ci)}；普攻版 #491 ${pct(b0 && b0.firstRate)}）`;
  if (side(sk) === "先手") out.push(`- **先后手**：${head}，换成会用技能的打法以后先手明显占优。可以考虑加大后手补偿（例如 \`PVP_DUEL_CFG.lateBonus\` 1 → 2，或者补偿 1 个附赠 + 第一回合架势 +1），定之前用 \`--policy skill\` 加大样本再跑一次。`);
  else if (side(sk) === "后手") out.push(`- **先后手**：${head}，后手明显占优${sk.firstRate > 0.45 ? "，但差得不多" : ""}。可以考虑把补偿减一点（例如补偿的附赠只在先手的第一回合里有效），定之前加大样本再跑一次。`);
  else out.push(`- **先后手**：${head}，区间包含 50%，看不出明显的先后手优势：现在的先后手规则（含后手补偿）在技能版下也说得过去，暂时不用调；样本少，区间宽，想更确定可以加大 \`--pairs\`。`);
  const nl = get(S, "noLate");
  if (nl) {
    const d = diff(sk, nl), dp = diff(b0, get(P0, "noLate"));
    const how = d.ci[1] < 0 ? "明显把先手胜率往下拉" : d.ci[0] > 0 ? "反而把先手胜率往上推" : "作用看不出来（区间包含 0）";
    out.push(`- **后手补偿**：技能版里补偿${how}（${pp(d.d)} 个百分点，${pp(d.ci[0])} ~ ${pp(d.ci[1])}；普攻版 ${dp ? pp(dp.d) : "—"}）。` +
      (d.ci[0] <= 0 && d.ci[1] >= 0 ? "技能版会留附赠协助格挡、也会拿附赠走位 / 放技能，补偿的附赠不再只是白送的一次格挡；补偿的力度建议等样本够了再定。" : side(nl) === "先手" && !side(sk) ? "关掉时先手占优、有补偿时看不出差别：现在的 1 个附赠合适。" : ""));
  }
  const ns = get(S, "noStand");
  if (ns) out.push(`- **不允许起身**：技能版先手胜率 ${pct(ns.firstRate)}（${ciText(ns.ci)}${side(ns) ? "，" + side(ns) + "明显占优" : "，看不出差别"}；普攻版 ${pct((get(P0, "noStand") || {}).firstRate)}），平均 ${f1(ns.rounds)} 回合。${side(ns) && side(ns) !== side(sk) ? "这个选项下先后手的平衡和默认规则不一样，常用的话可以单独给这个选项定补偿。" : ""}`);
  const rd = get(S, "rounds");
  if (rd) out.push(`- **回合上限 10**：技能版 ${pct(rd.drawRate)} 平局，先手胜率 ${pct(rd.firstRate)}（${ciText(rd.ci)}）。${rd.drawRate > 0.05 ? "平局多的话可以考虑 #491 建议的「百分比一样时比还站着的人数」。" : "平局不多，回合上限的判法暂时够用。"}`);
  const nr = get(S, "noRoll");
  if (nr) { const d = diff(nr, sk); out.push(`- **起身翻滚**：关掉翻滚时技能版先手胜率 ${pct(nr.firstRate)}，和现在比 ${pp(d.d)} 个百分点（${pp(d.ci[0])} ~ ${pp(d.ci[1])}）${d.ci[0] <= 0 && d.ci[1] >= 0 ? "，看不出影响，和普攻版的结论一样，不用为先后手动它" : ""}。`); }
  if (sk.stag.rate != null) out.push(sk.stag.rate > 0.7
    ? `- **失衡滚雪球**：技能版里先打出第一次失衡的一方照样赢了 ${pct(sk.stag.rate)}（普攻版 ${pct(b0 && b0.stag.rate)}），会用技能以后失衡还是很关键。想减弱可以照 #491 的建议：PvP 里失衡只跳过行动点、保留附赠，或者协助攻击不回满协助者的架势。`
    : `- **失衡滚雪球**：技能版里先打出第一次失衡的一方赢了 ${pct(sk.stag.rate)}（普攻版 ${pct(b0 && b0.stag.rate)}），关系没那么强了，暂时不用专门调。`);
  if (report.lineups) {
    const ms = meleeStats(report.rows, report.lineups, report.heroes, "all");
    if (ms.rate != null) out.push(ms.rate > 0.65
      ? `- **近战 / 远程**：技能版里近战多的一方仍然赢 ${pct(ms.rate)}，远程角色吃亏不全是普攻版不会走位的问题；如果想拉平，可以考虑远程的血量 / 架势，或者给远程「对方贴脸时退一格不吃借机」之类的手段（要先另做模拟）。`
      : `- **近战 / 远程**：技能版里近战多的一方赢 ${pct(ms.rate)}，比普攻版（#491 第 1b 节）接近五五开：远程吃亏主要是普攻版不会走位，阵容上暂时不用为它调数值。`);
  }
  const pa = pve["all|skill"], pb = pve["all|basic"];
  if (pa && pb) out.push(`- **以后的模拟**：遭遇战里技能版胜率 ${pct(pa.rate)}、普攻版 ${pct(pb.rate)}。${pa.rate >= pb.rate ? "技能版更接近真人的强度" : "技能版在遭遇战里没有更强，打分的权重还要再调"}；以后的平衡模拟（评分验算、敌人威胁）如果想看「会用技能的玩家」，可以换成 \`BattleSim.SKILL_POLICY\`（慢几十倍，样本要少一些）。`);
  return out;
}

/* ---------- 角色参考表 ---------- */
function heroTable(levels) {
  const out = {};
  for (const L of levels) {
    const c = H.load();
    c.S.RNG.install(`hero-table:${L}`);
    const kits = B.HEROES.slice();
    const runs = leveledRuns(c, kits, L, `hero-table:${L}`);
    c.S.LEDGER.dur = {}; c.S.LEDGER.weapons = {}; c.S.LEDGER.heroes = {}; c.S.LEDGER.hours = 0;
    c.BattleSim.setup({ party: kits, enemies: [], seed: `hero-table:${L}:battle`, before: () => runs.forEach(r => c.Rogue.applyPartyToField(r)) });
    c.S.state.units.filter(u => isHero(c, u)).forEach(u => {
      const r = aaRange(c, u);
      const h = out[u.kit] || (out[u.kit] = { name: u.name, range: r.max >= 1 ? `远程（${r.min}–${r.max}）` : "近战（同区）", byLevel: {} });
      h.byLevel[L] = { hp: c.totalMaxHp(u), def: Number(u.defMax) || 0 };
    });
  }
  return out;
}

/* ---------- 入口 ---------- */
function provenance(argv) {
  const files = [...H.RULE_FILES, "tests/headless.js", "tools/balance-common.js", "tools/pvp-balance.js"];
  const sources = Object.fromEntries(files.map(f => [f, B.hash(B.normalizeSource(fs.readFileSync(path.join(H.ROOT, f), "utf8")))]));
  let commit = null, dirty = null;
  try {
    commit = cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: H.ROOT, encoding: "utf8" }).trim();
    dirty = !!cp.execFileSync("git", ["status", "--porcelain", "--", ...files], { cwd: H.ROOT, encoding: "utf8" }).trim();
  } catch (e) { /* 源码哈希照样能对 */ }
  return { commit, dirty, node: process.version, command: ("node tools/pvp-balance.js " + argv.join(" ")).trim(), sourceHash: B.hash(sources) };
}
function parseArgs(argv) {
  const out = {}, allowed = ["sizes", "levels", "pairs", "fixed", "variants", "seed", "workers", "out", "rebuild", "max-rounds", "policy", "pve", "compare", "h2h"];
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--") || !allowed.includes(key.slice(2))) throw new Error("Unknown argument: " + key);
    const v = argv[++i];
    if (v == null || v.startsWith("--")) throw new Error("Missing value for " + key);
    out[key.slice(2)] = v;
  }
  const list = (v, f) => String(v).split(",").map(x => x.trim()).filter(Boolean).map(f);
  const opt = {
    sizes: out.sizes ? list(out.sizes, Number) : CONFIG.sizes.slice(),
    levels: out.levels ? list(out.levels, Number) : CONFIG.levels.slice(),
    pairs: out.pairs ? B.positiveInt(out.pairs, "pairs") : CONFIG.pairs,
    fixedPairs: out.fixed != null ? Number(out.fixed) : CONFIG.fixedPairs,
    variants: out.variants ? list(out.variants, String) : DEFAULT_VARIANTS.slice(),
    seed: out.seed || CONFIG.seedPrefix,
    workers: out.workers ? B.positiveInt(out.workers, "workers") : CONFIG.workers,
    maxRounds: out["max-rounds"] ? B.positiveInt(out["max-rounds"], "max rounds") : CONFIG.maxRounds,
    policy: out.policy || CONFIG.policy,
    pve: out.pve != null ? Number(out.pve) : 0,
    h2h: out.h2h != null ? Number(out.h2h) : 0,
    compare: out.compare || CONFIG.compare,
    rebuild: out.rebuild || null
  };
  opt.out = out.out || (opt.policy === "skill" ? CONFIG.skillOut : CONFIG.out);
  if (!POLICIES[opt.policy]) throw new Error("policy: " + Object.keys(POLICIES).join(", "));
  if (!Number.isInteger(opt.pve) || opt.pve < 0) throw new Error("pve must be a nonnegative integer");
  if (!Number.isInteger(opt.h2h) || opt.h2h < 0) throw new Error("h2h must be a nonnegative integer");
  if (opt.sizes.some(s => ![1, 2, 3, 4].includes(s))) throw new Error("sizes must be 1–4");
  if (opt.levels.some(L => !Number.isInteger(L) || L < 1 || L > 20)) throw new Error("levels must be 1–20");
  if (opt.variants.some(v => !VARIANTS[v])) throw new Error("variants: " + Object.keys(VARIANTS).join(", "));
  if (!Number.isInteger(opt.fixedPairs) || opt.fixedPairs < 0) throw new Error("fixed must be a nonnegative integer");
  return opt;
}
// json 里每场一行写成数组（字段顺序见 rowKeys），比对象小一半多；读的时候两种都认
// （后面接的几项是 #538 加的：打法、技能版做了什么、遭遇战对照；以前的 json 照样读得回来）
const ROW_KEYS = ["v", "k", "s", "L", "i", "f", "w", "why", "r", "act", "st", "stR", "dn", "dnR", "out", "outR", "stF", "stS", "dnF", "dnS", "outF", "outS", "blk1", "blkF", "blkS", "asks", "wipes", "pct", "bugs", "err",
  "p", "use", "sm", "mv", "it", "dec", "tr", "id", "hp", "hd", "x"];
function packRow(r) { const a = ROW_KEYS.map(k => (r[k] === undefined ? null : r[k])); while (a.length && a[a.length - 1] === null) a.pop(); return a; }
function unpackRow(a) { return Array.isArray(a) ? Object.fromEntries(ROW_KEYS.map((k, i) => [k, a[i]]).filter(([, v]) => v != null)) : a; }
/** 同名前缀的单独报告（例 pvp-balance-1030-hold.json）：只取设置和汇总，主报告里列一节 */
function companionsOf(outBase) {
  const file = path.resolve(H.ROOT, outBase), dir = path.dirname(file), stem = path.basename(file) + "-";
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.startsWith(stem) && f.endsWith(".json")).sort().map(f => {
    const r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    return { file: f.replace(/\.json$/, ""), options: r.options || {}, summary: summarizeAll((r.rows || []).map(unpackRow)) };
  });
}
/** 汇总、报告文字、写文件（跑完和 --rebuild 共用） */
function finalize(report, outBase) {
  report.summary = summarizeAll(report.rows);
  report.heroNames = k => (report.heroes[k] || {}).name || k;
  const skill = (report.options || {}).policy === "skill";
  report.companions = skill ? [] : companionsOf(outBase);
  report.notes = skill ? null : notesFor(report);
  const file = path.resolve(H.ROOT, outBase);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // json：表头照常缩进，rows 一场一行（几万场也好比对）；单独报告的汇总、并排对比的普攻版不重复存
  const head = Object.assign({}, report, { companions: undefined, basic: undefined, rowKeys: ROW_KEYS, rows: "__ROWS__" });
  const rows = report.rows.map(r => "    " + JSON.stringify(packRow(r))).join(",\n");
  fs.writeFileSync(file + ".json", JSON.stringify(head, null, 2).replace('"__ROWS__"', () => "[\n" + rows + "\n  ]") + "\n");
  // 技能版：和普攻版（report.options.compare 那份 json）同一批阵容、种子并排比
  fs.writeFileSync(file + ".md", skill ? compareMarkdown(report, loadReport(report.options.compare)) : markdown(report));
  return file;
}
/** 读一份已有的报告 json（rows 解包、补上汇总） */
function loadReport(outBase) {
  const file = path.resolve(H.ROOT, outBase) + ".json";
  if (!outBase || !fs.existsSync(file)) return null;
  const r = JSON.parse(fs.readFileSync(file, "utf8"));
  r.rows = (r.rows || []).map(unpackRow);
  r.file = outBase;
  return r;
}
async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help")) { console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(0, 12).join("\n")); return 0; }
  const opt = parseArgs(argv);
  if (opt.rebuild) {
    const file = path.resolve(H.ROOT, opt.rebuild);
    const report = JSON.parse(fs.readFileSync(file + ".json", "utf8"));
    report.rows = report.rows.map(unpackRow);
    finalize(report, opt.rebuild);
    console.log("rebuilt " + file + ".md");
    return 0;
  }
  CONFIG.maxRounds = opt.maxRounds;
  const jobs = plan(opt);
  const t0 = Date.now();
  let done = 0;
  // 每场花了多久（只用来报速度）：按「决斗几人 / 遭遇战」分开记
  const timing = {};
  const every = opt.policy === "skill" ? 50 : 500;
  const rows = await runJobs(jobs, opt.workers, (row, i, ms) => {
    const key = row.k === "pve" ? `pve:${row.p}` : row.k === "h2h" ? `h2h:${row.s}v${row.s}` : `${row.s}v${row.s}`;
    const t = timing[key] || (timing[key] = { n: 0, ms: 0, max: 0 });
    t.n++; t.ms += ms; t.max = Math.max(t.max, ms);
    if (++done % every === 0 || done === jobs.length) console.log(`${done}/${jobs.length} 场（${Math.round((Date.now() - t0) / 1000)} 秒）`);
  });
  // 技能名从每一行收进一张表（行里不留）
  const skillNames = {};
  rows.forEach(r => { if (r.nm) { Object.keys(r.nm).forEach(id => { if (!skillNames[id]) skillNames[id] = r.nm[id]; }); delete r.nm; } });
  const c = H.load();
  const report = {
    schema: "backfire-pvp-balance-v1", version: CONFIG.version, generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000),
    provenance: provenance(argv),
    options: { sizes: opt.sizes, levels: opt.levels, pairs: opt.pairs, fixedPairs: opt.fixedPairs, variants: opt.variants, seed: opt.seed, maxRounds: opt.maxRounds, roundsLimit: CONFIG.roundsLimit, out: opt.out,
      policy: opt.policy, workers: opt.workers, pve: opt.pve, h2h: opt.h2h, compare: opt.policy === "skill" ? opt.compare : undefined },
    timing: Object.fromEntries(Object.entries(timing).map(([k, t]) => [k, { n: t.n, meanMs: Math.round(t.ms / t.n), maxMs: t.max }])),
    skillCfg: opt.policy === "skill" ? Object.assign(JSON.parse(JSON.stringify(vm.runInContext("SKILL_POLICY_CFG", c))), CONFIG.skillCfg) : undefined,
    skillNames: opt.policy === "skill" ? skillNames : undefined,
    pveScenarios: opt.pve ? PVE_SCENARIOS : undefined,
    variants: VARIANTS, fixed: FIXED, ruleSnapshot: JSON.parse(JSON.stringify(vm.runInContext("PVP_DUEL_CFG", c))),
    heroes: heroTable(opt.levels),
    lineups: Object.fromEntries(opt.sizes.flatMap(s => Array.from({ length: opt.pairs }, (_, i) => [`${s}:${i}`, lineup(opt.seed, s, i)]))),
    columns: { v: "情况", k: "random = 随机阵容 / 固定阵容 id", s: "每队人数", L: "等级", i: "阵容序号（随机阵容见 lineups）", f: "谁先手（a / b = 阵容 A / B）",
      w: "结果：F 先手赢 / S 后手赢 / D 平局 / T 超时 / E 异常", why: "wipe 全倒 / rounds 回合上限 / timeout", r: "回合", act: "行动次数",
      st: "第一次失衡是哪一方打出的（F / S）", stR: "第几回合", dn: "第一次打倒（倒地）", dnR: "第几回合", out: "第一次再起不能", outR: "第几回合",
      stF: "先手打出的失衡数", stS: "后手打出的失衡数", dnF: "先手打倒的次数", dnS: "后手打倒的次数", outF: "先手让对面再起不能的人数", outS: "后手让对面再起不能的人数",
      blk1: "后手在先手第 1 回合协助格挡几次（用补偿）", blkF: "先手整场协助格挡次数", blkS: "后手整场协助格挡次数",
      asks: "全员倒地、回合结束前被问：哪一方、第几回合、有没有人起身", wipes: "全员倒地后有人起身：哪一方、第几回合、是不是回合结束前被问时起的",
      pct: "回合上限判的剩余血量百分比 [先手, 后手]", bugs: "自检没通过", err: "异常",
      p: "打法（不写 = basic 普攻版；skill 技能版）", use: "技能版：两队一共用了哪些技能（id → 次数，名字见 skillNames）", sm: "技能版：召唤武器人几次", mv: "技能版：移动几次",
      it: "技能版：用了几次道具", dec: "技能版：想了几次（每次轮到一个单位做一步之前想一次）", tr: "技能版：一共试跑了多少个候选动作",
      id: "遭遇战对照：哪一项（pveScenarios；这时 w 是 W 赢 / L 输 / T 回合上限）", hp: "遭遇战对照：我方剩下的血量 ÷ 上限（倒地按 0）", hd: "遭遇战对照：最后倒地 / 死亡的角色数",
      x: "技能版 vs 普攻版对打（k = h2h）：1 = 阵容 B 那一队用技能版（0 = 阵容 A）；这时 w 是 X 技能版赢 / Y 普攻版赢 / D 平局" },
    rows
  };
  const file = finalize(report, opt.out);
  console.log(`${rows.length} 场，${report.seconds} 秒 → ${file}.md`);
  return rows.some(r => r.w === "E") ? 1 : 0;
}
if (isMainThread && require.main === module) main().then(code => { process.exitCode = code; }).catch(e => { console.error(e.stack || String(e)); process.exitCode = 1; });
module.exports = { CONFIG, VARIANTS, DEFAULT_VARIANTS, FIXED, POLICIES, PVE_SCENARIOS, lineup, plan, prepare, duelPolicy, runJob, runPve, runH2h, runJobs, rollPick, summarize, summarizeAll, diff, packRow, unpackRow,
  markdown, notesFor, compareMarkdown, pveSummary, h2hSummary, meleeStats, heroWins, loadReport, main };
