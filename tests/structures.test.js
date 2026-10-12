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
  // 手榴弹也炸到瑞比自己：血量放够，免得把自己炸成濒死（濒死时不能用道具）
  ruby.layers.forEach(l => { l.max = 999; l.current = 999; });
  // 同区放两个敌人，用范围手榴弹炸 1 区
  st.units.filter(u => !u.isPlayer).forEach(u => { u.zone = 1; });
  c.bagAdd("bomb_e", 2);
  c.useItemOn(ruby, "bomb_e", null, 1);
  assert.equal(door(), true);
  // 按钮按下后保持到回合结束：同一回合再炸一次没有变化
  c.useItemOn(ruby, "bomb_e", null, 1);
  assert.equal(door(), true);
  // 回合结束按钮弹起；下一回合没人的区也会炸到按钮
  c.endPlayerTurn(); c.endEnemyTurn();
  assert.equal(door(), false);
  st.units.filter(u => !u.isPlayer).forEach(u => { u.zone = 2; });
  c.bagAdd("bomb_e", 1);
  c.useItemOn(ruby, "bomb_e", null, 1);
  assert.equal(door(), true);
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

test("评分：分数线 = 固定线 × 0.65 + 基准分 × 倍数 × 0.35；固定线第一幕 C 500 / B 1000 / A 1250 / S 1500 / SS 1750 / SSS 2000，之后每幕各 +150", () => {
  const { c, st } = field();
  c.resetBattleRecords();
  const par = c.scorePar();
  assert.ok(par > 0);
  const want = (act, fixed, k) => Math.ceil(((fixed + 150 * (act - 1)) * 0.65 + par * k * 0.35) / 10 - 1e-9) * 10;
  const fixed = { C: [500, 0.7], B: [1000, 2.0], A: [1250, 2.6], S: [1500, 3.2], SS: [1750, 3.8], SSS: [2000, 4.4] };
  for (const act of [1, 4]) {
    st.scoreAct = act;
    const lines = c.battleGrade().lines;
    for (const g of Object.keys(fixed)) {
      const v = lines.find(x => x[0] === g)[1];
      assert.equal(v, want(act, ...fixed[g]), `第 ${act} 幕 ${g}`);
      assert.equal(v % 10, 0, "分数线是 10 的倍数");
    }
  }
  const at = (act, score) => { st.scoreAct = act; st.battleScore.total = score; return c.battleGrade(); };
  const C1 = want(1, 500, 0.7), S1 = want(1, 1500, 3.2), B2 = want(2, 1000, 2.0);
  assert.equal(at(1, 0).grade, "D");
  assert.equal(at(1, C1 - 1).grade, "D");
  assert.equal(at(1, C1).grade, "C");
  assert.equal(at(1, S1).grade, "S");
  assert.equal(at(1, S1).xpMult, 2);
  assert.equal(at(1, want(1, 2000, 4.4)).grade, "SSS");
  assert.equal(at(1, want(1, 2000, 4.4)).xpMult, 2, "SSS 不提高经验倍率");
  assert.equal(at(1, want(1, 1000, 2.0)).xpMult, 1.2);
  const g = at(2, B2 - 1);
  assert.equal(g.grade, "C");
  assert.deepEqual(JSON.parse(JSON.stringify(g.next)), { grade: "B", need: B2 });
  assert.equal(g.par, par);
});

test("评分：基准分只算敌人的血量和击杀分，击破、失衡不算（那是额外的漂亮操作）", () => {
  const { c, st } = field();
  c.resetBattleRecords();
  const foes = st.units.filter(u => !u.isPlayer && u.kit !== "ironwall");
  const hp = foes.reduce((a, u) => a + u.layers.reduce((b, l) => b + l.max, 0), 0);
  const kill = foes.reduce((a, u) => a + c.S.SCORE_RULES.kill[c.enemyRankOf(u)], 0);
  assert.equal(c.scorePar(), hp + kill);
  // 架势再高，基准分也不变
  c.resetBattleRecords();
  foes.forEach(u => { u.defMax = 99; });
  assert.equal(c.scorePar(), hp + kill);
  // 不在单局里（跑团 / 战斗原型）：按敌人等级对应到幕
  st.scoreAct = null;
  st.units.filter(u => !u.isPlayer).forEach(u => { u.level = 10; });
  assert.equal(c.scoreAct(), 3);
  st.units.filter(u => !u.isPlayer).forEach(u => { u.level = 2; });
  assert.equal(c.scoreAct(), 1);
});

