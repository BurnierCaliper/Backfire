"use strict";
// Coordinator contracts with actual commands / GM / hotseat rules. The transport
// and animation driver are deterministic adapters; browser end-to-end tests live
// in online-session-ui.test.js and exercise the real GAME presentation separately.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(saved = null) {
  const c = H.load(), ticks = [], sends = [], actions = [], errors = [];
  c.BattleSim.setup({ party: ["ruby", "kolt"], enemies: [{ id: "bandit_boss", lv: 2, zone: 2 }], seed: "D3-HOST-COORDINATOR" });
  let now = 100000, message, statusListener, status = { connected: true, hostOnline: true, paused: true, roster: [{ id: "host", role: "host", name: "主持人", online: true }, { id: "p2", role: "player", name: "玩家", online: true }] };
  const RealDate = Date; c.Date = class extends RealDate { static now() { return now; } };
  c.console = { error: error => errors.push(String(error)), log() {}, warn() {} };
  c.location = { search: "", reload() {} }; c.URLSearchParams = URLSearchParams;
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; }, body: { classList: { add() {} } } };
  c.addEventListener = () => {}; c.setInterval = fn => { ticks.push(fn); return ticks.length; }; c.queueMicrotask = queueMicrotask;
  c.setTimeout = setTimeout; c.clearTimeout = clearTimeout;
  const state = c.S.state;
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, level: 1, undo: [], onlineEditWindow: false,
    refresh() {}, disarm() {}, resumeHotseat() {}, onlineCheckpoint: () => plain({ state }),
    restoreOnline(snapshot) { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, plain(snapshot.state)); }, resumeOnline: async () => {},
    async actSystem(cmd, meta, context) {
      this.depth++;
      try { actions.push(plain(cmd)); const value = c.HotseatGame.system(cmd, context); c.OnlineGame.onActionSettled(cmd, value, [], meta); return value; }
      finally { this.depth--; }
    },
    async endTurn() { actions.push({ type: "endTurn" }); return c.HotseatGame.submit({ type: "endTurn" }); }
  };
  c.Screens = { current: () => "battle", is: screen => screen === "battle" };
  c.Commands.register("screen", () => ({}), { domain: "fixture" });
  c.TrpgFlow = { enter() {}, onlineCheckpoint: () => ({}), restoreOnline() {} };
  c.trpgReadSlots = () => [{ name: "已有团" }, null, null];
  c.HotseatUI = { mount() {} };
  c.OnlineView = { projectPacket: p => plain({ ...p, displayOnly: true }), projectLogs: rows => plain(rows) };
  c.OnlineActions = { create: () => ({ menu() { return {}; } }) };
  const ep = { identity: { id: "host", name: "主持人", role: "host", roomCode: "AAAAAA" },
    credentials: () => ({ roomCode: "AAAAAA", role: "host", token: "test", build: "backfire-d3-v1", protocol: 1 }),
    onMessage(fn) { message = fn; }, onStatus(fn) { statusListener = fn; fn(plain(status)); },
    send: async (packet, recipient) => { sends.push({ packet: plain(packet), recipient }); return { ok: true }; },
    async setReady() { status.paused = false; statusListener(plain(status)); }, close() {}, reconnect() {} };
  c.RelayTransport = { createHost: async () => ep, resumeHost: async () => ep };
  for (const file of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "gm-commands.js", "hotseat-game.js", "online-wire.js", "online-game.js"]) vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file });
  if (saved) { c.localStorage.setItem("backfire-online-v1", JSON.stringify(saved)); await c.OnlineGame.resume(); }
  else await c.OnlineGame.create({ slot: 0, name: "主持人", url: "https://fixture.invalid" });
  c.OnlineGame.start();
  const heroes = state.units.filter(u => u.isPlayer && !u.weaponOf), actor = heroes.find(u => u.kit === "kolt"), enemy = state.units.find(u => !u.isPlayer);
  c.OnlineGame.assign(Object.fromEntries(heroes.map(u => [u.id, u.id === actor.id ? "p2" : "host"])));
  return { c, state, actor, enemy, actions, sends, errors, ticks,
    time: ms => { now += ms; }, tick: () => ticks.forEach(fn => fn()),
    setStatus(patch) { Object.assign(status, patch); statusListener(plain(status)); },
    offlinePlayer() { status.roster[1].online = false; statusListener(plain(status)); },
    receive: packet => message(packet, "p2") };
}
function start(f) { f.c.HotseatGame.startCombat(); f.c.HotseatGame.beginRound(); }

test("host coordinator queues GM edits during animation and flushes at a safe enemy boundary", async () => {
  const f = await fixture(); start(f); f.c.GAME.depth = 1;
  const pending = f.c.OnlineGame.submit({ type: "gm.editUnit", actor: f.enemy.id, patch: { atk: 23 } });
  await delay(5); assert.equal(f.actions.length, 0); assert.notEqual(f.enemy.personalAtk, 23);
  await f.c.OnlineGame.flushGM(); const ack = await pending;
  assert.equal(ack.ok, true); assert.equal(f.enemy.personalAtk, 23); assert.equal(f.c.GAME.depth, 1); assert.equal(f.c.GAME.onlineEditWindow, false);
  assert.deepEqual(f.errors, []);
});

