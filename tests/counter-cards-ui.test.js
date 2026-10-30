// High Flux（#485）· 界面 counter-cards-ui.js：标题「本地玩法」里的入口、游戏名、选边 / 难度、牌桌（牌背、筹码、天气堆、天气特效）、
// 用点按钮的方式以任意一方 × 任意难度和 AI 打完一局、结算只显示胜负 / 分档 / 筹码变动、画面里看不到对方的牌；
// 牌局中随时打开完整的克制表（顶栏「菜单」→「克制表」、Esc、侧栏 / 结算横幅的按钮；格子是得分，不动牌局）；
// 手里的元素牌悬停（手机长按）弹出得分预览（打五种层各得几分，和克制表同一份数；天气变了跟着变；不透露庄家的牌；不挡出牌）；
// 下注不封顶时跟不起的下注栏、跟注后追加窗口的倒计时（#496）；
// 结算前的过渡（最后一步 → 判定中 → 结算横幅，点一下桌面跳过；追加窗口关上之后才开始）、侧栏的记录按时间顺序（#499）。
// Node 里用 tests/mini-dom.js 跑 game.html 的真页面结构；另有真浏览器测试（打完一局的 2 条没装 Playwright 时跳过；
// 克制表、悬停预览、追加窗口、结算前的过渡的各 2 条没装 Playwright 时用机器自带的 Chrome（tests/cdp-browser.js），都没有才跳过）
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

/** game.html 的 <body> 解析进小 DOM，加载 High Flux 要的脚本（计分要 engine.js；暂停菜单、克制表浮层照 game.html 的先后加载）。
 *  页面开着「减少动态效果」：雷鸣的闪电、酸雨的涟漪是一直自己排下一次的定时器，桌上留着这两种天气测试进程就退不出去（天气层照样摆） */
function page() {
  const html = read("game.html"), body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const P = MD.create(body, { media: (q) => /prefers-reduced-motion: reduce/.test(q) });
  const ctx = vm.createContext(P.window);
  ["engine.js", "icons.js", "weather-fx.js", "pause-menu.js", "matchup-ui.js", "counter-cards.js", "counter-cards-ai.js", "counter-cards-ui.js"].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const doc = P.document;
  return { w: P.window, doc, $: (s) => doc.querySelector(s), $$: (s) => doc.querySelectorAll(s), UI: P.window.CounterCardsUI, CC: P.window.CounterCards };
}
const click = (el) => { assert.ok(el, "要点的东西不在"); el.click(); };
const visible = (el) => !!el && !el.hidden;
/** 下注时一直点「过牌」/「跟注」/ 跟注后追加窗口（#496）里的「不加注」，直到这个下注回合结束（最多点 10 下） */
function betThrough(p, game, stage) {
  for (let i = 0; i < 10 && game.stage === stage; i++) click(p.$('#cc-actions [data-cc="check"]') || p.$('#cc-actions [data-cc="call"]') || p.$('#cc-actions [data-cc="pass"]'));
}
/** 规则层直接跟注后开了追加窗口：双方都放弃追加 */
const passWindow = (CC, g) => { if (g.betting && g.betting.window) CC.toAct(g).forEach(s => CC.act(g, s, { type: "pass" })); };

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
    const bet = btns.filter(b => ["check", "call", "bet", "raise", "fold", "pass"].includes(b.dataset.cc));
    const mode = btns.find(b => b.dataset.cc === "mode" && b.dataset.mode);
    let pick;
    if (bet.length) pick = rng() < 0.1 ? bet.find(b => b.dataset.cc === "fold") : bet[Math.floor(rng() * bet.length)];
    else if (mode && rng() < 0.3) pick = mode;
    else pick = btns.find(b => b.classList.contains("primary")) || btns[0];
    click(pick || btns[0]);
  }
  assert.fail("点了 400 下还没打完");
}

