// 克制卡牌（暂名，#485）· 界面 counter-cards-ui.js：标题「本地玩法」里的入口、选边 / 难度、牌桌（牌背、筹码、天气堆、天气特效）、
// 用点按钮的方式以任意一方 × 任意难度和 AI 打完一局、结算只显示胜负 / 分档 / 筹码变动、画面里看不到对方的牌。
// Node 里用 tests/mini-dom.js 跑 game.html 的真页面结构；另有真浏览器测试（没装 Playwright 时跳过）
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
const LEVELS = ["easy", "normal", "hard"];

/** game.html 的 <body> 解析进小 DOM，加载克制卡牌要的脚本（计分要 engine.js）。
 *  页面开着「减少动态效果」：雷鸣的闪电、酸雨的涟漪是一直自己排下一次的定时器，桌上留着这两种天气测试进程就退不出去（天气层照样摆） */
function page() {
  const html = read("game.html"), body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const P = MD.create(body, { media: (q) => /prefers-reduced-motion: reduce/.test(q) });
  const ctx = vm.createContext(P.window);
  ["engine.js", "icons.js", "weather-fx.js", "counter-cards.js", "counter-cards-ai.js", "counter-cards-ui.js"].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const doc = P.document;
  return { w: P.window, doc, $: (s) => doc.querySelector(s), $$: (s) => doc.querySelectorAll(s), UI: P.window.CounterCardsUI, CC: P.window.CounterCards };
}
const click = (el) => { assert.ok(el, "要点的东西不在"); el.click(); };
const visible = (el) => !!el && !el.hidden;

/** 一直点到这一局结束：有结算横幅就点「继续」；轮到自己就点主按钮 / 第一张能点的牌；下注时随机换着点 */
function playThrough(p, rng) {
  let guard = 0;
  while (guard++ < 400) {
    const banner = p.$("#cc-banner");
    if (visible(banner)) {
      if (banner.querySelector(".cc-final")) return;
      click(banner.querySelector('[data-cc="dismiss"]'));
      continue;
    }
    const st = p.UI.state();
    if (st.game.over) { p.UI.render(); continue; }
    const card = p.$("#cc-board button.cc-can");
    if (card) { click(card); continue; }
    const btns = Array.from(p.$$("#cc-actions button[data-cc]")).filter(b => !b.disabled && b.dataset.cc !== "amt");
    assert.ok(btns.length, "没有能点的按钮：" + st.game.stage);
    const bet = btns.filter(b => ["check", "call", "bet", "raise", "fold"].includes(b.dataset.cc));
    const mode = btns.find(b => b.dataset.cc === "mode" && b.dataset.mode);
    let pick;
    if (bet.length) pick = rng() < 0.1 ? bet.find(b => b.dataset.cc === "fold") : bet[Math.floor(rng() * bet.length)];
    else if (mode && rng() < 0.3) pick = mode;
    else pick = btns.find(b => b.classList.contains("primary")) || btns[0];
    click(pick || btns[0]);
  }
  assert.fail("点了 400 下还没打完");
}

test("标题「本地玩法」里有克制卡牌的入口，点进去是设置页（扮演哪一方、对手难度、开局筹码 50）", () => {
  const p = page();
  const entry = p.$("#t-panel-local #t-cc");
  assert.ok(entry, "本地玩法里有入口");
  assert.match(entry.textContent, /克制卡牌/);
  click(entry);
  assert.ok(visible(p.$("#scr-cc")));
  assert.ok(visible(p.$("#cc-setup")));
  assert.ok(!visible(p.$("#cc-game")));
  const setup = p.$("#cc-setup").textContent;
  assert.match(setup, /玩家/); assert.match(setup, /庄家/);
  assert.match(setup, /简单/); assert.match(setup, /普通/); assert.match(setup, /困难/);
  assert.match(setup, /各 50 枚筹码/);
  click(p.$('[data-cc="set"][data-key="side"][data-val="dealer"]'));
  click(p.$('[data-cc="set"][data-key="level"][data-val="hard"]'));
  assert.equal(p.$('[data-cc="set"][data-key="side"][data-val="dealer"]').getAttribute("aria-pressed"), "true");
  click(p.$('[data-cc="start"]'));
  assert.ok(visible(p.$("#cc-game")));
  const st = p.UI.state();
  assert.equal(st.human, "dealer"); assert.equal(st.level, "hard");
  assert.match(p.$("#cc-top").textContent, /你是庄家/);
});

