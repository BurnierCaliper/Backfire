// 审计跟进：几个包合并后的衔接（桥塌坠落走统一倒地结算、收回为武器在扣费前置灰），说明见 README「规则改动记录」
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function setup(party, enemies) {
  const c = H.load();
  c.BattleSim.setup({ party: party || ["kolt", "helu"], enemies: enemies || [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "MERGE" });
  c.startCombat();
  return { c, S: c.S.state };
}
const kit = (S, k) => S.units.find(u => u.kit === k);
const bridge = () => ({ type: "bridge", hp: 1, maxHp: 10, open: true });

test("桥塌坠落走统一倒地结算：起身中的人这 10% 改扣坚毅生命，还站着", () => {
  const { c, S } = setup();
  const helu = kit(S, "helu"); helu.zone = 1; helu.ap = 1; helu.bonus = 1;
  S.gaps["1-2"] = bridge();
  helu.layers.forEach(l => { l.current = 0; });
  helu.upOnShp = true; helu.dying = false; helu.shp = 10; helu.shpMax = 20;
  const fall = Math.floor(c.totalMaxHp(helu) * 0.1);
  assert.ok(fall > 0);
  S.attackerId = helu.id;
  c.doMove(helu, 2);
  assert.equal(S.gaps["1-2"].type, "void");
  assert.equal(helu.zone, 1, "桥塌了，移动不生效");
  assert.equal(helu.shp, 10 - fall);
  assert.equal(helu.dying, false);
  assert.equal(helu.dead, false);
});

test("桥塌坠落走统一倒地结算：力竭 3 时摔到 0 直接死亡", () => {
  const { c, S } = setup();
  const helu = kit(S, "helu"); helu.zone = 1; helu.ap = 1; helu.bonus = 1;
  S.gaps["1-2"] = bridge();
  S.exhaustTier = 3;
  helu.layers.forEach(l => { l.current = 0; });
  helu.layers[helu.layers.length - 1].current = 1;
  S.attackerId = helu.id;
  c.doMove(helu, 2);
  assert.equal(helu.dead, true);
  assert.equal(helu.dying, false);
});

test("武器人主动收回为武器：和持有者不同区时按钮置灰（技能前提），同区可以", () => {
  const { c, S } = setup();
  const kolt = kit(S, "kolt"); kolt.zone = 1; kolt.ap = 2; kolt.bonus = 2;
  S.attackerId = kolt.id;
  c.runSkill("kolt_summon");
  const torque = kit(S, "torque");
  assert.ok(torque && !torque.hidden, "扭矩唤出来了");
  torque.zone = 2;
  assert.match(String(c.skillRequirementError(torque, "torque_return")), /同区/);
  torque.zone = 1;
  assert.equal(c.skillRequirementError(torque, "torque_return"), null);
});

test("非攻击击破（dealBreak）把深渊上空的飞行单位打落：共失去 30% 最大生命并离开深渊", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "crow", lv: 1, zone: 2 }]);
  const crow = S.units.find(u => u.kit === "crow");
  crow.layers.forEach(l => { l.current = l.max = 100; });
  crow.zone = 2; crow.flying = true; crow.def = crow.defMax = 1;
  S.fields[2] = Object.assign(S.fields[2] || {}, { abyss: true });
  const before = c.totalCurHp(crow);
  const notes = [];
  c.dealBreak(crow, 1, "ice", notes, "冻伤");
  assert.equal(crow.flying, false);
  assert.equal(before - c.totalCurHp(crow), 30, "击落 20 + 坠落 10");
  assert.notEqual(crow.zone, 2, "坠落后离开深渊");
  assert.equal(crow.dead, false);
});
