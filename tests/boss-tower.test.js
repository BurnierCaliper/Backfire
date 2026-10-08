// 首领机制·踩塔（boss-mechanics.js）：随机标记区域，倒计时到了要有人站在里面踩住（每人挨一点伤害），
// 人数不够（没人踩）→ 我方全员挨巨额伤害，或者接首领专属的惩罚
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");

const hp = (u) => u.layers.reduce((a, l) => a + (Number(l.current) || 0), 0);
function field(cfg, seed) {
  const c = H.load();
  c.BattleSim.setup({ party: ["helu", "ruby", "hiaki"], enemies: [{ id: "thug_knife", lv: 5, zone: 2 }], seed: seed || "TOWER-T", zoneMode: 3 });
  const S = c.S.state;
  const boss = S.units.find(u => !u.isPlayer);
  boss.layers.forEach(l => { l.current = l.max = 999; });
  const heroes = S.units.filter(u => u.isPlayer && !u.hidden);
  heroes.forEach(u => { u.layers.forEach(l => { l.current = l.max = 300; }); u.def = u.defMax = 99; u.zone = 1; });
  c.addBossMechanic(boss, Object.assign({ type: "tower", turns: 1, soak: { flat: 5 }, fail: { kind: "raid", flat: 60 } }, cfg || {}));
  c.startCombat();
  const tower = () => boss.mechanics[0].st.zones || [];
  return { c, S, boss, heroes, tower, log: () => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n") };
}
function toFall(c) { c.endPlayerTurn(); c.endEnemyTurn(); c.endPlayerTurn(); }

test("开战随机标记一个区；区域上显示倒计时和现在几个人在里面", () => {
  const { c, tower } = field();
  const z = tower();
  assert.equal(z.length, 1);
  assert.ok(z[0] >= 1 && z[0] <= 3);
  const mk = c.bossZoneMarks(z[0])[0];
  assert.equal(mk.left, 1);
  assert.equal(mk.need, 1);
  assert.equal(mk.soak, 5);
  assert.equal(mk.fail, 60);
  // 种子不同，标的区可以不同
  const seen = new Set();
  for (const sd of ["A", "B", "C", "D", "E", "F", "G", "H"]) seen.add(field(null, "TOWER-" + sd).tower()[0]);
  assert.ok(seen.size > 1);
});

test("有人踩住：只有踩塔的人挨一点伤害，别人不挨；不能格挡", () => {
  const { c, S, heroes, tower, log } = field();
  const z = tower()[0];
  const soaker = heroes[0];
  heroes.forEach(u => { u.zone = u === soaker ? z : (z === 1 ? 2 : 1); });
  const before = heroes.map(hp);
  toFall(c);
  assert.equal((S.blockQueue || []).length, 0);
  assert.ok(before[0] - hp(soaker) > 0 && before[0] - hp(soaker) <= 5, "踩塔的人挨了不高的伤害");
  heroes.slice(1).forEach((u, i) => assert.equal(hp(u), before[i + 1], u.name + " 不挨"));
  assert.match(log(), /有 1 人踩住/);
});

test("没人踩：我方全员挨巨额伤害", () => {
  const { c, heroes, tower, log } = field();
  const z = tower()[0];
  heroes.forEach(u => { u.zone = z === 1 ? 2 : 1; });
  const before = heroes.map(hp);
  toFall(c);
  heroes.forEach((u, i) => assert.ok(before[i] - hp(u) > 20, `${u.name} 挨了 ${before[i] - hp(u)}`));
  assert.match(log(), /没人踩住.*失败/);
  assert.match(log(), /塔爆发/);
});

test("每座塔要求的人数不够也算失败；多座塔分别结算", () => {
  const { c, heroes, boss, log } = field({ count: 2, need: 2 });
  const zones = boss.mechanics[0].st.zones;
  assert.equal(zones.length, 2);
  assert.notEqual(zones[0], zones[1]);
  // 第一座塔站 2 人，第二座只站 1 人
  heroes[0].zone = zones[0]; heroes[1].zone = zones[0]; heroes[2].zone = zones[1];
  toFall(c);
  assert.match(log(), new RegExp(`${zones[0]} 区的塔有 2 人踩住`));
  assert.match(log(), new RegExp(`${zones[1]} 区的塔没人踩住（1/2 人）`));
});

test("失败惩罚可以换成首领专属的（hook）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["helu", "ruby"], enemies: [{ id: "thug_knife", lv: 5, zone: 2 }], seed: "TOWER-HOOK", zoneMode: 3 });
  const S = c.S.state, boss = S.units.find(u => !u.isPlayer);
  S.units.filter(u => u.isPlayer).forEach(u => { u.zone = 1; });
  c.BOSS_MECH_HOOKS_TEST = true;
  vm.runInContext(`BOSS_MECH_HOOKS.enrage = (boss, m, zone, notes) => { boss.atk += 100; notes.push(boss.name + " 狂暴了（" + zone + " 区没人踩）"); };`, c);
  c.addBossMechanic(boss, { type: "tower", turns: 1, fail: { kind: "hook", hook: "enrage" } });
  c.startCombat();
  const z = boss.mechanics[0].st.zones[0];
  S.units.filter(u => u.isPlayer).forEach(u => { u.zone = z === 1 ? 2 : 1; });
  const atk = boss.atk;
  toFall(c);
  assert.equal(boss.atk, atk + 100);
  assert.match(S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n"), /狂暴了/);
});

test("首领失衡推迟一回合；只放一次的落下后不再标记；不选深渊", () => {
  const a = field();
  const b = a.heroes.map(hp);
  a.heroes.forEach(u => { u.zone = a.tower()[0] === 1 ? 2 : 1; });
  a.c.endPlayerTurn(); a.c.endEnemyTurn();
  a.boss.stunned = true;   // 第 2 回合敌人回合开始该落下时首领失衡
  a.c.endPlayerTurn();
  a.heroes.forEach((u, i) => assert.equal(hp(u), b[i]));
  assert.match(a.log(), /推迟一回合/);
  const once = field({ then: "once" });
  toFall(once.c);
  assert.equal(once.tower().length, 0);
  // 深渊
  const c = H.load();
  c.BattleSim.setup({ party: ["helu"], enemies: [{ id: "thug_knife", lv: 5, zone: 2 }], seed: "TOWER-ABYSS", zoneMode: 3 });
  c.S.state.fields[1] = Object.assign(c.S.state.fields[1] || {}, { abyss: true });
  c.S.state.fields[3] = Object.assign(c.S.state.fields[3] || {}, { abyss: true });
  const boss = c.S.state.units.find(u => !u.isPlayer);
  c.addBossMechanic(boss, { type: "tower", turns: 1 });
  c.startCombat();
  assert.deepEqual([...boss.mechanics[0].st.zones], [2]);
});

test("战场配置指令：挂上 / 去掉踩塔，格式不对被拦下；联机投影带上塔的区和人数要求", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["tou", "kolt"], enemies: [{ id: "thug_knife", lv: 5, zone: 1 }], seed: "TOWER-P", zoneMode: 3 });
  c.startCombat();
  const S = c.S.state, boss = S.units.find(u => !u.isPlayer);
  const r = c.Commands.dispatch({ type: "battle.panel", action: "setTower", actor: boss.id, cfg: { phase: "player", turns: 2, then: "repeat", count: 2, need: 1, soak: 0.5, fail: 5 } });
  assert.match(r.notes.join(), /踩塔/);
  assert.equal(boss.mechanics[0].st.zones.length, 2);
  assert.throws(() => c.Commands.dispatch({ type: "battle.panel", action: "setTower", actor: boss.id, cfg: { phase: "player", turns: 2, then: "repeat", count: 9, need: 1, soak: 0.5, fail: 5 } }), /count/);
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, "online-view.js"), "utf8"), c, { filename: "online-view.js" });
  const pv = c.OnlineView.projectState(S).units.find(u => u.id === boss.id);
  assert.equal(pv.mechanics[0].type, "tower");
  assert.equal(pv.mechanics[0].need, 1);
  assert.equal(pv.mechanics[0].st.zones.length, 2);
  assert.equal(pv.mechanics[0].fail, undefined, "伤害数值不同步");
  c.Commands.dispatch({ type: "battle.panel", action: "setTower", actor: boss.id, cfg: null });
  assert.equal(boss.mechanics, undefined);
});
