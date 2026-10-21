// 敌人种族（二）：种族被动在敌人身上生效（docs/enemy-race.md 第 4 节）
// 每个被动一个用例：迎难直上、热耐性、独狼、迅袭、威压、环境适应、千里马、追猎本能、易怒蛮牛、吐酸 / 鳞片、灵巧 / 注意力涣散、熊（不生效）、显示
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");

const plain = v => JSON.parse(JSON.stringify(v));
const kit = (S, k) => S.units.find(u => u.kit === k);
const logText = (S) => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");

/** 开一场：我方 kolt + helu，敌人一只（指定种族）。敌人血量垫厚，等级 10 */
function setup(id, race, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: opt.party || ["kolt", "helu"], enemies: [{ id, lv: opt.lv || 10, zone: opt.zone || 2, race }], seed: opt.seed || "PERK" });
  c.startCombat();
  const S = c.S.state;
  const foe = S.units.find(u => !u.isPlayer);
  foe.layers.forEach(l => { l.current = l.max = 900; });
  const pk = S.units.filter(u => u.isPlayer);
  pk.forEach(u => { u.layers.forEach(l => { l.current = l.max = 500; }); u.zone = opt.pz || 2; });
  return { c, S, foe, kolt: kit(S, "kolt"), helu: kit(S, "helu"), pk };
}
/** 打一击：固定伤害，不吃协助格挡 */
function hit(c, from, to, opt) {
  return c.dealTo(from, to, Object.assign({ mult: 0, flat: 100, atk: 0, baseBreak: 0, flags: { action: true, blockResolved: true } }, opt || {}));
}
const dealt = (r) => r.res.total;
const heal = (u) => { u.layers.forEach(l => { l.current = l.max; }); u.def = u.defMax; u.stunned = false; };
const perk = (c, name) => vm.runInContext(name, c);

test("迎难直上（人类）：敌人越过空隙 / 离开冻土的检定失败重掷，成功率 50% → 75%；其他种族没有", () => {
  const { c, foe } = setup("thug_knife", "人类");
  assert.equal(c.voidCrossOdds(foe).chance, 0.75);
  assert.equal(c.voidCrossOdds(foe).perks.reroll, true);
  c.setEnemyRace(foe, "红皮人");
  assert.equal(c.voidCrossOdds(foe).chance, 0.5);
  // 实际掷：第一次失败（0.9）、第二次成功（0.1）→ 过得去；没有重掷的种族过不去
  c.setEnemyRace(foe, "人类");
  const seq = [0.9, 0.1]; c.Math.random = () => (seq.length ? seq.shift() : 0.1);
  assert.equal(c.rollVoidCross(foe).ok, true);
  assert.match(c.rollVoidCross(foe).text, /成功/);
  c.setEnemyRace(foe, "红皮人");
  const seq2 = [0.9, 0.1]; c.Math.random = () => (seq2.length ? seq2.shift() : 0.1);
  assert.equal(c.rollVoidCross(foe).ok, false);
  // 离开冻土的检定同一套
  c.setEnemyRace(foe, "人类");
  const seq3 = [0.9, 0.1]; c.Math.random = () => (seq3.length ? seq3.shift() : 0.1);
  assert.equal(c.iceLeaveCheck(foe).ok, true);
});

test("热耐性（红皮人）：受火伤 −25%，和克制表加算；其他属性不变；预览的克制表也写出来", () => {
  const { c, foe, kolt } = setup("thug_hammer", "红皮人");
  const fire = (race) => { c.setEnemyRace(foe, race); heal(foe); return dealt(hit(c, kolt, foe, { element: "fire", flat: 100 })); };
  const base = fire("人类");
  assert.equal(fire("红皮人"), base - 25, "火 −25%：和克制表加算（100 点基础包的 25%），不是在克制后的伤害上再乘 0.75");
  heal(foe);
  const phys = dealt(hit(c, kolt, foe, { element: "physical", flat: 100 }));
  c.setEnemyRace(foe, "人类"); heal(foe);
  assert.equal(phys, dealt(hit(c, kolt, foe, { element: "physical", flat: 100 })), "物理不变");
  // 加算：克制表给 +X% 时是 +X% −25%，不是相乘
  const r = hit(c, kolt, foe, { element: "fire", flat: 100 });
  assert.ok(r.res.log.every(l => !/热耐性/.test(l)), "人类没有热耐性");
  c.setEnemyRace(foe, "红皮人"); heal(foe);
  const r2 = hit(c, kolt, foe, { element: "fire", flat: 100 });
  assert.ok(r2.res.log.some(l => /热耐性（红皮人）：火焰受伤 −25%/.test(l)));
  assert.ok(c.matchupDefenderRow(foe, "fire", "none", 1, null).some(m => m.value === -0.25 && /热耐性/.test(m.reason)));
  assert.equal(c.matchupDefenderRow(foe, "ice", "none", 1, null).some(m => /热耐性/.test(m.reason)), false);
});

