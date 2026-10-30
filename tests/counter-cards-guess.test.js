// High Flux 黑市玩法：猜大猜小（#489）· 规则引擎 counter-cards-guess.js：
// 计分直接用 CounterCards.score（相位只把克制分翻倍、不加天气修正，超出 ±2 按 ±2）；245 种组合的分布；
// 赔率 32/35 × N ÷ k（主人 10/30 的勘误）和规则里的三张表逐格对上；取整、抽水、不开盘；
// 分阶段下注（三张盖好 → 翻元素 → 翻天气 → 翻层牌结算），押注按下注那一刻的赔率锁定；
// 防白看（入场费不退、最低注 2 / 4 / 8 按桌子倍率、第一轮没押的后两轮不能押）；没翻开的牌不在玩家的画面里
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const H = require("./headless");

const ROOT = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const c = H.load();
vm.runInContext(read("counter-cards.js"), c, { filename: "counter-cards.js" });
vm.runInContext(read("counter-cards-guess.js"), c, { filename: "counter-cards-guess.js" });
const CC = c.CounterCards;
const G = c.CounterCardsGuess;
const C = CC.CC_CONFIG;
const J = v => JSON.parse(JSON.stringify(v));
const RESULTS = [-2, -1, 0, 1, 2];
const clamp = n => Math.max(-2, Math.min(2, n));

// 规则里的三张赔率表（主人 10/30；null = 不开）
const ROUND1 = { "-2": 8, "-1": 3.5, "0": 2, "1": 4, "2": 18 };   // 主人 10/30（#497）：酸雨也豁免谐波，+1 由 4.5 变 4
const ROUND2 = {
  fire: [6, 3, 2.5, 5, 16],
  acid: [5, 4.5, 2.5, 4.5, 10],
  electric: [8, 4.5, 2.5, 3.5, 10],
  ice: [10, 3, 1.5, 6, null],
  energy: [32, 10, 1.5, 3, 10],
  physical: [10, 3, 1.5, 6, null],
  harmonic: [10, 2, 4, 4, 32]   // #497：酸雨不再给谐波 −1（以前 6 / 2 / 4.5 / 4.5 / 32）
};
const ROUND3 = { 1: 4.5, 2: 2, 3: 1.5, 4: null, 5: null };   // k = 得出这个结果的层牌数
const oddsRow = (b) => J(b.cells.map(x => (x.open ? x.odds : null)));

/** 一名玩家、指定这一手的三张牌 */
function hand(deal, o) {
  o = o || {};
  return G.newHand(Object.assign({ seed: "T", deal, table: o.table, players: o.players || [{ id: "p1", name: "你", chips: o.chips != null ? o.chips : 100 }] }, o.extra || {}));
}
const bet = (h, id, bets) => G.act(h, id, { type: "bet", bets });
const pass = (h, id) => G.act(h, id, { type: "pass" });

/* ---------- 计分 ---------- */

test("计分直接用 CounterCards.score：相位以外照原样（超出 ±2 按 ±2），相位只把克制分翻倍、不加天气修正（+1→+2、−1→−2、0 不变）", () => {
  const seen = { "1": 0, "-1": 0, "0": 0 };
  for (const el of C.elements) for (const ly of C.layers) {
    for (const w of C.weathers) {
      if (w === "phase") continue;
      assert.equal(G.outcome(el, ly, w), clamp(CC.score(el, ly, w)), `${el}/${ly}/${w}`);
    }
    const chart = CC.chartScore(el, ly, "phase");
    assert.equal(G.outcome(el, ly, "phase"), clamp(2 * chart), `${el}/${ly}/相位`);
    seen[chart] += 1;
  }
  assert.ok(seen["1"] && seen["-1"] && seen["0"], "相位里 +1、−1、0 三种都有");
  // 相位不加天气修正：CounterCards.score 在相位里本来就只有克制那一项，翻倍后正好是 ±2 / 0
  for (const el of C.elements) for (const ly of C.layers) {
    assert.equal(CC.weatherScore(el, ly, "phase"), 0);
    assert.ok([-2, 0, 2].includes(G.outcome(el, ly, "phase")));
  }
  // 不另写一套：换掉 CounterCards.score / chartScore，猜大猜小的结果跟着变（超出 ±2 按 ±2）
  const score = CC.score, chartScore = CC.chartScore;
  try {
    CC.score = () => 5;
    CC.chartScore = () => -1;
    assert.equal(G.outcome("fire", "flesh", "heat"), 2);
    assert.equal(G.outcome("fire", "flesh", "phase"), -2);
    CC.score = () => -1;
    assert.equal(G.outcome("ice", "armor", null), -1);
  } finally { CC.score = score; CC.chartScore = chartScore; }
  assert.equal(G.outcome("fire", "flesh", "heat"), clamp(CC.score("fire", "flesh", "heat")));
});

