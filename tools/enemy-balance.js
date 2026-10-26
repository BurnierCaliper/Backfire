// 新敌人批量平衡模拟（issue #232）：外城区镇压部队的兵种对照、移动堡垒、敌人种族被动。
// 只测量、不改任何敌人 / 角色的数值；固定种子，同一份代码重跑结果相同。
//
//   node tools/enemy-balance.js                       五组全跑，每格 100 场 → docs/balance/new-enemies-1021.{md,json}
//   node tools/enemy-balance.js --samples 20 --groups template,fortress --out docs/balance/try --workers 2
//   node tools/enemy-balance.js --groups fortress --out docs/balance/fortress-token-1021
//                                                     移动堡垒占 1 枚代币的补测（issue #235；作者 10/21 定为现在的规则，issue #243）：
//                                                     有车不占（旧规则）/ 有车占 1 枚（现在的规则）/ 没车，种子和 #232 的堡垒组一样
//
// 每场的布置照 R1 单场矩阵（tools/score-by-act.js · one）：R1 的 10 名角色里随机 2–4 人、外城区所在的第 1 幕、
// 我方等级 = 敌人等级、升级选主属性 / 第一个合法选项、满状态、不用道具、BASIC 打法、30 回合上限。
// 遭遇走单局的 battleSpec（个体值打开、随机种族照抽、任务天气 / 战场配置物照抽），只在「抽遭遇」那一步换成要测的敌人。
// 同一格的几个对照组（镇压队 ↔ 模板、有 ↔ 没有堡垒、被动开 ↔ 关、亡命之王的各种族……）用同一批种子：
// 队伍、等级、区制、站位、天气、配置物完全一样，只差要比的那一处。
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const cp = require("node:child_process");
const { Worker, isMainThread, parentPort } = require("node:worker_threads");
const H = require("../tests/headless");
const B = require("./balance-common");

const CONFIG = {
  version: "enemy-balance-v1",
  seedPrefix: "EB1021",
  samples: 100,            // 每格场数（参照 R1 每格 100）
  sizes: [2, 3, 4],
  act: 1,                  // 外城区 = 第 1 幕（rogue-data.js · ROGUE_CONFIG.regions[0]）：普通战 1–4 级、精英战 +1、首领 4 级；
                           // 额外幕照表轮回，第 5 幕又是外城区（16–20 级）：--act 5，种子前缀加 -A5
  maxRounds: 30,           // 同 R1 单场
  flagPp: 10,              // 胜率差到这么多个百分点就列进「差距大的格子」
  workers: 2,
  out: "docs/balance/new-enemies-1021"
};
const GROUPS = ["template", "fortress", "race", "king", "heat"];

// 1. 兵种对照：镇压队兵种 ↔ 设计时的参照模板（docs/suppression-force.md 第 1 节），同一场里只换敌人。
//    杂兵 4 只 = 普通战的 4 枚代币；精英 2 只 = 4 枚代币、精英战等级。不带移动堡垒（只比兵种本身）
const PAIRS = [
  { id: "baton", label: "警棍盾 ↔ 狂徒（锤）", kind: "battle", count: 4, riot: "riot_baton", ref: "thug_hammer" },
  { id: "rifle", label: "燃烧步枪 ↔ 机器人看守（枪）", kind: "battle", count: 4, riot: "riot_rifle", ref: "guard_gun" },
  { id: "flamer", label: "火焰喷射兵 ↔ 警卫队队长（牛）", kind: "elite", count: 2, riot: "riot_flamer", ref: "captain_ox" },
  { id: "captain", label: "镇压小队长 ↔ 警卫队队长（狼）", kind: "elite", count: 2, riot: "riot_captain", ref: "captain_wolf" },
  { id: "molotov", label: "燃烧瓶投手 ↔ 燃烧步枪（投手没有模板）", kind: "battle", count: 4, riot: "riot_molotov", ref: "riot_rifle" }
];
// 2. 移动堡垒：必定有车（不占代币 = 旧规则；占 1 枚代币 = 现在的规则，VEHICLES.fortress.tokens 游戏里默认 1，作者 10/21 定）↔ 必定没车。
//    appear = 出现概率（掷骰次数不变，三组抽到的遭遇一样）；tokens = 车占几枚代币（每组都写死，不跟着游戏的默认值走，重跑的数和 #235 的报告对得上）
const FORTRESS = [
  { id: "with", label: "有车 · 不占代币（旧规则）", appear: 1, tokens: 0 },
  { id: "token", label: "有车 · 占 1 枚代币（现在的规则）", appear: 1, tokens: 1 },
  { id: "without", label: "没车", appear: 0, tokens: 0 }
];
// 3. 种族被动：警卫队队长按种类各一组（两只同种队长 = 4 枚代币，精英战等级）
const CAPTAINS = ["captain_wolf", "captain_ox", "captain_lizard"];
// 亡命之王抽得到的所有种族（盗匪的随机表：人类、红皮人、类人四个大支的每个小分支）
const KING_RACES = ["人类", "红皮人", "犬类人·狼", "犬类人·狐", "犬类人·犬", "猫类人·豹", "猫类人·虎", "猫类人·猫", "鼠类人·鼠", "鼠类人·兔", "牛类人·牛", "牛类人·马", "牛类人·羊"];
const NAMES = {
  riot_baton: "警棍盾", riot_rifle: "燃烧步枪", riot_molotov: "燃烧瓶投手", riot_flamer: "火焰喷射兵", riot_captain: "镇压小队长",
  thug_hammer: "狂徒（锤）", thug_knife: "狂徒（匕首）", bandit_boss: "强盗头子", outlaw_king: "亡命之王", guard_gun: "机器人看守（枪）",
  guard_sword: "机器人看守（剑）", patrol_car: "巡逻车", boomcar: "自爆车", swarm: "空投蜂群",
  captain_ox: "警卫队队长（牛）", captain_wolf: "警卫队队长（狼）", captain_lizard: "警卫队队长（蜥蜴）",
  fortress: "移动堡垒（车载武器）", fortress_blast: "移动堡垒（殉爆）", dot: "持续伤害 / 场地（灼烧、火场等，不分来源）", env: "其他环境伤害", friendly: "我方误伤"
};

