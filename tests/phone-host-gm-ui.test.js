// #429 第 4 步：安卓手机竖屏（412×915）当联机跑团主持人，战斗里主持人的专属操作只用点按逐个走通（要浏览器；不用浏览器的在 tests/phone-host.test.js）。
//   · 轮到这台机器出手时技能栏自己展开（照联机玩家 #311；以前单机 / 房主手机上技能栏一直收着，「结束单位行动」看不见），轮到玩家「甲」就收起
//   · 主持人的「检定申请 · N」挂在技能栏上面（以前贴在左下角，正好压住「技能 ▲」），点开批准并掷骰
//   · 战斗里打开主持人工具：敌人（加敌人）、单位、配置物、地形、天气、安排攻击六栏都点得到、做得成
//   · 敌人回合主持人手动操控敌人：选技能、选目标、执行，结束敌人回合
//   · 发大字；结算以后回到探索；探索里开工匠、开店
//   · 电脑上照旧：技能栏不跟着轮次收起 / 展开，「检定申请 · N」照旧贴在左下角
// 页面同 tests/phone-host-ui.test.js：真的 game.html 当联机房主（假的转发连接、房间里还有一名玩家「甲」p-1），新画面换成不画 WebGL 的假场景。
// 手机用 Playwright 的移动端模拟（412×915、isMobile、hasTouch），只用点按（page.tap；下拉框用 selectOption、输入框用 fill，和手机上点开选一样）；
// 没装 Playwright 时在 Linux 上用机器自带的 Chrome（tests/cdp-browser.js），都没有就跳过。
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

const PHONE = { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true };
const DESK = { viewport: { width: 1440, height: 900 } };
const HD2D_SCRIPTS = ["hd2d/hd2d-layout.js", "hd2d/hd2d-camera.js", "hd2d/hd2d-fx.js", "hd2d/hd2d-ui.js", "hd2d/hd2d-shell.js"];
const settle = page => page.waitForTimeout(150);

/**
 * 联机房主的 game.html（同 tests/phone-host-ui.test.js · hostPage）：假的转发连接、开好跑团房间、开始游戏、进战斗（不开打），打开新画面（假场景）——纸片画面。
 * o = { ctx 视口（默认 412×915 的安卓手机）, mate 头一名英雄归玩家「甲」（开打之前分好，别的归主持人） }
 */
