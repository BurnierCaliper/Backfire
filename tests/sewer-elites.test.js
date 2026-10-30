// 下水道维护（二）：两个触灵精英（维护员、清扫员）和「狂鼠 ↔ 下水道维护」的三方混战（docs/sewer-maintenance.md 第 2、4 节，issue #281）
// 阵营和清扫机在 tests/sewer-maintenance.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("./headless");

const get = (c, expr) => vm.runInContext(expr, c);
const plain = x => JSON.parse(JSON.stringify(x));
const noBlock = { pickBlocker: () => null, pickAssister: l => l[0].id };
const layers = (u, ls) => { u.layers = ls.map((l, i) => ({ type: l[0], current: l[1], max: l[2] != null ? l[2] : l[1], inner: i === ls.length - 1 })); };
const ELITES = ["sewer_keeper", "sewer_cleaner"];

/** 一场摆好的战斗（个体值不波动），已开战，我方回合。enemies：[{ id, lv, zone }] */
function field(enemies, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: opt.party || ["kolt", "helu"], enemies, seed: opt.seed || "SEWER-ELITE", zoneMode: opt.zoneMode || 2 });
  c.startCombat();
  const S = c.S.state;
  S.units.forEach(u => { if (u.kit === "kolt") u.prideMaxHp = Infinity; });   // 柯尔特的过度自信（满血减伤）不碍事
  return {
    c, S,
    P: k => c.findKit(k, S.units),
    E: (k, i) => S.units.filter(u => !u.isPlayer && u.kit === k)[i || 0],
    logs: () => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n")
  };
}
/** 敌人 a 对 t 用技能 id（我方不格挡），排队的格挡 / 协助都结算完 */
function use(f, a, id, t, picks) {
  f.S.combatPhase = "enemy"; a.ap = Math.max(1, a.ap || 0); a.bonus = Math.max(1, a.bonus || 0);
  f.S.attackerId = a.id; f.S.targetId = t ? t.id : null;
  if (picks) f.S.skillFlow = { id, actorId: a.id, picks, index: 99 };
  try { f.c.runSkill(id); } finally { f.S.skillFlow = null; }
  f.c.BattleSim.resolveQueues(noBlock);
}
/** 敌人回合，让 AI 走一步（不结算排队的格挡 / 协助） */
function plan(f, u) { f.S.combatPhase = "enemy"; return f.c.EnemyAI.plan(u); }
/** 我方 a 打 t 一下（不格挡）：固定伤害 flat，aoe 为 true 时按范围攻击打 */
function strike(f, a, t, flat, aoe) {
  f.S.combatPhase = "player";
  return f.c.dealTo(a, t, { atk: 0, mult: 0, flat, element: "physical", baseBreak: 1, atkRange: "any",
    flags: Object.assign({ action: true, blockResolved: true, block: "none" }, aoe ? { aoe: true } : {}) });
}
const hp = (c, u) => c.totalHp(u);

/* ================= 数值、登记、种族 ================= */

test("数值：两个精英 1 / 5 / 10 / 15 / 20 级（2 人队）的护盾 / 星灵、架势、ATK 和文档第 2 节的表一致（护盾在外、星灵在内）；图鉴显示的一样", () => {
  const c = H.load();
  get(c, "ENEMY_IV.off++");   // 个体值不波动
  const mult = get(c, "BOSS_POSTURE_MULT"), eliteMin = get(c, "ELITE_RULE_MIN_LEVEL");
  // [护盾, 星灵, 架势（文档的数；10 级起的精英照现有规则再 ×0.6）, ATK]
  const TABLE = { 1: [12, 14, 4, 7], 5: [42, 22, 4, 11], 10: [82, 32, 4, 16], 15: [117, 42, 4, 21], 20: [157, 52, 4, 26] };
  const names = { sewer_keeper: "触灵维护员", sewer_cleaner: "触灵清扫员" };
  ELITES.forEach(kit => Object.keys(TABLE).forEach(lvs => {
    const lv = Number(lvs), [sh, sp, def, atk] = TABLE[lvs];
    const u = c.spawnEnemyGroup(kit, lv, 2, 2)[0];
    const tag = `${kit} ${lv} 级`;
    assert.equal(u.name, names[kit]);
    assert.deepEqual(plain(u.layers.map(l => [l.type, l.max])), [["shield", sh], ["spirit", sp]], tag + "：护盾在外、星灵在内");
    assert.equal(u.defMax, lv >= eliteMin ? Math.round(def * mult) : def, tag + " 架势");
    assert.equal(u.atk, atk, tag + " ATK");
    const st = c.bestiaryStats(kit, lv, 2);
    assert.deepEqual([plain(st.layers.map(l => [l.type, l.hp])), st.def, st.atk], [[["shield", sh], ["spirit", sp]], u.defMax, atk], tag + " 图鉴");
  }));
});

