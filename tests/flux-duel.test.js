// Flux Duel（#488）· 规则引擎 flux-duel.js：两人对决（完全博弈）——每人 5 层 + 7 元素、不设庄家、每轮一张背面朝上的天气（第一轮下注后才翻开）、
// 底注 1 × 轮数、先手每轮轮换、各自用元素打对方的层（CounterCards.score）、三档分档赔付（Duel 自己的配置）、相位全押（打平滚池、最后一轮平分）、
// 亮不亮牌的开关（默认不亮）；下注 / 借贷 / 追加窗口直接用 counter-cards.js 里同一份代码（CounterCards.bet）
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
for (const f of ["counter-cards.js", "flux-duel.js"]) vm.runInContext(read(f), c, { filename: f });
const CC = c.CounterCards;
const D = c.FluxDuel;
const C = CC.CC_CONFIG;
const J = v => JSON.parse(JSON.stringify(v));
const A = (g, side, type, extra) => D.act(g, side, Object.assign({ type }, extra || {}));
const DECK = ["heat", "snow", "acid", "thunder", "glow", "sand", "phase"];

/** 双方暗出：a / b = [层牌, 元素牌] */
function play(g, a, b) {
  A(g, "a", "play", { layer: a[0], element: a[1] });
  A(g, "b", "play", { layer: b[0], element: b[1] });
}
/** 这一个下注回合双方都过牌（先手先） */
function checks(g) { const f = g.betting.toAct; A(g, f, "check"); A(g, D.other(f), "check"); }
/** 跟注后开了追加窗口：双方都放弃追加 */
function passWindow(g) { if (g.betting && g.betting.window) D.toAct(g).forEach(side => A(g, side, "pass")); }
/** 打完一整轮：问借贷都不借、暗出 a / b、能过牌就过牌（不然跟注）、追加窗口都放弃 */
function quietRound(g, a, b) {
  const n = g.results.length;
  for (let guard = 0; g.results.length === n && !g.over; guard++) {
    assert.ok(guard < 40, "这一轮打不完：" + g.stage);
    const side = D.toAct(g)[0];
    switch (g.stage) {
      case "loan": A(g, side, "noLoan"); break;
      case "play": play(g, a, b); break;
      case "bet1": case "bet2": {
        const L = D.legal(g, side);
        A(g, side, L.some(x => x.type === "check") ? "check" : L.some(x => x.type === "pass") ? "pass" : "call");
        break;
      }
      default: assert.fail("没想到的阶段：" + g.stage);
    }
  }
}
/** 第 1 轮：甲第一轮下注 4 枚、乙跟注（追加窗口都放弃），翻天气，第二轮都过牌，结算 */
function betFourRound(g, a, b) {
  play(g, a, b);
  A(g, "a", "bet", { amount: 4 }); A(g, "b", "call"); passWindow(g);
  checks(g);
}

/* ---------- 配置 ---------- */

test("配置：名字 Flux Duel 放在配置里（挂在 CC_CONFIG.duel，和 High Flux 的 CC_CONFIG.name 一个写法）；默认不亮牌；分档赔付三档在 Duel 自己的配置里；底注 1 × 轮数", () => {
  assert.equal(C.duel, D.DUEL_CONFIG);
  assert.equal(C.duel.name, "Flux Duel");
  assert.equal(D.name(), "Flux Duel");
  assert.equal(C.duel.reveal, false, "主人 10/30：结算是否亮牌做成开关，默认不亮");
  assert.deepEqual(J(C.duel.tierExtra), [0, 0, 0.5, 1], "差 1 / 差 2 / 差 3 及以上");
  assert.deepEqual(J(C.tierExtra), [0, 0, 0.5], "High Flux 自己还是两档（#486），没被 Duel 改动");
  assert.deepEqual(J(C.duel.ante), [1, 2, 3, 4, 5]);
  assert.equal(C.duel.rounds, 5);
  assert.deepEqual([1, 2, 3, 4, 5].map(D.anteOf), [1, 2, 3, 4, 5]);
});