test("敌人的协助攻击不花行动点：行动点用完、拿普通攻击当协助攻击的敌人也能出手", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby"], enemies: [{ id: "crow", lv: 2, zone: 1 }, { id: "crow", lv: 2, zone: 1 }] });
  c.startCombat();
  const st = c.S.state;
  const ruby = c.findKit("ruby", st.units);
  const foes = st.units.filter(u => !u.isPlayer);
  assert.equal(c.enemyAssistSkillId(foes[1]), "en_aa", "乌鸦没有专属协助技能");
  foes.forEach(f => { f.ap = 0; f.zone = 1; });
  ruby.zone = 1; ruby.def = 0; ruby.stunned = true;
  st.assistQueue = [{ breakerId: foes[0].id, targetId: ruby.id, vsPlayer: true }];
  st.combatPhase = "enemy";
  c.finishAssist(foes[1].id);
  const log = st.logPages.map(p => p.lines.map(l => l.text || l).join("\n")).join("\n");
  assert.doesNotMatch(log, /行动点不足/);
  assert.match(log, /发动协助攻击/);
  assert.equal(foes[1].ap, 0, "没有扣成负数");
  // 平时（不是协助攻击）行动点不够还是不能出手
  st.attackerId = foes[1].id; st.targetId = ruby.id;
  c.runSkill("en_aa");
  assert.match(st.logPages.map(p => p.lines.map(l => l.text || l).join("\n")).join("\n"), /行动点不足/);
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
  assert.equal(st.battleScore.parts.heal, Math.floor((c.totalHp(ruby) - r0) * 1.5), "治疗每点 1.5 分");
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
  assert.equal(st.battleScore.parts.blockSave, 5, "挡下的 5 点伤害算格挡减免");
  assert.equal(st.battleStats[ruby.id].score, 40);
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

/* ---------- 灯：普通攻击、声波切割能打危墙 / 配置物；没合法目标不花行动点 ---------- */
function touField() {
  const c = H.load();
  c.BattleSim.setup({ party: ["tou", "ruby"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  c.startCombat();
  const st = c.S.state;
  const tou = c.findKit("tou", st.units);
  tou.zone = 1;
  st.gaps["1-2"] = { type: "wall", hp: 8, maxHp: 8, open: false };
  const use = (id, picks, targetId) => {
    st.attackerId = tou.id; st.targetId = targetId || null;
    st.skillFlow = picks ? { id, actorId: tou.id, picks, index: 99 } : null;
    try { c.runSkill(id); } finally { st.skillFlow = null; }
  };
  return { c, st, tou, use };
}

test("灯的普通攻击：分步选目标里有危墙和同区配置物，打危墙扣 1 耐久（击破）并花 1 行动点", () => {
  const { c, st, tou, use } = touField();
  const barrel = c.makeProp("boom", 1, 1);
  st.props.push(barrel);
  tou.resources.shield = 0;
  const steps = c.skillFlowSteps("tou_aa", tou, {});
  const ids = steps.find(s => s.key === "target").units.map(u => u.id);
  assert.ok(ids.includes("gap:1-2"), ids.join(","));
  assert.ok(ids.includes("prop:" + barrel.id));
  tou.ap = 2;
  use("tou_aa", { target: "gap:1-2" }, "gap:1-2");
  assert.equal(st.gaps["1-2"].hp, 7);
  assert.equal(tou.ap, 1);
});

test("灯的普通攻击耗圣盾打距离 1 的配置物：扣 1 圣盾；没圣盾时不花行动点", () => {
  const { c, st, tou, use } = touField();
  st.gaps["1-2"] = c.emptyGap();   // 这里测射程：危墙倒塌之前打不到墙对面的配置物（手册第八章），先把墙拿掉
  const p = c.makeProp("battery", 2, 1);
  st.props.push(p);
  tou.ap = 2; tou.resources.shield = 1;
  const hp = p.hp;
  use("tou_aa", { rangeMode: "far", target: "prop:" + p.id }, "prop:" + p.id);
  assert.ok(p.hp < hp);
  assert.equal(tou.resources.shield, 0);
  assert.equal(tou.ap, 1);
  use("tou_aa", { rangeMode: "far", target: "prop:" + p.id }, "prop:" + p.id);
  assert.equal(tou.ap, 1, "没圣盾：不花行动点");
});

test("声波切割：没有圣盾、没有目标、目标距离不对都不花行动点；能同时打危墙和敌人", () => {
  const { c, st, tou, use } = touField();
  const foe = st.units.find(u => !u.isPlayer);
  tou.ap = 2; tou.resources.shield = 0;
  assert.match(c.skillRequirementError(tou, "tou_sonic"), /圣盾/);
  use("tou_sonic", { target1: "gap:1-2" }, "gap:1-2");
  assert.equal(tou.ap, 2);
  tou.resources.shield = 2;
  use("tou_sonic", {}, null);
  assert.equal(tou.ap, 2, "没选目标");
  use("tou_sonic", { target1: foe.id }, foe.id);   // 敌人在 2 区，不是同区
  assert.equal(tou.ap, 2, "距离不对");
  // 危墙算同区（1 区在它旁边），敌人在距离 1
  const steps = c.skillFlowSteps("tou_sonic", tou, {});
  assert.ok(steps[0].units.some(u => u.id === "gap:1-2"));
  // 危墙挡着穿过它的攻击，所以同时打对面敌人用不稳桥梁（不挡攻击）
  st.gaps["1-2"] = { type: "bridge", hp: 30, maxHp: 30, open: true };
  const hpFoe = c.totalHp(foe);
  use("tou_sonic", { target1: "gap:1-2", target2: foe.id }, foe.id);
  assert.equal(tou.ap, 1);
  assert.equal(tou.resources.shield, 1);
  // 声波切割每个目标 1 击破（作者定），桥梁 / 危墙按击破扣耐久
  assert.ok(st.gaps["1-2"].hp < 30, "桥梁挨了一下");
  assert.ok(c.totalHp(foe) < hpFoe);
  // 只打危墙：照样耗圣盾，按击破扣耐久
  st.gaps["1-2"] = { type: "wall", hp: 8, maxHp: 8, open: false };
  use("tou_sonic", { target1: "gap:1-2" }, "gap:1-2");
  assert.ok(st.gaps["1-2"].hp < 8, "危墙挨了一下");
  assert.equal(tou.resources.shield, 0);
  // 周围什么都没有：按钮直接不可用
  st.gaps["1-2"] = { type: "open", hp: 0 };
  foe.zone = 3; st.zoneMode = 3; tou.resources.shield = 1;
  assert.match(c.skillRequirementError(tou, "tou_sonic") || "", /没有可以打的目标/);
});

test("敌人 AI：所有目标都隔着危墙时先打墙，墙这边还有目标就照常打人；不会再卡成打不完的战斗", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["tou", "xia"], enemies: [{ id: "guard_sword", lv: 3, zone: 2 }, { id: "swarm", lv: 3, zone: 2 }] });
  c.startCombat();
  const st = c.S.state;
  const heroes = st.units.filter(u => u.isPlayer);
  heroes.forEach(u => { u.zone = 1; });
  st.gaps["1-2"] = { type: "wall", hp: 3, maxHp: 3, open: false };
  const guard = st.units.find(u => u.kit === "guard_sword");
  st.combatPhase = "enemy";
  guard.ap = 1;
  const p1 = c.S.EnemyAI.plan(guard);
  assert.match(p1.meta.skillName, /攻击危墙/);
  assert.equal(p1.meta.targetId, "gap:1-2");
  p1.thunk();
  assert.equal(st.gaps["1-2"].hp, 2, "墙挨了一下");
  // 我方有人在墙这边：照常打人
  heroes[0].zone = 2;
  guard.ap = 1;
  const p2 = c.S.EnemyAI.plan(guard);
  assert.doesNotMatch(p2.meta.skillName, /危墙/);
  // 整场打下来：墙会被打塌，战斗能分出胜负
  const c2 = H.load();
  c2.BattleSim.setup({ party: ["tou", "xia"], enemies: [{ id: "guard_sword", lv: 2, zone: 2 }, { id: "guard_sword", lv: 2, zone: 2 }], seed: "WALL" });
  c2.S.state.zoneMode = 2;
  c2.S.state.units.filter(u => u.isPlayer).forEach(u => { u.zone = 1; });
  c2.S.state.gaps["1-2"] = { type: "wall", hp: 6, maxHp: 6, open: false };
  const r = c2.BattleSim.run({ maxRounds: 30, policy: { act: () => null } });   // 我方原地不动
  assert.notEqual(r.winner, "timeout", "敌人会把墙打掉、打过来");
  assert.notEqual(c2.S.state.gaps["1-2"].type, "wall");
});

test("爆炸桶只怕火焰（−3）、能量 / 雷电（−1）；物理等其他属性打不动", () => {
  const { c, st, kolt } = field();
  const boom = c.makeProp("boom", 1, 1);
  st.props.push(boom);
  c.hitStructureCore(kolt, "prop:" + boom.id, { dmg: 10, brk: 1, element: "physical" });
  assert.equal(boom.hp, 3);
  c.hitStructureCore(kolt, "prop:" + boom.id, { dmg: 10, brk: 1, element: "electric" });
  assert.equal(boom.hp, 2);
});

test("爆炸桶爆炸是范围伤害：不弹协助格挡，不打已经死掉的单位", () => {
  const { c, st, kolt } = field();
  const ruby = c.findKit("ruby", st.units);
  ruby.zone = 1;
  const thug = st.units.find(u => !u.isPlayer);
  thug.zone = 1; thug.dead = true;
  const boom = c.makeProp("boom", 1, 1);
  st.props.push(boom);
  st.blockQueue = [];
  c.hitStructureCore(kolt, "prop:" + boom.id, { dmg: 10, brk: 1, element: "fire" });
  assert.ok(!st.props.includes(boom), "爆了");
  assert.equal((st.blockQueue || []).length, 0, "没有等协助格挡");
});

test("防卫炮台：只打活着、没被危墙挡住、atk 最高的敌对单位；不限距离", () => {
  const { c, st, kolt } = field(3);
  const ruby = c.findKit("ruby", st.units);
  const thug = st.units.find(u => !u.isPlayer);
  thug.dead = true;          // 唯一的敌人死了：我方炮台不该去打尸体
  const tur = c.makeProp("turret", 1, 2);
  st.props.push(tur);
  // 敌方炮台在 1 区，ruby 在 3 区（距离 2）、atk 拉到最高
  const etur = c.makeProp("turret", 1, 2);
  etur.faction = "enemy";
  st.props.push(etur);
  ruby.zone = 3; ruby.atk = 999; kolt.zone = 1;
  ruby.statuses.high = false; kolt.statuses.high = false;
  c.endPlayerTurn();
  c.endEnemyTurn();
  assert.equal(ruby.statuses.high, true, "距离 2 也打得到");
  assert.equal(kolt.statuses.high, false);
  assert.equal(thug.statuses.high, false, "不打死掉的单位");
});

test("防卫炮台打不到危墙后面的单位", () => {
  const { c, st, kolt } = field(2);
  const ruby = c.findKit("ruby", st.units);
  st.units.filter(u => !u.isPlayer).forEach(u => { u.zone = 2; });
  kolt.zone = 2; ruby.zone = 2;
  st.gaps["1-2"] = { type: "wall", hp: 8, maxHp: 8, open: false };
  const etur = c.makeProp("turret", 1, 2);
  etur.faction = "enemy";
  st.props.push(etur);
  kolt.statuses.high = false; ruby.statuses.high = false;
  c.endPlayerTurn();
  c.endEnemyTurn();
  assert.equal(kolt.statuses.high || ruby.statuses.high, false);
});

test("观测鸦：def 每五级 +1（lv4 6、lv9 7）；第一次受到的攻击伤害以能量反弹；高能只在打中时施加", () => {
  const c = H.load();
  const defAt = (lv) => {
    c.BattleSim.setup({ party: ["kolt"], enemies: [{ id: "watchcrow", lv, zone: 1 }] });
    return c.findKit("watchcrow", c.S.state.units).defMax;
  };
  assert.equal(defAt(4), 6);
  assert.equal(defAt(9), 7);
  c.BattleSim.setup({ party: ["kolt"], enemies: [{ id: "watchcrow", lv: 4, zone: 1 }] });
  c.startCombat();
  const st = c.S.state;
  const k = c.findKit("kolt", st.units), w = c.findKit("watchcrow", st.units);
  k.zone = 1;
  const hp = (u) => u.layers.reduce((a, l) => a + l.current, 0);
  const k0 = hp(k);
  const out = c.dealTo(k, w, { atk: 20, mult: 1, element: "physical", baseBreak: 1, flags: { action: true, blockResolved: true } });
  assert.ok(out.res.total > 0);
  assert.ok(hp(k) < k0, "反弹打到攻击者");
  const k1 = hp(k);
  w.resources.reflect = false;
  c.dealTo(k, w, { atk: 20, mult: 1, element: "physical", baseBreak: 1, flags: { action: true, blockResolved: true, flyPaid: true } });
  assert.equal(hp(k), k1, "一回合只反弹一次");
  // 高能：被墙挡住时不上
  st.zoneMode = 2; w.zone = 2; k.zone = 1; k.statuses.high = false;
  st.gaps["1-2"] = { type: "wall", hp: 8, maxHp: 8, open: false };
  const lines = [];
  c.runEnemyAction("en_watch", w, k, (a, t, o) => { const r = c.dealTo(a, t, o); if (r && r.extra) lines.push(...r.extra); }, lines, () => true);
  assert.equal(k.statuses.high, false, lines.join("\n"));
});

test("按钮：改变状态直到整个回合结束（开的门下一回合自动关上）；拉杆：切换一次，一直保持", () => {
  const { c, st, btn, door } = deviceField();
  c.useDevice(btn);
  assert.equal(door(), true);
  c.useDevice(btn);
  assert.equal(door(), true, "按住期间再按没有效果");
  c.endPlayerTurn(); c.endEnemyTurn();
  assert.equal(door(), false, "回合结束门自动关上");
  const lever = c.makeProp("lever", 1, 1); lever.link = "1-2";
  st.props.push(lever);
  c.useDevice(lever);
  assert.equal(door(), true);
  c.endPlayerTurn(); c.endEnemyTurn();
  assert.equal(door(), true, "拉杆切换后一直保持");
  c.useDevice(lever);
  assert.equal(door(), false);
});

test("不稳桥梁：耐久随机 10–30；被攻击时和危墙一样只按击破扣耐久", () => {
  const { c, st, kolt } = field();
  const seen = new Set();
  for (let i = 0; i < 300; i++) { const hp = c.defaultGapHp("bridge"); assert.ok(hp >= 10 && hp <= 30); seen.add(hp); }
  assert.ok(seen.size > 10, "是随机的");
  st.gaps["1-2"] = { type: "bridge", hp: 12, maxHp: 12, open: true };
  c.hitStructureCore(kolt, "gap:1-2", { dmg: 50, brk: 2, element: "physical" });
  assert.equal(st.gaps["1-2"].hp, 10);
  c.hitStructureCore(kolt, "gap:1-2", { dmg: 50, brk: 10, element: "physical" });
  assert.equal(st.gaps["1-2"].type, "void");
});

test("电池、炮台是装甲生命：被打时照属性克制表算倍率（酸 ×1.5，物理 ×0.75）", () => {
  const { c, st, kolt } = field();
  const tur = c.makeProp("turret", 1, 1);
  const bat = c.makeProp("battery", 1, 1);
  st.props = [tur, bat];
  const t0 = tur.hp, b0 = bat.hp;
  c.hitStructureCore(kolt, "prop:" + tur.id, { dmg: 10, brk: 1, element: "acid" });
  assert.equal(tur.hp, t0 - 15);
  c.hitStructureCore(kolt, "prop:" + bat.id, { dmg: 10, brk: 1, element: "physical" });
  assert.equal(bat.hp, b0 - 7);
});

test("防卫炮台：同区花 1 行动点做困难数据操作检定，成功后归我方", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  c.startCombat();
  const st = c.S.state;
  const ruby = c.findKit("ruby", st.units), kolt = c.findKit("kolt", st.units);
  ruby.zone = 1; kolt.zone = 1;
  const tur = c.makeProp("turret", 1, 1); tur.faction = "enemy";
  st.props = [tur];
  // 柯尔特没有数据操作：做不了
  assert.match(c.turretHackError(kolt, tur), /数据操作/);
  // 瑞比数据操作二级：困难 50%，人类失败后重掷 → 75%
  const odds = c.turretHackOdds(ruby);
  assert.equal(odds.level, 2);
  assert.ok(Math.abs(odds.chance - 0.75) < 1e-9);
  assert.ok(c.hackableTurrets(ruby).includes(tur));
  // 掷到成功为止（每次 1 行动点）
  let tries = 0;
  while (tur.faction === "enemy" && tries < 30) {
    ruby.ap = 1;
    st.attackerId = ruby.id;
    c.runSkill("hack_turret:" + tur.id);
    assert.equal(ruby.ap, 0, "花 1 行动点");
    tries++;
  }
  assert.equal(tur.faction, "player");
  assert.equal(c.hackableTurrets(ruby).length, 0, "已经是我方的不能再改");
  // 不同区不能改
  tur.faction = "enemy"; ruby.zone = 2;
  assert.match(c.turretHackError(ruby, tur), /同区/);
});

