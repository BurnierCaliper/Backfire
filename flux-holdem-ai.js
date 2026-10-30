/* Flux Hold'em（#488）· AI：简单 / 普通 / 困难
 * 只拿 FluxHoldem.view(对局, 这名玩家)：看不到别人的手牌、盖下的牌、牌堆的顺序；庄家偷看到的那张只有庄家自己知道。
 * 胜率（equity）：自己这张元素牌在亮牌时能分到底池的期望份额——没翻开的公共层牌按剩下的层牌、没翻开的天气按还没上场的天气逐一枚举，
 *   每个对手盖的牌按「还没见过的元素牌」的张数加权（同分平分也算进去），对手之间当作互不相关。
 *   简单不看牌；普通只扣掉自己手里、用过的牌；困难另外扣掉之前亮牌时公开过的牌，还把对手这一回合的下注 / 加注当成信号。
 *   庄家偷看过天气堆顶：留在顶上的那张就是第 1 张天气，压到堆底的那张（堆里不止一张时）不会是第 1 张。
 *   简单：随手盖牌，下注也随机，偶尔乱弃牌；
 *   普通：盖胜率最高的那张；下注看胜率比「平均份额」（1 ÷ 还在牌局里的人数）高多少，跟注看底池赔率，偶尔诈唬；
 *   困难：同普通，下注额按底池 × 多出来的胜率，对手加注时把自己的胜率往下调。
 *   借贷：每轮开始落后才借（输光了也一样），领先不借；困难先估一下剩下几轮追不追得上。下注时跟不起：胜率够就借到够跟，一般就全押，不然弃牌。
 *   跟注后的追加窗口：马上决定，牌好就加注，不然不动作；窗口里不弃牌（同 High Flux 的 AI）。
 * 所有阈值都在 AI_CONFIG。
 *
 *   FluxHoldemAI.decide(view, "hard", rng)       → 一个操作（交给 FluxHoldem.act）
 *   FluxHoldemAI.step(对局, "p2", "hard", rng)    → 让这名玩家做一步（不是他的回合返回 null）
 *   FluxHoldemAI.playOut(对局, { p1: "hard", p2: "easy", … })   → 都交给 AI 打到结束（测试 / 统计用）
 *   FluxHoldemAI.equity(view, "fire", "hard")    → 这张牌在亮牌时的期望份额 { e, fair, n }
 */
