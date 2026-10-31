// 猜大猜小进赌场（#528，主人 10/31）：长线养成、本机跑团的赌场以前只有 High Flux、Flux Duel、Flux Hold'em，
// 押筹码的猜大猜小只在标题「本地玩法」里练习（筹码不进任何钱包）。现在 casino.js · GAMES 加上猜大猜小：
// 三张赌场桌放在 GUESS_CONFIG.casino（照 DUEL_CONFIG.casino 的写法），钱照另外三种（#487）——坐下先收入场费、再押买入，
// 赠送 / 普通筹码分开记（输的先扣押上去的赠送筹码，赢来的进普通筹码），桌上不够先从钱包补（#520），离桌按倍率回钱包；
// 庄家是赌场（筹码无限，只抽牌、不用做决定）。规则（计分、赔率、开盘）照 counter-cards-guess.js 不动，黑市赌命桌不动。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const H = require("./headless");

const read = f => fs.readFileSync(path.join(H.ROOT, f), "utf8");
const J = v => JSON.parse(JSON.stringify(v));
// 先后同 game.html：High Flux → 两种 Flux → 猜大猜小 → casino.js
const RULES = ["counter-cards.js", "counter-cards-ai.js", "flux-duel.js", "flux-duel-ai.js", "flux-holdem.js", "flux-holdem-ai.js", "counter-cards-guess.js", "casino.js"];
// 火打肉体 · 酷暑 = +2；火打装甲 · 酷暑 = 0（层牌最后才翻：前三轮的赔率表两手一样）
const PLUS2 = { element: "fire", weather: "heat", layer: "flesh" };
const ZERO = { element: "fire", weather: "heat", layer: "armor" };

/** 规则（无界面）：headless 加上 High Flux、两种 Flux、猜大猜小和 casino.js */
function rules(files) {
  const c = H.load();
  (files || RULES).forEach(f => vm.runInContext(read(f), c, { filename: f }));
  return { c, K: c.Casino, G: c.CounterCardsGuess, FACE: c.Casino.CONFIG.face };
}
const bet = (G, h, bets) => G.act(h, "me", { type: "bet", bets });
const pass = (G, h) => G.act(h, "me", { type: "pass" });
const topUps = (h) => h.log.filter(e => e.t === "topUp");

/* ---------- 桌子 ---------- */

test("桌子：猜大猜小也有三张赌场桌（后巷小桌 / 大厅 / 贵宾室），放在 GUESS_CONFIG.casino，排在 Flux Hold'em 后面；倍率、最低买入、入场费先照 High Flux 的三张占位，另带每轮每格最低注；本地练习的桌子照旧", () => {
  const { K, G } = rules();
  const ts = K.tables();
  assert.deepEqual(J(ts.map(t => t.id)), ["alley", "hall", "vip", "duel-alley", "duel-hall", "duel-vip", "holdem-alley", "holdem-hall", "holdem-vip",
    "guess-alley", "guess-hall", "guess-vip"]);
  assert.equal(new Set(ts.map(t => t.id)).size, ts.length, "id 全赌场不重复");
  assert.deepEqual(J(K.games()), [{ game: "highflux", name: "High Flux" }, { game: "duel", name: "Flux Duel" }, { game: "holdem", name: "Flux Hold'em" }, { game: "guess", name: "猜大猜小" }]);
  assert.deepEqual(J(G.GUESS_CONFIG.casino.tables.map(t => t.id)), ["guess-alley", "guess-hall", "guess-vip"]);
  const guess = ts.filter(t => t.game === "guess");
  assert.deepEqual(J(guess.map(t => [t.short, t.name, t.gameName])), [["后巷小桌", "猜大猜小 · 后巷小桌", "猜大猜小"], ["大厅", "猜大猜小 · 大厅", "猜大猜小"], ["贵宾室", "猜大猜小 · 贵宾室", "猜大猜小"]]);
  for (const t of guess) {
    const hf = ts.find(x => x.id === t.id.replace(/^guess-/, ""));
    assert.deepEqual([t.short, t.rate, t.minBuyIn, t.entryFee, t.minBuyInChips, t.entryFeeChips, t.perChip],
      [hf.short, hf.rate, hf.minBuyIn, hf.entryFee, hf.minBuyInChips, hf.entryFeeChips, hf.perChip], t.id + "：先照 High Flux 的赌场桌占位");
    assert.deepEqual(J(t.minBet), [2, 4, 8], t.id + "：每轮每格最低注（桌上的枚数）");
  }
  // 这一手的规则读同一张桌子：入场费、每轮最低注、赔率系数（32/35）
  const info = G.tableOf("guess-vip");
  assert.deepEqual([info.id, info.name, info.entry, info.life, info.casino, info.rate, info.minBuyIn], ["guess-vip", "贵宾室", 2, false, true, 200, 50]);
  assert.deepEqual(J([info.minBet, info.odds]), [[2, 4, 8], [32, 35]]);
  // 本地练习的桌子照旧（标题「本地玩法」的设置页只列这两张，筹码不进钱包）
  assert.deepEqual(J(G.tables().map(t => t.id)), ["street", "backroom"]);
  // 名字只有一份：改了玩法名，桌名跟着变
  G.GUESS_CONFIG.name = "Guess X";
  assert.equal(K.tables().find(t => t.id === "guess-hall").name, "Guess X · 大厅");
  G.GUESS_CONFIG.name = "猜大猜小";
  // 没加载猜大猜小的页面：没有它的桌子
  const no = rules(RULES.filter(f => f !== "counter-cards-guess.js"));
  assert.ok(!no.K.tables().some(t => t.game === "guess"));
  assert.ok(!no.K.games().some(x => x.game === "guess"));
});

