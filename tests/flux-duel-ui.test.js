// Flux Duel（#488）· 界面 flux-duel-ui.js（共用零件 flux-ui.js）：标题「本地玩法」里的入口（名字读配置、排在 High Flux 后面）、设置页（座位、难度、规则）、
// 牌桌（自己的手牌两排正面朝上、对方只有牌背、这一轮的天气背面朝上，第一轮下注后才翻开）、选一张层牌 + 一张元素牌再「暗出」、
// 用点按钮的方式和三档 AI 打完一局、结算不亮牌（亮牌开关打开时写双方的牌）、跟注后追加窗口、克制表和元素牌的悬停预览按这一轮的天气算实际得分；
// 结算前的过渡（#525）：最后一步 →（亮牌）→ 判定中 → 结算横幅，弃牌不判定，追加窗口关上才开始，点一下桌面跳过，过渡中 AI 不走。
// Node 里用 tests/mini-dom.js 跑 game.html 的真页面结构；另有真浏览器测试（手机 390×844 打完一局：没装 Playwright 时用机器自带的 Chrome，都没有才跳过）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const { pathToFileURL } = require("url");
const { execSync } = require("child_process");
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

/* ---------- 结算前的过渡（主人 10/30 试玩反馈，#525；计时同 High Flux 的 UI_CONFIG.settle）：用假时钟（t.mock.timers）一段段往前拨 ---------- */
/** 你坐 a、对手（AI）坐 b，第 1 轮对手先手：规则层替两边走到第二轮下注、轮到你——对手暗出肉体 + 物理、你暗出肉体 + 火；
 *  第一轮都过牌，翻开天气堆顶（deck[0]）；第二轮对手先过牌。翻到相位就直接全押结算了（不进第二轮下注） */
function bet2Game(p, seed, deck) {
  const g = p.D.newGame({ seed, deck: (deck || DECK).slice(), names: { a: "你", b: "对手" }, first: "b" });
  const A = (side, type, extra) => p.D.act(g, side, Object.assign({ type }, extra || {}));
  A("b", "play", { layer: "flesh", element: "physical" }); A("a", "play", { layer: "flesh", element: "fire" });
  A("b", "check"); A("a", "check");
  if (g.stage === "bet2") A("b", "check");
  return g;
}
/** 对手（AI）第二轮下注时照 type 走（跟注 / 过牌……），跟注后的追加窗口里不追加；别的时候照常 */
function aiBet2(p, type) {
  const step = p.w.FluxDuelAI.step;
  p.w.FluxDuelAI.step = (game, side, level, r) => (game.stage !== "bet2" ? step(game, side, level, r)
    : !!p.D.act(game, side, { type: game.betting.window ? "pass" : type }));
}
const prompt = (p) => p.$("#fd-actions .cc-prompt").textContent;
const settleOf = (p) => p.UI.state().settle;
const barBtns = (p) => p.$$("#fd-actions button[data-fd]").map(b => b.dataset.fd);
const chipsOn = (p, seat) => p.$(`#fd-board ${seat} .cc-chips > b`).textContent;

