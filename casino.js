/* 赌场的钱（#487）：筹码钱包、牌桌上的输赢记进钱包
 * 规则层不碰网页。牌局本身是 High Flux（counter-cards.js；赌场桌走 CounterCards.casino.*），
 * 另有 Flux Duel（flux-duel.js）、Flux Hold'em（flux-holdem.js）的赌场桌（#488）、猜大猜小（counter-cards-guess.js）的赌场桌（#528，见下面 GAMES）；
 * 这里只管钱：筹码从哪来、押上桌、离桌时剩下的怎么回到钱包。几种玩法的钱一样算。
 *
 * 钱包：每个存档一份（联机时每位玩家各自一份），由各模式自己存（对象原样放进存档）：
 *   { v, gifted, gift, normal, seat }
 *   - 单位是「面值」，也就是多少奎支。1 枚筹码的面值是 CASINO_CONFIG.face（200 奎支）。
 *     赌场桌的筹码按这张桌子的倍率换算（CC_CONFIG.casino.tables[i].rate：桌上每枚折多少奎支，沿用 #486），
 *     例：后巷小桌每枚 10 奎支，桌上 20 枚 = 钱包 1 枚；贵宾室每枚 200 奎支，桌上 1 枚 = 钱包 1 枚。
 *     所以钱包里可能有零头（例：1.15 枚）。
 *   - gift：赠送筹码。第一次玩时送 CASINO_CONFIG.gift 枚，每个钱包只送一次（gifted 记着送过）。
 *   - normal：普通筹码（买来的、赢来的）。可以是负数：赌场对局结束时还不上的借款，就是欠赌场的。
 *   - 输的时候先扣赠送筹码，赢的时候进普通筹码（用赠送筹码赢来的也是普通筹码）。
 *   - seat：正坐在桌上的这一局（null = 没坐桌）。买入的筹码从钱包里拿出来押在桌上（先拿赠送的），
 *     离桌时按桌上剩下的结算回钱包。打到一半的牌局也在这里，跟着存档走。
 *     牌局里桌上不够时先从钱包补（#520，见下面 topUp）：补上来的也押在桌上、算进买入，seat.topUp 记一共补了多少。
 *
 *   const w = Casino.wallet(存档里的钱包或 null)   → 补齐字段
 *   Casino.welcome(w)                            → 第一次玩：送赠送筹码（只送一次），返回说明
 *   Casino.chips(w)                              → { gift, normal, total, seat } 都按枚（可能有零头）
 *   Casino.buy(w, 枚数, 现有奎支) / Casino.sell(w, 枚数)   → 兑换：200 奎支买 1 枚（奎支不够不能买），1 枚卖 190 奎支（只卖普通筹码的整枚）；
 *                                                  奎支由各模式自己扣 / 加（返回的 cost / gain）
 *   Casino.tables() / Casino.games()             → 能坐的赌场桌（几种玩法，High Flux 在前；每张带 game 是哪种玩法）/ 加载了的玩法
 *   Casino.sit(w, 桌子 id, 买入, { seed })        → 坐上赌场桌开一局（赌场 = AI 或主持人坐庄）：先收入场费（每局一次、不退），
 *                                                  再押买入；返回这一局
 *   Casino.leave(w)                              → 离桌：桌上剩下的筹码按倍率回钱包（输了先扣赠送的），返回结算
 *   Casino.runAi(这一局, 难度)                    → 赌场那几方（AI）走到轮到人（猜大猜小的庄家不用做决定：走 0 步）
 *   Casino.topUp(w, 还差几枚)                     → 桌上不够时先从钱包补（#520）：补到够用，钱包不够就有多少补多少；牌局里由规则层自己来问（refill）
 */
