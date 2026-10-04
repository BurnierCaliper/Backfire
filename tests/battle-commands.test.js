"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = value => JSON.parse(JSON.stringify(value));

function field(seed = "D1-BATTLE") {
  const c = H.load();
  c.Date = class extends Date { static now() { return 1700000000000; } };
  c.BattleSim.setup({ party: ["ruby", "kolt", "hiaki", "tou"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }, { id: "bandit_boss", lv: 1, zone: 2 }], seed });
  return c;
}
function seeded(c, seed, f) {
  const previous = c.Math.random;
  c.Math.random = c.makeRng(seed);
  try { return f(); } finally { c.Math.random = previous; }
}
// The pre-D1 game entry points: real rule functions, with the same selected
// actor/target and completed skill picks that the former skillThunk supplied.
function legacy(c, cmd) {
  const st = c.S.state;
  if (["skill", "move", "standUp", "useItem"].includes(cmd.type)) {
    const u = c.unitById(cmd.actor);
    st.attackerId = st.selectedId = cmd.actor; st.targetId = cmd.target || null;
    if (cmd.type === "move") return c.doMove(u, cmd.dest);
    if (cmd.type === "standUp") return c.standUp(u);
    if (cmd.type === "useItem") {
      const notes = c.trackHealBy(u, () => c.useItemOn(u, cmd.item, c.unitById(cmd.target), cmd.dest));
      notes.forEach(s => c.appendLog(s));
      if ((u.bonus || 0) > 0) { u.bonus--; c.scoreSpend(u, 0, 1); }
      return;
    }
    if (cmd.picks && Object.keys(cmd.picks).length) st.skillFlow = { id: cmd.skill, actorId: cmd.actor, picks: Object.assign({}, cmd.picks), index: 99 };
    try { return c.runSkill(cmd.skill); } finally { st.skillFlow = null; }
  }
  if (cmd.type === "startCombat") return c.startCombat();
  if (cmd.type === "endTurn") return seeded(c, cmd.seed, () => c.endPlayerTurn());
  if (cmd.type === "battle.endEnemyTurn") return c.endEnemyTurn();
  if (cmd.type === "battle.enemyAction") { const p = c.EnemyAI.planFor(c.unitById(cmd.actor), cmd.step); if (p) seeded(c, cmd.seed, p.thunk); return; }
  if (cmd.type === "blockAnswer") return seeded(c, cmd.seed, () => c.finishBlock(cmd.helper, cmd.forced));
  if (cmd.type === "assistAnswer") {
    const helper = c.unitById(cmd.helper), prev = st.combatPhase;
    if (helper) st.combatPhase = helper.isPlayer ? "player" : "enemy";
    try { return c.finishAssist(cmd.helper, cmd.extra); } finally { st.combatPhase = prev; }
  }
  if (cmd.type === "koltSwapAnswer") return c.resolveKoltSwap(cmd.swap, cmd.target);
  if (cmd.type === "battle.finish") return c.settleBattleRewards(cmd.outcome);
  throw new Error("Missing legacy test call " + cmd.type);
}
function fight(useCommands, seed) {
  const c = field(seed), st = c.S.state;
  const seen = new Set();
  const execute = cmd => { seen.add(cmd.type); return useCommands ? c.dispatch(plain(cmd)) : legacy(c, cmd); };
  const react = () => {
    for (let guard = 0; guard < 40; guard++) {
      if (st.blockQueue.length) { execute({ type: "blockAnswer", helper: null, forced: null, seed: "hit:" + st.blockQueue[0].seq }); continue; }
      c.pruneAssistQueue();
      if (st.assistQueue.length) { execute({ type: "assistAnswer", helper: null, extra: {} }); continue; }
      if (st.koltSwapQueue.length) { execute({ type: "koltSwapAnswer", swap: false, target: null }); continue; }
      return;
    }
    throw new Error("Unresolved reactions");
  };
  execute({ type: "startCombat" });
  while (!c.BattleSim.outcome() && st.turnNo <= 60) {
    for (const id of st.units.filter(u => u.isPlayer && c.EnemyAI.unitAlive(u)).map(u => u.id)) {
      for (let n = 0; n < 6; n++) {
        const u = c.unitById(id);
        if (!u || !c.EnemyAI.unitAlive(u) || c.BattleSim.outcome()) break;
        const before = `${u.ap}|${u.bonus}|${u.zone}|${u.dying}|${u.upOnShp}`;
        if (u.dying && !c.isWeaponUnit(u) && u.shp > 0 && !u.upOnShp) execute({ type: "standUp", actor: id });
        else {
          const target = c.EnemyAI.foes().find(f => !f.untargetable);
          const sk = c.skillList(u).find(s => s.id === u.kit + "_aa") || c.skillList(u).find(s => /_aa$/.test(s.id));
          if (!target || !sk || u.stunned || c.skillRequirementError(u, sk.id)) break;
          const range = c.skillRangeFor(u, sk.id) || { min: 0, max: 1 };
          const distance = c.zoneDist(u.zone, target.zone, st.zoneMode);
          if (distance < range.min || distance > range.max) {
            const direction = target.zone >= u.zone ? 1 : -1;
            const dest = Number(u.zone) + (distance > range.max ? direction : -direction);
            if (!(u.bonus > 0) || dest < 1 || dest > st.zoneMode) break;
            execute({ type: "move", actor: id, dest });
          } else execute({ type: "skill", actor: id, skill: sk.id, target: target.id, picks: {} });
        }
        react();
        const v = c.unitById(id);
        if (!v || `${v.ap}|${v.bonus}|${v.zone}|${v.dying}|${v.upOnShp}` === before) break;
      }
    }
    if (c.BattleSim.outcome()) break;
    execute({ type: "endTurn", seed: "end:" + st.turnNo }); react();
    for (const id of c.EnemyAI.actingOrder()) for (let n = 0; n < 5; n++) {
      const u = c.unitById(id);
      if (!u || !c.EnemyAI.unitAlive(u) || u.stunned || u.ap <= 0 || c.BattleSim.outcome()) break;
      const before = `${u.ap}|${u.bonus}|${u.zone}`;
      execute({ type: "battle.enemyAction", actor: id, step: n, seed: `act:${st.turnNo}:${id}:${n}` }); react();
      const v = c.unitById(id);
      if (!v || `${v.ap}|${v.bonus}|${v.zone}` === before) break;
    }
    if (!c.BattleSim.outcome()) { execute({ type: "battle.endEnemyTurn" }); react(); }
  }
  const winner = c.BattleSim.outcome();
  assert.ok(winner, "Encounter must reach an actual ending");
  execute({ type: "battle.finish", outcome: winner === "player" ? "win" : "lose" });
  assert.deepEqual(plain(c.__errors), []);
  return { state: plain(st), ledger: plain(c.LEDGER.save()), winner, seen: [...seen].sort() };
}
for (const seed of ["D1-ENTIRE-A", "D1-ENTIRE-B"]) {
  test(`固定种子整场旧调用与 JSON 往返指令完全一致：${seed}`, () => {
    const old = fight(false, seed), commands = fight(true, seed);
    assert.deepEqual(commands, old);
    for (const type of ["move", "skill", "endTurn", "battle.enemyAction", "blockAnswer", "battle.finish"]) assert.ok(commands.seen.includes(type), type);
  });
}

