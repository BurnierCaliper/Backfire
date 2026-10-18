"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const source = new vm.Script(fs.readFileSync(path.join(H.ROOT, "gm-commands.js"), "utf8"), { filename: "gm-commands.js" });
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(enemy = "bandit_boss", enemyZone = 2) {
  const c = H.load(); source.runInContext(c);
  c.BattleSim.setup({ party: ["ruby", "helu"], enemies: [{ id: enemy, lv: 3, zone: enemyZone }], seed: "D3-GM-RULES" });
  const authority = Object.freeze({});
  c.GMCommands.configure({ requireHost: ctx => ctx === authority });
  const send = cmd => c.Commands.dispatch(plain(cmd), authority);
  return { c, s: c.S.state, send, authority, enemy: c.S.state.units.find(u => !u.isPlayer), hero: c.S.state.units.find(u => u.isPlayer && !u.weaponOf) };
}
function world(f) { return plain({ state: f.s, control: f.c.GMCommands.snapshot() }); }
function unchanged(f, cmd, context) {
  const before = world(f);
  assert.throws(() => context === undefined ? f.send(cmd) : f.c.Commands.dispatch(plain(cmd), context));
  assert.deepEqual(world(f), before, JSON.stringify(cmd));
}
function enemyTurn(f) { f.c.startCombat(); f.c.endPlayerTurn(); f.c.GMCommands.beginEnemyRound(f.s.turnNo); }

test("D3 GM: only a trusted room identity can execute JSON commands", () => {
  const f = fixture(), cmd = { type: "gm.spawnEnemy", enemyId: "thug_knife", level: 1, zone: 2 };
  unchanged(f, cmd, { gm: true, sender: "host" });
  unchanged(f, { ...cmd, sender: "host" });
  assert.throws(() => f.c.GMCommands.execute(cmd, {}), /主持人/);
  const output = f.send(cmd); assert.equal(output.ids.length, 1); assert.match(output.publicSummary, /加入/);
  assert.ok(f.c.Commands.history().some(entry => entry.command.type === cmd.type && entry.status === "ok"));
});

test("D3 GM: invalid mixed patches and targets reject before any authoritative mutation", () => {
  const f = fixture();
  for (const cmd of [
    { type: "gm.spawnEnemy", enemyId: "not-in-library", level: 3, zone: 2 },
    { type: "gm.spawnEnemy", enemyId: "thug_knife", level: 3, zone: 3 },
    { type: "gm.spawnEnemy", enemyId: "thug_knife", level: 3, zone: 2, count: -1 },
    { type: "gm.editUnit", actor: f.hero.id, patch: { atk: 800, zone: 3 } },
    { type: "gm.editUnit", actor: f.hero.id, patch: { hp: 7, statuses: { unknown: true } } },
    { type: "gm.editUnit", actor: f.hero.id, patch: { level: 0 } },
    { type: "gm.editUnit", actor: f.hero.id, patch: { level: 26 } },
    { type: "gm.spawnEnemy", enemyId: "captain_ox", level: Number.MAX_SAFE_INTEGER, zone: 2 },
    { type: "gm.editUnit", actor: f.hero.id, patch: { ap: -1 } },
    { type: "gm.editUnit", actor: f.hero.id, patch: { ap: 0.5 } },
    { type: "gm.setField", zone: 1, patch: { fireOn: true, acid: true } },
    { type: "gm.setWeather", weather: "sand", sandDir: "13" },
    { type: "gm.editGap", key: "2-3", patch: { type: "wall" } },
    { type: "gm.forceAttack", input: { dmAtk: f.enemy.id, dmTgt: f.hero.id, dmFlat: -4 } },
    { type: "gm.setManual", actors: [f.enemy.id, f.hero.id], enabled: true }
  ]) unchanged(f, cmd);
});

