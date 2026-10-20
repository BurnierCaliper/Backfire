// 克制表浮层（matchup-ui.js）：用 matchup.js 的真数据（PR #81）测渲染、天气改过的格子高亮、整行增减伤、表头、冻土跟着选中单位、联机
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const H = require("./headless");
const ROOT = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

function setup(opt) {
  const c = H.load();
  if (opt && opt.noData) vm.runInContext("matchupChart = undefined; matchupForState = undefined; try { Rogue.matchupChart = undefined; Rogue.matchupForState = undefined; } catch (e) {}", c);
  vm.runInContext(read("icons.js"), c, { filename: "icons.js" });
  vm.runInContext(read("matchup-ui.js"), c, { filename: "matchup-ui.js" });
  return c;
}
const cell = (html, i, j) => (html.match(new RegExp(`<td class="mu-cell[^"]*" data-mu-cell="${i}:${j}"[\\s\\S]*?</td>`)) || [""])[0];
/** 战场：1 区冻土、2 区普通；甲在 1 区，乙在 2 区，飞在 1 区但飞行 */
function battle(c, weather, extra) {
  vm.runInContext(`state.weather = ${JSON.stringify(weather)}; state.phaseStep = ${(extra && extra.phaseStep) || 0}; state.apocalypse = ${!!(extra && extra.apocalypse)};
    state.fields = { 1: Object.assign(emptyField(), { ice: true }), 2: emptyField() };
    state.units = [{ id: "a", name: "甲", zone: 1 }, { id: "b", name: "乙", zone: 2 }, { id: "f", name: "飞", zone: 1, flying: true }];`, c);
}

test("没有数据接口时不出按钮、不自己算", () => {
  const c = setup({ noData: true });
  assert.equal(c.MatchupUI.available(), false);
  assert.equal(c.MatchupUI.localChart(), null);
  assert.match(c.MatchupUI.html(null), /暂时没有数据/);
  assert.match(read("game.html"), /id="g-matchup"[^>]*hidden/);
  assert.ok(read("game.html").indexOf('src="matchup.js"') < read("game.html").indexOf('src="matchup-ui.js"'), "matchup.js 先加载");
});

