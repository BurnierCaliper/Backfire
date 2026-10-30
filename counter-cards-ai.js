/* High Flux（#485）· AI：简单 / 普通 / 困难，庄家、玩家两边都能用
 *
 * 只拿 CounterCards.view(对局, 这一方)：看不到对方的手牌、暗出的牌、暗弃的牌；庄家偷看到的天气只有庄家自己知道。
 *   简单：随便出牌，不推理，下注也随机，偶尔会乱弃牌（下注时认输）；玩家方大多直接翻天气，偶尔随手暗弃一张跳过。
 *         筹码不够时随手借（输光了多半会借）。
 *   普通：只看单轮结果——只用最近一轮的结算推理（推出对方那一轮出了什么），不跨轮记牌；下注看自己的牌好不好，偶尔诈唬。
 *         每轮开始筹码不够时，落后或打平就借（借到补上缺口），领先就不借；下注时筹码不够、牌又好到想下注 / 加注才借。
 *   困难：记住整局的结果，排除已经推出来的牌；按胜率下注；按对手的下注习惯调整诈唬（对手常弃牌就多诈唬，对手常诈唬就多跟注），
 *         还会把对手这一轮的加注当成信号；庄家偷看后放回原位，困难的玩家方会认为堆顶多半对庄家有利。
 *         借贷和普通一样，另外先估一下：借了以后剩下几轮全赢还追不追得上，追不上就不借，免得白欠。
 * 玩家方 AI 会决定什么时候翻天气、什么时候暗弃跳过（弃哪张）、要不要用常态清掉天气。
 * 所有阈值都在 AI_CONFIG。
 *
 *   CounterCardsAI.decide(view, "hard", rng)          → 一个操作（交给 CounterCards.act）
 *   CounterCardsAI.step(对局, "dealer", "hard", rng)    → 让这一方做一步（不是它的回合返回 null）
 *   CounterCardsAI.belief(view, "hard")                → 推理出的「对方这一轮出的是哪张」的概率
 */
