// 多个敌人同时失衡：柯尔特每次协助攻击后都能更换一次刀头；Helumica 每次协助攻击后都能环境扫描
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(party) {
  const c = H.load();
  c.BattleSim.setup({ party, enemies: [{ id: "thug_hammer", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }], seed: "MS" });
  c.startCombat();
  const st = c.S.state;
  const foes = st.units.filter(u => !u.isPlayer && !u.hidden);
  foes.forEach(f => { f.zone = 1; f.layers.forEach(l => { l.current = l.max = 300; }); });
  st.units.filter(u => u.isPlayer).forEach(u => { u.zone = 1; });
  return { c, st, foes };
}

test("两个敌人失衡、柯尔特各协助一次：每次协助后都问一次更换刀头，而且在下一次协助之前", () => {
  const { c, st, foes } = field(["kolt", "ruby"]);
  const kolt = c.findKit("kolt", st.units), ruby = c.findKit("ruby", st.units);
  const order = [];
  foes.forEach(f => { f.def = 0; f.stunned = true; c.queueAssistAttack(ruby, f); });
  assert.equal(st.assistQueue.length, 2);
  c.BattleSim.resolveQueues(Object.assign({}, c.BattleSim.BASIC_POLICY, {
    pickAssister: (list, target) => { order.push("assist:" + target.name); return kolt.id; },
    koltSwap: () => { order.push("swap"); return { swap: true, targetId: null }; }
  }));
  assert.equal(order.filter(x => x === "swap").length, 2, order.join(" → "));
  assert.deepEqual(order.map(x => x.split(":")[0]), ["assist", "swap", "assist", "swap"]);
});

test("队列里同时有两次换刀机会时不会被合并", () => {
  const { c, st } = field(["kolt", "ruby"]);
  const kolt = c.findKit("kolt", st.units);
  st.koltSwapQueue = [];
  c.queueKoltSwap(kolt);
  c.queueKoltSwap(kolt);
  assert.equal(st.koltSwapQueue.length, 2);
});

test("Helumica 协助两个失衡的敌人：每次协助后各扫描一次", () => {
  const { c, st, foes } = field(["helu", "ruby"]);
  const helu = c.findKit("helu", st.units), ruby = c.findKit("ruby", st.units);
  const order = [];
  foes.forEach(f => { f.def = 0; f.stunned = true; c.queueAssistAttack(ruby, f); });
  c.BattleSim.resolveQueues(Object.assign({}, c.BattleSim.BASIC_POLICY, {
    pickAssister: () => { order.push("assist"); return helu.id; },
    heluScan: () => { order.push("scan"); return null; }
  }));
  assert.deepEqual(order, ["assist", "scan", "assist", "scan"]);
});

test("战斗画面的队列顺序：格挡 → 换刀 / 扫描 → 下一个协助攻击", () => {
  const src = require("fs").readFileSync(require("path").join(H.ROOT, "game.js"), "utf8");
  const i = src.indexOf("async function resolveQueues");
  const body = src.slice(i, i + 9000);
  const at = (s) => body.indexOf(s);
  assert.ok(at("state.blockQueue && state.blockQueue.length") < at("state.koltSwapQueue && state.koltSwapQueue.length"));
  assert.ok(at("state.koltSwapQueue && state.koltSwapQueue.length") < at("state.assistQueue && state.assistQueue.length"));
  assert.ok(at("state.heluScanQueue && state.heluScanQueue.length") < at("state.assistQueue && state.assistQueue.length"));
});
