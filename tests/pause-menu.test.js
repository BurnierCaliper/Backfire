// 暂停页面（#298，pause-menu.js）：Esc / 角上「菜单」按钮打开；克制表、主持人工具、消息与成员、大厅、角色分配收在里面；
// 联机玩家的右侧栏可以收起。
//   · 不用浏览器的：配置表、菜单项的先后 / 显示条件、教程留位置、原来的按钮去掉了
//   · 要浏览器的：用 Playwright；没装 Playwright 时在 Linux 上用机器自带的 Chrome（tests/cdp-browser.js），都没有就跳过
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const file = f => path.join(ROOT, f);

/* ---------- 不用浏览器 ---------- */
function loadMenu(extra) {
  const ctx = vm.createContext(Object.assign({ console }, extra || {}));
  ctx.window = ctx;
  vm.runInContext(read("pause-menu.js"), ctx, { filename: "pause-menu.js" });
  return ctx;
}
const plain = v => JSON.parse(JSON.stringify(v));   // vm 里建的数组换成这边的，deepEqual 才比得了

test("配置表：文字、菜单项、先后都在 PAUSE_MENU 里；联机标题写「菜单」并说明不会真的暂停", () => {
  const { PauseMenu: M } = loadMenu();
  const C = M.CONFIG;
  assert.equal(C.text.title, "暂停");
  assert.equal(C.text.titleOnline, "菜单");
  assert.match(C.text.noteOnline, /不会暂停/);
  for (const id of ["tutorial", "matchup", "gmTools", "assign", "room", "lobby"]) {
    assert.ok(C.items[id] && C.items[id].label, "菜单项有名字：" + id);
    assert.equal(typeof C.order[id], "number", "菜单项有先后：" + id);
  }
  assert.deepEqual(plain(C.screens), ["battle", "run", "trpg"], "单机：战斗、单局、跑团探索画面能开");
  const local = M.html([{ id: "matchup", label: "克制表", hint: "", badge: 0 }], false), online = M.html([], true);
  assert.match(local, /<h2 id="pm-title">暂停<\/h2>/);
  assert.doesNotMatch(local, /pm-note/);
  assert.match(online, /<h2 id="pm-title">菜单<\/h2><p class="pm-note">联机不会暂停/);
  assert.match(local, /data-pause-resume>继续<kbd>Esc<\/kbd>/);
});

test("菜单项：按配置排先后；visible() 为假的不显示；同一个 config 的名字共用；提示数字加起来，有事要处理写「!」", () => {
  const { PauseMenu: M } = loadMenu();
  let host = true, manual = false;
  M.register({ id: "room", run() {}, badge: () => 2 });
  M.register({ id: "lobby", run() {}, badge: () => 1 });
  M.register({ id: "gmTools", run() {}, visible: () => host, badge: () => manual });
  M.register({ id: "matchupOnline", config: "matchup", run() {}, visible: () => !host });
  assert.deepEqual(plain(M.list().map(r => r.id)), ["gmTools", "room", "lobby"]);
  host = false;
  assert.deepEqual(plain(M.list().map(r => [r.id, r.label])), [["matchupOnline", "克制表"], ["room", "消息与成员"], ["lobby", "大厅"]]);
  assert.equal(M.badgeOf(M.list()), 3);
  host = true; manual = true;
  assert.equal(M.badgeOf([{ badge: 0 }, { badge: true }]), true);
  assert.equal(M.badgeOf(M.list()), 3, "有新消息时显示条数");
  assert.match(M.html(M.list(), true), /data-pause-item="gmTools"><b>主持人工具<\/b><small>[^<]*<\/small><span class="pm-dot" aria-hidden="true">!<\/span>/);
  assert.match(M.html([{ id: "room", label: "x", hint: "", badge: 12 }], true), /<span class="pm-dot" aria-hidden="true">9\+<\/span><span class="pm-sr">（12 条新消息）<\/span>/);
});

test("教程（#263 还没合）：没有教程页时菜单里没有这一项；挂出 window.Tutorial.open() 后出现，点它打开教程", () => {
  const ctx = loadMenu(), M = ctx.PauseMenu;
  assert.equal(M.list().some(r => r.id === "tutorial"), false);
  let opened = 0;
  ctx.Tutorial = { open() { opened++; } };
  assert.deepEqual(plain(M.list().map(r => [r.id, r.label])), [["tutorial", "教程"]]);
  assert.equal(M.choose("tutorial"), true);
  assert.equal(opened, 1);
  assert.equal(M.CONFIG.tutorial.global + "." + M.CONFIG.tutorial.method, "Tutorial.open", "#263 合并后对上这个入口（或改配置这一行）");
});