async function hostPage(t, o) {
  o = o || {};
  if (!browser) { t.skip(skipWhy); return null; }
  const context = await browser.newContext(o.ctx || PHONE);
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.accept());
  await page.goto(origin + "/game.html");
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
    window.__last = id => { const hit = relay.sent.filter(x => x.to === id && ["result", "resync"].includes(x.value.type)).pop(); return hit ? hit.value : null; };
    let no = 0;
    window.__fromPlayer = (id, command) => relay.onMessage({ type: "cmd", requestId: ++no, command, protocol: OnlineGame.PROTOCOL, build: OnlineGame.BUILD }, id);
  });
  await page.evaluate(async () => { await OnlineGame.create({ url: "fake://relay", name: "主持人", slot: 0, campaignName: "#429" }); OnlineGame.start(); });
  await page.waitForFunction(() => OnlineGame.getView().screen === "exploration" && !OnlineGame.isPaused());
  await page.evaluate(() => { TrpgFlow.toBattle(); GAME.fast = true; });
  await page.waitForFunction(() => Screens.is("battle") && !state.combatStarted);
  await page.evaluate(() => { const intro = document.querySelector("#g-intro"); if (intro) intro.click(); });
  await page.waitForFunction(() => !document.querySelector("#g-intro"));
  if (o.mate) await page.evaluate(() => { const h = HotseatGame.getView().heroes[0]; OnlineGame.assign({ [h.id]: "p-1" }); });
  for (const f of HD2D_SCRIPTS) await page.addScriptTag({ path: file(f) });
  await page.evaluate(() => {
    window.HD2DWfx = { windOf: () => ({ x: 1, z: 0 }), create: () => ({ sync() {}, dispose() {} }) };
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
  await settle(page);
  return { page, errors, context };
}

const MENU = "#g-paper .olp-top [data-pause-open]", TOOLS = '#g-paper .olp-top [data-olp="tools"]';
const HUD = "#g-app > .g-hud", DOCK_TOGGLE = "#g-app > .g-hud .hd2d-dock-toggle";
/** 元素这一刻在不在屏幕里、点下去是不是点到它（没被盖住）：{ box, inside, hit } */
const reach = (page, sel) => page.evaluate(sel => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, at = document.elementFromPoint(x, y);
  return { box: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], vw: innerWidth, vh: innerHeight,
    inside: r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    hit: !!at && (at === el || el.contains(at)) };
}, sel);
const dockClosed = page => page.evaluate(sel => document.querySelector(sel).classList.contains("dock-closed"), HUD);
/** 这一刻轮到谁：{ phase, id 轮到的单位, mate 归玩家「甲」, depth } */
const turn = page => page.evaluate(() => {
  const v = HotseatGame.getView(), id = v.currentUnitId, row = (v.heroes || []).find(h => h.id === id) || (v.units || []).find(h => h.id === id) || {};
  return { phase: v.phase, id, mate: row.owner === "p-1", depth: GAME.depth, combat: state.combatPhase };
});
/** 只用点按开打：「工具 ▾」→「开始战斗」，行动顺序那一页点「按当前格子开始」，进我方行动 */
async function startByTap(page) {
  await page.tap(TOOLS);
  await page.waitForSelector("#g-app > .g-top.gp-open #g-start", { state: "visible" });
  await page.tap("#g-app > .g-top.gp-open #g-start");
  await page.waitForFunction(() => state.combatStarted && HotseatGame.getView().phase === "picking" && GAME.depth === 0, null, { timeout: 15000 });
  await orderByTap(page);
}
/** 行动顺序：主持人点「按当前格子开始」 */
async function orderByTap(page) {
  await page.waitForSelector('#hs-panel [data-hs="forceStart"]', { state: "visible", timeout: 15000 });
  await page.tap('#hs-panel [data-hs="forceStart"]');
  await page.waitForFunction(() => HotseatGame.getView().phase === "acting" && GAME.depth === 0, null, { timeout: 15000 });
  await settle(page);
}
/** 结束这一个单位的行动：归「甲」的由甲发来，归主持人的点「结束单位行动」（技能栏自己展开着才点得到）；等轮到下一个人、演出播完 */
async function endOne(page) {
  const now = await turn(page);
  if (now.mate) await page.evaluate(() => __fromPlayer("p-1", { type: "endTurn" }));
  else await page.tap("#g-endturn");
  // 最后一个人结束：敌人回合开始（主持人手动操控敌人时演出一直挂着，不等它）
  await page.waitForFunction(id => state.combatPhase !== "player" || GAME.depth === 0 && HotseatGame.getView().currentUnitId !== id, now.id, { timeout: 15000 });
  await settle(page);
}
/** 只用点按打开主持人工具：「菜单」→ 暂停页面里的「主持人工具」 */
async function openGM(page) {
  await page.tap(MENU);
  await page.waitForSelector("#pm-overlay", { state: "visible" });
  await page.tap('#pm-overlay [data-pause-item="gmTools"]');
  await page.waitForSelector("#ogm-panel", { state: "visible" });
}
async function closeGM(page) {
  await page.tap('#ogm-panel [data-action="close"]');
  await page.waitForSelector("#ogm-panel", { state: "detached" });
}
/** 主持人工具里点一个按钮（滚进来再点），等它做完：面板上写「已执行。」；closes = 这一下面板自己收起（执行敌人技能、安排攻击：让玩家的询问弹出来），等它收起 */
async function gmDo(page, sel, why, closes) {
  const box = await page.evaluate(sel => { const el = document.querySelector(sel); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, w: r.width, h: r.height, vw: innerWidth }; }, sel);
  assert.ok(box && box.left >= 0 && box.right <= box.vw, why + "：按钮在屏幕里：" + JSON.stringify(box));
  await page.tap(sel);
  if (closes) { await page.waitForSelector("#ogm-panel", { state: "detached", timeout: 15000 }); return; }
  await page.waitForFunction(() => { const n = document.getElementById("ogm-notice"); return !!n && !n.hidden && n.textContent !== "正在执行…"; }, null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => document.getElementById("ogm-notice").textContent), "已执行。", why);
}
/** 执行敌人技能 / 安排攻击以后（面板收起了）：有询问就点「不协助」，等演出播完（GAME.depth 回到 depth），再从「菜单」进主持人工具，面板上写着「已执行。」 */
async function afterClose(page, why, depth) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    await declineAsks(page);
    if (await page.evaluate(d => GAME.depth <= d && !HotseatGame.hasAsk(), depth)) break;
    await page.waitForTimeout(100);
  }
  await openGM(page);
  await page.waitForFunction(() => { const n = document.getElementById("ogm-notice"); return !!n && !n.hidden && n.textContent !== "正在执行…"; }, null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => document.getElementById("ogm-notice").textContent), "已执行。", why);
}
/** 协助格挡 / 协助攻击的询问（归主持人的英雄）：点「不协助」 */
async function declineAsks(page) {
  for (let i = 0; i < 6; i++) {
    const ask = await page.evaluate(() => { const b = document.querySelector('#hs-reaction:not([hidden]) [data-hs="decline"]'); return !!b && b.getClientRects().length > 0; });
    if (!ask) return;
    await page.tap('#hs-reaction [data-hs="decline"]');
    await settle(page);
  }
}

