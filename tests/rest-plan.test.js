// 长休界面：每个角色单独选吃哪种食物、用哪个睡眠道具；单局的休息点 / 遭遇战 / 休整都按这份安排
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [], seed: "REST-PLAN" });
  c.S.state.bag = { items: [] };
  c.setLedgerWater(10000);
  return c;
}
const hero = (c, kit) => c.partyHeroes().find(h => h.kit === kit);

test("长休选项：列出每个角色的需求、能选的食物和睡眠道具；默认按队伍顺序分睡袋", () => {
  const c = field();
  c.bagAdd("food_liquid", 4); c.bagAdd("food_gourmet", 2); c.bagAdd("sleepbag", 1);
  const o = c.longRestOptions({});
  assert.equal(o.heroes.map(h => h.kit).join(), "kolt,helu");
  assert.equal(o.heroes.map(h => h.foodId).join(), "food_liquid,food_liquid");
  assert.equal(o.heroes.map(h => h.sleepId).join(), "sleepbag,");
  assert.ok(o.sleeps.some(x => x.id === "sleepbag" && x.have === 1 && x.bonus === 1));
  assert.equal(o.foods.find(f => f.id === "food_gourmet").have, 2);
  assert.equal(o.need.ok, true);
});

test("睡袋分给谁由玩家选；分出去的比背包里的多就不够长休", () => {
  const c = field();
  c.bagAdd("food_liquid", 4); c.bagAdd("sleepbag", 1);
  const two = c.longRestNeeds({ sleep: { kolt: "sleepbag", helu: "sleepbag" } });
  assert.equal(two.ok, false);
  assert.match(two.lack.join(), /睡袋 只有 1 个，分给了 2 个人/);
  const before = { kolt: hero(c, "kolt").shp, helu: hero(c, "helu").shp };
  hero(c, "kolt").shp = 0; hero(c, "helu").shp = 0;
  const r = c.ledgerLongRest({ hours: 8, sleep: { kolt: "", helu: "sleepbag" } }, []);
  assert.equal(r.ok, true);
  assert.equal(hero(c, "kolt").shp, Math.min(hero(c, "kolt").shpMax, 16), "没睡袋：8 小时 × 2");
  assert.equal(hero(c, "helu").shp, Math.min(hero(c, "helu").shpMax, 24), "睡袋：8 小时 × 3");
  assert.equal(c.bagCount("sleepbag"), 1, "睡袋不消耗");
  void before;
});

test("每人各吃各的：好食物额外恢复坚毅，按各自的份数扣", () => {
  const c = field();
  c.bagAdd("food_liquid", 2); c.bagAdd("food_gourmet", 2);
  hero(c, "kolt").shp = 0; hero(c, "helu").shp = 0;
  const r = c.ledgerLongRest({ hours: 8, food: { kolt: "food_gourmet", helu: "food_liquid" }, sleep: { kolt: "", helu: "" } }, []);
  assert.equal(r.ok, true);
  assert.equal(c.bagCount("food_gourmet"), 0);
  assert.equal(c.bagCount("food_liquid"), 0);
  assert.equal(hero(c, "kolt").shp, Math.min(hero(c, "kolt").shpMax, 16 + 5 * 2));
  assert.equal(hero(c, "helu").shp, Math.min(hero(c, "helu").shpMax, 16));
});

function rogue(seed) {
  const c = H.load(); const R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed });
  R.acceptTask(run, "main");
  delete run.task.hunt;
  run.task.nodes[run.task.index] = { type: "rest", done: false };
  c.S.state.bag = { items: [] };
  c.bagAdd("food_liquid", 2); c.bagAdd("food_gourmet", 2); c.bagAdd("sleepbag", 1);
  c.setLedgerWater(10000);
  return { c, R, run };
}
const plan = { food: { kolt: "food_gourmet", helu: "food_liquid" }, sleep: { kolt: "", helu: "sleepbag" } };

test("单局休息点：长休按界面里的安排吃、睡（经过指令层）", () => {
  const { c, R, run } = rogue("REST-PLAN-NODE");
  const o = c.Commands.dispatch({ type: "run.query", action: "restOptions", food: plan.food, sleep: plan.sleep }, { run });
  assert.equal(o.heroes.map(h => `${h.kit}:${h.foodId}:${h.sleepId}`).join(), "kolt:food_gourmet:,helu:food_liquid:sleepbag");
  run.ambushChance = 0;
  c.Commands.dispatch({ type: "run", action: "restAtNode", mode: "long", watch: null, food: plan.food, sleep: plan.sleep }, { run });
  assert.equal(run.ambush || null, null);
  assert.equal(c.bagCount("food_gourmet"), 0);
  assert.equal(c.bagCount("food_liquid"), 0);
  assert.equal(c.bagCount("sleepbag"), 1);
  assert.match(run.log.map(x => x.text).join("\n"), /含睡袋/);
  void R;
});

test("单局：睡袋分超了不能长休；格式不对的安排被指令层拦下", () => {
  const { c, run } = rogue("REST-PLAN-BAD");
  run.ambushChance = 0;
  assert.throws(() => c.Commands.dispatch({ type: "run", action: "restAtNode", mode: "long", watch: null, sleep: { kolt: "sleepbag", helu: "sleepbag" } }, { run }), /补给不够长休/);
  assert.throws(() => c.Commands.dispatch({ type: "run", action: "restAtNode", mode: "long", watch: null, food: ["x"] }, { run }), /格式不对/);
});

test("单局遭遇战：偷袭前选好的安排，打赢后照样用", () => {
  const { c, R, run } = rogue("REST-PLAN-AMBUSH");
  run.ambushChance = 1;
  R.restAtNode(run, "long", plan);
  assert.ok(run.ambush && run.ambush.plan, "被偷袭：记下安排");
  c.BattleSim.setup(R.battleSpec(run));
  R.finishBattle(run, "win");
  assert.equal(c.bagCount("food_gourmet"), 0);
  assert.equal(c.bagCount("food_liquid"), 0);
});

test("单局休整：按安排长休", () => {
  const { c, R, run } = rogue("REST-PLAN-CAMP");
  run.stage = "camp";
  R.camp(run, plan);
  assert.equal(c.bagCount("food_gourmet"), 0);
  assert.equal(c.bagCount("food_liquid"), 0);
});
