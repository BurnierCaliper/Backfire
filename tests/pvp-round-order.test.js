// PvP：所有玩家角色在这一轮开始时统一排行动顺序（#478，#467 的调整，作者 10/29：「所有玩家角色都需要排顺序。所有玩家统一在这一轮开始时选顺序」；docs/pvp.md 第 1.1 节）。
//   · 以前（#464 / PR #467）：在我方回合行动的玩家角色在我方回合开始时排顺序；在敌人回合行动的那一队到敌人回合开始时再单独排一次。
//   · 现在：这一轮开始时（我方回合开始前那一次），所有玩家角色——不管在我方回合还是敌人回合行动——一起排（每个玩家给自己的角色排，orderPick / orderConfirm）；
//     我方回合里只轮到在我方回合行动的；在敌人回合行动的那一队照排好的顺序在敌人回合里行动（仍然比非玩家单位先动），敌人回合开始时不再另外排。
//   · 这一轮从敌人回合开始（突袭开局）时，敌人回合开始时才排（只排在敌人回合行动的）。只有一个玩家阵营（普通 PvE）时一切照旧。
// 测会话和房主的校验（hotseat.js / hotseat-game.js / hotseat-validation.js，真的规则，没有画面）；房主的战斗流程在 tests/pvp-enemy-turn-ui.test.js（浏览器）。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const plain = v => JSON.parse(JSON.stringify(v));
const load = (c, files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file }));
const sorted = list => list.slice().sort();

/** 热座：柯尔特（主持人 p1）、赫鲁米卡（玩家 p2）、绯秋（没分配 → 主持人）、灯（玩家 p3）；赫鲁米卡、绯秋分到「乙」，乙在敌人回合行动（split = false：不分阵营）。全在 1 区 */
function room(opt = {}) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu", "hiaki", "tou"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], zoneMode: 3, seed: opt.seed || "PVP478-ORDER" });
  c.location = { search: "?hotseat=1" }; c.URLSearchParams = URLSearchParams;
  c.document = { getElementById() { return null; } };
  c.setInterval = () => 1;
  c.setTimeout = () => 1;
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, undo: [], disarm() {}, refresh() {} };
  load(c, ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "hotseat-game.js"]);
  const S = c.S.state, [kolt, helu, hiaki, tou] = ["kolt", "helu", "hiaki", "tou"].map(k => c.findKit(k, S.units));
  const thug = S.units.find(u => !u.isPlayer);
  S.units.forEach(u => { u.zone = 1; });
  thug.layers = [{ type: "flesh", current: 500, max: 500 }]; thug.def = thug.defMax = 30;
  const players = [{ id: "p1", name: "主持人", gm: true }, { id: "p2", name: "玩家 2" }, { id: "p3", name: "玩家 3" }];
  assert.deepEqual(plain(c.HotseatGame.configure({ mode: "trpg", players, assignments: { [kolt.id]: "p1", [helu.id]: "p2", [tou.id]: "p3" } })), { ok: true });
  const send = (id, command) => { c.HotseatGame.switchPlayer(id); return c.HotseatGame.submit(command); };
  if (opt.split !== false) {
    assert.equal(send("p1", { type: "battle.playerFaction", faction: "乙", phase: "enemy", unit: helu.id }).ok, true);
    assert.equal(send("p1", { type: "battle.playerFaction", faction: "乙", unit: hiaki.id }).ok, true);
  }
  assert.equal(send("p1", { type: "startCombat" }).ok, true);
  if (!opt.ambush) c.HotseatGame.beginRound();   // ambush：突袭开局，这一轮从敌人回合开始（测试自己推进到敌人回合）
  [kolt, helu, hiaki, tou].forEach(h => { h.level = Math.max(Number(h.level) || 1, 5); });
  const view = () => plain(c.HotseatGame.getView());
  const order = () => view().order.map(r => r && r.actor);
  /** 每个人照 list 的先后各自给自己的角色选格子，再各自确定 */
  const pickAll = list => {
    const owner = id => view().units.find(u => u.id === id).owner;
    list.forEach((u, i) => assert.equal(send(owner(u.id), { type: "orderPick", actor: u.id, index: i }).ok, true, "给 " + u.name + " 选第 " + (i + 1) + " 格"));
    [...new Set(list.map(u => owner(u.id)))].forEach(p => assert.equal(send(p, { type: "orderConfirm" }).ok, true, p + " 确定"));
  };
  /** 结束当前单位的行动（由它的操控者点「结束单位行动」） */
  const endCurrent = () => {
    const cur = view().currentUnitId, who = (view().order.find(r => r && r.actor === cur) || {}).owner;
    const r = send(who, { type: "endTurn" });
    assert.equal(r.ok, true, r.error);
    return r.result;
  };
  return { c, S, kolt, helu, hiaki, tou, thug, send, view, order, pickAll, endCurrent };
}

