/* Antlerscale: Backfire · 联机跑团的赌场浮层（#487）：探索环节里打 High Flux
 * 规则：hotseat-game.js · casinoCommand（指令 { type: "casino", op, kit, … }），trpg.js · trpgCasino…（钱包按角色记），
 *       casino.js（钱）、counter-cards.js（牌局）。数据只用 view.casino（online-view.js · projectCasino 白名单）：
 *       自己角色的钱包、自己那一方的牌局 view；主持人另有自己坐庄的那几桌（庄家那一方）和谁坐在哪桌（公开的，没有牌）。
 *   玩家：探索环节标题工具栏「赌场」→ 浮层：选自己的角色（钱包按角色记）→ 钱包、兑换（从这名角色的钱包付 / 收奎支）；
 *         没坐桌时：赌场桌（AI 坐庄 / 主持人坐庄，收入场费）、开一桌对赌（押筹码 / 押奎支，坐庄家或玩家）、坐上别人开的对赌桌；
 *         坐着时：这一局（只有自己那一方能看到的：手牌、自己暗出 / 暗弃的、庄家偷看到的天气），按规则给的能做的操作出按钮，「离桌」。
 *   主持人：探索顶栏「进入战斗环节」旁边「赌场」→ 浮层：自己坐庄的那几桌（庄家那一方，出牌 / 下注），谁坐在哪桌（可以让人离桌）、等人坐的对赌桌。
 *   浮层带 .ovl（联机玩家页 online.css 只放行 .ol-ui / .ovl 等）；按钮沿用申请检定（.crq-*）的 44px。
 *   const x = CasinoOnlineUI.mount({ api, view: () => view, own, call }); x.sync(); x.destroy() */
