// 赌场桌：桌上筹码不够时先从钱包补，钱包空了才借（#520，主人 10/30 手机试玩反馈）。
// 钱在 casino.js（Casino.topUp / refill / pvpBind：从钱包拿、先赠送后普通、按桌子倍率折成整枚、算进总买入）；
// 牌局里什么时候补在 counter-cards.js · bet.topUp（High Flux、Flux Duel、Flux Hold'em 共用：每轮开始问借贷之前、轮到自己下注的那一刻）。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const H = require("./headless");

const read = f => fs.readFileSync(path.join(H.ROOT, f), "utf8");
const J = v => JSON.parse(JSON.stringify(v));
// 先后同 game.html：High Flux → 两种 Flux → casino.js
const RULES = ["counter-cards.js", "counter-cards-ai.js", "flux-duel.js", "flux-duel-ai.js", "flux-holdem.js", "flux-holdem-ai.js", "casino.js"];
const PHASE_FIRST = ["phase", "heat", "snow", "acid", "thunder", "sand", "glow"];

/** 规则（无界面）：headless 加上 High Flux、两种 Flux 和 casino.js */
function rules() {
  const c = H.load();
  RULES.forEach(f => vm.runInContext(read(f), c, { filename: f }));
  return { c, K: c.Casino, CC: c.CounterCards, D: c.FluxDuel, X: c.FluxHoldem, FACE: c.Casino.CONFIG.face };
}

/* ---------- 钱：从钱包拿多少、拿哪部分、记在哪（casino.js） ---------- */

test("从钱包补：和买入一样先拿赠送筹码、再拿普通筹码，按桌子倍率折算；补上来的押在桌上，座位和对局的买入都加上，另记一共补了多少", () => {
  const { K, FACE } = rules();
  // 大厅每枚 50 奎支（钱包 1 枚 = 桌上 4 枚）：赠送 12 枚、普通 20 枚
  const w = K.wallet({ gifted: true, gift: 12 * FACE, normal: 20 * FACE });
  const g = K.sit(w, "hall", 40, { deck: PHASE_FIRST });          // 入场费 0.5 枚 + 买入 10 枚，都先拿赠送的：赠送剩 1.5 枚
  assert.deepEqual([K.chips(w).gift, K.chips(w).normal], [1.5, 20]);
  assert.equal(K.topUp(w, 10), 10, "钱包够：补到正好够用");
  // 桌上 10 枚 = 钱包 2.5 枚：先拿完剩下的 1.5 枚赠送筹码，再拿 1 枚普通筹码
  assert.deepEqual([K.chips(w).gift, K.chips(w).normal], [0, 19]);
  assert.deepEqual(J(w.seat.stake), { gift: 11.5 * FACE, normal: 1 * FACE }, "补上来的押在桌上（离桌时输的照样先扣押上去的赠送筹码）");
  assert.deepEqual([w.seat.buyIn, w.seat.topUp, g.casino.buyIn], [50, 10, 50], "座位、对局的买入都加上（总买入）");
  const seat = K.chips(w).seat;
  assert.deepEqual([seat.buyIn, seat.topUp, seat.stake], [50, 10, 12.5]);
  // 后巷小桌每枚 10 奎支（钱包 1 枚 = 桌上 20 枚）
  const w2 = K.wallet({ gifted: true, gift: 0, normal: 5 * FACE });
  K.sit(w2, "alley", 20);                                          // 入场费 0.1 枚 + 买入 1 枚：剩 3.9 枚
  assert.equal(K.topUp(w2, 6), 6);
  assert.equal(K.chips(w2).normal, 3.6, "桌上 6 枚 = 钱包 0.3 枚");
});

test("从钱包补：钱包不够补满就有多少补多少（整枚，零头补不了）；钱包空了、欠着赌场都补 0；没坐桌补 0", () => {
  const { K, FACE } = rules();
  // 贵宾室每枚 200 奎支（桌上 1 枚 = 钱包 1 枚）：坐下后钱包剩 2.5 枚
  const w = K.wallet({ gifted: true, gift: 0, normal: Math.round(54.5 * FACE) });
  const g = K.sit(w, "vip", 50);
  assert.equal(K.chips(w).normal, 2.5);
  assert.equal(K.topUp(w, 5), 2, "差 5 枚、钱包只够 2 枚：补 2 枚");
  assert.equal(K.chips(w).normal, 0.5);
  assert.equal(K.topUp(w, 1), 0, "剩下的 0.5 枚不够桌上 1 枚：补不了");
  assert.deepEqual([w.seat.buyIn, w.seat.topUp, g.casino.buyIn, K.chips(w).normal], [52, 2, 52, 0.5]);
  assert.equal(K.topUp(w, 0), 0, "不缺就不补");
  // 欠着赌场（普通筹码是负数）：赠送 + 普通合起来才是能拿的，拿完不会欠得更多
  const owe = K.wallet({ gifted: true, gift: 55 * FACE, normal: -3 * FACE });
  K.sit(owe, "vip", 50);                                           // 坐下要 52 枚：赠送剩 3 枚，合起来 0
  assert.equal(K.topUp(owe, 5), 0);
  assert.deepEqual([K.chips(owe).gift, K.chips(owe).normal], [3, -3]);
  assert.equal(K.topUp(K.wallet(null), 5), 0, "没坐桌");
});

