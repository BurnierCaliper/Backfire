// 克制卡牌（暂名，#485）· AI counter-cards-ai.js：简单 / 普通 / 困难 × 庄家 / 玩家都能完整打完一局、只按自己能看到的东西做决定、
// 推理（困难记住整局、普通只看上一轮）、玩家方会决定翻天气还是暗弃跳过、困难比简单强
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
vm.runInContext(read("counter-cards.js"), c, { filename: "counter-cards.js" });
vm.runInContext(read("counter-cards-ai.js"), c, { filename: "counter-cards-ai.js" });
const CC = c.CounterCards;
const AI = c.CounterCardsAI;
const J = v => JSON.parse(JSON.stringify(v));
const A = (g, side, type, extra) => CC.act(g, side, Object.assign({ type }, extra || {}));
const DECK = ["thunder", "sand", "glow", "heat", "snow", "acid", "phase"];
const LEVELS = ["easy", "normal", "hard"];

test("两边任意难度都能和 AI 完整打完一局：每一步都合法，筹码守恒，结束时有结果", () => {
  for (const dl of LEVELS) for (const pl of LEVELS) {
    for (let n = 0; n < 15; n++) {
      const g = CC.newGame({ seed: `${dl}-${pl}-${n}` });
      AI.playOut(g, { dealer: dl, player: pl });
      assert.equal(g.over, true);
      assert.equal(g.sides.dealer.chips + g.sides.player.chips, 100, `${dl}/${pl}/${n}`);
      assert.ok(g.final);
      assert.ok(g.results.length >= 1 && g.results.length <= 5);
      // 打满 5 轮：庄家 5 张层牌各出一次，玩家出了 5 张不同的元素牌
      if (g.results.length === 5) {
        assert.equal(new Set(g.sides.dealer.history.map(h => h.card)).size, 5);
        assert.equal(new Set(g.sides.player.history.map(h => h.card)).size, 5);
        assert.ok(g.sides.player.history.every(h => CC.isElement(h.card)));
      }
    }
  }
});

test("AI 只按自己能看到的东西做决定：对方暗出的牌不一样、自己看到的一样 → 决定也一样；拿 JSON 化的 view 也能用", () => {
  for (const level of LEVELS) {
    // 玩家方：庄家暗出血肉 / 灵体
    const mk = (dealerCard) => {
      const g = CC.newGame({ seed: "同视角", deck: DECK });
      A(g, "dealer", "weather", { op: "pass" });
      A(g, "dealer", "play", { card: dealerCard });
      A(g, "player", "play", { card: "fire" });
      return g;
    };
    const a = mk("flesh"), b = mk("spirit");
    const va = CC.view(a, "player"), vb = CC.view(b, "player");
    assert.equal(JSON.stringify(va), JSON.stringify(vb));
    for (let s = 0; s < 5; s++) {
      const x = AI.decide(J(va), level, CC.makeRng("r" + s)), y = AI.decide(J(vb), level, CC.makeRng("r" + s));
      assert.deepEqual(J(x), J(y), level);
    }
    // 庄家方：玩家暗出火 / 冰，还暗弃了不一样的牌
    const mk2 = (playerCard, skip) => {
      const g = CC.newGame({ seed: "同视角2", deck: DECK });
      A(g, "dealer", "weather", { op: "pass" });
      A(g, "dealer", "play", { card: "flesh" });
      A(g, "player", "play", { card: "ice" });
      A(g, "player", "check"); A(g, "dealer", "check");
      A(g, "player", "skip", { card: skip });
      A(g, "dealer", "check"); A(g, "player", "check");       // 冰打血肉 0：平局
      A(g, "dealer", "weather", { op: "pass" });
      A(g, "player", "play", { card: playerCard });
      A(g, "dealer", "play", { card: "armor" });
      A(g, "player", "bet", { amount: 2 });
      return g;
    };
    const d1 = CC.view(mk2("fire", "physical"), "dealer"), d2 = CC.view(mk2("acid", "harmonic"), "dealer");
    assert.equal(JSON.stringify(d1), JSON.stringify(d2));
    for (let s = 0; s < 5; s++) assert.deepEqual(J(AI.decide(J(d1), level, CC.makeRng("d" + s))), J(AI.decide(J(d2), level, CC.makeRng("d" + s))), level);
  }
});

