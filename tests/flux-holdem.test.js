// Flux Hold'em（#488）· 规则引擎 flux-holdem.js：2–4 人公共牌桌——元素牌 4 组 × 7 张发牌 / 摸牌、公共层牌 2 组 × 5 张每轮翻 2 张、
// 天气每轮翻 2 张叠加（微光的反转规则、不设上限）、天气堆抽完只洗回弃掉的、庄家轮换 / 偷看 / 盲注、每轮的翻牌顺序（夕夏 10/30）、
// 下注（从庄家左边起、加注至少等于上一次加注额、每回合最多加注 3 次、不封顶、全押开边池、跟注后追加窗口）、
// 亮牌比分（2 张层牌求和、最高分拿走、同分平分、零头）、相位全押（主人 10/30 确认：第 1 张 / 第 2 张天气是相位、按没弃牌的人里筹码最少那位封顶、
// 全押后同分底池滚到下一轮、最后一轮同分的人平分）、借贷和出局、能看到什么、平分底池的统计；
// 累积奖池（#534，主人 10/31）：盲注进累积奖池不进底池（下注的算法不变）、单独最高分拿走（全押、边池也整个拿走；其他人都弃牌也拿走）、
// 同分留到下一轮（弃过牌的人之后照样能赢）、最后一轮同分加赛（重洗层牌和天气、每人再盖 1 张、相位不全押、还同分接着加赛、手牌用光平分）、
// 对局提前结束归剩下的人、随机打很多局筹码守恒
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
/** 打完一整轮：盖下 cards（没写的盖第一张），两次下注都过牌 / 跟注。要借的不借——
 *  除非输光了（翻到相位全押以后会有人输光，不借就出局；这里借够这一轮的接着打，免得后面几轮少人）。
 *  最后一轮同分的加赛（#534）：参加的人各盖第一张，打一次加赛 */
function quietRound(g, cards) {
  if (g.stage === "playoff") { X.toAct(g).forEach(id => A(g, id, "play", { card: g.sides[id].hand[0] })); return; }
  const r = g.round;
  while (g.stage === "loan") {
    const id = X.toAct(g)[0], o = X.legal(g, id).find(x => x.type === "borrow");
    if (o && g.sides[id].chips <= 0) A(g, id, "borrow", { amount: o.max }); else A(g, id, "noLoan");
  }
  if (g.round !== r || g.over) return;
  A(g, g.dealer, "place", { where: "top" });
  X.toAct(g).forEach(id => A(g, id, "play", { card: (cards && cards[id]) || g.sides[id].hand[0] }));
  settleStreet(g);
  settleStreet(g);
}

/* ---------- 配置、计分 ---------- */

test("配置：名字 Flux Hold'em 放在配置里（挂在 CC_CONFIG.holdem）；2–4 人、元素牌 4 组、开局 3 张每轮摸 1 张、公共层牌 2 组、盲注 1 / 2 × 轮数、每回合最多加注 3 次；相位改成全押，没有最低注翻倍了", () => {
  const Hc = C.holdem;
  assert.equal(Hc, X.HOLDEM_CONFIG);
  assert.equal(Hc.name, "Flux Hold'em");
  assert.equal(X.name(), "Flux Hold'em");
  assert.deepEqual([Hc.minPlayers, Hc.maxPlayers], [2, 4]);
  assert.deepEqual([Hc.elementSets, Hc.hand, Hc.draw, Hc.layerSets, Hc.layersPerRound, Hc.weathersPerRound], [4, 3, 1, 2, 2, 2]);
  assert.deepEqual(J(Hc.blinds), [1, 2]);
  assert.equal(Hc.maxRaises, 3);
  assert.ok(!("phaseMinBetMult" in Hc), "相位 = 全押（主人 10/30），去掉了「最低注翻倍」");
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
  // 盲注（小盲 1 + 大盲 2）进累积奖池（#534）：底池只有跟注的 2 + 1；乙单独最高分，底池、累积奖池都归他
  assert.equal(r.pot, 3);
  assert.deepEqual(J(r.jackpot), { amount: 3, added: 3, winner: "p2", tied: [], shares: { p2: 3 } });
  assert.deepEqual(J(r.delta), { p1: -2, p2: 4, p3: -2 });
  assert.match(g.log.find(e => e.t === "result").text, /第 1 轮亮牌：甲〔火〕0，乙〔物理〕\+1，丙〔冰〕0。主池 3 枚归乙；累积奖池 3 枚归乙/);
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
  // 分层照旧按每人押的总数（含盲注）：10 / 12；每一层里扣掉盲注（乙 1、丙 2，#534）——主池 10 + 9 + 8，边池 2 + 2
  assert.deepEqual(J(X.potsOf(g)), [{ amount: 27, eligible: ["p1", "p2", "p3"] }, { amount: 4, eligible: ["p2", "p3"] }]);
  X.toAct(g).forEach(id => A(g, id, "pass"));
  assert.equal(g.stage, "bet2");
  assert.deepEqual(J(X.toAct(g)), ["p2"], "全押的不再表态");
  A(g, "p2", "check"); A(g, "p3", "check");
  const r = g.results[0];
  assert.deepEqual(J(r.pots.map(p => ({ amount: p.amount, winners: p.winners, shares: p.shares }))), [
    { amount: 27, winners: ["p1"], shares: { p1: 27 } },
    { amount: 4, winners: ["p2", "p3"], shares: { p2: 2, p3: 2 } }
  ]);
  assert.equal(r.split, false, "主池没有平分");
  assert.equal(r.jackpot.winner, "p1", "全押的甲单独最高分：累积奖池整个归他");
  assert.deepEqual(J(r.chips), { p1: 30, p2: 40, p3: 40 });
  assert.match(g.log.find(e => e.t === "result").text, /主池 27 枚归甲；边池 1 4 枚由乙、丙平分；累积奖池 3 枚归甲/);
  assert.deepEqual(J(X.splitStats(g)), { rounds: 1, showdowns: 1, mainSplit: 0, anySplit: 1, allIns: 0, carried: 0 });
});

