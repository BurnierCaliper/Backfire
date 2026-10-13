// 第三采矿场的安保杂兵（能量）：矿场警戒自动机、陨石开采机；通用词条「休眠」
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function field(enemies, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: opt.party || ["kolt", "helu"], enemies, seed: opt.seed || "MINE3", zoneMode: opt.zoneMode || 2 });
  c.startCombat();
  const S = c.S.state;
  S.units.forEach(u => { if (u.kit === "kolt") u.prideMaxHp = Infinity; });
  return {
    c, S,
    P: k => c.findKit(k, S.units),
    E: k => S.units.find(u => !u.isPlayer && u.kit === k && !u.dead),
    logs: () => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n")
  };
}
const tank = u => u.layers.forEach(l => { l.max = 999; l.current = 999; });
const noBlock = { pickBlocker: () => null, pickAssister: l => l[0].id };
const preset = (c, id) => c.enemyPresets().find(p => p.id === id);
const total = u => u.layers.reduce((s, l) => s + l.max, 0);
function use(f, a, id, t) {
  f.S.combatPhase = "enemy"; a.ap = Math.max(1, a.ap || 0); f.S.attackerId = a.id; f.S.targetId = t ? t.id : null;
  f.c.runSkill(id);
  f.c.BattleSim.resolveQueues(noBlock);
}

test("数值：警戒自动机 = 剑看守（60% 装甲 + 40% 护盾）；开采机 = 投料无人机（60% 星灵 + 40% 护盾，飞行）；区域与掉落", () => {
  const c = H.load();
  [1, 5, 10, 15, 20].forEach(lv => {
    const a = preset(c, "alarm_bot").build(lv, 1), g = preset(c, "guard_sword").build(lv, 1);
    assert.equal(a.layers.map(l => l.type).join(">"), "shield>armor");
    assert.equal(total(a), total(g)); assert.equal(a.layers[0].max, Math.round(total(g) * 0.4));
    assert.deepEqual([a.defMax, a.atk, a.dormant], [g.defMax, g.atk, true]);
    const m = preset(c, "meteor_miner").build(lv, 1), d = preset(c, "dumpdrone").build(lv, 1);
    assert.equal(m.layers.map(l => l.type).join(">"), "shield>spirit");
    assert.equal(total(m), total(d)); assert.equal(m.layers[0].max, Math.round(total(d) * 0.4));
    assert.deepEqual([m.defMax, m.atk, m.flying, m.self], [d.defMax, d.atk, true, "store"]);
  });
  assert.deepEqual([...c.regionPool("第三采矿场")].sort(), ["alarm_bot", "meteor_miner"]);
  assert.ok(c.rollEnemyLoot({ kit: "alarm_bot" }) > 0 && c.rollEnemyLoot({ kit: "meteor_miner" }) > 0, "有奎支掉落");
});

test("休眠：不行动、不协助；我方走进它的区就醒，并给走进来的人施加高能", () => {
  const f = field([{ id: "alarm_bot", lv: 5, zone: 2 }]);
  const a = f.E("alarm_bot"), k = f.P("kolt");
  assert.equal(a.dormant, true);
  assert.match(f.c.statusLine(a), /休眠/);
  f.S.combatPhase = "enemy"; f.c.refreshEnemyEconomy(a);
  assert.equal(f.c.EnemyAI.plan(a), null, "休眠不行动");
  assert.equal(f.c.enemyMayAssist(a), false, "休眠不协助");
  k.zone = 1; k.statuses.high = false; k.highEnergy = 0;
  f.S.combatPhase = "player"; k.bonus = 1;
  f.c.doMove(k, 2, {});
  assert.equal(a.dormant, false, "有人进来就醒");
  assert.equal(k.statuses.high, true, "吵醒它的人被施加高能");
});

