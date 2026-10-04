"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Wire = require("../online-wire");
const View = require("../online-view");
const copy = value => JSON.parse(JSON.stringify(value));
const unit = (id, hp = 20) => ({ id, name: id, zone: 1, isPlayer: true, layers: [{ type: "flesh", current: hp, max: 20 }], ap: 2, bonus: 1, statuses: {}, resources: {} });
const message = n => ({ id: "msg-" + n, from: "host", to: "all", text: "消息 " + n, at: n });
const log = n => ({ kind: "action", text: "瑞比 · 攻击 " + n, at: n });
function packet(seq, changes = {}) { return { type: "result", displayOnly: true, schema: View.SCHEMA, seq, state: { displayOnly: true, units: [unit("a")] }, view: { playerId: "p1" }, messages: [], publicLogs: [], tape: [], ...changes }; }
function roundTrip(host, client, original) {
  const before = copy(original), encoded = host.pack(original), sent = copy(encoded), restored = client.unpack(sent);
  assert.deepEqual(restored, before); assert.deepEqual(original, before); assert.deepEqual(sent, encoded);
  return { encoded, restored };
}

test("wire history starts full, sends append-only deltas, trims rolling windows and restores exact DTOs", () => {
  const host = Wire.create(), client = Wire.create();
  let r = roundTrip(host, client, packet(1, { messages: [message(1)], publicLogs: [log(1)] }));
  assert.equal(r.encoded.historyFull, true);
  r = roundTrip(host, client, packet(2, { messages: [message(1), message(2)], publicLogs: [log(1), log(2)] }));
  assert.equal(r.encoded.historyFull, false); assert.deepEqual(r.encoded.messages, [message(2)]);
  r = roundTrip(host, client, packet(3, { messages: [message(2), message(3)], publicLogs: [log(2), log(3)] }));
  assert.deepEqual(r.encoded.messages, [message(3)]); assert.equal(r.encoded.historyLengths.messages, 2);
  r = roundTrip(host, client, packet(4, { messages: [message(2), message(3)], publicLogs: [] }));
  assert.deepEqual(r.encoded.messages, []); assert.deepEqual(r.restored.publicLogs, []);
});

test("history replacements and resync reset the baseline; fresh clients reject deltas", () => {
  const host = Wire.create(), client = Wire.create();
  roundTrip(host, client, packet(1, { messages: [message(1)], publicLogs: [log(1)] }));
  const replacement = roundTrip(host, client, packet(2, { messages: [message(20)], publicLogs: [log(1), log(2)] }));
  assert.equal(replacement.encoded.historyFull, true); assert.equal(replacement.encoded.publicLogs.length, 2);
  const sync = packet(5, { type: "resync", messages: [message(20)], publicLogs: [log(2)] });
  client.reset(); assert.equal(roundTrip(host, client, sync).encoded.historyFull, true);
  const delta = host.pack(packet(6, { messages: [message(20), message(21)], publicLogs: [log(2)] }));
  assert.throws(() => Wire.create().unpack(delta), /baseline/);
  host.reset(); assert.equal(host.pack(packet(7)).historyFull, true);
  const badResync = { ...delta, type: "resync" }; assert.throws(() => client.unpack(badResync), /baseline/);
});

test("full resync with omitted histories resets both encoder and decoder, while absent delta histories stay absent", () => {
  const host = Wire.create(), client = Wire.create();
  roundTrip(host, client, packet(1, { messages: [message(1)], publicLogs: [log(1)] }));
  const sync = packet(2, { type: "resync", messages: [message(2)] }); delete sync.publicLogs;
  roundTrip(host, client, sync);
  const later = packet(3, { messages: [message(2)], publicLogs: [log(1), log(2)] });
  const { encoded } = roundTrip(host, client, later);
  assert.deepEqual(encoded.publicLogs, [log(1), log(2)]);
  const noHistory = packet(4); delete noHistory.messages; delete noHistory.publicLogs;
  roundTrip(host, client, noHistory);
  roundTrip(host, client, packet(5, { messages: [message(2), message(3)], publicLogs: [log(1), log(2)] }));
});

test("snapshot deltas preserve additions/removals, removed properties, nested values and unit ordering", () => {
  const a = unit("a"), b = unit("b"), c = unit("weapon");
  a.flying = true;
  const second = [{ ...a, layers: [{ type: "flesh", current: 9, max: 20 }], statuses: { burn: 2 } }, b];
  delete second[0].flying;
  const third = [c, second[0]], fourth = [];
  const original = packet(1, { tape: [
    { type: "pop", unitId: "a", kind: "dmg", value: 11, snap: [a, b] },
    { type: "pop", unitId: "a", kind: "status", text: "灼烧", snap: second },
    { type: "pop", unitId: "weapon", kind: "partner", snap: third },
    { type: "pop", unitId: "a", kind: "fxword", text: "倒下", snap: fourth }
  ] });
  const { encoded, restored } = roundTrip(Wire.create(), Wire.create(), original);
  assert.ok(encoded.tape[0].snap); assert.ok(encoded.tape[1].snapDelta);
  assert.deepEqual(encoded.tape[1].snapDelta.changed[0].unset, ["flying"]);
  assert.equal(restored.tape[1].snap[0].flying, undefined); assert.deepEqual(restored.tape[2].snap.map(u => u.id), ["weapon", "a"]);
  assert.deepEqual(restored.tape[3].snap, []);
});