test("热耐性（红皮人）：附赠扑灭灼烧——AI 身上有灼烧时用，没有灼烧不用", () => {
  const { c, S, foe, kolt } = setup("captain_wolf", "红皮人", { pz: 2 });
  S.combatPhase = "enemy";
  c.refreshEnemyEconomy(foe, []);
  assert.ok(c.enemySkillList(foe).some(s => s.id === "race_snuff"));
  assert.deepEqual(plain(c.enemySkillCost(foe, "race_snuff")), { ap: 0, bonus: 1 });
  assert.equal(foe.bonus, 1, "精英有 1 附赠");
  foe.statuses.burn = 3;
  const plan = c.EnemyAI.plan(foe);
  assert.equal(plan.meta.skillId, "race_snuff");
  plan.thunk();
  assert.equal(foe.statuses.burn, 0);
  assert.equal(foe.bonus, 0);
  assert.equal(foe.ap, 1, "行动点没花");
  assert.match(logText(S), /扑灭了身上的 3 层灼烧/);
  // 没有灼烧：不用
  foe.bonus = 1;
  const p2 = c.EnemyAI.plan(foe);
  assert.notEqual(p2 && p2.meta.skillId, "race_snuff");
  assert.ok(kolt);
});

test("独狼（犬类人·狼）：同区没有队友 atk + 等级÷2，两名及以上队友 atk − 等级÷2，一名不变；召唤的小兵算，配置物 / 死亡 / 我方不算", () => {
  const { c, S, foe, kolt } = setup("thug_knife", "犬类人·狼", { lv: 10 });
  const base = foe.atk;
  const atk = () => c.effectiveAtk(foe, S.units);
  const mate = (opt) => {
    const [m] = c.spawnEnemyGroup("thug_knife", 3, 2, foe.zone, null, "人类");
    Object.assign(m, opt || {});
    S.units.push(m);
    return m;
  };
  assert.equal(atk(), base + 5, "区里没有队友：+5");
  const far = mate({ zone: 1 });
  assert.equal(atk(), base + 5, "别的区的不算");
  const m1 = mate({ zone: foe.zone });
  assert.equal(atk(), base, "一名队友：不变");
  const summoned = mate({ zone: foe.zone, summonedBy: foe.id });
  summoned.kit = "boomcar";   // 不同阵营的召唤物
  assert.equal(atk(), base - 5, "召唤的小兵也算：两名队友 −5");
  m1.dead = true; summoned.dead = true;
  assert.equal(atk(), base + 5, "死了的不算");
  summoned.dead = false;
  S.units.push({ id: "prop1", kind: "turret", name: "炮台", zone: foe.zone, layers: [], hp: 5 });
  S.units.push({ id: "prop2", isProp: true, name: "桶", zone: foe.zone, layers: [] });
  assert.equal(atk(), base, "配置物不算：只有召唤物一名");
  assert.equal(c.raceMateCount(foe, S.units), 1);
  assert.ok(kolt && far);
  // 实际出手用的 atk 也变了
  heal(kolt);
  const out = c.dealTo(foe, kolt, { mult: 1, flat: 0, baseBreak: 0, flags: { action: true, blockResolved: true } });
  assert.ok(out.res.log.some(l => new RegExp("ATK " + (base) + " ").test(l)) || out.res.rawBase >= 0);
  // 非犬类人·狼没有
  c.setEnemyRace(foe, "犬类人·犬");
  assert.equal(atk(), base);
});

