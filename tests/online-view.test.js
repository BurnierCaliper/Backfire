"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../online-view");
const H = require("./headless");
const player = { recipientId: "p1", gmId: "host" };
const gm = { recipientId: "host", gmId: "host" };
const copy = v => JSON.parse(JSON.stringify(v));
function unit(id = "u1") {
  return { id, kit: "ruby", name: "瑞比", isPlayer: true, zone: 1, level: 3, atk: 12, def: 6, defMax: 7, ap: 2, apMax: 2, bonus: 1, bonusMax: 1,
    layers: [{ type: "shield", current: 9, max: 20 }, { type: "flesh", current: 28, max: 30 }],
    shp: 732911, shpMax: 827319, baseShp: 617392, upOnShp: false,
    note: "SECRET-BACKSTAGE-NOTE", statuses: { burn: 2, weak: true, secret: "SECRET-STATUS" },
    resources: { nano: 50, prepared: true, shp: 321987, hiddenFutureField: "SECRET-RESOURCE", bossPack: { notes: "SECRET-PACK" } },
    status: "坚毅 732911", res: "SHP 732911", gm: { hidden: "SECRET-UNIT" } };
}
function fixture() {
  const u = unit();
  return { type: "result", protocol: 1, build: "backfire-d3", seq: 17, screen: "battle", roomCode: "ABC123", hostName: "主持人",
    state: { units: [u], props: [{ id: "barrel", name: "爆炸桶", kind: "boom", hp: 10, maxHp: 10, zone: 2, backstage: "SECRET-PROP" }],
      fields: { 1: { fire: 2, fireOn: true, secret: "SECRET-FIELD" } }, gaps: { "1-2": { type: "wall", hp: 8, maxHp: 10, private: "SECRET-GAP" } },
      combatStarted: true, combatPhase: "player", turnNo: 3, zoneMode: 2, weather: "sand", sandDir: "12", weatherLock: "SECRET-LOCK",
      logPages: [{ lines: ["坚毅 732911", "SECRET-UNMARKED-RAW-LOG"] }], history: [{ units: [u] }],
      battleStats: { u1: { taken: 732911 } }, privateHistory: [{ text: "SECRET-STATE-HISTORY" }], reconnectToken: "SECRET-TOKEN" },
    result: { accepted: true, roundDone: false, notes: ["SHP 732911", "SECRET-RESULT"], state: { units: [u] }, packet: { privateHistory: "SECRET-NESTED-RETURN" } },
    tape: [{ type: "pop", unitId: "u1", kind: "dmg", value: 10, text: "SECRET-POP-TEXT", snap: [u] },
      { type: "log", text: "坚毅 -732911" }, { type: "log", text: "SECRET-UNMARKED-LOG" }, { type: "futureEvent", data: { hidden: "SECRET-UNKNOWN-EVENT" } }],
    view: { mode: "trpg", phase: "acting", playerId: "p2", hostId: "host", canConfigure: true, canDisable: true,
      players: [{ id: "p1", name: "甲", online: true, token: "SECRET-SEAT-TOKEN" }, { id: "p2", name: "乙" }],
      units: [{ id: "u1", name: "瑞比", owner: "p1", gmData: "SECRET-ROSTER" }, { id: "u2", name: "灯", owner: "p2" }],
      order: [{ actor: "u1", name: "瑞比", owner: "p1", locked: true, done: false }, null], currentUnitId: "u1", confirmed: ["p1"],
      closedAsk: { extra: { hidden: "SECRET-CLOSED" } }, privateHistory: "SECRET-VIEW-HISTORY" },
    messages: [{ id: "all", from: "host", to: "all", text: "前方有一道门", at: 1 }, { id: "one", from: "host", to: "p1", text: "你的线索", at: 2 },
      { id: "two", from: "host", to: "p2", text: "SECRET-OTHER-DM", at: 3 }, { id: "reply1", from: "p1", to: "host", text: "我的回复", at: 4 },
      { id: "reply2", from: "p2", to: "host", text: "SECRET-OTHER-REPLY", at: 5 }],
    privateHistory: { byPlayer: { p2: ["SECRET-TOP-HISTORY"] } },
    publicLogs: [{ kind: "action", actorName: "瑞比", actionName: "普通攻击", seq: 1 }, { kind: "phase", phase: "player", turn: 3, seq: 2 }]
  };
}
function noSecrets(value) {
  const wire = JSON.stringify(value);
  assert.doesNotMatch(wire, /SECRET|732911|827319|617392|321987|shp|坚毅|backstage|privateHistory|reconnectToken/i);
}

