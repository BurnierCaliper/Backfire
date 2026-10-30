// 层名只有一份：engine.js · LAYER（#510）。界面上写层名的地方都读它，不另写。
// 只测显示端的浏览器测试页不加载规则引擎，用这里把 engine.js 里的这一张表原样放进页面
// （正式页面 game.html 里 engine.js 先于界面加载，一样拿得到 LAYER）：
//   await page.addScriptTag({ content: require("./layer-names").script });
//   require("./layer-names").table   → { flesh: "肉体", … }（守护测试用）
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "..", "engine.js"), "utf8");
const m = src.match(/^const LAYER = \{[^}]*\};/m);
if (!m) throw new Error("engine.js 里找不到 const LAYER = { … };");

module.exports = { script: m[0], table: vm.runInNewContext(m[0] + "\nLAYER") };
