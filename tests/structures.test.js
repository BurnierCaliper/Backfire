// 配置物与危墙：能被技能选中，打一下照常消耗行动点，按技能的元素和倍率算
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(zoneMode) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "ruby"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  c.startCombat();
  const st = c.S.state;
  if (zoneMode) st.zoneMode = zoneMode;
  const kolt = c.findKit("kolt", st.units);
  kolt.zone = 1;
  return { c, st, kolt, aa: c.skillList(kolt).find(s => s.name === "普通攻击").id };
}

test("危墙可以被普通攻击打；打一下消耗行动点，打塌后变成畅通", () => {
  const { c, st, kolt, aa } = field();
  st.gaps["1-2"] = { type: "wall", hp: 8, maxHp: 8, open: false };
  kolt.ap = 1;
  st.attackerId = kolt.id; st.targetId = "gap:1-2";
  c.runSkill(aa);
  assert.equal(kolt.ap, 0);
  assert.ok(st.gaps["1-2"].hp < 8);
  // 行动点用完就不能再白打
  const hp = st.gaps["1-2"].hp;
  c.runSkill(aa);
  assert.equal(st.gaps["1-2"].hp, hp);
  st.gaps["1-2"].hp = 1; kolt.ap = 1;
  c.runSkill(aa);
  assert.equal(st.gaps["1-2"].type, "open");
});

test("配置物（炮台、爆炸桶）被打也消耗行动点", () => {
  const { c, st, kolt, aa } = field();
  const tur = c.makeProp("turret", 1, 1); tur.faction = "enemy";
  st.props = [tur];
  kolt.ap = 1;
  st.attackerId = kolt.id; st.targetId = "prop:" + tur.id;
  c.runSkill(aa);
  assert.equal(kolt.ap, 0);
  assert.ok(tur.hp < tur.maxHp);
});

test("近战够不到隔一个区的危墙", () => {
  const { c, st, kolt, aa } = field(3);
  st.gaps["2-3"] = { type: "wall", hp: 8, maxHp: 8, open: false };
  kolt.ap = 1;
  st.attackerId = kolt.id; st.targetId = "gap:2-3";
  const ov = c.skillRangeFor(kolt, aa);
  c.runSkill(aa);
  if (!ov || ov.max < 1) {
    assert.equal(st.gaps["2-3"].hp, 8);
    assert.equal(kolt.ap, 1);
  }
});

test("打配置物按技能写的元素：电流激荡是电，普通攻击没写就是物理", () => {
  const { c, st } = field();
  const ruby = c.findKit("ruby", st.units);
  ruby.level = 2;
  assert.equal(c.structureHitOpt(ruby, "ruby_surge").element, "electric");
  const kolt = c.findKit("kolt", st.units);
  const o = c.structureHitOpt(kolt, "__none__");
  assert.equal(o.element, "physical");
  assert.ok(o.dmg >= 1);
});

/* ---------- 按钮 / 拉杆 ---------- */
function deviceField() {
  const f = field();
  const { c, st } = f;
  st.gaps["1-2"] = { type: "door", hp: 0, maxHp: 0, open: false };
  const btn = c.makeProp("button", 1, 1); btn.link = "1-2";
  st.props = [btn];
  return Object.assign(f, { btn, door: () => st.gaps["1-2"].open });
}

test("按钮可以直接打：触发一次（门打开），也消耗行动点", () => {
  const { c, st, kolt, aa, btn, door } = deviceField();
  kolt.ap = 1;
  st.attackerId = kolt.id; st.targetId = "prop:" + btn.id;
  c.runSkill(aa);
  assert.equal(door(), true);
  assert.equal(kolt.ap, 0);
});

test("范围攻击波及按钮所在区：触发一次（多个目标也只触发一次）", () => {
  const { c, st, btn, door } = deviceField();
  const ruby = c.findKit("ruby", st.units);
  ruby.zone = 1;
  // 同区放两个敌人，用范围手榴弹炸 1 区
  st.units.filter(u => !u.isPlayer).forEach(u => { u.zone = 1; });
  c.bagAdd("bomb_e", 2);
  c.useItemOn(ruby, "bomb_e", null, 1);
  assert.equal(door(), true);
  // 没人的区也会炸到按钮
  st.units.filter(u => !u.isPlayer).forEach(u => { u.zone = 2; });
  c.useItemOn(ruby, "bomb_e", null, 1);
  assert.equal(door(), false);
});

