// Flux Hold'em（#488）· 规则引擎 flux-holdem.js：2–4 人公共牌桌——元素牌 4 组 × 7 张发牌 / 摸牌、公共层牌 2 组 × 5 张每轮翻 2 张、
// 天气每轮翻 2 张叠加（微光的反转规则、不设上限）、天气堆抽完只洗回弃掉的、庄家轮换 / 偷看 / 盲注、每轮的翻牌顺序（夕夏 10/30）、
// 下注（从庄家左边起、加注至少等于上一次加注额、每回合最多加注 3 次、不封顶、全押开边池、跟注后追加窗口）、
// 亮牌比分（2 张层牌求和、最高分拿走、同分平分、零头）、相位最低注翻倍、借贷和出局、能看到什么、平分底池的统计
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
for (const f of ["counter-cards.js", "flux-holdem.js"]) vm.runInContext(read(f), c, { filename: f });
const CC = c.CounterCards;
const X = c.FluxHoldem;
const C = CC.CC_CONFIG;
const J = v => JSON.parse(JSON.stringify(v));
const A = (g, id, type, extra) => X.act(g, id, Object.assign({ type }, extra || {}));
const P3 = [{ id: "p1", name: "甲" }, { id: "p2", name: "乙" }, { id: "p3", name: "丙" }];
const HANDS3 = { p1: ["fire", "ice", "physical"], p2: ["physical", "fire", "ice"], p3: ["ice", "physical", "fire"] };
const LAYERS = ["flesh", "armor", "shield", "sand", "spirit", "flesh", "armor", "shield", "sand", "spirit"];
const WEATHERS = ["heat", "snow", "acid", "thunder", "glow", "sand", "phase"];
const DRAWS = ["harmonic", "energy", "acid", "electric", "harmonic", "energy", "acid", "electric", "harmonic", "energy", "acid", "electric"];

/** 三人局：甲坐庄（第 1 轮），手牌、层牌、天气、摸牌都指定 */
function game3(o) {
  return X.newGame(Object.assign({ seed: "t", players: P3, hands: HANDS3, elements: DRAWS.slice(), layers: LAYERS.slice(), weathers: WEATHERS.slice() }, o || {}));
}
/** 到第一轮下注：要借的都不借、庄家偷看后放 where（默认留在顶上）、大家盖下 cards[id] */
function toBet1(g, cards, where) {
  while (g.stage === "loan") A(g, X.toAct(g)[0], "noLoan");
  A(g, g.dealer, "place", { where: where || "top" });
  Object.keys(cards).forEach(id => { if (X.toAct(g).indexOf(id) >= 0) A(g, id, "play", { card: cards[id] }); });
}
/** 这个下注回合都过牌 / 跟注，追加窗口都放弃 */
function settleStreet(g) {
  const st = g.stage, r = g.round;
  if (st !== "bet1" && st !== "bet2") return;
  for (let i = 0; i < 40 && g.stage === st && g.round === r && !g.over; i++) {
    const who = X.toAct(g);
    if (g.betting.window) { who.forEach(id => A(g, id, "pass")); continue; }
    const id = who[0], L = X.legal(g, id);
    A(g, id, L.some(o => o.type === "check") ? "check" : L.some(o => o.type === "call") ? "call" : "fold");
  }
}
/** 打完一整轮：盖下 cards（没写的盖第一张），两次下注都过牌 / 跟注 */
function quietRound(g, cards) {
  const r = g.round;
  while (g.stage === "loan") A(g, X.toAct(g)[0], "noLoan");
  if (g.round !== r || g.over) return;
  A(g, g.dealer, "place", { where: "top" });
  X.toAct(g).forEach(id => A(g, id, "play", { card: (cards && cards[id]) || g.sides[id].hand[0] }));
  settleStreet(g);
  settleStreet(g);
}

/* ---------- 配置、计分 ---------- */

