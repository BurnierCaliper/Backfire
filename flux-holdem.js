/* Flux Hold'em（#488）· 多人公共牌桌（2–4 人）：规则引擎
 * 玩法名主人 10/30 定为 Flux Hold'em（中文译名暂不定，界面上直接写英文名），在 CC_CONFIG.holdem.name。规则 Burnier，界面 Akane。
 *
 * 牌：元素牌 4 组 × 7 种共 28 张洗混，每人开局 3 张、第 2–5 轮开始时各摸 1 张（整局过手 7 张，每张只能用一次；不足 4 人时剩下的盖着不发）；
 *     玩家不出层牌——公共层牌 2 组 × 5 张共 10 张洗混，每轮翻 2 张；天气 7 张洗混成一堆，每轮翻 2 张，两张叠加。
 *     天气堆抽完时只把已经弃掉的天气洗回去重抽，场上生效中的不洗回（同一轮不会出现两张一样的天气）。
 * 庄家每轮顺时针轮换；庄家左边两位下小盲 1 × 轮数、大盲 2 × 轮数（两人局庄家下小盲）。
 * 每轮（夕夏 10/30 调整的顺序）：
 *   0. 借贷：手上不够「该下的盲注 + 最低下注额」的先决定借不借（输光的先问；输光了不借就出局）；
 *   1. 庄家偷看天气堆顶，决定留在顶上还是压到堆底（这张暂不翻开；放哪公开，是哪张只有庄家知道）；
 *   2. 翻开第 1 张公共层牌，交盲注；
 *   3. 每人盖下 1 张元素牌；
 *   4. 第一轮下注（从庄家左边开始顺时针）；
 *   5. 翻开第 1 张天气（是相位：没弃牌的人全押，跳过第二轮下注，直接到 7）；
 *   6. 第二轮下注（同样从庄家左边开始）；
 *   7. 结算：同时翻开第 2 张公共层牌和第 2 张天气（第 2 张是相位：比分之前没弃牌的人补押到全押的数目），亮牌——
 *      每人的元素牌对 2 张公共层牌分别计分求和（两张天气叠加），最高分拿走底池，同分平分
 *      （平局是这个模式的特色，不另加决胜规则；分不开的零头从庄家左边起一人一枚）。
 * 相位（主人 10/30 确认，取代正文「本轮最低注翻倍」）：翻开相位时所有还没弃牌的人全押——上限 = 没弃牌的人里筹码最少那位的全部筹码
 *   （这一轮已下的 + 手上的），其他人押到同样的数（之前押得比这个数多的不退，照旧开边池），然后直接比分。
 *   全押后同分：底池不分，留在桌上滚到下一轮（算进下一轮的主池）；最后一轮同分的人平分。
 *   滚存的底池没有下一轮了（只剩一个人没出局，对局提前结束）：归坐在桌上的那个人。
 * 计分（CounterCards.score 那一套，两张天气叠加，scoreStack）：天气修正直接相加、不设上限；
 *   微光会反转克制表（能量的克制不反转），也会反转另一张天气给所有元素的修正（包括给能量的、酸雨打装甲那一项），微光自己给能量的 +1 保留。
 * 下注：过牌 / 跟注 / 加注 / 弃牌；加注至少等于上一次加注额（也不少于最低下注额 = 轮数，第一轮下注时大盲算第一次下注），
 *   每个下注回合最多加注 3 次；下注不封顶（#496，只受自己手上的筹码限制，跟不起要先借）；筹码不够也可以全押，比自己多押的部分开边池（同德州）；
 *   跟注后有 3 秒追加窗口（#496，还可以加注或弃牌；秒数、pass / closeWindow 的用法同 High Flux）；弃牌的不参与比分。
 *   多人局不用分档赔付，只按底池结算。
 * 借贷 3 借 4 还、不设上限（同 High Flux：算借多少、记账、结束时扣还都直接用 counter-cards.js 的同一份代码）。5 轮后筹码最多的赢。
 * 规则层不碰网页：AI 在 flux-holdem-ai.js，界面在 flux-holdem-ui.js。
 *
 *   const g = FluxHoldem.newGame({ seed: "A", players: [{ id: "p1", name: "你" }, { id: "p2" }, { id: "p3" }] });
 *   FluxHoldem.toAct(g)                       → 现在等谁（id 列表；盖牌、追加窗口时好几个人同时能动）
 *   FluxHoldem.legal(g, "p1")                 → 这名玩家现在能做的
 *   FluxHoldem.act(g, "p1", { type: "play", card: "fire" })   → 盖下一张元素牌；下注：check / call / bet / raise / allIn / fold / pass / borrow
 *   FluxHoldem.closeWindow(g)                 → 跟注后的追加窗口到时间
 *   FluxHoldem.view(g, "p1")                  → 这名玩家能看到的（别人的手牌、盖下的牌、牌堆的顺序都不在里面；庄家偷看的那张只给庄家；
 *                                               滚存的底池 carry 公开，pot 里也算上了）
 *   FluxHoldem.scoreStack("fire", "flesh", ["heat", "glow"])   → 两张天气叠加时的得分
 *   FluxHoldem.chart(["heat", "glow"])        → 克制表（得分）：场上的天气叠加后每张元素牌打每张层牌的实际得分（格式同 CounterCards.chart）
 */
