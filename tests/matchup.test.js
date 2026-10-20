// 克制表（matchup.js · matchupChart / matchupForState；online-game.js 的 matchup；online-view.js 投影）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");
const V = require("../online-view");

const c = H.load();
const J = v => JSON.parse(JSON.stringify(v));
const chart = (w, o) => J(vm.runInContext(`matchupChart(${JSON.stringify(w)}, ${JSON.stringify(o || {})})`, c));
const cell = (m, r, col) => m.cells[m.rows.findIndex(x => x.id === r)][m.cols.findIndex(x => x.id === col)];
// 对照 engine.js 原函数
const mod = (el, layer, w, field, envX) => vm.runInContext(`chartMod(${JSON.stringify(el)}, ${JSON.stringify(layer)}, ${JSON.stringify(w)}, ${JSON.stringify(field || null)}, ${JSON.stringify(w === "acid")}, ${envX || 1})`, c);
const wpct = (w, el) => vm.runInContext(`weatherDamagePct(${JSON.stringify(w)}, ${JSON.stringify(el)})`, c);
const WEATHERS = ["none", "heat", "snow", "acid", "thunder", "glow", "sand", "phase"];

test("格式：7 行属性 × 5 列血量层，表头天气中文名；常态下没有变化的格子", () => {
  const m = chart("none");
  assert.equal(m.weatherName, "常态");
  assert.deepEqual(m.rows.map(r => r.id), ["fire", "acid", "electric", "ice", "energy", "physical", "harmonic"]);
  assert.deepEqual(m.cols.map(x => x.name), ["肉体", "装甲", "护盾", "沙尘", "星灵"]);
  assert.equal(m.cells.length, 7); assert.ok(m.cells.every(r => r.length === 5));
  assert.deepEqual(m.changed, []);
  const f = cell(m, "fire", "flesh");
  assert.deepEqual([f.base, f.value, f.kind, f.kindId, f.changed], [0.5, 0.5, "克制", "adv", false]);
  assert.equal(cell(m, "fire", "armor").kind, "被克制");
  assert.equal(cell(m, "ice", "flesh").kind, "普通");
});

for (const w of WEATHERS) {
  test(`天气 ${w}：每一格和每一行都和 engine.js 的 chartMod / weatherDamagePct 一致；变了的格子都有原因`, () => {
    const m = chart(w);
    assert.equal(m.weather, w);
    m.rows.forEach((r, i) => {
      assert.equal(r.pct, wpct(w, r.id));
      assert.equal(!!r.pctReason, !!r.pct);
      m.cols.forEach((col, j) => {
        const x = m.cells[i][j];
        assert.equal(x.base, mod(r.id, col.id, "none"));
        assert.equal(x.value, mod(r.id, col.id, w) + 0);
        assert.equal(x.changed, x.base !== x.value);
        if (x.changed) assert.ok(x.reason, `${r.id}/${col.id}`);
      });
    });
    assert.equal(m.changed.length, m.cells.flat().filter(x => x.changed).length);
  });
}

test("微光：能量以外的克制反转（火打肉体 +50% → −50%，原因写明）；能量不变；击破说明在 notes", () => {
  const m = chart("glow");
  const f = cell(m, "fire", "flesh");
  assert.deepEqual([f.base, f.value, f.kind, f.baseKind], [0.5, -0.5, "被克制", "克制"]);
  assert.match(f.reason, /微光：克制关系反转/);
  assert.equal(cell(m, "energy", "spirit").changed, false);
  assert.ok(m.notes.some(n => /微光：击破/.test(n)));
});

test("酸雨：酸、冰以外打装甲 +25%；酸打装甲不变", () => {
  const m = chart("acid");
  const p = cell(m, "physical", "armor");
  assert.deepEqual([p.base, p.value, p.changed], [-0.25, 0, true]);
  assert.match(p.reason, /酸雨/);
  assert.equal(cell(m, "acid", "armor").changed, false);
  assert.equal(cell(m, "ice", "armor").changed, false);
});

test("冻土：冰固定易伤 +25%，雪天 / 微光也不改；恶劣环境翻倍到 +50%", () => {
  for (const w of ["none", "snow", "glow"]) {
    const x = cell(chart(w, { field: { ice: true } }), "ice", "spirit");
    assert.equal(x.value, 0.25); assert.equal(x.reason, "冻土：冰易伤不受天气影响");
  }
  assert.equal(cell(chart("none", { field: { ice: true }, envX: 2 }), "ice", "flesh").value, 0.5);
});