test("原来的按钮去掉了，不留两份：顶栏克制表、联机舞台的克制表、#ogm-toggle、「消息与成员」「角色分配」按钮", () => {
  const html = read("game.html"), ol = read("online-ui.js"), gm = read("online-gm-ui.js"), mu = read("matchup-ui.js");
  assert.doesNotMatch(html, /id="g-matchup"|id="r-matchup"/);
  assert.doesNotMatch(mu, /closest\("#[gr]-matchup"\)|\["g-matchup", "r-matchup"\]/, "matchup-ui.js 不再接顶栏按钮");
  assert.doesNotMatch(ol, /button\("克制表", "matchup"\)|data-online="openRoom"|id="ol-room-open"|"openAssign"/);
  assert.doesNotMatch(gm, /id="ogm-toggle"|data-action="toggle"/);
  // 加载顺序：pause-menu.js 在登记菜单项的模块前面；样式也接上了
  const at = name => html.indexOf(`<script src="${name}"></script>`);
  for (const name of ["matchup-ui.js", "online-gm-ui.js", "online-ui.js"]) assert.ok(at("pause-menu.js") > 0 && at("pause-menu.js") < at(name), "pause-menu.js 先于 " + name);
  assert.match(html, /<link rel="stylesheet" href="pause-menu.css" \/>/);
  // 只开关画面上的面板：不碰坚毅生命，也不经手联机数据
  assert.doesNotMatch(read("pause-menu.js"), /shp|packet|OnlineGame/);
  // 联机玩家的画面只留白名单里的东西：暂停页面要在白名单里
  assert.match(read("online.css"), /body\.online-player > [^{]*:not\(\.pm-overlay\)[^{]*\{ display: none !important; \}/);
});

/* ---------- 浏览器 ---------- */
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

async function newPage(t, opt) {
  if (!browser) { t.skip(skipWhy); return null; }
  const context = await browser.newContext(Object.assign({ viewport: { width: 1360, height: 900 } }, opt || {}));
  await require("./old-screen")(context);   // #316：新画面默认开，这里测的是旧画面
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  return { page, errors, context };
}
const menuOpen = page => page.isVisible("#pm-overlay");
const menuIds = page => page.evaluate(() => PauseMenu.list().map(r => r.id));
/** setTimeout 0 之后才决定开不开：等一小会儿再看 */
const settle = page => page.waitForTimeout(120);

/* 单机：真的 game.html，战斗画面 */
async function battlePage(t) {
  const o = await newPage(t); if (!o) return null;
  await o.page.goto(pathToFileURL(file("game.html")).href);
  await o.page.evaluate(() => { window.__noLevelUpPopup = true; Screens.show("battle"); });
  await o.page.waitForSelector("#g-app .g-top [data-pause-open]");
  return o;
}

test("单机：Esc 没东西可取消时打开暂停页面，再按一次关掉；选着技能时 Esc 先取消技能；输入框里按 Esc 不打开", { timeout: 60000 }, async t => {
  const o = await battlePage(t); if (!o) return; const { page } = o;
  assert.equal(await page.locator("#g-matchup, #r-matchup").count(), 0, "顶栏的克制表按钮去掉了");
  // 开战前（战斗画面）：没东西可取消 → 打开
  await page.keyboard.press("Escape");
  await page.waitForSelector("#pm-overlay", { state: "visible" });
  assert.equal(await page.locator("#pm-title").innerText(), "暂停");
  assert.ok((await menuIds(page)).includes("matchup"), "战斗画面的菜单里有克制表");
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.dataset.pauseItem), (await menuIds(page))[0], "键盘焦点在第一项");
  // 菜单开着时战斗快捷键不响应（F 切演出速度、空格开战 / 结束回合……）
  await page.keyboard.press("f");
  assert.equal(await page.locator("#g-fast").evaluate(e => e.getAttribute("aria-pressed")), "false", "菜单开着：F 不切演出速度");
  await page.focus("#pm-overlay [data-pause-resume]");
  await page.keyboard.press(" ");   // 空格 = 按下焦点所在的「继续」，不是开战
  await page.waitForSelector("#pm-overlay", { state: "hidden" });
  assert.equal(await page.evaluate(() => state.combatStarted), false, "菜单开着：空格不开战");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#pm-overlay", { state: "visible" });
  await page.keyboard.press("Escape");
  await page.waitForSelector("#pm-overlay", { state: "hidden" });
  // 开战，选一个要点目标的技能
  await page.keyboard.press(" ");
  await page.waitForFunction(() => state.combatStarted && state.combatPhase === "player" && GAME.depth === 0, null, { timeout: 20000 });
  const armed = await page.evaluate(() => {
    const sk = (GAME.skillsShown || []).find(s => /_aa$/.test(s.id)) || (GAME.skillsShown || [])[0];
    if (!sk) return null;
    GAME.armSkill(sk);   // 不等它（选完目标才结束）
    return sk.id;
  });
  assert.ok(armed, "有技能可选");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !GAME.arm);
  await settle(page);
  assert.equal(await menuOpen(page), false, "这一下 Esc 用来取消技能，不开菜单");
  // 什么都没选：打开；再按关掉
  await page.keyboard.press("Escape");
  await page.waitForSelector("#pm-overlay", { state: "visible" });
  await page.keyboard.press("Escape");
  await page.waitForSelector("#pm-overlay", { state: "hidden" });
  // 打字时不开
  await page.evaluate(() => { const i = document.createElement("input"); i.id = "pm-test-input"; document.querySelector("#g-app .g-top").appendChild(i); });
  await page.focus("#pm-test-input");
  await page.keyboard.press("Escape");
  await settle(page);
  assert.equal(await menuOpen(page), false, "输入框里按 Esc 不打开");
  // 有面板开着：Esc 关面板，不开菜单
  await page.click("#g-bag");
  await page.waitForSelector("#g-bag-sheet.show");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#g-bag-sheet:not(.show)", { state: "attached" });
  await settle(page);
  assert.equal(await menuOpen(page), false, "Esc 关掉的是背包面板");
  assert.deepEqual(o.errors, []);
});

