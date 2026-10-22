// 下水道狂鼠的四个兵种、「狂鼠」阵营和下水道区域、掉落、图鉴（docs/ratfolk.md 第 1、3、4、5 节，issue #277）
// 通用机制（出血、狂暴、狂潮）在 tests/ratfolk-common.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("./headless");

const KITS = ["rat_lurker", "rat_biter", "rat_plague", "rat_tyrant"];
const get = (c, expr) => vm.runInContext(expr, c);
const plain = x => JSON.parse(JSON.stringify(x));
const noBlock = { pickBlocker: () => null, pickAssister: l => l[0].id };
const layers = (u, ls) => { u.layers = ls.map((l, i) => ({ type: l[0], current: l[1], max: l[2] != null ? l[2] : l[1], inner: i === ls.length - 1 })); };
const flesh = (u, cur, max) => layers(u, [["flesh", cur, max != null ? max : cur]]);

/** 一场摆好的战斗（个体值不波动），已开战，我方回合。enemies：[{ id, lv, zone }] */
function field(enemies, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: opt.party || ["kolt", "helu"], enemies, seed: opt.seed || "RATS", zoneMode: opt.zoneMode || 2 });
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
function use(f, a, id, t) {
  f.S.combatPhase = "enemy"; a.ap = Math.max(1, a.ap || 0); f.S.attackerId = a.id; f.S.targetId = t ? t.id : null;
  f.c.runSkill(id);
  f.c.BattleSim.resolveQueues(noBlock);
}
/** 我方 a 对 t 用技能 id */
function hero(f, a, id, t) {
  f.S.combatPhase = "player"; a.ap = Math.max(1, a.ap || 0); f.S.attackerId = a.id; f.S.targetId = t ? t.id : null;
  f.c.runSkill(id);
  f.c.BattleSim.resolveQueues(noBlock);
}
const count = (s, re) => (s.match(new RegExp(re.source, "g")) || []).length;

/* ================= 数值、登记 ================= */

test("数值：四个兵种 1 / 5 / 10 / 15 / 20 级（2 人队）的肉体、架势、ATK 和文档第 3 节的表一致；纯肉体一层，种族「鼠类人·鼠」的体质 −1 已经算进去；图鉴显示的一样", () => {
  const c = H.load();
  get(c, "ENEMY_IV.off++");   // 个体值不波动
  const mult = get(c, "BOSS_POSTURE_MULT"), eliteMin = get(c, "ELITE_RULE_MIN_LEVEL");
  // [肉体, 架势（模板的数；10 级起的精英照现有规则再 ×0.6）, ATK]
  // 文档的表里潜藏者 / 撕咬者 5 级肉体写 31、潜藏者 20 级 ATK 写 17，和文档写的公式对不上（公式算出来是 27、18）：这里照公式，issue #277 里问了
  const TABLE = {
    rat_lurker: { 1: [15, 3, 4], 5: [27, 3, 7], 10: [42, 4, 11], 15: [57, 4, 14], 20: [72, 5, 18] },
    rat_biter:  { 1: [15, 3, 5], 5: [27, 3, 9], 10: [42, 4, 14], 15: [57, 4, 19], 20: [72, 5, 24] },
    rat_plague: { 1: [40, 4, 6], 5: [88, 5, 8], 10: [147, 6, 10], 15: [206, 7, 12], 20: [265, 8, 14] },
    rat_tyrant: { 1: [33, 3, 8], 5: [73, 4, 12], 10: [123, 5, 17], 15: [173, 6, 21], 20: [223, 7, 26] }
  };
  Object.keys(TABLE).forEach(kit => Object.keys(TABLE[kit]).forEach(lvs => {
    const lv = Number(lvs), [fl, def, atk] = TABLE[kit][lvs];
    const u = c.spawnEnemyGroup(kit, lv, 2, 2)[0];
    const elite = get(c, "ENEMY_RANK")[kit] === "elite";
    assert.deepEqual(plain(u.layers.map(l => [l.type, l.max])), [["flesh", fl]], `${kit} ${lv} 级肉体`);
    assert.equal(u.defMax, elite && lv >= eliteMin ? Math.round(def * mult) : def, `${kit} ${lv} 级架势`);
    assert.equal(u.atk, atk, `${kit} ${lv} 级 ATK`);
    assert.equal(c.raceText(u), "鼠类人·鼠");
    const st = c.bestiaryStats(kit, lv, 2);
    assert.deepEqual([st.layers.length, st.layers[0].hp, st.def, st.atk], [1, fl, u.defMax, atk], `${kit} ${lv} 级图鉴（按种族换算过）`);
  }));
  // 伤害骰：潜藏者 / 撕咬者 1d6，暴徒 / 猎手固定 1d8（不随等级升档）
  [1, 20].forEach(lv => {
    assert.deepEqual(plain(KITS.map(k => c.spawnEnemyGroup(k, lv, 2, 2)[0].suggest.dice)), [[1, 6], [1, 6], [1, 8], [1, 8]]);
  });
  const S = get(c, "RAT_STATS");
  assert.equal(S.lurker.atkMult, 0.75, "潜藏者的 ATK 倍率在配置表里");
});

test("数值：照模板换算——潜藏者 / 撕咬者照狂徒（匕首），疫病暴徒照牛队长、暴虐猎手照狼队长（护盾 + 肉体合成纯肉体、架势 −1）；种族的 −(1 + 等级) 不随人数缩放", () => {
  const c = H.load();
  get(c, "ENEMY_IV.off++");
  const base = (id, lv, p) => c.enemyPresets().find(x => x.id === id).build(lv, p);
  const total = u => u.layers.reduce((s, l) => s + l.max, 0);
  for (let lv = 1; lv <= 20; lv++) for (const p of [2, 3, 4]) {
    const rat = k => c.spawnEnemyGroup(k, lv, p, 2)[0];
    const knife = base("thug_knife", lv, 2), ox = base("captain_ox", lv, 2), wolf = base("captain_wolf", lv, 2);
    // 3 / 4 人队：合成之后的这一层按 scaleHp 放大；种族的 −(1 + 等级) 不放大
    const con = 1 + lv, tag = `${lv} 级 ${p} 人队`, scaled = u => c.scaleHp(total(u), p) - con;
    ["rat_lurker", "rat_biter"].forEach(k => {
      const u = rat(k);
      assert.equal(total(u), scaled(knife), `${k} ${tag}`);
      if (p === 2) assert.equal(u.defMax, knife.defMax, `${k} ${tag} 架势同狂徒（耐力 −1 不变）`);
    });
    assert.equal(rat("rat_lurker").atk, Math.round(knife.atk * 0.75), tag);
    assert.equal(rat("rat_biter").atk, knife.atk, tag);
    const pl = rat("rat_plague"), ty = rat("rat_tyrant");
    assert.equal(total(pl), scaled(ox), `暴徒 ${tag}（牛队长的护盾 + 肉体合成一层）`);
    assert.equal(total(ty), scaled(wolf), `猎手 ${tag}（狼队长的护盾 + 肉体合成一层）`);
    assert.equal(pl.atk, ox.atk); assert.equal(ty.atk, wolf.atk);
    if (lv < 10 && p === 2) { assert.equal(pl.defMax, ox.defMax - 1, tag); assert.equal(ty.defMax, wolf.defMax - 1, tag); }
  }
});

