// 猜大猜小 · 多人同桌押同一手（#556 第 1 步：规则层，主人 11/01「得要有人赢有人输才好玩」）：counter-cards-guess.js
// 好几个人坐同一桌、看同一组盖着的牌，彼此押了哪几格、押多少都公开；结算给出这一手的输赢排名。两种桌子（kind）：
//   赌场桌（house）：照固定赔率 32/35 × N ÷ k，大家都对赌场、各算各的（和一个人坐时一模一样）；
//   彩池桌（pool）：每一轮单独一个池，赌场抽 10%（代替入场费），剩下的由这一轮押中的人按注额比例分（向下取整），
//     分不出去的滚存到下一手同一轮（配置可以改成归赌场）；即时赔率板 poolBoard（不锁定，结算按最终的池子算）；钱守恒。
// NPC 赌客：真人不够 fillTo 个时补上，钱由赌场出；只看公开的 view（不偷看盖着的牌）；同一种子、同样的局面押得一样。
// 一个人坐的赌场桌、黑市赌命桌照旧（原有的测试在 counter-cards-guess*.test.js、casino-guess*.test.js）
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
const CFG = G.GUESS_CONFIG;
const J = v => JSON.parse(JSON.stringify(v));

// 火 · 酷暑：打装甲 = 0、打肉体 = +2——只差层牌（最后才翻），三轮下注时看到的一模一样
const D0 = { element: "fire", weather: "heat", layer: "armor" };
const D2 = { element: "fire", weather: "heat", layer: "flesh" };
const seat = (id, name, chips) => ({ id, name, chips: chips == null ? 100 : chips });
const A = (n) => seat("a", "甲", n), B = (n) => seat("b", "乙", n), Cc = (n) => seat("c", "丙", n);
const bet = (h, id, bets) => G.act(h, id, { type: "bet", bets });
const pass = (h, id) => G.act(h, id, { type: "pass" });
const pool = (o) => G.newHand(Object.assign({ seed: "P", kind: "pool", npc: false, deal: D0 }, o));
const slipsOf = (h, round) => [].concat(...h.players.map(p => p.slips.filter(x => round == null || x.round === round)));
const sum = (list) => list.reduce((s, x) => s + x.amount, 0);
/** 每张押注：{ 谁, 第几轮, 哪格, 押多少, 赔率, 拿回多少 } */
const slipRows = (p) => p.slips.map(x => [x.round, x.result, x.amount, x.odds, x.win, x.pay]);

test("开局前：D0 / D2 的结果是 0 / +2；彩池桌、NPC 的数值都在配置（GUESS_CONFIG.kinds / pool / npc）", () => {
  assert.equal(G.outcome(D0.element, D0.layer, D0.weather), 0);
  assert.equal(G.outcome(D2.element, D2.layer, D2.weather), 2);
  assert.deepEqual(J(G.kinds()), [{ id: "house", name: "赌场桌" }, { id: "pool", name: "彩池桌" }]);
  assert.deepEqual(J(CFG.pool), { rake: 10, stakeBack: true, carry: "next", digits: 1 });
  assert.equal(CFG.npc.fillTo, 4);
  assert.deepEqual(Object.keys(CFG.npc.styles).sort(), ["cautious", "counter", "follower", "gambler"]);
  CFG.npc.roster.forEach(x => assert.ok(CFG.npc.styles[x.style] && x.name && /^npc-/.test(x.id), x.id));
  assert.equal(C.guess, CFG, "和 High Flux 的配置是同一份");
  assert.throws(() => G.newHand({ seed: "x", kind: "nope", players: [A()] }), /没有这种桌子/);
});

/* ---------- 赌场桌多人 ---------- */

