// High Flux（#485）· AI counter-cards-ai.js：简单 / 普通 / 困难 × 庄家 / 玩家都能完整打完一局、只按自己能看到的东西做决定、
// 推理（困难记住整局、普通只看单轮结果）、玩家方会决定翻天气还是暗弃跳过、借贷（每轮开始 / 下注时）、困难比简单强
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

test("两边任意难度都能和 AI 完整打完一局：每一步都合法，筹码守恒（算上向主持方借的、还的），结束时有结果", () => {
  for (const dl of LEVELS) for (const pl of LEVELS) {
    for (let n = 0; n < 15; n++) {
      const g = CC.newGame({ seed: `${dl}-${pl}-${n}` });
      AI.playOut(g, { dealer: dl, player: pl });
      assert.equal(g.over, true);
      const d = g.sides.dealer, p = g.sides.player;
      assert.equal(d.chips + p.chips, 100 + d.loan + p.loan - d.owe - p.owe, `${dl}/${pl}/${n}`);
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

test("推理：困难记住整局的结果、排除已经推出来的牌；普通只看单轮结果（最近一轮），不跨轮记牌", () => {
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
  assert.ok(normal.flesh > 0);                          // 普通只看单轮结果，不记第 1 轮
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

/** 打完第 1 轮：都过牌，雷鸣里冰打血肉平局（deck 第 1 张要是雷鸣） */
function afterTie(seed, deck) {
  const g = CC.newGame({ seed, deck });
  A(g, "dealer", "weather", { op: "pass" });
  A(g, "dealer", "play", { card: "flesh" }); A(g, "player", "play", { card: "ice" });
  A(g, "player", "check"); A(g, "dealer", "check");
  A(g, "player", "reveal"); A(g, "player", "noNormal");
  A(g, "dealer", "check"); A(g, "player", "check");
  return g;
}

test("AI 也会借（每轮开始）：落后、输光了就借，借到补上缺口；领先就不借；困难估计追不上就不借，普通照借", () => {
  // 第 2 轮相位全押输光 → 第 3 轮开始：缺 1 + 3 = 4 枚，最多借 6 枚；剩 3 轮还追得上
  const g = afterTie("AI借", ["thunder", "phase", "heat", "snow", "acid", "sand", "glow"]);
  A(g, "dealer", "weather", { op: "keep" });
  A(g, "dealer", "play", { card: "armor" }); A(g, "player", "play", { card: "fire" });
  A(g, "player", "check"); A(g, "dealer", "check");
  A(g, "player", "reveal");
  assert.equal(g.stage, "loan"); assert.equal(g.round, 3);
  const pv = CC.view(g, "player");
  for (const level of ["normal", "hard"]) assert.deepEqual(J(AI.decide(pv, level, CC.makeRng("x"))), { type: "borrow", amount: 6 }, level);
  const easy = Array.from({ length: 10 }, (_, i) => AI.decide(pv, "easy", CC.makeRng("e" + i)).type);
  assert.ok(easy.includes("borrow"), "简单也会借");
  assert.ok(easy.every(t => t === "borrow" || t === "noLoan"));
  // 第 4 轮相位全押输光 → 第 5 轮开始：只剩 1 轮，借 6 枚最多翻到 15 枚，追不上庄家的 100 枚——困难不借，普通照借
  const late = CC.newGame({ seed: "AI借2", deck: ["thunder", "sand", "glow", "phase", "heat", "snow", "acid"] });
  const ties = [["flesh", "ice"], ["sand", "physical"], ["spirit", "harmonic"]];
  for (const [dc, pc] of ties) {
    A(late, "dealer", "weather", { op: late.weather ? "keep" : "pass" });
    A(late, "dealer", "play", { card: dc }); A(late, "player", "play", { card: pc });
    A(late, "player", "check"); A(late, "dealer", "check");
    A(late, "player", "reveal"); A(late, "player", "noNormal");
    A(late, "dealer", "check"); A(late, "player", "check");
  }
  assert.ok(late.results.every(r => r.outcome === "tie"));
  A(late, "dealer", "weather", { op: "keep" });
  A(late, "dealer", "play", { card: "armor" }); A(late, "player", "play", { card: "fire" });
  A(late, "player", "check"); A(late, "dealer", "check");
  A(late, "player", "reveal");                       // 相位全押：火打装甲 −1
  assert.equal(late.round, 5); assert.equal(late.stage, "loan");
  const lv = CC.view(late, "player");
  assert.deepEqual(J(AI.decide(lv, "hard", CC.makeRng("x"))), { type: "noLoan" });
  assert.deepEqual(J(AI.decide(lv, "normal", CC.makeRng("x"))), { type: "borrow", amount: 6 });
  // 领先的一方不借：玩家输光、借 3 枚（要还 4 枚），庄家只差一点（1 枚，不够 1 + 1）
  const lead = CC.newGame({ seed: "AI借3", dealerChips: 1, playerChips: 0 });
  assert.deepEqual(J(CC.toAct(lead)), ["player"]);
  for (const level of ["normal", "hard"]) assert.deepEqual(J(AI.decide(CC.view(lead, "player"), level, CC.makeRng("x"))), { type: "borrow", amount: 3 }, level);
  A(lead, "player", "borrow", { amount: 3 });
  assert.deepEqual(J(CC.toAct(lead)), ["dealer"]);
  for (const level of ["normal", "hard"]) assert.deepEqual(J(AI.decide(CC.view(lead, "dealer"), level, CC.makeRng("x"))), { type: "noLoan" }, level);
});

test("AI 也会借（下注时）：筹码不够、牌又好到想加注才借（普通、困难）；牌不好就不借", () => {
  // 第 1 轮玩家押掉 4 枚（平局滚存）；第 2 轮雷鸣，玩家手上 2 枚，庄家下 2 → 不够 2 + 2，可以借
  const mk = (playerCard) => {
    const g = CC.newGame({ seed: "下注借", deck: DECK, playerChips: 8 });
    A(g, "dealer", "weather", { op: "pass" });
    A(g, "dealer", "play", { card: "flesh" }); A(g, "player", "play", { card: "ice" });
    A(g, "player", "bet", { amount: 4 }); A(g, "dealer", "call");
    A(g, "player", "reveal"); A(g, "player", "noNormal");
    A(g, "dealer", "check"); A(g, "player", "check");
    A(g, "dealer", "weather", { op: "keep" });
    A(g, "dealer", "play", { card: "sand" }); A(g, "player", "play", { card: playerCard });
    A(g, "player", "check"); A(g, "dealer", "bet", { amount: 2 });
    assert.ok(CC.legal(g, "player").some(o => o.type === "borrow"));
    return g;
  };
  for (const level of ["normal", "hard"]) {
    // 雷鸣里出能量：除了装甲（0）都赢
    const strong = mk("energy");
    const a = AI.decide(CC.view(strong, "player"), level, CC.makeRng("s"));
    assert.deepEqual(J(a), { type: "borrow", amount: 3 }, level);
    CC.act(strong, "player", a);
    const next = AI.decide(CC.view(strong, "player"), level, CC.makeRng("s"));
    assert.ok(["call", "raise"].includes(next.type), level + "：借完接着下注");
    // 雷鸣里出谐波：只赢沙
    const weak = AI.decide(CC.view(mk("harmonic"), "player"), level, CC.makeRng("w"));
    assert.notEqual(weak.type, "borrow", level);
  }
});

test("AI 对 AI：三档难度都借过筹码；借贷不会让对局卡住", () => {
  const loans = { easy: 0, normal: 0, hard: 0 };
  for (const level of LEVELS) for (const other of LEVELS) for (let n = 0; n < 20; n++) {
    for (const side of ["dealer", "player"]) {
      const g = CC.newGame({ seed: `借-${level}-${other}-${side}-${n}` });
      AI.playOut(g, side === "dealer" ? { dealer: level, player: other } : { dealer: other, player: level });
      g.log.forEach(e => { if (e.t === "loan" && e.by === side) loans[level]++; });
    }
  }
  for (const level of LEVELS) assert.ok(loans[level] > 0, level + " 借过筹码");
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

/* ---------- 庄家天气行动：保留以后也能偷看、按顺序往下看（#502，主人 10/30） ---------- */

test("庄家 AI 会用新选项（#502）：场上有天气时保留以后接着偷看——三档难度都用过；普通 / 困难留着天气、堆里还有没看过的牌时一定接着偷看，简单随手选（保留不看、保留偷看都有）；整局里往下看过第 2 张以后的", () => {
  const n = {};
  LEVELS.forEach(l => { n[l] = { keepPeek: 0, keepOnly: 0, deep: 0 }; });
  for (const level of LEVELS) for (let i = 0; i < 30; i++) {
    const g = CC.newGame({ seed: `天气行动-${level}-${i}` });
    const rngs = { dealer: CC.makeRng("d" + i), player: CC.makeRng("p" + i) };
    for (let guard = 0; !g.over; guard++) {
      assert.ok(guard < 400, "卡住了：" + g.stage);
      const side = CC.toAct(g)[0], v = CC.view(g, side);
      const a = AI.decide(v, side === "dealer" ? level : "normal", rngs[side]);
      if (side === "dealer" && v.stage === "dealerWeather" && v.weather && v.legal.some(o => o.op === "peek")) {
        if (a.op === "peek") n[level].keepPeek++; else if (a.op === "keep") n[level].keepOnly++;
      }
      CC.act(g, side, a);
      if (side === "dealer" && a.type === "weather" && a.op === "peek" && g.peek.at > 0) n[level].deep++;
    }
  }
  for (const level of LEVELS) assert.ok(n[level].keepPeek > 0, `${level}：保留以后接着偷看过 ${JSON.stringify(n[level])}`);
  for (const level of ["normal", "hard"]) assert.equal(n[level].keepOnly, 0, `${level}：留着天气时还有没看过的牌就偷看`);
  assert.ok(n.easy.keepOnly > 0, "简单随手选：也有保留了不看的");
  assert.ok(LEVELS.every(l => n[l].deep > 0), "按顺序往下看：看过第 2 张以后的 " + JSON.stringify(n));
});

test("普通 / 困难用上看过的情报（#502）：偷看后放回原位还是压到牌堆底，按「没看过的牌」比——同样的公开局面、第 2 轮偷看到同一张酷暑，第 1 轮压到牌堆底的是微光就把酷暑也压下去，是相位就放回原位（看过的知道在哪儿，不会换上来）；简单随手放", () => {
  const mk = (buried, other) => {
    const g = CC.newGame({ seed: "放哪儿", deck: [buried, "heat", "snow", "acid", other, "thunder", "sand"] });
    // 第 1 轮：偷看堆顶、压到牌堆底；玩家暗弃常态跳过（没翻天气，公开的局面两局一样）
    A(g, "dealer", "weather", { op: "peek" }); A(g, "dealer", "place", { where: "bottom" });
    A(g, "dealer", "play", { card: "flesh" }); A(g, "player", "play", { card: "ice" });
    A(g, "player", "check"); A(g, "dealer", "check");
    A(g, "player", "skip", { card: "normal" });
    A(g, "dealer", "check"); A(g, "player", "check");
    A(g, "dealer", "weather", { op: "peek" });   // 第 2 轮：偷看到酷暑
    return g;
  };
  const g1 = mk("glow", "phase"), g2 = mk("phase", "glow");
  assert.equal(JSON.stringify(CC.view(g1, "player")), JSON.stringify(CC.view(g2, "player")), "玩家看到的一模一样");
  const v1 = CC.view(g1, "dealer"), v2 = CC.view(g2, "dealer");
  assert.deepEqual([v1.peek.card, v2.peek.card], ["heat", "heat"]);
  assert.deepEqual([J(v1.deckSeen.bottom), J(v2.deckSeen.bottom)], [["glow"], ["phase"]]);
  for (const level of ["normal", "hard"]) {
    const a1 = AI.decide(v1, level, CC.makeRng("x")), a2 = AI.decide(v2, level, CC.makeRng("x"));
    assert.deepEqual([a1.where, a2.where], ["bottom", "top"], level);
  }
  const easy = new Set(Array.from({ length: 12 }, (_, i) => AI.decide(v1, "easy", CC.makeRng("e" + i)).where));
  assert.equal(easy.size, 2, "简单随手放");
});

test("困难庄家用上看过的情报（#502）：三张压到了牌堆底、堆里只剩一张没看过——推得出堆顶就是那张（微光），出牌和亲眼看过堆顶时一样", () => {
  const deck = ["heat", "snow", "acid", "sand", "phase", "thunder", "glow"];
  const mk = (look) => {
    const g = CC.newGame({ seed: "推出堆顶", deck });
    // 前三轮：庄家偷看堆顶压到牌堆底（酷暑、酸雨、相位），玩家翻开下一张（雪天、沙暴、雷鸣）
    [["flesh", "ice"], ["sand", "physical"], ["spirit", "harmonic"]].forEach(([dc, pc]) => {
      A(g, "dealer", "weather", { op: "peek" }); A(g, "dealer", "place", { where: "bottom" });
      A(g, "dealer", "play", { card: dc }); A(g, "player", "play", { card: pc });
      A(g, "player", "check"); A(g, "dealer", "check");
      A(g, "player", "reveal"); A(g, "player", "noNormal");
      A(g, "dealer", "check"); A(g, "player", "check");
    });
    // 第 4 轮：保留雷鸣不看（堆顶靠推）/ 保留以后偷看堆顶、放回原位（亲眼看过）
    if (look) { A(g, "dealer", "weather", { op: "peek" }); A(g, "dealer", "place", { where: "top" }); }
    else A(g, "dealer", "weather", { op: "keep" });
    return g;
  };
  const inferred = CC.view(mk(false), "dealer"), looked = CC.view(mk(true), "dealer");
  assert.deepEqual(J(inferred.deckSeen), { top: [], bottom: ["heat", "acid", "phase"], unseen: 1 });
  assert.equal(inferred.deckTop, null, "堆顶没亲眼看过");
  assert.equal(looked.deckTop, "glow");
  const a = AI.decide(inferred, "hard", CC.makeRng("x")), b = AI.decide(looked, "hard", CC.makeRng("x"));
  assert.equal(a.type, "play");
  assert.equal(a.card, b.card, "推出来的堆顶和亲眼看过的一样用");
  assert.equal(a.card, "shield");
});

test("玩家方从公开记录推出庄家知道堆顶往下几张（#502）：偷看后放回原位 +1、压到牌堆底不变、翻开一张 −1——庄家第 3 轮往下看了第 2 张、压到牌堆底，堆顶还是庄家看过、留着的那张（困难的玩家方照样认为它多半对庄家有利）", () => {
  const g = CC.newGame({ seed: "推堆顶", deck: ["glow", "heat", "snow", "acid", "thunder", "sand", "phase"] });
  const known = () => {
    const n = AI.dealerKnownTop(J(CC.view(g, "player")));
    assert.equal(n, CC.view(g, "dealer").deckSeen.top.length, "和庄家自己记的一样");
    return n;
  };
  const rest = (dc, pc, skip) => {
    A(g, "dealer", "play", { card: dc }); A(g, "player", "play", { card: pc });
    A(g, "player", "check"); A(g, "dealer", "check");
    if (skip) A(g, "player", "skip", { card: skip }); else A(g, "player", "reveal");
    if (g.stage === "normal") A(g, "player", "noNormal");
    A(g, "dealer", "check"); A(g, "player", "check");
  };
  assert.equal(known(), 0);
  A(g, "dealer", "weather", { op: "peek" }); A(g, "dealer", "place", { where: "top" });
  assert.equal(known(), 1, "第 1 轮：堆顶看过、放回原位");
  rest("flesh", "ice", "fire");
  A(g, "dealer", "weather", { op: "pass" });
  rest("sand", "physical", "acid");
  assert.equal(known(), 1, "第 2 轮庄家没动、玩家跳过：还是 1 张");
  A(g, "dealer", "weather", { op: "peek" });
  assert.equal(g.peek.at, 1);
  A(g, "dealer", "place", { where: "bottom" });
  assert.equal(known(), 1, "第 3 轮往下看的第 2 张压到了牌堆底：堆顶还是庄家看过、留着的");
  rest("spirit", "harmonic");
  assert.equal(g.weather, "glow", "玩家翻开的就是那张");
  assert.equal(known(), 0, "翻开了：庄家不再知道堆顶");
});
