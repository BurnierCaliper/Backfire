// 后期敌人实际威胁模拟（issue #401）：每种敌人单独凑满一场普通战的 4 枚代币，在 10 / 15 / 20 级对同级的队伍打，
// 统计它们实际打在我方身上的伤害、击破和控场（失衡、失去行动、不稳、倒地、挂上的状态）。
// 纸面 ATK 看不出机制的差别（持续伤害、范围、蓄力、协助、站位……），这里一律按实际打出来的算。
// 只测量、不改任何敌人 / 角色的数值；固定种子，同一份代码重跑结果相同。
//
//   node tools/enemy-threat.js                         全部敌人 × 5（前期参照）/ 10 / 15 / 20 级 × 2–4 人，每格 40 场 → docs/balance/enemy-threat-1026.{md,json}
//   node tools/enemy-threat.js --kits thug_knife,giant --levels 20 --samples 5 --out docs/balance/try
//   node tools/enemy-threat.js --groups boss           只跑首领
//   node tools/enemy-threat.js --groups unit --levels 20 --atk 1.5 --out docs/balance/enemy-threat-1026-l20-atk150
//                                                      假设性对照：敌人 atk ×1.5（只在模拟里乘，游戏数值不动）
//   node tools/enemy-threat.js --groups unit --levels 20 --tokens 6 --out docs/balance/enemy-threat-1026-l20-tok6
//                                                      假设性对照：每场凑满 6 枚代币
//   node tools/enemy-threat.js --rebuild docs/balance/enemy-threat-1026
//                                                      不重跑，用已有的 json 重新生成报告（改了报告格式时用）
//
// 每场的布置照 R1 单场矩阵（tools/score-by-act.js · one）：R1 的 10 名角色里按种子随机 2–4 人，我方等级 = 敌人等级，
// 升级选主属性 / 第一个合法选项，武器等级 = 等级 × 0.6（最高 10），满状态、不用道具、BASIC 打法，敌人用游戏里的 AI，30 回合上限。
// 敌人：只放要测的那一种，凑满普通战的 4 枚代币（杂兵 4 只、精英 2 只、成组的照组数：空投蜂群 3 组 × 3 只……），
// 全部用同一个等级（精英战不 +1，方便横向比），个体值、随机种族照游戏里抽（单局的 battleSpec 打开个体值）。
// 战场是中性的：没有天气、配置物、场地、载具；区制 / 站位按序号轮流（两区一半，三区的三种站位各六分之一，和抽遭遇的比例一样）。
// 同一个序号的队伍、区制、站位、种子对每种敌人、每个等级都一样，所以敌人之间、等级之间可以直接比。
// 首领另测：亡命之王 / 沙灵聚合体 / 飞碟触灵照单局首领战的随从（rollBossEncounter），赤牙单独上场、带它的部队天气「酷暑」。
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const cp = require("node:child_process");
const { Worker, isMainThread, parentPort } = require("node:worker_threads");
const H = require("../tests/headless");
const B = require("./balance-common");

const CONFIG = {
  version: "enemy-threat-v1",
  seedPrefix: "ET1026",
  samples: 40,             // 每格（一种敌人 × 一个等级 × 一种人数）场数
  levels: [5, 10, 15, 20], // 10 / 15 / 20 是 issue 要的后期；5 级当前期参照，看「后期掉了多少」
  sizes: [2, 3, 4],
  tokens: 4,               // 普通战的代币（run.js · ENCOUNTER_TOKENS）；--tokens 改（假设性对照）
  atk: 1,                  // 敌人攻击力倍率；1 = 游戏里的数值，--atk 改（假设性对照，只在模拟里乘）
  maxRounds: 30,           // 同 R1 单场
  workers: 4,
  out: "docs/balance/enemy-threat-1026",
  // 自动标记：整场伤害占我方血量低于同等级中位数的这么多倍，列进「后期偏弱」
  lowVsMedian: 0.5,
  // 自动标记：最低 → 最高等级「每代币·回合伤害占角色血量」只剩这么多，列进「后期掉得多」
  dropRatio: 0.6,
  // 单局各幕表：测过的等级离这一幕普通战的等级范围超过这么多级就不列（只测 20 级的对照不列前几幕）
  actNear: 4
};
const GROUPS = ["unit", "boss"];
// 区制 / 站位按序号轮流：0–2 两区，3 全员 3 区，4 2 / 3 区对半，5 夹击（run.js · applyEncounterLayout）
const LAYOUTS = [[2, "front2"], [2, "front2"], [2, "front2"], [3, "all3"], [3, "split23"], [3, "pincer"]];
// 首领：单局的三个首领照首领战抽随从；赤牙不在单局里，单独上场，带它的部队天气（bestiary.js：酷暑 + 灼烧层数加倍）
const BOSSES = [
  { kit: "outlaw_king", region: "外城区" },
  { kit: "sand_aggregate", region: "沙漠" },
  { kit: "ufo_boss", region: "天网设施" },
  { kit: "chixia", region: "外城区", alone: true, weather: "heat" }
];
// 首领自己（含身上的部件）：其余的算随从 / 援军 / 召唤物
const BOSS_FAMILY = { outlaw_king: ["outlaw_king"], sand_aggregate: ["sand_aggregate"], ufo_boss: ["ufo_body", "ufo_leg"], chixia: ["chixia"] };
const RANK_NAME = { minion: "杂兵", elite: "精英", boss: "首领" };
// 假设性对照乘攻击力时乘哪几项：敌人出手用 personalAtk（+ weaponAtk），面板显示 atk（同 run.js · makeBountyTarget）
const ATK_FIELDS = ["atk", "personalAtk", "weaponAtk", "baseAtk"];
// 统计的状态（每个敌人回合结束时我方在场角色身上挂着的）：持续伤害、减益、控制
const STATUS_NAME = { burn: "灼烧", corr: "腐蚀", frostbite: "冻伤", shock: "感电", shockwave: "震荡", reso: "共振", unstable: "不稳", weak: "虚弱", chase: "紧追", high: "高能" };

/* ---------- 敌人名单与纸面数值 ---------- */
let KITS_CACHE = null;
/** 要测的敌人：单局随机遭遇抽得到的全部（run.js · ENEMY_INFO 里不是首领、不是中立生物的） */
function unitKits() {
  if (KITS_CACHE) return KITS_CACHE;
  const c = H.load(), info = vm.runInContext("ENEMY_INFO", c);
  KITS_CACHE = Object.keys(info).filter(k => !info[k].boss && !info[k].neutral);
  return KITS_CACHE;
}
/** 纸面：预设在这个等级、2 人队的数值（不含个体值、种族六维；3 / 4 人队的血量 ×1.5 / ×2.5） */
function paperStats(c, kit, level) {
  const p = c.enemyPresets().find(x => x.id === kit);
  if (!p) return null;
  let u;
  try { u = p.build(level, 2); } catch (e) { return null; }
  const s = u.suggest || {}, dice = s.dice || [0, 0];
  const diceAvg = (Number(dice[0]) || 0) * ((Number(dice[1]) || 0) + 1) / 2;
  return { atk: Number(u.atk) || 0, dice, diceAvg, flat: Number(s.flat) || 0, hit: (Number(u.atk) || 0) + diceAvg + (Number(s.flat) || 0),
    baseBreak: Number(s.baseBreak) || 0, element: s.element || "physical", range: u.range, hp: c.totalHp(u), def: Number(u.defMax) || 0 };
}
/** 单局里哪几幕会碰到它（rogue-data.js · ROGUE_CONFIG：各幕区域、幕间可选的采矿场、带地图可以去的下水道；额外幕照表轮回），
 *  返回 [{ act, region, levels: [起, 止] }]。精英战另外 +1 级、首领战是本幕的「止」，这里只写普通战的范围 */
