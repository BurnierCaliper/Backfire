// 熔融装甲 + 微光（#387）：物理打熔融装甲强制 +50%，微光照样反转克制表（能量以外都反转），变成 −50%
// engine.js · resolveAttack（真实结算）、matchup.js · matchupChart（克制表数据）、matchup-ui.js（克制表浮层）三处要一致
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const H = require("./headless");

const c = H.load();
const J = v => JSON.parse(JSON.stringify(v));
/** 直接调 resolveAttack：一层够厚的装甲（打不穿）、带熔融的靶子挨一下 10 点 */
function strike(opt) {
  opt = opt || {};
  const t = Object.assign({ id: "t", name: "靶子", zone: 1, def: 10, defMax: 10, instant: { melt: true },
    layers: [{ type: "armor", current: 999, max: 999, inner: true }] }, opt.target || {});
  const ctx = { attacker: null, target: t, atk: 10, mult: 1, flat: 0, diceValue: 0, element: opt.element || "physical",
    baseBreak: opt.baseBreak || 0, hits: 1, flags: {}, weather: opt.weather || "none", phaseStep: 1, zoneMode: 2, targetField: {}, attackerField: {} };
  return J(vm.runInContext(`resolveAttack(${JSON.stringify(ctx)})`, c));
}
const meltLine = r => r.log.find(s => /熔融装甲将物理修正/.test(s)) || "";

test("微光下物理打熔融装甲：克制修正 −50%（10 → 5），不再是 +50%；日志写明微光反转", () => {
  const r = strike({ weather: "glow" });
  assert.equal(r.total, 5, r.log.join("\n"));
  assert.match(meltLine(r), /强制改为 \+50%.*微光反转.*-50%/);
  assert.ok(r.log.some(s => /克制表 物理 → 装甲：-50%/.test(s)), r.log.join("\n"));
  // 恶劣环境 / 末日只翻倍天气的伤害加减和场地，克制表反转不翻倍：照样 −50%
  assert.equal(strike({ weather: "glow", target: { harshEnv: true } }).total, 5);
});

test("微光下物理打熔融装甲算被克制：disadvantage，不算 advantage（克制大师、预览都看这个）", () => {
  const g = strike({ weather: "glow" });
  assert.equal(g.advantage, false);
  assert.equal(g.disadvantage, true);
  const n = strike();
  assert.equal(n.advantage, true, "别的天气照旧是克制");
  assert.equal(n.disadvantage, false);
});

test("微光把熔融装甲的 +50% 改成 −50%，少打的 10 点算天气的（weatherDown，环境分用）", () => {
  const g = strike({ weather: "glow" });
  assert.equal(g.weatherDown, 15 - 5);
  assert.equal(g.weatherUp, 0);
  const n = strike();
  assert.deepEqual([n.weatherUp, n.weatherDown], [0, 0]);
});

test("没有微光照旧：常态 / 酷暑 / 雷鸣 / 沙暴 +50%（15）；酸雨装甲减伤失效不叠加，只吃酸雨的 −25%（12）；雪天物理 +25%（17）", () => {
  for (const w of ["none", "heat", "thunder", "sand"]) {
    const r = strike({ weather: w });
    assert.equal(r.total, 15, w);
    assert.match(meltLine(r), /强制改为 \+50%。$/, w);
  }
  assert.equal(strike({ weather: "acid" }).total, 12);
  assert.equal(strike({ weather: "snow" }).total, 17);
  // 微光只改物理打熔融装甲这一格：熔融的其他层、别的属性打熔融装甲照微光反转后的克制表
  assert.equal(strike({ weather: "glow", target: { layers: [{ type: "flesh", current: 999, max: 999, inner: true }] } }).total, 10, "物理打肉体 0%");
  assert.equal(strike({ weather: "glow", element: "fire" }).total, 12, "火打装甲 −25% → +25%");
});

test("错位：微光下熔融装甲 −50% 是被克制的攻击，不再 +1 击破；别的天气照旧 +1", () => {
  const shifted = { instant: { melt: true, shift: true } };
  const n = strike({ target: shifted, baseBreak: 2 });
  assert.equal(n.breakDealt, 3, "2 + 错位 1（熔融装甲没有物理打装甲的 +1）");
  assert.ok(n.log.some(s => /错位 \+ 熔融装甲加伤：击破 \+1/.test(s)));
  const g = strike({ target: shifted, weather: "glow", baseBreak: 2 });
  assert.equal(g.breakDealt, 1, "2 − 微光 1，没有错位的 +1\n" + g.log.join("\n"));
  assert.ok(!g.log.some(s => /错位/.test(s)), g.log.join("\n"));
});