test("单机：角上的「菜单」按钮也能打开；点「克制表」关掉菜单、打开克制表；点空白 / 「继续」关掉", { timeout: 60000 }, async t => {
  const o = await battlePage(t); if (!o) return; const { page } = o;
  assert.equal(await page.evaluate(() => document.querySelector("#g-app .g-top").firstElementChild.matches("[data-pause-open]")), true, "按钮在顶栏最前面（左上角）");
  await page.click("#g-app .g-top [data-pause-open]");
  await page.waitForSelector("#pm-overlay", { state: "visible" });
  await page.click('#pm-overlay [data-pause-item="matchup"]');
  await page.waitForSelector("#mu-overlay", { state: "visible" });
  assert.equal(await menuOpen(page), false, "点一项：菜单关掉");
  assert.match(await page.locator("#mu-overlay").innerText(), /克制表/);
  await page.keyboard.press("Escape");
  await page.waitForSelector("#mu-overlay", { state: "hidden" });
  await settle(page);
  assert.equal(await menuOpen(page), false, "Esc 关的是克制表，不接着开菜单");
  await page.click("#g-app .g-top [data-pause-open]");
  await page.waitForSelector("#pm-overlay", { state: "visible" });
  await page.click("#pm-overlay [data-pause-resume]");
  await page.waitForSelector("#pm-overlay", { state: "hidden" });
  // 单局画面：顶栏也有按钮；标题画面不能开
  await page.evaluate(() => Screens.show("title"));
  await page.keyboard.press("Escape");
  await settle(page);
  assert.equal(await menuOpen(page), false, "标题画面不开暂停页面");
  assert.equal(await page.locator("#scr-run .run-top [data-pause-open]").count(), 1);
  assert.equal(await page.locator("#scr-trpg .tr-top [data-pause-open]").count(), 1);
  assert.deepEqual(o.errors, []);
});