test("配置：名字 Flux Hold'em 放在配置里（挂在 CC_CONFIG.holdem）；2–4 人、元素牌 4 组、开局 3 张每轮摸 1 张、公共层牌 2 组、盲注 1 / 2 × 轮数、每回合最多加注 3 次、相位最低注翻倍", () => {
  const Hc = C.holdem;
  assert.equal(Hc, X.HOLDEM_CONFIG);
  assert.equal(Hc.name, "Flux Hold'em");
  assert.equal(X.name(), "Flux Hold'em");
  assert.deepEqual([Hc.minPlayers, Hc.maxPlayers], [2, 4]);
  assert.deepEqual([Hc.elementSets, Hc.hand, Hc.draw, Hc.layerSets, Hc.layersPerRound, Hc.weathersPerRound], [4, 3, 1, 2, 2, 2]);
  assert.deepEqual(J(Hc.blinds), [1, 2]);
  assert.equal(Hc.maxRaises, 3);
  assert.equal(Hc.phaseMinBetMult, 2);
  assert.throws(() => X.newGame({ players: [{ id: "a" }] }), /2–4 人/);
  assert.throws(() => X.newGame({ players: [1, 2, 3, 4, 5].map(i => ({ id: "p" + i })) }), /2–4 人/);
});

test("计分：只有一张天气时就是 CounterCards.score；两张天气的修正直接相加、不设上限，和先后无关", () => {
  for (const w of [null].concat(C.weathers)) for (const el of C.elements) for (const ly of C.layers) {
    assert.equal(X.scoreStack(el, ly, w ? [w] : []), CC.score(el, ly, w), `${el}/${ly}/${w}`);
  }
  for (const a of C.weathers) for (const b of C.weathers) {
    if (a === b) continue;
    for (const el of C.elements) for (const ly of C.layers) assert.equal(X.scoreStack(el, ly, [a, b]), X.scoreStack(el, ly, [b, a]));
  }
  // 电打护盾：克制 +1 + 酸雨里电 +1 + 雷鸣里电 +1 = +3（不设上限）
  assert.equal(X.scoreStack("electric", "shield", ["acid", "thunder"]), 3);
  // 火打肉体：克制 +1 + 酷暑 +1 + 酸雨里火 −1 = +1
  assert.equal(X.scoreStack("fire", "flesh", ["heat", "acid"]), 1);
  // 没有微光：两张天气各自的修正相加，克制那一项不变
  for (const el of C.elements) for (const ly of C.layers) {
    assert.equal(X.scoreStack(el, ly, ["heat", "snow"]), CC.chartScore(el, ly, null) + CC.weatherScore(el, ly, "heat") + CC.weatherScore(el, ly, "snow"));
  }
});

test("计分：微光反转克制表（能量的克制不反转），也反转另一张天气给所有元素的修正（含给能量的、酸雨打装甲那一项），微光自己给能量的 +1 保留", () => {
  // 火打肉体，酷暑 + 微光：克制 +1 反转成 −1；酷暑给火的 +1 反转成 −1；微光不给火修正 → −2
  assert.equal(X.scoreStack("fire", "flesh", ["heat", "glow"]), -2);
  // 能量打星灵，雷鸣 + 微光：能量的克制不反转 +1；雷鸣给能量的 +1 反转成 −1；微光自己给能量的 +1 保留 → +1
  assert.equal(X.scoreStack("energy", "spirit", ["thunder", "glow"]), 1);
  // 火打装甲，酸雨 + 微光：克制 −1 反转成 +1；酸雨里火 −1、打装甲另 +1（合计 0）反转还是 0 → +1
  assert.equal(CC.score("fire", "armor", "acid"), -1);
  assert.equal(X.scoreStack("fire", "armor", ["acid", "glow"]), 1);
  // 物理打沙尘，酸雨 + 微光：克制 0；酸雨里物理 −1 反转成 +1 → +1
  assert.equal(X.scoreStack("physical", "sand", ["acid", "glow"]), 1);
  // 冰打装甲，酸雨 + 微光：酸雨打装甲那一项冰没有；酸雨里冰 −1 反转成 +1 → +1
  assert.equal(X.scoreStack("ice", "armor", ["acid", "glow"]), 1);
  // 能量打装甲，酸雨 + 微光：能量的克制 −1 不反转；酸雨里能量 0、打装甲另 +1，反转成 −1；微光给能量 +1 → −1
  assert.equal(CC.weatherScore("energy", "armor", "acid"), 1);
  assert.equal(X.scoreStack("energy", "armor", ["acid", "glow"]), -1);
  // 一般地：有微光时 = 微光下的克制 + 微光自己的修正 − 另一张的修正
  for (const w of C.weathers) {
    if (w === "glow") continue;
    for (const el of C.elements) for (const ly of C.layers) {
      assert.equal(X.scoreStack(el, ly, ["glow", w]), CC.chartScore(el, ly, "glow") + CC.weatherScore(el, ly, "glow") - CC.weatherScore(el, ly, w), `${el}/${ly}/${w}`);
    }
  }
});

