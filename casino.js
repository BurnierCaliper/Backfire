/* 赌场的钱（#487）：筹码钱包、牌桌上的输赢记进钱包
 * 规则层不碰网页。牌局本身是 High Flux（counter-cards.js；赌场桌走 CounterCards.casino.*），这里只管钱：
 * 筹码从哪来、押上桌、离桌时剩下的怎么回到钱包。
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
 *
 *   const w = Casino.wallet(存档里的钱包或 null)   → 补齐字段
 *   Casino.welcome(w)                            → 第一次玩：送赠送筹码（只送一次），返回说明
 *   Casino.chips(w)                              → { gift, normal, total, seat } 都按枚（可能有零头）
 *   Casino.buy(w, 枚数, 现有奎支) / Casino.sell(w, 枚数)   → 兑换：200 奎支买 1 枚（奎支不够不能买），1 枚卖 190 奎支（只卖普通筹码的整枚）；
 *                                                  奎支由各模式自己扣 / 加（返回的 cost / gain）
 *   Casino.sit(w, 桌子 id, 买入, { seed })        → 坐上赌场桌（庄家 = AI 或主持人，筹码无限），返回这一局
 *   Casino.leave(w)                              → 离桌：桌上剩下的筹码按倍率回钱包（输了先扣赠送的），返回结算
 */