test("数值：照警卫队队长（蜥蜴）换算——护盾同蜥蜴、肉体层换成同样多的星灵，架势 / ATK 同蜥蜴（1–25 级 × 2 / 3 / 4 人队）；远程；数值在配置表里", () => {
  const c = H.load();
  const build = (id, lv, p) => c.enemyPresets().find(x => x.id === id).build(lv, p);
  for (let lv = 1; lv <= 25; lv++) for (const p of [2, 3, 4]) {
    const liz = build("captain_lizard", lv, p), tag = `${lv} 级 ${p} 人队`;
    ELITES.forEach(kit => {
      const u = build(kit, lv, p);
      assert.deepEqual(plain(u.layers.map(l => l.max)), plain(liz.layers.map(l => l.max)), `${kit} ${tag}：血量同蜥蜴`);
      assert.deepEqual(plain(u.layers.map(l => l.type)), ["shield", "spirit"], `${kit} ${tag}：肉体换成星灵`);
      assert.equal(u.layers[0].max, c.scaleHp(12 + 5 * (lv - 1) + 5 * Math.floor(lv / 2), p), tag);
      assert.equal(u.layers[1].max, c.scaleHp(14 + 2 * (lv - 1), p), tag);
      assert.deepEqual([u.defMax, u.atk], [liz.defMax, liz.atk], `${kit} ${tag}：架势 / ATK 同蜥蜴`);
      assert.equal(u.atk, 7 + (lv - 1), tag);
      assert.equal(u.range, "ranged");
    });
  }
  assert.deepEqual(plain(build("sewer_keeper", 3, 2).suggest), { element: "electric", dice: [1, 4], flat: 0, baseBreak: 1 });
  assert.equal(build("sewer_cleaner", 3, 2).suggest.element, "harmonic");
  assert.deepEqual(plain(get(c, "SEWER_STATS").elite), { shield: [12, 5], shieldPer2: 5, spirit: [14, 2], def: 4, atk: 7, dice: 4 });
  const C = plain(get(c, "SEWER_CFG"));
  assert.deepEqual([C.keeper, C.cleaner, C.guard], [{ shotMult: 1, shotBreak: 1 }, { waveMult: 0.5, waveBreak: 1 }, { protect: ELITES, boomBelow: 0.25 }]);
});

test("登记 / 种族：精英、2 枚代币、阵营照旧是「下水道维护」、只出没在下水道；种族「触灵」（不套六维、没有种族被动），和机甲触灵、飞碟触灵分在一类；不是机械", () => {
  const c = H.load();
  get(c, "ENEMY_IV.off++");
  const info = get(c, "ENEMY_INFO"), rank = get(c, "ENEMY_RANK");
  ELITES.forEach(k => {
    assert.deepEqual([info[k].faction, info[k].regions.join(), info[k].tokens, info[k].race, rank[k]], ["下水道维护", "下水道", 2, "触灵", "elite"], k);
    const u = c.spawnEnemyGroup(k, 6, 2, 2)[0];
    assert.equal(c.raceText(u), "触灵");
    assert.deepEqual(plain(c.racePerkLines(u)), [], "触灵没有种族被动");
    assert.deepEqual(plain(c.raceSkills(u)), []);
    assert.equal(c.factionOf(u), "下水道维护", "阵营不变");
    assert.equal(c.isMechanicalUnit(u), false);
    const raw = c.enemyPresets().find(p => p.id === k).build(6, 2);
    assert.deepEqual(plain(u.layers.map(l => l.max)), plain(raw.layers.map(l => l.max)), "种族不改数值");
  });
  assert.deepEqual(plain(get(c, "ENEMY_RACES")["触灵"]), { mods: {} });
  // 和机甲触灵、飞碟触灵同一类：种族都是「触灵」（阵营还是「触灵」，数值不变）
  ["mecha_mg", "mecha_gl"].forEach(k => {
    const u = c.spawnEnemyGroup(k, 4, 2, 2)[0];
    assert.equal(c.raceText(u), "触灵", k);
    assert.equal(c.factionOf(u), "触灵", k);
    assert.deepEqual(plain(u.layers.map(l => l.max)), plain(c.enemyPresets().find(p => p.id === k).build(4, 2).layers.map(l => l.max)), k);
  });
  assert.equal(info.ufo_boss.race, "触灵");
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "ufo_boss", lv: 3, zone: 2 }], seed: "UFO-RACE" });
  assert.equal(c.raceText(c.S.state.units.find(u => u.kit === "ufo_body")), "触灵", "飞碟触灵本体");
  // 图鉴：种族栏写「触灵」
  const rows = c.bestiaryEntries();
  ["sewer_keeper", "sewer_cleaner", "mecha_mg", "mecha_gl", "ufo_boss"].forEach(k => assert.equal(rows.find(e => e.kit === k).race, "触灵", k));
  ELITES.forEach(k => assert.deepEqual(plain(rows.find(e => e.kit === k).racePerks), [], k));
});