test("这一轮开始时所有玩家角色一起排行动顺序：在敌人回合行动的乙也排，每个玩家给自己的角色选格子（orderPick / orderConfirm）；我方回合里只轮到在我方回合行动的", () => {
  const f = room();
  const { c, kolt, helu, hiaki, tou, thug, send, view, order, pickAll, endCurrent } = f;
  assert.equal(view().segment, "player");
  assert.equal(view().phase, "picking", "这一轮开始：先选顺序");
  assert.deepEqual(sorted(view().units.map(u => u.id)), sorted([kolt.id, helu.id, hiaki.id, tou.id]), "所有玩家角色都排（以前只排在我方回合行动的）");
  assert.equal(view().order.length, 4, "四个格子");
  // 玩家 2 给在敌人回合行动的赫鲁米卡选格子（以前这时候它不在顺序里，选不了）；别人替不了
  assert.equal(send("p3", { type: "orderPick", actor: helu.id, index: 0 }).ok, false, "玩家 3 不能替玩家 2 选");
  assert.equal(send("p2", { type: "confirm" }).ok, false);
  assert.match(send("p2", { type: "orderConfirm" }).error || "", /全部单位/, "玩家 2 的赫鲁米卡还没选格子：不能确定");
  pickAll([hiaki, kolt, helu, tou]);
  assert.equal(view().phase, "acting", "大家都确定了：开始");
  assert.deepEqual(order(), [hiaki.id, kolt.id, helu.id, tou.id]);
  // 我方回合：跳过在敌人回合行动的绯秋，轮到柯尔特
  assert.equal(view().currentUnitId, kolt.id, "绯秋在敌人回合行动：我方回合里轮不到它");
  assert.match(send("p1", { type: "move", actor: hiaki.id, dest: 2 }).error || "", /敌人回合行动/, "我方回合里动不了绯秋");
  assert.match(send("p2", { type: "skill", actor: helu.id, skill: "helu_aa", target: thug.id, picks: {} }).error || "", /敌人回合行动/, "也动不了赫鲁米卡");
  assert.equal(endCurrent().roundDone, false);
  assert.equal(view().currentUnitId, tou.id, "跳过赫鲁米卡，轮到灯");
  assert.equal(endCurrent().roundDone, true, "在我方回合行动的都结束了");
  assert.equal(c.HotseatGame.needsEnemy(), true, "接着进敌人回合");
  assert.equal(c.HotseatGame.segmentDone(), false);
  const done = view().order.filter(r => r.done).map(r => r.actor);
  assert.deepEqual(sorted(done), sorted([kolt.id, tou.id]), "乙的两个人还没行动");
});

