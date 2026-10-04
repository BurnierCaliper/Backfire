"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function field() {
  const c = H.load();
  c.S.RNG.install("D1-TRPG-COMMANDS");
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "D1-TRPG-COMMANDS" });
  c.S.TRPG.active = true;
  c.S.state.kuizhi = 5000;
  c.S.state.bag = { items: [] };
  c.findKit("kolt", c.S.state.units).attrPoints = 1;
  return c;
}
function snapshot(c) {
  return plain({ units: c.S.state.units, bag: c.S.state.bag, kuizhi: c.S.state.kuizhi, xpMult: c.S.state.xpMult,
    ledger: c.LEDGER.save(), gains: c.S.state.battleGains, score: c.S.state.battleScore });
}
function send(c, command) { return c.Commands.dispatch(plain(command)); }

test("D1 TRPG: JSON commands preserve the existing exploration economy, rest, growth and backstage rules", () => {
  const old = field(), next = field();
  const weapon = old.findKit("kolt", old.S.state.units).linkedKits[0];
  const cases = [
    [{ action: "buy", key: "medkit", qty: 2, free: false }, c => c.trpgBuy("medkit", 2, false)],
    [{ action: "buy", key: "mat_metal", qty: 3, free: true }, c => c.trpgBuy("mat_metal", 3, true)],
    [{ action: "adjustKuizhi", amount: -500, why: "路费" }, c => c.trpgAdjustKuizhi(-500, "路费")],
    [{ action: "adjustWater", amount: 1000 }, c => c.trpgAdjustWater(1000)],
    [{ action: "adjustItem", item: "rope", amount: 2 }, c => c.trpgAdjustItem("rope", 2)],
    [{ action: "upgradeWeapon", owner: "kolt", kit: weapon, mode: "self", fee: null }, c => c.trpgUpgradeWeapon("kolt", weapon, "self", null)],
    [{ action: "giveXp", kits: ["kolt"], amount: 155 }, c => c.trpgGiveXp(["kolt"], 155)],
    [{ action: "spendAttr", kit: "kolt", attr: "str" }, c => c.trpgSpendAttr("kolt", "str")],
    [{ action: "passHours", hours: 21 }, c => c.trpgPassHours(21)],
    [{ action: "shortRest", kits: ["kolt"] }, c => c.trpgShortRest(["kolt"])],
    [{ action: "longRest", plan: { hours: 8, food: {}, force: true } }, c => c.trpgLongRest({ hours: 8, food: {}, force: true })],
    [{ action: "heal", item: "medkit", kit: "kolt" }, c => c.trpgUseHeal("medkit", "kolt")],
    [{ action: "repair", kit: weapon }, c => c.trpgRepair(weapon)],
    [{ action: "restore" }, c => c.ledgerRestoreAll([])],
    [{ action: "backstage", edit: { day: 3, hours: 2, kuizhi: 321, water: 500, heroes: { kolt: { level: 4, xp: 2, attrPoints: 1, shp: 8, status: "up", layers: [4], attrs: { con: 6 }, weapons: { [weapon]: { level: 3, dur: 4, heal: true } } } } }, why: "测试" }, c => c.trpgBackstageApply({ day: 3, hours: 2, kuizhi: 321, water: 500, heroes: { kolt: { level: 4, xp: 2, attrPoints: 1, shp: 8, status: "up", layers: [4], attrs: { con: 6 }, weapons: { [weapon]: { level: 3, dur: 4, heal: true } } } } }, "测试")]
  ];
  for (const [data, legacy] of cases) {
    const expected = legacy(old), actual = send(next, { type: "trpg", ...data });
    assert.deepEqual(plain(actual), plain(expected), data.action + " notes");
    assert.deepEqual(snapshot(next), snapshot(old), data.action + " state");
  }
  assert.ok(next.Commands.history().every(e => e.status === "ok"));
});

test("D1 TRPG: explicit slot writes/imported data round-trip without changing the save format", () => {
  const c = field();
  const slot = { name: "D1团", campaign: null, log: [], level: 4, enc: null };
  send(c, { type: "trpg", action: "writeSlot", index: 1, slot });
  const stored = c.trpgReadSlots()[1];
  assert.equal(stored.name, slot.name); assert.equal(stored.level, 4);
  assert.equal(c.trpgValidSlot(stored), true);
  send(c, { type: "trpg", action: "xpMultiplier", value: "3" });
  assert.equal(c.S.state.xpMult, 3);
  send(c, { type: "trpg", action: "clearSlot", index: 1 });
  assert.equal(c.trpgReadSlots()[1], null);
});

