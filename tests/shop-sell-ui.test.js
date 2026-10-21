// 商店 · 卖（shop-sell-ui.js）：买 / 卖页签、按归属分组、数量步进、单价合计、置灰原因、可买回、提示钱进谁的钱包；
// 单机单局（rogue-ui.js）、联机单局 / 跑团玩家（online-ui.js）、视图白名单（online-view.js）。
// 单机单局用真规则（PR #138 · rogue.js / shop-sell.js）；联机玩家那边只有显示，包是手写的。
// 截图：SHOP_SHOTS=1 时写 shots/shop-sell-*.png（1280×800）。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const { pathToFileURL } = require("url");
const { execSync } = require("node:child_process");
const V = require("../online-view");
const ROOT = path.resolve(__dirname, "..");
const SHOTS = process.env.SHOP_SHOTS ? path.join(ROOT, "shots") : null;

const VIEW = {
  items: [
    { id: "medkit", name: "医疗包", qty: 3, unitPrice: 15, owner: "shared", ok: true, reason: "" },
    { id: "quest_key", name: "旧钥匙", qty: 1, unitPrice: 0, owner: "shared", ok: false, reason: "任务道具" },
    { id: "bp_x", name: "图纸 · 回旋刃", qty: 1, unitPrice: 0, owner: "shared", ok: false, reason: "图纸" },
    { id: "grenade", name: "破片手雷", qty: 2, unitPrice: 20, owner: "kolt", ok: true, reason: "" },
    { id: "vest", name: "防弹背心", qty: 1, unitPrice: 0, owner: "kolt", ok: false, reason: "已装备" },
    { id: "trinket", name: "怪石头", qty: 1, unitPrice: 0, owner: "helu", ok: false, reason: "无标准价" },
    { id: "part_x", name: "改装件 · 重枪管", qty: 1, unitPrice: 0, owner: "kolt", ok: false, reason: "改装件" },
    { id: "ration", name: "压缩口粮", qty: 4, unitPrice: 5, owner: "helu", ok: true, reason: "" }
  ],
  buyback: [{ token: "bb1", id: "water_can", name: "水壶", qty: 1, price: 10, owner: "shared", seller: "kolt" }]
};
const HEROES = [{ kit: "kolt", name: "柯尔特", purse: 120 }, { kit: "helu", name: "赫鲁", purse: 40 }];

function loadUi() {
  const c = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "shop-sell-ui.js"), "utf8"), c, { filename: "shop-sell-ui.js" });
  c.ShopSellUI.reset();
  return c.ShopSellUI;
}

/* ---------- 纯函数 ---------- */
test("卖出页：按 公用 / 每位英雄 分组，单价、合计、置灰原因、可买回", () => {
  const U = loadUi();
  const h = U.html(U.model(VIEW, { heroes: HEROES }));
  const pos = ["公用", "柯尔特", "赫鲁", "可买回"].map(s => h.indexOf(`<h4>${s}`));
  assert.ok(pos.every(p => p >= 0), "四个分组标题都在");
  assert.deepEqual(pos.slice().sort((a, b) => a - b), pos, "公用在最前，英雄按队伍顺序，可买回最后");
  for (const r of ["任务道具", "图纸", "已装备", "无标准价", "改装件"]) assert.match(h, new RegExp(`ss-why">${r}`));
  assert.equal((h.match(/class="ss-row off"/g) || []).length, 5);
  // 能卖的行：单价 15，数量 1，合计 15；指令带 owner 和出手的英雄
  assert.match(h, /<b>医疗包<\/b>[\s\S]*?ss-unit"><small>单价<\/small><b>15<\/b>[\s\S]*?ss-total"><small>共<\/small><b>15<\/b>/);
  assert.match(h, /data-ss-cmd="\{&quot;action&quot;:&quot;sellItem&quot;,&quot;kit&quot;:&quot;kolt&quot;,&quot;id&quot;:&quot;medkit&quot;,&quot;qty&quot;:1,&quot;owner&quot;:&quot;shared&quot;\}"/);
  // 置灰行的「卖」按钮不可点
  assert.match(h, /&quot;id&quot;:&quot;vest&quot;[^>]*disabled/);
  // 可买回：价格 10，指令带 token
  assert.match(h, /水壶 ×1[\s\S]*?买回<\/small><b>10<\/b>[\s\S]*?&quot;action&quot;:&quot;buybackItem&quot;,&quot;kit&quot;:&quot;kolt&quot;,&quot;token&quot;:&quot;bb1&quot;/);
});

