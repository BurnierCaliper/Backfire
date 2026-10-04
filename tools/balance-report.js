// Reproducible R1 evaluation; imports are inert. Independent scenarios use worker threads.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { Worker, isMainThread, parentPort } = require("node:worker_threads");
const B = require("./balance-common");

function createManifest() {
  const scenarios = [];
  for (const set of ["baseline", "validation"]) {
    for (const act of [1, 2, 3, 4]) for (const kind of ["battle", "elite", "boss"]) for (const size of [2, 3, 4]) {
      for (let i = 0; i < (set === "baseline" ? 100 : 50); i++) {
        const seed = `R1-v1:matrix:${set}:${act}:${kind}:${size}:${String(i).padStart(3, "0")}`;
        scenarios.push({ id: seed, suite: "matrix", set, act, kind, size, index: i, seed, party: B.partyFor(seed, size) });
      }
    }
    for (const size of [2, 3, 4]) for (let i = 0; i < (set === "baseline" ? 30 : 15); i++) {
      const seed = `R1-v1:campaign:${set}:${size}:${String(i).padStart(3, "0")}`;
      // Rotating contiguous groups guarantee every hero >= 2 appearances per size/set,
      // including the 15-run 2-player independent validation set (30 appearances).
      const party = Array.from({ length: size }, (_, j) => B.HEROES[(i * size + j + (set === "validation" ? 3 : 0)) % B.HEROES.length]);
      scenarios.push({ id: seed, suite: "campaign", set, size, index: i, seed, party });
    }
  }
  return { schema: "backfire-r1-manifest-v1", frozen: true, purpose: "Measurement only; unchanged score configuration. Validation seeds frozen before execution and excluded from fitting.", matrixCountsPerCell: { baseline: 100, validation: 50 }, campaignCountsPerSize: { baseline: 30, validation: 15 }, heroes: B.HEROES, scenarios, scenariosHash: B.hash(scenarios) };
}
function validateManifest(manifest) {
  if (manifest.schema !== "backfire-r1-manifest-v1" || !Array.isArray(manifest.scenarios)) throw new Error("Unsupported manifest");
  if (B.hash(manifest.scenarios) !== manifest.scenariosHash) throw new Error("Manifest hash mismatch");
  const ids = new Set(), seeds = new Set();
  for (const s of manifest.scenarios) {
    B.validateParty(s.party);
    if (!["matrix", "campaign"].includes(s.suite) || !["baseline", "validation"].includes(s.set) || s.party.length !== s.size || !s.id || !s.seed || ids.has(s.id) || seeds.has(s.seed)) throw new Error("Invalid or duplicate manifest scenario");
    if (s.suite === "matrix" && (![1, 2, 3, 4].includes(s.act) || !["battle", "elite", "boss"].includes(s.kind))) throw new Error("Invalid matrix cell");
    ids.add(s.id); seeds.add(s.seed);
  }
  if (manifest.scenariosHash !== createManifest().scenariosHash) throw new Error("Manifest differs from the frozen R1 v1 sample and party lists");
  return manifest;
}
function executeScenario(s, options = {}) {
  try {
    if (s.suite === "matrix") return require("./score-by-act").one(s.act, s.kind, s.size, s.index, { ...s, boost: options.boost || 0, maxRounds: options.matrixRounds || 30 });
    const row = require("./playtest").runCampaign({ ...s, maxRounds: options.campaignRounds || 25, maxSteps: options.maxSteps || 2000 });
    return { ...s, ...row };
  } catch (e) { return { ...s, outcome: "error", error: e.stack || String(e) }; }
}
if (!isMainThread) parentPort.on("message", job => { parentPort.postMessage({ index: job.index, row: executeScenario(job.scenario, job.options) }); });

