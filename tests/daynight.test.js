// 昼夜显示：时钟工具（ledger.js）、路线图的预计到达时刻（rogue.js · routeEta）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

test("isNightClock / clockAfter：18:00–05:00 是夜晚；跨 0 点记天数", () => {
  const c = H.load();
  assert.equal(c.isNightClock(17 * 60 + 59), false);
  assert.equal(c.isNightClock(18 * 60), true);
  assert.equal(c.isNightClock(4 * 60 + 59), true);
  assert.equal(c.isNightClock(5 * 60), false);
  const t = c.clockAfter(8, 22 * 60);
  assert.equal(t.text, "06:00"); assert.equal(t.days, 1); assert.equal(t.night, false);
  assert.equal(c.clockAfter(1.5, 16 * 60 + 45).text, "18:15");
});

test("路线图预计到达：从现在起每走一站 = 路上 3 小时 + 节点时间；已经走过的列没有", () => {
  const c = H.load();
  const R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed: "ETA" });
  R.acceptTask(run, "main");
  c.LEDGER.clock = 14 * 60;
  run.task.index = 0;
  run.task.nodes = run.task.cols.map(col => ({ type: col[0], done: false }));
  const eta = R.routeEta(run);
  assert.equal(eta.length, run.task.cols.length);
  assert.equal(eta[0].text, "14:00", "已经在第一站");
  const h0 = Number(c.S.ROGUE_NODE_TYPES[run.task.nodes[0].type].hours) || 0;
  assert.equal(eta[1].text, c.clockAfter(h0 + R.CONFIG.hours.travel, 14 * 60).text);
  run.task.index = 2;
  const eta2 = R.routeEta(run);
  assert.equal(eta2[0], null); assert.equal(eta2[1], null);
  assert.ok(eta2[2]);
});