test("登记：杂兵 / 精英、代币、阵营「狂鼠」、只出没在下水道、固定种族「鼠类人·鼠」并且套六维（raceAttrs）；种族被动「环境适应」；狂潮认它们", () => {
  const c = H.load();
  get(c, "ENEMY_IV.off++");
  const info = get(c, "ENEMY_INFO"), rank = get(c, "ENEMY_RANK");
  const want = { rat_lurker: ["minion", 1], rat_biter: ["minion", 1], rat_plague: ["elite", 2], rat_tyrant: ["elite", 2] };
  assert.equal(get(c, "RATFOLK_FACTION"), "狂鼠");
  KITS.forEach(k => {
    const i = info[k];
    assert.deepEqual([rank[k], i.tokens, i.faction, i.regions.join(), i.race, i.raceAttrs], [want[k][0], want[k][1], "狂鼠", "下水道", "鼠类人·鼠", true], k);
    const u = c.spawnEnemyGroup(k, 5, 2, 2)[0];
    assert.equal(c.isRatfolk(u), true, k + "：狂潮认它");
    assert.match(c.racePerkLines(u).join(), /环境适应/);
  });
  // 主持人改种族：先去掉鼠类人的 −(1 + 等级)，再按新种族换算（固定种族也套六维）
  const u = c.spawnEnemyGroup("rat_biter", 10, 2, 2)[0];
  c.setEnemyRace(u, "人类");
  assert.equal(u.layers[0].max, 53, "人类：回到狂徒（匕首）的 53");
  // 别的固定种族照旧不套六维
  assert.equal(c.spawnEnemyGroup("captain_wolf", 10, 2, 2)[0].layers.reduce((s, l) => s + l.max, 0),
    c.enemyPresets().find(p => p.id === "captain_wolf").build(10, 2).layers.reduce((s, l) => s + l.max, 0));
});

/* ================= 阵营、区域 ================= */

test("阵营：狂鼠和所有阵营敌对（安保、警卫队、镇压队、盗匪、沙灵、异星生物……），狂鼠之间不敌对；不和任何阵营混编", () => {
  const c = H.load();
  const info = get(c, "ENEMY_INFO");
  const rat = { kit: "rat_biter", isPlayer: false };
  const factions = [...new Set(Object.values(info).map(i => i.faction))].filter(f => f !== "狂鼠" && f !== "中立生物");
  ["安保", "警卫队", "镇压队", "盗匪", "沙灵", "沙漠生物", "异星生物", "触灵", "巨人", "野生"].forEach(f => assert.ok(factions.includes(f), f));
  factions.forEach(f => {
    const u = { kit: Object.keys(info).find(k => info[k].faction === f), isPlayer: false };
    assert.equal(c.hostileTo(rat, u), true, f);
    assert.equal(c.hostileTo(u, rat), true, f);
  });
  KITS.forEach(k => assert.equal(c.hostileTo(rat, { kit: k, isPlayer: false }), false, "狂鼠之间：" + k));
  assert.equal(c.hostileTo(rat, { kit: "kolt", isPlayer: true }), true, "我方");
  assert.equal(c.hostileTo(rat, { kit: "dust_bug", isPlayer: false }), false, "中立生物谁都不当它是敌人");
  assert.ok(plain(get(c, "HOSTILE_FACTIONS")).includes(get(c, "RATFOLK_FACTION")));
  assert.deepEqual(plain(c.alliesOf("狂鼠")), ["狂鼠"]);
  assert.ok(!get(c, "ALLIED_FACTIONS").some(g => g.includes("狂鼠")));
  for (let i = 0; i < 50; i++) assert.deepEqual(plain(c.encounterFactions("狂鼠")), ["狂鼠"]);
  // 场上：狂鼠把别的阵营的敌人也当猎物，别的阵营也打它
  const f = field([{ id: "rat_biter", lv: 1, zone: 2 }, { id: "guard_sword", lv: 1, zone: 2 }]);
  const b = f.E("rat_biter"), g = f.E("guard_sword");
  assert.ok(f.c.hostilesOf(b).includes(g) && f.c.hostilesOf(g).includes(b));
});

test("下水道：隶属巨人城的专门区域，敌人池里只有狂鼠；巨人城和别的区域抽不到狂鼠，「不分地区」的遭遇战也抽不到", () => {
  const c = H.load();
  c.S.RNG.install("SEWER");
  assert.deepEqual([...c.regionPool("下水道")].sort(), [...KITS].sort());
  assert.deepEqual(plain(c.regionFactions("下水道")), ["狂鼠"]);
  assert.equal(get(c, "SUB_REGIONS")["下水道"].parent, "巨人城");
  for (let i = 0; i < 300; i++) {
    const enc = c.rollEncounter({ region: "下水道" });
    assert.equal(enc.region, "下水道");
    assert.ok(enc.enemies.length && enc.enemies.every(e => KITS.includes(e.preset)), JSON.stringify(enc.enemies));
    assert.ok(/^下水道·(狂鼠|混战)$/.test(enc.name), enc.name);
    const tokens = enc.enemies.reduce((s, e) => s + c.enemyTokens(e.preset) * (e.count || 1), 0);
    assert.ok(tokens >= 4 && tokens <= 5, "代币：杂兵 1 枚，精英 2 枚，一场 4–5 枚：" + tokens);
  }
  ["外城区", "巨人城", "第一采矿场", "第二采矿场", "第三采矿场", "沙漠", "天网设施"].forEach(r => {
    assert.ok(!c.regionPool(r).some(k => KITS.includes(k)), r);
    for (let i = 0; i < 40; i++) assert.ok(!c.rollEncounter({ region: r }).enemies.some(e => KITS.includes(e.preset)), r);
  });
  // 单局休息时被偷袭的遭遇战（敌人不分地区、不分阵营）：只出没在专门区域里的狂鼠不混进来
  assert.ok(!c.regionPool(null).some(k => KITS.includes(k)));
  for (let i = 0; i < 200; i++) {
    const enc = c.rollEncounter({ region: "外城区", anyRegion: true, mixed: true, tokens: 3 });
    assert.ok(!enc.enemies.some(e => KITS.includes(e.preset)), JSON.stringify(enc.enemies));
  }
});