function appearance(c, kit) {
  const C = c.Rogue.CONFIG, info = c.enemyInfo(kit) || {}, regions = info.regions || [], out = [];
  const total = C.acts + (C.extraActs || 0);
  const levelsOf = act => act <= C.acts ? C.actLevels[act - 1] : (C.extraActLevels || [])[act - C.acts - 1];
  for (let act = 1; act <= total; act++) {
    // kind：main 本幕区域 / alt 幕间可选的采矿场 / sewer 带地图去的下水道
    const places = [[C.regions[(act - 1) % C.regions.length], "main"]];
    if (act <= C.acts && C.altRegions && C.altRegions[act]) places.push([C.altRegions[act], "alt"]);
    if (act >= 2 && C.sewer) places.push([C.sewer.region, "sewer"]);
    places.filter(([r]) => regions.includes(r)).forEach(([region, kind]) => out.push({ act, region, kind, levels: levelsOf(act) ? [...levelsOf(act)] : null }));
  }
  return out;
}
function appearText(list) {
  if (!list || !list.length) return "不在单局";
  const acts = [...new Set(list.map(x => x.act))].sort((a, b) => a - b);
  const lv = acts.map(a => list.find(x => x.act === a).levels).filter(Boolean).map(x => `${x[0]}–${x[1]}`);
  return `${acts.join("、")} 幕（${[...new Set(lv)].join(" / ")} 级）`;
}
function enemyMeta(c, kit) {
  const info = c.enemyInfo(kit) || {};
  return { name: (c.enemyPresets().find(x => x.id === kit) || {}).name || kit, faction: info.faction || "—", rank: kit in BOSS_FAMILY ? "boss" : c.enemyRankOf({ kit }) || "minion",
    tokens: kit in BOSS_FAMILY ? null : c.enemyTokens(kit), group: info.group || 1, regions: info.regions || [], appear: appearance(c, kit) };
}

/* ---------- 一场 ---------- */
const isHero = (c, u) => !!u && u.isPlayer && !u.escort && !c.isWeaponUnit(u);
/** 规则环境里装上计数（只读：不改任何结算，只在原函数前后记数） */
function instrument(c, job) {
  const S = c.S;
  const m = { dmg: 0, direct: 0, dot: 0, friendly: 0, brk: 0, hits: 0, hitDmg: 0, staggers: 0, downs: 0,
    heroTurns: 0, stunTurns: 0, loseApTurns: 0, unstableTurns: 0, downTurns: 0, status: {}, statusSeen: 0,
    enemyPhases: 0, unitRounds: 0, tokenRounds: 0, phaseDmg: [], kits: {} };
  const now = { key: null, phase: 0, weight: 0, inCombat: 0 };
  const wrap = (name, fn) => { const orig = c[name]; if (typeof orig !== "function") throw new Error("missing rule function " + name); c[name] = (...args) => fn(orig, args); };
  const kitOf = u => (u && (u.kit || u.name)) || "?";
  const bucket = key => m.kits[key] || (m.kits[key] = { dmg: 0, dot: 0, brk: 0, downs: 0, staggers: 0 });
  const heroes = () => S.state.units.filter(u => isHero(c, u));
  // 落在我方身上的每一下（含坚毅生命、持续伤害、场地）：有出手的敌人记在它的兵种名下，没有出手方的（灼烧、腐蚀、敌人留下的场地……）记成 dot。
  // 一场只有一种敌人、战场是中性的，所以没有出手方的伤害也都是这种敌人造成的。我方误伤另记、不算进敌人
  wrap("applyCombat", (orig, args) => {
    const [t, res, a] = args;
    const mine = t && t.isPlayer && !t.escort && res && res.ok && !res.pending && !(typeof c.isDownProtected === "function" && c.isDownProtected(t));
    if (!mine) return orig(...args);
    const friendly = !!(a && a.isPlayer);
    const key = friendly ? null : a ? kitOf(a) : "dot";
    const before = heroes().map(u => [u, Number(u.def) || 0, !!u.stunned]);
    const prev = now.key; now.key = key || now.key; now.inCombat++;
    let out;
    try { out = orig(...args); } finally { now.key = prev; now.inCombat--; }
    const dmg = Math.floor(Number(res.total) || 0) + Math.floor(Number(res.shpDealt) || 0);
    // 击破按我方实际掉的架势算（已经失衡再打不算；牵挂代扛的算在结人身上）
    const brk = before.reduce((s, [u, d]) => s + Math.max(0, d - (Number(u.def) || 0)), 0);
    const stg = before.filter(([u, , st]) => !st && u.stunned).length;
    if (friendly) { m.friendly += dmg; return out; }
    const k = bucket(key);
    if (a) { k.dmg += dmg; m.direct += dmg; if (dmg > 0) { m.hits++; m.hitDmg += dmg; } } else { k.dot += dmg; m.dot += dmg; }
    k.brk += brk; k.staggers += stg;
    m.dmg += dmg; m.brk += brk; m.staggers += stg;
    if (now.phase) m.phaseDmg[now.phase - 1] = (m.phaseDmg[now.phase - 1] || 0) + dmg;
    return out;
  });
  // 只扣架势、不经过 applyCombat 的击破（易怒蛮牛冲撞……）：出手方是敌人的才算（applyCombat 里面调的已经按架势差算过了）
  wrap("dealBreak", (orig, args) => {
    const [u, , , , , opt] = args, by = opt && opt.by;
    if (!isHero(c, u) || !by || by.isPlayer || now.inCombat) return orig(...args);
    const d0 = Number(u.def) || 0, st0 = !!u.stunned;
    const out = orig(...args);
    const brk = Math.max(0, d0 - (Number(u.def) || 0)), stg = !st0 && u.stunned ? 1 : 0;
    const k = bucket(kitOf(by));
    k.brk += brk; k.staggers += stg; m.brk += brk; m.staggers += stg;
    return out;
  });
  wrap("applyKnockdown", (orig, args) => {
    const u = args[0], hero = isHero(c, u), down0 = hero && !!u.dying;
    const out = orig(...args);
    if (hero && !down0 && u.dying) { m.downs++; if (now.key) bucket(now.key).downs++; }
    return out;
  });
  // 我方回合开始（补行动点之前）：数这一回合谁失衡（没有行动点和附赠）、谁失去行动点、谁不稳（附赠 −1）、谁倒地
  wrap("startPlayerPhase", (orig, args) => {
    heroes().filter(u => !u.dead && !u.hidden).forEach(u => {
      m.heroTurns++;
      if (u.dying && !u.upOnShp) { m.downTurns++; return; }
      if (u.stunned) m.stunTurns++;
      else {
        if (u.loseApNext) m.loseApTurns++;
        if (u.statuses && u.statuses.unstable) m.unstableTurns++;
      }
    });
    now.phase = 0;
    return orig(...args);
  });
  // 敌人回合开始：这一种敌人还活着几只（按代币折算），以后的伤害记进第几个敌人回合
  wrap("startEnemyPhase", (orig, args) => {
    boostAtk(c, job);
    m.enemyPhases++;
    now.phase = m.enemyPhases;
    const live = c.EnemyAI.foes().filter(u => job.group === "unit" ? u.kit === job.kit : (BOSS_FAMILY[job.kit] || []).includes(u.kit));
    m.unitRounds += live.length;
    m.tokenRounds += live.length * now.weight;
    return orig(...args);
  });
  // 敌人回合行动完：我方在场角色身上挂着哪些状态
  wrap("endEnemyTurn", (orig, args) => {
    heroes().filter(u => !u.dead && !u.hidden).forEach(u => {
      m.statusSeen++;
      Object.keys(STATUS_NAME).forEach(k => { const v = u.statuses && u.statuses[k]; if (v) m.status[k] = (m.status[k] || 0) + 1; });
    });
    return orig(...args);
  });
  return { m, now };
}
/** 假设性对照（--atk）：敌人（不含中立生物）的攻击力乘倍率。开战时和每个敌人回合开始时各补一次，
 *  中途上场的援军、召唤物也乘到；每个单位只乘一次。倍率 1 什么都不做（默认，和游戏一样） */
