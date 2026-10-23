// 单机战斗画面的「纸片风」界面（#339，game-paper.js / game-paper.css；和联机玩家同一套 paper-ui.js / online-paper.css）——要浏览器的那部分：
//   · 单机开着新画面时是新排版（战场铺满、顶上一条胶带、吊牌、左上角队伍、底下技能栏、右边缘的战斗记录竖标签），关着新画面一点不变
//   · 旧顶栏的每一个按钮、下拉框、链接在「工具 ▾」里都有（同一个元素、同一个处理），按模式藏的照旧藏；纸片画面开 / 关来回切不丢按钮、不留痕迹
//   · 胶带上的「菜单」打开暂停页面；抽屉收起 / 展开记在本机；新加的 DOM 里没有坚毅生命的数字
// 用 Playwright；没装 Playwright 时在 Linux 上用机器自带的 Chrome（tests/cdp-browser.js），都没有就跳过。
// 页面是真的 game.html（新画面在页面加载时记着「关」：不去加载真的 3D），开战以后用真的 hd2d/hd2d-field.js 建新画面，
// 只是场景换成一个不画 WebGL 的假场景（布局、取景、镜头按钮照真的走：hd2d-layout.js / hd2d-camera.js 是真的）。
// 环境变量 PAPER_SHOTS=目录：顺手把几张画面截图存下来（给人看，不参与判断）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const file = f => path.join(ROOT, f);
const SHP = 7771, SHP_MAX = 7772;

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

async function shot(page, name) {
  const dir = process.env.PAPER_SHOTS;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.evaluate(() => document.fonts && document.fonts.ready.then(() => 0));
  await page.screenshot({ path: path.join(dir, name + ".png") });
}

/** 新画面要的普通脚本（真的那几个；场景包 hd2d-scene.bundle.js 换成下面的假场景） */
const HD2D_SCRIPTS = ["hd2d/hd2d-layout.js", "hd2d/hd2d-camera.js", "hd2d/hd2d-fx.js", "hd2d/hd2d-ui.js", "hd2d/hd2d-shell.js"];

/**
 * 单机的战斗画面：真的 game.html，开一场自定义战斗（瑞比、结人、绯秋、柯尔特 vs 三个狂徒），新画面的场景是假的（记下布局：window.__scene.layout）。
 * opt.on = false：新画面不打开（旧画面）；opt.context：视口；opt.shp：故意给我方塞坚毅生命（新加的 DOM 里不该出现）
 */
async function soloPage(t, opt) {
  opt = opt || {};
  if (!browser) { t.skip(skipWhy); return null; }
  const context = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 } }, opt.context || {}));
  await require("./old-screen")(context);   // 页面加载时新画面记着「关」：不去加载真的 3D（下面换成假场景再打开）
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(pathToFileURL(file("game.html")).href);
  await page.waitForFunction(() => !!window.GAME && !!window.HD2DField && !!window.GamePaper && !!window.PauseMenu);
  for (const f of HD2D_SCRIPTS) await page.addScriptTag({ path: file(f) });
  await page.evaluate(([shp, shpMax]) => {
    window.__noLevelUpPopup = true;
    window.HD2DWfx = { windOf: () => ({ x: 1, z: 0 }), create: () => ({ sync() {}, dispose() {} }) };   // 天气的 2D 层要真的 3D
    // 假场景：hd2d-field.js 交给它的东西都记下来；镜头按钮照真的那样报「远景」，点了换段
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
    Screens.show("battle");
    GAME.startCustomBattle("纸片测试", () => {
      BattleSim.setup({ party: ["ruby", "yuito", "hiaki", "kolt"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }, { id: "thug_hammer", lv: 3, zone: 2 }, { id: "thug_knife", lv: 3, zone: 1 }], seed: "PAPER", region: "第一采矿场" });
      if (shp) state.units.filter(u => u.isPlayer).forEach(u => { u.shp = shp; u.shpMax = shpMax; });
      return {};
    });
  }, opt.shp ? [SHP, SHP_MAX] : [0, 0]);
  if (opt.on !== false) await paperOn(page);
  return { page, errors, context };
}
/** 打开新画面（假场景），等纸片画面排好 */
async function paperOn(page) {
  await page.evaluate(() => { if (!HD2DField.on()) HD2DField.switchTo("new"); });
  await page.waitForFunction(() => document.body.classList.contains("g-paper") && !!document.querySelector("#g-paper .olp-top") && !!document.querySelector("#g-app > .g-hud.hd2d-shell"));
  await settle(page);
}
const settle = page => page.waitForTimeout(120);
const rect = (page, sel) => page.evaluate(sel => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, vw: innerWidth, vh: innerHeight }; }, sel);
const isPaper = page => page.evaluate(() => document.body.classList.contains("g-paper"));
/** 旧顶栏里看得见、能点的东西（按钮、下拉框、链接）；「菜单」（胶带上有自己的）、手机上的「记录」（抽屉的竖标签代替）不算 */
const oldControls = page => page.evaluate(() => [...document.querySelectorAll("#g-app > .g-top :is(button, select, a)")]
  .filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && !el.matches("[data-pause-open], #g-log-open"))
  .map(el => el.id || el.textContent.trim()));
const openTools = async page => { await page.click('#g-paper [data-olp="tools"]'); await page.waitForSelector("#g-app > .g-top.gp-open", { state: "visible" }); };

test("单机开着新画面：战场铺满；顶上一条写模式 · 遭遇 · 回合 · 我方 / 敌人行动 · 天气，右边镜头 / 工具 / 菜单；吊牌是我方每个人；队伍在左上角、技能栏在底下、战斗记录收成右边缘的竖标签；旧顶栏、右侧栏让开", { timeout: 90000 }, async t => {
  const o = await soloPage(t); if (!o) return; const { page } = o;
  // 战场铺满整个画面
  const field = await rect(page, "#g-field");
  assert.deepEqual([field.left, field.top, Math.round(field.width), Math.round(field.height)], [0, 0, field.vw, field.vh], "战场铺满");
  // 顶上一条：模式（自定义的战斗）· 遭遇 · 准备中 · 等待开始 · 天气；镜头远 / 中 / 近、工具、菜单
  const top = (await page.locator("#g-paper .olp-top").innerText()).replace(/\s+/g, " ");
  assert.match(top, /^战斗 纸片测试 准备中 等待开始 .*常态/, "顶栏：" + top);
  assert.equal(await page.locator("#g-paper .olp-cam-b").count(), 3, "镜头远 / 中 / 近");
  assert.ok(await page.isVisible('#g-paper [data-olp="tools"]'));
  assert.ok(await page.isVisible("#g-paper [data-pause-open]"), "菜单按钮");
  const bar = await rect(page, "#g-paper .olp-top");
  assert.ok(bar.top < 12 && bar.left < 20 && bar.right > bar.vw - 20, "顶上一条横贯：" + JSON.stringify(bar));
  // 旧顶栏、右侧栏（预演框）让开；旧顶栏的东西都在「工具 ▾」里（下面一条测试逐个对）
  assert.equal(await page.isVisible("#g-app > .g-top"), false, "旧顶栏平时藏着（变成了「工具 ▾」下拉）");
  assert.equal(await page.isVisible("#g-pvbox"), false, "预演框只在预演时浮出来");
  // 吊牌：我方每个人，挂在顶栏下面中间；选着的那个高亮
  const tags = await rect(page, "#g-paper .olp-tags");
  assert.ok(tags.top >= bar.bottom - 8 && tags.top < bar.bottom + 20 && Math.abs((tags.left + tags.right) / 2 - tags.vw / 2) < 4, "吊牌在顶栏下面中间：" + JSON.stringify(tags));
  assert.deepEqual(await page.locator("#g-paper .olp-tag .olp-tag-nm b").evaluateAll(els => els.map(e => e.textContent)), await page.evaluate(() => [...document.querySelectorAll("#g-party > .pc[data-id]")].map(b => state.units.find(u => u.id === b.dataset.id).name)));
  assert.equal(await page.locator("#g-paper .olp-tag.on").count(), 1, "选着的那个高亮");
  // 左上角队伍、底下技能栏、右边缘的竖标签
  const party = await rect(page, "#g-app .hd2d-party");
  assert.ok(party.left < 30 && party.top > bar.bottom && party.top < 160, "队伍在左上角：" + JSON.stringify(party));
  const dock = await rect(page, "#g-app > .g-hud");
  assert.ok(dock.bottom > dock.vh - 30 && Math.abs((dock.left + dock.right) / 2 - dock.vw / 2) < 4 && dock.width < dock.vw - 40, "技能栏浮在底下中间：" + JSON.stringify(dock));
  assert.ok(await page.isVisible("#g-skills .sk"), "技能照旧（同一个按钮）");
  const tab = await rect(page, "#g-log");
  assert.ok(tab.right >= tab.vw - 1 && tab.width <= 44, "战斗记录收成右边缘一个竖标签：" + JSON.stringify(tab));
  assert.match(await page.locator("#g-log .gp-drawer-tab").innerText(), /战斗记录/);
  // 点胶带上的「中」：点的就是新画面原来的镜头按钮
  await page.click('#g-paper [data-olp-cam="1"]');
  await page.waitForFunction(() => window.__scene.tier === "mid" && document.querySelector('#g-paper [data-olp-cam="1"]').classList.contains("on"));
  await shot(page, "solo-paper-open");
  assert.deepEqual(o.errors, []);
});

