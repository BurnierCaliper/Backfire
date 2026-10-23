// 长线养成的任务经验照主持人手册的任务经验表（issue #334）
// rogue.js · taskPay / taskXp / partyLevel；trpg-tasks.js · TRPG_TASK_PAY / trpgTaskHandbookPay / trpgPartyLevel
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const H = require("./headless");
const plain = (x) => JSON.parse(JSON.stringify(x));

function fresh(opt) {
  const c = H.load();
  const o = Object.assign({ party: ["kolt", "helu"], seed: "TXP" }, opt || {});
  if (o.daily) o.party = plain(c.Rogue.dailyParty(o.seed));
  const run = c.Rogue.newRun(o);
  return { c, run, R: c.Rogue, tasks: vm.runInContext("ROGUE_TASKS", c), main: vm.runInContext("ROGUE_MAIN_TASK", c) };
}
const growth = (seed) => fresh({ seed, growth: true });
/** 队伍的等级设成 levels（经验清零：完成任务时不会顺带升级，好直接比经验） */
function setLevels(run, levels) {
  run.party.forEach((h, i) => { h.level = levels[i % levels.length]; h.xp = 0; });
}
/** 长线养成：抽人直到队伍满员、候补里也有人 */
function fillParty(c, run, R) {
  c.bagAdd("heart_fusion", 60);
  for (let i = 0; i < 60 && !run.reserve.length; i++) R.drawHero(run);
  assert.equal(run.party.length, c.S.ROGUE_GROWTH.partyMax);
  assert.ok(run.reserve.length, "抽到了候补");
}
/** 任务板上第一个不是悬赏的任务（悬赏的路线走完一站才往后加，不能直接跳到最后） */
const nonHunt = (run) => run.board.findIndex(t => !t.hunt);
/** 接下任务直接走到最后：路线只剩一个休息点，不休息直接离开就算完成。during：接下之后、完成之前做的事 */
function finishTask(run, R, which, during) {
  assert.ok(run.board[which] && !run.board[which].hunt, "挑一个不是悬赏的任务");
  R.acceptTask(run, which);
  if (during) during();
  run.task.nodes = [{ type: "rest", done: false }];
  run.task.index = 0;
  return R.restAtNode(run, "leave");
}

test("长线养成：短任务（2 天以内）每人经验按队伍平均等级分档——1–4 级 70、5–8 级 100、9–12 级 300、13–16 级 500、17–20 级 800", () => {
  const { run, R, tasks } = growth("TXP1");
  const short = tasks.filter(t => t.days <= 2);
  assert.ok(short.length, "任务模板里有短任务");
  [[1, 70], [4, 70], [5, 100], [8, 100], [9, 300], [12, 300], [13, 500], [16, 500], [17, 800], [20, 800]].forEach(([lv, xp]) => {
    setLevels(run, [lv]);
    short.forEach(t => assert.equal(R.taskPay(run, t).xp, xp, `${lv} 级 · ${t.name}（${t.days} 天）`));
    run.board.filter(t => t.days <= 2).forEach(t => assert.equal(R.taskPay(run, t).xp, xp, `${lv} 级 · 任务板上的「${t.name}」`));
  });
});

test("长线养成：按任务天数查长度档——3–5 天中任务每人 100 / 300 / 500 / 800 / 1500；6–10 天长任务、更长的极难任务照表", () => {
  const { run, R } = growth("TXP2");
  const base = plain(run.board[0]);
  const xpAt = (days, lv) => { setLevels(run, [lv]); return R.taskPay(run, Object.assign({}, base, { days })).xp; };
  const bands = [1, 5, 9, 13, 17];
  assert.deepEqual(bands.map(lv => xpAt(1, lv)), [70, 100, 300, 500, 800], "1 天：短");
  assert.deepEqual(bands.map(lv => xpAt(2, lv)), [70, 100, 300, 500, 800], "2 天：短");
  assert.deepEqual(bands.map(lv => xpAt(3, lv)), [100, 300, 500, 800, 1500], "3 天：中");
  assert.deepEqual(bands.map(lv => xpAt(5, lv)), [100, 300, 500, 800, 1500], "5 天：中");
  assert.deepEqual(bands.map(lv => xpAt(6, lv)), [300, 500, 1000, 2000, 4000], "6 天：长");
  assert.deepEqual(bands.map(lv => xpAt(11, lv)), [500, 1000, 2000, 5000, 10000], "11 天：极难");
});