test("可移动的配置物能被位移技能移动：拉拽、重整", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  c.startCombat();
  const st = c.S.state;
  st.zoneMode = 3;
  const kolt = c.findKit("kolt", st.units);
  kolt.zone = 1;
  const boom = c.makeProp("boom", 2, 1);
  const tur = c.makeProp("turret", 2, 1);
  st.props = [boom, tur];
  const lines = [];
  assert.equal(c.displaceTo(boom, 1, lines, "被拉拽"), true);
  assert.equal(boom.zone, 1);
  assert.equal(c.displaceTo(tur, 1, lines, "被拉拽"), false, "炮台不能移动");
  assert.equal(tur.zone, 2);
  // 重整：距离 1 内的单位和可移动的配置物各移 1 区
  kolt.level = 4;
  kolt.ap = 1;
  st.attackerId = kolt.id;
  st.targetId = null;
  c.runSkill("role_rearrange");
  assert.notEqual(boom.zone, 1, "重整把同区的爆炸桶也挪了");
});

function bernielField(foeZone) {
  const c = H.load();
  c.BattleSim.setup({ party: ["xia", "ruby"], enemies: [{ id: "thug_knife", lv: 1, zone: foeZone }] });
  c.startCombat();
  const st = c.S.state;
  const xia = c.findKit("xia", st.units);
  xia.zone = 1; xia.ap = 3; xia.bonus = 3;
  st.attackerId = xia.id;
  c.runSkill("xia_summon");
  const b = st.units.find(u => u.weaponOf === xia.id || u.kit === "berniel");
  b.zone = 1; b.ap = 3; b.bonus = 3;
  st.attackerId = b.id;
  return { c, st, b };
}

