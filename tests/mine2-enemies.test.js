// 第二采矿场的新敌人（火）：矿场监工、火石清扫机（杂兵），燃气收集机、蚁型特殊剿灭兵种（精英）
// 以及：我方被打进濒死在机制上算被击倒（爆燃等击杀时效果照样触发）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function field(enemies, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: opt.party || ["kolt", "helu"], enemies, seed: opt.seed || "MINE2", zoneMode: opt.zoneMode || 2 });
  c.startCombat();
  const S = c.S.state;
  S.units.forEach(u => { if (u.kit === "kolt") u.prideMaxHp = Infinity; });
  return {
    c, S,
    P: k => c.findKit(k, S.units),
    E: k => S.units.find(u => !u.isPlayer && u.kit === k && !u.dead),
    logs: () => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n")
  };
}
const tank = u => u.layers.forEach(l => { l.max = 999; l.current = 999; });
const noBlock = { pickBlocker: () => null, pickAssister: l => l[0].id };
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
const preset = (c, id) => c.enemyPresets().find(p => p.id === id);
const total = u => u.layers.reduce((s, l) => s + l.max, 0);
const types = u => u.layers.map(l => l.type).join(">");
/** 让敌人 a 对 t 用技能 id（我方不格挡） */
function use(f, a, id, t) {
  f.S.combatPhase = "enemy"; a.ap = Math.max(1, a.ap || 0); f.S.attackerId = a.id; f.S.targetId = t ? t.id : null;
  f.c.runSkill(id);
  f.c.BattleSim.resolveQueues(noBlock);
}

test("数值：监工 = 锤狂徒（一半血换装甲）、清扫机 = 枪看守、收集机 = 榴弹机甲（星灵换肉体）、剿灭兵种 = 牛队长（护盾换装甲）", () => {
  const c = H.load();
  [1, 5, 10, 15].forEach(lv => {
    const pair = (a, b) => [preset(c, a).build(lv, 1), preset(c, b).build(lv, 1)];
    let [x, y] = pair("mine_overseer", "thug_hammer");
    assert.equal(types(x), "armor>flesh"); assert.equal(total(x), total(y));
    assert.ok(Math.abs(x.layers[0].max - x.layers[1].max) <= 1);
    assert.deepEqual([x.defMax, x.atk, x.suggest.element], [y.defMax, y.atk, "fire"]);
    [x, y] = pair("flint_sweeper", "guard_gun");
    assert.deepEqual([types(x), total(x), x.defMax, x.atk], [types(y), total(y), y.defMax, y.atk]);
    [x, y] = pair("gas_collector", "mecha_gl");
    assert.equal(types(x), "shield>armor>flesh");
    assert.deepEqual(x.layers.map(l => l.max), y.layers.map(l => l.max));
    assert.deepEqual([x.defMax, x.atk], [y.defMax, y.atk]);
    [x, y] = pair("ant_hunter", "captain_ox");
    assert.equal(types(x), "armor>flesh");
    assert.deepEqual(x.layers.map(l => l.max), y.layers.map(l => l.max));
    assert.deepEqual([x.defMax, x.atk, x.range], [y.defMax, y.atk, "ranged"]);
  });
  assert.deepEqual([...c.regionPool("第二采矿场")].sort(), ["ant_hunter", "flint_sweeper", "gas_collector", "mine_overseer"]);
  assert.deepEqual(["mine_overseer", "flint_sweeper", "gas_collector", "ant_hunter"].map(k => c.enemyRankOf({ kit: k })), ["minion", "minion", "elite", "elite"]);
});

test("矿场监工：火焰重锤打中施加灼烧 1；协助冲近半伤", () => {
  const f = field([{ id: "mine_overseer", lv: 5, zone: 1 }]);
  const o = f.E("mine_overseer"), k = f.P("kolt");
  k.zone = 1; tank(k); k.statuses.burn = 0;
  use(f, o, "en_overseer", k);
  assert.equal(k.statuses.burn, 1);
  assert.equal(f.c.enemyAssistSkillId(o), "en_overseer_assist");
});

test("火石清扫机：1d6 发分给远距离的不同的人，只有第一发 1 击破；站在火场里每一发打中都灼烧", () => {
  const f = field([{ id: "flint_sweeper", lv: 5, zone: 2 }]);
  const s = f.E("flint_sweeper"), k = f.P("kolt"), h = f.P("helu");
  k.zone = 1; h.zone = 1; tank(k); tank(h);
  k.statuses.burn = 0; h.statuses.burn = 0;
  const def0 = [k.def, h.def];
  s.resources.flintShots = 6;   // 回合开始掷好的 6 发
  use(f, s, "en_flint", k);
  assert.match(f.logs(), /连击：发射 6 发火石/);
  assert.equal(s.resources.flintShots, null, "打出去就用掉了");
  assert.ok(k.layers[0].current < 999 && h.layers[0].current < 999, "两个人都挨打");
  assert.equal(def0[0] - k.def + def0[1] - h.def, 1, "整次只有 1 击破");
  assert.equal(k.statuses.burn + h.statuses.burn, 0, "不在火场：不灼烧");
  f.c.setZoneField(2, "fire", {});
  s.resources.flintShots = 6;
  use(f, s, "en_flint", k);
  assert.equal(k.statuses.burn + h.statuses.burn, 6, "火场里每一发都灼烧");
  // 被嘲讽：全打嘲讽的人
  k.statuses.burn = 0; h.statuses.burn = 0;
  s.tauntTo = h.id;
  s.resources.flintShots = 6;
  use(f, s, "en_flint", h);
  assert.deepEqual([k.statuses.burn, h.statuses.burn], [0, 6]);
});