/* ---------- 坐下：入场费、买入 ---------- */

test("坐下：先收入场费（这张桌子的 2 枚，按倍率折成钱包里的筹码，先扣赠送的，不退），再押买入；这一手不再从桌上的筹码里扣入场费（只记在 paid 里）；人坐「你」，庄家是赌场，不用做决定", () => {
  const { K, G, FACE } = rules();
  const w = K.wallet(null);
  K.welcome(w);                                                              // 赠送 50 枚
  assert.throws(() => K.sit(w, "guess-hall", 29), /猜大猜小 · 大厅最低买入 30 枚/);
  assert.throws(() => K.sit(w, "guess-vip", 50), /筹码不够：买入 50 枚加入场费 2 枚要钱包里 52 枚，现有 50 枚/);
  assert.throws(() => K.sit(w, "guess-hall", 40, { dealer: "gm" }), /没有主持人坐庄/, "庄家是赌场");
  assert.equal(K.chips(w).gift, 50, "没坐成不动钱包");
  assert.equal(w.seat, null);
  const h = K.sit(w, "guess-hall", 40, { seed: "坐下", deal: PLUS2 });
  assert.equal(h.mode, "guess");
  assert.equal(K.gameOf(h), "guess");
  assert.deepEqual(J(h.casino), { table: "guess-hall", name: "猜大猜小 · 大厅", buyIn: 40, rate: 50, game: "guess", side: "me" });
  const me = h.players[0];
  assert.deepEqual([me.id, me.name, me.chips, me.paid], ["me", "你", 40, 2], "买入 40 枚都在桌上：入场费坐下时从钱包收过了，这一手只记在 paid 里");
  assert.match(h.log[0].text, /^大厅：庄家抽了一张元素、一张天气、一张层牌，都盖在桌上。入场费 2 枚（坐下时交给了赌场，不退）。$/);
  assert.equal(w.seat.game, h, "坐着的这一手记在钱包里");
  assert.deepEqual([w.seat.kind, w.seat.table, w.seat.name, w.seat.buyIn, w.seat.fee], ["ai", "guess-hall", "猜大猜小 · 大厅", 40, 2]);
  const ch = K.chips(w);
  assert.equal(ch.gift, 50 - 40 * 50 / FACE - 2 * 50 / FACE, "入场费 0.5 枚、买入 10 枚都先拿赠送的");
  assert.deepEqual([ch.seat.stake, ch.seat.fee, ch.seat.over, ch.seat.buyIn], [10, 2, false, 40]);
  assert.throws(() => K.sit(w, "guess-alley", 20), /已经坐在桌上/);
  // 庄家只抽牌：一坐下就轮到你押第一轮，runAi 走 0 步
  assert.deepEqual([h.stage, h.round, h.rounds], ["bet1", 1, 3]);
  assert.deepEqual(J(G.toAct(h)), ["me"]);
  assert.equal(K.runAi(h, "normal"), 0);
  assert.deepEqual(J(G.toAct(h)), ["me"]);
  // 贵宾室每枚 200 奎支：桌上 1 枚 = 钱包 1 枚
  const w2 = K.wallet({ gifted: true, gift: 0, normal: 60 * FACE });
  K.sit(w2, "guess-vip", 50);
  assert.equal(K.chips(w2).normal, 60 - 50 - 2);
});

