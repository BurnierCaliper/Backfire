// 作者试玩反馈（10/20）：柯尔特满血减伤的仪表和实际生效对不上；协助攻击打死自爆小车时播错演出
// （README「规则改动记录」里有对应说明）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const H = require("./headless");

function setup(party, enemies) {
  const c = H.load();
  c.BattleSim.setup({ party, enemies, seed: "FB20" });
  c.startCombat();
  // 角色仪表（hud-icons.js）装进同一个环境：和画面里一样，能直接调用规则里的函数
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, "hud-icons.js"), "utf8"), c);
  const S = c.S.state;
  S.units.forEach(u => { if (u.kit === "kolt") u.zone = 1; });
  return { c, S, K: k => S.units.find(u => u.kit === k && !u.hidden && !u.dead), HI: c.HudIcons };
}
const hit = (c, a, t, extra) => c.dealTo(a, t, Object.assign({ atk: 10, mult: 1, element: "physical", baseBreak: 1, atkRange: "any",
  flags: { action: true, blockResolved: true, block: "none" } }, extra || {}));
const prideIn = (out) => /过度自信：血量不低于进入战斗时的上限/.test(((out && out.res && out.res.log) || []).join("\n"));

/* ---------- 柯尔特：过度自信的满血减伤 ---------- */

test("柯尔特满血减伤：临时护盾把上限抬高时，规则照样减伤，仪表也跟着亮（以前按现在的上限算，不亮）", () => {
  const { c, S, K, HI } = setup(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const kolt = K("kolt"), foe = K("thug_knife");
  foe.zone = 1;
  const gauge = () => HI.gaugeState(kolt, S.units);
  const base = c.baseMaxHp(kolt);
  assert.equal(kolt.prideMaxHp, base, "开战记下进入战斗时的上限");
  assert.equal(gauge().full, true, "开战满血：亮");
  assert.ok(c.koltPrideCut(kolt) > 0);
  // 掉一点血：不亮、不减
  const inner = kolt.layers[kolt.layers.length - 1];
  inner.current -= 3;
  assert.equal(c.koltPrideCut(kolt), 0);
  assert.equal(gauge().full, false);
  // 拿到临时护盾：现有血量回到进入战斗时的上限以上（上限也被抬高了）
  c.addTempShield(kolt, 10);
  assert.ok(c.totalCurHp(kolt) >= base && c.totalCurHp(kolt) < c.totalMaxHp(kolt));
  assert.ok(c.koltPrideCut(kolt) > 0, "规则：减伤生效");
  assert.equal(gauge().full, true, "仪表跟着亮");
  assert.match(HI.gauge(gauge()), /满血减伤 25%/);
  assert.ok(prideIn(hit(c, foe, kolt)), "真的挨打时结算里有过度自信减伤");
});

test("柯尔特满血减伤：被动被图纸放弃时规则不减伤，仪表也不亮（以前照亮「满血减伤」）；起身中同样不亮", () => {
  const { c, S, K, HI } = setup(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const kolt = K("kolt"), foe = K("thug_knife");
  foe.zone = 1;
  S.weaponMods = { torque: { noPassive: true } };
  kolt.weaponLevels = Object.assign({}, kolt.weaponLevels, { torque: 4 });   // 图纸武器 4 级才生效
  assert.equal(c.passiveOn(kolt), false, "图纸放弃了柯尔特的被动");
  assert.equal(c.koltPrideCut(kolt), 0);
  const g = HI.gaugeState(kolt, S.units);
  assert.equal(g.full, false, "仪表不亮");
  assert.match(HI.gauge(g), /过度自信已放弃/);
  assert.ok(!prideIn(hit(c, foe, kolt)), "结算也不减");
  // 起身中（靠坚毅生命）：不减伤，仪表写明
  S.weaponMods = {};
  kolt.upOnShp = true;
  assert.equal(c.koltPrideCut(kolt), 0);
  const g2 = HI.gaugeState(kolt, S.units);
  assert.equal(g2.full, false);
  assert.match(HI.gauge(g2), /起身中不减伤/);
});

/* ---------- 自爆小车：死亡引爆不算打死它的那一击的演出 ---------- */

test("协助攻击打死自爆小车：小车的死亡引爆是爆炸（弹字标 boom），不算协助攻击本身的伤害（以前每个被炸到的人身上都补一遍协助攻击的打击形状）", () => {
  const { c, S, K } = setup(["kolt", "helu"], [{ id: "boomcar", lv: 3, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }]);
  const kolt = K("kolt"), helu = K("helu"), car = K("boomcar"), thug = K("thug_knife");
  S.units.forEach(u => { u.zone = 1; });
  car.atk = Math.max(8, Number(car.atk) || 0);   // 引爆伤害 = atk / 2：确保打得出数字
  car.layers.forEach(l => { l.current = Math.min(l.current, 1); });   // 一下就打死
  car.def = 0; car.stunned = true;
  // 记下弹字（画面层 game.js 也是这样接 spawnPopup 的）
  const pops = [];
  c.spawnPopup = (u, spec) => { if (u) pops.push(Object.assign({ unitId: u.id, tag: S.popTag || null }, spec || {})); };
  c.queueAssistAttack(kolt, car);
  assert.equal(S.assistQueue.length, 1, "失衡的小车进了协助攻击队列");
  c.finishAssist(helu.id, {});
  assert.ok(car.dead || car._exploded, "小车被协助攻击打死");
  assert.equal(car._exploded, true, "死亡引爆");
  const dmg = pops.filter(p => p.kind === "dmg" && (Number(p.value) || 0) > 0);
  const onCar = dmg.filter(p => p.unitId === car.id);
  const blast = dmg.filter(p => p.unitId !== car.id);
  assert.ok(onCar.some(p => p.main), "协助攻击打小车的那一下是主攻击");
  assert.ok(blast.some(p => p.unitId === thug.id), "引爆炸到同区的狂徒");
  assert.ok(blast.length >= 2, "同区的人都挨了引爆");
  assert.ok(blast.every(p => !p.main), "引爆的伤害不是主攻击");
  assert.ok(blast.every(p => p.tag === "boom"), "引爆的弹字标成爆炸");
  assert.equal(S.popTag || null, null, "标记用完还原");
});

test("我方操控的碎渣机炮那一炮照旧算这次行动的主攻击；爆炸桶的爆炸不算", () => {
  const { c, S, K } = setup(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const kolt = K("kolt"), thug = K("thug_knife");
  S.units.forEach(u => { u.zone = 1; });
  thug.layers.forEach(l => { l.max = l.current = 300; });
  const pops = [];
  c.spawnPopup = (u, spec) => { if (u) pops.push(Object.assign({ unitId: u.id }, spec || {})); };
  const scrap = c.makeProp("scrap", 1, 1);
  S.props.push(scrap);
  c.scrapShot(scrap, thug, kolt);
  const shots = pops.filter(p => p.kind === "dmg" && p.unitId === thug.id && (Number(p.value) || 0) > 0);
  assert.ok(shots.length >= 1 && shots.every(p => p.main), "机炮打出的是主攻击");
  pops.length = 0;
  const boom = c.makeProp("boom", 1, 1);
  S.props.push(boom);
  c.hitStructureCore(kolt, "prop:" + boom.id, { dmg: 10, brk: 1, element: "fire" });
  const blast = pops.filter(p => p.kind === "dmg" && p.unitId === thug.id && (Number(p.value) || 0) > 0);
  assert.ok(blast.length >= 1 && blast.every(p => !p.main), "爆炸桶炸到人是连带伤害");
});
