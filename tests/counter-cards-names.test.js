// High Flux（#509）· 层牌、元素牌的名字只有一份：直接读 engine.js 的 LAYER / ELE（和战斗里一致；战斗里改名，牌桌跟着变），
// CC_CONFIG.cardNames 只留常态这类牌桌专用的名字。以前 cardNames 另写了一份层名「血肉 / 沙 / 灵体」，和战斗里的「肉体 / 沙尘 / 星灵」对不上。
// 规则层（克制表、悬停预览、整局记录、猜大猜小）用 tests/headless.js；画面（High Flux 牌桌、猜大猜小、赌场、联机赌场浮层）用 tests/mini-dom.js
// 跑 game.html 的真页面结构（同 tests/counter-cards-ui.test.js），每一步都查整块画面里有没有以前的层名
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const H = require("./headless");
const MD = require("./mini-dom");

const ROOT = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const J = v => JSON.parse(JSON.stringify(v));
const where = (w) => w || "没有天气";
/** 以前 CC_CONFIG.cardNames 另写的层名：「血肉」「灵体」不能再出现，「沙」只能是「沙尘」「沙暴」的一部分 */
const OLD = /血肉|灵体|沙(?![尘暴])/;
function noOld(text, at) {
  const s = String(text), m = s.match(OLD);
  assert.ok(!m, m ? `${at}出现了以前的层名「${m[0]}」：……${s.slice(Math.max(0, m.index - 40), m.index + 40)}……` : "");
}

/** 规则环境：整套规则（含 engine.js 的 LAYER / ELE），再加载 High Flux、AI、猜大猜小 */
function rules() {
  const c = H.load();
  ["counter-cards.js", "counter-cards-ai.js", "counter-cards-guess.js"].forEach(f => vm.runInContext(read(f), c, { filename: f }));
  return { c, CC: c.CounterCards, C: J(c.CounterCards.CC_CONFIG), AI: c.CounterCardsAI, G: c.CounterCardsGuess,
    LAYER: J(vm.runInContext("LAYER", c)), ELE: J(vm.runInContext("ELE", c)) };
}

test("牌名只有一份（#509）：每张层牌、元素牌的名字都等于 engine.js 的 LAYER / ELE（层牌是肉体、装甲、护盾、沙尘、星灵），CC_CONFIG.cardNames 只留常态；克制表、悬停预览也是这一份，战斗里改名牌桌跟着变", () => {
  const { c, CC, C, LAYER, ELE } = rules();
  const layers = C.layers.map(k => LAYER[k]), elements = C.elements.map(k => ELE[k]);
  assert.deepEqual(layers, ["肉体", "装甲", "护盾", "沙尘", "星灵"], "战斗里的正式名（engine.js · LAYER）");
  assert.deepEqual(C.layers.map(k => CC.cardName(k)), layers, "层牌的名字就是 LAYER 里的");
  assert.deepEqual(C.elements.map(k => CC.cardName(k)), elements, "元素牌的名字就是 ELE 里的");
  assert.deepEqual(Object.keys(C.cardNames), [C.normal], "cardNames 不再另写层名、元素名，只留常态这类牌桌专用的");
  assert.equal(CC.cardName(C.normal), "常态");
  for (const w of [null].concat(C.weathers)) {
    const ch = J(CC.chart(w));
    assert.deepEqual(ch.cols.map(x => x.name), layers, `克制表的列头（${where(w)}）`);
    assert.deepEqual(ch.rows.map(x => x.name), elements, `克制表的行头（${where(w)}）`);
    noOld(JSON.stringify(ch), `克制表（${where(w)}）`);
    C.elements.forEach(el => assert.deepEqual(J(CC.cardChart(el, w)).cells.map(x => x.name), layers, `悬停预览（${ELE[el]} · ${where(w)}）`));
  }
  // 战斗里改名（改 engine.js 的 LAYER / ELE）：牌桌上的名字跟着变，规则层没有另存一份
  vm.runInContext('LAYER.spirit = "改过的层名"; ELE.harmonic = "改过的元素名";', c);
  assert.equal(CC.cardName("spirit"), "改过的层名");
  assert.equal(CC.cardName("harmonic"), "改过的元素名");
  assert.equal(CC.chart(null).cols[C.layers.indexOf("spirit")].name, "改过的层名", "克制表跟着变");
  assert.equal(CC.cardChart("harmonic", null).name, "改过的元素名", "悬停预览跟着变");
});