test("数量步进：不超过持有数量，合计跟着变；卖出后数量复位", () => {
  const U = loadUi();
  const ev = (attrs) => ({ target: { closest: () => ({ disabled: false, dataset: attrs }) } });
  const m = () => U.model(VIEW, { heroes: HEROES });
  for (let i = 0; i < 5; i++) U.handle(ev({ ssStep: "1", ssQ: "shared|medkit", ssMax: "3" }));
  assert.equal(U.state.qty["shared|medkit"], 3);
  assert.match(U.html(m()), /<b>医疗包<\/b>[\s\S]*?ss-n">3<\/b>[\s\S]*?<b>45<\/b>/);
  U.handle(ev({ ssStep: "-1", ssQ: "shared|medkit", ssMax: "3" }));
  assert.match(U.html(m()), /&quot;id&quot;:&quot;medkit&quot;,&quot;qty&quot;:2/);
  let sent = null;
  U.handle(ev({ ssCmd: JSON.stringify({ action: "sellItem", kit: "kolt", id: "medkit", qty: 2, owner: "shared" }) }), c => { sent = c; });
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), { action: "sellItem", kit: "kolt", id: "medkit", qty: 2, owner: "shared" });
  assert.equal(U.state.qty["shared|medkit"], undefined);
});

test("联机：别人的英雄的东西不能卖；买回只给卖的人；钱不够不能买回", () => {
  const U = loadUi();
  const h = U.html(U.model(VIEW, { heroes: HEROES, mine: k => k === "helu", actor: "helu", money: k => k === "helu" ? 5 : 999 }));
  assert.match(h, /&quot;id&quot;:&quot;grenade&quot;[^>]*disabled/);
  assert.match(h, /不是你的角色/);
  assert.doesNotMatch(h, /&quot;id&quot;:&quot;ration&quot;[^>]*disabled/);
  assert.match(h, /&quot;token&quot;:&quot;bb1&quot;[^>]*disabled/, "水壶是柯尔特卖的");
});

