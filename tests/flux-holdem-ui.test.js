// Flux Hold'em（#488）· 界面 flux-holdem-ui.js（共用零件 flux-ui.js）：标题「本地玩法」里的入口（名字读配置、排在 Flux Duel 后面）、设置页（人数、难度、规则）、
// 牌桌（对手一排只有牌背、公共层牌 / 天气翻开一张亮一张、自己坐庄时偷看的那张只有自己看得到）、点手牌盖下、用点按钮的方式和 AI 打完一局（2–4 人）、
// 亮牌横幅（每人的牌和分、主池 / 边池归谁、平分）、全押按钮、追加窗口、克制表和元素牌的悬停预览按场上的天气（两张叠加）算实际得分；
// 结算前的过渡（#525）：最后一步 → 翻牌一张一步（相位全押一口气翻完的也一张一张翻）→ 亮牌 → 判定中 → 结算横幅，弃牌直接赢的也有，点一下桌面跳过，过渡中 AI 不走。
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
/** 结算前的过渡（#525）：这几条只看结算横幅——确认先放了过渡，点「直接看结算」跳过 */
function skipSettle(p) {
  assert.ok(p.UI.state().settle, "结算前先放过渡");
  click(p.$('#fh-actions [data-fh="skipSettle"]'));
}
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
  skipSettle(p);
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
  // 你全押 6 枚：主池 6 × 3 − 盲注 3 = 15（三个人都能分；盲注进累积奖池，#534）；乙、丙多押的 6 × 2 = 12 是边池（你分不到）
  assert.match(text, /主池 15 枚/);
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
  skipSettle(p);
  p.UI.stop();
  // 第 1 张天气是相位：不进第二轮下注，直接亮牌；两边都是酸 +3，同分滚存
  assert.equal(game.results.length, 1);
  const banner = p.$("#fh-banner");
  assert.ok(visible(banner));
  const text = banner.textContent;
  assert.match(text, /翻到相位（第 1 张天气）：没弃牌的人全押，各押到 30 枚/);
  assert.match(text, /同分，底池滚到下一轮/);
  assert.match(text, /主池 57 枚：你、乙同分（相位全押），滚到下一轮/);
  assert.match(text, /累积奖池 3 枚：你、乙同分，留到下一轮/);
  assert.match(text, /你 −30 枚/);
  assert.match(p.$("#fh-side .cc-results").textContent, /同分，底池滚到下一轮/);
  click(banner.querySelector('[data-fh="dismiss"]'));
  p.UI.stop();
  // 第 2 轮：乙输光了先借，庄家（乙）偷看后放好；底池里先放着滚存的 57 枚（60 − 盲注 3，盲注在累积奖池里，#534）
  p.X.act(game, "p2", { type: "borrow", amount: 6 });
  p.X.act(game, "p2", { type: "place", where: "top" });
  p.UI.render();
  assert.equal(game.stage, "play");
  assert.match(p.$("#fh-board .cc-pot").textContent, /含滚存 57/);
  assert.match(p.$("#fh-actions .cc-info").textContent, /底池含上一轮滚存 57 枚/);
  // 打完第 2 轮：横幅写主池含上一轮滚存的
  p.X.act(game, "p2", { type: "play", card: "ice" });
  p.UI.render();
  click(mine(p, "fire"));
  p.UI.stop();
  for (let i = 0; i < 12 && game.results.length < 2; i++) {
    const id = p.X.toAct(game)[0], L = p.X.legal(game, id);
    p.X.act(game, id, { type: L.some(o => o.type === "pass") ? "pass" : L.some(o => o.type === "check") ? "check" : "call" });
  }
  assert.equal(game.results[1].carryIn, 57);
  p.UI.state().banner = game.results[1];
  p.UI.render();
  assert.match(p.$("#fh-banner").textContent, /主池 \d+ 枚(归你|归乙|由你、乙平分)（含上一轮滚存的 57 枚）/);
  p.UI.stop();
});

/* ---------- 累积奖池、最后一轮同分加赛（#534，主人 10/31） ---------- */
/** 10 张天气、没有相位：5 轮各翻 2 张（第 r 轮翻第 2r−1、2r 张） */
const W10 = ["heat", "snow", "acid", "thunder", "glow", "sand", "heat", "snow", "acid", "thunder"];
/** 规则层替所有人打完这一轮：不借、偷看后留在顶上、盖 cards[座位]、都不追加 / 过牌 / 跟注（到最后一轮同分进加赛也停） */
function quietRules(X, g, cards) {
  const r = g.round;
  for (let i = 0; i < 80 && g.round === r && !g.over && g.stage !== "playoff"; i++) {
    const who = X.toAct(g), id = who[0], L = X.legal(g, id);
    if (g.stage === "peek") X.act(g, id, { type: "place", where: "top" });
    else if (g.stage === "play") who.forEach(k => X.act(g, k, { type: "play", card: cards[k] }));
    else X.act(g, id, { type: ["noLoan", "pass", "check", "call"].find(t => L.some(o => o.type === t)) });
  }
}