test("赌场桌多人同一手：同一组牌、同样的翻牌顺序，彼此押了哪几格押多少都看得到；各押各的照固定赔率，和一个人坐时一模一样；第一轮没押的后两轮不能押；结算有输赢排名", () => {
  const h = G.newHand({ seed: "M", kind: "house", deal: D0, players: [A(), B(), Cc()] });
  assert.equal(h.players.length, 3, "赌场桌默认不补 NPC");
  assert.equal(h.table.kind, "house");
  assert.deepEqual(J(h.players.map(p => p.chips)), [98, 98, 98], "入场费 2 枚照收");
  const ids = ["a", "b", "c"];
  const views = [];
  const same = () => {
    const vs = ids.map(id => J(G.view(h, id)));
    vs.forEach(v => {
      assert.deepEqual(v.shown, vs[0].shown, "大家看到同样的翻牌");
      assert.deepEqual(v.board, vs[0].board, "同一张赔率表");
      assert.deepEqual(v.log, vs[0].log, "同一份公开记录");
      assert.equal(v.table.kind, "house");
      assert.doesNotMatch(JSON.stringify(v), /secret|seed/);
    });
    views.push(vs[0]);
    return vs;
  };
  same();
  bet(h, "a", { 0: 4, 1: 2 });
  assert.equal(h.stage, "bet1", "还有人没押：不翻牌");
  pass(h, "c");
  bet(h, "b", { "-1": 2 });
  assert.equal(h.stage, "bet2");
  let vs = same();
  // 互相看得到：甲的画面里有乙押了哪格、押多少（下注那一刻锁定的赔率也公开）；别人手上还有多少筹码不在里面
  const bInA = vs[0].others.find(x => x.id === "b");
  assert.deepEqual(bInA.slips, [{ round: 1, result: -1, odds: 3.5, amount: 2 }]);
  assert.equal(bInA.chips, undefined);
  assert.deepEqual(vs[2].others.find(x => x.id === "a").slips.map(x => [x.result, x.amount, x.odds]), [[0, 4, 2], [1, 2, 4]]);
  // 丙第一轮没押：后两轮不在等待名单里，押也押不进去
  assert.deepEqual(J(G.toAct(h)).sort(), ["a", "b"]);
  assert.deepEqual(J(G.legal(h, "c")), []);
  assert.equal(vs[2].myTurn, false);
  assert.throws(() => bet(h, "c", { 0: 4 }), /不是/);
  bet(h, "a", { 0: 4 });
  pass(h, "b");
  same();
  bet(h, "a", { 0: 8 });
  bet(h, "b", { 2: 8 });
  assert.ok(h.over);
  same();
  // 翻牌顺序：元素 → 天气 → 层牌（大家同一份）
  assert.deepEqual(J(h.log.filter(e => e.t === "reveal").map(e => e.card)), ["element", "weather", "layer"]);
  assert.deepEqual(views.map(v => J(v.shown)).map(s => [s.element, s.weather, s.layer]),
    [[null, null, null], ["fire", null, null], ["fire", "heat", null], ["fire", "heat", "armor"]]);
  // 各算各的：甲 押中 3 张（第一轮 0 ×2、第二轮 0 ×2.5、第三轮 0 ×2）= 8 + 10 + 16；乙全输；丙只交了入场费
  const [a, b, cc] = h.players;
  assert.deepEqual([a.won, a.net, a.chips], [34, 34 - 18 - 2, 100 - 2 - 18 + 34]);
  assert.deepEqual([b.won, b.net, b.chips], [0, -12, 88]);
  assert.deepEqual([cc.won, cc.net, cc.chips], [0, -2, 98]);
  // 和一个人坐时一模一样：同样的牌、同样的押法，每张押注、筹码、净输赢都一样
  const solo = (plays) => {
    const s = G.newHand({ seed: "S", deal: D0, players: [seat("p", "你")] });
    plays.forEach(x => (x ? bet(s, "p", x) : !s.over && pass(s, "p")));
    return s.players[0];
  };
  const sa = solo([{ 0: 4, 1: 2 }, { 0: 4 }, { 0: 8 }]), sb = solo([{ "-1": 2 }, null, { 2: 8 }]), sc = solo([null]);
  [[a, sa], [b, sb], [cc, sc]].forEach(([p, s]) => {
    assert.deepEqual(J(slipRows(p)), J(slipRows(s)), p.name);
    assert.deepEqual([p.chips, p.won, p.net], [s.chips, s.won, s.net], p.name);
  });
  // 输赢排名：甲 +14 第一，丙 −2，乙 −12 垫底；记录里写一行
  assert.deepEqual(J(h.ranking).map(x => [x.id, x.net, x.npc]), [["a", 14, false], ["c", -2, false], ["b", -12, false]]);
  assert.deepEqual(J(h.ranking[0]), { id: "a", name: "甲", npc: false, staked: 18, won: 34, paid: 2, net: 14 });
  const rank = h.log.filter(e => e.t === "rank");
  assert.equal(rank.length, 1);
  assert.equal(rank[0].text, "这一手的输赢：1. 甲 +14 枚；2. 丙 −2 枚；3. 乙 −12 枚。赢得最多的是甲，输得最多的是乙。");
  assert.deepEqual(J(G.view(h, "b").ranking), J(h.ranking), "排名公开");
  assert.equal(G.poolBoard(h, 1), null, "赌场桌没有彩池");
  assert.equal(G.carryOf(h), null);
});

/* ---------- 彩池桌 ---------- */

test("彩池桌：每一轮单独一个池，赌场抽 10%（向下取整，代替入场费），剩下的由这一轮押中的人按注额分（每人向下取整），零头滚存；押中的人至少拿回本金；钱守恒", () => {
  const h = pool({ players: [A(), B(), Cc()] });
  assert.equal(h.table.kind, "pool");
  assert.equal(h.table.entry, 0);
  assert.deepEqual(J(h.players.map(p => [p.chips, p.paid])), [[100, 0], [100, 0], [100, 0]], "不收入场费");
  assert.match(h.log[0].text, /彩池桌.*不收入场费.*赌场抽 10%.*按注额分.*赔率不锁定/);
  // 第一轮：甲押 0 10 枚、乙押 −1 20 枚、丙押 0 5 枚 → 池子 35，抽 3（3.5 向下取整），剩 32 由押中 0 的 15 枚分
  bet(h, "a", { 0: 10 }); bet(h, "b", { "-1": 20 }); bet(h, "c", { 0: 5 });
  // 第二轮（翻了火）：甲、乙都押 0（4 + 8），丙不押 → 池里只有押中那一格的钱：抽成最多抽到押中的人拿回本金（不抽）
  bet(h, "a", { 0: 4 }); bet(h, "b", { 0: 8 }); pass(h, "c");
  // 第三轮（翻了酷暑：0 / +1 / +2 开）：甲押 +1、乙押 +2、丙押 +1，各 8 枚 → 没人押中：抽 2，剩 22 滚存到下一手
  bet(h, "a", { 1: 8 }); bet(h, "b", { 2: 8 }); bet(h, "c", { 1: 8 });
  assert.ok(h.over);
  assert.equal(h.result.score, 0);
  const R = h.pool.rounds;
  assert.deepEqual(J(R.map(x => [x.round, x.carryIn, x.staked, x.rake, x.net, x.hit, x.paid, x.left, x.carryOut, x.house, x.odds])), [
    [1, 0, 35, 3, 32, 15, 31, 1, 1, 3, 2.1],     // 甲 floor(32 × 10 / 15) = 21，丙 floor(32 × 5 / 15) = 10，零头 1
    [2, 0, 12, 0, 12, 12, 12, 0, 0, 0, 1],       // 名义上抽 1（12 × 10%），押中的人至少拿回本金：不抽
    [3, 0, 24, 2, 22, 0, 0, 22, 22, 2, null]     // 没人押中
  ]);
  const [a, b, cc] = h.players;
  assert.deepEqual(J(slipRows(a)), [[1, 0, 10, null, true, 21], [2, 0, 4, null, true, 4], [3, 1, 8, null, false, 0]], "押注不锁定赔率（odds = null）");
  assert.deepEqual(J(slipRows(cc)), [[1, 0, 5, null, true, 10], [3, 1, 8, null, false, 0]]);
  assert.deepEqual(J(slipRows(b)), [[1, -1, 20, null, false, 0], [2, 0, 8, null, true, 8], [3, 2, 8, null, false, 0]]);
  assert.deepEqual([a.won, a.net, a.chips], [25, 3, 103]);
  assert.deepEqual([b.won, b.net, b.chips], [8, -28, 72]);
  assert.deepEqual([cc.won, cc.net, cc.chips], [10, -3, 97]);
  // 钱守恒：所有人拿回的 + 赌场抽成 + 滚存 = 押进去的总数（+ 滚存进来的）
  const staked = sum(slipsOf(h)), paid = slipsOf(h).reduce((s, x) => s + x.pay, 0);
  const house = R.reduce((s, x) => s + x.house, 0), carry = R.reduce((s, x) => s + x.carryOut, 0), carryIn = R.reduce((s, x) => s + x.carryIn, 0);
  assert.deepEqual([staked, paid, house, carry], [71, 43, 5, 23]);
  assert.equal(paid + house + carry, staked + carryIn);
  assert.equal(h.players.reduce((s, p) => s + p.chips, 0) + house + carry, 300, "三个人带上桌的 300 枚：手上的 + 赌场 + 滚存");
  R.forEach(x => assert.equal(x.paid + x.house + x.carryOut, x.carryIn + x.staked, "第 " + x.round + " 轮"));
  assert.deepEqual(J(G.carryOf(h)), [1, 0, 22]);
  // 记录：每一轮的池子怎么分（公开），每人分得多少，输赢排名
  const notes = J(h.log.filter(e => e.t === "pool").map(e => e.text));
  assert.deepEqual(notes, [
    "第 1 轮彩池 35 枚：抽成 3 枚，押中 0 的 15 枚分 31 枚（每枚约 2.1 倍），零头 1 枚滚存到下一手。",
    "第 2 轮彩池 12 枚：抽成 0 枚（押中的人至少拿回本金，少抽了），押中 0 的 12 枚分 12 枚（每枚约 1 倍）。",
    "第 3 轮彩池 24 枚：抽成 2 枚，没人押中，22 枚滚存到下一手。"
  ]);
  assert.ok(h.log.some(e => e.t === "pay" && e.text === "甲押中，从彩池连本带利分得 25 枚。"));
  assert.deepEqual(J(h.ranking).map(x => [x.id, x.net]), [["a", 3], ["c", -3], ["b", -28]]);
  assert.match(h.log[h.log.length - 1].text, /^这一手的输赢：1\. 甲 \+3 枚；2\. 丙 −3 枚；3\. 乙 −28 枚。赢得最多的是甲，输得最多的是乙。$/);
  // stakeBack 关掉：池里只有押中那一格的钱也照抽（押中的人拿回的比押的少）
  CFG.pool.stakeBack = false;
  try {
    const x = pool({ players: [A(), B()] });
    bet(x, "a", { 0: 10 }); bet(x, "b", { 0: 10 });
    pass(x, "a"); pass(x, "b"); pass(x, "a"); pass(x, "b");
    assert.deepEqual(J([x.pool.rounds[0].rake, x.players[0].slips[0].pay, x.players[1].slips[0].pay]), [2, 9, 9]);
  } finally { CFG.pool.stakeBack = true; }
});

