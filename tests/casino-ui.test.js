// 赌场界面（#487）：casino-ui.js 的面板（钱包、兑换、桌子、坐着的这一局）和 High Flux 牌桌的赌场模式
// （counter-cards-ui.js：顶栏「离桌」、总结算「再来一局 / 离桌」、每走一步交给模式存档）；长线养成的任务板接进来（rogue-ui.js）。
// Node 里用 tests/mini-dom.js 跑 game.html 的真页面结构（同 tests/counter-cards-ui.test.js）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const MD = require("./mini-dom");

const ROOT = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const PHASE_FIRST = ["phase", "heat", "snow", "acid", "thunder", "sand", "glow"];

function page() {
  const html = read("game.html"), body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const P = MD.create(body, { media: (q) => /prefers-reduced-motion: reduce/.test(q) });
  const ctx = vm.createContext(P.window);
  ["engine.js", "icons.js", "weather-fx.js", "pause-menu.js", "matchup-ui.js", "counter-cards.js", "counter-cards-ai.js", "casino.js", "counter-cards-ui.js", "casino-ui.js"]
    .forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const doc = P.document;
  return { w: P.window, doc, $: (s) => doc.querySelector(s), $$: (s) => doc.querySelectorAll(s), UI: P.window.CounterCardsUI, K: P.window.Casino };
}
const click = (el) => { assert.ok(el, "要点的东西不在"); el.click(); };
const visible = (el) => !!el && !el.hidden;

/** 一个最简单的模式：钱包是一个对象、奎支是一个数，面板画在一个 div 里（长线养成 / 跑团各自的 adapter 照这个样子） */
function mode(p, opt) {
  opt = opt || {};
  const K = p.K;
  const m = { w: K.wallet(null), kuizhi: opt.kuizhi != null ? opt.kuizhi : 1000, saves: 0, backs: 0, box: p.doc.createElement("div") };
  K.welcome(m.w);
  p.doc.body.appendChild(m.box);
  m.adapter = {
    view: () => ({ chips: K.chips(m.w), sellable: K.sellable(m.w), kuizhi: m.kuizhi, tables: K.tables(), buy: K.CONFIG.buy, sell: K.CONFIG.sell, game: m.w.seat ? m.w.seat.game : null }),
    buy: (n) => { const r = K.buy(m.w, n, m.kuizhi); m.kuizhi -= r.cost; return [r.text]; },
    sell: (n) => { const r = K.sell(m.w, n); m.kuizhi += r.gain; return [r.text]; },
    sit: (t, b) => { K.sit(m.w, t, b, { deck: opt.deck }); return [`坐上 ${t}`]; },
    leave: () => [K.leave(m.w).text],
    saved: () => { m.saves++; },
    refresh: () => { m.box.innerHTML = p.w.CasinoUI.html(m.adapter.view()); },
    back: () => { m.backs++; m.adapter.refresh(); }
  };
  m.box.addEventListener("click", e => p.w.CasinoUI.handle(e, m.adapter));
  m.adapter.refresh();
  m.$ = (s) => m.box.querySelector(s);
  return m;
}
/** 牌桌上一直点到这一局结束（同 tests/counter-cards-ui.test.js 的 playThrough：有横幅点「继续」，能出的牌、主按钮依次点） */
function playThrough(p) {
  for (let guard = 0; guard < 400; guard++) {
    const banner = p.$("#cc-banner");
    if (visible(banner)) {
      if (banner.querySelector(".cc-final")) return;
      click(banner.querySelector('[data-cc="dismiss"]'));
      continue;
    }
    if (p.UI.state().game.over) { p.UI.render(); continue; }
    const card = p.$("#cc-board button.cc-can");
    if (card) { click(card); continue; }
    const btns = Array.from(p.$$("#cc-actions button[data-cc]")).filter(b => !b.disabled && b.dataset.cc !== "amt");
    assert.ok(btns.length, "没有能点的按钮：" + p.UI.state().game.stage);
    click(btns.find(b => b.dataset.cc === "check" || b.dataset.cc === "call") || btns.find(b => b.classList.contains("primary")) || btns[0]);
  }
  assert.fail("点了 400 下还没打完");
}

