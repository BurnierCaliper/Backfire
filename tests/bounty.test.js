// 悬赏任务：路线一站一站显示；3 次线索检定成功找到目标（失败 5 次也会找到）；目标血量 / atk ×1.5、【目标】、多占 1 代币
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function bountyRun(seed) {
  const c = H.load(); const R = c.Rogue;
  for (let i = 0; i < 60; i++) {
    const run = R.newRun({ party: ["kolt", "helu"], seed: seed + i });
    const k = run.board.findIndex(t => t.kind === "bounty");
    if (k >= 0) return { c, R, run, k };
  }
  throw new Error("没抽到悬赏任务");
}
/** 让检定必定成功：难度改成简单，全队这项熟练三级 */
function passCheck(R, run) {
  const info = R.checkInfo(run);
  const node = R.currentNode(run);
  node.check.diff = "easy";
  run.party.forEach(h => { h.profs[info.prof] = 3; });
  return R.attemptCheck(run, run.party[0].kit);
}
/** 非检定节点：随便走过去 */
function passOther(c, R, run) {
  const n = R.currentNode(run);
  if (n.type === "battle" || n.type === "elite") return R.finishBattle(run, "win");
  if (n.type === "rest") return R.restAtNode(run, "leave");
  return R.leaveNode(run);
}

test("任务板：悬赏不显示路线，只有第一个线索检定", () => {
  const { run, k } = bountyRun("BTY-A");
  const t = run.board[k];
  assert.deepEqual(plain(t.cols), [["check"]]);
  assert.deepEqual(plain(t.hunt), { need: 3, failMax: 5 });
});

test("检定和其他节点交替，一站一站加进路线；3 次成功找到目标，下一站是精英战", () => {
  const { c, R, run, k } = bountyRun("BTY-B");
  R.acceptTask(run, k);
  assert.equal(run.task.nodes.length, 1);
  for (let i = 0; i < 3; i++) {
    assert.equal(R.currentNode(run).type, "check");
    passCheck(R, run);
    assert.equal(run.task.hunt.found, i + 1);
    if (i < 2) {
      assert.notEqual(R.currentNode(run).type, "check", "检定后面跟一站别的");
      assert.notEqual(R.currentNode(run).type, "elite");
      assert.equal(run.task.nodes.length, run.task.index + 1, "后面的路线还没显示");
      passOther(c, R, run);
    }
  }
  const n = R.currentNode(run);
  assert.equal(n.type, "elite");
  assert.ok(n.target);
  assert.ok(run.task.hunt.located);
  assert.match(run.task.hunt.target.name, /^【目标】/);
  // 目标那一战
  const spec = R.battleSpec(run);
  c.BattleSim.setup(spec);
  const tg = c.S.state.units.find(u => u.bountyTarget);
  assert.ok(tg);
  assert.match(tg.name, /^【目标】/);
  const base = c.enemyPresets().find(p => p.id === run.task.hunt.target.preset).build(spec.level, c.S.state.partySize);
  assert.equal(tg.layers[0].max, Math.round(base.layers[0].max * 1.5));
  assert.equal(c.effectiveAtk(tg, c.S.state.units), Math.round(base.personalAtk * 1.5));
  // 每一行敌人按代币算（成群的一行只算一次），目标再多算 1 枚：总数不超过精英战的 5 枚
  const tokens = spec.encounter.enemies.reduce((s, e) => s + c.enemyTokens(e.preset), 0);
  assert.ok(tokens + 1 <= 5, `目标多占 1 枚代币：${tokens} + 1`);
  assert.equal(spec.encounter.enemies.filter(e => e.bounty).length, 1);
  const notes = R.finishBattle(run, "win");
  assert.ok(notes.some(t => /任务「悬赏」完成/.test(t)), notes.join("\n"));
  assert.equal(run.stage, "camp");
});

test("检定失败（或绕过去）下一次换熟练项；失败 5 次目标也会直接出现", () => {
  const { c, R, run, k } = bountyRun("BTY-C");
  R.acceptTask(run, k);
  let lastProf = null;
  for (let i = 0; i < 5; i++) {
    const info = R.checkInfo(run);
    if (lastProf) assert.notEqual(info.prof, lastProf, "失败后换一个熟练项");
    lastProf = info.prof;
    R.skipCheck(run);
    assert.equal(run.task.hunt.fails, i + 1);
    if (i < 4) passOther(c, R, run);
  }
  assert.equal(R.currentNode(run).type, "elite");
  assert.ok(R.currentNode(run).target);
});

test("从目标那一战撤退：目标逃走，任务失败", () => {
  const { R, run, k } = bountyRun("BTY-D");
  R.acceptTask(run, k);
  for (let i = 0; i < 5; i++) { R.skipCheck(run); if (i < 4) passOther(null, R, run); }
  const notes = R.finishBattle(run, "retreat");
  assert.ok(notes.some(t => /悬赏失败：悬赏目标逃走了/.test(t)), notes.join("\n"));
  assert.equal(run.task, null);
});

test("同一个种子路线和目标都一样（读档不变）", () => {
  const a = bountyRun("BTY-E"), b = bountyRun("BTY-E");
  [a, b].forEach(({ R, run, k }) => { R.acceptTask(run, k); for (let i = 0; i < 3; i++) { R.skipCheck(run); if (i < 2) passOther(null, R, run); } });
  assert.deepEqual(plain(a.run.task.nodes.map(n => n.type)), plain(b.run.task.nodes.map(n => n.type)));
  assert.deepEqual(plain(a.run.task.nodes.filter(n => n.check).map(n => n.check.prof)), plain(b.run.task.nodes.filter(n => n.check).map(n => n.check.prof)));
});