/* ---------- 一场 ---------- */
/** 规则环境里装上计数（只读：不改任何结算，只在原函数前后记数） */
function instrument(c) {
  const S = c.S, m = { kits: {}, taken: 0, downs: 0, deaths: 0, rounds: 0, heroRounds: 0, burnHeroRounds: 0, burnRounds: 0, cover: 0, blast: 0, steal: 0, pulled: 0 };
  const now = { dot: null, blast: 0, key: null };
  const wrap = (name, fn) => { const orig = c[name]; if (typeof orig !== "function") throw new Error("missing rule function " + name); c[name] = (...args) => fn(orig, args); };
  const kitOf = u => u.vehId ? "fortress" : (u.kit || u.name || "?");
  const bucket = key => m.kits[key] || (m.kits[key] = { dmg: 0, dot: 0, brk: 0, downs: 0 });
  // 持续伤害（灼烧……）记在挂状态的人名下
  wrap("applyTypedDot", (orig, args) => { const prev = now.dot; now.dot = { by: args[5] && args[5].by }; try { return orig(...args); } finally { now.dot = prev; } });
  // 落在我方身上的每一下：按出手的敌人兵种记伤害（含坚毅生命）、击破
  wrap("applyCombat", (orig, args) => {
    const [t, res, a] = args;
    let key = null;
    if (t && t.isPlayer && res && !res.pending) {
      // 规则只给我方挂的状态记了来源（app.js · statusOwnerId），敌人挂在我方身上的灼烧不知道是谁的：统一记成 dot
      const owner = !a && now.dot && now.dot.by != null ? S.state.units.find(u => u.id === now.dot.by) : null;
      key = now.blast ? "fortress_blast" : a ? (a.isPlayer ? "friendly" : kitOf(a)) : owner && !owner.isPlayer ? kitOf(owner) : now.dot ? "dot" : "env";
      const k = bucket(key), dmg = Math.floor(Number(res.total) || 0) + Math.floor(Number(res.shpDealt) || 0);
      if (!a && now.dot && !now.blast) k.dot += dmg; else k.dmg += dmg;
      k.brk += (Number(res.breakSpent != null ? res.breakSpent : res.breakDealt) || 0) + (Number(res.helperBreak) || 0);
      m.taken += dmg;
    }
    const prev = now.key; now.key = key || now.key;
    try { return orig(...args); } finally { now.key = prev; }
  });
  wrap("applyKnockdown", (orig, args) => {
    const u = args[0], hero = u && u.isPlayer && !c.isWeaponUnit(u), down0 = hero && !!u.dying, dead0 = hero && !!u.dead;
    const out = orig(...args);
    if (hero && !down0 && u.dying) { m.downs++; if (now.key) bucket(now.key).downs++; }
    if (hero && !dead0 && u.dead) m.deaths++;
    return out;
  });
  // 每回合敌人行动完：数一数我方角色身上有没有灼烧
  wrap("endEnemyTurn", (orig, args) => {
    const hs = S.state.units.filter(u => u.isPlayer && !c.isWeaponUnit(u) && !u.dead && !u.hidden);
    const burning = hs.filter(u => (Number(u.statuses && u.statuses.burn) || 0) > 0).length;
    m.rounds++; m.heroRounds += hs.length; m.burnHeroRounds += burning; if (burning) m.burnRounds++;
    return orig(...args);
  });
  // 移动堡垒：代挡、殉爆、我方上车（抢车）、我方拉人下车
  wrap("vehicleGuard", (orig, args) => { const r = orig(...args); if (r) m.cover++; return r; });
  wrap("vehicleDestroy", (orig, args) => { if (args[0] && !args[0]._destroyed) m.blast++; now.blast++; try { return orig(...args); } finally { now.blast--; } });
  wrap("vehicleBoard", (orig, args) => { if (args[0] && args[0].isPlayer) m.steal++; return orig(...args); });
  wrap("vehiclePull", (orig, args) => { const occ = args[2], on = occ && occ.vehId; const out = orig(...args); if (args[0] && args[0].isPlayer && on && !occ.vehId) m.pulled++; return out; });
  return m;
}

/** 遭遇里的敌人占几枚代币（成组的整组记一次：空投蜂群 3 只 1 枚、穴鸦一群 4 枚；三区制的站位把一组拆成一只一行，按只数折回去） */
function encounterTokens(c, enc) {
  const n = {};
  ((enc && enc.enemies) || []).forEach(e => { n[e.preset] = (n[e.preset] || 0) + Math.max(1, Number(e.count) || 1); });
  return Object.keys(n).reduce((s, k) => {
    const g = (c.enemyInfo(k) || {}).group, size = Array.isArray(g) ? g[1] : Number(g) || 1;
    return s + c.enemyTokens(k) * Math.ceil(n[k] / size);
  }, 0);
}

