"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));
function load(c, name) { vm.runInContext(fs.readFileSync(path.join(H.ROOT, name), "utf8"), c, { filename: name }); }
function fixture({ host = true } = {}) {
  const c = H.load(), queued = [], diffs = [], errors = [], token = {};
  c.BattleSim.setup({ party: ["ruby", "helu"], enemies: [{ id: "thug_knife", lv: 2, zone: 2 }], seed: "D3-LEGACY" });
  const state = c.S.state;
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, level: 1, undo: [], disarm() {}, refresh() {}, resumeHotseat() {} };
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  c.location = { search: "" }; c.URLSearchParams = URLSearchParams; c.addEventListener = () => {}; c.setInterval = () => 0;
  c.OnlineGame = {
    isHost: () => host, isPaused: () => false,
    queueHostEdit(fn) { return new Promise((resolve, reject) => queued.push(() => { try { resolve(fn()); } catch (error) { errors.push(error); reject(error); } })); },
    legacyAddedEnemies(before) {
      const added = state.units.filter(u => !u.isPlayer && !before.includes(u.id)); diffs.push(added.map(u => u.id));
      const saved = c.GMCommands.snapshot();
      for (const u of added) saved.units.push({ id: u.id, eligibleEnemyRound: state.combatStarted ? state.turnNo + (state.combatPhase === "enemy" ? 1 : 0) : 0 });
      c.GMCommands.restore(saved, token);
    }
  };
  for (const file of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "gm-commands.js", "hotseat-game.js", "online-legacy.js"]) load(c, file);
  c.GMCommands.configure({ requireHost: context => context === token });
  const players = [{ id: "host", name: "主持人", gm: true }, { id: "p2", name: "玩家" }];
  assert.equal(c.HotseatGame.enableOnline({ mode: "trpg", players, assignments: {} }).ok, true);
  return { c, state, queued, diffs, errors, send: command => c.Commands.dispatch(plain(command)), flush() { while (queued.length) queued.shift()(); } };
}

test("command interceptors support explicit priority while default registration remains appended", () => {
  const c = H.load(), seen = [];
  c.Commands.register("priorityFixture", () => { seen.push("rule"); return 7; });
  c.Commands.intercept((cmd, ctx, next) => { seen.push("one"); return next(); });
  c.Commands.intercept((cmd, ctx, next) => { seen.push("two"); return next(); });
  const remove = c.Commands.intercept((cmd, ctx, next) => { seen.push("first"); return next(); }, { first: true });
  assert.equal(c.Commands.dispatch({ type: "priorityFixture" }), 7); assert.deepEqual(seen, ["first", "one", "two", "rule"]);
  remove(); seen.length = 0; c.Commands.dispatch({ type: "priorityFixture" }); assert.deepEqual(seen, ["one", "two", "rule"]);
  assert.throws(() => c.Commands.intercept(() => {}, { first: "yes" }), /boolean/);
});

test("a queued dispatch resumes its original interceptor chain despite later registrations", () => {
  const c = H.load(), seen = []; let resume;
  c.Commands.register("pendingFixture", () => seen.push("rule"));
  c.Commands.intercept((cmd, ctx, next) => { seen.push("original"); return next(); });
  const off = c.Commands.intercept((cmd, ctx, next) => { resume = next; }, { first: true });
  c.Commands.dispatch({ type: "pendingFixture" }); off();
  c.Commands.intercept((cmd, ctx, next) => { seen.push("later"); return next(); }, { first: true });
  resume(); assert.deepEqual(seen, ["original", "rule"]);
});

test("online legacy rejects every retained battle-reset/zone route before state mutation", () => {
  const f = fixture(); f.c.HotseatGame.startCombat();
  const commands = [
    { type: "battle.setup", level: 1, encounter: null },
    { type: "battle.panel", action: "setZones", value: 3 },
    { type: "battle.panel", action: "selectEncounter", encounter: { zoneMode: 3 } },
    { type: "battle.panel", action: "loadSlot", index: 0 },
    { type: "calc", action: "global", field: "zoneMode", value: 3 },
    { type: "calc", action: "clearField" },
    { type: "calc", action: "loadLive" },
    { type: "trpg.ui", action: "toBattle" },
    { type: "trpg.ui", action: "party", kits: ["ruby"] }
  ];
  for (const cmd of commands) { const before = plain(f.state); assert.throws(() => f.send(cmd), /联机战斗中/); assert.deepEqual(plain(f.state), before); }
  assert.equal(f.queued.length, 0);
});

