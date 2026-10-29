// 沙灵聚合体二阶段 · 电能炮（死刑机制）：锁定 → 倒数 → 蓄满减伤 → 开炮（分段可格挡、隔区衰减、同区波及）→ 过热熔融
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const vm = require("node:vm");
const CFG = c => vm.runInContext("AGG_CANNON", c);

function field(opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "sand_aggregate", lv: 5, zone: 2 }], seed: "AGG", zoneMode: opt.zoneMode || 2 });
  c.startCombat();
  const S = c.S.state;
  const a = S.units.find(u => u.kit === "sand_aggregate");
  const k = c.findKit("kolt", S.units), h = c.findKit("helu", S.units);
  S.units.forEach(u => { if (u.kit === "kolt") u.prideMaxHp = Infinity; });
  k.layers.forEach(l => { l.max = 2000; l.current = 2000; });   // 血量上限最高：电能炮锁定他
  h.layers.forEach(l => { l.max = 999; l.current = 999; });
  k.zone = 2; h.zone = 2;
  return { c, S, a, k, h, logs: () => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n") };
}
const hit = (c, a, t, extra) => c.dealTo(a, t, Object.assign({ atk: 10, mult: 1, element: "physical", baseBreak: 0, atkRange: "any",
  flags: { action: true, blockResolved: true, block: "none" } }, extra || {}));
/** 手动跳到第 n 回合（日志页一起跳，回合推进按日志页算） */
const setTurn = (S, n) => { S.turnNo = n; S.logPages.push({ turn: n, lines: [{ text: "" }] }); };
const hp = u => u.layers.reduce((n, l) => n + l.current, 0);
const noBlock = { pickBlocker: () => null, pickAssister: l => l[0].id };
/** 打穿外层沙壳进入二阶段 */
function toPhase2(c, a, k) {
  a.layers[0].current = 1;
  hit(c, k, a, { atk: 50 });
  assert.equal(a.resources.phase, 2);
}

test("进入二阶段：挂上电能炮，锁定血量上限最高的人，两回合后落下；技能表里不再有开炮 / 过热", () => {
  const { c, S, a, k } = field();
  toPhase2(c, a, k);
  const m = a.mechanics.find(x => x.aggCannon);
  assert.ok(m, "挂上电能炮");
  assert.equal(m.st.targetId, k.id);
  assert.equal(m.st.due, S.turnNo + CFG(c).turns);
  const ids = c.enemySkillList(a).map(x => x.id);
  assert.ok(!ids.includes("en_agg2_charge") && !ids.includes("en_agg2_overheat"));
  assert.ok(ids.includes("en_agg2_melee"));
});

test("开炮那一回合蓄满能量：我方打它伤害 −50%；前一回合不减", () => {
  const { c, S, a, k } = field();
  toPhase2(c, a, k);
  const m = a.mechanics.find(x => x.aggCannon);
  a.layers.forEach(l => { l.max = 5000; l.current = 5000; });
  setTurn(S, m.st.due - 1);
  assert.equal(c.mechChargeDr(a), 0);
  const before = hit(c, k, a, { atk: 40 }).res.total;
  setTurn(S, m.st.due);
  assert.equal(c.mechChargeDr(a), CFG(c).chargeDr);
  const charged = hit(c, k, a, { atk: 40 }).res.total;
  assert.equal(charged, Math.floor(before * (1 - CFG(c).chargeDr)));
  a.stunned = true;
  assert.equal(c.mechChargeDr(a), 0, "失衡打断蓄力：不减伤");
});

test("开炮：每段可以协助格挡；同区的其他人被波及（不能格挡）；炮后自身熔融留到下一个我方回合结束；重新锁定", () => {
  const { c, S, a, k, h, logs } = field();
  toPhase2(c, a, k);
  const m = a.mechanics.find(x => x.aggCannon);
  setTurn(S, m.st.due);
  S.combatPhase = "enemy";
  S.lateRound = S.turnNo;   // 敌人回合开始时记的回合数（startEnemyPhase）：即时效果按它判施加时是谁的回合（#482）
  const k0 = hp(k), h0 = hp(h);
  c.bossMechPhaseStart("enemy", []);
  c.BattleSim.resolveQueues(noBlock);
  assert.ok(hp(k) < k0, "目标挨了电能炮");
  assert.equal(h0 - hp(h) > 0, true, "同区的人被波及");
  assert.match(logs(), /电能炮 波及 2 区/);
  assert.equal(a.instant.melt, true, "过热：自身熔融");
  assert.equal(m.st.due, S.turnNo + CFG(c).interval, "重新锁定，隔 interval 回合再开炮");
  // 正好持续到下一个我方回合结束：下一个我方回合熔融还在，下一个敌人回合开始时失效（#482；以前撑到再下一个整轮开始）
  c.endEnemyTurn();
  assert.equal(a.instant.melt, true, "开炮后的我方回合还熔融着");
  c.endPlayerTurn();
  assert.equal(a.instant.melt, false, "下一个敌人回合开始时失效");
});

test("隔区开炮衰减（0.5×atk + 1d10），也不波及", () => {
  const { c, S, a, k, h, logs } = field();
  toPhase2(c, a, k);
  const m = a.mechanics.find(x => x.aggCannon);
  k.zone = 1; h.zone = 2;
  setTurn(S, m.st.due); S.combatPhase = "enemy";
  const h0 = hp(h);
  c.bossMechPhaseStart("enemy", []);
  c.BattleSim.resolveQueues(noBlock);
  assert.match(logs(), /隔区衰减/);
  assert.equal(hp(h), h0, "目标不在 2 区：2 区的人不被波及");
});

test("进三阶段卸下电能炮；吸引碎片回到二阶段重新挂上", () => {
  const { c, S, a, k } = field();
  toPhase2(c, a, k);
  const armor = a.layers.find(l => l.type === "armor");
  armor.current = 1;
  hit(c, k, a, { atk: 50 });
  assert.equal(a.resources.phase, 3);
  assert.ok(!(a.mechanics || []).some(x => x.aggCannon), "三阶段没有电能炮");
  S.combatPhase = "enemy"; a.ap = 2; S.attackerId = a.id;
  c.runSkill("en_agg3_debris"); a.ap = 2; c.runSkill("en_agg3_debris");
  assert.equal(a.resources.phase, 2);
  assert.ok(a.mechanics.some(x => x.aggCannon), "回到二阶段重新挂上");
});
