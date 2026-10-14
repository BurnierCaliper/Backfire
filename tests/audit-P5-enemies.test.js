// 敌人数据、技能、AI、首领、指挥官的规则 bug 回归测试（README「规则改动记录」里每条都有说明）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function field(enemies, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: opt.party || ["kolt", "helu"], enemies, seed: opt.seed || "P5", zoneMode: opt.zoneMode || 2 });
  c.startCombat();
  const S = c.S.state;
  // 这些用例测敌人的击破 / 失衡：关掉柯尔特「过度自信」的 −1 击破，免得满血的柯尔特少吃击破
  S.units.forEach(u => { if (u.kit === "kolt") u.prideMaxHp = Infinity; });
  return {
    c, S,
    P: k => c.findKit(k, S.units),
    E: k => S.units.find(u => !u.isPlayer && u.kit === k && !u.dead),
    logs: () => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n")
  };
}
const hit = (c, a, t, extra) => c.dealTo(a, t, Object.assign({ atk: 10, mult: 1, element: "physical", baseBreak: 0, atkRange: "any",
  flags: { action: true, blockResolved: true, block: "none" } }, extra || {}));
const tank = u => u.layers.forEach(l => { l.max = 999; l.current = 999; });
const noBlock = { pickBlocker: () => null, pickAssister: l => l[0].id };
/** 让一个敌人按 AI 打完这一回合（和 sim.js 一样），返回每一步的技能名 */
function aiTurn(c, u, max) {
  const out = [];
  for (let n = 0; n < (max || 6); n++) {
    if (!u || u.dead || u.stunned || (u.ap || 0) <= 0) break;
    const plan = c.EnemyAI.plan(u);
    if (!plan) break;
    out.push(plan.meta.skillName);
    const before = `${u.ap}|${u.bonus}|${u.zone}`;
    plan.thunk();
    c.BattleSim.resolveQueues(noBlock);
    if (`${u.ap}|${u.bonus}|${u.zone}` === before) break;
  }
  return out;
}
/** 整回合结束（敌人这回合不行动），到下一回合我方回合开始 */
function nextRound(c, S) {
  c.endPlayerTurn();
  S.units.filter(u => !u.isPlayer).forEach(u => { u.ap = 0; });
  c.endEnemyTurn();
}

test("沙灵聚合体二阶段：机械臂之后蓄力一回合才开炮，区域预警看得到；近距那一炮打得到；打出去才过热", () => {
  const { c, S, P, E, logs } = field([{ id: "sand_aggregate", lv: 5, zone: 2 }]);
  const a = E("sand_aggregate"), k = P("kolt"), h = P("helu");
  a.resources.phase = 2; a.layers[0].current = 0; a.layers[0].max = 0;
  k.zone = 2; h.zone = 1; tank(k); tank(h);
  S.combatPhase = "enemy"; c.refreshEnemyEconomy(a);
  assert.deepEqual(aiTurn(c, a), ["机械臂挥击（近）"], "第二动在蓄力，不开炮");
  assert.equal(a.resources.forceCharge, true);
  assert.equal(c.enemySkillList(a).length, 0, "蓄力的这一回合没有别的行动");
  assert.deepEqual(plain(c.zoneThreats().map(t => [t.zone, t.label, t.ready])), [[2, "电能炮蓄力", false]]);
  S.turnNo += 1;
  assert.deepEqual(plain(c.zoneThreats().map(t => [t.label, t.ready])), [["电能炮待发", true]], "下一回合就要开炮");
  S.combatPhase = "enemy"; c.refreshEnemyEconomy(a);
  const hp0 = c.totalHp(k);
  const steps = aiTurn(c, a);
  assert.match(steps[0], /发射电能炮/);
  assert.match(steps[1], /过热/, "炮后过热，跳过一次行动");
  assert.ok(c.totalHp(k) < hp0, "同区那一炮打到了");
  assert.match(logs(), /1d20/);
  assert.equal(a.resources.forceCharge, false);
  assert.equal(a.resources.forceOverheat, false, "过热已经跳过");

  // 射程外（三区隔两区）：没打出去，蓄力保留，也不过热
  const f = field([{ id: "sand_aggregate", lv: 5, zone: 3 }], { zoneMode: 3 });
  const b = f.E("sand_aggregate"), k2 = f.P("kolt");
  b.resources.phase = 2; b.resources.forceCharge = true; b.resources.chargeTurn = 0;
  k2.zone = 1;
  f.S.combatPhase = "enemy"; b.ap = 1; f.S.attackerId = b.id; f.S.targetId = k2.id;
  f.c.runSkill("en_agg2_charge");
  assert.equal(b.resources.forceCharge, true);
  assert.equal(b.resources.forceOverheat, false);
});

