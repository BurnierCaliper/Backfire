// 下水道的第二个阵营「下水道维护」和杂兵「下水道清扫机」（docs/sewer-maintenance.md 第 1、2、3 节，issue #279）
// 两个触灵精英（维护员、清扫员）和「狂鼠 ↔ 下水道维护」的三方混战（下水道维护（二），#281）在 tests/sewer-elites.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("vm");
const H = require("./headless");

const get = (c, expr) => vm.runInContext(expr, c);
const plain = x => JSON.parse(JSON.stringify(x));
const noBlock = { pickBlocker: () => null, pickAssister: l => l[0].id };
const layers = (u, ls) => { u.layers = ls.map((l, i) => ({ type: l[0], current: l[1], max: l[2] != null ? l[2] : l[1], inner: i === ls.length - 1 })); };
const RAT_KITS = ["rat_lurker", "rat_biter", "rat_plague", "rat_tyrant"];
/** 下水道维护的兵种（两个触灵精英是 #281 加的，测试在 tests/sewer-elites.test.js） */
const SEWER_KITS = ["sewer_sweeper", "sewer_keeper", "sewer_cleaner"];
/** 和下水道维护是一伙的（巨人方 + 自己） */
const FRIENDS = ["安保", "警卫队", "镇压队", "下水道维护"];

/** 一场摆好的战斗（个体值不波动），已开战，我方回合。enemies：[{ id, lv, zone }] */
function field(enemies, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: opt.party || ["kolt", "helu"], enemies, seed: opt.seed || "SEWER-MAINT", zoneMode: opt.zoneMode || 2 });
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

/* ================= 数值、登记 ================= */

test("数值：1 / 5 / 10 / 15 / 20 级（2 人队）的护盾 / 装甲、架势、ATK 和文档第 2 节的表一致；图鉴显示的一样", () => {
  const c = H.load();
  get(c, "ENEMY_IV.off++");   // 个体值不波动
  // [护盾, 装甲, 架势, ATK]
  const TABLE = { 1: [4, 1, 1, 4], 5: [12, 1, 3, 6], 10: [22, 1, 3, 9], 15: [32, 1, 3, 11], 20: [42, 1, 3, 14] };
  Object.keys(TABLE).forEach(lvs => {
    const lv = Number(lvs), [sh, ar, def, atk] = TABLE[lvs];
    const u = c.spawnEnemyGroup("sewer_sweeper", lv, 2, 2)[0];
    assert.equal(u.name, "下水道清扫机");
    assert.deepEqual(plain(u.layers.map(l => [l.type, l.max])), [["shield", sh], ["armor", ar]], `${lv} 级：护盾在外、装甲在内，两层原样保留`);
    assert.deepEqual([u.def, u.defMax, u.atk], [def, def, atk], `${lv} 级架势 / ATK`);
    const st = c.bestiaryStats("sewer_sweeper", lv, 2);
    assert.deepEqual([plain(st.layers.map(l => [l.type, l.hp])), st.def, st.atk], [[["shield", sh], ["armor", ar]], def, atk], `${lv} 级图鉴`);
  });
});

test("数值：血量照空投蜂群（护盾 4 + 2×(等级−1)、装甲 1，3、4 人队按 scaleHp 放大；架势 1 + ⌊等级/2⌋ 最多 3），ATK 照机器人看守（剑）；远程 1d4 谐波；数值在配置表里", () => {
  const c = H.load();
  const build = (id, lv, p) => c.enemyPresets().find(x => x.id === id).build(lv, p);
  for (let lv = 1; lv <= 25; lv++) for (const p of [2, 3, 4]) {
    const u = build("sewer_sweeper", lv, p), swarm = build("swarm", lv, p), guard = build("guard_sword", lv, p);
    const tag = `${lv} 级 ${p} 人队`;
    assert.deepEqual(plain(u.layers.map(l => [l.type, l.max])), plain(swarm.layers.map(l => [l.type, l.max])), tag + "：血量同空投蜂群");
    assert.equal(u.layers[0].max, c.scaleHp(4 + 2 * (lv - 1), p), tag);
    assert.equal(u.defMax, Math.min(3, 1 + Math.floor(lv / 2)), tag + "：架势最多 3");
    assert.equal(u.defMax, swarm.defMax, tag);
    assert.equal(u.atk, 4 + Math.floor(lv / 2), tag);
    assert.equal(u.atk, guard.atk, tag + "：ATK 同机器人看守（剑）");
    assert.deepEqual([u.range, u.flying, u.suggest.element, plain(u.suggest.dice)], ["ranged", false, "harmonic", [1, 4]], tag);
  }
  assert.deepEqual(plain(get(c, "SEWER_STATS").sweeper), { shield: [4, 2], armor: 1, def: 1, defCap: 3, atk: 4, dice: 4 });
  assert.deepEqual(plain(get(c, "SEWER_CFG").sweeper), { shotMult: 1, shotBreak: 1, blastMult: 1, blastBreak: 1 });
});

