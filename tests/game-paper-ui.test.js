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
    .filter(Boolean).map(el => el.outerHTML).join("\n").replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, "data:…"));
  for (const n of [SHP, SHP_MAX]) assert.ok(!html.includes(String(n)), "出现了坚毅生命的数字 " + n);
  assert.doesNotMatch(html, /shp/i);
  assert.deepEqual(o.errors, []);
});
