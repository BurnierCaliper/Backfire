/* Flux Hold'em（#488）· 界面：标题 → 本地玩法 → Flux Hold'em → 人数、难度 → 牌桌（界面 Akane）
 * 名字读 FluxHoldem.HOLDEM_CONFIG.name（菜单按钮、设置页、牌桌标题、规则说明）。
 * 规则在 flux-holdem.js，AI 在 flux-holdem-ai.js；画面只拿 FluxHoldem.view(对局, 你)，人和 AI 看到的是同一份东西。
 * 两张新牌桌共用的零件（AI 排着走、借贷和下注栏（多一个「全押」）、跟注后追加窗口的倒计时、克制表、悬停预览）在 flux-ui.js；牌面借 High Flux 的。
 * 桌上：上面一排是对手（名字、AI 难度、庄 / 小盲 / 大盲、筹码、这一轮押了多少、弃牌 / 全押 / 出局、手牌张数、盖了没有）；
 *   中间是 2 张公共层牌、2 张天气（翻开一张亮一张，没翻的是牌背）、天气堆和弃掉的天气、底池；下面是自己的筹码和手牌（盖牌时点一张）。
 *   自己坐庄时操作栏里能看到偷看的那张（只有自己看得到），选「留在顶上」或「压到堆底」。
 * 结算横幅：亮牌——每人出的牌和得分、主池 / 边池归谁（平分写清楚）、自己的筹码变动。
 * 克制表（侧栏、横幅上的按钮）和手里元素牌的悬停预览都按场上的天气（两张都翻开时叠加）算实际得分；预览另写对已翻开的公共层牌的得分合计。
 *
 *   FluxHoldemUI.open()                                         打开设置页
 *   FluxHoldemUI.start({ players: 3, level: "hard", seed, fast })   直接开一局（你坐 p1，其余是 AI；fast：AI 不等，测试用）
 *   FluxHoldemUI.start({ game, human: "p1", levels: { p2: "hard", … }, casino: { label, againText, leaveTitle, onChange, onLeave, onAgain } })   赌场桌
 */
