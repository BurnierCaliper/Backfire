// 主菜单的看板娘（#552，主人 11/01）：要浏览器的那部分——game.html 的主菜单首页里柏妮尔的立绘摆在哪、点一下真的抖一下。
//   · 宽屏（1366×768、1920×1080、1000×700）站在菜单右边、脚和最后一个按钮底边对齐，菜单本身的位置一点不动；
//     手机竖屏（390×844、360×640）、平板竖屏（820×1180）放到按钮下面、居中，标题不被裁掉，往下滚看得到全身。
//     两套样式（街头废土皮肤 skin.css 开着 / 关掉只剩 game.css）都量：不挡任何按钮和标题、在屏幕里、不撑出横向滚动条（抖的时候也不）。
//   · 点一下加上 .shake、图片真的晃、播完拿掉；连点从头再播不卡住；键盘 Tab 走得到、Enter / 空格也抖；开着「减少动态效果」不位移，只淡一下；
//     点它不触发任何菜单功能、不响音效（统一挂的点击声 / 悬停声）；进子菜单、进游戏后不显示，回到首页又显示；图片读不出来整个藏起来、主菜单照常。
// 不用浏览器的那部分（页面结构、class 的加 / 拿掉、兜底计时、读失败）在 tests/title-mascot.test.js。
// 用 Playwright；没装 Playwright 时在 Linux 上用机器自带的 Chrome（tests/cdp-browser.js），都没有就跳过。
// 截图：TITLE_MASCOT_SHOTS=1 时写 shots/title-mascot-desktop.png（1366×768）、shots/title-mascot-mobile.png（390×844）。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const GAME_URL = pathToFileURL(path.join(ROOT, "game.html")).href;
const SHOTS = process.env.TITLE_MASCOT_SHOTS ? path.join(ROOT, "shots") : null;

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

/** 打开 game.html 停在主菜单首页（立绘的图片读好、字体排好）；opt：viewport、mobile（手机：触屏）、init（页面脚本之前先跑） */
async function open(t, opt = {}) {
  const context = await browser.newContext({ viewport: opt.viewport || { width: 1366, height: 768 }, isMobile: !!opt.mobile, hasTouch: !!opt.mobile });
  await require("./old-screen")(context);
  if (opt.init) await context.addInitScript(opt.init);
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(GAME_URL);
  await page.waitForSelector("#scr-title:not([hidden])");
  await page.waitForFunction(() => { const img = document.querySelector("#t-mascot img"); return img && img.complete && img.naturalWidth > 0 && document.fonts.status === "loaded"; }, null, { timeout: 10000 });
  return { page, errors };
}

