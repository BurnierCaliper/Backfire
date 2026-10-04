"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = value => JSON.parse(JSON.stringify(value));

function field(seed = "D2-SPEND", start = true) {
  const c = H.load();
  c.Date = class extends Date { static now() { return 1700000000000; } };
  c.BattleSim.setup({ party: ["helu", "kolt", "ruby"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed });
  if (start) c.startCombat();
  return c;
}
function listen(c) {
  const events = [];
  const unsubscribe = c.onActionSpend(event => events.push(event));
  return { events, unsubscribe };
}

test("actual AP and bonus costs emit detached JSON data and unsubscribe stops observation", () => {
  const c = field(), u = c.findKit("kolt", c.S.state.units), watch = listen(c);
  const before = c.S.state.battleScore.total;
  assert.equal(c.spendAp(u, 1, "test"), true);
  assert.equal(c.spendBonus(u, 1, "test"), true);
  assert.deepEqual(plain(watch.events), [{ unitId: u.id, ap: 1, bonus: 0 }, { unitId: u.id, ap: 0, bonus: 1 }]);
  assert.equal(c.S.state.battleScore.total - before, c.S.SCORE_RULES.ap + c.S.SCORE_RULES.bonusAction);
  assert.equal(u.ap, 0); assert.equal(u.bonus, 0);
  watch.unsubscribe(); watch.unsubscribe();
  u.ap = 1; c.spendAp(u, 1, "after unsubscribe");
  assert.equal(watch.events.length, 2);
  assert.throws(() => c.onActionSpend(null), /listener/);
});

test("invalid, unaffordable, zero, pre-combat and enemy spending does not emit player-spend events", () => {
  const c = field("D2-NONE", false), u = c.findKit("kolt", c.S.state.units), enemy = c.EnemyAI.foes()[0], watch = listen(c);
  c.scoreSpend(u, 1, 1); // The existing scoring gate excludes preparation.
  c.startCombat();
  c.scoreSpend(null, 1, 1); c.scoreSpend(enemy, 1, 1); c.scoreSpend(u, 0, 0);
  u.ap = 0; u.bonus = 0;
  assert.equal(c.spendAp(u, 1), false); assert.equal(c.spendBonus(u, 1), false);
  c.dispatch({ type: "skill", actor: u.id, skill: "kolt_aa", target: enemy.id, picks: {} });
  assert.throws(() => c.dispatch({ type: "move", actor: "absent", dest: 2 }), /actor/);
  assert.deepEqual(watch.events, []);
  // Economy refresh and a host adjustment are assignments, not voluntary costs.
  c.refreshEconomy(u); u.ap = 0; u.bonus = 0;
  assert.deepEqual(watch.events, []);
});

test("paid assist block emits the helper's bonus cost; free cover and rejected block do not", () => {
  const c = field("D2-BLOCK"), helper = c.findKit("helu", c.S.state.units), target = c.findKit("kolt", c.S.state.units), enemy = c.EnemyAI.foes()[0], watch = listen(c);
  enemy.zone = helper.zone = target.zone;
  c.S.state.combatPhase = "enemy";
  c.performAssistBlock(helper, target, enemy, { ok: true, roll: 1 });
  assert.deepEqual(plain(watch.events), [{ unitId: helper.id, ap: 0, bonus: 1 }]);
  assert.equal(helper.bonus, 0);
  target.coverBy = helper.id;
  c.performAssistBlock(helper, target, enemy, { ok: true, roll: 1 });
  assert.equal(watch.events.length, 1, "cover is an existing free reaction");
  target.coverBy = null;
  c.performAssistBlock(helper, target, enemy, { ok: true, roll: 1 });
  assert.equal(watch.events.length, 1, "insufficient bonus does not spend");
});

test("Ecmo bite's same-command AP refund preserves the actual spend event", () => {
  const c = field("D2-REFUND"), owner = c.findKit("helu", c.S.state.units), target = c.EnemyAI.foes()[0];
  const weapon = c.spawnWeapon(owner, "ecmo");
  weapon.zone = target.zone; weapon.ap = weapon.apMax = 1;
  target.def = 1; target.defMax = 5;
  target.layers.forEach(layer => { layer.current = layer.max = 1000; });
  const watch = listen(c), before = weapon.ap;
  c.dispatch({ type: "skill", actor: weapon.id, skill: "ecmo_bite", target: target.id, picks: {} });
  assert.equal(target.stunned, true);
  assert.equal(weapon.ap, before, "the real skill spent and refunded one AP");
  assert.deepEqual(plain(watch.events), [{ unitId: weapon.id, ap: 1, bonus: 0 }]);
  assert.equal(c.S.state.battleScore.parts.action, c.S.SCORE_RULES.ap);
});

test("flight surcharge and item use are observed although they deduct bonus directly", () => {
  const c = field("D2-DIRECT"), actor = c.findKit("kolt", c.S.state.units), target = c.EnemyAI.foes()[0], patient = c.findKit("ruby", c.S.state.units), watch = listen(c);
  actor.zone = target.zone; actor.flying = false; target.flying = true;
  c.dealTo(actor, target, { element: "physical", mult: 1, baseBreak: 0, atk: 1, flags: { action: true } });
  assert.deepEqual(plain(watch.events), [{ unitId: actor.id, ap: 0, bonus: 1 }]);
  actor.bonus = 1;
  c.bagAdd("medkit", 1); patient.layers[0].current = 1;
  c.dispatch({ type: "useItem", actor: actor.id, item: "medkit", target: patient.id, dest: null });
  assert.deepEqual(plain(watch.events), [{ unitId: actor.id, ap: 0, bonus: 1 }, { unitId: actor.id, ap: 0, bonus: 1 }]);
});

test("free stand-up has no spend; listener mutation or failure cannot alter rules, logs or scoring", () => {
  const old = field("D2-ISOLATION"), observed = field("D2-ISOLATION"), events = [];
  observed.onActionSpend(event => { event.unitId = "changed"; event.ap = 99; throw new Error("observer failure"); });
  observed.onActionSpend(event => events.push(event));
  for (const c of [old, observed]) {
    const u = c.findKit("kolt", c.S.state.units);
    u.layers.forEach(layer => { layer.current = 0; }); u.dying = true; u.shp = 20;
    c.dispatch({ type: "standUp", actor: u.id });
    assert.equal(u.upOnShp, true);
    c.spendAp(u, 1, "observed action");
    c.spendBonus(u, 1, "observed reaction");
  }
  const unit = observed.findKit("kolt", observed.S.state.units);
  assert.deepEqual(plain(events), [{ unitId: unit.id, ap: 1, bonus: 0 }, { unitId: unit.id, ap: 0, bonus: 1 }]);
  assert.deepEqual(plain(observed.S.state), plain(old.S.state));
  assert.deepEqual(plain(observed.S.LEDGER.save()), plain(old.S.LEDGER.save()));
  assert.deepEqual(plain(observed.__errors), []);
});

test("rule undo snapshots are disabled only while the hotseat adapter is active", () => {
  const c = field("D2-NO-UNDO");
  c.S.state.history = [];
  c.snapshot();
  assert.equal(c.S.state.history.length, 1, "ordinary single-player retains rule undo");
  c.HotseatGame = { isActive: () => true };
  c.snapshot();
  assert.equal(c.S.state.history.length, 1, "hotseat does not create another undo snapshot");
  c.HotseatGame.isActive = () => false;
  c.snapshot();
  assert.equal(c.S.state.history.length, 2, "inactive adapter preserves the old behavior");
});
