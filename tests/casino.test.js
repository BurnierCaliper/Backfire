// 赌场的钱（#487）· casino.js：筹码钱包（赠送 / 普通分开记、赠送只送一次、输了先扣赠送、赢来的进普通）、
// 坐上赌场桌押买入、离桌按桌子倍率结算回钱包
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
for (const f of ["counter-cards.js", "counter-cards-ai.js", "casino.js"]) vm.runInContext(read(f), c, { filename: f });
const CC = c.CounterCards;
const K = c.Casino;
const J = v => JSON.parse(JSON.stringify(v));
const A = (g, side, type, extra) => CC.act(g, side, Object.assign({ type }, extra || {}));
const PHASE_FIRST = ["phase", "heat", "snow", "acid", "thunder", "sand", "glow"];
const table = id => CC.casino.tables().find(t => t.id === id);
const FACE = K.CONFIG.face;
/** 这张桌子的入场费折成钱包里几枚 */
const feeChips = id => table(id).entryFee * table(id).rate / FACE;

/** 第一轮：庄家不动天气，双方暗出，第一轮下注都过牌，玩家翻开相位 → 双方全押，按 dealerCard / playerCard 判胜负 */
function phaseAllIn(g, dealerCard, playerCard) {
  A(g, "dealer", "weather", { op: "pass" });
  A(g, "dealer", "play", { card: dealerCard });
  A(g, "player", "play", { card: playerCard });
  A(g, "player", "check"); A(g, "dealer", "check");
  A(g, "player", "reveal");
}
/** 剩下的每一轮：庄家第一轮下注时弃牌（玩家每轮赢庄家 1 枚底注），打到对局结束 */
function dealerFoldsRest(g) {
  for (let guard = 0; !g.over; guard++) {
    assert.ok(guard < 80, "打不完：" + g.stage);
    const side = CC.toAct(g)[0];
    switch (g.stage) {
      case "loan": A(g, side, "noLoan"); break;
      case "dealerWeather": A(g, "dealer", "weather", { op: g.weather ? "keep" : "pass" }); break;
      case "play": for (const s of CC.toAct(g)) A(g, s, "play", { card: CC.legal(g, s)[0].card }); break;
      case "bet1": case "bet2": A(g, side, side === "dealer" ? "fold" : "check"); break;
      default: assert.fail("没想到的阶段：" + g.stage);
    }
  }
}

test("钱包：新钱包是空的；第一次玩赠送 50 枚筹码，记在赠送筹码里（不是普通筹码）", () => {
  assert.equal(K.CONFIG.gift, 50);
  const w = K.wallet(null);
  assert.deepEqual(J(w), { v: 1, gifted: false, gift: 0, normal: 0, seat: null });
  const notes = K.welcome(w);
  assert.match(notes.join(""), /赠送 50 枚筹码/);
  assert.deepEqual(J(K.chips(w)), { gift: 50, normal: 0, total: 50, gifted: true, seat: null });
});

test("钱包：赠送每个存档只送一次——再来、存档读档以后、赠送筹码输光以后都不再送", () => {
  const w = K.wallet(null);
  K.welcome(w);
  assert.deepEqual(J(K.welcome(w)), []);
  assert.equal(K.chips(w).gift, 50);
  const loaded = K.wallet(J(w));                       // 存档原样存、原样读
  assert.deepEqual(J(K.welcome(loaded)), []);
  assert.equal(K.chips(loaded).gift, 50);
  // 赠送筹码输光了也不补：大厅买入 198 枚（49.5 枚）+ 入场费 2 枚（0.5 枚），正好用光赠送的 50 枚
  const g = K.sit(loaded, "hall", 198, { deck: PHASE_FIRST });
  phaseAllIn(g, "armor", "fire");                      // 相位全押：火打装甲 −1，玩家输光
  A(g, "player", "noLoan");
  assert.equal(g.over, true);
  K.leave(loaded);
  assert.equal(K.chips(loaded).gift, 0);
  assert.deepEqual(J(K.welcome(loaded)), []);
  assert.equal(K.chips(loaded).total, 0);
  // 旧存档里没有钱包：补齐字段，照样只送一次
  const old = K.wallet({});
  assert.equal(old.gifted, false);
  K.welcome(old); K.welcome(old);
  assert.equal(K.chips(old).gift, 50);
});

