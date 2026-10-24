// 长休没选吃什么时，默认按库存给每人分食物（#340 第 2 条）：总量够就能长休，不再只认最便宜的一种；
// 长休的食物加成按真的吃了的那种算（#340 第 2 条复核时发现：以前扣完食物才取默认，可能按没吃的美食算）
// 柯尔特是兽人（长休吃 3 份），夕夏、Helumica 各 2 份
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const H = require("./headless");
const plain = (x) => JSON.parse(JSON.stringify(x));

function field(kits, foods) {
  const c = H.load();
  c.BattleSim.setup({ party: kits, enemies: [], seed: "REST-FOOD" });
  c.S.state.bag = { items: [] };
  c.setLedgerWater(10000);
  Object.keys(foods).forEach(id => c.bagAdd(id, foods[id]));
  return c;
}
const hero = (c, kit) => c.partyHeroes().find(h => h.kit === kit);
const eats = (c, plan) => Object.fromEntries(c.longRestOptions(plan || {}).heroes.map(h => [h.kit, h.foodId]));

test("流食 2、罐头 6：默认柯尔特吃罐头、夕夏吃流食，够长休（以前报「流食 差 3 份」）", () => {
  const c = field(["kolt", "xia"], { food_liquid: 2, food_can: 6 });
  const need = plain(c.longRestNeeds({}));
  assert.equal(need.ok, true, need.lack.join());
  assert.deepEqual(need.food, { food_can: 3, food_liquid: 2 });
  assert.deepEqual(eats(c), { kolt: "food_can", xia: "food_liquid" });
  assert.equal(c.longRestOptions({}).need.ok, true);
  // 营地画面：不再一边写「食物 5/8」一边写「差 3 份」
  const camp = plain(c.campStatus({}));
  assert.equal(camp.ok, true);
  assert.deepEqual(camp.lack, []);
  assert.deepEqual(camp.food, { need: 5, have: 8 });
});

test("一种都不够一个人吃时，挑得出够吃的分法就用它（不是按队伍顺序贪心）", () => {
  // 流食 4、罐头 3，三人要 3 + 2 + 2 = 7：只有「柯尔特吃罐头，另外两人吃流食」够
  const c = field(["xia", "helu", "kolt"], { food_liquid: 4, food_can: 3 });
  const need = plain(c.longRestNeeds({}));
  assert.equal(need.ok, true, need.lack.join());
  assert.deepEqual(eats(c), { xia: "food_liquid", helu: "food_liquid", kolt: "food_can" });
});

test("够吃的分法里挑最省的：先吃便宜的，好食物留着", () => {
  const c = field(["kolt", "xia"], { food_liquid: 3, food_can: 3, food_gourmet: 5 });
  assert.deepEqual(eats(c), { kolt: "food_liquid", xia: "food_can" });
  const c2 = field(["kolt", "xia"], { food_liquid: 9, food_gourmet: 5 });
  assert.deepEqual(eats(c2), { kolt: "food_liquid", xia: "food_liquid" }, "便宜的够就都吃便宜的");
});

test("份数一样的两个人：前面的人先吃便宜的", () => {
  const c = field(["xia", "helu"], { food_liquid: 2, food_can: 2 });
  const order = c.partyHeroes().map(h => h.kit);
  assert.equal(c.longRestNeeds({}).ok, true);
  const e = eats(c);
  assert.equal(e[order[0]], "food_liquid");
  assert.equal(e[order[1]], "food_can");
});

test("已经选了吃什么的人照选的吃，没选的人在剩下的库存里分", () => {
  const c = field(["kolt", "xia"], { food_liquid: 3, food_can: 2 });
  const plan = { food: { kolt: "food_liquid" } };
  const need = plain(c.longRestNeeds(plan));
  assert.equal(need.ok, true, need.lack.join());
  assert.deepEqual(eats(c, plan), { kolt: "food_liquid", xia: "food_can" });
  // 选了不够的：照选的吃、照样报缺，别人不受影响
  const bad = plain(c.longRestNeeds({ food: { kolt: "food_can" } }));
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.lack, ["罐头食品 差 1 份"]);
  assert.deepEqual(eats(c, { food: { kolt: "food_can" } }), { kolt: "food_can", xia: "food_liquid" });
});

