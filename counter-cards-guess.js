/* High Flux 黑市玩法：猜大猜小（#489）· 规则引擎
 * 庄家（AI / 黑市 NPC / 跑团主持人；庄家筹码无限，不用做决定）随机抽 1 张攻击元素牌（7 选 1）、1 张天气（7 选 1）、1 张层牌（5 选 1），
 * 都盖在场上；玩家猜这一手的得分：−2 / −1 / 0 / +1 / +2（超出 ±2 按 ±2 计）。
 * 计分直接用 counter-cards.js · CounterCards.score（克制表 + 天气修正，和 High Flux 同一套）；
 *   相位（主人 10/30）：只把克制分翻倍（+1→+2、−1→−2，0 不变），不加天气修正。
 * 分阶段下注（主人 10/30）：
 *   1. 三张都盖好 → 第一轮下注（245 种组合）
 *   2. 翻开元素 → 第二轮下注（35 种）
 *   3. 翻开天气 → 第三轮下注（5 种）
 *   4. 翻开层牌，结算
 *   每轮可押任意几格（一次交上来），押注按下注那一刻的赔率锁定；所有该押的人都押完 / 不押了才翻下一张。
 *   防白看：每局入场费（不退）；每轮每格有最低注（2 / 4 / 8，按桌子倍率）；第一轮没押的人，后两轮不能再押。
 * 赔率（连本带利，主人 10/30 的勘误）= 32/35 × N ÷ k：N = 还没排除的组合数，k = 其中得出这个结果的组合数；
 *   不满 5 倍向下取到 0.5，满 5 倍向下取整；赔出半枚向下取整。
 *   不开盘：k = 0（不可能）、k = N（必中），以及算出来 ≤ 1 倍的格子（猜中也只拿回本金，第三轮 k = 4 就是这样）。
 *   赔率由代码按分布现算（tally / board），不抄表。
 * 所有数值都在 GUESS_CONFIG，加载时挂到 CounterCards.CC_CONFIG.guess 上（和 High Flux 的配置在一起；
 * 写在这个新文件里，免得和别的 PR 改同一处）。规则层不碰网页：界面在 counter-cards-guess-ui.js。
 *
 *   const h = CounterCardsGuess.newHand({ seed: "A", table: "street", players: [{ id: "p1", name: "你", chips: 50 }] });
 *   CounterCardsGuess.toAct(h)                               → 现在等哪些玩家下注（id 列表；同一轮里谁先谁后都行）
 *   CounterCardsGuess.legal(h, "p1")                         → 这名玩家现在能做的：bet（开盘的格子、每格最低注、最多押多少）/ pass
 *   CounterCardsGuess.act(h, "p1", { type: "bet", bets: { "0": 2, "-1": 4 } })   → 这一轮押哪几格、各押多少（一次交上来）
 *   CounterCardsGuess.act(h, "p1", { type: "pass" })         → 这一轮不押（第一轮不押 = 这一手后面都不能押）
 *   CounterCardsGuess.view(h, "p1")                          → 这名玩家能看到的（没翻开的牌、种子都不在里面）
 *   CounterCardsGuess.board({ element: "fire" })             → 这一步的赔率表：每种结果的 k、赔率、开不开盘
 */