/* ---------- 打完一手：筹码进钱包 ---------- */

test("打完一手离桌：桌上剩下的按倍率回钱包——押中连本带利拿回的、赢来的进普通筹码，押上去的赠送筹码原样回来；押输的先扣押上去的赠送筹码；净输赢按买入算（入场费坐下时交过了）", () => {
  const { K, G, FACE } = rules();
  // 押中：第一轮押 +2（18 倍）10 枚，后两轮不押；结果 +2，连本带利拿回 180 枚：桌上 40 − 10 + 180 = 210 枚
  let w = K.wallet({ gifted: true, gift: 12 * FACE, normal: 20 * FACE });   // 大厅每枚 50 奎支：桌上 4 枚 = 钱包 1 枚
  let h = K.sit(w, "guess-hall", 40, { deal: PLUS2 });                       // 入场费 0.5 枚 + 买入 10 枚都先拿赠送的：赠送剩 1.5 枚
  assert.deepEqual(J(w.seat.stake), { gift: 10 * FACE, normal: 0 });
  assert.deepEqual([K.chips(w).gift, K.chips(w).normal], [1.5, 20]);
  bet(G, h, { "2": 10 });
  pass(G, h); pass(G, h);
  assert.equal(h.over, true);
  assert.equal(h.result.score, 2);
  let me = h.players[0];
  assert.deepEqual([me.won, me.net, me.chips], [180, 168, 210], "这一手净赢 168 枚（净输赢含入场费 2 枚）");
  assert.equal(K.chips(w).seat.over, true);
  let res = K.leave(w);
  assert.deepEqual([res.chips, res.buyIn, res.topUp, res.net, res.over], [210, 40, 0, 170, true]);
  assert.match(res.text, /^离开猜大猜小 · 大厅：桌上剩 210 枚（买入 40 枚，赢 170 枚），钱包多了 42\.5 枚筹码。$/);
  assert.deepEqual([K.chips(w).gift, K.chips(w).normal], [11.5, 62.5], "押上去的赠送筹码原样回来（只少了入场费 0.5 枚），赢来的 42.5 枚是普通筹码");
  assert.equal(w.seat, null);
  // 押输：同样押 +2 的 10 枚，结果 0
  w = K.wallet({ gifted: true, gift: 12 * FACE, normal: 20 * FACE });
  h = K.sit(w, "guess-hall", 40, { deal: ZERO });
  bet(G, h, { "2": 10 });
  pass(G, h); pass(G, h);
  me = h.players[0];
  assert.deepEqual([h.result.score, me.won, me.chips, me.net], [0, 0, 30, -12]);
  res = K.leave(w);
  assert.deepEqual([res.chips, res.net, res.netChips], [30, -10, -2.5]);
  assert.match(res.text, /^离开猜大猜小 · 大厅：桌上剩 30 枚（买入 40 枚，输 10 枚），钱包少了 2\.5 枚筹码。$/);
  assert.deepEqual([K.chips(w).gift, K.chips(w).normal], [9, 20], "输的 2.5 枚先扣押上去的赠送筹码，普通筹码不动");
  // 押上去的有赠送、有普通：输的先扣赠送的，扣完了才扣普通的
  w = K.wallet({ gifted: true, gift: 5 * FACE, normal: 20 * FACE });
  h = K.sit(w, "guess-hall", 40, { deal: ZERO });                            // 入场费 0.5 + 买入 10：赠送 4.5 枚、普通 5.5 枚押上桌
  assert.deepEqual(J(w.seat.stake), { gift: 4.5 * FACE, normal: 5.5 * FACE });
  bet(G, h, { "2": 30 });
  pass(G, h); pass(G, h);
  res = K.leave(w);
  assert.deepEqual([res.chips, res.net], [10, -30]);
  assert.deepEqual([K.chips(w).gift, K.chips(w).normal], [0, 14.5 + 2.5], "输 7.5 枚：先扣光押上去的 4.5 枚赠送筹码，再扣 3 枚普通筹码（押上去的 5.5 枚回来 2.5 枚）");
});

