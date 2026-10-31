// Flux Duel / Flux Hold'em 接进赌场（#488 第 5 步）：钱照 #487（casino.js：赠送筹码只能和赌场对局、输的先扣赠送的、
// 赢来的进普通筹码、入场费每局一次、离桌按倍率回钱包），两种新玩法的赌场桌各自放在自己的配置里（DUEL_CONFIG.casino / HOLDEM_CONFIG.casino）；
// 赌场面板（casino-ui.js）按玩法分组，坐下打开对应的牌桌（flux-duel-ui.js / flux-holdem-ui.js 的赌场模式）；
// 长线养成、本机跑团的坐桌指令只认桌子 id，不用改；联机跑团的赌场浮层先只有 High Flux 的桌子。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const H = require("./headless");
const MD = require("./mini-dom");

const read = f => fs.readFileSync(path.join(H.ROOT, f), "utf8");
const J = v => JSON.parse(JSON.stringify(v));
// 先后同 game.html：High Flux → 两种 Flux → casino.js
const RULES = ["counter-cards.js", "counter-cards-ai.js", "flux-duel.js", "flux-duel-ai.js", "flux-holdem.js", "flux-holdem-ai.js", "casino.js"];
const PHASE_FIRST = ["phase", "heat", "snow", "acid", "thunder", "sand", "glow"];
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** 规则（无界面）：headless 加上 High Flux、两种 Flux 和 casino.js */
function rules(files) {
  const c = H.load();
  (files || RULES).forEach(f => vm.runInContext(read(f), c, { filename: f }));
  return { c, K: c.Casino, CC: c.CounterCards, D: c.FluxDuel, X: c.FluxHoldem, DA: c.FluxDuelAI, XA: c.FluxHoldemAI, FACE: c.Casino.CONFIG.face };
}
/** 规则给的一项操作 → 交给 act 的操作（要填数目的填最小的） */
function actOf(o) {
  const a = { type: o.type };
  for (const k of ["card", "op", "where", "layer", "element"]) if (o[k] != null) a[k] = o[k];
  if (o.min != null) a.amount = o.min;
  return a;
}
/** Flux Duel：人（a）下注时过牌 / 跟注、出第一种能出的组合，赌场（b）每个下注回合轮到就弃牌，借贷都不借——打到结束 */
function duelHouseFolds(D, g) {
  for (let guard = 0; !g.over; guard++) {
    assert.ok(guard < 100, "打不完：" + g.stage);
    for (const k of D.toAct(g)) {
      if (g.over || D.toAct(g).indexOf(k) < 0) continue;
      const L = D.legal(g, k), has = t => L.some(o => o.type === t);
      if (g.stage === "loan") D.act(g, k, { type: "noLoan" });
      else if (g.stage === "play") D.act(g, k, actOf(L[0]));
      else if (k === "b") D.act(g, k, { type: "fold" });
      else D.act(g, k, { type: has("check") ? "check" : has("call") ? "call" : "pass" });
    }
  }
}
/** Flux Duel 第 1 轮：双方暗出，第一轮下注都过牌，翻开相位 → 双方全押，直接比分 */
function duelPhaseAllIn(D, g, mine, house) {
  D.act(g, "a", { type: "play", layer: mine[0], element: mine[1] });
  D.act(g, "b", { type: "play", layer: house[0], element: house[1] });
  D.act(g, "a", { type: "check" }); D.act(g, "b", { type: "check" });
}

/* ---------- 规则：桌子、坐桌、AI、离桌结算（casino.js） ---------- */

