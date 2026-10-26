// #52：蓄能攒的高能值不算「高能」。有高能只看高能状态；纯蓄能单位显示「蓄能 N」
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const HI = require("../hud-icons.js");

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 1 }, { id: "thug_knife", lv: 3, zone: 1 }], seed: "SVH" });
  c.startCombat();
  const S = c.S.state;
  const [store, high] = S.units.filter(u => !u.isPlayer);
  store.self = "store"; store.highEnergy = 5; store.statuses.high = false;
  high.statuses.high = true; high.highEnergy = 2;
  return { c, S, store, high };
}

test("判定：蓄能单位不算有高能（hasHigh、传播、激活、狂瀑）", () => {
  const { c, store, high } = field();
  assert.equal(c.hasHigh(store), false);
  assert.equal(c.hasHigh(high), true);
  assert.ok(!JSON.parse(JSON.stringify(c.spreadKeys(store))).includes("high"), "传播复制不到蓄能的高能值");
  assert.ok(JSON.parse(JSON.stringify(c.spreadKeys(high))).includes("high"));
  high.statuses.high = false; high.highEnergy = 0;
  assert.ok(require("node:vm").runInContext("SKILL_REQUIREMENT", c).ras_torrent({}), "只有蓄能单位时狂瀑没有目标");
});

test("显示：高能状态写「高能 N」，蓄能写「蓄能 N」", () => {
  const { c, store, high } = field();
  assert.match(c.statusLine(store), /蓄能 5/);
  assert.doesNotMatch(c.statusLine(store), /(^| )高能 /);
  assert.match(c.statusLine(high), /高能 2/);
  const keys = (u) => HI.unitBadges(u).map(b => b.key + ":" + b.stack);
  assert.ok(!keys(store).some(k => k.startsWith("high")), keys(store).join(","));
  assert.ok(keys(store).includes("store:5"), keys(store).join(","));
  assert.ok(keys(high).includes("high:2"));
  // 自我效果已经结束、留着高能值的：也挂蓄能徽章，不挂高能
  store.self = "none";
  assert.ok(keys(store).includes("store:5"), keys(store).join(","));
});
