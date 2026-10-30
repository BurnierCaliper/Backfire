// High Flux 黑市玩法：猜大猜小（#489）· 界面 counter-cards-guess-ui.js：标题「本地玩法」里的入口、选桌（入场费 / 最低注 × 倍率）、
// 牌桌（庄家三张牌盖着、赔率表 5 格写赔率和 k / N、不开盘的格子点不了）、点格子攒押注 → 一次交上去 → 翻牌、押过的注按锁定的赔率摆在格子上、
// 第一轮不押直接结算（入场费不退）、结算横幅、一手接一手筹码带过去、交不起入场费只能重新坐下；相位的天气牌写猜大猜小自己的规则；
// 侧栏的记录、每手结算按先后排，最新的在最下面，记录有新的时滚到底（#499）。
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

/** game.html 的 <body> 解析进小 DOM，加载猜大猜小要的脚本（计分要 engine.js；牌面借 counter-cards-ui.js） */
function page() {
  const html = read("game.html"), body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const P = MD.create(body, { media: (q) => /prefers-reduced-motion: reduce/.test(q) });
  const ctx = vm.createContext(P.window);
  ["engine.js", "icons.js", "weather-fx.js", "counter-cards.js", "counter-cards-ui.js", "counter-cards-guess.js", "counter-cards-guess-ui.js"]
    .forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const doc = P.document;
  return { w: P.window, doc, $: (s) => doc.querySelector(s), $$: (s) => Array.from(doc.querySelectorAll(s)), UI: P.window.CounterCardsGuessUI, G: P.window.CounterCardsGuess, CC: P.window.CounterCards };
}
const click = (el) => { assert.ok(el, "要点的东西不在"); el.click(); };
const visible = (el) => !!el && !el.hidden;
const cell = (p, r) => p.$(`#ccg-board .ccg-cell[data-result="${r}"]`);
const btn = (p, act) => p.$(`#ccg-actions [data-ccg="${act}"]`);
const oddsTexts = (p) => p.$$("#ccg-board .ccg-cell .ccg-x").map(x => x.textContent);
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

test("标题「本地玩法」里有猜大猜小的入口，点进去是设置页（选桌：入场费、每格最低注 × 倍率），坐下开一手", () => {
  const p = page();
  const entry = p.$("#t-panel-local #t-ccg");
  assert.ok(entry, "本地玩法里有入口");
  assert.match(entry.textContent, /猜大猜小/);
  click(entry);
  assert.ok(visible(p.$("#scr-ccg")));
  assert.ok(visible(p.$("#ccg-setup")));
  assert.ok(!visible(p.$("#ccg-game")));
  assert.equal(p.doc.body.dataset.screen, "guess");
  const setup = p.$("#ccg-setup").textContent;
  assert.match(setup, /High Flux · 猜大猜小/);
  assert.match(setup, /街边桌/); assert.match(setup, /入场费 2 枚 · 每格最低注 2 \/ 4 \/ 8/);
  assert.match(setup, /里屋/); assert.match(setup, /入场费 10 枚 · 每格最低注 10 \/ 20 \/ 40/);
  assert.match(setup, /坐下拿 50 枚筹码/);
  assert.match(p.$("#ccg-setup .cc-rules").textContent, /32\/35 × N ÷ k/);
  click(p.$('[data-ccg="set"][data-table="backroom"]'));
  assert.equal(p.$('[data-ccg="set"][data-table="backroom"]').getAttribute("aria-pressed"), "true");
  click(p.$('[data-ccg="start"]'));
  assert.ok(visible(p.$("#ccg-game")));
  assert.ok(!visible(p.$("#ccg-setup")));
  const st = p.UI.state();
  assert.equal(st.table, "backroom");
  assert.equal(st.hand.players[0].chips, 40, "50 枚减入场费 10");
  assert.match(p.$("#ccg-top").textContent, /里屋/);
});