/** 照 R1 单场矩阵布置队伍和战斗配置：battleSpec 之后把队伍升到敌人等级、选好升级、满状态 */
function prepare(c, job) {
  const R = c.Rogue, r = B.rng(job.seed + ":setup");
  c.S.RNG.install(job.seed + ":setup");
  const run = R.newRun({ party: B.partyFor(job.seed, job.size), seed: job.seed });
  run.act = job.act || CONFIG.act;
  if (job.kind === "boss") { run.actDay = 8; run.stage = "boss"; }
  else { run.actDay = 0; R.makeBoard(run); R.acceptTask(run, "main"); run.actDay = Math.floor(r() * 8); run.task.nodes[run.task.index] = { type: job.kind, done: false }; }
  const spec = R.battleSpec(run);
  if (!spec) throw new Error("Missing battle specification");
  const level = spec.level;
  run.party.forEach(h => { const from = h.level || 1; h.level = level; h.xp = 0; h.hp = null; h.shp = null; R.queueLevelRewards(h, from, level, [], run); Object.keys(h.weaponLevels || {}).forEach(k => { h.weaponLevels[k] = Math.max(1, Math.min(10, Math.round(level * .6))); }); });
  B.chooseLevels(R, run, []);
  run.party.forEach(h => { h.hp = null; h.shp = null; h.weaponState = {}; });
  c.S.LEDGER.dur = {}; c.S.LEDGER.weapons = {}; c.S.LEDGER.heroes = {}; c.S.LEDGER.hours = 0;
  return { run, spec, level };
}

function runJob(job) {
  const row = { group: job.group, cell: job.cell, variant: job.variant, kind: job.kind, size: job.size, index: job.index, seed: job.seed, outcome: "error" };
  try {
    const c = H.load(), get = expr => vm.runInContext(expr, c);
    // 抽遭遇的那一步换成要测的敌人（battleSpec 照常在 withRng 里调用它，所以同一种子的区制、站位、天气、配置物一样）
    if (job.enemies || job.faction) {
      const orig = c.rollEncounter;
      c.rollEncounter = opt => job.enemies
        ? c.finishEncounter({ name: "对照", region: opt.region, faction: null, tier: job.kind === "elite" ? "elite" : "normal", tokens: 4, mixed: false, enemies: B.clone(job.enemies), vehicles: [] }, opt)
        : orig(Object.assign({}, opt, { faction: job.faction }));
    }
    if (job.fortress != null) get("VEHICLES").fortress.appear = job.fortress;   // 必定有 1 / 必定没有 0（掷骰次数不变，两组抽到的遭遇一样）
    if (job.vehicleTokens != null) get("VEHICLES").fortress.tokens = job.vehicleTokens;   // 车占几枚代币（游戏里默认 1；旧规则那组写回 0 = 不占）
    if (job.raceOff) get("RACE_PERK").off = 1;
    const m = instrument(c);
    const { spec, level } = prepare(c, job);
    if (job.weather) spec.encounter.weather = job.weather;
    if (job.kingRace) spec.encounter.enemies.find(e => e.preset === "outlaw_king").race = job.kingRace;
    c.BattleSim.setup(spec);
    const S = c.S.state, foes = S.units.filter(u => !u.isPlayer && !u.hidden);
    const car = c.vehicleProps()[0] || null, veh = (spec.encounter.vehicles || [])[0];
    Object.assign(row, { level, party: S.units.filter(u => u.isPlayer && !c.isWeaponUnit(u)).map(u => u.kit), weather: S.weather, zoneMode: S.zoneMode,
      enemies: foes.map(u => u.kit), races: foes.filter(u => u.race).map(u => u.kit + ":" + c.raceLabel(u.race)), vehicle: !!car, vehicleArmor: car ? car.maxHp : 0,
      tokens: encounterTokens(c, spec.encounter), vehicleTokens: car && veh ? Number(veh.tokens) || 0 : 0 });
    const res = c.BattleSim.run({ maxRounds: CONFIG.maxRounds });
    row.outcome = res.winner === "player" ? "win" : res.winner === "enemy" ? "lose" : res.winner === "timeout" ? "timeout" : "error";
    const left = car ? (c.vehicleProps().find(p => p.id === car.id) || null) : null;
    Object.assign(row, { rounds: res.rounds, taken: m.taken, downs: m.downs, deaths: m.deaths, roundsSeen: m.rounds, heroRounds: m.heroRounds, burnHeroRounds: m.burnHeroRounds, burnRounds: m.burnRounds,
      kits: m.kits, cover: m.cover, blast: m.blast, steal: m.steal, pulled: m.pulled, vehicleLeft: car ? (left ? c.vehicleArmor(left).cur : 0) : 0 });
    if (c.__errors.length) throw new Error(`Rule console.error: ${c.__errors.join(" | ")}`);
  } catch (e) { row.outcome = "error"; row.error = e.stack || String(e); }
  return B.clone(row);
}

