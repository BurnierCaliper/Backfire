"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const H = require("./headless");
const { Hotseat } = require("../hotseat");
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(kit = "ruby", other = "hiaki") {
  const c = H.load();
  c.BattleSim.setup({ party: [kit, other], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], zoneMode: 3, seed: "D3-ACTIONS:" + kit });
  c.startCombat();
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  for (const file of ["game.js", "hotseat-validation.js", "online-view.js", "online-actions.js"]) vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file });
  const state = c.S.state, actor = state.units.find(u => u.kit === kit), ally = state.units.find(u => u.kit === other), enemy = state.units.find(u => !u.isPlayer);
  actor.ap = actor.apMax = 4; actor.bonus = actor.bonusMax = 4;
  const session = Hotseat.create({ operators: ["p1", "p2"], gmId: "p1", assignments: { [actor.id]: "p1", [ally.id]: "p2" }, getUnits: () => state.units, canStand: u => !c.standUpBlocked(u) });
  session.beginRound(1); session.pick("p1", actor.id, 0); session.pick("p2", ally.id, 1); session.forceStart("p1");
  const service = c.OnlineActions.create({ game: c.GAME, validation: c.HotseatValidation, inspect: c.HotseatValidation.inspect,
    assertAction: (sender, id) => session.assertAction(sender, id), getState: () => state });
  const menu = (request = {}, sender = "p1") => plain(service.menu({ requestId: 1, actor: actor.id, ...request }, sender));
  return { c, state, actor, ally, enemy, session, service, menu };
}
function unchanged(f, fn) {
  const ledger = JSON.stringify(f.c.LEDGER.save());
  const ledgerRefs = Object.fromEntries(Object.keys(f.c.LEDGER).map(key => [key, f.c.LEDGER[key]]));
  const before = JSON.stringify(f.state), refs = Object.fromEntries(Object.keys(f.state).map(key => [key, f.state[key]]));
  const session = JSON.stringify(f.session.snapshot());
  const draws = f.c.S.RNG.draws(), random = f.c.Math.random, history = JSON.stringify(f.c.Commands.history());
  const result = fn();
  assert.equal(JSON.stringify(f.state), before);
  for (const [key, ref] of Object.entries(refs)) assert.equal(f.state[key], ref, key + " original reference");
  assert.equal(JSON.stringify(f.session.snapshot()), session);
  assert.equal(JSON.stringify(f.c.LEDGER.save()), ledger);
  for (const [key, ref] of Object.entries(ledgerRefs)) assert.equal(f.c.LEDGER[key], ref, "LEDGER." + key + " original reference");
  assert.equal(f.c.S.RNG.draws(), draws); assert.equal(f.c.Math.random, random);
  assert.equal(JSON.stringify(f.c.Commands.history()), history);
  return result;
}

test("host menu lists actual game skills, safe disabled reasons and no private resource snapshots", () => {
  const f = fixture(); f.actor.shp = 923781; f.actor.bonus = 0;
  const result = unchanged(f, () => f.menu());
  assert.equal(result.choices.kind, "skill");
  assert.ok(result.choices.options.some(o => o.value === "ruby_aa" && !o.disabled));
  const move = result.choices.options.find(o => o.value === "__move");
  assert.equal(move.disabled, true); assert.match(move.reason, /附赠行动不足/);
  assert.doesNotMatch(JSON.stringify(result), /923781|shp|damage|units|snap|forecast/i);
  assert.equal(result.displayOnly, true);
});

test("ownership, order, busy state and malformed JSON are rejected before any preview", () => {
  const f = fixture(); let previews = 0;
  const real = f.c.GAME.previewOf; f.c.GAME.previewOf = (...args) => { previews++; return real(...args); };
  unchanged(f, () => assert.throws(() => f.menu({}, "p2"), /不是你的/));
  unchanged(f, () => assert.throws(() => f.menu({ actor: f.ally.id }, "p2"), /轮到/));
  unchanged(f, () => assert.throws(() => f.menu({ state: { shp: 12 } }), /未知字段/));
  unchanged(f, () => assert.throws(() => f.menu({ picks: { target: () => {} } }), /JSON/));
  unchanged(f, () => assert.throws(() => f.menu({ skill: "ruby_assist" }), /可用技能/));
  f.c.GAME.depth = 1;
  unchanged(f, () => assert.throws(() => f.menu({ skill: "ruby_aa" }), /结算/));
  assert.equal(previews, 0);
});