test("player packets are public display DTOs across state, result, tape, logs and nested histories", () => {
  const source = fixture(), before = copy(source), out = V.projectPacket(source, player);
  noSecrets(out); assert.deepEqual(source, before);
  assert.equal(out.schema, V.SCHEMA); assert.equal(out.displayOnly, true);
  assert.equal(out.state.displayOnly, true); assert.equal(out.state.units[0].ap, 2);
  assert.deepEqual(out.state.units[0].layers, source.state.units[0].layers);
  assert.deepEqual(out.state.units[0].resources, { nano: 50, prepared: true });
  assert.deepEqual(out.state.units[0].statuses, { burn: 2, weak: true });
  assert.equal(out.state.sandDir, "12"); assert.equal(out.state.weatherLocked, true);
  assert.equal(out.state.props[0].hp, 10); assert.equal(out.state.gaps["1-2"].hp, 8);
  assert.deepEqual(out.result, { accepted: true, roundDone: false });
  assert.equal(out.tape.length, 1); assert.equal(out.tape[0].value, 10);
  assert.equal(out.view.playerId, "p1"); assert.equal(out.view.canConfigure, false); assert.equal(out.view.canDisable, false);
  assert.equal(out.view.order[1], null); assert.equal(out.publicLogs[0].text, "瑞比 · 普通攻击");
});

test("manual enemy phase, network identity and offline wait remain public while added metadata stays private", () => {
  const source = fixture();
  source.manualPhase = true; source.view.network = true;
  source.offlineWait = { actor: "u1", owner: "p1", name: "瑞比", deadline: 12345, secret: "SECRET-WAIT" };
  source.state.props.push(...["ironwall", "scrapwall", "dome"].map(kind => ({ id: kind, kind, zone: 1, hp: 12 })));
  source.state.fields[1].ruinMax = 30; source.state.fields[1].fieldLock = "SECRET-LOCK";
  const out = V.projectPacket(source, player); noSecrets(out);
  assert.equal(out.manualPhase, true); assert.equal(out.view.network, true);
  assert.deepEqual(out.offlineWait, { actor: "u1", owner: "p1", name: "瑞比", deadline: 12345 });
  assert.deepEqual(out.state.props.slice(1).map(p => p.kind), ["ironwall", "scrapwall", "dome"]);
  assert.equal(out.state.fields[1].ruinMax, 30); assert.equal(out.state.fields[1].fieldLocked, true);
  source.offlineWait = null; assert.equal(V.projectPacket(source, player).offlineWait, null);
});

test("GM removal, destruction and manual control summaries preserve semantic differences without trusting notes", () => {
  const logs = V.projectLogs(["remove", "kill", "propRemove", "propDestroy", "manualOn", "manualOff"].map(action => ({ kind: "gm", action, unitName: "狂徒", propName: "爆炸桶", summary: "SECRET-NOTE", data: { shp: 921321 } })));
  assert.match(logs[0].text, /移出.*不计击杀/); assert.match(logs[1].text, /击杀了狂徒/);
  assert.match(logs[2].text, /移除.*未触发摧毁/); assert.match(logs[3].text, /摧毁了爆炸桶/);
  assert.match(logs[4].text, /开启.*手动控制/); assert.match(logs[5].text, /关闭.*手动控制/);
  noSecrets(logs);
  assert.doesNotMatch(JSON.stringify(V.projectLogs([{ kind: "gm", action: "kill", unitName: "坚毅 123456" }])), /123456|坚毅/);
});