test("离桌结算按总买入算净输赢：补上来的照样押在桌上，输的先扣押上去的赠送筹码；记录写明含从钱包补的", () => {
  const { K, FACE } = rules();
  const w = K.wallet({ gifted: true, gift: 11 * FACE, normal: 20 * FACE });
  const g = K.sit(w, "hall", 40, { deck: PHASE_FIRST });          // 赠送剩 0.5 枚（入场费 0.5 + 买入 10）
  const n = K.topUp(w, 8);                                         // 桌上 8 枚 = 钱包 2 枚：赠送 0.5 + 普通 1.5
  g.sides.player.chips += n;                                       // 补上桌（牌局里由 counter-cards.js · bet.topUp 加）
  assert.deepEqual([K.chips(w).gift, K.chips(w).normal], [0, 18.5]);
  const res = K.leave(w);                                          // 打到一半离桌：第 1 轮的底注 1 枚押进底池，不退
  assert.deepEqual([res.chips, res.buyIn, res.topUp, res.net], [47, 48, 8, -1], "桌上剩 39 + 8 = 47 枚，总买入 48 枚：输 1 枚");
  assert.match(res.text, /离开大厅：桌上剩 47 枚（买入 48 枚，含从钱包补的 8 枚，输 1 枚），钱包少了 0\.25 枚筹码/);
  // 押上去的：赠送 10.5 枚、普通 1.5 枚；输的 0.25 枚先扣赠送的
  assert.deepEqual([K.chips(w).gift, K.chips(w).normal], [10.25, 20]);
  // 没补过的照旧
  const w2 = K.wallet({ gifted: true, gift: 0, normal: 20 * FACE });
  K.sit(w2, "hall", 40);
  assert.match(K.leave(w2).text, /离开大厅：桌上剩 39 枚（买入 40 枚，输 1 枚）/);
});

test("这一局从哪个钱包补：坐下时、钱包每次读进来（存档读回来是新的对象）都登记；只补人那一方，赌场那几方、没接钱包的对局补不到", () => {
  const { K, CC, FACE } = rules();
  const w = K.wallet({ gifted: true, gift: 0, normal: 60 * FACE });
  const g = K.sit(w, "vip", 50);                                   // 钱包剩 8 枚
  assert.equal(K.refill(g, "dealer", 3), 0, "庄家是赌场：筹码无限，不补");
  assert.equal(K.refill(g, "player", 3), 3, "人那一方：从这个钱包补");
  assert.equal(K.chips(w).normal, 5);
  // 存档 → 读档：读进来的钱包是新的对象，牌局也是新的；读钱包时登记，补的是读进来的这个钱包
  const w2 = K.wallet(J(w));
  assert.equal(K.refill(w2.seat.game, "player", 2), 2);
  assert.deepEqual([K.chips(w2).normal, K.chips(w).normal], [3, 5], "补的是读进来的钱包；原来那个没动");
  assert.deepEqual([w2.seat.topUp, w.seat.topUp], [5, 3]);
  // 没接钱包的对局（本地玩法里的普通对局）：补不到
  assert.equal(K.refill(CC.newGame({ seed: "本地" }), "player", 3), 0);
  assert.equal(K.refill(null, "player", 3), 0);
});

test("Flux Duel、Flux Hold'em 的赌场桌也一样：只补人坐的那一方（Duel 的 a、Hold'em 的 p1），赌场的 AI 座位不补", () => {
  const { K, FACE } = rules();
  const w = K.wallet({ gifted: true, gift: 5 * FACE, normal: 20 * FACE });
  const g = K.sit(w, "duel-hall", 40, { seed: "补" });            // 入场费 0.5 + 买入 10：赠送 5 枚用光，普通剩 14.5 枚
  assert.equal(K.refill(g, "b", 4), 0, "赌场那一方");
  assert.equal(K.refill(g, "a", 4), 4);
  assert.deepEqual([w.seat.buyIn, g.casino.buyIn, w.seat.topUp], [44, 44, 4]);
  assert.deepEqual([K.chips(w).gift, K.chips(w).normal], [0, 13.5], "桌上 4 枚 = 钱包 1 枚");
  const w2 = K.wallet({ gifted: true, gift: 0, normal: 10 * FACE });
  const h = K.sit(w2, "holdem-alley", 20, { seed: "补" });
  ["p2", "p3", "p4"].forEach(id => assert.equal(K.refill(h, id, 4), 0, id + " 是赌场的 AI 座位"));
  assert.equal(K.refill(h, "p1", 4), 4);
  assert.deepEqual([w2.seat.buyIn, h.casino.buyIn], [24, 24]);
});

