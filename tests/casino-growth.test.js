// 赌场接入长线养成（#487 第 4 步）：任务板前进赌场（赠送每个存档只送一次）、用队伍的奎支兑换、坐桌 / 离桌，
// 钱包和打到一半的牌局写进长线存档；坐在桌上时不能接任务；普通单局、任务中途去不了。规则在 rogue.js · casino*（钱在 casino.js）
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

function fresh(seed, opt) {
  const c = H.load();
  for (const f of ["counter-cards.js", "counter-cards-ai.js", "casino.js"]) vm.runInContext(read(f), c, { filename: f });
  const run = c.Rogue.newRun(Object.assign({ party: ["kolt", "helu"], seed, growth: true }, opt || {}));
  return { c, run, R: c.Rogue, CC: c.CounterCards, K: c.Casino, st: c.S.state };
}
const A = (CC, g, side, type, extra) => CC.act(g, side, Object.assign({ type }, extra || {}));
/** 相位全押打赢（火打肉体），后面每一轮庄家都弃牌：桌上从 B 枚打到 2B + 4 枚 */
function winGame(CC, g) {
  A(CC, g, "dealer", "weather", { op: "pass" });
  A(CC, g, "dealer", "play", { card: "flesh" }); A(CC, g, "player", "play", { card: "fire" });
  A(CC, g, "player", "check"); A(CC, g, "dealer", "check");
  A(CC, g, "player", "reveal");
  for (let guard = 0; !g.over; guard++) {
    assert.ok(guard < 80, "打不完：" + g.stage);
    const side = CC.toAct(g)[0];
    if (g.stage === "dealerWeather") A(CC, g, "dealer", "weather", { op: g.weather ? "keep" : "pass" });
    else if (g.stage === "play") for (const s of CC.toAct(g)) A(CC, g, s, "play", { card: CC.legal(g, s)[0].card });
    else if (g.stage === "bet1" || g.stage === "bet2") A(CC, g, side, side === "dealer" ? "fold" : "check");
    else assert.fail("没想到的阶段：" + g.stage);
  }
}

test("长线养成：任务板前进赌场，第一次送 50 枚赠送筹码；写进长线存档，读档以后再进不再送", () => {
  const { c, run, R } = fresh("CASINO-G1");
  assert.equal(run.stage, "board");
  const notes = R.casinoOpen(run);
  assert.match(notes.join(""), /赠送 50 枚筹码/);
  assert.ok(run.log.some(l => /赌场：第一次来赌场/.test(l.text)), "写进单局记录");
  assert.deepEqual([R.casinoView(run).chips.gift, R.casinoView(run).chips.normal], [50, 0]);
  assert.deepEqual(J(R.casinoOpen(run)), [], "再进不再送");
  R.save(run);
  const loaded = c.SaveStore.loadGrowth();
  assert.equal(loaded.casino.gifted, true, "送过的记号跟着长线存档");
  assert.deepEqual(J(R.casinoOpen(loaded)), [], "读档以后也不再送");
  assert.equal(R.casinoView(loaded).chips.gift, 50);
});

test("长线养成：兑换用队伍的奎支——200 奎支买 1 枚、1 枚卖 190 奎支；奎支不够不能买，钱包和奎支都不动", () => {
  const { run, R, st } = fresh("CASINO-G2");
  R.casinoOpen(run);
  st.kuizhi = 1000;
  R.casinoBuy(run, 3);
  assert.equal(st.kuizhi, 400);
  assert.equal(R.casinoView(run).chips.normal, 3);
  assert.equal(R.casinoView(run).kuizhi, 400);
  assert.throws(() => R.casinoBuy(run, 3), /奎支不够/);
  assert.equal(st.kuizhi, 400, "没买成不扣奎支");
  assert.equal(R.casinoView(run).chips.normal, 3, "没买成不动钱包");
  R.casinoSell(run, 2);
  assert.equal(st.kuizhi, 780);
  assert.equal(R.casinoView(run).chips.normal, 1);
  assert.throws(() => R.casinoSell(run, 2), /赠送的筹码不能换成奎支/, "赠送的 50 枚不能卖");
  assert.equal(st.kuizhi, 780);
  assert.ok(run.log.some(l => /赌场：买了 3 枚筹码，花掉 600 奎支/.test(l.text)));
  assert.ok(run.log.some(l => /赌场：卖了 2 枚筹码，得 380 奎支/.test(l.text)));
});

