// 连续战斗与援军（chain.js）：援军按回合抵达 / 敌人打光就下回合到；打完一场接着去下一个区域，天气和角色状态不重置；分数线 ×1.2
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

const ENC = () => ({
  name: "巷口", zoneMode: 2, weather: "snow", enemies: [{ preset: "thug_knife", level: 1, zone: 2 }],
  waves: [{ turns: 2, enemies: [{ preset: "thug_hammer", level: 1, zone: 2 }] }],
  stages: [{ name: "仓库", zoneMode: 3, playerZone: 1, layout: "custom", layoutLocked: true, fields: { 2: { acid: true } },
    features: [{ type: "prop", what: "boom", zone: 3, faction: "enemy" }],
    enemies: [{ preset: "thug_knife", level: 1, zone: 3, count: 2 }] }]
});
function setup(enc) {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "yuito"], encounter: enc || ENC(), level: 1, seed: "CH" });
  c.startCombat();
  return { c, st: c.S.state };
}
const killFoes = (c, st) => st.units.filter(u => !u.isPlayer && !u.dead).forEach(u => { u.layers.forEach(l => { l.current = 0; }); u.dead = true; });

test("开战：两场、一波援军；显示第 1 / 2 场，援军还有 2 回合到 2 区", () => {
  const { c } = setup();
  const s = c.Chain.status();
  assert.equal(s.total, 2); assert.equal(s.index, 0);
  assert.equal(JSON.stringify(s.waves.map(w => [w.in, w.zones, w.count])), JSON.stringify([[2, "2 区", 1]]));
  assert.match(c.Chain.barHtml(s), /第 1 \/ 2 场/);
  assert.match(c.Chain.barHtml(s), /援军 1 个 · 2 回合后抵达 2 区/);
});

test("援军到点就进场，进写好的区", () => {
  const { c, st } = setup();
  const n = st.units.filter(u => !u.isPlayer).length;
  st.turnNo = 3; c.Chain.roundStart([]);
  const foes = st.units.filter(u => !u.isPlayer);
  assert.equal(foes.length, n + 1);
  assert.equal(foes[foes.length - 1].kit, "thug_hammer"); assert.equal(foes[foes.length - 1].zone, 2);
  assert.equal(c.Chain.status().waves.length, 0);
});

test("没到时间就把敌人打光：战斗不结束，援军下一回合抵达", () => {
  const { c, st } = setup();
  killFoes(c, st);
  const r = c.dispatch({ type: "battle.chain" });
  assert.equal(r.continued, true);
  assert.match(r.notes.join(), /下一回合抵达/);
  assert.equal(c.Chain.status().waves[0].in, 1);
  assert.equal(st.chain.index, 0, "援军没来之前不换区域");
  st.turnNo = 2; c.Chain.roundStart([]);
  assert.ok(st.units.some(u => !u.isPlayer && !u.dead && u.kit === "thug_hammer"));
});

test("一场打完（含援军）去下一个区域：换区制、场地、配置物和敌人；天气、回合数、角色状态和评分都不重置", () => {
  const { c, st } = setup();
  const ruby = c.findKit("ruby", st.units);
  ruby.layers[0].current = 3; ruby.statuses.burn = 2; ruby.resources.nano = 77;
  st.battleScore.total = 123;
  st.turnNo = 3; c.Chain.roundStart([]);
  killFoes(c, st);
  const r = c.dispatch({ type: "battle.chain" });
  assert.equal(r.continued, true);
  assert.match(r.notes.join(), /前往下一个区域「仓库」（第 2 \/ 2 场）/);
  assert.equal(st.chain.index, 1);
  assert.equal(st.zoneMode, 3);
  assert.equal(st.weather, "snow", "天气不变");
  assert.equal(st.turnNo, 3, "回合数接着算");
  assert.ok(st.fields[2].acid);
  assert.equal(st.props.length, 1);
  const foes = st.units.filter(u => !u.isPlayer);
  assert.equal(JSON.stringify(foes.map(u => [u.kit, u.zone])), JSON.stringify([["thug_knife", 3], ["thug_knife", 3]]));
  const r2 = c.findKit("ruby", st.units);
  assert.equal(r2, ruby, "同一个单位带过去");
  assert.equal(r2.layers[0].current, 3); assert.equal(r2.statuses.burn, 2); assert.equal(r2.resources.nano, 77);
  assert.equal(r2.zone, 1);
  assert.equal(st.battleScore.total, 123);
  // 最后一场打完：真正结束
  killFoes(c, st);
  assert.equal(c.dispatch({ type: "battle.chain" }).continued, false);
});