test("牌桌：庄家的三张牌都盖着（牌背，画面里没有牌面）；赔率表 5 格写第一轮的赔率（连本带利）和 k / N；筹码扣了入场费", () => {
  const p = page();
  p.UI.start({ table: "street", seed: "ui", deals: [{ element: "harmonic", weather: "glow", layer: "spirit" }] });
  const slots = p.$$("#ccg-board .ccg-slot");
  assert.deepEqual(slots.map(s => s.dataset.slot), ["element", "weather", "layer"]);
  slots.forEach(s => { assert.ok(s.querySelector(".cc-back"), "盖着"); assert.ok(!s.querySelector("[data-face],[data-weather]"), "没有牌面"); });
  const board = p.$("#ccg-board").textContent;
  ["谐波", "微光", "星灵"].forEach(n => assert.ok(!board.includes(n), "桌上看不到没翻开的牌：" + n));
  assert.deepEqual(oddsTexts(p), ["×8", "×3.5", "×2", "×4.5", "×18"]);
  assert.deepEqual(p.$$("#ccg-board .ccg-k").map(x => x.textContent), ["27 / 245 种", "62 / 245 种", "95 / 245 种", "49 / 245 种", "12 / 245 种"]);
  assert.match(p.$("#ccg-board .cc-chips b").textContent, /^48$/);
  assert.match(p.$("#ccg-actions").textContent, /第 1 轮下注/);
  assert.match(p.$("#ccg-actions").textContent, /第一轮不押，这一手后面都不能再押/);
  // 还没点格子：押注按钮点不了
  assert.ok(btn(p, "bet").disabled);
});

test("押注：点格子加进这一轮（默认最低注，− / + 调），「押注」一次交上去 → 翻开元素；押过的注按锁定的赔率摆在格子上；第二轮每格至少 4 枚", () => {
  const p = page();
  p.UI.start({ seed: "ui2", deals: [{ element: "fire", weather: "heat", layer: "flesh" }] });
  click(cell(p, 0));
  assert.equal(cell(p, 0).getAttribute("aria-pressed"), "true");
  const line = p.$("#ccg-actions .ccg-line");
  assert.ok(line);
  assert.equal(line.querySelector(".cc-amt").textContent, "2");
  click(line.querySelector('[data-ccg="amt"][data-d="1"]'));
  assert.equal(p.$("#ccg-actions .ccg-line .cc-amt").textContent, "3");
  click(cell(p, -1));
  assert.equal(p.$$("#ccg-actions .ccg-line").length, 2);
  click(p.$('#ccg-actions .ccg-line [data-ccg="pick"][data-result="-1"]'));   // ✕：这一格不押了
  assert.equal(p.$$("#ccg-actions .ccg-line").length, 1);
  assert.match(btn(p, "bet").textContent, /押注 3 枚/);
  click(btn(p, "bet"));
  const h = p.UI.state().hand;
  assert.equal(h.stage, "bet2");
  assert.deepEqual(J(h.players[0].slips), [{ round: 1, result: 0, amount: 3, odds: 2 }]);
  // 翻开元素：第一张亮出来，另外两张还盖着
  assert.ok(p.$('#ccg-board .ccg-slot[data-slot="element"] [data-face="fire"]'));
  assert.ok(p.$('#ccg-board .ccg-slot[data-slot="element"] .cc-flip'), "翻牌动画");
  assert.ok(p.$('#ccg-board .ccg-slot[data-slot="weather"] .cc-back'));
  assert.ok(p.$('#ccg-board .ccg-slot[data-slot="layer"] .cc-back'));
  assert.deepEqual(oddsTexts(p), ["×6", "×3", "×2.5", "×5", "×16"], "第二轮：火这一行");
  assert.match(cell(p, 0).querySelector(".ccg-slip").textContent, /3 枚 ×2/, "第一轮押的按第一轮的赔率锁定");
  assert.match(p.$("#ccg-board .cc-chips b").textContent, /^45$/);
  click(cell(p, 1));
  assert.equal(p.$("#ccg-actions .ccg-line .cc-amt").textContent, "4", "第二轮最低注 4");
  assert.ok(p.$('#ccg-actions .ccg-line [data-ccg="amt"][data-d="-1"]').disabled, "不能低于最低注");
});

test("不开盘的格子点不了：冰第二轮的 +2 写「不开」", () => {
  const p = page();
  p.UI.start({ seed: "ui3", deals: [{ element: "ice", weather: "snow", layer: "armor" }] });
  click(cell(p, 2));
  click(btn(p, "bet"));
  const c2 = cell(p, 2);
  assert.equal(c2.tagName.toLowerCase(), "div", "不是按钮");
  assert.ok(c2.classList.contains("closed"));
  assert.match(c2.textContent, /不开/);
  assert.match(c2.textContent, /0 \/ 35 种/);
  assert.equal(c2.querySelector(".ccg-slip").textContent, "2 枚 ×18", "第一轮押的 +2 还摆着");
});