test("单机：战斗画面的菜单里有「友伤」开关（#428）：默认关，点一下开 / 关、菜单不收起，改的是本机那一个；开着时普通攻击能选队友", { timeout: 60000 }, async t => {
  const o = await battlePage(t); if (!o) return; const { page } = o;
  assert.ok((await menuIds(page)).includes("friendlyFire"), "战斗画面的菜单里有友伤开关");
  await page.click("#g-app .g-top [data-pause-open]");
  await page.waitForSelector("#pm-overlay", { state: "visible" });
  const item = '#pm-overlay [data-pause-item="friendlyFire"]';
  assert.match(await page.locator(item).innerText(), /友伤 关/);
  assert.equal(await page.locator(item).getAttribute("aria-pressed"), "false", "默认关");
  await page.click(item);
  assert.equal(await menuOpen(page), true, "开关这一类：点了菜单不收起");
  assert.match(await page.locator(item).innerText(), /友伤 开/);
  assert.equal(await page.locator(item).getAttribute("aria-pressed"), "true");
  assert.deepEqual(await page.evaluate(() => state.friendlyFire), { local: true }, "本机：一个开关管全队");
  // 开着：普通攻击的目标名单里有队友（自己除外）
  const picks = await page.evaluate(() => {
    const a = state.units.find(u => u.isPlayer && !u.hidden), mate = state.units.find(u => u.isPlayer && !u.hidden && u !== a);
    a.zone = mate.zone = 1;
    const sk = GAME.gameSkills(a).find(s => /_aa$/.test(s.id) && (s.id === "tou_aa" || s.id === "kolt_aa" || s.id === "xia_aa" || s.id === "chuan_aa" || s.id === "hiaki_aa" || s.id === "ecmo_bite")) ||
      { id: "bare_aa", name: "空手攻击", hint: "同区" };
    const ids = GAME.candidateUnits(a, sk).map(u => u.id);
    return { self: ids.includes(a.id), mate: ids.includes(mate.id) };
  });
  assert.equal(picks.mate, true, "开着：同区的队友能选"); assert.equal(picks.self, false, "不能选自己");
  await page.click(item);
  assert.deepEqual(await page.evaluate(() => state.friendlyFire), { local: false }, "再点一下：关");
  assert.match(await page.locator(item).innerText(), /友伤 关/);
  // 标题画面不显示（只有战斗中才有）
  await page.keyboard.press("Escape");
  await page.evaluate(() => Screens.show("run"));
  assert.ok(!(await menuIds(page)).includes("friendlyFire"), "不在战斗画面：没有友伤开关");
  assert.deepEqual(o.errors, []);
});