test("桌子：Flux Duel、Flux Hold'em 也有赌场桌，各自放在自己的配置里（DUEL_CONFIG.casino / HOLDEM_CONFIG.casino），排在 High Flux 后面；每张写是哪种玩法，桌名前面带玩法名（读配置），id 全赌场不重复", () => {
  const { K, D, X } = rules();
  const ts = K.tables();
  assert.deepEqual(J(ts.map(t => [t.id, t.game])), [
    ["alley", "highflux"], ["hall", "highflux"], ["vip", "highflux"],
    ["duel-alley", "duel"], ["duel-hall", "duel"], ["duel-vip", "duel"],
    ["holdem-alley", "holdem"], ["holdem-hall", "holdem"], ["holdem-vip", "holdem"]]);
  assert.equal(new Set(ts.map(t => t.id)).size, ts.length, "id 不重复");
  assert.deepEqual(J(D.DUEL_CONFIG.casino.tables.map(t => t.id)), ["duel-alley", "duel-hall", "duel-vip"]);
  assert.deepEqual(J(X.HOLDEM_CONFIG.casino.tables.map(t => t.id)), ["holdem-alley", "holdem-hall", "holdem-vip"]);
  const hall = ts.find(t => t.id === "duel-hall");
  assert.deepEqual([hall.gameName, hall.name, hall.short], ["Flux Duel", "Flux Duel · 大厅", "大厅"]);
  assert.deepEqual([ts[1].gameName, ts[1].name, ts[1].short], ["High Flux", "大厅", "大厅"], "High Flux 的桌名照旧");
  // 数值先照 High Flux 的三张桌子占位：倍率、最低买入、入场费、AI 难度
  for (const t of ts.filter(x => x.game !== "highflux")) {
    const hf = ts.find(x => x.id === t.id.replace(/^(duel|holdem)-/, ""));
    assert.deepEqual([t.short, t.rate, t.minBuyIn, t.entryFee, t.difficulty, t.minBuyInChips, t.entryFeeChips, t.perChip],
      [hf.short, hf.rate, hf.minBuyIn, hf.entryFee, hf.difficulty, hf.minBuyInChips, hf.entryFeeChips, hf.perChip], t.id);
  }
  ts.filter(t => t.game === "holdem").forEach(t => assert.equal(t.players, 4, t.id + "：4 人桌（你 + 3 名 AI）"));
  // 名字只有一份：改了玩法名，桌名跟着变
  D.DUEL_CONFIG.name = "Duel X";
  assert.equal(K.tables().find(t => t.id === "duel-hall").name, "Duel X · 大厅");
  D.DUEL_CONFIG.name = "Flux Duel";
  assert.deepEqual(J(K.games()), [{ game: "highflux", name: "High Flux" }, { game: "duel", name: "Flux Duel" }, { game: "holdem", name: "Flux Hold'em" }]);
  // 没加载 Flux 的页面（只测 High Flux）：只有 High Flux 的三张
  const hf = rules(["counter-cards.js", "counter-cards-ai.js", "casino.js"]);
  assert.deepEqual(J(hf.K.tables().map(t => [t.id, t.game])), [["alley", "highflux"], ["hall", "highflux"], ["vip", "highflux"]]);
  assert.deepEqual(J(hf.K.games()), [{ game: "highflux", name: "High Flux" }]);
});

