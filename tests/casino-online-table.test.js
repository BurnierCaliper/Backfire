// 联机牌桌的画面（#526 第 3 步）：联机跑团坐着的那一局用本机那几张牌桌画（High Flux：counter-cards-ui.js，Flux Duel / Hold'em：flux-ui.js），
// 操作发联机指令；结算前的过渡、结算横幅、记录（最新的在最下面）和本机一样。
// 一边是真的联机房间（HotseatGame + online-view.js 白名单，tests/casino-online.helper.js），一边是 game.html 的牌桌（tests/mini-dom.js），
// 牌桌只拿玩家真的收到的那一份包（src.view），每走一步再拿新的一包（remoteSync）。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const MD = require("./mini-dom");
const X = require("./casino-online.helper");
const { room, ok, plain, read, playOut } = X;

function page() {
  const html = read("game.html"), body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const P = MD.create(body, { media: (q) => /prefers-reduced-motion: reduce/.test(q) });
  const ctx = vm.createContext(P.window);
  ["engine.js", "icons.js", "weather-fx.js", "pause-menu.js", "matchup-ui.js"].concat(X.RULES, ["counter-cards-ui.js", "flux-ui.js", "flux-duel-ui.js", "flux-holdem-ui.js", "casino-online-ui.js"])
    .forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const doc = P.document;
  return { w: P.window, doc, $: (s) => doc.querySelector(s), $$: (s) => Array.from(doc.querySelectorAll(s)) };
}
const click = (el, what) => { assert.ok(el, (what || "要点的东西") + "不在"); el.click(); };
const tick = () => new Promise(r => setTimeout(r, 0));
/** 一名玩家坐着的那一局接到牌桌上：view 是他真的收到的那一份包（每次 pull 拿新的一包），act 发真的联机指令 */
function seatSrc(r, who, kit, extra) {
  let cur = null;
  const sent = [];
  const pull = () => { const m = r.mine(who, kit); cur = m && m.seat && m.seat.game ? plain(m.seat.game) : null; return cur; };
  pull();
  const src = Object.assign({
    view: () => cur,
    act: (a) => { sent.push(plain(a)); const ack = r.send(who, { op: "act", kit, action: a }); return Promise.resolve(ack.ok ? { ok: true } : { ok: false, error: ack.error }); },
    leave: () => { r.send(who, { op: "leave", kit }); pull(); },
    back: () => { src.backs = (src.backs || 0) + 1; },
    label: "桌子", who: "对手：谁", oppTag: "主持人", level: "normal"
  }, extra || {});
  return { src, pull, sent };
}