/* 联机：和 online-ui.test.js 一样的假房间（不带规则），加上主持人工具、克制表浮层 */
async function onlinePage(t, mobile) {
  const o = await newPage(t, mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : null); if (!o) return null;
  const { page } = o;
  // 先到一个本地文件的地址：about:blank 不让读写 localStorage（右侧栏收起要记在本机）
  await page.goto(pathToFileURL(file("pause-menu.css")).href);
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body><section id="scr-title"><div class="t-menu"></div></section><main class="g-app">Original host battlefield</main></body>');
  for (const f of ["game.css", "skin.css", "online.css", "online-gm-ui.css", "workshop.css", "matchup.css", "pause-menu.css"]) await page.addStyleTag({ path: file(f) });
  await page.evaluate(() => {
    // 真的页面里玩家顶上有热座栏（hotseat-ui.js 量出来写进 --hs-top-height），「菜单」按钮在热座栏里，右侧栏在它下面
    document.body.style.setProperty("--hs-top-height", "56px");
    const players = [{ id: "gm", name: "主持人", gm: true, online: true }, { id: "p1", name: "甲", online: true }, { id: "p2", name: "乙", online: true }];
    const unit = (id, name, isPlayer, zone) => ({ id, name, isPlayer, zone, level: 1, ap: 2, apMax: 2, bonus: 1, bonusMax: 1, def: 6, defMax: 6, layers: [{ type: "flesh", current: 30, max: 35 }], statuses: {}, resources: {} });
    const state = { displayOnly: true, units: [unit("a", "红玉", true, 1), unit("b", "绯秋", true, 1), unit("enemy", "敌人", false, 2)], turnNo: 1, zoneMode: 2, weather: "none", props: [], fields: { 1: {}, 2: {} }, gaps: {} };
    const heroes = [{ id: "a", name: "红玉", owner: "p1" }, { id: "b", name: "绯秋", owner: "p2" }];
    const chart = { weather: "none", weatherName: "常态", cols: [{ id: "flesh", name: "生命" }], rows: [{ id: "fire", name: "火" }], cells: [[{ kindId: "adv", value: 0.5, base: 0.5 }]], notes: [] };
    window.fixture = { calls: [], listeners: [], packets: [], view: { active: false, isHost: false, identity: null, status: { connected: true, hostOnline: true, paused: false, roster: players }, screen: "lobby", roomCode: "ABCD23", players, state, heroes, messages: [], matchup: chart, mode: "trpg",
      packet: { view: { mode: "trpg", playerId: "p1", hostId: "gm", units: heroes, heroes, phase: "acting", currentUnitId: "a", order: [], chat: [] }, state, publicLogs: [{ text: "红玉 · 普通攻击" }] } },
      emit() { this.listeners.forEach(fn => fn()); }, set(data) { Object.assign(this.view, data); this.emit(); } };
    const record = (kind, args) => { fixture.calls.push({ kind, args: args == null ? null : JSON.parse(JSON.stringify(args)) }); return { ok: true }; };
    window.OnlineGame = {
      getView: () => JSON.parse(JSON.stringify(fixture.view)), slots: () => [], hasSaved: () => false,
      submit(cmd) { return record("submit", cmd); }, reconnect() { return record("reconnect"); }, leave() { record("leave"); fixture.set({ active: false }); },
      assign(opts) { return record("assign", opts); },
      async actionMenu(request) {
        const base = { type: "actionOptions", displayOnly: true, actor: request.actor, skill: request.skill };
        if (!request.skill) return { ...base, choices: { kind: "skill", options: [{ value: "ruby_aa", label: "普通攻击" }] } };
        if (!request.target) return { ...base, choices: { kind: "unit", key: "target", title: "选择目标", options: [{ value: "enemy", label: "敌人" }] } };
        return { ...base, choices: { kind: "ready", title: "确认执行", command: { type: "skill", actor: request.actor, skill: request.skill, target: request.target, picks: {} }, options: [] } };
      },
      subscribe(fn) { fixture.listeners.push(fn); return () => { fixture.listeners = fixture.listeners.filter(f => f !== fn); }; },
      onPacket(fn) { fixture.packets.push(fn); return () => { fixture.packets = fixture.packets.filter(f => f !== fn); }; }
    };
  });
  for (const f of ["hud-icons.js", "unit-card.js", "unit-tip.js", "online-battle.js", "pause-menu.js", "matchup-ui.js", "online-gm-ui.js", "online-ui.js"]) await page.addScriptTag({ path: file(f) });
  await page.evaluate(() => { window.gmTools = OnlineGMUI.mount(OnlineGame); });
  return o;
}
const asPlayer = (page, patch) => page.evaluate(patch => fixture.set(Object.assign({ active: true, isHost: false, identity: { id: "p1" }, screen: "battle" }, patch || {})), patch || {});
const asHost = (page, patch) => page.evaluate(patch => fixture.set(Object.assign({ active: true, isHost: true, identity: { id: "gm" }, screen: "exploration" }, patch || {})), patch || {});
const say = (page, id, from, text) => page.evaluate(([id, from, text]) => { const v = fixture.view.packet.view; v.chat = [...(v.chat || []), { id, operatorId: from, name: from, text }]; fixture.emit(); }, [id, from, text]);
async function pick(page, id) {
  if (!(await menuOpen(page))) await page.click("#ol-menu-open");
  await page.waitForSelector("#pm-overlay", { state: "visible" });
  await page.click(`#pm-overlay [data-pause-item="${id}"]`);
  await page.waitForSelector("#pm-overlay", { state: "hidden" });
}

test("联机：主持人和玩家看到的菜单项不同；标题写「菜单」并说明不会真的暂停；原来的按钮都不在了", { timeout: 60000 }, async t => {
  const o = await onlinePage(t); if (!o) return; const { page } = o;
  await asHost(page);
  assert.deepEqual(await menuIds(page), ["gmTools", "assign", "room", "lobby", "leave"], "主持人（探索）：主持人工具、角色分配、消息与成员、大厅");
  await page.evaluate(() => fixture.set({ screen: "battle" }));
  assert.deepEqual(await menuIds(page), ["gmTools", "room", "lobby", "leave"], "主持人（战斗）：没有角色分配");
  await asPlayer(page);
  assert.deepEqual(await menuIds(page), ["matchupOnline", "friendlyFireOnline", "room", "lobby", "leave"], "玩家（战斗）：克制表、友伤开关（#428）、消息与成员、大厅；没有主持人工具");
  await asPlayer(page, { screen: "exploration" });
  assert.deepEqual(await menuIds(page), ["room", "lobby", "leave"], "玩家（探索）：没有克制表");
  await page.click("#ol-menu-open");
  await page.waitForSelector("#pm-overlay", { state: "visible" });
  assert.equal(await page.locator("#pm-title").innerText(), "菜单");
  assert.match(await page.locator("#pm-overlay .pm-note").innerText(), /联机不会暂停/);
  assert.equal(await page.locator('#pm-overlay [data-pause-item="gmTools"]').count(), 0, "玩家看不到主持人工具");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#pm-overlay", { state: "hidden" });
  assert.equal(await page.locator('#ogm-toggle, #ol-room-open, [data-online="openRoom"], [data-online="openAssign"], [data-online="matchup"]').count(), 0, "原来的按钮去掉了");
  assert.equal(await page.locator("#online-dock button").count(), 1, "右上角只剩「房间码 · 菜单」");
  assert.equal(await page.locator("#online-dock .ol-dock-label").innerText(), "ABCD23 · 菜单");
  assert.deepEqual(o.errors, []);
});