test("巨人协助「捏碎颅骨」：同区目标倒地进入濒死，自我效果不动；力竭 3 直接死亡；隔一区的巨人不会被选来协助", () => {
  const { c, S, P, E } = field([{ id: "giant", lv: 3, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }]);
  const k = P("kolt"), g = E("giant"), kn = E("thug_knife");
  k.zone = 1; k.self = "anchor";
  S.combatPhase = "enemy"; k.def = 1;
  hit(c, kn, k, { atk: 1, baseBreak: 1 });
  // 被打出失衡就是晕眩：千钧按「晕眩后效果结束」先结束了（效果系统的规则）。重新挂上，只验证捏碎本身不改写自我效果
  assert.equal(k.self, "none", "失衡即晕眩，千钧结束");
  k.self = "anchor";
  const job = S.assistQueue[0];
  assert.equal(c.EnemyAI.pickAssister(c.eligibleAssisters(kn, k), k), g.id);
  c.finishAssist(g.id, {});
  assert.equal(job.targetId, k.id);
  assert.equal(c.totalHp(k), 0);
  assert.equal(k.dying, true);
  assert.equal(k.dead, false);
  assert.equal(k.self, "anchor", "捏碎颅骨不改写自我效果（以前写成不存在的 self = \"down\"）");

  const f = field([{ id: "giant", lv: 3, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }]);
  const k2 = f.P("kolt");
  f.S.exhaustTier = 3; k2.zone = 1; f.S.combatPhase = "enemy"; k2.def = 1;
  hit(f.c, f.E("thug_knife"), k2, { atk: 1, baseBreak: 1 });
  f.c.finishAssist(f.E("giant").id, {});
  assert.equal(k2.dead, true, "力竭 3：被击倒立刻死亡");

  const d = field([{ id: "giant", lv: 3, zone: 2 }, { id: "thug_knife", lv: 1, zone: 1 }]);
  const k3 = d.P("kolt"), g3 = d.E("giant");
  k3.zone = 1; d.S.combatPhase = "enemy"; k3.def = 1;
  hit(d.c, d.E("thug_knife"), k3, { atk: 1, baseBreak: 1 });
  assert.equal(d.c.EnemyAI.pickAssister(d.c.eligibleAssisters(d.E("thug_knife"), k3), k3), null, "协助近距：隔一区够不到");
  d.c.finishAssist(g3.id, {});   // 主持人硬点也不生效
  assert.equal(k3.dying, false);
  assert.ok(d.c.totalHp(k3) > 0);
});

test("高压巡逻艇：回合开始在飞行就给自己过载（护盾翻倍，一直持续）；被击落时吃过载爆炸，落地后过载照常结束", () => {
  const { c, S, P, E } = field([{ id: "patrolboat", lv: 5, zone: 2 }]);
  const b = E("patrolboat"), k = P("kolt");
  const sh = () => b.layers.find(l => l.type === "shield");
  assert.equal(b.instant.overload, true);
  assert.deepEqual([sh().current, sh().max], [46, 46], "23 → 46");
  nextRound(c, S);
  assert.equal(b.instant.overload, true, "还在飞：过载持续");
  assert.deepEqual([sh().current, sh().max], [46, 46], "没挨打：回满到翻倍后的上限，不被清零");
  k.zone = 2;
  const out = hit(c, k, b, { atk: 1, baseBreak: 99 });
  assert.equal(b.flying, false);
  assert.ok(out.extra.some(s => /过载爆炸/.test(s)), "击落之外再吃过载爆炸");
  nextRound(c, S);
  assert.equal(b.instant.overload, false);
  assert.deepEqual([sh().current, sh().max], [0, 23], "落地后过载结束：护盾清零，上限还原");
});

