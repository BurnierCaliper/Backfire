// 沙灵聚合体一阶段 · 狂暴连打（engine.js · AGG_RUSH）：预备一回合 → 下回合冲到目标的区连打 4 击；嘲讽转火；格挡 +10%；全挡下自己吃 4 击破
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");
const CFG = c => vm.runInContext("AGG_RUSH", c);

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "sand_aggregate", lv: 5, zone: 2 }], seed: "RUSH", zoneMode: 2 });
  c.startCombat();
  const S = c.S.state;
  const a = S.units.find(u => u.kit === "sand_aggregate");
  const k = c.findKit("kolt", S.units), h = c.findKit("helu", S.units);
  [k, h].forEach(u => { u.layers.forEach(l => { l.max = 2000; l.current = 2000; }); u.def = u.defMax = 50; });
  a.def = a.defMax = 20;
  const logs = () => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
  return { c, S, a, k, h, logs };
}
const setTurn = (S, n) => { S.turnNo = n; S.logPages.push({ turn: n, lines: [{ text: "" }] }); };
const hp = u => u.layers.reduce((n, l) => n + l.current, 0);
const noBlock = { pickBlocker: () => null, pickAssister: l => l[0].id };
function cast(c, S, a, id) {
  S.combatPhase = "enemy"; a.ap = 2; S.attackerId = a.id; S.targetId = null;
  c.runSkill(id);
}
/** 预备时只有 kolt 能选（helu 不算敌人之外，单独把 helu 藏起来） */
function prepOn(c, S, a, who, other) {
  other.hidden = true;
  setTurn(S, 2);
  cast(c, S, a, "en_agg1_rush_prep");
  other.hidden = false;
  assert.equal(a.resources.rush.targetId, who.id);
}

test("第 1 回合不会预备；从第 2 回合起技能表里有预备；预备当回合不能出手", () => {
  const { c, S, a, k, h } = field();
  assert.ok(!c.enemySkillList(a).some(x => x.id === "en_agg1_rush_prep"), "第 1 回合没有");
  prepOn(c, S, a, k, h);
  const ids = c.enemySkillList(a).map(x => x.id);
  assert.ok(!ids.includes("en_agg1_rush") && !ids.includes("en_agg1_rush_prep"), "预备当回合既不能出手也不能再预备");
  setTurn(S, 3);
  assert.ok(c.enemySkillList(a).some(x => x.id === "en_agg1_rush"), "下回合可以出手");
});

test("出手：冲到目标的区连打 4 击（每击 atk+1d8 物理、1 击破）；之后冷却 3 回合", () => {
  const { c, S, a, k, h, logs } = field();
  k.zone = 1; h.zone = 1;
  prepOn(c, S, a, h, k);   // 打 Helumica（柯尔特的过度自信会少吃击破）
  k.zone = 2;              // 别让柯尔特在旁边协助格挡
  setTurn(S, 3);
  const h0 = hp(h), d0 = h.def;
  cast(c, S, a, "en_agg1_rush");
  c.BattleSim.resolveQueues(noBlock);
  assert.equal(a.zone, 1, "冲到 Helumica 的区");
  assert.ok(hp(h) < h0, "Helumica 挨打");
  assert.equal(d0 - h.def, CFG(c).hits * CFG(c).baseBreak, "4 击各 1 击破");
  assert.match(logs(), /狂暴连打/);
  assert.equal(a.resources.rushNext, 3 + CFG(c).cooldown);
  assert.equal(a.rushBlock, 0, "格挡加成只在连打期间");
  setTurn(S, 4);
  assert.ok(!c.enemySkillList(a).some(x => x.id === "en_agg1_rush_prep"), "冷却中");
  setTurn(S, 6);
  assert.ok(c.enemySkillList(a).some(x => x.id === "en_agg1_rush_prep"));
});

test("出手时被嘲讽：转火嘲讽者", () => {
  const { c, S, a, k, h, logs } = field();
  k.zone = 2; h.zone = 2;
  prepOn(c, S, a, k, h);
  a.tauntTo = h.id;
  setTurn(S, 3);
  const k0 = hp(k), h0 = hp(h);
  cast(c, S, a, "en_agg1_rush");
  c.BattleSim.resolveQueues(noBlock);
  assert.ok(hp(h) < h0, "打的是嘲讽者");
  assert.equal(hp(k), k0);
  assert.match(logs(), /转向/);
});

test("每一击的协助格挡 +10%；4 击全被挡下：聚合体自己受 4 击破", () => {
  const { c, S, a, k, h } = field();
  k.zone = 2; h.zone = 2;
  prepOn(c, S, a, k, h);
  setTurn(S, 3);
  h.bonus = 10;
  const base = c.finalBlockChance(h, a, k);
  cast(c, S, a, "en_agg1_rush");
  assert.ok(S.blockQueue.length >= 1, "等协助格挡");
  assert.equal(c.finalBlockChance(h, a, k), Math.min(100, base + 10), "连打期间 +10%");
  const d0 = a.def;
  for (let i = 0; i < 10 && S.blockQueue.length; i++) c.finishBlock(h.id, { roll: 1, ok: true });
  assert.equal(S.blockQueue.length, 0);
  assert.equal(d0 - a.def, CFG(c).selfBreak, "全被挡下：自己 4 击破");
  assert.equal(a.rushBlock, 0, "打完加成就没了");
});

test("只挡下一部分：聚合体不吃击破", () => {
  const { c, S, a, k, h } = field();
  k.zone = 2; h.zone = 2;
  prepOn(c, S, a, k, h);
  setTurn(S, 3);
  h.bonus = 10;
  cast(c, S, a, "en_agg1_rush");
  const d0 = a.def;
  let n = 0;
  for (let i = 0; i < 10 && S.blockQueue.length; i++) c.finishBlock(n++ === 0 ? null : h.id, n === 1 ? null : { roll: 1, ok: true });
  assert.equal(S.blockQueue.length, 0);
  assert.equal(a.def, d0);
});

test("进入二阶段：预备好的连打作废", () => {
  const { c, S, a, k, h } = field();
  prepOn(c, S, a, k, h);
  a.layers[0].current = 1;
  c.dealTo(k, a, { atk: 50, mult: 1, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });
  assert.equal(a.resources.phase, 2);
  assert.equal(a.resources.rush, null);
  setTurn(S, 3);
  assert.ok(!c.enemySkillList(a).some(x => /rush/.test(x.id)));
});
