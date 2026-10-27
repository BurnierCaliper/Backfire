// #340 第 18 条：先打倒的敌人 3 秒后移出场，战后掉落和图鉴照样要算到它
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");

/** 收下「3 秒后移出场」的计时器，手动跑；把 rollEnemyDrops 换成记下收到名单的函数（掉落走真实调用方） */
function rig(c) {
  const timers = [];
  c.setTimeout = (fn) => { timers.push(fn); return timers.length; };
  c.flushTimers = () => { while (timers.length) timers.shift()(); };
  c.dropCalls = [];
  c.rollEnemyDrops = (foes) => { c.dropCalls.push(foes.map(u => (typeof u === "string" ? u : u.kit))); return []; };
  c.bestiaryReset();
  return c;
}
function field() {
  const c = rig(H.load());
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 1 }, { id: "thug_hammer", lv: 3, zone: 1 }], seed: "GONE-1" });
  c.startCombat();
  return c;
}
const foe = (c, kit) => c.S.state.units.find(u => u.kit === kit);
const knock = (c, u) => { u.layers.forEach(l => { l.current = 0; }); u.dead = true; c.removeEnemyFromField(u, []); };
/** 跑团结算里的掉落（app.js · trpgEnemyMaterials）收到的名单 */
function trpgDropList(c) {
  c.S.TRPG.active = true;
  c.dropCalls = [];
  c.trpgEnemyMaterials();
  c.S.TRPG.active = false;
  assert.equal(c.dropCalls.length, 1, "trpgEnemyMaterials 掷了一次掉落");
  return [...c.dropCalls[0]].sort();
}
/** 照 game.js 的 saveState / restoreState：state 的每个 key 深拷贝一份再放回去（预演、行动预测、撤销都这样做）。
 *  拷贝函数要在 vm 里面创建，Object.prototype 才对得上 */
function swapStateForClone(c) {
  vm.runInContext(`(function () {
    function deepClone(o, seen) {
      if (o === null || typeof o !== "object") return o;
      seen = seen || new WeakMap();
      if (seen.has(o)) return seen.get(o);
      if (Array.isArray(o)) { const a = []; seen.set(o, a); for (let i = 0; i < o.length; i++) a.push(deepClone(o[i], seen)); return a; }
      const proto = Object.getPrototypeOf(o);
      if (proto !== Object.prototype && proto !== null) return o;
      const out = {}; seen.set(o, out);
      for (const k of Object.keys(o)) out[k] = deepClone(o[k], seen);
      return out;
    }
    const SKIP = ["roster", "history", "logPages", "floaters"];
    const keys = Object.keys(state), data = {};
    keys.forEach(k => { data[k] = SKIP.includes(k) ? state[k] : deepClone(state[k]); });
    keys.forEach(k => { state[k] = data[k]; });
  })()`, c);
}

test("跑团：先打倒匕首狂徒、过 3 秒移出场，再打倒锤狂徒：trpgEnemyMaterials 掷掉落的名单两只都有", () => {
  const c = field();
  const knife = foe(c, "thug_knife");
  knock(c, knife);
  c.flushTimers();
  assert.ok(!c.S.state.units.some(u => u.kit === "thug_knife"), "匕首狂徒已经移出场");
  foe(c, "thug_hammer").dead = true;
  assert.deepEqual(trpgDropList(c), ["thug_hammer", "thug_knife"]);
});

test("单局：先打倒的敌人移出场后，Rogue.finishBattle 打赢掷掉落的名单里照样有它", () => {
  const c = rig(H.load()), R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed: "GONE-RUN" });
  run.act = 1; run.actDay = 8; run.stage = "boss";
  c.BattleSim.setup(R.battleSpec(run));
  const st = c.S.state;
  const all = c.enemyDropFoes(st.units.map(u => (u.isPlayer ? u : Object.assign({}, u, { dead: true })))).map(u => u.kit).sort();
  const first = st.units.find(u => !u.isPlayer && !u.summonedBy && u.kit !== "ironwall" && u.kit !== "ufo_leg");
  knock(c, first);
  c.flushTimers();
  assert.ok(!st.units.includes(first), "先打倒的那只已经移出场");
  st.units.filter(u => !u.isPlayer).forEach(u => { u.dead = true; u.layers.forEach(l => { l.current = 0; }); });
  c.dropCalls = [];
  R.finishBattle(run, "win");
  assert.equal(c.dropCalls.length, 1, "打赢掷了一次掉落");
  assert.deepEqual([...c.dropCalls[0]].sort(), [...all]);
});

