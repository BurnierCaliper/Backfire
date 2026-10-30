// Flux Duel（#488）· AI flux-duel-ai.js：三档难度两两对打都能打完一局（每一步合法、筹码守恒）、只按自己能看到的东西做决定、
// 推理（困难记整局、普通只看最近一轮，亮牌时直接排除）、借贷 / 下注 / 追加窗口用 High Flux 的 AI 同一套决定（decideBet）、困难比简单强
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
for (const f of ["counter-cards.js", "counter-cards-ai.js", "flux-duel.js", "flux-duel-ai.js"]) vm.runInContext(read(f), c, { filename: f });
const CC = c.CounterCards;
const D = c.FluxDuel;
const AI = c.FluxDuelAI;
const C = CC.CC_CONFIG;
const J = v => JSON.parse(JSON.stringify(v));
const A = (g, side, type, extra) => D.act(g, side, Object.assign({ type }, extra || {}));
const LEVELS = ["easy", "normal", "hard"];
const DECK = ["heat", "snow", "acid", "thunder", "glow", "sand", "phase"];

function play(g, a, b) {
  A(g, "a", "play", { layer: a[0], element: a[1] });
  A(g, "b", "play", { layer: b[0], element: b[1] });
}
/** 打完一整轮：不借、暗出、能过牌就过牌、追加窗口都放弃 */
function quietRound(g, a, b) {
  const n = g.results.length;
  for (let guard = 0; g.results.length === n && !g.over; guard++) {
    assert.ok(guard < 40);
    const side = D.toAct(g)[0];
    if (g.stage === "loan") A(g, side, "noLoan");
    else if (g.stage === "play") play(g, a, b);
    else { const L = D.legal(g, side); A(g, side, L.some(x => x.type === "check") ? "check" : L.some(x => x.type === "pass") ? "pass" : "call"); }
  }
}
const mass = (bel, f) => Object.keys(bel).filter(k => f(k.split("|"))).reduce((s, k) => s + bel[k], 0);

test("三档难度两两对打都能打完一局：每一步都合法，筹码守恒（算上借的、还的）；打满 5 轮时每人 5 张层牌各出一次、5 张不同的元素牌", () => {
  for (const x of LEVELS) for (const y of LEVELS) {
    for (let n = 0; n < 4; n++) {
      const g = D.newGame({ seed: `${x}-${y}-${n}` });
      AI.playOut(g, { a: x, b: y });
      assert.equal(g.over, true);
      const a = g.sides.a, b = g.sides.b;
      assert.equal(a.chips + b.chips, 100 + a.loan + b.loan - a.owe - b.owe, `${x}/${y}/${n}`);
      assert.ok(g.final);
      if (g.results.length === 5) for (const s of [a, b]) {
        assert.equal(new Set(s.history.map(h => h.layer)).size, 5);
        assert.equal(new Set(s.history.map(h => h.element)).size, 5);
      }
    }
  }
});

test("AI 只按自己能看到的东西做决定：对方暗出的牌不一样、自己看到的一样 → 决定也一样；拿 JSON 化的 view 也能用", () => {
  for (const level of LEVELS) {
    const mk = (oppPair) => {
      const g = D.newGame({ seed: "同视角", deck: DECK });
      play(g, ["flesh", "fire"], oppPair);
      return g;
    };
    const x = mk(["flesh", "ice"]), y = mk(["spirit", "harmonic"]);
    const vx = D.view(x, "a"), vy = D.view(y, "a");
    assert.equal(JSON.stringify(vx), JSON.stringify(vy));
    for (let s = 0; s < 5; s++) {
      assert.deepEqual(J(AI.decide(J(vx), level, CC.makeRng("r" + s))), J(AI.decide(J(vy), level, CC.makeRng("r" + s))), level);
    }
    // 出牌那一步也一样：对方先出了不一样的一对
    const p = D.newGame({ seed: "同视角2", deck: DECK }), q = D.newGame({ seed: "同视角2", deck: DECK });
    A(p, "b", "play", { layer: "armor", element: "fire" });
    A(q, "b", "play", { layer: "sand", element: "energy" });
    assert.equal(JSON.stringify(D.view(p, "a")), JSON.stringify(D.view(q, "a")));
    assert.deepEqual(J(AI.decide(D.view(p, "a"), level, CC.makeRng("p"))), J(AI.decide(D.view(q, "a"), level, CC.makeRng("p"))));
  }
});

