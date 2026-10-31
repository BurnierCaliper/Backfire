// 联机赌场加上猜大猜小（#526 第 4 步）：
//   押筹码的赌场桌（#528 的 GUESS_CONFIG.casino 三张桌，casino.js · GAMES.guess）：庄家是赌场，每名玩家各坐各的、各打各的一手；
//   黑市赌命桌（押坚毅，主持人坐庄）：玩家在赌场浮层里让自己的角色上桌，这一手在房主这边，结算的那一下就把账交给 trpgBlackMarketSettle
//   （扣坚毅、扣光真死、发奖，和本机一样）；玩家的包里坚毅生命一个数字都没有（剩多少、扣了多少、lifeBill 都不发），只收到结论（永久死亡）。
// 都走真的联机指令，看每个人实际收到、过了 online-view.js 白名单的包（同 tests/casino-online-*.test.js）。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const X = require("./casino-online.helper");
const { room, ok, no, has, plain, V } = X;

// 火打肉体 · 酷暑 = +2（第一轮押 +2 是 18 倍）；火打装甲 · 酷暑 = 0（同 tests/casino-guess.test.js）
const PLUS2 = { element: "fire", weather: "heat", layer: "flesh" };
const ZERO = { element: "fire", weather: "heat", layer: "armor" };
/** 房主这边坐着的那一手换成指定的三张牌（测试用：规则层发牌按种子随机） */
/** 联机包里的文字是 online-view.js · text() 规整过的（NFKC：全角标点变半角） */
const N = (t) => t.normalize("NFKC");
const rig = (h, deal) => { h.secret = Object.assign({}, deal); return h; };
const guessHand = (r, kit) => r.book().wallets[kit].seat.game;
const lifeHand = (r, kit) => r.book().life[kit].hand;
const lifeRow = (r, who, kit) => (r.casino(who).life || []).find(x => x.kit === kit) || null;
const bet = (r, who, kit, bets) => r.send(who, { op: "act", kit, action: { type: "bet", bets } });
const pass = (r, who, kit) => r.send(who, { op: "act", kit, action: { type: "pass" } });

