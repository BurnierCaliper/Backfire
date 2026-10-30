/* Flux Duel（#488）· 两人对决（完全博弈）：规则引擎
 * 玩法名主人 10/30 定为 Flux Duel（中文译名暂不定，界面上直接写英文名，写法和 High Flux 一致），在 CC_CONFIG.duel.name。
 * 规则 Burnier，界面 Akane；High Flux 本身的规则在 counter-cards.js。
 *
 * 不设庄家，两人拿一样的牌：每人 5 张层牌（每轮必须出一张，5 轮正好打完）+ 7 张元素牌（每张整局只能用一次，最后剩 2 张不用）；
 * 没有常态。7 张天气洗混成一堆，每轮开始（下完底注）从堆顶拿一张背面朝上放好——谁都不能偷看、也不能翻，第一轮下注后、结算前自动翻开；
 * 第一轮下注时有人弃牌，这一张就盖着弃掉（谁都不知道是哪张）。
 * 每轮：
 *   0. 借贷：同 High Flux（手上不够「底注 + 最低下注额」的一方先决定借不借，输光的先问，不借这一局就结束）；
 *   1. 双方各下底注 = 1 × 轮数（DUEL_CONFIG.ante）；
 *   2. 同时暗出一张层牌 + 一张元素牌；
 *   3. 第一轮下注：先手每轮轮换（第 1 轮甲先、第 2 轮乙先……，同一轮的两次下注都是这一轮的先手先）；
 *   4. 翻开这一轮的天气；翻到相位：双方全押（上限 = 筹码较少一方的全部筹码），不再下注，直接比分；
 *   5. 第二轮下注；
 *   6. 结算：各自用自己的元素牌打对方的层牌（CounterCards.score：克制表 + 这一轮的天气），分高的赢；
 *      分差定分档（DUEL_CONFIG.tierExtra 三档：差 1 / 差 2 / 差 3 及以上——分差最大 ±4，超过 3 按 3）；
 *      亮不亮牌看 DUEL_CONFIG.reveal（主人 10/30：先按原规则不亮，试玩后再定）：不亮时只公开胜负、分档和筹码变动。
 * 下注、加注（最低额 = 轮数、每回合最多加注 2 次）、下注不封顶（跟不起要先借，#496）、跟注后的 3 秒追加窗口、借贷（3 借 4 还、不设上限）、
 * 弃牌、平局滚池、第 5 轮平局各退各的、分档赔付，都直接用 counter-cards.js 里同一份代码（CounterCards.bet / CounterCards.settle），
 * 数值也读同一份 CC_CONFIG（minBet / maxRaises / callWindowSec / loan）。
 * 相位全押打平（夕夏 10/30）：底池保留，滚到下一轮；最后一轮双方平分底池。
 * 对局结束按最终筹码数（扣还借款之后）比胜负。规则层不碰网页：AI 在 flux-duel-ai.js，界面在 flux-duel-ui.js。
 *
 *   const g = FluxDuel.newGame({ seed: "A" });
 *   FluxDuel.toAct(g)                         → 现在等谁：["a"] / ["b"] / ["a", "b"]（暗出牌、追加窗口时两边都能动）/ []（结束了）
 *   FluxDuel.legal(g, "a")                    → 这一方现在能做的（暗出：每种「层牌 + 元素牌」的组合各一项 { type: "play", layer, element }）
 *   FluxDuel.act(g, "a", { type: "play", layer: "armor", element: "fire" })
 *   FluxDuel.act(g, "a", { type: "bet", amount: 2 })   → 下注回合里的操作同 High Flux：check / bet / call / raise / fold / pass / borrow
 *   FluxDuel.closeWindow(g)                   → 跟注后的追加窗口到时间（同 CounterCards.closeWindow）
 *   FluxDuel.view(g, "a")                     → 这一方能看到的（对方的手牌、暗出的牌、没翻开的天气都不在里面）
 *   FluxDuel.chart(g.weather)                 → 克制表（得分）：这一轮的天气下每张元素牌打每张层牌的实际得分（CounterCards.chart 换成 Duel 的说法）
 */
