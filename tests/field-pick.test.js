// 选单位一律在战场上点（不再弹出一长串同名敌人的列表）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./headless");
const src = fs.readFileSync(path.join(H.ROOT, "game.js"), "utf8");

test("技能的分步选择：单位步骤（含可不选的、含配置物的）都走 pickUnit，可不选的多一个「不选」按钮", () => {
  assert.match(src, /step\.type === "unit" && allOnField\(/);
  assert.doesNotMatch(src, /step\.type === "unit" && !step\.optional/, "不再因为可不选就弹列表");
  assert.match(src, /pickUnit\(cands, label, step\.optional \? \[\{ label: "不选，继续"/);
});

test("结算队列：更换刀头的追击目标、协助攻击附带扫描的单位都在战场上点", () => {
  assert.match(src, /queueFieldPick\(`<b>\$\{esc\(k\.name\)\} 更换刀头<\/b>/);
  assert.match(src, /queueFieldPick\(`<b>环境扫描/);
  // 队列选择时动作还没结束（G.depth > 0），点卡片不能被当成「跳过动画」
  assert.match(src, /if \(G\.depth > 0 && !fieldPick\) \{ G\.skip = true; return; \}/);
});

test("场上点不到的候选（没有卡片）才退回弹窗", () => {
  assert.match(src, /function allOnField\(ids\)/);
});
