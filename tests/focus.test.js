// Helumica「聚焦」加强：序列短 1、抹层 2 击破、符合天气的属性总能推进一步
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(enemy) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: enemy || "bandit_boss", lv: 1, zone: 2 }], seed: "FOCUS" });
  c.startCombat();
  const st = c.S.state;
  st.weather = "none";
  const helu = c.findKit("helu", st.units);
  helu.zone = 1;
  const foe = st.units.find(u => !u.isPlayer);
  foe.def = foe.defMax = 10;
  foe.layers = [{ type: "shield", current: 50, max: 50 }, { type: "armor", current: 50, max: 50 }, { type: "flesh", current: 50, max: 50, inner: true }];
  return { c, st, helu, foe };
}
const hit = (el) => ({ atk: 1, mult: 1, element: el, baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });

test("序列长度：普通 1、精英 2、首领 3", () => {
  const { c, foe } = field();
  c.applyFocus(foe, "armor", []);
  assert.equal(foe.focuses[0].seq.length, c.focusSeqLen(foe));
  const lens = ["minion", "elite", "boss"].map(r => { const save = c.enemyRankOf; c.enemyRankOf = () => r; const n = c.focusSeqLen(foe); c.enemyRankOf = save; return n; });
  assert.equal(lens.join(","), "1,2,3");
});

test("抹去外层时造成 2 击破", () => {
  const { c, helu, foe } = field();
  c.applyFocus(foe, "armor", []);
  foe.focuses[0].seq = ["acid"];
  const d0 = foe.def;
  c.dealTo(helu, foe, hit("acid"));
  assert.ok(!foe.layers.some(l => l.type === "armor"), "装甲被抹去");
  assert.equal(foe.def, d0 - 2);
});

test("符合天气的属性：不管序列要什么都推进一步", () => {
  const { c, st, helu, foe } = field();
  c.applyFocus(foe, "armor", []);
  foe.focuses[0].seq = ["ice", "ice"];
  st.weather = "heat";                 // 炎热：火 / 酸增伤
  c.dealTo(helu, foe, hit("fire"));
  assert.equal(foe.focuses[0].step, 1);
  c.dealTo(helu, foe, hit("physical"));  // 不符合天气、也不是序列要的
  assert.equal(foe.focuses[0].step, 1);
  st.weather = "none";
  c.dealTo(helu, foe, hit("fire"));      // 没有天气就不算
  assert.equal(foe.focuses[0].step, 1);
  c.dealTo(helu, foe, hit("ice"));
  assert.ok(!foe.layers.some(l => l.type === "armor"));
});

test("技能说明写明新规则", () => {
  const c = H.load();
  const p = c.SkillText.kitInfo("helu").passives.find(x => x.name === "频谱分析");
  assert.match(p.text, /2 击破/);
  assert.match(p.text, /符合天气/);
});
