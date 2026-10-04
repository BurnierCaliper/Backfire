"use strict";
// Real coordinator, authority, projection and wire codec. Only the transport,
// document and GAME presentation driver are adapters; history never runs rules.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const H = require("./headless");
const json = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
const KEY = "backfire-online-v1";

async function fixture(saved) {
  const c = H.load(), sent = [], errors = [];
  c.BattleSim.setup({ party: ["ruby", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "D3-HISTORY" });
  const state = c.S.state;
  if (saved) c.localStorage.setItem(KEY, JSON.stringify(saved));
  c.console = { error: e => errors.push(String(e)), warn() {}, log() {} };
  c.location = { search: "", reload() {} }; c.URLSearchParams = URLSearchParams;
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; }, body: { classList: { add() {} } } };
  c.addEventListener = () => {}; c.setInterval = () => 0; c.setTimeout = setTimeout; c.clearTimeout = clearTimeout; c.queueMicrotask = queueMicrotask;
  let screen = "trpg", message, statusListener, requestNo = 1000;
  const status = { connected: true, hostOnline: true, paused: true, roster: [
    { id: "host", name: "主持人", role: "host", online: true },
    { id: "alice", name: "甲", role: "player", online: true },
    { id: "bob", name: "乙", role: "player", online: true }
  ] };
  c.GAME = { depth: 0, tape: null, sim: false, ended: false, level: 1, undo: [],
    refresh() {}, disarm() {}, resumeHotseat() {}, onlineCheckpoint: () => json({ state }), resumeOnline: async () => {},
    restoreOnline(value) { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, json(value.state)); }
  };
  c.Screens = { current: () => screen, is: value => value === screen };
  c.Commands.register("screen", cmd => { screen = cmd.name; });
  c.TrpgFlow = { enter() {}, onlineCheckpoint: () => ({}), restoreOnline() {} };
  c.trpgReadSlots = () => [{ name: "记录测试" }, null, null]; c.HotseatUI = { mount() {} };
  c.OnlineActions = { create: () => ({ menu() { throw new Error("History must not inspect battle actions"); } }) };
  const ep = { identity: { id: "host", name: "主持人", role: "host", roomCode: "ABC234" },
    credentials: () => ({ roomCode: "ABC234", role: "host", token: "test-token", build: "backfire-d3-v1", protocol: 1 }),
    onMessage(fn) { message = fn; }, onStatus(fn) { statusListener = fn; fn(json(status)); },
    async send(packet, recipient) { sent.push({ recipient, packet: json(packet) }); return { ok: true }; },
    async setReady() { status.paused = false; statusListener(json(status)); }, close() {}, reconnect() {}
  };
  c.RelayTransport = { createHost: async () => ep, resumeHost: async () => ep };
  for (const file of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "gm-commands.js", "hotseat-game.js", "online-view.js", "online-wire.js", "online-game.js"]) {
    vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file });
  }
  if (saved) await c.OnlineGame.resume(); else await c.OnlineGame.create({ slot: 0, name: "主持人", url: "https://fixture.invalid" });
  await flush();
  async function rpc(sender, fields) {
    const requestId = ++requestNo;
    message(json({ protocol: 1, build: "backfire-d3-v1", requestId, ...fields }), sender);
    await flush();
    const result = sent.find(row => row.recipient === sender && row.packet.requestId === requestId)?.packet;
    assert.ok(result, "coordinator must reply to the authenticated sender"); return result;
  }
  return { c, state, errors, sent, rpc,
    record: async (to, text) => { const ack = await c.OnlineGame.submit(json({ type: "gm.msg", to, text })); assert.equal(ack.ok, true, ack.error); },
    save: () => JSON.parse(c.localStorage.getItem(KEY))
  };
}

async function pages(read) {
  const all = []; let beforeId;
  for (let i = 0; i < 20; i++) {
    const page = json(await read(beforeId ? { beforeId } : {}));
    assert.equal(page.type, "messageHistory"); assert.equal(page.displayOnly, true);
    assert.ok(Array.isArray(page.messages)); assert.ok(page.messages.length <= 100);
    assert.equal(typeof page.hasMore, "boolean");
    all.unshift(...page.messages);
    if (!page.hasMore) return all;
    assert.ok(page.messages.length > 0, "another page needs a usable cursor");
    const next = page.messages[0].id; assert.notEqual(next, beforeId); beforeId = next;
  }
  assert.fail("history pagination did not terminate");
}

test("online history retains more than 300 records and paginates every earlier message without running battle rules", async () => {
  const f = await fixture();
  for (let i = 0; i < 307; i++) await f.record("all", "记录 " + i);
  const saved = f.save(); assert.equal(saved.messages.length, 307); assert.equal(saved.messages[0].text, "记录 0");
  const before = JSON.stringify(f.state), commandCount = f.c.Commands.history().length;
  const all = await pages(options => f.c.OnlineGame.messageHistory(options));
  assert.deepEqual(all.map(m => m.text), Array.from({ length: 307 }, (_, i) => "记录 " + i));
  assert.equal(new Set(all.map(m => m.id)).size, all.length);
  assert.equal(JSON.stringify(f.state), before); assert.equal(f.c.Commands.history().length, commandCount);
  all[0].text = "changed only in caller"; assert.equal(f.save().messages[0].text, "记录 0");
  assert.deepEqual(f.errors, []);
});

