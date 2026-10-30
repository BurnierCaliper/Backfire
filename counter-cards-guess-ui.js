/* High Flux 黑市玩法：猜大猜小（#489）· 界面：标题 → 本地玩法 → 猜大猜小 → 选桌 → 牌桌
 * 规则在 counter-cards-guess.js；画面只拿 CounterCardsGuess.view(这一手, 你)，没翻开的牌根本不在里面。
 * 牌面、筹码堆、按钮借用 High Flux 的（counter-cards-ui.js · cardHtml / backHtml / chipsHtml / weatherMods，counter-cards.css），
 * 自己的布局在 counter-cards-guess.css。
 * 桌上：庄家盖着的三张牌（元素 / 天气 / 层牌，翻开一张亮一张，天气翻开有天气特效）；赔率表 5 格（−2 … +2：赔率、「k / N 种」，
 *   不开盘的格子灰掉写「不开」）。轮到你押时点开盘的格子加进这一轮的押注（默认最低注，− / + 调），「押注」一次交上去；
 *   押过的注摆在格子上，写锁定的赔率。第一轮「不押」= 这一手后面都不能押（按钮上写清楚）。
 * 结算横幅：结果、三张牌、押中几格、连本带利拿回多少、这一手净输赢（含入场费）。
 * 本地试玩：坐下拿 UI_CONFIG.startChips 枚筹码（null = 和 High Flux 的开局筹码一样），一手接一手，筹码带到下一手；
 *   交不起入场费就回设置页重新坐下。庄家是 AI（筹码无限，不用做决定）。
 * 页面骨架在 game.html 的 #scr-ccg；没有 Screens（测试里）时自己切 hidden。
 *
 *   CounterCardsGuessUI.open()                                         打开设置页（选桌）
 *   CounterCardsGuessUI.start({ table: "street", chips: 50, seed, deals })   直接坐下开一手（deals：测试用，按顺序指定每一手的三张牌）
 */
