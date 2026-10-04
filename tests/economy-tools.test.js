// 经济工具只测强制胜利模型；未知流程不能伪装成正常经济结果。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const H = require("./headless");
const E = require("../tools/economy");
const plain = value => JSON.parse(JSON.stringify(value));
const total = (r, key) => Object.values(r.acts).reduce((sum, a) => sum + a[key], 0);

function fresh(seed) {
  const c = H.load();
  const run = c.Rogue.newRun({ party: E.PARTIES[2], seed });
  return { c, run, R: c.Rogue };
}

test("经济模型完成各人数四幕，固定种子可复现，收入支出按幕对账", () => {
  let routes = 0, checks = 0, watched = 0;
  for (const [size, kits] of Object.entries(E.PARTIES)) {
    const a = E.playRun(kits, `ECO-${size}-0`);
    const b = E.playRun(kits, `ECO-${size}-0`);
    assert.deepEqual(plain(a), plain(b));
    assert.equal(a.result.win, true);
    assert.deepEqual(Object.keys(a.acts), ["1", "2", "3", "4"]);
    for (const act of Object.values(a.acts)) {
      const spend = ["spendWater", "spendFood", "spendUpgrade", "spendRepair", "spendCyber", "spendHeal"].reduce((sum, k) => sum + act[k], 0);
      assert.equal(act.endKuizhi, act.openingKuizhi + act.reward + act.loot + act.checkIncome - spend);
      assert.ok(act.longRests <= act.restNeeded);
      assert.equal(act.gradeXpExtra, 0);
    }
    routes += total(a, "routes"); checks += total(a, "checks"); watched += total(a, "watchedRests");
  }
  assert.ok(routes > 0 && checks > 0 && watched > 0, "样本必须实际覆盖分岔、检定和守夜");
});

test("检定节点经检定 API 结算，收入单列；没有熟练项时可绕过", () => {
  for (const trained of [true, false]) {
    const { c, run, R } = fresh(`ECO-CHECK-${trained}`);
    R.acceptTask(run, "main");
    run.party.forEach(h => { h.profs = trained ? { "运动": 3 } : {}; });
    run.task.nodes[0] = { type: "check", done: false, check: { prof: "运动", diff: "normal", injure: false, reward: 1234 } };
    let first = null;
    const attempt = R.attemptCheck, skip = R.skipCheck;
    R.attemptCheck = (...args) => { if (!first) first = "attempt"; return attempt(...args); };
    R.skipCheck = (...args) => { if (!first) first = "skip"; return skip(...args); };
    const report = E.simulateRun(c, run);
    assert.equal(first, trained ? "attempt" : "skip");
    if (trained) assert.ok(report.acts[1].checkIncome >= 1234);
    else assert.ok(report.acts[1].checkSkips >= 1);
  }
});

test("长休被偷袭只战斗一次、只计一次休息，且经济模型不调用评分奖励", () => {
  const { c, run, R } = fresh("ECO-AMBUSH");
  R.acceptTask(run, "main");
  run.task.nodes[0] = { type: "rest", done: false };
  run.ambushChance = 1;
  R.restAtNode(run, "long");
  assert.ok(run.ambush);
  let firstKind = null;
  const setup = c.BattleSim.setup;
  c.BattleSim.setup = spec => { if (spec.kind && !firstKind) firstKind = spec.kind; return setup(spec); };
  c.settleBattleRewards = () => { throw new Error("强制胜利不应结算评级奖励"); };
  c.applyFinishBonus = () => { throw new Error("强制胜利不应生成速杀无伤奖励"); };
  const result = E.simulateRun(c, run);
  assert.equal(firstKind, "ambush");
  assert.ok(result.acts[1].ambushes >= 1);
  assert.ok(result.acts[1].longRests <= result.acts[1].restNeeded);
  assert.equal(result.assumptions.gradeXpMult, 1);
  assert.equal(total(result, "gradeXpExtra"), 0);
});

test("未知阶段、未知节点、无合法分岔和步数超限明确报错", () => {
  const unknown = fresh("ECO-UNKNOWN");
  unknown.run.stage = "unknown";
  assert.throws(() => E.simulateRun(unknown.c, unknown.run), /未知单局阶段/);
  const node = fresh("ECO-NODE");
  node.R.acceptTask(node.run, "main");
  node.run.task.nodes[0] = { type: "unknown" };
  assert.throws(() => E.simulateRun(node.c, node.run), /未知任务节点/);
  const route = fresh("ECO-ROUTE");
  route.R.acceptTask(route.run, "main");
  route.run.task.nodes[0] = null;
  route.run.task.cols[0] = [];
  assert.throws(() => E.simulateRun(route.c, route.run), /没有合法路线/);
  assert.throws(() => E.playRun(E.PARTIES[2], "ECO-LIMIT", { maxSteps: 1 }), /未正常结束/);
});

test("CLI 保留局数和 ECO_SET，配置或参数错误非零退出", () => {
  const script = path.join(H.ROOT, "tools", "economy.js");
  const runCli = (args, eco = "") => spawnSync(process.execPath, [script, ...args], {
    cwd: H.ROOT, env: { ...process.env, ECO_SET: eco }, encoding: "utf8"
  });
  const ok = runCli(["1"], '{"smithPriceScale":0.25}');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /评价经验 ×1/);
  assert.match(ok.stdout, /不统计真实战斗胜率/);
  assert.match(ok.stdout, /smithPriceScale.*0.25/);
  assert.doesNotMatch(ok.stdout, /Infinity|NaN/);
  for (const [args, eco] of [[["0"], ""], [["1.2"], ""], [["wat"], ""], [["1"], "{"], [["1"], "[]"], [["1"], '{"typo":3}'], [["1"], '{"smithPriceScale":-1}']]) {
    const bad = runCli(args, eco);
    assert.notEqual(bad.status, 0, `${args}/${eco}`);
    assert.match(bad.stderr, /经济验算失败/);
  }
});