test("下水道：抽到的遭遇和战斗模板都能摆出狂鼠；战场的区域 / 场景是下水道的水道（world-data.js 已有的 HD-2D 场景）", () => {
  const c = H.load();
  c.S.RNG.install("SEWER-2");
  const enc = c.rollEncounter({ region: "下水道" });
  c.BattleSim.setup({ party: ["kolt", "helu"], encounter: enc, level: 3, seed: "SEWER-FIGHT" });
  const S = c.S.state;
  const foes = S.units.filter(u => !u.isPlayer && !u.hidden);
  assert.ok(foes.length && foes.every(u => KITS.includes(u.kit) && c.raceText(u) === "鼠类人·鼠"));
  assert.deepEqual([S.region, S.scene], ["下水道", "tunnel"]);
  // 战斗模板（跑团主持人）：四个兵种都能摆
  const t = c.battleTemplateNormalize({ name: "下水道", board: 3, enemies: KITS.map((k, i) => ({ preset: k, level: 4, zone: 1 + (i % 3) })) });
  assert.deepEqual(t.enemies.map(e => e.preset), KITS);
  c.BattleSim.setup({ party: ["kolt", "helu"], encounter: c.battleTemplateToEncounter(t), seed: "SEWER-TPL" });
  assert.deepEqual(plain(c.S.state.units.filter(u => !u.isPlayer).map(u => [u.kit, u.level, u.zone])), KITS.map((k, i) => [k, 4, 1 + (i % 3)]));
});

/* ================= 潜藏者 ================= */

test("潜藏者：开战时躲藏（选不中，范围攻击照样波及）；普通攻击 1×atk + 1d6 物理、1 击破、施加腐蚀，出手后躲藏解除", () => {
  const f = field([{ id: "rat_lurker", lv: 5, zone: 1 }]);
  const lu = f.E("rat_lurker"), k = f.P("kolt");
  assert.equal(lu.statuses.hide, true, "开战时躲藏");
  const out = f.c.dealTo(k, lu, { atk: 10, mult: 1, element: "physical", baseBreak: 0, flags: { action: true, blockResolved: true, block: "none" } });
  assert.equal(out.res.ok, false);
  assert.match(out.extra.join(), /躲藏中，不能被选作攻击目标/);
  flesh(k, 500); f.P("helu").zone = 2;   // Helumica 不在同区：没人协助格挡
  const d0 = k.def;
  use(f, lu, "en_rat_lurker_bite", k);
  const lost = 500 - f.c.totalHp(k);
  assert.ok(lost >= lu.atk + 1 && lost <= lu.atk + 6, `伤害 ${lost}（ATK ${lu.atk} + 1d6）`);
  assert.equal(d0 - k.def, 1, "1 击破");
  assert.equal(k.statuses.corr, true, "施加腐蚀");
  assert.equal(lu.statuses.hide, false, "发动攻击，躲藏解除");
});

test("潜藏者：协助同普通攻击（近距，施加腐蚀），打完进入狂暴；狂暴时每回合结束进入躲藏（不狂暴的不躲）", () => {
  const f = field([{ id: "rat_biter", lv: 1, zone: 1 }, { id: "rat_lurker", lv: 1, zone: 1 }, { id: "rat_lurker", lv: 1, zone: 1 }]);
  const b = f.E("rat_biter"), lu = f.E("rat_lurker", 0), lu2 = f.E("rat_lurker", 1), k = f.P("kolt");
  f.P("helu").zone = 2;
  flesh(k, 500); k.def = 1;
  lu.personalAtk += 50;   // 两只潜藏者都能协助：挑 ATK 高的这只
  assert.equal(f.c.enemyAssistSkillId(lu), "en_rat_lurker_assist");
  use(f, b, "en_rat_biter_bite", k);   // 1 击破：柯尔特失衡 → 潜藏者协助
  assert.equal(lu.self, "frenzy", "协助后进入狂暴");
  assert.equal(k.statuses.corr, true, "协助也施加腐蚀");
  assert.match(f.logs(), /潜藏者 进入狂暴（协助）/);
  assert.equal(lu2.self, "none");
  // 回合结束：狂暴的潜藏者进入躲藏（狂潮：3 只里 1 只狂暴，不到一半，另外两只不狂暴）
  lu.statuses.hide = false; lu2.statuses.hide = false;
  f.c.endPlayerTurn(); f.c.endEnemyTurn();
  assert.equal(lu.statuses.hide, true, "狂暴：回合结束进入躲藏");
  assert.equal(lu2.statuses.hide, false, "不狂暴的不躲");
  assert.match(f.logs(), /潜藏者 狂暴：回合结束，进入躲藏/);
});

test("潜藏者逃跑：被近战攻击打中后，这次行动打完免费往远离攻击者的方向移动 1 区，不触发借机攻击；一次行动里挨几下也只逃一次", () => {
  const f = field([{ id: "rat_lurker", lv: 1, zone: 1 }]);
  const lu = f.E("rat_lurker"), k = f.P("kolt"), h = f.P("helu");
  lu.statuses.hide = false; flesh(lu, 999);
  let opp = 0;
  const orig = f.c.triggerLeaveOpportunity;
  f.c.triggerLeaveOpportunity = (...a) => { opp++; return orig(...a); };
  const bonus = lu.bonus, ap = lu.ap;
  hero(f, k, "kolt_aa", lu);   // 柯尔特的普通攻击：同区三段
  assert.ok(999 - f.c.totalHp(lu) > 0, "打到了");
  assert.match(f.logs(), /→ 潜藏者：\d+ 伤害.*（3 击）/, "三段都打完了才逃");
  assert.equal(lu.zone, 2, "两区制：逃到另一区");
  assert.equal(count(f.logs(), /【潜藏者】逃跑/), 1);
  assert.match(f.logs(), /挨了 柯尔特 的近战攻击：免费移动，不触发借机攻击/);
  assert.equal(opp, 0, "不触发借机攻击");
  assert.deepEqual([lu.ap, lu.bonus], [ap, bonus], "免费移动");
  // 对照：敌人自己走一步照常看借机攻击
  f.S.combatPhase = "enemy"; lu.ap = 1;
  f.c.doMove(lu, 1);
  assert.equal(opp, 1);
  // 挨打时只记下来，行动打完（ratfolkSweep）才逃；同一次里挨了两个人的近战也只逃一次
  const hit = (a) => f.c.dealTo(a, lu, { atk: 5, mult: 1, element: "physical", baseBreak: 0, atkRange: "melee", flags: { action: true, blockResolved: true, block: "none" } });
  h.zone = 1; k.zone = 1;
  hit(k); hit(h);
  assert.equal(lu.zone, 1, "还没逃");
  f.c.ratfolkSweep();
  assert.equal(lu.zone, 2);
  assert.equal(count(f.logs(), /【潜藏者】逃跑/), 2, "这一次只逃了一回");
});