test("联机：从菜单打开主持人工具、消息与成员、大厅、角色分配、克制表，和以前点原来的按钮一样", { timeout: 60000 }, async t => {
  const o = await onlinePage(t); if (!o) return; const { page } = o;
  await asHost(page);
  await pick(page, "gmTools");
  await page.waitForSelector("#ogm-panel", { state: "visible" });
  assert.match(await page.locator("#ogm-panel h2").innerText(), /主持人工具/);
  await page.click('#ogm-panel [data-action="close"]');
  await page.waitForSelector("#ogm-panel", { state: "detached" });
  await pick(page, "room");
  await page.waitForSelector("#online-panel", { state: "visible" });
  assert.match(await page.locator("#online-panel").innerText(), /房间成员/);
  assert.match(await page.locator("#online-panel").innerText(), /消息/);
  await page.click('#online-panel [data-online="close"]');
  await page.waitForSelector("#online-panel", { state: "hidden" });
  await pick(page, "assign");
  await page.waitForSelector("#ol-assign-head", { state: "visible" });
  await page.click('#online-panel [data-online="close"]');
  // 大厅：开局以后照样能看大厅那张卡和大厅交流
  await say(page, "c1", "p1", "大家好");
  await pick(page, "lobby");
  await page.waitForSelector("#online-panel .ol-lobby-chat", { state: "visible" });
  const lobby = await page.locator("#online-panel").innerText();
  assert.match(lobby, /大厅/); assert.match(lobby, /房间成员/); assert.match(lobby, /大厅交流/); assert.match(lobby, /大家好/);
  assert.doesNotMatch(lobby, /查看更早消息|回复主持人/, "大厅那张卡不带私信");
  await page.fill("#ol-lobby-text", "收到"); await page.click('#ol-lobby-chat button[type="submit"]');
  await page.waitForFunction(() => fixture.calls.some(c => c.kind === "submit" && c.args.type === "chat" && c.args.text === "收到"));
  await page.click('#online-panel [data-online="close"]');
  await page.waitForSelector("#online-panel", { state: "hidden" });
  // 再从菜单打开「消息与成员」：回到房间面板，不是大厅
  await pick(page, "room");
  await page.waitForSelector("#ol-message-form", { state: "visible" });
  await page.click('#online-panel [data-online="close"]');
  // 玩家：克制表
  await asPlayer(page);
  await pick(page, "matchupOnline");
  await page.waitForSelector("#mu-overlay", { state: "visible" });
  assert.match(await page.locator("#mu-overlay").innerText(), /克制表/);
  assert.doesNotMatch(await page.locator("#mu-overlay").innerText(), /坚毅/);
  assert.deepEqual(o.errors, []);
});