test("Flux Duel 赌场桌：坐下先收入场费、再押买入（都先拿赠送的）；人坐 a（第 1 轮先手），b 是赌场、筹码无限；坐着的这一局记在钱包里", () => {
  const { K, D, FACE } = rules();
  const w = K.wallet(null);
  K.welcome(w);                                        // 赠送 50 枚
  assert.throws(() => K.sit(w, "duel-hall", 29), /Flux Duel · 大厅最低买入 30 枚/);
  assert.throws(() => K.sit(w, "duel-vip", 50), /筹码不够.*入场费/, "贵宾室 50 枚 + 入场费 2 枚 > 50 枚");
  assert.equal(K.chips(w).gift, 50, "没坐成不动钱包");
  const g = K.sit(w, "duel-hall", 40, { seed: "坐下" });
  assert.equal(g.mode, "duel");
  assert.deepEqual(J(g.casino), { table: "duel-hall", name: "Flux Duel · 大厅", buyIn: 40, rate: 50, difficulty: "normal", game: "duel", side: "a" });
  assert.equal(g.sides.a.start, 40);
  assert.equal(g.sides.b.infinite, true, "赌场那一方筹码无限");
  assert.equal(g.first, "a", "人是第 1 轮的先手");
  assert.deepEqual([g.names.a, g.names.b], ["你", "赌场"], "Duel 不设庄家：赌场那一方就叫赌场");
  assert.equal(w.seat.game, g);
  assert.deepEqual([w.seat.kind, w.seat.table, w.seat.name, w.seat.buyIn, w.seat.fee], ["ai", "duel-hall", "Flux Duel · 大厅", 40, 2]);
  const ch = K.chips(w);
  assert.equal(ch.gift, 50 - 40 * 50 / FACE - 2 * 50 / FACE, "入场费、买入都先拿赠送的");
  assert.equal(ch.seat.stake, 10);
  assert.throws(() => K.sit(w, "holdem-hall", 40), /已经坐在桌上/);
  // runAi：只让赌场那一方（b）走，走到轮到人为止
  assert.deepEqual(J(D.toAct(g)), ["a", "b"]);
  assert.equal(K.runAi(g, "normal"), 1);
  assert.ok(g.sides.b.element && !g.sides.a.element, "AI 暗出了，人的还没出");
  assert.deepEqual(J(D.toAct(g)), ["a"]);
  assert.equal(K.runAi(g, "normal"), 0, "轮到人时 AI 不动");
  // 主持人坐庄：Flux Duel 和 High Flux 一样可以（规则一样，只记着）
  const w2 = K.wallet({ gifted: true, gift: 0, normal: 20 * FACE });
  K.sit(w2, "duel-alley", 20, { dealer: "gm" });
  assert.equal(w2.seat.kind, "gm");
});

test("Flux Duel 赌场桌离桌：桌上剩下的按倍率回钱包——赢来的进普通筹码，输的先扣押上去的赠送筹码；打到一半离桌，押进底池的不退、借的扣还", () => {
  const { K, D, FACE } = rules();
  const fee = 2 * 50 / FACE;                           // 大厅入场费 2 枚 = 钱包 0.5 枚
  // 赢：相位全押赢下 40 枚（火打肉体 +1 对 冰打肉体 0），后面四轮赌场都弃牌（底注 2 + 3 + 4 + 5）：桌上 94 枚
  let w = K.wallet(null);
  K.welcome(w);
  let g = K.sit(w, "duel-hall", 40, { deck: PHASE_FIRST });
  duelPhaseAllIn(D, g, ["flesh", "fire"], ["flesh", "ice"]);
  assert.equal(g.results[0].winner, "a");
  assert.equal(g.results[0].allIn, true);
  duelHouseFolds(D, g);
  assert.equal(g.final.chips.a, 94);
  let res = K.leave(w);
  assert.deepEqual([res.chips, res.net, res.over], [94, 54, true]);
  assert.match(res.text, /离开Flux Duel · 大厅：桌上剩 94 枚（买入 40 枚，赢 54 枚）/);
  assert.equal(K.chips(w).gift, 50 - fee, "押上去的赠送筹码原样回来（只少了入场费）");
  assert.equal(K.chips(w).normal, 54 * 50 / FACE, "用赠送筹码赢来的是普通筹码");
  assert.equal(w.seat, null);
  // 输：相位全押输光，不借就结束——押上去的 40 枚（赠送的）没了
  // （钱包里没押上去的只剩 0.2 枚赠送筹码，不够补上桌 1 枚 = 0.25 枚：#520 起够 1 枚就先从钱包补、不问借贷）
  const tiny = (10 + fee) * FACE + 40;                 // 买入 10 枚 + 入场费 0.5 枚，外加 0.2 枚
  w = K.wallet({ gifted: true, gift: tiny, normal: 0 });
  g = K.sit(w, "duel-hall", 40, { deck: PHASE_FIRST });
  duelPhaseAllIn(D, g, ["flesh", "ice"], ["flesh", "fire"]);
  assert.equal(g.results[0].winner, "b");
  D.act(g, "a", { type: "noLoan" });
  assert.equal(g.over, true);
  res = K.leave(w);
  assert.deepEqual([res.chips, res.net], [0, -40]);
  assert.deepEqual([K.chips(w).gift, K.chips(w).normal], [0.2, 0], "没押上去的 0.2 枚不动");
  // 打到一半离桌：输光后借 3 枚（还 4 枚）、下了第 2 轮的底注 2 枚——手上 1 枚 − 还 4 枚 = −3 枚，还不上的先扣钱包里的赠送筹码
  w = K.wallet({ gifted: true, gift: tiny, normal: 0 });
  g = K.sit(w, "duel-hall", 40, { deck: PHASE_FIRST });
  duelPhaseAllIn(D, g, ["flesh", "ice"], ["flesh", "fire"]);
  D.act(g, "a", { type: "borrow", amount: 3 });
  assert.equal(g.round, 2);
  assert.deepEqual([g.sides.a.chips, g.sides.a.bet, g.sides.a.owe], [1, 2, 4]);
  res = K.leave(w);
  assert.deepEqual([res.chips, res.net, res.over], [-3, -43, false]);
  assert.deepEqual([K.chips(w).gift, K.chips(w).normal], [0, -0.55], "还不上的 3 枚（0.75 枚）先扣剩下的 0.2 枚赠送筹码，还差 0.55 枚记成欠赌场的");
});

