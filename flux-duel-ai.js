/* Flux Duel（#488）· AI：简单 / 普通 / 困难
 * 只拿 FluxDuel.view(对局, 这一方)：看不到对方的手牌、暗出的牌、背面朝上的天气。
 *   出牌（一张层牌 + 一张元素牌）：
 *     简单：随手出；
 *     普通：按「自己的元素打对方可能的层、对方可能的元素打自己的层、这一轮可能的天气」算期望，挑最好的一对；
 *           只用最近一轮的结算推理对方那一轮出了什么（不跨轮记牌）；
 *     困难：记整局——不亮牌时按每一轮的胜负、分档推出对方可能用掉了哪些牌（层牌、元素牌各自不重复），亮牌时直接排除；
 *           还给留到以后的牌算价值；下注时把对手这一轮的下注 / 加注当成信号。
 *   借贷、下注、跟注后的追加窗口：和 High Flux 的 AI 用同一套决定（counter-cards-ai.js · decideBet，阈值在它的 AI_CONFIG），
 *     胜率按 Duel 的计分算（自己的分 − 对方的分，Duel 的三档分档）。
 * 这里的阈值都在 AI_CONFIG。
 *
 *   FluxDuelAI.decide(view, "hard", rng)          → 一个操作（交给 FluxDuel.act）
 *   FluxDuelAI.step(对局, "a", "hard", rng)        → 让这一方做一步（不是它的回合返回 null）
 *   FluxDuelAI.playOut(对局, { a: "hard", b: "easy" })   → 两边都交给 AI 打到结束（测试 / 模拟用）
 *   FluxDuelAI.belief(view, "hard")               → 推理出的「对方这一轮出的是哪一对」的概率 { "层|元素": 概率 }
 */
