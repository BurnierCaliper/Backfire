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
//
// 每一对阵容打两场：先手、后手对调（镜像），其余完全一样（同一个战斗种子），阵容强弱在先后手之间抵消；
// 阵容：两队互不重复的角色（同一个角色不能同时在两队），从 11 名角色里按种子随机抽，另有几组固定阵容。
// 同一个序号的阵容、种子对每种情况、每个等级都一样，情况之间可以直接比。偶数序号的阵容 A 站 1 队（1 区），奇数站 2 队（3 区）。
// 等级照 R1 单场矩阵（tools/score-by-act.js · one）：升级选主属性 / 第一个合法选项，武器等级 = 等级 × 0.6（最高 10），
// 满状态、不用道具、没有义体。抛硬币由工具定（先手是谁），其余照游戏：3 区制、1 队站 1 区、2 队站 3 区，后手补偿 1 个附赠……
// 打法：两队都是 BattleSim.BASIC_POLICY（能打到就普攻血最少的，打不到就用附赠走一格；能协助格挡就挡、能协助攻击就打），
// 另外补上起身：倒地能起身就起身；「起身翻滚」开着时按站位挑一个相邻区翻过去（远程躲开同区的对手、近战翻到有对手的区）。
// 不用技能、道具、召唤武器人，不会撤退、不会故意拖回合——结论的局限见报告最后的「注意」。
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
  out: "docs/balance/pvp-balance-1030"
};
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
  const variants = opt.variants || DEFAULT_VARIANTS, jobs = [];
  const pair = (base, i) => ["a", "b"].forEach(first => jobs.push(Object.assign({}, base, { first, aTeam: i % 2 === 0 ? TEAMS[0] : TEAMS[1] })));
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
  const wrap = (name, fn) => { const orig = c[name]; if (typeof orig !== "function") throw new Error("missing rule function " + name); c[name] = (...args) => fn(orig, args); };
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
/** 两队共用的打法：BASIC + 起身（能起就起；翻滚开着时按 rollPick 翻）。
 *  只改 AI 的对照 hold：先手的人第 1 回合够不着就原地等（不走过去），够得着照常打 */