test("online legacy defers outside local authority and preserves synchronous caller shapes", async () => {
  const f = fixture(); f.c.HotseatGame.startCombat(); f.c.GAME.depth = 1;
  const command = { type: "battle.panel", action: "setWeather", value: "sand", persist: true };
  const value = f.c.Commands.dispatch(command); command.value = "acid";
  assert.deepEqual(plain(value), { notes: [] }); assert.equal(typeof value.then, "undefined"); assert.notEqual(f.state.weather, "sand");
  assert.equal(f.queued.length, 1); assert.equal(f.c.Commands.history().some(e => e.command.type === "battle.panel" && e.command.action === "setWeather"), false);
  f.c.GAME.depth = 0; f.flush(); await Promise.resolve();
  assert.equal(f.state.weather, "sand"); assert.equal(f.c.GAME.weather, "sand");
  assert.equal(f.c.Commands.history().filter(e => e.command.type === "battle.panel" && e.command.action === "setWeather").length, 1);
  assert.deepEqual(f.errors, []);
});

test("legacy panel, calculator preset and copy routes all register newly added enemies for the next enemy round", () => {
  const f = fixture(); f.c.HotseatGame.startCombat(); f.c.endPlayerTurn();
  const original = f.state.units.find(u => !u.isPlayer);
  for (const command of [
    { type: "battle.panel", action: "addEnemy", preset: "thug_hammer", level: 2, zone: 2 },
    { type: "calc", action: "addPreset", id: "ufo_boss", level: 2 },
    { type: "calc", action: "copyUnit", actor: original.id }
  ]) {
    const before = f.state.units.map(u => u.id); f.send(command);
    const added = f.state.units.filter(u => !before.includes(u.id)); assert.ok(added.length);
    for (const u of added) { assert.equal(f.c.GMCommands.enemyMayAct(u), false); assert.equal(f.c.GMCommands.enemyMayAct(u, f.state.turnNo + 1), true); }
  }
});

test("legacy spawn eligibility uses its actual execution phase and queued preconditions are checked again", async () => {
  const f = fixture(); f.c.HotseatGame.startCombat(); f.c.GAME.depth = 1;
  const before = f.state.units.map(u => u.id);
  f.send({ type: "battle.panel", action: "addEnemy", preset: "thug_hammer", level: 1, zone: 2 });
  assert.deepEqual(f.state.units.map(u => u.id), before);
  f.c.endPlayerTurn(); f.c.GAME.depth = 0; f.flush(); await Promise.resolve();
  const added = f.state.units.find(u => !before.includes(u.id)); assert.equal(f.c.GMCommands.enemyMayAct(added), false);
  f.c.GAME.depth = 1; f.send({ type: "battle.panel", action: "setWeather", value: "sand" });
  f.c.OnlineGame.isPaused = () => true; f.c.GAME.depth = 0; const old = f.state.weather; f.flush(); await Promise.resolve();
  assert.equal(f.state.weather, old); assert.match(f.errors[0].message, /连接中断/);
});

test("precombat setup stays synchronous in a trusted capture and busy return-dependent setup is never deferred", () => {
  const f = fixture(); f.c.GAME.depth = 1;
  assert.throws(() => f.send({ type: "battle.setup", level: 1, encounter: null }), /当前结算/); assert.equal(f.queued.length, 0);
  f.c.GAME.tape = [];
  const result = f.send({ type: "battle.setup", level: 1, encounter: null });
  assert.ok(Array.isArray(result.notes)); assert.ok(f.state.units.length); assert.equal(f.queued.length, 0);
});

test("priority legacy boundary leaves normal single-player and prediction semantics unchanged", () => {
  const f = fixture({ host: false }); f.c.GAME.depth = 1;
  f.send({ type: "battle.panel", action: "setWeather", value: "sand" }); assert.equal(f.state.weather, "sand"); assert.equal(f.queued.length, 0); assert.equal(f.diffs.length, 0);
  f.c.OnlineGame.isHost = () => true; f.c.GAME.sim = true;
  f.send({ type: "battle.panel", action: "setZones", value: 3 }); assert.equal(f.state.zoneMode, 3); assert.equal(f.queued.length, 0);
});
