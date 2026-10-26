// 一次攻击的伤害百分比改动（攻击方、受击方都算）一律加算，不连乘；写成「翻倍 / 减半」的才相乘
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function hit(opt) {
  const c = H.load();
  c.BattleSim.setup({ party: ["ras"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "PCT" });
  const st = c.S.state;
  const a = c.findKit("ras", st.units), t = st.units.find(u => !u.isPlayer);
  a.zone = t.zone = 1; a.statuses = c.defaultStatuses ? c.defaultStatuses() : {};
  t.layers = [{ type: "flesh", current: 9999, max: 9999 }]; t.def = t.defMax = 99; t.flying = false;
  t.instant = Object.assign({}, opt.instant || {}); t.resources = Object.assign({}, t.resources, opt.res || {});
  const r = c.resolveAttack({ attacker: a, target: t, atk: 100, mult: 1, hits: 1, baseBreak: 0, element: opt.element || "physical",
    flags: Object.assign({ action: true }, opt.flags || {}), weather: opt.weather || "none", phaseStep: opt.phaseStep, zoneMode: 2,
    attackerField: {}, targetField: {}, dist: 0, atkRange: "any" });
  return { total: r.total, log: r.log.join("\n"), t };
}

test("冰冻 +50% 和减伤 50% 加算：100 × (1 + 50% − 50%) = 100（以前 ×1.5 ×0.5 = 75）", () => {
  const r = hit({ instant: { iceNext: true }, flags: { dr50: true } });
  assert.equal(r.total, 100);
  assert.equal(r.t.instant.iceNext, false, "冰冻用掉了");
});

test("冰冻 +50% 和克制表 +50% 加算：火打生命 100 × (1 + 50% + 50%) = 200（以前 225）", () => {
  assert.equal(hit({ element: "fire", instant: { iceNext: true } }).total, 200);
});

test("过度自信 −25% 和克制 +50% 加算：125（以前 112）", () => {
  assert.equal(hit({ element: "fire", flags: { prideReduce: true } }).total, 125);
  assert.equal(hit({ element: "fire", flags: { prideReduce: 0.45 } }).total, 105);
});

test("相位波谷 −50% 和自保 −25% 加算：25（以前 37）", () => {
  assert.equal(hit({ weather: "phase", phaseStep: 0, flags: { dr25: true } }).total, 25);
  assert.equal(hit({ weather: "phase", phaseStep: 0 }).total, 50);
});

test("全队集结（坦克）的全属性减伤 15% 真的生效，也是加算；失衡后结束", () => {
  assert.equal(hit({ res: { rallyDr: true } }).total, 85);
  assert.equal(hit({ element: "fire", res: { rallyDr: true } }).total, 135);
});

test("减到负数按 0 算", () => {
  assert.equal(hit({ weather: "phase", phaseStep: 0, flags: { dr50: true, dr25: true } }).total, 0);
});

test("写成翻倍 / 减半的照样相乘：破釜沉舟翻倍 × 克制 +50% = 300；圣盾减半 = 75", () => {
  assert.equal(hit({ element: "fire", flags: { doubleDeal: true } }).total, 300);
  assert.equal(hit({ element: "fire", flags: { holyShield: true } }).total, 75);
});