test("潜藏者逃跑：三区里往离攻击者远、敌人少的那边逃；隔区挨打（远程）、被打死、被打进失衡都不跑", () => {
  const f = field([{ id: "rat_lurker", lv: 1, zone: 2 }], { party: ["kolt", "helu", "ruby"], zoneMode: 3 });
  f.S.zoneMode = 3;
  const lu = f.E("rat_lurker"), k = f.P("kolt"), h = f.P("helu"), ruby = f.P("ruby");
  lu.statuses.hide = false; flesh(lu, 999);
  k.zone = 2; h.zone = 1; ruby.zone = 2;
  hero(f, k, "kolt_aa", lu);
  assert.equal(lu.zone, 3, "攻击者在同区：两边一样远，挑没有敌人的 3 区（Helumica 在 1 区）");
  // 隔区（远程）挨打：不跑（瑞比的普通攻击只打距离 1）
  const hp0 = f.c.totalHp(lu);
  hero(f, ruby, "ruby_aa", lu);
  assert.ok(f.c.totalHp(lu) < hp0, "打到了");
  assert.equal(lu.zone, 3, "隔一区打过来的不是近战");
  // 被打进失衡：不跑
  const g = field([{ id: "rat_lurker", lv: 1, zone: 1 }]);
  const lu2 = g.E("rat_lurker");
  lu2.statuses.hide = false; flesh(lu2, 999); lu2.def = 1;
  hero(g, g.P("kolt"), "kolt_aa", lu2);
  assert.equal(lu2.stunned, true);
  assert.equal(lu2.zone, 1, "被打进失衡不跑");
  assert.doesNotMatch(g.logs(), /【潜藏者】逃跑/);
  // 被打死：不跑
  const d = field([{ id: "rat_lurker", lv: 1, zone: 1 }]);
  const lu3 = d.E("rat_lurker");
  lu3.statuses.hide = false; flesh(lu3, 2, 15);
  hero(d, d.P("kolt"), "kolt_aa", lu3);
  assert.equal(lu3.dead, true);
  assert.doesNotMatch(d.logs(), /【潜藏者】逃跑/);
});

test("潜藏者：疫病暴徒在场时优先攻击还没有腐蚀的敌人；暴徒不在场照常打同区血多的", () => {
  const plan = (withPlague) => {
    const f = field([{ id: "rat_lurker", lv: 1, zone: 1 }].concat(withPlague ? [{ id: "rat_plague", lv: 1, zone: 2 }] : []));
    const lu = f.E("rat_lurker"), k = f.P("kolt"), h = f.P("helu");
    flesh(k, 300); flesh(h, 100);
    k.statuses.corr = true;
    f.S.combatPhase = "enemy";
    const p = f.c.EnemyAI.plan(lu);
    return p.meta.targetId === h.id ? "helu" : p.meta.targetId === k.id ? "kolt" : p.meta.targetId;
  };
  assert.equal(plan(false), "kolt", "照常：同区血多的柯尔特");
  assert.equal(plan(true), "helu", "暴徒在场：先打还没腐蚀的 Helumica");
});

/* ================= 撕咬者 ================= */

test("撕咬者：普通攻击 1×atk + 1d6 物理、1 击破、带出血；协助同普通攻击并进入狂暴", () => {
  const f = field([{ id: "rat_biter", lv: 1, zone: 1 }, { id: "rat_lurker", lv: 1, zone: 1 }]);
  const b = f.E("rat_biter"), lu = f.E("rat_lurker"), k = f.P("kolt");
  f.P("helu").zone = 2;
  flesh(k, 1000);
  const d0 = k.def;
  use(f, b, "en_rat_biter_bite", k);
  const lost = 1000 - f.c.totalHp(k);
  assert.ok(lost >= b.atk + 1 + 100 && lost <= b.atk + 6 + 100, `伤害 + 出血 100：${lost}`);
  assert.match(f.logs(), /出血 100（真实伤害）/);
  assert.equal(d0 - k.def, 1);
  // 协助：潜藏者打出失衡，撕咬者协助
  assert.equal(f.c.enemyAssistSkillId(b), "en_rat_biter_assist");
  k.def = 1;
  use(f, lu, "en_rat_lurker_bite", k);
  assert.equal(b.self, "frenzy");
  assert.match(f.logs(), /撕咬者 进入狂暴（协助）/);
});

test("撕咬者狂暴：普通攻击变成两次 0.5×atk 物理（共 1 击破，狂暴再 +1），每一击都出血（10% → 5%）；技能名跟着改", () => {
  const f = field([{ id: "rat_biter", lv: 1, zone: 1 }]);
  const b = f.E("rat_biter"), k = f.P("kolt");
  f.P("helu").zone = 2;
  flesh(k, 1000);
  f.c.enterFrenzy(b, []);
  const atk = f.c.effectiveAtk(b, f.S.units);
  assert.equal(atk, 5 + 1, "狂暴：ATK + 等级");
  assert.match(f.c.enemySkillList(b).find(s => s.id === "en_rat_biter_bite").label, /狂暴：2 次 0\.5×ATK/);
  const d0 = k.def;
  use(f, b, "en_rat_biter_bite", k);
  assert.equal(1000 - f.c.totalHp(k), 2 * Math.floor(atk * 0.5) + 100 + 50);
  assert.match(f.logs(), /出血 100 \+ 50 = 150（真实伤害）/);
  assert.equal(d0 - k.def, 2, "共 1 击破 + 狂暴 1");
  const B = get(f.c, "RAT_CFG").biter;
  assert.deepEqual([B.frenzyHits, B.frenzyMult], [2, 0.5], "倍率在配置表里");
});

/* ================= 疫病暴徒 ================= */

test("疫病暴徒·感染撕扯：近距 1×atk + 1d8 物理、1 击破、施加腐蚀；目标原本已经腐蚀时自己回 10% 最大生命", () => {
  const f = field([{ id: "rat_plague", lv: 1, zone: 1 }]);
  const pl = f.E("rat_plague"), k = f.P("kolt");
  f.P("helu").zone = 2;
  flesh(k, 1000);
  const max = f.c.totalMaxHp(pl);
  pl.layers[0].current = max - 20;
  use(f, pl, "en_rat_plague_claw", k);
  const lost = 1000 - f.c.totalHp(k);
  assert.ok(lost >= pl.atk + 1 && lost <= pl.atk + 8, `伤害 ${lost}`);
  assert.equal(k.statuses.corr, true);
  assert.equal(f.c.totalHp(pl), max - 20, "目标原本没有腐蚀：不回血");
  pl.ap = 1;
  use(f, pl, "en_rat_plague_claw", k);
  assert.equal(f.c.totalHp(pl), max - 20 + Math.floor(max * 0.1), "目标原本已经腐蚀：回 10% 最大生命");
  assert.match(f.logs(), /目标原本已经腐蚀：疫病暴徒 恢复 \d+ 生命（10% 最大生命）/);
});

