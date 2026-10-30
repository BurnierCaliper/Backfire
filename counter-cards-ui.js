/* High Flux（#485）· 界面：标题 → 本地玩法 → High Flux → 选边、难度 → 牌桌
 * 游戏名读 CounterCards.CC_CONFIG.name（设置页标题、牌桌标题、规则说明）；标题「本地玩法」的按钮写在 game.html 里。
 *
 * 规则在 counter-cards.js，AI 在 counter-cards-ai.js；画面只拿 CounterCards.view(对局, 人这一方)，人和 AI 看到的是同一份东西。
 * 牌桌：深色赌桌；元素牌 / 层牌用游戏里的图标和配色（icons.js、game.css 的 --fire / --flesh……）；筹码堆、发牌动画；
 *       天气堆放在桌边，翻开天气时有闪光和对应的天气特效（weather-fx.js，和战场同一套）。
 * 暗出的牌一律显示牌背（自己的那张在角上标一下是什么）；结算只显示胜负、分档和筹码变动，不亮牌。
 * 筹码不够时（每轮开始 / 轮到自己下注）操作栏里有「借 3 枚（还 4）」这样的按钮；借了多少、要还多少写在两边的座位上；
 * 总结算按最终筹码数（扣还借款之后）定胜负。
 * 克制表：牌局中随时能开（作者 10/29 在 PR #486 的评论）——和平时一样，顶栏最前面的「菜单」（Esc 也行）→「克制表」；
 *   侧栏、结算横幅上也有直接打开的按钮。用平时的克制表浮层（matchup-ui.js），格子是按场上天气算好的得分（counter-cards.js · chart）；
 *   只读，不碰对局和操作栏的状态（出牌、下注、选着的暗弃 / 常态、下注额），AI 照常走；场上天气变了表跟着变。
 * 悬停预览（作者 10/29 在 PR #486 的评论）：人当玩家时，鼠标停在手里的元素牌上（手机上长按）弹出一个小预览，写这张牌按场上天气
 *   打五种层各得几分（counter-cards.js · cardChart，就是克制表里这张牌的一行）；天气变了跟着变；只写这张牌自己的数，不碰庄家出的牌；
 *   预览不接鼠标、摆在手牌上面，不挡出牌；长按松手不算点击（不会把牌出掉）。
 * 页面骨架在 game.html 的 #scr-cc；没有 Screens（测试里）时自己切 hidden。
 *
 *   CounterCardsUI.open()                                打开设置页
 *   CounterCardsUI.start({ side: "player", level: "hard", seed, fast })   直接开一局（fast：AI 不等，测试用）
 */
