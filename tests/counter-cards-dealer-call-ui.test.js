// High Flux 庄家叫牌（#503）的界面和联机：规则层、AI 在 PR #535（tests/counter-cards-dealer-call.test.js），这里管
// 人当庄家时结算前的「不叫，直接比分」/「叫牌…」→ 选元素牌、庄家座位上的叫牌情况、结算横幅 / 每轮结算 / 规则说明里的叫牌，
// 人当玩家时等庄家叫牌的提示、叫错时横幅写出庄家那一轮的层牌；联机白名单（online-view.js）放行叫牌情况、叫错亮出的层牌只发给玩家那一方。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const MD = require("./mini-dom");
const X = require("./casino-online.helper");

const ROOT = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const DECK = ["thunder", "sand", "glow", "heat", "snow", "acid", "phase"];

function page() {
  const html = read("game.html"), body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const P = MD.create(body, { media: (q) => /prefers-reduced-motion: reduce/.test(q) });
  const ctx = vm.createContext(P.window);
  ["engine.js", "icons.js", "weather-fx.js", "pause-menu.js", "matchup-ui.js", "counter-cards.js", "counter-cards-ai.js", "counter-cards-ui.js"].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const doc = P.document;
  return { w: P.window, $: (s) => doc.querySelector(s), $$: (s) => Array.from(doc.querySelectorAll(s)), UI: P.window.CounterCardsUI, CC: P.window.CounterCards };
}
const click = (el, what) => { assert.ok(el, (what || "要点的东西") + "不在"); el.click(); };
const text = (el) => (el ? el.textContent.replace(/\s+/g, " ") : "");

/** 规则层直接打到叫牌这一步（不经过界面）：庄家出 dealerCard、玩家出 playerCard，都过牌，玩家翻天气 */
function toCall(CC, dealerCard, playerCard) {
  const g = CC.newGame({ seed: "叫牌界面", deck: DECK.slice() });
  const A = (side, type, extra) => CC.act(g, side, Object.assign({ type }, extra || {}));
  A("dealer", "weather", { op: "pass" });
  A("dealer", "play", { card: dealerCard }); A("player", "play", { card: playerCard });
  A("player", "check"); A("dealer", "check");
  if (g.stage === "weather") A("player", "reveal");
  if (g.stage === "normal") A("player", "noNormal");
  if (g.stage === "bet2") { A("dealer", "check"); A("player", "check"); }
  assert.equal(g.stage, "dealerCall", "打到了叫牌这一步");
  return g;
}

test("默认开：新开的对局（不传 dealerCall）下注结束后进叫牌这一步，界面的规则说明写了叫牌", () => {
  const p = page();
  assert.equal(p.CC.CC_CONFIG.dealerCall.enabled, true);
  toCall(p.CC, "flesh", "fire");
  p.UI.start({ side: "dealer", level: "easy", seed: "规则说明", fast: true });
  const rules = text(p.$("#cc-side .cc-rules"));
  assert.match(rules, /叫牌/);
  assert.match(rules, /整局只能叫一次/);
  assert.match(rules, /叫对/); assert.match(rules, /叫错/);
});

test("人当庄家：叫牌这一步有「不叫，直接比分」和「叫牌…」；座位上写「还能叫牌 1 次」；点「叫牌…」列出 7 张元素牌和「取消」，取消回到两个按钮", () => {
  const p = page();
  p.UI.start({ side: "dealer", level: "easy", game: toCall(p.CC, "flesh", "fire"), fast: true });
  assert.ok(p.$('#cc-actions [data-cc="noCall"]'), "不叫");
  assert.match(text(p.$('#cc-actions [data-cc="noCall"]')), /不叫，直接比分/);
  assert.ok(p.$('#cc-actions [data-cc="mode"][data-mode="call"]'), "叫牌…");
  assert.match(text(p.$("#cc-board")), /还能叫牌 1 次/);
  click(p.$('#cc-actions [data-cc="mode"][data-mode="call"]'), "叫牌…");
  const els = p.$$('#cc-actions [data-cc="callElement"]').map(b => b.dataset.element);
  assert.deepEqual(els, Array.from(p.CC.CC_CONFIG.elements), "7 张元素牌都能叫");
  assert.match(text(p.$("#cc-actions .cc-prompt")), /叫对/);
  click(p.$('#cc-actions [data-cc="mode"][data-mode=""]'), "取消");
  assert.ok(p.$('#cc-actions [data-cc="noCall"]'), "取消后回到不叫 / 叫牌");
  assert.equal(p.UI.state().game.stage, "dealerCall", "取消不动牌局");
});

