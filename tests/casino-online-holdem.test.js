// 联机赌场加上 Flux Hold'em（#526 第 2 步）：
//   赌场桌：一个人坐，其余座位是这张桌子难度的 AI（同本机的赌场桌）；
//   多人桌：玩家开桌（定每人买入、几人桌）→ 别的玩家坐空座位、主持人也能坐一个 → 开桌的人（或主持人）开局，空着的座位由这张桌子难度的 AI 补。
// 都走真的联机指令，看每个人实际收到、过了 online-view.js 白名单的包：别人的手牌、盖下的牌、牌堆的顺序、庄家偷看到的天气、别人的钱包都不在里面；
// 打完一局结算进钱包；打到一半离桌交给 AI 托管、打完自动结算；存档读回来（刷新）牌局还在。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const X = require("./casino-online.helper");
const { room, ok, no, has, plain, V, playOut } = X;

/** 甲（瑞比）、乙（赫鲁米卡）各买 n 枚普通筹码（多人桌的买入只能用普通筹码） */
function funded(n) {
  const r = room("CASINO-HOLDEM");
  ok(r.send("p2", { op: "open", kit: "ruby" })); ok(r.send("p3", { op: "open", kit: "helu" }));
  ok(r.send("p2", { op: "buy", kit: "ruby", n: n || 20 })); ok(r.send("p3", { op: "buy", kit: "helu", n: n || 20 }));
  return r;
}
const holdemTable = (r, who) => r.casino(who).holdem[0];
const actor = (r, who, kit) => ({ who, game: () => { const m = r.mine(who, kit); return m && m.seat ? m.seat.game : null; }, cmd: { kit } });
const gmActor = (r, table) => ({ who: "host", game: () => { const s = r.casino("host").gmSeats.find(x => x.table === table); return s ? s.game : null; }, cmd: { asGm: true, table } });