function boostAtk(c, job) {
  const mul = Number(job.atk) || 1;
  if (mul === 1) return;
  c.S.state.units.forEach(u => {
    if (u.isPlayer || u.etAtkBoosted || (c.enemyInfo(u.kit) || {}).neutral) return;
    ATK_FIELDS.forEach(k => { if (u[k] != null) u[k] = Math.round((Number(u[k]) || 0) * mul); });
    u.etAtkBoosted = true;
  });
}

/** 照 R1 单场矩阵布置队伍：等级 = 要测的等级，选好升级、满状态 */
function prepare(c, job) {
  const R = c.Rogue, partySeed = `${CONFIG.seedPrefix}:party:${job.size}:${job.index}`;
  c.S.RNG.install(partySeed + ":setup");
  const run = R.newRun({ party: B.partyFor(partySeed, job.size), seed: partySeed });
  run.act = 3; run.actDay = 0; R.makeBoard(run); R.acceptTask(run, "main");
  run.task.nodes[run.task.index] = { type: "battle", done: false };
  const spec = R.battleSpec(run);
  if (!spec) throw new Error("Missing battle specification");
  const level = job.level;
  run.party.forEach(h => { const from = h.level || 1; h.level = level; h.xp = 0; h.hp = null; h.shp = null; R.queueLevelRewards(h, from, level, [], run); Object.keys(h.weaponLevels || {}).forEach(k => { h.weaponLevels[k] = Math.max(1, Math.min(10, Math.round(level * .6))); }); });
  B.chooseLevels(R, run, []);
  run.party.forEach(h => { h.hp = null; h.shp = null; h.weaponState = {}; });
  c.S.LEDGER.dur = {}; c.S.LEDGER.weapons = {}; c.S.LEDGER.heroes = {}; c.S.LEDGER.hours = 0;
  return { run, spec };
}
const tokensOf = job => Number(job.tokens) || CONFIG.tokens;
/** 这一场的遭遇：要测的敌人凑满 4 枚代币（--tokens 改）/ 首领战。中性战场：没有天气、配置物、场地、载具 */
function encounter(c, job) {
  const [zoneMode, layout] = LAYOUTS[job.index % LAYOUTS.length];
  c.S.RNG.install(`${CONFIG.seedPrefix}:enc:${job.kit}:${job.level}:${job.size}:${job.index}`);
  let enc;
  if (job.group === "boss") {
    const b = BOSSES.find(x => x.kit === job.kit);
    if (b.alone) enc = c.finishEncounter({ name: "首领 · " + job.kit, region: b.region, faction: null, tier: "boss", tokens: 0, mixed: false, enemies: [{ preset: job.kit, zone: 2 }], layout, vehicles: [] }, { zoneMode, weather: b.weather || "none" });
    else enc = c.rollBossEncounter(job.kit, { region: b.region, tokens: c.Rogue.CONFIG.bossEscortTokens, zoneMode, weather: b.weather || "none" });
  } else {
    const tokens = tokensOf(job), info = c.enemyInfo(job.kit) || {}, picks = Math.max(1, Math.floor(tokens / c.enemyTokens(job.kit)));
    const rows = Array.from({ length: picks }, () => ({ preset: job.kit, count: c.groupCount(info) }));
    enc = c.finishEncounter({ name: "单一兵种 · " + job.kit, region: (info.regions || [])[0] || "外城区", faction: info.faction || null, tier: "normal", tokens, mixed: false,
      enemies: rows, layout, vehicles: [] }, { zoneMode, weather: "none" });
  }
  enc.features = [];
  enc.vehicles = [];
  return enc;
}

function runJob(job) {
  const row = { group: job.group, kit: job.kit, level: job.level, size: job.size, index: job.index, outcome: "error" };
  try {
    const c = H.load();
    const { m, now } = instrument(c, job);
    const { spec } = prepare(c, job);
    spec.level = job.level;
    spec.encounter = encounter(c, job);
    spec.seed = `${CONFIG.seedPrefix}:battle:${job.level}:${job.size}:${job.index}`;
    c.BattleSim.setup(spec);
    boostAtk(c, job);
    const S = c.S.state, heroes = S.units.filter(u => isHero(c, u));
    const mine = u => job.group === "unit" ? u.kit === job.kit : (BOSS_FAMILY[job.kit] || []).includes(u.kit);
    const foes = S.units.filter(u => !u.isPlayer && !u.hidden && !u.dead && mine(u));
    if (!foes.length) throw new Error("No tested enemy on field");
    now.weight = job.group === "unit" ? tokensOf(job) / foes.length : 1;
    const maxHp = u => (u.layers || []).reduce((s, l) => s + Math.max(0, Number(l.max) || 0), 0);
    Object.assign(row, { party: heroes.map(u => u.kit), heroLevels: heroes.map(u => u.level), foeLevels: [...new Set(foes.map(u => u.level))], zoneMode: S.zoneMode, weather: S.weather, units: foes.length,
      enemies: S.units.filter(u => !u.isPlayer && !u.hidden && !u.dead).map(u => u.kit),
      heroHp: heroes.reduce((s, u) => s + maxHp(u), 0), heroDef: heroes.reduce((s, u) => s + (Number(u.defMax) || 0), 0),
      foeAtk: foes.reduce((s, u) => s + (Number(u.atk) || 0), 0) / foes.length, foeHp: foes.reduce((s, u) => s + maxHp(u), 0), foeDef: foes.reduce((s, u) => s + (Number(u.defMax) || 0), 0) / foes.length });
    const res = c.BattleSim.run({ maxRounds: CONFIG.maxRounds });
    row.outcome = res.winner === "player" ? "win" : res.winner === "enemy" ? "lose" : res.winner === "timeout" ? "timeout" : "error";
    const taken = heroes.reduce((s, u) => s + ((S.battleStats || {})[u.id] || {}).taken || 0, 0);
    Object.assign(row, { rounds: res.rounds, deaths: heroes.filter(u => u.dead).length, takenGame: taken }, B.clone(m));
    if (c.__errors.length) throw new Error(`Rule console.error: ${c.__errors.join(" | ")}`);
  } catch (e) { row.outcome = "error"; row.error = e.stack || String(e); }
  return B.clone(row);
}