test("场地效果、状态伤害不会触发按钮", () => {
  const { c, st, door } = deviceField();
  const foe = st.units.find(u => !u.isPlayer);
  foe.zone = 1;
  c.dealTo(foe, c.findKit("ruby", st.units), { atk: 0, mult: 0, flat: 3, element: "fire", baseBreak: 0,
    flags: { action: false, environment: true, aoe: true, blockResolved: true } });
  // 下一次普通的单体行动结算时也不能把它带出来
  const kolt = c.findKit("kolt", st.units);
  kolt.ap = 1; st.attackerId = kolt.id; st.targetId = foe.id;
  c.runSkill(c.skillList(kolt).find(s => s.name === "普通攻击").id);
  assert.equal(door(), false);
});

/* ---------- 画面用的击杀数据：溢出伤害、重击 ---------- */
test("打死敌人时记下溢出的伤害（显示成负血量）；一记打掉一半以上血量算重击", () => {
  const { c, st, kolt } = field();
  const foe = st.units.find(u => !u.isPlayer);
  foe.zone = 1;
  foe.layers.forEach(l => { l.current = 5; });
  c.dealTo(kolt, foe, { atk: 0, mult: 0, flat: 50, element: "physical", baseBreak: 0, flags: { action: true, blockResolved: true } });
  assert.equal(foe.dead, true);
  assert.equal(foe.overkill, 45);
  assert.equal(foe.killBig, true);
  // 小刀补死：有溢出但不算重击
  const c2 = field();
  const f2 = c2.st.units.find(u => !u.isPlayer);
  f2.zone = 1;
  f2.layers.forEach(l => { l.current = 1; });
  c2.c.dealTo(c2.kolt, f2, { atk: 0, mult: 0, flat: 3, element: "physical", baseBreak: 0, flags: { action: true, blockResolved: true } });
  assert.equal(f2.dead, true);
  assert.equal(f2.overkill, 2);
  assert.ok(!f2.killBig);
});

test("高能自爆：溢出 = 高能值 − 剩余生命，算重击", () => {
  const { c, st, kolt } = field();
  const foe = st.units.find(u => !u.isPlayer);
  foe.zone = 1;
  const life = c.totalHp(foe);
  foe.highEnergy = life + 30; foe.statuses.high = true;
  c.dealTo(kolt, foe, { atk: 0, mult: 0, flat: 1, element: "energy", baseBreak: 0, flags: { action: true, blockResolved: true } });
  assert.equal(foe.dead, true);
  assert.ok(foe.overkill >= 29, "溢出 " + foe.overkill);
  assert.equal(foe.killBig, true);
});

test("挂在下一击的猛击 / 穿刺 / 弱点特效不作用于环境伤害，也不会被它提前用掉", () => {
  const { c, st, kolt } = field();
  const foe = st.units.find(u => !u.isPlayer);
  foe.zone = 1;
  kolt.resources.smashNext = true; kolt.resources.pierceNext = true; kolt.resources.weakNext = true;
  const env = c.dealTo(kolt, foe, { atk: 0, mult: 0, flat: 2, element: "electric", baseBreak: 0,
    flags: { action: false, environment: true, blockResolved: true, atkFx: [] } });
  assert.ok(!env.res.flags.smash && !env.res.flags.pierce && !env.res.flags.weak, "环境伤害不该带猛击 / 穿刺 / 弱点特效");
  assert.equal(kolt.resources.pierceNext, true);
  assert.equal(kolt.resources.weakNext, true);
  const hit = c.dealTo(kolt, foe, { atk: 0, mult: 0, flat: 2, element: "physical", baseBreak: 1, flags: { action: true, blockResolved: true } });
  assert.ok(hit.res.flags.smash && hit.res.flags.pierce && hit.res.flags.weak, "真正的攻击才带上");
  assert.equal(kolt.resources.smashNext, false);
});

/* ---------- 战场数据 ---------- */
test("战场数据：造成伤害、击破、承伤、击杀按单位记下", () => {
  const { c, st, kolt } = field();
  const foe = st.units.find(u => !u.isPlayer);
  foe.zone = 1;
  const hp0 = c.totalHp(foe);
  const r = c.dealTo(kolt, foe, { atk: 0, mult: 0, flat: 7, element: "physical", baseBreak: 1, flags: { action: true, blockResolved: true } });
  const s = st.battleStats[kolt.id];
  assert.equal(s.dmg, hp0 - c.totalHp(foe));
  assert.equal(s.brk, r.res.breakDealt);
  // 敌人打柯尔特
  const k0 = c.totalHp(kolt);
  c.dealTo(foe, kolt, { atk: 0, mult: 0, flat: 4, element: "physical", baseBreak: 0, flags: { action: true, blockResolved: true } });
  assert.equal(s.taken, k0 - c.totalHp(kolt));
  // 补刀：击杀算柯尔特
  foe.layers.forEach(l => { l.current = 1; });
  c.dealTo(kolt, foe, { atk: 0, mult: 0, flat: 5, element: "physical", baseBreak: 0, flags: { action: true, blockResolved: true } });
  assert.equal(foe.dead, true);
  assert.equal(s.kills, 1);
  assert.equal(st.battleStats[c.findKit("ruby", st.units).id], undefined, "没出手的人没有记录");
});