test("敌人回合开始时不再另外排：在敌人回合行动的那一队照这一轮开始时排好的顺序行动（分给玩家的由他操控），全部结束才轮到敌人的 AI；下一轮开始再一起排", () => {
  const f = room();
  const { c, S, kolt, helu, hiaki, tou, thug, send, view, order, pickAll, endCurrent } = f;
  pickAll([hiaki, kolt, helu, tou]);
  endCurrent(); endCurrent();
  c.HotseatGame.system({ type: "battle.endPlayerTurn" });
  assert.equal(S.combatPhase, "enemy");
  c.HotseatGame.beginRound("enemy");
  assert.equal(view().segment, "enemy");
  assert.equal(view().phase, "acting", "不再选顺序（以前敌人回合开始时这一队要再排一次）");
  assert.deepEqual(order(), [hiaki.id, kolt.id, helu.id, tou.id], "还是这一轮开始时排的那一份");
  assert.match(send("p2", { type: "orderPick", actor: helu.id, index: 0 }).error || "", /不是选择顺序阶段/, "敌人回合里没有选顺序这一步");
  assert.equal(c.HotseatGame.segmentDone(), false, "这一段没结束：敌人的 AI 先不动");
  assert.equal(c.HotseatGame.needsEnemy(), false);
  // 照格子：先是绯秋（主持人操控），再是赫鲁米卡（玩家 2 操控）
  assert.equal(view().currentUnitId, hiaki.id);
  assert.match(send("p2", { type: "move", actor: hiaki.id, dest: 2 }).error || "", /不是你的角色/, "玩家 2 动不了主持人的绯秋");
  assert.match(send("p1", { type: "move", actor: kolt.id, dest: 2 }).error || "", /我方回合行动/, "在我方回合行动的柯尔特在敌人回合里动不了");
  assert.equal(send("p1", { type: "move", actor: hiaki.id, dest: 2 }).ok, true, "主持人操控没分配的绯秋");
  assert.equal(endCurrent().roundDone, false);
  assert.equal(view().currentUnitId, helu.id, "轮到赫鲁米卡");
  helu.zone = 2;
  const hit = { type: "skill", actor: helu.id, skill: "helu_aa", target: kolt.id, picks: {} };
  assert.match(send("p1", hit).error || "", /不是你的角色/, "主持人不能替玩家 2 行动");
  const ap = helu.ap, ok = send("p2", hit);
  assert.equal(ok.ok, true, ok.error);
  assert.ok(helu.ap < ap, "玩家 2 自己出手了");
  assert.equal(endCurrent().roundDone, true, "这一段的人全部结束了");
  assert.equal(c.HotseatGame.segmentDone(), true, "该跑敌人的 AI 了");
  assert.equal(c.HotseatGame.needsEnemy(), false, "不会被当成我方回合结束");
  // 同一回合再叫一次：不重开
  c.HotseatGame.beginRound("enemy");
  assert.equal(view().phase, "enemy");
  // 下一轮：又是所有人一起排，格子清空
  c.HotseatGame.system({ type: "battle.endEnemyTurn" });
  c.HotseatGame.beginRound();
  assert.equal(S.turnNo, 2);
  assert.equal(view().segment, "player");
  assert.equal(view().phase, "picking");
  assert.deepEqual(sorted(view().units.map(u => u.id)), sorted([kolt.id, helu.id, hiaki.id, tou.id]));
  assert.ok(view().order.every(r => !r || !r.actor), "格子清空");
  assert.ok(thug && tou);
});

test("敌人回合那一段里照样能调整顺序（延后 / 换位）：排在中间、我方回合里已经行动完的人不挡（只看这一段的人固定了没有）", () => {
  const f = room();
  const { c, kolt, helu, hiaki, tou, send, view, order, pickAll, endCurrent } = f;
  pickAll([hiaki, kolt, tou, helu]);
  endCurrent(); endCurrent();
  c.HotseatGame.system({ type: "battle.endPlayerTurn" });
  c.HotseatGame.beginRound("enemy");
  assert.deepEqual(order(), [hiaki.id, kolt.id, tou.id, helu.id]);
  assert.equal(view().currentUnitId, hiaki.id);
  // 主持人把绯秋和赫鲁米卡换位（跑团主持人可以直接换）：中间的柯尔特、灯已经行动完，不挡（以前同一段里才有固定的格子）
  const swap = send("p1", { type: "orderMove", actor: hiaki.id, index: 3 });
  assert.equal(swap.ok, true, swap.error);
  assert.deepEqual(order(), [helu.id, kolt.id, tou.id, hiaki.id]);
  assert.equal(view().currentUnitId, helu.id, "换完轮到赫鲁米卡");
  // 玩家 2 把自己的赫鲁米卡延后到最后
  const later = send("p2", { type: "orderMove", actor: helu.id, index: order().length });
  assert.equal(later.ok, true, later.error);
  assert.equal(view().currentUnitId, hiaki.id, "延后以后先轮到绯秋");
  assert.equal(endCurrent().roundDone, false);
  assert.equal(view().currentUnitId, helu.id);
  assert.equal(endCurrent().roundDone, true);
});