test("我方被打进濒死算被击倒：火石清扫机的协助（爆炸火石，爆燃）把人打进濒死，溢出伤害打同区的队友", () => {
  const f = field([{ id: "flint_sweeper", lv: 5, zone: 2 }]);
  const s = f.E("flint_sweeper"), k = f.P("kolt"), h = f.P("helu");
  k.zone = 1; h.zone = 1; tank(h);
  k.layers.forEach(l => { l.current = 0; }); k.layers[k.layers.length - 1].current = 1;
  const h0 = f.c.totalHp(h);
  use(f, s, "en_flint_assist", k);
  assert.ok(k.dying || f.c.isUnitDown(k), "打进濒死");
  assert.ok(f.c.totalHp(h) < h0, "爆燃：溢出打到同区队友");
  assert.match(f.logs(), /爆燃/);
  // 靠坚毅生命站着、这一击没把坚毅打光：不算被击倒，不爆燃
  const f2 = field([{ id: "flint_sweeper", lv: 5, zone: 2 }]);
  const s2 = f2.E("flint_sweeper"), k2 = f2.P("kolt"), h2 = f2.P("helu");
  k2.zone = 1; h2.zone = 1; tank(h2);
  k2.layers.forEach(l => { l.current = 0; }); k2.upOnShp = true; k2.shp = 999; k2.shpMax = 999;
  const h20 = f2.c.totalHp(h2);
  use(f2, s2, "en_flint_assist", k2);
  assert.ok(k2.shp < 999, "坚毅生命挨打");
  assert.equal(f2.c.totalHp(h2), h20, "没被打倒：不爆燃");
});

test("燃气收集机：先走到目标那一区，不是火场就点燃（同区 0.5×atk + 变火场）；火场里喷火三段；目标灼烧时每段回血", () => {
  const f = field([{ id: "gas_collector", lv: 5, zone: 2 }]);
  const g = f.E("gas_collector"), k = f.P("kolt"), h = f.P("helu");
  k.zone = 1; h.zone = 1; tank(k); tank(h);
  f.S.combatPhase = "enemy"; f.c.refreshEnemyEconomy(g);
  assert.deepEqual(plain(aiTurn(f.c, g)), ["移动到 1 区", "点燃燃气（同区火焰 + 变火场）"]);
  assert.ok(f.c.fieldFireOn(f.S.fields[1]), "1 区变火场");
  assert.ok(k.layers[0].current < 999 && h.layers[0].current < 999, "同区的人都挨了 0.5×atk");
  // 已经是火场：喷火三段，共 1 击破；目标有灼烧，每段回 3% × 层数
  f.S.combatPhase = "enemy"; f.c.refreshEnemyEconomy(g);
  g.layers.forEach(l => { l.current = 1; });
  k.statuses.burn = 2; const kd = k.def;
  const hp0 = f.c.totalHp(g);
  use(f, g, "en_gas_spray", k);
  assert.equal(kd - k.def, 1, "三段共 1 击破");
  const max = g.layers.reduce((s, l) => s + l.max, 0);
  assert.equal(f.c.totalHp(g) - hp0, Math.round(max * 0.03 * 2) * 3, "三段各回 3% × 2 层");
  assert.match(f.logs(), /吸收燃气：3 段/);
});

test("燃气收集机：固有场地点不着；协助冲近、先灼烧 1 再喷火（灼烧算进回血）", () => {
  const f = field([{ id: "gas_collector", lv: 5, zone: 2 }]);
  const g = f.E("gas_collector"), k = f.P("kolt");
  k.zone = 2; tank(k);
  f.S.fields[2].innate = true; f.S.fields[2].ice = true;
  assert.equal(f.c.gasCanIgnite(2), false);
  assert.equal(f.c.enemyAssistSkillId(g), "en_gas_assist");
  k.zone = 1; k.statuses.burn = 0;
  g.layers.forEach(l => { l.current = 1; });
  const hp0 = f.c.totalHp(g);
  use(f, g, "en_gas_assist", k);
  assert.equal(g.zone, 1, "冲到目标那一区");
  assert.equal(k.statuses.burn, 1);
  assert.ok(f.c.totalHp(g) > hp0, "先灼烧再喷火：回血");
});