test("标题「本地玩法」里有 High Flux 的入口，点进去是设置页（扮演哪一方、对手难度、开局筹码 50）", () => {
  const p = page();
  const entry = p.$("#t-panel-local #t-cc");
  assert.ok(entry, "本地玩法里有入口");
  assert.match(entry.textContent, /High Flux/);
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

test("游戏名是 High Flux（作者 10/29 定名，以前暂名「克制卡牌」）：本地玩法的按钮、设置页标题、牌桌标题、规则说明都写 High Flux，界面上不再出现旧名", () => {
  const p = page();
  const OLD = "克制卡牌";
  assert.equal(p.CC.CC_CONFIG.name, "High Flux");
  const entry = p.$("#t-panel-local #t-cc");
  assert.equal(entry.querySelector("b").textContent, "High Flux", "本地玩法的按钮");
  assert.ok(!p.$("#t-panel-local").textContent.includes(OLD));
  click(entry);
  assert.equal(p.$("#cc-setup .cc-title").textContent, "High Flux", "设置页标题");
  assert.equal(p.$("#cc-setup .cc-rules summary").textContent, "High Flux 规则", "设置页的规则说明");
  assert.ok(!p.$("#scr-cc").textContent.includes(OLD));
  click(p.$('[data-cc="start"]'));
  p.UI.stop();   // 人当玩家：庄家（AI）在等发牌动画，这里不用它走
  assert.equal(p.$("#cc-top .cc-brand").textContent, "High Flux", "牌桌标题");
  assert.equal(p.$("#cc-side .cc-rules summary").textContent, "High Flux 规则", "对局中侧栏的规则说明");
  assert.ok(!p.$("#scr-cc").textContent.includes(OLD));
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
      assert.match(t, /差 1|差 2|滚存|退回|拿回|弃牌/);
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

/** 小 DOM 不排版：给侧栏的记录列表一个假的高度（每条 30px、框高 100px），量滚动位置照浏览器的样子来；元素的类是所有页面共用的，用完一定要 stop() */
function fakeLogBox(p) {
  const proto = p.w.Element.prototype, log = (el) => el.classList.contains("cc-log");
  const fake = { scrollHeight() { return log(this) ? this.children.length * 30 : 0; }, clientHeight() { return log(this) ? 100 : 0; } };
  const saved = {};
  Object.keys(fake).forEach(k => { saved[k] = Object.getOwnPropertyDescriptor(proto, k); Object.defineProperty(proto, k, { get: fake[k], configurable: true }); });
  return { stop: () => Object.keys(saved).forEach(k => Object.defineProperty(proto, k, saved[k])) };
}

test("侧栏的记录（主人 10/30 试玩反馈，#499）：按时间顺序排，最新的一条在最下面（和战斗记录一样）；有新记录时滚到底，玩家往上翻着看旧的就停在原处；每轮结算第 1 轮在上面", (t) => {
  const p = page();
  const box = fakeLogBox(p);
  t.after(box.stop);
  const N = p.UI.UI_CONFIG.logLines;
  const list = () => p.$("#cc-side .cc-log");
  const texts = () => Array.from(list().querySelectorAll("li")).map(li => li.textContent);
  const want = () => Array.from(p.UI.view().log.slice(-N), e => e.text);   // 页面里的数组先转成这边的
  const atBottom = () => list().scrollHeight - list().scrollTop - list().clientHeight <= 0;
  p.UI.start({ side: "player", level: "normal", seed: "记录顺序", fast: true });   // 庄家（AI）走完天气行动、暗出
  assert.deepEqual(texts(), want(), "按时间顺序：先发生的在上面");
  assert.match(texts()[0], /^第 1 轮：双方各下 1 枚底注/, "最早的一条在最上面");
  assert.equal(texts()[texts().length - 1], "庄家暗出了一张牌。", "最新的一条在最下面");
  assert.ok(atBottom(), "一开始就贴底");
  // 人出牌：新记录接在最下面，滚到底
  click(p.$('#cc-board button.cc-can[data-card="fire"]'));
  assert.deepEqual(texts(), want());
  assert.equal(texts()[texts().length - 1], "你暗出了〔火〕。", "新记录在最下面");
  assert.ok(list().lastElementChild.classList.contains("cc-private"), "只给自己看的照旧标出来");
  assert.ok(list().scrollHeight > list().clientHeight + 24, "记录多到要滚动了：" + texts().length + " 条");
  assert.ok(atBottom(), "有新记录：滚到底");
  // 玩家往上翻着看旧的：重画、来了新记录都停在原处，不强行拉回去
  list().scrollTop = 20;
  p.UI.render();
  assert.equal(list().scrollTop, 20, "重画：停在原处");
  const before = p.UI.view().log.length;
  click(p.$('#cc-actions [data-cc="check"]'));   // 人过牌，庄家（AI）接着下注 / 过牌
  assert.ok(p.UI.view().log.length > before, "来了新记录");
  assert.deepEqual(texts(), want());
  assert.equal(list().scrollTop, 20, "往上翻着：不拉回最底下");
  // 翻回最底下：再来新记录就接着贴底
  list().scrollTop = list().scrollHeight - list().clientHeight;
  for (let i = 0; i < 10 && p.UI.state().game.stage === "bet1"; i++) click(p.$('#cc-actions [data-cc="check"]') || p.$('#cc-actions [data-cc="call"]'));
  assert.deepEqual(texts(), want());
  assert.ok(atBottom(), "在底部：新记录来了接着贴底");
  assert.ok(texts().length <= N, `最多显示最近 ${N} 条`);
  // 打完一局：每轮结算第 1 轮在上面；记录照旧按时间顺序、最后一条是对局结束
  playThrough(p, p.CC.makeRng("记录顺序"));
  const rounds = Array.from(p.$$("#cc-side .cc-results .cc-res > b")).map(b => b.textContent);
  assert.deepEqual(rounds, Array.from(p.UI.state().game.results, r => `第 ${r.r} 轮`), "每轮结算：第 1 轮在上面");
  assert.equal(rounds[0], "第 1 轮");
  assert.deepEqual(texts(), want());
  assert.match(texts()[texts().length - 1], /^对局结束/, "最后一条是对局结束");
  assert.ok(atBottom());
  assert.match(read("counter-cards.css"), /\.cc-log\s*\{[^}]*overflow-y:\s*auto/, "记录自己带滚动条");
});

/* ---------- 结算前的过渡（主人 10/30 试玩反馈，#499）：最后一步 → 判定中 → 结算横幅；用假时钟（t.mock.timers）一段段往前拨 ---------- */
/** 人当玩家，测试替两边走到第二轮下注、轮到人：庄家不动天气、暗出血肉，玩家暗出 card；第一轮都过牌，翻开天气堆顶（deck[0]），不用常态；
 *  庄家先过牌（open：庄家先下注这么多枚，轮到人跟注） */
function bet2Game(p, seed, card, deck, open) {
  const g = p.CC.newGame({ seed, deck: deck || ["heat", "glow", "acid", "thunder", "snow", "sand", "phase"] });
  const A = (side, type, extra) => p.CC.act(g, side, Object.assign({ type }, extra || {}));
  A("dealer", "weather", { op: "pass" }); A("dealer", "play", { card: "flesh" }); A("player", "play", { card });
  A("player", "check"); A("dealer", "check");
  A("player", "reveal"); if (g.stage === "normal") A("player", "noNormal");
  if (open) A("dealer", "bet", { amount: open }); else A("dealer", "check");
  return g;
}
/** 庄家（AI）第二轮下注时照 type 走（跟注 / 过牌……），跟注后的追加窗口（#496）里不追加；别的时候照常 */
function aiBet2(p, type) {
  const step = p.w.CounterCardsAI.step;
  p.w.CounterCardsAI.step = (game, side, level, rng) => (game.stage !== "bet2" ? step(game, side, level, rng)
    : !!p.CC.act(game, side, { type: game.betting.window ? "pass" : type }));
}
/** 桌上某一摞筹码写着几枚（seat：.cc-me / .cc-opp / .cc-pot） */
const chipsOn = (p, seat) => Number(p.$(`#cc-board ${seat} .cc-chips > b`).textContent);

test("结算前的过渡（主人 10/30 试玩反馈，#499）：人走了最后一步（过牌），横幅不马上出来——先停在最后一步，再「判定中」，按 UI_CONFIG.settle 的时长依次过去才弹结算横幅；过渡中桌上停在结算之前、不亮牌，记录和每轮结算里还没有这一轮的结果", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const p = page();   // 页面开着「减少动态效果」：判定中停 reducedJudgeMs
  const T = p.UI.UI_CONFIG.settle;
  assert.ok(T && T.lastMs > 0 && T.judgeMs > 0 && T.reducedJudgeMs > 0 && T.reducedJudgeMs <= T.judgeMs, "时长放在 UI_CONFIG.settle");
  const g = bet2Game(p, "过渡", "fire");   // 酷暑里火打血肉 +2：玩家赢
  p.UI.start({ side: "player", level: "normal", game: g });   // 不是 fast
  const banner = p.$("#cc-banner"), bar = () => p.$("#cc-actions"), board = () => p.$("#cc-board");
  const before = { me: chipsOn(p, ".cc-me"), pot: chipsOn(p, ".cc-pot") };
  click(bar().querySelector('[data-cc="check"]'));
  assert.equal(g.results.length, 1, "规则层已经结算完");
  assert.equal(g.round, 2, "也开了下一轮");
  const st = p.UI.state();
  // ① 最后一步
  assert.ok(!visible(banner), "横幅不马上出来");
  assert.equal(st.settle.phase, "last");
  assert.equal(bar().querySelector(".cc-prompt").textContent, "你过牌。", "操作栏写最后一步做了什么");
  assert.deepEqual(Array.from(bar().querySelectorAll("button[data-cc]"), b => b.dataset.cc), ["skipSettle"], "过渡中只有「直接看结算」");
  assert.equal(board().querySelector(".cc-me .cc-acted").textContent, "过牌", "座位上标着刚走的这一步");
  assert.ok(!board().querySelector(".cc-opp .cc-acted"));
  assert.ok(!board().querySelector("button.cc-can"), "过渡中点不了出牌");
  assert.match(p.$("#cc-top .cc-round").textContent, /第 1 \/ 5 轮/, "顶栏还是这一轮");
  const slots = board().querySelectorAll(".cc-slot");
  assert.ok(slots[0].querySelector(".cc-back") && slots[1].querySelector(".cc-back"), "桌上两张暗牌（牌背）");
  assert.match(slots[1].querySelector(".cc-peek").textContent, /火/, "自己那张照旧在角上标一下");
  assert.ok(!board().querySelector('[data-face="flesh"]') && !bar().textContent.includes("血肉"), "不亮牌");
  assert.deepEqual([chipsOn(p, ".cc-me"), chipsOn(p, ".cc-pot")], [before.me, before.pot], "过牌：筹码不动，底池还是结算之前的");
  assert.match(board().querySelector(".cc-wnow").textContent, /酷暑/, "场上天气");
  assert.equal(p.$$("#cc-side .cc-results .cc-res").length, 0, "每轮结算里还没有这一轮");
  assert.ok(!p.$("#cc-side .cc-log").textContent.includes("第 1 轮：玩家赢"), "记录里还没有这一轮的结果");
  assert.equal(p.$("#cc-side .cc-log").lastElementChild.textContent, "玩家过牌。", "记录停在最后一步");
  t.mock.timers.tick(T.lastMs - 1);
  assert.equal(st.settle.phase, "last", "最后一步停 lastMs");
  t.mock.timers.tick(1);
  // ② 判定中
  assert.equal(st.settle.phase, "judge");
  assert.ok(!visible(banner));
  assert.match(bar().querySelector(".cc-prompt").textContent, /^判定中/);
  assert.match(bar().textContent, /你过牌。/, "最后一步还写着");
  assert.ok(board().querySelector(".cc-slots.cc-judging .cc-back") && board().querySelector(".cc-pot.cc-judging"), "两张牌背轻轻抖、底池发光");
  assert.match(board().querySelector(".cc-judge").textContent, /判定中/);
  assert.ok(!board().querySelector('[data-face="flesh"]'), "判定中也不亮牌");
  t.mock.timers.tick(T.reducedJudgeMs - 1);
  assert.ok(!visible(banner), "开着减少动态效果：判定中停 reducedJudgeMs");
  t.mock.timers.tick(1);
  // ③ 结算横幅
  assert.ok(visible(banner) && banner.querySelector('[data-cc="dismiss"]'), "最后才弹出结算横幅");
  assert.equal(st.settle, null);
  assert.match(banner.textContent, /你赢了/);
  assert.ok(board().querySelector(".cc-me .cc-chips.cc-collect") && !board().querySelector(".cc-opp .cc-chips.cc-collect"), "赢家那边的筹码堆收进来");
  assert.equal(p.$$("#cc-side .cc-results .cc-res").length, 1);
  assert.ok(p.$("#cc-side .cc-log").textContent.includes("第 1 轮：玩家赢"));
  click(banner.querySelector('[data-cc="dismiss"]'));
  assert.ok(st.timer, "点「继续」：庄家（AI）接着走");
  // 减少动态效果：过渡里的动画都去掉（最后一步的文字照样停，上面查过）
  const motion = read("counter-cards.css").match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)[1];
  [".cc-who .cc-acted", ".cc-slots.cc-judging .cc-back", ".cc-pot.cc-judging .cc-potstack", ".cc-chips.cc-collect b"].forEach(s => assert.ok(motion.includes(s), "减少动态效果：" + s + " 不动"));
});

test("结算前的过渡：AI 走的最后一步（庄家跟注）也停一下；跟注后的追加窗口（#496）倒计时期间不进过渡，到时间关窗之后才开始——操作栏从这一下跟注写起「庄家跟注 1 枚。 追加窗口到时间了，没人加注。」，标在庄家的座位上；没开减少动态效果时判定中停 judgeMs；过渡中、横幅开着 AI 都不接着走", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const p = page();
  p.w.matchMedia = () => ({ matches: false });   // 没开「减少动态效果」
  const T = p.UI.UI_CONFIG.settle, U = p.UI.UI_CONFIG, sec = p.CC.CC_CONFIG.callWindowSec;
  const g = bet2Game(p, "AI跟注", "fire");
  aiBet2(p, "call");   // 庄家（AI）这一步一定跟注，窗口里不追加
  p.UI.start({ side: "player", level: "normal", game: g });
  click(p.$('#cc-actions [data-cc="bet"]'));   // 人下注 1 枚（最低）
  const before = { opp: chipsOn(p, ".cc-opp"), pot: chipsOn(p, ".cc-pot") };
  assert.match(p.$("#cc-actions").textContent, /庄家正在想/);
  t.mock.timers.tick(U.dealMs);   // 开局 AI 等发牌动画放完才走
  // 庄家跟注：筹码推进底池，开了追加窗口——倒计时期间不进过渡
  const st = p.UI.state();
  assert.ok(g.betting && g.betting.window, "庄家跟注，开了追加窗口");
  assert.deepEqual([chipsOn(p, ".cc-opp"), chipsOn(p, ".cc-pot")], [before.opp - 1, before.pot + 1], "跟注的筹码推进底池");
  assert.ok(p.$("#cc-board .cc-opp .cc-chips.cc-anim") && p.$("#cc-board .cc-pot .cc-chips.cc-anim"), "筹码推进底池的动画");
  t.mock.timers.tick(U.aiDelay);
  assert.equal(g.betting.window.passed.dealer, true, "庄家（AI）在窗口里马上决定：不追加");
  t.mock.timers.tick(sec * 1000 - U.aiDelay - 1);
  assert.ok(g.betting && g.betting.window && g.results.length === 0, "人还有倒计时");
  assert.equal(st.settle, null, "倒计时期间不进过渡");
  assert.ok(!visible(p.$("#cc-banner")));
  assert.ok(p.$("#cc-actions .cc-count") && p.$('#cc-actions [data-cc="pass"]'), "操作栏照旧是倒计时和「不加注」");
  t.mock.timers.tick(1);
  // 到时间关窗、结算：过渡从这里才开始
  assert.equal(g.results.length, 1, "到时间关窗，结算了");
  assert.equal(st.settle.phase, "last");
  assert.ok(!visible(p.$("#cc-banner")));
  assert.equal(p.$("#cc-actions .cc-prompt").textContent, "庄家跟注 1 枚。 追加窗口到时间了，没人加注。", "最后一步从开窗的那一下跟注写起");
  assert.equal(p.$("#cc-board .cc-opp .cc-acted").textContent, "跟注 1 枚", "桌上：标在庄家的座位上");
  assert.ok(!p.$("#cc-board .cc-me .cc-acted"));
  assert.deepEqual([chipsOn(p, ".cc-opp"), chipsOn(p, ".cc-pot")], [before.opp - 1, before.pot + 1], "桌上停在结算之前");
  assert.ok(!p.$("#cc-actions .cc-count") && st.win === null, "倒计时收起");
  const before2 = JSON.stringify(g);
  t.mock.timers.tick(T.lastMs);
  assert.equal(st.settle.phase, "judge");
  t.mock.timers.tick(T.judgeMs - 1);
  assert.ok(!visible(p.$("#cc-banner")), "没开减少动态效果：判定中停 judgeMs");
  t.mock.timers.tick(1);
  assert.ok(visible(p.$("#cc-banner")));
  t.mock.timers.tick(5000);
  assert.equal(JSON.stringify(g), before2, "过渡中、横幅开着 AI 都不接着走");
  click(p.$('#cc-banner [data-cc="dismiss"]'));
  t.mock.timers.tick(U.aiDelay);
  assert.notEqual(JSON.stringify(g), before2, "点「继续」以后 AI 接着走");
});

test("结算前的过渡：人跟注、在追加窗口（#496）里点「不加注」——双方都不追加、窗口关上才开始过渡（人先点、AI 后表态，或者反过来都一样）；操作栏写「你跟注 2 枚。 双方都不追加，追加窗口关闭。」，座位上标「跟注 2 枚」", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const T = page().UI.UI_CONFIG.settle, U = page().UI.UI_CONFIG;
  const open = (seed) => {
    const p = page(), g = bet2Game(p, seed, "fire", null, 2);   // 庄家先下注 2 枚，轮到人跟注
    aiBet2(p, "call");
    p.UI.start({ side: "player", level: "normal", game: g });   // 不是 fast：AI 等 dealMs 才在窗口里表态
    click(p.$('#cc-actions [data-cc="call"]'));
    assert.ok(g.betting && g.betting.window, "人跟注，开了追加窗口");
    return { p, g, st: p.UI.state() };
  };
  const check = ({ p, g, st }, why) => {
    assert.equal(g.results.length, 1, why + "：窗口关了，结算了");
    assert.equal(st.settle.phase, "last", why);
    assert.equal(p.$("#cc-actions .cc-prompt").textContent, "你跟注 2 枚。 双方都不追加，追加窗口关闭。", why + "：最后一步从开窗的那一下跟注写起");
    assert.equal(p.$("#cc-board .cc-me .cc-acted").textContent, "跟注 2 枚", why + "：标在自己的座位上");
    assert.deepEqual(Array.from(p.$$("#cc-actions button[data-cc]"), b => b.dataset.cc), ["skipSettle"], why + "：只有「直接看结算」");
    assert.ok(!p.$("#cc-actions .cc-count") && st.win === null, why + "：倒计时收起");
    t.mock.timers.tick(T.lastMs);
    assert.equal(st.settle.phase, "judge", why);
    t.mock.timers.tick(T.reducedJudgeMs);
    assert.ok(visible(p.$("#cc-banner")) && !st.settle, why + "：最后才弹结算横幅");
  };
  // 人先点「不加注」，AI 还没表态：等 AI，不进过渡
  let o = open("不加注1");
  click(o.p.$('#cc-actions [data-cc="pass"]'));
  assert.ok(o.g.betting.window && o.g.results.length === 0, "AI 还没表态，窗口开着");
  assert.equal(o.st.settle, null, "倒计时期间不进过渡");
  assert.match(o.p.$("#cc-actions .cc-prompt").textContent, /你不加注了，等庄家/);
  t.mock.timers.tick(U.dealMs);   // AI 也不追加：关窗
  check(o, "人先点、AI 后表态");
  // AI 先表态，人再点「不加注」
  o = open("不加注2");
  t.mock.timers.tick(U.dealMs);
  assert.ok(o.g.betting.window.passed.dealer && o.st.settle === null, "AI 不追加了，人还有倒计时：不进过渡");
  click(o.p.$('#cc-actions [data-cc="pass"]'));
  check(o, "AI 先表态、人后点");
});

test("counter-cards.css 的 @keyframes 不重名：同名的后写的会盖掉前面的（合并 #496 时，赢家筹码「收进来」时数字亮一下和追加窗口的进度条都叫 ccWin，进度条就不缩短了）", () => {
  const names = Array.from(read("counter-cards.css").matchAll(/@keyframes\s+([\w-]+)/g), m => m[1]);
  assert.ok(names.includes("ccWin"), "追加窗口的进度条");
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), [], "重名的 @keyframes");
});

test("结算前的过渡：翻到相位直接全押结算——最后一步是翻开相位：桌上翻牌、闪一下（以前一结算就看不到了），全押的筹码推进底池，操作栏写翻开了什么、双方全押", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const p = page();
  const g = p.CC.newGame({ seed: "相位过渡", deck: ["phase", "heat", "glow", "acid", "thunder", "snow", "sand"] });
  const A = (side, type, extra) => p.CC.act(g, side, Object.assign({ type }, extra || {}));
  A("dealer", "weather", { op: "pass" }); A("dealer", "play", { card: "flesh" }); A("player", "play", { card: "fire" });
  A("player", "check"); A("dealer", "check");
  p.UI.start({ side: "player", level: "normal", game: g });
  assert.deepEqual([chipsOn(p, ".cc-me"), chipsOn(p, ".cc-opp"), chipsOn(p, ".cc-pot")], [49, 49, 2]);
  click(p.$('#cc-actions [data-cc="reveal"]'));
  assert.ok(g.results.length === 1 && g.results[0].allIn, "翻到相位：全押、结算了");
  assert.equal(p.UI.state().settle.phase, "last");
  assert.equal(p.$("#cc-actions .cc-prompt").textContent, "你翻开了新天气〔相位〕。 翻到相位：本轮双方全押，各押 50 枚（筹码较少一方的全部筹码）。");
  assert.ok(p.$("#cc-board .cc-flash") && p.$("#cc-board .cc-wnow .cc-flip"), "翻牌、闪一下");
  assert.match(p.$("#cc-board .cc-wnow").textContent, /相位/);
  assert.equal(p.$("#cc-board .cc-me .cc-acted").textContent, "翻开相位");
  assert.deepEqual([chipsOn(p, ".cc-me"), chipsOn(p, ".cc-opp"), chipsOn(p, ".cc-pot")], [0, 0, 100], "全押：手上的都推进底池");
  assert.ok(p.$("#cc-board .cc-pot.allin"));
  assert.ok(!visible(p.$("#cc-banner")));
});

