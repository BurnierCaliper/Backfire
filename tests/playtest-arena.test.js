// tools/playtest.js 的 ARENA 模式（backlog 第三轮 M-1）：以前接任务前没把 stage 设成 board，一开跑就抛错
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("ARENA=1:5:1 node tools/playtest.js 正常跑完（退出码 0），并输出三种战斗的战报", () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, "..", "tools", "playtest.js")], {
    env: Object.assign({}, process.env, { ARENA: "1:5:1" }), encoding: "utf8", timeout: 240000
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ARENA 第1幕 Lv5/);
  for (const k of ["battle", "elite", "boss"]) assert.match(r.stdout, new RegExp(k + " 胜"));
  assert.doesNotMatch(r.stdout, /不能接任务/);
});
