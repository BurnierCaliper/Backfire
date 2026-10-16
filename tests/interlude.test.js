// 幕间选择：打完一幕的首领，选下一幕去哪；第 2–4 幕可以改去第一 / 二 / 三采矿场
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function atInterlude(act) {
  const c = H.load(), R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed: "INTER" + act });
  run.act = act; run.stage = "interlude";
  return { c, R, run };
}

test("第 1、2、3 幕打完：下一幕可以选原本的区域或者对应的采矿场", () => {
  const want = { 1: ["沙漠", "第一采矿场"], 2: ["巨人城", "第二采矿场"], 3: ["天网设施", "第三采矿场"] };
  for (const act of [1, 2, 3]) {
    const { R, run } = atInterlude(act);
    const opts = JSON.parse(JSON.stringify(R.interludeOptions(run)));
    assert.deepEqual(opts.map(o => o.region), want[act]);
    assert.equal(opts[1].alt, true);
    assert.ok(opts[1].enemies.length > 0, "列出会遇到的敌人");
  }
});

test("选了采矿场：这一幕的区域、遭遇都换成采矿场；之后的幕回到原本的表", () => {
  const { R, run } = atInterlude(1);
  R.nextAct(run, "第一采矿场");
  assert.equal(run.act, 2);
  assert.equal(R.region(run), "第一采矿场");
  const mine1 = ["mine_guard", "ant_guard", "spreader", "dumpdrone"];
  let hit = false;
  for (let i = 0; i < 40 && !hit; i++) {
    run.stage = "task"; run.task = { nodes: [{ type: "battle" }], index: 0, weather: null }; run.taskNo = i;
    const spec = R.battleSpec(run);
    assert.equal(spec.encounter.region, "第一采矿场");
    hit = spec.encounter.enemies.some(e => mine1.includes(e.preset));
  }
  assert.ok(hit, "第一采矿场的敌人会出现");
  run.stage = "interlude";
  R.nextAct(run);
  assert.equal(R.region(run), "巨人城", "不选就走原本的区域");
});

test("不能去表外的地方；额外幕不选", () => {
  const { R, run } = atInterlude(1);
  assert.throws(() => R.nextAct(run, "天网设施"), /不能去/);
  run.act = 4; run.extra = true;
  assert.equal(R.interludeOptions(run).length, 1);
});

test("联机：幕间是队伍投票，两个区域各是一个选项", () => {
  const { c, run } = atInterlude(1);
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "online-rogue.js"), "utf8");
  assert.match(src, /"goOn", "region"\]/, "matchOption 按区域区分两个选项");
  assert.ok(run);
  assert.ok(c);
});