test("坐桌：买入按桌子倍率从钱包里拿（先拿赠送的），押在桌上；最低买入、筹码不够、已经坐着都不行", () => {
  const vip = table("vip"), alley = table("alley");
  const w = K.wallet({ gifted: true, gift: 30 * FACE, normal: 40 * FACE });
  assert.throws(() => K.sit(w, "vip", vip.minBuyIn - 1), /最低买入/);
  assert.throws(() => K.sit(w, "没有的桌子", 100), /没有这张桌子/);
  assert.throws(() => K.sit(w, "vip", 71 * FACE / vip.rate), /筹码不够/);
  assert.deepEqual(J(K.chips(w)), { gift: 30, normal: 40, total: 70, gifted: true, seat: null }, "没坐成不动钱包");
  const g = K.sit(w, "vip", 50, { deck: PHASE_FIRST });
  assert.equal(g.casino.table, "vip");
  assert.equal(g.sides.player.start, 50);
  assert.equal(g.sides.dealer.infinite, true, "赌场的庄家筹码无限");
  const ch = K.chips(w);
  assert.equal(ch.gift, 0, "先拿赠送的");
  assert.equal(ch.normal, 70 - 50 - feeChips("vip"));
  assert.equal(ch.seat.stake, 50 * vip.rate / FACE);
  assert.throws(() => K.sit(w, "alley", alley.minBuyIn), /已经坐在桌上/);
  // 后巷小桌：每枚 10 奎支，桌上 20 枚 = 钱包 1 枚
  const w2 = K.wallet({ gifted: true, gift: 0, normal: 3 * FACE });
  K.sit(w2, "alley", 40);
  assert.equal(K.chips(w2).normal, 3 - 40 * alley.rate / FACE - feeChips("alley"));
  assert.equal(K.tables().find(t => t.id === "alley").minBuyInChips, alley.minBuyIn * alley.rate / FACE);
});

test("离桌结算：赢来的进普通筹码，押上去的赠送筹码原样回来", () => {
  const hall = table("hall");
  const w = K.wallet(null);
  K.welcome(w);                                        // 赠送 50 枚
  const g = K.sit(w, "hall", 40, { deck: PHASE_FIRST });   // 买入 40 枚 = 钱包 10 枚，入场费另扣
  phaseAllIn(g, "flesh", "fire");                      // 相位全押：火打肉体 +1，玩家翻倍
  dealerFoldsRest(g);                                  // 后面四轮庄家都弃牌：玩家每轮多赢 1 枚底注
  assert.equal(g.over, true);
  assert.equal(g.final.chips.player, 40 * 2 + 4);
  const res = K.leave(w);
  assert.equal(res.net, 44);
  assert.equal(res.over, true);
  const ch = K.chips(w);
  assert.equal(ch.gift, 50 - feeChips("hall"), "押上去的赠送筹码原样回来（只少了入场费）");
  assert.equal(ch.normal, 44 * hall.rate / FACE, "用赠送筹码赢来的是普通筹码");
  assert.equal(ch.seat, null);
  assert.match(res.text, /赢 44 枚/);
});

test("离桌结算：输的先扣赠送筹码，赠送的扣完了再扣普通筹码", () => {
  // 押上去的全是赠送筹码，输了一半：只少赠送筹码
  const w = K.wallet({ gifted: true, gift: 50 * FACE, normal: 10 * FACE });
  let g = K.sit(w, "vip", 50, { deck: PHASE_FIRST });
  A(g, "dealer", "weather", { op: "pass" });
  A(g, "dealer", "play", { card: "armor" }); A(g, "player", "play", { card: "fire" });
  A(g, "player", "bet", { amount: 24 }); A(g, "dealer", "call");       // 这一轮各押 25 枚
  CC.closeWindow(g);                                                   // 跟注后的 3 秒追加窗口（#496）到时间关上
  A(g, "player", "skip", { card: "normal" });                         // 不翻相位（暗弃常态跳过）
  A(g, "dealer", "check"); A(g, "player", "check");                   // 火打装甲 −1：玩家输掉这一轮的 25 枚
  assert.equal(g.results[0].winner, "dealer");
  K.leave(w);                                                          // 打到一半离桌：下一轮的底注已经押进去，不退
  assert.deepEqual([K.chips(w).gift, K.chips(w).normal], [50 - feeChips("vip") - 26, 10], "入场费和输的 26 枚全从赠送筹码里扣，普通筹码不动");
  // 押上去的有赠送也有普通，输的比赠送的多：赠送扣光，剩下的扣普通
  // （钱包里没押上去的只剩半枚，不够补上桌 1 枚：#520 起够 1 枚就先从钱包补、不问借贷）
  const w2 = K.wallet({ gifted: true, gift: 20 * FACE, normal: 32.5 * FACE });
  g = K.sit(w2, "vip", 50, { deck: PHASE_FIRST });
  phaseAllIn(g, "armor", "fire");                                      // 全押输光：输 50 枚
  A(g, "player", "noLoan");
  const res = K.leave(w2);
  assert.equal(res.net, -50);
  assert.deepEqual([K.chips(w2).gift, K.chips(w2).normal], [0, 52.5 - 50 - feeChips("vip")], "没押上去的半枚普通筹码不动");
});

