// 三方混战：互相敌对的两个敌人阵营 + 我方（enemies.js · hostileTo；run.js · THREE_WAY / rollThreeWay）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const vm = require("vm");
const plain = x => JSON.parse(JSON.stringify(x));
/** 顶层 const（THREE_WAY 等）不挂在 window 上，用 vm 取 */
const get = (c, expr) => vm.runInContext(expr, c);

test("敌对：盗匪和安保、警卫队互相敌对；盗匪和其他阵营照旧", () => {
  const c = H.load();
  const thug = { kit: "thug_knife" }, boss = { kit: "bandit_boss" }, sec = { kit: "guard_sword" }, wolf = { kit: "captain_wolf" }, sand = { kit: "sand_beast" }, ali = { kit: "meteor_spider" };
  assert.equal(c.hostileTo(thug, sec), true);
  assert.equal(c.hostileTo(wolf, boss), true);
  assert.equal(c.hostileTo(sec, wolf), false, "安保和警卫队照旧一伙");
  assert.equal(c.hostileTo(thug, boss), false);
  assert.equal(c.hostileTo(thug, sand), false, "盗匪和沙灵没有敌对");
  assert.equal(c.hostileTo(thug, ali), true, "异星生物和谁都敌对");
});

test("外城区的三方混战：玩家在 2 区，安保 / 警卫队一边、盗匪一边，各 3 枚代币", () => {
  const c = H.load();
  const side = k => ["安保", "警卫队"].includes(c.enemyInfo(k).faction) ? "官方" : c.enemyInfo(k).faction;
  for (let i = 0; i < 40; i++) {
    const spec = c.rollEncounter({ region: "外城区", threeWay: true, zoneMode: 3 });
    assert.equal(spec.layout, "threeway"); assert.equal(spec.playerZone, 2); assert.equal(spec.zoneMode, 3);
    const by = {};
    spec.enemies.forEach(e => {
      const s = side(e.preset);
      by[s] = by[s] || { zones: new Set(), tokens: 0 };
      by[s].zones.add(e.zone);
      const info = c.enemyInfo(e.preset);
      by[s].tokens += (info.tokens || 1) / (Number(info.group) || 1);   // 成组的（空投蜂群）整组记 1 枚
    });
    assert.deepEqual(Object.keys(by).sort(), ["官方", "盗匪"]);
    assert.notEqual([...by["官方"].zones][0], [...by["盗匪"].zones][0]);
    assert.equal(by["官方"].zones.size, 1); assert.equal(by["盗匪"].zones.size, 1);
    assert.equal(Math.round(by["官方"].tokens), 3); assert.equal(Math.round(by["盗匪"].tokens), 3);
  }
});

test("三方混战的概率：三区制时 15%；两区制、指定阵营、混战都不会变", () => {
  const c = H.load();
  c.Math.random = c.makeRng("3W-RATE");
  const N = 2000;
  let n = 0;
  for (let i = 0; i < N; i++) if (c.rollEncounter({ region: "外城区", zoneMode: 3 }).layout === "threeway") n++;
  assert.ok(Math.abs(n / N - 0.15) < 0.03, `约 15%，实际 ${(n / N * 100).toFixed(1)}%`);
  for (let i = 0; i < 20; i++) {
    assert.notEqual(c.rollEncounter({ region: "外城区", zoneMode: 2 }).layout, "threeway");
    assert.notEqual(c.rollEncounter({ region: "外城区", zoneMode: 3, faction: "盗匪" }).layout, "threeway");
    assert.notEqual(c.rollEncounter({ region: "外城区", zoneMode: 3, mixed: true }).layout, "threeway");
    assert.notEqual(c.rollEncounter({ region: "沙漠", zoneMode: 3 }).layout, "threeway", "其他区域没有");
  }
});