test("GM gets full independent data while each player receives only its own directed message history", () => {
  const source = fixture(), full = V.projectPacket(source, gm);
  assert.deepEqual(full, source); assert.notEqual(full, source); assert.notEqual(full.state.units[0], source.state.units[0]);
  assert.equal(full.state.units[0].shp, 732911);
  const first = V.projectPacket(source, player), second = V.projectPacket(source, { recipientId: "p2", gmId: "host" });
  assert.deepEqual(first.messages.map(m => m.id), ["all", "one", "reply1"]);
  assert.deepEqual(second.messages.map(m => m.id), ["all", "two", "reply2"]);
  assert.equal(first.messages[0].private, false); assert.equal(first.messages[1].private, true);
  first.state.units[0].layers[0].current = -500; full.state.units[0].shp = 0;
  assert.equal(source.state.units[0].layers[0].current, 9); assert.equal(source.state.units[0].shp, 732911);
  assert.equal(second.state.units[0].layers[0].current, 9);
  const nested = V.projectPacket({ type: "resync", view: { messages: source.messages, hidden: { history: source.messages } }, messages: source.messages }, player);
  assert.deepEqual(nested.messages, nested.view.messages); noSecrets(nested);
  assert.deepEqual(V.projectMessages(source.messages, gm), source.messages);
});

test("private messages require explicit allowed routing and do not carry nested data or hidden-life text", () => {
  const messages = [null, [], { from: "p2", to: "p1", text: "SECRET-UNAUTHORIZED-PEER" },
    { from: "p2", to: "all", text: "SECRET-NONHOST-BROADCAST" }, { from: "host", text: "SECRET-MISSING-RECIPIENT" },
    { from: "host", to: "p1", text: "ＳＨＰ 732911" }, { from: "host", to: "p1", text: "你看见一道门", history: fixture().messages, token: "SECRET-TOKEN" }];
  const out = V.projectMessages(messages, player); noSecrets(out);
  assert.deepEqual(out, [{ from: "host", to: "p1", text: "你看见一道门", private: true }]);
});

test("recipient filtering precedes the live 300-message window and cannot be displaced by other private traffic", () => {
  const messages = [{ id: "mine", from: "host", to: "p1", text: "保留给我的线索", at: 1 },
    ...Array.from({ length: 299 }, (_, i) => ({ id: "other" + i, from: "host", to: "p2", text: "OTHER_PRIVATE_" + i, at: i + 2 }))];
  const out = V.projectMessages(messages, player);
  assert.equal(out.length, 1); assert.equal(out[0].id, "mine"); assert.ok(!JSON.stringify(out).includes("OTHER_PRIVATE"));
  const publicHistory = Array.from({ length: 350 }, (_, i) => ({ id: "public" + i, from: "host", to: "all", text: "公告 " + i }));
  const bounded = V.projectMessages(publicHistory, player); assert.equal(bounded.length, 300); assert.equal(bounded[0].id, "public50");
});

test("result, ack, resync, lobby, waiting and messages envelopes all apply the same outbound boundary", () => {
  for (const type of ["result", "ack", "resync", "lobby", "waiting", "gmMsg", "gmReply", "joined"]) {
    const source = fixture(); source.type = type; source.error = "SECRET-ERROR 732911"; source.ok = false;
    const out = V.projectPacket(source, player); noSecrets(out); assert.equal(out.type, type);
    assert.match(out.error, /操作未生效/);
  }
});

