// 第一采矿场的新敌人：矿场看守机器人（杂兵）、蚁型特殊戒备兵种（精英）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function field(enemies, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: opt.party || ["kolt", "helu"], enemies, seed: opt.seed || "MINE1", zoneMode: opt.zoneMode || 2 });
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
function nextRound(c, S) {
  c.endPlayerTurn();
  S.units.filter(u => !u.isPlayer).forEach(u => { u.ap = 0; });
  c.endEnemyTurn();
}
const preset = (c, id) => c.enemyPresets().find(p => p.id === id);
const total = u => u.layers.reduce((s, l) => s + l.max, 0);

test("矿场看守机器人：总血量 / 架势 / atk / 伤害骰同机器人看守（剑），一半装甲换成护盾（护盾在外）；酸属性", () => {
  const c = H.load();
  [1, 4, 7, 12, 20].forEach(lv => {
    const m = preset(c, "mine_guard").build(lv, 1), g = preset(c, "guard_sword").build(lv, 1);
    assert.equal(total(m), total(g), "Lv" + lv);
    assert.deepEqual(m.layers.map(l => l.type).join(">"), "shield>armor");
    assert.ok(Math.abs(m.layers[0].max - m.layers[1].max) <= 1, "护盾、装甲各一半");
    assert.equal(m.defMax, g.defMax); assert.equal(m.atk, g.atk);
    assert.deepEqual([...m.suggest.dice, m.suggest.flat], [...g.suggest.dice, g.suggest.flat]);
    assert.equal(m.suggest.element, "acid");
  });
  assert.equal(c.enemyRankOf({ kit: "mine_guard" }), "minion");
});

test("蚁型特殊戒备兵种：护盾 > 装甲 > 肉体，总血量 / 架势 / atk 同狼队长；远距离酸；精英", () => {
  const c = H.load();
  [1, 5, 10].forEach(lv => {
    const a = preset(c, "ant_guard").build(lv, 1), w = preset(c, "captain_wolf").build(lv, 1);
    assert.equal(a.layers.map(l => l.type).join(">"), "shield>armor>flesh");
    assert.equal(total(a), total(w), "Lv" + lv);
    assert.equal(a.defMax, w.defMax); assert.equal(a.atk, w.atk);
    assert.equal(a.range, "ranged"); assert.equal(a.suggest.element, "acid");
  });
  assert.equal(c.enemyRankOf({ kit: "ant_guard" }), "elite");
  assert.deepEqual([...c.regionPool("第一采矿场")].sort(), ["ant_guard", "dumpdrone", "mine_guard", "spreader"]);
});

test("矿场看守机器人：目标有腐蚀、或自己站在酸液地面上，打中后溅射同区其他人 0.5×atk 酸；不打同阵营", () => {
  const { c, S, P, E } = field([{ id: "mine_guard", lv: 5, zone: 1 }, { id: "dumpdrone", lv: 5, zone: 1 }]);
  const g = E("mine_guard"), d = E("dumpdrone"), k = P("kolt"), h = P("helu");
  k.zone = 1; h.zone = 1; tank(k); tank(h);
  const hit = () => {
    S.combatPhase = "enemy"; g.ap = 1; S.attackerId = g.id; S.targetId = k.id;
    c.runSkill("en_mine_guard");
    c.BattleSim.resolveQueues(noBlock);
  };
  const hp = u => c.totalHp(u);
  // 没腐蚀、不在酸液地面：不溅射
  let h0 = hp(h), d0 = hp(d), k0 = hp(k);
  hit();
  assert.ok(hp(k) < k0, "主目标挨打");
  assert.equal(hp(h), h0, "不溅射");
  // 目标有腐蚀：溅射到海露米卡，不打同区的投料无人机
  k.statuses.corr = true;
  h0 = hp(h); d0 = hp(d);
  hit();
  assert.ok(hp(h) < h0, "腐蚀目标：溅射");
  assert.equal(hp(d), d0, "不打同阵营");
  // 自己站在酸液地面上：也溅射
  k.statuses.corr = false;
  c.setZoneField(1, "acid", {});
  h0 = hp(h);
  hit();
  assert.ok(hp(h) < h0, "酸液地面：溅射");
});

test("酸液地面：蚁型特殊戒备兵种不吃伤害、离开不改花行动点；矿场看守机器人照吃伤害，离开也不改花", () => {
  const { c, S, E, logs } = field([{ id: "ant_guard", lv: 5, zone: 2 }, { id: "mine_guard", lv: 5, zone: 2 }]);
  const a = E("ant_guard"), g = E("mine_guard");
  c.setZoneField(2, "acid", {});
  const a0 = c.totalHp(a), g0 = c.totalHp(g);
  nextRound(c, S);   // 酸液地面在回合开始结算
  assert.equal(c.totalHp(a), a0, "蚁型不吃酸液地面");
  assert.ok(c.totalHp(g) < g0, "看守机器人照吃");
  // 精英平时用附赠行动移动；离开酸液地面也照旧，不改花行动点
  S.combatPhase = "enemy"; a.ap = 1; a.bonus = 1;
  c.doMove(a, 1, {});
  assert.equal(a.zone, 1); assert.equal(a.ap, 1); assert.equal(a.bonus, 0);
  assert.doesNotMatch(logs(), /离开酸液地面/);
});

test("蚁型特殊戒备兵种：平时酸液喷枪（远距 + 腐蚀）；站在酸液地面上先标定大酸液弹，下回合发射：随机一人 2×atk、同区其他人 等级+1d6", () => {
  const { c, S, P, E } = field([{ id: "ant_guard", lv: 5, zone: 2 }]);
  const a = E("ant_guard"), k = P("kolt"), h = P("helu");
  k.zone = 1; h.zone = 1; tank(k); tank(h);
  S.combatPhase = "enemy"; c.refreshEnemyEconomy(a);
  assert.deepEqual(plain(aiTurn(c, a)), ["酸液喷枪"]);
  assert.ok(k.statuses.corr || h.statuses.corr, "打中的人上腐蚀");

  c.setZoneField(2, "acid", {});
  nextRound(c, S);
  S.combatPhase = "enemy"; c.refreshEnemyEconomy(a);
  assert.deepEqual(plain(aiTurn(c, a)), ["大酸液弹（选择区域）"]);
  assert.equal(a.resources.shellZone, 1);
  assert.deepEqual(plain(c.zoneThreats().map(t => [t.zone, t.label, t.ready])), [[1, "大酸液弹标定", false]]);

  nextRound(c, S);
  assert.equal(a.resources.shellReady, true);
  const k0 = c.totalHp(k), h0 = c.totalHp(h);
  S.combatPhase = "enemy"; c.refreshEnemyEconomy(a);
  assert.equal(aiTurn(c, a, 1)[0], "发射大酸液弹（1区）");
  const lost = [k0 - c.totalHp(k), h0 - c.totalHp(h)].sort((x, y) => x - y);
  assert.ok(lost[0] > 0 && lost[1] > lost[0], "两人都挨打，主目标更重：" + lost);
  assert.equal(a.resources.shellPending, false);
});