test("D3 GM: spawning waits for the next eligible enemy phase and leaves old unit schema alone", () => {
  const f = fixture(); f.c.startCombat();
  assert.equal(f.c.GMCommands.enemyMayAct(undefined), false);
  assert.equal(f.c.GMCommands.isManual(null), false);
  const playerSpawn = f.send({ type: "gm.spawnEnemy", enemyId: "thug_knife", level: 1, zone: 2 });
  const early = f.c.unitById(playerSpawn.ids[0]);
  assert.equal(playerSpawn.eligibleEnemyRound, f.s.turnNo);
  assert.equal(Object.hasOwn(early, "eligibleEnemyRound"), false);
  f.c.endPlayerTurn(); f.c.GMCommands.beginEnemyRound(f.s.turnNo);
  assert.equal(f.c.GMCommands.enemyMayAct(early), true);
  const lateSpawn = f.send({ type: "gm.spawnEnemy", enemyId: "thug_hammer", level: 1, zone: 2 });
  const late = f.c.unitById(lateSpawn.ids[0]);
  assert.equal(f.c.GMCommands.enemyMayAct(late), false);
  assert.equal(lateSpawn.eligibleEnemyRound, f.s.turnNo + 1);
  f.send({ type: "gm.setManual", actors: [late.id], enabled: true });
  unchanged(f, { type: "gm.enemyAct", actor: late.id, action: "move", dest: 1 });
  assert.equal(f.c.GMCommands.enemyMayAct(late, f.s.turnNo + 1), true);
});

test("D3 GM: ATK edits change the actual attack base while preserving held-weapon additions", () => {
  const f = fixture();
  const before = f.c.baseEffectiveAtk(f.hero, f.s.units), oldPersonal = f.hero.personalAtk;
  f.send({ type: "gm.editUnit", actor: f.enemy.id, patch: { atk: 37 } });
  assert.equal(f.c.effectiveAtk(f.enemy, f.s.units), 37);
  f.send({ type: "gm.editUnit", actor: f.hero.id, patch: { atk: 21 } });
  assert.equal(f.c.baseEffectiveAtk(f.hero, f.s.units), before - oldPersonal + 21);
});

test("D3 GM: administrative removal has no boomcar death, XP, kill score or drop", () => {
  const f = fixture("boomcar", 1); f.c.startCombat();
  const before = plain({ players: f.s.units.filter(u => u.isPlayer), score: f.s.battleScore, gains: f.s.battleGains, money: f.s.kuizhi });
  const out = f.send({ type: "gm.removeUnit", actor: f.enemy.id, mode: "remove" });
  assert.equal(f.c.unitById(f.enemy.id), undefined);
  assert.deepEqual(plain({ players: f.s.units.filter(u => u.isPlayer), score: f.s.battleScore, gains: f.s.battleGains, money: f.s.kuizhi }), before);
  assert.equal(out.notes.some(n => /引爆|爆炸|击杀/.test(n)), false);
});

test("D3 GM: removing a UFO body also removes its attached legs without awarding their deaths", () => {
  const f = fixture(); const ids = f.send({ type: "gm.spawnEnemy", enemyId: "ufo_boss", level: 3, zone: 2 }).ids;
  const body = ids.map(id => f.c.unitById(id)).find(u => u.kit === "ufo_body");
  const xp = f.hero.xp, score = plain(f.s.battleScore);
  f.send({ type: "gm.removeUnit", actor: body.id, mode: "remove" });
  assert.equal(ids.some(id => f.c.unitById(id)), false); assert.equal(f.hero.xp, xp); assert.deepEqual(plain(f.s.battleScore), score);
});

test("D3 GM: direct kill uses the normal XP, score and boomcar explosion path exactly once", () => {
  const f = fixture("boomcar", 1); f.c.startCombat();
  const before = f.c.totalHp(f.hero), xp = f.hero.xp, score = f.s.battleScore.total;
  const out = f.send({ type: "gm.removeUnit", actor: f.enemy.id, mode: "kill" });
  assert.equal(f.enemy.dead, true); assert.equal(f.enemy._xpGiven, true); assert.equal(f.enemy._exploded, true);
  assert.ok(f.c.totalHp(f.hero) < before, "the actual death blast hits nearby players");
  assert.ok(f.hero.xp > xp); assert.ok(f.s.battleScore.total > score);
  assert.ok(out.notes.some(n => /爆炸|引爆/.test(n)));
  unchanged(f, { type: "gm.removeUnit", actor: f.enemy.id, mode: "kill" });
});