test("High Flux 的结算函数加了可选的分档表：Duel 的三档按差 3 封顶，High Flux 不传还是两档（差 3 按差 2）", () => {
  const T = C.duel.tierExtra;
  assert.equal(CC.tierOf(3), 2);
  assert.equal(CC.tierOf(4), 2);
  assert.equal(CC.tierOf(3, T), 3);
  assert.equal(CC.tierOf(4, T), 3, "分差最大 ±4，按差 3 算");
  assert.equal(CC.extraOf(3, 5), 2, "High Flux：差 3 按差 2，赔 0.5 倍");
  assert.equal(CC.extraOf(3, 5, T), 5, "Duel：差 3 赔 1 倍");
  const s = { dealer: { bet: 6, pot: 0, chips: 20, infinite: false }, player: { bet: 6, pot: 0, chips: 20, infinite: false } };
  assert.equal(CC.settle(-4, s).extra, 3);
  assert.equal(CC.settle(-4, s, { tierExtra: T }).extra, 6);
  assert.equal(CC.settle(-4, s, { tierExtra: T }).tier, 3);
});

/* ---------- 开局、每轮流程 ---------- */

test("开局：不设庄家，每人 5 张层牌 + 7 张元素牌，没有常态；双方各下 1 枚底注后同时暗出（两边都在等）；天气堆背面朝上谁都看不到", () => {
  const g = D.newGame({ seed: "s1" });
  assert.equal(g.mode, "duel");
  for (const k of ["a", "b"]) {
    assert.deepEqual(J(g.sides[k].layers), J(C.layers));
    assert.deepEqual(J(g.sides[k].elements), J(C.elements));
    assert.ok(g.sides[k].elements.indexOf(C.normal) < 0, "没有常态");
    assert.equal(g.sides[k].chips, 49, "50 枚下了 1 枚底注");
    assert.equal(g.sides[k].bet, 1);
  }
  assert.equal(g.stage, "play");
  assert.deepEqual(J(D.toAct(g)), ["a", "b"]);
  assert.ok(g.hidden, "这一轮的天气已经背面朝上放好");
  assert.equal(g.deck.length, 6);
  assert.deepEqual(J(g.deck.concat([g.hidden]).sort()), J(C.weathers.slice().sort()));
  const v = D.view(g, "a");
  assert.equal(v.weather, null);
  assert.equal(v.facedown, true);
  assert.equal(v.deckCount, 6);
  assert.equal(v.deck, undefined, "天气堆的顺序不在 view 里");
  assert.ok(!("hidden" in v) && !JSON.stringify(v).includes('"hidden"'), "背面朝上的天气不在 view 里");
  assert.ok(!("peek" in v) && !("deckTop" in v), "没人能偷看天气");
  assert.deepEqual(J(v.unseen.slice().sort()), J(C.weathers.slice().sort()));
  // 同一个种子洗出来一样，换种子不一样
  const again = D.newGame({ seed: "s1" });
  assert.deepEqual(J([again.hidden].concat(again.deck)), J([g.hidden].concat(g.deck)));
  const others = ["s2", "s3", "s4"].map(s => { const x = D.newGame({ seed: s }); return [x.hidden].concat(x.deck).join(); });
  assert.ok(others.some(x => x !== [g.hidden].concat(g.deck).join()));
});

test("每轮：暗出 → 第一轮下注（这一轮的先手先）→ 翻开这一轮的天气（第一轮下注前看不到）→ 第二轮下注（同一个先手先）→ 结算；先手每轮轮换，底注 1 × 轮数", () => {
  const g = D.newGame({ seed: "flow", deck: DECK });
  assert.equal(g.lead, "a");
  play(g, ["flesh", "physical"], ["flesh", "physical"]);
  assert.equal(g.stage, "bet1");
  assert.deepEqual(J(D.toAct(g)), ["a"], "第 1 轮甲先手");
  assert.equal(g.weather, null, "第一轮下注时天气还背面朝上");
  assert.equal(D.view(g, "b").weather, null);
  A(g, "a", "check");
  assert.equal(g.weather, null);
  A(g, "b", "check");
  assert.equal(g.weather, "heat", "第一轮下注后翻开");
  assert.equal(g.deck.length, 6);
  assert.equal(g.stage, "bet2");
  assert.deepEqual(J(D.toAct(g)), ["a"], "第二轮下注也是这一轮的先手先");
  checks(g);
  assert.equal(g.results.length, 1);
  assert.equal(g.results[0].outcome, "tie");
  // 第 2 轮：乙先手，底注 2 枚；上一轮的天气离场
  assert.equal(g.round, 2);
  assert.equal(g.lead, "b");
  assert.equal(g.sides.a.bet, 2);
  assert.equal(g.sides.b.bet, 2);
  assert.equal(g.weather, null);
  assert.deepEqual(J(g.gone), ["heat"]);
  play(g, ["armor", "acid"], ["armor", "acid"]);
  assert.deepEqual(J(D.toAct(g)), ["b"], "第 2 轮乙先手");
  A(g, "b", "check"); A(g, "a", "check");
  assert.equal(g.weather, "snow");
  assert.deepEqual(J(D.toAct(g)), ["b"]);
  // 开局可以让乙在第 1 轮先手
  const h = D.newGame({ seed: "flow", first: "b" });
  play(h, ["flesh", "fire"], ["flesh", "fire"]);
  assert.deepEqual(J(D.toAct(h)), ["b"]);
});