test("克制表（得分）和悬停预览：格子就是两张天气叠加后的实际得分（scoreStack），写着两张天气；有微光时说明反转规则", () => {
  const ch = X.chart(["heat", "glow"]);
  assert.equal(ch.unit, "score");
  assert.equal(ch.weatherName, "酷暑 + 微光");
  assert.deepEqual(J(ch.weathers), ["heat", "glow"]);
  C.elements.forEach((el, i) => C.layers.forEach((ly, j) => {
    assert.equal(ch.cells[i][j].value, X.scoreStack(el, ly, ["heat", "glow"]));
    assert.equal(ch.cells[i][j].base, CC.score(el, ly, null));
  }));
  assert.equal(ch.cells[0][0].value, -2);
  assert.match(ch.cells[0][0].reason, /微光：克制关系反转/);
  assert.match(ch.cells[0][0].reason, /酷暑 \+1，被微光反转成 −1/);
  assert.match(ch.notes.join("\n"), /另一张天气给所有元素的修正（含给能量的、酸雨打装甲那一项）也反转/);
  assert.equal(ch.tag, "Flux Hold'em 得分");
  const one = X.chart(["heat"]);
  assert.equal(one.weatherName, "酷暑");
  assert.ok(!/微光/.test(one.notes.join("")));
  assert.equal(X.chart([]).weatherName, "没有天气");
  const tip = X.cardChart("fire", ["heat", "glow"]);
  assert.deepEqual(J(tip.cells.map(x => x.value)), J(C.layers.map(ly => X.scoreStack("fire", ly, ["heat", "glow"]))));
  assert.equal(X.cardChart("flesh", []), null, "层牌没有预览");
});

/* ---------- 开局、每轮流程 ---------- */

test("开局：元素牌 4 组 × 7 种共 28 张洗混，每人发 3 张（不足 4 人时剩下的盖着不发）；公共层牌 2 组 × 5 张；天气 7 张；同一个种子发得一样", () => {
  const g = X.newGame({ seed: "deal", players: P3 });
  const all = J(g.order.map(id => g.sides[id].hand)).flat().concat(J(g.elementDeck));
  assert.equal(all.length, 28);
  C.elements.forEach(el => assert.equal(all.filter(x => x === el).length, 4, el));
  g.order.forEach(id => assert.equal(g.sides[id].hand.length, 3));
  assert.equal(g.elementDeck.length, 19);
  const layers = J(g.layerDeck);
  assert.equal(layers.length, 10);
  C.layers.forEach(ly => assert.equal(layers.filter(x => x === ly).length, 2));
  assert.deepEqual(J(g.deck.slice().sort()), J(C.weathers.slice().sort()));
  const again = X.newGame({ seed: "deal", players: P3 });
  assert.deepEqual(J(again.sides.p1.hand), J(g.sides.p1.hand));
  assert.deepEqual(J(again.layerDeck), J(g.layerDeck));
  // 四人局正好发完 28 张（每人整局过手 7 张）
  const g4 = X.newGame({ seed: "deal4", players: [1, 2, 3, 4].map(i => ({ id: "p" + i })) });
  assert.equal(g4.elementDeck.length, 28 - 12);
});