test("新画面关着：旧画面一点不变；纸片画面开 / 关来回切，旧顶栏、战斗记录栏和进来之前一模一样（按钮一个不少，不留类名 / 顺序 / id）", { timeout: 90000 }, async t => {
  const o = await soloPage(t, { on: false }); if (!o) return; const { page } = o;
  await settle(page);
  const look = () => page.evaluate(() => ({ top: document.querySelector("#g-app > .g-top").outerHTML, log: document.getElementById("g-log").outerHTML,
    body: document.body.className, app: document.getElementById("g-app").className, vars: document.body.getAttribute("style") || "", time: document.body.dataset.olpTime || "" }));
  const before = await look();
  assert.equal(await isPaper(page), false, "新画面关着：照旧");
  assert.doesNotMatch(before.body, /ol-paper|g-paper/);
  assert.equal(await page.isVisible("#g-paper"), false);
  assert.equal(await page.locator("#g-paper *").count(), 0, "纸片画面的东西一个都没画");
  assert.ok(await page.isVisible("#g-app > .g-top"), "旧顶栏照旧");
  const controls = await oldControls(page);
  assert.ok(controls.length >= 20, "旧顶栏的按钮：" + controls);
  // 开：纸片画面
  await paperOn(page);
  assert.equal(await isPaper(page), true);
  // 关（点「工具 ▾」里的新画面开关）：回到原样，一模一样
  await openTools(page);
  await page.click("#g-app > .g-top #g-hd2d-toggle");
  await page.waitForFunction(() => !document.body.classList.contains("g-paper") && !document.body.classList.contains("ol-paper"));
  await settle(page);
  const after = await look();
  assert.equal(after.top, before.top, "旧顶栏和进来之前一模一样");
  assert.equal(after.log, before.log, "战斗记录栏和进来之前一模一样");
  assert.deepEqual([after.body, after.vars, after.time], [before.body, before.vars, before.time], "body 上没留下类名、配色");
  assert.deepEqual(await oldControls(page), controls, "按钮一个不少");
  assert.equal(await page.locator("#g-paper *").count(), 0);
  // 再开：又是纸片画面
  await paperOn(page);
  assert.equal(await isPaper(page), true);
  assert.deepEqual(o.errors, []);
});

test("「工具 ▾」：旧顶栏的每一个按钮、下拉框、链接都在下拉里——看得见、点得到（同一个元素、同一个处理）；按模式藏的照旧藏（单局里没有「布置 · 主持人」那一组）；点完收起，点别处 / Esc 也收起（Esc 不开菜单）", { timeout: 90000 }, async t => {
  const o = await soloPage(t, { on: false }); if (!o) return; const { page } = o;
  await settle(page);
  const controls = await oldControls(page);
  await paperOn(page);
  assert.equal(await page.isVisible("#g-app > .g-top"), false, "下拉平时收着");
  await openTools(page);
  // 每一个都在下拉里、看得见、点得到（没被盖住）
  const where = await page.evaluate(ids => ids.map(id => {
    const el = document.getElementById(id) || [...document.querySelectorAll("#g-app > .g-top :is(button, select, a)")].find(x => x.textContent.trim() === id);
    if (!el) return [id, "找不到"];
    const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return [id, !el.closest("#g-paper-tools.gp-open") ? "不在下拉里" : !(r.width > 0 && r.height > 0) ? "看不见" : !(hit && (hit === el || el.contains(hit) || hit.contains(el))) ? "被盖住了" : "ok"];
  }), controls);
  assert.deepEqual(where.filter(([, s]) => s !== "ok"), [], "这些按钮在纸片画面里找不到 / 点不到");
  // 分组的小标题
  assert.deepEqual(await page.locator("#g-app > .g-top > .gp-tools-h:not([hidden])").evaluateAll(els => els.map(e => e.textContent)), ["战斗", "查看", "布置 · 主持人", "其他"]);
  await shot(page, "solo-paper-tools");
  // 点一个：打开同一个面板（战场数据），下拉收起
  await page.click("#g-app > .g-top #g-stats");
  await page.waitForSelector("#g-stats-sheet.show", { state: "visible" });
  await page.waitForSelector("#g-app > .g-top", { state: "hidden" });
  await page.click("#g-stats-close");
  // 换下拉框（天气）：照旧换天气（胶带上跟着写），下拉收起
  await openTools(page);
  await page.selectOption("#g-weather-sel", "sand");
  await page.waitForFunction(() => /沙暴/.test(document.querySelector("#g-paper .olp-top").textContent) && !document.querySelector("#g-app > .g-top.gp-open"));
  // 点别处、按 Esc：收起；这一下 Esc 不打开暂停页面
  await openTools(page);
  await page.click("#g-paper .olp-title");
  await page.waitForSelector("#g-app > .g-top", { state: "hidden" });
  await openTools(page);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("Escape");
  await page.waitForSelector("#g-app > .g-top", { state: "hidden" });
  await settle(page);
  assert.equal(await page.isVisible("#pm-overlay"), false, "这一下 Esc 只收下拉，不开菜单");
  // 单局里的战斗：顶栏本来就不放「队伍配置 / 遭遇 / 战场配置 / 背包 / 休整 / 存档 / 后台 / 重新开始 / 天气 / 敌人等级」——下拉里也没有，那一组的小标题也不留
  await page.evaluate(() => document.body.classList.add("rogue-battle"));
  await openTools(page);
  const rogue = await page.evaluate(() => ({ heads: [...document.querySelectorAll("#g-app > .g-top > .gp-tools-h")].filter(h => !h.hidden).map(h => h.textContent),
    shown: ["g-party-cfg", "g-enc-cfg", "g-field-cfg", "g-bag", "g-rest", "g-save", "g-bs", "g-restart", "g-level", "g-weather-sel"].filter(id => document.getElementById(id).getClientRects().length > 0) }));
  assert.deepEqual(rogue, { heads: ["战斗", "查看", "其他"], shown: [] }, "单局：主持人那一组整组不出现");
  assert.deepEqual(o.errors, []);
});