test("牌名（#509）：整局的记录（自己暗出了哪张牌）、猜大猜小的翻牌和结算都写 LAYER / ELE 的名字，没有以前的「血肉」「沙」「灵体」", () => {
  const { CC, C, AI, G, LAYER, ELE } = rules();
  for (const seed of ["牌名-1", "牌名-2", "牌名-3"]) {
    const g = CC.newGame({ seed });
    AI.playOut(g, { dealer: "hard", player: "normal" });
    const dv = J(CC.view(g, "dealer")), pv = J(CC.view(g, "player"));
    noOld(dv.log.map(e => e.text).join("\n"), `庄家的记录（${seed}）`);
    noOld(pv.log.map(e => e.text).join("\n"), `玩家的记录（${seed}）`);
    dv.me.history.forEach(h => assert.ok(dv.log.some(e => e.text === `你暗出了〔${LAYER[h.card]}〕。`), `庄家的记录写着暗出了〔${LAYER[h.card]}〕（${seed}）`));
    pv.me.history.forEach(h => assert.ok(pv.log.some(e => e.text === `你暗出了〔${ELE[h.card]}〕。`), `玩家的记录写着暗出了〔${ELE[h.card]}〕（${seed}）`));
  }
  // 猜大猜小：翻开层牌、结算写的是 LAYER 的名字；层牌沙尘和天气沙暴写在一起也分得清
  C.layers.forEach(ly => {
    const h = G.newHand({ seed: "牌名-" + ly, players: [{ id: "p1", name: "你", chips: 50 }], deal: { element: "harmonic", weather: "sand", layer: ly } });
    G.act(h, "p1", { type: "pass" });
    const log = J(G.view(h, "p1").log).map(e => e.text);
    assert.ok(log.includes(`翻开层牌：${LAYER[ly]}。`), log.join(" / "));
    assert.ok(log.some(t => t.startsWith(`结果：${ELE.harmonic}打${LAYER[ly]}，天气沙暴——`)), log.join(" / "));
    noOld(log.join("\n"), `猜大猜小的记录（${LAYER[ly]}）`);
  });
});

/* ---------- 画面 ---------- */
/** game.html 的 <body> 解析进小 DOM，照 game.html 的先后加载 High Flux 的规则和画面（牌桌、猜大猜小、赌场、联机赌场浮层；克制表浮层、暂停菜单）。
 *  页面开着「减少动态效果」：雷鸣、酸雨的特效是一直自己排下一次的定时器，同 tests/counter-cards-ui.test.js */
function page() {
  const html = read("game.html"), body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const P = MD.create(body, { media: (q) => /prefers-reduced-motion: reduce/.test(q) });
  const ctx = vm.createContext(P.window);
  ["engine.js", "counter-cards.js", "counter-cards-ai.js", "counter-cards-guess.js", "casino.js", "icons.js", "weather-fx.js", "pause-menu.js", "matchup-ui.js",
    "counter-cards-ui.js", "counter-cards-guess-ui.js", "casino-ui.js", "casino-online-ui.js"].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const doc = P.document, w = P.window;
  return { w, doc, $: (s) => doc.querySelector(s), $$: (s) => Array.from(doc.querySelectorAll(s)), CC: w.CounterCards, C: J(w.CounterCards.CC_CONFIG),
    UI: w.CounterCardsUI, GUI: w.CounterCardsGuessUI, K: w.Casino, KUI: w.CasinoUI, OUI: w.CasinoOnlineUI,
    LAYER: J(vm.runInContext("LAYER", ctx)), ELE: J(vm.runInContext("ELE", ctx)) };
}
const click = (el) => { assert.ok(el, "要点的东西不在"); el.click(); };
const visible = (el) => !!el && !el.hidden;
const hover = (p, el) => { assert.ok(el, "要停的牌不在"); el.dispatchEvent(new p.w.Event("pointerover", { bubbles: true, pointerType: "mouse" })); };
/** High Flux 牌桌上一直点到这一局结束（有结算横幅点「继续」；能出的牌先出，过牌 / 跟注 / 不加注 / 借，没有就点主按钮），每点一下之前 check() 一次 */
function playAll(p, check) {
  for (let guard = 0; guard < 500; guard++) {
    check();
    const banner = p.$("#cc-banner");
    if (visible(banner)) {
      if (banner.querySelector(".cc-final")) return;
      click(banner.querySelector('[data-cc="dismiss"]'));
      continue;
    }
    if (p.UI.state().game.over) { p.UI.render(); continue; }
    const card = p.$("#cc-board button.cc-can");
    if (card) { click(card); continue; }
    const btns = p.$$("#cc-actions button[data-cc]").filter(b => !b.disabled && b.dataset.cc !== "amt");
    assert.ok(btns.length, "没有能点的按钮：" + p.UI.state().game.stage);
    click(btns.find(b => ["check", "call", "pass", "borrow"].includes(b.dataset.cc)) || btns.find(b => b.classList.contains("primary")) || btns[0]);
  }
  assert.fail("点了 500 下还没打完");
}