test("D3 GM: a silent real kill captures private legacy reward notes without adding public log text", () => {
  const f = fixture(); f.c.startCombat(); const logs = plain(f.s.logPages), xp = f.hero.xp;
  const out = f.send({ type: "gm.removeUnit", actor: f.enemy.id, mode: "kill", silent: true });
  assert.equal(out.publicSummary, null); assert.ok(f.hero.xp > xp); assert.ok(out.notes.length > 0);
  assert.deepEqual(plain(f.s.logPages), logs);
});

test("D3 GM: remove/destroy props keep acid and explosion effects distinct", () => {
  const f = fixture();
  let id = f.send({ type: "gm.addProp", kind: "acid", zone: 1 }).id;
  f.send({ type: "gm.removeProp", id, mode: "remove" }); assert.equal(f.s.fields[1].acid, false);
  id = f.send({ type: "gm.addProp", kind: "acid", zone: 1 }).id;
  f.send({ type: "gm.removeProp", id, mode: "destroy" }); assert.equal(f.s.fields[1].acid, true);
  f.c.startCombat(); id = f.send({ type: "gm.addProp", kind: "boom", zone: 1 }).id;
  const hp = f.c.totalHp(f.hero); f.send({ type: "gm.removeProp", id, mode: "destroy" });
  assert.ok(f.c.totalHp(f.hero) < hp); assert.equal(f.s.props.some(p => p.id === id), false);
});

test("D3 GM: clamps unit maxima, edits statuses, and keeps SHP detail private even when silent", () => {
  const f = fixture(); const layers = f.hero.layers.map(() => ({ current: 5000, max: 17 }));
  const out = f.send({ type: "gm.editUnit", actor: f.hero.id, patch: { layers, shpMax: 9, shp: 8765, defMax: 3, def: 90, statuses: { burn: 2, corr: true, sturdy: false } } });
  assert.ok(f.hero.layers.every(l => l.current === 17 && l.max === 17));
  assert.equal(f.hero.shp, 9); assert.equal(f.hero.def, 3); assert.equal(f.hero.statuses.burn, 2); assert.equal(f.hero.statuses.corr, true);
  assert.equal(/8765|坚毅|shp/.test(out.publicSummary), false); assert.match(out.notes.join(" "), /8765/);
  const count = plain(f.s.logPages);
  const hidden = f.send({ type: "gm.editUnit", actor: f.hero.id, patch: { shp: 4 }, silent: true });
  assert.equal(hidden.publicSummary, null); assert.deepEqual(plain(f.s.logPages), count);
});

test("D3 GM: terrain immediately gates moves and weather options remain explicit", () => {
  const f = fixture(); enemyTurn(f);
  f.send({ type: "gm.setManual", actors: [f.enemy.id], enabled: true });
  f.send({ type: "gm.editGap", key: "1-2", patch: { type: "door", open: false } });
  unchanged(f, { type: "gm.enemyAct", actor: f.enemy.id, action: "move", dest: 1 });
  f.send({ type: "gm.editGap", key: "1-2", patch: { open: true } });
  f.send({ type: "gm.enemyAct", actor: f.enemy.id, action: "move", dest: 1 });
  assert.equal(f.enemy.zone, 1); assert.equal(f.enemy.bonus, 0);
  f.send({ type: "gm.setWeather", weather: "sand", sandDir: "21", phaseStep: 3, lock: true });
  assert.equal(f.s.weather, "sand"); assert.equal(f.s.sandDir, "21"); assert.equal(f.s.phaseStep, 3); assert.ok(f.s.weatherLock);
  f.send({ type: "gm.setField", zone: 1, patch: { fireOn: true, fire: 3 } });
  f.send({ type: "gm.setField", zone: 1, patch: { ice: true } }); assert.equal(f.s.fields[1].fire, 0); assert.equal(f.s.fields[1].ice, true);
});