(function (root) {
  "use strict";

  const UI_CONFIG = {
    startChips: null,      // 本地试玩坐下拿几枚筹码；null = 和 High Flux 一样（CC_CONFIG.startChips）
    logLines: 14,          // 侧栏记录显示最近几条
    historyLines: 10,      // 侧栏「每手结算」显示最近几手
    // 每一轮下注时桌上是什么情况（提示语）
    roundText: { 1: "三张都盖着", 2: "元素翻开了", 3: "天气也翻开了，只剩层牌" }
  };
  const G = () => root.CounterCardsGuess;
  const CC = () => root.CounterCards;
  const CUI = () => root.CounterCardsUI;
  // screens.js 的 Screens 是顶层 const，不挂在 window 上
  const screens = () => (typeof Screens !== "undefined" ? Screens : root.Screens || null);
  const doc = () => root.document;
  const $ = (id) => doc().getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[ch]);
  const signed = (n) => (n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0");
  const ME = "me";
  const startChips = () => (UI_CONFIG.startChips != null ? UI_CONFIG.startChips : CC().CC_CONFIG.startChips);

  /* ---------- 牌面 ---------- */
  /** 天气这张牌：相位写猜大猜小自己的规则（克制分翻倍、不加天气修正），别的天气照 High Flux 的修正说明 */
  function weatherFace(w, cls) {
    const name = CC().weatherName(w), P = G().GUESS_CONFIG.phase;
    const mods = w === P.weather ? [`克制分 ×${P.mult}`, "不加天气修正"] : CUI().weatherMods(w);
    const color = (root.Icons && root.Icons.WEATHER && root.Icons.WEATHER[w] && root.Icons.WEATHER[w].c) || "#c9bfae";
    return `<span class="cc-card cc-wx${cls ? " " + cls : ""}" style="--c:${color}" data-weather="${w}" title="${esc(name + "：" + (mods.join("，") || "没有修正"))}">`
      + `<i class="cc-corner">${esc(name)}</i><span class="cc-ico">${root.Icons ? root.Icons.weather(w) : ""}</span><b class="cc-name">${esc(name)}</b>`
      + `<small class="cc-mods">${mods.map(esc).join("<br>") || "没有修正"}</small></span>`;
  }
  /** 庄家的一张牌：盖着是牌背（不带牌面），翻开是正面 */
  function faceOf(kind, val, cls) {
    if (!val) return CUI().backHtml({ cls: "cc-down" });
    return kind === "weather" ? weatherFace(val, cls) : CUI().cardHtml(val, { cls });
  }

  /* ---------- 状态 ---------- */
  const SETUP = { table: null };
  let S = null;   // { table, chips, seed, n（第几手）, hand, draft（这一轮还没交的押注 { 结果: 押多少 }）, msg, banner, last（上次画的，放动画用）, history, deals }
  let bound = false;

  function show(name) {
    const setup = $("ccg-setup"), game = $("ccg-game");
    if (setup) setup.hidden = name !== "setup";
    if (game) game.hidden = name !== "game";
  }
  function enterScreen() {
    const sc = screens();
    if (sc && sc.current) {
      if (sc.current() === "guess") return;
      try { sc.show("guess"); return; } catch (e) { /* 没注册上：自己切 */ }
    }
    const scr = $("scr-ccg");
    if (scr) scr.hidden = false;
    const title = $("scr-title");
    if (title) title.hidden = true;
    doc().body.dataset.screen = "guess";
  }
  function open() {
    bind();
    enterScreen();
    renderSetup();
    show("setup");
  }
  /** 坐下：opt.table（桌子 id）、opt.chips（带上桌的筹码，默认 startChips）、opt.seed、opt.deals（测试用） */
  function start(opt) {
    opt = opt || {};
    bind();
    const table = G().tableOf(opt.table || SETUP.table).id;
    SETUP.table = table;
    const seed = String(opt.seed || ("ccg" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)));
    S = { table, chips: opt.chips != null ? Math.max(0, Math.floor(Number(opt.chips) || 0)) : startChips(), seed, n: 0, hand: null, draft: {}, msg: "",
      banner: false, last: {}, anim: {}, history: [], deals: (opt.deals || []).slice() };
    enterScreen();
    show("game");
    if (!deal()) { renderSetup(); show("setup"); return null; }
    render();
    return S.hand;
  }
  /** 开下一手：入场费从带上桌的筹码里扣；交不起返回 false */
  function deal() {
    const t = G().tableOf(S.table);
    if (S.chips < t.entry) { S.msg = `筹码不够入场费 ${t.entry} 枚`; return false; }
    S.n += 1;
    const d = S.deals.length ? S.deals.shift() : null;
    S.hand = G().newHand({ seed: S.seed + "|" + S.n, table: S.table, players: [{ id: ME, name: "你", chips: S.chips }], deal: d || undefined });
    S.draft = {}; S.msg = ""; S.banner = false; S.last.shown = null; S.anim = { deal: true };
    sync();
    return true;
  }
  /** 这一手的筹码写回带上桌的筹码；结算了记一笔 */
  function sync() {
    const h = S.hand, me = h.players[0];
    S.chips = me.chips;
    if (h.over && !S.banner) {
      S.banner = true;
      S.history.push({ n: S.n, score: h.result.score, net: me.net, bet: me.slips.length > 0 });
    }
  }
  function toTitle() {
    leave();
    const sc = screens();
    if (sc) { sc.show("title"); return; }
    const scr = $("scr-ccg"), title = $("scr-title");
    if (scr) scr.hidden = true;
    if (title) title.hidden = false;
    doc().body.dataset.screen = "title";
  }
  function leave() {
    if (root.WeatherFx && $("ccg-fx")) root.WeatherFx.sync({ field: $("ccg-fx"), weather: "none" });
  }

  /* ---------- 押注：先在画面上攒好这一轮押哪几格，「押注」一次交上去 ---------- */
  const betOpt = (v) => v.legal.find(o => o.type === "bet") || null;
  const draftTotal = () => Object.keys(S.draft).reduce((s, k) => s + S.draft[k], 0);
  function humanAct(a) {
    if (!S || !S.hand || S.hand.over) return;
    try { G().act(S.hand, ME, a); } catch (e) { S.msg = e.message; render(); return; }
    S.draft = {}; S.msg = "";
    sync();
    render();
  }
  function pick(result) {
    const v = G().view(S.hand, ME), o = betOpt(v);
    if (!v.myTurn || !o) return;
    const cell = o.cells.find(x => x.result === result);
    if (!cell) return;
    if (S.draft[result] != null) delete S.draft[result];
    else if (draftTotal() + o.min > o.max) { S.msg = `筹码不够再押一格（每格至少 ${o.min} 枚）`; render(); return; }
    else S.draft[result] = o.min;
    S.msg = "";
    render();
  }
  function adjust(result, d) {
    const v = G().view(S.hand, ME), o = betOpt(v);
    if (!o || S.draft[result] == null) return;
    const room = o.max - draftTotal() + S.draft[result];
    S.draft[result] = Math.max(o.min, Math.min(room, S.draft[result] + d));
    render();
  }

  /* ---------- 画面 ---------- */
  function renderSetup() {
    const box = $("ccg-setup");
    if (!box) return;
    const ts = G().tables();
    if (!SETUP.table || !ts.some(t => t.id === SETUP.table)) SETUP.table = ts[0].id;
    const opt = (t) => `<button type="button" class="cc-opt${SETUP.table === t.id ? " on" : ""}" data-ccg="set" data-table="${esc(t.id)}" aria-pressed="${SETUP.table === t.id}">`
      + `<b>${esc(t.name)}</b><small>入场费 ${t.entry} 枚 · 每格最低注 ${t.minBet.join(" / ")}</small></button>`;
    const msg = S && S.msg ? `<p class="cc-msg" role="alert">${esc(S.msg)}</p>` : "";
    box.innerHTML = `<div class="cc-setup-card">
      <h2 class="cc-title">${esc(CC().CC_CONFIG.name)} · ${esc(G().GUESS_CONFIG.name)}</h2>
      <p class="cc-tagline">黑市玩法 · 庄家盖三张牌，分三轮押这一手的得分</p>
      <div class="cc-pick"><span class="cc-pick-label">坐哪张桌</span>${ts.map(opt).join("")}</div>
      <p class="cc-hint">本地试玩：坐下拿 ${startChips()} 枚筹码，一手接一手，筹码带到下一手；交不起入场费就重新坐下。庄家是 AI（筹码无限）。</p>
      ${msg}${rulesHtml()}
      <div class="cc-go"><button type="button" class="cc-btn" data-ccg="title">回到标题</button><button type="button" class="cc-btn primary" data-ccg="start">坐下</button></div>
    </div>`;
  }
  function rulesHtml() {
    const GC = G().GUESS_CONFIG, C = CC().CC_CONFIG, t = G().tableOf(SETUP.table || (S && S.table));
    const pct = Math.round(C.pctStep * 100);
    return `<details class="cc-rules"><summary>${esc(GC.name)} 规则</summary><ul>
      <li><b>牌</b>：庄家随机抽 1 张元素（${C.elements.length} 选 1）、1 张天气（${C.weathers.length} 选 1）、1 张层牌（${C.layers.length} 选 1），都盖在桌上。猜这一手的得分：${GC.results.map(G().label).join(" / ")}（超出按两头算）。</li>
      <li><b>计分</b>：和 ${esc(C.name)} 一样——克制 +1、劣势 −1、其余 0，天气修正每 ${pct}% 记 ±1（微光里能量以外的克制反转；酸雨里酸、冰以外打装甲另 +1）。相位只把克制分翻倍（+1→+2、−1→−2，0 不变），不加天气修正。</li>
      <li><b>下注</b>：三张盖好 → 第一轮下注 → 翻开元素 → 第二轮 → 翻开天气 → 第三轮 → 翻开层牌结算。每轮可押任意几格，押注按下注那一刻的赔率锁定。</li>
      <li><b>防白看</b>：每手入场费 ${t.entry} 枚（不退）；每格最低注第一轮 ${t.minBet[0]}、第二轮 ${t.minBet[1]}、第三轮 ${t.minBet[2]}；第一轮没押，后两轮不能再押。</li>
      <li><b>赔率</b>（连本带利）= ${GC.odds[0]}/${GC.odds[1]} × N ÷ k：N 是还没排除的组合数（245 → 35 → 5），k 是其中得出这个结果的组合数；不满 ${GC.halfBelow} 倍向下取到 0.5，满 ${GC.halfBelow} 倍取整；赔出半枚向下取整。不可能、必中、算出来不到 1 倍以上的格子不开盘。</li>
    </ul></details>`;
  }
  function render() {
    if (!S || !S.hand) return;
    const v = G().view(S.hand, ME);
    const app = $("ccg-game");
    if (!app) return;
    app.dataset.weather = v.shown.weather || "none";
    const was = S.last.shown || {};
    ["element", "weather", "layer"].forEach(k => { if (v.shown[k] && !was[k]) S.anim.flip = (S.anim.flip || []).concat([k]); });
    S.last.shown = Object.assign({}, v.shown);
    const top = $("ccg-top"), board = $("ccg-board"), actions = $("ccg-actions"), side = $("ccg-side"), banner = $("ccg-banner");
    if (top) top.innerHTML = topHtml(v);
    if (board) board.innerHTML = boardHtml(v);
    if (actions) actions.innerHTML = actionsHtml(v);
    if (side) side.innerHTML = sideHtml(v);
    if (banner) {
      const h = S.banner ? bannerHtml(v) : "";
      banner.innerHTML = h;
      banner.hidden = !h;
    }
    if (root.WeatherFx && $("ccg-fx")) root.WeatherFx.sync({ field: $("ccg-fx"), weather: v.shown.weather || "none" });
    S.anim = {};
  }
  function topHtml(v) {
    const status = v.over ? "这一手结束" : `第 ${v.round} / ${v.rounds} 轮下注`;
    return `<b class="cc-brand">${esc(CC().CC_CONFIG.name)} · ${esc(G().GUESS_CONFIG.name)}</b><span class="cc-round">${status}</span>`
      + `<span class="cc-role">${esc(v.table.name)} · 第 ${S.n} 手 · 庄家：AI</span>`
      + `<span class="cc-spacer"></span><button type="button" class="cc-btn" data-ccg="setup">换桌</button><button type="button" class="cc-btn" data-ccg="title">回到标题</button>`;
  }
  function boardHtml(v) {
    const flip = S.anim.flip || [], deal = !!S.anim.deal;
    const kinds = G().GUESS_CONFIG.cardKinds;
    const slot = (k, i) => {
      const val = v.shown[k];
      const cls = [flip.indexOf(k) >= 0 ? "cc-flip" : "", deal ? "cc-deal" : ""].filter(Boolean).join(" ");
      const face = val ? faceOf(k, val, cls) : CUI().backHtml({ cls: "cc-down" + (deal ? " cc-deal" : ""), delay: deal ? i : null });
      return `<div class="ccg-slot${val ? " up" : ""}" data-slot="${k}"><small>${esc(kinds[k])}</small>${face}</div>`;
    };
    const staked = v.me.slips.reduce((s, x) => s + x.amount, 0);
    const bump = (k, val) => { const old = S.last[k]; S.last[k] = val; return old !== undefined && old !== val; };
    return `<div class="ccg-dealer"><div class="cc-who"><b>庄家</b><small>AI · 筹码无限</small></div>
        <div class="ccg-slots">${G().GUESS_CONFIG.order.map(slot).join("")}</div></div>
      ${oddsHtml(v)}
      <div class="cc-seat ccg-seat">${CUI().chipsHtml(v.me.chips, { title: "你的筹码", label: "你的筹码", anim: bump("chips", v.me.chips) })}
        <div class="cc-who"><b>你</b><small>入场费 ${v.me.paid} 枚（不退）</small><small>这一手押了 ${staked} 枚</small></div></div>`;
  }
  /** 赔率表：5 格，写赔率（连本带利）和「k / N 种」；不开盘的灰掉；押过的注摆在格子上（锁定的赔率）；轮到你时开盘的格子能点 */
  function oddsHtml(v) {
    const o = v.myTurn ? betOpt(v) : null;
    const hit = v.result ? v.result.score : null;
    const cells = v.board.cells.map(c => {
      const can = !!o && c.open;
      const on = S.draft[c.result] != null;
      const tag = can ? "button" : "div";
      const attrs = can ? ` type="button" data-ccg="pick" data-result="${c.result}" aria-pressed="${on}"` : "";
      const slips = v.me.slips.filter(x => x.result === c.result).map(x =>
        `<span class="ccg-slip${x.win ? " win" : x.win === false ? " lose" : ""}" title="第 ${x.round} 轮押的，赔率锁定 ${x.odds} 倍">${x.amount} 枚 ×${x.odds}</span>`).join("");
      const cls = ["ccg-cell", c.open ? "open" : "closed", on ? "on" : "", hit === c.result ? "hit" : ""].filter(Boolean).join(" ");
      return `<${tag} class="${cls}" data-result="${c.result}"${attrs}><b class="ccg-res">${G().label(c.result)}</b>`
        + `<span class="ccg-x">${c.open ? "×" + c.odds : "不开"}</span><small class="ccg-k">${c.k} / ${v.board.N} 种</small>`
        + `${slips ? `<span class="ccg-slips">${slips}</span>` : ""}</${tag}>`;
    }).join("");
    const head = v.over ? `结果 ${G().label(hit)}` : `赔率表 · 第 ${v.round} 轮（连本带利）`;
    return `<div class="ccg-oddswrap"><small class="ccg-oddshead">${esc(head)}</small><div class="ccg-odds" role="group" aria-label="赔率表（连本带利）">${cells}</div></div>`;
  }
  function btn(act, label, o) {
    o = o || {};
    const data = Object.keys(o.data || {}).map(k => ` data-${k}="${esc(o.data[k])}"`).join("");
    return `<button type="button" class="cc-btn${o.primary ? " primary" : ""}${o.cls ? " " + o.cls : ""}" data-ccg="${act}"${data}${o.disabled ? " disabled" : ""}${o.title ? ` title="${esc(o.title)}"` : ""}>${label}</button>`;
  }
  function actionsHtml(v) {
    const msg = S.msg ? `<p class="cc-msg" role="alert">${esc(S.msg)}</p>` : "";
    if (v.over) return `<p class="cc-prompt">这一手结束了。</p>${msg}`;
    if (!v.myTurn) return `<p class="cc-prompt cc-wait">等别的玩家下注</p>${msg}`;
    const o = betOpt(v);
    let p = `第 ${v.round} 轮下注：${UI_CONFIG.roundText[v.round] || ""}，还剩 ${v.board.N} 种组合。`;
    p += o ? `点赔率表上开盘的格子押注，可以押好几格，每格至少 ${o.min} 枚；押注按现在的赔率锁定。` : `你的筹码不够这一轮的最低注 ${v.minBet} 枚，只能不押。`;
    if (v.round === 1) p += "第一轮不押，这一手后面都不能再押（入场费不退）。";
    const lines = Object.keys(S.draft).map(Number).sort((a, b) => a - b).map(r => {
      const cell = v.board.cells.find(x => x.result === r), n = S.draft[r];
      const room = o ? o.max - draftTotal() : 0;
      return `<span class="cc-amount ccg-line" role="group" aria-label="押 ${esc(G().label(r))}"><b class="ccg-res">${esc(G().label(r))}</b><small>×${cell ? cell.odds : "?"}</small>`
        + btn("amt", "−", { data: { result: r, d: -1 }, disabled: !o || n <= o.min, title: "少一枚" })
        + `<b class="cc-amt">${n}</b>`
        + btn("amt", "+", { data: { result: r, d: 1 }, disabled: room <= 0, title: "多一枚" })
        + btn("pick", "✕", { data: { result: r }, title: "这一格不押了" }) + `</span>`;
    }).join("");
    const total = draftTotal();
    const b = lines + (o ? btn("bet", total ? `押注 ${total} 枚` : "先点格子", { primary: true, disabled: !total || total > o.max }) : "")
      + btn("pass", v.round === 1 ? "不押（这一手不玩了）" : "这一轮不押", { cls: v.round === 1 ? "cc-danger" : "", primary: !o,
        title: v.round === 1 ? "第一轮不押，后两轮也不能押；入场费不退" : "第一轮押过了，这一轮不押下一轮照样能押" });
    return `<p class="cc-prompt">${p}</p><div class="cc-btns">${b}</div>${o ? `<p class="cc-info">手上 ${o.max} 枚 · 这一轮押了 ${total} 枚</p>` : ""}${msg}`;
  }
  function sideHtml(v) {
    const rows = S.history.slice(-UI_CONFIG.historyLines).reverse().map(x =>
      `<li class="cc-res ${x.net > 0 ? "win" : x.net < 0 ? "lose" : "tie"}"><b>第 ${x.n} 手</b><span>结果 ${esc(G().label(x.score))}</span><span class="cc-wxname">${x.bet ? "" : "没押"}</span><span class="cc-delta">${signed(x.net)}</span></li>`).join("");
    const log = v.log.slice(-UI_CONFIG.logLines).reverse().map(e => `<li>${esc(e.text)}</li>`).join("");
    return `<h3>每手结算</h3><ol class="cc-results">${rows || "<li class=\"cc-empty\">还没有结算</li>"}</ol>
      ${rulesHtml()}
      <h3>记录</h3><ul class="cc-log">${log}</ul>`;
  }
  /** 结算横幅：结果、三张牌、押中几格、拿回多少、这一手净输赢（含入场费） */
  function bannerHtml(v) {
    const r = v.result, me = v.me, P = G().GUESS_CONFIG.phase;
    const hits = me.slips.filter(x => x.win);
    const tone = me.net > 0 ? "win" : me.net < 0 ? "lose" : "";
    const how = `${CC().cardName(r.element)}打${CC().cardName(r.layer)} · 天气${CC().weatherName(r.weather)}${r.weather === P.weather ? `（克制分 ×${P.mult}）` : ""}`;
    const line = !me.slips.length ? "这一手你没押。" : hits.length ? `押中 ${hits.length} 格，连本带利拿回 ${me.won} 枚。` : "没押中。";
    const entry = v.table.entry, can = S.chips >= entry;
    return `<div class="cc-banner-card ccg-result ${tone}" role="dialog" aria-label="第 ${S.n} 手结算">
      <small>第 ${S.n} 手结算 · ${esc(v.table.name)}</small>
      <h3>结果 ${esc(G().label(r.score))}</h3>
      <div class="ccg-slots ccg-mini">${G().GUESS_CONFIG.order.map(k => faceOf(k, r[k])).join("")}</div>
      <p class="cc-tier">${esc(how)}</p>
      <p class="cc-tier">${esc(line)}</p>
      <p class="cc-deltas"><span class="${me.net > 0 ? "up" : me.net < 0 ? "down" : ""}">这一手 ${signed(me.net)} 枚</span><span>手上 ${S.chips} 枚</span></p>
      <p class="cc-quiet">净输赢含入场费 ${me.paid} 枚。</p>
      <div class="cc-btns">${btn("again", can ? `再来一手（入场费 ${entry}）` : `筹码不够入场费 ${entry} 枚`, { primary: can, disabled: !can })}${btn("setup", can ? "换桌" : "重新坐下", { primary: !can })}${btn("title", "回到标题")}</div>
    </div>`;
  }

  /* ---------- 点击 ---------- */
  function onClick(e) {
    const b = e.target && e.target.closest ? e.target.closest("[data-ccg]") : null;
    if (!b || b.disabled) return;
    const d = b.dataset;
    switch (d.ccg) {
      case "set": SETUP.table = d.table; renderSetup(); return;
      case "start": start({ table: SETUP.table }); return;
      case "setup": open(); return;
      case "title": toTitle(); return;
    }
    if (!S || !S.hand) return;
    switch (d.ccg) {
      case "again": if (deal()) render(); else { renderSetup(); show("setup"); } break;
      case "pick": pick(Number(d.result)); break;
      case "amt": adjust(Number(d.result), Number(d.d) || 0); break;
      case "bet": humanAct({ type: "bet", bets: Object.assign({}, S.draft) }); break;
      case "pass": humanAct({ type: "pass" }); break;
    }
  }
  function bind() {
    if (bound || !doc()) return;
    const scr = $("scr-ccg");
    if (!scr) return;
    scr.addEventListener("click", onClick);
    bound = true;
  }
  function boot() {
    bind();
    const scr = $("scr-ccg"), sc = screens();
    if (sc && scr) sc.register("guess", scr, { onHide: leave });
    const entry = $("t-ccg");
    if (entry) entry.onclick = () => open();
  }
  if (doc() && $("scr-ccg")) {
    if (doc().readyState === "loading") doc().addEventListener("DOMContentLoaded", boot);
    else boot();
  }

  root.CounterCardsGuessUI = {
    UI_CONFIG, open, start, render, weatherFace,
    state: () => S, view: () => (S && S.hand ? G().view(S.hand, ME) : null), act: humanAct
  };
})(typeof window !== "undefined" ? window : globalThis);