test("疫病暴徒·感染喷洒：远距 1×atk + 1d8 酸、1 击破、施加腐蚀；目标原本已经腐蚀时，把腐蚀扩散到目标同区的所有敌人", () => {
  const f = field([{ id: "rat_plague", lv: 1, zone: 2 }], { party: ["kolt", "helu", "ruby"] });
  const pl = f.E("rat_plague"), k = f.P("kolt"), h = f.P("helu"), r = f.P("ruby");
  [k, h, r].forEach(u => flesh(u, 1000));
  r.zone = 2;
  // 没腐蚀的目标：只给它上腐蚀
  use(f, pl, "en_rat_plague_spray", h);
  assert.ok(f.c.totalHp(h) < 1000 && h.statuses.corr === true);
  assert.equal(k.statuses.corr, false, "原本没腐蚀：不扩散");
  // 原本已经腐蚀：扩散到 1 区的所有敌人，别的区不管
  pl.ap = 1;
  use(f, pl, "en_rat_plague_spray", h);
  assert.equal(k.statuses.corr, true, "同区的柯尔特被扩散");
  assert.equal(r.statuses.corr, false, "2 区的瑞比不算");
  assert.match(f.logs(), /感染喷洒：Helumica 身上的腐蚀扩散到 1 区的 柯尔特/);
  assert.equal(get(f.c, "ENEMY_SKILL_RANGE").en_rat_plague_spray, "ranged");
});

test("疫病暴徒·协助：冲到目标所在区 1.5×atk 酸、施加腐蚀；目标原本已经腐蚀时伤害 +2d8，自己回 25% 最大生命", () => {
  const run = (corr) => {
    const f = field([{ id: "rat_plague", lv: 1, zone: 2 }, { id: "rat_lurker", lv: 1, zone: 1 }]);
    const pl = f.E("rat_plague"), lu = f.E("rat_lurker"), k = f.P("kolt");
    flesh(k, 1000); k.statuses.corr = corr;
    const max = f.c.totalMaxHp(pl);
    pl.layers[0].current = max - 30;
    assert.equal(f.c.enemyAssistSkillId(pl), "en_rat_plague_assist");
    assert.ok(f.c.enemyAssistReady(pl, k), "隔一区也冲得过去");
    f.S.combatPhase = "enemy";
    f.c.dealBreak(k, k.def, "physical", [], "测试", { by: lu });   // 潜藏者打出的失衡：暴徒来协助
    f.c.BattleSim.resolveQueues(noBlock);
    return { f, pl, k, max, lost: 1000 - f.c.totalHp(k) };
  };
  const a = run(false);
  assert.equal(a.pl.zone, 1, "冲到目标所在区");
  assert.equal(a.lost, Math.floor(a.pl.atk * 1.5), "1.5×atk 酸（酸打肉体不加减）");
  assert.equal(a.k.statuses.corr, true);
  assert.equal(a.f.c.totalHp(a.pl), a.max - 30, "原本没腐蚀：不回血");
  const b = run(true);
  assert.ok(b.lost >= Math.floor(b.pl.atk * 1.5) + 2 && b.lost <= Math.floor(b.pl.atk * 1.5) + 16, `+2d8：${b.lost}`);
  assert.equal(b.f.c.totalHp(b.pl), b.max - 30 + Math.floor(b.max * 0.25), "回 25% 最大生命");
  const P = get(b.f.c, "RAT_CFG").plague;
  assert.deepEqual([P.clawHeal, P.assistMult, plain(P.assistDice), P.assistHeal, P.frenzyHealUp], [0.1, 1.5, [2, 8], 0.25, 0.5]);
});

test("疫病暴徒：所有敌人都腐蚀时进入狂暴（倒地没起身的不算）；狂暴时受到的治疗 +50%", () => {
  const f = field([{ id: "rat_plague", lv: 1, zone: 2 }, { id: "rat_lurker", lv: 1, zone: 1 }]);
  const pl = f.E("rat_plague"), lu = f.E("rat_lurker"), k = f.P("kolt"), h = f.P("helu");
  flesh(k, 500); flesh(h, 500); h.zone = 1;
  k.statuses.corr = true;
  f.c.ratfolkSweep();
  assert.equal(pl.self, "none", "还有人没腐蚀");
  // 潜藏者给最后一个人上腐蚀：这次行动打完，暴徒进入狂暴
  use(f, lu, "en_rat_lurker_bite", h);
  assert.equal(h.statuses.corr, true);
  assert.equal(pl.self, "frenzy");
  assert.match(f.logs(), /【疫病暴徒】狂暴\n\s+疫病暴徒 进入狂暴（所有敌人都腐蚀了）/);
  // 狂暴时受到的治疗 +50%
  const max = f.c.totalMaxHp(pl);
  pl.layers[0].current = max - 40;
  assert.equal(f.c.healUnit(pl, 10), 15);
  f.c.applyNeutralize(pl);
  assert.equal(f.c.healUnit(pl, 10), 10, "不狂暴：照常");
  // 倒地（濒死没起身）的不算：另一个人腐蚀了就够
  const g = field([{ id: "rat_plague", lv: 1, zone: 2 }]);
  const pl2 = g.E("rat_plague");
  g.P("kolt").statuses.corr = true;
  const h2 = g.P("helu"); flesh(h2, 0, 30); h2.dying = true;
  g.c.ratfolkSweep();
  assert.equal(pl2.self, "frenzy");
});

test("疫病暴徒 AI：没有腐蚀的敌人时接近血量最低的人；有腐蚀的敌人时用感染喷洒打它（挑同区没腐蚀的敌人最多的），同区就先退开保持距离 1", () => {
  // 没有腐蚀：走向血少的 Helumica（2 区），柯尔特（1 区）血多
  const f = field([{ id: "rat_plague", lv: 1, zone: 1 }], { zoneMode: 3, party: ["kolt", "helu", "ruby"] });
  f.S.zoneMode = 3;
  const pl = f.E("rat_plague"), k = f.P("kolt"), h = f.P("helu"), r = f.P("ruby");
  flesh(k, 300); flesh(h, 50); flesh(r, 200);
  pl.zone = 1; k.zone = 1; h.zone = 2; r.zone = 3;
  f.S.combatPhase = "enemy";
  let p = f.c.EnemyAI.plan(pl);
  assert.equal(p.ai.kind, "move"); assert.equal(p.ai.dest, 2);
  // 有腐蚀：3 区有腐蚀的瑞比，同区还有没腐蚀的 Helumica（两人都在 3 区）；1 区的柯尔特也腐蚀了但同区没别人 → 喷瑞比
  pl.zone = 2; k.zone = 1; h.zone = 3; r.zone = 3;
  k.statuses.corr = true; r.statuses.corr = true;
  p = f.c.EnemyAI.plan(pl);
  assert.equal(p.meta.skillId, "en_rat_plague_spray");
  assert.equal(p.meta.targetId, r.id);
  // 和有腐蚀的人同区：先退到没人的区，保持距离 1 再喷
  pl.zone = 1; h.zone = 1; r.zone = 1; k.zone = 1;
  p = f.c.EnemyAI.plan(pl);
  assert.equal(p.ai.kind, "move"); assert.equal(p.ai.dest, 2);
});

/* ================= 暴虐猎手 ================= */