test("累积奖池（#534）：底池旁边另一叠写累积奖池的数目（盲注都进这里，不算在底池里），提示行也写；横幅写累积奖池同分留到下一轮 / 归谁；规则说明写累积奖池和加赛", () => {
  const p = page();
  const game = p.X.newGame({ seed: "奖池", players: [{ id: "p1", name: "你" }, { id: "p2", name: "乙" }, { id: "p3", name: "丙" }], layers: LAYERS.slice(), weathers: W10.slice(),
    hands: { p1: ["fire", "ice", "physical"], p2: ["physical", "fire", "ice"], p3: ["ice", "physical", "fire"] }, elements: ["harmonic", "energy", "acid"] });
  p.UI.start({ game, human: "p1", levels: { p2: "easy", p3: "easy" }, seed: "奖池" });
  p.UI.stop();
  const rules = p.$("#fh-side .cc-rules").textContent;
  assert.match(rules, /累积奖池：每轮交的小盲、大盲不进这一轮的底池，进公开的累积奖池（下注照旧：盲注算自己这一轮已经下的注，大盲算第一次下注，别人要跟到这个数）/);
  assert.match(rules, /单独拿到最高分的人拿走整个累积奖池（全押的也整个拿走，不受边池限制；其他人都弃牌、只剩一个人也拿走）；最高分不止一人就不分，留到下一轮接着累积/);
  assert.match(rules, /加赛：最后一轮还同分，底池 \/ 边池照常结算，累积奖池由同分的人加赛：不下注，每人从剩下的手牌里再盖 1 张；公共层牌 10 张全部重洗、翻 2 张，天气 7 张全部重洗、翻 2 张，照常计分（翻到相位当作没有修正的天气，不全押）/);
  assert.match(rules, /还同分的人里有人手牌用光了就不再加赛，由还同分的人平分。对局提前结束（只剩一个人没出局）时还有累积奖池，归坐在桌上的那个人/);
  click(p.$('#fh-actions [data-fh="place"][data-where="top"]'));
  p.UI.stop();
  // 小盲 1、大盲 2 进累积奖池：底池 0，累积奖池 3
  const jp = () => p.$("#fh-board .cc-pot .fh-jackpot");
  assert.equal(jp().querySelector("b").textContent, "3");
  assert.match(jp().textContent, /累积奖池/);
  assert.match(jp().getAttribute("title"), /每轮的小盲、大盲都进这里（不算在底池里）；没弃牌的人里单独拿到最高分的人整个拿走，同分留到下一轮，最后一轮同分就加赛/);
  assert.equal(p.$("#fh-board .cc-pot .cc-potstack > b").textContent, "0", "盲注不算在底池里");
  p.X.act(game, "p2", { type: "play", card: "fire" }); p.X.act(game, "p3", { type: "play", card: "ice" });
  p.UI.render();
  click(mine(p, "ice"));
  p.UI.stop();
  p.X.act(game, "p2", { type: "call" }); p.X.act(game, "p3", { type: "check" });
  p.UI.render();
  const info = p.$("#fh-actions .cc-info").textContent;
  assert.match(info, /小盲 1 \/ 大盲 2（进累积奖池）/);
  assert.match(info, /累积奖池 3 枚（单独最高分拿走，同分留到下一轮）/);
  assert.match(p.$("#fh-actions").textContent, /要跟 2 枚/, "跟注的数目照旧（大盲算第一次下注）");
  click(p.$('#fh-actions [data-fh="call"]'));
  p.UI.stop();
  p.X.act(game, "p2", { type: "pass" }); p.X.act(game, "p3", { type: "pass" });
  p.UI.render();
  click(p.$('#fh-actions [data-fh="pass"]'));
  p.UI.stop();
  // 第二轮：乙弃牌、丙过牌，你过牌——你和丙都是冰 0 分，同分
  p.X.act(game, "p2", { type: "fold" }); p.X.act(game, "p3", { type: "check" });
  p.UI.render();
  click(p.$('#fh-actions [data-fh="check"]'));
  skipSettle(p);
  p.UI.stop();
  const banner = p.$("#fh-banner").textContent;
  assert.match(banner, /主池 3 枚由你、丙平分；累积奖池 3 枚：你、丙同分，留到下一轮/);
  assert.match(p.$("#fh-side .cc-results").textContent, /你和别人平分主池（2 人）/);
  click(p.$('#fh-banner [data-fh="dismiss"]'));
  p.UI.stop();
  // 第 2 轮：累积奖池 3 + 小盲 2 + 大盲 4 = 9；上一轮弃牌的乙能量 +2 单独最高分，拿走
  p.X.act(game, "p2", { type: "place", where: "top" });
  p.UI.render();
  assert.equal(jp().querySelector("b").textContent, "9");
  quietRules(p.X, game, { p1: "harmonic", p2: "energy", p3: "acid" });
  assert.equal(game.results[1].jackpot.winner, "p2");
  p.UI.state().banner = game.results[1];
  p.UI.render();
  assert.match(p.$("#fh-banner").textContent, /主池 6 枚归乙；累积奖池 9 枚归乙/);
  p.UI.stop();
});