test("「全员」技能是范围攻击：喷洒、回防命令的电击霰弹、全域沙暴、流沙漩涡都不弹协助格挡；全域沙暴三区也打到距离 2", () => {
  const sp = field([{ id: "spreader", lv: 3, zone: 2 }]);
  const k = sp.P("kolt"), h = sp.P("helu"), s = sp.E("spreader");
  k.zone = 1; h.zone = 1; k.bonus = 1; h.bonus = 1; tank(k); tank(h);
  sp.S.combatPhase = "enemy"; s.ap = 1; sp.S.attackerId = s.id; sp.S.targetId = k.id;
  const hp0 = sp.c.totalHp(k) + sp.c.totalHp(h);
  sp.c.runSkill("en_spread");
  assert.equal(sp.S.blockQueue.length, 0);
  assert.ok(sp.c.totalHp(k) + sp.c.totalHp(h) < hp0);
  assert.equal(k.statuses.corr, true); assert.equal(h.statuses.corr, true);

  const kg = field([{ id: "outlaw_king", lv: 5, zone: 2 }]);
  const k2 = kg.P("kolt"), h2 = kg.P("helu"), king = kg.E("outlaw_king");
  k2.zone = 1; h2.zone = 1; k2.bonus = 1; h2.bonus = 1; tank(k2); tank(h2);
  kg.S.combatPhase = "enemy"; king.ap = 1; kg.S.attackerId = king.id; kg.S.targetId = k2.id;
  kg.c.Math.random = () => 0.999;   // 1d8 掷出 8
  kg.c.runSkill("en_king_hold");
  assert.equal(kg.S.blockQueue.length, 0);
  // 手册 atk+1d8/2，按 README 的写法 (atk + 1d8) ÷ 2：atk × 0.5 + 8 ÷ 2
  assert.match(kg.logs(), new RegExp(`基础伤害：ATK ${kg.c.effectiveAtk(king, kg.S.units)} × 0\\.5 \\+ 骰子 4 =`));

  const ls = field([{ id: "livesand", lv: 3, zone: 3 }], { zoneMode: 3, party: ["kolt", "helu", "tou"] });
  const k3 = ls.P("kolt"), h3 = ls.P("helu"), t3 = ls.P("tou"), sand = ls.E("livesand");
  k3.zone = 1; h3.zone = 1; t3.zone = 2; [k3, h3, t3].forEach(u => { u.bonus = 1; tank(u); });
  sand.resources.giant = true; sand.resources.giantTurns = 3;
  ls.S.combatPhase = "enemy"; sand.ap = 1; ls.S.attackerId = sand.id; ls.S.targetId = k3.id;
  ls.c.runSkill("en_giant_sand_pulse");
  assert.equal(ls.S.blockQueue.length, 0);
  [k3, h3, t3].forEach(u => assert.ok(ls.c.totalHp(u) < 999 * u.layers.length, u.name + " 挨打（含距离 2）"));
  sand.ap = 1; ls.S.attackerId = sand.id; ls.S.targetId = t3.id; h3.zone = 2;
  ls.c.runSkill("en_giant_sand_vortex");
  assert.equal(ls.S.blockQueue.length, 0);
  assert.equal(t3.stunned, true, "流沙漩涡：打中的人失去行动");
});

test("投料无人机 / 播撒者的腐蚀只在打中时施加：被协助格挡挡下、射程外都不上", () => {
  const { c, S, P, E } = field([{ id: "dumpdrone", lv: 3, zone: 2 }]);
  const k = P("kolt"), h = P("helu"), d = E("dumpdrone");
  k.zone = 1; h.zone = 1; h.bonus = 1;
  S.combatPhase = "enemy"; d.ap = 1; S.attackerId = d.id; S.targetId = k.id;
  c.runSkill("en_dump");
  assert.equal(S.blockQueue.length, 1);
  assert.equal(k.statuses.corr, false, "还没落下");
  c.finishBlock(h.id, { roll: 1, ok: true, chance: 100 });
  assert.equal(k.statuses.corr, false, "被挡下：不上腐蚀");
  d.zone = 1; d.ap = 1; S.attackerId = d.id; S.targetId = k.id;
  c.runSkill("en_dump");
  assert.equal(k.statuses.corr, false, "同区打不到：不上腐蚀");

  const sp = field([{ id: "spreader", lv: 3, zone: 2 }]);
  const k2 = sp.P("kolt"), s = sp.E("spreader");
  k2.zone = 2;
  sp.S.combatPhase = "enemy"; s.ap = 1; sp.S.attackerId = s.id; sp.S.targetId = k2.id;
  sp.c.runSkill("en_spread");
  assert.equal(k2.statuses.corr, false, "喷洒射程是远距离：同区打不到，也不上腐蚀");
});

test("人形沙灵：身边只有同区的人不空放，先走到隔壁区去打；隔壁区有人就打隔壁区的", () => {
  const { c, S, P, E } = field([{ id: "sand_human", lv: 3, zone: 2 }]);
  const s = E("sand_human"), k = P("kolt"), h = P("helu");
  k.zone = 2; h.zone = 2;
  S.combatPhase = "enemy"; c.refreshEnemyEconomy(s);
  const away = c.EnemyAI.plan(s);
  assert.ok(away && /移动到 1 区/.test(away.meta.skillName), "不空放，走一步到能打到人的站位");
  h.zone = 1;
  const plan = c.EnemyAI.plan(s);
  assert.equal(plan.meta.targetId, h.id);
  const hp0 = c.totalHp(h);
  plan.thunk();
  assert.ok(c.totalHp(h) < hp0, "打到了隔壁区的 Helumica");
});