test("登记：杂兵、1 枚代币 3 只（照空投蜂群的 group: 3）、不会飞；阵营「下水道维护」、只出没在下水道；机械、没有种族", () => {
  const c = H.load();
  const info = get(c, "ENEMY_INFO").sewer_sweeper;
  assert.deepEqual([info.faction, info.regions.join(), info.tokens, info.group], ["下水道维护", "下水道", 1, 3]);
  assert.equal(info.race, undefined); assert.equal(info.races, undefined);
  assert.equal(get(c, "ENEMY_INFO").swarm.group, info.group, "和空投蜂群一样 3 只一组");
  assert.equal(get(c, "ENEMY_RANK").sewer_sweeper, "minion");
  assert.equal(get(c, "SEWER_FACTION"), "下水道维护");
  // 抽遭遇：一枚代币 3 只；摆上场是 3 只各自独立的清扫机，都不会飞
  // （#281 起下水道维护的池子里还有两个触灵精英：这里照 rollEncounter 的做法只从清扫机里按代币抽，精英混着出的在 tests/sewer-elites.test.js）
  c.S.RNG.install("SWEEPER-ENC");
  const enc = c.finishEncounter({ name: "下水道·下水道维护", region: "下水道", faction: "下水道维护", tier: "normal", tokens: 4, mixed: false,
    enemies: c.pickByTokens(["sewer_sweeper"], 4) }, { zoneMode: 2 });
  assert.equal(enc.name, "下水道·下水道维护");
  assert.deepEqual(plain(enc.enemies.map(e => [e.preset, e.count])), [["sewer_sweeper", 3], ["sewer_sweeper", 3], ["sewer_sweeper", 3], ["sewer_sweeper", 3]]);
  assert.equal(enc.tier, "normal", "杂兵的遭遇");
  c.BattleSim.setup({ party: ["kolt", "helu"], encounter: enc, level: 5, seed: "SWEEPER-FIGHT" });
  const foes = c.S.state.units.filter(u => !u.isPlayer && !u.hidden);
  assert.equal(foes.length, 12, "4 枚代币 = 12 只");
  assert.equal(new Set(foes.map(u => u.id)).size, 12);
  foes.forEach(u => {
    assert.equal(u.kit, "sewer_sweeper");
    assert.equal(u.flying, false, "不会飞行");
    assert.equal(c.raceText(u), "", "机械：没有种族");
    assert.equal(c.isMechanicalUnit(u), true, "机械（超充能电池的机械护盾照样给它）");
  });
  assert.deepEqual([c.S.state.region, c.S.state.scene], ["下水道", "tunnel"]);
});

/* ================= 阵营、区域 ================= */

