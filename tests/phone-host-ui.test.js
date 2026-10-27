// #429 安卓手机（Chrome）当联机跑团主持人：战斗画面（纸片画面 + 新画面）在手机上能用——要浏览器的那部分。
//   第 1 步：顶栏胶带上的「菜单」完整在屏幕里、点得开（手机没有 Esc）；暂停页面里进得去主持人工具、消息与成员、离开并保存；
//            竖屏 412×915、横屏 915×412 都不横向溢出；手机竖屏上远 / 中 / 近收成一个按钮（点一下换下一段）；电脑上照旧
// 用真的 game.html 当联机房主（假的转发连接、房间里还有一名玩家「甲」，同 tests/online-explore-back.test.js），
// 新画面换成不画 WebGL 的假场景（布局、取景、镜头按钮照真的走，同 tests/game-paper-ui.test.js）。
// 手机用 Playwright 的移动端模拟（412×915、isMobile、hasTouch），只用点按（page.tap）；
// 没装 Playwright 时在 Linux 上用机器自带的 Chrome（tests/cdp-browser.js），都没有就跳过。
// 环境变量 PAPER_SHOTS=目录：顺手把几张画面截图存下来（给人看，不参与判断）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const file = f => path.join(ROOT, f);

function playwright() {
  try { return require("playwright"); } catch (_) { /* 没装在本地 */ }
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) { /* 也没装在全局 */ }
  return null;
}
let browser = null, skipWhy = "", server = null, origin = "";
test.before(async () => {
  try {
    const pw = playwright();
    browser = pw ? await pw.chromium.launch() : await require("./cdp-browser").launch();
    if (!browser) skipWhy = "没装 Playwright，也没有能用的 Chrome，跳过画面测试";
  } catch (e) {
    if (process.env.REQUIRE_UI === "1") throw e;
    browser = null; skipWhy = "浏览器启动失败，跳过画面测试：" + String(e.message).split("\n")[0];
  }
  if (!browser) return;
  // 页面走本地的 http（同 online-explore-back.test.js）
  server = http.createServer((req, res) => {
    const f = path.resolve(ROOT, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
    if (!f.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(f, (error, bytes) => {
      if (error) { res.writeHead(404); res.end(); return; }
      res.setHeader("Content-Type", ({ ".js": "application/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" })[path.extname(f)] || "application/octet-stream");
      res.end(bytes);
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  origin = "http://127.0.0.1:" + server.address().port;
});
test.after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function shot(page, name) {
  const dir = process.env.PAPER_SHOTS;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.evaluate(() => document.fonts && document.fonts.ready.then(() => 0));
  fs.writeFileSync(path.join(dir, name + ".png"), await page.screenshot());
}

/** 安卓手机竖屏 / 横过来 / 电脑 */
const PHONE = { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true };
const LAND = { viewport: { width: 915, height: 412 }, isMobile: true, hasTouch: true };
const DESK = { viewport: { width: 1440, height: 900 } };
/** 新画面要的普通脚本（真的那几个；场景包 hd2d-scene.bundle.js 换成下面的假场景） */
const HD2D_SCRIPTS = ["hd2d/hd2d-layout.js", "hd2d/hd2d-camera.js", "hd2d/hd2d-fx.js", "hd2d/hd2d-ui.js", "hd2d/hd2d-shell.js"];
const settle = page => page.waitForTimeout(150);

/**
 * 联机房主的 game.html：假的转发连接（房间里还有一名在线玩家「甲」p-1），开好跑团房间、开始游戏、进战斗（不开打），
 * 打开新画面（假场景：hd2d-field.js 交给它的东西记在 window.__scene，镜头按钮照真的那样报「远景」，点了换段）——纸片画面。
 * ctx = 视口（默认 412×915 的安卓手机）
 */
async function hostPage(t, ctx) {
  if (!browser) { t.skip(skipWhy); return null; }
  const context = await browser.newContext(ctx || PHONE);
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.accept());   // Playwright：确认框点「确定」（备用浏览器自己会点）
  await page.goto(origin + "/game.html");
  // 页面加载时新画面记着「关」：不去加载真的 3D（下面换成假场景再打开）
  await page.evaluate(() => localStorage.setItem("backfire-hd2d-field", "off"));
  await page.goto(origin + "/game.html");
  await page.waitForFunction(() => !!window.OnlineGame && !!window.GAME && !!window.TrpgFlow && !!window.HotseatGame && !!window.GamePaper && !!window.HD2DField && !!window.PauseMenu);
  await page.evaluate(() => {
    window.__noLevelUpPopup = true;
    window.confirm = () => true;
    const roster = [{ id: "gm-1", name: "主持人", role: "host", online: true }, { id: "p-1", name: "甲", role: "player", online: true }];
    const relay = window.__relay = { sent: [], onMessage: null, onStatus: null, status: { connected: true, paused: false, hostOnline: true, roster } };
    const copy = v => JSON.parse(JSON.stringify(v));
    RelayTransport.createHost = async options => {
      const ep = {
        identity: { id: "gm-1", role: "host", roomCode: "SA3X7C", name: "主持人" },
        credentials: () => ({ url: "fake://relay", roomCode: "SA3X7C", role: "host", token: "token-429", protocol: options.protocol, build: options.build }),
        status: () => copy(relay.status),
        send(value, to) { relay.sent.push({ to, value: copy(value) }); return Promise.resolve(); },
        setReady: () => Promise.resolve(), releaseSeat: () => Promise.resolve(),
        onMessage(fn) { relay.onMessage = fn; return () => {}; },
        onStatus(fn) { relay.onStatus = fn; fn(copy(relay.status)); return () => {}; },
        close() {}, reconnect: () => Promise.resolve(ep)
      };
      return ep;
    };
    // 发给玩家「甲」的最后一包；玩家发来一条指令（走房主的 receive，和真的转发一样）
    window.__last = id => { const hit = relay.sent.filter(x => x.to === id && ["result", "resync"].includes(x.value.type)).pop(); return hit ? hit.value : null; };
    let no = 0;
    window.__fromPlayer = (id, command) => relay.onMessage({ type: "cmd", requestId: ++no, command, protocol: OnlineGame.PROTOCOL, build: OnlineGame.BUILD }, id);
  });
  await page.evaluate(async () => { await OnlineGame.create({ url: "fake://relay", name: "主持人", slot: 0, campaignName: "#429" }); OnlineGame.start(); });
  await page.waitForFunction(() => OnlineGame.getView().screen === "exploration" && !OnlineGame.isPaused());
  // 进战斗（不开打）；开战前的大字点掉
  await page.evaluate(() => { TrpgFlow.toBattle(); GAME.fast = true; });
  await page.waitForFunction(() => Screens.is("battle") && !state.combatStarted);
  await page.evaluate(() => { const intro = document.querySelector("#g-intro"); if (intro) intro.click(); });
  await page.waitForFunction(() => !document.querySelector("#g-intro"));
  // 新画面：假场景
  for (const f of HD2D_SCRIPTS) await page.addScriptTag({ path: file(f) });
  await page.evaluate(() => {
    window.HD2DWfx = { windOf: () => ({ x: 1, z: 0 }), create: () => ({ sync() {}, dispose() {} }) };   // 天气的 2D 层要真的 3D
    window.__scene = null;
    const cam = (opts, tier) => setTimeout(() => opts.onCameraChange({ tier, tag: "", close: null, prev: null, next: null }), 0);
    const create = (stage, opts) => {
      let ins = { top: 0, bottom: 0 };
      const sc = {
        portrait: false, motion: false, tier: "far", zone: null, flash: 0, layout: null, layouts: 0, opts,
        view: () => ({ width: Math.max(1, stage.clientWidth), height: Math.max(1, stage.clientHeight), top: ins.top, bottom: ins.bottom }),
        insets: () => ins,
        setInsets: (i) => { ins = { top: i.top || 0, bottom: i.bottom || 0 }; },
        setBattle: (layout) => { sc.layout = layout; sc.layouts++; },
        refit() {}, setMarks() {}, setActor() {}, setWind() {}, stepZone() {},
        setTier: (t) => { sc.tier = t; cam(opts, t); },
        lensNow: () => ({ pos: sc.layout.camera.pos, target: sc.layout.camera.target, fov: sc.layout.camera.fov, width: sc.view().width, height: sc.view().height }),
        plateOf: () => null, zoneOf: () => null, dispose() { sc.disposed = true; }
      };
      window.__scene = sc;
      cam(opts, "far");
      return sc;
    };
    HD2DField.boot({ load: () => Promise.resolve(create), reduced: () => true });
    HD2DField.switchTo("new");
  });
  await page.waitForFunction(() => document.body.classList.contains("g-paper") && !!document.querySelector("#g-paper .olp-top") && !!document.querySelector("#g-app > .g-hud.hd2d-shell"));
  await page.waitForFunction(() => /联机跑团/.test(document.querySelector("#g-paper .olp-title").textContent) && !!document.querySelector("#g-paper .olp-room"));
  await settle(page);
  return { page, errors, context };
}
/** 开打（英雄都归主持人），选完行动顺序（主持人「按当前格子开始」）进我方行动 */
async function toActing(page) {
  await page.evaluate(() => GAME.startOrEnd());
  await page.waitForFunction(() => state.combatStarted && HotseatGame.getView().phase === "picking" && GAME.depth === 0, null, { timeout: 15000 });
  await page.evaluate(() => OnlineGame.submit({ type: "orderStart" }));
  await page.waitForFunction(() => HotseatGame.getView().phase === "acting" && GAME.depth === 0, null, { timeout: 15000 });
  await settle(page);
}

/** 元素这一刻在不在屏幕里、点下去是不是点到它（没被盖住）：{ box, inside, hit } */
const reach = (page, sel) => page.evaluate(sel => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, at = document.elementFromPoint(x, y);
  return { box: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], vw: innerWidth, vh: innerHeight,
    inside: r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    hit: !!at && (at === el || el.contains(at)) };
}, sel);
/** 遭遇名写长一点（跑团的遭遇常常是「地点 · 敌人 · 第几波」一长串；game.js 开战前写一次，之后不改） */
const LONG_NAME = "第一采矿场 · 狂徒伏击 · 夜半追兵（第二波）";
async function longEncounter(page) {
  await page.evaluate(n => { document.getElementById("g-enc-name").textContent = n; GamePaper.sync(); }, LONG_NAME);
  await page.waitForFunction(() => /追兵/.test(document.querySelector("#g-paper .olp-sub").textContent));
  await settle(page);
}
/** 横向不溢出：页面本身不能左右滑 */
const noSideScroll = page => page.evaluate(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, vw: innerWidth }));
const MENU = "#g-paper .olp-top [data-pause-open]", TOOLS = '#g-paper .olp-top [data-olp="tools"]';

/** 胶带上的「菜单」：完整在屏幕里、点得到；「工具 ▾」也在屏幕里；页面不横向溢出 */
async function menuReachable(page, why) {
  const m = await reach(page, MENU), tl = await reach(page, TOOLS);
  assert.ok(m && m.inside && m.hit, why + "：「菜单」完整在屏幕里、点得到：" + JSON.stringify(m));
  assert.ok(tl && tl.inside && tl.hit, why + "：「工具 ▾」也在屏幕里：" + JSON.stringify(tl));
  const s = await noSideScroll(page);
  assert.ok(s.doc <= s.vw && s.body <= s.vw, why + "：页面不横向溢出：" + JSON.stringify(s));
}
/** 只用点按：点胶带上的「菜单」打开暂停页面，里面有主持人工具、消息与成员、离开并保存；点「主持人工具」打开面板（在屏幕里），关掉 */
async function hostToolsByTap(page, why) {
  await page.tap(MENU);
  await page.waitForSelector("#pm-overlay", { state: "visible" });
  const ids = await page.evaluate(() => PauseMenu.list().map(r => r.id));
  for (const id of ["gmTools", "room", "leave"]) assert.ok(ids.includes(id), why + "：暂停页面里有 " + id + "：" + ids);
  await page.tap('#pm-overlay [data-pause-item="gmTools"]');
  await page.waitForSelector("#ogm-panel", { state: "visible" });
  assert.match(await page.locator("#ogm-panel h2").innerText(), /主持人工具/);
  const panel = await page.evaluate(() => { const r = document.getElementById("ogm-panel").getBoundingClientRect(); return { left: r.left, right: r.right, vw: innerWidth }; });
  assert.ok(panel.left >= 0 && panel.right <= panel.vw + 0.5, why + "：主持人工具面板在屏幕里：" + JSON.stringify(panel));
  await page.tap('#ogm-panel [data-action="close"]');
  await page.waitForSelector("#ogm-panel", { state: "detached" });
}

/* ---------- 第 1 步：「菜单」在屏幕里、点得开 ---------- */
test("#429 手机竖屏 412×915 的主持人：开战前、选行动顺序、行动中，胶带上的「菜单」都完整在屏幕里（以前在 x = 404–445，只露 8 像素），只用点按就打开暂停页面、进主持人工具；页面不横向溢出", { timeout: 120000 }, async t => {
  const o = await hostPage(t); if (!o) return; const { page } = o;
  // 房主那一条：房间码红章、遭遇名、准备中、等待开始、天气……都挤在一起
  assert.match((await page.locator("#g-paper .olp-top").innerText()).replace(/\s+/g, " "), /SA3X7C/);
  await menuReachable(page, "开战前");
  await hostToolsByTap(page, "开战前");
  await page.evaluate(() => GAME.startOrEnd());
  await page.waitForFunction(() => state.combatStarted && HotseatGame.getView().phase === "picking" && GAME.depth === 0, null, { timeout: 15000 });
  await settle(page);
  await menuReachable(page, "选行动顺序");
  await page.evaluate(() => OnlineGame.submit({ type: "orderStart" }));
  await page.waitForFunction(() => HotseatGame.getView().phase === "acting" && GAME.depth === 0, null, { timeout: 15000 });
  await settle(page);
  assert.match(await page.locator("#g-paper .olp-top").innerText(), /第 1 回合/);
  await menuReachable(page, "行动中");
  await hostToolsByTap(page, "行动中");
  await longEncounter(page);
  await menuReachable(page, "遭遇名长");
  // 「工具 ▾」下拉也整个在屏幕里
  await page.tap(TOOLS);
  await page.waitForSelector("#g-app > .g-top.gp-open", { state: "visible" });
  const drop = await page.evaluate(() => { const r = document.querySelector("#g-app > .g-top.gp-open").getBoundingClientRect(); return { left: r.left, right: r.right, vw: innerWidth }; });
  assert.ok(drop.left >= 0 && drop.right <= drop.vw, "「工具 ▾」下拉在屏幕里：" + JSON.stringify(drop));
  await page.tap(TOOLS);
  await page.waitForSelector("#g-app > .g-top", { state: "hidden" });
  await shot(page, "429-phone-host");
  assert.deepEqual(o.errors, []);
});

test("#429 手机横过来 915×412 的主持人：胶带上的「菜单」完整在屏幕里（以前在 852–930；遭遇名长时整个出界），点得开、进得去主持人工具；页面不横向溢出", { timeout: 120000 }, async t => {
  const o = await hostPage(t, LAND); if (!o) return; const { page } = o;
  await menuReachable(page, "横屏开战前");
  await toActing(page);
  await menuReachable(page, "横屏行动中");
  await longEncounter(page);
  await menuReachable(page, "横屏、遭遇名长");
  await hostToolsByTap(page, "横屏、遭遇名长");
  await shot(page, "429-land-host");
  assert.deepEqual(o.errors, []);
});

test("#429 胶带放不下时左边的字按先后省略：右边的镜头、「工具 ▾」「菜单」不缩；回合、我方 / 敌人行动、房间码照原样完整，遭遇名先省略成「…」，天气留到最后", { timeout: 120000 }, async t => {
  const o = await hostPage(t); if (!o) return; const { page } = o;
  await toActing(page);
  await longEncounter(page);
  const m = await page.evaluate(() => {
    const top = document.querySelector("#g-paper .olp-top"), r = el => el.getBoundingClientRect();
    const fit = sel => { const el = top.querySelector(sel); return el ? { full: el.scrollWidth <= el.clientWidth + 0.5, w: Math.round(r(el).width) } : null; };
    return { room: fit(".olp-room"), turn: fit(".olp-turn"), phase: fit(".olp-phase"), weather: fit(".olp-weather"), sub: fit(".olp-sub"),
      rightIn: r(top.querySelector(".olp-right")).right <= r(top).right + 0.5, menuIn: r(top.querySelector("[data-pause-open]")).right <= innerWidth };
  });
  assert.equal(m.rightIn && m.menuIn, true, "右边那一组在胶带里、「菜单」在屏幕里：" + JSON.stringify(m));
  assert.deepEqual([m.room.full, m.turn.full, m.phase.full, m.weather.full], [true, true, true, true], "回合、行动、房间码、天气完整：" + JSON.stringify(m));
  assert.equal(m.sub.full, false, "遭遇名先省略：" + JSON.stringify(m));
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#g-paper .olp-sub")).textOverflow), "ellipsis");
  assert.deepEqual(o.errors, []);
});

test("#429 手机竖屏：远 / 中 / 近收成一个按钮（写这一刻是哪一段），点一下换下一段（点的是新画面原来那个按钮），远 → 中 → 近 → 远", { timeout: 120000 }, async t => {
  const o = await hostPage(t); if (!o) return; const { page } = o;
  const look = () => page.evaluate(() => ({ three: [...document.querySelectorAll("#g-paper .olp-cam-b")].filter(b => b.getClientRects().length > 0).length,
    cyc: (document.querySelector("#g-paper .olp-cam-cyc") || {}).textContent, shown: !!document.querySelector("#g-paper .olp-cam-cyc") && document.querySelector("#g-paper .olp-cam-cyc").getClientRects().length > 0 }));
  assert.deepEqual(await look(), { three: 0, cyc: "远", shown: true }, "三个按钮收起来，只剩一个写着「远」");
  const cyc = await reach(page, "#g-paper .olp-cam-cyc");
  assert.ok(cyc.inside && cyc.hit, "点得到：" + JSON.stringify(cyc));
  for (const [tier, label] of [["mid", "中"], ["near", "近"], ["far", "远"]]) {
    await page.tap("#g-paper .olp-cam-cyc");
    await page.waitForFunction(([tier, label]) => window.__scene.tier === tier && document.querySelector("#g-paper .olp-cam-cyc").textContent === label, [tier, label]);
  }
  assert.match(await page.evaluate(() => document.querySelector("#g-paper .olp-cam-cyc").getAttribute("aria-label")), /镜头 远：点一下换到 中/);
  assert.deepEqual(o.errors, []);
});

test("#429 电脑上照旧：胶带上还是远 / 中 / 近三个按钮（收成一个的那个藏着）、「菜单 Esc」，字一个不省略", { timeout: 120000 }, async t => {
  const o = await hostPage(t, DESK); if (!o) return; const { page } = o;
  await toActing(page);
  const d = await page.evaluate(() => {
    const top = document.querySelector("#g-paper .olp-top"), shown = el => !!el && el.getClientRects().length > 0;
    return { three: [...top.querySelectorAll(".olp-cam-b")].filter(shown).length, cyc: shown(top.querySelector(".olp-cam-cyc")), kbd: shown(top.querySelector(".olp-menu-b kbd")),
      cut: [...top.querySelectorAll(":scope > :is(.olp-title, .olp-room, .olp-meta)")].filter(el => shown(el) && el.scrollWidth > el.clientWidth + 0.5).map(el => el.className),
      shrink: getComputedStyle(top.querySelector(".olp-sub")).flexShrink, cam: top.querySelector(".olp-cam-b").getBoundingClientRect().width };
  });
  assert.deepEqual(d, { three: 3, cyc: false, kbd: true, cut: [], shrink: "0", cam: 30 });
  await menuReachable(page, "电脑");
  assert.deepEqual(o.errors, []);
});

/* ---------- 第 2 步：触屏上键盘才有的操作都有看得见的按钮，提示不写按键 ---------- */
/** 技能栏展开（手机上没记过时默认收着）：点「技能 ▲」 */
async function openDock(page) {
  if (await page.evaluate(() => document.querySelector("#g-app > .g-hud").classList.contains("dock-closed"))) await page.tap("#g-app > .g-hud .hd2d-dock-toggle");
  await page.waitForFunction(() => !document.querySelector("#g-app > .g-hud").classList.contains("dock-closed") && !!document.querySelector("#g-skills .sk"));
  await settle(page);
}
/** 这一刻看得见的元素（有大小、没被藏起来） */
const shownText = (page, sel) => page.evaluate(sel => [...document.querySelectorAll(sel)].filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden").map(el => el.innerText.replace(/\s+/g, " ").trim()), sel);
const KEYS = /Tab|空格|Esc|右键|数字键|（Q）|· Q/;

test("#429 触屏（412×915，只用点按）：提示、按钮上不写按键（Tab、空格、Esc、数字键、Q）——默认提示写点头像换人、点「结束单位行动」结束", { timeout: 120000 }, async t => {
  const o = await hostPage(t); if (!o) return; const { page } = o;
  await toActing(page);
  await openDock(page);
  const look = await page.evaluate(() => {
    const shown = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== "none";
    return { hint: document.getElementById("g-hint").innerText, end: document.getElementById("g-endturn").innerText.replace(/\s+/g, " "),
      keys: [...document.querySelectorAll("#g-skills .sk .key")].filter(shown).map(k => k.textContent), summon: (document.querySelector("#g-summon:not([hidden]) small") || {}).textContent || "",
      menuKbd: shown(document.querySelector("#g-paper .olp-menu-b kbd")) };
  });
  assert.doesNotMatch(look.hint, KEYS, "默认提示：" + look.hint);
  assert.match(look.hint, /点头像换人.*点「结束单位行动」结束/, "写点哪里：" + look.hint);
  assert.doesNotMatch(look.end, /空格/, "开始 / 结束按钮：" + look.end);
  assert.deepEqual(look.keys, [], "技能按钮上不画数字键");
  assert.ok(look.summon && !/Q/.test(look.summon), "唤出的小字不写 Q：" + look.summon);
  assert.equal(look.menuKbd, false, "「菜单」不写 Esc");
  // 暂停页面的「继续」也不写 Esc（「继续」就是关菜单的按钮）
  await page.tap(MENU);
  await page.waitForSelector("#pm-overlay", { state: "visible" });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#pm-overlay .pm-resume kbd")).display), "none");
  await page.tap("#pm-overlay [data-pause-resume]");
  await page.waitForSelector("#pm-overlay", { state: "hidden" });
  assert.deepEqual(o.errors, []);
});

test("#429 触屏（只用点按）：选目标时按钮条上有「放弃」（不写 Esc），点了取消技能；点了不用选目标的技能先预演时有「取消」，点了收起；唤出武器人点两下放得出去（以前第二下被当成点了别处，永远放不出去）；「结束单位行动」点了就结束；问答框（使用道具）的选项不带数字、Esc，点「取消」关掉", { timeout: 120000 }, async t => {
  const o = await hostPage(t); if (!o) return; const { page } = o;
  await toActing(page);
  await openDock(page);
  // 要选目标的技能（普通攻击）：按钮条上的「放弃」
  await page.tap('#g-skills .sk[data-skill="ruby_aa"]');
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  await page.waitForSelector("#g-pick-bar.show .g-btn.danger", { state: "visible" });
  assert.deepEqual(await shownText(page, "#g-pick-bar .g-btn"), ["放弃"]);
  assert.doesNotMatch(await page.evaluate(() => document.getElementById("g-hint").innerText), KEYS, "选目标时的提示");
  await page.tap("#g-pick-bar .g-btn.danger");
  await page.waitForFunction(() => !GAME.arm);
  // 唤出武器人（不用选目标）：第一下预演，按钮条上的「取消」收起
  await page.waitForFunction(() => !document.querySelector("#g-app > .g-hud").classList.contains("dock-closed"));
  await page.tap("#g-summon");
  await page.waitForFunction(() => !!GAME.skillTap);
  assert.deepEqual(await shownText(page, "#g-pick-bar .g-btn"), ["取消"]);
  await page.tap("#g-pick-bar .g-btn");
  await page.waitForFunction(() => !GAME.skillTap && !document.querySelector("#g-pick-bar.show"));
  // 再来：点两下放出去
  const minte = () => page.evaluate(() => state.units.filter(u => u.weaponOf && !u.hidden && !u.fused).length);
  const before = await minte();
  await page.tap("#g-summon");
  await page.waitForFunction(() => !!GAME.skillTap);
  await page.tap("#g-summon");
  await page.waitForFunction(n => GAME.depth === 0 && !GAME.skillTap && state.units.filter(u => u.weaponOf && !u.hidden && !u.fused).length > n, before, { timeout: 15000 });
  assert.equal(await page.evaluate(() => !!document.querySelector("#g-pick-bar.show")), false, "「取消」那一条收起了");
  // 问答框：背包里放一个医疗包，点「使用道具」
  await page.evaluate(() => { bagAdd("medkit", 1); GAME.refresh(); });
  await page.waitForFunction(() => GAME.depth === 0 && !!document.querySelector('#g-skills .sk[data-skill="__item"]:not([disabled])'));
  await page.tap('#g-skills .sk[data-skill="__item"]');
  await page.waitForSelector("#g-choice.show", { state: "visible" });
  const choice = await page.evaluate(() => ({ keys: [...document.querySelectorAll("#g-choice .opts button .key")].map(k => getComputedStyle(k).display), btns: [...document.querySelectorAll("#g-choice .opts button")].map(b => b.innerText.replace(/\s+/g, " ").trim()) }));
  assert.ok(choice.keys.length >= 2 && choice.keys.every(d => d === "none"), "选项前的数字、Esc 不画：" + JSON.stringify(choice));
  assert.ok(choice.btns.every(b => !KEYS.test(b) && !/^\d/.test(b)), "选项上没有按键：" + JSON.stringify(choice.btns));
  await page.tap("#g-choice .opts button:last-child");
  await page.waitForSelector("#g-choice.show", { state: "detached" });
  // 「结束单位行动」：点了就结束这个人的行动（以前只有空格的说法）
  const cur = await page.evaluate(() => HotseatGame.getView().currentUnitId);
  await page.tap("#g-endturn");
  await page.waitForFunction(id => GAME.depth === 0 && HotseatGame.getView().currentUnitId !== id, cur, { timeout: 15000 });
  assert.deepEqual(o.errors, []);
});

/* ---------- 第 3 步：触屏时点按目标至少 40×40；吊牌上的名字至少两个字 ---------- */
/** 这一刻看得见的那几个按钮的大小：[[说明, 宽, 高]] */
const boxes = (page, sel) => page.evaluate(sel => [...document.querySelectorAll(sel)].filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden")
  .map(el => { const r = el.getBoundingClientRect(); return [(el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 12), Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; }), sel);
const tooSmall = list => list.filter(([, w, h]) => w < 39.5 || h < 39.5);

test("#429 触屏 412×915（只用点按）：点按目标都至少 40×40——镜头、「工具 ▾」「菜单」、吊牌上的 ⇅ 和点开的「延后 / 换位」、「技能 ▲」「队伍 ▶」、左边队伍的头像（收起 / 展开）、角色资料 / 武器工坊、技能、唤出、结束、选目标的按钮条", { timeout: 120000 }, async t => {
  const o = await hostPage(t); if (!o) return; const { page } = o;
  await toActing(page);
  const groups = {
    胶带: "#g-paper .olp-top :is(.olp-cam-cyc, [data-olp=tools], [data-pause-open])", "⇅": "#g-paper .olp-swap",
    收起按钮: "#g-app > .g-hud .hd2d-toggle", 队伍头像: "#g-app > .g-hud .hd2d-party .party > .pm"
  };
  for (const [k, sel] of Object.entries(groups)) {
    const list = await boxes(page, sel);
    assert.ok(list.length > 0, k + "：看得见");
    assert.deepEqual(tooSmall(list), [], k + " 至少 40×40：" + JSON.stringify(list));
  }
  assert.equal(await page.evaluate(() => document.querySelector("#g-app > .g-hud .hd2d-party").classList.contains("collapsed")), true, "手机上队伍默认收着（只剩头像一列）");
  // ⇅ 点开：「延后 / 换位」
  await page.tap("#g-paper .olp-tag.on [data-olp-swap]");
  await page.waitForSelector("#g-paper .olp-moves .olp-move", { state: "visible" });
  assert.deepEqual(tooSmall(await boxes(page, "#g-paper .olp-move")), [], "「延后 / 换位」至少 40 高、40 宽");
  await page.tap("#g-paper .olp-tag.on [data-olp-swap]");
  await page.waitForSelector("#g-paper .olp-moves", { state: "detached" });
  // 展开队伍：每一行、角色资料 / 武器工坊
  await page.tap("#g-app > .g-hud .hd2d-party-toggle");
  await page.waitForFunction(() => !document.querySelector("#g-app > .g-hud .hd2d-party").classList.contains("collapsed"));
  await settle(page);
  assert.deepEqual(tooSmall(await boxes(page, "#g-app > .g-hud .hd2d-party .party > :is(.pm, .pc-sheet)")), [], "展开的队伍");
  await page.tap("#g-app > .g-hud .hd2d-party-toggle");
  await page.waitForFunction(() => document.querySelector("#g-app > .g-hud .hd2d-party").classList.contains("collapsed"));
  // 技能栏：技能、唤出、结束；选目标的按钮条
  await openDock(page);
  assert.deepEqual(tooSmall(await boxes(page, "#g-app > .g-hud :is(.skills .sk, .summonbtn, .endturn)")), [], "技能栏");
  await page.tap('#g-skills .sk[data-skill="ruby_aa"]');
  await page.waitForSelector("#g-pick-bar.show .g-btn", { state: "visible" });
  assert.deepEqual(tooSmall(await boxes(page, "#g-pick-bar .g-btn")), [], "选目标的按钮条");
  await page.tap("#g-pick-bar .g-btn.danger");
  await page.waitForFunction(() => !GAME.arm);
  await shot(page, "429-phone-targets");
  assert.deepEqual(o.errors, []);
});

test("#429 触屏 412×915：行动顺序吊牌上的名字至少留两个字（以前挤成「瑞.」「结.」）；放不下就横着滑，轮到的那一张在屏幕里，点开 ⇅ 的那一张滑进来", { timeout: 120000 }, async t => {
  const o = await hostPage(t); if (!o) return; const { page } = o;
  await toActing(page);
  const names = () => page.evaluate(() => [...document.querySelectorAll("#g-paper .olp-tag-nm b")].map(b => {
    const fs = parseFloat(getComputedStyle(b).fontSize);
    return { name: b.textContent, w: b.clientWidth, two: b.clientWidth >= 2 * fs - 1, full: b.scrollWidth <= b.clientWidth + 0.5 };
  }));
  const list = await names();
  assert.ok(list.length >= 4, "四个人：" + JSON.stringify(list));
  assert.deepEqual(list.filter(n => !n.two), [], "每个名字至少两个字宽：" + JSON.stringify(list));
  assert.deepEqual(list.filter(n => [...n.name].length <= 2 && !n.full), [], "两个字以内的名字完整：" + JSON.stringify(list));
  // 放不下：横着滑；轮到的那一张在屏幕里
  const strip = await page.evaluate(() => { const s = document.querySelector("#g-paper .olp-tags"), on = s.querySelector(".olp-tag.on").getBoundingClientRect(); return { scroll: s.scrollWidth > s.clientWidth, overflowX: getComputedStyle(s).overflowX, onIn: on.left >= 0 && on.right <= innerWidth }; });
  assert.deepEqual(strip, { scroll: true, overflowX: "auto", onIn: true }, "横着滑、轮到的在屏幕里");
  // 最后一张（在屏幕外）：点它的 ⇅（滑进来再点），「延后 / 换位」在屏幕里
  await page.tap("#g-paper .olp-tag:last-child [data-olp-swap]");
  await page.waitForSelector("#g-paper .olp-tag:last-child .olp-move", { state: "visible" });
  await settle(page);
  const last = await page.evaluate(() => { const r = document.querySelector("#g-paper .olp-tag:last-child .olp-moves").getBoundingClientRect(); return { left: r.left, right: r.right, vw: innerWidth }; });
  assert.ok(last.left >= 0 && last.right <= last.vw, "点开的那一张在屏幕里：" + JSON.stringify(last));
  await shot(page, "429-phone-tags");
  assert.deepEqual(o.errors, []);
});

test("#429 电脑上照旧（1440×900、鼠标）：提示写「Tab 切换角色，空格结束回合」、按钮上有「空格」「· Q」、技能有数字键、选目标时是「放弃（Esc）」；按钮大小、胶带高度、吊牌不横着滑都和以前一样", { timeout: 120000 }, async t => {
  const o = await hostPage(t, DESK); if (!o) return; const { page } = o;
  await toActing(page);
  const d = await page.evaluate(() => {
    const shown = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== "none", r = sel => { const b = document.querySelector(sel).getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
    return { hint: document.getElementById("g-hint").innerText, end: document.getElementById("g-endturn").innerText.replace(/\s+/g, " "),
      keys: [...document.querySelectorAll("#g-skills .sk .key")].filter(shown).length, summon: (document.querySelector("#g-summon small") || {}).textContent || "",
      bar: getComputedStyle(document.body).getPropertyValue("--olp-bar").trim(), cam: r("#g-paper .olp-cam-b"), dockToggle: r("#g-app > .g-hud .hd2d-dock-toggle")[1],
      swap: r("#g-paper .olp-swap")[1], tags: getComputedStyle(document.querySelector("#g-paper .olp-tags")).overflowX };
  });
  assert.match(d.hint, /Tab 切换角色，空格结束回合/);
  assert.match(d.end, /空格/);
  assert.ok(d.keys >= 3, "技能有数字键：" + d.keys);
  assert.match(d.summon, /· Q$/);
  assert.deepEqual([d.bar, d.cam, d.tags], ["46px", [30, 32], "visible"]);
  assert.ok(d.dockToggle < 30 && d.swap < 30, "收起按钮、⇅ 照旧小：" + JSON.stringify(d));
  await page.click('#g-skills .sk[data-skill="ruby_aa"]');
  await page.waitForSelector("#g-pick-bar.show .g-btn.danger", { state: "visible" });
  assert.deepEqual(await shownText(page, "#g-pick-bar .g-btn"), ["放弃（Esc）"]);
  assert.deepEqual(o.errors, []);
});
