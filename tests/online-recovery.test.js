"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Hotseat } = require("../hotseat");
const H = require("./headless");
const json = value => JSON.parse(JSON.stringify(value));
const hero = (id, kit) => ({ id, kit, name: kit, isPlayer: true, shp: 10, layers: [{ current: 20 }] });
function fixture(units = [hero("h", "hiaki"), hero("x", "xia"), hero("k", "kolt"), hero("r", "ruby")]) {
  const options = { operators: ["gm", "a", "b"], gmId: "gm", assignments: { h: "a", x: "a", k: "b", r: "b" }, getUnits: () => units, now: () => 1000 };
  return { s: Hotseat.create(options), units, restore(saved) { const restored = Hotseat.create({ ...options, assignments: {} }); restored.restore(json(saved)); return restored; } };
}

test("online checkpoint JSON roundtrip preserves spent/completed absolute slots, holes and current actor", () => {
  const f = fixture(), s = f.s; s.beginRound(3); s.forceStart("gm");
  s.markSpent([{ unitId: "k", bonus: 1 }]); s.move("a", "h", 4); s.move("a", "x", 5);
  s.finishUnit("b", "k"); s.markSpent([{ unitId: "r", ap: 1 }]);
  const before = s.snapshot(), saved = s.checkpoint(), restored = f.restore(saved);
  assert.deepEqual(restored.snapshot(), before);
  assert.deepEqual(restored.snapshot().slots.map(row => row?.unitId || null), [null, null, "k", "r", "h", "x"]);
  assert.equal(restored.snapshot().currentUnitId, "r");
  assert.throws(() => restored.move("b", "k", 6), /固定/);
  assert.throws(() => restored.move("b", "r", 6), /固定/);
  assert.throws(() => restored.move("a", "h", 0), /固定格子之后/);
  assert.throws(() => restored.assertAction("gm", "r"), /不是你的/);
  saved.slots[3].unitId = "forged"; saved.spent.length = 0;
  assert.deepEqual(restored.snapshot(), before, "the recovery sidecar is detached from live authority");
  for (const [owner, id] of [["b", "r"], ["a", "h"], ["a", "x"]]) { s.finishUnit(owner, id); restored.finishUnit(owner, id); }
  assert.equal(restored.snapshot().phase, "enemy"); assert.deepEqual(restored.snapshot(), s.snapshot());
  s.beginRound(4); restored.beginRound(4); assert.deepEqual(restored.checkpoint(), s.checkpoint());
  assert.deepEqual(restored.checkpoint().spent, []); assert.deepEqual(restored.checkpoint().completed, []);
});

test("online checkpoint preserves partial selection and opening reaction lock without forcing a new round", () => {
  const f = fixture(), s = f.s; s.beginRound(1);
  s.markSpent([{ unitId: "k", bonus: 1 }]); s.pick("b", "k", 2); s.pick("b", "r", 3); s.confirm("b");
  s.pick("a", "h", 0); s.chat("a", "先等另一名角色选格");
  const restored = f.restore(s.checkpoint());
  assert.deepEqual(restored.snapshot(), s.snapshot());
  assert.throws(() => restored.pick("b", "k", 1), /固定/);
  assert.equal(restored.snapshot().slots[1], null);
  for (const session of [s, restored]) { session.pick("a", "x", 1); session.confirm("a"); }
  assert.equal(restored.snapshot().phase, "acting"); assert.deepEqual(restored.snapshot(), s.snapshot());
});

test("online checkpoint uses actual weapon ownership and keeps a spent returned weapon locked after a new summon ID", () => {
  const c = H.load(); c.BattleSim.setup({ party: ["hiaki", "ruby"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "D3-RECOVERY-WEAPON" }); c.startCombat();
  const state = c.S.state, hiaki = c.findKit("hiaki", state.units), ruby = c.findKit("ruby", state.units);
  const options = { operators: ["gm", "a", "b"], gmId: "gm", assignments: { [hiaki.id]: "a", [ruby.id]: "b" }, getUnits: () => state.units, canStand: unit => !c.standUpBlocked(unit) };
  const first = Hotseat.create(options); first.beginRound(1); first.forceStart("gm");
  c.spawnWeapon(hiaki, "niu"); first.reconcile();
  const weapon = state.units.find(u => u.kit === "niu" && !u.hidden); assert.ok(weapon);
  first.markSpent([{ unitId: weapon.id, ap: 1 }]);
  c.returnWeapon(weapon); first.reconcile();
  const saved = json(first.checkpoint()); assert.equal(saved.roster.some(row => row.unitId === weapon.id), false);
  const restored = Hotseat.create(options); restored.restore(saved);
  c.spawnWeapon(hiaki, "niu"); restored.reconcile();
  const replacement = state.units.find(u => u.kit === "niu" && !u.hidden);
  assert.notEqual(replacement.id, weapon.id); assert.equal(restored.ownerOf(replacement.id), "a");
  assert.equal(restored.snapshot().slots.at(-1).spent, true);
  assert.throws(() => restored.move("a", replacement.id, restored.snapshot().slots.length), /固定/);
  replacement.fused = true; restored.reconcile();
  const afterFuse = Hotseat.create(options); afterFuse.restore(restored.checkpoint());
  replacement.fused = false; afterFuse.reconcile();
  assert.equal(afterFuse.snapshot().slots.at(-1).unitId, replacement.id);
  assert.equal(afterFuse.snapshot().slots.at(-1).spent, true);
});

test("online restore drops stale questions/swaps and preserves sequence for recreated authoritative questions", () => {
  const f = fixture(), s = f.s; s.beginRound(1); s.forceStart("gm");
  const request = s.move("a", "h", 2); assert.equal(request.status, "pending");
  const previous = s.openAsk({ kind: "assist", jobId: "q1", targetId: "h", candidates: ["k", "r"] });
  const restored = f.restore(s.checkpoint());
  assert.equal(restored.snapshot().ask, null); assert.equal(restored.snapshot().closedAsk, null);
  assert.deepEqual(restored.snapshot().pendingSwaps, []);
  assert.throws(() => restored.acceptSwap("b", request.requestId, true), /失效/);
  assert.throws(() => restored.answer("b", previous.id, { unitId: "k" }), /结束/);
  const next = restored.openAsk({ kind: "assist", jobId: "q1", targetId: "h", candidates: ["k", "r"] });
  assert.notEqual(next.id, previous.id);
  assert.equal(restored.answer("b", next.id, { unitId: "k" }).accepted, true);
  assert.equal(restored.snapshot().currentUnitId, "h");
});
