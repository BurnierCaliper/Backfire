// 克制表浮层（matchup-ui.js）：渲染、天气改过的格子高亮、整行增减伤、表头、联机读 view.matchup
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const H = require("./headless");
const ROOT = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

/* 和 matchup.js · matchupChart 同一份返回结构（数据接口在 feat/matchup-chart，这里只用来测界面） */
const COLS = [["flesh", "肉体"], ["armor", "装甲"], ["shield", "护盾"], ["sand", "沙尘"], ["spirit", "星灵"]];
const ROWS = [["fire", "火焰"], ["acid", "酸液"], ["electric", "电击"], ["ice", "寒冰"], ["energy", "能量"], ["physical", "物理"], ["harmonic", "谐振"]];
function fakeChart(weather, opt) {
  opt = opt || {};
  const glow = weather === "glow", ice = opt.field && opt.field.ice;
  const kindOf = v => v > 0 ? "adv" : v < 0 ? "dis" : "neu";
  const cells = ROWS.map(([r], i) => COLS.map(([c], j) => {
    const base = (i + j) % 3 === 0 ? 0.5 : (i + j) % 3 === 1 ? -0.25 : 0;
    let value = glow ? -base : base, reason = glow && base ? "微光：克制反转" : "";
    if (ice && r === "ice") { value = 0.25; reason = "冻土：对冰 25% 易伤"; }
    return { row: r, col: c, base, value, kind: kindOf(value), kindId: kindOf(value), baseKind: kindOf(base), changed: value !== base, reason };
  }));
  const x = Number(opt.envX) || 1;
  return {
    weather, weatherName: { none: "常态", glow: "微光", snow: "雪天", phase: "相位" }[weather] || weather, envX: x,
    cols: COLS.map(([id, name]) => ({ id, name })),
    rows: ROWS.map(([id, name]) => ({ id, name, pct: weather === "snow" && (id === "ice" || id === "physical") ? 0.25 * x : 0, pctBase: 0, pctReason: weather === "snow" ? "雪天：寒冰、物理 +25%" : "" })),
    cells, changed: cells.flat().filter(c => c.changed).map(c => ({ row: c.row, col: c.col })),
    notes: weather === "glow" ? ["微光：属性克制全部反转。"] : []
  };
}
function setup(withChart) {
  const c = H.load();
  if (withChart) c.matchupChart = fakeChart;
  vm.runInContext(read("matchup-ui.js"), c, { filename: "matchup-ui.js" });
  return c;
}
const cell = (html, i, j) => (html.match(new RegExp(`<td class="mu-cell[^"]*" data-mu-cell="${i}:${j}"[\\s\\S]*?</td>`)) || [""])[0];

test("没有数据接口时不出按钮、不自己算", () => {
  const c = setup(false);
  assert.equal(c.MatchupUI.available(), false);
  assert.equal(c.MatchupUI.localChart({ weather: "none", opt: {} }), null);
  assert.match(c.MatchupUI.html(null), /暂时没有数据/);
  assert.match(read("game.html"), /id="g-matchup"[^>]*hidden/);
});