test("页签：记在各自的 key 上；包里没有卖出视图（离开商店）就回到「买」", () => {
  const U = loadUi();
  U.setTab("rogue", "sell");
  assert.equal(U.tabOf("rogue"), "sell"); assert.equal(U.tabOf("trpg"), "buy");
  assert.match(U.tabsHtml("rogue"), /ss-tab on" role="tab" aria-selected="true" data-ss-tab="sell"/);
  U.sync("rogue", true); assert.equal(U.tabOf("rogue"), "sell");
  U.sync("rogue", false); assert.equal(U.tabOf("rogue"), "buy");
  assert.match(U.tabsHtml("rogue", { sellOff: true }), /data-ss-tab="sell"[^>]*disabled/);
  assert.match(U.html(U.model(null, {})), /不收东西/);
  assert.match(U.html(U.model({ items: [], buyback: [] }, {})), /没有能卖的东西/);
});

test("提示：钱进了谁的钱包（kit / party），失败时写原因", () => {
  const U = loadUi();
  const names = { kolt: "柯尔特", helu: "赫鲁" };
  assert.equal(U.toastText({ ok: true, total: 30, payout: [{ to: "kolt", amount: 15 }, { to: "helu", amount: 15 }], msg: "卖出 医疗包 ×2" }, names), "💰 卖出 医疗包 ×2 → 柯尔特 +15、赫鲁 +15");
  assert.equal(U.toastText({ ok: true, total: 20, payout: [{ to: "party", amount: 20 }] }, names), "💰 得 20 奎支 → 队伍公账 +20");
  assert.equal(U.toastText({ ok: true, total: -10, payout: [{ to: "kolt", amount: -10 }], msg: "买回 水壶" }, names), "💰 买回 水壶 → 柯尔特 -10");
  assert.equal(U.toastText({ ok: false, msg: "已装备" }), "没做成：已装备");
});

test("online-view：packet.shopSell（PR #138 · projectShopSell）只留界面要的字段", () => {
  const dirty = { items: VIEW.items.map(r => Object.assign({ shp: 99, secret: "x" }, r)), buyback: VIEW.buyback.map(b => Object.assign({ hidden: 1 }, b)) };
  const out = V.projectPacket({ type: "result", shopSell: dirty }, { recipientId: "p1", gmId: "gm" }).shopSell;
  assert.deepEqual(out.items[0], VIEW.items[0]);
  assert.deepEqual(out.buyback[0], VIEW.buyback[0]);
  const U = loadUi();
  assert.match(U.html(U.model(out, { heroes: HEROES })), /医疗包/);
});

test("game.html 引入 shop-sell-ui.js / shop-sell.css；联机允许 shopSell / shopBuyback 消息", () => {
  const g = fs.readFileSync(path.join(ROOT, "game.html"), "utf8");
  assert.match(g, /shop-sell-ui\.js/); assert.match(g, /shop-sell\.css/);
  assert.match(fs.readFileSync(path.join(ROOT, "online-game.js"), "utf8"), /"shopSell", "shopBuyback"/);
});

/* ---------- 浏览器 ---------- */
function playwright() {
  try { return require("playwright"); } catch (_) {}
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) {}
}
let browser;
test.before(async () => { try { browser = await playwright().chromium.launch(); } catch (error) { if (process.env.REQUIRE_UI === "1") throw error; } });
test.after(async () => { if (browser) await browser.close(); });
async function newPage(t, width = 1280, height = 800) {
  if (!browser) { t.skip("Playwright/browser unavailable"); return null; }
  const context = await browser.newContext({ viewport: { width, height } });
  t.after(() => context.close());
  const page = await context.newPage(), errors = []; page.on("pageerror", e => errors.push(e.message));
  return { page, errors };
}
const noOverflow = page => page.evaluate(() => [...document.querySelectorAll(".ss-row")].filter(r => r.offsetParent).every(r => r.scrollWidth <= r.clientWidth + 1 && r.getBoundingClientRect().right <= window.innerWidth + 1));