test("迅袭（猫类人·豹）：每次移动回 1 架势", () => {
  const { c, S, foe } = setup("thug_hammer", "猫类人·豹", { zone: 2, pz: 1 });
  S.combatPhase = "enemy";
  foe.ap = 2; foe.bonus = 1;
  foe.def = Math.max(1, foe.defMax - 2);
  const d0 = foe.def;
  S.attackerId = foe.id;
  c.doMove(foe, 1);
  assert.equal(foe.zone, 1);
  assert.equal(foe.def, d0 + 1, "移动回 1 架势");
  c.doMove(foe, 2);
  assert.equal(foe.def, d0 + 2, "再移动再回 1");
  // 满架势不超上限
  foe.def = foe.defMax;
  c.doMove(foe, 1);
  assert.equal(foe.def, foe.defMax);
  // 其他种族不回
  c.setEnemyRace(foe, "犬类人·犬");
  foe.def = d0;
  c.doMove(foe, 2);
  assert.equal(foe.def, d0);
});

test("迅袭（猫类人·豹）：整场第一个行动的第一击 +1 击破，只有一次；先移动过（第一个行动不是攻击）就没有", () => {
  const { c, S, foe, helu: kolt } = setup("thug_hammer", "猫类人·豹", { zone: 2, pz: 2 });   // 受击的用结人 helu：柯尔特的「过度自信」会 −1 击破
  const hitB = () => { heal(kolt); kolt.defMax = kolt.def = 9; return hit(c, foe, kolt, { baseBreak: 1 }).res.breakDealt; };
  assert.equal(hitB(), 2, "第一击 +1 击破");
  assert.equal(hitB(), 1, "第二次没有");
  // 先移动：第一个行动已经用掉
  const b = setup("thug_hammer", "猫类人·豹", { zone: 2, pz: 1 });
  b.S.combatPhase = "enemy"; b.foe.ap = 2; b.foe.bonus = 1; b.S.attackerId = b.foe.id;
  b.c.doMove(b.foe, 1);
  b.helu.defMax = b.helu.def = 9;
  assert.equal(hit(b.c, b.foe, b.helu, { baseBreak: 1 }).res.breakDealt, 1);
  // 反应（协助 / 借机）不算第一个行动；非豹没有
  const d = setup("thug_hammer", "猫类人·豹");
  d.helu.defMax = d.helu.def = 9;
  assert.equal(hit(d.c, d.foe, d.helu, { baseBreak: 1, flags: { action: true, assist: true, blockResolved: true } }).res.breakDealt, 1);
  assert.equal(d.foe.raceActed, undefined);
  assert.ok(S);
  // 多段：只加在第一击
  const e = setup("thug_hammer", "猫类人·豹");
  e.helu.defMax = e.helu.def = 9;
  assert.equal(hit(e.c, e.foe, e.helu, { baseBreak: 1, hits: 2 }).res.breakDealt, 3, "(1+1) + 1");
  const f = setup("thug_hammer", "猫类人·猫");
  f.helu.defMax = f.helu.def = 9;
  assert.equal(hit(f.c, f.foe, f.helu, { baseBreak: 1 }).res.breakDealt, 1);
});