test("恶劣环境 / 末日：整行天气修正翻倍；相位按阶段给说明", () => {
  assert.equal(chart("heat", { envX: 2 }).rows.find(r => r.id === "fire").pct, 0.5);
  assert.ok(chart("phase", { phaseStep: 0 }).notes.some(n => /波谷/.test(n)));
  assert.ok(chart("phase", { phaseStep: 2 }).notes.some(n => /波峰/.test(n)));
  assert.ok(chart("phase", { phaseStep: 1 }).notes.some(n => /平稳/.test(n)));
  assert.equal(chart("bogus").weather, "none");
});

test("matchupForState：按行动单位所在区的冻土、个人恶劣环境、隔离区；飞行不吃冻土；附 opt", () => {
  const st = { weather: "snow", phaseStep: 0, apocalypse: false, fields: { 1: { ice: true }, 2: { isolate: true } },
    units: [{ id: "a", name: "柯尔特", zone: 1 }, { id: "b", zone: 1, flying: true }, { id: "c", zone: 2 }, { id: "d", zone: 1, harshEnv: true }] };
  const run = id => J(vm.runInContext(`matchupForState(${JSON.stringify(st)}, ${JSON.stringify(id)})`, c));
  const a = run("a");
  assert.deepEqual(a.opt.field, { ice: true }); assert.equal(cell(a, "ice", "flesh").value, 0.25); assert.equal(a.unitId, "a"); assert.equal(a.unitName, "柯尔特"); assert.equal(a.zone, 1); assert.deepEqual(a.field, { ice: true }); assert.equal(a.phaseStep, null);
  assert.equal(run("b").opt.field, undefined);
  assert.equal(run("c").weather, "none");
  assert.equal(run("d").envX, 2);
  const none = run(null);
  assert.equal(none.opt.field, undefined); assert.equal(none.weather, "snow"); assert.equal(none.unitName, null); assert.equal(none.field, null);
  assert.equal(c.Rogue.matchupChart("glow").weatherName, "微光");
});

test("联机投影：packet.matchup 原样发给玩家（任何画面都带），去掉坚毅字段；不是对象就给 null", () => {
  const m = chart("glow");
  const out = V.projectPacket({ type: "result", matchup: Object.assign({ shp: 3 }, m) }, { recipientId: "p1", gmId: "host" });
  assert.equal(out.matchup.weatherName, "微光");
  assert.equal(out.matchup.cells.length, 7);
  assert.equal(out.matchup.shp, undefined);
  assert.equal(V.projectPacket({ type: "result", matchup: "x" }, { recipientId: "p1", gmId: "host" }).matchup, null);
  assert.equal(V.projectPacket({ type: "result" }, { recipientId: "p1", gmId: "host" }).matchup, undefined);
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "online-game.js"), "utf8");
  assert.match(src, /matchup: matchupNow\(\), rogue:/, "每一包（探索 / 战斗）都带");
  assert.match(src, /matchup: isHost\(\) \? matchupNow\(\) : remote\?\.matchup/, "getView().matchup");
});

test("联机：房主算的 matchup 经投影后带 phaseStep、field.ice、unitId / unitName / zone，没有坚毅字段", () => {
  const st = { weather: "phase", phaseStep: 2, fields: { 3: { ice: true } },
    units: [{ id: "u7", name: "Helumica", zone: 3, shp: 5, shpMax: 9, upOnShp: true, layers: [{ type: "flesh", current: 1, max: 9 }] }] };
  const m = J(vm.runInContext(`matchupForState(${JSON.stringify(st)}, "u7")`, c));
  const out = V.projectPacket({ type: "result", matchup: m }, { recipientId: "p1", gmId: "host" }).matchup;
  assert.equal(out.phaseStep, 2);
  assert.deepEqual(out.field, { ice: true });
  assert.deepEqual(out.opt, { envX: 1, phaseStep: 2, field: { ice: true } });
  assert.deepEqual([out.unitId, out.unitName, out.zone], ["u7", "Helumica", 3]);
  assert.ok(out.notes.some(n => /波峰/.test(n)) && out.notes.some(n => /冻土/.test(n)));
  assert.ok(!/shp|坚毅/i.test(JSON.stringify(out)));
});

test("页面：game.html 在 engine.js 之后、app.js 之前载入 matchup.js；online-game.js 也在它之后", () => {
  const html = require("fs").readFileSync(require("path").join(__dirname, "..", "game.html"), "utf8");
  const at = f => html.indexOf(`<script src="${f}"></script>`);
  assert.ok(at("matchup.js") > at("engine.js") && at("engine.js") >= 0);
  assert.ok(at("matchup.js") < at("app.js"));
  assert.ok(at("matchup.js") < at("online-game.js"));
});
