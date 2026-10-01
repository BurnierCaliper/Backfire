// Roguelike 单局：主线期限、任务板、节点、休息、商店、工匠、升级选择、撤退、额外幕、存档升级。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = (x) => JSON.parse(JSON.stringify(x));

/** 自动把一局打完（战斗用 BattleSim 的朴素打法）。opts.goOn：通关后继续额外幕 */
function autoplay(c, run, opts) {
  opts = opts || {};
  const { Rogue, BattleSim } = c;
  const steps = [];
  for (let i = 0; i < (opts.maxSteps || 600) && run.stage !== "over"; i++) {
    // 升级选择：先做完
    const pend = Rogue.pendingChoices(run);
    if (pend.length) {
      const p = pend[0];
      Rogue.choose(run, p.kit, p.index, Rogue.choiceOptions(run, p.kit, p.index)[0].value);
      steps.push("pick");
      continue;
    }
    if (run.stage === "board") {
      const side = run.board.findIndex(t => !Rogue.taskBlocked(run, t) && !Rogue.taskWarning(run, t));
      Rogue.acceptTask(run, side >= 0 ? side : "main");
      steps.push(side >= 0 ? "side" : "main");
    } else if (run.stage === "task" || run.stage === "boss") {
      const node = run.stage === "task" ? Rogue.currentNode(run) : { type: "boss" };
      if (node.type === "rest") {
        Rogue.restAtNode(run, Rogue.canLongRest(run) ? "long" : "short");
        steps.push("rest");
      } else if (node.type === "check") {
        const best = run.party.map(h => Rogue.checkOdds(run, h.kit)).sort((a, b) => b.chance - a.chance)[0];
        if (best && best.chance) Rogue.attemptCheck(run, best.kit);
        else Rogue.skipCheck(run);
        steps.push("check");
      } else if (node.type === "shop" || node.type === "smith" || node.type === "clinic") {
        steps.push(node.type);
        Rogue.leaveNode(run);
      } else {
        const spec = Rogue.battleSpec(run);
        BattleSim.setup(spec);
        const r = BattleSim.run({ maxRounds: 40 });
        Rogue.finishBattle(run, r.winner === "player" ? "win" : "lose");
        steps.push(`${node.type}:Lv${spec.level}:${r.winner}`);
      }
    } else if (run.stage === "camp") {
      Rogue.camp(run);
      steps.push("camp");
    } else if (run.stage === "interlude") {
      Rogue.nextAct(run);
      steps.push("act" + run.act);
    } else if (run.stage === "victory") {
      Rogue.afterVictory(run, !!opts.goOn);
      steps.push("victory");
    }
  }
  return steps;
}

/** 新开一局（已进入单局模式） */
function fresh(party, seed) {
  const c = H.load();
  const run = c.Rogue.newRun({ party, seed });
  return { c, run, R: c.Rogue };
}

test("开幕自动接下主线，任务板上只有支线", () => {
  const { run, R } = fresh(["kolt", "helu"], "R1");
  assert.ok(run.main && run.main.key && !run.main.done);
  assert.equal(run.stage, "board");
  assert.equal(run.board.length, R.CONFIG.sideTasksOnBoard);
  assert.ok(run.board.every(t => !t.key));
  assert.equal(R.daysLeft(run), 8);
});

test("天数不够的任务不能接；会耽误主线的支线给出警告", () => {
  const { run, R } = fresh(["kolt", "helu"], "R2");
  run.actDay = 7;
  const long = run.board.find(t => t.days > 1);
  if (long) assert.match(R.taskBlocked(run, long), /天数不够/);
  run.actDay = 8 - run.main.days - 1;
  const t = run.board.find(x => !R.taskBlocked(run, x));
  if (t) assert.match(R.taskWarning(run, t) || "", /来不及/);
});

test("主线期限到了还没完成：本局结束", () => {
  const { run, R } = fresh(["kolt", "helu"], "R3");
  run.actDay = 8 - run.main.days;   // 再休整一天就来不及
  run.stage = "camp";
  R.camp(run);
  assert.equal(run.stage, "over");
  assert.equal(run.result.win, false);
  assert.match(run.result.text, /主线/);
});

test("主线提前完成后还能继续做支线；本幕天数用完才打首领", () => {
  const { run, R } = fresh(["kolt", "helu"], "R4");
  R.acceptTask(run, "main");
  run.task.nodes = [{ type: "rest", done: false }];
  R.restAtNode(run, "short");
  assert.equal(run.main.done, true);
  R.camp(run);
  assert.equal(run.stage, "board", "主线完成但天数没用完：回任务板");
  // 一直做支线直到天数用完
  for (let i = 0; i < 10 && run.stage === "board"; i++) {
    const j = run.board.findIndex(t => !R.taskBlocked(run, t));
    R.acceptTask(run, j);
    run.task.nodes = [{ type: "rest", done: false }];
    R.restAtNode(run, "short");
    R.camp(run);
  }
  assert.equal(run.stage, "boss");
  assert.ok(R.daysLeft(run) < 2, "首领应当在本幕天数用完（或接不了任务）时才出现");
});