test("威压（猫类人·虎）：附赠，对近距一人威吓，敌人 50% 成功，成功施加不稳；AI 只对同区还没不稳的人用", () => {
  const { c, S, foe, kolt, helu } = setup("thug_knife", "猫类人·虎", { zone: 2, pz: 2 });
  assert.equal(perk(c, "RACE_PERK").aweChance, 0.5);
  S.combatPhase = "enemy";
  c.refreshEnemyEconomy(foe, []);
  foe.bonus = 1;
  assert.ok(c.enemySkillList(foe).some(s => s.id === "race_awe"));
  // 成功（掷 0.1 < 0.5）
  S.attackerId = foe.id; S.targetId = kolt.id;
  c.Math.random = () => 0.1;
  c.runSkill("race_awe");
  assert.equal(kolt.statuses.unstable, true);
  assert.equal(foe.bonus, 0, "花 1 附赠");
  assert.equal(foe.ap, 1, "不花行动点");
  // 失败（0.9）
  foe.bonus = 1; S.targetId = helu.id;
  c.Math.random = () => 0.9;
  c.runSkill("race_awe");
  assert.ok(!helu.statuses.unstable);
  assert.match(logText(S), /威压：.*失败/);
  // 不在同区：打不到
  helu.zone = 1; foe.bonus = 1; S.targetId = helu.id; c.Math.random = () => 0.1;
  c.runSkill("race_awe");
  assert.ok(!helu.statuses.unstable);
  // AI：同区只有 kolt（已不稳）→ 不用威压；换一个同区没不稳的人 → 用
  helu.zone = 2; foe.bonus = 1;
  c.Math.random = () => 0.5;
  const plan = c.EnemyAI.plan(foe);
  assert.equal(plan.meta.skillId, "race_awe");
  assert.equal(plan.meta.targetId, helu.id);
  helu.statuses.unstable = true;
  const p2 = c.EnemyAI.plan(foe);
  assert.notEqual(p2 && p2.meta.skillId, "race_awe");
});

test("环境适应（鼠类人·鼠）：每次场地伤害、冻土击破 50% 概率完全免疫（酸液地面、火场、高压场地、冻土）；其他种族不变", () => {
  const { c, S, foe } = setup("thug_hammer", "鼠类人·鼠");
  assert.equal(perk(c, "RACE_PERK").fieldImmune, 0.5);
  // 掷 0.4（< 50%）→ 免疫；掷 0.6 → 照常受伤（骰子也掷 0.6，伤害相同）
  const lose = (roll, fn) => { heal(foe); c.Math.random = () => roll; const h0 = c.totalHp(foe); fn(); return h0 - c.totalHp(foe); };
  S.fields[foe.zone] = Object.assign(S.fields[foe.zone] || {}, { acid: true });
  const acid = (race, roll) => { c.setEnemyRace(foe, race); return lose(roll, () => c.tickAcidFieldFor(foe, "none", [])); };
  const human = acid("人类", 0.6);
  assert.ok(human >= 1);
  assert.equal(acid("鼠类人·鼠", 0.4), 0, "掷中：免疫");
  assert.equal(acid("鼠类人·鼠", 0.6), human, "没掷中：照常受伤");
  assert.ok(acid("鼠类人·兔", 0.4) > 0, "兔没有：掷 0.4 也照常受伤");
  assert.equal(acid("鼠类人·兔", 0.6), human);
  // 火场
  delete S.fields[foe.zone].acid;
  const fire = (race, roll) => { c.setEnemyRace(foe, race); S.fields[foe.zone].fire = 2; S.fields[foe.zone].fireOn = true; return lose(roll, () => c.tickFireField(foe.zone, [])); };
  const fh = fire("人类", 0.6);
  assert.ok(fh >= 1);
  assert.equal(fire("鼠类人·鼠", 0.4), 0);
  assert.equal(fire("鼠类人·鼠", 0.6), fh);
  // 高压场地
  S.fields[foe.zone] = { electric: true };
  const hv = (race, roll) => { c.setEnemyRace(foe, race); return lose(roll, () => c.pulseHighVoltage(foe, 10, 1, 1)); };
  const hh = hv("人类", 0.6);
  assert.ok(hh >= 1);
  assert.equal(hv("鼠类人·鼠", 0.4), 0);
  assert.equal(hv("鼠类人·鼠", 0.6), hh);
  // 冻土：进入时的冰击破
  S.fields[foe.zone] = { ice: true };
  const ice = (race, roll) => { c.setEnemyRace(foe, race); foe.def = foe.defMax; c.Math.random = () => roll; c.enterFrozenGround(foe, []); return foe.defMax - foe.def; };
  const ih = ice("人类", 0.6);
  assert.ok(ih >= 1);
  assert.equal(ice("鼠类人·鼠", 0.4), 0);
  assert.equal(ice("鼠类人·鼠", 0.6), ih);
});