test("阵营：和巨人方（安保、警卫队、镇压队，还有「巨人」「触灵」）友好——不互相敌对、同一组 ALLIED_FACTIONS；和狂鼠、盗匪、沙灵、沙漠生物、异星生物等其他阵营都敌对", () => {
  const c = H.load();
  const info = get(c, "ENEMY_INFO");
  const sw = { kit: "sewer_sweeper", isPlayer: false };
  const kitOf = f => Object.keys(info).find(k => info[k].faction === f);
  FRIENDS.forEach(f => {
    const u = { kit: kitOf(f), isPlayer: false };
    assert.equal(c.hostileTo(sw, u), false, f); assert.equal(c.hostileTo(u, sw), false, f);
  });
  // 「巨人」阵营也是巨人方：友好，但不在同伙组里（HOSTILE_EXCEPT_FRIENDS，作者 10/22「一切巨人方友好」）
  // 「触灵」阵营也友好（作者 10/22）；野生、古代造物等照旧敌对
  ["巨人", "触灵"].forEach(f => {
    const u = { kit: kitOf(f), isPlayer: false };
    assert.equal(c.hostileTo(sw, u), false, f); assert.equal(c.hostileTo(u, sw), false, f);
  });
  const others = [...new Set(Object.values(info).map(i => i.faction))].filter(f => !FRIENDS.includes(f) && !["中立生物", "巨人", "触灵"].includes(f));
  ["野生", "古代造物"].forEach(f => assert.ok(others.includes(f), f));
  ["狂鼠", "盗匪", "沙灵", "沙漠生物", "异星生物"].forEach(f => assert.ok(others.includes(f), f));
  others.forEach(f => {
    const u = { kit: kitOf(f), isPlayer: false };
    assert.equal(c.hostileTo(sw, u), true, f); assert.equal(c.hostileTo(u, sw), true, f);
  });
  assert.equal(c.hostileTo(sw, { kit: "kolt", isPlayer: true }), true, "我方");
  assert.equal(c.hostileTo(sw, { kit: "dust_bug", isPlayer: false }), false, "中立生物谁都不当它是敌人");
  assert.ok(plain(get(c, "HOSTILE_EXCEPT_ALLIES")).includes("下水道维护"));
  assert.deepEqual([...c.alliesOf("下水道维护")].sort(), [...FRIENDS].sort());
  assert.equal(get(c, "ALLIED_FACTIONS").filter(g => g.includes("下水道维护")).length, 1, "加进安保、警卫队、镇压队那一组");
  ["安保", "警卫队", "镇压队"].forEach(f => assert.ok(c.alliesOf(f).includes("下水道维护"), f));
  // 原来的阵营关系不变
  assert.equal(c.hostileTo({ kit: "thug_knife" }, { kit: "guard_sword" }), true);
  assert.equal(c.hostileTo({ kit: "thug_knife" }, { kit: "sand_beast" }), false);
  assert.equal(c.hostileTo({ kit: "guard_sword" }, { kit: "captain_ox" }), false);
});

test("阵营：混编概率照镇压队的做法给 15%（FACTION_MIX_CHANCE）；抽到安保 / 警卫队时下水道维护也只有 15% 加进来", () => {
  const c = H.load();
  assert.equal(get(c, "FACTION_MIX_CHANCE")["下水道维护"], 0.15);
  assert.equal(get(c, "FACTION_MIX_CHANCE")["镇压队"], 0.15, "镇压队的照旧");
  c.Math.random = c.makeRng("SEWER-MIX");
  const N = 4000;
  let mixed = 0, withSec = 0;
  for (let i = 0; i < N; i++) {
    const allow = c.encounterFactions("下水道维护");
    assert.ok(allow.includes("下水道维护"));
    if (allow.length > 1) { mixed++; assert.deepEqual([...allow].sort(), [...FRIENDS].sort(), "混编是整个同伙一起来"); }
    if (c.encounterFactions("安保").includes("下水道维护")) withSec++;
  }
  assert.ok(Math.abs(mixed / N - 0.15) < 0.03, `混编比例 ≈ 15%，实际 ${(mixed / N * 100).toFixed(1)}%`);
  assert.ok(Math.abs(withSec / N - 0.15) < 0.03, `实际 ${(withSec / N * 100).toFixed(1)}%`);
});

