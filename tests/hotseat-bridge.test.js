"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const plain = value => JSON.parse(JSON.stringify(value));

// Rules, dispatcher, transport, authority and the browser bridge are real. Only
// DOM/presentation calls are absent, so tests exercise the actual dispatch path.
function bridge(party = ["kolt", "helu"], mode = "trpg") {
  const c = H.load();
  c.BattleSim.setup({ party, enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "D2-BRIDGE:" + party.join() });
  c.location = { search: "?hotseat=1" }; c.URLSearchParams = URLSearchParams;
  c.document = { getElementById() { return null; } };
  c.setInterval = fn => { c.tickHotseat = fn; return 1; };
  const timers = [];
  c.setTimeout = fn => { timers.push(fn); return timers.length; };
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, undo: [], disarm() {}, refresh() {} };
  for (const file of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "hotseat-game.js"]) {
    vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file });
  }
  const units = party.map(kit => c.findKit(kit, c.S.state.units));
  const assignment = Object.fromEntries(units.map((u, i) => [u.id, i === units.length - 1 ? "p2" : "p1"]));
  const players = [{ id: "p1", name: "主持人", gm: true }, { id: "p2", name: "玩家 2" }];
  assert.deepEqual(plain(c.HotseatGame.configure({ mode, players, assignments: assignment })), { ok: true });
  const send = (id, command) => { c.HotseatGame.switchPlayer(id); return c.HotseatGame.submit(command); };
  const begin = () => {
    assert.equal(send("p1", { type: "startCombat" }).ok, true);
    c.HotseatGame.beginRound();
    units.forEach((u, index) => assert.equal(send(assignment[u.id], { type: "orderPick", actor: u.id, index }).ok, true));
    assert.equal(send("p1", { type: "orderConfirm" }).ok, true);
    assert.equal(send("p2", { type: "orderConfirm" }).ok, true);
  };
  return { c, units, send, begin, flush: () => { for (const fn of timers.splice(0)) fn(); }, view: () => plain(c.HotseatGame.getView()) };
}

test("real bridge binds actor ownership/turn before executing or logging an action", () => {
  const f = bridge(), [first, second] = f.units, { c } = f;
  f.begin();
  const before = plain(c.S.state), count = c.Commands.history().filter(row => row.command.type === "move").length;
  let response = f.send("p2", { type: "move", actor: first.id, dest: 2, sender: "p1" });
  assert.equal(response.ok, false); assert.match(response.error, /不是你的/);
  response = f.send("p2", { type: "move", actor: second.id, dest: 2 });
  assert.equal(response.ok, false); assert.match(response.error, /轮到/);
  assert.deepEqual(plain(c.S.state), before);
  assert.equal(c.Commands.history().filter(row => row.command.type === "move").length, count);
  assert.equal(f.send("p1", { type: "move", actor: first.id, dest: 2 }).ok, true);
  assert.equal(first.zone, 2); assert.equal(first.bonus, 0);
  assert.equal(f.view().order.find(row => row?.actor === first.id).locked, true);
  assert.equal(f.send("p1", { type: "orderMove", actor: first.id, index: 2 }).ok, false);
});

test("bridge permits unspent cross-owner swaps only after the recipient agrees", () => {
  const f = bridge(["kolt", "helu"], "coop"), [first, second] = f.units;
  f.begin();
  const request = f.send("p1", { type: "orderMove", actor: first.id, index: 1 });
  assert.equal(request.ok, true); assert.equal(request.result.status, "pending");
  assert.deepEqual(f.view().order.map(row => row.actor), [first.id, second.id]);
  assert.equal(f.send("p1", { type: "orderSwapAccept", requestId: request.result.requestId, accept: true }).ok, false);
  assert.equal(f.send("p2", { type: "orderSwapAccept", requestId: request.result.requestId, accept: true }).ok, true);
  assert.deepEqual(f.view().order.map(row => row.actor), [second.id, first.id]);
  assert.equal(f.view().currentUnitId, second.id);
});

test("one endTurn finishes one slot; a round advances only after the final slot", () => {
  const f = bridge(), [first, second] = f.units, { c } = f;
  f.begin();
  const firstEnd = f.send("p1", { type: "endTurn" });
  assert.equal(firstEnd.ok, true); assert.equal(firstEnd.result.roundDone, false);
  assert.equal(c.S.state.turnNo, 1); assert.equal(c.S.state.combatPhase, "player");
  assert.equal(f.view().currentUnitId, second.id);
  assert.equal(f.view().order.find(row => row.actor === first.id).done, true);
  const finalEnd = f.send("p2", { type: "endTurn" });
  assert.equal(finalEnd.ok, true); assert.equal(finalEnd.result.roundDone, true);
  assert.equal(f.view().phase, "enemy");
  assert.equal(c.S.state.combatPhase, "player", "only the game coordinator then starts the existing enemy phase");
  c.HotseatGame.system({ type: "battle.endPlayerTurn" });
  assert.equal(c.S.state.combatPhase, "enemy");
});

