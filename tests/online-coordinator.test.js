"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const OnlineWire = require("../online-wire");
const flush = () => new Promise(resolve => setImmediate(resolve));
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function client() {
  const sent = [], stored = new Map(); let receive, changeStatus;
  const initialStatus = { connected: true, hostOnline: true, paused: false, roster: [{ id: "host", role: "host", name: "GM", online: true }, { id: "p1", role: "player", name: "Player", online: true }] };
  const ep = { identity: { id: "p1", role: "player", roomCode: "ABCD23" },
    credentials: () => ({ role: "player", protocol: 1, build: "backfire-d3-v1" }),
    onMessage(fn) { receive = fn; }, onStatus(fn) { changeStatus = fn; fn(initialStatus); },
    send(packet) { sent.push(JSON.parse(JSON.stringify(packet))); return Promise.resolve({ ok: true }); }
  };
  const context = vm.createContext({ OnlineWire, console, Date, setTimeout, clearTimeout, setInterval() {}, queueMicrotask,
    RelayTransport: { join: async () => ep }, HotseatUI: { mount() {} }, HotseatGame: { onPacket() {} }, Commands: { intercept() {}, register() {} },
    document: { readyState: "loading", addEventListener() {}, body: { classList: { add() {} } } },
    localStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) }, addEventListener() {} });
  context.window = context;
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../online-game.js"), "utf8"), context, { filename: "online-game.js" });
  const api = context.OnlineGame; await api.join({}); await flush();
  const host = OnlineWire.create();
  const packet = (seq, type = "result") => ({ type, protocol: 1, build: "backfire-d3-v1", displayOnly: true, seq, screen: "battle",
    state: { displayOnly: true, units: [], turnNo: seq }, view: { playerId: "p1", phase: "acting", heroes: [] },
    messages: Array.from({ length: seq }, (_, i) => ({ id: "m" + i, from: "host", to: "all", text: "message-" + i })), publicLogs: [], tape: [] });
  const emit = (seq, type = "result") => receive(host.pack(packet(seq, type)), "host");
  return { api, sent, host, packet, emit, receive, status: data => changeStatus({ ...initialStatus, ...data }) };
}

test("coordinator checks duplicate/gap sequence before decoding history and accepts a resync baseline", async () => {
  const f = await client(), seen = []; f.api.onPacket(packet => { seen.push(packet.seq); });
  f.emit(1, "resync"); await flush();
  const second = f.host.pack(f.packet(2)); f.receive(second, "host"); await flush();
  const requests = f.sent.length; f.receive(second, "host"); await flush();
  assert.deepEqual(seen, [1, 2]); assert.equal(f.sent.length, requests);
  f.host.pack(f.packet(3)); f.emit(4); await flush();
  assert.equal(f.sent.at(-1).type, "resync"); assert.equal(f.api.getView().packet.seq, 2);
  f.emit(4, "resync"); await flush(); f.emit(5); await flush();
  assert.equal(f.api.getView().packet.messages.length, 5); assert.equal(f.api.getView().packet.seq, 5);
});

test("resync interrupts old playback before any later packet listener can repaint a stale snapshot", async () => {
  const f = await client(), gate = defer(), painted = [];
  f.api.onPacket(packet => packet.seq === 2 ? gate.promise : undefined);
  f.api.onPacket(packet => { painted.push(packet.seq); });
  f.emit(1, "resync"); await flush(); f.emit(2); await flush();
  f.emit(3, "resync"); await flush(); assert.equal(f.api.getView().packet.seq, 3);
  gate.resolve(); await flush();
  assert.deepEqual(painted, [1, 3], "the stale epoch must stop between each awaited listener");
  assert.equal(f.api.getView().packet.seq, 3);
});

test("playback failure cancels its already-decoded queue until a complete resync is available", async () => {
  const f = await client(), gate = defer(), painted = [];
  f.api.onPacket(async packet => { if (packet.seq === 2) await gate.promise; painted.push(packet.seq); });
  f.emit(1, "resync"); await flush(); f.emit(2); await flush(); f.emit(3); await flush();
  gate.reject(new Error("fixture playback failure")); await flush(); await flush();
  assert.equal(f.sent.at(-1).type, "resync"); assert.deepEqual(painted, [1]);
  assert.equal(f.api.getView().packet.seq, 1);
  f.emit(3, "resync"); await flush(); assert.equal(f.api.getView().packet.seq, 3);
  assert.deepEqual(painted, [1, 3]);
});

test("a failure from obsolete playback does not poison a newer successful resync", async () => {
  const f = await client(), gate = defer();
  f.api.onPacket(packet => packet.seq === 2 ? gate.promise : undefined);
  f.emit(1, "resync"); await flush(); f.emit(2); await flush(); f.emit(3, "resync"); await flush();
  const count = f.sent.length; gate.reject(new Error("obsolete failure")); await flush();
  assert.equal(f.api.getView().packet.seq, 3); assert.equal(f.api.getView().notice, ""); assert.equal(f.sent.length, count);
});

test("connection loss rejects relay-acknowledged RPC waits and a late menu cannot resurrect them", async () => {
  const f = await client();
  const rejected = assert.rejects(f.api.actionMenu({ actor: "a" }), /中断|重连/);
  await flush(); const request = f.sent.find(p => p.type === "actionOptions"); assert.ok(request);
  f.status({ connected: false, hostOnline: false, paused: true }); await rejected;
  f.receive({ type: "actionOptions", protocol: 1, build: "backfire-d3-v1", displayOnly: true, requestId: request.requestId, actor: "a", choices: { kind: "ready", command: { type: "standUp", actor: "a" } } }, "host");
  await flush();
  assert.equal(f.sent.filter(p => p.type === "actionOptions").length, 1, "a command/menu is never automatically replayed");
});
