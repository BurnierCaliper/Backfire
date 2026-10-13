// 下潜（effects.js · submergeUnit / surfaceUnit；app.js · dealTo、triggerCollapse）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(seed) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "sand_beast", lv: 3, zone: 1 }, { id: "sand_beast", lv: 3, zone: 1 }], seed });
  c.startCombat();
  const st = c.S.state;
  const kolt = c.findKit("kolt", st.units);
  const foes = st.units.filter(u => !u.isPlayer && !u.dead);
  kolt.zone = 1;
  return { c, st, kolt, foes };
}
const hit = (c, a, t, element, flags) => c.dealTo(a, t, { atk: 10, mult: 1, element, baseBreak: 0, atkRange: "any",
  flags: Object.assign({ action: true, blockResolved: true, block: "none" }, flags || {}) });

test("下潜中：单体选不中，范围攻击打不到；HP 和架势都不变", () => {
  const { c, kolt, foes } = field("SUB1");
  const f = foes[0];
  c.submergeUnit(f, []);
  const hp = c.totalHp(f), def = f.def;
  assert.equal(hit(c, kolt, f, "physical").res.ok, false);
  assert.equal(hit(c, kolt, f, "fire", { aoe: true }).res.ok, false);
  assert.equal(c.totalHp(f), hp);
  assert.equal(f.def, def);
  assert.equal(f.submerged, true);
});

test("谐波攻击打得到下潜的单位（单体、范围都算），打到就被迫解除并受 1 击破", () => {
  for (const aoe of [false, true]) {
    const { c, kolt, foes } = field("SUB2" + aoe);
    const f = foes[0];
    c.submergeUnit(f, []);
    const def = f.def, hp = c.totalHp(f);
    const r = hit(c, kolt, f, "harmonic", { aoe });
    assert.notEqual(r.res.ok, false);
    assert.equal(f.submerged, false);
    assert.ok(f.def <= def - 1, `架势 ${def} → ${f.def}`);
    assert.ok(c.totalHp(f) < hp);
  }
});

test("塌陷打得到下潜的单位，并被迫解除 +1 击破（共 3 击破）", () => {
  const { c, st, foes } = field("SUB3");
  const f = foes[0];
  st.fields[1].collapseOn = true;
  c.submergeUnit(f, []);
  const def = f.def;
  c.triggerCollapse(1);
  assert.equal(f.submerged, false);
  assert.equal(def - f.def, Math.min(def, 3));
});

test("下潜的单位发动攻击：自己解除下潜，没有击破", () => {
  const { c, kolt, foes } = field("SUB4");
  const f = foes[0];
  c.submergeUnit(f, []);
  const def = f.def;
  hit(c, f, kolt, "physical");
  assert.equal(f.submerged, false);
  assert.equal(f.def, def);
});

test("下潜的单位不会被敌人 AI 当成目标；状态栏写下潜", () => {
  const { c, st, foes } = field("SUB5");
  const f = foes[0];
  c.submergeUnit(f, []);
  assert.match(c.statusLine(f), /下潜/);
  // 让沙灵互相敌对一下：另一只沙灵的 AI 找猎物时不会挑下潜的那只
  st.playerAllies = null;
  const other = foes[1];
  // 敌人找猎物：我方两人都下潜了，沙灵没有可打的人（不行动）
  st.units.filter(u => u.isPlayer).forEach(u => c.submergeUnit(u, []));
  assert.equal(c.EnemyAI.plan(other), null);
  st.units.filter(u => u.isPlayer).forEach(u => c.surfaceUnit(u, [], false));
  assert.notEqual(c.EnemyAI.plan(other), null);
  assert.ok(other);
});

test("沙漠生物和沙灵互相敌对", () => {
  const c = H.load();
  const info = c.enemyInfo("sand_beast");
  assert.equal(info.faction, "沙灵");
  const real = c.enemyInfo;
  c.enemyInfo = (k) => k === "fake_desert" ? { faction: "沙漠生物" } : real(k);
  assert.equal(c.hostileTo({ kit: "fake_desert" }, { kit: "sand_beast" }), true);
  assert.equal(c.hostileTo({ kit: "fake_desert" }, { kit: "thug_knife" }), false);
});
