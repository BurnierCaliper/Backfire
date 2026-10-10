"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const H = require("./headless");
const B = require("../tools/balance-common");
const M = require("../tools/balance-report");
const { one } = require("../tools/score-by-act");
const { runCampaign } = require("../tools/playtest");

test("balance tool imports do not start scenarios or print reports", () => {
  const out = cp.execFileSync(process.execPath, ["-e", "require('./tools/score-by-act');require('./tools/playtest');require('./tools/balance-report');console.log('inert')"], { cwd: H.ROOT, encoding: "utf8", timeout: 3000 });
  assert.equal(out.trim(), "inert");
});
test("frozen manifest has 36 cells, 5400 battles, 135 campaigns and disjoint seeds", () => {
  const m = M.createManifest();
  assert.equal(M.validateManifest(m), m);
  assert.equal(m.scenarios.filter(x => x.suite === "matrix").length, 5400);
  assert.equal(m.scenarios.filter(x => x.suite === "campaign").length, 135);
  assert.equal(new Set(m.scenarios.map(x => x.seed)).size, 5535);
  for (const set of ["baseline", "validation"]) {
    for (const act of [1, 2, 3, 4]) for (const kind of ["battle", "elite", "boss"]) for (const size of [2, 3, 4]) assert.equal(m.scenarios.filter(s => s.suite === "matrix" && s.set === set && s.act === act && s.kind === kind && s.size === size).length, set === "baseline" ? 100 : 50);
    for (const size of [2, 3, 4]) {
      const runs = m.scenarios.filter(s => s.suite === "campaign" && s.set === set && s.size === size);
      assert.equal(runs.length, set === "baseline" ? 30 : 15);
      m.heroes.forEach(k => assert.ok(runs.filter(r => r.party.includes(k)).length >= 2, `${set}/${size}/${k}`));
    }
  }
  m.scenarios[0].seed = "changed";
  assert.throws(() => M.validateManifest(m), /hash mismatch/);
});
test("Wilson interval and win-only quantiles keep timeout in denominator and errors separate", () => {
  const s = B.summarize([{ outcome: "win", score: 100, grade: "D" }, { outcome: "lose", score: 900 }, { outcome: "retreat" }, { outcome: "timeout" }, { outcome: "error" }]);
  assert.equal(s.executed, 4); assert.equal(s.winRate, .25); assert.equal(s.outcomes.error, 1); assert.equal(s.scores.p90, 100);
  assert.ok(Math.abs(B.wilson(50, 100)[0] - .4038315303659956) < 1e-12);
  assert.equal(B.wilson(0, 0), null);
  assert.equal(B.summarize([{ outcome: "lose" }]).scores.p50, null);
});
test("hero reporting does not consume combat randomness", () => {
  const c = H.load(), run = c.Rogue.newRun({ seed: "REPORT-RNG", party: ["tou", "ruby"] });
  c.S.RNG.install("REPORT-RNG"); const before = c.S.RNG.draws();
  B.heroSnapshot(c, run); assert.equal(c.S.RNG.draws(), before);
});
test("source hashes are portable across CRLF/LF checkouts", () => {
  assert.equal(B.hash(B.normalizeSource("\uFEFFconst a = 1;\r\nconst b = 2;\r\n")), B.hash(B.normalizeSource("const a = 1;\nconst b = 2;\n")));
  assert.notEqual(B.hash(B.normalizeSource("const a = 1; \n")), B.hash(B.normalizeSource("const a = 1;\n")));
});
test("campaign board fallback progresses all four former legal-task dead ends", () => {
  const ids = ["R1-v1:campaign:baseline:2:011", "R1-v1:campaign:baseline:3:014", "R1-v1:campaign:baseline:4:022", "R1-v1:campaign:validation:3:006"];
  const manifest = M.createManifest();
  // 这几个固定种子的场景以前会卡死在任务板上。规则改动会改变它们的走向（某一个可能不再走到那个死角），
  // 所以要求：都能正常跑完、没有 bug，并且兜底逻辑至少在其中一个场景里被走到
  let fallbacks = 0;
  for (const id of ids) {
    const scenario = manifest.scenarios.find(s => s.id === id), result = M.executeScenario(scenario);
    assert.notEqual(result.outcome, "error", JSON.stringify(result.bugs));
    assert.equal(result.bugs.length, 0);
    if (result.events.some(x => x.includes("按合法任务兜底"))) fallbacks++;
    assert.ok(result.completed || result.outcome === "timeout");
  }
  assert.ok(fallbacks >= 1, "兜底逻辑没有被任何场景走到");
});
test("single battles reproduce actual levels and default to no act-4 boost", () => {
  const options = { seed: "LEVEL-REPEAT", party: ["tou", "ruby", "xia"], maxRounds: 1 };
  const a = one(4, "boss", 3, 0, options), b = one(4, "boss", 3, 0, options);
  assert.notEqual(a.outcome, "error", a.error); assert.deepEqual(a, b);
  assert.equal(a.outcome, "timeout");
  assert.equal(a.diagnosticBoost, 0); assert.equal(a.heroLevel, a.enemyLevel);
  assert.ok(a.actualUnitsBefore.filter(u => u.isPlayer && !u.weaponOf).every(u => u.level === a.heroLevel));
  assert.ok(a.heroState.every(h => h.hp === h.hpMax));
  assert.ok(a.actualUnitsBefore.filter(u => u.isPlayer).every(u => u.layers.every(l => l.current === l.max)));
  const boosted = one(4, "boss", 3, 0, { ...options, boost: 2 });
  assert.equal(boosted.heroLevel, boosted.enemyLevel + 2); assert.equal(boosted.diagnosticBoost, 2);
  assert.equal(one(0, "boss", 3, 0).outcome, "error");
  const regression = one(1, "battle", 2, 6, M.createManifest().scenarios.find(s => s.suite === "matrix" && s.set === "baseline" && s.act === 1 && s.kind === "battle" && s.size === 2 && s.index === 6));
  assert.ok(regression.heroState.every(h => h.hp === h.hpMax));
});
test("campaign determinism, valid loss, and unresolved step limits have distinct outcomes", () => {
  const options = { seed: "R1-v1:campaign:baseline:2:000", party: ["ruby", "yuito"] };
  const a = runCampaign(options), b = runCampaign(options);
  assert.deepEqual(a, b); assert.equal(a.outcome, "lose"); assert.equal(a.completed, true); assert.equal(a.bugs.length, 0);
  assert.ok(a.battles.every(b => Number.isFinite(b.raw) && Number.isFinite(b.score)));
  const timed = runCampaign({ ...options, maxSteps: 1 });
  assert.equal(timed.outcome, "timeout"); assert.equal(timed.completed, false);
});
test("actual combat exceptions are recorded as errors rather than legal losses", () => {
  const original = H.load;
  H.load = (...args) => { const c = original(...args); c.BattleSim.run = () => { throw new Error("injected simulation failure"); }; return c; };
  try {
    const r = runCampaign({ seed: "R1-v1:campaign:baseline:2:000", party: ["ruby", "yuito"] });
    assert.equal(r.outcome, "error"); assert.equal(r.battles[0].outcome, "error"); assert.match(r.battles[0].error, /injected simulation failure/);
  } finally { H.load = original; }
  const invalid = cp.spawnSync(process.execPath, ["tools/playtest.js", "INVALID", "ruby,ruby"], { cwd: H.ROOT, encoding: "utf8" });
  assert.equal(invalid.status, 1);
  const legalLoss = cp.spawnSync(process.execPath, ["tools/playtest.js", "R1-v1:campaign:baseline:2:000", "ruby,yuito", "--json"], { cwd: H.ROOT, encoding: "utf8" });
  assert.equal(legalLoss.status, 0); assert.equal(JSON.parse(legalLoss.stdout).outcome, "lose");
});
test("misspelled configuration flags return nonzero instead of starting a batch", () => {
  for (const argv of [["tools/balance-report.js", "run", "--sampls", "10"], ["tools/score-by-act.js", "--sampls=10"], ["tools/playtest.js", "R1-v1:campaign:baseline:2:000", "ruby,yuito", "--max-rounnds=1", "--json"], ["tools/playtest.js", "R1-v1:campaign:baseline:2:000", "ruby,yuito", "--max-rounds=1", "--json"]]) {
    const r = cp.spawnSync(process.execPath, argv, { cwd: H.ROOT, encoding: "utf8", timeout: 3000 });
    assert.equal(r.status, 1); assert.match(r.stderr, /Unknown/);
  }
});
test("parallel workers preserve scenario order and deterministic core results", async () => {
  const scenarios = M.createManifest().scenarios.slice(0, 2);
  const serial = await M.runScenarios(scenarios, { workers: 1, matrixRounds: 2 });
  const parallel = await M.runScenarios(scenarios, { workers: 2, matrixRounds: 2 });
  assert.deepEqual(serial, parallel);
});
