// 扩散：攻击按目标最新的状态属性结算时，伤害数字的属性（颜色、图标、预览）也跟着变
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

test("扩散把物理攻击改成火：跳出来的伤害数字按火属性画", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "yuito"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "SP" });
  const st = c.S.state;
  const a = c.findKit("ruby", st.units), t = st.units.find(u => !u.isPlayer);
  a.zone = t.zone = 1;
  t.instant = Object.assign({}, t.instant, { spread: true });
  t.statuses.latestElement = "fire";
  st.floaters = [];
  const { res } = c.dealTo(a, t, { atk: 10, mult: 1, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });
  assert.equal(res.element, "fire");
  const pops = st.floaters.filter(f => f.kind === "dmg");
  assert.ok(pops.length >= 1);
  assert.ok(pops.every(f => f.element === "fire"), JSON.stringify(pops.map(f => f.element)));
});
