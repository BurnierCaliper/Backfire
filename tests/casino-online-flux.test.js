// 联机赌场加上 Flux Duel（#526 第 1 步）：和联机 High Flux 一样三种坐法——AI 坐庄 / 主持人坐庄的赌场桌、玩家之间对赌（押筹码或押奎支）。
// 都走真的联机指令（HotseatGame.receiveFrom），看每个人实际收到、过了 online-view.js 白名单的包（同 tests/casino-online.test.js）：
// 对方的层牌 / 元素牌、暗出的牌、背面朝上的天气、天气堆的顺序都不在玩家的包里；打完一局结算进这名角色的钱包；存档读回来（刷新）牌局还在。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const V = require("../online-view");
const plain = x => JSON.parse(JSON.stringify(x));
const read = f => fs.readFileSync(path.join(H.ROOT, f), "utf8");
const RULES = ["counter-cards.js", "counter-cards-ai.js", "flux-duel.js", "flux-duel-ai.js", "flux-holdem.js", "flux-holdem-ai.js", "counter-cards-guess.js", "casino.js"];

/** 联机跑团房间：主持人 host（操控柯尔特）、玩家甲 p2（瑞比）、玩家乙 p3（赫鲁米卡）。在探索环节 */
function room() {
  const c = H.load();
  for (const f of RULES) vm.runInContext(read(f), c, { filename: f });
  c.BattleSim.setup({ party: ["ruby", "helu", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "CASINO-FLUX" });
  let saves = 0;
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, level: 1, undo: [], disarm() {}, refresh() {}, resumeHotseat() {}, rememberCampaign() { saves++; } };
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  c.location = { search: "" }; c.URLSearchParams = URLSearchParams; c.addEventListener = () => {}; c.setInterval = () => 0;
  c.OnlineGame = { isHost: () => true, isPaused: () => false };
  for (const f of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "gm-commands.js", "hotseat-game.js"]) vm.runInContext(read(f), c, { filename: f });
  const hero = k => c.S.state.units.find(u => u.kit === k);
  const players = [{ id: "host", name: "主持人", gm: true }, { id: "p2", name: "甲" }, { id: "p3", name: "乙" }];
  assert.equal(c.HotseatGame.enableOnline({ mode: "trpg", players, assignments: { [hero("ruby").id]: "p2", [hero("helu").id]: "p3" } }).ok, true);
  c.S.TRPG.active = true;
  c.LEDGER.purse = { ruby: 30000, helu: 30000 };
  const send = (who, cmd) => c.HotseatGame.receiveFrom(who, plain(Object.assign({ type: "casino" }, cmd)));
  const view = who => V.projectView(plain(c.HotseatGame.getViewFor(who)), { recipientId: who });
  const casino = who => view(who).casino;
  const mine = (who, kit) => casino(who).mine.find(r => r.kit === kit);
  return { c, hero, send, view, casino, mine, saves: () => saves, book: () => c.LEDGER.casino };
}
const ok = (ack, msg) => assert.equal(ack.ok, true, (msg || "") + "：" + ack.error);
const no = (ack, re, msg) => { assert.equal(ack.ok, false, msg); if (re) assert.match(ack.error, re, msg); };
const has = (o, s) => JSON.stringify(o).includes(s);

/** 规则给的操作里挑一个能把牌局往下打的：出牌（第一种组合）→ 不追加 → 过牌 → 跟注 → 不借 → 弃牌 */
function pick(g) {
  const L = g.legal || [], f = t => L.find(o => o.type === t);
  const play = f("play");
  if (play) return play.card ? { type: "play", card: play.card } : { type: "play", layer: play.layer, element: play.element };
  if (f("place")) return { type: "place", where: "top" };
  for (const t of ["pass", "check", "call", "noLoan", "fold"]) if (f(t)) return { type: t };
  throw new Error("没有能做的操作：" + JSON.stringify(L));
}
/** 几个人轮着打到这一局结束：actors = [{ who, kit, game: () => 这个人收到的包里的这一局, asDealer }] */
function playOut(send, actors) {
  for (let i = 0; i < 3000; i++) {
    const gs = actors.map(a => ({ a, g: a.game() }));
    if (gs.every(x => !x.g || x.g.over)) return i;
    const turn = gs.find(x => x.g && !x.g.over && x.g.myTurn);
    assert.ok(turn, "没人能动，牌局卡住了：" + JSON.stringify(gs.map(x => x.g && { stage: x.g.stage, waiting: x.g.waiting })));
    ok(send(turn.a.who, Object.assign({ op: "act", kit: turn.a.kit, action: pick(turn.g) }, turn.a.asDealer ? { asDealer: true } : {})), "第 " + i + " 步");
  }
  throw new Error("3000 步还没打完");
}

