// Roguelike 单局流程：任务板、节点、休整、BOSS、幕间、永久死亡、经验与武器成长。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = (x) => JSON.parse(JSON.stringify(x));

/** 自动把一局打完（战斗用 BattleSim，玩家一方是朴素打法）。返回走过的每一步。 */
function autoplay(c, run, maxSteps) {
  const { Rogue, BattleSim } = c;
  const steps = [];
  for (let i = 0; i < (maxSteps || 400) && run.stage !== "over"; i++) {
    if (run.stage === "board") {
      // 先做支线，天数不够了再做主线
      const ok = run.board.map((t, j) => [t, j]).filter(([t]) => !Rogue.taskBlocked(run, t));
      const side = ok.find(([t]) => !t.key && Rogue.daysLeft(run) - t.days >= 3);
      const [task, j] = side || ok.find(([t]) => t.key) || ok[0];
      Rogue.acceptTask(run, j);
      steps.push("task:" + task.kind);
    } else if (run.stage === "task" || run.stage === "boss") {
      const node = run.stage === "task" ? Rogue.currentNode(run) : { type: "boss" };
      if (node.type === "rest") {
        Rogue.restAtNode(run, Rogue.canLongRest(run) ? "long" : "short");
        steps.push("rest");
      } else {
        const spec = Rogue.battleSpec(run);
        BattleSim.setup(spec);
        const r = BattleSim.run({ maxRounds: 40 });
        Rogue.finishBattle(run, r.winner === "player");
        steps.push(node.type + ":" + r.winner);
      }
    } else if (run.stage === "camp") {
      Rogue.camp(run);
      steps.push("camp");
    } else if (run.stage === "interlude") {
      Rogue.nextAct(run);
      steps.push("act" + run.act);
    }
  }
  return steps;
}

test("开局：任务板上有主线，任务板不暴露节点给界面以外的东西也没关系，但节点是线性的", () => {
  const c = H.load();
  const run = c.Rogue.newRun({ party: ["kolt", "helu"], seed: "R1" });
  assert.equal(run.stage, "board");
  assert.equal(run.board.length, c.Rogue.CONFIG.boardSize);
  assert.ok(run.board.some(t => t.key));
  c.Rogue.acceptTask(run, 0);
  assert.equal(run.stage, "task");
  assert.equal(run.task.index, 0);
});

test("同一个种子，任务板和每一场遭遇都一样", () => {
  const a = H.load(), b = H.load();
  const ra = a.Rogue.newRun({ party: ["kolt", "helu"], seed: "SAME" });
  const rb = b.Rogue.newRun({ party: ["kolt", "helu"], seed: "SAME" });
  assert.deepEqual(plain(ra.board), plain(rb.board));
  a.Rogue.acceptTask(ra, 1); b.Rogue.acceptTask(rb, 1);
  const ea = a.Rogue.battleSpec(ra), eb = b.Rogue.battleSpec(rb);
  if (ea) assert.deepEqual(plain(ea.encounter), plain(eb.encounter));
});

test("Roguelike 模式下升级所需经验为原来的 1/3，离开后恢复", () => {
  const c = H.load();
  const full = c.xpToNext(1);
  c.Rogue.enterRunMode();
  assert.equal(c.xpToNext(1), Math.ceil(full / 3));
  c.Rogue.leaveRunMode();
  assert.equal(c.xpToNext(1), full);
});

test("每完成配置数量的任务，全队武器 +1 级（绯秋两把刀都升）", () => {
  const c = H.load();
  const run = c.Rogue.newRun({ party: ["hiaki", "kolt"], seed: "W" });
  const every = c.Rogue.CONFIG.weaponLevelEveryTasks;
  for (let n = 0; n < every; n++) {
    run.stage = "board";
    run.board = c.Rogue.makeBoard(run);
    const j = run.board.findIndex(t => !t.key);
    c.Rogue.acceptTask(run, j);
    run.task.nodes = [{ type: "rest", done: false }];   // 直接走完
    c.Rogue.restAtNode(run, "short");
  }
  const lv = Object.fromEntries(run.party.map(h => [h.kit, plain(h.weaponLevels)]));
  assert.deepEqual(lv.hiaki, { niu: 2, naruto: 2 });
  assert.deepEqual(lv.kolt, { torque: 2 });
});

test("战斗里阵亡的角色连同武器人永久离队", () => {
  const c = H.load();
  const run = c.Rogue.newRun({ party: ["kolt", "helu", "ras"], seed: "D" });
  c.Rogue.acceptTask(run, run.board.findIndex(t => !t.key));
  const spec = c.Rogue.battleSpec(run);
  c.BattleSim.setup(spec);
  c.findKit("kolt", c.S.state.units).dead = true;
  c.Rogue.finishBattle(run, true);
  assert.deepEqual(run.party.map(h => h.kit), ["helu", "ras"]);
  assert.equal(run.fallen[0].kit, "kolt");
});

test("战斗之间血量会保留，不会每场回满", () => {
  const c = H.load();
  const run = c.Rogue.newRun({ party: ["kolt", "helu"], seed: "HP" });
  c.Rogue.acceptTask(run, run.board.findIndex(t => !t.key));
  c.BattleSim.setup(c.Rogue.battleSpec(run));
  c.findKit("kolt", c.S.state.units).layers[0].current = 7;
  c.Rogue.finishBattle(run, true);
  if (run.stage === "task" && c.Rogue.currentNode(run).type !== "rest") {
    c.BattleSim.setup(c.Rogue.battleSpec(run));
    assert.equal(c.findKit("kolt", c.S.state.units).layers[0].current, 7);
  }
});

test("自动打完整局：流程能走到结束，不报错；同种子过程一致", () => {
  const runOnce = (seed) => {
    const c = H.load();
    c.Rogue.enterRunMode();
    const run = c.Rogue.newRun({ party: ["chuan", "kolt", "helu", "ras"], seed });
    const steps = autoplay(c, run);
    return { c, run, steps };
  };
  const a = runOnce("FULL-1");
  assert.equal(a.run.stage, "over");
  assert.deepEqual(plain(a.c.__errors), []);
  assert.ok(a.steps.length > 3);
  const b = runOnce("FULL-1");
  assert.deepEqual(b.steps, a.steps);
});

test("能打过 BOSS 进入下一幕（多试几个种子，至少有一局进到第 2 幕）", () => {
  let best = 1;
  for (let i = 0; i < 6 && best < 2; i++) {
    const c = H.load();
    c.Rogue.enterRunMode();
    const run = c.Rogue.newRun({ party: ["ras", "nora", "xia", "chuan"], seed: "ACT" + i });
    autoplay(c, run);
    best = Math.max(best, run.result ? run.result.act : run.act);
    assert.deepEqual(plain(c.__errors), []);
  }
  assert.ok(best >= 2, "六局都没能进第 2 幕");
});

module.exports = { autoplay };
