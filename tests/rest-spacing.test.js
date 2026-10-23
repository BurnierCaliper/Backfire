// 休息点间隔：任何一张生成的路线图上，任何一条路线连续不长休都不超过 18 小时（主线 / 护送 / 侦察 / 清剿 / 悬赏）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

const c = H.load(); const R = c.Rogue; const NODE = c.S.ROGUE_NODE_TYPES;
const T = c.S.ROGUE_CONFIG ? c.S.ROGUE_CONFIG.hours.travel : 3;
const MAX = (cc) => cc.S.ROGUE_CONFIG.hours.restGapMax;   // rogue-data.js · ROGUE_CONFIG.hours.restGapMax（18）
const nh = t => (t === "rest" ? 0 : NODE[t].hours);
/** 枚举所有路线，每条路线的最大间隔取最大 */
function worstAllPaths(cols) {
  let ps = cols[0].map((_, i) => [i]);
  for (let ci = 1; ci < cols.length; ci++) {
    const L = R.routeLinks(cols[ci - 1].length, cols[ci].length), np = [];
    ps.forEach(p => L.filter(([i]) => i === p[p.length - 1]).forEach(([, j]) => np.push(p.concat(j))));
    ps = np;
  }
  return Math.max(...ps.map(p => gap(p.map((j, ci) => cols[ci][j]))));
}
function gap(types) {
  let cur = 0, mx = 0;
  types.forEach((t, i) => { cur += (i ? T : 0) + nh(t); mx = Math.max(mx, cur); if (t === "rest") cur = 0; });
  return mx;
}

test("普通任务：300 个种子 × 4 幕，所有路线最坏间隔 ≤ restGapMax，休息点不在首尾", () => {
  const seen = {};
  for (let s = 0; s < 300; s++) {
    const run = R.newRun({ party: ["kolt", "helu"], seed: "RS" + s });
    for (let act = 1; act <= 4; act++) {
      if (act > 1) { run.stage = "interlude"; R.nextAct(run); }
      const tasks = [run.main];
      for (let b = 0; b < 3; b++) tasks.push(...R.makeBoard(run));
      tasks.forEach(t => {
        if (t.hunt) return;
        const k = t.key ? "main" : t.kind; seen[k] = true;
        const w = worstAllPaths(t.cols);
        assert.ok(w <= MAX(c), `${run.seed} 第${act}幕 ${k}：最坏 ${w} 小时`);
        assert.equal(w, R.worstRestGap(t.cols), "DP 和枚举一致");
        assert.notEqual(t.cols[0][0], "rest"); assert.notEqual(t.cols[t.cols.length - 1][0], "rest");
        assert.ok(t.cols.some(col => col.length === 1 && col[0] === "rest"), "至少一个休息点");
        assert.equal(t.cols.length, t.nodeTypes.length);
      });
    }
  }
  assert.ok(seen.main && seen.escort, "覆盖主线和护送");
});

test("同一个种子生成的路线完全一样（确定性）", () => {
  const a = R.newRun({ party: ["kolt", "helu"], seed: "RS-DET" }), b = R.newRun({ party: ["kolt", "helu"], seed: "RS-DET" });
  assert.deepEqual(JSON.parse(JSON.stringify(a.main.cols)), JSON.parse(JSON.stringify(b.main.cols)));
  assert.deepEqual(JSON.parse(JSON.stringify(a.board.map(t => t.cols))), JSON.parse(JSON.stringify(b.board.map(t => t.cols))));
});

function passCheck(run) {
  const info = R.checkInfo(run), node = R.currentNode(run);
  node.check.diff = "easy"; (node.check.options || []).forEach(o => { o.diff = "easy"; });
  run.party.forEach(h => { h.profs[info.prof] = 3; });
  return R.attemptCheck(run, run.party[0].kit);
}
test("悬赏：各种检定成败下，一路走完连续不长休都不超过 restGapMax", () => {
  let n = 0, r = 1;
  const rnd = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648; };
  for (const p of [0, 0.3, 0.6, 1]) for (let s = 0; s < 60; s++) {
    let run, k = -1;
    for (let i = 0; i < 80 && k < 0; i++) { run = R.newRun({ party: ["kolt", "helu"], seed: `RSB${p}:${s}:${i}` }); k = run.board.findIndex(t => t.kind === "bounty"); }
    if (k < 0) continue;
    R.acceptTask(run, k);
    const task = run.task;
    for (let g = 0; g < 200 && run.stage === "task" && run.task === task; g++) {
      const node = R.currentNode(run);
      if (node.type === "check") { if (rnd() < p) passCheck(run); else R.skipCheck(run); }
      else if (node.type === "battle" || node.type === "elite") R.finishBattle(run, "win");
      else if (node.type === "rest") R.restAtNode(run, "leave");
      else R.leaveNode(run);
    }
    const types = task.nodes.map(x => x.type);
    assert.ok(task.nodes[task.nodes.length - 1].target, "以目标那一战收尾");
    assert.ok(gap(types) <= MAX(c), `${run.seed}：${types.join(",")} → ${gap(types)} 小时`);
    n++;
  }
  assert.ok(n > 100);
});