test("每轮：庄家偷看天气堆顶（只有庄家看得到，放哪公开）→ 翻开第 1 张公共层牌、下盲注 → 盖牌 → 第一轮下注（从庄家左边起）→ 翻开第 1 张天气 → 第二轮下注 → 同时翻开第 2 张层牌和第 2 张天气比分", () => {
  const g = game3();
  assert.equal(g.round, 1);
  assert.equal(g.dealer, "p1");
  assert.equal(g.sb, "p2");
  assert.equal(g.bb, "p3");
  assert.equal(g.stage, "peek");
  assert.deepEqual(J(X.toAct(g)), ["p1"]);
  assert.deepEqual(J(X.view(g, "p1").peek), { card: "heat", where: null }, "庄家看得到堆顶");
  assert.equal(X.view(g, "p2").peek, undefined, "别人看不到");
  assert.ok(!JSON.stringify(X.view(g, "p2")).includes("heat"));
  assert.equal(g.layers.length, 0, "偷看时还没翻层牌");
  A(g, "p1", "place", { where: "top" });
  assert.match(g.log[g.log.length - 1].text || "", /甲偷看了天气堆顶，留在了顶上|翻开第 1 张公共层牌/);
  assert.ok(g.log.some(e => e.t === "peek" && /留在了顶上/.test(e.text)));
  assert.deepEqual(J(g.layers), ["flesh"], "翻开第 1 张公共层牌");
  assert.equal(g.weathers.length, 0, "天气还没翻");
  assert.deepEqual([g.sides.p2.bet, g.sides.p3.bet, g.sides.p1.bet], [1, 2, 0], "小盲 1、大盲 2");
  assert.equal(g.stage, "play");
  assert.deepEqual(J(X.toAct(g).slice().sort()), ["p1", "p2", "p3"], "大家同时盖牌");
  A(g, "p1", "play", { card: "fire" }); A(g, "p2", "play", { card: "physical" }); A(g, "p3", "play", { card: "ice" });
  assert.equal(g.stage, "bet1");
  assert.deepEqual(J(X.toAct(g)), ["p2"], "从庄家左边（小盲）开始");
  A(g, "p2", "call");
  assert.deepEqual(J(X.toAct(g)), ["p3"]);
  assert.ok(X.legal(g, "p3").some(o => o.type === "check"), "大盲可以过牌");
  A(g, "p3", "check");
  A(g, "p1", "call");
  assert.ok(g.betting.window, "跟注后开追加窗口");
  X.toAct(g).forEach(id => A(g, id, "pass"));
  assert.equal(g.stage, "bet2");
  assert.deepEqual(J(g.weathers), ["heat"], "翻开第 1 张天气（就是庄家留在顶上的那张）");
  assert.deepEqual(J(g.layers), ["flesh"], "第 2 张层牌还没翻");
  assert.deepEqual(J(X.toAct(g)), ["p2"], "第二轮也从庄家左边开始");
  A(g, "p2", "check"); A(g, "p3", "check"); A(g, "p1", "check");
  const r = g.results[0];
  assert.equal(r.outcome, "showdown");
  assert.deepEqual(J(r.layers), ["flesh", "armor"]);
  assert.deepEqual(J(r.weathers), ["heat", "snow"]);
  // 物理：肉体 0 + 雪天 +1；装甲 −1 + 雪天 +1 → +1。火：+1 +1 −1 = +1，−1 +1 −1 = −1 → 0。冰：0 −1 +1，0 −1 +1 → 0
  assert.deepEqual(J(r.shown), { p1: { card: "fire", score: 0 }, p2: { card: "physical", score: 1 }, p3: { card: "ice", score: 0 } });
  assert.deepEqual(J(r.winners), ["p2"]);
  assert.equal(r.pot, 6);
  assert.deepEqual(J(r.delta), { p1: -2, p2: 4, p3: -2 });
  assert.match(g.log.find(e => e.t === "result").text, /第 1 轮亮牌：甲〔火〕0，乙〔物理〕\+1，丙〔冰〕0。主池 6 枚归乙/);
});

test("第 2–5 轮开始时每人摸 1 张；庄家顺时针轮换（盲注跟着动）；层牌、天气每轮各翻 2 张，用过的公开", () => {
  const g = game3();
  quietRound(g, { p1: "fire", p2: "physical", p3: "ice" });
  assert.equal(g.round, 2);
  assert.deepEqual([g.dealer, g.sb, g.bb], ["p2", "p3", "p1"]);
  assert.deepEqual(J(g.sides.p1.hand), ["ice", "physical", "harmonic"], "用掉火，摸到谐波");
  assert.deepEqual(J(g.sides.p2.hand), ["fire", "ice", "energy"]);
  assert.deepEqual(J(g.sides.p3.hand), ["physical", "fire", "acid"]);
  assert.deepEqual(J(g.usedLayers), ["flesh", "armor"]);
  assert.deepEqual(J(g.discards), ["heat", "snow"]);
  quietRound(g);
  assert.deepEqual([g.dealer, g.sb, g.bb], ["p3", "p1", "p2"]);
  quietRound(g); quietRound(g); quietRound(g);
  assert.equal(g.over, true);
  assert.equal(g.results.length, 5);
  g.order.forEach(id => { assert.equal(g.sides[id].hand.length, 2, "整局过手 7 张，用了 5 张"); assert.equal(g.sides[id].history.length, 5); });
  assert.equal(g.layerDeck.length, 0, "10 张层牌正好用完");
});