test("HP snapshots and damage effects cannot reveal the hidden life pool or raw popup text", () => {
  const regular = unit(), hidden = { ...unit("u2"), dying: false, upOnShp: true }, dead = { ...unit("u3"), dead: true };
  hidden.layers.forEach(l => { l.current = 0; });
  const tape = [
    { type: "pop", unitId: "u1", kind: "dmg", value: 7, snap: [regular], text: "SHP 732911" },
    { type: "pop", unitId: "u2", kind: "dmg", value: 732911, snap: [hidden] },
    { type: "pop", unitId: "u2", kind: "heal", value: 827319 },
    { type: "pop", unitId: "u3", kind: "dmg", value: 617392, snap: [dead] },
    { type: "pop", unitId: "missing", kind: "dmg", value: 321987 },
    { type: "pop", unitId: "u2", kind: "break", value: 3, text: "失衡", snap: [hidden] }
  ];
  const result = V.projectTape(tape, { state: { units: [regular, hidden, dead] } });
  noSecrets(result); assert.equal(result[0].value, 7);
  for (const index of [1, 2, 3, 4]) assert.equal(Object.hasOwn(result[index], "value"), false);
  assert.equal(result[5].value, 3); assert.equal(result[5].text, "失衡");
  assert.equal(result[1].snap[0].layers[0].current, 0);
  const storedTape = [{ type: "pop", kind: "dmg", unitId: "u2", value: 732911 }];
  const ack = V.projectPacket({ type: "ack", tape: storedTape }, { ...player, state: { units: [hidden] } });
  noSecrets(ack); assert.equal(ack.tape[0].value, undefined);
});

test("unknown logs and errors never use free-form notes as public summaries", () => {
  const logs = V.projectLogs([
    "SECRET-RAW", { text: "SECRET-RAW", public: true }, { kind: "action", actorName: "坚毅732911", actionName: "泄露" },
    { kind: "gm", summary: "SECRET-UNKNOWN-SUMMARY" }, { kind: "gm", summary: "主持人更新了天气" },
    { kind: "gm", summary: "主持人更新了天气", silent: true },
    { kind: "gm", action: "spawn", unitName: "狂徒", zone: 2, level: 3 },
    { kind: "phase", phase: "SECRET-PHASE", text: "SECRET-PHASE" }
  ]);
  noSecrets(logs); assert.equal(logs.length, 5);
  assert.equal(logs[1].text, "主持人调整了战场"); assert.equal(logs[2].text, "主持人更新了天气");
  assert.equal(logs[3].text, "主持人在 2 区加入 狂徒 Lv3");
  assert.match(V.safeError("不是你的角色"), /其他玩家/); assert.match(V.safeError("还没轮到这个单位"), /还没轮到/);
  assert.equal(V.safeError("不合法的分步选择 SECRET-DETAIL"), "目标或分步选择已失效");
  assert.match(V.safeError("未知内部内容 918237"), /操作未生效/);
  assert.equal(V.safeText("ＳＨＰ 732911"), null); assert.equal(V.safeText("S\u200bH\u200bP 732911"), null);
});

test("ask projection repeats ownership checks and rejects hidden extras and stale cached recipient views", () => {
  const source = fixture(); source.view.ask = { id: "ask-1", kind: "assist", title: "选择协助者", deadline: 12345, eligible: true, waitingNames: ["甲", "乙"],
    options: [{ helper: "u1", label: "瑞比", extra: { blade: "niu" } }, { helper: "u2", label: "SECRET-OTHER-CHOICE", extra: { index: 2 } },
      { helper: "u1", label: "不可信选项", extra: { snapshot: { shp: 732911 } } }] };
  const out = V.projectPacket(source, player); noSecrets(out);
  assert.deepEqual(out.view.ask.options, [{ helper: "u1", label: "瑞比", extra: { blade: "niu" } }]);
  assert.equal(out.view.ask.eligible, true);
  const stranger = V.projectPacket(source, { recipientId: "p3", gmId: "host" });
  assert.equal(stranger.view.ask.eligible, false); assert.deepEqual(stranger.view.ask.options, []);
  assert.equal(stranger.view.ask.deadline, 12345);
});

