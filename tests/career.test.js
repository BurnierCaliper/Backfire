// 战场数据新增的列（协助攻击 / 协助格挡 / 格挡规避 / 打出失衡）和整局战场记录（LEDGER.career）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(c) {
  c = c || H.load();
  c.BattleSim.setup({ party: ["ruby", "kolt"], enemies: [{ id: "thug_hammer", lv: 1, zone: 1 }], seed: "CR" });
  c.startCombat();
  const st = c.S.state;
  const ruby = c.findKit("ruby", st.units), kolt = c.findKit("kolt", st.units);
  const foe = st.units.find(u => !u.isPlayer);
  st.units.forEach(u => { u.zone = 1; });
  foe.layers.forEach(l => { l.current = l.max = 999; });
  return { c, st, ruby, kolt, foe };
}

test("战场数据：协助格挡次数 / 成功次数，格挡规避的伤害记在格挡的人身上", () => {
  const { c, st, ruby, kolt, foe } = field();
  st.combatPhase = "enemy";
  ruby.bonus = 1;
  c.dealTo(foe, kolt, { atk: 0, mult: 0, flat: 8, element: "physical", baseBreak: 1, flags: { action: true } });
  c.finishBlock(ruby.id, { roll: 1, ok: true, chance: 50 });
  const s = st.battleStats[ruby.id];
  assert.equal(s.blocks, 1);
  assert.equal(s.blockOk, 1);
  assert.equal(s.avoided, 8);
  // 失败也算发动
  ruby.bonus = 1;
  c.dealTo(foe, kolt, { atk: 0, mult: 0, flat: 8, element: "physical", baseBreak: 1, flags: { action: true } });
  c.finishBlock(ruby.id, { roll: 99, ok: false, chance: 50 });
  assert.equal(s.blocks, 2);
  assert.equal(s.blockOk, 1);
  assert.equal(s.avoided, 8);
});

test("战场数据：打出失衡、协助攻击次数", () => {
  const { c, st, ruby, kolt, foe } = field();
  foe.def = 1;
  st.attackerId = kolt.id; st.targetId = foe.id; kolt.ap = 2;
  c.runSkill("kolt_aa");
  assert.equal(foe.stunned, true);
  assert.equal(st.battleStats[kolt.id].staggers, 1);
  assert.ok(st.assistQueue.length, "失衡触发协助攻击");
  c.finishAssist(ruby.id, {});
  assert.equal(st.battleStats[ruby.id].assists, 1);
});

test("整局记录：每场结算时按 kit 累计，并记下每场摘要；跟着 LEDGER 存档走", () => {
  const c = H.load();
  c.LEDGER.reset();
  let f = field(c);
  f.st.battleStats[f.ruby.id] = Object.assign(c.battleStat(f.ruby), { dmg: 30, assists: 1, blocks: 2, blockOk: 1, avoided: 9, staggers: 1, taken: 5 });
  f.st.battleStats[f.kolt.id] = Object.assign(c.battleStat(f.kolt), { dmg: 10, taken: 15 });
  c.settleBattleRewards("win");
  f = field(c);
  f.st.battleStats[f.ruby.id] = Object.assign(c.battleStat(f.ruby), { dmg: 20, staggers: 2 });
  c.settleBattleRewards("lose");
  const car = c.careerData();
  assert.equal(car.battles.length, 2);
  assert.equal(car.battles[0].outcome, "win");
  assert.equal(car.battles[0].mvp.name, "瑞比");
  assert.equal(car.battles[1].no, 2);
  assert.equal(car.kits.ruby.dmg, 50);
  assert.equal(car.kits.ruby.staggers, 3);
  assert.equal(car.kits.ruby.avoided, 9);
  assert.equal(car.kits.ruby.battles, 2);
  assert.equal(car.kits.kolt.taken, 15);
  // 同一场重复结算不会重复累计
  c.settleBattleRewards("lose");
  assert.equal(c.careerData().battles.length, 2);
  // 存档往返
  const saved = JSON.parse(JSON.stringify(c.LEDGER.save()));
  c.LEDGER.reset();
  assert.equal(c.careerData().battles.length, 0);
  c.LEDGER.load(saved);
  assert.equal(c.careerData().kits.ruby.dmg, 50);
});

test("单局：新开一局时整局记录清空", () => {
  const c = H.load();
  c.LEDGER.career = { battles: [{ no: 1 }], kits: {} };
  c.Rogue.newRun({ party: ["ruby", "kolt"], seed: "CAREER" });
  assert.equal(c.careerData().battles.length, 0);
});
