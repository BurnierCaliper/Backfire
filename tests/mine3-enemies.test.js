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
  assert.deepEqual([...c.regionPool("第三采矿场")].sort(), ["alarm_bot", "meteor_centipede", "meteor_miner", "meteor_spider"]);
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

/* ---------- 异星生物 ---------- */
test("数值：陨体衍蛛 = 蜂群的血（全星灵）、枪看守的架势、浮标的 atk，两只一组 1 代币；陨体弦蚣 = 匕首狂徒（全星灵）", () => {
  const c = H.load();
  [1, 5, 10, 20].forEach(lv => {
    const s = preset(c, "meteor_spider").build(lv, 1), sw = preset(c, "swarm").build(lv, 1), gg = preset(c, "guard_gun").build(lv, 1), bu = preset(c, "buoy").build(lv, 1);
    assert.equal(s.layers.map(l => l.type).join(), "spirit");
    assert.equal(total(s), total(sw)); assert.equal(s.defMax, gg.defMax); assert.equal(s.atk, bu.atk);
    const m = preset(c, "meteor_centipede").build(lv, 1), k = preset(c, "thug_knife").build(lv, 1);
    assert.equal(m.layers.map(l => l.type).join(), "spirit");
    assert.deepEqual([total(m), m.defMax, m.atk], [total(k), k.defMax, k.atk]);
  });
  assert.deepEqual(plain(c.enemyInfo("meteor_spider")), { faction: "异星生物", regions: ["第三采矿场"], tokens: 1, group: 2 });
  assert.equal(c.enemyInfo("meteor_centipede").faction, "异星生物");
});

test("陨体衍蛛：场上每只活着的衍蛛 atk +25%；协助施加高能", () => {
  const f = field([{ id: "meteor_spider", lv: 5, zone: 2 }, { id: "meteor_spider", lv: 5, zone: 2 }, { id: "meteor_spider", lv: 5, zone: 2 }]);
  const sp = f.S.units.filter(u => u.kit === "meteor_spider");
  const base = sp[0].atk;
  assert.equal(f.c.effectiveAtk(sp[0], f.S.units), Math.round(base * 1.75), "三只：+75%");
  sp[2].dead = true;
  assert.equal(f.c.effectiveAtk(sp[0], f.S.units), Math.round(base * 1.5), "死了一只：+50%");
  const k = f.P("kolt"); k.zone = 2; tank(k); k.statuses.high = false;
  use(f, sp[0], "en_spider_assist", k);
  assert.equal(k.statuses.high, true);
});

test("陨体弦蚣：不移动、打血量最低的人；打中施加高能，每只衍蛛追打 1 点（协助翻倍）", () => {
  const f = field([{ id: "meteor_centipede", lv: 5, zone: 2 }, { id: "meteor_spider", lv: 5, zone: 2 }, { id: "meteor_spider", lv: 5, zone: 2 }]);
  const m = f.E("meteor_centipede"), k = f.P("kolt"), h = f.P("helu");
  k.zone = 1; h.zone = 1; tank(k); tank(h); h.layers[0].current = 500;
  f.S.combatPhase = "enemy"; f.c.refreshEnemyEconomy(m);
  const plan = f.c.EnemyAI.plan(m);
  assert.match(plan.meta.skillName, /弦振射线/);
  const hpBefore = h.layers[0].current;
  plan.thunk(); f.c.BattleSim.resolveQueues(noBlock);
  assert.equal(m.zone, 2, "不移动");
  assert.ok(h.layers[0].current < hpBefore, "打血量最低的海露米卡");
  assert.equal(h.statuses.high, true);
  assert.match(f.logs(), /2 只陨体衍蛛跟着扑向 Helumica（各 1 次）/);
  use(f, m, "en_centi_assist", k);
  assert.match(f.logs(), /2 只陨体衍蛛跟着扑向 柯尔特（各 2 次）/);
  // 只有同区的人：不移动、不出手
  k.zone = 2; h.zone = 2;
  f.S.combatPhase = "enemy"; f.c.refreshEnemyEconomy(m);
  const p2 = f.c.EnemyAI.plan(m);
  assert.ok(!p2 || !/移动/.test(p2.meta.skillName), "不会走开去找射程");
});