test("即时赔率板 poolBoard：每一格「现在押中，每枚大约分回几枚」（连本带利，向下取 1 位小数）随着大家下注变；押的那一刻不锁定，结算按最终的池子算", () => {
  const h = pool({ players: [A(), B(), Cc()] });
  const odds = (b) => J(b.cells.map(x => x.odds));
  let b = G.poolBoard(h);
  assert.deepEqual([b.round, b.live, b.over, b.carryIn, b.staked, b.pool, b.rake, b.rakePct, b.min], [1, true, false, 0, 0, 0, 0, 10, 2]);
  assert.ok(b.cells.every(x => x.open && x.empty && x.staked === 0 && x.bettors === 0), "还没人押");
  assert.deepEqual(odds(b), [1, 1, 1, 1, 1], "还没人押的格子按「押一注最低注独得」算：池里只有自己的钱");
  assert.deepEqual(J(b.cells.map(x => x.k)), [25, 62, 96, 50, 12], "k 照分布（概率 = k ÷ 245）");
  bet(h, "a", { 0: 10 });
  b = G.poolBoard(h);
  // 押 0 的只有甲：押中只拿回本金（1 倍）；别的格子押最低注 2 枚：池子 12，抽 1，独得 11 → 5.5 倍
  assert.deepEqual(odds(b), [5.5, 5.5, 1, 5.5, 5.5]);
  assert.deepEqual(J(b.cells.find(x => x.result === 0)), { result: 0, k: 96, open: true, staked: 10, bettors: 1, odds: 1 });
  bet(h, "b", { "-1": 20 });
  b = G.poolBoard(h);
  // 池子 30，抽 3：押中 0 → 27 ÷ 10 = 2.7；押中 −1 → 27 ÷ 20 = 1.35 → 1.3；没人押的格子押 2 枚 → 29 ÷ 2 = 14.5
  assert.deepEqual(odds(b), [14.5, 1.3, 2.7, 14.5, 14.5]);
  assert.deepEqual([b.staked, b.pool, b.rake], [30, 30, 3]);
  assert.deepEqual(J(G.view(h, "c").pool.rounds[0]), J(b), "画面里的即时赔率板就是这一张（公开）");
  assert.deepEqual(J(G.view(h, "c").pool.rounds.slice(1)), [null, null], "还没开的轮次没有");
  bet(h, "c", { 0: 5 });
  // 这一轮押完了：板子定下来（不再算「没人押的格子」），押中 0 → 32 ÷ 15 = 2.13 → 2.1
  b = G.poolBoard(h, 1);
  assert.equal(b.live, false);
  assert.deepEqual(odds(b), [null, 1.6, 2.1, null, null]);
  assert.ok(b.cells.filter(x => !x.staked).every(x => x.empty));
  assert.equal(G.poolBoard(h).round, 2, "不写第几轮 = 现在这一轮");
  assert.deepEqual(odds(G.poolBoard(h)), [1, 1, 1, 1, 1], "第二轮的池从 0 开始（每轮单独一个池）");
  assert.equal(G.poolBoard(h, 3), null, "第三轮还没开");
  assert.deepEqual(J(h.players[0].slips[0].odds), null, "甲押的时候板子上写 1 倍：不锁定");
  pass(h, "a"); pass(h, "b"); pass(h, "c");
  pass(h, "a"); pass(h, "b"); pass(h, "c");
  assert.ok(h.over);
  // 结算后：最终的倍数（2.1），甲按最终的池子分 floor(32 × 10 / 15) = 21，不是押的那一刻的 1 倍
  b = G.poolBoard(h, 1);
  assert.deepEqual([b.over, b.win, b.hit, b.net, b.paid, b.left, b.carryOut, b.house, b.odds, b.rake], [true, 0, 15, 32, 31, 1, 1, 3, 2.1, 3]);
  assert.deepEqual(J(b.cells.map(x => x.win)), [false, false, true, false, false]);
  assert.equal(h.players[0].slips[0].pay, 21);
  // 赔率板也放配置：保留几位小数
  assert.equal(CFG.pool.digits, 1);
});

