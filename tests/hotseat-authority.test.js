"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
require("../commands");
const { Hotseat } = require("../hotseat");
const Authority = require("../hotseat-authority");
const H = require("./headless");
const copy = value => JSON.parse(JSON.stringify(value));

function fixture(overrides = {}) {
  const state = { units: [
    { id: "a", kit: "ruby", isPlayer: true, layers: [{ current: 10 }], shp: 10 },
    { id: "b", kit: "kolt", isPlayer: true, layers: [{ current: 10 }], shp: 10 }
  ], count: 0 };
  let tape = [], executions = 0;
  const session = Hotseat.create({ getUnits: () => state.units, operators: ["gm", "p2"], gmId: "gm", assignments: { a: "gm", b: "p2" } });
  session.beginRound(1); session.pick("gm", "a", 0); session.pick("p2", "b", 1); session.confirm("gm"); session.confirm("p2");
  const authority = Authority.create({
    session, getState: () => state, getTape: () => tape,
    validate(cmd, sender) {
      if (cmd.type === "act" || cmd.type === "finish") session.assertAction(sender, cmd.actor);
      else if (cmd.type !== "answer") throw new Error("unknown action");
    },
    execute(cmd, sender) {
      executions++;
      if (cmd.type === "finish") return session.finishUnit(sender, cmd.actor);
      if (cmd.type === "answer") return session.answer(sender, cmd.askId, cmd.response);
      state.count += cmd.amount;
      tape = [{ type: "log", text: "host action " + state.count }];
      return { count: state.count };
    },
    ...overrides
  });
  return { authority, session, state, executions: () => executions };
}

test("one host executes once and all client snapshots are isolated JSON display copies", () => {
  const f = fixture(), gm = f.authority.connect("gm"), p2 = f.authority.connect("p2"), messages = [];
  p2.onMessage(message => { if (message.type === "result") messages.push(message); });
  assert.equal(messages.length, 1, "new subscriber receives the initial display snapshot");
  const command = { type: "act", actor: "a", amount: 2 };
  assert.deepEqual(gm.send(command), { ok: true, result: { count: 2 }, seq: 1 });
  assert.equal(f.executions(), 1);
  assert.deepEqual(gm.snapshot(), p2.snapshot());
  assert.deepEqual(p2.snapshot().state, f.state);
  assert.deepEqual(p2.snapshot().tape, [{ type: "log", text: "host action 2" }]);
  messages.at(-1).state.count = 900; messages.at(-1).view.slots[0].operatorId = "forged";
  const cached = p2.snapshot(); cached.state.units[0].shp = -100;
  assert.equal(f.state.count, 2); assert.equal(f.state.units[0].shp, 10);
  assert.equal(gm.snapshot().view.slots[0].operatorId, "gm");
  assert.equal(p2.snapshot().state.units[0].shp, 10);
  assert.deepEqual(command, { type: "act", actor: "a", amount: 2 });
  assert.ok(messages.every(message => message.protocol === 1 && message.build === "backfire-d2"));
});

test("handshake rejects protocol/build mismatches, unknown identities and duplicate connections", () => {
  const f = fixture();
  assert.throws(() => f.authority.connect("p2", { protocol: 2 }), /版本不同/);
  assert.throws(() => f.authority.connect("p2", { build: "another-build" }), /版本不同/);
  assert.throws(() => f.authority.connect("stranger"), /操作者/);
  const client = f.authority.connect("p2", { protocol: 1, build: "backfire-d2" });
  assert.throws(() => f.authority.connect("p2"), /已经连接/);
  assert.equal(client.snapshot().seq, 0);
  assert.equal(f.executions(), 0); assert.equal(f.state.count, 0);
});

test("bound sender identity, ownership, turn and strict JSON validation reject before rule execution", () => {
  const f = fixture(), gm = f.authority.connect("gm"), p2 = f.authority.connect("p2"), before = copy(f.state);
  const wrongOwner = p2.send({ type: "act", actor: "a", amount: 8, sender: "gm", operatorId: "gm" });
  assert.equal(wrongOwner.ok, false); assert.match(wrongOwner.error, /不是你的/);
  const wrongTurn = p2.send({ type: "act", actor: "b", amount: 8 });
  assert.equal(wrongTurn.ok, false); assert.match(wrongTurn.error, /轮到/);
  for (const command of [{ type: "act", actor: "a", amount: undefined }, { type: "act", actor: "a", amount: NaN }, { type: "act", actor: "a", fn() {} }, null, []]) assert.equal(gm.send(command).ok, false);
  assert.deepEqual(f.state, before);
  assert.equal(f.executions(), 0); assert.equal(f.authority.seq, 0);
  assert.deepEqual(gm.snapshot().state, before);
});

test("repeated request ids return their prior acknowledgment without reexecution or rebroadcast", () => {
  const f = fixture(), gm = f.authority.connect("gm");
  let results = 0; gm.onMessage(message => { if (message.type === "result") results++; });
  const command = { type: "act", actor: "a", amount: 3 };
  const first = gm.send(command, { requestId: 7 });
  assert.deepEqual(gm.send(copy(command), { requestId: 7 }), first);
  assert.equal(f.executions(), 1); assert.equal(f.state.count, 3); assert.equal(results, 2);
  const reused = gm.send({ ...command, amount: 99 }, { requestId: 7 });
  assert.equal(reused.ok, false); assert.match(reused.error, /编号已用于/);
  assert.equal(f.executions(), 1); assert.equal(f.authority.seq, 1);
  assert.equal(gm.send(command).seq, 2, "automatic numbering advances past explicit ids");
  assert.equal(f.state.count, 6);
});

