// 休息点间隔：任何一张生成的路线图上，任何一条路线连续不长休都不超过 18 小时（主线 / 护送 / 侦察 / 清剿 / 悬赏）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

const c = H.load(); const R = c.Rogue; const NODE = c.S.ROGUE_NODE_TYPES;
const T = c.S.ROGUE_CONFIG ? c.S.ROGUE_CONFIG.hours.travel : 3;
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

test("普通任务：300 个种子 × 4 幕，所有路线最坏间隔 ≤ 18 小时，休息点不在首尾", () => {
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
        assert.ok(w <= 18, `${run.seed} 第${act}幕 ${k}：最坏 ${w} 小时`);
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
test("悬赏：各种检定成败下，一路走完连续不长休都不超过 18 小时", () => {
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
    assert.ok(gap(types) <= 18, `${run.seed}：${types.join(",")} → ${gap(types)} 小时`);
    n++;
  }
  assert.ok(n > 100);
});
