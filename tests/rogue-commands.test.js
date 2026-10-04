"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./headless");
const plain = x => x === undefined ? null : JSON.parse(JSON.stringify(x));
const roundTrip = x => JSON.parse(JSON.stringify(x));

function pair(seed = "D1-ROGUE", party = ["kolt", "helu"]) {
  function side() {
    const c = H.load();
    vm.runInContext("Date.now = () => 1700000000000", c);
    c.S.RNG.install(seed + ":start");
    return { c, session: { run: null, picked: [], solo: { on: false, hero: null, partners: [], role2: null } } };
  }
  const old = side(), via = side();
  old.session.run = old.c.Rogue.newRun({ party, seed });
  via.c.dispatch(roundTrip({ type: "run.session", action: "newRun", party, seed }), { session: via.session });
  const snapshot = x => plain({ run: x.session.run, state: x.c.S.state, ledger: x.c.S.LEDGER.save(), random: { seed: x.c.S.RNG.seed, draws: x.c.S.RNG.draws() } });
  const check = label => assert.deepEqual(snapshot(via), snapshot(old), label);
  check("newRun");
  const command = (type, action, fields, reference, extra = {}) => {
    const expected = reference(old.c, old.session.run, old.session);
    const actual = via.c.dispatch(roundTrip(Object.assign({ type, action }, fields || {})), Object.assign({ run: via.session.run, session: via.session }, extra));
    assert.deepEqual(plain(actual), plain(expected), type + "/" + action + " return");
    check(type + "/" + action + " authority");
    return actual;
  };
  return { old, via, check, command, run: (action, fields, fn) => command("run", action, fields, fn), query: (action, fields, fn) => command("run.query", action, fields, fn), fixture: fn => { for (const x of [old, via]) fn(x.c, x.session.run, x.session); check("fixture"); } };
}
function nodeFixture(p, type, extra = {}) {
  p.fixture((c, run) => {
    if (!run.task) c.Rogue.acceptTask(run, "main");
    run.stage = "task"; run.ambush = null;
    run.task.index = 0;
    run.task.nodes = [Object.assign({ type, done: false }, extra), { type: "battle", done: false }];
    run.task.cols = [[type], ["battle"]]; run.task.pick = [0, 0];
  });
}

