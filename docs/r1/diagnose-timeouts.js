// Read-only diagnostics: replay timeouts, then continue the same battle/policy.
// Original samples and their denominators are never changed by this script.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const H = require("../../tests/headless");
const B = require("../../tools/balance-common");
const { one } = require("../../tools/score-by-act");
const { runCampaign } = require("../../tools/playtest");

function snapshot(c) {
  const s = c.S.state;
  return B.clone({
    turn: s.turnNo, weather: s.weather, score: s.battleScore.total,
    units: s.units.filter(u => !u.hidden && !u._removed).map(u => ({
      id: u.id, kit: u.kit, isPlayer: !!u.isPlayer, dead: !!u.dead,
      zone: u.zone, hp: (u.layers || []).reduce((n, l) => n + Math.max(0, Number(l.current) || 0), 0),
      layers: u.layers, shp: u.shp, shpMax: u.shpMax,
      dying: !!u.dying, upOnShp: !!u.upOnShp, stunned: !!u.stunned,
      flying: !!u.flying, ap: u.ap, bonus: u.bonus, resources: u.resources, statuses: u.statuses
    })),
    terrain: { zoneMode: s.zoneMode, gaps: s.gaps, fields: s.fields, props: s.props },
    // Include the last completed round, not just the empty next-turn header.
    tailLogs: s.logPages.slice(-2).map(p => ({ turn: p.turn, lines: (p.lines || []).slice(-50).map(l => l.text || String(l)) }))
  });
}

function diagnose(row, maxRounds) {
  const load = H.load;
  let context, policy;
  H.load = (...args) => {
    context = load(...args);
    const run = context.BattleSim.run;
    context.BattleSim.run = options => {
      if (options && options.policy) policy = options.policy;
      return run(options);
    };
    return context;
  };
  try {
    const limit = Number(row.maxRounds) || (row.suite === "campaign" ? 25 : 30);
    if (maxRounds <= limit) throw new Error("Diagnostic max-rounds must exceed the original limit");
    const replay = row.suite === "campaign"
      ? runCampaign({ id: row.id, seed: row.seed, party: row.party, maxRounds: limit, maxSteps: row.maxSteps || 2000 })
      : one(row.act, row.kind, row.size, 0, { seed: row.seed, party: row.party, boost: row.diagnosticBoost || 0, maxRounds: limit });
    const result = {
      id: row.id, suite: row.suite, seed: row.seed, act: row.act, kind: row.kind, size: row.size,
      historicalOutcome: row.outcome, originalRoundLimit: limit,
      replayOutcome: replay.outcome, replayError: replay.error || null,
      diagnosticRoundLimit: maxRounds, classification: "replay_did_not_timeout"
    };
    if (replay.outcome !== "timeout") return result;
    if (row.suite === "campaign") {
      const battle = replay.battles[replay.battles.length - 1];
      if (!battle || battle.outcome !== "timeout" || !policy) {
        result.classification = "campaign_step_limit_requires_flow_review";
        return result;
      }
      result.act = battle.act;
      result.kind = battle.kind;
      result.battleSeed = battle.battleSeed;
      result.campaignProgressPreserved = true;
      result.note = "Continues only this unresolved battle with its captured SMART policy; does not settle rewards, progress campaign, or apply campaign retreat decisions";
    }
    result.atLimit = snapshot(context);
    const extended = context.BattleSim.run({ maxRounds, ...(policy ? { policy } : {}) });
    result.extendedOutcome = extended.winner;
    result.afterExtension = snapshot(context);
    result.classification = extended.winner === "timeout" ? "still_unresolved_requires_review" : "resolved_after_original_round_limit";
    // HP alone does not establish a deadlock: shield, grit, posture, positions,
    // statuses, boss phases and terrain must also be inspected by the reviewer.
    const hpKey = s => s.units.map(u => [u.id, u.hp, u.shp, u.dead]).sort((a, b) => a[0].localeCompare(b[0]));
    result.hpAndGritUnchanged = JSON.stringify(hpKey(result.atLimit)) === JSON.stringify(hpKey(result.afterExtension));
    return result;
  } finally { H.load = load; }
}

function main(argv = process.argv.slice(2)) {
  const args = argv.slice();
  if (!args.length || args.includes("--help")) {
    console.log("node docs/r1/diagnose-timeouts.js docs/r1/report.json [--max-rounds 100] [--seed exact-seed] [--allow-source-mismatch]");
    return 0;
  }
  const file = path.resolve(H.ROOT, args.shift());
  let maxRounds = 100, selectedSeed = null, allowMismatch = false;
  while (args.length) {
    const flag = args.shift();
    if (flag === "--max-rounds") maxRounds = B.positiveInt(args.shift(), "max-rounds");
    else if (flag === "--seed") { selectedSeed = args.shift(); if (!selectedSeed) throw new Error("Missing seed"); }
    else if (flag === "--allow-source-mismatch") allowMismatch = true;
    else throw new Error("Unknown argument: " + flag);
  }
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(report.rows)) throw new Error("Expected a balance-report JSON file with rows");
  const current = B.provenance(), expectedHash = report.provenance && report.provenance.sourceHash;
  const sourceMatches = current.sourceHash === expectedHash;
  if (!sourceMatches && !allowMismatch) throw new Error("Source differs from report; use the recorded source or explicitly pass --allow-source-mismatch for a new diagnostic, not a historical reproduction");
  const timed = report.rows.filter(r => ["matrix", "campaign"].includes(r.suite) && r.outcome === "timeout" && (!selectedSeed || r.seed === selectedSeed));
  const results = timed.map(r => diagnose(r, maxRounds));
  const after = B.provenance();
  console.log(JSON.stringify({
    purpose: "Separate timeout diagnosis; does not overwrite or reclassify original samples",
    sourceReport: file, reportSourceHash: expectedHash || null, diagnosticSourceHash: current.sourceHash,
    sourceMatches, sourceStableDuringDiagnosis: current.sourceHash === after.sourceHash,
    warning: sourceMatches ? null : "Current-source replay only; cannot validate historical outcomes",
    campaignNote: "Campaign replay retains natural progression and captures the original SMART battle policy; extension does not resume route choices or retreat heuristics",
    results
  }, null, 2));
  return results.some(r => r.replayOutcome === "error") || current.sourceHash !== after.sourceHash ? 1 : 0;
}

if (require.main === module) { try { process.exitCode = main(); } catch (e) { console.error(e.stack || String(e)); process.exitCode = 1; } }
module.exports = { diagnose, snapshot, main };