test("结算前的过渡（主人 10/30 试玩反馈，#525）：每一轮亮牌之前先停一下——人过牌以后横幅不马上出来：最后一步停 UI_CONFIG.settle.lastMs → 判定中（牌背轻轻抖、底池发光；开着减少动态效果停 reducedJudgeMs）→ 结算横幅；过渡中桌上停在结算之前、不亮牌，AI 不走，记录、每轮结算里还没有这一轮", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const p = page(), T = p.w.CounterCardsUI.UI_CONFIG.settle;   // 页面开着「减少动态效果」
  const g = bet2Game(p, "过渡");
  p.UI.start({ side: "a", level: "normal", game: g, seed: "过渡" });   // 不是 fast
  const banner = p.$("#fd-banner"), before = { me: chipsOn(p, ".cc-me"), pot: chipsOn(p, ".cc-pot") };
  click(p.$('#fd-actions [data-fd="check"]'));
  assert.equal(g.results.length, 1, "规则层已经结算完");
  assert.equal(g.round, 2, "也开了下一轮（两边同时暗出，轮到对手）");
  const st = settleOf(p), snap = JSON.stringify(g);
  // ① 最后一步
  assert.ok(!visible(banner), "横幅不马上出来");
  assert.deepEqual([st.phase, J(st.beats)], ["last", ["last"]]);
  assert.equal(prompt(p), "你过牌。", "操作栏写最后一步做了什么");
  assert.deepEqual(barBtns(p), ["skipSettle"], "过渡中只有「直接看结算」");
  assert.equal(p.$("#fd-board .cc-me .cc-acted").textContent, "过牌", "座位上标着刚走的这一步");
  assert.ok(!p.$("#fd-board .cc-opp .cc-acted"));
  assert.ok(!p.$("#fd-board .cc-me button.cc-can"), "过渡中点不了牌");
  assert.match(p.$("#fd-top .cc-round").textContent, /第 1 \/ 5 轮/, "顶栏还是这一轮");
  const slots = p.$$("#fd-board .fd-slots .fd-slot");
  assert.ok(slots.every(s => s.querySelectorAll(".cc-back").length === 2), "桌上两边暗出的都是牌背");
  assert.match(slots[1].textContent, /肉体[\s\S]*火/, "自己那两张照旧在角上标一下");
  assert.equal(p.$$("#fd-board .cc-opp [data-face]").length + slots[0].querySelectorAll("[data-face]").length, 0, "不亮牌");
  assert.equal(p.$("#fd-board .cc-wnow [data-weather]").dataset.weather, "heat", "这一轮的天气");
  assert.deepEqual([chipsOn(p, ".cc-me"), chipsOn(p, ".cc-pot")], [before.me, before.pot], "过牌：筹码不动，底池还是结算之前的");
  assert.equal(p.$$("#fd-side .cc-results .cc-res").length, 0, "每轮结算里还没有这一轮");
  assert.ok(!p.$("#fd-side .cc-log").textContent.includes("第 1 轮：你赢") && !p.$("#fd-side .cc-log").textContent.includes("第 1 轮：对手赢"), "记录里还没有这一轮的结果");
  t.mock.timers.tick(T.lastMs - 1);
  assert.equal(st.phase, "last", "最后一步停 lastMs");
  t.mock.timers.tick(1);
  // ② 判定中
  assert.equal(st.phase, "judge");
  assert.ok(!visible(banner));
  assert.match(prompt(p), /^判定中/);
  assert.match(p.$("#fd-actions").textContent, /你过牌。 不亮牌：系统按克制表和这一轮的天气直接判胜负。/, "最后一步还写着");
  assert.ok(p.$("#fd-board .fd-slots.cc-judging .cc-back") && p.$("#fd-board .cc-pot.cc-judging"), "牌背轻轻抖、底池发光");
  assert.match(p.$("#fd-board .fd-slots .cc-judge").textContent, /判定中/);
  t.mock.timers.tick(T.reducedJudgeMs - 1);
  assert.ok(!visible(banner), "开着减少动态效果：判定中停 reducedJudgeMs");
  assert.equal(JSON.stringify(g), snap, "过渡中 AI 不走");
  t.mock.timers.tick(1);
  // ③ 结算横幅
  assert.ok(visible(banner) && banner.querySelector('[data-fd="dismiss"]'), "最后才弹出结算横幅");
  assert.equal(settleOf(p), null);
  assert.match(banner.textContent, /第 1 轮结算 · 酷暑/);
  assert.equal(p.$$("#fd-side .cc-results .cc-res").length, 1);
  const w = g.results[0].winner;
  if (w) assert.ok(p.$(`#fd-board ${w === "a" ? ".cc-me" : ".cc-opp"} .cc-chips.cc-collect`), "赢家那边的筹码堆收进来");
  t.mock.timers.tick(5000);
  assert.equal(JSON.stringify(g), snap, "横幅开着 AI 也不走");
  click(banner.querySelector('[data-fd="dismiss"]'));
  t.mock.timers.tick(p.w.FluxUI.UI_CONFIG.aiDelay);
  assert.notEqual(JSON.stringify(g), snap, "点「继续」以后 AI 接着走");
  const motion = read("flux.css").match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)[1];
  assert.ok(motion.includes(".fd-slots.cc-judging .cc-card"), "减少动态效果：暗出的牌不抖");
});