test("fixed-seed natural campaign has identical direct and JSON-command state after every decision", () => {
  const p = pair("D1-FLOW", ["tou", "xia", "hiaki", "ruby"]);
  const visited = new Set();
  for (let step = 0; step < 500 && p.old.session.run.stage !== "over"; step++) {
    const { c, session } = p.old, R = c.Rogue, run = session.run;
    visited.add(run.stage);
    const pending = R.pendingChoices(run)[0];
    if (pending) {
      const opts = p.query("choiceOptions", { kit: pending.kit, index: pending.index }, (x, r) => x.Rogue.choiceOptions(r, pending.kit, pending.index));
      p.run("choose", { kit: pending.kit, index: pending.index, value: opts[0].value }, (x, r) => x.Rogue.choose(r, pending.kit, pending.index, opts[0].value));
      continue;
    }
    if (run.stage === "board") {
      const side = run.board.findIndex(t => !R.taskBlocked(run, t) && !R.taskWarning(run, t));
      const which = side < 0 ? "main" : side;
      p.run("acceptTask", { which }, (x, r) => x.Rogue.acceptTask(r, which));
    } else if (run.stage === "task" && !R.currentNode(run)) {
      const index = R.nodeChoices(run)[0].i;
      p.run("chooseNode", { index }, (x, r) => x.Rogue.chooseNode(r, index));
    } else if (run.stage === "task" || run.stage === "boss") {
      const node = run.stage === "boss" ? { type: "boss" } : R.currentNode(run);
      visited.add(node.type);
      if (["battle", "elite", "boss"].includes(node.type) || run.ambush) {
        let specA, specB;
        p.command("run.session", "startBattle", {}, (x, r) => { specA = x.Rogue.battleSpec(r); x.Rogue.save(r); return { started: true }; }, { startBattle(spec) { specB = spec; } });
        p.old.c.BattleSim.setup(specA); p.via.c.BattleSim.setup(specB);
        const a = p.old.c.BattleSim.run({ maxRounds: 80 }), b = p.via.c.BattleSim.run({ maxRounds: 80 });
        assert.deepEqual(plain(a), plain(b)); assert.notEqual(a.winner, "timeout", "fixture must terminate as a game result");
        const outcome = a.winner === "player" ? "win" : "lose";
        p.old.c.settleBattleRewards(outcome); p.via.c.settleBattleRewards(outcome);
        p.run("finishBattle", { outcome }, (x, r) => x.Rogue.finishBattle(r, outcome));
      } else if (node.type === "rest") {
        const plan = p.query("restPlan", {}, (x, r) => x.Rogue.restPlan(r));
        const mode = plan.ok ? "long" : "short";
        p.run("restAtNode", { mode, watch: null }, (x, r) => mode === "long" ? x.Rogue.restAtNode(r, mode, { watch: null }) : x.Rogue.restAtNode(r, mode));
      } else if (node.type === "check") {
        p.run("skipCheck", {}, (x, r) => x.Rogue.skipCheck(r));
      } else p.run("leaveNode", {}, (x, r) => x.Rogue.leaveNode(r));
    } else if (run.stage === "camp") p.run("camp", {}, (x, r) => x.Rogue.camp(r));
    else if (run.stage === "interlude") p.run("nextAct", {}, (x, r) => x.Rogue.nextAct(r));
    else if (run.stage === "victory") p.run("afterVictory", { goOn: false }, (x, r) => x.Rogue.afterVictory(r, false));
    else assert.fail("Unhandled stage " + run.stage);
  }
  assert.equal(p.via.session.run.stage, "over");
  assert.ok(visited.has("board") && visited.has("task"));
  assert.ok(p.via.c.Commands.history().some(e => e.command.action === "finishBattle"));
});

test("all existing commerce, smith, blueprint, repair, clinic and upgrade actions preserve rule results", () => {
  const p = pair("D1-SHOPS");
  p.fixture((c, r) => { r.stage = "camp"; c.S.state.kuizhi = 999999; });
  p.run("buy", { key: "repair_kit", qty: 2 }, (c, r) => c.Rogue.buy(r, "repair_kit", 2));
  p.fixture((c, r) => { c.S.LEDGER.dur.torque = 0; r.party[0].hp = [{ type: "flesh", current: 2 }]; });
  p.run("repairWeapon", { kit: "torque" }, (c, r) => c.Rogue.repairWeapon(r, "torque"));
  p.query("heroView", { kit: "kolt" }, (c, r) => c.Rogue.heroView(r, r.party[0]));
  p.query("healCost", { kit: "kolt" }, (c, r) => c.Rogue.healCost(r, "kolt"));
  p.run("healHero", { kit: "kolt" }, (c, r) => c.Rogue.healHero(r, "kolt"));
  p.query("cyberInfo", { kit: "kolt" }, (c, r) => c.Rogue.cyberInfo(r, "kolt"));
  const plan = { armor: 1, shield: 0, sand: 0, spirit: false };
  p.query("cyberPreview", { kit: "kolt", plan }, (c, r) => c.Rogue.cyberPreview(r, "kolt", plan));
  p.run("modifyHero", { kit: "kolt", plan }, (c, r) => c.Rogue.modifyHero(r, "kolt", plan));
  p.fixture((c, r) => { r.stage = "board"; r.smiths = ["trevor"]; });
  p.query("smithInfo", { smith: "trevor" }, (c, r) => c.Rogue.smithInfo(r, "trevor"));
  p.run("introduceSmith", { smith: "trevor" }, (c, r) => c.Rogue.introduceSmith(r, "trevor"));
  for (let i = 0; i < 5; i++) {
    const kit = i % 2 ? "ecmo" : "torque";
    p.run("upgradeWeapon", { kit, smith: "trevor" }, (c, r) => c.Rogue.upgradeWeapon(r, kit, "trevor"));
  }
  const info = p.query("smithInfo", { smith: "trevor" }, (c, r) => c.Rogue.smithInfo(r, "trevor")), blueprint = info.blueprints[0].id;
  p.run("claimBlueprint", { smith: "trevor", blueprint }, (c, r) => c.Rogue.claimBlueprint(r, "trevor", blueprint));
  p.run("installBlueprint", { blueprint, kit: "torque", smith: "trevor" }, (c, r) => c.Rogue.installBlueprint(r, blueprint, "torque", "trevor"));
  assert.equal(p.via.session.run.installed.torque, blueprint);
  p.fixture((_c, r) => { r.party[0].pending = [{ type: "attr", level: 2, noRepeat: false }]; });
  p.query("choiceOptions", { kit: "kolt", index: 0 }, (c, r) => c.Rogue.choiceOptions(r, "kolt", 0));
  p.run("choose", { kit: "kolt", index: 0, value: "con" }, (c, r) => c.Rogue.choose(r, "kolt", 0, "con"));
  assert.equal(p.via.session.run.party[0].pending.length, 0);
});