test("sandbox previews spend temporary points without locking or broadcasting an actual action", () => {
  const f = bridge(), [first] = f.units, { c } = f;
  f.begin(); c.HotseatGame.switchPlayer("p1");
  const view = f.view();
  c.GAME.sim = true;
  try { c.dispatch({ type: "move", actor: first.id, dest: 2 }); } finally { c.GAME.sim = false; }
  assert.equal(first.bonus, 0, "the preview really called the rule's spending path");
  assert.deepEqual(f.view().order, view.order);
  assert.equal(f.send("p1", { type: "orderMove", actor: first.id, index: 2 }).ok, true, "preview did not lock the real order model");
});

test("bridge appends summoned weapons and preserves a real refunded AP spend as a lock", () => {
  const f = bridge(["helu", "kolt"]), [owner] = f.units, { c } = f;
  f.begin();
  assert.equal(f.send("p1", { type: "skill", actor: owner.id, skill: "helu_summon", target: null, picks: {} }).ok, true);
  const weapon = c.findKit("ecmo", c.S.state.units);
  assert.ok(weapon); assert.equal(f.view().order.at(-1).actor, weapon.id);
  assert.equal(f.view().order.at(-1).owner, "p1");
  assert.equal(f.view().order.at(-1).locked, false);
  assert.equal(f.send("p1", { type: "endTurn" }).ok, true);
  assert.equal(f.send("p2", { type: "endTurn" }).ok, true);
  assert.equal(f.view().currentUnitId, weapon.id);
  const target = c.EnemyAI.foes()[0];
  weapon.zone = target.zone; weapon.ap = weapon.apMax = 1; target.def = 1; target.defMax = 5;
  target.layers.forEach(layer => { layer.current = layer.max = 1000; });
  const response = f.send("p1", { type: "skill", actor: weapon.id, skill: "ecmo_bite", target: target.id, picks: {} });
  assert.equal(response.ok, true, response.error);
  assert.equal(weapon.ap, 1);
  assert.equal(f.view().order.find(row => row?.actor === weapon.id).locked, true);
  assert.equal(f.send("p1", { type: "orderMove", actor: weapon.id, index: 3 }).ok, false);
});

test("only candidate owners receive actionable ask choices and first acceptance closes all views", async () => {
  const f = bridge(["ruby", "kolt", "helu"]), [target, helperA, helperB] = f.units, { c } = f;
  f.begin();
  const options = [helperA, helperB].map(unit => ({ helper: unit.id, label: unit.name, extra: {} }));
  const pending = c.HotseatGame.requestAsk("block", "谁来格挡", options, () => [helperA, helperB], { seq: 7, targetId: target.id });
  c.HotseatGame.switchPlayer("p1");
  const askId = f.view().ask.id;
  assert.deepEqual(f.view().ask.options.map(option => option.helper), [helperA.id]);
  assert.equal(f.send("p1", { type: "answer", askId, helper: helperB.id, extra: {} }).ok, false);
  c.HotseatGame.switchPlayer("p2");
  assert.deepEqual(f.view().ask.options.map(option => option.helper), [helperB.id]);
  assert.equal(f.send("p2", { type: "answer", askId, helper: helperB.id, extra: {} }).ok, true);
  assert.equal((await pending).unitId, helperB.id);
  assert.equal(f.view().ask, null);
  c.HotseatGame.switchPlayer("p1"); assert.equal(f.view().ask, null);
  assert.equal(f.send("p1", { type: "answer", askId, helper: helperA.id, extra: {} }).ok, false);
});

test("bridge rejects changing ownership or disabling hotseat during combat", () => {
  const f = bridge(), { c } = f;
  f.begin();
  assert.equal(c.HotseatGame.configure({ mode: "trpg", players: [{ id: "p1", name: "主" }, { id: "p2", name: "客" }], assignments: {} }).ok, false);
  assert.equal(c.HotseatGame.disable().ok, false);
  assert.equal(c.HotseatGame.isActive(), true);
  c.HotseatGame.switchPlayer("p2");
  assert.equal(f.send("p2", { type: "battle.panel", action: "currency", amount: 999 }).ok, false);
  assert.equal(f.send("p2", { type: "startCombat" }).ok, false);
  assert.equal(c.S.state.history.length, 0, "the active bridge never creates rule undo snapshots");
});