test("离桌结算：还不上的借款（桌上筹码是负数）先扣钱包里剩下的赠送筹码，再扣普通筹码，可以扣成负数（欠赌场的）", () => {
  // 交完入场费、押上买入，钱包里剩半枚赠送筹码：不够补上桌 1 枚（#520 起够 1 枚就先从钱包补），只能借
  const w = K.wallet({ gifted: true, gift: (50.5 + feeChips("vip")) * FACE, normal: 0 });
  const g = K.sit(w, "vip", 50, { deck: PHASE_FIRST });
  phaseAllIn(g, "armor", "fire");                      // 输光
  A(g, "player", "borrow", { amount: 3 });             // 借 3 还 4；下了 1 枚底注，手上 2 枚
  const res = K.leave(w);                              // 打到一半离桌：手上 2 枚 − 还 4 枚 = −2 枚
  assert.equal(res.chips, -2);
  assert.equal(res.net, -52);
  assert.deepEqual([K.chips(w).gift, K.chips(w).normal], [0, -1.5], "交完入场费剩下的半枚赠送筹码扣光，还差 1.5 枚记成欠赌场的");
});

test("打到一半的牌局跟着钱包存档：存了再读，接着打完、照样结算", () => {
  const hall = table("hall");
  const w = K.wallet(null);
  K.welcome(w);
  const g = K.sit(w, "hall", 40, { deck: PHASE_FIRST });
  phaseAllIn(g, "flesh", "fire");
  const saved = JSON.parse(JSON.stringify(w));         // 存档：钱包连同桌上这一局
  const w2 = K.wallet(saved);
  assert.equal(K.chips(w2).seat.table, "hall");
  dealerFoldsRest(w2.seat.game);
  assert.equal(K.leave(w2).net, 44);
  assert.equal(K.chips(w2).gift, 50 - feeChips("hall"));
  assert.equal(K.chips(w2).normal, 44 * hall.rate / FACE);
});

/* ---------- 兑换：200 奎支买 1 枚，1 枚卖 190 奎支 ---------- */

test("兑换：200 奎支买 1 枚筹码（进普通筹码）；奎支不够不能买，钱包不动", () => {
  assert.equal(K.CONFIG.buy, 200);
  const w = K.wallet(null);
  const r = K.buy(w, 3, 600);
  assert.deepEqual([r.chips, r.cost], [3, 600]);
  assert.match(r.text, /买了 3 枚筹码，花掉 600 奎支/);
  assert.deepEqual([K.chips(w).gift, K.chips(w).normal], [0, 3]);
  assert.throws(() => K.buy(w, 1, 199), /奎支不够/);
  assert.throws(() => K.buy(w, 2, 399), /奎支不够/);
  assert.equal(K.chips(w).normal, 3, "没买成不动钱包");
  assert.throws(() => K.buy(w, 0, 1000), /正整数/);
  assert.throws(() => K.buy(w, 1.5, 1000), /正整数/);
  assert.throws(() => K.buy(w, -1, 1000), /正整数/);
});