test("结算前的过渡：AI 走的最后一步（对手跟注）也停一下；跟注后的追加窗口倒计时期间不进过渡，到时间关窗之后才开始——操作栏从这一下跟注写起，标在对手的座位上；没开减少动态效果时判定中停 judgeMs", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const p = page();
  p.w.matchMedia = () => ({ matches: false });   // 没开「减少动态效果」
  const T = p.w.CounterCardsUI.UI_CONFIG.settle, U = p.w.FluxUI.UI_CONFIG, sec = p.CC.CC_CONFIG.callWindowSec;
  const g = bet2Game(p, "AI跟注");
  aiBet2(p, "call");   // 对手（AI）这一步一定跟注，窗口里不追加
  p.UI.start({ side: "a", level: "normal", game: g, seed: "AI跟注" });
  click(p.$('#fd-actions [data-fd="bet"]'));   // 你下注 1 枚（最低）
  const before = { opp: Number(chipsOn(p, ".cc-opp")), pot: Number(chipsOn(p, ".cc-pot")) };
  t.mock.timers.tick(U.dealMs);   // 开局 AI 等发牌动画放完才走
  const st = p.UI.state();
  assert.ok(g.betting && g.betting.window, "对手跟注，开了追加窗口");
  t.mock.timers.tick(U.aiDelay);
  assert.equal(g.betting.window.passed.b, true, "对手（AI）在窗口里马上决定：不追加");
  t.mock.timers.tick(sec * 1000 - U.aiDelay - 1);
  assert.ok(g.betting && g.betting.window && g.results.length === 0, "你还有倒计时");
  assert.equal(st.settle, null, "倒计时期间不进过渡");
  assert.ok(p.$("#fd-actions .cc-count") && p.$('#fd-actions [data-fd="pass"]'), "操作栏照旧是倒计时和「不加注」");
  t.mock.timers.tick(1);
  // 到时间关窗、结算：过渡从这里才开始
  assert.equal(g.results.length, 1, "到时间关窗，结算了");
  assert.equal(st.settle.phase, "last");
  assert.ok(!visible(p.$("#fd-banner")));
  assert.equal(prompt(p), "对手跟注 1 枚。 追加窗口到时间了，没人加注。", "最后一步从开窗的那一下跟注写起");
  assert.equal(p.$("#fd-board .cc-opp .cc-acted").textContent, "跟注 1 枚", "标在对手的座位上");
  assert.ok(!p.$("#fd-board .cc-me .cc-acted"));
  assert.deepEqual([Number(chipsOn(p, ".cc-opp")), Number(chipsOn(p, ".cc-pot"))], [before.opp - 1, before.pot + 1], "桌上停在结算之前：跟注的筹码在底池里");
  assert.ok(!p.$("#fd-actions .cc-count") && st.win === null, "倒计时收起");
  t.mock.timers.tick(T.lastMs);
  assert.equal(st.settle.phase, "judge");
  t.mock.timers.tick(T.judgeMs - 1);
  assert.ok(!visible(p.$("#fd-banner")), "没开减少动态效果：判定中停 judgeMs");
  t.mock.timers.tick(1);
  assert.ok(visible(p.$("#fd-banner")));
});

test("结算前的过渡：第一轮下注后翻到相位直接全押结算——最后一步里翻牌、闪一下，全押的筹码推进底池，操作栏写翻开了什么、双方全押", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const p = page(), T = p.w.CounterCardsUI.UI_CONFIG.settle;
  const g = p.D.newGame({ seed: "相位过渡", deck: ["phase", "heat", "glow", "acid", "thunder", "snow", "sand"], names: { a: "你", b: "对手" }, first: "b" });
  p.D.act(g, "b", { type: "play", layer: "flesh", element: "physical" }); p.D.act(g, "a", { type: "play", layer: "flesh", element: "fire" });
  p.D.act(g, "b", { type: "check" });
  p.UI.start({ side: "a", level: "normal", game: g, seed: "相位过渡" });
  assert.ok(p.$("#fd-board .cc-wnow .fd-wback"), "天气还背面朝上");
  click(p.$('#fd-actions [data-fd="check"]'));
  assert.ok(g.results.length === 1 && g.results[0].allIn, "翻到相位：全押、结算了");
  assert.equal(settleOf(p).phase, "last");
  assert.equal(prompt(p), "你过牌。 翻开这一轮的天气〔相位〕。 翻到相位：双方全押，各押 50 枚（筹码较少一方的全部筹码），不再下注，直接比分。");
  assert.ok(p.$("#fd-board .cc-flash") && p.$('#fd-board .cc-wnow [data-weather="phase"].cc-flip'), "翻牌、闪一下（以前一结算就看不到了）");
  assert.deepEqual([chipsOn(p, ".cc-me"), chipsOn(p, ".cc-opp"), chipsOn(p, ".cc-pot")], ["0", "0", "100"], "全押：手上的都推进底池");
  assert.ok(p.$("#fd-board .cc-pot.allin"));
  assert.ok(!visible(p.$("#fd-banner")));
  t.mock.timers.tick(T.lastMs);
  assert.equal(settleOf(p).phase, "judge");
  t.mock.timers.tick(T.reducedJudgeMs);
  assert.ok(visible(p.$("#fd-banner")));
  assert.match(p.$("#fd-banner").textContent, /相位全押/);
});