test("常态：7 行属性 × 5 列血量层，按克制 / 抵抗 / 普通上色，没有高亮", () => {
  const c = setup(true), M = c.MatchupUI;
  const html = M.html(M.localChart({ weather: "none", opt: { envX: 1 } }));
  assert.equal((html.match(/data-mu-cell=/g) || []).length, 35);
  assert.equal((html.match(/<th class="mu-row/g) || []).length, 7);
  assert.equal((html.match(/<th class="mu-col/g) || []).length, 5);
  assert.match(cell(html, 0, 0), /mu-adv/);
  assert.match(cell(html, 0, 1), /mu-dis/);
  assert.match(cell(html, 0, 2), /mu-neu/);
  assert.doesNotMatch(html, /mu-cell[^"]*changed/);
  assert.match(html, /天气 常态/);
  assert.doesNotMatch(html, /天气效果 ×/);
  assert.equal(M.pct(0.5), "+50%"); assert.equal(M.pct(-0.25), "−25%"); assert.equal(M.pct(0), "±0");
});

test("微光：改过的格子高亮，写「原 → 现」，悬停 / 点开有原因；notes 列在下面", () => {
  const c = setup(true), M = c.MatchupUI;
  const chart = M.localChart({ weather: "glow", opt: {} });
  let html = M.html(chart);
  const x = cell(html, 0, 0);
  assert.match(x, /changed/);
  assert.match(x, /<s>\+50%<\/s><span class="mu-arrow">→<\/span><b>−50%<\/b>/);
  assert.match(x, /title="[^"]*微光：克制反转/);
  assert.doesNotMatch(cell(html, 0, 2), /changed/, "原来 0 的没变");
  assert.match(html, /<ul class="mu-notes"><li>微光：属性克制全部反转。<\/li>/);
  html = M.html(chart, { cell: [0, 0] });
  assert.match(html, /class="mu-detail"[\s\S]*原来 克制 \+50%[\s\S]*微光：克制反转/);
});

test("雪天 + 冻土 + 末日：整行增减伤写原 → 现、表头有冻土和 ×2", () => {
  const c = setup(true), M = c.MatchupUI;
  const html = M.html(M.localChart({ weather: "snow", opt: { envX: 2, field: { ice: true } }, unitName: "柯尔特" }));
  assert.match(html, /天气 雪天/);
  assert.match(html, /天气效果 ×2/);
  assert.match(html, /冻土（柯尔特 所在区域）/);
  const iceRow = html.match(/<th class="mu-row mu-e-ice">寒冰<\/th><td class="mu-pct changed"[^>]*><s>±0<\/s> → <b>\+50%<\/b>/);
  assert.ok(iceRow, "寒冰整行 ±0 → +50%");
  assert.match(cell(html, 3, 1), /冻土：对冰 25% 易伤/);
});

test("相位：表头写阶段", () => {
  const c = setup(true), M = c.MatchupUI;
  assert.match(M.html(M.localChart({ weather: "phase", opt: { phaseStep: 2 } })), /天气 相位 · 波峰/);
  assert.match(M.html(M.localChart({ weather: "phase", opt: { phaseStep: 0 } })), /波谷/);
});

test("本机战斗参数：冻土跟着选中单位所在区域（飞行不算），倍数用 envMult", () => {
  const c = setup(true), M = c.MatchupUI;
  vm.runInContext(`state.weather = "snow"; state.phaseStep = 1; state.apocalypse = true;
    state.fields = { 1: Object.assign(emptyField(), { ice: true }), 2: emptyField() };
    state.units = [{ id: "a", name: "甲", zone: 1 }, { id: "b", name: "乙", zone: 2 }, { id: "f", name: "飞", zone: 1, flying: true }];`, c);
  c.GAME = { actorId: "a" };
  let o = M.battleOpts();
  assert.equal(o.weather, "snow"); assert.equal(o.opt.phaseStep, 1); assert.equal(o.opt.envX, 2); assert.equal(o.opt.field.ice, true);
  c.GAME.actorId = "b"; assert.equal(M.battleOpts().opt.field.ice, false);
  c.GAME.actorId = "f"; assert.equal(M.battleOpts().opt.field.ice, false, "冻土对飞行单位无效");
});

test("联机玩家：读房主发来的 view.matchup，自己不算；战斗画面才有按钮", () => {
  const ol = read("online-ui.js");
  assert.match(ol, /const matchupOf = \(\) => view\.matchup \|\| view\.packet\?\.matchup \|\| null;/);
  assert.match(ol, /screen === "battle" && matchupOf\(\) \? button\("克制表", "matchup"\)/);
  assert.match(ol, /MatchupUI\.toggle\(\(\) => matchupOf\(\)\)/);
  const c = setup(false);   // 玩家端没有 matchupChart 也能画
  const html = c.MatchupUI.html(fakeChart("glow", {}));
  assert.match(html, /mu-cell[^"]*changed/);
  assert.doesNotMatch(html, /shp|坚毅/);
});

test("样式：和工坊同一套浮层（.ovl-card + 天气 ::before）；悬停单位浮在天气之上的规则没动", () => {
  assert.match(read("matchup-ui.js"), /class="mu-card ovl-card"/);
  assert.match(read("workshop.css"), /\[data-weather\] \.ovl-card::before/);
  assert.match(read("weather-fx.css"), /\.g-field \.unit-wrap:hover, \.g-field \.unit-wrap:focus-within, \.g-field \.unit-wrap\.is-hover \{ z-index: 7; \}/);
  const html = read("game.html");
  assert.ok(html.indexOf("matchup.css") > 0 && html.indexOf("matchup-ui.js") > 0);
});