test("同分平分：分不开的零头从庄家左边起一人一枚；弃牌的不参与比分", () => {
  const g = game3();
  toBet1(g, { p1: "ice", p2: "fire", p3: "ice" });
  A(g, "p2", "call");
  A(g, "p3", "check");
  A(g, "p1", "call");
  X.toAct(g).forEach(id => A(g, id, "pass"));
  A(g, "p2", "fold");
  A(g, "p3", "check"); A(g, "p1", "check");
  const r = g.results[0];
  assert.deepEqual(J(Object.keys(r.shown)), ["p1", "p3"], "弃牌的乙不亮牌");
  assert.deepEqual(J(r.winners), ["p1", "p3"]);
  assert.equal(r.split, true);
  // 底池：甲跟的 2 + 乙补的 1（乙的小盲 1、丙的大盲 2 进累积奖池，#534）
  assert.equal(r.pot, 3);
  assert.deepEqual(J(r.pots[0].shares), { p1: 1, p3: 2 }, "零头给庄家（甲）左边起第一个赢家：丙");
  assert.deepEqual(J(r.folded), ["p2"]);
  assert.deepEqual(J(X.splitStats(g)), { rounds: 1, showdowns: 1, mainSplit: 1, anySplit: 1, allIns: 0, carried: 0 });
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
  // 底池：丙加注的 4（乙的小盲 1、丙的大盲 2 在累积奖池里，#534）；只剩丙，底池、累积奖池都归他
  assert.equal(r.pot, 4);
  assert.deepEqual(J(r.jackpot), { amount: 3, added: 3, winner: "p3", tied: [], shares: { p3: 3 } });
  assert.equal(r.delta.p3, 1, "丙押了 6，拿回 4 + 3");
  assert.equal(r.shown, undefined);
  assert.deepEqual(J(r.layers), ["flesh"]);
  assert.deepEqual(J(r.weathers), []);
  assert.equal(g.round, 2);
  assert.match(g.log.find(e => e.t === "result").text, /其他人都弃牌，丙拿走底池 4 枚和累积奖池 3 枚/);
});

test("每轮结算时亮出每个人这一轮盖下的牌（主人 10/31，HOLDEM_CONFIG.revealAll）：比分的照旧写分；弃牌的人也亮（不计分、不参与比分）；结算之前别人盖下的牌照旧看不到", () => {
  assert.equal(C.holdem.revealAll, true, "开关放在配置里");
  const g = game3();
  toBet1(g, { p1: "ice", p2: "fire", p3: "ice" });
  A(g, "p2", "fold");
  assert.equal(X.view(g, "p1").seats.find(s => s.id === "p2").card, undefined, "结算之前看不到乙盖下的牌（弃牌了也一样）");
  A(g, "p3", "check");
  A(g, "p1", "call");
  X.toAct(g).forEach(id => A(g, id, "pass"));
  A(g, "p3", "check"); A(g, "p1", "check");
  const r = g.results[0];
  assert.deepEqual(J(r.played), { p1: "ice", p2: "fire", p3: "ice" }, "三个人盖下的牌都亮出来");
  assert.deepEqual(J(Object.keys(r.shown)), ["p1", "p3"], "比分的还是没弃牌的两个");
  assert.deepEqual(J(r.winners), ["p1", "p3"], "弃牌的乙不参与比分");
  assert.match(g.log.find(e => e.t === "result").text, /第 1 轮亮牌：甲〔冰〕.*丙〔冰〕.*；弃牌的乙〔火〕/);
  for (const id of ["p1", "p2", "p3"]) assert.deepEqual(J(X.view(g, id).results[0].played), { p1: "ice", p2: "fire", p3: "ice" }, id + " 看得到亮出来的牌");
});

test("其他人都弃牌直接赢的那一轮也亮牌（主人 10/31）：每人这一轮盖下的牌都亮出来，不比分、不翻第 2 张层牌和天气", () => {
  const g = game3();
  toBet1(g, { p1: "fire", p2: "physical", p3: "ice" });
  A(g, "p2", "fold");
  A(g, "p3", "raise", { amount: 4 });
  A(g, "p1", "fold");
  const r = g.results[0];
  assert.equal(r.outcome, "fold");
  assert.equal(r.shown, undefined, "不比分");
  assert.deepEqual(J(r.played), { p1: "fire", p2: "physical", p3: "ice" });
  assert.deepEqual([J(r.layers), J(r.weathers)], [["flesh"], []]);
  assert.match(g.log.find(e => e.t === "result").text, /其他人都弃牌，丙拿走底池 4 枚和累积奖池 3 枚；亮牌：甲〔火〕、乙〔物理〕、丙〔冰〕/);
});