test("阵营（场上）：清扫机和狂鼠互相当敌人，和安保不互相当敌人；同伙打出的失衡它能接协助，狂鼠打出的不接", () => {
  const f = field([{ id: "sewer_sweeper", lv: 3, zone: 2 }, { id: "rat_biter", lv: 1, zone: 2 }, { id: "guard_sword", lv: 1, zone: 2 }]);
  const sw = f.E("sewer_sweeper"), rat = f.E("rat_biter"), g = f.E("guard_sword"), k = f.P("kolt");
  assert.ok(f.c.hostilesOf(sw).includes(rat) && f.c.hostilesOf(rat).includes(sw));
  assert.ok(!f.c.hostilesOf(sw).includes(g) && !f.c.hostilesOf(g).includes(sw));
  assert.ok(f.c.hostilesOf(sw).includes(k));
  assert.ok(f.c.eligibleAssisters(g, k).includes(sw), "安保打出的失衡：清扫机可以协助");
  assert.ok(!f.c.eligibleAssisters(rat, k).includes(sw), "狂鼠打出的失衡：清扫机和它敌对，不接");
  assert.ok(f.c.eligibleAssisters(null, k).includes(sw));
});

test("下水道：rollEncounter({ region: \"下水道\" }) 能抽到狂鼠或者下水道维护，各自成一场；巨人城和别的区域、「不分地区」的遭遇战都抽不到清扫机", () => {
  const c = H.load();
  c.S.RNG.install("SEWER-279");
  assert.ok(c.regionPool("下水道").includes("sewer_sweeper"));
  assert.deepEqual(plain(c.regionFactions("下水道")).sort(), ["下水道维护", "狂鼠"].sort());
  const seen = {};
  for (let i = 0; i < 400; i++) {
    const enc = c.rollEncounter({ region: "下水道" });
    seen[enc.name] = (seen[enc.name] || 0) + 1;
    // #281 起下水道维护还有两个触灵精英，三区制的遭遇有 15% 变成「狂鼠 ↔ 下水道维护」的三方混战（tests/sewer-elites.test.js）
    if (enc.name === "下水道·下水道维护") assert.ok(enc.enemies.every(e => SEWER_KITS.includes(e.preset)), JSON.stringify(enc.enemies));
    if (enc.name === "下水道·狂鼠") assert.ok(enc.enemies.every(e => RAT_KITS.includes(e.preset)), JSON.stringify(enc.enemies));
    assert.ok(/^下水道·(狂鼠|下水道维护|混战|三方混战)$/.test(enc.name), enc.name);
  }
  assert.ok(seen["下水道·下水道维护"] > 100 && seen["下水道·狂鼠"] > 100, JSON.stringify(seen));
  // 混编掷中了也只有下水道维护自己：下水道里没有安保 / 警卫队 / 镇压队
  const info = get(c, "ENEMY_INFO");
  assert.deepEqual(plain(c.regionPool("下水道").filter(k => FRIENDS.includes(info[k].faction))), SEWER_KITS);
  ["外城区", "巨人城", "第一采矿场", "第二采矿场", "第三采矿场", "沙漠", "天网设施"].forEach(r => {
    assert.ok(!c.regionPool(r).includes("sewer_sweeper"), r);
    assert.ok(!c.regionFactions(r).includes("下水道维护"), r);
  });
  assert.ok(!c.regionPool(null).includes("sewer_sweeper"), "只出没在专门区域里的不进「不分地区」的遭遇战");
  // 战斗模板（跑团主持人）也能摆
  const t = c.battleTemplateNormalize({ name: "下水道", board: 2, enemies: [{ preset: "sewer_sweeper", level: 4, zone: 2 }] });
  c.BattleSim.setup({ party: ["kolt", "helu"], encounter: c.battleTemplateToEncounter(t), seed: "SWEEPER-TPL" });
  assert.deepEqual(plain(c.S.state.units.filter(u => !u.isPlayer).map(u => [u.kit, u.level, u.zone])), [["sewer_sweeper", 4, 2]]);
});

/* ================= 移动、行动 ================= */