/** 在页面里跑：量主菜单首页——立绘、菜单、按钮、标题的位置，立绘压没压到别的东西，有没有横向溢出 */
function measure() {
  const r = el => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
  const scr = document.getElementById("scr-title"), el = document.getElementById("t-mascot"), img = el.querySelector("img");
  const m = r(el), others = [...document.querySelectorAll("#t-home .t-btn, #scr-title .t-name, #scr-title .t-sub")];
  const overlap = others.filter(o => { const b = o.getBoundingClientRect(); return b.width && b.height && !(b.right <= m.left || b.left >= m.right || b.bottom <= m.top || b.top >= m.bottom); }).map(o => o.id || o.className);
  return {
    mascot: m, visible: m.width > 0 && m.height > 0 && getComputedStyle(el).visibility !== "hidden", loaded: img.naturalWidth,
    card: r(document.querySelector("#scr-title .t-card")), home: r(document.getElementById("t-home")),
    btns: [...document.querySelectorAll("#t-home .t-btn")].map(r), name: r(document.querySelector("#scr-title .t-name")),
    overlap, view: { w: scr.clientWidth, h: scr.clientHeight }, overflowX: Math.max(scr.scrollWidth - scr.clientWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    scrollable: scr.scrollHeight - scr.clientHeight
  };
}
/** 在页面里跑：点一下立绘，抖的这段时间每一帧量横向溢出、图片的位移 / 旋转、透明度（等 class 拿掉为止，最多 2 秒） */
async function shakeOnce(how) {
  const scr = document.getElementById("scr-title"), el = document.getElementById("t-mascot"), img = el.querySelector("img");
  const out = { overflowX: 0, moved: false, faded: false, names: new Set(), frames: 0 };
  if (how === "click") el.click();
  const t0 = performance.now();
  out.added = el.classList.contains("shake");
  while (el.classList.contains("shake") && performance.now() - t0 < 2000) {
    const cs = getComputedStyle(img);
    out.names.add(cs.animationName);
    if ((cs.translate !== "none" && !/^0px( 0px)?$/.test(cs.translate)) || (cs.rotate !== "none" && cs.rotate !== "0deg")) out.moved = true;
    if (Number(cs.opacity) < 0.99) out.faded = true;
    out.overflowX = Math.max(out.overflowX, scr.scrollWidth - scr.clientWidth);
    out.frames++;
    await new Promise(r => requestAnimationFrame(r));
  }
  out.ms = Math.round(performance.now() - t0);
  out.removed = !el.classList.contains("shake");
  out.names = [...out.names];
  return out;
}
/** 菜单的状态：首页显示着、子菜单都没开、还在标题画面、图鉴没打开 */
const menuState = () => ({
  home: !document.getElementById("t-home").hidden,
  panels: [...document.querySelectorAll("#scr-title .t-panel")].filter(p => !p.hidden).map(p => p.id),
  screen: document.body.dataset.screen, title: !document.getElementById("scr-title").hidden,
  codex: !!(window.Bestiary && Bestiary.isOpen && Bestiary.isOpen())
});
const skin = (page, on) => page.evaluate(v => { document.querySelector('link[href="skin.css"]').disabled = !v; }, on);
/** 截图用：GitHub 上跑测试的 Linux 没装中文字体（汉字画成方框），截图时把正文字体（Noto Sans SC）换成游戏自带的站酷庆科黄油体
 *  （fonts/，只收了游戏里用到的字，缺的个别字还是方框）；用 data: URL（file:// 打开的页面不让跨域读字体文件）。只在截图时换，量尺寸的测试不换 */
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

test("宽屏：立绘站在菜单右边，脚和最后一个按钮的底边对齐；不挡按钮和标题、整个在屏幕里、不撑出横向滚动条；菜单本身的位置一点不动（皮肤开着 / 关掉都一样）", { timeout: 90000 }, async t => {
  if (!browser) { t.skip(skipWhy); return; }
  const { page, errors } = await open(t);
  for (const theme of ["皮肤", "只有 game.css"]) {
    await skin(page, theme === "皮肤");
    for (const vp of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 1000, height: 700 }]) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(150);
      const m = await page.evaluate(measure), at = `${theme} ${vp.width}×${vp.height}`;
      assert.ok(m.visible && m.loaded === 499, at + "：立绘显示出来、图片读好了");
      assert.deepEqual(m.overlap, [], at + "：不挡按钮、标题、副标题");
      assert.ok(m.mascot.left >= m.card.right + 8, at + `：在菜单右边（菜单右边 ${m.card.right}，立绘左边 ${m.mascot.left}）`);
      assert.ok(Math.abs(m.mascot.bottom - m.home.bottom) <= 1, at + "：脚和最后一个按钮的底边对齐");
      assert.ok(m.mascot.height >= 200, at + `：不会缩得太小（${Math.round(m.mascot.height)}px 高）`);
      assert.ok(m.mascot.left >= 0 && m.mascot.right <= m.view.w - 16 && m.mascot.top >= 0 && m.mascot.bottom <= m.view.h, at + "：整个在屏幕里，右边还留着空");
      assert.equal(m.overflowX, 0, at + "：没有横向滚动条");
      // 菜单的位置：和立绘藏起来时一模一样
      const without = await page.evaluate(() => { const el = document.getElementById("t-mascot"); el.style.display = "none"; const r = el => JSON.stringify(el.getBoundingClientRect()); const v = [...document.querySelectorAll("#scr-title .t-card, #t-home .t-btn")].map(r); el.style.display = ""; return v; });
      const withIt = await page.evaluate(() => [...document.querySelectorAll("#scr-title .t-card, #t-home .t-btn")].map(el => JSON.stringify(el.getBoundingClientRect())));
      assert.deepEqual(withIt, without, at + "：菜单和按钮的位置不变");
      // 抖的时候也不撑出横向滚动条
      const s = await page.evaluate(shakeOnce, "click");
      assert.ok(s.moved && s.removed, at + "：抖了一下、播完收掉");
      assert.equal(s.overflowX, 0, at + "：抖的时候也没有横向滚动条");
    }
  }
  await skin(page, true);
  await page.setViewportSize({ width: 1366, height: 768 });
  await shot(page, "title-mascot-desktop.png");
  assert.deepEqual(errors, []);
});

