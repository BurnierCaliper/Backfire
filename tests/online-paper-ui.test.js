// 联机玩家战斗画面的「纸片风」界面（#308，online-paper.js / online-paper.css）——要浏览器的那部分：
//   · 联机玩家开着新画面时是新排版（战场铺满、顶栏、吊牌、左上角队伍、底下技能栏、右边缘的抽屉标签），关着新画面 / 主持人还是原样
//   · 各块能收起 / 展开、状态记在本机（重新挂一次界面还是那样），收着时小队来了新消息挂数字
//   · 「工具 ▾」下拉里的每一项和原来舞台顶上那一排的按钮是同一个（同一个 data-online、打开同一个浮层），原来那排不在了；点完收起
//   · 吊牌上的 ⇅ 点开「延后 / 换位」：点的就是热座栏原来的按钮（发同样的 orderMove、进同样的换位状态）
//   · 新加的 DOM 里没有坚毅生命的数字
// 用 Playwright；没装 Playwright 时在 Linux 上用机器自带的 Chrome（tests/cdp-browser.js），都没有就跳过。
// 新画面的 3D 场景要 WebGL：这里换成一个假的 HD2DField（attach / detach / 开关 / 镜头按钮照 hd2d/hd2d-field.js 的样子），技能栏、队伍栏的外壳用真的 hd2d-shell.js。
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

/** 一位联机玩家（p1，操控红玉）的页面：假房间（同 pause-menu.test.js）+ 热座栏（hotseat-ui.js）+ 假的新画面 */
async function paperPage(t, opt) {
  opt = opt || {};
  if (!browser) { t.skip(skipWhy); return null; }
  const context = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 } }, opt.context || {}));
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  // 先到一个本地文件的地址：about:blank 不让读写 localStorage（各块的收起状态记在本机）
  await page.goto(pathToFileURL(file("online-paper.css")).href);
  // 字体照 game.html 加载 fonts/fonts.css（标题、名字、模板字……量出来的宽度和真画面一样）
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="' + pathToFileURL(file("fonts/fonts.css")).href + '"><body><section id="scr-title"><div class="t-menu"></div></section><main class="g-app" id="g-app"><header class="g-top"><button id="g-hd2d-toggle" type="button">新画面 关</button></header>单机的战斗画面</main></body>');
  for (const f of ["game.css", "skin.css", "hotseat.css", "online.css", "online-gm-ui.css", "workshop.css", "matchup.css", "pause-menu.css", "hd2d/hd2d.css", "online-paper.css"]) await page.addStyleTag({ path: file(f) });
  await page.evaluate(([shp, shpMax, on]) => {
    if (on) localStorage.setItem("backfire-hd2d-field", "on");
    const players = [{ id: "gm", name: "主持人", gm: true, online: true }, { id: "p1", name: "甲", online: true }, { id: "p2", name: "乙", online: true }];
    // 房主那边漏过来的坚毅生命（不该出现在任何新画面里）：投影过的包本来没有，这里故意塞上看新加的 DOM 碰不碰
    const unit = (id, name, isPlayer, zone, kit) => ({ id, name, kit, isPlayer, zone, level: 2, ap: 2, apMax: 2, bonus: 1, bonusMax: 1, def: 6, defMax: 6, shp, shpMax,
      layers: [{ type: "flesh", current: 30, max: 35 }], statuses: {}, resources: {} });
    const state = { displayOnly: true, units: [unit("a", "红玉", true, 1, "ruby"), unit("b", "绯秋", true, 1, "hiaki"), unit("enemy", "狂徒", false, 2, "thug_hammer")], turnNo: 3, zoneMode: 2, weather: "none", light: "day", props: [], fields: { 1: {}, 2: {} }, gaps: {} };
    const heroes = [{ id: "a", name: "红玉", owner: "p1" }, { id: "b", name: "绯秋", owner: "p2" }];
    const order = [{ actor: "a", owner: "p1", current: true }, { actor: "b", owner: "p2" }];
    window.fixture = { calls: [], listeners: [], packets: [], view: { active: false, isHost: false, identity: null, status: { connected: true, hostOnline: true, paused: false, roster: players }, screen: "lobby", roomCode: "SA3X7C", players, state, heroes, messages: [], mode: "trpg",
      packet: { mode: "trpg", clock: { day: 1, clock: 480, hours: 2 }, view: { mode: "trpg", playerId: "p1", hostId: "gm", units: heroes, heroes, phase: "acting", currentUnitId: "a", order, players, chat: [], checks: [], checkRequests: [] }, state, publicLogs: [{ text: "红玉 · 普通攻击 → 狂徒 12" }], quests: [] } },
      emit() { this.listeners.forEach(fn => fn()); }, set(data) { Object.assign(this.view, data); this.emit(); } };
    const record = (kind, args) => { fixture.calls.push({ kind, args: args == null ? null : JSON.parse(JSON.stringify(args)) }); return { ok: true }; };
    window.OnlineGame = {
      getView: () => JSON.parse(JSON.stringify(fixture.view)), slots: () => [], hasSaved: () => false,
      submit(cmd) { return record("submit", cmd); }, reconnect() { return record("reconnect"); }, leave() { record("leave"); fixture.set({ active: false }); },
      async sheetData() { record("sheetData"); return { sheets: [], armory: [], battles: [] }; },
      async actionMenu(request) {
        const base = { type: "actionOptions", displayOnly: true, actor: request.actor, skill: request.skill };
        if (!request.skill) return { ...base, choices: { kind: "skill", options: [{ value: "ruby_aa", label: "普通攻击", cost: "行动 1" }, { value: "__move", label: "移动", cost: "附赠 1" }] } };
        if (!request.target) return { ...base, choices: { kind: "unit", key: "target", title: "选择目标", options: [{ value: "enemy", label: "狂徒" }] } };
        return { ...base, choices: { kind: "ready", title: "确认执行", command: { type: "skill", actor: request.actor, skill: request.skill, target: request.target, picks: {} }, options: [] } };
      },
      subscribe(fn) { fixture.listeners.push(fn); return () => { fixture.listeners = fixture.listeners.filter(f => f !== fn); }; },
      onPacket(fn) { fixture.packets.push(fn); return () => { fixture.packets = fixture.packets.filter(f => f !== fn); }; }
    };
    window.WorldMap = { open(o) { window.__mapOpened = o; } };
    // 假的新画面（照 hd2d/hd2d-field.js 的 attach / detach：开关挪进 spec.slot()、建好时战场里铺一层、镜头按钮、给 .g-hud 换上 hd2d-shell.js 的外壳）
    window.HD2DField = (() => {
      let spec = null, want = localStorage.getItem("backfire-hd2d-field") === "on", built = null;
      const toggle = document.getElementById("g-hd2d-toggle");
      const paintToggle = () => { toggle.textContent = want ? "新画面 开" : "新画面 关"; toggle.setAttribute("aria-pressed", String(want)); };
      toggle.addEventListener("click", () => F.switchTo(want ? "old" : "new"));
      const place = () => { const s = spec && spec.slot(); if (s && toggle.parentNode !== s) s.appendChild(toggle); };
      function build() {
        if (built || !spec || !want) return;
        const field = spec.field(), app = spec.app(); if (!field || !app) return;
        const stage = document.createElement("div"); stage.className = "hd2d-field hd2d-theme";
        stage.innerHTML = '<div class="hd2d-cam"><button type="button" class="hd2d-cam-b on">远</button><button type="button" class="hd2d-cam-b">中</button><button type="button" class="hd2d-cam-b">近</button><span class="hd2d-cam-z"></span></div>';
        stage.querySelectorAll(".hd2d-cam-b").forEach((b, i, all) => b.addEventListener("click", () => { all.forEach(x => x.classList.toggle("on", x === b)); F.tier = i; }));
        stage.addEventListener("click", e => e.stopPropagation());
        field.appendChild(stage); app.classList.add("hd2d-on");
        const hud = app.querySelector(".g-hud"); HD2DShell.attach(hud, { storage: localStorage });
        built = { stage, hud }; spec.refresh();
      }
      function teardown() { if (!built) return; built.stage.remove(); HD2DShell.detach(built.hud); if (spec && spec.app()) spec.app().classList.remove("hd2d-on"); built = null; }
      const handle = { on: () => !!built, view() { place(); }, actor() {}, marks() {}, play: () => null, skip() {} };
      const F = {
        tier: 0, packetView: () => null,
        attach(s) { if (spec === s) return handle; spec = s; place(); build(); return handle; },
        detach(s) { teardown(); spec = null; return true; },
        switchTo(to) { want = to === "new"; localStorage.setItem("backfire-hd2d-field", want ? "on" : "off"); paintToggle(); if (want) build(); else { teardown(); if (spec) spec.refresh(); } return true; }
      };
      paintToggle();
      return F;
    })();
  }, [SHP, SHP_MAX, opt.on !== false]);
  for (const f of ["icons.js", "hud-icons.js", "unit-card.js", "unit-tip.js", "daylight.js", "party-cards.js", "hotseat-ui.js", "online-battle.js", "pause-menu.js", "matchup-ui.js",
    "lore-ui.js", "check-request-ui.js", "hd2d/hd2d-ui.js", "hd2d/hd2d-shell.js", "online-paper.js", "online-ui.js"]) await page.addScriptTag({ path: file(f) });
  // 热座栏：和 online-game.js · mountOrder 一样，玩家看的是收到的包里的 view
  await page.evaluate(() => {
    window.hotseat = HotseatUI.mount({ getView: () => Object.assign({}, fixture.view.packet.view, { enabled: !!fixture.view.active && fixture.view.screen === "battle", configured: true, network: true, canConfigure: false, canDisable: false }),
      submit: cmd => OnlineGame.submit(cmd), subscribe: fn => { fixture.listeners.push(fn); return () => {}; } });
  });
  return { page, errors, context };
}
const asPlayer = (page, patch) => page.evaluate(patch => fixture.set(Object.assign({ active: true, isHost: false, identity: { id: "p1" }, screen: "battle" }, patch || {})), patch || {});
const asHost = (page, patch) => page.evaluate(patch => fixture.set(Object.assign({ active: true, isHost: true, identity: { id: "gm" }, screen: "battle" }, patch || {})), patch || {});
const say = (page, id, from, text) => page.evaluate(([id, from, text]) => { const v = fixture.view.packet.view; v.chat = [...(v.chat || []), { id, operatorId: from, name: from === "p1" ? "甲" : "乙", text }]; fixture.emit(); }, [id, from, text]);
const paperOn = page => page.evaluate(() => document.body.classList.contains("ol-paper"));
const rect = (page, sel) => page.evaluate(sel => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, vw: innerWidth, vh: innerHeight }; }, sel);
const settle = page => page.waitForTimeout(80);