test("任务里每个节点的类型都能看到", () => {
  const { run, R } = fresh(["kolt", "helu"], "R5");
  R.acceptTask(run, "main");
  assert.ok(run.task.nodes.every(n => ["battle", "elite", "rest", "shop", "smith", "clinic", "check"].includes(n.type)));
  assert.equal(run.task.nodes[run.task.nodes.length - 1].type, "elite");
});

test("敌人等级：第 1 幕随天数上涨；首领 = 本幕上限 + bossLevelOffset（第 4 幕上限 15，额外幕 20、25）", () => {
  const { run, R } = fresh(["kolt", "helu"], "R6");
  const early = R.enemyLevel(run, 0);
  run.actDay = 7;
  assert.ok(R.enemyLevel(run, 0) > early);
  run.stage = "boss";
  const off = R.CONFIG.bossLevelOffset || 0;
  assert.equal(R.battleSpec(run).level, R.CONFIG.actLevels[0][1] + off);
  run.act = 4;
  assert.equal(R.battleSpec(run).level, 15 + off);
  run.extra = true; run.act = 5;
  assert.equal(R.battleSpec(run).level, 20 + off);
  run.act = 6;
  assert.equal(R.battleSpec(run).level, 25 + off);
});

test("首领战随从按 bossEscortTokens", () => {
  const { run, R } = fresh(["kolt", "helu"], "R6b");
  run.stage = "boss";
  assert.equal(R.battleSpec(run).encounter.tokens, R.CONFIG.bossEscortTokens);
});

test("商店：花奎支买水和食物", () => {
  const { c, run, R } = fresh(["kolt", "helu"], "R7");
  R.acceptTask(run, 0);
  run.task.nodes[run.task.index] = { type: "shop", done: false };
  const before = R.supplies();
  R.buy(run, "water_1000", 2);
  R.buy(run, "food_can", 1);
  const after = R.supplies();
  assert.equal(after.water, before.water + 2000);
  assert.equal(after.food.food_can, before.food.food_can + 1);
  assert.equal(after.kuizhi, before.kuizhi - 2500);
  c.S.state.kuizhi = 0;
  assert.throws(() => R.buy(run, "food_can", 1), /奎支不够/);
});

test("工匠：花钱升级武器（材料按物品表折价），绯秋两把刀分开升", () => {
  const { c, run, R } = fresh(["hiaki", "kolt"], "R8");
  R.acceptTask(run, 0);
  run.task.nodes[run.task.index] = { type: "smith", done: false, smith: "zekahr" };
  c.S.state.kuizhi = 100000;
  R.upgradeWeapon(run, "niu");
  assert.equal(run.party.find(h => h.kit === "hiaki").weaponLevels.niu, 2);
  assert.equal(run.party.find(h => h.kit === "hiaki").weaponLevels.naruto, 1);
  assert.equal(R.smithCost(2), 500);          // 3 金属 = 3000，× 1/6
  assert.equal(R.smithCost(5), 3300);         // 2 精炼合金 + 2 金属 + 加工费 8000 = 20000，× 1/6，按 100 取整
  assert.equal(R.smithCost(10), 45000);       // 1 赫心结晶 + 3 稀有晶体 + 加工费 20000 = 270000，× 1/6
  assert.equal(c.S.state.kuizhi, 100000 - 500);
});

test("任务之间的休整可以买东西；任务里的战斗节点不行", () => {
  const { run, R } = fresh(["kolt", "helu"], "E1");
  R.acceptTask(run, "main");
  while (!R.battleSpec(run)) { run.task.index++; }
  assert.throws(() => R.buy(run, "food_can", 1), /没有商店/);
  run.task = null; run.stage = "camp";
  R.buy(run, "food_can", 1);
});

test("报酬与委托方补给按人数给；奎支报酬随幕数上涨", () => {
  const two = fresh(["kolt", "helu"], "E2"), four = fresh(["kolt", "helu", "ras", "chuan"], "E2");
  const p2 = two.R.taskPay(two.run, two.run.main), p4 = four.R.taskPay(four.run, four.run.main);
  assert.equal(p4.kuizhi, p2.kuizhi * 2);
  assert.equal(p4.water, p2.water * 2);
  assert.equal(p4.xp, p2.xp);
  const act1 = p2.kuizhi;
  two.run.act = 4;
  const scale = two.R.CONFIG.rewardActScale[3];
  assert.equal(two.R.taskPay(two.run, two.run.main).kuizhi, Math.round(act1 * scale / 100) * 100);
});

test("单局掉落按杂兵 / 精英 / 首领三档；战斗原型仍按手册", () => {
  const { c, run, R } = fresh(["kolt", "helu"], "E3");
  R.acceptTask(run, "main");
  while (!R.battleSpec(run)) { run.task.index++; }
  c.BattleSim.setup(R.battleSpec(run));
  const L = R.CONFIG.lootByRank;
  assert.equal(c.rollEnemyLoot({ kit: "sand_beast" }), L.minion);
  assert.equal(c.rollEnemyLoot({ kit: "giant" }), L.elite);
  assert.equal(c.rollEnemyLoot({ kit: "outlaw_king" }), L.boss);
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  assert.equal(c.rollEnemyLoot({ kit: "sand_beast" }), 0);
});

