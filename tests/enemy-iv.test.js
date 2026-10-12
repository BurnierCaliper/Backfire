// 个体值：杂兵、精英的血量和 atk 各在 ±10% 内波动；首领不波动；跑团主持人可以写死水平
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const gmSource = new vm.Script(fs.readFileSync(path.join(H.ROOT, "gm-commands.js"), "utf8"), { filename: "gm-commands.js" });
const plain = v => JSON.parse(JSON.stringify(v));

function ctx() {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "helu"], enemies: [], seed: "IV" });
  return c;
}
const baseOf = (c, id, lv) => c.enemyPresets().find(p => p.id === id).build(lv, 2);

test("杂兵：每个都有个体值，血量、atk 都在 ±10% 内，按水平算", () => {
  const c = ctx();
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    const base = baseOf(c, "thug_hammer", 5);
    const [u] = c.spawnEnemyGroup("thug_hammer", 5, 2, 2);
    assert.ok(u.iv, "有个体值");
    assert.ok(u.iv.hp >= -10 && u.iv.hp <= 10 && Number.isInteger(u.iv.hp));
    assert.ok(u.iv.atk >= -10 && u.iv.atk <= 10 && Number.isInteger(u.iv.atk));
    const bmax = base.layers[0].max;
    assert.equal(u.layers[0].max, Math.max(1, Math.round(bmax * (1 + u.iv.hp / 100))));
    assert.equal(u.layers[0].current, u.layers[0].max);
    assert.equal(u.atk, Math.round(base.atk * (1 + u.iv.atk / 100) * 10) / 10);
    // 出手用的 atk 也跟着变
    assert.equal(c.effectiveAtk(u, c.S.state.units), Math.round(base.personalAtk * (1 + u.iv.atk / 100) * 10) / 10);
    assert.ok(Math.abs(u.layers[0].max - bmax) <= Math.ceil(bmax * 0.1));
    seen.add(u.iv.hp);
  }
  assert.ok(seen.size > 5, "确实在波动");
});

test("精英也波动，首领不波动", () => {
  const c = ctx();
  const [elite] = c.spawnEnemyGroup("bandit_boss", 5, 2, 2);
  assert.ok(elite.iv);
  const [boss] = c.spawnEnemyGroup("outlaw_king", 5, 2, 2);
  assert.equal(boss.iv, undefined);
  assert.equal(boss.layers[0].max, baseOf(c, "outlaw_king", 5).layers[0].max);
});

test("写死的水平照写；改水平按原始数值重算，不会越改越偏，已受的伤按比例保留", () => {
  const c = ctx();
  const base = baseOf(c, "thug_hammer", 5);
  const [u] = c.spawnEnemyGroup("thug_hammer", 5, 2, 2, { hp: 10, atk: -10 });
  assert.equal(u.iv.hp, 10); assert.equal(u.iv.atk, -10);
  assert.equal(u.layers[0].max, Math.round(base.layers[0].max * 1.1));
  assert.equal(u.atk, Math.round(base.atk * 0.9 * 10) / 10);
  // 打掉一半，再改水平
  u.layers[0].current = Math.round(u.layers[0].max / 2);
  c.setEnemyIV(u, { hp: -10, atk: 0 });
  c.setEnemyIV(u, { hp: -10, atk: 0 });
  assert.equal(u.layers[0].max, Math.round(base.layers[0].max * 0.9));
  assert.ok(Math.abs(u.layers[0].current - u.layers[0].max / 2) <= 1);
  assert.equal(u.atk, base.atk);
  // 超出范围的水平夹到 ±10
  const [v] = c.spawnEnemyGroup("thug_knife", 3, 2, 2, { hp: 50, atk: -99 });
  assert.deepEqual(plain(v.iv), { hp: 10, atk: -10 });
  // 只写一项：另一项随机
  const [w] = c.spawnEnemyGroup("thug_knife", 3, 2, 2, { hp: 3, atk: null });
  assert.equal(w.iv.hp, 3);
});