test("队伍平均等级照跑团 trpgPartyLevel：上场的人平均、四舍五入；候补不算", () => {
  const { c, run, R } = growth("TXP3");
  fillParty(c, run, R);
  run.reserve.forEach(h => { h.level = 20; });   // 候补再高也不算
  const t = run.board[0];
  // [上场四人的等级, 平均（四舍五入）, 短任务每人经验]
  [[[4, 4, 4, 5], 4, 70], [[4, 4, 5, 5], 5, 100], [[1, 1, 1, 8], 3, 70], [[8, 8, 9, 9], 9, 300]].forEach(([lvs, avg, xp]) => {
    setLevels(run, lvs);
    assert.equal(R.partyLevel(run), avg, lvs.join("/"));
    // 跑团的算法：场上的英雄（不含武器人）平均、四舍五入
    c.BattleSim.setup({ party: run.party.map(h => h.kit), enemies: [], before: () => R.applyPartyToField(run) });
    assert.equal(c.trpgPartyLevel(), avg, `${lvs.join("/")}：和 trpgPartyLevel 一样`);
    assert.equal(R.taskPay(run, t).xp, xp, `${lvs.join("/")} → ${avg} 级`);
  });
});

test("长线养成完成任务：上场的每人都拿这一格的全额（不按人数平分），候补不拿；任务卡上写的就是实际拿到的", () => {
  const { c, run, R } = growth("TXP4");
  fillParty(c, run, R);
  setLevels(run, [6]);   // 5–8 级那一档
  run.reserve.forEach(h => { h.xp = 0; });
  const i = nonHunt(run);
  const shown = R.taskPay(run, run.board[i]).xp;
  assert.equal(shown, 100, "任务卡上写每人 100 经验");
  const notes = finishTask(run, R, i);
  assert.equal(run.stage, "camp", "任务完成");
  run.party.forEach(h => assert.equal(h.xp, 100, `${h.kit} 拿全额 100（四人平分才 25）`));
  run.reserve.forEach(h => assert.equal(h.xp, 0, `候补 ${h.kit} 不拿`));
  assert.ok(notes.some(n => /完成：获得 \d+ 奎支，每人 100 经验/.test(n)), notes.join("\n"));
});

test("长线养成：经验在接任务时就定下（作者 10/23）——任务途中平均等级跨了档，完成时照接任务时的档发", () => {
  const { run, R } = growth("TXP6");
  setLevels(run, [4]);
  const i = nonHunt(run);
  assert.equal(R.taskPay(run, run.board[i]).xp, 70, "接任务时 4 级：每人 70");
  finishTask(run, R, i, () => {
    setLevels(run, [5]);   // 任务途中升到 5 级
    assert.equal(R.taskPay(run, run.task).xp, 70, "进行中的任务卡上照旧是 70");
  });
  run.party.forEach(h => assert.equal(h.xp, 70, `${h.kit}：照接任务时 4 级那一档发 70`));
});

test("任务卡、联机任务板上的经验数读的是 Rogue.taskPay（和完成时发的同一个数）", () => {
  const read = (f) => fs.readFileSync(path.join(H.ROOT, f), "utf8");
  assert.match(read("rogue-ui.js"), /const pay = Rogue\.taskPay\(run, t\);[\s\S]{0,600}?每人 \$\{pay\.xp\} 经验/);
  assert.match(read("online-rogue.js"), /const pay = Rogue\.taskPay\(r, t\);\s*return \{[^}]*\bxp: pay\.xp\b/);
  assert.match(read("rogue.js"), /function completeTask\(run, notes\) \{\s*const t = run\.task;\s*const pay = taskPay\(run, t\);/);
});

test("普通单局、每日挑战、单人模式的任务经验不变：照任务模板（ROGUE_TASKS / ROGUE_MAIN_TASK 的 reward.xp），不看天数和等级", () => {
  const modes = {
    普通单局: fresh({ seed: "TXP5" }),
    每日挑战: fresh({ seed: "daily-2026-10-23", daily: true }),
    单人模式: fresh({ party: ["ruby"], partners: ["kolt", "yuito", "tou"], role2: "生存", solo: true, seed: "TXP5S" })
  };
  Object.entries(modes).forEach(([name, { run, R, tasks, main }]) => {
    assert.ok(!run.growth, name);
    [1, 6, 10, 17].forEach(lv => {
      setLevels(run, [lv]);
      tasks.concat([main]).forEach(t => assert.equal(R.taskPay(run, t).xp, t.reward.xp, `${name} ${lv} 级 · ${t.name}（${t.days} 天）`));
      run.board.concat(run.main ? [run.main] : []).forEach(t => assert.equal(R.taskPay(run, t).xp, t.reward.xp, `${name} ${lv} 级 · 任务板上的「${t.name}」`));
    });
  });
  // 完成一个支线：每人照模板拿
  const { run, R } = fresh({ seed: "TXP5" });
  setLevels(run, [6]);
  const i = nonHunt(run);
  const t = run.board[i];
  const notes = finishTask(run, R, i);
  assert.equal(run.stage, "camp");
  run.party.forEach(h => assert.equal(h.xp, t.reward.xp, `${h.kit} 照模板拿 ${t.reward.xp}`));
  assert.ok(notes.some(n => n.includes(`每人 ${t.reward.xp} 经验`)), notes.join("\n"));
});