test("单机单局（真规则）：休整时商店的 买 / 卖，卖出 / 买回走 run sellItem / buybackItem，提示钱进队伍；失败显示原因", async t => {
  const o = await newPage(t); if (!o) return; const { page, errors } = o;
  await page.goto(pathToFileURL(path.join(ROOT, "game.html")).href);
  await page.evaluate(() => {
    window.__noLevelUpPopup = true;
    const run = Rogue.newRun({ party: ["kolt", "helu"], seed: "SELL-UI" });
    run.stage = "camp"; state.kuizhi = 500;
    state.bag = { items: [{ id: "medkit", qty: 3 }, { id: "bp_trevor_bigkill", qty: 1 }, { id: "map_outer", qty: 1 }, { id: "map_desert", qty: 1 }, { id: "ticket_dome", qty: 1 }] };
    Rogue.save(run); RunFlow.resume();
  });
  const host = page.locator('[data-ss-host="run"]');
  await host.waitFor();
  assert.ok(await host.locator("[data-buy]").count() > 0, "默认是「买」");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "shop-sell-buy-tab.png") });
  await host.locator('[data-ss-tab="sell"]').click();
  await page.waitForSelector(".ss-panel");
  assert.equal(await page.locator("[data-ss-host=run] [data-buy]").count(), 0);
  const med = page.locator('.ss-row[data-ss-row="shared|medkit"]');
  assert.match(await med.locator(".ss-unit").innerText(), /300/, "医疗包手册价 600 → 300");
  assert.match(await page.locator('.ss-row[data-ss-row="shared|bp_trevor_bigkill"]').innerText(), /图纸/);
  // 真规则（PR #138 · shopSellCheck）：地图 map_* 和 ticket_dome 是「地图与票券」，和别的原因一样置灰、不能卖
  for (const id of ["map_outer", "map_desert", "ticket_dome"]) {
    const row = page.locator(`.ss-row[data-ss-row="shared|${id}"]`);
    assert.equal(await row.getAttribute("class"), "ss-row off", id);
    assert.match(await row.locator(".ss-why").innerText(), /^地图与票券$/);
    assert.equal(await row.locator("[data-ss-cmd]").isDisabled(), true);
  }
  await med.locator(".ss-inc").click();
  assert.match(await med.locator(".ss-total").innerText(), /600/);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "shop-sell-local.png") });
  await med.locator("[data-ss-cmd]").click();
  await page.waitForSelector(".ss-toast:not([hidden])");
  assert.match(await page.locator(".ss-toast").innerText(), /队伍 \+600/);
  assert.equal(await page.evaluate(() => state.kuizhi), 1100);
  assert.equal(await page.locator(".ss-tab.on").innerText(), "卖", "卖完还停在「卖」页签");
  assert.equal(await page.locator(".ss-buyback .ss-row").count(), 1);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "shop-sell-local-toast.png") });
  await page.locator(".ss-buyback [data-ss-cmd]").click();
  assert.equal(await page.evaluate(() => state.kuizhi), 500);
  assert.equal(await page.locator(".ss-buyback").count(), 0);
  // 钱不够买回：规则抛错 → 提示原因（按钮置灰前先让钱不够）
  await med.locator("[data-ss-cmd]").click();
  await page.evaluate(() => { state.kuizhi = 0; });
  await page.locator('[data-ss-step="1"]').first().click();   // 重画
  assert.equal(await page.locator(".ss-buyback [data-ss-cmd]").isDisabled(), true);
  await page.evaluate(() => { state.kuizhi = 0; const b = document.querySelector(".ss-buyback [data-ss-cmd]"); b.disabled = false; b.click(); });
  await page.waitForFunction(() => /没做成：.*奎支不够/.test(document.querySelector(".ss-toast").textContent));
  assert.deepEqual(errors, []);
});

/* ---------- 结果提示：packet.*.shopSell.last，每个 seq 只弹一次 ---------- */
const toastOf = page => page.evaluate(() => { const t = document.querySelector(".ol-toast"); return t && !t.hidden ? t.textContent : ""; });
const hideToast = page => page.evaluate(() => { document.querySelector(".ol-toast").hidden = true; });
async function lastFlow(page, setLast) {
  // 第一次收到的包已经带着旧的 last：不重播（「开张了」那句不算）
  assert.doesNotMatch(await toastOf(page), /旧的/);
  await hideToast(page);
  await setLast({ seq: 8, kind: "sell", by: "kolt", ok: true, total: 40, payout: [{ to: "kolt", amount: 40 }], msg: "柯尔特 卖掉 破片手雷 ×2，得 40 奎支。" });
  assert.equal(await toastOf(page), "💰 柯尔特 卖掉 破片手雷 ×2，得 40 奎支。 → 柯尔特 +40");
  await hideToast(page);
  await setLast({ seq: 8, kind: "sell", by: "kolt", ok: true, total: 40, payout: [{ to: "kolt", amount: 40 }], msg: "柯尔特 卖掉 破片手雷 ×2，得 40 奎支。" });
  assert.equal(await toastOf(page), "", "同一个 seq 的后续包不再弹");
  await setLast({ seq: 9, kind: "buyback", by: "kolt", ok: false, total: 0, payout: [], msg: "奎支不够（要 10，现有 0）" });
  assert.equal(await toastOf(page), "没做成：奎支不够（要 10，现有 0）");
  await hideToast(page);
  await setLast(null);   // 离开商店
  assert.equal(await toastOf(page), "");
  await setLast({ seq: 10, kind: "buyback", by: "kolt", ok: true, total: 10, payout: [{ to: "kolt", amount: -10 }], msg: "柯尔特 买回 水壶 ×1，花掉 10 奎支。" });
  assert.match(await toastOf(page), /买回 水壶[\s\S]*柯尔特 -10/, "重新进店后的新 seq 照常弹");
}