test("联机能坐 Flux Duel 的赌场桌：包里的桌子带玩法、能不能主持人坐庄（#526）", () => {
  const { send, casino } = room();
  const tables = casino("p2").tables;
  const duel = tables.filter(t => t.game === "duel");
  assert.deepEqual(duel.map(t => t.id), ["duel-alley", "duel-hall", "duel-vip"]);
  assert.ok(duel.every(t => t.gameName === "Flux Duel" && t.gm === true && t.short), "玩法名、能主持人坐庄、配置里的桌名都发");
  assert.ok(tables.filter(t => t.game === "highflux").every(t => t.gm === true));
  ok(send("p2", { op: "open", kit: "ruby" }));
  ok(send("p2", { op: "sit", kit: "ruby", table: "duel-hall", buyIn: 30, dealer: "ai" }), "以前报「联机赌场暂时只有 High Flux 的桌子」");
});

test("Flux Duel · AI 坐庄：坐下、AI 在房主这边走到轮到人；包里只有自己那一方（对方的牌、背面朝上的天气、天气堆的顺序都没有）；打完一局离桌结算进钱包", () => {
  const { send, mine, book } = room();
  ok(send("p2", { op: "open", kit: "ruby" }));                                          // 赠送 50 枚
  ok(send("p2", { op: "sit", kit: "ruby", table: "duel-hall", buyIn: 30, dealer: "ai" }));
  const seat = mine("p2", "ruby").seat;
  assert.deepEqual([seat.kind, seat.mode, seat.table, seat.side, seat.level, seat.fee], ["ai", "duel", "duel-hall", "a", "normal", 2]);
  const g = seat.game;
  assert.equal(g.mode, "duel"); assert.equal(g.side, "a"); assert.equal(g.opponent, "b");
  assert.equal(g.stage, "play"); assert.equal(g.myTurn, true);
  assert.deepEqual([g.me.layers.length, g.me.elements.length], [5, 7]);
  assert.equal(g.opp.chips, null, "赌场那一方筹码无限");
  assert.deepEqual([g.opp.layerCount, g.opp.elementCount, g.opp.played], [4, 6, true], "双方同时暗出：AI 坐下时就出好了");
  for (const k of ["layers", "elements", "layer", "element", "history"]) assert.ok(!(k in g.opp), "对方那一格没有 " + k);
  for (const k of ["deck", "hidden", "sides", "seed"]) assert.ok(!(k in g), "包里没有 " + k);
  assert.equal(g.facedown, true, "这一轮的天气背面朝上：只说有没有");
  assert.ok(g.legal.every(o => o.type === "play" && o.layer && o.element), "暗出：层牌 + 元素牌的组合");
  // 记录按角色名写（玩家 / 主持人看同一份记录），logFrom = 前面丢掉了几条
  assert.equal(book().wallets.ruby.seat.game.names.a, "瑞比");
  assert.equal(g.logFrom, 0);
  ok(send("p2", { op: "act", kit: "ruby", action: { type: "play", layer: g.me.layers[0], element: g.me.elements[0] } }), "暗出要带 layer + element（以前联机指令只拷 card）");
  const g2 = mine("p2", "ruby").seat.game;
  assert.equal(g2.me.layer, g.me.layers[0]); assert.equal(g2.me.element, g.me.elements[0]);
  assert.equal(g2.opp.played, true, "AI 跟着暗出了");
  assert.ok(g2.log.some(e => e.mine && e.to === "a" && /你暗出了/.test(e.text)), "自己暗出了什么只在自己的记录里");
  // 打完这一局：结算进钱包
  playOut(send, [{ who: "p2", kit: "ruby", game: () => mine("p2", "ruby").seat.game }]);
  const end = mine("p2", "ruby").seat.game;
  assert.equal(end.over, true);
  assert.ok(end.final && end.final.chips.a != null && end.final.chips.b === null);
  assert.ok(end.results.length >= 1 && end.results.every(r => !("shown" in r)), "不亮牌：结算里没有牌");
  const raw = book().wallets.ruby.seat, before = mine("p2", "ruby").chips.total;
  const back = raw.game.final.chips.a * raw.rate / 200;   // 桌上剩下的（扣还借款之后）折成钱包几枚
  ok(send("p2", { op: "leave", kit: "ruby" }));
  const row = mine("p2", "ruby");
  assert.equal(row.seat, null);
  assert.match(row.last, /离开Flux Duel · 大厅/);
  assert.equal(Math.round((row.chips.total - before) * 1000), Math.round(back * 1000), "桌上剩下的按倍率回钱包");
});