test("结算前的过渡：亮牌开关打开时（DUEL_CONFIG.reveal）多一步亮牌——双方暗出的两张翻过来（不写分）→ 判定中 → 横幅写双方的牌和得分", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const p = page(), T = p.w.CounterCardsUI.UI_CONFIG.settle;
  p.D.DUEL_CONFIG.reveal = true;
  const g = bet2Game(p, "亮牌过渡");
  p.UI.start({ side: "a", level: "normal", game: g, seed: "亮牌过渡" });
  click(p.$('#fd-actions [data-fd="check"]'));
  const st = settleOf(p);
  assert.deepEqual(J(st.beats), ["last", "show"]);
  assert.ok(!p.$("#fd-board .fd-slots [data-face]"), "最后一步：还是牌背");
  t.mock.timers.tick(T.lastMs);
  assert.equal(st.phase, "show");
  assert.equal(prompt(p), "亮牌：你〔肉体〕〔火〕，对手〔肉体〕〔物理〕。");
  const slots = p.$$("#fd-board .fd-slots .fd-slot");
  assert.deepEqual(Array.from(slots[0].querySelectorAll("[data-face]"), c => c.dataset.face), ["flesh", "physical"], "对手暗出的两张翻过来");
  assert.deepEqual(Array.from(slots[1].querySelectorAll("[data-face]"), c => c.dataset.face), ["flesh", "fire"], "自己的也翻过来");
  assert.ok(slots[0].querySelector(".cc-flip"), "翻牌动画");
  assert.ok(!/得 [+−]?\d/.test(p.$("#fd-board").textContent), "桌上不写分");
  assert.ok(!visible(p.$("#fd-banner")));
  t.mock.timers.tick(T.lastMs);
  assert.equal(st.phase, "judge");
  assert.match(p.$("#fd-actions").textContent, /亮牌：你〔肉体〕〔火〕，对手〔肉体〕〔物理〕。 各自用自己的元素牌打对方的层牌算分，分高的赢。/);
  assert.ok(p.$("#fd-board .fd-slots.cc-judging [data-face]"), "判定中翻过来的牌也轻轻抖");
  t.mock.timers.tick(T.reducedJudgeMs);
  assert.ok(visible(p.$("#fd-banner")));
  assert.match(p.$("#fd-banner").textContent, /你出〔肉体〕〔火〕得 \+2 · 对手出〔肉体〕〔物理〕得/);
});

test("结算前的过渡：弃牌也停一下——最后一步（标在座位上）之后直接弹横幅，不判定；第一轮下注时弃牌，这一轮的天气照旧盖着", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const T = page().w.CounterCardsUI.UI_CONFIG.settle;
  // 第二轮下注弃牌
  let p = page(), g = bet2Game(p, "弃牌");
  p.UI.start({ side: "a", level: "normal", game: g, seed: "弃牌" });
  click(p.$('#fd-actions [data-fd="fold"]'));
  assert.equal(g.results[0].outcome, "fold");
  assert.deepEqual([J(settleOf(p).beats), settleOf(p).judge], [["last"], false], "只有最后一步，不判定");
  assert.equal(prompt(p), "你弃牌。");
  assert.equal(p.$("#fd-board .cc-me .cc-acted").textContent, "弃牌");
  t.mock.timers.tick(T.lastMs - 1);
  assert.ok(!visible(p.$("#fd-banner")), "最后一步停 lastMs");
  t.mock.timers.tick(1);
  assert.ok(visible(p.$("#fd-banner")) && !settleOf(p), "弃牌：最后一步之后直接弹横幅");
  assert.match(p.$("#fd-banner").textContent, /你弃牌/);
  assert.ok(p.$("#fd-board .cc-opp .cc-chips.cc-collect"), "对手拿走底池：它的筹码收进来");
  // 第一轮下注弃牌：天气没翻开，盖着弃掉——过渡中照旧是牌背
  p = page();
  g = p.D.newGame({ seed: "弃牌1", deck: DECK.slice(), names: { a: "你", b: "对手" }, first: "b" });
  p.D.act(g, "b", { type: "play", layer: "flesh", element: "physical" }); p.D.act(g, "a", { type: "play", layer: "flesh", element: "fire" });
  p.D.act(g, "b", { type: "check" });
  p.UI.start({ side: "a", level: "normal", game: g, seed: "弃牌1" });
  click(p.$('#fd-actions [data-fd="fold"]'));
  assert.ok(g.results[0].buried, "天气盖着弃掉了");
  assert.equal(settleOf(p).phase, "last");
  assert.ok(p.$("#fd-board .cc-wnow .fd-wback") && !p.$("#fd-board [data-weather]"), "过渡中天气照旧盖着");
  assert.ok(!/酷暑/.test(p.$("#fd-board").textContent), "看不出这一轮是什么天气");
  t.mock.timers.tick(T.lastMs);
  assert.ok(visible(p.$("#fd-banner")));
});

