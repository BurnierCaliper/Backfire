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

test("Flux Hold'em · 每轮结算时亮出每人这一轮盖下的牌（results[i].played，#530）：联机包里照发（弃牌的、其他人都弃牌直接赢的那一轮也亮）；结算之前别人盖下的牌不在包里", () => {
  const r = funded(20), { c, send, mine, book } = r;
  ok(send("p2", { op: "holdemOpen", kit: "ruby", table: "holdem-alley", buyIn: 20, size: 2 }));
  const id = holdemTable(r, "p2").id;
  ok(send("p3", { op: "holdemJoin", kit: "helu", table: id }));
  // 开局（房主这边，测试用：指定两人的手牌——赫鲁米卡的三张都不会出现在瑞比的包里别的地方：不是天气、层牌，也不在瑞比手里）
  const HELU = ["electric", "energy", "harmonic"];
  c.trpgCasinoHoldemStart(id, "ruby", { hands: { p1: ["fire", "ice", "physical"], p2: HELU.slice() } });
  assert.equal(c.FluxHoldem.HOLDEM_CONFIG.revealAll, true, "#530：每轮结算亮出所有人盖下的牌");
  // 瑞比照常打（过牌 / 跟注），赫鲁米卡盖下一张以后能弃牌就弃：这一轮「其他人都弃牌」，以前不亮牌
  const ruby = actor(r, "p2", "ruby"), helu = actor(r, "p3", "helu");
  const heluPick = (g) => (g.legal.some(o => o.type === "fold") ? { type: "fold" } : X.pick(g));
  let seenPlayed = false;
  for (let i = 0; i < 300 && !mine("p2", "ruby").seat.game.results.length; i++) {
    const ga = mine("p2", "ruby").seat.game;
    if (ga.seats.find(s => s.id === "p2").played) seenPlayed = true;
    // 结算之前：瑞比的包里没有赫鲁米卡盖下的牌（座位上只有「盖了没有」）
    assert.ok(!HELU.some(k => JSON.stringify(ga).includes(`"${k}"`)), "结算之前别人盖下的牌不在包里：" + JSON.stringify(ga.seats));
    assert.ok(ga.seats.every(s => !("card" in s) && typeof s.played === "boolean"));
    const turn = [ruby, helu].map(a => ({ a, g: a.game() })).find(x => x.g && x.g.myTurn);
    assert.ok(turn, "没人能动");
    ok(send(turn.a.who, Object.assign({ op: "act" }, turn.a.cmd, { action: turn.a === helu ? heluPick(turn.g) : X.pick(turn.g) })));
  }
  assert.ok(seenPlayed, "赫鲁米卡盖下了牌、还没结算的那几步都查过了");
  const raw = book().tables[id].game.results[0];
  assert.deepEqual([raw.outcome, plain(raw.folded)], ["fold", ["p2"]], "赫鲁米卡弃牌：其他人都弃牌，瑞比直接赢");
  assert.ok(HELU.includes(raw.played.p2) && raw.played.p1, "规则层结算时记下了每人这一轮盖下的牌");
  // 结算以后：两个人的包里都有这一轮亮出的牌（公开的）
  const ra = mine("p2", "ruby").seat.game.results[0], rb = mine("p3", "helu").seat.game.results[0];
  assert.deepEqual(plain(ra.played), plain(raw.played), "瑞比看得到赫鲁米卡弃掉的那一张（以前白名单不放 played）");
  assert.deepEqual(plain(rb.played), plain(raw.played), "赫鲁米卡也看得到瑞比的");
  assert.deepEqual(plain(ra.shown), {}, "其他人都弃牌：没有比分");
});