test("Flux Duel · 主持人坐庄：主持人的包里有这一桌（人对面那一方的 view）；玩家的包里没有；只有主持人能替主持人坐庄的那一桌出牌；打完一局结算", () => {
  const { send, casino, mine, book } = room();
  ok(send("p2", { op: "open", kit: "ruby" }));
  ok(send("p2", { op: "sit", kit: "ruby", table: "duel-alley", buyIn: 20, dealer: "gm" }));
  const gmc = casino("host");
  assert.equal(gmc.dealing.length, 1);
  const d = gmc.dealing[0];
  assert.deepEqual([d.kit, d.kind, d.mode, d.game.mode, d.game.side, d.game.opponent], ["ruby", "gm", "duel", "duel", "b", "a"]);
  assert.equal(d.game.me.chips, null, "主持人坐的是赌场那一方：筹码无限");
  assert.equal(d.game.names.b, "主持人");
  assert.equal(gmc.seated[0].kit, "ruby"); assert.equal(gmc.seated[0].mode, "duel");
  assert.deepEqual(plain(casino("p3").dealing), [], "别的玩家看不到主持人坐庄的桌子");
  // 双方同时暗出：玩家先出，等主持人
  const g = mine("p2", "ruby").seat.game;
  ok(send("p2", { op: "act", kit: "ruby", action: { type: "play", layer: g.me.layers[1], element: g.me.elements[2] } }));
  assert.equal(mine("p2", "ruby").seat.game.myTurn, false, "等主持人出牌");
  no(send("p2", { op: "act", kit: "ruby", asDealer: true, action: { type: "play", layer: "flesh", element: "fire" } }), /只有主持人/);
  const gmView = casino("host").dealing[0].game;
  assert.equal(gmView.opp.played, true);
  assert.ok(!("layer" in gmView.opp) && !("element" in gmView.opp), "主持人也看不到玩家暗出的牌");
  assert.ok(!gmView.log.some(e => e.mine), "主持人那一方还没有只给自己看的记录（玩家暗出的那条只在玩家那边）");
  assert.ok(book().wallets.ruby.seat.game.log.some(e => e.to === "a"), "（规则层里有那一条，只是没发给主持人）");
  playOut(send, [{ who: "p2", kit: "ruby", game: () => mine("p2", "ruby").seat.game },
    { who: "host", kit: "ruby", asDealer: true, game: () => (casino("host").dealing.find(x => x.kit === "ruby") || {}).game }]);
  assert.equal(mine("p2", "ruby").seat.game.over, true);
  ok(send("p2", { op: "leave", kit: "ruby" }));
  assert.equal(mine("p2", "ruby").seat, null);
  assert.deepEqual(plain(casino("host").dealing), [], "离桌了，主持人这边也没有这一桌了");
});

