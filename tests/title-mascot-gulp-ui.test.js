// 主菜单彩蛋（#554，主人 11/01，接 #552 的看板娘）：要浏览器的那部分——game.html 主菜单首页上连续点柏妮尔，立绘真的换成「灌汽油」的搞笑图、过一会儿换回来。
//   · 宽屏（1366×768、1920×1080、1000×700）鼠标连点、手机竖屏（390×844、360×640）手指连点：点到第 gulpAfter 下换图，看得见的是搞笑图、立绘看不见；
//     按钮大小、菜单和按钮的位置一点不动，搞笑图在立绘的框里（不挡按钮、标题），没有横向滚动条；点它不触发菜单。
//   · 键盘 Enter / 空格连按也算；默认配置停 3 秒左右换回立绘；开着「减少动态效果」照样换图，只是不抖（只淡一下）；
//     搞笑图读不出来时点多少下都不换，立绘照常显示、照常抖。
// 不用浏览器的那部分（计数、隔太久从头数、换回来计数归零、显示期间不数不延长、改配置）在 tests/title-mascot-gulp.test.js（假时钟）。
// 用 Playwright；没装 Playwright 时在 Linux 上用机器自带的 Chrome（tests/cdp-browser.js），都没有就跳过。
// 截图：BURNIER_GULP_SHOTS=1 时写 shots/title-mascot-gulp-desktop.png（1366×768）、shots/title-mascot-gulp-mobile.png（390×844）。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const GAME_URL = pathToFileURL(path.join(ROOT, "game.html")).href;
const SHOTS = process.env.BURNIER_GULP_SHOTS ? path.join(ROOT, "shots") : null;

function playwright() {
  try { return require("playwright"); } catch (_) { /* 没装在本地 */ }
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) { /* 也没装在全局 */ }
  return null;
}
let browser = null, skipWhy = "";
test.before(async () => {
  try {
    const pw = playwright();
    browser = pw ? await pw.chromium.launch() : await require("./cdp-browser").launch();
    if (!browser) skipWhy = "没装 Playwright，也没有能用的 Chrome，跳过画面测试";
  } catch (e) {
    if (process.env.REQUIRE_UI === "1") throw e;
    browser = null; skipWhy = "浏览器启动失败，跳过画面测试：" + String(e.message).split("\n")[0];
  }
});
test.after(async () => { if (browser) await browser.close(); });

/** 打开 game.html 停在主菜单首页（立绘、搞笑图都读好、字体排好）；opt：viewport、mobile（手机：触屏） */
async function open(t, opt = {}) {
  const context = await browser.newContext({ viewport: opt.viewport || { width: 1366, height: 768 }, isMobile: !!opt.mobile, hasTouch: !!opt.mobile });
  await require("./old-screen")(context);
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(GAME_URL);
  await page.waitForSelector("#scr-title:not([hidden])");
  await page.waitForFunction(() => [...document.querySelectorAll("#t-mascot img")].every(img => img.complete && img.naturalWidth > 0) && document.fonts.status === "loaded", null, { timeout: 10000 });
  return { page, errors };
}