test("牌名（#509）· High Flux 牌桌：规则说明、两边的手牌、桌上自己暗出的牌、记录、克制表（8 种天气）、悬停预览里的层名 / 元素名都是 LAYER / ELE 的；整个牌桌没有「血肉」「灵体」，「沙」只在「沙尘」「沙暴」里", () => {
  const p = page(), { CC, C, LAYER, ELE } = p;
  const layers = C.layers.map(k => LAYER[k]), elements = C.elements.map(k => ELE[k]);
  const screen = () => p.$("#scr-cc").innerHTML;
  // 设置页：规则说明里列出的牌
  click(p.$("#t-cc"));
  const rules = p.$("#cc-setup .cc-rules").textContent;
  assert.ok(rules.includes(`庄家 ${C.layers.length} 张层牌（${layers.join("、")}）`), rules);
  assert.ok(rules.includes(`玩家 ${C.elements.length} 张元素牌（${elements.join("、")}）`), rules);
  noOld(screen(), "设置页");
  // 两边各打完一局：开局手里的牌就是 LAYER / ELE 的名字；每点一下都查整个牌桌（顶栏、牌桌、操作栏、侧栏的规则 / 记录、结算横幅、总结算）
  for (const side of ["dealer", "player"]) {
    const who = side === "dealer" ? "庄家" : "玩家", names = side === "dealer" ? LAYER : ELE;
    p.UI.start({ side, level: "hard", seed: "牌名-" + side, fast: true });
    const hand = p.$$("#cc-board .cc-me .cc-hand [data-face]").map(x => [x.dataset.face, x.querySelector(".cc-corner").textContent, x.querySelector(".cc-name").textContent]);
    const want = (side === "dealer" ? C.layers : C.elements).map(k => [k, names[k], names[k]]).concat(side === "player" ? [[C.normal, "常态", "常态"]] : []);
    assert.deepEqual(hand, want, `人当${who}：开局手里的牌`);
    const logs = new Set();
    playAll(p, () => {
      const g = p.UI.state().game, mine = g.sides[side].card, peek = p.$("#cc-board .cc-peek b");
      if (mine && peek) assert.equal(peek.textContent, names[mine], `人当${who}：桌上自己暗出的那张`);
      p.$$("#cc-side .cc-log li").forEach(li => logs.add(li.textContent));
      noOld(screen(), `人当${who}的牌桌（第 ${g.round} 轮 · ${g.stage}）`);
    });
    noOld(screen(), `人当${who}的总结算`);
    J(p.UI.state().game.sides[side].history).forEach(h => assert.ok(logs.has(`你暗出了〔${names[h.card]}〕。`), `人当${who}：记录里写着暗出了〔${names[h.card]}〕`));
  }
  // 克制表（8 种天气）：列头、行头、点开一格的原因；悬停预览：五种层的名字
  const game = CC.newGame({ seed: "牌名-表", deck: ["heat", "snow", "acid", "thunder", "glow", "sand", "phase"] });
  CC.act(game, "dealer", { type: "weather", op: "pass" });
  CC.act(game, "dealer", { type: "play", card: "sand" });
  p.UI.start({ side: "player", level: "normal", game, fast: true });
  const fire = C.elements.indexOf("fire");
  for (const w of [null].concat(C.weathers)) {
    game.weather = w; p.UI.render();
    click(p.$('#cc-side [data-cc="chart"]'));
    const box = p.$("#mu-overlay");
    assert.deepEqual(p.$$("#mu-overlay th.mu-col").map(x => x.textContent), layers, `克制表的列头（${where(w)}）`);
    assert.deepEqual(p.$$("#mu-overlay th.mu-row span").map(x => x.textContent), elements, `克制表的行头（${where(w)}）`);
    C.layers.forEach((ly, j) => {
      click(box.querySelector(`[data-mu-cell="${fire}:${j}"]`));
      assert.equal(box.querySelector(".mu-detail b").textContent, `${ELE.fire} → ${LAYER[ly]}`, `克制表点开一格（${where(w)}）`);
      noOld(screen(), `克制表（${where(w)}，点开 ${ELE.fire} → ${LAYER[ly]}）`);
    });
    click(box.querySelector("[data-mu-close]"));
    C.elements.forEach(el => {
      hover(p, p.$(`#cc-board .cc-me [data-face="${el}"]`));
      assert.deepEqual(p.$$("#cc-tip .cc-tip-name").map(x => x.textContent), layers, `悬停预览（${ELE[el]} · ${where(w)}）`);
      noOld(p.$("#cc-tip").innerHTML, `悬停预览（${ELE[el]} · ${where(w)}）`);
    });
    noOld(screen(), `牌桌（${where(w)}）`);
  }
});