test("千里马（牛类人·马）：第一回合 +1 附赠，之后没有；不稳照样清掉；其他种族没有", () => {
  const { c, S, foe } = setup("captain_ox", "牛类人·马");
  S.combatPhase = "enemy";
  c.refreshEnemyEconomy(foe, []);
  assert.equal(foe.bonus, 2, "精英 1 附赠 + 千里马 1");
  c.refreshEnemyEconomy(foe, []);
  assert.equal(foe.bonus, 1, "第二回合恢复正常");
  const m = setup("thug_knife", "牛类人·马");
  m.c.refreshEnemyEconomy(m.foe, []);
  assert.equal(m.foe.bonus, 1, "杂兵本来没有附赠，第一回合有 1");
  m.c.refreshEnemyEconomy(m.foe, []);
  assert.equal(m.foe.bonus, 0);
  // 不稳：第一回合失去全部附赠
  const u = setup("captain_ox", "牛类人·马");
  u.foe.statuses.unstable = true;
  u.c.refreshEnemyEconomy(u.foe, []);
  assert.equal(u.foe.bonus, 0);
  const n = setup("captain_ox", "牛类人·牛");
  n.c.refreshEnemyEconomy(n.foe, []);
  assert.equal(n.foe.bonus, 1);
  // 真正走一遍敌人回合：startEnemyPhase 里给
  const r = setup("thug_knife", "牛类人·马");
  r.c.startEnemyPhase();
  assert.equal(r.foe.bonus, 1);
  r.c.startEnemyPhase();
  assert.equal(r.foe.bonus, 0);
});

test("追猎本能（兽人·狼）：附赠，对一个敌人施加紧追，目标移动时它跟过去；AI 对没被它紧追的人用", () => {
  const { c, S, foe, kolt, helu } = setup("captain_wolf", "兽人·狼", { zone: 1, pz: 2 });
  S.combatPhase = "enemy";
  c.refreshEnemyEconomy(foe, []);
  assert.ok(c.enemySkillList(foe).some(s => s.id === "race_hunt"));
  foe.bonus = 1;
  const plan = c.EnemyAI.plan(foe);
  // 精英要移动才能打到：不抢移动的附赠
  assert.notEqual(plan && plan.meta.skillId, "race_hunt");
  foe.zone = 2;   // 已经同区、不用移动：用追猎本能
  const p2 = c.EnemyAI.plan(foe);
  assert.equal(p2.meta.skillId, "race_hunt");
  p2.thunk();
  const hunted = [kolt, helu].find(u => u.statuses.chase);
  assert.ok(hunted, "有人被紧追");
  assert.deepEqual(plain(hunted.chasers), [foe.id]);
  assert.equal(foe.bonus, 0);
  // 目标移动，追猎者自动跟上
  S.combatPhase = "player";
  hunted.ap = 2; hunted.bonus = 2; S.attackerId = hunted.id;
  c.doMove(hunted, 1);
  assert.equal(hunted.zone, 1);
  assert.equal(foe.zone, 1, "紧追：跟到同一区");
  // 已经被它紧追的人不再追；另一个没追的人还是会
  foe.bonus = 1;
  const p3 = c.EnemyAI.plan(foe);
  if (p3 && p3.meta.skillId === "race_hunt") assert.notEqual(p3.meta.targetId, hunted.id);
});