test("牌桌：自己的手牌正面朝上（游戏里的图标和配色），对方的手牌是牌背；发牌动画；筹码堆；天气堆在桌边", () => {
  const p = page();
  p.UI.start({ side: "player", level: "normal", seed: "桌面" });   // 不是 fast：AI 等发牌动画放完才动
  assert.ok(p.UI.state().timer, "AI 等着");
  p.UI.stop();
  const board = p.$("#cc-board");
  const mine = board.querySelectorAll(".cc-me .cc-card");
  assert.equal(mine.length, 8);
  assert.deepEqual(Array.from(mine).map(c => c.dataset.face), ["fire", "acid", "electric", "ice", "energy", "physical", "harmonic", "normal"]);
  assert.ok(mine[0].querySelector("svg.eicon"), "元素牌用游戏里的图标");
  assert.match(mine[0].getAttribute("style"), /var\(--fire\)/, "元素牌用游戏里的属性色");
  assert.ok(Array.from(mine).every(c => c.classList.contains("cc-deal")), "开局有发牌动画");
  const opp = board.querySelectorAll(".cc-opp .cc-card");
  assert.equal(opp.length, 5);
  assert.ok(Array.from(opp).every(c => c.classList.contains("cc-back") && !c.dataset.face), "对方的手牌都是牌背");
  assert.ok(board.querySelector(".cc-deck .cc-deckstack"), "天气堆");
  assert.match(board.querySelector(".cc-deck").textContent, /7/);
  assert.ok(board.querySelector(".cc-pot .cc-chips"), "底池的筹码堆");
  assert.match(board.querySelector(".cc-me .cc-chips").textContent, /49/);   // 下了 1 枚底注
  assert.ok(board.querySelector(".cc-me .cc-chips.cc-anim"), "开局筹码落下来");
  // 再画一次：发牌、筹码动画只放一次
  p.UI.render();
  assert.ok(!p.$("#cc-board .cc-me .cc-card.cc-deal"));
  assert.ok(!p.$("#cc-board .cc-chips.cc-anim"));
  // 庄家这一边：手里是层牌，用层的颜色
  const q = page();
  q.UI.start({ side: "dealer", level: "easy", seed: "桌面2", fast: true });
  const layers = q.$$("#cc-board .cc-me .cc-card");
  assert.deepEqual(Array.from(layers).map(c => c.dataset.face), ["flesh", "armor", "shield", "sand", "spirit"]);
  assert.match(layers[0].getAttribute("style"), /var\(--flesh\)/);
  assert.ok(layers[0].querySelector("svg.eicon"));
});

test("暗出的牌一律显示牌背：对方出的牌在画面里找不到，自己那张只在角上标一下", () => {
  const p = page();
  p.UI.start({ side: "player", level: "hard", seed: "牌背", fast: true });
  // 人是玩家：庄家（AI）先做天气行动、暗出
  const g = p.UI.state().game;
  assert.equal(g.stage, "play");
  assert.ok(g.sides.dealer.card, "AI 已经暗出");
  const dealerCard = g.sides.dealer.card, dealerName = p.CC.cardName(dealerCard);
  click(p.$('#cc-board button.cc-can[data-card="ice"]'));
  const board = p.$("#cc-board");
  const slots = board.querySelectorAll(".cc-slot");
  assert.ok(slots[0].querySelector(".cc-back") && !slots[0].querySelector("[data-face]") && !slots[0].querySelector(".cc-peek"), "对方的牌是牌背");
  assert.ok(slots[1].querySelector(".cc-back"), "自己的也是牌背");
  assert.match(slots[1].querySelector(".cc-peek").textContent, /冰/, "角上标着自己出的");
  assert.ok(!board.querySelector(`[data-face="${dealerCard}"]`));
  assert.ok(!p.$("#cc-actions").textContent.includes(dealerName));
  assert.ok(!p.$("#cc-side .cc-log").textContent.includes(`〔${dealerName}〕`), "记录里没有对方的牌");
});

