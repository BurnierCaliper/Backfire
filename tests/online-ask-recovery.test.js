"use strict";
// Real online coordinator + HotseatGame checkpoint/reconstruction path. The
// GAME resolver is driven explicitly here; browser animation is not simulated.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const H = require("./headless");
const json = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
const KEY = "backfire-online-v1";

async function fixture({ now = 100000, saved } = {}) {
  const c = H.load(), intervals = [], events = new Map(), errors = [];
  c.BattleSim.setup({ party: ["ruby", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "ASK-RECOVERY" });
  const state = c.S.state, RealDate = Date;
  c.Date = class extends RealDate { static now() { return now; } };
  c.console = { error: error => errors.push(String(error)), log() {}, warn() {} };
  c.location = { search: "", reload() {} }; c.URLSearchParams = URLSearchParams;
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; }, body: { classList: { add() {} } } };
  c.addEventListener = (name, fn) => { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); };
  c.setInterval = fn => { intervals.push(fn); return intervals.length; }; c.setTimeout = setTimeout; c.clearTimeout = clearTimeout; c.queueMicrotask = queueMicrotask;
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, level: 1, undo: [], refresh() {}, disarm() {}, resumeHotseat() {},
    onlineCheckpoint: () => json({ state }), resumeOnline: async () => {},
    restoreOnline(value) { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, json(value.state)); }
  };
  c.Screens = { current: () => "trpg", is: screen => screen === "trpg" };
  c.Commands.register("screen", () => {});
  c.TrpgFlow = { enter() {}, onlineCheckpoint: () => ({}), restoreOnline() {} };
  c.trpgReadSlots = () => [{ name: "询问恢复" }, null, null]; c.HotseatUI = { mount() {} };
  c.OnlineActions = { create: () => ({ menu() { return {}; } }) };
  let statusListener;
  const status = { connected: true, hostOnline: true, paused: true, roster: [
    { id: "host", name: "主持人", role: "host", online: true },
    { id: "p2", name: "玩家二", role: "player", online: true }
  ] };
  const ep = { identity: { id: "host", name: "主持人", role: "host", roomCode: "ABC234" },
    credentials: () => ({ roomCode: "ABC234", role: "host", token: "fixture", build: "backfire-d3-v1", protocol: 1 }),
    onMessage() {}, onStatus(fn) { statusListener = fn; fn(json(status)); }, send: async () => ({ ok: true }),
    async setReady() { status.paused = false; statusListener(json(status)); }, close() {}, reconnect() {}
  };
  c.RelayTransport = { createHost: async () => ep, resumeHost: async () => ep };
  for (const file of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "gm-commands.js", "hotseat-game.js", "online-view.js", "online-wire.js", "online-game.js"]) {
    vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file });
  }
  if (saved) { c.localStorage.setItem(KEY, JSON.stringify(saved)); await c.OnlineGame.resume(); }
  else {
    await c.OnlineGame.create({ slot: 0, name: "主持人", url: "https://fixture.invalid" });
    const units = state.units.filter(u => u.isPlayer && !u.weaponOf);
    c.OnlineGame.assign(Object.fromEntries(units.map((u, i) => [u.id, i ? "p2" : "host"])));
  }
  await flush();
  const units = state.units.filter(u => u.isPlayer && !u.weaponOf), target = state.units.find(u => !u.isPlayer);
  const job = { seq: 77, targetId: target.id };
  function ask({ kind = "assist", seq = job.seq, targetId = job.targetId } = {}) {
    return c.HotseatGame.requestAsk(kind, "测试协助", units.map(u => ({ helper: u.id, label: u.name })), () => units, { seq, targetId });
  }
  return { c, units, target, job, errors, ask,
    advance(ms) { now += ms; }, now: () => now,
    tick() { intervals.forEach(fn => fn()); },
    status(patch) { Object.assign(status, patch); statusListener(json(status)); },
    save() { for (const fn of events.get("pagehide") || []) fn(); return JSON.parse(c.localStorage.getItem(KEY)); },
    answer(id, askId, helper = null) { return c.HotseatGame.receiveFrom(id, { type: "answer", askId, helper, extra: {} }); }
  };
}