test("范围攻击会波及同区的配置物：柏妮尔喷火能点爆同区的爆炸桶（同区有敌人）", () => {
  const { c, st, b } = bernielField(1);
  const boom = c.makeProp("boom", 1, 1);
  st.props.push(boom);
  c.runSkill("berniel_spit");
  assert.ok(!st.props.includes(boom), "爆炸桶被火焰范围攻击打爆");
});

test("范围攻击波及配置物：同区没有敌人也照样点爆；连锁炸掉同区另一个桶", () => {
  const { c, st } = bernielField(2);
  const b1 = c.makeProp("boom", 1, 1), b2 = c.makeProp("boom", 1, 1);
  b2.hp = 6;   // 一下喷火打不爆，要靠第一个桶的爆炸
  st.props.push(b1, b2);
  c.runSkill("berniel_spit");
  assert.ok(!st.props.includes(b1));
  assert.ok(!st.props.includes(b2), "第一个桶的爆炸（火焰）连锁炸掉第二个");
});

test("范围攻击波及配置物：别的区、按属性打不动的配置物不受影响；一次攻击同一个桶只挨一下", () => {
  const { c, st } = bernielField(1);
  const far = c.makeProp("boom", 1, 1); far.zone = 2;
  const big = c.makeProp("boom", 1, 1); big.hp = 10;
  st.props.push(far, big);
  c.runSkill("berniel_spit");
  assert.equal(far.hp, 3, "2 区的桶没事");
  assert.equal(big.hp, 7, "同区的桶只挨一下火焰（−3），不按敌人数量重复");
});