test("结算前的过渡：点一下桌面直接看结算（最后一步、判定中都行；操作栏按钮以外的地方、「直接看结算」也行），点侧栏不算；跳过以后计时也停了；fast（测试用）不停", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const T = page().w.CounterCardsUI.UI_CONFIG.settle;
  const open = (seed, fast) => {
    const p = page(), g = bet2Game(p, seed);
    p.UI.start({ side: "a", level: "normal", game: g, seed, fast });
    click(p.$('#fd-actions [data-fd="check"]'));
    return p;
  };
  let p = open("跳过1");
  assert.equal(settleOf(p).phase, "last");
  click(p.$("#fd-side h3"));
  assert.ok(settleOf(p) && !visible(p.$("#fd-banner")), "点侧栏不算");
  click(p.$("#fd-board .cc-deck"));
  assert.equal(settleOf(p), null);
  assert.ok(visible(p.$("#fd-banner")), "点一下桌面：直接看结算");
  t.mock.timers.tick(5000);
  assert.ok(visible(p.$("#fd-banner")), "跳过以后计时也停了，横幅留着");
  // 判定中点桌上的牌背
  p = open("跳过2");
  t.mock.timers.tick(T.lastMs);
  assert.equal(settleOf(p).phase, "judge");
  click(p.$("#fd-board .fd-slot .cc-back"));
  assert.ok(visible(p.$("#fd-banner")), "判定中点一下桌面也行");
  // 点操作栏按钮以外的地方、「直接看结算」
  p = open("跳过3");
  click(p.$("#fd-actions .cc-prompt"));
  assert.ok(visible(p.$("#fd-banner")) && !settleOf(p), "点操作栏也行");
  p = open("跳过4");
  t.mock.timers.tick(T.lastMs);
  const skip = p.$('#fd-actions [data-fd="skipSettle"]');
  assert.equal(skip.textContent, T.skip);
  click(skip);
  assert.ok(visible(p.$("#fd-banner")) && !settleOf(p), "「直接看结算」");
  // fast：不停
  p = open("fast", true);
  assert.equal(settleOf(p), null);
  assert.ok(visible(p.$("#fd-banner")), "fast：不停");
});