test("ask reload keeps the remaining seven seconds, rejects old IDs and preserves a player's earlier decline", async () => {
  const f = await fixture(); f.ask();
  const old = f.c.HotseatGame.getView().ask;
  assert.equal(f.answer("p2", old.id).ok, true);
  f.advance(13000);
  const saved = f.save(); assert.equal(saved.hotseat.askRemainingMs, 7000);
  const g = await fixture({ now: 900000, saved });
  let result; g.ask().then(value => { result = value; });
  const reopened = g.c.HotseatGame.getView().ask;
  assert.notEqual(reopened.id, old.id); assert.equal(reopened.deadline - g.now(), 7000);
  assert.equal(g.c.HotseatGame.getViewFor("p2").ask.declined, true);
  assert.deepEqual(json(g.c.HotseatGame.getViewFor("p2").ask.waitingNames), ["主持人"]);
  assert.equal(g.answer("p2", reopened.id, g.units[1].id).ok, false);
  assert.equal(g.answer("host", old.id, g.units[0].id).ok, false);
  g.advance(6999); g.tick(); await flush(); assert.equal(result, undefined);
  g.advance(1); g.tick(); await flush();
  assert.equal(result.reason, "timeout"); assert.equal(result.unitId, null); assert.equal(g.c.HotseatGame.hasAsk(), false);
  assert.deepEqual(g.errors, []);
});

test("an expired persisted ask resolves conservatively on reconstruction without leaving a pending promise", async () => {
  const f = await fixture(); f.ask(); f.advance(20000);
  const saved = f.save(); assert.equal(saved.hotseat.askRemainingMs, 0);
  const g = await fixture({ now: 900000, saved });
  let result; g.ask().then(value => { result = value; });
  await flush();
  assert.ok(result, "zero remaining time must resolve without waiting for another interval or user reply");
  assert.equal(result.reason, "timeout"); assert.equal(result.unitId, null); assert.equal(g.c.HotseatGame.hasAsk(), false);
  assert.deepEqual(g.errors, []);
});

test("a different reaction job gets its own twenty seconds and does not inherit old declines", async () => {
  const f = await fixture(); f.ask(); const old = f.c.HotseatGame.getView().ask;
  f.answer("p2", old.id); f.advance(13000);
  const g = await fixture({ now: 900000, saved: f.save() });
  const pending = g.ask({ seq: 78 }), current = g.c.HotseatGame.getView().ask;
  assert.equal(current.deadline - g.now(), 20000);
  assert.equal(g.c.HotseatGame.getViewFor("p2").ask.declined, false);
  assert.equal(g.answer("p2", current.id, g.units[1].id).ok, true);
  const result = await pending; assert.equal(result.unitId, g.units[1].id); assert.equal(result.reason, "accepted");
  assert.deepEqual(g.errors, []);
});

test("saving after a long host disconnection freezes the ask at its disconnect-time remainder", async () => {
  const f = await fixture(); f.ask(); f.advance(13000);
  f.status({ connected: false, hostOnline: false, paused: true });
  f.advance(90000); f.tick();
  const saved = f.save();
  assert.equal(saved.hotseat.askRemainingMs, 7000, "pagehide must use pausedAt, not wall-clock time spent offline");
  const g = await fixture({ now: 900000, saved });
  const pending = g.ask(), current = g.c.HotseatGame.getView().ask;
  assert.equal(current.deadline - g.now(), 7000);
  assert.equal(g.answer("host", current.id, g.units[0].id).ok, true);
  assert.equal((await pending).unitId, g.units[0].id);
  assert.deepEqual(g.errors, []);
});