/* ---------- 技能栏：轮到这台机器出手时自己展开 ---------- */
test("#429 手机竖屏 412×915 的主持人：轮到主持人的英雄时技能栏自己展开（以前一直收着，「结束单位行动」看不见），点得到「结束单位行动」；轮到玩家「甲」就收起；手动点过「技能 ▼ / ▲」的照手动", { timeout: 120000 }, async t => {
  const o = await hostPage(t, { mate: true }); if (!o) return; const { page } = o;
  assert.equal(await dockClosed(page), true, "开战前：手机上技能栏收着");
  await startByTap(page);
  const seen = { mine: 0, mate: 0 };
  for (let i = 0; i < 8 && (seen.mine < 2 || seen.mate < 1); i++) {
    const now = await turn(page);
    if (now.phase !== "acting") break;
    if (now.mate) {
      assert.equal(await dockClosed(page), true, "轮到玩家「甲」：技能栏收起，让出战场");
      seen.mate++;
    } else {
      await page.waitForFunction(sel => !document.querySelector(sel).classList.contains("dock-closed"), HUD);
      const end = await reach(page, "#g-endturn");
      assert.ok(end && end.inside && end.hit, "轮到主持人的英雄：技能栏展开，「结束单位行动」在屏幕里、点得到：" + JSON.stringify(end));
      assert.match(await page.locator("#g-endturn").innerText(), /结束单位行动/);
      assert.equal(await page.locator("#g-endturn").isDisabled(), false, "「结束单位行动」没灰着" + (i ? "（甲结束以后轮到主持人也是）" : ""));
      seen.mine++;
    }
    await endOne(page);
  }
  assert.ok(seen.mine >= 2 && seen.mate >= 1, "主持人的、甲的都轮到过：" + JSON.stringify(seen));
  assert.deepEqual(o.errors, []);
});

test("#429 手机竖屏：手动点过「技能 ▼ / ▲」以后照手动的（记在本机），不再跟着轮次自己收起 / 展开", { timeout: 120000 }, async t => {
  const o = await hostPage(t); if (!o) return; const { page } = o;
  await startByTap(page);
  await page.waitForFunction(sel => !document.querySelector(sel).classList.contains("dock-closed"), HUD);
  await page.tap(DOCK_TOGGLE);
  await page.waitForFunction(sel => document.querySelector(sel).classList.contains("dock-closed"), HUD);
  assert.equal(await page.evaluate(() => localStorage.getItem("backfire-hd2d-dock")), "closed", "记在本机");
  // 换一个人（英雄都归主持人）：还是收着
  const id = (await turn(page)).id;
  await page.evaluate(() => GAME.endTurn());
  await page.waitForFunction(id => GAME.depth === 0 && HotseatGame.getView().currentUnitId !== id, id, { timeout: 15000 });
  await settle(page);
  assert.equal(await dockClosed(page), true, "手动收起的：轮到下一个人也不自己展开");
  assert.deepEqual(o.errors, []);
});