test("这一轮的行动顺序：主持人「按当前格子开始」也把乙的人一起排上；在敌人回合行动的人在我方回合里花了点数（协助格挡……）不锁它的格子，到它那一段照常", () => {
  const f = room();
  const { c, S, kolt, helu, hiaki, tou, send, view, order } = f;
  assert.equal(send("p1", { type: "orderPick", actor: kolt.id, index: 0 }).ok, true);
  assert.equal(send("p1", { type: "orderStart" }).ok, true, "主持人按当前格子开始");
  assert.equal(order()[0], kolt.id);
  assert.deepEqual(sorted(order()), sorted([kolt.id, helu.id, hiaki.id, tou.id]), "没选的人（乙的也算）补进空格子");
  assert.equal(view().currentUnitId, kolt.id);
  // 会话直接记花费（房主执行指令时 app.js · onActionSpend 报上来的）：赫鲁米卡在我方回合里协助格挡花了附赠——不锁（轮到它那一段再说）；柯尔特花了照旧锁
  const players = [{ id: "p1", name: "主持人" }, { id: "p2", name: "玩家 2" }];
  const session = c.Hotseat.create({ operators: players, gmId: "p1", assignments: { [helu.id]: "p2" }, getUnits: () => S.units,
    heroKits: ["kolt", "helu", "hiaki", "tou"], inRound: (u, seg) => c.unitTurnPhase(u) === (seg === "enemy" ? "enemy" : "player") });
  session.beginRound(1);
  session.forceStart("p1");
  session.markSpent([{ unitId: helu.id, bonus: 1 }, { unitId: kolt.id, ap: 1 }]);
  const slot = id => session.snapshot().slots.find(r => r && r.unitId === id);
  assert.equal(slot(kolt.id).spent, true, "柯尔特花了点数：锁住");
  assert.equal(slot(helu.id).spent, false, "赫鲁米卡在敌人回合行动：我方回合里花的不锁");
  ["kolt", "tou"].forEach(() => session.finishUnit("p1"));
  assert.equal(session.snapshot().phase, "enemy");
  session.beginRound(1, "enemy");
  assert.equal(session.snapshot().phase, "acting");
  assert.equal(slot(helu.id).spent, false, "到它那一段：格子没锁");
  session.markSpent([{ unitId: helu.id, bonus: 1 }]);
  assert.equal(slot(helu.id).spent, true, "它自己那一段里花了：锁住");
  assert.ok(hiaki && tou);
});

test("突袭开局（这一轮从敌人回合开始）：敌人回合开始时才排，只排在敌人回合行动的；下一轮开始照常所有人一起排", () => {
  const f = room({ ambush: true });
  const { c, S, kolt, helu, hiaki, tou, send, view, order, endCurrent } = f;
  c.HotseatGame.system({ type: "battle.endPlayerTurn" });   // 突袭：开战直接进敌人回合（game.js · endTurn(true)），我方回合的行动顺序没开始
  assert.equal(S.combatPhase, "enemy");
  c.HotseatGame.beginRound("enemy");
  assert.equal(view().segment, "enemy");
  assert.equal(view().phase, "picking", "这一轮的行动顺序还没排过：这时候排");
  assert.deepEqual(sorted(view().units.map(u => u.id)), sorted([helu.id, hiaki.id]), "只排在敌人回合行动的（我方回合已经过去了）");
  assert.equal(send("p1", { type: "orderStart" }).ok, true);
  for (let i = 0; i < 4 && view().phase === "acting"; i++) endCurrent();
  assert.equal(c.HotseatGame.segmentDone(), true);
  c.HotseatGame.system({ type: "battle.endEnemyTurn" });
  c.HotseatGame.beginRound();
  assert.equal(view().phase, "picking");
  assert.deepEqual(sorted(view().units.map(u => u.id)), sorted([kolt.id, helu.id, hiaki.id, tou.id]), "第二轮开始：所有人一起排");
  assert.ok(order().length === 4);
});