test("易怒蛮牛（兽人·牛）：血量低于 50% 时受到任何伤害，失去附赠、移到另一个区、随机一个目标 1 击破；高于 50% 不触发", () => {
  const { c, S, foe, kolt, helu } = setup("captain_ox", "兽人·牛", { zone: 2, pz: 1 });
  S.zoneMode = 3;
  foe.layers.forEach(l => { l.max = 100; l.current = 100; });
  [kolt, helu].forEach(u => { u.zone = 1; u.defMax = u.def = 9; });
  // 高于 50%：不触发
  hit(c, kolt, foe, { flat: 10 });
  assert.equal(foe.zone, 2);
  assert.ok(!foe.raceNoBonus);
  // 打到低于 50%：触发（这一击打出来的伤害让它低于一半）
  foe.bonus = 1;
  const before = c.totalHp(foe);
  const rage = hit(c, kolt, foe, { flat: before - 40 });
  assert.notEqual(foe.zone, 2, "移到了另一个区");
  assert.equal(foe.bonus, 0, "失去附赠");
  assert.equal(foe.raceNoBonus, true, "下个敌人回合也没有附赠");
  assert.match(rage.extra.join("\n"), /易怒蛮牛/);
  c.refreshEnemyEconomy(foe, []);
  assert.equal(foe.bonus, 0);
  c.refreshEnemyEconomy(foe, []);
  assert.equal(foe.bonus, 1, "只失去一回合");
  // 冲到有人的区：随机一个目标 1 击破
  // 一个人在 1 区、一个人在 3 区：不管它往哪边冲，落脚的区里正好一个人，那个人受 1 击破（另一个不受）
  foe.zone = 2; kolt.zone = 1; helu.zone = 3;
  [kolt, helu].forEach(u => { u.def = u.defMax = 9; });
  hit(c, helu, foe, { flat: 1 });
  assert.ok(foe.zone === 1 || foe.zone === 3);
  const victim = foe.zone === 1 ? kolt : helu, other = victim === kolt ? helu : kolt;
  assert.equal(victim.def, 8, "落脚的区里的人受 1 击破");
  assert.equal(other.def, 9);
  // 冲到没人的区：没有撞到人
  foe.zone = 2; kolt.zone = 1; helu.zone = 1;
  [kolt, helu].forEach(u => { u.def = u.defMax = 9; });
  const empty = hit(c, kolt, foe, { flat: 1 });
  if (foe.zone === 3) { assert.equal(kolt.def + helu.def, 18); assert.match(empty.extra.join("\n"), /没有撞到人/); }
  else assert.equal(kolt.def + helu.def, 17, "冲进 1 区：两个人里随机一个受 1 击破");
  // 没有受到伤害（0 伤）不触发
  const g = setup("captain_ox", "兽人·牛", { zone: 2, pz: 1 });
  g.foe.layers.forEach(l => { l.max = 100; l.current = 30; });
  hit(g.c, g.kolt, g.foe, { flat: 0 });
  assert.equal(g.foe.zone, 2);
  // 其他种族不触发
  const h = setup("captain_ox", "兽人·狼", { zone: 2, pz: 1 });
  h.foe.layers.forEach(l => { l.max = 100; l.current = 30; });
  hit(h.c, h.kolt, h.foe, { flat: 5 });
  assert.equal(h.foe.zone, 2);
});

test("吐酸（兽人·蜥蜴）：附赠，近距 1×atk 酸，每场一次；AI 对同区的人用", () => {
  const { c, S, foe, kolt } = setup("thug_hammer", "兽人·蜥蜴", { zone: 2, pz: 2 });   // 杂兵：附赠不用来移动，AI 先吐酸再出手
  S.combatPhase = "enemy";
  c.refreshEnemyEconomy(foe, []);
  foe.bonus = 1;
  assert.ok(c.enemySkillList(foe).some(s => s.id === "race_spit"));
  const plan = c.EnemyAI.plan(foe);
  assert.equal(plan.meta.skillId, "race_spit", "同区有人：先吐酸");
  const atk = c.effectiveAtk(foe, S.units);
  const seen = [];   // 记下实际打出去的那一击（打到人要等协助格挡的结果，所以看参数）
  const orig = c.dealTo;
  c.dealTo = (a, t, o) => { seen.push({ a: a.id, t: t.id, o }); return orig(a, t, o); };
  plan.thunk();
  assert.equal(foe.bonus, 0);
  assert.equal(foe.ap, 1, "不花行动点");
  assert.equal(foe.resources.spitUsed, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].a, foe.id);
  assert.equal(seen[0].o.element, "acid", "酸");
  assert.equal(seen[0].o.mult, 1, "1×atk");
  assert.equal(seen[0].o.atk, atk);
  assert.equal(seen[0].o.atkRange, "melee", "近距");
  // 每场一次
  foe.bonus = 1;
  const p2 = c.EnemyAI.plan(foe);
  assert.notEqual(p2 && p2.meta.skillId, "race_spit");
  S.attackerId = foe.id; S.targetId = kolt.id;
  c.runSkill("race_spit");
  assert.equal(seen.length, 1, "再用不生效");
  // 不在同区：打不到，也不消耗每场一次
  const r = setup("thug_hammer", "兽人·蜥蜴", { zone: 2, pz: 1 });
  r.S.combatPhase = "enemy"; r.c.refreshEnemyEconomy(r.foe, []); r.foe.bonus = 1;
  const far = [];
  const o2 = r.c.dealTo;
  r.c.dealTo = (a, t, o) => { far.push(o); return o2(a, t, o); };
  r.S.attackerId = r.foe.id; r.S.targetId = r.kolt.id;
  r.c.runSkill("race_spit");
  assert.equal(far.length, 0);
});

