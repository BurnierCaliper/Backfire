// Flux Hold'em（#488）· AI flux-holdem-ai.js：2–4 人、三档难度混坐都能打完（每一步合法、筹码守恒）、只按自己能看到的东西做决定、
// 胜率（期望份额）的算法、庄家偷看的那张用得上、追加窗口里不弃牌、困难比简单强；平分底池的统计工具 tools/flux-holdem-stats.js
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
for (const f of ["counter-cards.js", "flux-holdem.js", "flux-holdem-ai.js"]) vm.runInContext(read(f), c, { filename: f });
const CC = c.CounterCards;
const X = c.FluxHoldem;
const AI = c.FluxHoldemAI;
const J = v => JSON.parse(JSON.stringify(v));
const A = (g, id, type, extra) => X.act(g, id, Object.assign({ type }, extra || {}));
const LEVELS = ["easy", "normal", "hard"];
const seatsOf = (n) => Array.from({ length: n }, (_, i) => ({ id: "p" + (i + 1) }));
const LAYERS = ["flesh", "armor", "shield", "sand", "spirit", "flesh", "armor", "shield", "sand", "spirit"];
const WEATHERS = ["heat", "snow", "acid", "thunder", "glow", "sand", "phase"];

test("2–4 人、三档难度混坐都能打完一局：每一步都合法，筹码守恒（算上借的、还的），结束时有赢家", () => {
  for (const n of [2, 3, 4]) for (let k = 0; k < 6; k++) {
    const g = X.newGame({ seed: `混坐${n}-${k}`, players: seatsOf(n) });
    const levels = {};
    g.order.forEach((id, i) => { levels[id] = LEVELS[(k + i) % 3]; });
    AI.playOut(g, levels);
    assert.equal(g.over, true);
    const total = g.order.reduce((t, id) => t + g.sides[id].chips + g.sides[id].owe - g.sides[id].loan, 0);
    assert.equal(total, 50 * n, `${n} 人第 ${k} 局`);
    assert.ok(g.final.winners.length >= 1);
    g.results.forEach(r => { if (r.outcome === "showdown") r.pots.forEach(p => assert.ok(p.winners.every(id => p.eligible.indexOf(id) >= 0))); });
  }
});

test("AI 只按自己能看到的东西做决定：别人盖的牌不一样、自己看到的一样 → 决定也一样；拿 JSON 化的 view 也能用", () => {
  for (const level of LEVELS) {
    const mk = (other) => {
      const g = X.newGame({ seed: "同视角", players: seatsOf(3), layers: LAYERS.slice(), weathers: WEATHERS.slice(),
        hands: { p1: ["fire", "ice", "acid"], p2: [other, "physical", "energy"], p3: ["harmonic", "electric", "ice"] }, elements: [] });
      A(g, "p1", "place", { where: "top" });
      A(g, "p2", "play", { card: other }); A(g, "p3", "play", { card: "harmonic" });
      return g;
    };
    // 乙的手牌不一样（甲看不到）：甲出牌、下注的决定一样
    const a = mk("fire"), b = mk("acid");
    const va = X.view(a, "p1"), vb = X.view(b, "p1");
    assert.equal(JSON.stringify(va), JSON.stringify(vb));
    for (let s = 0; s < 4; s++) assert.deepEqual(J(AI.decide(J(va), level, CC.makeRng("r" + s))), J(AI.decide(J(vb), level, CC.makeRng("r" + s))), level);
    A(a, "p1", "play", { card: "fire" }); A(b, "p1", "play", { card: "fire" });
    const wa = X.view(a, "p3"), wb = X.view(b, "p3");
    assert.equal(JSON.stringify(wa), JSON.stringify(wb));
    for (let s = 0; s < 4; s++) assert.deepEqual(J(AI.decide(J(wa), level, CC.makeRng("b" + s))), J(AI.decide(J(wb), level, CC.makeRng("b" + s))), level);
  }
});