test("最后一轮同分加赛（#534）：横幅写同分、加赛争累积奖池（按钮「去加赛」）→ 你点一张剩下的手牌盖下（不下注、层牌天气都是牌背）→ 结算前的过渡把重洗后翻开的层牌、天气一张一张翻 → 亮牌 → 判定中 → 加赛横幅写累积奖池归你 → 总结算写加赛了几次", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const p = page(), T = p.w.CounterCardsUI.UI_CONFIG.settle;
  // 两人拿的牌一模一样、每轮出一样的：每轮都同分，累积奖池一直留着（3 + 6 + 9 + 12 + 15 = 45）
  const game = p.X.newGame({ seed: "加赛", players: [{ id: "p1", name: "你" }, { id: "p2", name: "乙" }], layers: LAYERS.slice(), weathers: W10.slice(),
    hands: { p1: ["fire", "ice", "physical"], p2: ["fire", "ice", "physical"] },
    elements: ["harmonic", "harmonic", "acid", "acid", "energy", "energy", "electric", "electric"],
    playoff: [{ layers: ["shield", "sand", "flesh", "flesh", "armor", "armor", "shield", "sand", "spirit", "spirit"], weathers: ["acid", "thunder", "heat", "snow", "glow", "sand", "phase"] }] });
  ["fire", "ice", "physical", "harmonic", "acid"].forEach(c => quietRules(p.X, game, { p1: c, p2: c }));
  assert.equal(game.stage, "playoff");
  assert.equal(game.jackpot, 45);
  p.UI.start({ game, human: "p1", levels: { p2: "easy" }, seed: "加赛" });
  p.UI.stop();
  p.UI.state().banner = game.results[4];
  p.UI.render();
  const banner = p.$("#fh-banner");
  assert.match(banner.querySelector("h3").textContent, /同分，加赛争累积奖池/);
  assert.match(banner.textContent, /累积奖池 45 枚：你、乙同分，最后一轮，加赛/);
  assert.equal(banner.querySelector('[data-fh="dismiss"]').textContent, "去加赛");
  click(banner.querySelector('[data-fh="dismiss"]'));
  p.UI.stop();
  // 加赛：顶栏写第几次加赛；手里剩下的两张能点，没有下注按钮；层牌、天气都是牌背（全部重洗，天气堆 7 张）
  assert.match(p.$("#fh-top .cc-round").textContent, /第 5 \/ 5 轮 · 第 1 次加赛/);
  assert.match(prompt(p), /第 1 次加赛（争累积奖池 45 枚，不下注）：你和乙同分。从剩下的手牌里点一张再盖下/);
  assert.deepEqual(p.$$("#fh-board .cc-me button.cc-can").map(b => b.dataset.card), ["energy", "electric"]);
  assert.ok(!p.$$("#fh-actions button[data-fh]").some(b => ["check", "call", "bet", "raise", "fold"].includes(b.dataset.fh)), "加赛不下注");
  assert.equal(p.$$("#fh-board .fh-community .fh-hidden").length, 4);
  assert.equal(p.$("#fh-board .cc-deck b").textContent, "7");
  assert.match(p.$('#fh-board .fh-seat[data-seat="p2"] .fh-bet').textContent, /加赛/);
  assert.match(p.$("#fh-actions .cc-info").textContent, /第 1 次加赛 · 只争累积奖池 45 枚 · 不下注 · 翻到相位当作没有修正的天气，不全押/);
  // 乙（规则层替它）盖能量；你点电
  p.X.act(game, "p2", { type: "play", card: "energy" });
  p.UI.render();
  assert.ok(p.$('#fh-board .fh-seat[data-seat="p2"] .fh-played .cc-back'), "乙盖了（看不到是哪张）");
  assert.ok(!p.$('#fh-board .fh-seat[data-seat="p2"] [data-face="energy"]'));
  click(mine(p, "electric"));
  const st = settleOf(p);
  assert.ok(st && game.over, "规则层已经结算完（分出胜负，对局结束）");
  // 最后一步（你盖牌）连同翻开第 1 张层牌 → 第 2 张层牌 → 第 1 张天气 → 第 2 张天气 → 亮牌 → 判定中
  assert.deepEqual(J(st.beats), ["last", "flip", "flip", "flip", "show"]);
  assert.match(prompt(p), /你加赛盖下了一张元素牌。.*第 1 次加赛：翻开公共层牌〔护盾〕。/);
  assert.equal(p.$("#fh-board .cc-me .cc-acted").textContent, "加赛盖牌");
  assert.deepEqual(J(faces(p)), { layers: ["shield"], weathers: [] });
  assert.match(p.$("#fh-top .cc-round").textContent, /第 5 \/ 5 轮 · 第 1 次加赛/, "过渡中顶栏还是这一次加赛");
  assert.equal(p.$("#fh-board .cc-pot .fh-jackpot b").textContent, "45", "累积奖池还在桌上");
  assert.ok(!visible(banner));
  t.mock.timers.tick(T.lastMs);
  assert.deepEqual(J(faces(p)), { layers: ["shield", "sand"], weathers: [] });
  t.mock.timers.tick(T.flipMs);
  assert.deepEqual(J(faces(p)), { layers: ["shield", "sand"], weathers: ["acid"] });
  assert.equal(prompt(p), "翻开天气〔酸雨〕。");
  t.mock.timers.tick(T.flipMs);
  assert.deepEqual(J(faces(p)), { layers: ["shield", "sand"], weathers: ["acid", "thunder"] });
  t.mock.timers.tick(T.flipMs);
  assert.equal(st.phase, "show");
  assert.equal(prompt(p), "亮牌：你〔电〕、乙〔能量〕。");
  assert.ok(p.$('#fh-board .fh-seat[data-seat="p2"] .fh-played [data-face="energy"]'), "乙加赛盖的能量翻过来");
  t.mock.timers.tick(T.flipMs);
  assert.equal(st.phase, "judge");
  assert.match(p.$("#fh-actions").textContent, /加赛：每人新盖的元素牌对重洗后翻开的 2 张公共层牌计分求和（两张天气叠加），单独最高分的人拿走累积奖池/);
  t.mock.timers.tick(T.reducedJudgeMs);
  // 加赛的横幅：护盾 + 沙尘、酸雨 + 雷鸣：电 +4、能量 +2——你单独最高分，拿走 45 枚
  assert.ok(visible(banner) && !settleOf(p));
  assert.match(banner.querySelector("small").textContent, /第 5 轮 · 第 1 次加赛 · 层牌 〔护盾〕〔沙尘〕 · 天气 酸雨 \+ 雷鸣/);
  assert.equal(banner.querySelector("h3").textContent, "你拿走累积奖池");
  assert.match(banner.textContent, /你〔电〕得 \+4/);
  assert.match(banner.textContent, /乙〔能量〕得 \+2/);
  assert.match(banner.textContent, /累积奖池 45 枚归你/);
  assert.match(banner.textContent, /你 \+45 枚/);
  assert.ok(p.$("#fh-board .cc-me .cc-chips.cc-collect"), "拿到累积奖池：你的筹码收进来");
  assert.match(p.$("#fh-side .cc-results").textContent, /第 5 轮 · 第 1 次加赛你拿走累积奖池/);
  click(banner.querySelector('[data-fh="dismiss"]'));
  assert.match(p.$("#fh-banner .cc-final").textContent, /对局结束 · 打了 5 轮（最后一轮同分，加赛 1 次）/);
});

