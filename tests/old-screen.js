// #316 起新画面（HD-2D）默认开：以旧画面为前提的画面测试，在页面加载之前先打开测试开关 window.__hd2dFieldOff
// （hd2d/hd2d-field.js · enabled 看到它就当「新画面 关」，不看本机记的），测的照旧是旧画面。
// target = Playwright 的 context / page，或者没装 Playwright 时的备用浏览器（tests/cdp-browser.js，#339 起也有 addInitScript：
// 那台 Chrome 能开 WebGL，不关的话单机就是新画面，#339 以后新画面的顶栏换成了纸片画面）。
// #438：以前是在每次页面加载的最开头往 localStorage 写「关」。实测（Chromium）页面一开头就读写 localStorage，会读到上一页还没落盘的旧内容：
// 上一页刚写的存档 / 检查点，刷新后大约三分之一的时候读不到——「刷新后还在」那几项测试偶尔挂（「继续」是灰的、检查点是 null）就是这个。
// 所以这里只设一个页面变量，开头不碰 localStorage。
//   await require("./old-screen")(context);
"use strict";
module.exports = async function oldScreen(target) {
  if (target && typeof target.addInitScript === "function") {
    await target.addInitScript(() => { window.__hd2dFieldOff = true; });
  }
  return target;
};