test("沙灵聚合体三阶段：吸引碎片两次后装甲回满（原本的上限）；肉体操控让目标下回合真的失去行动点", () => {
  const { c, S, P, E } = field([{ id: "sand_aggregate", lv: 5, zone: 2 }]);
  const a = E("sand_aggregate"), k = P("kolt"), h = P("helu");
  const armorMax = a.layers.find(l => l.type === "armor").max;
  k.zone = 2;
  hit(c, k, a, { atk: a.layers[0].current, element: "fire" });                                    // 打穿外层沙尘 → 二阶段
  hit(c, k, a, { atk: Math.ceil(a.layers.find(l => l.type === "armor").current / 1.5) + 1, element: "acid" });   // 打穿装甲 → 三阶段
  assert.equal(a.resources.phase, 3);
  assert.equal(a.dead, false);
  S.combatPhase = "enemy";
  for (let i = 0; i < 2; i++) { a.ap = 1; S.attackerId = a.id; S.targetId = k.id; c.runSkill("en_agg3_debris"); }
  const armor = a.layers.find(l => l.type === "armor");
  assert.equal(a.resources.phase, 2);
  assert.deepEqual([armor.current, armor.max], [armorMax, armorMax]);

  const f = field([{ id: "sand_aggregate", lv: 5, zone: 2 }]);
  const b = f.E("sand_aggregate"), k2 = f.P("kolt"), h2 = f.P("helu");
  b.resources.phase = 3; k2.zone = 2; h2.zone = 2;
  k2.layers.forEach(l => { l.current = Math.floor(l.max * 0.3); });
  f.S.combatPhase = "enemy"; b.ap = 1; f.S.attackerId = b.id; f.S.targetId = k2.id;
  f.c.runSkill("en_agg3_control");
  f.S.units.filter(u => !u.isPlayer).forEach(u => { u.ap = 0; });
  f.c.endEnemyTurn();
  assert.equal(f.S.combatPhase, "player");
  assert.equal(k2.ap, 0, "这一回合没有行动点");
  assert.equal(k2.bonus, 1, "附赠照常");
  assert.equal(h2.ap, 1);
  f.c.endPlayerTurn(); f.S.units.filter(u => !u.isPlayer).forEach(u => { u.ap = 0; }); f.c.endEnemyTurn();
  assert.equal(k2.ap, 1, "只管一回合");
});

test("扬尘体：沙尘每回合只回一次（等于等级）；被击落的那一回合不回复", () => {
  const { c, S, P, E, logs } = field([{ id: "dustbody", lv: 5, zone: 2 }]);
  const d = E("dustbody"), k = P("kolt");
  const sand = () => d.layers.find(l => l.type === "sand");   // 挨打后血量层会换成新对象，每次现取
  sand().current = sand().max - 20;
  let s0 = sand().current;
  nextRound(c, S);
  assert.equal(sand().current - s0, 5, "一回合只回 5（以前回合结束 +5、回合开始又 +5）");
  k.zone = 2;
  hit(c, k, d, { atk: 1, baseBreak: 99 });
  assert.equal(d.flying, false);
  s0 = sand().current;
  nextRound(c, S);
  assert.equal(sand().current, s0, "被击落的这一回合不回复");
  assert.match(logs(), /被击落：本回合沙尘不回复/);
  s0 = sand().current;
  nextRound(c, S);
  assert.equal(sand().current - s0, 5, "下一回合照常回复");
});

test("赤牙：霰弹 / 掩体 2 行动点、追猎 1 附赠；掩体用完结束回合，撑过我方回合，她下次出手才离开", () => {
  const { c, S, P, E } = field([{ id: "chixia", lv: 5, zone: 2 }]);
  const ch = E("chixia"), k = P("kolt"), h = P("helu");
  k.zone = 1; h.zone = 1; tank(k); tank(h);
  S.combatPhase = "enemy"; c.refreshEnemyEconomy(ch);
  assert.deepEqual([ch.ap, ch.bonus], [3, 1]);
  ch.resources.primed = true;
  S.attackerId = ch.id; S.targetId = k.id;
  c.runSkill("en_chi_shot");
  c.BattleSim.resolveQueues(noBlock);
  assert.equal(ch.ap, 1, "霰弹 2 行动点");
  S.attackerId = ch.id; S.targetId = k.id;
  c.runSkill("en_chi_hunt");
  assert.deepEqual([ch.ap, ch.bonus], [1, 0], "追猎花附赠");
  c.refreshEnemyEconomy(ch);
  S.attackerId = ch.id; S.targetId = null;
  c.runSkill("en_chi_cover");
  assert.deepEqual([ch.ap, ch.bonus], [0, 0], "掩体：2 行动点，并结束回合");
  c.endEnemyTurn();
  assert.equal(S.combatPhase, "player");
  assert.equal(ch.resources.cover, true, "我方回合开始前没被清");
  k.zone = 2;
  const hp0 = c.totalHp(ch), def0 = ch.def;
  hit(c, k, ch, { atk: 20, baseBreak: 2 });
  assert.equal(hp0 - c.totalHp(ch), 10, "受击伤害 −50%");
  assert.equal(ch.def, def0, "不吃击破");
  c.endPlayerTurn();
  S.attackerId = ch.id; S.targetId = k.id;
  c.runSkill("en_chi_knife");
  assert.equal(ch.resources.cover, false, "她再出手就离开掩体");
});

