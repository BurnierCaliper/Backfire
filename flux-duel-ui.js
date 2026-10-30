/* Flux Duel（#488）· 界面：标题 → 本地玩法 → Flux Duel → 座位（先手 / 后手）、难度 → 牌桌（界面 Akane）
 * 名字读 FluxDuel.DUEL_CONFIG.name（菜单按钮、设置页、牌桌标题、规则说明）。
 * 规则在 flux-duel.js，AI 在 flux-duel-ai.js；画面只拿 FluxDuel.view(对局, 人这一方)，人和 AI 看到的是同一份东西。
 * 两张新牌桌共用的零件（AI 排着走、借贷和下注栏、跟注后追加窗口的倒计时、克制表、悬停预览）在 flux-ui.js；牌面借 High Flux 的。
 * 桌上：对方的手牌（牌背：层牌、元素牌各几张）和筹码；中间是天气堆、这一轮背面朝上的天气（第一轮下注后翻开，翻开时闪一下、有天气特效）、
 *   前几轮翻开过的天气、底池；两边暗出的牌（各两张牌背，自己的在角上标一下是什么）；自己的手牌分两排（层牌、元素牌），各点一张选中再「暗出」。
 * 结算横幅：胜负、分档、筹码变动；亮牌开关打开时（DUEL_CONFIG.reveal）另写双方出的牌和得分，不亮时写「不亮牌」。
 * 克制表（侧栏、结算横幅上的按钮）、手里元素牌的悬停预览：按这一轮翻开的天气算实际总分（还没翻开 = 按没有天气算）。
 *
 *   FluxDuelUI.open()                                              打开设置页
 *   FluxDuelUI.start({ side: "a", level: "hard", seed, fast })     直接开一局（side：你坐哪一方，a = 第 1 轮先手；fast：AI 不等，测试用）
 *   FluxDuelUI.start({ game, side, level, casino: { label, againText, leaveTitle, onChange, onLeave, onAgain } })   赌场桌（casino-ui.js 打开）
 */
