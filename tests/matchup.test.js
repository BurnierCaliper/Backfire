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
      assert.equal(r.pct, wpct(w, r.id));   // 没传 phaseStep：相位不加整行修正
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
  assert.equal(a.opt.field.ice, true); assert.equal(a.opt.field.label, "冻土：1区"); assert.equal(cell(a, "ice", "flesh").value, 0.25); assert.equal(a.unitId, "a"); assert.equal(a.unitName, "柯尔特"); assert.equal(a.zone, 1); assert.deepEqual(a.field, { ice: true, zone: 1, label: "冻土：1区" }); assert.deepEqual(a.iceZones, [1]); assert.equal(a.iceLabel, "冻土：1区"); assert.equal(a.phaseStep, null);
  { const b = run("b"); assert.equal(b.opt.field, undefined); assert.deepEqual(b.iceZones, [1]); }
  assert.equal(J(vm.runInContext(`matchupForState(${JSON.stringify(st)}, "b", { defender: false })`, c)).opt.field, undefined);
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
  assert.deepEqual(out.field, { ice: true, zone: 3, label: "冻土：3区" });
  assert.deepEqual([out.opt.envX, out.opt.phaseStep, out.opt.field.ice], [1, 2, true]);
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

test("相位：波谷全属性 −50%、波峰 +50%（恶劣环境 ×2），和天气修正加算进每行 pct；平稳期不变；notes 保留", () => {
  const cases = [[0, 1, -0.5, /相位波谷：全属性 −50%/], [2, 1, 0.5, /相位波峰：全属性 \+50%/], [0, 2, -1, /相位波谷：全属性 −100%/], [2, 2, 1, /相位波峰：全属性 \+100%/]];
  for (const [step, envX, v, re] of cases) {
    const m = chart("phase", { phaseStep: step, envX });
    m.rows.forEach(r => {
      assert.equal(r.pct, v + wpct("phase", r.id) * envX);
      assert.notEqual(r.pct, r.pctBase);
      assert.match(r.pctReason, re);
    });
    assert.ok(m.notes.some(n => (step ? /波峰/ : /波谷/).test(n)));
  }
  const mid = chart("phase", { phaseStep: 1 });
  assert.ok(mid.rows.every(r => r.pct === 0 && r.pctReason === ""));
  assert.ok(mid.notes.some(n => /平稳/.test(n)));
  assert.ok(chart("phase").rows.every(r => r.pct === 0));
  // 只有相位天气才加：别的天气传了 phaseStep 也不加
  assert.ok(chart("heat", { phaseStep: 2 }).rows.every(r => r.pct === wpct("heat", r.id)));
});

test("相位：和真实结算一致（resolveAttack 加算百分比合计里的相位那一项）", () => {
  const H2 = require("./headless").load();
  const go = step => vm.runInContext(`(() => { const t = { id: "t", name: "t", layers: [{ type: "flesh", current: 999, max: 999 }], def: 0, defMax: 0 };
    return resolveAttack({ attacker: null, target: t, atk: 10, mult: 1, flat: 0, diceValue: 0, element: "ice", baseBreak: 0, hits: 1, flags: {}, weather: "phase", phaseStep: ${step}, zoneMode: 2, targetField: {}, attackerField: {} }).log.join("\\n"); })()`, H2);
  assert.match(go(2), /相位波峰：伤害 \+50%/);
  assert.match(go(0), /相位波谷：伤害 −50%/);
  assert.doesNotMatch(go(1), /相位波/);
});