/* ---------- 方案 A：按小时补的休息点「离开」无报酬 ---------- */
/** 找一个有补出来休息点的主线，走到第 col 列的休息点 */
function mainWithInserted() {
  for (let s = 0; s < 200; s++) {
    const c = H.load(); const R = c.Rogue;
    const run = R.newRun({ party: ["kolt", "helu"], seed: "NP" + s });
    if ((run.main.noPayCols || []).length) return { c, R, run };
  }
  throw new Error("没找到补了休息点的主线");
}
function walkTo(R, run, pred) {
  for (let g = 0; g < 60 && run.stage === "task"; g++) {
    if (!R.currentNode(run)) { const ch = R.nodeChoices(run); R.chooseNode(run, ch[0].i); }
    const n = R.currentNode(run);
    if (pred(n)) return n;
    if (n.type === "check") R.skipCheck(run);
    else if (n.type === "battle" || n.type === "elite") R.finishBattle(run, "win");
    else if (n.type === "rest") R.restAtNode(run, "leave");
    else R.leaveNode(run);
  }
  return null;
}
test("补出来的休息点：离开 0 奎支、按钮写「无报酬」；模板原有的休息点照常 250", () => {
  const { c, R, run } = mainWithInserted();
  R.acceptTask(run, "main");
  const restCols = run.task.cols.map((q, i) => (q[0] === "rest" ? i : -1)).filter(i => i >= 0);
  const orig = restCols.filter(i => run.task.noPayCols.indexOf(i) < 0);
  assert.equal(orig.length, 1, "模板原有的休息点正好一个");
  let paid = 0, free = 0;
  for (let g = 0; g < 10; g++) {
    const n = walkTo(R, run, x => x.type === "rest");
    if (!n) break;
    const before = c.S.state.kuizhi;
    const inserted = run.task.noPayCols.indexOf(run.task.index) >= 0;
    assert.equal(!!n.noPay, inserted);
    const log = R.restAtNode(run, "leave").join("");
    if (inserted) {
      free++;
      assert.equal(c.S.state.kuizhi, before);
      assert.match(log, /无报酬/); assert.doesNotMatch(log, /250/);
    } else {
      paid++;
      assert.equal(c.S.state.kuizhi, before + 250);
    }
  }
  assert.equal(paid, 1); assert.ok(free >= 1);
});
test("按钮文字：补的写「无报酬」，原有的写「获得 250 奎支」", () => {
  const { R, run } = mainWithInserted();
  R.acceptTask(run, "main");
  const seen = new Set();
  for (let g = 0; g < 10; g++) {
    const n = walkTo(R, run, x => x.type === "rest");
    if (!n) break;
    const label = R.restSkipLabel(run);
    assert.equal(label, n.noPay ? "无报酬" : "获得 250 奎支");
    assert.equal(R.restSkipPay(run), n.noPay ? 0 : 250);
    seen.add(label);
    R.restAtNode(run, "leave");
  }
  assert.equal(seen.size, 2);
});
test("悬赏强制的休息点也是无报酬", () => {
  let hit = 0;
  for (let s = 0; s < 40 && hit < 5; s++) {
    let run, k = -1;
    for (let i = 0; i < 80 && k < 0; i++) { run = R.newRun({ party: ["kolt", "helu"], seed: `NPB${s}:${i}` }); k = run.board.findIndex(t => t.kind === "bounty"); }
    R.acceptTask(run, k);
    const task = run.task;
    const n = walkTo(R, run, x => x.type === "rest" && x.noPay);
    if (!n || run.task !== task) continue;
    const before = c.S.state.kuizhi;
    assert.equal(R.restSkipLabel(run), "无报酬");
    R.restAtNode(run, "leave");
    assert.equal(c.S.state.kuizhi, before);
    hit++;
  }
  assert.ok(hit >= 3, "悬赏应该经常出强制休息点");
});
test("标记经过存档读回、JSON（联机同步）后还在，读回后照样不给钱", () => {
  const { c, R, run } = mainWithInserted();
  R.acceptTask(run, "main");
  const n = walkTo(R, run, x => x.type === "rest" && x.noPay);
  assert.ok(n);
  R.save(run);
  const saved = c.localStorage.getItem(c.SaveStore.KEYS.run);
  const b = H.load();
  b.localStorage.setItem(b.SaveStore.KEYS.run, saved);
  const runB = b.SaveStore.loadRun();
  b.Rogue.enterRunMode(runB);
  assert.equal(b.Rogue.currentNode(runB).noPay, true);
  assert.deepEqual(JSON.parse(JSON.stringify(runB.task.noPayCols)), JSON.parse(JSON.stringify(run.task.noPayCols)));
  const viaJson = JSON.parse(JSON.stringify(runB));
  assert.equal(viaJson.task.nodes[viaJson.task.index].noPay, true);
  const before = b.S.state.kuizhi;
  assert.equal(b.Rogue.restSkipLabel(runB), "无报酬");
  b.Rogue.restAtNode(runB, "leave");
  assert.equal(b.S.state.kuizhi, before);
});