test("赤牙：近距霰弹打得到同区、匕首只打同区；受击时花 1 附赠为自己格挡 70%；对霰弹的协助格挡 −40%", () => {
  const { c, S, P, E } = field([{ id: "chixia", lv: 5, zone: 2 }]);
  const ch = E("chixia"), k = P("kolt"), h = P("helu");
  tank(k); tank(h);
  k.zone = 2; h.zone = 1;
  S.combatPhase = "enemy"; c.refreshEnemyEconomy(ch);
  ch.resources.primed = true;
  S.attackerId = ch.id; S.targetId = k.id;
  let hp0 = c.totalHp(k);
  c.runSkill("en_chi_shot");
  c.BattleSim.resolveQueues(noBlock);
  assert.ok(c.totalHp(k) < hp0, "近距 2×atk 打到了");
  ch.ap = 3; S.attackerId = ch.id; S.targetId = h.id;
  hp0 = c.totalHp(h);
  c.runSkill("en_chi_knife");
  assert.equal(c.totalHp(h), hp0, "匕首近距离：打不到距离 1");
  // 霰弹：Helumica 替柯尔特格挡的成功率 −40%
  h.zone = 2; h.bonus = 1; ch.ap = 3; ch.resources.primed = true;
  const base = c.finalBlockChance(h, ch, k);
  S.attackerId = ch.id; S.targetId = k.id;
  c.runSkill("en_chi_shot");
  assert.equal(S.blockQueue.length, 1);
  assert.equal(c.finalBlockChance(h, ch, k), Math.max(5, base - 40));
  c.BattleSim.resolveQueues(noBlock);
  S.attackerId = ch.id; S.targetId = k.id;
  c.runSkill("en_chi_knife");
  assert.equal(c.finalBlockChance(h, ch, k), base, "匕首不带 −40%");
  c.BattleSim.resolveQueues(noBlock);
  // 自身格挡
  S.combatPhase = "player"; c.refreshEnemyEconomy(ch);
  assert.equal(c.blockChance(ch), 70);
  c.Math.random = () => 0;   // d100 掷出 1
  hp0 = c.totalHp(ch);
  c.dealTo(k, ch, { atk: 10, mult: 1, element: "physical", baseBreak: 2, atkRange: "any", flags: { action: true } });
  assert.equal(c.totalHp(ch), hp0, "格挡成功：免伤");
  assert.equal(ch.bonus, 0, "花掉 1 附赠");
  c.dealTo(k, ch, { atk: 10, mult: 1, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true } });
  assert.ok(c.totalHp(ch) < hp0, "附赠用完：第二下挡不了");
});

test("赤牙：剿灭是她的协助攻击，可以接自己打出的失衡；追猎的目标移动时跟过去的是赤牙", () => {
  const { c, S, P, E, logs } = field([{ id: "chixia", lv: 5, zone: 2 }]);
  const ch = E("chixia"), k = P("kolt"), h = P("helu");
  k.zone = 2; h.zone = 1; k.bonus = 0; h.bonus = 0; tank(k);
  k.def = 1;
  S.combatPhase = "enemy"; c.refreshEnemyEconomy(ch);
  assert.equal(c.enemyAssistSkillId(ch), "en_chi_exec");
  S.attackerId = ch.id; S.targetId = k.id;
  c.runSkill("en_chi_knife");
  assert.deepEqual(plain(c.eligibleAssisters(ch, k).map(u => u.id)), [ch.id]);
  const hp0 = c.totalHp(k);
  c.BattleSim.resolveQueues(noBlock);
  assert.ok(c.totalHp(k) < hp0);
  assert.match(logs(), /【赤牙】剿灭/);

  const f = field([{ id: "chixia", lv: 5, zone: 2 }]);
  const ch2 = f.E("chixia"), k2 = f.P("kolt"), h2 = f.P("helu");
  k2.zone = 1; h2.zone = 1;
  f.S.combatPhase = "enemy"; f.c.refreshEnemyEconomy(ch2);
  f.S.attackerId = ch2.id; f.S.targetId = h2.id;
  f.c.runSkill("en_chi_hunt");
  assert.deepEqual(plain(h2.chasers), [ch2.id]);
  f.S.combatPhase = "player"; h2.bonus = 1;
  f.c.doMove(h2, 2);
  assert.equal(ch2.zone, 2, "赤牙跟到同区");
  assert.equal(k2.zone, 1, "柯尔特不跟");
});