test("repeated snapshots are compact and reconstructed frames never share mutable references", () => {
  const snap = [unit("a"), unit("b")];
  const original = packet(1, { tape: Array.from({ length: 10 }, () => ({ type: "pop", unitId: "a", kind: "dmg", value: 1, snap: copy(snap) })) });
  const { encoded, restored } = roundTrip(Wire.create(), Wire.create(), original);
  assert.deepEqual(encoded.tape[1].snapDelta, {});
  assert.ok(JSON.stringify(encoded).length < JSON.stringify(original).length / 2);
  restored.tape[0].snap[0].layers[0].current = 0;
  assert.equal(restored.tape[1].snap[0].layers[0].current, 20); assert.equal(original.tape[0].snap[0].layers[0].current, 20);
});

test("recipient caches are independent and private histories cannot cross pack/unpack instances", () => {
  const source = { ...packet(1), messages: [message(1), { id: "private-a", from: "host", to: "a", text: "ONLY_A" }, { id: "private-b", from: "host", to: "b", text: "ONLY_B" }] };
  const pairs = Object.fromEntries(["a", "b"].map(id => [id, { host: Wire.create(), client: Wire.create() }]));
  for (let seq = 1; seq < 4; seq++) {
    source.seq = seq; source.messages.push(message(seq + 10));
    for (const id of ["a", "b"]) {
      const safe = View.projectPacket(source, { recipientId: id, gmId: "host" });
      const { encoded, restored } = roundTrip(pairs[id].host, pairs[id].client, safe);
      assert.ok(!JSON.stringify(encoded).includes(id === "a" ? "ONLY_B" : "ONLY_A"));
      assert.ok(!JSON.stringify(restored).includes(id === "a" ? "ONLY_B" : "ONLY_A"));
    }
  }
});

test("ack/action menu remain independent JSON copies and need no history baseline", () => {
  for (const type of ["ack", "actionOptions"]) {
    const original = { type, displayOnly: true, requestId: 1, result: { ok: true }, choices: { options: [{ value: "a", label: "行动" }] } };
    const { encoded, restored } = roundTrip(Wire.create(), Wire.create(), original);
    assert.equal(encoded.wireFormat, undefined); restored.choices.options[0].label = "changed";
    assert.equal(original.choices.options[0].label, "行动");
  }
});

test("malformed metadata and snapshot deltas fail without poisoning the last good history baseline", () => {
  const host = Wire.create(), client = Wire.create();
  roundTrip(host, client, packet(1, { messages: [message(1)] }));
  const valid = host.pack(packet(2, { messages: [message(1), message(2)] }));
  const cases = [
    { ...copy(valid), wireFormat: "future-unknown" },
    { ...copy(valid), historyLengths: { messages: 999, publicLogs: 0 } },
    { ...copy(valid), tape: [{ type: "pop", snapDelta: {} }] },
    { ...copy(valid), tape: [{ type: "pop", snap: [unit("a")] }, { type: "pop", snapDelta: { changed: [{ id: "a", set: { id: "b" } }] } }] },
    { ...copy(valid), tape: [{ type: "pop", snap: [unit("a")] }, { type: "pop", snapDelta: { order: ["missing"] } }] },
    { ...copy(valid), tape: [{ type: "pop", snap: [unit("a"), unit("a")] }] }
  ];
  for (const bad of cases) assert.throws(() => client.unpack(bad), /OnlineWire/);
  assert.deepEqual(client.unpack(valid).messages, [message(1), message(2)]);
});

test("plain display resync is an independent baseline, while authority and executable data are rejected", () => {
  const original = packet(5, { type: "resync", messages: [message(5)] });
  assert.deepEqual(Wire.create().unpack(original), original);
  for (const method of ["pack", "unpack"]) {
    assert.throws(() => Wire.create()[method]({ type: "result", state: {} }), /displayOnly/);
    assert.throws(() => Wire.create()[method]({ ...original, callback() {} }), /JSON/);
    assert.throws(() => Wire.create()[method]({ ...original, value: NaN }), /JSON/);
    const getter = { ...original }; Object.defineProperty(getter, "secret", { enumerable: true, get() { throw new Error("must not execute"); } });
    assert.throws(() => Wire.create()[method](getter), /data properties/);
    const cyclic = { ...original }; cyclic.self = cyclic; assert.throws(() => Wire.create()[method](cyclic), /acyclic/);
  }
});

test("large prior histories and repeated 4v3 snapshots do not scale normal action packets with history size", () => {
  const host = Wire.create(), client = Wire.create();
  const history = Array.from({ length: 100 }, (_, n) => ({ ...message(n), text: "公开文字".repeat(100) + n }));
  const logs = Array.from({ length: 100 }, (_, n) => log(n));
  roundTrip(host, client, packet(1, { type: "resync", messages: history, publicLogs: logs }));
  const snap = Array.from({ length: 7 }, (_, n) => unit("unit-" + n));
  const action = packet(2, { messages: history, publicLogs: [...logs.slice(1), log(100)], tape: Array.from({ length: 30 }, () => ({ type: "pop", unitId: "unit-0", kind: "dmg", value: 1, snap: copy(snap) })) });
  const { encoded } = roundTrip(host, client, action);
  assert.equal(encoded.messages.length, 0); assert.equal(encoded.publicLogs.length, 1);
  const before = Buffer.byteLength(JSON.stringify(action)), after = Buffer.byteLength(JSON.stringify(encoded));
  assert.ok(after < 50 * 1024); assert.ok(after < before / 5, `${after}/${before} bytes`);
});
