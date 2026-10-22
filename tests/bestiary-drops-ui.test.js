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

const visible = (html) => html.replace(/<[^>]*>/g, " ");   // 只看玩家看得到的文字（不算 class 名）

test("掉落档位：≥1 必掉（有小数 → 有时更多）；≥40% 常见，15–40% 少见，<15% 罕见", () => {
  const B = loadUI(H.load());
  assert.equal(B.dropChanceText(2), "必掉");
  assert.equal(B.dropChanceText(1.15), "必掉，有时更多");
  assert.equal(B.dropChanceText(0.9), "常见");
  assert.equal(B.dropChanceText(0.4), "常见");
  assert.equal(B.dropChanceText(0.39), "少见");
  assert.equal(B.dropChanceText(0.15), "少见");
  assert.equal(B.dropChanceText(0.14), "罕见");
  assert.equal(B.dropChanceText(0.03), "罕见");
});

test("杂兵：中文材料名 + 常见 / 精制材料标签 + 模糊档位", () => {
  const c = H.load(), B = loadUI(c);
  const html = B.dropsSection(entry(c, "guard_sword"));   // 废料 0.25 / 废线圈 0.25 / 电芯 0.05
  assert.match(html, /可能掉落/);
  assert.match(html, /<b>废线圈<\/b><span class="bx-chip dim">常见<\/span><span class="bx-drop-p">少见<\/span>/);
  assert.match(html, /<b>电芯<\/b><span class="bx-chip dim">精制<\/span><span class="bx-drop-p">罕见<\/span>/);
  assert.doesNotMatch(html, /cm_/, "不露出内部 id");
});

test("首领写「必掉」；没有掉落的写「不掉制作材料」", () => {
  const c = H.load(), B = loadUI(c);
  assert.match(B.dropsSection(entry(c, "ufo_boss")), /电芯.*必掉/);
  assert.match(B.dropsSection({ drops: [] }), /不掉制作材料/);
});

test("所有敌人的掉落一节都看不到数字和百分号（含 title / aria 等属性）", () => {
  const c = H.load(), B = loadUI(c);
  c.bestiaryEntries().forEach(e => {
    const html = B.dropsSection(e);
    assert.doesNotMatch(visible(html), /[0-9０-９%％]/, "掉落文字里有数字：" + e.kit);
    assert.doesNotMatch(html, /(title|aria-[a-z]+|data-[a-z-]+)="[^"]*[0-9%]/, "属性里有数字：" + e.kit);
  });
});