test("Flux Duel · 玩家对赌（押筹码）：开桌坐甲、对手坐乙就开局；对方的牌一张都看不到；打完一局两边各自结算，普通筹码加起来不变", () => {
  const { c, send, casino, mine, book } = room();
  ok(send("p2", { op: "open", kit: "ruby" })); ok(send("p3", { op: "open", kit: "helu" }));
  ok(send("p2", { op: "buy", kit: "ruby", n: 60 })); ok(send("p3", { op: "buy", kit: "helu", n: 60 }));
  ok(send("p2", { op: "pvpOpen", kit: "ruby", mode: "duel", side: "a", stakeKind: "chips" }));
  const open = casino("p3").open;
  assert.equal(open.length, 1);
  assert.deepEqual([open[0].mode, open[0].stakeKind, open[0].start, open[0].a, open[0].b], ["duel", "chips", 50, "瑞比", null]);
  assert.equal(mine("p2", "ruby").seat.mode, "duel");
  assert.equal(mine("p2", "ruby").seat.game, null, "还没开局");
  ok(send("p3", { op: "pvpJoin", kit: "helu", table: open[0].id }));
  const t = book().tables[open[0].id];
  assert.equal(t.mode, "duel"); assert.deepEqual(plain(t.seats), { a: "ruby", b: "helu" });
  assert.equal(t.game.mode, "duel"); assert.deepEqual(plain(t.game.names), { a: "瑞比", b: c.trpgPurseName("helu") }, "记录按两边的角色名写");
  const ga = mine("p2", "ruby").seat.game, gb = mine("p3", "helu").seat.game;
  assert.deepEqual([ga.side, gb.side, ga.opponent, gb.opponent], ["a", "b", "b", "a"]);
  assert.equal(mine("p2", "ruby").seat.opponent, c.trpgPurseName("helu"));
  assert.deepEqual([ga.me.chips, gb.me.chips], [49, 49], "开局各 50 枚，下了第 1 轮底注");
  // 双方暗出：对方看不到
  ok(send("p2", { op: "act", kit: "ruby", action: { type: "play", layer: "armor", element: "ice" } }));
  ok(send("p3", { op: "act", kit: "helu", action: { type: "play", layer: "shield", element: "fire" } }));
  const a1 = mine("p2", "ruby").seat.game, b1 = mine("p3", "helu").seat.game;
  assert.equal(a1.opp.played, true); assert.equal(b1.opp.played, true);
  assert.ok(!("layer" in a1.opp) && !("element" in a1.opp) && !("layers" in a1.opp));
  assert.ok(!a1.log.some(e => /〔护盾〕|〔火〕/.test(e.text)), "甲的记录里没有乙暗出的护盾、火");
  assert.ok(!b1.log.some(e => /〔装甲〕|〔冰〕/.test(e.text)), "乙的记录里没有甲暗出的装甲、冰");
  assert.ok(!has(casino("p2"), "SECRET") && !("deck" in a1));
  // 主持人：知道谁坐在哪桌，看不到任何一方的牌
  const gmc = casino("host");
  assert.equal(gmc.seated.length, 1); assert.equal(gmc.seated[0].mode, "duel"); assert.equal(gmc.dealing.length, 0);
  // 打完一局
  playOut(send, [{ who: "p2", kit: "ruby", game: () => mine("p2", "ruby").seat.game }, { who: "p3", kit: "helu", game: () => mine("p3", "helu").seat.game }]);
  const fa = mine("p2", "ruby").seat.game.final, fb = mine("p3", "helu").seat.game.final;
  assert.deepEqual(plain(fa), plain(fb), "两边看到的总结算一样");
  ok(send("p2", { op: "leave", kit: "ruby" }));
  assert.equal(book().tables[open[0].id], undefined, "打完了：一个人离桌两边一起结算，这一桌收掉");
  assert.equal(mine("p3", "helu").seat, null);
  assert.match(mine("p2", "ruby").last, /对赌结算\(甲\)/);
  assert.match(mine("p3", "helu").last, /对赌结算\(乙\)/);
  const loans = (fa.loans.a.owe - fa.loans.a.loan) + (fa.loans.b.owe - fa.loans.b.loan);
  assert.equal(mine("p2", "ruby").chips.normal + mine("p3", "helu").chips.normal, 120 - loans, "不收入场费、不抽水：两人的普通筹码加起来不变（借的另还）");
  assert.equal(mine("p2", "ruby").chips.gift + mine("p3", "helu").chips.gift, 100, "赠送的不动");
  assert.equal(c.trpgPurse("ruby") + c.trpgPurse("helu"), 60000 - 24000, "押筹码不动奎支");
});

