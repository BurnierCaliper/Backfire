// #153：第三轮 · 单机低级 L-17 ~ L-21（敌人 / 地形）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(enemies, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies, seed: "T153", zoneMode: opt.zoneMode || 3 });
  c.startCombat();
  const S = c.S.state;
  return { c, S, P: k => c.findKit(k, S.units), E: k => S.units.find(u => !u.isPlayer && u.kit === k && !u.dead) };
}
const noBlock = { pickBlocker: () => null, pickAssister: l => l[0].id };
const tank = u => u.layers.forEach(l => { l.max = 999; l.current = 999; });

test("L-17 电弧扫射的感电只落在打中的人身上：死亡的、隔着危墙的不算", () => {
  const { c, S, P, E } = field([{ id: "patrolboat", lv: 5, zone: 2 }]);
  const b = E("patrolboat"), k = P("kolt"), h = P("helu");
  tank(k); tank(h);
  k.zone = 1; h.zone = 3;
  k.dead = true;   // 死人排在名单前面，以前感电会挂到他身上
  S.combatPhase = "enemy"; b.ap = 2; S.attackerId = b.id;
  c.runSkill("en_boat_arc");
  c.BattleSim.resolveQueues(noBlock);
  assert.ok(!(k.statuses && k.statuses.shock), "死亡的人没被打到，不上感电");
  assert.equal(!!h.statuses.shock, true, "活着被打中的人上感电");
});

test("L-17 隔着危墙的人没被打到，不上感电", () => {
  const { c, S, P, E } = field([{ id: "patrolboat", lv: 5, zone: 2 }]);
  const b = E("patrolboat"), k = P("kolt"), h = P("helu");
  tank(k); tank(h);
  k.zone = 1; h.zone = 3;
  S.gaps["1-2"] = { ...c.emptyGap(), type: "wall", hp: 999, maxHp: 999, level: 1 };
  S.combatPhase = "enemy"; b.ap = 2; S.attackerId = b.id;
  c.runSkill("en_boat_arc");
  c.BattleSim.resolveQueues(noBlock);
  assert.ok(!(k.statuses && k.statuses.shock), "墙后的人不上感电");
  assert.equal(!!h.statuses.shock, true);
});

test("L-18 赤牙引火走 grantBurn：自焚的人免疫；预热版不波及倒地的人", () => {
  const { c, S, P, E } = field([{ id: "chixia", lv: 5, zone: 2 }]);
  const ch = E("chixia"), k = P("kolt"), h = P("helu");
  tank(k); tank(h);
  k.zone = 2; h.zone = 2;
  h.self = "burn";
  S.combatPhase = "enemy"; c.refreshEnemyEconomy(ch);
  S.attackerId = ch.id; S.targetId = h.id;
  c.runSkill("en_chi_ignite");
  assert.ok(!h.statuses.burn, "自焚免疫灼烧");
  // 预热版：同区全体，倒地的不算
  ch.resources.primed = true;
  h.self = null; k.dying = true;
  S.attackerId = ch.id; S.targetId = h.id;
  c.runSkill("en_chi_ignite");
  assert.equal(h.statuses.burn, 1);
  assert.ok(!k.statuses.burn, "倒地的人不被点燃");
});

test("L-19 图鉴伤害骰注明随等级变化", () => {
  const c = H.load();
  assert.ok(c.bestiaryStats("buoy", 15, 2).diceScale, "浮标：每 5 级升档");
  assert.ok(c.bestiaryStats("captain_ox", 15, 2).diceScale, "牛队长：骰数随等级");
  assert.equal(c.bestiaryStats("thug_knife", 15, 2).diceScale, "", "固定骰的不加注");
});

// 原地谁都打不到时（以前这里的场景：狼队长隔两区才有人），用最后 1 行动点走出来：#340 第 5 条，tests/elite-acid-move.test.js
test("L-20 站在酸液上的精英只剩 1 行动点 + 1 附赠、原地打得到人：不规划移动（离开酸液要扣行动点）", () => {
  // 强盗头子（没有亡命之王）追血量最低的人：1 区的夕夏血最少，想走过去；同区有柯尔特，远程也打得到夕夏
  const { c, S, P, E } = field([{ id: "bandit_boss", lv: 5, zone: 2 }]);
  const b = E("bandit_boss"), k = P("kolt"), h = P("helu");
  tank(k); k.zone = 2;
  h.zone = 1; h.layers.forEach(l => { l.current = Math.min(l.current, 5); });
  S.fields[2].acid = true;
  S.combatPhase = "enemy";
  b.ap = 1; b.bonus = 1; b.stunned = false; b.race = null;
  const plan = c.EnemyAI.plan(b);
  assert.ok(!plan || !plan.ai || plan.ai.kind !== "move", "不把唯一的行动点花在离开酸液上：" + JSON.stringify(plan && plan.ai && { kind: plan.ai.kind, dest: plan.ai.dest }));
  assert.equal(plan.ai.sid, "en_boss_far", "原地用远程打夕夏");
});

test("L-21 已迁走 / 逃走（_removed）的单位不在 fieldUnits / visibleEnemies 里", () => {
  const { c, S, E } = field([{ id: "dust_bug", lv: 3, zone: 2 }, { id: "thug_knife", lv: 3, zone: 2 }]);
  const bug = E("dust_bug");
  assert.ok(c.fieldUnits().includes(bug));
  bug._removed = true;
  assert.ok(!c.fieldUnits().includes(bug), "fieldUnits 不含");
  assert.ok(!c.visibleEnemies(2).includes(bug), "visibleEnemies 不含");
  assert.ok(!bug.dead, "没有当作被击杀（不掉材料、不记击杀）");
});