/* 联机玩家：照 online-ui.test.js 的最小桩子 */
async function online(t, width = 1280, height = 800) {
  const o = await newPage(t, width, height); if (!o) return null; const { page } = o;
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body><section id="scr-title"><div class="t-menu"></div></section><main class="g-app">host</main></body>');
  for (const file of ["game.css", "skin.css", "online.css", "workshop.css", "shop-sell.css"]) await page.addStyleTag({ path: path.join(ROOT, file) });
  await page.evaluate(() => {
    const players = [{ id: "gm", name: "主持人", gm: true, online: true }, { id: "p1", name: "甲", online: true }];
    const state = { displayOnly: true, units: [], turnNo: 1, zoneMode: 3, props: [] };
    window.fixture = { calls: [], listeners: [], reply: { ok: true }, view: { active: true, isHost: false, identity: { id: "p1" }, status: { connected: true, hostOnline: true, paused: false, roster: players }, screen: "exploration", roomCode: "ABCD23", players, state, heroes: [], messages: [], mode: "trpg",
      packet: { view: { mode: "trpg", playerId: "p1", hostId: "gm", units: [], heroes: [], order: [] }, state } },
      emit() { this.listeners.forEach(fn => fn()); }, set(d) { Object.assign(this.view, d); this.emit(); } };
    window.OnlineGame = { getView: () => JSON.parse(JSON.stringify(fixture.view)), slots: () => [], hasSaved: () => false,
      submit(cmd) { fixture.calls.push(JSON.parse(JSON.stringify(cmd))); return fixture.reply; },
      subscribe(fn) { fixture.listeners.push(fn); return () => {}; }, onPacket() { return () => {}; }, actionMenu: async () => ({}) };
  });
  for (const file of ["hud-icons.js", "unit-card.js", "unit-tip.js", "online-battle.js", "shop-sell-ui.js", "online-ui.js"]) await page.addScriptTag({ path: path.join(ROOT, file) });
  return o;
}
const SHOP = { id: "m1", name: "老铁杂货", note: "", discount: 0, rows: [{ key: "medkit", name: "医疗包", hint: "", group: "医疗", base: 30, price: 30, stock: null }], points: null };
const PURSE = { party: 200, heroes: [{ kit: "kolt", name: "柯尔特", mine: true, amount: 120 }, { kit: "helu", name: "赫鲁", mine: false }] };
const own = v => ({ items: v.items.filter(r => r.owner !== "helu"), buyback: v.buyback });