test("层牌每轮必出一张、元素牌每张整局只能用一次：用过的元素牌不能再出；5 轮打完每人剩 0 张层牌、2 张元素牌", () => {
  const g = D.newGame({ seed: "once", deck: DECK });
  quietRound(g, ["flesh", "fire"], ["flesh", "fire"]);
  const L = D.legal(g, "a");
  assert.ok(L.length && L.every(o => o.type === "play"));
  assert.ok(!L.some(o => o.element === "fire"), "火用过了");
  assert.ok(!L.some(o => o.layer === "flesh"), "血肉用过了");
  assert.equal(L.length, 4 * 6, "4 张层牌 × 6 张元素牌");
  assert.throws(() => A(g, "a", "play", { layer: "armor", element: "fire" }), /不能这样做/);
  assert.throws(() => A(g, "a", "play", { layer: "flesh", element: "acid" }), /不能这样做/);
  assert.throws(() => A(g, "a", "play", { layer: "armor" }), /不能这样做/, "层牌、元素牌都要出");
  quietRound(g, ["armor", "acid"], ["armor", "acid"]);
  quietRound(g, ["shield", "electric"], ["shield", "electric"]);
  quietRound(g, ["sand", "ice"], ["sand", "ice"]);
  quietRound(g, ["spirit", "energy"], ["spirit", "energy"]);
  assert.equal(g.over, true);
  for (const k of ["a", "b"]) {
    assert.deepEqual(J(g.sides[k].layers), []);
    assert.deepEqual(J(g.sides[k].elements), ["physical", "harmonic"]);
  }
});

/* ---------- 计分、分档赔付 ---------- */

test("结算：各自用自己的元素牌打对方的层牌（CounterCards.score，这一轮的天气），分高的赢；分差定分档：差 1 拿底池、差 2 输家再赔 0.5 倍、差 3 再赔 1 倍、差 4 按差 3", () => {
  // 第 1 轮天气酷暑；甲出〔血肉〕〔火〕（第 4 个例子出〔灵体〕〔火〕），甲第一轮下注 4 枚、乙跟注，双方这一轮都押了 5 枚
  const cases = [
    { a: ["flesh", "fire"], b: ["sand", "physical"], sa: 1, sb: 0, tier: 1, extra: 0 },     // 火打沙 0 + 酷暑火 +1；物理打血肉 0
    { a: ["flesh", "fire"], b: ["flesh", "physical"], sa: 2, sb: 0, tier: 2, extra: 2 },    // 火打血肉 克制 +1 + 酷暑 +1；5 × 0.5 向下取整
    { a: ["flesh", "fire"], b: ["flesh", "ice"], sa: 2, sb: -1, tier: 3, extra: 5 },        // 冰打血肉 0 + 酷暑冰 −1
    { a: ["spirit", "fire"], b: ["flesh", "ice"], sa: 2, sb: -2, tier: 3, extra: 5 }        // 冰打灵体 被克制 −1 + 酷暑 −1：分差 4 按差 3
  ];
  for (const x of cases) {
    const g = D.newGame({ seed: "tier", deck: DECK });
    assert.equal(CC.score(x.a[1], x.b[0], "heat"), x.sa);
    assert.equal(CC.score(x.b[1], x.a[0], "heat"), x.sb);
    assert.equal(D.scoreOf(Object.assign(J(g), { weather: "heat", sides: { a: { element: x.a[1], layer: x.a[0] }, b: { element: x.b[1], layer: x.b[0] } } }), "a"), x.sa);
    betFourRound(g, x.a, x.b);
    const r = g.results[0];
    assert.equal(r.weather, "heat");
    assert.equal(r.winner, "a");
    assert.equal(r.tier, x.tier, JSON.stringify(x));
    assert.equal(r.extra, x.extra);
    assert.equal(r.pot, 10);
    assert.deepEqual(J(r.delta), { a: 5 + x.extra, b: -(5 + x.extra) });
    assert.deepEqual(J(r.chips), { a: 55 + x.extra, b: 45 - x.extra });
    assert.match(g.log.find(e => e.t === "result").text, new RegExp(`甲赢（差 ${x.tier}）`));
  }
  // 反过来：乙的分高就是乙赢
  const g = D.newGame({ seed: "tier", deck: DECK });
  betFourRound(g, ["flesh", "ice"], ["flesh", "fire"]);
  assert.equal(g.results[0].winner, "b");
  assert.equal(g.results[0].tier, 3);
});