function duelPolicy(c, V, firstTeam) {
  const base = c.BattleSim.BASIC_POLICY;
  const dest = (u, zones) => (V.roll ? rollPick(c, u, zones || c.standRollZones(u)) : null);
  return Object.assign({}, base, {
    name: "basic-duel",
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
function runJob(job) {
  const row = { v: job.variant, k: job.kind, s: job.size, L: job.level, i: job.index, f: job.first, w: "E" };
  try {
    const { c, S, V, rec, firstTeam } = prepare(job);
    const res = c.BattleSim.run({ maxRounds: CONFIG.maxRounds, policy: duelPolicy(c, V, firstTeam) });
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

if (!isMainThread) parentPort.on("message", msg => parentPort.postMessage({ i: msg.i, row: runJob(msg.job) }));
async function runJobs(jobs, workers = 1, onRow) {
  const rows = Array(jobs.length);
  if (workers <= 1) { jobs.forEach((j, i) => { rows[i] = runJob(j); if (onRow) onRow(rows[i], i); }); return rows; }
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, () => new Promise((resolve, reject) => {
    const w = new Worker(__filename);
    const send = () => { if (next >= jobs.length) { w.terminate().then(resolve, reject); return; } const i = next++; w.postMessage({ i, job: jobs[i] }); };
    w.on("message", ({ i, row }) => { rows[i] = row; if (onRow) onRow(row, i); send(); });
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
  const holdTop = (report.companions || []).map(cp => cp.summary["hold|random|all|all"]).find(Boolean);
  if (base && holdTop) { const dh = diff(holdTop, base); l.push(`- **只改 AI：先手第一回合原地等**（不走过去，等对面过来）：先手胜率 ${pct(holdTop.firstRate)}（${ciText(holdTop.ci)}），和现在的打法比 ${pp(dh.d)} 个百分点——「谁先走过去」对胜负的影响${Math.abs(dh.d) > 0.05 ? "很大" : "不大"}（见第 9 节）。`); }
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
    const TAGS = [["more", "先手队近战比后手多"], ["same", "两队近战一样多"], ["less", "先手队近战比后手少"]];
    l.push("**1b. 先手胜率和两队的近战人数**（近战 / 远程按普攻射程分，见第 8 节；只看分出胜负的场次）", "");
    l.push("|人数|" + TAGS.map(t => t[1] + "：场数 / 先手胜率（95% 区间）").join("|") + "|");
    l.push("|---|" + TAGS.map(() => "---").join("|") + "|");
    sizes.concat(["all"]).forEach(s => {
      const xs = rows.filter(r => s === "all" || r.s === s);
      l.push(`|${SIZE_NAME(s)}|` + TAGS.map(([t]) => { const g = xs.filter(r => tag(r) === t), w = g.filter(r => r.w === "F").length; return g.length ? `${g.length} / **${pct(w / g.length)}**（${ciText(B.wilson(w, g.length))}）` : "—"; }).join("|") + "|");
    });
    const g = t => { const xs = rows.filter(r => tag(r) === t); return xs.length ? xs.filter(r => r.w === "F").length / xs.length : null; };
    l.push("", `一句话：先手队的近战比后手多时先手胜率 ${pct(g("more"))}，比后手少时 ${pct(g("less"))}——近战第一回合打不到人，先走过去的近战要先挨打（见「建议」「注意」）。`, "");
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
      suggest.push(`  - 补偿稍微减一点：${d ? `关掉补偿时先手胜率 ${pct(noLate.firstRate)}（先手占优），有补偿 ${pct(base.firstRate)}，1 个附赠的补偿略多了一点；` : ""}例如补偿的附赠只在先手的第一回合里有效（只能拿来协助格挡，不留到后手自己的回合），或者 4 人队以下才给；`);
      suggest.push("  - 或者减轻「先走过去」的吃亏（见下面「先走过去」那一条）。");
    } else suggest.push(`- **先后手**：${head}，整体看不出明显的先后手优势，暂时不用为先后手调数值${lean.length ? `；分人数看 ${lean.join("、")}，可以等真人对局再确认` : ""}。`);
    if (d) {
      const how = d.ci[1] < 0 ? "明显把先手胜率往下拉" : d.ci[0] > 0 ? "反而把先手胜率往上推" : "作用不明显（区间包含 0）";
      suggest.push(`- **后手补偿**：关掉补偿时先手胜率 ${pct(noLate.firstRate)}（${side(noLate) ? side(noLate) + "明显占优" : "看不出差别"}），有补偿 ${pct(base.firstRate)}：补偿${how}，${pp(d.d)} 个百分点（${pp(d.ci[0])} ~ ${pp(d.ci[1])}）。` +
        (side(noLate) === "先手" && !side(base) ? "补偿正好把先手的优势抹平，现在的 1 个附赠合适，不用改。" : side(noLate) === "先手" && side(base) === "后手" ? "方向对，但力度略大：从先手占优变成了后手略占优。" : ""));
    }
    if (noStand && side(noStand) && (side(noStand) !== side(base) || Math.abs(noStand.firstRate - base.firstRate) > 0.05)) {
      suggest.push(`- **不允许起身**：这个选项下先手胜率 ${pct(noStand.firstRate)}（${ciText(noStand.ci)}），${side(noStand)}明显占优（允许起身时 ${pct(base.firstRate)}）。倒地就再也起不来时，谁先打倒人更值钱，而第一回合先打到人的多半是后手（先手要先走过去）。如果这个选项常用，可以考虑选了「不允许起身」时${side(noStand) === "后手" ? "不给后手补偿，或者补偿只在先手的第一回合里有效" : "加大后手补偿"}，定之前可以先用这个工具跑一下。`);
    }
    const rows = (report.rows || []).filter(r => r.v === "rounds" && r.k === "random" && r.w !== "E");
    const limit = rows.filter(r => r.why === "rounds"), zero = limit.filter(r => r.pct && r.pct[0] === 0 && r.pct[1] === 0);
    if (zero.length) suggest.push(`- **回合上限的平局**：打满 10 回合按剩余血量判的 ${limit.length} 场里有 ${zero.length} 场两队都是 0%（场上的人都在靠坚毅生命战斗或倒地），只能判平局。可以考虑加一条不用坚毅数值的判法，例如百分比一样时比「还站着的人数」（倒地、再起不能的不算），再一样才算平局——不会透露坚毅数值。`);
    const stag = base.stag, down = base.down;
    if (stag.rate != null) suggest.push(stag.rate > 0.65
      ? `- **失衡滚雪球**：先打出第一次失衡的一方赢了 ${pct(stag.rate)}（${ciText(stag.ci)}；1v1 里 ${pct((get("base", 1) || {}).stag ? get("base", 1).stag.rate : null)}），第一次失衡和胜负关系很强（不过先打出失衡往往也说明这一方本来就占上风，不全是失衡本身的作用）；先打倒对方第一个人的一方赢了 ${pct(down.rate)}。如果想减弱：PvP 里失衡只跳过行动点、保留附赠（还能协助格挡），或者 PvP 里协助攻击不回满协助者的架势，或者每回合每队只能接一次协助攻击。`
      : `- **失衡滚雪球**：先打出第一次失衡的一方赢了 ${pct(stag.rate)}，关系不算特别强，暂时不用专门调。`);
    if (hold) {
      const dh = diff(hold, base);
      suggest.push(`- **先走过去的吃亏**：只改 AI、让先手第一回合原地等对面过来时，先手胜率变成 ${pct(hold.firstRate)}（${ciText(hold.ci)}；和现在的打法比 ${pp(dh.d)} 个百分点，见第 9 节）。开局两队隔着一个区，谁先走过去谁吃亏（走过去要用附赠、近战还打不到人、也没有附赠协助格挡），${d && Math.abs(dh.d) > Math.abs(d.d) ? "这比补偿的影响还大。" : "影响和补偿差不多大。"}真人对局里可能出现「谁都不愿先过去」：开了回合上限时就是平局。如果不希望这样，可以考虑开局只隔一个区（1 区对 2 区）、2 区制，或者给先手第一回合一个只能移动的附赠。`);
    }
  }
  caveats.push("- **自动打法和真人差很多**：两队都是 `BASIC_POLICY`，只会普攻血量最少的对手、打不到就用附赠走一格，**不用任何技能、道具，不召唤武器人**。真人会用技能（很多技能的击破比普攻高，失衡会来得更早、更多）、集火、走位、留附赠格挡、故意拖回合等，先后手的差别可能更大也可能更小。");
  caveats.push("- **AI 总是主动走过去**：3 区开局两队隔一个区，先手第一回合会用附赠走到 2 区（近战还打不到人，也没有附赠协助格挡），后手接着就能打到它。真人先手可能原地等（第 9 节的对照就是这样），对面也可以等——这时结果取决于谁先忍不住，这里测不到。");
  caveats.push("- **协助格挡 / 协助攻击总是用**：AI 能挡就挡、能协助攻击就打，不会为了留附赠移动而不挡；真人会权衡。后手补偿的价值主要在协助格挡上，所以这里测出来的补偿作用依赖这一点。");
  caveats.push("- **起身翻滚的用法是简单规则**：远程翻离同区的对手、近战翻到有对手的区；真人可能用得更好（例如翻到对手够不着、自己又能打到的地方），所以翻滚的影响可能被低估。");
  caveats.push("- **角色培养是固定的**：升级选主属性 / 第一个合法选项，武器等级 = 等级 × 0.6，没有义体、图纸、改装件；真实的 PvP 里两边的养成差别可能比先后手的影响大得多（第 2 节固定阵容里，阵容强弱能把一方的胜率拉到 90% 以上）。");
  caveats.push("- **阵容**：随机阵容来自 11 名角色，两队角色不重复；没有测两队人数不一样（例 4 对 2）、没有测友伤开关；决斗本来就是空场地，没有地形 / 天气。");
  caveats.push("- **「失衡滚雪球」是相关、不是因果**：先打出失衡的一方往往本来就占上风（阵容、骰子），所以它的高胜率不全是失衡本身带来的；镜像对局只抵消了先后手和阵容的平均影响。");
  caveats.push("- **统计**：每格几百场，单格的 95% 区间大约 ±5–6 个百分点，单格的小差别不要过度解读，看合计和趋势；不同情况用的是同一批阵容和种子，差值的区间按独立样本算，偏保守。");
  return { suggest, caveats };
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
  const out = {}, allowed = ["sizes", "levels", "pairs", "fixed", "variants", "seed", "workers", "out", "rebuild", "max-rounds"];
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
    out: out.out || CONFIG.out,
    rebuild: out.rebuild || null
  };
  if (opt.sizes.some(s => ![1, 2, 3, 4].includes(s))) throw new Error("sizes must be 1–4");
  if (opt.levels.some(L => !Number.isInteger(L) || L < 1 || L > 20)) throw new Error("levels must be 1–20");
  if (opt.variants.some(v => !VARIANTS[v])) throw new Error("variants: " + Object.keys(VARIANTS).join(", "));
  if (!Number.isInteger(opt.fixedPairs) || opt.fixedPairs < 0) throw new Error("fixed must be a nonnegative integer");
  return opt;
}
// json 里每场一行写成数组（字段顺序见 rowKeys），比对象小一半多；读的时候两种都认
const ROW_KEYS = ["v", "k", "s", "L", "i", "f", "w", "why", "r", "act", "st", "stR", "dn", "dnR", "out", "outR", "stF", "stS", "dnF", "dnS", "outF", "outS", "blk1", "blkF", "blkS", "asks", "wipes", "pct", "bugs", "err"];
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
  report.companions = companionsOf(outBase);
  report.notes = notesFor(report);
  const file = path.resolve(H.ROOT, outBase);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // json：表头照常缩进，rows 一场一行（几万场也好比对）；单独报告的汇总不重复存
  const head = Object.assign({}, report, { companions: undefined, rowKeys: ROW_KEYS, rows: "__ROWS__" });
  const rows = report.rows.map(r => "    " + JSON.stringify(packRow(r))).join(",\n");
  fs.writeFileSync(file + ".json", JSON.stringify(head, null, 2).replace('"__ROWS__"', () => "[\n" + rows + "\n  ]") + "\n");
  fs.writeFileSync(file + ".md", markdown(report));
  return file;
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
  const rows = await runJobs(jobs, opt.workers, () => { if (++done % 500 === 0 || done === jobs.length) console.log(`${done}/${jobs.length} 场（${Math.round((Date.now() - t0) / 1000)} 秒）`); });
  const c = H.load();
  const report = {
    schema: "backfire-pvp-balance-v1", version: CONFIG.version, generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000),
    provenance: provenance(argv),
    options: { sizes: opt.sizes, levels: opt.levels, pairs: opt.pairs, fixedPairs: opt.fixedPairs, variants: opt.variants, seed: opt.seed, maxRounds: opt.maxRounds, roundsLimit: CONFIG.roundsLimit, out: opt.out },
    variants: VARIANTS, fixed: FIXED, ruleSnapshot: JSON.parse(JSON.stringify(vm.runInContext("PVP_DUEL_CFG", c))),
    heroes: heroTable(opt.levels),
    lineups: Object.fromEntries(opt.sizes.flatMap(s => Array.from({ length: opt.pairs }, (_, i) => [`${s}:${i}`, lineup(opt.seed, s, i)]))),
    columns: { v: "情况", k: "random = 随机阵容 / 固定阵容 id", s: "每队人数", L: "等级", i: "阵容序号（随机阵容见 lineups）", f: "谁先手（a / b = 阵容 A / B）",
      w: "结果：F 先手赢 / S 后手赢 / D 平局 / T 超时 / E 异常", why: "wipe 全倒 / rounds 回合上限 / timeout", r: "回合", act: "行动次数",
      st: "第一次失衡是哪一方打出的（F / S）", stR: "第几回合", dn: "第一次打倒（倒地）", dnR: "第几回合", out: "第一次再起不能", outR: "第几回合",
      stF: "先手打出的失衡数", stS: "后手打出的失衡数", dnF: "先手打倒的次数", dnS: "后手打倒的次数", outF: "先手让对面再起不能的人数", outS: "后手让对面再起不能的人数",
      blk1: "后手在先手第 1 回合协助格挡几次（用补偿）", blkF: "先手整场协助格挡次数", blkS: "后手整场协助格挡次数",
      asks: "全员倒地、回合结束前被问：哪一方、第几回合、有没有人起身", wipes: "全员倒地后有人起身：哪一方、第几回合、是不是回合结束前被问时起的",
      pct: "回合上限判的剩余血量百分比 [先手, 后手]", bugs: "自检没通过", err: "异常" },
    rows
  };
  const file = finalize(report, opt.out);
  console.log(`${rows.length} 场，${report.seconds} 秒 → ${file}.md`);
  return rows.some(r => r.w === "E") ? 1 : 0;
}
if (isMainThread && require.main === module) main().then(code => { process.exitCode = code; }).catch(e => { console.error(e.stack || String(e)); process.exitCode = 1; });
module.exports = { CONFIG, VARIANTS, DEFAULT_VARIANTS, FIXED, lineup, plan, prepare, duelPolicy, runJob, runJobs, rollPick, summarize, summarizeAll, diff, packRow, unpackRow, markdown, notesFor, main };