test("D1 backstage: existing clamping, attribute spending, knock-out and revival keep their original meanings", () => {
  const c = field(), hero = c.findKit("kolt", c.S.state.units), foe = c.S.state.units.find(u => !u.isPlayer);
  const cmd = data => send(c, { type: "backstage", actor: hero.id, ...data });
  cmd({ action: "set", field: "defMax", value: 1 }); assert.equal(hero.def, 1);
  cmd({ action: "set", field: "zone", value: 99 }); assert.equal(hero.zone, c.S.state.zoneMode);
  cmd({ action: "layer", index: 0, current: 9999, max: 10 }); assert.equal(hero.layers[0].current, 10);
  const strength = hero.attrs.str;
  cmd({ action: "attr", attr: "str", value: strength + 1 });
  assert.equal(hero.attrs.str, strength + 1); assert.equal(hero.attrPoints, 0);
  cmd({ action: "attr", attr: "str", value: strength + 2 }); assert.equal(hero.attrs.str, strength + 1);
  const gains = plain(c.S.state.battleGains), money = c.S.state.kuizhi;
  send(c, { type: "backstage", actor: foe.id, action: "knockOut" });
  assert.equal(foe.dead, true); assert.equal(foe.dying, false);
  assert.deepEqual(plain(c.S.state.battleGains), gains); assert.equal(c.S.state.kuizhi, money);
  cmd({ action: "knockOut" }); assert.equal(hero.dying, true);
  cmd({ action: "revive" }); assert.equal(hero.dead, false); assert.equal(hero.dying, false);
  assert.ok(hero.layers.at(-1).current > 0);
  cmd({ action: "fillDef" }); assert.equal(hero.stunned, false);
});

test("D1 backstage: owner weapon level/durability and level-up use existing helpers", () => {
  const c = field(), hero = c.findKit("kolt", c.S.state.units), kit = hero.linkedKits[0];
  send(c, { type: "backstage", action: "weaponLevel", actor: hero.id, kit, value: 2 });
  assert.equal(hero.weaponLevels[kit], 2);
  hero.weaponHeld = false;
  send(c, { type: "backstage", action: "durability", kit, value: 9999 });
  assert.equal(c.weaponDur(kit), c.weaponDurMax(kit)); assert.equal(hero.weaponHeld, true);
  send(c, { type: "backstage", action: "grantXp", amount: 310 }); // TRPG: split between two heroes.
  send(c, { type: "backstage", action: "levelUp", actor: hero.id });
  assert.equal(hero.level, 2); assert.equal(hero.xp, 0);
  send(c, { type: "backstage", action: "recalc", actor: hero.id });
  assert.ok(hero.layers[0].max > 0);
});

test("D1 backstage: attack/environment commands execute their captured inputs without a DOM", () => {
  const c = field(), hero = c.findKit("kolt", c.S.state.units), foe = c.S.state.units.find(u => !u.isPlayer);
  const hp = () => foe.layers.reduce((n, l) => n + l.current, 0);
  const before = hp();
  c.readDmAttackInput = () => { throw new Error("must not read attack form"); };
  c.readDmEnvInput = () => { throw new Error("must not read environment form"); };
  send(c, { type: "backstage", action: "attack", input: { dmAtk: hero.id, dmTgt: foe.id, dmEle: "physical", dmMult: "1", dmSplash: "0", dmFlat: "1", dmBrk: "0", dmSplashBrk: "0", dmDiceN: "0", dmDiceS: "0", dmSkipBlock: true, hits: [] } });
  assert.ok(hp() < before);
  const after = hp();
  send(c, { type: "backstage", action: "environment", input: { dmEnvScope: "pick", dmEnvZone: "2", dmEnvEle: "physical", dmEnvFlat: "1", dmEnvBrk: "0", hits: [foe.id] } });
  assert.ok(hp() < after);
});

test("D1 calculator: JSON field and structure edits preserve lock and normal device behavior", () => {
  const c = field(), st = c.S.state;
  const cmd = data => send(c, { type: "calc", ...data });
  cmd({ action: "global", field: "weather", value: "acid" }); assert.equal(st.weather, "acid");
  cmd({ action: "global", field: "weatherLock", value: true });
  cmd({ action: "global", field: "weather", value: "snow" }); assert.equal(st.weather, "acid");
  cmd({ action: "field", zone: 1, key: "fire", value: "2" }); assert.equal(st.fields[1].fire, 2);
  cmd({ action: "field", zone: 1, key: "fieldLock", value: true });
  cmd({ action: "field", zone: 1, key: "fire", value: "0" }); assert.equal(st.fields[1].fire, 2);
  cmd({ action: "gap", key: "1-2", field: "type", value: "door" }); assert.equal(st.gaps["1-2"].open, false);
  cmd({ action: "gap", key: "1-2", field: "open", value: true }); assert.equal(st.gaps["1-2"].open, true);
  cmd({ action: "addProp", kind: "boom", zone: 1, level: 1, faction: "player" });
  const prop = st.props.at(-1); assert.ok(prop.id);
  cmd({ action: "prop", op: "remove", id: prop.id }); assert.ok(!st.props.includes(prop));
  for (const key of ["highland", "isolate", "collapseOn", "ruinOn"]) {
    cmd({ action: "field", zone: 2, key, value: true }); assert.equal(st.fields[2][key], true);
  }
  cmd({ action: "persist" });
  assert.equal(JSON.parse(c.localStorage.getItem("anterscale-calc")).weather, "acid");
});