test("平局：底池滚存到下一轮（双方各自那一份记着）；第 5 轮打平各自拿回自己下的筹码", () => {
  const g = D.newGame({ seed: "tie", deck: ["heat", "snow", "acid", "thunder", "glow"] });
  quietRound(g, ["flesh", "fire"], ["flesh", "fire"]);              // 对出同样的牌：一定打平
  const r1 = g.results[0];
  assert.equal(r1.outcome, "tie");
  assert.equal(r1.rollover, true);
  assert.equal(r1.pot, 2);
  assert.equal(g.sides.a.pot, 1);
  assert.equal(g.sides.b.pot, 1);
  quietRound(g, ["armor", "acid"], ["armor", "acid"]);
  quietRound(g, ["shield", "electric"], ["shield", "electric"]);
  quietRound(g, ["sand", "ice"], ["sand", "ice"]);
  assert.equal(g.sides.a.pot, 10, "1 + 2 + 3 + 4");
  quietRound(g, ["spirit", "energy"], ["spirit", "energy"]);
  const r5 = g.results[4];
  assert.equal(r5.outcome, "tie");
  assert.equal(r5.refund, true);
  assert.ok(!r5.rollover);
  assert.equal(g.over, true);
  assert.deepEqual(J(g.final.chips), { a: 50, b: 50 });
  assert.equal(g.final.winner, null);
});

test("弃牌：立即判负，对方拿走整个底池（含滚存的）；第一轮下注时弃牌，这一轮的天气没翻开、盖着弃掉，下一轮放新的一张", () => {
  const g = D.newGame({ seed: "fold", deck: DECK });
  quietRound(g, ["flesh", "fire"], ["flesh", "fire"]);              // 打平，滚存 2 枚
  play(g, ["armor", "acid"], ["armor", "acid"]);
  assert.deepEqual(J(D.toAct(g)), ["b"]);
  A(g, "b", "bet", { amount: 3 });
  A(g, "a", "fold");
  const r = g.results[1];
  assert.equal(r.outcome, "fold");
  assert.equal(r.folded, "a");
  assert.equal(r.winner, "b");
  assert.equal(r.pot, 1 + 1 + 2 + 5);
  assert.deepEqual(J(r.chips), { a: 47, b: 49 - 2 - 3 + 9 });
  assert.deepEqual(J(r.delta), { a: -2, b: 4 }, "这一轮开始时手上各 49 枚（滚存的各 1 枚已经在底池里了，同 High Flux）");
  assert.equal(g.sides.a.pot, 0);
  assert.equal(g.sides.b.pot, 0);
  assert.equal(r.buried, true);
  assert.match(g.log.find(e => e.t === "result" && e.r === 2).text, /乙拿走底池 9 枚.*这一轮的天气没翻开，盖着弃掉/);
  // 第 3 轮：雪天盖着弃掉了（没公开），这一轮放的是酸雨
  assert.equal(g.round, 3);
  assert.deepEqual(J(g.gone), ["heat"]);
  assert.equal(g.buried, 1);
  assert.equal(g.hidden, "acid");
  const v = D.view(g, "a");
  assert.equal(v.buried, 1);
  assert.deepEqual(J(v.unseen.slice().sort()), J(C.weathers.filter(w => w !== "heat").sort()), "盖着弃掉的那张谁都不知道，还算没公开过");
});

/* ---------- 相位 ---------- */

