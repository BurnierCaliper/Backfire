// 主菜单彩蛋（#554，主人 11/01，接 #552 的看板娘）：连续点柏妮尔很多次，立绘换成「举着油桶猛灌汽油」的搞笑图，过一会儿换回来（title-mascot.js · BURNIER_TAP）。
// 这里是不用浏览器的那部分：页面结构（#t-mascot 里立绘后面的第二张图）、默认配置；连点计数——连续点到第 gulpAfter 下换图、不到不换、照常抖一下，
// 两下之间隔超过 gap 从头数，过了 gulpMs 换回立绘、计数归零，显示期间再点只抖（不数、不延长），改配置的数字马上照新的算；
// 搞笑图读不出来不换图、立绘照常，立绘藏起来（#552：立绘读不出来）不数；开着「减少动态效果」照样换图；样式（换图只换看得见的那张、不动版面）。
// Node 里用 tests/mini-dom.js 跑 game.html 的真页面结构，时间用假时钟（t.mock.timers）；摆的位置、真的换图、键盘、截图在 tests/title-mascot-gulp-ui.test.js（真浏览器）。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const MD = require("./mini-dom");

const ROOT = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const GULP = "art/burnier/burnier-gulp-360.png";

/** 打开假时钟（setTimeout、Date），把 game.html 的 <body> 解析进小 DOM，加载 title-mascot.js。
 *  小 DOM 不会真的读图片：两张图都当成已经读好（complete + naturalWidth），opt.gulp = 搞笑图的 naturalWidth（0 = 读失败），opt.reduce = 开着「减少动态效果」 */
