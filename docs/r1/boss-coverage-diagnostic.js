// Selected preset/full-health diagnostics only. Never add these to natural-campaign
// or random-matrix sample counts. Reuses three already counted validation seeds.
// Run after the final matrix report: node docs/r1/boss-coverage-diagnostic.js
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const B = require("../../tools/balance-common");
const { one } = require("../../tools/score-by-act");
const ROOT = path.resolve(__dirname, "../..");
const SOURCE = "docs/r1/matrix-formal.json";
const TARGET = "docs/r1/boss-coverage-diagnostic";
const PRESET = "sand_aggregate";

function main() {
  if (process.argv.length > 2) throw new Error("This diagnostic has fixed source/selection; no arguments are accepted");
  const sourceText = fs.readFileSync(path.join(ROOT, SOURCE), "utf8"), source = JSON.parse(sourceText);
  if (source.status === "BLOCKED") throw new Error("Source matrix report is blocked");
  const provenance = B.provenance();
  const sourceInfo = { file: SOURCE, sha256: B.hash(sourceText), sourceHash: source.provenance.sourceHash, configHash: source.provenance.configHash, manifestHash: source.manifestHash };
  const selections = [2, 3, 4].map(size => {
    const original = source.rows.find(row => row.suite === "matrix" && row.set === "validation" && row.act === 3 && row.kind === "boss" && row.size === size && row.diagnosticBoost === 0 && (row.terrain.encounter.enemies || []).some(e => e.preset === PRESET));
    if (!original) throw new Error(`Source report has no unboosted act-3 ${PRESET} validation scenario for size ${size}`);
    const scenario = source.selectedScenarios.find(s => s.id === original.id);
    if (!scenario) throw new Error("Source report is missing the selected manifest entry: " + original.id);
    const replay = one(3, "boss", size, scenario.index, { ...scenario, id: "targeted:" + scenario.id, set: "targeted-diagnostic", maxRounds: original.maxRounds, boost: 0 });
    replay.suite = "targeted-boss-diagnostic";
    const actualPresets = ((replay.terrain || {}).encounter || {}).enemies || [];
    if (!actualPresets.some(e => e.preset === PRESET)) throw new Error("Replay no longer produces the selected boss preset");
    const sameCore = ["outcome", "raw", "score", "grade", "turns", "enemyLevel", "heroLevel", "weather"].every(k => replay[k] === original[k]) && JSON.stringify(replay.party) === JSON.stringify(original.party);
    return { sourceScenarioId: original.id, sourceSeed: original.seed, sourceSet: original.set, sourceOutcome: original.outcome, sourceScore: original.score, matchesSourceCore: sameCore, replay };
  });
  const report = {
    schema: "backfire-r1-targeted-boss-diagnostic-v1", generatedAt: new Date().toISOString(),
    status: selections.some(x => x.replay.outcome === "error") ? "ERROR" : "DIAGNOSTIC_ONLY",
    purpose: "Investigate sand_aggregate behavior at act 3, 2/3/4 preset full-health heroes; campaign validation did not naturally encounter this preset at act 3.",
    selection: "First matching existing unboosted matrix validation row in manifest order per starting size; selected by known boss preset, not random additional sampling.",
    notForNaturalCampaignStatistics: true, notAdditionalIndependentSamples: true,
    limitations: "Preset levels match the encounter level; full health and preset weapons/upgrades; BASIC_POLICY. These three validation seeds have already been counted in the matrix. Replays neither fill the natural-growth campaign coverage gap nor increase formal matrix sample counts; no human win-rate or difficulty conclusion is justified.",
    source: sourceInfo, provenance,
    diagnosticScriptHash: B.hash(B.normalizeSource(fs.readFileSync(__filename, "utf8"))),
    selectedPreset: PRESET, selections
  };
  const lines = ["# 第 3 幕沙之聚合体：定向预设诊断", "", "**仅作定向诊断，不补入自然成长整局或随机矩阵统计。** 这些种子已在正式单场验证集中计数，本次重跑不是新增独立样本。", "", "目的：整局独立验证未自然覆盖第 3 幕的 sand_aggregate，因此从既有单场验证报告中按清单顺序，各挑选一个 2/3/4 人、无等级强化、遭遇该 preset 的固定种子重跑。", "", "假设：预设角色等级与敌方等级相同、满血、预设武器等级与升级选择、BASIC_POLICY，不代表自然成长或真人策略。", "", `来源：[正式单场报告](matrix-formal.md)；原始记录 \`${SOURCE}\`（证据压缩包内同名文件）。来源文件 SHA256：\`${sourceInfo.sha256}\`。`, `来源源码 SHA256：\`${sourceInfo.sourceHash}\`；本次源码 SHA256：\`${provenance.sourceHash}\`；本次配置 SHA256：\`${provenance.configHash}\`。`, `诊断脚本 SHA256（与工具相同文本归一规则）：\`${report.diagnosticScriptHash}\`。`, "", "|人数|来源种子|队伍|敌方/我方等级|结局|回合|原始/最终分|评价|核心结果与来源一致|", "|---:|---|---|---|---|---:|---|---|---|"];
  for (const { replay: r, sourceSeed, matchesSourceCore } of selections) lines.push(`|${r.size}|${sourceSeed}|${r.party.join("、")}|${r.enemyLevel}/${r.heroLevel}|${r.outcome}|${r.turns}|${r.raw}/${r.score}|${r.grade}|${matchesSourceCore ? "是" : "否"}|`);
  lines.push("", "完整阵容、实际单位等级、武器等级、地形、天气、终态、源记录身份与执行配置见同名前缀 JSON/CSV。自然成长整局第 3 幕对应首领的覆盖缺口仍然保留；这里只确认选定预设场景可以重放。", "");
  fs.writeFileSync(B.reportPath(TARGET + ".json"), JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(B.reportPath(TARGET + ".csv"), B.csv(selections.map(x => ({ sourceScenarioId: x.sourceScenarioId, sourceSeed: x.sourceSeed, sourceSet: x.sourceSet, matchesSourceCore: x.matchesSourceCore, ...x.replay }))));
  fs.writeFileSync(B.reportPath(TARGET + ".md"), lines.join("\n"));
  console.log(JSON.stringify({ status: report.status, file: TARGET + ".md", results: selections.map(x => ({ size: x.replay.size, sourceSeed: x.sourceSeed, outcome: x.replay.outcome, matchesSourceCore: x.matchesSourceCore })) }, null, 2));
  return report.status === "ERROR" ? 1 : 0;
}
if (require.main === module) { try { process.exitCode = main(); } catch (e) { console.error(e.stack || String(e)); process.exitCode = 1; } }
module.exports = { main };