test("联机玩家开着新画面：战场铺满；顶上一条写联机跑团 · 房间码 · 第 N 回合 · 时间 · 天气，右边镜头 / 工具 / 菜单；吊牌挂在顶栏下面；队伍在左上角、技能栏在底下、记录 / 聊天收成右边缘的竖标签", { timeout: 60000 }, async t => {
  const o = await paperPage(t); if (!o) return; const { page } = o;
  await asPlayer(page);
  await page.waitForFunction(() => document.body.classList.contains("ol-paper"));
  await page.waitForSelector("#online-paper .olp-top", { state: "visible" });
  await settle(page);
  // 战场铺满整个画面
  const st = await rect(page, "#online-stage"), field = await rect(page, ".ol-battle .g-field");
  assert.deepEqual([st.left, st.top, st.width, st.height], [0, 0, st.vw, st.vh], "联机舞台铺满");
  assert.deepEqual([Math.round(field.width), Math.round(field.height)], [st.vw, st.vh], "战场那一格铺满");
  // 顶栏
  const top = await page.locator("#online-paper .olp-top").innerText();
  assert.match(top.replace(/\s+/g, " "), /联机跑团 SA3X7C 第 3 回合 第 1 天 · 08:00 上午 常态/);
  assert.equal(await page.locator("#online-paper .olp-cam-b").count(), 3, "镜头远 / 中 / 近");
  assert.ok(await page.isVisible('#online-paper [data-olp="tools"]'));
  assert.ok(await page.isVisible("#online-paper [data-pause-open]"), "菜单按钮");
  const bar = await rect(page, "#online-paper .olp-top");
  assert.ok(bar.top < 12 && bar.left < 20 && bar.right > bar.vw - 20, "顶上一条横贯：" + JSON.stringify(bar));
  // 原来的热座栏、「房间码 · 菜单」、舞台顶上那一排按钮都不在了（不留两份）
  assert.equal(await page.isVisible("#hotseat-root"), false, "热座栏让开");
  assert.equal(await page.isVisible("#online-dock"), false, "「房间码 · 菜单」换成顶栏的「菜单」");
  assert.equal(await page.locator("#online-stage .ol-stage-heading, #online-stage .ol-info-tools").count(), 0, "原来那一排按钮去掉");
  // 吊牌：挂在顶栏下面中间；当前的高亮；自己的带 ⇅
  const tags = await rect(page, "#online-paper .olp-tags");
  assert.ok(tags.top >= bar.bottom - 8 && tags.top < bar.bottom + 20 && Math.abs((tags.left + tags.right) / 2 - tags.vw / 2) < 4, "吊牌在顶栏下面中间：" + JSON.stringify(tags));
  assert.equal(await page.locator("#online-paper .olp-tag").count(), 2);
  assert.match(await page.locator("#online-paper .olp-tag.on").innerText(), /红玉[\s\S]*甲/);
  assert.equal(await page.locator('#online-paper .olp-tag.mine [data-olp-swap]').count(), 1, "自己的角色带 ⇅");
  assert.equal(await page.locator('#online-paper .olp-tag:not(.mine) [data-olp-swap]').count(), 0, "队友的没有");
  // 左上角队伍（下面角色资料 / 武器 / 背包）
  const party = await rect(page, ".hd2d-party");
  assert.ok(party.left < 30 && party.top > bar.bottom && party.top < 160, "队伍在左上角：" + JSON.stringify(party));
  assert.deepEqual(await page.locator(".hd2d-party .olp-party-tools [data-online]").evaluateAll(els => els.map(e => e.dataset.online + ":" + e.dataset.info)), ["info:sheet", "info:armory", "info:bag"]);
  // 底下技能栏
  const dock = await rect(page, ".ol-battle > .g-hud");
  assert.ok(dock.bottom > dock.vh - 30 && Math.abs((dock.left + dock.right) / 2 - dock.vw / 2) < 4 && dock.width < dock.vw - 40, "技能栏浮在底下中间：" + JSON.stringify(dock));
  assert.ok(await page.isVisible('.ol-battle [data-ob-skill="ruby_aa"]'), "技能照旧（同一个按钮）");
  assert.match(await page.locator(".ol-battle .hd2d-dock-row").innerText(), /轮到你了/);
  // 右边：平时只剩右边缘的竖标签
  assert.equal(await page.evaluate(() => document.getElementById("online-side").classList.contains("ol-side-collapsed")), true, "抽屉平时收着");
  const tab = await rect(page, "#online-side");
  assert.ok(tab.right >= tab.vw - 1 && tab.width <= 44, "右边缘一个竖标签：" + JSON.stringify(tab));
  assert.match(await page.locator("#online-side [data-side-collapse]").innerText(), /记录 · 聊天/);
  // 技能栏里一行一行往下排：最上面「技能 ▼ · 谁 · 轮到你了」，下面技能那一排，再下面提示
  const rows = await page.evaluate(() => [".hd2d-dock-row", ".hud-row", ".hint"].map(s => Math.round(document.querySelector(".ol-battle > .g-hud > " + s).getBoundingClientRect().top)));
  assert.ok(rows[0] < rows[1] && rows[1] < rows[2], "技能栏从上往下排：" + rows);
  await shot(page, "paper-step1-open");
  assert.deepEqual(o.errors, []);
});