/* ================= 触灵维护员 ================= */

test("维护员：普通攻击远程 1×atk + 1d4 电击、1 击破（同区够不着）", () => {
  const f = field([{ id: "sewer_keeper", lv: 5, zone: 2 }]);
  const ke = f.E("sewer_keeper"), k = f.P("kolt");
  layers(k, [["spirit", 300]]);   // 电击打星灵不加不减
  k.zone = 1;
  use(f, ke, "en_keeper_shot", k);
  const lost = 300 - hp(f.c, k);
  assert.ok(lost >= ke.atk + 1 && lost <= ke.atk + 4, `1×atk + 1d4：${lost}（atk ${ke.atk}）`);
  assert.equal(k.def, k.defMax - 1, "1 击破");
  // AI：隔一区的人用普通攻击打
  f.S.combatPhase = "enemy"; ke.ap = 1; ke.bonus = 0;
  const p = plan(f, ke);
  assert.equal(p.meta.skillId, "en_keeper_shot");
  // 同区够不着
  const h = f.P("helu"); layers(h, [["spirit", 300]]); h.zone = 2;
  use(f, ke, "en_keeper_shot", h);
  assert.equal(hp(f.c, h), 300, "远程：同区打不到");
});

test("清除状态（附赠）：只清负面的一种，振奋 / 坚挺 / 躲藏 / 优势这类好的不清；花附赠；维护员清完获得永续的振奋（回合结束不消失，只有一层）", () => {
  const f = field([{ id: "sewer_keeper", lv: 5, zone: 2 }]);
  const ke = f.E("sewer_keeper");
  Object.assign(ke.statuses, { corr: true, weak: true, sturdy: true, advantage: true });
  f.S.combatPhase = "enemy"; ke.ap = 1; ke.bonus = 1;
  let p = plan(f, ke);
  assert.equal(p.meta.skillId, "en_sewer_cleanse", "身上有负面状态：先花附赠清除");
  p.thunk(); f.c.BattleSim.resolveQueues(noBlock);
  assert.equal(ke.statuses.corr, false, "先清伤害大的腐蚀");
  assert.equal(ke.statuses.weak, true, "一次只清一种");
  assert.deepEqual([ke.statuses.sturdy, ke.statuses.advantage], [true, true], "好的不清");
  assert.deepEqual([ke.bonus, ke.ap], [0, 1], "花附赠，不花行动点");
  assert.deepEqual([ke.statuses.inspire, ke.statuses.inspireStay], [true, true], "永续的振奋");
  assert.match(f.logs(), /触灵维护员 清除了身上的腐蚀/);
  assert.match(f.logs(), /永续的振奋/);
  // 没有附赠了：照常出手（不再清）
  p = plan(f, ke);
  assert.notEqual(p.meta.skillId, "en_sewer_cleanse");
  // 再清一种：振奋还是只有一层
  ke.bonus = 1;
  use(f, ke, "en_sewer_cleanse");
  assert.equal(ke.statuses.weak, false);
  assert.equal(ke.statuses.inspire, true);
  assert.match(f.logs(), /已经有永续的振奋（振奋只有一层）/);
  // 回合结束：永续的振奋不会自动消失
  f.c.endEnemyTurn();
  assert.deepEqual([ke.statuses.inspire, ke.statuses.inspireStay], [true, true]);
  // 只剩好的状态：不清，直接出手
  f.S.combatPhase = "enemy"; ke.ap = 1; ke.bonus = 1;
  assert.equal(f.c.sewerCleansePick(ke), null);
  assert.notEqual(plan(f, ke).meta.skillId, "en_sewer_cleanse");
  ke.statuses.inspire = false; ke.statuses.hide = true;
  assert.equal(f.c.sewerCleansePick(ke), null, "躲藏也是好的");
});