/* ---------- 选中单位作为受击者（engine.js · resolveAttack 交叉验证） ---------- */
// 用真实结算：给目标挂上某个状态，打一下，看「加算百分比合计」，和图表的 cell.value + row.pct 比
function engPct(unit, el, opt) {
  opt = opt || {};
  const H2 = require("./headless").load();
  const src = `(() => { const t = Object.assign({ id: "t", name: "t", zone: 1, def: 0, defMax: 0, layers: [{ type: ${JSON.stringify(opt.layer || "flesh")}, current: 999, max: 999 }] }, ${JSON.stringify(unit)});
    const r = resolveAttack({ attacker: null, target: t, atk: 10, mult: 1, flat: 0, diceValue: 0, element: ${JSON.stringify(el)}, baseBreak: 0, hits: 1, flags: {}, weather: ${JSON.stringify(opt.weather || "none")}, phaseStep: 1, zoneMode: 2, targetField: ${JSON.stringify(opt.field || {})}, attackerField: {} });
    const line = r.log.find(s => /加算百分比合计/.test(s)) || ""; return line; })()`;
  const line = vm.runInContext(src, H2);
  const m = line.match(/合计 ([+−-]?\d+(?:\.\d+)?)%/);
  return m ? Number(m[1].replace("−", "-")) / 100 : 0;
}
function unitChart(unit, opt) {
  opt = opt || {};
  const st = { weather: opt.weather || "none", phaseStep: 1, fields: { 1: opt.field || {} }, units: [Object.assign({ id: "t", name: "测试", zone: 1 }, unit)] };
  return J(vm.runInContext(`matchupForState(${JSON.stringify(st)}, "t")`, c));
}
const total = (m, el, layer) => cell(m, el, layer).value + m.rows.find(r => r.id === el).pct;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

const EFFECTS = [
  ["霜结", { self: "frost" }, ["physical", "fire", "ice"], {}, /霜结：该属性受伤 −25%/],
  ["雪天霜结 −10%（受击者霜结）", { self: "frost" }, ["fire", "ice"], { weather: "snow" }, /雪天霜结：全属性再 −10%/],
  ["自焚", { self: "burn", selfBurnStacks: 2 }, ["fire", "ice", "acid"], {}, /自焚×2/],
  ["溅射", { self: "splash" }, ["acid", "fire", "ice"], {}, /溅射/],
  ["蓄能", { self: "store" }, ["harmonic", "fire"], {}, /蓄能：谐波受伤 \+25%/],
  ["蚀刻残留", { etchMarks: [{ element: "acid", pct: 0.1 }] }, ["acid", "fire"], {}, /蚀刻残留/],
  ["摊平", { resources: { flattened: true } }, ["fire", "ice"], {}, /摊平/],
  ["被挟持", { kit: "outlaw_king", resources: { hostage: true } }, ["fire"], {}, /被挟持/],
  ["全队集结", { resources: { rallyDr: true } }, ["fire", "energy"], {}, /全队集结/],
  ["干涉场叠层", { interfere: 0.3, interfereZone: 1 }, ["harmonic", "fire"], { field: { harmonic: true } }, /干涉场叠层/],
  ["冰冻（下一击）", { instant: { iceNext: true } }, ["fire"], {}, /冰冻/],
];
for (const [name, unit, els, opt, re] of EFFECTS) {
  test(`选中单位·${name}：和 resolveAttack 的加算百分比一致，原因写明`, () => {
    const m = unitChart(unit, opt);
    assert.equal(m.defender, true);
    for (const el of els) near(total(m, el, "flesh"), engPct(unit, el, opt), `${name}/${el}`);
    assert.ok(m.rows.some(r => re.test(r.pctReason)), name);
  });
}

test("选中单位·全队集结：坦克自己失衡仍显示 −15%（与 engine 一致，只看施放者）", () => {
  // 在旧 matchup.js（rallyDr && !(stunned||dying)）上失败
  const unit = { resources: { rallyDr: true }, stunned: true };
  const m = unitChart(unit);
  assert.equal(m.defender, true);
  assert.ok(m.rows.some(r => /全队集结/.test(r.pctReason)), "克制表应写出全队集结");
  for (const el of ["fire", "energy", "physical"]) {
    near(total(m, el, "flesh"), engPct(unit, el), `失衡坦克/${el}`);
  }
});


test("选中单位·熔融装甲：物理打装甲强制 +50%（和结算一致）；冰 ×2 记在 row.mult", () => {
  const unit = { instant: { melt: true } };
  const m = unitChart(unit);
  const x = cell(m, "physical", "armor");
  assert.equal(x.value, 0.5); assert.match(x.reason, /熔融装甲/);
  near(total(m, "physical", "armor"), engPct(unit, "physical", { layer: "armor" }), "熔融");
  const ice = m.rows.find(r => r.id === "ice");
  assert.equal(ice.mult, 2); assert.match(ice.multReason, /熔融/);
});