test("完成任务不再自动升级武器", () => {
  const { run, R } = fresh(["kolt", "helu"], "R9");
  for (let i = 0; i < 3; i++) {
    run.stage = "board"; R.makeBoard(run);
    R.acceptTask(run, 0);
    run.task.nodes = [{ type: "rest", done: false }];
    R.restAtNode(run, "short");
  }
  assert.equal(run.party.find(h => h.kit === "kolt").weaponLevels.torque, 1);
});

test("升级到 4 级、5 级：要选属性点和职责技能；8 级不能加在同一项上", () => {
  const { run, R } = fresh(["kolt", "helu"], "R10");
  const h = run.party[0];
  h.xp = 5000;                           // 攒够经验
  R.acceptTask(run, 0);
  run.task.nodes = [{ type: "rest", done: false }];
  R.restAtNode(run, "short");            // 完成任务时结算升级
  const pend = R.pendingChoices(run).filter(p => p.kit === h.kit);
  const types = pend.map(p => p.choice.type + p.choice.level);
  assert.ok(types.includes("attr4"), types.join(","));
  // 柯尔特的角色卡是专精坦克：5 级没有选择，直接学会主职责二
  assert.ok(!types.includes("role5"), types.join(","));
  assert.deepEqual(plain(h.rolePicks[5]), { role: h.roles ? h.roles.primary : plain(h.rolePicks[5]).role, n: 2 });
  const a4 = pend.find(p => p.choice.level === 4);
  R.choose(run, h.kit, a4.index, "str");
  assert.equal(h.attrs.str, 9);   // 柯尔特力量 8
  const r5 = R.pendingChoices(run).find(p => p.kit === h.kit && p.choice.level === 5);
  if (r5) {
    const opt = R.choiceOptions(run, h.kit, r5.index);
    assert.ok(opt.length >= 1);
    R.choose(run, h.kit, r5.index, opt[0].value);
    assert.deepEqual(plain(h.rolePicks[5]), plain(opt[0].value));
  }
  const a8 = R.pendingChoices(run).find(p => p.kit === h.kit && p.choice.level === 8);
  if (a8) assert.ok(!R.choiceOptions(run, h.kit, a8.index).some(o => o.value === "str"));
});

test("濒死的角色在战斗结束后恢复到 1 点生命；武器人伤势带到下一场", () => {
  const { c, run, R } = fresh(["kolt", "helu"], "R11");
  R.acceptTask(run, "main");
  while (!R.battleSpec(run)) { run.task.index++; }
  c.BattleSim.setup(R.battleSpec(run));
  const st = c.S.state;
  const kolt = c.findKit("kolt", st.units);
  kolt.layers[0].current = 0; kolt.dying = true;
  const torque = c.spawnWeapon(kolt, "torque");
  torque.layers[0].current = 5;
  R.finishBattle(run, "win");
  assert.deepEqual(plain(run.party[0].hp), [{ type: "flesh", current: 1 }]);
  assert.equal(c.weaponCarryLayers("torque")[0].current, 5);
});

test("战斗结束武器耐久 −1（手册）", () => {
  const { c, run, R } = fresh(["kolt", "helu"], "R12");
  R.acceptTask(run, "main");
  while (!R.battleSpec(run)) { run.task.index++; }
  c.BattleSim.setup(R.battleSpec(run));
  const max = c.weaponDurMax("torque");
  R.finishBattle(run, "win");
  assert.equal(c.LEDGER.dur.torque, max - 1);
});

test("撤退：这一站算跳过，任务继续；首领战不能撤退", () => {
  const { c, run, R } = fresh(["kolt", "helu"], "R13");
  R.acceptTask(run, "main");
  while (!R.battleSpec(run)) { run.task.index++; }
  const at = run.task.index;
  c.BattleSim.setup(R.battleSpec(run));
  c.startCombat();
  c.performRetreat();
  R.finishBattle(run, "retreat");
  assert.ok(run.task ? run.task.index === at + 1 : run.stage === "camp");
  run.stage = "boss";
  assert.equal(R.battleSpec(run).retreat, false);
});

test("力竭：超过 20 小时没长休，开战时带上力竭；满 80 小时本局结束", () => {
  const { c, run, R } = fresh(["kolt", "helu"], "R14");
  R.acceptTask(run, "main");
  while (!R.battleSpec(run)) { run.task.index++; }
  c.LEDGER.hours = 45;
  c.BattleSim.setup(R.battleSpec(run));
  assert.equal(c.S.state.exhaustTier, 2);
  c.LEDGER.hours = 79;
  R.finishBattle(run, "win");
  assert.equal(run.stage, "over");
  assert.match(run.result.text, /力竭/);
});

test("离开单局后，战斗原型的队伍档案和经验曲线原样恢复", () => {
  const c = H.load();
  c.LEDGER.hours = 7;
  c.S.state.kuizhi = 123;
  const run = c.Rogue.newRun({ party: ["kolt", "helu"], seed: "R15" });
  assert.notEqual(c.S.state.kuizhi, 123);
  assert.equal(c.xpToNext(1), Math.ceil(155 / 3));
  c.Rogue.leaveRunMode(run);
  assert.equal(c.S.state.kuizhi, 123);
  assert.equal(c.LEDGER.hours, 7);
  assert.equal(c.xpToNext(1), 155);
  c.Rogue.enterRunMode(run);
  assert.equal(c.S.state.kuizhi, run.world.kuizhi);
});