test("相位：第一轮下注后翻到相位，双方全押（上限 = 筹码较少一方的全部筹码），不再下注，直接比分（相位本身不改得分）", () => {
  const g = D.newGame({ seed: "ph", deck: ["phase", "heat"], chipsBy: { a: 50, b: 30 } });
  play(g, ["flesh", "fire"], ["flesh", "physical"]);
  checks(g);
  assert.ok(!g.log.some(e => e.t === "bet" && e.street === 2), "相位轮不下第二轮注");
  const r = g.results[0];
  assert.equal(r.allIn, true);
  assert.equal(r.weather, "phase");
  assert.deepEqual(J(r.bets), { a: 30, b: 30 }, "按乙的 30 枚封顶");
  assert.equal(r.winner, "a");
  assert.equal(r.tier, 1, "火打血肉 克制 +1，相位不加不减");
  assert.equal(r.pot, 60);
  assert.equal(g.sides.a.chips, 80);
  assert.equal(g.sides.b.chips, 0);
  assert.match(g.log.find(e => e.t === "allIn").text, /双方全押，各押 30 枚/);
  // 乙输光了：第 2 轮开始先问乙借不借，不借这一局就结束
  assert.equal(g.stage, "loan");
  assert.deepEqual(J(D.toAct(g)), ["b"]);
  A(g, "b", "noLoan");
  assert.equal(g.over, true);
  assert.equal(g.final.winner, "a");
});

test("相位全押打平：底池保留滚到下一轮（不像 High Flux 那样各自退回）；最后一轮打平双方平分底池", () => {
  const g = D.newGame({ seed: "ph2", deck: ["phase", "heat"], chipsBy: { a: 50, b: 30 } });
  play(g, ["flesh", "physical"], ["flesh", "physical"]);
  checks(g);
  const r = g.results[0];
  assert.equal(r.allIn, true);
  assert.equal(r.outcome, "tie");
  assert.equal(r.rollover, true);
  assert.ok(!r.refund);
  assert.equal(r.pot, 60);
  assert.equal(g.sides.a.pot, 30);
  assert.equal(g.sides.b.pot, 30);
  assert.equal(g.sides.a.chips, 20);
  assert.equal(g.sides.b.chips, 0);
  assert.match(g.log.find(e => e.t === "result").text, /平局（相位全押），底池 60 枚滚存到下一轮/);

  const h = D.newGame({ seed: "ph3", deck: ["heat", "snow", "acid", "thunder", "phase"] });
  quietRound(h, ["flesh", "fire"], ["flesh", "fire"]);
  quietRound(h, ["armor", "acid"], ["armor", "acid"]);
  quietRound(h, ["shield", "electric"], ["shield", "electric"]);
  quietRound(h, ["sand", "ice"], ["sand", "ice"]);
  play(h, ["spirit", "energy"], ["spirit", "energy"]);
  checks(h);
  const last = h.results[4];
  assert.equal(last.allIn, true);
  assert.equal(last.outcome, "tie");
  assert.equal(last.split, true);
  assert.equal(last.pot, 100, "滚存的 20 + 双方各全押 40");
  assert.deepEqual(J(last.bets), { a: 40, b: 40 });
  assert.equal(h.over, true);
  assert.deepEqual(J(h.final.chips), { a: 50, b: 50 });
  assert.match(h.log.find(e => e.t === "result" && e.r === 5).text, /相位全押打平，最后一轮双方平分底池 100 枚/);
});

/* ---------- 下注、借贷、追加窗口：直接用 High Flux 的同一份代码 ---------- */