(function (root) {
  "use strict";

  /* ---------- 配置：所有数值都在这里 ---------- */
  const CASINO_CONFIG = {
    gift: 50,          // 第一次玩赠送的筹码（每个钱包只送一次）
    face: 200,         // 1 枚筹码的面值（奎支）：赌场桌按桌子倍率换算、联机对赌押奎支（1 枚 = 200 奎支）都按这个
    buy: 200,          // 兑换：买 1 枚筹码付多少奎支
    sell: 190,         // 兑换：卖 1 枚筹码得多少奎支（和买价的差价是庄家抽成）；只有普通筹码能卖，赠送的不能
    pvpStart: null     // 联机玩家对赌双方开局各押几枚；null = 和 #486 一样（CC_CONFIG.startChips）
  };

  const CC = () => {
    if (!root.CounterCards) throw new Error("要先加载 counter-cards.js（High Flux 的规则）");
    return root.CounterCards;
  };
  const int = (x) => Math.trunc(Number(x) || 0);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function fail(msg) { throw new Error(msg); }

  /* ---------- 几种玩法都能坐赌场桌（#488）：High Flux、Flux Duel、Flux Hold'em、猜大猜小（#528） ----------
   * 桌子放在各自玩法的配置里：High Flux 是 CC_CONFIG.casino.tables（#486），Flux Duel 是 DUEL_CONFIG.casino.tables，
   * Flux Hold'em 是 HOLDEM_CONFIG.casino.tables，猜大猜小是 GUESS_CONFIG.casino.tables；桌子 id 全赌场不重复，长线养成 / 跑团的坐桌指令只认桌子 id。
   * 没加载的玩法（例：只测 High Flux 的页面）就没有它的桌子。钱（买入、入场费、离桌结算、先扣赠送筹码、桌上不够先从钱包补）几种一样，
   * 不一样的只有人坐哪一方、赌场坐哪几方（由 AI 走）：
   *   High Flux：人坐玩家，庄家是赌场（筹码无限）；
   *   Flux Duel：人坐 DUEL_CONFIG.casino.seat（a，第 1 轮先手），另一方是赌场（筹码无限，flux-duel.js · newGame 的 house）；
   *   Flux Hold'em：人坐第一个座位，其余座位是这张桌子难度的 AI（赌场的人：开局筹码和你的买入一样多，由赌场出），没有主持人坐庄；
   *   猜大猜小：人坐 GUESS_CONFIG.casino.seat，庄家是赌场（筹码无限，只抽牌、不用做决定，没有 AI 要走，也没有主持人坐庄）。
   *     赌场里的一局就是一手：入场费坐下时从钱包收（这一手不再从桌上扣，entryPaid），「再来一局」= 离桌结算再坐下。
   * 玩家对赌（pvp*）现在只有 High Flux。 */
  const GAMES = {
    highflux: {
      has: () => !!root.CounterCards,
      name: () => CC().CC_CONFIG.name,
      tables: () => CC().casino.tables(),
      gm: true,
      start: (t, n, opt) => CC().casino.newGame(t.id, n, { seed: opt.seed, deck: opt.deck })
    },
    duel: {
      has: () => !!(root.FluxDuel && root.FluxDuel.DUEL_CONFIG.casino),
      name: () => root.FluxDuel.DUEL_CONFIG.name,
      tables: () => clone(root.FluxDuel.DUEL_CONFIG.casino.tables),
      gm: true,
      start(t, n, opt) {
        const D = root.FluxDuel, c = D.DUEL_CONFIG.casino;
        return D.newGame({ seed: opt.seed, deck: opt.deck, first: c.seat, chipsBy: { [c.seat]: n }, house: D.other(c.seat), names: c.names });
      },
      side: () => root.FluxDuel.DUEL_CONFIG.casino.seat,
      ai: (g) => [root.FluxDuel.other(g.casino.side)]
    },
    holdem: {
      has: () => !!(root.FluxHoldem && root.FluxHoldem.HOLDEM_CONFIG.casino),
      name: () => root.FluxHoldem.HOLDEM_CONFIG.name,
      tables: () => clone(root.FluxHoldem.HOLDEM_CONFIG.casino.tables),
      gm: false,
      start(t, n, opt) {
        const X = root.FluxHoldem, H = X.HOLDEM_CONFIG, names = H.casino.names;
        const k = Math.max(H.minPlayers, Math.min(H.maxPlayers, Math.floor(Number(t.players) || H.maxPlayers)));
        return X.newGame({ seed: opt.seed, players: Array.from({ length: k }, (_, i) => ({ id: "p" + (i + 1), name: names[i], chips: n })) });
      },
      side: () => "p1",
      ai: (g) => g.order.filter(id => id !== g.casino.side)
    },
    // 猜大猜小（#528）：一局 = 一手，人坐 GUESS_CONFIG.casino.seat 带着买入上桌；入场费坐下时从钱包收过了（entryPaid）。
    // opt.deal 测试用（指定三张牌）。桌子另带每轮每格最低注 minBet（桌上的枚数，面板上写）
    guess: {
      has: () => !!(root.CounterCardsGuess && root.CounterCardsGuess.GUESS_CONFIG.casino),
      name: () => root.CounterCardsGuess.GUESS_CONFIG.name,
      tables: () => root.CounterCardsGuess.GUESS_CONFIG.casino.tables.map(t => Object.assign(clone(t), { minBet: root.CounterCardsGuess.tableOf(t.id).minBet })),
      gm: false,
      start(t, n, opt) {
        const G = root.CounterCardsGuess, c = G.GUESS_CONFIG.casino;
        return G.newHand({ seed: opt.seed, table: t.id, players: [{ id: c.seat, name: c.name, chips: n }], entryPaid: true, deal: opt.deal });
      },
      side: () => root.CounterCardsGuess.GUESS_CONFIG.casino.seat,
      ai: () => []
    }
  };
  /** 这一局是哪种玩法（High Flux 的对局没有 mode） */
  const gameOf = (g) => (g && g.mode && GAMES[g.mode] ? g.mode : "highflux");
  /** 这一局的规则、AI：High Flux 是 CounterCards / CounterCardsAI，Flux Duel 是 FluxDuel / FluxDuelAI，Flux Hold'em 是 FluxHoldem / FluxHoldemAI；
   *  猜大猜小是 CounterCardsGuess（庄家不用做决定，没有 AI） */
  const RULES = { highflux: ["CounterCards", "CounterCardsAI"], duel: ["FluxDuel", "FluxDuelAI"], holdem: ["FluxHoldem", "FluxHoldemAI"], guess: ["CounterCardsGuess", null] };
  /** 加载了的玩法：[{ game, name }]，High Flux 在前（名字读各自的配置） */
  function games() { return Object.keys(GAMES).filter(k => GAMES[k].has()).map(k => ({ game: k, name: GAMES[k].name() })); }

  /* ---------- 单位：面值（奎支）⇄ 枚 ---------- */
  /** 面值 → 枚（可能有零头） */
  const toChips = (value) => Math.round((Number(value) || 0) / CASINO_CONFIG.face * 1000) / 1000;
  /** 面值写成「12」「1.15」这样的枚数（去掉多余的 0） */
  function fmt(value) {
    const n = toChips(value);
    return String(n).replace(/^-0$/, "0");
  }

  /* ---------- 钱包 ---------- */
  /** 补齐字段（存档里读出来的、旧存档没有的都走这里）；原地改，返回同一个对象。
   *  坐着赌场桌的：顺便登记「这一局不够时从这个钱包补」（#520，见下面 topUp） */
  function wallet(w) {
    w = w && typeof w === "object" ? w : {};
    w.v = 1;
    w.gifted = !!w.gifted;
    w.gift = Math.max(0, int(w.gift));
    w.normal = int(w.normal);
    w.seat = w.seat && typeof w.seat === "object" ? w.seat : null;
    bind(w);
    return w;
  }
  /** 第一次玩：送赠送筹码。每个钱包只送一次（gifted），送过就什么都不做 */
  function welcome(w) {
    wallet(w);
    if (w.gifted) return [];
    w.gifted = true;
    w.gift += CASINO_CONFIG.gift * CASINO_CONFIG.face;
    return [`第一次来赌场：赠送 ${CASINO_CONFIG.gift} 枚筹码（只能下注，不能换成奎支）。`];
  }
  /** 钱包里有多少（按枚）：gift 赠送 / normal 普通 / total 合计；seat 桌上押着的这一局（没坐桌 = null；
   *  对赌的 seat：side 坐哪一方、stakeKind 押筹码还是押奎支、start 开局几枚、kuizhi 押了多少奎支） */
  function chips(w) {
    wallet(w);
    const s = w.seat;
    // topUp：牌局里从钱包补上桌的（#520；赌场桌按桌上的枚数，已经算进 buyIn；对赌按枚，开局押的 start 不含）
    const seat = !s ? null : s.kind === "pvp"
      ? { kind: "pvp", table: s.table, side: s.side, stakeKind: s.stakeKind, start: s.start, stake: toChips(s.stake.gift + s.stake.normal), kuizhi: s.kuizhi || 0, topUp: s.topUp || 0 }
      : { kind: s.kind, table: s.table, name: s.name, buyIn: s.buyIn, rate: s.rate, fee: s.fee || 0, stake: toChips(s.stake.gift + s.stake.normal), over: !!(s.game && s.game.over), topUp: s.topUp || 0 };
    return { gift: toChips(w.gift), normal: toChips(w.normal), total: toChips(w.gift + w.normal), gifted: w.gifted, seat };
  }
  /* ---------- 兑换：奎支 ⇄ 筹码（只按整枚） ---------- */
  function count(n) {
    const k = Number(n);
    if (!Number.isInteger(k) || k <= 0) fail("要换的筹码数是正整数");
    return k;
  }
  /** 买筹码：n 枚，每枚 CASINO_CONFIG.buy 奎支，进普通筹码。kuizhi = 付钱的那一方现在有多少奎支，不够就不能买。
   *  奎支由调用的模式自己扣（返回的 cost）。返回 { chips, cost, text } */
  function buy(w, n, kuizhi) {
    wallet(w);
    const k = count(n), cost = k * CASINO_CONFIG.buy, have = Math.floor(Number(kuizhi) || 0);
    if (have < cost) fail(`奎支不够：买 ${k} 枚筹码要 ${cost} 奎支，现有 ${have}`);
    w.normal += k * CASINO_CONFIG.face;
    return { chips: k, cost, text: `买了 ${k} 枚筹码，花掉 ${cost} 奎支。` };
  }
  /** 现在能卖几枚：普通筹码的整枚数（赠送的不能卖，零头不能卖，桌上押着的不算） */
  function sellable(w) {
    wallet(w);
    return Math.max(0, Math.floor(w.normal / CASINO_CONFIG.face));
  }
  /** 卖筹码：n 枚普通筹码，每枚得 CASINO_CONFIG.sell 奎支（奎支由调用的模式自己加：返回的 gain）。返回 { chips, gain, text } */
  function sell(w, n) {
    wallet(w);
    const k = count(n), can = sellable(w);
    if (k > can) fail(can ? `只能卖 ${can} 枚：赠送的筹码不能换成奎支` : "没有能卖的筹码：赠送的筹码不能换成奎支");
    const gain = k * CASINO_CONFIG.sell;
    w.normal -= k * CASINO_CONFIG.face;
    return { chips: k, gain, text: `卖了 ${k} 枚筹码，得 ${gain} 奎支。` };
  }

  /** 从钱包里拿出 value 面值押上桌：先拿赠送的，再拿普通的。返回各拿了多少 */
  function take(w, value) {
    const g = Math.min(w.gift, value);
    w.gift -= g; w.normal -= value - g;
    return { gift: g, normal: value - g };
  }
  /** 桌上的输赢记回钱包。stake = 押上桌的 { gift, normal }，back = 离桌时桌上剩下的面值（借款还不上时是负数）。
   *  输的部分先扣押上去的赠送筹码，再扣押上去的普通筹码；还不上的借款先扣钱包里剩下的赠送筹码，再扣普通筹码（可以扣成负数）。
   *  赢的部分进普通筹码。opt.noGift（玩家对赌）：还不上的借款只扣普通筹码。返回 { net（面值）, gift（赠送筹码少了多少）, normal（普通筹码变了多少）} */
  function payBack(w, stake, back, opt) {
    const B = stake.gift + stake.normal, g0 = w.gift, n0 = w.normal;
    let loss = Math.max(0, B - back);
    const lg = Math.min(loss, stake.gift); loss -= lg;
    const ln = Math.min(loss, stake.normal); loss -= ln;
    w.gift += stake.gift - lg;
    w.normal += stake.normal - ln + Math.max(0, back - B);
    if (loss > 0) { const g2 = opt && opt.noGift ? 0 : Math.min(loss, w.gift); w.gift -= g2; w.normal -= loss - g2; }
    return { net: back - B, gift: w.gift - g0 - stake.gift, normal: w.normal - n0 - stake.normal };
  }

  /* ---------- 赌场桌：庄家是 AI 或主持人（筹码无限，代表赌场） ---------- */
  /** 入场费（桌上的枚数）：CC_CONFIG.casino.tables[i].entryFee，每开一局收一次、不退 */
  const feeOf = (t) => Math.max(0, Math.floor(Number(t.entryFee) || 0));
  /** 能坐的桌子：#486 的配置（倍率 rate、最低买入 minBuyIn、庄家 AI 难度）+ 入场费 entryFee，另带折成钱包多少枚。
   *  三种玩法的都在里面（#488，High Flux 在前）：game 是哪种玩法、gameName 玩法名；name 是记录、提示里写的桌名
   *  （Flux 的前面带玩法名，例「Flux Duel · 大厅」；High Flux 的照旧），short 是配置里的桌名（面板上按玩法分组时写） */
  function tables() {
    const out = [];
    games().forEach(({ game, name }) => {
      GAMES[game].tables().forEach(t => {
        out.push(Object.assign(t, { game, gameName: name, short: t.name, name: game === "highflux" ? t.name : `${name} · ${t.name}`,
          entryFee: feeOf(t), minBuyInChips: toChips(t.minBuyIn * t.rate), entryFeeChips: toChips(feeOf(t) * t.rate), perChip: toChips(t.rate) }));
      });
    });
    return out;
  }
  /** 坐上赌场桌开一局：先收入场费（这张桌子的 entryFee 枚，按倍率折成钱包里的筹码，先扣赠送的，不退），
   *  再买入 buyIn 枚这张桌子的筹码（不少于最低买入），按倍率从钱包里拿（先拿赠送的）押在桌上。
   *  opt：seed / deck（测试用）/ dealer（"ai" 或 "gm"：谁当庄家，只记着，规则一样；Flux Hold'em 只有 AI）。
   *  返回这一局（这张桌子那种玩法的对局；Flux 的对局另记 casino：桌子、买入、倍率、AI 难度、game 哪种玩法、side 人坐哪一方） */
  function sit(w, tableId, buyIn, opt) {
    opt = opt || {};
    wallet(w);
    if (w.seat) fail("已经坐在桌上了，先离桌");
    const t = tables().find(x => x.id === tableId);
    if (!t) fail("没有这张桌子：" + tableId);
    const G = GAMES[t.game];
    if (opt.dealer === "gm" && !G.gm) fail(`${t.gameName} 的赌场桌只有 AI，没有主持人坐庄`);
    const n = Math.floor(Number(buyIn));
    if (!Number.isFinite(n) || n < t.minBuyIn) fail(`${t.name}最低买入 ${t.minBuyIn} 枚`);
    const fee = t.entryFee, value = n * t.rate, feeValue = fee * t.rate;
    if (w.gift + w.normal < value + feeValue) fail(`筹码不够：买入 ${n} 枚${fee ? `加入场费 ${fee} 枚` : ""}要钱包里 ${fmt(value + feeValue)} 枚，现有 ${fmt(w.gift + w.normal)} 枚`);
    const game = G.start(t, n, opt);
    if (t.game !== "highflux") game.casino = { table: t.id, name: t.name, buyIn: n, rate: t.rate, difficulty: t.difficulty, game: t.game, side: G.side() };
    take(w, feeValue);                   // 入场费：交给赌场，不退
    const stake = take(w, value);
    w.seat = { kind: opt.dealer === "gm" ? "gm" : "ai", table: t.id, name: t.name, rate: t.rate, buyIn: n, fee, stake, game };
    bind(w);
    return game;
  }
  /** 人那一方桌上剩多少（几种玩法一样算，同 CounterCards.casino.cashOut）：剩下的筹码扣还向主持方借的（对局结束时已经扣过）；
   *  打到一半离桌，已经押进底池的（这一轮下的、滚存的）不退。
   *  猜大猜小：手上的筹码（打完了含连本带利拿回的）；打到一半离桌，已经押下的注不退；没有借贷 */
  function cashOut(g) {
    if (gameOf(g) === "highflux") return CC().casino.cashOut(g);
    if (!g.casino) fail("这一局不是赌场的对局");
    if (gameOf(g) === "guess") {
      const p = g.players.find(x => x.id === g.casino.side), chips = p ? p.chips : 0, net = chips - g.casino.buyIn;
      return { chips, net, value: chips * g.casino.rate, netValue: net * g.casino.rate, loan: 0, owe: 0 };
    }
    const s = g.sides[g.casino.side];
    const chips = s.chips - (g.over ? 0 : s.owe), net = chips - g.casino.buyIn;
    return { chips, net, value: chips * g.casino.rate, netValue: net * g.casino.rate, loan: s.loan, owe: s.owe };
  }
  /** 离桌：桌上剩下的筹码（扣还向主持方借的；打到一半离桌，已经押进底池的不退）按倍率回钱包。
   *  净输赢按总买入算（坐下时的买入 + 牌局里从钱包补的，#520）。
   *  返回 { table, chips（桌上剩下的枚数）, buyIn（总买入）, topUp（其中从钱包补的）, net（桌上净输赢，枚）, value（剩下的折多少面值）, netChips（钱包净变化，枚）, over, text } */
  function leave(w) {
    wallet(w);
    const s = w.seat;
    if (!s) fail("没坐在桌上");
    if (s.kind === "pvp") fail("玩家对赌的桌子要用 pvpLeave 离桌");
    const out = cashOut(s.game);
    const back = out.chips * s.rate;
    const paid = payBack(w, s.stake, back);
    w.seat = null;
    const topUp = s.topUp || 0;
    const res = { table: s.table, name: s.name, chips: out.chips, buyIn: s.buyIn, topUp, net: out.net, value: back, netChips: toChips(paid.net), over: !!s.game.over, gift: toChips(paid.gift), normal: toChips(paid.normal) };
    res.text = `离开${s.name}：桌上剩 ${out.chips} 枚（买入 ${s.buyIn} 枚${topUp ? `，含从钱包补的 ${topUp} 枚` : ""}，${out.net >= 0 ? "赢" : "输"} ${Math.abs(out.net)} 枚），钱包${paid.net >= 0 ? "多了" : "少了"} ${fmt(Math.abs(paid.net))} 枚筹码。`;
    return res;
  }

  /* ---------- 桌上不够时先从钱包补（#520，主人 10/30） ----------
   * 牌局里桌上的筹码不够（每轮开始不够「底注 + 最低下注额」，或者轮到自己下注时不够「要跟的 + 最低下注额」）时，
   * 规则层（counter-cards.js · bet.topUp，三种玩法共用）先问这里能从钱包补多少（refill），补不满的缺口才问借不借。
   * 猜大猜小（#528）：每轮轮到你押、手上不够这一轮每格的最低注时，规则层（counter-cards-guess.js · topUp）先问这里补到最低注；没有借贷，补不满只能不押。
   * 补到正好够用为止（缺口同借贷的算法，只是不用凑整 3 枚）；钱包不够补满就有多少补多少（按桌子的倍率折成整枚，零头补不了）。
   *   赌场桌（AI / 主持人坐庄）：只补人那一方（赌场那几方不补：庄家筹码无限，Flux Hold'em 的 AI 座位由赌场出）；
   *     和买入一样先拿赠送筹码、再拿普通筹码，押在桌上；补上来的算进买入（seat.buyIn、对局的 casino.buyIn 跟着加，
   *     seat.topUp 记一共补了多少），离桌结算按总买入算净输赢。
   *   玩家对赌：押筹码的只补普通筹码（赠送的不能押，同 #487），桌上 1 枚 = 钱包 1 枚；押奎支的从那个人的私人钱包补奎支
   *     （1 枚 = CASINO_CONFIG.face 奎支，奎支由模式扣：pvpBind 给的 purse）；结算按「开局押的 + 补的」算净输赢。
   * 对局对象原样存在存档里，读回来是新的对象：钱包每次读进来（wallet）、坐下（sit）时登记「这一局从这个钱包补」，
   * 对赌桌由模式动这一桌之前登记（pvpBind）。没登记的对局（本地玩法里不接钱包的普通对局）补不到，照旧借贷。 */
  const SOURCE = new WeakMap();        // 对局 → (一方, 还差几枚) → 补了几枚
  /** 人坐赌场桌的哪一方：High Flux 是玩家，Flux 记在对局的 casino.side */
  const humanOf = (g) => (gameOf(g) === "highflux" ? "player" : g.casino && g.casino.side);
  /** 登记：这个钱包坐着的赌场桌（AI / 主持人坐庄），人那一方不够时从这个钱包补。
   *  这个钱包已经离开这一局（离桌了、又坐了别的桌）就不补 */
  function bind(w) {
    const s = w.seat, g = s && s.kind !== "pvp" ? s.game : null;
    if (g && typeof g === "object") SOURCE.set(g, (side, gap) => (w.seat && w.seat.game === g && side === humanOf(g) ? topUp(w, gap) : 0));
  }
  /** 从钱包补 gap 枚（桌上的枚数）到坐着的这一桌：补到够用为止，钱包不够就有多少补多少。返回补了几枚（钱包空了 = 0）。
   *  purse（对赌押奎支时）：{ have() 那个人现有多少奎支, spend(奎支) 扣掉 }，由模式给 */
  function topUp(w, gap, purse) {
    const s = w.seat, want = Math.max(0, Math.floor(Number(gap) || 0)), F = CASINO_CONFIG.face;
    if (!s || !want) return 0;
    let n = 0;
    if (s.kind !== "pvp") {
      n = Math.min(want, Math.floor(Math.max(0, w.gift + w.normal) / s.rate));
      if (n > 0) {
        const got = take(w, n * s.rate);   // 同买入：先拿赠送的，再拿普通的
        s.stake.gift += got.gift; s.stake.normal += got.normal;
        s.buyIn += n;
        if (s.game && s.game.casino) s.game.casino.buyIn += n;
      }
    } else if (s.stakeKind === "chips") {
      n = Math.min(want, Math.floor(Math.max(0, w.normal) / F));
      if (n > 0) { w.normal -= n * F; s.stake.normal += n * F; }
    } else if (purse) {
      n = Math.min(want, Math.floor(Math.max(0, Number(purse.have()) || 0) / F));
      if (n > 0) { purse.spend(n * F); s.kuizhi = (s.kuizhi || 0) + n * F; }
    }
    if (n > 0) s.topUp = (s.topUp || 0) + n;
    return n;
  }
  /** 规则层来问（counter-cards.js · bet.setTopUp 注入的就是它）：这一局的这一方还差 gap 枚，能从钱包补多少（已经补上桌了）。没登记的对局 0 */
  function refill(g, side, gap) {
    const f = g && typeof g === "object" ? SOURCE.get(g) : null;
    return f ? f(side, gap) : 0;
  }
  /** 对赌桌：模式动这一桌之前登记两边从哪补——walletOf(一方) = 坐这一方的人的钱包；purseOf(一方) = 押奎支时那个人的私人钱包（{ have(), spend(奎支) }） */
  function pvpBind(t, walletOf, purseOf) {
    if (!t || !t.game) return;
    SOURCE.set(t.game, (side, gap) => {
      const w = t.seats[side] ? walletOf(side) : null, s = w && w.seat;
      return s && s.kind === "pvp" && s.table === t.id && s.side === side ? topUp(w, gap, purseOf && purseOf(side)) : 0;
    });
  }

  /** 赌场桌的庄家是 AI 时：轮到赌场那几方就让 AI 走（各玩法 AI 的 step，只看那一方的 view），直到轮到人或者这一局结束。
   *  High Flux 是庄家；Flux Duel 是人对面那一方；Flux Hold'em 是人以外的座位（人出局了就由 AI 打到结束）。
   *  随机数按种子和记录条数派生（联机时由房主跑，存档、刷新以后接着走结果一样）。返回走了几步 */
  function runAi(g, level) {
    const kind = gameOf(g);
    if (!RULES[kind][1]) return 0;         // 猜大猜小：庄家只抽牌，不用做决定
    const R = root[RULES[kind][0]], AIm = root[RULES[kind][1]];
    if (!AIm) fail(`要先加载 ${GAMES[kind].name()} 的 AI`);
    if (kind === "highflux") {
      let n = 0;
      while (!g.over && CC().toAct(g).indexOf("dealer") >= 0 && n < 500) {
        if (!AIm.step(g, "dealer", level, CC().makeRng(g.seed + "|ai|" + g.log.length))) break;
        n++;
      }
      return n;
    }
    const ai = GAMES[kind].ai(g);
    let n = 0;
    for (let moved = true; moved && !g.over && n < 3000;) {
      moved = false;
      for (const k of R.toAct(g).filter(x => ai.indexOf(x) >= 0)) {
        if (g.over || R.toAct(g).indexOf(k) < 0) continue;
        if (AIm.step(g, k, level, CC().makeRng(g.seed + "|ai|" + k + "|" + g.log.length))) { n++; moved = true; }
      }
    }
    return n;
  }

  /* ---------- 联机玩家对赌（#487）：一人当庄家、一人当玩家，规则和 #486 完全一样（双方开局一样多），不收入场费 ----------
   * 押筹码（stakeKind "chips"）：桌上 1 枚 = 钱包 1 枚，只能押普通筹码——赠送的不能押，免得两个账号互相输赢把赠送筹码洗成普通筹码；
   *   还不上的借款也只扣普通筹码。
   * 押奎支（stakeKind "kuizhi"）：桌上 1 枚 = CASINO_CONFIG.face（200）奎支，底注 200 奎支、最低下注 = 轮数 × 200……；
   *   奎支由模式自己从钱包里扣、加（pvpSit 返回要扣多少，pvpLeave 返回要加多少，负数 = 还不上的借款）。
   * 桌子：{ id, stakeKind, start, seats: { dealer, player }（坐着的是谁：模式自己的 key，跑团是角色 kit）, game（两边都坐下才开局） } */
  const STAKE_KINDS = ["chips", "kuizhi"];
  const SIDES = ["dealer", "player"];
  const pvpStart = () => Math.max(1, Math.floor(Number(CASINO_CONFIG.pvpStart || CC().CC_CONFIG.startChips) || 1));
  /** 开一张对赌桌（还没人坐） */
  function pvpTable(id, stakeKind) {
    if (STAKE_KINDS.indexOf(stakeKind) < 0) fail("开桌要选押筹码还是押奎支");
    return { id: String(id), stakeKind, start: pvpStart(), seats: { dealer: null, player: null }, game: null };
  }
  /** 坐上对赌桌的一方：押筹码从钱包的普通筹码里拿；押奎支要 kuizhi（这一方现在有多少奎支）够，返回要从奎支里扣多少（押筹码返回 0）。
   *  两边都坐下就开局（opt.seed / opt.deck 测试用） */
  function pvpSit(t, side, key, w, kuizhi, opt) {
    opt = opt || {};
    wallet(w);
    if (SIDES.indexOf(side) < 0) fail("没有这一方：" + side);
    if (t.game || t.seats[side]) fail("这个位置已经有人了");
    if (SIDES.some(k => t.seats[k] === key)) fail("已经坐在这张桌子上了");
    if (w.seat) fail("已经坐在桌上了，先离桌");
    const v = t.start * CASINO_CONFIG.face;
    let pay = 0;
    if (t.stakeKind === "chips") {
      if (w.normal < v) fail(`押筹码只能押普通筹码（赠送的不能押）：要 ${fmt(v)} 枚，普通筹码只有 ${fmt(Math.max(0, w.normal))} 枚`);
      w.normal -= v;
      w.seat = { kind: "pvp", table: t.id, side, stakeKind: "chips", start: t.start, stake: { gift: 0, normal: v } };
    } else {
      const have = Math.floor(Number(kuizhi) || 0);
      if (have < v) fail(`奎支不够：押奎支要 ${v} 奎支（${t.start} 枚 × ${CASINO_CONFIG.face}），现有 ${have}`);
      pay = v;
      w.seat = { kind: "pvp", table: t.id, side, stakeKind: "kuizhi", start: t.start, stake: { gift: 0, normal: 0 }, kuizhi: v };
    }
    t.seats[side] = key;
    // 天气堆按种子洗：带上开局的时刻，同一个编号的桌子每次洗出来不一样（猜不到天气的顺序）
    if (t.seats.dealer && t.seats.player) t.game = CC().newGame({ seed: opt.seed != null ? opt.seed : `pvp|${t.id}|${Date.now()}`, deck: opt.deck, dealerChips: t.start, playerChips: t.start });
    return pay;
  }
  /** 对赌这一方离桌时桌上剩多少枚：打完了 = 最终筹码（扣还借款之后）；还没开局 = 原样退回；
   *  打到一半有人离桌 = 离桌的一方算认输（和弃牌一样）：手上的筹码扣还借款，押进底池的（这一轮下的、滚存的）都归对方 */
  function pvpBack(t, side, leaver) {
    const g = t.game;
    if (!g) return t.start;
    if (g.over) return g.final.chips[side];
    const s = g.sides[side], o = g.sides[side === "dealer" ? "player" : "dealer"];
    const hand = s.chips - s.owe;
    return side === leaver ? hand : hand + s.bet + s.pot + o.bet + o.pot;
  }
  /** 对赌的一方结算离桌：押筹码的按桌上剩下的回钱包（输了扣普通筹码，还不上的借款也只扣普通筹码）；
   *  押奎支的返回 kuizhi = 要加回奎支钱包多少（负数 = 还要再扣）。leaver = 先离桌认输的是哪一方（打完了、没开局都不用给）。
   *  净输赢按开局押的 + 牌局里从钱包补的算（#520）。
   *  返回 { side, chips（桌上剩下的枚数）, net（净输赢，枚）, topUp（从钱包补了几枚）, kuizhi（押奎支：钱包要加多少奎支）, text } */
  function pvpSettle(t, side, w, leaver) {
    wallet(w);
    const s = w.seat;
    if (!s || s.kind !== "pvp" || s.table !== t.id || s.side !== side) fail("没坐在这张桌子的这一方");
    const back = pvpBack(t, side, leaver), topUp = s.topUp || 0;
    const net = back - t.start - topUp;
    const res = { side, chips: back, net, topUp, kuizhi: 0 };
    if (s.stakeKind === "chips") payBack(w, s.stake, back * CASINO_CONFIG.face, { noGift: true });
    else res.kuizhi = back * CASINO_CONFIG.face;
    w.seat = null;
    t.seats[side] = null;
    const unit = s.stakeKind === "chips" ? "枚筹码" : "奎支";
    const amount = (n) => (s.stakeKind === "chips" ? fmt(Math.abs(n) * CASINO_CONFIG.face) : String(Math.abs(n) * CASINO_CONFIG.face));
    res.text = !t.game ? `对赌还没开局就离桌，押的原样退回。`
      : `对赌结算（${CC().sideName(side)}）：桌上剩 ${back} 枚（开局 ${t.start} 枚${topUp ? `，中途从钱包补了 ${topUp} 枚` : ""}），${net >= 0 ? "赢" : "输"} ${amount(net)} ${unit}。`;
    return res;
  }

  const api = { CONFIG: CASINO_CONFIG, toChips, fmt, wallet, welcome, chips, buy, sell, sellable, games, gameOf, tables, sit, cashOut, leave, payBack, runAi,
    topUp, refill, pvpBind,
    STAKE_KINDS, pvpTable, pvpSit, pvpBack, pvpSettle };
  // 桌上不够时先从钱包补（#520）：把 refill 注入三种玩法共用的下注 / 借贷代码（counter-cards.js · bet.setTopUp），
  // 猜大猜小另有自己的一份（counter-cards-guess.js · setTopUp，#528；game.html 里先加载猜大猜小、再加载 casino.js）
  if (root.CounterCards && root.CounterCards.bet && root.CounterCards.bet.setTopUp) root.CounterCards.bet.setTopUp(refill);
  if (root.CounterCardsGuess && root.CounterCardsGuess.setTopUp) root.CounterCardsGuess.setTopUp(refill);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Casino = api;
})(typeof window !== "undefined" ? window : globalThis);
