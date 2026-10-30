/* High Flux · 回火里的卡牌小游戏（#485）：规则引擎
 * 游戏名作者 10/29 定为 High Flux（以前暂名「克制卡牌」；中文译名暂不定，界面上直接写 High Flux，在 CC_CONFIG.name）；
 * 代码里的模块名还是 counter-cards / CounterCards。
 *
 * 庄家拿 5 张层牌（每轮必须打出一张，5 轮正好打完）；玩家拿 7 张元素牌 + 1 张常态（每局只能用一次）；
 * 7 张天气牌开局洗混成一堆，抽完就没了，新翻出的天气顶替旧天气。
 * 每轮：
 *   0. 借贷：手上的筹码不够这一轮「底注 + 最低下注额」的一方，先决定向不向主持方借（输光的一方先问，不借这一局就结束）；
 *   1. 双方各下 1 枚底注；
 *   2. 庄家天气行动：场上有天气 → 弃掉 / 保留；场上没有天气 → 偷看堆顶一张，放回原位或放到牌堆底（也可以不动）。玩家看得到庄家做了哪种操作；
 *   3. 双方暗出一张牌；
 *   4. 第一轮下注，玩家先；
 *   5. 玩家必须翻开一张新天气，除非暗弃任意一张手牌跳过（常态也可以弃，弃的牌不公开）；
 *      之后场上有天气（不是相位）时，玩家还可以用常态清除它，代价是暗弃一张元素牌；
 *   6. 第二轮下注，庄家先；本轮翻到相位就不下注，双方直接全押（上限 = 筹码较少一方的全部筹码）；
 *   7. 不亮牌，系统直接判胜负、结算，双方都看不到对方出了什么，只公开胜负、分档和筹码变动。
 * 下注不封顶（#496，主人 10/30）：想押多少押多少，只受自己手上的筹码（含借来的）限制；对方押得比自己手上的还多时跟不起，
 *   要跟就得先借（借到补上缺口），不借只能弃牌。只有相位全押照旧按筹码较少一方的全部筹码封顶。
 * 借贷：轮到自己下注、手上的筹码不够「要跟的 + 最低下注额」时也可以借。3 枚一份，最少借 3 枚，最多借到补上缺口；
 *   每借 3 枚，对局结束时还 4 枚（3→4、6→8），结算时从筹码里扣。借了多少、要还多少是公开的。
 * 对局结束按最终筹码数（扣还借款之后）比胜负，不按相对开局的变化量。
 * 计分直接用游戏里的克制表和天气数值（engine.js · chartMod / weatherDamagePct / matchupKind，和克制表 matchup.js 同一套）：
 *   克制 +1 / 劣势 −1 / 其余 0（微光里能量以外的克制反转）；天气修正每 25% 记 ±1（酸雨里酸、冰以外的元素打装甲另 +25%，记 +1）。
 *   总分 > 0 玩家赢，< 0 庄家赢，= 0 平局。
 * 所有数值都在 CC_CONFIG。规则层不碰网页：界面在 counter-cards-ui.js，AI 在 counter-cards-ai.js（AI 只拿 view(对局, 这一方)）。
 *
 *   const g = CounterCards.newGame({ seed: "A" });
 *   CounterCards.toAct(g)                    → 现在等谁操作：["dealer"] / ["player"] / ["dealer", "player"]（暗出牌时两边都要出）/ []（结束了）
 *   CounterCards.legal(g, "player")          → 这一方现在能做的操作
 *   CounterCards.act(g, "player", { type: "bet", amount: 2 })
 *   CounterCards.act(g, "player", { type: "borrow", amount: 3 })   → 向主持方借 3 枚（筹码不够时才能借）
 *   CounterCards.view(g, "player")           → 这一方能看到的东西（对方的手牌、暗出的牌、暗弃的牌、庄家偷看到的天气都不在里面）
 *   CounterCards.chart(g.weather)            → 克制表（得分）：这个天气下每张元素牌打每张层牌的得分，格式同 matchup.js · matchupChart，
 *                                              牌局中随时能开（counter-cards-ui.js 交给 matchup-ui.js 照平时克制表的样子画）
 *   CounterCards.cardChart("fire", g.weather) → 悬停预览：这张元素牌在这个天气下打五种层各得几分（就是上面克制表里这张牌的一行）
 */