/* ---------- 屏障（铁壁 / 废铁墙）挡范围攻击 ---------- */
function boomcarField() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], seed: "WALL", enemies: [{ id: "boomcar", lv: 1, zone: 1 }, { id: "thug_hammer", lv: 1, zone: 2 }] });
  c.startCombat();
  const st = c.S.state;
  st.units.forEach(u => { if (u.isPlayer) u.zone = 1; });
  return { c, st, k: id => c.findKit(id, st.units) };
}

test("铁壁保护时，敌人的范围攻击一个玩家都打不到，只对铁壁造成一次伤害", () => {
  const { c, st, k } = boomcarField();
  const wall = c.makeProp("ironwall", 1, 1); wall.hp = wall.maxHp = 200;
  st.props.push(wall);
  const kolt = k("kolt"), helu = k("helu"), car = k("boomcar");
  const before = [kolt, helu].map(u => c.totalHp(u));
  st.combatPhase = "enemy"; car.ap = 1; st.attackerId = car.id; st.targetId = kolt.id;
  c.runSkill("en_boom_fuse");
  [kolt, helu].forEach((u, i) => assert.equal(c.totalHp(u), before[i], u.name + " 被铁壁护住"));
  assert.ok(wall.hp < 200, "铁壁挨了一下");
  const once = 200 - wall.hp;
  assert.ok(once > 0 && once < 40, "只挨一次（不是每个玩家各一次）：" + once);
});