test("Flux Hold'em 赌场桌：人坐第一个座位，其余座位是这张桌子难度的 AI，开局筹码和你的买入一样多（赌场出）；Casino.runAi 只让 AI 那几个座位走，走到轮到你为止；离桌按倍率回钱包", () => {
  const { K, X, FACE } = rules();
  const w = K.wallet({ gifted: true, gift: 0, normal: 100 * FACE });
  assert.throws(() => K.sit(w, "holdem-hall", 40, { dealer: "gm" }), /Flux Hold'em 的赌场桌只有 AI/);
  assert.equal(w.seat, null);
  const g = K.sit(w, "holdem-vip", 50, { seed: "四人" });
  assert.equal(g.mode, "holdem");
  assert.deepEqual(J(g.order), ["p1", "p2", "p3", "p4"]);
  assert.deepEqual(J(g.order.map(id => g.names[id])), ["你", "乙", "丙", "丁"]);
  g.order.forEach(id => assert.equal(g.sides[id].start, 50, id + " 开局和你的买入一样多"));
  assert.deepEqual(J(g.casino), { table: "holdem-vip", name: "Flux Hold'em · 贵宾室", buyIn: 50, rate: 200, difficulty: "hard", game: "holdem", side: "p1" });
  assert.equal(K.chips(w).normal, 100 - 50 - 2, "贵宾室每枚 200 奎支：买入 50 枚 + 入场费 2 枚");
  // 人随手走、AI 交给 runAi：AI 从来不替人走，runAi 走完一定轮到人（或者这一局结束）
  const r = rng(11);
  let mine = 0;
  for (let guard = 0; !g.over; guard++) {
    assert.ok(guard < 600, "打不完：" + g.stage);
    K.runAi(g, "hard");
    if (g.over) break;
    assert.ok(X.toAct(g).includes("p1"), "runAi 走完轮到人：" + J(X.toAct(g)));
    const L = X.legal(g, "p1");
    const calm = L.filter(o => o.type !== "fold" && o.type !== "raise" && o.type !== "bet");
    const pool = calm.length && r() < 0.85 ? calm : L;
    X.act(g, "p1", actOf(pool[Math.floor(r() * pool.length)]));
    mine++;
  }
  assert.ok(mine > 5);
  assert.ok(g.results.length >= 1);
  const res = K.leave(w);
  assert.equal(res.chips, g.final.chips.p1);
  assert.equal(res.over, true);
  // 总买入 = 买入 50 枚 + 牌局里不够时从钱包补的（#520）
  assert.equal(res.buyIn, 50 + res.topUp);
  assert.equal(K.chips(w).normal, 100 - 2 - res.buyIn + g.final.chips.p1, "贵宾室桌上 1 枚 = 钱包 1 枚");
});

test("打到一半的 Flux 牌局跟着钱包存档：存了再读（JSON 原样），接着打完、照样离桌结算", () => {
  const { K, DA, XA, FACE } = rules();
  const cases = [
    ["duel-alley", g => DA.playOut(g, { a: "normal", b: "easy" }, "续")],
    ["holdem-alley", g => XA.playOut(g, { p1: "normal", p2: "easy", p3: "easy", p4: "easy" }, "续")]
  ];
  for (const [table, play] of cases) {
    const w = K.wallet(null);
    K.welcome(w);
    const g = K.sit(w, table, 40, { seed: "存档" + table });
    K.runAi(g, "easy");
    const w2 = K.wallet(J(w));                         // 存档：钱包连同桌上这一局
    assert.equal(K.chips(w2).seat.table, table);
    const g2 = w2.seat.game;
    assert.equal(g2.mode, g.mode);
    play(g2);
    assert.equal(g2.over, true, table + " 打完");
    const res = K.leave(w2);
    const side = g2.casino.side;
    assert.equal(res.chips, g2.final.chips[side]);
    // 净输赢按总买入算（买入 40 枚 + 牌局里不够时从读进来的钱包补的，#520）
    const total = 50 - 2 * 10 / FACE + (res.chips - res.buyIn) * 10 / FACE;
    assert.ok(Math.abs(K.chips(w2).total - total) < 1e-9, `${table}：钱包 ${K.chips(w2).total}，应为 ${total}`);
  }
});

/* ---------- 长线养成、跑团：坐桌指令只认桌子 id ---------- */

test("长线养成、本机跑团：坐桌指令只认桌子 id，Flux 的桌子不用改指令就能坐；记录写玩法和桌名", () => {
  const { c } = rules();
  const R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed: "FLUX-CASINO", growth: true });
  R.casinoOpen(run);
  const sat = R.casinoSit(run, "duel-hall", 40);
  assert.match(sat.notes.join(""), /赌场：坐上Flux Duel · 大厅，买入 40 枚，交入场费 2 枚（不退）/);
  assert.equal(R.casinoView(run).game.mode, "duel");
  assert.equal(R.casinoView(run).chips.seat.name, "Flux Duel · 大厅");
  assert.match(R.casinoLeave(run).join(""), /赌场：离开Flux Duel · 大厅：桌上剩/);
  R.casinoSit(run, "holdem-alley", 20);
  assert.equal(R.casinoView(run).game.mode, "holdem");
  // 本机跑团
  const t = rules().c;
  t.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "FLUX-TRPG" });
  t.S.TRPG.active = true;
  t.trpgCasinoOpen();
  assert.match(t.trpgCasinoSit("holdem-hall", 40, null).join(""), /坐上Flux Hold'em · 大厅，买入 40 枚/);
  assert.equal(t.trpgCasinoView().game.mode, "holdem");
  assert.match(t.trpgCasinoLeave().join(""), /离开Flux Hold'em · 大厅/);
});