test("action menus retain only public JSON choices and known command fields", () => {
  const source = { type: "actionOptions", requestId: 4, actor: "u1", skill: "ruby_aa", privateHistory: fixture().messages,
    choices: { kind: "choice", key: "mode", title: "选择攻击", options: [{ value: "far", label: "远距离" }, { value: { target: "u2", dest: 2 }, label: "组合选项" },
      { value: { notes: "SECRET-NESTED" }, label: "隐藏" }, { value: { target: { shp: 732911 } }, label: "嵌套" },
      { value: "SECRET-SHP-732911", label: "敏感值" }], command: { type: "skill", actor: "u1", skill: "ruby_aa", target: "u2", picks: { mode: "far" } } } };
  const out = V.projectPacket(source, player); noSecrets(out);
  assert.equal(out.choices.options.length, 2);
  assert.deepEqual(out.choices.command, source.choices.command);
  source.choices.command.state = fixture().state;
  assert.equal(V.projectActionMenu(source).choices.command, undefined);
  source.choices.command = { type: "skill", actor: "u1", skill: "ruby_aa", picks: { target: "u2", shp: 732911 } };
  assert.equal(V.projectActionMenu(source).choices.command, undefined);
  assert.equal(V.projectActionMenu({ command: { type: "gm.editUnit", actor: "u1" } }).command, undefined);
});

test("null, arrays, future fields and non-data accessors fail closed without touching authority", () => {
  for (const value of [null, [], "text", 3]) assert.equal(V.projectPacket(value, player), null);
  assert.deepEqual(V.projectTape(null), []); assert.deepEqual(V.projectMessages(null, player), []);
  assert.equal(V.projectUnit(null), null); assert.equal(V.projectState([]), null);
  const source = { type: "result", state: { units: [null, [], unit()] }, result: [fixture()], future: [fixture()] };
  let calls = 0; Object.defineProperty(source, "messages", { enumerable: true, get() { calls++; return fixture().messages; } });
  const out = V.projectPacket(source, player); noSecrets(out); assert.equal(calls, 0);
  assert.equal(out.state.units.length, 1); assert.equal(out.result, null); assert.deepEqual(out.messages, []);
  assert.throws(() => V.projectPacket(fixture()), /identity|recipient/i);
  assert.throws(() => V.projectPacket(fixture(), { recipientId: "p1", gmId: null }), /identity|recipient/i);
});

test("real battle authority and RNG are unchanged; the exported display requires no rule helpers", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "hiaki"], enemies: [{ id: "sand_aggregate", lv: 10, zone: 2 }], seed: "D3-VIEW" });
  c.startCombat(); const before = copy(c.S.state);
  c.S.state.units[0].shp = 732911;
  const seeded = copy(c.S.state), out = V.projectPacket({ type: "resync", state: c.S.state, result: c.S.state, tape: [{ type: "log", text: "SHP 732911" }] }, player);
  assert.deepEqual(copy(c.S.state), seeded); noSecrets(out);
  assert.equal(out.state.units[0].name, before.units[0].name);
  assert.equal(out.state.units.length, before.units.length);
  for (const u of out.state.units) assert.ok(u.layers.every(l => ["flesh", "armor", "shield", "sand", "spirit"].includes(l.type)));
  assert.equal(out.state.units[0].shp, undefined);
});

test("public XP, currency and bag use only actual values and safe catalog names", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "hiaki"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "D3-SUPPLIES" });
  c.S.state.units[0].xp = 127; c.S.state.kuizhi = 321; c.setLedgerWater(1800); c.bagAdd("food_can", 3); c.bagAdd("stim", 2);
  c.S.state.bag.privateHistory = "SECRET-BAG";
  const before = copy(c.S.state), out = V.projectPacket({ type: "resync", state: c.S.state }, { ...player, itemCatalog: c.S.ITEM_CATALOG });
  noSecrets(out); assert.deepEqual(copy(c.S.state), before);
  assert.equal(out.state.units[0].xp, 127); assert.equal(out.state.kuizhi, 321); assert.equal(out.state.bag.water, 1800);
  assert.deepEqual(out.state.bag.items.find(x => x.id === "food_can"), { id: "food_can", name: "罐头食品", qty: 3 });
  assert.deepEqual(out.state.bag.items.find(x => x.id === "stim"), { id: "stim", name: "强心注射剂", qty: 2 });
  assert.ok(out.state.bag.items.every(x => Object.keys(x).sort().join() === "id,name,qty"));
  out.state.bag.items[0].qty = 999; assert.deepEqual(copy(c.S.state), before);
});