test("新画面关着、主持人：还是原来的排版（没有 .ol-paper、热座栏 / 舞台顶上那一排 / 「房间码 · 菜单」都在）；关掉新画面就回去，再开又是纸片画面", { timeout: 60000 }, async t => {
  const o = await paperPage(t, { on: false }); if (!o) return; const { page } = o;
  await asPlayer(page);
  await page.waitForSelector("#online-stage .ol-stage-heading .ol-info-tools", { state: "visible" });
  await settle(page);
  assert.equal(await paperOn(page), false, "新画面关着：照旧");
  assert.equal(await page.isVisible("#online-paper"), false);
  assert.equal(await page.locator("#online-paper *").count(), 0, "纸片画面的东西一个都没画");
  assert.ok(await page.isVisible("#hotseat-root"));
  assert.ok(await page.isVisible("#online-dock"));
  assert.equal(await page.locator("#online-stage .ol-info-tools #g-hd2d-toggle").count(), 1, "新画面开关在原来那一排里");
  // 打开新画面：换成纸片画面，开关跟着进了「工具 ▾」
  await page.click("#g-hd2d-toggle");
  await page.waitForFunction(() => document.body.classList.contains("ol-paper"));
  await page.waitForSelector("#online-paper .olp-top", { state: "visible" });
  assert.equal(await page.locator("#online-paper .olp-tools #g-hd2d-toggle").count(), 1, "开关在「工具 ▾」下拉里");
  // 再关掉：回到原样
  await page.click('#online-paper [data-olp="tools"]');
  await page.click("#online-paper .olp-tools #g-hd2d-toggle");
  await page.waitForFunction(() => !document.body.classList.contains("ol-paper"));
  await page.waitForSelector("#online-stage .ol-stage-heading .ol-info-tools #g-hd2d-toggle", { state: "visible" });
  assert.ok(await page.isVisible("#hotseat-root"));
  // 主持人：开着新画面也不换（主持人那边不变）
  const h = await paperPage(t); if (!h) return;
  await asHost(h.page);
  await settle(h.page);
  assert.equal(await paperOn(h.page), false, "主持人不变");
  assert.equal(await h.page.isVisible("#online-paper"), false);
  // 探索画面不换
  await asPlayer(h.page, { screen: "exploration" });
  await settle(h.page);
  assert.equal(await paperOn(h.page), false, "探索不变");
  assert.deepEqual(o.errors, []); assert.deepEqual(h.errors, []);
});

test("「工具 ▾」：下拉里是地图、战绩、钱包与商店、任务日志、NPC 资料、申请检定、新画面开关——和原来那一排同一个按钮、打开同一个浮层；点完收起；点别处 / Esc 也收起", { timeout: 60000 }, async t => {
  const o = await paperPage(t, { on: false }); if (!o) return; const { page } = o;
  await asPlayer(page);
  await page.waitForSelector("#online-stage .ol-stage-heading .ol-info-tools [data-crq='open']", { state: "attached" });
  const sig = sel => page.locator(sel).evaluateAll(els => els.map(e => e.id === "g-hd2d-toggle" ? "新画面" : e.dataset.crq ? "crq:" + e.dataset.crq : [e.dataset.online, e.dataset.info || ""].join(":")));
  // 原来那一排（去掉挪到队伍栏下面的角色资料 / 武器 / 背包）
  const old = (await sig("#online-stage .ol-info-tools > button, #online-stage .ol-info-tools .ol-hd2d-slot > *")).filter(s => !/^info:(sheet|armory|bag)$/.test(s));
  await page.click("#g-hd2d-toggle");
  await page.waitForFunction(() => document.body.classList.contains("ol-paper"));
  await page.waitForSelector("#online-paper .olp-tools [data-crq='open']", { state: "attached" });
  assert.equal(await page.isVisible("#online-paper .olp-tools"), false, "下拉平时收着");
  const now = await sig("#online-paper .olp-tools-list > button, #online-paper .olp-tools-list .ol-hd2d-slot > *");
  assert.deepEqual(now, ["map:", "info:record", "supplies:", "quests:", "lore:", "crq:open", "新画面"], "地图、战绩、钱包与商店、任务日志、NPC 资料、申请检定、新画面开关");
  assert.deepEqual([...now].sort(), [...old].sort(), "和原来那一排是同一套按钮（不留两份）");
  const labels = await page.locator("#online-paper .olp-tools-list > button, #online-paper .olp-tools-list .ol-hd2d-slot > *").evaluateAll(els => els.map(e => e.textContent.trim()));
  assert.deepEqual(labels.map(l => l.replace(/ · .*$/, "")), ["地图", "战绩", "钱包与商店", "任务日志", "NPC 资料", "申请检定", "新画面 开"]);
  /** 点「工具 ▾」里的一项：下拉收起，返回打开了什么 */
  const pick = async (sel, opened) => {
    await page.click('#online-paper [data-olp="tools"]');
    await page.waitForSelector("#online-paper .olp-tools", { state: "visible" });
    await shot(page, "paper-step1-tools");
    await page.click("#online-paper .olp-tools " + sel);
    await page.waitForSelector("#online-paper .olp-tools", { state: "hidden" });
    if (opened) await page.waitForSelector(opened, { state: "visible" });
  };
  await pick('[data-online="map"]');
  assert.ok(await page.evaluate(() => !!window.__mapOpened), "地图：打开地图（同一个 openMap）");
  await pick('[data-info="record"]', "#online-bag");
  assert.match(await page.locator("#online-bag").innerText(), /最近 10 场战绩/);
  await page.click('#online-bag [data-bag="close"]');
  await pick('[data-online="supplies"]', "#online-supplies");
  assert.match(await page.locator("#online-supplies").innerText(), /钱包与商店/);
  await page.click('#online-supplies [data-online="suppliesClose"]');
  await pick('[data-online="quests"]', "#online-bag");
  assert.match(await page.locator("#online-bag").innerText(), /任务日志/);
  await page.click('#online-bag [data-bag="close"]');
  await pick('[data-crq="open"]', "#online-check-req");
  assert.match(await page.locator("#online-check-req").innerText(), /申请检定/);
  await page.click('#online-check-req [data-crq="close"]');
  await pick('[data-online="lore"]');
  await page.waitForFunction(() => [...document.querySelectorAll(".ol-overlay")].some(el => !el.hidden && /NPC|资料/.test(el.textContent)));
  await page.keyboard.press("Escape");
  // 点别处、按 Esc：收起（Esc 不打开菜单）
  await page.click('#online-paper [data-olp="tools"]');
  await page.waitForSelector("#online-paper .olp-tools", { state: "visible" });
  await page.click("#online-paper .olp-title");
  await page.waitForSelector("#online-paper .olp-tools", { state: "hidden" });
  await page.click('#online-paper [data-olp="tools"]');
  await page.waitForSelector("#online-paper .olp-tools", { state: "visible" });
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("Escape");
  await page.waitForSelector("#online-paper .olp-tools", { state: "hidden" });
  await settle(page);
  assert.equal(await page.isVisible("#pm-overlay"), false, "这一下 Esc 只收下拉，不开菜单");
  // 菜单按钮：打开暂停页面（消息与成员、大厅、克制表……照旧在里面）
  await page.click("#online-paper [data-pause-open]");
  await page.waitForSelector("#pm-overlay", { state: "visible" });
  assert.deepEqual(await page.evaluate(() => PauseMenu.list().map(r => r.id).filter(id => ["room", "lobby"].includes(id))), ["room", "lobby"]);
  assert.deepEqual(o.errors, []);
});