(function (root) {
  "use strict";
  const CC = () => root.CounterCards;
  const D = () => root.FluxDuel;
  const HF = () => root.CounterCardsAI;

  const AI_CONFIG = {
    easy: {},
    normal: {
      futureWeight: 0,       // 出牌时扣掉「这一对留到以后」的价值（普通不看以后）
      allInWeight: 1         // 相位全押的分量（普通不特别看待）
    },
    hard: {
      futureWeight: 0.3,
      allInWeight: 2,        // 相位全押的筹码大得多：输赢都按 2 倍看
      readSoft: 0.4          // 对手这一轮只过牌 / 跟注：它手里是强牌的可能打几折（1 − 这个 × 强度）
    }
  };
  const LEVELS = ["easy", "normal", "hard"];

  /* ---------- 小工具 ---------- */
  const conf = () => CC().CC_CONFIG;
  const pick = (list, rng) => list[Math.floor(rng() * list.length) % list.length];
  const clampN = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const key = (l, e) => l + "|" + e;
  const wVal = (k) => (k === "none" ? null : k);
  function normalize(m) {
    const s = Object.values(m).reduce((a, b) => a + b, 0);
    const out = {};
    Object.keys(m).forEach(k => { out[k] = s > 0 ? m[k] / s : 0; });
    return out;
  }
  const allPairs = () => { const out = []; conf().layers.forEach(l => conf().elements.forEach(e => out.push([l, e]))); return out; };
  function uniformPairs() { const m = {}; allPairs().forEach(([l, e]) => { m[key(l, e)] = 1; }); return normalize(m); }
  // 得分（CounterCards.score）记一下，同一局里反复要算
  const memo = {};
  function sc(el, ly, w) {
    const k = el + "|" + ly + "|" + (w || "none");
    if (!(k in memo)) memo[k] = CC().score(el, ly, w || null);
    return memo[k];
  }
  /** 分差 → 筹码上的分量：差 1 = ±1，差 2 = ±1.5，差 3 及以上 = ±2（和 Duel 的分档赔付同比例） */
  function util(d) {
    if (!d) return 0;
    const T = conf().duel.tierExtra;
    return Math.sign(d) * (1 + (T[CC().tierOf(d, T)] || 0));
  }

  /* ---------- 天气：这一轮翻开了就是它，没翻开按没公开过的天气均匀 ---------- */
  function weatherQ(v) {
    if (v.weather) return { [v.weather]: 1 };
    if (!v.facedown) return { none: 1 };             // 堆翻完了，这一轮没有天气
    const m = {};
    (v.unseen || []).forEach(w => { m[w] = (m[w] || 0) + 1; });
    return Object.keys(m).length ? normalize(m) : { none: 1 };
  }

  /* ---------- 推理：对方这一轮出的是哪一对 ---------- */
  /** 某一轮的结算推出对方那一轮可能出的几对：亮牌了就是那一对；弃牌没有比分，推不出来；不亮牌按胜负、分档筛 */
  function candidates(v, res) {
    const opp = v.opponent, me = v.side;
    if (res.shown && res.shown[opp]) return [[res.shown[opp].layer, res.shown[opp].element]];
    const mine = (v.me.history || []).find(h => h.r === res.r);
    const all = allPairs();
    if (!mine || res.outcome === "fold") return all;
    const want = res.outcome === "tie" ? 0 : res.winner === me ? 1 : -1;
    const T = conf().duel.tierExtra;
    return all.filter(([l, e]) => {
      const d = sc(mine.element, l, res.weather) - sc(e, mine.layer, res.weather);
      if (!want) return d === 0;
      return Math.sign(d) === want && CC().tierOf(d, T) === res.tier;
    });
  }
  /** 困难：整局一起看——每一轮对方出的那一对都在那一轮的候选里，层牌、元素牌各自不重复；
   *  按「用掉了哪几张层牌 / 元素牌」数有几种走法，没用掉的两两配对就是这一轮的候选（几种走法就算几份） */
  function beliefHard(v) {
    const L = conf().layers, E = conf().elements, W = 1 << E.length;
    let states = new Map([[0, 1]]);                  // 用掉的层牌、元素牌（位）→ 走法数
    for (const res of v.results || []) {
      const cands = candidates(v, res), next = new Map();
      states.forEach((ways, k) => {
        const lm = Math.floor(k / W), em = k % W;
        cands.forEach(([l, e]) => {
          const lb = 1 << L.indexOf(l), eb = 1 << E.indexOf(e);
          if ((lm & lb) || (em & eb)) return;
          const nk = (lm | lb) * W + (em | eb);
          next.set(nk, (next.get(nk) || 0) + ways);
        });
      });
      if (!next.size) return uniformPairs();          // 推不通（不该发生）：当什么都不知道
      states = next;
    }
    const out = {};
    states.forEach((ways, k) => {
      const lm = Math.floor(k / W), em = k % W;
      L.forEach((l, i) => {
        if (lm & (1 << i)) return;
        E.forEach((e, j) => { if (!(em & (1 << j))) out[key(l, e)] = (out[key(l, e)] || 0) + ways; });
      });
    });
    return normalize(out);
  }
  /** 普通：只看最近一轮的结算——推出来的那几对里，每张层牌 / 元素牌出现的比例就是它上一轮被用掉的可能，按这个减权重 */
  function beliefNormal(v) {
    const L = conf().layers, E = conf().elements;
    const wl = {}, we = {};
    L.forEach(l => { wl[l] = 1; });
    E.forEach(e => { we[e] = 1; });
    const last = (v.results || [])[(v.results || []).length - 1];
    if (last) {
      const cs = candidates(v, last);
      if (cs.length && cs.length < L.length * E.length) {
        const nl = {}, ne = {};
        cs.forEach(([l, e]) => { nl[l] = (nl[l] || 0) + 1; ne[e] = (ne[e] || 0) + 1; });
        L.forEach(l => { wl[l] = Math.max(0, 1 - (nl[l] || 0) / cs.length); });
        E.forEach(e => { we[e] = Math.max(0, 1 - (ne[e] || 0) / cs.length); });
      }
    }
    const out = {};
    L.forEach(l => E.forEach(e => { out[key(l, e)] = wl[l] * we[e]; }));
    return normalize(out);
  }
  function belief(v, level) {
    if (level === "hard") return beliefHard(v);
    if (level === "normal") return beliefNormal(v);
    return uniformPairs();
  }

  /* ---------- 期望 ---------- */
  /** 出 mine（{ layer, element }），对方的一对按 bel、天气按 Q：期望分量、赢 / 输的概率 */
  function evaluate(v, mine, bel, Q, cfg) {
    let ev = 0, win = 0, lose = 0;
    const phase = conf().allInWeather;
    Object.keys(bel).forEach(k => {
      const p = bel[k];
      if (!p) return;
      const [l, e] = k.split("|");
      Object.keys(Q).forEach(w => {
        const pr = p * Q[w];
        if (!pr) return;
        const d = sc(mine.element, l, wVal(w)) - sc(e, mine.layer, wVal(w));
        ev += pr * util(d) * (w === phase ? cfg.allInWeight || 1 : 1);
        if (d > 0) win += pr; else if (d < 0) lose += pr;
      });
    });
    return { ev, win, lose, edge: win - lose };
  }
  /** 一对牌留到以后的价值：元素牌平时（没有天气）打各种层的平均分量 + 层牌平时挨各种元素打的平均分量（挨得越少越好） */
  function futureValue(layer, element) {
    const L = conf().layers, E = conf().elements;
    let fe = 0, fl = 0;
    L.forEach(l => { fe += util(sc(element, l, null)); });
    E.forEach(e => { fl -= util(sc(e, layer, null)); });
    return fe / L.length + fl / E.length;
  }

  /* ---------- 出牌 ---------- */
  function playPair(ctx) {
    const v = ctx.v, opts = ctx.opts.filter(o => o.type === "play");
    if (ctx.level === "easy") { const o = pick(opts, ctx.rng); return { type: "play", layer: o.layer, element: o.element }; }
    const Q = weatherQ(v);
    let best = opts[0], bestVal = -Infinity;
    opts.forEach(o => {
      let val = evaluate(v, o, ctx.belief, Q, ctx.cfg).ev;
      val -= (ctx.cfg.futureWeight || 0) * futureValue(o.layer, o.element);
      val += ctx.rng() * 1e-6;                       // 一样好时随便挑一对
      if (val > bestVal) { bestVal = val; best = o; }
    });
    return { type: "play", layer: best.layer, element: best.element };
  }

  /* ---------- 下注时的胜率（交给 High Flux 的下注决定） ---------- */
  /** 对手这一轮下过注 / 加过注吗、只过牌跟注吗（同 High Flux 的 AI，记录的格式是同一份下注代码写的） */
  function oppActionsThisRound(v) {
    let aggr = 0, passive = 0;
    (v.log || []).forEach(e => {
      if (e.t !== "bet" || e.r !== v.round || e.by !== v.opponent) return;
      if (e.op === "bet" || e.op === "raise") aggr++; else if (e.op === "check" || e.op === "call") passive++;
    });
    return { aggr, passive };
  }
  /** 困难：对手这一轮的下注当成信号——对手手里是这一对时它觉得自己赢面多大（拿它猜我这一轮可能出的牌算），
   *  下注 / 加注说明多半是强的（扣掉它的诈唬率），只过牌跟注说明多半不怎么样 */
  function readOpponent(v, bel, st, cfg) {
    const act = oppActionsThisRound(v);
    if (!act.aggr && !act.passive) return bel;
    const Q = weatherQ(v);
    const myL = v.me.layers.concat(v.me.layer ? [v.me.layer] : []), myE = v.me.elements.concat(v.me.element ? [v.me.element] : []);
    const n = Math.max(1, myL.length * myE.length);
    const out = {};
    Object.keys(bel).forEach(k => {
      if (!bel[k]) { out[k] = 0; return; }
      const [l, e] = k.split("|");
      let s = 0;
      myL.forEach(ml => myE.forEach(me => Object.keys(Q).forEach(w => { s += Math.sign(sc(e, ml, wVal(w)) - sc(me, l, wVal(w))) * Q[w]; })));
      const strong = Math.max(0, clampN(s / n, -1, 1));
      const like = act.aggr ? st.bluffRate + (1 - st.bluffRate) * strong : 1 - cfg.readSoft * strong;
      out[k] = bel[k] * Math.max(0.02, like);
    });
    return normalize(out);
  }
  /** 给 High Flux 的下注决定用的胜率：自己暗出的那一对，对方的一对按推理（困难再按它这一轮的下注修正），天气按现在知道的 */
  function edgeFor(base) {
    return (ctx, st) => {
      const v = ctx.v;
      const bel = st && base.level === "hard" ? readOpponent(v, base.belief, st, base.cfg) : base.belief;
      return evaluate(v, { layer: v.me.layer, element: v.me.element }, bel, weatherQ(v), base.cfg);
    };
  }

  /* ---------- 入口 ---------- */
  function decide(view, level, rng) {
    if (!view || !view.legal || !view.legal.length) return null;
    level = LEVELS.indexOf(level) >= 0 ? level : "normal";
    rng = rng || Math.random;
    const ctx = { v: view, level, rng, cfg: AI_CONFIG[level], opts: view.legal, belief: belief(view, level) };
    if (view.stage === "play") return playPair(ctx);
    // 借贷、下注、跟注后的追加窗口：和 High Flux 的 AI 同一套决定，胜率按 Duel 算
    return HF().decideBet(view, level, rng, edgeFor(ctx));
  }
  /** 让 side 这一方（AI）走一步；不是它的回合返回 null */
  function step(g, side, level, rng) {
    if (D().toAct(g).indexOf(side) < 0) return null;
    const a = decide(D().view(g, side), level, rng);
    if (a) D().act(g, side, a);
    return a;
  }
  /** 两边都交给 AI 打到结束（测试 / 模拟用）：levels = { a: "hard", b: "easy" } */
  function playOut(g, levels, seed) {
    const rngs = {};
    D().SEATS.forEach(k => { rngs[k] = CC().makeRng((seed || g.seed) + "|ai-" + k); });
    let guard = 0;
    while (!g.over) {
      const who = D().toAct(g);
      if (!who.length || ++guard > 1000) throw new Error("AI 对局卡住了：" + g.stage);
      who.forEach(side => { if (!g.over && D().toAct(g).indexOf(side) >= 0) step(g, side, levels[side], rngs[side]); });
    }
    return g;
  }

  const api = { AI_CONFIG, LEVELS, decide, step, playOut, belief, candidates, evaluate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FluxDuelAI = api;
})(typeof window !== "undefined" ? window : globalThis);