/* ---------- 抽样计划 ---------- */
function plan(opt = {}) {
  const n = opt.samples || CONFIG.samples, levels = opt.levels || CONFIG.levels, sizes = opt.sizes || CONFIG.sizes, groups = opt.groups || GROUPS, jobs = [];
  const kits = opt.kits || null;
  const want = (group, kit) => groups.includes(group) && (!kits || kits.includes(kit));
  const list = unitKits().filter(k => want("unit", k)).map(kit => ({ group: "unit", kit })).concat(BOSSES.filter(b => want("boss", b.kit)).map(b => ({ group: "boss", kit: b.kit })));
  // 假设性对照的代币 / 攻击力倍率跟着每场走（工作线程只看得到 job）；默认值不写进去，和以前的抽样计划一样
  const hypo = Object.assign({}, opt.tokens && opt.tokens !== CONFIG.tokens ? { tokens: opt.tokens } : {}, opt.atk && opt.atk !== CONFIG.atk ? { atk: opt.atk } : {});
  for (const { group, kit } of list) for (const level of levels) for (const size of sizes) for (let i = 0; i < n; i++) jobs.push(Object.assign({ group, kit, level, size, index: i }, hypo));
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
  const sum = f => ok.reduce((a, r) => a + (Number(f(r)) || 0), 0);
  const avg = f => n ? sum(f) / n : null;
  const ratio = (f, g) => sum(g) ? sum(f) / sum(g) : null;
  const status = {};
  ok.forEach(r => Object.keys(r.status || {}).forEach(k => { status[k] = (status[k] || 0) + r.status[k]; }));
  const seen = sum(r => r.statusSeen);
  Object.keys(status).forEach(k => { status[k] = seen ? status[k] / seen : 0; });
  const kits = {};
  ok.forEach(r => Object.keys(r.kits || {}).forEach(k => { const x = kits[k] || (kits[k] = { dmg: 0, dot: 0, brk: 0, downs: 0, staggers: 0 }); Object.keys(x).forEach(f => { x[f] += Number(r.kits[k][f]) || 0; }); }));
  Object.keys(kits).forEach(k => Object.keys(kits[k]).forEach(f => { kits[k][f] = n ? kits[k][f] / n : 0; }));
  const phase = i => n ? ok.reduce((a, r) => a + (Number((r.phaseDmg || [])[i]) || 0), 0) / n : null;
  return {
    n: rows.length, outcomes: s.outcomes, winRate: s.winRate, ci: s.winRate95,
    rounds: avg(r => r.rounds), units: avg(r => r.units), foeAtk: avg(r => r.foeAtk), foeHp: avg(r => r.foeHp), foeDef: avg(r => r.foeDef),
    heroHp: avg(r => r.heroHp), heroHpEach: ratio(r => r.heroHp, r => (r.party || []).length),
    dmg: avg(r => r.dmg), direct: avg(r => r.direct), dot: avg(r => r.dot), friendly: avg(r => r.friendly), takenGame: avg(r => r.takenGame),
    // 整场伤害占我方血量上限：每场单独算再平均（人数不同的场一样重）
    share: avg(r => r.heroHp ? r.dmg / r.heroHp : 0),
    brk: avg(r => r.brk), staggers: avg(r => r.staggers), downs: avg(r => r.downs), deaths: avg(r => r.deaths),
    hitAvg: ratio(r => r.hitDmg, r => r.hits), hits: avg(r => r.hits),
    enemyPhases: avg(r => r.enemyPhases), unitRounds: avg(r => r.unitRounds), tokenRounds: avg(r => r.tokenRounds),
    // 每代币·回合：活着的这种敌人每占 1 枚代币、每个敌人回合打出多少；再除以平均每名角色的血量上限，跨等级可比
    perTokenRound: ratio(r => r.dmg, r => r.tokenRounds),
    perTokenRoundShare: ratio(r => r.heroHp ? r.dmg / (r.heroHp / Math.max(1, (r.party || []).length)) : 0, r => r.tokenRounds),
    brkPerTokenRound: ratio(r => r.brk, r => r.tokenRounds),
    heroTurns: avg(r => r.heroTurns),
    stunShare: ratio(r => r.stunTurns, r => r.heroTurns), downShare: ratio(r => r.downTurns, r => r.heroTurns),
    // 失去的行动：失衡 = 行动点 + 附赠都没了（2 个），失去行动点 1 个，不稳 1 个附赠；除以我方每回合本来有的 2 个
    lostShare: ratio(r => 2 * r.stunTurns + r.loseApTurns + r.unstableTurns, r => 2 * r.heroTurns),
    status, kits, phase1: phase(0), phase2: phase(1), phase3: phase(2)
  };
}
/** rows → { "kit|level|size": 汇总 }，size 写 all 是三种人数合在一起 */
function summarizeAll(rows) {
  const by = new Map();
  const add = (k, r) => { if (!by.has(k)) by.set(k, []); by.get(k).push(r); };
  rows.forEach(r => { add([r.kit, r.level, r.size].join("|"), r); add([r.kit, r.level, "all"].join("|"), r); });
  const out = {};
  by.forEach((list, k) => { out[k] = summarize(list); });
  return out;
}
const median = xs => { const a = xs.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return null; const i = (a.length - 1) / 2; return (a[Math.floor(i)] + a[Math.ceil(i)]) / 2; };
/** 自动标记：同一等级里整场伤害占比低于中位数 × lowVsMedian 的；10 → 最高等级每代币·回合伤害占比掉到 dropRatio 以下的 */
function flags(S, kits, levels) {
  const low = [], drop = [];
  levels.forEach(level => {
    const xs = kits.map(k => S[`${k}|${level}|all`]).filter(Boolean);
    const med = median(xs.map(x => x.share));
    kits.forEach(k => { const x = S[`${k}|${level}|all`]; if (x && med != null && x.share < med * CONFIG.lowVsMedian) low.push({ kit: k, level, share: x.share, median: med }); });
  });
  const lo = Math.min(...levels), hi = Math.max(...levels);
  if (lo !== hi) kits.forEach(k => {
    const a = S[`${k}|${lo}|all`], b = S[`${k}|${hi}|all`];
    if (a && b && a.perTokenRoundShare > 0 && b.perTokenRoundShare != null && b.perTokenRoundShare / a.perTokenRoundShare < CONFIG.dropRatio) drop.push({ kit: k, from: lo, to: hi, a: a.perTokenRoundShare, b: b.perTokenRoundShare, ratio: b.perTokenRoundShare / a.perTokenRoundShare });
  });
  return { low, drop };
}

/* ---------- 报告 ---------- */
const pct = x => x == null ? "—" : (x * 100).toFixed(1) + "%";
const pct0 = x => x == null ? "—" : (x * 100).toFixed(0) + "%";
const f1 = x => x == null ? "—" : Number(x).toFixed(1);
const f2 = x => x == null ? "—" : Number(x).toFixed(2);
const ci = s => s && s.ci ? `${(s.ci[0] * 100).toFixed(0)}–${(s.ci[1] * 100).toFixed(0)}%` : "—";
const wlt = s => `${s.outcomes.win}/${s.outcomes.lose}/${s.outcomes.timeout}${s.outcomes.error ? `（异常 ${s.outcomes.error}）` : ""}`;
const statusText = s => Object.keys(s.status || {}).filter(k => s.status[k] >= 0.005).sort((a, b) => s.status[b] - s.status[a]).map(k => `${STATUS_NAME[k] || k} ${pct0(s.status[k])}`).join("、") || "—";
const diceText = d => d && Number(d[0]) > 0 && Number(d[1]) > 0 ? `${d[0]}d${d[1]}` : "—";