test("D1 calculator: roster/form edits and unit copy/removal replay from JSON alone", () => {
  const c = field(), st = c.S.state;
  const form = { name: "数据角色", level: 2, zone: 1, atk: 3, def: 2, range: "melee", element: "physical", flying: false, layers: [{ type: "flesh", hp: 20 }], currentLayers: [{ type: "flesh", current: 12, max: 20 }] };
  const cmd = data => send(c, { type: "calc", ...data });
  c.readPlayerForm = () => { throw new Error("must not read roster form"); };
  cmd({ action: "rosterAddForm", form });
  const actor = st.units.at(-1).id;
  cmd({ action: "unitField", actor, field: "name", value: "改名" });
  cmd({ action: "unitLayer", actor, op: "add" });
  cmd({ action: "unitLayer", actor, op: "set", index: 1, field: "current", value: 4 });
  cmd({ action: "status", actor, key: "burn", value: 2 });
  cmd({ action: "instant", actor, key: "melt", value: true });
  cmd({ action: "rosterSaveUnit", actor }); assert.equal(st.roster.at(-1).name, "改名");
  cmd({ action: "copyUnit", actor }); assert.notEqual(st.units.at(-1).id, actor);
  cmd({ action: "removeUnit", actor }); assert.ok(!st.units.some(u => u.id === actor));
  cmd({ action: "rosterSaveForm", form });
  const card = st.roster.find(c => c.name === form.name);
  cmd({ action: "rosterEdit", id: card.cardId }); assert.equal(st.pcLayers[0].max, 20);
  cmd({ action: "rosterLoad", id: card.cardId }); assert.equal(st.units.at(-1).name, form.name);
  cmd({ action: "rosterDelete", id: card.cardId }); assert.ok(!st.roster.some(c => c.cardId === card.cardId));
});

test("D1 calculator: attack preview/application use serialized settings, not current form values", () => {
  const c = field(), st = c.S.state, hero = c.findKit("kolt", st.units), foe = st.units.find(u => !u.isPlayer);
  const input = { attackerSel: hero.id, targetSel: foe.id, element: "physical", atk: "3", mult: "1", flat: "0", baseBreak: "0", hits: "1", atkRange: "any", diceN: "0", diceS: "0", diceB: "0", diceMode: "manual", diceManual: "0", flags: {} };
  c.readCalcInput = () => { throw new Error("must not read calculator form"); };
  send(c, { type: "calc", action: "calculate", input });
  assert.equal(st.lastResult.ok, true);
  const before = foe.layers.reduce((n, l) => n + l.current, 0);
  send(c, { type: "calc", action: "applyAttack", input });
  assert.equal(st.lastResult, null); assert.ok(foe.layers.reduce((n, l) => n + l.current, 0) < before);
});

test("D1 calculator: explicit skill choices preserve pending-flow selection and cancellation", () => {
  const c = field(), st = c.S.state, hero = c.findKit("kolt", st.units);
  const cmd = data => send(c, { type: "calc", ...data });
  cmd({ action: "select", field: "attackerId", value: hero.id });
  cmd({ action: "clickUnit", actor: hero.id });
  assert.equal(st.pickActor, true);
  cmd({ action: "clearSelection" }); assert.equal(st.attackerId, null);
  const id = vm.runInContext('skillList(state.units.find(u => u.kit === "kolt")).find(s => skillFlowSteps(s.id, state.units.find(u => u.kit === "kolt"), {}).length > 0).id', c);
  cmd({ action: "skill", actor: hero.id, skill: id, target: null }); assert.ok(st.skillFlow);
  const ap = hero.ap;
  cmd({ action: "skillCancel" }); assert.equal(st.skillFlow, null); assert.equal(hero.ap, ap);
});

test("D1 command domains reject unknown operations/fields and missing captured forms before mutating", () => {
  const c = field(), before = snapshot(c), actor = c.S.state.units[0].id;
  for (const cmd of [
    { type: "trpg", action: "notAnAction" }, { type: "backstage", action: "set", actor, field: "__unknown", value: 1 },
    { type: "calc", action: "unitField", actor, field: "unknown", value: 1 },
    { type: "calc", action: "global", field: "unknown", value: 1 },
    { type: "calc", action: "global", field: "weather", value: "not-weather" },
    { type: "calc", action: "gap", key: "1-2", field: "type", value: "not-gap" },
    { type: "calc", action: "self", actor, value: "not-self" },
    { type: "calc", action: "blade", value: "not-blade" },
    { type: "calc", action: "calculate" }, { type: "backstage", action: "attack" }
  ]) assert.throws(() => send(c, cmd), /Unknown|requires explicit/);
  assert.deepEqual(snapshot(c), before);
});