test("结算前的过渡：不开 fast 和 AI 打完一局（你坐后手）——每一轮都先放过渡再弹横幅（弃牌的只有最后一步）；过渡中 AI 不走、追加窗口不计时、只有「直接看结算」、点不了牌；最后一轮的横幅点「看总结算」才出总结算", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const p = page(), T = p.w.CounterCardsUI.UI_CONFIG.settle, r = rng(525);
  const game = p.UI.start({ side: "b", level: "hard", seed: "过渡整局" });
  const st = () => p.UI.state(), banner = p.$("#fd-banner"), snap = () => JSON.stringify(game);
  const tickUntil = (done) => { for (let i = 0; i < 400 && !done(); i++) t.mock.timers.tick(50); assert.ok(done(), "AI 一直没走"); };
  let seen = 0;
  for (let guard = 0; guard < 1500; guard++) {
    const s = st();
    if (s.settle) {
      const res = game.results[game.results.length - 1], before = snap();
      assert.ok(!visible(banner), `第 ${res.r} 轮：横幅不马上出来`);
      assert.equal(s.settle.phase, "last");
      assert.match(p.$("#fd-top .cc-round").textContent, new RegExp(`第 ${res.r} / 5 轮`));
      assert.equal(p.$$("#fd-side .cc-results .cc-res").length, game.results.length - 1, "每轮结算里还没有这一轮");
      assert.deepEqual(barBtns(p), ["skipSettle"]);
      assert.ok(!p.$("#fd-actions .cc-count") && !s.win, "过渡中追加窗口不计时");
      assert.ok(!p.$("#fd-board button.cc-can") && !p.$("#fd-board .fd-slots [data-face]"), "点不了牌，桌上只有牌背");
      t.mock.timers.tick(T.lastMs);
      if (res.outcome !== "fold") { assert.equal(s.settle.phase, "judge", `第 ${res.r} 轮：判定中`); t.mock.timers.tick(T.reducedJudgeMs); }
      assert.ok(visible(banner) && banner.querySelector('[data-fd="dismiss"]') && !banner.querySelector(".cc-final"), `第 ${res.r} 轮：最后才弹结算横幅`);
      assert.equal(snap(), before, "过渡中 AI 不走");
      seen++;
      continue;
    }
    if (visible(banner)) {
      if (banner.querySelector(".cc-final")) break;
      const d = banner.querySelector('[data-fd="dismiss"]');
      if (game.over) assert.equal(d.textContent, "看总结算");
      click(d);
      continue;
    }
    const waiting = p.D.toAct(game), w = game.betting && game.betting.window;
    const mine = waiting.indexOf(s.human) >= 0 && !(w && w.passed[s.human]);
    if (!mine) { const before = snap(); assert.ok(waiting.length, "没人可动：" + game.stage); tickUntil(() => snap() !== before); continue; }   // AI 等一会儿走一步
    if (game.stage === "play") {
      const ly = p.$('#fd-board .fd-row[data-row="layer"] button.cc-can'), el = p.$('#fd-board .fd-row[data-row="element"] button.cc-can');
      playPair(p, ly.dataset.face, el.dataset.face);
      continue;
    }
    const btns = p.$$("#fd-actions button[data-fd]").filter(b => !b.disabled && b.dataset.fd !== "amt");
    assert.ok(btns.length, "没有能点的按钮：" + game.stage);
    const bet = btns.filter(b => ["check", "call", "bet", "raise", "fold", "pass"].includes(b.dataset.fd));
    click(bet.length ? (r() < 0.08 ? bet.find(b => b.dataset.fd === "fold") : bet[Math.floor(r() * bet.length)]) : btns.find(b => b.classList.contains("primary")) || btns[0]);
  }
  assert.ok(game.over && p.$("#fd-banner .cc-final"), "打完了，有总结算");
  assert.equal(seen, game.results.length, "每一轮都有过渡");
});

test("结算前的过渡：赌场桌（casino-ui.js 打开，带 casino；对手是赌场，筹码无限）也一样——横幅等过渡放完才出来；牌局走的每一步照旧交给模式存档", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const p = page(), T = p.w.CounterCardsUI.UI_CONFIG.settle;
  const g = p.D.newGame({ seed: "赌场过渡", deck: DECK.slice(), names: { a: "你", b: "赌场" }, house: "b", first: "b" });
  const A = (side, type, extra) => p.D.act(g, side, Object.assign({ type }, extra || {}));
  A("b", "play", { layer: "flesh", element: "physical" }); A("a", "play", { layer: "flesh", element: "fire" });
  A("b", "check"); A("a", "check"); A("b", "check");
  let saves = 0;
  p.UI.start({ side: "a", level: "normal", game: g, seed: "赌场过渡", casino: { label: "后巷小桌", onChange: () => { saves++; }, onLeave() {}, onAgain() {} } });
  click(p.$('#fd-actions [data-fd="check"]'));
  assert.equal(saves, 1, "这一步（结算了）照旧叫模式存档");
  assert.ok(settleOf(p) && !visible(p.$("#fd-banner")), "赌场桌也先放过渡");
  assert.match(p.$("#fd-board .cc-opp").textContent, /筹码无限/, "过渡中赌场那边照旧写筹码无限");
  t.mock.timers.tick(T.lastMs);
  assert.ok(!visible(p.$("#fd-banner")));
  t.mock.timers.tick(T.reducedJudgeMs);
  assert.ok(visible(p.$("#fd-banner")) && !settleOf(p), "放完才弹横幅");
});

