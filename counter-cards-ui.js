/* 克制卡牌（暂名，#485）· 界面：标题 → 本地玩法 → 克制卡牌 → 选边、难度 → 牌桌
 *
 * 规则在 counter-cards.js，AI 在 counter-cards-ai.js；画面只拿 CounterCards.view(对局, 人这一方)，人和 AI 看到的是同一份东西。
 * 牌桌：深色赌桌；元素牌 / 层牌用游戏里的图标和配色（icons.js、game.css 的 --fire / --flesh……）；筹码堆、发牌动画；
 *       天气堆放在桌边，翻开天气时有闪光和对应的天气特效（weather-fx.js，和战场同一套）。
 * 暗出的牌一律显示牌背（自己的那张在角上标一下是什么）；结算只显示胜负、分档和筹码变动，不亮牌。
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
    logLines: 14           // 侧栏记录显示最近几条
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
  /** 一张正面朝上的牌。o.act：点了做什么（data-cc），o.cls：额外的类，o.note：牌底的小字，o.disabled，o.delay：发牌动画的先后 */
  function cardHtml(card, o) {
    o = o || {};
    const name = CC().cardName(card), k = kindOf(card);
    const tag = o.act ? "button" : "span";
    const attrs = o.act ? ` type="button" data-cc="${o.act}" data-card="${card}"${o.disabled ? " disabled" : ""}` : "";
    const style = `--c:${cardColor(card)}${o.delay != null ? `;--d:${o.delay}` : ""}`;
    return `<${tag} class="cc-card cc-${k}${o.cls ? " " + o.cls : ""}" style="${style}" data-face="${card}"${attrs} title="${esc(o.title || name)}">`
      + `<i class="cc-corner">${esc(name)}</i><span class="cc-ico">${cardIcon(card)}</span><b class="cc-name">${esc(name)}</b>`
      + `${o.note ? `<small class="cc-note">${esc(o.note)}</small>` : ""}</${tag}>`;
  }
  /** 牌背（暗出的牌、对方的手牌）。mine：自己暗出的那张，角上标一下是什么 */
  function backHtml(o) {
    o = o || {};
    const peek = o.mine ? `<span class="cc-peek" style="--c:${cardColor(o.mine)}" title="你暗出的：${esc(CC().cardName(o.mine))}">${cardIcon(o.mine)}<b>${esc(CC().cardName(o.mine))}</b></span>` : "";
    return `<span class="cc-card cc-back${o.cls ? " " + o.cls : ""}"${o.delay != null ? ` style="--d:${o.delay}"` : ""} aria-label="${o.mine ? "你暗出的牌（牌背朝上）" : "牌背"}"><span class="cc-crest">AB</span>${peek}</span>`;
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
  let S = null;           // 当前这一局：{ game, human, ai, level, rng, seen, banner, mode, amount, anim, fast, timer, revealKey, msg }
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
  }
  function open() {
    bind();
    stopTimer();
    enterScreen();
    renderSetup();
    show("setup");
  }
  function start(opt) {
    opt = opt || {};
    bind();
    stopTimer();
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
    if (root.WeatherFx && $("cc-fx")) root.WeatherFx.sync({ field: $("cc-fx"), weather: "none" });
  }
  function toTitle() {
    leave();
    const sc = screens();
    if (sc) { sc.show("title"); return; }
    const scr = $("scr-cc"), title = $("scr-title");
    if (scr) scr.hidden = true;
    if (title) title.hidden = false;
  }

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
    AI().step(S.game, S.ai, S.level, S.rng);
    afterChange();
  }

  /* ---------- 画面 ---------- */
  const sideName = (s) => CC().sideName(s);
  function renderSetup() {
    const box = $("cc-setup");
    if (!box) return;
    const C = CC().CC_CONFIG;
    const opt = (key, val, label, sub) => `<button type="button" class="cc-opt${SETUP[key] === val ? " on" : ""}" data-cc="set" data-key="${key}" data-val="${val}" aria-pressed="${SETUP[key] === val}"><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</button>`;
    box.innerHTML = `<div class="cc-setup-card">
      <h2 class="cc-title">克制卡牌</h2>
      <p class="cc-tagline">回火赌桌 · ${C.rounds} 轮暗牌，克制表定输赢</p>
      <div class="cc-pick"><span class="cc-pick-label">扮演</span>
        ${opt("side", "player", "玩家", `${C.elements.length} 张元素牌 + 常态，翻天气`)}
        ${opt("side", "dealer", "庄家", `${C.layers.length} 张层牌，管天气堆`)}
      </div>
      <div class="cc-pick"><span class="cc-pick-label">对手 AI</span>
        ${opt("level", "easy", "简单", "随手出牌")}${opt("level", "normal", "普通", "看上一轮")}${opt("level", "hard", "困难", "记整局、会诈唬")}
      </div>
      <p class="cc-hint">开局双方各 ${C.startChips} 枚筹码，另一方由 AI 操作。</p>
      ${rulesHtml()}
      <div class="cc-go"><button type="button" class="cc-btn" data-cc="title">回到标题</button><button type="button" class="cc-btn primary" data-cc="start">开局</button></div>
    </div>`;
  }
  function rulesHtml() {
    const C = CC().CC_CONFIG;
    return `<details class="cc-rules"><summary>规则</summary><ul>
      <li><b>牌</b>：庄家 ${C.layers.length} 张层牌（${C.layers.map(CC().cardName).join("、")}），每轮必须打出一张；玩家 ${C.elements.length} 张元素牌（${C.elements.map(CC().cardName).join("、")}）+ 1 张常态（每局一次）；天气堆 ${C.weathers.length} 张（${C.weathers.map(CC().weatherName).join("、")}），开局洗混，抽完就没了，新翻的天气顶替旧天气。</li>
      <li><b>计分</b>：按游戏里的克制表，克制 +1、劣势 −1、其余 0；天气修正每 25% 记 ±1（微光里能量以外的克制反转；酸雨里酸、冰以外的元素打装甲另 +1）。总分为正玩家赢，为负庄家赢，0 平局。</li>
      <li><b>每轮</b>：① 双方各下 ${C.ante} 枚底注 ② 庄家天气行动：弃掉场上的天气，或者场上没天气时偷看堆顶一张、放回原位或牌堆底（玩家看得到做了哪种）③ 双方暗出一张牌 ④ 第一轮下注，玩家先 ⑤ 玩家翻开一张新天气，或暗弃任意一张手牌跳过（弃的牌不公开）；之后还可以用常态清掉天气，代价是暗弃一张元素牌，常态不能覆盖相位 ⑥ 第二轮下注，庄家先 ⑦ 不亮牌，系统直接判胜负结算。</li>
      <li><b>下注</b>：每轮最低下注额 = 轮数，每个下注回合最多加注 ${C.maxRaises} 次；没人下注时可以过牌；弃牌立即判负，输掉自己已下的筹码（包括自己在滚存底池里的那一份）。平局底池滚存到下一轮，第 ${C.rounds} 轮打平各自拿回。</li>
      <li><b>分档赔付</b>：差 1 赢家拿走底池；差 2 输家再赔自己下注额的 0.5 倍；差 3 及以上再赔 1 倍。</li>
      <li><b>相位</b>：翻到相位，本轮双方全押，上限是筹码较少一方的全部筹码；打平各自退回。</li>
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
    if (side) side.innerHTML = sideHtml(v);
    if (banner) {
      const h = S.banner ? bannerHtml(S.banner, v) : v.over ? finalHtml(v) : "";
      banner.innerHTML = h;
      banner.hidden = !h;
    }
    if (root.WeatherFx && $("cc-fx")) root.WeatherFx.sync({ field: $("cc-fx"), weather: v.weather || "none" });
    S.anim = {};
  }
  function topHtml(v) {
    const status = v.over ? "对局结束" : `第 ${v.round} / ${v.rounds} 轮`;
    return `<b class="cc-brand">克制卡牌</b><span class="cc-round">${status}</span>`
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
        <div class="cc-who"><b>${oppName}</b><small>${esc(AI().LEVEL_NAMES[S.level])} AI</small>${opp.discardCount ? `<small>暗弃 ${opp.discardCount} 张</small>` : ""}</div>
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
        <div class="cc-who"><b>你（${sideName(S.human)}）</b>${S.human === "player" && me.discards.length ? `<small>暗弃过：${me.discards.map(d => esc(CC().cardName(d.card))).join("、")}</small>` : ""}</div>
      </div>`;
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
    return { p, b };
  }
  function sideHtml(v) {
    const rows = v.results.map(r => {
      const o = outcomeOf(r, S.human);
      return `<li class="cc-res ${o.cls}"><b>第 ${r.r} 轮</b><span>${esc(o.text)}</span><span class="cc-wxname">${esc(CC().weatherName(r.weather))}</span><span class="cc-delta">${signed(r.delta[S.human])}</span></li>`;
    }).join("");
    const log = v.log.slice(-UI_CONFIG.logLines).reverse().map(e => `<li class="${e.to ? "cc-private" : ""}">${esc(e.text)}</li>`).join("");
    return `<h3>每轮结算</h3><ol class="cc-results">${rows || "<li class=\"cc-empty\">还没有结算</li>"}</ol>
      ${chartHtml(v.weather)}
      <h3>记录</h3><ul class="cc-log">${log}</ul>`;
  }
  /** 克制速查：现在这个天气下，每张元素牌打每张层牌的得分（规则本身，公开的） */
  function chartHtml(w) {
    const C = CC().CC_CONFIG;
    const head = C.layers.map(l => `<th style="--c:${cardColor(l)}">${esc(CC().cardName(l))}</th>`).join("");
    const body = C.elements.map(el => `<tr><th style="--c:${cardColor(el)}">${esc(CC().cardName(el))}</th>${C.layers.map(l => {
      const s = CC().score(el, l, w);
      return `<td class="${s > 0 ? "pos" : s < 0 ? "neg" : ""}">${s ? signed(s) : "0"}</td>`;
    }).join("")}</tr>`).join("");
    return `<details class="cc-chart"><summary>克制速查（${esc(CC().weatherName(w))}，正数玩家占优）</summary><table><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></details>`;
  }
  /** 一轮的结果从 side 这一方看：只有胜负、分档 */
  function outcomeOf(r, side) {
    const tier = r.tier >= 3 ? "差 3 及以上" : `差 ${r.tier}`;
    if (r.outcome === "fold") return r.folded === side ? { cls: "lose", text: "你弃牌" } : { cls: "win", text: "对手弃牌" };
    if (r.outcome === "tie") return { cls: "tie", text: r.refund ? (r.allIn ? "相位平局，各自退回" : "平局，各自拿回") : "平局，底池滚存" };
    return r.winner === side ? { cls: "win", text: `你赢 · ${tier}` } : { cls: "lose", text: `你输 · ${tier}` };
  }
  function bannerHtml(r, v) {
    const o = outcomeOf(r, S.human);
    const big = { win: "你赢了", lose: "你输了", tie: "平局" }[o.cls];
    const tierText = r.outcome === "fold" ? (r.folded === S.human ? "你弃牌，输掉自己已下的筹码" : "对手弃牌，底池归你")
      : r.outcome === "tie" ? (r.refund ? (r.allIn ? "相位轮打平：各自退回自己下的筹码" : "最后一轮打平：各自拿回自己的筹码") : `底池 ${r.pot} 枚滚存到下一轮`)
      : (r.tier >= 3 ? "差 3 及以上：输家再赔出自己下注额的 1 倍" : r.tier === 2 ? "差 2：输家再赔出自己下注额的 0.5 倍" : "差 1：赢家拿走底池");
    const mine = r.delta[S.human], theirs = r.delta[CC().other(S.human)];
    return `<div class="cc-banner-card ${o.cls}" role="dialog" aria-label="第 ${r.r} 轮结算">
      <small>第 ${r.r} 轮结算${r.allIn ? " · 相位全押" : ""}</small>
      <h3>${big}</h3>
      <p class="cc-tier">${esc(tierText)}</p>
      <p class="cc-deltas"><span class="${mine >= 0 ? "up" : "down"}">你 ${signed(mine)} 枚</span><span>${sideName(v.opponent)} ${signed(theirs)} 枚</span></p>
      <p class="cc-quiet">不亮牌：谁出了什么都不公开。</p>
      ${btn("dismiss", v.over ? "看总结算" : "继续", { primary: true })}
    </div>`;
  }
  function finalHtml(v) {
    const f = v.final || {};
    const mine = f.net ? f.net[S.human] : 0;
    const big = f.winner === S.human ? "这一局你赢了" : f.winner ? "这一局你输了" : "这一局打平";
    return `<div class="cc-banner-card cc-final ${f.winner === S.human ? "win" : f.winner ? "lose" : "tie"}" role="dialog" aria-label="对局结束">
      <small>对局结束 · 打了 ${f.rounds || v.round} 轮</small>
      <h3>${big}</h3>
      <p class="cc-deltas"><span class="${mine >= 0 ? "up" : "down"}">你 ${v.me.chips} 枚（${signed(mine)}）</span><span>${sideName(v.opponent)} ${v.opp.chips == null ? "∞" : v.opp.chips} 枚</span></p>
      <div class="cc-btns">${btn("again", "再来一局", { primary: true })}${btn("swap", `换成${sideName(CC().other(S.human))}`)}${btn("setup", "换难度")}${btn("title", "回到标题")}</div>
    </div>`;
  }

  /* ---------- 点击 ---------- */
  function onClick(e) {
    const b = e.target && e.target.closest ? e.target.closest("[data-cc]") : null;
    if (!b || b.disabled) return;
    const d = b.dataset, act = d.cc;
    switch (act) {
      case "set": SETUP[d.key] = d.val; renderSetup(); return;
      case "start": start({ side: SETUP.side, level: SETUP.level }); return;
      case "setup": open(); return;
      case "title": toTitle(); return;
      case "again": start({ side: S ? S.human : SETUP.side, level: S ? S.level : SETUP.level }); return;
      case "swap": start({ side: CC().other(S ? S.human : SETUP.side), level: S ? S.level : SETUP.level }); return;
      case "dismiss": if (S) { S.banner = null; render(); schedule(); } return;
    }
    if (!S) return;
    switch (act) {
      case "weather": humanAct({ type: "weather", op: d.op }); break;
      case "place": humanAct({ type: "place", where: d.where }); break;
      case "play": humanAct({ type: "play", card: d.card }); break;
      case "check": case "call": case "fold": case "reveal": case "noNormal": humanAct({ type: act }); break;
      case "bet": case "raise": humanAct({ type: act, amount: S.amount }); break;
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
    UI_CONFIG, open, start, render, stop: stopTimer, cardHtml, backHtml, weatherCardHtml, chipsHtml, chartHtml, outcomeOf, weatherMods,
    state: () => S, view: () => (S ? CC().view(S.game, S.human) : null), act: humanAct, dismiss: () => { if (S) { S.banner = null; render(); schedule(); } }
  };
})(typeof window !== "undefined" ? window : globalThis);