(function (root) {
  "use strict";

  /* ---------- 配置：所有数值都在这里 ---------- */
  const CASINO_CONFIG = {
    gift: 50,          // 第一次玩赠送的筹码（每个钱包只送一次）
    face: 200,         // 1 枚筹码的面值（奎支）：赌场桌按桌子倍率换算都按这个
    buy: 200,          // 兑换：买 1 枚筹码付多少奎支
    sell: 190          // 兑换：卖 1 枚筹码得多少奎支（和买价的差价是庄家抽成）；只有普通筹码能卖，赠送的不能
  };

  const CC = () => {
    if (!root.CounterCards) throw new Error("要先加载 counter-cards.js（High Flux 的规则）");
    return root.CounterCards;
  };
  const int = (x) => Math.trunc(Number(x) || 0);
  function fail(msg) { throw new Error(msg); }

  /* ---------- 单位：面值（奎支）⇄ 枚 ---------- */
  /** 面值 → 枚（可能有零头） */
  const toChips = (value) => Math.round((Number(value) || 0) / CASINO_CONFIG.face * 1000) / 1000;
  /** 面值写成「12」「1.15」这样的枚数（去掉多余的 0） */
  function fmt(value) {
    const n = toChips(value);
    return String(n).replace(/^-0$/, "0");
  }

  /* ---------- 钱包 ---------- */
  /** 补齐字段（存档里读出来的、旧存档没有的都走这里）；原地改，返回同一个对象 */
  function wallet(w) {
    w = w && typeof w === "object" ? w : {};
    w.v = 1;
    w.gifted = !!w.gifted;
    w.gift = Math.max(0, int(w.gift));
    w.normal = int(w.normal);
    w.seat = w.seat && typeof w.seat === "object" ? w.seat : null;
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
  /** 钱包里有多少（按枚）：gift 赠送 / normal 普通 / total 合计；seat 桌上押着的这一局（没坐桌 = null） */
  function chips(w) {
    wallet(w);
    const s = w.seat;
    return {
      gift: toChips(w.gift), normal: toChips(w.normal), total: toChips(w.gift + w.normal), gifted: w.gifted,
      seat: s ? { kind: s.kind, table: s.table, name: s.name, buyIn: s.buyIn, rate: s.rate, stake: toChips(s.stake.gift + s.stake.normal), over: !!(s.game && s.game.over) } : null
    };
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
   *  赢的部分进普通筹码。返回 { net（面值）, gift（赠送筹码少了多少）, normal（普通筹码变了多少）} */
  function payBack(w, stake, back) {
    const B = stake.gift + stake.normal, g0 = w.gift, n0 = w.normal;
    let loss = Math.max(0, B - back);
    const lg = Math.min(loss, stake.gift); loss -= lg;
    const ln = Math.min(loss, stake.normal); loss -= ln;
    w.gift += stake.gift - lg;
    w.normal += stake.normal - ln + Math.max(0, back - B);
    if (loss > 0) { const g2 = Math.min(loss, w.gift); w.gift -= g2; w.normal -= loss - g2; }
    return { net: back - B, gift: w.gift - g0 - stake.gift, normal: w.normal - n0 - stake.normal };
  }

  /* ---------- 赌场桌：庄家是 AI 或主持人（筹码无限，代表赌场） ---------- */
  /** 能坐的桌子：#486 的配置（倍率 rate、最低买入 minBuyIn、庄家 AI 难度），另带折成钱包多少枚 */
  function tables() {
    return CC().casino.tables().map(t => Object.assign(t, { minBuyInChips: toChips(t.minBuyIn * t.rate), perChip: toChips(t.rate) }));
  }
  /** 坐上赌场桌：买入 buyIn 枚这张桌子的筹码（不少于最低买入），按倍率从钱包里拿（先拿赠送的）。
   *  opt：seed / deck（测试用）/ dealer（"ai" 或 "gm"：谁当庄家，只记着，规则一样）。返回这一局（CounterCards 的对局） */
  function sit(w, tableId, buyIn, opt) {
    opt = opt || {};
    wallet(w);
    if (w.seat) fail("已经坐在桌上了，先离桌");
    const t = CC().casino.table(tableId);
    if (!t) fail("没有这张桌子：" + tableId);
    const n = Math.floor(Number(buyIn));
    if (!Number.isFinite(n) || n < t.minBuyIn) fail(`${t.name}最低买入 ${t.minBuyIn} 枚`);
    const value = n * t.rate;
    if (w.gift + w.normal < value) fail(`筹码不够：买入 ${n} 枚要钱包里 ${fmt(value)} 枚，现有 ${fmt(w.gift + w.normal)} 枚`);
    const game = CC().casino.newGame(t.id, n, { seed: opt.seed, deck: opt.deck });
    const stake = take(w, value);
    w.seat = { kind: opt.dealer === "gm" ? "gm" : "ai", table: t.id, name: t.name, rate: t.rate, buyIn: n, stake, game };
    return game;
  }
  /** 离桌：桌上剩下的筹码（扣还向主持方借的；打到一半离桌，已经押进底池的不退）按倍率回钱包。
   *  返回 { table, chips（桌上剩下的枚数）, buyIn, net（桌上净输赢，枚）, value（剩下的折多少面值）, netChips（钱包净变化，枚）, over, text } */
  function leave(w) {
    wallet(w);
    const s = w.seat;
    if (!s) fail("没坐在桌上");
    const out = CC().casino.cashOut(s.game);
    const back = out.chips * s.rate;
    const paid = payBack(w, s.stake, back);
    w.seat = null;
    const res = { table: s.table, name: s.name, chips: out.chips, buyIn: s.buyIn, net: out.net, value: back, netChips: toChips(paid.net), over: !!s.game.over, gift: toChips(paid.gift), normal: toChips(paid.normal) };
    res.text = `离开${s.name}：桌上剩 ${out.chips} 枚（买入 ${s.buyIn} 枚，${out.net >= 0 ? "赢" : "输"} ${Math.abs(out.net)} 枚），钱包${paid.net >= 0 ? "多了" : "少了"} ${fmt(Math.abs(paid.net))} 枚筹码。`;
    return res;
  }

  const api = { CONFIG: CASINO_CONFIG, toChips, fmt, wallet, welcome, chips, buy, sell, sellable, tables, sit, leave, payBack };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Casino = api;
})(typeof window !== "undefined" ? window : globalThis);