test("暴虐猎手：普通攻击 1×atk + 1d8 物理、1 击破、带出血；AI 接近血量最多的敌人（不看同区）", () => {
  const f = field([{ id: "rat_tyrant", lv: 1, zone: 1 }]);
  const ty = f.E("rat_tyrant"), k = f.P("kolt"), h = f.P("helu");
  flesh(k, 1000); h.zone = 2;
  use(f, ty, "en_rat_tyrant_bite", k);
  const lost = 1000 - f.c.totalHp(k);
  assert.ok(lost >= ty.atk + 1 + 100 && lost <= ty.atk + 8 + 100, `伤害 + 出血 100：${lost}`);
  // AI：同区的 Helumica 血少，2 区的柯尔特血多 → 走向柯尔特
  const g = field([{ id: "rat_tyrant", lv: 1, zone: 1 }]);
  const t2 = g.E("rat_tyrant"), k2 = g.P("kolt"), h2 = g.P("helu");
  flesh(k2, 300, 300); flesh(h2, 40, 300);
  k2.zone = 2; h2.zone = 1;
  g.c.ratfolkSweep();   // 改过的血量先记下来（不是「降到」）
  g.S.combatPhase = "enemy";
  const p = g.c.EnemyAI.plan(t2);
  assert.equal(p.ai.kind, "move"); assert.equal(p.ai.dest, 2);
  assert.equal(p.ai.target, k2);
});

test("暴虐猎手·协助：冲到目标所在区连打三次 0.5×atk 物理，每一击都出血（10% → 5% → 2.5%），让所有狂鼠进入狂暴（失衡中的除外）", () => {
  const f = field([{ id: "rat_tyrant", lv: 1, zone: 2 }, { id: "rat_biter", lv: 1, zone: 1 }, { id: "rat_lurker", lv: 1, zone: 2 }]);
  const ty = f.E("rat_tyrant"), b = f.E("rat_biter"), lu = f.E("rat_lurker"), k = f.P("kolt");
  flesh(k, 1000); f.P("helu").zone = 2;
  lu.def = 0; lu.stunned = true;
  assert.equal(f.c.enemyAssistSkillId(ty), "en_rat_tyrant_assist");
  f.S.combatPhase = "enemy";
  f.c.dealBreak(k, k.def, "physical", [], "测试", { by: b });
  f.c.BattleSim.resolveQueues(noBlock);
  assert.equal(ty.zone, 1, "冲到目标所在区");
  assert.equal(1000 - f.c.totalHp(k), 3 * Math.floor(ty.atk * 0.5) + 100 + 50 + 25);
  assert.match(f.logs(), /出血 100 \+ 50 \+ 25 = 175（真实伤害）/);
  assert.equal(ty.self, "frenzy"); assert.equal(b.self, "frenzy");
  assert.equal(lu.self, "none", "失衡中的进不去");
  assert.match(f.logs(), /暴虐猎手协助：所有狂鼠进入狂暴（失衡中的 1 只除外）/);
  const T = get(f.c, "RAT_CFG").tyrant;
  assert.deepEqual([T.assistHits, T.assistMult, T.execBlock], [3, 0.5, 5]);
});

test("暴虐猎手·协助优先权：其他狂鼠都没狂暴、它又能协助时，一定由它来协助（ATK 再高的也让给它）；有别的狂鼠狂暴了、或者它够不着，照常挑 ATK 最高的", () => {
  const setup = (zoneMode) => {
    const f = field([{ id: "rat_tyrant", lv: 1, zone: 1 }, { id: "rat_biter", lv: 1, zone: 1 }, { id: "rat_lurker", lv: 1, zone: 1 }], { zoneMode });
    if (zoneMode) f.S.zoneMode = zoneMode;
    const ty = f.E("rat_tyrant"), b = f.E("rat_biter"), lu = f.E("rat_lurker"), k = f.P("kolt");
    b.atk = b.personalAtk = 99;   // 平时协助的人挑 ATK 最高的：撕咬者
    return { f, ty, b, lu, k, pick: () => f.c.EnemyAI.pickAssister(f.c.eligibleAssisters(lu, k), k) };
  };
  const s = setup();
  assert.equal(s.pick(), s.ty.id, "其他狂鼠都没狂暴：猎手");
  s.f.c.enterFrenzy(s.ty, []);
  assert.equal(s.pick(), s.ty.id, "猎手自己狂暴不算「其他狂鼠」");
  s.f.c.enterFrenzy(s.lu, []);
  assert.equal(s.pick(), s.b.id, "潜藏者狂暴了：照常挑 ATK 最高的撕咬者");
  const far = setup(3);
  far.ty.zone = 3; far.k.zone = 1; far.b.zone = 1;
  assert.equal(far.pick(), far.b.id, "猎手隔两区够不着：不算能协助");
  // 一整套：潜藏者打出失衡 → 猎手协助 → 所有狂鼠狂暴
  const w = setup();
  flesh(w.k, 1000); w.k.def = 1; w.f.P("helu").zone = 2;
  use(w.f, w.lu, "en_rat_lurker_bite", w.k);
  assert.match(w.f.logs(), /【暴虐猎手】协助/);
  assert.ok([w.ty, w.b, w.lu].every(u => u.self === "frenzy"));
});

test("暴虐猎手·斩杀：敌人的血量降到「普通攻击掷最小值也一定能打死」时（骰子取 1、出血照算），免费移动过去免费普攻一次，打进濒死，击杀后进入狂暴", () => {
  const f = field([{ id: "rat_tyrant", lv: 1, zone: 2 }]);
  const ty = f.E("rat_tyrant"), k = f.P("kolt"), h = f.P("helu");
  h.zone = 2;   // 柯尔特身边没人能协助格挡
  flesh(k, 30, 30); f.c.ratfolkSweep();
  // 掷最小值：ATK + 1（1d8 取 1），打中肉体还剩血就再出血 30 × 10% = 3
  const kill = Math.floor(f.c.effectiveAtk(ty, f.S.units)) + 1 + 3;
  const ap = ty.ap, bonus = ty.bonus;
  k.layers[0].current = kill + 1;
  f.c.ratfolkSweep();
  assert.equal(ty.zone, 2, "掷最小值打不死：不斩杀");
  assert.doesNotMatch(f.logs(), /斩杀/);
  k.layers[0].current = kill;
  f.c.ratfolkSweep();
  assert.equal(ty.zone, 1, "免费移动到柯尔特那一区");
  assert.deepEqual([ty.ap, ty.bonus], [ap, bonus], "移动、普攻都不花行动点 / 附赠");
  assert.equal(k.dying, true, "打进濒死（就算杀死）");
  assert.equal(ty.self, "frenzy", "击杀后进入狂暴");
  assert.match(f.logs(), /【暴虐猎手】斩杀\n\s+柯尔特 的血量挡不住掷最小值的一击/);
  assert.match(f.logs(), /暴虐猎手 进入狂暴（击杀柯尔特）/);
});