test("normal target selection uses the host preview and returns a validated command without executing", () => {
  const f = fixture(); const events = [];
  f.c.onActionSpend(e => { if (!f.c.GAME.sim) events.push(e); });
  const result = unchanged(f, () => f.menu({ skill: "ruby_aa" }));
  assert.equal(result.choices.kind, "unit"); assert.equal(result.choices.key, "target");
  assert.ok(result.choices.options.some(o => o.value === f.enemy.id));
  assert.ok(!result.choices.options.some(o => o.value === f.ally.id));
  const ready = unchanged(f, () => f.menu({ skill: "ruby_aa", target: f.enemy.id }));
  assert.deepEqual(ready.choices.command, { type: "skill", actor: f.actor.id, skill: "ruby_aa", target: f.enemy.id, picks: {} });
  assert.equal(ready.choices.kind, "ready"); assert.deepEqual(events, []); assert.equal(f.c.GAME.sim, false);
  unchanged(f, () => assert.throws(() => f.menu({ skill: "ruby_aa", target: f.ally.id }), /目标/));
  f.enemy.zone = 3;
  unchanged(f, () => assert.throws(() => f.menu({ skill: "ruby_aa", target: f.enemy.id }), /目标/));
});

test("dynamic multi-step choices verify prefixes and derive their final target on the host", () => {
  const f = fixture("yuito"); f.actor.resources.liquid = 1; f.ally.layers[0].current = 1;
  const mode = unchanged(f, () => f.menu({ skill: "yuito_amer" }));
  assert.equal(mode.choices.kind, "choice"); assert.equal(mode.choices.key, "mode");
  assert.ok(mode.choices.options.some(o => o.value === "heal"));
  const target = unchanged(f, () => f.menu({ skill: "yuito_amer", picks: { mode: "heal" } }));
  assert.equal(target.choices.key, "target"); assert.ok(target.choices.options.some(o => o.value === f.ally.id));
  const ready = unchanged(f, () => f.menu({ skill: "yuito_amer", picks: { mode: "heal", target: f.ally.id } }));
  assert.equal(ready.choices.command.target, f.ally.id);
  assert.deepEqual(ready.choices.command.picks, { mode: "heal", target: f.ally.id });
  for (const picks of [{ target: f.ally.id }, { mode: "forged" }, { mode: "heal", target: f.enemy.id }, { mode: "heal", extra: true }])
    unchanged(f, () => assert.throws(() => f.menu({ skill: "yuito_amer", picks }), /分步|未提供/));
  f.actor.resources.liquid = 0;
  unchanged(f, () => assert.throws(() => f.menu({ skill: "yuito_amer", picks: { mode: "heal", target: f.ally.id } }), /咖啡液/));
});

test("actual structure and local device options remain usable without mutating the battlefield", () => {
  const f = fixture();
  f.state.gaps["1-2"].type = "wall"; f.state.gaps["1-2"].hp = 10;
  const targets = unchanged(f, () => f.menu({ skill: "ruby_aa" }));
  assert.ok(targets.choices.options.some(o => o.value === "gap:1-2"));
  const wall = unchanged(f, () => f.menu({ skill: "ruby_aa", target: "gap:1-2" }));
  assert.equal(wall.choices.command.target, "gap:1-2");
  f.state.props = [{ id: "switch", name: "开关", kind: "button", zone: 1 }];
  const skills = unchanged(f, () => f.menu());
  assert.ok(skills.choices.options.some(o => o.value === "use_device:switch"));
  const device = unchanged(f, () => f.menu({ skill: "use_device:switch" }));
  assert.equal(device.choices.command.skill, "use_device:switch");
  f.state.props[0].zone = 2;
  unchanged(f, () => assert.throws(() => f.menu({ skill: "use_device:switch" }), /可用技能/));
});

test("conditional range and dynamic AP/bonus costs stay with the real flow and validator", () => {
  const f = fixture("tou"); f.actor.resources.shield = 1;
  const range = unchanged(f, () => f.menu({ skill: "tou_aa" }));
  assert.equal(range.choices.key, "rangeMode");
  const target = unchanged(f, () => f.menu({ skill: "tou_aa", picks: { rangeMode: "far" } }));
  assert.ok(target.choices.options.some(o => o.value === f.enemy.id));
  const ready = unchanged(f, () => f.menu({ skill: "tou_aa", picks: { rangeMode: "far", target: f.enemy.id } }));
  assert.equal(ready.choices.command.target, f.enemy.id);
  f.actor.resources.shield = 0;
  unchanged(f, () => assert.throws(() => f.menu({ skill: "tou_aa", picks: { rangeMode: "far", target: f.enemy.id } }), /分步|未提供/));
  const g = fixture("yuito"); g.actor.level = 10; g.actor.ap = 0; g.actor.bonus = 1;
  unchanged(g, () => assert.throws(() => g.menu({ skill: "yuito_inspire", picks: { mode: "stay", target: g.ally.id } }), /行动点不足/));
  const usable = unchanged(g, () => g.menu({ skill: "yuito_inspire", picks: { mode: "turn", target: g.ally.id } }));
  assert.equal(usable.choices.command.target, g.ally.id);
});