test("lazy node queries, rest/watch choices and check animation data keep legacy RNG and state order", () => {
  const p = pair("D1-QUERIES");
  nodeFixture(p, "smith");
  const ids = p.query("presentSmiths", {}, (c, r) => c.Rogue.presentSmiths(r));
  p.query("smithInfo", { smith: ids[0] }, (c, r) => c.Rogue.smithInfo(r, ids[0]));
  nodeFixture(p, "battle");
  p.query("canShortRestBefore", {}, (c, r) => c.Rogue.canShortRestBefore(r));
  p.run("shortRestBeforeNode", {}, (c, r) => c.Rogue.shortRestBeforeNode(r));
  for (const mode of ["long", "short", "leave"]) {
    nodeFixture(p, "rest");
    p.query("restPlan", {}, (c, r) => c.Rogue.restPlan(r));
    const options = p.query("watchOptions", {}, (c, r) => c.Rogue.watchOptions(r));
    const watch = options[0].kit;
    p.run("restAtNode", { mode, watch }, (c, r) => mode === "long" ? c.Rogue.restAtNode(r, mode, { watch }) : c.Rogue.restAtNode(r, mode));
  }
  nodeFixture(p, "check");
  p.query("checkInfo", {}, (c, r) => c.Rogue.checkInfo(r));
  p.query("checkOdds", { kit: "kolt" }, (c, r) => c.Rogue.checkOdds(r, "kolt"));
  nodeFixture(p, "check", { check: { diff: "normal", prof: "追踪", injure: false, reward: 1500 } });
  const result = p.run("attemptCheck", { kit: "kolt" }, (c, r) => { const notes = c.Rogue.attemptCheck(r, "kolt"), check = r.lastCheck; r.lastCheck = null; return { notes, check }; });
  assert.ok(result.check && result.check.rolls); assert.equal(p.via.session.run.lastCheck, null);
  nodeFixture(p, "check");
  p.run("skipCheck", {}, (c, r) => c.Rogue.skipCheck(r));
  nodeFixture(p, "shop");
  p.run("leaveNode", {}, (c, r) => c.Rogue.leaveNode(r));
});