test("「工具 ▾」的「查看」里另有图鉴、规则（单局 / 跑团探索画面顶栏上的那两个，同一个图鉴入口）、整局数据（「战场数据」面板里那个，同一个入口）；离开纸片画面就拿掉", { timeout: 90000 }, async t => {
  const o = await soloPage(t); if (!o) return; const { page } = o;
  await openTools(page);
  assert.deepEqual(await page.evaluate(() => ["gp-bestiary", "gp-rules", "gp-career"].map(id => { const b = document.getElementById(id); return b && b.textContent; })), ["图鉴", "规则", "整局数据"]);
  await page.click("#gp-rules");
  await page.waitForFunction(() => { const r = document.querySelector(".bx.show"); return r && /规则说明/.test(r.textContent); });
  await page.waitForSelector("#g-app > .g-top", { state: "hidden" });
  await page.evaluate(() => Bestiary.close && Bestiary.close());
  // 整局数据：和「战场数据」面板里的那个是同一个（sheet-ui.js · CareerLog），点完下拉收起
  await openTools(page);
  await page.click("#gp-career");
  await page.waitForSelector("#career-sheet.show", { state: "visible" });
  await page.waitForSelector("#g-app > .g-top", { state: "hidden" });
  await page.click("#cl-close");
  await page.evaluate(() => HD2DField.switchTo("old"));
  await page.waitForFunction(() => !document.body.classList.contains("g-paper"));
  assert.equal(await page.locator("#gp-bestiary, #gp-rules, #gp-career, .gp-tools-h").count(), 0, "旧顶栏里不多出东西");
  assert.deepEqual(o.errors, []);
});

test("联机跑团的房主：胶带写「联机跑团」+ 房间码红章；「房间码 · 菜单」那颗按钮让开（菜单在胶带上）；房主的小队聊天照旧在战斗记录的抽屉里，收着时竖标签挂未读数", { timeout: 90000 }, async t => {
  const o = await soloPage(t); if (!o) return; const { page } = o;
  await page.evaluate(() => {
    OnlineGame.getView = () => ({ active: true, isHost: true, roomCode: "SA3X7C", mode: "trpg", status: { connected: true, hostOnline: true } });
    document.body.classList.add("ol-host-online");
    // online-ui.js · mountHostChat 给房主的战斗记录栏加的「战斗 / 小队」标签（这里只放一个，带 3 条未读）
    const nav = document.createElement("nav"); nav.className = "ol-host-tabs";
    nav.innerHTML = '<button type="button" data-host-tab="log" class="ol-tab on">战斗</button><button type="button" data-host-tab="chat" class="ol-tab">小队<span class="ol-dot ol-badge">3</span></button>';
    document.getElementById("g-log").prepend(nav);
    GamePaper.sync();
  });
  await page.waitForFunction(() => /^联机跑团/.test(document.querySelector("#g-paper .olp-title").textContent) && !!document.querySelector("#g-paper .olp-room"));
  assert.equal(await page.locator("#g-paper .olp-room").innerText(), "SA3X7C");
  assert.equal(await page.isVisible("#online-dock"), false, "「房间码 · 菜单」让开");
  await page.waitForFunction(() => { const d = document.querySelector("#g-log .gp-drawer-dot"); return d && !d.hidden && d.textContent === "3"; });
  // 拉开抽屉：「战斗 / 小队」标签在里面
  await page.click("#g-log .gp-drawer-tab");
  await page.waitForFunction(() => !document.getElementById("g-log").classList.contains("gp-collapsed"));
  assert.ok(await page.isVisible('#g-log [data-host-tab="chat"]'), "小队聊天的标签在抽屉里");
  assert.deepEqual(o.errors, []);
});

test("热座 / 联机房主：吊牌是热座栏的行动顺序（谁操作写在下面）；⇅ 点开是热座栏原来的「延后 / 换位」，点的就是热座栏那几个按钮；一台电脑的热座：「当前操作员」「分配角色」那一条照旧在（左下角），点得到", { timeout: 90000 }, async t => {
  const o = await soloPage(t); if (!o) return; const { page } = o;
  const hotseat = net => page.evaluate(net => {
    const heroes = state.units.filter(u => u.isPlayer && !u.weaponOf).slice(0, 2);
    const view = { enabled: true, network: net, configured: true, mode: "trpg", playerId: "gm", hostId: "gm",
      players: [{ id: "gm", name: "主持人", gm: true }, { id: "p2", name: "乙" }], heroes: heroes.map((u, i) => ({ id: u.id, name: u.name, owner: i ? "p2" : "gm" })),
      units: heroes.map((u, i) => ({ id: u.id, name: u.name, owner: i ? "p2" : "gm" })), phase: "acting", currentUnitId: heroes[0].id,
      order: heroes.map((u, i) => ({ actor: u.id, owner: i ? "p2" : "gm", current: !i })), canConfigure: !net, canDisable: false };
    window.__sent = [];
    HotseatGame.isActive = () => true; HotseatGame.getView = () => view;
    HotseatUI.mount({ getView: () => view, submit: cmd => { window.__sent.push(cmd); return { ok: true }; }, switchPlayer: id => { window.__switched = id; return { ok: true }; }, configure: () => ({ ok: true }) });
    GamePaper.sync();
    return heroes.map(u => u.name);
  }, net);
  const names = await hotseat(true);
  await page.waitForFunction(() => document.querySelectorAll("#g-paper .olp-tag").length === 2 && !!document.querySelector("#g-paper [data-olp-swap]"));
  assert.equal(await page.isVisible("#hotseat-root"), false, "联机房主：热座栏让开（只有字，胶带和吊牌上都有）");
  assert.deepEqual(await page.locator("#g-paper .olp-tag .olp-tag-nm").evaluateAll(els => els.map(e => e.innerText.replace(/\s+/g, " "))), [names[0] + " 主持人", names[1] + " 乙"]);
  assert.equal(await page.locator("#g-paper .olp-tag.on").count(), 1);
  await page.click('#g-paper [data-olp-swap="0"]');
  await page.waitForSelector('#g-paper [data-olp-move="0 0"]', { state: "visible" });
  assert.deepEqual(await page.locator('#g-paper [data-olp-slot="0"] [data-olp-move]').evaluateAll(els => els.map(e => e.textContent)), ["延后", "换位"]);
  await page.click('#g-paper [data-olp-move="0 0"]');
  await page.waitForFunction(() => window.__sent.length === 1);
  assert.equal(await page.evaluate(() => window.__sent[0].type), "orderMove", "延后 = 热座栏的「延后」（同一个按钮、同一条指令）");
  // 一台电脑的热座（没联网）：那一条还有「当前操作员」「分配角色」——留着，贴在左下角
  await hotseat(false);
  await page.evaluate(() => GamePaper.sync());
  await page.waitForSelector("#hotseat-root #hs-player", { state: "visible" });
  const strip = await page.evaluate(() => {
    const root = document.getElementById("hotseat-root"), r = root.getBoundingClientRect(), sel = document.getElementById("hs-player").getBoundingClientRect(), btn = document.querySelector('#hs-bar [data-hs="openConfig"]');
    const b = btn.getBoundingClientRect(), hit = el => { const x = el.getBoundingClientRect(), h = document.elementFromPoint(x.left + x.width / 2, x.top + x.height / 2); return !!h && (h === el || el.contains(h)); };
    return { left: r.left, bottom: r.bottom, vh: innerHeight, order: getComputedStyle(document.getElementById("hs-order")).display, sel: hit(document.getElementById("hs-player")), btn: hit(btn), w: sel.width };
  });
  assert.ok(strip.left < 30 && strip.bottom < strip.vh - 100, "贴在左下角、技能栏上面：" + JSON.stringify(strip));
  assert.equal(strip.order, "none", "行动顺序在吊牌上，热座栏里的那一条不重复");
  assert.ok(strip.sel && strip.btn, "「当前操作员」「分配角色」点得到：" + JSON.stringify(strip));
  assert.deepEqual(o.errors, []);
});

