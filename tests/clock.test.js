// 跑团 24 小时时钟（ledger.js · clock / ledgerAdvance、trpg.js · trpgPassMinutes / trpgPassUntil）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function trpg() {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "hiaki"], enemies: [] });
  c.LEDGER.reset();
  return c;
}

test("新档从第 1 天早上 8 点开始；时刻文字 / 解析 / 时段", () => {
  const c = trpg();
  assert.equal(c.LEDGER.clock, 480);
  assert.equal(c.ledgerTimeText(), "第 1 天 08:00（上午）");
  assert.equal(c.clockText(65), "01:05");
  assert.equal(c.parseClock("21:30"), 1290);
  assert.equal(c.parseClock("7:5"), 425);
  assert.equal(c.parseClock("24:00"), null);
  assert.equal(c.parseClock("abc"), null);
  assert.equal(c.durationText(2.25), "2 小时 15 分");
  assert.equal(c.durationText(0.5), "30 分钟");
});

test("按分钟推进：时钟和距长休一起走，过了 0 点进入下一天并刷新短休", () => {
  const c = trpg();
  c.trpgPassMinutes(135);
  assert.equal(c.clockText(c.LEDGER.clock), "10:15");
  assert.equal(c.durationText(c.LEDGER.hours), "2 小时 15 分");
  c.LEDGER.shortUsed = { ruby: 2 };
  const notes = c.trpgPassMinutes(14 * 60);
  assert.equal(c.LEDGER.day, 2);
  assert.equal(c.clockText(c.LEDGER.clock), "00:15");
  assert.equal(Object.keys(c.LEDGER.shortUsed).length, 0);
  assert.ok(notes.some(n => n.includes("进入第 2 天")));
});

test("一直等到某个时刻：今天已经过了就等到明天", () => {
  const c = trpg();
  c.trpgPassUntil("21:00");
  assert.equal(c.LEDGER.day, 1);
  assert.equal(c.clockText(c.LEDGER.clock), "21:00");
  assert.equal(c.LEDGER.hours, 13);
  c.trpgPassUntil("06:30");
  assert.equal(c.LEDGER.day, 2);
  assert.equal(c.clockText(c.LEDGER.clock), "06:30");
  assert.ok(c.trpgPassUntil("99:99")[0].includes("看不懂"));
});

test("长休按时钟走：白天睡 8 小时不换天，夜里睡过 0 点才换天", () => {
  const c = trpg();
  c.LEDGER.hours = 10;
  c.trpgLongRest({ hours: 8, force: true });
  assert.equal(c.LEDGER.day, 1);
  assert.equal(c.clockText(c.LEDGER.clock), "16:00");
  assert.equal(c.LEDGER.hours, 0);
  c.LEDGER.clock = 22 * 60;
  c.trpgLongRest({ hours: 8, force: true });
  assert.equal(c.LEDGER.day, 2);
  assert.equal(c.clockText(c.LEDGER.clock), "06:00");
});

test("时刻存进档案；旧档案没有时刻就从早上 8 点算", () => {
  const c = trpg();
  c.trpgPassMinutes(200);
  const saved = c.LEDGER.save();
  assert.equal(saved.clock, 680);
  c.LEDGER.load(saved);
  assert.equal(c.LEDGER.clock, 680);
  c.LEDGER.load({ day: 3, hours: 5 });
  assert.equal(c.LEDGER.clock, 480);
});

test("后台可以直接改时刻（不推进距长休）", () => {
  const c = trpg();
  const notes = c.trpgBackstageApply({ clock: "19:45", hours: c.LEDGER.hours });
  assert.equal(c.clockText(c.LEDGER.clock), "19:45");
  assert.equal(c.LEDGER.hours, 0);
  assert.ok(notes.some(n => n.includes("08:00 → 19:45")));
});