test("选中单位·愿你无恙：克制加成封顶（快照带 weaknessCap），和 bpChartCap 一致", () => {
  const st = { weather: "none", fields: {}, units: [{ id: "t", zone: 1 }] };
  const m = J(vm.runInContext(`(() => { const st = ${JSON.stringify(st)}; const o = bpChartCap; bpChartCap = (t, v) => (v > 0.1 ? 0.1 : v);
    try { return matchupForState(st, "t"); } finally { bpChartCap = o; } })()`, c));
  const x = cell(m, "fire", "flesh");
  assert.equal(x.value, 0.1); assert.match(x.reason, /愿你无恙/);
  assert.equal(cell(m, "fire", "armor").value, -0.25, "负的不封");
});

test("选中单位·起身：全部 0%，原因是通用说明，不提坚毅；载荷里没有 upOnShp / shp", () => {
  const unit = { isPlayer: true, upOnShp: true, shp: 7, shpMax: 10 };
  const m = unitChart(unit);
  assert.ok(m.cells.flat().every(x => x.value === 0 && /不吃属性克制/.test(x.reason)));
  near(total(m, "fire", "flesh"), engPct(unit, "fire"), "起身");
  assert.ok(!/坚毅|shp|upOnShp/i.test(JSON.stringify(m)));
});

test("选中单位·飞行：不给 field（iceZones 仍标区），冰格不吃；不选单位时是通用表（没有 defender）", () => {
  const m = unitChart({ flying: true }, { field: { ice: true } });
  assert.equal(m.field, null); assert.equal(m.iceLabel, "冻土：1区");
  near(total(m, "ice", "flesh"), engPct({ flying: true }, "ice", { field: { ice: true } }), "飞行");
  const g = J(vm.runInContext(`matchupForState({ weather: "snow", fields: { 2: { ice: true } }, units: [] }, null)`, c));
  assert.equal(g.defender, undefined);
  assert.deepEqual(g.iceZones, [2]); assert.equal(g.iceLabel, "冻土：2区");
  assert.ok(g.notes.some(n => /目标霜结时/.test(n)), "通用表：雪天霜结只写在说明里");
  assert.ok(g.rows.every(r => !r.effects));
});

test("雪天霜结看受击方：攻击方霜结不算（开关 MATCHUP_SNOW_FROST_SIDE = defender）", () => {
  assert.equal(vm.runInContext("MATCHUP_SNOW_FROST_SIDE", c), "defender");
  const m = unitChart({}, { weather: "snow" });
  assert.ok(m.rows.every(r => !/雪天霜结/.test(r.pctReason)));
});

test("联机：matchup.units 每个看得见的单位一份（隐藏 / 阵亡的没有），顶层仍是只看环境的表；投影后没有坚毅", () => {
  const st = { weather: "snow", fields: { 1: { ice: true } }, units: [
    { id: "a", name: "甲", zone: 1, isPlayer: true, upOnShp: true, shp: 3, self: "frost" }, { id: "b", zone: 2 }, { id: "h", zone: 1, hidden: true }, { id: "d", zone: 1, dead: true }] };
  const m = J(vm.runInContext(`(() => { const st = ${JSON.stringify(st)}; const m = matchupForState(st, "a", { defender: false }); m.units = matchupUnitCharts(st); return m; })()`, c));
  assert.equal(m.defender, undefined);
  assert.deepEqual(Object.keys(m.units).sort(), ["a", "b"]);
  const out = V.projectPacket({ type: "result", matchup: m }, { recipientId: "p1", gmId: "host" }).matchup;
  assert.equal(out.units.a.unitName, "甲");
  assert.ok(!/坚毅|"shp|upOnShp/i.test(JSON.stringify(out)));
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "online-game.js"), "utf8");
  assert.match(src, /matchupForState\(state, root\.GAME && GAME\.actorId, \{ defender: false \}\)/);
  assert.match(src, /m\.units = matchupUnitCharts\(state\)/);
});