test("session save/resume, final statistics, interlude and extra-act decisions retain storage format", () => {
  const p = pair("D1-SESSION");
  p.command("run.session", "save", {}, (c, r) => ({ saved: !!c.Rogue.save(r) }));
  p.command("run.session", "readSaved", {}, c => c.SaveStore.loadRun());
  p.command("run.session", "leave", { save: true }, (c, r, s) => { c.Rogue.save(r); c.Rogue.leaveRunMode(r); s.run = null; return { left: true }; });
  p.command("run.session", "resume", {}, (c, _r, s) => { s.run = c.SaveStore.loadRun(); c.Rogue.enterRunMode(s.run); return { resumed: true }; });
  p.fixture((_c, r) => { r.stage = "interlude"; });
  p.run("nextAct", {}, (c, r) => c.Rogue.nextAct(r));
  assert.equal(p.via.session.run.act, 2);
  p.fixture((_c, r) => { r.stage = "victory"; r.act = 4; });
  p.run("afterVictory", { goOn: true }, (c, r) => c.Rogue.afterVictory(r, true));
  assert.equal(p.via.session.run.act, 5);
  p.fixture((_c, r) => { r.stage = "victory"; });
  p.run("afterVictory", { goOn: false }, (c, r) => c.Rogue.afterVictory(r, false));
  const finish = (c, r) => { if (r._counted) return { counted: false }; r._counted = true; const m = c.SaveStore.loadMeta(); m.stats.runs++; if (r.result.win) m.stats.wins++; m.stats.deaths += r.fallen.length; c.SaveStore.saveMeta(m); c.SaveStore.clearRun(); return { counted: true }; };
  p.command("run.session", "finishRun", {}, finish);
  p.command("run.session", "finishRun", {}, finish);
  assert.equal(p.via.c.SaveStore.loadMeta().stats.runs, 1);
  assert.equal(p.via.c.SaveStore.loadRun(), null);
  p.command("run.session", "leave", { save: false }, (c, _r, s) => { c.Rogue.leaveRunMode(null); s.run = null; return { left: true }; });
  p.command("run.session", "resume", {}, () => ({ resumed: false }));
  let called = 0;
  p.command("run.session", "sandbox", {}, c => { c.Rogue.leaveRunMode(); return { leftRunMode: true }; }, { setupBattle() { called++; } });
  assert.equal(called, 1);
  assert.deepEqual(plain(p.via.c.SaveStore.CURRENT), plain(p.old.c.SaveStore.CURRENT));
});

test("route, camp and each battle callback keep the same node, roster and outcome transitions", () => {
  const route = pair("D1-ROUTE");
  route.run("acceptTask", { which: "main" }, (c, r) => c.Rogue.acceptTask(r, "main"));
  route.fixture((_c, r) => { r.task.index = 1; r.task.cols = [["battle"], ["shop", "rest"]]; r.task.pick = [0]; r.task.nodes = [{ type: "battle", done: true }]; });
  route.run("chooseNode", { index: 1 }, (c, r) => c.Rogue.chooseNode(r, 1));
  assert.equal(route.via.c.Rogue.currentNode(route.via.session.run).type, "rest");
  route.fixture((_c, r) => { r.stage = "camp"; });
  route.run("camp", {}, (c, r) => c.Rogue.camp(r));
  assert.equal(route.via.session.run.stage, "board");
  route.command("run.session", "startBattle", {}, () => ({ started: false }), { startBattle() { assert.fail("board has no battle"); } });

  for (const kind of ["battle", "boss", "ambush"]) for (const outcome of ["win", "lose", "retreat"]) {
    if (kind === "boss" && outcome === "retreat") continue; // Boss retreat is not an existing UI choice.
    const p = pair("D1-END:" + kind + ":" + outcome);
    nodeFixture(p, kind === "ambush" ? "rest" : "battle");
    p.fixture((c, r) => {
      if (kind === "boss") r.stage = "boss";
      if (kind === "ambush") r.ambush = { chance: 1 };
      c.BattleSim.setup(c.Rogue.battleSpec(r));
      if (outcome === "lose") c.S.state.units.filter(u => u.isPlayer).forEach(u => { u.dead = true; });
      if (outcome === "win") c.S.state.units.filter(u => !u.isPlayer).forEach(u => { u.dead = true; });
    });
    p.run("finishBattle", { outcome }, (c, r) => c.Rogue.finishBattle(r, outcome));
    const run = p.via.session.run;
    if (outcome === "lose") { assert.equal(run.stage, "over"); assert.equal(run.party.length, 0); assert.equal(run.fallen.length, 2); }
    else if (kind === "boss") assert.equal(run.stage, "interlude");
    else assert.equal(run.task.index, 1);
    if (kind === "ambush") assert.equal(run.ambush, null);
  }
});

