// 训练场四条（issue #105）：聚焦抹层、假人反应攻击、「重新开始」重开训练、假人架势无限
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(opts) {
  const c = H.load();
  c.Training.setupField("ruby", 10, opts || {});
  const S = c.S.state;
  const dummy = S.units.find(u => u.trainingDummy);
  const hero = S.units.find(u => u.isPlayer);
  return { c, S, dummy, hero };
}

test("聚焦抹层：假人被抹掉内层后补满，不是 0/0；外层被抹也会补回来", () => {
  [["flesh"], ["shield", "armor", "flesh"]].forEach(layers => {
    const { c, S, dummy } = field({ layers });
    const spec = dummy.layers.map(l => [l.type, l.max]);
    // 抹最里层（单位按内层归零）
    const inner = dummy.layers[layers.length - 1].type;
    dummy.focuses = [{ layerType: inner }];
    c.stripFocusLayer(dummy, inner, []);
    c.Training.tick();
    assert.deepEqual(dummy.layers.map(l => [l.type, l.max]), spec, "层的种类和最大值照原样");
    assert.ok(dummy.layers.every(l => l.current === l.max && l.max > 0 && !l.sealed), "补满且没有封死");
    assert.ok(!dummy.dead && !dummy.focuses.length);
    assert.ok(c.Training.damage(S) > 0, "被抹掉的血照记进总伤害");
    if (layers.length > 1) {   // 抹最外层（不是内层：这层会被直接移出 layers）
      const outer = dummy.layers[0].type;
      dummy.focuses = [{ layerType: outer }];
      c.stripFocusLayer(dummy, outer, []);
      c.Training.tick();
      assert.deepEqual(dummy.layers.map(l => [l.type, l.max]), spec);
      assert.ok(dummy.layers.every(l => l.current === l.max && l.max > 0));
    }
  });
});

test("假人不做反应攻击：借机攻击和协助攻击都不出手", () => {
  const { c, dummy, hero } = field();
  const hp0 = c.totalHp(hero);
  hero.def = 0; hero.stunned = true;
  assert.ok(!c.eligibleAssisters(null, hero).some(u => u.trainingDummy), "假人不在协助名单里");
  c.queueAssistAttack(null, hero);
  assert.equal(c.totalHp(hero), hp0, "假人没有协助攻击");
  hero.stunned = false; hero.def = hero.defMax;
  dummy.zone = 1;
  c.opportunityStrike(dummy, hero, 1, {});
  assert.equal(c.totalHp(hero), hp0, "假人没有借机攻击");
});

test("训练场里的「重新开始」重开这一场训练：训练状态重置，假人满血", () => {
  const c = H.load();
  c.GAME = { startCustomBattle: (title, setup) => setup() };
  c.Training.start("ruby", 10, { layers: ["armor", "flesh"] });
  c.S.state.training.turn = 5; c.S.state.training.per = [1, 2, 3];
  assert.equal(c.Training.restart(), true);
  const S2 = c.S.state;
  assert.equal(S2.training.turn, 0);
  assert.deepEqual(Array.from(S2.training.per), []);
  assert.deepEqual(S2.units.find(u => u.trainingDummy).layers.map(l => l.type), ["armor", "flesh"], "布置用的还是原来的选项");
  c.Training.active = false;
  assert.equal(c.Training.restart(), false, "不在训练场里：什么也不做，交给普通战斗的重新开始");
});

test("假人架势无限：怎么打、什么效果都不会失衡，架势始终是满的", () => {
  const { c, dummy, hero } = field();
  const full = dummy.defMax;
  const ok = () => { assert.ok(!dummy.stunned, "没有失衡"); assert.equal(dummy.def, full, "架势是满的"); };
  c.dealBreak(dummy, 5e6, "physical", [], "击破", { by: hero }); ok();
  c.dealBreak(dummy, Math.ceil(full * 0.9), "physical", [], "按比例扣", { by: hero }); ok();
  c.itemStun(dummy, []); ok();
  c.applyUnstable(dummy, []); c.applyUnstable(dummy, []); ok();
  c.dmForceStun(dummy); c.Training.tick(); ok();
  dummy.def = 0; dummy.stunned = true; c.Training.tick(); ok();
  for (let i = 0; i < 30; i++) {
    c.dealTo(hero, dummy, { baseBreak: 50 });
    c.Training.tick();
  }
  ok();
});

test("假人的卡片和详情写「架势 ∞」", () => {
  const { c, dummy } = field();
  assert.match(c.defText(dummy), /∞/);
  assert.equal(c.defText({ def: 3, defMax: 5 }), "3/5");
});
