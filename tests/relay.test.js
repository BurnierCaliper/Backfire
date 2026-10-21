"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const Relay = require("../relay-transport.js");
const { createLocalRelayServer } = require("../relay/local-server.cjs");
const version = { protocol: 1, build: "relay-test-v1" };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 4000) {
  const end = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > end) throw new Error(message || "condition timed out"); await pause(10); }
}
async function room(t, options = {}) {
  const server = await createLocalRelayServer(options), endpoints = [];
  t.after(async () => { endpoints.forEach(p => p.close()); await server.close(); });
  const host = await Relay.createHost({ url: server.url, name: "GM", ...version, autoReconnect: false });
  endpoints.push(host); await host.setReady(true);
  async function player(name, extra = {}) {
    const endpoint = await Relay.join({ url: server.url, roomCode: host.identity.roomCode, name, ...version, autoReconnect: false, ...extra });
    endpoints.push(endpoint); return endpoint;
  }
  return { server, host, player, endpoints };
}
async function raw(url, roomCode) {
  const socket = new WebSocket(url.replace(/^http/, "ws") + "/rooms/" + roomCode), received = [];
  socket.addEventListener("message", e => { if (e.data !== "pong") received.push(JSON.parse(e.data)); });
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  return { socket, received, send: value => socket.send(JSON.stringify({ v: 1, ...version, ...value })) };
}

test("relay validates JSON without invoking accessors or silently stripping values", () => {
  for (const value of [{ a: undefined }, { a: () => 1 }, { a: NaN }, new Date(), [ , 1 ], { a: Symbol() }]) assert.throws(() => Relay.validate(value));
  let invoked = false; const accessor = { get value() { invoked = true; return 1; } };
  assert.throws(() => Relay.validate(accessor)); assert.equal(invoked, false);
  const loop = {}; loop.loop = loop; assert.throws(() => Relay.validate(loop));
  assert.throws(() => Relay.validate(JSON.parse('{"__proto__":{"admin":true}}')));
  assert.doesNotThrow(() => Relay.validate({ array: [1, null, "你好", false] }));
});