test("optional movement can be skipped and target-free summon previews never add an actual weapon", () => {
  const f = fixture("kolt");
  const step = unchanged(f, () => f.menu({ skill: "kolt_short" }));
  assert.equal(step.choices.optional, true); assert.ok(step.choices.options.some(o => o.value === null));
  const ready = unchanged(f, () => f.menu({ skill: "kolt_short", picks: { dest: null } }));
  assert.deepEqual(ready.choices.command.picks, { dest: null });
  const g = fixture(); const count = g.state.units.length;
  const summon = unchanged(g, () => g.menu({ skill: "ruby_summon" }));
  assert.equal(summon.choices.kind, "ready"); assert.equal(summon.choices.command.target, null);
  assert.equal(g.state.units.length, count);
});

test("move and stand-up menus use actual legal zones and preserve the existing free stand-up", () => {
  const f = fixture(); f.state.gaps["1-2"].type = "wall"; f.state.gaps["1-2"].hp = 10;
  assert.deepEqual(unchanged(f, () => f.menu({ skill: "__move" })).choices.options, []);
  f.state.gaps["1-2"].type = "open";
  const move = unchanged(f, () => f.menu({ skill: "__move" })); assert.deepEqual(move.choices.options.map(o => o.value), [2]);
  const ready = unchanged(f, () => f.menu({ skill: "__move", dest: 2 })); assert.equal(ready.choices.command.type, "move");
  unchanged(f, () => assert.throws(() => f.menu({ skill: "__move", dest: 3 }), /相邻/));
  f.actor.layers.forEach(l => { l.current = 0; }); f.actor.dying = true; f.actor.shp = 20; f.actor.ap = f.actor.bonus = 0;
  const stand = unchanged(f, () => f.menu({ skill: "__stand" }));
  assert.deepEqual(stand.choices.command, { type: "standUp", actor: f.actor.id });
  assert.equal(f.actor.upOnShp, false);
});

test("combat items use host inventory and typed ally/zone/self choices without private hints", () => {
  const f = fixture(); for (const item of ["medkit", "bomb_e", "stim"]) f.c.bagAdd(item, 1);
  const items = unchanged(f, () => f.menu({ skill: "__item" }));
  assert.equal(items.choices.key, "item"); assert.equal(items.choices.options.length, 3);
  assert.doesNotMatch(JSON.stringify(items), /坚毅|shp/i);
  const ally = unchanged(f, () => f.menu({ skill: "__item", item: "medkit" }));
  assert.equal(ally.choices.kind, "unit"); assert.ok(ally.choices.options.some(o => o.value === f.ally.id));
  const medkit = unchanged(f, () => f.menu({ skill: "__item", item: "medkit", target: f.ally.id }));
  assert.deepEqual(medkit.choices.command, { type: "useItem", actor: f.actor.id, target: f.ally.id, item: "medkit", dest: null });
  const zones = unchanged(f, () => f.menu({ skill: "__item", item: "bomb_e" })); assert.deepEqual(zones.choices.options.map(o => o.value), [1, 2, 3]);
  assert.equal(unchanged(f, () => f.menu({ skill: "__item", item: "bomb_e", dest: 2 })).choices.command.dest, 2);
  assert.equal(unchanged(f, () => f.menu({ skill: "__item", item: "stim" })).choices.command.target, null);
  unchanged(f, () => assert.throws(() => f.menu({ skill: "__item", item: "medkit", target: f.enemy.id }), /友方/));
  unchanged(f, () => assert.throws(() => f.menu({ skill: "__item", item: "missing" }), /没有/));
});

test("inspection restores draft side effects on menu failure and requires an explicit host boundary", () => {
  const f = fixture();
  assert.throws(() => f.c.OnlineActions.create({ game: f.c.GAME, validation: f.c.HotseatValidation, assertAction() {}, getState: () => f.state }), /inspect/);
  f.c.GAME.previewOf = () => { f.state.units[0].shp = 1; f.state.bag = { items: [] }; throw new Error("fixture preview failure"); };
  unchanged(f, () => assert.throws(() => f.menu({ skill: "ruby_summon" }), /fixture preview/));
  assert.equal(f.c.GAME.sim, false);
});
