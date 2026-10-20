// 专长（二）：跑团专长点来源等级、多面手三项不同、警戒只打敌人且每人各出手（docs/bug-backlog.md「中 · 专长」）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");
const plain = (x) => JSON.parse(JSON.stringify(x));

function trpgHero(level) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [], seed: "FB107" });
  c.S.TRPG.active = true;
  const u = c.findKit("kolt", c.S.state.units);
  u.level = level; u.xp = 0; u.feats = [];
  return { c, u };
}

test("跑团专长点记来源等级：7 级给的点选不了 11 级的专长，升到 11 级后新点才能选", () => {
  const { c, u } = trpgHero(6);
  u.xp = c.xpToNext(6);
  c.tryLevelUp(u);
  assert.deepEqual(plain(u.featPointLevels), [7]);
  u.level = 10; u.xp = c.xpToNext(10);
  c.tryLevelUp(u);   // 升到 11：多一点（11 级）
  assert.deepEqual(plain(u.featPointLevels), [7, 11]);
  // 高层专长（11 级）：先用低等级的点选，应该被拒——只能用 11 级那点
  assert.match(c.trpgPickFeat("kolt", "charge")[0], /获得专长/);
  assert.deepEqual(plain(u.featPointLevels), [7], "高层专长用掉的是 11 级那一点");
  assert.deepEqual(plain(c.trpgPickFeat("kolt", "shove")), ["这项专长现在不能选。"]);
  assert.match(c.trpgPickFeat("kolt", "wanderer")[0], /荒原行者/);
  assert.deepEqual(plain(u.featPointLevels), []);
});

test("跑团专长点：只有 7 级的点时，高层专长不能选（即使角色已经 16 级）", () => {
  const { c, u } = trpgHero(16);
  u.featPoints = 1; u.featPointLevels = [7];
  assert.deepEqual(plain(c.trpgPickFeat("kolt", "charge")), ["这项专长现在不能选。"]);
  assert.equal(u.featPoints, 1);
});

test("旧档没有来源等级：按升级表补，不丢点（已选的占低等级，剩下的点对应高等级）", () => {
  const { c, u } = trpgHero(13);
  u.feats = ["wanderer"]; u.featPoints = 2; delete u.featPointLevels;
  assert.deepEqual(plain(c.featPointLevelsOf(u)), [11, 13]);
  u.feats = []; u.featPoints = 1; delete u.featPointLevels;
  assert.deepEqual(plain(c.featPointLevelsOf(u)), [7]);
  assert.equal(u.featPoints, 1);
});

test("多面手：三项熟练是三个不同的项目；已熟练的项仍可选来升级", () => {
  const c = H.load();
  const run = c.Rogue.newRun({ party: ["kolt", "helu"], seed: "FB107b", growth: true });
  const h = run.party[0];
  h.level = 7; h.feats = []; h.pending = [{ type: "feat", level: 7 }];
  c.Rogue.choose(run, h.kit, 0, "versatile");
  assert.equal(h.pending.length, 3);
  const first = c.Rogue.choiceOptions(run, h.kit, 0).map(o => o.value);
  const pick = first[0];
  c.Rogue.choose(run, h.kit, 0, pick);
  assert.ok(!c.Rogue.choiceOptions(run, h.kit, 0).some(o => o.value === pick), "第二项不能再选同一项");
  assert.throws(() => c.Rogue.choose(run, h.kit, 0, pick));
  const second = c.Rogue.choiceOptions(run, h.kit, 0)[0].value;
  c.Rogue.choose(run, h.kit, 0, second);
  const third = c.Rogue.choiceOptions(run, h.kit, 0).map(o => o.value);
  assert.ok(!third.includes(pick) && !third.includes(second));
  c.Rogue.choose(run, h.kit, 0, third[0]);
  assert.equal(h.pending.length, 0);
  assert.deepEqual(plain(h.profGroups || {}), {}, "选完清掉记录");
});

function alertBattle(extra) {
  const c = H.load();
  vm.runInContext("Math", c).random = () => 0.5;
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }].concat(extra || []), seed: "FB107c" });
  const S = c.S.state;
  const kolt = c.findKit("kolt", S.units), helu = c.findKit("helu", S.units);
  kolt.feats = ["alert"]; helu.feats = ["alert"];
  c.startCombat();
  S.combatPhase = "enemy";
  kolt.zone = 1; helu.zone = 1;
  kolt.bonus = 1; helu.bonus = 1;
  return { c, S, kolt, helu, foes: S.units.filter(u => !u.isPlayer && !u.dead) };
}

test("警戒：同区两个有警戒的人各自出手，各扣自己的附赠", () => {
  const { c, kolt, helu, foes } = alertBattle();
  const foe = foes[0];
  foe.zone = 1;
  c.featAlertOnEnter(foe, []);
  assert.equal(kolt.bonus, 0);
  assert.equal(helu.bonus, 0);
});

test("警戒：每人各算自己的附赠，没有附赠的不出手", () => {
  const { c, kolt, helu, foes } = alertBattle();
  helu.bonus = 0;
  foes[0].zone = 1;
  c.featAlertOnEnter(foes[0], []);
  assert.equal(kolt.bonus, 0);
  assert.equal(helu.bonus, 0);
});

test("警戒：中立生物走进来不触发", () => {
  const { c, S, kolt, helu } = alertBattle([{ id: "dust_bug", lv: 3, zone: 2 }]);
  const bug = S.units.find(u => u.kit === "dust_bug");
  assert.ok(bug, "场上有尘虫");
  bug.zone = 1;
  const n = [];
  c.featAlertOnEnter(bug, n);
  assert.equal(kolt.bonus, 1);
  assert.equal(helu.bonus, 1);
  assert.equal(n.length, 0);
});
