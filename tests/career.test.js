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

test("单回合最高爆发：一回合里的伤害合计、各技能打了多少、命中时吃到的增益；之后回合打得少不会覆盖", () => {
  const { c, st, ruby, kolt, foe } = field();
  foe.def = 99; foe.defMax = 99;   // 不打失衡，免得协助攻击插进来
  st.attackerId = kolt.id; st.targetId = foe.id; kolt.ap = 2;
  c.runSkill("kolt_aa");
  kolt.statuses.inspire = true;
  c.runSkill("kolt_aa");
  const s = st.battleStats[kolt.id];
  const name = c.skillDisplayName(kolt, "kolt_aa");
  assert.equal(s.burst.turn, 1);
  assert.equal(s.burst.dmg, s.dmg, "第 1 回合的伤害全算进去");
  assert.deepEqual(Object.keys(s.burst.skills), [name]);
  assert.ok(Object.keys(s.burst.buffs).some(b => /振奋/.test(b)), "振奋记成增益：" + Object.keys(s.burst.buffs).join(" / "));
  assert.ok(!Object.keys(s.burst.buffs).some(b => /[−-]\d/.test(b)), "减益不算");
  // 第 2 回合只打一下：比第 1 回合少，最高纪录不变
  const best = JSON.parse(JSON.stringify(s.burst));
  st.turnNo = 2; kolt.ap = 1; kolt.statuses.inspire = false;
  c.runSkill("kolt_aa");
  assert.equal(s.burstCur.turn, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(s.burst)), best);
  // 敌人回合里的协助攻击算这一回合，记在「协助攻击」名下
  c.burstNote(s, kolt, 1, c.burstLabel({ assist: true }));
  assert.equal(s.burstCur.skills["协助攻击"], 1);
});

test("单回合最高爆发：并进整局记录，只留最高的那一回合并写明哪一场；打得少的场次不覆盖", () => {
  const c = H.load();
  c.LEDGER.reset();
  let f = field(c);
  f.st.battleStats[f.kolt.id] = Object.assign(c.battleStat(f.kolt), { dmg: 50, burst: { turn: 2, dmg: 40, skills: { 电钻: 30, "电钻 · 感电": 10 }, buffs: { "攻击者振奋：ATK +25%": 2 } } });
  c.settleBattleRewards("win");
  f = field(c);
  f.st.battleStats[f.kolt.id] = Object.assign(c.battleStat(f.kolt), { dmg: 20, burst: { turn: 1, dmg: 20, skills: { 电钻: 20 }, buffs: {} } });
  c.settleBattleRewards("win");
  let b = c.careerData().kits.kolt.burst;
  assert.deepEqual([b.dmg, b.turn, b.battleNo], [40, 2, 1]);
  assert.deepEqual(JSON.parse(JSON.stringify(b.skills)), { 电钻: 30, "电钻 · 感电": 10 });
  assert.equal(b.buffs["攻击者振奋：ATK +25%"], 2);
  f = field(c);
  f.st.battleStats[f.kolt.id] = Object.assign(c.battleStat(f.kolt), { dmg: 90, burst: { turn: 3, dmg: 90, skills: { 酸液炮: 90 }, buffs: {} } });
  c.settleBattleRewards("win");
  b = c.careerData().kits.kolt.burst;
  assert.deepEqual([b.dmg, b.turn, b.battleNo], [90, 3, 3]);
  // 跟着存档走
  const saved = JSON.parse(JSON.stringify(c.LEDGER.save()));
  c.LEDGER.reset(); c.LEDGER.load(saved);
  assert.equal(c.careerData().kits.kolt.burst.dmg, 90);
});