test("战场数据：治疗只算给其他友方加的血量 / 护盾，给自己的不算", () => {
  const { c, st, kolt } = field();
  const ruby = c.findKit("ruby", st.units);
  ruby.layers.forEach(l => { l.current = Math.max(1, l.current - 6); });
  kolt.layers.forEach(l => { l.current = Math.max(1, l.current - 6); });
  const r0 = c.totalHp(ruby);
  c.trackHealBy(kolt, () => { c.healUnit(ruby, 4); c.healUnit(kolt, 4); });
  assert.equal(st.battleStats[kolt.id].heal, c.totalHp(ruby) - r0);
  assert.ok(st.battleStats[kolt.id].heal > 0);
});

/* ---------- 战斗评分 ---------- */
test("评分：伤害 1 分 / 击破 10 分 / 溢出 1.5 分（向下取整）/ 击杀按杂兵精英首领", () => {
  const { c, st, kolt } = field();
  const foe = st.units.find(u => !u.isPlayer);
  foe.zone = 1;
  c.resetBattleRecords();
  foe.layers.forEach(l => { l.current = 5; });
  const r = c.dealTo(kolt, foe, { atk: 0, mult: 0, flat: 12, element: "physical", baseBreak: 1, flags: { action: true, blockResolved: true } });
  const p = st.battleScore.parts;
  assert.equal(p.dmg, r.res.total);
  assert.equal(p.brk, r.res.breakDealt * 10);
  assert.equal(p.overkill, Math.floor((r.res.intended - r.res.total) * 1.5));
  assert.equal(p.kill, 20);   // 狂徒是杂兵
  // 12 点 ≥ 1 级门槛 10：算大伤害，这一击的分另有加成（单独记在 bonus）
  assert.ok(p.bonus > 0);
  assert.equal(st.battleScore.total, p.dmg + p.brk + p.overkill + p.kill + p.bonus);
  assert.equal(st.battleStats[kolt.id].score, st.battleScore.total);
});

test("评分：评价按得分 ÷ 基准分分段；基准分只算一次出现过的敌人", () => {
  const { c, st } = field();
  c.resetBattleRecords();
  const g0 = c.battleGrade();
  assert.equal(g0.grade, "C");
  assert.ok(g0.par > 0);
  const cut = Object.fromEntries(c.S.SCORE_GRADES.map(([g, k]) => [g, k]));
  st.battleScore.total = Math.ceil(g0.par * cut.B); assert.equal(c.battleGrade().grade, "B");
  st.battleScore.total = Math.ceil(g0.par * cut.A); assert.equal(c.battleGrade().grade, "A");
  st.battleScore.total = Math.ceil(g0.par * cut.S); assert.equal(c.battleGrade().grade, "S");
  assert.equal(c.battleGrade().xpMult, 2);
  st.battleScore.total = Math.ceil(g0.par * cut.B) - 1; assert.equal(c.battleGrade().grade, "C");
  // 敌人死了被移出场，基准分不变
  st.units = st.units.filter(u => u.isPlayer);
  assert.equal(c.battleGrade().par, g0.par);
});

test("评分：行动打进失衡 +50，协助格挡成功 +30，给其他友方的治疗按点数加分", () => {
  const { c, st, kolt } = field();
  c.resetBattleRecords();
  const foe = st.units.find(u => !u.isPlayer);
  foe.zone = 1; foe.def = 1;
  c.trackHealBy(kolt, () => {
    c.dealTo(kolt, foe, { atk: 0, mult: 0, flat: 1, element: "physical", baseBreak: 1, flags: { action: true, blockResolved: true } });
  });
  assert.equal(foe.stunned, true);
  assert.equal(st.battleScore.parts.stagger, 50);
  const ruby = c.findKit("ruby", st.units);
  ruby.layers.forEach(l => { l.current = Math.max(1, l.current - 5); });
  const r0 = c.totalHp(ruby);
  c.trackHealBy(kolt, () => c.healUnit(ruby, 3));
  assert.equal(st.battleScore.parts.heal, c.totalHp(ruby) - r0);
});

