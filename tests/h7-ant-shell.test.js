// H7：蚁型戒备兵种的大酸液弹发射按标定落点打，主目标那一下不受普通攻击射程限制
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

const tank = u => u.layers.forEach(l => { l.max = 999; l.current = 999; });

/** 三区战场：蚁型戒备兵种在 antZone，柯尔特在 koltZone，拉斯在 rasZone */
function field(antZone, koltZone, rasZone) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "ras"], enemies: [{ id: "ant_guard", lv: 3, zone: antZone }], seed: "H7", zoneMode: 3 });
  c.startCombat();
  const S = c.S.state;
  S.zoneMode = 3; S.combatPhase = "enemy";
  const e = S.units.find(u => !u.isPlayer && u.kit === "ant_guard");
  const kolt = c.findKit("kolt", S.units), ras = c.findKit("ras", S.units);
  [kolt, ras].forEach(tank);
  e.zone = antZone; kolt.zone = koltZone; ras.zone = rasZone;
  return { c, S, e, kolt, ras };
}
function fire(f, zone) {
  Object.assign(f.e.resources, { shellZone: zone, shellPending: true, shellReady: true });
  f.S.attackerId = f.e.id; f.S.targetId = f.kolt.id;
  f.c.runSkill("en_ant_shell_fire");
  f.c.BattleSim.resolveQueues({ pickBlocker: () => null, pickAssister: l => l[0].id });   // 不格挡，直接结算
}

test("H7 落点就在自己所在的区：区内的人都受伤（主目标不被射程吞掉）", () => {
  const f = field(2, 2, 2);
  const hp = [f.kolt, f.ras].map(u => f.c.totalHp(u));
  fire(f, 2);
  const lost = [f.kolt, f.ras].map((u, i) => hp[i] - f.c.totalHp(u));
  assert.ok(lost.every(n => n > 0), "两人都应受伤");
  assert.ok(Math.max(...lost) > 6 + 3, "其中一人挨的是 2×atk 的主目标那一下，远大于波及的 等级 + 1d6");
});
test("H7 落点隔两个区（三区战场）：主目标照样挨一下", () => {
  const f = field(1, 3, 3);
  const hp = [f.kolt, f.ras].map(u => f.c.totalHp(u));
  fire(f, 3);
  const lost = [f.kolt, f.ras].map((u, i) => hp[i] - f.c.totalHp(u));
  assert.ok(lost.every(n => n > 0), "两人都应受伤");
  assert.ok(Math.max(...lost) > 6 + 3, "主目标那一下 2×atk 应该打出来");
});
test("H7 波及照旧：落点区外的人不受伤", () => {
  const f = field(1, 3, 2);
  const hp = f.c.totalHp(f.ras);
  fire(f, 3);
  assert.equal(f.c.totalHp(f.ras), hp);
});