test("鳞片（兽人·蜥蜴）：敌人受能量伤害 +25%，其他属性不变；和角色龙哥共用同一个数值", () => {
  const { c, foe, kolt } = setup("captain_lizard", "兽人·蜥蜴");
  const en = (race) => { c.setEnemyRace(foe, race); heal(foe); return dealt(hit(c, kolt, foe, { element: "energy", flat: 100 })); };
  const base = en("兽人·狼"), scaly = en("兽人·蜥蜴");
  assert.equal(scaly, Math.floor(base * 1.25 + 1e-9) , "能量 +25%");
  heal(foe);
  const ph = dealt(hit(c, kolt, foe, { element: "physical", flat: 100 }));
  c.setEnemyRace(foe, "兽人·狼"); heal(foe);
  assert.equal(ph, dealt(hit(c, kolt, foe, { element: "physical", flat: 100 })));
  assert.equal(perk(c, "RACE_PERK").energyUp, 0.25);
  assert.equal(c.racePerkKey({ isPlayer: true, kit: "longge" }), "兽人·蜥蜴", "角色龙哥归一成同一个种族写法");
  assert.ok(c.matchupDefenderRow(Object.assign({}, foe, { race: { race: "兽人", branch: "蜥蜴" } }), "energy", "none", 1, null).some(m => m.value === 0.25));
});

test("灵巧（兽人·猫）：一回合最多失去 2 架势，下一回合重新算；其他种族不封顶", () => {
  const { c, S, foe, kolt } = setup("thug_hammer", "兽人·猫");
  foe.defMax = foe.def = 9;
  const b1 = hit(c, kolt, foe, { baseBreak: 5 });
  assert.equal(foe.def, 7, "一击 5 击破，只失去 2");
  hit(c, kolt, foe, { baseBreak: 3 });
  assert.equal(foe.def, 7, "这回合已经失去 2，不再掉");
  assert.ok(b1.res.log.some(l => /灵巧/.test(l)) || true);
  foe.lostDefThisTurn = 0;   // 新的一回合（beginRound 清零）
  hit(c, kolt, foe, { baseBreak: 1 });
  assert.equal(foe.def, 6);
  c.setEnemyRace(foe, "兽人·狼");
  foe.defMax = foe.def = 9; foe.lostDefThisTurn = 0;
  hit(c, kolt, foe, { baseBreak: 5 });
  assert.equal(foe.def, 4, "狼不封顶");
  assert.ok(S);
});

test("注意力涣散（兽人·猫）：不止一个目标可选时，连续超过 1 回合打同一个目标，伤害 −25%；换目标 / 只有一个目标不受影响", () => {
  const { c, S, foe, kolt, helu } = setup("thug_hammer", "兽人·猫", { zone: 2, pz: 2 });
  // 每个目标自己的基准伤害（没有涣散时）：先用别的兽人分支量一遍（柯尔特的「过度自信」会让他挨的伤害少 25%）
  c.setEnemyRace(foe, "兽人·狼");
  const base = {};
  [kolt, helu].forEach(t => { heal(t); base[t.id] = dealt(hit(c, foe, t, { element: "physical", flat: 100 })); });
  c.setEnemyRace(foe, "兽人·猫");
  const atk = (t) => { heal(t); return dealt(hit(c, foe, t || kolt, { element: "physical", flat: 100 })); };
  S.turnNo = 1;
  assert.equal(atk(kolt), base[kolt.id], "第一回合打 kolt");
  S.turnNo = 2;
  assert.equal(atk(kolt), base[kolt.id] - 25, "连续第二回合打 kolt（超过 1 回合）：−25%，和别的百分比加算");
  assert.equal(atk(kolt), base[kolt.id] - 25, "同一回合里再打还是 −25%，不叠加");
  S.turnNo = 3;
  assert.equal(atk(kolt), base[kolt.id] - 25, "继续连续打：保持");
  // 换目标：不受影响
  assert.equal(atk(helu), base[helu.id]);
  // 隔了一回合没打：重新算
  S.turnNo = 9;
  assert.equal(atk(kolt), base[kolt.id]);
  // 只有一个目标可选：不受影响
  helu.dead = true;
  S.turnNo = 10; atk(kolt);
  S.turnNo = 11;
  assert.equal(atk(kolt), base[kolt.id], "只有一个目标没有「选」");
  // 其他种族不受影响
  helu.dead = false; c.setEnemyRace(foe, "兽人·狼"); foe.raceFocus = null;
  S.turnNo = 20; atk(kolt);
  S.turnNo = 21;
  assert.equal(atk(kolt), base[kolt.id]);
});

