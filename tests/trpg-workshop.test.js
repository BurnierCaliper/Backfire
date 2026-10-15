// 跑团工坊（docs/workshop-design.md 第 5–7 节）：配方和积分记在队伍账上，制作检定可以程序掷或记下玩家的结果
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  c.S.TRPG.active = true;
  c.S.state.kuizhi = 100000;
  const LEDGER = vm.runInContext("LEDGER", c);
  return { c, st: c.S.state, LEDGER };
}

test("商店积分：在跑团商店花钱也攒积分（零头累计）；主持人给予不算；记在队伍账上", () => {
  const { c, LEDGER } = field();
  c.trpgBuy("mat_metal", 2, false);   // 2000
  assert.equal(c.trpgPointsInfo().points, 0);
  c.trpgBuy("mat_metal", 1, false);   // 累计 3000
  assert.equal(c.trpgPointsInfo().points, 1);
  c.trpgBuy("mat_metal", 5, true);
  assert.equal(c.trpgPointsInfo().points, 1);
  assert.equal(LEDGER.save().workshop.points, 1, "跟着队伍档案存");
});

test("主持人增减积分；兑换自我效果道具", () => {
  const { c } = field();
  c.trpgAdjustPoints(5, "剧情奖励");
  assert.equal(c.trpgPointsInfo().points, 5);
  c.trpgRedeem("fx_s_anchor");   // 4 积分
  assert.equal(c.bagCount("fx_s_anchor"), 1);
  assert.equal(c.trpgPointsInfo().points, 1);
  assert.match(c.trpgRedeem("fx_s_burn")[0], /积分不够/);
  c.trpgAdjustPoints(-9);
  assert.equal(c.trpgPointsInfo().points, 0, "不会扣成负数");
});

test("配方：简单的一开始就会；主持人教会 / 收回；存档读回来还在", () => {
  const { c, LEDGER } = field();
  assert.ok(c.trpgKnowsRecipe("fx_shock"));
  assert.ok(!c.trpgKnowsRecipe("fx_overload"));
  c.trpgTeachRecipe("fx_overload", true);
  assert.ok(c.trpgKnowsRecipe("fx_overload"));
  const saved = LEDGER.save();
  LEDGER.reset();
  assert.ok(!c.trpgKnowsRecipe("fx_overload"));
  LEDGER.load(saved);
  assert.ok(c.trpgKnowsRecipe("fx_overload"));
  c.trpgTeachRecipe("fx_overload", false);
  assert.ok(!c.trpgKnowsRecipe("fx_overload"));
});

test("制作：记下玩家掷的结果；成功扣材料、给道具、推进时间；还不会的配方做不了", () => {
  const { c, LEDGER } = field();
  c.bagAdd("cm_scrap", 2); c.bagAdd("cm_cell", 1); c.bagAdd("cm_coil", 1);
  assert.match(c.trpgCraft({ kit: "kolt", item: "fx_overload", result: "ok" })[0], /还不会/);
  c.trpgTeachRecipe("fx_overload", true);
  const h0 = LEDGER.hours;
  c.trpgCraft({ kit: "kolt", item: "fx_overload", result: "ok" });
  assert.equal(c.bagCount("fx_overload"), 1);
  assert.equal(c.bagCount("cm_scrap") + c.bagCount("cm_cell") + c.bagCount("cm_coil"), 0);
  assert.equal(LEDGER.hours - h0, 1);
});

test("制作失败：非壳体丢一半（向上取整），废料留着", () => {
  const { c } = field();
  c.bagAdd("cm_scrap", 2); c.bagAdd("cm_cell", 1); c.bagAdd("cm_coil", 1);
  c.trpgTeachRecipe("fx_overload", true);
  c.trpgCraft({ kit: "kolt", item: "fx_overload", result: "fail" });
  assert.equal(c.bagCount("fx_overload"), 0);
  assert.equal(c.bagCount("cm_scrap"), 2);
  assert.equal(c.bagCount("cm_cell") + c.bagCount("cm_coil"), 1);
});

test("成功率：主持人可以改难度；打下手给优势；材料不够不开工", () => {
  const { c } = field();
  assert.equal(c.trpgCraftOdds("kolt", "fx_overload").chance, 0.5);          // 电器维修 1 级 · 普通
  assert.equal(c.trpgCraftOdds("kolt", "fx_overload", "easy").chance, 1);
  assert.equal(c.trpgCraftOdds("kolt", "fx_overload", null, "helu").chance, 0.75);
  c.trpgTeachRecipe("fx_overload", true);
  assert.match(c.trpgCraft({ kit: "kolt", item: "fx_overload", result: "roll" })[0], /材料不够/);
});

test("拆解：和单局一样", () => {
  const { c } = field();
  c.bagAdd("fx_overload", 1);
  c.trpgSalvage("fx_overload");
  assert.equal(c.bagCount("cm_scrap"), 2);
  assert.equal(c.bagCount("cm_coil"), 1);
});