test("round-opening system reactions retain real point-spend locks after the order model resets", () => {
  const f = bridge(["helu", "kolt"]), [helper, target] = f.units, { c } = f;
  // A rule callback uses the actual paid assist-block implementation. It runs
  // through the same trusted system boundary as the game's reaction coordinator.
  c.Commands.register("test.roundStartBlock", () => {
    const enemy = c.EnemyAI.foes()[0]; enemy.zone = helper.zone = target.zone;
    c.performAssistBlock(helper, target, enemy, { ok: true, roll: 1 });
  });
  const chooseOrder = () => {
    c.HotseatGame.beginRound();
    assert.equal(f.send("p1", { type: "orderPick", actor: helper.id, index: 0 }).ok, true);
    assert.equal(f.send("p2", { type: "orderPick", actor: target.id, index: 1 }).ok, true);
    assert.equal(f.send("p1", { type: "orderConfirm" }).ok, true);
    assert.equal(f.send("p2", { type: "orderConfirm" }).ok, true);
  };
  assert.equal(f.send("p1", { type: "startCombat" }).ok, true);
  c.HotseatGame.system({ type: "test.roundStartBlock" });
  assert.equal(helper.bonus, 0);
  chooseOrder();
  assert.equal(f.view().order[0].locked, true, "startCombat reactions survive first beginRound");
  assert.equal(f.send("p1", { type: "orderMove", actor: helper.id, index: 2 }).ok, false);
  assert.equal(f.send("p1", { type: "endTurn" }).ok, true);
  assert.equal(f.send("p2", { type: "endTurn" }).ok, true);
  c.HotseatGame.system({ type: "battle.endPlayerTurn" });
  c.HotseatGame.system({ type: "battle.endEnemyTurn" });
  assert.equal(c.S.state.turnNo, 2); assert.equal(helper.bonus, 1);
  c.HotseatGame.system({ type: "test.roundStartBlock" });
  chooseOrder();
  assert.equal(f.view().order[0].locked, true, "new-round reactions survive the old spent-ledger reset");
  assert.equal(f.view().order[1].locked, false);
  assert.equal(f.view().order.some(row => row?.done), false);
  assert.equal(f.send("p1", { type: "orderMove", actor: helper.id, index: 2 }).ok, false);
});

test("owned opening choices accept only the owner and an exact offered JSON token", async () => {
  const f = bridge(), [unit] = f.units, { c } = f;
  const pending = c.HotseatGame.ownedChoice(unit, "初始刀头", [{ label: "电钻", value: "drill" }, { label: "酸液", value: "acid" }]);
  c.HotseatGame.switchPlayer("p1");
  const ask = f.view().ask;
  assert.equal(ask.eligible, true); assert.equal(ask.options.length, 2);
  assert.equal(f.view().canConfigure, false);
  assert.equal(c.HotseatGame.disable().ok, false);
  const cmd = { type: "answer", askId: ask.id, helper: unit.id, extra: { index: 1 } };
  assert.equal(f.send("p2", cmd).ok, false);
  assert.equal(f.view().ask.eligible, false); assert.deepEqual(f.view().ask.options, []);
  assert.equal(f.send("p1", { ...cmd, extra: { index: 99 } }).ok, false);
  assert.equal(f.send("p1", { ...cmd, extra: { index: 1, forged: true } }).ok, false);
  assert.equal(f.send("p1", { ...cmd, askId: "stale-choice" }).ok, false);
  assert.equal(f.send("p1", cmd).ok, true);
  assert.equal(await pending, "acid"); assert.equal(f.view().ask, null);
  assert.equal(f.send("p1", cmd).ok, false, "a consumed opening choice cannot be applied twice");
});

test("last unfinished unit removal exposes a round transition and schedules the game coordinator", () => {
  const f = bridge(), [, last] = f.units, { c } = f;
  f.begin(); f.flush();
  assert.equal(f.send("p1", { type: "endTurn" }).ok, true); f.flush();
  assert.equal(c.HotseatGame.needsEnemy(), false);
  let resumed = 0;
  c.GAME.resumeHotseat = () => { resumed++; };
  assert.equal(f.send("p1", { type: "battle.panel", action: "removeParty", actor: last.id }).ok, true);
  assert.equal(c.HotseatGame.needsEnemy(), true);
  assert.equal(f.view().currentUnitId, null);
  assert.equal(c.S.state.combatPhase, "player", "rule phase stays with the actual game coordinator");
  assert.equal(resumed, 0, "the coordinator cannot nest inside authority execution");
  f.flush(); assert.equal(resumed, 1);
  c.HotseatGame.system({ type: "battle.endPlayerTurn" });
  assert.equal(c.S.state.combatPhase, "enemy");
});