function pair(name, prepare, command, direct) {
  test(name, () => {
    const a = field(name), b = field(name);
    prepare(a); prepare(b);
    const cmd = command(b);
    direct(a, command(a));
    b.dispatch(plain(cmd));
    assert.deepEqual(plain(b.S.state), plain(a.S.state));
    assert.deepEqual(plain(b.LEDGER.save()), plain(a.LEDGER.save()));
  });
}
pair("分步技能完成 picks 沿用现有规则", c => { c.startCombat(); const u = c.findKit("tou", c.S.state.units); u.zone = 2; u.resources.shield = 3; }, c => {
  const u = c.findKit("tou", c.S.state.units), enemy = c.EnemyAI.foes()[0];
  return { type: "skill", actor: u.id, skill: "tou_sonic", target: enemy.id, picks: { target1: enemy.id, target2: null } };
}, legacy);
pair("战斗道具仍扣同一次附赠行动且记录治疗评分", c => { c.startCombat(); c.bagAdd("medkit", 1); c.findKit("ruby", c.S.state.units).layers[0].current = 1; }, c => ({ type: "useItem", actor: c.findKit("kolt", c.S.state.units).id, item: "medkit", target: c.findKit("ruby", c.S.state.units).id, dest: null }), legacy);
pair("起身状态与行动花费不变", c => { c.startCombat(); const u = c.findKit("ruby", c.S.state.units); u.layers.forEach(l => l.current = 0); u.dying = true; }, c => ({ type: "standUp", actor: c.findKit("ruby", c.S.state.units).id }), legacy);
pair("开战刀头选择不触发切刀追击", () => {}, c => ({ type: "openingChoice", actor: c.findKit("kolt", c.S.state.units).id, bit: "acid" }), (c, cmd) => { c.unitById(cmd.actor).resources.bit = "acid"; });
pair("撤退复用现有断后规则", c => c.startCombat(), c => ({ type: "retreat", rearguard: c.findKit("ruby", c.S.state.units).id }), (c, cmd) => c.performRetreat(cmd.rearguard));
pair("结构目标 token 经 JSON 往返保持危墙伤害", c => { c.startCombat(); const u = c.findKit("tou", c.S.state.units); u.resources.shield = 3; c.S.state.gaps["1-2"] = { ...c.emptyGap(), type: "wall", hp: 15, maxHp: 15, level: 1 }; }, c => ({ type: "skill", actor: c.findKit("tou", c.S.state.units).id, skill: "tou_sonic", target: "gap:1-2", picks: { target1: "gap:1-2", target2: null } }), legacy);
pair("格挡本人回答、固定检定和击中种子与旧调用等价", c => {
  c.startCombat(); const st = c.S.state, enemy = c.EnemyAI.foes()[0], target = c.findKit("tou", st.units);
  enemy.zone = target.zone; c.endPlayerTurn();
  st.attackerId = enemy.id; st.targetId = target.id; c.runSkill("en_aa");
  assert.ok(st.blockQueue.length, "real attack must enqueue a block prompt");
}, c => ({ type: "blockAnswer", helper: c.findKit("kolt", c.S.state.units).id, forced: { roll: 1, ok: true, chance: 100, iai: false }, seed: "hit:" + c.S.state.blockQueue[0].seq }), legacy);
pair("绯秋协助选刀与临时阵营恢复等价", c => {
  c.startCombat(); const st = c.S.state, target = c.EnemyAI.foes()[0], breaker = c.findKit("ruby", st.units), h = c.findKit("hiaki", st.units);
  h.zone = target.zone; target.def = 0; target.stunned = true; c.queueAssistAttack(breaker, target);
  assert.ok(st.assistQueue.length, "real stagger must enqueue assist");
  st.combatPhase = "enemy";
}, c => ({ type: "assistAnswer", helper: c.findKit("hiaki", c.S.state.units).id, extra: { blade: "naruto" } }), legacy);
pair("柯尔特切刀回答可包含同区追击目标", c => {
  c.startCombat(); const k = c.findKit("kolt", c.S.state.units); k.zone = c.EnemyAI.foes()[0].zone; c.queueKoltSwap(k);
}, c => ({ type: "koltSwapAnswer", swap: true, target: c.EnemyAI.foes()[0].id }), legacy);