test("跑团联机玩家：物资里的商店有 买 / 卖，卖 / 买回发 shopSell / shopBuyback，新包重画，收摊后回到「买」；390px 不溢出", async t => {
  const o = await online(t); if (!o) return; const { page, errors } = o;
  await page.evaluate(p => { fixture.view.packet = Object.assign(fixture.view.packet, p); fixture.emit(); }, { shop: SHOP, shopSell: own(VIEW), purse: PURSE, mode: "trpg" });
  await page.click('[data-online="supplies"]');
  const host = page.locator('[data-ss-host="trpg"]');
  await host.waitFor();
  assert.equal(await page.locator(".ol-supplies-card").evaluate(e => !!e.closest(".ol-ui, .ovl") || getComputedStyle(e).display !== "none"), true);
  await host.locator('[data-ss-tab="sell"]').click();
  await page.waitForSelector('[data-ss-host="trpg"] .ss-panel');
  assert.equal(await page.locator(".ss-group").count(), 3, "公用、柯尔特、可买回（看不到队友的东西）");
  assert.match(await page.locator('.ss-row[data-ss-row="kolt|vest"]').innerText(), /已装备/);
  await page.locator('.ss-row[data-ss-row="kolt|grenade"] .ss-inc').click();
  assert.match(await page.locator('.ss-row[data-ss-row="kolt|grenade"] .ss-total').innerText(), /40/);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "shop-sell-trpg-online.png") });
  await page.locator('.ss-row[data-ss-row="kolt|grenade"] [data-ss-cmd]').click();
  await page.waitForFunction(() => fixture.calls.length > 0);
  assert.deepEqual(await page.evaluate(() => fixture.calls.pop()), { type: "shopSell", kit: "kolt", id: "grenade", qty: 2, owner: "kolt" });
  // submit 的回执不弹提示；房主算好的 last 到了才弹
  assert.doesNotMatch(await page.locator(".ol-toast").innerText(), /柯尔特 \+40/);
  await page.locator('.ss-buyback [data-ss-cmd]').click();
  await page.waitForFunction(() => fixture.calls.length > 0);
  assert.deepEqual(await page.evaluate(() => fixture.calls.pop()), { type: "shopBuyback", kit: "kolt", token: "bb1" });
  // 新包：可买回清空 → 重画
  await page.evaluate(v => { fixture.view.packet.shopSell = Object.assign({}, v, { buyback: [] }); fixture.emit(); }, own(VIEW));
  await page.waitForFunction(() => !document.querySelector(".ss-buyback"));
  // 390px
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await noOverflow(page), true, "390px 下每行不溢出");
  if (SHOTS) { await page.setViewportSize({ width: 1280, height: 800 }); }
  // 收摊：包里没有 shop 了 → 商店收起；再开张默认「买」
  await page.evaluate(() => { fixture.view.packet.shop = null; fixture.view.packet.shopSell = null; fixture.emit(); });
  await page.evaluate(s => { fixture.view.packet.shop = s; fixture.emit(); }, SHOP);
  await page.waitForSelector('[data-ss-host="trpg"] .ss-tab.on[data-ss-tab="buy"]');
  assert.equal(await page.locator('[data-ss-host="trpg"] [data-ss-tab="sell"]').isDisabled(), true);
  assert.deepEqual(errors, []);
});

