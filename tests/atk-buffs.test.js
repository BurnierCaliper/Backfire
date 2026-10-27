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

test("全队集结·直伤：加成读配置 RALLY_BUFF.atk（出手和日志都跟着变）", () => {
  const c = field();
  const vm = require("node:vm");
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext("RALLY_BUFF", c))), { atk: 15 });
  vm.runInContext("RALLY_BUFF.atk = 7", c);
  const h = hero(c, "helu");
  h.roles = Object.assign({}, h.roles, { primary: "直伤" });
  const before = c.effectiveAtk(h, c.S.state.units);
  const lines = [];
  c.applyRallyBuff(h, lines);
  assert.equal(c.effectiveAtk(h, c.S.state.units), before + 7);
  assert.ok(lines.some(s => /直伤集结：ATK \+7。/.test(s)), lines.join("\n"));
});
