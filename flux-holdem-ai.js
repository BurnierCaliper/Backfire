/* Flux Hold'em（#488）· AI：简单 / 普通 / 困难
 * 只拿 FluxHoldem.view(对局, 这名玩家)：看不到别人的手牌、盖下的牌、牌堆的顺序；庄家偷看到的那张只有庄家自己知道。
 * 胜率（equity）：自己这张元素牌在亮牌时能分到底池的期望份额——没翻开的公共层牌按剩下的层牌、没翻开的天气按还没上场的天气逐一枚举，
 *   每个对手盖的牌按「还没见过的元素牌」的张数加权（同分平分也算进去），对手之间当作互不相关。
 *   简单不看牌；普通只扣掉自己手里、用过的牌；困难另外扣掉之前亮牌时公开过的牌，还把对手这一回合的下注 / 加注当成信号。
 *   庄家偷看过天气堆顶：留在顶上的那张就是第 1 张天气，压到堆底的那张（堆里不止一张时）不会是第 1 张。
 *   简单：随手盖牌，下注也随机，偶尔乱弃牌；
 *   普通：盖胜率最高的那张；下注看胜率比「平均份额」（1 ÷ 还在牌局里的人数）高多少，跟注看底池赔率（底池算上滚存的和累积奖池，#534），偶尔诈唬；
 *   困难：同普通，下注额按底池（同样算上累积奖池）× 多出来的胜率，对手加注时把自己的胜率往下调。
 *   最后一轮同分的加赛（#534，只争累积奖池，不下注）：同盖牌——简单随手盖，普通 / 困难按胜率加权抽签；
 *     这时公共层牌、天气全部重洗，胜率按全部 10 张层牌、7 张天气算，对手只算参加加赛的人。
 *   相位（主人 10/30：翻开就全押，上限按没弃牌的人里筹码最少那位）——普通、困难：
 *     庄家偷看到相位：手牌最好那张的胜率比平均份额高够了才留在顶上（翻开就全押），不然压到堆底；
 *     下注时后面还可能翻到相位、自己的牌又比平均份额差：被逼全押的期望亏损（概率 × (自己要补的 − 胜率 × 大家补进来的)）
 *     比留在牌局里能分到的还多，就弃牌（能过牌也弃）。
 *   借贷：每轮开始落后才借（输光了也一样），领先不借；困难先估一下剩下几轮追不追得上。下注时跟不起：胜率够就借到够跟，一般就全押，不然弃牌。
 *   跟注后的追加窗口：马上决定，牌好就加注，不然不动作；窗口里不弃牌（同 High Flux 的 AI）。
 *   带随机性（#521，同 High Flux 的 AI，按温度加权抽签、下注额用 counter-cards-ai.js 的同一份——要先加载它）：
 *     普通 / 困难盖牌不再只盖胜率最高的那张，按胜率加权抽签（playTemp：普通高、困难低但不是 0）；
 *     庄家偷看后留在顶上还是压到堆底按好处两选一（choiceTemp），差不多时两边都会选；下注额普通在双倍的门槛附近两种都下、困难上下浮动。
 *     随机数只用传进来的 rng，同一个种子打出同样的一局。
 * 所有阈值都在 AI_CONFIG。
 *
 *   FluxHoldemAI.decide(view, "hard", rng)       → 一个操作（交给 FluxHoldem.act）
 *   FluxHoldemAI.step(对局, "p2", "hard", rng)    → 让这名玩家做一步（不是他的回合返回 null）
 *   FluxHoldemAI.playOut(对局, { p1: "hard", p2: "easy", … })   → 都交给 AI 打到结束（测试 / 统计用）
 *   FluxHoldemAI.equity(view, "fire", "hard")    → 这张牌在亮牌时的期望份额 { e, fair, n }
 *   FluxHoldemAI.cardOdds(view, "hard")          → 盖牌那一步每张牌会被抽中的概率 { 牌: 概率 }（decide 就按它抽，#521）
 */