test("第 1 版存档（M1）能升级读取", () => {
  const c = H.load();
  const v1 = { seed: "OLD", act: 1, day: 3, actDay: 2, stage: "board", party: [{ kit: "kolt", weapons: ["torque"], level: 2, xp: 10, weaponLevels: { torque: 1 } }, { kit: "helu", weapons: ["ecmo"], level: 1, xp: 0, weaponLevels: { ecmo: 1 } }],
    supplies: { water: 3000, food: 5, kuizhi: 900 }, board: [], task: null, log: [] };
  c.localStorage.setItem(c.SaveStore.KEYS.run, JSON.stringify({ kind: "run", version: 1, savedAt: 0, data: v1 }));
  const run = c.SaveStore.loadRun();
  assert.equal(run.world.kuizhi, 900);
  c.Rogue.enterRunMode(run);
  assert.ok(run.main);
  assert.equal(c.Rogue.supplies().water, 3000);
  assert.equal(c.Rogue.supplies().food.food_liquid, 5);
});

test("存档读回来接着玩，结果和不存档一样", () => {
  const a = fresh(["chuan", "kolt", "helu", "ras"], "SAVE");
  const stepsA = autoplay(a.c, a.run, { maxSteps: 12 });
  a.R.save(a.run);
  const saved = a.c.localStorage.getItem(a.c.SaveStore.KEYS.run);
  const b = H.load();
  b.localStorage.setItem(b.SaveStore.KEYS.run, saved);
  const runB = b.SaveStore.loadRun();
  b.Rogue.enterRunMode(runB);
  const restB = autoplay(b, runB, { maxSteps: 30 });
  const restA = autoplay(a.c, a.run, { maxSteps: 30 });
  assert.deepEqual(restB, restA);
  assert.ok(stepsA.length);
});

test("自动打完整局：流程走得到底，不报错；同种子过程一致", () => {
  const once = (seed) => { const f = fresh(["chuan", "kolt", "helu", "ras"], seed); return { f, steps: autoplay(f.c, f.run) }; };
  const a = once("FULL-1");
  assert.equal(a.f.run.stage, "over");
  assert.deepEqual(plain(a.f.c.__errors), []);
  assert.deepEqual(once("FULL-1").steps, a.steps);
});

test("多跑几局（朴素打法）都能走到结局，不报错", () => {
  for (let i = 0; i < 6; i++) {
    const f = fresh(["ras", "nora", "xia", "chuan"], "ACT" + i);
    autoplay(f.c, f.run);
    assert.deepEqual(plain(f.c.__errors), []);
    assert.equal(f.run.stage, "over");
  }
});

test("首领战胜利 → 幕间 → 下一幕（新主线、天数重置）；第 4 幕后可通关或继续额外幕", () => {
  const { c, run, R } = fresh(["kolt", "helu"], "FLOW");
  const winBoss = () => {
    run.stage = "boss";
    c.BattleSim.setup(R.battleSpec(run));
    R.finishBattle(run, "win");
  };
  winBoss();
  assert.equal(run.stage, "interlude");
  R.nextAct(run);
  assert.equal(run.act, 2);
  assert.equal(run.actDay, 0);
  assert.equal(run.main.done, false);
  assert.equal(run.stage, "board");
  run.act = 4;
  winBoss();
  assert.equal(run.stage, "victory");
  R.afterVictory(run, true);
  assert.equal(run.act, 5);
  assert.equal(run.extra, true);
  run.act = 6;
  winBoss();
  assert.equal(run.stage, "over");
  assert.equal(run.result.win, true);
  // 不继续：直接通关
  const g = fresh(["kolt", "helu"], "FLOW2");
  g.run.act = 4; g.run.stage = "boss";
  g.c.BattleSim.setup(g.R.battleSpec(g.run));
  g.R.finishBattle(g.run, "win");
  g.R.afterVictory(g.run, false);
  assert.equal(g.run.stage, "over");
  assert.equal(g.run.result.win, true);
});

/* ---------- 诊所：义体改造 ---------- */

function atCamp(party, seed) {
  const f = fresh(party, seed);
  f.run.stage = "camp";
  f.c.S.state.kuizhi = 50000;
  return f;
}

test("义体改造：换算比例 8:7:6:6，排列 沙尘 → 护盾 → 装甲 → 肉体（外到内）", () => {
  const { run, R } = atCamp(["kolt", "helu"], "CY1");
  const info = R.cyberInfo(run, "kolt");       // 柯尔特：肉体 20，智力 7 → 改造率 70% → 最多 14
  assert.equal(info.fleshMax, 20);
  assert.equal(info.limit, 14);
  const pv = R.cyberPreview(run, "kolt", { armor: 8, sand: 4 });
  assert.equal(pv.error, null);
  assert.deepEqual(plain(pv.layers), [{ type: "sand", max: 3 }, { type: "armor", max: 7 }, { type: "flesh", max: 8 }]);
});