test("Flux Duel · 玩家对赌（押奎支）：1 枚 = 200 奎支，从角色钱包扣；打到一半离桌算认输，两边一起结算，奎支加起来不变", () => {
  const { c, send, casino, mine } = room();
  ok(send("p3", { op: "pvpOpen", kit: "helu", mode: "duel", side: "b", stakeKind: "kuizhi" }));
  assert.equal(c.trpgPurse("helu"), 30000 - 50 * 200);
  assert.deepEqual([casino("p2").open[0].a, casino("p2").open[0].b], [null, c.trpgPurseName("helu")], "坐了乙，空着甲");
  ok(send("p2", { op: "pvpJoin", kit: "ruby", table: casino("p2").open[0].id }));
  assert.equal(mine("p2", "ruby").seat.side, "a");
  assert.equal(mine("p2", "ruby").seat.game.lead, "a", "第 1 轮甲先手");
  ok(send("p2", { op: "act", kit: "ruby", action: { type: "play", layer: "flesh", element: "fire" } }));
  ok(send("p3", { op: "act", kit: "helu", action: { type: "play", layer: "flesh", element: "ice" } }));
  ok(send("p2", { op: "act", kit: "ruby", action: { type: "bet", amount: 3 } }));
  ok(send("p3", { op: "leave", kit: "helu" }));                                         // 乙打到一半离桌：算认输
  assert.equal(c.trpgPurse("ruby") + c.trpgPurse("helu"), 60000, "对赌不抽水");
  assert.equal(c.trpgPurse("helu"), 20000 + 49 * 200, "乙手上的 49 枚回钱包，押进底池的归甲");
  assert.match(mine("p3", "helu").last, /对赌结算\(乙\)/);
  assert.equal(mine("p2", "ruby").seat, null, "两边一起结算");
});

test("存档读回来（房主刷新）以后牌局还在：AI 坐庄的 Duel、玩家对赌的 Duel 都接着打完", () => {
  const { c, send, mine, casino } = room();
  ok(send("p2", { op: "open", kit: "ruby" })); ok(send("p3", { op: "open", kit: "helu" }));
  ok(send("p2", { op: "sit", kit: "ruby", table: "duel-alley", buyIn: 20, dealer: "ai" }));
  ok(send("p3", { op: "buy", kit: "helu", n: 60 }));
  c.LEDGER.purse.helu = 30000;
  ok(send("p3", { op: "pvpOpen", kit: "helu", mode: "duel", side: "a", stakeKind: "kuizhi" }));
  // 第三个人（主持人操控的柯尔特）坐乙：主持人也能替自己操控的角色坐对赌
  c.LEDGER.purse.kolt = 30000;
  ok(send("host", { op: "pvpJoin", kit: "kolt", table: casino("host").open[0].id }));
  const g = mine("p2", "ruby").seat.game;
  ok(send("p2", { op: "act", kit: "ruby", action: { type: "play", layer: g.me.layers[0], element: g.me.elements[0] } }));
  // 刷新：存档（JSON）读回来，钱包、桌子、牌局都是新的对象
  c.LEDGER.casino = JSON.parse(JSON.stringify(c.LEDGER.casino));
  const again = mine("p2", "ruby").seat.game;
  assert.equal(again.round, 1); assert.equal(again.me.layer, g.me.layers[0], "读回来还是这一局");
  playOut(send, [{ who: "p2", kit: "ruby", game: () => mine("p2", "ruby").seat.game }]);
  assert.equal(mine("p2", "ruby").seat.game.over, true);
  c.LEDGER.casino = JSON.parse(JSON.stringify(c.LEDGER.casino));
  playOut(send, [{ who: "p3", kit: "helu", game: () => mine("p3", "helu").seat.game }, { who: "host", kit: "kolt", game: () => mine("host", "kolt").seat.game }]);
  assert.equal(mine("p3", "helu").seat.game.over, true);
  const f = Object.values(c.LEDGER.casino.tables)[0].game.final, purse = { helu: c.trpgPurse("helu"), kolt: c.trpgPurse("kolt") };
  ok(send("p3", { op: "leave", kit: "helu" }));
  assert.equal(c.trpgPurse("helu"), Math.max(0, purse.helu + f.chips.a * 200), "押奎支：桌上剩下的 × 200 回赫鲁米卡的钱包");
  assert.equal(c.trpgPurse("kolt"), Math.max(0, purse.kolt + f.chips.b * 200));
  ok(send("p2", { op: "leave", kit: "ruby" }));
  assert.match(mine("p2", "ruby").last, /离开Flux Duel · 后巷小桌/);
});