test("结算横幅只有胜负、分档和筹码变动，不亮牌；点「继续」AI 接着走", () => {
  const p = page();
  p.UI.start({ side: "player", level: "normal", seed: "横幅", fast: true });
  let seen = 0;
  for (let i = 0; i < 400 && seen < 3 && !p.UI.state().game.over; i++) {
    const banner = p.$("#cc-banner");
    if (visible(banner) && banner.querySelector('[data-cc="dismiss"]')) {
      const t = banner.textContent;
      assert.match(t, /你赢了|你输了|平局/);
      assert.match(t, /差 1|差 2|差 3|滚存|退回|拿回|弃牌/);
      assert.match(t, /你 [+-]?\d+ 枚/);
      assert.match(t, /不亮牌/);
      const g = p.UI.state().game;
      const dealt = g.sides.dealer.history.map(h => p.CC.cardName(h.card));
      dealt.forEach(n => assert.ok(!t.includes(n), "横幅里不能有庄家出的牌：" + n));
      g.sides.player.history.forEach(h => assert.ok(!t.includes(p.CC.cardName(h.card)), "也不写自己出的牌"));
      seen++;
      click(banner.querySelector('[data-cc="dismiss"]'));
      continue;
    }
    const card = p.$("#cc-board button.cc-can");
    if (card) { click(card); continue; }
    const btns = Array.from(p.$$("#cc-actions button[data-cc]")).filter(b => !b.disabled && !["amt", "fold", "mode"].includes(b.dataset.cc));
    click(btns.find(b => b.classList.contains("primary")) || btns[0]);
  }
  assert.ok(seen >= 1, "看到了结算横幅");
});

test("AI 平时等一会儿再走（开局等发牌动画放完）；setFast(true) 把正在等的那一步马上走掉", () => {
  const p = page();
  p.UI.start({ side: "player", level: "normal", seed: "等一等" });
  const st = p.UI.state();
  assert.ok(st.timer, "庄家（AI）在等");
  assert.equal(st.game.stage, "dealerWeather");
  p.UI.setFast(true);
  assert.equal(st.timer, null);
  assert.equal(st.game.stage, "play", "庄家的天气行动走完了");
  assert.ok(st.game.sides.dealer.card, "庄家也暗出了");
  assert.ok(p.$("#cc-board .cc-slot .cc-back"), "桌上是牌背");
  // 规则在对局里也能看
  assert.ok(p.$("#cc-side .cc-rules"));
});

for (const side of ["player", "dealer"]) for (const level of LEVELS) {
  test(`点按钮以${side === "player" ? "玩家" : "庄家"}的身份和${level} AI 打完一局：结算正确，最后有总结算`, () => {
    const p = page();
    p.UI.start({ side, level, seed: `整局-${side}-${level}`, fast: true });
    playThrough(p, p.CC.makeRng(side + level));
    const g = p.UI.state().game;
    assert.equal(g.over, true);
    const d = g.sides.dealer, pl = g.sides.player;
    assert.equal(d.chips + pl.chips, 100 + d.loan + pl.loan - d.owe - pl.owe);   // 借来的进了桌上，结束时扣还
    const fin = p.$("#cc-banner .cc-final");
    assert.ok(fin);
    assert.match(fin.textContent, /这一局你(赢|输)了|这一局打平/);
    assert.match(fin.textContent, new RegExp(`你 ${g.sides[side].chips} 枚`));
    assert.match(fin.textContent, /按最终筹码数/);
    // 每一轮的结算都记在侧栏
    assert.equal(p.$$("#cc-side .cc-results .cc-res").length, g.results.length);
    // 再来一局 / 换边
    click(p.$('#cc-banner [data-cc="swap"]'));
    assert.equal(p.UI.state().human, side === "player" ? "dealer" : "player");
    assert.equal(p.UI.state().game.round, 1);
  });
}