/* ---------- 桌上不够从钱包补 ---------- */

test("桌上不够这一轮的最低注时先从钱包补（#520 的做法）：补到正好够押一格最低注，和买入一样先拿赠送的，算进总买入；钱包不够补满就有多少补多少，补不满只能不押；离桌按总买入算净输赢", () => {
  const { K, G, FACE } = rules();
  const w = K.wallet({ gifted: true, gift: 54 * FACE, normal: 4 * FACE });  // 贵宾室：桌上 1 枚 = 钱包 1 枚
  const h = K.sit(w, "guess-vip", 50, { deal: PLUS2 });                      // 入场费 2 + 买入 50 都先拿赠送的：赠送剩 2 枚
  assert.deepEqual([K.chips(w).gift, K.chips(w).normal], [2, 4]);
  const me = h.players[0];
  bet(G, h, { "2": 50 });                                                    // 第一轮把 50 枚都押在 +2：手上 0 枚，第二轮每格最低注 4 枚
  assert.equal(h.round, 2);
  assert.deepEqual(J(topUps(h).map(e => [e.r, e.by, e.amount])), [[2, "me", 4]], "补到第二轮每格的最低注");
  assert.match(topUps(h)[0].text, /^你从钱包补了 4 枚到桌上。$/);
  const iTop = h.log.indexOf(topUps(h)[0]), iReveal = h.log.findIndex(e => e.t === "reveal" && e.card === "element");
  assert.ok(iReveal >= 0 && iReveal < iTop, "先翻开元素、开了第二轮，再补");
  assert.equal(me.chips, 4);
  assert.ok(G.legal(h, "me").some(o => o.type === "bet" && o.min === 4 && o.max === 4), "补够了：能押一格最低注");
  assert.deepEqual([K.chips(w).gift, K.chips(w).normal], [0, 2], "和买入一样先拿赠送的 2 枚，再拿 2 枚普通的");
  assert.deepEqual(J(w.seat.stake), { gift: 52 * FACE, normal: 2 * FACE }, "补上来的押在桌上（离桌时输的照样先扣押上去的赠送筹码）");
  assert.deepEqual([w.seat.buyIn, w.seat.topUp, h.casino.buyIn, K.chips(w).seat.topUp], [54, 4, 54, 4], "补上来的算进总买入");
  // 第二轮押 4 枚：手上又是 0；第三轮每格最低注 8 枚，钱包只剩 2 枚——有多少补多少，补不满只能不押
  bet(G, h, { "2": 4 });
  assert.equal(h.round, 3);
  assert.deepEqual(J(topUps(h).map(e => [e.r, e.amount])), [[2, 4], [3, 2]]);
  assert.match(topUps(h)[1].text, /^你从钱包补了 2 枚到桌上（钱包只够补这么多，还差 6 枚）。$/);
  assert.equal(me.chips, 2);
  assert.deepEqual(J(G.legal(h, "me")), [{ type: "pass" }], "不够最低注：只能不押（猜大猜小没有借贷）");
  assert.deepEqual([K.chips(w).gift, K.chips(w).normal, w.seat.buyIn, w.seat.topUp], [0, 0, 56, 6]);
  pass(G, h);
  assert.equal(h.over, true);
  assert.deepEqual([me.won, me.chips], [50 * 18 + 4 * 16, 2 + 964], "+2 押中两格：18 倍、16 倍");
  assert.equal(me.net, 964 - 54 - 2, "这一手的净输赢只算押注和入场费，补上来的不算");
  const res = K.leave(w);
  assert.deepEqual([res.chips, res.buyIn, res.topUp, res.net], [966, 56, 6, 910]);
  assert.match(res.text, /^离开猜大猜小 · 贵宾室：桌上剩 966 枚（买入 56 枚，含从钱包补的 6 枚，赢 910 枚），钱包多了 910 枚筹码。$/);
  assert.deepEqual([K.chips(w).gift, K.chips(w).normal], [52, 914], "押上去的赠送筹码原样回来，赢来的是普通筹码");
  // 够用就不补；钱包空了也补不到（只能不押）
  const w2 = K.wallet({ gifted: true, gift: 0, normal: 52 * FACE });        // 坐下后钱包空了
  const h2 = K.sit(w2, "guess-vip", 50, { deal: ZERO });
  bet(G, h2, { "0": 46 });                                                   // 手上剩 4 枚：正好够第二轮的最低注
  assert.equal(h2.round, 2);
  assert.equal(topUps(h2).length, 0, "够用就不补");
  bet(G, h2, { "0": 4 });                                                    // 手上 0 枚，钱包也空了
  assert.equal(h2.round, 3);
  assert.equal(topUps(h2).length, 0, "钱包空了：补不到，也没有补筹码的记录");
  assert.deepEqual(J(G.legal(h2, "me")), [{ type: "pass" }]);
  assert.equal(w2.seat.buyIn, 50);
});

