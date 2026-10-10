// 单位悬停说明（unit-tip.js）：图鉴摘的简单描述 + 身上效果的文字说明
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("./headless");

function load() {
  const c = H.load();
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "hud-icons.js"), "utf8"), c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "unit-tip.js"), "utf8"), c);
  return c;
}

test("简单描述：角色看图鉴介绍，敌人看行动方式和能力，配置物 / 间隔看配置物图鉴，武器人看被动", () => {
  const c = load(), T = c.UnitTip;
  assert.match(T.describe({ kind: "hero", kit: "ruby" }).text, /机甲/);
  const e = T.describe({ kind: "enemy", kit: "thug_knife" });
  assert.match(e.kicker, /杂兵/);
  assert.match(e.text, /行动方式/);
  assert.ok(e.list.length > 0);
  const p = T.describe({ kind: "prop", propKind: "boom" });
  assert.match(p.kicker, /配置物/);
  assert.ok(p.list.some(x => /耐久/.test(x)));
  assert.ok(T.describe({ kind: "gap", gapType: "wall" }).list.length > 0);
  const w = T.describe({ kind: "weapon", kit: "mochi", ownerName: "灯" });
  assert.equal(w.kicker, "灯的武器人");
});

test("效果：带层数 / 数值的词也能认出来，说明取自图鉴；图鉴没有的用补充说明", () => {
  const c = load(), T = c.UnitTip;
  assert.match(T.effect("灼烧×3").text, /灼烧层数/);
  assert.equal(T.effect("灼烧×3").name, "灼烧×3");
  assert.match(T.effect("高能 7").text, /自爆/);
  assert.match(T.effect("导体").text, /导体/);
  assert.match(T.effect("失衡").text, /跳过回合/);
  assert.match(T.effect("掩护（灯）").text, /协助格挡/);
  assert.match(T.effect("聚焦护甲 火→[冰]").text, /聚焦/);
  assert.equal(T.effect("酸液炮").text, "");
  const h = T.html({ kind: "enemy", kit: "thug_knife" }, ["灼烧×2", "虚弱", "灼烧×2"], { name: "狂徒", sub: "Lv1" });
  assert.match(h, /身上的效果/);
  assert.equal((h.match(/<b>灼烧×2<\/b>/g) || []).length, 1, "重复的只写一次");
  assert.match(h, /<svg/, "有图标的效果前面带图标");
  assert.match(T.html({ kind: "prop", propKind: "boom" }, [], { name: "爆炸桶" }), /没有效果/);
});