test("第一轮不押：这一手直接翻完结算（入场费不退）；横幅写结果、三张牌和净输赢；再来一手又扣入场费", () => {
  const p = page();
  const deal = { element: "electric", weather: "phase", layer: "shield" };
  p.UI.start({ seed: "ui4", deals: [deal] });
  assert.match(btn(p, "pass").textContent, /不押（这一手不玩了）/);
  click(btn(p, "pass"));
  const banner = p.$("#ccg-banner");
  assert.ok(visible(banner));
  const score = p.G.outcome(deal.element, deal.layer, deal.weather);
  assert.match(banner.textContent, new RegExp("结果 " + p.G.label(score).replace("+", "\\+")));
  assert.match(banner.textContent, /这一手你没押/);
  assert.match(banner.textContent, /这一手 −2 枚/);
  assert.match(banner.textContent, /手上 48 枚/);
  assert.ok(banner.querySelector('[data-face="electric"]') && banner.querySelector('[data-weather="phase"]') && banner.querySelector('[data-face="shield"]'));
  assert.match(banner.textContent, /克制分 ×2/, "相位：猜大猜小只把克制分翻倍");
  assert.ok(!banner.textContent.includes("全押"), "不是 High Flux 的相位全押");
  assert.ok(p.$("#ccg-board .ccg-cell.hit"), "赔率表标出结果那一格");
  click(banner.querySelector('[data-ccg="again"]'));
  assert.ok(!visible(p.$("#ccg-banner")));
  const st = p.UI.state();
  assert.equal(st.n, 2);
  assert.equal(st.hand.players[0].chips, 46);
  assert.equal(st.hand.stage, "bet1");
  assert.equal(p.$$("#ccg-board .ccg-slot .cc-back").length, 3, "新的一手三张又盖上");
  assert.match(p.$("#ccg-side").textContent, /第 1 手/);
});

test("一手接一手随便押：画面上的筹码、押注和规则层一致；输到交不起入场费只能重新坐下", () => {
  const p = page();
  const r = rng(7);
  p.UI.start({ seed: "ui5", chips: 30 });
  let hands = 0;
  for (let guard = 0; guard < 2000; guard++) {
    const st = p.UI.state();
    const banner = p.$("#ccg-banner");
    if (visible(banner)) {
      hands++;
      assert.match(banner.textContent, new RegExp("手上 " + st.chips + " 枚"));
      const again = banner.querySelector('[data-ccg="again"]');
      if (again.disabled || hands >= 40) break;
      click(again);
      continue;
    }
    const v = p.UI.view();
    assert.equal(p.$("#ccg-board .cc-chips b").textContent, String(v.me.chips));
    const cells = p.$$("#ccg-board button.ccg-cell");
    if (!cells.length || r() < 0.15) { click(btn(p, "pass")); continue; }
    const n = 1 + Math.floor(r() * Math.min(2, cells.length));
    for (let i = 0; i < n; i++) { const c = cells[Math.floor(r() * cells.length)]; if (c.getAttribute("aria-pressed") !== "true") click(c); }
    const plus = p.$('#ccg-actions .ccg-line [data-ccg="amt"][data-d="1"]');
    if (plus && !plus.disabled && r() < 0.5) click(plus);
    const b = btn(p, "bet");
    if (b && !b.disabled) click(b); else click(btn(p, "pass"));
  }
  assert.ok(hands >= 2, "至少打完两手");
  const st = p.UI.state();
  st.history.forEach(x => assert.ok(Number.isInteger(x.net)));
  if (st.chips < 2) {
    const banner = p.$("#ccg-banner");
    assert.ok(banner.querySelector('[data-ccg="again"]').disabled, "交不起入场费：再来一手点不了");
    click(banner.querySelector('[data-ccg="setup"]'));
    assert.ok(visible(p.$("#ccg-setup")));
  }
});

/** 小 DOM 不排版：给侧栏的记录列表一个假的高度（每条 30px、框高 100px），量滚动位置照浏览器的样子来（同 tests/counter-cards-ui.test.js）；
 *  元素的类是所有页面共用的，用完一定要 stop() */
