"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const vm = require("node:vm");
const plain = x => JSON.parse(JSON.stringify(x));

function field() {
  const c = H.load();
  c.S.RNG.install("WEAPON-PARTS");
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "WEAPON-PARTS" });
  c.S.TRPG.active = true;
  c.S.state.bag = { items: [] };
  return c;
}

test("改装槽：武器 3 级开 1 槽，7 级再开 1 槽", () => {
  const c = H.load();
  assert.deepEqual([1, 2, 3, 4, 6, 7, 10].map(lv => c.weaponPartSlots(lv)), [0, 0, 1, 1, 1, 2, 2]);
});

test("配重块-beta（C 级）：力量补正 +0.1、敏捷补正 −0.1，并按补正重算武器攻击力", () => {
  const c = H.load();
  assert.deepEqual(plain(c.weaponCoefs("torque", ["c_str_dex"])), { str: 0.4, int: 0.2, dex: -0.1 });
  const attrs = { str: 10, dex: 8, int: 6 };
  // 5 级：base 2+4，tier 2.5
  assert.equal(c.computeWeaponAtk("torque", attrs, 5), Math.round(6 + (10 * 0.3 + 6 * 0.2) * 2.5));
  // 补正改变之后再加 C 级的固定 +1 atk
  assert.equal(c.computeWeaponAtk("torque", attrs, 5, ["c_str_dex"]), Math.round(6 + (10 * 0.4 + 6 * 0.2 - 8 * 0.1) * 2.5) + 1);
  assert.match(c.weaponPartCoefText(c.weaponPartSpec("c_str_dex").coef), /力量补正 \+0\.1，敏捷补正 −0\.1/);
});

test("装上从背包拿、拆下放回背包；槽数不够装不上；攻击力跟着变", () => {
  const c = field();
  const kolt = c.findKit("kolt", c.S.state.units);
  const kit = kolt.linkedKits[0];
  const item = c.weaponPartItemId("c_str_dex");
  assert.ok(c.ITEM_CATALOG[item], "改装件登记进背包物品表");
  c.bagAdd(item, 1);
  assert.match(c.trpgInstallPart("kolt", kit, 0, "c_str_dex").join(""), /3 级才有改装槽/);
  assert.equal(c.bagCount(item), 1);

  kolt.attrs.str = 20;
  c.setOwnedWeaponLevel(kolt, kit, 3);
  const before = kolt.weaponAtk;
  const lines = c.Commands.dispatch(plain({ type: "trpg", action: "installPart", owner: "kolt", kit, slot: 0, part: "c_str_dex" }));
  assert.equal(c.bagCount(item), 0);
  assert.deepEqual(plain(c.weaponPartsOf(kolt, kit)), ["c_str_dex"]);
  const lv = kolt.weaponLevels[kit];
  assert.equal(kolt.weaponAtk, c.computeWeaponAtk(kit, kolt.attrs, lv, ["c_str_dex"]));
  assert.ok(kolt.weaponAtk > before, "力量高、敏捷低：配重块让攻击力变高");
  assert.equal(kolt.atk, kolt.personalAtk + kolt.weaponAtk);
  assert.ok(lines);

  // 没有第二个槽
  assert.match(c.trpgInstallPart("kolt", kit, 1, "c_str_dex", true).join(""), /只有 1 个改装槽/);
  // 拆下放回背包
  c.Commands.dispatch(plain({ type: "trpg", action: "removePart", owner: "kolt", kit, slot: 0 }));
  assert.equal(c.bagCount(item), 1);
  assert.deepEqual(plain(c.weaponPartsOf(kolt, kit)), []);
  assert.equal(kolt.weaponAtk, before);
});

test("武器降级槽位变少：多出来的改装件退回背包", () => {
  const c = field();
  const kolt = c.findKit("kolt", c.S.state.units);
  const kit = kolt.linkedKits[0];
  c.setOwnedWeaponLevel(kolt, kit, 7);
  c.trpgInstallPart("kolt", kit, 0, "c_str_dex", true);
  c.trpgInstallPart("kolt", kit, 1, "c_str_dex", true);
  assert.equal(c.weaponPartsOf(kolt, kit).length, 2);
  c.setOwnedWeaponLevel(kolt, kit, 4);
  assert.equal(c.weaponPartsOf(kolt, kit).length, 1);
  assert.equal(c.bagCount(c.weaponPartItemId("c_str_dex")), 1);
});

test("改装槽进存档：跑团战役记忆和角色资料都带上", () => {
  const c = field();
  const kolt = c.findKit("kolt", c.S.state.units);
  const kit = kolt.linkedKits[0];
  c.setOwnedWeaponLevel(kolt, kit, 3);
  c.trpgInstallPart("kolt", kit, 0, "c_str_dex", true);
  const sheet = c.SkillText.sheetData().find(h => h.kit === "kolt");
  const w = sheet.weapons.find(x => x.kit === kit);
  assert.equal(w.mods.slots[0].id, "c_str_dex");
  assert.equal(w.mods.nextSlotLv, 7);
  assert.equal(w.atk, kolt.weaponAtk);
  const src = require("node:fs").readFileSync(require("node:path").join(H.ROOT, "game.js"), "utf8");
  assert.match(src, /weaponParts: u\.weaponParts \?/);
  assert.match(src, /if \(s\.weaponParts\) u\.weaponParts =/);
});

test("改装件固定加 atk：C / B 级 +1、A / S 级 +2，不随等级和属性变；两个槽叠加", () => {
  const c = H.load();
  assert.equal(c.weaponPartFlatAtk("c_str_dex"), 1);
  assert.equal(c.weaponPartFlatAtk("b_int_con"), 1);
  const T = vm.runInContext("WEAPON_PART_FLAT_ATK", c);
  assert.equal(T.A, 2);
  assert.equal(T.S, 2);
  // A / S 级以后加进来时按等级自动拿 +2
  vm.runInContext(`WEAPON_PARTS.test_a = { name: "测试件", grade: "A", coef: {} }; WEAPON_PARTS.test_s = { name: "测试件", grade: "S", coef: {}, atk: 3 };`, c);
  assert.equal(c.weaponPartFlatAtk("test_a"), 2);
  assert.equal(c.weaponPartFlatAtk("test_s"), 3, "单独写了 atk 就用它");
  // 不随等级 / 属性变：同一个只改系数为 0 的件，差值永远是固定的
  vm.runInContext(`WEAPON_PARTS.test_c0 = { name: "零补正", grade: "C", coef: {} };`, c);
  [1, 4, 9].forEach(lv => [{ str: 5 }, { str: 30, int: 20 }].forEach(at => {
    assert.equal(c.computeWeaponAtk("torque", at, lv, ["test_c0"]) - c.computeWeaponAtk("torque", at, lv, []), 1);
    assert.equal(c.computeWeaponAtk("torque", at, lv, ["test_c0", "test_a"]) - c.computeWeaponAtk("torque", at, lv, []), 3);
  }));
  // 说明文字带上固定 atk
  assert.match(c.weaponPartText("c_str_dex"), /^atk \+1，力量补正 \+0\.1，敏捷补正 −0\.1$/);
  // 按成长表算的武器（没有补正公式）也加
  const k = vm.runInContext("Object.keys(WEAPON_GROWTH).find(k => !WEAPON_FORMULA[k])", c);
  if (k) assert.equal(c.computeWeaponAtk(k, {}, 3, ["test_c0"]) - c.computeWeaponAtk(k, {}, 3, []), 1);
});