const kitCell = (M, k) => `${M[k].name}（\`${k}\`）`;
const byShare = (report, level) => report.kits.filter(k => report.summary[`${k}|${level}|all`]).sort((a, b) => report.summary[`${b}|${level}|all`].share - report.summary[`${a}|${level}|all`].share);
/** 每个等级一行：全体敌人的中位数，看整体是不是后期偏低 */
function overviewTable(l, report) {
  const S = report.summary, levels = report.options.levels, kits = report.kits;
  const col = (L, f, only) => median(kits.filter(k => !only || report.meta[k].rank === only).map(k => S[`${k}|${L}|all`]).filter(Boolean).map(f));
  const heroHp = L => { const xs = kits.map(k => S[`${k}|${L}|all`]).filter(Boolean); return xs.length ? xs.reduce((a, s) => a + s.heroHpEach, 0) / xs.length : null; };
  l.push("|等级|角色平均血量上限|整场伤害占比 中位数（全部 / 只有杂兵 / 只有精英）|每代币·回合伤害占角色血量 中位数|存活代币·回合 / 场 中位数|击破 / 场 中位数|失衡回合 中位数|倒地 / 场 中位数|我方胜率 中位数|平均回合 中位数|");
  l.push("|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|");
  levels.forEach(L => l.push(`|${L}|${f1(heroHp(L))}|**${pct(col(L, s => s.share))}** / ${pct(col(L, s => s.share, "minion"))} / ${pct(col(L, s => s.share, "elite"))}|${pct(col(L, s => s.perTokenRoundShare))}|${f1(col(L, s => s.tokenRounds))}|${f1(col(L, s => s.brk))}|${pct(col(L, s => s.stunShare))}|${f2(col(L, s => s.downs))}|${pct(col(L, s => s.winRate))}|${f1(col(L, s => s.rounds))}|`));
}
const PLACE_NAME = { main: "", alt: "（幕间可选）", sewer: "（带地图）" };
function actTable(l, report) {
  const S = report.summary, M = report.meta, levels = report.options.levels;
  const near = L => levels.reduce((a, b) => Math.abs(b - L) < Math.abs(a - L) ? b : a);
  const places = new Map();
  report.kits.forEach(k => (M[k].appear || []).forEach(x => {
    const key = `${x.act}|${x.region}`;
    if (!places.has(key)) places.set(key, { act: x.act, region: x.region, kind: x.kind || "main", range: x.levels, kits: [] });
    places.get(key).kits.push(k);
  }));
  const order = { main: 0, alt: 1, sewer: 2 };
  l.push("|幕|区域|普通战等级|抽得到几种|测的等级|整场伤害占比 中位数|最低的三种|最高的一种|");
  l.push("|---:|---|---|---:|---:|---:|---|---|");
  [...places.values()].sort((a, b) => a.act - b.act || order[a.kind] - order[b.kind]).forEach(p => {
    const tested = p.range ? [...new Set([near(p.range[0]), near(p.range[1])])].filter(L => L >= p.range[0] - CONFIG.actNear && L <= p.range[1] + CONFIG.actNear) : [];
    tested.forEach(L => {
      const xs = p.kits.filter(k => S[`${k}|${L}|all`]).sort((a, b) => S[`${a}|${L}|all`].share - S[`${b}|${L}|all`].share);
      if (!xs.length) return;
      const cell = k => `${M[k].name} ${pct0(S[`${k}|${L}|all`].share)}`;
      l.push(`|${p.act}|${p.region}${PLACE_NAME[p.kind] || ""}|${p.range ? p.range.join("–") : "—"}|${p.kits.length}|${L}|**${pct(median(xs.map(k => S[`${k}|${L}|all`].share)))}**|${xs.slice(0, 3).map(cell).join("、")}|${cell(xs[xs.length - 1])}|`);
    });
  });
}
function damageTable(l, report, level) {
  const S = report.summary, M = report.meta;
  l.push("|排名|敌人|档次|单局里出现|只数|纸面 ATK|纸面单击|实际每击|每代币·回合伤害（占角色血量）|存活代币·回合 / 场|**整场伤害占我方血量**|持续伤害占比|我方胜率（95%）|平均回合|");
  l.push("|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|");
  byShare(report, level).forEach((k, i) => {
    const s = S[`${k}|${level}|all`], m = M[k], p = (report.paper[k] || {})[level] || {};
    l.push(`|${i + 1}|${kitCell(M, k)}|${RANK_NAME[m.rank] || m.rank}|${appearText(m.appear)}|${f1(s.units)}|${f1(s.foeAtk)}（${f1(p.atk)}）|${f1(p.hit)}（${diceText(p.dice)}）|${f1(s.hitAvg)}|${f1(s.perTokenRound)}（${pct(s.perTokenRoundShare)}）|${f1(s.tokenRounds)}|**${pct(s.share)}**|${s.dmg ? pct0(s.dot / s.dmg) : "—"}|${pct(s.winRate)}（${ci(s)}）|${f1(s.rounds)}|`);
  });
}
function controlTable(l, report, level) {
  const S = report.summary, M = report.meta;
  l.push("|敌人|击破 / 场|每代币·回合击破|打进失衡 / 场|失衡回合|失去行动|倒地 / 场|死亡 / 场|主要状态（人·回合占比）|");
  l.push("|---|---:|---:|---:|---:|---:|---:|---:|---|");
  report.kits.filter(k => S[`${k}|${level}|all`]).sort((a, b) => S[`${b}|${level}|all`].lostShare - S[`${a}|${level}|all`].lostShare || S[`${b}|${level}|all`].brk - S[`${a}|${level}|all`].brk).forEach(k => {
    const s = S[`${k}|${level}|all`];
    l.push(`|${kitCell(M, k)}|${f1(s.brk)}|${f2(s.brkPerTokenRound)}|${f2(s.staggers)}|${pct(s.stunShare)}|${pct(s.lostShare)}|${f2(s.downs)}|${f2(s.deaths)}|${statusText(s)}|`);
  });
}
function trendTable(l, report) {
  const S = report.summary, M = report.meta, levels = report.options.levels, lo = Math.min(...levels), hi = Math.max(...levels);
  const mid = levels.includes(10) && lo < 10 && hi > 10 ? 10 : null;
  const kits = report.kits.filter(k => levels.every(L => S[`${k}|${L}|all`]));
  // 没进过敌人回合（开打就被清场）的那一级没有「每代币·回合」，比值写 —
  const r = (k, from) => { const a = S[`${k}|${from}|all`], b = S[`${k}|${hi}|all`]; return a && b && a.perTokenRoundShare && b.perTokenRoundShare != null ? b.perTokenRoundShare / a.perTokenRoundShare : null; };
  kits.sort((a, b) => (r(a, lo) == null ? 9 : r(a, lo)) - (r(b, lo) == null ? 9 : r(b, lo)));
  const ratios = [lo].concat(mid ? [mid] : []);
  l.push(`|敌人|档次|单局里出现|${levels.map(L => `${L} 级 整场伤害占比`).join("|")}|${levels.map(L => `${L} 级 每代币·回合（占角色血量）`).join("|")}|${ratios.map(L => `${hi} 级 ÷ ${L} 级`).join("|")}|${levels.map(L => `${L} 级 纸面 ATK`).join("|")}|`);
  l.push(`|---|---|---|${levels.map(() => "---:").join("|")}|${levels.map(() => "---:").join("|")}|${ratios.map(() => "---:").join("|")}|${levels.map(() => "---:").join("|")}|`);
  kits.forEach(k => {
    const m = M[k];
    l.push(`|${kitCell(M, k)}|${RANK_NAME[m.rank] || m.rank}|${appearText(m.appear)}|${levels.map(L => pct(S[`${k}|${L}|all`].share)).join("|")}|${levels.map(L => pct(S[`${k}|${L}|all`].perTokenRoundShare)).join("|")}|${ratios.map(L => r(k, L) == null ? "—" : f2(r(k, L))).join("|")}|${levels.map(L => f1(((report.paper[k] || {})[L] || {}).atk)).join("|")}|`);
  });
}
function sizeTable(l, report, level) {
  const S = report.summary, M = report.meta, sizes = report.options.sizes;
  l.push(`|敌人|${sizes.map(s => `${s} 人 整场伤害占比`).join("|")}|${sizes.map(s => `${s} 人 胜率`).join("|")}|${sizes.map(s => `${s} 人 平均回合`).join("|")}|`);
  l.push(`|---|${sizes.map(() => "---:").join("|")}|${sizes.map(() => "---:").join("|")}|${sizes.map(() => "---:").join("|")}|`);
  byShare(report, level).forEach(k => {
    const at = s => S[`${k}|${level}|${s}`] || {};
    l.push(`|${kitCell(M, k)}|${sizes.map(s => pct(at(s).share)).join("|")}|${sizes.map(s => pct(at(s).winRate)).join("|")}|${sizes.map(s => f1(at(s).rounds)).join("|")}|`);
  });
}
function bossTable(l, report) {
  const S = report.summary, levels = report.options.levels;
  const bosses = BOSSES.filter(b => levels.some(L => S[`${b.kit}|${L}|all`]));
  if (!bosses.length) return;
  l.push("|首领|等级|整场伤害占我方血量|首领本体伤害 / 场|随从等其他伤害 / 场|击破 / 场|失衡回合|失去行动|倒地 / 场|死亡 / 场|我方胜率（95%）|胜/败/超时|平均回合|本体存活敌人回合|主要状态|");
  l.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---:|---:|---|");
  bosses.forEach(b => levels.forEach(L => {
    const s = S[`${b.kit}|${L}|all`];
    if (!s) return;
    const fam = BOSS_FAMILY[b.kit] || [], own = Object.keys(s.kits).filter(k => fam.includes(k)).reduce((a, k) => a + s.kits[k].dmg + s.kits[k].dot, 0);
    l.push(`|${report.meta[b.kit].name}${b.weather ? `（${b.weather === "heat" ? "酷暑" : b.weather}）` : ""}|${L}|**${pct(s.share)}**|${f1(own)}|${f1(s.dmg - own)}|${f1(s.brk)}|${pct(s.stunShare)}|${pct(s.lostShare)}|${f2(s.downs)}|${f2(s.deaths)}|${pct(s.winRate)}（${ci(s)}）|${wlt(s)}|${f1(s.rounds)}|${f1(s.unitRounds)}|${statusText(s)}|`);
  }));
}