test("面板：钱包（赠送 / 普通 / 能卖几枚）、兑换价、三张桌子（倍率、最低买入和入场费折成钱包几枚、庄家难度）", () => {
  const p = page(), m = mode(p);
  const t = m.box.textContent;
  assert.match(t, /筹码 50 枚/);
  assert.match(t, /赠送 50（只能下注）/);
  assert.match(t, /普通 0（能卖 0 枚）/);
  assert.match(t, /奎支 1000/);
  assert.match(t, /买筹码（每枚 200 奎支）/);
  assert.match(t, /卖筹码（每枚 190 奎支）/);
  assert.ok(m.$('[data-casino="sell"]').disabled, "没有能卖的：卖的按钮灰着");
  assert.match(m.$('[data-casino="sell"]').getAttribute("title"), /赠送的筹码不能换成奎支/);
  const alley = m.$('.cs-table[data-table="alley"]').textContent;
  assert.match(alley, /后巷小桌/);
  assert.match(alley, /庄家：简单 AI/);
  assert.match(alley, /桌上每枚 10 奎支（钱包 1 枚 = 桌上 20 枚）/);
  assert.match(alley, /最低买入 20 枚（1 枚筹码）/);
  assert.match(alley, /入场费 2 枚（0\.1 枚筹码，每局一次）/);
  assert.match(m.$('.cs-table[data-table="vip"]').textContent, /入场费 2 枚（2 枚筹码，每局一次）/);
  assert.equal(m.$('[data-casino-buyin="hall"]').value, "30", "买入默认填最低买入");
  // 赠送的 50 枚不够贵宾室的最低买入 + 入场费（52 枚）：按钮灰着写要多少
  const vip = m.$('[data-casino="sit"][data-table="vip"]');
  assert.ok(vip.disabled);
  assert.match(vip.textContent, /筹码不够（要 52 枚）/);
  assert.match(t, /赠送筹码只能下注、不能换成奎支；输的先扣赠送筹码，赢来的都是普通筹码/);
});

test("兑换按钮：填几枚买几枚、卖几枚；奎支不够写原因，钱包和奎支都不动", () => {
  const p = page(), m = mode(p);
  m.$('[data-casino-n="buy"]').value = "3";
  click(m.$('[data-casino="buy"]'));
  assert.equal(m.kuizhi, 400);
  assert.match(m.box.textContent, /买了 3 枚筹码，花掉 600 奎支/);
  assert.match(m.box.textContent, /普通 3（能卖 3 枚）/);
  m.$('[data-casino-n="buy"]').value = "3";
  click(m.$('[data-casino="buy"]'));
  assert.match(m.box.textContent, /奎支不够：买 3 枚筹码要 600 奎支，现有 400/);
  assert.equal(m.kuizhi, 400);
  m.$('[data-casino-n="sell"]').value = "2";
  click(m.$('[data-casino="sell"]'));
  assert.equal(m.kuizhi, 780);
  assert.match(m.box.textContent, /卖了 2 枚筹码，得 380 奎支/);
  assert.equal(p.K.chips(m.w).gift, 50, "赠送的不动");
});

