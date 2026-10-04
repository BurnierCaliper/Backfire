// Preset single-battle matrix. CLI: node tools/score-by-act.js [samples per cell].
// Frozen manifests and JSON/CSV/Markdown: node tools/balance-report.js --help
"use strict";
const H = require("../tests/headless");
const B = require("./balance-common");

function one(act, kind, size, index, options = {}) {
  const seed = options.seed || `R1:matrix:legacy:${act}:${kind}:${size}:${index}`;
  const party = options.party || B.partyFor(seed, size), boost = Number(options.boost || 0);
  const row = { suite: "matrix", id: options.id || seed, set: options.set || "adhoc", act, kind, size, startingSize: size, seed, party, strategy: B.STRATEGIES.matrix.version, diagnosticBoost: boost, outcome: "error" };
  try {
    if (![1, 2, 3, 4].includes(act) || !["battle", "elite", "boss"].includes(kind)) throw new Error("Invalid act or battle kind");
    B.validateParty(party, size === 1);
    if (party.length !== size || !Number.isInteger(boost) || boost < 0) throw new Error("Invalid party size or diagnostic boost");
    const maxRounds = B.positiveInt(options.maxRounds || 30, "maxRounds"), r = B.rng(seed + ":setup");
    const c = H.load(), R = c.Rogue;
    c.S.RNG.install(seed + ":setup");
    const run = size === 1 ? R.newRun({ party, solo: true, seed, partners: B.HEROES.filter(k => !party.includes(k)).slice(0, 3), role2: R.role2Options(party[0])[0] }) : R.newRun({ party, seed });
    run.act = act;
    if (kind === "boss") { run.actDay = 8; run.stage = "boss"; }
    else { run.actDay = 0; R.makeBoard(run); R.acceptTask(run, "main"); run.actDay = Math.floor(r() * 8); run.task.nodes[run.task.index] = { type: kind, done: false }; }
    const spec = R.battleSpec(run); if (!spec) throw new Error("Missing battle specification");
    const level = spec.level + boost, levelChoices = [];
    run.party.forEach(h => { const from = h.level || 1; h.level = level; h.xp = 0; h.hp = null; h.shp = null; R.queueLevelRewards(h, from, level, [], run); Object.keys(h.weaponLevels || {}).forEach(k => { h.weaponLevels[k] = Math.max(1, Math.min(10, Math.round(level * .6))); }); });
    B.chooseLevels(R, run, levelChoices);
    // Attribute choices use Rogue.withParty/captureParty and can persist the old
    // HP ceiling. Restore full condition AFTER all choices, before the final setup.
    run.party.forEach(h => { h.hp = null; h.shp = null; h.weaponState = {}; });
    c.S.LEDGER.dur = {}; c.S.LEDGER.weapons = {}; c.S.LEDGER.heroes = {}; c.S.LEDGER.hours = 0;
    c.BattleSim.setup(spec);
    const s = c.S.state, before = B.fieldSnapshot(c);
    Object.assign(row, { battleSeed: spec.seed, day: run.actDay, enemyLevel: spec.level, heroLevel: level, lv: level, maxRounds, actualUnitsBefore: before, survivingHeroes: before.filter(u => u.isPlayer && !u.weaponOf && !u.dead).length, heroState: B.heroSnapshot(c, run), levelChoices, weather: s.weather, terrain: B.clone({ zoneMode: s.zoneMode, gaps: s.gaps, props: s.props, encounter: spec.encounter }), assumptions: { fullHealth: true, weaponLevel: "clamp(round(heroLevel * 0.6), 1, 10)", upgrades: "main attribute / first legal choice", cybernetics: "none", items: "not used", naturalProgression: false } });
    const result = c.BattleSim.run({ maxRounds });
    row.outcome = result.winner === "player" ? "win" : result.winner === "enemy" ? "lose" : result.winner === "timeout" ? "timeout" : "error";
    row.raw = s.battleScore.total;
    const settled = row.outcome === "timeout" ? { grade: c.battleGrade(), xpBonus: 0 } : c.settleBattleRewards(row.outcome);
    Object.assign(row, { win: row.outcome === "win", score: s.battleScore.total, fatigue: s.battleScore.parts.fatigue || 0, turns: s.turnNo, grade: settled.grade.grade, xpBonus: settled.xpBonus, flawless: !!s.battleScore.flawless, actualUnitsAfter: B.fieldSnapshot(c) });
    if (row.outcome === "timeout") { row.endReason = "Declared battle round limit reached"; row.terrainAfter = B.clone({ gaps: s.gaps, props: s.props, fields: s.fields }); row.lastRoundLog = (s.logPages || []).slice(-1).flatMap(p => (p.lines || []).map(l => l.text || String(l))); }
    if (c.__errors.length) throw new Error(`Rule console.error: ${c.__errors.join(" | ")}`);
  } catch (e) { row.outcome = "error"; row.win = false; row.error = e.stack || String(e); }
  return B.clone(row);
}

function main(argv = process.argv.slice(2)) {
  for (const x of argv.filter(x => x.startsWith("--"))) if (x !== "--include-solo" && !/^--diagnostic-boost=\d+$/.test(x)) throw new Error("Unknown or invalid option: " + x);
  const positional = argv.filter(x => !x.startsWith("--"));
  if (positional.length > 1) throw new Error("Expected at most one samples-per-cell argument");
  const n = B.positiveInt(positional[0] || 24, "samples per cell");
  const boostArg = argv.find(x => x.startsWith("--diagnostic-boost="));
  const boost = boostArg ? Number(boostArg.split("=")[1]) : 0;
  if (!Number.isInteger(boost) || boost < 0) throw new Error("Diagnostic boost must be a nonnegative integer");
  const sizes = argv.includes("--include-solo") ? [1, 2, 3, 4] : [2, 3, 4];
  console.log(`每格 ${n} 场；${boost ? `诊断强化 +${boost} 级（不属于基线）` : "默认无等级强化"}；分位数仅包括胜局。策略 ${B.STRATEGIES.matrix.version}`);
  let errors = 0;
  for (const act of [1, 2, 3, 4]) for (const kind of ["battle", "elite", "boss"]) for (const size of sizes) {
    const rows = Array.from({ length: n }, (_, i) => one(act, kind, size, i, { boost })), s = B.summarize(rows);
    errors += s.outcomes.error;
    console.log(`${act} ${kind} ${size}人 | ${JSON.stringify(s)}`);
  }
  return errors ? 1 : 0;
}
if (require.main === module) { try { process.exitCode = main(); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { one, main };