test("彩池桌没人押中：这一轮的池（抽成以后）滚存到下一手同一轮，滚存进来的不再抽成；配置改成 house 就归赌场", () => {
  const h1 = pool({ players: [A(50), B(50)] });
  bet(h1, "a", { 1: 10 }); bet(h1, "b", { "-1": 10 });                 // 结果是 0：都没押中
  pass(h1, "a"); pass(h1, "b"); pass(h1, "a"); pass(h1, "b");
  assert.ok(h1.over);
  assert.deepEqual(J(G.carryOf(h1)), [18, 0, 0], "第一轮 20 枚抽 2，剩 18 滚存");
  assert.ok(h1.log.some(e => e.text === "第 1 轮彩池 20 枚：抽成 2 枚，没人押中，18 枚滚存到下一手。"));
  assert.equal(h1.log.filter(e => e.t === "pool").length, 1, "第二、三轮池里什么都没有：不写");
  // 下一手：第一轮的池开局就有 18 枚（公开）；押中的人连滚存一起分，滚存进来的不再抽成
  const h2 = pool({ seed: "P2", players: [A(50), B(50)], carry: G.carryOf(h1) });
  assert.match(h2.log[0].text, /上一手滚存进来：第 1 轮 18 枚。/);
  let b = G.poolBoard(h2, 1);
  assert.deepEqual([b.carryIn, b.staked, b.pool], [18, 0, 18]);
  assert.deepEqual(J(b.cells.map(x => x.odds)), [10, 10, 10, 10, 10], "押最低注 2 枚独得 18 + 2");
  bet(h2, "a", { 0: 4 });
  assert.equal(G.poolBoard(h2, 1).cells.find(x => x.result === 0).odds, 5.5, "22 ÷ 4");
  bet(h2, "b", { 1: 6 });
  assert.equal(G.poolBoard(h2, 1).cells.find(x => x.result === 0).odds, 6.7, "18 + 10 − 抽 1 = 27，÷ 4 = 6.75");
  pass(h2, "a"); pass(h2, "b"); pass(h2, "a"); pass(h2, "b");
  assert.ok(h2.over);
  const R = h2.pool.rounds[0];
  assert.deepEqual([R.carryIn, R.staked, R.rake, R.net, R.paid, R.carryOut], [18, 10, 1, 27, 27, 0], "只抽新押进来的 10 枚");
  assert.equal(h2.players[0].slips[0].pay, 27);
  assert.deepEqual(J(G.carryOf(h2)), [0, 0, 0]);
  assert.match(h2.log.find(e => e.t === "pool").text, /^第 1 轮彩池 28 枚（含上一手滚存 18 枚）：抽成 1 枚，押中 0 的 4 枚分 27 枚/);
  // 两手加起来也守恒：押进去 30 枚 = 拿回 27 + 赌场抽成 2 + 1 + 还在滚存的 0
  const all = [h1, h2];
  const staked = all.reduce((s, h) => s + sum(slipsOf(h)), 0), paid = all.reduce((s, h) => s + slipsOf(h).reduce((t, x) => t + x.pay, 0), 0);
  const house = all.reduce((s, h) => s + h.pool.rounds.reduce((t, x) => t + x.house, 0), 0);
  assert.deepEqual([staked, paid, house, G.carryOf(h2).reduce((s, n) => s + n, 0)], [30, 27, 3, 0]);
  // 配置改成归赌场：没人押中的池子赌场拿走，不滚存
  CFG.pool.carry = "house";
  try {
    const h3 = pool({ players: [A(50), B(50)] });
    assert.match(h3.log[0].text, /没人押中的池归赌场/);
    bet(h3, "a", { 1: 10 }); bet(h3, "b", { "-1": 10 });
    pass(h3, "a"); pass(h3, "b"); pass(h3, "a"); pass(h3, "b");
    assert.deepEqual(J(G.carryOf(h3)), [0, 0, 0]);
    assert.deepEqual([h3.pool.rounds[0].rake, h3.pool.rounds[0].left, h3.pool.rounds[0].house], [2, 18, 20]);
    assert.ok(h3.log.some(e => e.text === "第 1 轮彩池 20 枚：抽成 2 枚，没人押中，18 枚归赌场。"));
  } finally { CFG.pool.carry = "next"; }
  // 只有彩池桌有滚存；滚存的枚数要是整数
  assert.throws(() => G.newHand({ seed: "x", kind: "house", deal: D0, players: [A()], carry: [5, 0, 0] }), /只有彩池桌有滚存/);
  assert.throws(() => pool({ players: [A()], carry: [-1, 0, 0] }), /滚存/);
  assert.throws(() => pool({ players: [A()], carry: [1.5] }), /滚存/);
});