test("手机竖屏（390×844、360×640）、平板竖屏（820×1180）：立绘放到按钮下面、居中；标题不被裁掉，往下滚看得到全身；不挡按钮、不撑出横向滚动条（皮肤开着 / 关掉都一样）", { timeout: 90000 }, async t => {
  if (!browser) { t.skip(skipWhy); return; }
  const { page, errors } = await open(t, { viewport: { width: 390, height: 844 }, mobile: true });
  for (const theme of ["皮肤", "只有 game.css"]) {
    await skin(page, theme === "皮肤");
    for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 640 }, { width: 820, height: 1180 }]) {
      await page.setViewportSize(vp);
      await page.evaluate(() => { document.getElementById("scr-title").scrollTop = 0; });
      await page.waitForTimeout(150);
      const m = await page.evaluate(measure), at = `${theme} ${vp.width}×${vp.height}`;
      assert.ok(m.visible && m.loaded === 499, at + "：立绘显示出来");
      assert.deepEqual(m.overlap, [], at + "：不挡按钮、标题、副标题");
      const last = m.btns[m.btns.length - 1];
      assert.ok(m.mascot.top >= last.bottom, at + "：在按钮下面");
      assert.ok(Math.abs((m.mascot.left + m.mascot.right) / 2 - (m.card.left + m.card.right) / 2) <= 1, at + "：居中");
      assert.ok(m.mascot.height >= 170, at + `：不会缩得太小（${Math.round(m.mascot.height)}px 高）`);
      assert.ok(m.mascot.left >= 0 && m.mascot.right <= m.view.w, at + "：左右都在屏幕里");
      assert.equal(m.overflowX, 0, at + "：没有横向滚动条");
      assert.ok(m.name.top >= 0, at + `：标题没被裁掉（顶在 ${m.name.top}）`);
      // 比屏幕高的往下滚：看得到全身
      await page.evaluate(() => { const s = document.getElementById("scr-title"); s.scrollTop = s.scrollHeight; });
      const end = await page.evaluate(() => document.getElementById("t-mascot").getBoundingClientRect().bottom <= document.getElementById("scr-title").clientHeight + 0.5);
      assert.ok(end, at + "：滚到底看得到全身");
      await page.evaluate(() => { document.getElementById("scr-title").scrollTop = 0; });
      const s = await page.evaluate(shakeOnce, "click");
      assert.ok(s.moved && s.removed, at + "：抖了一下、播完收掉");
      assert.equal(s.overflowX, 0, at + "：抖的时候也没有横向滚动条");
    }
  }
  await skin(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  // 手机上用手指点一下也抖
  await page.tap("#t-mascot");
  assert.ok(await page.evaluate(() => document.getElementById("t-mascot").classList.contains("shake")), "手指点一下也抖");
  await page.waitForFunction(() => !document.getElementById("t-mascot").classList.contains("shake"), null, { timeout: 2000 });
  assert.deepEqual(await page.evaluate(menuState), { home: true, panels: [], screen: "title", title: true, codex: false }, "点了菜单没动");
  await page.evaluate(() => { document.getElementById("scr-title").scrollTop = 0; });
  await shot(page, "title-mascot-mobile.png");
  assert.deepEqual(errors, []);
});