test("打倒后、移出场计时器到点前 state 被换成拷贝（预演 / 撤销）：掉落和图鉴照样算到它", () => {
  const c = field();
  knock(c, foe(c, "thug_knife"));
  swapStateForClone(c);   // 计时器闭包里的 u 不再是 state.units 里的那个
  c.flushTimers();
  assert.ok(!c.S.state.units.some(u => u.kit === "thug_knife"), "拷贝照样被清出场");
  foe(c, "thug_hammer").dead = true;
  assert.deepEqual(trpgDropList(c), ["thug_hammer", "thug_knife"]);
  c.bestiaryRecordBattle("win");
  const e = c.bestiaryEntries().find(x => x.kit === "thug_knife");
  assert.equal(e.seen, true);
  assert.equal(e.rec.kills, 1);
});

test("连续战斗：第 1 场最后打倒的那只，计时器没到点就换区域，照样算进掉落和图鉴", () => {
  const c = rig(H.load());
  const enc = {
    name: "巷口", zoneMode: 2, enemies: [{ preset: "thug_knife", level: 1, zone: 2 }, { preset: "thug_hammer", level: 1, zone: 2 }],
    stages: [{ name: "仓库", zoneMode: 2, playerZone: 1, enemies: [{ preset: "guard_sword", level: 1, zone: 2 }] }]
  };
  c.BattleSim.setup({ party: ["ruby", "yuito"], encounter: enc, level: 1, seed: "GONE-CH" });
  c.startCombat();
  const st = c.S.state;
  knock(c, foe(c, "thug_knife"));
  c.flushTimers();
  knock(c, foe(c, "thug_hammer"));   // 最后一只：计时器还没到点
  const r = c.dispatch({ type: "battle.chain" });
  assert.equal(r.continued, true);
  assert.equal(st.chain.index, 1, "换到第 2 场");
  c.flushTimers();
  st.units.filter(u => !u.isPlayer).forEach(u => { u.layers.forEach(l => { l.current = 0; }); u.dead = true; });
  assert.deepEqual(trpgDropList(c), ["guard_sword", "thug_hammer", "thug_knife"]);
  c.bestiaryRecordBattle("win");
  const e = c.bestiaryEntries().find(x => x.kit === "thug_hammer");
  assert.equal(e.seen, true);
  assert.equal(e.rec.kills, 1);
});

test("同一只被打倒两次（中途只撤回了 units）：goneFoes 里只留一份", () => {
  const c = field();
  const knife = foe(c, "thug_knife");
  knock(c, knife);
  const revived = vm.runInContext("JSON.parse", c)(JSON.stringify(knife));
  revived._removed = false; revived.dead = false;
  c.S.state.units = c.S.state.units.map(u => (u.id === knife.id ? revived : u));
  knock(c, revived);
  c.flushTimers();
  foe(c, "thug_hammer").dead = true;
  assert.deepEqual(trpgDropList(c), ["thug_hammer", "thug_knife"]);
});

test("图鉴：移出场的匕首狂徒记为遭遇过、击倒 1", () => {
  const c = field();
  knock(c, foe(c, "thug_knife"));
  c.flushTimers();
  foe(c, "thug_hammer").dead = true;
  c.bestiaryRecordBattle("win");
  const e = c.bestiaryEntries().find(x => x.kit === "thug_knife");
  assert.equal(e.seen, true);
  assert.equal(e.rec.kills, 1);
});

test("图鉴：飞碟触灵的 5 条机械足一条条打掉，「击倒」只 +1（机械足不另算）", () => {
  const c = rig(H.load());
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "ufo_boss", lv: 3, zone: 1 }], seed: "GONE-UFO" });
  c.startCombat();
  const st = c.S.state;
  const legs = st.units.filter(u => u.kit === "ufo_leg");
  assert.equal(legs.length, 5);
  legs.forEach(leg => {
    leg.layers.forEach(l => { l.current = 0; });
    leg.dead = true;
    c.sweepDeadEnemies();
    c.flushTimers();
  });
  assert.ok(c.battleFoesSeen().find(u => u.kit === "ufo_body").dead, "本体跟着死了");
  c.bestiaryRecordBattle("win");
  const e = c.bestiaryEntries().find(x => x.kit === "ufo_boss");
  assert.equal(e.rec.kills, 1);
});

test("新的一场开战：上一场移出场的敌人不带过来", () => {
  const c = field();
  knock(c, foe(c, "thug_knife"));
  c.flushTimers();
  c.BattleSim.setup({ party: ["kolt"], enemies: [{ id: "guard_gun", lv: 2, zone: 2 }], seed: "GONE-2" });
  c.startCombat();
  assert.ok(!c.battleFoesSeen().some(u => u.kit === "thug_knife"));
});