test("彩池桌照样防白看：每轮每格最低注 2 / 4 / 8；第一轮没押的后两轮不能押；能押的格子按「还有可能、又不是必中」开（赌场桌 ≤ 1 倍不开的那格，彩池桌照样能押）", () => {
  const h = pool({ players: [A(40), B(40)] });
  const L = J(G.legal(h, "a"));
  assert.deepEqual(L.map(o => o.type), ["bet", "pass"]);
  assert.deepEqual([L[0].min, L[0].max, L[0].pool], [2, 40, true]);
  assert.ok(L[0].cells.every(x => x.odds === null), "彩池桌没有固定赔率");
  assert.throws(() => bet(h, "a", { 0: 1 }), /至少押 2/);
  assert.throws(() => bet(h, "a", { 0: 50 }), /筹码不够/);
  pass(h, "b");
  bet(h, "a", { 0: 2 });
  assert.equal(h.stage, "bet2");
  assert.deepEqual(J(G.toAct(h)), ["a"]);
  assert.deepEqual(J(G.legal(h, "b")), []);
  assert.throws(() => bet(h, "b", { 0: 4 }), /不是/);
  assert.equal(G.legal(h, "a")[0].min, 4);
  assert.throws(() => bet(h, "a", { 0: 3 }), /至少押 4/);
  pass(h, "a");
  assert.equal(G.legal(h, "a")[0].min, 8);
  assert.throws(() => bet(h, "a", { 1: 7 }), /至少押 8/);
  pass(h, "a");
  assert.ok(h.over);
  assert.equal(h.players[1].chips, 40, "乙一枚没押：彩池桌不收入场费，什么都没少");
  // 不可能的格子不开：冰第二轮没有 +2
  const ice = pool({ players: [A()], deal: { element: "ice", weather: "heat", layer: "flesh" } });
  bet(ice, "a", { 0: 2 });
  assert.equal(ice.board.cells.find(x => x.result === 2).open, false);
  assert.throws(() => bet(ice, "a", { 2: 4 }), /不开盘/);
  // 第三轮 k = 4 的那一格：赌场桌算出来 1 倍不开，彩池桌照样开
  let deal = null;
  for (const el of C.elements) for (const w of C.weathers) {
    const t = G.tally({ element: el, weather: w });
    const r = [-2, -1, 0, 1, 2].find(x => t.k[x] === 4);
    if (!deal && r != null) deal = { deal: { element: el, weather: w, layer: C.layers.find(ly => G.outcome(el, ly, w) === r) }, r };
  }
  assert.ok(deal, "有第三轮 k = 4 的组合");
  const play = (kind) => {
    const x = G.newHand({ seed: "k4", kind, npc: false, deal: deal.deal, players: [A()] });
    bet(x, "a", { [x.board.cells.find(c => c.open).result]: 2 });
    pass(x, "a");
    return x;
  };
  const house = play("house"), pooled = play("pool");
  assert.equal(house.board.cells.find(x => x.result === deal.r).open, false, "赌场桌：5/4 → 1 倍不开");
  const cell = pooled.board.cells.find(x => x.result === deal.r);
  assert.deepEqual([cell.k, cell.open, cell.odds], [4, true, null]);
  bet(pooled, "a", { [deal.r]: 8 });
  assert.ok(pooled.over);
  assert.equal(pooled.players[0].slips[1].pay, 8, "一个人押：池里只有自己的钱，押中拿回本金");
});

/* ---------- NPC 赌客 ---------- */

test("NPC 赌客：真人不够 fillTo（4）个时补到 4 个（名字、习惯照配置，先挑习惯不一样的）；彩池桌默认补、赌场桌默认不补；钱由赌场出；赌命桌不补", () => {
  const one = G.newHand({ seed: "N1", kind: "pool", deal: D0, players: [A()] });
  assert.equal(one.players.length, 4);
  const npcs = one.players.filter(p => p.npc);
  assert.equal(npcs.length, 3);
  assert.equal(new Set(npcs.map(p => p.style)).size, 3, "习惯各不一样");
  npcs.forEach(p => {
    const r = CFG.npc.roster.find(x => x.id === p.id);
    assert.ok(r, "名单里的人：" + p.id);
    assert.deepEqual([p.name, p.style], [r.name, r.style]);
    assert.equal(p.paid, 0);
  });
  assert.deepEqual(J(G.toAct(one)), ["a"], "NPC 自己押：等的只有真人");
  assert.ok(one.log.some(e => e.t === "npc" && /^NPC 赌客入座：.+（.+型）.*押的是赌场的钱。$/.test(e.text)));
  // 钱由赌场出：每人 stack × 第一轮每格最低注（这一手开局时，还没押的那几位手上正好这么多）
  const stack = CFG.npc.stack * G.tableOf("street").minBet[0];
  npcs.forEach(p => assert.equal(p.chips + sum(p.slips), stack, p.name));
  assert.equal(G.newHand({ seed: "N2", kind: "pool", deal: D0, players: [A(), B()] }).players.filter(p => p.npc).length, 2);
  assert.equal(G.newHand({ seed: "N3", kind: "pool", deal: D0, players: [A(), B(), Cc(), seat("d", "丁")] }).players.length, 4, "人够了不补");
  assert.equal(G.newHand({ seed: "N4", kind: "pool", npc: false, deal: D0, players: [A()] }).players.length, 1, "npc: false 不补");
  const six = G.newHand({ seed: "N5", kind: "pool", npc: 6, deal: D0, players: [A()] });
  assert.equal(six.players.length, 6, "写数字：补到这么多个");
  assert.equal(new Set(six.players.filter(p => p.npc).map(p => p.style)).size, 4, "先把四种习惯都挑上，再补重复的");
  assert.equal(new Set(six.players.map(p => p.id)).size, 6);
  // fillTo 放配置
  CFG.npc.fillTo = 3;
  try { assert.equal(G.newHand({ seed: "N6", kind: "pool", deal: D0, players: [A()] }).players.length, 3); } finally { CFG.npc.fillTo = 4; }
  // 赌场桌默认不补；npc: true 补到 fillTo。NPC 在赌场桌照样交入场费（赌场给的钱），真人在赌场坐下时已经交过（entryPaid）照旧
  assert.equal(G.newHand({ seed: "H1", deal: D0, players: [A()] }).players.length, 1);
  const house = G.newHand({ seed: "H2", kind: "house", npc: true, table: "guess-hall", entryPaid: true, deal: D0, players: [seat("me", "你", 40)] });
  assert.equal(house.players.length, 4);
  assert.deepEqual([house.players[0].paid, house.players[0].chips + sum(house.players[0].slips)], [2, 40]);
  house.players.filter(p => p.npc).forEach(p => {
    assert.equal(p.paid, 2);
    assert.equal(p.chips + sum(p.slips), stack - 2, p.name);
  });
  // 指定坐下的 NPC（以后一张桌子连着几手坐同一批人用）：照写的名字、习惯；补的时候不挑重复的 id，习惯先挑不一样的
  const fixed = G.newHand({ seed: "F", kind: "pool", deal: D0, players: [A(), { id: "npc-han", name: "老韩", npc: true, style: "cautious", chips: 50 }] });
  assert.equal(fixed.players.length, 4);
  assert.equal(fixed.players[1].chips + sum(fixed.players[1].slips), 50);
  assert.equal(fixed.players.filter(p => p.id === "npc-han").length, 1);
  assert.ok(!fixed.players.slice(2).some(p => p.style === "cautious"), "补的两位和老韩的习惯不一样");
  assert.throws(() => G.newHand({ seed: "F", kind: "pool", deal: D0, players: [A(), { id: "x", npc: true, style: "nope" }] }), /没有这种 NPC 下注习惯/);
  assert.throws(() => G.newHand({ seed: "F", kind: "pool", deal: D0, players: [{ id: "x", npc: true, style: "gambler" }] }), /至少要有一名玩家/);
  // NPC 不能替它押
  const n = npcs[0];
  assert.throws(() => G.act(one, n.id, { type: "pass" }), /NPC 赌客，自己会押/);
  // 赌命桌只押坚毅：不开彩池、不补 NPC
  const life = CFG.life.id;
  assert.throws(() => G.newHand({ seed: "L", table: life, kind: "pool", players: [{ id: "ruby", name: "瑞比" }] }), /不开彩池桌/);
  assert.throws(() => G.newHand({ seed: "L", table: life, npc: true, players: [{ id: "ruby", name: "瑞比" }] }), /不补 NPC/);
  assert.equal(G.newHand({ seed: "L", table: life, players: [{ id: "ruby", name: "瑞比" }] }).players.length, 1, "赌命桌照旧一个人");
});

