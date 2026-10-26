// 零散修正：自爆小车不分敌我、远程敌人挑打得到的目标、震荡降架势上限、耐久为 0 的提醒
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(enemies) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], seed: "FIX", enemies });
  c.startCombat();
  return { c, st: c.S.state, k: id => c.findKit(id, c.S.state.units) };
}

test("自爆小车：引爆是同区不分敌我的范围伤害，玩家不会卡在协助格挡上", () => {
  const { c, st, k } = field([{ id: "boomcar", lv: 1, zone: 1 }, { id: "thug_hammer", lv: 1, zone: 1 }]);
  st.units.forEach(u => { u.zone = 1; });
  const car = k("boomcar"), th = k("thug_hammer"), kolt = k("kolt"), helu = k("helu");
  const before = [kolt, helu, th].map(u => c.totalHp(u));
  st.combatPhase = "enemy"; car.ap = 1; st.attackerId = car.id; st.targetId = kolt.id;
  c.runSkill("en_boom_fuse");
  [kolt, helu, th].forEach((u, i) => assert.ok(c.totalHp(u) < before[i], u.name + " 应当被炸到"));
  assert.ok(!st.pendingBlock, "范围伤害不能协助格挡");
});

test("自爆小车：敌人回合引爆后当场死亡、离场（不会只剩 0 血还算活着），也不再触发死亡引爆", () => {
  const { c, st, k } = field([{ id: "boomcar", lv: 3, zone: 1 }]);
  st.units.forEach(u => { u.zone = 1; });
  const car = k("boomcar"), kolt = k("kolt");
  car.resources.fuse = 0;
  c.endPlayerTurn();
  const hp0 = c.totalHp(kolt);
  const r = c.BattleCommands.execute({ type: "battle.enemyAction", actor: car.id, step: 0 });
  assert.equal(r.executed, true);
  assert.equal(car.dead, true, "自爆后死亡");
  assert.equal(car._removed, true, "离场");
  assert.ok(!c.EnemyAI.foes().includes(car), "不再算活着的敌人");
  const lost = hp0 - c.totalHp(kolt);
  assert.ok(lost > 0, "炸到了同区的柯尔特");
  // 只炸一次：清场时不会再走一遍「死亡引爆」
  assert.equal(st.logPages.flatMap(p => p.lines).map(l => l.text).join("\n").includes("死亡引爆"), false);
});

test("远程敌人：有隔一区的目标就打它，不去瞄准同区打不到的人", () => {
  const { c, st, k } = field([{ id: "dumpdrone", lv: 1, zone: 1 }]);
  const drone = st.units.find(u => !u.isPlayer);
  const kolt = k("kolt"), helu = k("helu");
  drone.zone = 1; kolt.zone = 1; helu.zone = 2;
  const spec = c.S.EnemyAI.SPEC[drone.kit];
  const pick = c.S.EnemyAI.target(drone, spec, c.S.EnemyAI.players());
  assert.equal(pick.unit, helu);
});

test("震荡：架势上限 −2（最少留 1），状态解除后还回去", () => {
  const { c, st } = field([{ id: "thug_hammer", lv: 1, zone: 1 }]);
  const foe = st.units.find(u => !u.isPlayer);
  foe.defMax = 5; foe.def = 5;
  foe.statuses.shockwave = true;
  c.popStatus(foe, "shockwave");
  assert.equal(foe.defMax, 3);
  assert.equal(foe.def, 3);
  foe.statuses.shockwave = false;
  c.syncShockwave(foe, []);
  assert.equal(foe.defMax, 5);
  foe.defMax = 2; foe.statuses.shockwave = true;
  c.syncShockwave(foe, []);
  assert.equal(foe.defMax, 1);
});

test("单局：列出耐久为 0 的武器，开战前给提醒", () => {
  const c = H.load();
  const run = c.Rogue.newRun({ party: ["kolt", "helu"], seed: "BRK" });
  assert.equal(c.Rogue.brokenWeapons(run).length, 0);
  c.S.LEDGER.dur.torque = 0;
  const b = c.Rogue.brokenWeapons(run);
  assert.equal(b.length, 1);
  assert.equal(b[0].kit, "torque");
});