test("累积奖池（#534）· 白名单：包里有累积奖池的数目、每人交的盲注、每轮结算的累积奖池（归谁 / 同分留到下一轮 / 加赛 / 平分）；加赛只放第几次、谁参加、谁盖了——别人加赛盖的牌、重洗后的顺序不放", () => {
  const seat = (id, extra) => Object.assign({ id, name: id === "p1" ? "瑞比" : "AI 甲", chips: 30, start: 30, bet: 0, st: 0, blind: 0, loan: 0, owe: 0, folded: false, allIn: false, out: false,
    handCount: 1, played: false, dealer: id === "p1", sb: false, bb: false }, extra || {});
  const game = { mode: "holdem", side: "p1", order: ["p1", "p2"], round: 5, rounds: 5, stage: "playoff", over: false, waiting: ["p1"], myTurn: true, dealer: "p1", sb: "p1", bb: "p2",
    layers: [], usedLayers: [], layerDeckCount: 10, weathers: [], deckCount: 7, discards: [], elementDeckCount: 14, blinds: [5, 10], minBet: 5, maxRaises: 3,
    loan: { unit: 3, repay: 4 }, loanAsk: null, pot: 0, carry: null, jackpot: 45,
    playoff: { n: 1, ids: ["p1", "p2", "SECRET-1"], played: ["p2"], layerDeck: ["SECRET-2"], deck: ["SECRET-3"] }, playoffDecks: ["SECRET-4"],
    me: seat("p1", { hand: ["energy", "electric"], card: null, history: [{ r: 5, card: "acid" }] }),
    seats: [seat("p1"), seat("p2", { played: true, blind: 10, card: "SECRET-5" })],
    betting: null, legal: [{ type: "play", card: "energy" }, { type: "play", card: "electric" }],
    results: [
      { r: 5, outcome: "showdown", winners: ["p1", "p2"], folded: [], pot: 20, bets: { p1: 15, p2: 15 }, blinds: { p1: 5, p2: 10, p9: 99 }, delta: { p1: 0, p2: 0 }, chips: { p1: 30, p2: 30 },
        shown: { p1: { card: "acid", score: 1 }, p2: { card: "acid", score: 1 } }, pots: [], layers: ["sand", "spirit"], weathers: ["acid", "thunder"],
        jackpot: { amount: 45, added: 15, winner: null, tied: ["p1", "p2"], shares: {}, playoff: true, secret: "SECRET-6" } },
      { r: 4, outcome: "showdown", winners: ["p1"], folded: [], pot: 8, shown: {}, pots: [], layers: [], weathers: [],
        jackpot: { amount: 12, added: 12, winner: "p1", tied: [], shares: { p1: 12, p9: 3 } } },
      { r: 5, outcome: "playoff", n: 1, ids: ["p1", "p2", "p9"], winners: ["p1"], folded: [], pot: 0, bets: { p1: 0, p2: 0 }, delta: { p1: 45, p2: 0 }, chips: { p1: 75, p2: 30 },
        shown: { p1: { card: "electric", score: 4 }, p2: { card: "energy", score: 2 } }, played: { p1: "electric", p2: "energy" }, pots: [], layers: ["shield", "sand"], weathers: ["acid", "thunder"],
        jackpot: { amount: 45, added: 0, winner: "p1", tied: [], shares: { p1: 45 } } },
      { r: 5, outcome: "playoff", n: 2, ids: ["p1", "p2"], winners: ["p1", "p2"], folded: [], pot: 0, shown: {}, pots: [], layers: [], weathers: [],
        jackpot: { amount: 9, added: 0, winner: null, tied: ["p1", "p2"], shares: { p1: 5, p2: 4 }, split: true, empty: ["p1", "SECRET-7"] } }],
    log: [{ r: 5, t: "playoff", op: "open", n: 1, amount: 45, text: "第 1 次加赛：瑞比、AI 甲同分，争累积奖池 45 枚。" },
      { r: 5, t: "play", by: "p2", text: "AI 甲加赛盖下了一张元素牌。" }, { r: 5, t: "myCard", by: "p2", to: "p2", card: "SECRET-8", text: "你加赛盖下了〔SECRET-9〕。" }],
    final: null };
  const raw = { playerId: "p2", hostId: "host", casino: { config: {}, tables: [], open: [], holdem: [],
    mine: [{ kit: "ruby", name: "瑞比", purse: 1, chips: {}, sellable: 0, last: "", seat: { kind: "holdem", mode: "holdem", table: "h1", side: "p1", size: 2, host: true, auto: false, started: true, game } }],
    dealing: [], seated: [], gmSeats: [] } };
  const g = V.projectView(raw, { recipientId: "p2" }).casino.mine[0].seat.game;
  assert.ok(!JSON.stringify(g).includes("SECRET"), JSON.stringify(g));
  assert.equal(g.jackpot, 45);
  assert.deepEqual(plain(g.playoff), { n: 1, ids: ["p1", "p2"], played: ["p2"] }, "加赛：第几次、谁参加、谁盖了");
  assert.deepEqual(plain(g.seats.map(s => [s.id, s.blind, s.played])), [["p1", 0, false], ["p2", 10, true]]);
  assert.ok(g.seats.every(s => !("card" in s)), "别人加赛盖的牌不放");
  assert.deepEqual(plain(g.log.map(e => e.t)), ["playoff", "play"], "别人盖了哪张的那条不放");
  assert.deepEqual(plain(g.results[0].jackpot), { amount: 45, added: 15, playoff: true, winner: null, tied: ["p1", "p2"], shares: {} });
  assert.deepEqual(plain(g.results[0].blinds), { p1: 5, p2: 10 }, "不在这一桌的座位不放");
  assert.deepEqual(plain(g.results[1].jackpot), { amount: 12, added: 12, winner: "p1", tied: [], shares: { p1: 12 } });
  assert.deepEqual([g.results[2].outcome, g.results[2].n, plain(g.results[2].ids)], ["playoff", 1, ["p1", "p2"]]);
  assert.deepEqual(plain(g.results[2].played), { p1: "electric", p2: "energy" }, "加赛亮牌以后公开");
  assert.deepEqual(plain(g.results[3].jackpot), { amount: 9, added: 0, split: true, winner: null, tied: ["p1", "p2"], shares: { p1: 5, p2: 4 }, empty: ["p1"] });
});