test("猜大猜小 · 押筹码的赌场桌：联机能坐（庄家是赌场，没有主持人坐庄）；包里只有自己这一手（没翻开的牌、种子都没有）；打完一手离桌结算进钱包", () => {
  const r = room("CASINO-GUESS"), { send, casino, mine } = r;
  const ts = casino("p2").tables.filter(t => t.game === "guess");
  assert.deepEqual(plain(ts.map(t => [t.id, t.gm, t.gameName, plain(t.minBet)])),
    [["guess-alley", false, "猜大猜小", [2, 4, 8]], ["guess-hall", false, "猜大猜小", [2, 4, 8]], ["guess-vip", false, "猜大猜小", [2, 4, 8]]], "以前联机只列 High Flux / Flux 的桌子");
  ok(send("p2", { op: "open", kit: "ruby" }));                                          // 赠送 50 枚
  no(send("p2", { op: "sit", kit: "ruby", table: "guess-hall", buyIn: 40, dealer: "gm" }), /没有主持人坐庄/);
  ok(send("p2", { op: "sit", kit: "ruby", table: "guess-hall", buyIn: 40, dealer: "ai" }), "以前报「联机还不能坐」");
  rig(guessHand(r, "ruby"), PLUS2);
  const seat = mine("p2", "ruby").seat, g = seat.game;
  assert.deepEqual([seat.kind, seat.mode, seat.table, seat.side, seat.buyIn, seat.fee], ["ai", "guess", "guess-hall", "me", 40, 2]);
  assert.deepEqual([g.mode, g.stage, g.round, g.rounds, g.myTurn, g.over], ["guess", "bet1", 1, 3, true, false]);
  assert.deepEqual(plain(g.table), { id: "guess-hall", name: "大厅", entry: 2, life: false, minBet: [2, 4, 8] });
  assert.deepEqual(plain(g.shown), { element: null, weather: null, layer: null }, "三张都盖着");
  assert.deepEqual([g.me.chips, g.me.paid, g.minBet], [40, 2, 2], "买入 40 枚都在桌上：入场费坐下时从钱包收过了");
  assert.deepEqual(plain(g.legal.map(o => o.type)), ["bet", "pass"]);
  assert.deepEqual([g.legal[0].min, g.legal[0].max], [2, 40]);
  assert.ok(g.board.cells.some(c => c.result === 2 && c.open && c.odds === 18), "赔率表照规则层现算");
  for (const k of ["secret", "seed", "players", "others", "boards"]) assert.ok(!(k in g), "包里没有 " + k);
  assert.ok(!has(casino("p2"), "flesh"), "没翻开的层牌不在包里");
  assert.equal(g.logFrom, 0);
  assert.equal(g.log[0].text, N("大厅：庄家抽了一张元素、一张天气、一张层牌，都盖在桌上。入场费 2 枚（坐下时交给了赌场，不退）。"));
  // 第一轮押 +2：10 枚；后两轮不押
  no(bet(r, "p2", "ruby", { "2": 1 }), /每格至少押 2 枚/, "注额对不对由规则层查");
  ok(bet(r, "p2", "ruby", { "2": 10 }), "押注 bets 能过联机指令（以前只拷 type / card / amount……）");
  let v = mine("p2", "ruby").seat.game;
  assert.deepEqual([v.round, v.shown.element, v.me.chips], [2, "fire", 30]);
  assert.deepEqual(plain(v.me.slips), [{ result: 2, round: 1, odds: 18, amount: 10 }]);
  assert.deepEqual(plain(v.log.find(e => e.t === "reveal")), { r: 1, t: "reveal", card: "element", value: "fire", text: N("翻开元素：火。") }, "结算前的过渡要用翻开的是哪一张");
  ok(pass(r, "p2", "ruby")); ok(pass(r, "p2", "ruby"));
  v = mine("p2", "ruby").seat.game;
  assert.equal(v.over, true);
  assert.deepEqual(plain(v.result), { score: 2, element: "fire", weather: "heat", layer: "flesh" });
  assert.deepEqual([v.me.won, v.me.net, v.me.chips], [180, 168, 210], "押中：连本带利拿回 180 枚，这一手净赢 168 枚（含入场费）");
  assert.deepEqual(plain(v.me.slips[0]), { result: 2, round: 1, odds: 18, amount: 10, win: true, pay: 180 });
  assert.equal(v.log[v.log.length - 1].text, N("你押中，连本带利拿回 180 枚。"));
  // 离桌：桌上 210 枚 × 50 奎支 = 52.5 枚筹码回钱包（赢来的进普通筹码）
  const before = mine("p2", "ruby").chips;
  ok(send("p2", { op: "leave", kit: "ruby" }));
  const after = mine("p2", "ruby");
  assert.equal(after.seat, null);
  assert.equal(Math.round((after.chips.total - before.total) * 1000), 52500);
  assert.equal(after.chips.normal, 42.5, "赢的 42.5 枚是普通筹码");
  assert.equal(after.last, N("离开猜大猜小 · 大厅：桌上剩 210 枚（买入 40 枚，赢 170 枚），钱包多了 42.5 枚筹码。"));
});

test("猜大猜小 · 每名玩家各玩各的：两人坐同一张桌子是各自的一手；别人的押注、钱包不在自己的包里；桌上不够这一轮的最低注时从自己的钱包补（#528 照旧）", () => {
  const r = room("CASINO-GUESS-2"), { send, casino, mine } = r;
  ok(send("p2", { op: "open", kit: "ruby" })); ok(send("p3", { op: "open", kit: "helu" }));
  ok(send("p2", { op: "buy", kit: "ruby", n: 10 })); ok(send("p3", { op: "buy", kit: "helu", n: 10 }));   // 赠送 50 + 买 10：坐下后钱包剩 8 枚
  ok(send("p2", { op: "sit", kit: "ruby", table: "guess-vip", buyIn: 50, dealer: "ai" }));   // 贵宾室：桌上 1 枚 = 钱包 1 枚
  ok(send("p3", { op: "sit", kit: "helu", table: "guess-vip", buyIn: 50, dealer: "ai" }));
  rig(guessHand(r, "ruby"), PLUS2); rig(guessHand(r, "helu"), ZERO);
  assert.notEqual(guessHand(r, "ruby"), guessHand(r, "helu"), "各是各的一手");
  ok(bet(r, "p2", "ruby", { "2": 46 }));                                                   // 瑞比押 46 枚，手上剩 4 枚：正好够第二轮的最低注
  ok(bet(r, "p3", "helu", { "0": 50 }));                                                   // 赫鲁米卡全押 0：第二轮最低注 4 枚，从钱包补
  const a = mine("p2", "ruby").seat.game, b = mine("p3", "helu").seat.game;
  assert.deepEqual([a.me.chips, b.me.chips], [4, 4]);
  assert.ok(!b.log.some(e => /46/.test(e.text || "")), "别人押了多少不在自己的包里");
  assert.deepEqual(casino("p3").mine.map(m => m.kit), ["helu"], "别人的钱包不在自己的包里");
  const top = b.log.find(e => e.t === "topUp");
  assert.deepEqual([top.r, top.amount, top.text], [2, 4, N("你从钱包补了 4 枚到桌上。")], "联机这边也接上了「桌上不够先从钱包补」");
  assert.equal(mine("p3", "helu").seat.topUp, 4);
  assert.ok(!a.log.some(e => e.t === "topUp"), "够用就不补");
  ok(pass(r, "p2", "ruby")); ok(pass(r, "p2", "ruby"));
  ok(pass(r, "p3", "helu")); ok(pass(r, "p3", "helu"));
  assert.deepEqual([mine("p2", "ruby").seat.game.result.score, mine("p3", "helu").seat.game.result.score], [2, 0]);
  ok(send("p2", { op: "leave", kit: "ruby" })); ok(send("p3", { op: "leave", kit: "helu" }));
  // 第二轮补 4 枚没押；第三轮每格最低注 8 枚，又补 4 枚（钱包剩的正好够）：一共补 8 枚，算进总买入
  assert.match(mine("p3", "helu").last, /买入 58 枚,含从钱包补的 8 枚/);
});