/** 假设性对照的说明（默认参数返回空串） */
function hypoText(o) {
  const xs = [];
  if ((o.atk || CONFIG.atk) !== CONFIG.atk) xs.push(`敌人攻击力 ×${o.atk}`);
  if ((o.tokens || CONFIG.tokens) !== CONFIG.tokens) xs.push(`每场 ${o.tokens} 枚代币`);
  return xs.join("、");
}
function markdown(report) {
  const P = report.provenance, o = report.options, l = [];
  const levels = o.levels, hi = Math.max(...levels), lo = Math.min(...levels);
  const tokens = o.tokens || CONFIG.tokens, hypo = hypoText(o);
  l.push(`# 后期敌人实际威胁模拟（issue #401）${hypo ? "· 假设性对照：" + hypo : ""}`, "",
    "只测量，不改任何数值。下面的表由 `tools/enemy-threat.js` 生成，重跑会覆盖到「手写分析」标记为止，标记之后的手写内容保留。", "");
  const how = [(o.atk || CONFIG.atk) !== CONFIG.atk ? `攻击力在开战后乘到敌人的 ${ATK_FIELDS.join(" / ")} 上，中途上场的援军、召唤物也乘；伤害骰、固定加值不乘` : "",
    tokens !== CONFIG.tokens ? "代币是这种敌人凑满的枚数" : ""].filter(Boolean).join("；");
  if (hypo) l.push(`> **假设性对照：${hypo}**——只在模拟里改（${how}），游戏里的数值没有动。种子、队伍、区制和站位和正式结果（\`${CONFIG.out}\`）的同一格一样，可以逐格对照。`, "");
  l.push(
    `- 版本：提交 \`${P.commit || "未知"}\`${P.dirty ? "（生成时工作区有未提交改动，见 json 的 sourceHash）" : ""}；规则源码 SHA256 \`${P.sourceHash.slice(0, 16)}…\`；Node ${P.node}；工具 ${CONFIG.version}`,
    `- 命令：\`${P.command}\``,
    `- 样本：每格（一种敌人 × 一个等级 × 一种人数）**${o.samples} 场**，等级 ${levels.join(" / ")}，人数 ${o.sizes.join(" / ")}；共 ${report.rows} 场，异常 ${report.errors} 场，超时 ${report.timeouts} 场（超时算进分母，不算胜）。`,
    `- 种子：队伍 \`${CONFIG.seedPrefix}:party:人数:序号\`、战斗 \`${CONFIG.seedPrefix}:battle:等级:人数:序号\`。同一个序号的队伍、区制、站位、战斗种子对每种敌人、每个等级都一样。`,
    "- 布置：照 R1 单场矩阵——R1 的 10 名角色里按种子随机 2–4 人，**我方等级 = 敌人等级**，升级选主属性 / 第一个合法选项，武器等级 = 等级 × 0.6（最高 10）；满状态、不用道具；我方 BASIC 打法（打得到就普攻血最少的，打不到就走一格，会协助格挡），敌人用游戏里的 AI；30 回合上限。",
    tokens === CONFIG.tokens
      ? "- 敌人：**只放要测的那一种，凑满普通战的 4 枚代币**（杂兵 4 只、精英 2 只、空投蜂群 / 下水道清扫机 4 组 × 3 只、陨体衍蛛 4 组 × 2 只、穴鸦一群 4–6 只），全部同一个等级（精英不 +1），个体值 ±10%、随机种族照游戏里抽。沙鱼照游戏里有概率带尘虫 / 管虫（中立生物，不算敌人）。"
      : `- 敌人：**只放要测的那一种，凑满 ${tokens} 枚代币**（普通战是 4 枚；杂兵 ${tokens} 只、精英 ${Math.floor(tokens / 2)} 只、一组记 1 枚的成组敌人 ${tokens} 组；穴鸦一群就占 4 枚，${tokens < 8 ? "还是一群" : "两群"}），全部同一个等级（精英不 +1），个体值 ±10%、随机种族照游戏里抽。沙鱼照游戏里有概率带尘虫 / 管虫（中立生物，不算敌人）。`,
    "- 战场：中性——没有天气、配置物、场地、载具（区域自带的天气、沙暴风向、高压场地……都不算）。区制 / 站位按序号轮流：两区一半，三区的「全员 3 区 / 2·3 区对半 / 夹击」各六分之一。",
    "- 首领（单独一节）：亡命之王 / 沙灵聚合体 / 飞碟触灵照单局的首领战（`rollBossEncounter`：亡命之王带固定随从和两波援军，另外两个按 1 枚代币抽随从），赤牙单独上场、天气写死成它的部队天气「酷暑」。", "",
    "列的意思：",
    "- **整场伤害占我方血量**：一场里这种敌人打在我方身上的伤害合计（含坚毅生命、灼烧等持续伤害、敌人留下的场地；不含我方误伤）÷ 我方角色开战时的血量上限合计，每场单独算再平均。看「一场下来它能把队伍打掉多少」，同时受打得多重、活得多久影响。和游戏自己记的承伤（`battleStats.taken`）逐场核对过。",
    "- **每代币·回合伤害**：伤害 ÷（每个敌人回合开始时还活着的这种敌人，按代币折算后加起来）。括号里再除以平均每名角色的血量上限——跨等级可比：数字掉了，说明它的输出没跟上角色血量的成长。",
    `- **存活代币·回合 / 场**：上面那个分母的每场平均（${tokens} 枚代币全活着撑过 1 个敌人回合 = ${tokens}）。看它活得多久、能出手几次。整场伤害 ≈ 每代币·回合伤害 × 存活代币·回合。`,
    "- **纸面 ATK**：上场时的平均 atk（个体值、种族六维都算进去），括号里是预设的数（2 人队、没有个体值）。**纸面单击** = 预设 atk + 伤害骰平均 + 固定加值（普通攻击 1 倍），括号里是伤害骰。**实际每击**：有敌人出手、真的打掉血的每一下的平均伤害（范围攻击每个目标各算一下，不含持续伤害）。**持续伤害占比**：没有出手方的伤害（灼烧、腐蚀、余波、敌人留下的场地……）占整场伤害的比例。",
    "- **击破 / 场**：我方实际掉的架势（已经失衡再打不算）。**打进失衡 / 场**：我方角色被打到架势 0 的次数。**失衡回合**：我方回合开始时处于失衡（这一回合没有行动点和附赠）的人·回合占比。**失去行动**：失衡算 2 个、失去行动点 1 个、不稳 1 个附赠，除以我方每人每回合本来有的 2 个。**倒地 / 场、死亡 / 场**：我方角色。",
    "- **我方胜率**是 BASIC 自动打法的胜率，**不是真人胜率**（真人会用技能，打得更快，敌人能出手的回合更少），只用来横向比较。区间是 Wilson 95%。**主要状态**：每个敌人回合结束时我方在场角色身上挂着的状态，人·回合占比。",
    "- **单局里出现**：单局随机遭遇哪几幕抽得到它（各幕区域、幕间可选的采矿场、带地图去的下水道；额外幕照表轮回），括号是那几幕普通战的等级范围。跑团模式主持人可以随便放，不受这个限制。", "");

  let n = 0;
  if (report.kits.length) {
    l.push(`## ${++n}. 总览：每个等级的中位数`, "", "每种敌人先按人数合在一起算，再取全部敌人的中位数。", "");
    overviewTable(l, report);
    l.push("");
    l.push(`## ${++n}. 单局各幕：抽得到的敌人在这一幕的等级附近打得多重`, "",
      `每一幕的每个区域（本幕区域、幕间可选的采矿场、带地图去的下水道）抽得到哪些敌人；「测的等级」取测过的等级里离这一幕普通战起、止最近的（离这一幕的等级范围超过 ${CONFIG.actNear} 级的不列）。只看单一兵种，真实遭遇是几种混着来的。`, "");
    actTable(l, report);
    l.push("");
    levels.slice().sort((a, b) => b - a).forEach(L => {
      const ref = L === lo && levels.length > 1;
      l.push(`## ${++n}. ${L} 级${ref ? "（前期参照）" : ""}：各敌人的实际伤害（按整场伤害占比从高到低）`, "");
      damageTable(l, report, L);
      l.push("");
      if (ref) return;
      l.push(`### ${L} 级：击破与控场（按失去行动从高到低）`, "");
      controlTable(l, report, L);
      l.push("");
    });
    if (levels.length > 1) {
      l.push(`## ${++n}. 等级变化（按「每代币·回合伤害占角色血量」的 ${hi} 级 ÷ ${lo} 级从低到高）`, "",
        "比值 < 1：这种敌人每回合打掉的血量占角色血量的比例在变小，输出没跟上角色的成长；比值越小，后期越显得弱。「整场伤害占比」还混着存活时间（敌人血量 vs 我方输出）。", "");
      trendTable(l, report);
      l.push("");
    }
    if (report.options.sizes.length > 1) {
      l.push(`## ${++n}. ${hi} 级：分人数`, "", "敌人血量随人数放大（2 / 3 / 4 人 ×1 / ×1.5 / ×2.5），伤害不放大；人多时分摊到每个人身上的更少。", "");
      sizeTable(l, report, hi);
      l.push("");
    }
  }
  if (report.bossKits.length) {
    l.push(`## ${++n}. 首领`, "", "首领本体（飞碟触灵含机械足）自己打出的伤害、随从 / 援军 / 召唤物打出的伤害分开写；其余列是整场合计。「本体存活敌人回合」= 首领本体活着进入的敌人回合数。", "");
    bossTable(l, report);
    l.push("");
  }
  if (report.kits.length) {
    const F = report.flags, M = report.meta;
    l.push(`## ${++n}. 自动标记`, "", `- **整场伤害占比低于同等级中位数的 ${CONFIG.lowVsMedian} 倍**：${F.low.length ? "" : "没有。"}`);
    levels.forEach(L => { const xs = F.low.filter(x => x.level === L); if (xs.length) l.push(`  - ${L} 级（中位数 ${pct(xs[0].median)}）：${xs.sort((a, b) => a.share - b.share).map(x => `${M[x.kit].name} ${pct(x.share)}`).join("、")}`); });
    l.push(`- **每代币·回合伤害占角色血量，${hi} 级只剩 ${lo} 级的 ${CONFIG.dropRatio} 倍以下**：${F.drop.length ? F.drop.sort((a, b) => a.ratio - b.ratio).map(x => `${M[x.kit].name} ${f2(x.ratio)}（${pct(x.a)} → ${pct(x.b)}）`).join("、") : "没有。"}`, "");
  }
  return l.join("\n");
}