test("D3 GM: manual mode respects enemy identity, phase, skill, range, stun and budgets", () => {
  const f = fixture("guard_gun");
  f.send({ type: "gm.setManual", actors: "all", enabled: true });
  assert.equal(f.c.GMCommands.isManual(f.hero), false);
  const attack = { type: "gm.enemyAct", actor: f.enemy.id, action: "skill", skill: "en_guard_gun_far", target: f.hero.id };
  unchanged(f, attack); enemyTurn(f);
  unchanged(f, { ...attack, actor: f.hero.id });
  unchanged(f, { ...attack, skill: "ruby_aa" });
  unchanged(f, { ...attack, skill: "en_guard_gun_assist" });
  unchanged(f, { ...attack, skill: "en_guard_gun_near" });
  f.enemy.stunned = true; unchanged(f, attack); f.enemy.stunned = false;
  f.enemy.ap = 0; unchanged(f, attack); f.enemy.ap = 1;
  const before = f.c.totalHp(f.hero); f.send(attack);
  assert.equal(f.enemy.ap, 0); assert.ok(f.c.totalHp(f.hero) < before || f.s.blockQueue.length > 0);
  unchanged(f, attack);
});

test("D3 GM: minion movement spends AP and elite movement spends only bonus", () => {
  for (const kind of ["thug_knife", "bandit_boss"]) {
    const f = fixture(kind); enemyTurn(f); f.send({ type: "gm.setManual", actors: "all", enabled: true });
    const ap = f.enemy.ap, bonus = f.enemy.bonus;
    f.send({ type: "gm.enemyAct", actor: f.enemy.id, action: "move", dest: 1 });
    assert.equal(f.enemy.ap, ap - (kind === "thug_knife" ? 1 : 0));
    assert.equal(f.enemy.bonus, bonus - (kind === "bandit_boss" ? 1 : 0));
    unchanged(f, { type: "gm.enemyAct", actor: f.enemy.id, action: "move", dest: 2 });
  }
});

test("D3 GM: enemy skill flow rejects forged picks and follows the actual grenade rules", () => {
  const f = fixture("mecha_gl"); enemyTurn(f); f.send({ type: "gm.setManual", actors: "all", enabled: true });
  const cmd = { type: "gm.enemyAct", actor: f.enemy.id, action: "skill", skill: "en_gl", picks: { dest: 1 } };
  unchanged(f, { ...cmd, picks: { dest: 3 } }); unchanged(f, { ...cmd, picks: {} });
  unchanged(f, { ...cmd, picks: { dest: 1, injected: true } });
  f.send(cmd); assert.equal(f.enemy.resources.glZone, 1); assert.equal(f.enemy.resources.glPending, true); assert.equal(f.enemy.ap, 0);
});

test("D3 GM: forced attack reuses actual damage without spending a normal action", () => {
  const f = fixture(); f.c.startCombat(); const hp = f.c.totalHp(f.enemy), ap = f.hero.ap;
  f.send({ type: "gm.forceAttack", input: { dmAtk: "__env", dmTgt: f.enemy.id, dmEle: "physical", dmFlat: 2, dmMult: 0, dmBrk: 0, dmSkipBlock: true } });
  assert.equal(f.c.totalHp(f.enemy), hp - 2); assert.equal(f.hero.ap, ap);
});

