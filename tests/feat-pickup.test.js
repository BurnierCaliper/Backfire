// H4：专长「拉一把」认得医疗包（治疗骰统一读 ITEM_CATALOG[id].heal），强心注射剂不算医疗道具
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function setup() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "H4" });
  const S = c.S.state;
  const [a, t] = ["kolt", "helu"].map(k => c.findKit(k, S.units));
  a.feats = ["pickup"];
  c.startCombat();
  a.zone = t.zone = 1; a.ap = 2;
  c.bagAdd("medkit", -c.bagCount("medkit"), []);
  c.bagAdd("clinic", -c.bagCount("clinic"), []);
  c.bagAdd("stim", -c.bagCount("stim"), []);
  return { c, S, a, t };
}
function down(t) {
  t.layers.forEach(l => { l.current = 0; });
  t.dying = true; t.shp = 10; t.shpMax = 20;
}
function pick(c, S, a, t) {
  S.attackerId = a.id; S.targetId = t.id;
  S.skillFlow = { id: "feat_pickup", actorId: a.id, picks: { target: t.id, item: "medkit" }, index: 0 };
  c.runSkill("feat_pickup");
  S.skillFlow = null;
}

test("拉一把：背包里有简易医疗包就能用，对方以 7–10 起身、少一件医疗包、坚毅生命不变、每场 1 次", () => {
  const { c, S, a, t } = setup();
  c.bagAdd("medkit", 2, []);
  down(t);
  assert.equal(c.featSkillWhy(a, "feat_pickup"), null);
  pick(c, S, a, t);
  assert.equal(t.dying, false);
  const hp = c.totalHp(t);
  assert.ok(hp >= 7 && hp <= 10, "治疗量 1d4+6，实际 " + hp);
  assert.equal(c.bagCount("medkit"), 1);
  assert.equal(t.shp, 10, "坚毅生命不变");
  down(t);
  assert.ok(c.featSkillWhy(a, "feat_pickup"), "每场只能用 1 次");
});

test("拉一把：背包里只有强心注射剂不可用，并给出原因", () => {
  const { c, a } = setup();
  c.bagAdd("stim", 1, []);
  assert.equal(c.featHealItems().length, 0);
  assert.match(c.featSkillWhy(a, "feat_pickup") || "", /没有医疗道具/);
});

test("医疗包治疗骰只写在 ITEM_CATALOG：简易 1d4+6、诊所 2d4+6，平时直接使用的治疗量不变", () => {
  const { c, S, a, t } = setup();
  assert.deepEqual({ ...c.itemHealSpec("medkit") }, { n: 1, s: 4, flat: 6 });
  assert.deepEqual({ ...c.itemHealSpec("clinic") }, { n: 2, s: 4, flat: 6 });
  assert.equal(c.itemHealSpec("stim"), null);
  for (const [id, lo, hi] of [["medkit", 7, 10], ["clinic", 8, 14]]) {
    for (let i = 0; i < 30; i++) {
      t.layers.forEach(l => { l.current = 1; });
      c.bagAdd(id, 1, []);
      const before = c.totalHp(t);
      c.useItemOn(a, id, t);
      const got = c.totalHp(t) - before;
      assert.ok(got >= lo && got <= hi, `${id} 治疗 ${got}`);
    }
  }
});