test("联机跑团的赌场（#526）：三种玩法的桌子都发给联机的人、都能坐；Flux Hold'em 的赌场桌没有主持人坐庄，钱包不动", () => {
  const t = rules().c;
  t.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "FLUX-ONLINE" });
  t.S.TRPG.active = true;
  t.LEDGER.purse = {};
  t.trpgCasinoOpen("kolt");
  const all = ["alley", "hall", "vip", "duel-alley", "duel-hall", "duel-vip", "holdem-alley", "holdem-hall", "holdem-vip"];
  const pk = t.trpgCasinoPacket(["kolt"], false);
  assert.deepEqual(J(pk.tables.map(x => x.id)), all);
  assert.deepEqual(J(t.trpgCasinoPacket(["kolt"], true).tables.map(x => x.id)), all, "主持人也一样");
  const before = J(t.trpgCasinoWallet("kolt"));
  assert.throws(() => t.trpgCasinoSitAt("kolt", "holdem-alley", 20, { dealer: "gm" }), /只有 AI，没有主持人坐庄/);
  assert.deepEqual(J(t.trpgCasinoWallet("kolt")), before, "钱包不动");
  t.trpgCasinoSitAt("kolt", "alley", 20, { dealer: "ai" });
  assert.equal(t.trpgCasinoWallet("kolt").seat.table, "alley", "High Flux 的桌子照旧");
  t.trpgCasinoLeave("kolt");
  t.trpgCasinoSitAt("kolt", "duel-hall", 40, { dealer: "ai" });
  assert.equal(t.trpgCasinoWallet("kolt").seat.game.mode, "duel", "Flux Duel 的桌子联机能坐了");
  t.trpgCasinoLeave("kolt");
  t.trpgCasinoSitAt("kolt", "holdem-alley", 20, { dealer: "ai" });
  assert.equal(t.trpgCasinoWallet("kolt").seat.game.mode, "holdem", "Flux Hold'em 的赌场桌联机也能坐了");
});

