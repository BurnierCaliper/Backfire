// #316 起新画面（HD-2D）默认开：以旧画面为前提的画面测试，在页面加载之前先在本机记着「新画面 关」（和玩家自己选过关一样，hd2d/hd2d-field.js 的 FIELD.storageKey），
// 测的照旧是旧画面。target = Playwright 的 context / page，或者没装 Playwright 时的备用浏览器（tests/cdp-browser.js，#339 起也有 addInitScript：
// 那台 Chrome 能开 WebGL，不记着「关」的话单机就是新画面，#339 以后新画面的顶栏换成了纸片画面）。
//   await require("./old-screen")(context);
"use strict";
module.exports = async function oldScreen(target) {
  if (target && typeof target.addInitScript === "function") {
    await target.addInitScript(() => { try { localStorage.setItem("backfire-hd2d-field", "off"); } catch (e) { /* 存不了（about:blank 之类）就算了 */ } });
  }
  return target;
};