/* ---------- 「检定申请 · N」挂在技能栏上面 ---------- */
/** 「检定申请 · N」和技能栏不重叠、在屏幕里点得到；「技能 ▲ / ▼」没被它盖住 */
async function pillClear(page, why) {
  const m = await page.evaluate(sel => {
    const p = document.querySelector(".crq-pill").getBoundingClientRect(), d = document.querySelector(sel).getBoundingClientRect();
    return { pill: [Math.round(p.left), Math.round(p.top), Math.round(p.right), Math.round(p.bottom)], dock: [Math.round(d.left), Math.round(d.top), Math.round(d.right), Math.round(d.bottom)],
      overlap: p.left < d.right && p.right > d.left && p.top < d.bottom && p.bottom > d.top };
  }, HUD);
  assert.equal(m.overlap, false, why + "：「检定申请 · N」不压在技能栏上：" + JSON.stringify(m));
  const pill = await reach(page, ".crq-pill"), toggle = await reach(page, DOCK_TOGGLE);
  assert.ok(pill && pill.inside && pill.hit, why + "：「检定申请 · N」在屏幕里、点得到：" + JSON.stringify(pill));
  assert.ok(toggle && toggle.inside && toggle.hit, why + "：「技能 ▲ / ▼」没被盖住：" + JSON.stringify(toggle));
}
test("#429 手机竖屏：玩家「甲」申请检定，主持人的「检定申请 · 1」挂在技能栏上面（以前贴在左下角，压住「技能 ▲」），技能栏收着、展开时都不压；点开选难度、批准并掷骰，处理完它就收起", { timeout: 120000 }, async t => {
  const o = await hostPage(t, { mate: true }); if (!o) return; const { page } = o;
  await startByTap(page);
  const mate = await page.evaluate(() => HotseatGame.getView().heroes[0].id);
  await page.evaluate(id => __fromPlayer("p-1", { type: "checkRequest", unitId: id, prof: "侦察", note: "看看门后" }), mate);
  await page.waitForSelector(".crq-pill", { state: "visible" });
  assert.equal(await page.locator(".crq-pill").innerText(), "检定申请 · 1");
  // 技能栏收着（轮到甲）和展开（轮到主持人）各看一次
  const states = new Set();
  for (let i = 0; i < 8 && states.size < 2; i++) {
    const closed = await dockClosed(page);
    if (!states.has(closed)) { await pillClear(page, closed ? "技能栏收着" : "技能栏展开"); states.add(closed); }
    if (states.size < 2) await endOne(page);
  }
  assert.equal(states.size, 2, "技能栏收着、展开都看过");
  // 点开：选难度、批准并掷骰
  await page.tap(".crq-pill");
  await page.waitForSelector("#online-check-req", { state: "visible" });
  const req = await page.evaluate(() => OnlineGame.getView().packet.view.checkRequests.find(r => r.status === "pending").id);
  await page.selectOption(`#online-check-req [data-crq-diff="${req}"]`, "hard");
  await page.tap(`#online-check-req [data-req-id="${req}"] [data-crq="approve"]`);
  await page.waitForFunction(id => (OnlineGame.getView().packet.view.checkRequests.find(r => r.id === id) || {}).status === "approved", req, { timeout: 15000 });
  await page.waitForSelector(".crq-pill", { state: "hidden" });
  await page.tap('#online-check-req [data-crq="close"]');
  await page.waitForSelector("#online-check-req", { state: "hidden" });
  assert.deepEqual(o.errors, []);
});

