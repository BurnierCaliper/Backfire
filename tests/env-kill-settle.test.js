// H12：高能自爆 / 深渊坠落 / 流沙窒息弄死的敌人也走击杀结算（经验、击杀数、手下被打倒），只结算一次
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(enemies) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], seed: "H12", zoneMode: 3, enemies });
  c.startCombat();
  const st = c.S.state;
  const kolt = c.findKit("kolt", st.units);
  const thug = c.findKit("thug_knife", st.units);
  return { c, st, kolt, thug };
}
const kills = (c, u) => (c.battleStat(u) || {}).kills || 0;
const emptyOut = u => u.layers.forEach(l => { l.current = 0; });

test("高能自爆秒杀敌人：结算击杀（经验、击杀数），只一次", () => {
  const { c, st, kolt, thug } = field([{ id: "thug_knife", lv: 1, zone: 1 }]);
  thug._lastHitBy = kolt.id;
  const xp0 = st.battleGains.xp || 0;
  thug.highEnergy = 9999;
  c.explodeHigh(thug, 9999);
  assert.equal(thug._xpGiven, true);
  assert.ok((st.battleGains.xp || 0) > xp0, "应有经验");
  assert.equal(kills(c, kolt), 1);
  c.sweepDeadEnemies();
  assert.equal(kills(c, kolt), 1, "不重复结算");
});

test("坠入深渊致死：结算击杀，亡命之王记手下被打倒", () => {
  const { c, st, kolt, thug } = field([{ id: "outlaw_king", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }]);
  const king = c.findKit("outlaw_king", st.units);
  thug._lastHitBy = kolt.id;
  st.fields[2].abyss = true;
  thug.zone = 2;
  emptyOut(thug);
  const xp0 = st.battleGains.xp || 0;
  c.applyAbyssFall(thug, 1, []);
  assert.equal(thug._xpGiven, true);
  assert.ok((st.battleGains.xp || 0) > xp0);
  assert.equal(kills(c, kolt), 1);
  assert.equal(king.resources.crewDown, true, "手下被打倒");
});

test("流沙窒息致死：结算击杀", () => {
  const { c, st, thug } = field([{ id: "thug_knife", lv: 1, zone: 1 }]);
  st.fields[1].quicksand = true;
  thug.zone = 1;
  emptyOut(thug);
  c.addSink(thug, 5, [], "测试");
  const xp0 = st.battleGains.xp || 0;
  c.tickQuicksandFor(thug, []);
  assert.equal(thug._xpGiven, true);
  assert.ok((st.battleGains.xp || 0) > xp0);
});