/* ---------- 抽样计划 ---------- */
const seedPrefix = act => act === CONFIG.act ? CONFIG.seedPrefix : `${CONFIG.seedPrefix}-A${act}`;
function plan(opt = {}) {
  const n = opt.samples || CONFIG.samples, want = new Set(opt.groups || GROUPS), sizes = opt.sizes || CONFIG.sizes, jobs = [];
  const act = opt.act || CONFIG.act, prefix = seedPrefix(act);
  const add = (group, cell, variant, kind, size, i, extra) => jobs.push(Object.assign({ group, cell, variant, kind, act, size, index: i, seed: `${prefix}:${group}:${cell}:${size}:${String(i).padStart(3, "0")}` }, extra));
  for (const size of sizes) for (let i = 0; i < n; i++) {
    if (want.has("template")) PAIRS.forEach(p => ["riot", "ref"].forEach(v => add("template", p.id, v, p.kind, size, i, { enemies: [{ preset: p[v], count: p.count }] })));
    if (want.has("fortress")) ["battle", "elite"].forEach(kind => FORTRESS.forEach(v => add("fortress", kind, v.id, kind, size, i, { faction: "镇压队", fortress: v.appear, vehicleTokens: v.tokens })));
    if (want.has("race")) {
      ["on", "off"].forEach(v => add("race", "bandit", v, "battle", size, i, { faction: "盗匪", raceOff: v === "off" }));
      CAPTAINS.forEach(k => ["on", "off"].forEach(v => add("race", k, v, "elite", size, i, { enemies: [{ preset: k, count: 2 }], raceOff: v === "off" })));
      ["on", "off"].forEach(v => add("race", "outlaw_king", v, "boss", size, i, { raceOff: v === "off" }));
    }
    if (want.has("king")) KING_RACES.forEach(race => add("king", "outlaw_king", race, "boss", size, i, { kingRace: race }));
    if (want.has("heat")) ["none", "heat"].forEach(w => add("heat", "riot", w, "battle", size, i, { faction: "镇压队", weather: w }));
  }
  return jobs;
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
function summarize(rows) {
  const s = B.summarize(rows), ok = rows.filter(r => r.outcome !== "error"), n = ok.length;
  const avg = f => n ? ok.reduce((a, r) => a + (Number(f(r)) || 0), 0) / n : null;
  const sum = f => ok.reduce((a, r) => a + (Number(f(r)) || 0), 0);
  const kits = {};
  ok.forEach(r => Object.keys(r.kits || {}).forEach(k => { const x = kits[k] || (kits[k] = { dmg: 0, dot: 0, brk: 0, downs: 0 }); Object.keys(x).forEach(f => { x[f] += Number(r.kits[k][f]) || 0; }); }));
  Object.keys(kits).forEach(k => Object.keys(kits[k]).forEach(f => { kits[k][f] = n ? kits[k][f] / n : 0; }));
  const cars = ok.filter(r => r.vehicle), cn = cars.length;
  const levels = [...new Set(ok.map(r => r.level))].sort((a, b) => a - b);
  return {
    n: rows.length, outcomes: s.outcomes, winRate: s.winRate, ci: s.winRate95, levels,
    rounds: avg(r => r.rounds), taken: avg(r => r.taken), downs: avg(r => r.downs), deaths: avg(r => r.deaths),
    tokens: avg(r => r.tokens), foes: avg(r => (r.enemies || []).length),
    burnShare: sum(r => r.heroRounds) ? sum(r => r.burnHeroRounds) / sum(r => r.heroRounds) : null,
    burnRoundShare: sum(r => r.roundsSeen) ? sum(r => r.burnRounds) / sum(r => r.roundsSeen) : null,
    kits,
    vehicle: { battles: cn, paid: cn ? cars.reduce((a, r) => a + (Number(r.vehicleTokens) || 0), 0) / cn : null,
      cover: cn ? cars.reduce((a, r) => a + r.cover, 0) / cn : null, blastRate: cn ? cars.filter(r => r.blast > 0).length / cn : null,
      steal: cn ? cars.reduce((a, r) => a + r.steal + r.pulled, 0) / cn : null, stealBattles: cars.filter(r => r.steal + r.pulled > 0).length,
      dmg: cn ? cars.reduce((a, r) => a + ((r.kits.fortress || {}).dmg || 0) + ((r.kits.fortress || {}).dot || 0), 0) / cn : null,
      blastDmg: cn ? cars.reduce((a, r) => a + ((r.kits.fortress_blast || {}).dmg || 0), 0) / cn : null,
      absorbed: cn ? cars.reduce((a, r) => a + (r.vehicleArmor - r.vehicleLeft), 0) / cn : null }
  };
}
/** rows → { "group|cell|variant|size": 汇总 }，size 写 all 是三种人数合在一起 */
function summarizeAll(rows) {
  const out = {}, keys = new Set();
  rows.forEach(r => { keys.add([r.group, r.cell, r.variant, r.size].join("|")); keys.add([r.group, r.cell, r.variant, "all"].join("|")); });
  keys.forEach(k => { const [g, c, v, s] = k.split("|"); out[k] = summarize(rows.filter(r => r.group === g && r.cell === c && r.variant === v && (s === "all" || String(r.size) === s))); });
  return out;
}
/** 均值和正态近似的 95% 区间（每个种子一个数） */
function meanCi(xs) {
  const n = xs.length;
  if (!n) return null;
  const mean = xs.reduce((a, x) => a + x, 0) / n, sd = n > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : 0, half = 1.959963984540054 * sd / Math.sqrt(n);
  return { mean, ci: [mean - half, mean + half] };
}
/** 移动堡垒组按种子配对（同一种子三组只差车）：两两的胜率差，和按出现率 appear 折算的镇压队遭遇平均胜率
 *  （旧规则 now = appear × 有车不占 + (1 − appear) × 没车；现在的规则 token = appear × 有车占 1 枚 + (1 − appear) × 没车。
 *  键名照 #235 报告的 json 不改：now 是当时的现状，也就是旧规则）。区间是配对后的正态近似 */
function fortressStats(rows, sizes, appear) {
  const out = { appear, cells: {} };
  ["battle", "elite"].forEach(kind => sizes.concat("all").forEach(size => {
    const by = new Map();
    rows.forEach(r => {
      if (r.group !== "fortress" || r.cell !== kind || r.outcome === "error" || (size !== "all" && r.size !== size)) return;
      const k = r.size + "|" + r.index, x = by.get(k) || {};
      x[r.variant] = r.outcome === "win" ? 1 : 0;
      by.set(k, x);
    });
    const seeds = [...by.values()].filter(x => FORTRESS.every(v => x[v.id] != null));
    if (!seeds.length) return;
    const col = f => meanCi(seeds.map(f));
    out.cells[kind + "|" + size] = {
      n: seeds.length,
      tokenVsWith: col(x => x.token - x.with), withoutVsWith: col(x => x.without - x.with), withoutVsToken: col(x => x.without - x.token),
      now: col(x => appear * x.with + (1 - appear) * x.without), token: col(x => appear * x.token + (1 - appear) * x.without),
      gain: col(x => appear * (x.token - x.with))
    };
  }));
  return out;
}

/* ---------- 报告 ---------- */
const pct = x => x == null ? "—" : (x * 100).toFixed(1) + "%";
const ci = s => s && s.ci ? `${(s.ci[0] * 100).toFixed(0)}–${(s.ci[1] * 100).toFixed(0)}%` : "—";
const f1 = x => x == null ? "—" : Number(x).toFixed(1);
const f2 = x => x == null ? "—" : Number(x).toFixed(2);
const pp = (a, b) => a == null || b == null ? null : (a - b) * 100;
const ppText = d => d == null ? "—" : (d > 0 ? "+" : d < 0 ? "−" : "±") + Math.abs(d).toFixed(1);
const wlt = s => `${s.outcomes.win}/${s.outcomes.lose}/${s.outcomes.timeout}${s.outcomes.error ? `（异常 ${s.outcomes.error}）` : ""}`;
const winCell = s => s ? `${pct(s.winRate)}（${ci(s)}）` : "—";
const lv = s => s && s.levels.length ? (s.levels.length > 1 ? `${s.levels[0]}–${s.levels[s.levels.length - 1]}` : String(s.levels[0])) : "—";
const kitName = k => NAMES[k] || k;
const kitLine = (s, only) => Object.keys(s.kits).filter(k => !only || only.includes(k)).sort((a, b) => (s.kits[b].dmg + s.kits[b].dot) - (s.kits[a].dmg + s.kits[a].dot))
  .map(k => `${kitName(k)} ${f1(s.kits[k].dmg)}${s.kits[k].dot >= 0.05 ? `+${f1(s.kits[k].dot)}` : ""} / ${f1(s.kits[k].brk)}${s.kits[k].downs >= 0.05 ? ` / 倒 ${f1(s.kits[k].downs)}` : ""}`).join("；") || "—";

function compareTable(l, S, group, cell, a, b, labels, sizes, extra) {
  l.push(`|人数|敌人等级|${labels[0]} 胜率（95%）|${labels[1]} 胜率（95%）|差（百分点）|胜/败/超时|平均回合|我方承伤|倒地|灼烧人·回合|${extra ? extra.head : ""}`);
  l.push(`|---:|---|---|---|---:|---|---|---|---|---|${extra ? extra.sep : ""}`);
  for (const size of sizes.concat("all")) {
    const x = S[[group, cell, a, size].join("|")], y = S[[group, cell, b, size].join("|")];
    if (!x || !y) continue;
    l.push(`|${size === "all" ? "合计" : size}|${lv(x)}|${winCell(x)}|${winCell(y)}|${ppText(pp(x.winRate, y.winRate))}|${wlt(x)} ↔ ${wlt(y)}|${f1(x.rounds)} ↔ ${f1(y.rounds)}|${f1(x.taken)} ↔ ${f1(y.taken)}|${f1(x.downs)} ↔ ${f1(y.downs)}|${pct(x.burnShare)} ↔ ${pct(y.burnShare)}|${extra ? extra.row(x, y) : ""}`);
  }
}
/** 移动堡垒组：每种人数三行（有车不占代币 = 旧规则 / 有车占 1 枚代币 = 现在的规则 / 没车） */
function fortressTable(l, S, kind, sizes) {
  l.push("|人数|对照组|敌人等级|敌人：代币 / 只数|胜率（95%）|胜/败/超时|平均回合|我方承伤|倒地|灼烧人·回合|实际带车|代挡 / 场|殉爆率|抢车 / 场|堡垒伤害 / 场（车载 + 殉爆）|堡垒装甲承伤 / 场|");
  l.push("|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const size of sizes.concat("all")) FORTRESS.forEach(v => {
    const x = S[["fortress", kind, v.id, size].join("|")];
    if (!x) return;
    const car = x.vehicle;
    l.push(`|${size === "all" ? "合计" : size}|${v.label}|${lv(x)}|${f2(x.tokens)} / ${f1(x.foes)}|${winCell(x)}|${wlt(x)}|${f1(x.rounds)}|${f1(x.taken)}|${f1(x.downs)}|${pct(x.burnShare)}|${car.battles}/${x.n}|${f1(car.cover)}|${pct(car.blastRate)}|${f1(car.steal)}|${car.battles ? `${f1(car.dmg)} + ${f1(car.blastDmg)}` : "—"}|${f1(car.absorbed)}|`);
  });
}
const ppCi = m => m ? `${ppText(m.mean * 100)}（${ppText(m.ci[0] * 100)} ~ ${ppText(m.ci[1] * 100)}）` : "—";
const pctCi = m => m ? `${pct(m.mean)}（${(m.ci[0] * 100).toFixed(0)}–${(m.ci[1] * 100).toFixed(0)}%）` : "—";