test("real Worker WS: endpoint-bound sender, private recipients and detached identity", async t => {
  const { host, player } = await room(t), alice = await player("Alice"), bob = await player("Bob");
  const seen = { host: [], alice: [], bob: [] };
  for (const [key, endpoint] of Object.entries({ host, alice, bob })) endpoint.onMessage((message, from) => seen[key].push({ message, from }));
  await alice.send({ sender: "host", command: { type: "move" } });
  await until(() => seen.host.length === 1);
  assert.equal(seen.host[0].from, alice.identity.id);
  assert.equal(seen.host[0].message.sender, "host", "payload is opaque; authority must use envelope sender");
  await host.send({ private: "Alice only" }, alice.identity.id);
  await until(() => seen.alice.length === 1);
  await host.send({ public: true });
  await until(() => seen.alice.length === 2 && seen.bob.length === 1);
  assert.deepEqual(seen.bob, [{ message: { public: true }, from: "host" }]);
  await assert.rejects(alice.send({ forbidden: true }, bob.identity.id), /只能/);
  await assert.rejects(alice.setReady(false), /只有主持人/);
  const identity = alice.identity; identity.id = "host"; assert.notEqual(alice.identity.id, "host");
  const publicStatus = JSON.stringify(alice.status());
  assert.ok(!publicStatus.includes("token")); assert.ok(!publicStatus.includes(host.credentials().token));
  assert.match(host.identity.roomCode, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.match(host.credentials().token, /^[a-f0-9]{64}$/);
  assert.match(alice.credentials().token, /^[a-f0-9]{64}$/);
  assert.notEqual(alice.credentials().token, host.credentials().token);
});

test("real Worker WS: nickname is not authentication; four player seats persist offline", async t => {
  const { host, player, server } = await room(t), alice = await player("Alice");
  await assert.rejects(player("ＡＬＩＣＥ"), /占用/);
  await assert.rejects(player("GM"), /占用/);
  await assert.rejects(player("Alice", { resumeToken: "a".repeat(64) }), /令牌无效/);
  await assert.rejects(player("Alice", { resumeToken: host.credentials().token }), /令牌无效/);
  await assert.rejects(Relay.resumeHost({ url: server.url, roomCode: host.identity.roomCode, hostToken: alice.credentials().token, ...version }), /令牌无效/);
  await assert.rejects(player("Wrong build", { build: "different" }), /版本不同/);
  await player("B"); await player("C"); await player("D");
  const credentials = alice.credentials(), original = alice.identity;
  alice.close(); await until(() => !host.status().roster.find(p => p.id === original.id).online);
  await assert.rejects(player("Fifth"), /四名玩家/);
  const resumed = await player("Forged nickname", { resumeToken: credentials.token });
  assert.deepEqual(resumed.identity, original);
});

test("real Worker WS: host loss pauses all, token restores host but readiness stays explicit", async t => {
  const { host, player, server, endpoints } = await room(t), alice = await player("Alice");
  const credentials = host.credentials(); host.close();
  await until(() => alice.status().paused && !alice.status().hostOnline);
  await assert.rejects(alice.send({ type: "skill" }), /暂停/);
  await assert.rejects(player("New player"), /主持人离线/);
  const resumed = await Relay.resumeHost({ ...credentials, hostToken: credentials.token, autoReconnect: false }); endpoints.push(resumed);
  await until(() => alice.status().hostOnline);
  assert.equal(alice.status().paused, true);
  const seen = []; alice.onMessage(message => seen.push(message));
  await resumed.send({ recovery: "state" }, alice.identity.id);
  await until(() => seen.length === 1);
  await resumed.setReady(true); await until(() => !alice.status().paused);
  const commands = []; resumed.onMessage((message, from) => commands.push({ message, from }));
  await alice.send({ type: "skill" }); await until(() => commands.length === 1);
  assert.equal(commands[0].from, alice.identity.id);
  await assert.rejects(Relay.resumeHost({ url: server.url, roomCode: credentials.roomCode, ...version, hostToken: "0".repeat(64) }), /令牌无效/);
});

test("real Worker WS: replacing a live token disconnects the old endpoint only", async t => {
  const { player, host } = await room(t), alice = await player("Alice"), old = alice.identity;
  const resumed = await player("Changed name", { resumeToken: alice.credentials().token });
  await until(() => !alice.status().connected);
  assert.deepEqual(resumed.identity, old);
  await until(() => host.status().roster.find(p => p.id === old.id).online);
  const received = []; host.onMessage((value, from) => received.push({ value, from }));
  await resumed.send({ resumed: true }); await until(() => received.length === 1);
  await assert.rejects(alice.send({ stale: true }), /未连接/);
});

test("real Worker WS: bounded Unicode snapshot chunks reassemble; ordinary player commands cannot chunk", async t => {
  const { host, player } = await room(t), alice = await player("Alice"), bob = await player("Bob");
  const seen = [], other = []; alice.onMessage(message => seen.push(message)); bob.onMessage(message => other.push(message));
  const snapshot = { kind: "resync", notes: "🙂引号\"\n".repeat(24000) };
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) > Relay.FRAME_MAX);
  await host.send(snapshot, alice.identity.id); await until(() => seen.length === 1);
  assert.deepEqual(seen[0], snapshot); assert.deepEqual(other, []);
  await assert.rejects(alice.send(snapshot), /50 KB/);
  await assert.rejects(host.send({ data: "x".repeat(Relay.MESSAGE_MAX) }), /2 MB/);
  await assert.rejects(host.send({ bad: undefined }), /JSON/);
});