test("推理（不亮牌）：按胜负、分档推出对方用掉了哪张——困难记整局，普通只看最近一轮", () => {
  const g = D.newGame({ seed: "推理", deck: DECK });
  // 第 1 轮酷暑：甲出〔肉体〕〔火〕赢了差 3——对方那一对只可能是〔肉体〕配〔冰〕或〔谐波〕
  quietRound(g, ["flesh", "fire"], ["flesh", "ice"]);
  assert.equal(g.results[0].tier, 3);
  const v2 = D.view(g, "a");
  assert.deepEqual(J(AI.candidates(v2, v2.results[0]).map(x => x.join("|")).sort()), ["flesh|harmonic", "flesh|ice"]);
  for (const level of ["normal", "hard"]) {
    const bel = AI.belief(v2, level);
    assert.equal(mass(bel, ([l]) => l === "flesh"), 0, level + "：肉体用掉了");
    assert.ok(mass(bel, ([, e]) => e === "ice") < mass(bel, ([, e]) => e === "fire"), level + "：冰、谐波一半可能用掉了");
  }
  assert.ok(Math.abs(mass(AI.belief(v2, "easy"), ([l]) => l === "flesh") - 0.2) < 1e-9, "简单不推理");
  // 第 2 轮雪天对出一样的牌（打平，推不出肉体）：第 3 轮困难还记着肉体用掉了，普通只看第 2 轮
  quietRound(g, ["armor", "acid"], ["armor", "acid"]);
  const v3 = D.view(g, "a");
  assert.equal(mass(AI.belief(v3, "hard"), ([l]) => l === "flesh"), 0);
  assert.ok(mass(AI.belief(v3, "normal"), ([l]) => l === "flesh") > 0.05);
  const total = Object.values(AI.belief(v3, "hard")).reduce((s, x) => s + x, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test("推理（亮牌开关打开）：对方用过的牌直接排除——困难排除整局的，普通只排除最近一轮的", () => {
  const was = C.duel.reveal;
  try {
    C.duel.reveal = true;
    const g = D.newGame({ seed: "亮牌", deck: DECK });
    quietRound(g, ["flesh", "fire"], ["sand", "electric"]);
    quietRound(g, ["armor", "acid"], ["shield", "physical"]);
    const v = D.view(g, "a");
    const hard = AI.belief(v, "hard"), normal = AI.belief(v, "normal");
    for (const [l, e] of [["sand", "electric"], ["shield", "physical"]]) {
      assert.equal(mass(hard, ([x]) => x === l), 0);
      assert.equal(mass(hard, ([, y]) => y === e), 0);
    }
    assert.equal(mass(normal, ([x]) => x === "shield"), 0, "最近一轮的排除");
    assert.ok(mass(normal, ([x]) => x === "sand") > 0, "普通不跨轮记牌");
    assert.ok(Math.abs(mass(hard, () => true) - 1) < 1e-9);
    assert.equal(Object.keys(hard).filter(k => hard[k] > 0).length, 3 * 5, "剩 3 张层牌 × 5 张元素牌");
  } finally { C.duel.reveal = was; }
});

test("借贷、下注、追加窗口用 High Flux 的 AI 同一套决定（CounterCardsAI.decideBet），只把胜率换成 Duel 的；出牌不经过它", () => {
  const HF = c.CounterCardsAI, orig = HF.decideBet;
  const seen = {};
  try {
    HF.decideBet = function (view, level, rng, edge) {
      seen[view.stage] = (seen[view.stage] || 0) + 1;
      if (view.betting && view.betting.window) seen.window = (seen.window || 0) + 1;
      const e = edge({ v: view }, level === "hard" ? { bluffRate: 0.2, foldRate: 0.3 } : null);
      assert.ok(e.win >= 0 && e.lose >= 0 && e.win + e.lose <= 1 + 1e-9);
      assert.ok(Math.abs(e.edge - (e.win - e.lose)) < 1e-9);
      return orig.apply(this, arguments);
    };
    for (let n = 0; n < 6; n++) AI.playOut(D.newGame({ seed: "reuse" + n, chipsBy: { a: 50, b: 12 } }), { a: "hard", b: "normal" });
  } finally { HF.decideBet = orig; }
  assert.ok(seen.bet1 > 0 && seen.bet2 > 0, "下注回合都走 decideBet");
  assert.ok(seen.loan > 0, "每轮开始借不借也走 decideBet");
  assert.ok(seen.window > 0, "追加窗口也走 decideBet");
  assert.ok(!seen.play, "出牌是 Duel 自己的");
});

test("AI 对 AI：开过追加窗口、窗口里加注过，AI 在窗口里从不弃牌；一个下注回合最多加注 2 次；借贷不会让对局卡住", () => {
  let windows = 0, windowRaises = 0, loans = 0;
  for (let n = 0; n < 12; n++) {
    const g = D.newGame({ seed: "win" + n });
    AI.playOut(g, { a: LEVELS[n % 3], b: LEVELS[(n + 1) % 3] });
    windows += g.log.filter(e => e.t === "window" && e.op === "open").length;
    windowRaises += g.log.filter(e => e.t === "bet" && e.op === "raise" && e.window).length;
    loans += g.sides.a.loan + g.sides.b.loan;
    // 窗口开着的时候没有人弃牌
    let open = false;
    g.log.forEach(e => {
      if (e.t === "window") open = e.op === "open";
      if (e.t === "bet" && e.op === "fold") assert.ok(!open, "窗口里弃牌了：" + e.text);
      if (e.t === "bet" && e.op === "raise") open = false;
      if (e.t === "result") open = false;
    });
    const per = {};
    g.log.filter(e => e.t === "bet" && e.op === "raise").forEach(e => { const k = e.r + ":" + e.street; per[k] = (per[k] || 0) + 1; });
    Object.values(per).forEach(x => assert.ok(x <= C.maxRaises));
  }
  assert.ok(windows > 0);
  assert.ok(windowRaises > 0);
  assert.ok(loans > 0);
});

test("困难比简单强：同样的种子、两边都坐一遍，困难平均赢筹码", () => {
  let net = 0;
  for (let n = 0; n < 12; n++) {
    const g1 = AI.playOut(D.newGame({ seed: "强弱" + n }), { a: "hard", b: "easy" });
    const g2 = AI.playOut(D.newGame({ seed: "强弱" + n }), { a: "easy", b: "hard" });
    net += (g1.final.chips.a - g1.final.chips.b) + (g2.final.chips.b - g2.final.chips.a);
  }
  assert.ok(net > 0, "困难净赢 " + net);
});
