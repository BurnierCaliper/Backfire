// #340 第 17 条：扭矩「转移注意」的自保模式，被攻击时架势也不会低于 1
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

test("转移注意（自保模式）：被攻击 4 击破、架势 4 → 1，不进失衡", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 1 }], seed: "DIVERT" });
  c.startCombat();
  const t = c.S.state.units.find(u => u.kit === "kolt");
  t.resources = t.resources || {};
  t.resources.divertGuard = true;
  t.def = 4;
  t.stunned = false;
  const result = { ok: true, layersAfter: JSON.parse(JSON.stringify(t.layers)), breakDealt: 4, broke: true, knockdownHp: 0, shpDealt: 0 };
  c.applyResultToUnit(t, result, c.S.state.units.find(u => !u.isPlayer));
  assert.equal(t.def, 1);
  assert.equal(!!t.stunned, false);
});