test("敌人做决定用固定随机数：局势不变时同一回合的决定总是一样（环境监测的预测靠这个）", () => {
  const { c, st } = field([{ id: "thug_hammer", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }]);
  st.units.forEach(u => { u.zone = 1; });
  st.combatPhase = "enemy";
  st.units.filter(u => !u.isPlayer).forEach(u => {
    u.ap = 1;
    const a = c.S.EnemyAI.planFor(u, 0), b = c.S.EnemyAI.planFor(u, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(a.meta)), JSON.parse(JSON.stringify(b.meta)));
  });
});

test("灯 · 声波切割：同区主目标 1atk + 距离 1 第二目标 0.5atk，消耗 1 圣盾", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["tou", "kolt"], seed: "SONIC", enemies: [{ id: "thug_hammer", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 2 }] });
  c.startCombat();
  const st = c.S.state;
  const tou = c.findKit("tou", st.units);
  tou.level = 2; tou.zone = 1;
  const [near, far] = st.units.filter(u => !u.isPlayer);
  near.zone = 1; far.zone = 2;
  tou.resources.shield = 1;
  const h1 = c.totalHp(near), h2 = c.totalHp(far);
  st.attackerId = tou.id; st.targetId = near.id;
  st.skillFlow = { id: "tou_sonic", actorId: tou.id, picks: { target1: near.id, target2: far.id }, index: 99 };
  c.runSkill("tou_sonic");
  st.skillFlow = null;
  assert.ok(c.totalHp(near) < h1, "同区主目标应当受伤");
  assert.ok(c.totalHp(far) < h2, "距离 1 的第二目标应当受伤");
  assert.equal(tou.resources.shield, 0);
});

test("声波切割：只选同区目标、只选距离 1 的目标都能用", () => {
  for (const which of ["near", "far"]) {
    const c = H.load();
    c.BattleSim.setup({ party: ["tou", "kolt"], seed: "SONIC2", enemies: [{ id: "thug_hammer", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 2 }] });
    c.startCombat();
    const st = c.S.state;
    const tou = c.findKit("tou", st.units);
    tou.level = 2; tou.zone = 1; tou.resources.shield = 1;
    const [near, far] = st.units.filter(u => !u.isPlayer);
    near.zone = 1; far.zone = 2;
    const tgt = which === "near" ? near : far, other = which === "near" ? far : near;
    const steps = c.skillFlowSteps("tou_sonic", tou, {});
    assert.ok(steps.length >= 1 && steps.every(s => s.type === "unit"));
    const h = c.totalHp(tgt), ho = c.totalHp(other);
    st.attackerId = tou.id; st.targetId = tgt.id;
    st.skillFlow = { id: "tou_sonic", actorId: tou.id, picks: which === "near" ? { target1: near.id, target2: null } : { target1: null, target2: far.id }, index: 99 };
    c.runSkill("tou_sonic");
    st.skillFlow = null;
    assert.ok(c.totalHp(tgt) < h, which + " 目标应当受伤");
    assert.equal(c.totalHp(other), ho);
    assert.equal(tou.resources.shield, 0);
  }
});

test("沙暴风向：每场随机（不再总是同一个方向）；有释放者时对他所在区顺风", () => {
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    const c = H.load();
    c.BattleSim.setup({ party: ["kolt", "helu"], seed: "SAND" + i, weather: "sand", enemies: [{ id: "thug_hammer", lv: 1, zone: 2 }] });
    seen.add(c.S.state.sandDir);
  }
  assert.deepEqual([...seen].sort(), ["12", "21"]);
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], seed: "SANDC", enemies: [{ id: "thug_hammer", lv: 1, zone: 2 }] });
  c.setWeather("sand", { casterZone: 2 });
  assert.equal(c.sandWind(2, c.S.state.zoneMode, c.S.state.sandDir), 1, "释放者所在的 2 区顺风");
  c.setWeather("none"); c.setWeather("sand", { casterZone: 1 });
  assert.equal(c.sandWind(1, c.S.state.zoneMode, c.S.state.sandDir), 1, "释放者所在的 1 区顺风");
});