test("清除状态的先后：高能最先 → 灼烧 / 腐蚀 / 感电按这一回合预计扣的血比 → 冻伤 → 震荡 → 不稳 → 虚弱 → 共振 → 紧追；清扫员也会清，但不获得振奋", () => {
  const f = field([{ id: "sewer_keeper", lv: 3, zone: 2 }, { id: "sewer_cleaner", lv: 3, zone: 2 }]);
  const ke = f.E("sewer_keeper"), cl = f.E("sewer_cleaner");
  const pick = st => { ke.statuses = Object.assign({ burn: 0 }, st); return f.c.sewerCleansePick(ke); };
  assert.equal(pick({ high: true, burn: 5, corr: true, frostbite: true }), "high", "高能：血量低于高能值就自爆");
  assert.equal(pick({ burn: 3, corr: true }), "burn", "灼烧 3 层（3d4）比腐蚀（2d4）扣得多");
  assert.equal(pick({ burn: 1, corr: true }), "corr", "灼烧 1 层（1d4）比腐蚀少");
  assert.equal(pick({ corr: true, frostbite: true, shockwave: true }), "corr", "扣血的先清");
  assert.equal(pick({ frostbite: true, shockwave: true, weak: true }), "frostbite");
  assert.equal(pick({ shockwave: true, unstable: true, weak: true, reso: true, chase: true }), "shockwave");
  assert.equal(pick({ unstable: true, weak: true, reso: true, chase: true }), "unstable");
  assert.equal(pick({ weak: true, reso: true, chase: true }), "weak");
  assert.equal(pick({ reso: true, chase: true }), "reso");
  assert.equal(pick({ chase: true }), "chase");
  // 高能值跟着高能一起清掉
  ke.statuses = { burn: 0, high: true }; ke.highEnergy = 9;
  use(f, ke, "en_sewer_cleanse");
  assert.deepEqual([ke.statuses.high, ke.highEnergy], [false, 0]);
  // 清扫员：同样只清负面的，清掉不获得振奋
  Object.assign(cl.statuses, { burn: 2, sturdy: true });
  f.S.combatPhase = "enemy"; cl.ap = 1; cl.bonus = 1;
  const p = plan(f, cl);
  assert.equal(p.meta.skillId, "en_sewer_cleanse");
  p.thunk(); f.c.BattleSim.resolveQueues(noBlock);
  assert.deepEqual([cl.statuses.burn, cl.statuses.sturdy, !!cl.statuses.inspire], [0, true, false]);
  assert.deepEqual(plain(get(f.c, "SEWER_CFG").cleanse.inspireKits), ["sewer_keeper"]);
});

test("维护员协助：和普通攻击一样（远程 1×atk + 1d4 电击、1 击破），打中再施加感电", () => {
  const f = field([{ id: "sewer_keeper", lv: 5, zone: 2 }, { id: "guard_sword", lv: 1, zone: 1 }]);
  const ke = f.E("sewer_keeper"), g = f.E("guard_sword"), k = f.P("kolt");
  layers(k, [["spirit", 300]]); k.zone = 1;
  assert.equal(f.c.enemyAssistSkillId(ke), "en_keeper_assist");
  f.S.combatPhase = "enemy";
  f.c.dealBreak(k, k.def, "physical", [], "测试", { by: g });   // 同伙的安保打出失衡：维护员接协助（看守是打出失衡的人，不能接自己的）
  f.c.BattleSim.resolveQueues(noBlock);
  const lost = 300 - hp(f.c, k);
  assert.ok(lost >= ke.atk + 1 && lost <= ke.atk + 4, `协助 1×atk + 1d4：${lost}`);
  assert.equal(k.statuses.shock, true, "施加感电");
  assert.match(f.logs(), /被施加感电/);
});

/* ================= 触灵清扫员 ================= */