/** 在页面里跑：现在的样子——显示的是哪张、按钮 / 两张图 / 菜单的位置、搞笑图压没压到按钮和标题、有没有横向溢出 */
function look() {
  const r = el => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
  const scr = document.getElementById("scr-title"), el = document.getElementById("t-mascot");
  const stand = el.querySelector("img"), gulp = el.querySelector(".t-mascot-gulp"), g = r(gulp);
  const overlap = [...document.querySelectorAll("#t-home .t-btn, #scr-title .t-name, #scr-title .t-sub")]
    .filter(o => { const b = o.getBoundingClientRect(); return b.width && b.height && !(b.right <= g.left || b.left >= g.right || b.bottom <= g.top || b.top >= g.bottom); }).map(o => o.id || o.className);
  return {
    gulp: el.classList.contains("gulp"), shaking: el.classList.contains("shake"),
    standVis: getComputedStyle(stand).visibility, gulpVis: getComputedStyle(gulp).visibility,
    box: r(el), g, stand: r(stand), overlap,
    layout: [...document.querySelectorAll("#scr-title .t-card, #t-home .t-btn, #scr-title .t-name, #scr-title .t-sub")].map(x => JSON.stringify(x.getBoundingClientRect())),
    overflowX: Math.max(scr.scrollWidth - scr.clientWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    view: { w: scr.clientWidth, h: scr.clientHeight }
  };
}
const menuState = () => ({
  home: !document.getElementById("t-home").hidden,
  panels: [...document.querySelectorAll("#scr-title .t-panel")].filter(p => !p.hidden).map(p => p.id),
  screen: document.body.dataset.screen, title: !document.getElementById("scr-title").hidden
});
/** 等这一下的抖动播完（量位置时不带着晃） */
const settle = page => page.waitForFunction(() => !document.getElementById("t-mascot").classList.contains("shake"), null, { timeout: 3000 });
/** 换图前后对照：显示的是搞笑图、立绘看不见；按钮大小、菜单位置不变；搞笑图在立绘的框里、不挡按钮和标题、没有横向溢出 */
function checkSwap(before, after, at) {
  assert.equal(before.gulp, false, at + "：换图前是立绘");
  assert.deepEqual([before.standVis, before.gulpVis], ["visible", "hidden"], at + "：换图前看得见的是立绘");
  assert.equal(after.gulp, true, at + "：点到第 gulpAfter 下换成搞笑图");
  assert.deepEqual([after.standVis, after.gulpVis], ["hidden", "visible"], at + "：看得见的是搞笑图，立绘看不见");
  assert.deepEqual(after.box, before.box, at + "：按钮大小、位置不变（版面不跳）");
  assert.deepEqual(after.layout, before.layout, at + "：菜单、按钮、标题的位置不变");
  const b = after.box, g = after.g;
  assert.ok(g.width > 0 && Math.abs(g.width - b.width) <= 1, at + `：搞笑图和立绘一样宽（${g.width} / ${b.width}）`);
  assert.ok(g.left >= b.left - 0.5 && g.right <= b.right + 0.5 && g.top >= b.top - 0.5 && g.bottom <= b.bottom + 0.5, at + "：搞笑图在立绘的框里");
  assert.ok(Math.abs(g.top - b.top) <= 1, at + "：贴着立绘的顶（头的位置接得上）");
  assert.deepEqual(after.overlap, [], at + "：不挡按钮、标题、副标题");
  assert.equal(after.overflowX, 0, at + "：没有横向滚动条");
}
/** 截图用（同 tests/title-mascot-ui.test.js）：GitHub 上跑测试的 Linux 没装中文字体，正文字体（Noto Sans SC）临时换成游戏自带的站酷庆科黄油体（data: URL） */
function cjkFontCss() {
  return (fs.readFileSync(path.join(ROOT, "fonts/fonts.css"), "utf8").match(/@font-face \{ font-family: 'ZCOOL QingKe HuangYou';[^}]*\}/g) || []).map(rule => rule
    .replace("'ZCOOL QingKe HuangYou'", "'Noto Sans SC'").replace("U+0020-007E, ", "")
    .replace(/url\(([^)]+)\)/, (m, f) => `url(data:font/woff2;base64,${fs.readFileSync(path.join(ROOT, "fonts", f)).toString("base64")})`)).join("\n");
}
async function shot(page, name) {
  if (!SHOTS) return;
  await page.evaluate(async css => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); await document.fonts.load("20px 'Noto Sans SC'", "本地玩法联机图鉴规则说明"); await document.fonts.ready; }, cjkFontCss());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, name) });
}

test("宽屏（1366×768、1920×1080、1000×700）：鼠标连点立绘，第 10 下换成搞笑图——看得见的是搞笑图、立绘看不见；按钮大小、菜单位置不变，搞笑图在立绘的框里，不挡按钮和标题、没有横向滚动条（皮肤开着 / 关掉都一样）；点了不触发菜单", { timeout: 120000 }, async t => {
  if (!browser) { t.skip(skipWhy); return; }
  const { page, errors } = await open(t);
  await page.evaluate(() => { TitleMascot.TAP.gulpMs = 60000; });   // 量的时候别换回去
  for (const theme of ["皮肤", "只有 game.css"]) {
    await page.evaluate(v => { document.querySelector('link[href="skin.css"]').disabled = !v; }, theme === "皮肤");
    for (const vp of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 1000, height: 700 }]) {
      const at = `${theme} ${vp.width}×${vp.height}`;
      await page.setViewportSize(vp);
      await page.evaluate(() => { const el = document.getElementById("t-mascot"); el.classList.remove("gulp"); TitleMascot.bind(); });   // 换回立绘、从头数
      await page.waitForTimeout(150);
      const before = await page.evaluate(look);
      for (let i = 0; i < 9; i++) await page.click("#t-mascot");
      assert.equal((await page.evaluate(look)).gulp, false, at + "：点 9 下还是立绘");
      await page.click("#t-mascot");
      await settle(page);
      checkSwap(before, await page.evaluate(look), at);
    }
  }
  assert.deepEqual(await page.evaluate(menuState), { home: true, panels: [], screen: "title", title: true }, "点了这么多下，菜单没动");
  await page.evaluate(() => { document.querySelector('link[href="skin.css"]').disabled = false; });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(150);
  await shot(page, "title-mascot-gulp-desktop.png");
  assert.deepEqual(errors, []);
});