test("评分：协助格挡成功 +30（记在格挡的人身上）", () => {
  const { c, st, kolt } = field();
  c.resetBattleRecords();
  const ruby = c.findKit("ruby", st.units);
  const foe = st.units.find(u => !u.isPlayer);
  foe.zone = 1; kolt.zone = 1; ruby.zone = 1;
  st.combatPhase = "enemy";
  ruby.bonus = 1;
  c.dealTo(foe, kolt, { atk: 0, mult: 0, flat: 5, element: "physical", baseBreak: 1, flags: { action: true } });
  assert.ok(st.blockQueue.length, "应该在等格挡");
  c.finishBlock(ruby.id, { roll: 1, ok: true, chance: 50 });
  assert.equal(st.battleScore.parts.block, 30);
  assert.equal(st.battleScore.parts.action, 5, "格挡用掉 1 次附赠行动 +5");
  assert.equal(st.battleStats[ruby.id].score, 35);
});

test("评分：触发属性克制的一击，伤害 / 击破 / 溢出 / 击杀分 +25%，单独记成「克制加成」", () => {
  const { c, st, kolt } = field();
  const foe = st.units.find(u => !u.isPlayer);   // 狂徒：肉体
  foe.zone = 1;
  c.resetBattleRecords();
  // 先找一个打肉体有克制的属性
  const eles = ["fire", "ice", "electric", "acid", "energy", "harmonic", "physical"];
  const adv = eles.find(e => c.chartMod(e, "flesh") > 0.001);
  const neu = eles.find(e => Math.abs(c.chartMod(e, "flesh")) < 0.001);
  assert.ok(adv && neu, "要有克制和不克制的属性");
  const r1 = c.dealTo(kolt, foe, { atk: 0, mult: 0, flat: 3, element: neu, baseBreak: 1, flags: { action: true, blockResolved: true } });
  assert.equal(r1.res.advantage, false);
  assert.equal(st.battleScore.parts.bonus || 0, 0);
  const t0 = st.battleScore.total;
  const r2 = c.dealTo(kolt, foe, { atk: 0, mult: 0, flat: 3, element: adv, baseBreak: 1, flags: { action: true, blockResolved: true } });
  assert.equal(r2.res.advantage, true);
  assert.equal(foe.dead, false);
  const base = r2.res.total * 1 + r2.res.breakDealt * 10;
  assert.equal(st.battleScore.total - t0, base + Math.floor(r2.res.total * 0.25) + Math.floor(r2.res.breakDealt * 10 * 0.25));
  assert.ok(st.battleScore.parts.bonus > 0);
  // 克制的一击打死：击杀分也 +25%（杂兵 20 → +5）
  foe.layers.forEach(l => { l.current = 1; });
  const before = st.battleScore.parts.bonus;
  const r3 = c.dealTo(kolt, foe, { atk: 0, mult: 0, flat: 3, element: adv, baseBreak: 0, flags: { action: true, blockResolved: true } });
  assert.equal(foe.dead, true);
  const over = r3.res.intended - r3.res.total;
  assert.equal(st.battleScore.parts.bonus - before,
    Math.floor(r3.res.total * 0.25) + Math.floor(Math.floor(over * 1.5) * 0.25) + Math.floor(20 * 0.25));
});

test("危墙：耐久随机 1～15（手册）；只有击破会减耐久，伤害打不动", () => {
  const { c, st, kolt } = field();
  const seen = new Set();
  for (let i = 0; i < 300; i++) seen.add(c.defaultGapHp("wall"));
  assert.ok([...seen].every(n => n >= 1 && n <= 15), "超出 1～15：" + [...seen]);
  assert.ok(seen.size >= 12, "应该是随机的：" + [...seen].sort((a, b) => a - b));
  st.gaps["1-2"] = { type: "wall", hp: 10, maxHp: 10, open: false };
  c.hitStructure(kolt, "gap:1-2", { dmg: 50, brk: 2, element: "physical" });
  assert.equal(st.gaps["1-2"].hp, 8, "50 伤害 + 2 击破 → 只掉 2");
  c.hitStructure(kolt, "gap:1-2", { dmg: 50, brk: 0, element: "physical" });
  assert.equal(st.gaps["1-2"].hp, 8, "没有击破 → 不掉");
});

