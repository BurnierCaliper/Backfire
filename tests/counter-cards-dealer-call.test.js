// High Flux 庄家叫牌（#503）：基础模式、整局一次；叫对庄家赢并收回层牌，叫错玩家赢并亮出层牌；相位轮也能叫；普通赔率
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const H = require("./headless");

const ROOT = path.resolve(__dirname, "..");
const c = H.load();
vm.runInContext(fs.readFileSync(path.join(ROOT, "counter-cards.js"), "utf8"), c, { filename: "counter-cards.js" });
vm.runInContext(fs.readFileSync(path.join(ROOT, "counter-cards-ai.js"), "utf8"), c, { filename: "counter-cards-ai.js" });
const CC = c.CounterCards, AI = c.CounterCardsAI;
const J = v => JSON.parse(JSON.stringify(v));
const A = (g, side, type, extra) => CC.act(g, side, Object.assign({ type }, extra || {}));
const DECK = ["thunder", "sand", "glow", "heat", "snow", "acid", "phase"];
const PHASE_DECK = ["phase", "thunder", "sand", "glow", "heat", "snow", "acid"];

/** 打到叫牌阶段：都过牌、玩家暗弃常态跳过翻天气（第一轮）或翻天气 */
function toCall(g, dealerCard, playerCard, o) {
  o = o || {};
  A(g, "dealer", "weather", { op: g.weather ? "keep" : "pass" });
  A(g, "dealer", "play", { card: dealerCard });
  A(g, "player", "play", { card: playerCard });
  A(g, "player", "check"); A(g, "dealer", "check");
  if (g.stage === "weather") A(g, "player", "reveal");
  if (g.stage === "normal") A(g, "player", "noNormal");
  if (g.stage === "bet2") { A(g, "dealer", "check"); A(g, "player", "check"); }
}
const fresh = (deck) => CC.newGame({ seed: "call", deck: (deck || DECK).slice(), dealerCall: true });

test("默认关：不进叫牌阶段，老流程不变", () => {
  const g = CC.newGame({ seed: "x", deck: DECK.slice() });
  toCall(g, "flesh", "fire");
  assert.notEqual(g.stage, "dealerCall");
  assert.equal(g.results.length, 1);
  assert.equal(CC.view(g, "dealer").dealerCall.enabled, false);
});

test("叫对：庄家赢、普通赔率、层牌回到手上", () => {
  const g = fresh();
  toCall(g, "flesh", "fire");
  assert.equal(g.stage, "dealerCall");
  assert.deepEqual(J(CC.toAct(g)), ["dealer"]);
  assert.ok(CC.canCall(g));
  const before = { d: g.sides.dealer.chips, p: g.sides.player.chips, pot: g.sides.dealer.bet + g.sides.player.bet };
  CC.callElement(g, "fire");
  const r = g.results[0];
  assert.equal(r.winner, "dealer");
  assert.equal(r.tier, 1); assert.equal(r.extra, 0);
  assert.deepEqual(J(r.call), { element: "fire", correct: true });
  assert.equal(r.chips.dealer, before.d + before.pot);
  assert.equal(r.chips.player, before.p);
  assert.ok(g.sides.dealer.hand.includes("flesh"));
  assert.equal(g.sides.dealer.hand.length, 5);
  assert.ok(CC.legal(g, "dealer").length >= 0);
  const v = CC.view(g, "dealer");
  assert.equal(v.dealerCallUsed, true);
  assert.equal(v.dealerCall.correct, true);
  assert.deepEqual(J(CC.view(g, "player").dealerCall.revealed), []);
});

test("叫对后收回的层牌之后还能再出", () => {
  const g = fresh();
  toCall(g, "flesh", "fire");
  CC.callElement(g, "fire");
  A(g, "dealer", "weather", { op: g.weather ? "keep" : "pass" });
  assert.ok(CC.legal(g, "dealer").some(o => o.card === "flesh"));
  A(g, "dealer", "play", { card: "flesh" });
  assert.equal(g.sides.dealer.card, "flesh");
});

test("叫错：玩家赢、普通赔率、庄家层牌亮给玩家（只给玩家）", () => {
  const g = fresh();
  toCall(g, "armor", "fire");
  const before = { d: g.sides.dealer.chips, p: g.sides.player.chips, pot: g.sides.dealer.bet + g.sides.player.bet };
  CC.callElement(g, "ice");
  const r = g.results[0];
  assert.equal(r.winner, "player"); assert.equal(r.tier, 1); assert.equal(r.extra, 0);
  assert.equal(r.call.correct, false);
  assert.equal(r.chips.player, before.p + before.pot);
  assert.equal(r.chips.dealer, before.d);
  assert.ok(!g.sides.dealer.hand.includes("armor"));
  const pv = CC.view(g, "player");
  assert.deepEqual(J(pv.dealerCall.revealed), [{ r: 1, layer: "armor" }]);
  assert.ok(pv.log.some(e => e.t === "callReveal" && e.card === "armor"));
  const dv = CC.view(g, "dealer");
  assert.ok(!dv.log.some(e => e.t === "callReveal"));
});

test("整局只能叫一次：用过以后不再进叫牌阶段", () => {
  const g = fresh();
  toCall(g, "flesh", "fire");
  CC.skipCall(g);                         // 不叫不算用掉
  assert.equal(g.dealerCall.used, false);
  toCall(g, "armor", "acid");
  assert.equal(g.stage, "dealerCall");
  CC.callElement(g, "ice");
  assert.equal(g.dealerCall.used, true);
  toCall(g, "shield", "electric");
  assert.notEqual(g.stage, "dealerCall");
  assert.equal(g.results.length, 3);
  assert.equal(CC.canCall(g), false);
  assert.throws(() => CC.callElement(g, "fire"));
});

test("相位轮也可以叫：全押后进叫牌阶段，按普通赔率结算", () => {
  const g = fresh(PHASE_DECK);
  toCall(g, "flesh", "fire");
  assert.equal(g.allIn, true);
  assert.equal(g.stage, "dealerCall");
  const bet = g.sides.player.bet;
  const before = g.sides.dealer.chips;
  CC.callElement(g, "fire");
  const r = g.results[0];
  assert.equal(r.allIn, true); assert.equal(r.winner, "dealer"); assert.equal(r.extra, 0);
  assert.equal(r.chips.dealer, before + bet * 2);
  assert.ok(g.sides.dealer.hand.includes("flesh"));
});

test("AI：叫牌阶段只给合法操作，整局打得完", () => {
  for (let i = 0; i < 40; i++) {
    const g = CC.newGame({ seed: "ai" + i, dealerCall: true });
    AI.playOut(g, { dealer: i % 2 ? "hard" : "normal", player: "normal" }, "s" + i);
    assert.ok(g.over);
    assert.ok(g.results.filter(r => r.call).length <= 1);
  }
  const g = fresh();
  toCall(g, "flesh", "fire");
  const a = AI.decide(CC.view(g, "dealer"), "easy", () => 0);
  assert.equal(a.type, "noCall");
});