test("最后一轮同分加赛（#534）：你没同分就不参加——座位写「不参加加赛」，手牌不能点，等加赛的人盖牌", () => {
  const p = page();
  // 乙、丙拿的牌一样、每轮出一样的；你一直出谐波，第 5 轮乙丙电 +3、你谐波 +1
  const game = p.X.newGame({ seed: "旁观加赛", players: [{ id: "p1", name: "你" }, { id: "p2", name: "乙" }, { id: "p3", name: "丙" }], layers: LAYERS.slice(), weathers: W10.slice(),
    hands: { p1: ["harmonic", "harmonic", "harmonic"], p2: ["fire", "ice", "physical"], p3: ["fire", "ice", "physical"] },
    elements: ["harmonic", "harmonic", "harmonic", "harmonic", "acid", "acid", "harmonic", "energy", "energy", "harmonic", "electric", "electric"] });
  ["fire", "ice", "physical", "energy", "electric"].forEach(c => quietRules(p.X, game, { p1: "harmonic", p2: c, p3: c }));
  assert.equal(game.stage, "playoff");
  assert.deepEqual(J(game.playoff.ids), ["p2", "p3"]);
  p.UI.start({ game, human: "p1", levels: { p2: "easy", p3: "easy" }, seed: "旁观加赛" });
  p.UI.stop();
  assert.equal(p.$$("#fh-board .cc-me button.cc-can").length, 0, "不参加加赛：手牌不能点");
  assert.match(p.$("#fh-board .cc-me .cc-slot").textContent, /不参加加赛/);
  assert.match(p.$("#fh-actions").textContent, new RegExp(`乙、丙在加赛（争累积奖池 ${game.jackpot} 枚）`));
  ["p2", "p3"].forEach(id => assert.match(p.$(`#fh-board .fh-seat[data-seat="${id}"] .fh-bet`).textContent, /加赛/));
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

/* ---------- 结算前的过渡（主人 10/30 试玩反馈，#525；计时同 High Flux 的 UI_CONFIG.settle）：用假时钟（t.mock.timers）一段段往前拨 ---------- */
/** 两人桌（你坐庄、乙是 AI）：规则层替两边走到第二轮下注、轮到你——偷看留在顶上；乙盖物理、你盖火；第一轮乙过牌、你跟注、都不追加，
 *  翻开第 1 张天气；第二轮乙先过牌。层牌照 LAYERS（肉体、装甲），天气照 WEATHERS（酷暑、微光） */
function bet2Game(p, seed) {
  const g = p.X.newGame({ seed, players: [{ id: "p1", name: "你" }, { id: "p2", name: "乙" }], layers: LAYERS.slice(), weathers: WEATHERS.slice(),
    hands: { p1: ["fire", "ice", "acid"], p2: ["physical", "ice", "energy"] }, elements: [] });
  const A = (id, type, extra) => p.X.act(g, id, Object.assign({ type }, extra || {}));
  A("p1", "place", { where: "top" });
  A("p2", "play", { card: "physical" }); A("p1", "play", { card: "fire" });
  A("p2", "check"); A("p1", "call"); A("p2", "pass"); A("p1", "pass");
  A("p2", "check");
  return g;
}
/** 桌上翻开了的公共层牌、天气（没翻开的是牌背，不算） */
const faces = (p) => ({ layers: p.$$("#fh-board .fh-community .fh-layer").map(x => x.dataset.face), weathers: p.$$("#fh-board .fh-community [data-weather]").map(x => x.dataset.weather) });
const prompt = (p) => p.$("#fh-actions .cc-prompt").textContent;
const settleOf = (p) => p.UI.state().settle;
const barBtns = (p) => p.$$("#fh-actions button[data-fh]").map(b => b.dataset.fh);

test("结算前的过渡（主人 10/30 试玩反馈，#525）：摊牌——人过牌以后横幅不马上出来：最后一步（连同翻开第 2 张层牌）→ 第 2 张天气 → 亮牌（盖下的牌翻过来，不写分）→ 判定中 → 结算横幅，最后一步停 UI_CONFIG.settle.lastMs、之后每翻一张 / 亮牌停 flipMs（主人 10/31：一张牌至少一秒）、判定中停 reducedJudgeMs（开着减少动态效果）；过渡中桌上停在结算之前，AI 不走，记录、每轮结算里还没有这一轮", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const p = page(), T = p.w.CounterCardsUI.UI_CONFIG.settle;   // 页面开着「减少动态效果」
  const g = bet2Game(p, "过渡");
  p.UI.start({ game: g, human: "p1", levels: { p2: "easy" }, seed: "过渡" });   // 不是 fast
  const banner = p.$("#fh-banner"), pot = p.UI.view().pot;
  click(p.$('#fh-actions [data-fh="check"]'));
  assert.equal(g.results.length, 1, "规则层已经结算完");
  assert.equal(g.round, 2, "也开了下一轮（乙坐庄，轮到它偷看）");
  const st = settleOf(p), snap = JSON.stringify(g);
  // ① 最后一步：你过牌，紧接着翻开第 2 张层牌
  assert.ok(!visible(banner), "横幅不马上出来");
  assert.deepEqual([st.phase, st.at], ["last", 0]);
  assert.deepEqual(J(st.beats), ["last", "flip", "show"]);
  assert.equal(prompt(p), "你过牌。 翻开第 2 张公共层牌〔装甲〕。", "操作栏写最后一步做了什么、翻开了哪张");
  assert.deepEqual(barBtns(p), ["skipSettle"], "过渡中只有「直接看结算」");
  assert.equal(p.$("#fh-board .cc-me .cc-acted").textContent, "过牌", "座位上标着刚走的这一步");
  assert.deepEqual(J(faces(p)), { layers: ["flesh", "armor"], weathers: ["heat"] }, "第 2 张层牌翻开了，第 2 张天气还盖着");
  assert.ok(p.$('#fh-board .fh-layer[data-face="armor"]').classList.contains("cc-flip"), "翻牌动画");
  assert.equal(p.$$("#fh-board .fh-community .fh-hidden").length, 1);
  assert.match(p.$("#fh-top .cc-round").textContent, /第 1 \/ 5 轮/, "顶栏还是这一轮");
  assert.ok(p.$('#fh-board .fh-seat[data-seat="p2"] .fh-played .cc-back') && !p.$('#fh-board [data-face="physical"]'), "还没亮牌");
  assert.equal(p.$("#fh-board .cc-pot .cc-chips > b").textContent, String(pot), "底池还是结算之前的");
  assert.equal(p.$$("#fh-side .cc-results .cc-res").length, 0, "每轮结算里还没有这一轮");
  assert.ok(!p.$("#fh-side .cc-log").textContent.includes("第 1 轮亮牌"), "记录里还没有这一轮的结果");
  assert.ok(!p.$("#fh-side .cc-log").textContent.includes("微光"), "记录里也还没有第 2 张天气");
  t.mock.timers.tick(T.lastMs - 1);
  assert.equal(st.at, 0, "每步停 lastMs");
  t.mock.timers.tick(1);
  // ② 第 2 张天气
  assert.deepEqual([st.phase, st.at], ["flip", 1]);
  assert.equal(prompt(p), "翻开第 2 张天气〔微光〕。");
  assert.deepEqual(J(faces(p)), { layers: ["flesh", "armor"], weathers: ["heat", "glow"] });
  assert.ok(p.$('#fh-board [data-weather="glow"]').classList.contains("cc-flip") && p.$("#fh-board .cc-flash"), "翻牌、闪一下");
  assert.ok(!p.$('#fh-board .fh-layer[data-face="armor"]').classList.contains("cc-flip"), "层牌的翻牌动画只放一次");
  assert.equal(p.$("#fh-game").dataset.weather, "glow", "天气特效换成刚翻开的这张");
  assert.match(p.$("#fh-side .cc-log").textContent, /同时翻开第 2 张公共层牌〔装甲〕和第 2 张天气〔微光〕/, "两张都翻开了，记录才写");
  t.mock.timers.tick(T.flipMs);
  // ③ 亮牌：盖下的牌翻过来（不写分，分在横幅上）
  assert.deepEqual([st.phase, st.at], ["show", 2]);
  assert.equal(prompt(p), "亮牌：你〔火〕、乙〔物理〕。");
  assert.ok(p.$('#fh-board .fh-seat[data-seat="p2"] .fh-played [data-face="physical"].cc-flip'), "乙盖下的物理翻过来");
  assert.ok(p.$('#fh-board .cc-me .cc-slot [data-face="fire"]'), "自己那张也翻过来");
  assert.ok(!/得 [+−]?\d/.test(p.$("#fh-board").textContent), "桌上不写分");
  assert.ok(!visible(banner));
  t.mock.timers.tick(T.flipMs);
  // ④ 判定中
  assert.equal(st.phase, "judge");
  assert.match(prompt(p), /^判定中/);
  assert.match(p.$("#fh-actions").textContent, /亮牌：你〔火〕、乙〔物理〕。/, "亮牌那一步还写着");
  assert.ok(p.$("#fh-board .cc-pot.cc-judging .cc-judge"), "底池发光，贴着「判定中」");
  assert.ok(p.$("#fh-board .fh-opps.cc-judging .fh-played [data-face]") && p.$("#fh-board .cc-me .cc-slot.cc-judging [data-face]"), "亮出来的牌轻轻抖");
  t.mock.timers.tick(T.reducedJudgeMs - 1);
  assert.ok(!visible(banner), "开着减少动态效果：判定中停 reducedJudgeMs");
  assert.equal(JSON.stringify(g), snap, "过渡中 AI 不走");
  t.mock.timers.tick(1);
  // ⑤ 结算横幅
  assert.ok(visible(banner) && banner.querySelector('[data-fh="dismiss"]'), "最后才弹出结算横幅");
  assert.equal(settleOf(p), null);
  assert.match(banner.textContent, /你〔火〕得/);
  assert.equal(p.$$("#fh-side .cc-results .cc-res").length, 1);
  const winners = g.results[0].pots[0].winners;
  if (winners.indexOf("p1") >= 0) assert.ok(p.$("#fh-board .cc-me .cc-chips.cc-collect"), "拿到底池的那边筹码收进来");
  if (winners.indexOf("p2") >= 0) assert.ok(p.$('#fh-board .fh-seat[data-seat="p2"] .cc-chips.cc-collect'), "拿到底池的那边筹码收进来");
  t.mock.timers.tick(5000);
  assert.equal(JSON.stringify(g), snap, "横幅开着 AI 也不走");
  click(banner.querySelector('[data-fh="dismiss"]'));
  t.mock.timers.tick(p.w.FluxUI.UI_CONFIG.aiDelay);
  assert.notEqual(JSON.stringify(g), snap, "点「继续」以后 AI 接着走");
  // 减少动态效果：过渡里的动画都去掉
  const motion = (f) => read(f).match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)[1];
  assert.ok(motion("flux.css").includes(".fh-opps.cc-judging .fh-played .cc-card"), "减少动态效果：亮出来的牌不抖");
  assert.ok(motion("counter-cards.css").includes(".fh-seat .cc-acted"), "减少动态效果：对手座位上的标签不弹");
});

