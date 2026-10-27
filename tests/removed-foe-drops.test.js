// #340 第 18 条：先打倒的敌人 3 秒后移出场，战后掉落和图鉴照样要算到它
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field() {
  const c = H.load();
  const timers = [];
  c.setTimeout = (fn) => { timers.push(fn); return timers.length; };   // 收下「3 秒后移出场」的计时器，手动跑
  c.flushTimers = () => { while (timers.length) timers.shift()(); };
  c.bestiaryReset();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 1 }, { id: "thug_hammer", lv: 3, zone: 1 }], seed: "GONE-1" });
  c.startCombat();
  return c;
}
const foe = (c, kit) => c.S.state.units.find(u => u.kit === kit);

test("先打倒匕首狂徒、过 3 秒移出场，再打倒锤狂徒：掉落名单两只都有", () => {
  const c = field();
  const knife = foe(c, "thug_knife");
  knife.dead = true;
  c.removeEnemyFromField(knife, []);
  c.flushTimers();
  assert.ok(!c.S.state.units.includes(knife), "匕首狂徒已经移出场");
  foe(c, "thug_hammer").dead = true;
  const list = c.enemyDropFoes(c.battleFoesSeen()).map(u => u.kit).sort();
  assert.deepEqual([...list], ["thug_hammer", "thug_knife"]);
});

test("图鉴：移出场的匕首狂徒记为遭遇过、击倒 1", () => {
  const c = field();
  const knife = foe(c, "thug_knife");
  knife.dead = true;
  c.removeEnemyFromField(knife, []);
  c.flushTimers();
  foe(c, "thug_hammer").dead = true;
  c.bestiaryRecordBattle("win");
  const e = c.bestiaryEntries().find(x => x.kit === "thug_knife");
  assert.equal(e.seen, true);
  assert.equal(e.rec.kills, 1);
});

test("新的一场开战：上一场移出场的敌人不带过来", () => {
  const c = field();
  const knife = foe(c, "thug_knife");
  knife.dead = true;
  c.removeEnemyFromField(knife, []);
  c.flushTimers();
  c.BattleSim.setup({ party: ["kolt"], enemies: [{ id: "guard_gun", lv: 2, zone: 2 }], seed: "GONE-2" });
  c.startCombat();
  assert.ok(!c.battleFoesSeen().some(u => u.kit === "thug_knife"));
});
