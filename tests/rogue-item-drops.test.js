// 单局道具掉落：普通战斗 20% 掉一个随机道具，精英战一定掉一个，首领掉两个；输了 / 撤退不掉
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function fresh(seed) {
  const c = H.load();
  const run = c.Rogue.newRun({ party: ["kolt", "helu"], seed });
  return { c, run, R: c.Rogue };
}
const POOL = () => H.load().Rogue.CONFIG.itemDrops.pool;
function itemCount(c) {
  const pool = c.Rogue.CONFIG.itemDrops.pool;
  return pool.reduce((s, id) => s + c.bagCount(id), 0);
}
/** 走到任务里第一个指定类型的战斗站并打完 */
function fightAt(seed, type, outcome) {
  const { c, run, R } = fresh(seed);
  R.acceptTask(run, "main");
  run.task.nodes[run.task.index] = { type, done: false };
  c.BattleSim.setup(R.battleSpec(run));
  const before = itemCount(c);
  const notes = R.finishBattle(run, outcome);
  return { gained: itemCount(c) - before, notes, c };
}

test("配置：普通 20%、精英 1 个、首领 2 个，池子是战斗用的消耗品", () => {
  const c = H.load(), D = c.Rogue.CONFIG.itemDrops;
  assert.equal(D.battle, 0.2); assert.equal(D.elite, 1); assert.equal(D.boss, 2);
  for (const id of D.pool) { assert.ok(c.ITEM_CATALOG[id], id); assert.equal(c.ITEM_CATALOG[id].combat, true); assert.ok(!c.ITEM_CATALOG[id].supply); }
});

test("精英战打赢一定掉一个道具，写进记录", () => {
  for (const seed of ["E1", "E2", "E3", "E4", "E5"]) {
    const r = fightAt(seed, "elite", "win");
    assert.equal(r.gained, 1, seed);
    assert.ok(r.notes.some(t => /战利品：获得/.test(t)), seed);
  }
});

test("首领打赢掉两个道具", () => {
  const { c, run, R } = fresh("B1");
  run.stage = "boss"; run.main.done = true;
  c.BattleSim.setup(R.battleSpec(run));
  const before = itemCount(c);
  R.finishBattle(run, "win");
  assert.equal(itemCount(c) - before, 2);
});

test("普通战斗大约 20% 掉一个；输了和撤退不掉", () => {
  let drops = 0, n = 60;
  for (let i = 0; i < n; i++) {
    const r = fightAt("N" + i, "battle", "win");
    assert.ok(r.gained === 0 || r.gained === 1);
    drops += r.gained;
  }
  assert.ok(drops >= 4 && drops <= 24, "60 场掉了 " + drops + " 次");
  assert.equal(fightAt("L1", "elite", "retreat").gained, 0);
});

test("同一个种子、同一场：读档重打掉的一样（不靠刷）", () => {
  const a = fightAt("SAME", "elite", "win"), b = fightAt("SAME", "elite", "win");
  const ids = c => POOL().filter(id => c.bagCount(id) > 0).join(",");
  assert.equal(ids(a.c), ids(b.c));
});