test("下注用 High Flux 的同一份代码：下注不封顶（最大 = 自己手上的）、跟不起要先借、跟注后开追加窗口（都放弃 / 到时间关窗）、每回合最多加注 2 次", () => {
  assert.equal(typeof CC.bet.registerMode, "function");
  const g = D.newGame({ seed: "bet", deck: DECK, chipsBy: { a: 50, b: 20 } });
  play(g, ["flesh", "physical"], ["flesh", "physical"]);
  const bet = D.legal(g, "a").find(o => o.type === "bet");
  assert.deepEqual(J(bet), { type: "bet", min: 1, max: 49 }, "最大 = 自己手上的 49 枚，不按乙的 19 枚封顶");
  A(g, "a", "bet", { amount: 30 });
  const L = D.legal(g, "b");
  assert.ok(!L.some(o => o.type === "call"), "乙手上 19 枚跟不起 30 枚");
  assert.ok(!L.some(o => o.type === "raise"));
  assert.deepEqual(J(L.find(o => o.type === "borrow")), { type: "borrow", min: 3, max: 12, step: 3, need: 31 }, "缺口 31 − 19 = 12");
  A(g, "b", "borrow", { amount: 12 });
  assert.equal(g.sides.b.chips, 31);
  assert.equal(g.sides.b.owe, 16);
  assert.deepEqual(J(D.toAct(g)), ["b"], "借完还是乙下注");
  A(g, "b", "call");
  assert.ok(g.betting.window, "跟注后开追加窗口");
  assert.deepEqual(J(D.toAct(g)), ["a", "b"]);
  assert.equal(D.view(g, "a").betting.window.sec, C.callWindowSec);
  A(g, "a", "pass");
  assert.equal(g.stage, "bet1", "一方放弃还要等另一方");
  assert.equal(D.closeWindow(g), true, "到时间关窗");
  assert.equal(g.stage, "bet2");
  assert.equal(g.weather, "heat");
  assert.equal(D.closeWindow(g), false, "窗口没开着");
  assert.match(g.log.map(e => e.text).join("\n"), /乙向主持方借了 12 枚筹码（对局结束时还 16 枚）/);
  assert.match(g.log.map(e => e.text).join("\n"), /乙跟注，开 3 秒追加窗口/);
  // 另一局：第一轮甲下注、乙加注、甲再加注——加注 2 次用完，乙只能跟注或弃牌；跟注后不开窗口，直接翻天气
  const h = D.newGame({ seed: "bet2", deck: DECK });
  play(h, ["flesh", "physical"], ["flesh", "physical"]);
  A(h, "a", "bet", { amount: 1 });
  A(h, "b", "raise", { amount: 1 });
  A(h, "a", "raise", { amount: 1 });
  assert.ok(!D.legal(h, "b").some(o => o.type === "raise"));
  A(h, "b", "call");
  assert.equal(h.stage, "bet2", "加注次数用完：跟注直接结束这个下注回合");
  assert.equal(h.betting.window, undefined);
  assert.equal(h.weather, "heat");
});

test("下注规则跟着 High Flux 的配置走（同一份代码、同一份数）：把 CC_CONFIG.maxRaises 改成 1，Duel 里加注一次就不能再加", () => {
  const was = C.maxRaises;
  try {
    C.maxRaises = 1;
    const g = D.newGame({ seed: "mr", deck: DECK });
    play(g, ["flesh", "physical"], ["flesh", "physical"]);
    A(g, "a", "bet", { amount: 1 });
    A(g, "b", "raise", { amount: 1 });
    assert.ok(!D.legal(g, "a").some(o => o.type === "raise"));
  } finally { C.maxRaises = was; }
});

test("借贷：每轮开始手上不够「底注 + 最低下注额」先问借不借（3 枚一份，3 借 4 还）；不借也能接着打；对局结束从筹码里扣还", () => {
  const g = D.newGame({ seed: "loan", deck: ["heat", "snow", "acid", "thunder", "glow"], chipsBy: { a: 50, b: 1 } });
  assert.equal(g.stage, "loan");
  assert.deepEqual(J(D.toAct(g)), ["b"]);
  assert.deepEqual(J(D.legal(g, "b")), [{ type: "borrow", min: 3, max: 3, step: 3, need: 2 }, { type: "noLoan" }]);
  A(g, "b", "borrow", { amount: 3 });
  assert.equal(g.stage, "play");
  assert.equal(g.sides.b.chips, 3, "1 + 3 − 底注 1");
  assert.deepEqual(J({ loan: g.sides.b.loan, owe: g.sides.b.owe }), { loan: 3, owe: 4 });
  quietRound(g, ["flesh", "fire"], ["flesh", "fire"]);
  quietRound(g, ["armor", "acid"], ["armor", "acid"]);               // 第 2 轮：乙 3 枚不够 2 + 2，问了不借
  assert.ok(g.log.some(e => e.t === "noLoan" && e.by === "b" && e.r === 2));
  quietRound(g, ["shield", "electric"], ["shield", "electric"]);     // 第 3 轮：乙只剩 1 枚，双方都只下 1 枚底注
  assert.equal(g.results[2].bets.a, 1);
  quietRound(g, ["sand", "ice"], ["sand", "ice"]);                   // 第 4、5 轮：乙手上没有筹码（底池里还有），都不下底注
  quietRound(g, ["spirit", "energy"], ["spirit", "energy"]);
  assert.equal(g.over, true);
  assert.deepEqual(J(g.final.held), { a: 50, b: 4 });
  assert.deepEqual(J(g.final.chips), { a: 50, b: 0 }, "乙扣还 4 枚");
  assert.deepEqual(J(g.final.loans.b), { loan: 3, owe: 4 });
  assert.equal(g.final.winner, "a");
  assert.match(g.log[g.log.length - 1].text, /乙 0 枚（已扣还借款 4 枚）/);
});

