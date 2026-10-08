// 首领机制·远离（boss-mechanics.js）：标记我方全员，倒计时到了每人在自己的区爆炸一次，
// 同区有几个标记就炸几次、每次每个人都挨，不能格挡——要分开站
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");

const hp = (u) => u.layers.reduce((a, l) => a + (Number(l.current) || 0), 0);
/** zones：三名角色各站哪个区（[1,2,3] = 分开，[1,1,1] = 挤在一起） */
function field(zones, cfg, seed) {
  const c = H.load();
  c.BattleSim.setup({ party: ["helu", "ruby", "hiaki"], enemies: [{ id: "thug_knife", lv: 5, zone: 2 }], seed: seed || "SPREAD-T", zoneMode: 3 });
  const S = c.S.state;
  const boss = S.units.find(u => !u.isPlayer);
  boss.layers.forEach(l => { l.current = l.max = 999; });
  const heroes = S.units.filter(u => u.isPlayer && !u.hidden);
  heroes.forEach(u => { u.layers.forEach(l => { l.current = l.max = 200; }); u.def = u.defMax = 99; });
  ["helu", "ruby", "hiaki"].forEach((k, i) => { const u = heroes.find(x => x.kit === k); if (u) u.zone = zones[i]; });
  c.addBossMechanic(boss, Object.assign({ type: "spread", turns: 1, blast: { flat: 10 } }, cfg || {}));
  c.startCombat();
  return { c, S, boss, heroes, unit: (k) => heroes.find(u => u.kit === k) };
}
function toFall(c) { c.endPlayerTurn(); c.endEnemyTurn(); c.endPlayerTurn(); }

test("开战标记我方全员；标记上写着现在这个区有几个标记", () => {
  const { c, heroes, unit, boss } = field([1, 1, 3]);
  heroes.forEach(u => assert.equal(c.spreadMarksOn(u).length, 1, u.name));
  assert.equal(c.spreadMarksOn(unit("helu"))[0].stack, 2, "1 区两个标记");
  assert.equal(c.spreadMarksOn(unit("hiaki"))[0].stack, 1);
  assert.equal(c.spreadMarksOn(unit("helu"))[0].blast, 10);
  assert.match(c.bossCastsBy(boss)[0].target, /全员（3）/);
});

test("分开站：每人只挨自己那一次；挤在一起：每人挨好几次", () => {
  const apart = field([1, 2, 3]), crowd = field([1, 1, 1]);
  const lost = ({ c, heroes }) => { const b = heroes.map(hp); toFall(c); return heroes.map((u, i) => b[i] - hp(u)); };
  const la = lost(apart), lc = lost(crowd);
  la.forEach((d, i) => assert.ok(d > 0, "每人至少被自己的标记炸一次"));
  lc.forEach((d, i) => assert.ok(d >= la[i] * 2.5, `挤在一起挨 ${d}，分开挨 ${la[i]}`));
  assert.equal((crowd.S.blockQueue || []).length, 0, "不能格挡");
  const log = crowd.S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
  assert.match(log, /【远离】.*1 区 3 次/);
});

test("落下前倒下的人：他的标记没了，不会再炸", () => {
  const { c, S, boss, unit } = field([1, 1, 3]);
  const ruby = unit("ruby"), helu = unit("helu");
  c.dealTo(boss, ruby, { atk: 0, mult: 0, flat: 9999, element: "physical", baseBreak: 0, flags: { action: false, block: "none", blockResolved: true } });
  assert.ok(ruby.dying || ruby.dead);
  assert.equal(c.spreadMarksOn(ruby).length, 0);
  assert.equal(c.spreadMarksOn(helu)[0].stack, 1, "1 区只剩 Helumica 一个标记");
  const b = hp(helu);
  toFall(c);
  const log = S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
  assert.match(log, /引爆了 2 个标记/);
  assert.ok(b - hp(helu) > 0);
});

test("落下后重新标记全员；只放一次的不再标记", () => {
  const rep = field([1, 2, 3]);
  toFall(rep.c);
  rep.heroes.filter(u => !u.dying && !u.dead).forEach(u => assert.equal(rep.c.spreadMarksOn(u).length, 1));
  const once = field([1, 2, 3], { then: "once" });
  toFall(once.c);
  once.heroes.forEach(u => assert.equal(once.c.spreadMarksOn(u).length, 0));
});

test("战场配置指令：挂上 / 去掉远离，格式不对被拦下；联机投影带上全员标记", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["tou", "kolt"], enemies: [{ id: "thug_knife", lv: 5, zone: 1 }], seed: "SPREAD-P" });
  c.startCombat();
  const S = c.S.state, boss = S.units.find(u => !u.isPlayer);
  const r = c.Commands.dispatch({ type: "battle.panel", action: "setSpread", actor: boss.id, cfg: { phase: "enemy", turns: 2, then: "repeat", mult: 1.5 } });
  assert.match(r.notes.join(), /远离/);
  assert.equal(boss.mechanics[0].blast.mult, 1.5);
  assert.throws(() => c.Commands.dispatch({ type: "battle.panel", action: "setSpread", actor: boss.id, cfg: { phase: "enemy", turns: 25, then: "repeat", mult: 1 } }), /turns/);
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, "online-view.js"), "utf8"), c, { filename: "online-view.js" });
  const pv = c.OnlineView.projectState(S).units.find(u => u.id === boss.id);
  assert.equal(pv.mechanics[0].type, "spread");
  assert.equal(pv.mechanics[0].st.targetIds.length, S.units.filter(u => u.isPlayer && !u.hidden).length);
  assert.equal(pv.mechanics[0].blast, undefined, "伤害数值不同步");
  c.Commands.dispatch({ type: "battle.panel", action: "setSpread", actor: boss.id, cfg: null });
  assert.equal(boss.mechanics, undefined);
});

test("三种机制挂在同一个首领身上，自动对打能打完", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["tou", "kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 1 }], seed: "MECH-ALL", zoneMode: 3 });
  const boss = c.S.state.units.find(u => !u.isPlayer);
  c.addBossMechanic(boss, { type: "execution", turns: 2, hits: [{ mult: 1 }] });
  c.addBossMechanic(boss, { type: "share", turns: 3, pool: { mult: 2 } });
  c.addBossMechanic(boss, { type: "spread", turns: 2, blast: { mult: 0.5 } });
  const r = c.BattleSim.run({ maxRounds: 20 });
  assert.ok(["player", "enemy", "timeout"].includes(r.winner));
});
