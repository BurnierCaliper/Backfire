// 联机跑团的长休结算（issue #216）：长休过一次以后，每个玩家包都带着同一份 rest（默认 4 人队约 1 KB），战斗包也一样。
// online-wire.js 对 rest 做和克制表一样的处理：没变就只带 restUnchanged，玩家端用上一次收到的还原；变了、重同步整份发
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const OnlineWire = require("../online-wire.js");
const V = require("../online-view.js");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));
const hero = (kit, name) => ({ kit, name, dead: false, watch: false, hp: [3, 14], hpMax: 14, mood: "一夜无梦，四肢重新充满了力气。", weapons: [{ name: name + "的武器", dur: [2, 6], max: 6 }] });
const rest = id => V.projectRest({ id, ok: true, hours: 8, from: { day: 1, clock: 1320 }, to: { day: 2, clock: 360 }, water: 2000, food: 4, exhaust: [1, 0], watch: "",
  heroes: [hero("ruby", "瑞比"), hero("yuito", "结人"), hero("hiaki", "绯秋"), hero("tou", "透")] });
const packet = (seq, r, type = "result") => ({ displayOnly: true, protocol: 1, type, seq, messages: [], publicLogs: [], rest: r });

test("长休结算没变就不重发：第一包整份发，之后只带 restUnchanged，玩家端还原成同一份；又长休了、重同步整份发", () => {
  const host = OnlineWire.create(), client = OnlineWire.create(), a = rest("rest-a"), b = rest("rest-b");
  // 还没长休：rest 是 null，照发 null（比 restUnchanged 标记还短）
  for (let seq = 1; seq <= 2; seq++) {
    const w = host.pack(packet(seq, null));
    assert.equal(w.rest, null); assert.equal("restUnchanged" in w, false);
    assert.equal(client.unpack(w).rest, null);
  }
  const first = host.pack(packet(3, a));
  assert.deepEqual(first.rest, a); assert.equal("restUnchanged" in first, false);
  assert.deepEqual(client.unpack(first).rest, a);
  for (let seq = 4; seq <= 6; seq++) {
    const w = host.pack(packet(seq, rest("rest-a")));
    assert.equal("rest" in w, false, "同一份结算不再整份发"); assert.equal(w.restUnchanged, true);
    const got = client.unpack(w);
    assert.deepEqual(got.rest, a); assert.equal("restUnchanged" in got, false);
  }
  const again = host.pack(packet(7, b));
  assert.deepEqual(again.rest, b, "又长休了一次：新的结算整份发"); assert.deepEqual(client.unpack(again).rest, b);
  const sync = host.pack(packet(8, b, "resync"));
  assert.deepEqual(sync.rest, b, "重同步一律整份发"); assert.equal("restUnchanged" in sync, false);
  client.reset(); assert.deepEqual(client.unpack(sync).rest, b);
  const after = host.pack(packet(9, b));
  assert.equal(after.restUnchanged, true); assert.deepEqual(client.unpack(after).rest, b);
});

test("没有基准的 restUnchanged 拒绝解码（逼出重同步）；标记不合法也拒绝，且不动上一份基准；已经打包过的包不能再打包", () => {
  const host = OnlineWire.create(), client = OnlineWire.create(), a = rest("rest-a");
  const first = host.pack(packet(1, a)), omitted = { ...first, restUnchanged: true }; delete omitted.rest;
  assert.throws(() => OnlineWire.create().unpack(omitted), /rest omission requires a baseline/);
  assert.throws(() => OnlineWire.create().unpack({ ...omitted, type: "resync" }), /rest omission requires a baseline/);
  const unpacked = { ...packet(1, null), restUnchanged: true }; delete unpacked.rest;
  assert.throws(() => OnlineWire.create().unpack(unpacked), /invalid rest metadata/, "没打包的包不能带标记");
  client.unpack(first);
  const second = host.pack(packet(2, a)); assert.equal(second.restUnchanged, true);
  for (const bad of [{ ...second, rest: a }, { ...second, restUnchanged: 1 }, { ...second, restUnchanged: false }]) assert.throws(() => client.unpack(bad), /invalid rest metadata/);
  assert.deepEqual(client.unpack(second).rest, a, "坏包没有动上一份基准");
  assert.throws(() => host.pack({ ...packet(3, a), restUnchanged: true }), /already packed/);
});

test("真实的 4 人长休结算（跑团默认队伍）：长休过一次以后，后面每包只多一个标记，不再每包整份重发", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "yuito", "hiaki", "tou"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  c.S.TRPG.active = true;
  c.trpgLongRest({ hours: 8, force: true });
  const report = plain(vm.runInContext("TRPG.lastRest", c));
  const projected = (seq, r) => V.projectPacket({ type: "result", protocol: 1, build: "b", seq, messages: [], publicLogs: [], rest: r }, { recipientId: "p1", gmId: "host" });
  const full = Buffer.byteLength(JSON.stringify(projected(1, report).rest));
  assert.ok(full > 600, "4 人的结算整份有好几百字节：" + full);
  const withRest = OnlineWire.create(), noRest = OnlineWire.create(), client = OnlineWire.create();
  assert.equal(client.unpack(withRest.pack(projected(1, report))).rest.id, report.id); noRest.pack(projected(1, null));
  for (let seq = 2; seq <= 4; seq++) {
    const w = withRest.pack(projected(seq, report)), base = noRest.pack(projected(seq, null));
    const extra = Buffer.byteLength(JSON.stringify(w)) - Buffer.byteLength(JSON.stringify(base));
    assert.ok(extra <= 16, `第 ${seq} 包因为长休多出 ${extra} 字节（整份 ${full} 字节）`);
    assert.deepEqual(client.unpack(w).rest, projected(seq, report).rest);
  }
});