test("胶带上的「菜单 Esc」打开暂停页面（同一个 pause-menu.js：克制表在里面）；没东西可取消时按 Esc 也打开", { timeout: 90000 }, async t => {
  const o = await soloPage(t); if (!o) return; const { page } = o;
  await page.click("#g-paper [data-pause-open]");
  await page.waitForSelector("#pm-overlay", { state: "visible" });
  assert.ok((await page.evaluate(() => PauseMenu.list().map(r => r.id))).includes("matchup"), "克制表照旧在菜单里");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#pm-overlay", { state: "hidden" });
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("Escape");
  await page.waitForSelector("#pm-overlay", { state: "visible" });
  assert.deepEqual(o.errors, []);
});

test("战斗记录的抽屉：平时收着；拉出来是浮在右边的一块（不压技能栏），复制本回合 / 复制全部照旧在里面；收起 / 展开记在本机（关掉新画面再开还是那样）", { timeout: 90000 }, async t => {
  const o = await soloPage(t); if (!o) return; const { page } = o;
  assert.equal(await page.evaluate(() => document.getElementById("g-log").classList.contains("gp-collapsed")), true, "平时收着");
  await page.click("#g-log .gp-drawer-tab");
  await page.waitForFunction(() => !document.getElementById("g-log").classList.contains("gp-collapsed"));
  await settle(page);
  const drawer = await rect(page, "#g-log"), dock = await rect(page, "#g-app > .g-hud");
  assert.ok(drawer.width > 280 && drawer.height > 180 && drawer.right <= drawer.vw - 4, "拉出来是浮在右边的一块：" + JSON.stringify(drawer));
  assert.ok(drawer.bottom <= dock.top || drawer.left >= dock.right, "不压技能栏：" + JSON.stringify([drawer, dock]));
  assert.ok(await page.isVisible("#g-copy-turn") && await page.isVisible("#g-copy-all") && await page.isVisible("#g-logs"), "复制按钮、记录照旧在里面");
  assert.equal(await page.evaluate(() => localStorage.getItem("backfire.paper.drawer")), "open");
  await shot(page, "solo-paper-drawer");
  // 关掉新画面再开：还是拉开的
  await page.evaluate(() => HD2DField.switchTo("old"));
  await page.waitForFunction(() => !document.body.classList.contains("g-paper"));
  await paperOn(page);
  assert.equal(await page.evaluate(() => document.getElementById("g-log").classList.contains("gp-collapsed")), false, "记在本机：还开着");
  // 收回去
  await page.click("#g-log .gp-drawer-tab");
  await page.waitForFunction(() => document.getElementById("g-log").classList.contains("gp-collapsed"));
  assert.equal(await page.evaluate(() => localStorage.getItem("backfire.paper.drawer")), "closed");
  assert.deepEqual(o.errors, []);
});

test("吊牌：一个人打的时候是我方每个人；点别人的牌子 = 点队伍栏里同一个人（换人行动），高亮跟着换", { timeout: 90000 }, async t => {
  const o = await soloPage(t); if (!o) return; const { page } = o;
  const second = await page.evaluate(() => document.querySelectorAll("#g-paper .olp-tag")[1].dataset.olpPick);
  assert.ok(second);
  await page.click(`#g-paper .olp-tag[data-olp-pick="${second}"] .olp-tag-card`);
  await page.waitForFunction(id => GAME.actorId === id && document.querySelector("#g-paper .olp-tag.on").dataset.olpPick === id, second);
  assert.equal(await page.evaluate(() => document.querySelector("#g-party > .pc.on").dataset.id), second, "队伍栏里也换了");
  assert.deepEqual(o.errors, []);
});