test("废铁墙同样挡我方范围攻击：柏妮尔喷火打不到墙后的敌人，只打墙一次", () => {
  const { c, st, b } = bernielField(1);
  const thug = st.units.find(u => !u.isPlayer);
  const wall = c.makeProp("scrapwall", 1, 1); wall.hp = wall.maxHp = 100;
  st.props.push(wall);
  const hp = c.totalHp(thug);
  c.runSkill("berniel_spit");
  assert.equal(c.totalHp(thug), hp, "敌人被废铁墙护住");
  assert.ok(wall.hp < 100, "废铁墙挨了一下");
  assert.ok(st.props.includes(wall));
});

test("范围攻击照样打废铁墙：区里没有敌人时墙也会挨打", () => {
  const { c, st } = bernielField(2);
  const wall = c.makeProp("scrapwall", 1, 1); wall.hp = wall.maxHp = 100;
  st.props.push(wall);
  c.runSkill("berniel_spit");
  assert.ok(wall.hp < 100);
});

test("爆炸桶的爆炸（不分敌我的范围伤害）也打不到铁壁后面的玩家", () => {
  const { c, st, k } = boomcarField();
  const wall = c.makeProp("ironwall", 1, 1); wall.hp = wall.maxHp = 200;
  const boom = c.makeProp("boom", 1, 1);
  st.props.push(wall, boom);
  const kolt = k("kolt"), helu = k("helu");
  const before = [kolt, helu].map(u => c.totalHp(u));
  c.hitStructureCore(kolt, "prop:" + boom.id, { dmg: 10, brk: 1, element: "fire" });
  assert.ok(!st.props.includes(boom), "桶炸了");
  [kolt, helu].forEach((u, i) => assert.equal(c.totalHp(u), before[i], u.name + " 被铁壁护住"));
});