/* ---------- 真打一下（dealTo，天气从战场上取） ---------- */
function field() {
  const k = H.load();
  k.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_hammer", lv: 1, zone: 1 }], seed: "MELTGLOW" });
  k.startCombat();
  const st = k.S.state;
  st.units.forEach(u => { if (!u.hidden) u.zone = 1; });
  const foe = st.units.find(u => !u.isPlayer);
  foe.layers = [{ type: "armor", current: 999, max: 999, inner: true }];
  k.applyInstantEffect(foe, "melt", []);
  return { k, st, foe, kolt: k.findKit("kolt", st.units) };
}
const punch = (f) => f.k.dealTo(f.kolt, f.foe, { atk: 10, mult: 1, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });

test("战斗里：微光天气下柯尔特物理打熔融装甲的敌人，扣 5（常态扣 15）", () => {
  const g = field();
  g.k.setWeather("glow", { force: true });
  assert.equal(g.st.weather, "glow");
  assert.equal(punch(g).res.total, 5);
  assert.equal(g.foe.layers[0].current, 999 - 5);
  const n = field();
  assert.equal(punch(n).res.total, 15);
});

/* ---------- 克制表（matchup.js / matchup-ui.js） ---------- */
const cellOf = (m, r, col) => m.cells[m.rows.findIndex(x => x.id === r)][m.cols.findIndex(x => x.id === col)];
function unitChart(weather, extra) {
  const st = { weather, phaseStep: 1, fields: { 1: {} }, units: [Object.assign({ id: "t", name: "测试", zone: 1, instant: { melt: true } }, extra || {})] };
  return J(vm.runInContext(`matchupForState(${JSON.stringify(st)}, "t")`, c));
}

test("克制表：选中熔融单位、微光天气，物理 → 装甲是 −50%（被克制），原因写明熔融装甲和微光；和真实结算一致", () => {
  const m = unitChart("glow");
  const x = cellOf(m, "physical", "armor");
  assert.equal(x.value, -0.5);
  assert.equal(x.kindId, "dis");
  assert.equal(x.kind, "被克制");
  assert.equal(x.changed, true);
  assert.match(x.reason, /熔融装甲/);
  assert.match(x.reason, /微光/);
  const row = m.rows.find(r => r.id === "physical");
  assert.equal(Math.floor(10 * (1 + x.value + row.pct) + 1e-9), strike({ weather: "glow" }).total);
  // 恶劣环境：照样 −50%
  assert.equal(cellOf(unitChart("glow", { harshEnv: true }), "physical", "armor").value, -0.5);
});

test("克制表：没有微光照旧 +50%（常态、酸雨）；不熔融时微光下物理打装甲还是 +25%", () => {
  for (const w of ["none", "acid"]) {
    const x = cellOf(unitChart(w), "physical", "armor");
    assert.equal(x.value, 0.5, w);
    assert.doesNotMatch(x.reason, /微光/, w);
  }
  assert.equal(cellOf(unitChart("glow", { instant: {} }), "physical", "armor").value, 0.25);
});

test("克制表浮层：选中熔融单位、微光天气，物理 → 装甲写「−25%（删除线）→ −50%」", () => {
  const ROOT = path.resolve(__dirname, "..");
  const k = H.load();
  vm.runInContext(fs.readFileSync(path.join(ROOT, "icons.js"), "utf8"), k, { filename: "icons.js" });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "matchup-ui.js"), "utf8"), k, { filename: "matchup-ui.js" });
  vm.runInContext(`state.weather = "glow"; state.phaseStep = 0; state.apocalypse = false; state.fields = { 1: emptyField() };
    state.units = [{ id: "b", name: "乙", zone: 1, instant: { melt: true } }];`, k);
  k.GAME = { actorId: "b" };
  const M = k.MatchupUI, ch = M.localChart();
  const i = ch.rows.findIndex(r => r.id === "physical"), j = ch.cols.findIndex(x => x.id === "armor");
  const html = M.html(ch);
  const td = (html.match(new RegExp(`<td class="mu-cell[^"]*" data-mu-cell="${i}:${j}"[\\s\\S]*?</td>`)) || [""])[0];
  assert.match(td, /<s>−25%<\/s>[\s\S]*<b>−50%<\/b>/, td);
  assert.match(td, /class="mu-cell mu-dis/, "按被克制上色");
  assert.match(td, /title="[^"]*微光/, td);
});
