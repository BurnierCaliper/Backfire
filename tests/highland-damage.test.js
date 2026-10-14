// 高地（手册）：高地对低地的远程攻击 +25% 伤害、协助格挡 −10%；反过来 −25% 伤害、+10%。非高地都算低地。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");

function lost(highA, highT, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "captain_ox", lv: 3, zone: 2 }], seed: "HL" });
  c.startCombat();
  const st = c.S.state;
  vm.runInContext("Math", c).random = () => 0.5;
  if (opt.zones) st.zoneMode = opt.zones;
  const helu = c.findKit("helu", st.units);
  const ox = st.units.find(u => !u.isPlayer);
  helu.zone = 1; ox.zone = opt.oxZone || 2;
  st.fields[1].highland = highA; st.fields[ox.zone].highland = highT;
  const hp0 = c.totalHp(ox);
  c.dealTo(helu, ox, { atk: 40, mult: 1, element: "physical", baseBreak: 0, atkRange: opt.range || "ranged",
    flags: Object.assign({ action: true, blockResolved: true, block: "none" }, opt.flags || {}) });
  return hp0 - c.totalHp(ox);
}

test("高地打低地的隔区远程攻击 +25% 伤害，低地打高地 −25%，两边都是高地 / 都是低地不变", () => {
  const flat = lost(false, false);
  assert.ok(flat > 0);
  const up = lost(true, false), down = lost(false, true);
  assert.ok(up > flat, `高地打低地 ${up} > ${flat}`);
  assert.ok(down < flat, `低地打高地 ${down} < ${flat}`);
  assert.equal(lost(true, true), flat);
});

test("近战不吃高地伤害修正", () => {
  assert.equal(lost(true, false, { range: "melee" }), lost(false, false, { range: "melee" }));
});

test("三区模式隔两区的远程攻击也吃高地修正", () => {
  const o = { zones: 3, oxZone: 3, flags: { anyRange: true } };
  const flat = lost(false, false, o);
  assert.ok(flat > 0);
  assert.ok(lost(true, false, o) > flat);
  assert.ok(lost(false, true, o) < flat);
});