test("危墙倒塌：倒向最后一击来源的另一侧，对那一区造成 1d10（每五级 +1d10）伤害和 2 击破", () => {
  const { c, st, kolt } = field();
  const foe = st.units.find(u => !u.isPlayer);
  kolt.zone = 1; foe.zone = 2;
  st.gaps["1-2"] = { type: "wall", hp: 1, maxHp: 1, open: false, level: 1 };
  const hp0 = c.totalHp(foe), def0 = foe.def;
  c.hitStructure(kolt, "gap:1-2", { dmg: 5, brk: 1, element: "physical" });
  assert.equal(st.gaps["1-2"].type, "open");
  const lost = hp0 - c.totalHp(foe);
  assert.ok(lost >= 1 && lost <= 10 * 2, "1d10 物理（按克制可能浮动）：" + lost);
  assert.equal(def0 - foe.def, Math.min(def0, 2));
  assert.ok(c.totalHp(kolt) > 0);
});


test("评分：我方用行动点 +10、用附赠行动 +5（开战后才算，敌人不算）", () => {
  const { c, st, kolt } = field();
  c.resetBattleRecords();
  kolt.ap = 2; kolt.bonus = 1;
  c.spendAp(kolt, 1, "测试");
  c.spendBonus(kolt, 1, "测试");
  assert.equal(st.battleScore.parts.action, 15);
  const foe = st.units.find(u => !u.isPlayer);
  foe.ap = 1; c.spendAp(foe, 1, "测试");
  assert.equal(st.battleScore.parts.action, 15, "敌人用行动点不算");
  st.combatStarted = false; kolt.ap = 1;
  c.spendAp(kolt, 1, "测试");
  assert.equal(st.battleScore.parts.action, 15, "开战前不算");
});

test("评分：速杀奖励——1 / 2 / 3 回合内打完，整场分数 ×2 / ×1.5 / ×1.2，只算一次", () => {
  const { c, st } = field();
  const run = (turn) => {
    c.resetBattleRecords();
    st.battleScore.total = 1000; st.turnNo = turn;
    st.battleScore.hurt = true;   // 只看速杀，不吃无伤奖励
    const extra = c.applySpeedBonus();
    c.applySpeedBonus();
    return [extra, st.battleScore.total];
  };
  assert.deepEqual(run(1), [1000, 2000]);
  assert.deepEqual(run(2), [500, 1500]);
  assert.deepEqual(run(3), [200, 1200]);
  assert.deepEqual(run(4), [0, 1000]);
  assert.equal(st.battleScore.parts.speed || 0, 0);
});

test("评分：无伤奖励——我方没受伤：+100 再把倍率 +0.5，和速杀加算", () => {
  const { c, st } = field();
  const run = (turn, hurt) => {
    c.resetBattleRecords();
    st.battleScore.total = 1000; st.turnNo = turn;
    if (hurt) st.battleScore.hurt = true;
    const r = c.applyFinishBonus();
    c.applyFinishBonus();   // 只算一次
    return [r.mult, st.battleScore.total, st.battleScore.parts.flawless || 0, st.battleScore.parts.speed || 0];
  };
  assert.deepEqual(run(1, false), [2.5, 2750, 650, 1100]);    // (1000+100) × (1 + 1 + 0.5)
  assert.deepEqual(run(2, false), [2, 2200, 650, 550]);       // (1000+100) × (1 + 0.5 + 0.5)
  assert.deepEqual(run(3, false), [1.7, 1870, 650, 220]);
  assert.deepEqual(run(5, false), [1.5, 1650, 650, 0]);
  assert.deepEqual(run(1, true), [2, 2000, 0, 1000]);
});

test("评分：我方任何单位受到伤害（含护盾）就没有无伤奖励；敌人受伤不算", () => {
  const { c, st, kolt } = field();
  c.resetBattleRecords();
  const foe = st.units.find(u => !u.isPlayer);
  foe.zone = 1;
  c.dealTo(kolt, foe, { atk: 3, mult: 1, element: "physical", baseBreak: 0, flags: { action: true } });
  assert.ok(!st.battleScore.hurt, "打敌人不算我方受伤");
  const ruby = c.findKit("ruby", st.units);
  c.applyTypedDot(ruby, 2, "fire", [], "测试");
  assert.equal(st.battleScore.hurt, true);
  assert.equal(c.applyFinishBonus().flawless, false);
});