test("新加的 DOM（胶带、吊牌、「工具 ▾」、抽屉的竖标签、队伍栏、技能栏）里没有坚毅生命的数字", { timeout: 90000 }, async t => {
  const o = await soloPage(t, { shp: true }); if (!o) return; const { page } = o;
  await openTools(page);
  assert.ok(await page.evaluate(([a]) => state.units.some(u => u.shp === a), [SHP]), "坚毅生命确实塞进去了");
  const html = await page.evaluate(() => [document.getElementById("g-paper"), document.querySelector("#g-app > .g-top"), document.getElementById("g-log"), document.querySelector("#g-app > .g-hud")]
    .filter(Boolean).map(el => el.outerHTML).join("\n").replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, "data:…").replace(/blob:[^"')\s]+/g, "blob:…"));   // 纸纹的地址（#321 起是 blob: + 随机编号）不算
  for (const n of [SHP, SHP_MAX]) assert.ok(!html.includes(String(n)), "出现了坚毅生命的数字 " + n);
  assert.doesNotMatch(html, /shp/i);
  assert.deepEqual(o.errors, []);
});

/* ---------- 第 4 步：3D 白卡让开浮在战场上的面板 ---------- */
/** 新画面这一刻排好的远景（假场景记下的布局，hd2d-layout.js / hd2d-camera.js 是真的）：每张卡（抬高以后的屏幕矩形）压在哪些面板底下、出没出画面。
 *  only = 只看这几块面板（拉开抽屉时三个区可能少让一点上下：只看左右的队伍、抽屉） */
const cardsUnder = (page, only) => page.evaluate((only) => {
  const st = document.querySelector("#g-field > .hd2d-field").getBoundingClientRect(), lay = window.__scene.layout;
  const sel = { 胶带: "#g-paper .olp-top", 吊牌: "#g-paper .olp-tags", 队伍: "#g-app > .g-hud .hd2d-party", 技能栏: "#g-app > .g-hud", 抽屉: "#g-log" };
  const ps = Object.entries(sel).filter(([k]) => !only || only.includes(k)).map(([k, s]) => [k, document.querySelector(s).getBoundingClientRect()]);
  const out = [];
  lay.units.forEach(u => {
    const x0 = st.left + u.rect.x0, x1 = st.left + u.rect.x1, y0 = st.top + u.rect.y0, y1 = st.top + u.rect.y1;
    ps.forEach(([k, r]) => { if (r.width > 0 && x0 < r.right - 0.5 && r.left < x1 - 0.5 && y0 < r.bottom - 0.5 && r.top < y1 - 0.5) out.push(`${u.id} 压在${k}底下`); });
    if (x0 < -1 || y0 < -1 || x1 > innerWidth + 1 || y1 > innerHeight + 1) out.push(`${u.id} 出了画面`);
  });
  return { out, n: lay.units.length, view: lay.view };
}, only || null);

test("3D 白卡让开浮在战场上的面板（第 4 步）：几种窗口大小下，远景排好的卡不压在胶带、吊牌、左上角的队伍、底下的技能栏、右边的抽屉底下（窗口矮、技能栏高时上下少让一点，左右照让、卡不出画面）；拉开抽屉、收起队伍跟着重排", { timeout: 150000 }, async t => {
  for (const [w, h] of [[1440, 900], [1920, 1080], [1366, 768]]) {
    const o = await soloPage(t, { context: { viewport: { width: w, height: h } } }); if (!o) return; const { page } = o;
    // 纸片画面量好面板交给新画面（hd2d-field.js · cover），新画面按让出来的那一块重排
    await page.waitForFunction(() => window.__scene && window.__scene.layout && window.__scene.layout.view.left > 0 && window.__scene.layout.view.right > 0);
    await settle(page);
    let r = await cardsUnder(page, h >= 900 ? null : ["队伍", "抽屉"]);
    assert.ok(r.n >= 7, "卡都排了：" + r.n);
    assert.deepEqual(r.out, [], `${w}×${h} · 抽屉收着：` + JSON.stringify(r.view));
    // 拉开抽屉：右边让得更多，卡不压在抽屉底下
    const right = r.view.right;
    await page.click("#g-log .gp-drawer-tab");
    await page.waitForFunction(x => window.__scene.layout.view.right > x + 100, right);
    await settle(page);
    r = await cardsUnder(page, ["队伍", "抽屉"]);
    assert.deepEqual(r.out, [], `${w}×${h} · 抽屉拉开：` + JSON.stringify(r.view));
    await page.click("#g-log .gp-drawer-tab");
    await page.waitForFunction(x => window.__scene.layout.view.right <= x, right);
    // 收起队伍（只剩一列头像）：左边少让，卡还是不压在它底下
    const left = (await cardsUnder(page)).view.left;
    await page.click("#g-app > .g-hud .hd2d-party .hd2d-toggle");
    await page.waitForFunction(x => window.__scene.layout.view.left < x - 60, left);
    await settle(page);
    r = await cardsUnder(page, h >= 900 ? null : ["队伍", "抽屉"]);
    assert.deepEqual(r.out, [], `${w}×${h} · 队伍收起：` + JSON.stringify(r.view));
    await page.click("#g-app > .g-hud .hd2d-party .hd2d-toggle");
    await shot(page, `solo-paper-cover-${w}x${h}`);
    assert.deepEqual(o.errors, []);
  }
});

/* ---------- 合并 #321（平铺纸纹）以后：单机的纸片画面也照 #321 的要求 ---------- */
test("#321 单机也一样：纸纹是一张平铺的小纹理（撕边 clip-path、影子挂在 .olp-ply 上）；开局画好以后选目标的按钮条出来 / 收起（技能栏变高变矮）、开关「工具 ▾」和抽屉、收起展开技能栏、拖窗口大小都不再画纹理；页面上的纹理不超过种类那么多张；离开纸片画面撕边、影子层一起拿掉", { timeout: 90000 }, async t => {
  const o = await soloPage(t); if (!o) return; const { page } = o;
  await page.waitForFunction(() => { const h = document.querySelector("#g-app > .g-hud"); return !!h && h.dataset.olpTex === "dock" && PaperUI.pending() === 0; }, null, { timeout: 30000 });
  // 技能栏后面那张纸：平铺、撕边是 clip-path；影子挂在补进去的 .olp-ply 上；技能吊牌的影子挂在自己身上（不补节点）
  const sheet = await page.evaluate(() => {
    const el = document.querySelector("#g-app > .g-hud"), cs = getComputedStyle(el, "::before"), ply = el.querySelector(":scope > .olp-ply"), sk = document.querySelector("#g-skills .sk");
    return { repeat: cs.backgroundRepeat, size: cs.backgroundSize, clip: cs.clipPath.slice(0, 8), ply: ply ? getComputedStyle(ply).filter : "", sk: getComputedStyle(sk).filter, skPly: !!sk.querySelector(".olp-ply"),
      url: /^url\("blob:/.test(el.style.getPropertyValue("--olp-tex")) };
  });
  assert.ok(sheet.repeat === "repeat" && /^256px( auto)?$/.test(sheet.size) && sheet.clip === "polygon(" && sheet.url, "平铺、撕边、blob: 地址：" + JSON.stringify(sheet));
  assert.match(sheet.ply, /drop-shadow/, "影子层");
  assert.ok(/drop-shadow/.test(sheet.sk) && !sheet.skPly, "技能吊牌的影子挂在自己身上：" + JSON.stringify(sheet));
  // 量：画了几张纹理（只数 PAPER.art.tile 见方的画布：别的模块的画布不算）、同步编码了几次
  await page.evaluate(() => {
    window.__paint = { ctx: 0, put: 0, data: 0 };
    const S = PaperUI.BASE.art.tile, C = HTMLCanvasElement.prototype, X = CanvasRenderingContext2D.prototype, g = C.getContext, d = C.toDataURL, p = X.putImageData;
    const tile = c => c && c.width === S && c.height === S;
    C.getContext = function (...a) { if (tile(this)) __paint.ctx++; return g.apply(this, a); };
    C.toDataURL = function (...a) { if (tile(this)) __paint.data++; return d.apply(this, a); };
    X.putImageData = function (...a) { if (tile(this.canvas)) __paint.put++; return p.apply(this, a); };
  });
  const dock = () => page.evaluate(() => { const h = document.querySelector("#g-app > .g-hud"); return { h: h.offsetHeight, tex: h.style.getPropertyValue("--olp-tex"), paint: Object.assign({}, __paint) }; });
  const before = await dock();
  // 选目标：技能栏里多出按钮条（和 game.js · showPickBar 画的一样），变高；取消：收起，变回去
  await page.evaluate(() => {
    const row = document.querySelector("#g-app > .g-hud .hud-row");
    let bar = document.getElementById("g-pick-bar");
    if (!bar) { bar = document.createElement("div"); bar.className = "g-pick-bar"; bar.id = "g-pick-bar"; row.parentNode.insertBefore(bar, row); }
    bar.innerHTML = '<button class="g-btn">不选<small>跳过</small></button><button class="g-btn danger">放弃（Esc）</button>';
    bar.classList.add("show");
  });
  await page.waitForFunction(h => document.querySelector("#g-app > .g-hud").offsetHeight !== h, before.h);
  await page.waitForTimeout(300);
  const picked = await dock();
  await page.evaluate(() => { const bar = document.getElementById("g-pick-bar"); bar.classList.remove("show"); bar.innerHTML = ""; });
  await page.waitForFunction(h => document.querySelector("#g-app > .g-hud").offsetHeight === h, before.h);
  // 「工具 ▾」下拉、右边的抽屉：开出来是新的面板（新的大小），关上
  await openTools(page);
  await page.waitForFunction(() => document.querySelector("#g-app > .g-top").dataset.olpTex === "kraft");
  await page.click('#g-paper [data-olp="tools"]');
  await page.click("#g-log .gp-drawer-tab");
  await page.waitForFunction(() => document.getElementById("g-log").dataset.olpTex === "receipt");
  await page.click("#g-log .gp-drawer-tab");
  // 技能栏收起再展开
  await page.click("#g-app > .g-hud .hd2d-dock-toggle");
  await page.waitForTimeout(150);
  await page.click("#g-app > .g-hud .hd2d-dock-toggle");
  // 拖着窗口变大变小
  for (const [w, h] of [[1280, 820], [1100, 720], [1366, 768], [1440, 900]]) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(80); }
  await page.waitForTimeout(400);
  const back = await dock();
  assert.notEqual(picked.h, before.h, "选技能时技能栏高度变了：" + before.h + " → " + picked.h);
  assert.deepEqual([picked.tex, back.tex], [before.tex, before.tex], "一直是那一张纹理");
  assert.deepEqual([back.paint, await page.evaluate(() => PaperUI.pending())], [{ ctx: 0, put: 0, data: 0 }, 0], "一张都没画、没有同步编码");
  // 页面上贴着的纹理：一套配色最多种类那么多张
  const n = await page.evaluate(() => ({ n: new Set([...document.querySelectorAll("[data-olp-tex]")].map(e => e.style.getPropertyValue("--olp-tex"))).size, kinds: Object.keys(PaperUI.BASE.art.kinds).length }));
  assert.ok(n.n <= n.kinds, "纹理张数：" + JSON.stringify(n));
  // 离开纸片画面：纸纹、撕边、影子层都不留（旧画面的技能栏、顶栏、记录栏照旧用）
  await page.evaluate(() => HD2DField.switchTo("old"));
  await page.waitForFunction(() => !document.body.classList.contains("g-paper"));
  await settle(page);
  assert.deepEqual(await page.evaluate(() => ["[data-olp-tex]", '[style*="--olp-clip"]', '[style*="--olp-tex"]', ".olp-ply"].map(s => document.querySelectorAll("#g-app " + s).length)), [0, 0, 0, 0]);
  assert.deepEqual(o.errors, []);
});

/* ---------- 第 3 步：收据、选目标的按钮条、天气换色不串 ---------- */
/** 战斗记录里塞几条和 game.js（pushLogCard / addLogPhase）画的一样的记录；技能栏里摆一条和 game.js · showPickBar 一样的选目标按钮条 */
const fakeLog = page => page.evaluate(() => {
  const logs = document.getElementById("g-logs");
  logs.insertAdjacentHTML("beforeend", '<div class="lg phase"><div class="t">第 1 回合 · 我方回合</div></div>' +
    '<div class="lg"><div class="t">【<span class="who player">瑞比</span>】斩击</div><div class="s cost">消耗 1 行动点</div><div class="s hit">→ 狂徒：<span class="dmg-electric">12</span> 电击伤害，击破 4</div>' +
    '<div class="s warn">狂徒 失衡</div><div class="s sum">本行动合计 12</div><details class="calc"><summary>计算过程</summary><pre>1d6+6 = 12</pre></details></div>' +
    '<div class="lg"><div class="t">【<span class="who enemy">狂徒</span>】乱砍</div><div class="s hit">→ 结人：8 伤害</div></div>');
  const row = document.querySelector("#g-app > .g-hud .hud-row");
  let bar = document.getElementById("g-pick-bar");
  if (!bar) { bar = document.createElement("div"); bar.className = "g-pick-bar"; bar.id = "g-pick-bar"; row.parentNode.insertBefore(bar, row); }
  bar.innerHTML = '<button class="g-btn">不选<small>跳过</small></button><button class="g-btn danger">放弃（Esc）</button>';
  bar.classList.add("show");
});
/** 一个 CSS 变量这一刻在某个元素里算出来的颜色（rgb(...)） */
const varColor = (page, sel, name) => page.evaluate(([sel, name]) => {
  const host = document.querySelector(sel), x = document.createElement("i");
  x.style.color = `var(${name})`; host.appendChild(x);
  const c = getComputedStyle(x).color; x.remove(); return c;
}, [sel, name]);

test("战斗记录是一长条热敏收据（和联机同一套字、分隔线：打印体、顶上 BACKFIRE / 战斗记录 · 模式 + 一排等号、每条之间虚线、回合 / 阶段那一句写成 *** … ***）；白天白纸、夜里黑纸；选目标时的按钮条是米白小卡片，「放弃」是红章色", { timeout: 90000 }, async t => {
  const o = await soloPage(t); if (!o) return; const { page } = o;
  await fakeLog(page);
  await page.click("#g-log .gp-drawer-tab");
  await page.waitForFunction(() => !document.getElementById("g-log").classList.contains("gp-collapsed"));
  await settle(page);
  // 顶上：BACKFIRE / 战斗记录 · 模式（自定义战斗写「战斗」）+ 一排等号（字都在 paper-ui.js · BASE.receipt，和联机的收据同一份）
  const head = await page.evaluate(() => { const h = document.querySelector("#g-log > .gp-rc-head"); return h && { brand: h.querySelector("b").textContent, sub: h.querySelector("span").textContent, rule: /^=+$/.test(h.querySelector("i").textContent), visible: h.getClientRects().length > 0 }; });
  assert.deepEqual(head, { brand: "BACKFIRE", sub: "战斗记录 · 战斗", rule: true, visible: true });
  const look = await page.evaluate(() => {
    const cs = (sel, pseudo) => getComputedStyle(document.querySelector(sel), pseudo || null);
    return {
      mono: /Mono|monospace/i.test(cs("#g-logs").fontFamily), dashed: cs("#g-logs > .lg:not(.phase)").borderBottomStyle,
      phase: [cs("#g-logs > .lg.phase .t", "::before").content, cs("#g-logs > .lg.phase .t", "::after").content, cs("#g-logs > .lg.phase .t").textAlign],
      ink: cs("#g-logs .lg .s.hit").color, dmg: cs("#g-logs .lg .dmg-electric").color, title: cs("#g-logs > .lg:not(.phase) .t").color,
      sumRule: cs("#g-logs .lg .s.sum").borderTopStyle, tools: cs("#g-log .log-tools > span").display
    };
  });
  const ink = await varColor(page, "#g-logs", "--olp-receipt-ink");
  assert.equal(look.mono, true, "打印体");
  assert.equal(look.dashed, "dashed", "每条之间虚线");
  assert.deepEqual(look.phase, ['"*** "', '" ***"', "center"], "回合 / 阶段那一句写成 *** … ***");
  assert.equal(look.ink, ink, "字是收据的墨色");
  assert.equal(look.dmg, ink, "热敏纸是单色的：属性颜色的数字也是墨色（加粗）");
  assert.equal(look.title, ink);
  assert.equal(look.sumRule, "dashed", "本行动合计上面一排虚线");
  assert.equal(look.tools, "none", "「战斗记录」那几个字挪到收据顶上了");
  // 白天白纸、夜里黑纸（同一套变量：--olp-receipt）
  const paperOf = () => varColor(page, "#g-log", "--olp-receipt");
  const day = await paperOf();
  await page.evaluate(() => { state.light = "night"; document.getElementById("g-app").classList.add("is-night"); });
  await page.waitForFunction(() => document.body.dataset.olpTime === "night");
  const night = await paperOf();
  assert.notEqual(day, night);
  assert.ok(day.match(/\d+/g).slice(0, 3).every(v => Number(v) > 200), "白天收据是白的：" + day);
  assert.ok(night.match(/\d+/g).slice(0, 3).every(v => Number(v) < 60), "夜里收据是黑的：" + night);
  // 选目标的按钮条：米白小卡片（--olp-card），「放弃」红章色（--olp-stamp）；「或者：」是纸上的淡字
  const pick = await page.evaluate(() => {
    const [a, b] = document.querySelectorAll("#g-pick-bar .g-btn"), ca = getComputedStyle(a), cb = getComputedStyle(b);
    return { bg: ca.backgroundColor, ink: ca.color, danger: cb.color, dangerBorder: cb.borderTopColor, visible: a.getClientRects().length > 0 };
  });
  assert.deepEqual(pick, { bg: await varColor(page, "#g-app > .g-hud", "--olp-card"), ink: await varColor(page, "#g-app > .g-hud", "--olp-paper-ink"),
    danger: await varColor(page, "#g-app > .g-hud", "--olp-stamp"), dangerBorder: await varColor(page, "#g-app > .g-hud", "--olp-stamp"), visible: true });
  await shot(page, "solo-paper-receipt");
  // 离开纸片画面：收据顶上那一块拿掉，旧记录栏照旧
  await page.evaluate(() => HD2DField.switchTo("old"));
  await page.waitForFunction(() => !document.body.classList.contains("g-paper"));
  assert.equal(await page.locator("#g-log > .gp-rc-head").count(), 0);
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector("#g-log .log-tools > span")).display), "none", "旧记录栏的「战斗记录」照旧");
  assert.deepEqual(o.errors, []);
});