test("点一下抖一下：加上 .shake、图片真的晃（tMascotShake），几百毫秒内播完拿掉；连点从头再播、不卡住；点它不触发任何菜单功能", { timeout: 60000 }, async t => {
  if (!browser) { t.skip(skipWhy); return; }
  const { page, errors } = await open(t);
  const before = await page.evaluate(menuState);
  assert.deepEqual(before, { home: true, panels: [], screen: "title", title: true, codex: false });
  // 真的用鼠标点（点在立绘中间）
  await page.click("#t-mascot");
  assert.ok(await page.evaluate(() => document.getElementById("t-mascot").classList.contains("shake")), "点一下加上 .shake");
  const s = await page.evaluate(shakeOnce, "watch");
  assert.ok(s.moved, "图片真的晃了");
  assert.deepEqual(s.names, ["tMascotShake"]);
  assert.ok(s.removed, "播完拿掉 .shake");
  const limit = await page.evaluate(() => TitleMascot.CONFIG.shakeMs + TitleMascot.CONFIG.spareMs);
  assert.ok(s.ms <= limit + 200, `几百毫秒内播完（${s.ms}ms）`);
  // 连点：每一下从头再播；最后一下播完就收掉，不会一直抖
  const rapid = await page.evaluate(async () => {
    const el = document.getElementById("t-mascot"), img = el.querySelector("img");
    const n = { start: 0, end: 0 };
    img.addEventListener("animationstart", () => n.start++);
    img.addEventListener("animationend", () => n.end++);
    for (let i = 0; i < 4; i++) { el.click(); await new Promise(r => setTimeout(r, 90)); }
    const still = el.classList.contains("shake"), t0 = performance.now();
    while (el.classList.contains("shake") && performance.now() - t0 < 2000) await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => setTimeout(r, 50));
    return { still, n, after: Math.round(performance.now() - t0), removed: !el.classList.contains("shake") };
  });
  assert.ok(rapid.still, "连点中一直在抖");
  assert.deepEqual(rapid.n, { start: 4, end: 1 }, "每点一下动画都从头播（开始了 4 次，前 3 次被下一下打断），只有最后一次播完");
  assert.ok(rapid.removed && rapid.after <= limit + 200, `最后一下播完就收掉（${rapid.after}ms）`);
  // 点了这么多下，菜单一点没动
  assert.deepEqual(await page.evaluate(menuState), before, "不进子菜单、不开图鉴、不换画面");
  assert.deepEqual(errors, []);
});

test("键盘：Tab 从「规则说明」走到立绘（有焦点框），Enter、空格都抖一下；首页上按 Esc 照旧什么都不做", { timeout: 60000 }, async t => {
  if (!browser) { t.skip(skipWhy); return; }
  const { page, errors } = await open(t);
  await page.focus("#t-rules");
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => { const el = document.activeElement; return { id: el.id, name: el.querySelector("img") && el.querySelector("img").alt, outline: getComputedStyle(el).outlineStyle, visible: el.matches(":focus-visible") }; });
  assert.deepEqual(focus, { id: "t-mascot", name: "柏妮尔", outline: "solid", visible: true }, "Tab 走到立绘，读屏读「柏妮尔」，有焦点框");
  const wait = () => page.waitForFunction(() => !document.getElementById("t-mascot").classList.contains("shake"), null, { timeout: 2000 });
  for (const key of ["Enter", "Space"]) {
    await page.keyboard.press(key);
    assert.ok(await page.evaluate(() => document.getElementById("t-mascot").classList.contains("shake")), key + " 也抖一下");
    await wait();
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(menuState), { home: true, panels: [], screen: "title", title: true, codex: false }, "菜单没动");
  assert.deepEqual(errors, []);
});