test("清扫员普通攻击：选远程射程内敌人最多的一区，对那一区所有敌人各 0.5×atk 谐波、每人 1 击破；同区 / 隔两区的不打", () => {
  const f = field([{ id: "sewer_cleaner", lv: 6, zone: 2 }, { id: "rat_biter", lv: 1, zone: 3 }], { zoneMode: 3 });
  const cl = f.E("sewer_cleaner"), rat = f.E("rat_biter"), k = f.P("kolt"), h = f.P("helu");
  [k, h, rat].forEach(u => layers(u, [["spirit", 400]]));   // 谐波打星灵不加不减
  k.zone = 1; h.zone = 3;   // 1 区 1 个，3 区 2 个（我方 + 狂鼠，狂鼠也是它的敌人）
  assert.equal(f.c.cleanerWaveZone(cl), 3);
  f.S.combatPhase = "enemy"; cl.ap = 1; cl.bonus = 0;
  const p = plan(f, cl);
  assert.equal(p.meta.skillId, "en_cleaner_wave");
  assert.equal(p.ai.picks.dest, 3, "挑敌人最多的 3 区");
  const defs = [h.def, rat.def];
  p.thunk(); f.c.BattleSim.resolveQueues(noBlock);
  [h, rat].forEach(u => assert.ok(Math.abs((400 - hp(f.c, u)) - cl.atk * 0.5) <= 1, `${u.name} 0.5×atk 谐波（atk ${cl.atk}）：${400 - hp(f.c, u)}`));
  assert.deepEqual([h.def, rat.def], defs.map(d => d - 1), "每人 1 击破");
  assert.equal(hp(f.c, k), 400, "1 区不打");
  // 同区的不算射程内：敌人都在同区就打不到（要先后撤）
  [k, h, rat].forEach(u => { u.zone = 2; });
  assert.equal(f.c.cleanerWaveZone(cl), null);
  // 一样多：挑那一区血量合计多的
  k.zone = 1; h.zone = 3; rat.zone = 2;
  layers(k, [["spirit", 100]]); layers(h, [["spirit", 500]]);
  assert.equal(f.c.cleanerWaveZone(cl), 3);
});

test("操控清扫机：清扫员在场时，维护员 / 清扫员挨打 100% 由同区的清扫机代为承受（挑血量最多的那只）；不同区的清扫机不挡；清扫员不在了就不挡", () => {
  const f = field([{ id: "sewer_keeper", lv: 5, zone: 2 }, { id: "sewer_cleaner", lv: 5, zone: 2 },
    { id: "sewer_sweeper", lv: 5, zone: 2 }, { id: "sewer_sweeper", lv: 5, zone: 2 }, { id: "sewer_sweeper", lv: 5, zone: 1 }]);
  const ke = f.E("sewer_keeper"), cl = f.E("sewer_cleaner"), s1 = f.E("sewer_sweeper", 0), s2 = f.E("sewer_sweeper", 1), s3 = f.E("sewer_sweeper", 2), k = f.P("kolt");
  layers(s1, [["flesh", 300]]); layers(s2, [["flesh", 400]]); layers(s3, [["flesh", 500]]);
  k.zone = 1;
  const ke0 = hp(f.c, ke), cl0 = hp(f.c, cl);
  for (let i = 0; i < 6; i++) strike(f, k, i % 2 ? cl : ke, 5);
  assert.deepEqual([hp(f.c, ke), hp(f.c, cl)], [ke0, cl0], "100%：一下都没打到精英");
  assert.ok(hp(f.c, s2) < 400, "同区血量最多的那只挡");
  assert.equal(hp(f.c, s1) + hp(f.c, s2), 700 - (400 - hp(f.c, s2)) - (300 - hp(f.c, s1)));
  assert.equal(hp(f.c, s3), 500, "不同区的清扫机不挡（虽然血最多）");
  assert.match(f.logs(), /下水道清扫机 挡在 触灵维护员 身前，替它承受这次攻击/);
  // 挡的那只血少下去了：换另一只血多的挡
  layers(s2, [["flesh", 100, 400]]);
  strike(f, k, ke, 5);
  assert.ok(hp(f.c, s1) < 300, "改由 s1 挡");
  // 同区没有清扫机：照常挨打
  s1.zone = 1; s2.zone = 1;
  strike(f, k, ke, 5);
  assert.ok(hp(f.c, ke) < ke0, "同区没有清扫机");
  // 清扫员不在场：不挡
  s1.zone = 2;
  const keNow = hp(f.c, ke);
  cl.dead = true; cl._removed = true;
  strike(f, k, ke, 5);
  assert.ok(hp(f.c, ke) < keNow, "清扫员不在了");
  // 打别的单位（清扫机自己）不挡
  assert.equal(f.c.sweeperGuardFor(k, s1, { flags: { action: true } }), null);
});