test("两人局：庄家下小盲；第一轮从庄家左边（大盲）开始", () => {
  const g = X.newGame({ seed: "hu", players: [{ id: "a" }, { id: "b" }], weathers: WEATHERS.slice(), layers: LAYERS.slice() });
  assert.deepEqual([g.dealer, g.sb, g.bb], ["a", "a", "b"]);
  A(g, "a", "place", { where: "top" });
  assert.deepEqual([g.sides.a.bet, g.sides.b.bet], [1, 2]);
  A(g, "a", "play", { card: g.sides.a.hand[0] }); A(g, "b", "play", { card: g.sides.b.hand[0] });
  assert.deepEqual(J(X.toAct(g)), ["b"]);
  assert.deepEqual(J(X.legal(g, "b").map(o => o.type)), ["check", "raise", "fold"]);
  A(g, "b", "check");
  assert.deepEqual(J(X.toAct(g)), ["a"], "大盲过牌后小盲（庄家）还要补齐");
  assert.deepEqual(J(X.legal(g, "a").find(o => o.type === "call")), { type: "call", amount: 1 });
});

test("天气堆抽完：只把弃掉的天气洗回去重抽，场上生效中的不洗回——同一轮不会出现两张一样的天气", () => {
  for (let s = 0; s < 8; s++) {
    const g = X.newGame({ seed: "洗回" + s, players: [{ id: "a" }, { id: "b" }] });
    while (!g.over) {
      quietRound(g);
      const r = g.results[g.results.length - 1];
      if (r && r.weathers.length === 2) assert.notEqual(r.weathers[0], r.weathers[1], `第 ${r.r} 轮两张天气一样`);
    }
    assert.ok(g.reshuffles >= 1, "5 轮翻 10 张，7 张的天气堆至少洗回一次");
    const res4 = g.results[3];
    assert.ok(g.log.some(e => e.t === "reshuffle"));
    assert.ok(res4.weathers.length === 2);
  }
  // 指定顺序：第 4 轮第 1 张是第 7 张，第 2 张从前 6 张（弃掉的）里洗出来，不会是场上那张
  const g = X.newGame({ seed: "洗回", players: [{ id: "a" }, { id: "b" }], weathers: WEATHERS.slice() });
  for (let i = 0; i < 3; i++) quietRound(g);
  assert.equal(g.deck.length, 1);
  quietRound(g);
  const r = g.results[3];
  assert.equal(r.weathers[0], "phase");
  assert.ok(WEATHERS.slice(0, 6).indexOf(r.weathers[1]) >= 0);
});

/* ---------- 下注 ---------- */

test("下注：加注至少等于上一次加注额（第一轮下注时大盲算第一次下注），每个下注回合最多加注 3 次；下注不封顶（最大 = 自己手上的）", () => {
  const g = game3();
  toBet1(g, { p1: "fire", p2: "physical", p3: "ice" });
  // 小盲：要跟 1，加注至少 2（大盲）
  assert.deepEqual(J(X.legal(g, "p2").find(o => o.type === "raise")), { type: "raise", min: 2, max: 48 });
  A(g, "p2", "raise", { amount: 5 });
  assert.equal(g.sides.p2.bet, 7);
  assert.deepEqual(J(X.legal(g, "p3").find(o => o.type === "raise")), { type: "raise", min: 5, max: 43 }, "至少等于上一次加注额 5");
  assert.throws(() => A(g, "p3", "raise", { amount: 4 }), /加注额要在 5–43 枚之间/);
  A(g, "p3", "raise", { amount: 6 });
  A(g, "p1", "raise", { amount: 6 });
  assert.equal(g.betting.raises, 3);
  assert.deepEqual(J(X.legal(g, "p2").map(o => o.type)), ["call", "fold"], "加注 3 次用完");
  A(g, "p2", "call"); A(g, "p3", "call");
  assert.equal(g.stage, "bet2", "加注次数用完：跟注后不开窗口，直接下一步");
  assert.equal(g.betting.window, null);
  // 第二轮：没人下注时下注至少是最低下注额（轮数），最大是自己手上的
  assert.deepEqual(J(X.legal(g, "p2").find(o => o.type === "bet")), { type: "bet", min: 1, max: 31 });
});