test("245 种组合的分布：三张都盖着 245 种，翻了元素 35 种，再翻天气 5 种；每种结果各几种", () => {
  const all = G.tally({});
  assert.equal(all.N, 245);
  assert.deepEqual(J(all.k), { "-2": 25, "-1": 62, "0": 96, "1": 50, "2": 12 });   // #497 以后（以前 27 / 62 / 95 / 49 / 12）
  let sum = 0;
  for (const el of C.elements) {
    const t = G.tally({ element: el });
    assert.equal(t.N, 35);
    assert.equal(RESULTS.reduce((s, r) => s + t.k[r], 0), 35);
    RESULTS.forEach(r => { sum += t.k[r]; });
    for (const w of C.weathers) {
      const t3 = G.tally({ element: el, weather: w });
      assert.equal(t3.N, 5);
      RESULTS.forEach(r => {
        assert.equal(t3.k[r], C.layers.filter(ly => G.outcome(el, ly, w) === r).length, `${el}/${w}/${r}`);
      });
    }
  }
  assert.equal(sum, 245);
  // 冰、物理不会出 +2
  assert.equal(G.tally({ element: "ice" }).k[2], 0);
  assert.equal(G.tally({ element: "physical" }).k[2], 0);
});

/* ---------- 赔率 ---------- */

test("赔率 = 32/35 × N ÷ k：第一轮（245 种）、第二轮（按元素，35 种）、第三轮（5 种层牌）三张表逐格和规则对上", () => {
  assert.deepEqual(J(G.GUESS_CONFIG.odds), [32, 35]);
  // 第一轮
  const b1 = G.board({});
  assert.equal(b1.N, 245);
  assert.deepEqual(oddsRow(b1), RESULTS.map(r => ROUND1[r]));
  // 第二轮：每张元素一行
  for (const el of C.elements) {
    const b2 = G.board({ element: el });
    assert.equal(b2.N, 35);
    assert.deepEqual(oddsRow(b2), ROUND2[el], el);
  }
  // 第三轮：每种元素 × 天气，按得出这个结果的层牌数 k 查表
  const ks = new Set();
  for (const el of C.elements) for (const w of C.weathers) {
    const b3 = G.board({ element: el, weather: w });
    assert.equal(b3.N, 5);
    b3.cells.forEach(x => {
      const want = x.k ? ROUND3[x.k] : null;
      assert.equal(x.open ? x.odds : null, want, `${el}/${w}/${x.result}（k = ${x.k}）`);
      assert.equal(x.open, want != null);
      if (x.k) ks.add(x.k);
    });
  }
  assert.deepEqual([...ks].sort(), [1, 2, 3, 4], "第三轮 k = 1 / 2 / 3 / 4 都出现过");
  // 赔率不是硬编码的表：改了系数跟着变（35/35 = 不抽水）
  const fair = G.board({}, [35, 35]);
  assert.deepEqual(oddsRow(fair), [9, 3.5, 2.5, 4.5, 20]);
});

test("取整：不满 5 倍向下取到 0.5，满 5 倍向下取整；赔出半枚向下取整（连本带利）", () => {
  assert.equal(G.oddsOf(245, 12), 18);     // 18.67
  assert.equal(G.oddsOf(35, 3), 10);       // 10.67
  assert.equal(G.oddsOf(35, 6), 5);        // 5.33
  assert.equal(G.oddsOf(35, 12), 2.5);     // 2.67
  assert.equal(G.oddsOf(245, 62), 3.5);    // 3.61
  assert.equal(G.oddsOf(5, 1), 4.5);       // 4.57
  assert.equal(G.oddsOf(5, 3), 1.5);       // 1.52
  assert.equal(G.oddsOf(35, 1), 32);       // 正好 32
  assert.equal(G.payoutOf(3, 3.5), 10);    // 10.5 → 10
  assert.equal(G.payoutOf(5, 2.5), 12);    // 12.5 → 12
  assert.equal(G.payoutOf(2, 4.5), 9);
  assert.equal(G.payoutOf(4, 18), 72);
  assert.equal(G.payoutOf(8, 1.5), 12);
});