(function (root) {
  "use strict";
  const CC = () => root.CounterCards;

  const AI_CONFIG = {
    easy: {
      foldChance: 0.08,      // 轮到下注时随手弃牌（乱弃牌）
      betChance: 0.35,       // 没人下注时随手下注
      raiseChance: 0.15,     // 面对下注时随手加注
      maxBetMult: 3,         // 随手下注最多几倍最低额
      peekChance: 0.8,       // 庄家：没有天气时偷看
      discardChance: 0.5,    // 庄家：有天气时弃掉
      revealChance: 0.8,     // 玩家：翻天气（其余随手暗弃一张跳过）
      normalChance: 0.15,    // 玩家：翻到天气后随手用常态
      loanChance: 0.5,       // 筹码不够时随手借（借最少的一份）
      bustLoanChance: 0.9    // 输光了多半会借
    },
    normal: {
      betEdge: 0.3,          // 胜率差（赢 − 输）到这里就下注
      bigEdge: 0.6,          // 到这里下双倍最低额
      raiseEdge: 0.5,        // 面对下注时到这里就加注
      callEdge: -0.15,       // 面对下注时不低于这里就跟
      cheapCall: 0.25,       // 跟注额不超过底池这个比例时照跟
      bluff: 0.12,           // 诈唬的概率
      weatherMargin: 0.05,   // 天气行动：好处超过这么多才动
      skipMargin: 0.4,       // 玩家：留着现在的天气比翻新的好这么多才暗弃跳过
      normalMargin: 0.5,     // 玩家：清掉天气比留着好这么多才用常态
      revealGuess: 0.7,      // 庄家：猜玩家翻天气的概率
      allInWeight: 1,        // 相位全押的分量（普通不特别看待）
      futureWeight: 0,       // 出牌时扣掉这张牌留到以后的价值
      normalKeep: 0.3,       // 留着常态的价值
      elementKeep: 0.15, elementFv: 0.5,  // 留着一张元素牌的价值：基础 + 它平时的期望 × 系数
      loanEdge: 0.4          // 下注时筹码不够：胜率差（赢 − 输）到这里、而且想下注 / 加注才借
    },
    hard: {
      betEdge: 0.2, bigEdge: 0.5, raiseEdge: 0.4, callEdge: -0.1, cheapCall: 0.3,
      bluffBase: 0.06, bluffFold: 0.5, bluffMin: 0.04, bluffMax: 0.35,   // 诈唬率 = 基础 + 系数 × 对手面对下注时的弃牌率
      callBluff: 0.6,        // 对手爱诈唬：跟注门槛放低 系数 × 对手诈唬率
      peekTrust: 1.5,        // 庄家偷看后放回原位：堆顶是「对庄家有利」的天气的权重
      weatherMargin: 0.03, skipMargin: 0.2, normalMargin: 0.25,
      revealGuess: 0.75,     // 庄家：玩家翻天气的先验（之后按玩家这局的习惯修正）
      allInWeight: 2,        // 相位全押的筹码大得多：输赢都按 2 倍看
      futureWeight: 0.35,
      normalKeep: 0.35, elementKeep: 0.15, elementFv: 0.6,
      sizePot: 0.8,          // 下注额 ≈ 最低额 + 底池 × 胜率差 × 这个系数
      loanEdge: 0.3,         // 同普通
      loanGrowth: 2.5        // 借贷：一轮最多能把筹码翻几倍（全押赢差 2 = 2.5 倍），估算借了还追不追得上
    }
  };
  const LEVELS = ["easy", "normal", "hard"];
  const LEVEL_NAMES = { easy: "简单", normal: "普通", hard: "困难" };

  /* ---------- 小工具 ---------- */
  const conf = () => CC().CC_CONFIG;
  const pick = (list, rng) => list[Math.floor(rng() * list.length) % list.length];
  const clampN = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  function normalize(m) {
    const s = Object.values(m).reduce((a, b) => a + b, 0);
    const out = {};
    Object.keys(m).forEach(k => { out[k] = s > 0 ? m[k] / s : 0; });
    return out;
  }
  function uniform(list) { const m = {}; list.forEach(k => { m[k] = (m[k] || 0) + 1; }); return normalize(m); }
  /** 这一方的得分（> 0 对自己有利） */
  function myScore(v, mine, opp, w) {
    return v.side === "player" ? CC().score(mine, opp, w) : -CC().score(opp, mine, w);
  }
  /** 得分 → 筹码上的分量：差 1 = ±1，差 2 = ±1.5，差 3+ = ±2（和分档赔付同比例） */
  function util(s) {
    if (!s) return 0;
    return Math.sign(s) * (1 + (conf().tierExtra[CC().tierOf(s)] || 0));
  }
  const oppUniverse = (v) => (v.side === "player" ? conf().layers.slice() : conf().elements.slice());

  /* ---------- 推理：对方这一轮出的是哪张 ---------- */
  /** 某一轮的结算推出对方那一轮可能出的牌（弃牌的轮次没有摊牌，推不出来） */
  function candidates(v, res) {
    const U = oppUniverse(v);
    const h = (v.me.history || []).find(x => x.r === res.r);
    if (!h || res.outcome === "fold") return U;
    const want = res.outcome === "tie" ? 0 : res.winner === v.side ? 1 : -1;
    return U.filter(o => {
      const s = myScore(v, h.card, o, res.weather);
      if (!want) return s === 0;
      return Math.sign(s) === want && CC().tierOf(s) === res.tier;
    });
  }
  /** 困难：整局的结果一起看，枚举「对方每一轮各出了哪张（不重复）」，没被用掉的牌按出现次数算概率 */
  function beliefHard(v) {
    const U = oppUniverse(v);
    const past = (v.results || []).map(res => candidates(v, res));
    const counts = {}; U.forEach(c => { counts[c] = 0; });
    const used = new Set();
    let total = 0;
    (function rec(i) {
      if (i === past.length) { total++; U.forEach(c => { if (!used.has(c)) counts[c]++; }); return; }
      past[i].forEach(c => { if (used.has(c)) return; used.add(c); rec(i + 1); used.delete(c); });
    })(0);
    return total ? normalize(counts) : uniform(U);
  }
  /** 普通：只看单轮结果（最近一轮的结算），不跨轮记牌——推出来是哪张就排除，推出几张可能的就各减一点 */
  function beliefNormal(v) {
    const U = oppUniverse(v);
    const w = {}; U.forEach(c => { w[c] = 1; });
    const last = (v.results || [])[v.results.length - 1];
    if (last) {
      const cs = candidates(v, last);
      if (cs.length && cs.length < U.length) cs.forEach(c => { w[c] = Math.max(0, 1 - 1 / cs.length); });
    }
    return normalize(w);
  }
  function belief(v, level) {
    if (level === "hard") return beliefHard(v);
    if (level === "normal") return beliefNormal(v);
    return uniform(oppUniverse(v));
  }

  /* ---------- 对手的习惯（困难，只看公开记录） ---------- */
  function oppStats(v) {
    const me = v.side, op = v.opponent;
    let pressured = 0, folded = 0, waiting = false, wr = 0;
    const aggr = {};
    (v.log || []).forEach(e => {
      if (e.t !== "bet") return;
      if (e.r !== wr) { waiting = false; wr = e.r; }
      if (e.by === me) { waiting = e.op === "bet" || e.op === "raise"; return; }
      if (e.by === op) {
        if (waiting) { pressured++; if (e.op === "fold") folded++; }
        waiting = false;
        if (e.op === "bet" || e.op === "raise") aggr[e.r] = true;
      }
    });
    let shown = 0, lost = 0, reveal = 0, chances = 0;
    (v.results || []).forEach(res => {
      if (aggr[res.r] && res.outcome !== "fold") { shown++; if (res.winner === me) lost++; }
    });
    (v.log || []).forEach(e => {
      if (e.by !== "player" || v.side !== "dealer") return;
      if (e.t === "pw" && e.op === "reveal") { reveal++; chances++; }
      if (e.t === "skip") chances++;
    });
    return {
      foldRate: (folded + 1) / (pressured + 3),
      bluffRate: (lost + 1) / (shown + 4),
      revealRate: chances ? (reveal + 2) / (chances + 3) : null
    };
  }
  /** 对手这一轮下过注 / 加过注吗、只过牌跟注吗 */
  function oppActionsThisRound(v) {
    let aggr = 0, passive = 0;
    (v.log || []).forEach(e => {
      if (e.t !== "bet" || e.r !== v.round || e.by !== v.opponent) return;
      if (e.op === "bet" || e.op === "raise") aggr++; else if (e.op === "check" || e.op === "call") passive++;
    });
    return { aggr, passive };
  }

  /* ---------- 天气 ---------- */
  function deckComposition(v) {
    const all = conf().weathers.slice();
    v.gone.concat(v.weather ? [v.weather] : []).forEach(w => { const i = all.indexOf(w); if (i >= 0) all.splice(i, 1); });
    return all;
  }
  /** 庄家最近一次偷看是「放回原位」，而且之后还没人翻过天气：堆顶就是庄家看过、留着的那张 */
  function dealerKeptTop(v) {
    for (let i = (v.log || []).length - 1; i >= 0; i--) {
      const e = v.log[i];
      if (e.t === "pw" && e.op === "reveal") return false;
      if (e.t === "dw" && e.op === "peek" && e.where) return e.where === "top";
    }
    return false;
  }
  /** 这个天气对庄家有多有利（从玩家的角度猜：对方可能的层牌 × 自己手里的元素牌，平均下来比没有天气少得几分） */
  function dealerFavor(ctx, w) {
    const v = ctx.v;
    const mine = v.me.hand.filter(c => conf().elements.indexOf(c) >= 0).concat(v.me.card ? [v.me.card] : []);
    if (!mine.length) return 0;
    let sum = 0;
    Object.keys(ctx.belief).forEach(o => {
      const p = ctx.belief[o];
      if (!p) return;
      let s = 0;
      mine.forEach(m => { s += util(CC().score(m, o, null)) - util(CC().score(m, o, w)); });
      sum += p * s / mine.length;
    });
    return sum;
  }
  /** 天气堆顶是哪张的概率 */
  function topDist(ctx) {
    const v = ctx.v;
    if (!v.deckCount) return null;
    if (v.side === "dealer" && v.deckTop) return { [v.deckTop]: 1 };
    const comp = deckComposition(v);
    if (v.side === "dealer" && v.deckBottom && comp.length > 1) comp.splice(comp.indexOf(v.deckBottom), 1);
    const d = {};
    comp.forEach(w => { d[w] = (d[w] || 0) + 1; });
    if (ctx.level === "hard" && v.side === "player" && dealerKept(ctx)) {
      Object.keys(d).forEach(w => { d[w] *= 1 + ctx.cfg.peekTrust * Math.max(0, dealerFavor(ctx, w)); });
    }
    return normalize(d);
  }
  function dealerKept(ctx) { return dealerKeptTop(ctx.v); }
  const wKey = (w) => w || "none";
  const wVal = (k) => (k === "none" ? null : k);
  /** 结算时的天气：还没到玩家翻天气那一步时，按「翻 / 不翻」混起来 */
  function finalWeather(ctx, pReveal) {
    const v = ctx.v, now = { [wKey(v.weather)]: 1 };
    const before = v.stage === "dealerWeather" || v.stage === "dealerPeek" || v.stage === "play" || v.stage === "bet1";
    if (!before || !v.deckCount) return now;
    const top = topDist(ctx);
    const p = pReveal != null ? pReveal : revealGuess(ctx);
    const out = {};
    Object.keys(top).forEach(w => { out[w] = (out[w] || 0) + p * top[w]; });
    out[wKey(v.weather)] = (out[wKey(v.weather)] || 0) + (1 - p);
    return out;
  }
  function revealGuess(ctx) {
    if (ctx.level !== "hard") return ctx.cfg.revealGuess;
    const r = oppStats(ctx.v).revealRate;
    return r == null ? ctx.cfg.revealGuess : r;
  }

  /* ---------- 期望 ---------- */
  /** 出 mine 这张牌，对方的牌按 bel、天气按 Q（{ 天气: 概率 }）：期望分量、赢 / 输的概率 */
  function evaluate(ctx, mine, Q, bel) {
    const v = ctx.v;
    bel = bel || ctx.belief;
    let ev = 0, win = 0, lose = 0;
    Object.keys(bel).forEach(o => {
      const po = bel[o];
      if (!po) return;
      Object.keys(Q).forEach(k => {
        const pr = po * Q[k];
        if (!pr) return;
        const s = myScore(v, mine, o, wVal(k));
        const weight = k === conf().allInWeather ? ctx.cfg.allInWeight || 1 : 1;
        ev += pr * util(s) * weight;
        if (s > 0) win += pr; else if (s < 0) lose += pr;
      });
    });
    return { ev, win, lose, edge: win - lose };
  }
  /** 一张牌平时（没有天气）对对方可能的牌的期望：留到以后的价值 */
  function futureValue(ctx, card) {
    return evaluate(ctx, card, { none: 1 }, uniform(oppUniverse(ctx.v))).ev;
  }
  /** 玩家：弃掉这张牌的代价 */
  function discardCost(ctx, card) {
    if (card === conf().normal) return ctx.cfg.normalKeep;
    return ctx.cfg.elementKeep + Math.max(0, evaluate(ctx, card, { none: 1 }).ev) * ctx.cfg.elementFv;
  }
  function cheapest(ctx, cards) {
    let best = null, cost = Infinity;
    cards.forEach(c => { const x = discardCost(ctx, c); if (x < cost - 1e-9) { cost = x; best = c; } });
    return { card: best, cost };
  }

  /* ---------- 各步的决定 ---------- */
  function dealerWeather(ctx) {
    const v = ctx.v, ops = ctx.opts.map(o => o.op);
    if (ctx.level === "easy") {
      if (ops.indexOf("discard") >= 0) return { type: "weather", op: ctx.rng() < ctx.cfg.discardChance ? "discard" : "keep" };
      return { type: "weather", op: ctx.rng() < ctx.cfg.peekChance ? "peek" : "pass" };
    }
    if (ops.indexOf("discard") >= 0) {
      const keep = weatherValue(ctx, v.weather), clear = weatherValue(ctx, null);
      return { type: "weather", op: clear > keep + ctx.cfg.weatherMargin ? "discard" : "keep" };
    }
    return { type: "weather", op: ops.indexOf("peek") >= 0 ? "peek" : "pass" };
  }
  /** 庄家：这个天气下自己手里最好的那张牌的期望 */
  function weatherValue(ctx, w) {
    const v = ctx.v;
    const cards = v.me.card ? [v.me.card] : v.me.hand;
    let best = -Infinity;
    cards.forEach(m => { best = Math.max(best, evaluate(ctx, m, { [wKey(w)]: 1 }).ev); });
    if (w === conf().allInWeather) best *= ctx.cfg.allInWeight || 1;
    return best;
  }
  function dealerPlace(ctx) {
    const v = ctx.v;
    if (ctx.level === "easy") return { type: "place", where: ctx.rng() < 0.5 ? "top" : "bottom" };
    const card = v.peek && v.peek.card;
    const rest = deckComposition(v);
    rest.splice(rest.indexOf(card), 1);
    if (!rest.length) return { type: "place", where: "top" };
    const avg = rest.reduce((s, w) => s + weatherValue(ctx, w), 0) / rest.length;
    return { type: "place", where: weatherValue(ctx, card) >= avg - ctx.cfg.weatherMargin ? "top" : "bottom" };
  }
  function playCard(ctx) {
    const v = ctx.v, cards = ctx.opts.map(o => o.card);
    if (ctx.level === "easy") return { type: "play", card: pick(cards, ctx.rng) };
    let best = null, bestVal = -Infinity;
    cards.forEach(m => {
      let val;
      if (ctx.level === "normal") val = evaluate(ctx, m, { [wKey(v.weather)]: 1 }).ev;
      else if (v.side === "player") val = playerOptionValue(ctx, m);
      else val = evaluate(ctx, m, finalWeather(ctx)).ev;
      val -= ctx.cfg.futureWeight * futureValue(ctx, m);
      val += ctx.rng() * 1e-6;                     // 一样好时随便挑一张
      if (val > bestVal) { bestVal = val; best = m; }
    });
    return { type: "play", card: best };
  }
  /** 玩家（困难）：出这张牌之后，翻天气 / 暗弃跳过里更好的那个 */
  function playerOptionValue(ctx, m) {
    const v = ctx.v;
    const keep = evaluate(ctx, m, { [wKey(v.weather)]: 1 }).ev;
    if (!v.deckCount) return keep;
    const rev = evaluate(ctx, m, topDist(ctx)).ev;
    const spare = v.me.hand.filter(c => c !== m && (c === conf().normal || (v.me.spare || 0) >= 1));
    if (!spare.length) return rev;
    return Math.max(rev, keep - cheapest(ctx, spare).cost);
  }
  function bet(ctx) {
    const v = ctx.v, opts = ctx.opts, rng = ctx.rng, cfg = ctx.cfg;
    const has = (t) => opts.find(o => o.type === t);
    const toCall = v.betting ? v.betting.toCall : 0;
    const amount = (o, x) => ({ type: o.type, amount: clampN(Math.round(x), o.min, o.max) });
    if (ctx.level === "easy") {
      if (rng() < cfg.foldChance) return { type: "fold" };
      const lo = has("borrow");
      if (lo && rng() < cfg.loanChance) return { type: "borrow", amount: lo.min };
      if (toCall <= 0) {
        const b = has("bet");
        if (b && rng() < cfg.betChance) return amount(b, b.min + rng() * (Math.min(b.max, b.min * cfg.maxBetMult) - b.min));
        return { type: "check" };
      }
      const r = has("raise");
      if (r && rng() < cfg.raiseChance) return amount(r, r.min + rng() * (Math.min(r.max, r.min * cfg.maxBetMult) - r.min));
      return { type: "call" };
    }
    let bel = ctx.belief;
    let st = null;
    if (ctx.level === "hard") { st = oppStats(v); bel = readOpponent(ctx, bel, st); }
    const Q = v.side === "player" && v.stage === "bet1" && v.deckCount ? playerPlannedWeather(ctx) : finalWeather(ctx);
    const e = evaluate(ctx, v.me.card, Q, bel);
    const lb = loanForBet(ctx, e);
    if (lb) return lb;
    const pot = v.pot;
    const bluffP = ctx.level === "hard" ? clampN(cfg.bluffBase + cfg.bluffFold * st.foldRate, cfg.bluffMin, cfg.bluffMax) : cfg.bluff;
    const size = (o) => (ctx.level === "hard" ? o.min + pot * Math.max(0, e.edge) * cfg.sizePot : o.min * (e.edge >= cfg.bigEdge ? 2 : 1));
    if (toCall <= 0) {
      const b = has("bet");
      if (b && e.edge >= cfg.betEdge) return amount(b, size(b));
      if (b && rng() < bluffP) return amount(b, b.min);
      return { type: "check" };
    }
    const r = has("raise");
    if (r && e.edge >= cfg.raiseEdge) return amount(r, size(r));
    let callEdge = cfg.callEdge;
    if (ctx.level === "hard") callEdge -= cfg.callBluff * st.bluffRate;
    const potOdds = toCall <= pot * cfg.cheapCall;
    if (ctx.level === "hard") {
      // 按胜率算跟注划不划算：赢了拿底池，输了丢掉跟注额（再加上分档的额外赔付，粗略算半个跟注额）
      const evCall = e.win * pot - e.lose * toCall * 1.25;
      if (evCall > 0 || e.edge >= callEdge) return { type: "call" };
    } else if (e.edge >= callEdge || potOdds) return { type: "call" };
    if (r && rng() < bluffP / 2) return amount(r, r.min);
    return { type: "fold" };
  }
  /** 玩家（第一轮下注时）：天气按自己等会儿会怎么选来算 */
  function playerPlannedWeather(ctx) {
    const v = ctx.v, m = v.me.card;
    const keepQ = { [wKey(v.weather)]: 1 }, revQ = topDist(ctx);
    const spare = v.me.hand.filter(c => c === conf().normal || (v.me.spare || 0) >= 1);
    if (!spare.length || ctx.level === "easy") return revQ;
    const keep = evaluate(ctx, m, keepQ).ev - cheapest(ctx, spare).cost, rev = evaluate(ctx, m, revQ).ev;
    return keep > rev + ctx.cfg.skipMargin ? keepQ : revQ;
  }
  /** 困难：对手这一轮的下注当成信号——下注 / 加注说明它手里多半是好牌（扣掉它的诈唬率），只过牌跟注说明多半不怎么样 */
  function readOpponent(ctx, bel, st) {
    const v = ctx.v, act = oppActionsThisRound(v);
    if (!act.aggr && !act.passive) return bel;
    const mine = v.me.hand.filter(c => v.side === "dealer" || conf().elements.indexOf(c) >= 0).concat(v.me.card ? [v.me.card] : []);
    const Q = finalWeather(ctx);
    const out = {};
    Object.keys(bel).forEach(o => {
      if (!bel[o]) { out[o] = 0; return; }
      // 对手拿着 o，猜我可能出的牌：它觉得自己赢面多大
      let sum = 0;
      mine.forEach(x => Object.keys(Q).forEach(k => { sum -= Math.sign(myScore(v, x, o, wVal(k))) * Q[k]; }));
      const oppEdge = clampN(sum / Math.max(1, mine.length), -1, 1);
      const strong = Math.max(0, oppEdge);
      const like = act.aggr ? st.bluffRate + (1 - st.bluffRate) * strong : 1 - 0.4 * strong;
      out[o] = bel[o] * Math.max(0.02, like);
    });
    return normalize(out);
  }
  function playerWeather(ctx) {
    const v = ctx.v, rng = ctx.rng, cfg = ctx.cfg;
    const skips = ctx.opts.filter(o => o.type === "skip").map(o => o.card);
    if (ctx.level === "easy") {
      if (!skips.length || rng() < cfg.revealChance) return { type: "reveal" };
      return { type: "skip", card: pick(skips, rng) };
    }
    if (!skips.length) return { type: "reveal" };
    const m = v.me.card;
    const keep = evaluate(ctx, m, { [wKey(v.weather)]: 1 }).ev;
    let rev;
    const top = topDist(ctx);
    if (ctx.level === "hard" && v.me.hand.indexOf(conf().normal) >= 0 && (v.me.spare || 0) >= 1) {
      // 翻出来不好还能用常态清掉：每种天气取「留着」和「用常态清掉」里好的那个
      const clear = evaluate(ctx, m, { none: 1 }).ev - cfg.normalKeep - cheapest(ctx, v.me.hand.filter(c => conf().elements.indexOf(c) >= 0)).cost;
      rev = Object.keys(top).reduce((s, w) => {
        const here = evaluate(ctx, m, { [w]: 1 }).ev;
        return s + top[w] * (w === conf().allInWeather ? here : Math.max(here, clear));
      }, 0);
    } else rev = evaluate(ctx, m, top).ev;
    const c = cheapest(ctx, skips);
    if (keep - c.cost > rev + cfg.skipMargin) return { type: "skip", card: c.card };
    return { type: "reveal" };
  }
  function playerNormal(ctx) {
    const v = ctx.v, cfg = ctx.cfg;
    const els = ctx.opts.filter(o => o.type === "normal").map(o => o.card);
    if (ctx.level === "easy") {
      if (els.length && ctx.rng() < cfg.normalChance) return { type: "normal", card: pick(els, ctx.rng) };
      return { type: "noNormal" };
    }
    if (!els.length) return { type: "noNormal" };
    const m = v.me.card;
    const now = evaluate(ctx, m, { [wKey(v.weather)]: 1 }).ev, clear = evaluate(ctx, m, { none: 1 }).ev;
    const c = cheapest(ctx, els);
    if (clear - now > cfg.normalKeep + c.cost + cfg.normalMargin) return { type: "normal", card: c.card };
    return { type: "noNormal" };
  }

  /* ---------- 借贷 ---------- */
  /** 现在的身家：手上的 + 滚存底池里自己的一份 + 这一轮已经押下去的 − 欠主持方的 */
  const worth = (s) => (s.chips || 0) + (s.pot || 0) + (s.bet || 0) - (s.owe || 0);
  /** 每轮开始筹码不够：借不借、借多少 */
  function loanAtStart(ctx) {
    const v = ctx.v, cfg = ctx.cfg, o = ctx.opts.find(x => x.type === "borrow");
    if (!o) return { type: "noLoan" };
    const broke = v.me.chips <= 0 && v.me.pot <= 0;
    if (ctx.level === "easy") return ctx.rng() < (broke ? cfg.bustLoanChance : cfg.loanChance) ? { type: "borrow", amount: o.min } : { type: "noLoan" };
    // 普通 / 困难：领先就不借（少付利息；输光了又领先，不借就直接赢）；落后或打平才借，借到补上缺口
    const theirs = v.opp.infinite ? v.me.start : worth(v.opp);
    if (worth(v.me) > theirs) return { type: "noLoan" };
    if (ctx.level === "hard" && !canCatchUp(ctx, o.max)) return { type: "noLoan" };
    return { type: "borrow", amount: o.max };
  }
  /** 困难：借 amount 枚以后，剩下几轮全押都赢（每轮最多翻 loanGrowth 倍、最多赢光桌上的）扣还借款后能不能追平 */
  function canCatchUp(ctx, amount) {
    const v = ctx.v, left = v.rounds - v.round + 1;
    const stack = v.me.chips + v.me.pot + v.me.bet + amount;
    const owe = v.me.owe + CC().repayOf(amount);
    const best = stack * Math.pow(ctx.cfg.loanGrowth, left);
    if (v.opp.infinite) return best - owe >= v.me.start;
    const table = stack + v.opp.chips + v.opp.pot + v.opp.bet;
    const top = Math.min(best, table);
    return top - owe >= table - top - v.opp.owe;
  }
  /** 下注时筹码不够（普通 / 困难）：牌好到想下注 / 加注，而且是自己的筹码在封顶（借了才押得上去）才借，借到补上缺口 */
  function loanForBet(ctx, e) {
    const v = ctx.v, cfg = ctx.cfg, o = ctx.opts.find(x => x.type === "borrow");
    if (!o) return null;
    const toCall = v.betting ? v.betting.toCall : 0;
    const want = e.edge >= Math.max(cfg.loanEdge, toCall > 0 ? cfg.raiseEdge : cfg.betEdge);
    const capped = v.opp.infinite || v.me.chips + v.me.bet < v.opp.chips + v.opp.bet;
    return want && capped ? { type: "borrow", amount: o.max } : null;
  }

  /* ---------- 入口 ---------- */
  function decide(view, level, rng) {
    if (!view || !view.legal || !view.legal.length) return null;
    level = LEVELS.indexOf(level) >= 0 ? level : "normal";
    rng = rng || Math.random;
    const ctx = { v: view, level, rng, cfg: AI_CONFIG[level], opts: view.legal, belief: belief(view, level) };
    let a = null;
    switch (view.stage) {
      case "loan": a = loanAtStart(ctx); break;
      case "dealerWeather": a = dealerWeather(ctx); break;
      case "dealerPeek": a = dealerPlace(ctx); break;
      case "play": a = playCard(ctx); break;
      case "bet1": case "bet2": a = bet(ctx); break;
      case "weather": a = playerWeather(ctx); break;
      case "normal": a = playerNormal(ctx); break;
    }
    // 保险：算出来的不在可选的里面，就随便挑一个合法的
    const ok = a && view.legal.find(o => o.type === a.type && (o.op == null || o.op === a.op) && (o.where == null || o.where === a.where) && (o.card == null || o.card === a.card));
    if (!ok) {
      const o = pick(view.legal, rng);
      a = Object.assign({}, o);
      if (o.type === "bet" || o.type === "raise" || o.type === "borrow") a.amount = o.min;
    }
    return a;
  }
  /** 让 side 这一方（AI）走一步；不是它的回合返回 null */
  function step(g, side, level, rng) {
    if (CC().toAct(g).indexOf(side) < 0) return null;
    const a = decide(CC().view(g, side), level, rng);
    if (a) CC().act(g, side, a);
    return a;
  }
  /** 两边都交给 AI 打到结束（测试 / 模拟用）：levels = { dealer: "hard", player: "easy" } */
  function playOut(g, levels, seed) {
    const rngs = { dealer: CC().makeRng((seed || g.seed) + "|ai-dealer"), player: CC().makeRng((seed || g.seed) + "|ai-player") };
    let guard = 0;
    while (!g.over) {
      const who = CC().toAct(g);
      if (!who.length || ++guard > 1000) throw new Error("AI 对局卡住了：" + g.stage);
      who.forEach(side => { if (!g.over && CC().toAct(g).indexOf(side) >= 0) step(g, side, levels[side], rngs[side]); });
    }
    return g;
  }

  const api = { AI_CONFIG, LEVELS, LEVEL_NAMES, decide, step, playOut, belief, candidates };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CounterCardsAI = api;
})(typeof window !== "undefined" ? window : globalThis);