(function (root) {
  "use strict";

  /* ---------- 配置：所有数值都在这里（挂在 CounterCards.CC_CONFIG.duel 上） ---------- */
  // 下注最低额（CC_CONFIG.minBet）、每回合最多加注几次（maxRaises）、追加窗口秒数（callWindowSec）、借贷（loan）沿用 High Flux 的同一份配置
  const DUEL_CONFIG = {
    name: "Flux Duel",                 // 玩法名（主人 10/30 定名）：菜单、设置页、牌桌标题、规则说明都读这个
    rounds: 5,                         // 打 5 轮：每人 5 张层牌正好打完
    startChips: null,                  // 开局筹码，双方一样；null = 和 High Flux 一样（CC_CONFIG.startChips）
    ante: [1, 2, 3, 4, 5],             // 第 1–5 轮双方各下的底注（1 × 轮数）
    // 分档赔付（下标 = 分差）：差 1 赢家拿走底池；差 2 输家再赔自己这一轮下注额 × 0.5；差 3 及以上 × 1。
    // Duel 是双方各算一个分再比，分差最大 ±4，±3 这一档打得出来（主人 10/30：先留三档，放在 Duel 自己的配置里，试玩后再定）；分差超过 3 按差 3
    tierExtra: [0, 0, 0.5, 1],
    // 结算时亮不亮牌（主人 10/30：试玩后再定，先按原规则不亮）。
    // false：不亮，只公开胜负、分档和筹码变动；true：结算公开双方出的层牌、元素牌和各自的得分（可以记牌推理）
    reveal: false,
    seats: ["a", "b"],                 // 两方的代号（第 1 轮 a 先手，开局可以换）
    seatNames: { a: "甲", b: "乙" }    // 记录里怎么称呼两方（开局可以按名字换）
  };
  const MODE = "duel";
  const SEATS = DUEL_CONFIG.seats;
  const CC = () => root.CounterCards;
  const B = () => root.CounterCards.bet;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const other = (k) => (k === SEATS[0] ? SEATS[1] : SEATS[0]);
  function fail(msg) { throw new Error(msg); }
  function needCC() {
    if (!CC() || !CC().bet) fail(DUEL_CONFIG.name + " 要先加载 counter-cards.js（High Flux 的计分、下注）");
  }
  const cardName = (c) => CC().cardName(c);
  const weatherName = (w) => (w ? CC().weatherName(w) : "没有天气");
  const nameOf = (g, k) => (g.names && g.names[k]) || DUEL_CONFIG.seatNames[k] || k;
  const signed = (n) => (n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0");
  const uniq = (a) => a.filter((x, i) => a.indexOf(x) === i);
  const startChips = () => (DUEL_CONFIG.startChips != null ? DUEL_CONFIG.startChips : CC().CC_CONFIG.startChips);
  /** 第 round 轮的底注（1 × 轮数） */
  function anteOf(round) {
    const t = DUEL_CONFIG.ante;
    return t[Math.max(0, Math.min(t.length - 1, (Number(round) || 1) - 1))];
  }
  const behind = (s) => (s.infinite ? Infinity : s.chips);
  /** 第 round 轮的先手：第 1 轮 g.first，之后每轮轮换 */
  const leadOf = (g, round) => ((round % 2 === 1) ? g.first : other(g.first));

  /* ---------- 开局 ---------- */
  /** opt：seed；chips（双方开局筹码，默认 DUEL_CONFIG.startChips）/ chipsBy: { a, b }；
   *  house（赌场：筹码无限的庄坐哪一方，"a" / "b"）；first（第 1 轮先手，默认 "a"）；names（{ a, b }：记录里的称呼）；
   *  deck（测试用：指定天气堆的顺序，第 0 张是第 1 轮的天气） */
  function newGame(opt) {
    opt = opt || {};
    needCC();
    const C = CC().CC_CONFIG;
    const seed = String(opt.seed != null ? opt.seed : Date.now());
    const base = opt.chips != null ? Number(opt.chips) : startChips();
    const chipsOf = (v) => Math.max(0, Math.floor(Number(v != null ? v : base) || 0));
    const deck = opt.deck ? opt.deck.slice() : CC().shuffle(C.weathers, CC().makeRng(seed + "|duel-weather"));
    deck.forEach(w => { if (C.weathers.indexOf(w) < 0) fail("没有这张天气牌：" + w); });
    const side = (k) => {
      const inf = opt.house === k, chips = inf ? 0 : chipsOf(opt.chipsBy && opt.chipsBy[k]);
      return { layers: C.layers.slice(), elements: C.elements.slice(), layer: null, element: null,
        chips, start: chips, infinite: inf, bet: 0, pot: 0, st: 0, roundStart: chips, loan: 0, owe: 0, history: [] };
    };
    if (opt.house && SEATS.indexOf(opt.house) < 0) fail("没有这一方：" + opt.house);
    const g = {
      v: 1, mode: MODE, seed, rounds: DUEL_CONFIG.rounds, round: 0, stage: "start", over: false,
      first: SEATS.indexOf(opt.first) >= 0 ? opt.first : SEATS[0],   // 第 1 轮的先手（之后每轮轮换）
      lead: null,                // 这一轮的先手
      names: Object.assign({}, DUEL_CONFIG.seatNames, opt.names || {}),
      weather: null,             // 这一轮翻开的天气（翻开之前是 null）
      hidden: null,              // 这一轮背面朝上放好的天气（第一轮下注后翻开；谁都看不到，不进 view）
      deck,                      // 天气堆（第 0 张是下一轮的；背面朝上，谁都看不到）
      gone: [],                  // 前几轮翻开过的天气（公开）
      buried: 0,                 // 没翻开就弃掉的天气张数（第一轮下注时有人弃牌：这一轮的天气盖着弃掉，谁都不知道是哪张）
      sides: { a: side("a"), b: side("b") },
      betting: null, allIn: false, loanAsk: null,
      results: [], log: [], final: null
    };
    startRound(g);
    return g;
  }
  const note = (g, entry) => B().note(g, entry);

  /* ---------- 每轮开始：借贷 → 底注 → 暗出 ---------- */
  function startRound(g) {
    if (g.round >= g.rounds) { finish(g); return; }
    g.round += 1;
    if (g.weather) g.gone.push(g.weather);
    g.weather = null;
    g.lead = leadOf(g, g.round);
    SEATS.forEach(k => { const s = g.sides[k]; s.layer = null; s.element = null; s.bet = 0; s.st = 0; s.roundStart = s.chips; });
    g.betting = null; g.allIn = false;
    // 借贷：手上的筹码不够这一轮「底注 + 最低下注额」的一方先决定借不借；输光的先问——它不借这一局就结束了，免得另一方白借
    g.stage = "loan";
    g.loanAsk = SEATS.filter(k => B().loanOption(g, k)).sort((x, y) => Number(B().busted(g.sides[y])) - Number(B().busted(g.sides[x])));
    if (g.loanAsk.length) {
      note(g, { t: "loanAsk", sides: g.loanAsk.slice(), text: `第 ${g.round} 轮开始前：${g.loanAsk.map(k => nameOf(g, k)).join("、")}手上的筹码不够这一轮的底注 + 最低下注额（${anteOf(g.round) + CC().minBetOf(g.round)} 枚），可以向主持方借。` });
      return;
    }
    beginRound(g);
  }
  /** 借贷问完了（或者不用问）：下底注，进暗出 */
  function beginRound(g) {
    const [x, y] = SEATS.map(k => g.sides[k]);
    g.loanAsk = null;
    if (B().busted(x) || B().busted(y)) { finish(g); return; }
    // 有一方手上已经没有筹码（只剩滚存底池里的那一份）：双方都不下底注（同 High Flux）
    const ante = Math.max(0, Math.min(anteOf(g.round), behind(x), behind(y)));
    SEATS.forEach(k => B().pay(g.sides[k], ante));
    // 这一轮的天气：从堆顶拿一张背面朝上放好（堆翻完了就没有天气）
    g.hidden = g.deck.length ? g.deck.shift() : null;
    note(g, { t: "round", lead: g.lead, text: (ante > 0 ? `第 ${g.round} 轮：双方各下 ${ante} 枚底注` : `第 ${g.round} 轮：有一方手上已经没有筹码，这一轮双方都不下底注`)
      + `（本轮最低下注 ${CC().minBetOf(g.round)} 枚，${nameOf(g, g.lead)}先手）。`
      + (g.hidden ? "这一轮的天气背面朝上放好，第一轮下注后才翻开。" : "天气堆翻完了，这一轮没有天气。") });
    g.stage = "play";
  }
  function nextLoan(g) {
    g.loanAsk.shift();
    if (!g.loanAsk.length) beginRound(g);
  }
  function noLoan(g, side) {
    const out = B().busted(g.sides[side]);
    note(g, { t: "noLoan", by: side, text: out ? `${nameOf(g, side)}输光了，没有向主持方借，对局结束。` : `${nameOf(g, side)}没有向主持方借。` });
    if (out) { finish(g); return; }
    nextLoan(g);
  }

  /* ---------- 现在等谁、能做什么 ---------- */
  function toAct(g) {
    if (g.over) return [];
    switch (g.stage) {
      case "loan": return g.loanAsk && g.loanAsk.length ? [g.loanAsk[0]] : [];
      case "play": return SEATS.filter(k => !g.sides[k].element);
      case "bet1": case "bet2": return B().waiting(g);
      default: return [];
    }
  }
  function legal(g, side) {
    if (toAct(g).indexOf(side) < 0) return [];
    const me = g.sides[side];
    switch (g.stage) {
      case "loan": {
        const lo = B().loanOption(g, side);
        return (lo ? [lo] : []).concat([{ type: "noLoan" }]);
      }
      case "play": {
        const out = [];
        uniq(me.layers).forEach(layer => uniq(me.elements).forEach(element => out.push({ type: "play", layer, element })));
        return out;
      }
      case "bet1": case "bet2": return B().legal(g, side);
      default: return [];
    }
  }

  /* ---------- 操作 ---------- */
  function act(g, side, a) {
    if (g.over) fail("这一局已经结束了");
    if (SEATS.indexOf(side) < 0) fail("没有这一方：" + side);
    if (!a || typeof a.type !== "string") fail("操作格式不对");
    if (toAct(g).indexOf(side) < 0) fail(`现在不是${nameOf(g, side)}操作的时候`);
    // 下注回合（含借贷、追加窗口）：直接交给 High Flux 的同一份代码
    if (g.stage === "bet1" || g.stage === "bet2") { B().step(g, side, a); return g; }
    const ok = legal(g, side).find(o => o.type === a.type && (o.layer == null || o.layer === a.layer) && (o.element == null || o.element === a.element));
    if (!ok) fail(`${nameOf(g, side)}现在不能这样做（${a.type}${a.layer ? " " + cardName(a.layer) : ""}${a.element ? " " + cardName(a.element) : ""}）`);
    switch (a.type) {
      case "play": play(g, side, a.layer, a.element); break;
      case "borrow": B().borrow(g, side, a, ok); nextLoan(g); break;
      case "noLoan": noLoan(g, side); break;
      default: fail("未知操作：" + a.type);
    }
    return g;
  }
  function take(list, card) {
    const i = list.indexOf(card);
    if (i < 0) fail("手里没有这张牌：" + cardName(card));
    list.splice(i, 1);
  }
  /** 暗出一张层牌 + 一张元素牌；两边都出好了开第一轮下注（这一轮的先手先） */
  function play(g, side, layer, element) {
    const me = g.sides[side];
    take(me.layers, layer); take(me.elements, element);
    me.layer = layer; me.element = element;
    me.history.push({ r: g.round, layer, element });
    note(g, { t: "play", by: side, text: `${nameOf(g, side)}暗出了一张层牌、一张元素牌。` });
    note(g, { t: "myCards", by: side, to: side, layer, element, text: `你暗出了〔${cardName(layer)}〕〔${cardName(element)}〕。` });
    if (SEATS.every(k => g.sides[k].element)) B().open(g, 1, g.lead);
  }

  /* ---------- 下注回合结束 / 弃牌以后（counter-cards.js 的下注代码按 g.mode 回到这里） ---------- */
  function closeStreet(g, street) {
    if (street === 1) revealWeather(g); else showdown(g);
  }
  /** 第一轮下注后翻开这一轮的天气；相位：双方全押，直接比分；其余开第二轮下注 */
  function revealWeather(g) {
    const w = g.hidden;
    g.hidden = null;
    g.weather = w;
    note(g, { t: "weather", weather: w, text: w ? `翻开这一轮的天气〔${weatherName(w)}〕。` : "这一轮没有天气。" });
    if (w && w === CC().CC_CONFIG.allInWeather) { allIn(g); return; }
    B().open(g, 2, g.lead);
  }
  /** 相位：双方全押，上限是筹码较少一方的全部筹码（同 High Flux 的 cap），不再下注，直接比分 */
  function allIn(g) {
    g.allIn = true; g.stage = "allIn";
    const c = B().cap(g);
    SEATS.forEach(k => { const s = g.sides[k]; B().pay(s, c - s.bet); });
    note(g, { t: "allIn", amount: c, text: `翻到相位：双方全押，各押 ${c} 枚（筹码较少一方的全部筹码），不再下注，直接比分。` });
    showdown(g);
  }
  /** 这一方的得分：自己的元素牌打对方的层牌，这一轮的天气（CounterCards.score） */
  function scoreOf(g, side) {
    const me = g.sides[side], op = g.sides[other(side)];
    return CC().score(me.element, op.layer, g.weather);
  }
  /** 比分、结算。分档赔付、平局滚池、最后一轮各退各的直接用 CounterCards.settle（甲当「玩家」、乙当「庄家」：分差 = 甲 − 乙），
   *  分档表用 Duel 自己的三档；相位全押打平底池照样滚存（不退），最后一轮双方平分 */
  function showdown(g) {
    const A = g.sides.a, Bs = g.sides.b;
    const sc = { a: scoreOf(g, "a"), b: scoreOf(g, "b") };
    const last = g.round >= g.rounds;
    const pick = (x) => ({ bet: x.bet, pot: x.pot, chips: x.chips, infinite: x.infinite });
    const out = CC().settle(sc.a - sc.b, { player: pick(A), dealer: pick(Bs) }, { last, tierExtra: DUEL_CONFIG.tierExtra });
    const after = { a: out.after.player, b: out.after.dealer };
    const winner = out.winner === "player" ? "a" : out.winner === "dealer" ? "b" : null;
    const res = { r: g.round, weather: g.weather, allIn: g.allIn, outcome: winner || "tie", winner, tier: out.tier, extra: out.extra, pot: out.pot,
      bets: { a: A.bet, b: Bs.bet } };
    if (!winner && g.allIn && last) {
      // 相位全押、最后一轮打平：双方平分底池（多出的 1 枚给这一轮的先手；双方押的一样多时就是各自拿回）
      const total = A.pot + Bs.pot + A.bet + Bs.bet, half = Math.floor(total / 2);
      SEATS.forEach(k => { after[k] = { chips: g.sides[k].chips + half + (k === g.lead ? total - 2 * half : 0), pot: 0 }; });
      res.split = true; res.pot = total;
    } else if (out.refund) res.refund = true;
    else if (out.rollover) res.rollover = true;
    if (DUEL_CONFIG.reveal) res.shown = { a: { layer: A.layer, element: A.element, score: sc.a }, b: { layer: Bs.layer, element: Bs.element, score: sc.b } };
    SEATS.forEach(k => { g.sides[k].chips = after[k].chips; g.sides[k].pot = after[k].pot; });
    closeRound(g, res);
  }
  /** 弃牌：立即判负，输掉自己已下的筹码（包括自己在滚存底池里的那一份），对方拿走整个底池（同 High Flux） */
  function foldOut(g, side) {
    const A = g.sides.a, Bs = g.sides.b, w = g.sides[other(side)];
    const potAll = A.pot + Bs.pot + A.bet + Bs.bet;
    w.chips += potAll;
    A.pot = 0; Bs.pot = 0;
    closeRound(g, { r: g.round, weather: g.weather, allIn: false, outcome: "fold", folded: side, winner: other(side), tier: 0, extra: 0, pot: potAll, bets: { a: A.bet, b: Bs.bet } });
  }
  function closeRound(g, res) {
    res.delta = {}; res.chips = {};
    SEATS.forEach(k => { const s = g.sides[k]; res.delta[k] = s.chips - s.roundStart; res.chips[k] = s.infinite ? null : s.chips; });
    SEATS.forEach(k => { g.sides[k].bet = 0; g.sides[k].st = 0; });
    g.betting = null;
    // 第一轮下注时有人弃牌：这一轮的天气没翻开，盖着弃掉（谁都不知道是哪张）
    if (g.hidden) { g.hidden = null; g.buried += 1; res.buried = true; }
    g.results.push(res);
    note(g, { t: "result", res: clone(res), text: resultText(g, res) });
    g.stage = "settled";
    startRound(g);
  }
  /** 结算的公开说明：不亮牌时只说胜负、分档和筹码变动；亮牌时另写双方出的牌和得分 */
  function resultText(g, res) {
    const n = (k) => nameOf(g, k);
    const delta = (k) => { const v = res.delta[k]; return `${n(k)} ${v > 0 ? "+" : ""}${v}`; };
    const chips = `（筹码变动：${delta("a")}，${delta("b")}）`;
    const shown = res.shown ? `亮牌：${SEATS.map(k => `${n(k)}〔${cardName(res.shown[k].layer)}〕〔${cardName(res.shown[k].element)}〕得 ${signed(res.shown[k].score)}`).join("，")}。` : "";
    if (res.outcome === "fold") return `第 ${res.r} 轮：${n(res.folded)}弃牌，${n(res.winner)}拿走底池 ${res.pot} 枚${chips}。${res.buried ? "这一轮的天气没翻开，盖着弃掉。" : ""}`;
    if (res.outcome === "tie") {
      if (res.split) return `第 ${res.r} 轮：相位全押打平，最后一轮双方平分底池 ${res.pot} 枚${chips}。${shown}`;
      if (res.refund) return `第 ${res.r} 轮：平局，最后一轮打平，各自拿回自己下的筹码${chips}。${shown}`;
      return `第 ${res.r} 轮：平局${res.allIn ? "（相位全押）" : ""}，底池 ${res.pot} 枚滚存到下一轮${chips}。${shown}`;
    }
    const extra = res.extra ? `，输家再赔 ${res.extra} 枚` : "";
    return `第 ${res.r} 轮：${n(res.winner)}赢（差 ${res.tier}${res.allIn ? "，相位全押" : ""}），拿走底池 ${res.pot} 枚${extra}${chips}。${shown}`;
  }
  /** 对局结束：滚存底池里剩下的各自拿回，扣还借款，按最终筹码数比胜负（赌场的庄筹码无限：另一方扣还借款后比开局多算赢） */
  function finish(g) {
    g.over = true; g.stage = "over"; g.betting = null; g.loanAsk = null;
    SEATS.forEach(k => { const s = g.sides[k]; s.chips += s.pot; s.pot = 0; });
    const out = SEATS.filter(k => B().busted(g.sides[k]));
    const held = {};
    SEATS.forEach(k => { const s = g.sides[k]; held[k] = s.chips; s.chips -= s.owe; });
    const A = g.sides.a, Bs = g.sides.b;
    const diff = A.infinite ? Bs.start - Bs.chips : Bs.infinite ? A.chips - A.start : A.chips - Bs.chips;
    const winner = diff > 0 ? "a" : diff < 0 ? "b" : null;
    const per = (f) => { const o = {}; SEATS.forEach(k => { o[k] = f(g.sides[k], k); }); return o; };
    g.final = {
      rounds: g.results.length, winner,
      net: per(s => (s.infinite ? null : s.chips - s.start)),
      chips: per(s => (s.infinite ? null : s.chips)),                 // 最终筹码（扣还借款之后，可能是负数）
      held: per((s, k) => (s.infinite ? null : held[k])),             // 扣还借款之前手上的
      loans: per(s => ({ loan: s.loan, owe: s.owe })),
      busted: out
    };
    const repaid = (s) => (s.owe ? `（已扣还借款 ${s.owe} 枚）` : "");
    const tail = winner ? `${nameOf(g, winner)}赢` : "平手";
    note(g, { t: "over", text: `对局结束：${SEATS.filter(k => !g.sides[k].infinite).map(k => `${nameOf(g, k)} ${g.sides[k].chips} 枚${repaid(g.sides[k])}`).join("，")}——按最终筹码数，${tail}。` });
  }

  /* ---------- 克制表（得分）：就是 High Flux 的 CounterCards.chart，换成 Duel 的说法 ---------- */
  /** 这一轮的天气（null = 还没翻开 / 没有天气）下每张元素牌打每张层牌的实际得分（格子同 CounterCards.chart，就是 CounterCards.score）；
   *  图例、说明换成 Duel 的：两边各用自己的元素打对方的层、各算一个分，相减定胜负和分档；相位全押打平滚池 */
  function chart(weather) {
    needCC();
    const C = CC().CC_CONFIG, c = CC().chart(weather), W = c.weatherName;
    const K = { adv: "加分", dis: "扣分", neu: "0 分" }, kindOf = (n) => (n > 0 ? "adv" : n < 0 ? "dis" : "neu");
    c.cells.forEach(row => row.forEach(x => { x.kind = K[x.kindId]; x.baseKind = K[kindOf(x.base)]; }));
    const phase = c.weather === C.allInWeather;
    c.notes = c.notes.slice(1).filter(n => !(phase && n.indexOf(`${W}：不改得分`) === 0));
    c.notes.unshift(`得分 = 克制（克制 +1、被克制 −1、普通 0）+ 天气修正（每 ${Math.round(C.pctStep * 100)}% 记 ±1）。`
      + `你的元素牌打对方的层牌、对方的元素牌打你的层牌都照这张表算；两边的分相减就是分差（定胜负和分档：差 1 / 差 2 / 差 3 及以上）。`);
    if (phase) c.notes.push(`${W}：不改得分；翻到${W}双方全押（上限是筹码较少一方的全部筹码），不再下注直接比分；打平底池滚到下一轮，最后一轮平分`);
    c.legend = { adv: "加分（正分）", dis: "扣分（负分）", neu: "0 分" };
    c.tag = `${DUEL_CONFIG.name} 得分`;
    return c;
  }

  /* ---------- 这一方能看到的东西 ---------- */
  /** 对方的手牌、暗出的牌、天气堆的顺序都不在里面；不亮牌时对方每轮出了什么也不在里面（亮牌时在 results[i].shown） */
  function view(g, side) {
    if (SEATS.indexOf(side) < 0) fail("没有这一方：" + side);
    const me = g.sides[side], op = g.sides[other(side)], b = g.betting;
    const pub = (s) => ({ chips: s.infinite ? null : s.chips, infinite: s.infinite, start: s.infinite ? null : s.start, bet: s.bet, pot: s.pot, st: s.st, loan: s.loan, owe: s.owe });
    // 追加窗口开着时，对方放没放弃追加看不出来：waiting 里对方一直算在等（同 High Flux）
    const waiting = b && b.window ? SEATS.filter(k => k !== side || !b.window.passed[side]) : toAct(g);
    const C = CC().CC_CONFIG;
    const unseen = C.weathers.filter(w => g.gone.indexOf(w) < 0 && w !== g.weather);
    return {
      mode: MODE, side, opponent: other(side), names: clone(g.names), round: g.round, rounds: g.rounds, stage: g.stage, over: g.over,
      waiting, myTurn: toAct(g).indexOf(side) >= 0, lead: g.lead,
      // facedown：这一轮背面朝上放好、还没翻开的天气（只说有没有）；unseen：还没公开过的天气（天气堆里的、背面朝上的、盖着弃掉的）
      weather: g.weather, facedown: !!g.hidden, deckCount: g.deck.length, buried: g.buried, gone: g.gone.slice(), unseen, allIn: g.allIn,
      ante: anteOf(g.round), minBet: CC().minBetOf(g.round), maxRaises: C.maxRaises, reveal: !!DUEL_CONFIG.reveal,
      loan: { unit: C.loan.unit, repay: C.loan.repay }, loanAsk: g.loanAsk ? g.loanAsk.slice() : null,
      pot: g.sides.a.pot + g.sides.b.pot + g.sides.a.bet + g.sides.b.bet,
      me: Object.assign(pub(me), { layers: me.layers.slice(), elements: me.elements.slice(), layer: me.layer, element: me.element, history: clone(me.history) }),
      opp: Object.assign(pub(op), { layerCount: op.layers.length, elementCount: op.elements.length, played: !!op.element }),
      // window：跟注后的追加窗口开着（n 第几个、by 谁跟的注、sec 几秒、passed 自己放弃追加了没有；对方放没放弃不写）
      betting: b ? { street: b.street, toAct: b.toAct, raises: b.raises, toCall: Math.max(0, op.st - me.st),
        window: b.window ? { n: b.window.n, by: b.window.by, sec: C.callWindowSec, passed: !!b.window.passed[side] } : null } : null,
      results: clone(g.results),
      log: g.log.filter(e => !e.to || e.to === side).map(e => clone(e)),
      legal: legal(g, side),
      final: g.final ? clone(g.final) : null
    };
  }

  const api = {
    DUEL_CONFIG, MODE, SEATS, other, anteOf, leadOf,
    newGame, toAct, legal, act, view, resultText, scoreOf, chart,
    closeWindow: (g) => CC().closeWindow(g),
    name: () => DUEL_CONFIG.name, seatName: nameOf
  };
  // 配置挂到 High Flux 的 CC_CONFIG 上（同一份对象）；下注回合结束 / 弃牌以后回到这里（counter-cards.js · registerMode）
  if (CC() && CC().bet) {
    CC().CC_CONFIG.duel = DUEL_CONFIG;
    CC().bet.registerMode(MODE, { seats: SEATS, name: nameOf, ante: (g) => anteOf(g.round), closeStreet, fold: foldOut });
  }
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FluxDuel = api;
})(typeof window !== "undefined" ? window : globalThis);