test("吊牌的 ⇅：点开是热座栏原来的「延后 / 换位」——点了发同样的 orderMove、进同样的换位状态（别人的格子写「请求互换」，自己的写「取消换位」）", { timeout: 60000 }, async t => {
  const o = await paperPage(t); if (!o) return; const { page } = o;
  await asPlayer(page);
  await page.waitForSelector("#online-paper .olp-tag.mine [data-olp-swap]", { state: "visible" });
  assert.equal(await page.locator("#online-paper [data-olp-move]").count(), 0, "平时不摆按钮");
  await page.click("#online-paper .olp-tag.mine [data-olp-swap]");
  await page.waitForSelector("#online-paper [data-olp-move]", { state: "visible" });
  assert.deepEqual(await page.locator("#online-paper [data-olp-move]").evaluateAll(els => els.map(e => e.textContent)), ["延后", "换位"]);
  await page.click('#online-paper [data-olp-move="0 0"]');
  await page.waitForFunction(() => fixture.calls.some(c => c.kind === "submit" && c.args.type === "orderMove"));
  assert.deepEqual(await page.evaluate(() => fixture.calls.filter(c => c.kind === "submit").map(c => c.args)), [{ type: "orderMove", actor: "a", index: 2 }], "延后 = 热座栏的「延后」：挪到最后");
  // 换位：进换位状态，别的格子出「请求互换」，自己的出「取消换位」
  await page.click("#online-paper .olp-tag.mine [data-olp-swap]");
  await page.click('#online-paper [data-olp-move="0 1"]');
  await page.waitForFunction(() => document.querySelectorAll("#online-paper [data-olp-move]").length === 2 && /取消换位/.test(document.querySelector("#online-paper .olp-tags").textContent));
  assert.deepEqual(await page.locator("#online-paper [data-olp-move]").evaluateAll(els => els.map(e => e.textContent)), ["取消换位", "请求互换"]);
  await shot(page, "paper-step1-swap");
  await page.click('#online-paper [data-olp-move="1 0"]');
  await page.waitForFunction(() => fixture.calls.filter(c => c.kind === "submit").length === 2);
  assert.deepEqual(await page.evaluate(() => fixture.calls.filter(c => c.kind === "submit").pop().args), { type: "orderMove", actor: "a", index: 1 }, "请求互换 = 热座栏同一个按钮");
  assert.deepEqual(o.errors, []);
});

test("各块收起 / 展开：队伍收成只剩头像一列、技能栏收成一行、抽屉拉出来 / 收回去；都记在本机（重新挂一次界面还是那样）；抽屉收着时小队来了新消息挂数字", { timeout: 60000 }, async t => {
  const o = await paperPage(t); if (!o) return; const { page } = o;
  await asPlayer(page);
  await page.waitForSelector(".hd2d-party .hd2d-party-toggle", { state: "visible" });
  // 队伍：收起只剩头像一列
  await page.click(".hd2d-party .hd2d-party-toggle");
  await page.waitForSelector(".hd2d-party.collapsed");
  assert.equal(await page.isVisible(".hd2d-party .pm .face"), true, "头像还在");
  assert.equal(await page.isVisible(".hd2d-party .pm .meta"), false, "名字、血条藏起来");
  assert.equal(await page.isVisible(".hd2d-party .olp-party-tools"), false);
  const faces = await page.locator(".hd2d-party .pm .face").evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().left)));
  assert.equal(new Set(faces).size, 1, "一列");
  // 技能栏：收成一行
  const tall = (await rect(page, ".ol-battle > .g-hud")).height;
  await page.click(".ol-battle .hd2d-dock-toggle");
  await page.waitForSelector(".ol-battle > .g-hud.dock-closed");
  const short = await rect(page, ".ol-battle > .g-hud");
  assert.ok(short.height < 70 && short.height < tall, `收成一行：${tall} → ${short.height}`);
  assert.match(await page.locator(".ol-battle .hd2d-dock-row").innerText(), /技能 ▲[\s\S]*红玉[\s\S]*轮到你了/);
  // 抽屉：收着时别人说话挂数字（自己说的不算）
  await say(page, "c1", "p2", "我先上");
  await say(page, "c2", "p1", "好");
  await page.waitForFunction(() => { const d = document.querySelector("#online-side .ol-side-collapse-dot"); return d && !d.hidden && d.textContent === "1"; });
  assert.ok(await page.isVisible("#online-side .ol-side-collapse-dot"));
  await shot(page, "paper-step1-collapsed");
  await page.click("#online-side [data-side-collapse]");
  await page.waitForFunction(() => !document.getElementById("online-side").classList.contains("ol-side-collapsed"));
  const drawer = await rect(page, "#online-side");
  assert.ok(drawer.width > 280 && drawer.height > 250 && drawer.right <= drawer.vw - 4, "拉出来是浮在右边的一块：" + JSON.stringify(drawer));
  assert.ok(await page.isVisible("#online-side .ol-side-log"), "战斗记录");
  assert.match(await page.locator('#online-side [data-side="log"]').innerText(), /战斗记录/);
  await page.click('#online-side [data-side="chat"]');
  await page.waitForFunction(() => /我先上/.test(document.querySelector("#online-side .ol-side-chat").textContent));
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  assert.equal(await page.isVisible("#online-side .ol-side-collapse-dot"), false, "看到了：数字消失");
  // 本机记着：重新挂一次界面还是那样
  const keys = await page.evaluate(() => ({ party: localStorage.getItem("backfire-hd2d-party"), dock: localStorage.getItem("backfire-hd2d-dock"), drawer: localStorage.getItem("backfire.online.paper.drawer") }));
  assert.deepEqual(keys, { party: "closed", dock: "closed", drawer: "open" });
  await page.evaluate(() => { HD2DField.switchTo("old"); HD2DField.switchTo("new"); OnlineUI.mount(OnlineGame); });
  await page.waitForFunction(() => !!(document.body.classList.contains("ol-paper") && document.querySelector(".hd2d-party.collapsed") && document.querySelector(".ol-battle > .g-hud.dock-closed")));
  await settle(page);
  assert.equal(await page.evaluate(() => document.getElementById("online-side").classList.contains("ol-side-collapsed")), false, "抽屉还开着");
  // 收回去
  await page.click("#online-side [data-side-collapse]");
  await page.waitForFunction(() => document.getElementById("online-side").classList.contains("ol-side-collapsed"));
  assert.equal(await page.evaluate(() => localStorage.getItem("backfire.online.paper.drawer")), "closed");
  // 存不了（隐私模式 / 存满了）：照样能开关，不报错
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("QuotaExceededError"); }; });
  await page.click("#online-side [data-side-collapse]");
  await page.waitForFunction(() => !document.getElementById("online-side").classList.contains("ol-side-collapsed"));
  assert.deepEqual(o.errors, []);
});

