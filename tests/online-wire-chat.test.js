// #340 第 8 条：联机小队聊天（view.chat，最近 300 条）以前每包整份带着；现在和 messages 一样只发新增的那一截
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Wire = require("../online-wire");
const View = require("../online-view");
const copy = value => JSON.parse(JSON.stringify(value));
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const chat = n => ({ id: "chat-" + n, operatorId: "p" + (n % 3), operatorName: "玩家" + (n % 3), text: "我们先去黑市看看有没有补给" + n, at: 1000 + n });
const chats = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => chat(from + i));
function packet(seq, list, changes = {}) {
  return { type: "result", displayOnly: true, schema: View.SCHEMA, seq, state: { displayOnly: true, units: [] },
    view: { playerId: "p1", phase: "exploration", chat: list }, messages: [], publicLogs: [], tape: [], ...changes };
}
function roundTrip(host, client, original) {
  const before = copy(original), encoded = host.pack(original), sent = copy(encoded), restored = client.unpack(sent);
  assert.deepEqual(restored, before, "玩家端拼回来的和整份发的一模一样"); assert.deepEqual(original, before, "不改动房主的包");
  return { encoded, restored };
}

test("第一包整份发；之后只发新增的聊天，带上总条数，玩家端拼回整份", () => {
  const host = Wire.create(), client = Wire.create();
  let r = roundTrip(host, client, packet(1, chats(1, 5)));
  assert.equal(r.encoded.view.chat.length, 5, "第一包整份");
  assert.equal(r.encoded.chatLength, 5);
  r = roundTrip(host, client, packet(2, chats(1, 6)));
  assert.deepEqual(r.encoded.view.chat, [chat(6)], "只发新的一条");
  assert.equal(r.encoded.chatLength, 6);
  r = roundTrip(host, client, packet(3, chats(1, 6)));
  assert.deepEqual(r.encoded.view.chat, [], "没有新聊天：一条都不带");
  assert.equal(r.restored.view.chat.length, 6);
});

test("满 300 条以后滚动：挤掉最旧的，照样只发新增的", () => {
  const host = Wire.create(), client = Wire.create();
  roundTrip(host, client, packet(1, chats(1, 300)));
  const r = roundTrip(host, client, packet(2, chats(3, 302)));
  assert.deepEqual(r.encoded.view.chat, [chat(301), chat(302)]);
  assert.equal(r.encoded.chatLength, 300);
  assert.equal(r.restored.view.chat[0].id, "chat-3");
});

test("300 条聊天以后的普通结算包：聊天不再占 40 KB", () => {
  const host = Wire.create(), client = Wire.create();
  const first = roundTrip(host, client, packet(1, chats(1, 300))).encoded;
  assert.ok(bytes(first.view.chat) > 30 * 1024, "整份 300 条有这么大：" + bytes(first.view.chat));
  const { encoded } = roundTrip(host, client, packet(2, chats(2, 301)));
  assert.ok(bytes(encoded) < 2 * 1024, `第二包 ${bytes(encoded)} 字节`);
  assert.ok(bytes(encoded.view.chat) < 200);
});

