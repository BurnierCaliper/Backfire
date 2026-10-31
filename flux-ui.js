/* Flux Duel / Flux Hold'em（#488）· 两张新牌桌共用的界面零件（界面 Akane）
 * 牌面、牌背、天气牌、筹码堆直接借 High Flux 的（counter-cards-ui.js · cardHtml / backHtml / weatherCardHtml / chipsHtml），
 * 样式借 counter-cards.css，自己的布局在 flux.css。这里是两张牌桌都要的：
 *   AI 排着走（人和 AI 看到的是同一份 view）、跟注后追加窗口的倒计时（秒数读 CC_CONFIG.callWindowSec，到时间调规则层的 closeWindow）、
 *   借贷和下注栏（过牌 / 跟注 / 下注 / 加注 / 全押 / 弃牌 / 借 3 枚（还 4）……，按规则给的 legal 出按钮）、
 *   克制表浮层（matchup-ui.js，格子是按场上天气——Hold'em 是两张叠加后——算好的实际得分）、
 *   手里元素牌的悬停预览（电脑上鼠标停上去、手机上长按；写这张牌按场上天气打五种层各得几分）、
 *   结算前的过渡（#525，计时和操作栏用 High Flux 那一份 CounterCardsUI.settle，时长读它的 UI_CONFIG.settle）：规则层一结算就开了下一轮，
 *   桌上先停在结算之前——最后一步、又翻开的牌一张一步、亮牌，每步停一下 → 判定中 → 结算横幅；过渡中 AI 不走、人没有按钮可点、追加窗口不计时，
 *   点一下桌面（或「直接看结算」）直接看结算；每一步画成什么样由各玩法给（spec.settle）。
 * 每张牌桌的画面（设置页、桌面、结算横幅……）由各自的文件给（flux-duel-ui.js / flux-holdem-ui.js），交给 FluxUI.table(spec)。
 * 页面骨架在 game.html 的 #scr-fd / #scr-fh；没有 Screens（测试里）时自己切 hidden。
 *
 *   const T = FluxUI.table({ key: "fd", screen: "fluxDuel", rules: () => FluxDuel, ai: () => FluxDuelAI, begin, setupHtml, topHtml, boardHtml, ... });
 *   T.open() / T.start(opt) / T.render() / T.state() / T.view() / T.act(操作)
 */
