// PvP 第二步（#464，docs/pvp.md 第 1.1 节）：敌人回合由玩家操控。放到敌人回合的玩家角色——
//   · 已经分配给玩家的：敌人回合开始时由那名玩家在自己的画面上照常行动（技能、选目标、协助格挡的询问……和我方回合一样）；
//   · 没分配的：由主持人操控；
//   · 这些玩家角色全部行动完（或结束回合），才轮到敌人的 AI。
// 做法：热座会话的行动顺序在这一轮开始时给所有玩家角色一起排（#478 起；#464 时敌人回合开始时给这一队单独再排一次），敌人回合开始时
// （hotseat.js · beginRound(回合, "enemy")）照排好的顺序轮到在敌人回合行动的人；归谁操控对场上所有能操作的单位都记着（询问、掷骰发给真正的操控者）。
// 这一份测会话和房主的校验（hotseat.js / hotseat-game.js / hotseat-validation.js，真的规则，没有画面）；
// 房主的战斗流程（game.js：敌人回合开始停下来、这一段都结束了才跑敌人的 AI）在 tests/pvp-enemy-turn-ui.test.js（浏览器）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const plain = v => JSON.parse(JSON.stringify(v));
const load = (c, files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file }));

/** 热座：柯尔特（主持人 p1）、赫鲁米卡（玩家 p2）、绯秋（没分配 → 主持人）、灯（玩家 p3）；赫鲁米卡、绯秋分到「乙」，乙在敌人回合行动。全在 1 区 */
function room(opt = {}) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu", "hiaki", "tou"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], zoneMode: 3, seed: opt.seed || "PVP464-ENEMYTURN" });
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
  if (!opt.ambush) c.HotseatGame.beginRound();   // ambush：突袭开局，我方回合的行动顺序不开始（测试自己推进到敌人回合）
  [kolt, helu, hiaki, tou].forEach(h => { h.level = Math.max(Number(h.level) || 1, 5); });
  const view = () => plain(c.HotseatGame.getView());
  const owner = u => (view().units.find(r => r.id === u.id) || {}).owner;
  return { c, S, kolt, helu, hiaki, tou, thug, send, view, owner };
}
/** 我方回合所有人结束行动，推进到敌人回合（房主的流程：battle.endPlayerTurn → 敌人回合开始时轮到在敌人回合行动的那一段）。还在选顺序就由主持人按当前格子开始 */
function toEnemySegment(f) {
  const { c, send, view } = f;
  for (let i = 0; i < 10 && view().phase !== "enemy"; i++) {
    if (view().phase === "picking") assert.equal(send("p1", { type: "orderStart" }).ok, true);
    const cur = view().currentUnitId, who = (view().order.find(r => r && r.actor === cur) || {}).owner;
    if (cur) assert.equal(send(who, { type: "endTurn" }).ok, true);
  }
  assert.equal(c.HotseatGame.needsEnemy(), true, "我方回合的行动顺序都结束了");
  c.HotseatGame.system({ type: "battle.endPlayerTurn" });
  assert.equal(f.S.combatPhase, "enemy");
  c.HotseatGame.beginRound("enemy");
}

