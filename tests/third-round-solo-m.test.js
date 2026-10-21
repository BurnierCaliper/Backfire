// 第三轮排查 · 单机 M-2 ~ M-5（docs/bug-backlog.md）+ 沙灵召唤物 summonedBy
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");
const plain = (x) => JSON.parse(JSON.stringify(x));

/* ---------- M-2 乘势只对敌对单位生效 ---------- */
test("M-2 乘势：同区架势 1 的中立生物（尘虫）不挨击破，敌对的照旧", () => {
  const c = H.load();
  vm.runInContext("Math", c).random = () => 0.5;
  c.BattleSim.setup({ party: ["kolt", "helu"], seed: "M2",
    enemies: [{ id: "thug_knife", lv: 3, zone: 1 }, { id: "thug_knife", lv: 3, zone: 1 }, { id: "dust_bug", lv: 3, zone: 1 }] });
  const S = c.S.state;
  const kolt = c.findKit("kolt", S.units);
  kolt.feats = ["momentum"];
  c.startCombat();
  const knives = S.units.filter(u => u.kit === "thug_knife"), bug = S.units.find(u => u.kit === "dust_bug");
  const [a, b] = knives;
  kolt.zone = a.zone; b.zone = a.zone; bug.zone = a.zone;
  a.def = 1; b.def = 1; bug.def = 1;
  c.dealTo(kolt, a, { atk: 20, mult: 1, element: "physical", baseBreak: 1, atkRange: "any",
    flags: { action: true, blockResolved: true, block: "none" } });
  assert.equal(a.stunned, true);
  assert.ok(b.def === 0 || b.stunned, "敌对的被乘势击破");
  assert.equal(bug.def, 1, "中立的尘虫不受乘势");
  assert.ok(!bug.stunned);
});

/* ---------- M-3 长线养成每日任务 ---------- */
function growthRun(seed) {
  const c = H.load(), R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed, growth: true });
  return { c, R, run };
}
/** 把今天的每日任务换成指定的 id（其余两项用不会被碰到的占位） */
function forceTask(R, run, id, target) {
  const daily = R.growthDaily(run);
  daily.tasks = [
    { id, name: id, desc: "", kit: null, type: "battle", progress: 0, target, done: false },
    { id: "kill_elite", name: "x", desc: "", progress: 0, target: 999, done: false },
    { id: "assist", name: "y", desc: "", progress: 0, target: 999, done: false }
  ];
  return daily.tasks[0];
}

test("M-3 每日任务「长休」：长休一次就完成", () => {
  const { c, R, run } = growthRun("M3a");
  const t = forceTask(R, run, "long_rest", 1);
  const notes = [];
  c.bagAdd("water_500", 50); c.bagAdd("food_liquid", 50);
  R.growthDailyBump(run, "long_rest", 0, notes);
  assert.equal(t.progress, 0, "没发生长休不加进度");
  run.stage = "camp";
  R.camp(run);
  assert.equal(t.done, true, "长休后完成");
});

test("M-3 每日任务「商店消费」：按花掉的奎支累计，500 完成", () => {
  const { c, R, run } = growthRun("M3b");
  const t = forceTask(R, run, "shop", 500);
  run.stage = "camp";
  c.S.state.kuizhi = 100000;
  const row = R.shopStock(run).find(r => r.price > 0);
  R.buy(run, row.key, 1);
  assert.ok(t.progress > 0 && t.progress <= 500, `进度 ${t.progress}`);
  while (!t.done) R.buy(run, row.key, 1);
  assert.equal(t.done, true);
});