(function (root) {
  "use strict";

  const UI_CONFIG = {
    // 悬停预览（手里的元素牌）的字
    tip: { head: "打对方五种层", foot: "正分加分 · 负分扣分 · 对方的元素打你的层也照这张表算", facedown: "天气还没翻开，按没有天气算" },
    levelNames: { easy: "简单", normal: "普通", hard: "困难" }
  };
  const FD = () => root.FluxDuel;
  const AI = () => root.FluxDuelAI;
  const CC = () => root.CounterCards;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[ch]);
  const signed = (n) => (n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0");
  const cn = (c) => CC().cardName(c);
  const wn = (w) => (w ? CC().weatherName(w) : "没有天气");
  const levelName = (lv) => UI_CONFIG.levelNames[lv] || lv;

  const SETUP = { side: "a", level: "normal" };

  /* ---------- 开局 ---------- */
  function begin(opt) {
    const human = opt.side === "b" ? "b" : "a", ai = FD().other(human);
    const level = AI().LEVELS.indexOf(opt.level) >= 0 ? opt.level : "normal";
    SETUP.side = human; SETUP.level = level;
    const names = Object.assign({ [human]: "你", [ai]: "对手" }, opt.names || {});
    const game = opt.game || FD().newGame(Object.assign({ seed: opt.seed, names }, opt.gameOpt || {}));
    return { game, human, ai, level, levels: { [ai]: level } };
  }

  /* ---------- 设置页、规则 ---------- */
  function setupHtml(T) {
    const D = FD().DUEL_CONFIG, C = CC().CC_CONFIG;
    const start = D.startChips != null ? D.startChips : C.startChips;
    const opt = (key, val, label, sub) => `<button type="button" class="cc-opt${SETUP[key] === val ? " on" : ""}" data-fd="set" data-key="${key}" data-val="${val}" aria-pressed="${SETUP[key] === val}"><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</button>`;
    return `<div class="cc-setup-card">
      <h2 class="cc-title">${esc(D.name)}</h2>
      <p class="cc-tagline">回火赌桌 · 两人对决，${D.rounds} 轮，各用自己的元素打对方的层</p>
      <div class="cc-pick"><span class="cc-pick-label">座位</span>
        ${opt("side", "a", "先手", "第 1、3、5 轮先下注")}${opt("side", "b", "后手", "第 2、4 轮先下注")}
      </div>
      <div class="cc-pick"><span class="cc-pick-label">对手 AI</span>
        ${opt("level", "easy", "简单", "随手出牌")}${opt("level", "normal", "普通", "只看单轮结果")}${opt("level", "hard", "困难", "记整局、会诈唬")}
      </div>
      <p class="cc-hint">开局双方各 ${start} 枚筹码，另一方由 AI 操作。筹码不够时可以向主持方借（每借 ${C.loan.unit} 枚，结束时还 ${C.loan.repay} 枚）；最后按扣还后的筹码数定胜负。</p>
      ${rulesHtml()}
      <div class="cc-go"><button type="button" class="cc-btn" data-fd="title">回到标题</button><button type="button" class="cc-btn primary" data-fd="start">开局</button></div>
    </div>`;
  }
  /** 分档赔付写成一句（读 DUEL_CONFIG.tierExtra） */
  function tierRule() {
    const T = FD().DUEL_CONFIG.tierExtra, last = T.length - 1;
    return T.slice(1).map((x, i) => {
      const n = i + 1, head = n === last ? `差 ${n} 及以上` : `差 ${n}`;
      return x ? `${head}赢家拿走底池，输家再赔自己这一轮下注额的 ${x} 倍` : `${head}赢家拿走底池`;
    }).join("；");
  }
  function rulesHtml() {
    const D = FD().DUEL_CONFIG, C = CC().CC_CONFIG;
    return `<details class="cc-rules"><summary>${esc(D.name)} 规则</summary><ul>
      <li><b>牌</b>：不设庄家，每人 ${C.layers.length} 张层牌（${C.layers.map(cn).join("、")}）+ ${C.elements.length} 张元素牌（${C.elements.map(cn).join("、")}），没有常态。层牌每轮必出一张；元素牌每张整局只能用一次。</li>
      <li><b>天气</b>：${C.weathers.length} 张洗混成一堆，每轮开始拿一张背面朝上放好，谁都不能偷看、也不能翻，第一轮下注后自动翻开；第一轮下注时有人弃牌，这一张盖着弃掉。</li>
      <li><b>每轮</b>：（筹码不够的先决定借不借）① 双方各下底注 = 轮数 ② 同时暗出一张层牌 + 一张元素牌 ③ 第一轮下注 ④ 翻开天气 ⑤ 第二轮下注 ⑥ 结算。先手每轮轮换（同一轮两次下注都是这一轮的先手先）。</li>
      <li><b>计分</b>：各自用自己的元素牌打对方的层牌，按游戏里的克制表（克制 +1、劣势 −1、其余 0）加天气修正（每 25% 记 ±1；微光里能量以外的克制反转；酸雨里酸、冰以外的元素打装甲另 +1），分高的赢。</li>
      <li><b>分档赔付</b>：${esc(tierRule())}（半枚向下取整）。</li>
      <li><b>下注</b>：每轮最低下注额 = 轮数，每个下注回合最多加注 ${C.maxRaises} 次；想押多少押多少（对方押得比你手上的还多，要跟就先借）；跟注后有 ${C.callWindowSec} 秒追加窗口，还可以加注或弃牌。弃牌立即判负，输掉自己已下的筹码。平局底池滚存到下一轮，第 ${D.rounds} 轮打平各自拿回。</li>
      <li><b>相位</b>：翻到相位双方全押（上限是筹码较少一方的全部筹码），不再下注直接比分；打平底池滚到下一轮，最后一轮双方平分。</li>
      <li><b>亮牌</b>：${D.reveal ? "结算时公开双方出的牌和得分。" : "不亮牌：结算只公开胜负、分档和筹码变动。"}</li>
      <li><b>借贷</b>：筹码不够时可以向主持方借，${C.loan.unit} 枚一份，每借 ${C.loan.unit} 枚对局结束时还 ${C.loan.repay} 枚，借几次都行；输光了不借，这一局就结束。</li>
      <li><b>胜负</b>：${D.rounds} 轮打完后按最终筹码数（扣还借款之后）比，多的赢。</li>
    </ul></details>`;
  }

  /* ---------- 牌桌 ---------- */
  function topHtml(T, v) {
    const S = T.state(), D = FD().DUEL_CONFIG;
    const status = v.over ? "对局结束" : `第 ${v.round} / ${v.rounds} 轮 · ${v.lead === v.side ? "你先手" : "对手先手"}`;
    const head = `<b class="cc-brand">${esc(D.name)}</b><span class="cc-round">${status}</span>`;
    if (S.casino) return `${head}<span class="cc-role">${esc(S.casino.label || "赌场")} · 对手：${esc(levelName(S.level))} AI</span><span class="cc-spacer"></span>${T.btn("leave", "离桌", { title: S.casino.leaveTitle || "" })}`;
    return `${head}<span class="cc-role">对手：${esc(levelName(S.level))} AI</span><span class="cc-spacer"></span>${T.btn("setup", "换座位 / 难度")}${T.btn("title", "回到标题")}`;
  }
  function boardHtml(T, v) {
    const S = T.state(), me = v.me, opp = v.opp, deal = !!S.anim.deal, sel = S.sel || {};
    const anim = { opp: T.bump("oppChips", opp.chips), me: T.bump("myChips", me.chips), pot: T.bump("pot", v.pot),
      oppThrow: T.bump("oppThrow", v.round + ":" + opp.played) && opp.played, myThrow: T.bump("myThrow", v.round + ":" + me.element) && !!me.element,
      wx: T.bump("wx", v.round + ":" + (v.weather || "")) && !!v.weather && !deal };
    const backs = (n, from) => Array.from({ length: n }, (_, i) => T.back({ cls: deal ? "cc-deal" : "", delay: deal ? from + i : null })).join("");
    const picking = v.stage === "play" && v.myTurn;
    const mine = (list, kind, from) => list.map((c, i) => T.handCard(c, { act: picking ? "pick" : null, tip: kind === "element",
      cls: (deal ? "cc-deal " : "") + (picking ? "cc-can" : "") + (sel[kind] === c ? " fd-sel" : ""), delay: deal ? from + i : null,
      data: { kind } })).join("");
    const deck = Array.from({ length: Math.min(v.deckCount, 7) }, (_, i) => `<i style="--i:${i}"></i>`).join("");
    const wnow = v.weather ? T.weatherCard(v.weather, { cls: anim.wx ? "cc-flip" : "" })
      : v.facedown ? T.back({ cls: "fd-wback" }) : T.weatherCard(null);
    const wlabel = v.weather ? "这一轮的天气" : v.facedown ? "背面朝上 · 第一轮下注后翻开" : "这一轮没有天气";
    const flash = anim.wx ? `<div class="cc-flash" style="--c:${T.weatherColor(v.weather)}" aria-hidden="true"></div>` : "";
    const potShare = me.pot + opp.pot;
    const played = (who, s, cards) => (s ? `<div class="cc-slot fd-slot">${cards}</div>` : `<div class="cc-slot fd-slot"><span class="cc-empty">${who}还没出牌</span></div>`);
    return `${flash}<div class="cc-seat cc-opp">
        <div class="cc-who"><b>对手</b><small>${esc(levelName(S.level))} AI</small>${T.loanTag(opp, "对手")}</div>
        <div class="fd-backs"><div class="cc-hand cc-hand-back" title="层牌 ${opp.layerCount} 张">${backs(opp.layerCount, 0)}</div><small>层牌 ${opp.layerCount}</small>
          <div class="cc-hand cc-hand-back" title="元素牌 ${opp.elementCount} 张">${backs(opp.elementCount, opp.layerCount)}</div><small>元素牌 ${opp.elementCount}</small></div>
        ${T.chips(opp.chips, { title: "对手的筹码", label: opp.infinite ? "筹码无限" : "", anim: anim.opp })}
      </div>
      <div class="cc-center">
        <div class="cc-wzone">
          <div class="cc-deck" title="天气堆还剩 ${v.deckCount} 张"><span class="cc-deckstack">${deck}</span><b>${v.deckCount}</b><small>天气堆</small>${v.buried ? `<small class="cc-known">盖着弃掉 ${v.buried} 张</small>` : ""}</div>
          <div class="cc-wnow">${wnow}<small>${wlabel}</small></div>
          ${v.gone.length ? `<div class="cc-gone" title="前几轮翻开过的天气">${v.gone.map(T.miniWeather).join("")}</div>` : ""}
        </div>
        <div class="cc-pot${v.allIn ? " allin" : ""}">
          ${T.chips(v.pot, { cls: "cc-potstack", title: "底池", label: "底池", anim: anim.pot })}
          ${potShare ? `<small class="cc-roll">含滚存 ${potShare} 枚</small>` : ""}
          <span class="cc-bets"><span>对手本轮 ${opp.bet}</span><span>你本轮 ${me.bet}</span></span>
        </div>
        <div class="cc-slots fd-slots">
          ${played("对手", opp.played, T.back({ cls: "cc-down" + (anim.oppThrow ? " cc-thrown" : "") }) + T.back({ cls: "cc-down" + (anim.oppThrow ? " cc-thrown" : "") }))}
          ${played("你", me.element, T.back({ mine: me.layer, cls: "cc-down" + (anim.myThrow ? " cc-thrown" : "") }) + T.back({ mine: me.element, cls: "cc-down" + (anim.myThrow ? " cc-thrown" : "") }))}
        </div>
      </div>
      <div class="cc-seat cc-me">
        ${T.chips(me.chips, { title: "你的筹码", anim: anim.me })}
        <div class="fd-hand2">
          <div class="cc-hand fd-row" data-row="layer"><span class="fd-rowlabel">层牌</span>${mine(me.layers, "layer", opp.layerCount + opp.elementCount) || `<span class="cc-empty">层牌出完了</span>`}</div>
          <div class="cc-hand fd-row" data-row="element"><span class="fd-rowlabel">元素牌</span>${mine(me.elements, "element", opp.layerCount + opp.elementCount + me.layers.length)}</div>
        </div>
        <div class="cc-who"><b>你</b>${T.loanTag(me, "你")}</div>
      </div>`;
  }
  function stageControls(T, v) {
    if (v.stage !== "play") return { p: "", b: "" };
    const sel = T.state().sel || {};
    const picked = [sel.layer, sel.element].filter(Boolean).map(c => `〔${cn(c)}〕`).join("");
    const ready = !!(sel.layer && sel.element);
    const p = `选一张层牌、一张元素牌，一起暗出（层牌每轮必出一张；元素牌每张整局只能用一次）。${picked ? `已选：${picked}` : ""}`;
    return { p, b: T.btn("play", ready ? `暗出 ${picked}` : "暗出", { primary: true, disabled: !ready, title: ready ? "" : "层牌、元素牌各选一张" }) };
  }
  const waitText = (T, v) => (v.stage === "play" && v.me.element ? "你已经暗出了牌，等对手出牌……" : "对手正在想……");
  const streetText = (T, v) => `${v.stage === "bet1" ? "第一轮下注（天气还背面朝上）" : "第二轮下注"}（${v.lead === v.side ? "你" : "对手"}先）`;
  function infoLine(T, v) {
    const parts = [`本轮底注 ${v.ante} 枚`, `最低下注 ${v.minBet} 枚`];
    if (v.betting) parts.push(`加注 ${v.betting.raises}/${v.maxRaises}`);
    if (v.betting && v.betting.toCall) parts.push(`待跟 ${v.betting.toCall} 枚`);
    if (v.allIn) parts.push("相位全押");
    return `<p class="cc-info">${parts.join(" · ")}</p>`;
  }
  const seatName = (T, k) => (k === T.state().human ? "你" : "对手");

  /* ---------- 侧栏、结算 ---------- */
  /** 一轮的结果从 side 这一方看：只有胜负、分档 */
  function outcomeOf(r, side) {
    if (r.outcome === "fold") return r.folded === side ? { cls: "lose", text: "你弃牌" } : { cls: "win", text: "对手弃牌" };
    if (r.outcome === "tie") return { cls: "tie", text: r.split ? "相位平局，平分底池" : r.refund ? "平局，各自拿回" : r.allIn ? "相位平局，底池滚存" : "平局，底池滚存" };
    const tier = `差 ${r.tier}${r.allIn ? " · 相位全押" : ""}`;
    return r.winner === side ? { cls: "win", text: `你赢 · ${tier}` } : { cls: "lose", text: `你输 · ${tier}` };
  }
  function sideHtml(T, v) {
    const rows = v.results.map(r => {
      const o = outcomeOf(r, v.side);
      return `<li class="cc-res ${o.cls}"><b>第 ${r.r} 轮</b><span>${esc(o.text)}</span><span class="cc-wxname">${esc(r.outcome === "fold" && !r.weather ? "天气没翻开" : wn(r.weather))}</span><span class="cc-delta">${T.signed(r.delta[v.side])}</span></li>`;
    }).join("");
    return `${T.chartBtn(`天气 ${v.weather ? wn(v.weather) : v.facedown ? "还没翻开" : "没有"} · 实际得分`)}<h3>每轮结算</h3><ol class="cc-results">${rows || "<li class=\"cc-empty\">还没有结算</li>"}</ol>
      ${rulesHtml()}
      <h3>记录</h3><ul class="cc-log">${T.logHtml(v)}</ul>`;
  }
  function bannerHtml(T, r, v) {
    const o = outcomeOf(r, v.side), x = FD().DUEL_CONFIG.tierExtra;
    const big = { win: "你赢了", lose: "你输了", tie: "平局" }[o.cls];
    const tierText = r.outcome === "fold" ? (r.folded === v.side ? "你弃牌，输掉自己已下的筹码" : "对手弃牌，底池归你")
      : r.outcome === "tie" ? (r.split ? "相位全押、最后一轮打平：双方平分底池" : r.refund ? "最后一轮打平：各自拿回自己的筹码" : `底池 ${r.pot} 枚滚存到下一轮`)
      : `差 ${r.tier}${r.tier >= x.length - 1 ? " 及以上" : ""}：${x[r.tier] ? `输家再赔出自己下注额的 ${x[r.tier]} 倍` : "赢家拿走底池"}`;
    const mine = r.delta[v.side], theirs = r.delta[v.opponent];
    const shown = r.shown ? `<p class="fd-shown">你出〔${esc(cn(r.shown[v.side].layer))}〕〔${esc(cn(r.shown[v.side].element))}〕得 ${signed(r.shown[v.side].score)} · `
      + `对手出〔${esc(cn(r.shown[v.opponent].layer))}〕〔${esc(cn(r.shown[v.opponent].element))}〕得 ${signed(r.shown[v.opponent].score)}</p>`
      : r.outcome === "fold" ? "" : `<p class="cc-quiet">不亮牌：谁出了什么都不公开。</p>`;
    return `<div class="cc-banner-card ${o.cls}" role="dialog" aria-label="第 ${r.r} 轮结算">
      <small>第 ${r.r} 轮结算${r.weather ? ` · ${esc(wn(r.weather))}` : ""}${r.allIn ? " · 相位全押" : ""}</small>
      <h3>${big}</h3>
      <p class="cc-tier">${esc(tierText)}</p>
      <p class="cc-deltas"><span class="${mine >= 0 ? "up" : "down"}">你 ${T.signed(mine)} 枚</span><span>对手 ${T.signed(theirs)} 枚</span></p>
      ${shown}
      <div class="cc-btns">${T.btn("dismiss", v.over ? "看总结算" : "继续", { primary: true })}${T.bannerChartBtn()}</div>
    </div>`;
  }
  function finalHtml(T, v) {
    const S = T.state(), f = v.final || {}, me = v.side, op = v.opponent;
    const res = f.winner === me ? "win" : f.winner ? "lose" : "tie";
    const big = { win: "这一局你赢了", lose: "这一局你输了", tie: "这一局打平" }[res];
    const fin = f.chips || {}, loans = f.loans || {};
    const theirs = fin[op] == null ? "∞" : fin[op];
    const repaid = [me, op].filter(k => loans[k] && loans[k].owe).map(k => `${k === me ? "你" : "对手"}借 ${loans[k].loan} 枚、还 ${loans[k].owe} 枚`);
    const rule = fin[op] == null ? `按你扣还借款后的筹码比买入的 ${v.me.start} 枚` : "按最终筹码数（扣还借款之后）比";
    return `<div class="cc-banner-card cc-final ${res}" role="dialog" aria-label="对局结束">
      <small>对局结束 · 打了 ${f.rounds} 轮</small>
      <h3>${big}</h3>
      <p class="cc-deltas"><span class="${{ win: "up", lose: "down", tie: "" }[res]}">你 ${fin[me]} 枚</span><span>对手 ${theirs} 枚</span></p>
      <p class="cc-tier">${esc(rule)}${repaid.length ? `；已扣还借款：${esc(repaid.join("，"))}` : ""}。</p>
      <div class="cc-btns">${S.casino
        ? `${T.btn("casinoAgain", esc(S.casino.againText || "再来一局"), { primary: true })}${T.bannerChartBtn()}${T.btn("leave", "离桌")}`
        : `${T.btn("again", "再来一局", { primary: true })}${T.btn("swap", S.human === "a" ? "换成后手" : "换成先手")}${T.btn("setup", "换难度")}${T.bannerChartBtn()}${T.btn("title", "回到标题")}`}</div>
    </div>`;
  }

  /* ---------- 克制表、悬停预览：按这一轮翻开的天气（还没翻开 = 没有天气）算实际总分 ---------- */
  // 结算横幅开着时按刚结算的那一轮的天气（下一轮的天气还背面朝上）
  const chart = (v, banner) => FD().chart(banner ? banner.weather : v.weather);
  const chartKey = (v, banner) => (banner ? "r" + banner.r + ":" : "") + ((banner ? banner.weather : v.weather) || "none");
  function tipHtml(T, card, v) {
    const c = CC().cardChart(card, v.weather), U = UI_CONFIG.tip;
    const head = `${U.head} · ${v.weather ? `天气 ${wn(v.weather)}` : v.facedown ? U.facedown : "没有天气"}`;
    return root.FluxUI.tipHtml(card, c, head, U.foot);
  }

  /* ---------- 自己的按钮 ---------- */
  function click(T, act, d) {
    const S = T.state();
    switch (act) {
      case "set": SETUP[d.key] = d.val; T.renderSetup(); return true;
      case "start": T.start({ side: SETUP.side, level: SETUP.level }); return true;
      case "again": T.start({ side: S ? S.human : SETUP.side, level: S ? S.level : SETUP.level }); return true;
      case "swap": T.start({ side: FD().other(S ? S.human : SETUP.side), level: S ? S.level : SETUP.level }); return true;
      case "pick": {
        if (!S) return true;
        const kind = d.kind === "layer" ? "layer" : "element";
        S.sel = Object.assign({}, S.sel, { [kind]: S.sel && S.sel[kind] === d.card ? null : d.card });
        T.render();
        return true;
      }
      case "play":
        if (S && S.sel && S.sel.layer && S.sel.element) T.act({ type: "play", layer: S.sel.layer, element: S.sel.element });
        return true;
    }
    return false;
  }

  if (!root.FluxUI) return;
  const T = root.FluxUI.table({
    key: "fd", screen: "fluxDuel", rules: FD, ai: AI, name: () => FD().DUEL_CONFIG.name,
    begin, setupHtml, topHtml, boardHtml, sideHtml, bannerHtml, finalHtml, stageControls, waitText, streetText, infoLine, seatName,
    weatherOf: (v) => v.weather, chart, chartKey, tipHtml, click,
    loanNeedText: () => "的底注 + 最低下注额",
    foldTitle: "立即判负：输掉自己已下的筹码（包括自己在滚存底池里的那一份）"
  });
  root.FluxDuelUI = Object.assign({}, T, { UI_CONFIG, SETUP, outcomeOf });
})(typeof window !== "undefined" ? window : globalThis);