test("recipient-specific asks contain only that operator's options and keep independent messages", () => {
  let session;
  const f = fixture({ viewFor(operatorId, view) { view.ask = session.askFor(operatorId); return view; } });
  session = f.session;
  const gm = f.authority.connect("gm"), p2 = f.authority.connect("p2");
  const ask = session.openAsk({ kind: "block", candidates: ["a"], targetId: "b" });
  f.authority.broadcast();
  assert.deepEqual(gm.snapshot().view.ask.options.map(option => option.unitId), ["a"]);
  assert.deepEqual(p2.snapshot().view.ask.options, []);
  assert.equal(p2.snapshot().view.ask.eligible, false);
  assert.equal(gm.send({ type: "answer", askId: ask.id, response: { unitId: "a", extra: {} } }).ok, true);
  assert.equal(gm.snapshot().view.ask, null); assert.equal(p2.snapshot().view.ask, null);
  assert.equal(session.snapshot().closedAsk.unitId, "a");
});

test("subscriber errors and reentrant requests do not interrupt broadcast or double-execute", () => {
  const f = fixture(), gm = f.authority.connect("gm"), p2 = f.authority.connect("p2");
  let reentrant;
  gm.onMessage(message => {
    if (message.type === "result" && message.seq === 1) reentrant = gm.send({ type: "act", actor: "a", amount: 50 });
    throw new Error("display failed");
  });
  assert.equal(gm.send({ type: "act", actor: "a", amount: 1 }).ok, true);
  assert.equal(reentrant.ok, false); assert.match(reentrant.error, /正在结算/);
  assert.equal(f.executions(), 1); assert.equal(f.state.count, 1);
  assert.deepEqual(gm.snapshot(), p2.snapshot());
});

test("rule errors publish partial authority state and cache failure instead of running it twice", () => {
  const state = { count: 0 };
  let calls = 0;
  const f = fixture({ getState: () => state, execute() { calls++; state.count++; throw new Error("partial rule failure"); } });
  const gm = f.authority.connect("gm"), p2 = f.authority.connect("p2"), cmd = { type: "act", actor: "a", amount: 1 };
  const result = gm.send(cmd, { requestId: 1 });
  assert.equal(result.ok, false); assert.match(result.error, /partial rule failure/);
  assert.equal(result.seq, 1);
  assert.deepEqual(gm.snapshot().state, state); assert.deepEqual(p2.snapshot().state, state);
  assert.deepEqual(gm.send(cmd, { requestId: 1 }), result);
  assert.equal(calls, 1); assert.equal(state.count, 1);
});

test("session changes broadcast once after a command; closed clients cannot execute", () => {
  const f = fixture(), gm = f.authority.connect("gm"), p2 = f.authority.connect("p2");
  f.session.onChange(() => f.authority.broadcast());
  assert.equal(gm.send({ type: "finish", actor: "a" }).ok, true);
  assert.equal(f.authority.seq, 1);
  assert.equal(p2.snapshot().view.currentUnitId, "b");
  p2.close();
  assert.equal(p2.send({ type: "act", actor: "b", amount: 9 }).ok, false);
  assert.equal(f.state.count, 0);
  f.authority.close();
  assert.equal(gm.send({ type: "act", actor: "a", amount: 9 }).ok, false);
  assert.throws(() => f.authority.broadcast(), /已关闭/);
});

test("real rule action reaches only the host and refunded AP still locks its weapon's slot", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["helu", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "D2-AUTHORITY-RULE" });
  c.startCombat();
  const owner = c.findKit("helu", c.S.state.units), other = c.findKit("kolt", c.S.state.units), weapon = c.spawnWeapon(owner, "ecmo"), target = c.EnemyAI.foes()[0];
  weapon.zone = target.zone; weapon.ap = 1; target.def = 1; target.defMax = 5;
  target.layers.forEach(layer => { layer.current = layer.max = 1000; });
  const session = Hotseat.create({ getUnits: () => c.S.state.units, operators: ["gm", "p2"], gmId: "gm", assignments: { [owner.id]: "gm", [other.id]: "p2" } });
  session.beginRound(1); session.pick("gm", weapon.id, 0); session.pick("gm", owner.id, 1); session.pick("p2", other.id, 2); session.confirm("gm"); session.confirm("p2");
  c.onActionSpend(event => session.markSpent([event]));
  let calls = 0;
  const authority = Authority.create({ session, getState: () => c.S.state, validate: (cmd, sender) => session.assertAction(sender, cmd.actor), execute(cmd) { calls++; return c.dispatch(cmd); }, afterCommand: () => session.reconcile() });
  const gm = authority.connect("gm"), p2 = authority.connect("p2");
  const cmd = { type: "skill", actor: weapon.id, skill: "ecmo_bite", target: target.id, picks: {} };
  assert.equal(p2.send({ ...cmd, sender: "gm" }).ok, false);
  assert.equal(gm.send(cmd).ok, true);
  assert.equal(calls, 1); assert.equal(weapon.ap, 1);
  assert.equal(session.snapshot().slots[0].spent, true);
  assert.equal(c.S.state.battleScore.parts.action, c.S.SCORE_RULES.ap);
  assert.deepEqual(gm.snapshot().state, copy(c.S.state));
  assert.deepEqual(p2.snapshot().state, gm.snapshot().state);
});
