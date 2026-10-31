/* Antlerscale: Backfire · 联机跑团的赌场（#487）：探索环节里打 High Flux、Flux Duel、Flux Hold'em、猜大猜小（#526）
 * 规则：hotseat-game.js · casinoCommand（指令 { type: "casino", op, kit, … }），trpg.js · trpgCasino…（钱包按角色记）/ trpgBlackMarket…（黑市赌命桌），
 *       casino.js（钱）、counter-cards.js / flux-duel.js / flux-holdem.js / counter-cards-guess.js（牌局）。数据只用 view.casino（online-view.js · projectCasino 白名单）：
 *       自己角色的钱包、自己那一方的牌局 view、自己角色坐着的赌命桌（这一手和结论：死没死，坚毅的数字一个都没有）；
 *       主持人另有自己坐庄的那几桌（庄家那一方）、自己坐的多人桌座位和谁坐在哪桌（公开的，没有牌）。
 *   赌场大厅（这个浮层）：
 *   玩家：探索环节标题工具栏「赌场」→ 浮层：选自己的角色（钱包按角色记）→ 钱包、兑换（从这名角色的钱包付 / 收奎支）；
 *         没坐桌时：赌场桌（AI 坐庄 / 主持人坐庄，收入场费；猜大猜小是赌场坐庄）、开一桌对赌（High Flux 坐庄家或玩家、Flux Duel 坐甲或乙，押筹码 / 押奎支）、
 *         坐上别人开的对赌桌、Flux Hold'em 多人桌（开桌 / 坐下 / 开局）、黑市赌命桌（押坚毅，主持人坐庄）；坐着时：这一局的一行概况、「打开牌桌」「离桌」。
 *   主持人：探索顶栏「进入战斗环节」旁边「赌场」→ 浮层：自己坐庄的那几桌、多人桌（坐一个座位、开局）、谁坐在哪桌（可以让人离桌）。
 *   牌桌（#526）：「打开牌桌」用本机那张牌桌画（counter-cards-ui.js / flux-ui.js / counter-cards-guess-ui.js 的 remote：结算前的过渡、结算横幅、记录和本机一样），
 *   操作发联机指令；牌桌顶栏「返回赌场」回到这里（不离桌）。坐下就开局的（赌场桌、坐上对赌桌、开桌的人开局、赌命桌上桌）做成了直接打开牌桌。
 *   浮层带 .ovl（联机玩家页 online.css 只放行 .ol-ui / .ovl 等，牌桌另加 .cc-online）；按钮沿用申请检定（.crq-*）的 44px。
 *   const x = CasinoOnlineUI.mount({ api, view: () => view, own, call }); x.sync(); x.destroy() */