test("敌人回合：在敌人回合行动的阵营照这一轮开始时排好的顺序行动（#478 起不再另外排）——分给玩家的由那名玩家自己行动，没分配的由主持人操控，别人不能动；全部结束以后才轮到敌人的 AI", () => {
  const f = room();
  const { c, S, kolt, helu, hiaki, tou, thug, send, view } = f;
  // 这一轮开始：乙的人也排进行动顺序（#478；#464 时这时候不排），各自的操控者给自己的角色选格子
  assert.deepEqual(view().units.map(u => u.id).sort(), [kolt.id, helu.id, hiaki.id, tou.id].sort(), "这一轮开始时所有玩家角色一起排");
  assert.equal(send("p2", { type: "orderPick", actor: hiaki.id, index: 0 }).ok, false, "玩家 2 不能替主持人的绯秋选格子");
  assert.equal(send("p2", { type: "orderPick", actor: helu.id, index: 0 }).ok, true);
  assert.equal(send("p1", { type: "orderPick", actor: hiaki.id, index: 1 }).ok, true);
  assert.equal(send("p1", { type: "orderPick", actor: kolt.id, index: 2 }).ok, true);
  assert.equal(send("p3", { type: "orderPick", actor: tou.id, index: 3 }).ok, true);
  ["p1", "p2", "p3"].forEach(p => assert.equal(send(p, { type: "orderConfirm" }).ok, true));
  assert.equal(view().phase, "acting");
  assert.equal(view().currentUnitId, kolt.id, "我方回合跳过排在前面的乙，轮到柯尔特");
  // 我方回合：谁都动不了乙的人
  const early = send("p2", { type: "skill", actor: helu.id, skill: "helu_aa", target: thug.id, picks: {} });
  assert.equal(early.ok, false, "我方回合赫鲁米卡动不了");
  toEnemySegment(f);
  // 敌人回合先动的那一段：不再选顺序，照这一轮开始时的格子轮到乙的人
  assert.equal(view().segment, "enemy");
  assert.equal(view().phase, "acting", "敌人回合开始时不再另外排");
  assert.equal(c.HotseatGame.segmentDone(), false);
  assert.equal(c.HotseatGame.needsEnemy(), false, "这一段没结束：不跑敌人的 AI");
  assert.equal(view().currentUnitId, helu.id, "轮到赫鲁米卡");
  // 赫鲁米卡归玩家 2：主持人、玩家 3 都不能动；玩家 2 照常行动（技能、选目标：远程普攻打距离 1 的柯尔特）
  helu.zone = 2;
  const hit = { type: "skill", actor: helu.id, skill: "helu_aa", target: kolt.id, picks: {} };
  assert.match(send("p1", hit).error || "", /不是你的角色/, "主持人不能替玩家 2 的赫鲁米卡行动");
  assert.match(send("p3", hit).error || "", /不是你的角色/);
  const ap = helu.ap;
  const ok = send("p2", hit);
  assert.equal(ok.ok, true, ok.error);
  assert.ok(helu.ap < ap, "真的出手了（花了行动点）");
  // 我方的柯尔特在这一段动不了；还没轮到的绯秋也动不了
  assert.equal(send("p1", { type: "move", actor: kolt.id, dest: 2 }).ok, false, "我方的人在敌人回合动不了");
  assert.match(send("p1", { type: "move", actor: hiaki.id, dest: 2 }).error || "", /还没轮到/);
  // 玩家 2 结束行动 → 轮到主持人的绯秋（没分配：主持人操控）
  assert.match(send("p1", { type: "endTurn" }).error || "", /不是你的角色/, "主持人不能替玩家 2 结束行动");
  const end = send("p2", { type: "endTurn" });
  assert.equal(end.ok, true); assert.equal(end.result.roundDone, false);
  assert.equal(view().currentUnitId, hiaki.id);
  assert.match(send("p2", { type: "move", actor: hiaki.id, dest: 2 }).error || "", /不是你的角色/, "别人不能动主持人的绯秋");
  assert.equal(send("p1", { type: "move", actor: hiaki.id, dest: 2 }).ok, true, "主持人能动没分配的");
  assert.equal(hiaki.zone, 2);
  const last = send("p1", { type: "endTurn" });
  assert.equal(last.ok, true);
  assert.equal(last.result.roundDone, true, "这一段的人全部结束了");
  assert.equal(c.HotseatGame.segmentDone(), true, "该跑敌人的 AI 了");
  assert.equal(c.HotseatGame.needsEnemy(), false, "不会被当成我方回合结束、又跳过一个我方回合");
  // 敌人回合结束 → 下一回合：又是这一轮开始，所有人一起排
  c.HotseatGame.system({ type: "battle.endEnemyTurn" });
  c.HotseatGame.beginRound();
  assert.equal(view().segment, "player");
  assert.equal(view().phase, "picking");
  assert.deepEqual(view().units.map(u => u.id).sort(), [kolt.id, helu.id, hiaki.id, tou.id].sort());
  assert.equal(S.turnNo, 2);
});

test("在敌人回合行动的阵营：协助格挡的询问（协助攻击是同一套询问）发给操控者——分给玩家的问那名玩家，没分配的问主持人，别人不能代答；我方回合、敌人回合那一段都一样", () => {
  const f = room();
  const { c, kolt, helu, hiaki, tou, send } = f;
  // 我方回合里柯尔特打赫鲁米卡：乙的绯秋（主持人的）、赫鲁米卡自己都在敌人回合行动，照样能被问——问的是操控者
  let result = null;
  c.HotseatGame.requestAsk("block", "柯尔特 攻击 Helumica · 协助格挡", [{ helper: hiaki.id, label: "绯秋" }], () => [hiaki], { targetId: helu.id }).then(r => { result = r; });
  const askFor = id => plain(c.HotseatGame.getViewFor(id).ask);
  assert.equal(askFor("p1").eligible, true, "绯秋没分配：问主持人");
  assert.equal(askFor("p2").eligible, false);
  const ask = askFor("p1");
  assert.equal(send("p2", { type: "answer", askId: ask.id, helper: hiaki.id }).ok, false, "玩家 2 不能替主持人答");
  assert.equal(send("p1", { type: "answer", askId: ask.id, helper: hiaki.id }).ok, true);
  return Promise.resolve().then(() => {
    assert.equal(result && result.unitId, hiaki.id, "主持人替绯秋接了这次协助格挡");
    // 敌人回合那一段里，赫鲁米卡（玩家 2）也能被问
    toEnemySegment(f);
    let r2 = null;
    c.HotseatGame.requestAsk("block", "狂徒 攻击 绯秋 · 协助格挡", [{ helper: helu.id, label: "Helumica" }], () => [helu], { targetId: hiaki.id }).then(r => { r2 = r; });
    const a2 = plain(c.HotseatGame.getViewFor("p2").ask);
    assert.equal(a2.eligible, true, "赫鲁米卡归玩家 2：问玩家 2");
    assert.equal(plain(c.HotseatGame.getViewFor("p1").ask).eligible, false, "主持人不是它的操控者");
    assert.equal(send("p1", { type: "answer", askId: a2.id, helper: helu.id }).ok, false);
    assert.equal(send("p2", { type: "answer", askId: a2.id, helper: helu.id }).ok, true);
    return Promise.resolve().then(() => {
      assert.equal(r2 && r2.unitId, helu.id);
      assert.ok(kolt && tou);
    });
  });
});