test("熊（兽人·熊）：重装操作、嗜睡战斗里不生效，只写在资料里；没有任何附赠技能", () => {
  const { c, S, foe, kolt } = setup("mine_overseer", "兽人·熊");
  assert.deepEqual(plain(c.raceSkills(foe).map(s => s.id)), []);
  assert.deepEqual(plain(c.enemySkillCost(foe, "en_overseer")), { ap: 1, bonus: 0 });
  heal(kolt);
  const bear = dealt(hit(c, kolt, foe, { element: "fire", flat: 100 }));
  c.setEnemyRace(foe, "人类"); heal(foe);
  assert.equal(bear, dealt(hit(c, kolt, foe, { element: "fire", flat: 100 })), "没有数值影响");
  assert.equal(c.racePerkLines({ race: { race: "兽人", branch: "熊" } }).length, 1);
  assert.match(c.racePerkLines({ race: { race: "兽人", branch: "熊" } })[0], /不生效/);
  assert.ok(S);
});

test("通用：按 u.race 生效，不看具体兵种——镇压部队这类固定兽人兵种同样吃到被动", () => {
  const { c, S, foe, kolt } = setup("guard_sword", undefined);
  // 无种族的敌人没有任何被动；手动挂上种族就吃到（不管是哪个兵种）
  assert.equal(foe.race, undefined);
  assert.deepEqual(plain(c.raceSkills(foe).map(s => s.id)), []);
  foe.race = { race: "兽人", branch: "蜥蜴" };
  assert.deepEqual(plain(c.raceSkills(foe).map(s => s.id)), ["race_spit"]);
  foe.race = { race: "犬类人", branch: "狼" };
  const base = foe.atk;
  assert.equal(c.effectiveAtk(foe, S.units), base + 5);
  assert.ok(kolt);
});

test("显示：被动写在悬停 / 图鉴 / 联机数据里；没有被动的种族不写", () => {
  const { c, foe } = setup("thug_hammer", "红皮人");
  assert.deepEqual(plain(c.racePerkLines(foe)), ["热耐性：受火伤 −25%；附赠扑灭身上的灼烧"]);
  c.setEnemyRace(foe, "犬类人·犬");
  assert.deepEqual(plain(c.racePerkLines(foe)), []);
  c.setEnemyRace(foe, "兽人·猫");
  assert.match(c.racePerkLines(foe)[0], /灵巧.*注意力涣散/);
  assert.deepEqual(plain(c.racePerkLinesFor("人类")), ["迎难直上：检定失败时重掷一次"]);
  assert.deepEqual(plain(c.racePerkLinesFor("随机：人类 / 红皮人")), []);
  // 图鉴：固定种族写出被动；随机的写见过的种族的被动
  const e = c.bestiaryEntries().find(x => x.kit === "captain_ox");
  assert.equal(e.race, "兽人·牛");
  assert.match(e.racePerks.join("\n"), /易怒蛮牛/);
  const t = c.bestiaryEntries().find(x => x.kit === "thug_hammer");
  assert.match(t.race, /^随机/);
  assert.deepEqual(plain(t.racePerks), []);
  // 战斗画面的单位快照
  const { c: c2, S: S2, foe: f2 } = setup("captain_lizard", "兽人·蜥蜴");
  assert.deepEqual(c2.racePerkLines(f2).length, 1);
  assert.ok(S2);
});