async function runScenarios(scenarios, options = {}) {
  const workers = B.positiveInt(options.workers || 1, "workers"), rows = Array(scenarios.length);
  if (!scenarios.length) return rows;
  if (workers === 1) { for (let i = 0; i < scenarios.length; i++) { rows[i] = executeScenario(scenarios[i], options); if (options.onResult) options.onResult(rows[i], i); } return rows; }
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(workers, scenarios.length) }, () => new Promise((resolve, reject) => {
    const worker = new Worker(__filename); let active = null;
    const dispatch = () => { if (next >= scenarios.length) { worker.terminate().then(resolve, reject); return; } active = next++; worker.postMessage({ index: active, scenario: scenarios[active], options: { boost: options.boost, matrixRounds: options.matrixRounds, campaignRounds: options.campaignRounds, maxSteps: options.maxSteps } }); };
    worker.on("message", ({ index, row }) => { rows[index] = row; if (options.onResult) options.onResult(row, index); active = null; dispatch(); });
    worker.on("error", error => { if (active != null) { rows[active] = { ...scenarios[active], outcome: "error", error: error.stack || String(error) }; if (options.onResult) options.onResult(rows[active], active); } reject(error); });
    dispatch();
  })));
  return rows;
}
function groupSummary(rows, scenarios) {
  const matrix = [], campaigns = [];
  for (const set of ["baseline", "validation"]) {
    for (const act of [1, 2, 3, 4]) for (const kind of ["battle", "elite", "boss"]) for (const size of [2, 3, 4]) {
      const match = x => x.suite === "matrix" && x.set === set && x.act === act && x.kind === kind && x.size === size;
      const expected = scenarios.filter(match).length; if (!expected) continue;
      matrix.push({ set, act, kind, size, ...B.summarize(rows.filter(match), expected) });
    }
    for (const size of [2, 3, 4]) {
      const match = x => x.suite === "campaign" && x.set === set && x.size === size, expected = scenarios.filter(match).length;
      if (!expected) continue;
      const all = rows.filter(match), legal = all.filter(r => r.legalStart), wins = legal.filter(r => r.outcome === "win");
      const counts = B.summarize(all, expected);
      const acts = [1, 2, 3, 4].map(act => {
        const reached = legal.filter(r => (r.reachedActs || []).includes(act)).length;
        const bosses = all.flatMap(r => r.battles || []).filter(b => b.act === act && b.kind === "boss");
        const won = bosses.filter(b => b.outcome === "win").length;
        return { act, reached, reachDenominator: legal.length, reachRate: legal.length ? reached / legal.length : null, bossEntered: bosses.length, bossWins: won, bossWinRate: bosses.length ? won / bosses.length : null, bossWinRate95: B.wilson(won, bosses.length), bossOutcomes: B.summarize(bosses), battleScores: B.summarize(all.flatMap(r => r.battles || []).filter(b => b.act === act)), bossKinds: [...new Set(bosses.flatMap(b => (b.actualUnitsBefore || []).filter(u => !u.isPlayer).map(u => u.kit)))] };
      });
      campaigns.push({ set, size, ...counts, legalStarts: legal.length, clearWins: wins.length, clearRate: legal.length ? wins.length / legal.length : null, clearRate95: B.wilson(wins.length, legal.length), legalEnds: all.filter(r => r.completed && ["win", "lose"].includes(r.outcome)).length, heroCoverage: Object.fromEntries(B.HEROES.map(k => [k, all.filter(r => r.party.includes(k)).length])), acts, endReasons: Object.fromEntries([...new Set(all.map(r => r.endReason || r.error))].map(reason => [reason, all.filter(r => (r.endReason || r.error) === reason).length])) });
    }
  }
  return { matrix, campaigns };
}
const pct = n => n == null ? "无样本/无法估计" : (n * 100).toFixed(1) + "%";
const ci = pair => pair ? pair.map(pct).join("–") : "无样本/无法估计";
const num = n => n == null ? "无样本" : Math.round(n);
function markdown(report) {
  const l = ["# R1 可复现平衡测量报告", "", `报告状态：**${report.status}**。${report.diagnosticBoost ? `诊断强化 +${report.diagnosticBoost} 级；本报告不能与默认基线合并。` : "默认无等级强化。评分、经验倍率及敌人/经济配置未调参。"}`, "", `源码 SHA256：\`${report.provenance.sourceHash}\`；配置 SHA256：\`${report.provenance.configHash}\`；清单 SHA256：\`${report.manifestHash}\`。`, `提交：\`${report.provenance.commit}\`；Node：${report.provenance.node}；命令：\`${report.provenance.command}\`。`, "", "单场胜率分母为所有成功执行场次（包括败/撤退/超时），异常单列。分位数仅含胜局最终得分；区间为 Wilson 95%。整局通关率分母为全部合法开局；首领胜率分母为实际进入该首领战的次数。", "", "策略与假设：", `- 单场：${B.STRATEGIES.matrix.description}`, `- 整局：${B.STRATEGIES.campaign.description}`, "- 两组固定清单互不重叠；独立验证集不参与拟合。未到达后期幕不产生虚构记录。超时保留为未解决样本，不能当撤退或失败继续结算。", "", "## 样本与异常", "", `请求 ${report.requested}；完成 ${report.rows.length}；异常 ${report.rows.filter(r => r.outcome === "error").length}；超时 ${report.rows.filter(r => r.outcome === "timeout").length}。`, ...report.issues.map(x => "- " + x), "", "## 单场矩阵", "", "|集|幕|类型|人数|请求/执行/异常|胜/败/撤/超时|胜率 (Wilson 95%)|P25/P50/P75/P90|S/A/B/C/D|", "|---|---:|---|---:|---|---|---|---|---|"];
  for (const r of report.summary.matrix) l.push(`|${r.set}|${r.act}|${r.kind}|${r.size}|${r.requested}/${r.executed}/${r.outcomes.error}|${["win", "lose", "retreat", "timeout"].map(k => r.outcomes[k]).join("/")}|${pct(r.winRate)} (${ci(r.winRate95)})|${Object.values(r.scores).map(num).join("/")}|${Object.values(r.grades).join("/")}|`);
  l.push("", "## 自然成长整局", "", "|集|开局人数|请求/合法开局/合法终局|通关 (Wilson 95%)|失败/超时/异常|", "|---|---:|---|---|---|");
  for (const r of report.summary.campaigns) l.push(`|${r.set}|${r.size}|${r.requested}/${r.legalStarts}/${r.legalEnds}|${r.clearWins}/${r.legalStarts} ${pct(r.clearRate)} (${ci(r.clearRate95)})|${r.outcomes.lose}/${r.outcomes.timeout}/${r.outcomes.error}|`);
  l.push("", "|集|开局人数|幕|到达/合法开局|首领胜/进入|首领胜率 (Wilson 95%)|", "|---|---:|---:|---|---|---|");
  for (const r of report.summary.campaigns) for (const a of r.acts) l.push(`|${r.set}|${r.size}|${a.act}|${a.reached}/${a.reachDenominator} (${pct(a.reachRate)})|${a.bossWins}/${a.bossEntered}|${pct(a.bossWinRate)} (${ci(a.bossWinRate95)})|`);
  l.push("", "## 上限诊断", "", "计数完成与游戏合法终局分开报告；超时表示预设计算上限，不能推断必败或规则故障。保留末轮单位状态（含坚毅起身）、地形和日志供独立诊断。以下样本均未追加经验、未当作撤退推进。", "", "|场景/种子|幕/类型|上限类型|上限|记录回合|", "|---|---|---|---:|---:|");
  for (const d of report.timeoutDiagnostics) l.push(`|${d.id}|${d.act}/${d.kind || "流程"}|${d.reason}|${d.limit}|${d.turns || "—"}|`);
  if (!report.timeoutDiagnostics.length) l.push("|无超时|—|—|—|—|");
  l.push("", "## 限制与原始记录", "", "真实玩家水平不能从这两种自动策略外推。单场预设等级、满状态，并非整局成长。SMART 直接优化评分、默认不使用部分武器人召唤和战斗道具，均会影响结果。首领类型覆盖仅按实际出现记录，未覆盖种类需要另建明确标记的定向场景，不能并入随机样本。", "", "同名前缀的 .json 包含完整配置、源码哈希、全部种子/队伍、战斗前后等级/武器等级、天气/地形、补给/经济、伤亡与终局原因；.csv 包含原始场景行，.battles.csv 包含所有战斗行。元数据（时间戳、耗时）不属于复现比较。", "");
  return l.join("\n");
}
function buildReport(rows, scenarios, manifest, options, meta) {
  const issues = [], summary = groupSummary(rows, scenarios);
  const errors = rows.filter(r => r.outcome === "error"), timeouts = rows.filter(r => r.outcome === "timeout");
  if (errors.length) issues.push(`${errors.length} 个脚本异常；本报告不合格，详见原始记录 error/bugs。`);
  if (timeouts.length) issues.push(`${timeouts.length} 个样本达到预先声明的回合/步骤上限，已单列为 timeout 并纳入成功执行分母；没有当作合法败局或撤退继续结算。它们限制胜率解释，不是脚本异常；不能据此宣称所有整局达到合法游戏结局。`);
  if (rows.length !== scenarios.length) issues.push("场景记录缺失。");
  for (const r of summary.campaigns) if (Object.values(r.heroCoverage).some(n => n < 2)) issues.push(`${r.set} ${r.size} 人队伍未达到每个角色至少出现两次的正式覆盖要求。`);
  const formal = !options.limit && !options.samples && !options.boost && !options.id;
  if (!formal) issues.push("这是筛选冒烟或诊断样本，不是完整正式评估。");
  const bossCoverage = [];
  for (const suite of ["matrix", "campaign"]) for (const set of ["baseline", "validation"]) for (const act of [1, 2, 3, 4]) {
    if (!scenarios.some(s => s.suite === suite && s.set === set)) continue;
    const config = meta.config.rogue, plannedRegion = config.regions[(act - 1) % config.regions.length];
    const battles = rows.filter(r => r.suite === suite && r.set === set).flatMap(r => suite === "matrix" ? [r] : r.battles || []).filter(b => b.act === act && b.kind === "boss");
    const actualRegions = [...new Set(battles.map(b => ((b.terrain || {}).encounter || {}).region).filter(Boolean))];
    const expectedByRegion = Object.fromEntries((actualRegions.length ? actualRegions : [plannedRegion]).map(region => { const pool = config.bosses[region] || []; return [region, pool.length ? pool : [...new Set(Object.values(config.bosses).flat())]]; }));
    const expected = [...new Set(Object.values(expectedByRegion).flat())];
    // Preset identity is authoritative: ufo_boss spawns ufo_body/ufo_leg units.
    const observed = [...new Set(battles.flatMap(b => ((b.terrain || {}).encounter || {}).enemies || []).map(e => e.preset))].filter(k => expected.includes(k));
    const missing = expected.filter(k => !observed.includes(k));
    bossCoverage.push({ suite, set, act, plannedRegion, actualRegions, expectedByRegion, expectedBasis: actualRegions.length ? "actual encounter regions and configured regional pool (empty pool falls back to all bosses)" : "planned region only; no actual boss encounters", expected, observed, missing });
    if (missing.length) issues.push(`${suite}/${set} 第 ${act} 幕首领未覆盖：${missing.join("、")}。需另列定向场景，不能计入本随机样本。`);
  }
  const timeoutDiagnostics = timeouts.map(r => { const b = r.suite === "matrix" ? r : (r.battles || []).findLast(x => x.outcome === "timeout"); return { id: r.id, suite: r.suite, set: r.set, seed: r.seed, act: b ? b.act : r.act, kind: b ? b.kind : null, reason: b ? "battle_round_limit" : "campaign_step_limit", limit: b ? r.maxRounds : r.maxSteps, turns: b && b.turns, battleSeed: b && b.battleSeed, survivors: b ? (b.actualUnitsAfter || []).filter(u => !u.dead && (u.hp > 0 || u.upOnShp)).map(u => ({ kit: u.kit, isPlayer: u.isPlayer, hp: u.hp, shp: u.shp, upOnShp: u.upOnShp, zone: u.zone })) : [], interpretation: "The declared safety limit was reached. No inference that this is an inevitable loss, a rule defect, or human-player performance." }; });
  const report = { schema: "backfire-r1-report-v1", generatedAt: new Date().toISOString(), scope: { suite: options.suite, set: options.set, samplesPerGroup: options.samples || null, limit: options.limit || null, id: options.id || null }, status: errors.length || rows.length !== scenarios.length ? "BLOCKED" : formal ? timeouts.length ? "MEASURED_WITH_LIMITS" : "COMPLETE_FOR_SELECTED_SCOPE" : "SMOKE_OR_DIAGNOSTIC", requested: scenarios.length, diagnosticBoost: options.boost || 0, executionOptions: { workers: options.workers, matrixRounds: options.matrixRounds, campaignRounds: options.campaignRounds, maxSteps: options.maxSteps }, provenance: meta, manifestHash: manifest.scenariosHash, selectedManifestHash: B.hash(scenarios), selectedScenarios: scenarios, issues, bossCoverage, timeoutDiagnostics, summary, rows };
  return report;
}
function parseArgs(argv) { const out = { action: argv[0] || "help" }, allowed = out.action === "manifest" ? ["out"] : ["manifest", "suite", "set", "workers", "out", "samples", "limit", "id", "diagnostic-boost", "matrix-rounds", "campaign-rounds", "max-steps"]; for (let i = 1; i < argv.length; i++) { const key = argv[i]; if (!key.startsWith("--") || !allowed.includes(key.slice(2))) throw new Error("Unknown argument: " + key); if (Object.hasOwn(out, key.slice(2))) throw new Error("Duplicate argument: " + key); out[key.slice(2)] = argv[++i]; if (out[key.slice(2)] == null || out[key.slice(2)].startsWith("--")) throw new Error("Missing value for " + key); } return out; }
async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.includes("--help")) { console.log("node tools/balance-report.js manifest --out docs/r1/manifest.json\nnode tools/balance-report.js run --manifest docs/r1/manifest.json --suite matrix|campaign|all --set baseline|validation|all --workers 4 --out docs/r1/baseline [--samples 10] [--limit 1] [--diagnostic-boost 2] [--matrix-rounds 30] [--campaign-rounds 25] [--max-steps 2000]"); return 0; }
  const args = parseArgs(argv);
  if (args.action === "manifest") { const file = B.reportPath(args.out || "docs/r1/manifest.json"), manifest = createManifest(); if (fs.existsSync(file)) { const old = JSON.parse(fs.readFileSync(file, "utf8")); validateManifest(old); if (old.scenariosHash !== manifest.scenariosHash) throw new Error("Refusing to overwrite a different frozen manifest"); } else fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n"); console.log(`Frozen ${manifest.scenarios.length} scenarios: ${file}`); return 0; }
  if (args.action !== "run") throw new Error("Unknown action " + args.action);
  const manifest = validateManifest(JSON.parse(fs.readFileSync(B.reportPath(args.manifest || "docs/r1/manifest.json"), "utf8")));
  const options = { suite: args.suite || "all", set: args.set || "all", workers: B.positiveInt(args.workers || 1, "workers"), samples: args.samples ? B.positiveInt(args.samples, "samples") : null, limit: args.limit ? B.positiveInt(args.limit, "limit") : null, boost: Number(args["diagnostic-boost"] || 0), matrixRounds: B.positiveInt(args["matrix-rounds"] || 30, "matrix rounds"), campaignRounds: B.positiveInt(args["campaign-rounds"] || 25, "campaign rounds"), maxSteps: B.positiveInt(args["max-steps"] || 2000, "max steps") };
  if (!["matrix", "campaign", "all"].includes(options.suite) || !["baseline", "validation", "all"].includes(options.set) || !Number.isInteger(options.boost) || options.boost < 0) throw new Error("Invalid suite, set or diagnostic boost");
  if (options.boost && options.suite !== "matrix") throw new Error("Diagnostic boost is limited to a separate matrix report");
  options.id = args.id || null;
  let scenarios = manifest.scenarios.filter(s => (options.suite === "all" || s.suite === options.suite) && (options.set === "all" || s.set === options.set) && (!options.samples || s.index < options.samples) && (!options.id || s.id === options.id));
  if (!scenarios.length) throw new Error("No manifest scenarios match the requested selection");
  if (options.limit) scenarios = scenarios.slice(0, options.limit);
  const output = B.reportPath(args.out || "docs/r1/report"), meta = B.provenance(), journal = output + ".jsonl";
  fs.writeFileSync(journal, "");
  let completed = 0;
  options.onResult = row => { fs.appendFileSync(journal, JSON.stringify(row) + "\n"); if (++completed % 25 === 0 || completed === scenarios.length) console.error(`Completed ${completed}/${scenarios.length}`); };
  const rows = await runScenarios(scenarios, options), report = buildReport(rows, scenarios, manifest, options, meta);
  const after = B.provenance(); if (after.sourceHash !== meta.sourceHash) { report.status = "BLOCKED"; report.issues.push("执行期间源码发生改变：报告混合了不同源码版本，必须重跑。"); report.provenanceAfter = after; }
  fs.writeFileSync(output + ".json", JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(output + ".csv", B.csv(rows));
  fs.writeFileSync(output + ".battles.csv", B.csv(rows.flatMap(r => r.suite === "matrix" ? [r] : (r.battles || []).map((b, i) => ({ scenarioId: r.id, set: r.set, battleIndex: i, ...b })))));
  fs.writeFileSync(output + ".md", markdown(report));
  console.log(`${report.status}: ${output}.md`);
  return rows.some(r => r.outcome === "error") || after.sourceHash !== meta.sourceHash ? 1 : 0;
}
if (isMainThread && require.main === module) main().then(code => { process.exitCode = code; }).catch(e => { console.error(e.stack || String(e)); process.exitCode = 1; });
module.exports = { createManifest, validateManifest, executeScenario, runScenarios, groupSummary, buildReport, markdown, main };