test("online history filters by authenticated recipient before pagination and rejects a cursor from someone else's private history", async () => {
  const f = await fixture();
  for (let i = 0; i < 216; i++) await f.record(i % 3 === 0 ? "all" : i % 3 === 1 ? "alice" : "bob", (i % 3 === 1 ? "ONLY_ALICE_" : i % 3 === 2 ? "ONLY_BOB_" : "PUBLIC_") + i);
  assert.equal((await f.rpc("alice", { type: "cmd", command: { type: "gmReply", text: "ALICE_REPLY" } })).ok, true);
  assert.equal((await f.rpc("bob", { type: "cmd", command: { type: "gmReply", text: "BOB_REPLY" } })).ok, true);
  const source = f.save().messages;
  for (const id of ["alice", "bob"]) {
    const visible = source.filter(m => m.to === "all" || m.to === id || m.from === id);
    const rows = await pages(options => f.rpc(id, { type: "messageHistory", ...options }));
    assert.deepEqual(rows.map(m => m.id), visible.map(m => m.id));
    assert.doesNotMatch(JSON.stringify(rows), id === "alice" ? /ONLY_BOB_|BOB_REPLY/ : /ONLY_ALICE_|ALICE_REPLY/);
  }
  const privateBob = source.find(m => m.to === "bob");
  const before = JSON.stringify(f.state), stored = JSON.stringify(f.save().messages);
  for (const beforeId of [privateBob.id, "msg-not-found"]) {
    const reply = await f.rpc("alice", { type: "messageHistory", beforeId, recipientId: "bob" });
    assert.equal(reply.ok, false); assert.equal(reply.messages, undefined);
    assert.doesNotMatch(JSON.stringify(reply), /ONLY_BOB_|BOB_REPLY/);
  }
  assert.equal(JSON.stringify(f.state), before); assert.equal(JSON.stringify(f.save().messages), stored);
  assert.deepEqual(f.errors, []);
});

test("a fresh host coordinator restores the full JSON history and continues unique message identities across the former 300-record boundary", async () => {
  const f = await fixture();
  for (let i = 0; i < 304; i++) await f.record(i % 2 ? "alice" : "all", "可恢复记录 " + i);
  const saved = json(f.save()), recovered = await fixture(saved);
  const all = await pages(options => recovered.c.OnlineGame.messageHistory(options));
  assert.deepEqual(all, saved.messages);
  const client = await pages(options => recovered.rpc("alice", { type: "messageHistory", ...options }));
  assert.deepEqual(client.map(m => m.id), saved.messages.map(m => m.id));
  await recovered.record("bob", "恢复后的新私信");
  const after = recovered.save().messages;
  assert.equal(after.length, 305); assert.equal(new Set(after.map(m => m.id)).size, after.length);
  assert.deepEqual(after.slice(0, 304), saved.messages);
  assert.deepEqual(recovered.errors, []);
});

test("history filters more than one page of sensitive records before paging, so earlier public messages remain reachable", async () => {
  const f = await fixture();
  await f.record("all", "早期公开线索");
  for (let i = 0; i < 110; i++) await f.record("all", "坚毅生命 HIDDEN_DETAIL_" + i);
  await f.record("bob", "ONLY_BOB_BETWEEN_PUBLIC_MESSAGES");
  await f.record("all", "最新公开线索");
  const stored = f.save().messages;
  assert.equal(stored.length, 113, "projection must not delete the host's complete source history");
  const first = await f.rpc("alice", { type: "messageHistory" });
  assert.equal(first.type, "messageHistory");
  assert.deepEqual(first.messages.map(m => m.text), ["早期公开线索", "最新公开线索"]);
  assert.equal(first.hasMore, false, "invisible records must not advertise another visible page");
  const older = await f.rpc("alice", { type: "messageHistory", beforeId: first.messages[1].id });
  assert.deepEqual(older.messages.map(m => m.text), ["早期公开线索"]);
  assert.equal(older.hasMore, false);
  const oldest = await f.rpc("alice", { type: "messageHistory", beforeId: older.messages[0].id });
  assert.deepEqual(oldest.messages, []); assert.equal(oldest.hasMore, false);
  assert.doesNotMatch(JSON.stringify([first, older, oldest]), /HIDDEN_DETAIL_|坚毅|ONLY_BOB_BETWEEN_PUBLIC_MESSAGES/);
  assert.deepEqual(f.errors, []);
});

test("host execution errors are recorded privately while every recipient gets only a fixed public notice", async () => {
  const f = await fixture(), start = f.sent.length;
  const secret = "PRIVATE_BACKSTAGE_SHP_918273";
  f.c.OnlineGame.reportError(new Error(secret)); await flush();
  assert.ok(f.errors.some(line => line.includes(secret)), "the host retains the diagnostic error");
  assert.match(f.c.OnlineGame.getView().notice, new RegExp(secret));
  const packets = f.sent.slice(start).filter(row => row.packet.type === "result");
  for (const id of ["alice", "bob"]) {
    const packet = packets.find(row => row.recipient === id)?.packet;
    assert.ok(packet, "each online player receives the error notice");
    assert.equal(packet.systemNotice, "房主遇到处理错误，请等待主持人确认后继续");
  }
  assert.ok(!JSON.stringify(packets).includes(secret));
  const afterError = f.sent.length;
  f.c.OnlineGame.onActionSettled({ type: "gm.setWeather", weather: "none" }, { executed: true }, [], {});
  await flush();
  assert.ok(f.sent.slice(afterError).filter(row => row.packet.type === "result").every(row => !row.packet.systemNotice), "a later successful rule action clears the fixed public warning");
});
