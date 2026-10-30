// Flux Duel（#488）· 界面 flux-duel-ui.js（共用零件 flux-ui.js）：标题「本地玩法」里的入口（名字读配置、排在 High Flux 后面）、设置页（座位、难度、规则）、
// 牌桌（自己的手牌两排正面朝上、对方只有牌背、这一轮的天气背面朝上，第一轮下注后才翻开）、选一张层牌 + 一张元素牌再「暗出」、
// 用点按钮的方式和三档 AI 打完一局、结算不亮牌（亮牌开关打开时写双方的牌）、跟注后追加窗口、克制表和元素牌的悬停预览按这一轮的天气算实际得分。
// Node 里用 tests/mini-dom.js 跑 game.html 的真页面结构
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const MD = require("./mini-dom");

const ROOT = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const J = v => JSON.parse(JSON.stringify(v));
const LEVELS = ["easy", "normal", "hard"];
const DECK = ["heat", "glow", "acid", "thunder", "snow", "sand", "phase"];

/** game.html 的 <body> 解析进小 DOM，按 game.html 的先后加载 Flux Duel 要的脚本（计分要 engine.js；牌面借 counter-cards-ui.js；克制表浮层 matchup-ui.js） */
function page() {
  const html = read("game.html"), body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const P = MD.create(body, { media: (q) => /prefers-reduced-motion: reduce/.test(q) });
  const ctx = vm.createContext(P.window);
  ["engine.js", "icons.js", "weather-fx.js", "pause-menu.js", "matchup-ui.js", "counter-cards.js", "counter-cards-ai.js", "flux-duel.js", "flux-duel-ai.js",
    "counter-cards-ui.js", "flux-ui.js", "flux-duel-ui.js"].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const doc = P.document;
  return { w: P.window, doc, $: (s) => doc.querySelector(s), $$: (s) => Array.from(doc.querySelectorAll(s)), UI: P.window.FluxDuelUI, D: P.window.FluxDuel, CC: P.window.CounterCards };
}
const click = (el) => { assert.ok(el, "要点的东西不在"); el.click(); };
const visible = (el) => !!el && !el.hidden;
const fireEv = (p, el, type, o) => { assert.ok(el, "要碰的东西不在：" + type); const ev = new p.w.Event(type, Object.assign({ bubbles: true }, o || {})); el.dispatchEvent(ev); return ev; };
const hover = (p, el) => fireEv(p, el, "pointerover", { pointerType: "mouse" });
const mine = (p, face) => p.$(`#fd-board .cc-me [data-face="${face}"]`);
const tipScores = (p) => p.$$("#fd-tip [data-layer] b").map(b => b.textContent);
const fmt = (n) => (n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0");
const chartRow = (p, el, w) => J(p.CC.chart(w).cells[p.CC.CC_CONFIG.elements.indexOf(el)].map(x => fmt(x.value)));
/** 点一张层牌、一张元素牌，再点「暗出」 */
function playPair(p, layer, element) {
  click(mine(p, layer));
  click(mine(p, element));
  click(p.$('#fd-actions [data-fd="play"]'));
}
/** 一直点「过牌」/「跟注」/ 追加窗口的「不加注」，直到这个下注回合结束 */
function betThrough(p, game, stage) {
  for (let i = 0; i < 10 && game.stage === stage && !p.UI.state().banner; i++) click(p.$('#fd-actions [data-fd="check"]') || p.$('#fd-actions [data-fd="call"]') || p.$('#fd-actions [data-fd="pass"]'));
}
/** 一直点到这一局结束：有结算横幅就点「继续」；轮到自己出牌就各点第一张能点的层牌、元素牌再暗出；下注随机换着点 */
function playThrough(p, rng) {
  let guard = 0;
  while (guard++ < 400) {
    const banner = p.$("#fd-banner");
    if (visible(banner)) {
      if (banner.querySelector(".cc-final")) return;
      click(banner.querySelector('[data-fd="dismiss"]'));
      continue;
    }
    const st = p.UI.state();
    if (st.game.stage === "play" && p.$('#fd-board .cc-me button.cc-can')) {
      const ly = p.$('#fd-board .fd-row[data-row="layer"] button.cc-can'), el = p.$('#fd-board .fd-row[data-row="element"] button.cc-can');
      playPair(p, ly.dataset.face, el.dataset.face);
      continue;
    }
    const btns = p.$$("#fd-actions button[data-fd]").filter(b => !b.disabled && b.dataset.fd !== "amt");
    assert.ok(btns.length, "没有能点的按钮：" + st.game.stage);
    const bet = btns.filter(b => ["check", "call", "bet", "raise", "fold", "pass"].includes(b.dataset.fd));
    let pick;
    if (bet.length) pick = rng() < 0.08 ? bet.find(b => b.dataset.fd === "fold") : bet[Math.floor(rng() * bet.length)];
    else pick = btns.find(b => b.classList.contains("primary")) || btns[0];
    click(pick || btns[0]);
  }
  assert.fail("点了 400 下还没打完");
}
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

test("标题「本地玩法」里 Flux Duel 排在 High Flux 后面，按钮上的名字读配置；点进去是设置页（座位、对手难度、规则写三档分档），开局", () => {
  const p = page();
  const ids = p.$$("#t-panel-local .t-btn").map(b => b.id);
  assert.ok(ids.indexOf("t-fd") === ids.indexOf("t-cc") + 1, "排在 High Flux 后面：" + ids.join(","));
  const entry = p.$("#t-panel-local #t-fd");
  assert.equal(entry.querySelector("b").textContent, p.D.DUEL_CONFIG.name);
  assert.equal(entry.querySelector("b").textContent, "Flux Duel");
  click(entry);
  assert.ok(visible(p.$("#scr-fd")));
  assert.ok(visible(p.$("#fd-setup")));
  assert.ok(!visible(p.$("#fd-game")));
  assert.equal(p.doc.body.dataset.screen, "fluxDuel");
  const setup = p.$("#fd-setup").textContent;
  assert.match(setup, /Flux Duel/);
  assert.match(setup, /先手/); assert.match(setup, /后手/);
  assert.match(setup, /简单/); assert.match(setup, /困难/);
  const rules = p.$("#fd-setup .cc-rules").textContent;
  assert.match(rules, /差 1赢家拿走底池；差 2赢家拿走底池，输家再赔自己这一轮下注额的 0.5 倍；差 3 及以上赢家拿走底池，输家再赔自己这一轮下注额的 1 倍/);
  assert.match(rules, /不亮牌/);
  assert.match(rules, /打平底池滚到下一轮，最后一轮双方平分/);
  click(p.$('[data-fd="set"][data-key="side"][data-val="b"]'));
  click(p.$('[data-fd="set"][data-key="level"][data-val="hard"]'));
  assert.equal(p.$('[data-fd="set"][data-key="level"][data-val="hard"]').getAttribute("aria-pressed"), "true");
  click(p.$('[data-fd="start"]'));
  assert.ok(visible(p.$("#fd-game")));
  const st = p.UI.state();
  assert.equal(st.human, "b");
  assert.equal(st.level, "hard");
  assert.match(p.$("#fd-top").textContent, /Flux Duel/);
  assert.match(p.$("#fd-top").textContent, /对手：困难 AI/);
  p.UI.stop();
});

test("牌桌：自己的手牌两排正面朝上（5 张层牌、7 张元素牌），对方只有牌背；这一轮的天气背面朝上（桌上找不到天气的名字），第一轮下注后才翻开", () => {
  const p = page();
  const game = p.UI.start({ side: "a", level: "normal", seed: "桌面", fast: true, gameOpt: { deck: DECK } });
  assert.deepEqual(p.$$('#fd-board .fd-row[data-row="layer"] .cc-card').map(x => x.dataset.face), J(p.CC.CC_CONFIG.layers));
  assert.deepEqual(p.$$('#fd-board .fd-row[data-row="element"] .cc-card').map(x => x.dataset.face), J(p.CC.CC_CONFIG.elements));
  assert.equal(p.$$("#fd-board .cc-opp .cc-back").length, 10, "对方（AI 已经暗出了一对）手里 4 + 6 张牌背");
  assert.match(p.$("#fd-board .cc-opp .fd-backs").textContent, /层牌 4[\s\S]*元素牌 6/);
  assert.equal(p.$$("#fd-board .cc-opp [data-face]").length, 0, "对方的牌面不在画面里");
  assert.ok(p.$("#fd-board .cc-wnow .fd-wback"), "这一轮的天气背面朝上");
  assert.ok(!p.$("#fd-board [data-weather]"), "桌上没有翻开的天气牌");
  assert.ok(!p.$("#fd-board").textContent.includes("酷暑"), "看不出这一轮是什么天气");
  assert.match(p.$("#fd-board .cc-wnow").textContent, /第一轮下注后翻开/);
  assert.equal(p.$("#fd-board .cc-deck b").textContent, "6");
  // AI（对手）已经暗出：桌上是两张牌背
  assert.equal(p.$$("#fd-board .fd-slots .fd-slot")[0].querySelectorAll(".cc-back").length, 2);
  playPair(p, "flesh", "physical");
  assert.equal(p.$$("#fd-board .fd-slots .fd-slot")[1].querySelectorAll(".cc-back").length, 2, "自己暗出的两张也是牌背");
  assert.match(p.$$("#fd-board .fd-slots .fd-slot")[1].textContent, /肉体[\s\S]*物理/, "自己那两张在角上标一下");
  assert.equal(game.stage, "bet1");
  assert.ok(!p.$("#fd-board [data-weather]"));
  betThrough(p, game, "bet1");
  assert.equal(game.weather, "heat");
  assert.equal(p.$("#fd-board .cc-wnow [data-weather]").dataset.weather, "heat", "第一轮下注后翻开");
  assert.equal(p.$("#fd-game").dataset.weather, "heat", "天气特效跟着换");
  p.UI.stop();
});

test("出牌：层牌、元素牌各点一张选中（再点一下取消），两张都选了「暗出」才能点；用过的元素牌下一轮就不在手里了", () => {
  const p = page();
  const game = p.UI.start({ side: "a", level: "easy", seed: "出牌", fast: true, gameOpt: { deck: DECK } });
  const play = () => p.$('#fd-actions [data-fd="play"]');
  assert.ok(play().disabled);
  click(mine(p, "armor"));
  assert.ok(mine(p, "armor").classList.contains("fd-sel"));
  assert.ok(play().disabled, "只选了层牌");
  click(mine(p, "fire"));
  assert.ok(!play().disabled);
  assert.match(play().textContent, /暗出 〔装甲〕〔火〕/);
  click(mine(p, "armor"));
  assert.ok(!mine(p, "armor").classList.contains("fd-sel"), "再点一下取消");
  assert.ok(play().disabled);
  click(mine(p, "sand"));
  click(play());
  assert.equal(game.sides.a.layer, "sand");
  assert.equal(game.sides.a.element, "fire");
  assert.ok(!p.$("#fd-board .cc-me button.cc-can"), "出过了，手牌不能再点");
  // 打完这一轮：火、沙尘不在手里了
  for (let i = 0; i < 30 && game.round === 1; i++) {
    if (p.UI.state().banner) { click(p.$('#fd-banner [data-fd="dismiss"]')); continue; }
    click(p.$('#fd-actions [data-fd="check"]') || p.$('#fd-actions [data-fd="call"]') || p.$('#fd-actions [data-fd="pass"]') || p.$('#fd-actions [data-fd="noLoan"]'));
  }
  if (p.UI.state().banner) click(p.$('#fd-banner [data-fd="dismiss"]'));
  assert.equal(game.round, 2);
  assert.ok(!mine(p, "fire") && !mine(p, "sand"));
  assert.equal(p.$$('#fd-board .fd-row[data-row="element"] .cc-card').length, 6);
  p.UI.stop();
});

test("用点按钮的方式和三档 AI 各打完一局（先手、后手都坐）：结算横幅只有胜负、分档、筹码变动，写「不亮牌」，画面里从来没有对方的牌面", () => {
  for (const level of LEVELS) for (const side of ["a", "b"]) {
    const p = page();
    const game = p.UI.start({ side, level, seed: `点完-${level}-${side}`, fast: true });
    const opp = game.sides[p.D.other(side)];
    playThrough(p, rng(level.length * 7 + side.charCodeAt(0)));
    assert.equal(game.over, true);
    const fin = p.$("#fd-banner .cc-final");
    assert.ok(fin, "总结算");
    assert.match(fin.textContent, /这一局(你赢了|你输了|打平)/);
    assert.ok(game.results.length >= 1);
    assert.equal(opp.history.length, game.results.length, "对局只会在一轮结算后（或下一轮开始借贷时）结束");
    p.UI.stop();
  }
  // 结算横幅：不亮牌——横幅里没有任何一张牌的名字
  const p = page();
  const game = p.UI.start({ side: "a", level: "normal", seed: "横幅", fast: true, gameOpt: { deck: DECK } });
  playPair(p, "flesh", "fire");
  betThrough(p, game, "bet1");
  betThrough(p, game, "bet2");
  const banner = p.$("#fd-banner");
  assert.ok(visible(banner));
  assert.match(banner.textContent, /第 1 轮结算 · 酷暑/);
  assert.match(banner.textContent, /不亮牌：谁出了什么都不公开/);
  p.CC.CC_CONFIG.layers.concat(p.CC.CC_CONFIG.elements).map(c => p.CC.cardName(c))
    .forEach(n => assert.ok(!banner.textContent.includes(n), "横幅里没有牌：" + n));
  p.UI.stop();
});

test("亮牌开关打开时（DUEL_CONFIG.reveal = true）：结算横幅写双方出的牌和各自的得分", () => {
  const p = page();
  p.D.DUEL_CONFIG.reveal = true;
  const game = p.D.newGame({ seed: "亮牌", deck: DECK, names: { a: "你", b: "对手" } });
  p.D.act(game, "b", { type: "play", layer: "flesh", element: "ice" });
  p.UI.start({ side: "a", level: "normal", game, seed: "亮牌", fast: true });
  playPair(p, "flesh", "fire");
  // 让 AI 只过牌 / 跟注：直接在规则层把这一轮打完
  while (!p.UI.state().banner) {
    const side = p.D.toAct(game)[0], L = p.D.legal(game, side);
    p.D.act(game, side, { type: L.some(x => x.type === "check") ? "check" : L.some(x => x.type === "pass") ? "pass" : "call" });
    p.UI.render();
    if (game.results.length) { p.UI.state().banner = game.results[0]; p.UI.render(); }
  }
  const text = p.$("#fd-banner").textContent;
  assert.match(text, /你出〔肉体〕〔火〕得 \+2 · 对手出〔肉体〕〔冰〕得 −1/);
  assert.ok(!/不亮牌/.test(text));
  assert.match(p.$("#fd-banner").textContent, /差 3 及以上：输家再赔出自己下注额的 1 倍/);
  p.UI.stop();
});

test("跟注后的追加窗口：人跟注后操作栏出现倒计时和「加注」「弃牌」「不加注」；点「不加注」AI 也不追加就直接翻天气", () => {
  const p = page();
  const game = p.D.newGame({ seed: "窗口", deck: DECK, names: { a: "你", b: "对手" }, first: "b" });
  p.D.act(game, "b", { type: "play", layer: "flesh", element: "physical" });
  // 不开 fast：AI 等着走，测试里自己在规则层替它走（stop 停掉它排着的那一步）
  p.UI.start({ side: "a", level: "easy", game, seed: "窗口" });
  playPair(p, "flesh", "physical");
  p.UI.stop();
  // 对手（第 1 轮先手）下注 2 枚，人来跟
  p.D.act(game, "b", { type: "bet", amount: 2 });
  p.UI.render();
  click(p.$('#fd-actions [data-fd="call"]'));
  p.UI.stop();
  assert.ok(game.betting && game.betting.window, "跟注后开了追加窗口");
  const bar = p.$("#fd-actions");
  assert.equal(bar.querySelector(".cc-count").textContent, String(p.CC.CC_CONFIG.callWindowSec));
  assert.match(bar.querySelector(".cc-prompt").textContent, /^你跟注了。3 秒追加窗口/);
  assert.ok(bar.querySelector('[data-fd="raise"]') && bar.querySelector('[data-fd="fold"]') && bar.querySelector('[data-fd="pass"]'));
  assert.ok(!bar.querySelector('[data-fd="call"], [data-fd="check"]'));
  p.D.act(game, "b", { type: "pass" });
  p.UI.render();
  click(p.$('#fd-actions [data-fd="pass"]'));
  p.UI.stop();
  assert.equal(game.stage, "bet2");
  assert.equal(game.weather, "heat");
  assert.ok(!p.$("#fd-actions .cc-count"), "倒计时收起");
  p.UI.stop();
});

test("克制表（侧栏、横幅上的按钮）：格子是这一轮翻开的天气下的实际得分（还没翻开 = 没有天气），图例、说明是 Duel 的；翻开天气后表跟着变", () => {
  const p = page();
  const game = p.UI.start({ side: "a", level: "normal", seed: "克制表", fast: true, gameOpt: { deck: DECK } });
  const btn = p.$('#fd-side [data-fd="chart"]');
  assert.ok(btn, "侧栏有克制表的按钮");
  assert.match(btn.textContent, /天气 还没翻开/);
  click(btn);
  const box = p.$("#mu-overlay");
  assert.ok(visible(box), "打开了克制表");
  assert.ok(p.$("#fd-game").contains(box), "挂在 Duel 的牌桌上");
  assert.match(box.textContent, /Flux Duel 得分/);
  assert.match(box.textContent, /加分（正分）/);
  assert.match(box.textContent, /两边的分相减就是分差/);
  // 第一格：火打肉体，还没翻开天气 +1
  const fireFlesh = () => p.$('#mu-overlay [data-mu-cell="0:0"]').textContent.replace(/\s+/g, "");
  assert.match(fireFlesh(), /\+1$/);
  // 翻开酷暑：开着的表跟着重画，火打肉体 +1 → +2
  playPair(p, "flesh", "physical");
  betThrough(p, game, "bet1");
  assert.equal(game.weather, "heat");
  assert.ok(visible(box), "牌局照常，表还开着");
  assert.match(box.textContent, /天气 酷暑/);
  assert.match(fireFlesh(), /\+2$/);
  const c = p.D.chart("heat");
  assert.equal(c.cells[0][0].value, 2, "火打肉体，酷暑里 +2");
  assert.equal(c.tag, "Flux Duel 得分");
  assert.deepEqual(J(c.legend), { adv: "加分（正分）", dis: "扣分（负分）", neu: "0 分" });
  p.UI.closeChart();
  assert.ok(!visible(box));
  p.UI.stop();
});

test("悬停预览：鼠标停在手里的元素牌上，写这张牌按这一轮的天气打对方五种层的实际得分（就是克制表里这一行）；天气还没翻开按没有天气，翻开后跟着变；层牌没有预览", () => {
  const p = page();
  const game = p.UI.start({ side: "a", level: "normal", seed: "预览", fast: true, gameOpt: { deck: DECK } });
  const tip = p.$("#fd-tip");
  assert.ok(tip && !visible(tip));
  hover(p, mine(p, "fire"));
  assert.ok(visible(tip));
  assert.equal(tip.dataset.card, "fire");
  assert.match(tip.textContent, /天气还没翻开，按没有天气算/);
  assert.deepEqual(tipScores(p), chartRow(p, "fire", null));
  assert.deepEqual(tipScores(p), ["+1", "−1", "0", "0", "−1"]);
  hover(p, mine(p, "flesh"));
  assert.ok(!visible(tip), "层牌没有预览");
  playPair(p, "flesh", "physical");
  betThrough(p, game, "bet1");
  assert.equal(game.weather, "heat");
  hover(p, mine(p, "fire"));
  assert.ok(visible(tip));
  assert.match(tip.textContent, /天气 酷暑/);
  assert.deepEqual(tipScores(p), chartRow(p, "fire", "heat"));
  assert.deepEqual(tipScores(p), ["+2", "0", "+1", "+1", "0"]);
  p.UI.stop();
});