test("resync、重置、聊天整个换了：整份发", () => {
  const host = Wire.create(), client = Wire.create();
  roundTrip(host, client, packet(1, chats(1, 10)));
  let r = roundTrip(host, client, packet(2, chats(50, 52)));
  assert.equal(r.encoded.historyFull, true); assert.equal(r.encoded.view.chat.length, 3, "接不上：整份发");
  client.reset();
  r = roundTrip(host, client, packet(3, chats(50, 53), { type: "resync" }));
  assert.equal(r.encoded.view.chat.length, 4, "resync 整份发");
  const delta = host.pack(packet(4, chats(50, 54)));
  assert.deepEqual(delta.view.chat, [chat(54)]);
  assert.throws(() => Wire.create().unpack(copy(delta)), /baseline/, "新来的玩家端没有基准：解不开，要 resync");
  // 中间一包没带 view（或 view 里没有聊天）：基准不动，下一包照样接得上
  const noChat = packet(5, []); delete noChat.view.chat;
  assert.equal(client.unpack(copy(delta)).view.chat.length, 5); roundTrip(host, client, noChat);
  r = roundTrip(host, client, packet(6, chats(50, 55)));
  assert.deepEqual(r.encoded.view.chat, [chat(55)]);
  // 一开始的几包都没带聊天：第一次带的时候整份发（historyFull 照旧是 false），玩家端照样接得上
  const h2 = Wire.create(), c2 = Wire.create(), bare = packet(1, []); delete bare.view.chat;
  roundTrip(h2, c2, bare);
  r = roundTrip(h2, c2, packet(2, chats(1, 2)));
  assert.equal(r.encoded.historyFull, false); assert.equal(r.encoded.view.chat.length, 2);
  assert.deepEqual(roundTrip(h2, c2, packet(3, chats(1, 3))).encoded.view.chat, [chat(3)]);
});

test("旧版页面兼容：historyLengths 里不多出键；旧版房主（没有 chatLength）发来的聊天当整份", () => {
  const host = Wire.create();
  host.pack(packet(1, chats(1, 3)));
  const delta = host.pack(packet(2, chats(1, 4)));
  assert.deepEqual(Object.keys(delta.historyLengths).sort(), ["messages", "publicLogs"], "旧版玩家页面只认这两个键");
  const client = Wire.create(), old = Wire.create();
  // 旧版房主：打包了 messages 等，但聊天整份发、没有 chatLength
  const fromOld = p => { const w = old.pack(p); delete w.chatLength; w.view = copy(p.view); return w; };
  assert.equal(client.unpack(fromOld(packet(1, chats(1, 3)))).view.chat.length, 3);
  assert.equal(client.unpack(fromOld(packet(2, chats(1, 4)))).view.chat.length, 4);
});

test("坏的聊天元数据解不开，也不弄坏上一份基准", () => {
  const host = Wire.create(), client = Wire.create();
  roundTrip(host, client, packet(1, chats(1, 3)));
  const valid = host.pack(packet(2, chats(1, 4)));
  const noView = copy(valid); delete noView.view.chat;
  const cases = [
    { ...copy(valid), chatLength: 99 },
    { ...copy(valid), chatLength: -1 },
    { ...copy(valid), chatLength: "4" },
    { ...copy(valid), view: { ...copy(valid.view), chat: { 0: chat(4) } } },
    noView
  ];
  for (const bad of cases) assert.throws(() => client.unpack(bad), /OnlineWire/);
  const raw = packet(3, chats(1, 4)); raw.chatLength = 4;
  assert.throws(() => Wire.create().unpack(raw), /chat metadata without a format/, "没打包的包不能带 chatLength");
  assert.throws(() => host.pack(raw), /already packed/);
  assert.deepEqual(client.unpack(copy(valid)).view.chat, chats(1, 4), "坏包之后照样接得上");
});

test("每个玩家各自一份：主持人暗骰照旧只在房主本机，投影以后再打包", () => {
  const rows = [...chats(1, 4), { id: "chat-5", operatorId: "host", operatorName: "主持人", text: "暗骰 · 侦察 37", at: 1005, secret: true }];
  const raw = { type: "result", seq: 1, state: { units: [] }, view: { phase: "exploration", chat: rows }, messages: [], publicLogs: [], tape: [] };
  const host = Wire.create(), client = Wire.create();
  for (let seq = 1; seq <= 3; seq++) {
    raw.seq = seq; if (seq > 1) raw.view.chat = [...raw.view.chat, chat(10 + seq)];
    const safe = View.projectPacket(copy(raw), { recipientId: "p1", gmId: "host" });
    const { encoded, restored } = roundTrip(host, client, safe);
    assert.ok(!JSON.stringify(encoded).includes("暗骰") && !JSON.stringify(restored).includes("暗骰"));
    assert.equal(restored.view.chat.length, 4 + (seq - 1));
    if (seq > 1) assert.equal(encoded.view.chat.length, 1);
  }
});