test("M-3 每日任务「完成检定」：检定成功一次计 1 次", () => {
  const { R, run } = growthRun("M3c");
  R.acceptTask(run, 0);
  run.task.nodes = [{ type: "check", done: false }, { type: "rest", done: false }];
  run.task.index = 0;
  const t = forceTask(R, run, "check_ok", 2);
  const info = R.checkInfo(run);
  const node = R.currentNode(run);
  node.check.diff = "easy";
  (node.check.options || []).forEach(o => { o.diff = "easy"; });
  run.party.forEach(h => { h.profs[info.prof] = 3; });
  R.attemptCheck(run, run.party[0].kit);
  assert.equal(run.lastCheck.ok, true);
  assert.equal(t.progress, 1, "成功一次 +1");
});

test("M-3 每日任务「更换天气」：我方单位主动改天气记一次，主持人 / 固有的不算", () => {
  const { c, R, run } = growthRun("M3d");
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "M3d" });
  const S = c.S.state;
  const kolt = c.findKit("kolt", S.units);
  c.startCombat();
  assert.equal(c.setWeather("snow"), null);
  assert.ok(!S.playerWeatherChanges, "没有 by 的（主持人）不算");
  assert.equal(c.setWeather("sand", { by: kolt.id }), null);
  assert.equal(S.playerWeatherChanges, 1);
  const t = forceTask(R, run, "weather", 1);
  R.acceptTask(run, 0);
  run.party.length && R.finishBattle(run, "win");
  assert.equal(t.done, true);
});

/* ---------- M-4 每日挑战记录开局队伍 ---------- */
test("M-4 每日挑战记录：有人阵亡、全灭时，队伍仍是开局的完整队伍", () => {
  const c = H.load(), R = c.Rogue;
  const store = {};
  vm.runInContext(`globalThis.localStorage = { getItem: k => (k in this.__s ? this.__s[k] : null), setItem: (k, v) => { this.__s[k] = String(v); } }`, Object.assign(c, {}));
  c.__s = store;
  const seed = "daily-2026-10-16";
  const kits = plain(R.dailyParty(seed));
  const run = R.newRun({ party: kits, seed, daily: true });
  // 阵亡的人被 SaveStore.killHero 移进 fallen；这里让两人阵亡、两人还在
  c.SaveStore.killHero(run, kits[0]);
  c.SaveStore.killHero(run, kits[1]);
  R.endRun(run, false, "测试");
  assert.deepEqual(plain(R.dailyStats().runs[0].party).sort(), kits.slice().sort());

  const run2 = R.newRun({ party: kits, seed, daily: true });
  kits.forEach(k => c.SaveStore.killHero(run2, k));
  assert.equal(run2.party.length, 0);
  R.endRun(run2, false, "全灭");
  assert.deepEqual(plain(R.dailyStats().runs[1].party).sort(), kits.slice().sort(), "全灭也不是空数组");
});

/* ---------- M-5 / 沙灵召唤物记 summonedBy ---------- */
test("M-5 飞碟触灵 10 级被动召唤的看守记 summonedBy，自爆连它一起炸", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "ufo_boss", lv: 10 }], seed: "M5" });
  c.startCombat();
  const S = c.S.state;
  const body = S.units.find(u => u.kit === "ufo_body");
  const before = new Set(S.units.map(u => u.id));
  c.beginRound([]);
  const guards = S.units.filter(u => (u.kit === "guard_sword" || u.kit === "guard_gun") && !before.has(u.id));
  assert.ok(guards.length >= 1, "被动召唤了看守");
  guards.forEach(g => assert.equal(g.summonedBy, body.id));
});

test("en_bigsand_summon 召唤的沙灵记 summonedBy（战后不掉材料）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "bigsand", lv: 3, zone: 2 }], seed: "BS" });
  c.startCombat();
  const S = c.S.state;
  const big = S.units.find(u => u.kit === "bigsand");
  const before = new Set(S.units.map(u => u.id));
  S.combatPhase = "enemy"; big.ap = 2; S.attackerId = big.id;
  c.runSkill("en_bigsand_summon");
  const made = S.units.filter(u => !before.has(u.id));
  assert.ok(made.length >= 1, "召唤了沙灵");
  made.forEach(u => assert.equal(u.summonedBy, big.id));
});