test("暴虐猎手·斩杀：任何原因的掉血都算（回合结束的腐蚀）；每轮不限次数；血量没降、靠坚毅生命站着、躲藏 / 被嘲讽时不斩", () => {
  // 回合结束的腐蚀把柯尔特打到门槛以下：回合交界结算完就斩
  const f = field([{ id: "rat_tyrant", lv: 1, zone: 2 }]);
  const ty = f.E("rat_tyrant"), k = f.P("kolt"), h = f.P("helu");
  h.zone = 2;
  const kill = Math.floor(f.c.effectiveAtk(ty, f.S.units)) + 1 + 3;
  flesh(k, kill + 2, 30); k.statuses.corr = true;
  f.c.endPlayerTurn();
  assert.ok(!k.dying, "敌人回合开始：还没掉血");
  f.c.endEnemyTurn();
  f.c.BattleSim.resolveQueues(noBlock);
  assert.equal(k.dying, true, "腐蚀之后被斩杀");
  assert.match(f.logs(), /柯尔特 腐蚀[\s\S]*【暴虐猎手】斩杀/);
  // 每轮不限次数：两个人同时掉到门槛以下，斩两次（来回走）
  const g = field([{ id: "rat_tyrant", lv: 1, zone: 2 }]);
  const t2 = g.E("rat_tyrant"), k2 = g.P("kolt"), h2 = g.P("helu");
  k2.zone = 1; h2.zone = 2;
  flesh(k2, 30, 30); flesh(h2, 30, 30); g.c.ratfolkSweep();
  k2.layers[0].current = 3; h2.layers[0].current = 3;
  g.c.ratfolkSweep();
  g.c.BattleSim.resolveQueues(noBlock);
  assert.equal(k2.dying, true); assert.equal(h2.dying, true);
  assert.equal(count(g.logs(), /【暴虐猎手】斩杀/), 2);
  // 不斩的情况
  const no = (setup) => {
    const e = field([{ id: "rat_tyrant", lv: 1, zone: 2 }]);
    const t3 = e.E("rat_tyrant"), k3 = e.P("kolt");
    e.P("helu").zone = 2;
    flesh(k3, 30, 30); e.c.ratfolkSweep();
    setup(e, t3, k3);
    e.c.ratfolkSweep();
    return { zone: t3.zone, logs: e.logs(), k3 };
  };
  let r = no((e, t3, k3) => { k3.layers[0].current = 3; k3.statuses.hide = true; });
  assert.equal(r.zone, 2, "躲藏中选不中"); assert.doesNotMatch(r.logs, /斩杀/);
  r = no((e, t3, k3) => { k3.layers[0].current = 3; t3.tauntTo = e.P("helu").id; });
  assert.equal(r.zone, 2, "被嘲讽只能打嘲讽它的人"); assert.doesNotMatch(r.logs, /斩杀/);
  r = no((e, t3, k3) => { flesh(k3, 0, 30); k3.upOnShp = true; k3.shp = 2; k3.shpMax = 20; });
  assert.doesNotMatch(r.logs, /斩杀/, "靠坚毅生命站着的不看（不能从这里看出坚毅还剩多少）");
  // 血量本来就低、这次没有降：不算「降到」
  const e = field([{ id: "rat_tyrant", lv: 1, zone: 2 }]);
  const k4 = e.P("kolt"); e.P("helu").zone = 2;
  flesh(k4, 3, 30); e.c.ratfolkSweep();   // 先记下 3（比开战时低：这一下就斩了）
  assert.equal(k4.dying, true);
  const e2 = field([{ id: "rat_tyrant", lv: 1, zone: 2 }]);
  const k5 = e2.P("kolt"); e2.P("helu").zone = 2;
  e2.S.ratSeen = null;   // 还没记过：这次只记下来
  flesh(k5, 3, 30);
  e2.c.ratfolkSweep();
  assert.ok(!k5.dying, "第一次看到的血量只记下来");
  e2.c.ratfolkSweep();
  assert.ok(!k5.dying, "血量没再降：不斩");
});

test("暴虐猎手·斩杀：克制和减伤照算（物理打装甲 −25%、咬牙坚持 −50%），别的阵营的敌人也斩", () => {
  // 咬牙坚持：伤害减半，门槛跟着降
  const f = field([{ id: "rat_tyrant", lv: 1, zone: 2 }]);
  const ty = f.E("rat_tyrant"), k = f.P("kolt");
  f.P("helu").zone = 2;
  flesh(k, 30, 30); f.c.ratfolkSweep();
  k.resources.gritTurn = true;
  const base = Math.floor(f.c.effectiveAtk(ty, f.S.units)) + 1;
  k.layers[0].current = base + 3;   // 不减伤就能打死
  f.c.ratfolkSweep();
  assert.equal(ty.zone, 2, "咬牙坚持：打不死，不斩");
  k.layers[0].current = Math.floor(base * 0.5) + 3;
  f.c.ratfolkSweep();
  assert.equal(k.dying, true, "减半之后也打得死：斩");
  // 别的阵营：机器人看守（剑）的装甲，物理打装甲 −25%（装甲层没有出血）
  const g = field([{ id: "rat_tyrant", lv: 1, zone: 2 }, { id: "guard_sword", lv: 1, zone: 2 }]);
  const t2 = g.E("rat_tyrant"), gd = g.E("guard_sword");
  layers(gd, [["armor", 30, 30]]); g.c.ratfolkSweep();
  const hit = Math.floor((Math.floor(g.c.effectiveAtk(t2, g.S.units)) + 1) * 0.75);
  gd.layers[0].current = hit + 1;
  g.c.ratfolkSweep();
  assert.ok(!gd.dead, "装甲减伤：打不死");
  gd.layers[0].current = hit;
  g.c.ratfolkSweep();
  assert.equal(gd.dead, true, "斩杀别的阵营的敌人");
  assert.equal(t2.self, "frenzy");
});

test("暴虐猎手·斩杀：这一击可以协助格挡，格挡率 +5%（落下以后恢复）", () => {
  const f = field([{ id: "rat_tyrant", lv: 1, zone: 2 }]);
  const ty = f.E("rat_tyrant"), k = f.P("kolt"), h = f.P("helu");
  h.zone = 1;   // Helumica 和柯尔特同区，能协助格挡
  flesh(k, 30, 30); f.c.ratfolkSweep();
  const base = f.c.finalBlockChance(h, ty, k);
  k.layers[0].current = 3;
  f.c.ratfolkSweep();
  const job = (f.S.blockQueue || [])[0];
  assert.ok(job && job.attackerId === ty.id && job.opt.flags.ratExec, "进了协助格挡的队列");
  assert.equal(f.c.finalBlockChance(h, ty, k), Math.min(100, base + 5));
  f.c.BattleSim.resolveQueues(noBlock);
  assert.equal(k.dying, true);
  assert.equal(f.c.finalBlockChance(h, ty, k), base, "落下以后恢复");
  // 普通攻击不加
  const g = field([{ id: "rat_tyrant", lv: 1, zone: 1 }]);
  const t2 = g.E("rat_tyrant"), k2 = g.P("kolt"), h2 = g.P("helu");
  const b2 = g.c.finalBlockChance(h2, t2, k2);
  g.S.combatPhase = "enemy"; t2.ap = 1; g.S.attackerId = t2.id; g.S.targetId = k2.id;
  g.c.runSkill("en_rat_tyrant_bite");
  assert.ok((g.S.blockQueue || []).length, "等格挡");
  assert.equal(g.c.finalBlockChance(h2, t2, k2), b2);
});