/* ---------- 命令行 ---------- */
const MARK = "<!-- 手写分析：重跑工具时，这一行以下的内容保留 -->";
function provenance(argv) {
  const files = [...H.RULE_FILES, "tests/headless.js", "tools/balance-common.js", "tools/enemy-threat.js"];
  const sourceHashes = Object.fromEntries(files.map(f => [f, B.hash(B.normalizeSource(fs.readFileSync(path.join(H.ROOT, f), "utf8")))]));
  let commit = null, dirty = null;
  try { commit = cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: H.ROOT, encoding: "utf8" }).trim(); dirty = !!cp.execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: H.ROOT, encoding: "utf8" }).trim(); } catch (_) { /* 没有 git：看 sourceHash */ }
  return { commit, dirty, sourceHash: B.hash(sourceHashes), sourceHashes, node: process.version, command: ["node", "tools/enemy-threat.js", ...argv].join(" "), strategy: B.STRATEGIES.matrix.version };
}
function parseArgs(argv) {
  const out = {}, allowed = ["samples", "levels", "sizes", "kits", "groups", "out", "workers", "tokens", "atk"];
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--") || !allowed.includes(key.slice(2))) throw new Error("Unknown argument: " + key);
    const v = argv[++i];
    if (v == null || v.startsWith("--")) throw new Error("Missing value for " + key);
    out[key.slice(2)] = v;
  }
  const groups = out.groups ? out.groups.split(",") : GROUPS;
  if (groups.some(g => !GROUPS.includes(g))) throw new Error("Unknown group: " + out.groups);
  const levels = out.levels ? out.levels.split(",").map(x => B.positiveInt(x, "level")) : CONFIG.levels;
  if (levels.some(L => L > 25)) throw new Error("Levels must be 1–25");
  const sizes = out.sizes ? out.sizes.split(",").map(Number) : CONFIG.sizes;
  if (sizes.some(s => ![2, 3, 4].includes(s))) throw new Error("Sizes must be 2, 3, 4");
  const kits = out.kits ? out.kits.split(",") : null;
  if (kits) { const known = unitKits().concat(BOSSES.map(b => b.kit)); const bad = kits.filter(k => !known.includes(k)); if (bad.length) throw new Error("Unknown kit: " + bad.join(",")); }
  const tokens = out.tokens ? B.positiveInt(out.tokens, "tokens") : CONFIG.tokens;
  if (tokens > 8) throw new Error("Tokens must be 1–8");
  const atk = out.atk ? Number(out.atk) : CONFIG.atk;
  if (!(atk > 0 && atk <= 5)) throw new Error("Atk multiplier must be in (0, 5]");
  return { samples: out.samples ? B.positiveInt(out.samples, "samples") : CONFIG.samples, levels, sizes, kits, groups, tokens, atk,
    workers: out.workers ? B.positiveInt(out.workers, "workers") : CONFIG.workers, out: out.out || CONFIG.out };
}
function outPath(file) {
  const root = path.resolve(H.ROOT, "docs/balance"), resolved = path.resolve(H.ROOT, file);
  if (!resolved.startsWith(root + path.sep)) throw new Error("Reports must be inside docs/balance/");
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}
/** 报告用的数据：汇总 + 每种敌人的名字 / 阵营 / 档次 + 纸面数值 */
function buildReport(rows, opt, meta) {
  const c = H.load(), all = [...new Set(rows.map(r => r.kit))];
  const kits = all.filter(k => rows.some(r => r.kit === k && r.group === "unit")), bossKits = all.filter(k => rows.some(r => r.kit === k && r.group === "boss"));
  const metaOf = Object.fromEntries(all.map(k => [k, enemyMeta(c, k)]));
  const paper = Object.fromEntries(all.map(k => [k, Object.fromEntries(opt.levels.map(L => [L, paperStats(c, k, L)]))]));
  const summary = summarizeAll(rows);
  return { schema: "backfire-enemy-threat-v1", generatedAt: new Date().toISOString(), config: CONFIG,
    options: { samples: opt.samples, levels: opt.levels, sizes: opt.sizes, groups: opt.groups, kits: opt.kits, tokens: opt.tokens || CONFIG.tokens, atk: opt.atk || CONFIG.atk },
    provenance: meta, rows: rows.length, errors: rows.filter(r => r.outcome === "error").length, timeouts: rows.filter(r => r.outcome === "timeout").length,
    kits, bossKits, meta: metaOf, paper, summary, flags: flags(summary, kits, opt.levels),
    errorSamples: rows.filter(r => r.outcome === "error").slice(0, 5).map(r => ({ kit: r.kit, level: r.level, size: r.size, index: r.index, error: r.error })) };
}
// json 里分人数的汇总只留这些（报告的分人数表用得到的 + 几个常看的）；三种人数合在一起的（size = all）全留
const SIZE_FIELDS = ["n", "outcomes", "winRate", "ci", "rounds", "share", "dmg", "heroHp", "perTokenRoundShare", "tokenRounds", "brk", "stunShare", "lostShare", "downs", "deaths"];
function writeReport(file, report) {
  const summary = Object.fromEntries(Object.entries(report.summary).map(([k, s]) => [k, k.endsWith("|all") ? s : Object.fromEntries(SIZE_FIELDS.filter(f => f in s).map(f => [f, s[f]]))]));
  // 小数留 4 位就够看了；不缩进（文件小三分之一）
  fs.writeFileSync(file + ".json", JSON.stringify(Object.assign({}, report, { summary }), (k, v) => typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v) + "\n");
  const old = fs.existsSync(file + ".md") ? fs.readFileSync(file + ".md", "utf8") : "";
  const tail = old.includes(MARK) ? old.slice(old.indexOf(MARK)) : MARK + "\n";
  fs.writeFileSync(file + ".md", markdown(report) + "\n" + tail);
}
/** --rebuild 报告路径：不重跑模拟，用已有的 json 按现在的报告格式重新生成（敌人名字、单局里出现的幕按现在的代码重算，数字照旧） */
function rebuild(out) {
  const file = outPath(out), report = JSON.parse(fs.readFileSync(file + ".json", "utf8")), c = H.load();
  report.meta = Object.fromEntries(Object.keys(report.meta).map(k => [k, enemyMeta(c, k)]));
  writeReport(file, report);
  console.log(`OK: ${file}.md（按 json 重新生成，${report.rows} 场）`);
  return 0;
}
async function main(argv = process.argv.slice(2)) {
  if (argv[0] === "--rebuild") { if (argv.length !== 2) throw new Error("Usage: --rebuild docs/balance/<报告名>"); return rebuild(argv[1]); }
  const opt = parseArgs(argv), file = outPath(opt.out), meta = provenance(argv), jobs = plan(opt);
  let done = 0;
  const rows = await runJobs(jobs, opt.workers, () => { if (++done % 200 === 0 || done === jobs.length) console.error(`Completed ${done}/${jobs.length}`); });
  const report = buildReport(rows, opt, meta);
  writeReport(file, report);
  console.log(`${report.errors ? "ERRORS" : "OK"}: ${file}.md（${rows.length} 场，异常 ${report.errors}）`);
  return report.errors ? 1 : 0;
}
if (isMainThread && require.main === module) main().then(code => { process.exitCode = code; }).catch(e => { console.error(e.stack || String(e)); process.exitCode = 1; });
module.exports = { CONFIG, GROUPS, BOSSES, LAYOUTS, ATK_FIELDS, unitKits, paperStats, appearance, plan, runJob, runJobs, summarize, summarizeAll, flags, buildReport, markdown, parseArgs, main };
