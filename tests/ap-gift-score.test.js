// 队友给的行动点（意式浓缩……）：用它出手的那次行动，分数一半记在给行动点的人身上（app.js · grantAllyAp / apShareFor）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");

function battle(seed) {
  const c = H.load();
  vm.runInContext("Math", c).random = () => 0.5;
  c.BattleSim.setup({ party: ["yuito", "kolt"], enemies: [{ id: "thug_knife", lv: 3, zone: 1 }], seed: seed || "APG" });
  c.startCombat();
  const S = c.S.state;
  const yuito = c.findKit("yuito", S.units), kolt = c.findKit("kolt", S.units);
  const foe = S.units.find(u => !u.isPlayer);
  foe.layers = [{ type: "flesh", current: 500, max: 500 }];
  yuito.zone = kolt.zone = foe.zone;
  return { c, S, yuito, kolt, foe };
}
const scoreOf = (c, u) => (c.S.state.battleStats || {})[u.id] ? c.S.state.battleStats[u.id].score || 0 : 0;
function attack(c, S, u, foe) { S.attackerId = u.id; S.targetId = foe.id; S.skillFlow = null; c.runSkill("kolt_aa"); }

test("意式浓缩给的行动点：柯尔特用它出手，这次行动的分数一半记在结人身上，队伍总分不变", () => {
  const { c, S, yuito, kolt, foe } = battle("APG1");
  kolt.ap = 0;
  yuito.resources.liquid = 1; yuito.bonus = 1; yuito.ap = 1;
  S.attackerId = yuito.id; S.targetId = kolt.id;
  S.skillFlow = { id: "yuito_espresso", actorId: yuito.id, picks: { mode: "ap", target: kolt.id }, index: 2 };
  c.runSkill("yuito_espresso"); S.skillFlow = null;
  assert.equal(kolt.ap, 1);
  const y0 = scoreOf(c, yuito), k0 = scoreOf(c, kolt), t0 = S.battleScore.total;
  attack(c, S, kolt, foe);
  const gained = (scoreOf(c, yuito) - y0) + (scoreOf(c, kolt) - k0);
  assert.ok(gained > 0);
  assert.equal(S.battleScore.total - t0, gained, "队伍总分只算一次");
  assert.ok(Math.abs((scoreOf(c, yuito) - y0) - gained / 2) <= 2, `结人 ${scoreOf(c, yuito) - y0} ≈ ${gained} 的一半`);
  assert.equal(kolt.resources.apGifts, undefined, "赠送的行动点用掉了");
});

test("自己的行动点先用：柯尔特还有自己的行动点时，那一下全算自己的；赠送的那点用的时候才分", () => {
  const { c, S, yuito, kolt, foe } = battle("APG2");
  kolt.ap = 1;
  c.grantAllyAp(yuito, kolt, 1);
  const y0 = scoreOf(c, yuito);
  attack(c, S, kolt, foe);
  assert.equal(scoreOf(c, yuito), y0, "用的是自己的行动点");
  attack(c, S, kolt, foe);
  assert.ok(scoreOf(c, yuito) > y0, "第二下用的是结人给的");
});

test("给自己加 / 返还行动点不算赠送；回合开始补行动点时，没用掉的赠送作废", () => {
  const { c, S, yuito, kolt } = battle("APG3");
  c.grantAllyAp(kolt, kolt, 1);
  assert.equal(kolt.resources.apGifts, undefined);
  c.grantAllyAp(yuito, kolt, 1);
  assert.equal(kolt.resources.apGifts.length, 1);
  c.refreshEconomy(kolt);
  assert.equal(kolt.resources.apGifts, undefined);
});