test("暴虐猎手：普通攻击打死人也进入狂暴；狂暴时打出的出血伤害等量为自己回血，不狂暴不回", () => {
  const f = field([{ id: "rat_tyrant", lv: 1, zone: 1 }]);
  const ty = f.E("rat_tyrant"), k = f.P("kolt"), h = f.P("helu");
  h.zone = 2;
  flesh(k, 1000);
  const max = f.c.totalMaxHp(ty);
  ty.layers[0].current = max - 30;
  use(f, ty, "en_rat_tyrant_bite", k);
  assert.equal(f.c.totalHp(ty), max - 30, "不狂暴：出血不回血");
  f.c.enterFrenzy(ty, []);
  ty.ap = 1;
  use(f, ty, "en_rat_tyrant_bite", k);
  assert.equal(f.c.totalHp(ty), max, "狂暴：出血 100 等量回血（回满为止）");
  assert.match(f.logs(), /暴虐猎手 狂暴：打出的出血 100 等量回血，恢复 30/);
  // 普通攻击打死人：进入狂暴
  const g = field([{ id: "rat_tyrant", lv: 1, zone: 1 }]);
  const t2 = g.E("rat_tyrant"), k2 = g.P("kolt");
  g.P("helu").zone = 2;
  flesh(k2, 2, 30);
  use(g, t2, "en_rat_tyrant_bite", k2);
  assert.equal(k2.dying, true);
  assert.equal(t2.self, "frenzy");
});

/* ================= 掉落、图鉴、联机 ================= */

test("掉落：狂鼠随便掉一些废料，杂兵少、精英多", () => {
  const c = H.load();
  const T = get(c, "ENEMY_DROPS");
  KITS.forEach(k => assert.deepEqual(Object.keys(T[k]), ["cm_scrap"], k));
  assert.ok(T.rat_lurker.cm_scrap < T.rat_plague.cm_scrap && T.rat_biter.cm_scrap < T.rat_tyrant.cm_scrap);
  ["rat_lurker", "rat_biter"].forEach(k => assert.ok(T[k].cm_scrap >= 0.1 && T[k].cm_scrap <= 0.35, k));
  ["rat_plague", "rat_tyrant"].forEach(k => assert.ok(T[k].cm_scrap >= 1 && T[k].cm_scrap <= 2.5, k));
  assert.deepEqual(plain(c.rollEnemyDrops(KITS, () => 0)), [{ id: "cm_scrap", qty: 1 + 1 + 2 + 2 }]);
  assert.match(c.ITEM_CATALOG.cm_scrap.hint, /狂鼠/);
});

test("图鉴：每个兵种写了招式、狂暴的条件和效果、阵营被动「狂潮」；种族栏写鼠类人·鼠和环境适应；狂暴的数字和 FRENZY 一致", () => {
  const c = H.load();
  const T = get(c, "BESTIARY_TEXT"), F = get(c, "FRENZY");
  KITS.forEach(k => {
    const t = T[k], all = t.abilities.join("\n");
    assert.ok(t.move && t.abilities.length >= 4, k);
    assert.match(all, /^狂暴：/m, k + "：狂暴的条件");
    assert.match(all, /^狂暴（自我效果）：/m, k + "：狂暴的效果");
    assert.match(all, /^狂潮（狂鼠的阵营被动）：/m, k + "：阵营被动");
    assert.equal(c.bestiaryRaceText(k), "鼠类人·鼠");
    assert.match(c.bestiaryRacePerks(k).join(), /环境适应/);
    const e = c.bestiaryEntries().find(x => x.kit === k);
    assert.deepEqual([e.faction, e.regions.join()], ["狂鼠", "下水道"]);
  });
  assert.match(T.rat_lurker.abilities.join(), /开战时处于躲藏/);
  assert.match(T.rat_lurker.abilities.join(), /逃跑/);
  assert.match(T.rat_plague.abilities.join(), /感染撕扯[\s\S]*感染喷洒[\s\S]*所有敌人都处于腐蚀时进入/);
  assert.match(T.rat_tyrant.abilities.join(), /斩杀[\s\S]*协助（优先权）[\s\S]*击杀敌人后进入/);
  const fx = get(c, "RATFOLK_FRENZY_TEXT");
  assert.equal(F.atkPerLevel, 1); assert.match(fx, /ATK \+ 等级/);
  assert.ok(fx.includes(`击破 +${F.breakBonus}`) && fx.includes(`−${Math.round(F.takenCut * 100)}%`) && fx.includes(`架势上限 −${F.postureCut}`));
  assert.equal(F.freeMoves, 1); assert.match(fx, /免费移动一次/);
  assert.equal(F.tideShare, 0.5); assert.match(get(c, "RATFOLK_TIDE_TEXT"), /不少于一半/);
});

test("联机：狂鼠照常下发（种族、躲藏、狂暴、区域），斩杀 / 逃跑的内部记号和坚毅数值都不发", () => {
  const c = H.load();
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, "online-view.js"), "utf8"), c, { filename: "online-view.js" });
  c.BattleSim.setup({ party: ["kolt", "helu"], encounter: { name: "下水道", region: "下水道", zoneMode: 2, enemies: KITS.map(k => ({ preset: k, zone: 2 })) }, level: 3, seed: "RAT-ONLINE" });
  c.startCombat();
  const S = c.S.state;
  S.units.filter(u => u.isPlayer).forEach(u => { u.shp = 732911; u.shpMax = 827319; });
  const ty = S.units.find(u => u.kit === "rat_tyrant");
  ty.ratExecBlock = 5;
  S.ratFlee = [{ id: "x", by: "y", zone: 1 }];
  c.enterFrenzy(S.units.find(u => u.kit === "rat_biter"), []);
  const view = c.OnlineView.projectState(S);
  const txt = JSON.stringify(view);
  assert.doesNotMatch(txt, /732911|827319/, "坚毅数值不发");
  assert.doesNotMatch(txt, /ratSeen|ratFlee|ratExecBlock/, "内部记号不发");
  assert.deepEqual([view.region, view.scene], ["下水道", "tunnel"]);
  const lu = view.units.find(u => u.kit === "rat_lurker"), bi = view.units.find(u => u.kit === "rat_biter");
  assert.deepEqual(plain(lu.race), { race: "鼠类人", branch: "鼠" });
  assert.equal(lu.statuses.hide, true, "躲藏照常发");
  assert.equal(bi.self, "frenzy");
  assert.match(bi.display.status, /狂暴/);
});