/** 纸片画面里看得见的几块（打开「工具 ▾」、拉开抽屉、预演框亮着）和它们的 ::before 这一刻算出来的样子（动画、过渡怎么量见下面的 looks） */
const PAPER_PARTS = {
  tools: "#g-app > .g-top", toolBtn: "#g-app > .g-top #g-stats", toolOff: "#g-app > .g-top #g-undo", select: "#g-weather-sel",
  hud: "#g-app > .g-hud", sk: "#g-app > .g-hud .skills .sk", skNm: "#g-app > .g-hud .skills .sk .nm", skKey: "#g-app > .g-hud .skills .sk .key", skCost: "#g-app > .g-hud .skills .sk .cost",
  skAp: "#g-app > .g-hud .skills .sk .cost .ap", end: "#g-app > .g-hud .endturn", summon: "#g-app > .g-hud .summonbtn", hint: "#g-app > .g-hud > .hint", hintB: "#g-app > .g-hud > .hint b",
  sheet: "#g-app > .g-hud .pc-sheet", sheetN: "#g-app > .g-hud .pc-sheet .n", pick: "#g-pick-bar .g-btn", pickSmall: "#g-pick-bar .g-btn small",
  log: "#g-log", logBtn: "#g-log .log-tools .g-btn", lgT: "#g-logs .lg .t", lgS: "#g-logs .lg .s", lgCost: "#g-logs .lg .s.cost", lgSum: "#g-logs .lg .s.sum", lgPre: "#g-logs .lg pre",
  pv: "#g-app > .pvbox", pvH: "#g-app > .pvbox h4", pvLn: "#g-app > .pvbox .ln", party: "#g-app > .g-hud .hd2d-party", pm: "#g-app > .g-hud .hd2d-party .pm"
};
const PAPER_PROPS = ["color", "background-color", "background-image", "border-top-color", "border-top-style", "border-top-width", "box-shadow", "animation-name", "text-shadow", "opacity", "filter"];
/** 量的时候临时加上：所有 CSS 动画、过渡都停掉（量完拿掉，CSS 自己重新起动画） */
const STILL_CSS = "*, *::before, *::after { animation: none !important; transition: none !important; }";
/**
 * 这几块这一刻的样子。动画只比「套的是哪个」：animation-name（元素、::before），和元素身上真有的 CSS 动画（CSSAnimation；比 animation-name 多出来的，
 * 就是 CSS 已经不要了、却没取消、还套在上面的）；别的属性在临时停掉所有动画、过渡的时候量（底下的样子，不随时间变）。
 * 以前是 getAnimations() 全部 pause()、currentTime = 0，定在第 0 帧量：被脚本暂停过的 CSS 动画就不再全归 CSS 管——
 * 有的 Chromium（主人那边 Playwright 的）换天气拿掉 animation-name 时不取消它，下一次整块重算样式（开 / 关纸片画面）又把定住的那一帧套回来，
 * 上一轮微光的呼吸光（wfxGlowUi / wfxGlowBtn 第 0 帧）就带进了「沙暴」那一轮的旧顶栏、按钮（#339）。游戏自己不拿脚本动 CSS 的动画
 */