(function (root) {
  "use strict";

  /* ---------- 配置：所有数值都在这里（挂在 CounterCards.CC_CONFIG.guess 上） ---------- */
  const GUESS_CONFIG = {
    name: "猜大猜小",                  // 玩法名（界面写「High Flux · 猜大猜小」）
    results: [-2, -1, 0, 1, 2],        // 能押的结果；得分超出这个范围按两头算（±2）
    // 翻牌顺序：第一轮下注 → 翻 order[0] → 第二轮 → 翻 order[1] → 第三轮 → 翻 order[2] 结算
    order: ["element", "weather", "layer"],
    // 赔率（连本带利）= odds[0] / odds[1] × N ÷ k（主人 10/30 勘误：32/35，名义抽水约 8.6%，取整后实际 10%–22% 上下）
    odds: [32, 35],
    halfBelow: 5,                      // 不满 5 倍的向下取到 0.5，满 5 倍的向下取整
    closeAtOrBelow: 1,                 // 算出来 ≤ 1 倍（猜中也只拿回本金）的格子不开盘；k = 0、k = N 本来就不开
    phase: { weather: "phase", mult: 2 },   // 相位：只把克制分翻倍，不加天气修正
    entry: 2,                          // 每局入场费（不退）
    minBet: [2, 4, 8],                 // 第 1–3 轮每格最低注
    // 桌子：mult = 倍率，入场费和每轮最低注都 × 倍率（数值是占位，筹码钱包接上以后再定）
    tables: [
      { id: "street", name: "街边桌", mult: 1 },
      { id: "backroom", name: "里屋", mult: 5 }
    ],
    cardKinds: { element: "元素", weather: "天气", layer: "层牌" }
  };
  const RESULT_LO = () => Math.min.apply(null, GUESS_CONFIG.results);
  const RESULT_HI = () => Math.max.apply(null, GUESS_CONFIG.results);
  const CC = () => root.CounterCards;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function fail(msg) { throw new Error(msg); }
  function needCC() {
    if (!CC() || typeof CC().score !== "function") fail("猜大猜小要先加载 counter-cards.js（High Flux 的计分）");
  }
  const cardName = (c) => (CC() ? CC().cardName(c) : String(c));
  const weatherName = (w) => (CC() ? CC().weatherName(w) : String(w));
  /** 结果写法：+2 / +1 / 0 / −1 / −2 */
  const label = (r) => (r > 0 ? "+" + r : r < 0 ? "−" + Math.abs(r) : "0");

  /* ---------- 计分：直接用 CounterCards.score ---------- */
  /** 这一手的结果：CounterCards.score（克制 + 天气修正）；相位只把克制分翻倍、不加天气修正；超出 ±2 按 ±2 */
  function outcome(element, layer, weather) {
    needCC();
    const P = GUESS_CONFIG.phase;
    const raw = weather === P.weather ? P.mult * CC().chartScore(element, layer, weather) : CC().score(element, layer, weather);
    return Math.max(RESULT_LO(), Math.min(RESULT_HI(), Number(raw) || 0));
  }

  /* ---------- 分布和赔率 ---------- */
  /** 还没排除的组合里每种结果各有几种。known = { element, weather, layer }：写了的是翻开的牌，null / 不写是还盖着的 */
  function tally(known) {
    needCC();
    known = known || {};
    const C = CC().CC_CONFIG;
    const pool = (key, all) => (known[key] != null ? [known[key]] : all);
    const k = {};
    GUESS_CONFIG.results.forEach(r => { k[r] = 0; });
    let N = 0;
    pool("element", C.elements).forEach(el => pool("weather", C.weathers).forEach(w => pool("layer", C.layers).forEach(ly => {
      k[outcome(el, ly, w)] += 1;
      N += 1;
    })));
    return { N, k };
  }
  /** 赔率（连本带利）= num/den × N ÷ k：不满 halfBelow 倍向下取到 0.5，满了向下取整。
   *  不开盘 → null：k = 0（不可能）、k = N（必中）、算出来 ≤ closeAtOrBelow 倍。
   *  用整数算（num·N 和 den·k 比），不会出 6.999… 这种浮点误差。factor = [num, den]，默认 GUESS_CONFIG.odds */
  function oddsOf(N, k, factor) {
    const G = GUESS_CONFIG, f = factor || G.odds;
    N = Math.floor(Number(N) || 0); k = Math.floor(Number(k) || 0);
    if (k <= 0 || k >= N) return null;
    const a = f[0] * N, b = f[1] * k;
    const odds = a < G.halfBelow * b ? Math.floor(2 * a / b) / 2 : Math.floor(a / b);
    return odds > G.closeAtOrBelow ? odds : null;
  }
  /** 押 amount 猜中，连本带利拿回多少：amount × 赔率，半枚向下取整 */
  function payoutOf(amount, odds) {
    return Math.floor(Math.max(0, Math.floor(Number(amount) || 0)) * Math.round((Number(odds) || 0) * 2) / 2);
  }
  /** 这一步的赔率表：{ N, cells: [{ result, k, odds, open }] }（odds = null 不开盘） */
  function board(known, factor) {
    const t = tally(known);
    return { N: t.N, cells: GUESS_CONFIG.results.map(r => { const odds = oddsOf(t.N, t.k[r], factor); return { result: r, k: t.k[r], odds, open: odds != null }; }) };
  }

  /* ---------- 桌子 ---------- */
  /** 桌子算好入场费和每轮最低注（× 倍率） */
  function tableInfo(t) {
    const G = GUESS_CONFIG, m = Number(t.mult) || 1;
    return { id: t.id, name: t.name, mult: m, entry: Math.round(G.entry * m), minBet: G.minBet.map(n => Math.round(n * m)), odds: G.odds.slice() };
  }
  function tables() { return GUESS_CONFIG.tables.map(tableInfo); }
  function tableOf(id) {
    const t = GUESS_CONFIG.tables.find(x => x.id === (id || GUESS_CONFIG.tables[0].id));
    if (!t) fail("没有这张桌子：" + id);
    return tableInfo(t);
  }

  /* ---------- 发牌（种子随机数，和 High Flux 同一个） ---------- */
  /** 这个种子发出的三张牌：元素 7 选 1、天气 7 选 1、层牌 5 选 1，各自均匀（245 种等可能，赔率按这个算） */
  function dealOf(seed) {
    needCC();
    const C = CC().CC_CONFIG, rng = CC().makeRng(String(seed) + "|guess");
    const pick = (list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
    return { element: pick(C.elements), weather: pick(C.weathers), layer: pick(C.layers) };
  }

  /* ---------- 开一手 ---------- */
  /** opt：seed；table（桌子 id，默认第一张）；players：[{ id, name, chips }]（几名玩家同桌，各押各的）；
   *  deal（测试用：指定三张牌 { element, weather, layer }） */
  function newHand(opt) {
    opt = opt || {};
    needCC();
    const C = CC().CC_CONFIG;
    const seed = String(opt.seed != null ? opt.seed : Date.now());
    const t = tableOf(opt.table);
    const deal = opt.deal ? { element: opt.deal.element, weather: opt.deal.weather, layer: opt.deal.layer } : dealOf(seed);
    if (C.elements.indexOf(deal.element) < 0) fail("没有这张元素牌：" + deal.element);
    if (C.weathers.indexOf(deal.weather) < 0) fail("没有这张天气：" + deal.weather);
    if (C.layers.indexOf(deal.layer) < 0) fail("没有这张层牌：" + deal.layer);
    const list = opt.players || [];
    if (!list.length) fail("至少要有一名玩家");
    const players = list.map((p, i) => ({
      id: String(p.id != null ? p.id : "p" + (i + 1)), name: String(p.name || "玩家" + (i + 1)),
      chips: Math.max(0, Math.floor(Number(p.chips) || 0)), paid: 0,
      in: true,          // 第一轮押了（或者还没轮到第一轮）：后两轮还能押
      acted: {},         // 第几轮 → "bet" / "pass"
      slips: []          // 押注：{ round, result, amount, odds（下注那一刻锁定）}
    }));
    players.forEach((p, i) => { if (players.findIndex(x => x.id === p.id) !== i) fail("玩家 id 重复：" + p.id); });
    // 入场费（不退）：交不起的坐不上桌
    players.forEach(p => {
      if (p.chips < t.entry) fail(`${p.name}的筹码不够入场费 ${t.entry} 枚`);
      p.chips -= t.entry; p.paid = t.entry;
    });
    const h = {
      v: 1, seed, table: t,
      stage: "bet1", round: 1, over: false,
      secret: deal,                                        // 三张牌（翻开之前谁都看不到，view 里没有）
      shown: { element: null, weather: null, layer: null },   // 翻开的牌
      players, board: null, boards: [], log: [], result: null
    };
    note(h, { t: "open", text: `${t.name}：庄家抽了一张元素、一张天气、一张层牌，都盖在桌上。入场费 ${t.entry} 枚（不退）。` });
    openRound(h, 1);
    return h;
  }
  function note(h, entry) { h.log.push(Object.assign({ r: h.round }, entry)); }
  const playerOf = (h, id) => h.players.find(p => p.id === String(id)) || null;
  /** 这一轮能押的人：第一轮是所有人，后两轮只有第一轮押过的 */
  const eligible = (h) => h.players.filter(p => h.round === 1 || p.in);

  /** 开一轮下注：按翻开的牌现算赔率表；没有开盘的格子（结果已经定了）或者没人能押，直接翻下一张 */
  function openRound(h, r) {
    h.round = r; h.stage = "bet" + r;
    h.board = board(h.shown, h.table.odds);
    h.boards.push({ round: r, shown: clone(h.shown), board: clone(h.board) });
    if (!h.board.cells.some(x => x.open)) {
      note(h, { t: "closed", text: `第 ${r} 轮：没有开盘的格子（结果已经定了），直接翻下一张。` });
      advance(h);
    } else if (!eligible(h).length) {
      note(h, { t: "nobody", text: `第 ${r} 轮：第一轮没人押，后面不能再押，直接翻牌。` });
      advance(h);
    }
  }
  /** 这一轮都押完了：翻下一张；翻完三张结算 */
  function advance(h) {
    const key = GUESS_CONFIG.order[h.round - 1];
    h.shown[key] = h.secret[key];
    const name = key === "weather" ? weatherName(h.secret[key]) : cardName(h.secret[key]);
    note(h, { t: "reveal", card: key, value: h.secret[key], text: `翻开${GUESS_CONFIG.cardKinds[key]}：${name}。` });
    if (h.round < GUESS_CONFIG.order.length) openRound(h, h.round + 1);
    else settle(h);
  }

  /* ---------- 现在等谁、能做什么 ---------- */
  function toAct(h) {
    if (h.over) return [];
    return eligible(h).filter(p => !p.acted[h.round]).map(p => p.id);
  }
  function minBetOf(h) { return h.table.minBet[Math.max(0, Math.min(h.table.minBet.length - 1, h.round - 1))]; }
  /** 这名玩家现在能做的：
   *  { type: "bet", round, cells: [{ result, odds, k }]（开盘的格子）, min（每格至少押多少）, max（几格加起来最多押多少 = 手上的筹码）}
   *  （手上不够最低注就没有这一项）、{ type: "pass" } */
  function legal(h, id) {
    const p = playerOf(h, id);
    if (!p || toAct(h).indexOf(p.id) < 0) return [];
    const cells = h.board.cells.filter(x => x.open).map(x => ({ result: x.result, odds: x.odds, k: x.k }));
    const out = [];
    const min = minBetOf(h);
    if (cells.length && p.chips >= min) out.push({ type: "bet", round: h.round, cells, min, max: p.chips });
    out.push({ type: "pass" });
    return out;
  }

  /* ---------- 操作 ---------- */
  function act(h, id, a) {
    if (h.over) fail("这一手已经结算了");
    const p = playerOf(h, id);
    if (!p) fail("没有这名玩家：" + id);
    if (!a || typeof a.type !== "string") fail("操作格式不对");
    if (toAct(h).indexOf(p.id) < 0) fail(`现在不是${p.name}下注的时候`);
    if (a.type === "bet") placeBets(h, p, a.bets);
    else if (a.type === "pass") {
      p.acted[h.round] = "pass";
      if (h.round === 1) p.in = false;
      note(h, { t: "pass", by: p.id, text: h.round === 1 ? `${p.name}第一轮没押，这一手后面都不能再押。` : `${p.name}第 ${h.round} 轮不押。` });
    } else fail("未知操作：" + a.type);
    if (!toAct(h).length) advance(h);
    return h;
  }
  /** 这一轮押哪几格：bets = { 结果: 押多少 }，每格至少押最低注（整数），几格加起来不超过手上的筹码；不开盘的格子押不进去。
   *  押注按现在这张赔率表锁定 */
  function placeBets(h, p, bets) {
    const keys = Object.keys(bets && typeof bets === "object" ? bets : {});
    if (!keys.length) fail("至少押一格");
    const min = minBetOf(h);
    const lines = keys.map(key => {
      const r = Number(key);
      const cell = h.board.cells.find(x => x.result === r);
      if (!cell) fail("没有这一格：" + key);
      if (!cell.open) fail(`${label(r)} 这一格不开盘`);
      const n = Number(bets[key]);
      if (!Number.isInteger(n) || n < min) fail(`第 ${h.round} 轮每格至少押 ${min} 枚（整数）`);
      return { round: h.round, result: r, amount: n, odds: cell.odds };
    });
    const total = lines.reduce((s, x) => s + x.amount, 0);
    if (total > p.chips) fail(`筹码不够：这一轮押了 ${total} 枚，手上只有 ${p.chips} 枚`);
    p.chips -= total;
    lines.forEach(x => p.slips.push(x));
    p.acted[h.round] = "bet";
    note(h, { t: "bet", by: p.id, text: `${p.name}押 ${lines.map(x => `${label(x.result)}（${x.odds} 倍）${x.amount} 枚`).join("、")}。` });
  }

  /* ---------- 结算：翻开层牌，用 CounterCards.score 算结果，猜中的连本带利拿回 ---------- */
  function settle(h) {
    const s = h.secret, score = outcome(s.element, s.layer, s.weather);
    h.over = true; h.stage = "over";
    h.result = { score, element: s.element, weather: s.weather, layer: s.layer };
    note(h, { t: "result", score, text: `结果：${cardName(s.element)}打${cardName(s.layer)}，天气${weatherName(s.weather)}——${label(score)}。` });
    h.players.forEach(p => {
      let won = 0, staked = 0;
      p.slips.forEach(x => {
        x.win = x.result === score;
        x.pay = x.win ? payoutOf(x.amount, x.odds) : 0;
        won += x.pay; staked += x.amount;
      });
      p.chips += won;
      p.won = won;
      p.net = won - staked - p.paid;
      if (p.slips.length) note(h, { t: "pay", by: p.id, text: won ? `${p.name}押中，连本带利拿回 ${won} 枚。` : `${p.name}没押中。` });
    });
  }

  /* ---------- 这名玩家能看到的东西 ---------- */
  /** 没翻开的牌（secret）、种子都不在里面；押注、赔率表、翻开的牌、记录是公开的 */
  function view(h, id) {
    const p = playerOf(h, id);
    if (!p) fail("没有这名玩家：" + id);
    const t = h.table;
    const slip = (x) => (h.over ? { round: x.round, result: x.result, amount: x.amount, odds: x.odds, win: x.win, pay: x.pay } : { round: x.round, result: x.result, amount: x.amount, odds: x.odds });
    const seat = (x) => ({ id: x.id, name: x.name, in: x.in, acted: clone(x.acted), slips: x.slips.map(slip) });
    const wait = toAct(h);
    return {
      table: { id: t.id, name: t.name, mult: t.mult, entry: t.entry, minBet: t.minBet.slice() },
      stage: h.stage, round: h.round, rounds: GUESS_CONFIG.order.length, over: h.over,
      shown: clone(h.shown),
      board: clone(h.board), minBet: minBetOf(h),
      waiting: wait, myTurn: wait.indexOf(p.id) >= 0,
      legal: legal(h, p.id),
      me: Object.assign(seat(p), { chips: p.chips, paid: p.paid }, h.over ? { won: p.won, net: p.net } : {}),
      others: h.players.filter(x => x !== p).map(seat),
      result: h.result ? clone(h.result) : null,
      log: clone(h.log)
    };
  }

  const api = {
    GUESS_CONFIG, label, outcome, tally, oddsOf, payoutOf, board, tables, tableOf, dealOf,
    newHand, toAct, legal, act, view
  };
  // 配置挂到 High Flux 的 CC_CONFIG 上（同一份对象）
  if (CC() && CC().CC_CONFIG) CC().CC_CONFIG.guess = GUESS_CONFIG;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CounterCardsGuess = api;
})(typeof window !== "undefined" ? window : globalThis);
