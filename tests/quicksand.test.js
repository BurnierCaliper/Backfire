// 流沙（app.js · QUICKSAND、addSink、quicksandTurnEnd、tickQuicksandFor、sand_pull）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(seed, enemies) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: enemies || [{ id: "thug_knife", lv: 3, zone: 2 }], seed });
  c.startCombat();
  const st = c.S.state;
  st.fields[1].quicksand = true;
  const kolt = c.findKit("kolt", st.units), helu = c.findKit("helu", st.units);
  kolt.zone = 2; helu.zone = 2;
  return { c, st, kolt, helu };
}
const walk = (c, st, u, z) => { st.attackerId = u.id; u.bonus = 5; u.ap = 5; c.doMove(u, z); };

test("走进流沙 +1；回合结束花过行动点再 +1，没花 −1", () => {
  const { c, st, kolt } = field("QS1");
  walk(c, st, kolt, 1);
  assert.equal(kolt.zone, 1);
  assert.equal(kolt.sink, 1);
  c.spendAp(kolt, 1, "test");
  c.quicksandTurnEnd(true, []);
  assert.equal(kolt.sink, 2);
  c.quicksandTurnEnd(true, []);
  assert.equal(kolt.sink, 1, "没花行动点就浮出来一点");
});

test("每回合开始窒息：生命上限 × 5% × 层数，不吃克制", () => {
  const { c, kolt } = field("QS2");
  kolt.zone = 1; kolt.sink = 2;
  const max = c.totalMaxHp(kolt), hp = c.totalHp(kolt);
  const notes = [];
  c.tickQuicksandFor(kolt, notes);
  assert.equal(hp - c.totalHp(kolt), Math.floor(max * 0.1));
  assert.match(notes.join(""), /窒息/);
});

test("2 层自己走不出去，1 层可以走出去并清零；被推出去也清零", () => {
  const { c, st, kolt } = field("QS3");
  kolt.zone = 1; kolt.sink = 2;
  walk(c, st, kolt, 2);
  assert.equal(kolt.zone, 1, "2 层走不出去");
  kolt.sink = 1;
  walk(c, st, kolt, 2);
  assert.equal(kolt.zone, 2);
  assert.equal(kolt.sink, 0);
  kolt.zone = 1; kolt.sink = 3;
  c.displaceTo(kolt, 2, [], "被推开");
  assert.equal(kolt.sink, 0);
});

test("3 层没顶：不能花行动点 / 附赠，不能协助攻击和协助格挡；没花行动点回合结束降到 2 层", () => {
  const { c, kolt } = field("QS4");
  kolt.zone = 1; kolt.sink = 3; kolt.ap = 2; kolt.bonus = 2;
  assert.equal(c.spendAp(kolt, 1, "test"), false);
  assert.equal(c.spendBonus(kolt, 1, "test"), false);
  assert.equal(kolt.ap, 2);
  assert.equal(c.unitCanFight(kolt), false);
  assert.ok(!c.eligibleBlockers(kolt).includes(kolt));
  c.quicksandTurnEnd(true, []);
  assert.equal(kolt.sink, 2);
  assert.equal(c.unitCanFight(kolt), true);
});

test("拉出流沙：同伴花 1 附赠，相邻区的拉到自己这一区，下陷清零", () => {
  const { c, st, kolt, helu } = field("QS5");
  kolt.zone = 1; kolt.sink = 3;
  helu.zone = 2; helu.bonus = 1; helu.ap = 1;
  const sk = c.skillList(helu).find(s => s.id === "sand_pull");
  assert.ok(sk, "要有拉出流沙");
  assert.deepEqual(JSON.parse(JSON.stringify(c.skillCost("sand_pull"))), { bonus: 1 });
  st.attackerId = helu.id; st.targetId = kolt.id;
  st.skillFlow = { id: "sand_pull", actorId: helu.id, picks: { target: kolt.id }, index: 0 };
  c.runSkill("sand_pull");
  st.skillFlow = null;
  assert.equal(kolt.zone, 2);
  assert.equal(kolt.sink, 0);
  assert.equal(helu.bonus, 0);
  assert.ok(!c.skillList(helu).some(s => s.id === "sand_pull"), "没人陷住就不列");
});

test("沙灵、飞行单位免疫流沙；流沙和其他主场地互斥", () => {
  const { c, st } = field("QS6", [{ id: "sand_beast", lv: 3, zone: 2 }, { id: "crow", lv: 3, zone: 2 }]);
  const sand = st.units.find(u => u.kit === "sand_beast"), crow = st.units.find(u => u.kit === "crow");
  sand.zone = 1; crow.zone = 1;
  assert.equal(c.inQuicksand(sand), false);
  assert.equal(c.inQuicksand(crow), false);
  c.quicksandAfterZoneChange(sand, []);
  assert.ok(!sand.sink);
  c.setZoneField(1, "acid", { force: true });
  assert.equal(st.fields[1].quicksand, false);
  assert.equal(st.fields[1].acid, true);
});

test("敌人陷住：3 层没顶时 AI 不行动", () => {
  const { c, st } = field("QS7");
  const thug = st.units.find(u => u.kit === "thug_knife");
  thug.zone = 1; thug.sink = 3;
  assert.equal(c.EnemyAI.plan(thug), null);
});