test("坐下 → 牌桌是赌场模式：人坐玩家、庄家是这张桌子难度的 AI；顶栏写桌子和「离桌」，没有换边 / 换难度 / 回到标题；每走一步交给模式存档", () => {
  const p = page(), m = mode(p, { deck: PHASE_FIRST });
  m.$('[data-casino-buyin="hall"]').value = "40";
  click(m.$('[data-casino="sit"][data-table="hall"]'));
  const st = p.UI.state();
  assert.ok(st, "牌桌开了");
  assert.equal(st.game, m.w.seat.game, "打的就是钱包里坐着的这一局");
  assert.equal(st.human, "player");
  assert.equal(st.level, "normal", "大厅的庄家是普通 AI");
  assert.ok(visible(p.$("#cc-game")));
  const top = p.$("#cc-top");
  assert.match(top.textContent, /大厅 · 买入 40 枚/);
  assert.match(top.textContent, /庄家：普通 AI/);
  assert.ok(top.querySelector('[data-cc="leave"]'), "顶栏有「离桌」");
  assert.ok(!top.querySelector('[data-cc="setup"]') && !top.querySelector('[data-cc="title"]'), "赌场桌不能换边 / 换难度，也没有「回到标题」");
  p.UI.setFast(true);
  const before = m.saves;
  playThrough(p);
  assert.ok(m.saves > before, "牌局每走一步都叫模式存档");
  const fin = p.$("#cc-banner .cc-final");
  assert.ok(fin.querySelector('[data-cc="casinoAgain"]'), "总结算有「再来一局」");
  assert.match(fin.querySelector('[data-cc="casinoAgain"]').textContent, /再来一局（买入 40 枚 \+ 入场费 2 枚）/);
  assert.ok(fin.querySelector('[data-cc="leave"]'), "总结算有「离桌」");
  for (const a of ["again", "swap", "setup", "title"]) assert.ok(!fin.querySelector(`[data-cc="${a}"]`), "赌场桌的总结算没有 " + a);
});

test("离桌：结算回钱包、回到模式的画面；再来一局：同一张桌子同样买入、再交入场费；筹码不够就回到面板写原因", () => {
  const p = page(), m = mode(p, { deck: PHASE_FIRST });
  m.$('[data-casino-buyin="hall"]').value = "40";
  click(m.$('[data-casino="sit"][data-table="hall"]'));
  p.UI.setFast(true);
  playThrough(p);
  const g1 = m.w.seat.game;
  const giftBefore = p.K.chips(m.w);
  click(p.$('#cc-banner [data-cc="casinoAgain"]'));
  assert.ok(m.w.seat && m.w.seat.game !== g1, "同一张桌子开了新的一局");
  assert.equal(m.w.seat.table, "hall"); assert.equal(m.w.seat.buyIn, 40);
  assert.equal(p.UI.state().game, m.w.seat.game);
  assert.ok(p.K.chips(m.w).total < giftBefore.total + (g1.final.chips.player * 50 / 200), "再交了一次入场费、再押了买入");
  // 打到一半离桌
  click(p.$('#cc-top [data-cc="leave"]'));
  assert.equal(m.w.seat, null, "离桌结算");
  assert.equal(m.backs, 1, "回到模式的画面");
  assert.match(m.box.textContent, /离开大厅：桌上剩/);
  // 钱不够再来一局：结算完回到面板写原因
  const poor = mode(p, { deck: PHASE_FIRST });
  poor.w.gift = 0; poor.w.normal = 41 * 50 + 2 * 50;   // 正好够买入 41 枚 + 入场费
  poor.adapter.refresh();
  poor.$('[data-casino-buyin="hall"]').value = "41";
  click(poor.$('[data-casino="sit"][data-table="hall"]'));
  const g = poor.w.seat.game;
  // 让这一局马上结束：玩家在第一轮弃牌以后，每轮都弃牌（筹码不够再来一局）
  p.UI.setFast(true);
  for (let guard = 0; !g.over && guard < 200; guard++) {
    const side = p.w.CounterCards.toAct(g)[0];
    if (!side) break;
    const opts = p.w.CounterCards.legal(g, side);
    const fold = opts.find(o => o.type === "fold"), noLoan = opts.find(o => o.type === "noLoan");
    p.w.CounterCards.act(g, side, side === "player" && fold ? { type: "fold" } : noLoan ? { type: "noLoan" } : opts[0].type === "play" ? { type: "play", card: opts[0].card } : { type: opts[0].type, op: opts[0].op, where: opts[0].where });
  }
  assert.ok(g.over);
  p.UI.render();
  click(p.$('#cc-banner [data-cc="casinoAgain"]'));
  assert.equal(poor.w.seat, null, "上一局结算了，没坐下新的一局");
  assert.equal(poor.backs, 1, "回到面板");
  assert.match(poor.box.textContent, /没能再来一局：筹码不够/);
});