(function (root) {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  const CC = () => root.CounterCards || null;
  const LEVEL = { easy: "简单", normal: "普通", hard: "困难" };
  // 对赌桌两方的称呼（#526）：High Flux 庄家 / 玩家；Flux Duel 甲 / 乙（第 1 轮甲先手）
  const PVP_SIDES = { highflux: [["dealer", "庄家"], ["player", "玩家"]], duel: [["a", "甲（第 1 轮先手）"], ["b", "乙"]] };
  const num = n => String(Math.round((Number(n) || 0) * 1000) / 1000);
  const btn = (attrs, label, o) => `<button type="button" class="g-btn ol-button crq-btn${o && o.primary ? " ol-primary" : ""}" ${attrs}${o && o.disabled ? " disabled" : ""}${o && o.title ? ` title="${esc(o.title)}"` : ""}>${label}</button>`;
  const GAME_NAME = { highflux: "High Flux", duel: "Flux Duel", holdem: "Flux Hold'em", guess: "猜大猜小" };
  const GUESS = () => root.CounterCardsGuess || null;
  const gameName = (mode) => (mode === "highflux" && CC() ? CC().CC_CONFIG.name : mode === "guess" && GUESS() ? GUESS().GUESS_CONFIG.name : GAME_NAME[mode] || GAME_NAME.highflux);
  /** 赌命桌的字（结论只写「永久死亡」，不写数字）：读 counter-cards-guess-ui.js 的那一份 */
  const lifeText = (k, dflt) => { const u = root.CounterCardsGuessUI; return (u && u.UI_CONFIG && u.UI_CONFIG.life && u.UI_CONFIG.life[k]) || dflt; };

  /** 坐着的这一局在大厅里写一行：第几轮、自己的筹码、底池、轮没轮到自己，后面是「打开牌桌」（open = 按钮的 data-cso 属性）。
   *  牌桌画面（#526）在本机那几张牌桌上画（High Flux：counter-cards-ui.js，Flux Duel / Hold'em：flux-ui.js，猜大猜小：counter-cards-guess-ui.js），见 openTable */
  function gameHtml(g, m, open) {
    if (!g) return "";
    const me = g.me || {}, chips = me.chips == null ? "∞" : me.chips;
    const state = g.over ? "这一局打完了" : g.myTurn ? "<b>轮到你</b>" : "等别人";
    // 猜大猜小（#526）：一局就是一手——第几轮下注、押了几枚（赌命桌只写押了几格：坚毅的数字一个都不写）
    if (g.mode === "guess") {
      const life = !!(g.table && g.table.life), slips = me.slips || [];
      const line = life ? `押了 ${slips.length} 格` : `桌上 ${esc(chips)} 枚 · 这一手押了 ${slips.reduce((s, x) => s + (Number(x.amount) || 0), 0)} 枚`;
      return `<div class="cso-game"><p class="cso-line"><b>${esc(life ? g.table.name : gameName("guess"))}</b> · ${g.over ? "这一手结束" : `第 ${g.round} / ${g.rounds} 轮下注`} · ${line} · ${g.over ? "这一手打完了" : state}</p>
        ${open ? `<div class="crq-state">${btn(open, g.over ? "看结算" : "打开牌桌", { primary: true })}</div>` : ""}</div>`;
    }
    return `<div class="cso-game"><p class="cso-line"><b>${esc(gameName(g.mode || "highflux"))}</b> · ${g.over ? "对局结束" : `第 ${g.round} / ${g.rounds} 轮`} · 你 ${esc(chips)} 枚 · 底池 ${g.pot || 0} · ${state}</p>
      ${open ? `<div class="crq-state">${btn(open, g.over ? "看总结算" : "打开牌桌", { primary: true })}</div>` : ""}</div>`;
  }

  /** 玩家：一名角色的钱包、兑换、桌子（没坐时）或这一局（坐着时） */
  function walletHtml(row, c, m) {
    const ch = row.chips || {}, cfg = c.config || {}, k = row.kit, seat = row.seat, data = `data-kit="${esc(k)}"`;
    const wallet = `<p class="cso-line">筹码 <b>${num(ch.total)}</b> 枚（赠送 ${num(ch.gift)}，只能下注；普通 ${num(ch.normal)}，能卖 ${row.sellable} 枚）· ${esc(row.name)}的钱包 <b>${row.purse}</b> 奎支</p>
      ${row.last ? `<p class="cso-line ol-muted">上一局：${esc(row.last)}</p>` : ""}`;
    const ex = `<div class="crq-state cso-ex"><label>买 <input type="number" min="1" step="1" value="${esc(m.draft.buy)}" data-cso-in="buy"> 枚</label>${btn(`data-cso="buy" ${data}`, `买（每枚 ${cfg.buy} 奎支）`, { disabled: row.purse < cfg.buy })}
      <label>卖 <input type="number" min="1" step="1" value="${esc(m.draft.sell)}" data-cso-in="sell"> 枚</label>${btn(`data-cso="sell" ${data}`, `卖（每枚 ${cfg.sell} 奎支）`, { disabled: !row.sellable, title: row.sellable ? "" : "赠送的筹码不能换成奎支" })}</div>`;
    const life = (c.life || []).find(x => x.kit === k);
    if (life) return wallet + lifeSeatHtml(life, m);   // 坐在黑市赌命桌上（#526）
    if (seat && seat.kind === "holdem") return wallet + holdemSeatHtml(row, c, m);
    if (seat) {
      // 牌局里桌上不够时从钱包补的（#520）：赌场桌算进买入，对赌写补了几枚
      const what = seat.kind === "pvp" ? `${seat.mode === "duel" ? "Flux Duel " : ""}对赌（${seat.stakeKind === "chips" ? "押筹码" : `押奎支：1 枚 = ${cfg.face} 奎支`}，开局各 ${seat.start} 枚${seat.topUp ? `，你中途从钱包补了 ${seat.topUp} 枚` : ""}）· 对手 ${esc(seat.opponent || "还没坐下")}`
        : `${esc(seat.tableName)} · ${esc(tableWho(seat))} · 买入 ${seat.buyIn} 枚（${seat.topUp ? `含从钱包补的 ${seat.topUp} 枚，` : ""}入场费 ${seat.fee} 枚）`;
      return `${wallet}<p class="cso-line"><b>坐在桌上</b>：${what}</p>
        ${seat.game ? gameHtml(seat.game, m, `data-cso="table" ${data}`) : '<p class="ol-muted">等对手坐下。</p>'}
        <div class="crq-state">${btn(`data-cso="leave" ${data}`, seat.game && !seat.game.over ? "离桌（打到一半算认输）" : "离桌", { title: "离桌结算：赌场桌桌上剩下的回钱包；对赌打到一半离桌算认输，押进底池的归对方" })}</div>`;
    }
    const tables = (c.tables || []).map(t => {
      const v = Math.max(t.minBuyIn, Number(m.draft.buyIn[t.id]) || t.minBuyIn);
      // 猜大猜小（#526）：庄家是赌场（只抽牌、不用做决定，没有 AI 也没有主持人坐庄），写每轮每格最低注；这里的一局就是一手
      const guess = t.game === "guess";
      const who = guess ? `庄家是赌场 · 每格最低注 ${esc((t.minBet || []).join(" / "))} 枚（一局就是一手）` : `AI 是${esc(LEVEL[t.difficulty] || "")}`;
      return `<li class="crq-row cso-table"><div><b>${esc(t.name)}</b><small class="ol-muted"> · 桌上每枚 ${t.rate} 奎支 · 最低买入 ${t.minBuyIn} 枚（${num(t.minBuyInChips)} 枚筹码）· 入场费 ${t.entryFee} 枚（${num(t.entryFeeChips)} 枚筹码，每局一次）· ${who}</small></div>
        <div class="crq-state"><label>买入 <input type="number" min="${t.minBuyIn}" step="1" value="${v}" data-cso-buyin="${esc(t.id)}"> 枚</label>
        ${btn(`data-cso="sit" ${data} data-table="${esc(t.id)}" data-dealer="ai"`, guess ? "坐下（赌场坐庄）" : "坐下（AI 坐庄）", { primary: true })}${t.gm === false ? "" : btn(`data-cso="sit" ${data} data-table="${esc(t.id)}" data-dealer="gm"`, "坐下（主持人坐庄）")}</div></li>`;
    }).join("");
    // 对赌（#526：High Flux 坐庄家 / 玩家，Flux Duel 坐甲 / 乙）：等人坐的桌子写开桌的人、空着哪一方
    const open = (c.open || []).map(t => {
      const sides = PVP_SIDES[t.mode] || PVP_SIDES.highflux, by = sides.map(([k]) => t[k]).find(Boolean) || "", free = sides.find(([k]) => !t[k]);
      return `<li class="crq-row"><div><b>${esc(by)}</b> 开的${t.mode === "duel" ? "Flux Duel " : ""}对赌 · ${t.stakeKind === "chips" ? "押筹码" : "押奎支"} · 开局各 ${t.start} 枚 · 空着${esc(free ? free[1] : "")}</div>
      <div class="crq-state">${btn(`data-cso="join" ${data} data-table="${esc(t.id)}"`, "坐下对赌")}</div></li>`;
    }).join("");
    const mode = PVP_SIDES[m.draft.mode] ? m.draft.mode : "highflux", sides = PVP_SIDES[mode];
    const side = sides.some(([k]) => k === m.draft.side) ? m.draft.side : sides[sides.length - 1][0], stake = m.draft.stake;
    const pvp = `<div class="crq-state cso-pvp"><label>玩法 <select data-cso-in="mode"><option value="highflux"${mode === "highflux" ? " selected" : ""}>High Flux</option><option value="duel"${mode === "duel" ? " selected" : ""}>Flux Duel</option></select></label>
      <label>坐 <select data-cso-in="side">${sides.map(([k, n]) => `<option value="${k}"${side === k ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
      <label>押 <select data-cso-in="stake"><option value="chips"${stake === "chips" ? " selected" : ""}>筹码（只能押普通筹码）</option><option value="kuizhi"${stake === "kuizhi" ? " selected" : ""}>奎支（1 枚 = ${cfg.face} 奎支）</option></select></label>
      ${btn(`data-cso="pvpOpen" ${data}`, "开一桌对赌")}</div>`;
    return `${wallet}${ex}<h3>赌场桌（收入场费）</h3><ul class="crq-list">${tables}</ul>
      <h3>玩家对赌（不收入场费）</h3>${pvp}${open ? `<ul class="crq-list">${open}</ul>` : '<p class="ol-muted">现在没有等人坐的对赌桌。</p>'}
      ${holdemLobbyHtml(row, c, m)}${lifeLobbyHtml(row)}`;
  }
  /* ---------- 黑市赌命桌（#526）：猜大猜小押坚毅，主持人坐庄（庄家只抽牌、不用做决定）----------
   * 规则文字照配置写（每格押上几点是固定代价，同本机 counter-cards-guess-ui.js · blackMarketHtml）；不写、也根本拿不到这名角色还剩多少坚毅：
   * 按钮不会因为坚毅变灰（押坚毅永远能下）。扣坚毅、真死都在房主那边算，这边只看到结论 */
  function lifeLobbyHtml(row) {
    const G = GUESS();
    if (!G || !G.GUESS_CONFIG.life) return "";
    const L = G.GUESS_CONFIG.life, C = CC() ? CC().CC_CONFIG.name : "High Flux";
    return `<h3>${esc(L.name)}（押坚毅，主持人坐庄）</h3>
      <p class="ol-muted">${esc(`${G.GUESS_CONFIG.name}（${C}），押的是坚毅生命：每格押上 ${L.stake.join(" / ")} 点（第一 / 二 / 三轮），押坚毅永远能下；不收入场费。`
        + `押输了坚毅受创，坚毅扣光即真正死亡（状态记成死亡）。押中按赔率赢奎支，赔率高另给稀有材料。押了还没结算不能离桌。`)}</p>
      <div class="crq-state">${btn(`data-cso="lifeSit" data-kit="${esc(row.kit)}"`, `${esc(row.name)} 上桌`)}</div>`;
  }
  /** 坐在赌命桌上：这一手的一行概况、「打开牌桌」、离桌（押了还没结算不能离桌）；死在桌上的写「永久死亡」（主持人那边算的结论） */
  function lifeSeatHtml(s, m) {
    const g = s.game || {}, data = `data-kit="${esc(s.kit)}"`, stuck = !g.over && ((g.me && g.me.slips) || []).length > 0;
    return `<p class="cso-line"><b>${esc(s.name || "")}坐在${esc((g.table && g.table.name) || "")}</b>（押坚毅，主持人坐庄）${s.dead ? ` · <b class="ol-bad">${esc(lifeText("dead", "永久死亡"))}</b>` : ""}</p>
      ${gameHtml(g, m, `data-cso="tableLife" ${data}`)}
      <div class="crq-state">${btn(`data-cso="leave" ${data}`, "离桌", { disabled: stuck, title: stuck ? "押了还没结算，不能离桌：这一手留在桌上，回来接着押" : "" })}</div>`;
  }
  /* ---------- Flux Hold'em 多人桌（#526）：几名玩家同桌，空座位由这张桌子难度的 AI 补，主持人也能坐一个座位 ---------- */
  /** 一桌的座位：谁坐在哪（名字就写着是主持人 / AI；空着的写「空座位」，开局后由 AI 补；托管中的写出来） */
  const holdemSeatsLine = (t) => (t.seats || []).map(s => `${s.id} ${s.kind === "empty" ? "空座位" : esc(s.name || "")}${s.auto ? "（AI 托管）" : ""}`).join(" · ");
  /** 没坐桌时：开一桌多人桌（选桌子、每人买入、几人桌），等人坐的多人桌（坐下） */
  function holdemLobbyHtml(row, c, m) {
    const list = (c.tables || []).filter(t => t.game === "holdem");
    if (!list.length) return "";
    const data = `data-kit="${esc(row.kit)}"`, d = m.draft.holdem || {};
    const pickT = list.find(t => t.id === d.table) || list[0], v = Math.max(pickT.minBuyIn, Number(d.buyIn) || pickT.minBuyIn), size = [2, 3, 4].includes(Number(d.size)) ? Number(d.size) : (pickT.players || 4);
    const form = `<div class="crq-state cso-pvp"><label>桌子 <select data-cso-in="hTable">${list.map(t => `<option value="${esc(t.id)}"${t.id === pickT.id ? " selected" : ""}>${esc(t.short || t.name)}（每枚 ${t.rate} 奎支 · AI ${esc(LEVEL[t.difficulty] || "")}）</option>`).join("")}</select></label>
      <label>每人买入 <input type="number" min="${pickT.minBuyIn}" step="1" value="${v}" data-cso-in="hBuyIn"> 枚</label>
      <label>几人桌 <select data-cso-in="hSize">${[2, 3, 4].map(n => `<option value="${n}"${n === size ? " selected" : ""}>${n} 人</option>`).join("")}</select></label>
      ${btn(`data-cso="holdemOpen" ${data}`, "开一桌多人桌")}</div>`;
    const tables = (c.holdem || []).map(t => {
      const free = !t.started && (t.seats || []).some(s => s.kind === "empty");
      return `<li class="crq-row"><div><b>${esc(t.name)}</b> · ${esc(t.host || "")} 开的 · ${t.size} 人桌 · 每人买入 ${t.buyIn} 枚（入场费 ${t.fee} 枚）· ${t.started ? (t.over ? "打完了" : `第 ${t.round} 轮`) : "等人"}<br><small class="ol-muted">${holdemSeatsLine(t)}</small></div>
        <div class="crq-state">${free ? btn(`data-cso="holdemJoin" ${data} data-table="${esc(t.id)}"`, "坐下") : ""}</div></li>`;
    }).join("");
    return `<h3>${esc((list[0].gameName) || "Flux Hold'em")} 多人桌（几名玩家同桌，空座位由 AI 补）</h3>${form}
      <p class="ol-muted">开桌的人定每人买入多少（买入只能用普通筹码，同对赌），坐满或者开桌的人点「开局」就开打，空着的座位由这张桌子难度的 AI 补；主持人也能坐一个座位。</p>
      ${tables ? `<ul class="crq-list">${tables}</ul>` : '<p class="ol-muted">现在没有多人桌。</p>'}`;
  }
  /** 坐在多人桌上：座位、开局（开桌的人）、离桌（没开局退回；打到一半交给 AI 托管；打完结算）、托管中接着打 */
  function holdemSeatHtml(row, c, m) {
    const seat = row.seat, t = (c.holdem || []).find(x => x.id === seat.table) || { seats: [] }, data = `data-kit="${esc(row.kit)}" data-table="${esc(seat.table)}"`;
    const g = seat.game, over = !!(g && g.over);
    const leave = !seat.started ? "离桌（退回买入）" : over ? "离桌结算" : "离桌（交给 AI 托管）";
    return `<p class="cso-line"><b>坐在${esc(seat.tableName || "")}</b>：${seat.size} 人桌 · ${seat.side} 号座位 · 买入 ${seat.buyIn} 枚${seat.topUp ? `（含从钱包补的 ${seat.topUp} 枚）` : ""}，入场费 ${seat.fee} 枚${seat.auto ? " · <b>AI 托管中</b>" : ""}</p>
      <p class="cso-line ol-muted">${holdemSeatsLine(t)}</p>
      ${g ? gameHtml(g, m, `data-cso="table" data-kit="${esc(row.kit)}"`) : '<p class="ol-muted">等人坐下、开桌的人开局。</p>'}
      <div class="crq-state">${seat.host && !seat.started ? btn(`data-cso="holdemStart" ${data}`, "开局（空座位由 AI 补）", { primary: true }) : ""}
        ${seat.auto && g && !over ? btn(`data-cso="holdemBack" ${data}`, "接着打", { primary: true }) : ""}
        ${btn(`data-cso="leave" ${data}`, leave)}</div>`;
  }
  /** 主持人：多人桌（坐一个座位、开局），自己坐着的座位 */
  function holdemGmHtml(c, m) {
    const mineAt = new Map((c.gmSeats || []).map(s => [s.table, s]));
    const rows = (c.holdem || []).map(t => {
      const s = mineAt.get(t.id), data = `data-table="${esc(t.id)}"`;
      const sit = !t.started && !s && (t.seats || []).some(x => x.kind === "empty") ? btn(`data-cso="holdemGm" ${data}`, "坐一个座位") : "";
      const go = !t.started ? btn(`data-cso="holdemStartGm" ${data}`, "开局（空座位由 AI 补）") : "";
      const mine = s ? `${s.game ? gameHtml(s.game, m, `data-cso="tableGm" ${data}`) : ""}${s.auto && s.game && !s.game.over ? btn(`data-cso="holdemBackGm" ${data}`, "接着打", { primary: true }) : ""}${btn(`data-cso="leaveGm" ${data}`, t.started && !t.over ? "离开座位（交给 AI 托管）" : "离开座位")}` : "";
      return `<li class="crq-row"><div><b>${esc(t.name)}</b> · ${esc(t.host || "")} 开的 · ${t.size} 人桌 · ${t.started ? (t.over ? "打完了" : `第 ${t.round} 轮`) : "等人"}<br><small class="ol-muted">${holdemSeatsLine(t)}</small>${mine}</div>
        <div class="crq-state">${sit}${go}</div></li>`;
    }).join("");
    return rows ? `<h3>Flux Hold'em 多人桌</h3><ul class="crq-list">${rows}</ul>` : "";
  }
  function playerHtml(m) {
    const c = m.casino, head = `<header><h2>赌场</h2>${btn('data-cso="close"', "关闭")}</header>`;
    if (!c) return `<div class="ol-card crq-card cso-card">${head}<p class="ol-muted">只有联机跑团的探索环节能去赌场。</p></div>`;
    const mine = c.mine || [];
    // 死在黑市赌命桌上的角色（#526）：钱包不再列，只有这一手的结果（永久死亡），看完离桌
    const gone = (c.life || []).filter(x => !mine.some(r => r.kit === x.kit)).map(x => `<section class="cso-deal">${lifeSeatHtml(x, m)}</section>`).join("");
    const err = m.error ? `<p class="ol-bad" role="alert">${esc(m.error)}</p>` : "";
    if (!mine.length) return `<div class="ol-card crq-card cso-card">${head}${gone || '<p class="ol-muted">你还没有操控的角色：筹码钱包按角色记。</p>'}${err}</div>`;
    const row = mine.find(r => r.kit === m.kit) || mine[0];
    const pick = mine.length > 1 ? `<div class="crq-state">${mine.map(r => btn(`data-cso="pick" data-kit="${esc(r.kit)}"`, esc(r.name), { primary: r.kit === row.kit })).join("")}</div>` : "";
    return `<div class="ol-card crq-card cso-card">${head}${pick}${walletHtml(row, c, m)}${gone}${err}
      <p class="ol-muted cso-rule">赠送筹码只能和赌场对局下注、不能换成奎支；输的先扣赠送筹码，赢来的都是普通筹码。玩家对赌只能押普通筹码或奎支。
      牌局里桌上的筹码不够时先自动从钱包补到够用（对赌押筹码的只补普通筹码，押奎支的补奎支），钱包空了才问借不借。</p></div>`;
  }
  /** 主持人：自己坐庄的那几桌（庄家那一方）、谁坐在哪桌、等人坐的对赌桌 */
  function gmHtml(m) {
    const c = m.casino, head = `<header><h2>赌场</h2>${btn('data-cso="close"', "关闭")}</header>`;
    if (!c) return `<div class="ol-card crq-card cso-card">${head}<p class="ol-muted">只有联机跑团的探索环节有赌场。</p></div>`;
    const dealing = (c.dealing || []).map(d => `<section class="cso-deal"><h3>你给 ${esc(d.name)} 坐庄 · ${esc(d.tableName || "")}</h3>${gameHtml(d.game, m, `data-cso="tableDeal" data-kit="${esc(d.kit)}"`)}</section>`).join("");
    // 黑市赌命桌（kind "life"，#526）：你坐庄，庄家不用做决定；让他离桌 = 这一手押了还没结算的不算（同本机离桌）
    const where = (s) => s.kind === "pvp" ? `${s.mode === "duel" ? "Flux Duel " : ""}对赌（${s.stakeKind === "chips" ? "押筹码" : "押奎支"}）对手 ${esc(s.opponent || "还没坐下")}`
      : s.kind === "holdem" ? `${esc(s.tableName || "")} · 多人桌${s.auto ? " · AI 托管中" : ""}`
      : s.kind === "life" ? `${esc(s.tableName || "")} · 你坐庄（押坚毅，庄家不用做决定）`
      : `${esc(s.tableName || "")} · ${s.kind === "gm" ? "你坐庄" : s.mode === "guess" ? "赌场坐庄" : "AI 坐庄"}`;
    const seated = (c.seated || []).map(s => `<li class="crq-row"><div><b>${esc(s.name)}</b> · ${where(s)} · ${s.over ? "打完了" : s.round ? `第 ${s.round} 轮` : "等人"}</div>
      <div class="crq-state">${btn(`data-cso="leave" data-kit="${esc(s.kit)}"`, "让他离桌", { title: s.kind === "life" ? "卡住的桌子：让他离开赌命桌（押了还没结算的这一手不算）" : "卡住的桌子：按离桌结算（打到一半的对赌算他认输）" })}</div></li>`).join("");
    return `<div class="ol-card crq-card cso-card">${head}${dealing || '<p class="ol-muted">现在没有要你坐庄的桌子。玩家选「主持人坐庄」坐下时，这一桌出现在这里，由你出庄家那一方。</p>'}
      ${holdemGmHtml(c, m)}
      <h3>谁坐在哪桌</h3>${seated ? `<ul class="crq-list">${seated}</ul>` : '<p class="ol-muted">没有人坐桌。</p>'}${m.error ? `<p class="ol-bad" role="alert">${esc(m.error)}</p>` : ""}
      <p class="ol-muted cso-rule">不亮牌：你只看得到自己坐庄那一方的牌；玩家之间对赌的牌你也看不到。</p></div>`;
  }

  const levelAi = (lv) => `${LEVEL[lv] || LEVEL.normal} AI`;
  /** 赌场桌上对面是谁（大厅、牌桌顶栏写）：High Flux 是庄家，Flux 是对手；主持人坐庄写「主持人」 */
  function tableWho(seat) {
    if (seat.kind === "pvp") return `对手：${seat.opponent || "还没坐下"}`;
    if (seat.kind === "holdem") return `${seat.size || ""} 人桌 · ${seat.side || ""} 号座位`;
    if (seat.mode === "guess") return "庄家：赌场";   // 猜大猜小（#526）：庄家只抽牌、不用做决定
    if (seat.mode === "holdem") return `对手：${levelAi(seat.level)}`;
    return `${seat.mode === "duel" ? "对手" : "庄家"}：${seat.kind === "gm" ? "主持人" : levelAi(seat.level)}`;
  }
  const LEAVE_TITLE = "离桌结算：赌场桌桌上剩下的回钱包；对赌打到一半离桌算认输，押进底池的归对方；多人桌打到一半离桌交给 AI 托管";

  const TOOLS = "#online-stage .ol-stage-heading .ol-info-tools";
  const OPENERS = '#online-stage [data-cso="open-box"], #tr-casino';
  /** 联机牌桌（#526）用本机的哪一张牌桌：High Flux（counter-cards-ui.js）、Flux Duel / Hold'em（flux-ui.js 的两张）、
   *  猜大猜小（counter-cards-guess-ui.js：押筹码的赌场桌、黑市赌命桌），都有 remote 那一套 */
  const TABLE_UI = { highflux: () => root.CounterCardsUI, duel: () => root.FluxDuelUI, holdem: () => root.FluxHoldemUI, guess: () => root.CounterCardsGuessUI };
  /** o：{ api, view, own, call }；fast（测试用：牌桌上结算前不停） */
  function mount(o) {
    const doc = root.document;
    const box = doc.createElement("section"); box.id = "online-casino"; box.className = "ol-ui ol-overlay ol-bag ovl cso"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "赌场"); box.hidden = true;
    doc.body.appendChild(box);
    let open = false, busy = false, last = "", error = "", kit = null;
    let table = null;   // 开着的联机牌桌（#526）：{ ref: { kind: "mine" 自己的角色 | "life" 自己角色的黑市赌命桌 | "deal" 主持人替玩家坐庄 | "gm" 主持人自己的多人桌座位, kit / table }, ui }
    const opened = new Set();   // 已经替哪些角色领过赠送筹码（第一次打开时发一次 open）
    const draft = { buy: 1, sell: 1, buyIn: {}, side: "player", stake: "chips", mode: "highflux", holdem: { table: null, buyIn: 0, size: 4 } }, amount = {};
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
      return v().isHost ? (c.dealing || []).concat(c.gmSeats || []).some(d => d.game && d.game.myTurn)
        : (c.mine || []).some(r => r.seat && r.seat.game && r.seat.game.myTurn) || (c.life || []).some(x => x.game && x.game.myTurn);
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
    /* ---------- 联机牌桌（#526）：坐着的那一局用本机那张牌桌画（remote），操作发联机指令 ---------- */
    /** ref 指的那一局在最近一包里：{ seat（这一桌的信息）, game（这一方的 view）}；不在了是 null */
    function findTable(ref) {
      const c = casino();
      if (!c) return null;
      if (ref.kind === "mine") { const r = (c.mine || []).find(x => x.kit === ref.kit); return r && r.seat && r.seat.game ? { seat: r.seat, game: r.seat.game } : null; }
      if (ref.kind === "life") { const x = (c.life || []).find(y => y.kit === ref.kit); return x && x.game ? { seat: x, game: x.game } : null; }
      if (ref.kind === "deal") { const d = (c.dealing || []).find(x => x.kit === ref.kit); return d && d.game ? { seat: d, game: d.game } : null; }
      const s = (c.gmSeats || []).find(x => x.table === ref.table);
      return s && s.game ? { seat: s, game: s.game } : null;
    }
    /** 发一条赌场指令：{ ok, error }（没做成的原因交给牌桌写在操作栏里） */
    async function sendCmd(cmd) {
      let res = null;
      const done = await o.call(async () => (res = await o.api.submit(cmd)));
      return done ? { ok: true } : { ok: false, error: (res && res.error) || "没做成" };
    }
    /** Flux Hold'em 多人桌上一个座位坐的是谁：玩家 / 主持人 / 几级 AI（托管的写 AI 托管） */
    function seatTagOf(tableId, id) {
      const t = ((casino() || {}).holdem || []).find(x => x.id === tableId), s = t && (t.seats || []).find(x => x.id === id);
      if (!s) return "";
      if (s.auto) return "AI 托管";
      return s.kind === "player" ? "玩家" : s.kind === "gm" ? "主持人" : levelAi(t.difficulty);
    }
    /** 牌桌要的 src（counter-cards-ui.js · remote 的说明）：顶栏、对手座位上的字每次重画都按最近一包写 */
    function tableSrc(ref) {
      const cmd = (extra) => Object.assign({ type: "casino" }, ref.kind === "gm" ? { table: ref.table, asGm: true } : { kit: ref.kit }, ref.kind === "deal" ? { asDealer: true } : {}, extra);
      const seat = () => (findTable(ref) || {}).seat || {};
      const first = seat(), multi = ref.kind === "gm" || first.kind === "holdem";
      const levels = {};
      if (first.mode === "holdem" && !multi && first.game) (first.game.order || []).forEach(id => { if (id !== first.game.side) levels[id] = first.level; });
      return {
        view: () => { const f = findTable(ref); return f ? f.game : null; },
        act: (a) => sendCmd(cmd({ op: "act", action: a })),
        leave: ref.kind === "deal" ? null : () => sendCmd(cmd({ op: "leave" })),   // 主持人替玩家坐庄的那一桌不离桌（大厅里有「让他离桌」）
        back: () => { table = null; open = true; error = ""; last = ""; sync(); },
        get label() {
          const s = seat();
          if (ref.kind === "life") return `${s.name || ""}下注`;   // 黑市赌命桌（#526）
          if (ref.kind === "deal") return `${s.tableName || ""} · 你给 ${s.name || ""} 坐庄`;
          if (s.kind === "pvp") return `${gameName(s.mode)} 对赌 · ${s.stakeKind === "kuizhi" ? "押奎支" : "押筹码"} · 开局各 ${s.start} 枚`;
          return `${s.tableName || ""}${multi ? " · 多人桌" : ""} · 买入 ${s.buyIn} 枚`;
        },
        get who() { const s = seat(); return ref.kind === "life" ? "庄家：主持人" : ref.kind === "deal" ? `对手：${s.name || ""}` : tableWho(ref.kind === "gm" ? Object.assign({ kind: "holdem" }, s) : s); },
        // 黑市赌命桌（#526）：谁坐庄（写在庄家那一格）、结论（这一手结算后这名角色死了没有：房主那边算的，包里只有这一个结论）
        dealer: ref.kind === "life" ? "主持人" : null,
        get dead() { return ref.kind === "life" && !!seat().dead; },
        // 对手座位上的小字：主持人替玩家坐庄 → 玩家的角色名；对赌 → 对手的角色名；主持人坐庄 → 主持人；AI 坐庄 → 几级 AI
        get oppTag() { const s = seat(); return ref.kind === "deal" ? s.name || "玩家" : s.kind === "pvp" ? s.opponent || "玩家" : s.kind === "gm" ? "主持人" : levelAi(s.level); },
        seatTag: multi ? (id) => seatTagOf(ref.kind === "gm" ? ref.table : seat().table, id) : null,
        levels, level: first.level || "normal", leaveTitle: ref.kind === "life" ? "离开黑市赌命桌（押了还没结算不能离桌）" : LEAVE_TITLE, fast: !!o.fast
      };
    }
    /** 打开 ref 那一局的牌桌（收起赌场大厅）；画不了（没加载那张牌桌）返回 false */
    function openTable(ref) {
      const f = findTable(ref), ui = f && TABLE_UI[f.game.mode || "highflux"]();
      if (!ui || !ui.remote) return false;
      closeTable();
      if (!ui.remote(tableSrc(ref))) return false;
      table = { ref, ui };
      open = false; box.hidden = true;
      return true;
    }
    function closeTable() {
      if (table && table.ui.isRemote()) table.ui.remoteClose();
      table = null;
    }
    function sync() {
      const on = enabled(), isHost = !!v().isHost;
      hostButton(on && isHost);
      if (!on || isHost) doc.querySelectorAll('#online-stage [data-cso="open-box"]').forEach(b => b.remove());
      if (!on) { closeTable(); open = false; box.hidden = true; return; }
      // 开着牌桌：新的一包交给它接着画；不坐这一桌了（离桌了）它自己收起，回到赌场大厅看结算
      if (table) {
        table.ui.remoteSync();
        if (!table.ui.isRemote()) { table = null; open = true; error = ""; last = ""; }
      }
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
      // 坐下就开局的（赌场桌、坐上别人开的对赌桌、开桌的人点开局、赌命桌上桌）：做成了直接打开牌桌（ref 不给 = 这名角色坐着的那一局）
      const andPlay = (cmd, who, ref) => submit(cmd).then(done => { if (done) openTable(ref || { kind: "mine", kit: who }); });
      if (a === "table") return void openTable({ kind: "mine", kit: d.kit });
      if (a === "tableLife") return void openTable({ kind: "life", kit: d.kit });
      if (a === "tableDeal") return void openTable({ kind: "deal", kit: d.kit });
      if (a === "tableGm") return void openTable({ kind: "gm", table: d.table });
      // 黑市赌命桌（#526）：自己的角色上桌（押坚毅，主持人坐庄），上了桌直接打开牌桌
      if (a === "lifeSit") return void andPlay({ type: "casino", op: "lifeSit", kit: d.kit }, d.kit, { kind: "life", kit: d.kit });
      if (a === "sit") { draft.buyIn[d.table] = numIn(`[data-cso-buyin="${d.table}"]`, 0); return void andPlay({ type: "casino", op: "sit", kit: d.kit, table: d.table, buyIn: draft.buyIn[d.table], dealer: d.dealer }, d.kit); }
      if (a === "pvpOpen") {
        const mode = PVP_SIDES[draft.mode] ? draft.mode : "highflux", sides = PVP_SIDES[mode].map(([k]) => k);
        return void submit({ type: "casino", op: "pvpOpen", kit: d.kit, mode, side: sides.includes(draft.side) ? draft.side : sides[sides.length - 1], stakeKind: draft.stake });
      }
      if (a === "join") return void andPlay({ type: "casino", op: "pvpJoin", kit: d.kit, table: d.table }, d.kit);
      if (a === "leave") return void submit({ type: "casino", op: "leave", kit: d.kit });
      // Flux Hold'em 多人桌（#526）：玩家开桌 / 坐下 / 开局 / 接着打；主持人坐一个座位、开局、离开座位、接着打（asGm）
      if (a === "holdemOpen") {
        const h = draft.holdem;
        h.buyIn = numIn('[data-cso-in="hBuyIn"]', h.buyIn);
        return void submit({ type: "casino", op: "holdemOpen", kit: d.kit, table: h.table || ((casino().tables || []).find(t => t.game === "holdem") || {}).id, buyIn: h.buyIn, size: h.size });
      }
      if (a === "holdemJoin") return void submit({ type: "casino", op: a, kit: d.kit, table: d.table });
      if (a === "holdemStart" || a === "holdemBack") return void andPlay({ type: "casino", op: a, kit: d.kit, table: d.table }, d.kit);
      if (a === "holdemGm") return void submit({ type: "casino", op: "holdemGm", table: d.table, asGm: true });
      if (a === "holdemStartGm") return void submit({ type: "casino", op: "holdemStart", table: d.table, asGm: true });
      if (a === "holdemBackGm") return void submit({ type: "casino", op: "holdemBack", table: d.table, asGm: true }).then(done => { if (done) openTable({ kind: "gm", table: d.table }); });
      if (a === "leaveGm") return void submit({ type: "casino", op: "leave", table: d.table, asGm: true });
    }
    function onChange(e) {
      const t = e.target;
      if (t.dataset.csoIn === "side") draft.side = ["dealer", "player", "a", "b"].includes(t.value) ? t.value : "player";
      else if (t.dataset.csoIn === "mode") { draft.mode = t.value === "duel" ? "duel" : "highflux"; last = ""; paint(); }
      else if (t.dataset.csoIn === "hTable") { draft.holdem.table = t.value; last = ""; paint(); }
      else if (t.dataset.csoIn === "hBuyIn") draft.holdem.buyIn = Math.floor(Number(t.value)) || 0;
      else if (t.dataset.csoIn === "hSize") draft.holdem.size = Number(t.value) || 4;
      else if (t.dataset.csoIn === "stake") draft.stake = t.value === "kuizhi" ? "kuizhi" : "chips";
      else if (t.dataset.csoIn) draft[t.dataset.csoIn] = t.value;
      else if (t.dataset.csoBuyin) draft.buyIn[t.dataset.csoBuyin] = t.value;
    }
    const onKey = e => { e.stopPropagation(); if (e.key === "Escape") { open = false; sync(); } };
    const openFrom = e => { const b = e.target.closest(OPENERS); if (b) { open = true; error = ""; last = ""; sync(); welcome(); box.querySelector('[data-cso="close"]')?.focus({ preventScroll: true }); } };
    box.addEventListener("click", onClick); box.addEventListener("change", onChange); box.addEventListener("keydown", onKey);
    doc.addEventListener("click", openFrom);
    return { sync, el: box, openTable, table: () => table, open() { open = true; error = ""; last = ""; sync(); welcome(); },
      destroy() { closeTable(); doc.removeEventListener("click", openFrom); box.remove(); const b = doc.querySelector("#tr-casino"); if (b) b.remove(); } };
  }

  const api = { mount, playerHtml, gmHtml, gameHtml, tableWho };
  root.CasinoOnlineUI = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