/* ---------- 战斗里的主持人工具六栏 ---------- */
test("#429 手机竖屏（只用点按）：战斗里打开主持人工具，敌人（加敌人）、单位（回满架势）、配置物（添加）、地形（应用）、天气（换成雪天）、安排攻击（打一下敌人）六栏都点得到、做得成，面板不出屏幕", { timeout: 120000 }, async t => {
  const o = await hostPage(t); if (!o) return; const { page } = o;
  await startByTap(page);
  await openGM(page);
  const tab = async k => {
    await page.tap(`#ogm-panel [data-tab="${k}"]`);
    await page.waitForFunction(k => { const b = document.querySelector(`#ogm-panel [data-tab="${k}"]`); return !!b && b.getAttribute("aria-pressed") === "true"; }, k);
    const p = await page.evaluate(() => { const r = document.getElementById("ogm-panel").getBoundingClientRect(); return { left: r.left, right: r.right, vw: innerWidth, side: document.documentElement.scrollWidth }; });
    assert.ok(p.left >= 0 && p.right <= p.vw + 0.5 && p.side <= p.vw, k + "：面板在屏幕里、页面不横向溢出：" + JSON.stringify(p));
  };
  const count = () => page.evaluate(() => ({ foes: state.units.filter(u => !u.isPlayer && !u.dead && !u.hidden && !u._removed).length, props: (state.props || []).length }));
  const before = await count();
  await tab("enemies");
  await gmDo(page, '#ogm-panel [data-action="spawn"]', "加敌人");
  await page.waitForFunction(n => state.units.filter(u => !u.isPlayer && !u.dead && !u.hidden && !u._removed).length > n, before.foes, { timeout: 15000 });
  await tab("units");
  await gmDo(page, '#ogm-panel [data-action="full-def"]', "单位：回满架势");
  await tab("props");
  await gmDo(page, '#ogm-panel [data-action="add-prop"]', "添加配置物");
  await page.waitForFunction(n => (state.props || []).length > n, before.props, { timeout: 15000 });
  await tab("field");
  await gmDo(page, '#ogm-panel [data-action="edit-gap"]', "地形");
  await tab("weather");
  await page.selectOption("#ogm-weather", "snow");
  await gmDo(page, '#ogm-panel [data-action="edit-weather"]', "天气");
  await page.waitForFunction(() => state.weather === "snow", null, { timeout: 15000 });
  await tab("attack");
  const foe = await page.evaluate(() => state.units.find(u => !u.isPlayer && !u.dead && !u.hidden && !u._removed && !u.isProp).id);
  await page.selectOption("#ogm-attack-target", foe);
  await page.fill("#ogm-attack-flat", "5");
  await page.tap("#ogm-attack-skip");
  const hp = () => page.evaluate(id => { const u = state.units.find(u => u.id === id); return u.layers.map(l => l.current).join("/") + "|" + u.def; }, foe);
  const hp0 = await hp();
  await gmDo(page, '#ogm-panel [data-action="force-attack"]', "安排攻击", true);
  await afterClose(page, "安排攻击", 0);
  assert.notEqual(await hp(), hp0, "敌人挨了这一下");
  await closeGM(page);
  assert.deepEqual(o.errors, []);
});