/* ---------- 黑市赌命桌 ---------- */

/** 两个房间，只差瑞比还剩多少坚毅（1 点 / 50 点）：同样的指令、同样的牌 */
function twins() {
  const A = room("CASINO-LIFE"), B = room("CASINO-LIFE");
  A.hero("ruby").shp = 1;
  B.hero("ruby").shp = 50; B.hero("ruby").shpMax = 60;
  return [A, B];
}
const sameLife = (A, B, what) => assert.equal(JSON.stringify(lifeRow(A, "p2", "ruby")), JSON.stringify(lifeRow(B, "p2", "ruby")), what);

test("黑市赌命桌（联机）：玩家让自己的角色上桌，押坚毅；扣坚毅、真死都在房主那边（trpgBlackMarketSettle）；坚毅剩 1 点和剩 50 点，玩家收到的包一模一样，只有结论（永久死亡）不同", () => {
  const [A, B] = twins();
  for (const r of [A, B]) {
    no(r.send("p3", { op: "lifeSit", kit: "ruby" }), /只能用自己角色的钱包/, "只能让自己的角色上桌");
    ok(r.send("p2", { op: "lifeSit", kit: "ruby" }), "以前联机不开赌命桌");
    rig(lifeHand(r, "ruby"), ZERO);
  }
  const g = lifeRow(A, "p2", "ruby");
  assert.deepEqual([g.kit, g.name, g.dead], ["ruby", "瑞比", false]);
  assert.deepEqual([g.game.mode, g.game.table.life, g.game.table.name, g.game.table.dealer, g.game.myTurn], ["guess", true, "黑市赌命桌", "黑市庄家", true]);
  assert.deepEqual(plain(g.game.legal.map(o => Object.keys(o).sort())), [["cells", "round", "type"], ["type"]], "押注只有能押哪几格（每格押上几点是规则文字，牌桌照配置写）");
  assert.deepEqual(plain(A.casino("p2").mine.map(m => m.kit)), ["ruby"]);
  assert.equal(A.casino("p3").life.length, 0, "别人的赌命桌不在自己的包里");
  sameLife(A, B, "上桌：一模一样");
  // 第一轮押 +2、−1 两格；后两轮不押：结果 0，两格都押输（押上的 1 + 1 点由房主扣）
  for (const r of [A, B]) ok(bet(r, "p2", "ruby", { "2": true, "-1": true }));
  sameLife(A, B, "押了一轮：一模一样");
  for (const r of [A, B]) ok(pass(r, "p2", "ruby"));
  sameLife(A, B, "第二轮不押：一模一样");
  const raw = lifeHand(B, "ruby");
  assert.equal(raw.over, false);
  for (const r of [A, B]) ok(pass(r, "p2", "ruby"));
  // 房主这边：剩 1 点的扣光真死（状态记成死亡），剩 50 点的扣 2 点
  assert.equal(A.hero("ruby").dead, true);
  assert.equal(A.c.trpgHeroStatus(A.hero("ruby")), "dead");
  assert.deepEqual([B.hero("ruby").dead, B.hero("ruby").shp], [false, 48]);
  // 玩家这边：这一手的 view 一模一样，结论不同（死没死）
  const la = lifeRow(A, "p2", "ruby"), lb = lifeRow(B, "p2", "ruby");
  assert.deepEqual([la.dead, lb.dead], [true, false], "只收到结论：永久死亡");
  assert.equal(JSON.stringify(la.game), JSON.stringify(lb.game), "结算后的这一手也一模一样（押输了几点、还剩多少都不在里面）");
  assert.equal(la.game.over, true);
  assert.deepEqual([la.game.me.hurt, plain(la.game.me.prize)], [true, { kuizhi: 0, items: [] }], "坚毅受没受创、奖品");
  assert.deepEqual(plain(la.game.me.slips.map(x => [x.result, x.win])), [[2, false], [-1, false]]);
  // 死了的角色不再有钱包那一行，赌命桌上这一手还在（看完离桌）
  assert.deepEqual(plain(A.casino("p2").mine), [], "瑞比死了：钱包不再列");
  for (const [r, kit] of [[A, "ruby"], [B, "ruby"]]) {
    const pkt = JSON.stringify(r.view("p2"));
    assert.doesNotMatch(pkt, /shp|lifeBill|"lost"|"due"|"stake"/i, "包里没有坚毅的字段");
    assert.ok(!JSON.stringify(lifeRow(r, "p2", kit)).includes("minBet"), "每轮的固定代价也不放");
  }
  // 死在桌上的：操控他的玩家能离桌；别人不能
  no(A.send("p3", { op: "leave", kit: "ruby" }), /没有这名角色|只能让自己的角色离桌/);
  ok(A.send("p2", { op: "leave", kit: "ruby" }), "死了也能看完离桌");
  assert.equal(lifeRow(A, "p2", "ruby"), null);
  no(A.send("p2", { op: "lifeSit", kit: "ruby" }), /没有这名角色/, "死了不能再上桌");
  // 活着的：结算了随时能走，也能再来一手
  ok(B.send("p2", { op: "lifeSit", kit: "ruby" }), "这一手结算了再上桌 = 再来一手");
  assert.equal(lifeRow(B, "p2", "ruby").game.over, false);
  assert.equal(B.book().life.ruby.n, 2);
  ok(B.send("p2", { op: "leave", kit: "ruby" }), "还没押：随时能走");
  assert.equal(lifeRow(B, "p2", "ruby"), null);
});