test("Rogue 开战数据可往返，before仅通过本地上下文执行一次", () => {
  const a = field(), b = field();
  const spec = { party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "D1-ROGUE-SETUP" };
  let oldCalls = 0, commandCalls = 0;
  a.BattleSim.setup({ ...spec, before: st => { oldCalls++; st.scoreAct = 3; st.solo = null; } });
  b.dispatch(plain({ type: "battle.setupRogue", spec }), { before: st => { commandCalls++; st.scoreAct = 3; st.solo = null; } });
  assert.equal(oldCalls, 1); assert.equal(commandCalls, 1);
  assert.deepEqual(plain(b.S.state), plain(a.S.state));
  assert.ok(!JSON.parse(b.Commands.exportLog()).entries[0].command.spec.before);
});

for (const solo of [false, true]) for (const kind of ["battle", "elite", "boss", "ambush"]) {
  test(`真实 battleSpec 经网页同一适配进入指令：${solo ? "单人" : "多人"} ${kind}`, () => {
    const c = field();
    const options = solo
      ? { party: ["ruby"], partners: ["kolt", "yuito", "tou"], role2: "生存", solo: true, seed: "D1-SPEC" }
      : { party: ["ruby", "kolt"], seed: "D1-SPEC" };
    const run = c.Rogue.newRun(options);
    if (kind === "boss") run.stage = "boss";
    else {
      c.Rogue.acceptTask(run, "main");
      run.task.nodes[run.task.index] = { type: kind === "elite" ? "elite" : "battle", done: false };
      if (kind === "ambush") run.ambush = true;
    }
    const spec = c.Rogue.battleSpec(run), original = plain(spec);
    const originalEncounter = spec.encounter, originalRows = spec.encounter.enemies;
    const originalLevels = originalRows.map(row => ({ owns: Object.hasOwn(row, "level"), value: row.level }));
    const data = c.BattleCommands.battleSpecData(spec);
    assert.notEqual(data.encounter, originalEncounter);
    assert.notEqual(data.encounter.enemies, originalRows);
    assert.equal(Object.hasOwn(data, "before"), false);
    for (let i = 0; i < originalRows.length; i++) {
      assert.equal(Object.hasOwn(originalRows[i], "level"), originalLevels[i].owns, "legacy source is untouched");
      assert.equal(originalRows[i].level, originalLevels[i].value);
      if (originalLevels[i].value === undefined) assert.equal(Object.hasOwn(data.encounter.enemies[i], "level"), false);
      else assert.equal(data.encounter.enemies[i].level, originalLevels[i].value);
    }
    assert.deepEqual(plain(spec), original);
    c.dispatch({ type: "battle.setupRogue", spec: data }, { before: spec.before });
    assert.ok(c.S.state.units.some(u => !u.isPlayer));
    assert.equal(!!c.S.state.solo, solo);
    assert.equal(!!c.S.state.ambush, kind === "ambush");
    assert.deepEqual(plain(data), original);
  });
}