test("空投蜂群：架势无论几级、几人队都不超过 3", () => {
  const c = H.load();
  const p = c.enemyPresets().find(x => x.id === "swarm");
  for (const lv of [1, 5, 10, 15, 20, 25]) for (const n of [2, 3, 4]) {
    const u = p.build(lv, n);
    assert.ok(u.defMax <= 3 && u.def <= 3, `Lv${lv} ${n} 人队：架势 ${u.def}/${u.defMax}`);
  }
});

test("绯秋普攻的射程按刀势：拔刀 / 胁构只打同区，居合可以移动 1 距离再打", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["hiaki", "kolt"], seed: "HIAKI", enemies: [{ id: "thug_hammer", lv: 1, zone: 2 }] });
  c.startCombat();
  const st = c.S.state;
  const h = c.findKit("hiaki", st.units);
  const foe = st.units.find(u => !u.isPlayer);
  h.zone = 1; foe.zone = 2;
  const hp0 = c.totalHp(foe);
  for (const stance of ["draw", "waki"]) {
    h.resources.stance = stance; h.ap = 1;
    st.attackerId = h.id; st.targetId = foe.id;
    c.runSkill("hiaki_aa");
    assert.equal(c.totalHp(foe), hp0, stance + " 不应当打到距离 1");
    assert.equal(h.ap, 1, stance + " 打不到时不扣行动点");
  }
  h.resources.stance = "iai"; h.ap = 1;
  c.runSkill("hiaki_aa");
  assert.ok(c.totalHp(foe) < hp0, "居合移动后打到");
  assert.equal(Number(h.zone), 2);
});

test("夕夏全速撞击：物理伤害 + 震荡 + 每移 1 格 +1 击破，不附带错位", () => {
  const H = require("./headless");
  const c = H.load();
  c.BattleSim.setup({ party: ["xia"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }] });
  c.startCombat();
  const st = c.S.state;
  const xia = c.findKit("xia", st.units), foe = st.units.find(u => !u.isPlayer);
  xia.zone = 1; foe.zone = 2;
  xia.level = 3;
  xia.resources.engine = true;
  xia.ap = 1;
  const layer0 = foe.layers[0].type;
  st.attackerId = xia.id; st.targetId = foe.id;
  st.skillFlow = { id: "xia_ram", picks: { dest: 2, target: foe.id } };
  c.runSkill("xia_ram");
  assert.equal(xia.zone, 2);
  assert.equal(foe.statuses.shockwave, true);
  assert.ok(!(foe.instant && foe.instant.shift), "不应有错位");
  assert.equal(foe.layers[0].type, layer0, "外层没有被互换");
});

test("沙暴逆风：飞行杂兵 25% 概率不扣行动点；精英、首领照扣", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt"], enemies: [{ id: "crow", lv: 1, zone: 1 }, { id: "watchcrow", lv: 4, zone: 1 }] });
  const st = c.S.state;
  st.weather = "sand";
  const crow = st.units.find(u => u.kit === "crow"), wc = st.units.find(u => u.kit === "watchcrow");
  // 找一个逆风的区
  const zone = [1, 2, 3].slice(0, Number(st.zoneMode)).find(z => c.sandWind(z, st.zoneMode, st.sandDir) < 0);
  if (zone == null) return;
  crow.zone = zone; wc.zone = zone;
  let kept = 0, wcKept = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    c.refreshEnemyEconomy(crow);
    if (crow.ap >= 1) kept++;
    c.refreshEnemyEconomy(wc);
    const full = c.enemyActBudget(wc).ap;
    if (wc.ap >= full) wcKept++;
  }
  assert.ok(kept > N * 0.15 && kept < N * 0.35, `杂兵保留行动点 ${kept}/${N}`);
  assert.equal(wcKept, 0, "精英照扣");
});