(function (root) {
  "use strict";
  const CC = () => root.CounterCards;
  const X = () => root.FluxHoldem;
  const HF = () => root.CounterCardsAI;     // 按温度加权抽签、下注额（#521）用 High Flux 的 AI 的同一份

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
      peekMargin: 0.02,      // 庄家：留在顶上比压到堆底好这么多才留
      phaseKeep: 0.05,       // 庄家偷看到相位：手牌最好那张的胜率比平均份额高这么多才留在顶上（翻开就全押）
      phaseEdge: 0,          // 后面还可能翻到相位时，胜率比平均份额低于这个数才算被逼全押亏不亏（亏得多就弃牌）
      playTemp: 0.05,        // 盖牌按胜率加权抽签的温度（#521，同 High Flux 的 AI；胜率是 0–1 的份额）：越高越随机，0 = 只盖胜率最高的那张
      choiceTemp: 0.03,      // 庄家偷看后留在顶上 / 压到堆底：按好处两选一的温度（#521）——差得不多时两边都会选
      sizeTemp: 0.05         // 下注额的温度（#521）：多出来的胜率在 bigEdge 附近时最低额、双倍都会下
    },
    hard: {
      betEdge: 0.1, bigEdge: 0.3, raiseEdge: 0.25, callSlack: 0.08, cheapCall: 0.25, bluff: 0.1, loanEdge: 0.2, allInEdge: -0.02,
      seen: true, peekMargin: 0.01, phaseKeep: 0.02, phaseEdge: 0,
      sizePot: 0.6,          // 下注额 ≈ 最低额 + 底池 × 多出来的胜率 × 这个系数
      aggrRead: 0.12,        // 这一回合别人每下注 / 加注一次，自己的胜率往下调这么多 ÷ 对手人数（人多时一次下注说明不了几个人的牌）
      loanGrowth: 2.2,       // 借贷：一轮最多能把筹码翻几倍，估算借了还追不追得上
      playTemp: 0.03,        // 盖牌的温度（#521）：比普通低，但不是 0
      choiceTemp: 0.02,      // 两选一的温度（#521）：比普通低
      sizeJitter: 0.25       // 下注额（#521）：按底池算出来的、比最低额多出来的那部分上下浮动 25%
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
  /** 还在牌局里（没弃牌、没出局）的对手；加赛时（#534）是一起加赛的人 */
  const rivals = (v) => v.seats.filter(s => s.id !== v.side && (v.playoff ? v.playoff.ids.indexOf(s.id) >= 0 : !s.folded && !s.out));
  /** 估算底池：桌上的底池（含滚存的）+ 累积奖池（#534：单独拿到最高分就整个拿走） */
  const potOf = (v) => (v.pot || 0) + (v.jackpot || 0);

  /* ---------- 牌池：还没见过的牌 ---------- */
  /** 公共层牌堆里可能还有的（2 组 × 5 张，扣掉翻开过的；加赛时全部重洗，一张都不扣）：{ 层: 张数 } */
  function layerPool(v) {
    const n = {};
    conf().layers.forEach(ly => { n[ly] = X().HOLDEM_CONFIG.layerSets; });
    (v.playoff ? v.layers : v.usedLayers.concat(v.layers)).forEach(ly => { n[ly] -= 1; });
    Object.keys(n).forEach(ly => { if (n[ly] <= 0) delete n[ly]; });
    return n;
  }
  /** 对手盖的牌可能是哪张（4 组 × 7 种，扣掉自己手里、用过的；困难再扣掉亮牌时公开过的）：{ 元素: 张数 } */
  function elementPool(v, cfg) {
    const n = {};
    conf().elements.forEach(el => { n[el] = X().HOLDEM_CONFIG.elementSets; });
    // 用过的：history 里都有（这一轮盖下的那张也在里面；加赛盖的也记在最后一轮下面）
    const mine = v.me.hand.concat((v.me.history || []).map(h => h.card));
    mine.forEach(el => { n[el] -= 1; });
    if (cfg.seen) (v.results || []).forEach(r => Object.keys(r.shown || {}).forEach(id => { if (id !== v.side) n[r.shown[id].card] -= 1; }));
    Object.keys(n).forEach(el => { if (n[el] <= 0) delete n[el]; });
    return Object.keys(n).length ? n : (() => { const u = {}; conf().elements.forEach(el => { u[el] = 1; }); return u; })();
  }
  /** 接下来翻的天气可能是哪张：还没上场的（场上的、弃掉的不算；天气堆空了才会洗回弃掉的；加赛时 7 张全部重洗，view 里 discards 是空的） */
  function weatherPool(v) {
    const used = v.weathers.concat(v.deckCount > 0 ? v.discards : []);
    const out = conf().weathers.filter(w => used.indexOf(w) < 0);
    return out.length ? out : conf().weathers.filter(w => v.weathers.indexOf(w) < 0);
  }
  /** 还没翻开的层牌、天气的所有可能（带概率）：[{ layers, weathers, p }]。force：{ w1 } 指定第 1 张天气（庄家看估值用）。
   *  加赛（#534）翻几张照 HOLDEM_CONFIG.playoff，没有庄家偷看 */
  function scenarios(v, force) {
    const H = X().HOLDEM_CONFIG, per = v.playoff ? H.playoff : { layers: H.layersPerRound, weathers: H.weathersPerRound };
    const lp = layerPool(v), lt = Object.values(lp).reduce((a, b) => a + b, 0);
    const needL = Math.max(0, per.layers - v.layers.length);
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
    const needW = Math.max(0, per.weathers - v.weathers.length);
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
   *  n 个对手都比自己低就拿全部，有 j 个同分就分 1 / (j + 1)。fair = 平均份额 1 / (n + 1)；
   *  phase = 还没翻开的天气里翻出相位的概率（翻开就全押） */
  function equity(v, card, level, force) {
    const cfg = AI_CONFIG[LEVELS.indexOf(level) >= 0 ? level : "normal"];
    const n = rivals(v).length;
    if (!n) return { e: 1, fair: 1, n: 0, phase: 0 };
    const pool = elementPool(v, cfg), tot = Object.values(pool).reduce((a, b) => a + b, 0);
    const ph = conf().allInWeather;
    let e = 0, phase = 0;
    scenarios(v, force).forEach(sc => {
      const s = hs(card, sc.layers, sc.weathers);
      let lt = 0, eq = 0;
      Object.keys(pool).forEach(el => { const o = hs(el, sc.layers, sc.weathers), q = pool[el] / tot; if (o < s) lt += q; else if (o === s) eq += q; });
      let share = 0;
      for (let j = 0; j <= n; j++) share += choose(n, j) * Math.pow(eq, j) * Math.pow(lt, n - j) / (j + 1);
      e += sc.p * share;
      if (sc.weathers.indexOf(ph, v.weathers.length) >= 0) phase += sc.p;
    });
    return { e, fair: 1 / (n + 1), n, phase };
  }
  /** 被逼全押这一下的期望（翻开相位：没弃牌的人全押，上限 = 没弃牌的人里筹码最少那位的全部筹码）：
   *  概率 p ×（胜率 e × 大家补进来的 − 自己要补的），已经押下去的不算；call = 先跟多少（跟完再算）。负数 = 预计要亏 */
  function phaseRisk(v, e, p, call) {
    if (!p) return 0;
    const live = v.seats.filter(s => !s.folded && !s.out);
    const bet = (s) => s.bet + (s.id === v.side ? call : 0);
    const cap = Math.min(...live.map(s => bet(s) + Math.max(0, s.chips - (s.id === v.side ? call : 0))));
    const extra = live.reduce((t, s) => t + Math.max(0, cap - bet(s)), 0);
    return p * (e * extra - Math.max(0, cap - (v.me.bet + call)));
  }

  /* ---------- 各步的决定 ---------- */
  /** 盖牌（#521 改成混合策略，同 High Flux 的 AI）：简单随手盖；普通 / 困难按 playOdds 的概率抽一张——胜率越高越容易盖，但不是 100% */
  function playCard(ctx) {
    const cards = ctx.opts.filter(o => o.type === "play").map(o => o.card);
    if (ctx.level === "easy") return { type: "play", card: pick(cards, ctx.rng) };
    return { type: "play", card: HF().draw(cards, playOdds(ctx, cards), ctx.rng) };
  }
  /** 盖每张牌的概率（#521）：按胜率（期望份额）加权抽签，温度 playTemp */
  function playOdds(ctx, cards) {
    return HF().softOdds(cards.map(c => equity(ctx.v, c, ctx.level).e), ctx.cfg.playTemp);
  }
  /** 庄家：偷看到的那张当第 1 张天气，比压到堆底（第 1 张换成别的）好就留在顶上。
   *  偷看到相位（相位不改得分，留在顶上就是翻开就全押）：手牌最好那张的胜率比平均份额高 phaseKeep 才留。
   *  #521 起两种都按好处两选一（温度 choiceTemp）：差得多几乎总选好的那边，差不多时两边都会选 */
  function place(ctx) {
    const v = ctx.v, choose = (a, b) => ({ type: "place", where: HF().softChoose(a, b, ctx.cfg.choiceTemp, ctx.rng) ? "top" : "bottom" });
    if (ctx.level === "easy" || !v.peek) return { type: "place", where: ctx.rng() < ctx.cfg.peekKeep ? "top" : "bottom" };
    if (v.peek.card === conf().allInWeather && v.deckCount > 1) {
      const qs = v.me.hand.map(c => equity(v, c, ctx.level, { w1: v.peek.card }));
      return choose(Math.max(...qs.map(q => q.e)) - qs[0].fair, ctx.cfg.phaseKeep);
    }
    const best = (force) => Math.max(...v.me.hand.map(c => equity(v, c, ctx.level, force).e));
    const keep = best({ w1: v.peek.card }), away = v.deckCount > 1 ? best({ not: v.peek.card }) : keep;
    return choose(keep + ctx.cfg.peekMargin, away);
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
    const { e, edge, phase } = read(ctx);
    const pot = potOf(v);   // 算上累积奖池（#534）
    const odds = toCall > 0 ? toCall / (pot + toCall) : 0;
    const worthCall = toCall > 0 && (e >= odds - cfg.callSlack || toCall <= pot * cfg.cheapCall);
    if (short) {
      // 跟不起：胜率够好就借到够跟（借贷不设上限），一般就全押（开边池），不然弃牌
      if (lo && worthCall && edge >= cfg.loanEdge) return { type: "borrow", amount: loanToCall(v, lo) };
      if (allIn && (worthCall || edge >= cfg.allInEdge)) return { type: "allIn" };
      return { type: "fold" };
    }
    // 相位的风险：后面还可能翻到相位、牌又比平均份额差——留在牌局里能分到的（跟完、过牌到亮牌）加上被逼全押的期望还是亏，就弃牌（能过牌也弃）
    const call0 = Math.max(0, toCall);
    if (edge < cfg.phaseEdge && e * (pot + call0) - call0 + phaseRisk(v, e, phase, call0) < 0) return { type: "fold" };
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
  /** 下注时看牌：自己盖的那张的胜率；困难按这一回合别人的下注 / 加注往下调。phase = 后面翻出相位的概率 */
  function read(ctx) {
    const v = ctx.v, q = equity(v, v.me.card, ctx.level);
    let e = q.e;
    if (ctx.level === "hard") e = Math.max(0, e - ctx.cfg.aggrRead * aggression(v) / Math.max(1, q.n));
    return { e, fair: q.fair, edge: e - q.fair, phase: q.phase };
  }
  /** 下注额：普通牌很好时双倍最低额；困难按底池（算上累积奖池，#534）× 多出来的胜率。#521 起带随机性（High Flux 的 AI 的同一份 betSize）：
   *  普通在 bigEdge 附近最低额、双倍都会下（sizeTemp），困难多出来的那部分上下浮动 sizeJitter */
  function size(ctx, o, edge) {
    return HF().betSize(o.min, potOf(ctx.v), edge, ctx.level, ctx.cfg, ctx.rng);
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
      case "play": case "playoff": a = playCard(ctx); break;   // 加赛（#534）：同盖牌，胜率按重洗后的牌算（scenarios）
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
  /** 盖牌那一步（含加赛，#534）每张牌会被抽中的概率 { 牌: 概率 }（#521，测试 / 调参用；decide 就按它抽）：简单是平均的；不是盖牌的时候返回 null */
  function cardOdds(view, level) {
    if (!view || (view.stage !== "play" && view.stage !== "playoff") || !view.legal || !view.legal.length) return null;
    level = LEVELS.indexOf(level) >= 0 ? level : "normal";
    const cards = view.legal.filter(o => o.type === "play").map(o => o.card);
    const p = level === "easy" ? cards.map(() => 1 / cards.length) : playOdds({ v: view, level, cfg: AI_CONFIG[level] }, cards);
    const out = {};
    cards.forEach((c, i) => { out[c] = p[i]; });
    return out;
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

  const api = { AI_CONFIG, LEVELS, decide, step, playOut, equity, scenarios, cardOdds };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FluxHoldemAI = api;
})(typeof window !== "undefined" ? window : globalThis);