test("history pages retain recipient filtering and expose only pagination and fixed system notices", () => {
  const source = { type: "messageHistory", requestId: 3, hasMore: true, messages: fixture().messages,
    systemNotice: "房主遇到处理错误，请等待主持人确认后继续", privateHistory: "SECRET-HISTORY", cursor: "SECRET-CURSOR" };
  const out = V.projectPacket(source, player); noSecrets(out);
  assert.equal(out.hasMore, true); assert.equal(out.systemNotice, source.systemNotice);
  assert.deepEqual(out.messages.map(m => m.id), ["all", "one", "reply1"]);
  source.systemNotice = "SHP 732911"; assert.equal(V.projectPacket(source, player).systemNotice, undefined);
  source.systemNotice = "Private unexpected exception details"; assert.equal(V.projectPacket(source, player).systemNotice, undefined);
  source.messages = Array.from({ length: 150 }, (_, i) => ({ id: "m" + i, from: "host", to: "all", text: "消息" }));
  assert.equal(V.projectPacket(source, player).messages.length, 100);
  assert.equal(V.projectPacket({ type: "result", hasMore: true }, player).hasMore, undefined);
});

test("battle results include the actual D grade and drop private settlement notes", () => {
  const out = V.projectPacket({ type: "result", result: { outcome: "win", grade: { grade: "D", score: 0, xpMult: 0.8, notes: "SECRET-GRADE" }, notes: "SECRET-SETTLEMENT" } }, player);
  noSecrets(out); assert.deepEqual(out.result, { outcome: "win", grade: { score: 0, xpMult: 0.8, grade: "D" } });
});

test("角色资料 / 武器 / 背包请求：递归去掉坚毅生命字段，背包说明里有坚毅的整条不发", () => {
  const V = require("../online-view");
  const packet = { type: "sheetData", requestId: 9, protocol: 1, build: "b",
    sheets: [{ kit: "ruby", name: "瑞比", shp: 11, shpMax: 11, layers: [{ type: "flesh", cur: 12, max: 12 }], weapons: [{ kit: "mint", shp: 3, atk: 7 }], passives: [{ name: "纳米科技", text: "规则说明" }] }],
    armory: [{ kit: "ruby", weapons: [{ kit: "mint", atk: 7, upOnShp: true }] }],
    bag: { water: 500, kuizhi: 3, items: [{ id: "medkit", name: "简易医疗包", qty: 2, hint: "治疗一名友方 1d4+6 内层生命" }, { id: "stim", name: "强心注射剂", qty: 1, hint: "自身恢复 16 生命，失去 6 坚毅生命" }, { id: "x", name: "空", qty: 0 }] } };
  const out = V.projectPacket(packet, { recipientId: "p1", gmId: "host" });
  const json = JSON.stringify(out);
  assert.ok(!/shp/i.test(json), json);
  assert.equal(out.sheets[0].name, "瑞比");
  assert.equal(out.sheets[0].weapons[0].atk, 7);
  assert.equal(out.sheets[0].passives[0].text, "规则说明");
  assert.equal(out.requestId, 9);
  assert.deepEqual(JSON.parse(JSON.stringify(out.bag)), { water: 500, kuizhi: 3, items: [{ id: "medkit", name: "简易医疗包", qty: 2, hint: "治疗一名友方 1d4+6 内层生命" }, { id: "stim", name: "强心注射剂", qty: 1 }] });
});
