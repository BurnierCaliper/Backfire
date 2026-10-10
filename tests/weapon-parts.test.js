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

test("格挡件 / 生命件：不加正补正，带一个负补正和固定 atk；C/B/A/S 各有数据，单局只抽得到 C / B", () => {
  const c = H.load();
  const blk = { C: 5, B: 8, A: 10, S: 12 }, hp = { C: 3, B: 6, A: 8, S: 11 }, step = { C: 0.1, B: 0.15, A: 0.2, S: 0.25 }, flat = { C: 1, B: 1, A: 2, S: 2 };
  Object.keys(blk).forEach(g => {
    const b = c.weaponPartSpec(`${g.toLowerCase()}_block_dex`), h = c.weaponPartSpec(`${g.toLowerCase()}_hp_str`);
    assert.equal(b.block, blk[g]); assert.equal(h.hpPerLv, hp[g]);
    assert.equal(JSON.stringify(b.coef), JSON.stringify({ dex: -step[g] }), "只有负补正");
    assert.equal(JSON.stringify(h.coef), JSON.stringify({ str: -step[g] }));
    assert.equal(c.weaponPartFlatAtk(`${g.toLowerCase()}_block_dex`), flat[g]);
  });
  assert.equal(c.weaponPartSpec("c_block_int").name, "缓冲护板-beta");
  assert.equal(c.weaponPartSpec("s_hp_con").name, "加固框架-omega");
  assert.match(c.weaponPartText("b_block_dex"), /^atk \+1，格挡率 \+8%，敏捷补正 −0\.15$/);
  assert.match(c.weaponPartText("a_hp_str"), /atk \+2，武器人每级装甲 \+8，力量补正 −0\.2/);
  // 单局只给 C / B：抽 100 次也不会出 A / S；功能件抽得到
  let seed = 7; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const got = []; for (let i = 0; i < 200; i++) got.push(c.rollWeaponPart({ C: 1, B: 1 }, rnd));
  assert.ok(got.every(id => /^[cb]_/.test(id)));
  assert.ok(got.some(id => /_block_/.test(id)) && got.some(id => /_hp_/.test(id)) && got.some(id => /_(str|dex|int)_/.test(id)));
  // A / S 只有功能件
  for (let i = 0; i < 30; i++) assert.match(c.rollWeaponPart({ S: 1 }, rnd), /^s_(block|hp)_/);
});

test("格挡件：拿在手里加到角色的协助格挡，武器人独立在场时加到它自己", () => {
  const c = field();
  const kolt = c.findKit("kolt", c.S.state.units);
  c.setOwnedWeaponLevel(kolt, "torque", 7);
  const before = c.blockChance(kolt);
  c.installWeaponPart(kolt, "torque", 0, "c_block_dex", true);
  c.installWeaponPart(kolt, "torque", 1, "b_block_int", true);
  // C +5 和 B +8 叠加：扭矩 35 + 13 = 48（格挡率不封顶，作者定）
  assert.equal(c.blockChance(kolt), Math.min(100, before + 13), "C +5 和 B +8 叠加");
  assert.equal(c.weaponBlockBonusOf("torque", kolt), 48);
  assert.equal(c.SkillText.armoryData().find(h => h.kit === "kolt").weapons.find(x => x.kit === "torque").blockBonus, 48, "武器工坊的持握格挡");
  // 武器人独立在场：它自己的格挡率也加
  const tq = c.spawnWeapon(kolt, "torque");
  assert.ok(tq && !tq.hidden);
  assert.equal(c.blockChance(tq), Math.min(100, c.bareBlockChance(tq) + 48));
});

test("生命件：武器人每级装甲加成（按武器等级），装上 / 拆下马上改场上武器人的装甲；资料面板也算进去", () => {
  const c = field();
  const kolt = c.findKit("kolt", c.S.state.units);
  c.setOwnedWeaponLevel(kolt, "torque", 7);
  const base = c.weaponUnitHp("torque", 7, []).armor;
  assert.equal(c.weaponUnitHp("torque", 7, ["c_hp_dex"]).armor, base + 3 * 7);
  assert.equal(c.weaponUnitHp("torque", 7, ["c_hp_dex", "b_hp_int"]).armor, base + 9 * 7);
  const tq = c.spawnWeapon(kolt, "torque");
  assert.equal(tq.layers.find(l => l.type === "armor").max, base, "没装生命件");
  c.installWeaponPart(kolt, "torque", 0, "b_hp_int", true);
  assert.equal(tq.layers.find(l => l.type === "armor").max, base + 6 * 7, "装上马上变");
  c.applyWeaponLevel(tq);
  assert.equal(tq.layers.find(l => l.type === "armor").max, base + 6 * 7, "重新按等级算也一样");
  const w = c.SkillText.armoryData().find(h => h.kit === "kolt").weapons.find(x => x.kit === "torque");
  assert.equal(w.layers.find(l => l.type === "armor").max, base + 6 * 7, "武器工坊也算进去");
  c.removeWeaponPart(kolt, "torque", 0);
  assert.equal(tq.layers.find(l => l.type === "armor").max, base, "拆下马上变回来");
  // 必哩没有装甲层：加在护盾上
  const bili = c.weaponUnitHp("bili", 3, ["c_hp_dex"]);
  assert.equal(bili.shield, 10 + 4 * 2 + 3 * 3);
});