test("义体改造的限制：不超过改造率、最多 3 种血量、内层必须是肉体或星灵", () => {
  const { run, R } = atCamp(["kolt", "helu"], "CY2");
  assert.match(R.cyberPreview(run, "kolt", { armor: 15 }).error, /最多只能改造 14/);
  assert.match(R.cyberPreview(run, "kolt", { armor: 2, shield: 2, sand: 2 }).error, /最多 3 种/);
  assert.equal(R.cyberPreview(run, "kolt", { armor: 2, shield: 2 }).error, null);
});

test("肉体可以按 8:7 全部换成星灵，不受改造率限制，而且只能二选一当内层", () => {
  const { run, R } = atCamp(["kolt", "helu"], "CY3");
  const pv = R.cyberPreview(run, "kolt", { armor: 8, spirit: true });
  assert.deepEqual(plain(pv.layers), [{ type: "armor", max: 7 }, { type: "spirit", max: 10 }]);   // 剩 12 肉体 → 10 星灵
  assert.ok(pv.layers.every(l => l.type !== "flesh"));
});

test("改造花钱：动了多少点肉体收多少；改完血量层跨战斗保留，升级后照方案重算", () => {
  const { c, run, R } = atCamp(["kolt", "helu"], "CY4");
  const before = c.S.state.kuizhi;
  R.modifyHero(run, "kolt", { armor: 8, shield: 4 });
  const per = c.S.ROGUE_CLINIC.cyberPerHp;
  assert.equal(before - c.S.state.kuizhi, 12 * per);
  const v1 = R.heroView(run, run.party[0]);
  assert.deepEqual(plain(v1.layers.map(l => [l.type, l.max])), [["shield", 3], ["armor", 7], ["flesh", 8]]);
  // 改回一部分：只收变化的量
  const b2 = c.S.state.kuizhi;
  R.modifyHero(run, "kolt", { armor: 8, shield: 0 });
  assert.equal(b2 - c.S.state.kuizhi, 4 * per);
  // 进战斗：场上的柯尔特就是改造后的血量层
  run.stage = "board"; run.board = R.makeBoard(run);
  R.acceptTask(run, "main");
  while (!R.battleSpec(run)) { run.task.index++; }
  c.BattleSim.setup(R.battleSpec(run));
  const kolt = c.findKit("kolt", c.S.state.units);
  assert.deepEqual(plain(kolt.layers.map(l => [l.type, l.max])), [["armor", 7], ["flesh", 12]]);
  assert.equal(c.innermostLayer(kolt).type, "flesh");
  // 升级：肉体上限按等级涨，改造方案不变
  run.party[0].level = 3;
  const v3 = R.heroView(run, run.party[0]);
  assert.equal(v3.layers.find(l => l.type === "armor").max, 7);
  assert.ok(v3.layers.find(l => l.type === "flesh").max > 12);
});

test("诊所治疗：按缺的血量收钱，治完满血", () => {
  const { c, run, R } = atCamp(["kolt", "helu"], "CY5");
  run.party[0].hp = [{ type: "flesh", current: 11 }];
  const cost = R.healCost(run, "kolt");
  assert.equal(cost, 9 * c.S.ROGUE_CLINIC.healPerHp);
  R.healHero(run, "kolt");
  const v = R.heroView(run, run.party[0]);
  assert.equal(v.hp, v.hpMax);
});

test("诊所只在诊所节点或回城休整时能用", () => {
  const { run, R } = fresh(["kolt", "helu"], "CY6");
  R.acceptTask(run, "main");
  while (!R.battleSpec(run)) { run.task.index++; }
  assert.throws(() => R.modifyHero(run, "kolt", { armor: 2 }), /没有诊所/);
});

module.exports = { autoplay };

test("进下一站前可以先长休一次：消耗补给、回满血、清空力竭，每站一次，不推进本幕天数", () => {
  const { c, run, R } = fresh(["kolt", "helu"], "RB1");
  R.acceptTask(run, "main");
  run.task.nodes[run.task.index] = { type: "battle", done: false };
  const day0 = run.actDay;
  c.S.LEDGER.hours = 30;
  const water0 = R.supplies().water;
  assert.equal(R.canRestBefore(run).ok, true);
  R.restBeforeNode(run);
  assert.equal(R.hoursAwake(), 0);
  assert.ok(R.supplies().water < water0);
  assert.equal(run.actDay, day0);
  assert.equal(R.canRestBefore(run).ok, false);
  assert.throws(() => R.restBeforeNode(run), /已经长休/);
  // 首领战前也可以
  run.stage = "boss";
  assert.equal(R.canRestBefore(run).ok, true);
  R.restBeforeNode(run);
  assert.equal(R.canRestBefore(run).ok, false);
});