test("推理：困难记住整局的结果、排除已经推出来的牌；普通只看上一轮", () => {
  const g = CC.newGame({ seed: "推理", deck: DECK });
  // 第 1 轮：没有天气，火打血肉 → 玩家赢差 1（只有血肉会这样）
  A(g, "dealer", "weather", { op: "pass" });
  A(g, "dealer", "play", { card: "flesh" }); A(g, "player", "play", { card: "fire" });
  A(g, "player", "check"); A(g, "dealer", "check");
  A(g, "player", "skip", { card: "normal" });
  A(g, "dealer", "check"); A(g, "player", "check");
  assert.equal(g.results[0].winner, "player");
  let pv = CC.view(g, "player");
  assert.equal(AI.belief(pv, "hard").flesh, 0);
  assert.equal(AI.belief(pv, "normal").flesh, 0);
  assert.ok(AI.belief(pv, "easy").flesh > 0);           // 简单不推理
  const dv = CC.view(g, "dealer");
  assert.equal(AI.belief(dv, "hard").fire, 0);          // 庄家也推得出玩家出的是火
  // 第 2 轮：没有天气，物理打装甲 → 庄家赢差 1（装甲、护盾都会这样）
  A(g, "dealer", "weather", { op: "pass" });
  A(g, "dealer", "play", { card: "armor" }); A(g, "player", "play", { card: "physical" });
  A(g, "player", "check"); A(g, "dealer", "check");
  A(g, "player", "skip", { card: "harmonic" });
  A(g, "dealer", "check"); A(g, "player", "check");
  assert.equal(g.results[1].winner, "dealer");
  pv = CC.view(g, "player");
  const hard = AI.belief(pv, "hard"), normal = AI.belief(pv, "normal");
  assert.equal(hard.flesh, 0);                          // 困难还记得第 1 轮
  assert.ok(normal.flesh > 0);                          // 普通只看上一轮，忘了
  assert.ok(hard.sand > hard.armor && hard.armor > 0);  // 装甲 / 护盾只是有可能
  assert.ok(Math.abs(Object.values(hard).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test("玩家方：现在的天气对自己的牌很有利就暗弃一张跳过，不利就翻新天气（普通、困难）", () => {
  const setup = () => {
    const g = CC.newGame({ seed: "翻不翻", deck: DECK });
    A(g, "dealer", "weather", { op: "pass" });
    A(g, "dealer", "play", { card: "flesh" }); A(g, "player", "play", { card: "ice" });
    A(g, "player", "check"); A(g, "dealer", "check");
    A(g, "player", "reveal"); A(g, "player", "noNormal");   // 雷鸣
    A(g, "dealer", "check"); A(g, "player", "check");
    return g;
  };
  for (const level of ["normal", "hard"]) {
    const g = setup();
    A(g, "dealer", "weather", { op: "keep" });
    A(g, "dealer", "play", { card: "shield" }); A(g, "player", "play", { card: "electric" });
    A(g, "player", "check"); A(g, "dealer", "check");
    const a = AI.decide(CC.view(g, "player"), level, CC.makeRng("x"));
    assert.equal(a.type, "skip", level + "：雷鸣里出电，留着天气");
    // 沙暴里出电：翻新天气
    const g2 = setup();
    A(g2, "dealer", "weather", { op: "keep" });
    A(g2, "dealer", "play", { card: "armor" }); A(g2, "player", "play", { card: "harmonic" });
    A(g2, "player", "check"); A(g2, "dealer", "check");
    A(g2, "player", "reveal"); A(g2, "player", "noNormal");   // 沙暴
    A(g2, "dealer", "check"); A(g2, "player", "check");
    A(g2, "dealer", "weather", { op: "keep" });
    A(g2, "dealer", "play", { card: "spirit" }); A(g2, "player", "play", { card: "electric" });
    A(g2, "player", "check"); A(g2, "dealer", "check");
    assert.equal(g2.weather, "sand");
    const b = AI.decide(CC.view(g2, "player"), level, CC.makeRng("y"));
    assert.equal(b.type, "reveal", level + "：沙暴里出电，翻新天气");
  }
});

test("整局里：玩家方 AI 有翻天气也有暗弃跳过；困难会用常态；简单会乱弃牌（下注时认输）", () => {
  const count = { reveal: {}, skip: {}, normal: {}, fold: {} };
  LEVELS.forEach(l => { Object.keys(count).forEach(k => { count[k][l] = 0; }); });
  for (const level of LEVELS) for (let n = 0; n < 40; n++) {
    const g = CC.newGame({ seed: "统计" + n });
    AI.playOut(g, { dealer: "normal", player: level });
    g.log.forEach(e => {
      if (e.t === "pw" && e.op === "reveal") count.reveal[level]++;
      if (e.t === "skip") count.skip[level]++;
      if (e.t === "normal") count.normal[level]++;
      if (e.t === "bet" && e.op === "fold" && e.by === "player") count.fold[level]++;
    });
  }
  for (const level of LEVELS) {
    assert.ok(count.reveal[level] > 0, level + " 翻过天气");
    assert.ok(count.skip[level] > 0, level + " 暗弃跳过过");
  }
  assert.ok(count.normal.hard > 0, "困难用过常态");
  assert.ok(count.fold.easy > 0, "简单乱弃过牌");
  assert.ok(count.reveal.easy > count.skip.easy, "简单大多直接翻");
});

test("困难比简单强：同样的种子，困难的一方平均赢筹码", () => {
  const net = (levels, side, n) => {
    let s = 0;
    for (let i = 0; i < n; i++) { const g = CC.newGame({ seed: "强弱" + i }); AI.playOut(g, levels); s += g.final.net[side]; }
    return s / n;
  };
  const dealerHard = net({ dealer: "hard", player: "easy" }, "dealer", 120);
  const playerHard = net({ dealer: "easy", player: "hard" }, "player", 120);
  assert.ok(dealerHard > 0, "困难庄家 vs 简单玩家：庄家平均 " + dealerHard.toFixed(2));
  assert.ok(playerHard > 0, "困难玩家 vs 简单庄家：玩家平均 " + playerHard.toFixed(2));
});