test("结算前的过渡：翻到相位全押、一口气翻完剩下的牌——桌上一张一张翻：最后一步连同第 1 张天气（相位，全押的筹码推进底池）→ 第 2 张层牌 → 第 2 张天气 → 亮牌，每张之间停 flipMs；没开减少动态效果时判定中停 judgeMs", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const p = page();
  p.w.matchMedia = () => ({ matches: false });   // 没开「减少动态效果」
  const T = p.w.CounterCardsUI.UI_CONFIG.settle;
  const g = p.X.newGame({ seed: "相位过渡", players: [{ id: "p1", name: "你" }, { id: "p2", name: "乙", chips: 30 }], layers: LAYERS.slice(),
    weathers: ["phase", "heat", "snow", "acid", "thunder", "glow", "sand"], hands: { p1: ["acid", "fire", "ice"], p2: ["acid", "ice", "physical"] }, elements: ["ice", "fire"] });
  const A = (id, type, extra) => p.X.act(g, id, Object.assign({ type }, extra || {}));
  A("p1", "place", { where: "top" }); A("p2", "play", { card: "acid" }); A("p1", "play", { card: "acid" });
  A("p2", "check"); A("p1", "call"); A("p2", "pass");
  p.UI.start({ game: g, human: "p1", levels: { p2: "easy" }, seed: "相位过渡" });
  click(p.$('#fh-actions [data-fh="pass"]'));   // 你也不追加：关窗，翻开第 1 张天气——相位，全押，直接亮牌
  assert.ok(g.results.length === 1 && g.results[0].allIn, "翻到相位：全押、亮牌结算了");
  const st = settleOf(p);
  assert.deepEqual(J(st.beats), ["last", "flip", "flip", "show"], "剩下的牌一张一步");
  // ① 最后一步（从开窗的那一下跟注写起）+ 第 1 张天气（相位）：全押的筹码推进底池
  assert.equal(prompt(p), "你跟注 1 枚。 都不追加，追加窗口关闭。 翻开第 1 张天气〔相位〕。 翻到相位：没弃牌的人全押，各押到 30 枚（没弃牌的人里筹码最少那位的全部筹码），不再下注，直接比分。");
  assert.equal(p.$("#fh-board .cc-me .cc-acted").textContent, "跟注 1 枚");
  assert.deepEqual(J(faces(p)), { layers: ["flesh"], weathers: ["phase"] }, "只翻开了第 1 张天气");
  assert.ok(p.$('#fh-board [data-weather="phase"]').classList.contains("cc-flip") && p.$("#fh-board .cc-flash"), "翻牌、闪一下");
  assert.equal(p.$("#fh-board .cc-pot .cc-chips > b").textContent, "57", "全押的筹码推进底池（盲注 3 枚在累积奖池里，#534）");
  assert.match(p.$('#fh-board .fh-seat[data-seat="p2"] .fh-bet').textContent, /本轮押 30 · 全押/);
  assert.equal(p.$("#fh-board .cc-me .cc-chips > b").textContent, "20");
  t.mock.timers.tick(T.lastMs - 1);
  assert.equal(st.at, 0);
  t.mock.timers.tick(1);
  assert.deepEqual([st.phase, st.at], ["flip", 1]);
  assert.deepEqual(J(faces(p)), { layers: ["flesh", "armor"], weathers: ["phase"] }, "一张一张翻：先第 2 张层牌，第 2 张天气还盖着");
  assert.equal(prompt(p), "翻开第 2 张公共层牌〔装甲〕。");
  t.mock.timers.tick(T.flipMs);
  assert.deepEqual([st.phase, st.at], ["flip", 2]);
  assert.deepEqual(J(faces(p)), { layers: ["flesh", "armor"], weathers: ["phase", "heat"] }, "再翻第 2 张天气");
  assert.equal(prompt(p), "翻开第 2 张天气〔酷暑〕。");
  t.mock.timers.tick(T.flipMs);
  assert.equal(st.phase, "show");
  assert.equal(prompt(p), "亮牌：你〔酸〕、乙〔酸〕。");
  t.mock.timers.tick(T.flipMs);
  assert.equal(st.phase, "judge");
  t.mock.timers.tick(T.judgeMs - 1);
  assert.ok(!visible(p.$("#fh-banner")), "没开减少动态效果：判定中停 judgeMs");
  t.mock.timers.tick(1);
  assert.ok(visible(p.$("#fh-banner")));
  assert.match(p.$("#fh-banner").textContent, /同分，底池滚到下一轮/);
  assert.ok(!p.$("#fh-board .cc-chips.cc-collect"), "底池滚到下一轮：谁的筹码都不收进来");
});