function flags(S, sizes) {
  const out = [];
  const check = (group, cell, a, b, label) => sizes.concat("all").forEach(size => {
    const x = S[[group, cell, a, size].join("|")], y = S[[group, cell, b, size].join("|")];
    const d = x && y ? pp(x.winRate, y.winRate) : null;
    if (d != null && Math.abs(d) >= CONFIG.flagPp) out.push({ group, cell, size, label, a, b, diff: d, x: x.winRate, y: y.winRate });
  });
  PAIRS.forEach(p => check("template", p.id, "riot", "ref", p.label));
  ["battle", "elite"].forEach(k => {
    const name = `镇压队遭遇（${k === "elite" ? "精英战" : "普通战"}）`;
    check("fortress", k, "with", "without", `${name}：有车（不占代币）↔ 没车`);
    check("fortress", k, "token", "without", `${name}：有车（占 1 枚代币）↔ 没车`);
    check("fortress", k, "token", "with", `${name}：有车占 1 枚代币 ↔ 不占`);
  });
  ["bandit"].concat(CAPTAINS, ["outlaw_king"]).forEach(k => check("race", k, "on", "off", `${k === "bandit" ? "盗匪遭遇" : kitName(k)}：种族被动开 ↔ 关`));
  check("heat", "riot", "heat", "none", "镇压队遭遇：酷暑 ↔ 无天气");
  return out;
}

