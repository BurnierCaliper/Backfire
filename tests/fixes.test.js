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