test("人当庄家叫对：横幅写叫对、按差 1 算庄家赢、层牌收回；每轮结算写「你赢 · 叫牌叫对」；座位上写第几轮叫了哪张；层牌回到手上", () => {
  const p = page();
  p.UI.start({ side: "dealer", level: "easy", game: toCall(p.CC, "flesh", "fire"), fast: true });
  click(p.$('#cc-actions [data-cc="mode"][data-mode="call"]'), "叫牌…");
  click(p.$('#cc-actions [data-cc="callElement"][data-element="fire"]'), "叫火");
  const g = p.UI.state().game;
  assert.equal(g.results[0].winner, "dealer");
  assert.deepEqual(JSON.parse(JSON.stringify(g.results[0].call)), { element: "fire", correct: true });
  const banner = text(p.$("#cc-banner"));
  assert.match(banner, /你赢了/);
  assert.match(banner, /叫〔火〕叫对了/);
  assert.match(banner, /按差 1/);
  assert.match(banner, /收回/);
  assert.match(text(p.$("#cc-side .cc-results")), /你赢 · 叫牌叫对/);
  assert.match(text(p.$("#cc-side .cc-log")), /庄家叫〔火〕叫对了/, "记录里的结算写清楚是叫牌定的胜负");
  click(p.$('#cc-banner [data-cc="dismiss"]'), "继续");
  assert.match(text(p.$("#cc-board")), /第 1 轮叫〔火〕· 叫对/);
  assert.ok(g.sides.dealer.hand.includes("flesh"), "肉体回到庄家手上");
});

test("人当庄家不叫：照常比分（结算里没有 call），之后每一轮结算前还会问叫不叫", () => {
  const p = page();
  p.UI.start({ side: "dealer", level: "easy", game: toCall(p.CC, "flesh", "fire"), fast: true });
  click(p.$('#cc-actions [data-cc="noCall"]'), "不叫");
  const g = p.UI.state().game;
  assert.equal(g.results.length, 1);
  assert.equal(g.results[0].call, undefined);
  assert.doesNotMatch(text(p.$("#cc-banner")), /叫〔/);
  assert.equal(g.dealerCall.used, false, "不叫不算用掉");
});

test("人当玩家、AI 庄家叫牌：等的时候写「在想要不要叫牌」；叫错时横幅写庄家那一轮出的层牌（只有玩家看得到），每轮结算写「你赢 · 叫牌叫错」", () => {
  const p = page();
  const g = toCall(p.CC, "armor", "fire");
  p.UI.start({ side: "player", level: "hard", game: g });   // 不是 fast：AI 先不走，看等待的提示
  p.UI.stop();
  assert.match(text(p.$("#cc-actions")), /在想要不要叫牌/);
  // AI 这一步换成「叫冰」（叫错）：看界面怎么写，不靠 AI 的随机
  p.w.CounterCardsAI.step = (game, side) => { p.CC.act(game, side, { type: "callElement", element: "ice" }); return true; };
  p.UI.setFast(true);
  p.UI.render();
  const r = g.results[0];
  assert.equal(r.winner, "player");
  assert.equal(r.call.correct, false);
  const banner = text(p.$("#cc-banner"));
  assert.match(banner, /你赢了/);
  assert.match(banner, /庄家叫〔冰〕叫错了/);
  assert.match(banner, /庄家这一轮出的是〔装甲〕/);
  assert.match(text(p.$("#cc-side .cc-results")), /你赢 · 叫牌叫错/);
});

