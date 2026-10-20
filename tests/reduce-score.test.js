// 新得分：受击时减伤减免的伤害 ×1.5；协助格挡成功减免的伤害 ×1
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["tou", "ruby", "kolt"], enemies: [{ id: "thug_hammer", lv: 1, zone: 1 }], seed: "RS" });
  c.startCombat();
  const st = c.S.state;
  st.units.forEach(u => { u.zone = 1; });
  c.findKit("tou", st.units).zone = 2;   // 灯不和敌人同区：不然敌人被决一死战拦着，只打得到灯
  st.units.filter(u => u.isPlayer).forEach(u => { u.bonus = 0; u.layers.forEach(l => { l.current = l.max = 300; }); });
  const foe = st.units.find(u => !u.isPlayer);
  st.combatPhase = "enemy";
  c.resetBattleRecords();
  return { c, st, foe, tou: c.findKit("tou", st.units), ruby: c.findKit("ruby", st.units), kolt: c.findKit("kolt", st.units) };
}
const hitOpt = (flat, extra) => Object.assign({ atk: 0, mult: 0, flat, element: "physical", baseBreak: 0, flags: Object.assign({ action: true, blockResolved: true }, extra || {}) }, {});

test("没有减伤：不加分", () => {
  const { c, st, foe, ruby } = field();
  ruby.layers = [{ type: "flesh", current: 300, max: 300 }];
  c.dealTo(foe, ruby, hitOpt(10));
  assert.equal(st.battleScore.parts.reduce || 0, 0);
});

test("有减伤（目标减伤 50%）：减免的伤害 ×1.5 记成「减伤」分，记在受击者身上", () => {
  const { c, st, foe, ruby } = field();
  ruby.layers = [{ type: "flesh", current: 300, max: 300 }];
  c.dealTo(foe, ruby, hitOpt(20, { dr50: true }));
  assert.equal(st.battleStats[ruby.id].reduced, 10);
  assert.equal(st.battleScore.parts.reduce, 15);
});

test("完全免伤（屹立不倒）也算：整击都是减免", () => {
  const { c, st, foe, kolt } = field();
  kolt.resources.standTurn = true;
  c.dealTo(foe, kolt, hitOpt(12));
  assert.equal(st.battleStats[kolt.id].reduced, 12);
  assert.equal(st.battleScore.parts.reduce, 18);
});

test("协助格挡成功：减免的伤害 ×1.2（向下取整）记成「格挡减免」分，记在格挡的人身上，不算受击者的减伤", () => {
  const { c, st, foe, ruby, kolt } = field();
  kolt.layers = [{ type: "flesh", current: 300, max: 300 }];
  ruby.bonus = 1;
  c.dealTo(foe, kolt, hitOpt(8, { blockResolved: false }));
  c.finishBlock(ruby.id, { roll: 1, ok: true, chance: 60 });
  assert.equal(st.battleScore.parts.blockSave, 9, "8 × 1.2 = 9.6 → 9");
  assert.equal(st.battleStats[ruby.id].avoided, 8);
  assert.equal(st.battleScore.parts.reduce || 0, 0);
});

test("空手格挡成功：少挨的那一半算格挡减免，不重复算成减伤", () => {
  const { c, st, foe, ruby, kolt } = field();
  // 目标用没有减伤被动的 ruby（柯尔特满血有「过度自信」）
  ruby.layers = [{ type: "flesh", current: 300, max: 300 }];
  kolt.bonus = 1; kolt.weaponHeld = false;
  c.dealTo(foe, ruby, hitOpt(10, { blockResolved: false }));
  c.finishBlock(kolt.id, { roll: 1, ok: true, chance: 60 });
  assert.equal(st.battleScore.parts.blockSave, 6, "少挨 5 点 × 1.2 = 6");
  assert.equal(st.battleScore.parts.reduce || 0, 0);
});

test("柯尔特废物利用：给自己回的血 / 加的层也算治疗，计分", () => {
  const { c, st, kolt } = field();
  kolt.level = 3; kolt.ap = 3;
  st.combatPhase = "player";
  kolt.layers = [{ type: "flesh", current: 100, max: 300 }];
  st.lastBrokenLayer = { type: "flesh", lost: 10, dmg: 5 };
  c.dispatch({ type: "skill", actor: kolt.id, skill: "kolt_scrap", target: null, picks: {} });
  assert.equal(st.battleStats[kolt.id].heal, 10);
  assert.equal(st.battleScore.parts.heal, 15, "治疗每点 1.5 分");
  st.lastBrokenLayer = { type: "armor", lost: 8, dmg: 4 };
  kolt.ap = 3;
  c.dispatch({ type: "skill", actor: kolt.id, skill: "kolt_scrap", target: null, picks: {} });
  assert.equal(st.battleStats[kolt.id].heal, 18);
});