test("黑市赌命桌：押中按赔率赢奎支（进这名角色的钱包），玩家的包里只有奖品和「坚毅无损」（没有坚毅的数字）", () => {
  const r = room("CASINO-LIFE-WIN"), { send, c } = r;
  const purse = c.trpgPurse("ruby"), shp = r.hero("ruby").shp;
  ok(send("p2", { op: "lifeSit", kit: "ruby" }));
  rig(lifeHand(r, "ruby"), PLUS2);
  const odds = lifeRow(r, "p2", "ruby").game.board.cells.find(x => x.result === 2).odds;
  ok(bet(r, "p2", "ruby", { "2": true }));                                              // 第一轮押 +2：押上 1 点 × 赔率
  ok(pass(r, "p2", "ruby")); ok(pass(r, "p2", "ruby"));
  const g = lifeRow(r, "p2", "ruby").game, L = c.CounterCardsGuess.GUESS_CONFIG.life;
  assert.deepEqual([g.over, g.result.score, g.me.hurt], [true, 2, false]);
  assert.equal(g.me.prize.kuizhi, Math.floor(odds) * L.kuizhiPerPoint);
  assert.equal(c.trpgPurse("ruby"), purse + g.me.prize.kuizhi, "奎支进瑞比的钱包");
  assert.equal(r.hero("ruby").shp, shp, "押中了：坚毅不动");
  const pay = g.log.find(e => e.t === "pay");
  assert.ok(pay && pay.text && pay.text.startsWith(N("瑞比：押中 1 格，赢得 ")), "不带「坚毅」两个字的记录照常发文字");
});