test("联机玩家：菜单里的「友伤」改自己的那一个（发给房主）；开没开看房主发来的 state.friendlyFire；主持人用单机那一项", { timeout: 60000 }, async t => {
  const o = await onlinePage(t); if (!o) return; const { page } = o;
  await asPlayer(page);
  await page.click("#ol-menu-open");
  await page.waitForSelector("#pm-overlay", { state: "visible" });
  const item = '#pm-overlay [data-pause-item="friendlyFireOnline"]';
  assert.match(await page.locator(item).innerText(), /友伤 关/, "房主没发过：默认关");
  await page.click(item);
  await page.waitForFunction(() => fixture.calls.some(c => c.kind === "submit" && c.args.type === "battle.friendlyFire"));
  const sent = await page.evaluate(() => fixture.calls.filter(c => c.kind === "submit" && c.args.type === "battle.friendlyFire").map(c => c.args));
  assert.deepEqual(sent, [{ type: "battle.friendlyFire", on: true }], "只发开 / 关，不带别人的名字（房主按发指令的人记）");
  assert.equal(await menuOpen(page), true, "开关这一类：菜单不收起");
  // 房主发来的新状态：自己开着、别人关着
  await page.evaluate(() => { fixture.view.state = Object.assign({}, fixture.view.state, { friendlyFire: { p1: true, p2: false } }); fixture.emit(); });
  await page.waitForFunction(sel => /友伤 开/.test((document.querySelector(sel) || {}).textContent || ""), item);
  assert.equal(await page.locator(item).getAttribute("aria-pressed"), "true");
  assert.match(await page.locator(item).innerText(), /现在开着友伤的：你/, "说明里写谁开着");
  await page.evaluate(() => { fixture.view.state = Object.assign({}, fixture.view.state, { friendlyFire: { p1: false, p2: true } }); fixture.emit(); });
  await page.waitForFunction(sel => /友伤 关/.test((document.querySelector(sel) || {}).textContent || ""), item);
  assert.match(await page.locator(item).innerText(), /现在开着友伤的：乙/, "别人开着也看得到");
  await page.keyboard.press("Escape");
  await asPlayer(page, { screen: "exploration" });
  assert.ok(!(await menuIds(page)).includes("friendlyFireOnline"), "战斗外没有");
  await asHost(page, { screen: "battle" });
  assert.ok(!(await menuIds(page)).includes("friendlyFireOnline"), "主持人用单机那一项（game.js 登记），这里不重复");
  assert.deepEqual(o.errors, []);
});

test("联机：敌人等主持人手动操作时菜单里写「敌人待操作 · 主持人工具」，「菜单」按钮挂「!」；私信未读的数字照旧挂在按钮上", { timeout: 60000 }, async t => {
  const o = await onlinePage(t); if (!o) return; const { page } = o;
  await asHost(page, { screen: "battle" });
  assert.equal(await page.locator("#ol-menu-open .pm-dot").count(), 0);
  await page.evaluate(() => fixture.set({ manualPhase: true }));
  assert.equal(await page.locator("#ol-menu-open .pm-dot").innerText(), "!");
  await page.click("#ol-menu-open");
  assert.match(await page.locator('#pm-overlay [data-pause-item="gmTools"]').innerText(), /敌人待操作 · 主持人工具/);
  await page.keyboard.press("Escape");
  await page.evaluate(() => fixture.set({ manualPhase: false, messages: [{ id: "m1", from: "p1", to: "gm", text: "我到了" }] }));
  assert.equal(await page.locator("#ol-menu-open .pm-dot").innerText(), "1", "玩家的回复：按钮上红点 1");
  await page.click("#ol-menu-open");
  assert.equal(await page.locator('#pm-overlay [data-pause-item="room"] .pm-dot').innerText(), "1", "「消息与成员」那一项上也是 1");
  await page.click('#pm-overlay [data-pause-item="room"]');
  await page.waitForSelector("#online-panel", { state: "visible" });
  await page.waitForFunction(() => !document.querySelector("#ol-menu-open .pm-dot"));
  assert.deepEqual(o.errors, []);
});

test("联机玩家：Esc 先取消选中的技能；没东西可取消时才打开、再按关掉；聊天框里按 Esc 不打开；开着房间面板时 Esc 关面板", { timeout: 60000 }, async t => {
  const o = await onlinePage(t); if (!o) return; const { page } = o;
  await asPlayer(page);
  await page.waitForSelector('.ol-battle [data-ob-skill="ruby_aa"]');
  await page.click('[data-ob-skill="ruby_aa"]');
  await page.waitForSelector('.unit-wrap[data-unit-id="enemy"].is-targetable');
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".unit-wrap.is-targetable"));
  await settle(page);
  assert.equal(await menuOpen(page), false, "这一下 Esc 用来取消技能");
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("Escape");
  await page.waitForSelector("#pm-overlay", { state: "visible" });
  await page.keyboard.press("Escape");
  await page.waitForSelector("#pm-overlay", { state: "hidden" });
  // 聊天框里
  await page.click('#online-side [data-side="chat"]');
  await page.focus("#ol-side-text");
  await page.keyboard.press("Escape");
  await settle(page);
  assert.equal(await menuOpen(page), false, "打字的时候 Esc 不打开");
  // 房间面板开着：Esc 关面板（从菜单打开时焦点交给面板，Esc 由面板自己关）
  await pick(page, "room");
  await page.waitForSelector("#online-panel", { state: "visible" });
  assert.equal(await page.evaluate(() => document.getElementById("online-panel").contains(document.activeElement)), true, "焦点在房间面板里");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#online-panel", { state: "hidden" });
  await settle(page);
  assert.equal(await menuOpen(page), false, "Esc 关的是房间面板");
  // 联机不会真的暂停：轮到自己回应询问时菜单自动收起
  await page.click("#ol-menu-open");
  await page.waitForSelector("#pm-overlay", { state: "visible" });
  await page.evaluate(() => { fixture.view.packet.view.ask = { id: "ask1", kind: "block", eligible: true, declined: false, options: [] }; fixture.emit(); });
  await page.waitForSelector("#pm-overlay", { state: "hidden" });
  assert.deepEqual(o.errors, []);
});