test("战场配置物与地形：越往后越常见；带天气的任务里每一场都是那种天气", () => {
  const rate = (act) => {
    let hit = 0, n = 0;
    for (let s = 0; s < 60; s++) {
      const { run, R } = fresh(["kolt", "helu"], "BF" + act + "-" + s);
      run.act = act;
      R.acceptTask(run, 0);
      run.task.nodes[run.task.index] = { type: "battle", done: false };
      const spec = R.battleSpec(run);
      n++; if ((spec.encounter.features || []).length) hit++;
    }
    return hit / n;
  };
  const r1 = rate(1), r4 = rate(4);
  assert.ok(r4 > r1, `第 1 幕 ${r1}，第 4 幕 ${r4}`);
  // 摆上场
  const { c, run, R } = fresh(["kolt", "helu"], "BFX");
  R.acceptTask(run, 0);
  run.task.nodes[run.task.index] = { type: "battle", done: false };
  run.task.weather = "thunder";
  const spec = R.battleSpec(run);
  spec.encounter.features = [
    { type: "prop", what: "boom", zone: 2 }, { type: "prop", what: "turret", faction: "enemy", zone: 2 },
    { type: "field", what: "fire", zone: 1 }, { type: "field", what: "highland", zone: 2 },
    { type: "gap", what: "bridge", key: "1-2" }
  ];
  c.BattleSim.setup(spec);
  const st = c.S.state;
  assert.equal(st.weather, "thunder");
  assert.ok(st.props.some(p => p.kind === "boom"));
  assert.ok(st.props.some(p => p.kind === "turret" && p.faction === "enemy"));
  assert.ok(c.fieldFireOn(st.fields[1]));
  assert.equal(st.fields[2].highland, true);
  assert.equal(st.gaps["1-2"].type, "bridge");
  assert.ok(st.gaps["1-2"].hp > 0);
});

test("休息点可以不休息直接离开：+250 奎支，不花时间，前进到下一站", () => {
  const { c, run, R } = fresh(["kolt", "helu"], "RS1");
  R.acceptTask(run, "main");
  run.task.nodes[run.task.index] = { type: "rest", done: false };
  const idx = run.task.index;
  const kz = c.S.state.kuizhi;
  const hrs = R.hoursAwake();
  R.restAtNode(run, "leave");
  assert.equal(c.S.state.kuizhi, kz + 250);
  assert.equal(run.task.index, idx + 1);
  assert.ok(R.hoursAwake() >= hrs, "不回到 0（没休息）");
});

test("进下一站前也能短休：按今天的短休次数（每人 2 次），花 1 小时，回点血", () => {
  const { c, run, R } = fresh(["kolt", "helu"], "RS2");
  R.acceptTask(run, "main");
  run.task.nodes[run.task.index] = { type: "battle", done: false };
  run.party.forEach(h => { h.hp = [{ type: "flesh", current: 3 }]; });
  const hpOf = (h) => (h.hp || []).reduce((a, l) => a + (Number(l.current) || 0), 0);
  const hpBefore = run.party.map(hpOf);
  const h0 = R.hoursAwake();
  assert.equal(R.canShortRestBefore(run).ok, true);
  R.shortRestBeforeNode(run);
  assert.equal(R.hoursAwake(), h0 + 1);
  assert.ok(run.party.every((h, i) => hpOf(h) > hpBefore[i]), "应该回血：" + JSON.stringify(run.party.map(h => h.hp)));
  R.shortRestBeforeNode(run);
  assert.equal(R.canShortRestBefore(run).ok, false, "两次用完");
  assert.throws(() => R.shortRestBeforeNode(run), /用完/);
  // 首领战前也行（次数还是同一天的）
  run.stage = "boss";
  assert.equal(R.canShortRestBefore(run).ok, false);
});

/* ---------- 熟练项检定 ---------- */
/** 把当前节点换成一个指定内容的检定 */
function forceCheck(run, check) {
  run.task.nodes[run.task.index] = { type: "check", done: false, check: Object.assign({ prof: "运动" }, check) };
}
const hpSum = (h) => (h.hp || []).reduce((a, l) => a + (Number(l.current) || 0), 0);

test("检定节点只插在两场战斗之间，一个任务最多 2 个", () => {
  let seen = 0;
  for (let i = 0; i < 40; i++) {
    const { c, run } = fresh(["kolt", "helu"], "CK" + i);
    for (const t of [run.main].concat(run.board)) {
      const ty = t.nodeTypes;
      const n = ty.filter(x => x === "check").length;
      assert.ok(n <= c.S.ROGUE_CHECKS.maxPerTask, ty.join(","));
      ty.forEach((x, k) => {
        if (x !== "check") return;
        seen += 1;
        const fight = (y) => y === "battle" || y === "elite";
        assert.ok(k > 0 && fight(ty[k - 1]) && fight(ty[k + 1]), "检定前后都应是战斗：" + ty.join(","));
      });
    }
  }
  assert.ok(seen > 10, "应该经常出现，实际 " + seen);
});

test("检定难度按幕：一幕简单/普通，二幕加困难，三幕没有简单、加极难，四幕困难/极难更多", () => {
  const { run, R } = fresh(["kolt", "helu"], "CKD");
  R.acceptTask(run, "main");
  const tally = (act) => {
    const n = { easy: 0, normal: 0, hard: 0, extreme: 0 };
    run.act = act;
    for (let i = 0; i < 400; i++) {
      run.taskNo = 1000 + i;
      run.task.nodes[run.task.index] = { type: "check", done: false };
      n[R.checkInfo(run).diff] += 1;
    }
    return n;
  };
  const a1 = tally(1), a2 = tally(2), a3 = tally(3), a4 = tally(4);
  assert.ok(a1.easy && a1.normal && !a1.hard && !a1.extreme, JSON.stringify(a1));
  assert.ok(a2.easy && a2.normal && a2.hard && !a2.extreme, JSON.stringify(a2));
  assert.ok(!a3.easy && a3.normal && a3.hard && a3.extreme, JSON.stringify(a3));
  assert.ok(!a4.easy && a4.hard + a4.extreme > a3.hard + a3.extreme, JSON.stringify([a3, a4]));
});