test("黑市赌命桌：押了还没结算不能离桌（主持人能让他离桌，这一手不算）；一名角色同一时间只坐一张桌子；刷新（存档读回来）以后这一手还在", () => {
  const r = room("CASINO-LIFE-STUCK"), { send, casino, c, book } = r;
  const shp = r.hero("ruby").shp;
  ok(send("p2", { op: "open", kit: "ruby" }));
  ok(send("p2", { op: "lifeSit", kit: "ruby" }));
  no(send("p2", { op: "lifeSit", kit: "ruby" }), /已经坐在黑市赌命桌上了/);
  no(send("p2", { op: "sit", kit: "ruby", table: "guess-hall", buyIn: 40, dealer: "ai" }), /已经坐在黑市赌命桌上了/, "坐着赌命桌不能再坐赌场的桌子");
  no(send("p2", { op: "pvpOpen", kit: "ruby", side: "player", stakeKind: "chips" }), /已经坐在黑市赌命桌上了/);
  rig(lifeHand(r, "ruby"), ZERO);
  ok(bet(r, "p2", "ruby", { "2": true }));
  no(send("p2", { op: "leave", kit: "ruby" }), /押了还没结算，不能离桌/, "半路走掉就是白看了牌");
  // 刷新：存档读回来，这一手还在，接着押
  c.LEDGER.casino = JSON.parse(JSON.stringify(c.LEDGER.casino));
  const g = lifeRow(r, "p2", "ruby").game;
  assert.deepEqual([g.round, g.shown.element, g.me.slips.length], [2, "fire", 1], "读回来还是这一手");
  ok(pass(r, "p2", "ruby"));
  // 主持人在「谁坐在哪桌」里看得到（公开的：第几轮），能让他离桌：这一手不算，坚毅不动
  const row = casino("host").seated.find(s => s.kit === "ruby");
  assert.deepEqual([row.kind, row.mode, row.tableName, row.round, row.over], ["life", "guess", "黑市赌命桌", 3, false]);
  assert.ok(!casino("p2").seated.length, "别人看不到谁坐在哪桌");
  ok(send("host", { op: "leave", kit: "ruby" }));
  assert.equal(book().life.ruby, undefined);
  assert.equal(r.hero("ruby").shp, shp, "主持人让他离桌：这一手押了还没结算的不算");
  // 坐着赌场的桌子不能上赌命桌
  ok(send("p2", { op: "sit", kit: "ruby", table: "alley", buyIn: 20, dealer: "ai" }));
  no(send("p2", { op: "lifeSit", kit: "ruby" }), /已经坐在赌场的桌上了/);
});

/* ---------- 白名单 ---------- */