/* ---------- 敌人回合主持人手动操控敌人 ---------- */
test("#429 手机竖屏（只用点按）：敌人全部手动 → 主持人的英雄点「结束单位行动」结束 → 敌人回合「菜单」上写「敌人待操作」，进主持人工具选技能、选目标、执行，再点「结束敌人回合」，回到我方回合技能栏又自己展开", { timeout: 150000 }, async t => {
  const o = await hostPage(t); if (!o) return; const { page } = o;
  await startByTap(page);
  // 双方挤在同一区：手动的敌人一定打得着（摆位置不是这里要测的）
  await page.evaluate(() => { state.units.forEach(u => { u.zone = 1; }); GAME.refresh(); });
  await openGM(page);
  await gmDo(page, '#ogm-panel [data-action="manual-all-on"]', "全部手动");
  await closeGM(page);
  for (let i = 0; i < 10 && (await turn(page)).combat === "player"; i++) {
    if ((await turn(page)).phase !== "acting") break;
    await endOne(page);
  }
  await page.waitForFunction(() => OnlineGame.getView().manualPhase === true, null, { timeout: 20000 });
  await settle(page);
  // 「菜单」→ 暂停页面里写着「敌人待操作 · 主持人工具」
  await page.tap(MENU);
  await page.waitForSelector("#pm-overlay", { state: "visible" });
  assert.match(await page.locator('#pm-overlay [data-pause-item="gmTools"]').innerText(), /敌人待操作/);
  await page.tap('#pm-overlay [data-pause-item="gmTools"]');
  await page.waitForSelector("#ogm-panel", { state: "visible" });
  const pick = await page.evaluate(() => {
    const actor = document.getElementById("ogm-manual-actor").value, skills = [...document.querySelectorAll("#ogm-skill option")].map(x => x.value);
    return { actor, skills, ap: state.units.find(u => u.id === actor).ap };
  });
  assert.ok(pick.actor && pick.skills.length, "有手动敌人、有技能：" + JSON.stringify(pick));
  // 要选目标的技能：目标选第一个我方英雄
  const skill = await page.evaluate(() => { for (const o of document.querySelectorAll("#ogm-skill option")) { if (/攻击/.test(o.textContent)) return o.value; } return document.querySelector("#ogm-skill option").value; });
  await page.selectOption("#ogm-skill", skill);
  await page.waitForFunction(s => document.getElementById("ogm-skill") && document.getElementById("ogm-skill").value === s, skill);
  if (await page.evaluate(() => !!document.getElementById("ogm-target"))) {
    const hero = await page.evaluate(() => [...document.querySelectorAll("#ogm-target option")].map(x => x.value).find(Boolean));
    await page.selectOption("#ogm-target", hero);
  }
  await gmDo(page, '#ogm-panel [data-action="enemy-skill"]', "执行敌人技能", true);
  // 面板执行完收起了（让玩家的询问弹出来）：再从「菜单」进，写着「已执行。」
  await afterClose(page, "执行敌人技能", 1);
  assert.ok(await page.evaluate(([id, ap]) => (state.units.find(u => u.id === id) || {}).ap < ap, [pick.actor, pick.ap]), "手动的敌人用掉了行动点");
  await gmDo(page, '#ogm-panel [data-action="enemy-end"]', "结束敌人回合");
  await page.waitForFunction(() => OnlineGame.getView().manualPhase === false, null, { timeout: 20000 });
  if (await page.evaluate(() => !!document.getElementById("ogm-panel"))) await closeGM(page);
  await page.waitForFunction(() => state.combatPhase === "player" && HotseatGame.getView().phase === "picking" && GAME.depth === 0, null, { timeout: 30000 });
  await orderByTap(page);
  assert.match(await page.locator("#g-paper .olp-top").innerText(), /第 2 回合/);
  await page.waitForFunction(sel => !document.querySelector(sel).classList.contains("dock-closed"), HUD);
  const end = await reach(page, "#g-endturn");
  assert.ok(end && end.inside && end.hit, "第 2 回合轮到主持人：技能栏又自己展开：" + JSON.stringify(end));
  assert.deepEqual(o.errors, []);
});