test("操控清扫机：范围攻击也会被挡下，每人各挡一次；状态 / 场地这类环境伤害不挡", () => {
  const f = field([{ id: "sewer_keeper", lv: 5, zone: 2 }, { id: "sewer_cleaner", lv: 5, zone: 2 }, { id: "sewer_sweeper", lv: 5, zone: 2 }]);
  const ke = f.E("sewer_keeper"), cl = f.E("sewer_cleaner"), sw = f.E("sewer_sweeper"), k = f.P("kolt");
  layers(sw, [["flesh", 900]]);
  k.zone = 1;
  const ke0 = hp(f.c, ke), cl0 = hp(f.c, cl);
  // 一次范围攻击打到 2 区的三个人：清扫机自己挨一下，维护员、清扫员各被挡一次 → 清扫机一共挨三下
  const flat = 6;
  strike(f, k, sw, flat, true);
  const one = 900 - hp(f.c, sw);
  assert.ok(one > 0);
  [ke, cl].forEach(u => strike(f, k, u, flat, true));
  assert.deepEqual([hp(f.c, ke), hp(f.c, cl)], [ke0, cl0], "范围攻击也挡");
  assert.equal(900 - hp(f.c, sw), 3 * one, "清扫机挨了三下");
  assert.equal((f.logs().match(/挡在/g) || []).length, 2, "每人各挡一次");
  // 环境伤害（灼烧这类）不挡
  const out = f.c.dealTo(k, ke, { atk: 0, mult: 0, flat: 5, element: "fire", baseBreak: 0, flags: { action: false, environment: true, blockResolved: true } });
  assert.ok(out && hp(f.c, ke) < ke0, "环境伤害照常打到精英");
});

test("操控清扫机：代挡后那只清扫机剩下的血量 < 25% 但还没死，立刻自爆——冲到打它的人所在的区炸那一区；没降到 25% 以下 / 被打死的不炸", () => {
  const f = field([{ id: "sewer_keeper", lv: 5, zone: 2 }, { id: "sewer_cleaner", lv: 5, zone: 2 }, { id: "sewer_sweeper", lv: 5, zone: 2 }, { id: "sewer_sweeper", lv: 5, zone: 2 }]);
  const ke = f.E("sewer_keeper"), s1 = f.E("sewer_sweeper", 0), s2 = f.E("sewer_sweeper", 1), k = f.P("kolt"), h = f.P("helu");
  [k, h].forEach(u => layers(u, [["shield", 500]]));   // 火打护盾不加不减
  k.zone = 1; h.zone = 1;
  // s1：40 上限还剩 39（挡的是它），挨一下 4 点左右，剩下的还在 25% 以上：不炸
  layers(s1, [["flesh", 39, 40]]); layers(s2, [["flesh", 11, 40]]);
  strike(f, k, ke, 4);
  assert.ok(hp(f.c, s1) < 39 && !s1.dead && !s1._sweeperBoom, "还在 25% 以上：不炸");
  // s1 降到 11（27.5%），这一下打下去 < 25%：立刻自爆，冲到柯尔特所在的 1 区炸我方
  layers(s1, [["flesh", 12, 40]]);
  const xp0 = f.S.battleGains.xp;
  const out = strike(f, k, ke, 4);
  assert.equal(s1.dead, true, "自爆后自己死亡");
  assert.equal(s1.zone, 1, "冲到打它的人所在的区");
  assert.deepEqual([500 - hp(f.c, k), 500 - hp(f.c, h)], [s1.atk, s1.atk], "1 区所有敌对单位 1×atk 火");
  assert.ok(f.S.battleGains.xp > xp0, "照常结算击杀");
  assert.match(out.extra.join("\n"), /代挡后只剩不到 25% 的血量：立刻发动协助（自爆）/, "写在这一击的结果后面");
  // 被这一下直接打死的不炸
  layers(s2, [["flesh", 3, 40]]);
  const k1 = hp(f.c, k);
  strike(f, k, ke, 20);
  assert.equal(s2.dead, true);
  assert.ok(!s2._sweeperBoom, "打死了就不自爆");
  assert.equal(hp(f.c, k), k1);
});

test("清扫员协助：和普通攻击一样（打失衡的人所在的区，每人 0.5×atk 谐波）；场上有别的单位能协助时它不主动协助，只剩它能协助才出手", () => {
  const f = field([{ id: "sewer_cleaner", lv: 5, zone: 2 }, { id: "sewer_keeper", lv: 5, zone: 2 }, { id: "guard_sword", lv: 1, zone: 1 }]);
  const cl = f.E("sewer_cleaner"), ke = f.E("sewer_keeper"), g = f.E("guard_sword"), k = f.P("kolt"), h = f.P("helu");
  [k, h].forEach(u => layers(u, [["spirit", 300]]));
  k.zone = 1; h.zone = 1;
  assert.equal(f.c.enemyAssistSkillId(cl), "en_cleaner_assist");
  assert.equal(f.c.EnemyAI.pickAssister([cl, ke], k), ke.id, "维护员也能协助：清扫员不出手");
  assert.equal(f.c.EnemyAI.pickAssister([ke, cl], k), ke.id);
  assert.equal(f.c.EnemyAI.pickAssister([cl], k), cl.id, "只剩清扫员：照常协助");
  // 只有清扫员能接（维护员失衡）：打失衡的柯尔特所在的 1 区
  ke.stunned = true;
  f.S.combatPhase = "enemy";
  f.c.dealBreak(k, k.def, "physical", [], "测试", { by: g });
  f.c.BattleSim.resolveQueues(noBlock);
  [k, h].forEach(u => assert.ok(Math.abs((300 - hp(f.c, u)) - cl.atk * 0.5) <= 1, `${u.name}：${300 - hp(f.c, u)}`));
  assert.match(f.logs(), /触灵清扫员 对 1 区所有敌人发出谐波/);
});