test("蚁型特殊剿灭兵种：有人走进它的区就用附赠行动退开、给那人灼烧 1；敌人回合开始把天气变酷暑（花 1 行动点，固有天气改不了）", () => {
  const f = field([{ id: "ant_hunter", lv: 5, zone: 2 }]);
  const a = f.E("ant_hunter"), k = f.P("kolt");
  k.zone = 1; k.statuses.burn = 0;
  f.S.combatPhase = "player"; k.bonus = 1; a.bonus = 1;
  f.c.doMove(k, 2, {});
  assert.equal(k.zone, 2);
  assert.equal(a.zone, 1, "退到相邻区");
  assert.equal(a.bonus, 0, "花了附赠行动");
  assert.equal(k.statuses.burn, 1);
  // 附赠用完了：再走进来就不退
  k.bonus = 1;
  f.c.doMove(k, 1, {});
  assert.equal(a.zone, 1);
  // 敌人回合开始：变酷暑，花 1 行动点
  f.S.weather = "none";
  f.c.endPlayerTurn();
  assert.equal(f.S.weather, "heat");
  assert.equal(a.ap, a.apMax - 1);
  assert.match(f.logs(), /把天气变为酷暑/);
});

test("蚁型特殊剿灭兵种：固有天气改不了就不花行动点；灼热子弹 / 狙击带穿刺，狙击带爆燃", () => {
  const f = field([{ id: "ant_hunter", lv: 5, zone: 2 }]);
  const a = f.E("ant_hunter"), k = f.P("kolt");
  f.S.weather = "snow"; f.S.weatherInnate = "snow";
  f.c.endPlayerTurn();
  assert.equal(f.S.weather, "snow");
  assert.equal(a.ap, a.apMax);
  // 穿刺：直接打最内层（外层装甲不掉）
  k.zone = 1;
  k.layers = [{ type: "armor", current: 999, max: 999 }, { type: "flesh", current: 999, max: 999 }];
  use(f, a, "en_hunter_shot", k);
  assert.equal(k.layers[0].current, 999, "灼热子弹穿刺：外层不掉");
  assert.ok(k.layers[1].current < 999);
  const in0 = k.layers[1].current;
  use(f, a, "en_hunter_assist", k);
  assert.equal(k.layers[0].current, 999, "狙击穿刺：外层不掉");
  assert.ok(k.layers[1].current < in0);
  // 狙击带爆燃：把人打进濒死时，溢出打同区的队友
  const h = f.P("helu"); h.zone = 1; tank(h);
  k.layers[1].current = 1; const h0 = f.c.totalHp(h);
  use(f, a, "en_hunter_assist", k);
  assert.ok(f.c.totalHp(h) < h0, "爆燃溢出");
});

test("连击：火石清扫机每一发单独结算、单独格挡、单独掷骰；回合开始先掷好发数，2 发以上名牌上预警「连击」", () => {
  const f = field([{ id: "flint_sweeper", lv: 5, zone: 2 }]);
  const s = f.E("flint_sweeper"), k = f.P("kolt"), h = f.P("helu");
  k.zone = 1; h.zone = 1; tank(k); tank(h); k.bonus = 3; h.bonus = 3;
  // 每一发都单独问一次协助格挡（同区有人能格挡）
  s.resources.flintShots = 3;
  f.S.combatPhase = "enemy"; s.ap = 1; f.S.attackerId = s.id; f.S.targetId = k.id;
  f.c.runSkill("en_flint");
  assert.equal(f.S.blockQueue.length, 3, "三发 = 三次格挡");
  f.c.BattleSim.resolveQueues(noBlock);
  // 回合开始掷发数：2 发以上预警
  s.resources.flintShots = null;
  f.c.Math.random = () => 0.999;
  f.c.flintRollShots(s, []);
  assert.equal(s.resources.flintShots, 6);
  assert.deepEqual(plain(f.c.enemyIntents(s)), ["连击"]);
  s.resources.flintShots = 1;
  assert.deepEqual(plain(f.c.enemyIntents(s)), [], "只有 1 发不是连击");
  s.resources.flintShots = 4; s.stunned = true;
  assert.deepEqual(plain(f.c.enemyIntents(s)), [], "失衡了不提示");
  s.stunned = false;
  // 回合开始（我方回合）会掷好，没打出去就留着
  s.resources.flintShots = null;
  f.c.Math.random = () => 0.5;
  f.c.endPlayerTurn(); f.S.units.filter(u => !u.isPlayer).forEach(u => { u.ap = 0; }); f.c.endEnemyTurn();
  assert.equal(s.resources.flintShots, 4);
});

test("蚁型特殊剿灭兵种：我方被推进它的区也会退开、灼烧；第二采矿场 40% 酷暑", () => {
  const f = field([{ id: "ant_hunter", lv: 5, zone: 2 }]);
  const a = f.E("ant_hunter"), k = f.P("kolt");
  k.zone = 1; k.statuses.burn = 0; a.bonus = 1;
  f.c.displaceTo(k, 2, [], "被推");
  assert.equal(k.zone, 2);
  assert.equal(a.zone, 1);
  assert.equal(k.statuses.burn, 1);
  const c = H.load();
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(c.regionWeather("第二采矿场"));
  assert.deepEqual([...seen].sort(), ["heat", "none"]);
});