test("real Worker WS: forged envelope identity, recipient bypass, bad chunk and oversize frame are rejected", async t => {
  const { host, player, server } = await room(t), alice = await player("Alice");
  const attacker = await raw(server.url, host.identity.roomCode); t.after(() => attacker.socket.close());
  attacker.send({ kind: "join", role: "player", name: "Attacker" });
  await until(() => attacker.received.some(m => m.kind === "joined"));
  const id = attacker.received.find(m => m.kind === "joined").identity.id, seen = [];
  host.onMessage((value, from) => seen.push({ value, from }));
  attacker.send({ kind: "data", id: "spoof", from: "host", sender: "host", to: "host", payload: { x: 1 } });
  await until(() => seen.length === 1); assert.equal(seen[0].from, id);
  attacker.send({ kind: "data", id: "bypass", to: alice.identity.id, payload: {} });
  await until(() => attacker.received.some(m => m.id === "bypass" && m.code === "recipient"));
  attacker.send({ kind: "chunk", id: "chunk", to: "host", index: 0, count: 2, text: "{}" });
  await until(() => attacker.received.some(m => m.id === "chunk" && m.code === "recipient"));
  attacker.send({ kind: "data", id: "large", payload: "x".repeat(Relay.FRAME_MAX) });
  await until(() => attacker.received.some(m => m.code === "too_large"));
  assert.equal(seen.length, 1);
});

test("real Worker WS: per-endpoint frame rate is enforced", async t => {
  const { host, server } = await room(t), attacker = await raw(server.url, host.identity.roomCode);
  t.after(() => attacker.socket.close()); host.onMessage(() => {});
  attacker.send({ kind: "join", role: "player", name: "Fast" }); await until(() => attacker.received.some(m => m.kind === "joined"));
  for (let i = 0; i < 121; i++) attacker.send({ kind: "data", id: "rate_" + i, payload: {} });
  await until(() => attacker.received.some(m => m.code === "rate_limit"));
});

test("real Worker WS: 超限先拒绝这一条（不断线），持续超限才断开", async t => {
  const { host, server } = await room(t), p = await raw(server.url, host.identity.roomCode);
  t.after(() => p.socket.close()); host.onMessage(() => {});
  p.send({ kind: "join", role: "player", name: "Burst" }); await until(() => p.received.some(m => m.kind === "joined"));
  for (let i = 0; i < 125; i++) p.send({ kind: "data", id: "b_" + i, payload: {} });
  await until(() => p.received.some(m => m.code === "rate_limit"));
  const err = p.received.find(m => m.code === "rate_limit");
  assert.match(err.error, /发送太快/);
  await pause(150);
  assert.equal(p.socket.readyState, WebSocket.OPEN, "刚超限不应断线");
  for (let i = 0; i < 100; i++) p.send({ kind: "data", id: "c_" + i, payload: {} });
  await until(() => p.socket.readyState === WebSocket.CLOSED, "持续超限应断开");
});

test("real Worker HTTP: origin, payload and admission limits", async t => {
  const server = await createLocalRelayServer({ origins: ["https://game.example"] }); t.after(() => server.close());
  const request = (body, origin) => fetch(server.url + "/rooms", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  assert.equal((await request({ ...version, name: "GM" }, "https://evil.example")).status, 403);
  const allowed = await request({ ...version, name: "GM" }, "https://game.example");
  assert.equal(allowed.status, 200); assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), "https://game.example");
  assert.equal((await request({ name: "x".repeat(5000) })).status, 413);
  assert.equal((await request({ ...version, name: "\n" })).status, 400);
  for (let i = 0; i < 7; i++) await request({});
  assert.equal((await request({})).status, 429);
  assert.equal((await fetch(server.url + "/rooms/ABC234")).status, 404);
});

test("SQLite persistence: service restart preserves tokens, original seats and host recovery pause", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "backfire-relay-test-"));
  let server, host, player;
  t.after(async () => { host?.close(); player?.close(); if (server) await server.close(); if (path.basename(directory).startsWith("backfire-relay-test-")) await fs.rm(directory, { recursive: true, force: true }); });
  server = await createLocalRelayServer({ persistPath: directory });
  host = await Relay.createHost({ url: server.url, name: "GM", ...version, autoReconnect: false }); await host.setReady(true);
  player = await Relay.join({ url: server.url, roomCode: host.identity.roomCode, name: "Alice", ...version, autoReconnect: false });
  const h = host.credentials(), p = player.credentials(), identity = player.identity;
  host.close(); player.close(); await server.close(); server = null;
  server = await createLocalRelayServer({ persistPath: directory });
  host = await Relay.resumeHost({ ...h, url: server.url, hostToken: h.token, autoReconnect: false });
  player = await Relay.join({ ...p, url: server.url, name: "Impostor name ignored", resumeToken: p.token, autoReconnect: false });
  assert.deepEqual(player.identity, identity); assert.equal(player.status().paused, true);
  const status = JSON.stringify(player.status()); assert.ok(!status.includes(p.token)); assert.ok(!status.includes("tokenHash"));
  await host.setReady(true); await until(() => !player.status().paused);
});