(function (root) {
  "use strict";
  const CC = () => root.CounterCards;
  const X = () => root.FluxHoldem;

  const AI_CONFIG = {
    easy: {
      foldChance: 0.08,      // 轮到下注时随手弃牌
      betChance: 0.3,        // 没人下注时随手下注
      raiseChance: 0.12,     // 面对下注时随手加注
      maxBetMult: 3,         // 随手下注最多几倍最低额
      allInChance: 0.5,      // 跟不起时随手全押（不然弃牌）
      loanChance: 0.4,       // 筹码不够时随手借（借最少的一份）
      bustLoanChance: 0.9,   // 输光了多半会借
      peekKeep: 0.5          // 庄家：偷看后随手留在顶上
    },
    normal: {
      betEdge: 0.15,         // 胜率比平均份额高这么多就下注
      bigEdge: 0.35,         // 高这么多下双倍最低额
      raiseEdge: 0.3,        // 面对下注时高这么多就加注
      callSlack: 0.05,       // 跟注：胜率不低于底池赔率减这么多就跟
      cheapCall: 0.2,        // 跟注额不超过底池这个比例时照跟
      bluff: 0.08,           // 诈唬的概率
      loanEdge: 0.25,        // 跟不起时胜率比平均份额高这么多才借来跟（不然全押或弃牌）
      allInEdge: 0,          // 跟不起时胜率不低于平均份额就全押
      seen: false,           // 记不记之前亮牌公开过的牌
      peekMargin: 0.02       // 庄家：留在顶上比压到堆底好这么多才留
    },
    hard: {
      betEdge: 0.1, bigEdge: 0.3, raiseEdge: 0.25, callSlack: 0.08, cheapCall: 0.25, bluff: 0.1, loanEdge: 0.2, allInEdge: -0.02,
      seen: true, peekMargin: 0.01,
      sizePot: 0.6,          // 下注额 ≈ 最低额 + 底池 × 多出来的胜率 × 这个系数
      aggrRead: 0.12,        // 这一回合别人每下注 / 加注一次，自己的胜率往下调这么多 ÷ 对手人数（人多时一次下注说明不了几个人的牌）
      loanGrowth: 2.2        // 借贷：一轮最多能把筹码翻几倍，估算借了还追不追得上
    }
  };
  const LEVELS = ["easy", "normal", "hard"];

  /* ---------- 小工具 ---------- */
  const conf = () => CC().CC_CONFIG;
  const pick = (list, rng) => list[Math.floor(rng() * list.length) % list.length];
  const clampN = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const memo = {};
  /** 一张元素牌对几张层牌、几张天气叠加的得分（FluxHoldem.handScore，记一下） */
  function hs(el, layers, ws) {
    const k = el + "|" + layers.join(",") + "|" + ws.slice().sort().join(",");
    if (!(k in memo)) memo[k] = X().handScore(el, layers, ws);
    return memo[k];
  }
  /** 组合数 */
  function choose(n, k) { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; }
  /** 还在牌局里（没弃牌、没出局）的对手 */
  const rivals = (v) => v.seats.filter(s => s.id !== v.side && !s.folded && !s.out);

  /* ---------- 牌池：还没见过的牌 ---------- */
  /** 公共层牌堆里可能还有的（2 组 × 5 张，扣掉翻开过的）：{ 层: 张数 } */
  function layerPool(v) {
    const n = {};
    conf().layers.forEach(ly => { n[ly] = X().HOLDEM_CONFIG.layerSets; });
    v.usedLayers.concat(v.layers).forEach(ly => { n[ly] -= 1; });
    Object.keys(n).forEach(ly => { if (n[ly] <= 0) delete n[ly]; });
    return n;
  }
  /** 对手盖的牌可能是哪张（4 组 × 7 种，扣掉自己手里、用过的；困难再扣掉亮牌时公开过的）：{ 元素: 张数 } */
  function elementPool(v, cfg) {
    const n = {};
    conf().elements.forEach(el => { n[el] = X().HOLDEM_CONFIG.elementSets; });
    const mine = v.me.hand.concat(v.me.card ? [v.me.card] : [], (v.me.history || []).filter(h => h.r !== v.round).map(h => h.card));
    mine.forEach(el => { n[el] -= 1; });
    if (cfg.seen) (v.results || []).forEach(r => Object.keys(r.shown || {}).forEach(id => { if (id !== v.side) n[r.shown[id].card] -= 1; }));
    Object.keys(n).forEach(el => { if (n[el] <= 0) delete n[el]; });
    return Object.keys(n).length ? n : (() => { const u = {}; conf().elements.forEach(el => { u[el] = 1; }); return u; })();
  }
  /** 接下来翻的天气可能是哪张：还没上场的（场上的、弃掉的不算；天气堆空了才会洗回弃掉的） */
  function weatherPool(v) {
    const used = v.weathers.concat(v.deckCount > 0 ? v.discards : []);
    const out = conf().weathers.filter(w => used.indexOf(w) < 0);
    return out.length ? out : conf().weathers.filter(w => v.weathers.indexOf(w) < 0);
  }
  /** 还没翻开的层牌、天气的所有可能（带概率）：[{ layers, weathers, p }]。force：{ w1 } 指定第 1 张天气（庄家看估值用） */
  function scenarios(v, force) {
    const lp = layerPool(v), lt = Object.values(lp).reduce((a, b) => a + b, 0);
    const needL = Math.max(0, X().HOLDEM_CONFIG.layersPerRound - v.layers.length);
    // 层牌：不放回地抽 needL 张（按张数加权）
    let lsets = [{ layers: v.layers.slice(), p: 1 }];
    for (let k = 0; k < needL; k++) {
      const next = [];
      lsets.forEach(s => {
        const left = Object.assign({}, lp);
        s.layers.slice(v.layers.length).forEach(ly => { left[ly] -= 1; });
        const tot = lt - (s.layers.length - v.layers.length);
        Object.keys(left).forEach(ly => { if (left[ly] > 0 && tot > 0) next.push({ layers: s.layers.concat([ly]), p: s.p * left[ly] / tot }); });
      });
      lsets = next.length ? next : lsets;
    }
    // 天气：还要翻几张；庄家偷看过的按他知道的算
    const needW = Math.max(0, X().HOLDEM_CONFIG.weathersPerRound - v.weathers.length);
    const pool = weatherPool(v);
    let wsets = [{ ws: v.weathers.slice(), p: 1 }];
    for (let k = 0; k < needW; k++) {
      const next = [];
      wsets.forEach(s => {
        const first = s.ws.length === 0;
        let cands = pool.filter(w => s.ws.indexOf(w) < 0);
        if (first && force && force.w1) cands = [force.w1];
        else if (first && force && force.not) cands = cands.filter(w => w !== force.not);
        else if (first && v.peek && v.peek.where === "top") cands = [v.peek.card];
        else if (first && v.peek && v.peek.where === "bottom" && v.deckCount > 1) cands = cands.filter(w => w !== v.peek.card);
        if (!cands.length) cands = pool.filter(w => s.ws.indexOf(w) < 0);
        cands.forEach(w => next.push({ ws: s.ws.concat([w]), p: s.p / cands.length }));
      });
      wsets = next.length ? next : wsets;
    }
    const out = [];
    lsets.forEach(l => wsets.forEach(w => out.push({ layers: l.layers, weathers: w.ws, p: l.p * w.p })));
    return out;
  }

  /* ---------- 胜率 ---------- */
  /** 出 card 时亮牌能分到底池的期望份额：每种可能里，自己的分对上每个对手（盖的牌按牌池加权）——
   *  n 个对手都比自己低就拿全部，有 j 个同分就分 1 / (j + 1)。fair = 平均份额 1 / (n + 1) */
  function equity(v, card, level, force) {
    const cfg = AI_CONFIG[LEVELS.indexOf(level) >= 0 ? level : "normal"];
    const n = rivals(v).length;
    if (!n) return { e: 1, fair: 1, n: 0 };
    const pool = elementPool(v, cfg), tot = Object.values(pool).reduce((a, b) => a + b, 0);
    let e = 0;
    scenarios(v, force).forEach(sc => {
      const s = hs(card, sc.layers, sc.weathers);
      let lt = 0, eq = 0;
      Object.keys(pool).forEach(el => { const o = hs(el, sc.layers, sc.weathers), q = pool[el] / tot; if (o < s) lt += q; else if (o === s) eq += q; });
      let share = 0;
      for (let j = 0; j <= n; j++) share += choose(n, j) * Math.pow(eq, j) * Math.pow(lt, n - j) / (j + 1);
      e += sc.p * share;
    });
    return { e, fair: 1 / (n + 1), n };
  }

  /* ---------- 各步的决定 ---------- */
  function playCard(ctx) {
    const cards = ctx.opts.filter(o => o.type === "play").map(o => o.card);
    if (ctx.level === "easy") return { type: "play", card: pick(cards, ctx.rng) };
    let best = cards[0], bestV = -Infinity;
    cards.forEach(c => { const x = equity(ctx.v, c, ctx.level).e + ctx.rng() * 1e-6; if (x > bestV) { bestV = x; best = c; } });
    return { type: "play", card: best };
  }
  /** 庄家：偷看到的那张当第 1 张天气，比压到堆底（第 1 张换成别的）好就留在顶上 */
  function place(ctx) {
    const v = ctx.v;
    if (ctx.level === "easy" || !v.peek) return { type: "place", where: ctx.rng() < ctx.cfg.peekKeep ? "top" : "bottom" };
    const best = (force) => Math.max(...v.me.hand.map(c => equity(v, c, ctx.level, force).e));
    const keep = best({ w1: v.peek.card }), away = v.deckCount > 1 ? best({ not: v.peek.card }) : keep;
    return { type: "place", where: keep >= away - ctx.cfg.peekMargin ? "top" : "bottom" };
  }
  /** 身家：手上的 + 这一轮押下去的 − 欠的 */
  const worth = (s) => (s.chips || 0) + (s.bet || 0) - (s.owe || 0);
  function loanAtStart(ctx) {
    const v = ctx.v, cfg = ctx.cfg, o = ctx.opts.find(x => x.type === "borrow");
    if (!o) return { type: "noLoan" };
    const broke = v.me.chips <= 0;
    if (ctx.level === "easy") return ctx.rng() < (broke ? cfg.bustLoanChance : cfg.loanChance) ? { type: "borrow", amount: o.min } : { type: "noLoan" };
    // 领先就不借（少付利息）；落后或打平才借，借到补上缺口
    const top = Math.max(...v.seats.filter(s => s.id !== v.side && !s.out).map(worth));
    if (worth(v.me) > top) return { type: "noLoan" };
    if (ctx.level === "hard") {
      const left = v.rounds - v.round + 1, owe = v.me.owe + CC().repayOf(o.max);
      const best = (v.me.chips + o.max) * Math.pow(cfg.loanGrowth, left);
      if (best - owe < top) return { type: "noLoan" };
    }
    return { type: "borrow", amount: o.max };
  }
  /** 这一回合别人下注 / 加注了几次（困难当信号） */
  function aggression(v) {
    return (v.log || []).filter(e => e.t === "bet" && e.r === v.round && e.by !== v.side && (e.op === "bet" || e.op === "raise")
      && v.betting && e.street === v.betting.street).length;
  }
  function bet(ctx) {
    const v = ctx.v, o = ctx.opts, rng = ctx.rng, cfg = ctx.cfg;
    const has = (t) => o.find(x => x.type === t);
    const toCall = v.betting ? v.betting.toCall : 0;
    const amount = (x, n) => ({ type: x.type, amount: clampN(Math.round(n), x.min, x.max) });
    const lo = has("borrow"), allIn = has("allIn"), call = has("call");
    const short = toCall > 0 && !call;
    if (v.betting && v.betting.window) {
      const r = has("raise");
      if (!r) return { type: "pass" };
      if (ctx.level === "easy") return rng() < cfg.raiseChance ? amount(r, r.min) : { type: "pass" };
      const { edge } = read(ctx);
      if (edge >= cfg.raiseEdge) return amount(r, size(ctx, r, edge));
      return rng() < cfg.bluff / 2 ? amount(r, r.min) : { type: "pass" };
    }
    if (ctx.level === "easy") {
      if (rng() < cfg.foldChance) return { type: "fold" };
      if (short) return allIn && rng() < cfg.allInChance ? { type: "allIn" } : lo && rng() < cfg.loanChance ? { type: "borrow", amount: loanToCall(v, lo) } : { type: "fold" };
      const b = has("bet"), r = has("raise");
      if (toCall <= 0) {
        if (b && rng() < cfg.betChance) return amount(b, b.min + rng() * (Math.min(b.max, b.min * cfg.maxBetMult) - b.min));
        return { type: "check" };
      }
      if (r && rng() < cfg.raiseChance) return amount(r, r.min + rng() * (Math.min(r.max, r.min * cfg.maxBetMult) - r.min));
      return { type: "call" };
    }
    const { e, edge } = read(ctx);
    const pot = v.pot;
    const odds = toCall > 0 ? toCall / (pot + toCall) : 0;
    const worthCall = toCall > 0 && (e >= odds - cfg.callSlack || toCall <= pot * cfg.cheapCall);
    if (short) {
      // 跟不起：胜率够好就借到够跟（借贷不设上限），一般就全押（开边池），不然弃牌
      if (lo && worthCall && edge >= cfg.loanEdge) return { type: "borrow", amount: loanToCall(v, lo) };
      if (allIn && (worthCall || edge >= cfg.allInEdge)) return { type: "allIn" };
      return { type: "fold" };
    }
    const b = has("bet"), r = has("raise");
    if (toCall <= 0) {
      if (b && edge >= cfg.betEdge) return amount(b, size(ctx, b, edge));
      if (r && edge >= cfg.raiseEdge) return amount(r, size(ctx, r, edge));     // 大盲轮到自己：加注
      if ((b || r) && rng() < cfg.bluff) return amount(b || r, (b || r).min);
      return { type: "check" };
    }
    if (r && edge >= cfg.raiseEdge) return amount(r, size(ctx, r, edge));
    if (worthCall) return { type: "call" };
    if (r && rng() < cfg.bluff / 2) return amount(r, r.min);
    return { type: "fold" };
  }
  /** 下注时看牌：自己盖的那张的胜率；困难按这一回合别人的下注 / 加注往下调 */
  function read(ctx) {
    const v = ctx.v, q = equity(v, v.me.card, ctx.level);
    let e = q.e;
    if (ctx.level === "hard") e = Math.max(0, e - ctx.cfg.aggrRead * aggression(v) / Math.max(1, q.n));
    return { e, fair: q.fair, edge: e - q.fair };
  }
  /** 下注额：普通牌很好时双倍最低额；困难按底池 × 多出来的胜率 */
  function size(ctx, o, edge) {
    if (ctx.level === "hard") return o.min + ctx.v.pot * Math.max(0, edge) * ctx.cfg.sizePot;
    return o.min * (edge >= ctx.cfg.bigEdge ? 2 : 1);
  }
  /** 借多少才够跟注：缺口向上取整到一份，夹在这次能借的范围里 */
  function loanToCall(v, o) {
    const gap = Math.max(0, (v.betting ? v.betting.toCall : 0) - v.me.chips);
    return clampN(Math.ceil(gap / o.step) * o.step, o.min, o.max);
  }

  /* ---------- 入口 ---------- */
  function decide(view, level, rng) {
    if (!view || !view.legal || !view.legal.length) return null;
    level = LEVELS.indexOf(level) >= 0 ? level : "normal";
    rng = rng || Math.random;
    const ctx = { v: view, level, rng, cfg: AI_CONFIG[level], opts: view.legal };
    let a = null;
    switch (view.stage) {
      case "loan": a = loanAtStart(ctx); break;
      case "peek": a = place(ctx); break;
      case "play": a = playCard(ctx); break;
      case "bet1": case "bet2": a = bet(ctx); break;
    }
    // 保险：算出来的不在可选的里面，就随便挑一个合法的
    const ok = a && view.legal.find(o => o.type === a.type && (o.where == null || o.where === a.where) && (o.card == null || o.card === a.card));
    if (!ok) {
      const o = pick(view.legal, rng);
      a = Object.assign({}, o);
      if (o.type === "bet" || o.type === "raise" || o.type === "borrow") a.amount = o.min;
    }
    return a;
  }
  function step(g, id, level, rng) {
    if (X().toAct(g).indexOf(id) < 0) return null;
    const a = decide(X().view(g, id), level, rng);
    if (a) X().act(g, id, a);
    return a;
  }
  /** 都交给 AI 打到结束（测试 / 统计用）：levels = { 玩家 id: 难度 } */
  function playOut(g, levels, seed) {
    const rngs = {};
    g.order.forEach(id => { rngs[id] = CC().makeRng((seed || g.seed) + "|ai-" + id); });
    let guard = 0;
    while (!g.over) {
      const who = X().toAct(g);
      if (!who.length || ++guard > 3000) throw new Error("AI 对局卡住了：" + g.stage);
      who.forEach(id => { if (!g.over && X().toAct(g).indexOf(id) >= 0) step(g, id, levels[id], rngs[id]); });
    }
    return g;
  }

  const api = { AI_CONFIG, LEVELS, decide, step, playOut, equity, scenarios };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FluxHoldemAI = api;
})(typeof window !== "undefined" ? window : globalThis);