test("revealAll 关掉（false）就照原规则：只亮比分的人，弃牌的和直接赢的那一轮不亮", () => {
  C.holdem.revealAll = false;
  try {
    const g = game3();
    toBet1(g, { p1: "fire", p2: "physical", p3: "ice" });
    A(g, "p2", "fold"); A(g, "p3", "raise", { amount: 4 }); A(g, "p1", "fold");
    assert.equal(g.results[0].played, undefined);
    assert.doesNotMatch(g.log.find(e => e.t === "result").text, /亮牌/);
  } finally { C.holdem.revealAll = true; }
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

/* ---------- 相位：没弃牌的人全押（主人 10/30 确认，取代「本轮最低注翻倍」） ---------- */

const PHASE_FIRST = ["phase", "heat", "snow", "acid", "thunder", "glow", "sand"];

test("相位在第 1 张天气：第一轮下注后翻到相位，没弃牌的人全押（上限 = 筹码最少那位的全部筹码），跳过第二轮下注，直接比分", () => {
  const g = game3({ players: [{ id: "p1", name: "甲", chips: 20 }, { id: "p2", name: "乙" }, { id: "p3", name: "丙", chips: 30 }], weathers: PHASE_FIRST.slice() });
  assert.equal(X.minBetNow(g), 1, "最低下注额就是轮数，不再翻倍");
  toBet1(g, { p1: "fire", p2: "physical", p3: "ice" });
  settleStreet(g);                                   // 第一轮都跟到大盲 2 枚
  assert.equal(g.round, 2, "第 1 张天气是相位：不进第二轮下注，这一轮已经结算");
  const r = g.results[0];
  assert.equal(r.outcome, "showdown");
  assert.equal(r.allIn, true);
  assert.equal(r.phaseAt, 1);
  assert.equal(r.cap, 20, "甲一共只有 20 枚（已下的 2 + 手上的 18）：其他人也只押到 20");
  assert.deepEqual(J(r.bets), { p1: 20, p2: 20, p3: 20 });
  assert.deepEqual(J(r.weathers), ["phase", "heat"], "亮牌时照样翻第 2 张天气");
  assert.deepEqual(J(r.layers), ["flesh", "armor"]);
  // 相位不改得分：火 +2、物理 −1、冰 −2
  assert.deepEqual(J(r.shown), { p1: { card: "fire", score: 2 }, p2: { card: "physical", score: -1 }, p3: { card: "ice", score: -2 } });
  assert.deepEqual(J(r.winners), ["p1"]);
  // 全押的上限照旧按含盲注的押注算（下注的算法不变）；底池 = 60 − 盲注 3，盲注在累积奖池里，也归单独最高分的甲（#534）
  assert.equal(r.pot, 57);
  assert.equal(r.jackpot.winner, "p1");
  assert.deepEqual(J(r.chips), { p1: 60, p2: 30, p3: 10 });
  assert.ok(!g.log.some(e => e.t === "bet" && e.r === 1 && e.street === 2), "第二轮下注没进行");
  assert.match(g.log.find(e => e.t === "weather" && e.r === 1).text, /翻开第 1 张天气〔相位〕/);
  assert.match(g.log.find(e => e.t === "allIn").text, /翻到相位：没弃牌的人全押，各押到 20 枚（没弃牌的人里筹码最少那位的全部筹码），不再下注，直接比分/);
  assert.match(g.log.find(e => e.t === "result").text, /相位全押（各押到 20 枚）/);
  // 克制表的说明照新规则写
  assert.match(X.chart(["phase", "heat"]).notes.join("\n"), /相位：不改得分；翻开时没弃牌的人全押（上限是没弃牌的人里筹码最少那位的全部筹码），不再下注直接比分；全押后同分底池滚到下一轮，最后一轮同分的人平分/);
});

test("相位在第 2 张天气：第二轮下注照常，亮牌时翻到相位——比分之前没弃牌的人补押到全押的数目再比分（弃牌的不算进上限）", () => {
  const g = game3({ players: [{ id: "p1", name: "甲" }, { id: "p2", name: "乙", chips: 10 }, { id: "p3", name: "丙", chips: 30 }],
    weathers: ["heat", "phase", "snow", "acid", "thunder", "glow", "sand"] });
  toBet1(g, { p1: "fire", p2: "physical", p3: "ice" });
  settleStreet(g);
  assert.equal(g.stage, "bet2", "第 1 张天气是酷暑：照常第二轮下注");
  assert.deepEqual(J(g.weathers), ["heat"]);
  A(g, "p2", "fold");
  A(g, "p3", "check");
  A(g, "p1", "bet", { amount: 3 });
  A(g, "p3", "call");
  X.toAct(g).forEach(id => A(g, id, "pass"));
  const r = g.results[0];
  assert.equal(r.allIn, true);
  assert.equal(r.phaseAt, 2);
  assert.equal(r.cap, 30, "没弃牌的甲（50）、丙（30）里最少的是丙；弃牌的乙（10）不算");
  assert.deepEqual(J(r.bets), { p1: 30, p2: 2, p3: 30 }, "甲、丙各从 5 枚补到 30 枚；弃牌的乙不补");
  assert.deepEqual(J(r.weathers), ["heat", "phase"]);
  assert.deepEqual(J(r.shown), { p1: { card: "fire", score: 2 }, p3: { card: "ice", score: -2 } });
  assert.equal(r.pot, 62 - 3, "盲注 3 枚在累积奖池里（#534）");
  assert.equal(r.jackpot.winner, "p1");
  assert.deepEqual(J(r.chips), { p1: 82, p2: 8, p3: 0 });
  assert.match(g.log.find(e => e.t === "allIn").text, /第 2 张天气是相位：没弃牌的人补押到 30 枚（没弃牌的人里筹码最少那位的全部筹码），再比分/);
});

test("相位全押的上限：筹码不一样多时按最少那位封顶——之前已经全押得少的那位就是上限，押得比上限多的不退、照旧开边池", () => {
  const g = game3({ players: [{ id: "p1", name: "甲", chips: 6 }, { id: "p2", name: "乙" }, { id: "p3", name: "丙" }],
    hands: { p1: ["acid", "ice", "physical"], p2: ["fire", "physical", "ice"], p3: ["ice", "physical", "fire"] }, weathers: PHASE_FIRST.slice() });
  toBet1(g, { p1: "acid", p2: "fire", p3: "ice" });
  A(g, "p2", "call");
  A(g, "p3", "raise", { amount: 8 });
  A(g, "p1", "allIn");                               // 甲跟不起：全押 6 枚
  A(g, "p2", "call");
  X.toAct(g).forEach(id => A(g, id, "pass"));
  const r = g.results[0];
  assert.equal(r.allIn, true);
  assert.equal(r.cap, 6);
  assert.deepEqual(J(r.bets), { p1: 6, p2: 10, p3: 10 }, "乙、丙不用再补，多押的 4 枚也不退");
  // 酸 +3 拿主池 6 × 3 − 盲注 3 = 15 枚（盲注进累积奖池，#534）；乙、丙多押的 4 × 2 = 8 枚是边池，火 +2 拿走；累积奖池 3 枚归单独最高分的甲
  assert.deepEqual(J(r.pots.map(p => ({ amount: p.amount, eligible: p.eligible, winners: p.winners }))),
    [{ amount: 15, eligible: ["p1", "p2", "p3"], winners: ["p1"] }, { amount: 8, eligible: ["p2", "p3"], winners: ["p2"] }]);
  assert.equal(r.jackpot.winner, "p1");
  assert.deepEqual(J(r.chips), { p1: 18, p2: 48, p3: 40 });
  // 筹码一样多：全押就是各自的全部筹码
  const h = game3({ weathers: PHASE_FIRST.slice() });
  toBet1(h, { p1: "fire", p2: "physical", p3: "ice" });
  settleStreet(h);
  assert.equal(h.results[0].cap, 50);
  assert.deepEqual(J(h.results[0].bets), { p1: 50, p2: 50, p3: 50 });
});

test("相位全押后同分：底池不分，留在桌上滚到下一轮——算进下一轮的主池，下一轮还在牌局里的人都能赢", () => {
  const g = game3({ players: [{ id: "p1", name: "甲" }, { id: "p2", name: "乙" }, { id: "p3", name: "丙", chips: 20 }],
    hands: { p1: ["acid", "ice", "physical"], p2: ["acid", "fire", "ice"], p3: ["fire", "ice", "physical"] }, weathers: PHASE_FIRST.slice() });
  toBet1(g, { p1: "acid", p2: "acid", p3: "fire" });
  settleStreet(g);
  const r = g.results[0];
  // 酸 +3、酸 +3、火 +2：甲、乙同分最高
  assert.deepEqual(J(Object.keys(r.shown).map(id => r.shown[id].score)), [3, 3, 2]);
  assert.equal(r.cap, 20);
  assert.equal(r.pot, 57, "60 − 盲注 3（盲注进累积奖池，#534）");
  assert.equal(r.carry, 57, "整个底池滚到下一轮");
  assert.equal(r.split, false, "没有平分");
  assert.deepEqual(J(r.winners), [], "这一轮没人拿走底池");
  assert.equal(r.pots[0].carried, true);
  assert.deepEqual(J(r.pots[0].tied), ["p1", "p2"]);
  assert.deepEqual(J(r.pots[0].shares), {});
  assert.deepEqual(J(r.jackpot), { amount: 3, added: 3, winner: null, tied: ["p1", "p2"], shares: {}, kept: true }, "累积奖池也同分，留到下一轮（和滚存的底池分开记）");
  assert.deepEqual(J(r.delta), { p1: -20, p2: -20, p3: -20 }, "谁都没拿回");
  assert.deepEqual(J(g.carry), { amount: 57, from: ["p1", "p2"], r: 1 });
  assert.match(g.log.find(e => e.t === "result").text, /主池 57 枚：甲、乙同分（相位全押），滚到下一轮；累积奖池 3 枚：甲、乙同分，留到下一轮/);
  assert.deepEqual(J(X.splitStats(g)), { rounds: 1, showdowns: 1, mainSplit: 0, anySplit: 0, allIns: 1, carried: 1 });
  // 第 2 轮：丙输光了，借 6 枚接着打；滚存的 57 枚先放在底池里，这一轮的盲注进累积奖池（大家都看得到）
  assert.deepEqual(J(X.toAct(g)), ["p3"]);
  A(g, "p3", "borrow", { amount: 6 });
  A(g, "p2", "place", { where: "top" });
  const v = X.view(g, "p1");
  assert.deepEqual(J(v.carry), { amount: 57, from: ["p1", "p2"], r: 1 });
  assert.equal(v.pot, 57, "底池 = 滚存的 57（小盲 2、大盲 4 不算在底池里）");
  assert.equal(v.jackpot, 3 + 2 + 4, "累积奖池 = 上一轮留下的 3 + 小盲 2 + 大盲 4");
  // 第 2 轮丙的冰 0 分最高（甲物理 −1、乙火 −4）：上一轮输给甲、乙的丙也能把滚存的、累积奖池拿走
  ["p1", "p2", "p3"].forEach(id => A(g, id, "play", { card: { p1: "physical", p2: "fire", p3: "ice" }[id] }));
  settleStreet(g); settleStreet(g);
  const r2 = g.results[1];
  assert.deepEqual(J(r2.weathers), ["snow", "acid"]);
  assert.equal(r2.carryIn, 57);
  assert.deepEqual(J(r2.pots.map(p => ({ amount: p.amount, winners: p.winners }))), [{ amount: 12 - 6 + 57, winners: ["p3"] }]);
  assert.deepEqual(J(r2.jackpot), { amount: 9, added: 6, winner: "p3", tied: [], shares: { p3: 9 } });
  assert.equal(r2.chips.p3, 2 + 63 + 9);
  assert.equal(g.carry, null, "拿走了就不再滚存");
  assert.equal(g.jackpot, 0);
  assert.match(g.log.filter(e => e.t === "result")[1].text, /主池 63 枚归丙（含上一轮滚存的 57 枚）；累积奖池 9 枚归丙/);
  // 筹码守恒：开局 50 + 50 + 20，加上借的 6
  assert.equal(g.order.reduce((t, id) => t + g.sides[id].chips, 0), 126);
});

test("相位全押后同分、最后一轮：同分的人平分底池（不再滚存）；累积奖池由同分的人加赛", () => {
  // 前 4 轮天气都不是相位；第 5 轮第 1 张是相位、第 2 张酷暑（#497 以后酸雨也豁免谐波，原来那张酸雨让三个人都 +1，改成酷暑）
  const g = game3({ weathers: ["heat", "snow", "acid", "thunder", "glow", "sand", "heat", "snow", "phase", "heat"] });
  [{ p1: "fire", p2: "physical", p3: "ice" }, { p1: "ice", p2: "fire", p3: "physical" }, { p1: "physical", p2: "ice", p3: "fire" },
    { p1: "harmonic", p2: "harmonic", p3: "acid" }].forEach(cards => quietRound(g, cards));
  assert.equal(g.round, 5);
  assert.ok(!g.results.some(r => r.allIn), "前 4 轮没有相位");
  const before = J(g.order.map(id => g.sides[id].chips));
  toBet1(g, { p1: "energy", p2: "acid", p3: "electric" });
  settleStreet(g);
  const r = g.results[4];
  assert.equal(r.allIn, true);
  // 沙尘 + 星灵，相位 + 酷暑：能量 +1、酸 +1、电 −1——甲、乙同分最高
  assert.deepEqual(J(Object.keys(r.shown).map(id => r.shown[id].score)), [1, 1, -1]);
  assert.ok(!r.carry, "最后一轮不滚存");
  assert.equal(r.split, true);
  assert.deepEqual(J(r.winners), ["p1", "p2"]);
  // 第 5 轮的盲注 5 + 10 进累积奖池（#534），不在底池里
  const cap = r.cap, pot = cap * 3 - 15;
  assert.equal(cap, Math.min(...before));
  assert.equal(r.pot, pot);
  assert.equal(r.pots[0].shares.p1 + r.pots[0].shares.p2, pot);
  assert.ok(Math.abs(r.pots[0].shares.p1 - r.pots[0].shares.p2) <= 1, "平分（分不开的零头一枚）");
  assert.equal(g.carry, null);
  assert.equal(r.jackpot.playoff, true, "累积奖池不分：甲、乙加赛");
  assert.equal(g.stage, "playoff");
  assert.deepEqual(J(g.playoff.ids), ["p1", "p2"]);
  while (g.stage === "playoff") quietRound(g);
  assert.equal(g.over, true);
  assert.equal(g.jackpot, 0);
  assert.equal(g.order.reduce((t, id) => t + g.final.chips[id], 0), 150, "筹码守恒，没有留在桌上的");
});

test("滚存的底池没有下一轮了（只剩一个人没出局，对局提前结束）：归坐在桌上的那个人", () => {
  const g = X.newGame({ seed: "滚存", players: [{ id: "a", name: "甲", chips: 20 }, { id: "b", name: "乙" }], layers: LAYERS.slice(), weathers: PHASE_FIRST.slice(),
    hands: { a: ["acid", "fire", "ice"], b: ["acid", "ice", "physical"] }, elements: DRAWS.slice() });
  toBet1(g, { a: "acid", b: "acid" });
  settleStreet(g);
  assert.equal(g.results[0].carry, 37, "甲 20 枚全押、乙也押 20：同分滚存 40 − 盲注 3（#534：盲注在累积奖池里）");
  assert.equal(g.jackpot, 3, "累积奖池也留到下一轮");
  assert.deepEqual(J([g.sides.a.chips, g.sides.b.chips]), [0, 30]);
  // 第 2 轮：甲输光了不借，出局——只剩乙，对局结束，桌上滚存的 37 枚、累积奖池 3 枚都归乙
  assert.deepEqual(J(X.toAct(g)), ["a"]);
  A(g, "a", "noLoan");
  assert.equal(g.over, true);
  assert.equal(g.carry, null);
  assert.equal(g.jackpot, 0);
  assert.deepEqual(J(g.final.chips), { a: 0, b: 70 });
  assert.deepEqual(J(g.final.winners), ["b"]);
  assert.match(g.log.map(e => e.text).join("\n"), /桌上滚存的 37 枚没有下一轮了，归乙/);
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

/* ---------- 累积奖池、最后一轮同分加赛（#534，主人 10/31 确认） ---------- */

/** 10 张天气、没有相位：5 轮各翻 2 张，不用洗回（第 r 轮翻第 2r−1、2r 张） */
const W10 = ["heat", "snow", "acid", "thunder", "glow", "sand", "heat", "snow", "acid", "thunder"];
/** 打一整轮：cards = 每人盖哪张，都过牌 / 跟注到亮牌（quietRound 的那一套） */
const roundWith = (g, cards) => quietRound(g, cards);
/** 场上筹码的总数：手上的 + 这一轮押下去的（盲注那部分在累积奖池里，不重复算）+ 滚存的底池 + 累积奖池 */
const onTable = (g) => g.order.reduce((t, id) => t + g.sides[id].chips + g.sides[id].bet - g.sides[id].blind, 0) + (g.carry ? g.carry.amount : 0) + g.jackpot;

test("盲注进累积奖池、不进这一轮的底池：下注的算法不变——盲注照旧算已经下的注（大盲算第一次下注，跟注要跟到这个数）；累积奖池公开给所有人", () => {
  const g = game3();
  toBet1(g, { p1: "fire", p2: "physical", p3: "ice" });
  assert.deepEqual([g.sides.p2.bet, g.sides.p3.bet], [1, 2], "小盲、大盲照旧算这一轮已经下的注");
  assert.deepEqual([g.sides.p2.blind, g.sides.p3.blind, g.sides.p1.blind], [1, 2, 0]);
  assert.equal(g.jackpot, 3, "盲注 1 + 2 进累积奖池");
  assert.deepEqual(J(X.potsOf(g)), [], "这一轮的底池里还没有钱");
  for (const id of ["p1", "p2", "p3"]) {
    const v = X.view(g, id);
    assert.equal(v.jackpot, 3, id + " 看得到累积奖池");
    assert.equal(v.pot, 0, "盲注不算在底池里");
    assert.deepEqual(J(v.seats.map(s => s.blind)), [0, 1, 2], "每人交了多少盲注公开");
  }
  assert.match(g.log.find(e => e.t === "layer").text, /盲注 3 枚进累积奖池（现在 3 枚）/);
  // 跟注金额和以前一样：小盲补 1，大盲能过牌，庄家跟 2；加注至少等于大盲
  assert.deepEqual(J(X.legal(g, "p2").find(o => o.type === "call")), { type: "call", amount: 1 });
  assert.deepEqual(J(X.legal(g, "p2").find(o => o.type === "raise")), { type: "raise", min: 2, max: 48 });
  A(g, "p2", "call");
  assert.ok(X.legal(g, "p3").some(o => o.type === "check"), "大盲算第一次下注：轮到大盲可以过牌");
  A(g, "p3", "check");
  assert.deepEqual(J(X.legal(g, "p1").find(o => o.type === "call")), { type: "call", amount: 2 });
  A(g, "p1", "call");
  assert.deepEqual(J(g.order.map(id => g.sides[id].bet)), [2, 2, 2], "每人这一轮押的一样多（含盲注）");
  assert.equal(X.view(g, "p1").pot, 3, "底池只有不是盲注的那部分：甲跟的 2 + 乙补的 1");
  assert.equal(X.view(g, "p1").jackpot, 3);
  assert.deepEqual(J(X.potsOf(g)), [{ amount: 3, eligible: ["p1", "p2", "p3"] }]);
});

test("单独拿到最高分的人拿走底池 + 整个累积奖池——全押、开了边池也整个拿走（前几轮同分留下来的也算），不受边池上限限制", () => {
  const g = X.newGame({ seed: "奖池全押", players: [{ id: "p1", name: "甲" }, { id: "p2", name: "乙" }, { id: "p3", name: "丙", chips: 8 }],
    hands: { p1: ["physical", "ice", "fire"], p2: ["physical", "energy", "ice"], p3: ["fire", "electric", "ice"] },
    elements: ["harmonic", "harmonic", "harmonic"], layers: LAYERS.slice(), weathers: WEATHERS.slice() });
  // 第 1 轮：甲、乙物理 +1 同分（丙火 0）——底池平分，累积奖池 3 枚留到下一轮
  roundWith(g, { p1: "physical", p2: "physical", p3: "fire" });
  assert.deepEqual(J(g.results[0].jackpot), { amount: 3, added: 3, winner: null, tied: ["p1", "p2"], shares: {}, kept: true });
  assert.equal(g.jackpot, 3);
  assert.equal(g.sides.p3.chips, 6);
  // 第 2 轮：乙坐庄，丙小盲 2、甲大盲 4——累积奖池 3 + 6 = 9；丙把剩下的 4 枚全押（6 枚），甲加注、乙跟，开边池
  A(g, "p2", "place", { where: "top" });
  assert.equal(g.jackpot, 9);
  ["p1", "p2", "p3"].forEach(id => A(g, id, "play", { card: { p1: "ice", p2: "energy", p3: "electric" }[id] }));
  A(g, "p3", "raise", { amount: 2 });
  assert.equal(g.sides.p3.allIn, true);
  A(g, "p1", "raise", { amount: 10 });
  A(g, "p2", "call");
  settleStreet(g); settleStreet(g);
  const r = g.results[1];
  assert.deepEqual(J(r.bets), { p1: 16, p2: 16, p3: 6 });
  assert.deepEqual(J(r.blinds), { p1: 4, p2: 0, p3: 2 });
  // 护盾 + 沙尘、酸雨 + 雷鸣：电 +4（丙）、能量 +2（乙）、冰 −2（甲）
  assert.deepEqual(J(Object.keys(r.shown).map(id => [id, r.shown[id].score])), [["p1", -2], ["p2", 2], ["p3", 4]]);
  // 主池（押到 6 的那一层，扣掉盲注）：甲 2 + 乙 6 + 丙 4 = 12；边池：甲、乙各 10 = 20
  assert.deepEqual(J(r.pots.map(p => ({ amount: p.amount, eligible: p.eligible, winners: p.winners }))),
    [{ amount: 12, eligible: ["p1", "p2", "p3"], winners: ["p3"] }, { amount: 20, eligible: ["p1", "p2"], winners: ["p2"] }]);
  // 全押的丙单独最高分：累积奖池 9 枚整个归他（他自己只交过 2 + 2 枚盲注）
  assert.deepEqual(J(r.jackpot), { amount: 9, added: 6, winner: "p3", tied: [], shares: { p3: 9 } });
  assert.equal(g.jackpot, 0);
  assert.deepEqual(J(r.chips), { p1: 33, p2: 54, p3: 21 });
  assert.match(g.log.filter(e => e.t === "result")[1].text, /主池 12 枚归丙；边池 1 20 枚归乙；累积奖池 9 枚归丙/);
  assert.equal(onTable(g), 108, "筹码守恒");
});

/** 第 1 轮甲、丙冰 0 分同分（乙跟了注、第二轮弃牌）：底池平分，累积奖池 3 枚留到下一轮 */
function tieThenNext() {
  const g = game3();
  toBet1(g, { p1: "ice", p2: "fire", p3: "ice" });
  A(g, "p2", "call"); A(g, "p3", "check"); A(g, "p1", "call");
  X.toAct(g).forEach(id => A(g, id, "pass"));
  A(g, "p2", "fold"); A(g, "p3", "check"); A(g, "p1", "check");
  return g;
}

test("同分：累积奖池不分，留到下一轮接着累积；这一轮弃牌的人只是不参加这一轮，下一轮照样能把它赢走", () => {
  const g = tieThenNext();
  const r = g.results[0];
  assert.deepEqual(J(r.winners), ["p1", "p3"], "底池照旧平分");
  assert.deepEqual(J(r.folded), ["p2"]);
  assert.deepEqual(J(r.jackpot), { amount: 3, added: 3, winner: null, tied: ["p1", "p3"], shares: {}, kept: true });
  assert.equal(g.jackpot, 3, "累积奖池留在桌上");
  assert.match(g.log.find(e => e.t === "result").text, /累积奖池 3 枚：甲、丙同分，留到下一轮/);
  // 第 2 轮：乙坐庄，丙小盲 2、甲大盲 4——累积奖池 3 + 6 = 9（所有人都看得到）
  A(g, "p2", "place", { where: "top" });
  assert.equal(X.view(g, "p2").jackpot, 9);
  assert.equal(X.view(g, "p2").pot, 0);
  // 护盾 + 沙尘、酸雨 + 雷鸣：上一轮弃牌的乙能量 +2，单独最高分（甲谐波 0、丙酸 0）
  X.toAct(g).forEach(id => A(g, id, "play", { card: { p1: "harmonic", p2: "energy", p3: "acid" }[id] }));
  settleStreet(g); settleStreet(g);
  const r2 = g.results[1];
  assert.equal(r2.shown.p2.score, 2);
  assert.deepEqual(J(r2.jackpot), { amount: 9, added: 6, winner: "p2", tied: [], shares: { p2: 9 } });
  assert.equal(r2.delta.p2, -4 + 6 + 9, "乙押了 4：拿回底池 6（大家跟的，不含盲注）+ 累积奖池 9");
  assert.equal(g.jackpot, 0);
  assert.equal(onTable(g), 150);
});

test("其他人都弃牌、只剩一个人：这个人拿走底池和整个累积奖池（含之前同分留下来的）", () => {
  const g = tieThenNext();
  A(g, "p2", "place", { where: "top" });
  ["p1", "p2", "p3"].forEach(id => A(g, id, "play", { card: g.sides[id].hand[0] }));
  // 第 2 轮：丙（小盲 2）弃牌，甲（大盲 4）加注 4，乙弃牌——只剩甲
  A(g, "p3", "fold");
  A(g, "p1", "raise", { amount: 4 });
  A(g, "p2", "fold");
  const r = g.results[1];
  assert.equal(r.outcome, "fold");
  assert.equal(r.pot, 4, "底池只有甲加注的 4（丙的小盲、甲的大盲在累积奖池里）");
  assert.deepEqual(J(r.jackpot), { amount: 9, added: 6, winner: "p1", tied: [], shares: { p1: 9 } });
  assert.equal(r.delta.p1, -8 + 4 + 9);
  assert.equal(g.jackpot, 0);
  assert.match(g.log.filter(e => e.t === "result")[1].text, /第 2 轮：其他人都弃牌，甲拿走底池 4 枚和累积奖池 9 枚/);
  assert.equal(onTable(g), 150);
});

/** 打到第 5 轮结算（天气 W10，没有相位）：前 4 轮甲、丙轮流赢、同分过；第 5 轮的牌 last（沙尘 + 星灵、酸雨 + 雷鸣：电 +3、能量 +3、谐波 +1）。
 *  每人整局正好过手 7 种元素各 1 张；playoff：加赛重洗后的顺序 */
function toPlayoff(last, playoff) {
  const g = game3({ weathers: W10.slice(), playoff });
  [{ p1: "physical", p2: "physical", p3: "fire" },     // 物理 +1、物理 +1、火 0：甲乙同分，累积奖池留着
    { p1: "harmonic", p2: "fire", p3: "acid" },         // 谐波 0、火 −2、酸 0：甲丙同分，接着留
    { p1: "ice", p2: "ice", p3: "energy" },             // 冰 +1、冰 +1、能量 +3：丙拿走累积奖池 3 + 6 + 9 = 18
    { p1: "fire", p2: "harmonic", p3: "physical" }      // 火 −1、谐波 −2、物理 0：丙拿走 12
  ].forEach(cards => roundWith(g, cards));
  assert.equal(g.round, 5);
  assert.deepEqual(J(g.results.map(r => r.jackpot.winner)), [null, null, "p3", "p3"]);
  roundWith(g, last);
  return g;
}

test("最后一轮同分 → 加赛：底池先照常平分，累积奖池只有同分的人加赛；不下注，每人从剩下的手牌里再盖 1 张；公共层牌、天气全部重洗各翻 2 张；翻到相位当作没有修正的天气、不全押；单独最高分拿走", () => {
  const g = toPlayoff({ p1: "electric", p2: "energy", p3: "harmonic" },
    [{ layers: ["flesh", "flesh", "armor", "armor", "shield", "shield", "sand", "sand", "spirit", "spirit"], weathers: ["heat", "phase", "snow", "acid", "thunder", "glow", "sand"] }]);
  const r5 = g.results[4];
  assert.deepEqual(J(Object.keys(r5.shown).map(id => r5.shown[id].score)), [3, 3, 1], "甲电 +3、乙能量 +3 同分");
  assert.deepEqual(J(r5.winners), ["p1", "p2"], "底池照常平分");
  assert.equal(r5.pots[0].shares.p1 + r5.pots[0].shares.p2, r5.pot);
  assert.deepEqual(J(r5.jackpot), { amount: 15, added: 15, winner: null, tied: ["p1", "p2"], shares: {}, playoff: true }, "累积奖池（第 5 轮的盲注 5 + 10）不分：加赛");
  assert.match(g.log.filter(e => e.t === "result")[4].text, /累积奖池 15 枚：甲、乙同分，最后一轮，加赛/);
  // 加赛：只有同分的甲、乙，同时盖牌，不下注
  assert.equal(g.over, false);
  assert.equal(g.stage, "playoff");
  assert.deepEqual(J(X.toAct(g)), ["p1", "p2"]);
  assert.deepEqual(J(X.legal(g, "p3")), [], "丙不参加加赛");
  assert.deepEqual(J(X.legal(g, "p1")), [{ type: "play", card: "acid" }, { type: "play", card: "energy" }], "甲从剩下的手牌里盖；没有下注");
  assert.deepEqual(J(X.legal(g, "p2")), [{ type: "play", card: "electric" }, { type: "play", card: "acid" }]);
  assert.throws(() => A(g, "p1", "check"), /不能这样做/);
  assert.equal(g.layerDeck.length, 0, "10 张公共层牌这 5 轮正好用完");
  const v3 = X.view(g, "p3");
  assert.deepEqual(J(v3.playoff), { n: 1, ids: ["p1", "p2"], played: [] });
  assert.deepEqual([v3.jackpot, v3.layerDeckCount, v3.deckCount, J(v3.discards), J(v3.layers), J(v3.weathers)], [15, 10, 7, [], [], []], "公共层牌 10 张、天气 7 张全部重洗");
  ["playoffDecks", "layerDeck", "deck"].forEach(k => assert.ok(!(k in v3), k));
  assert.ok(!("layerDeck" in v3.playoff) && !("deck" in v3.playoff), "重洗后的顺序不在 view 里");
  assert.match(g.log.find(e => e.t === "playoff" && e.op === "open").text, /第 1 次加赛：甲、乙同分，争累积奖池 15 枚——只有同分的人参加，不下注；各从剩下的手牌里再盖 1 张，公共层牌 10 张全部重洗、翻 2 张，天气 7 张全部重洗、翻 2 张/);
  // 甲先盖：别人只看得到「盖了」，看不到是哪张
  A(g, "p1", "play", { card: "acid" });
  assert.deepEqual(J(X.toAct(g)), ["p2"]);
  for (const id of ["p2", "p3"]) {
    const v = X.view(g, id), s1 = v.seats.find(s => s.id === "p1");
    assert.deepEqual(J(v.playoff.played), ["p1"]);
    assert.equal(s1.played, true);
    assert.ok(!("card" in s1));
    assert.equal(v.log.filter(e => e.t === "play").pop().text, "甲加赛盖下了一张元素牌。", "公开的记录只写盖了");
    assert.ok(!v.log.some(e => e.t === "myCard" && e.by === "p1"), "甲盖了哪张的那条只给甲");
  }
  assert.equal(X.view(g, "p1").me.card, "acid");
  assert.equal(g.log[g.log.length - 1].text, "你加赛盖下了〔酸〕。");
  A(g, "p2", "play", { card: "electric" });
  // 重洗后翻开肉体 + 肉体、酷暑 + 相位：相位不改得分，也不全押
  const p = g.results[5];
  assert.equal(p.outcome, "playoff");
  assert.equal(p.n, 1);
  assert.deepEqual(J(p.ids), ["p1", "p2"]);
  assert.deepEqual([J(p.layers), J(p.weathers)], [["flesh", "flesh"], ["heat", "phase"]]);
  assert.equal(X.handScore("acid", ["flesh", "flesh"], ["heat", "phase"]), X.handScore("acid", ["flesh", "flesh"], ["heat"]), "相位当作没有修正的天气");
  assert.deepEqual(J(p.shown), { p1: { card: "acid", score: 2 }, p2: { card: "electric", score: 0 } });
  assert.equal(p.allIn, false);
  assert.ok(!g.log.some(e => e.t === "allIn"), "加赛翻到相位不全押");
  assert.deepEqual(J(p.bets), { p1: 0, p2: 0, p3: 0 }, "加赛不下注");
  assert.deepEqual(J(p.jackpot), { amount: 15, added: 0, winner: "p1", tied: [], shares: { p1: 15 } });
  assert.deepEqual(J(p.delta), { p1: 15, p2: 0, p3: 0 });
  assert.deepEqual(J(p.played), { p1: "acid", p2: "electric" });
  assert.match(g.log.find(e => e.t === "playoff" && e.op === "reveal").text, /第 1 次加赛：翻开公共层牌〔肉体〕〔肉体〕和天气〔酷暑〕〔相位〕（加赛翻到相位：当作没有修正的天气，不全押）/);
  assert.match(g.log.filter(e => e.t === "result")[5].text, /第 5 轮第 1 次加赛：甲〔酸〕\+2，乙〔电〕0（公共层牌〔肉体〕〔肉体〕，天气 酷暑 \+ 相位；相位当作没有修正的天气，不全押）。累积奖池 15 枚归甲（筹码变动：甲 \+15）/);
  // 分出胜负：对局结束
  assert.equal(g.over, true);
  assert.equal(g.jackpot, 0);
  assert.deepEqual([g.final.rounds, g.final.playoffs], [5, 1], "加赛不算一轮");
  assert.deepEqual(J(X.splitStats(g)).rounds, 5);
  assert.equal(g.order.reduce((t, id) => t + g.final.held[id], 0), 150, "筹码守恒");
  assert.deepEqual(J(g.sides.p1.history.slice(-2)), [{ r: 5, card: "electric" }, { r: 5, card: "acid", playoff: 1 }]);
});

test("加赛还同分：只有还同分的人接着加赛（第 2 次照种子重洗）；还同分的人里有人手牌用光了就不再加赛，累积奖池由还同分的人平分（零头从庄家左边起一人一枚）", () => {
  // 第 5 轮：甲能量 +3、乙能量 +3、丙电 +3，三人同分（剩下的：甲、乙电和酸，丙冰和谐波）
  const g = toPlayoff({ p1: "energy", p2: "energy", p3: "electric" }, [{ layers: ["flesh", "flesh"], weathers: ["heat", "phase"] }]);
  assert.deepEqual(J(g.results[4].jackpot.tied), ["p1", "p2", "p3"]);
  assert.deepEqual(J(X.toAct(g)), ["p1", "p2", "p3"]);
  // 第 1 次加赛（肉体 + 肉体、酷暑 + 相位）：甲酸 +2、乙酸 +2、丙冰 −2——甲、乙还同分，丙出局
  ["p1", "p2", "p3"].forEach(id => A(g, id, "play", { card: { p1: "acid", p2: "acid", p3: "ice" }[id] }));
  const p1 = g.results[5];
  assert.deepEqual(J(Object.keys(p1.shown).map(id => p1.shown[id].score)), [2, 2, -2]);
  assert.deepEqual(J(p1.jackpot), { amount: 15, added: 0, winner: null, tied: ["p1", "p2"], shares: {}, playoff: true });
  assert.deepEqual(J(p1.winners), []);
  assert.match(g.log.filter(e => e.t === "result")[5].text, /累积奖池 15 枚：甲、乙还同分，接着加赛/);
  assert.equal(g.stage, "playoff");
  assert.deepEqual(J(X.view(g, "p3").playoff), { n: 2, ids: ["p1", "p2"], played: [] }, "第 2 次加赛只有还同分的甲、乙");
  assert.deepEqual(J(X.legal(g, "p3")), []);
  assert.deepEqual([X.view(g, "p1").layerDeckCount, X.view(g, "p1").deckCount], [10, 7], "又全部重洗");
  // 第 2 次加赛：两人都只剩电，又同分——手牌用光了：不再加赛，平分 15 枚（乙坐庄：从丙起，第一个是甲，甲多拿 1 枚）
  A(g, "p1", "play", { card: "electric" }); A(g, "p2", "play", { card: "electric" });
  const p2 = g.results[6];
  assert.equal(p2.n, 2);
  p2.layers.forEach(ly => assert.ok(C.layers.indexOf(ly) >= 0));
  assert.equal(p2.layers.length, 2);
  assert.equal(new Set(p2.weathers).size, 2, "重洗后翻的 2 张天气不一样");
  assert.equal(g.dealer, "p2");
  assert.deepEqual(J(p2.jackpot), { amount: 15, added: 0, winner: null, tied: ["p1", "p2"], shares: { p1: 8, p2: 7 }, split: true, empty: ["p1", "p2"] });
  assert.deepEqual(J(p2.winners), ["p1", "p2"]);
  assert.equal(p2.split, true);
  assert.match(g.log.filter(e => e.t === "result")[6].text, /累积奖池 15 枚：甲、乙还同分，甲、乙的手牌用光了，不再加赛，由甲、乙平分/);
  assert.equal(g.over, true);
  assert.deepEqual([g.final.rounds, g.final.playoffs], [5, 2]);
  assert.equal(g.jackpot, 0);
  assert.equal(g.order.reduce((t, id) => t + g.final.held[id], 0), 150, "筹码守恒");
});

test("对局提前结束（只剩一个人没出局）时桌上还有累积奖池：归坐在桌上的那个人（之前同分的人出局了也不分）", () => {
  // 相位全押：甲、乙酸 +3 同分（丙火 +2）——底池滚存、累积奖池留着；乙、丙都押光了
  const g = game3({ players: [{ id: "p1", name: "甲" }, { id: "p2", name: "乙", chips: 20 }, { id: "p3", name: "丙", chips: 20 }],
    hands: { p1: ["acid", "ice", "physical"], p2: ["acid", "fire", "ice"], p3: ["fire", "ice", "physical"] }, weathers: PHASE_FIRST.slice() });
  toBet1(g, { p1: "acid", p2: "acid", p3: "fire" });
  settleStreet(g);
  const r = g.results[0];
  assert.deepEqual(J(r.jackpot), { amount: 3, added: 3, winner: null, tied: ["p1", "p2"], shares: {}, kept: true });
  assert.equal(r.carry, 57);
  assert.deepEqual([g.sides.p1.chips, g.sides.p2.chips, g.sides.p3.chips], [30, 0, 0]);
  // 第 2 轮：乙、丙输光了都不借，出局——只剩甲，对局结束
  A(g, "p2", "noLoan"); A(g, "p3", "noLoan");
  assert.equal(g.over, true);
  assert.equal(g.jackpot, 0);
  assert.equal(X.view(g, "p1").jackpot, 0);
  assert.deepEqual(J(g.final.chips), { p1: 90, p2: 0, p3: 0 }, "滚存的 57 + 累积奖池 3 都归甲");
  const text = g.log.map(e => e.text).join("\n");
  assert.match(text, /桌上滚存的 57 枚没有下一轮了，归甲/);
  assert.match(text, /桌上的累积奖池 3 枚没有下一轮了，归甲/);
});

test("筹码守恒（#534）：2–4 人随机合法操作打很多局——每一步 手上 + 这一轮押的（盲注不重复算）+ 滚存的 + 累积奖池 = 开局 + 借的；打完累积奖池、滚存都清空", () => {
  let playoffs = 0, kept = 0, splits = 0;
  for (const n of [2, 3, 4]) for (let k = 0; k < 20; k++) {
    const g = X.newGame({ seed: `守恒${n}-${k}`, players: Array.from({ length: n }, (_, i) => ({ id: "p" + (i + 1), chips: 10 + 15 * i })) });
    const total0 = g.order.reduce((t, id) => t + g.sides[id].chips, 0), rng = CC.makeRng("守恒" + n + k);
    const loans = () => g.order.reduce((t, id) => t + g.sides[id].loan, 0);
    for (let step = 0; !g.over; step++) {
      assert.ok(step < 2000, "卡住了：" + g.stage);
      if (g.betting && g.betting.window && rng() < 0.3) { X.closeWindow(g); continue; }
      const who = X.toAct(g), id = who[Math.floor(rng() * who.length)], L = X.legal(g, id);
      const o = L[Math.floor(rng() * L.length)], a = { type: o.type };
      if (o.card) a.card = o.card;
      if (o.where) a.where = o.where;
      if (o.min != null) a.amount = o.min + Math.floor(rng() * (o.max - o.min + 1) / (o.step || 1)) * (o.step || 1);
      X.act(g, id, a);
      if (!g.over) assert.equal(onTable(g), total0 + loans(), `${n} 人第 ${k} 局第 ${step} 步（${g.stage}）`);
    }
    assert.equal(g.jackpot, 0);
    assert.equal(g.carry, null);
    assert.equal(g.order.reduce((t, id) => t + g.final.held[id], 0), total0 + loans(), `${n} 人第 ${k} 局打完`);
    g.results.forEach(r => {
      const j = r.jackpot;
      if (r.outcome === "playoff") playoffs++;
      if (j.kept) kept++;
      if (j.split) splits++;
      assert.equal(Object.values(j.shares).reduce((a, b) => a + b, 0), j.winner || j.split ? j.amount : 0, "累积奖池整个分掉或者整个留着");
    });
  }
  assert.ok(playoffs > 0 && kept > 0, `加赛 ${playoffs} 次，同分留到下一轮 ${kept} 轮，加赛平分 ${splits} 次`);
});