test("爆炸桶的爆炸也打不到废铁墙后面的敌人（以前只挡我方的攻击行动）", () => {
  const { c, st } = bernielField(1);
  const thug = st.units.find(u => !u.isPlayer);
  const kolt = st.units.find(u => u.isPlayer);
  const wall = c.makeProp("scrapwall", 1, 1); wall.hp = wall.maxHp = 100;
  const boom = c.makeProp("boom", 1, 1);
  st.props.push(wall, boom);
  const hp = c.totalHp(thug);
  c.hitStructureCore(kolt, "prop:" + boom.id, { dmg: 10, brk: 1, element: "fire" });
  assert.ok(!st.props.includes(boom));
  assert.equal(c.totalHp(thug), hp, "敌人被废铁墙护住");
  assert.ok(wall.hp < 100, "废铁墙替它挨了爆炸");
});

/* ---------- 防护罩（生存职责）也是盾牌类配置物 ---------- */
test("防护罩：技能放出的是屏障配置物（护盾生命 atk + 10），不再是一个单位", () => {
  const { c, st, k } = boomcarField();
  const kolt = k("kolt");
  kolt.ap = 2; st.attackerId = kolt.id; st.targetId = null;
  c.runSkill("role_dome");
  const dome = st.props.find(p => p.kind === "dome");
  assert.ok(dome, "场上有防护罩配置物");
  assert.equal(dome.zone, kolt.zone);
  assert.equal(dome.layerType, "shield");
  assert.ok(dome.hp >= 10);
  assert.ok(!st.units.some(u => u.name === "防护罩"), "不再生成防护罩单位");
});

