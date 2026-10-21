// #203（主人定 10/21）：过载反伤打死的敌人算过载者的击杀；过载者不是玩家时照旧
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function setup(party, enemies, seed) {
  const c = H.load();
  c.BattleSim.setup({ party, enemies, seed: seed || "I203", zoneMode: 3 });
  c.startCombat();
  const S = c.S.state;
  S.units.forEach(u => { u.zone = 1; });   // 全员同区：近距离攻击
  return { c, S };
}
const kit = (S, k) => S.units.find(u => u.kit === k && !u.hidden);
const kills = (c, u) => (c.battleStat(u) || {}).kills || 0;
const hit = (c, a, t, opt) => c.dealTo(a, t, Object.assign({ atk: 0, mult: 0, element: "physical", baseBreak: 0, atkRange: "any",
  flags: { action: true, blockResolved: true, block: "none" } }, opt));
/** 过载反伤只在装甲血量受到近距离攻击时触发：外层换成一层厚装甲，再施加过载 */
function overloadArmor(c, u) {
  u.layers = [{ type: "armor", current: 300, max: 300 }, { type: "flesh", current: 50, max: 50, inner: true }];
  c.applyInstantEffect(u, "overload", []);
}

test("玩家带过载被近战打，反伤打死攻击者：击杀算这名玩家（没人打过它也算）", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "thug_hammer", lv: 1, zone: 1 }]);
  const kolt = kit(S, "kolt"), helu = kit(S, "helu"), foe = S.units.find(u => !u.isPlayer);
  overloadArmor(c, helu);
  foe.layers = [{ type: "flesh", current: 1, max: 50, inner: true }];
  c.beginActionAcc(foe);                        // 敌人回合：狂徒出手
  const out = hit(c, foe, helu, { flat: 40 });
  assert.ok(out.extra.some(t => /过载反伤/.test(t)), "触发了过载反伤：" + JSON.stringify(out.extra));
  c.sweepDeadEnemies();
  assert.equal(foe._xpGiven, true, "反伤打死了它");
  assert.equal(kills(c, helu), 1, "算过载的 Helumica");
  assert.equal(kills(c, kolt), 0);
});

test("那个敌人之前被别的玩家打过：反伤补刀仍算过载者", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "thug_hammer", lv: 1, zone: 1 }]);
  const kolt = kit(S, "kolt"), helu = kit(S, "helu"), foe = S.units.find(u => !u.isPlayer);
  overloadArmor(c, helu);
  foe.layers = [{ type: "flesh", current: 500, max: 500, inner: true }];
  hit(c, kolt, foe, { flat: 10 });
  assert.equal(foe._lastHitBy, kolt.id, "柯尔特先打过它");
  foe.layers[0].current = 1;                    // 反伤落下前把血压到 1
  c.beginActionAcc(foe);
  hit(c, foe, helu, { flat: 40 });
  c.sweepDeadEnemies();
  assert.equal(foe._xpGiven, true, "反伤打死了它");
  assert.equal(kills(c, helu), 1, "算过载者 Helumica");
  assert.equal(kills(c, kolt), 0, "不算之前打过它的柯尔特");
});

test("过载者不是玩家：照旧（敌人带过载照样反伤玩家；敌人之间的反伤不改最后一击）", () => {
  // 敌人带过载，被柯尔特近战打：柯尔特照样挨 50% 反伤，这个敌人的最后一击仍是柯尔特
  {
    const { c, S } = setup(["kolt", "helu"], [{ id: "thug_hammer", lv: 1, zone: 1 }]);
    const kolt = kit(S, "kolt"), foe = S.units.find(u => !u.isPlayer);
    overloadArmor(c, foe);
    const hp = c.totalCurHp(kolt);
    c.beginActionAcc(kolt);
    const out = hit(c, kolt, foe, { flat: 40 });
    assert.ok(out.extra.some(t => /过载反伤 → 柯尔特/.test(t)), "反伤柯尔特：" + JSON.stringify(out.extra));
    assert.ok(c.totalCurHp(kolt) < hp, "柯尔特挨了反伤");
    assert.equal(foe._lastHitBy, kolt.id);
  }
  // 敌人之间（敌人回合）：带过载的狂徒（锤）反伤打死来打它的狂徒（匕首），击杀照旧算之前最后打过它的柯尔特
  {
    const { c, S } = setup(["kolt", "helu"], [{ id: "thug_hammer", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }]);
    const kolt = kit(S, "kolt"), helu = kit(S, "helu");
    const [hammer, knife] = S.units.filter(u => !u.isPlayer);
    overloadArmor(c, hammer);
    knife.layers = [{ type: "flesh", current: 500, max: 500, inner: true }];
    hit(c, kolt, knife, { flat: 10 });
    knife.layers[0].current = 1;
    c.beginActionAcc(knife);
    const out = hit(c, knife, hammer, { flat: 40 });
    assert.ok(out.extra.some(t => /过载反伤/.test(t)), "触发了过载反伤：" + JSON.stringify(out.extra));
    c.sweepDeadEnemies();
    assert.equal(knife._xpGiven, true, "反伤打死了它");
    assert.equal(kills(c, kolt), 1, "照旧算柯尔特");
    assert.equal(kills(c, helu), 0);
  }
});
