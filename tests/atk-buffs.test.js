// #340 第 16 条：强化注射剂 / 全队集结·直伤的 ATK 加成要算进出手（effectiveAtk）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 1 }], seed: "ATK-BUFF" });
  c.startCombat();
  return c;
}
const hero = (c, kit) => c.S.state.units.find(u => u.kit === kit);

test("强化注射剂：ATK +3 真的加到出手的攻击力上", () => {
  const c = field();
  const h = hero(c, "helu");
  const before = c.effectiveAtk(h, c.S.state.units);
  c.bagAdd("steroid", 1);
  c.useItemOn(h, "steroid", h);
  assert.equal(c.effectiveAtk(h, c.S.state.units), before + 3);
});

test("全队集结·直伤：ATK +15 真的加到出手的攻击力上；下一场清掉", () => {
  const c = field();
  const h = hero(c, "helu");
  h.roles = Object.assign({}, h.roles, { primary: "直伤" });
  const before = c.effectiveAtk(h, c.S.state.units);
  c.applyRallyBuff(h, []);
  assert.equal(c.effectiveAtk(h, c.S.state.units), before + 15);
  c.resetBattleFlags(h);
  assert.equal(c.effectiveAtk(h, c.S.state.units), before);
});