test("这一手从哪个钱包补：坐下时、钱包每次读进来（存档读回来是新的对象）都登记；离桌以后不补；本地练习（不接钱包）、黑市赌命桌（押坚毅）都不补", () => {
  const { K, G, FACE } = rules();
  // 存档 → 读档：补的是读进来的钱包
  const w = K.wallet({ gifted: true, gift: 0, normal: 60 * FACE });
  K.sit(w, "guess-vip", 50, { deal: PLUS2 });                                // 钱包剩 8 枚
  const w2 = K.wallet(J(w));
  const h2 = w2.seat.game;
  assert.equal(h2.mode, "guess", "读回来照样认得是猜大猜小");
  assert.equal(K.chips(w2).seat.table, "guess-vip");
  bet(G, h2, { "0": 50 });
  assert.deepEqual(J(topUps(h2).map(e => e.amount)), [4]);
  assert.deepEqual([K.chips(w2).normal, K.chips(w).normal], [4, 8], "补的是读进来的钱包；原来那个没动");
  assert.deepEqual([w2.seat.buyIn, w2.seat.topUp], [54, 4]);
  assert.equal(K.refill(h2, "dealer", 4), 0, "只补你坐的位置");
  // 离桌以后：这一手不再从钱包补
  K.leave(w2);
  assert.equal(K.refill(h2, "me", 4), 0);
  // 本地练习（标题「本地玩法」）：没接钱包，照旧补不到——不够最低注只能不押
  const local = G.newHand({ seed: "本地", table: "street", players: [{ id: "me", name: "你", chips: 4 }], deal: PLUS2 });
  assert.deepEqual([local.players[0].chips, local.players[0].paid], [2, 2], "本地练习的入场费照旧从带上桌的筹码里扣");
  bet(G, local, { "2": 2 });
  assert.equal(local.round, 2);
  assert.deepEqual([local.players[0].chips, topUps(local).length], [0, 0]);
  assert.deepEqual(J(G.legal(local, "me")), [{ type: "pass" }]);
  assert.equal(K.refill(local, "me", 4), 0);
  // 黑市赌命桌：押的是坚毅，不补（照旧）
  const life = G.newHand({ seed: "赌命", table: G.GUESS_CONFIG.life.id, players: [{ id: "ruby", name: "瑞比" }], deal: PLUS2 });
  G.act(life, "ruby", { type: "bet", bets: { "0": true } });
  assert.equal(life.round, 2);
  assert.equal(topUps(life).length, 0);
  assert.equal(life.players[0].chips, null, "赌命桌没有筹码");
});

/* ---------- 离桌：筹码放回钱包 ---------- */

