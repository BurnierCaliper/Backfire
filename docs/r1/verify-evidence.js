// Independent integrity checks for the delivered R1 reports and unchanged rules.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const assert = require("node:assert/strict");
const B = require("../../tools/balance-common");
const H = require("../../tests/headless");
const M = require("../../tools/balance-report");
const ROOT = path.resolve(__dirname, "../..");
const BASE = "10c00638002843f77e68b899cd23d41241c94478";
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, name), "utf8"));
const normalize = text => text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
const manifest = M.validateManifest(read("manifest.json"));
const provenance = B.provenance();
const reports = [read("matrix-formal.json"), read("campaign-formal.json")];
const counts = [];
for (const report of reports) {
  const suite = report.scope.suite;
  assert.notEqual(report.status, "BLOCKED");
  assert.equal(report.provenance.sourceHash, provenance.sourceHash, `${suite}: source hash`);
  assert.equal(report.provenance.configHash, provenance.configHash, `${suite}: config hash`);
  assert.equal(report.manifestHash, manifest.scenariosHash);
  const expected = manifest.scenarios.filter(s => s.suite === suite);
  assert.equal(report.rows.length, expected.length);
  assert.equal(report.requested, expected.length);
  const rows = new Map(report.rows.map(r => [r.id, r]));
  assert.equal(rows.size, expected.length);
  for (const s of expected) {
    const row = rows.get(s.id);
    assert.ok(row, s.id);
    assert.equal(row.seed, s.seed);
    assert.deepEqual(row.party, s.party);
    assert.equal(row.diagnosticBoost || 0, 0);
    assert.ok(["win", "lose", "retreat", "timeout"].includes(row.outcome));
    if (suite === "matrix") {
      assert.ok(row.heroState.every(h => h.hp === h.hpMax), s.id + ": full HP");
      assert.ok(row.actualUnitsBefore.filter(u => u.isPlayer).every(u => u.layers.every(l => l.current === l.max)), s.id + ": full layers");
    } else {
      assert.equal(row.legalStart, true);
      assert.equal(row.bugs.length, 0);
      assert.ok(row.battles.every(b => Number.isFinite(b.raw) && Number.isFinite(b.score)));
      if (row.outcome === "timeout") assert.equal(row.completed, false);
    }
  }
  counts.push({ suite, requested: report.requested, outcomes: report.rows.reduce((o, r) => { o[r.outcome] = (o[r.outcome] || 0) + 1; return o; }, {}) });
}

// The entire old app.js remains byte-equivalent after newline normalization;
// only the new shared settlement function was inserted. All other rule files
// loaded by the simulator are unchanged, including every score/config source.
for (const file of H.RULE_FILES) {
  const original = normalize(cp.execFileSync("git", ["show", `${BASE}:${file}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }));
  let current = normalize(fs.readFileSync(path.join(ROOT, file), "utf8"));
  if (file === "app.js") {
    const start = current.indexOf("/** 网页与无界面共用的战斗奖励结算。");
    const end = current.indexOf("/** 包住一次行动：结束后", start);
    assert.ok(start >= 0 && end > start);
    current = current.slice(0, start) + current.slice(end);
  }
  assert.equal(current, original, `${file}: existing rule source changed`);
}
const receipt = {
  status: "PASS",
  baseCommit: BASE,
  sourceHash: provenance.sourceHash,
  configHash: provenance.configHash,
  manifestHash: manifest.scenariosHash,
  additionalSourceHashes: Object.fromEntries([
    "game.js", "tools/economy.js", "tools/test-ui.js", "package.json",
    "tests/ui.test.js", "tests/balance-tools.test.js", "tests/battle-rewards.test.js", "tests/economy-tools.test.js",
  ].map(file => [file, B.hash(normalize(fs.readFileSync(path.join(ROOT, file), "utf8")))])),
  counts,
  checks: ["All fixed samples present exactly once", "No script errors or diagnostic boost", "Every preset hero starts with full HP/layers", "Campaign legal starts, finite raw/final scores and uncompleted timeouts", "Source/config hashes match current code", "All prior rule source unchanged; app.js adds only shared settlement"],
};
fs.writeFileSync(path.join(__dirname, "verification-receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt, null, 2));