test("screen navigation dispatch preserves show/hide hooks, optional arguments and invalid-name errors", () => {
  const c = H.load(), calls = [], first = {}, second = {};
  c.document = { body: { dataset: {} } };
  const source = fs.readFileSync(path.join(H.ROOT, "screens.js"), "utf8");
  vm.runInContext(source.slice(0, source.indexOf("/* ---------- 标题界面")), c);
  const screens = vm.runInContext("Screens", c);
  screens.register("first", first, { onShow(arg) { calls.push(["first", arg]); }, onHide() { calls.push(["hide"]); } });
  screens.register("second", second, { onShow(arg) { calls.push(["second", arg]); } });
  screens.show("first");
  c.dispatch(roundTrip({ type: "screen", action: "show", name: "second", arg: { id: 2 } }));
  assert.deepEqual(plain(calls), [["first", null], ["hide"], ["second", { id: 2 }]]);
  assert.equal(first.hidden, true); assert.equal(second.hidden, false);
  assert.equal(screens.current(), "second"); assert.equal(c.document.body.dataset.screen, "second");
  assert.throws(() => screens.show("missing"), /没有这个界面/);
  assert.equal(screens.current(), "second");
  assert.deepEqual(plain(c.Commands.history().map(e => e.status)), ["ok", "ok", "error"]);
});

test("party drafts support original multiplayer limits and solo hero/partner/role toggles", () => {
  const c = H.load(), session = { run: null, picked: [], solo: { on: false, hero: null, partners: [], role2: null } };
  const send = (action, fields) => c.dispatch(roundTrip(Object.assign({ type: "run.session", action }, fields)), { session });
  send("prepareParty", { solo: false });
  for (const kit of ["tou", "xia", "ruby", "kolt", "helu"]) send("toggleHero", { kit });
  assert.deepEqual(session.picked, ["tou", "xia", "ruby", "kolt"]);
  send("toggleHero", { kit: "xia" }); assert.deepEqual(session.picked, ["tou", "ruby", "kolt"]);
  send("prepareParty", { solo: true });
  send("toggleHero", { kit: "tou" });
  for (const kit of ["xia", "ruby", "kolt", "helu"]) send("toggleHero", { kit });
  assert.deepEqual(plain(session.solo.partners), ["xia", "ruby", "kolt"]);
  const role = c.Rogue.role2Options("tou")[0]; send("chooseRole2", { role });
  send("newRun", { party: ["tou"], partners: ["xia", "ruby", "kolt"], role2: role, solo: true, seed: "D1-SOLO" });
  assert.equal(session.run.solo, true); assert.equal(session.run.party.length, 1);
  send("toggleHero", { kit: "tou" }); assert.equal(session.solo.hero, null); assert.equal(session.solo.role2, null);
});

test("unknown/invalid run commands reject before changing authority, UI mutation calls use dispatch", () => {
  const p = pair(); const before = plain(p.via.session.run);
  for (const command of [{ type: "run", action: "sell", key: "water" }, { type: "run", action: "finishBattle", outcome: "timeout" }, { type: "run", action: "chooseNode", index: -1 }]) assert.throws(() => p.via.c.dispatch(command, { run: p.via.session.run }));
  assert.deepEqual(plain(p.via.session.run), before);
  const source = fs.readFileSync(path.join(H.ROOT, "rogue-ui.js"), "utf8");
  assert.doesNotMatch(source, /Rogue\.(newRun|save|enterRunMode|leaveRunMode|acceptTask|chooseNode|restAtNode|buy|introduceSmith|upgradeWeapon|claimBlueprint|installBlueprint|repairWeapon|healHero|modifyHero|attemptCheck|skipCheck|choose|leaveNode|nextAct|afterVictory|finishBattle)\s*\(/);
  assert.doesNotMatch(source, /run\.lastCheck\s*=|run\._counted\s*=/);
});
