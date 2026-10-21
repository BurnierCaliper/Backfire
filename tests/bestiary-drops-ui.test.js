// 图鉴详情「可能掉落」一节（bestiary-ui.js · dropsSection）：材料名、常见 / 精制、概率或保底份数
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./headless");

function loadUI(c) {
  // 和浏览器一样：bestiary-ui.js 和规则文件在同一个全局里（读得到顶层 const CRAFT_MATERIALS）
  c.window = c.window || {};
  return require("node:vm").runInContext(fs.readFileSync(path.join(__dirname, "..", "bestiary-ui.js"), "utf8") + "\n;Bestiary", c, { filename: "bestiary-ui.js" });
}
const entry = (c, kit) => c.bestiaryEntries().find(e => e.kit === kit);

test("概率文字：< 1 写百分比；≥ 1 写保底份数，小数部分再掷", () => {
  const B = loadUI(H.load());
  assert.equal(B.dropChanceText(0.25), "25% 掉 1 份");
  assert.equal(B.dropChanceText(2), "保底 2 份");
  assert.equal(B.dropChanceText(1.15), "保底 1 份，15% 再多 1 份");
});

test("杂兵：中文材料名 + 常见 / 精制标签 + 概率", () => {
  const c = H.load(), B = loadUI(c);
  const html = B.dropsSection(entry(c, "guard_sword"));
  assert.match(html, /可能掉落/);
  assert.match(html, /<b>废料<\/b>/);
  assert.match(html, /<b>废线圈<\/b><span class="bx-chip dim">常见<\/span><span class="bx-drop-p">25% 掉 1 份/);
  assert.match(html, /<b>电芯<\/b><span class="bx-chip dim">精制<\/span><span class="bx-drop-p">5% 掉 1 份/);
  assert.doesNotMatch(html, /cm_/, "不露出内部 id");
});

test("首领显示保底；没有掉落的写「不掉制作材料」", () => {
  const c = H.load(), B = loadUI(c);
  assert.match(B.dropsSection(entry(c, "ufo_boss")), /电芯.*保底 2 份/);
  assert.match(B.dropsSection({ drops: [] }), /不掉制作材料/);
});