/* ---------- 界面：赌场面板按玩法分组，坐下打开对应的牌桌（casino-ui.js） ---------- */

function page() {
  const html = read("game.html"), body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const P = MD.create(body, { media: (q) => /prefers-reduced-motion: reduce/.test(q) });
  const ctx = vm.createContext(P.window);
  ["engine.js", "icons.js", "weather-fx.js", "pause-menu.js", "matchup-ui.js"].concat(RULES, ["counter-cards-ui.js", "flux-ui.js", "flux-duel-ui.js", "flux-holdem-ui.js", "casino-ui.js"])
    .forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const doc = P.document;
  return { w: P.window, doc, $: (s) => doc.querySelector(s), $$: (s) => Array.from(doc.querySelectorAll(s)), K: P.window.Casino };
}
const click = (el) => { assert.ok(el, "要点的东西不在"); el.click(); };
const visible = (el) => !!el && !el.hidden;
/** 一个最简单的模式（同 tests/casino-ui.test.js）：钱包是一个对象、奎支是一个数，面板画在一个 div 里 */
function mode(p) {
  const K = p.K;
  const m = { w: K.wallet(null), kuizhi: 1000, saves: 0, backs: 0, box: p.doc.createElement("div") };
  K.welcome(m.w);
  p.doc.body.appendChild(m.box);
  m.adapter = {
    view: () => ({ chips: K.chips(m.w), sellable: K.sellable(m.w), kuizhi: m.kuizhi, tables: K.tables(), buy: K.CONFIG.buy, sell: K.CONFIG.sell, game: m.w.seat ? m.w.seat.game : null }),
    buy: (n) => { const r = K.buy(m.w, n, m.kuizhi); m.kuizhi -= r.cost; return [r.text]; },
    sell: (n) => { const r = K.sell(m.w, n); m.kuizhi += r.gain; return [r.text]; },
    sit: (t, b) => { K.sit(m.w, t, b, { seed: "界面" + t }); return [`坐上 ${t}`]; },
    leave: () => [K.leave(m.w).text],
    saved: () => { m.saves++; },
    refresh: () => { m.box.innerHTML = p.w.CasinoUI.html(m.adapter.view()); },
    back: () => { m.backs++; m.adapter.refresh(); }
  };
  m.box.addEventListener("click", e => p.w.CasinoUI.handle(e, m.adapter));
  m.adapter.refresh();
  m.$ = (s) => m.box.querySelector(s);
  return m;
}
/** 牌桌上一直点到这一局结束（K = "fd" / "fh"）：有横幅点「继续」；轮到自己出牌就点能点的牌（Duel 层牌、元素牌各一张再暗出）；下注点过牌 / 跟注 / 不加注 */
function playThrough(p, K) {
  for (let guard = 0; guard < 800; guard++) {
    const banner = p.$(`#${K}-banner`);
    if (visible(banner)) {
      if (banner.querySelector(".cc-final")) return;
      click(banner.querySelector(`[data-${K}="dismiss"]`));
      continue;
    }
    if (K === "fd") {
      // 点一下整块重画：每点一张都重新找
      const can = row => p.$(`#fd-board .fd-row[data-row="${row}"] button.cc-can:not(.fd-sel)`);
      if (can("layer") && can("element")) { click(can("layer")); click(can("element")); click(p.$('#fd-actions [data-fd="play"]')); continue; }
    } else {
      const card = p.$("#fh-board .cc-me button.cc-can");
      if (card) { click(card); continue; }
    }
    const btns = p.$$(`#${K}-actions button[data-${K}]`).filter(b => !b.disabled && b.dataset[K] !== "amt");
    assert.ok(btns.length, "没有能点的按钮");
    const pick = ["check", "call", "pass", "noLoan"].map(a => btns.find(b => b.dataset[K] === a)).find(Boolean);
    click(pick || btns.find(b => b.classList.contains("primary")) || btns[0]);
  }
  assert.fail("点了 800 下还没打完");
}