test("胜率（期望份额）：在 0–1 之间，平均份额 = 1 ÷ 还在牌局里的人数；好牌比差牌高；普通、困难盖胜率最高的那张", () => {
  const g = X.newGame({ seed: "胜率", players: seatsOf(2), layers: LAYERS.slice(), weathers: ["heat", "snow", "acid", "thunder", "glow", "sand", "phase"],
    hands: { p1: ["fire", "ice", "harmonic"], p2: ["physical", "energy", "acid"] }, elements: [] });
  A(g, "p1", "place", { where: "top" });
  const v = X.view(g, "p1");
  assert.deepEqual(J(v.peek), { card: "heat", where: "top" }, "庄家知道第 1 张天气是酷暑");
  // 第 1 张层牌肉体、第 1 张天气酷暑（庄家知道）：火打肉体 +2，冰打肉体 −1
  const fire = AI.equity(v, "fire", "hard"), ice = AI.equity(v, "ice", "hard");
  assert.equal(fire.fair, 0.5);
  assert.equal(fire.n, 1);
  [fire, ice].forEach(q => assert.ok(q.e >= 0 && q.e <= 1));
  assert.ok(fire.e > ice.e + 0.2, `火 ${fire.e} 比冰 ${ice.e} 好得多`);
  AI.scenarios(v).forEach(sc => assert.equal(sc.weathers[0], "heat", "留在顶上的那张就是第 1 张天气"));
  for (const level of ["normal", "hard"]) assert.deepEqual(J(AI.decide(v, level, CC.makeRng("p"))), { type: "play", card: "fire" });
  // 不是庄家的看不到：第 1 张天气按还没上场的均匀
  const w = X.view(g, "p2");
  const firsts = new Set(AI.scenarios(w).map(sc => sc.weathers[0]));
  assert.ok(firsts.size > 1);
  // 压到堆底：那张不会是第 1 张天气
  const h = X.newGame({ seed: "胜率", players: seatsOf(2), layers: LAYERS.slice(), weathers: ["heat", "snow", "acid", "thunder", "glow", "sand", "phase"],
    hands: { p1: ["fire", "ice", "harmonic"], p2: ["physical", "energy", "acid"] }, elements: [] });
  A(h, "p1", "place", { where: "bottom" });
  assert.ok(AI.scenarios(X.view(h, "p1")).every(sc => sc.weathers[0] !== "heat"));
  const total = AI.scenarios(X.view(h, "p1")).reduce((t, sc) => t + sc.p, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test("庄家（普通、困难）：偷看到的天气对自己的手牌好就留在顶上，不好就压到堆底", () => {
  const mk = (hand) => X.newGame({ seed: "偷看", players: seatsOf(2), layers: LAYERS.slice(), weathers: ["heat", "snow", "acid", "thunder", "glow", "sand", "phase"],
    hands: { p1: hand, p2: ["physical", "energy", "acid"] }, elements: [] });
  for (const level of ["normal", "hard"]) {
    // 酷暑：火 +1、冰 −1
    assert.deepEqual(J(AI.decide(X.view(mk(["fire", "fire", "acid"]), "p1"), level, CC.makeRng("k"))), { type: "place", where: "top" }, level);
    assert.deepEqual(J(AI.decide(X.view(mk(["ice", "ice", "ice"]), "p1"), level, CC.makeRng("k"))), { type: "place", where: "bottom" }, level);
  }
});

test("AI 对 AI：开过追加窗口、窗口里加注过，AI 在窗口里从不弃牌；全押、边池、借贷都出现过，对局不会卡住", () => {
  let windows = 0, windowRaises = 0, allIns = 0, sidePots = 0, loans = 0;
  for (let n = 0; n < 18; n++) {
    const g = X.newGame({ seed: "窗口" + n, players: seatsOf(2 + (n % 3)) });
    const levels = {};
    g.order.forEach((id, i) => { levels[id] = LEVELS[(n + i) % 3]; });
    AI.playOut(g, levels);
    windows += g.log.filter(e => e.t === "window" && e.op === "open").length;
    windowRaises += g.log.filter(e => e.t === "bet" && e.op === "raise" && e.window).length;
    allIns += g.log.filter(e => e.t === "bet" && e.op === "allIn").length;
    sidePots += g.results.filter(r => r.pots.length > 1).length;
    loans += g.order.reduce((t, id) => t + g.sides[id].loan, 0);
    let open = false;
    g.log.forEach(e => {
      if (e.t === "window") open = e.op === "open";
      if (e.t === "bet" && e.op === "fold") assert.ok(!open, "窗口里弃牌了：" + e.text);
      if (e.t === "bet" && e.op === "raise") open = false;
      if (e.t === "result") open = false;
    });
    const per = {};
    g.log.filter(e => e.t === "bet" && e.op === "raise").forEach(e => { const k = e.r + ":" + e.street; per[k] = (per[k] || 0) + 1; });
    Object.values(per).forEach(x => assert.ok(x <= X.HOLDEM_CONFIG.maxRaises));
  }
  assert.ok(windows > 0 && windowRaises > 0, `窗口 ${windows}，窗口里加注 ${windowRaises}`);
  assert.ok(allIns > 0 && sidePots > 0, `全押 ${allIns}，边池 ${sidePots}`);
  assert.ok(loans > 0);
});

test("困难比简单强：两人局、四人局（两困难两简单）同样的种子、座位轮换，困难平均赢筹码", () => {
  for (const n of [2, 4]) {
    let net = 0;
    for (let k = 0; k < 8; k++) for (const flip of [false, true]) {
      const g = X.newGame({ seed: `强弱${n}-${k}`, players: seatsOf(n) });
      const levels = {};
      g.order.forEach((id, i) => { levels[id] = (i % 2 === 0) !== flip ? "hard" : "easy"; });
      AI.playOut(g, levels);
      g.order.forEach(id => { if (levels[id] === "hard") net += g.final.chips[id] - 50; });
    }
    assert.ok(net > 0, `${n} 人：困难净赢 ${net}`);
  }
});

test("统计工具 tools/flux-holdem-stats.js：AI 自对局里平分底池占亮牌的比例、占全部轮数的比例、平分过的局数", () => {
  const S = require("../tools/flux-holdem-stats.js");
  const t = S.run(3, 4, { ctx: c });
  assert.equal(t.games, 4);
  assert.equal(t.players, 3);
  assert.ok(t.rounds >= 4 && t.showdowns <= t.rounds);
  assert.ok(t.mainSplit <= t.showdowns && t.anySplit >= t.mainSplit);
  assert.equal(t.splitPerShowdown, t.showdowns ? Math.round(t.mainSplit / t.showdowns * 1000) / 10 : 0);
  assert.equal(Object.values(t.splitWays).reduce((a, b) => a + b, 0), t.mainSplit);
  // 同样的参数结果一样
  assert.deepEqual(J(S.run(3, 4, { ctx: c })), J(t));
});
