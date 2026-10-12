// 环境分数：配置物 / 场地打出的伤害分数 ×1.2，记在所有者（场地是谁铺的）或触发者（谁引爆 / 操控）身上；
// 天气帮我方多打的伤害、少挨的伤害，天气的所有者按这部分的分值加分
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: ["tou", "ruby", "kolt"], enemies: [{ id: "thug_hammer", lv: 1, zone: 1 }], seed: "ENV" });
  c.startCombat();
  const st = c.S.state;
  st.units.forEach(u => { u.zone = 1; });
  st.units.filter(u => u.isPlayer).forEach(u => { u.bonus = 0; u.layers = [{ type: "flesh", current: 300, max: 300 }]; });
  const foe = st.units.find(u => !u.isPlayer);
  foe.layers = [{ type: "flesh", current: 900, max: 900 }];
  foe.def = foe.defMax = 999;
  st.weather = "none"; st.weatherBy = null; st.weatherInnate = null; st.weatherLock = null;
  Object.values(st.fields).forEach(f => { f.innate = false; });
  st.actionAcc = null;
  c.resetBattleRecords();
  return { c, st, foe, tou: c.findKit("tou", st.units), ruby: c.findKit("ruby", st.units), kolt: c.findKit("kolt", st.units) };
}
const hit = (flat, element, extra) => ({ atk: 0, mult: 0, flat, element: element || "physical", baseBreak: 0, flags: Object.assign({ action: true, blockResolved: true }, extra || {}) });
const part = (st, k) => st.battleScore.parts[k] || 0;

test("爆炸桶：引爆它的人拿环境分（伤害 + 击破的分 ×1.2），不算普通伤害分", () => {
  const { c, st, foe, ruby } = field();
  const p = { id: "pb1", kind: "boom", name: "爆炸桶", zone: 1, hp: 1, level: 1 };
  st.props = [p];
  const hpBefore = c.totalHp(foe), defBefore = foe.def;
  c.destroyProp(p, ruby);
  const dmg = hpBefore - c.totalHp(foe), brk = defBefore - foe.def;
  assert.ok(dmg > 0);
  assert.equal(part(st, "env"), Math.floor((dmg + brk * 10) * 1.2));
  assert.equal(part(st, "dmg"), 0);
  assert.equal(st.battleStats[ruby.id].env, dmg);
  assert.ok(st.battleStats[ruby.id].score >= part(st, "env"));
});

test("碎渣机炮：操控的人拿环境分", () => {
  const { c, st, foe, kolt } = field();
  const p = { id: "ps1", kind: "scrap", name: "碎渣机炮", zone: 1, hp: 5, level: 1 };
  st.props = [p];
  const hpBefore = c.totalHp(foe);
  c.scrapShot(p, foe, kolt);
  const dmg = hpBefore - c.totalHp(foe);
  assert.ok(dmg > 0);
  assert.ok(part(st, "env") >= Math.floor(dmg * 1.2));
  assert.equal(part(st, "dmg"), 0);
  assert.equal(st.battleStats[kolt.id].env, dmg);
});

test("火场：铺场地的人拿环境分；没有所有者、也没人在行动时不算", () => {
  const { c, st, foe, ruby } = field();
  c.setZoneField(1, "fire", { by: ruby.id, force: true });
  assert.equal(st.fields[1].by, ruby.id);
  const hpBefore = c.totalHp(foe);
  c.tickFireField(1, []);
  const dmg = hpBefore - c.totalHp(foe);
  assert.ok(dmg > 0);
  assert.equal(part(st, "env"), Math.floor(dmg * 1.2));
  assert.equal(st.battleStats[ruby.id].env, dmg);

  const b = field();
  b.c.setZoneField(1, "fire", { force: true });
  b.c.tickFireField(1, []);
  assert.equal(part(b.st, "env"), 0);
});

test("高压场地：我方攻击引发的电击记在铺场地的人身上（×1.2），而不是出手的人", () => {
  const { c, st, foe, ruby, kolt } = field();
  c.setZoneField(1, "electric", { by: kolt.id, force: true });
  c.beginActionAcc(ruby);
  c.dealTo(ruby, foe, hit(10));
  assert.ok((st.battleStats[kolt.id].env || 0) > 0);
  assert.equal(part(st, "env"), Math.floor(st.battleStats[kolt.id].env * 1.2));
  assert.equal(st.battleStats[ruby.id].env || 0, 0);
});

test("没有我方所有者的场地（敌人铺的）：算触发它的人（这次行动的出手方）", () => {
  const { c, st, foe, ruby } = field();
  c.setZoneField(1, "electric", { by: foe.id, force: true });
  c.beginActionAcc(ruby);
  c.dealTo(ruby, foe, hit(10));
  assert.ok((st.battleStats[ruby.id].env || 0) > 0);
});