test("战斗配置适配不吞未知 undefined、函数或访问器", () => {
  const c = field();
  for (const bad of [undefined, () => {}]) {
    const spec = { party: ["ruby"], before() {}, encounter: { enemies: [{ preset: "thug_knife", level: undefined, extra: bad }] } };
    const data = c.BattleCommands.battleSpecData(spec);
    assert.equal(Object.hasOwn(data.encounter.enemies[0], "extra"), true);
    assert.throws(() => c.dispatch({ type: "battle.setupRogue", spec: data }), /JSON/);
  }
  let reads = 0;
  const row = { preset: "thug_knife", level: undefined };
  Object.defineProperty(row, "extra", { enumerable: true, get() { reads++; return 1; } });
  const data = c.BattleCommands.battleSpecData({ encounter: { enemies: [row] } });
  assert.throws(() => c.dispatch({ type: "battle.setupRogue", spec: data }), /accessor|non-JSON property/);
  assert.equal(reads, 0);
});

test("休整、背包治疗修理和遭遇抽取命令保持真实规则结果", () => {
  const a = field("D1-PANELS"), b = field("D1-PANELS");
  const game = { partyKits: ["ruby", "kolt", "hiaki", "tou"] };
  const cases = [
    [{ action: "cheat" }, c => c.cheatFillBag()],
    [{ action: "healItem", item: "medkit", kit: "ruby" }, c => c.ledgerHealItem("medkit", "ruby", [])],
    [{ action: "repair", kit: "mint" }, c => c.ledgerRepair("mint", [])],
    [{ action: "advance", hours: 3 }, c => c.ledgerAdvance(3, [])],
    [{ action: "shortRest", kits: ["ruby"] }, c => c.ledgerShortRest(["ruby"], [])],
    [{ action: "longRest", plan: { hours: 8, force: true, food: {} } }, c => c.ledgerLongRest({ hours: 8, force: true, food: {} }, [])],
    [{ action: "restore" }, c => c.ledgerRestoreAll([])]
  ];
  for (const [cmd, old] of cases) {
    old(a); b.dispatch(plain({ type: "battle.panel", ...cmd }), { game });
    assert.deepEqual(plain(b.S.state), plain(a.S.state), cmd.action);
    assert.deepEqual(plain(b.LEDGER.save()), plain(a.LEDGER.save()), cmd.action);
  }
  const encounterA = a.rollEncounter({ region: "外城区" });
  const encounterB = b.dispatch({ type: "battle.panel", action: "rollEncounter", region: "外城区", faction: null }).value;
  assert.deepEqual(plain(encounterB), plain(encounterA));
  b.dispatch(plain({ type: "battle.panel", action: "selectEncounter", encounter: encounterB }), { game });
  assert.deepEqual(plain(game.lastEncounter), plain(encounterA));
});