test("跟不起：可以先借（3 枚一份，3 借 4 还，借完还是自己下注）、全押（开边池）或者弃牌", () => {
  const g = game3({ players: [{ id: "p1", name: "甲", chips: 10 }, { id: "p2", name: "乙" }, { id: "p3", name: "丙" }] });
  toBet1(g, { p1: "physical", p2: "fire", p3: "ice" });
  A(g, "p2", "call");
  A(g, "p3", "raise", { amount: 10 });
  const L = X.legal(g, "p1");
  assert.deepEqual(J(L.map(o => o.type)), ["allIn", "fold", "borrow"]);
  assert.deepEqual(J(L.find(o => o.type === "allIn")), { type: "allIn", amount: 10 });
  assert.deepEqual(J(L.find(o => o.type === "borrow")), { type: "borrow", min: 3, max: 3, step: 3, need: 13 });
  A(g, "p1", "borrow", { amount: 3 });
  assert.equal(g.sides.p1.chips, 13);
  assert.equal(g.sides.p1.owe, 4);
  assert.deepEqual(J(X.toAct(g)), ["p1"], "借完还是自己下注");
  assert.ok(X.legal(g, "p1").some(o => o.type === "call"));
  assert.match(g.log.map(e => e.text).join("\n"), /甲向主持方借了 3 枚筹码（对局结束时还 4 枚）/);
});

test("全押和边池（同德州）：押得少的只能赢到自己押到的那一层；边池给其余人里分最高的；同分平分", () => {
  const g = game3({ players: [{ id: "p1", name: "甲", chips: 10 }, { id: "p2", name: "乙" }, { id: "p3", name: "丙" }] });
  toBet1(g, { p1: "physical", p2: "fire", p3: "ice" });
  A(g, "p2", "call");
  A(g, "p3", "raise", { amount: 10 });
  A(g, "p1", "allIn");
  assert.equal(g.sides.p1.allIn, true);
  assert.equal(g.sides.p1.chips, 0);
  A(g, "p2", "call");
  assert.deepEqual(J(X.potsOf(g)), [{ amount: 30, eligible: ["p1", "p2", "p3"] }, { amount: 4, eligible: ["p2", "p3"] }]);
  X.toAct(g).forEach(id => A(g, id, "pass"));
  assert.equal(g.stage, "bet2");
  assert.deepEqual(J(X.toAct(g)), ["p2"], "全押的不再表态");
  A(g, "p2", "check"); A(g, "p3", "check");
  const r = g.results[0];
  assert.deepEqual(J(r.pots.map(p => ({ amount: p.amount, winners: p.winners, shares: p.shares }))), [
    { amount: 30, winners: ["p1"], shares: { p1: 30 } },
    { amount: 4, winners: ["p2", "p3"], shares: { p2: 2, p3: 2 } }
  ]);
  assert.equal(r.split, false, "主池没有平分");
  assert.deepEqual(J(r.chips), { p1: 30, p2: 40, p3: 40 });
  assert.match(g.log.find(e => e.t === "result").text, /主池 30 枚归甲；边池 1 4 枚由乙、丙平分/);
  assert.deepEqual(J(X.splitStats(g)), { rounds: 1, showdowns: 1, mainSplit: 0, anySplit: 1 });
});

test("同分平分：分不开的零头从庄家左边起一人一枚；弃牌的不参与比分", () => {
  const g = game3();
  toBet1(g, { p1: "ice", p2: "fire", p3: "ice" });
  A(g, "p2", "fold");
  A(g, "p3", "check");
  A(g, "p1", "call");
  X.toAct(g).forEach(id => A(g, id, "pass"));
  A(g, "p3", "check"); A(g, "p1", "check");
  const r = g.results[0];
  assert.deepEqual(J(Object.keys(r.shown)), ["p1", "p3"], "弃牌的乙不亮牌");
  assert.deepEqual(J(r.winners), ["p1", "p3"]);
  assert.equal(r.split, true);
  assert.equal(r.pot, 5);
  assert.deepEqual(J(r.pots[0].shares), { p1: 2, p3: 3 }, "零头给庄家（甲）左边起第一个赢家：丙");
  assert.deepEqual(J(r.folded), ["p2"]);
  assert.deepEqual(J(X.splitStats(g)), { rounds: 1, showdowns: 1, mainSplit: 1, anySplit: 1 });
});

test("只剩一个人没弃牌：他拿走整个底池，不亮牌，第 2 张层牌、天气不翻", () => {
  const g = game3();
  toBet1(g, { p1: "fire", p2: "physical", p3: "ice" });
  A(g, "p2", "fold");
  A(g, "p3", "raise", { amount: 4 });
  A(g, "p1", "fold");
  const r = g.results[0];
  assert.equal(r.outcome, "fold");
  assert.deepEqual(J(r.winners), ["p3"]);
  assert.equal(r.pot, 1 + 6);
  assert.equal(r.shown, undefined);
  assert.deepEqual(J(r.layers), ["flesh"]);
  assert.deepEqual(J(r.weathers), []);
  assert.equal(g.round, 2);
  assert.match(g.log.find(e => e.t === "result").text, /其他人都弃牌，丙拿走底池 7 枚/);
});

