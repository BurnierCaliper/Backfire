// #340 第 17 条：扭矩「转移注意」的自保模式，被攻击时架势也不会低于 1
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

const plain = x => JSON.parse(JSON.stringify(x));
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));

test("转移注意（自保模式）：柯尔特召唤扭矩 → 扭矩转移注意 → 被攻击一击打空架势：留 1、不进失衡", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt"], enemies: [{ id: "thug_knife", lv: 3, zone: 1 }], seed: "DIVERT" });
  c.startCombat();
  const S = c.S.state;
  const foe = S.units.find(u => !u.isPlayer);
  const k = c.findKit("kolt", S.units);
  foe.zone = 1; k.zone = 1; k.level = 11; k.ap = 3; k.bonus = 2;
  cmd(c, { actor: k.id, skill: "kolt_summon" });
  const w = c.findKit("torque", S.units);
  assert.ok(w, "召唤出了扭矩");
  w.zone = 1; w.ap = 3; w.level = 4;
  cmd(c, { actor: w.id, skill: "torque_divert" });
  assert.ok(w.resources && w.resources.divertGuard, "进了自保模式");
  w.def = 4;
  // blockResolved：跳过「等待协助格挡选择」（柯尔特在同一区，会被问要不要格挡）
  const out = c.dealTo(foe, w, { element: "physical", mult: 1, atk: 5, baseBreak: 10, atkRange: "melee",
    flags: { action: true, block: "none", blockResolved: true } });
  assert.equal(w.def, 1);
  assert.equal(!!w.stunned, false);
  assert.equal(out.res.broke, false);
  assert.ok(out.extra.some(s => /自保模式：架势保留 1/.test(s)), out.extra.join("\n"));
});