test("NPC 什么时候押：谨慎型、赌徒型一开这一轮就押（真人看得到），跟风型、算账型等真人都押完了再押（彩池的赔率翻牌前还会变）", () => {
  const players = [A(), { id: "n1", name: "谨", npc: true, style: "cautious" }, { id: "n2", name: "跟", npc: true, style: "follower" }];
  const h = pool({ players });
  const [, n1, n2] = h.players;
  assert.equal(n1.acted[1], "bet", "谨慎型开局就押了");
  assert.equal(n2.acted[1], undefined, "跟风型还没押");
  assert.deepEqual(J(G.toAct(h)), ["a"]);
  const va = J(G.view(h, "a"));
  assert.equal(va.pool.rounds[0].staked, sum(n1.slips), "真人押之前，板子上已经有谨慎型的钱");
  assert.equal(J(G.view(h, "n2")).myTurn, true, "跟风型的画面：还没押");
  assert.equal(J(G.view(h, "n1")).myTurn, false);
  bet(h, "a", { 2: 20 });
  assert.equal(h.stage, "bet2");
  // 跟风型跟着押得最多的那格：甲押了 +2 20 枚，比谨慎型押的多
  assert.deepEqual(J(n2.slips.filter(x => x.round === 1).map(x => x.result)), [2]);
  const order = J(h.log.filter(e => e.t === "bet" && e.r === 1).map(e => e.by));
  assert.deepEqual(order, ["n1", "a", "n2"], "记录的顺序：谨慎型 → 真人 → 跟风型");
});

test("NPC 只看公开的信息：盖着的牌不一样、种子一样，押的一模一样（D0 / D2 只差最后才翻的层牌：三轮都一样）；同一种子、同样的局面押得一样；NPC 的画面里没有盖着的牌和种子", () => {
  const playMe = (h) => {
    // 真人每轮押概率最高的一格最低注
    while (!h.over) {
      const L = G.legal(h, "a").find(o => o.type === "bet");
      if (L) bet(h, "a", { [L.cells.slice().sort((x, y) => y.k - x.k)[0].result]: L.min }); else pass(h, "a");
    }
    return h;
  };
  const bets = (h) => J(h.log.filter(e => e.t === "bet" || e.t === "pass").map(e => [e.r, e.by, e.text]));
  for (const kind of ["pool", "house"]) {
    const x = playMe(G.newHand({ seed: "same", kind, npc: true, deal: D0, players: [A()] }));
    const y = playMe(G.newHand({ seed: "same", kind, npc: true, deal: D2, players: [A()] }));
    assert.ok(x.players.filter(p => p.npc).length === 3 && bets(x).length >= 6, kind);
    assert.deepEqual(bets(y), bets(x), kind + "：盖着的层牌不一样，NPC 三轮押的一模一样");
    assert.notDeepEqual(J(x.result), J(y.result));
    // 同一种子、同样的牌、同样的真人：整手一模一样（可以复现）
    const z = playMe(G.newHand({ seed: "same", kind, npc: true, deal: D0, players: [A()] }));
    assert.deepEqual(J(z.log), J(x.log), kind);
    assert.deepEqual(J(z.players), J(x.players), kind);
    // 只差元素（第一轮就盖着）：第一轮 NPC 押的一样
    const e = playMe(G.newHand({ seed: "same", kind, npc: true, deal: { element: "acid", weather: "heat", layer: "armor" }, players: [A()] }));
    assert.deepEqual(bets(e).filter(r => r[0] === 1), bets(x).filter(r => r[0] === 1), kind + "：第一轮");
  }
  // 换种子：坐下的 NPC、押法跟着变（几个种子不会全都一样）
  const lineups = ["s1", "s2", "s3", "s4", "s5", "s6"].map(s => playMe(G.newHand({ seed: s, kind: "pool", deal: D0, players: [A()] })))
    .map(h => JSON.stringify([h.players.map(p => p.id), bets(h)]));
  assert.ok(new Set(lineups).size > 1);
  // NPC 的画面：和真人一样没有盖着的牌、种子；两手只差盖着的牌时画面一模一样
  const p = G.newHand({ seed: "V", kind: "pool", deal: D0, players: [A()] });
  const q = G.newHand({ seed: "V", kind: "pool", deal: { element: "ice", weather: "phase", layer: "spirit" }, players: [A()] });
  p.players.filter(x => x.npc).forEach(n => {
    const vp = J(G.view(p, n.id)), vq = J(G.view(q, n.id));
    assert.doesNotMatch(JSON.stringify(vp), /secret|seed/);
    assert.deepEqual(vp.shown, { element: null, weather: null, layer: null });
    assert.equal(vp.me.npc, true);
    assert.deepEqual(vp, vq, n.name + "：盖着的牌不一样，画面一模一样");
  });
  assert.deepEqual(J(G.view(p, "a")), J(G.view(q, "a")));
});