(function (root) {
  "use strict";

  /* ---------- 配置：所有数值都在这里（挂在 CounterCards.CC_CONFIG.holdem 上） ---------- */
  // 每轮最低下注额（CC_CONFIG.minBet）、追加窗口秒数（callWindowSec）、借贷（loan）沿用 High Flux 的同一份配置
  const HOLDEM_CONFIG = {
    name: "Flux Hold'em",              // 玩法名（主人 10/30 定名）：菜单、设置页、牌桌标题、规则说明都读这个
    minPlayers: 2, maxPlayers: 4,
    rounds: 5,
    startChips: null,                  // 开局筹码，每人一样；null = 和 High Flux 一样（CC_CONFIG.startChips）
    elementSets: 4,                    // 元素牌 4 组 × 7 种 = 28 张（夕夏 10/30）
    hand: 3,                           // 开局每人拿几张
    draw: 1,                           // 第 2–5 轮开始时每人摸几张
    layerSets: 2,                      // 公共层牌 2 组 × 5 张 = 10 张，每轮翻 2 张
    layersPerRound: 2,
    weathersPerRound: 2,               // 每轮翻 2 张天气，叠加
    blinds: [1, 2],                    // 小盲 1 × 轮数、大盲 2 × 轮数
    maxRaises: 3,                      // 每个下注回合最多加注 3 次
    seatNames: ["玩家 1", "玩家 2", "玩家 3", "玩家 4"],
    // 赌场桌（#488 第 5 步；钱照 #487，在 casino.js）：人坐第一个座位，其余座位是这张桌子难度的 AI（赌场的人：开局筹码和你的买入一样多，由赌场出），
    // 没有主持人坐庄。players = 这张桌子几人（含你）；names = 座位上的称呼（你坐第一个）。
    // 数值先照 High Flux 的三张赌场桌占位（倍率 rate、最低买入 minBuyIn、AI 难度 difficulty、入场费 entryFee），试玩再调；id 全赌场不重复
    casino: {
      names: ["你", "乙", "丙", "丁"],
      tables: [
        { id: "holdem-alley", name: "后巷小桌", rate: 10, minBuyIn: 20, difficulty: "easy", entryFee: 2, players: 4 },
        { id: "holdem-hall", name: "大厅", rate: 50, minBuyIn: 30, difficulty: "normal", entryFee: 2, players: 4 },
        { id: "holdem-vip", name: "贵宾室", rate: 200, minBuyIn: 50, difficulty: "hard", entryFee: 2, players: 4 }
      ]
    }
  };
  const MODE = "holdem";
  const CC = () => root.CounterCards;
  const B = () => root.CounterCards.bet;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function fail(msg) { throw new Error(msg); }
  function needCC() {
    if (!CC() || !CC().bet) fail(HOLDEM_CONFIG.name + " 要先加载 counter-cards.js（High Flux 的计分、借贷）");
  }
  const cardName = (c) => CC().cardName(c);
  const weatherName = (w) => (w ? CC().weatherName(w) : "没有天气");
  const nameOf = (g, id) => (g.names && g.names[id]) || id;
  const signed = (n) => (n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0");
  const uniq = (a) => a.filter((x, i) => a.indexOf(x) === i);
  const startChips = () => (HOLDEM_CONFIG.startChips != null ? HOLDEM_CONFIG.startChips : CC().CC_CONFIG.startChips);

  /* ---------- 计分：两张天气叠加（CounterCards 的克制、天气修正两项） ---------- */
  /** 一张元素牌打一张层牌、场上这几张天气叠在一起时的实际得分：
   *  克制那一项——有微光就反转（能量以外，CounterCards.chartScore 按微光算）；天气修正——每张天气各自的修正（CounterCards.weatherScore，
   *  含酸雨打装甲那一项）直接相加，不设上限；有微光时另一张天气的修正整个反转（给能量的也反转），微光自己给能量的 +1 保留。
   *  只有一张天气时就是 CounterCards.score */
  function scoreStack(element, layer, weathers) {
    needCC();
    const C = CC().CC_CONFIG;
    if (!CC().isElement(element) || C.layers.indexOf(layer) < 0) return 0;
    const ws = (weathers || []).filter(w => C.weathers.indexOf(w) >= 0);
    const glow = ws.indexOf("glow") >= 0;
    let s = CC().chartScore(element, layer, glow ? "glow" : null);
    ws.forEach(w => { const x = CC().weatherScore(element, layer, w); s += glow && w !== "glow" ? -x : x; });
    return s;
  }
  /** 一张元素牌对几张公共层牌分别计分求和 */
  function handScore(element, layers, weathers) {
    return (layers || []).reduce((t, ly) => t + scoreStack(element, ly, weathers), 0);
  }
  const W = (ws) => (ws && ws.length ? ws.map(weatherName).join(" + ") : "没有天气");
  /** 克制表（得分）：场上这几张天气叠加后每张元素牌打每张层牌的实际得分。格式同 CounterCards.chart（matchup-ui.js 照平时克制表的样子画），
   *  cells[行][列]：value = 叠加后的得分（scoreStack），base = 没有天气时的得分，reason = 克制那一项 + 每张天气的修正（微光反转的写明） */
  function chart(weathers) {
    needCC();
    const C = CC().CC_CONFIG, c = CC().chart(null);
    const ws = uniq((weathers || []).filter(w => C.weathers.indexOf(w) >= 0));
    const glow = ws.indexOf("glow") >= 0;
    const K = { adv: "加分", dis: "扣分", neu: "0 分" }, kindOf = (n) => (n > 0 ? "adv" : n < 0 ? "dis" : "neu");
    c.cells = C.elements.map(el => C.layers.map(ly => {
      const value = scoreStack(el, ly, ws), base = scoreStack(el, ly, []);
      const ch = CC().chartScore(el, ly, glow ? "glow" : null), was = CC().chartScore(el, ly, null);
      const parts = [`${{ adv: "克制", dis: "被克制", neu: "普通" }[kindOf(ch)]} ${signed(ch)}${ch !== was ? "（微光：克制关系反转）" : ""}`];
      ws.forEach(w => {
        const x = CC().weatherScore(el, ly, w);
        if (!x) return;
        parts.push(glow && w !== "glow" ? `${weatherName(w)} ${signed(x)}，被微光反转成 ${signed(-x)}` : `${weatherName(w)} ${signed(x)}`);
      });
      return { row: el, col: ly, base, value, kindId: kindOf(value), kind: K[kindOf(value)], baseKind: K[kindOf(base)], changed: value !== base, reason: parts.join("；") };
    }));
    c.changed = [];
    c.cells.forEach(row => row.forEach(x => { if (x.changed) c.changed.push({ row: x.row, col: x.col }); }));
    c.weather = ws.length ? ws[ws.length - 1] : "none";
    c.weatherName = W(ws);
    c.weathers = ws.slice();
    c.notes = [`得分 = 克制（克制 +1、被克制 −1、普通 0）+ 天气修正（每 ${Math.round(C.pctStep * 100)}% 记 ±1）。场上几张天气的修正直接相加、不设上限；`
      + `你的元素牌对 2 张公共层牌分别计分求和，最高分拿走底池。`];
    if (glow) c.notes.push("微光：克制关系反转（能量除外）；另一张天气给所有元素的修正（含给能量的、酸雨打装甲那一项）也反转，微光自己给能量的 +1 保留");
    if (ws.indexOf(C.allInWeather) >= 0) c.notes.push(`${weatherName(C.allInWeather)}：不改得分；翻开时没弃牌的人全押（上限是没弃牌的人里筹码最少那位的全部筹码），不再下注直接比分；`
      + `全押后同分底池滚到下一轮，最后一轮同分的人平分`);
    c.legend = { adv: "加分（正分）", dis: "扣分（负分）", neu: "0 分" };
    c.tag = `${HOLDEM_CONFIG.name} 得分`;
    return c;
  }
  /** 悬停预览：这张元素牌在场上这几张天气下打五种层各得几分（就是 chart(天气) 里这张牌的一行）；不是元素牌 → null */
  function cardChart(card, weathers) {
    if (!CC().isElement(card)) return null;
    const c = chart(weathers), row = c.cells[CC().CC_CONFIG.elements.indexOf(card)];
    return { card, name: cardName(card), weathers: c.weathers, weatherName: c.weatherName,
      cells: row.map(x => ({ layer: x.col, name: cardName(x.col), value: x.value, kindId: x.kindId, kind: x.kind, base: x.base, changed: x.changed, reason: x.reason })) };
  }

  /* ---------- 开局 ---------- */
  /** opt：seed；players：[{ id, name, chips }]（2–4 人，按座位顺时针）；chips（每人开局筹码，默认 HOLDEM_CONFIG.startChips）；
   *  dealer（第 1 轮的庄家 id，默认第一个）；测试用：hands（{ id: [开局的 3 张] }）、elements（元素牌堆的顺序，第 0 张在顶）、
   *  layers（公共层牌的顺序）、weathers（天气堆的顺序） */
  function newGame(opt) {
    opt = opt || {};
    needCC();
    const C = CC().CC_CONFIG, H = HOLDEM_CONFIG;
    const seed = String(opt.seed != null ? opt.seed : Date.now());
    const list = opt.players || [];
    if (list.length < H.minPlayers || list.length > H.maxPlayers) fail(`${H.name} 要 ${H.minPlayers}–${H.maxPlayers} 人`);
    const base = opt.chips != null ? Number(opt.chips) : startChips();
    const order = list.map((p, i) => String(p.id != null ? p.id : "p" + (i + 1)));
    order.forEach((id, i) => { if (order.indexOf(id) !== i) fail("玩家 id 重复：" + id); });
    const names = {}, sides = {};
    list.forEach((p, i) => {
      const id = order[i], chips = Math.max(0, Math.floor(Number(p.chips != null ? p.chips : base) || 0));
      names[id] = String(p.name || H.seatNames[i] || id);
      sides[id] = { hand: [], card: null, chips, start: chips, bet: 0, st: 0, roundStart: chips, loan: 0, owe: 0,
        folded: false, allIn: false, out: false, history: [], pot: 0 };
    });
    const rng = (tag) => CC().makeRng(seed + "|holdem-" + tag);
    const set = (cards, n) => { const out = []; for (let i = 0; i < n; i++) out.push.apply(out, cards); return out; };
    // 元素牌：4 组 × 7 种洗混；测试可以指定开局的手牌和剩下的牌堆
    let elements;
    if (opt.hands) {
      order.forEach(id => { const h = opt.hands[id] || []; if (h.length !== H.hand) fail(`开局每人 ${H.hand} 张：` + id); sides[id].hand = h.slice(); });
      elements = opt.elements ? opt.elements.slice() : CC().shuffle(set(C.elements, H.elementSets), rng("elements"));
    } else {
      elements = opt.elements ? opt.elements.slice() : CC().shuffle(set(C.elements, H.elementSets), rng("elements"));
      for (let k = 0; k < H.hand; k++) order.forEach(id => { if (elements.length) sides[id].hand.push(elements.shift()); });
    }
    elements.concat(...order.map(id => sides[id].hand)).forEach(c => { if (!CC().isElement(c)) fail("没有这张元素牌：" + c); });
    const layers = opt.layers ? opt.layers.slice() : CC().shuffle(set(C.layers, H.layerSets), rng("layers"));
    const deck = opt.weathers ? opt.weathers.slice() : CC().shuffle(C.weathers, rng("weathers"));
    deck.forEach(w => { if (C.weathers.indexOf(w) < 0) fail("没有这张天气牌：" + w); });
    const g = {
      v: 1, mode: MODE, seed, rounds: H.rounds, round: 0, stage: "start", over: false,
      order, names, sides,
      dealer: order.indexOf(opt.dealer) >= 0 ? opt.dealer : order[0], sb: null, bb: null,
      elementDeck: elements,     // 没发的元素牌（第 0 张在顶；谁都看不到）
      layerDeck: layers,         // 公共层牌堆（谁都看不到）
      layers: [],                // 这一轮翻开的公共层牌
      usedLayers: [],            // 前几轮翻开过的公共层牌（公开）
      deck,                      // 天气堆（第 0 张在顶）
      weathers: [],              // 这一轮翻开的天气（叠加）
      discards: [],              // 弃掉的天气（公开；天气堆抽完时洗回去）
      reshuffles: 0,
      peek: null,                // 这一轮庄家偷看的那张：{ card, where }（只给庄家看）
      allIn: null,               // 这一轮翻到相位、没弃牌的人全押了：{ at: 第几张天气是相位, cap: 押到多少 }
      carry: null,               // 相位全押后同分、留在桌上滚到下一轮的底池（公开）：{ amount, from: 当时同分的人, r: 第几轮留下的 }
      betting: null, loanAsk: null,
      results: [], log: [], final: null
    };
    startRound(g, true);
    return g;
  }
  const note = (g, entry) => B().note(g, entry);
  const seated = (g) => g.order.filter(id => !g.sides[id].out);            // 还没出局的
  const inHand = (g, id) => !g.sides[id].out && !g.sides[id].folded;       // 这一轮还在牌局里（没出局、没弃牌）
  const canAct = (g, id) => inHand(g, id) && !g.sides[id].allIn;          // 还能下注（没全押）
  const blindOf = (round, k) => HOLDEM_CONFIG.blinds[k] * round;
  /** 这一轮的最低下注额：轮数（CC_CONFIG.minBet）。相位不再让它翻倍（翻到相位就全押、直接比分，后面没有下注） */
  const minBetNow = (g) => CC().minBetOf(g.round);
  const isPhase = (w) => !!w && w === CC().CC_CONFIG.allInWeather;
  /** 从 id 的下一位起顺时针的座位（不含 id 自己），只算还没出局的 */
  function after(g, id) {
    const ids = g.order, i = ids.indexOf(id), out = [];
    for (let k = 1; k < ids.length; k++) { const x = ids[(i + k) % ids.length]; if (!g.sides[x].out) out.push(x); }
    return out;
  }
  /** 这一轮的小盲、大盲（两人局庄家下小盲） */
  function positions(g) {
    const left = after(g, g.dealer);
    if (seated(g).length === 2) { g.sb = g.dealer; g.bb = left[0]; } else { g.sb = left[0]; g.bb = left[1]; }
  }
  const owedBlind = (g, id) => (id === g.sb ? blindOf(g.round, 0) : id === g.bb ? blindOf(g.round, 1) : 0);

  /* ---------- 每轮开始：摸牌 → 借贷 → 庄家偷看 → 翻第 1 张层牌、下盲注 → 盖牌 ---------- */
  function startRound(g, first) {
    if (g.round >= g.rounds || seated(g).length < 2) { finish(g); return; }
    g.round += 1;
    if (!first) {
      // 庄家顺时针轮换（出局的跳过）
      g.dealer = after(g, g.dealer)[0] || g.dealer;
      // 第 2–5 轮开始时每人摸 1 张（按座位顺序）
      for (let k = 0; k < HOLDEM_CONFIG.draw; k++) seated(g).forEach(id => { if (g.elementDeck.length) g.sides[id].hand.push(g.elementDeck.shift()); });
    }
    g.order.forEach(id => { const s = g.sides[id]; s.card = null; s.bet = 0; s.st = 0; s.folded = false; s.allIn = false; s.roundStart = s.chips; });
    g.betting = null; g.peek = null; g.allIn = null;
    positions(g);
    // 借贷：手上不够「该下的盲注 + 最低下注额」的先问（输光的先问——输光了不借就出局），其余按座位顺序
    g.stage = "loan";
    g.loanAsk = seated(g).filter(id => loanAt(g, id)).sort((x, y) => Number(g.sides[y].chips <= 0) - Number(g.sides[x].chips <= 0));
    if (g.loanAsk.length) {
      note(g, { t: "loanAsk", ids: g.loanAsk.slice(), text: `第 ${g.round} 轮开始前：${g.loanAsk.map(id => nameOf(g, id)).join("、")}手上的筹码不够这一轮该下的盲注 + 最低下注额，可以向主持方借。` });
      return;
    }
    beginRound(g);
  }
  /** 每轮开始时能借多少（CounterCards.bet.loanRange：同 High Flux，3 枚一份、借到补上缺口） */
  const loanAt = (g, id) => B().loanRange(owedBlind(g, id) + minBetNow(g), g.sides[id].chips);
  function nextLoan(g) {
    g.loanAsk.shift();
    if (!g.loanAsk.length) beginRound(g);
  }
  function noLoan(g, id) {
    const s = g.sides[id], out = s.chips <= 0;
    if (out) s.out = true;
    note(g, { t: "noLoan", by: id, text: out ? `${nameOf(g, id)}输光了，没有向主持方借，出局。` : `${nameOf(g, id)}没有向主持方借。` });
    nextLoan(g);
  }
  /** 借贷问完了：人不够两个就结束；庄家出局了顺延；然后庄家偷看天气堆顶 */
  function beginRound(g) {
    g.loanAsk = null;
    if (seated(g).length < 2) { finish(g); return; }
    if (g.sides[g.dealer].out) g.dealer = after(g, g.dealer)[0];
    positions(g);
    note(g, { t: "round", dealer: g.dealer, sb: g.sb, bb: g.bb,
      text: `第 ${g.round} 轮：${nameOf(g, g.dealer)}坐庄，${nameOf(g, g.sb)}下小盲 ${blindOf(g.round, 0)} 枚、${nameOf(g, g.bb)}下大盲 ${blindOf(g.round, 1)} 枚（本轮最低下注 ${minBetNow(g)} 枚）。` });
    if (!g.deck.length) reshuffle(g);
    if (!g.deck.length) { note(g, { t: "peek", op: "none", text: "天气堆是空的，庄家这一轮没得偷看。" }); openTable(g); return; }
    g.peek = { card: g.deck[0], where: null };
    note(g, { t: "peekCard", by: g.dealer, to: g.dealer, card: g.deck[0], text: `你偷看到天气堆顶是〔${weatherName(g.deck[0])}〕。` });
    g.stage = "peek";
  }
  /** 天气堆抽完：只把弃掉的天气洗回去（场上生效中的不洗回） */
  function reshuffle(g) {
    if (!g.discards.length) return;
    g.reshuffles += 1;
    g.deck = CC().shuffle(g.discards, CC().makeRng(g.seed + "|holdem-reshuffle|" + g.reshuffles));
    note(g, { t: "reshuffle", count: g.deck.length, text: `天气堆抽完了：把弃掉的 ${g.deck.length} 张天气洗回去（场上的不洗回）。` });
    g.discards = [];
  }
  function drawWeather(g) {
    if (!g.deck.length) reshuffle(g);
    return g.deck.length ? g.deck.shift() : null;
  }
  /** 庄家偷看后：留在顶上 / 压到堆底（放哪公开） */
  function place(g, where) {
    if (where === "bottom" && g.deck.length > 1) g.deck.push(g.deck.shift());
    g.peek.where = where;
    note(g, { t: "peek", by: g.dealer, op: where, text: `${nameOf(g, g.dealer)}偷看了天气堆顶，${where === "bottom" ? "压到了牌堆底" : "留在了顶上"}。` });
    openTable(g);
  }
  /** 翻开第 1 张公共层牌，下盲注，大家盖牌 */
  function openTable(g) {
    const L1 = g.layerDeck.shift();
    if (L1) g.layers.push(L1);
    note(g, { t: "layer", layer: L1, text: `翻开第 1 张公共层牌〔${cardName(L1)}〕。` });
    [[g.sb, 0], [g.bb, 1]].forEach(([id, k]) => {
      const s = g.sides[id], n = Math.min(blindOf(g.round, k), Math.max(0, s.chips));
      B().pay(s, n); s.st += n;
      if (s.chips <= 0) s.allIn = true;
    });
    g.stage = "play";
  }

  /* ---------- 现在等谁、能做什么 ---------- */
  function toAct(g) {
    if (g.over) return [];
    switch (g.stage) {
      case "loan": return g.loanAsk && g.loanAsk.length ? [g.loanAsk[0]] : [];
      case "peek": return [g.dealer];
      case "play": return seated(g).filter(id => !g.sides[id].card);
      case "bet1": case "bet2": {
        const b = g.betting;
        if (b.window) return g.order.filter(id => canAct(g, id) && !b.window.passed[id]);
        return b.toAct ? [b.toAct] : [];
      }
      default: return [];
    }
  }
  /** 这名玩家还要不要表态：还有要跟的；或者还没表态过、而且还有别人能下注（只剩自己能下注时不用表态） */
  function needs(g, id) {
    const s = g.sides[id], b = g.betting;
    if (!canAct(g, id)) return false;
    if (s.st < b.cur) return true;
    if (b.acted[id]) return false;
    return g.order.some(k => k !== id && canAct(g, k));
  }
  /** from 之后（顺时针）第一个要表态的；没有 = 这个下注回合打完了 */
  function nextToAct(g, from) {
    const ids = g.order, i = ids.indexOf(from);
    for (let k = 1; k <= ids.length; k++) { const id = ids[(i + k) % ids.length]; if (needs(g, id)) return id; }
    return null;
  }
  /** 加注至少加多少：上一次加注额，也不少于这一轮的最低下注额 */
  const minRaise = (g) => Math.max(minBetNow(g), g.betting.lastRaise || 0);
  /** 还有别人能应对（没弃牌、没全押）：只剩自己能下注时下注 / 加注没意义 */
  const othersCanAct = (g, id) => g.order.some(k => k !== id && canAct(g, k));
  function legal(g, id) {
    if (toAct(g).indexOf(id) < 0) return [];
    const s = g.sides[id];
    switch (g.stage) {
      case "loan": { const lo = loanAt(g, id); return (lo ? [lo] : []).concat([{ type: "noLoan" }]); }
      case "peek": return [{ type: "place", where: "top" }, { type: "place", where: "bottom" }];
      case "play": return uniq(s.hand).map(card => ({ type: "play", card }));
      case "bet1": case "bet2": {
        const b = g.betting, rm = s.chips, mr = minRaise(g), open = othersCanAct(g, id);
        const raiseOk = b.raises < HOLDEM_CONFIG.maxRaises && open;
        // 跟注后的追加窗口：放弃追加 / 加注（还有加注次数、手上有筹码）/ 弃牌；窗口里不借（同 High Flux）
        if (b.window) return [{ type: "pass" }].concat(raiseOk && rm > 0 ? [{ type: "raise", min: Math.min(mr, rm), max: rm }] : [], [{ type: "fold" }]);
        const toCall = b.cur - s.st, out = [];
        if (toCall <= 0) {
          out.push({ type: "check" });
          // 没人下过注：下注；第一轮下注时大盲算第一次下注，轮回大盲时它可以加注
          if (b.cur <= 0 && open && rm > 0) out.push({ type: "bet", min: Math.min(minBetNow(g), rm), max: rm });
          else if (b.cur > 0 && raiseOk && rm > 0) out.push({ type: "raise", min: Math.min(mr, rm), max: rm });
        } else {
          if (rm >= toCall) out.push({ type: "call", amount: toCall });
          else if (rm > 0) out.push({ type: "allIn", amount: rm });       // 跟不起：押上剩下的全部（开边池）
          if (raiseOk && rm > toCall) out.push({ type: "raise", min: Math.min(mr, rm - toCall), max: rm - toCall });
        }
        out.push({ type: "fold" });
        // 手上的筹码不够「要跟的 + 最低下注额」：可以先向主持方借（借完还是自己下注）
        const lo = B().loanRange(Math.max(0, toCall) + minBetNow(g), rm);
        if (lo) out.push(lo);
        return out;
      }
      default: return [];
    }
  }

  /* ---------- 操作 ---------- */
  function act(g, id, a) {
    if (g.over) fail("这一局已经结束了");
    if (!g.sides[id]) fail("没有这名玩家：" + id);
    if (!a || typeof a.type !== "string") fail("操作格式不对");
    const opts = legal(g, id);
    if (!opts.length) fail(`现在不是${nameOf(g, id)}操作的时候`);
    const ok = opts.find(o => o.type === a.type && (o.where == null || o.where === a.where) && (o.card == null || o.card === a.card));
    if (!ok) fail(`${nameOf(g, id)}现在不能这样做（${a.type}${a.card ? " " + cardName(a.card) : ""}）`);
    switch (a.type) {
      case "borrow":
        B().borrow(g, id, a, ok);          // 同 High Flux：校验、记账、记录
        if (g.stage === "loan") nextLoan(g);
        break;
      case "noLoan": noLoan(g, id); break;
      case "place": place(g, a.where); break;
      case "play": playCard(g, id, a.card); break;
      default: betAction(g, id, a, ok);
    }
    return g;
  }
  function playCard(g, id, card) {
    const s = g.sides[id];
    s.hand.splice(s.hand.indexOf(card), 1);
    s.card = card;
    s.history.push({ r: g.round, card });
    note(g, { t: "play", by: id, text: `${nameOf(g, id)}盖下了一张元素牌。` });
    note(g, { t: "myCard", by: id, to: id, card, text: `你盖下了〔${cardName(card)}〕。` });
    if (seated(g).every(k => g.sides[k].card)) openStreet(g, 1);
  }

  /* ---------- 下注回合 ---------- */
  /** 开第 street 次下注：从庄家左边开始顺时针；第一轮下注时盲注已经算在这一回合里（大盲算第一次下注） */
  function openStreet(g, street) {
    g.stage = street === 1 ? "bet1" : "bet2";
    if (street === 2) g.order.forEach(id => { g.sides[id].st = 0; });
    const cur = Math.max(0, ...g.order.map(id => g.sides[id].st));
    // called：最后一次下注 / 加注之后有人跟过注（谁跟的）——这个下注回合打完时有人跟过才开追加窗口
    g.betting = { street, toAct: null, cur, lastRaise: street === 1 ? blindOf(g.round, 1) : 0, raises: 0, acted: {}, called: null, window: null, windows: 0 };
    g.betting.toAct = nextToAct(g, g.dealer);
    if (!g.betting.toAct) closeStreet(g);
  }
  function betAction(g, id, a, opt) {
    const s = g.sides[id], b = g.betting, label = nameOf(g, id);
    const amountIn = (lo, hi, v, what) => {
      const n = Math.floor(Number(v));
      if (!Number.isFinite(n) || n < lo || n > hi) fail(`${what}要在 ${lo}–${hi} 枚之间`);
      return n;
    };
    const put = (n) => { B().pay(s, n); s.st += n; if (s.chips <= 0) s.allIn = true; return n; };
    if (a.type === "pass") {                // 追加窗口：放弃追加（不公开）；能动作的都放弃了就关窗
      b.window.passed[id] = true;
      if (g.order.every(k => !canAct(g, k) || b.window.passed[k])) shutWindow(g, "pass");
      return;
    }
    b.acted[id] = true;
    if (a.type === "fold") {
      s.folded = true;
      note(g, { t: "bet", by: id, op: "fold", street: b.street, text: `${label}弃牌。` });
      const live = g.order.filter(k => inHand(g, k));
      if (live.length === 1) { foldWin(g, live[0]); return; }
      if (b.window) {
        if (g.order.every(k => !canAct(g, k) || b.window.passed[k])) shutWindow(g, "pass");
        return;
      }
      advance(g, id);
      return;
    }
    if (a.type === "check") {
      note(g, { t: "bet", by: id, op: "check", street: b.street, text: `${label}过牌。` });
      advance(g, id);
      return;
    }
    if (a.type === "call" || a.type === "allIn") {
      const n = put(a.type === "call" ? b.cur - s.st : s.chips);
      b.called = id;
      note(g, { t: "bet", by: id, op: a.type, amount: n, street: b.street,
        text: a.type === "call" ? `${label}跟注 ${n} 枚${s.allIn ? "（全押）" : ""}。` : `${label}全押 ${n} 枚（跟不起，比自己多押的部分开边池）。` });
      advance(g, id);
      return;
    }
    // 下注 / 加注（追加窗口里的加注也一样：关窗，照常轮到别人应对，算进这一回合的加注次数）
    const n = amountIn(opt.min, opt.max, a.amount, a.type === "bet" ? "下注额" : "加注额");
    const inWindow = !!b.window;
    b.window = null;
    // 下满一次（下注不少于最低下注额、加注不少于上一次加注额）才算新的「上一次加注额」；全押不够一次的不改
    const full = n >= (a.type === "bet" ? minBetNow(g) : minRaise(g));
    put(a.type === "bet" ? n : b.cur - s.st + n);
    if (a.type === "raise") b.raises += 1;
    if (full) b.lastRaise = n;
    b.cur = s.st;
    b.called = null;
    g.order.forEach(k => { if (k !== id) b.acted[k] = false; });
    note(g, Object.assign({ t: "bet", by: id, op: a.type, amount: n, street: b.street,
      text: a.type === "bet" ? `${label}下注 ${n} 枚${s.allIn ? "（全押）" : ""}。` : `${label}${inWindow ? "在追加窗口里" : ""}加注 ${n} 枚（这一轮下注合计 ${s.bet} 枚${s.allIn ? "，全押" : ""}）。` }, inWindow ? { window: true } : {}));
    advance(g, id);
  }
  /** 一个人表完态：下一个要表态的接着；没人要表态了——最后一次下注 / 加注有人跟过（含全押跟注；之后别人弃牌也算）就开追加窗口
   *  （还有加注次数、至少两个人还能下注），不然（都过牌）结束这个下注回合 */
  function advance(g, id) {
    const b = g.betting, nxt = nextToAct(g, id);
    if (nxt) { b.toAct = nxt; return; }
    const able = g.order.filter(k => canAct(g, k));
    if (b.called && b.raises < HOLDEM_CONFIG.maxRaises && able.length >= 2) { openWindow(g, b.called); return; }
    closeStreet(g);
  }
  /** 跟注后的追加窗口（#496，同 High Flux）：还能下注的人都可以加注或弃牌，都放弃（pass）或者到时间（closeWindow）就关窗 */
  function openWindow(g, by) {
    const b = g.betting;
    b.windows += 1;
    b.window = { n: b.windows, by, passed: {} };
    b.toAct = null;
    note(g, { t: "window", op: "open", by, street: b.street,
      text: `${nameOf(g, by)}跟注，开 ${CC().CC_CONFIG.callWindowSec} 秒追加窗口：还可以加注或弃牌，没人动作就结束这个下注回合。` });
  }
  function shutWindow(g, why) {
    const b = g.betting;
    b.window = null;
    note(g, { t: "window", op: "close", why, street: b.street, text: why === "timeout" ? "追加窗口到时间了，没人加注。" : "都不追加，追加窗口关闭。" });
    closeStreet(g);
  }
  /** 追加窗口到时间（界面倒计时结束时调）：没表态的都算放弃追加。窗口没开着返回 false */
  function closeWindow(g) {
    if (!g || g.over || !g.betting || !g.betting.window) return false;
    shutWindow(g, "timeout");
    return true;
  }
  /** 第一轮下注打完：翻开第 1 张天气，开第二轮下注（翻到相位：没弃牌的人全押，不进第二轮下注，直接结算）；第二轮打完：结算 */
  function closeStreet(g) {
    const street = g.betting ? g.betting.street : 1;
    g.betting = null;
    if (street === 1) {
      const w = drawWeather(g);
      if (w) g.weathers.push(w);
      note(g, { t: "weather", weather: w, text: w ? `翻开第 1 张天气〔${weatherName(w)}〕。` : "天气堆空了，这一轮没有天气。" });
      if (isPhase(w)) { phaseAllIn(g, 1); showdown(g); return; }
      openStreet(g, 2);
    } else showdown(g);
  }
  /** 相位（主人 10/30 确认）：没弃牌的人全押——上限 = 没弃牌的人里筹码最少那位的全部筹码（这一轮已下的 + 手上的），其他人押到同样的数；
   *  之前已经押得比这个数多的（有人全押得少、开过边池）不退，边池照旧。不借，不再下注。
   *  at = 第几张天气是相位：1（第一轮下注后翻开）→ 接着直接比分；2（亮牌时翻开）→ 比分之前补押到这个数 */
  function phaseAllIn(g, at) {
    const live = g.order.filter(id => inHand(g, id));
    const cap = Math.min(...live.map(id => g.sides[id].bet + Math.max(0, g.sides[id].chips)));
    live.forEach(id => {
      const s = g.sides[id], n = B().pay(s, cap - s.bet);
      s.st += n;
      if (s.chips <= 0) s.allIn = true;
    });
    g.allIn = { at, cap };
    note(g, { t: "allIn", at, amount: cap, text: at === 1
      ? `翻到相位：没弃牌的人全押，各押到 ${cap} 枚（没弃牌的人里筹码最少那位的全部筹码），不再下注，直接比分。`
      : `第 2 张天气是相位：没弃牌的人补押到 ${cap} 枚（没弃牌的人里筹码最少那位的全部筹码），再比分。` });
  }

  /* ---------- 结算 ---------- */
  const carryOf = (g) => (g.carry ? g.carry.amount : 0);
  /** 底池（主池 + 边池）：按没弃牌的人各自押了多少分层，每一层只有押到这么多的人能分（同德州）。
   *  返回 [{ amount, eligible: [id……] }]；弃牌的人押的也在里面（他们不参与分）；上一轮滚存下来的算进主池（这一轮还在牌局里的人都能分） */
  function potsOf(g) {
    const live = g.order.filter(id => inHand(g, id));
    const levels = uniq(live.map(id => g.sides[id].bet)).sort((x, y) => x - y);
    const out = [];
    let prev = 0;
    levels.forEach(L => {
      let amount = 0;
      g.order.forEach(id => { amount += Math.max(0, Math.min(g.sides[id].bet, L) - prev); });
      if (amount > 0) out.push({ amount, eligible: live.filter(id => g.sides[id].bet >= L) });
      prev = L;
    });
    let rest = 0;
    g.order.forEach(id => { rest += Math.max(0, g.sides[id].bet - prev); });
    if (rest && out.length) out[out.length - 1].amount += rest;
    const carry = carryOf(g);
    if (carry) { if (out.length) out[0].amount += carry; else out.push({ amount: carry, eligible: live }); }
    return out;
  }
  /** 一个池分给 winners：平分，分不开的零头从庄家左边起一人一枚（出局了的也照座位排，滚存的底池最后归同分的人时用得上） */
  function award(g, pot, winners) {
    const share = Math.floor(pot.amount / winners.length);
    let odd = pot.amount - share * winners.length;
    const got = {};
    winners.forEach(id => { got[id] = share; });
    const i = g.order.indexOf(g.dealer), ring = g.order.slice(i + 1).concat(g.order.slice(0, i + 1));
    ring.filter(id => winners.indexOf(id) >= 0).forEach(id => { if (odd > 0) { got[id] += 1; odd -= 1; } });
    winners.forEach(id => { g.sides[id].chips += got[id]; });
    return got;
  }
  /** 亮牌：同时翻开第 2 张公共层牌和第 2 张天气（是相位：比分之前没弃牌的人补押到全押的数目），每人对 2 张公共层牌分别计分求和，
   *  每个池给池里分最高的（同分平分）。这一轮相位全押了、又不是最后一轮：同分的池不分，留在桌上滚到下一轮 */
  function showdown(g) {
    g.stage = "showdown";
    const L2 = g.layerDeck.shift(), w2 = drawWeather(g);
    if (L2) g.layers.push(L2);
    if (w2) g.weathers.push(w2);
    note(g, { t: "reveal", layer: L2, weather: w2, text: `同时翻开第 2 张公共层牌〔${cardName(L2)}〕和第 2 张天气〔${weatherName(w2)}〕。` });
    if (isPhase(w2) && !g.allIn) phaseAllIn(g, 2);
    const live = g.order.filter(id => inHand(g, id));
    const shown = {};
    live.forEach(id => { shown[id] = { card: g.sides[id].card, score: handScore(g.sides[id].card, g.layers, g.weathers) }; });
    const roll = !!g.allIn && g.round < g.rounds, carryIn = carryOf(g);
    const pots = potsOf(g).map(p => {
      const best = Math.max(...p.eligible.map(id => shown[id].score));
      const top = p.eligible.filter(id => shown[id].score === best);
      if (roll && top.length > 1) return Object.assign(p, { winners: [], tied: top, shares: {}, carried: true });
      return Object.assign(p, { winners: top, shares: award(g, p, top) });
    });
    const kept = pots.filter(p => p.carried);
    g.carry = kept.length ? { amount: kept.reduce((t, p) => t + p.amount, 0), from: uniq([].concat(...kept.map(p => p.tied))), r: g.round } : null;
    closeRound(g, Object.assign({ r: g.round, outcome: "showdown", dealer: g.dealer, layers: g.layers.slice(), weathers: g.weathers.slice(), shown, pots,
      winners: pots.length ? pots[0].winners.slice() : [], split: !!(pots.length && pots[0].winners.length > 1), pot: pots.reduce((t, p) => t + p.amount, 0),
      carryIn, carry: carryOf(g), allIn: !!g.allIn }, g.allIn ? { phaseAt: g.allIn.at, cap: g.allIn.cap } : {}));
  }
  /** 只剩一个人没弃牌：他拿走整个底池（含上一轮滚存下来的），不亮牌 */
  function foldWin(g, id) {
    const carryIn = carryOf(g), pot = g.order.reduce((t, k) => t + g.sides[k].bet, 0) + carryIn;
    g.sides[id].chips += pot;
    g.betting = null; g.carry = null;
    closeRound(g, { r: g.round, outcome: "fold", dealer: g.dealer, layers: g.layers.slice(), weathers: g.weathers.slice(), winners: [id], split: false, pot,
      pots: [{ amount: pot, eligible: [id], winners: [id], shares: { [id]: pot } }], carryIn, carry: 0, allIn: false });
  }
  function closeRound(g, res) {
    res.bets = {}; res.delta = {}; res.chips = {}; res.folded = [];
    g.order.forEach(id => {
      const s = g.sides[id];
      res.bets[id] = s.bet; res.delta[id] = s.chips - s.roundStart; res.chips[id] = s.chips;
      if (s.folded) res.folded.push(id);
    });
    g.order.forEach(id => { const s = g.sides[id]; s.bet = 0; s.st = 0; });
    g.betting = null;
    // 这一轮的天气弃掉（之后天气堆抽完时洗回去），翻开的层牌记着（公开）
    g.discards.push(...g.weathers);
    g.usedLayers.push(...g.layers);
    g.weathers = []; g.layers = []; g.peek = null; g.allIn = null;
    g.results.push(res);
    note(g, { t: "result", res: clone(res), text: resultText(g, res) });
    g.stage = "settled";
    startRound(g);
  }
  function resultText(g, res) {
    const n = (id) => nameOf(g, id);
    const chips = `（筹码变动：${g.order.filter(id => res.delta[id]).map(id => `${n(id)} ${res.delta[id] > 0 ? "+" : ""}${res.delta[id]}`).join("，") || "没有"}）`;
    const carryIn = res.carryIn ? `（含上一轮滚存的 ${res.carryIn} 枚）` : "";
    if (res.outcome === "fold") return `第 ${res.r} 轮：其他人都弃牌，${n(res.winners[0])}拿走底池 ${res.pot} 枚${carryIn}${chips}。`;
    const shown = Object.keys(res.shown).map(id => `${n(id)}〔${cardName(res.shown[id].card)}〕${signed(res.shown[id].score)}`).join("，");
    const allIn = res.allIn ? `相位全押（各押到 ${res.cap} 枚）。` : "";
    const pots = res.pots.map((p, i) => `${i ? `边池 ${i}` : "主池"} ${p.amount} 枚`
      + (p.carried ? `${p.tied.map(n).join("、")}同分（相位全押），滚到下一轮`
        : p.winners.length > 1 ? `由${p.winners.map(n).join("、")}平分${res.allIn ? "（相位全押，最后一轮不再滚存）" : ""}` : `归${n(p.winners[0])}`)
      + (i === 0 ? carryIn : "")).join("；");
    return `第 ${res.r} 轮亮牌：${shown}。${allIn}${pots}${chips}。`;
  }
  /** 对局结束：桌上还有滚存的底池就先分掉，扣还借款，按最终筹码数比，最多的赢（一样多的都算赢） */
  function finish(g) {
    g.over = true; g.stage = "over"; g.betting = null; g.loanAsk = null;
    // 滚存的底池没有下一轮了（只剩一个人没出局，提前结束）：归坐在桌上的那个人；一个都不剩就由当时同分的人平分
    if (g.carry) {
      const left = seated(g), to = left.length === 1 ? left : g.carry.from, amount = g.carry.amount;
      award(g, { amount }, to);
      g.carry = null;
      note(g, { t: "carry", ids: to.slice(), amount, text: `桌上滚存的 ${amount} 枚没有下一轮了，${to.length > 1 ? `由${to.map(id => nameOf(g, id)).join("、")}平分` : `归${nameOf(g, to[0])}`}。` });
    }
    const held = {}, chips = {}, loans = {};
    g.order.forEach(id => { const s = g.sides[id]; held[id] = s.chips; s.chips -= s.owe; chips[id] = s.chips; loans[id] = { loan: s.loan, owe: s.owe }; });
    const best = Math.max(...g.order.map(id => chips[id]));
    const winners = g.order.filter(id => chips[id] === best);
    const net = {};
    g.order.forEach(id => { net[id] = chips[id] - g.sides[id].start; });
    g.final = { rounds: g.results.length, winners, chips, held, net, loans, out: g.order.filter(id => g.sides[id].out) };
    const repaid = (id) => (g.sides[id].owe ? `（已扣还借款 ${g.sides[id].owe} 枚）` : "");
    note(g, { t: "over", text: `对局结束：${g.order.map(id => `${nameOf(g, id)} ${chips[id]} 枚${repaid(id)}`).join("，")}——${winners.map(id => nameOf(g, id)).join("、")}赢。` });
  }

  /* ---------- 这名玩家能看到的东西 ---------- */
  /** 别人的手牌、盖下的牌、牌堆的顺序都不在里面；庄家偷看的那张只给庄家。亮牌的结果（results[i].shown）是公开的 */
  function view(g, id) {
    if (!g.sides[id]) fail("没有这名玩家：" + id);
    const me = g.sides[id], b = g.betting, C = CC().CC_CONFIG;
    const seat = (k) => {
      const s = g.sides[k];
      return { id: k, name: nameOf(g, k), chips: s.chips, start: s.start, bet: s.bet, st: s.st, loan: s.loan, owe: s.owe,
        folded: s.folded, allIn: s.allIn, out: s.out, handCount: s.hand.length, played: !!s.card,
        dealer: k === g.dealer, sb: k === g.sb, bb: k === g.bb };
    };
    // 追加窗口开着时，别人放没放弃追加看不出来：waiting 里别人一直算在等（同 High Flux）
    const waiting = b && b.window ? g.order.filter(k => canAct(g, k) && (k !== id || !b.window.passed[id])) : toAct(g);
    const v = {
      mode: MODE, side: id, order: g.order.slice(), round: g.round, rounds: g.rounds, stage: g.stage, over: g.over,
      waiting, myTurn: toAct(g).indexOf(id) >= 0,
      dealer: g.dealer, sb: g.sb, bb: g.bb,
      layers: g.layers.slice(), usedLayers: g.usedLayers.slice(), layerDeckCount: g.layerDeck.length,
      weathers: g.weathers.slice(), deckCount: g.deck.length, discards: g.discards.slice(), elementDeckCount: g.elementDeck.length,
      blinds: [blindOf(g.round, 0), blindOf(g.round, 1)], minBet: minBetNow(g), maxRaises: HOLDEM_CONFIG.maxRaises,
      loan: { unit: C.loan.unit, repay: C.loan.repay }, loanAsk: g.loanAsk ? g.loanAsk.slice() : null,
      // pot：这一轮大家押下去的 + 上一轮相位全押同分滚存下来的（carry，公开）
      pot: g.order.reduce((t, k) => t + g.sides[k].bet, 0) + carryOf(g), carry: g.carry ? clone(g.carry) : null,
      me: Object.assign(seat(id), { hand: me.hand.slice(), card: me.card, history: clone(me.history) }),
      seats: g.order.map(seat),
      // window：跟注后的追加窗口开着（n 第几个、by 谁跟的注、sec 几秒、passed 自己放弃追加了没有；别人放没放弃不写）
      betting: b ? { street: b.street, toAct: b.toAct, raises: b.raises, cur: b.cur, minRaise: minRaise(g), toCall: Math.max(0, b.cur - me.st),
        window: b.window ? { n: b.window.n, by: b.window.by, sec: C.callWindowSec, passed: !!b.window.passed[id] } : null } : null,
      results: clone(g.results),
      log: g.log.filter(e => !e.to || e.to === id).map(e => clone(e)),
      legal: legal(g, id),
      final: g.final ? clone(g.final) : null
    };
    // 庄家偷看的那张只给庄家
    if (id === g.dealer && g.peek) v.peek = clone(g.peek);
    return v;
  }

  /* ---------- 统计：平分底池有多常见（主人 10/30：试玩时统计一下 AI 自对局里平分的局占多少） ---------- */
  /** 一局（打完的）里：打到亮牌的轮数、主池平分的轮数、任何一个池平分的轮数、相位全押的轮数、全押后同分滚存的轮数（滚存的不算平分） */
  function splitStats(g) {
    const sd = g.results.filter(r => r.outcome === "showdown");
    return { rounds: g.results.length, showdowns: sd.length, mainSplit: sd.filter(r => r.split).length, anySplit: sd.filter(r => r.pots.some(p => p.winners.length > 1)).length,
      allIns: sd.filter(r => r.allIn).length, carried: sd.filter(r => r.carry > 0).length };
  }

  const api = {
    HOLDEM_CONFIG, MODE, scoreStack, handScore, chart, cardChart,
    newGame, toAct, legal, act, closeWindow, view, potsOf, resultText, splitStats, minBetNow,
    name: () => HOLDEM_CONFIG.name
  };
  // 配置挂到 High Flux 的 CC_CONFIG 上（同一份对象）；借贷记录里的称呼按这里的名字（counter-cards.js · registerMode）
  if (CC() && CC().bet) {
    CC().CC_CONFIG.holdem = HOLDEM_CONFIG;
    CC().bet.registerMode(MODE, { seats: null, name: nameOf });
  }
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FluxHoldem = api;
})(typeof window !== "undefined" ? window : globalThis);