test("白名单（online-view.js · projectGuessGame）：没翻开的牌、种子、别人的押注不放；赌命桌坚毅的数字（shp / shpMax / lost / due / stake / minBet）一个都不放，带「坚毅」的记录只留 t / r / by", () => {
  const chips = { mode: "guess", table: { id: "guess-hall", name: "大厅", life: false, dealer: null, mult: 1, entry: 2, minBet: [2, 4, 8], secret: "SECRET-1" },
    stage: "bet2", round: 2, rounds: 3, over: false, shown: { element: "fire", weather: null, layer: null, extra: "SECRET-2" }, secret: { element: "fire", weather: "SECRET-3", layer: "SECRET-4" }, seed: "SECRET-5",
    board: { N: 35, cells: [{ result: 2, k: 5, odds: 6, open: true, secret: "SECRET-6" }, { result: 0, k: 35, odds: null, open: false }] }, minBet: 4, waiting: ["me"], myTurn: true,
    legal: [{ type: "bet", round: 2, cells: [{ result: 2, odds: 6, k: 5, secret: "SECRET-7" }], min: 4, max: 30 }, { type: "pass" }, { type: "SECRET-8" }],
    me: { id: "me", name: "你", in: true, acted: { 1: "bet", 2: "SECRET-9" }, slips: [{ round: 1, result: 2, odds: 18, amount: 10, secret: "SECRET-10" }], chips: 30, paid: 2, hand: ["SECRET-11"] },
    others: [{ id: "p9", name: "SECRET-12", slips: [{ round: 1, result: 0, amount: 99 }] }], players: [{ id: "SECRET-13" }],
    result: null, log: [{ r: 1, t: "open", text: "大厅：庄家抽了……" }, { r: 1, t: "bet", by: "me", text: "你押 +2（18 倍）10 枚。", secret: "SECRET-14" },
      { r: 1, t: "reveal", card: "element", value: "fire", text: "翻开元素：火。" }, { r: 2, t: "peek", to: "me", text: "SECRET-15" }] };
  const life = { mode: "guess", table: { id: "black", name: "黑市赌命桌", life: true, dealer: "黑市庄家", mult: 1, entry: 0, minBet: [1, 2, 4], stake: [1, 2, 4] },
    stage: "over", round: 3, rounds: 3, over: true, shown: { element: "fire", weather: "heat", layer: "armor" }, board: { N: 5, cells: [{ result: 0, k: 3, odds: 1.5, open: true }] },
    minBet: 4, waiting: [], myTurn: false, legal: [],
    me: { id: "ruby", name: "瑞比", in: true, acted: { 1: "bet" }, slips: [{ round: 1, result: 2, odds: 18, stake: 1, win: false }, { round: 1, result: -1, odds: 3.5, stake: 1, win: false }],
      prize: { kuizhi: 0, items: [] }, hurt: true, due: 2, lost: 2, shp: 37, shpMax: 53, shpBase: 30 },
    lifeBill: { lost: 2, prize: { kuizhi: 0, items: [] }, hurt: true }, result: { score: 0, element: "fire", weather: "heat", layer: "armor" },
    log: [{ r: 1, t: "open", text: "黑市赌命桌：黑市庄家抽了一张元素、一张天气、一张层牌，都盖在桌上。押的是坚毅生命，每格押上固定的点数。" },
      { r: 1, t: "bet", by: "ruby", text: "瑞比押上坚毅：+2（18 倍，押上 1 点）、−1（3.5 倍，押上 1 点）。" },
      { r: 1, t: "reveal", card: "element", value: "fire", text: "翻开元素：火。" }, { r: 3, t: "result", score: 0, text: "结果：火打装甲，天气酷暑——0。" },
      { r: 3, t: "pay", by: "ruby", text: "瑞比：没押中；坚毅受创（扣 2 点，剩 35 点）。" }, { r: 3, t: "shp", text: "坚毅 37 → 35" }] };
  const raw = { playerId: "p2", hostId: "host", casino: { config: {}, tables: [], open: [], holdem: [],
    mine: [{ kit: "ruby", name: "瑞比", purse: 1, chips: {}, sellable: 0, last: "", seat: { kind: "ai", mode: "guess", table: "guess-hall", tableName: "猜大猜小 · 大厅", side: "me", buyIn: 40, fee: 2, rate: 50, game: chips } }],
    dealing: [], seated: [{ kit: "ruby", name: "瑞比", kind: "life", mode: "guess", table: "black", tableName: "黑市赌命桌", round: 3, over: true, shp: 37 }], gmSeats: [],
    life: [{ kit: "ruby", name: "瑞比", dead: false, game: life, shp: 37, lifeBill: { lost: 2 } }] } };
  const out = V.projectView(raw, { recipientId: "p2" }).casino;
  const s = JSON.stringify(out);
  assert.ok(!s.includes("SECRET"), s);
  const g = out.mine[0].seat.game;
  assert.deepEqual([g.mode, out.mine[0].seat.side], ["guess", "me"]);
  assert.deepEqual(plain(g.shown), { element: "fire", weather: null, layer: null });
  assert.deepEqual(plain(g.legal), [{ type: "bet", cells: [{ result: 2, odds: 6, k: 5 }], round: 2, min: 4, max: 30 }, { type: "pass" }]);
  assert.deepEqual(plain(g.me.acted), { 1: "bet" });
  assert.deepEqual(plain(g.log.map(e => e.t)), ["open", "bet", "reveal"], "只给别人看的（to）不放");
  assert.deepEqual(plain(out.seated), [], "不是主持人：没有谁坐在哪桌");
  // 赌命桌
  const l = out.life[0], lg = l.game;
  assert.deepEqual([l.kit, l.name, l.dead, lg.table.life], ["ruby", "瑞比", false, true]);
  assert.deepEqual(plain(lg.table), { id: "black", name: "黑市赌命桌", dealer: "黑市庄家", life: true }, "没有每轮的固定代价（minBet / stake）、入场费");
  assert.ok(!("minBet" in lg), "这一轮的固定代价也不放");
  assert.deepEqual(plain(lg.me.slips), [{ result: 2, round: 1, odds: 18, win: false }, { result: -1, round: 1, odds: 3.5, win: false }], "押注只有押哪一格、锁定的赔率、押中没有");
  assert.deepEqual([lg.me.hurt, plain(lg.me.prize)], [true, { kuizhi: 0, items: [] }]);
  const ls = JSON.stringify(out.life);
  for (const k of ["shp", "shpMax", "shpBase", "lost", "due", "lifeBill", "stake", "minBet", "37", "35 点"]) assert.ok(!ls.includes(k), "赌命桌的包里没有 " + k + "：" + ls);
  assert.deepEqual(plain(lg.log), [{ r: 1, t: "open" }, { r: 1, t: "bet", by: "ruby" }, { r: 1, t: "reveal", card: "element", value: "fire", text: N("翻开元素：火。") },
    { r: 3, t: "result", score: 0, text: N("结果：火打装甲，天气酷暑——0。") }, { r: 3, t: "pay", by: "ruby" }], "带「坚毅」两个字的几条只留 t / r / by，别的记录（shp）丢掉");
  // 主持人：谁坐在赌命桌（没有牌、没有坚毅）
  const gm = V.projectView(Object.assign({}, raw, { playerId: "host" }), { recipientId: "host" }).casino;
  assert.deepEqual(plain(gm.seated), [{ table: "black", tableName: "黑市赌命桌", round: 3, over: true, kind: "life", mode: "guess", kit: "ruby", name: "瑞比" }]);
});