test("休眠：同阵营的友方挨打就醒（异星生物不算）；吵醒它的人已经高能就改吃 1 点能量伤害；被推进来也会醒", () => {
  const f = field([{ id: "alarm_bot", lv: 5, zone: 2 }, { id: "meteor_miner", lv: 5, zone: 2 }]);
  const a = f.E("alarm_bot"), m = f.E("meteor_miner"), k = f.P("kolt");
  k.zone = 1; tank(k); k.statuses.high = true; k.highEnergy = 3;
  const k0 = f.c.totalHp(k);
  f.c.dealTo(k, m, { atk: 5, mult: 1, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });
  assert.equal(a.dormant, false, "同阵营的开采机挨打：醒");
  assert.ok(f.c.totalHp(k) < k0, "已经高能：改为 1 点能量伤害");
  // 被推进来
  const f2 = field([{ id: "alarm_bot", lv: 5, zone: 2 }]);
  const a2 = f2.E("alarm_bot"), k2 = f2.P("kolt");
  k2.zone = 1; k2.statuses.high = false;
  f2.c.displaceTo(k2, 2, [], "被推");
  assert.equal(a2.dormant, false);
  assert.equal(k2.statuses.high, true);
});

test("警戒自动机：醒着时每回合电涌所有高能的敌人（不限距离，各 3 段共 1 击破，不移动）；协助打所有高能的敌人", () => {
  const f = field([{ id: "alarm_bot", lv: 5, zone: 1 }], { zoneMode: 3, party: ["kolt", "helu", "tou"] });
  const a = f.E("alarm_bot"), k = f.P("kolt"), h = f.P("helu"), t = f.P("tou");
  a.dormant = false;
  k.zone = 3; h.zone = 3; t.zone = 1; [k, h, t].forEach(tank);
  k.statuses.high = true; h.statuses.high = false; t.statuses.high = false;
  const kd = k.def;
  f.S.combatPhase = "enemy"; f.c.refreshEnemyEconomy(a);
  const plan = f.c.EnemyAI.plan(a);
  assert.match(plan.meta.skillName, /电涌/, "不移动，直接电涌");
  plan.thunk(); f.c.BattleSim.resolveQueues(noBlock);
  assert.equal(a.zone, 1, "没有移动");
  assert.ok(k.layers[0].current < 999, "距离 2 的高能敌人也挨打");
  assert.equal(kd - k.def, 1, "3 段共 1 击破");
  assert.equal(h.layers[0].current, 999, "没高能的不挨打");
  // 没有高能的敌人：待机
  k.statuses.high = false; k.highEnergy = 0;
  f.S.combatPhase = "enemy"; f.c.refreshEnemyEconomy(a);
  assert.equal(f.c.EnemyAI.plan(a), null);
  // 协助：所有高能的敌人
  k.statuses.high = true; h.statuses.high = true;
  assert.equal(f.c.enemyAssistReach(a, t), true, "场上有高能的人就能协助");
  const k0 = k.layers[0].current, h0 = h.layers[0].current;
  use(f, a, "en_alarm_assist", t);
  assert.ok(k.layers[0].current < k0 && h.layers[0].current < h0);
});

test("陨石开采机：开场蓄能；能量射线带倒流；被我方打死时把高能值转给杀它的人", () => {
  const f = field([{ id: "meteor_miner", lv: 5, zone: 2 }]);
  const m = f.E("meteor_miner"), k = f.P("kolt");
  assert.equal(m.self, "store", "开场蓄能");
  k.zone = 1; tank(k);
  m.layers.forEach(l => { l.current = Math.max(1, l.current - 5); });
  const hp0 = f.c.totalHp(m);
  use(f, m, "en_miner_shot", k);
  assert.ok(k.layers[0].current < 999);
  assert.ok(f.c.totalHp(m) > hp0, "倒流：回血");
  assert.equal(f.c.enemyAssistSkillId(m), "en_miner_assist");
  // 被柯尔特打死：高能值转给柯尔特，开采机自己不再高能自爆
  m.highEnergy = 7; k.statuses.high = false; k.highEnergy = 0;
  m.layers.forEach(l => { l.current = 1; });
  f.S.combatPhase = "player";
  f.c.dealTo(k, m, { atk: 50, mult: 1, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });
  assert.ok(m.dead, "打死了");
  assert.equal(k.statuses.high, true);
  assert.equal(k.highEnergy, 7, "接过 7 点高能值");
  assert.equal(m.highEnergy, 0);
});