test("room expiry rejects rejoin, closes sockets and deletes short-lived metadata", async () => {
  const original = globalThis.WebSocketRequestResponsePair;
  globalThis.WebSocketRequestResponsePair = class { constructor(request, response) { this.request = request; this.response = response; } };
  try {
    const { Room } = await import(pathToFileURL(path.resolve(__dirname, "../relay/worker.js")).href);
    let stored = { code: "ABC234", ...version, expiresAt: Date.now() - 1, seats: [] }, closed, deleted = false;
    const sent = [], loads = [], socket = { readyState: 1, send: text => sent.push(JSON.parse(text)), close: (code, reason) => { closed = { code, reason }; socket.readyState = 3; }, deserializeAttachment: () => ({ id: "host", role: "host" }) };
    const ctx = { blockConcurrencyWhile(fn) { const p = fn(); loads.push(p); return p; }, setWebSocketAutoResponse() {}, getWebSockets: () => [socket],
      storage: { get: async () => stored, deleteAll: async () => { deleted = true; stored = null; } } };
    const room = new Room(ctx, {}); await Promise.all(loads);
    assert.equal((await room.fetch(new Request("https://internal/socket"))).status, 404);
    await room.alarm(); assert.equal(deleted, true); assert.equal(stored, null);
    assert.deepEqual(closed, { code: 1000, reason: "expired" }); assert.equal(sent[0].code, "expired");
  } finally { if (original === undefined) delete globalThis.WebSocketRequestResponsePair; else globalThis.WebSocketRequestResponsePair = original; }
});

test("native WebSocket automatic reconnect keeps its token and waits for explicit host readiness", async t => {
  const server = await createLocalRelayServer(), sockets = [];
  class ObservedSocket extends WebSocket { constructor(url) { super(url); sockets.push(this); } }
  let host, player;
  t.after(async () => { host?.close(); player?.close(); await server.close(); });
  host = await Relay.createHost({ url: server.url, name: "GM", ...version, WebSocket: ObservedSocket }); await host.setReady(true);
  player = await Relay.join({ url: server.url, roomCode: host.identity.roomCode, name: "Alice", ...version, autoReconnect: false });
  const before = host.credentials(); sockets[0].close(1000, "transport interruption");
  await until(() => player.status().paused);
  await until(() => sockets.length === 2 && host.status().connected, "automatic reconnect did not finish", 5000);
  assert.deepEqual(host.credentials(), before); assert.equal(host.status().paused, true);
  await host.setReady(true); await until(() => !player.status().paused);
  const received = []; host.onMessage((message, from) => received.push({ message, from }));
  await player.send({ afterAutoReconnect: true }); await until(() => received.length === 1);
  assert.equal(received[0].from, player.identity.id);
});

test("host releases a player seat: token is dropped, socket closed, nickname and slot reusable", async t => {
  const server = await createLocalRelayServer();
  let host, player, again, intruder;
  t.after(async () => { host?.close(); player?.close(); again?.close(); intruder?.close(); await server.close(); });
  host = await Relay.createHost({ url: server.url, name: "GM", ...version, autoReconnect: false }); await host.setReady(true);
  player = await Relay.join({ url: server.url, roomCode: host.identity.roomCode, name: "Alice", ...version, autoReconnect: false });
  const lost = player.credentials(), seat = player.identity.id;
  // 玩家不能释放座位
  await assert.rejects(player.releaseSeat(seat), /只有主持人/);
  await assert.rejects(host.releaseSeat("p_missing"), /没有这个玩家座位/);
  await host.releaseSeat(seat);
  await until(() => !player.status().connected);
  await until(() => !host.status().roster.some(p => p.id === seat));
  // 旧令牌失效；同一个昵称可以重新加入，拿到新座位
  await assert.rejects(Relay.join({ url: server.url, roomCode: lost.roomCode, name: "Alice", ...version, resumeToken: lost.token, autoReconnect: false }), /恢复令牌无效/);
  again = await Relay.join({ url: server.url, roomCode: host.identity.roomCode, name: "Alice", ...version, autoReconnect: false });
  assert.notEqual(again.identity.id, seat);
  await until(() => host.status().roster.some(p => p.id === again.identity.id && p.online));
});