test("三方混战的概率写在 THREE_WAY.chance = 15%（作者 10/22 定，原来 50%）：第三采矿场同样 15%；随机混战、镇压队的混编概率不跟着改", () => {
  const c = H.load();
  assert.equal(get(c, "THREE_WAY").chance, 0.15);
  assert.equal(get(c, "CHANCE_MIXED"), 0.05, "随机混战（无视阵营）照旧 5%");
  assert.equal(get(c, "FACTION_MIX_CHANCE")["镇压队"], 0.15, "镇压队的混编照旧 15%");
  // 固定种子抽样：第三采矿场三区制的遭遇
  c.Math.random = c.makeRng("3W-MINE3");
  const N = 2000;
  let n = 0;
  for (let i = 0; i < N; i++) if (c.rollEncounter({ region: "第三采矿场", zoneMode: 3 }).layout === "threeway") n++;
  assert.ok(Math.abs(n / N - 0.15) < 0.03, `约 15%，实际 ${(n / N * 100).toFixed(1)}%`);
});

test("外城区三方混战整场自动对打：狂徒会去打安保 / 警卫队，能打完、没有报错", () => {
  let fights = 0;
  for (let i = 0; i < 6; i++) {
    const c = H.load();
    const spec = c.rollEncounter({ region: "外城区", threeWay: true, zoneMode: 3, level: 4 });
    c.BattleSim.setup({ party: ["kolt", "helu", "tou"], encounter: spec, level: 4, seed: "OC" + i });
    // 数一数敌人打敌人的次数：把全局的 dealTo 包一层
    const orig = c.dealTo;
    c.dealTo = function (a, t, opt) { if (a && t && !a.isPlayer && !t.isPlayer && c.hostileTo(a, t)) fights++; return orig.apply(this, arguments); };
    const r = c.BattleSim.run({ maxRounds: 25 });
    assert.ok(r.winner && r.actions > 0);
  }
  assert.ok(fights > 0, "敌人之间打起来了");
});

test("我方和某阵营同阵营（战斗模板）：友军不打我方、我方打不到它，它去打敌对阵营；打赢不用打倒友军；友军倒下没有奖励", () => {
  const c = H.load();
  const tpl = c.battleTemplateNormalize({ name: "帮保安打狂徒", board: 3, playerZone: 2, allyFaction: "安保",
    enemies: [{ preset: "guard_sword", level: 3, zone: 1 }, { preset: "thug_knife", level: 3, zone: 3 }, { preset: "thug_hammer", level: 3, zone: 3 }] });
  assert.equal(tpl.allyFaction, "安保");
  assert.match(c.battleTemplateSummary(tpl), /我方与安保同阵营/);
  assert.equal(c.battleTemplateNormalize({ allyFaction: "乱写的" }).allyFaction, "", "不认识的阵营不收");
  const enc = c.battleTemplateToEncounter(tpl);
  c.BattleSim.setup({ party: ["kolt", "helu"], encounter: enc, level: 3, seed: "ALLY" });
  c.startCombat();
  const S = c.S.state;
  assert.deepEqual([...S.playerAllies].sort(), ["下水道维护", "安保", "警卫队", "镇压队"].sort(), "是一伙的警卫队、镇压队、下水道维护（#279）也算友军");
  const g = S.units.find(u => u.kit === "guard_sword"), t = S.units.find(u => u.kit === "thug_knife"), k = c.findKit("kolt", S.units);
  assert.equal(c.hostileTo(k, g), false); assert.equal(c.hostileTo(k, t), true); assert.equal(c.hostileTo(g, t), true);
  assert.match(c.statusLine(g), /友军/);
  // 我方打友军：打不出去
  const g0 = c.totalHp(g);
  k.zone = g.zone;
  c.dealTo(k, g, { atk: 50, mult: 1, element: "physical", baseBreak: 1, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });
  assert.equal(c.totalHp(g), g0, "我方打不到友军");
  // 友军的 AI 去打狂徒，不打我方
  k.zone = 1;
  S.combatPhase = "enemy"; c.refreshEnemyEconomy(g);
  const plan = c.EnemyAI.plan(g);
  assert.ok(plan, "友军有事做");
  const kHp = c.totalHp(k);
  plan.thunk(); c.BattleSim.resolveQueues({ pickBlocker: () => null, pickAssister: l => l[0].id });
  assert.equal(c.totalHp(k), kHp, "友军不打我方");
  // 打赢只要打倒敌对的：狂徒都倒下就赢（友军还活着）
  S.units.filter(u => /^thug_/.test(u.kit)).forEach(u => { u.layers.forEach(l => { l.current = 0; }); u.dead = true; });
  assert.equal(c.BattleSim.outcome(), "player");
  // 友军倒下：没有经验
  const xp0 = k.xp;
  g.layers.forEach(l => { l.current = 0; });
  c.settleEnemyKill(g, []);
  assert.ok(g.dead); assert.equal(k.xp, xp0);
});

