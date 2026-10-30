/* 赌场界面（#487）：钱包、兑换、选桌坐下；坐下以后交给这张桌子那种玩法的牌桌：High Flux（counter-cards-ui.js）、
 * Flux Duel（flux-duel-ui.js）、Flux Hold'em（flux-holdem-ui.js）（#488；桌子按玩法分组，玩法名读各自的配置）。
 * 长线养成（rogue-ui.js）、跑团本机（trpg-ui.js）用同一份；钱的规则在 casino.js，各模式把自己的钱包、奎支接进来（adapter）。
 *
 *   CasinoUI.html(v, o)          赌场面板的 HTML。v = 模式给的 casinoView：{ chips, sellable, kuizhi, tables, buy, sell, game }；
 *                                o：head（标题那一行，默认「赌场」）、payer（付钱 / 收钱的是谁，跑团用）、kuizhiLabel
 *   CasinoUI.handle(e, adapter)  面板上的按钮（data-casino）：买 / 卖筹码、坐下、回到牌桌、离桌
 *   CasinoUI.play(adapter)       打开牌桌接着打坐着的这一局；牌桌上「离桌」「再来一局」交回 adapter
 *
 * adapter：{ view(), buy(n), sell(n), sit(桌子, 买入), leave()（没做成就 throw，做成了返回日志行）,
 *            saved()（牌局走了一步：存档）, refresh()（重画模式的画面）, back()（离开牌桌，回到模式的画面） }
 */