test("防护罩保护时，范围攻击一个玩家都打不到，只对罩造成一次伤害", () => {
  const { c, st, k } = boomcarField();
  const dome = c.makeProp("dome", 1, 1); dome.hp = dome.maxHp = 200;
  st.props.push(dome);
  const kolt = k("kolt"), helu = k("helu"), car = k("boomcar");
  const before = [kolt, helu].map(u => c.totalHp(u));
  st.combatPhase = "enemy"; car.ap = 1; st.attackerId = car.id; st.targetId = kolt.id;
  c.runSkill("en_boom_fuse");
  [kolt, helu].forEach((u, i) => assert.equal(c.totalHp(u), before[i], u.name + " 被防护罩护住"));
  const once = 200 - dome.hp;
  assert.ok(once > 0 && once < 40, "只挨一次：" + once);
});

test("防护罩被打破只移出战场，不会让川川受击破；玩家不能把自己的罩当目标", () => {
  const { c, st, k } = boomcarField();
  const kolt = k("kolt");
  const dome = c.makeProp("dome", 1, 1); dome.hp = dome.maxHp = 1;
  st.props.push(dome);
  const notes = c.breakIronWall(dome, []);
  assert.ok(!st.props.includes(dome));
  assert.ok(!notes.some(s => /川川/.test(s)));
  st.props.push(c.makeProp("dome", 1, 1));
  assert.ok(!c.structureTargets(kolt, 0, 1).some(t => /dome|防护罩/.test(t.name)));
});
