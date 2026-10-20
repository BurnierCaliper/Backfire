// H5：流沙没顶（下陷 3 层）的单位放技能付不起消耗，这次行动不结算（app.js · costBlockReason / runSkill）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const { Hotseat } = require("../hotseat");

function field(seed) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed });
  c.startCombat();
  const st = c.S.state;
  st.fields[1].quicksand = true;
  const kolt = c.findKit("kolt", st.units);
  kolt.zone = 2;
  return { c, st, kolt };
}
function strike(c, st, a, foe, id) { st.attackerId = a.id; st.targetId = foe.id; st.skillFlow = null; c.runSkill(id); }
const logText = (c) => JSON.stringify(c.S.state.logPages);

test("没顶的我方放花行动点的技能：不掉血、不扣点、日志写没顶", () => {
  const { c, st, kolt } = field("QL1");
  const foe = st.units.find(u => !u.isPlayer);
  kolt.zone = 1; kolt.sink = 3; kolt.ap = 2; foe.zone = 1;
  const hp = c.totalHp(foe);
  strike(c, st, kolt, foe, "kolt_aa");
  assert.equal(c.totalHp(foe), hp);
  assert.equal(kolt.ap, 2);
  assert.match(logText(c), /没顶/);
});

test("消耗检查：没顶 / 点数不够都付不起，不花点数的动作照常", () => {
  const { c, kolt } = field("QL2");
  kolt.zone = 1; kolt.sink = 3; kolt.ap = 2; kolt.bonus = 2;
  assert.match(c.costBlockReason(kolt, { ap: 1 }), /没顶/);
  assert.match(c.costBlockReason(kolt, { bonus: 1 }), /没顶/);
  assert.equal(c.costBlockReason(kolt, {}), "");
  kolt.sink = 0; kolt.ap = 0;
  assert.equal(c.costBlockReason(kolt, { ap: 1 }), "行动点不足");
});

test("下陷 2 层（没到没顶）照常出手、扣点", () => {
  const { c, st, kolt } = field("QL3");
  const foe = st.units.find(u => !u.isPlayer);
  kolt.zone = 1; kolt.sink = 2; kolt.ap = 2; foe.zone = 1;
  const hp = c.totalHp(foe);
  strike(c, st, kolt, foe, "kolt_aa");
  assert.ok(c.totalHp(foe) < hp);
  assert.equal(kolt.ap, 1);
});

test("没顶的敌人：AI 不规划，直接放技能也不出手、不扣点", () => {
  const { c, st, kolt } = field("QL4");
  const thug = st.units.find(u => u.kit === "thug_knife");
  thug.zone = 1; thug.sink = 3; kolt.zone = 1; thug.ap = 2;
  assert.equal(c.EnemyAI.plan(thug), null);
  const hp = c.totalHp(kolt);
  strike(c, st, thug, kolt, "en_thug_knife");
  assert.equal(c.totalHp(kolt), hp);
  assert.equal(thug.ap, 2);
});

test("联机校验：没顶被拦下且不改局面，下陷 2 层放行", () => {
  const c = H.load();
  new vm.Script(fs.readFileSync(path.join(H.ROOT, "hotseat-validation.js"), "utf8")).runInContext(c);
  const s = c.S.state; c.loadLiveParty(["ruby", "hiaki"]);
  const a = s.units.find(u => u.kit === "ruby"), b = s.units.find(u => u.kit === "hiaki");
  const enemy = c.enemyPresets().find(x => x.id === "thug_knife").build(1, 2);
  enemy.zone = 2; s.units.push(enemy); s.zoneMode = 3;
  c.startCombat(); a.ap = 4; a.bonus = 4; b.ap = 4; b.bonus = 4;
  const session = Hotseat.create({ operators: ["a", "b"], gmId: "a", getUnits: () => s.units,
    canStand: u => !c.standUpBlocked(u), assignments: { [a.id]: "a", [b.id]: "b" } });
  session.beginRound(1); session.pick("a", a.id, 0); session.pick("b", b.id, 1); session.forceStart("a");
  const cmd = { type: "skill", actor: a.id, skill: "ruby_aa", target: enemy.id, picks: {} };
  const validate = () => c.HotseatValidation.validateBattle(cmd, { session, sender: "a" });
  s.fields[a.zone].quicksand = true; a.sink = 3;   // 在原地铺流沙，不动站位（免得射程变化）
  const before = JSON.stringify(s);
  assert.throws(validate, /没顶/);
  assert.equal(JSON.stringify(s), before);
  a.sink = 2;
  assert.doesNotThrow(validate);
});
