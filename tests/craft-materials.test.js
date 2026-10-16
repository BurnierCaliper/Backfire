// 制作材料（docs/workshop-design.md 第 4 节）：7 种、队伍公用、按敌人类型掉落、单局打赢后进背包、跑团黑市 3 倍价
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");
const build = (c, id, lv) => c.enemyPresets().find(x => x.id === id).build(lv || 10, 4);

test("7 种制作材料登记在物品表里：队伍公用、不是战斗道具", () => {
  const c = H.load();
  const mats = vm.runInContext("CRAFT_MATERIALS", c);
  assert.equal(mats.length, 7);
  mats.forEach(m => { const s = c.ITEM_CATALOG[m.id]; assert.ok(s && s.supply && !s.combat, m.id); });
});

test("按敌人类型掉：机械（装甲 / 护盾）掉废料，电系掉废线圈，酸 / 火系掉化工残液，沙尘层掉沙鱼鳞，星灵层掉星灵组织", () => {
  const c = H.load();
  const kinds = (id, n) => { const seen = new Set(); for (let i = 0; i < (n || 300); i++) c.rollCraftMaterials(build(c, id)).forEach(m => seen.add(m.id)); return [...seen].sort(); };
  assert.ok(kinds("guard_sword").includes("cm_coil") && kinds("guard_sword").includes("cm_scrap"));
  assert.ok(kinds("dumpdrone").includes("cm_chem"));
  assert.ok(kinds("sandfish_drive").includes("cm_scale"));
  assert.ok(kinds("meteor_spider").includes("cm_spirit"));
  assert.deepEqual(kinds("thug_knife"), [], "人形狂徒什么都不掉");
});

test("首领保底精制料；精英常见料保底 1 份", () => {
  const c = H.load();
  for (let i = 0; i < 20; i++) {
    const king = c.rollCraftMaterials(build(c, "outlaw_king"));
    assert.ok(king.some(m => m.id === "cm_gas" && m.qty >= 1), "亡命之王（火）保底燃气浓缩物");
    const gas = c.rollCraftMaterials(build(c, "gas_collector"));
    assert.ok(gas.some(m => m.id === "cm_chem" && m.qty >= 1));
  }
});

test("单局打赢：打倒的敌人掉的材料合成一行进背包；召唤物、中立生物不掉", () => {
  const c = H.load(), R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed: "MATS" });
  run.act = 1; run.actDay = 8; run.stage = "boss";
  const spec = R.battleSpec(run);
  c.BattleSim.setup(spec);
  const st = c.S.state;
  st.units.filter(u => !u.isPlayer).forEach(u => { u.dead = true; u.layers.forEach(l => { l.current = 0; }); });
  const before = vm.runInContext("CRAFT_MATERIALS", c).map(m => c.bagCount(m.id)).reduce((a, b) => a + b, 0);
  const notes = R.finishBattle(run, "win");
  const after = vm.runInContext("CRAFT_MATERIALS", c).map(m => c.bagCount(m.id)).reduce((a, b) => a + b, 0);
  assert.ok(after > before, "拿到了材料");
  assert.ok(notes.some(n => /^材料：/.test(n)), notes.join("\n"));
});

test("跑团物品表：制作材料在黑市按参考价 3 倍卖", () => {
  const c = H.load();
  const rows = vm.runInContext("HANDBOOK_SHOP", c).filter(r => r.group === "制作材料（黑市）");
  assert.equal(rows.length, 7);
  const scrap = rows.find(r => r.key === "cm_scrap");
  assert.equal(scrap.price, 300);
});
