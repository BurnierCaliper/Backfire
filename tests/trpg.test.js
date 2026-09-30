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

test("后台：按叙事直接改血量、坚毅、耐久、状态、时间、奎支，并记下改了什么", () => {
  const { c, st, kolt } = field();
  const w = kolt.linkedKits[0];
  const max = kolt.layers.map(l => l.max);
  const notes = c.trpgBackstageApply({
    day: 5, hours: 30, kuizhi: 777, water: 1234,
    heroes: { kolt: { layers: max.map(() => 3), shp: 1, weapons: { [w]: { dur: 2 } } } }
  }, "坠落");
  assert.match(notes[0], /坠落/);
  assert.equal(c.S.LEDGER.day, 5);
  assert.equal(c.exhaustTier(), 1);
  assert.equal(st.kuizhi, 777);
  assert.equal(c.ledgerWater(), 1234);
  assert.equal(c.totalHpOf(kolt), 3 * max.length);
  assert.equal(kolt.shp, 1);
  assert.equal(c.weaponDur(w), 2);
  // 超上限会被夹住；存进档案，重新摆队伍后还在
  c.trpgBackstageApply({ heroes: { kolt: { weapons: { [w]: { dur: 999 } } } } });
  assert.equal(c.weaponDur(w), c.weaponDurMax(w));
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  c.ledgerApplyToField([]);   // 战斗画面开战前做的那一步
  assert.equal(c.totalHpOf(c.findKit("kolt", c.S.state.units)), 3 * max.length);
  // 状态：打成死亡再救回来，血量 0 时自动给 1 点
  const k2 = c.findKit("kolt", c.S.state.units);
  c.trpgBackstageApply({ heroes: { kolt: { status: "dead", layers: max.map(() => 0) } } });
  assert.equal(k2.dead, true);
  c.trpgBackstageApply({ heroes: { kolt: { status: "ok" } } });
  assert.equal(k2.dead, false);
  assert.equal(c.totalHpOf(k2), 1);
  assert.equal(c.trpgBackstageApply({}).join(), "后台：没有改动。");
});

test("存档：三个空位互不影响；旧版的队伍记忆第一次打开时放进空位 1", () => {
  const c = H.load();
  c.localStorage.setItem("anterscale-campaign", JSON.stringify({ party: [{ kit: "kolt", level: 3 }], kuizhi: 50, ledger: { day: 4 } }));
  let slots = c.trpgReadSlots();
  assert.equal(slots.length, 3);
  assert.equal(slots[0].name, "团 1");
  assert.equal(slots[0].campaign.kuizhi, 50);
  assert.equal(slots[1], null);
  c.trpgWriteSlot(2, { name: "沙穹团", campaign: { kuizhi: 9, partyKits: ["helu"], party: [{ kit: "helu", level: 2 }], ledger: { day: 7 } }, log: [] });
  slots = c.trpgReadSlots();
  assert.equal(slots[0].campaign.kuizhi, 50);
  assert.equal(slots[2].name, "沙穹团");
  const m = c.trpgSlotSummary(slots[2]);
  assert.equal(m.day, 7);
  assert.equal(m.party.join(), "Helumica Lv2");
  c.trpgClearSlot(0);
  assert.equal(c.trpgReadSlots()[0], null);
  assert.equal(c.trpgReadSlots()[2].name, "沙穹团");
  assert.equal(c.trpgValidSlot({ campaign: {}, log: [] }), true);
  assert.equal(c.trpgValidSlot("x"), false);
});

test("跑团模式：击杀经验全队平分、按手册掉落；可选经验 ×2 / ×3", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "bandit_boss", lv: 1, zone: 2 }, { id: "captain_wolf", lv: 1, zone: 2 }] });
  c.S.TRPG.active = true;
  const st = c.S.state;
  st.battleGains = { xp: 0, kuizhi: 0 };
  st.kuizhi = 0;
  const kolt = c.findKit("kolt", st.units);
  const foes = st.units.filter(u => !u.isPlayer);
  c.settleEnemyKill(foes[0], []);
  assert.equal(kolt.xp, 5);                  // 精英 lv1 10 经验，两人平分
  assert.ok(st.kuizhi >= 200 && st.kuizhi <= 650, "强盗头子 3d4×50+50：" + st.kuizhi);
  st.xpMult = 2;
  const before = st.kuizhi;
  c.settleEnemyKill(foes[1], []);
  assert.equal(kolt.xp, 15);                 // 10 × 2 ÷ 2
  assert.ok(st.kuizhi - before >= 150 && st.kuizhi - before <= 400, "狼队长 1d6×50+100");
  assert.equal(st.battleGains.xp, 15);
  // 单局不平分
  c.S.TRPG.active = false;
  const k2 = H.load();
  k2.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  const kk = k2.findKit("kolt", k2.S.state.units);
  k2.settleEnemyKill(k2.S.state.units.find(u => !u.isPlayer), []);
  assert.equal(kk.xp, 5);
});