test("兑换：1 枚普通筹码卖 190 奎支；赠送的不能卖、零头不能卖", () => {
  assert.equal(K.CONFIG.sell, 190);
  const w = K.wallet(null);
  K.welcome(w);                                        // 赠送 50 枚
  assert.equal(K.sellable(w), 0);
  assert.throws(() => K.sell(w, 1), /赠送的筹码不能换成奎支/);
  K.buy(w, 2, 400);
  assert.equal(K.sellable(w), 2);
  assert.throws(() => K.sell(w, 3), /只能卖 2 枚/);
  const r = K.sell(w, 2);
  assert.deepEqual([r.chips, r.gain], [2, 380]);
  assert.match(r.text, /卖了 2 枚筹码，得 380 奎支/);
  assert.deepEqual([K.chips(w).gift, K.chips(w).normal], [50, 0]);
  // 零头（后巷小桌赢来的 0.15 枚）不能卖
  const w2 = K.wallet({ gifted: true, gift: 0, normal: Math.round(1.15 * FACE) });
  assert.equal(K.sellable(w2), 1);
  K.sell(w2, 1);
  assert.equal(K.chips(w2).normal, 0.15);
  assert.equal(K.fmt(w2.normal), "0.15");
  assert.throws(() => K.sell(w2, 1), /没有能卖的筹码/);
  // 欠着赌场的（普通筹码是负数）：买来的先补上欠的
  const w3 = K.wallet({ gifted: true, gift: 0, normal: -FACE });
  K.buy(w3, 2, 400);
  assert.equal(K.chips(w3).normal, 1);
});

test("用赠送筹码赢了一局以后：赢到的部分能卖成奎支，赠送的部分不能卖", () => {
  const hall = table("hall");
  const w = K.wallet(null);
  K.welcome(w);                                        // 只有赠送的 50 枚
  const g = K.sit(w, "hall", 40, { deck: PHASE_FIRST });
  phaseAllIn(g, "flesh", "fire");
  dealerFoldsRest(g);
  K.leave(w);
  const won = 44 * hall.rate / FACE;                   // 赢来的 44 枚桌上筹码 = 钱包 11 枚（普通筹码）
  assert.equal(won, 11);
  assert.equal(K.sellable(w), won);
  const r = K.sell(w, won);
  assert.equal(r.gain, won * 190);
  const gift = K.chips(w).gift;
  assert.equal(gift, 50 - feeChips("hall"));
  assert.throws(() => K.sell(w, 1), /赠送的筹码不能换成奎支/, "赠送的一枚也卖不了");
  assert.equal(K.chips(w).gift, gift);
});

/* ---------- 入场费：赌场桌每开一局收一次，不退 ---------- */

test("入场费：配置在每张桌子上（先按 2 枚占位），折成奎支是 2 枚 × 桌子倍率", () => {
  CC.CC_CONFIG.casino.tables.forEach(t => assert.equal(t.entryFee, 2, t.id + " 的入场费"));
  const ts = K.tables();
  assert.deepEqual(J(ts.map(t => [t.id, t.entryFee, t.entryFeeChips])), [["alley", 2, 0.1], ["hall", 2, 0.5], ["vip", 2, 2]]);
  ts.forEach(t => assert.equal(t.entryFeeChips * FACE, t.entryFee * t.rate, "入场费的面值 = 枚数 × 倍率"));
});

test("入场费：每开一局收一次、不退——打完一局只多赚的减掉入场费，再开一局再收；中途离桌也不退", () => {
  const w = K.wallet({ gifted: true, gift: 0, normal: 60 * FACE });
  const g = K.sit(w, "vip", 50, { deck: PHASE_FIRST });
  assert.equal(K.chips(w).normal, 60 - 50 - 2, "坐下时收入场费");
  assert.equal(K.chips(w).seat.fee, 2);
  dealerFoldsRest(g);                                  // 五轮庄家都弃牌：桌上 +5
  assert.equal(K.leave(w).net, 5);
  assert.equal(K.chips(w).normal, 60 + 5 - 2, "净赚 = 桌上赢的 − 入场费");
  K.sit(w, "vip", 50);                                 // 再开一局：再收一次
  assert.equal(K.chips(w).normal, 63 - 52);
  K.leave(w);                                          // 马上离桌：入场费不退（第一轮的底注也已经押进去）
  assert.equal(K.chips(w).normal, 63 - 2 - 1);
});

test("入场费：也先扣赠送筹码；钱包只够买入、不够入场费就坐不下", () => {
  const w = K.wallet(null);
  K.welcome(w);
  K.sit(w, "alley", 20);                               // 买入 20 枚 = 钱包 1 枚，入场费 2 枚 = 0.1 枚
  assert.equal(K.chips(w).gift, 50 - 1 - 0.1);
  assert.equal(K.chips(w).normal, 0);
  const poor = K.wallet({ gifted: true, gift: 0, normal: 50 * FACE });
  assert.throws(() => K.sit(poor, "vip", 50), /筹码不够.*入场费/);
  assert.deepEqual([K.chips(poor).normal, K.chips(poor).seat], [50, null], "没坐成不收入场费");
});