test("亡命之王 AI：只在危险时下回防（有人冲进王的区或王挨了打，且身边没有狂徒替他挡）；三区里强盗头子不对距离 2 空放火枪", () => {
  const { c, S, P, E } = field([{ id: "outlaw_king", lv: 3, zone: 2 }, { id: "bandit_boss", lv: 3, zone: 2 },
    { id: "thug_knife", lv: 3, zone: 2 }, { id: "thug_hammer", lv: 3, zone: 2 }]);
  const king = E("outlaw_king"), k = P("kolt");
  E("thug_knife").zone = 1; E("thug_hammer").zone = 1;   // 狂徒出去打人了
  S.combatPhase = "enemy"; c.refreshEnemyEconomy(king);
  king.damagedThisTurn = 5;
  assert.equal(c.EnemyAI.plan(king).meta.skillName, "攻击命令", "强盗头子还在身边替他挡：不叫回防");
  E("bandit_boss").zone = 1;
  king.damagedThisTurn = 0;
  assert.equal(c.EnemyAI.plan(king).meta.skillName, "攻击命令");
  king.damagedThisTurn = 5;
  assert.match(c.EnemyAI.plan(king).meta.skillName, /回防命令/, "王挨了打");
  king.damagedThisTurn = 0;
  k.zone = 2;
  assert.match(c.EnemyAI.plan(king).meta.skillName, /回防命令/, "有人冲进王的区");

  // 默认两区：玩家不动时狂徒能打到人（以前每回合被召回，永远打不到）
  const r = field([{ id: "outlaw_king", lv: 3 }, { id: "bandit_boss", lv: 3 }, { id: "thug_knife", lv: 3 }, { id: "thug_hammer", lv: 3 }], { seed: "king" });
  r.S.units.filter(u => u.isPlayer).forEach(tank);
  r.c.BattleSim.run({ maxRounds: 3, policy: { act: () => null, pickBlocker: () => null, pickAssister: l => l[0].id } });
  assert.match(r.logs(), /【狂徒（匕首）】匕首/);

  const t = field([{ id: "outlaw_king", lv: 3, zone: 3 }, { id: "bandit_boss", lv: 3, zone: 3 }], { zoneMode: 3 });
  const boss = t.E("bandit_boss");
  t.S.units.filter(u => u.isPlayer).forEach(u => { u.zone = 1; });
  t.S.combatPhase = "enemy"; t.c.refreshEnemyEconomy(boss);
  assert.equal(t.c.EnemyAI.plan(boss), null, "距离 2 打不到：不出手");
});

test("敌人协助的射程照手册：大沙灵任意距离、牛队长 / 匕首狂徒近距；AI 只选打得到的", () => {
  // 打出失衡的用四足沙灵：沙灵和狂徒、警卫队都不敌对，三个都能来协助（狂徒和警卫队互相敌对，打出失衡的若是狂徒，牛队长就不帮它）
  const { c, S, P, E } = field([{ id: "bigsand", lv: 3, zone: 2 }, { id: "captain_ox", lv: 3, zone: 2 }, { id: "thug_knife", lv: 3, zone: 2 }, { id: "sand_beast", lv: 1, zone: 1 }]);
  const k = P("kolt"), big = E("bigsand"), ox = E("captain_ox"), kn = E("thug_knife"), ham = E("sand_beast");
  k.zone = 1; S.combatPhase = "enemy"; k.def = 1; tank(k);
  hit(c, ham, k, { atk: 1, baseBreak: 1 });
  const list = c.eligibleAssisters(ham, k);
  assert.ok([big, ox, kn].every(u => list.includes(u)), "能出手的都在名单里");
  ox.atk = 999;   // 就算 atk 最高，打不到也不选
  assert.equal(c.EnemyAI.pickAssister(list, k), big.id);
  assert.equal(c.enemyAssistReach(ox, k), false);
  assert.equal(c.enemyAssistReach(kn, k), false);
  const hp0 = c.totalHp(k);
  c.finishAssist(big.id, {});
  assert.ok(c.totalHp(k) < hp0, "大沙灵距离 1 打得到");
  ox.zone = 1;
  assert.equal(c.enemyAssistReach(ox, k), true, "同区就打得到");
});