/* ---------- issue #44：幽灵座位、本机任意端口、连接失败说清楚原因 ---------- */
test("幽灵座位：拿到 joined 前就断开的新座位立刻清掉；一直不确认的 20 秒（测试里 1.5 秒）后清掉；确认过的保留", async t => {
  const { server, host } = await room(t, { seatConfirmMs: 1500 });
  const code = host.identity.roomCode;
  const names = () => host.status().roster.filter(p => p.role === "player").map(p => p.name).sort();
  // 1) 加入后马上断开、没回确认
  const a = await raw(server.url, code);
  a.send({ kind: "join", role: "player", name: "断线甲", confirm: true });
  await until(() => a.received.some(m => m.kind === "joined"));
  assert.equal(a.received.find(m => m.kind === "joined").confirmSeat, true);
  a.socket.close();
  await until(() => !names().includes("断线甲"), "断开的待确认座位要清掉");
  // 2) 连着但一直不确认
  const b = await raw(server.url, code);
  b.send({ kind: "join", role: "player", name: "幽灵乙", confirm: true });
  await until(() => names().includes("幽灵乙"));
  await until(() => !names().includes("幽灵乙"), "超时没确认的座位要清掉", 8000);
  // 3) 新版客户端会自动确认：座位保留，昵称可以重新用
  const c = await Relay.join({ url: server.url, roomCode: code, name: "幽灵乙", ...version, autoReconnect: false });
  t.after(() => c.close());
  await pause(2500);
  assert.ok(names().includes("幽灵乙"), "确认过的座位不清");
  // 4) 旧版客户端（join 不带 confirm）照旧：座位不会被当成幽灵座位
  const d = await raw(server.url, code);
  d.send({ kind: "join", role: "player", name: "旧版丙" });
  await until(() => d.received.some(m => m.kind === "joined"));
  assert.equal(d.received.find(m => m.kind === "joined").confirmSeat, undefined);
  await pause(2500);
  assert.ok(names().includes("旧版丙"));
  d.socket.close();
});

test("本机任意端口的网页都能连；被拒绝的来源读得到原因；查房间在不在", async t => {
  const server = await createLocalRelayServer({ origins: ["https://game.example"] }); t.after(() => server.close());
  const post = origin => fetch(server.url + "/rooms", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ ...version, name: "GM" }) });
  for (const origin of ["http://localhost:5500", "http://127.0.0.1:3000", "http://localhost"]) assert.equal((await post(origin)).status, 200, origin);
  const denied = await post("https://evil.example");
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("Access-Control-Allow-Origin"), "https://evil.example", "被拒绝也带 CORS 头，网页才读得到原因");
  assert.equal((await denied.json()).code, "origin");
  const created = await (await post("http://localhost:5500")).json();
  const check = await fetch(server.url + "/rooms/" + created.roomCode);
  assert.equal(check.status, 200);
  assert.equal((await check.json()).ok, true);
  const missing = await fetch(server.url + "/rooms/ABC234");
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "no_room");
});

test("连接失败时说清楚原因：房间不存在 / 连不上转发服务；连接中可以取消", async t => {
  const server = await createLocalRelayServer(); t.after(() => server.close());
  await assert.rejects(Relay.join({ url: server.url, roomCode: "ABC234", name: "路人", ...version, autoReconnect: false }), /房间不存在或已过期/);
  await assert.rejects(Relay.join({ url: "http://127.0.0.1:9", roomCode: "ABC234", name: "路人", ...version, autoReconnect: false, connectTimeout: 2000 }), /连不上转发服务/);
  const ctl = new AbortController(); ctl.abort();
  await assert.rejects(Relay.join({ url: server.url, roomCode: "ABC234", name: "路人", ...version, autoReconnect: false, signal: ctl.signal }), /已取消连接/);
});