test("庄家（人）偷看天气堆顶：只有自己看得到，放回原位 / 牌堆底；玩家（AI）看不到", () => {
  const p = page();
  p.UI.start({ side: "dealer", level: "normal", seed: "偷看", fast: true, gameOpt: { deck: ["glow", "heat", "snow", "acid", "thunder", "sand", "phase"] } });
  click(p.$('#cc-actions [data-cc="weather"][data-op="peek"]'));
  const peek = p.$("#cc-board .cc-peekcard");
  assert.ok(peek, "看到偷看的那张");
  assert.match(peek.textContent, /微光/);
  assert.match(peek.textContent, /只有你看得到/);
  click(p.$('#cc-actions [data-cc="place"][data-where="bottom"]'));
  assert.ok(!p.$("#cc-board .cc-peekcard"));
  assert.match(p.$("#cc-board .cc-deck").textContent, /堆底：微光/, "庄家记得放到牌堆底的是哪张");
  const pv = p.CC.view(p.UI.state().game, "player");
  assert.doesNotMatch(JSON.stringify(pv), /glow|微光/);
});

test("翻开天气：桌上换成那张天气牌、闪一下，放对应的天气特效（weather-fx.js）；没有天气时特效收掉", () => {
  const p = page();
  // 人当玩家，对面的庄家由测试按住不动天气：game 自己开好、庄家那一步先替它做了
  const CC = p.CC;
  const game = CC.newGame({ seed: "特效", deck: ["thunder", "sand", "glow", "heat", "snow", "acid", "phase"] });
  CC.act(game, "dealer", { type: "weather", op: "pass" });
  CC.act(game, "dealer", { type: "play", card: "flesh" });
  p.UI.start({ side: "player", level: "normal", game, fast: true });
  click(p.$('#cc-board button.cc-can[data-card="ice"]'));
  if (game.stage === "bet1") click(p.$('#cc-actions [data-cc="check"]'));
  while (game.stage === "bet1") click(p.$('#cc-actions [data-cc="call"]') || p.$('#cc-actions [data-cc="check"]'));
  assert.equal(game.stage, "weather");
  click(p.$('#cc-actions [data-cc="reveal"]'));
  assert.equal(game.weather, "thunder");
  assert.ok(p.$("#cc-board .cc-flash"), "翻开时闪一下");
  assert.ok(p.$("#cc-board .cc-wnow .cc-flip"), "翻牌动画");
  assert.match(p.$("#cc-board .cc-wnow").textContent, /雷鸣/);
  assert.match(p.$("#cc-board .cc-wnow").textContent, /电 \+1/);
  assert.ok(p.$("#cc-fx .wfx.wfx-thunder"), "雷鸣的天气特效");
  assert.equal(p.$("#cc-game").dataset.weather, "thunder");
  p.UI.render();
  assert.ok(!p.$("#cc-board .cc-flash"), "只闪一次");
  assert.ok(p.$("#cc-fx .wfx.wfx-thunder"), "特效留着");
  game.weather = null;
  p.UI.render();
  assert.ok(!p.$("#cc-fx .wfx"), "没有天气时特效收掉");
  // 天气牌上写着修正
  assert.match(p.UI.weatherCardHtml("acid"), /酸 \+1[\s\S]*电 \+1[\s\S]*酸、冰以外打装甲 \+1/);
  assert.match(p.UI.weatherCardHtml("glow"), /能量 \+1[\s\S]*能量以外克制反转/);
  assert.match(p.UI.weatherCardHtml("phase"), /翻到时双方全押/);
});