test("D3 GM: manual sidecar survives JSON recovery without polluting units or allowing untrusted restore", () => {
  const f = fixture(); enemyTurn(f);
  const spawned = f.send({ type: "gm.spawnEnemy", enemyId: "thug_knife", level: 2, zone: 2 }).ids[0];
  f.send({ type: "gm.setManual", actors: "all", enabled: true });
  f.send({ type: "gm.setManual", actors: [spawned], enabled: false });
  const saved = plain(f.c.GMCommands.snapshot()), before = plain(f.s);
  f.c.GMCommands.reset(); assert.equal(f.c.GMCommands.isManual(f.enemy), false);
  assert.throws(() => f.c.GMCommands.restore(saved, {}), /主持人/);
  f.c.GMCommands.restore(saved, f.authority);
  assert.deepEqual(plain(f.c.GMCommands.snapshot()), saved); assert.deepEqual(plain(f.s), before);
  assert.equal(f.c.GMCommands.isManual(f.enemy), true); assert.equal(f.c.GMCommands.isManual(spawned), false);
  assert.equal(f.c.GMCommands.enemyMayAct(f.c.unitById(spawned)), false);
  const malformed = { ...saved, units: [...saved.units, { id: f.hero.id, eligibleEnemyRound: 1 }] };
  assert.throws(() => f.c.GMCommands.restore(malformed, f.authority)); assert.deepEqual(plain(f.c.GMCommands.snapshot()), saved);
});

test("D3 GM: encounter changes are precombat only and enemy-end delegates once after validation", () => {
  const f = fixture(); f.send({ type: "gm.setEncounter", zoneMode: 3 }); assert.equal(f.s.zoneMode, 3);
  enemyTurn(f); unchanged(f, { type: "gm.setEncounter", zoneMode: 2 });
  let calls = 0; f.c.GMCommands.configure({ enemyEndTurn: ctx => { assert.equal(ctx, f.authority); calls++; } });
  unchanged(f, { type: "gm.enemyEndTurn", injected: true });
  f.send({ type: "gm.enemyEndTurn" }); assert.equal(calls, 1);
});

test("D3 GM: toggling manual control never refills spent budgets and applies to future spawns", () => {
  const f = fixture(); enemyTurn(f); f.enemy.ap = 0; f.enemy.bonus = 0;
  f.send({ type: "gm.setManual", actors: "all", enabled: true });
  f.send({ type: "gm.setManual", actors: [f.enemy.id], enabled: false });
  f.send({ type: "gm.setManual", actors: [f.enemy.id], enabled: true });
  assert.equal(f.enemy.ap, 0); assert.equal(f.enemy.bonus, 0);
  const id = f.send({ type: "gm.spawnEnemy", enemyId: "thug_knife", level: 25, zone: 2 }).ids[0];
  assert.equal(f.c.GMCommands.isManual(id), true); assert.equal(f.c.GMCommands.enemyMayAct(f.c.unitById(id)), false);
  f.send({ type: "gm.setManual", actors: "all", enabled: false });
  assert.equal(f.c.GMCommands.isManual(id), false); assert.equal(f.c.GMCommands.isManual(f.enemy), false);
});

test("GM 场地：开战后可以把一区设成 / 取消固有场地；固有场地技能改不掉；流沙、沙珊瑚台地也能设", () => {
  const f = fixture(); f.c.startCombat();
  f.send({ type: "gm.setField", zone: 1, patch: { acid: true, innate: true } });
  assert.equal(f.s.fields[1].innate, true);
  assert.match(String(f.c.fieldChangeWhy(1, "electric")), /固有场地/);
  f.send({ type: "gm.setField", zone: 1, patch: { innate: false } });
  assert.equal(f.c.fieldChangeWhy(1, "electric"), null, "取消固有后技能可以改");
  f.send({ type: "gm.setField", zone: 2, patch: { quicksand: true } }); assert.equal(f.s.fields[2].quicksand, true);
  f.send({ type: "gm.setField", zone: 2, patch: { coral: true } }); assert.equal(f.s.fields[2].coral, true); assert.equal(f.s.fields[2].quicksand, false);
  // 清掉主场地：固有一起取消
  f.send({ type: "gm.setField", zone: 1, patch: { acid: true, innate: true } });
  f.send({ type: "gm.setField", zone: 1, patch: { acid: false } });
  assert.equal(f.s.fields[1].innate, false);
  unchanged(f, { type: "gm.setField", zone: 1, patch: { innate: "yes" } });
});
