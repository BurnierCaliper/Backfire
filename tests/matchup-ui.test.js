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
  // 入口在暂停页面里（#298）：顶栏的 #g-matchup / #r-matchup 去掉了，菜单那一项也要 available() 才显示
  assert.doesNotMatch(read("game.html"), /id="[gr]-matchup"/);
  assert.match(read("matchup-ui.js"), /PauseMenu\.register\(\{ id: "matchup", visible: \(\) => available\(\) &&/);
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
  // 16 格克制反转 + 能量整行 +25% 的 5 格（按 base+pctBase 对 value+pct 比）
  assert.equal((html.match(/mu-cell[^"]*changed/g) || []).length, 21);
  assert.match(cell(html, 4, 0), /<s>±0<\/s><span class="mu-arrow">→<\/span><b>\+25%<\/b>/, "能量 → 肉体：整行 +25%");
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
  assert.match(html, /冻土 · 1区/);
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
  assert.match(M.html(mine), /冻土 · 1区/);
  assert.equal(M.viewChart(host, view, "f").field, null);
  assert.equal(M.viewChart(host, view, null), host, "没选单位就照用房主的");
  const ol = read("online-ui.js");
  assert.match(ol, /view\.matchup \|\| view\.packet\?\.matchup/);
  assert.match(ol, /MatchupUI\.viewChart\(m, st, selectedActor \|\| \(mine \? cur : null\)\)/);
  // 入口在暂停页面里（#298）：舞台工具栏不再有「克制表」按钮
  assert.match(ol, /register\(\{ id: "matchupOnline", config: "matchup", visible: \(\) => !!\(view\.active && !view\.isHost && view\.screen === "battle" && matchupOf\(\)\)/);
  assert.doesNotMatch(ol, /button\("克制表", "matchup"\)/);
  assert.doesNotMatch(M.html(mine), /shp|坚毅/);
});

test("相位波峰（#81 f084d7d：±50% 在整行 pct）：格子本身 changed=false 也显示「原 → 现」，原因在 notes", () => {
  const c = setup(), M = c.MatchupUI;
  const chart = M.chartWith("phase", { phaseStep: 2 });
  assert.ok(chart.cells.flat().every(x => !x.changed), "数据层的格子没变");
  const html = M.html(chart);
  assert.equal((html.match(/mu-cell[^"]*changed/g) || []).length, 35);
  assert.match(cell(html, 0, 0), /<s>\+50%<\/s><span class="mu-arrow">→<\/span><b>\+100%<\/b>/);
  assert.match(cell(html, 0, 1), /title="[^"]*相位波峰：全属性 \+50%/);
  assert.match(html, /<ul class="mu-notes">[\s\S]*相位波峰：伤害 \+50%，击破 \+1/);
  assert.equal(M.allNotes(chart).filter(n => /相位/.test(n)).length, 1, "不重复");
  // 平稳期没有修正
  assert.doesNotMatch(M.html(M.chartWith("phase", { phaseStep: 1 })), /mu-cell[^"]*changed/);
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

/* ---------- #83：选中单位作为受击者的个体表 ---------- */
test("选中霜结单位 + 雪天：标题写单位名，霜结 −10% 进格子（原 → 现），原因在悬停/详情；冻土标区写进 notes", () => {
  const c = setup(), M = c.MatchupUI;
  battle(c, "snow");
  vm.runInContext(`state.units[0].self = "frost"; state.fields[3] = Object.assign(emptyField(), { ice: true });`, c);
  c.GAME = { actorId: "a" };
  const ch = M.localChart();
  M.state.cell = [0, 0];
  const html = M.html(ch);
  M.state.cell = null;
  assert.match(html, /<span class="mu-who">甲 挨打时<\/span>/);
  assert.match(html, /mu-ice">冻土 · 1区/);
  assert.match(html, /<li>冻土：1区、3区<\/li>/);
  assert.match(cell(html, 0, 0), /<s>\+50%<\/s>[\s\S]*<b>\+15%<\/b>/, "火 → 肉体：+50% 雪天 −25% 霜结 −10%");
  assert.match(cell(html, 0, 0), /title="[^"]*雪天霜结/);
  assert.match(html, /<p class="mu-detail">[\s\S]*雪天霜结/);
  // 乙不是霜结：只有雪天 −25%
  c.GAME = { actorId: "b" };
  const hb = M.html(M.localChart());
  assert.match(hb, /乙 挨打时/);
  assert.match(cell(hb, 0, 0), /<b>\+25%<\/b>/);
  assert.doesNotMatch(hb, /雪天霜结/);
});

test("选中熔融单位：冰行 ×2 算进「原 → 现」，multReason 在悬停/详情；物理打装甲强制 +50%", () => {
  const c = setup(), M = c.MatchupUI;
  battle(c, "none");
  vm.runInContext(`state.units[1].instant = { melt: true };`, c);
  c.GAME = { actorId: "b" };
  const ch = M.localChart();
  const ice = ch.rows.findIndex(r => r.id === "ice"), phys = ch.rows.findIndex(r => r.id === "physical");
  const x = ch.cells[ice][0];
  const want = M.pct((1 + x.value + ch.rows[ice].pct) * 2 - 1);
  M.state.cell = [ice, 0];
  const html = M.html(ch);
  M.state.cell = null;
  assert.ok(cell(html, ice, 0).includes(`<b>${want}</b>`), want);
  assert.match(cell(html, ice, 0), /<s>[\s\S]*title=|title="[^"]*熔融：冰属性攻击伤害 ×2/);
  assert.match(cell(html, ice, 0), /<s>/);
  assert.match(html, /<p class="mu-detail">[\s\S]*熔融：冰属性攻击伤害 ×2/);
  assert.match(cell(html, phys, 1), /<s>−25%<\/s>[\s\S]*<b>\+50%<\/b>/);
});

test("联机玩家：读 packet.matchup.units[选中单位]，没有才退回顶层表", () => {
  const c = setup(), M = c.MatchupUI;
  battle(c, "snow");
  vm.runInContext(`state.units[0].self = "frost";`, c);
  const m = vm.runInContext(`(() => { const m = matchupForState(state, null, { defender: false }); m.units = matchupUnitCharts(state); return JSON.parse(JSON.stringify(m)); })()`, c);
  const st = { weather: "snow", fields: { 1: { ice: true } }, units: [{ id: "a", name: "甲", zone: 1 }, { id: "z", name: "无", zone: 2 }] };
  const a = M.viewChart(m, st, "a");
  assert.equal(a.defender, true);
  assert.match(M.html(a), /甲 挨打时[\s\S]*雪天霜结/);
  assert.match(M.html(a), /冻土：1区/);
  // 不在 units 里的：退回顶层（重算冻土）；没选中：顶层
  assert.ok(!M.viewChart(m, st, "z").defender);
  assert.equal(M.viewChart(m, st, null), m);
});