function markdown(report) {
  const S = report.summary, sizes = report.options.sizes, has = g => report.options.groups.includes(g), l = [], act = report.options.act || CONFIG.act;
  const P = report.provenance;
  const only = report.options.groups.length === 1 && has("fortress");   // 只跑堡垒组：issue #235 的补测
  l.push(`# ${only ? "移动堡垒占 1 枚代币的平衡补测（外城区镇压部队）" : "新敌人批量平衡模拟（外城区镇压部队 · 移动堡垒 · 敌人种族被动）"}${act !== CONFIG.act ? `· 第 ${act} 幕` : ""}`, "",
    "只测量，不改任何数值。下面的表由 `tools/enemy-balance.js` 生成，重跑会覆盖到「手写分析」标记为止，标记之后的手写内容保留。", "",
    `- 版本：提交 \`${P.commit || "未知"}\`${P.dirty ? "（生成时工作区有未提交改动，见 json 的 sourceHash）" : ""}；规则源码 SHA256 \`${P.sourceHash.slice(0, 16)}…\`；Node ${P.node}；工具 ${CONFIG.version}`,
    `- 命令：\`${P.command}\``,
    `- 样本：每格（一种人数 × 一个对照组）**${report.options.samples} 场**，人数 ${sizes.join(" / ")}；共 ${report.rows} 场，异常 ${report.errors} 场，超时 ${report.timeouts} 场（超时算进分母，不算胜）。`,
    `- 种子：\`${seedPrefix(act)}:组:格:人数:序号\`（序号 000–${String(report.options.samples - 1).padStart(3, "0")}）。同一格的对照组共用种子：队伍、等级、区制、站位、天气、配置物完全一样，只差要比的那一处。`,
    `- 布置：照 R1 单场矩阵（\`tools/score-by-act.js · one\`）——R1 的 10 名角色里按种子随机 2–4 人；外城区 = **第 ${act} 幕**，敌人等级按这一幕的任务天数取、精英战 +1、首领 = 本幕上限（每格的范围见「敌人等级」一列）；我方等级 = 敌人等级，升级选主属性 / 第一个合法选项，武器等级 = 等级 × 0.6（最高 10）；满状态、不用道具；我方 BASIC 打法（打得到就普攻血最少的，打不到就走一格），敌人用游戏里的 AI；30 回合上限。`,
    "- 遭遇：走单局的 `battleSpec`（个体值 ±10% 打开、随机种族照抽、任务天气 / 战场配置物照抽），只在「抽遭遇」那一步换成要测的敌人。",
    "- 胜率是 BASIC 自动打法的胜率，**不是真人胜率**；看的是两组之间的差。区间是 Wilson 95%。", "",
    "列的意思：「我方承伤」= 一场里我方所有单位受到的伤害合计（含坚毅生命、持续伤害）；「倒地」= 一场里我方角色倒地次数；「灼烧人·回合」= 每回合敌人行动完时我方在场角色身上挂着灼烧的比例。",
    "兵种伤害写成「直接伤害 + 持续伤害（灼烧等，记在挂状态的人名下）/ 击破 / 倒（打倒地的次数）」，都是每场平均、只算打在我方身上的。", "");

  if (has("template")) {
    l.push("## 1. 兵种对照模板", "", "镇压队兵种和设计时的参照模板，同一批种子各打一组：杂兵 4 只（普通战等级）、精英 2 只（精英战等级），不带移动堡垒。设计目标：ATK 比模板低 1、火打肉体 +50% 补回来，应该和模板差不多；**差 10 个百分点以上**的列在最后一节。", "");
    PAIRS.forEach(p => {
      l.push(`### ${p.label}（${p.count} 只 × ${p.kind === "elite" ? "精英战" : "普通战"}）`, "");
      compareTable(l, S, "template", p.id, "riot", "ref", [NAMES[p.riot], NAMES[p.ref]], sizes);
      const x = S[`template|${p.id}|riot|all`], y = S[`template|${p.id}|ref|all`];
      if (x && y) l.push("", `兵种伤害（合计，每场）：${NAMES[p.riot]}：${kitLine(x)}。${NAMES[p.ref]}：${kitLine(y)}。`);
      l.push("");
    });
  }
  if (has("fortress")) {
    const F = report.fortress, a = F ? F.appear : null;
    l.push("## 2. 镇压部队的遭遇：必定有车（不占代币 / 占 1 枚代币）↔ 必定没车", "",
      "按 `run.js · rollEncounter` 正常抽外城区的镇压队遭遇（阵营定为镇压队，含 15% 和安保 / 警卫队混编；普通战 4 枚代币（5% 是 5 枚）、精英战 5 枚），三组用同一批种子：", "",
      "- **有车 · 不占代币**（旧规则）：移动堡垒的出现概率改成 1，`VEHICLES.fortress.tokens` 改回 0，车加在抽满代币的遭遇上。",
      "- **有车 · 占 1 枚代币**（现在的规则，作者 10/21 定）：出现概率 1，`VEHICLES.fortress.tokens` 照游戏里的 1——带车的遭遇退掉 1 枚代币的敌人：从最后抽到的往前退，镇压队至少留一个人当驾驶员；退掉的是 2 枚代币的精英时，从同一个池子补抽 1 枚，和一开始就少抽 1 枚代币一样（`vehicle.js · vehiclePayTokens`）。",
      "- **没车**：出现概率改成 0。", "",
      "掷骰次数不变（退代币在区制、站位、带不带车都定下来以后），所以三组的区制、站位、天气、配置物一样；「不占代币」和「没车」抽到的敌人一样，「占 1 枚代币」只差退掉的那 1 枚。混编抽到的遭遇里没有镇压队员时没有驾驶员，车不会上场、也不退代币，「实际带车」一列是真正有车的场数。「敌人：代币 / 只数」= 开局敌人占的代币和只数（每场平均，成组的空投蜂群 3 只记 1 枚）。", "");
    ["battle", "elite"].forEach(kind => {
      l.push(`### ${kind === "elite" ? "精英战（5 枚代币，精英战等级）" : "普通战（4 枚代币）"}`, "");
      fortressTable(l, S, kind, sizes);
      const t = S[`fortress|${kind}|token|all`];
      if (t && t.vehicle.battles) l.push("", `「占 1 枚代币」那组带车的 ${t.vehicle.battles} 场，车平均占了 ${f2(t.vehicle.paid)} 枚代币${t.vehicle.paid === 1 ? "（每场都退足了 1 枚）" : ""}。`);
      if (F) {
        l.push("", "胜率差（同一种子配对，百分点；括号是正态近似 95% 区间）：", "",
          "|人数|占 1 枚 − 不占代币|没车 − 不占代币|没车 − 占 1 枚|", "|---:|---|---|---|");
        sizes.concat("all").forEach(size => { const m = F.cells[`${kind}|${size}`]; if (m) l.push(`|${size === "all" ? "合计" : size}|${ppCi(m.tokenVsWith)}|${ppCi(m.withoutVsWith)}|${ppCi(m.withoutVsToken)}|`); });
        l.push("", `按 ${Math.round(a * 100)}% 出现率折算的镇压队遭遇平均胜率（每个种子按 ${a} × 有车 + ${Number((1 - a).toFixed(2))} × 没车 折算；括号是配对后的正态近似 95% 区间）：`, "",
          "|人数|旧规则：车不占代币|现在的规则：车占 1 枚代币|差（百分点）|", "|---:|---|---|---|");
        sizes.concat("all").forEach(size => { const m = F.cells[`${kind}|${size}`]; if (m) l.push(`|${size === "all" ? "合计" : size}|${pctCi(m.now)}|${pctCi(m.token)}|${ppCi(m.gain)}|`); });
      }
      const xs = FORTRESS.map(v => [v, S[`fortress|${kind}|${v.id}|all`]]).filter(([, x]) => x);
      if (xs.length) l.push("", `兵种伤害（合计，每场）——${xs.map(([v, x]) => `${v.label}：${kitLine(x)}`).join("。")}。`);
      l.push("");
    });
    l.push("BASIC 打法不会上车、不会拉人，所以「抢车」一定是 0：这一列只说明我方没有用这条解法，不说明抢车难不难。", "");
  }
  if (has("race")) {
    l.push("## 3. 种族被动：开 ↔ 关", "", "同一批遭遇，`RACE_PERK.off`（只给工具用的开关，默认 0 = 开）打开 / 关上各打一组。关上只关被动（热耐性、独狼、易怒蛮牛、吐酸……），种族本身和随机种族的六维换算照旧。", "");
    [["bandit", "盗匪遭遇（普通战，按 rollEncounter 抽：狂徒两种、强盗头子，随机种族）"], ...CAPTAINS.map(k => [k, `${NAMES[k]} × 2（精英战）`]), ["outlaw_king", "亡命之王（首领战，带三名固定随从和两波援军，全是随机种族）"]].forEach(([cell, title]) => {
      l.push(`### ${title}`, "");
      compareTable(l, S, "race", cell, "on", "off", ["被动开", "被动关"], sizes);
      const x = S[`race|${cell}|on|all`], y = S[`race|${cell}|off|all`];
      if (x && y) l.push("", `兵种伤害（合计，每场）——开：${kitLine(x)}。关：${kitLine(y)}。`);
      l.push("");
    });
  }
  if (has("king")) {
    l.push("## 3b. 亡命之王抽到各种族时的胜率", "", "首领战（本幕上限等级），把亡命之王的种族写死成下面每一种，其余（随从、援军的种族，个体值，战场）照常；同一批种子，所以各种族之间只差王的种族。种族被动开着（游戏里的样子）。", "");
    l.push(`|王的种族|${sizes.map(s => `${s} 人 胜率（95%）`).join("|")}|合计 胜率（95%）|合计 胜/败/超时|平均回合|我方承伤|倒地|亡命之王伤害 / 击破|`);
    l.push(`|---|${sizes.map(() => "---").join("|")}|---|---|---|---|---|---|`);
    KING_RACES.forEach(race => {
      const all = S[`king|outlaw_king|${race}|all`];
      if (!all) return;
      const k = all.kits.outlaw_king || { dmg: 0, dot: 0, brk: 0 };
      l.push(`|${race}|${sizes.map(s => winCell(S[`king|outlaw_king|${race}|${s}`])).join("|")}|${winCell(all)}|${wlt(all)}|${f1(all.rounds)}|${f1(all.taken)}|${f1(all.downs)}|${f1(k.dmg + k.dot)} / ${f1(k.brk)}|`);
    });
    l.push("");
  }
  if (has("heat")) {
    l.push("## 4. （可选）酷暑下的镇压部队", "", "镇压队遭遇（普通战，移动堡垒照常 30%），天气写死成「酷暑」↔「无天气」。赤牙部队天气的「灼烧加倍」就是酷暑本身对灼烧的效果（作者 10/21 确认）：灼烧每回合结算后的自我叠层从 1 层变成 2 层（`app.js` 回合结束的灼烧结算，酷暑时叠层 +1），另外火 +25%。这一组测的就是完整的部队天气。", "");
    compareTable(l, S, "heat", "riot", "heat", "none", ["酷暑", "无天气"], sizes);
    const x = S["heat|riot|heat|all"], y = S["heat|riot|none|all"];
    if (x && y) l.push("", `兵种伤害（合计，每场）——酷暑：${kitLine(x)}。无天气：${kitLine(y)}。`);
    l.push("");
  }
  l.push("## 差距大的格子（自动列出，|差| ≥ " + CONFIG.flagPp + " 个百分点）", "");
  if (!report.flags.length) l.push("没有。", "");
  else {
    l.push("|对照|人数|差（百分点）|胜率|", "|---|---:|---:|---|");
    report.flags.forEach(f => l.push(`|${f.label}|${f.size === "all" ? "合计" : f.size}|${ppText(f.diff)}|${pct(f.x)} ↔ ${pct(f.y)}|`));
    l.push("");
  }
  return l.join("\n");
}