test("评分：基准分把所有场次、援军的敌人都算进去；固定分数线每波援军 / 每多一场 ×1.2", () => {
  const { c, st } = setup();
  assert.ok(Math.abs(c.Chain.fixedMult() - 1.44) < 1e-9);
  const plain = H.load();
  plain.BattleSim.setup({ party: ["ruby", "yuito"], encounter: { zoneMode: 2, enemies: [{ preset: "thug_knife", level: 1, zone: 2 }] }, level: 1, seed: "CH" });
  const a = c.gradeLines(1, null), b = plain.gradeLines(1, null);
  a.forEach((row, i) => { if (b[i][1] > 0) assert.equal(row[3], Math.round(b[i][3] * 1.44)); });   // 固定线 ×1.44（B 及以上之后再 ×1.15、取整到 10）
  const par0 = c.scorePar();
  st.turnNo = 3; c.Chain.roundStart([]);
  assert.ok(c.scorePar() > par0, "援军的敌人进了基准分");
});

test("战斗模板：援军和连续战斗转成遭遇；后面几场的掉落加在一起，天气只用第一场的", () => {
  const c = H.load();
  const a = c.battleTemplateSave({ name: "后院", board: 3, weather: "acid", enemies: [{ preset: "thug_knife", level: 2, zone: 3 }], drops: { kuizhi: 100, items: [{ id: "medkit", qty: 1 }] } });
  const b = c.battleTemplateSave({ name: "前门", board: 2, weather: "heat", enemies: [{ preset: "thug_hammer", zone: 2 }],
    waves: [{ turns: 3, enemies: [{ preset: "thug_knife", zone: 2 }, { preset: "thug_knife", zone: 1 }] }], chain: [a.id], drops: { kuizhi: 50, items: [{ id: "medkit", qty: 2 }] } });
  assert.equal(b.waves[0].turns, 3); assert.deepEqual(b.chain, [a.id]);
  assert.match(c.battleTemplateSummary(b), /援军 1 波/); assert.match(c.battleTemplateSummary(b), /连续 2 场/);
  const enc = c.battleTemplateToEncounter(b);
  assert.equal(enc.weather, "heat");
  assert.equal(enc.waves[0].enemies.length, 2);
  assert.equal(enc.stages.length, 1); assert.equal(enc.stages[0].name, "后院"); assert.equal(enc.stages[0].weather, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(enc.drops)), { kuizhi: 150, items: [{ id: "medkit", qty: 3 }] });
  c.BattleSim.setup({ party: ["ruby", "yuito"], encounter: enc, level: 1, seed: "T" });
  assert.equal(c.Chain.status().total, 2);
});

test("普通的单场战斗不受影响：没有 chain，分数线不变，打光就结束", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "yuito"], encounter: { zoneMode: 2, enemies: [{ preset: "thug_knife", level: 1, zone: 2 }] }, level: 1, seed: "P" });
  assert.equal(c.S.state.chain, null);
  assert.equal(c.Chain.fixedMult(), 1);
  assert.equal(c.Chain.barHtml(c.Chain.status()), "");
  c.S.state.units.filter(u => !u.isPlayer).forEach(u => { u.dead = true; });
  assert.equal(c.dispatch({ type: "battle.chain" }).continued, false);
});

test("无界面模拟也会一场接一场打下去", () => {
  const c = H.load();
  const enc = ENC();
  enc.enemies[0].level = 1; enc.stages[0].enemies[0].count = 1;
  c.BattleSim.setup({ party: ["ras", "yuito"], encounter: enc, level: 1, seed: "SIM" });
  c.S.state.units.filter(u => u.isPlayer).forEach(u => { u.atk = 999; u.personalAtk = 999; });   // 出手用的是 personalAtk；援军开战后生成，种族 / 个体值是随机的，血量不固定
  const r = c.BattleSim.run({ maxRounds: 40 });
  const log = c.S.state.logPages.flatMap(p => p.lines.map(l => l.text)).join("\n");
  assert.match(log, /援军抵达/);
  assert.match(log, /前往下一个区域/);
  assert.equal(r.winner, "player");
});