test("the last weapon's recall, including a queued system reaction, readies the enemy phase", () => {
  for (const queuedReaction of [false, true]) {
    const f = bridge(["helu", "kolt"]), [owner] = f.units, { c } = f;
    f.begin();
    assert.equal(f.send("p1", { type: "skill", actor: owner.id, skill: "helu_summon", target: null, picks: {} }).ok, true);
    const weapon = c.findKit("ecmo", c.S.state.units);
    assert.equal(f.send("p1", { type: "endTurn" }).ok, true);
    assert.equal(f.send("p2", { type: "endTurn" }).ok, true);
    assert.equal(f.view().currentUnitId, weapon.id);
    const recall = { type: "skill", actor: weapon.id, skill: "ecmo_return", target: null, picks: {} };
    if (queuedReaction) c.HotseatGame.system(recall);
    else assert.equal(f.send("p1", recall).ok, true);
    assert.equal(weapon.hidden, true);
    assert.equal(c.HotseatGame.needsEnemy(), true, queuedReaction ? "act's final coordinator can observe a reaction removal" : "a normal action can finish the active roster");
    assert.equal(f.view().currentUnitId, null);
    assert.equal(f.view().order.length, 2);
    assert.ok(f.view().order.every(row => row.done));
  }
});

test("legacy calculator battle aliases cannot bypass owner, turn or reaction authority", () => {
  const blocked = ["move", "skill", "skillPick", "skillCancel", "standUp", "blockAnswer", "assistAnswer", "koltSwap", "startCombat", "endTurn", "blade"];
  for (const mode of ["trpg", "coop"]) {
    const f = bridge(["kolt", "helu"], mode), [, other] = f.units;
    f.begin();
    const before = plain(f.c.S.state), order = f.view().order, logCount = f.c.Commands.history().length;
    for (const action of blocked) {
      const response = f.send("p1", { type: "calc", action, actor: other.id, dest: 2,
        skill: "helu_wave", target: null, value: "acid", helper: other.id, swap: true });
      assert.equal(response.ok, false, mode + ": " + action);
      assert.match(response.error, /技能与询问入口/, mode + ": " + action);
      assert.deepEqual(plain(f.c.S.state), before, "rejected legacy action cannot write battle data");
      assert.deepEqual(f.view().order, order);
      assert.equal(f.c.Commands.history().length, logCount);
    }
  }
});

test("cooperative host cannot edit battle data directly or through a nested TRPG UI rule", () => {
  const f = bridge(["kolt", "helu"], "coop"), [, other] = f.units;
  assert.equal(f.send("p1", { type: "battle.panel", action: "currency", amount: 3 }).ok, true, "lobby editing remains available");
  f.begin();
  const before = plain(f.c.S.state), logCount = f.c.Commands.history().length;
  const commands = [
    { type: "calc", action: "unitField", actor: other.id, field: "atk", value: 999 },
    { type: "backstage", action: "set", actor: other.id, field: "atk", value: 999 },
    { type: "trpg", action: "adjustKuizhi", amount: 999, why: "bypass" },
    { type: "battle.panel", action: "currency", amount: 999 },
    { type: "battle.setup", level: 1, encounter: null },
    { type: "trpg.ui", action: "rule", command: { type: "trpg", action: "adjustKuizhi", amount: 999, why: "nested bypass" } }
  ];
  for (const cmd of commands) {
    const response = f.send("p1", cmd);
    assert.equal(response.ok, false, cmd.type + ": " + cmd.action);
    assert.match(response.error, /合作|主持人数据编辑/, cmd.type + ": " + cmd.action);
    assert.deepEqual(plain(f.c.S.state), before);
    assert.equal(f.c.Commands.history().length, logCount);
  }
});

test("TRPG GM keeps explicit data editing while ordinary players cannot edit other units", () => {
  const f = bridge(["kolt", "helu"], "trpg"), [, other] = f.units;
  f.begin();
  const edits = [
    { type: "calc", action: "unitField", actor: other.id, field: "atk", value: 71 },
    { type: "backstage", action: "set", actor: other.id, field: "atk", value: 72 },
    { type: "battle.panel", action: "currency", amount: 5 }
  ];
  for (const cmd of edits) {
    const before = plain(f.c.S.state);
    assert.equal(f.send("p2", cmd).ok, false);
    assert.deepEqual(plain(f.c.S.state), before);
    assert.equal(f.send("p1", cmd).ok, true);
  }
  assert.equal(other.atk, 72);
  assert.equal(f.view().order.find(row => row.actor === other.id).locked, false, "GM numeric edits do not invent an action-point spend");
});