const looks = (page, parts) => page.evaluate(([parts, props, still]) => {
  // 脚本自己起的动画（el.animate：game.js 的镜头拉近这些）照旧定在第 0 帧；CSS 的动画、过渡不碰
  document.getAnimations().filter(a => !(a instanceof CSSAnimation || a instanceof CSSTransition)).forEach(a => { a.pause(); a.currentTime = 0; });
  const out = {}, found = Object.entries(parts).map(([k, sel]) => [k, document.querySelector(sel)]);
  found.forEach(([k, el]) => {
    if (!el) { out[k] = "（没有）"; return; }
    out[k + " animation-name"] = getComputedStyle(el).animationName;
    out[k + "::before animation-name"] = getComputedStyle(el, "::before").animationName;
    out[k + " CSS 动画"] = el.getAnimations().filter(a => a instanceof CSSAnimation).map(a => a.animationName).sort().join(", ");
  });
  const css = document.createElement("style");
  css.textContent = still;
  document.head.appendChild(css);
  try {
    found.forEach(([k, el]) => {
      if (!el) return;
      const cs = getComputedStyle(el), bs = getComputedStyle(el, "::before");
      props.forEach(p => { if (p !== "animation-name") out[k + " " + p] = cs.getPropertyValue(p); });
      // 图片地址只比「有几张」：纸纹是程序画的 PNG（#321 起是 blob: 地址）；旧皮肤相位天气的波纹（weather-fx.js）过一会儿会从 SVG 换成画好的 PNG，和纸片无关
      ["content", "filter", "background-image", "clip-path"].forEach(p => { out[k + "::before " + p] = bs.getPropertyValue(p).replace(/url\("(?:data|blob):[^"]*"\)/g, 'url("图…")'); });
    });
  } finally { css.remove(); }
  return out;
}, [parts, PAPER_PROPS, STILL_CSS]);
const diffOf = (a, b) => Object.keys(a).filter(k => a[k] !== b[k]).map(k => `${k}: ${a[k]} ≠ ${b[k]}`);
/** looks 量出来的：元素身上真有的 CSS 动画里，animation-name 已经不写了的（CSS 不要了、却没取消、还套在上面的——真玩的时候就是一直带着上一种天气的光圈） */
const leftovers = o => Object.keys(o).filter(k => k.endsWith(" CSS 动画") && o[k]).flatMap(k => {
  const part = k.slice(0, -" CSS 动画".length), names = String(o[part + " animation-name"] || "").split(", ");
  return o[k].split(", ").filter(n => !names.includes(n)).map(n => part + "：" + n);
});
/** 换天气（旧顶栏的下拉框，同一个处理：game.js 换 state.weather、#g-app[data-weather]） */
const setWeather = (page, w) => page.evaluate(w => { const s = document.getElementById("g-weather-sel"); s.value = w; s.dispatchEvent(new Event("change", { bubbles: true })); }, w);

test("天气换色不串：纸片画面里旧皮肤（game.css / weather-fx.css）按 #g-app[data-weather] 给面板、按钮、记录换的底色、字色、描边、呼吸发光、沙雾一条都套不上（只跟着纸片自己的天气色调）；回到旧画面，纸片的配色一点不留、旧皮肤的天气样子照旧", { timeout: 150000 }, async t => {
  const o = await soloPage(t, { on: false }); if (!o) return; const { page } = o;
  await fakeLog(page);
  const OLD = { top: "#g-app > .g-top", btn: "#g-stats", hud: "#g-app > .g-hud", sk: "#g-app > .g-hud .sk", log: "#g-log", lgT: "#g-logs .lg .t", lgS: "#g-logs .lg .s", pick: "#g-pick-bar .g-btn" };
  // 纸片自己的天气色调（paper-ui.js · BASE.theme.weather；酷暑没有）
  const PAPER_WEATHER = { glow: "fog", sand: "sand", heat: "none", snow: "snow", acid: "rain", thunder: "rain", phase: "fog" };
  for (const w of Object.keys(PAPER_WEATHER)) {
    await setWeather(page, w);
    await page.waitForFunction(w => document.getElementById("g-app").dataset.weather === w, w);
    await settle(page);
    const oldBefore = await looks(page, OLD);
    // 上一轮开 / 关过纸片画面，这一轮换了天气（第一轮是微光，第二轮起就是主人担心的「微光天气开过新画面再换天气」）：旧画面上不挂着上一种天气的动画
    assert.deepEqual(leftovers(oldBefore), [], `换成「${w}」以后旧画面上还挂着已经不要的动画`);
    await paperOn(page);
    // 纸片画面：下拉打开、抽屉拉开、预演框亮着，纸纹贴好
    await page.evaluate(() => {
      // 先拉抽屉再开下拉（点到下拉外面会把下拉收起）
      if (document.getElementById("g-log").classList.contains("gp-collapsed")) document.querySelector("#g-log .gp-drawer-tab").click();
      if (!document.querySelector("#g-app > .g-top.gp-open")) document.querySelector('#g-paper [data-olp="tools"]').click();
      const pv = document.getElementById("g-pvbox"); pv.innerHTML = '<h4>斩击 · 预演</h4><div class="ln">消耗 1 行动点</div><div class="ln key">→ 狂徒：12 伤害</div>'; pv.classList.add("live");
    });
    // 纸纹挪到空闲时画（#321：换到没画过的一套配色时这一套的每种纸排着画，纸板按钮排在后面）：等这一套都画好、贴上
    await page.waitForFunction(() => PaperUI.pending() === 0 && !!document.querySelector("#g-app > .g-top.gp-open[data-olp-tex]") && !!document.querySelector("#g-log[data-olp-tex]") &&
      !!document.querySelector("#g-app > .g-hud[data-olp-tex]") && !!document.querySelector("#g-app > .g-hud .endturn[data-olp-tex]"), null, { timeout: 30000 });
    await settle(page);
    const withWeather = await looks(page, PAPER_PARTS);
    assert.deepEqual(leftovers(withWeather), [], `天气「${w}」：纸片画面里还挂着旧皮肤已经不要的动画`);
    assert.equal(await page.evaluate(() => document.body.dataset.olpWeather), PAPER_WEATHER[w], "纸片自己的天气色调照旧：" + w);
    // 同一个纸片画面（纸片的天气色调不变），只是旧皮肤的天气规则套不上（拿掉 #g-app 的 data-weather）：应该一模一样
    await page.evaluate(() => { const a = document.getElementById("g-app"); a.dataset.keepWeather = a.dataset.weather; delete a.dataset.weather; });
    await settle(page);
    const without = await looks(page, PAPER_PARTS);
    assert.equal(await page.evaluate(() => document.body.dataset.olpWeather), PAPER_WEATHER[w], "拿掉 data-weather 也不换纸片自己的色调");
    await page.evaluate(() => { const a = document.getElementById("g-app"); a.dataset.weather = a.dataset.keepWeather; delete a.dataset.keepWeather; });
    assert.deepEqual(diffOf(withWeather, without), [], `天气「${w}」时旧皮肤的天气样式串进了纸片画面`);
    // 回到旧画面：纸片的配色变量、天气标记都拿掉，旧皮肤的天气样子和进纸片画面之前一模一样
    await page.evaluate(() => { document.getElementById("g-pvbox").classList.remove("live"); HD2DField.switchTo("old"); });
    await page.waitForFunction(() => !document.body.classList.contains("g-paper"));
    await settle(page);
    const left = await page.evaluate(() => ({ vars: [...document.body.style].filter(p => p.startsWith("--olp")), time: document.body.dataset.olpTime || null, weather: document.body.dataset.olpWeather || null }));
    assert.deepEqual(left, { vars: [], time: null, weather: null }, "纸片的配色留在了旧画面上：" + w);
    const oldAfter = await looks(page, OLD);
    assert.deepEqual(leftovers(oldAfter), [], `天气「${w}」：开 / 关纸片画面以后旧画面上还挂着已经不要的动画`);
    assert.deepEqual(diffOf(oldAfter, oldBefore), [], `天气「${w}」：开 / 关纸片画面以后旧皮肤的样子变了`);
  }
  assert.deepEqual(o.errors, []);
});

/* ---------- 主人截图（10/23，1440×900 战斗中）：技能名字下面那行消耗字太淡 ---------- */
/** 两个颜色（#rrggbb / rgb(…) / color(srgb 0–1 …)）的对比度（WCAG；同 tests/online-paper-ui.test.js） */
const contrast = (a, b) => {
  const rgb = c => (/^#/.test(c) ? [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)) : /^color\(srgb/.test(c) ? c.match(/[\d.]+/g).slice(0, 3).map(v => Number(v) * 255) : c.match(/[\d.]+/g).slice(0, 3).map(Number));
  const lum = c => { const [r, g, b] = rgb(c).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** 纸片自己的天气色调（paper-ui.js · BASE.theme.weather）：常态、沙暴、下雨（酸雨）、雪、雾（微光）各挑一种 */
const COST_WEATHERS = { none: "none", sand: "sand", acid: "rain", snow: "snow", glow: "fog" };

test("技能吊牌名字下面那行消耗（「行动 1」「附赠 1」）、「唤出」下面那行小字在纸上看得清：深色字（夜里浅色）、加粗，和纸面的对比度 ≥ 4.5（白天 / 夜里 × 常态 / 沙暴 / 下雨 / 雪 / 雾）——新画面原来的薄荷绿、浅黄在牛皮纸上几乎看不见", { timeout: 150000 }, async t => {
  const o = await soloPage(t); if (!o) return; const { page } = o;
  // 主人截的是战斗中（轮到我方，技能能用）；开战前技能都灰着（淡到 .4）。开战：柯尔特的初始刀头选第一个，等「战斗开始」的大字收走、技能栏里有能用的技能
  await page.evaluate(() => document.getElementById("g-start").click());
  await page.waitForFunction(() => !!document.querySelector("#g-choice.show .opts button"), null, { timeout: 15000 });
  await page.evaluate(() => document.querySelector("#g-choice.show .opts button").click());
  await page.waitForFunction(() => state.combatStarted && GAME.depth === 0 && !document.querySelector("#g-choice.show, .phase-card") &&
    !!document.querySelector("#g-app > .g-hud .skills .sk[data-olp-tex]:not([disabled]) .cost .ap") && !!document.querySelector("#g-app > .g-hud .summonbtn[data-olp-tex] small"), null, { timeout: 30000 });
  for (const time of ["day", "night"]) {
    if (time === "night") await page.evaluate(() => { state.light = "night"; document.getElementById("g-app").classList.add("is-night"); });
    for (const [w, paper] of Object.entries(COST_WEATHERS)) {
      await setWeather(page, w);
      await page.waitForFunction(([time, paper]) => document.body.dataset.olpTime === time && document.body.dataset.olpWeather === paper, [time, paper]);
      const r = await page.evaluate(() => {
        const hud = document.querySelector("#g-app > .g-hud"), look = el => ({ text: el.textContent, color: getComputedStyle(el).color, weight: Number(getComputedStyle(el).fontWeight) });
        const probe = name => { const x = document.createElement("i"); x.style.color = `var(${name})`; hud.appendChild(x); const c = getComputedStyle(x).color; x.remove(); return c; };
        // 「唤出」的颜色跟着这个人的主属性（game.js：--el = var(--属性)，没有主属性是危险黄）：每一种都量一遍，量完放回去
        const sb = hud.querySelector(".summonbtn"), small = sb.querySelector("small"), keep = sb.style.getPropertyValue("--el");
        const summon = Object.keys(HD2DUI.UI.elements).concat([""]).map(k => { sb.style.setProperty("--el", k ? `var(--${k})` : "var(--sk-hazard, #f2c230)"); return Object.assign({ el: k || "无" }, look(small)); });
        if (keep) sb.style.setProperty("--el", keep); else sb.style.removeProperty("--el");
        return { cost: [...hud.querySelectorAll(".skills .sk .cost, .skills .sk .cost :is(.ap, .bn)")].map(look), aps: hud.querySelectorAll(".skills .sk .cost .ap").length,
          bns: hud.querySelectorAll(".skills .sk .cost .bn").length, live: hud.querySelectorAll(".skills .sk:not([disabled]) .cost").length, kraft: probe("--olp-kraft"), board: probe("--olp-board"), summon };
      });
      const tag = `${time} · ${w}`;
      assert.ok(r.aps > 0 && r.bns > 0, tag + "：「行动」「附赠」两种消耗都有：" + JSON.stringify([r.aps, r.bns]));
      assert.ok(r.live > 0, tag + "：量的里面有能用的技能（战斗中）");
      for (const c of r.cost) {
        assert.ok(contrast(c.color, r.kraft) >= 4.5, `${tag}：消耗「${c.text}」的字 ${c.color} 在牛皮纸 ${r.kraft} 上对比度只有 ${contrast(c.color, r.kraft).toFixed(2)}`);
        assert.ok(c.weight >= 700, `${tag}：消耗「${c.text}」要加粗：${c.weight}`);
      }
      for (const s of r.summon) {
        assert.ok(contrast(s.color, r.board) >= 4.5, `${tag}：「唤出」（${s.el}）下面那行「${s.text}」${s.color} 在纸板 ${r.board} 上对比度只有 ${contrast(s.color, r.board).toFixed(2)}`);
        assert.ok(s.weight >= 700, `${tag}：「唤出」下面那行要加粗：${s.weight}`);
      }
      // 截图：换了配色以后纸纹在空闲时画（#321），画好之前还贴着上一套（夜里的浅色字压在白天的牛皮纸上，截出来像是看不清）——等这一套画好再拍
      if (w === "none") { await page.waitForFunction(() => PaperUI.pending() === 0, null, { timeout: 30000 }); await settle(page); await shot(page, "solo-paper-cost-" + time); }
    }
  }
  assert.deepEqual(o.errors, []);
});