test("NPC 的下注习惯（npcDecide 只读 view）：谨慎型押概率最高的；赌徒型押 ±2；跟风型跟押得最多的那格；算账型押「概率 × 赔率」最高的；每轮最多一格，押最低注 × 习惯里的倍数", () => {
  // 第二轮（翻了火，35 种）的一张赌场桌 view：赔率照固定赔率表
  const fire = [[-2, 5, 6], [-1, 10, 3], [0, 12, 2.5], [1, 6, 5], [2, 2, 16]];
  const view = (o) => Object.assign({
    round: 2, board: { N: 35 },
    legal: [{ type: "bet", round: 2, cells: fire.map(([result, k, odds]) => ({ result, k, odds })), min: 4, max: 40 }, { type: "pass" }],
    me: { slips: [] }, others: []
  }, o || {});
  const low = () => 0, high = () => 0.999;
  const S = CFG.npc.styles;
  const one = (d) => { assert.equal(d.type, "bet"); const k = Object.keys(d.bets); assert.equal(k.length, 1, "只押一格"); return [Number(k[0]), d.bets[k[0]]]; };
  // 谨慎型：第一轮押概率最高的 0（96 / 245）；第二轮火最高的 0 只有 12 / 35 < 0.35 → 不押；第三轮 0 / +1 各 2 / 5 → 押靠近 0 的
  const r1 = { round: 1, board: { N: 245 }, legal: [{ type: "bet", round: 1, cells: [[-2, 25, 8], [-1, 62, 3.5], [0, 96, 2], [1, 50, 4], [2, 12, 18]].map(([result, k, odds]) => ({ result, k, odds })), min: 2, max: 40 }, { type: "pass" }] };
  assert.deepEqual(one(G.npcDecide(view(r1), "cautious", low)), [0, 2]);
  assert.equal(S.cautious.minChance, 0.35);
  assert.deepEqual(J(G.npcDecide(view(), "cautious", low)), { type: "pass" });
  const r3 = { round: 3, board: { N: 5 }, legal: [{ type: "bet", round: 3, cells: [[0, 2, 2], [1, 2, 2], [2, 1, 4.5]].map(([result, k, odds]) => ({ result, k, odds })), min: 8, max: 40 }, { type: "pass" }] };
  assert.deepEqual(one(G.npcDecide(view(r3), "cautious", low)), [0, 8]);
  // 押多少：最低注 × stake 里的倍数（随机数小 → 少押，大 → 多押），手上不够就少押
  assert.deepEqual(one(G.npcDecide(view(r3), "cautious", high)), [0, 8 * S.cautious.stake[1]]);
  const poor = view(r3); poor.legal[0].max = 10;
  assert.deepEqual(one(G.npcDecide(poor, "cautious", high)), [0, 10]);
  // 赌徒型：±2 里挑一格（随机数决定）；±2 都不开就押概率最低的
  assert.deepEqual(one(G.npcDecide(view(), "gambler", low)), [-2, 4]);
  assert.deepEqual(one(G.npcDecide(view(), "gambler", high)), [2, 4 * S.gambler.stake[1]]);
  const noEdge = view(); noEdge.legal[0].cells = noEdge.legal[0].cells.filter(x => Math.abs(x.result) < 2);
  assert.deepEqual(one(G.npcDecide(noEdge, "gambler", low)), [1, 4], "−1（10）、0（12）、+1（6）里概率最低的 +1");
  // 跟风型：这一轮押得最多的那格（所有人的押注公开）；这一轮还没人押看前几轮；都没有押概率最高的
  const crowd = view({ others: [{ slips: [{ round: 2, result: 1, amount: 8 }, { round: 1, result: -1, amount: 30 }] }, { slips: [{ round: 2, result: -1, amount: 4 }] }] });
  assert.deepEqual(one(G.npcDecide(crowd, "follower", low)), [1, 4]);
  const before = view({ others: [{ slips: [{ round: 1, result: -1, amount: 30 }, { round: 1, result: 2, amount: 6 }] }] });
  assert.deepEqual(one(G.npcDecide(before, "follower", low)), [-1, 4]);
  assert.deepEqual(one(G.npcDecide(view(), "follower", low)), [0, 4]);
  // 算账型（赌场桌）：概率 × 赔率：+2 = 2 / 35 × 16 ≈ 0.91 最高（别的都是 6 / 7 ≈ 0.86）；minValue 抬到 0.95 → 第二轮不押，第一轮照押
  assert.deepEqual(one(G.npcDecide(view(), "counter", low)), [2, 4]);
  S.counter.minValue = 0.95;
  try {
    assert.deepEqual(J(G.npcDecide(view(), "counter", low)), { type: "pass" });
    assert.equal(G.npcDecide(view(r1), "counter", low).type, "bet");
  } finally { S.counter.minValue = 0.85; }
  // 算账型（彩池桌）：按把自己这一注放进池子以后的赔率算——大家都压在 0 和 +1，没人押的 −1（10 / 35）最划算
  const pooled = view({
    legal: [{ type: "bet", round: 2, cells: fire.map(([result, k]) => ({ result, k, odds: null })), min: 4, max: 40, pool: true }, { type: "pass" }],
    pool: { rake: 10, stakeBack: true, carry: "next", digits: 1, rounds: [null, { round: 2, carryIn: 0, staked: 40,
      cells: fire.map(([result]) => ({ result, staked: result === 0 ? 30 : result === 1 ? 10 : 0 })) }, null] }
  });
  assert.deepEqual(one(G.npcDecide(pooled, "counter", low)), [-1, 4]);
  // 没有能押的（手上不够最低注）：不押
  assert.deepEqual(J(G.npcDecide(view({ legal: [{ type: "pass" }] }), "gambler", low)), { type: "pass" });
  assert.throws(() => G.npcDecide(view(), "nope", low), /没有这种 NPC 下注习惯/);
});