test("High Flux · 主持人坐庄的联机牌桌：用本机那张牌桌画（#scr-cc 挂上 .cc-online），手牌能出的才能点、对手的牌不画；点牌发联机指令；顶栏写对手是谁、有「返回赌场」「离桌」", async () => {
  const r = room("CASINO-TABLE-CC"), p = page(), UI = p.w.CounterCardsUI;
  ok(r.send("p2", { op: "open", kit: "ruby" }));
  ok(r.send("p2", { op: "sit", kit: "ruby", table: "alley", buyIn: 20, dealer: "gm" }));
  const { src, pull, sent } = seatSrc(r, "p2", "ruby", { label: "后巷小桌 · 买入 20 枚", who: "庄家：主持人", oppTag: "主持人" });
  assert.equal(UI.remote(src), true);
  const scr = p.$("#scr-cc");
  assert.ok(scr.classList.contains("cc-online") && !scr.hidden, "牌桌露出来，挂上 .cc-online（联机玩家页放行它）");
  assert.ok(!p.$("#cc-game").hidden && p.$("#cc-setup").hidden);
  assert.match(p.$("#cc-top").textContent, /后巷小桌 · 买入 20 枚 · 庄家：主持人/);
  assert.ok(p.$('#cc-top [data-cc="back"]') && p.$('#cc-top [data-cc="leave"]'), "顶栏有「返回赌场」「离桌」");
  assert.match(p.$("#cc-board .cc-opp .cc-who").textContent, /主持人/, "对手座位上写主持人（不写几级 AI）");
  assert.match(p.$("#cc-actions").textContent, /庄家正在想/, "庄家（主持人）先做天气行动");
  // 主持人在他那边走两步（天气不动、暗出肉体）：新的一包到了接着画
  ok(r.send("host", { op: "act", kit: "ruby", asDealer: true, action: { type: "weather", op: "pass" } }));
  ok(r.send("host", { op: "act", kit: "ruby", asDealer: true, action: { type: "play", card: "flesh" } }));
  pull(); UI.remoteSync();
  const playable = p.$$('#cc-board .cc-me button[data-cc="play"]').map(b => b.dataset.card);
  assert.equal(playable.length, 7, "7 张元素牌能出（常态不能当出牌）");
  assert.ok(!p.$('#cc-board .cc-me button[data-card="normal"]'), "常态不能点");
  assert.ok(!p.$("#cc-board").textContent.includes("肉体"), "主持人暗出的层牌不画（只有牌背）");
  assert.ok(p.$("#cc-board .cc-slots .cc-slot .cc-back"), "对手暗出的是一张牌背");
  click(p.$('#cc-board .cc-me button[data-cc="play"]'));
  assert.deepEqual(sent, [{ type: "play", card: playable[0] }], "点牌 = 发联机指令（规则在房主那边跑）");
  await tick(); pull(); UI.remoteSync();
  assert.ok(p.$('#cc-actions [data-cc="check"]'), "第一轮下注玩家先：过牌的按钮");
  click(p.$('#cc-actions [data-cc="check"]'));
  assert.deepEqual(sent[1], { type: "check" });
  // 没做成的（例：不是自己的回合）写在操作栏里
  const before = sent.length;
  await tick(); pull(); UI.remoteSync();
  UI.act({ type: "check" });
  await tick();
  assert.equal(sent.length, before + 1);
  assert.match(p.$("#cc-actions").textContent, /现在不是|不能/, "没做成的原因写在操作栏里");
  UI.remoteClose();
  assert.ok(scr.hidden && !scr.classList.contains("cc-online"), "收起：#scr-cc 藏起来、摘掉 .cc-online");
});

test("High Flux · 联机牌桌的结算前的过渡、结算横幅、记录（最新的在最下面）和本机一样：主持人那一下结算了，牌桌先停在最后一步、判定中，再弹横幅", async () => {
  const r = room("CASINO-TABLE-SETTLE"), p = page(), UI = p.w.CounterCardsUI;
  ok(r.send("p2", { op: "open", kit: "ruby" }));
  ok(r.send("p2", { op: "sit", kit: "ruby", table: "alley", buyIn: 20, dealer: "gm" }));
  const { src, pull } = seatSrc(r, "p2", "ruby", { who: "庄家：主持人" });
  UI.remote(src);
  const host = (action) => ok(r.send("host", { op: "act", kit: "ruby", asDealer: true, action }));
  const me = (action) => ok(r.send("p2", { op: "act", kit: "ruby", action }));
  host({ type: "weather", op: "pass" }); host({ type: "play", card: "armor" });
  me({ type: "play", card: "fire" }); me({ type: "check" }); host({ type: "check" });
  // 翻天气那一步：翻开（翻到常态清天气的问一下就不用）
  me({ type: "reveal" });
  let g = r.mine("p2", "ruby").seat.game;
  if (g.stage === "normal") me({ type: "noNormal" });
  g = r.mine("p2", "ruby").seat.game;
  if (g.stage === "bet2") { host({ type: "check" }); }
  pull(); UI.remoteSync();
  const view = r.mine("p2", "ruby").seat.game;
  if (view.results.length === 0) { me({ type: "check" }); }   // 第二轮下注：主持人过牌以后玩家也过牌，这一下结算
  const s0 = UI.state().seen;
  pull(); UI.remoteSync();
  const now = r.mine("p2", "ruby").seat.game;
  assert.ok(now.results.length >= 1, "这一轮结算了");
  assert.ok(UI.state().seen > s0 || UI.state().settle || UI.state().banner, "看到新的结算");
  const st = UI.state().settle;
  assert.ok(st, "先放结算前的过渡（不是一下就弹横幅）");
  assert.ok(p.$("#cc-banner").hidden, "过渡中横幅还没弹");
  assert.ok(p.$('#cc-actions [data-cc="skipSettle"]'), "过渡中的操作栏：「直接看结算」（High Flux 那一份 CounterCardsUI.settle）");
  assert.ok(!p.$("#cc-side .cc-log").textContent.includes("第 1 轮：玩家赢") && !p.$("#cc-side .cc-log").textContent.includes("第 1 轮：庄家赢"), "记录里还没有这一轮的结果");
  click(p.$('#cc-actions [data-cc="skipSettle"]'));
  assert.ok(!p.$("#cc-banner").hidden, "跳过：弹出结算横幅");
  assert.match(p.$("#cc-banner").textContent, /你赢了|你输了|平局/);
  const items = p.$$("#cc-side .cc-log li").map(li => li.textContent), last = now.log[now.log.length - 1].text;
  assert.equal(items[items.length - 1], last, "记录最新的在最下面");
  UI.remoteClose();
});