test("结算前的过渡：点一下桌面直接看结算（最后一步、判定中都行；操作栏的「直接看结算」也行），点侧栏不算；弃牌不用判定，最后一步之后直接弹横幅；fast（测试用）不停", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const T = page().UI.UI_CONFIG.settle;
  const open = (seed, fast) => { const p = page(); const g = bet2Game(p, seed, "fire"); p.UI.start({ side: "player", level: "normal", game: g, fast }); return p; };
  // 最后一步的时候点牌桌
  let p = open("跳过1");
  click(p.$('#cc-actions [data-cc="check"]'));
  assert.equal(p.UI.state().settle.phase, "last");
  click(p.$("#cc-side h3"));
  assert.ok(p.UI.state().settle && !visible(p.$("#cc-banner")), "点侧栏不算");
  click(p.$("#cc-board .cc-deck"));
  assert.equal(p.UI.state().settle, null);
  assert.ok(visible(p.$("#cc-banner")), "点一下桌面：直接看结算");
  t.mock.timers.tick(5000);
  assert.ok(visible(p.$("#cc-banner")), "跳过以后计时也停了，横幅留着");
  // 判定中点操作栏的「直接看结算」
  p = open("跳过2");
  click(p.$('#cc-actions [data-cc="check"]'));
  t.mock.timers.tick(T.lastMs);
  assert.equal(p.UI.state().settle.phase, "judge");
  const skip = p.$('#cc-actions [data-cc="skipSettle"]');
  assert.equal(skip.textContent, T.skip);
  click(skip);
  assert.ok(visible(p.$("#cc-banner")) && !p.UI.state().settle);
  // 判定中点桌上的牌背
  p = open("跳过3");
  click(p.$('#cc-actions [data-cc="check"]'));
  t.mock.timers.tick(T.lastMs);
  click(p.$("#cc-board .cc-slot .cc-back"));
  assert.ok(visible(p.$("#cc-banner")), "判定中点一下桌面也行");
  // 弃牌：不用判定
  p = open("弃牌");
  click(p.$('#cc-actions [data-cc="fold"]'));
  assert.equal(p.UI.state().settle.phase, "last");
  assert.equal(p.$("#cc-actions .cc-prompt").textContent, "你弃牌。");
  assert.equal(p.$("#cc-board .cc-me .cc-acted").textContent, "弃牌");
  t.mock.timers.tick(T.lastMs);
  assert.ok(visible(p.$("#cc-banner")), "弃牌：最后一步之后直接弹横幅");
  assert.match(p.$("#cc-banner").textContent, /你弃牌/);
  // fast（测试 / 真浏览器测试用）：不停，直接弹
  p = open("fast", true);
  click(p.$('#cc-actions [data-cc="check"]'));
  assert.equal(p.UI.state().settle, null);
  assert.ok(visible(p.$("#cc-banner")), "fast：不停");
});