test("跟注后的追加窗口（同 High Flux，秒数读 CC_CONFIG.callWindowSec）：还能下注的人都可以加注 / 弃牌 / 放弃；有人加注就关窗、照常轮流应对；都放弃或到时间关窗", () => {
  const g = game3();
  toBet1(g, { p1: "fire", p2: "physical", p3: "ice" });
  A(g, "p2", "call"); A(g, "p3", "check"); A(g, "p1", "call");
  assert.ok(g.betting.window);
  assert.deepEqual(J(X.toAct(g).slice().sort()), ["p1", "p2", "p3"]);
  assert.deepEqual(J(X.legal(g, "p2").map(o => o.type)), ["pass", "raise", "fold"]);
  assert.equal(X.view(g, "p2").betting.window.sec, C.callWindowSec);
  A(g, "p2", "pass");
  assert.deepEqual(J(X.toAct(g).slice().sort()), ["p1", "p3"]);
  assert.deepEqual(J(X.view(g, "p3").waiting.slice().sort()), ["p1", "p2", "p3"], "别人放没放弃看不出来");
  A(g, "p3", "raise", { amount: 2 });
  assert.equal(g.betting.window, null, "加注关窗");
  assert.equal(g.betting.raises, 1);
  assert.deepEqual(J(X.toAct(g)), ["p1"], "从加注的人左边起应对");
  assert.ok(g.log.some(e => e.t === "bet" && e.op === "raise" && e.window && /丙在追加窗口里加注 2 枚/.test(e.text)));
  A(g, "p1", "call"); A(g, "p2", "fold");
  assert.ok(g.betting.window, "加注有人跟过（之后乙弃牌结束这一回合），又开窗口");
  assert.equal(g.betting.window.n, 2);
  assert.equal(g.betting.window.by, "p1");
  assert.deepEqual(J(X.toAct(g).slice().sort()), ["p1", "p3"], "弃牌的不在窗口里");
  assert.equal(X.closeWindow(g), true, "到时间关窗");
  assert.equal(g.stage, "bet2");
  assert.ok(g.log.some(e => e.t === "window" && e.why === "timeout"));
  assert.equal(X.closeWindow(g), false);
});

test("相位：第 1 张天气翻到相位，这一轮剩下的下注最低额翻倍（加注下限也跟着）", () => {
  const g = game3({ weathers: ["phase", "heat", "snow", "acid", "thunder", "glow", "sand"] });
  toBet1(g, { p1: "fire", p2: "physical", p3: "ice" });
  settleStreet(g);
  assert.deepEqual(J(g.weathers), ["phase"]);
  assert.equal(X.minBetNow(g), 2);
  assert.deepEqual(J(X.legal(g, "p2").find(o => o.type === "bet")), { type: "bet", min: 2, max: 48 });
  assert.match(g.log.find(e => e.t === "weather").text, /这一轮最低下注额翻倍（2 枚）/);
  A(g, "p2", "bet", { amount: 2 });
  assert.equal(X.legal(g, "p3").find(o => o.type === "raise").min, 2);
});

/* ---------- 借贷、出局、结束 ---------- */