test("白天 / 夜晚 / 沙暴：浮着的面板（顶栏、技能栏、队伍、抽屉）跟着这一包的光影和天气换成配置表里的那一套配色；离开纸片画面就拿掉", { timeout: 60000 }, async t => {
  const o = await paperPage(t); if (!o) return; const { page } = o;
  await asPlayer(page);
  await page.waitForSelector("#online-paper .olp-top", { state: "visible" });
  // 面板的底色（贴上纸纹以后底色藏在纹理里：量的时候先把纹理的标记拿掉一下，量完放回去）
  const look = () => page.evaluate(() => {
    const plain = (s, f) => { const el = document.querySelector(s), t = el.dataset.olpTex; delete el.dataset.olpTex; const v = f(getComputedStyle(el)); if (t) el.dataset.olpTex = t; return v; };
    const bg = s => plain(s, cs => cs.backgroundColor);
    return { time: document.body.dataset.olpTime, weather: document.body.dataset.olpWeather, top: bg("#online-paper .olp-top"), dock: bg(".ol-battle > .g-hud"),
      party: bg(".hd2d-party"), side: bg("#online-side"), ink: getComputedStyle(document.querySelector("#online-side")).color, edge: plain(".ol-battle > .g-hud", cs => cs.boxShadow) };
  });
  /** 配置表里这一套的颜色（rgb(…) 写法，和 getComputedStyle 对得上） */
  const want = (time, weather) => page.evaluate(([time, weather]) => {
    const v = OnlinePaper.themeVars({ time, weather }), rgb = h => { const n = parseInt(h.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
    return { top: rgb(v["--olp-tape"]), dock: rgb(v["--olp-kraft"]), party: rgb(v["--olp-kraft"]), paper: rgb(v["--olp-paper"]), ink: rgb(v["--olp-paper-ink"]) };
  }, [time, weather]);
  // 白天（光影 day）
  let now = await look(), w = await want("day", "none");
  assert.deepEqual([now.time, now.weather], ["day", "none"]);
  assert.deepEqual([now.top, now.dock, now.party], [w.top, w.dock, w.party], "白天：牛皮纸 / 胶带的颜色");
  await page.click("#online-side [data-side-collapse]");
  await page.waitForFunction(() => !document.getElementById("online-side").classList.contains("ol-side-collapsed"));
  now = await look();
  assert.deepEqual([now.side, now.ink], [w.paper, w.ink], "白天：抽屉拉出来是浅色纸、深色字");
  await shot(page, "paper-step2-day");
  // 夜晚（这一包的光影 night）：深色牛皮纸、黑卡纸、浅色字
  await page.evaluate(() => { fixture.view.state.light = "night"; fixture.emit(); });
  await page.waitForFunction(() => document.body.dataset.olpTime === "night");
  now = await look(); w = await want("night", "none");
  assert.deepEqual([now.top, now.dock, now.party, now.side, now.ink], [w.top, w.dock, w.party, w.paper, w.ink], "夜晚那一套");
  assert.match(await page.locator("#online-paper .olp-top").innerText(), /夜 · 常态/, "顶栏写「夜 · 」");
  await shot(page, "paper-step2-night");
  // 沙暴（白天）：纸往沙黄混、纸边发黄
  await page.evaluate(() => { fixture.view.state.light = "day"; fixture.view.state.weather = "sand"; fixture.emit(); });
  await page.waitForFunction(() => document.body.dataset.olpWeather === "sand");
  now = await look(); w = await want("day", "sand");
  const plain = await want("day", "none");
  assert.deepEqual([now.top, now.dock, now.party, now.side], [w.top, w.dock, w.party, w.paper], "沙暴那一套");
  assert.notEqual(now.dock, plain.dock, "和平常的不一样");
  assert.match(now.edge, /inset/, "纸边加了一圈：" + now.edge);
  assert.match(await page.locator("#online-paper .olp-top").innerText(), /沙暴/);
  await shot(page, "paper-step2-sand");
  // 离开纸片画面（关掉新画面）：配色变量、标记都拿掉
  await page.evaluate(() => HD2DField.switchTo("old"));
  await page.waitForFunction(() => !document.body.classList.contains("ol-paper"));
  assert.deepEqual(await page.evaluate(() => [document.body.dataset.olpTime || "", document.body.style.getPropertyValue("--olp-kraft")]), ["", ""]);
  assert.deepEqual(o.errors, []);
});

test("纸片美术：面板贴上程序生成的纸纹（data: 地址，不是图片文件），同一个尺寸只画一次；夜里换一套；减少动态效果时开合不做动画", { timeout: 60000 }, async t => {
  const o = await paperPage(t); if (!o) return; const { page } = o;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await asPlayer(page);
  await page.waitForFunction(() => ["#online-paper .olp-top", ".ol-battle > .g-hud", ".hd2d-party", "#online-paper .olp-tag-card", ".ol-battle .endturn"].every(s => { const el = document.querySelector(s); return el && el.dataset.olpTex; }));
  const tex = await page.evaluate(() => ["#online-paper .olp-top", ".ol-battle > .g-hud", ".hd2d-party", "#online-side"].map(s => { const el = document.querySelector(s); return [el.dataset.olpTex, el.style.getPropertyValue("--olp-tex").slice(0, 27)]; }));
  assert.deepEqual(tex, [["tapebar", 'url("data:image/png;base64,'], ["dock", 'url("data:image/png;base64,'], ["kraft", 'url("data:image/png;base64,'], ["kraft", 'url("data:image/png;base64,']], "顶栏胶带、技能栏、队伍牛皮纸、抽屉的竖标签");
  assert.equal(await page.evaluate(() => document.querySelector("#online-paper .olp-tag.on .olp-tag-card").dataset.olpTex), "tagon", "当前行动的吊牌换青色那一种");
  // 纸纹那一层铺满整块面板（比面板四边多出撕边外的影子），不是一条细线
  const sheet = await page.evaluate(() => { const el = document.querySelector(".ol-battle > .g-hud"), cs = getComputedStyle(el, "::before"); return { h: parseFloat(cs.height), panel: el.offsetHeight }; });
  assert.ok(sheet.h >= sheet.panel, "技能栏后面那张纸铺满：" + JSON.stringify(sheet));
  // 「结束行动」是纸板 + 喷漆字：不再垫 skin.css 的那块喷漆色块（字和底不能是一个颜色）
  const end = await page.evaluate(() => { const el = document.querySelector(".ol-battle .endturn"); return { tex: el.dataset.olpTex, before: getComputedStyle(el, "::before").display }; });
  assert.deepEqual(end, { tex: "board", before: "none" });
  // 同一个尺寸、同一套配色只画一次（第二次从缓存拿，一模一样）
  const same = await page.evaluate(() => { const th = { time: "day", weather: "none" }, a = OnlinePaper.texture(document, "card", 123, 45, th), t0 = performance.now(), b = OnlinePaper.texture(document, "card", 123, 45, th); return { same: a === b, fast: performance.now() - t0 < 2, png: a.startsWith("data:image/png") }; });
  assert.deepEqual(same, { same: true, fast: true, png: true });
  // 斑驳遮罩（印章、喷漆）
  assert.match(await page.evaluate(() => document.body.style.getPropertyValue("--olp-grit")), /^url\("data:image\/png/);
  // 夜里：换一套纹理
  const dayTex = await page.evaluate(() => document.querySelector(".ol-battle > .g-hud").style.getPropertyValue("--olp-tex"));
  await page.evaluate(() => { fixture.view.state.light = "night"; fixture.emit(); });
  await page.waitForFunction(d => document.querySelector(".ol-battle > .g-hud").style.getPropertyValue("--olp-tex") !== d, dayTex);
  // 减少动态效果：打开 / 收起不做动画
  await page.click("#online-side [data-side-collapse]");
  await page.click(".ol-battle .hd2d-dock-toggle");
  const motion = await page.evaluate(() => ["#online-side", ".ol-battle > .g-hud", ".hd2d-party", "#online-paper .olp-tools"].map(s => { const cs = getComputedStyle(document.querySelector(s)); return cs.transitionDuration + "/" + cs.animationName; }));
  assert.ok(motion.every(m => /^0s(, 0s)*\/none$/.test(m)), "没有动画：" + motion);
  await shot(page, "paper-step3-night");
  assert.deepEqual(o.errors, []);
});

test("手机竖屏（390 × 844）：顶栏放得下；队伍只显示头像；技能栏在最底下；记录 / 聊天从底下拉出来盖满屏幕，收回去是竖标签", { timeout: 60000 }, async t => {
  const o = await paperPage(t, { context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }); if (!o) return; const { page } = o;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await asPlayer(page);
  await page.waitForSelector("#online-paper .olp-top", { state: "visible" });
  await settle(page);
  const top = await page.evaluate(() => { const el = document.querySelector("#online-paper .olp-top"), r = el.getBoundingClientRect(), m = el.querySelector("[data-pause-open]").getBoundingClientRect(), tl = el.querySelector('[data-olp="tools"]').getBoundingClientRect(); return { right: r.right, menu: m.right, tools: [tl.left, tl.right], vw: innerWidth }; });
  assert.ok(top.right <= top.vw && top.menu <= top.right && top.tools[0] > 0 && top.tools[1] < top.menu, "顶栏放得下、「工具」「菜单」都在屏幕里：" + JSON.stringify(top));
  assert.equal(await page.isVisible(".hd2d-party .pm .face"), true, "头像");
  assert.equal(await page.isVisible(".hd2d-party .pm .meta"), false, "名字、血条不显示");
  const party = await rect(page, ".hd2d-party");
  assert.ok(party.width < 120, "队伍只剩窄窄一列：" + JSON.stringify(party));
  const dock = await rect(page, ".ol-battle > .g-hud");
  assert.ok(Math.abs(dock.bottom - dock.vh) < 1 && dock.width >= dock.vw - 1, "技能栏在最底下、横贯：" + JSON.stringify(dock));
  const tab = await rect(page, "#online-side");
  assert.ok(tab.right >= tab.vw - 1 && tab.width <= 44 && tab.bottom <= dock.top, "收着是右边缘的竖标签，在技能栏上面：" + JSON.stringify(tab));
  await page.click("#online-side [data-side-collapse]");
  await page.waitForFunction(() => !document.getElementById("online-side").classList.contains("ol-side-collapsed"));
  const sheet = await rect(page, "#online-side");
  assert.deepEqual([sheet.left, sheet.top, Math.round(sheet.width), Math.round(sheet.height)], [0, 0, sheet.vw, sheet.vh], "拉出来盖满屏幕");
  assert.ok(await page.isVisible("#online-side [data-side-collapse]"), "盖满时也收得回去");
  await page.click("#online-side [data-side-collapse]");
  await page.waitForFunction(() => document.getElementById("online-side").classList.contains("ol-side-collapsed"));
  assert.deepEqual(o.errors, []);
});

/* ---------- 审查（10/22）之后补的：收据、技能吊牌、收起的队伍、竖标签、纸板按钮、便利贴、手机上不挤 ---------- */
/** 两个颜色（rgb(…) / #rrggbb）的对比度（WCAG） */
const contrast = (a, b) => {
  // #rrggbb、rgb(…)、color(srgb 0–1 …)（color-mix 算出来的颜色 getComputedStyle 写成这样）
  const rgb = c => (/^#/.test(c) ? [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)) : /^color\(srgb/.test(c) ? c.match(/[\d.]+/g).slice(0, 3).map(v => Number(v) * 255) : c.match(/[\d.]+/g).slice(0, 3).map(Number));
  const lum = c => { const [r, g, b] = rgb(c).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const RECEIPT_LOGS = [
  { kind: "gm", text: "主持人调整了队伍物资" },
  { kind: "round", text: "第 3 回合开始", turn: 3 },
  { kind: "action", text: "红玉 · 普通攻击 → 狂徒：12 伤害，击破 1", turn: 3 },
  { kind: "action", text: "狂徒 · 重击 → 绯秋：9 伤害", turn: 3 },
  { kind: "phase", text: "敌人回合", phase: "enemy", turn: 3 }
];

test("战斗记录是热敏收据：BACKFIRE / 战斗记录 · 房间码、*** 第 N 回合 ***、每条之间虚线、伤害数字靠右、本回合合计、底边锯齿撕口的收据纸、等宽打印体；切到小队换成贴便利贴的那张纸", { timeout: 60000 }, async t => {
  const o = await paperPage(t); if (!o) return; const { page } = o;
  await asPlayer(page);
  await page.evaluate(logs => { fixture.view.packet.publicLogs = logs; fixture.emit(); }, RECEIPT_LOGS);
  await page.waitForSelector("#online-side [data-side-collapse]", { state: "visible" });
  await page.click("#online-side [data-side-collapse]");
  await page.waitForFunction(() => document.querySelector("#online-side .olp-rc-h") && document.getElementById("online-side").dataset.olpTex === "receipt");
  const r = await page.evaluate(() => {
    const log = document.querySelector("#online-side .ol-side-log"), cs = getComputedStyle(log), q = s => [...log.querySelectorAll(s)];
    const row = q(".olp-rc-r").find(li => /红玉/.test(li.textContent)), n = row.querySelector(".olp-rc-n").getBoundingClientRect(), l = row.querySelector(".olp-rc-l").getBoundingClientRect(), rr = row.getBoundingClientRect();
    return { head: q(".olp-rc-h").map(e => e.innerText.replace(/\s+/g, " ")), seps: q(".olp-rc-sep").map(e => e.textContent), total: q(".olp-rc-total").map(e => e.textContent),
      font: cs.fontFamily, list: cs.listStyleType, dash: q(".olp-rc-r").map(e => getComputedStyle(e).borderBottomStyle), num: row.querySelector(".olp-rc-n").textContent,
      numRight: rr.right - n.right, numAfterLabel: n.left >= l.right - 0.5, ink: cs.color, paper: getComputedStyle(document.body).getPropertyValue("--olp-receipt").trim() };
  });
  assert.deepEqual(r.head, ["BACKFIRE 战斗记录 · SA3X7C"], "顶上：BACKFIRE / 战斗记录 · 房间码");
  assert.deepEqual(r.seps, ["*** 第 3 回合 ***"]);
  assert.deepEqual(r.total, ["* 本回合合计 伤害 21 · 击破 1 *"]);
  assert.match(r.font, /Mono|monospace/, "等宽打印体：" + r.font);
  assert.equal(r.list, "none", "不再是「1. 2. 3.」的列表");
  assert.ok(r.dash.length >= 3 && r.dash.every(s => s === "dashed"), "每条之间虚线：" + r.dash);
  assert.equal(r.num, "12");
  assert.ok(Math.abs(r.numRight) < 1 && r.numAfterLabel, "伤害数字靠右：" + JSON.stringify(r));
  assert.ok(contrast(r.ink, r.paper) > 7, "白色收据纸、深色字：" + r.ink + " / " + r.paper);
  // 收据纸（纹理 receipt：底边锯齿）铺满抽屉
  const tex = await page.evaluate(() => { const el = document.getElementById("online-side"), cs = getComputedStyle(el, "::before"); return { kind: el.dataset.olpTex, h: parseFloat(cs.height), panel: el.offsetHeight }; });
  assert.ok(tex.kind === "receipt" && tex.h >= tex.panel, JSON.stringify(tex));
  // 索引标签探出纸的上边
  const tabs = await page.evaluate(() => { const s = document.getElementById("online-side").getBoundingClientRect(), t = document.querySelector('#online-side [data-side="log"]').getBoundingClientRect(); return { side: s.top, tab: t.top }; });
  assert.ok(tabs.tab < tabs.side, "「战斗记录 / 小队」标签探出纸的上边：" + JSON.stringify(tabs));
  await shot(page, "paper-review-receipt");
  // 夜里：收据换黑纸、浅色字
  await page.evaluate(() => { fixture.view.state.light = "night"; fixture.emit(); });
  await page.waitForFunction(() => document.body.dataset.olpTime === "night");
  const night = await page.evaluate(() => ({ ink: getComputedStyle(document.querySelector("#online-side .ol-side-log")).color, paper: getComputedStyle(document.body).getPropertyValue("--olp-receipt").trim() }));
  assert.ok(contrast(night.ink, night.paper) > 7, "夜里也清楚：" + JSON.stringify(night));
  // 切到小队：换成贴便利贴的那张纸
  await page.click('#online-side [data-side="chat"]');
  await page.waitForFunction(() => document.getElementById("online-side").dataset.olpTex === "paper");
  assert.deepEqual(o.errors, []);
});

test("小队聊天是便利贴：正文是清楚的无衬线黑体、只有发送人名字是手写体；自己发的靠右；每人固定一种颜色；输入框在纸的最底下", { timeout: 60000 }, async t => {
  const o = await paperPage(t); if (!o) return; const { page } = o;
  await asPlayer(page);
  await page.evaluate(() => { fixture.view.state.light = "night"; fixture.emit(); });
  await page.waitForSelector("#online-side [data-side-collapse]", { state: "visible" });
  await page.click("#online-side [data-side-collapse]");
  await page.click('#online-side [data-side="chat"]');
  await say(page, "c1", "p2", "我先去拉仇恨");
  await say(page, "c2", "p1", "红玉打狂徒");
  await say(page, "c3", "p2", "好");
  await page.waitForFunction(() => document.querySelectorAll("#online-side .ol-side-chat li").length === 3);
  const c = await page.evaluate(() => {
    const list = document.querySelector("#online-side .ol-side-chat"), lis = [...list.querySelectorAll("li")], box = list.getBoundingClientRect();
    const form = document.querySelector("#online-side .ol-side-form").getBoundingClientRect(), side = document.getElementById("online-side").getBoundingClientRect();
    return { body: getComputedStyle(lis[0].querySelector("p")).fontFamily, name: getComputedStyle(lis[0].querySelector("b")).fontFamily, weight: getComputedStyle(lis[0].querySelector("p")).fontWeight,
      mine: lis.map(li => li.classList.contains("ol-mine")), right: lis.map(li => Math.round(box.right - li.getBoundingClientRect().right)), left: lis.map(li => Math.round(li.getBoundingClientRect().left - box.left)),
      colors: lis.map(li => getComputedStyle(li).backgroundColor), ink: getComputedStyle(lis[0].querySelector("p")).color,
      form: { top: form.top, bottom: form.bottom, listBottom: box.bottom, sideBottom: side.bottom }, textarea: !!document.querySelector("#online-side .ol-side-form textarea:not([hidden])") };
  });
  assert.match(c.body, /Noto Sans|PingFang|YaHei|Zen Hei|sans-serif/, "正文黑体：" + c.body);
  assert.doesNotMatch(c.body, /Zhi Mang Xing|ZCOOL|Marker/, "正文不用手写体 / 艺术字");
  assert.ok(Number(c.weight) >= 500, "正文加粗一点（清楚）");
  assert.match(c.name, /^"?Zhi Mang Xing/, "发送人名字是手写体：" + c.name);
  assert.deepEqual(c.mine, [false, true, false]);
  assert.ok(c.right[1] < c.right[0] && c.left[1] > c.left[0] + 20, "自己发的靠右：" + JSON.stringify(c));
  assert.equal(c.colors[0], c.colors[2], "同一个人一种颜色");
  assert.notEqual(c.colors[0], c.colors[1], "自己的是另一种");
  assert.ok(contrast(c.ink, c.colors[0]) > 7, "便利贴上深色字（夜里也是）");
  assert.ok(c.textarea && c.form.top >= c.form.listBottom - 1 && c.form.sideBottom - c.form.bottom < 24, "输入框在纸的最底下：" + JSON.stringify(c.form));
  await shot(page, "paper-review-chat-night");
  assert.deepEqual(o.errors, []);
});

test("技能吊牌：打孔、打孔虚线、属性图标、名字从左往右排开，谁也不压谁（审查：图标压住了「普通攻击」的第一个字）", { timeout: 60000 }, async t => {
  const o = await paperPage(t); if (!o) return; const { page } = o;
  await asPlayer(page);
  await page.waitForFunction(() => document.querySelectorAll(".ol-battle .skills .sk[data-olp-tex] .sk-el").length >= 2);
  await page.evaluate(() => document.fonts && document.fonts.ready.then(() => 0));
  const sks = await page.evaluate(() => [...document.querySelectorAll(".ol-battle .skills .sk[data-olp-tex]")].map(sk => {
    const b = sk.getBoundingClientRect(), after = getComputedStyle(sk, "::after"), el = sk.querySelector(".sk-el").getBoundingClientRect();
    const range = document.createRange(), nm = sk.querySelector(".nm"); range.selectNodeContents(nm); const text = range.getBoundingClientRect();
    return { name: nm.textContent, hole: [parseFloat(after.left), parseFloat(after.left) + parseFloat(after.width)], el: [el.left - b.left, el.right - b.left], text: [text.left - b.left, text.right - b.left], width: b.width };
  }));
  assert.ok(sks.length >= 2);
  for (const s of sks) {
    assert.ok(s.hole[0] >= 0 && s.hole[1] <= s.el[0], s.name + "：打孔 / 虚线在图标左边：" + JSON.stringify(s));
    assert.ok(s.el[1] <= s.text[0], s.name + "：图标不压名字：" + JSON.stringify(s));
    assert.ok(s.text[1] <= s.width, s.name + "：名字在吊牌里：" + JSON.stringify(s));
  }
  // 纸板喷漆大按钮：深纸板 + 饱和的喷漆字，下面那行小字不透明（审查：对比度太低）
  const end = await page.evaluate(() => { const b = document.querySelector(".ol-battle .endturn"), cs = getComputedStyle(b), sm = b.querySelector("small"), body = getComputedStyle(document.body);
    return { tex: b.dataset.olpTex, color: cs.color, board: body.getPropertyValue("--olp-board").trim(), small: sm ? getComputedStyle(sm).opacity : "1", stroke: cs.webkitTextStrokeWidth }; });
  assert.equal(end.tex, "board");
  assert.ok(contrast(end.color, end.board) >= 4.5, "「结束行动」的喷漆字和纸板对比度够：" + JSON.stringify(end) + " → " + contrast(end.color, end.board).toFixed(2));
  assert.equal(end.small, "1", "下面那行小字不透明");
  for (const time of ["day", "night"]) for (const weather of ["none", "sand", "rain", "snow", "fog"]) {
    const v = await page.evaluate(([time, weather]) => OnlinePaper.themeVars({ time, weather }), [time, weather]);
    assert.ok(contrast(v["--olp-spray"], v["--olp-board"]) >= 4.5 && contrast(v["--olp-spray2"], v["--olp-board"]) >= 4.5, time + " / " + weather + "：两种喷漆在纸板上都够清楚");
  }
  // 「唤出」跟着角色主属性的颜色（提亮一点）：每一种属性的颜色在纸板上都够清楚（白天、夜里）
  for (const light of ["day", "night"]) {
    await page.evaluate(light => { fixture.view.state.light = light; fixture.emit(); }, light);
    await page.waitForFunction(light => document.body.dataset.olpTime === light, light);
    const lift = await page.evaluate(() => {
      const hud = document.querySelector(".ol-battle > .g-hud"), out = [];
      for (const [k, c] of Object.entries(HD2DUI.UI.elements)) {
        const b = document.createElement("button"); b.className = "summonbtn"; b.dataset.olpTex = "board"; b.style.setProperty("--el", c); b.textContent = "唤出";
        hud.appendChild(b); out.push([k, getComputedStyle(b).color]); b.remove();
      }
      return { out, board: getComputedStyle(document.body).getPropertyValue("--olp-board").trim() };
    });
    for (const [k, col] of lift.out) assert.ok(contrast(col, lift.board) >= 4.5, `${light}：「唤出」${k} 的颜色 ${col} 在纸板 ${lift.board} 上对比度 ${contrast(col, lift.board).toFixed(2)}`);
  }
  await shot(page, "paper-review-skills");
  assert.deepEqual(o.errors, []);
});

test("队伍收起后只剩一列头像贴纸（后面没有白卡片）；收起后右边缘的竖标签「记录 · 聊天」字清楚，未读数是红章", { timeout: 60000 }, async t => {
  const o = await paperPage(t); if (!o) return; const { page } = o;
  await asPlayer(page);
  await page.waitForSelector(".hd2d-party .hd2d-party-toggle", { state: "visible" });
  await page.click(".hd2d-party .hd2d-party-toggle");
  await page.waitForSelector(".hd2d-party.collapsed");
  await settle(page);
  const pms = await page.evaluate(() => [...document.querySelectorAll(".hd2d-party .party > .pm")].map(pm => {
    const r = pm.getBoundingClientRect(), f = pm.querySelector(".face").getBoundingClientRect();
    return { w: r.width, face: f.width, card: getComputedStyle(pm, "::before").display, bg: getComputedStyle(pm).backgroundColor };
  }));
  assert.ok(pms.length === 2 && pms.every(p => p.w <= p.face + 8), "卡片只有头像那么宽：" + JSON.stringify(pms));
  assert.ok(pms.every(p => p.card === "none" && /rgba\(0, 0, 0, 0\)|transparent/.test(p.bg)), "头像后面没有白卡片：" + JSON.stringify(pms));
  const panel = await rect(page, ".hd2d-party");
  assert.ok(panel.width < 90, "收起的队伍是窄窄一条：" + JSON.stringify(panel));
  // 竖标签：字深、够大；有新消息时是红章
  await say(page, "c1", "p2", "看这里");
  await page.waitForFunction(() => { const d = document.querySelector("#online-side .ol-side-collapse-dot"); return d && !d.hidden; });
  const tab = await page.evaluate(() => {
    const b = document.querySelector("#online-side [data-side-collapse]"), cs = getComputedStyle(b), d = getComputedStyle(document.querySelector("#online-side .ol-side-collapse-dot")), body = getComputedStyle(document.body);
    const br = b.getBoundingClientRect(), dr = document.querySelector("#online-side .ol-side-collapse-dot").getBoundingClientRect();
    return { text: b.querySelector(".ol-side-collapse-icon").textContent, size: parseFloat(cs.fontSize), color: cs.color, opacity: cs.opacity, kraft: body.getPropertyValue("--olp-kraft").trim(),
      dot: { color: d.color, border: d.borderTopColor, width: d.borderTopWidth, bg: d.backgroundColor, transform: d.transform, size: parseFloat(d.fontSize), off: Math.abs((dr.left + dr.right) / 2 - (br.left + br.right) / 2), inside: dr.left >= br.left - 2 && dr.right <= br.right + 2 },
      stamp: body.getPropertyValue("--olp-stamp").trim() };
  });
  assert.equal(tab.text, "记录 · 聊天");
  assert.ok(tab.size >= 20 && tab.opacity === "1" && contrast(tab.color, tab.kraft) >= 7, "竖标签的字清楚：" + JSON.stringify(tab));
  const red = await page.evaluate(c => { const d = document.createElement("i"); d.style.color = c; document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v; }, tab.stamp);
  assert.ok(tab.dot.color === red && tab.dot.border === red && parseFloat(tab.dot.width) >= 2, "未读数是红章（红字红框）：" + JSON.stringify(tab.dot));
  assert.ok(tab.dot.transform !== "none" && tab.dot.size >= 14, "章斜着盖、字够大：" + JSON.stringify(tab.dot));
  assert.ok(tab.dot.off < 3 && tab.dot.inside, "章盖在竖标签正中、不出边（刚出现的那一下也是）：" + JSON.stringify(tab.dot));
  await shot(page, "paper-review-collapsed");
  assert.deepEqual(o.errors, []);
});

test("手机竖屏：抽屉收着时顶栏、吊牌、队伍头像、竖标签、技能栏互不挤压；拉开盖满屏幕时能关掉（关掉回到竖标签）", { timeout: 60000 }, async t => {
  const o = await paperPage(t, { context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }); if (!o) return; const { page } = o;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await asPlayer(page);
  await page.waitForSelector("#online-paper .olp-top", { state: "visible" });
  await settle(page);
  const boxes = async () => page.evaluate(() => Object.fromEntries([["top", "#online-paper .olp-top"], ["tags", "#online-paper .olp-tags"], ["party", ".hd2d-party"], ["tab", "#online-side"], ["dock", ".ol-battle > .g-hud"]]
    .map(([k, s]) => { const r = document.querySelector(s).getBoundingClientRect(); return [k, { l: r.left, t: r.top, r: r.right, b: r.bottom }]; })));
  const hit = (a, b) => a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
  const check = (bx, why) => {
    const keys = Object.keys(bx);
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      if (keys[i] === "top" && keys[j] === "tags") continue;   // 吊牌本来就挂在顶栏下边（细线挂着，压一点点）
      assert.ok(!hit(bx[keys[i]], bx[keys[j]]), `${why}：${keys[i]} 和 ${keys[j]} 挤在一起：${JSON.stringify(bx)}`);
    }
    assert.ok(Object.values(bx).every(b => b.l >= -1 && b.r <= 391 && b.b <= 845), why + "：都在屏幕里：" + JSON.stringify(bx));
  };
  check(await boxes(), "平时");
  // 技能栏展开、变高了（提示栏字多）：竖标签跟着往上挪，还是不压（技能栏最高只到屏幕高度的 35%，#311：在这以内长高）
  if (await page.evaluate(() => document.querySelector(".ol-battle > .g-hud").classList.contains("dock-closed"))) await page.click(".ol-battle .hd2d-dock-toggle");
  const before = await rect(page, ".ol-battle > .g-hud");
  await page.evaluate(() => { const h = document.querySelector(".ol-battle > .g-hud .hint"); h.style.display = "block"; h.style.minHeight = "100px"; });
  await page.waitForFunction(h0 => document.querySelector(".ol-battle > .g-hud").getBoundingClientRect().height > h0 + 60, before.height);
  await page.waitForFunction(() => { const h = document.querySelector(".ol-battle > .g-hud").getBoundingClientRect(), s = document.getElementById("online-side").getBoundingClientRect(); return s.bottom <= h.top; }, null, { timeout: 3000 });
  check(await boxes(), "技能栏变高以后");
  await page.evaluate(() => { const h = document.querySelector(".ol-battle > .g-hud .hint"); h.style.display = ""; h.style.minHeight = ""; });
  // 等竖标签跟着技能栏挪回去（量好的高度写回 --olp-dock-h）再点它
  await page.waitForFunction(() => document.body.style.getPropertyValue("--olp-dock-h") === document.querySelector(".ol-battle > .g-hud").offsetHeight + "px");
  await settle(page);
  // 拉开：盖满屏幕；收起按钮在屏幕里、点得到；点了回到竖标签
  await page.click("#online-side [data-side-collapse]");
  await page.waitForFunction(() => !document.getElementById("online-side").classList.contains("ol-side-collapsed"));
  const close = await page.evaluate(() => { const b = document.querySelector("#online-side [data-side-collapse]").getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2, top = document.elementFromPoint(x, y);
    return { inside: b.top >= 0 && b.right <= innerWidth && b.width >= 32 && b.height >= 32, hit: !!(top && top.closest("[data-side-collapse]")) }; });
  assert.deepEqual(close, { inside: true, hit: true }, "盖满时收起按钮露在外面、够大、点得到");
  await shot(page, "paper-review-phone-open");
  await page.click("#online-side [data-side-collapse]");
  await page.waitForFunction(() => document.getElementById("online-side").classList.contains("ol-side-collapsed"));
  check(await boxes(), "关掉以后");
  await shot(page, "paper-review-phone");
  assert.deepEqual(o.errors, []);
});

test("新加的 DOM（顶栏、吊牌、下拉、队伍栏下面的按钮、技能栏那一行、抽屉标签）里没有坚毅生命的数字", { timeout: 60000 }, async t => {
  const o = await paperPage(t); if (!o) return; const { page } = o;
  await asPlayer(page);
  await page.waitForSelector("#online-paper .olp-tag", { state: "visible" });
  await page.click('#online-paper [data-olp="tools"]');
  await page.click("#online-paper .olp-tag.mine [data-olp-swap]");
  const html = await page.evaluate(() => [document.getElementById("online-paper"), document.querySelector(".hd2d-party"), document.querySelector(".ol-battle > .g-hud"), document.getElementById("online-side"), document.querySelector("#online-stage .olp-float")]
    .filter(Boolean).map(el => el.outerHTML).join("\n").replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, "data:…"));   // 纸纹（base64 里碰巧有这几个字母不算）
  for (const n of [SHP, SHP_MAX]) assert.ok(!html.includes(String(n)), "出现了坚毅生命的数字 " + n);
  assert.doesNotMatch(html, /shp|坚毅/i);
  assert.deepEqual(o.errors, []);
});