test("场地、队伍、配置物和背包面板命令无需 DOM，命令日志均可序列化", () => {
  const c = field(), st = c.S.state;
  const game = { partyKits: ["ruby", "kolt", "hiaki", "tou"], enemyPlan: [], level: 4 };
  const panel = cmd => c.dispatch(plain({ type: "battle.panel", ...cmd }), { game });
  panel({ action: "normalizeBag" }); panel({ action: "bagAdd", item: "medkit", amount: 2 });
  assert.equal(c.bagCount("medkit"), 2);
  panel({ action: "currency", amount: 12 }); panel({ action: "water", amount: 100 });
  panel({ action: "setZones", value: 3 }); panel({ action: "normalizeField" });
  panel({ action: "setField", zone: 3, kind: "fireOn" }); assert.equal(st.fields[3].fire, 1);
  panel({ action: "setGap", key: "2-3", kind: "wall" }); panel({ action: "gapHp", key: "2-3", hp: 7 }); assert.equal(st.gaps["2-3"].hp, 7);
  panel({ action: "rollWall", key: "2-3" }); assert.ok(st.gaps["2-3"].hp >= 1 && st.gaps["2-3"].hp <= 15);
  panel({ action: "setGap", key: "2-3", kind: "door" }); panel({ action: "toggleDoor", key: "2-3" }); assert.equal(st.gaps["2-3"].open, true);
  panel({ action: "setWeather", value: "sand", persist: true }); assert.equal(game.weather, "sand");
  panel({ action: "setPartySize", value: 3 }); assert.equal(st.partySize, 3);
  const added = panel({ action: "addParty", kit: "nora", zone: 3 }).value;
  assert.ok(c.unitById(added)); panel({ action: "removeParty", actor: added }); assert.equal(c.unitById(added), undefined);
  const count = st.units.length; panel({ action: "addEnemy", preset: "thug_knife", level: 2, zone: 3 }); assert.equal(st.units.length, count + 1);
  panel({ action: "removeEnemy", actor: st.units[st.units.length - 1].id }); assert.equal(st.units.length, count);
  const prop = panel({ action: "addProp", kind: "battery", zone: 2, level: 1, faction: "enemy" }).value;
  assert.ok(st.props.some(p => p.id === prop)); panel({ action: "removeProp", id: prop }); assert.ok(!st.props.some(p => p.id === prop));
  const log = JSON.parse(c.Commands.exportLog());
  assert.ok(log.entries.length > 10); assert.ok(log.entries.every(x => x.status === "ok"));
});

test("无效指令在写入状态前失败；D1不添加单位归属或顺序状态", () => {
  const c = field(), before = plain(c.S.state);
  assert.throws(() => c.dispatch({ type: "skill", actor: "missing", skill: "ruby_aa" }), /actor/);
  assert.throws(() => c.dispatch({ type: "battle.panel", action: "not-an-action" }), /panel/);
  for (const cmd of [{ action: "setField", kind: "arbitrary", zone: 1 }, { action: "setGap", key: "1-2", kind: "arbitrary" }, { action: "setWeather", value: "arbitrary" }, { action: "setGap", key: "arbitrary", kind: "wall" }, { action: "addProp", kind: "arbitrary", faction: "player" }]) assert.throws(() => c.dispatch({ type: "battle.panel", ...cmd }), /Unknown/);
  assert.throws(() => c.dispatch({ type: "move", actor: c.S.state.units[0].id, dest: undefined }), /JSON/);
  assert.deepEqual(plain(c.S.state), before);
});