test("牌局里从钱包补筹码看得见（#520）：牌桌的记录写「从钱包补了 N 枚到桌上」，顶栏、赌场面板座位上的买入跟着加上；「再来一局」照旧按当初选的买入；离桌按总买入结算", () => {
  const p = page(), m = mode(p, { deck: PHASE_FIRST });
  const CC = p.w.CounterCards;
  m.adapter.sit("hall", 40);                                     // 赠送 50 枚：买入 10 枚 + 入场费 0.5 枚，钱包剩 39.5 枚
  const g = m.w.seat.game;
  CC.act(g, "dealer", { type: "weather", op: "pass" });
  CC.act(g, "dealer", { type: "play", card: "armor" }); CC.act(g, "player", { type: "play", card: "fire" });
  CC.act(g, "player", { type: "check" }); CC.act(g, "dealer", { type: "check" });
  m.adapter.refresh();
  click(m.$('[data-casino="play"]'));                            // 回到牌桌：轮到玩家翻天气
  assert.equal(p.UI.state().game, g);
  assert.match(p.$("#cc-top").textContent, /大厅 · 买入 40 枚/);
  p.UI.setFast(true);
  click(p.$('#cc-actions [data-cc="reveal"]'));                  // 翻开相位：双方全押，火打装甲——玩家输光，第 2 轮开始先从钱包补 3 枚
  assert.equal(g.round, 2);
  assert.match(p.$("#cc-side .cc-log").textContent, /玩家从钱包补了 3 枚到桌上。/, "牌桌的记录里写着");
  assert.match(p.$("#cc-top").textContent, /大厅 · 买入 43 枚/, "顶栏的买入跟着加上");
  assert.match(p.UI.state().casino.againText, /再来一局（买入 40 枚 \+ 入场费 2 枚）/, "「再来一局」照旧按当初选的买入");
  m.adapter.refresh();
  assert.match(m.$(".cs-seat").textContent, /你坐在大厅：买入 43 枚（含从钱包补的 3 枚），交了入场费 2 枚 · 第 2 \/ 5 轮/, "赌场面板座位上的买入跟着加上");
  assert.match(m.box.textContent, /筹码 38\.75 枚/, "钱包少了 0.75 枚（桌上 3 枚）");
  assert.match(m.box.textContent, /牌局里桌上的筹码不够时，先自动从钱包补到够用/);
  // 再回到牌桌：顶栏照样写总买入，「再来一局」还是当初选的买入
  click(m.$('[data-casino="play"]'));
  p.UI.setFast(true);
  assert.match(p.$("#cc-top").textContent, /大厅 · 买入 43 枚/);
  assert.match(p.UI.state().casino.againText, /再来一局（买入 40 枚 \+ 入场费 2 枚）/);
  click(p.$('#cc-top [data-cc="leave"]'));                       // 离桌：按总买入结算
  assert.match(m.box.textContent, /离开大厅：桌上剩 2 枚（买入 43 枚，含从钱包补的 3 枚，输 41 枚）/);
});

test("长线养成的任务板接进来：去赌场（第一次送赠送筹码）、面板按钮交给 casino-ui.js、坐着的时候面板一直展开；game.html 加载赌场的脚本和样式", () => {
  const ui = read("rogue-ui.js");
  assert.match(ui, /\$\{renderCasino\(\)\}/, "长线养成的任务板上有赌场");
  assert.match(ui, /on\("r-casino-open", \(\) => \{ casinoShown = true; act\(\{ action: "casinoOpen" \}\); \}\)/);
  assert.match(ui, /\[data-casino-root\]"\)\.forEach\(h => \{ h\.onclick = e => \{ if \(window\.CasinoUI\) CasinoUI\.handle\(e, casinoAdapter\); \}; \}\)/);
  assert.match(ui, /saved: \(\) => save\(\)/, "牌局每走一步存长线存档");
  const html = read("game.html");
  const at = f => html.indexOf(`<script src="${f}"></script>`);
  assert.ok(at("casino.js") > at("counter-cards-ai.js") && at("casino.js") < at("rogue.js"), "casino.js 在规则文件里、rogue.js 之前");
  assert.ok(at("casino-ui.js") > at("counter-cards-ui.js") && at("casino-ui.js") < at("rogue-ui.js"));
  assert.match(html, /<link rel="stylesheet" href="casino\.css" \/>/);
});