/* ---------- 亮牌开关、能看到什么 ---------- */

test("亮牌开关：默认不亮——结算只公开胜负、分档和筹码变动；改成 reveal: true 结算公开双方出的牌和各自的得分", () => {
  const g = D.newGame({ seed: "rv", deck: DECK });
  betFourRound(g, ["flesh", "fire"], ["flesh", "ice"]);
  const r = g.results[0];
  assert.equal(r.shown, undefined);
  const text = g.log.find(e => e.t === "result").text;
  assert.ok(!/亮牌|冰|火|血肉/.test(text), text);
  assert.equal(D.view(g, "a").reveal, false);
  assert.equal(D.view(g, "b").results[0].shown, undefined);
  const was = C.duel.reveal;
  try {
    C.duel.reveal = true;
    const h = D.newGame({ seed: "rv", deck: DECK });
    betFourRound(h, ["flesh", "fire"], ["flesh", "ice"]);
    assert.deepEqual(J(h.results[0].shown), { a: { layer: "flesh", element: "fire", score: 2 }, b: { layer: "flesh", element: "ice", score: -1 } });
    assert.match(h.log.find(e => e.t === "result").text, /亮牌：甲〔血肉〕〔火〕得 \+2，乙〔血肉〕〔冰〕得 −1/);
    assert.equal(D.view(h, "b").reveal, true);
    assert.deepEqual(J(D.view(h, "b").results[0].shown.a), { layer: "flesh", element: "fire", score: 2 });
  } finally { C.duel.reveal = was; }
});

test("看不到对方的牌：对方暗出了只知道「出了」，手牌只给张数；对方的私人记录不在自己的 view 里", () => {
  const g = D.newGame({ seed: "pv", deck: DECK });
  A(g, "a", "play", { layer: "armor", element: "electric" });
  const v = D.view(g, "b");
  assert.equal(v.opp.played, true);
  assert.equal(v.opp.layerCount, 4);
  assert.equal(v.opp.elementCount, 6);
  ["layer", "element", "layers", "elements", "history"].forEach(k => assert.ok(!(k in v.opp), "对方的 " + k + " 不在 view 里"));
  assert.ok(!v.log.some(e => e.to === "a"));
  assert.ok(!JSON.stringify(v).includes("你暗出了"));
  const mine = D.view(g, "a");
  assert.equal(mine.me.layer, "armor");
  assert.equal(mine.me.element, "electric");
  assert.ok(mine.log.some(e => e.to === "a" && /你暗出了〔装甲〕〔电〕/.test(e.text)));
  assert.equal(mine.opp.played, false);
  assert.deepEqual(J(D.legal(g, "a")), [], "出过了就不再等这一方");
  assert.deepEqual(J(D.toAct(g)), ["b"]);
});

test("赌场（预留）：筹码无限的一方（house）——全押上限按另一方的筹码；对局结束另一方扣还借款后比开局多算赢", () => {
  const g = D.newGame({ seed: "house", deck: ["phase"], chips: 40, house: "b" });
  assert.equal(g.sides.b.infinite, true);
  const v = D.view(g, "a");
  assert.equal(v.opp.chips, null);
  play(g, ["flesh", "fire"], ["flesh", "physical"]);
  assert.equal(D.legal(g, "a").find(o => o.type === "bet").max, 39);
  checks(g);
  assert.deepEqual(J(g.results[0].bets), { a: 40, b: 40 });
  assert.deepEqual(J(g.results[0].chips), { a: 80, b: null });
  for (let guard = 0; !g.over; guard++) {
    assert.ok(guard < 40);
    quietRound(g, [g.sides.a.layers[0], g.sides.a.elements[0]], [g.sides.b.layers[0], g.sides.b.elements[0]]);
  }
  assert.equal(g.final.winner, "a");
  assert.equal(g.final.chips.b, null);
});