test("长线养成：坐桌开一局（交入场费），坐在桌上时不能接任务；离桌结算回钱包以后照常接任务", () => {
  const { run, R, CC } = fresh("CASINO-G3");
  R.casinoOpen(run);
  const { game } = R.casinoSit(run, "hall", 40, { deck: PHASE_FIRST });
  assert.equal(game.casino.table, "hall");
  assert.equal(R.casinoView(run).game, game, "界面拿到的就是钱包里这一局");
  assert.equal(R.casinoView(run).chips.gift, 50 - 10 - 0.5, "买入 40 枚（10 枚筹码）+ 入场费 2 枚（0.5 枚）");
  assert.equal(R.taskBlocked(run, run.board[0]), "还坐在赌场的牌桌上：先离桌");
  assert.throws(() => R.acceptTask(run, 0), /先离桌/);
  assert.throws(() => R.casinoSit(run, "alley", 20), /已经坐在桌上/);
  winGame(CC, game);
  const notes = R.casinoLeave(run);
  assert.match(notes.join(""), /离开大厅：桌上剩 84 枚/);
  assert.deepEqual([R.casinoView(run).chips.gift, R.casinoView(run).chips.normal], [49.5, 11], "赢来的进普通筹码");
  assert.equal(R.taskBlocked(run, run.board[0]), null);
  R.acceptTask(run, 0);
  assert.equal(run.stage, "task");
});

test("长线养成：打到一半的牌局写进长线存档，读档以后接着打完、结算", () => {
  const { c, run, R, CC } = fresh("CASINO-G4");
  R.casinoOpen(run);
  const { game } = R.casinoSit(run, "hall", 40, { deck: PHASE_FIRST });
  A(CC, game, "dealer", "weather", { op: "pass" });
  A(CC, game, "dealer", "play", { card: "flesh" });
  R.save(run);                                          // 界面每走一步就存档
  const loaded = c.SaveStore.loadGrowth();
  const g2 = R.casinoView(loaded).game;
  assert.equal(g2.stage, "play");
  assert.equal(g2.sides.dealer.card, "flesh", "庄家暗出的牌也在存档里");
  assert.ok(g2 !== game);
  A(CC, g2, "player", "play", { card: "fire" });
  A(CC, g2, "player", "check"); A(CC, g2, "dealer", "check");
  A(CC, g2, "player", "reveal");
  for (let guard = 0; !g2.over; guard++) {
    assert.ok(guard < 80);
    const side = CC.toAct(g2)[0];
    if (g2.stage === "dealerWeather") A(CC, g2, "dealer", "weather", { op: g2.weather ? "keep" : "pass" });
    else if (g2.stage === "play") for (const s of CC.toAct(g2)) A(CC, g2, s, "play", { card: CC.legal(g2, s)[0].card });
    else A(CC, g2, side, side === "dealer" ? "fold" : "check");
  }
  R.casinoLeave(loaded);
  assert.deepEqual([R.casinoView(loaded).chips.gift, R.casinoView(loaded).chips.normal], [49.5, 11]);
});

test("只有长线养成、而且在任务板前才能去赌场：普通单局、任务中途都不行", () => {
  const normal = fresh("CASINO-G5", { growth: false });
  assert.throws(() => normal.R.casinoOpen(normal.run), /只有长线养成/);
  assert.throws(() => normal.R.casinoBuy(normal.run, 1), /只有长线养成/);
  const { run, R, st } = fresh("CASINO-G6");
  R.casinoOpen(run);
  R.acceptTask(run, 0);
  st.kuizhi = 1000;
  assert.throws(() => R.casinoBuy(run, 1), /任务板前/);
  assert.throws(() => R.casinoSit(run, "hall", 40), /任务板前/);
  assert.equal(st.kuizhi, 1000);
});

test("命令层（rogue-commands.js）：赌场的几个操作和直接调规则结果一样", () => {
  const { c, run, st } = fresh("CASINO-G7");
  const send = (action, fields) => c.dispatch(Object.assign({ type: "run", action }, fields || {}), { run });
  const ask = (action) => c.dispatch({ type: "run.query", action }, { run });
  assert.match(J(send("casinoOpen")).join(""), /赠送 50 枚/);
  st.kuizhi = 500;
  send("casinoBuy", { n: 2 });
  assert.equal(st.kuizhi, 100);
  send("casinoSell", { n: 1 });
  assert.equal(st.kuizhi, 290);
  assert.match(J(send("casinoSit", { table: "alley", buyIn: 20 })).join(""), /坐上后巷小桌，买入 20 枚，交入场费 2 枚/);
  assert.equal(ask("casinoView").chips.seat.table, "alley");
  assert.match(J(send("casinoLeave")).join(""), /离开后巷小桌/);
  assert.equal(ask("casinoView").chips.seat, null);
});