test("检定成功拿奎支（600–3000），会受伤的检定再 +500；没熟练不能尝试普通及以上", () => {
  const { c, run, R } = fresh(["kolt", "helu"], "CKR");
  R.acceptTask(run, "main");
  const D = c.S.ROGUE_CHECKS.diffs;
  assert.equal(D.easy.reward, 600);
  assert.equal(D.extreme.reward, 3000);
  forceCheck(run, { diff: "normal", prof: "历史", injure: false, reward: D.normal.reward });
  assert.throws(() => R.attemptCheck(run, "kolt"), /熟练/);   // 柯尔特没有历史
  forceCheck(run, { diff: "normal", prof: "追踪", injure: false, reward: D.normal.reward });
  let kz = c.S.state.kuizhi;
  const idx = run.task.index;
  R.attemptCheck(run, "kolt");                 // 追踪二级：普通默认通过
  assert.equal(c.S.state.kuizhi, kz + D.normal.reward);
  assert.equal(run.task.index, idx + 1);
  forceCheck(run, { diff: "easy", prof: "侦察", injure: true, reward: D.easy.reward + 500 });
  kz = c.S.state.kuizhi;
  R.attemptCheck(run, "helu");                 // 侦察一级：简单默认通过
  assert.equal(c.S.state.kuizhi, kz + 1100);
});

test("会受伤的检定失败：随机属性伤害按克制表结算、不致死，击破在下一场开战时结算", () => {
  const { c, run, R } = fresh(["kolt", "helu"], "CKH");
  R.acceptTask(run, "main");
  const h = run.party[0];
  let failed = 0, fleshOnly = 0;
  for (let i = 0; i < 60 && failed < 12; i++) {
    run.taskNo = 2000 + i;
    run.stage = "task";
    run.task.index = 0;
    run.task.nodes = [{ type: "check", done: false, check: { diff: "extreme", prof: "运动", injure: true, reward: 3500 } },
      { type: "battle", done: false }];
    h.hp = null; delete h.pendingBreaks;
    c.S.LEDGER.hours = 0;                       // 别把人熬到力竭
    const notes = R.attemptCheck(run, h.kit).join("\n");
    if (!/失败/.test(notes)) continue;
    failed += 1;
    const m = notes.match(/受伤：([^\s：]+?)属性 (\d+) 点，实际损失 (\d+) 点生命/);
    assert.ok(m, notes);
    const amount = Number(m[2]), lost = Number(m[3]);
    assert.ok(amount >= 5 && amount <= 8, "第一幕 5–8：" + amount);
    // 满血时第一层是肉体（科尔特没有装甲层时）：火 +50%，谐波 −25%
    if (h.hp.length === 1 && h.hp[0].type === "flesh") {
      fleshOnly += 1;
      assert.ok(["火", "酸", "电", "冰", "能量", "物理", "谐波"].includes(m[1]), m[1]);
      if (m[1] === "火") assert.ok(lost > amount, notes);
      else if (m[1] === "谐波") assert.ok(lost < amount, notes);
      else assert.equal(lost, amount, notes);
    }
    assert.equal(h.pendingBreaks.length, 1);
  }
  assert.ok(failed >= 5, "极难一级熟练只有 12.5%，应该大多失败");
  assert.ok(fleshOnly >= 5, "科尔特只有肉体层，克制要验到");
  // 不致死：只剩 1 点也不会被打死
  run.taskNo = 3000; run.stage = "task"; run.task.index = 0;
  run.task.nodes = [{ type: "check", done: false, check: { diff: "extreme", prof: "运动", injure: true, reward: 3500 } },
    { type: "battle", done: false }];
  run.act = 4;
  h.hp = c.Rogue.heroView(run, h).layers.map((l, i, a) => ({ type: l.type, current: i === a.length - 1 ? 2 : 0 }));
  delete h.pendingBreaks;
  let tries = 0;
  while (tries < 30) {
    const notes = R.attemptCheck(run, h.kit).join("\n");
    if (/失败/.test(notes)) break;
    tries += 1; run.taskNo += 1; run.task.index = 0;
  }
  assert.ok(run.party.includes(h), "不应该死");
  assert.ok(hpSum(h) >= 1, JSON.stringify(h.hp));
  // 开场击破：下一场战斗开始时扣架势；扣到 0 直接失衡
  h.pendingBreaks = [{ amount: 1, element: "physical" }];
  const spec = R.battleSpec(run);
  c.BattleSim.setup(spec);
  const u = c.S.state.units.find(x => x.kit === h.kit);
  c.startCombat();
  assert.equal(u.def, u.defMax - 1);
  R.finishBattle(run, "win");
  assert.ok(!h.pendingBreaks, "打完这场清掉");
});