test("借贷：每轮开始手上不够「该下的盲注 + 最低下注额」先问；输光了不借就出局，剩下的人接着打（庄家、盲注跳过出局的）；不到两个人就结束", () => {
  const g = game3({ players: [{ id: "p1", name: "甲" }, { id: "p2", name: "乙" }, { id: "p3", name: "丙", chips: 1 }] });
  assert.equal(g.stage, "loan");
  assert.deepEqual(J(X.toAct(g)), ["p3"], "丙是大盲，1 枚不够 2 + 1");
  assert.deepEqual(J(X.legal(g, "p3")), [{ type: "borrow", min: 3, max: 3, step: 3, need: 3 }, { type: "noLoan" }]);
  A(g, "p3", "noLoan");
  assert.equal(g.sides.p3.out, false, "没输光，不借也接着打");
  A(g, "p1", "place", { where: "top" });
  assert.equal(g.sides.p3.bet, 1, "大盲只下得起 1 枚：全押");
  assert.equal(g.sides.p3.allIn, true);
  ["p1", "p2", "p3"].forEach(id => A(g, id, "play", { card: { p1: "physical", p2: "fire", p3: "ice" }[id] }));
  settleStreet(g); settleStreet(g);
  assert.deepEqual(J(g.results[0].winners), ["p1"]);
  assert.equal(g.results[0].chips.p3, 0);
  // 第 2 轮：丙输光了，先问丙；不借就出局，变成两人局（乙坐庄下小盲）
  assert.equal(g.stage, "loan");
  assert.deepEqual(J(X.toAct(g)), ["p3"]);
  A(g, "p3", "noLoan");
  assert.equal(g.sides.p3.out, true);
  assert.match(g.log.map(e => e.text).join("\n"), /丙输光了，没有向主持方借，出局/);
  assert.deepEqual([g.dealer, g.sb, g.bb], ["p2", "p2", "p1"]);
  assert.equal(g.sides.p3.hand.length, 3, "出局的人不再盖牌");
  A(g, "p2", "place", { where: "top" });
  assert.deepEqual(J(X.toAct(g).slice().sort()), ["p1", "p2"]);
  ["p1", "p2"].forEach(id => A(g, id, "play", { card: g.sides[id].hand[0] }));
  settleStreet(g); settleStreet(g);
  assert.equal(g.round, 3);
  // 打完：最终筹码扣还借款，最多的赢
  while (!g.over) quietRound(g);
  assert.deepEqual(J(g.final.out), ["p3"]);
  assert.ok(g.final.winners.length >= 1);
  const total = g.order.reduce((t, id) => t + g.final.chips[id] + g.sides[id].owe - g.sides[id].loan, 0);
  assert.equal(total, 101, "筹码守恒");
});

test("借贷：输光了借了就接着打；对局结束从筹码里扣还（3 借 4 还），按最终筹码数定赢家", () => {
  const g = X.newGame({ seed: "借", players: [{ id: "a", chips: 0 }, { id: "b" }], layers: LAYERS.slice(), weathers: WEATHERS.slice() });
  assert.deepEqual(J(X.toAct(g)), ["a"]);
  A(g, "a", "borrow", { amount: 3 });
  assert.equal(g.sides.a.chips, 3);
  assert.equal(g.stage, "peek");
  while (!g.over) quietRound(g);
  assert.equal(g.final.loans.a.owe >= 4, true);
  assert.equal(g.final.chips.a, g.final.held.a - g.final.loans.a.owe);
  const best = Math.max(g.final.chips.a, g.final.chips.b);
  assert.deepEqual(J(g.final.winners), ["a", "b"].filter(id => g.final.chips[id] === best));
});

test("能看到什么：自己的手牌和盖下的牌；别人只有张数和「盖了没有」；牌堆的顺序、别人的私人记录都不在 view 里", () => {
  const g = game3();
  toBet1(g, { p1: "fire", p2: "physical" });
  const v = X.view(g, "p3");
  assert.deepEqual(J(v.me.hand), ["ice", "physical", "fire"]);
  const p1 = v.seats.find(s => s.id === "p1");
  assert.equal(p1.played, true);
  assert.equal(p1.handCount, 2);
  ["hand", "card", "history"].forEach(k => assert.ok(!(k in p1), k));
  ["deck", "layerDeck", "elementDeck", "peek"].forEach(k => assert.ok(!(k in v), k));
  assert.ok(!v.log.some(e => e.to && e.to !== "p3"));
  assert.equal(v.deckCount, 7);
  assert.deepEqual(J(v.layers), ["flesh"]);
  assert.deepEqual([v.dealer, v.sb, v.bb], ["p1", "p2", "p3"]);
  // 亮牌之后公开：没弃牌的人出了什么、得几分
  A(g, "p3", "play", { card: "ice" });
  settleStreet(g); settleStreet(g);
  assert.deepEqual(J(X.view(g, "p3").results[0].shown.p1), { card: "fire", score: 0 });
});

test("统计平分底池（splitStats）：每局打到亮牌的轮数、主池平分的轮数、任何一个池平分的轮数", () => {
  const g = game3();
  while (!g.over) quietRound(g);
  const s = X.splitStats(g);
  assert.equal(s.rounds, 5);
  assert.equal(s.showdowns, 5);
  assert.equal(s.mainSplit, g.results.filter(r => r.winners.length > 1).length);
  assert.ok(s.anySplit >= s.mainSplit);
});