test("房主刷新恢复（会话的检查点）：这一轮排好的顺序、排到哪一段都接着——我方回合轮完了恢复，敌人回合开始照排好的顺序动，不重新排", () => {
  const f = room();
  const { c, S, kolt, helu, hiaki, tou, view, order, pickAll, endCurrent } = f;
  pickAll([helu, kolt, hiaki, tou]);
  endCurrent(); endCurrent();
  assert.equal(view().phase, "enemy");
  const saved = plain(c.HotseatGame.checkpoint());
  const session = c.Hotseat.create({ operators: saved.config.players, gmId: "p1", getUnits: () => S.units,
    inRound: (u, seg) => c.unitTurnPhase(u) === (seg === "enemy" ? "enemy" : "player") });
  session.restore(saved.session);
  assert.deepEqual(plain(session.snapshot().slots.map(r => r && r.unitId)), [helu.id, kolt.id, hiaki.id, tou.id], "格子都在");
  c.HotseatGame.system({ type: "battle.endPlayerTurn" });
  session.beginRound(S.turnNo, "enemy");
  const snap = plain(session.snapshot());
  assert.equal(snap.segment, "enemy");
  assert.equal(snap.phase, "acting", "恢复以后进敌人回合：照排好的顺序接着动，不重新排");
  assert.equal(snap.currentUnitId, helu.id, "排在最前面的赫鲁米卡先动");
  // 敌人回合那一段里存的检查点：恢复以后还在这一段，同一回合不重开
  c.HotseatGame.beginRound("enemy");
  endCurrent();
  assert.equal(view().currentUnitId, hiaki.id);
  const mid = plain(c.HotseatGame.checkpoint());
  const again = c.Hotseat.create({ operators: mid.config.players, gmId: "p1", getUnits: () => S.units,
    inRound: (u, seg) => c.unitTurnPhase(u) === (seg === "enemy" ? "enemy" : "player") });
  again.restore(mid.session);
  again.beginRound(S.turnNo, "enemy");
  const snap2 = plain(again.snapshot());
  assert.equal(snap2.phase, "acting");
  assert.equal(snap2.currentUnitId, hiaki.id, "接着轮到绯秋（赫鲁米卡已经结束）");
  assert.ok(order().includes(kolt.id) && tou);
});

test("只有一个玩家阵营（普通 PvE）时一切照旧：这一轮开始时排的就是全员、我方回合轮完接着进敌人回合，敌人回合没有玩家先动的那一段；分成两个阵营时乙的人才在敌人回合那一段", () => {
  const one = room({ split: false });
  assert.equal(one.view().segment, "player");
  assert.deepEqual(sorted(one.view().units.map(u => u.id)), sorted([one.kolt.id, one.helu.id, one.hiaki.id, one.tou.id]), "全员排进我方回合");
  assert.equal(one.send("p1", { type: "orderStart" }).ok, true);
  const seen = [];
  for (let i = 0; i < 6 && one.view().phase === "acting"; i++) { seen.push(one.view().currentUnitId); one.endCurrent(); }
  assert.deepEqual(seen, one.order(), "我方回合按格子一个一个轮完（四个人）");
  assert.equal(one.c.HotseatGame.needsEnemy(), true, "我方回合结束：照旧接着跑敌人回合");
  assert.equal(one.c.HotseatGame.segmentDone(), false, "没有敌人回合玩家先动的那一段");
  one.c.HotseatGame.system({ type: "battle.endPlayerTurn" });
  assert.match(one.send("p2", { type: "move", actor: one.helu.id, dest: 2 }).error || "", /现在不能操作玩家技能/, "敌人回合里谁都不能操作玩家角色（和以前一样）");
  // 对照：分成两个阵营，同一个局面我方回合只轮到我方的两个人，乙的两个人留到敌人回合那一段
  const two = room();
  assert.equal(two.send("p1", { type: "orderStart" }).ok, true);
  const mine = [];
  for (let i = 0; i < 6 && two.view().phase === "acting"; i++) { mine.push(two.view().currentUnitId); two.endCurrent(); }
  assert.deepEqual(sorted(mine), sorted([two.kolt.id, two.tou.id]));
  two.c.HotseatGame.system({ type: "battle.endPlayerTurn" });
  two.c.HotseatGame.beginRound("enemy");
  assert.equal(two.view().phase, "acting");
  assert.ok([two.helu.id, two.hiaki.id].includes(two.view().currentUnitId), "乙的人在敌人回合那一段动");
});