(function (root) {
  "use strict";

  const UI_CONFIG = {
    aiNames: ["乙", "丙", "丁"],       // AI 座位的称呼（你坐第一个座位）
    tip: { head: "打五种层", foot: "正分加分 · 负分扣分 · 亮牌时对 2 张公共层牌求和", unrevealed: "天气还没翻开，按没有天气算" },
    levelNames: { easy: "简单", normal: "普通", hard: "困难" }
  };
  const FH = () => root.FluxHoldem;
  const AI = () => root.FluxHoldemAI;
  const CC = () => root.CounterCards;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[ch]);
  const signed = (n) => (n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0");
  const cn = (c) => CC().cardName(c);
  const wn = (w) => (w ? CC().weatherName(w) : "没有天气");
  const ws = (list) => (list && list.length ? list.map(wn).join(" + ") : "还没翻开");
  const levelName = (lv) => UI_CONFIG.levelNames[lv] || lv;

  const SETUP = { players: 3, level: "normal" };

  /* ---------- 开局 ---------- */
  function begin(opt) {
    const H = FH().HOLDEM_CONFIG;
    const level = AI().LEVELS.indexOf(opt.level) >= 0 ? opt.level : "normal";
    if (opt.game) {
      const human = opt.human || opt.game.order[0];
      const levels = opt.levels || {};
      if (!opt.levels) opt.game.order.forEach(id => { if (id !== human) levels[id] = level; });
      return { game: opt.game, human, level, levels };
    }
    const n = Math.max(H.minPlayers, Math.min(H.maxPlayers, Math.floor(Number(opt.players) || SETUP.players)));
    SETUP.players = n; SETUP.level = level;
    const players = [{ id: "p1", name: "你" }].concat(Array.from({ length: n - 1 }, (_, i) => ({ id: "p" + (i + 2), name: UI_CONFIG.aiNames[i] })));
    const game = FH().newGame(Object.assign({ seed: opt.seed, players }, opt.gameOpt || {}));
    const levels = {};
    game.order.forEach(id => { if (id !== "p1") levels[id] = level; });
    return { game, human: "p1", level, levels };
  }

  /* ---------- 设置页、规则 ---------- */
  function setupHtml(T) {
    const H = FH().HOLDEM_CONFIG, C = CC().CC_CONFIG;
    const start = H.startChips != null ? H.startChips : C.startChips;
    const opt = (key, val, label, sub) => `<button type="button" class="cc-opt${String(SETUP[key]) === String(val) ? " on" : ""}" data-fh="set" data-key="${key}" data-val="${val}" aria-pressed="${String(SETUP[key]) === String(val)}"><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</button>`;
    return `<div class="cc-setup-card">
      <h2 class="cc-title">${esc(H.name)}</h2>
      <p class="cc-tagline">回火赌桌 · ${H.minPlayers}–${H.maxPlayers} 人公共牌桌，${H.rounds} 轮，比谁的元素牌打公共层牌得分高</p>
      <div class="cc-pick"><span class="cc-pick-label">人数</span>
        ${opt("players", 2, "2 人", "你 + 1 个 AI")}${opt("players", 3, "3 人", "你 + 2 个 AI")}${opt("players", 4, "4 人", "你 + 3 个 AI")}
      </div>
      <div class="cc-pick"><span class="cc-pick-label">对手 AI</span>
        ${opt("level", "easy", "简单", "随手出牌")}${opt("level", "normal", "普通", "按胜率下注")}${opt("level", "hard", "困难", "记牌、看下注")}
      </div>
      <p class="cc-hint">开局每人 ${start} 枚筹码，其余座位由 AI 操作。筹码不够时可以向主持方借（每借 ${C.loan.unit} 枚，结束时还 ${C.loan.repay} 枚）；最后按扣还后的筹码数定胜负。</p>
      ${rulesHtml()}
      <div class="cc-go"><button type="button" class="cc-btn" data-fh="title">回到标题</button><button type="button" class="cc-btn primary" data-fh="start">开局</button></div>
    </div>`;
  }
  function rulesHtml() {
    const H = FH().HOLDEM_CONFIG, C = CC().CC_CONFIG;
    return `<details class="cc-rules"><summary>${esc(H.name)} 规则</summary><ul>
      <li><b>牌</b>：元素牌 ${H.elementSets} 组 × ${C.elements.length} 种洗混，每人开局 ${H.hand} 张、第 2–${H.rounds} 轮开始时各摸 ${H.draw} 张，每张只能用一次；玩家不出层牌——公共层牌 ${H.layerSets} 组 × ${C.layers.length} 张，每轮翻 ${H.layersPerRound} 张；天气每轮翻 ${H.weathersPerRound} 张，叠加。天气堆抽完时只把弃掉的洗回去。</li>
      <li><b>每轮</b>：（筹码不够的先决定借不借）① 庄家偷看天气堆顶，留在顶上或压到堆底（放哪公开）② 翻开第 1 张公共层牌，庄家左边两位下小盲 ${H.blinds[0]} × 轮数、大盲 ${H.blinds[1]} × 轮数（两人局庄家下小盲）③ 每人盖下 1 张元素牌 ④ 第一轮下注 ⑤ 翻开第 1 张天气 ⑥ 第二轮下注 ⑦ 同时翻开第 2 张层牌和第 2 张天气，亮牌比分。两轮下注都从庄家左边开始；庄家每轮顺时针轮换。</li>
      <li><b>计分</b>：你的元素牌对 2 张公共层牌分别计分求和（克制 +1 / 劣势 −1 / 其余 0，加两张天气的修正，修正直接相加不设上限）；最高分拿走底池，同分平分。微光反转克制表（能量除外），也反转另一张天气的修正（含给能量的、酸雨打装甲那一项），微光自己给能量的 +1 保留。</li>
      <li><b>下注</b>：过牌 / 跟注 / 加注 / 弃牌；加注至少等于上一次加注额，每个下注回合最多加注 ${H.maxRaises} 次；想押多少押多少，跟不起可以先借、全押（多押的部分开边池），或者弃牌；跟注后有 ${C.callWindowSec} 秒追加窗口，还可以加注或弃牌。弃牌的不参与比分。只按底池结算，不用分档赔付。</li>
      <li><b>相位</b>：在场上时这一轮的最低下注额翻倍。</li>
      <li><b>借贷</b>：${C.loan.unit} 枚一份，每借 ${C.loan.unit} 枚对局结束时还 ${C.loan.repay} 枚，借几次都行；输光了不借就出局。</li>
      <li><b>胜负</b>：${H.rounds} 轮后按最终筹码数（扣还借款之后）比，最多的赢。</li>
    </ul></details>`;
  }

  /* ---------- 牌桌 ---------- */
  const nameIn = (v, id) => (id === v.side ? "你" : (v.seats.find(s => s.id === id) || {}).name || id);
  function topHtml(T, v) {
    const S = T.state(), H = FH().HOLDEM_CONFIG;
    const status = v.over ? "对局结束" : `第 ${v.round} / ${v.rounds} 轮 · ${nameIn(v, v.dealer)}坐庄`;
    const head = `<b class="cc-brand">${esc(H.name)}</b><span class="cc-round">${esc(status)}</span>`;
    if (S.casino) return `${head}<span class="cc-role">${esc(S.casino.label || "赌场")} · 对手：${esc(levelName(S.level))} AI</span><span class="cc-spacer"></span>${T.btn("leave", "离桌", { title: S.casino.leaveTitle || "" })}`;
    return `${head}<span class="cc-role">${v.order.length} 人桌 · 对手：${esc(levelName(S.level))} AI</span><span class="cc-spacer"></span>${T.btn("setup", "换人数 / 难度")}${T.btn("title", "回到标题")}`;
  }
  /** 庄 / 小盲 / 大盲的小牌子 */
  const badges = (s) => [s.dealer ? "庄" : "", s.sb ? "小盲" : "", s.bb ? "大盲" : ""].filter(Boolean).map(x => `<i class="fh-badge">${x}</i>`).join("");
  function seatHtml(T, v, s) {
    const S = T.state(), turn = !v.over && v.waiting.indexOf(s.id) >= 0 && !(v.betting && v.betting.window);
    const status = s.out ? "出局" : s.folded ? "弃牌" : s.allIn ? "全押" : "";
    const backs = Array.from({ length: Math.min(s.handCount, 4) }, () => T.back({ cls: "fh-small" })).join("");
    return `<div class="fh-seat${turn ? " turn" : ""}${s.folded ? " folded" : ""}${s.out ? " out" : ""}" data-seat="${s.id}">
      <div class="fh-name"><b>${esc(s.name)}</b><small>${esc(levelName(S.levels[s.id]))} AI</small>${badges(s)}</div>
      ${T.chips(s.chips, { title: s.name + "的筹码", anim: T.bump("chips:" + s.id, s.chips) })}
      <small class="fh-bet">本轮押 ${s.bet}${status ? ` · ${status}` : ""}</small>
      <div class="cc-hand cc-hand-back fh-backs" title="手牌 ${s.handCount} 张">${backs}</div>
      <div class="fh-played">${s.played ? T.back({ cls: "fh-small cc-down" + (T.bump("thrown:" + s.id, v.round) ? " cc-thrown" : "") }) : `<span class="cc-empty">${s.out ? "" : "还没盖牌"}</span>`}</div>
      ${T.loanTag(s, s.name)}
    </div>`;
  }
  function boardHtml(T, v) {
    const S = T.state(), H = FH().HOLDEM_CONFIG, me = v.me, deal = !!S.anim.deal;
    const anim = { me: T.bump("myChips", me.chips), pot: T.bump("pot", v.pot), wx: T.bump("wx", v.round + ":" + v.weathers.join("+")) && v.weathers.length > 0 && !deal };
    const opps = v.seats.filter(s => s.id !== v.side).map(s => seatHtml(T, v, s)).join("");
    const layers = Array.from({ length: H.layersPerRound }, (_, i) => (v.layers[i] ? T.handCard(v.layers[i], { cls: "fh-layer" }) : T.back({ cls: "fh-hidden" }))).join("");
    const weathers = Array.from({ length: H.weathersPerRound }, (_, i) => (v.weathers[i]
      ? T.weatherCard(v.weathers[i], { cls: anim.wx && i === v.weathers.length - 1 ? "cc-flip" : "" }) : T.back({ cls: "fh-hidden fd-wback" }))).join("");
    const deck = Array.from({ length: Math.min(v.deckCount, 7) }, (_, i) => `<i style="--i:${i}"></i>`).join("");
    const last = v.weathers[v.weathers.length - 1];
    const flash = anim.wx ? `<div class="cc-flash" style="--c:${T.weatherColor(last)}" aria-hidden="true"></div>` : "";
    const playing = v.stage === "play" && v.myTurn;
    const hand = me.hand.map((c, i) => T.handCard(c, { act: playing ? "play" : null, tip: true, cls: (deal ? "cc-deal " : "") + (playing ? "cc-can" : ""), delay: deal ? i : null })).join("");
    return `${flash}<div class="fh-opps">${opps}</div>
      <div class="cc-center fh-center">
        <div class="fh-community">
          <div class="fh-group"><small>公共层牌</small><div class="fh-cards">${layers}</div></div>
          <div class="fh-group"><small>天气（叠加）</small><div class="fh-cards">${weathers}</div></div>
          <div class="cc-deck" title="天气堆还剩 ${v.deckCount} 张"><span class="cc-deckstack">${deck}</span><b>${v.deckCount}</b><small>天气堆</small></div>
          ${v.discards.length ? `<div class="cc-gone" title="弃掉的天气（天气堆抽完时洗回去）">${v.discards.map(T.miniWeather).join("")}</div>` : ""}
        </div>
        <div class="cc-pot${v.weathers.indexOf(CC().CC_CONFIG.allInWeather) >= 0 ? " allin" : ""}">
          ${T.chips(v.pot, { cls: "cc-potstack", title: "底池", label: "底池", anim: anim.pot })}
          <span class="cc-bets"><span>你本轮 ${me.bet}</span>${v.betting && v.betting.toCall ? `<span>要跟 ${v.betting.toCall}</span>` : ""}</span>
        </div>
      </div>
      <div class="cc-seat cc-me">
        ${T.chips(me.chips, { title: "你的筹码", anim: anim.me })}
        <div class="cc-hand">${hand || `<span class="cc-empty">手里没有牌</span>`}</div>
        <div class="cc-slot">${me.card ? T.back({ mine: me.card, cls: "cc-down" }) : `<span class="cc-empty">${me.out ? "出局了" : "还没盖牌"}</span>`}</div>
        <div class="cc-who"><b>你</b><span class="fh-badges">${badges(me)}</span>${me.folded ? "<small>弃牌了</small>" : me.allIn ? "<small>全押了</small>" : ""}${T.loanTag(me, "你")}</div>
      </div>`;
  }
  function stageControls(T, v) {
    if (v.stage === "peek" && v.peek) {
      return { p: `你坐庄：偷看到天气堆顶是〔${esc(wn(v.peek.card))}〕（只有你看得到）。留在顶上（这一轮第 1 张天气就是它），还是压到堆底？`,
        b: `<span class="fh-peek">${T.weatherCard(v.peek.card)}</span>` + T.btn("place", "留在顶上", { data: { where: "top" }, primary: true }) + T.btn("place", "压到堆底", { data: { where: "bottom" } }) };
    }
    if (v.stage === "play") return { p: `点一张元素牌盖下（每张整局只能用一次）。第 1 张公共层牌是〔${esc(v.layers.map(cn).join("、"))}〕，天气还没翻开。`, b: "" };
    return { p: "", b: "" };
  }
  function waitText(T, v) {
    if (v.stage === "play" && v.me.card) return "你已经盖下了牌，等其他人……";
    if (v.stage === "peek") return `${nameIn(v, v.dealer)}（庄家）在偷看天气堆顶……`;
    const who = v.waiting.find(id => id !== v.side);
    return who ? `${nameIn(v, who)}正在想……` : "等其他人……";
  }
  const streetText = (T, v) => `${v.stage === "bet1" ? "第一轮下注" : `第二轮下注（天气〔${ws(v.weathers)}〕）`}（从庄家左边起）`;
  function infoLine(T, v) {
    const parts = [`本轮最低下注 ${v.minBet} 枚`, `小盲 ${v.blinds[0]} / 大盲 ${v.blinds[1]}`];
    if (v.betting) parts.push(`加注 ${v.betting.raises}/${v.maxRaises}`);
    if (v.betting && v.betting.toCall) parts.push(`待跟 ${v.betting.toCall} 枚`);
    if (v.weathers.indexOf(CC().CC_CONFIG.allInWeather) >= 0) parts.push("相位：最低注翻倍");
    return `<p class="cc-info">${parts.join(" · ")}</p>`;
  }
  const seatName = (T, k) => { const v = T.view(); return v ? nameIn(v, k) : k; };

  /* ---------- 侧栏、结算 ---------- */
  /** 一轮的结果从你这边看 */
  function outcomeOf(r, side) {
    if (r.folded && r.folded.indexOf(side) >= 0) return { cls: "lose", text: "你弃牌" };
    if (!(r.shown && side in r.shown) && r.winners.indexOf(side) < 0 && r.outcome === "showdown") return { cls: "lose", text: "没参加（出局了）" };
    if (r.outcome === "fold") return r.winners[0] === side ? { cls: "win", text: "其他人都弃牌，底池归你" } : { cls: "lose", text: "别人拿走底池" };
    const main = r.pots[0] || { winners: [] };
    if (main.winners.indexOf(side) >= 0) return main.winners.length > 1 ? { cls: "tie", text: `你和别人平分主池（${main.winners.length} 人）` } : { cls: "win", text: "你拿走主池" };
    return r.pots.some(p => p.winners.indexOf(side) >= 0) ? { cls: "tie", text: "你只分到边池" } : { cls: "lose", text: "你没赢到" };
  }
  function sideHtml(T, v) {
    const rows = v.results.map(r => {
      const o = outcomeOf(r, v.side);
      return `<li class="cc-res ${o.cls}"><b>第 ${r.r} 轮</b><span>${esc(o.text)}</span><span class="cc-wxname">${esc(ws(r.weathers))}</span><span class="cc-delta">${T.signed(r.delta[v.side] || 0)}</span></li>`;
    }).join("");
    return `${T.chartBtn(`天气 ${ws(v.weathers)} · 实际得分`)}<h3>每轮结算</h3><ol class="cc-results">${rows || "<li class=\"cc-empty\">还没有结算</li>"}</ol>
      ${rulesHtml()}
      <h3>记录</h3><ul class="cc-log">${T.logHtml(v)}</ul>`;
  }
  function bannerHtml(T, r, v) {
    const o = outcomeOf(r, v.side);
    const big = { win: "你赢了", lose: o.text === "你弃牌" ? "你弃牌了" : "你输了", tie: "平分" }[o.cls];
    const n = (id) => nameIn(v, id);
    const shown = r.shown ? `<ul class="fh-shown">${Object.keys(r.shown).map(id => `<li class="${(r.pots[0] || { winners: [] }).winners.indexOf(id) >= 0 ? "win" : ""}">${esc(n(id))}〔${esc(cn(r.shown[id].card))}〕得 ${signed(r.shown[id].score)}</li>`).join("")}</ul>` : "";
    const pots = r.outcome === "fold" ? `其他人都弃牌，${n(r.winners[0])}拿走底池 ${r.pot} 枚（不亮牌）`
      : r.pots.map((p, i) => `${i ? `边池 ${i}` : "主池"} ${p.amount} 枚${p.winners.length > 1 ? `由${p.winners.map(n).join("、")}平分` : `归${n(p.winners[0])}`}`).join("；");
    return `<div class="cc-banner-card ${o.cls}" role="dialog" aria-label="第 ${r.r} 轮结算">
      <small>第 ${r.r} 轮结算 · 层牌 ${esc(r.layers.map(x => `〔${cn(x)}〕`).join(""))} · 天气 ${esc(ws(r.weathers))}</small>
      <h3>${big}</h3>
      ${shown}
      <p class="cc-tier">${esc(pots)}</p>
      <p class="cc-deltas"><span class="${(r.delta[v.side] || 0) >= 0 ? "up" : "down"}">你 ${T.signed(r.delta[v.side] || 0)} 枚</span></p>
      <div class="cc-btns">${T.btn("dismiss", v.over ? "看总结算" : "继续", { primary: true })}${T.bannerChartBtn()}</div>
    </div>`;
  }
  function finalHtml(T, v) {
    const S = T.state(), f = v.final || {}, me = v.side;
    const res = f.winners && f.winners.indexOf(me) >= 0 ? (f.winners.length > 1 ? "tie" : "win") : "lose";
    const big = { win: "这一局你赢了", lose: "这一局你输了", tie: "这一局你和别人并列第一" }[res];
    const rows = v.order.map(id => `<span class="${id === me ? ({ win: "up", lose: "down", tie: "" }[res]) : ""}">${esc(nameIn(v, id))} ${f.chips ? f.chips[id] : "?"} 枚${f.loans && f.loans[id] && f.loans[id].owe ? `（借 ${f.loans[id].loan}、还 ${f.loans[id].owe}）` : ""}${(f.out || []).indexOf(id) >= 0 ? " · 出局" : ""}</span>`).join("");
    return `<div class="cc-banner-card cc-final ${res}" role="dialog" aria-label="对局结束">
      <small>对局结束 · 打了 ${f.rounds} 轮</small>
      <h3>${big}</h3>
      <p class="cc-deltas fh-final">${rows}</p>
      <p class="cc-tier">按最终筹码数（扣还借款之后）比，最多的赢。</p>
      <div class="cc-btns">${S.casino
        ? `${T.btn("casinoAgain", esc(S.casino.againText || "再来一局"), { primary: true })}${T.bannerChartBtn()}${T.btn("leave", "离桌")}`
        : `${T.btn("again", "再来一局", { primary: true })}${T.btn("setup", "换人数 / 难度")}${T.bannerChartBtn()}${T.btn("title", "回到标题")}`}</div>
    </div>`;
  }

  /* ---------- 克制表、悬停预览：按场上的天气（两张都翻开时叠加）算实际得分 ---------- */
  // 结算横幅开着时按刚结算的那一轮的两张天气（叠加后的；下一轮的天气还没翻开）
  const wsOf = (v, banner) => (banner ? banner.weathers : v.weathers);
  const chart = (v, banner) => FH().chart(wsOf(v, banner));
  const chartKey = (v, banner) => (banner ? "r" + banner.r + ":" : "") + (wsOf(v, banner).join("+") || "none");
  function tipHtml(T, card, v) {
    const c = FH().cardChart(card, v.weathers), U = UI_CONFIG.tip;
    const head = `${U.head} · ${v.weathers.length ? `天气 ${ws(v.weathers)}` : U.unrevealed}`;
    const now = v.layers.length ? `对已翻开的公共层牌${v.layers.map(x => `〔${cn(x)}〕`).join("")}合计 ${signed(FH().handScore(card, v.layers, v.weathers))}。` : "";
    return root.FluxUI.tipHtml(card, c, head, `${now}${U.foot}`);
  }

  /* ---------- 自己的按钮 ---------- */
  function click(T, act, d) {
    const S = T.state();
    switch (act) {
      case "set": SETUP[d.key] = d.key === "players" ? Number(d.val) : d.val; T.renderSetup(); return true;
      case "start": T.start({ players: SETUP.players, level: SETUP.level }); return true;
      case "again": T.start({ players: S ? S.game.order.length : SETUP.players, level: S ? S.level : SETUP.level }); return true;
      case "place": T.act({ type: "place", where: d.where }); return true;
      case "play": T.act({ type: "play", card: d.card }); return true;
    }
    return false;
  }

  if (!root.FluxUI) return;
  const T = root.FluxUI.table({
    key: "fh", screen: "fluxHoldem", rules: FH, ai: AI, name: () => FH().HOLDEM_CONFIG.name,
    begin, setupHtml, topHtml, boardHtml, sideHtml, bannerHtml, finalHtml, stageControls, waitText, streetText, infoLine, seatName,
    weatherOf: (v) => v.weathers[v.weathers.length - 1] || null, chart, chartKey, tipHtml, click,
    loanNeedText: () => "该下的盲注 + 最低下注额",
    bustText: "你已经输光了，不借就出局。", bustNoLoan: "不借（出局）",
    foldTitle: "弃牌：不参与这一轮比分，已经押下去的筹码留在底池"
  });
  root.FluxHoldemUI = Object.assign({}, T, { UI_CONFIG, SETUP, outcomeOf });
})(typeof window !== "undefined" ? window : globalThis);