test("下注栏：最低额 = 轮数、加减按钮不越界；常态不能点出；不能弃的牌点不了", () => {
  const p = page();
  p.UI.start({ side: "player", level: "normal", seed: "下注栏", fast: true });
  assert.ok(p.$('#cc-board .cc-me .cc-card[data-face="normal"]'));
  assert.ok(!p.$('#cc-board button.cc-can[data-card="normal"]'), "常态不能当出牌");
  click(p.$('#cc-board button.cc-can[data-card="fire"]'));
  const g = p.UI.state().game;
  if (g.stage !== "bet1" || CCturn(p) !== "player") return;
  const amt = () => Number(p.$("#cc-actions .cc-amt").textContent);
  assert.equal(amt(), 1);
  assert.ok(p.$('#cc-actions [data-cc="amt"][data-d="-1"]').disabled);
  click(p.$('#cc-actions [data-cc="amt"][data-d="1"]'));
  assert.equal(amt(), 2);
  click(p.$('#cc-actions [data-cc="amt"][data-set="max"]'));
  assert.equal(amt(), 49);
  assert.ok(p.$('#cc-actions [data-cc="amt"][data-d="1"]').disabled);
  assert.match(p.$("#cc-actions .cc-info").textContent, /本轮最低下注 1 枚/);
});
function CCturn(p) { const t = p.CC.toAct(p.UI.state().game); return t.length === 1 ? t[0] : t.join(","); }

test("设置页：普通难度写「只看单轮结果」（以前是「看上一轮」）；开局说明和规则里写了借贷、按最终筹码数定胜负", () => {
  const p = page();
  click(p.$("#t-cc"));
  const normal = p.$('[data-cc="set"][data-key="level"][data-val="normal"]');
  assert.match(normal.textContent, /只看单轮结果/);
  assert.ok(!p.$("#cc-setup").textContent.includes("看上一轮"));
  const setup = p.$("#cc-setup").textContent;
  assert.match(setup, /筹码不够时可以向主持方借（每借 3 枚，结束时还 4 枚）/);
  assert.match(setup, /借贷：筹码不够时可以向主持方借/);
  assert.match(setup, /3→4、6→8/);
  assert.match(setup, /按最终筹码数（扣还借款之后）比/);
});

test("牌背只有花纹、不写字：庄家的手牌叠在一起、每张只露出左边一截时，也不会被遮成别的字（以前的「AB」露出来像「AI」）", () => {
  const p = page();
  const box = p.doc.createElement("div");
  box.innerHTML = p.UI.backHtml();
  assert.ok(box.querySelector(".cc-back svg.cc-emblem"), "牌背是花纹");
  assert.equal(box.textContent.trim(), "", "牌背上没有字");
  // 人当玩家：对面庄家的 5 张手牌叠着放，全是没有字的牌背
  p.UI.start({ side: "player", level: "normal", seed: "牌背花纹", fast: true });
  const backs = Array.from(p.$$("#cc-board .cc-opp .cc-hand-back .cc-card"));
  assert.ok(backs.length >= 4);
  backs.forEach(b => { assert.ok(b.querySelector("svg.cc-emblem")); assert.equal(b.textContent.trim(), ""); });
  // 桌上庄家暗出的那张也一样；自己暗出的那张只有角上标的字
  const slot = p.$("#cc-board .cc-slot .cc-back");
  assert.ok(slot && slot.querySelector("svg.cc-emblem"));
  assert.equal(slot.textContent.trim(), "");
  const css = read("counter-cards.css");
  assert.ok(!/\.cc-crest\s*\{[^}]*font:/.test(css), "牌背不再用字");
});

