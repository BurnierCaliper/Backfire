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
for (const f of ["counter-cards.js", "counter-cards-ai.js", "flux-holdem.js", "flux-holdem-ai.js"]) vm.runInContext(read(f), c, { filename: f });
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

test("胜率（期望份额）：在 0–1 之间，平均份额 = 1 ÷ 还在牌局里的人数；好牌比差牌高；胜率差得多时普通、困难（几乎总）盖胜率最高的那张", () => {
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
  for (const level of ["normal", "hard"]) {
    assert.deepEqual(J(AI.decide(v, level, CC.makeRng("p"))), { type: "play", card: "fire" });
    assert.ok(AI.cardOdds(v, level).fire > 0.99, level + "：胜率差得多（#521 起按胜率加权抽签）");
  }
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

test("庄家（普通、困难）偷看到相位（留在顶上第 1 张天气就是它，翻开就全押）：手牌好就留在顶上，手牌差就压到堆底", () => {
  const mk = (hand) => X.newGame({ seed: "偷看相位", players: seatsOf(2), layers: LAYERS.slice(), weathers: ["phase", "heat", "snow", "acid", "thunder", "glow", "sand"],
    hands: { p1: hand, p2: ["physical", "energy", "acid"] }, elements: [] });
  for (const level of ["normal", "hard"]) {
    const strong = X.view(mk(["energy", "electric", "harmonic"]), "p1"), weak = X.view(mk(["ice", "ice", "ice"]), "p1");
    // 能量打肉体的胜率比平均份额（0.5）高得多：留着，翻开就全押
    assert.ok(AI.equity(strong, "energy", level, { w1: "phase" }).e > 0.6);
    assert.deepEqual(J(AI.decide(strong, level, CC.makeRng("k"))), { type: "place", where: "top" }, level);
    // 三张冰都比平均份额差：压到堆底，免得被逼全押
    assert.ok(AI.equity(weak, "ice", level, { w1: "phase" }).e < 0.5);
    assert.deepEqual(J(AI.decide(weak, level, CC.makeRng("k"))), { type: "place", where: "bottom" }, level);
  }
});

test("相位的风险（普通、困难）：后面还可能翻到相位（翻开就全押）、自己的牌又差，被逼全押的期望亏损比留下来能分到的多——能过牌也弃牌；牌好不弃；简单照旧随手", () => {
  const at = (card) => {
    const g = X.newGame({ seed: "风险", players: seatsOf(2), layers: LAYERS.slice(), weathers: ["heat", "phase", "snow", "acid", "thunder", "glow", "sand"],
      hands: { p1: [card, "physical", "energy"], p2: ["harmonic", "ice", "acid"] }, elements: [] });
    A(g, "p1", "place", { where: "top" });
    A(g, "p1", "play", { card }); A(g, "p2", "play", { card: "harmonic" });
    A(g, "p2", "check"); A(g, "p1", "call");
    X.toAct(g).forEach(id => A(g, id, "pass"));
    A(g, "p2", "check");                               // 第二轮：乙过牌，轮到甲；第 2 张天气亮牌时才翻，可能是相位
    return X.view(g, "p1");
  };
  const weak = at("harmonic"), strong = at("fire");
  assert.ok(weak.legal.some(o => o.type === "check"), "能过牌");
  assert.ok(AI.equity(weak, "harmonic", "hard").e < 0.5 && AI.equity(strong, "fire", "hard").e > 0.5);
  for (const level of ["normal", "hard"]) for (let s = 0; s < 4; s++) {
    // 两人都还有 48 枚：翻到相位要各补 48 枚，差牌亏得多，不如现在弃掉（只丢已经押下去的 2 枚）
    assert.equal(AI.decide(weak, level, CC.makeRng("s" + s)).type, "fold", level);
    assert.notEqual(AI.decide(strong, level, CC.makeRng("s" + s)).type, "fold", level);
  }
  // 简单不算这个：随手过牌、下注（偶尔随手弃牌，同以前）
  const easy = [0, 1, 2, 3, 4, 5, 6, 7].map(s => AI.decide(weak, "easy", CC.makeRng("e" + s)).type);
  assert.ok(easy.some(t => t !== "fold"));
});

test("AI 对 AI：开过追加窗口、窗口里加注过，AI 在窗口里从不弃牌；全押、边池、借贷、相位全押、全押同分滚存都出现过，对局不会卡住", () => {
  let windows = 0, windowRaises = 0, allIns = 0, sidePots = 0, loans = 0, phaseAllIns = 0, carried = 0;
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
    phaseAllIns += g.results.filter(r => r.allIn).length;
    carried += g.results.filter(r => r.carry > 0).length;
    assert.equal(g.carry, null, "打完了桌上不留滚存的");
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
  assert.ok(phaseAllIns > 0 && carried > 0, `相位全押 ${phaseAllIns} 轮，同分滚存 ${carried} 轮`);
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

test("统计工具 tools/flux-holdem-stats.js：AI 自对局里平分底池占亮牌的比例、占全部轮数的比例、平分过的局数；相位全押的轮数、其中同分滚存的轮数", () => {
  const S = require("../tools/flux-holdem-stats.js");
  const t = S.run(3, 4, { ctx: c });
  assert.equal(t.games, 4);
  assert.equal(t.players, 3);
  assert.ok(t.rounds >= 4 && t.showdowns <= t.rounds);
  assert.ok(t.mainSplit <= t.showdowns && t.anySplit >= t.mainSplit);
  assert.equal(t.splitPerShowdown, t.showdowns ? Math.round(t.mainSplit / t.showdowns * 1000) / 10 : 0);
  assert.equal(Object.values(t.splitWays).reduce((a, b) => a + b, 0), t.mainSplit);
  assert.ok(t.allIns >= 1 && t.carried <= t.allIns, `相位全押 ${t.allIns} 轮，滚存 ${t.carried} 轮`);
  assert.equal(t.carriedPerAllIn, t.allIns ? Math.round(t.carried / t.allIns * 1000) / 10 : 0);
  // 同样的参数结果一样
  assert.deepEqual(J(S.run(3, 4, { ctx: c })), J(t));
});

/* ---------- 带随机性（#521，同 High Flux 的 AI：按温度加权抽签用 counter-cards-ai.js 的同一份） ---------- */

const tallyOf = (list) => { const m = {}; list.forEach(k => { m[k] = (m[k] || 0) + 1; }); return m; };
/** 第 1 张层牌肉体、庄家（甲）偷看酷暑留在顶上：乙手里是 hand，轮到乙盖牌（乙不知道第 1 张天气） */
function closeView(hand) {
  const g = X.newGame({ seed: "接近", players: seatsOf(2), layers: LAYERS.slice(), weathers: WEATHERS.slice(),
    hands: { p1: ["fire", "ice", "harmonic"], p2: hand }, elements: [] });
  A(g, "p1", "place", { where: "top" });
  return X.view(g, "p2");
}

test("盖牌是混合策略（#521）：胜率接近的几张都会盖——同一个局面换随机数，盖出来的不总是同一张（以前每次都是胜率最高的那张），胜率最高的盖得最多；胜率差得多时几乎总盖最好的；困难的温度比普通低", () => {
  const v = closeView(["fire", "acid", "electric"]);
  const eq = {};
  ["fire", "acid", "electric"].forEach(card => { eq[card] = AI.equity(v, card, "hard").e; });
  assert.ok(Math.max(...Object.values(eq)) - Math.min(...Object.values(eq)) < 0.1, "三张的胜率接近：" + JSON.stringify(eq));
  assert.ok(AI.AI_CONFIG.hard.playTemp > 0 && AI.AI_CONFIG.hard.playTemp < AI.AI_CONFIG.normal.playTemp, "困难温度较低，但不是 0");
  for (const level of ["normal", "hard"]) {
    const seen = tallyOf(Array.from({ length: 200 }, (_, i) => AI.decide(v, level, CC.makeRng("盖" + i)).card));
    const top = Object.keys(seen).sort((a, b) => seen[b] - seen[a])[0];
    assert.ok(Object.keys(seen).length >= (level === "normal" ? 3 : 2), level + "：" + JSON.stringify(seen));
    assert.equal(top, "electric", level + "：胜率最高的盖得最多 " + JSON.stringify(seen));
    const odds = AI.cardOdds(v, level);
    Object.keys(odds).forEach(k => assert.ok(Math.abs((seen[k] || 0) / 200 - odds[k]) < 0.1, `${level} ${k}：抽中 ${seen[k]} 次，概率 ${odds[k]}`));
  }
  assert.ok(AI.cardOdds(v, "hard").electric > AI.cardOdds(v, "normal").electric, "困难更常盖胜率最高的");
  // 胜率差得多（能量打肉体）：几乎总盖能量
  for (const level of ["normal", "hard"]) assert.ok(AI.cardOdds(closeView(["energy", "physical", "ice"]), level).energy > 0.95, level);
  // 简单照旧平均
  Object.values(AI.cardOdds(v, "easy")).forEach(p => assert.ok(Math.abs(p - 1 / 3) < 1e-12));
});

test("AI 自对局（#521）：普通、困难两人局各打 200 局，第 1 轮盖的元素牌里最多的那张不超过 60%、至少 3 种（手牌本来就随机，改之前也满足；同一个局面每次都一样的问题看上一条）", () => {
  for (const level of ["normal", "hard"]) {
    const first = tallyOf(Array.from({ length: 200 }, (_, i) => {
      const g = X.newGame({ seed: `混合-${level}-${i}`, players: seatsOf(2) });
      AI.playOut(g, { p1: level, p2: level });
      return g.sides.p1.history[0].card;
    }));
    assert.ok(Math.max(...Object.values(first)) <= 200 * 0.6 && Object.keys(first).length >= 3, level + "：" + JSON.stringify(first));
  }
});

test("庄家偷看后放哪、下注额也带随机性（#521）：普通、困难自对局的局面里，同一个局面换随机数重新决定，有时不一样；差得多时照样每次选好的那边", () => {
  for (const level of ["normal", "hard"]) {
    const seen = { place: 0, size: 0 }, varied = { place: 0, size: 0 };
    for (let n = 0; n < 16; n++) {
      const g = X.newGame({ seed: `随机性-${level}-${n}`, players: seatsOf(2 + (n % 3)) });
      const levels = {}, rngs = {};
      g.order.forEach(id => { levels[id] = level; rngs[id] = CC.makeRng(id + n); });
      for (let step = 0; !g.over; step++) {
        assert.ok(step < 3000, "卡住了：" + g.stage);
        const id = X.toAct(g)[0], v = X.view(g, id);
        const kind = v.stage === "peek" ? "place" : v.stage === "bet1" || v.stage === "bet2" ? "size" : null;
        if (kind) {
          const acts = Array.from({ length: 12 }, (_, i) => AI.decide(v, level, CC.makeRng(`${n}-${step}-${i}`)));
          const keys = kind === "size" ? acts.filter(a => a.type === "bet" || a.type === "raise").map(a => a.amount) : acts.map(a => a.where);
          if (keys.length) { seen[kind]++; if (new Set(keys).size > 1) varied[kind]++; }
        }
        AI.step(g, id, level, rngs[id]);
      }
    }
    for (const k of ["place", "size"]) assert.ok(varied[k] > 0, `${level} ${k}：${varied[k]} / ${seen[k]} 个局面换随机数决定不一样`);
    assert.ok(varied.place < seen.place, level + "：差得多的局面照样每次选好的那边");
  }
});

test("同一个种子打两次，结果完全一样（#521：随机数只用传进来的 rng）", () => {
  const run = (seed, n, k) => {
    const g = X.newGame({ seed, players: seatsOf(n) });
    const levels = {};
    g.order.forEach((id, i) => { levels[id] = LEVELS[(k + i) % 3]; });
    AI.playOut(g, levels);
    return JSON.stringify([g.log, g.results, g.final]);
  };
  for (const n of [2, 4]) for (let k = 0; k < 3; k++) assert.equal(run(`复现${n}-${k}`, n, k), run(`复现${n}-${k}`, n, k));
});