test("敌人回合那一段：分到的玩家掷骰、申请检定照样是自己的角色；会话的检查点记着排到哪一段（房主恢复后接着这一段）", () => {
  const f = room();
  const { c, kolt, helu, hiaki, tou, send, view } = f;
  toEnemySegment(f);
  assert.equal(view().phase, "acting");
  // 掷骰：归玩家 2（以前在敌人回合行动的人不在会话里，掷骰归主持人）
  const roll = send("p2", { type: "skillRoll", unitId: helu.id, prof: "侦察" });
  assert.equal(roll.ok, true, roll.error);
  assert.equal(send("p3", { type: "skillRoll", unitId: helu.id, prof: "侦察" }).ok, false, "玩家 3 不能替它掷");
  // 检查点：记着这一段和这一轮排好的格子
  const saved = plain(c.HotseatGame.checkpoint());
  assert.equal(saved.session.segment, "enemy");
  const session = c.Hotseat.create({ operators: saved.config.players, gmId: "p1", getUnits: () => f.S.units,
    inRound: (u, seg) => c.unitTurnPhase(u) === (seg === "enemy" ? "enemy" : "player") });
  session.restore(saved.session);
  const snap = plain(session.snapshot());
  assert.equal(snap.segment, "enemy", "恢复以后还在敌人回合那一段");
  assert.equal(snap.phase, "acting");
  assert.deepEqual(snap.roster.map(r => r.unitId).sort(), [kolt.id, helu.id, hiaki.id, tou.id].sort(), "这一轮的行动顺序（#478：所有人一起排的）");
  assert.equal(snap.slots.find(r => r && r.unitId === helu.id) ? true : false, true, "排好的格子还在");
  assert.equal(snap.currentUnitId, view().currentUnitId, "轮到的人也一样");
  // 同一回合再叫一次「开始敌人回合那一段」：不会重开（排好的格子不丢）
  c.HotseatGame.beginRound("enemy");
  assert.equal(view().phase, "acting");
  assert.ok(view().order.some(r => r && r.actor === helu.id), "没有重开");
});

test("敌人回合那一段（自查）：这一段的人都没了（主持人把乙改回我方回合行动）——这一段直接算结束、接着跑敌人的 AI；突袭开局在敌人回合开始时选顺序的时候也一样，不停在「选择行动顺序」", () => {
  const f = room();
  const { c, send, view } = f;
  toEnemySegment(f);
  assert.equal(view().phase, "acting");
  assert.equal(send("p1", { type: "battle.playerFaction", faction: "乙", phase: "player" }).ok, true);
  assert.equal(view().currentUnitId, null, "这一段没有能动的人了");
  assert.equal(view().phase, "enemy");
  assert.equal(c.HotseatGame.segmentDone(), true, "该跑敌人的 AI 了");
  assert.equal(c.HotseatGame.needsEnemy(), false, "不会被当成我方回合结束");
  // 突袭开局：这一轮从敌人回合开始，敌人回合开始时才选顺序；选的时候乙被改回我方回合行动
  const g = room({ ambush: true });
  g.c.HotseatGame.system({ type: "battle.endPlayerTurn" });
  g.c.HotseatGame.beginRound("enemy");
  assert.equal(g.view().phase, "picking");
  assert.equal(g.send("p1", { type: "battle.playerFaction", faction: "乙", phase: "player" }).ok, true);
  assert.equal(g.view().units.length, 0, "这一段没有要排的人了");
  assert.equal(g.view().phase, "enemy", "不停在选顺序（以前要主持人点「按当前格子开始」）");
  assert.equal(g.c.HotseatGame.segmentDone(), true);
  assert.equal(g.c.HotseatGame.needsEnemy(), false);
});