test("restGapMax 从 ROGUE_CONFIG.hours 读：就是 18，worstRestGap 不超过它", () => {
  assert.equal(MAX(c), 18);
});

test("补的休息点长休不消耗水和食物，按钮 / 记录写「不消耗补给」；模板原有的休息点照常消耗", () => {
  const { c, R, run } = mainWithInserted();
  R.acceptTask(run, "main");
  let free = 0, paid = 0;
  for (let g = 0; g < 10; g++) {
    const n = walkTo(R, run, x => x.type === "rest");
    if (!n) break;
    const plan = R.restPlan(run, {});
    const bagNow = () => JSON.parse(JSON.stringify(c.S.state.bag || {}));
    const before = bagNow();
    const watch = R.watchOptions(run)[0].kit;   // 守夜：不会被偷袭
    const log = R.restAtNode(run, "long", { watch }).join("");
    if (n.noPay) {
      free++;
      assert.equal(plan.free, true); assert.equal(plan.water, 0); assert.deepEqual(Object.keys(plan.food), []);
      assert.deepEqual(bagNow(), before, "水和食物都不变");
      assert.match(log, /不消耗补给/);
    } else {
      paid++;
      assert.ok(!plan.free); assert.ok(plan.water > 0);
      assert.ok(bagNow().water < before.water, "原有休息点照常扣水");
      assert.doesNotMatch(log, /不消耗补给/);
    }
  }
  assert.ok(free >= 1); assert.equal(paid, 1);
});

test("引擎实测：每个休息点都长休，路线上实际清醒小时（LEDGER.hours）从不超过 restGapMax", () => {
  let n = 0, peak = 0, longs = 0;
  for (let s = 0; s < 40; s++) {
    const c = H.load(); const R = c.Rogue;
    const run = R.newRun({ party: ["kolt", "helu"], seed: "AW" + s });
    for (const pick of ["main", "board"]) {
      if (run.stage !== "town" && run.stage !== "board" && pick === "board") break;
      const k = pick === "main" ? "main" : run.board.findIndex(t => t.kind === "bounty");
      if (k < 0 || k === -1) continue;
      try { R.acceptTask(run, k); } catch (e) { continue; }
      const task = run.task;
      // 出发前睡足：从 0 小时开始算这一个任务
      c.S.LEDGER.hours = 0;
      for (let g = 0; g < 200 && run.stage === "task" && run.task === task; g++) {
        if (!R.currentNode(run)) { const ch = R.nodeChoices(run); R.chooseNode(run, ch[(g * 7 + s) % ch.length].i); }
        const node = R.currentNode(run);
        const hrs = Number(c.S.LEDGER.hours) || 0;
        peak = Math.max(peak, hrs);
        assert.ok(hrs <= MAX(c), `${run.seed} ${task.kind} 第 ${run.task.index} 站：清醒 ${hrs} 小时`);
        if (node.type === "check") { if (task.hunt && g % 2) passCheck(run); else R.skipCheck(run); }
        else if (node.type === "battle" || node.type === "elite") R.finishBattle(run, "win");
        else if (node.type === "rest") {
          // 补给给足，保证每个休息点都能长休；守夜，不被偷袭
          c.S.state.bag.water = 1e6;
          Object.keys(R.restPlan(run, {}).food).forEach(f => { c.S.state.bag[f] = 999; });
          assert.ok(R.restPlan(run, {}).ok, R.restPlan(run, {}).lack.join());
          R.restAtNode(run, "long", { watch: R.watchOptions(run)[0].kit });
          longs++;
        } else R.leaveNode(run);
      }
      const hrs = Number(c.S.LEDGER.hours) || 0;
      peak = Math.max(peak, hrs);
      assert.ok(hrs <= MAX(c), `${run.seed} ${task.kind} 走完：清醒 ${hrs} 小时`);
      n++;
      break;
    }
  }
  assert.ok(n >= 30, "跑了 " + n); assert.ok(peak > 10, "峰值 " + peak); assert.ok(longs > n, "长休 " + longs);
});