test("天气：我方利用天气多打出来的伤害，天气的所有者按伤害分加分", () => {
  const base = field();
  base.c.dealTo(base.ruby, base.foe, hit(20, "physical"));
  const plain = base.st.battleStats[base.ruby.id].dmg;

  const { c, st, foe, ruby, kolt } = field();
  assert.equal(c.setWeather("snow", { by: kolt.id }), null);
  assert.equal(st.weatherBy, kolt.id);
  const out = c.dealTo(ruby, foe, hit(20, "physical"));
  const up = st.battleStats[ruby.id].dmg - plain;
  assert.ok(up > 0);
  assert.equal(out.res.weatherUp, up);
  assert.equal(part(st, "env"), up);
  assert.equal(st.battleStats[kolt.id].weatherUp, up);
});

test("天气：我方因天气少挨的伤害，天气的所有者按减伤分（×1.5）加分", () => {
  const base = field();
  base.c.dealTo(base.foe, base.ruby, hit(20, "fire"));
  const plain = base.st.battleStats[base.ruby.id].taken;

  const { c, st, foe, ruby, kolt } = field();
  c.setWeather("snow", { by: kolt.id });
  const out = c.dealTo(foe, ruby, hit(20, "fire"));
  const down = plain - st.battleStats[ruby.id].taken;
  assert.ok(down > 0);
  assert.equal(out.res.weatherDown, down);
  assert.equal(part(st, "env"), Math.floor(down * 1.5));
  assert.equal(st.battleStats[kolt.id].weatherDown, down);
});

test("没有所有者的天气（主持人 / 固有）、或天气帮敌人：不加环境分", () => {
  const a = field();
  a.c.setWeather("snow");
  assert.equal(a.st.weatherBy, null);
  a.c.dealTo(a.ruby, a.foe, hit(20, "physical"));
  assert.equal(part(a.st, "env"), 0);

  const b = field();
  b.c.setWeather("snow", { by: b.kolt.id });
  b.c.dealTo(b.foe, b.ruby, hit(20, "physical"));   // 雪天物理 +25%：帮的是敌人
  assert.equal(part(b.st, "env"), 0);
});

test("SCORE_RULES / 名称：环境分数倍率 1.2，结算里叫「环境」", () => {
  const { c } = field();
  assert.equal(c.S.SCORE_RULES.env, 1.2);
  assert.match(require("fs").readFileSync(require("path").join(__dirname, "..", "app.js"), "utf8"), /env: "环境"/);
});

test("能量场自爆：炸掉的血量、溢出、余波都算环境分，记在能量场的所有者身上", () => {
  const { c, st, foe, kolt } = field();
  c.setZoneField(1, "energy", { by: kolt.id, force: true });
  const f = st.fields[1];
  f.energyVal = 50;
  foe.layers = [{ type: "flesh", current: 20, max: 900 }];
  st.units.filter(u => u.isPlayer).forEach(u => { u.zone = 2; });
  c.checkEnergyFieldBoom(1, []);
  assert.ok(c.totalHp(foe) <= 0);
  assert.equal(st.battleStats[kolt.id].env, 20);
  // 20 点 ×1.2 = 24；溢出 (50 − 20) × 1.5 = 45，×1.2 = 54
  assert.equal(part(st, "env"), 24 + 54);
  assert.equal(part(st, "overkill"), 0);
});

test("能量场自爆炸死了我方单位：这次不加环境分", () => {
  const { c, st, foe, kolt, ruby } = field();
  c.setZoneField(1, "energy", { by: kolt.id, force: true });
  st.fields[1].energyVal = 50;
  foe.layers = [{ type: "flesh", current: 20, max: 900 }];
  st.units.filter(u => u.isPlayer && u !== ruby).forEach(u => { u.zone = 2; });
  // 余波打爆同区的爆炸桶，爆炸桶炸死起身中的瑞比
  st.props = [{ id: "pb2", kind: "boom", name: "爆炸桶", zone: 1, hp: 1, level: 1 }];
  ruby.layers = [{ type: "flesh", current: 0, max: 300 }];
  ruby.upOnShp = true; ruby.shp = 1;
  c.checkEnergyFieldBoom(1, []);
  assert.ok(c.totalHp(foe) <= 0);
  assert.equal(ruby.dead, true);
  assert.equal(part(st, "env"), 0);
  assert.equal(st.battleStats[kolt.id].env || 0, 0);
});

test("损毁地面塌成深渊：掉下去的敌人失去的血量算环境分（记在这次行动的出手方身上）", () => {
  const { c, st, foe, ruby } = field();
  st.units.filter(u => u.isPlayer).forEach(u => { u.zone = 2; });
  st.fields[1].ruinOn = true; st.fields[1].ruinHp = 0;
  c.beginActionAcc(ruby);
  const before = c.totalHp(foe);
  c.destroyRuinGround(1, []);
  const lost = before - c.totalHp(foe);
  assert.equal(lost, 90);
  assert.equal(st.battleStats[ruby.id].env, 90);
  assert.equal(part(st, "env"), Math.floor(90 * 1.2));
});

test("塌陷：造成的伤害算环境分", () => {
  const { c, st, foe, ruby } = field();
  st.units.filter(u => u.isPlayer).forEach(u => { u.zone = 2; });
  st.fields[1].collapseOn = true;
  c.beginActionAcc(ruby);
  const before = c.totalHp(foe);
  c.triggerCollapse(1);
  const lost = before - c.totalHp(foe);
  assert.ok(lost > 0);
  assert.equal(st.battleStats[ruby.id].env, lost);
});