/* ---------- 真浏览器（手机 390×844）：没装 Playwright 时用机器自带的 Chrome（tests/cdp-browser.js），都没有才跳过 ---------- */
function findPlaywright() {
  try { return require("playwright"); } catch (e) {}
  try {
    const rootDir = execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return require(path.join(rootDir, "playwright"));
  } catch (e) {}
  return null;
}
const pw = findPlaywright();
const GAME_URL = pathToFileURL(path.join(ROOT, "game.html")).href;
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

test("真浏览器（手机 390×844）：不开 fast 和 AI 打完一局 Flux Duel——每一轮结算前的过渡照常放（最后一步 → 判定中，「判定中」贴在牌桌里、不压到底池），不报错、没有横向溢出", { timeout: 240000 }, async (t) => {
  const b = await uiBrowser();
  if (!b) { t.skip(skipWhy); return; }
  const context = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await require("./old-screen")(context);
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(GAME_URL);
  // 时长调短（过渡每步、判定中 80 毫秒，AI 每步 20 毫秒），照常不开 fast
  await page.evaluate(() => {
    Object.assign(CounterCardsUI.UI_CONFIG.settle, { lastMs: 80, judgeMs: 80, reducedJudgeMs: 80 });
    Object.assign(FluxUI.UI_CONFIG, { aiDelay: 20, dealMs: 0 });
    FluxDuelUI.start({ side: "a", level: "normal", seed: "真浏览器-手机" });
  });
  const phases = new Set(), bad = [];
  let done = false;
  for (let i = 0; i < 4000 && !done; i++) {
    const m = await page.evaluate(() => {
      const S = FluxDuelUI.state(), q = (s) => document.querySelector(s), overflow = q("#scr-fd").scrollWidth - innerWidth;
      if (S.settle) {
        const table = q("#fd-game .cc-table").getBoundingClientRect(), tag = q("#fd-board .cc-judge"), r = tag && tag.getBoundingClientRect(), pot = q("#fd-board .cc-pot").getBoundingClientRect();
        return { settle: S.settle.phase, overflow,
          tagOut: !!r && (r.left < Math.max(0, table.left) - 1 || r.right > Math.min(innerWidth, table.right) + 1 || r.top < table.top - 1 || r.bottom > table.bottom + 1),
          tagOnPot: !!r && !(r.top >= pot.bottom - 1 || r.bottom <= pot.top + 1 || r.left >= pot.right - 1 || r.right <= pot.left + 1) };
      }
      const banner = q("#fd-banner");
      if (!banner.hidden) {
        if (banner.querySelector(".cc-final")) return { done: true, overflow };
        banner.querySelector('[data-fd="dismiss"]').click();
        return { overflow };
      }
      const ly = q('#fd-board .fd-row[data-row="layer"] button.cc-can:not(.fd-sel)'), el = q('#fd-board .fd-row[data-row="element"] button.cc-can:not(.fd-sel)');
      if (ly && el) { ly.click(); q('#fd-board .fd-row[data-row="element"] button.cc-can:not(.fd-sel)').click(); q('#fd-actions [data-fd="play"]').click(); return { overflow }; }
      const btns = [...document.querySelectorAll("#fd-actions button[data-fd]")].filter(x => !x.disabled && x.dataset.fd !== "amt");
      const pick = ["check", "call", "pass", "noLoan"].map(a => btns.find(x => x.dataset.fd === a)).find(Boolean) || btns.find(x => x.classList.contains("primary"));
      if (pick) pick.click();
      return { overflow, wait: !pick };
    });
    if (m.settle) phases.add(m.settle);
    if (m.overflow > 1) bad.push(`横向溢出 ${m.overflow}px（${m.settle || "平时"}）`);
    if (m.tagOut) bad.push("「判定中」跑出牌桌");
    if (m.tagOnPot) bad.push("「判定中」压到底池");
    done = !!m.done;
    if (m.settle || m.wait) await page.waitForTimeout(25);
  }
  assert.ok(done, "打完了，有总结算");
  assert.deepEqual(bad, [], "过渡中、平时都没有横向溢出，「判定中」在牌桌里");
  ["last", "judge"].forEach(ph => assert.ok(phases.has(ph), `放过「${ph}」这一步：${[...phases].join("、")}`));
  assert.deepEqual(errors, []);
});
