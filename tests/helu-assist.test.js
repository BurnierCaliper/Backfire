// Helumica 协助攻击（聚焦 / 推进一次 / 环境扫描）、超充能电池爆炸不分敌我
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["helu", "kolt"], enemies: [{ id: "bandit_boss", lv: 1, zone: 2 }], seed: "HA" });
  c.startCombat();
  const st = c.S.state;
  st.weather = "none";
  const helu = c.findKit("helu", st.units), kolt = c.findKit("kolt", st.units);
  helu.zone = 1; kolt.zone = 2;
  const foe = st.units.find(u => !u.isPlayer);
  foe.zone = 2;
  foe.layers = [{ type: "armor", current: 200, max: 200 }, { type: "flesh", current: 200, max: 200, inner: true }];
  return { c, st, helu, kolt, foe };
}
const assist = (c, st, helu, foe) => { st.attackerId = helu.id; st.targetId = foe.id; c.runSkill("helu_assist", { ignorePhase: true, free: true }); };

test("没有聚焦：打 1atk 谐波并造成聚焦，然后排队对敌人所在区做环境扫描", () => {
  const { c, st, helu, foe } = field();
  const h0 = c.totalHp(foe);
  assist(c, st, helu, foe);
  assert.ok(c.totalHp(foe) < h0);
  assert.equal(foe.focuses.length, 1);
  assert.equal(st.heluScanQueue.length, 1);
  assert.equal(st.heluScanQueue[0].zone, 2);
});

test("已有聚焦：直接推进序列一次（不管序列要什么属性）", () => {
  const { c, st, helu, foe } = field();
  c.applyFocus(foe, "armor", []);
  foe.focuses[0].seq = ["ice", "ice", "ice"];
  assist(c, st, helu, foe);
  assert.equal(foe.focuses.length, 1);
  assert.equal(foe.focuses[0].step, 1);
  assert.equal(foe.focuses[0].seq.join(","), "ice,ice,ice", "没有重新聚焦");
});

test("已有聚焦且只差一步：推进后抹层", () => {
  const { c, st, helu, foe } = field();
  c.applyFocus(foe, "armor", []);
  foe.focuses[0].seq = ["ice"];
  assist(c, st, helu, foe);
  assert.ok(!foe.layers.some(l => l.type === "armor"));
});

test("协助扫描：在敌人那一区结算，选项照环境扫描；放弃也会出队", () => {
  const { c, st, helu, foe } = field();
  assist(c, st, helu, foe);
  const n0 = (st.props || []).length;
  c.Commands.dispatch({ type: "heluScanAnswer", picks: { act: "spawn", dest: 1 } });
  assert.equal(st.props.length, n0 + 1);
  assert.equal(st.props[st.props.length - 1].zone, 2, "区域固定为敌人所在的区");
  assert.equal(st.heluScanQueue.length, 0);
  assert.equal(helu.resources.scanned, true, "算扫描过当前战场（#397）");
  assist(c, st, helu, foe);
  c.Commands.dispatch({ type: "heluScanAnswer", picks: null });
  assert.equal(st.heluScanQueue.length, 0);
});

test("协助扫描结算后算扫描过当前战场：频域造物能用了（#397）", () => {
  const { c, st, helu, foe } = field();
  helu.level = 9;
  assert.match(String(c.skillRequirementError(helu, "helu_forge")), /扫描/, "还没扫描：频域造物用不了");
  assist(c, st, helu, foe);
  c.Commands.dispatch({ type: "heluScanAnswer", picks: { act: "spawn" } });
  assert.equal(helu.resources.scanned, true);
  assert.equal(c.skillRequirementError(helu, "helu_forge"), null);
  st.combatPhase = "player";
  helu.ap = 5;
  c.dispatch({ type: "skill", actor: helu.id, skill: "helu_forge", target: null, picks: { gap: "1-2", element: "fire", mode: "dampen" } });
  assert.equal(st.gaps["1-2"].type, "wave", "放出了驻波墙");
  assert.equal(helu.ap, 4);
  // 同一个记号：驻波在相位中推进、大气干扰在沙暴中调转风向也认
  st.weather = "phase";
  assert.equal(c.skillRequirementError(helu, "helu_wave"), null);
  st.weather = "sand";
  assert.equal(c.skillRequirementError(helu, "helu_storm"), null);
  // 主动「环境扫描」没有每场次数限制，照样能用
  assert.equal(c.skillRequirementError(helu, "helu_scan"), null);
});

test("放弃了协助扫描不算扫描过：频域造物照旧用不了（#397）", () => {
  const { c, st, helu, foe } = field();
  helu.level = 9;
  assist(c, st, helu, foe);
  c.Commands.dispatch({ type: "heluScanAnswer", picks: null });
  assert.ok(!helu.resources.scanned);
  assert.match(String(c.skillRequirementError(helu, "helu_forge")), /扫描/);
});

test("模拟器会自动结算协助扫描队列", () => {
  const src = require("fs").readFileSync(require("path").join(H.ROOT, "sim.js"), "utf8");
  assert.match(src, /heluScanQueue/);
  const g = require("fs").readFileSync(require("path").join(H.ROOT, "game.js"), "utf8");
  assert.match(g, /heluScanAnswer/);
});

test("超充能电池爆炸：同区不分敌我都挨电", () => {
  const { c, st, kolt, foe } = field();
  const p = c.makeProp("battery", 2, 3);
  p.faction = "player";
  st.props = [p];
  kolt.layers.forEach(l => { l.current = l.max = 300; });
  const k0 = c.totalHp(kolt), f0 = c.totalHp(foe);
  c.destroyProp(p, null);
  assert.ok(c.totalHp(kolt) < k0, "我方也挨电");
  assert.ok(c.totalHp(foe) < f0, "敌人也挨电");
});

test("技能说明同步", () => {
  const c = H.load();
  assert.match(c.SkillText.kitInfo("helu").assistAttack, /直接推进序列一次.*环境扫描/);
});