/* ---------- 命令行 ---------- */
const MARK = "<!-- 手写分析：重跑工具时，这一行以下的内容保留 -->";
function provenance(argv) {
  const files = [...H.RULE_FILES, "tests/headless.js", "tools/balance-common.js", "tools/enemy-balance.js"];
  const sourceHashes = Object.fromEntries(files.map(f => [f, B.hash(B.normalizeSource(fs.readFileSync(path.join(H.ROOT, f), "utf8")))]));
  let commit = null, dirty = null;
  try { commit = cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: H.ROOT, encoding: "utf8" }).trim(); dirty = !!cp.execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: H.ROOT, encoding: "utf8" }).trim(); } catch (_) { /* 没有 git：看 sourceHash */ }
  return { commit, dirty, sourceHash: B.hash(sourceHashes), sourceHashes, node: process.version, command: ["node", "tools/enemy-balance.js", ...argv].join(" "), strategy: B.STRATEGIES.matrix.version };
}
function parseArgs(argv) {
  const out = {}, allowed = ["samples", "groups", "out", "workers", "sizes", "act"];
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--") || !allowed.includes(key.slice(2))) throw new Error("Unknown argument: " + key);
    const v = argv[++i];
    if (v == null || v.startsWith("--")) throw new Error("Missing value for " + key);
    out[key.slice(2)] = v;
  }
  const groups = out.groups ? out.groups.split(",") : GROUPS;
  if (groups.some(g => !GROUPS.includes(g))) throw new Error("Unknown group: " + groups.join(","));
  const sizes = out.sizes ? out.sizes.split(",").map(Number) : CONFIG.sizes;
  if (sizes.some(s => ![2, 3, 4].includes(s))) throw new Error("Sizes must be 2, 3, 4");
  const act = out.act ? B.positiveInt(out.act, "act") : CONFIG.act;
  if (act !== CONFIG.act) {
    const C = H.load().S.ROGUE_CONFIG, total = C.acts + (C.extraActs || 0);
    if (act > total || C.regions[(act - 1) % C.regions.length] !== "外城区") throw new Error(`Act ${act} is not an 外城区 act`);
  }
  return { samples: out.samples ? B.positiveInt(out.samples, "samples") : CONFIG.samples, groups, sizes, act, workers: out.workers ? B.positiveInt(out.workers, "workers") : CONFIG.workers, out: out.out || CONFIG.out };
}
function outPath(file) {
  const root = path.resolve(H.ROOT, "docs/balance"), resolved = path.resolve(H.ROOT, file);
  if (!resolved.startsWith(root + path.sep)) throw new Error("Reports must be inside docs/balance/");
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}
async function main(argv = process.argv.slice(2)) {
  const opt = parseArgs(argv), file = outPath(opt.out), meta = provenance(argv), jobs = plan(opt);
  let done = 0;
  const rows = await runJobs(jobs, opt.workers, () => { if (++done % 200 === 0 || done === jobs.length) console.error(`Completed ${done}/${jobs.length}`); });
  const summary = summarizeAll(rows);
  // 折算用游戏里的出现概率（vehicle.js · VEHICLES.fortress.appear，30%）
  const fortress = opt.groups.includes("fortress") ? fortressStats(rows, opt.sizes, vm.runInContext("VEHICLES.fortress.appear", H.load())) : null;
  const report = { schema: "backfire-enemy-balance-v1", generatedAt: new Date().toISOString(), config: CONFIG, options: { samples: opt.samples, groups: opt.groups, sizes: opt.sizes, act: opt.act }, provenance: meta,
    rows: rows.length, errors: rows.filter(r => r.outcome === "error").length, timeouts: rows.filter(r => r.outcome === "timeout").length, summary, fortress, flags: flags(summary, opt.sizes),
    errorSamples: rows.filter(r => r.outcome === "error").slice(0, 5).map(r => ({ seed: r.seed, group: r.group, cell: r.cell, variant: r.variant, error: r.error })) };
  fs.writeFileSync(file + ".json", JSON.stringify(report, null, 1) + "\n");
  const old = fs.existsSync(file + ".md") ? fs.readFileSync(file + ".md", "utf8") : "";
  const tail = old.includes(MARK) ? old.slice(old.indexOf(MARK)) : MARK + "\n";
  fs.writeFileSync(file + ".md", markdown(report) + "\n" + tail);
  console.log(`${report.errors ? "ERRORS" : "OK"}: ${file}.md（${rows.length} 场，异常 ${report.errors}）`);
  return report.errors ? 1 : 0;
}
if (isMainThread && require.main === module) main().then(code => { process.exitCode = code; }).catch(e => { console.error(e.stack || String(e)); process.exitCode = 1; });
module.exports = { CONFIG, GROUPS, PAIRS, FORTRESS, CAPTAINS, KING_RACES, plan, runJob, runJobs, summarize, summarizeAll, fortressStats, flags, markdown, parseArgs, main };