function fakeLogBox(p) {
  const proto = p.w.Element.prototype, log = (el) => el.classList.contains("cc-log");
  const fake = { scrollHeight() { return log(this) ? this.children.length * 30 : 0; }, clientHeight() { return log(this) ? 100 : 0; } };
  const saved = {};
  Object.keys(fake).forEach(k => { saved[k] = Object.getOwnPropertyDescriptor(proto, k); Object.defineProperty(proto, k, { get: fake[k], configurable: true }); });
  return { stop: () => Object.keys(saved).forEach(k => Object.defineProperty(proto, k, saved[k])) };
}

test("侧栏的记录（主人 10/30，#499，做法同 High Flux）：按时间顺序排，最新的一条在最下面；有新记录时滚到底，往上翻着看旧的就停在原处；「每手结算」也按先后排，第 1 手在上面", (t) => {
  const p = page();
  const box = fakeLogBox(p);
  t.after(box.stop);
  const N = p.UI.UI_CONFIG.logLines;
  const list = () => p.$("#ccg-side .cc-log");
  const texts = () => Array.from(list().querySelectorAll("li"), li => li.textContent);
  const want = () => Array.from(p.UI.view().log.slice(-N), e => e.text);   // 页面里的数组先转成这边的
  const atBottom = () => list().scrollHeight - list().scrollTop - list().clientHeight <= 0;
  const betOne = () => { click(p.$("#ccg-board button.ccg-cell")); click(btn(p, "bet")); };   // 押开盘的第一格
  const deal = { element: "fire", weather: "heat", layer: "flesh" };
  p.UI.start({ table: "street", seed: "记录顺序", deals: [deal, deal] });
  assert.deepEqual(texts(), want());
  // 第 1 手：押两轮
  betOne();
  assert.deepEqual(texts(), want(), "按时间顺序：先发生的在上面");
  assert.match(texts()[0], /^街边桌：庄家抽了一张元素、一张天气、一张层牌/, "最早的一条在最上面");
  assert.equal(texts()[texts().length - 1], "翻开元素：火。", "最新的一条在最下面");
  betOne();
  assert.deepEqual(texts(), want());
  assert.equal(texts()[texts().length - 1], "翻开天气：酷暑。");
  assert.ok(list().scrollHeight > list().clientHeight + 24, "记录多到要滚动了：" + texts().length + " 条");
  assert.ok(atBottom(), "有新记录：滚到底");
  // 往上翻着看旧的：重画、来了新记录都停在原处，不强行拉回去
  list().scrollTop = 20;
  p.UI.render();
  assert.equal(list().scrollTop, 20, "重画：停在原处");
  const before = p.UI.view().log.length;
  click(btn(p, "pass"));   // 第三轮不押：翻开层牌、结算
  assert.ok(p.UI.view().log.length > before, "来了新记录");
  assert.deepEqual(texts(), want());
  assert.match(texts()[texts().length - 1], /拿回|没押中/, "最后一条是这一手的输赢");
  assert.equal(list().scrollTop, 20, "往上翻着：不拉回最底下");
  // 第 2 手：记录换成这一手的；在底部时新记录来了接着贴底
  click(p.$('#ccg-banner [data-ccg="again"]'));
  assert.deepEqual(texts(), want());
  betOne(); betOne();
  assert.deepEqual(texts(), want());
  assert.ok(atBottom(), "新的一手：照样贴底");
  list().scrollTop = list().scrollHeight - list().clientHeight;   // 自己翻回最底下
  click(btn(p, "pass"));
  assert.deepEqual(texts(), want());
  assert.ok(atBottom(), "在底部：新记录来了接着贴底");
  assert.ok(texts().length <= N, `最多显示最近 ${N} 条`);
  // 每手结算：第 1 手在上面，最新的一手在最下面（以前最新的在最上面）
  assert.deepEqual(p.$$("#ccg-side .cc-results .cc-res > b").map(b => b.textContent), ["第 1 手", "第 2 手"]);
});

test("回到标题：牌桌收起，标题露出来", () => {
  const p = page();
  p.UI.start({ seed: "ui6" });
  click(p.$('#ccg-top [data-ccg="title"]'));
  assert.ok(!visible(p.$("#scr-ccg")));
  assert.ok(visible(p.$("#scr-title")));
  assert.equal(p.doc.body.dataset.screen, "title");
});