test("High Flux · 联机牌桌的追加窗口：倒计时（秒数读房主发来的 window.sec）到了替自己发「不加注」，同一个窗口不再从头数；关窗由房主的规则层来", async () => {
  const r = room("CASINO-TABLE-WIN"), p = page(), UI = p.w.CounterCardsUI;
  r.c.CounterCards.CC_CONFIG.callWindowSec = 0.05;   // 房主那边的配置：包里的 window.sec 跟着它
  ok(r.send("p2", { op: "open", kit: "ruby" }));
  ok(r.send("p2", { op: "sit", kit: "ruby", table: "alley", buyIn: 20, dealer: "gm" }));
  const host = (action) => ok(r.send("host", { op: "act", kit: "ruby", asDealer: true, action }));
  host({ type: "weather", op: "pass" }); host({ type: "play", card: "armor" });
  ok(r.send("p2", { op: "act", kit: "ruby", action: { type: "play", card: "fire" } }));
  ok(r.send("p2", { op: "act", kit: "ruby", action: { type: "bet", amount: 1 } }));
  host({ type: "call" });
  const { src, pull, sent } = seatSrc(r, "p2", "ruby");
  assert.ok(src.view().betting && src.view().betting.window, "主持人跟注：开了追加窗口");
  UI.remote(src);
  assert.ok(p.$("#cc-actions .cc-count"), "倒计时");
  await new Promise(res => setTimeout(res, 160));
  assert.deepEqual(sent, [{ type: "pass" }], "到时间：替自己发「不加注」");
  pull(); UI.remoteSync();
  const w = src.view().betting && src.view().betting.window;
  if (w) assert.ok(!p.$("#cc-actions .cc-count"), "主持人还没表态：同一个窗口不再从头数");
  await new Promise(res => setTimeout(res, 120));
  assert.equal(sent.length, 1, "不会一直重发");
  UI.remoteClose();
});