test("同桌的人（含 NPC）每一轮押了哪几格、押多少都公开：view 的 others 带 NPC 的名字和习惯，看不到别人手上的筹码；NPC 的输赢进排名", () => {
  const h = G.newHand({ seed: "O", kind: "pool", deal: D0, players: [A()] });
  bet(h, "a", { 0: 4 });
  const v = J(G.view(h, "a"));
  assert.equal(v.others.length, 3);
  v.others.forEach(o => {
    const p = h.players.find(x => x.id === o.id);
    assert.equal(o.npc, true);
    assert.equal(o.style, p.style);
    assert.equal(o.styleName, CFG.npc.styles[p.style].name);
    assert.equal(o.chips, undefined, "别人手上还有多少不公开");
    assert.deepEqual(o.slips, J(p.slips.map(x => ({ round: x.round, result: x.result, odds: null, amount: x.amount }))), o.name);
  });
  assert.equal(v.me.npc, undefined, "真人没有 npc 标记");
  // 第一轮所有人的押注都在板子上
  assert.equal(v.pool.rounds[0].staked, sum(slipsOf(h, 1)));
  while (!h.over) pass(h, "a");
  const r = J(G.view(h, "a").ranking);
  assert.equal(r.length, 4, "NPC 也排");
  assert.deepEqual(r.map(x => x.net), r.map(x => x.net).slice().sort((x, y) => y - x), "按净输赢从多到少");
  r.forEach(x => {
    const p = h.players.find(y => y.id === x.id);
    assert.deepEqual([x.npc, x.net, x.won, x.staked], [!!p.npc, p.won - sum(p.slips), p.won, sum(p.slips)]);
  });
});

test("钱守恒（很多手随机押）：每一轮 拿回的 + 赌场拿的 + 滚存 = 滚存进来的 + 押进来的；每人分得 floor(池子 × 注 ÷ 押中的注)；押中的至少拿回本金；滚存一手接一手", () => {
  let carry = [0, 0, 0], hands = 0, wins = 0, carried = 0;
  for (let i = 0; i < 40; i++) {
    const seed = "C" + i, rng = CC.makeRng(seed + "|test");
    const h = G.newHand({ seed, kind: "pool", players: [A(60), B(60)], carry });
    const start = h.players.map(p => p.chips + sum(p.slips));
    while (!h.over) {
      const id = G.toAct(h)[0], L = G.legal(h, id).find(o => o.type === "bet");
      if (!L || rng() < 0.2) { pass(h, id); continue; }
      const cell = L.cells[Math.floor(rng() * L.cells.length)];
      bet(h, id, { [cell.result]: Math.min(L.max, L.min * (1 + Math.floor(rng() * 3))) });
    }
    hands++;
    h.pool.rounds.forEach((R, k) => {
      assert.equal(R.carryIn, carry[k]);
      const slips = slipsOf(h, R.round), hit = sum(slips.filter(x => x.win));
      assert.equal(R.staked, sum(slips));
      assert.equal(R.paid + R.house + R.carryOut, R.carryIn + R.staked, seed + " 第 " + R.round + " 轮");
      assert.equal(R.rake, Math.min(Math.floor(R.staked / 10), R.carryIn + R.staked - hit));
      slips.forEach(x => {
        assert.equal(x.pay, x.win ? Math.floor(R.net * x.amount / hit) : 0);
        if (x.win) { assert.ok(x.pay >= x.amount, "押中的至少拿回本金"); wins++; }
      });
      assert.ok(R.left >= 0 && (hit === 0 || R.left < slips.filter(x => x.win).length), "分剩的零头不到押中的人数");
    });
    // 每个人（含 NPC）手上的变化 = 拿回的 − 押的；所有人 + 赌场 + 滚存 = 带上桌的 + 滚存进来的
    h.players.forEach((p, k) => assert.equal(p.chips, start[k] - sum(p.slips) + p.won));
    const house = h.pool.rounds.reduce((s, R) => s + R.house, 0);
    const out = G.carryOf(h);
    assert.equal(h.players.reduce((s, p) => s + p.chips, 0) + house + out.reduce((s, n) => s + n, 0),
      start.reduce((s, n) => s + n, 0) + carry.reduce((s, n) => s + n, 0));
    carried += out.reduce((s, n) => s + n, 0) > 0 ? 1 : 0;
    carry = out;
  }
  assert.equal(hands, 40);
  assert.ok(wins > 20 && carried > 5, "押中的、滚存的都有：" + wins + " / " + carried);
});

/* ---------- 一个人坐的桌子照旧 ---------- */

test("一个人坐的赌场桌、赌命桌照旧：没有 NPC、没有彩池、没有排名，记录和以前一样（开局 → 押注 → 翻牌 → 结果 → 拿回）", () => {
  const h = G.newHand({ seed: "solo", deal: D0, players: [seat("p", "你", 50)] });
  assert.equal(h.players.length, 1);
  assert.equal(h.pool, undefined);
  assert.equal(h.table.kind, "house");
  bet(h, "p", { 0: 2 }); pass(h, "p"); pass(h, "p");
  assert.ok(h.over);
  assert.equal(h.ranking, undefined);
  assert.deepEqual(J(h.log.map(e => e.t)), ["open", "bet", "reveal", "pass", "reveal", "pass", "reveal", "result", "pay"]);
  assert.equal(h.log[0].text, "街边桌：庄家抽了一张元素、一张天气、一张层牌，都盖在桌上。入场费 2 枚（不退）。");
  const v = J(G.view(h, "p"));
  assert.equal(v.pool, undefined);
  assert.equal(v.ranking, undefined);
  assert.deepEqual(v.others, []);
  assert.equal(v.table.kind, "house");
  const life = G.newHand({ seed: "L", table: CFG.life.id, deal: D0, players: [{ id: "ruby", name: "瑞比" }] });
  assert.equal(life.table.kind, "house");
  bet(life, "ruby", { 0: true }); pass(life, "ruby"); pass(life, "ruby");
  assert.equal(life.ranking, undefined);
  assert.deepEqual(J(G.lifeBill(life, "ruby")).lost, 0);
});