test("开场击破把架势打空：开局失衡", () => {
  const { c, run, R } = fresh(["kolt", "helu"], "CKS");
  R.acceptTask(run, "main");
  run.task.nodes[run.task.index] = { type: "battle", done: false };
  const h = run.party[1];
  h.pendingBreaks = [{ amount: 99, element: "ice" }];
  c.BattleSim.setup(R.battleSpec(run));
  const u = c.S.state.units.find(x => x.kit === h.kit);
  c.startCombat();
  // 失衡：第一回合跳过（没有行动点和附赠动作），敌人拿到一次协助攻击
  assert.equal(u.ap, 0);
  assert.equal(u.bonus, 0);
  const text = c.S.state.logPages.map(p => p.lines.map(l => l.text || l).join("\n")).join("\n");
  assert.match(text, /检定时受的伤/);
  assert.match(text, /Helumica 晕眩/);
  assert.ok((c.S.state.assistQueue || []).some(j => j.targetId === u.id && j.vsPlayer));
});

test("检定可以不冒险绕过去：没有奖励，前进一站", () => {
  const { c, run, R } = fresh(["kolt", "helu"], "CKK");
  R.acceptTask(run, "main");
  forceCheck(run, { diff: "hard", injure: true, reward: 2500 });
  const kz = c.S.state.kuizhi, idx = run.task.index;
  R.skipCheck(run);
  assert.equal(c.S.state.kuizhi, kz);
  assert.equal(run.task.index, idx + 1);
});

test("角色的出身与熟练项照角色资料；开局带进单局", () => {
  const { c, run, R } = fresh(["ruby", "yuito"], "PF1");
  const P = c.S.HERO_PROFILES;
  // 每个可选角色都有资料，熟练项名字都在手册的表里，等级 1–3
  R.heroPool().forEach(card => {
    const p = P[card.kit];
    assert.ok(p, "缺资料：" + card.kit);
    Object.keys(p.profs).forEach(k => {
      assert.ok(c.S.PROF_LIST.includes(k), card.kit + " 的 " + k);
      assert.ok(p.profs[k] >= 1 && p.profs[k] <= 3);
    });
  });
  assert.deepEqual(plain(run.party[0].profs), { "数据操作": 2, "巧手": 1, "追踪": 1 });
  assert.equal(P.chuan.profs["求生"], 1, "川川资料里写的「生存」就是求生");
  assert.equal(P.kolt.profs["追踪"], 2, "士兵本职 + 兽人·狼自带");
  const v = R.heroView(run, run.party[1]);
  assert.equal(v.race, "猫类人-猫");
  assert.equal(v.job, "医生");
});

test("种族特长：人类失败可重掷，猫的侦察 / 躲藏检定优势", () => {
  const { run, R } = fresh(["ruby", "yuito"], "PF2");
  R.acceptTask(run, "main");
  forceCheck(run, { diff: "easy", prof: "躲藏", injure: false, reward: 600 });
  const ruby = R.checkOdds(run, "ruby"), yuito = R.checkOdds(run, "yuito");
  // 两个人都没有躲藏：简单 50%。瑞比重掷 → 75%；结人优势 → 75%
  assert.equal(ruby.level, 0);
  assert.equal(ruby.reroll, true);
  assert.equal(ruby.chance, 0.75);
  assert.equal(yuito.adv, true);
  assert.equal(yuito.chance, 0.75);
  forceCheck(run, { diff: "hard", prof: "数据操作", injure: false, reward: 2000 });
  assert.equal(R.checkOdds(run, "ruby").chance, 0.75, "二级 50%，重掷后 75%");
  assert.equal(R.checkOdds(run, "yuito").chance, 0, "结人没有数据操作，困难不能尝试");
  // 重掷写进记录
  let saw = false;
  for (let i = 0; i < 30 && !saw; i++) {
    run.stage = "task"; run.taskNo = 500 + i; run.task.index = 0;
    run.task.nodes = [{ type: "check", done: false, check: { diff: "easy", prof: "躲藏", injure: false, reward: 600 } }, { type: "battle", done: false }];
    saw = /迎难直上重掷/.test(R.attemptCheck(run, "ruby").join("\n"));
  }
  assert.ok(saw);
});

test("升级时的「一个自选熟练项」：新学一项或升一级，最高三级；旧存档的记录补成待选", () => {
  const { run, R } = fresh(["ruby", "yuito"], "PF3");
  const h = run.party[0];
  h.pending = [{ type: "prof", level: 3 }];
  const opts = R.choiceOptions(run, "ruby", 0);
  assert.deepEqual(plain(opts.slice(0, 3).map(o => o.value).sort()), ["巧手", "数据操作", "追踪"].sort(), "已有的排前面");
  assert.ok(opts.some(o => o.value === "历史"));
  R.choose(run, "ruby", 0, "数据操作");
  assert.equal(h.profs["数据操作"], 3);
  h.pending = [{ type: "prof", level: 7 }];
  assert.ok(!R.choiceOptions(run, "ruby", 0).some(o => o.value === "数据操作"), "三级封顶");
  R.choose(run, "ruby", 0, "历史");
  assert.equal(h.profs["历史"], 1);
  // 旧存档：没有 profs，notes 里记着欠的熟练项
  const g = run.party[1];
  delete g.profs;
  g.pending = [];
  g.notes = { proficiency: 2 };
  R.heroProfs(g);
  assert.equal(g.pending.filter(p => p.type === "prof").length, 2);
  assert.equal(g.profs["医疗"], 2);
});