test("Flux Duel · 玩家对赌的联机牌桌（flux-ui.js 的那一张）：选层牌、元素牌再暗出 = 发联机指令；对手座位写「玩家」；打完总结算有「离桌」「返回赌场」，没有「再来一局」", async () => {
  const r = room("CASINO-TABLE-FD"), p = page(), UI = p.w.FluxDuelUI;
  ok(r.send("p2", { op: "open", kit: "ruby" })); ok(r.send("p3", { op: "open", kit: "helu" }));
  ok(r.send("p2", { op: "buy", kit: "ruby", n: 60 })); ok(r.send("p3", { op: "buy", kit: "helu", n: 60 }));
  ok(r.send("p2", { op: "pvpOpen", kit: "ruby", mode: "duel", side: "a", stakeKind: "chips" }));
  ok(r.send("p3", { op: "pvpJoin", kit: "helu", table: r.casino("p3").open[0].id }));
  const { src, pull, sent } = seatSrc(r, "p2", "ruby", { label: "Flux Duel 对赌", who: "对手：" + r.c.trpgPurseName("helu"), oppTag: "玩家" });
  assert.equal(UI.remote(src), true);
  assert.ok(p.$("#scr-fd").classList.contains("cc-online"));
  assert.match(p.$("#fd-top").textContent, /Flux Duel 对赌 · 对手：/);
  assert.match(p.$("#fd-board .cc-opp .cc-who small").textContent, /^玩家$/, "对手是玩家（不写 AI）");
  assert.equal(p.$$('#fd-board .fd-row[data-row="layer"] button.cc-can').length, 5);
  click(p.$('#fd-board .fd-row[data-row="layer"] button.cc-can'));
  click(p.$('#fd-board .fd-row[data-row="element"] button.cc-can'));
  click(p.$('#fd-actions [data-fd="play"]'), "暗出");
  assert.equal(sent.length, 1); assert.equal(sent[0].type, "play"); assert.ok(sent[0].layer && sent[0].element);
  await tick(); pull(); UI.remoteSync();
  assert.equal(p.$$("#fd-board .fd-slots .cc-back .cc-peek").length, 2, "自己暗出的两张：牌背上角标着是什么");
  // 两边在各自那边打完这一局（真的联机指令），牌桌拿到最后一包：先放过渡，跳过以后是总结算
  playOut(r.send, [{ who: "p2", game: () => r.mine("p2", "ruby").seat.game, cmd: { kit: "ruby" } }, { who: "p3", game: () => r.mine("p3", "helu").seat.game, cmd: { kit: "helu" } }]);
  pull(); UI.remoteSync();
  const skip = p.$('#fd-actions [data-fd="skipSettle"]');
  if (skip) click(skip);
  for (let i = 0; i < 6 && p.$('#fd-banner [data-fd="dismiss"]'); i++) click(p.$('#fd-banner [data-fd="dismiss"]'));
  const fin = p.$("#fd-banner .cc-final");
  assert.ok(fin, "总结算");
  assert.ok(fin.querySelector('[data-fd="leave"]') && fin.querySelector('[data-fd="back"]'), "离桌、返回赌场");
  assert.ok(!fin.querySelector('[data-fd="casinoAgain"]'), "联机没有「再来一局」");
  const items = p.$$("#fd-side .cc-log li").map(li => li.textContent), log = src.view().log;
  assert.equal(items[items.length - 1], log[log.length - 1].text, "记录最新的在最下面（#526：Flux 的牌桌也一样）");
  // 离桌：发离桌指令，包里没有这一局了，牌桌自己收起
  click(fin.querySelector('[data-fd="leave"]'));
  UI.remoteSync();
  assert.ok(p.$("#scr-fd").hidden && !p.$("#scr-fd").classList.contains("cc-online"), "离桌了：牌桌收起");
});

test("Flux Hold'em · 多人桌的联机牌桌：每个座位写坐的是玩家 / 主持人 / 几级 AI；轮到自己盖牌点一张 = 发联机指令；别人的手牌只有牌背", async () => {
  const r = room("CASINO-TABLE-FH"), p = page(), UI = p.w.FluxHoldemUI;
  ok(r.send("p2", { op: "open", kit: "ruby" })); ok(r.send("p3", { op: "open", kit: "helu" }));
  ok(r.send("p2", { op: "buy", kit: "ruby", n: 20 })); ok(r.send("p3", { op: "buy", kit: "helu", n: 20 }));
  ok(r.send("p2", { op: "holdemOpen", kit: "ruby", table: "holdem-hall", buyIn: 30, size: 4 }));
  const id = r.casino("p2").holdem[0].id;
  ok(r.send("p3", { op: "holdemJoin", kit: "helu", table: id }));
  ok(r.send("host", { op: "holdemGm", table: id, asGm: true }));
  ok(r.send("p2", { op: "holdemStart", kit: "ruby", table: id }));
  const tag = { p1: "玩家", p2: "玩家", p3: "主持人", p4: "普通 AI" };
  const { src, pull, sent } = seatSrc(r, "p2", "ruby", { label: "Flux Hold'em · 大厅 · 多人桌", who: "4 人桌", seatTag: (s) => tag[s] });
  assert.equal(UI.remote(src), true);
  const seatText = (s) => p.$(`#fh-board .fh-seat[data-seat="${s}"] .fh-name`).textContent;
  assert.match(seatText("p2"), new RegExp(r.c.trpgPurseName("helu") + "玩家"));
  assert.match(seatText("p3"), /主持人主持人/);
  assert.match(seatText("p4"), /AI 甲普通 AI/);
  assert.ok(p.$$("#fh-board .fh-seat .cc-face, #fh-board .fh-seat button").length === 0, "别人的手牌只有牌背");
  // 第 1 轮庄家是 p1（自己）：先偷看天气堆顶，留在顶上 / 压到堆底
  assert.ok(p.$('#fh-actions [data-fh="place"]'), "庄家偷看那一步的按钮");
  click(p.$('#fh-actions [data-fh="place"][data-where="top"]'));
  assert.deepEqual(sent[0], { type: "place", where: "top" });
  await tick(); pull(); UI.remoteSync();
  const card = p.$("#fh-board .cc-me button.cc-can");
  assert.ok(card, "盖牌：手里的牌能点");
  click(card);
  assert.equal(sent[1].type, "play"); assert.equal(sent[1].card, card.dataset.card);
  UI.remoteClose();
});

