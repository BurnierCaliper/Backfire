// 制作（docs/workshop-design.md 第 5 节）：配方、熟练检定、耗时、失败、打下手、地点、学配方、配方芯片
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");

function setup(seed) {
  const c = H.load(), R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed: seed || "CRAFT" });
  c.S.state.kuizhi = 100000;
  const give = (id, n) => c.bagAdd(id, n);
  return { c, R, run, give, count: id => c.bagCount(id) };
}
const ENTER = (r) => JSON.parse(JSON.stringify(r));

test("36 个道具都有配方；材料都登记过；每个熟练项 6 个", () => {
  const c = H.load();
  const items = ENTER(vm.runInContext("EFFECT_ITEMS", c)), rc = ENTER(vm.runInContext("CRAFT_RECIPES", c));
  assert.equal(items.length, 36);
  const per = {};
  items.forEach(it => {
    assert.ok(rc[it.id], it.id);
    Object.keys(rc[it.id]).forEach(m => assert.ok(c.ITEM_CATALOG[m], m));
    per[it.prof] = (per[it.prof] || 0) + 1;
  });
  Object.values(per).forEach(n => assert.equal(n, 6));
});

test("地点：城里（任务板）是工坊；休息点只能做投掷罐 / 弹针 / 增减益；战斗节点不能做", () => {
  const { R, run, give } = setup();
  assert.equal(R.craftPlace(run), "bench");
  run.stage = "task";
  run.task = { nodes: [{ type: "rest" }], index: 0 };
  assert.equal(R.craftPlace(run), "rest");
  give("cm_scrap", 9); give("cm_cell", 9); give("cm_coil", 9);
  run.recipes = ["fx_f_electric"];
  assert.throws(() => R.craft(run, [{ kit: "kolt", item: "fx_f_electric" }]), /工作台/);
  run.task.nodes[0].type = "battle";
  assert.equal(R.craftPlace(run), null);
});

test("简单配方一开始就会；普通及以上要学", () => {
  const { R, run } = setup();
  assert.ok(R.knowsRecipe(run, "fx_shock"));
  assert.ok(!R.knowsRecipe(run, "fx_overload"));
  assert.throws(() => R.craft(run, [{ kit: "kolt", item: "fx_overload" }]), /还不会/);
});

test("成功：材料扣掉、道具进背包、时间按难度推进", () => {
  const { c, R, run, give, count } = setup();
  give("cm_scrap", 1); give("cm_coil", 2);
  const h0 = R.hoursAwake();
  R.craft(run, [{ kit: "kolt", item: "fx_shock" }]);   // 电器维修 1 级 · 简单 → 100%
  assert.equal(count("fx_shock"), 1);
  assert.equal(count("cm_scrap"), 0);
  assert.equal(count("cm_coil"), 0);
  assert.equal(R.hoursAwake() - h0, 1);
});

test("没有熟练项：简单 50%，普通以上做不了", () => {
  const { R, run } = setup();
  assert.equal(R.craftOdds(run, "helu", "fx_quake").base, 0.5);   // 机械维修 0 级
  run.recipes = ["fx_shift"];
  assert.equal(R.craftOdds(run, "helu", "fx_shift").base, 0);
});

test("打下手给优势：1 级做普通 50% → 75%；帮手要有对应熟练项，也不能同时做自己的", () => {
  const { R, run, give } = setup();
  run.recipes = ["fx_overload"];
  assert.equal(R.craftOdds(run, "kolt", "fx_overload").chance, 0.5);
  assert.equal(R.craftOdds(run, "kolt", "fx_overload", "helu").chance, 0.75);
  give("cm_scrap", 9); give("cm_cell", 9); give("cm_coil", 9);
  assert.throws(() => R.craft(run, [{ kit: "kolt", item: "fx_quake" }, { kit: "helu", item: "fx_shock", helper: "kolt" }]), /在忙/);
});

test("失败：时间照花，非壳体材料损失一半（向上取整），废料不损失", () => {
  let failed = 0;
  for (let i = 0; i < 40 && failed < 3; i++) {
    const { R, run, give, count } = setup("FAIL" + i);
    run.recipes = ["fx_overload"];   // 废料 ×2 + 电芯 + 废线圈；1 级 50%
    give("cm_scrap", 2); give("cm_cell", 1); give("cm_coil", 1);
    const h0 = R.hoursAwake();
    R.craft(run, [{ kit: "kolt", item: "fx_overload" }]);
    assert.equal(R.hoursAwake() - h0, 1);
    if (count("fx_overload")) continue;
    failed++;
    assert.equal(count("cm_scrap"), 2, "壳体留着");
    assert.equal(count("cm_cell") + count("cm_coil"), 1, "两份非壳体材料丢 1 份");
  }
  assert.ok(failed > 0, "40 次里总该失败几次");
});

test("大家同时做，时间按最久的算；材料合起来不够就不开工", () => {
  const { R, run, give } = setup();
  run.recipes = ["fx_f_electric"];
  give("cm_scrap", 1); give("cm_coil", 2);
  assert.throws(() => R.craft(run, [{ kit: "kolt", item: "fx_f_electric" }, { kit: "helu", item: "fx_shock" }]), /材料不够/);
  give("cm_scrap", 3); give("cm_cell", 1); give("cm_coil", 2);
  const h0 = R.hoursAwake();
  R.craft(run, [{ kit: "kolt", item: "fx_f_electric" }, { kit: "helu", item: "fx_shock" }]);
  assert.equal(R.hoursAwake() - h0, 2);
});

test("自我效果要金属：背包里没有就按参考价付奎支", () => {
  const { c, R, run, give } = setup();
  run.recipes = ["fx_s_conductor"];
  // 柯尔特电器维修 1 级做极难只有 12.5%：成不成都看金属怎么扣
  give("cm_spirit", 1); give("cm_cell", 1); give("cm_coil", 2);
  const k0 = c.S.state.kuizhi;
  const item = R.craftList(run).find(x => x.id === "fx_s_conductor");
  assert.equal(item.metalKuizhi, 1000);
  R.craft(run, [{ kit: "kolt", item: "fx_s_conductor" }]);
  const ok = c.bagCount("fx_s_conductor") === 1;
  assert.equal(k0 - c.S.state.kuizhi, ok ? 1000 : 0, "失败时金属是壳体，不扣");
});

test("向在场的工匠学配方：只教自己那一类，按难度收学费", () => {
  const { c, R, run } = setup();
  run.smiths = ["teresa"];   // 电器维修
  const opts = R.learnOptions(run);
  assert.ok(opts.length > 0 && opts.every(o => o.prof === "电器维修"));
  const k0 = c.S.state.kuizhi;
  R.learnRecipe(run, "fx_overload", "teresa");
  assert.ok(R.knowsRecipe(run, "fx_overload"));
  assert.equal(k0 - c.S.state.kuizhi, 800);
  assert.throws(() => R.learnRecipe(run, "fx_melt", "teresa"), /没有人教/);
});

test("首领必掉配方芯片：学会一张还不会的", () => {
  const { R, run } = setup();
  const notes = [];
  R.rollRecipeChip(run, "boss", notes);
  assert.equal((run.recipes || []).length, 1);
  assert.match(notes.join(""), /配方芯片/);
});