test("抽水：名义 32/35（约 8.6%）；取整后每一格的实际抽水都不低于名义，第一轮押 0 约 22%、第三轮「2 种层牌」那一档 20%", () => {
  const nominal = 1 - 32 / 35;
  const rake = (b, x) => 1 - x.odds * x.k / b.N;
  const boards = [G.board({})];
  for (const el of C.elements) {
    boards.push(G.board({ element: el }));
    for (const w of C.weathers) boards.push(G.board({ element: el, weather: w }));
  }
  let n = 0;
  boards.forEach(b => b.cells.filter(x => x.open).forEach(x => { n++; assert.ok(rake(b, x) >= nominal - 1e-12, `${x.result}：抽水 ${rake(b, x)}`); }));
  assert.ok(n > 100);
  const b1 = G.board({}), zero = b1.cells.find(x => x.result === 0);
  assert.ok(Math.abs(rake(b1, zero) - 0.2163) < 0.001, "第一轮押 0 约 22%");   // #497 以后 1 − 2 × 96 / 245
  const k2 = { N: 5 };
  assert.ok(Math.abs(rake(k2, { odds: ROUND3[2], k: 2 }) - 0.2) < 1e-9, "第三轮 k = 2 是 20%");
});

test("不开盘：不可能（k = 0）、必中（k = N）、算出来 ≤ 1 倍（第三轮 k = 4：猜中也只拿回本金）的格子不开，也押不进去", () => {
  assert.equal(G.oddsOf(35, 0), null);
  assert.equal(G.oddsOf(5, 5), null);
  assert.equal(G.oddsOf(245, 245), null);
  assert.equal(G.oddsOf(5, 4), null);       // 公式算出 1.14 → 1 倍
  const ice = G.board({ element: "ice" }).cells.find(x => x.result === 2);
  assert.equal(ice.k, 0); assert.equal(ice.open, false); assert.equal(ice.odds, null);
  // 冰：第二轮押 +2 押不进去
  const h = hand({ element: "ice", weather: "heat", layer: "flesh" });
  bet(h, "p1", { 0: 2 });
  assert.equal(h.stage, "bet2");
  assert.throws(() => bet(h, "p1", { 2: 4 }), /不开盘/);
  assert.equal(h.stage, "bet2", "押不进去不算押过");
  // 全部必中（换掉计分，245 种都是 0）：三轮都不开盘，直接翻完结算，入场费照收
  const score = CC.score, chartScore = CC.chartScore;
  try {
    CC.score = () => 0; CC.chartScore = () => 0;
    const all = hand({ element: "fire", weather: "heat", layer: "flesh" }, { chips: 10 });
    assert.ok(all.over, "没有开盘的格子：直接结算");
    assert.equal(all.result.score, 0);
    assert.equal(all.players[0].chips, 8);
    assert.ok(all.boards.every(b => b.board.cells.every(x => !x.open)));
  } finally { CC.score = score; CC.chartScore = chartScore; }
});

/* ---------- 流程 ---------- */