test("赌场大厅（casino-online-ui.js）接牌桌：坐下就开局的直接打开牌桌、收起大厅；牌桌上「返回赌场」回大厅（不离桌）；大厅里「打开牌桌」再打开", async () => {
  const r = room("CASINO-TABLE-LOBBY"), p = page();
  ok(r.send("p2", { op: "open", kit: "ruby" }));
  // 联机玩家页：舞台上有工具栏（「赌场」按钮挂在这里），包是玩家真的收到的那一份
  const stage = p.doc.createElement("main"); stage.id = "online-stage";
  stage.innerHTML = '<header class="ol-stage-heading"><div class="ol-info-tools"></div></header>';
  p.doc.body.appendChild(stage);
  let packet = null;
  const pullAll = () => { packet = { active: true, isHost: false, screen: "exploration", packet: { mode: "trpg", view: { casino: r.casino("p2") } } }; };
  pullAll();
  const api = { submit: async (cmd) => { const ack = r.send("p2", cmd); pullAll(); return ack.ok ? { ok: true } : { ok: false, error: ack.error }; } };
  const call = async (fn) => { const res = await fn(); return !(res && res.ok === false); };
  const x = p.w.CasinoOnlineUI.mount({ api, view: () => packet, own: () => "p2", call });
  x.sync();
  click(p.$('#online-stage [data-cso="open-box"]'), "工具栏上的「赌场」");
  const box = p.$("#online-casino");
  assert.ok(!box.hidden, "大厅打开");
  click(box.querySelector('[data-cso="sit"][data-table="hall"][data-dealer="ai"]'), "坐下（AI 坐庄）");
  await tick(); await tick(); x.sync();
  assert.ok(p.$("#scr-cc").classList.contains("cc-online") && !p.$("#scr-cc").hidden, "坐下就开局：直接打开牌桌");
  assert.ok(box.hidden, "大厅收起");
  assert.match(p.$("#cc-top").textContent, /大厅 · 买入 30 枚 · 庄家：普通 AI/);
  // 牌桌上出一张牌：新的一包到了（online-ui.js 重画时叫 x.sync），牌桌接着画
  click(p.$('#cc-board .cc-me button[data-cc="play"]'));
  await tick(); await tick(); x.sync();
  assert.ok(p.w.CounterCardsUI.state().rv.me.card, "出了牌：牌桌拿到新的一包");
  click(p.$('#cc-top [data-cc="back"]'), "返回赌场");
  assert.ok(p.$("#scr-cc").hidden && !box.hidden, "回到大厅（不离桌）");
  assert.ok(r.mine("p2", "ruby").seat, "还坐在桌上");
  assert.match(box.innerHTML, /data-cso="table" data-kit="ruby"/);
  click(box.querySelector('[data-cso="table"]'), "打开牌桌");
  assert.ok(!p.$("#scr-cc").hidden && box.hidden);
  // 离桌：牌桌收起，回到大厅看结算
  click(p.$('#cc-top [data-cc="leave"]'));
  await tick(); await tick(); x.sync();
  assert.ok(p.$("#scr-cc").hidden && !box.hidden, "离桌了：回大厅");
  assert.match(box.textContent, /上一局：离开大厅/);
  x.destroy();
});