test("结算前的过渡：有人弃牌直接赢也走过渡——最后一步（谁弃牌，标在座位上；AI 弃的也停一下）→ 亮牌（主人 10/31：每个人这一轮盖下的牌都亮，弃牌的也亮）（最后一步停 lastMs、亮牌停 flipMs） 就弹横幅，不判定、不翻牌；横幅写每人亮出来的牌；赢家的筹码收进来", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const T = page().w.CounterCardsUI.UI_CONFIG.settle;
  // 你弃牌
  let p = page(), g = bet2Game(p, "弃牌");
  p.UI.start({ game: g, human: "p1", levels: { p2: "easy" }, seed: "弃牌" });
  click(p.$('#fh-actions [data-fh="fold"]'));
  assert.equal(g.results[0].outcome, "fold");
  let st = settleOf(p);
  assert.deepEqual([J(st.beats), st.judge], [["last", "show"], false], "最后一步 → 亮牌，不判定");
  assert.equal(prompt(p), "你弃牌。");
  assert.equal(p.$("#fh-board .cc-me .cc-acted").textContent, "弃牌");
  assert.deepEqual(J(faces(p)), { layers: ["flesh"], weathers: ["heat"] }, "弃牌不翻牌");
  assert.ok(!p.$('#fh-board [data-face="physical"]'), "最后一步还没亮牌");
  assert.ok(!visible(p.$("#fh-banner")));
  t.mock.timers.tick(T.lastMs - 1);
  assert.ok(!visible(p.$("#fh-banner")) && settleOf(p).phase === "last", "最后一步停 lastMs");
  t.mock.timers.tick(1);
  // 亮牌：两人盖下的牌都翻过来（弃牌的你也亮），不翻第 2 张层牌、天气
  assert.equal(settleOf(p).phase, "show");
  assert.equal(prompt(p), "亮牌：你〔火〕（弃牌）、乙〔物理〕。");
  assert.ok(p.$('#fh-board .fh-seat[data-seat="p2"] [data-face="physical"]'), "乙盖下的物理翻过来");
  assert.deepEqual(J(faces(p)), { layers: ["flesh"], weathers: ["heat"] }, "亮牌也不翻第 2 张层牌、天气");
  assert.ok(!visible(p.$("#fh-banner")));
  t.mock.timers.tick(T.flipMs);
  assert.ok(visible(p.$("#fh-banner")) && !settleOf(p), "弃牌：亮牌之后直接弹横幅（不判定）");
  assert.match(p.$("#fh-banner").textContent, /你弃牌了/);
  assert.match(p.$("#fh-banner .fh-shown").textContent, /你〔火〕弃牌/);
  assert.match(p.$("#fh-banner .fh-shown").textContent, /乙〔物理〕/);
  assert.doesNotMatch(p.$("#fh-banner").textContent, /不亮牌/);
  assert.ok(p.$('#fh-board .fh-seat[data-seat="p2"] .cc-chips.cc-collect'), "乙拿走底池：它的筹码收进来");
  // AI 弃牌：你下注，乙（AI）弃牌——也停一下，标在乙的座位上
  p = page(); g = bet2Game(p, "AI弃牌");
  const step = p.w.FluxHoldemAI.step;
  p.w.FluxHoldemAI.step = (game, id, level, r) => (game.stage === "bet2" ? !!p.X.act(game, id, { type: "fold" }) : step(game, id, level, r));
  p.UI.start({ game: g, human: "p1", levels: { p2: "easy" }, seed: "AI弃牌" });
  click(p.$('#fh-actions [data-fh="bet"]'));
  assert.equal(g.results.length, 0, "轮到乙");
  t.mock.timers.tick(p.w.FluxUI.UI_CONFIG.dealMs);   // 开局 AI 等发牌动画放完才走
  assert.equal(g.results[0].outcome, "fold");
  st = settleOf(p);
  assert.equal(st.phase, "last");
  assert.equal(prompt(p), "乙弃牌。");
  assert.equal(p.$('#fh-board .fh-seat[data-seat="p2"] .cc-acted').textContent, "弃牌", "标在乙的座位上");
  assert.ok(p.$('#fh-board .fh-seat[data-seat="p2"]').classList.contains("folded"));
  assert.ok(!visible(p.$("#fh-banner")));
  t.mock.timers.tick(T.lastMs);
  assert.equal(settleOf(p).phase, "show", "AI 弃牌也亮牌");
  assert.equal(prompt(p), "亮牌：你〔火〕、乙〔物理〕（弃牌）。");
  t.mock.timers.tick(T.flipMs);
  assert.ok(visible(p.$("#fh-banner")));
  assert.match(p.$("#fh-banner").textContent, /其他人都弃牌，你拿走底池/);
  assert.match(p.$("#fh-banner .fh-shown").textContent, /乙〔物理〕弃牌/);
  assert.ok(p.$("#fh-board .cc-me .cc-chips.cc-collect"), "你拿走底池：你的筹码收进来");
});

