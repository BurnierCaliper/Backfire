// tools/dpt.js：理想状态下的最优输出循环（只做冒烟测试：参数调到最小，确认能找到会打人的循环、重放对得上）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../tools/dpt.js");

test("训练假人：关闭属性克制、打不死、打不进失衡、站在 2 区", () => {
  const { c, S, dummy } = D.setupField("kolt", 5, 0);
  assert.equal(S.noChart, true);
  assert.equal(c.chartMod("fire", "flesh", "none"), 0, "克制表关掉");
  assert.equal(dummy.zone, 2);
  assert.ok(dummy.layers[0].max >= 1e9);
  assert.ok(dummy.defMax >= 1e6);
  assert.equal(D.dummyDamage(S), 0);
});

test("搜索 + 重放：2 回合里能找到会造成伤害的动作，换种子重放不跳步", () => {
  const { best } = D.search("kolt", 5, { turns: 2, beam: 6, worlds: 1 });
  assert.ok(best.dmg > 0, "找到打得到假人的动作");
  assert.equal(best.path.filter(a => a.end).length, 2);
  const r = D.replay("kolt", 5, best.path, 7, 2);
  assert.equal(r.skipped, 0);
  assert.ok(r.total > 0);
});
