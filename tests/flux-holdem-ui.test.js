// Flux Hold'em（#488）· 界面 flux-holdem-ui.js（共用零件 flux-ui.js）：标题「本地玩法」里的入口（名字读配置、排在 Flux Duel 后面）、设置页（人数、难度、规则）、
// 牌桌（对手一排只有牌背、公共层牌 / 天气翻开一张亮一张、自己坐庄时偷看的那张只有自己看得到）、点手牌盖下、用点按钮的方式和 AI 打完一局（2–4 人）、
// 亮牌横幅（每人的牌和分、主池 / 边池归谁、平分）、全押按钮、追加窗口、克制表和元素牌的悬停预览按场上的天气（两张叠加）算实际得分。
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
const LAYERS = ["flesh", "armor", "shield", "sand", "spirit", "flesh", "armor", "shield", "sand", "spirit"];
const WEATHERS = ["heat", "glow", "acid", "thunder", "snow", "sand", "phase"];

function page() {
  const html = read("game.html"), body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const P = MD.create(body, { media: (q) => /prefers-reduced-motion: reduce/.test(q) });
  const ctx = vm.createContext(P.window);
  ["engine.js", "icons.js", "weather-fx.js", "pause-menu.js", "matchup-ui.js", "counter-cards.js", "counter-cards-ai.js", "flux-duel.js", "flux-duel-ai.js", "flux-holdem.js", "flux-holdem-ai.js",
    "counter-cards-ui.js", "flux-ui.js", "flux-duel-ui.js", "flux-holdem-ui.js"].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const doc = P.document;
  return { w: P.window, doc, $: (s) => doc.querySelector(s), $$: (s) => Array.from(doc.querySelectorAll(s)), UI: P.window.FluxHoldemUI, X: P.window.FluxHoldem, CC: P.window.CounterCards };
}
const click = (el) => { assert.ok(el, "要点的东西不在"); el.click(); };
const visible = (el) => !!el && !el.hidden;
const fireEv = (p, el, type, o) => { assert.ok(el, "要碰的东西不在：" + type); const ev = new p.w.Event(type, Object.assign({ bubbles: true }, o || {})); el.dispatchEvent(ev); return ev; };
const hover = (p, el) => fireEv(p, el, "pointerover", { pointerType: "mouse" });
const mine = (p, face) => p.$(`#fh-board .cc-me .cc-hand [data-face="${face}"]`);
const tipScores = (p) => p.$$("#fh-tip [data-layer] b").map(b => b.textContent);
const fmt = (n) => (n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0");
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** 一直点到这一局结束：有结算横幅就点「继续」；轮到自己盖牌就点第一张能点的；下注随机换着点 */
function playThrough(p, r) {
  let guard = 0;
  while (guard++ < 600) {
    const banner = p.$("#fh-banner");
    if (visible(banner)) {
      if (banner.querySelector(".cc-final")) return;
      click(banner.querySelector('[data-fh="dismiss"]'));
      continue;
    }
    const st = p.UI.state();
    const card = p.$("#fh-board .cc-me button.cc-can");
    if (card) { click(card); continue; }
    const btns = p.$$("#fh-actions button[data-fh]").filter(b => !b.disabled && b.dataset.fh !== "amt");
    assert.ok(btns.length, "没有能点的按钮：" + st.game.stage);
    const bet = btns.filter(b => ["check", "call", "bet", "raise", "fold", "pass", "allIn"].includes(b.dataset.fh));
    let pick;
    if (bet.length) pick = r() < 0.06 ? bet.find(b => b.dataset.fh === "fold") : bet[Math.floor(r() * bet.length)];
    else pick = btns.find(b => b.classList.contains("primary")) || btns[0];
    click(pick || btns[0]);
  }
  assert.fail("点了 600 下还没打完");
}

test("标题「本地玩法」里 Flux Hold'em 排在 Flux Duel 后面（High Flux → Flux Duel → Flux Hold'em），名字读配置；设置页选人数、难度，开局", () => {
  const p = page();
  const ids = p.$$("#t-panel-local .t-btn").map(b => b.id);
  assert.deepEqual(ids.slice(ids.indexOf("t-cc"), ids.indexOf("t-cc") + 3), ["t-cc", "t-fd", "t-fh"]);
  const entry = p.$("#t-fh");
  assert.equal(entry.querySelector("b").textContent, p.X.HOLDEM_CONFIG.name);
  assert.equal(entry.querySelector("b").textContent, "Flux Hold'em");
  click(entry);
  assert.ok(visible(p.$("#scr-fh")) && visible(p.$("#fh-setup")));
  assert.equal(p.doc.body.dataset.screen, "fluxHoldem");
  const setup = p.$("#fh-setup").textContent;
  assert.match(setup, /Flux Hold'em/);
  assert.match(setup, /2 人[\s\S]*3 人[\s\S]*4 人/);
  assert.match(p.$("#fh-setup .cc-rules").textContent, /同分平分/);
  assert.match(p.$("#fh-setup .cc-rules").textContent, /微光反转克制表（能量除外），也反转另一张天气的修正/);
  // 相位 = 全押（主人 10/30），不再是最低注翻倍
  const rules = p.$("#fh-setup .cc-rules").textContent;
  assert.match(rules, /相位：翻开时没弃牌的人全押（上限 = 没弃牌的人里筹码最少那位的全部筹码，这一轮已下的 \+ 手上的），不再下注，直接比分/);
  assert.match(rules, /第 2 张天气（亮牌时翻开）是相位：比分之前补押到这个数/);
  assert.match(rules, /全押后同分，底池留在桌上滚到下一轮；最后一轮同分的人平分/);
  assert.ok(!/最低下注额翻倍|最低注翻倍/.test(rules));
  click(p.$('[data-fh="set"][data-key="players"][data-val="4"]'));
  click(p.$('[data-fh="set"][data-key="level"][data-val="hard"]'));
  click(p.$('[data-fh="start"]'));
  assert.ok(visible(p.$("#fh-game")));
  const st = p.UI.state();
  assert.equal(st.game.order.length, 4);
  assert.deepEqual(J(st.levels), { p2: "hard", p3: "hard", p4: "hard" });
  assert.equal(p.$$("#fh-board .fh-opps .fh-seat").length, 3);
  assert.match(p.$("#fh-top").textContent, /Flux Hold'em[\s\S]*4 人桌 · 对手：困难 AI/);
  p.UI.stop();
});

test("牌桌：自己坐庄时操作栏里有偷看到的那张（只有自己看得到）；留在顶上后翻开第 1 张层牌、下盲注；对手只有牌背；没翻开的层牌、天气是牌背", () => {
  const p = page();
  const game = p.UI.start({ players: 3, level: "normal", seed: "坐庄", gameOpt: { layers: LAYERS.slice(), weathers: WEATHERS.slice() } });
  p.UI.stop();
  assert.equal(game.dealer, "p1");
  assert.equal(game.stage, "peek");
  const bar = p.$("#fh-actions");
  assert.match(bar.textContent, /你坐庄：偷看到天气堆顶是〔酷暑〕（只有你看得到）/);
  assert.ok(bar.querySelector('[data-fh="place"][data-where="top"]') && bar.querySelector('[data-fh="place"][data-where="bottom"]'));
  assert.equal(p.$$("#fh-board .fh-community .fh-hidden").length, 4, "层牌、天气都还没翻");
  click(bar.querySelector('[data-fh="place"][data-where="top"]'));
  p.UI.stop();
  assert.equal(game.stage, "play");
  assert.deepEqual(p.$$("#fh-board .fh-community .fh-layer").map(x => x.dataset.face), ["flesh"]);
  assert.equal(p.$$("#fh-board .fh-community .fh-hidden").length, 3);
  assert.ok(!p.$("#fh-board [data-weather]"), "天气还没翻开");
  assert.match(p.$("#fh-board .fh-seat[data-seat=\"p2\"]").textContent, /小盲/);
  assert.match(p.$("#fh-board .fh-seat[data-seat=\"p3\"]").textContent, /大盲/);
  assert.match(p.$("#fh-board .cc-me").textContent, /庄/);
  // 对手只有牌背，画面里没有他们的手牌
  p.$$("#fh-board .fh-opps .fh-seat").forEach(s => assert.ok(!s.querySelector("[data-face]"), "对手的牌面不在画面里"));
  assert.equal(p.$$("#fh-board .cc-me .cc-hand .cc-card").length, 3);
  p.UI.stop();
});

test("点手牌盖下（盖下的那张在角上标一下）；第一轮下注后翻开第 1 张天气；亮牌横幅写每人的牌和分、主池归谁、自己的筹码变动", () => {
  const p = page();
  const game = p.X.newGame({ seed: "亮牌", players: [{ id: "p1", name: "你" }, { id: "p2", name: "乙" }], layers: LAYERS.slice(), weathers: WEATHERS.slice(),
    hands: { p1: ["fire", "ice", "acid"], p2: ["physical", "ice", "energy"] }, elements: [] });
  p.UI.start({ game, human: "p1", levels: { p2: "easy" }, seed: "亮牌" });
  p.UI.stop();
  click(p.$('#fh-actions [data-fh="place"][data-where="top"]'));
  p.UI.stop();
  // 乙（AI）盖物理：规则层替它走
  p.X.act(game, "p2", { type: "play", card: "physical" });
  p.UI.render();
  click(mine(p, "fire"));
  p.UI.stop();
  assert.equal(game.sides.p1.card, "fire");
  assert.match(p.$("#fh-board .cc-me .cc-slot").textContent, /火/);
  // 第一轮：大盲（乙）先，规则层替它过牌，人跟注、都不追加
  p.X.act(game, "p2", { type: "check" });
  p.UI.render();
  click(p.$('#fh-actions [data-fh="call"]'));
  p.UI.stop();
  p.X.act(game, "p2", { type: "pass" });
  p.UI.render();
  click(p.$('#fh-actions [data-fh="pass"]'));
  p.UI.stop();
  assert.deepEqual(J(game.weathers), ["heat"]);
  assert.equal(p.$("#fh-board .fh-community [data-weather]").dataset.weather, "heat", "第 1 张天气翻开");
  assert.match(p.$("#fh-actions").textContent, /乙正在想/, "第二轮从庄家左边（乙）开始");
  // 第二轮都过牌：亮牌（层牌肉体、装甲，天气酷暑 + 微光）
  p.X.act(game, "p2", { type: "check" });
  p.UI.render();
  assert.match(p.$("#fh-actions").textContent, /第二轮下注（天气〔酷暑〕）（从庄家左边起）：还没人下注/);
  click(p.$('#fh-actions [data-fh="check"]'));
  p.UI.stop();
  const banner = p.$("#fh-banner");
  assert.ok(visible(banner));
  const fire = p.X.handScore("fire", ["flesh", "armor"], ["heat", "glow"]), phys = p.X.handScore("physical", ["flesh", "armor"], ["heat", "glow"]);
  assert.match(banner.textContent, new RegExp(`你〔火〕得 ${fmt(fire).replace("+", "\\+")}`));
  assert.match(banner.textContent, new RegExp(`乙〔物理〕得 ${fmt(phys).replace("+", "\\+")}`));
  assert.match(banner.textContent, /层牌 〔肉体〕〔装甲〕 · 天气 酷暑 \+ 微光/);
  assert.match(banner.textContent, fire > phys ? /主池 \d+ 枚归你/ : fire < phys ? /主池 \d+ 枚归乙/ : /由你、乙平分|由乙、你平分/);
  // 横幅上的克制表：按刚结算的那一轮的两张天气叠加
  click(banner.querySelector('[data-fh="chart"]'));
  const box = p.$("#mu-overlay");
  assert.ok(visible(box));
  assert.match(box.textContent, /酷暑 \+ 微光/);
  assert.match(box.textContent, /Flux Hold'em 得分/);
  p.UI.closeChart();
  p.UI.stop();
});

test("用点按钮的方式和 AI 打完一局（2 / 3 / 4 人，三档难度）：每轮都有结算横幅，最后有总结算", () => {
  [[2, "easy"], [3, "normal"], [4, "hard"]].forEach(([n, level], i) => {
    const p = page();
    const game = p.UI.start({ players: n, level, seed: `点完-${n}`, fast: true });
    playThrough(p, rng(31 + i));
    assert.equal(game.over, true);
    const fin = p.$("#fh-banner .cc-final");
    assert.ok(fin);
    assert.match(fin.textContent, /这一局你(赢了|输了|和别人并列第一)/);
    game.order.forEach(id => assert.ok(fin.textContent.includes(id === "p1" ? "你" : game.names[id])));
    p.UI.stop();
  });
});

test("跟不起时下注栏有「全押」和借的按钮；全押后押得多的那部分开边池（横幅写边池归谁）", () => {
  const p = page();
  const game = p.X.newGame({ seed: "全押", players: [{ id: "p1", name: "你", chips: 6 }, { id: "p2", name: "乙" }, { id: "p3", name: "丙" }], layers: LAYERS.slice(), weathers: WEATHERS.slice(),
    hands: { p1: ["physical", "ice", "acid"], p2: ["fire", "ice", "energy"], p3: ["ice", "fire", "acid"] }, elements: [] });
  p.UI.start({ game, human: "p1", levels: { p2: "easy", p3: "easy" }, seed: "全押" });
  p.UI.stop();
  click(p.$('#fh-actions [data-fh="place"][data-where="top"]'));
  p.UI.stop();
  p.X.act(game, "p2", { type: "play", card: "fire" }); p.X.act(game, "p3", { type: "play", card: "ice" });
  p.UI.render();
  click(mine(p, "physical"));
  p.UI.stop();
  p.X.act(game, "p2", { type: "call" }); p.X.act(game, "p3", { type: "raise", amount: 10 });
  p.UI.render();
  const bar = p.$("#fh-actions");
  assert.ok(bar.querySelector('[data-fh="allIn"]'), "有全押");
  assert.equal(bar.querySelector('[data-fh="allIn"]').textContent, "全押 6");
  assert.ok(bar.querySelector('[data-fh="borrow"]'), "有借的按钮");
  assert.ok(!bar.querySelector('[data-fh="call"]'), "跟不起");
  assert.match(bar.textContent, /你手上只有 6 枚，跟不起：要跟就先向主持方借（每借 3 枚，结束时还 4 枚），或者全押/);
  click(bar.querySelector('[data-fh="allIn"]'));
  p.UI.stop();
  assert.equal(game.sides.p1.allIn, true);
  p.X.act(game, "p2", { type: "call" });
  p.X.toAct(game).forEach(id => { if (id !== "p1") p.X.act(game, id, { type: "pass" }); });
  for (let i = 0; i < 10 && !game.results.length; i++) { const id = p.X.toAct(game)[0]; p.X.act(game, id, { type: "check" }); }
  p.UI.state().banner = game.results[0];
  p.UI.render();
  const text = p.$("#fh-banner").textContent;
  // 你全押 6 枚：主池 6 × 3 = 18（三个人都能分）；乙、丙多押的 6 × 2 = 12 是边池（你分不到）
  assert.match(text, /主池 18 枚/);
  assert.match(text, /边池 1 12 枚/);
  p.UI.stop();
});

test("翻到相位：横幅写没弃牌的人全押、押到多少；全押后同分写底池滚到下一轮；下一轮的底池、提示行写着滚存的，亮牌后写含上一轮滚存的", () => {
  const p = page();
  const game = p.X.newGame({ seed: "相位", players: [{ id: "p1", name: "你" }, { id: "p2", name: "乙", chips: 30 }], layers: LAYERS.slice(),
    weathers: ["phase", "heat", "snow", "acid", "thunder", "glow", "sand"], hands: { p1: ["acid", "fire", "ice"], p2: ["acid", "ice", "physical"] }, elements: ["ice", "fire"] });
  p.UI.start({ game, human: "p1", levels: { p2: "easy" }, seed: "相位" });
  p.UI.stop();
  click(p.$('#fh-actions [data-fh="place"][data-where="top"]'));
  p.UI.stop();
  p.X.act(game, "p2", { type: "play", card: "acid" });
  p.UI.render();
  click(mine(p, "acid"));
  p.UI.stop();
  assert.match(p.$("#fh-actions .cc-info").textContent, /翻到相位：没弃牌的人全押/, "下注时提示翻到相位就全押");
  p.X.act(game, "p2", { type: "check" });
  p.UI.render();
  click(p.$('#fh-actions [data-fh="call"]'));
  p.UI.stop();
  p.X.act(game, "p2", { type: "pass" });
  p.UI.render();
  click(p.$('#fh-actions [data-fh="pass"]'));
  p.UI.stop();
  // 第 1 张天气是相位：不进第二轮下注，直接亮牌；两边都是酸 +3，同分滚存
  assert.equal(game.results.length, 1);
  const banner = p.$("#fh-banner");
  assert.ok(visible(banner));
  const text = banner.textContent;
  assert.match(text, /翻到相位（第 1 张天气）：没弃牌的人全押，各押到 30 枚/);
  assert.match(text, /同分，底池滚到下一轮/);
  assert.match(text, /主池 60 枚：你、乙同分（相位全押），滚到下一轮/);
  assert.match(text, /你 −30 枚/);
  assert.match(p.$("#fh-side .cc-results").textContent, /同分，底池滚到下一轮/);
  click(banner.querySelector('[data-fh="dismiss"]'));
  p.UI.stop();
  // 第 2 轮：乙输光了先借，庄家（乙）偷看后放好；底池里先放着滚存的 60 枚
  p.X.act(game, "p2", { type: "borrow", amount: 6 });
  p.X.act(game, "p2", { type: "place", where: "top" });
  p.UI.render();
  assert.equal(game.stage, "play");
  assert.match(p.$("#fh-board .cc-pot").textContent, /含滚存 60/);
  assert.match(p.$("#fh-actions .cc-info").textContent, /底池含上一轮滚存 60 枚/);
  // 打完第 2 轮：横幅写主池含上一轮滚存的
  p.X.act(game, "p2", { type: "play", card: "ice" });
  p.UI.render();
  click(mine(p, "fire"));
  p.UI.stop();
  for (let i = 0; i < 12 && game.results.length < 2; i++) {
    const id = p.X.toAct(game)[0], L = p.X.legal(game, id);
    p.X.act(game, id, { type: L.some(o => o.type === "pass") ? "pass" : L.some(o => o.type === "check") ? "check" : "call" });
  }
  assert.equal(game.results[1].carryIn, 60);
  p.UI.state().banner = game.results[1];
  p.UI.render();
  assert.match(p.$("#fh-banner").textContent, /主池 \d+ 枚(归你|归乙|由你、乙平分)（含上一轮滚存的 60 枚）/);
  p.UI.stop();
});

test("悬停预览：鼠标停在手里的元素牌上，写这张牌按场上的天气打五种层的实际得分（就是克制表里这一行）、对已翻开的公共层牌的合计；天气翻开后跟着变", () => {
  const p = page();
  const game = p.X.newGame({ seed: "预览", players: [{ id: "p1", name: "你" }, { id: "p2", name: "乙" }], layers: LAYERS.slice(), weathers: WEATHERS.slice(),
    hands: { p1: ["fire", "ice", "acid"], p2: ["physical", "ice", "energy"] }, elements: [] });
  p.UI.start({ game, human: "p1", levels: { p2: "easy" }, seed: "预览" });
  p.UI.stop();
  click(p.$('#fh-actions [data-fh="place"][data-where="top"]'));
  p.UI.stop();
  const tip = p.$("#fh-tip");
  hover(p, mine(p, "fire"));
  assert.ok(visible(tip));
  assert.match(tip.textContent, /天气还没翻开，按没有天气算/);
  assert.deepEqual(tipScores(p), J(p.X.cardChart("fire", []).cells.map(x => fmt(x.value))));
  assert.match(tip.textContent, /对已翻开的公共层牌〔肉体〕合计 \+1/);
  // 盖牌、第一轮下注打完，翻开酷暑：火打肉体 +2
  p.X.act(game, "p2", { type: "play", card: "physical" });
  p.UI.render();
  click(mine(p, "fire"));
  p.UI.stop();
  p.X.act(game, "p2", { type: "check" }); p.UI.render();
  click(p.$('#fh-actions [data-fh="call"]')); p.UI.stop();
  p.X.act(game, "p2", { type: "pass" }); p.UI.render();
  click(p.$('#fh-actions [data-fh="pass"]')); p.UI.stop();
  assert.deepEqual(J(game.weathers), ["heat"]);
  hover(p, mine(p, "ice"));
  assert.ok(visible(tip));
  assert.match(tip.textContent, /天气 酷暑/);
  assert.deepEqual(tipScores(p), J(p.X.cardChart("ice", ["heat"]).cells.map(x => fmt(x.value))));
  assert.match(tip.textContent, /对已翻开的公共层牌〔肉体〕合计 −1/);
  // 侧栏的克制表按场上的天气
  click(p.$('#fh-side [data-fh="chart"]'));
  assert.match(p.$("#mu-overlay").textContent, /天气 酷暑/);
  p.UI.closeChart();
  p.UI.stop();
});