test("行动：还有敌人没有共振时，花行动点给一个没有共振的敌人施加共振（只上状态、不造成伤害、不能协助格挡；先挑够得着的）；够不着就主动远离；所有敌人都有共振了才远程 1×atk + 1d4 谐波、1 击破", () => {
  const f = field([{ id: "sewer_sweeper", lv: 5, zone: 2 }], { zoneMode: 3 });
  const sw = f.E("sewer_sweeper"), k = f.P("kolt"), h = f.P("helu");
  layers(k, [["spirit", 300]]); layers(h, [["spirit", 200]]);   // 谐波打星灵不加不减
  k.zone = 2; h.zone = 1;   // 柯尔特和清扫机同区（远程够不着），Helumica 隔一区
  const hp = u => f.c.totalHp(u);
  const plan = () => { f.S.combatPhase = "enemy"; sw.ap = 1; return f.c.EnemyAI.plan(sw); };
  const act = () => { const p = plan(); p.thunk(); f.c.BattleSim.resolveQueues(noBlock); return p; };
  // 1：柯尔特血量多但够不着，先给够得着的 Helumica 上共振
  let p = act();
  assert.equal(p.meta.skillId, "en_sweeper_reso");
  assert.equal(p.meta.targetId, h.id);
  assert.deepEqual([h.statuses.reso, k.statuses.reso], [true, false]);
  assert.deepEqual([hp(h), h.def], [200, h.defMax], "只上状态：不造成伤害、不击破");
  assert.equal(sw.ap, 0, "花了行动点");
  assert.match(f.logs(), /下水道清扫机 给 Helumica 施加共振/);
  // 2：只剩柯尔特没有共振，他就在同区：主动远离（退到没有敌人的 3 区），这一步不上共振
  p = act();
  assert.equal(p.ai.kind, "move");
  assert.equal(sw.zone, 3);
  assert.equal(k.statuses.reso, false);
  // 3：柯尔特隔一区了，给他上共振。同区的 Helumica 有附赠也不会弹协助格挡（不是攻击）
  h.zone = 2; h.bonus = 1;
  p = plan();
  assert.equal(p.meta.skillId, "en_sweeper_reso");
  assert.equal(p.meta.targetId, k.id);
  p.thunk();
  assert.equal((f.S.blockQueue || []).length, 0, "施加共振不能协助格挡");
  f.c.BattleSim.resolveQueues(noBlock);
  assert.deepEqual([k.statuses.reso, hp(k), k.def], [true, 300, k.defMax]);
  // 4：看得见的敌人都有共振了：谐波射击（打血量多的柯尔特）
  p = plan();
  assert.equal(p.meta.skillId, "en_sweeper_shot");
  assert.equal(p.meta.targetId, k.id);
  p.thunk(); f.c.BattleSim.resolveQueues(noBlock);
  const lost = 300 - hp(k);
  assert.ok(lost >= sw.atk + 1 && lost <= sw.atk + 4, `1×atk + 1d4 谐波：${lost}（atk ${sw.atk}）`);
  assert.equal(k.def, k.defMax - 1, "1 击破");
  assert.ok(hp(h) < 200, "共振照常分享伤害");
});

test("行动：施加共振的射程照一般远程（同区、隔两区、隔着危墙都够不着）；已经有共振的不再上；躲藏的、倒地的看不见，不算「没有共振的敌人」", () => {
  const f = field([{ id: "sewer_sweeper", lv: 3, zone: 2 }, { id: "rat_lurker", lv: 1, zone: 1 }], { zoneMode: 3 });
  const sw = f.E("sewer_sweeper"), lu = f.E("rat_lurker"), k = f.P("kolt"), h = f.P("helu");
  const use = (t) => { f.S.combatPhase = "enemy"; sw.ap = 1; f.S.attackerId = sw.id; f.S.targetId = t.id; f.c.runSkill("en_sweeper_reso"); f.c.BattleSim.resolveQueues(noBlock); };
  k.zone = 2; use(k);
  assert.equal(k.statuses.reso, false, "同区够不着");
  assert.match(f.logs(), /施加共振是远距离，够不到距离 0 的 柯尔特/);
  sw.zone = 3; k.zone = 1; use(k);
  assert.equal(k.statuses.reso, false, "隔两区够不着");
  sw.zone = 2; f.S.gaps = f.S.gaps || {}; f.S.gaps["1-2"] = { type: "wall", hp: 10, maxHp: 10 };
  use(k);
  assert.equal(k.statuses.reso, false, "隔着危墙够不着");
  delete f.S.gaps["1-2"];
  use(k);
  assert.equal(k.statuses.reso, true, "距离 1：上上了");
  use(k);
  assert.match(f.logs(), /柯尔特 已经有共振/);
  // 「所有敌人都有共振」只看看得见的：躲藏中的潜藏者、倒地没起身的不算
  assert.equal(lu.statuses.hide, true);
  h.dying = true; h.upOnShp = false;
  assert.equal(f.c.sweeperAllResonated(sw), true, "柯尔特有了；潜藏者躲着、Helumica 倒地：看不见");
  assert.equal(f.c.sweeperResoTargetOk(sw, lu), false);
  lu.statuses.hide = false;
  assert.equal(f.c.sweeperAllResonated(sw), false, "潜藏者现身：还有敌人没有共振（狂鼠也算敌人）");
  assert.equal(f.c.sweeperResoTargetOk(sw, lu), true);
  f.S.combatPhase = "enemy"; sw.ap = 1;
  const p = f.c.EnemyAI.plan(sw);
  assert.deepEqual([p.meta.skillId, p.meta.targetId], ["en_sweeper_reso", lu.id], "AI 也给狂鼠上共振");
});