/* ---------- 联机大厅 ---------- */

test("联机大厅（casino-online-ui.js）：猜大猜小的桌子写「坐下（赌场坐庄）」、每格最低注；黑市赌命桌「上桌」（不写坚毅剩多少）；押了还没结算「离桌」灰掉；死在桌上的写「永久死亡」；主持人的「谁坐在哪桌」列出赌命桌", () => {
  const r = room("CASINO-GUESS-LOBBY"), { c, send, casino } = r;
  vm.runInContext(X.read("casino-online-ui.js"), c, { filename: "casino-online-ui.js" });
  const UI = c.CasinoOnlineUI, model = (who) => ({ casino: casino(who), kit: null, busy: false, error: "", amount: {},
    draft: { buy: 1, sell: 1, buyIn: {}, side: "player", stake: "chips", mode: "highflux", holdem: { table: null, buyIn: 0, size: 4 } } });
  let h = UI.playerHtml(model("p2"));
  assert.match(h, /data-cso="sit" data-kit="ruby" data-table="guess-hall" data-dealer="ai">坐下（赌场坐庄）/);
  assert.doesNotMatch(h, /data-table="guess-hall" data-dealer="gm"/, "猜大猜小没有主持人坐庄");
  assert.match(h, /庄家是赌场 · 每格最低注 2 \/ 4 \/ 8 枚/);
  assert.match(h, /黑市赌命桌（押坚毅，主持人坐庄）/);
  assert.match(h, /data-cso="lifeSit" data-kit="ruby">瑞比 上桌/);
  assert.match(h, /每格押上 1 \/ 2 \/ 4 点（第一 \/ 二 \/ 三轮），押坚毅永远能下/, "规则文字照配置写（固定代价）");
  ok(send("p2", { op: "lifeSit", kit: "ruby" }));
  rig(lifeHand(r, "ruby"), ZERO);
  h = UI.playerHtml(model("p2"));
  assert.match(h, /瑞比坐在黑市赌命桌/); assert.match(h, /data-cso="tableLife" data-kit="ruby"/);
  assert.match(h, /data-cso="leave" data-kit="ruby">离桌/, "还没押：能走");
  ok(bet(r, "p2", "ruby", { "2": true }));
  h = UI.playerHtml(model("p2"));
  assert.match(h, /data-cso="leave" data-kit="ruby" disabled title="押了还没结算/, "押了还没结算：离桌灰掉");
  assert.match(h, /押了 1 格/);
  assert.match(UI.gmHtml(model("host")), /瑞比<\/b> · 黑市赌命桌 · 你坐庄（押坚毅，庄家不用做决定） · 第 2 轮/);
  r.hero("ruby").shp = 1;
  ok(pass(r, "p2", "ruby")); ok(pass(r, "p2", "ruby"));
  h = UI.playerHtml(model("p2"));
  assert.match(h, /坚毅耗尽——永久死亡|永久死亡/);
  assert.match(h, /data-cso="tableLife" data-kit="ruby">看结算/);
  assert.match(h, /data-cso="leave" data-kit="ruby">离桌/, "结算了：能走");
});