test("无界面模拟（BattleSim.setup）默认不波动；单局的战斗（iv: true）波动", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "IV2" });
  const a = c.S.state.units.find(u => !u.isPlayer);
  assert.equal(a.iv, undefined);
  assert.equal(a.layers[0].max, baseOf(c, "thug_knife", 3).layers[0].max);
  c.BattleSim.setup({ party: ["ruby"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "IV2", iv: true });
  assert.ok(c.S.state.units.find(u => !u.isPlayer).iv);
  // 关着的时候主持人写死的水平仍然生效
  c.BattleSim.setup({ party: ["ruby"], enemies: [{ id: "thug_knife", lv: 3, zone: 2, iv: { hp: -5, atk: 5 } }], seed: "IV2" });
  assert.deepEqual(plain(c.S.state.units.find(u => !u.isPlayer).iv), { hp: -5, atk: 5 });
});

test("战斗模板：敌人行（含援军）可以写个体值水平，开战时照写", () => {
  const c = ctx();
  const t = c.battleTemplateNormalize({ name: "IV", enemies: [{ preset: "thug_knife", level: 3, zone: 2, iv: { hp: 7, atk: "-4" } }, { preset: "thug_hammer", level: 3, zone: 2, iv: { hp: "", atk: null } }],
    waves: [{ turns: 2, enemies: [{ preset: "thug_knife", level: 3, zone: 2, iv: { hp: -8, atk: 2 } }] }] });
  assert.deepEqual(plain(t.enemies[0].iv), { hp: 7, atk: -4 });
  assert.equal(t.enemies[1].iv, undefined);
  assert.deepEqual(plain(t.waves[0].enemies[0].iv), { hp: -8, atk: 2 });
  const enc = c.battleTemplateToEncounter(t);
  c.buildEncounter(enc, 3, 2);
  const foes = c.S.state.units.filter(u => !u.isPlayer);
  assert.deepEqual(plain(foes.find(u => u.kit === "thug_knife").iv), { hp: 7, atk: -4 });
  assert.ok(foes.find(u => u.kit === "thug_hammer").iv, "没写的随机");
  assert.deepEqual(plain(enc.waves[0].enemies[0].iv), { hp: -8, atk: 2 });
});

test("主持人：生成敌人可以写水平；战斗中可以改单位的个体值；首领、超范围被拒绝", () => {
  const c = H.load(); gmSource.runInContext(c);
  c.BattleSim.setup({ party: ["ruby", "helu"], enemies: [{ id: "outlaw_king", lv: 3, zone: 2 }], seed: "IV-GM" });
  const authority = Object.freeze({});
  c.GMCommands.configure({ requireHost: x => x === authority });
  const send = cmd => c.Commands.dispatch(plain(cmd), authority);
  const out = send({ type: "gm.spawnEnemy", enemyId: "thug_knife", level: 3, zone: 2, iv: { hp: -10, atk: 10 } });
  const u = c.S.state.units.find(x => x.id === out.ids[0]);
  assert.deepEqual(plain(u.iv), { hp: -10, atk: 10 });
  const base = baseOf(c, "thug_knife", 3);
  send({ type: "gm.editUnit", actor: u.id, patch: { iv: { hp: 4, atk: null } } });
  assert.deepEqual(plain(u.iv), { hp: 4, atk: 10 });
  assert.equal(u.layers[0].max, Math.round(base.layers[0].max * 1.04));
  const boss = c.S.state.units.find(x => x.kit === "outlaw_king");
  assert.throws(() => send({ type: "gm.editUnit", actor: boss.id, patch: { iv: { hp: 5 } } }), /个体值/);
  assert.throws(() => send({ type: "gm.editUnit", actor: u.id, patch: { iv: { hp: 11 } } }));
  assert.throws(() => send({ type: "gm.spawnEnemy", enemyId: "thug_knife", level: 3, zone: 2, iv: { hp: 2.5 } }));
});

test("单局：战斗配置打开个体值，开出来的杂兵有个体值", () => {
  const c = H.load();
  const run = c.Rogue.newRun({ party: ["ruby", "kolt"], seed: "IV-RUN" });
  c.Rogue.acceptTask(run, "main");
  run.task.nodes[run.task.index] = { type: "battle", done: false };
  const spec = c.Rogue.battleSpec(run);
  assert.equal(spec.iv, true);
  c.BattleSim.setup(spec);
  const foes = c.S.state.units.filter(u => !u.isPlayer && c.ivEligible(u));
  assert.ok(foes.length && foes.every(u => u.iv));
});