(function (root) {
  "use strict";

  /* ---------- 配置：所有数值都在这里 ---------- */
  const CC_CONFIG = {
    name: "High Flux",                 // 游戏名（作者 10/29 定名）：设置页标题、牌桌标题、规则说明都读这个；标题「本地玩法」的按钮写在 game.html
    rounds: 5,                         // 一局 5 轮：庄家 5 张层牌正好打完
    startChips: 50,                    // 开局筹码，双方一样（作者 10/29 试玩后由 20 改为 50，和 AI 对局也是；赌场按买入额）
    ante: 1,                           // 每轮开始双方各下的底注
    minBet: [1, 2, 3, 4, 5],           // 第 1–5 轮的最低下注额（= 轮数）；加注每次也至少加这么多（筹码不够时可以押上剩下的全部）
    maxRaises: 2,                      // 每个下注回合最多加注 2 次
    // 下注不封顶（#496，主人 10/30）：下注 / 加注只受自己手上的筹码（含借来的）限制，不再按较少一方的筹码封顶；
    // 对方押得比自己手上的还多时要跟就得先借（loan）。相位全押照旧按较少一方的全部筹码封顶（allInWeather）
    pctStep: 0.25,                     // 天气修正每 25% 记 ±1
    // 分档赔付（下标 = 分差）：差 1 赢家拿走底池；差 2 输家再赔自己这一轮下注额 × 0.5。只有这两档：
    // 主人 10/30 删掉了「差 3 及以上 × 1」（单轮分差最多 ±2，打不出来）；万一分差超过 2，按差 2 算
    tierExtra: [0, 0, 0.5],
    extraRound: "floor",               // 额外赔付出现半枚时：floor 向下取整（ceil 向上取整）
    // 借贷：筹码不够时可以向主持方借，unit 枚一份、最少借一份；每借 unit 枚，对局结束时还 repay 枚（3→4、6→8），结算时从筹码里扣。
    // 「不够」= 每轮开始时不够「底注 + 本轮最低下注额」，或者轮到自己下注时不够「要跟的 + 本轮最低下注额」。
    // maxUnits：每次最多借几份；null = 借到补上缺口为止（规则里没写上限）
    loan: { unit: 3, repay: 4, maxUnits: null },
    layers: ["flesh", "armor", "shield", "sand", "spirit"],
    elements: ["fire", "acid", "electric", "ice", "energy", "physical", "harmonic"],
    normal: "normal",                  // 常态：每局一次，代价是暗弃一张元素牌，清除当前天气；不能覆盖相位
    weathers: ["heat", "snow", "acid", "thunder", "glow", "sand", "phase"],
    allInWeather: "phase",             // 翻到这张天气：本轮双方全押，打平各自退回自己下的筹码
    cardNames: {
      flesh: "血肉", armor: "装甲", shield: "护盾", sand: "沙", spirit: "灵体",
      fire: "火", acid: "酸", electric: "电", ice: "冰", energy: "能量", physical: "物理", harmonic: "谐波",
      normal: "常态"
    },
    weatherNames: { heat: "酷暑", snow: "雪天", acid: "酸雨", thunder: "雷鸣", glow: "微光", sand: "沙暴", phase: "相位" },
    sideNames: { dealer: "庄家", player: "玩家" },
    // 克制表（得分，chart()）：牌局中随时能开的完整克制表，matchup-ui.js 照平时克制表的样子画，格子写得分。
    // kinds：格子按得分正负分三种（上色照克制表：正分红、负分蓝、0 灰）；chartKinds：其中克制表那一项（克制 / 被克制 / 普通）
    chart: {
      corner: "元素 \\ 层",
      kinds: { adv: "玩家赢", dis: "庄家赢", neu: "平局" },
      chartKinds: { adv: "克制", dis: "被克制", neu: "普通" }
    },
    // 赌场（预留接口，桌子的数值都是占位）：玩家坐「玩家」一方，用自己的筹码，买入不少于 minBuyIn；庄家筹码无限。
    // rate = 每枚筹码折多少奎支（不同桌子的筹码倍率）；difficulty = 庄家 AI 的难度，跟倍率挂钩
    casino: {
      tables: [
        { id: "alley", name: "后巷小桌", rate: 10, minBuyIn: 20, difficulty: "easy" },
        { id: "hall", name: "大厅", rate: 50, minBuyIn: 30, difficulty: "normal" },
        { id: "vip", name: "贵宾室", rate: 200, minBuyIn: 50, difficulty: "hard" }
      ]
    }
  };

  const SIDES = ["dealer", "player"];
  const other = (side) => (side === "dealer" ? "player" : "dealer");
  const cardName = (c) => CC_CONFIG.cardNames[c] || String(c);
  const weatherName = (w) => (w ? CC_CONFIG.weatherNames[w] || String(w) : "常态");
  const sideName = (s) => CC_CONFIG.sideNames[s] || s;
  const isElement = (c) => CC_CONFIG.elements.indexOf(c) >= 0;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ---------- 计分：直接用游戏里的克制表和天气数值 ---------- */
  function engineReady() {
    return typeof chartMod === "function" && typeof weatherDamagePct === "function" && typeof matchupKind === "function";
  }
  function needEngine() {
    if (!engineReady()) throw new Error(CC_CONFIG.name + " 要先加载 engine.js（克制表、天气数值）");
  }
  /** 克制表这一项：克制 +1 / 劣势 −1 / 其余 0（微光里能量以外的元素反转，engine.js · chartMod） */
  function chartScore(element, layer, weather) {
    needEngine();
    const k = matchupKind(chartMod(element, layer, weather || "none", null, false));
    return k === "adv" ? 1 : k === "dis" ? -1 : 0;
  }
  /** 天气修正：每 25% 记 ±1（engine.js · weatherDamagePct）；酸雨里酸、冰以外的元素打装甲的 +25% 也算在这里（chartMod 的酸雨装甲那一项） */
  function weatherScore(element, layer, weather) {
    needEngine();
    const w = weather || "none";
    const armor = chartMod(element, layer, w, null, w === "acid") - chartMod(element, layer, w, null, false);
    return Math.round((weatherDamagePct(w, element) + armor) / CC_CONFIG.pctStep);
  }
  /** 一张元素牌打一张层牌在这个天气下的得分（> 0 玩家赢，< 0 庄家赢，0 平局）。常态 / 没出牌按 0 */
  function score(element, layer, weather) {
    if (!isElement(element) || CC_CONFIG.layers.indexOf(layer) < 0) return 0;
    return chartScore(element, layer, weather) + weatherScore(element, layer, weather);
  }
  function scoreParts(element, layer, weather) {
    const chart = chartScore(element, layer, weather), w = weatherScore(element, layer, weather);
    return { chart, weather: w, total: chart + w };
  }
  /* ---------- 克制表（得分）：牌局中随时能开，matchup-ui.js 照平时克制表的样子画 ---------- */
  const signed = (n) => (n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0");
  /** 这个天气（null = 没有天气）下每张元素牌打每张层牌的得分，格式和 matchup.js · matchupChart 一样（行 = 元素牌，列 = 层牌），
   *  另带 unit: "score"（格子写得分 +1 / 0 / −1，不写百分比）、legend / corner / tag（图例、左上角、表头标签）。
   *  cells[行][列]：value = 这个天气下的得分，base = 没有天气时的得分，kindId 按得分正负（adv 玩家赢 / dis 庄家赢 / neu 平局），
   *  changed = 天气改了得分，reason = 这一分怎么来的（克制那一项 + 天气修正）。rows 的 pct 都是 0（天气修正算进了格子）。
   *  只用公开的东西（场上的天气、规则本身），谁都能看 */
  function chart(weather) {
    needEngine();
    const C = CC_CONFIG, T = C.chart, w = C.weathers.indexOf(weather) >= 0 ? weather : null, W = weatherName(w);
    const kindOf = (n) => (n > 0 ? "adv" : n < 0 ? "dis" : "neu");
    // 天气修正拆成两项：整行的（weatherDamagePct，这一属性在这个天气里的增减伤）和酸雨打装甲那一项（加起来就是 weatherScore）
    const rowPart = (el) => (w ? Math.round(weatherDamagePct(w, el) / C.pctStep) : 0);
    const inverted = [], kept = [], armor = [];
    const cells = C.elements.map(el => {
      let flips = false;
      const row = C.layers.map(ly => {
        const now = scoreParts(el, ly, w), was = scoreParts(el, ly, null), rp = rowPart(el), ap = now.weather - rp;
        const flip = now.chart !== was.chart;
        if (flip) flips = true;
        if (ap) armor.push({ el, ly, n: ap });
        const reason = [`${T.chartKinds[kindOf(now.chart)]} ${signed(now.chart)}${flip ? `（${W}：克制关系反转）` : ""}`,
          rp ? `${W}：${cardName(el)} ${signed(rp)}` : "", ap ? `${W}：打${cardName(ly)}另 ${signed(ap)}` : ""].filter(Boolean).join("；");
        return { row: el, col: ly, base: was.total, value: now.total, kindId: kindOf(now.total), kind: T.kinds[kindOf(now.total)],
          baseKind: T.kinds[kindOf(was.total)], changed: now.total !== was.total, reason, chart: now.chart, weather: now.weather };
      });
      if (flips) inverted.push(el);
      else if (row.some(x => x.chart)) kept.push(el);
      return row;
    });
    const changed = [];
    cells.forEach(row => row.forEach(x => { if (x.changed) changed.push({ row: x.row, col: x.col }); }));
    const notes = [`得分 = 克制（克制 +1、被克制 −1、普通 0）+ 天气修正（每 ${Math.round(C.pctStep * 100)}% 记 ±1）。正分${sideName("player")}赢，负分${sideName("dealer")}赢，0 平局；分数的绝对值就是分差（定分档）。`];
    if (w) {
      const groups = {};
      C.elements.forEach(el => { const n = rowPart(el); if (n) (groups[signed(n)] = groups[signed(n)] || []).push(cardName(el)); });
      const parts = Object.keys(groups).map(k => `${groups[k].join("、")} ${k}`);
      if (parts.length) notes.push(`${W}天气修正：${parts.join("；")}`);
      if (inverted.length) notes.push(`${W}：克制关系反转${kept.length ? `（${kept.map(cardName).join("、")}除外）` : ""}`);
      const byLayer = {};
      armor.forEach(a => { const k = a.ly + "|" + a.n; (byLayer[k] = byLayer[k] || { ly: a.ly, n: a.n, els: [] }).els.push(cardName(a.el)); });
      Object.keys(byLayer).forEach(k => { const g = byLayer[k]; notes.push(`${W}：${g.els.join("、")}打${cardName(g.ly)}另 ${signed(g.n)}`); });
      if (w === C.allInWeather) notes.push(`${W}：不改得分；翻到${W}的那一轮双方全押（上限是筹码较少一方的全部筹码），打平各自退回`);
    }
    return {
      unit: "score", weather: w || "none", weatherName: W, envX: 1, phaseStep: null, field: null,
      cols: C.layers.map(id => ({ id, name: cardName(id) })),
      rows: C.elements.map(id => ({ id, name: cardName(id), pct: 0, pctBase: 0, pctReason: "" })),
      cells, changed, notes,
      legend: { adv: `${T.kinds.adv}（正分）`, dis: `${T.kinds.dis}（负分）`, neu: `${T.kinds.neu}（0）` },
      corner: T.corner, tag: `${C.name} 得分`
    };
  }
  /** 悬停预览（手里的元素牌，作者 10/29 在 PR #486 的评论）：这张元素牌在这个天气下打每张层牌的得分——就是 chart(天气) 里这张牌的那一行，
   *  同一份数（和计分 score()、克制表一致：克制 + 天气修正，微光反转、酸雨打装甲都在里面）。
   *  cells[层]：layer / name / value（得分）/ kindId（adv 玩家赢 / dis 庄家赢 / neu 平局）/ kind / base（没有天气时的得分）/ changed / reason。
   *  只用这张牌和场上的天气，不碰对方出的牌；不是元素牌（常态、层牌）→ null */
  function cardChart(card, weather) {
    if (!isElement(card)) return null;
    const c = chart(weather), row = c.cells[CC_CONFIG.elements.indexOf(card)];
    return {
      card, name: cardName(card), weather: c.weather, weatherName: c.weatherName,
      cells: row.map(x => ({ layer: x.col, name: cardName(x.col), value: x.value, kindId: x.kindId, kind: x.kind, base: x.base, changed: x.changed, reason: x.reason }))
    };
  }

  /** 分差 → 分档（1 / 2；0 = 平局）：只有两档，分差超过 2 按差 2（tierExtra 的最后一档）算 */
  function tierOf(diff) { return Math.min(Math.abs(Number(diff) || 0), CC_CONFIG.tierExtra.length - 1); }
  /** 输家额外赔出的筹码（不含底池）：自己这一轮的下注额 × 分档倍率，半枚按 extraRound 取整；分档超过 2 也按差 2 */
  function extraOf(tier, loserBet) {
    const x = (CC_CONFIG.tierExtra[tierOf(tier)] || 0) * Math.max(0, Number(loserBet) || 0);
    return CC_CONFIG.extraRound === "ceil" ? Math.ceil(x - 1e-9) : Math.floor(x + 1e-9);
  }
  function minBetOf(round) {
    const t = CC_CONFIG.minBet;
    return t[Math.max(0, Math.min(t.length - 1, (Number(round) || 1) - 1))];
  }

  /* ---------- 种子随机数（只用来洗天气堆） ---------- */
  function hashSeed(s) {
    let h = 2166136261 >>> 0;
    const str = String(s);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function makeRng(seed) {
    let a = hashSeed(seed);
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(list, rng) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* ---------- 开局 ---------- */
  /** opt：seed；chips（双方开局筹码，默认 CC_CONFIG.startChips）/ dealerChips / playerChips；
   *  dealerInfinite（赌场：庄家筹码无限）；deck（测试用：指定天气堆的顺序，第 0 张在堆顶） */
  function newGame(opt) {
    opt = opt || {};
    needEngine();
    const seed = String(opt.seed != null ? opt.seed : Date.now());
    const base = opt.chips != null ? Number(opt.chips) : CC_CONFIG.startChips;
    const chipsOf = (v) => Math.max(0, Math.floor(Number(v != null ? v : base) || 0));
    const deck = opt.deck ? opt.deck.slice() : shuffle(CC_CONFIG.weathers, makeRng(seed + "|weather"));
    deck.forEach(w => { if (CC_CONFIG.weathers.indexOf(w) < 0) throw new Error("没有这张天气牌：" + w); });
    // loan / owe：向主持方借了多少、对局结束时要还多少（公开）
    const side = (hand, chips, infinite) => ({ hand, card: null, chips, start: chips, infinite: !!infinite, bet: 0, pot: 0, st: 0, roundStart: chips, loan: 0, owe: 0, history: [], discards: [] });
    const g = {
      v: 1, seed, rounds: CC_CONFIG.rounds, round: 0, stage: "start", over: false,
      weather: null,             // 场上的天气（null = 没有天气 / 常态）
      deck,                      // 天气堆，第 0 张在堆顶
      gone: [],                  // 离场的天气（被弃掉 / 被顶替 / 被常态清掉），公开
      sides: {
        dealer: side(CC_CONFIG.layers.slice(), opt.dealerInfinite ? 0 : chipsOf(opt.dealerChips), opt.dealerInfinite),
        player: side(CC_CONFIG.elements.concat([CC_CONFIG.normal]), chipsOf(opt.playerChips), false)
      },
      betting: null, allIn: false, revealed: null, peek: null,
      loanAsk: null,             // 每轮开始还没决定借不借的一方（依次问，输光的在前）
      know: { top: null, bottom: null },   // 庄家偷看过、知道位置的天气（只给庄家看）
      normalUsed: false,
      results: [], log: [], final: null
    };
    startRound(g);
    return g;
  }

  /* ---------- 记录：to = 只给这一方看的私人记录 ---------- */
  function note(g, entry) {
    g.log.push(Object.assign({ r: g.round }, entry));
  }

  /* ---------- 筹码 ---------- */
  const behind = (s) => (s.infinite ? Infinity : s.chips);
  function pay(s, n) {
    n = Math.max(0, n);
    s.chips -= n; s.bet += n;
    return n;
  }
  /** 相位全押的上限（这一轮每一方押到多少，含底注）：筹码较少一方的全部筹码。下注不封顶（#496）以后只有相位全押还按它封顶 */
  function cap(g) {
    const d = g.sides.dealer, p = g.sides.player;
    return Math.min(d.bet + behind(d), p.bet + behind(p));
  }
  /** 这一方现在最多还能押多少：自己手上的筹码（含借来的），不再按较少一方的筹码封顶（#496）。
   *  赌场的庄家筹码无限：押到对方这一轮已下的 + 手上的为止（对方不借就跟得上的数目，同以前的封顶） */
  function room(g, side) {
    const me = g.sides[side], op = g.sides[other(side)];
    if (!me.infinite) return me.chips;
    return op.infinite ? 0 : Math.max(0, op.bet + op.chips - me.bet);
  }
  /** 输光了：手上和滚存底池里都没有筹码（手上没了、底池里还有自己的一份，就押着那一份接着打） */
  const busted = (s) => !s.infinite && s.chips <= 0 && s.pot <= 0;

  /* ---------- 借贷：筹码不够时向主持方借，对局结束时扣还 ---------- */
  /** 借 n 枚，对局结束时要还多少：每借 3 枚还 4 枚 */
  function repayOf(n) {
    const L = CC_CONFIG.loan;
    return Math.max(0, Math.ceil(Math.max(0, Number(n) || 0) / L.unit * L.repay - 1e-9));
  }
  /** 这一步「够用」要多少筹码：每轮开始 = 底注 + 本轮最低下注额；轮到自己下注 = 要跟的 + 本轮最低下注额；其余时候不借 */
  function loanNeed(g, side) {
    const mb = minBetOf(g.round);
    if (g.stage === "loan") return CC_CONFIG.ante + mb;
    if (g.stage === "bet1" || g.stage === "bet2") return Math.max(0, g.sides[other(side)].st - g.sides[side].st) + mb;
    return 0;
  }
  /** 现在最多能借多少枚（0 = 不能借）：手上的筹码不够这一步用才能借，一份 3 枚，借到补上缺口为止（缺口向上取整到 3 的倍数） */
  function loanMax(g, side) {
    const s = g.sides[side], L = CC_CONFIG.loan;
    if (s.infinite) return 0;
    const gap = loanNeed(g, side) - s.chips;
    if (gap <= 0) return 0;
    const units = L.maxUnits != null ? L.maxUnits : Math.ceil(gap / L.unit);
    return Math.max(0, Math.floor(units)) * L.unit;
  }
  /** 能借时的操作：借 min–max 枚（step 的倍数）；need = 这一步够用要多少 */
  function loanOption(g, side) {
    const max = loanMax(g, side), u = CC_CONFIG.loan.unit;
    return max > 0 ? { type: "borrow", min: u, max, step: u, need: loanNeed(g, side) } : null;
  }

  function startRound(g) {
    if (g.round >= g.rounds) { finish(g); return; }
    g.round += 1;
    SIDES.forEach(k => { const s = g.sides[k]; s.card = null; s.bet = 0; s.st = 0; s.roundStart = s.chips; });
    g.betting = null; g.allIn = false; g.revealed = null; g.peek = null;
    // 借贷：手上的筹码不够这一轮「底注 + 最低下注额」的一方先决定借不借。
    // 输光的先问——它不借这一局就结束了，免得另一方白借
    g.stage = "loan";
    g.loanAsk = SIDES.filter(k => loanMax(g, k) > 0).sort((a, b) => Number(busted(g.sides[b])) - Number(busted(g.sides[a])));
    if (g.loanAsk.length) {
      note(g, { t: "loanAsk", sides: g.loanAsk.slice(), text: `第 ${g.round} 轮开始前：${g.loanAsk.map(sideName).join("、")}手上的筹码不够这一轮的底注 + 最低下注额（${CC_CONFIG.ante + minBetOf(g.round)} 枚），可以向主持方借。` });
      return;
    }
    beginRound(g);
  }
  /** 借贷问完了（或者不用问）：下底注，进庄家天气行动 */
  function beginRound(g) {
    const d = g.sides.dealer, p = g.sides.player;
    g.loanAsk = null;
    if (busted(d) || busted(p)) { finish(g); return; }
    // 有一方手上已经没有筹码（只剩滚存底池里的那一份）：双方都不下底注。
    // 下注照常（下注不封顶，#496；以前封顶在 0，这一轮不下注、只争底池）：对方下注时，没筹码的一方要跟就得先借
    const ante = Math.max(0, Math.min(CC_CONFIG.ante, behind(d), behind(p)));
    SIDES.forEach(k => pay(g.sides[k], ante));
    note(g, { t: "round", text: ante > 0 ? `第 ${g.round} 轮：双方各下 ${ante} 枚底注（本轮最低下注 ${minBetOf(g.round)} 枚）。`
      : `第 ${g.round} 轮：有一方手上已经没有筹码，这一轮双方都不下底注（本轮最低下注 ${minBetOf(g.round)} 枚，要跟就得借）。` });
    g.stage = "dealerWeather";
    advance(g);
  }

  /* ---------- 现在等谁、能做什么 ---------- */
  function toAct(g) {
    if (g.over) return [];
    switch (g.stage) {
      case "loan": return g.loanAsk && g.loanAsk.length ? [g.loanAsk[0]] : [];
      case "dealerWeather": case "dealerPeek": return ["dealer"];
      case "play": return SIDES.filter(k => !g.sides[k].card);
      case "bet1": case "bet2": return [g.betting.toAct];
      case "weather": case "normal": return ["player"];
      default: return [];
    }
  }
  /** 玩家手里能拿去弃的元素牌还有几张（后面每一轮都还要留一张元素牌出） */
  function spareElements(g) {
    const p = g.sides.player;
    const els = p.hand.filter(isElement).length;
    const need = g.rounds - g.round + (p.card ? 0 : 1);
    return els - need;
  }
  function canDiscard(g, card) {
    const p = g.sides.player;
    if (p.hand.indexOf(card) < 0) return false;
    return card === CC_CONFIG.normal || spareElements(g) >= 1;
  }
  function canNormal(g) {
    const p = g.sides.player;
    return p.hand.indexOf(CC_CONFIG.normal) >= 0 && !!g.weather && g.weather !== CC_CONFIG.allInWeather && spareElements(g) >= 1;
  }
  function legal(g, side) {
    if (toAct(g).indexOf(side) < 0) return [];
    const me = g.sides[side];
    switch (g.stage) {
      case "loan": {
        const lo = loanOption(g, side);
        return (lo ? [lo] : []).concat([{ type: "noLoan" }]);
      }
      case "dealerWeather":
        if (g.weather) return [{ type: "weather", op: "discard" }, { type: "weather", op: "keep" }];
        return g.deck.length ? [{ type: "weather", op: "peek" }, { type: "weather", op: "pass" }] : [];
      case "dealerPeek":
        return [{ type: "place", where: "top" }, { type: "place", where: "bottom" }];
      case "play":
        return me.hand.filter(c => (side === "dealer" ? true : isElement(c))).map(card => ({ type: "play", card }));
      case "bet1": case "bet2": {
        const op = g.sides[other(side)], b = g.betting;
        const toCall = op.st - me.st, rm = room(g, side), mb = minBetOf(g.round);
        const out = [];
        if (toCall <= 0) {
          out.push({ type: "check" });
          if (rm > 0) out.push({ type: "bet", min: Math.min(mb, rm), max: rm });
        } else {
          // 下注不封顶（#496）：对方押得比自己手上的还多，跟不起——要跟就先借（下面的 borrow），不借只能弃牌
          if (rm >= toCall) out.push({ type: "call", amount: toCall });
          if (b.raises < CC_CONFIG.maxRaises && rm > toCall) out.push({ type: "raise", min: Math.min(mb, rm - toCall), max: rm - toCall });
        }
        out.push({ type: "fold" });
        // 手上的筹码不够「要跟的 + 最低下注额」：可以先向主持方借（借完还是自己下注）
        const lo = loanOption(g, side);
        if (lo) out.push(lo);
        return out;
      }
      case "weather": {
        const out = [{ type: "reveal" }];
        uniq(me.hand).filter(c => canDiscard(g, c)).forEach(card => out.push({ type: "skip", card }));
        return out;
      }
      case "normal":
        return uniq(me.hand.filter(isElement)).map(card => ({ type: "normal", card })).concat([{ type: "noNormal" }]);
      default: return [];
    }
  }
  function uniq(a) { return a.filter((x, i) => a.indexOf(x) === i); }

  /* ---------- 操作 ---------- */
  function fail(msg) { throw new Error(msg); }
  function act(g, side, a) {
    if (g.over) fail("这一局已经结束了");
    if (SIDES.indexOf(side) < 0) fail("没有这一方：" + side);
    if (!a || typeof a.type !== "string") fail("操作格式不对");
    const opts = legal(g, side);
    if (!opts.length) fail(`现在不是${sideName(side)}操作的时候`);
    const ok = opts.find(o => o.type === a.type && (o.op == null || o.op === a.op) && (o.where == null || o.where === a.where) && (o.card == null || o.card === a.card));
    if (!ok) fail(`${sideName(side)}现在不能这样做（${a.type}${a.op ? " " + a.op : ""}${a.card ? " " + cardName(a.card) : ""}）`);
    const me = g.sides[side];
    switch (a.type) {
      case "weather": dealerWeather(g, a.op); break;
      case "place": placePeek(g, a.where); break;
      case "play": playCard(g, side, a.card); break;
      case "check": case "bet": case "call": case "raise": case "fold": betAction(g, side, a, ok); break;
      case "reveal": reveal(g); break;
      case "skip": {
        removeCard(me, a.card); me.discards.push({ r: g.round, card: a.card, why: "skip" });
        note(g, { t: "skip", by: "player", text: "玩家暗弃一张手牌，跳过翻天气。" });
        note(g, { t: "skipCard", by: "player", to: "player", card: a.card, text: `你暗弃了〔${cardName(a.card)}〕。` });
        beginNormal(g);
        break;
      }
      case "normal": {
        const w = g.weather;
        removeCard(me, CC_CONFIG.normal); removeCard(me, a.card);
        me.discards.push({ r: g.round, card: a.card, why: "normal" });
        g.normalUsed = true;
        g.gone.push(w); g.weather = null;
        note(g, { t: "normal", by: "player", weather: w, text: `玩家打出常态（暗弃一张元素牌），清除了天气〔${weatherName(w)}〕。` });
        note(g, { t: "normalCard", by: "player", to: "player", card: a.card, text: `你为常态弃掉了〔${cardName(a.card)}〕。` });
        afterWeather(g);
        break;
      }
      case "noNormal": afterWeather(g); break;
      case "borrow": borrow(g, side, a, ok); break;
      case "noLoan": noLoan(g, side); break;
      default: fail("未知操作：" + a.type);
    }
    return g;
  }
  function removeCard(s, card) {
    const i = s.hand.indexOf(card);
    if (i < 0) fail("手里没有这张牌：" + cardName(card));
    s.hand.splice(i, 1);
  }

  /* 0. 借贷：向主持方借（每轮开始时 / 轮到自己下注时，筹码不够才能借），对局结束时扣还 */
  function borrow(g, side, a, opt) {
    const s = g.sides[side], u = CC_CONFIG.loan.unit;
    const n = Math.floor(Number(a.amount));
    if (!Number.isFinite(n) || n < opt.min || n > opt.max || n % u) fail(`借的筹码要是 ${u} 的倍数，在 ${opt.min}–${opt.max} 枚之间`);
    const owe = repayOf(n);
    s.chips += n; s.loan += n; s.owe += owe;
    s.roundStart += n;                 // 借来的不算这一轮的输赢
    note(g, { t: "loan", by: side, amount: n, owe, text: `${sideName(side)}向主持方借了 ${n} 枚筹码（对局结束时还 ${owe} 枚）。` });
    if (g.stage === "loan") nextLoan(g);   // 下注时借完还是自己下注
  }
  function noLoan(g, side) {
    const out = busted(g.sides[side]);
    note(g, { t: "noLoan", by: side, text: out ? `${sideName(side)}输光了，没有向主持方借，对局结束。` : `${sideName(side)}没有向主持方借。` });
    if (out) { finish(g); return; }
    nextLoan(g);
  }
  function nextLoan(g) {
    g.loanAsk.shift();
    if (!g.loanAsk.length) beginRound(g);
  }

  /* 2. 庄家天气行动 */
  function dealerWeather(g, op) {
    if (op === "discard") {
      const w = g.weather;
      g.gone.push(w); g.weather = null;
      note(g, { t: "dw", by: "dealer", op, weather: w, text: `庄家弃掉了场上的天气〔${weatherName(w)}〕。` });
      g.stage = "play";
    } else if (op === "keep") {
      note(g, { t: "dw", by: "dealer", op, weather: g.weather, text: `庄家保留了场上的天气〔${weatherName(g.weather)}〕。` });
      g.stage = "play";
    } else if (op === "peek") {
      g.peek = { card: g.deck[0], where: null };
      g.know.top = g.deck[0];
      if (g.deck.length === 1) g.know.bottom = g.deck[0];
      note(g, { t: "peekCard", by: "dealer", to: "dealer", card: g.deck[0], text: `你偷看到天气堆顶是〔${weatherName(g.deck[0])}〕。` });
      g.stage = "dealerPeek";
    } else {
      note(g, { t: "dw", by: "dealer", op: "pass", text: "庄家没有动天气。" });
      g.stage = "play";
    }
    advance(g);
  }
  function placePeek(g, where) {
    const card = g.deck[0];
    if (where === "bottom" && g.deck.length > 1) {
      g.deck.push(g.deck.shift());
      g.know.bottom = card;
      g.know.top = null;
    }
    g.peek.where = where;
    note(g, { t: "dw", by: "dealer", op: "peek", where, text: where === "bottom" ? "庄家偷看了天气堆顶的一张，放到了牌堆底。" : "庄家偷看了天气堆顶的一张，放回原位。" });
    g.stage = "play";
    advance(g);
  }

  /* 3. 暗出一张牌 */
  function playCard(g, side, card) {
    const me = g.sides[side];
    removeCard(me, card);
    me.card = card;
    me.history.push({ r: g.round, card });
    note(g, { t: "play", by: side, text: `${sideName(side)}暗出了一张牌。` });
    note(g, { t: "myCard", by: side, to: side, card, text: `你暗出了〔${cardName(card)}〕。` });
    if (!g.sides.dealer.card || !g.sides.player.card) return;
    openStreet(g, 1);
  }

  /* 4 / 6. 下注。下注不封顶（#496）：有一方手上押光了也照常下注（以前封顶在 0，整轮跳过）——押光的一方能过牌，对方下注时要跟就得先借 */
  function openStreet(g, street) {
    const first = street === 1 ? "player" : "dealer";
    g.betting = { street, toAct: first, raises: 0, acted: { dealer: false, player: false }, opened: false };
    SIDES.forEach(k => { g.sides[k].st = 0; });
    g.stage = street === 1 ? "bet1" : "bet2";
  }
  function betAction(g, side, a, opt) {
    const me = g.sides[side], op = g.sides[other(side)], b = g.betting;
    const label = sideName(side);
    const amountIn = (lo, hi, v, what) => {
      const n = Math.floor(Number(v));
      if (!Number.isFinite(n) || n < lo || n > hi) fail(`${what}要在 ${lo}–${hi} 枚之间`);
      return n;
    };
    b.acted[side] = true;
    if (a.type === "check") {
      note(g, { t: "bet", by: side, op: "check", street: b.street, text: `${label}过牌。` });
      if (b.acted[other(side)]) { closeStreet(g); return; }
      b.toAct = other(side);
      return;
    }
    if (a.type === "fold") { note(g, { t: "bet", by: side, op: "fold", street: b.street, text: `${label}弃牌。` }); foldOut(g, side); return; }
    if (a.type === "call") {
      const n = pay(me, op.st - me.st); me.st += n;
      note(g, { t: "bet", by: side, op: "call", amount: n, street: b.street, text: `${label}跟注 ${n} 枚。` });
      closeStreet(g);
      return;
    }
    if (a.type === "bet") {
      const n = amountIn(opt.min, opt.max, a.amount, "下注额");
      pay(me, n); me.st += n; b.opened = true;
      note(g, { t: "bet", by: side, op: "bet", amount: n, street: b.street, text: `${label}下注 ${n} 枚。` });
    } else {
      const by = amountIn(opt.min, opt.max, a.amount, "加注额");
      const n = pay(me, op.st - me.st + by); me.st += n; b.raises += 1;
      note(g, { t: "bet", by: side, op: "raise", amount: by, street: b.street, text: `${label}加注 ${by} 枚（这一轮下注合计 ${me.bet} 枚）。` });
    }
    b.toAct = other(side);
  }
  function closeStreet(g) {
    const street = g.betting ? g.betting.street : 1;
    g.betting = null;
    if (street === 1) beginWeather(g); else showdown(g);
  }

  /* 5. 玩家的天气 */
  function beginWeather(g) {
    g.stage = "weather";
    // 天气堆翻完了：没有天气可翻，也就不用弃牌跳过
    if (!g.deck.length) {
      note(g, { t: "pw", by: "player", op: "empty", text: "天气堆已经翻完，这一轮不翻天气。" });
      beginNormal(g);
    }
  }
  function reveal(g) {
    const w = g.deck.shift();
    if (g.weather) g.gone.push(g.weather);
    g.weather = w; g.revealed = w;
    if (g.know.top) g.know.top = null;
    if (g.know.bottom && !g.deck.length) g.know.bottom = null;
    if (g.know.bottom && g.deck.length === 1) g.know.top = g.know.bottom;
    note(g, { t: "pw", by: "player", op: "reveal", weather: w, text: `玩家翻开了新天气〔${weatherName(w)}〕。` });
    if (w === CC_CONFIG.allInWeather) g.allIn = true;
    beginNormal(g);
  }
  function beginNormal(g) {
    g.stage = "normal";
    if (!canNormal(g)) afterWeather(g);
  }
  function afterWeather(g) {
    if (g.allIn) allIn(g); else openStreet(g, 2);
  }

  /* 相位：双方全押，上限是筹码较少一方的全部筹码 */
  function allIn(g) {
    g.stage = "allIn";
    const c = cap(g);
    SIDES.forEach(k => { const s = g.sides[k]; pay(s, c - s.bet); });
    note(g, { t: "allIn", text: `翻到相位：本轮双方全押，各押 ${c} 枚（筹码较少一方的全部筹码）。` });
    showdown(g);
  }

  /** 结算一轮的筹码（纯函数，不改传进来的东西）。
   *  diff：这一轮的得分（> 0 玩家赢，< 0 庄家赢，0 平局）；
   *  s：{ dealer: { bet, pot, chips, infinite }, player: {…} }——bet 是这一轮下的（含底注），pot 是自己在滚存底池里的那一份；
   *  o：{ allIn: 相位轮, last: 最后一轮 }。
   *  赢：赢家拿走整个底池（双方滚存的 + 这一轮下的），输家再按分档额外赔出自己这一轮下注额的 0 倍（差 1）/ 0.5 倍（差 2，分差超过 2 也按差 2）
   *  （最多赔光剩下的筹码）；
   *  平：相位轮、最后一轮各自拿回自己下的筹码（含滚存的那一份），其余滚存到下一轮。 */
  function settle(diff, s, o) {
    o = o || {};
    const d = s.dealer, p = s.player;
    const winner = diff > 0 ? "player" : diff < 0 ? "dealer" : null;
    const tier = tierOf(diff);
    const after = { dealer: { chips: d.chips, pot: d.pot }, player: { chips: p.chips, pot: p.pot } };
    const out = { winner, tier, extra: 0, pot: 0, refund: false, rollover: false, after };
    if (winner) {
      const loser = other(winner), l = s[loser];
      out.pot = d.pot + p.pot + d.bet + p.bet;
      after[winner].chips += out.pot;
      let extra = extraOf(tier, l.bet);
      if (!l.infinite) extra = Math.min(extra, Math.max(0, l.chips));
      after[loser].chips -= extra; after[winner].chips += extra;
      out.extra = extra;
      after.dealer.pot = 0; after.player.pot = 0;
    } else if (o.allIn || o.last) {
      out.refund = true;
      SIDES.forEach(k => { after[k].chips += s[k].pot + s[k].bet; after[k].pot = 0; });
    } else {
      out.rollover = true;
      SIDES.forEach(k => { after[k].pot += s[k].bet; });
      out.pot = after.dealer.pot + after.player.pot;
    }
    return out;
  }

  /* 7. 不亮牌，直接判胜负、结算 */
  function showdown(g) {
    const d = g.sides.dealer, p = g.sides.player;
    const pick = (x) => ({ bet: x.bet, pot: x.pot, chips: x.chips, infinite: x.infinite });
    const out = settle(score(p.card, d.card, g.weather), { dealer: pick(d), player: pick(p) }, { allIn: g.allIn, last: g.round >= g.rounds });
    SIDES.forEach(k => { g.sides[k].chips = out.after[k].chips; g.sides[k].pot = out.after[k].pot; });
    const res = { r: g.round, weather: g.weather, allIn: g.allIn, outcome: out.winner || "tie", winner: out.winner, tier: out.tier, extra: out.extra, pot: out.pot, bets: { dealer: d.bet, player: p.bet } };
    if (out.refund) res.refund = true;
    if (out.rollover) res.rollover = true;
    closeRound(g, res);
  }
  /** 弃牌：立即判负，输掉自己已下的筹码（包括自己在滚存底池里的那一份），对方拿走整个底池 */
  function foldOut(g, side) {
    const d = g.sides.dealer, p = g.sides.player, w = g.sides[other(side)];
    const potAll = d.pot + p.pot + d.bet + p.bet;
    w.chips += potAll;
    d.pot = 0; p.pot = 0;
    closeRound(g, { r: g.round, weather: g.weather, allIn: false, outcome: "fold", folded: side, winner: other(side), tier: 0, extra: 0, pot: potAll, bets: { dealer: d.bet, player: p.bet } });
  }
  function closeRound(g, res) {
    const d = g.sides.dealer, p = g.sides.player;
    res.delta = { dealer: d.chips - d.roundStart, player: p.chips - p.roundStart };
    res.chips = { dealer: d.infinite ? null : d.chips, player: p.chips };
    SIDES.forEach(k => { g.sides[k].bet = 0; g.sides[k].st = 0; });
    g.betting = null;
    g.results.push(res);
    note(g, { t: "result", res: clone(res), text: resultText(res) });
    g.stage = "settled";
    startRound(g);
  }
  /** 结算的公开说明：只说胜负、分档和筹码变动 */
  function resultText(res) {
    const delta = (k) => { const v = res.delta[k]; return `${sideName(k)} ${v > 0 ? "+" : ""}${v}`; };
    const chips = `（筹码变动：${delta("player")}，${delta("dealer")}）`;
    if (res.outcome === "fold") return `第 ${res.r} 轮：${sideName(res.folded)}弃牌，${sideName(res.winner)}拿走底池 ${res.pot} 枚${chips}。`;
    if (res.outcome === "tie") {
      if (res.refund) return `第 ${res.r} 轮：平局，${res.allIn ? "相位轮" : "最后一轮"}打平，各自拿回自己下的筹码${chips}。`;
      return `第 ${res.r} 轮：平局，底池 ${res.pot} 枚滚存到下一轮${chips}。`;
    }
    const extra = res.extra ? `，输家再赔 ${res.extra} 枚` : "";
    return `第 ${res.r} 轮：${sideName(res.winner)}赢（差 ${res.tier}${res.allIn ? "，相位全押" : ""}），拿走底池 ${res.pot} 枚${extra}${chips}。`;
  }
  function finish(g) {
    g.over = true; g.stage = "over"; g.betting = null; g.loanAsk = null;
    const d = g.sides.dealer, p = g.sides.player;
    // 还留在滚存底池里的（正常不会有：最后一轮打平已经退回），各自拿回
    SIDES.forEach(k => { const s = g.sides[k]; s.chips += s.pot; s.pot = 0; });
    const out = SIDES.filter(k => busted(g.sides[k]));
    // 借贷：对局结束时从筹码里扣还（每借 3 枚还 4 枚）；还不上的部分记成负数，就是欠主持方的
    const held = {};
    SIDES.forEach(k => { const s = g.sides[k]; held[k] = s.chips; s.chips -= s.owe; });
    // 胜负按最终筹码数（扣还借款之后）比，不按相对开局的变化量；
    // 赌场的庄家筹码无限，没有筹码数可比：玩家扣还借款后比买入多算玩家赢、少算庄家赢
    const diff = d.infinite ? p.chips - p.start : p.chips - d.chips;
    const winner = diff > 0 ? "player" : diff < 0 ? "dealer" : null;
    const net = { dealer: d.chips - d.start, player: p.chips - p.start };
    const nul = (k, v) => (g.sides[k].infinite ? null : v);
    g.final = {
      rounds: g.results.length, winner, net,
      chips: { dealer: nul("dealer", d.chips), player: p.chips },        // 最终筹码（扣还借款之后，可能是负数）
      held: { dealer: nul("dealer", held.dealer), player: held.player },  // 扣还借款之前手上的
      loans: { dealer: { loan: d.loan, owe: d.owe }, player: { loan: p.loan, owe: p.owe } },
      busted: out
    };
    const tail = winner ? `${sideName(winner)}赢` : "平手";
    const repaid = (s) => (s.owe ? `（已扣还借款 ${s.owe} 枚）` : "");
    note(g, { t: "over", text: d.infinite
      ? `对局结束：玩家 ${p.chips} 枚${repaid(p)}，买入 ${p.start} 枚——${tail}。`
      : `对局结束：玩家 ${p.chips} 枚${repaid(p)}，庄家 ${d.chips} 枚${repaid(d)}——按最终筹码数，${tail}。` });
  }

  /* 没有操作可选的步骤自己往下走 */
  function advance(g) {
    if (g.over) return;
    if (g.stage === "dealerWeather" && !legal(g, "dealer").length) {
      note(g, { t: "dw", by: "dealer", op: "none", text: "场上没有天气、天气堆也翻完了，庄家这一轮没有天气行动。" });
      g.stage = "play";
    }
  }

  /* ---------- 这一方能看到的东西 ---------- */
  function view(g, side) {
    if (SIDES.indexOf(side) < 0) fail("没有这一方：" + side);
    const me = g.sides[side], op = g.sides[other(side)];
    // loan / owe：向主持方借了多少、要还多少，公开
    const pub = (s) => ({ chips: s.infinite ? null : s.chips, infinite: s.infinite, start: s.infinite ? null : s.start, bet: s.bet, pot: s.pot, st: s.st, loan: s.loan, owe: s.owe });
    const b = g.betting;
    const v = {
      side, opponent: other(side), round: g.round, rounds: g.rounds, stage: g.stage, over: g.over,
      waiting: toAct(g), myTurn: toAct(g).indexOf(side) >= 0,
      weather: g.weather, revealed: g.revealed, deckCount: g.deck.length, gone: g.gone.slice(), allIn: g.allIn,
      minBet: minBetOf(g.round), ante: CC_CONFIG.ante, maxRaises: CC_CONFIG.maxRaises,
      loan: { unit: CC_CONFIG.loan.unit, repay: CC_CONFIG.loan.repay }, loanAsk: g.loanAsk ? g.loanAsk.slice() : null,
      pot: g.sides.dealer.pot + g.sides.player.pot + g.sides.dealer.bet + g.sides.player.bet,
      normalUsed: g.normalUsed,
      me: Object.assign(pub(me), { hand: me.hand.slice(), card: me.card, history: clone(me.history), discards: clone(me.discards) }),
      opp: Object.assign(pub(op), { handCount: op.hand.length, played: !!op.card, discardCount: op.discards.length }),
      betting: b ? { street: b.street, toAct: b.toAct, raises: b.raises, toCall: Math.max(0, op.st - me.st) } : null,
      results: clone(g.results),
      log: g.log.filter(e => !e.to || e.to === side).map(e => clone(e)),
      legal: legal(g, side),
      final: g.final ? clone(g.final) : null
    };
    if (side === "player") v.me.spare = spareElements(g);
    if (side === "dealer") {
      v.peek = g.peek ? clone(g.peek) : null;
      const top = g.know.top && g.deck[0] === g.know.top ? g.know.top : null;
      const bottom = g.know.bottom && g.deck[g.deck.length - 1] === g.know.bottom ? g.know.bottom : null;
      v.deckTop = top; v.deckBottom = bottom;
    }
    return v;
  }

  /* ---------- 赌场（预留接口） ---------- */
  const casino = {
    tables: () => clone(CC_CONFIG.casino.tables),
    table: (id) => { const t = CC_CONFIG.casino.tables.find(x => x.id === id); return t ? clone(t) : null; },
    /** 坐上一张桌子：玩家用自己的 buyIn 枚筹码（不少于最低买入），庄家筹码无限 */
    newGame(tableId, buyIn, opt) {
      const t = casino.table(tableId);
      if (!t) fail("没有这张桌子：" + tableId);
      const n = Math.floor(Number(buyIn));
      if (!Number.isFinite(n) || n < t.minBuyIn) fail(`${t.name}最低买入 ${t.minBuyIn} 枚`);
      const g = newGame(Object.assign({}, opt || {}, { playerChips: n, dealerInfinite: true }));
      g.casino = { table: t.id, name: t.name, buyIn: n, rate: t.rate, difficulty: t.difficulty };
      return g;
    },
    /** 离桌：剩下的筹码（扣还向主持方借的；对局结束时已经扣过）、净输赢，按这张桌子的倍率折成奎支 */
    cashOut(g) {
      if (!g || !g.casino) fail("这一局不是赌场的对局");
      const s = g.sides.player;
      const chips = s.chips - (g.over ? 0 : s.owe), net = chips - g.casino.buyIn;
      return { chips, net, value: chips * g.casino.rate, netValue: net * g.casino.rate, loan: s.loan, owe: s.owe };
    }
  };

  const api = {
    CC_CONFIG, SIDES, other, cardName, weatherName, sideName, isElement,
    chartScore, weatherScore, score, scoreParts, chart, cardChart, tierOf, extraOf, minBetOf, settle, repayOf,
    newGame, toAct, legal, act, view, spareElements, resultText, casino, makeRng, hashSeed
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CounterCards = api;
})(typeof window !== "undefined" ? window : globalThis);