test("移动：主动远离敌人——和敌人同区就退到没有敌人的区；太远（隔两区）就接近到距离 1", () => {
  const f = field([{ id: "sewer_sweeper", lv: 3, zone: 1 }], { zoneMode: 3 });
  const sw = f.E("sewer_sweeper"), k = f.P("kolt"), h = f.P("helu");
  k.zone = 1; h.zone = 1;
  f.S.combatPhase = "enemy"; sw.ap = 1;
  let p = f.c.EnemyAI.plan(sw);
  assert.deepEqual([p.ai.kind, p.ai.dest], ["move", 2], "同区：后撤");
  p.thunk();
  assert.equal(sw.zone, 2);
  sw.zone = 3; sw.ap = 1;
  p = f.c.EnemyAI.plan(sw);
  assert.deepEqual([p.ai.kind, p.ai.dest], ["move", 2], "隔两区：接近到距离 1");
  assert.deepEqual(plain(f.c.EnemyAI.SPEC.sewer_sweeper), { dist: 1, aim: "local", special: "sweeper" });
});

/* ================= 协助：自爆 ================= */

test("协助：自爆——冲到目标所在区，对那一区所有和它敌对的单位（狂鼠也算）1×atk 火、1 击破，同伙不挨炸；然后自己死亡，照常结算（经验、评分、掉落）", () => {
  const f = field([{ id: "sewer_sweeper", lv: 5, zone: 2 }, { id: "rat_biter", lv: 1, zone: 1 }, { id: "guard_sword", lv: 1, zone: 1 }]);
  const sw = f.E("sewer_sweeper"), rat = f.E("rat_biter"), g = f.E("guard_sword"), k = f.P("kolt"), h = f.P("helu");
  [k, h, rat, g].forEach(u => layers(u, [["shield", 500]]));   // 火打护盾不加不减
  k.zone = 1; h.zone = 1;
  const hp = u => f.c.totalHp(u);
  const atk = sw.atk;
  const xp0 = f.S.battleGains.xp, score0 = f.S.battleScore.total, kxp0 = k.xp, ratDef = rat.def, hDef = h.def;
  assert.equal(f.c.enemyAssistSkillId(sw), "en_sweeper_assist");
  assert.ok(f.c.enemyAssistReady(sw, k), "隔一区也冲得过去");
  f.S.combatPhase = "enemy";
  f.c.dealBreak(k, k.def, "physical", [], "测试", { by: g });   // 安保打出的失衡：同伙的清扫机来协助（狂鼠和安保敌对，不接）
  f.c.BattleSim.resolveQueues(noBlock);
  assert.equal(sw.zone, 1, "冲到目标所在区");
  assert.deepEqual([500 - hp(k), 500 - hp(h), 500 - hp(rat)], [atk, atk, atk], "同区所有敌对单位各 1×atk 火（狂鼠也算）");
  assert.equal(hp(g), 500, "同伙（安保）不挨炸");
  assert.deepEqual([h.def, rat.def], [hDef - 1, ratDef - 1], "每人 1 击破");
  assert.equal(sw.dead, true, "然后自己死亡");
  assert.equal(sw._removed, true, "清出场");
  assert.equal(sw._xpGiven, true, "击杀照常结算");
  assert.ok(f.S.battleGains.xp > xp0 && k.xp > kxp0, "经验");
  assert.ok(f.S.battleScore.total > score0, "评分");
  assert.ok(f.c.enemyDropFoes(f.S.units).includes(sw), "战后照常按掉落表掉材料");
  assert.match(f.logs(), /下水道清扫机 自爆：1 区所有和它敌对的单位受到 1×ATK 火焰伤害、1 击破/);
});