test("赌场面板：桌子按玩法分组（High Flux、Flux Duel、Flux Hold'em，名字读配置）；Flux Duel 写对手是 AI，Flux Hold'em 写几人桌、几名 AI；坐着时写坐的是哪种玩法的哪张桌子", () => {
  const p = page(), m = mode(p);
  const groups = Array.from(m.box.querySelectorAll(".cs-game"));
  assert.deepEqual(groups.map(g => g.dataset.game), ["highflux", "duel", "holdem"]);
  assert.deepEqual(groups.map(g => g.querySelector("h3").textContent), ["High Flux", "Flux Duel", "Flux Hold'em"]);
  assert.deepEqual(Array.from(groups[1].querySelectorAll(".cs-table")).map(t => t.dataset.table), ["duel-alley", "duel-hall", "duel-vip"]);
  const da = m.$('.cs-table[data-table="duel-alley"]').textContent;
  assert.match(da, /后巷小桌/);
  assert.match(da, /对手：简单 AI/);
  assert.match(da, /桌上每枚 10 奎支（钱包 1 枚 = 桌上 20 枚）· 最低买入 20 枚（1 枚筹码）· 入场费 2 枚（0\.1 枚筹码，每局一次）/);
  const hh = m.$('.cs-table[data-table="holdem-hall"]').textContent;
  assert.match(hh, /4 人桌 · 对手：3 名普通 AI/);
  assert.match(m.$('.cs-table[data-table="hall"]').textContent, /庄家：普通 AI/, "High Flux 照旧");
  assert.match(groups[2].textContent, /其余座位是 AI，开局筹码和你的买入一样多/);
  assert.match(m.box.textContent, /High Flux、Flux Duel、Flux Hold'em/, "开头写有哪几种玩法（名字读配置）");
  // 名字读配置
  p.w.FluxHoldem.HOLDEM_CONFIG.name = "Hold X";
  m.adapter.refresh();
  assert.equal(m.$('.cs-game[data-game="holdem"] h3').textContent, "Hold X");
  assert.match(m.$('[data-casino-buyin="holdem-hall"]').getAttribute("aria-label"), /Hold X · 大厅买入几枚/);
  p.w.FluxHoldem.HOLDEM_CONFIG.name = "Flux Hold'em";
});

test("坐下 Flux Duel 的桌子 → 打开 Flux Duel 的牌桌（赌场模式）：人坐 a、对手是这张桌子难度的 AI（筹码无限）；顶栏写桌子和「离桌」；每走一步交给模式存档；总结算「再来一局 / 离桌」，离桌结算回钱包", () => {
  const p = page(), m = mode(p);
  m.$('[data-casino-buyin="duel-hall"]').value = "40";
  click(m.$('[data-casino="sit"][data-table="duel-hall"]'));
  const UI = p.w.FluxDuelUI, st = UI.state();
  assert.ok(st, "Flux Duel 的牌桌开了");
  assert.equal(st.game, m.w.seat.game, "打的就是钱包里坐着的这一局");
  assert.deepEqual([st.human, st.level], ["a", "normal"]);
  assert.ok(visible(p.$("#fd-game")));
  const top = p.$("#fd-top");
  assert.match(top.textContent, /Flux Duel · 大厅 · 买入 40 枚/);
  assert.match(top.textContent, /对手：普通 AI/);
  assert.ok(top.querySelector('[data-fd="leave"]'), "顶栏有「离桌」");
  assert.ok(!top.querySelector('[data-fd="setup"]') && !top.querySelector('[data-fd="title"]'), "赌场桌不能换座位 / 难度，也没有「回到标题」");
  assert.match(p.$("#fd-board").textContent, /筹码无限/, "对手（赌场）筹码无限");
  UI.setFast(true);
  const before = m.saves;
  playThrough(p, "fd");
  assert.ok(m.saves > before, "牌局每走一步都叫模式存档");
  const fin = p.$("#fd-banner .cc-final");
  assert.match(fin.querySelector('[data-fd="casinoAgain"]').textContent, /再来一局（买入 40 枚 \+ 入场费 2 枚）/);
  assert.ok(fin.querySelector('[data-fd="leave"]'), "总结算有「离桌」");
  // 再来一局：上一局结算回钱包，同一张桌子同样买入再开
  const g1 = m.w.seat.game;
  click(fin.querySelector('[data-fd="casinoAgain"]'));
  assert.ok(m.w.seat && m.w.seat.game !== g1, "开了新的一局");
  assert.deepEqual([m.w.seat.table, m.w.seat.buyIn], ["duel-hall", 40]);
  assert.equal(UI.state().game, m.w.seat.game);
  // 打到一半离桌
  click(p.$('#fd-top [data-fd="leave"]'));
  assert.equal(m.w.seat, null, "离桌结算");
  assert.equal(m.backs, 1, "回到模式的画面");
  assert.match(m.box.textContent, /离开Flux Duel · 大厅：桌上剩/);
});

test("坐下 Flux Hold'em 的桌子 → 打开 Flux Hold'em 的牌桌（赌场模式）：人坐第一个座位，3 名 AI 都是这张桌子的难度；打完总结算「再来一局 / 离桌」，离桌结算回钱包；坐着时面板写「回到牌桌」", () => {
  const p = page(), m = mode(p);
  m.$('[data-casino-buyin="holdem-alley"]').value = "30";
  click(m.$('[data-casino="sit"][data-table="holdem-alley"]'));
  const UI = p.w.FluxHoldemUI, st = UI.state();
  assert.ok(st, "Flux Hold'em 的牌桌开了");
  assert.equal(st.game, m.w.seat.game);
  assert.equal(st.human, "p1");
  assert.deepEqual(J(st.levels), { p2: "easy", p3: "easy", p4: "easy" });
  const top = p.$("#fh-top");
  assert.match(top.textContent, /Flux Hold'em · 后巷小桌 · 买入 30 枚/);
  assert.ok(top.querySelector('[data-fh="leave"]'));
  assert.ok(!top.querySelector('[data-fh="setup"]') && !top.querySelector('[data-fh="title"]'));
  UI.setFast(true);
  const before = m.saves;
  playThrough(p, "fh");
  assert.ok(m.saves > before, "牌局每走一步都叫模式存档");
  const fin = p.$("#fh-banner .cc-final");
  assert.match(fin.querySelector('[data-fh="casinoAgain"]').textContent, /再来一局（买入 30 枚 \+ 入场费 2 枚）/);
  // 面板上：坐着时写坐在哪种玩法的哪张桌子，「看总结算」回到牌桌
  m.adapter.refresh();
  // 买入写总买入：坐下时的 30 枚 + 牌局里不够时从钱包补的（#520）
  assert.equal(m.w.seat.buyIn, 30 + (m.w.seat.topUp || 0));
  assert.match(m.$(".cs-seat").textContent, new RegExp(`你坐在Flux Hold'em · 后巷小桌：买入 ${m.w.seat.buyIn} 枚.*交了入场费 2 枚 · 这一局打完了`));
  click(m.$('[data-casino="play"]'));
  assert.equal(UI.state().game, m.w.seat.game, "回到同一局");
  const g = m.w.seat.game, mine = g.final.chips.p1;
  click(p.$('#fh-banner [data-fh="leave"]'));
  assert.equal(m.w.seat, null);
  assert.equal(m.backs, 1);
  assert.match(m.box.textContent, new RegExp(`离开Flux Hold'em · 后巷小桌：桌上剩 ${mine} 枚`));
});