test("评分：大伤害加成——到门槛（目标等级×2+8）+10%，到门槛两倍及以上 +25%，中间线性；和克制加算", () => {
  const { c, st, kolt } = field();
  const foe = st.units.find(u => !u.isPlayer);
  foe.zone = 1;
  const th = foe.level * 2 + 8;
  assert.deepEqual([c.bigHitInfo(foe.level, th - 1).big, c.bigHitInfo(foe.level, th).ratio, c.bigHitInfo(foe.level, th * 2).ratio, c.bigHitInfo(foe.level, th * 5).ratio], [false, 0, 1, 1]);
  const bonusOf = (dmg, adv) => c.attackScoreBonus({ intended: dmg, total: dmg, advantage: adv }, foe);
  assert.equal(bonusOf(th - 1, false), 0);
  assert.ok(Math.abs(bonusOf(th, false) - 0.10) < 1e-9);
  assert.ok(Math.abs(bonusOf(Math.round(th * 1.5), false) - (0.10 + 0.15 * (Math.round(th * 1.5) - th) / th)) < 1e-9);
  assert.ok(Math.abs(bonusOf(th * 2, false) - 0.25) < 1e-9);
  assert.ok(Math.abs(bonusOf(th * 3, false) - 0.25) < 1e-9, "封顶 25%");
  assert.ok(Math.abs(bonusOf(th * 2, true) - 0.50) < 1e-9, "和克制加算：25% + 25%");
  // 实际打一下：一击 2 倍门槛的中性伤害 → 伤害分 +25%
  foe.layers.forEach(l => { l.max = 999; l.current = 999; });
  c.resetBattleRecords();
  const eles = ["fire", "ice", "electric", "acid", "energy", "harmonic", "physical"];
  const neu = eles.find(e => Math.abs(c.chartMod(e, foe.layers[0].type)) < 0.001);
  const r = c.dealTo(kolt, foe, { atk: 0, mult: 0, flat: th * 2, element: neu, baseBreak: 0, flags: { action: true, blockResolved: true } });
  assert.equal(r.res.advantage, false);
  assert.equal(st.battleScore.parts.bonus, Math.floor(r.res.total * 0.25 + 1e-6));
});

test("招式疲劳：同一角色连续几个回合用同一招，这次行动的总得分 −10% / −25% / −40%（封顶）；换招或隔一回合就重置", () => {
  const { c, st, kolt } = field();
  c.resetBattleRecords();
  const streakAt = (turn, id) => { st.turnNo = turn; const s = c.fatigueStreak(kolt, id); c.noteSkillUse(kolt, id, s); return c.fatiguePct(s); };
  assert.deepEqual([1, 2, 3, 4, 5].map(t => streakAt(t, "A")), [0, 0.10, 0.25, 0.40, 0.40]);
  assert.equal(streakAt(6, "B"), 0, "换招：重新算");
  assert.equal(streakAt(7, "A"), 0, "A 隔了一回合：重新算");
  assert.equal(streakAt(8, "A"), 0.10);
  // 同一回合里用两次：都按这回合的连续数，不会越用越多
  st.turnNo = 9;
  const s1 = c.fatigueStreak(kolt, "A"); c.noteSkillUse(kolt, "A", s1);
  const s2 = c.fatigueStreak(kolt, "A");
  assert.equal(s1, s2);
  assert.equal(c.fatiguePct(s1), 0.25);
});

test("招式疲劳：真的扣在这次行动的总得分上，单独记成「招式疲劳」", () => {
  const { c, st, kolt } = field();
  c.resetBattleRecords();
  const aa = c.skillList(kolt).find(s => s.name === "普通攻击").id;
  const foe = st.units.find(u => !u.isPlayer);
  foe.zone = 1; kolt.zone = 1;
  const act = (turn) => {
    st.turnNo = turn; st.combatPhase = "player"; kolt.ap = 1; foe.layers.forEach(l => { l.current = l.max; }); foe.def = foe.defMax; foe.stunned = false;
    const t0 = st.battleScore.total, f0 = st.battleScore.parts.fatigue || 0;
    st.attackerId = kolt.id; st.targetId = foe.id;
    c.runSkill(aa);
    return { net: st.battleScore.total - t0, cut: (st.battleScore.parts.fatigue || 0) - f0 };
  };
  const r1 = act(1), r2 = act(2);
  assert.equal(r1.cut, 0);
  assert.ok(r2.cut > 0);
  assert.equal(r2.cut, Math.floor((r2.net + r2.cut) * 0.10 + 1e-6), "第二回合扣这次行动总分的 10%");
});