(function (root) {
  "use strict";

  const UI_CONFIG = {
    aiDelay: 650,          // AI 每一步之间停多久（毫秒）
    dealMs: 1500,          // 开局发牌动画放完之前 AI 不动（不然整块重画会把动画打断）
    maxDiscs: 12,          // 筹码堆最多画几枚
    chipsPerDisc: 5,       // 每枚圆片代表几枚筹码
    logLines: 14,          // 侧栏记录显示最近几条
    logStick: 24,          // 侧栏记录离底部不到这么多像素算「在底部」：有新记录时接着贴底；往上翻得更多就停在原处（像素）
    // 克制表（得分）：入口按钮、暂停菜单那一项的说明
    chart: {
      label: "克制表",
      sub: "按场上天气的得分 +1 / 0 / −1",
      hint: "元素牌 × 层牌，按场上天气算好的得分（+1 / 0 / −1），随时能看，不影响出牌和下注"
    },
    // 悬停预览（手里的元素牌）：电脑上鼠标停上去、手机上长按弹出，写这张牌按场上天气打五种层各得几分
    tip: {
      pressMs: 450,        // 手机上按住多久算长按（毫秒）
      slop: 10,            // 按着时手指挪动超过这么多像素算在滑动页面，不算长按
      swallowMs: 600,      // 长按松手后这么久之内，浏览器要是还补一下点击，不算出牌
      gap: 12,             // 预览底边离手牌多少像素（鼠标停着时能出的牌会往上抬 8px）
      margin: 8,           // 离屏幕边至少多少像素
      head: "打五种层",
      foot: "正分你赢 · 负分庄家赢 · 0 平局"
    }
  };
  const CC = () => root.CounterCards;
  const AI = () => root.CounterCardsAI;
  // screens.js 的 Screens 是顶层 const，不挂在 window 上
  const screens = () => (typeof Screens !== "undefined" ? Screens : root.Screens || null);
  const doc = () => root.document;
  const $ = (id) => doc().getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[ch]);
  const signed = (n) => (n > 0 ? "+" + n : String(n));

  /* ---------- 牌面 ---------- */
  // 层牌图标：和 icons.js 同样的贴纸画法（底下一层粗描边，上面一层层的颜色）
  const LAYER_GLYPH = {
    flesh: `<path d="M24 41 C14 34 6 27 6 18 A9 9 0 0 1 24 13 A9 9 0 0 1 42 18 C42 27 34 34 24 41 Z"/><path class="thin" d="M15 19 C17 16 20 16 22 18"/>`,
    armor: `<path d="M10 9 H38 L41 22 C41 32 33 39 24 43 C15 39 7 32 7 22 Z"/><path class="thin" d="M24 12 V39 M12 21 H36"/><circle class="solid" cx="14" cy="14" r="1.8"/><circle class="solid" cx="34" cy="14" r="1.8"/>`,
    shield: `<path d="M24 5 L40 14 V30 L24 43 L8 30 V14 Z"/><path class="thin" d="M24 13 L33 18 V28 L24 35 L15 28 V18 Z"/>`,
    sand: `<path d="M5 30 C12 20 20 20 27 27 C32 32 38 31 43 26"/><path class="thin" d="M5 39 C13 33 20 34 26 38 C32 42 38 40 43 36 M9 19 C14 15 19 15 23 18"/><circle class="solid" cx="34" cy="13" r="1.7"/><circle class="solid" cx="40" cy="18" r="1.3"/>`,
    spirit: `<path d="M24 5 C33 12 38 20 34 29 C31 36 26 37 24 43 C22 37 17 36 14 29 C10 20 15 12 24 5 Z"/><circle class="solid" cx="20" cy="22" r="2"/><circle class="solid" cx="28" cy="22" r="2"/>`
  };
  const NORMAL_GLYPH = `<circle cx="24" cy="24" r="15"/><path class="thin" d="M14 24 H34"/><path class="thin" d="M24 4 V9 M24 39 V44 M4 24 H9 M39 24 H44"/>`;
  const glyphSvg = (g, label) => `<svg class="eicon" viewBox="0 0 48 48" role="img" aria-label="${esc(label)}"><g class="o">${g}</g><g class="c">${g}</g></svg>`;
  const LAYER_VAR = { flesh: "--flesh", armor: "--armor", shield: "--shield", sand: "--sand", spirit: "--spirit" };
  const ELEMENT_VAR = { fire: "--fire", acid: "--acid", electric: "--electric", ice: "--icee", energy: "--energy", physical: "--physical", harmonic: "--harmonic" };
  function kindOf(card) {
    const C = CC().CC_CONFIG;
    return C.layers.indexOf(card) >= 0 ? "ly" : card === C.normal ? "nm" : "el";
  }
  function cardColor(card) {
    const k = kindOf(card);
    if (k === "ly") return `var(${LAYER_VAR[card]})`;
    if (k === "el") return `var(${ELEMENT_VAR[card]})`;
    return "#d9cdb3";
  }
  function cardIcon(card) {
    const k = kindOf(card), name = CC().cardName(card);
    if (k === "ly") return glyphSvg(LAYER_GLYPH[card], name);
    if (k === "el") return root.Icons ? root.Icons.element(card) : "";
    return glyphSvg(NORMAL_GLYPH, name);
  }
  /** 一张正面朝上的牌。o.act：点了做什么（data-cc），o.cls：额外的类，o.note：牌底的小字，o.disabled，o.delay：发牌动画的先后，
   *  o.tip：能看悬停预览（手里的元素牌，data-cc-tip；不写 title，免得浏览器自己的小字提示和预览叠在一起） */
  function cardHtml(card, o) {
    o = o || {};
    const name = CC().cardName(card), k = kindOf(card);
    const tag = o.act ? "button" : "span";
    const attrs = (o.act ? ` type="button" data-cc="${o.act}" data-card="${card}"${o.disabled ? " disabled" : ""}` : "")
      + (o.tip ? ` data-cc-tip="${card}"` : ` title="${esc(o.title || name)}"`);
    const style = `--c:${cardColor(card)}${o.delay != null ? `;--d:${o.delay}` : ""}`;
    return `<${tag} class="cc-card cc-${k}${o.cls ? " " + o.cls : ""}" style="${style}" data-face="${card}"${attrs}>`
      + `<i class="cc-corner">${esc(name)}</i><span class="cc-ico">${cardIcon(card)}</span><b class="cc-name">${esc(name)}</b>`
      + `${o.note ? `<small class="cc-note">${esc(o.note)}</small>` : ""}</${tag}>`;
  }
  // 牌背的花纹：黄铜菱形套菱形、正中一颗铆钉。不写字——手牌叠在一起时每张只露出左边一截，字会被遮成别的字（以前的「AB」露出来像「AI」）
  const BACK_EMBLEM = `<svg class="cc-emblem" viewBox="0 0 40 56" aria-hidden="true">`
    + `<path class="o" d="M20 3 L37 28 L20 53 L3 28 Z M20 15 L28.5 28 L20 41 L11.5 28 Z"/>`
    + `<path class="in" d="M20 15 L28.5 28 L20 41 L11.5 28 Z"/><path d="M20 3 L37 28 L20 53 L3 28 Z M20 15 L28.5 28 L20 41 L11.5 28 Z"/>`
    + `<circle class="dot" cx="20" cy="28" r="3.2"/></svg>`;
  /** 牌背（暗出的牌、对方的手牌）。mine：自己暗出的那张，角上标一下是什么 */
  function backHtml(o) {
    o = o || {};
    const peek = o.mine ? `<span class="cc-peek" style="--c:${cardColor(o.mine)}" title="你暗出的：${esc(CC().cardName(o.mine))}">${cardIcon(o.mine)}<b>${esc(CC().cardName(o.mine))}</b></span>` : "";
    return `<span class="cc-card cc-back${o.cls ? " " + o.cls : ""}"${o.delay != null ? ` style="--d:${o.delay}"` : ""} aria-label="${o.mine ? "你暗出的牌（牌背朝上）" : "牌背"}"><span class="cc-crest">${BACK_EMBLEM}</span>${peek}</span>`;
  }
  /** 天气这张牌的修正（规则文字）：火 +1 / 冰 −1……，微光、酸雨、相位的附加说明 */
  function weatherMods(w) {
    const C = CC().CC_CONFIG, out = [];
    C.elements.forEach(el => {
      const n = CC().weatherScore(el, "flesh", w);
      if (n) out.push(`${CC().cardName(el)} ${signed(n)}`);
    });
    if (w === "glow") out.push("能量以外克制反转");
    if (w === "acid") out.push("酸、冰以外打装甲 +1");
    if (w === C.allInWeather) out.push("翻到时双方全押");
    return out;
  }
  function weatherColor(w) { return (root.Icons && root.Icons.WEATHER && root.Icons.WEATHER[w] && root.Icons.WEATHER[w].c) || "#c9bfae"; }
  function weatherCardHtml(w, o) {
    o = o || {};
    if (!w) return `<span class="cc-card cc-wx cc-wx-none${o.cls ? " " + o.cls : ""}" title="没有天气"><i class="cc-corner">常态</i><span class="cc-ico">${glyphSvg(NORMAL_GLYPH, "常态")}</span><b class="cc-name">没有天气</b></span>`;
    const name = CC().weatherName(w);
    const mods = weatherMods(w);
    return `<span class="cc-card cc-wx${o.cls ? " " + o.cls : ""}" style="--c:${weatherColor(w)}" data-weather="${w}" title="${esc(name + "：" + (mods.join("，") || "没有修正"))}">`
      + `<i class="cc-corner">${esc(name)}</i><span class="cc-ico">${root.Icons ? root.Icons.weather(w) : ""}</span><b class="cc-name">${esc(name)}</b>`
      + `<small class="cc-mods">${mods.map(esc).join("<br>") || "没有修正"}</small></span>`;
  }
  /** 筹码堆：n = null 是无限（赌场的庄家）。o.anim：数目变了，筹码落下来的动画放一次 */
  function chipsHtml(n, o) {
    o = o || {};
    const discs = n == null ? UI_CONFIG.maxDiscs : Math.max(0, Math.min(UI_CONFIG.maxDiscs, Math.ceil(n / UI_CONFIG.chipsPerDisc)));
    const stack = Array.from({ length: discs }, (_, i) => `<i style="--i:${i}"></i>`).join("");
    const cls = (o.cls ? " " + o.cls : "") + (o.anim ? " cc-anim" : "");
    return `<span class="cc-chips${cls}" title="${esc(o.title || "筹码")}"><span class="cc-stack">${stack}</span><b>${n == null ? "∞" : n}</b>${o.label ? `<small>${esc(o.label)}</small>` : ""}</span>`;
  }

  /* ---------- 状态 ---------- */
  const SETUP = { side: "player", level: "normal" };
  let S = null;           // 当前这一局：{ game, human, ai, level, rng, seen, banner, mode, amount, anim, fast, timer, revealKey, msg, chartWeather（克制表上次按哪个天气画的），
                          //   tip（开着的悬停预览）、tipSwallow（长按松手后不算的那一下点击） }
  let bound = false;

  function show(name) {
    const setup = $("cc-setup"), game = $("cc-game");
    if (setup) setup.hidden = name !== "setup";
    if (game) game.hidden = name !== "game";
  }
  function enterScreen() {
    const sc = screens();
    if (sc && sc.current) {
      if (sc.current() === "counter") return;
      try { sc.show("counter"); return; } catch (e) { /* 没注册上：自己切 */ }
    }
    const scr = $("scr-cc");
    if (scr) scr.hidden = false;
    const title = $("scr-title");
    if (title) title.hidden = true;
    doc().body.dataset.screen = "counter";   // 和 Screens.show 一样记在 <body data-screen>（暂停菜单看它）
  }
  function open() {
    bind();
    stopTimer();
    closeChart();
    stopTip();
    enterScreen();
    renderSetup();
    show("setup");
  }
  function start(opt) {
    opt = opt || {};
    bind();
    stopTimer();
    stopTip();
    const side = opt.side === "dealer" ? "dealer" : "player";
    const level = AI().LEVELS.indexOf(opt.level) >= 0 ? opt.level : "normal";
    const seed = String(opt.seed || ("cc" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)));
    const game = opt.game || CC().newGame(Object.assign({ seed }, opt.gameOpt || {}));
    S = { game, human: side, ai: CC().other(side), level, rng: CC().makeRng(seed + "|ai"), seen: game.results.length, banner: null, mode: null, amount: null,
      anim: { deal: true }, fast: !!opt.fast, timer: null, revealKey: "", msg: "", last: {}, holdUntil: opt.fast ? 0 : Date.now() + UI_CONFIG.dealMs };
    SETUP.side = side; SETUP.level = level;
    enterScreen();
    show("game");
    render();
    schedule();
    return S.game;
  }
  function stopTimer() { if (S && S.timer) { clearTimeout(S.timer); S.timer = null; } }
  function leave() {
    stopTimer();
    closeChart();
    stopTip();
    if (root.WeatherFx && $("cc-fx")) root.WeatherFx.sync({ field: $("cc-fx"), weather: "none" });
  }
  function toTitle() {
    leave();
    const sc = screens();
    if (sc) { sc.show("title"); return; }
    const scr = $("scr-cc"), title = $("scr-title");
    if (scr) scr.hidden = true;
    if (title) title.hidden = false;
    doc().body.dataset.screen = "title";
  }

  /* ---------- 克制表（得分）：和平时同一个浮层（matchup-ui.js），只读 ---------- */
  const MU = () => root.MatchupUI || null;
  const PM = () => root.PauseMenu || null;
  const screenNow = () => (doc() && doc().body ? doc().body.dataset.screen : "");
  /** 牌桌开着（不是设置页） */
  function gameShown() { const g = $("cc-game"); return !!(S && g && !g.hidden && screenNow() === "counter"); }
  /** 场上的天气（公开的，从人这一方的 view 取；null = 没有天气） */
  function chartWeather() { return S ? CC().view(S.game, S.human).weather || null : null; }
  /** 开着的克制表是不是牌桌上的这一张（挂在 #scr-cc 里） */
  function chartOpen() {
    const m = MU(), box = $("mu-overlay"), scr = $("scr-cc");
    return !!(m && m.isOpen() && box && scr && scr.contains(box));
  }
  /** 打开：挂在牌桌 #cc-game 下（天气写在那里，卡片套上天气底纹）；每次重画按当时场上的天气算。键盘焦点给「关闭」，Esc 就能关。
   *  只开浮层，对局、操作栏的状态（选着的暗弃 / 常态、下注额）都不动 */
  function openChart() {
    const m = MU();
    if (!m || !S) return false;
    stopTip();   // 克制表盖住整个牌桌：开着的悬停预览收起
    S.chartWeather = chartWeather();
    m.open(() => CC().chart(chartWeather()), { mount: $("cc-game") });
    const close = $("mu-overlay") && $("mu-overlay").querySelector("[data-mu-close]");
    if (close && typeof close.focus === "function") close.focus();
    return true;
  }
  function closeChart() { if (chartOpen()) MU().close(); }
  /** 入口按钮（侧栏）：写上现在场上的天气 */
  function chartBtn(v) {
    const T = UI_CONFIG.chart;
    return `<button type="button" class="cc-btn cc-chartbtn" data-cc="chart" aria-haspopup="dialog" title="${esc(T.hint)}"><b>${esc(T.label)}</b><small>天气 ${esc(CC().weatherName(v.weather))} · ${esc(T.sub)}</small></button>`;
  }
  /** 顶栏最前面的「菜单」：和战斗、单局的顶栏同一个按钮（pause-menu.js 认 data-pause-open）；顶栏每次整块重画，按钮跟着画 */
  function menuBtn() {
    const P = PM();
    if (!P) return "";
    const T = P.CONFIG.text;
    return `<button type="button" class="cc-btn pm-open" data-pause-open="1" title="${esc(T.openTitle)}">${esc(T.open)}</button>`;
  }
  // 暂停菜单里的「克制表」（名字、先后同平时那一项）：牌局中才有；设置页上 Esc 不开菜单
  if (PM()) {
    PM().register({ id: "matchupCC", config: "matchup", hint: UI_CONFIG.chart.hint, visible: () => !!MU() && gameShown(), run: openChart });
    PM().addBlocker(() => screenNow() === "counter" && !gameShown());
  }

  /* ---------- 悬停预览：手里的元素牌（作者 10/29 在 PR #486 的评论）——电脑上鼠标停上去、手机上长按 ---------- */
  // 写这张牌按场上天气打五种层各得几分（counter-cards.js · cardChart：克制表里这张牌的一行，和计分同一份数）；只用这张牌和场上的天气，不碰庄家出的牌。
  // 预览是牌桌上的一个浮框（game.html 的 #cc-tip）：不接鼠标、摆在手牌上面，不挡出牌；整块重画后按牌面找回这张牌重新摆，天气变了跟着重写。
  // S.tip = { card, via }：hover = 鼠标停着（移开就收起）；press = 长按弹出（松手留着看，手指再碰一下就收起）
  const scoreText = (n) => (n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0");
  /** 预览的内容：这张牌、场上的天气，五种层各一格（图标、层名、得分；上色同克制表：正分红、负分蓝、0 灰） */
  function tipHtml(card, weather) {
    const c = CC().cardChart(card, weather), T = UI_CONFIG.tip;
    if (!c) return "";
    const cells = c.cells.map(x => `<li class="cc-tip-cell ${x.kindId}" data-layer="${x.layer}" data-kind="${x.kindId}" style="--c:${cardColor(x.layer)}">`
      + `<span class="cc-tip-ico">${cardIcon(x.layer)}</span><i class="cc-tip-name">${esc(x.name)}</i><b>${scoreText(x.value)}</b></li>`).join("");
    return `<div class="cc-tip-head" style="--c:${cardColor(card)}"><span class="cc-tip-ico">${cardIcon(card)}</span><b>${esc(c.name)}</b><small>${esc(T.head)} · 天气 ${esc(c.weatherName)}</small></div>`
      + `<ol class="cc-tip-row">${cells}</ol><p class="cc-tip-foot">${esc(T.foot)}</p>`;
  }
  const tipBox = () => $("cc-tip");
  /** t 在不在一张能看预览的牌里（人当玩家时手里的元素牌，带 data-cc-tip） */
  const tipCard = (t) => (t && t.closest ? t.closest("[data-cc-tip]") : null);
  const tipAnchor = (card) => { const b = $("cc-board"); return b ? b.querySelector(`.cc-me [data-cc-tip="${card}"]`) : null; };
  /** 打开 / 重画预览：按现在场上的天气写，摆到这张牌上面。牌不在手里了（出掉、弃掉）、结算横幅或克制表盖着、不在牌桌上就收起 */
  function showTip(card, via) {
    const box = tipBox(), el = tipAnchor(card);
    if (!S || !box || !el || S.banner || S.game.over || !gameShown() || chartOpen()) { hideTip(); return; }
    const w = chartWeather();
    S.tip = { card, via };
    box.innerHTML = tipHtml(card, w);
    box.dataset.card = card;
    box.dataset.weather = w || "none";
    box.hidden = false;
    const was = $("cc-board").querySelector('[aria-describedby="cc-tip"]');
    if (was && was !== el) was.removeAttribute("aria-describedby");
    el.setAttribute("aria-describedby", "cc-tip");
    placeTip();
  }
  function hideTip() {
    if (S) S.tip = null;
    const box = tipBox(), b = $("cc-board"), was = b && b.querySelector('[aria-describedby="cc-tip"]');
    if (box && !box.hidden) box.hidden = true;
    if (was) was.removeAttribute("aria-describedby");
  }
  /** 摆在手牌上面（不盖住手牌、操作栏），横向对着这张牌、不出屏幕；上面放不下才放到手牌下面 */
  function placeTip() {
    const box = tipBox(), el = S && S.tip ? tipAnchor(S.tip.card) : null;
    if (!box || box.hidden || !el) return;
    const T = UI_CONFIG.tip, r = el.getBoundingClientRect(), hand = el.parentNode.getBoundingClientRect();
    const w = box.offsetWidth, h = box.offsetHeight;
    const left = Math.max(T.margin, Math.min((root.innerWidth || 0) - w - T.margin, r.left + r.width / 2 - w / 2));
    let top = Math.min(r.top, hand.top) - h - T.gap;
    if (top < T.margin) top = Math.max(r.bottom, hand.bottom) + T.gap;
    box.style.left = Math.round(left) + "px";
    box.style.top = Math.round(top) + "px";
  }
  // 电脑：鼠标（笔）停到手里的元素牌上弹出，移开收起。手指碰到时浏览器发的 pointerover（pointerType = touch）不算，手机走下面的长按。
  // 长按弹出的预览，换成用鼠标（触屏电脑）挪到别处也收起
  function onTipOver(e) {
    if (!S || e.pointerType === "touch") return;
    const card = tipCard(e.target);
    if (card) { if (!S.tip || S.tip.card !== card.dataset.ccTip || S.tip.via !== "hover") showTip(card.dataset.ccTip, "hover"); }
    else if (S.tip) hideTip();
  }
  function onTipOut(e) {
    if (!S || !S.tip || S.tip.via !== "hover" || e.pointerType === "touch") return;
    const card = tipCard(e.target);
    if (!card || (e.relatedTarget && card.contains(e.relatedTarget))) return;   // 还在这张牌里（牌上的图标、字）
    hideTip();
  }
  // 手机：按住手里的元素牌 pressMs 弹出（手指挪动超过 slop 算在滑动页面，不弹）；松手不算点击（不会把牌出掉），预览留着，手指再碰一下就收起
  let press = null;   // 手指按着：{ card, x, y, timer, fired }
  function endPress() { if (press && press.timer) clearTimeout(press.timer); press = null; }
  function onTipTouch(e) {
    endPress();
    if (!S) return;
    S.tipSwallow = null;
    if (S.tip) hideTip();
    const card = tipCard(e.target), t = e.touches && e.touches[0];
    if (!card || !t || e.touches.length > 1) return;
    const p = press = { card: card.dataset.ccTip, x: t.clientX, y: t.clientY, fired: false, timer: null };
    p.timer = setTimeout(() => { p.timer = null; if (press !== p) return; p.fired = true; showTip(p.card, "press"); }, UI_CONFIG.tip.pressMs);
  }
  function onTipMove(e) {
    const t = e.touches && e.touches[0];
    if (press && !press.fired && (!t || Math.hypot(t.clientX - press.x, t.clientY - press.y) > UI_CONFIG.tip.slop)) endPress();
  }
  function onTipEnd(e) {
    if (press && press.fired) {
      if (e.cancelable) e.preventDefault();   // 长按松手：浏览器就不会再补一下点击，牌不会被出掉
      if (S) S.tipSwallow = { card: press.card, until: Date.now() + UI_CONFIG.tip.swallowMs };   // 万一还是补了，也不算（onClick 里拦）
    }
    endPress();
  }
  /** 长按时系统的菜单（Android 的长按菜单）：能看预览的牌上不弹 */
  function onTipMenu(e) { if (tipCard(e.target)) e.preventDefault(); }
  /** 收起预览，按着没到时间的长按也不算了（离开牌桌、换一局、开克制表） */
  function stopTip() { endPress(); hideTip(); }

  /* ---------- 推进：人做一步 → 看有没有新的结算 / 新翻的天气 → AI 接着走 ---------- */
  function humanAct(a) {
    if (!S || S.game.over) return;
    try { CC().act(S.game, S.human, a); } catch (e) { S.msg = e.message; render(); return; }
    S.mode = null; S.amount = null; S.msg = "";
    afterChange();
  }
  function afterChange() {
    const g = S.game;
    if (g.results.length > S.seen) { S.seen = g.results.length; S.banner = g.results[g.results.length - 1]; }
    const key = g.revealed ? g.round + ":" + g.revealed : "";
    if (key && key !== S.revealKey) { S.revealKey = key; S.anim.reveal = g.revealed; }
    render();
    schedule();
  }
  function schedule() {
    stopTimer();
    if (!S || S.banner || S.game.over) return;
    if (CC().toAct(S.game).indexOf(S.ai) < 0) return;
    if (S.fast) { aiStep(); return; }
    S.timer = setTimeout(aiStep, Math.max(UI_CONFIG.aiDelay, (S.holdUntil || 0) - Date.now()));
  }
  function aiStep() {
    if (!S) return;
    S.timer = null;
    if (S.banner || S.game.over) return;
    if (!AI().step(S.game, S.ai, S.level, S.rng)) { render(); return; }   // 没走成（不该发生）：别一直重排
    afterChange();
  }
  /** fast：AI 不等、马上走（测试 / 真浏览器测试用）；打开时把正在等的那一步也马上走掉 */
  function setFast(on) {
    if (!S) return;
    S.fast = !!on;
    schedule();
  }

  /* ---------- 画面 ---------- */
  const sideName = (s) => CC().sideName(s);
  function renderSetup() {
    const box = $("cc-setup");
    if (!box) return;
    const C = CC().CC_CONFIG;
    const opt = (key, val, label, sub) => `<button type="button" class="cc-opt${SETUP[key] === val ? " on" : ""}" data-cc="set" data-key="${key}" data-val="${val}" aria-pressed="${SETUP[key] === val}"><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</button>`;
    box.innerHTML = `<div class="cc-setup-card">
      <h2 class="cc-title">${esc(C.name)}</h2>
      <p class="cc-tagline">回火赌桌 · ${C.rounds} 轮暗牌，克制表定输赢</p>
      <div class="cc-pick"><span class="cc-pick-label">扮演</span>
        ${opt("side", "player", "玩家", `${C.elements.length} 张元素牌 + 常态，翻天气`)}
        ${opt("side", "dealer", "庄家", `${C.layers.length} 张层牌，管天气堆`)}
      </div>
      <div class="cc-pick"><span class="cc-pick-label">对手 AI</span>
        ${opt("level", "easy", "简单", "随手出牌")}${opt("level", "normal", "普通", "只看单轮结果")}${opt("level", "hard", "困难", "记整局、会诈唬")}
      </div>
      <p class="cc-hint">开局双方各 ${C.startChips} 枚筹码，另一方由 AI 操作。筹码不够时可以向主持方借（每借 ${C.loan.unit} 枚，结束时还 ${C.loan.repay} 枚）；最后按扣还后的筹码数定胜负。</p>
      ${rulesHtml()}
      <div class="cc-go"><button type="button" class="cc-btn" data-cc="title">回到标题</button><button type="button" class="cc-btn primary" data-cc="start">开局</button></div>
    </div>`;
  }
  function rulesHtml() {
    const C = CC().CC_CONFIG;
    return `<details class="cc-rules"><summary>${esc(C.name)} 规则</summary><ul>
      <li><b>牌</b>：庄家 ${C.layers.length} 张层牌（${C.layers.map(CC().cardName).join("、")}），每轮必须打出一张；玩家 ${C.elements.length} 张元素牌（${C.elements.map(CC().cardName).join("、")}）+ 1 张常态（每局一次）；天气堆 ${C.weathers.length} 张（${C.weathers.map(CC().weatherName).join("、")}），开局洗混，抽完就没了，新翻的天气顶替旧天气。</li>
      <li><b>计分</b>：按游戏里的克制表，克制 +1、劣势 −1、其余 0；天气修正每 25% 记 ±1（微光里能量以外的克制反转；酸雨里酸、冰以外的元素打装甲另 +1）。总分为正玩家赢，为负庄家赢，0 平局。</li>
      <li><b>每轮</b>：（筹码不够的一方先决定借不借，见「借贷」）① 双方各下 ${C.ante} 枚底注 ② 庄家天气行动：弃掉场上的天气，或者场上没天气时偷看堆顶一张、放回原位或牌堆底（玩家看得到做了哪种）③ 双方暗出一张牌 ④ 第一轮下注，玩家先 ⑤ 玩家翻开一张新天气，或暗弃任意一张手牌跳过（弃的牌不公开）；之后还可以用常态清掉天气，代价是暗弃一张元素牌，常态不能覆盖相位 ⑥ 第二轮下注，庄家先 ⑦ 不亮牌，系统直接判胜负结算。</li>
      <li><b>下注</b>：每轮最低下注额 = 轮数，每个下注回合最多加注 ${C.maxRaises} 次；没人下注时可以过牌；弃牌立即判负，输掉自己已下的筹码（包括自己在滚存底池里的那一份）。平局底池滚存到下一轮，第 ${C.rounds} 轮打平各自拿回。</li>
      <li><b>分档赔付</b>：差 1 赢家拿走底池；差 2 赢家拿走底池，输家再赔自己这一轮下注额的 0.5 倍（半枚向下取整）。</li>
      <li><b>相位</b>：翻到相位，本轮双方全押，上限是筹码较少一方的全部筹码；打平各自退回。</li>
      <li><b>借贷</b>：筹码不够时可以向主持方借——每轮开始时手上不够「底注 + 本轮最低下注额」，或者轮到自己下注时不够「要跟的 + 本轮最低下注额」。${C.loan.unit} 枚一份，最少借 ${C.loan.unit} 枚，最多借到补上缺口；每借 ${C.loan.unit} 枚，对局结束时还 ${C.loan.repay} 枚（${C.loan.unit}→${C.loan.repay}、${C.loan.unit * 2}→${C.loan.repay * 2}），结算时从筹码里扣，还不上的记成负数。输光了不借，这一局就结束。</li>
      <li><b>胜负</b>：${C.rounds} 轮打完（或有一方输光又不借）后，按最终筹码数（扣还借款之后）比，多的赢。</li>
    </ul></details>`;
  }
  function render() {
    if (!S) return;
    const v = CC().view(S.game, S.human);
    const app = $("cc-game");
    if (!app) return;
    app.dataset.weather = v.weather || "none";
    app.dataset.side = S.human;
    const top = $("cc-top"), board = $("cc-board"), actions = $("cc-actions"), side = $("cc-side"), banner = $("cc-banner");
    if (top) top.innerHTML = topHtml(v);
    if (board) board.innerHTML = boardHtml(v);
    if (actions) actions.innerHTML = actionsHtml(v);
    if (side) { const was = logScroll(side); side.innerHTML = sideHtml(v); stickLog(side, was); }
    if (banner) {
      const h = S.banner ? bannerHtml(S.banner, v) : v.over ? finalHtml(v) : "";
      banner.innerHTML = h;
      banner.hidden = !h;
    }
    if (root.WeatherFx && $("cc-fx")) root.WeatherFx.sync({ field: $("cc-fx"), weather: v.weather || "none" });
    // 克制表开着：场上的天气变了才重画（AI 照常走，别的变化不动它，免得点开的格子、键盘焦点被打断）
    if (chartOpen() && S.chartWeather !== (v.weather || null)) { S.chartWeather = v.weather || null; MU().refresh(); }
    // 悬停预览开着：手牌整块重画了，按牌面找回这张牌，按现在场上的天气重写、重新摆（牌出掉了、结算横幅盖上来就收起）
    if (S.tip) showTip(S.tip.card, S.tip.via);
    S.anim = {};
  }
  function topHtml(v) {
    const status = v.over ? "对局结束" : `第 ${v.round} / ${v.rounds} 轮`;
    return `${menuBtn()}<b class="cc-brand">${esc(CC().CC_CONFIG.name)}</b><span class="cc-round">${status}</span>`
      + `<span class="cc-role">你是<b>${sideName(S.human)}</b> · 对手：${esc(AI().LEVEL_NAMES[S.level])} AI</span>`
      + `<span class="cc-spacer"></span><button type="button" class="cc-btn" data-cc="setup">换边 / 难度</button><button type="button" class="cc-btn" data-cc="title">回到标题</button>`;
  }
  function boardHtml(v) {
    const deal = !!S.anim.deal, me = v.me, opp = v.opp;
    // 整块重画时只给变了的东西放动画：筹码数变了才落一次，刚暗出的牌才飞上桌
    const bump = (k, val) => { const was = S.last[k]; S.last[k] = val; return was === undefined ? deal : was !== val; };
    const anim = { opp: bump("oppChips", opp.chips), me: bump("myChips", me.chips), pot: bump("pot", v.pot),
      oppThrow: bump("oppThrow", v.round + ":" + opp.played) && opp.played, myThrow: bump("myThrow", v.round + ":" + me.card) && !!me.card };
    const oppName = sideName(v.opponent);
    const oppHand = Array.from({ length: opp.handCount }, (_, i) => backHtml({ cls: deal ? "cc-deal" : "", delay: deal ? i : null })).join("");
    const myPlayable = playableSet(v);
    const myHand = me.hand.map((c, i) => {
      const can = myPlayable.has(c);
      const note = c === CC().CC_CONFIG.normal ? "每局一次" : "";
      return cardHtml(c, { act: can ? actName(v) : null, cls: (deal ? "cc-deal " : "") + (can ? "cc-can" : ""), delay: deal ? i + opp.handCount : null, note,
        tip: S.human === "player" && kindOf(c) === "el",   // 玩家手里的元素牌：悬停 / 长按看得分预览
        title: c === CC().CC_CONFIG.normal ? "常态：不能当出牌；翻天气那一步可以用来清除天气（再暗弃一张元素牌），也可以拿去暗弃跳过" : null });
    }).join("");
    const deck = Array.from({ length: Math.min(v.deckCount, 7) }, (_, i) => `<i style="--i:${i}"></i>`).join("");
    const reveal = S.anim.reveal;
    const potShare = me.pot + opp.pot;
    const flash = reveal ? `<div class="cc-flash" style="--c:${weatherColor(reveal)}" aria-hidden="true"></div>` : "";
    const peek = v.peek && v.peek.card && v.stage === "dealerPeek" ? `<div class="cc-peekcard"><small>只有你看得到</small>${weatherCardHtml(v.peek.card)}</div>` : "";
    const known = S.human === "dealer" && (v.deckTop || v.deckBottom)
      ? `<small class="cc-known">${v.deckTop ? `堆顶：${esc(CC().weatherName(v.deckTop))}` : ""}${v.deckTop && v.deckBottom ? " · " : ""}${v.deckBottom ? `堆底：${esc(CC().weatherName(v.deckBottom))}` : ""}</small>` : "";
    return `${flash}<div class="cc-seat cc-opp">
        <div class="cc-who"><b>${oppName}</b><small>${esc(AI().LEVEL_NAMES[S.level])} AI</small>${opp.discardCount ? `<small>暗弃 ${opp.discardCount} 张</small>` : ""}${loanTag(opp, oppName)}</div>
        <div class="cc-hand cc-hand-back">${oppHand}</div>
        ${chipsHtml(opp.chips, { title: oppName + "的筹码", label: opp.infinite ? "庄家筹码无限" : "", anim: anim.opp })}
      </div>
      <div class="cc-center">
        <div class="cc-wzone">
          <div class="cc-deck" title="天气堆还剩 ${v.deckCount} 张"><span class="cc-deckstack">${deck}</span><b>${v.deckCount}</b><small>天气堆</small>${known}</div>
          <div class="cc-wnow">${weatherCardHtml(v.weather, { cls: reveal ? "cc-flip" : "" })}<small>场上天气</small></div>
          ${v.gone.length ? `<div class="cc-gone" title="离场的天气">${v.gone.map(w => `<span class="cc-mini" style="--c:${weatherColor(w)}">${root.Icons ? root.Icons.weather(w) : ""}${esc(CC().weatherName(w))}</span>`).join("")}</div>` : ""}
          ${peek}
        </div>
        <div class="cc-pot${v.allIn ? " allin" : ""}">
          ${chipsHtml(v.pot, { cls: "cc-potstack", title: "底池", label: "底池", anim: anim.pot })}
          ${potShare ? `<small class="cc-roll">含滚存 ${potShare} 枚</small>` : ""}
          <span class="cc-bets"><span>${oppName}本轮 ${opp.bet}</span><span>你本轮 ${me.bet}</span></span>
        </div>
        <div class="cc-slots">
          <div class="cc-slot">${opp.played ? backHtml({ cls: "cc-down" + (anim.oppThrow ? " cc-thrown" : "") }) : `<span class="cc-empty">${oppName}还没出牌</span>`}</div>
          <div class="cc-slot">${me.card ? backHtml({ mine: me.card, cls: "cc-down" + (anim.myThrow ? " cc-thrown" : "") }) : `<span class="cc-empty">你还没出牌</span>`}</div>
        </div>
      </div>
      <div class="cc-seat cc-me">
        ${chipsHtml(me.chips, { title: "你的筹码", anim: anim.me })}
        <div class="cc-hand">${myHand || `<span class="cc-empty">手牌打完了</span>`}</div>
        <div class="cc-who"><b>你（${sideName(S.human)}）</b>${S.human === "player" && me.discards.length ? `<small>暗弃过：${me.discards.map(d => esc(CC().cardName(d.card))).join("、")}</small>` : ""}${loanTag(me, "你")}</div>
      </div>`;
  }
  /** 向主持方借了多少、结束时要还多少（公开的） */
  function loanTag(s, who) {
    return s.loan ? `<small class="cc-loan" title="${esc(who)}向主持方借了 ${s.loan} 枚，对局结束时还 ${s.owe} 枚">借 ${s.loan} 枚 · 结束时还 ${s.owe} 枚</small>` : "";
  }
  /** 借贷按钮：一份一个（借 3 / 借 6 ……），写上结束时要还多少 */
  function loanBtns(o, primary) {
    let out = "";
    for (let n = o.min; n <= o.max; n += o.step) {
      const back = CC().repayOf(n);
      out += btn("borrow", `借 ${n} 枚（还 ${back}）`, { data: { amount: n }, cls: "cc-loanbtn", primary: primary && n === o.min, title: `向主持方借 ${n} 枚，对局结束时还 ${back} 枚` });
    }
    return out;
  }
  /** 现在点哪些手牌有用：出牌 / 暗弃 / 常态要弃的元素牌 */
  function playableSet(v) {
    const set = new Set();
    if (!v.myTurn) return set;
    v.legal.forEach(o => {
      if (o.type === "play" && v.stage === "play") set.add(o.card);
      if (o.type === "skip" && S.mode === "skip") set.add(o.card);
      if (o.type === "normal" && S.mode === "normal") set.add(o.card);
    });
    return set;
  }
  function actName(v) {
    if (v.stage === "play") return "play";
    if (S.mode === "skip") return "skip";
    if (S.mode === "normal") return "normal";
    return null;
  }
  function btn(act, label, o) {
    o = o || {};
    const data = Object.keys(o.data || {}).map(k => ` data-${k}="${esc(o.data[k])}"`).join("");
    return `<button type="button" class="cc-btn${o.primary ? " primary" : ""}${o.cls ? " " + o.cls : ""}" data-cc="${act}"${data}${o.disabled ? " disabled" : ""}${o.title ? ` title="${esc(o.title)}"` : ""}>${label}</button>`;
  }
  function actionsHtml(v) {
    const msg = S.msg ? `<p class="cc-msg" role="alert">${esc(S.msg)}</p>` : "";
    if (v.over) return `<p class="cc-prompt">对局结束。</p>${msg}`;
    if (S.banner) return `<p class="cc-prompt">看一下这一轮的结算。</p>${msg}`;
    const oppName = sideName(v.opponent);
    if (!v.myTurn) {
      const wait = v.stage === "play" && v.me.card ? `你已经暗出了牌，等${oppName}出牌……` : `${oppName}正在想……`;
      return `<p class="cc-prompt cc-wait">${wait}</p>${infoLine(v)}${msg}`;
    }
    const has = (t) => v.legal.find(o => o.type === t);
    let p = "", b = "";
    switch (v.stage) {
      case "loan": {
        const o = has("borrow"), broke = v.me.chips <= 0 && v.me.pot <= 0;
        p = `第 ${v.round} 轮开始前：你手上只有 ${v.me.chips} 枚筹码，不够这一轮的底注 ${v.ante} + 最低下注 ${v.minBet} 枚。`
          + `可以向主持方借：${v.loan.unit} 枚一份，每借 ${v.loan.unit} 枚，对局结束时还 ${v.loan.repay} 枚。`
          + (broke ? "你已经输光了，不借的话这一局就结束。" : "不借也能接着打。");
        b = (o ? loanBtns(o, broke) : "") + btn("noLoan", broke ? "不借（结束对局）" : "不借", { primary: !broke });
        break;
      }
      case "dealerWeather":
        if (v.weather) {
          p = `庄家天气行动：场上是〔${esc(CC().weatherName(v.weather))}〕，弃掉还是保留？`;
          b = btn("weather", "弃掉天气", { data: { op: "discard" } }) + btn("weather", "保留天气", { data: { op: "keep" }, primary: true });
        } else {
          p = "庄家天气行动：场上没有天气。可以偷看天气堆顶的一张（玩家看得到你放回原位还是放到牌堆底）。";
          b = btn("weather", "偷看堆顶", { data: { op: "peek" }, primary: true }) + btn("weather", "不动", { data: { op: "pass" } });
        }
        break;
      case "dealerPeek":
        p = `堆顶是〔${esc(CC().weatherName(v.peek && v.peek.card))}〕。放回原位，还是放到牌堆底？`;
        b = btn("place", "放回原位", { data: { where: "top" }, primary: true }) + btn("place", "放到牌堆底", { data: { where: "bottom" } });
        break;
      case "play":
        p = S.human === "dealer" ? "选一张层牌暗出（每轮必须出一张）。" : "选一张元素牌暗出（常态不能当出牌）。";
        break;
      case "bet1": case "bet2":
        ({ p, b } = betControls(v, has));
        break;
      case "weather": {
        const skips = v.legal.filter(o => o.type === "skip");
        if (S.mode === "skip") {
          p = "点一张手牌暗弃（不公开），这一轮就不翻天气。";
          b = btn("mode", "取消", { data: { mode: "" } });
        } else {
          p = `翻开一张新天气（堆里还剩 ${v.deckCount} 张），或者暗弃任意一张手牌跳过。`;
          b = btn("reveal", "翻开天气", { primary: true }) + btn("mode", "暗弃一张跳过", { data: { mode: "skip" }, disabled: !skips.length, title: skips.length ? "" : "没有能弃的牌了：要给后面每一轮留一张元素牌" });
        }
        break;
      }
      case "normal":
        if (S.mode === "normal") {
          p = "点一张元素牌暗弃，打出常态清除天气。";
          b = btn("mode", "取消", { data: { mode: "" } });
        } else {
          p = `要不要用常态清除〔${esc(CC().weatherName(v.weather))}〕？代价是再暗弃一张元素牌，每局只能用一次。`;
          b = btn("mode", "用常态清除天气", { data: { mode: "normal" } }) + btn("noNormal", "不用", { primary: true });
        }
        break;
    }
    return `<p class="cc-prompt">${p}</p><div class="cc-btns">${b}</div>${infoLine(v)}${msg}`;
  }
  function infoLine(v) {
    const parts = [`本轮最低下注 ${v.minBet} 枚`];
    if (v.betting) parts.push(`加注 ${v.betting.raises}/${v.maxRaises}`);
    if (v.betting && v.betting.toCall) parts.push(`待跟 ${v.betting.toCall} 枚`);
    if (v.allIn) parts.push("相位全押");
    return `<p class="cc-info">${parts.join(" · ")}</p>`;
  }
  function betControls(v, has) {
    const first = v.stage === "bet1" ? "第一轮下注（玩家先）" : "第二轮下注（庄家先）";
    const opp = sideName(v.opponent);
    const bet = has("bet"), raise = has("raise"), call = has("call");
    const o = bet || raise;
    if (o) {
      if (S.amount == null || S.amount < o.min || S.amount > o.max) S.amount = o.min;
    }
    let p = call ? `${first}：${opp}下了注，要跟 ${call.amount} 枚。` : `${first}：还没人下注。`;
    let b = "";
    if (has("check")) b += btn("check", "过牌", { primary: !o });
    if (call) b += btn("call", `跟注 ${call.amount}`, { primary: true });
    if (o) {
      const verb = bet ? "下注" : "加注";
      b += `<span class="cc-amount" role="group" aria-label="${verb}额">`
        + btn("amt", "−", { data: { d: -1 }, disabled: S.amount <= o.min, title: "少一枚" })
        + `<b class="cc-amt">${S.amount}</b>`
        + btn("amt", "+", { data: { d: 1 }, disabled: S.amount >= o.max, title: "多一枚" })
        + btn("amt", "最大", { data: { set: "max" }, disabled: S.amount >= o.max, title: `最多 ${o.max} 枚` })
        + `</span>` + btn(bet ? "bet" : "raise", `${verb} ${S.amount}`, { cls: "cc-hot" });
      p += bet ? ` 下注至少 ${o.min} 枚。` : ` 加注至少 ${o.min} 枚。`;
    }
    b += btn("fold", "弃牌", { cls: "cc-danger", title: "立即判负：输掉自己已下的筹码（包括自己在滚存底池里的那一份）" });
    const lo = has("borrow");
    if (lo) {
      p += ` 手上的筹码不够（这一步要 ${lo.need} 枚，你只有 ${v.me.chips} 枚），可以先向主持方借（每借 ${v.loan.unit} 枚，结束时还 ${v.loan.repay} 枚），借完还是你下注。`;
      b += loanBtns(lo, false);
    }
    return { p, b };
  }
  function sideHtml(v) {
    const rows = v.results.map(r => {
      const o = outcomeOf(r, S.human);
      return `<li class="cc-res ${o.cls}"><b>第 ${r.r} 轮</b><span>${esc(o.text)}</span><span class="cc-wxname">${esc(CC().weatherName(r.weather))}</span><span class="cc-delta">${signed(r.delta[S.human])}</span></li>`;
    }).join("");
    // 记录按时间顺序，最新的在最下面（和战斗记录一样；以前最新的在最上面）
    const log = v.log.slice(-UI_CONFIG.logLines).map(e => `<li class="${e.to ? "cc-private" : ""}">${esc(e.text)}</li>`).join("");
    // 克制表的入口放在最上面（以前这里是折叠的「克制速查」小表，换成打开完整克制表的按钮）
    return `${MU() ? chartBtn(v) : ""}<h3>每轮结算</h3><ol class="cc-results">${rows || "<li class=\"cc-empty\">还没有结算</li>"}</ol>
      ${rulesHtml()}
      <h3>记录</h3><ul class="cc-log">${log}</ul>`;
  }
  /** 侧栏的记录滚到了哪（整块重画之前看一眼）：null = 还没画过；bottom = 在底部（离底不到 logStick 像素，或者根本不用滚） */
  function logScroll(side) {
    const el = side.querySelector(".cc-log");
    return el ? { top: el.scrollTop, bottom: el.scrollHeight - el.scrollTop - el.clientHeight <= UI_CONFIG.logStick } : null;
  }
  /** 重画之后：原来在底部（或第一次画）就滚到底看新记录；玩家往上翻着看旧的就停在原处，不强行拉回去（同联机的消息列表 online-ui.js · fillList） */
  function stickLog(side, was) {
    const el = side.querySelector(".cc-log");
    if (el) el.scrollTop = !was || was.bottom ? el.scrollHeight : was.top;
  }
  /** 一轮的结果从 side 这一方看：只有胜负、分档 */
  function outcomeOf(r, side) {
    const tier = `差 ${r.tier}`;
    if (r.outcome === "fold") return r.folded === side ? { cls: "lose", text: "你弃牌" } : { cls: "win", text: "对手弃牌" };
    if (r.outcome === "tie") return { cls: "tie", text: r.refund ? (r.allIn ? "相位平局，各自退回" : "平局，各自拿回") : "平局，底池滚存" };
    return r.winner === side ? { cls: "win", text: `你赢 · ${tier}` } : { cls: "lose", text: `你输 · ${tier}` };
  }
  function bannerHtml(r, v) {
    const o = outcomeOf(r, S.human);
    const big = { win: "你赢了", lose: "你输了", tie: "平局" }[o.cls];
    const tierText = r.outcome === "fold" ? (r.folded === S.human ? "你弃牌，输掉自己已下的筹码" : "对手弃牌，底池归你")
      : r.outcome === "tie" ? (r.refund ? (r.allIn ? "相位轮打平：各自退回自己下的筹码" : "最后一轮打平：各自拿回自己的筹码") : `底池 ${r.pot} 枚滚存到下一轮`)
      : (r.tier >= 2 ? "差 2：输家再赔出自己下注额的 0.5 倍" : "差 1：赢家拿走底池");
    const mine = r.delta[S.human], theirs = r.delta[CC().other(S.human)];
    return `<div class="cc-banner-card ${o.cls}" role="dialog" aria-label="第 ${r.r} 轮结算">
      <small>第 ${r.r} 轮结算${r.allIn ? " · 相位全押" : ""}</small>
      <h3>${big}</h3>
      <p class="cc-tier">${esc(tierText)}</p>
      <p class="cc-deltas"><span class="${mine >= 0 ? "up" : "down"}">你 ${signed(mine)} 枚</span><span>${sideName(v.opponent)} ${signed(theirs)} 枚</span></p>
      <p class="cc-quiet">不亮牌：谁出了什么都不公开。</p>
      <div class="cc-btns">${btn("dismiss", v.over ? "看总结算" : "继续", { primary: true })}${bannerChartBtn()}</div>
    </div>`;
  }
  /** 结算横幅盖住了顶栏的「菜单」：横幅上也放一个克制表的按钮 */
  function bannerChartBtn() {
    return MU() ? btn("chart", esc(UI_CONFIG.chart.label), { title: UI_CONFIG.chart.hint }) : "";
  }
  /** 总结算：按最终筹码数（扣还借款之后）定胜负，写清楚扣还了多少 */
  function finalHtml(v) {
    const f = v.final || {}, me = S.human, op = v.opponent;
    const res = f.winner === me ? "win" : f.winner ? "lose" : "tie";
    const big = { win: "这一局你赢了", lose: "这一局你输了", tie: "这一局打平" }[res];
    const tone = { win: "up", lose: "down", tie: "" }[res];
    const fin = f.chips || {}, loans = f.loans || {};
    const theirs = fin[op] == null ? "∞" : fin[op];
    const repaid = [me, op].filter(k => loans[k] && loans[k].owe).map(k => `${k === me ? "你" : sideName(k)}借 ${loans[k].loan} 枚、还 ${loans[k].owe} 枚`);
    const rule = fin[op] == null ? `按你扣还借款后的筹码比买入的 ${v.me.start} 枚` : "按最终筹码数（扣还借款之后）比";
    return `<div class="cc-banner-card cc-final ${res}" role="dialog" aria-label="对局结束">
      <small>对局结束 · 打了 ${f.rounds} 轮</small>
      <h3>${big}</h3>
      <p class="cc-deltas"><span class="${tone}">你 ${fin[me]} 枚</span><span>${sideName(op)} ${theirs} 枚</span></p>
      <p class="cc-tier">${esc(rule)}${repaid.length ? `；已扣还借款：${esc(repaid.join("，"))}` : ""}。</p>
      <div class="cc-btns">${btn("again", "再来一局", { primary: true })}${btn("swap", `换成${sideName(CC().other(S.human))}`)}${btn("setup", "换难度")}${bannerChartBtn()}${btn("title", "回到标题")}</div>
    </div>`;
  }

  /* ---------- 点击 ---------- */
  function onClick(e) {
    const b = e.target && e.target.closest ? e.target.closest("[data-cc]") : null;
    if (!b || b.disabled) return;
    // 长按看预览、松手后浏览器要是还补了一下点击：不算出牌（只拦长按的那一张、只拦一下）
    const sw = S && S.tipSwallow;
    if (sw) { S.tipSwallow = null; if (b.dataset.card === sw.card && Date.now() < sw.until) return; }
    const d = b.dataset, act = d.cc;
    switch (act) {
      case "set": SETUP[d.key] = d.val; renderSetup(); return;
      case "start": start({ side: SETUP.side, level: SETUP.level }); return;
      case "setup": open(); return;
      case "title": toTitle(); return;
      case "again": start({ side: S ? S.human : SETUP.side, level: S ? S.level : SETUP.level }); return;
      case "swap": start({ side: CC().other(S ? S.human : SETUP.side), level: S ? S.level : SETUP.level }); return;
      case "dismiss": if (S) { S.banner = null; render(); schedule(); } return;
      case "chart": openChart(); return;   // 只开克制表，不动对局和操作栏
    }
    if (!S) return;
    switch (act) {
      case "weather": humanAct({ type: "weather", op: d.op }); break;
      case "place": humanAct({ type: "place", where: d.where }); break;
      case "play": humanAct({ type: "play", card: d.card }); break;
      case "check": case "call": case "fold": case "reveal": case "noNormal": case "noLoan": humanAct({ type: act }); break;
      case "bet": case "raise": humanAct({ type: act, amount: S.amount }); break;
      case "borrow": humanAct({ type: "borrow", amount: Number(d.amount) }); break;
      case "skip": case "normal": humanAct({ type: act, card: d.card }); break;
      case "mode": S.mode = d.mode || null; render(); break;
      case "amt": {
        const v = CC().view(S.game, S.human), o = v.legal.find(x => x.type === "bet" || x.type === "raise");
        if (!o) return;
        S.amount = d.set === "max" ? o.max : Math.max(o.min, Math.min(o.max, (S.amount || o.min) + Number(d.d || 0)));
        render();
        break;
      }
    }
  }
  function bind() {
    if (bound || !doc()) return;
    const scr = $("scr-cc");
    if (!scr) return;
    scr.addEventListener("click", onClick);
    // 悬停预览：电脑上鼠标停上去、手机上长按（见上面「悬停预览」）；#scr-cc 自己滚动、窗口变了，预览跟着牌挪
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
    const scr = $("scr-cc"), sc = screens();
    if (sc && scr) sc.register("counter", scr, { onHide: leave });
    const entry = $("t-cc");
    if (entry) entry.onclick = () => open();
  }
  if (doc() && $("scr-cc")) {
    if (doc().readyState === "loading") doc().addEventListener("DOMContentLoaded", boot);
    else boot();
  }

  root.CounterCardsUI = {
    UI_CONFIG, open, start, render, stop: stopTimer, setFast, cardHtml, backHtml, weatherCardHtml, chipsHtml, outcomeOf, weatherMods,
    openChart, closeChart, chartOpen, tipHtml, showTip, hideTip,
    state: () => S, view: () => (S ? CC().view(S.game, S.human) : null), act: humanAct, dismiss: () => { if (S) { S.banner = null; render(); schedule(); } }
  };
})(typeof window !== "undefined" ? window : globalThis);