test("流程：三张盖好 → 第一轮 → 翻元素 → 第二轮 → 翻天气 → 第三轮 → 翻层牌结算；押注按下注那一刻的赔率锁定，猜中连本带利", () => {
  const deal = { element: "fire", weather: "acid", layer: "armor" };
  const score = G.outcome(deal.element, deal.layer, deal.weather);
  const h = hand(deal, { chips: 100 });
  assert.equal(h.stage, "bet1");
  assert.deepEqual(J(h.shown), { element: null, weather: null, layer: null });
  assert.equal(h.players[0].chips, 98, "入场费 2 枚");
  assert.deepEqual(oddsRow(h.board), RESULTS.map(r => ROUND1[r]));
  bet(h, "p1", { [score]: 2, [score === 0 ? 1 : 0]: 2 });
  assert.equal(h.stage, "bet2");
  assert.deepEqual(J(h.shown), { element: "fire", weather: null, layer: null });
  assert.equal(h.players[0].chips, 94);
  assert.deepEqual(oddsRow(h.board), ROUND2.fire);
  // 第一轮的押注按第一轮的赔率锁定，翻了元素也不变
  const slipOf = (round) => h.players[0].slips.find(x => x.round === round && x.result === score);
  assert.equal(slipOf(1).odds, ROUND1[score]);
  const open2 = h.board.cells.find(x => x.result === score);
  bet(h, "p1", { [score]: 4 });
  assert.equal(h.stage, "bet3");
  assert.deepEqual(J(h.shown), { element: "fire", weather: "acid", layer: null });
  assert.equal(slipOf(2).odds, open2.odds);
  assert.equal(slipOf(1).odds, ROUND1[score]);
  const cell3 = h.board.cells.find(x => x.result === score);
  const other3 = h.board.cells.find(x => x.open && x.result !== score);
  const bets3 = {};
  if (cell3.open) bets3[score] = 8;
  if (other3) bets3[other3.result] = 8;
  bet(h, "p1", bets3);
  assert.ok(h.over);
  assert.equal(h.stage, "over");
  assert.deepEqual(J(h.shown), deal);
  assert.equal(h.result.score, score);
  const p = h.players[0];
  let won = 0, staked = 0;
  p.slips.forEach(x => {
    assert.equal(x.win, x.result === score);
    assert.equal(x.pay, x.win ? Math.floor(x.amount * x.odds) : 0);
    won += x.pay; staked += x.amount;
  });
  assert.equal(p.chips, 100 - 2 - staked + won);
  assert.equal(p.net, won - staked - 2);
  // 结算以后什么都不能做
  assert.throws(() => pass(h, "p1"), /结算/);
});

test("防白看：入场费不退；最低注第一轮 2、第二轮 4、第三轮 8；第一轮没押的人后两轮不能再押（第二轮不押不影响第三轮）", () => {
  const deal = { element: "harmonic", weather: "snow", layer: "spirit" };
  const h = hand(deal, { chips: 40 });
  assert.equal(h.players[0].chips, 38);
  const L1 = J(G.legal(h, "p1"));
  assert.deepEqual(L1.map(o => o.type), ["bet", "pass"]);
  assert.equal(L1[0].min, 2); assert.equal(L1[0].max, 38);
  assert.throws(() => bet(h, "p1", { 0: 1 }), /至少/);
  assert.throws(() => bet(h, "p1", { 0: 2.5 }), /至少|整数/);
  assert.throws(() => bet(h, "p1", {}), /至少押一格/);
  assert.throws(() => bet(h, "p1", { 0: 20, 1: 20 }), /不够/);
  bet(h, "p1", { 0: 2 });
  assert.equal(G.legal(h, "p1")[0].min, 4);
  assert.throws(() => bet(h, "p1", { 0: 3 }), /至少押 4/);
  pass(h, "p1");                                   // 第二轮不押
  assert.equal(h.stage, "bet3", "第一轮押过的，第二轮不押照样能押第三轮");
  if (h.board.cells.some(x => x.open)) {
    assert.equal(G.legal(h, "p1")[0].min, 8);
    const open = h.board.cells.find(x => x.open);
    assert.throws(() => bet(h, "p1", { [open.result]: 7 }), /至少押 8/);
    pass(h, "p1");
  }
  assert.ok(h.over);
  assert.equal(h.players[0].chips, 36 + (h.players[0].slips[0].win ? Math.floor(2 * h.players[0].slips[0].odds) : 0), "入场费不退");

  // 两名玩家：第一轮没押的，后两轮不在等待名单里，押也押不进去；押了的照常
  const two = hand(deal, { players: [{ id: "a", name: "甲", chips: 30 }, { id: "b", name: "乙", chips: 30 }] });
  assert.deepEqual(J(G.toAct(two)).sort(), ["a", "b"]);
  pass(two, "a");
  assert.equal(two.stage, "bet1", "乙还没押：不翻牌");
  assert.deepEqual(J(G.toAct(two)), ["b"]);
  bet(two, "b", { "-1": 2 });
  assert.equal(two.stage, "bet2");
  assert.deepEqual(J(G.toAct(two)), ["b"]);
  assert.deepEqual(J(G.legal(two, "a")), []);
  assert.throws(() => bet(two, "a", { 0: 4 }), /不是/);
  assert.equal(two.players[0].chips, 28, "甲交了入场费，不退");
  // 入场费都交不起：坐不上桌
  assert.throws(() => hand(deal, { chips: 1 }), /入场费/);
  // 第一轮所有人都没押：直接翻完结算
  const none = hand(deal, { chips: 10 });
  pass(none, "p1");
  assert.ok(none.over);
  assert.deepEqual(J(none.shown), deal);
});

