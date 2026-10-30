// 赌场接入联机跑团（#487 第 6 步）：每位玩家的筹码钱包按操控的角色记（LEDGER.casino.wallets[kit]），兑换走这名角色的钱包；
// AI 坐庄 / 主持人坐庄的赌场桌（收入场费）、玩家对赌（押普通筹码或押奎支，不收入场费）；
// 全盲：庄家偷看到的天气、暗弃 / 暗出的牌只在那一方的包里，结算只公开胜负、分档、筹码变动。
// 都走真的联机指令（HotseatGame.receiveFrom），再看每个人实际收到、过了 online-view.js 白名单的包（同 tests/online-wallet-privacy.test.js）
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

/** 联机跑团房间：主持人 host（操控柯尔特）、玩家甲 p2（瑞比）、玩家乙 p3（赫鲁米卡）。在探索环节 */
function room() {
  const c = H.load();
  for (const f of ["counter-cards.js", "counter-cards-ai.js", "casino.js"]) vm.runInContext(read(f), c, { filename: f });
  c.BattleSim.setup({ party: ["ruby", "helu", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "CASINO-ONLINE" });
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

test("指令清单：casino 是玩家能发的指令（online-game.js 的 controls、hotseat-game.js 的 tableTypes）；game.html 加载浮层，online-ui.js 挂上去", () => {
  assert.ok(/controls = new Set\(\[[^\]]*"casino"/.test(read("online-game.js")));
  assert.ok(/tableTypes = new Set\(\[[^\]]*"casino"/.test(read("hotseat-game.js")));
  const html = read("game.html"), at = f => html.indexOf(`<script src="${f}"></script>`);
  assert.ok(at("casino-online-ui.js") > at("duel-ui.js") && at("casino-online-ui.js") < at("online-ui.js"));
  const ui = read("online-ui.js");
  assert.match(ui, /casinoUi = global\.CasinoOnlineUI\.mount\(\{ api, view: \(\) => view, own, call \}\)/);
  assert.match(ui, /if \(casinoUi\) casinoUi\.sync\(\)/);
  assert.match(ui, /if \(casinoUi\) \{ casinoUi\.destroy\(\); casinoUi = null; \}/);
});

test("钱包按角色记：第一次来送赠送筹码（只送一次）；兑换走这名角色的私人钱包；只能动自己角色的；别人的包里没有我的钱包", () => {
  const { c, send, casino, mine, saves, book } = room();
  const s0 = saves();
  ok(send("p2", { op: "open", kit: "ruby" }));
  assert.equal(saves(), s0 + 1, "做成一步就写进存档（rememberCampaign）");
  assert.equal(book().wallets.ruby.gifted, true);
  assert.equal(mine("p2", "ruby").chips.gift, 50);
  ok(send("p2", { op: "open", kit: "ruby" }));
  assert.equal(mine("p2", "ruby").chips.gift, 50, "只送一次");
  no(send("p2", { op: "open", kit: "helu" }), /只能用自己角色的钱包/);
  no(send("p2", { op: "buy", kit: "helu", n: 1 }), /只能用自己角色的钱包/);
  ok(send("p2", { op: "buy", kit: "ruby", n: 3 }));
  assert.equal(c.trpgPurse("ruby"), 30000 - 600, "从瑞比的私人钱包付");
  assert.equal(mine("p2", "ruby").chips.normal, 3);
  assert.equal(mine("p2", "ruby").purse, 29400);
  no(send("p2", { op: "buy", kit: "ruby", n: 1000 }), /奎支不够/);
  assert.equal(c.trpgPurse("ruby"), 29400, "没买成不扣钱");
  ok(send("p2", { op: "sell", kit: "ruby", n: 1 }));
  assert.equal(c.trpgPurse("ruby"), 29400 + 190);
  no(send("p2", { op: "sell", kit: "ruby", n: 3 }), /赠送的筹码不能换成奎支/);
  // 乙的包里只有赫鲁米卡的钱包，没有瑞比的
  assert.deepEqual(casino("p3").mine.map(r => r.kit), ["helu"]);
  assert.ok(!has(casino("p3"), "ruby"), "乙的包里一点瑞比的钱包都没有");
  assert.equal(saves(), s0 + 4, "做成的 4 步（领赠送 ×2、买、卖）都写进存档，没做成的不写");
});

test("AI 坐庄的赌场桌：交入场费，AI 在房主这边接着走到轮到人；玩家只拿到自己那一方（没有庄家偷看的东西）", () => {
  const { send, casino, mine, book } = room();
  ok(send("p2", { op: "open", kit: "ruby" }));
  ok(send("p2", { op: "sit", kit: "ruby", table: "hall", buyIn: 40, dealer: "ai" }));
  const seat = mine("p2", "ruby").seat;
  assert.equal(seat.kind, "ai"); assert.equal(seat.table, "hall"); assert.equal(seat.fee, 2); assert.equal(seat.level, "normal");
  assert.equal(mine("p2", "ruby").chips.gift, 50 - 10 - 0.5, "买入 40 枚（10 枚筹码）+ 入场费 2 枚（0.5 枚）");
  const g = seat.game;
  assert.equal(g.side, "player");
  assert.equal(g.stage, "play", "庄家（AI）已经做完天气行动、暗出了牌");
  assert.equal(g.myTurn, true);
  assert.equal(g.opp.played, true);
  assert.ok(!("peek" in g) && !("deckTop" in g) && !("deckBottom" in g), "玩家那一方没有庄家偷看的东西");
  const host = book().wallets.ruby.seat.game;
  assert.ok(!has(g, `"${host.sides.dealer.card}"`), "看不到庄家暗出的层牌");
  ok(send("p2", { op: "act", kit: "ruby", action: { type: "play", card: g.me.hand[0] } }));
  const g2 = mine("p2", "ruby").seat.game;
  assert.ok(g2.stage === "bet1" && g2.myTurn, "第一轮下注玩家先");
  ok(send("p2", { op: "act", kit: "ruby", action: { type: "check" } }));
  assert.ok(mine("p2", "ruby").seat.game.myTurn || mine("p2", "ruby").seat.game.stage !== "bet1", "AI 跟着走了");
  no(send("p3", { op: "act", kit: "ruby", action: { type: "check" } }), /只能用自己角色的钱包/, "乙不能替甲出牌");
  ok(send("p2", { op: "leave", kit: "ruby" }));
  assert.equal(mine("p2", "ruby").seat, null);
  assert.match(mine("p2", "ruby").last, /离开大厅/);
});

test("主持人坐庄：主持人的包里有这一桌（庄家那一方：偷看到的天气只有他看得到）；玩家的包里没有；玩家不能替庄家出牌", () => {
  const { c, send, casino, mine, book } = room();
  ok(send("p2", { op: "open", kit: "ruby" }));
  ok(send("p2", { op: "sit", kit: "ruby", table: "alley", buyIn: 20, dealer: "gm" }));
  const gmc = casino("host");
  assert.equal(gmc.dealing.length, 1);
  const d = gmc.dealing[0];
  assert.equal(d.kit, "ruby"); assert.equal(d.game.side, "dealer"); assert.equal(d.game.myTurn, true);
  assert.ok(d.game.legal.some(o => o.type === "weather" && o.op === "peek"));
  assert.equal(gmc.seated[0].kit, "ruby");
  assert.equal(mine("p2", "ruby").seat.game.myTurn, false, "等主持人（庄家）先做天气行动");
  no(send("p2", { op: "act", kit: "ruby", asDealer: true, action: { type: "weather", op: "peek" } }), /只有主持人/);
  ok(send("host", { op: "act", kit: "ruby", asDealer: true, action: { type: "weather", op: "peek" } }));
  const top = book().wallets.ruby.seat.game.deck[0], topName = c.CounterCards.weatherName(top);
  assert.equal(casino("host").dealing[0].game.peek.card, top, "主持人看得到偷看的那张");
  assert.ok(casino("host").dealing[0].game.log.some(e => e.mine && e.text.includes(topName)), "主持人的记录里写着偷看到什么");
  // 天气名用中文查（acid、sand 既是天气也是牌的 id）；玩家那一方根本没有偷看的字段
  assert.ok(!has(casino("p2"), topName), "玩家的包里没有偷看到的天气");
  const pg = mine("p2", "ruby").seat.game;
  assert.ok(!("peek" in pg) && !("deckTop" in pg) && !("deckBottom" in pg) && !("deckSeen" in pg));
  ok(send("host", { op: "act", kit: "ruby", asDealer: true, action: { type: "place", where: "bottom" } }));
  assert.equal(casino("host").dealing[0].game.deckBottom, top, "主持人知道堆底是哪张");
  assert.ok(mine("p2", "ruby").seat.game.log.some(e => /压到了牌堆底/.test(e.text)), "玩家看得到庄家做了哪种操作");
  assert.deepEqual(plain(casino("host").dealing[0].game.deckSeen), { top: [], bottom: [top], unseen: 6 }, "主持人（庄家）看得到自己看过的天气（#502）");
  assert.ok(!has(casino("p2"), topName));
  // 主持人坐庄的桌子不在乙的包里，乙也看不到谁坐在哪桌
  assert.deepEqual(plain(casino("p3").dealing), []); assert.deepEqual(plain(casino("p3").seated), []);
});

test("玩家对赌（全盲）：押筹码只能押普通筹码（赠送的不算）；不收入场费；庄家偷看、玩家暗弃、双方暗出的牌只在自己那一方的包里；结算只公开胜负和变动", () => {
  const { c, send, casino, mine, book } = room();
  ok(send("p2", { op: "open", kit: "ruby" })); ok(send("p3", { op: "open", kit: "helu" }));
  no(send("p2", { op: "pvpOpen", kit: "ruby", side: "dealer", stakeKind: "chips" }), /只能押普通筹码/, "只有赠送筹码不能押");
  ok(send("p2", { op: "buy", kit: "ruby", n: 50 })); ok(send("p3", { op: "buy", kit: "helu", n: 50 }));
  ok(send("p2", { op: "pvpOpen", kit: "ruby", side: "dealer", stakeKind: "chips" }));
  assert.deepEqual([mine("p2", "ruby").chips.gift, mine("p2", "ruby").chips.normal], [50, 0], "押的是普通筹码，赠送的不动、也不收入场费");
  const open = casino("p3").open;
  assert.equal(open.length, 1); assert.equal(open[0].stakeKind, "chips"); assert.equal(open[0].start, 50); assert.equal(open[0].player, null);
  ok(send("p3", { op: "pvpJoin", kit: "helu", table: open[0].id }));
  assert.equal(casino("p3").open.length, 0, "坐满就开局");
  const t = book().tables[open[0].id], g = t.game;
  assert.ok(g && g.sides.dealer.chips === 49 && g.sides.player.chips === 49, "双方开局各 50 枚，下了底注");
  // 庄家偷看：只有甲看得到
  ok(send("p2", { op: "act", kit: "ruby", action: { type: "weather", op: "peek" } }));
  const top = g.deck[0], topName = c.CounterCards.weatherName(top);
  assert.equal(mine("p2", "ruby").seat.game.peek.card, top);
  assert.ok(!has(casino("p3"), topName) && !("peek" in mine("p3", "helu").seat.game), "乙的包里没有偷看到的天气");
  assert.ok(!has(casino("host"), topName), "主持人的包里也没有（全盲）");
  ok(send("p2", { op: "act", kit: "ruby", action: { type: "place", where: "top" } }));
  // 双方暗出：对方看不到
  ok(send("p2", { op: "act", kit: "ruby", action: { type: "play", card: "armor" } }));
  ok(send("p3", { op: "act", kit: "helu", action: { type: "play", card: "ice" } }));
  assert.ok(!has(casino("p2"), '"ice"'), "甲看不到乙暗出的冰");
  assert.ok(!has(casino("p3"), '"armor"'), "乙看不到甲暗出的装甲");
  assert.equal(mine("p2", "ruby").seat.game.opp.played, true);
  ok(send("p3", { op: "act", kit: "helu", action: { type: "check" } })); ok(send("p2", { op: "act", kit: "ruby", action: { type: "check" } }));
  // 玩家暗弃一张跳过翻天气：只有乙自己看得到弃了什么
  ok(send("p3", { op: "act", kit: "helu", action: { type: "skip", card: "fire" } }));
  assert.ok(!has(casino("p2"), '"fire"'), "甲看不到乙暗弃的牌");
  assert.equal(mine("p2", "ruby").seat.game.opp.discardCount, 1);
  assert.deepEqual(plain(mine("p3", "helu").seat.game.me.discards.map(d => d.card)), ["fire"]);
  // 主持人：知道谁坐在哪桌，看不到任何一方的牌
  const gmc = casino("host");
  assert.equal(gmc.seated.length, 1); assert.equal(gmc.seated[0].kind, "pvp"); assert.equal(gmc.dealing.length, 0);
  for (const card of ["armor", "ice", "fire", "hand"]) assert.ok(!has(gmc, `"${card}"`), "主持人的包里没有 " + card);
  // 打完这一轮：结算公开胜负、分档、筹码变动，不亮牌
  if (g.stage === "normal") ok(send("p3", { op: "act", kit: "helu", action: { type: "noNormal" } }));
  ok(send("p2", { op: "act", kit: "ruby", action: { type: "check" } })); ok(send("p3", { op: "act", kit: "helu", action: { type: "check" } }));
  const r2 = mine("p2", "ruby").seat.game.results[0], r3 = mine("p3", "helu").seat.game.results[0];
  assert.deepEqual(plain(r2), plain(r3), "两边看到的结算一模一样");
  assert.ok(!has(r2, '"ice"') && !has(r2, '"armor"'), "结算里没有牌");
  // 打到一半乙离桌：算认输，两边一起结算；筹码守恒（没借钱）
  ok(send("p3", { op: "leave", kit: "helu" }));
  assert.equal(book().tables[open[0].id], undefined, "这一桌收掉了");
  assert.equal(mine("p2", "ruby").seat, null); assert.equal(mine("p3", "helu").seat, null);
  assert.equal(mine("p2", "ruby").chips.normal + mine("p3", "helu").chips.normal, 100, "对赌不收入场费：两人的普通筹码加起来还是 100");
  assert.ok(mine("p2", "ruby").chips.normal > 50, "乙认输，底池归甲");
  assert.match(mine("p3", "helu").last, /对赌结算/);
  assert.equal(c.trpgPurse("ruby") + c.trpgPurse("helu"), 60000 - 20000, "押筹码不动奎支");
});

test("玩家对赌押奎支：1 枚 = 200 奎支（开局各押 50 × 200），从角色钱包扣；结算按桌上剩下的 × 200 回钱包；还没开局离桌退回", () => {
  const { c, send, casino, mine, book } = room();
  ok(send("p2", { op: "pvpOpen", kit: "ruby", side: "player", stakeKind: "kuizhi" }));
  assert.equal(c.trpgPurse("ruby"), 30000 - 50 * 200);
  assert.equal(mine("p2", "ruby").seat.stakeKind, "kuizhi");
  ok(send("p2", { op: "leave", kit: "ruby" }));
  assert.equal(c.trpgPurse("ruby"), 30000, "还没开局：原样退回");
  assert.deepEqual(Object.keys(book().tables), []);
  ok(send("p2", { op: "pvpOpen", kit: "ruby", side: "player", stakeKind: "kuizhi" }));
  c.LEDGER.purse.helu = 9999;
  no(send("p3", { op: "pvpJoin", kit: "helu", table: casino("p3").open[0].id }), /奎支不够：押奎支要 10000 奎支/);
  c.LEDGER.purse.helu = 30000;
  ok(send("p3", { op: "pvpJoin", kit: "helu", table: casino("p3").open[0].id }));
  assert.equal(c.trpgPurse("helu"), 20000);
  const g = Object.values(book().tables)[0].game;
  assert.equal(g.sides.player.chips, 49, "桌上还是按枚算（1 枚 = 200 奎支）");
  // 甲（玩家）打到一半离桌：算认输
  ok(send("p2", { op: "leave", kit: "ruby" }));
  assert.equal(c.trpgPurse("ruby") + c.trpgPurse("helu"), 60000, "对赌不抽水：两人的奎支加起来不变");
  assert.equal(c.trpgPurse("ruby"), 20000 + 49 * 200, "手上的 49 枚 × 200 回钱包，底注那 1 枚归对方");
  assert.match(mine("p2", "ruby").last, /输 200 奎支/);
});

test("主持人能让人离桌（卡住的桌子、坐着的角色死了）；玩家不能让别人离桌；战斗中不能去赌场", () => {
  const { c, hero, send, mine } = room();
  ok(send("p2", { op: "open", kit: "ruby" }));
  ok(send("p2", { op: "sit", kit: "ruby", table: "alley", buyIn: 20, dealer: "gm" }));
  no(send("p3", { op: "leave", kit: "ruby" }), /只能让自己的角色离桌/);
  ok(send("host", { op: "leave", kit: "ruby" }));
  assert.equal(mine("p2", "ruby").seat, null);
  // 坐着的角色死了：主持人照样能让他离桌（那一桌不会一直卡着），别人不行
  ok(send("p2", { op: "sit", kit: "ruby", table: "alley", buyIn: 20, dealer: "gm" }));
  hero("ruby").dead = true;
  no(send("p2", { op: "leave", kit: "ruby" }), /没有这名角色/);
  no(send("host", { op: "buy", kit: "ruby", n: 1 }), /没有这名角色/);
  ok(send("host", { op: "leave", kit: "ruby" }));
  assert.equal(c.LEDGER.casino.wallets.ruby.seat, null);
  hero("ruby").dead = false;
  c.S.state.combatStarted = true;
  no(send("p2", { op: "buy", kit: "ruby", n: 1 }), /战斗中不能去赌场/);
});

test("联机浮层（casino-online-ui.js）：玩家看到钱包、兑换、桌子、对赌；坐下以后按规则给的操作出按钮（手牌能出的才能点），对手的牌不画；主持人看到自己坐庄的那一桌", () => {
  const { c, send, casino } = room();
  vm.runInContext(read("casino-online-ui.js"), c, { filename: "casino-online-ui.js" });
  const UI = c.CasinoOnlineUI, model = (who, extra) => Object.assign({ casino: casino(who), kit: null, busy: false, error: "", draft: { buy: 1, sell: 1, buyIn: {}, side: "player", stake: "chips" }, amount: {} }, extra || {});
  ok(send("p2", { op: "open", kit: "ruby" }));
  let h = UI.playerHtml(model("p2"));
  assert.match(h, /筹码 <b>50<\/b> 枚（赠送 50，只能下注；普通 0，能卖 0 枚）/);
  assert.match(h, /瑞比|ruby/);
  assert.match(h, /买（每枚 200 奎支）/); assert.match(h, /卖（每枚 190 奎支）/);
  assert.match(h, /data-cso="sit" data-kit="ruby" data-table="hall" data-dealer="ai"/);
  assert.match(h, /data-cso="sit" data-kit="ruby" data-table="hall" data-dealer="gm"/);
  assert.match(h, /入场费 2 枚（0\.5 枚筹码，每局一次）/);
  assert.match(h, /开一桌对赌/); assert.match(h, /筹码（只能押普通筹码）/); assert.match(h, /奎支（1 枚 = 200 奎支）/);
  ok(send("p2", { op: "sit", kit: "ruby", table: "hall", buyIn: 40, dealer: "gm" }));
  ok(send("host", { op: "act", kit: "ruby", asDealer: true, action: { type: "weather", op: "pass" } }));
  ok(send("host", { op: "act", kit: "ruby", asDealer: true, action: { type: "play", card: "flesh" } }));
  h = UI.playerHtml(model("p2"));
  assert.match(h, /坐在桌上/); assert.match(h, /庄家：主持人/);
  const playable = [...h.matchAll(/data-cso="act" data-cso-key="ruby" data-type="play" data-card="(\w+)"/g)].map(m => m[1]);
  assert.equal(playable.length, 7, "7 张元素牌能出（常态不能当出牌）");
  assert.ok(!/data-card="normal"/.test(h), "常态不能点");
  assert.ok(!/肉体|"flesh"/.test(h), "主持人暗出的层牌不画");
  assert.match(h, /离桌（打到一半算认输）/);
  const g = UI.gmHtml(model("host"));
  assert.match(g, /你给 瑞比 坐庄/);
  assert.match(g, /data-cso-game="gm:ruby"/);
  assert.match(g, /你暗出了〔肉体〕/, "主持人看得到自己（庄家）暗出的牌");
  assert.ok(!/data-type="play"/.test(g), "庄家已经出过牌了：主持人这边没有出牌按钮");
  assert.match(g, /等瑞比/);
  assert.match(g, /让他离桌/);
});

test("白名单（online-view.js · projectCasino）：没登记的字段丢掉；拿错别人的 view 不放赌场；主持人坐庄的桌子、谁坐在哪桌只给主持人", () => {
  const game = { side: "player", opponent: "dealer", round: 1, rounds: 5, stage: "play", over: false, myTurn: true, weather: null, revealed: null, deckCount: 7, gone: [], allIn: false,
    minBet: 1, ante: 1, maxRaises: 2, loan: { unit: 3, repay: 4, secret: "SECRET-1" }, loanAsk: null, pot: 2, normalUsed: false,
    me: { chips: 49, infinite: false, start: 50, bet: 1, pot: 0, st: 0, loan: 0, owe: 0, hand: ["fire", "ice"], card: null, history: [], discards: [], spare: 2, secret: "SECRET-2" },
    opp: { chips: 49, infinite: false, start: 50, bet: 1, pot: 0, st: 0, loan: 0, owe: 0, handCount: 5, played: false, discardCount: 0, hand: ["SECRET-3"] },
    betting: null, results: [], log: [{ r: 1, t: "x", text: "第 1 轮", card: "SECRET-4" }], legal: [{ type: "play", card: "fire", secret: "SECRET-5" }], final: null,
    peek: { card: "SECRET-6" }, deckTop: "SECRET-7", junk: "SECRET-8" };
  const raw = { playerId: "p2", hostId: "host", casino: { config: { buy: 200, sell: 190, face: 200, gift: 50, secret: "SECRET-9" }, tables: [], open: [],
    mine: [{ kit: "ruby", name: "瑞比", purse: 100, chips: { gift: 1, normal: 2, total: 3, gifted: true, seat: { stake: "SECRET-10" } }, sellable: 2, last: "", seat: { kind: "ai", table: "hall", side: "player", game, secret: "SECRET-11" } }],
    dealing: [{ kit: "helu", name: "乙", kind: "gm", table: "alley", game }], seated: [{ kit: "helu", name: "乙", kind: "gm", round: 1 }], extra: "SECRET-12" } };
  const out = V.projectView(raw, { recipientId: "p2" }).casino;
  assert.ok(!JSON.stringify(out).includes("SECRET"), JSON.stringify(out));
  assert.deepEqual(plain(out.mine[0].seat.game.me.hand), ["fire", "ice"]);
  assert.ok(!("hand" in out.mine[0].seat.game.opp), "对方那一格只有张数");
  assert.ok(!("peek" in out.mine[0].seat.game), "玩家那一方不放偷看");
  assert.deepEqual(plain(out.dealing), [], "不是主持人：没有坐庄的桌子");
  assert.deepEqual(plain(out.seated), []);
  assert.equal(V.projectView(raw, { recipientId: "p3" }).casino, undefined, "给别人造的 view：赌场不放");
  const gm = V.projectView(Object.assign({}, raw, { playerId: "host" }), { recipientId: "host" }).casino;
  assert.equal(gm.dealing.length, 1); assert.equal(gm.seated.length, 1);
});