(function (root) {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  const CC = () => root.CounterCards || null;
  const cardName = c => (CC() ? CC().cardName(c) : c);
  const weatherName = w => (CC() ? CC().weatherName(w) : w || "常态");
  const sideName = s => (CC() ? CC().sideName(s) : s === "dealer" ? "庄家" : "玩家");
  const LEVEL = { easy: "简单", normal: "普通", hard: "困难" };
  const signed = n => (n > 0 ? "+" + n : String(n));
  const num = n => String(Math.round((Number(n) || 0) * 1000) / 1000);
  // 规则给的操作 → 按钮上的字（没见过的操作照样出按钮，写操作名）
  const OP_LABEL = {
    check: () => "过牌", call: o => `跟注 ${o.amount}`, fold: () => "弃牌", reveal: () => "翻开天气", noNormal: () => "不用常态", noLoan: () => "不借",
    weather: o => ({ discard: "弃掉天气", keep: "保留天气", peek: "偷看堆顶", pass: "不动" })[o.op] || o.op,
    place: o => (o.where === "bottom" ? "放到牌堆底" : "放回原位"),
    skip: o => `暗弃〔${cardName(o.card)}〕跳过`, normal: o => `用常态清天气（暗弃〔${cardName(o.card)}〕）`
  };
  const btn = (attrs, label, o) => `<button type="button" class="g-btn ol-button crq-btn${o && o.primary ? " ol-primary" : ""}" ${attrs}${o && o.disabled ? " disabled" : ""}${o && o.title ? ` title="${esc(o.title)}"` : ""}>${label}</button>`;

  /** 一局（自己那一方的 view）：局面、手牌、能做的操作、每轮结算、记录。asDealer：主持人替主持人坐庄的那一桌出牌 */
  function gameHtml(g, m, key) {
    if (!g) return "";
    const me = g.me || {}, opp = g.opp || {};
    const chips = s => (s.chips == null ? "∞" : s.chips);
    const loan = s => (s.loan ? `（借 ${s.loan} 还 ${s.owe}）` : "");
    const head = `<p class="cso-line"><b>${g.over ? "对局结束" : `第 ${g.round} / ${g.rounds} 轮`}</b> · 你是${esc(sideName(g.side))} · 场上天气 ${esc(weatherName(g.weather))} · 天气堆 ${g.deckCount} 张${g.allIn ? " · 相位全押" : ""}</p>
      <p class="cso-line">你 <b>${chips(me)}</b> 枚（本轮下了 ${me.bet || 0}）${loan(me)} · ${esc(m.oppName || sideName(g.opponent))} <b>${chips(opp)}</b> 枚（本轮下了 ${opp.bet || 0}）${loan(opp)} · 底池 <b>${g.pot || 0}</b>${g.betting && g.betting.toCall ? ` · 要跟 ${g.betting.toCall}` : ""}</p>`;
    const peek = g.side === "dealer" ? [g.peek && g.peek.card && !g.peek.where ? `偷看到堆顶是〔${weatherName(g.peek.card)}〕（只有你看得到）` : "", g.deckTop ? `堆顶：${weatherName(g.deckTop)}` : "", g.deckBottom ? `堆底：${weatherName(g.deckBottom)}` : ""].filter(Boolean) : [];
    const legal = g.legal || [], data = `data-cso-key="${esc(key)}"`;
    const playable = new Set(legal.filter(o => o.type === "play").map(o => o.card));
    const hand = (me.hand || []).map(c => playable.has(c)
      ? btn(`data-cso="act" ${data} data-type="play" data-card="${esc(c)}"`, esc(cardName(c)), { primary: true, title: "暗出这张" })
      : `<span class="cso-c">${esc(cardName(c))}</span>`).join("");
    const acts = legal.filter(o => o.type !== "play").map((o, i) => {
      if (o.min != null && o.max != null && o.type !== "call") {
        const v = Math.max(o.min, Math.min(o.max, Number(m.amount[key + o.type]) || o.min));
        return `<span class="cso-amt"><input type="number" min="${o.min}" max="${o.max}" step="${o.step || 1}" value="${v}" data-cso-amount="${esc(key + o.type)}" aria-label="${esc(o.type)} 多少枚">`
          + btn(`data-cso="act" ${data} data-type="${esc(o.type)}" data-i="${i}"`, `${esc({ bet: "下注", raise: "加注", borrow: "借" }[o.type] || o.type)}（${o.min}–${o.max}）`) + `</span>`;
      }
      const label = (OP_LABEL[o.type] || (() => o.type))(o);
      return btn(`data-cso="act" ${data} data-type="${esc(o.type)}"${o.op ? ` data-op="${esc(o.op)}"` : ""}${o.where ? ` data-where="${esc(o.where)}"` : ""}${o.card ? ` data-card="${esc(o.card)}"` : ""}`, esc(label), { primary: o.type === "check" || o.type === "call" || o.type === "reveal" });
    }).join("");
    const mine = [me.card ? `你暗出了〔${cardName(me.card)}〕` : "", (me.discards || []).length ? `暗弃过：${me.discards.map(d => cardName(d.card)).join("、")}` : "", opp.played ? "对手已经暗出" : "", opp.discardCount ? `对手暗弃 ${opp.discardCount} 张` : ""].filter(Boolean);
    const results = (g.results || []).map(r => {
      const who = r.outcome === "fold" ? `${sideName(r.folded)}弃牌` : r.outcome === "tie" ? "平局" : `${sideName(r.winner)}赢 · 差 ${r.tier}`;
      return `<li>第 ${r.r} 轮：${esc(who)}（${esc(weatherName(r.weather))}）· 你 ${signed((r.delta || {})[g.side] || 0)}</li>`;
    }).join("");
    const fin = g.final ? `<p class="cso-final"><b>${g.final.winner === g.side ? "这一局你赢了" : g.final.winner ? "这一局你输了" : "这一局打平"}</b>：你 ${(g.final.chips || {})[g.side]} 枚 · 对手 ${(g.final.chips || {})[g.opponent] == null ? "∞" : g.final.chips[g.opponent]} 枚（扣还借款之后）。</p>` : "";
    const log = (g.log || []).slice(-6).reverse().map(e => `<li${e.mine ? ' class="cso-private"' : ""}>${esc(e.text)}</li>`).join("");
    return `<div class="cso-game" data-cso-game="${esc(key)}">${head}${peek.length ? `<p class="cso-line cso-private">${esc(peek.join(" · "))}</p>` : ""}
      <div class="cso-hand" aria-label="手牌">${hand || '<span class="ol-muted">手牌打完了</span>'}</div>
      ${mine.length ? `<p class="cso-line ol-muted">${esc(mine.join(" · "))}</p>` : ""}
      ${g.over ? fin : g.myTurn ? `<div class="crq-state cso-acts">${acts}</div>` : `<p class="ol-muted">等${esc(m.oppName || "对手")}……</p>`}
      ${results ? `<ol class="cso-results">${results}</ol>` : ""}<ul class="cso-log">${log}</ul>
      <p class="ol-muted cso-quiet">不亮牌：谁出了什么都不公开，只公开胜负、分档和筹码变动。</p></div>`;
  }

  /** 玩家：一名角色的钱包、兑换、桌子（没坐时）或这一局（坐着时） */
  function walletHtml(row, c, m) {
    const ch = row.chips || {}, cfg = c.config || {}, k = row.kit, seat = row.seat, data = `data-kit="${esc(k)}"`;
    const wallet = `<p class="cso-line">筹码 <b>${num(ch.total)}</b> 枚（赠送 ${num(ch.gift)}，只能下注；普通 ${num(ch.normal)}，能卖 ${row.sellable} 枚）· ${esc(row.name)}的钱包 <b>${row.purse}</b> 奎支</p>
      ${row.last ? `<p class="cso-line ol-muted">上一局：${esc(row.last)}</p>` : ""}`;
    const ex = `<div class="crq-state cso-ex"><label>买 <input type="number" min="1" step="1" value="${esc(m.draft.buy)}" data-cso-in="buy"> 枚</label>${btn(`data-cso="buy" ${data}`, `买（每枚 ${cfg.buy} 奎支）`, { disabled: row.purse < cfg.buy })}
      <label>卖 <input type="number" min="1" step="1" value="${esc(m.draft.sell)}" data-cso-in="sell"> 枚</label>${btn(`data-cso="sell" ${data}`, `卖（每枚 ${cfg.sell} 奎支）`, { disabled: !row.sellable, title: row.sellable ? "" : "赠送的筹码不能换成奎支" })}</div>`;
    if (seat) {
      const what = seat.kind === "pvp" ? `对赌（${seat.stakeKind === "chips" ? "押筹码" : `押奎支：1 枚 = ${cfg.face} 奎支`}，开局各 ${seat.start} 枚）· 对手 ${esc(seat.opponent || "还没坐下")}`
        : `${esc(seat.tableName)} · 庄家：${seat.kind === "gm" ? "主持人" : `${LEVEL[seat.level] || ""} AI`} · 买入 ${seat.buyIn} 枚（入场费 ${seat.fee} 枚）`;
      const oppName = seat.kind === "pvp" ? seat.opponent : seat.kind === "gm" ? "主持人" : `${LEVEL[seat.level] || ""} AI`;
      return `${wallet}<p class="cso-line"><b>坐在桌上</b>：${what}</p>
        ${seat.game ? gameHtml(seat.game, Object.assign({}, m, { oppName }), k) : '<p class="ol-muted">等对手坐下。</p>'}
        <div class="crq-state">${btn(`data-cso="leave" ${data}`, seat.game && !seat.game.over ? "离桌（打到一半算认输）" : "离桌", { title: "离桌结算：赌场桌桌上剩下的回钱包；对赌打到一半离桌算认输，押进底池的归对方" })}</div>`;
    }
    const tables = (c.tables || []).map(t => {
      const v = Math.max(t.minBuyIn, Number(m.draft.buyIn[t.id]) || t.minBuyIn);
      return `<li class="crq-row cso-table"><div><b>${esc(t.name)}</b><small class="ol-muted"> · 桌上每枚 ${t.rate} 奎支 · 最低买入 ${t.minBuyIn} 枚（${num(t.minBuyInChips)} 枚筹码）· 入场费 ${t.entryFee} 枚（${num(t.entryFeeChips)} 枚筹码，每局一次）· AI 是${esc(LEVEL[t.difficulty] || "")}</small></div>
        <div class="crq-state"><label>买入 <input type="number" min="${t.minBuyIn}" step="1" value="${v}" data-cso-buyin="${esc(t.id)}"> 枚</label>
        ${btn(`data-cso="sit" ${data} data-table="${esc(t.id)}" data-dealer="ai"`, "坐下（AI 坐庄）", { primary: true })}${btn(`data-cso="sit" ${data} data-table="${esc(t.id)}" data-dealer="gm"`, "坐下（主持人坐庄）")}</div></li>`;
    }).join("");
    const open = (c.open || []).map(t => `<li class="crq-row"><div><b>${esc(t.dealer || t.player || "")}</b> 开的对赌 · ${t.stakeKind === "chips" ? "押筹码" : "押奎支"} · 开局各 ${t.start} 枚 · 空着${t.dealer ? "玩家" : "庄家"}</div>
      <div class="crq-state">${btn(`data-cso="join" ${data} data-table="${esc(t.id)}"`, "坐下对赌")}</div></li>`).join("");
    const side = m.draft.side, stake = m.draft.stake;
    const pvp = `<div class="crq-state cso-pvp"><label>坐 <select data-cso-in="side"><option value="dealer"${side === "dealer" ? " selected" : ""}>庄家</option><option value="player"${side === "player" ? " selected" : ""}>玩家</option></select></label>
      <label>押 <select data-cso-in="stake"><option value="chips"${stake === "chips" ? " selected" : ""}>筹码（只能押普通筹码）</option><option value="kuizhi"${stake === "kuizhi" ? " selected" : ""}>奎支（1 枚 = ${cfg.face} 奎支）</option></select></label>
      ${btn(`data-cso="pvpOpen" ${data}`, "开一桌对赌")}</div>`;
    return `${wallet}${ex}<h3>赌场桌（收入场费）</h3><ul class="crq-list">${tables}</ul>
      <h3>玩家对赌（不收入场费）</h3>${pvp}${open ? `<ul class="crq-list">${open}</ul>` : '<p class="ol-muted">现在没有等人坐的对赌桌。</p>'}`;
  }
  function playerHtml(m) {
    const c = m.casino, head = `<header><h2>赌场</h2>${btn('data-cso="close"', "关闭")}</header>`;
    if (!c) return `<div class="ol-card crq-card cso-card">${head}<p class="ol-muted">只有联机跑团的探索环节能去赌场。</p></div>`;
    const mine = c.mine || [];
    if (!mine.length) return `<div class="ol-card crq-card cso-card">${head}<p class="ol-muted">你还没有操控的角色：筹码钱包按角色记。</p></div>`;
    const row = mine.find(r => r.kit === m.kit) || mine[0];
    const pick = mine.length > 1 ? `<div class="crq-state">${mine.map(r => btn(`data-cso="pick" data-kit="${esc(r.kit)}"`, esc(r.name), { primary: r.kit === row.kit })).join("")}</div>` : "";
    return `<div class="ol-card crq-card cso-card">${head}${pick}${walletHtml(row, c, m)}${m.error ? `<p class="ol-bad" role="alert">${esc(m.error)}</p>` : ""}
      <p class="ol-muted cso-rule">赠送筹码只能和赌场对局下注、不能换成奎支；输的先扣赠送筹码，赢来的都是普通筹码。玩家对赌只能押普通筹码或奎支。</p></div>`;
  }
  /** 主持人：自己坐庄的那几桌（庄家那一方）、谁坐在哪桌、等人坐的对赌桌 */
  function gmHtml(m) {
    const c = m.casino, head = `<header><h2>赌场</h2>${btn('data-cso="close"', "关闭")}</header>`;
    if (!c) return `<div class="ol-card crq-card cso-card">${head}<p class="ol-muted">只有联机跑团的探索环节有赌场。</p></div>`;
    const dealing = (c.dealing || []).map(d => `<section class="cso-deal"><h3>你给 ${esc(d.name)} 坐庄 · ${esc(d.tableName || "")}</h3>${gameHtml(d.game, Object.assign({}, m, { oppName: d.name }), "gm:" + d.kit)}</section>`).join("");
    const seated = (c.seated || []).map(s => `<li class="crq-row"><div><b>${esc(s.name)}</b> · ${s.kind === "pvp" ? `对赌（${s.stakeKind === "chips" ? "押筹码" : "押奎支"}）对手 ${esc(s.opponent || "还没坐下")}` : `${esc(s.tableName || "")} · ${s.kind === "gm" ? "你坐庄" : "AI 坐庄"}`} · ${s.over ? "打完了" : s.round ? `第 ${s.round} 轮` : "等人"}</div>
      <div class="crq-state">${btn(`data-cso="leave" data-kit="${esc(s.kit)}"`, "让他离桌", { title: "卡住的桌子：按离桌结算（打到一半的对赌算他认输）" })}</div></li>`).join("");
    return `<div class="ol-card crq-card cso-card">${head}${dealing || '<p class="ol-muted">现在没有要你坐庄的桌子。玩家选「主持人坐庄」坐下时，这一桌出现在这里，由你出庄家那一方。</p>'}
      <h3>谁坐在哪桌</h3>${seated ? `<ul class="crq-list">${seated}</ul>` : '<p class="ol-muted">没有人坐桌。</p>'}${m.error ? `<p class="ol-bad" role="alert">${esc(m.error)}</p>` : ""}
      <p class="ol-muted cso-rule">不亮牌：你只看得到自己坐庄那一方的牌；玩家之间对赌的牌你也看不到。</p></div>`;
  }

  const TOOLS = "#online-stage .ol-stage-heading .ol-info-tools";
  const OPENERS = '#online-stage [data-cso="open-box"], #tr-casino';
  function mount(o) {
    const doc = root.document;
    const box = doc.createElement("section"); box.id = "online-casino"; box.className = "ol-ui ol-overlay ol-bag ovl cso"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "赌场"); box.hidden = true;
    doc.body.appendChild(box);
    let open = false, busy = false, last = "", error = "", kit = null;
    const opened = new Set();   // 已经替哪些角色领过赠送筹码（第一次打开时发一次 open）
    const draft = { buy: 1, sell: 1, buyIn: {}, side: "player", stake: "chips" }, amount = {};
    const v = () => o.view() || {}, hs = () => (v().packet && v().packet.view) || {};
    const casino = () => hs().casino || null;
    const enabled = () => !!(v().active && v().packet && v().packet.mode !== "rogue" && v().screen === "exploration" && casino());
    const model = () => ({ casino: casino(), kit, busy, error, draft, amount });
    function paint() {
      if (!open) return;
      const html = v().isHost ? gmHtml(model()) : playerHtml(model());
      if (html !== last) { last = html; box.innerHTML = html; }
    }
    const waiting = () => {
      const c = casino(); if (!c) return false;
      return v().isHost ? (c.dealing || []).some(d => d.game && d.game.myTurn) : (c.mine || []).some(r => r.seat && r.seat.game && r.seat.game.myTurn);
    };
    const label = () => (waiting() ? (v().isHost ? "赌场 · 等你坐庄" : "赌场 · 轮到你") : "赌场");
    function hostButton(on) {
      const at = doc.querySelector("#tr-fight");
      let b = doc.querySelector("#tr-casino");
      if (!on || !at) { if (b) b.remove(); return; }
      if (!b) { b = doc.createElement("button"); b.type = "button"; b.id = "tr-casino"; b.className = "g-btn"; b.title = "赌场：给玩家坐庄、看谁坐在哪桌（只在探索环节）"; (doc.querySelector("#tr-duel") || at).after(b); }
      const text = label(); if (b.textContent !== text) b.textContent = text;
      b.dataset.alert = waiting() ? "1" : "";
    }
    /** 玩家第一次打开（或者换到一名还没领过的角色）：替这名角色领赠送筹码 */
    function welcome() {
      const c = casino(); if (!c || v().isHost) return;
      const row = (c.mine || []).find(r => r.kit === kit) || (c.mine || [])[0];
      if (row && !(row.chips && row.chips.gifted) && !opened.has(row.kit)) { opened.add(row.kit); submit({ type: "casino", op: "open", kit: row.kit }); }
    }
    function sync() {
      const on = enabled(), isHost = !!v().isHost;
      hostButton(on && isHost);
      if (!on || isHost) doc.querySelectorAll('#online-stage [data-cso="open-box"]').forEach(b => b.remove());
      if (!on) { open = false; box.hidden = true; return; }
      if (!isHost) {
        const tools = doc.querySelector(TOOLS);
        if (tools) {
          let b = tools.querySelector('[data-cso="open-box"]');
          if (!b) { b = doc.createElement("button"); b.type = "button"; b.className = "g-btn ol-button"; b.dataset.cso = "open-box"; tools.appendChild(b); }
          const text = label(); if (b.textContent !== text) b.textContent = text;
          if (waiting()) b.dataset.alert = "1"; else delete b.dataset.alert;
        }
      }
      box.hidden = !open; paint();
    }
    async function submit(cmd) {
      if (busy) return false; busy = true; error = ""; last = ""; paint();
      try { return await o.call(() => o.api.submit(cmd)); } catch (e) { error = (e && e.message) || "没做成"; return false; } finally { busy = false; last = ""; paint(); }
    }
    const numIn = (sel, dflt) => { const el = box.querySelector(sel); const n = el ? Math.floor(Number(el.value)) : NaN; return Number.isFinite(n) ? n : dflt; };
    function onClick(e) {
      const b = e.target.closest("[data-cso]"); if (!b) { if (e.target === box) { open = false; sync(); } return; }
      if (b.disabled || busy) return;
      const a = b.dataset.cso, d = b.dataset;
      if (a === "close") { open = false; sync(); return; }
      if (a === "pick") { kit = d.kit; error = ""; last = ""; paint(); welcome(); return; }
      if (a === "buy") { draft.buy = numIn('[data-cso-in="buy"]', 1); return void submit({ type: "casino", op: "buy", kit: d.kit, n: draft.buy }); }
      if (a === "sell") { draft.sell = numIn('[data-cso-in="sell"]', 1); return void submit({ type: "casino", op: "sell", kit: d.kit, n: draft.sell }); }
      if (a === "sit") { draft.buyIn[d.table] = numIn(`[data-cso-buyin="${d.table}"]`, 0); return void submit({ type: "casino", op: "sit", kit: d.kit, table: d.table, buyIn: draft.buyIn[d.table], dealer: d.dealer }); }
      if (a === "pvpOpen") return void submit({ type: "casino", op: "pvpOpen", kit: d.kit, side: draft.side, stakeKind: draft.stake });
      if (a === "join") return void submit({ type: "casino", op: "pvpJoin", kit: d.kit, table: d.table });
      if (a === "leave") return void submit({ type: "casino", op: "leave", kit: d.kit });
      if (a === "act") {
        const key = d.csoKey || "", gm = key.startsWith("gm:"), who = gm ? key.slice(3) : key;
        const action = { type: d.type };
        if (d.op) action.op = d.op; if (d.where) action.where = d.where; if (d.card) action.card = d.card;
        const amt = box.querySelector(`[data-cso-amount="${key + d.type}"]`);
        if (amt) { action.amount = Math.floor(Number(amt.value)); amount[key + d.type] = action.amount; }
        return void submit(Object.assign({ type: "casino", op: "act", kit: who, action }, gm ? { asDealer: true } : {}));
      }
    }
    function onChange(e) {
      const t = e.target;
      if (t.dataset.csoIn === "side") draft.side = t.value === "dealer" ? "dealer" : "player";
      else if (t.dataset.csoIn === "stake") draft.stake = t.value === "kuizhi" ? "kuizhi" : "chips";
      else if (t.dataset.csoIn) draft[t.dataset.csoIn] = t.value;
      else if (t.dataset.csoBuyin) draft.buyIn[t.dataset.csoBuyin] = t.value;
      else if (t.dataset.csoAmount) amount[t.dataset.csoAmount] = t.value;
    }
    const onKey = e => { e.stopPropagation(); if (e.key === "Escape") { open = false; sync(); } };
    const openFrom = e => { const b = e.target.closest(OPENERS); if (b) { open = true; error = ""; last = ""; sync(); welcome(); box.querySelector('[data-cso="close"]')?.focus({ preventScroll: true }); } };
    box.addEventListener("click", onClick); box.addEventListener("change", onChange); box.addEventListener("keydown", onKey);
    doc.addEventListener("click", openFrom);
    return { sync, el: box, destroy() { doc.removeEventListener("click", openFrom); box.remove(); const b = doc.querySelector("#tr-casino"); if (b) b.remove(); } };
  }

  const api = { mount, playerHtml, gmHtml, gameHtml };
  root.CasinoOnlineUI = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