test("白名单（online-view.js · projectDuelGame）：没登记的字段丢掉；对方那一格只有张数；只给别人看的记录不放；背面朝上的天气、天气堆不发", () => {
  const game = { mode: "duel", side: "a", opponent: "b", names: { a: "瑞比", b: "赫鲁米卡", c: "SECRET-0" }, round: 2, rounds: 5, stage: "bet1", over: false,
    waiting: ["a"], myTurn: true, lead: "b", weather: null, facedown: true, hidden: "SECRET-1", deck: ["SECRET-2"], deckCount: 4, buried: 0, gone: ["heat"], unseen: ["acid", "glow"],
    allIn: false, ante: 2, minBet: 2, maxRaises: 2, reveal: false, loan: { unit: 3, repay: 4, x: "SECRET-3" }, loanAsk: null, pot: 4,
    me: { chips: 40, infinite: false, start: 50, bet: 2, pot: 0, st: 0, loan: 0, owe: 0, layers: ["flesh", "armor"], elements: ["fire"], layer: "shield", element: "ice", history: [{ r: 1, layer: "sand", element: "acid", x: "SECRET-4" }], secret: "SECRET-5" },
    opp: { chips: 40, infinite: false, start: 50, bet: 2, pot: 0, st: 0, loan: 0, owe: 0, layerCount: 3, elementCount: 5, played: true, layers: ["SECRET-6"], layer: "SECRET-7", element: "SECRET-8" },
    betting: { street: 1, toAct: "a", raises: 0, toCall: 0, window: null, cur: "SECRET-9" },
    results: [{ r: 1, weather: "heat", allIn: false, outcome: "b", winner: "b", tier: 1, extra: 0, pot: 4, bets: { a: 1, b: 1 }, delta: { a: -1, b: 1 }, chips: { a: 49, b: 51 }, cards: "SECRET-10" }],
    log: [{ r: 1, t: "play", by: "a", text: "瑞比暗出了一张层牌、一张元素牌。" }, { r: 1, t: "myCards", by: "a", to: "a", layer: "sand", element: "acid", text: "你暗出了〔沙尘〕〔酸〕。" },
      { r: 1, t: "myCards", by: "b", to: "b", layer: "SECRET-11", text: "你暗出了 SECRET-12" }, { r: 1, t: "weather", weather: "heat", text: "翻开这一轮的天气〔高温〕。", deck: "SECRET-13" },
      { r: 1, t: "result", res: { r: 1, shown: "SECRET-14" }, text: "第 1 轮：赫鲁米卡赢。" }],
    legal: [{ type: "check" }, { type: "bet", min: 2, max: 40, secret: "SECRET-15" }], final: null, junk: "SECRET-16" };
  const raw = { playerId: "p2", hostId: "host", casino: { config: { buy: 200, sell: 190, face: 200, gift: 50 }, tables: [], open: [],
    mine: [{ kit: "ruby", name: "瑞比", purse: 100, chips: { gift: 1, normal: 2, total: 3, gifted: true }, sellable: 2, last: "", seat: { kind: "pvp", mode: "duel", table: "t1", side: "a", stakeKind: "chips", start: 50, opponent: "赫鲁米卡", game } }],
    dealing: [], seated: [] } };
  const out = V.projectView(raw, { recipientId: "p2" }).casino;
  assert.ok(!JSON.stringify(out).includes("SECRET"), JSON.stringify(out));
  const g = out.mine[0].seat.game;
  assert.equal(g.mode, "duel"); assert.equal(out.mine[0].seat.mode, "duel"); assert.equal(out.mine[0].seat.side, "a");
  assert.deepEqual(plain(g.me.layers), ["flesh", "armor"]); assert.equal(g.me.layer, "shield");
  assert.deepEqual(Object.keys(g.opp).sort(), ["bet", "chips", "elementCount", "infinite", "layerCount", "loan", "owe", "played", "pot", "st", "start"].sort());
  assert.deepEqual(plain(g.log.map(e => [e.t, !!e.mine])), [["play", false], ["myCards", true], ["weather", false], ["result", false]], "只给乙看的那条不放");
  assert.ok(!("layer" in g.log[1]) && !("element" in g.log[1]), "只给自己看的记录只带文字");
  assert.equal(g.log[2].weather, "heat"); assert.deepEqual(plain(g.log[3].res), { r: 1 });
  assert.deepEqual(plain(g.unseen), ["acid", "glow"]);
  // 拿错了人：side 不是两方之一就整局不放
  const bad = V.projectView(Object.assign({}, raw, { casino: Object.assign({}, raw.casino, { mine: [Object.assign({}, raw.casino.mine[0], { seat: Object.assign({}, raw.casino.mine[0].seat, { game: Object.assign({}, game, { side: "x" }) }) })] }) }), { recipientId: "p2" }).casino;
  assert.equal(bad.mine[0].seat.game, null);
});