test("怎么分都不够：报的是缺得最少的分法（流食 2、罐头 2，两人要 5 份 → 差 1 份）", () => {
  const c = field(["kolt", "xia"], { food_liquid: 2, food_can: 2 });
  const need = plain(c.longRestNeeds({}));
  assert.equal(need.ok, false);
  assert.deepEqual(need.lack, ["流食 差 1 份"]);
  // 背包里一份食物都没有：照旧都记在最便宜的那种上
  const none = plain(field(["kolt", "xia"], {}).longRestNeeds({}));
  assert.deepEqual(none.food, { food_liquid: 5 });
  assert.deepEqual(none.lack, ["流食 差 5 份"]);
});

test("长休按默认分配扣食物；食物加成按真的吃了的那种算（以前扣完流食再取默认，按美食算）", () => {
  const c = field(["kolt", "xia"], { food_liquid: 5, food_gourmet: 1 });
  c.partyHeroes().forEach(h => { h.shp = 0; h.shpMax = 100; });
  const r = c.ledgerLongRest({ hours: 8 }, []);
  assert.equal(r.ok, true);
  assert.equal(c.bagCount("food_liquid"), 0);
  assert.equal(c.bagCount("food_gourmet"), 1, "美食没吃");
  assert.equal(hero(c, "kolt").shp, 16, "流食没有加成：8 小时 × 2");
  assert.equal(hero(c, "xia").shp, 16);
  assert.doesNotMatch(r.notes.join("\n"), /食物 \+/);

  const c2 = field(["kolt", "xia"], { food_liquid: 2, food_can: 6 });
  c2.partyHeroes().forEach(h => { h.shp = 0; h.shpMax = 100; });
  assert.equal(c2.ledgerLongRest({ hours: 8 }, []).ok, true);
  assert.equal(c2.bagCount("food_liquid"), 0);
  assert.equal(c2.bagCount("food_can"), 3);
  assert.equal(hero(c2, "kolt").shp, 16 + 3, "罐头每份 +1，吃 3 份");
  assert.equal(hero(c2, "xia").shp, 16);
});

/** before：先做的事（接任务会发委托方的补给），做完再把背包换成 foods */
function rogue(seed, foods, before) {
  const c = H.load(), R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "xia"], seed });
  if (before) before(R, run);
  c.S.state.bag = { items: [] };
  c.setLedgerWater(10000);
  Object.keys(foods).forEach(id => c.bagAdd(id, foods[id]));
  return { c, R, run };
}

test("单局休整：不动下拉框直接休整，照样长休（以前「补给不足……硬撑着过夜」）", () => {
  const { c, R, run } = rogue("REST-FOOD-CAMP", { food_liquid: 2, food_can: 6 });
  run.stage = "camp";
  assert.equal(plain(R.campStatus(run, {})).ok, true);
  R.camp(run, {});
  const log = run.log.map(x => x.text).join("\n");
  assert.doesNotMatch(log, /硬撑/);
  assert.equal(run.lastRest && run.lastRest.ok, true);
  assert.equal(c.bagCount("food_liquid"), 0);
  assert.equal(c.bagCount("food_can"), 3);
  assert.equal(c.LEDGER.hours, 0, "距上次长休清零");
});

test("单局休息点：默认安排够就能长休（联机休息点的「长休」选项读的也是 restPlan(r, {})）", () => {
  const { c, R, run } = rogue("REST-FOOD-NODE", { food_liquid: 2, food_can: 6 }, (R, run) => {
    R.acceptTask(run, "main");
    delete run.task.hunt;
    run.task.nodes[run.task.index] = { type: "rest", done: false };
  });
  assert.equal(R.restPlan(run, {}).ok, true);
  assert.deepEqual(Object.fromEntries(R.restOptions(run, {}).heroes.map(h => [h.kit, h.foodId])), { kolt: "food_can", xia: "food_liquid" });
  run.ambushChance = 0;
  R.restAtNode(run, "long", {});
  assert.equal(c.bagCount("food_liquid"), 0);
  assert.equal(c.bagCount("food_can"), 3);
  assert.match(fs.readFileSync(path.join(H.ROOT, "online-rogue.js"), "utf8"), /plan = Rogue\.restPlan\(r, \{\}\)/);
});

test("取默认食物只有一处（ledger.js · restFoodPlan）：战斗原型的长休页也用它", () => {
  const src = (f) => fs.readFileSync(path.join(H.ROOT, f), "utf8");
  for (const f of ["ledger.js", "game.js", "trpg-ui.js", "rogue-ui.js", "rogue.js"]) assert.doesNotMatch(src(f), /defaultFoodFor/, f);
  assert.match(src("game.js"), /restFoodPlan\(\{ food: G\.restFood \}\)/);
});