test("常态（真数据）：7 × 5，火对肉体克制、对装甲被克制、对护盾普通；没有高亮，整行都是 ±0", () => {
  const c = setup(), M = c.MatchupUI;
  battle(c, "none"); c.GAME = { actorId: "b" };
  const html = M.html(M.localChart());
  assert.equal((html.match(/data-mu-cell=/g) || []).length, 35);
  assert.match(cell(html, 0, 0), /mu-adv[\s\S]*\+50%/);
  assert.match(cell(html, 0, 1), /mu-dis[\s\S]*−25%/);
  assert.match(cell(html, 0, 2), /mu-neu/);
  assert.match(cell(html, 0, 1), /title="火 → 装甲：被克制 −25%"/);
  assert.doesNotMatch(html, /mu-cell[^"]*changed/);
  assert.doesNotMatch(html, /mu-pct|整行增减伤/, "整行一栏去掉了");
  assert.match(html, /<p class="mu-legend"><span class="mu-adv">克制<\/span><span class="mu-dis">被克制<\/span><span class="mu-neu">普通<\/span><\/p>/);
  assert.match(html, /<th class="mu-row mu-e-fire"><svg class="eicon"[^>]*aria-label="火"/, "行头带属性图标");
  assert.match(html, /<th class="mu-row mu-e-harmonic"><svg[\s\S]*?<span>谐波<\/span>/);
  assert.doesNotMatch(html, /谐振/);
  assert.match(html, /天气 常态/);
  assert.doesNotMatch(html, /天气效果 ×|冻土（/);
});

test("微光（真数据）：16 格反转高亮「原 → 现」带原因；能量整行 +25%；notes", () => {
  const c = setup(), M = c.MatchupUI;
  battle(c, "glow"); c.GAME = { actorId: "b" };
  const chart = M.localChart();
  assert.equal(chart.changed.length, 16);
  const html = M.html(chart);
  assert.equal((html.match(/mu-cell[^"]*changed/g) || []).length, 16);
  assert.match(cell(html, 0, 0), /<s>\+50%<\/s><span class="mu-arrow">→<\/span><b>−50%<\/b>/);
  assert.match(cell(html, 0, 0), /微光：克制关系反转（能量除外）/);
  assert.match(cell(html, 0, 0), /mu-dis/, "改过的格子照常按现在的克制关系上色");
  assert.match(html, /微光伤害修正：能量 \+25%/, "整行增减伤写进 notes");
  assert.match(html, /微光：击破 −1/);
  assert.match(M.html(chart, { cell: [0, 0] }), /class="mu-detail"[\s\S]*被克制 −50%（原来 克制 \+50%）/);
});

test("雪天 + 冻土跟着选中单位：甲（冻土区）有冻土；乙（普通区）、飞（飞行）没有", () => {
  const c = setup(), M = c.MatchupUI;
  battle(c, "snow");
  c.GAME = { actorId: "a" };
  let html = M.html(M.localChart());
  assert.match(html, /冻土（甲 所在区域）/);
  assert.match(cell(html, 3, 0), /changed[\s\S]*冻土：冰易伤不受天气影响[\s\S]*\+25%/);
  assert.match(html, /雪天伤害修正：火、酸 −25%；冰、物理 \+25%/);
  assert.match(html, /冻土：冰属性对这一区的目标固定易伤/);
  c.GAME.actorId = "b"; assert.doesNotMatch(M.html(M.localChart()), /冻土（/);
  c.GAME.actorId = "f"; assert.doesNotMatch(M.html(M.localChart()), /冻土（/, "飞行单位不吃冻土");
});

test("相位 / 末日：表头写阶段（用返回的 phaseStep）和 ×2", () => {
  const c = setup(), M = c.MatchupUI;
  battle(c, "phase", { phaseStep: 2, apocalypse: true }); c.GAME = { actorId: "b" };
  const html = M.html(M.localChart());
  assert.match(html, /天气 相位 · 波峰/);
  assert.match(html, /天气效果 ×2/);
  assert.match(html, /相位波峰：伤害 \+100%/);
  assert.match(M.html(M.chartWith("phase", { phaseStep: 0 })), /波谷/);
  assert.doesNotMatch(M.html(M.chartWith("snow", {})), /· (波谷|平缓|波峰)/, "不是相位不写阶段");
});

test("联机玩家：拿房主 matchup 的 opt，按自己选中单位的区改冻土，本机 matchupChart 重算", () => {
  const c = setup(), M = c.MatchupUI;
  battle(c, "snow"); c.GAME = { actorId: "b" };
  const host = JSON.parse(JSON.stringify(M.localChart()));   // 房主按他当前行动的乙算：没有冻土
  assert.equal(host.field, null);
  const view = { weather: "snow", fields: { 1: { ice: true }, 2: {} }, units: [{ id: "a", name: "甲", zone: 1 }, { id: "f", name: "飞", zone: 1, flying: true }] };
  const mine = M.viewChart(host, view, "a");
  assert.deepEqual(JSON.parse(JSON.stringify(mine.field)), { ice: true });
  assert.match(M.html(mine), /冻土（甲 所在区域）/);
  assert.equal(M.viewChart(host, view, "f").field, null);
  assert.equal(M.viewChart(host, view, null), host, "没选单位就照用房主的");
  const ol = read("online-ui.js");
  assert.match(ol, /view\.matchup \|\| view\.packet\?\.matchup/);
  assert.match(ol, /MatchupUI\.viewChart\(m, st, selectedActor \|\| \(mine \? cur : null\)\)/);
  assert.match(ol, /screen === "battle" && matchupOf\(\) \? button\("克制表", "matchup"\)/);
  assert.doesNotMatch(M.html(mine), /shp|坚毅/);
});

test("相位效果在 notes 里：数据写在 notes 或整行 pct 里都看得到，不重复", () => {
  const c = setup(), M = c.MatchupUI;
  const base = M.chartWith("phase", { phaseStep: 2 });
  assert.equal(M.allNotes(base).filter(n => /相位/.test(n)).length, 1);
  // 模拟 #81 之后的数据：相位 ±50% 进 rows[].pct，notes 里没有伤害那句
  const moved = Object.assign({}, base, { notes: [], rows: base.rows.map(r => Object.assign({}, r, { pct: 0.5, pctReason: "相位波峰：伤害 +50%" })) });
  assert.match(M.allNotes(moved).join("\n"), /相位伤害修正：火、酸、电、冰、能量、物理、谐波 \+50%/);
  const both = Object.assign({}, moved, { notes: ["相位波峰：伤害 +50%，击破 +1"] });
  assert.equal(M.allNotes(both).length, 1, "notes 已经写了就不再补");
  assert.equal(M.allNotes(Object.assign({}, base, { rows: [{ id: "harmonic", name: "谐振", pct: 0.25, pctReason: "x" }], notes: [] }))[0], "相位伤害修正：谐波 +25%");
});

test("样式：没有格子边框、天气改过的格子不另上高亮色；窗口放大", () => {
  const css = read("matchup.css");
  assert.doesNotMatch(css, /outline|\.changed/);
  assert.match(css, /\.mu-grid td \{[^}]*border: 0/);
  assert.match(css, /\.mu-card \{ width: min\(1040px/);
});

test("样式：和工坊同一套浮层；悬停单位浮在天气之上的规则没动", () => {
  assert.match(read("matchup-ui.js"), /class="mu-card ovl-card"/);
  assert.match(read("workshop.css"), /\[data-weather\] \.ovl-card::before/);
  assert.match(read("weather-fx.css"), /\.g-field \.unit-wrap:hover, \.g-field \.unit-wrap:focus-within, \.g-field \.unit-wrap\.is-hover \{ z-index: 7; \}/);
  assert.ok(read("game.html").includes("matchup.css"));
});
