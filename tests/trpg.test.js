// 跑团模式：探索环节的规则（trpg.js），数值照手册
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  c.S.TRPG.active = true;
  const kolt = c.findKit("kolt", c.S.state.units);
  return { c, st: c.S.state, kolt };
}

test("商店照手册价格：买扣奎支，钱不够不给；主持人给予不扣钱", () => {
  const { c, st } = field();
  st.kuizhi = 1500;
  const before = c.bagCount("medkit");
  c.trpgBuy("medkit", 2, false);
  assert.equal(st.kuizhi, 300);
  assert.equal(c.bagCount("medkit"), before + 2);
  const n = c.trpgBuy("mat_metal", 1, false);
  assert.match(n[0], /奎支不够/);
  assert.equal(st.kuizhi, 300);
  c.trpgBuy("mat_heart", 1, true);
  assert.equal(c.bagCount("mat_heart"), 1);
  assert.equal(st.kuizhi, 300);
  const w = c.ledgerWater();
  c.trpgBuy("water_1000", 2, true);
  assert.equal(c.ledgerWater(), w + 2000);
});

test("手动增减：奎支不会减到负数，物品不会减到负数", () => {
  const { c, st } = field();
  st.kuizhi = 100;
  c.trpgAdjustKuizhi(-500);
  assert.equal(st.kuizhi, 0);
  c.trpgAdjustItem("rope", 2);
  c.trpgAdjustItem("rope", -5);
  assert.equal(c.bagCount("rope"), 0);
});

test("推进时间：20 小时力竭 1，80 小时全员力竭致死", () => {
  const { c, st } = field();
  c.trpgPassHours(20);
  assert.equal(c.exhaustTier(), 1);
  c.trpgPassHours(60);
  assert.equal(c.exhaustTier(), 4);
  assert.ok(st.units.filter(u => u.isPlayer && !c.isWeaponUnit(u)).every(u => u.dead));
});

test("长休清空力竭；不扣补给的长休不动水和食物", () => {
  const { c } = field();
  c.trpgPassHours(30);
  const w = c.ledgerWater();
  c.trpgLongRest({ hours: 8, force: true });
  assert.equal(c.exhaustTier(), 0);
  assert.equal(c.ledgerWater(), w);
});

test("武器升级：4 级以内自己升只耗材料；5 级要找工匠付费；主持人直接升不耗", () => {
  const { c, st, kolt } = field();
  const kit = kolt.linkedKits[0];
  c.bagAdd("mat_metal", 3);
  let n = c.trpgUpgradeWeapon("kolt", kit, "self");
  assert.equal(c.trpgWeaponLevel(kolt, kit), 2, n.join());
  assert.equal(c.bagCount("mat_metal"), 0);
  // 材料不够
  n = c.trpgUpgradeWeapon("kolt", kit, "self");
  assert.match(n[0], /材料不够/);
  c.trpgUpgradeWeapon("kolt", kit, "gm");
  c.trpgUpgradeWeapon("kolt", kit, "gm");
  assert.equal(c.trpgWeaponLevel(kolt, kit), 4);
  c.bagAdd("mat_alloy", 2); c.bagAdd("mat_metal", 2);
  n = c.trpgUpgradeWeapon("kolt", kit, "self");
  assert.match(n[0], /工匠/);
  st.kuizhi = 9000;
  c.trpgUpgradeWeapon("kolt", kit, "smith", 8000);
  assert.equal(c.trpgWeaponLevel(kolt, kit), 5);
  assert.equal(st.kuizhi, 1000);
  assert.equal(c.bagCount("mat_alloy"), 0);
});

test("发经验会升级；属性点不能在 8 级加回同一项", () => {
  const { c, kolt } = field();
  c.trpgGiveXp(["kolt"], c.xpToNext(1));
  assert.equal(kolt.level, 2);
  kolt.attrPoints = 2;
  const a = require("vm").runInContext("Object.keys(ATTR_NAMES)[0]", c);
  c.trpgSpendAttr("kolt", a);
  assert.equal(kolt.attrPoints, 1);
  const n = c.trpgSpendAttr("kolt", a);
  assert.match(n[0], /同一项/);
  assert.equal(kolt.attrPoints, 1);
});