test("联机玩家右侧栏：能收起 / 展开，收起后战斗画面变宽；状态记在这台电脑上；收起时小队来了新消息按钮上有数字", { timeout: 60000 }, async t => {
  const o = await onlinePage(t); if (!o) return; const { page } = o;
  await asPlayer(page);
  await page.waitForSelector("#online-side [data-side-collapse]", { state: "visible" });
  const stageWidth = () => page.evaluate(() => document.getElementById("online-stage").getBoundingClientRect().width);
  const before = await stageWidth();
  assert.equal(await page.locator("#online-side [data-side-collapse]").evaluate(e => e.getAttribute("aria-expanded")), "true");
  await page.click("#online-side [data-side-collapse]");
  await page.waitForFunction(() => document.getElementById("online-side").classList.contains("ol-side-collapsed"));
  const after = await stageWidth();
  assert.ok(after > before + 200, `收起后战斗画面变宽：${before} → ${after}`);
  assert.equal(await page.isVisible("#online-side .ol-side-log"), false, "收起后记录、聊天都藏起来");
  assert.equal(await page.isVisible("#online-side [data-side-collapse]"), true, "只剩展开按钮");
  assert.equal(await page.evaluate(() => localStorage.getItem("backfire.online.sideCollapsed")), "1");
  // 收起时：别人在小队里说话 → 按钮上 1；自己说的不算
  await say(page, "c1", "p2", "我先上");
  await say(page, "c2", "p1", "好");
  assert.equal(await page.locator("#online-side .ol-side-collapse-dot").innerText(), "1");
  assert.equal(await page.isVisible("#online-side .ol-side-collapse-dot"), true);
  // 重新进页面（重新挂一次界面）：还是收着
  await page.evaluate(() => { OnlineUI.mount(OnlineGame); });
  await page.waitForFunction(() => document.getElementById("online-side").classList.contains("ol-side-collapsed"));
  assert.ok(await stageWidth() > before + 200, "记住了：重新进来还是收着");
  // 展开：切到小队频道看到消息，提示消失
  await page.click("#online-side [data-side-collapse]");
  await page.waitForFunction(() => !document.getElementById("online-side").classList.contains("ol-side-collapsed"));
  assert.equal(await page.evaluate(() => localStorage.getItem("backfire.online.sideCollapsed")), "0");
  assert.ok(Math.abs(await stageWidth() - before) < 2, "展开后宽度回去");
  assert.equal(await page.isVisible("#online-side .ol-side-collapse-dot"), false);
  // 本机存不了（隐私模式 / 存储满了）：照样能收起，不报错
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("QuotaExceededError"); }; });
  await page.click("#online-side [data-side-collapse]");
  await page.waitForFunction(() => document.getElementById("online-side").classList.contains("ol-side-collapsed"));
  assert.deepEqual(o.errors, []);
});

test("联机玩家（手机）：右侧栏在底部，照旧用「展开 / 收起」，没有电脑上的收起按钮；「菜单」按钮在右上角能点开", { timeout: 60000 }, async t => {
  const o = await onlinePage(t, true); if (!o) return; const { page } = o;
  await asPlayer(page, { screen: "exploration" });
  assert.equal(await page.isVisible("#online-side [data-side-collapse]"), false);
  assert.equal(await page.isVisible("#online-side [data-side-fold]"), true);
  const box = await page.evaluate(() => { const r = document.getElementById("ol-menu-open").getBoundingClientRect(); return { top: r.top, right: r.right, w: innerWidth }; });
  assert.ok(box.top < 60 && box.right <= box.w, "右上角：" + JSON.stringify(box));
  await page.click("#ol-menu-open");
  await page.waitForSelector("#pm-overlay", { state: "visible" });
  await page.click('#pm-overlay [data-pause-item="room"]');
  await page.waitForSelector("#online-panel", { state: "visible" });
  assert.deepEqual(o.errors, []);
});