/* ================= 三方混战、遭遇 ================= */

test("下水道的三方混战：三区制 15%（THREE_WAY.chance 共用）；玩家在 2 区，狂鼠一边、下水道维护一边，各 3 枚代币；清扫机、维护员、清扫员照代币混着出", () => {
  const c = H.load();
  const T = get(c, "THREE_WAY");
  assert.deepEqual(plain(T.regions["下水道"]), { name: "三方混战", sides: [["狂鼠"], ["下水道维护"]] });
  assert.equal(T.chance, 0.15);
  c.Math.random = c.makeRng("SEWER-3W");
  const N = 2000;
  let n = 0;
  for (let i = 0; i < N; i++) if (c.rollEncounter({ region: "下水道", zoneMode: 3 }).layout === "threeway") n++;
  assert.ok(Math.abs(n / N - 0.15) < 0.03, `约 15%，实际 ${(n / N * 100).toFixed(1)}%`);
  for (let i = 0; i < 20; i++) assert.notEqual(c.rollEncounter({ region: "下水道", zoneMode: 2 }).layout, "threeway", "两区制不变");
  const kitsSeen = new Set();
  for (let i = 0; i < 60; i++) {
    const spec = c.rollEncounter({ region: "下水道", threeWay: true, zoneMode: 3 });
    assert.equal(spec.name, "下水道·三方混战");
    assert.deepEqual([spec.layout, spec.playerZone, spec.zoneMode], ["threeway", 2, 3]);
    const by = {};
    spec.enemies.forEach(e => {
      const info = c.enemyInfo(e.preset);
      by[info.faction] = by[info.faction] || { zones: new Set(), tokens: 0 };
      by[info.faction].zones.add(e.zone);
      by[info.faction].tokens += (info.tokens || 1) / (Number(info.group) || 1);   // 成组的（清扫机）整组记 1 枚
      if (info.faction === "下水道维护") kitsSeen.add(e.preset);
    });
    assert.deepEqual(Object.keys(by).sort(), ["下水道维护", "狂鼠"].sort());
    assert.equal(by["狂鼠"].zones.size, 1); assert.equal(by["下水道维护"].zones.size, 1);
    assert.notEqual([...by["狂鼠"].zones][0], [...by["下水道维护"].zones][0]);
    assert.equal(Math.round(by["狂鼠"].tokens), 3); assert.equal(Math.round(by["下水道维护"].tokens), 3);
  }
  assert.deepEqual([...kitsSeen].sort(), ["sewer_cleaner", "sewer_keeper", "sewer_sweeper"].sort(), "三种都会出");
  // 一般的下水道维护遭遇也照代币抽，精英和清扫机混着出
  const pool = c.regionPool("下水道");
  ELITES.forEach(k => assert.ok(pool.includes(k), k));
  ["外城区", "巨人城", "第三采矿场"].forEach(r => ELITES.forEach(k => assert.ok(!c.regionPool(r).includes(k), r)));
});

test("三方混战整场自动对打：清扫员、维护员、清扫机和狂鼠互相打，能打完、没有报错", () => {
  let fights = 0, eliteHits = 0;
  for (let i = 0; i < 4; i++) {
    const c = H.load();
    const spec = { name: "下水道·三方混战", region: "下水道", zoneMode: 3, layout: "threeway", layoutLocked: true, playerZone: 2, enemies: [
      { preset: "sewer_cleaner", zone: 1 }, { preset: "sewer_keeper", zone: 1 }, { preset: "sewer_sweeper", zone: 1, count: 3 },
      { preset: "rat_biter", zone: 3 }, { preset: "rat_plague", zone: 3 }] };
    c.BattleSim.setup({ party: ["kolt", "helu", "tou"], encounter: spec, level: 4, seed: "SEWER-3W-FIGHT" + i });
    ELITES.forEach(k => assert.ok(c.S.state.units.some(u => u.kit === k), k + " 摆上场"));
    const orig = c.dealTo;
    c.dealTo = function (a, t, opt) {
      if (a && t && !a.isPlayer && !t.isPlayer && c.hostileTo(a, t)) fights++;
      if (a && ELITES.includes(a.kit)) eliteHits++;
      return orig.apply(this, arguments);
    };
    const r = c.BattleSim.run({ maxRounds: 25 });
    assert.ok(r.winner && r.actions > 0);
  }
  assert.ok(fights > 0, "狂鼠和下水道维护打起来了");
  assert.ok(eliteHits > 0, "两个精英出手了");
});