test("结算前的过渡：不开 fast 和 AI 打完一局（人当庄家）——每一轮都是「最后一步 → 判定中 → 横幅」，过渡中 AI 不动、只有「直接看结算」、桌上只有牌背；最后一轮的横幅点「看总结算」才出总结算", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const p = page(), T = p.UI.UI_CONFIG.settle, rng = p.CC.makeRng("过渡整局");
  p.UI.start({ side: "dealer", level: "hard", seed: "过渡整局" });
  const st = () => p.UI.state(), g = st().game, banner = p.$("#cc-banner"), snap = () => JSON.stringify(g);
  const tickUntil = (done) => { for (let i = 0; i < 200 && !done(); i++) t.mock.timers.tick(50); assert.ok(done(), "AI 一直没走"); };
  let seen = 0, lastBanner = false;
  for (let guard = 0; guard < 600; guard++) {
    if (g.betting && g.betting.window) assert.ok(!st().settle && !visible(banner), "跟注后的追加窗口（#496）倒计时期间不进过渡");
    if (st().settle) {
      const res = g.results[g.results.length - 1], before = snap();
      assert.ok(!visible(banner), `第 ${res.r} 轮：横幅不马上出来`);
      assert.equal(st().settle.phase, "last");
      assert.match(p.$("#cc-top .cc-round").textContent, new RegExp(`第 ${res.r} / 5 轮`));
      assert.equal(p.$$("#cc-side .cc-results .cc-res").length, g.results.length - 1, "每轮结算里还没有这一轮");
      assert.deepEqual(Array.from(p.$$("#cc-actions button[data-cc]"), b => b.dataset.cc), ["skipSettle"]);
      assert.ok(!p.$("#cc-actions .cc-count") && !st().win, "过渡中没有追加窗口的倒计时");
      assert.ok(!p.$("#cc-board button.cc-can") && !p.$("#cc-board .cc-slot [data-face]"), "点不了牌，桌上只有牌背");
      t.mock.timers.tick(T.lastMs);
      if (res.outcome !== "fold") {
        assert.equal(st().settle.phase, "judge", `第 ${res.r} 轮：判定中`);
        t.mock.timers.tick(T.reducedJudgeMs);
      }
      assert.ok(visible(banner) && banner.querySelector('[data-cc="dismiss"]') && !banner.querySelector(".cc-final"), `第 ${res.r} 轮：最后才弹结算横幅`);
      assert.equal(snap(), before, "过渡中 AI 不动");
      seen++;
      continue;
    }
    if (visible(banner)) {
      if (banner.querySelector(".cc-final")) break;
      const d = banner.querySelector('[data-cc="dismiss"]');
      lastBanner = g.over;
      if (g.over) assert.equal(d.textContent, "看总结算");
      click(d);
      continue;
    }
    if (p.CC.toAct(g).indexOf(st().ai) >= 0) { const before = snap(); tickUntil(() => snap() !== before); continue; }   // AI 等一会儿走一步
    const card = p.$("#cc-board button.cc-can");
    if (card) { click(card); continue; }
    const btns = Array.from(p.$$("#cc-actions button[data-cc]")).filter(b => !b.disabled && b.dataset.cc !== "amt" && b.dataset.cc !== "mode");
    assert.ok(btns.length, "没有能点的按钮：" + g.stage);
    const bet = btns.filter(b => ["check", "call", "bet", "raise", "fold", "pass"].includes(b.dataset.cc));   // pass：追加窗口里的「不加注」
    click(bet.length ? (rng() < 0.1 ? bet.find(b => b.dataset.cc === "fold") : bet[Math.floor(rng() * bet.length)]) : btns.find(b => b.classList.contains("primary")) || btns[0]);
  }
  assert.ok(g.over && p.$("#cc-banner .cc-final"), "打完了，有总结算");
  assert.equal(seen, g.results.length, "每一轮都有过渡");
  assert.ok(seen >= 1);
  if (g.log[g.log.length - 2].t === "result") assert.ok(lastBanner, "最后一轮结算完结束的：那一轮的横幅点「看总结算」才出总结算");
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
  betThrough(p, game, "bet1");
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

test("设置页：普通难度写「只看单轮结果」（以前是「看上一轮」）；开局说明和规则里写了借贷（一局里总共借多少不设上限，#496）、按最终筹码数定胜负", () => {
  const p = page();
  click(p.$("#t-cc"));
  const normal = p.$('[data-cc="set"][data-key="level"][data-val="normal"]');
  assert.match(normal.textContent, /只看单轮结果/);
  assert.ok(!p.$("#cc-setup").textContent.includes("看上一轮"));
  const setup = p.$("#cc-setup").textContent;
  assert.match(setup, /筹码不够时可以向主持方借（每借 3 枚，结束时还 4 枚）/);
  assert.match(setup, /借贷：筹码不够时可以向主持方借/);
  assert.match(setup, /3→4、6→8/);
  assert.match(setup, /一局里总共借多少不设上限，借几次都行/, "借贷不设上限（#496 第 3 条）");
  assert.match(setup, /按最终筹码数（扣还借款之后）比/);
});

test("规则说明的分档赔付只有两档（主人 10/30 删掉「差 3 及以上」）：差 1 拿底池、差 2 再赔 0.5 倍；设置页和对局中的侧栏都是", () => {
  const p = page();
  click(p.$("#t-cc"));
  const tierLine = (where) => Array.from(p.$$(where + " .cc-rules li")).map(li => li.textContent).find(t => t.startsWith("分档赔付"));
  const want = "分档赔付：差 1 赢家拿走底池；差 2 赢家拿走底池，输家再赔自己这一轮下注额的 0.5 倍（半枚向下取整）。";
  assert.equal(tierLine("#cc-setup"), want, "设置页");
  click(p.$('[data-cc="start"]'));
  p.UI.stop();   // 人当玩家：庄家（AI）在等发牌动画，这里不用它走
  assert.equal(tierLine("#cc-side"), want, "对局中的侧栏");
  assert.ok(!p.$("#scr-cc").textContent.includes("差 3"), "界面上没有「差 3」");
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
  A(g, "player", "bet", { amount: 4 }); A(g, "dealer", "call"); passWindow(CC, g);
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

test("下注不封顶（#496）：人能押过对方的全部筹码（「最大」是自己手上的）；对方押得比人手上的还多时，下注栏写清楚跟不起、要先借，只有借的按钮（从够跟的数目起）和弃牌，借够了才出现跟注；规则说明写了不封顶", () => {
  const DECK = ["thunder", "sand", "glow", "heat", "snow", "acid", "phase"];
  // 1. 人当玩家 49 枚，庄家只有 9 枚：「最大」是自己手上的 49 枚（以前封顶在庄家的 9 枚）
  const p = page();
  const CC = p.CC, A = (g, side, type, extra) => CC.act(g, side, Object.assign({ type }, extra || {}));
  const g = CC.newGame({ seed: "不封顶栏", deck: DECK, dealerChips: 10 });
  A(g, "dealer", "weather", { op: "pass" }); A(g, "dealer", "play", { card: "flesh" });
  p.UI.start({ side: "player", level: "normal", game: g, fast: true });
  click(p.$('#cc-board button.cc-can[data-card="fire"]'));
  assert.equal(g.stage, "bet1");
  click(p.$('#cc-actions [data-cc="amt"][data-set="max"]'));
  assert.equal(Number(p.$("#cc-actions .cc-amt").textContent), 49);
  click(p.$('#cc-actions [data-cc="bet"]'));
  assert.ok(g.log.some(e => e.t === "bet" && e.by === "player" && e.op === "bet" && e.amount === 49), "押了 49 枚");
  // 庄家（AI，马上走）跟不起：借了来跟，或者弃牌——不会卡住
  const folded = g.results.length && g.results[0].outcome === "fold";
  assert.ok(folded || (g.sides.dealer.loan >= 39 && g.sides.dealer.bet === 50), JSON.stringify(g.results) + " 庄家借了 " + g.sides.dealer.loan);
  assert.match(p.$("#cc-side .cc-rules").textContent, /下注不封顶：想押多少押多少，只受自己手上的筹码（含借来的）限制/);
  // 2. 人当玩家、手上 2 枚，庄家（测试替它走）押 10 枚：跟不起
  const h = CC.newGame({ seed: "跟不起栏", deck: DECK, playerChips: 8 });
  A(h, "dealer", "weather", { op: "pass" });
  A(h, "dealer", "play", { card: "flesh" }); A(h, "player", "play", { card: "ice" });
  A(h, "player", "bet", { amount: 4 }); A(h, "dealer", "call"); passWindow(CC, h);
  A(h, "player", "reveal"); A(h, "player", "noNormal");
  A(h, "dealer", "check"); A(h, "player", "check");
  A(h, "dealer", "weather", { op: "keep" });
  A(h, "dealer", "play", { card: "sand" }); A(h, "player", "play", { card: "energy" });
  A(h, "player", "check"); A(h, "dealer", "bet", { amount: 10 });
  const q = page();
  q.UI.start({ side: "player", level: "normal", game: h, fast: true });
  const bar = () => q.$("#cc-actions");
  assert.match(bar().textContent, /庄家下了注，要跟 10 枚/);
  assert.match(bar().textContent, /你手上只有 2 枚，跟不起：要跟就先向主持方借（每借 3 枚，结束时还 4 枚），不借只能弃牌/);
  assert.ok(!bar().querySelector('[data-cc="call"]'), "没有跟注");
  assert.ok(!bar().querySelector('[data-cc="raise"]'), "没有加注");
  assert.ok(bar().querySelector('[data-cc="fold"]'));
  assert.deepEqual(Array.from(bar().querySelectorAll('[data-cc="borrow"]')).map(b => Number(b.dataset.amount)), [9, 12], "借的按钮从够跟的 9 枚起，到补上缺口（够跟 + 最低加注额）的 12 枚");
  const nine = bar().querySelector('[data-cc="borrow"][data-amount="9"]');
  assert.ok(nine.classList.contains("primary"));
  assert.match(nine.textContent, /借 9 枚（还 12）/);
  click(nine);
  assert.deepEqual([h.sides.player.chips, h.sides.player.loan, h.sides.player.owe], [11, 9, 12]);
  assert.equal(CC.toAct(h).join(), "player", "借完还是人下注");
  assert.ok(bar().querySelector('[data-cc="call"]'), "借够了，可以跟注");
  click(bar().querySelector('[data-cc="call"]'));
  assert.equal(h.sides.player.bet, 11);
});

/* ---------- 跟注后的追加窗口（#496 第 2 条）：倒计时、「加注」「弃牌」「不加注」，到时间自动进入下一步 ---------- */
/** 人当玩家；庄家（测试替它走）不动天气、暗出血肉，玩家暗出冰、过牌，庄家下注 1 枚——轮到人跟注 */
function windowGame(p, seed) {
  const CC = p.CC, A = (g, side, type, extra) => CC.act(g, side, Object.assign({ type }, extra || {}));
  const g = CC.newGame({ seed, deck: ["thunder", "sand", "glow", "heat", "snow", "acid", "phase"] });
  A(g, "dealer", "weather", { op: "pass" });
  A(g, "dealer", "play", { card: "flesh" }); A(g, "player", "play", { card: "ice" });
  A(g, "player", "check"); A(g, "dealer", "bet", { amount: 1 });
  p.UI.start({ side: "player", level: "normal", game: g, seed, fast: true });
  return g;
}

test("跟注后的追加窗口（#496）：人跟注后操作栏出现倒计时（从 3 秒数起，秒数读 CC_CONFIG.callWindowSec）、「加注」「弃牌」「不加注」；AI 马上决定、人有完整的 3 秒；倒计时到了自动进入下一步（翻天气）", async () => {
  const p = page();
  const g = windowGame(p, "窗口栏");
  assert.equal(p.CC.CC_CONFIG.callWindowSec, 3);
  click(p.$('#cc-actions [data-cc="call"]'));
  assert.ok(g.betting && g.betting.window, "跟注后开了追加窗口（庄家 AI 马上决定：不追加）");
  assert.equal(g.betting.window.passed.dealer, true, "AI 不等倒计时，马上放弃追加");
  const bar = p.$("#cc-actions");
  assert.equal(bar.querySelector(".cc-count").textContent, "3");
  assert.equal(bar.querySelector(".cc-clock").getAttribute("role"), "timer");
  assert.ok(bar.querySelector(".cc-winbar i"), "倒计时的进度条");
  assert.match(bar.querySelector(".cc-prompt").textContent, /^你跟注了。3 秒追加窗口：双方都还可以加注或弃牌，没人动作就进入翻天气。/);
  const raise = bar.querySelector('[data-cc="raise"]'), fold = bar.querySelector('[data-cc="fold"]'), pass = bar.querySelector('[data-cc="pass"]');
  assert.ok(raise && fold && pass);
  assert.match(raise.textContent, /^加注 1$/);
  assert.ok(bar.querySelector(".cc-amount .cc-amt"), "加注额照平时能加减");
  assert.equal(pass.textContent, "不加注");
  assert.ok(pass.classList.contains("primary"), "不动作是默认的");
  assert.ok(!bar.querySelector('[data-cc="call"], [data-cc="check"], [data-cc="borrow"]'), "窗口里没有跟注、过牌、借贷");
  assert.match(p.$("#cc-side .cc-log").textContent, /庄家下注 1 枚。|玩家跟注 1 枚。/);
  assert.match(p.$("#cc-side .cc-log").textContent, /玩家跟注，开 3 秒追加窗口/);
  // 改加注额会整块重画：倒计时不重新数
  await wait(1100);
  assert.equal(p.$("#cc-actions .cc-count").textContent, "2", "每秒少一");
  click(p.$('#cc-actions [data-cc="amt"][data-d="1"]'));
  assert.equal(p.$("#cc-actions .cc-amt").textContent, "2");
  assert.equal(p.$("#cc-actions .cc-count").textContent, "2", "重画后接着数，不从 3 重来");
  await wait(2100);
  assert.equal(g.stage, "weather", "倒计时到了：自动进入下一步（翻天气）");
  assert.ok(g.log.some(e => e.t === "window" && e.why === "timeout"));
  assert.ok(!p.$("#cc-actions .cc-count"), "倒计时收起");
  assert.match(p.$("#cc-actions").textContent, /翻开一张新天气/);
  assert.equal(p.UI.state().win, null);
});

test("追加窗口里：点「加注」关窗、照常轮到 AI 应对（算进加注次数）；点「弃牌」立即判负；点「不加注」——AI 也不追加，就直接进入下一步，不用等倒计时；离开牌桌时倒计时停掉", () => {
  // 不加注：AI 已经放弃追加，直接进入翻天气
  const a = page();
  const g1 = windowGame(a, "窗口栏");
  click(a.$('#cc-actions [data-cc="call"]'));
  click(a.$('#cc-actions [data-cc="pass"]'));
  assert.equal(g1.stage, "weather");
  assert.equal(a.UI.state().win, null, "窗口关了，倒计时停掉");
  // 加注：关窗，AI（马上）跟注 / 加注 / 弃牌
  const b = page();
  const g2 = windowGame(b, "窗口栏");
  click(b.$('#cc-actions [data-cc="call"]'));
  click(b.$('#cc-actions [data-cc="amt"][data-d="1"]'));
  click(b.$('#cc-actions [data-cc="raise"]'));
  const r = g2.log.find(e => e.t === "bet" && e.op === "raise" && e.by === "player");
  assert.ok(r && r.window && r.amount === 2, "人在追加窗口里加注 2 枚");
  assert.match(b.$("#cc-side .cc-log").textContent, /玩家在追加窗口里加注 2 枚/);
  const after = g2.log.slice(g2.log.indexOf(r) + 1).find(e => e.t === "bet" && e.by === "dealer");
  assert.ok(after && ["call", "raise", "fold"].includes(after.op), "AI 接着应对：" + JSON.stringify(after));
  if (after.op === "call" && g2.betting && g2.betting.window) {
    assert.equal(g2.betting.raises, 1);
    assert.equal(b.$("#cc-actions .cc-count").textContent, "3", "AI 跟注后又开一个窗口，倒计时从 3 秒重新数");
  }
  // 弃牌：立即判负
  const c = page();
  const g3 = windowGame(c, "窗口栏");
  click(c.$('#cc-actions [data-cc="call"]'));
  click(c.$('#cc-actions [data-cc="fold"]'));
  assert.deepEqual([g3.results[0].outcome, g3.results[0].folded], ["fold", "player"]);
  assert.ok(visible(c.$("#cc-banner")), "结算横幅");
  assert.equal(c.UI.state().win, null);
  // 离开牌桌：倒计时停掉
  const d = page();
  const g4 = windowGame(d, "窗口栏");
  click(d.$('#cc-actions [data-cc="call"]'));
  assert.ok(d.UI.state().win && d.UI.state().win.timer, "倒计时在走");
  click(d.$('#cc-top [data-cc="title"]'));
  assert.equal(d.UI.state().win, null, "回到标题：倒计时停掉");
  assert.ok(g4.betting.window, "对局停在窗口里，不会自己往下走");
});

test("手机竖屏（max-width: 600px）：High Flux 牌桌的操作栏固定在屏幕底部（position: sticky; bottom: 0），排在侧栏后面、底色不透明、让开 iPhone 底部的横条；电脑上照旧（#499 第 3 项；位置在真浏览器那条量）", () => {
  const css = read("counter-cards.css");
  const phone = css.match(/@media \(max-width: 600px\) \{([\s\S]*?)\n\}/);
  assert.ok(phone, "有手机竖屏（max-width: 600px）那一段");
  const rule = phone[1].match(/#scr-cc \.cc-actions\s*\{([^}]*)\}/);
  assert.ok(rule, "只管 High Flux 的牌桌（#scr-cc）");
  assert.match(rule[1], /position:\s*sticky/);
  assert.match(rule[1], /bottom:\s*0/);
  assert.match(rule[1], /order:\s*1/, "排在侧栏后面：翻到哪都在最底下，滑到底时侧栏露得出来");
  assert.match(rule[1], /background:\s*#[0-9a-f]{3,6}\b/i, "底色不透明：盖在牌桌上面时看不到底下的牌");
  assert.match(rule[1], /env\(safe-area-inset-bottom/, "让开 iPhone 底部的横条");
  assert.doesNotMatch(css.replace(phone[0], "").replace(/\/\*[\s\S]*?\*\//g, ""), /sticky/, "别的宽度不贴底");
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

/* ---------- 克制表：牌局中随时能开（作者 10/29 在 PR #486 的评论） ---------- */
const J = v => JSON.parse(JSON.stringify(v));
const fmt = s => (s > 0 ? "+" + s : s < 0 ? "−" + -s : "0");
/** 人当玩家；庄家（测试替它走）不动天气、暗出血肉；天气堆第一张是酷暑 */
function heatGame(p, seed) {
  const game = p.CC.newGame({ seed, deck: ["heat", "glow", "acid", "thunder", "snow", "sand", "phase"] });
  p.CC.act(game, "dealer", { type: "weather", op: "pass" });
  p.CC.act(game, "dealer", { type: "play", card: "flesh" });
  p.UI.start({ side: "player", level: "normal", game, seed, fast: true });
  return game;
}

test("克制表：顶栏最前面是「菜单」（和战斗、单局的顶栏一样），点开暂停菜单有「克制表」，点了打开平时那个克制表浮层，格子是按场上天气的得分", () => {
  const p = page();
  const game = heatGame(p, "菜单");
  const menu = p.$("#cc-top").firstElementChild;
  assert.ok(menu.matches("button.pm-open[data-pause-open]"), "顶栏最前面是「菜单」");
  assert.equal(menu.textContent, "菜单");
  assert.match(menu.getAttribute("title"), /菜单（Esc）：克制表/);
  click(menu);
  assert.ok(p.w.PauseMenu.isOpen(), "点了打开暂停菜单");
  const items = J(p.w.PauseMenu.list());
  const row = items.find(r => r.id === "matchupCC");
  assert.ok(row, "菜单里有克制表");
  assert.equal(row.label, "克制表");
  assert.match(row.hint, /按场上天气算好的得分（\+1 \/ 0 \/ −1），随时能看，不影响出牌和下注/);
  assert.ok(!items.some(r => r.id === "matchup"), "战斗的那一项不在牌桌上出现");
  const before = JSON.stringify(game);
  click(p.$('#pm-overlay [data-pause-item="matchupCC"]'));
  assert.ok(!p.w.PauseMenu.isOpen(), "点了一项，菜单收起");
  const box = p.$("#mu-overlay");
  assert.ok(visible(box) && p.UI.chartOpen());
  assert.equal(box.parentNode, p.$("#cc-game"), "挂在牌桌下：#cc-game 上写着天气，卡片套得上天气底纹");
  assert.ok(box.classList.contains("ovl") && box.querySelector(".mu-card.ovl-card.mu-score[role=dialog]"), "和平时同一个浮层");
  assert.equal(box.querySelector(".ws-tape").textContent, "克制表");
  assert.match(box.querySelector(".mu-weather").textContent, /天气 常态/);
  assert.equal(box.querySelectorAll("[data-mu-cell]").length, 35);
  assert.equal(box.querySelector('[data-mu-cell="0:0"]').textContent.trim(), "+1", "火 → 血肉 +1");
  assert.equal(box.querySelector('[data-mu-cell="0:1"]').textContent.trim(), "−1", "火 → 装甲 −1");
  assert.equal(box.querySelector('[data-mu-cell="5:0"]').textContent.trim(), "0", "物理 → 血肉 0");
  assert.ok(box.querySelector('th.mu-row.mu-e-fire svg.eicon'), "行头有属性图标");
  assert.equal(JSON.stringify(game), before, "打开克制表不动牌局");
  click(box.querySelector("[data-mu-close]"));
  assert.ok(!visible(box) && !p.UI.chartOpen(), "关掉");
  assert.equal(JSON.stringify(game), before);
  // 点浮层外面（暗底）也关掉，和平时一样
  click(p.$('#cc-side [data-cc="chart"]'));
  click(box);
  assert.ok(!p.UI.chartOpen());
});

test("克制表：侧栏以前折叠的「克制速查」小表换成打开完整克制表的按钮（写着场上的天气）；直接打开时键盘焦点在「关闭」上，Esc 关掉", () => {
  const p = page();
  heatGame(p, "侧栏");
  const side = p.$("#cc-side");
  const b = side.firstElementChild;
  assert.ok(b.matches('button.cc-chartbtn[data-cc="chart"]'), "侧栏最上面是克制表的按钮");
  assert.match(b.textContent, /^克制表天气 常态 · 按场上天气的得分 \+1 \/ 0 \/ −1$/);
  assert.ok(!side.querySelector("details.cc-chart, table"), "小表去掉了");
  assert.ok(!read("counter-cards.css").includes(".cc-chart "), "小表的样式也去掉了");
  click(b);
  const close = p.$("#mu-overlay [data-mu-close]");
  assert.ok(p.UI.chartOpen());
  assert.equal(p.doc.activeElement, close, "焦点在「关闭」上");
  MD.key(p.doc, "Escape", { target: close });
  assert.ok(!p.UI.chartOpen(), "Esc 关掉");
});

test("克制表：开着时牌局照常（人出牌、下注，AI 照常走）；场上天气没变表不重画（点开的格子还在），翻开新天气表跟着变", () => {
  const p = page();
  const game = heatGame(p, "跟着变");
  click(p.$('#cc-side [data-cc="chart"]'));
  const box = p.$("#mu-overlay");
  const fireFlesh = () => box.querySelector('[data-mu-cell="0:0"]');
  click(fireFlesh());
  assert.match(box.querySelector(".mu-detail").textContent, /火 → 血肉：玩家赢 \+1 · 克制 \+1/, "点开一格看原因");
  const td = fireFlesh();
  click(p.$('#cc-board button.cc-can[data-card="ice"]'));
  betThrough(p, game, "bet1");
  assert.equal(game.stage, "weather", "人出了牌、下完注，庄家（AI）也走了");
  assert.equal(fireFlesh(), td, "天气没变：表没重画");
  assert.ok(box.querySelector(".mu-detail"), "点开的格子还在");
  click(p.$('#cc-actions [data-cc="reveal"]'));
  assert.equal(game.weather, "heat");
  assert.ok(p.UI.chartOpen(), "还开着");
  assert.match(box.querySelector(".mu-weather").textContent, /天气 酷暑/);
  assert.match(fireFlesh().textContent, /\+1\s*→\s*\+2/, "火 → 血肉：+1 → +2");
  assert.ok(fireFlesh().classList.contains("changed"));
  assert.match(box.querySelector(".mu-detail").textContent, /玩家赢 \+2（原来 玩家赢 \+1） · 克制 \+1；酷暑：火 \+1/);
  assert.equal(box.parentNode.dataset.weather, "heat", "卡片套上酷暑的底纹");
  assert.match(p.$('#cc-side [data-cc="chart"]').textContent, /天气 酷暑/);
});

test("克制表：每轮开始问借不借的时候也能开，关掉以后借贷按钮照旧", () => {
  const p = page();
  p.UI.start({ side: "player", level: "normal", seed: "借时看表", fast: true, gameOpt: { playerChips: 1 } });
  const g = p.UI.state().game, before = JSON.stringify(g);
  assert.equal(g.stage, "loan");
  click(p.$('#cc-side [data-cc="chart"]'));
  assert.ok(p.UI.chartOpen());
  click(p.$("#mu-overlay [data-mu-close]"));
  assert.equal(JSON.stringify(g), before);
  assert.ok(p.$('#cc-actions [data-cc="borrow"][data-amount="3"]'));
});

for (const side of ["player", "dealer"]) {
  test(`克制表：整局任何阶段都能开、关（人当${side === "player" ? "玩家" : "庄家"}）——不动对局和操作栏（选着的暗弃 / 常态、改过的下注额都留着），结算横幅、总结算上也有按钮`, () => {
    const p = page();
    p.UI.start({ side, level: "hard", seed: "随时看表-" + side, fast: true });
    const st = () => p.UI.state(), rng = p.CC.makeRng("随时看表" + side);
    const seen = new Set();
    let moded = false, bumped = false;
    const peek = (where, opener) => {
      const g = st().game, before = JSON.stringify(g), mode = st().mode, amount = st().amount, banner = st().banner, shown = visible(p.$("#cc-banner"));
      click(opener);
      const box = p.$("#mu-overlay");
      assert.ok(visible(box) && p.UI.chartOpen(), where + "：打开了");
      assert.equal(box.querySelector(".mu-weather").textContent, "天气 " + p.CC.weatherName(g.weather), where + "：按场上的天气");
      assert.equal(box.querySelector('[data-mu-cell="0:0"] b').textContent, fmt(p.CC.score("fire", "flesh", g.weather)), where + "：火 → 血肉的得分");
      click(box.querySelector("[data-mu-close]"));
      assert.ok(!visible(box) && !p.UI.chartOpen(), where + "：关掉了");
      assert.equal(JSON.stringify(g), before, where + "：对局没动");
      assert.deepEqual([st().mode, st().amount, st().banner, visible(p.$("#cc-banner"))], [mode, amount, banner, shown], where + "：操作栏、横幅没动");
      seen.add(where);
    };
    for (let guard = 0; guard < 500; guard++) {
      const banner = p.$("#cc-banner");
      if (visible(banner)) {
        const fin = !!banner.querySelector(".cc-final");
        peek(fin ? "总结算" : "结算横幅", banner.querySelector('[data-cc="chart"]'));
        if (fin) break;
        click(banner.querySelector('[data-cc="dismiss"]'));
        continue;
      }
      const g = st().game;
      peek(g.stage, p.$('#cc-side [data-cc="chart"]'));
      const mode = p.$('#cc-actions [data-cc="mode"][data-mode]:not([disabled])');
      if (mode && !st().mode && !moded) { click(mode); moded = true; peek("选着" + (st().mode === "skip" ? "暗弃" : "常态"), p.$('#cc-side [data-cc="chart"]')); }
      const plus = p.$('#cc-actions [data-cc="amt"][data-d="1"]:not([disabled])');
      if (plus && !bumped) { click(plus); bumped = true; peek("改过下注额", p.$('#cc-side [data-cc="chart"]')); }
      const card = p.$("#cc-board button.cc-can");
      if (card) { click(card); continue; }
      const btns = Array.from(p.$$("#cc-actions button[data-cc]")).filter(b => !b.disabled && b.dataset.cc !== "amt" && b.dataset.cc !== "mode");
      assert.ok(btns.length, "没有能点的按钮：" + g.stage);
      const bet = btns.filter(b => ["check", "call", "bet", "raise", "pass"].includes(b.dataset.cc));
      click(bet.length ? bet[Math.floor(rng() * bet.length)] : btns.find(b => b.classList.contains("primary")) || btns[0]);
    }
    assert.ok(st().game.over, "打完了");
    const want = ["play", "bet1", "结算横幅", "总结算", "改过下注额"].concat(side === "player" ? ["weather", "选着暗弃"] : ["dealerWeather"]);
    want.forEach(w => assert.ok(seen.has(w), `${w} 的时候开过：${[...seen].join("、")}`));
  });
}

test("克制表：Esc——牌局中打开暂停菜单（里面有克制表）；设置页上不开；离开牌桌时开着的克制表一起收掉", async () => {
  const p = page();
  const tick = () => new Promise(r => setTimeout(r, 10));
  click(p.$("#t-cc"));
  assert.equal(p.doc.body.dataset.screen, "counter");
  MD.key(p.doc, "Escape");
  await tick();
  assert.ok(!p.w.PauseMenu.isOpen(), "设置页上 Esc 不开菜单");
  click(p.$('[data-cc="start"]'));
  p.UI.stop();
  MD.key(p.doc, "Escape");
  await tick();
  assert.ok(p.w.PauseMenu.isOpen(), "牌局中 Esc 打开暂停菜单");
  assert.ok(J(p.w.PauseMenu.list()).some(r => r.id === "matchupCC"));
  MD.key(p.doc, "Escape");
  assert.ok(!p.w.PauseMenu.isOpen(), "再按一次关掉");
  // 开着克制表回到标题：一起收掉
  click(p.$('#cc-side [data-cc="chart"]'));
  assert.ok(p.UI.chartOpen());
  click(p.$('#cc-top [data-cc="title"]'));
  assert.ok(!p.w.MatchupUI.isOpen(), "离开牌桌收掉克制表");
  assert.equal(p.doc.body.dataset.screen, "title");
});

/* ---------- 悬停预览：手里的元素牌（作者 10/29 在 PR #486 的评论）——电脑上鼠标停上去、手机上长按 ---------- */
/** 在 el 上发一个会冒泡的事件（pointerover / pointerout / touchstart / contextmenu……），返回这个事件（看 defaultPrevented） */
const fireEv = (p, el, type, o) => { assert.ok(el, "要碰的东西不在：" + type); const ev = new p.w.Event(type, Object.assign({ bubbles: true }, o || {})); el.dispatchEvent(ev); return ev; };
const hover = (p, el) => fireEv(p, el, "pointerover", { pointerType: "mouse" });
const leaveTo = (p, el, to) => fireEv(p, el, "pointerout", { pointerType: "mouse", relatedTarget: to || null });
const finger = (p, el, type, x, y) => fireEv(p, el, type, { touches: /end|cancel/.test(type) ? [] : [{ clientX: x || 0, clientY: y || 0 }] });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const handCard = (p, face) => p.$(`#cc-board .cc-me [data-face="${face}"]`);
const tipScores = (p) => Array.from(p.$$("#cc-tip [data-layer] b")).map(b => b.textContent);
const chartRow = (p, el, w) => J(p.CC.chart(w).cells[p.CC.CC_CONFIG.elements.indexOf(el)].map(x => fmt(x.value)));   // 克制表里这张牌的一行（页面里的数组先转成这边的）

test("悬停预览（作者 10/29 在 PR #486 的评论）：鼠标停在手里的元素牌上弹出小预览——这张牌按场上天气打血肉、装甲、护盾、沙、灵体各得几分（+1 / 0 / −1，就是克制表里这张牌的一行，配色同克制表），移开就收起，不动牌局", () => {
  const p = page();
  const game = heatGame(p, "悬停");
  const tip = p.$("#cc-tip"), before = JSON.stringify(game);
  assert.ok(tip, "页面骨架里有预览");
  assert.equal(tip.getAttribute("role"), "tooltip");
  assert.ok(!visible(tip), "平时不显示");
  hover(p, handCard(p, "fire").querySelector(".cc-name"));   // 停在牌上的字上也算
  assert.ok(visible(tip), "鼠标停上去弹出预览");
  assert.equal(tip.dataset.card, "fire");
  assert.match(tip.querySelector(".cc-tip-head").textContent, /火/);
  assert.match(tip.textContent, /天气 常态/);
  const cells = Array.from(tip.querySelectorAll("[data-layer]"));
  assert.deepEqual(cells.map(x => x.dataset.layer), ["flesh", "armor", "shield", "sand", "spirit"]);
  assert.deepEqual(cells.map(x => x.querySelector(".cc-tip-name").textContent), ["血肉", "装甲", "护盾", "沙", "灵体"]);
  assert.ok(cells.every(x => x.querySelector("svg.eicon")), "每一层带层的图标");
  assert.deepEqual(tipScores(p), ["+1", "−1", "0", "0", "−1"]);
  assert.deepEqual(tipScores(p), chartRow(p, "fire", null), "就是克制表里火这一行");
  assert.deepEqual(cells.map(x => x.dataset.kind), ["adv", "dis", "neu", "neu", "dis"], "上色同克制表：正分红、负分蓝、0 灰");
  assert.equal(handCard(p, "fire").getAttribute("aria-describedby"), "cc-tip");
  assert.ok(!handCard(p, "fire").hasAttribute("title"), "不再另弹浏览器自己的小字提示（会和预览叠在一起）");
  // 换到另一张：写那一张
  leaveTo(p, handCard(p, "fire"), handCard(p, "ice"));
  hover(p, handCard(p, "ice"));
  assert.equal(tip.dataset.card, "ice");
  assert.deepEqual(tipScores(p), ["0", "0", "0", "0", "−1"]);
  // 在这张牌里面挪（图标 → 字）不收起
  leaveTo(p, handCard(p, "ice").querySelector(".cc-ico"), handCard(p, "ice").querySelector(".cc-name"));
  assert.ok(visible(tip));
  // 移开：收起
  leaveTo(p, handCard(p, "ice"), p.$("#cc-board"));
  assert.ok(!visible(tip), "移开就收起");
  assert.ok(!handCard(p, "ice").hasAttribute("aria-describedby"));
  // 停在牌桌别处不弹；手指碰到时浏览器发的 pointerover（pointerType = touch）不算悬停（手机走长按）
  hover(p, p.$("#cc-board .cc-deck"));
  assert.ok(!visible(tip));
  fireEv(p, handCard(p, "fire"), "pointerover", { pointerType: "touch" });
  assert.ok(!visible(tip), "手指碰一下不弹");
  assert.equal(JSON.stringify(game), before, "看预览不动牌局");
});

test("悬停预览：开着的时候场上的天气变了，预览跟着变（翻开酷暑：火打血肉 +1 → +2；微光反转、酸雨打装甲另 +1 也对），整块重画后照旧挂在这张牌上", () => {
  const p = page();
  const game = heatGame(p, "预览跟着变");
  click(p.$('#cc-board button.cc-can[data-card="ice"]'));
  betThrough(p, game, "bet1");
  assert.equal(game.stage, "weather");
  const tip = p.$("#cc-tip");
  hover(p, handCard(p, "fire"));
  assert.deepEqual(tipScores(p), ["+1", "−1", "0", "0", "−1"]);
  click(p.$('#cc-actions [data-cc="reveal"]'));
  assert.equal(game.weather, "heat");
  assert.ok(visible(tip), "还开着");
  assert.equal(tip.dataset.weather, "heat");
  assert.match(tip.textContent, /天气 酷暑/);
  assert.deepEqual(tipScores(p), ["+2", "0", "+1", "+1", "0"], "酷暑：火 +1");
  assert.equal(handCard(p, "fire").getAttribute("aria-describedby"), "cc-tip", "整块重画后照旧挂在这张牌上");
  game.weather = "glow"; p.UI.render();
  assert.match(tip.textContent, /天气 微光/);
  assert.deepEqual(tipScores(p), ["−1", "+1", "0", "0", "+1"], "微光：克制关系反转");
  hover(p, handCard(p, "energy"));
  assert.deepEqual(tipScores(p), ["+1", "0", "+1", "+1", "+2"], "微光：能量不反转，另 +1");
  game.weather = "acid"; p.UI.render();
  hover(p, handCard(p, "electric"));
  assert.deepEqual(tipScores(p), ["+1", "+1", "+2", "0", "+1"], "酸雨：电 +1，打装甲另 +1");
  for (const w of [null].concat(p.CC.CC_CONFIG.weathers)) {
    game.weather = w; p.UI.render();
    for (const el of ["fire", "acid", "electric", "energy", "physical", "harmonic"]) {   // 冰已经出掉了
      hover(p, handCard(p, el));
      assert.equal(tip.dataset.weather, w || "none");
      assert.deepEqual(tipScores(p), chartRow(p, el, w), `${el} / ${w || "没有天气"}：和克制表一致`);
    }
  }
});

test("悬停预览：只写这张牌自己的数，不透露庄家暗出的层牌——庄家出哪一张，预览都一模一样，也不标出哪一层", () => {
  const seen = new Set();
  for (const ly of ["flesh", "armor", "shield", "sand", "spirit"]) {
    const p = page();
    const game = p.CC.newGame({ seed: "不透露", deck: ["heat", "glow", "acid", "thunder", "snow", "sand", "phase"] });
    p.CC.act(game, "dealer", { type: "weather", op: "pass" });
    p.CC.act(game, "dealer", { type: "play", card: ly });
    p.UI.start({ side: "player", level: "normal", game, fast: true });
    for (const el of ["fire", "harmonic"]) {
      hover(p, handCard(p, el));
      const tip = p.$("#cc-tip");
      assert.equal(tip.querySelectorAll("[data-layer]").length, 5, "五种层都写");
      assert.ok(!tip.querySelector(".sel, .on, [aria-current]"), "没有哪一层特别标出来");
      seen.add(el + "|" + tip.outerHTML);
    }
  }
  assert.equal(seen.size, 2, "庄家出哪张层牌，预览都一样");
});

test("悬停预览：只有玩家手里的元素牌有——常态、对方的牌背、桌上暗出的牌没有；人当庄家时手里的层牌也没有", () => {
  const p = page();
  heatGame(p, "只有元素牌");
  assert.deepEqual(Array.from(p.$$("#cc-board [data-cc-tip]")).map(x => x.dataset.ccTip), ["fire", "acid", "electric", "ice", "energy", "physical", "harmonic"]);
  for (const el of [handCard(p, "normal"), p.$("#cc-board .cc-opp .cc-card"), p.$("#cc-board .cc-slot .cc-back")]) {
    hover(p, el);
    assert.ok(!visible(p.$("#cc-tip")));
  }
  const q = page();
  q.UI.start({ side: "dealer", level: "normal", seed: "庄家没有", fast: true });
  assert.ok(!q.$("#cc-board [data-cc-tip]"));
  hover(q, q.$('#cc-board .cc-me [data-face="flesh"]'));
  assert.ok(!visible(q.$("#cc-tip")));
});

test("悬停预览：不挡出牌——预览不接鼠标，开着时照样点这张牌出牌，出掉就收起；不是出牌的时候（下注、翻天气）手里的牌也能看、操作栏照常；克制表、结算横幅盖上来、离开牌桌时收起", () => {
  const p = page();
  const game = heatGame(p, "不挡出牌");
  const tip = p.$("#cc-tip");
  assert.match(read("counter-cards.css"), /\.cc-tip\s*\{[^}]*pointer-events:\s*none/, "预览不接鼠标：点到的还是底下的牌和按钮");
  hover(p, handCard(p, "fire"));
  assert.ok(visible(tip));
  click(handCard(p, "fire"));
  assert.equal(game.sides.player.card, "fire", "照常出牌");
  assert.ok(!visible(tip), "这张牌出掉了，预览收起");
  // 下注的时候：手里的牌点不了，也能看；开着时照常下注
  assert.equal(game.stage, "bet1");
  assert.ok(!handCard(p, "ice").matches("button"));
  hover(p, handCard(p, "ice"));
  assert.ok(visible(tip) && tip.dataset.card === "ice");
  betThrough(p, game, "bet1");
  assert.equal(game.stage, "weather", "下注栏照常");
  assert.ok(visible(tip), "还开着");
  // 克制表盖上来：收起
  click(p.$('#cc-side [data-cc="chart"]'));
  assert.ok(p.UI.chartOpen());
  assert.ok(!visible(tip), "开克制表时收起");
  click(p.$("#mu-overlay [data-mu-close]"));
  // 结算横幅盖上来：收起
  hover(p, handCard(p, "ice"));
  assert.ok(visible(tip));
  click(p.$('#cc-actions [data-cc="reveal"]'));
  if (game.stage === "normal") click(p.$('#cc-actions [data-cc="noNormal"]'));
  betThrough(p, game, "bet2");
  assert.ok(visible(p.$("#cc-banner")), "这一轮结算了");
  assert.ok(!visible(tip), "结算横幅盖上来就收起");
  // 离开牌桌：收起
  click(p.$('#cc-banner [data-cc="dismiss"]'));
  hover(p, handCard(p, "ice"));
  assert.ok(visible(tip));
  click(p.$('#cc-top [data-cc="title"]'));
  assert.ok(!visible(tip), "回到标题就收起");
});

test("手机长按：按住手里的元素牌一会儿弹出预览，松手不会把牌出掉（这一下不算点击）；预览留着看，手指碰别处（触屏电脑上换成鼠标挪到别处）就收起；再点一下这张牌照常出牌；系统的长按菜单不弹", async () => {
  const p = page();
  const game = heatGame(p, "长按");
  const tip = p.$("#cc-tip"), ms = p.UI.UI_CONFIG.tip.pressMs;
  assert.ok(ms >= 300 && ms <= 700, "按住多久算长按：" + ms);
  finger(p, handCard(p, "fire"), "touchstart", 50, 50);
  assert.ok(!visible(tip), "刚按下去不弹");
  await wait(ms + 80);
  assert.ok(visible(tip), "按住一会儿弹出预览");
  assert.equal(tip.dataset.card, "fire");
  assert.deepEqual(tipScores(p), ["+1", "−1", "0", "0", "−1"]);
  assert.ok(fireEv(p, handCard(p, "fire"), "contextmenu").defaultPrevented, "不弹系统的长按菜单");
  const up = finger(p, handCard(p, "fire"), "touchend");
  assert.ok(up.defaultPrevented, "长按松手：取消默认动作，浏览器就不会再补一下点击");
  click(handCard(p, "fire"));   // 万一浏览器还是补了一下点击
  assert.equal(game.sides.player.card, null, "长按不会把牌出掉");
  assert.ok(visible(tip), "松手以后预览留着");
  // 手指碰别处：收起
  finger(p, p.$("#cc-board .cc-deck"), "touchstart", 10, 10);
  assert.ok(!visible(tip), "手指碰别处就收起");
  finger(p, p.$("#cc-board .cc-deck"), "touchend");
  // 触屏电脑：长按弹出以后换成用鼠标，挪到别处也收起
  finger(p, handCard(p, "fire"), "touchstart", 50, 50);
  await wait(ms + 80);
  finger(p, handCard(p, "fire"), "touchend");
  assert.ok(visible(tip));
  hover(p, p.$("#cc-board .cc-deck"));
  assert.ok(!visible(tip), "换成鼠标挪到别处也收起");
  // 再长按一下，松手后轻点这张牌：照常出牌
  finger(p, handCard(p, "fire"), "touchstart", 50, 50);
  await wait(ms + 80);
  finger(p, handCard(p, "fire"), "touchend");
  assert.ok(visible(tip));
  finger(p, handCard(p, "fire"), "touchstart", 50, 50);
  assert.ok(!finger(p, handCard(p, "fire"), "touchend").defaultPrevented, "轻点不拦");
  click(handCard(p, "fire"));
  assert.equal(game.sides.player.card, "fire", "预览开着也照常出牌");
  assert.ok(!visible(tip), "出掉了就收起");
});

test("手机长按：轻点照常出牌、不弹预览；按住时手指挪开（在滑动页面）不算长按", async () => {
  const p = page();
  const game = heatGame(p, "轻点");
  const tip = p.$("#cc-tip"), ms = p.UI.UI_CONFIG.tip.pressMs;
  finger(p, handCard(p, "acid"), "touchstart", 50, 50);
  finger(p, handCard(p, "acid"), "touchmove", 50, 90);
  await wait(ms + 80);
  assert.ok(!visible(tip), "手指挪开了：不算长按");
  finger(p, handCard(p, "acid"), "touchend");
  finger(p, handCard(p, "ice"), "touchstart", 50, 50);
  assert.ok(!finger(p, handCard(p, "ice"), "touchend").defaultPrevented);
  click(handCard(p, "ice"));
  assert.equal(game.sides.player.card, "ice", "轻点照常出牌");
  await wait(ms + 80);
  assert.ok(!visible(tip), "轻点不弹预览");
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
  test(`真浏览器（${vp.tag}）：标题 → 本地玩法 → High Flux，和 AI 打完一局，没有报错、没有横向溢出`, async (t) => {
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
    assert.equal(await page.textContent("#cc-setup .cc-title"), "High Flux");
    await page.click('[data-cc="set"][data-key="level"][data-val="hard"]');
    await page.click('[data-cc="start"]');
    await page.waitForSelector("#cc-game:not([hidden])");
    assert.equal(await page.textContent("#cc-top .cc-brand"), "High Flux");
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

/* 克制表（真浏览器）：没装 Playwright 时用机器自带的 Chrome（tests/cdp-browser.js，同 pause-menu.test.js），都没有才跳过 */
let cdp = null, cdpWhy = "";
async function chartBrowser() {
  if (browser) return browser;
  if (!cdp && !cdpWhy) {
    try {
      cdp = await require("./cdp-browser").launch();
      if (!cdp) cdpWhy = "没装 Playwright，也没有能用的 Chrome，跳过画面测试";
    } catch (e) { cdpWhy = "浏览器启动失败，跳过画面测试：" + String(e.message).split("\n")[0]; }
  }
  return cdp;
}
test.after(async () => { if (cdp) await cdp.close(); });
/** 量一下开着的克制表（在页面里跑）：卡片在不在屏幕里、表要不要左右滑、「关闭」在不在屏幕里、焦点在哪、挂在哪、天气底纹 */
function measureChart() {
  const box = document.getElementById("mu-overlay"), card = box && box.querySelector(".mu-card");
  if (!card || box.hidden) return null;
  const r = card.getBoundingClientRect(), scroll = card.querySelector(".mu-scroll"), c = card.querySelector("[data-mu-close]").getBoundingClientRect();
  return { left: r.left, right: r.right, vw: innerWidth, slide: scroll.scrollWidth - scroll.clientWidth, cells: card.querySelectorAll("[data-mu-cell]").length,
    closeIn: c.top >= 0 && c.bottom <= innerHeight && c.left >= 0 && c.right <= innerWidth,
    focus: !!document.activeElement && document.activeElement.hasAttribute("data-mu-close"), parent: box.parentNode.id,
    texture: getComputedStyle(card, "::before").opacity, weather: card.querySelector(".mu-weather").textContent };
}

for (const vp of [{ width: 1400, height: 900, tag: "桌面" }, { width: 390, height: 844, tag: "手机 390px" }]) {
  test(`真浏览器（${vp.tag}）：牌局中打开完整克制表——顶栏「菜单」→「克制表」、侧栏的按钮；表在屏幕里放得下、不用左右滑，Esc / 「关闭」关得掉，不动牌局`, { timeout: 120000 }, async (t) => {
    const b = await chartBrowser();
    if (!b) { t.skip(cdpWhy || skipWhy); return; }
    const context = await b.newContext({ viewport: { width: vp.width, height: vp.height } });
    await require("./old-screen")(context);
    t.after(() => context.close());
    const page = await context.newPage(), errors = [], T = { timeout: 20000 };
    page.on("pageerror", e => errors.push(e.message));
    const game = () => page.evaluate(() => JSON.stringify(CounterCardsUI.state().game));
    await page.goto(GAME_URL);
    await page.click("#t-local", T);
    await page.click("#t-cc", T);
    await page.waitForSelector("#cc-setup:not([hidden])", T);
    await page.click('[data-cc="start"]', T);
    await page.waitForSelector("#cc-game:not([hidden])", T);
    await page.evaluate(() => CounterCardsUI.setFast(true));   // 庄家（AI）先走完，轮到人出牌
    const before = await game();
    // 1. 和平时一样：顶栏最前面的「菜单」→ 暂停菜单 →「克制表」
    await page.click("#cc-top [data-pause-open]", T);
    await page.waitForSelector("#pm-overlay", Object.assign({ state: "visible" }, T));
    await page.click('#pm-overlay [data-pause-item="matchupCC"]', T);
    await page.waitForSelector("#mu-overlay .mu-card.mu-score", T);
    let m = await page.evaluate(measureChart);
    assert.equal(m.parent, "cc-game", "挂在牌桌下");
    assert.equal(m.cells, 35);
    assert.ok(m.left >= -1 && m.right <= m.vw + 1, `卡片在屏幕里：${m.left}–${m.right} / ${m.vw}`);
    assert.ok(m.slide <= 1, `表不用左右滑（多出 ${m.slide}px）`);
    assert.ok(m.closeIn, "「关闭」在屏幕里");
    assert.ok(m.focus, "键盘焦点在「关闭」上");
    // 2. Esc 关掉；这一下只关克制表，不接着开暂停菜单
    await page.keyboard.press("Escape");
    await page.waitForSelector("#mu-overlay", Object.assign({ state: "hidden" }, T));
    await page.waitForTimeout(150);
    assert.equal(await page.isVisible("#pm-overlay"), false, "Esc 只关克制表");
    assert.equal(await game(), before, "开关克制表不动牌局");
    // 3. 场上有天气：侧栏的按钮（手机上排在牌桌下面）打开，卡片套上天气底纹；天气改过的「原 → 现」也放得下
    await page.evaluate(() => { CounterCardsUI.stop(); CounterCardsUI.state().game.weather = "acid"; CounterCardsUI.render(); });
    const before2 = await game();
    await page.click('#cc-side [data-cc="chart"]', T);
    await page.waitForSelector("#mu-overlay .mu-card", T);
    m = await page.evaluate(measureChart);
    assert.equal(m.weather, "天气 酸雨");
    assert.equal(m.texture, "1", "卡片套上酸雨的底纹");
    assert.ok(m.slide <= 1, `酸雨（28 格「原 → 现」）也不用左右滑（多出 ${m.slide}px）`);
    assert.ok(m.left >= -1 && m.right <= m.vw + 1 && m.closeIn);
    await page.click("#mu-overlay [data-mu-close]", T);
    await page.waitForSelector("#mu-overlay", Object.assign({ state: "hidden" }, T));
    assert.equal(await game(), before2, "开关克制表不动牌局");
    const overflow = await page.evaluate(() => document.getElementById("scr-cc").scrollWidth - innerWidth);
    assert.ok(overflow <= 1, "牌桌没有横向溢出（顶栏多了「菜单」）：" + overflow + "px");
    assert.deepEqual(errors, []);
  });
}

/* 结算前的过渡（真浏览器，#499）：同上，没装 Playwright 时用机器自带的 Chrome，都没有才跳过 */
/** 人当玩家，走到第二轮下注、轮到人（同上面 Node 里的 bet2Game；在页面里跑）；两段各停 ms（机器忙时也来得及量） */
function settleSetup(o) {
  const g = CounterCards.newGame({ seed: o.seed, deck: ["heat", "glow", "acid", "thunder", "snow", "sand", "phase"] });
  const A = (side, type, extra) => CounterCards.act(g, side, Object.assign({ type }, extra || {}));
  A("dealer", "weather", { op: "pass" }); A("dealer", "play", { card: "flesh" }); A("player", "play", { card: "fire" });
  A("player", "check"); A("dealer", "check"); A("player", "reveal"); if (g.stage === "normal") A("player", "noNormal"); A("dealer", "check");
  Object.assign(CounterCardsUI.UI_CONFIG.settle, { lastMs: o.ms, judgeMs: o.ms });
  CounterCardsUI.start({ side: "player", level: "normal", game: g });
}
/** 量一下过渡（在页面里跑）：到了哪一段、操作栏写什么、座位上的标签和「判定中」在不在牌桌里、「判定中」压没压到底池（手机上底池就在正上方）、
 *  横幅出没出来、有没有横向溢出 */
function measureSettle() {
  const st = CounterCardsUI.state(), q = (s) => document.querySelector(s), table = q(".cc-table").getBoundingClientRect();
  const inside = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= Math.max(0, table.left) - 1 && r.right <= Math.min(innerWidth, table.right) + 1 && r.top >= table.top - 1 && r.bottom <= table.bottom + 1; };
  const judge = q("#cc-board .cc-judge"), j = judge && judge.getBoundingClientRect(), pot = q("#cc-board .cc-pot").getBoundingClientRect();
  return { phase: st.settle ? st.settle.phase : null, banner: !q("#cc-banner").hidden, prompt: q("#cc-actions .cc-prompt").textContent,
    acted: (q("#cc-board .cc-acted") || {}).textContent || "", actedIn: inside(q("#cc-board .cc-acted")), judgeIn: inside(judge),
    judgeClear: !!j && (j.top >= pot.bottom - 1 || j.bottom <= pot.top + 1 || j.left >= pot.right - 1 || j.right <= pot.left + 1),
    collect: !!q("#cc-board .cc-me .cc-chips.cc-collect"), overflow: q("#scr-cc").scrollWidth - innerWidth };
}

for (const vp of [{ width: 1400, height: 900, tag: "桌面" }, { width: 390, height: 844, tag: "手机 390px" }]) {
  test(`真浏览器（${vp.tag}）：结算前的过渡——最后一步（操作栏写着、座位上标着）→ 判定中（标签在牌桌里）→ 结算横幅（赢家的筹码收进来），没有横向溢出；点一下桌面直接看结算`, { timeout: 120000 }, async (t) => {
    const b = await chartBrowser();
    if (!b) { t.skip(cdpWhy || skipWhy); return; }
    const context = await b.newContext({ viewport: { width: vp.width, height: vp.height } });
    await require("./old-screen")(context);
    t.after(() => context.close());
    const page = await context.newPage(), errors = [], T = { timeout: 20000 };
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(GAME_URL);
    await page.evaluate(settleSetup, { seed: "过渡-真浏览器", ms: 2500 });
    await page.click('#cc-actions [data-cc="check"]', T);
    const m1 = await page.evaluate(measureSettle);
    assert.deepEqual([m1.phase, m1.banner, m1.prompt, m1.acted], ["last", false, "你过牌。", "过牌"], "① 最后一步：" + JSON.stringify(m1));
    assert.ok(m1.actedIn, "座位上的标签在牌桌里、在屏幕里");
    await page.waitForSelector("#cc-board .cc-judge", T);
    const m2 = await page.evaluate(measureSettle);
    assert.deepEqual([m2.phase, m2.banner], ["judge", false], "② 判定中");
    assert.match(m2.prompt, /^判定中/);
    assert.ok(m2.judgeIn, "「判定中」在牌桌里、在屏幕里");
    assert.ok(m2.judgeClear, "「判定中」不压到底池");
    await page.waitForSelector("#cc-banner:not([hidden])", T);
    const m3 = await page.evaluate(measureSettle);
    assert.deepEqual([m3.phase, m3.banner, m3.collect], [null, true, true], "③ 结算横幅，赢家的筹码收进来");
    for (const m of [m1, m2, m3]) assert.ok(m.overflow <= 1, "没有横向溢出：" + m.overflow + "px");
    // 点一下桌面：直接看结算（两段各停 2.5 秒，不跳过的话 1 秒内等不到横幅）
    await page.evaluate(settleSetup, { seed: "过渡-跳过", ms: 2500 });
    await page.click('#cc-actions [data-cc="check"]', T);
    await page.click("#cc-board .cc-deck", T);
    await page.waitForSelector("#cc-banner:not([hidden])", { timeout: 1000 });
    assert.deepEqual(errors, []);
  });
}

/* 悬停预览（真浏览器）：同上，没装 Playwright 时用机器自带的 Chrome，都没有才跳过 */
/** 手指按下 / 抬起：Playwright 没有长按，直接发 Chrome 调试协议的触摸事件（备用浏览器 tests/cdp-browser.js 有 page.send；Playwright 开一个 CDP 会话） */
async function touchAt(page, type, x, y) {
  const params = { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }] };
  if (typeof page.send === "function") return page.send("Input.dispatchTouchEvent", params);
  if (!page.__ccCdp) page.__ccCdp = await page.context().newCDPSession(page);
  return page.__ccCdp.send("Input.dispatchTouchEvent", params);
}
/** 量一下预览（在页面里跑）：开没开、写的哪张牌、分数（和规则层的 cardChart 对照）、在不在屏幕里、盖没盖住手牌、牌的中心点到的是不是这张牌 */
function measureTip(face) {
  const tip = document.getElementById("cc-tip"), card = document.querySelector(`#cc-board .cc-me [data-face="${face}"]`);
  if (!tip || !card) return null;
  const r = tip.getBoundingClientRect(), c = card.getBoundingClientRect(), h = card.parentNode.getBoundingClientRect();
  const hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
  return { shown: !tip.hidden && r.width > 0 && r.height > 0, card: tip.dataset.card, weather: tip.dataset.weather,
    scores: [...tip.querySelectorAll("[data-layer] b")].map(b => b.textContent),
    want: CounterCards.cardChart(face, CounterCardsUI.view().weather).cells.map(x => (x.value > 0 ? "+" + x.value : x.value < 0 ? "−" + -x.value : "0")),
    left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight, handTop: h.top, handBottom: h.bottom,
    hit: !!hit && card.contains(hit), pe: getComputedStyle(tip).pointerEvents };
}
function checkTip(m, where) {
  assert.ok(m && m.shown, where + "：预览开着");
  assert.equal(m.card, "fire", where);
  assert.deepEqual(m.scores, m.want, where + "：和规则层（克制表那一行）同一份数");
  assert.ok(m.left >= 0 && m.right <= m.vw && m.top >= 0 && m.bottom <= m.vh, `${where}：在屏幕里 ${JSON.stringify(m)}`);
  assert.ok(m.bottom <= m.handTop + 1, `${where}：摆在手牌上面，不盖住手牌 ${JSON.stringify(m)}`);
  assert.ok(m.hit, where + "：牌的中心点到的还是这张牌");
  assert.equal(m.pe, "none", where + "：预览不接鼠标");
}

for (const vp of [{ width: 1400, height: 900, tag: "桌面" }, { width: 390, height: 844, tag: "手机 390px", mobile: true }]) {
  test(`真浏览器（${vp.tag}）：${vp.mobile ? "长按" : "鼠标停在"}手里的元素牌上弹出得分预览——在屏幕里、摆在手牌上面，不挡出牌（${vp.mobile ? "松手不出牌，再点一下照常出牌" : "移开收起；停着照样点得到这张牌，出掉就收起；天气变了跟着变"}）`, { timeout: 120000 }, async (t) => {
    const b = await chartBrowser();
    if (!b) { t.skip(cdpWhy || skipWhy); return; }
    const context = await b.newContext(Object.assign({ viewport: { width: vp.width, height: vp.height } }, vp.mobile ? { isMobile: true, hasTouch: true } : {}));
    await require("./old-screen")(context);
    t.after(() => context.close());
    const page = await context.newPage(), errors = [], T = { timeout: 20000 };
    page.on("pageerror", e => errors.push(e.message));
    await page.emulateMedia({ reducedMotion: "reduce" });   // 不放发牌动画：量位置时牌已经在手里
    await page.goto(GAME_URL);
    await page.evaluate(() => { CounterCardsUI.start({ side: "player", level: "normal", seed: "预览", fast: true }); });   // 庄家（AI）走完，轮到人出牌
    const sel = '#cc-board .cc-me [data-face="fire"]', played = () => page.evaluate(() => CounterCardsUI.state().game.sides.player.card);
    await page.waitForSelector('#cc-board button.cc-can[data-card="fire"]', T);
    if (vp.mobile) {
      const c = await page.evaluate(s => { const el = document.querySelector(s); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
      await page.waitForTimeout(150);
      await touchAt(page, "touchStart", c.x, c.y);   // 「刚按下去不弹」在上面 Node 里那条查（这里机器忙时等的时间不准）
      await page.waitForTimeout(900);
      checkTip(await page.evaluate(measureTip, "fire"), "按住");
      await touchAt(page, "touchEnd");
      await page.waitForTimeout(500);
      assert.equal(await played(), null, "长按松手不出牌");
      checkTip(await page.evaluate(measureTip, "fire"), "松手以后预览留着");
      await page.tap(sel, T);
      await page.waitForFunction(() => CounterCardsUI.state().game.sides.player.card === "fire", null, T);
    } else {
      await page.hover(sel, T);
      await page.waitForSelector("#cc-tip", Object.assign({ state: "visible" }, T));
      checkTip(await page.evaluate(measureTip, "fire"), "鼠标停着");
      await page.evaluate(() => { CounterCardsUI.state().game.weather = "glow"; CounterCardsUI.render(); });
      const g = await page.evaluate(measureTip, "fire");
      checkTip(g, "天气变成微光");
      assert.deepEqual([g.weather, g.scores], ["glow", ["−1", "+1", "0", "0", "+1"]], "微光：克制关系反转");
      await page.mouse.move(4, 4);
      await page.waitForSelector("#cc-tip", Object.assign({ state: "hidden" }, T));
      await page.hover(sel, T);
      await page.waitForSelector("#cc-tip", Object.assign({ state: "visible" }, T));
      await page.click(sel, T);
      await page.waitForFunction(() => CounterCardsUI.state().game.sides.player.card === "fire", null, T);
    }
    await page.waitForSelector("#cc-tip", Object.assign({ state: "hidden" }, T));
    const overflow = await page.evaluate(() => document.getElementById("scr-cc").scrollWidth - innerWidth);
    assert.ok(overflow <= 1, "牌桌没有横向溢出：" + overflow + "px");
    assert.deepEqual(errors, []);
  });
}

/* 跟注后的追加窗口（#496，真浏览器）：同上，没装 Playwright 时用机器自带的 Chrome，都没有才跳过 */
/** 量一下操作栏（在页面里跑）：窗口开没开、倒计时的数字、倒计时 / 进度条 / 「加注」「弃牌」「不加注」的位置，牌桌有没有横向溢出 */
function measureWindow() {
  const bar = document.getElementById("cc-actions"), g = CounterCardsUI.state().game;
  const box = (sel) => { const el = bar.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height }; };
  const count = bar.querySelector(".cc-count");
  return { stage: g.stage, open: !!(g.betting && g.betting.window), count: count ? count.textContent : null,
    clock: box(".cc-clock"), bar: box(".cc-winbar i"), raise: box('[data-cc="raise"]'), fold: box('[data-cc="fold"]'), pass: box('[data-cc="pass"]'),
    vw: innerWidth, overflow: document.getElementById("scr-cc").scrollWidth - innerWidth };
}
/** 人当玩家，轮到人跟注庄家的 1 枚（同上面 Node 里的 windowGame，庄家 AI 在窗口里不追加） */
function windowSetup() {
  const CC = CounterCards, A = (g, side, type, extra) => CC.act(g, side, Object.assign({ type }, extra || {}));
  const g = CC.newGame({ seed: "窗口栏", deck: ["thunder", "sand", "glow", "heat", "snow", "acid", "phase"] });
  A(g, "dealer", "weather", { op: "pass" });
  A(g, "dealer", "play", { card: "flesh" }); A(g, "player", "play", { card: "ice" });
  A(g, "player", "check"); A(g, "dealer", "bet", { amount: 1 });
  CounterCardsUI.start({ side: "player", level: "normal", game: g, seed: "窗口栏", fast: true });
}

for (const vp of [{ width: 1400, height: 900, tag: "桌面" }, { width: 390, height: 844, tag: "手机 390px", mobile: true }]) {
  test(`真浏览器（${vp.tag}）：跟注后的追加窗口——倒计时从 3 秒数起、进度条在缩短，「加注」「弃牌」「不加注」都在屏幕里${vp.mobile ? "点得到（点「加注」照常加注）" : ""}，不横向溢出；倒计时结束自动进入下一步`, { timeout: 120000 }, async (t) => {
    const b = await chartBrowser();
    if (!b) { t.skip(cdpWhy || skipWhy); return; }
    const context = await b.newContext(Object.assign({ viewport: { width: vp.width, height: vp.height } }, vp.mobile ? { isMobile: true, hasTouch: true } : {}));
    await require("./old-screen")(context);
    t.after(() => context.close());
    const page = await context.newPage(), errors = [], T = { timeout: 20000 };
    page.on("pageerror", e => errors.push(e.message));
    const press = (sel) => (vp.mobile ? page.tap(sel, T) : page.click(sel, T));
    await page.goto(GAME_URL);
    await page.evaluate(windowSetup);
    await press('#cc-actions [data-cc="call"]');
    await page.waitForSelector("#cc-actions .cc-count", T);
    const m = await page.evaluate(measureWindow);
    assert.ok(m.open && m.count === "3", "跟注后开了窗口，从 3 秒数起：" + JSON.stringify(m));
    for (const k of ["clock", "raise", "fold", "pass"]) assert.ok(m[k] && m[k].width > 0 && m[k].left >= 0 && m[k].right <= m.vw, `${k} 在屏幕里：${JSON.stringify(m[k])} / ${m.vw}`);
    assert.ok(m.overflow <= 1, "牌桌没有横向溢出：" + m.overflow + "px");
    await page.waitForTimeout(1200);
    const m2 = await page.evaluate(measureWindow);
    assert.ok(m2.open && Number(m2.count) < 3, "数字在少：" + m2.count);
    assert.ok(m2.bar.width < m.bar.width - 1, `进度条在缩短：${m.bar.width} → ${m2.bar.width}`);
    await page.waitForFunction(() => CounterCardsUI.state().game.stage === "weather", null, T);
    assert.equal(await page.evaluate(() => !!document.querySelector("#cc-actions .cc-count")), false, "到时间：自动进入翻天气，倒计时收起");
    if (vp.mobile) {
      // 再开一局：窗口里点「加注」
      await page.evaluate(windowSetup);
      await press('#cc-actions [data-cc="call"]');
      await page.waitForSelector('#cc-actions [data-cc="raise"]', T);
      await press('#cc-actions [data-cc="raise"]');
      await page.waitForFunction(() => CounterCardsUI.state().game.log.some(e => e.t === "bet" && e.op === "raise" && e.by === "player" && e.window), null, T);
    }
    assert.deepEqual(errors, []);
  });
}

/* 手机竖屏：操作栏固定在屏幕底部（主人 10/30 试玩反馈，#499 第 3 项；真浏览器，同上没装 Playwright 时用机器自带的 Chrome，都没有才跳过） */
/** 量一下（在页面里跑）：操作栏怎么定位、贴没贴在屏幕底部，里面每个按钮 / 倒计时的位置，牌桌、侧栏的位置，滚到哪了 */
function measureDock() {
  const scr = document.getElementById("scr-cc"), bar = document.getElementById("cc-actions");
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width }; };
  const items = [...bar.querySelectorAll("button[data-cc], .cc-clock")].map(el => Object.assign({ what: el.dataset.cc || "倒计时" }, box(el)));
  return { vw: innerWidth, vh: innerHeight, scroll: scr.scrollTop, maxScroll: scr.scrollHeight - scr.clientHeight, pos: getComputedStyle(bar).position,
    bar: box(bar), table: box(document.querySelector("#scr-cc .cc-table")), side: box(document.getElementById("cc-side")), items, overflow: scr.scrollWidth - innerWidth };
}
/** 操作栏里不在屏幕里的按钮 / 倒计时 */
const offScreen = (m) => m.items.filter(x => !(x.width > 0 && x.top >= -1 && x.bottom <= m.vh + 1 && x.left >= -1 && x.right <= m.vw + 1)).map(x => x.what);
const scrollCc = (page, to) => page.evaluate((y) => { const s = document.getElementById("scr-cc"); s.scrollTop = y === "end" ? s.scrollHeight : y; }, to);

for (const vp of [{ width: 390, height: 844, tag: "手机 390×844", mobile: true }, { width: 1400, height: 900, tag: "桌面" }]) {
  test(`真浏览器（${vp.tag}）：${vp.mobile ? "手机竖屏操作栏固定在屏幕底部（#499 第 3 项）——下注时（两行按钮）、追加窗口里（倒计时、加注、弃牌、不加注）所有按钮都在第一屏，不用滚动；往下滑也一直在底部；滑到最底下牌桌、侧栏都露得出来，不被操作栏挡住" : "电脑上操作栏照旧排在牌桌下面，不贴底"}`, { timeout: 120000 }, async (t) => {
    const b = await chartBrowser();
    if (!b) { t.skip(cdpWhy || skipWhy); return; }
    const context = await b.newContext(Object.assign({ viewport: { width: vp.width, height: vp.height } }, vp.mobile ? { isMobile: true, hasTouch: true } : {}));
    await require("./old-screen")(context);
    t.after(() => context.close());
    const page = await context.newPage(), errors = [], T = { timeout: 20000 };
    page.on("pageerror", e => errors.push(e.message));
    await page.emulateMedia({ reducedMotion: "reduce" });   // 不放发牌动画：量位置时牌已经在桌上
    await page.goto(GAME_URL);
    await page.evaluate(windowSetup);   // 下注：庄家下注 1 枚，轮到人跟注 / 加注 / 弃牌（两行按钮）
    await page.waitForSelector('#cc-actions [data-cc="fold"]', T);
    const bet = await page.evaluate(measureDock);
    if (!vp.mobile) {
      assert.equal(bet.pos, "static", "电脑上不贴底");
      assert.ok(bet.bar.top >= bet.table.bottom, "照旧排在牌桌下面：" + JSON.stringify(bet));
      assert.deepEqual(errors, []);
      return;
    }
    assert.equal(bet.scroll, 0, "第一屏");
    assert.deepEqual(bet.items.map(x => x.what).filter(w => w !== "amt"), ["call", "raise", "fold"]);
    assert.deepEqual(offScreen(bet), [], "下注时所有按钮都在第一屏：" + JSON.stringify(bet));
    assert.ok(Math.abs(bet.bar.bottom - bet.vh) <= 1, "操作栏贴在屏幕底部：" + JSON.stringify(bet.bar));
    // 追加窗口：倒计时和按钮都在第一屏
    await page.evaluate(() => document.querySelector('#cc-actions [data-cc="call"]').click());
    await page.waitForSelector("#cc-actions .cc-count", T);
    const win = await page.evaluate(measureDock);
    assert.equal(win.scroll, 0, "第一屏");
    assert.deepEqual(win.items.map(x => x.what).filter(w => w !== "amt"), ["倒计时", "raise", "fold", "pass"]);
    assert.deepEqual(offScreen(win), [], "追加窗口：倒计时和所有按钮都在第一屏：" + JSON.stringify(win));
    assert.ok(Math.abs(win.bar.bottom - win.vh) <= 1, "操作栏贴在屏幕底部：" + JSON.stringify(win.bar));
    assert.ok(win.maxScroll > 0, "牌桌加侧栏比一屏高，要滚动（不然量不出贴底）");
    // 往下滑一半（看侧栏）：操作栏还在底部，按钮照样点得到
    await scrollCc(page, Math.round(win.maxScroll / 2));
    const mid = await page.evaluate(measureDock);
    assert.ok(mid.scroll > 0 && Math.abs(mid.bar.bottom - mid.vh) <= 1, "往下滑了操作栏还在底部：" + JSON.stringify(mid));
    assert.deepEqual(offScreen(mid), []);
    // 滑到最底下：侧栏、牌桌都在操作栏上面露出来（操作栏在排版里有自己的位置，不会一直挡着最后那一截）
    await scrollCc(page, "end");
    const end = await page.evaluate(measureDock);
    assert.ok(end.scroll >= end.maxScroll - 1, "滑到底了");
    assert.ok(end.side.bottom <= end.bar.top + 1 && end.table.bottom <= end.bar.top + 1, "最底下：侧栏、牌桌都在操作栏上面：" + JSON.stringify(end));
    assert.ok(Math.abs(end.bar.bottom - end.vh) <= 1);
    for (const m of [bet, win, mid, end]) assert.ok(m.overflow <= 1, "没有横向溢出：" + m.overflow + "px");
    // 窗口里点「不加注」照常（点得到：在屏幕里的那个位置真的是这个按钮）
    await scrollCc(page, 0);
    const hit = await page.evaluate(() => { const el = document.querySelector('#cc-actions [data-cc="pass"]'), r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); });
    assert.ok(hit, "「不加注」没被别的东西盖住");
    await page.tap('#cc-actions [data-cc="pass"]', T);
    await page.waitForFunction(() => CounterCardsUI.state().game.stage === "weather", null, T);
    assert.deepEqual(errors, []);
  });
}
