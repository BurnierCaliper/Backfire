// H2：单局「休整」补给不够又没钱，营地要能走到「硬撑着过夜」，不能卡死
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

test("H2 规则层：补给不够、没钱，营地硬撑着过夜：离开营地、天数推进、没有正常长休", () => {
  const c = H.load(), R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed: "H2-CAMP" });
  run.stage = "camp";
  c.S.state.bag = { items: [] }; c.setLedgerWater(0); c.S.state.kuizhi = 0;
  assert.equal(plain(R.campStatus(run, {})).ok, false, "补给确实不够");
  const day = run.day;
  R.camp(run, {});
  assert.notEqual(run.stage, "camp", "离开了营地");
  assert.ok(run.day > day, "天数推进");
  assert.ok(!(run.lastRest && run.lastRest.ok), "没有正常长休");
});

test("H2 营地画面：补给不够时按钮是可点的「硬撑着过夜」；够了 / 主持人安排的不变", () => {
  require("../rest-report.js");
  const RR = globalThis.RestReport;
  const base = { day: 1, clock: 480, hoursAwake: 10, exhaust: 0, water: { need: 2000, have: 0 }, food: { need: 4, have: 0 }, heroes: [] };
  const bad = RR.campHtml(Object.assign({ ok: false, lack: ["水不够"] }, base), { host: true });
  assert.match(bad, /硬撑着过夜/);
  assert.doesNotMatch(bad, /开始长休/);
  assert.doesNotMatch(bad.match(/<button[^>]*data-rr="start"[^>]*>/)[0], /disabled/);
  assert.match(bad, /不回血/);
  const ok = RR.campHtml(Object.assign({ ok: true }, base), { host: true });
  assert.match(ok, /开始长休/);
  assert.doesNotMatch(ok, /硬撑/);
  const force = RR.campHtml(Object.assign({ ok: false, lack: [] }, base), { host: true, force: true });
  assert.match(force, /开始长休/);
  assert.doesNotMatch(force, /硬撑/);
});