test("打到一半离桌：手上的筹码按倍率回钱包，已经押下的注不退；坐下就离桌只少了入场费", () => {
  const { K, G } = rules();
  const w = K.wallet(null);
  K.welcome(w);                                                              // 赠送 50 枚
  const h = K.sit(w, "guess-hall", 40, { deal: PLUS2 });                     // 赠送剩 39.5 枚
  bet(G, h, { "0": 10 });                                                    // 第一轮押 0：10 枚
  assert.equal(h.round, 2);
  assert.equal(K.chips(w).seat.over, false);
  const res = K.leave(w);
  assert.deepEqual([res.chips, res.buyIn, res.net, res.over], [30, 40, -10, false], "押下的 10 枚不退");
  assert.match(res.text, /^离开猜大猜小 · 大厅：桌上剩 30 枚（买入 40 枚，输 10 枚），钱包少了 2\.5 枚筹码。$/);
  assert.deepEqual([K.chips(w).gift, K.chips(w).normal], [39.5 + 7.5, 0], "押上去的 10 枚赠送筹码回来 7.5 枚（桌上剩的 30 枚）");
  assert.equal(w.seat, null);
  assert.throws(() => K.leave(w), /没坐在桌上/);
  // 坐下就离桌：买入原样回来，只少了入场费
  K.sit(w, "guess-alley", 20);                                               // 后巷小桌：入场费 0.1 枚 + 买入 1 枚
  assert.equal(K.chips(w).gift, 45.9);
  const r2 = K.leave(w);
  assert.deepEqual([r2.chips, r2.net, r2.netChips], [20, 0, 0]);
  assert.equal(K.chips(w).gift, 46.9, "只少了入场费 0.1 枚");
});

/* ---------- 长线养成、本机跑团：坐桌指令只认桌子 id ---------- */

test("长线养成、本机跑团：坐桌指令只认桌子 id，猜大猜小的桌子不用改指令就能坐；打完一手离桌，记录写玩法和桌名；打到一半的这一手跟着存档走", () => {
  const { c, G } = rules();
  const R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed: "GUESS-CASINO", growth: true });
  R.casinoOpen(run);
  assert.ok(R.casinoView(run).tables.some(t => t.id === "guess-hall" && t.game === "guess"), "长线养成的赌场列出猜大猜小的桌子");
  const sat = R.casinoSit(run, "guess-hall", 40);
  assert.match(sat.notes.join(""), /赌场：坐上猜大猜小 · 大厅，买入 40 枚，交入场费 2 枚（不退）/);
  assert.equal(sat.game.mode, "guess");
  assert.equal(R.casinoView(run).chips.seat.name, "猜大猜小 · 大厅");
  assert.equal(R.taskBlocked(run, run.board[0]), "还坐在赌场的牌桌上：先离桌", "坐在桌上时照旧不能接任务");
  // 存档（JSON）再读：接着打完这一手
  run.casino = J(run.casino);
  const h = R.casinoView(run).game;
  assert.deepEqual(J(G.toAct(h)), ["me"]);
  bet(G, h, { "0": 2 });
  for (let guard = 0; !h.over && guard < 3; guard++) pass(G, h);           // 后两轮不押（结果已经定了的那一轮直接翻牌）
  assert.equal(h.over, true);
  const left = R.casinoLeave(run).join("");
  assert.match(left, new RegExp(`赌场：离开猜大猜小 · 大厅：桌上剩 ${h.players[0].chips} 枚（买入 40 枚`));
  assert.equal(R.casinoView(run).chips.seat, null);
  // 本机跑团
  const t = rules().c;
  t.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "GUESS-TRPG" });
  t.S.TRPG.active = true;
  t.trpgCasinoOpen();
  assert.ok(t.trpgCasinoView().tables.some(x => x.id === "guess-alley"), "本机跑团的赌场列出猜大猜小的桌子");
  assert.match(t.trpgCasinoSit("guess-alley", 20, null).join(""), /坐上猜大猜小 · 后巷小桌，买入 20 枚，交入场费 2 枚（不退）/);
  const g = t.trpgCasinoView().game;
  assert.equal(g.mode, "guess");
  t.CounterCardsGuess.act(g, "me", { type: "pass" });                       // 第一轮不押：这一手直接翻完
  assert.equal(g.over, true);
  assert.match(t.trpgCasinoLeave().join(""), /离开猜大猜小 · 后巷小桌：桌上剩 20 枚（买入 20 枚，赢 0 枚）/);
});