test("微光：陨体衍蛛死后（还有活着的衍蛛）留在场上，下回合结束 50% 血量 1 架势复活；衍蛛全灭就不复活；陨体弦蚣死后分裂", () => {
  const f = field([{ id: "meteor_spider", lv: 5, zone: 2 }, { id: "meteor_spider", lv: 5, zone: 2 }, { id: "meteor_centipede", lv: 5, zone: 2 }]);
  const [s1, s2] = f.S.units.filter(u => u.kit === "meteor_spider");
  const k = f.P("kolt"); k.zone = 2;
  f.S.weather = "glow";
  const kill = (u) => { f.S.combatPhase = "player"; f.c.dealTo(k, u, { atk: 999, mult: 1, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } }); f.c.sweepDeadEnemies().forEach(() => {}); };
  kill(s1);
  assert.ok(s1.dead && s1._linger && !s1._removed, "留在场上");
  assert.deepEqual(plain(f.c.enemyIntents(s1)), ["待复活"]);
  const turn = f.S.turnNo;
  f.c.endPlayerTurn(); f.S.units.filter(u => !u.isPlayer).forEach(u => { u.ap = 0; }); f.c.endEnemyTurn();
  assert.ok(s1.dead, "这一回合结束还没到");
  f.c.endPlayerTurn(); f.S.units.filter(u => !u.isPlayer).forEach(u => { u.ap = 0; }); f.c.endEnemyTurn();
  assert.equal(f.S.turnNo, turn + 2);
  assert.equal(s1.dead, false, "下回合结束时复活");
  assert.equal(s1.layers[0].current, Math.round(s1.layers[0].max * 0.5));
  assert.equal(s1.def, 1);
  // 复活后再死：不再给经验 / 击杀分
  const xp0 = k.xp;
  kill(s1);
  assert.equal(k.xp, xp0, "复活过的再死不给经验");
  // 衍蛛全灭：倒下的都离场，不再复活
  kill(s2);
  assert.ok(s2.dead);
  f.c.endPlayerTurn(); f.S.units.filter(u => !u.isPlayer).forEach(u => { u.ap = 0; }); f.c.endEnemyTurn();
  assert.ok(s1._removed || !s1._linger, "不再复活：" + JSON.stringify({ linger: s1._linger, removed: s1._removed, dead: s1.dead, s2: [s2.dead, s2._linger, s2._removed], hp: s2.layers[0].current }));
  // 弦蚣在微光下死亡：分裂成 1–3 只衍蛛
  const m = f.E("meteor_centipede");
  const before = f.S.units.filter(u => u.kit === "meteor_spider" && !u.dead).length;
  kill(m);
  const after = f.S.units.filter(u => u.kit === "meteor_spider" && !u.dead).length;
  assert.ok(after - before >= 1 && after - before <= 3, "分裂出 " + (after - before) + " 只");
});

test("陨体衍蛛死亡时 25% 把天气变成微光；不是微光时死了就照常离场", () => {
  const f = field([{ id: "meteor_spider", lv: 5, zone: 2 }, { id: "meteor_spider", lv: 5, zone: 2 }]);
  const [s1] = f.S.units.filter(u => u.kit === "meteor_spider");
  f.S.weather = "none";
  f.c.Math.random = () => 0.1;   // < 25%：变微光
  s1.layers.forEach(l => { l.current = 0; }); s1.dead = true; s1._xpGiven = true;
  f.c.sweepDeadEnemies();
  assert.equal(f.S.weather, "glow");
  assert.ok(s1._linger, "变成微光后还有活着的衍蛛：留在场上");
  const g = field([{ id: "meteor_spider", lv: 5, zone: 2 }, { id: "meteor_spider", lv: 5, zone: 2 }]);
  const [t1] = g.S.units.filter(u => u.kit === "meteor_spider");
  g.S.weather = "none";
  g.c.Math.random = () => 0.9;
  t1.layers.forEach(l => { l.current = 0; }); t1.dead = true; t1._xpGiven = true;
  g.c.sweepDeadEnemies();
  assert.equal(g.S.weather, "none");
  assert.ok(t1._removed, "照常离场");
});
