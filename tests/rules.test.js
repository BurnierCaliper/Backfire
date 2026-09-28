// 规则回归测试：每条对应一次已经修过的问题，防止以后改坏。
// 运行：npm test（或 node --test "tests/*.test.js"）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
// 规则环境里造出来的数组/对象属于另一个 realm，比较前先转成普通值
const plain = (x) => JSON.parse(JSON.stringify(x));

/** 布一个小战场：给定队伍 + 敌人，已开战 */
function field(party, enemies, opt) {
  const c = H.load();
  c.BattleSim.setup(Object.assign({ party, enemies, seed: "RULES" }, opt || {}));
  c.startCombat();
  const st = c.S.state;
  const act = (a, t, id) => { a.ap = 5; a.bonus = 5; st.attackerId = a.id; st.targetId = t ? t.id : null; c.runSkill(id); };
  const lines = () => st.logPages.flatMap(p => p.lines).map(l => l.text);
  return { c, st, act, lines, foes: st.units.filter(u => !u.isPlayer) };
}
const hit = (el) => ({ atk: 1, mult: 1, element: el, baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });

test("柯尔特普攻（电钻）三段合计 2 击破，不是每段 2", () => {
  const { c, st, act, foes } = field(["kolt", "helu"], [{ id: "bandit_boss", lv: 1, zone: 2 }]);
  const kolt = c.findKit("kolt", st.units), boss = foes[0];
  kolt.zone = boss.zone; kolt.resources.bit = "drill";
  boss.def = boss.defMax = 20;
  act(kolt, boss, "kolt_aa");
  assert.equal(20 - boss.def, 2);
});

test("过度自信：靠废物利用的临时层把血量堆回上限也触发减伤；战斗结束临时层消失", () => {
  const { c, st, act, foes } = field(["kolt", "helu"], [{ id: "thug_hammer", lv: 1, zone: 2 }]);
  const kolt = c.findKit("kolt", st.units), foe = foes[0];
  kolt.layers[0].current = 15;
  st.lastBrokenLayer = { type: "armor", lost: 5, dmg: 5 };
  act(kolt, null, "kolt_scrap");
  assert.equal(c.totalCurHp(kolt), 25);
  assert.equal(c.baseMaxHp(kolt), 20);
  foe.zone = kolt.zone;
  const out = c.dealTo(foe, kolt, Object.assign(hit("physical"), { atk: 10 }));
  assert.ok(out.res.flags.prideReduce);
  c.resetBattleFlags(kolt);
  assert.deepEqual(plain(kolt.layers.map(l => [l.type, l.max])), [["flesh", 20]]);
});

test("临时血量叠在已有的层上时，战斗结束只扣掉叠上去的部分", () => {
  const { c, st } = field(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const kolt = c.findKit("kolt", st.units);
  c.addTempLayer(kolt, "flesh", 7);
  assert.equal(kolt.layers.length, 1);
  assert.equal(kolt.layers[0].max, 27);
  assert.deepEqual(plain(c.persistentLayers(kolt)), [{ type: "flesh", current: 20 }]);
  c.resetBattleFlags(kolt);
  assert.equal(kolt.layers[0].max, 20);
});

test("聚焦：按序列打完就抹去该层；抹的是内层则直接击杀", () => {
  const { c, st, foes } = field(["kolt", "helu"], [{ id: "bandit_boss", lv: 1, zone: 2 }]);
  const helu = c.findKit("helu", st.units), boss = foes[0];
  helu.zone = 1;
  c.applyFocus(boss, c.innermostLayer(boss).type, []);
  boss.focuses[0].seq.forEach(el => c.dealTo(helu, boss, hit(el)));
  assert.equal(boss.dead, true);
  assert.equal(boss.focuses.length, 0);
});

test("聚焦外层：抹去后单位存活，内层不受影响", () => {
  const { c, st, foes } = field(["kolt", "helu"], [{ id: "bandit_boss", lv: 1, zone: 2 }]);
  const helu = c.findKit("helu", st.units), boss = foes[0];
  helu.zone = 1;
  boss.layers = [{ type: "shield", current: 10, max: 10 }, { type: "armor", current: 10, max: 10 }, { type: "flesh", current: 20, max: 20, inner: true }];
  c.applyFocus(boss, "armor", []);
  boss.focuses[0].seq = ["acid", "acid"];   // 酸打装甲有克制，保证每一下都有伤害
  boss.focuses[0].seq.forEach(el => c.dealTo(helu, boss, hit(el)));
  assert.deepEqual(plain(boss.layers.map(l => l.type)), ["shield", "flesh"]);
  assert.equal(boss.dead, false);
});

test("拉斯缪尔：能量到 100% 就进入不稳态", () => {
  const { c, st } = field(["ras", "helu"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const ras = c.findKit("ras", st.units);
  ras.resources.energyPct = 80;
  c.addRasEnergy(20, "测试");
  assert.equal(ras.resources.unstable, true);
});

test("开战时按实际人数平衡敌人：3 人建的敌人，2 人开战 → 换算成 2 人的数值", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu", "ras"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }, { id: "bandit_boss", lv: 1, zone: 2 }] });
  const st = c.S.state;
  const ras = c.findKit("ras", st.units);
  st.units = st.units.filter(u => u !== ras);
  c.startCombat();
  const two = H.load();
  two.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }, { id: "bandit_boss", lv: 1, zone: 2 }] });
  const want = two.S.state.units.filter(u => !u.isPlayer).map(u => [u.layers.map(l => l.max), u.defMax]);
  const got = st.units.filter(u => !u.isPlayer).map(u => [u.layers.map(l => l.max), u.defMax]);
  assert.deepEqual(plain(got), plain(want));
});

test("减员到只剩 1 人时，敌人不做特殊调整（按 2 人基准）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  const st = c.S.state;
  const before = st.units.filter(u => !u.isPlayer).map(u => u.layers.map(l => l.max));
  c.findKit("helu", st.units).dead = true;
  c.startCombat();
  assert.deepEqual(plain(st.units.filter(u => !u.isPlayer).map(u => u.layers.map(l => l.max))), plain(before));
});

test("本行动合计包含高压场地等连带伤害", () => {
  const { c, st, act, lines, foes } = field(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const kolt = c.findKit("kolt", st.units), t = foes[0];
  kolt.zone = t.zone; t.def = t.defMax = 30;
  c.setZoneField(t.zone, "electric");
  act(kolt, t, "kolt_aa");
  const sum = lines().filter(s => /本行动合计/.test(s)).pop();
  assert.match(sum, /连带 \d+：高压场地 \d+/);
});

test("开战后是第 1 回合，结束一轮后是第 2 回合", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  c.appendLog("布置阶段的一条记录");
  c.startCombat();
  assert.equal(c.S.state.turnNo, 1);
  c.endPlayerTurn();
  c.endEnemyTurn();
  assert.equal(c.S.state.turnNo, 2);
});