/* ================= 掉落、图鉴、联机 ================= */

test("掉落：精英也只掉废料，比清扫机多；图鉴写种族、招式、被动、清扫员的代挡规则", () => {
  const c = H.load();
  const T = get(c, "ENEMY_DROPS");
  ELITES.forEach(k => {
    assert.deepEqual(Object.keys(T[k]), ["cm_scrap"], k);
    assert.ok(T[k].cm_scrap > T.sewer_sweeper.cm_scrap, k + "：比清扫机多");
  });
  assert.match(c.ITEM_CATALOG.cm_scrap.hint, /触灵维护员/);
  const e = k => c.bestiaryEntries().find(x => x.kit === k);
  ELITES.forEach(k => assert.deepEqual([e(k).rank, e(k).faction, e(k).regions.join(), e(k).race], ["elite", "下水道维护", "下水道", "触灵"], k));
  const kt = e("sewer_keeper").text.abilities.join("\n"), ct = e("sewer_cleaner").text.abilities.join("\n");
  assert.match(kt, /种族「触灵」：和机甲触灵、飞碟触灵同类，没有种族被动/);
  assert.match(kt, /普通攻击：远距 1×atk \+ 1d4 电击，1 击破/);
  assert.match(kt, /附赠·清除状态：身上有负面状态时，花附赠清掉一种——只清负面的/);
  assert.match(kt, /每清除一种状态，自己获得永续的振奋/);
  assert.match(kt, /协助：同普通攻击.*并施加感电/);
  assert.match(ct, /选远距射程内敌人最多的一区，对那一区所有敌人各 0\.5×atk 谐波，每人 1 击破/);
  assert.match(ct, /操控清扫机（特点）：清扫员在场时，触灵维护员 \/ 清扫员挨打，同区有清扫机就 100% 由清扫机代为承受（挑同区血量最多的那只）；范围攻击也会被挡下，每人各挡一次/);
  assert.match(ct, /剩下的血量 < 25% 但还没死：它立刻发动协助（自爆）/);
  assert.match(ct, /场上有别的单位能协助时，它不主动协助/);
  assert.match(e("sewer_sweeper").text.abilities.join("\n"), /被触灵清扫员操控/);
  assert.match(e("sewer_keeper").text.move, /远距离/);
});

test("联机：两个精英照常下发（种族「触灵」、永续的振奋、星灵层），坚毅数值不发", () => {
  const c = H.load();
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, "online-view.js"), "utf8"), c, { filename: "online-view.js" });
  c.BattleSim.setup({ party: ["kolt", "helu"], encounter: { name: "下水道", region: "下水道", zoneMode: 2, enemies: [
    { preset: "sewer_keeper", zone: 2 }, { preset: "sewer_cleaner", zone: 2 }, { preset: "sewer_sweeper", zone: 2 }] }, level: 3, seed: "SEWER-ONLINE" });
  c.startCombat();
  const S = c.S.state;
  S.units.filter(u => u.isPlayer).forEach(u => { u.shp = 732911; u.shpMax = 827319; });
  const ke = S.units.find(u => u.kit === "sewer_keeper");
  ke.statuses.corr = true; ke.bonus = 1; S.combatPhase = "enemy"; S.attackerId = ke.id; S.targetId = null;
  c.runSkill("en_sewer_cleanse");
  const view = c.OnlineView.projectState(S);
  const txt = JSON.stringify(view);
  assert.doesNotMatch(txt, /732911|827319/, "坚毅数值不发");
  const vk = view.units.find(u => u.kit === "sewer_keeper"), vc = view.units.find(u => u.kit === "sewer_cleaner");
  assert.deepEqual([plain(vk.race), plain(vc.race)], [{ race: "触灵" }, { race: "触灵" }]);
  assert.deepEqual([vk.statuses.inspire, vk.statuses.corr], [true, false]);
  assert.deepEqual(plain(vk.layers.map(l => l.type)), ["shield", "spirit"]);
  assert.ok(view.units.some(u => u.kit === "sewer_sweeper"));
});