test("没有设同阵营：模板里放互相敌对的阵营，不管站位都会互相打", () => {
  const c = H.load();
  const enc = c.battleTemplateToEncounter(c.battleTemplateNormalize({ name: "随便摆", board: 2, playerZone: 1,
    enemies: [{ preset: "guard_sword", level: 3, zone: 2 }, { preset: "thug_knife", level: 3, zone: 2 }] }));
  c.BattleSim.setup({ party: ["kolt"], encounter: enc, level: 3, seed: "NOALLY" });
  c.startCombat();
  const S = c.S.state;
  assert.deepEqual([...S.playerAllies], []);
  const g = S.units.find(u => u.kit === "guard_sword"), t = S.units.find(u => u.kit === "thug_knife");
  assert.equal(c.hostileTo(g, t), true);
  // 柯尔特在 1 区（远），狂徒同区就有剑看守：剑看守会先打同区的狂徒
  S.combatPhase = "enemy"; c.refreshEnemyEconomy(g);
  const t0 = c.totalHp(t);
  const plan = c.EnemyAI.plan(g); plan.thunk(); c.BattleSim.resolveQueues({ pickBlocker: () => null, pickAssister: l => l[0].id });
  assert.ok(c.totalHp(t) < t0, "同区的狂徒挨打");
});

test("敌人的范围攻击按阵营分敌我：友军播撒者的喷洒打同区的狂徒、不打我方；没设友军时也会打敌对阵营", () => {
  const c = H.load();
  const enc = c.battleTemplateToEncounter(c.battleTemplateNormalize({ name: "友军喷洒", board: 2, playerZone: 1, allyFaction: "安保",
    enemies: [{ preset: "spreader", level: 3, zone: 2 }, { preset: "thug_knife", level: 3, zone: 1 }] }));
  c.BattleSim.setup({ party: ["kolt"], encounter: enc, level: 3, seed: "SPRAY" });
  c.startCombat();
  const S = c.S.state;
  const sp = S.units.find(u => u.kit === "spreader"), th = S.units.find(u => u.kit === "thug_knife"), k = c.findKit("kolt", S.units);
  k.zone = 1; th.zone = 1;
  const k0 = c.totalHp(k), t0 = c.totalHp(th);
  S.combatPhase = "enemy"; sp.ap = 1; S.attackerId = sp.id; S.targetId = th.id;
  c.runSkill("en_spread");
  c.BattleSim.resolveQueues({ pickBlocker: () => null, pickAssister: l => l[0].id });
  assert.ok(c.totalHp(th) < t0, "喷洒打到同区的狂徒");
  assert.equal(c.totalHp(k), k0, "不打我方");
  assert.equal(th.statuses.corr, true, "狂徒被腐蚀");
  // 没有友军：三方混战里异星的范围攻击也会波及敌对的安保（同区的人都挨）
  const c2 = H.load();
  c2.BattleSim.setup({ party: ["kolt"], enemies: [{ id: "spreader", lv: 3, zone: 2 }, { id: "meteor_spider", lv: 3, zone: 1 }], seed: "SPRAY2" });
  c2.startCombat();
  const S2 = c2.S.state;
  const sp2 = S2.units.find(u => u.kit === "spreader"), spi = S2.units.find(u => u.kit === "meteor_spider"), k2 = c2.findKit("kolt", S2.units);
  k2.zone = 1; spi.zone = 1;
  const s0 = c2.totalHp(spi);
  S2.combatPhase = "enemy"; sp2.ap = 1; S2.attackerId = sp2.id; S2.targetId = k2.id;
  c2.runSkill("en_spread");
  c2.BattleSim.resolveQueues({ pickBlocker: () => null, pickAssister: l => l[0].id });
  assert.ok(c2.totalHp(spi) < s0, "安保的喷洒也波及敌对的异星");
});
