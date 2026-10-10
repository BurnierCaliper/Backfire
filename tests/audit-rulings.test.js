// 作者对 PR #23（第二批规则修复）逐条裁定后的调整：恶劣环境下的波谷、加倍计量翻倍震荡、猛扑越过空隙
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(party, enemies, opt) {
  const c = H.load();
  c.BattleSim.setup(Object.assign({ party: party || ["kolt", "helu"], enemies: enemies || [{ id: "thug_hammer", lv: 1, zone: 1 }], seed: "RUL" }, opt || {}));
  c.startCombat();
  const S = c.S.state;
  return { c, S, kit: k => c.findKit(k, S.units), foe: S.units.find(u => !u.isPlayer) };
}
const hit = (c, a, t, extra) => c.dealTo(a, t, Object.assign({ atk: 10, mult: 1, element: "physical", baseBreak: 0, atkRange: "any",
  flags: { action: true, blockResolved: true, block: "none" } }, extra || {}));

test("恶劣环境 / 末日：相位波谷的 −50% 伤害翻倍成 −100%（不是再乘一次 ×0.5）", () => {
  const { c, S, kit, foe } = field();
  const k = kit("kolt");
  k.zone = foe.zone = 1;
  foe.layers = [{ type: "flesh", current: 500, max: 500, inner: true }];
  S.weather = "phase"; S.phaseStep = 0;
  const normal = hit(c, k, foe).res.total;
  assert.ok(normal > 0);
  foe.harshEnv = true;
  assert.equal(hit(c, k, foe).res.total, 0, "波谷 −100%");
});

test("加倍计量：震荡扣的架势上限翻倍（−4），加倍计量结束后恢复成 −2，震荡解除后上限还原", () => {
  const { c, foe } = field();
  foe.def = foe.defMax = 10;
  foe.statuses.shockwave = true;
  c.syncShockwave(foe, []);
  assert.equal(foe.defMax, 8);
  foe.instant = foe.instant || {};
  foe.instant.doubleStatus = true;
  c.syncShockwave(foe, []);
  assert.equal(foe.defMax, 6, "加倍计量：−4");
  foe.instant.doubleStatus = false;
  c.syncShockwave(foe, []);
  assert.equal(foe.defMax, 8, "加倍计量结束：回到 −2");
  foe.statuses.shockwave = false;
  c.syncShockwave(foe, []);
  assert.equal(foe.defMax, 10);
});

test("猛扑是「跃」：带着同区目标越过空隙，目标不会掉下去", () => {
  const { c, S, kit, foe } = field(["tou", "kolt"]);
  const tou = kit("tou");
  const mochi = c.spawnWeapon(tou, "mochi");
  mochi.zone = foe.zone = 1; mochi.ap = 3; mochi.bonus = 3;
  foe.layers = [{ type: "flesh", current: 500, max: 500, inner: true }];
  S.gaps["1-2"] = { type: "void" };
  const steps = c.skillFlowSteps("mochi_pounce", mochi, { target: foe.id });
  assert.ok(steps[1].zones.includes(2), "空隙那边的区能选");
  S.attackerId = mochi.id; S.targetId = foe.id;
  S.skillFlow = { id: "mochi_pounce", actorId: mochi.id, picks: { target: foe.id, dest: 2 }, index: 99 };
  try { c.runSkill("mochi_pounce"); } finally { S.skillFlow = null; }
  assert.equal(mochi.zone, 2);
  assert.equal(foe.zone, 2, "目标一起过去了，没有掉进空隙");
});