(function (root) {
  "use strict";

  const UI_CONFIG = {
    title: "赌场",
    tagline: "和赌场打牌：{games}。每张桌子的筹码面额不同，按倍率折成钱包里的筹码。",   // {games} = 有哪几种玩法（名字读配置）
    // 每种玩法的桌子上面那一句（#488）
    games: {
      highflux: "庄家是 AI，筹码无限。",
      duel: "两人对决：你坐第 1 轮先手，对手是赌场的 AI，筹码无限。",
      holdem: "多人公共牌桌：你坐第一个座位，其余座位是 AI，开局筹码和你的买入一样多（赌场出）。"
    },
    rule: "赠送筹码只能下注、不能换成奎支；输的先扣赠送筹码，赢来的都是普通筹码，能卖。入场费每开一局收一次、不退。",
    leaveTitle: "离桌：桌上剩下的筹码按倍率回钱包（打到一半离桌，已经押进底池的不退）"
  };
  const K = () => root.Casino;
  const AI = () => root.CounterCardsAI;
  /** 坐着的这一局交给哪张牌桌（#488）：都有赌场模式（顶栏「离桌」、总结算「再来一局 / 离桌」、每走一步叫 onChange） */
  const TABLE_UI = {
    highflux: { ui: () => root.CounterCardsUI, opt: () => ({ side: "player" }) },
    duel: { ui: () => root.FluxDuelUI, opt: (g) => ({ side: g.casino.side }) },
    holdem: { ui: () => root.FluxHoldemUI, opt: (g) => ({ human: g.casino.side }) }
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[ch]);
  const num = (n) => String(Math.round((Number(n) || 0) * 1000) / 1000);
  const draft = { buy: 1, sell: 1, buyIn: {} };   // 输入框里填的数：整块重画后照旧
  let msg = "";                                    // 上一步的结果 / 没做成的原因（显示在面板顶上）

  function btn(act, label, o) {
    o = o || {};
    const data = Object.keys(o.data || {}).map(k => ` data-${k}="${esc(o.data[k])}"`).join("");
    return `<button type="button" class="g-btn${o.primary ? " r-main" : ""}${o.cls ? " " + o.cls : ""}" data-casino="${act}"${data}${o.disabled ? " disabled" : ""}${o.title ? ` title="${esc(o.title)}"` : ""}>${label}</button>`;
  }
  const levelName = (lv) => (AI() && AI().LEVEL_NAMES ? AI().LEVEL_NAMES[lv] : lv) || lv;

  /** 一张桌子：倍率、最低买入、入场费（都写成桌上几枚 = 钱包几枚）、庄家 / 对手 AI（Hold'em 写几人桌）、买入多少、坐下 */
  function tableHtml(t, v) {
    const want = Math.max(t.minBuyIn, Math.floor(Number(draft.buyIn[t.id]) || t.minBuyIn));
    const need = t.minBuyInChips + t.entryFeeChips;
    const short = v.chips.total < need;
    const per = t.perChip > 0 ? Math.round(1 / t.perChip * 1000) / 1000 : 0;
    const lv = levelName(t.difficulty);
    const who = t.game === "holdem" ? `${t.players} 人桌 · 对手：${t.players - 1} 名${lv} AI` : t.game === "duel" ? `对手：${lv} AI` : `庄家：${lv} AI`;
    return `<div class="cs-table" data-table="${esc(t.id)}">
      <div class="cs-tname"><b>${esc(t.short || t.name)}</b><small>${esc(who)}</small></div>
      <div class="cs-tmeta">桌上每枚 ${t.rate} 奎支（钱包 1 枚 = 桌上 ${num(per)} 枚）· 最低买入 ${t.minBuyIn} 枚（${num(t.minBuyInChips)} 枚筹码）· 入场费 ${t.entryFee} 枚（${num(t.entryFeeChips)} 枚筹码，每局一次）</div>
      <label class="cs-buyin">买入 <input type="number" min="${t.minBuyIn}" step="1" value="${want}" data-casino-buyin="${esc(t.id)}" aria-label="${esc(t.name)}买入几枚"> 枚</label>
      ${btn("sit", short ? `筹码不够（要 ${num(need)} 枚）` : "坐下", { data: { table: t.id }, disabled: short })}
    </div>`;
  }
  /** 坐着的这一局：回到牌桌 / 离桌 */
  function seatHtml(v) {
    const s = v.chips.seat, g = v.game;
    const where = !g ? "" : g.over ? "这一局打完了" : `第 ${g.round} / ${g.rounds} 轮`;
    return `<div class="cs-seat"><p>你坐在<b>${esc(s.name)}</b>：买入 ${s.buyIn} 枚，交了入场费 ${s.fee} 枚 · ${esc(where)}</p>
      <div class="cs-btns">${btn("play", g && g.over ? "看总结算" : "回到牌桌", { primary: true })}${btn("leave", "离桌", { title: UI_CONFIG.leaveTitle })}</div></div>`;
  }
  function html(v, o) {
    o = o || {};
    const C = K().CONFIG, ch = v.chips;
    const wallet = `<div class="cs-wallet">
        <span>筹码 <b>${num(ch.total)}</b> 枚</span>
        <span>赠送 <b>${num(ch.gift)}</b>（只能下注）</span>
        <span>普通 <b>${num(ch.normal)}</b>（能卖 ${v.sellable} 枚）</span>
        ${v.kuizhi != null ? `<span>${esc(o.kuizhiLabel || "奎支")} <b>${v.kuizhi}</b></span>` : ""}
      </div>`;
    const ex = `<div class="cs-ex">
        <label>买 <input type="number" min="1" step="1" value="${draft.buy}" data-casino-n="buy" aria-label="买几枚筹码"> 枚</label>
        ${btn("buy", `买筹码（每枚 ${C.buy} 奎支）`, { disabled: v.kuizhi != null && v.kuizhi < C.buy, title: v.kuizhi != null && v.kuizhi < C.buy ? `奎支不够：买 1 枚要 ${C.buy}` : "" })}
        <label>卖 <input type="number" min="1" step="1" value="${draft.sell}" data-casino-n="sell" aria-label="卖几枚筹码"> 枚</label>
        ${btn("sell", `卖筹码（每枚 ${C.sell} 奎支）`, { disabled: !v.sellable, title: v.sellable ? "" : "没有能卖的筹码：赠送的筹码不能换成奎支" })}
      </div>`;
    // 桌子按玩法分组（#488）：High Flux、Flux Duel、Flux Hold'em，标题是玩法名（读配置）
    const groups = [];
    v.tables.forEach(t => {
      const k = t.game || "highflux";
      let gr = groups.find(x => x.k === k);
      if (!gr) groups.push(gr = { k, name: t.gameName || k, list: [] });
      gr.list.push(t);
    });
    const tables = ch.seat ? seatHtml(v) : groups.map(gr => `<div class="cs-game" data-game="${esc(gr.k)}"><h3>${esc(gr.name)}</h3>
        ${UI_CONFIG.games[gr.k] ? `<p class="r-hint">${esc(UI_CONFIG.games[gr.k])}</p>` : ""}
        <div class="cs-tables">${gr.list.map(t => tableHtml(t, v)).join("")}</div></div>`).join("");
    return `<section class="casino" data-casino-root>${o.head || `<h2>${esc(UI_CONFIG.title)}</h2>`}
      <p class="r-hint">${esc(UI_CONFIG.tagline.replace("{games}", groups.map(gr => gr.name).join("、")))}</p>
      ${msg ? `<p class="cs-msg" role="status">${esc(msg)}</p>` : ""}
      ${wallet}${o.payer || ""}${ex}${tables}
      <p class="r-hint cs-rule">${esc(UI_CONFIG.rule)}</p></section>`;
  }

  /** 面板上的按钮。返回 true = 处理了 */
  function handle(e, adapter) {
    const b = e.target && e.target.closest ? e.target.closest("[data-casino]") : null;
    if (!b || b.disabled) return false;
    const box = b.closest("[data-casino-root]");
    const read = (sel) => { const el = box && box.querySelector(sel); return el ? Math.floor(Number(el.value)) : NaN; };
    try {
      switch (b.dataset.casino) {
        case "buy": draft.buy = read('[data-casino-n="buy"]'); msg = lines(adapter.buy(draft.buy)); break;
        case "sell": draft.sell = read('[data-casino-n="sell"]'); msg = lines(adapter.sell(draft.sell)); break;
        case "sit": {
          const id = b.dataset.table;
          draft.buyIn[id] = read(`[data-casino-buyin="${id}"]`);
          msg = lines(adapter.sit(id, draft.buyIn[id]));
          if (play(adapter)) return true;
          break;
        }
        case "play": if (play(adapter)) return true; break;
        case "leave": msg = lines(adapter.leave()); break;
        default: return false;
      }
    } catch (err) { msg = err.message; }
    adapter.refresh();
    return true;
  }
  const lines = (notes) => (Array.isArray(notes) ? notes.join(" ") : "");

  /** 打开牌桌：这张桌子那种玩法的界面，人坐自己那一方（High Flux 是玩家），赌场那几方是这张桌子难度的 AI；
   *  「离桌」结算回钱包、回到模式的画面，「再来一局」同一张桌子、同样的买入再开一局 */
  function play(adapter) {
    const v = adapter.view(), g = v.game;
    const T = g && TABLE_UI[K().gameOf(g)], ui = T && T.ui();
    if (!ui) return false;
    const t = v.tables.find(x => x.id === g.casino.table) || { name: g.casino.name, difficulty: g.casino.difficulty, entryFee: 0 };
    const buyIn = g.casino.buyIn;
    const leave = () => { msg = lines(adapter.leave()); adapter.back(); };
    ui.start(Object.assign(T.opt(g), { game: g, level: t.difficulty, casino: {
      label: `${t.name} · 买入 ${buyIn} 枚`,
      leaveTitle: UI_CONFIG.leaveTitle,
      againText: `再来一局（买入 ${buyIn} 枚 + 入场费 ${t.entryFee} 枚）`,
      onChange: () => adapter.saved(),
      onLeave: leave,
      onAgain: () => {
        msg = lines(adapter.leave());
        try { adapter.sit(t.id, buyIn); } catch (e) { msg = `${msg} 没能再来一局：${e.message}`; adapter.back(); return; }
        play(adapter);
      }
    } }));
    return true;
  }

  root.CasinoUI = { UI_CONFIG, html, handle, play, message: () => msg, setMessage: (m) => { msg = m || ""; } };
})(typeof window !== "undefined" ? window : globalThis);
