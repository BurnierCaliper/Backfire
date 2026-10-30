// 赌场接入跑团（#487 第 5 步）：本机跑团用这个存档自己的筹码钱包（LEDGER.casino.wallets.party），赠送只送一次；
// 买筹码由谁付（队伍公账 / 角色钱包）、卖筹码的钱进谁的钱包；钱包和打到一半的牌局跟着跑团存档（LEDGER.save / load）；
// 「赌场」页（trpg-ui.js）第一次点开送赠送筹码、面板交给 casino-ui.js、牌局每走一步存档。规则在 trpg.js · trpgCasino*
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const H = require("./headless");

const read = f => fs.readFileSync(path.join(H.ROOT, f), "utf8");
const J = v => JSON.parse(JSON.stringify(v));
const PHASE_FIRST = ["phase", "heat", "snow", "acid", "thunder", "sand", "glow"];

function field() {
  const c = H.load();
  for (const f of ["counter-cards.js", "counter-cards-ai.js", "casino.js"]) vm.runInContext(read(f), c, { filename: f });
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "CASINO-TRPG" });
  c.S.TRPG.active = true;
  c.S.state.kuizhi = 0;
  c.LEDGER.purse = {};
  return c;
}
const send = (c, cmd) => c.Commands.dispatch(J(Object.assign({ type: "trpg" }, cmd)));
const A = (CC, g, side, type, extra) => CC.act(g, side, Object.assign({ type }, extra || {}));

test("跑团：这个存档自己的钱包第一次来送 50 枚赠送筹码，只送一次；记在 LEDGER.casino.wallets.party", () => {
  const c = field();
  assert.match(J(send(c, { action: "casinoOpen" })).join(""), /赌场：第一次来赌场：赠送 50 枚筹码/);
  assert.deepEqual(J(send(c, { action: "casinoOpen" })), [], "再来不送");
  assert.equal(c.LEDGER.casino.wallets.party.gifted, true);
  assert.equal(c.trpgCasinoView().chips.gift, 50);
});

test("跑团：买筹码由谁付（队伍公账 / 角色钱包），卖筹码的钱进选的钱包；奎支不够不能买，什么都不动；赠送的不能卖", () => {
  const c = field();
  send(c, { action: "casinoOpen" });
  c.S.state.kuizhi = 500;
  c.LEDGER.purse = { kolt: 1000 };
  assert.match(J(send(c, { action: "casinoBuy", n: 2 })).join(""), /买了 2 枚筹码，花掉 400 奎支（由 队伍公账 付）/);
  assert.equal(c.S.state.kuizhi, 100);
  assert.match(J(send(c, { action: "casinoBuy", n: 3, payer: "kolt" })).join(""), /由 .+ 付/);
  assert.equal(c.trpgPurse("kolt"), 400);
  assert.equal(c.trpgCasinoView().chips.normal, 5);
  assert.throws(() => send(c, { action: "casinoBuy", n: 3, payer: "kolt" }), /奎支不够/);
  assert.equal(c.trpgPurse("kolt"), 400, "没买成不扣钱");
  assert.equal(c.trpgCasinoView().chips.normal, 5, "没买成不动钱包");
  assert.throws(() => send(c, { action: "casinoBuy", n: 1, payer: "nobody" }), /没有这个钱包/);
  send(c, { action: "casinoSell", n: 4, payer: "helu" });
  assert.equal(c.trpgPurse("helu"), 760);
  assert.throws(() => send(c, { action: "casinoSell", n: 2 }), /只能卖 1 枚：赠送的筹码不能换成奎支/);
  assert.equal(c.trpgCasinoView("party", "kolt").kuizhi, 400, "界面上写付钱那个钱包有多少奎支");
});

test("跑团：坐桌（交入场费）→ 打完 → 离桌，赢来的进普通筹码；钱包连同打到一半的牌局跟着跑团存档走（旧存档没有赌场也能读）", () => {
  const c = field();
  send(c, { action: "casinoOpen" });
  const notes = c.trpgCasinoSit("hall", 40, null, { deck: PHASE_FIRST });
  assert.match(notes.join(""), /坐上大厅，买入 40 枚，交入场费 2 枚/);
  const g = c.trpgCasinoView().game;
  A(c.CounterCards, g, "dealer", "weather", { op: "pass" });
  A(c.CounterCards, g, "dealer", "play", { card: "flesh" });
  // 存档 → 读档：打到一半的牌局还在（庄家暗出的牌也在）
  const saved = c.LEDGER.save();
  assert.equal(saved.casino.wallets.party.seat.game.sides.dealer.card, "flesh");
  c.LEDGER.load({});
  assert.deepEqual(J(c.LEDGER.casino), {}, "旧存档没有赌场：空的");
  c.LEDGER.load(saved);
  const g2 = c.trpgCasinoView().game;
  assert.equal(g2.stage, "play");
  A(c.CounterCards, g2, "player", "play", { card: "fire" });
  A(c.CounterCards, g2, "player", "check"); A(c.CounterCards, g2, "dealer", "check");
  A(c.CounterCards, g2, "player", "reveal");                      // 相位全押：火打肉体，玩家翻倍
  const CC = c.CounterCards;
  for (let guard = 0; !g2.over; guard++) {
    assert.ok(guard < 80);
    const side = CC.toAct(g2)[0];
    if (g2.stage === "dealerWeather") A(CC, g2, "dealer", "weather", { op: g2.weather ? "keep" : "pass" });
    else if (g2.stage === "play") for (const s of CC.toAct(g2)) A(CC, g2, s, "play", { card: CC.legal(g2, s)[0].card });
    else A(CC, g2, side, side === "dealer" ? "fold" : "check");
  }
  assert.match(J(send(c, { action: "casinoLeave" })).join(""), /离开大厅：桌上剩 84 枚/);
  assert.deepEqual([c.trpgCasinoView().chips.gift, c.trpgCasinoView().chips.normal], [49.5, 11]);
  assert.equal(c.LEDGER.save().casino.wallets.party.seat, null);
});

test("跑团的「赌场」页：第一次点开送赠送筹码、面板交给 casino-ui.js（奎支选单 = 由谁付 / 钱进谁的钱包）、牌局每走一步存档", () => {
  const ui = read("trpg-ui.js");
  assert.match(ui, /\["merchants", "商人"\], \["casino", "赌场"\]/, "页签里有「赌场」");
  assert.match(ui, /casino: \(\) => casinoHtml\(\)/);
  assert.match(ui, /if \(tab === "casino" && casinoFirstVisit\(\)\) \{ act\(ruleCommand\("casinoOpen"\)\); return; \}/);
  assert.match(ui, /\[data-casino-root\]"\)\.forEach\(h => \{ h\.onclick = e => \{ if \(window\.CasinoUI\) CasinoUI\.handle\(e, casinoAdapter\); \}; \}\)/);
  assert.match(ui, /buy: n => casinoDo\("casinoBuy", \{ n, payer: casinoPayer \}\)/);
  assert.match(ui, /saved: \(\) => save\(\)/);
  assert.match(ui, /back: \(\) => \{ tab = "casino"; Screens\.show\("trpg"\); \}/, "离桌回到跑团的赌场页");
  // 队伍档案里有赌场的钱包
  assert.match(read("ledger.js"), /casino: this\.casino \|\| \{\}/);
});