test("关掉叫牌的对局（newGame({ dealerCall: false })）：座位上不写叫牌情况，下注结束直接结算", () => {
  const p = page();
  p.UI.start({ side: "dealer", level: "easy", seed: "关掉", gameOpt: { dealerCall: false }, fast: true });
  assert.doesNotMatch(text(p.$("#cc-board")), /叫牌/);
});

/* ---------- 联机（online-view.js 白名单） ---------- */
function onlineToCall(seed, dealerCard, playerCard) {
  const r = X.room(seed);
  X.ok(r.send("p2", { op: "open", kit: "ruby" }));
  X.ok(r.send("p2", { op: "sit", kit: "ruby", table: "alley", buyIn: 20, dealer: "gm" }));
  const host = (action) => X.ok(r.send("host", { op: "act", kit: "ruby", asDealer: true, action }));
  const me = (action) => X.ok(r.send("p2", { op: "act", kit: "ruby", action }));
  const game = () => r.mine("p2", "ruby").seat.game;
  host({ type: "weather", op: "pass" }); host({ type: "play", card: dealerCard });
  me({ type: "play", card: playerCard }); me({ type: "check" }); host({ type: "check" });
  if (game().stage === "weather") me({ type: "reveal" });
  if (game().stage === "normal") me({ type: "noNormal" });
  if (game().stage === "bet2") { host({ type: "check" }); me({ type: "check" }); }
  assert.equal(game().stage, "dealerCall", "联机也进叫牌这一步");
  return { r, host, me, game };
}
const dealerPacket = (r) => {
  const d = (r.casino("host").dealing || []).find(m => m.kit === "ruby");
  assert.ok(d && d.game, "主持人那边有这一桌（坐庄的那一方）");
  return d.game;
};

test("联机：玩家收到的包里有叫牌情况（还能叫、legal 里的叫牌操作）；主持人叫错以后玩家的包里有亮出的层牌（revealed），主持人（庄家）那边没有；结算和记录写叫了哪张", () => {
  const { r, host, game } = onlineToCall("CALL-WRONG", "armor", "fire");
  const before = game();
  assert.equal(before.dealerCall.enabled, true);
  assert.equal(before.dealerCall.used, false);
  assert.ok(dealerPacket(r).legal.some(o => o.type === "callElement" && o.element === "ice"), "庄家那边的 legal 带上叫哪张");
  host({ type: "callElement", element: "ice" });
  const v = game();
  assert.equal(v.dealerCallUsed, true);
  assert.deepEqual([v.dealerCall.used, v.dealerCall.element, v.dealerCall.correct, v.dealerCall.round], [true, "ice", false, 1]);
  assert.deepEqual(v.dealerCall.revealed, [{ r: 1, layer: "armor" }], "叫错：玩家看得到庄家那一轮的层牌");
  assert.deepEqual(v.results[0].call, { element: "ice", correct: false });
  assert.ok(v.log.some(e => e.t === "call" && e.element === "ice"), "记录里叫的那张（公开）");
  const d = dealerPacket(r);
  assert.deepEqual(d.dealerCall.revealed, [], "庄家那边不放 revealed");
  assert.deepEqual(d.results[0].call, { element: "ice", correct: false });
});

test("联机：主持人叫对以后，收回的层牌只在庄家自己的包里，玩家的包里只有庄家的手牌张数", () => {
  const { r, host, game } = onlineToCall("CALL-RIGHT", "flesh", "fire");
  host({ type: "callElement", element: "fire" });
  const v = game();
  assert.deepEqual(v.results[0].call, { element: "fire", correct: true });
  assert.deepEqual(v.dealerCall.revealed, []);
  assert.equal(v.opp.hand, undefined, "玩家看不到庄家的手牌");
  assert.equal(v.opp.handCount, 5, "收回以后庄家手上还是 5 张（出了 1 张又收回）");
  assert.ok(!JSON.stringify(v).includes("\"flesh\""), "玩家的包里没有庄家收回的那张层牌");
  assert.ok(dealerPacket(r).me.hand.includes("flesh"), "庄家自己的包里有收回的层牌");
});