/* ---------- 发大字、结算回到探索、探索里开工匠 / 开店 ---------- */
test("#429 手机竖屏（只用点按）：战斗里拉开战斗记录抽屉 →「小队」→ 📢 发大字（玩家「甲」收到）；主持人工具里把敌人都击杀 → 结算面板「回到探索环节」点得到、回到探索；探索里开工匠、给商人开店", { timeout: 150000 }, async t => {
  const o = await hostPage(t); if (!o) return; const { page } = o;
  await startByTap(page);
  // 发大字：抽屉在右边缘的竖标签，拉开盖满屏幕
  await page.tap("#g-log > .gp-drawer-tab");
  await page.waitForSelector("#g-log.gp-drawer:not(.gp-collapsed)", { state: "visible" });
  await page.tap('#g-log [data-host-tab="chat"]');
  await page.tap("#g-log [data-title-open]");
  await page.waitForSelector("#online-title-form", { state: "visible" });
  await page.fill('#online-title-form [data-tf="text"]', "援军来了");
  await page.tap('#online-title-form [data-title="go"]');
  await page.waitForSelector("#online-title-form", { state: "hidden" });
  await page.waitForFunction(() => { const p = __last("p-1"); return !!p && !!p.view && !!p.view.title && /援军来了/.test(JSON.stringify(p.view.title)); }, null, { timeout: 15000 });
  // 还在「小队」那一页：「收起 ▸」照样在（以前切到小队它就藏起来了，抽屉盖满屏幕收不回去）
  const fold = await reach(page, "#g-log > .gp-drawer-tab");
  assert.ok(fold && fold.inside && fold.hit, "小队那一页也有「收起 ▸」：" + JSON.stringify(fold));
  await page.tap("#g-log > .gp-drawer-tab");
  await page.waitForSelector("#g-log.gp-drawer.gp-collapsed", { state: "attached" });
  // 结算：主持人工具里一个个击杀
  await openGM(page);
  for (let i = 0; i < 12; i++) {
    const has = await page.evaluate(() => !!document.querySelector('#ogm-panel [data-action="kill-enemy"]') && !GAME.ended);
    if (!has) break;
    await gmDo(page, '#ogm-panel [data-action="kill-enemy"]', "击杀");
    await page.waitForFunction(() => GAME.depth === 0 || GAME.ended, null, { timeout: 15000 });
  }
  await page.waitForFunction(() => GAME.ended, null, { timeout: 20000 });
  if (await page.evaluate(() => !!document.getElementById("ogm-panel"))) await closeGM(page);
  await page.waitForSelector("#g-result.show #g-explore-back", { state: "visible", timeout: 20000 });
  const back = await reach(page, "#g-explore-back");
  assert.ok(back && back.inside && back.hit, "结算面板的「回到探索环节」在屏幕里、点得到：" + JSON.stringify(back));
  await page.tap("#g-explore-back");
  await page.waitForFunction(() => Screens.is("trpg") && OnlineGame.getView().screen === "exploration", null, { timeout: 20000 });
  await page.waitForFunction(() => { const p = __last("p-1"); return !!p && p.screen === "exploration"; }, null, { timeout: 15000 });
  // 探索：开工匠（武器升级那一页）、给商人开店
  await page.tap('#tr-tabs [data-tab="smith"]');
  await page.waitForSelector("#tr-smith-open", { state: "attached" });
  await page.tap("#tr-smith-open");
  await page.waitForFunction(() => TRPG.smithOpen === true, null, { timeout: 10000 });
  await page.tap('#tr-tabs [data-tab="merchants"]');
  if (!(await page.evaluate(() => !!document.querySelector('[data-mc^="open:"]')))) {
    await page.fill("#mc-name", "老王");
    await page.tap('[data-mc="new:"]');
    await page.waitForSelector('[data-mc^="open:"]', { state: "attached" });
  }
  await page.tap('[data-mc^="open:"]');
  await page.waitForSelector('[data-mc="close:"]', { state: "attached", timeout: 10000 });
  const side = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: innerWidth }));
  assert.ok(side.doc <= side.vw, "探索画面不横向溢出：" + JSON.stringify(side));
  assert.deepEqual(o.errors, []);
});

/* ---------- 电脑上照旧 ---------- */
test("#429 电脑上照旧（1440×900、鼠标）：技能栏照旧开着，轮到玩家「甲」也不收；「检定申请 · N」照旧贴在左下角", { timeout: 120000 }, async t => {
  const o = await hostPage(t, { ctx: DESK, mate: true }); if (!o) return; const { page } = o;
  assert.equal(await dockClosed(page), false, "电脑上技能栏默认开着");
  await page.evaluate(() => GAME.startOrEnd());
  await page.waitForFunction(() => state.combatStarted && HotseatGame.getView().phase === "picking" && GAME.depth === 0, null, { timeout: 15000 });
  await page.evaluate(() => OnlineGame.submit({ type: "orderStart" }));
  await page.waitForFunction(() => HotseatGame.getView().phase === "acting" && GAME.depth === 0, null, { timeout: 15000 });
  for (let i = 0; i < 8 && !(await turn(page)).mate; i++) {
    const id = (await turn(page)).id;
    await page.evaluate(() => GAME.endTurn());
    await page.waitForFunction(id => GAME.depth === 0 && HotseatGame.getView().currentUnitId !== id, id, { timeout: 15000 });
  }
  assert.equal((await turn(page)).mate, true, "轮到甲");
  await settle(page);
  assert.equal(await dockClosed(page), false, "轮到甲：电脑上不收");
  const mate = await page.evaluate(() => HotseatGame.getView().heroes[0].id);
  await page.evaluate(id => __fromPlayer("p-1", { type: "checkRequest", unitId: id, prof: "侦察", note: "" }), mate);
  await page.waitForSelector(".crq-pill", { state: "visible" });
  const pill = await page.evaluate(() => { const r = document.querySelector(".crq-pill").getBoundingClientRect(); return { left: r.left, bottom: innerHeight - r.bottom }; });
  assert.deepEqual([Math.round(pill.left), Math.round(pill.bottom)], [12, 12], "照旧贴在左下角：" + JSON.stringify(pill));
  assert.deepEqual(o.errors, []);
});
