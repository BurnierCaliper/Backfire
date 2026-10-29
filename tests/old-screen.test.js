// #438：画面测试的「照旧画面」开关（tests/old-screen.js）不能在页面一开头碰 localStorage。
// 实测（Chromium）：页面一开头就读写 localStorage，会读到上一页还没落盘的旧内容，上一页刚写的存档 / 房间检查点刷新后读不到——
// ui.test.js「刷新后还在」那几项、task-battle-resume-ui.test.js 偶尔挂就是这个。改成只设页面变量 __hd2dFieldOff，hd2d/hd2d-field.js · enabled 认它。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const oldScreen = require("./old-screen");

/** 记下碰过 localStorage 几次的假存储 */
function spyStorage(init) {
  const data = new Map(init || []), log = [];
  return { log, getItem(k) { log.push("get " + k); return data.has(k) ? data.get(k) : null; }, setItem(k, v) { log.push("set " + k); data.set(k, String(v)); }, removeItem(k) { log.push("remove " + k); data.delete(k); } };
}

test("old-screen：每次打开页面之前跑的脚本不碰 localStorage，只打开 window.__hd2dFieldOff", async () => {
  const scripts = [];
  await oldScreen({ addInitScript: fn => { scripts.push(fn); } });
  assert.equal(scripts.length, 1);
  const storage = spyStorage();
  const win = { localStorage: storage };
  win.window = win;
  vm.runInNewContext(`(${scripts[0]})()`, win);
  assert.deepEqual(storage.log, [], "页面一开头不读也不写 localStorage");
  assert.equal(win.__hd2dFieldOff, true);
});

test("hd2d-field · enabled：打开测试开关 __hd2dFieldOff 时照旧画面（本机记着「开」也一样）；没打开时照旧看本机记的", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "hd2d", "hd2d-field.js"), "utf8");
  const load = flag => {
    const ctx = { console };
    ctx.self = ctx;
    if (flag) ctx.__hd2dFieldOff = true;
    vm.runInNewContext(src, ctx);
    return ctx.HD2DField;
  };
  const on = spyStorage([["backfire-hd2d-field", "on"]]);
  assert.equal(load(true).enabled(on), false, "测试开关：照旧画面");
  assert.deepEqual(on.log, [], "测试开关打开时不用去读本机记的");
  assert.equal(load(false).enabled(spyStorage([["backfire-hd2d-field", "on"]])), true, "没打开：本机记着开就是新画面");
  assert.equal(load(false).enabled(spyStorage([["backfire-hd2d-field", "off"]])), false);
});