test("借贷（每轮开始）：人手上不够时操作栏问借不借，按钮写着借多少、还多少；借了以后两边座位上都写着；AI 接着走", () => {
  const p = page();
  p.UI.start({ side: "player", level: "normal", seed: "人借", fast: true, gameOpt: { playerChips: 1 } });
  const g = p.UI.state().game;
  assert.equal(g.stage, "loan");
  const bar = p.$("#cc-actions");
  assert.match(bar.textContent, /你手上只有 1 枚筹码，不够这一轮的底注 1 \+ 最低下注 1 枚/);
  assert.match(bar.textContent, /每借 3 枚，对局结束时还 4 枚/);
  const borrow = bar.querySelector('[data-cc="borrow"][data-amount="3"]');
  assert.ok(borrow); assert.match(borrow.textContent, /借 3 枚（还 4）/);
  assert.ok(!bar.querySelector('[data-cc="borrow"][data-amount="6"]'), "只缺 1 枚：最多借 3 枚");
  assert.match(bar.querySelector('[data-cc="noLoan"]').textContent, /^不借$/);
  click(borrow);
  assert.equal(g.sides.player.loan, 3); assert.equal(g.sides.player.owe, 4);
  assert.equal(g.stage, "play", "借完下底注，庄家（AI）走完天气行动、暗出");
  assert.match(p.$("#cc-board .cc-me .cc-who").textContent, /借 3 枚 · 结束时还 4 枚/);
  assert.match(p.$("#cc-board .cc-me .cc-chips").textContent, /3/);   // 1 + 3 − 底注 1
  assert.ok(p.$("#cc-side .cc-log").textContent.includes("玩家向主持方借了 3 枚筹码（对局结束时还 4 枚）。"));
  // 庄家那边看：座位上写着对方借了多少
  const q = page();
  q.UI.start({ side: "dealer", level: "normal", seed: "人借", fast: true, game: g });
  assert.match(q.$("#cc-board .cc-opp .cc-who").textContent, /借 3 枚 · 结束时还 4 枚/);
});

test("借贷（每轮开始）：人输光了——按钮写「不借（结束对局）」，点了对局结束，总结算按最终筹码数", () => {
  const p = page();
  p.UI.start({ side: "player", level: "normal", seed: "人输光", fast: true, gameOpt: { dealerChips: 1, playerChips: 0 } });
  const bar = p.$("#cc-actions");
  assert.match(bar.textContent, /你已经输光了，不借的话这一局就结束/);
  assert.ok(bar.querySelector('[data-cc="borrow"][data-amount="3"]').classList.contains("primary"));
  const no = bar.querySelector('[data-cc="noLoan"]');
  assert.match(no.textContent, /不借（结束对局）/);
  click(no);
  const fin = p.$("#cc-banner .cc-final");
  assert.ok(fin);
  assert.match(fin.textContent, /这一局你输了/);
  assert.match(fin.textContent, /你 0 枚/); assert.match(fin.textContent, /庄家 1 枚/);
  assert.match(fin.textContent, /按最终筹码数（扣还借款之后）比/);
  assert.match(fin.textContent, /打了 0 轮/);
});

test("借贷（下注时）：轮到人下注、筹码不够时下注栏里有借的按钮，借完还是人下注，按钮就没了", () => {
  const p = page();
  const CC = p.CC, A = (g, side, type, extra) => CC.act(g, side, Object.assign({ type }, extra || {}));
  const g = CC.newGame({ seed: "下注栏借", deck: ["thunder", "sand", "glow", "heat", "snow", "acid", "phase"], playerChips: 8 });
  A(g, "dealer", "weather", { op: "pass" });
  A(g, "dealer", "play", { card: "flesh" }); A(g, "player", "play", { card: "ice" });
  A(g, "player", "bet", { amount: 4 }); A(g, "dealer", "call");
  A(g, "player", "reveal"); A(g, "player", "noNormal");
  A(g, "dealer", "check"); A(g, "player", "check");
  A(g, "dealer", "weather", { op: "keep" });
  A(g, "dealer", "play", { card: "sand" }); A(g, "player", "play", { card: "energy" });
  A(g, "player", "check"); A(g, "dealer", "bet", { amount: 2 });
  p.UI.start({ side: "player", level: "normal", game: g, fast: true });
  const bar = () => p.$("#cc-actions");
  assert.match(bar().textContent, /手上的筹码不够（这一步要 4 枚，你只有 2 枚），可以先向主持方借/);
  assert.ok(bar().querySelector('[data-cc="call"]'));
  click(bar().querySelector('[data-cc="borrow"][data-amount="3"]'));
  assert.equal(g.sides.player.chips, 5);
  assert.equal(CC.toAct(g).join(), "player");
  assert.ok(!bar().querySelector('[data-cc="borrow"]'), "够了就没有借的按钮");
  assert.ok(bar().querySelector('[data-cc="raise"]'), "借完能加注了");
});