test("联机单局玩家：商店区块的 买 / 卖，指令走 rogue.act sellItem / buybackItem", async t => {
  const o = await online(t); if (!o) return; const { page, errors } = o;
  const rogue = { stage: "camp", act: 1, region: "荒原", day: 3, daysLeft: 4, daysPerAct: 7, supplies: { water: 1000, food: 3, hours: 5 },
    heroes: [{ kit: "kolt", name: "柯尔特", mine: true, level: 2, hp: 30, hpMax: 30, xp: 0, purse: 120, ownerName: "甲", weapons: [] }, { kit: "helu", name: "赫鲁", mine: false, level: 2, hp: 30, hpMax: 30, xp: 0, purse: 40, ownerName: "乙", weapons: [] }],
    shop: [{ key: "medkit", name: "医疗包", price: 30, team: true }], shopSell: own(VIEW), vote: { options: [] } };
  await page.evaluate(r => { fixture.view.mode = "rogue"; fixture.view.packet = Object.assign(fixture.view.packet, { mode: "rogue", rogue: r }); fixture.emit(); }, rogue);
  const host = page.locator('[data-ss-host="rogue"]');
  await host.waitFor();
  await host.locator('[data-ss-tab="sell"]').click();
  await page.waitForSelector('[data-ss-host="rogue"] .ss-panel');
  if (SHOTS) { await page.locator('[data-ss-host="rogue"]').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(SHOTS, "shop-sell-rogue-online.png") }); }
  await page.locator('.ss-row[data-ss-row="shared|medkit"] [data-ss-cmd]').click();
  await page.waitForFunction(() => fixture.calls.length > 0);
  assert.deepEqual(await page.evaluate(() => fixture.calls.pop()), { type: "rogue.act", command: { action: "sellItem", kit: "kolt", id: "medkit", qty: 1, owner: "shared" } });
  await page.locator('.ss-buyback [data-ss-cmd]').click();
  await page.waitForFunction(() => fixture.calls.length > 0);
  assert.deepEqual(await page.evaluate(() => fixture.calls.pop()), { type: "rogue.act", command: { action: "buybackItem", kit: "kolt", token: "bb1" } });
  // 离开商店：包里没有 shopSell → 「卖」不可点、回到「买」
  await page.evaluate(() => { const r = fixture.view.packet.rogue; delete r.shopSell; fixture.emit(); });
  await page.waitForSelector('[data-ss-host="rogue"] .ss-tab.on[data-ss-tab="buy"]');
  if (SHOTS) {
    await page.evaluate(v => { fixture.view.packet.rogue.shopSell = v; fixture.emit(); }, own(VIEW));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-ss-host="rogue"] [data-ss-tab="sell"]').click();
    await page.locator('[data-ss-host="rogue"] .ss-panel').scrollIntoViewIfNeeded();
    assert.equal(await noOverflow(page), true);
    await page.screenshot({ path: path.join(SHOTS, "shop-sell-rogue-390.png") });
  }
  assert.deepEqual(errors, []);
});

test("跑团联机玩家：packet.shopSell.last 弹「钱进谁的钱包」，每个 seq 只弹一次；失败弹「没做成」", async t => {
  const o = await online(t); if (!o) return; const { page, errors } = o;
  const old = { seq: 7, kind: "sell", by: "kolt", ok: true, total: 15, payout: [{ to: "party", amount: 15 }], msg: "旧的" };
  await page.evaluate(p => { fixture.view.packet = Object.assign(fixture.view.packet, p); fixture.emit(); }, { shop: SHOP, shopSell: Object.assign(own(VIEW), { last: old }), purse: PURSE, mode: "trpg" });
  await lastFlow(page, last => page.evaluate(([l, v]) => { fixture.view.packet.shopSell = Object.assign({}, v, { last: l }); fixture.emit(); }, [last, own(VIEW)]));
  assert.deepEqual(errors, []);
});

test("联机单局玩家：packet.rogue.shopSell.last 同样按 seq 只弹一次", async t => {
  const o = await online(t); if (!o) return; const { page, errors } = o;
  const rogue = { stage: "camp", act: 1, region: "荒原", day: 3, daysLeft: 4, daysPerAct: 7, supplies: { water: 1000, food: 3, hours: 5 },
    heroes: [{ kit: "kolt", name: "柯尔特", mine: true, level: 2, hp: 30, hpMax: 30, xp: 0, purse: 120, ownerName: "甲", weapons: [] }],
    shop: [{ key: "medkit", name: "医疗包", price: 30, team: true }], shopSell: Object.assign(own(VIEW), { last: { seq: 7, kind: "sell", by: "kolt", ok: true, total: 1, payout: [], msg: "旧的" } }), vote: { options: [] } };
  await page.evaluate(r => { fixture.view.mode = "rogue"; fixture.view.packet = Object.assign(fixture.view.packet, { mode: "rogue", rogue: r }); fixture.emit(); }, rogue);
  await lastFlow(page, last => page.evaluate(l => { const r = fixture.view.packet.rogue; r.shopSell = Object.assign({}, r.shopSell, { last: l }); fixture.emit(); }, last));
  assert.deepEqual(errors, []);
});
