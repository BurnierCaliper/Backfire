// issue #124：图鉴专长详情的每日挑战选取率（Rogue 是顶层 const，不在 window 上）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("图鉴专长详情：读得到顶层 const Rogue 的选取率（以前读 window.Rogue，永远不显示）", () => {
  const ctx = vm.createContext({ window: {}, console });
  // 和浏览器一样：const 声明不挂在全局对象上
  vm.runInContext(`const Rogue = { featPickRates: () => ({ feat_x: { shown: 4, picked: 1, rate: 0.25 } }) };`, ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "bestiary-ui.js"), "utf8"), ctx, { filename: "bestiary-ui.js" });
  const B = vm.runInContext("Bestiary", ctx);
  assert.equal(vm.runInContext("typeof window.Rogue", ctx), "undefined");
  const html = B.pickRateNote("feat_x");
  assert.match(html, /出现 4 次，被选 1 次（选取率 25%）/);
  assert.equal(B.pickRateNote("feat_none"), "", "没出现过的不写");
});