test("强盗头子协助：远离并拔枪（三区不朝目标走）；死掉的狂徒不出手；锤狂徒用自己的协助（冲近 atk/2）；都不能被格挡", () => {
  const { c, S, P, E, logs } = field([{ id: "bandit_boss", lv: 3, zone: 3 }, { id: "thug_knife", lv: 1, zone: 2 }, { id: "thug_hammer", lv: 1, zone: 1 }], { zoneMode: 3 });
  const k = P("kolt"), h = P("helu"), boss = E("bandit_boss"), kn = E("thug_knife"), ham = E("thug_hammer");
  k.zone = 2; h.zone = 2; h.bonus = 1; tank(k);
  kn.layers.forEach(l => { l.current = 0; }); c.settleEnemyKill(kn, []); c.sweepDeadEnemies();
  S.combatPhase = "enemy"; k.def = 1;
  hit(c, ham, k, { atk: 1, baseBreak: 1 });
  c.finishAssist(boss.id, {});
  assert.equal(boss.zone, 3, "已经隔一区：原地开枪");
  assert.equal(S.blockQueue.length, 0, "协助攻击不能被格挡");
  const text = logs();
  assert.match(text, /狂徒（锤） 因强盗头子连携发动协助/);
  assert.doesNotMatch(text, /狂徒（匕首） 因强盗头子连携发动协助/);
  assert.equal(ham.zone, 2, "锤狂徒冲到目标那一区");
  assert.match(text, new RegExp(`ATK ${c.effectiveAtk(ham, S.units)} × 0\\.5 =`), "锤狂徒打 atk/2");

  // 和目标同区：先退到相邻区再开枪
  const f = field([{ id: "bandit_boss", lv: 3, zone: 1 }, { id: "thug_hammer", lv: 1, zone: 1 }]);
  const k2 = f.P("kolt");
  k2.zone = 1; f.S.combatPhase = "enemy"; k2.def = 1; tank(k2);
  hit(f.c, f.E("thug_hammer"), k2, { atk: 1, baseBreak: 1 });
  f.c.finishAssist(f.E("bandit_boss").id, {});
  assert.equal(f.E("bandit_boss").zone, 2);
});

