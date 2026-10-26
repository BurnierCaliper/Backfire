// #402：特盛乱打标记过的穴鸦，绯秋协助格挡进入居合时没被瞬斩砍到
// （穴鸦在飞。以前瞬斩当成近程打飞行：砍同区飞行的敌人要额外付 1 附赠动作。协助格挡刚花掉附赠动作，付不起就砍空，标记却已经清掉了；
//   还有附赠动作时每只飞行的敌人各扣 1 个）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));
const logText = S => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");

/** 绯秋 + 柯尔特 对一群穴鸦，都在 1 区：绯秋在胁构用特盛乱打标记同区的穴鸦（进入拔刀），然后轮到敌人 */
function setup(n) {
  const c = H.load();
  c.BattleSim.setup({ party: ["hiaki", "kolt"], enemies: Array.from({ length: n }, () => ({ id: "crow", lv: 1, zone: 1 })), seed: "I402" });
  c.startCombat();
  const S = c.S.state;
  const crows = S.units.filter(u => !u.isPlayer);
  crows.forEach(u => { u.layers = [{ type: "flesh", current: 200, max: 200 }]; u.def = u.defMax = 10; u.zone = 1; });
  S.units.filter(u => u.isPlayer).forEach(u => { u.zone = 1; u.level = 11; u.ap = 3; u.bonus = 2; });
  const h = c.findKit("hiaki", S.units), k = c.findKit("kolt", S.units);
  h.resources.stance = "waki";
  c.Commands.dispatch(plain({ type: "skill", actor: h.id, skill: "hiaki_barrage" }));
  assert.ok(crows.every(u => u.flying && u.barrageBy === h.id), "穴鸦在飞，都被乱打标记");
  assert.equal(h.resources.stance, "draw");
  c.endPlayerTurn();
  return { c, S, crows, h, k };
}

/** 穴鸦啄柯尔特（真的敌人攻击，进协助格挡队列），绯秋协助格挡成功：从拔刀进入居合 */
function peckBlockedBy(c, S, crow, target, helper) {
  S.attackerId = crow.id;
  S.targetId = target.id;
  c.runSkill("en_crow");
  assert.equal((S.blockQueue || []).length, 1, "穴鸦的攻击等协助格挡");
  c.Commands.dispatch(plain({ type: "blockAnswer", helper: helper.id, forced: { ok: true, roll: 1 } }));
  assert.equal(helper.resources.stance, "iai", "格挡成功进入居合");
}

test("特盛乱打标记了一群穴鸦，绯秋花掉最后 1 个附赠动作协助格挡进入居合：每只被标记的穴鸦都挨瞬斩，标记去掉", () => {
  const { c, S, crows, h, k } = setup(4);
  h.bonus = 1;
  const hp = crows.map(u => c.totalHp(u));
  peckBlockedBy(c, S, crows[0], k, h);
  crows.forEach((u, i) => assert.ok(c.totalHp(u) < hp[i], `第 ${i + 1} 只穴鸦挨了瞬斩`));
  assert.ok(crows.every(u => u.barrageBy == null), "标记去掉");
  assert.equal(h.bonus, 0, "只花了协助格挡的 1 个附赠动作");
  const log = logText(S);
  assert.match(log, /特盛乱打：进入居合，被乱打过的 4 个敌人各被瞬间砍一刀/);
  assert.doesNotMatch(log, /在飞行，近程攻击需要额外 1 附赠行动/);
});

test("还有附赠动作时，瞬斩砍飞行的穴鸦也不另扣附赠动作", () => {
  const { c, S, crows, h, k } = setup(2);
  h.bonus = 3;
  const hp = crows.map(u => c.totalHp(u));
  peckBlockedBy(c, S, crows[0], k, h);
  crows.forEach((u, i) => assert.ok(c.totalHp(u) < hp[i], `第 ${i + 1} 只穴鸦挨了瞬斩`));
  assert.equal(h.bonus, 2, "只扣协助格挡的 1 个（以前每只飞行的穴鸦再各扣 1 个）");
  assert.doesNotMatch(logText(S), /额外消耗 1 附赠行动以近程攻击飞行中的/);
});