test("突袭开局（自查）：开战就先进敌人回合时，敌人回合那一段里花了点数的单位照样锁住格子（不能再挪、不能转交）", () => {
  const f = room({ ambush: true });
  const { c, S, helu, hiaki, send, view } = f;
  c.HotseatGame.system({ type: "battle.endPlayerTurn" });   // 突袭：开战直接进敌人回合（game.js · endTurn(true)），我方回合的行动顺序没开始
  assert.equal(S.combatPhase, "enemy");
  c.HotseatGame.beginRound("enemy");
  assert.equal(view().segment, "enemy");
  assert.equal(send("p1", { type: "orderStart" }).ok, true);
  const cur = view().currentUnitId, who = (view().order.find(r => r && r.actor === cur) || {}).owner;
  assert.ok([helu.id, hiaki.id].includes(cur), "轮到乙的人");
  const moved = send(who, { type: "move", actor: cur, dest: 2 });
  assert.equal(moved.ok, true, moved.error);
  assert.equal(view().order.find(r => r && r.actor === cur).locked, true, "花了附赠：格子锁住（以前一直攒在开战时的那一份里，记不上）");
  const gate = c.HotseatGame.transferState();
  assert.equal(gate.ok, false, "正在行动的单位花了点数：不能转交");
});

test("发给玩家的包带上场上所有单位归谁（operable，自查）：突袭开局那一轮 units 只有乙的人，在我方回合行动的角色照样认得出是谁的（掷骰、角色资料、接管……都看这一份）", () => {
  const f = room({ ambush: true });
  const { c, S, kolt, helu, hiaki, tou, view } = f;
  c.HotseatGame.system({ type: "battle.endPlayerTurn" });   // 突袭：这一轮从敌人回合开始，敌人回合开始时只排在敌人回合行动的（#478）
  c.HotseatGame.beginRound("enemy");
  const v = view();
  assert.deepEqual(v.units.map(u => u.id).sort(), [helu.id, hiaki.id].sort(), "行动顺序只排乙的人");
  const owners = Object.fromEntries((v.operable || []).map(r => [r.id, r.owner]));
  assert.deepEqual([owners[kolt.id], owners[helu.id], owners[hiaki.id], owners[tou.id]], ["p1", "p2", "p1", "p3"], "四个人都在，归谁照分配");
  // 白名单：发给玩家的包里也有，只有 id / 名字 / 操控者
  load(c, ["online-view.js"]);
  S.units.filter(u => u.isPlayer).forEach((u, i) => { u.shp = 812339 + i; });
  const packet = c.OnlineView.projectPacket({ type: "result", protocol: 1, build: "x", seq: 1, screen: "battle", state: S, view: v }, { recipientId: "p3", gmId: "p1" });
  assert.deepEqual(plain(packet.view.operable).find(r => r.id === tou.id), { id: tou.id, name: tou.name, owner: "p3" });
  assert.doesNotMatch(JSON.stringify(packet.view), /81233|shp/i, "不带坚毅");
  // 只有一个玩家阵营时 operable 和 units 一样（玩家画面和以前一样）
  const one = room({ split: false }).view();
  assert.deepEqual(one.operable, one.units);
  // 平常（这一轮从我方回合开始）：units 就是这一轮所有人一起排的（#478），和 operable 是同样的人
  const two = room().view();
  assert.deepEqual(two.units.map(u => u.id).sort(), two.operable.map(u => u.id).sort());
});

test("只有一个玩家阵营（默认全在「我方」）时一切照旧：行动顺序、回合推进、询问和以前一样；敌人回合没有玩家先动的那一段", () => {
  const f = room({ split: false });
  const { c, kolt, helu, hiaki, tou, view, send } = f;
  assert.equal(view().segment, "player");
  assert.deepEqual(view().units.map(u => u.id).sort(), [kolt.id, helu.id, hiaki.id, tou.id].sort(), "全员排进我方回合");
  for (let i = 0; i < 10 && view().phase !== "enemy"; i++) {
    if (view().phase === "picking") assert.equal(send("p1", { type: "orderStart" }).ok, true);
    const cur = view().currentUnitId, who = (view().order.find(r => r && r.actor === cur) || {}).owner;
    if (cur) assert.equal(send(who, { type: "endTurn" }).ok, true);
  }
  assert.equal(c.HotseatGame.needsEnemy(), true, "我方回合结束：照旧接着跑敌人回合");
  assert.equal(c.HotseatGame.segmentDone(), false, "没有敌人回合玩家先动的那一段");
  c.HotseatGame.system({ type: "battle.endPlayerTurn" });
  // 敌人回合里谁都不能操作玩家角色（和以前一样）
  assert.match(send("p2", { type: "move", actor: helu.id, dest: 2 }).error || "", /现在不能操作玩家技能/);
});