/* ---------- 真浏览器（手机 390×844）：没装 Playwright 时用机器自带的 Chrome（tests/cdp-browser.js），都没有才跳过 ----------
 * 页面上自己当房主：trpg.js 的赌场函数直接跑（同 hotseat-game.js · casinoCommand，不查权限），包照样过 online-view.js 白名单再给赌场大厅；
 * body 加 .online-player（联机玩家页的样式：只放行 .ol-ui / .ovl / .cc-online……），从大厅点坐下 → 牌桌上一直点到总结算 → 离桌回大厅 */
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execSync } = require("node:child_process");
function findPlaywright() {
  try { return require("playwright"); } catch (e) {}
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (e) {}
  return null;
}
const pw = findPlaywright();
let browser = null, cdp = null, skipWhy = "";
async function uiBrowser() {
  if (browser || cdp) return browser || cdp;
  if (skipWhy) return null;
  if (pw) { try { browser = await pw.chromium.launch(); return browser; } catch (e) { skipWhy = "浏览器启动失败：" + e.message.split("\n")[0]; } }
  try { cdp = await require("./cdp-browser").launch(); } catch (e) { skipWhy = "浏览器启动失败，跳过画面测试：" + String(e.message).split("\n")[0]; }
  if (!cdp && !skipWhy) skipWhy = "没装 Playwright，也没有能用的 Chrome，跳过画面测试";
  if (!cdp && process.env.REQUIRE_UI === "1") throw new Error("UI 验收需要浏览器：" + skipWhy);
  return cdp;
}
test.after(async () => { if (browser) await browser.close(); if (cdp) await cdp.close(); });