test("结算前的过渡：点一下桌面直接看结算（翻牌那几步、亮牌、判定中都行；操作栏按钮以外的地方、「直接看结算」也行），点侧栏不算；跳过以后计时也停了；fast（测试用）不停", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const T = page().w.CounterCardsUI.UI_CONFIG.settle;
  const open = (seed, fast) => {
    const p = page(), g = bet2Game(p, seed);
    p.UI.start({ game: g, human: "p1", levels: { p2: "easy" }, seed, fast });
    click(p.$('#fh-actions [data-fh="check"]'));
    return p;
  };
  const steps = (n) => { for (let i = 0; i < n; i++) t.mock.timers.tick(settleOf(p).phase === "last" ? T.lastMs : T.flipMs); };   // 一步一步拨：下一步的计时是上一步到点时才排的
  // 最后一步的时候点牌桌
  let p = open("跳过1");
  assert.equal(settleOf(p).phase, "last");
  click(p.$("#fh-side h3"));
  assert.ok(settleOf(p) && !visible(p.$("#fh-banner")), "点侧栏不算");
  click(p.$("#fh-board .cc-deck"));
  assert.equal(settleOf(p), null);
  assert.ok(visible(p.$("#fh-banner")), "点一下桌面：直接看结算");
  t.mock.timers.tick(10000);
  assert.ok(visible(p.$("#fh-banner")), "跳过以后计时也停了，横幅留着");
  // 亮牌那一步点操作栏（按钮以外）
  p = open("跳过2");
  steps(2);
  assert.equal(settleOf(p).phase, "show");
  click(p.$("#fh-actions .cc-prompt"));
  assert.ok(visible(p.$("#fh-banner")) && !settleOf(p), "点操作栏也行");
  // 判定中点桌上亮出来的牌
  p = open("跳过3");
  steps(3);
  assert.equal(settleOf(p).phase, "judge");
  click(p.$("#fh-board .fh-played [data-face]"));
  assert.ok(visible(p.$("#fh-banner")), "判定中点一下桌面也行");
  // 翻牌那一步点「直接看结算」
  p = open("跳过4");
  steps(1);
  assert.equal(settleOf(p).phase, "flip");
  const skip = p.$('#fh-actions [data-fh="skipSettle"]');
  assert.equal(skip.textContent, T.skip);
  assert.equal(skip.getAttribute("title"), T.skipHint);
  click(skip);
  assert.ok(visible(p.$("#fh-banner")) && !settleOf(p), "「直接看结算」");
  // fast：不停，直接弹
  p = open("fast", true);
  assert.equal(settleOf(p), null);
  assert.ok(visible(p.$("#fh-banner")), "fast：不停");
  // 放到一半打开 fast：也马上看结算
  p = open("中途fast");
  p.UI.setFast(true);
  assert.ok(visible(p.$("#fh-banner")) && !settleOf(p), "setFast(true)：正在放的过渡也不等了");
});

test("结算前的过渡：不开 fast 和 3 个 AI 打完一局——每一轮都先放过渡（最后一步 → 翻牌一张一步 → 亮牌 → 判定中；弃牌直接赢的只有最后一步）再弹横幅；过渡中 AI 不走、追加窗口不计时、只有「直接看结算」、点不了牌；最后一轮的横幅点「看总结算」才出总结算", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const p = page(), T = p.w.CounterCardsUI.UI_CONFIG.settle, r = rng(525);
  const game = p.UI.start({ players: 4, level: "normal", seed: "过渡整局" });
  const st = () => p.UI.state(), banner = p.$("#fh-banner"), snap = () => JSON.stringify(game);
  const tickUntil = (done) => { for (let i = 0; i < 400 && !done(); i++) t.mock.timers.tick(50); assert.ok(done(), "AI 一直没走"); };
  let seen = 0, beats = 0;
  for (let guard = 0; guard < 3000; guard++) {
    const s = st();
    if (s.settle) {
      const res = game.results[game.results.length - 1], before = snap(), names = s.settle.beats.slice();
      assert.ok(!visible(banner), `第 ${res.r} 轮：横幅不马上出来`);
      assert.match(p.$("#fh-top .cc-round").textContent, new RegExp(`第 ${res.r} / 5 轮`));
      assert.equal(p.$$("#fh-side .cc-results .cc-res").length, game.results.length - 1, "每轮结算里还没有这一轮");
      assert.equal(names[0], "last");
      if (res.outcome === "fold") assert.deepEqual(names, ["last", "show"], "弃牌直接赢：最后一步 → 亮牌（主人 10/31：每轮亮出所有人的牌）");
      else assert.equal(names[names.length - 1], "show", "摊牌：最后一步是亮牌");
      names.forEach((name, i) => {
        assert.deepEqual([s.settle.phase, s.settle.at], [name, i]);
        assert.deepEqual(barBtns(p), ["skipSettle"], "过渡中只有「直接看结算」");
        assert.ok(!p.$("#fh-actions .cc-count") && !s.win, "过渡中追加窗口不计时");
        assert.ok(!p.$("#fh-board button.cc-can"), "点不了牌");
        assert.ok(!visible(banner));
        t.mock.timers.tick(name === "last" ? T.lastMs : T.flipMs);
        beats++;
      });
      if (res.outcome !== "fold") { assert.equal(s.settle.phase, "judge", `第 ${res.r} 轮：判定中`); t.mock.timers.tick(T.reducedJudgeMs); }
      assert.ok(visible(banner) && banner.querySelector('[data-fh="dismiss"]') && !banner.querySelector(".cc-final"), `第 ${res.r} 轮：最后才弹结算横幅`);
      assert.equal(snap(), before, "过渡中 AI 不走");
      seen++;
      continue;
    }
    if (visible(banner)) {
      if (banner.querySelector(".cc-final")) break;
      const d = banner.querySelector('[data-fh="dismiss"]');
      if (game.over) assert.equal(d.textContent, "看总结算");
      click(d);
      continue;
    }
    const waiting = p.X.toAct(game), w = game.betting && game.betting.window;
    const mine = waiting.indexOf(s.human) >= 0 && !(w && w.passed[s.human]);
    if (!mine) { const before = snap(); assert.ok(waiting.length, "没人可动：" + game.stage); tickUntil(() => snap() !== before); continue; }   // AI 等一会儿走一步
    const card = p.$("#fh-board .cc-me button.cc-can");
    if (card) { click(card); continue; }
    const btns = p.$$("#fh-actions button[data-fh]").filter(b => !b.disabled && b.dataset.fh !== "amt");
    assert.ok(btns.length, "没有能点的按钮：" + game.stage);
    const bet = btns.filter(b => ["check", "call", "bet", "raise", "fold", "pass", "allIn"].includes(b.dataset.fh));
    click(bet.length ? (r() < 0.06 ? bet.find(b => b.dataset.fh === "fold") || bet[0] : bet[Math.floor(r() * bet.length)]) : btns.find(b => b.classList.contains("primary")) || btns[0]);
  }
  assert.ok(game.over && p.$("#fh-banner .cc-final"), "打完了，有总结算");
  assert.equal(seen, game.results.length, "每一轮都有过渡");
  assert.ok(beats > seen, "有翻牌、亮牌的那几步");
});