test("减少动态效果（prefers-reduced-motion: reduce）：点了不位移、不转，只淡一下（tMascotBlink）；.shake 照样加上、播完拿掉", { timeout: 60000 }, async t => {
  if (!browser) { t.skip(skipWhy); return; }
  const { page, errors } = await open(t);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const s = await page.evaluate(shakeOnce, "click");
  assert.ok(s.added && s.removed, "加上、播完拿掉");
  assert.deepEqual(s.names, ["tMascotBlink"]);
  assert.equal(s.moved, false, "不位移、不转");
  assert.ok(s.faded, "淡了一下");
  assert.deepEqual(errors, []);
});

test("只在主菜单首页：进「本地玩法」「联机玩法」子菜单不显示，返回（Esc / ← 返回）又显示；进游戏（新的一局 → 选队伍）后不显示", { timeout: 60000 }, async t => {
  if (!browser) { t.skip(skipWhy); return; }
  const { page, errors } = await open(t);
  const shown = () => page.isVisible("#t-mascot");
  assert.equal(await shown(), true);
  await page.click("#t-local");
  assert.equal(await shown(), false, "本地玩法里不显示");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#t-home", { state: "visible" });
  assert.equal(await shown(), true, "Esc 回到首页又显示");
  await page.click("#t-online");
  assert.equal(await shown(), false, "联机玩法里不显示");
  await page.click('#t-panel-online [data-back="online"]');
  assert.equal(await shown(), true, "← 返回 回到首页又显示");
  await page.click("#t-local");
  await page.click("#t-new");
  await page.waitForSelector("#scr-party", { state: "visible" });
  assert.equal(await shown(), false, "进游戏后（选队伍）不显示");
  assert.deepEqual(errors, []);
});

test("不响音效：点立绘、鼠标移上去都没有声音（按钮带 data-sfx-none）；对照：点普通的菜单按钮照常有点击声", { timeout: 60000 }, async t => {
  if (!browser) { t.skip(skipWhy); return; }
  // 页面脚本之前先数：每放一个录音（sfx.js · playSample）就 createBufferSource 一次
  const { page, errors } = await open(t, { init: () => {
    window.__sfxSources = 0;
    const P = (window.BaseAudioContext || window.AudioContext).prototype, f = P.createBufferSource;
    P.createBufferSource = function () { window.__sfxSources++; return f.apply(this, arguments); };
  } });
  await page.hover("#t-mascot");
  await page.click("#t-mascot");
  await page.click("#t-mascot");
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => window.__sfxSources), 0, "立绘：没有点击声、悬停声");
  await page.click("#t-local");
  await page.waitForFunction(() => window.__sfxSources > 0, null, { timeout: 5000 });
  assert.deepEqual(errors, []);
});

test("图片读不出来：整个立绘藏起来（不留空白大框、不占地方、Tab 不停在它上面），主菜单照常能用，没有报错", { timeout: 60000 }, async t => {
  if (!browser) { t.skip(skipWhy); return; }
  const { page, errors } = await open(t, { viewport: { width: 390, height: 844 }, mobile: true });
  const homeH = await page.evaluate(() => document.getElementById("t-home").getBoundingClientRect().height);
  await page.evaluate(() => { document.querySelector("#t-mascot img").src = "art/burnier/no-such-file.png"; });
  await page.waitForFunction(() => document.getElementById("t-mascot").hidden, null, { timeout: 5000 });
  const m = await page.evaluate(() => { const b = document.getElementById("t-mascot").getBoundingClientRect(); return { w: b.width, h: b.height, homeH: document.getElementById("t-home").getBoundingClientRect().height }; });
  assert.equal(m.w, 0); assert.equal(m.h, 0);
  assert.ok(m.homeH < homeH - 150, "不留空白大框：首页缩回原来的高度");
  await page.focus("#t-rules");
  await page.keyboard.press("Tab");
  assert.notEqual(await page.evaluate(() => document.activeElement.id), "t-mascot", "Tab 不停在藏起来的立绘上");
  await page.click("#t-local");
  assert.ok(await page.isVisible("#t-panel-local"), "主菜单照常能用");
  assert.deepEqual(errors, []);
});
