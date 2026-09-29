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