test("手机竖屏（390×844、360×640）：手指连点立绘 10 下换成搞笑图，版面不动、在立绘的框里、不挡按钮、没有横向滚动条", { timeout: 120000 }, async t => {
  if (!browser) { t.skip(skipWhy); return; }
  const { page, errors } = await open(t, { viewport: { width: 390, height: 844 }, mobile: true });
  await page.evaluate(() => { TitleMascot.TAP.gulpMs = 60000; });
  for (const vp of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
    const at = `${vp.width}×${vp.height}`;
    await page.setViewportSize(vp);
    await page.evaluate(() => { document.getElementById("t-mascot").classList.remove("gulp"); TitleMascot.bind(); document.getElementById("t-mascot").scrollIntoView({ block: "center" }); });
    await page.waitForTimeout(150);
    const before = await page.evaluate(look);
    for (let i = 0; i < 10; i++) await page.tap("#t-mascot");
    await settle(page);
    checkSwap(before, await page.evaluate(look), at);
  }
  assert.deepEqual(await page.evaluate(menuState), { home: true, panels: [], screen: "title", title: true }, "菜单没动");
  await page.evaluate(() => { document.getElementById("scr-title").scrollTop = 0; });
  await page.waitForTimeout(150);
  await shot(page, "title-mascot-gulp-mobile.png");
  assert.deepEqual(errors, []);
});

test("键盘 Enter / 空格连按也算；默认配置停 3 秒左右换回立绘；开着「减少动态效果」照样换图，只是不抖（搞笑图只淡一下、不位移）", { timeout: 60000 }, async t => {
  if (!browser) { t.skip(skipWhy); return; }
  const { page, errors } = await open(t);
  assert.deepEqual(await page.evaluate(() => [TitleMascot.TAP.gulpAfter, TitleMascot.TAP.gap, TitleMascot.TAP.gulpMs]), [10, 1500, 3000]);
  await page.focus("#t-mascot");
  for (let i = 0; i < 10; i++) await page.keyboard.press(i % 2 ? "Space" : "Enter");
  assert.equal((await page.evaluate(look)).gulp, true, "Enter、空格各按 5 下：换成搞笑图");
  const t0 = Date.now();
  await page.waitForTimeout(2500);
  assert.equal((await page.evaluate(look)).gulp, true, "2.5 秒还在");
  await page.waitForFunction(() => !document.getElementById("t-mascot").classList.contains("gulp"), null, { timeout: 3000 });
  const ms = Date.now() - t0, back = await page.evaluate(look);
  assert.ok(ms <= 3600, `3 秒左右换回（${ms}ms）`);
  assert.deepEqual([back.standVis, back.gulpVis], ["visible", "hidden"], "换回立绘");
  assert.equal(await page.evaluate(() => TitleMascot.tapCount()), 0, "计数归零");
  // 减少动态效果：照样换，换图那一下搞笑图只淡一下
  await page.emulateMedia({ reducedMotion: "reduce" });
  const r = await page.evaluate(async () => {
    const el = document.getElementById("t-mascot"), gulp = el.querySelector(".t-mascot-gulp");
    for (let i = 0; i < 10; i++) el.click();
    const out = { gulp: el.classList.contains("gulp"), vis: getComputedStyle(gulp).visibility, names: new Set(), moved: false };
    const t1 = performance.now();
    while (el.classList.contains("shake") && performance.now() - t1 < 2000) {
      const cs = getComputedStyle(gulp);
      out.names.add(cs.animationName);
      if ((cs.translate !== "none" && !/^0px( 0px)?$/.test(cs.translate)) || (cs.rotate !== "none" && cs.rotate !== "0deg")) out.moved = true;
      await new Promise(res => requestAnimationFrame(res));
    }
    out.names = [...out.names];
    return out;
  });
  assert.deepEqual(r, { gulp: true, vis: "visible", names: ["tMascotBlink"], moved: false }, "减少动态效果：照样换成搞笑图，不位移、不转");
  assert.deepEqual(await page.evaluate(menuState), { home: true, panels: [], screen: "title", title: true }, "菜单没动");
  assert.deepEqual(errors, []);
});

test("搞笑图读不出来：连点多少下都不换，立绘照常显示、照常抖；主菜单照常", { timeout: 60000 }, async t => {
  if (!browser) { t.skip(skipWhy); return; }
  const { page, errors } = await open(t);
  await page.evaluate(() => { document.querySelector("#t-mascot .t-mascot-gulp").src = "art/burnier/no-such-gulp.png"; });
  await page.waitForFunction(() => { const g = document.querySelector("#t-mascot .t-mascot-gulp"); return g.complete && g.naturalWidth === 0; }, null, { timeout: 5000 });
  for (let i = 0; i < 12; i++) await page.click("#t-mascot");
  const l = await page.evaluate(look);
  assert.equal(l.gulp, false, "不换图");
  assert.ok(l.shaking, "照常抖");
  assert.deepEqual([l.standVis, l.gulpVis], ["visible", "hidden"], "看得见的还是立绘，不会露出读不出来的图");
  assert.equal(await page.isVisible("#t-mascot"), true, "立绘照常显示");
  await page.click("#t-local");
  assert.ok(await page.isVisible("#t-panel-local"), "主菜单照常能用");
  assert.deepEqual(errors, []);
});