test("host coordinator toggling manual off releases the manual phase and requests remaining AI", async () => {
  const f = await fixture(); start(f); f.c.endPlayerTurn(); f.c.GAME.depth = 1;
  f.c.GAME.onlineEditWindow = true;
  await f.c.OnlineGame.submit({ type: "gm.setManual", actors: "all", enabled: true });
  f.c.GAME.onlineEditWindow = false;
  const waiting = f.c.OnlineGame.manualEnemyPhase();
  assert.equal(f.c.OnlineGame.getView().manualPhase, true);
  const ack = await f.c.OnlineGame.submit({ type: "gm.setManual", actors: "all", enabled: false });
  await waiting;
  assert.equal(ack.ok, true); assert.equal(f.c.OnlineGame.getView().manualPhase, false); assert.equal(f.c.OnlineGame.takeAIResume(), true); assert.equal(f.c.OnlineGame.takeAIResume(), false);
  assert.deepEqual(f.errors, []);
});

test("host disconnect freezes offline choice countdown; reconnect resumes then selects its conservative default", async () => {
  const f = await fixture(); f.offlinePlayer();
  let answer;
  f.c.HotseatGame.ownedChoice(f.actor, "开局刀头", [{ label: "电钻", value: "drill" }, { label: "酸液", value: "acid" }]).then(value => { answer = value; });
  f.tick(); const initial = f.c.OnlineGame.getView().offlineWait.deadline;
  f.time(30000); f.setStatus({ connected: false, hostOnline: false, paused: true });
  const failed = await f.c.OnlineGame.submit({ type: "gm.setWeather", weather: "sand" }); assert.equal(failed.ok, false);
  f.time(90000); f.tick(); await delay(0); assert.equal(answer, undefined);
  f.setStatus({ connected: true, hostOnline: true, paused: false });
  assert.equal(f.c.OnlineGame.getView().offlineWait.deadline, initial + 90000);
  f.time(29999); f.tick(); await delay(0); assert.equal(answer, undefined);
  f.time(2); f.tick(); await delay(0); assert.equal(answer, "drill"); assert.equal(f.c.HotseatGame.hasAsk(), false);
  assert.deepEqual(f.errors, []);
});

test("host coordinator rejects commands from a paused room before changing rules", async () => {
  const f = await fixture(); f.setStatus({ connected: false, hostOnline: false, paused: true });
  const before = plain(f.state);
  const ack = await f.c.OnlineGame.submit({ type: "gm.spawnEnemy", enemyId: "thug_knife", level: 2, zone: 2 });
  assert.equal(ack.ok, false); assert.deepEqual(plain(f.state), before); assert.equal(f.actions.length, 0);
});

test("message IDs remain unique beyond 300 retained messages in one millisecond and continue after host reload", async () => {
  const initial = await fixture();
  const saved = JSON.parse(initial.c.localStorage.getItem("backfire-online-v1"));
  saved.messageNo = 300;
  saved.messages = Array.from({ length: 300 }, (_, i) => ({ id: "msg-" + (i + 1), from: "host", to: "all", text: "earlier " + i, at: 100000 }));
  const live = await fixture(saved);
  for (const text of ["same millisecond one", "same millisecond two"]) assert.equal((await live.c.OnlineGame.submit({ type: "gm.msg", to: "all", text })).ok, true);
  const checkpoint = JSON.parse(live.c.localStorage.getItem("backfire-online-v1"));
  const messages = checkpoint.messages;
  assert.equal(live.c.OnlineGame.getView().messages.length, 300);
  assert.equal(messages.length, 302); assert.equal(new Set(messages.map(m => m.id)).size, 302);
  assert.deepEqual(plain(messages.slice(-2).map(m => m.id)), ["msg-301", "msg-302"]);
  assert.deepEqual(plain(messages.slice(-2).map(m => m.at)), [100000, 100000]);
  assert.equal(checkpoint.messageNo, 302);
  const recovered = await fixture(checkpoint);
  assert.equal((await recovered.c.OnlineGame.submit({ type: "gm.msg", to: "all", text: "after reload" })).ok, true);
  assert.equal(recovered.c.OnlineGame.getView().messages.at(-1).id, "msg-303");
  assert.equal(JSON.parse(recovered.c.localStorage.getItem("backfire-online-v1")).messageNo, 303);
  assert.deepEqual([...initial.errors, ...live.errors, ...recovered.errors], []);
});

test("offline owner of a battlefield-pick choice (Kolt blade swap) falls back to the first option after the wait", async () => {
  const f = await fixture(); f.offlinePlayer();
  const foe = f.state.units.find(u => !u.isPlayer);
  let answer;
  f.c.HotseatGame.ownedChoice(f.actor, "更换刀头", [{ label: "不切换", value: { swap: false } }, { label: "切换并打", value: { swap: true, targetId: foe && foe.id } }]).then(value => { answer = value; });
  assert.equal(f.c.HotseatGame.getView().ask.field, !!foe);
  f.tick(); f.time(59999); f.tick(); await delay(0); assert.equal(answer, undefined);
  f.time(2); f.tick(); await delay(0); assert.deepEqual(plain(answer), { swap: false }); assert.equal(f.c.HotseatGame.hasAsk(), false);
  assert.deepEqual(f.errors, []);
});