test("牌名（#509）· 猜大猜小、赌场、联机赌场浮层：翻开的层牌、结算、手里的牌写的都是 LAYER / ELE 的名字；这些画面里也没有以前的层名", () => {
  const p = page(), { CC, C, LAYER, ELE } = p;
  // 猜大猜小：五种层牌各翻一手（天气都是沙暴：层牌沙尘和天气沙暴写在一起也分得清）
  click(p.$("#t-ccg"));
  noOld(p.$("#scr-ccg").innerHTML, "猜大猜小的设置页");
  p.GUI.start({ table: "street", seed: "牌名", deals: C.layers.map(layer => ({ element: "harmonic", weather: "sand", layer })), fast: true });   // fast：结算前不停（#525 的过渡）
  C.layers.forEach((ly, i) => {
    noOld(p.$("#scr-ccg").innerHTML, `猜大猜小第 ${i + 1} 手（三张盖着）`);
    click(p.$('#ccg-actions [data-ccg="pass"]'));
    const banner = p.$("#ccg-banner");
    assert.ok(visible(banner), "结算横幅");
    assert.ok(banner.textContent.includes(`${ELE.harmonic}打${LAYER[ly]} · 天气沙暴`), banner.textContent);
    assert.equal(p.$('#ccg-board .ccg-slot[data-slot="layer"] .cc-name').textContent, LAYER[ly], "桌上翻开的层牌");
    assert.ok(p.$("#ccg-side .cc-log").textContent.includes(`翻开层牌：${LAYER[ly]}。`), "记录里写着翻开了哪张层牌");
    noOld(p.$("#scr-ccg").innerHTML, `猜大猜小第 ${i + 1} 手（结算：${LAYER[ly]}）`);
    if (i < C.layers.length - 1) click(banner.querySelector('[data-ccg="again"]'));
  });
  // 赌场（长线养成 / 本机跑团的面板 casino-ui.js）：坐下以后是 High Flux 牌桌的赌场模式，打完一局
  const K = p.K, wallet = K.wallet(null), box = p.doc.createElement("div");
  K.welcome(wallet);
  p.doc.body.appendChild(box);
  const adapter = {
    view: () => ({ chips: K.chips(wallet), sellable: K.sellable(wallet), kuizhi: 0, tables: K.tables(), buy: K.CONFIG.buy, sell: K.CONFIG.sell, game: wallet.seat ? wallet.seat.game : null }),
    buy: () => [], sell: () => [],
    sit: (t, b) => { K.sit(wallet, t, b, { seed: "牌名-赌场" }); return []; },
    leave: () => [K.leave(wallet).text], saved: () => {},
    refresh: () => { box.innerHTML = p.KUI.html(adapter.view()); }, back: () => adapter.refresh()
  };
  box.addEventListener("click", e => p.KUI.handle(e, adapter));
  adapter.refresh();
  noOld(box.innerHTML, "赌场面板");
  click(box.querySelector('[data-casino="sit"][data-table="alley"]'));
  assert.ok(p.UI.state().casino, "坐下进了牌桌的赌场模式");
  p.UI.setFast(true);
  playAll(p, () => noOld(p.$("#scr-cc").innerHTML, `赌场的牌桌（第 ${p.UI.state().game.round} 轮 · ${p.UI.state().game.stage}）`));
  // 联机跑团的赌场（#526 起牌桌用本机那张画：CounterCardsUI.remote，casino-online-ui.js 打开）：主持人坐庄那一桌手里的层牌、自己暗出的那张；玩家那一方手里的元素牌
  const g = CC.newGame({ seed: "牌名-联机" });
  CC.act(g, "dealer", { type: "weather", op: "pass" });
  const remote = (side) => {
    p.UI.remote({ view: () => J(CC.view(g, side)), act: () => Promise.resolve({ ok: true }), back() {}, label: "联机", who: side === "dealer" ? "对手：瑞比" : "庄家：主持人", oppTag: side === "dealer" ? "瑞比" : "主持人" });
    return p.$("#scr-cc").innerHTML;
  };
  const face = (c) => p.$(`#cc-board .cc-me [data-face="${c}"] .cc-name`).textContent;
  let h = remote("dealer");
  C.layers.forEach(ly => assert.equal(face(ly), LAYER[ly], `主持人手里的〔${LAYER[ly]}〕`));
  noOld(h, "联机赌场的牌桌（主持人坐庄）");
  CC.act(g, "dealer", { type: "play", card: "sand" });
  h = remote("dealer");
  assert.ok(p.$("#cc-board .cc-slots .cc-peek").textContent.includes(LAYER.sand), "主持人看得到自己暗出的那张");
  noOld(h, "联机赌场的牌桌（主持人暗出以后）");
  h = remote("player");
  C.elements.forEach(el => assert.equal(face(el), ELE[el], `玩家手里的〔${ELE[el]}〕`));
  noOld(h, "联机赌场的牌桌（玩家那一方）");
  p.UI.remoteClose();
});