test("结算前的过渡：赌场桌（casino-ui.js 打开，带 casino）也一样——横幅等过渡放完才出来；牌局走的每一步照旧交给模式存档", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const p = page(), T = p.w.CounterCardsUI.UI_CONFIG.settle, g = bet2Game(p, "赌场过渡");
  let saves = 0;
  p.UI.start({ game: g, human: "p1", levels: { p2: "easy" }, seed: "赌场过渡", casino: { label: "后巷小桌", onChange: () => { saves++; }, onLeave() {}, onAgain() {} } });
  click(p.$('#fh-actions [data-fh="check"]'));
  assert.equal(saves, 1, "这一步（结算了）照旧叫模式存档");
  assert.ok(settleOf(p) && !visible(p.$("#fh-banner")), "赌场桌也先放过渡");
  assert.match(p.$("#fh-top").textContent, /后巷小桌/);
  [T.lastMs, T.flipMs, T.flipMs].forEach(ms => { t.mock.timers.tick(ms); assert.ok(!visible(p.$("#fh-banner"))); });   // 最后一步 → 第 2 张天气 → 亮牌 → 判定中
  t.mock.timers.tick(T.reducedJudgeMs);
  assert.ok(visible(p.$("#fh-banner")) && !settleOf(p), "放完才弹横幅");
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

test("真浏览器（手机 390×844）：不开 fast 和 3 个 AI 打完一局 Flux Hold'em——结算前的过渡照常放（翻牌一张一步、亮牌、判定中，「判定中」贴在牌桌里），不报错、没有横向溢出", { timeout: 240000 }, async (t) => {
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
    FluxHoldemUI.start({ players: 4, level: "normal", seed: "真浏览器-手机" });
  });
  const phases = new Set(), bad = [];
  let done = false;
  for (let i = 0; i < 4000 && !done; i++) {
    const m = await page.evaluate(() => {
      const S = FluxHoldemUI.state(), q = (s) => document.querySelector(s), overflow = q("#scr-fh").scrollWidth - innerWidth;
      if (S.settle) {
        const table = q("#fh-game .cc-table").getBoundingClientRect(), tag = q("#fh-board .cc-judge"), r = tag && tag.getBoundingClientRect();
        return { settle: S.settle.phase, overflow, tagOut: !!r && (r.left < Math.max(0, table.left) - 1 || r.right > Math.min(innerWidth, table.right) + 1 || r.top < table.top - 1 || r.bottom > table.bottom + 1) };
      }
      const banner = q("#fh-banner");
      if (!banner.hidden) {
        if (banner.querySelector(".cc-final")) return { done: true, overflow };
        banner.querySelector('[data-fh="dismiss"]').click();
        return { overflow };
      }
      const card = q("#fh-board .cc-me button.cc-can");
      if (card) { card.click(); return { overflow }; }
      const btns = [...document.querySelectorAll("#fh-actions button[data-fh]")].filter(x => !x.disabled && x.dataset.fh !== "amt");
      const pick = ["check", "call", "pass", "allIn", "noLoan", "place"].map(a => btns.find(x => x.dataset.fh === a)).find(Boolean) || btns.find(x => x.classList.contains("primary"));
      if (pick) pick.click();
      return { overflow, wait: !pick };
    });
    if (m.settle) phases.add(m.settle);
    if (m.overflow > 1) bad.push(`横向溢出 ${m.overflow}px（${m.settle || "平时"}）`);
    if (m.tagOut) bad.push("「判定中」跑出牌桌");
    done = !!m.done;
    if (m.settle || m.wait) await page.waitForTimeout(25);
  }
  assert.ok(done, "打完了，有总结算");
  assert.deepEqual(bad, [], "过渡中、平时都没有横向溢出");
  ["last", "show", "judge"].forEach(ph => assert.ok(phases.has(ph), `放过「${ph}」这一步：${[...phases].join("、")}`));
  assert.deepEqual(errors, []);
});

/* ---------- 翻牌的节奏（主人 10/31：翻牌还是太快，一张牌起码展示一秒钟） ---------- */
test("翻牌的节奏（主人 10/31）：结算前的过渡里最后一步停 lastMs、之后每翻开一张 / 亮牌停 flipMs，都不少于 1 秒；判定中也不少于 1 秒", (t) => {
  const T = page().w.CounterCardsUI.UI_CONFIG.settle;
  assert.ok(T.lastMs >= 1000 && T.flipMs >= 1000 && T.judgeMs >= 1000, JSON.stringify(T));
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const p = page(), g = bet2Game(p, "一秒");
  p.UI.start({ game: g, human: "p1", levels: { p2: "easy" }, seed: "一秒" });
  click(p.$('#fh-actions [data-fh="check"]'));
  const st = settleOf(p);
  assert.deepEqual(J(st.beats), ["last", "flip", "show"]);
  t.mock.timers.tick(T.lastMs);
  assert.equal(st.phase, "flip", "翻开第 2 张天气");
  t.mock.timers.tick(999);
  assert.equal(st.phase, "flip", "刚翻开的这张至少停 1 秒");
  t.mock.timers.tick(T.flipMs - 999);
  assert.equal(st.phase, "show");
  t.mock.timers.tick(999);
  assert.equal(st.phase, "show", "亮牌也至少停 1 秒");
});

test("翻牌的节奏（主人 10/31）：牌局里翻开新的天气（第一轮下注打完翻第 1 张天气），AI 至少等 flipMs 才接着下注，不是平时的 aiDelay", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const p = page(), T = p.w.CounterCardsUI.UI_CONFIG.settle, U = p.w.FluxUI.UI_CONFIG;
  assert.ok(T.flipMs > U.aiDelay);
  const g = p.X.newGame({ seed: "翻天气", players: [{ id: "p1", name: "你" }, { id: "p2", name: "乙" }], layers: LAYERS.slice(), weathers: WEATHERS.slice(),
    hands: { p1: ["fire", "ice", "acid"], p2: ["physical", "ice", "energy"] }, elements: [] });
  const A = (id, type, extra) => p.X.act(g, id, Object.assign({ type }, extra || {}));
  A("p1", "place", { where: "top" });
  A("p2", "play", { card: "physical" }); A("p1", "play", { card: "fire" });
  A("p2", "check"); A("p1", "call"); A("p2", "pass");
  p.UI.start({ game: g, human: "p1", levels: { p2: "easy" }, seed: "翻天气" });
  t.mock.timers.tick(U.dealMs);
  click(p.$('#fh-actions [data-fh="pass"]'));
  assert.deepEqual(J(g.weathers), ["heat"], "关窗，翻开第 1 张天气");
  assert.deepEqual(J(p.X.toAct(g)), ["p2"], "第二轮轮到乙（AI）");
  const n = g.log.length;
  t.mock.timers.tick(U.aiDelay);
  assert.equal(g.log.length, n, "平时的 aiDelay 到了也还没走：刚翻开的天气要先看清");
  t.mock.timers.tick(T.flipMs - U.aiDelay);
  assert.ok(g.log.length > n, "停够 flipMs 以后 AI 接着走");
});
