// 首领机制·分担（boss-mechanics.js）：随机标记一人，倒计时到了在回合开始时对他所在区落下，
// 伤害池由同区的友方平均分担、不能格挡；和死刑共用计时、转标、失衡推迟、重复的流程
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const hp = (u) => u.layers.reduce((a, l) => a + (Number(l.current) || 0), 0);
function field(cfg, seed) {
  const c = H.load();
  c.BattleSim.setup({ party: ["tou", "kolt", "helu"], enemies: [{ id: "thug_knife", lv: 5, zone: 2 }], seed: seed || "SHARE-T" });
  const S = c.S.state;
  const boss = S.units.find(u => !u.isPlayer);
  boss.layers.forEach(l => { l.current = l.max = 999; });
  S.units.filter(u => u.isPlayer).forEach(u => { u.zone = 1; u.layers.forEach(l => { l.current = l.max = 100; }); u.def = u.defMax = 99; });
  c.addBossMechanic(boss, Object.assign({ type: "share", turns: 1, pool: { flat: 30 } }, cfg || {}));
  c.startCombat();
  const target = () => S.units.find(u => c.shareMarksOn(u).length);
  return { c, S, boss, target };
}
/** 打到第 2 回合敌人回合开始（turns = 1 时就是落下的那一刻） */
function toFall(c) { c.endPlayerTurn(); c.endEnemyTurn(); c.endPlayerTurn(); }

test("开战随机标记一名我方单位；标记上带伤害池和现在同区几个人", () => {
  const { c, S, target } = field();
  const t = target();
  assert.ok(t && t.isPlayer);
  const mk = c.shareMarksOn(t)[0];
  assert.equal(mk.left, 1);
  assert.equal(mk.pool, 30);
  assert.equal(mk.group, 3, "三个人都在 1 区");
  assert.ok(!S.units.some(u => c.executionMarksOn(u).length), "不是死刑");
  // 种子不同，标到的人可以不同（随机）
  const names = new Set();
  for (const sd of ["A", "B", "C", "D", "E", "F", "G", "H"]) names.add(field(null, "SHARE-" + sd).target().kit);
  assert.ok(names.size > 1, [...names].join());
});

test("落下：伤害池由目标所在区的友方平均分担，不能格挡；别的区不受影响", () => {
  const { c, S, target } = field();
  const t = target();
  const away = S.units.find(u => u.isPlayer && u.id !== t.id && !c.isWeaponUnit(u));
  away.zone = 2;
  const group = S.units.filter(u => u.isPlayer && !u.hidden && !u.dead && Number(u.zone) === 1);
  const before = new Map(S.units.map(u => [u.id, hp(u)]));
  toFall(c);
  assert.equal((S.blockQueue || []).length, 0, "不排格挡");
  const each = Math.ceil(30 / group.length);
  group.forEach(u => assert.ok(before.get(u.id) - hp(u) > 0 && before.get(u.id) - hp(u) <= each, `${u.name} 挨了 ${before.get(u.id) - hp(u)}，分到 ${each}`));
  assert.equal(hp(away), before.get(away.id), "不在那个区的不挨");
  assert.match(S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n"), /【分担】.*每人 \d+（不能格挡）/);
});

test("聚在一起的人越多，每个人挨得越少", () => {
  const alone = field(), crowd = field();
  const a = alone.target();
  alone.S.units.filter(u => u.isPlayer && u.id !== a.id).forEach(u => { u.zone = 2; });
  const ab = hp(a); toFall(alone.c);
  const t = crowd.target();
  const cb = hp(t); toFall(crowd.c);
  assert.ok(ab - hp(a) > cb - hp(t), `一个人扛 ${ab - hp(a)}，一起扛 ${cb - hp(t)}`);
});

test("目标倒地立刻转标；首领失衡推迟一回合", () => {
  const { c, S, boss, target } = field({ turns: 2 });
  const t = target();
  c.dealTo(boss, t, { atk: 0, mult: 0, flat: 999, element: "physical", baseBreak: 0, flags: { action: false, block: "none", blockResolved: true } });
  const nt = target();
  assert.ok(nt && nt.id !== t.id && !nt.dying);
  // 第 3 回合敌人回合开始该落下：首领失衡 → 推迟
  c.endPlayerTurn(); c.endEnemyTurn(); c.endPlayerTurn(); c.endEnemyTurn();
  boss.stunned = true;
  const b = hp(nt);
  c.endPlayerTurn();
  assert.equal(hp(nt), b);
  assert.match(S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n"), /「分担」被打断蓄力，推迟一回合/);
});

test("无视射程：首领在别的区也砸得到；只放一次之后不再标记", () => {
  const { c, S, target } = field({ then: "once" });
  const t = target(); const b = hp(t);
  toFall(c);
  assert.ok(hp(t) < b);
  assert.ok(!target(), "只放一次");
  void S;
});

test("死刑和分担可以同时挂在一个首领身上，各算各的", () => {
  const { c, S, boss } = field();
  c.addBossMechanic(boss, { type: "execution", turns: 1, hits: [{ mult: 1 }] });
  c.bossMechSync([]);
  assert.ok(S.units.some(u => c.executionMarksOn(u).length));
  assert.ok(S.units.some(u => c.shareMarksOn(u).length));
  assert.equal(c.bossCastsBy(boss).length, 2);
});

test("战场配置指令：挂上 / 去掉分担，格式不对被拦下；联机投影带上标记", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["tou", "kolt"], enemies: [{ id: "thug_knife", lv: 5, zone: 1 }], seed: "SHARE-P" });
  c.startCombat();
  const S = c.S.state, boss = S.units.find(u => !u.isPlayer);
  const r = c.Commands.dispatch({ type: "battle.panel", action: "setShare", actor: boss.id, cfg: { phase: "player", turns: 2, then: "repeat", mult: 5 } });
  assert.match(r.notes.join(), /分担/);
  assert.equal(boss.mechanics[0].type, "share");
  assert.equal(boss.mechanics[0].pool.mult, 5);
  assert.ok(S.units.some(u => c.shareMarksOn(u).length));
  assert.throws(() => c.Commands.dispatch({ type: "battle.panel", action: "setShare", actor: boss.id, cfg: { phase: "enemy", turns: 2, then: "repeat", mult: 0 } }), /multiplier/);
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, "online-view.js"), "utf8"), c, { filename: "online-view.js" });
  const view = c.OnlineView.projectState(S);
  const pv = view.units.find(u => u.id === boss.id);
  assert.equal(pv.mechanics[0].type, "share");
  assert.ok(pv.mechanics[0].st.targetId);
  assert.equal(pv.mechanics[0].pool, undefined, "伤害数值不同步");
  c.Commands.dispatch({ type: "battle.panel", action: "setShare", actor: boss.id, cfg: null });
  assert.equal(boss.mechanics, undefined);
});