test("自爆可以单独调用（下一步的触灵清扫员代挡后剩余血量 < 25% 时要直接触发）：sweeperSelfDestruct(清扫机, 目标, notes)", () => {
  const f = field([{ id: "sewer_sweeper", lv: 3, zone: 2 }, { id: "rat_lurker", lv: 1, zone: 2 }, { id: "sewer_sweeper", lv: 3, zone: 2 },
    { id: "riot_baton", lv: 1, zone: 2 }]);
  const a = f.E("sewer_sweeper", 0), b = f.E("sewer_sweeper", 1), lu = f.E("rat_lurker"), riot = f.E("riot_baton"), k = f.P("kolt"), h = f.P("helu");
  k.zone = 1; h.zone = 1;
  const hp = u => f.c.totalHp(u);
  const before = { lu: hp(lu), b: hp(b), riot: hp(riot), k: hp(k), h: hp(h) };
  assert.equal(lu.statuses.hide, true);
  // 不给目标：就在原地炸（2 区）。躲藏中的潜藏者照样被波及（范围攻击）；同阵营的清扫机、同伙的镇压队不挨炸；1 区的我方不挨炸
  const notes = [];
  assert.equal(f.c.sweeperSelfDestruct(a, null, notes), true);
  assert.ok(hp(lu) < before.lu, "狂鼠挨炸");
  assert.deepEqual([hp(b), hp(riot), hp(k), hp(h)], [before.b, before.riot, before.k, before.h]);
  assert.deepEqual([a.dead, a._removed, a._xpGiven], [true, true, true]);
  assert.ok(notes.some(t => /自爆/.test(t)));
  // 已经炸过（死了）的不再炸；不是清扫机的不会自爆
  assert.equal(f.c.sweeperSelfDestruct(a, null, []), false);
  assert.equal(f.c.sweeperSelfDestruct(riot, k, []), false);
  // 给目标：冲到目标所在区再炸
  assert.equal(f.c.sweeperSelfDestruct(b, k, []), true);
  assert.equal(b.zone, 1);
  assert.ok(hp(k) < before.k && hp(h) < before.h, "冲到 1 区炸我方");
  assert.equal(b.dead, true);
});

/* ================= 掉落、图鉴 ================= */

test("掉落：和狂鼠一样随便掉一些废料（cm_scrap），量少；图鉴写阵营、招式、协助", () => {
  const c = H.load();
  const drops = c.enemyDropTable("sewer_sweeper");
  assert.deepEqual(plain(drops.map(d => d.id)), ["cm_scrap"], "只掉废料");
  const rat = c.enemyDropTable("rat_biter").find(d => d.id === "cm_scrap").chance;
  assert.ok(drops[0].chance > 0 && drops[0].chance <= rat, "量少：不比狂鼠的杂兵多");
  const e = c.bestiaryEntries().find(x => x.kit === "sewer_sweeper");
  assert.deepEqual([e.name, e.rank, e.faction, plain(e.regions), e.race], ["下水道清扫机", "minion", "下水道维护", ["下水道"], ""]);
  assert.match(e.text.move, /远离/);
  const text = e.text.abilities.join("\n");
  assert.match(text, /阵营「下水道维护」：和安保、警卫队、镇压队是一伙.*和狂鼠、盗匪/);
  assert.match(text, /施加共振：还有敌人没有共振时/);
  assert.match(text, /谐波射击：所有敌人都有共振时，远距 1×atk \+ 1d4 谐波，1 击破/);
  assert.match(text, /协助：自爆——冲到目标所在区，对那一区所有和它敌对的单位（狂鼠也算）1×atk 火，1 击破，然后自己死亡/);
  assert.match(text, /自己不会清除状态/);
  assert.equal(c.bestiaryStats("sewer_sweeper", 1, 2).flying, false);
});