test("Flux Hold'em · 赌场桌（一个人坐，其余是 AI）：联机能坐、主持人不能坐庄；包里别人只有张数；打完一局离桌结算进钱包", () => {
  const { send, mine, casino, book } = room("CASINO-HOLDEM-SOLO");
  const ts = casino("p2").tables.filter(t => t.game === "holdem");
  assert.deepEqual(ts.map(t => [t.id, t.gm, t.players]), [["holdem-alley", false, 4], ["holdem-hall", false, 4], ["holdem-vip", false, 4]]);
  ok(send("p2", { op: "open", kit: "ruby" }));
  no(send("p2", { op: "sit", kit: "ruby", table: "holdem-alley", buyIn: 20, dealer: "gm" }), /只有 AI，没有主持人坐庄/);
  ok(send("p2", { op: "sit", kit: "ruby", table: "holdem-alley", buyIn: 20, dealer: "ai" }), "以前联机坐不了 Flux Hold'em");
  const seat = mine("p2", "ruby").seat, g = seat.game;
  assert.deepEqual([seat.kind, seat.mode, seat.side, g.mode, g.side], ["ai", "holdem", "p1", "holdem", "p1"]);
  assert.deepEqual(plain(g.order), ["p1", "p2", "p3", "p4"]);
  assert.equal(g.me.hand.length, 3, "开局 3 张");
  assert.ok(g.seats.every(s => !("hand" in s) && !("card" in s)), "别人只有手牌张数、盖没盖");
  for (const k of ["elementDeck", "layerDeck", "deck", "sides", "seed"]) assert.ok(!(k in g), "包里没有 " + k);
  playOut(send, [actor({ mine }, "p2", "ruby")]);
  const raw = book().wallets.ruby.seat, before = mine("p2", "ruby").chips.total, back = raw.game.final.chips.p1 * raw.rate / 200;
  ok(send("p2", { op: "leave", kit: "ruby" }));
  assert.equal(Math.round((mine("p2", "ruby").chips.total - before) * 1000), Math.round(back * 1000), "桌上剩下的按倍率回钱包");
  assert.match(mine("p2", "ruby").last, /离开Flux Hold'em · 后巷小桌/);
});

test("Flux Hold'em · 多人桌：开桌 → 别的玩家坐下 → 主持人坐一个座位 → 开桌的人开局（空座位 AI 补）；两名联机玩家 + 主持人 + AI 同桌打完一局，各自结算", () => {
  const r = funded(20), { c, send, casino, mine, book } = r;
  no(send("p2", { op: "holdemOpen", kit: "ruby", table: "holdem-hall", buyIn: 10, size: 4 }), /最低买入 30 枚/);
  ok(send("p2", { op: "holdemOpen", kit: "ruby", table: "holdem-hall", buyIn: 30, size: 4 }));
  let t = holdemTable(r, "p3");
  assert.deepEqual([t.name, t.buyIn, t.size, t.host, t.started, t.difficulty], ["Flux Hold'em · 大厅", 30, 4, "瑞比", false, "normal"]);
  assert.deepEqual(plain(t.seats.map(s => [s.id, s.kind, s.name])), [["p1", "player", "瑞比"], ["p2", "empty", null], ["p3", "empty", null], ["p4", "empty", null]]);
  // 买入 30 枚 × 50 奎支 = 7.5 枚普通筹码，入场费 2 枚 × 50 = 0.5 枚（先拿赠送的）
  assert.deepEqual([mine("p2", "ruby").chips.normal, mine("p2", "ruby").chips.gift], [12.5, 49.5]);
  const s1 = mine("p2", "ruby").seat;
  assert.deepEqual([s1.kind, s1.mode, s1.side, s1.host, s1.started, s1.game], ["holdem", "holdem", "p1", true, false, null]);
  // 只有赠送筹码的不能坐（买入只能用普通筹码）
  ok(send("host", { op: "open", kit: "kolt" }));
  no(send("host", { op: "holdemJoin", kit: "kolt", table: t.id }), /买入只能用普通筹码/);
  ok(send("p3", { op: "holdemJoin", kit: "helu", table: t.id }));
  no(send("p2", { op: "holdemGm", table: t.id, asGm: true }), /只有主持人/);
  ok(send("host", { op: "holdemGm", table: t.id, asGm: true }));
  no(send("p3", { op: "holdemStart", kit: "helu", table: t.id }), /只有开桌的人或主持人能开局/);
  ok(send("p2", { op: "holdemStart", kit: "ruby", table: t.id }));
  t = holdemTable(r, "p3");
  assert.deepEqual(plain(t.seats.map(s => [s.id, s.kind, s.name])), [["p1", "player", "瑞比"], ["p2", "player", c.trpgPurseName("helu")], ["p3", "gm", "主持人"], ["p4", "ai", "AI 甲"]]);
  assert.equal(t.started, true);
  no(send("host", { op: "holdemJoin", kit: "kolt", table: t.id }), /已经开局了/);
  // 每个人只拿到自己那个座位的 view
  const ga = mine("p2", "ruby").seat.game, gb = mine("p3", "helu").seat.game, gg = casino("host").gmSeats[0].game;
  assert.deepEqual([ga.side, gb.side, gg.side], ["p1", "p2", "p3"]);
  assert.deepEqual(plain(ga.seats.map(s => s.name)), ["瑞比", c.trpgPurseName("helu"), "主持人", "AI 甲"]);
  assert.ok([ga, gb, gg].every(g => g.seats.every(s => !("hand" in s) && !("card" in s))));
  assert.deepEqual(plain(casino("p2").gmSeats), [], "主持人的座位只在主持人的包里");
  const h = book().tables[t.id].game;
  const raw = (id) => h.sides[id].hand;
  assert.deepEqual(plain(ga.me.hand), plain(raw("p1"))); assert.deepEqual(plain(gb.me.hand), plain(raw("p2")));
  // 庄家偷看到的那张只在庄家的包里（第 1 轮庄家是 p1 = 瑞比）
  assert.equal(h.dealer, "p1"); assert.equal(h.stage, "peek");
  assert.equal(ga.peek.card, h.deck[0], "庄家看得到偷看的那张");
  assert.ok(!("peek" in gb) && !("peek" in gg), "别人的包里没有偷看");
  const peekName = c.CounterCards.weatherName(h.deck[0]);
  assert.ok(!has(casino("p3"), peekName) && !has(casino("host"), peekName), "别人的包里没有偷看到的天气");
  // 别人的钱包不在包里
  assert.deepEqual(casino("p3").mine.map(m => m.kit), ["helu"]);
  // 打完一局：两名玩家 + 主持人轮着打，AI 在房主这边接着走
  playOut(send, [actor(r, "p2", "ruby"), actor(r, "p3", "helu"), gmActor(r, t.id)]);
  const fin = book().tables[t.id].game.final;
  assert.ok(fin && ["p1", "p2", "p3", "p4"].every(id => typeof fin.chips[id] === "number"));
  const sa = mine("p2", "ruby").seat.game;
  assert.equal(sa.over, true);
  assert.ok(sa.results.length >= 1 && sa.results.every(x => x.outcome === "fold" || Object.keys(x.shown).length >= 1), "亮牌的结果公开");
  // 离桌结算：桌上剩下的 × 50 奎支回钱包（普通筹码）
  const before = { ruby: mine("p2", "ruby").chips.normal, helu: mine("p3", "helu").chips.normal };
  ok(send("p2", { op: "leave", kit: "ruby" }));
  assert.equal(Math.round((mine("p2", "ruby").chips.normal - before.ruby) * 1000), Math.round(fin.chips.p1 * 50 / 200 * 1000));
  assert.match(mine("p2", "ruby").last, /离开Flux Hold'em · 大厅：桌上剩 -?\d+ 枚|离开Flux Hold'em · 大厅:桌上剩 -?\d+ 枚/);
  assert.ok(book().tables[t.id], "乙还没走，桌子还在");
  ok(send("p3", { op: "leave", kit: "helu" }));
  assert.equal(Math.round((mine("p3", "helu").chips.normal - before.helu) * 1000), Math.round(fin.chips.p2 * 50 / 200 * 1000));
  assert.equal(book().tables[t.id], undefined, "玩家都走了：这一桌收掉（主持人的座位一起空出来）");
  assert.deepEqual(plain(casino("host").gmSeats), []);
});

test("Flux Hold'em · 多人桌开局之前：离桌原样退回买入和入场费；开桌的人走了换下一位；没有玩家了这一桌收掉；主持人不坐也能开局", () => {
  const r = funded(20), { send, casino, mine, book } = r;
  const w0 = plain(book().wallets.ruby);
  ok(send("p2", { op: "holdemOpen", kit: "ruby", table: "holdem-alley", buyIn: 20, size: 3 }));
  const t = holdemTable(r, "p2");
  assert.equal(t.size, 3);
  no(send("p2", { op: "sit", kit: "ruby", table: "alley", buyIn: 20, dealer: "ai" }), /已经坐在桌上了/);
  ok(send("p3", { op: "holdemJoin", kit: "helu", table: t.id }));
  ok(send("p2", { op: "leave", kit: "ruby" }));
  assert.deepEqual(plain(book().wallets.ruby).gift, w0.gift, "赠送的原样退回");
  assert.equal(book().wallets.ruby.normal, w0.normal, "普通的原样退回");
  assert.equal(book().wallets.ruby.seat, null);
  assert.equal(holdemTable(r, "p3").host, r.c.trpgPurseName("helu"), "开桌的人走了：换下一位玩家");
  assert.ok(mine("p3", "helu").seat.host);
  // 主持人不坐也能开局：两个空座位由 AI 补
  ok(send("host", { op: "holdemStart", table: t.id, asGm: true }));
  assert.deepEqual(plain(holdemTable(r, "p3").seats.map(s => s.kind)), ["ai", "player", "ai"]);
  // 再开一桌，开桌的人一个人走掉：这一桌收掉
  ok(send("p2", { op: "holdemOpen", kit: "ruby", table: "holdem-alley", buyIn: 20, size: 2 }));
  const id2 = casino("p2").holdem.find(x => !x.started).id;
  ok(send("p2", { op: "leave", kit: "ruby" }));
  assert.equal(book().tables[id2], undefined);
});

test("Flux Hold'em · 多人桌打到一半离桌：交给 AI 托管（牌局不动），回来能接着打；托管着打完自动结算回钱包", () => {
  const r = funded(20), { send, casino, mine, book } = r;
  ok(send("p2", { op: "holdemOpen", kit: "ruby", table: "holdem-alley", buyIn: 20, size: 3 }));
  const id = holdemTable(r, "p2").id;
  ok(send("p3", { op: "holdemJoin", kit: "helu", table: id }));
  ok(send("p2", { op: "holdemStart", kit: "ruby", table: id }));
  const g0 = plain(book().tables[id].game.sides.p2);
  ok(send("p3", { op: "leave", kit: "helu" }));
  assert.equal(holdemTable(r, "p2").seats[1].auto, true, "大厅里写着托管");
  assert.equal(mine("p3", "helu").seat.auto, true, "钱包还坐在这一桌（钱在桌上）");
  assert.match(mine("p3", "helu").last, /交给 AI 托管/);
  assert.deepEqual(plain(book().tables[id].game.sides.p2.hand), g0.hand, "托管不动牌局");
  no(send("p3", { op: "act", kit: "helu", action: { type: "check" } }), /托管/);
  ok(send("p3", { op: "holdemBack", kit: "helu", table: id }));
  assert.equal(mine("p3", "helu").seat.auto, false, "回来接着打");
  ok(send("p3", { op: "leave", kit: "helu" }));
  // 甲一个人打完：乙的座位由 AI 走，打完自动结算回乙的钱包
  const normal = mine("p3", "helu").chips.normal;
  playOut(send, [actor(r, "p2", "ruby")]);
  const fin = book().tables[id].game.final;
  assert.equal(mine("p3", "helu").seat, null, "托管的座位打完自动结算");
  assert.match(mine("p3", "helu").last, /离开Flux Hold'em · 后巷小桌/);
  assert.equal(Math.round((mine("p3", "helu").chips.normal - normal) * 1000), Math.round(fin.chips.p2 * 10 / 200 * 1000));
  ok(send("p2", { op: "leave", kit: "ruby" }));
  assert.equal(book().tables[id], undefined);
  assert.deepEqual(plain(casino("p2").holdem), []);
});

test("联机浮层（casino-online-ui.js）：多人桌的开桌、坐下、开局、离桌（托管）、接着打；主持人坐一个座位、开局", () => {
  const r = funded(20), { c, send, casino } = r;
  require("node:vm").runInContext(X.read("casino-online-ui.js"), c, { filename: "casino-online-ui.js" });
  const UI = c.CasinoOnlineUI, model = (who) => ({ casino: casino(who), kit: null, busy: false, error: "", amount: {},
    draft: { buy: 1, sell: 1, buyIn: {}, side: "player", stake: "chips", mode: "highflux", holdem: { table: null, buyIn: 0, size: 4 } } });
  let h = UI.playerHtml(model("p2"));
  assert.match(h, /Flux Hold'em 多人桌/); assert.match(h, /data-cso="holdemOpen" data-kit="ruby"/);
  assert.match(h, /data-cso-in="hTable"/); assert.match(h, /data-cso-in="hSize"/);
  ok(send("p2", { op: "holdemOpen", kit: "ruby", table: "holdem-alley", buyIn: 20, size: 3 }));
  const id = holdemTable(r, "p2").id;
  assert.match(UI.playerHtml(model("p3")), new RegExp(`data-cso="holdemJoin" data-kit="helu" data-table="${id}"`));
  h = UI.playerHtml(model("p2"));
  assert.match(h, /坐在Flux Hold'em · 后巷小桌/); assert.match(h, /data-cso="holdemStart"/); assert.match(h, /离桌（退回买入）/);
  assert.match(h, /p2 空座位/);
  let g = UI.gmHtml(model("host"));
  assert.match(g, /data-cso="holdemGm"/); assert.match(g, /data-cso="holdemStartGm"/);
  ok(send("host", { op: "holdemGm", table: id, asGm: true }));
  ok(send("p2", { op: "holdemStart", kit: "ruby", table: id }));
  g = UI.gmHtml(model("host"));
  assert.match(g, /p2 主持人 · p3 AI 甲/); assert.match(g, /data-cso="leaveGm"/);
  ok(send("p2", { op: "leave", kit: "ruby" }));
  h = UI.playerHtml(model("p2"));
  assert.match(h, /AI 托管中/); assert.match(h, /data-cso="holdemBack"/);
});

test("Flux Hold'em · 存档读回来（房主刷新）以后多人桌还在：接着打完", () => {
  const r = funded(20), { c, send, mine, casino } = r;
  ok(send("p2", { op: "holdemOpen", kit: "ruby", table: "holdem-alley", buyIn: 20, size: 4 }));
  const id = holdemTable(r, "p2").id;
  ok(send("p3", { op: "holdemJoin", kit: "helu", table: id }));
  ok(send("host", { op: "holdemGm", table: id, asGm: true }));
  ok(send("p2", { op: "holdemStart", kit: "ruby", table: id }));
  playOut(send, [actor(r, "p2", "ruby"), actor(r, "p3", "helu"), gmActor(r, id)], 6);
  const round = mine("p2", "ruby").seat.game.round, hand = plain(mine("p3", "helu").seat.game.me.hand);
  c.LEDGER.casino = JSON.parse(JSON.stringify(c.LEDGER.casino));
  assert.equal(mine("p2", "ruby").seat.game.round, round);
  assert.deepEqual(plain(mine("p3", "helu").seat.game.me.hand), hand, "读回来还是这一局");
  assert.equal(casino("host").gmSeats[0].table, id);
  playOut(send, [actor(r, "p2", "ruby"), actor(r, "p3", "helu"), gmActor(r, id)]);
  assert.equal(mine("p2", "ruby").seat.game.over, true);
});

test("白名单（online-view.js · projectHoldemGame / 多人桌大厅）：别人的手牌、盖下的牌、牌堆、只给别人看的记录不放；不是庄家没有偷看；主持人的座位只给主持人", () => {
  const seat = (id, extra) => Object.assign({ id, name: id === "p1" ? "瑞比" : "AI 甲", chips: 30, start: 30, bet: 1, st: 1, loan: 0, owe: 0, folded: false, allIn: false, out: false, handCount: 3, played: true,
    dealer: id === "p2", sb: false, bb: false }, extra || {});
  const game = { mode: "holdem", side: "p1", order: ["p1", "p2"], round: 1, rounds: 5, stage: "bet1", over: false, waiting: ["p1"], myTurn: true, dealer: "p2", sb: "p2", bb: "p1",
    layers: ["armor"], usedLayers: [], layerDeckCount: 9, layerDeck: ["SECRET-1"], weathers: [], deckCount: 7, deck: ["SECRET-2"], discards: [], elementDeckCount: 22, elementDeck: ["SECRET-3"],
    blinds: [1, 2], minBet: 1, maxRaises: 3, loan: { unit: 3, repay: 4 }, loanAsk: null, pot: 3, carry: null,
    me: seat("p1", { hand: ["fire", "ice"], card: "acid", history: [{ r: 1, card: "acid" }] }),
    seats: [seat("p1", { hand: ["SECRET-4"] }), seat("p2", { hand: ["SECRET-5"], card: "SECRET-6" })],
    betting: { street: 1, toAct: "p1", raises: 0, cur: 2, minRaise: 2, toCall: 1, window: null },
    results: [], legal: [{ type: "call", amount: 1 }, { type: "fold" }],
    log: [{ r: 1, t: "peekCard", by: "p2", to: "p2", card: "SECRET-7", text: "你偷看到天气堆顶是 SECRET-8" }, { r: 1, t: "peek", by: "p2", op: "top", text: "AI 甲偷看了天气堆顶，留在了顶上。" },
      { r: 1, t: "myCard", by: "p1", to: "p1", card: "acid", text: "你盖下了〔酸〕。" }, { r: 1, t: "layer", layer: "armor", text: "翻开第 1 张公共层牌〔装甲〕。" }],
    peek: { card: "SECRET-9", where: "top" }, final: null };
  const lobby = [{ id: "h1", table: "holdem-hall", name: "Flux Hold'em · 大厅", rate: 50, difficulty: "normal", buyIn: 30, fee: 2, size: 2, host: "瑞比", started: true, over: false, round: 1,
    seats: [{ id: "p1", kind: "player", name: "瑞比", auto: false, who: "SECRET-10" }, { id: "p2", kind: "ai", name: "AI 甲", auto: false }], secret: "SECRET-11" }];
  const raw = { playerId: "p2", hostId: "host", casino: { config: {}, tables: [], open: [], holdem: lobby,
    mine: [{ kit: "ruby", name: "瑞比", purse: 1, chips: {}, sellable: 0, last: "", seat: { kind: "holdem", mode: "holdem", table: "h1", side: "p1", size: 2, host: true, auto: false, started: true, game } }],
    dealing: [], seated: [], gmSeats: [{ kind: "holdem", mode: "holdem", table: "h1", side: "p2", game }] } };
  const out = V.projectView(raw, { recipientId: "p2" }).casino;
  assert.ok(!JSON.stringify(out).includes("SECRET"), JSON.stringify(out));
  const g = out.mine[0].seat.game;
  assert.deepEqual(plain(g.me.hand), ["fire", "ice"]); assert.equal(g.me.card, "acid");
  assert.ok(g.seats.every(s => !("hand" in s) && !("card" in s)));
  assert.ok(!("peek" in g), "不是这一轮的庄家：没有偷看");
  assert.deepEqual(plain(g.log.map(e => e.t)), ["peek", "myCard", "layer"], "只给庄家看的那条不放");
  assert.deepEqual(plain(out.gmSeats), [], "不是主持人：没有主持人的座位");
  assert.deepEqual(plain(out.holdem[0].seats), [{ id: "p1", name: "瑞比", auto: false, kind: "player" }, { id: "p2", name: "AI 甲", auto: false, kind: "ai" }]);
  // 这一方是庄家时偷看那张才放
  const dealerView = V.projectView(Object.assign({}, raw, { playerId: "host", casino: Object.assign({}, raw.casino, { gmSeats: [{ kind: "holdem", mode: "holdem", table: "h1", side: "p2",
    game: Object.assign({}, game, { side: "p2", me: seat("p2", { hand: ["shield"], card: null, history: [] }), peek: { card: "heat", where: "top" } }) }] }) }), { recipientId: "host" }).casino;
  assert.deepEqual(plain(dealerView.gmSeats[0].game.peek), { card: "heat", where: "top" });
  assert.equal(dealerView.gmSeats[0].game.side, "p2");
  // 包不会太大：四人桌打完一局（60 条记录、5 轮结算）也远小于联机单包上限
  const r = funded(20);
  ok(r.send("p2", { op: "holdemOpen", kit: "ruby", table: "holdem-alley", buyIn: 20, size: 4 }));
  const id = holdemTable(r, "p2").id;
  ok(r.send("p3", { op: "holdemJoin", kit: "helu", table: id }));
  ok(r.send("p2", { op: "holdemStart", kit: "ruby", table: id }));
  playOut(r.send, [actor(r, "p2", "ruby"), actor(r, "p3", "helu")]);
  assert.ok(JSON.stringify(r.view("p2")).length < 51200 / 2, "一包的一半都不到");
});