test("被挟持的亡命之王、哗变中的狂徒不对我方做协助攻击", () => {
  const { c, S, P, E } = field([{ id: "outlaw_king", lv: 1, zone: 1 }, { id: "bandit_boss", lv: 1, zone: 1 },
    { id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_hammer", lv: 1, zone: 1 }]);
  S.units.forEach(u => { u.zone = 1; });
  const king = E("outlaw_king"), boss = E("bandit_boss"), kn = E("thug_knife"), ham = E("thug_hammer"), k = P("kolt");
  kn.layers.forEach(l => { l.current = 0; }); c.settleEnemyKill(kn, []);
  ham.zone = 2;
  boss.layers.forEach(l => { l.current = Math.floor(l.max * 0.2); });
  c.mutinyTick([]);
  assert.equal(king.resources.hostage, true);
  const list = c.eligibleAssisters(null, k).map(u => u.kit);
  assert.ok(!list.includes("outlaw_king"), "被挟持的王");
  assert.ok(!list.includes("thug_hammer"), "哗变的狂徒");
  assert.ok(list.includes("bandit_boss"));
});

test("飞碟触灵被击毁走击杀结算：首领击杀分 +300、跑团经验倍率生效", () => {
  const { c, S, P } = field([{ id: "ufo_boss", lv: 3 }]);
  vm.runInContext("TRPG.active = true", c);
  S.xpMult = 2;
  const k = P("kolt");
  S.units.filter(u => u.kit === "ufo_leg").forEach(l => { k.zone = l.zone; hit(c, k, l, { atk: 999, element: "acid" }); });
  const body = S.units.find(u => u.kit === "ufo_body");
  assert.equal(body.dead, true);
  assert.equal(S.battleScore.parts.kill, 300);
  assert.match(S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n"), /击杀 飞碟触灵·本体 · 经验 ×2/);
});

test("飞碟触灵：自爆打所有角色和它自己召唤的看守（作者定），别的敌人不打；踩踏是 atk+1d4，不随等级升档", () => {
  const { c, S } = field([{ id: "ufo_boss", lv: 3 }, { id: "guard_sword", lv: 3, zone: 2 }, { id: "guard_gun", lv: 3, zone: 2 }]);
  const body = S.units.find(u => u.kit === "ufo_body"), g = S.units.find(u => u.kit === "guard_sword"), other = S.units.find(u => u.kit === "guard_gun");
  g.summonedBy = body.id;                      // 它自己召唤的
  g.layers.forEach(l => { l.current = l.max = 9999; });
  const gHp = c.totalHp(g), oHp = c.totalHp(other);
  body.resources.boomReady = true;
  c.detonateUfo(body);
  assert.ok(c.totalHp(g) < gHp, "自己召唤的看守也挨炸");
  assert.equal(c.totalHp(other), oHp, "不是它召唤的敌人不挨炸");
  assert.ok(S.units.filter(u => u.isPlayer && !u.hidden).some(u => c.totalHp(u) < c.totalMaxHp(u)));

  const f = field([{ id: "ufo_boss", lv: 10 }]);
  const b = f.S.units.find(u => u.kit === "ufo_body");
  f.S.units.filter(u => u.isPlayer).forEach(u => { u.zone = b.zone; tank(u); });
  f.S.combatPhase = "enemy"; b.ap = 1; f.S.attackerId = b.id; f.S.targetId = f.P("kolt").id;
  f.c.runSkill("ufo_stomp");
  f.c.BattleSim.resolveQueues(noBlock);
  const text = f.logs();
  assert.match(text, /掷骰 1d4/);
  assert.doesNotMatch(text, /掷骰 1d8/);
});

test("播撒者被击落后仍不吃自己铺的酸液地面", () => {
  const { c, S, P, E, logs } = field([{ id: "spreader", lv: 5, zone: 2 }]);
  const s = E("spreader"), k = P("kolt");
  k.zone = 2;
  hit(c, k, s, { atk: 1, baseBreak: 99 });
  assert.equal(s.flying, false);
  nextRound(c, S);
  nextRound(c, S);
  assert.doesNotMatch(logs(), /播撒者 酸液地面/);
  assert.equal(S.fields[2].acid, true);
});

test("空投蜂群的伤害骰每五级升一档；大沙灵治疗掷 2d4、不治已死的沙灵", () => {
  const { c, S, P, E, logs } = field([{ id: "swarm", lv: 10, zone: 1 }]);
  const k = P("kolt"), s = E("swarm");
  k.zone = 1; S.combatPhase = "enemy"; s.ap = 1; S.attackerId = s.id; S.targetId = k.id;
  c.runSkill("en_swarm");
  c.BattleSim.resolveQueues(noBlock);
  assert.match(logs(), /掷骰 2d8/);

  const f = field([{ id: "bigsand", lv: 3, zone: 2 }, { id: "sand_beast", lv: 3, zone: 2 }, { id: "sand_human", lv: 3, zone: 2 }]);
  const big = f.E("bigsand"), beast = f.E("sand_beast"), human = f.E("sand_human");
  human.layers[0].current = 10;
  hit(f.c, f.P("kolt"), beast, { atk: 999 });
  assert.equal(beast.dead, true);
  f.S.combatPhase = "enemy"; big.ap = 1; f.S.attackerId = big.id; f.S.targetId = f.P("kolt").id;
  f.c.runSkill("en_bigsand_heal");
  assert.equal(f.c.totalHp(beast), 0, "死掉的不治");
  assert.ok(human.layers[0].current >= 12 && human.layers[0].current <= 18, "2d4：" + human.layers[0].current);
  assert.match(f.logs(), /治疗 沙灵（人形） 沙尘 2d4〔/);
});

test("图鉴：3 / 4 人队的架势带人数加成，和战斗里一样", () => {
  const c = H.load();
  assert.equal(c.bestiaryStats("bandit_boss", 1, 2).def, 6);
  assert.equal(c.bestiaryStats("bandit_boss", 1, 3).def, 8);
  assert.equal(c.bestiaryStats("bandit_boss", 1, 4).def, 10);
  assert.equal(c.bestiaryStats("outlaw_king", 1, 4).def, 8, "首领六折：7×0.6 → 4，人数加成 6×0.6 → 4");
  c.BattleSim.setup({ party: ["kolt", "helu", "tou", "xia"], enemies: [{ id: "bandit_boss", lv: 1, zone: 2 }, { id: "outlaw_king", lv: 1, zone: 2 }], seed: "B" });
  const by = k => c.S.state.units.find(u => u.kit === k);
  assert.equal(by("bandit_boss").defMax, 10);
  assert.equal(by("outlaw_king").defMax, 8);
});

test("无界面模拟：敌人全灭时还在等格挡的那一击照样落下（最后一只蜂群撞完就死）", () => {
  const { c, S, P, E } = field([{ id: "swarm", lv: 1, zone: 1 }]);
  const k = P("kolt"), h = P("helu"), s = E("swarm");
  k.zone = 1; h.zone = 1; h.bonus = 1;
  S.combatPhase = "enemy"; s.ap = 1; S.attackerId = s.id; S.targetId = k.id;
  const hp0 = c.totalHp(k);
  c.runSkill("en_swarm");
  assert.equal(S.blockQueue.length, 1);
  assert.equal(c.BattleSim.outcome(), "player");
  c.BattleSim.resolveQueues(noBlock);
  assert.equal(S.blockQueue.length, 0);
  assert.ok(c.totalHp(k) < hp0, "这一击落下了");
});