(function (root) {
  "use strict";

  const UI_CONFIG = {
    aiDelay: 650,          // AI 每一步之间停多久（毫秒）
    dealMs: 1200,          // 开局发牌动画放完之前 AI 不动
    logLines: 14,          // 侧栏记录显示最近几条
    // 克制表：入口按钮的字
    chart: {
      label: "克制表",
      hint: "元素牌 × 层牌，按场上天气算好的实际得分，随时能看，不影响出牌和下注"
    },
    // 悬停预览（手里的元素牌）：电脑上鼠标停上去、手机上长按弹出
    tip: { pressMs: 450, slop: 10, swallowMs: 600, gap: 12, margin: 8 }
  };
  const CC = () => root.CounterCards;
  const CUI = () => root.CounterCardsUI;
  const MU = () => root.MatchupUI || null;
  // screens.js 的 Screens 是顶层 const，不挂在 window 上
  const screens = () => (typeof Screens !== "undefined" ? Screens : root.Screens || null);
  const doc = () => root.document;
  const $ = (id) => (doc() ? doc().getElementById(id) : null);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[ch]);
  const signed = (n) => (n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0");
  const weatherColor = (w) => (root.Icons && root.Icons.WEATHER && root.Icons.WEATHER[w] && root.Icons.WEATHER[w].c) || "#c9bfae";
  /** 一张小天气牌（离场的天气列表里那种：图标 + 名字） */
  const miniWeather = (w) => `<span class="cc-mini" style="--c:${weatherColor(w)}">${root.Icons ? root.Icons.weather(w) : ""}${esc(CC().weatherName(w))}</span>`;

  /** 一张牌桌。spec（各玩法给）：
   *   key（id 前缀，"fd" → #fd-game、data-fd）、screen（Screens 里的名字）、rules() / ai()（规则、AI 模块）、
   *   begin(opt) → { game, human, levels: { AI 坐的一方: 难度 } }（开一局，opt.game = 接着打）、
   *   setupHtml(T)、topHtml(T, v)、boardHtml(T, v)、sideHtml(T, v)、bannerHtml(T, 结果, v)、finalHtml(T, v)、
   *   stageControls(T, v) → { p, b }（下注以外的步骤：出牌……）、waitText(T, v)、streetText(T, v)、infoLine(T, v)、
   *   weatherOf(v)（天气特效用哪张）、chart(v, 结算横幅的那一轮)（克制表数据）、chartKey(v, 结算横幅的那一轮)、tipHtml(T, 牌, v)、
 *   click(T, act, dataset)（自己的按钮，处理了返回 true）、
 *   settle（结算前的过渡，#525；不给就照旧一结算就弹横幅）：{ beats(T, 做最后一步之前的画面, 现在的画面, 这一轮的结算) → st（{ beats, judge, texts, acted, note?, … }），
 *     view(T, 现在的画面, st)（第 st.at 步桌上停成什么样）, note（判定中那一行的说明；st.note 优先）, collect(T, 结算) → 弹横幅时筹码「收进来」的那几方 } */
  function table(spec) {
    const K = spec.key, ATTR = "data-" + K, TIP = "data-" + K + "-tip", TIPKEY = K + "Tip";
    const el = (s) => $(K + "-" + s);
    const R = () => spec.rules(), AIm = () => spec.ai();
    const CS = () => CUI().settle;   // 结算前的过渡：High Flux 那一份共用的计时、操作栏（counter-cards-ui.js）
    let S = null, bound = false;

    function btn(act, label, o) {
      o = o || {};
      const data = Object.keys(o.data || {}).map(k => ` data-${k}="${esc(o.data[k])}"`).join("");
      return `<button type="button" class="cc-btn${o.primary ? " primary" : ""}${o.cls ? " " + o.cls : ""}" ${ATTR}="${act}"${data}${o.disabled ? " disabled" : ""}${o.title ? ` title="${esc(o.title)}"` : ""}>${label}</button>`;
    }

    /* ---------- 界面切换 ---------- */
    function show(name) {
      const s = el("setup"), g = el("game");
      if (s) s.hidden = name !== "setup";
      if (g) g.hidden = name !== "game";
    }
    function enterScreen() {
      const sc = screens();
      if (sc && sc.current) {
        if (sc.current() === spec.screen) return;
        try { sc.show(spec.screen); return; } catch (e) { /* 没注册上：自己切 */ }
      }
      const scr = $("scr-" + K);
      if (scr) scr.hidden = false;
      const title = $("scr-title");
      if (title) title.hidden = true;
      doc().body.dataset.screen = spec.screen;
    }
    function leave() { stopAll(); if (root.WeatherFx && el("fx")) root.WeatherFx.sync({ field: el("fx"), weather: "none" }); }
    function toTitle() {
      leave();
      const sc = screens();
      if (sc) { sc.show("title"); return; }
      const scr = $("scr-" + K), title = $("scr-title");
      if (scr) scr.hidden = true;
      if (title) title.hidden = false;
      doc().body.dataset.screen = "title";
    }
    function renderSetup() { const box = el("setup"); if (box) box.innerHTML = spec.setupHtml(api); }
    function open() { bind(); stopAll(); enterScreen(); renderSetup(); show("setup"); }
    /** 开一局：opt 交给 spec.begin（种子没给就现编一个）；opt.fast：AI 不等（测试用）；opt.casino：赌场桌（离桌 / 再来一局交回模式，每一步叫 onChange） */
    function start(opt) {
      opt = opt || {};
      bind(); stopAll();
      const seed = String(opt.seed || (K + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)));
      const s = spec.begin(Object.assign({}, opt, { seed }));
      S = Object.assign({ seed, rng: {}, banner: null, settle: null, amount: null, msg: "", sel: {}, fast: !!opt.fast, timer: null, win: null, tip: null,
        anim: { deal: true }, last: {}, casino: opt.casino || null, holdUntil: opt.fast ? 0 : Date.now() + UI_CONFIG.dealMs }, s);
      S.seen = S.game.results.length;
      enterScreen();
      show("game");
      render();
      schedule();
      return S.game;
    }
    function stopTimer() { if (S && S.timer) { clearTimeout(S.timer); S.timer = null; } }
    function stopAll() { stopTimer(); stopWindow(); dropSettle(); closeChart(); stopTip(); }

    /* ---------- 推进：人做一步 → 看有没有新的结算（有就先放结算前的过渡）→ AI 接着走 ---------- */
    function humanAct(a) {
      if (!S || S.game.over || S.settle) return;
      const pre = R().view(S.game, S.human);   // 做这一步之前的画面：这一步要是结算了，过渡中桌上从这里接着画
      try { R().act(S.game, S.human, a); } catch (e) { S.msg = e.message; render(); return; }
      S.amount = null; S.msg = ""; S.sel = {};
      afterChange(pre);
    }
    function afterChange(pre) {
      const g = S.game;
      if (g.results.length > S.seen) { S.seen = g.results.length; settleStart(g.results[g.results.length - 1], pre); }
      // 牌局里翻开了新的天气 / 层牌：AI 至少等 settle.flipMs 才接着走（主人 10/31：一张牌至少看清一秒）
      else if (!S.fast) S.holdUntil = Math.max(S.holdUntil || 0, CS().holdAfterFlip(pre, R().view(S.game, S.human)));
      render();
      schedule();
      // 赌场桌：牌局走了一步（人或 AI），交给模式存档
      if (S.casino && S.casino.onChange) S.casino.onChange(g);
    }

    /* ---------- 结算前的过渡（#525）：最后一步、又翻开的牌一张一步、亮牌（每步停一下）→ 判定中 → 结算横幅 ----------
     * 规则层那一步已经结算完、开了下一轮，过渡中桌上停在结算之前（spec.settle.view 按 S.settle.at 画）；计时是 High Flux 那一份（CounterCardsUI.settle）。
     * fast（测试用）、没给 spec.settle 的玩法不停，直接弹横幅 */
    const settleHost = { live: (st) => !!S && S.settle === st, render: () => render(), end: () => settleEnd() };
    function settleStart(res, pre) {
      const st = !S.fast && pre && spec.settle ? spec.settle.beats(api, pre, R().view(S.game, S.human), res) : null;
      if (!st) { S.banner = res; return; }
      S.settle = Object.assign(st, { res, pre });
      CS().begin(S.settle, settleHost);
    }
    /** 过渡放完（或点了跳过）：弹出结算横幅，拿到筹码的那几方的筹码堆「收进来」 */
    function settleEnd() {
      const st = S && S.settle;
      if (!st) return;
      CS().stop(st);
      S.settle = null;
      S.banner = st.res;
      S.anim.collect = spec.settle.collect ? spec.settle.collect(api, st.res) : [];
      render();
      schedule();
    }
    /** 不放了（回设置页、换一局、离开牌桌）：停掉计时，当成已经弹出横幅（不画） */
    function dropSettle() {
      if (!S || !S.settle) return;
      CS().stop(S.settle);
      S.banner = S.settle.res;
      S.settle = null;
    }
    /** 现在桌上画的那一份：过渡中是停在结算之前的那一步，平时就是规则给的 view */
    function shownView() {
      const v = R().view(S.game, S.human);
      return S.settle ? spec.settle.view(api, v, S.settle) : v;
    }
    /** 过渡中的操作栏（High Flux 那一份）：这一步做了什么 / 判定中（说明读 st.note，没有就是 spec.settle.note），「直接看结算」 */
    function settleBar() {
      const st = S.settle, T = CUI().UI_CONFIG.settle, i = Math.min(st.at, st.texts.length - 1);
      return CS().bar(st, st.texts[i] || "这一轮的下注结束了。", st.note != null ? st.note : spec.settle.note, btn("skipSettle", esc(T.skip), { title: T.skipHint }));
    }
    function casinoHook(name) {
      if (!S || !S.casino || typeof S.casino[name] !== "function") return;
      try { S.casino[name](); } catch (e) { if (S) { S.msg = e.message; render(); } }
    }
    /** 现在轮到的 AI（人以外、有难度的那几方） */
    function aiSeats() { return S ? R().toAct(S.game).filter(k => k !== S.human && S.levels && S.levels[k]) : []; }
    // 结算前的过渡、结算横幅开着时 AI 不走
    function schedule() {
      stopTimer();
      if (!S || S.banner || S.settle || S.game.over || !aiSeats().length) return;
      if (S.fast) { aiStep(); return; }
      S.timer = setTimeout(aiStep, Math.max(UI_CONFIG.aiDelay, (S.holdUntil || 0) - Date.now()));
    }
    function aiStep() {
      if (!S) return;
      S.timer = null;
      if (S.banner || S.settle || S.game.over) return;
      const who = aiSeats()[0];
      if (!who) return;
      const rng = S.rng[who] || (S.rng[who] = CC().makeRng(S.seed + "|ai|" + who));
      const pre = R().view(S.game, S.human);
      if (!AIm().step(S.game, who, S.levels[who], rng)) { render(); return; }   // 没走成（不该发生）：别一直重排
      afterChange(pre);
    }
    /** fast：AI 不等、马上走（测试用）；打开时正在放的结算前的过渡也不等了 */
    function setFast(on) { if (!S) return; S.fast = !!on; if (S.fast && S.settle) { settleEnd(); return; } schedule(); }
    function dismiss() { if (S) { S.banner = null; render(); schedule(); } }

    /* ---------- 跟注后的追加窗口：倒计时（同 High Flux 的牌桌：同一个窗口只计一次时，整块重画接着数） ---------- */
    const windowKey = (v) => (v.betting && v.betting.window ? `${v.round}:${v.betting.street}:${v.betting.window.n}` : "");
    function syncWindow(v) {
      const k = S.banner || v.over ? "" : windowKey(v);
      if (!k) { stopWindow(); return; }
      if (S.win && S.win.key === k) return;
      stopWindow();
      S.win = { key: k, until: Date.now() + v.betting.window.sec * 1000, sec: v.betting.window.sec, timer: null };
    }
    const windowLeft = () => (S && S.win ? Math.max(0, S.win.until - Date.now()) : 0);
    function tickWindow() {
      const W = S && S.win;
      if (!W) return;
      if (W.timer) { clearTimeout(W.timer); W.timer = null; }
      const left = W.until - Date.now();
      if (left <= 0) { W.timer = setTimeout(expireWindow, 0); return; }
      const c = el("actions") && el("actions").querySelector(".cc-count");
      if (c) c.textContent = String(Math.ceil(left / 1000));
      W.timer = setTimeout(tickWindow, ((left - 1) % 1000) + 1);
    }
    function stopWindow() { if (S && S.win) { if (S.win.timer) clearTimeout(S.win.timer); S.win = null; } }
    /** 倒计时到了：关窗，进入下一步；关窗就结算的，结算前的过渡从关窗之前的画面接着画 */
    function expireWindow() {
      stopWindow();
      if (!S || S.settle) return;
      const pre = R().view(S.game, S.human);
      if (!R().closeWindow(S.game)) return;
      S.amount = null; S.msg = "";
      afterChange(pre);
    }
    function windowClock() {
      if (!S || !S.win) return "";
      const left = windowLeft(), sec = S.win.sec * 1000;
      return `<div class="cc-window" style="--sec:${sec}ms;--gone:${left - sec}ms"><span class="cc-clock" role="timer" aria-label="追加窗口倒计时"><b class="cc-count">${Math.ceil(left / 1000)}</b> 秒</span>`
        + `<span class="cc-winbar" aria-hidden="true"><i></i></span></div>`;
    }

    /* ---------- 操作栏：借贷、下注（两张牌桌一样），其余步骤交给各玩法 ---------- */
    /** 借贷按钮：一份一个（借 3 / 借 6 ……），写上结束时要还多少；from：从多少枚起（跟不起时从够跟的数目起） */
    function loanBtns(o, primary, from) {
      let out = "";
      const first = Math.max(o.min, from || 0);
      for (let n = first; n <= o.max; n += o.step) {
        const back = CC().repayOf(n);
        out += btn("borrow", `借 ${n} 枚（还 ${back}）`, { data: { amount: n }, cls: "cc-loanbtn", primary: primary && n === first, title: `向主持方借 ${n} 枚，对局结束时还 ${back} 枚` });
      }
      return out;
    }
    function amountControls(o, verb, act) {
      return `<span class="cc-amount" role="group" aria-label="${verb}额">`
        + btn("amt", "−", { data: { d: -1 }, disabled: S.amount <= o.min, title: "少一枚" })
        + `<b class="cc-amt">${S.amount}</b>`
        + btn("amt", "+", { data: { d: 1 }, disabled: S.amount >= o.max, title: "多一枚" })
        + btn("amt", "最大", { data: { set: "max" }, disabled: S.amount >= o.max, title: `最多 ${o.max} 枚` })
        + `</span>` + btn(act, `${verb} ${S.amount}`, { cls: "cc-hot" });
    }
    function loanControls(v) {
      const o = v.legal.find(x => x.type === "borrow"), broke = v.me.chips <= 0 && (v.me.pot || 0) <= 0;
      const p = `第 ${v.round} 轮开始前：你手上只有 ${v.me.chips} 枚筹码，不够这一轮${spec.loanNeedText ? spec.loanNeedText(api, v) : ""}（${o ? o.need : ""} 枚）。`
        + `可以向主持方借：${v.loan.unit} 枚一份，每借 ${v.loan.unit} 枚，对局结束时还 ${v.loan.repay} 枚。`
        + (broke ? (spec.bustText || "你已经输光了，不借的话这一局就结束。") : "不借也能接着打。");
      return { p, b: (o ? loanBtns(o, broke) : "") + btn("noLoan", broke ? (spec.bustNoLoan || "不借（结束对局）") : "不借", { primary: !broke }) };
    }
    function betControls(v) {
      const has = (t) => v.legal.find(o => o.type === t);
      const bet = has("bet"), raise = has("raise"), call = has("call"), allIn = has("allIn");
      const toCall = v.betting ? v.betting.toCall : 0;
      const short = toCall > 0 && !call;
      const o = bet || raise;
      if (o && (S.amount == null || S.amount < o.min || S.amount > o.max)) S.amount = o.min;
      let p = `${spec.streetText(api, v)}：${toCall > 0 ? `要跟 ${toCall} 枚。` : "还没人下注。"}`;
      let b = "";
      if (has("check")) b += btn("check", "过牌", { primary: !o });
      if (call) b += btn("call", `跟注 ${call.amount}`, { primary: true });
      if (o) {
        b += amountControls(o, bet ? "下注" : "加注", bet ? "bet" : "raise");
        p += bet ? ` 下注至少 ${o.min} 枚。` : ` 加注至少 ${o.min} 枚。`;
      }
      if (allIn) b += btn("allIn", `全押 ${allIn.amount}`, { cls: "cc-hot", title: "手上的筹码不够跟：押上剩下的全部，比你多押的那部分另开边池" });
      b += btn("fold", "弃牌", { cls: "cc-danger", title: spec.foldTitle || "立即判负：输掉自己已下的筹码" });
      const lo = has("borrow");
      if (lo && short) {
        p += ` 你手上只有 ${v.me.chips} 枚，跟不起：要跟就先向主持方借（每借 ${v.loan.unit} 枚，结束时还 ${v.loan.repay} 枚）${allIn ? "，或者全押" : ""}，不然只能弃牌。借完还是你下注。`;
        b += loanBtns(lo, true, Math.ceil((toCall - v.me.chips) / lo.step) * lo.step);
      } else if (lo) {
        p += ` 手上的筹码不够（这一步要 ${lo.need} 枚，你只有 ${v.me.chips} 枚），可以先向主持方借（每借 ${v.loan.unit} 枚，结束时还 ${v.loan.repay} 枚），借完还是你下注。`;
        b += loanBtns(lo, false);
      }
      return { p, b };
    }
    function windowControls(v) {
      const w = v.betting.window, raise = v.legal.find(o => o.type === "raise");
      if (raise && (S.amount == null || S.amount < raise.min || S.amount > raise.max)) S.amount = raise.min;
      let p = `${w.by === S.human ? "你" : spec.seatName(api, w.by)}跟注了。${w.sec} 秒追加窗口：还可以加注或弃牌，没人动作就结束这个下注回合。`;
      if (raise) p += ` 加注至少 ${raise.min} 枚（算进这一回合的加注次数）。`;
      else p += " 你加不了注了（没有筹码或加注次数用完）。";
      const b = (raise ? amountControls(raise, "加注", "raise") : "")
        + btn("fold", "弃牌", { cls: "cc-danger", title: spec.foldTitle || "立即判负：输掉自己已下的筹码" })
        + btn("pass", "不加注", { primary: true, title: "放弃追加：都不加注就不用等到时间" });
      return `<p class="cc-prompt">${p}</p><div class="cc-btns">${b}</div>`;
    }
    function actionsHtml(v) {
      const msg = S.msg ? `<p class="cc-msg" role="alert">${esc(S.msg)}</p>` : "";
      if (S.settle) return settleBar() + msg;
      if (v.over) return `<p class="cc-prompt">对局结束。</p>${msg}`;
      if (S.banner) return `<p class="cc-prompt">看一下这一轮的结算。</p>${msg}`;
      const info = spec.infoLine ? spec.infoLine(api, v) : "";
      if (!v.myTurn) {
        if (v.betting && v.betting.window) return `${windowClock()}<p class="cc-prompt cc-wait">你不加注了，等别人……</p>${info}${msg}`;
        return `<p class="cc-prompt cc-wait">${esc(spec.waitText(api, v))}</p>${info}${msg}`;
      }
      if (v.stage === "bet1" || v.stage === "bet2") {
        if (v.betting && v.betting.window) return `${windowClock()}${windowControls(v)}${info}${msg}`;
        const x = betControls(v);
        return `<p class="cc-prompt">${x.p}</p><div class="cc-btns">${x.b}</div>${info}${msg}`;
      }
      const x = v.stage === "loan" ? loanControls(v) : spec.stageControls(api, v);
      return `<p class="cc-prompt">${x.p}</p><div class="cc-btns">${x.b}</div>${info}${msg}`;
    }

    /* ---------- 画面 ---------- */
    function render() {
      if (!S) return;
      const v = shownView();   // 结算前的过渡：桌上停在结算之前
      const app = el("game");
      if (!app) return;
      app.dataset.weather = spec.weatherOf(v) || "none";
      syncWindow(v);   // 过渡中的画面没有下注回合：追加窗口不计时，过渡放完才开
      const top = el("top"), board = el("board"), actions = el("actions"), side = el("side"), banner = el("banner");
      if (top) top.innerHTML = spec.topHtml(api, v);
      if (board) board.innerHTML = spec.boardHtml(api, v);
      if (actions) actions.innerHTML = actionsHtml(v);
      tickWindow();
      if (side) side.innerHTML = spec.sideHtml(api, v);
      if (banner) {
        const h = S.banner ? spec.bannerHtml(api, S.banner, v) : v.over ? spec.finalHtml(api, v) : "";
        banner.innerHTML = h;
        banner.hidden = !h;
      }
      if (root.WeatherFx && el("fx")) root.WeatherFx.sync({ field: el("fx"), weather: spec.weatherOf(v) || "none" });
      // 克制表开着：场上的天气变了（或者结算横幅收起，换回这一轮的天气）才重画
      if (chartOpen() && S.chartKey !== spec.chartKey(v, S.banner)) { S.chartKey = spec.chartKey(v, S.banner); MU().refresh(); }
      if (S.tip) showTip(S.tip.card, S.tip.via);
      S.anim = {};
    }
    /** 整块重画时只给变了的东西放动画：k 这一项的值变了（第一次画时看是不是开局发牌） */
    function bump(k, val) { const was = S.last[k]; S.last[k] = val; return was === undefined ? !!S.anim.deal : was !== val; }
    /** 自己手里的一张牌（牌面同 High Flux 的 cardHtml）：o.act（点了做什么；没有就是不能点的 span）、o.tip（能看悬停预览）、
     *  o.cls / o.note / o.delay / o.disabled / o.data / o.title */
    function handCard(card, o) {
      o = o || {};
      const ui = CUI(), name = CC().cardName(card);
      const kind = CC().CC_CONFIG.layers.indexOf(card) >= 0 ? "ly" : CC().isElement(card) ? "el" : "nm";
      const tag = o.act ? "button" : "span";
      const data = Object.keys(o.data || {}).map(k => ` data-${k}="${esc(o.data[k])}"`).join("");
      const attrs = (o.act ? ` type="button" ${ATTR}="${o.act}" data-card="${card}"${data}${o.disabled ? " disabled" : ""}` : "")
        + (o.tip ? ` ${TIP}="${card}"` : ` title="${esc(o.title || name)}"`);
      return `<${tag} class="cc-card cc-${kind}${o.cls ? " " + o.cls : ""}" style="--c:${ui.cardColor(card)}${o.delay != null ? `;--d:${o.delay}` : ""}" data-face="${card}"${attrs}>`
        + `<i class="cc-corner">${esc(name)}</i><span class="cc-ico">${ui.cardIcon(card)}</span><b class="cc-name">${esc(name)}</b>`
        + `${o.note ? `<small class="cc-note">${esc(o.note)}</small>` : ""}</${tag}>`;
    }
    /** 向主持方借了多少、结束时要还多少（公开的） */
    function loanTag(s, who) {
      return s && s.loan ? `<small class="cc-loan" title="${esc(who)}向主持方借了 ${s.loan} 枚，对局结束时还 ${s.owe} 枚">借 ${s.loan} 枚 · 结束时还 ${s.owe} 枚</small>` : "";
    }
    function logHtml(v) {
      return v.log.slice(-UI_CONFIG.logLines).reverse().map(e => `<li class="${e.to ? "cc-private" : ""}">${esc(e.text)}</li>`).join("");
    }

    /* ---------- 克制表（得分）：和平时同一个浮层（matchup-ui.js），只读 ---------- */
    const gameShown = () => { const g = el("game"); return !!(S && g && !g.hidden && doc().body.dataset.screen === spec.screen); };
    function chartOpen() {
      const m = MU(), box = $("mu-overlay"), scr = $("scr-" + K);
      return !!(m && m.isOpen() && box && scr && scr.contains(box));
    }
    /** 打开克制表：按场上的天气算；结算横幅开着时按刚结算的那一轮的天气（Hold'em 两张天气要到亮牌时才都翻开，横幅上看的就是叠加后的）；
     *  结算前的过渡中按桌上停着的那一步 */
    function openChart() {
      const m = MU();
      if (!m || !S) return false;
      stopTip();
      S.chartKey = spec.chartKey(shownView(), S.banner);
      m.open(() => spec.chart(shownView(), S.banner), { mount: el("game") });
      const close = $("mu-overlay") && $("mu-overlay").querySelector("[data-mu-close]");
      if (close && typeof close.focus === "function") close.focus();
      return true;
    }
    function closeChart() { if (chartOpen()) MU().close(); }
    function chartBtn(sub) {
      const T = UI_CONFIG.chart;
      return MU() ? `<button type="button" class="cc-btn cc-chartbtn" ${ATTR}="chart" aria-haspopup="dialog" title="${esc(T.hint)}"><b>${esc(T.label)}</b><small>${esc(sub || "")}</small></button>` : "";
    }
    const bannerChartBtn = () => (MU() ? btn("chart", esc(UI_CONFIG.chart.label), { title: UI_CONFIG.chart.hint }) : "");

    /* ---------- 悬停预览：手里的元素牌（电脑鼠标停上去、手机长按），同 High Flux 的牌桌 ---------- */
    const tipBox = () => el("tip");
    const tipCard = (t) => (t && t.closest ? t.closest(`[${TIP}]`) : null);
    const tipAnchor = (card) => { const b = el("board"); return b ? b.querySelector(`[${TIP}="${card}"]`) : null; };
    function showTip(card, via) {
      const box = tipBox(), a = tipAnchor(card);
      if (!S || !box || !a || S.banner || S.game.over || !gameShown() || chartOpen()) { hideTip(); return; }
      const v = shownView();
      S.tip = { card, via };
      box.innerHTML = spec.tipHtml(api, card, v);
      box.dataset.card = card;
      box.dataset.weather = (spec.chartKey(v, null) || "none");
      box.hidden = false;
      const was = el("board").querySelector(`[aria-describedby="${K}-tip"]`);
      if (was && was !== a) was.removeAttribute("aria-describedby");
      a.setAttribute("aria-describedby", K + "-tip");
      placeTip();
    }
    function hideTip() {
      if (S) S.tip = null;
      const box = tipBox(), b = el("board"), was = b && b.querySelector(`[aria-describedby="${K}-tip"]`);
      if (box && !box.hidden) box.hidden = true;
      if (was) was.removeAttribute("aria-describedby");
    }
    function placeTip() {
      const box = tipBox(), a = S && S.tip ? tipAnchor(S.tip.card) : null;
      if (!box || box.hidden || !a) return;
      const T = UI_CONFIG.tip, r = a.getBoundingClientRect(), hand = a.parentNode.getBoundingClientRect();
      const w = box.offsetWidth, h = box.offsetHeight;
      const left = Math.max(T.margin, Math.min((root.innerWidth || 0) - w - T.margin, r.left + r.width / 2 - w / 2));
      let top = Math.min(r.top, hand.top) - h - T.gap;
      if (top < T.margin) top = Math.max(r.bottom, hand.bottom) + T.gap;
      box.style.left = Math.round(left) + "px";
      box.style.top = Math.round(top) + "px";
    }
    function onTipOver(e) {
      if (!S || e.pointerType === "touch") return;
      const c = tipCard(e.target);
      if (c) { if (!S.tip || S.tip.card !== c.dataset[TIPKEY] || S.tip.via !== "hover") showTip(c.dataset[TIPKEY], "hover"); }
      else if (S.tip) hideTip();
    }
    function onTipOut(e) {
      if (!S || !S.tip || S.tip.via !== "hover" || e.pointerType === "touch") return;
      const c = tipCard(e.target);
      if (!c || (e.relatedTarget && c.contains(e.relatedTarget))) return;
      hideTip();
    }
    let press = null;
    function endPress() { if (press && press.timer) clearTimeout(press.timer); press = null; }
    function onTipTouch(e) {
      endPress();
      if (!S) return;
      S.tipSwallow = null;
      if (S.tip) hideTip();
      const c = tipCard(e.target), t = e.touches && e.touches[0];
      if (!c || !t || e.touches.length > 1) return;
      const p = press = { card: c.dataset[TIPKEY], x: t.clientX, y: t.clientY, fired: false, timer: null };
      p.timer = setTimeout(() => { p.timer = null; if (press !== p) return; p.fired = true; showTip(p.card, "press"); }, UI_CONFIG.tip.pressMs);
    }
    function onTipMove(e) {
      const t = e.touches && e.touches[0];
      if (press && !press.fired && (!t || Math.hypot(t.clientX - press.x, t.clientY - press.y) > UI_CONFIG.tip.slop)) endPress();
    }
    function onTipEnd(e) {
      if (press && press.fired) {
        if (e.cancelable) e.preventDefault();
        if (S) S.tipSwallow = { card: press.card, until: Date.now() + UI_CONFIG.tip.swallowMs };
      }
      endPress();
    }
    function onTipMenu(e) { if (tipCard(e.target)) e.preventDefault(); }
    function stopTip() { endPress(); hideTip(); }

    /* ---------- 点击 ---------- */
    function onClick(e) {
      const b = e.target && e.target.closest ? e.target.closest(`[${ATTR}]`) : null;
      // 结算前的过渡：点一下桌面（牌桌、操作栏里按钮以外的地方）直接看结算；顶栏、侧栏照常
      if (S && S.settle && !b && e.target && e.target.closest && e.target.closest(`.cc-table, #${K}-actions`)) { settleEnd(); return; }
      if (!b || b.disabled) return;
      // 长按看预览、松手后浏览器要是还补了一下点击：不算（只拦长按的那一张、只拦一下）
      const sw = S && S.tipSwallow;
      if (sw) { S.tipSwallow = null; if (b.dataset.card === sw.card && Date.now() < sw.until) return; }
      const d = b.dataset, act = d[K];
      switch (act) {
        case "title": toTitle(); return;
        case "setup": open(); return;
        case "dismiss": dismiss(); return;
        case "skipSettle": settleEnd(); return;   // 结算前的过渡：直接看结算
        case "chart": openChart(); return;
        case "leave": casinoHook("onLeave"); return;
        case "casinoAgain": casinoHook("onAgain"); return;
      }
      if (spec.click && spec.click(api, act, d)) return;
      if (!S) return;
      switch (act) {
        case "check": case "call": case "fold": case "pass": case "noLoan": case "allIn": humanAct({ type: act }); break;
        case "bet": case "raise": humanAct({ type: act, amount: S.amount }); break;
        case "borrow": humanAct({ type: "borrow", amount: Number(d.amount) }); break;
        case "amt": {
          const v = R().view(S.game, S.human), o = v.legal.find(x => x.type === "bet" || x.type === "raise");
          if (!o) return;
          S.amount = d.set === "max" ? o.max : Math.max(o.min, Math.min(o.max, (S.amount || o.min) + Number(d.d || 0)));
          render();
          break;
        }
      }
    }
    function bind() {
      if (bound || !doc()) return;
      const scr = $("scr-" + K);
      if (!scr) return;
      scr.addEventListener("click", onClick);
      scr.addEventListener("pointerover", onTipOver);
      scr.addEventListener("pointerout", onTipOut);
      scr.addEventListener("touchstart", onTipTouch, { passive: true });
      scr.addEventListener("touchmove", onTipMove, { passive: true });
      scr.addEventListener("touchend", onTipEnd);
      scr.addEventListener("touchcancel", endPress);
      scr.addEventListener("contextmenu", onTipMenu);
      scr.addEventListener("scroll", placeTip, { passive: true });
      if (root.addEventListener) root.addEventListener("resize", placeTip);
      bound = true;
    }
    function boot() {
      bind();
      const scr = $("scr-" + K), sc = screens();
      if (sc && scr) sc.register(spec.screen, scr, { onHide: leave });
      const entry = $("t-" + K);
      if (entry) {
        entry.onclick = () => open();
        // 菜单上的名字读配置（以后改名只改配置那一处）
        const b = entry.querySelector("b");
        if (b && spec.name) b.textContent = spec.name();
      }
    }

    /* ---------- 结算前的过渡：桌面上要的几样（各玩法的 boardHtml 用） ---------- */
    /** 正在「判定中」 */
    const judging = () => !!(S && S.settle && S.settle.phase === "judge");
    /** 刚走的最后一步标在这一方的座位上（同 High Flux：「跟注 2 枚」「过牌」「弃牌」……） */
    const actedTag = (side) => { const a = S && S.settle && S.settle.acted; return a && a.side === side ? `<small class="cc-acted">${esc(a.label)}</small>` : ""; };
    /** 弹横幅的这一下，这一方的筹码堆「收进来」 */
    const collecting = (side) => !!(S && S.anim.collect && S.anim.collect.indexOf(side) >= 0);

    const api = {
      spec, UI_CONFIG, btn, esc, signed, bump, loanTag, logHtml, chartBtn, bannerChartBtn, windowLeft, handCard, weatherColor, miniWeather,
      judging, actedTag, collecting, judgeTag: (cls) => CS().tag(cls),
      open, start, render, renderSetup, toTitle, act: humanAct, dismiss, setFast,
      openChart, closeChart, chartOpen, showTip, hideTip,
      // stop：停掉 AI 等着走的那一步和追加窗口的倒计时（测试用）
      stop: () => { stopTimer(); if (S && S.win && S.win.timer) { clearTimeout(S.win.timer); S.win.timer = null; } },
      state: () => S, view: () => (S ? R().view(S.game, S.human) : null),
      card: (c, o) => CUI().cardHtml(c, o), back: (o) => CUI().backHtml(o), weatherCard: (w, o) => CUI().weatherCardHtml(w, o), chips: (n, o) => CUI().chipsHtml(n, o),
      tipAttr: TIP
    };
    if (doc() && $("scr-" + K)) {
      if (doc().readyState === "loading") doc().addEventListener("DOMContentLoaded", boot);
      else boot();
    }
    return api;
  }

  /** 悬停预览的内容（两张牌桌一样）：这张元素牌、场上的天气，五种层各一格（图标、层名、得分；上色同克制表：正分红、负分蓝、0 灰）。
   *  c = CounterCards.cardChart 那样的 { name, weatherName, cells: [{ layer, name, value, kindId }] } */
  function tipHtml(card, c, head, foot) {
    const ui = CUI();
    if (!c || !ui) return "";
    const cells = c.cells.map(x => `<li class="cc-tip-cell ${x.kindId}" data-layer="${x.layer}" data-kind="${x.kindId}" style="--c:${ui.cardColor(x.layer)}">`
      + `<span class="cc-tip-ico">${ui.cardIcon(x.layer)}</span><i class="cc-tip-name">${esc(x.name)}</i><b>${signed(x.value)}</b></li>`).join("");
    return `<div class="cc-tip-head" style="--c:${ui.cardColor(card)}"><span class="cc-tip-ico">${ui.cardIcon(card)}</span><b>${esc(c.name)}</b><small>${esc(head)}</small></div>`
      + `<ol class="cc-tip-row">${cells}</ol><p class="cc-tip-foot">${esc(foot)}</p>`;
  }

  root.FluxUI = { UI_CONFIG, table, tipHtml, esc, signed, weatherColor, miniWeather };
})(typeof window !== "undefined" ? window : globalThis);
