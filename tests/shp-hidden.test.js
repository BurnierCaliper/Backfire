// 坚毅生命（shp）绝不向玩家显示数值（手册；issue #52）：游戏版只给模糊说法，跑团主持人照常看到数值
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");

function field(game, trpg) {
  const c = H.load();
  if (game) c.GAME_MODE = true;
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  if (trpg) c.S.TRPG.active = true;
  return c;
}

test("四档模糊说法：80% 以上 / 50–80% / 20–50% / 20% 以下，每档 5 句", () => {
  const c = field(true);
  const lines = vm.runInContext("SHP_MOOD_LINES", c);
  assert.equal(lines.length, 4);
  lines.forEach(l => assert.equal(l.length, 5));
  assert.equal(c.shpMoodTier(90, 100), 0);
  assert.equal(c.shpMoodTier(80, 100), 0);
  assert.equal(c.shpMoodTier(79, 100), 1);
  assert.equal(c.shpMoodTier(50, 100), 1);
  assert.equal(c.shpMoodTier(49, 100), 2);
  assert.equal(c.shpMoodTier(20, 100), 2);
  assert.equal(c.shpMoodTier(19, 100), 3);
  assert.ok(lines[3].includes(c.shpMoodLine(5, 100)));
  assert.match(c.shpMoodLine(5, 100), /^[^0-9]*$/, "不带数字");
});

test("游戏版隐藏，跑团主持人照常显示；计算器（非游戏版）照常显示", () => {
  assert.equal(field(true).shpHidden(), true);
  assert.equal(field(true, true).shpHidden(), false, "跑团主持人");
  assert.equal(field(false).shpHidden(), false);
});

test("注射剂扣坚毅：游戏版日志不写数字", () => {
  for (const game of [true, false]) {
    const c = field(game);
    const text = c.shpLossText(6);
    assert.equal(/\d/.test(text), !game, text);
  }
});

test("升级提示：游戏版不列坚毅生命上限", () => {
  const c = field(true);
  const L = c.LevelUp || vm.runInContext("typeof LevelUp !== 'undefined' ? LevelUp : null", c);
  if (!L || !L.diff) return;
  const a = { stats: { hp: 10, atk: 1, def: 1, shp: 10 }, skills: {}, passives: [], weapons: {} };
  const b = { stats: { hp: 12, atk: 1, def: 1, shp: 15 }, skills: {}, passives: [], weapons: {} };
  const d = L.diff(a, b);
  assert.ok(!JSON.stringify(d.stats).includes("坚毅"));
});
