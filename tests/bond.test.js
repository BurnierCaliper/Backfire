// 羁绊：玩家角色和武器之间 0–5 级。加在武器等级上只用来解锁武器升级奖励（改装槽、被动升级），不提高任何数值
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  c.S.TRPG.active = true;
  const kolt = c.findKit("kolt", c.S.state.units);
  return { c, st: c.S.state, kolt, w: kolt.linkedKits[0] };
}

test("武器 2 级 + 羁绊 1 级 = 3 级：开放第一个改装槽；atk 不变", () => {
  const { c, kolt, w } = field();
  c.setOwnedWeaponLevel(kolt, w, 2);
  const atk0 = kolt.atk, wAtk0 = c.computeWeaponAtk(w, kolt.attrs, 2, []);
  assert.equal(c.weaponPartRow(kolt, w).length, 0);
  c.setWeaponBond(kolt, w, 1);
  assert.equal(c.weaponBond(kolt, w), 1);
  assert.equal(c.weaponRewardLevel(kolt, w), 3);
  assert.equal(c.weaponPartRow(kolt, w).length, 1, "开放 1 个改装槽");
  assert.equal(kolt.atk, atk0, "羁绊不提高 atk");
  assert.equal(c.computeWeaponAtk(w, kolt.attrs, 2, []), wAtk0);
  assert.equal(kolt.weaponLevels[w], 2, "武器等级没变");
  c.setWeaponBond(kolt, w, 9);
  assert.equal(c.weaponBond(kolt, w), 5, "最多 5 级");
  c.setWeaponBond(kolt, w, -3);
  assert.equal(c.weaponBond(kolt, w), 0);
});

test("被动升级也按「武器等级 + 羁绊」解锁", () => {
  const { c, kolt, w } = field();
  c.setOwnedWeaponLevel(kolt, w, 3);
  assert.equal(c.passivePlus(kolt, 1), false);
  c.setWeaponBond(kolt, w, 2);
  assert.equal(c.passivePlus(kolt, 1), true, "3 + 2 = 5 级：被动 1 升级");
  assert.equal(c.passivePlus(kolt, 2), false);
});

test("羁绊降下来槽位变少：多出来的改装件退回背包", () => {
  const { c, kolt, w } = field();
  c.setOwnedWeaponLevel(kolt, w, 2);
  c.setWeaponBond(kolt, w, 1);
  const part = c.weaponPartIds()[0];
  c.bagAdd(c.weaponPartItemId(part), 1);
  c.installWeaponPart(kolt, w, 0, part);
  assert.equal(c.weaponPartsOf(kolt, w).length, 1);
  const notes = [];
  c.setWeaponBond(kolt, w, 0, notes);
  assert.equal(c.weaponPartsOf(kolt, w).length, 0);
  assert.equal(c.bagCount(c.weaponPartItemId(part)), 1);
  assert.match(notes.join(""), /退回背包/);
});

test("跑团后台：主持人改羁绊，记下改动；武器工坊显示羁绊和解锁进度", () => {
  const { c, kolt, w } = field();
  c.setOwnedWeaponLevel(kolt, w, 2);
  const notes = c.trpgBackstageApply({ heroes: { kolt: { weapons: { [w]: { bond: 1 } } } } }, "并肩作战");
  assert.match(notes.join(""), /羁绊 0 → 1/);
  assert.equal(c.weaponBond(kolt, w), 1);
  c.trpgBackstageApply({ heroes: { kolt: { weapons: { [w]: { bond: 99 } } } } });
  assert.equal(c.weaponBond(kolt, w), 5);
  c.setWeaponBond(kolt, w, 1);
  const a = c.SkillText.armoryData().find(h => h.kit === "kolt").weapons.find(x => x.kit === w);
  assert.equal(a.level, 2);
  assert.equal(a.bond, 1);
  assert.equal(a.rewardLevel, 3);
  assert.equal(a.slots.length, 1);
  assert.deepEqual([...a.lockedSlots], [7]);
  assert.ok(a.track.find(t => t.lv === 3).done);
});