/* ---------- 玩家对赌：押普通筹码的补普通筹码，押奎支的补奎支 ---------- */

test("玩家对赌押筹码：从押注人钱包里的普通筹码补（赠送的不能用来对赌），桌上 1 枚 = 钱包 1 枚；结算按开局押的 + 补的算净输赢", () => {
  const { K, FACE } = rules();
  const t = K.pvpTable("t1", "chips");
  const wd = K.wallet({ gifted: true, gift: 50 * FACE, normal: 53 * FACE }), wp = K.wallet({ gifted: true, gift: 0, normal: 60 * FACE });
  K.pvpSit(t, "dealer", "甲", wd, 0, { deck: PHASE_FIRST });
  K.pvpSit(t, "player", "乙", wp, 0, { deck: PHASE_FIRST });
  assert.ok(t.game, "两边都坐下就开局");
  assert.equal(K.refill(t.game, "dealer", 2), 0, "还没登记从哪补");
  K.pvpBind(t, side => (side === "dealer" ? wd : wp));
  assert.equal(K.refill(t.game, "dealer", 5), 3, "甲的普通筹码只剩 3 枚：有多少补多少，赠送的 50 枚不能用");
  assert.deepEqual([K.chips(wd).gift, K.chips(wd).normal, wd.seat.topUp, K.chips(wd).seat.topUp], [50, 0, 3, 3]);
  assert.equal(K.refill(t.game, "dealer", 2), 0, "普通筹码补光了：补 0（剩下的才借）");
  assert.equal(K.refill(t.game, "player", 4), 4);
  assert.equal(K.chips(wp).normal, 60 - 50 - 4);
  t.game.sides.dealer.chips += 3; t.game.sides.player.chips += 4;  // 补上桌（牌局里由 counter-cards.js · bet.topUp 加）
  // 甲打到一半离桌认输：手上 49 + 3 = 52 枚，开局 50 + 补 3：输 1 枚（底注归对方）
  const rd = K.pvpSettle(t, "dealer", wd, "dealer"), rp = K.pvpSettle(t, "player", wp, "dealer");
  assert.deepEqual([rd.chips, rd.topUp, rd.net], [52, 3, -1]);
  assert.deepEqual([rp.chips, rp.topUp, rp.net], [55, 4, 1], "乙：手上 49 + 4，加上双方的底注");
  assert.match(rd.text, /对赌结算（庄家）：桌上剩 52 枚（开局 50 枚，中途从钱包补了 3 枚），输 1 枚筹码/);
  assert.match(rp.text, /对赌结算（玩家）：桌上剩 55 枚（开局 50 枚，中途从钱包补了 4 枚），赢 1 枚筹码/);
  assert.deepEqual([K.chips(wd).gift, K.chips(wd).normal, K.chips(wp).normal], [50, 52, 61], "两人的普通筹码加起来不变（53 + 60）");
});

test("玩家对赌押奎支：从那名角色的私人钱包补奎支（200 奎支 = 1 枚，由模式扣），不够整枚的补不了；结算按开局 + 补的算", () => {
  const { K, FACE } = rules();
  const t = K.pvpTable("t2", "kuizhi");
  const purse = { "甲": 50 * FACE + 700, "乙": 50 * FACE };
  const wd = K.wallet(null), wp = K.wallet(null);
  purse["甲"] -= K.pvpSit(t, "dealer", "甲", wd, purse["甲"], { deck: PHASE_FIRST });
  purse["乙"] -= K.pvpSit(t, "player", "乙", wp, purse["乙"], { deck: PHASE_FIRST });
  assert.deepEqual([purse["甲"], purse["乙"]], [700, 0]);
  const kit = side => t.seats[side];
  K.pvpBind(t, side => (side === "dealer" ? wd : wp), side => ({ have: () => purse[kit(side)], spend: n => { purse[kit(side)] -= n; } }));
  assert.equal(K.refill(t.game, "dealer", 5), 3, "700 奎支只够 3 枚：有多少补多少");
  assert.equal(purse["甲"], 100, "100 奎支不够 1 枚：留在钱包里");
  assert.deepEqual([wd.seat.kuizhi, wd.seat.topUp], [53 * FACE, 3]);
  assert.equal(K.refill(t.game, "player", 2), 0, "乙的私人钱包空了");
  t.game.sides.dealer.chips += 3;
  const rd = K.pvpSettle(t, "dealer", wd, "dealer");
  assert.deepEqual([rd.chips, rd.net, rd.kuizhi], [52, -1, 52 * FACE], "押了 53 枚（10600 奎支），桌上剩 52 枚回钱包：输 200 奎支");
  assert.match(rd.text, /中途从钱包补了 3 枚），输 200 奎支/);
});