function page(t, opt = {}) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000000 });
  const html = read("game.html"), body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const P = MD.create(body, { media: q => !!opt.reduce && /prefers-reduced-motion: reduce/.test(q) });
  const ctx = vm.createContext(P.window);
  const doc = P.document, el = doc.getElementById("t-mascot");
  const stand = el.querySelector("img"), gulp = el.querySelector(".t-mascot-gulp");
  stand.complete = true; stand.naturalWidth = 499;
  if (gulp) { gulp.complete = true; gulp.naturalWidth = opt.gulp === undefined ? 360 : opt.gulp; }
  vm.runInContext(read("title-mascot.js"), ctx, { filename: "title-mascot.js" });
  const M = P.window.TitleMascot;
  return { doc, el, stand, gulp, M, T: M.TAP };
}
/** 现在显示的是不是搞笑图 */
const gulping = p => p.el.classList.contains("gulp");
const shaking = p => p.el.classList.contains("shake");
/** 点 n 下：第一下马上点，之后每隔 every 毫秒（假时钟）点一下 */
function tap(t, p, n, every = 100) {
  for (let i = 0; i < n; i++) { if (i) t.mock.timers.tick(every); p.el.click(); }
}
/** 主菜单的状态：首页显示着、子菜单都没开（点立绘不触发菜单） */
const menu = p => ({ home: !p.doc.getElementById("t-home").hidden, panels: p.doc.querySelectorAll("#scr-title .t-panel").filter(x => !x.hidden).map(x => x.id) });
/** PNG 的宽高（IHDR 在文件头第 16–23 字节） */
function pngSize(file) {
  const b = fs.readFileSync(path.join(ROOT, file));
  assert.equal(b.toString("latin1", 1, 4), "PNG", file + " 是 PNG");
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

test("页面结构：#t-mascot 里立绘后面是第二张图——搞笑图 burnier-gulp-360.png（360×360，宽高写在标签上，替代文字同样是「柏妮尔」，不能拖）；立绘照旧是第一张；默认配置连点 10 下、间隔 1.5 秒、停 3 秒；桌面版打包带上这张图", (t) => {
  const p = page(t);
  const imgs = p.el.querySelectorAll("img");
  assert.equal(imgs.length, 2, "按钮里两张图：立绘、搞笑图");
  assert.equal(imgs[0], p.stand);
  assert.equal(p.stand.getAttribute("src"), "art/burnier/burnier-stand-720.png", "第一张照旧是立绘（#552 的读失败、动画播完都认它）");
  assert.equal(imgs[1], p.gulp, "第二张是搞笑图（class t-mascot-gulp）");
  assert.equal(p.gulp.getAttribute("src"), GULP);
  assert.deepEqual(pngSize(GULP), { w: Number(p.gulp.getAttribute("width")), h: Number(p.gulp.getAttribute("height")) }, "标签上的宽高和图片一样");
  assert.deepEqual(pngSize(GULP), { w: 360, h: 360 });
  assert.deepEqual(pngSize("art/burnier/burnier-gulp.png"), { w: 800, h: 800 }, "原图也在");
  assert.equal(p.gulp.getAttribute("alt"), "柏妮尔", "换图的时候按钮的名字不变（看不见的那张不算进名字）");
  assert.equal(p.gulp.getAttribute("draggable"), "false");
  assert.equal(p.el.textContent.trim(), "", "按钮里还是没有别的字");
  assert.ok(!gulping(p), "一开始是立绘");
  // 默认配置（主人可能会调：只改 BURNIER_TAP 一处）
  assert.deepEqual({ gulpAfter: p.T.gulpAfter, gap: p.T.gap, gulpMs: p.T.gulpMs, gulpClass: p.T.gulpClass, gulpImg: p.T.gulpImg },
    { gulpAfter: 10, gap: 1500, gulpMs: 3000, gulpClass: "gulp", gulpImg: "t-mascot-gulp" });
  assert.match(read("title-mascot.js"), /const BURNIER_TAP = \{/, "配置表 BURNIER_TAP");
  // 桌面版（tools/desktop/build.sh 只放玩家需要的文件）：带上搞笑图，不然桌面版连点也换不了
  assert.match(read("tools/desktop/build.sh"), /cp art\/burnier\/burnier-gulp-360\.png "\$STAGE\/game\/art\/burnier\/"/);
});

test("连续点到第 gulpAfter 下（默认 10）换成搞笑图，照常抖一下；点 9 下不换；点它不触发菜单", (t) => {
  const p = page(t);
  tap(t, p, 9);
  assert.equal(p.M.tapCount(), 9);
  assert.ok(!gulping(p), "9 下：还是立绘");
  assert.ok(shaking(p), "每一下照常抖");
  t.mock.timers.tick(100);
  p.el.click();
  assert.ok(gulping(p), "第 10 下换成搞笑图");
  assert.equal(p.M.gulping(), true);
  assert.ok(shaking(p), "换图的这一下也照常抖");
  assert.deepEqual(menu(p), { home: true, panels: [] }, "不进子菜单");
});

test("两下之间隔超过 gap（默认 1.5 秒）就从头数；正好隔 gap 不算断", (t) => {
  const p = page(t);
  tap(t, p, 9);
  t.mock.timers.tick(p.T.gap + 1);
  p.el.click();
  assert.equal(p.M.tapCount(), 1, "隔太久：这一下算第 1 下");
  assert.ok(!gulping(p), "前面那 9 下作废");
  tap(t, p, 8, 200);
  assert.equal(p.M.tapCount(), 9);
  assert.ok(!gulping(p));
  t.mock.timers.tick(p.T.gap);
  p.el.click();
  assert.ok(gulping(p), "隔正好 gap 还算连着点：新的一串数到第 10 下换图");
});

test("过了 gulpMs（默认 3 秒）换回立绘、计数归零；搞笑图显示期间再点只抖：不数、不延长", (t) => {
  const p = page(t);
  tap(t, p, 10);
  assert.ok(gulping(p));
  // 显示期间点几下（每一下都抖，计数不动、时间不往后推）
  for (const at of [500, 1000, 1000, 499]) {
    t.mock.timers.tick(at);
    p.el.classList.remove("shake");
    p.el.click();
    assert.ok(shaking(p), "显示期间点：照常抖");
    assert.ok(gulping(p), "还是搞笑图");
  }
  assert.equal(p.M.tapCount(), 10, "显示期间的点不数");
  t.mock.timers.tick(1);   // 第 10 下之后正好 gulpMs
  assert.ok(!gulping(p), "过了 gulpMs 换回立绘（显示期间点了也不延长）");
  assert.equal(p.M.gulping(), false);
  assert.equal(p.M.tapCount(), 0, "计数归零");
  // 换回来以后从头数：显示期间那几下不算，要再连点 gulpAfter 下
  tap(t, p, 9);
  assert.ok(!gulping(p), "换回来以后点 9 下不换");
  t.mock.timers.tick(100);
  p.el.click();
  assert.ok(gulping(p), "再点满 10 下又换");
  t.mock.timers.tick(p.T.gulpMs);
  assert.ok(!gulping(p));
});

test("改配置的数字照样生效：BURNIER_TAP 的 gulpAfter / gap / gulpMs 改了，下一下就按新的算", (t) => {
  const p = page(t);
  Object.assign(p.T, { gulpAfter: 3, gap: 400, gulpMs: 1000 });
  tap(t, p, 2, 300);
  assert.ok(!gulping(p), "点 2 下不换");
  t.mock.timers.tick(401);
  p.el.click();
  assert.equal(p.M.tapCount(), 1, "隔 401 毫秒（超过新的 gap）就从头数");
  tap(t, p, 1);
  t.mock.timers.tick(400);
  p.el.click();
  assert.ok(gulping(p), "连点 3 下就换（隔正好 400 毫秒还算连着）");
  t.mock.timers.tick(999);
  assert.ok(gulping(p));
  t.mock.timers.tick(1);
  assert.ok(!gulping(p), "停 1 秒就换回");
  assert.equal(p.M.tapCount(), 0);
  // 调成 1：点一下就换
  p.T.gulpAfter = 1;
  p.el.click();
  assert.ok(gulping(p), "gulpAfter = 1：点一下就换");
  t.mock.timers.tick(1000);
  assert.ok(!gulping(p));
});

test("搞笑图读不出来（读失败 / 还没读好）：不换图，立绘照常抖；立绘自己读不出来（#552：整个藏起来）时点了不数", (t) => {
  const p = page(t, { gulp: 0 });   // 读完了却没有尺寸 = 读失败
  tap(t, p, 12);
  assert.ok(!gulping(p), "点满 10 下也不换");
  assert.ok(shaking(p), "立绘照常抖");
  assert.ok(!p.el.hidden, "立绘照常显示");
  // 立绘读不出来：#552 把整个按钮藏起来，点了不抖、也不数
  p.stand.dispatchEvent(new MD.Event("error"));
  assert.equal(p.el.hidden, true);
  p.gulp.naturalWidth = 360;
  tap(t, p, 12);
  assert.ok(!gulping(p), "藏起来了：点了不换");
  assert.equal(p.M.tapCount(), 0, "也不数");
});

test("还没读好的搞笑图（complete 还是 false）也不换；搞笑图显示中立绘读失败（#552 藏起来）：换回立绘、计数归零", (t) => {
  const p = page(t);
  p.gulp.complete = false; p.gulp.naturalWidth = 0;
  tap(t, p, 10);
  assert.ok(!gulping(p), "还没读好：不换");
  p.gulp.complete = true; p.gulp.naturalWidth = 360;
  t.mock.timers.tick(p.T.gap + 1);
  tap(t, p, 10);
  assert.ok(gulping(p), "读好以后连点 10 下照常换");
  p.stand.dispatchEvent(new MD.Event("error"));
  assert.ok(!gulping(p), "整个藏起来时搞笑图也收掉");
  assert.equal(p.M.tapCount(), 0);
  t.mock.timers.tick(p.T.gulpMs);   // 原来的计时器不会再动它
  assert.ok(!gulping(p));
});

test("开着「减少动态效果」：照样换图、照样换回（只是 #552 的 CSS 把抖换成只淡一下）", (t) => {
  const p = page(t, { reduce: true });
  tap(t, p, 10);
  assert.ok(gulping(p), "照样换");
  t.mock.timers.tick(p.T.gulpMs);
  assert.ok(!gulping(p), "照样换回");
});

test("样式：换图只换看得见的那张（visibility），两张叠在同一个按钮里、搞笑图绝对定位，版面不动；搞笑图不接鼠标、抖动和减少动态效果跟立绘一样（.t-mascot.shake img 管到两张）", () => {
  const css = read("game.css");
  const rule = sel => { const at = css.indexOf(sel + " {"); return at < 0 ? "" : css.slice(at, css.indexOf("}", at) + 1); };
  const g = rule(".t-mascot .t-mascot-gulp");
  assert.match(g, /position: absolute/, "搞笑图叠在立绘上，不占地方");
  assert.match(g, /width: 100%/, "和立绘一样宽");
  assert.match(g, /visibility: hidden/, "平时看不见");
  assert.match(rule(".t-mascot.gulp img:not(.t-mascot-gulp)"), /visibility: hidden/, "换图时立绘只是看不见、照样占着地方：按钮大小不变");
  assert.match(rule(".t-mascot.gulp .t-mascot-gulp"), /visibility: visible/);
  assert.match(css, /@media \(max-width: 999px\) \{[^}]*\.t-mascot \{ position: relative; \}/, "窄屏：按钮是搞笑图的定位基准（宽屏本来就是 absolute）");
  assert.match(css, /\.t-mascot img \{[^}]*pointer-events: none/, "两张图都不接鼠标，点的都是按钮");
  assert.match(css, /\.t-mascot\.shake img \{ animation: tMascotShake/, "抖动管到两张图");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.t-mascot\.shake img \{ animation-name: tMascotBlink; \} \}/, "减少动态效果：两张都只淡一下");
});