test("总结算：庄家借过筹码——写清楚扣还了多少，胜负按扣还之后的筹码数", () => {
  const p = page();
  const CC = p.CC;
  // 人当庄家：玩家（普通 AI）输光先借 3 枚；庄家（人）只差一点，也借 3 枚
  p.UI.start({ side: "dealer", level: "normal", seed: "结算借", fast: true, gameOpt: { dealerChips: 1, playerChips: 0 } });
  const g = p.UI.state().game;
  assert.equal(g.sides.player.loan, 3, "AI 输光了会借");
  click(p.$('#cc-actions [data-cc="borrow"][data-amount="3"]'));
  assert.equal(g.sides.dealer.loan, 3);
  playThrough(p, CC.makeRng("结算借"));
  const f = g.final, fin = p.$("#cc-banner .cc-final").textContent;
  assert.match(fin, new RegExp(`你 ${f.chips.dealer} 枚`));
  assert.match(fin, new RegExp(`玩家 ${f.chips.player} 枚`));
  assert.match(fin, new RegExp(`已扣还借款：你借 ${f.loans.dealer.loan} 枚、还 ${f.loans.dealer.owe} 枚，玩家借 ${f.loans.player.loan} 枚、还 ${f.loans.player.owe} 枚`));
  const want = f.chips.dealer > f.chips.player ? /这一局你赢了/ : f.chips.dealer < f.chips.player ? /这一局你输了/ : /这一局打平/;
  assert.match(fin, want);
});

/* ---------- 真浏览器（没装 Playwright 时跳过） ---------- */
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
let browser = null, skipWhy = pw ? "" : "没装 Playwright，跳过画面测试";
test.before(async () => {
  if (!pw) { if (process.env.REQUIRE_UI === "1") throw new Error("UI 验收需要 Playwright"); return; }
  try { browser = await pw.chromium.launch(); } catch (e) {
    if (process.env.REQUIRE_UI === "1") throw e;
    skipWhy = "浏览器启动失败，跳过画面测试：" + e.message.split("\n")[0];
  }
});
test.after(async () => { if (browser) await browser.close(); });

for (const vp of [{ width: 1400, height: 900, tag: "桌面" }, { width: 390, height: 844, tag: "手机 390px" }]) {
  test(`真浏览器（${vp.tag}）：标题 → 本地玩法 → 克制卡牌，和 AI 打完一局，没有报错、没有横向溢出`, async (t) => {
    if (!browser) { t.skip(skipWhy); return; }
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(GAME_URL);
    await page.click("#t-local");
    await page.click("#t-cc");
    await page.waitForSelector("#cc-setup:not([hidden])");
    await page.click('[data-cc="set"][data-key="level"][data-val="hard"]');
    await page.click('[data-cc="start"]');
    await page.waitForSelector("#cc-game:not([hidden])");
    await page.evaluate(() => CounterCardsUI.setFast(true));
    for (let i = 0; i < 300; i++) {
      const done = await page.evaluate(() => {
        const banner = document.getElementById("cc-banner");
        if (!banner.hidden) {
          if (banner.querySelector(".cc-final")) return true;
          banner.querySelector('[data-cc="dismiss"]').click(); return false;
        }
        const st = CounterCardsUI.state();
        if (CounterCards.toAct(st.game).indexOf(st.ai) >= 0) { CounterCardsUI.setFast(true); return false; }
        const card = document.querySelector("#cc-board button.cc-can");
        if (card) { card.click(); return false; }
        const btns = [...document.querySelectorAll("#cc-actions button[data-cc]")].filter(b => !b.disabled && !["amt", "fold", "mode"].includes(b.dataset.cc));
        (btns.find(b => b.classList.contains("primary")) || btns[0]).click();
        return false;
      });
      if (done) break;
    }
    assert.ok(await page.$("#cc-banner .cc-final"), "打完了");
    const overflow = await page.evaluate(() => document.getElementById("scr-cc").scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, "横向溢出 " + overflow + "px");
    assert.deepEqual(errors, []);
    await context.close();
  });
}