/** 页面上搭一个联机房间（自己当房主）、挂赌场大厅 */
function setupOnline() {
  Object.assign(CounterCardsUI.UI_CONFIG.settle, { lastMs: 60, judgeMs: 60, reducedJudgeMs: 60 });
  BattleSim.setup({ party: ["ruby", "helu", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "ONLINE-CASINO-UI" });
  TRPG.active = true;
  LEDGER.purse = { ruby: 30000, helu: 30000 };
  trpgCasinoOpen("ruby");
  trpgCasinoBuy(100, "ruby", "ruby");
  document.body.classList.add("online-player");
  // 页面一打开 online-ui.js 自己挂了一份（没连上房间）：它的舞台、赌场浮层拿掉，换成这里的
  document.querySelectorAll("#online-stage, #online-casino").forEach(n => n.remove());
  const stage = document.createElement("main");
  stage.id = "online-stage"; stage.className = "ol-ui";
  stage.innerHTML = '<header class="ol-stage-heading"><div class="ol-info-tools"></div></header>';
  document.body.appendChild(stage);
  const ops = {
    open: c => trpgCasinoOpen(c.kit), buy: c => trpgCasinoBuy(c.n, c.kit, c.kit), sell: c => trpgCasinoSell(c.n, c.kit, c.kit),
    sit: c => trpgCasinoSitAt(c.kit, c.table, c.buyIn, { dealer: c.dealer === "gm" ? "gm" : "ai" }),
    act: c => trpgCasinoAct(c.kit, c.action, {}), leave: c => trpgCasinoLeave(c.kit),
    holdemOpen: c => trpgCasinoHoldemOpen(c.kit, c.table, c.buyIn, c.size), holdemStart: c => trpgCasinoHoldemStart(c.table, c.kit)
  };
  let view = null, x = null;
  const pull = () => {
    const raw = JSON.parse(JSON.stringify({ playerId: "p2", hostId: "host", casino: trpgCasinoPacket(["ruby"], false) }));
    view = { active: true, isHost: false, screen: "exploration", packet: { mode: "trpg", view: { casino: OnlineView.projectView(raw, { recipientId: "p2" }).casino } } };
  };
  pull();
  const api = { submit: async (cmd) => {
    let ack;
    try { ops[cmd.op](cmd); ack = { ok: true }; } catch (e) { ack = { ok: false, error: e.message }; }
    pull(); setTimeout(() => x.sync(), 0);
    return ack;
  } };
  x = CasinoOnlineUI.mount({ api, view: () => view, own: () => "p2", call: async fn => { const r = await fn(); return !(r && r.ok === false); } });
  window.__cso = x;
  x.sync();
}
/** 牌桌上一步（K = cc / fd / fh）：过渡中等着；横幅点「继续」；轮到自己出牌点牌（Duel 层牌、元素牌各一张再暗出）；下注点过牌 / 跟注 / 不加注…… */
function tableStep(K) {
  const q = (s) => document.querySelector(s), A = "data-" + K, scr = q("#scr-" + K);
  const box = window.__cso.el;
  const overflow = Math.max(scr.scrollWidth, document.documentElement.scrollWidth, box && !box.hidden ? box.scrollWidth : 0) - innerWidth;
  const UI = { cc: CounterCardsUI, fd: FluxDuelUI, fh: FluxHoldemUI }[K], S = UI.state();
  const shown = !!(scr.classList.contains("cc-online") && getComputedStyle(scr).display !== "none");
  if (!S || !S.remote) return { closed: true, overflow };
  if (S.settle) return { settle: S.settle.phase, overflow, shown };
  if (S.busy) return { wait: true, overflow, shown };
  const banner = q("#" + K + "-banner");
  if (!banner.hidden) {
    if (banner.querySelector(".cc-final")) return { done: true, overflow, shown };
    banner.querySelector(`[${A}="dismiss"]`).click();
    return { overflow, shown };
  }
  if (K === "cc") { const c = q('#cc-board .cc-me button[data-cc="play"]'); if (c) { c.click(); return { overflow, shown }; } }
  if (K === "fd") {
    const can = (row) => q(`#fd-board .fd-row[data-row="${row}"] button.cc-can`), sel = (row) => q(`#fd-board .fd-row[data-row="${row}"] .fd-sel`);
    if (can("layer") && !sel("layer")) { can("layer").click(); return { overflow, shown }; }
    if (can("element") && !sel("element")) { can("element").click(); return { overflow, shown }; }
  }
  if (K === "fh") { const c = q("#fh-board .cc-me button.cc-can"); if (c) { c.click(); return { overflow, shown }; } }
  const btns = [...document.querySelectorAll(`#${K}-actions button[${A}]`)].filter(b => !b.disabled && b.getAttribute(A) !== "amt");
  const pick = ["play", "check", "call", "pass", "reveal", "noNormal", "allIn", "noLoan", "place"].map(a => btns.find(b => b.getAttribute(A) === a)).find(Boolean)
    || btns.find(b => b.classList.contains("primary"));
  if (pick) { pick.click(); return { overflow, shown }; }
  return { wait: true, overflow, shown };
}

/** 等页面上的条件成立；超时了写清楚等的是什么、页面上是什么样（牌桌操作栏的字、大厅的提示） */
async function waitIn(page, fn, arg, what) {
  try { await page.waitForFunction(fn, arg, { timeout: 5000 }); } catch (e) {
    const at = await page.evaluate(() => ({ lobby: window.__cso.el.hidden ? "（大厅收着）" : window.__cso.el.textContent.slice(0, 300),
      tables: ["cc", "fd", "fh"].map(k => k + ":" + document.querySelector("#scr-" + k).className + " " + (document.querySelector("#" + k + "-actions") || {}).textContent) }));
    throw new Error(`等「${what}」超时：${JSON.stringify(at)}`);
  }
}

test("真浏览器（手机 390×844）：联机玩家页上从赌场大厅坐下，High Flux、Flux Duel、Flux Hold'em（赌场桌、多人桌）各打一局——用本机那几张牌桌、结算前的过渡照常放，不报错、没有横向溢出", { timeout: 300000 }, async (t) => {
  const b = await uiBrowser();
  if (!b) { t.skip(skipWhy); return; }
  const context = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await require("./old-screen")(context);
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(require("./headless").ROOT, "game.html")).href);
  await page.evaluate(setupOnline);
  const games = [
    { K: "cc", sit: '[data-cso="sit"][data-table="hall"][data-dealer="ai"]' },
    { K: "fd", sit: '[data-cso="sit"][data-table="duel-hall"][data-dealer="ai"]' },
    { K: "fh", sit: '[data-cso="sit"][data-table="holdem-hall"][data-dealer="ai"]' },
    { K: "fh", multi: true }
  ];
  const bad = [], phases = new Set();
  for (const gm of games) {
    // 打开大厅、坐下（多人桌：开一桌两人桌，开桌的人开局，空座位 AI 补）——坐下就开局的直接打开牌桌
    const name = gm.K + (gm.multi ? "（多人桌）" : "");
    // 直接打开（页面上 online-ui.js 自己挂的那一份也在听「赌场」按钮，它没连上房间，会先把按钮收掉）
    await page.evaluate(() => window.__cso.open());
    await waitIn(page, () => !window.__cso.el.hidden, null, name + "：打开大厅");
    if (gm.multi) {
      await page.evaluate(() => { const s = window.__cso.el.querySelector('[data-cso-in="hSize"]'); s.value = "2"; s.dispatchEvent(new Event("change", { bubbles: true })); });
      await page.evaluate(() => window.__cso.el.querySelector('[data-cso="holdemOpen"]').click());
      await waitIn(page, () => !!window.__cso.el.querySelector('[data-cso="holdemStart"]'), null, name + "：开了桌，有「开局」");
      await page.evaluate(() => window.__cso.el.querySelector('[data-cso="holdemStart"]').click());
    } else await page.evaluate((sel) => window.__cso.el.querySelector(sel).click(), gm.sit);
    await waitIn(page, (K) => document.querySelector("#scr-" + K).classList.contains("cc-online"), gm.K, name + "：坐下就打开牌桌");
    let done = false, over = 0;
    for (let i = 0; i < 3000 && !done; i++) {
      const m = await page.evaluate(tableStep, gm.K);
      if (m.closed) { bad.push(`${gm.K}：牌桌没开`); break; }
      if (m.shown === false) bad.push(`${gm.K}：联机玩家页上牌桌被藏起来了`);
      if (m.settle) phases.add(gm.K + ":" + m.settle);
      if (m.overflow > 1) over = Math.max(over, m.overflow);
      done = !!m.done;
      if (m.settle || m.wait) await page.waitForTimeout(20); else await page.waitForTimeout(5);
    }
    if (over > 1) bad.push(`${gm.K}${gm.multi ? "（多人桌）" : ""}：横向溢出 ${over}px`);
    assert.ok(done, `${gm.K}${gm.multi ? "（多人桌）" : ""}：打完了，有总结算`);
    // 离桌：牌桌收起，回大厅
    await page.evaluate((K) => document.querySelector(`#${K}-banner [data-${K}="leave"]`).click(), gm.K);
    await waitIn(page, () => !window.__cso.el.hidden, null, name + "：离桌回到大厅");
    const back = await page.evaluate((K) => ({ table: document.querySelector("#scr-" + K).classList.contains("cc-online"), lobby: !window.__cso.el.hidden,
      overflow: Math.max(window.__cso.el.scrollWidth, document.documentElement.scrollWidth) - innerWidth, last: window.__cso.el.textContent.includes("上一局：") }), gm.K);
    assert.ok(!back.table && back.lobby, `${gm.K}：离桌回到大厅`);
    assert.ok(back.last, `${gm.K}：大厅写着上一局的结算`);
    if (back.overflow > 1) bad.push(`大厅横向溢出 ${back.overflow}px`);
    await page.evaluate(() => window.__cso.el.querySelector('[data-cso="close"]').click());
  }
  assert.deepEqual(bad, [], "牌桌、大厅都没有横向溢出");
  assert.ok([...phases].some(p => p.endsWith(":last")), "结算前的过渡照常放：" + [...phases].join("、"));
  assert.deepEqual(errors, []);
});

test("手机竖屏：联机牌桌就是本机那几张牌桌（同一份 counter-cards.css / flux.css 的手机排法）；联机玩家页放行 .cc-online、压在联机画面上面；大厅的开桌几栏能折行", () => {
  const css = read("online.css"), casinoCss = read("casino.css");
  assert.match(css, /:not\(\.pm-overlay\):not\(#hd2d-pop\):not\(\.cc-online\) \{ display: none !important; \}/, "联机玩家页放行 .cc-online");
  assert.match(casinoCss, /\.scr-cc\.cc-online \{ z-index: 92; \}/, "压在联机舞台（40）、侧栏（45）、浮动按钮（82）、弹窗（90）上面");
  assert.match(casinoCss, /@media \(max-width: 600px\) \{[^}]*white-space: normal/, "手机上开桌那几栏能折行");
  assert.match(read("counter-cards.css"), /@media \(max-width: 600px\)/, "牌桌自己的手机排法照旧");
});
