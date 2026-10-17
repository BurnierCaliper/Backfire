// 主持人定沙鱼富集与否（desert.js · desertSetEnriched）：联机主持人工具生成 / 修改单位、战斗模板、任务节点
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const gmSource = new vm.Script(fs.readFileSync(path.join(H.ROOT, "gm-commands.js"), "utf8"), { filename: "gm-commands.js" });
const plain = x => JSON.parse(JSON.stringify(x));
const armor = u => u.layers.find(l => l.type === "armor");

function gm() {
  const c = H.load(); gmSource.runInContext(c);
  c.BattleSim.setup({ party: ["ruby", "helu"], enemies: [{ id: "sandfish_drive", lv: 5, zone: 2 }], seed: "ENRICH-GM" });
  const authority = Object.freeze({});
  c.GMCommands.configure({ requireHost: ctx => ctx === authority });
  return { c, s: c.S.state, send: cmd => c.Commands.dispatch(plain(cmd), authority) };
}

test("富集与否：定成富集 / 普通，装甲和名字跟着变，已受的伤按比例保留；定了以后开战不再随机", () => {
  const { c, s } = gm();
  const fish = s.units.find(u => u.kit === "sandfish_drive"), base = armor(fish).max;
  c.desertSetEnriched(fish, true);
  assert.match(fish.name, /^富集/); assert.equal(armor(fish).max, Math.round(base * 1.5)); assert.equal(fish.enrichSet, true);
  armor(fish).current = Math.round(armor(fish).max / 2);
  c.desertSetEnriched(fish, false);
  assert.doesNotMatch(fish.name, /^富集/); assert.equal(fish.enriched, false);
  assert.equal(armor(fish).max, base); assert.ok(Math.abs(armor(fish).current - base / 2) <= 1, "受伤比例保留");
  // 定成普通：沙暴、随机数再小也不会变富集
  s.weather = "sand"; c.Math.random = () => 0;
  c.desertBattleStart([]);
  assert.equal(fish.enriched, false);
  // 改回随机：开战时照常掷
  c.desertSetEnriched(fish, null); c.desertBattleStart([]);
  assert.equal(fish.enriched, true);
  // 不是沙鱼的不动
  const hero = s.units.find(u => u.isPlayer); const name = hero.name;
  c.desertSetEnriched(hero, true); assert.equal(hero.name, name); assert.equal(hero.enriched, undefined);
});

test("联机主持人工具：生成沙鱼时可以定富集与否；在场的沙鱼可以改；别的敌人不能设", () => {
  const f = gm();
  const out = f.send({ type: "gm.spawnEnemy", enemyId: "sandfish_lead", level: 4, zone: 2, count: 2, enriched: true });
  const made = out.ids.map(id => f.s.units.find(u => u.id === id));
  assert.equal(made.length, 2);
  made.forEach(u => { assert.match(u.name, /^富集/); assert.equal(u.enrichSet, true); });
  const plainOut = f.send({ type: "gm.spawnEnemy", enemyId: "sandfish_lead", level: 4, zone: 2, enriched: false });
  const p = f.s.units.find(u => u.id === plainOut.ids[0]);
  assert.equal(p.enriched, false); assert.equal(p.enrichSet, true);
  assert.throws(() => f.send({ type: "gm.spawnEnemy", enemyId: "thug_knife", level: 4, zone: 2, enriched: true }), /只有沙鱼/);
  assert.throws(() => f.send({ type: "gm.spawnEnemy", enemyId: "sandfish_lead", level: 4, zone: 2, enriched: "yes" }));
  f.send({ type: "gm.editUnit", actor: made[0].id, patch: { enriched: false } });
  assert.equal(made[0].enriched, false); assert.doesNotMatch(made[0].name, /^富集/);
  f.send({ type: "gm.editUnit", actor: p.id, patch: { enriched: true } });
  assert.match(p.name, /^富集/);
  const hero = f.s.units.find(u => u.isPlayer && !u.weaponOf);
  assert.throws(() => f.send({ type: "gm.editUnit", actor: hero.id, patch: { enriched: true } }), /只有沙鱼/);
});

test("战斗模板 / 任务节点：沙鱼可以存富集与否（编辑器里的 on / off），开战时照着摆；别的敌人上的这一项被去掉", () => {
  const c = H.load(); c.GAME = { partyKits: ["kolt", "helu"] };
  const t = c.battleTemplateNormalize({ name: "沙海", board: 2, enemies: [
    { preset: "sandfish_drive", level: 3, zone: 2, enriched: "on" },
    { preset: "sandfish_drive", level: 3, zone: 2, enriched: "off" },
    { preset: "sandfish_drive", level: 3, zone: 2, enriched: "" },
    { preset: "thug_knife", level: 3, zone: 2, enriched: "on" }],
    waves: [{ turns: 2, enemies: [{ preset: "sandfish_lead", level: 3, zone: 2, enriched: true }] }] });
  assert.deepEqual([...t.enemies].map(e => e.enriched), [true, false, undefined, undefined]);
  assert.equal(t.waves[0].enemies[0].enriched, true);
  assert.match(c.battleTemplateSummary(t), /富集/);
  const enc = c.battleTemplateToEncounter(t);
  assert.equal(enc.waves[0].enemies[0].enriched, true);
  c.dispatch({ type: "battle.setup", level: 3, encounter: enc });
  const fish = c.S.state.units.filter(u => u.kit === "sandfish_drive");
  assert.deepEqual(plain(fish.map(u => !!u.enriched)), [true, false, false]);
  assert.deepEqual(plain(fish.map(u => !!u.enrichSet)), [true, true, false]);
  // 记下战场：定过的照记
  const cap = c.battleTemplateCapture("再来");
  assert.deepEqual([...cap.enemies].filter(e => e.preset === "sandfish_drive").map(e => e.enriched), [true, false, undefined]);
  // 任务节点
  const node = c.trpgTaskNormalizeNode({ type: "battle", enemies: [{ id: "sandfish_ambush", lv: 3, zone: 2, enriched: "on" }, { id: "thug_knife", lv: 3, zone: 2, enriched: "on" }] });
  assert.deepEqual([...node.enemies].map(e => e.enriched), [true, undefined]);
  c.GAME.enemyPlan = plain(node.enemies);
  c.dispatch({ type: "battle.setup", level: 3 });
  const amb = c.S.state.units.find(u => u.kit === "sandfish_ambush");
  assert.equal(amb.enriched, true); assert.match(amb.name, /^富集/);
});