test("桌子倍率：入场费和每轮最低注 × 倍率（数值在 CC_CONFIG.guess，和 CounterCards.CC_CONFIG 是同一份）", () => {
  assert.equal(C.guess, G.GUESS_CONFIG);
  assert.equal(G.GUESS_CONFIG.entry, 2);
  assert.deepEqual(J(G.GUESS_CONFIG.minBet), [2, 4, 8]);
  const tables = G.tables();
  assert.ok(tables.length >= 2);
  const base = tables.find(t => t.mult === 1), big = tables.find(t => t.mult > 1);
  assert.ok(base && big);
  assert.equal(base.entry, 2); assert.deepEqual(J(base.minBet), [2, 4, 8]);
  assert.equal(big.entry, 2 * big.mult); assert.deepEqual(J(big.minBet), [2, 4, 8].map(n => n * big.mult));
  const h = hand({ element: "fire", weather: "heat", layer: "flesh" }, { table: big.id, chips: 1000 });
  assert.equal(h.players[0].chips, 1000 - big.entry);
  assert.equal(G.legal(h, "p1")[0].min, 2 * big.mult);
  assert.throws(() => G.newHand({ seed: "x", table: "nope", players: [{ id: "p1", chips: 10 }] }), /没有这张桌子/);
});

test("没翻开的牌不在玩家的画面里：三张牌不同的两手，第一轮的画面一模一样（不带种子）；翻开一张多一张", () => {
  const players = [{ id: "p1", name: "你", chips: 50 }];
  const a = G.newHand({ seed: "A", deal: { element: "fire", weather: "heat", layer: "flesh" }, players });
  const b = G.newHand({ seed: "B", deal: { element: "ice", weather: "phase", layer: "spirit" }, players });
  const va = J(G.view(a, "p1")), vb = J(G.view(b, "p1"));
  assert.deepEqual(va, vb);
  const text = JSON.stringify(va);
  assert.doesNotMatch(text, /secret|seed/);
  assert.deepEqual(va.shown, { element: null, weather: null, layer: null });
  assert.equal(va.myTurn, true);
  assert.equal(va.me.chips, 48);
  assert.deepEqual(va.legal.map(o => o.type), ["bet", "pass"]);
  bet(a, "p1", { 0: 2 });
  const v2 = J(G.view(a, "p1"));
  assert.equal(v2.shown.element, "fire");
  assert.equal(v2.shown.weather, null);
  assert.equal(v2.shown.layer, null);
  assert.equal(v2.me.slips.length, 1);
  assert.equal(v2.result, null);
  pass(a, "p1"); pass(a, "p1");
  const v4 = J(G.view(a, "p1"));
  assert.ok(v4.over);
  assert.equal(v4.result.score, G.outcome("fire", "flesh", "heat"));
  assert.deepEqual(v4.shown, { element: "fire", weather: "heat", layer: "flesh" });
  assert.ok(v4.log.some(e => /翻开/.test(e.text)));
});

test("发牌：按种子可复现；元素 / 天气 / 层牌各自均匀（赔率按 245 种等可能算）", () => {
  assert.deepEqual(J(G.dealOf("same")), J(G.dealOf("same")));
  const n = 7000, count = { element: {}, weather: {}, layer: {} };
  for (let i = 0; i < n; i++) {
    const d = G.dealOf("s" + i);
    ["element", "weather", "layer"].forEach(k => { count[k][d[k]] = (count[k][d[k]] || 0) + 1; });
  }
  const check = (k, list) => {
    assert.deepEqual(Object.keys(count[k]).sort(), J(list).sort());
    list.forEach(x => { const want = n / list.length; assert.ok(Math.abs(count[k][x] - want) < want * 0.15, `${k} ${x}：${count[k][x]}`); });
  };
  check("element", C.elements); check("weather", C.weathers); check("layer", C.layers);
  const h = G.newHand({ seed: "same", players: [{ id: "p1", chips: 10 }] });
  assert.deepEqual(J(h.secret), J(G.dealOf("same")));
});