test("累积奖池（#534）· 联机多人桌：每一包里的累积奖池和房主那边一样；最后一轮同分，两名玩家在联机包里看到加赛（谁参加、谁盖了，看不到对方盖的哪张），各自点牌打完加赛，赢的拿走累积奖池", () => {
  const r = funded(20), { c, send, mine, book } = r;
  ok(send("p2", { op: "holdemOpen", kit: "ruby", table: "holdem-alley", buyIn: 20, size: 2 }));
  const id = holdemTable(r, "p2").id;
  ok(send("p3", { op: "holdemJoin", kit: "helu", table: id }));
  // 两人拿的牌一模一样、每轮出一样的：每轮同分，累积奖池留到第 5 轮（3 + 6 + 9 + 12 + 15 = 45），加赛
  const LAYERS = ["flesh", "armor", "shield", "sand", "spirit", "flesh", "armor", "shield", "sand", "spirit"];
  c.trpgCasinoHoldemStart(id, "ruby", { hands: { p1: ["fire", "ice", "physical"], p2: ["fire", "ice", "physical"] },
    elements: ["harmonic", "harmonic", "acid", "acid", "energy", "energy", "electric", "electric"], layers: LAYERS,
    weathers: ["heat", "snow", "acid", "thunder", "glow", "sand", "heat", "snow", "acid", "thunder"],
    playoff: [{ layers: ["shield", "sand"].concat(LAYERS.slice(2, 10)), weathers: ["acid", "thunder", "heat", "snow", "glow", "sand", "phase"] }] });
  const ruby = actor(r, "p2", "ruby"), helu = actor(r, "p3", "helu"), plan = { 1: "fire", 2: "ice", 3: "physical", 4: "harmonic", 5: "acid" };
  let sawPlayoff = false, sawPlayed = false;
  for (let i = 0; i < 400; i++) {
    const gs = [ruby, helu].map(a => ({ a, g: a.game() })), host = book().tables[id].game;
    if (gs.every(x => x.g.over)) break;
    gs.forEach(x => assert.equal(x.g.jackpot, host.jackpot, "包里的累积奖池和房主那边一样"));
    if (host.stage === "playoff") {
      sawPlayoff = true;
      gs.forEach(x => assert.deepEqual(plain(x.g.playoff.ids), ["p1", "p2"]));
      assert.equal(gs[0].g.jackpot, 45);
      if (host.sides.p1.card) {
        sawPlayed = true;
        const hv = gs[1].g;
        assert.deepEqual(plain(hv.playoff.played), ["p1"], "赫鲁米卡看得到瑞比盖了");
        assert.ok(!("card" in hv.seats.find(s => s.id === "p1")) && !hv.log.some(e => e.t === "myCard" && e.by === "p1"), "看不到瑞比盖的哪张");
      }
    }
    const turn = gs.find(x => x.g.myTurn && !(x.a === helu && x.g.stage === "playoff" && !host.sides.p1.card));
    assert.ok(turn, "没人能动：" + host.stage);
    const g = turn.g;
    const action = g.stage === "play" ? { type: "play", card: plan[g.round] } : g.stage === "playoff" ? { type: "play", card: turn.a === ruby ? "electric" : "energy" } : X.pick(g);
    ok(send(turn.a.who, Object.assign({ op: "act" }, turn.a.cmd, { action })));
  }
  assert.ok(sawPlayoff && sawPlayed, "打到了加赛");
  const res = mine("p2", "ruby").seat.game.results, last = res[res.length - 1];
  assert.deepEqual([last.outcome, last.n, plain(last.ids)], ["playoff", 1, ["p1", "p2"]]);
  assert.deepEqual(plain(last.jackpot), { amount: 45, added: 0, winner: "p1", tied: [], shares: { p1: 45 } }, "护盾 + 沙尘、酸雨 + 雷鸣：瑞比电 +4、赫鲁米卡能量 +2");
  assert.equal(mine("p3", "helu").seat.game.results.length, res.length, "两个人收到的结算一样多");
  assert.equal(book().tables[id].game.jackpot, 0);
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
  // 结算记录里每人这一轮盖下的牌（results[i].played，#530）：公开的，照发；不在这一桌的座位不放；没有这一项（revealAll 关着）就不放
  const done = Object.assign({}, game, { results: [
    { r: 1, outcome: "fold", winners: ["p1"], folded: ["p2"], pot: 4, bets: { p1: 2, p2: 2 }, delta: { p1: 2, p2: -2 }, chips: { p1: 32, p2: 28 }, shown: {}, pots: [],
      layers: ["armor", "flesh"], weathers: ["heat", "snow"], played: { p1: "acid", p2: "ice", p9: "SECRET-12" } },
    { r: 2, outcome: "showdown", winners: ["p2"], folded: [], pot: 6, shown: { p1: { card: "fire", score: 1 }, p2: { card: "ice", score: 2 } }, pots: [], layers: [], weathers: [] }] });
  const seat0 = Object.assign({}, raw.casino.mine[0].seat, { game: done });
  const proj = V.projectView(Object.assign({}, raw, { casino: Object.assign({}, raw.casino, { mine: [Object.assign({}, raw.casino.mine[0], { seat: seat0 })] }) }), { recipientId: "p2" }).casino.mine[0].seat.game;
  assert.ok(!JSON.stringify(proj).includes("SECRET"));
  assert.deepEqual(plain(proj.results[0].played), { p1: "acid", p2: "ice" }, "弃牌的那一轮也亮：照发");
  assert.ok(!("played" in proj.results[1]), "规则层没写 played（revealAll 关着）：不放，牌桌照旧写「不亮牌」");
  // 包不会太大：四人桌打完一局（60 条记录、5 轮结算）也远小于联机单包上限
  const r = funded(20);
  ok(r.send("p2", { op: "holdemOpen", kit: "ruby", table: "holdem-alley", buyIn: 20, size: 4 }));
  const id = holdemTable(r, "p2").id;
  ok(r.send("p3", { op: "holdemJoin", kit: "helu", table: id }));
  ok(r.send("p2", { op: "holdemStart", kit: "ruby", table: id }));
  playOut(r.send, [actor(r, "p2", "ruby"), actor(r, "p3", "helu")]);
  assert.ok(JSON.stringify(r.view("p2")).length < 51200 / 2, "一包的一半都不到");
});
