/* Flux Hold'em（#488）· 界面：标题 → 本地玩法 → Flux Hold'em → 人数、难度 → 牌桌（界面 Akane）
 * 名字读 FluxHoldem.HOLDEM_CONFIG.name（菜单按钮、设置页、牌桌标题、规则说明）。
 * 规则在 flux-holdem.js，AI 在 flux-holdem-ai.js；画面只拿 FluxHoldem.view(对局, 你)，人和 AI 看到的是同一份东西。
 * 两张新牌桌共用的零件（AI 排着走、借贷和下注栏（多一个「全押」）、跟注后追加窗口的倒计时、克制表、悬停预览）在 flux-ui.js；牌面借 High Flux 的。
 * 桌上：上面一排是对手（名字、AI 难度、庄 / 小盲 / 大盲、筹码、这一轮押了多少、弃牌 / 全押 / 出局、手牌张数、盖了没有）；
 *   中间是 2 张公共层牌、2 张天气（翻开一张亮一张，没翻的是牌背）、天气堆和弃掉的天气、底池；下面是自己的筹码和手牌（盖牌时点一张）。
 *   自己坐庄时操作栏里能看到偷看的那张（只有自己看得到），选「留在顶上」或「压到堆底」。
 * 结算横幅：亮牌——每人出的牌和得分、主池 / 边池归谁（平分写清楚）、自己的筹码变动；翻到相位写没弃牌的人全押、押到多少，
 *   全押后同分写底池滚到下一轮（主人 10/30：相位 = 全押）。下一轮底池旁边写「含滚存 N 枚」，提示行也写。
 * 克制表（侧栏、横幅上的按钮）和手里元素牌的悬停预览都按场上的天气（两张都翻开时叠加）算实际得分；预览另写对已翻开的公共层牌的得分合计。
 * 结算前的过渡（主人 10/30 试玩反馈，#525；计时同 High Flux，flux-ui.js）：最后一步 → 规则层自己翻的牌一张一步（第 1 张天气、第 2 张层牌、第 2 张天气；
 *   相位全押一口气翻完的也一张一张翻）→ 亮牌（没弃牌的人盖下的牌翻过来）→ 判定中 → 结算横幅；其他人都弃牌直接赢的只有最后一步。
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
    levelNames: { easy: "简单", normal: "普通", hard: "困难" },
    // 结算前的过渡（#525）：时长读 High Flux 的 CounterCardsUI.UI_CONFIG.settle，这里是 Hold'em 自己的字（判定中那一行的说明）
    settle: { judgeNote: "每人的元素牌对 2 张公共层牌计分求和（两张天气叠加），最高分拿走底池" }
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
      <li><b>每轮</b>：（筹码不够的先决定借不借）① 庄家偷看天气堆顶，留在顶上或压到堆底（放哪公开）② 翻开第 1 张公共层牌，庄家左边两位下小盲 ${H.blinds[0]} × 轮数、大盲 ${H.blinds[1]} × 轮数（两人局庄家下小盲）③ 每人盖下 1 张元素牌 ④ 第一轮下注 ⑤ 翻开第 1 张天气 ⑥ 第二轮下注 ⑦ 同时翻开第 2 张层牌和第 2 张天气，亮牌比分。${H.revealAll ? "结算时亮出每个人这一轮盖下的牌（弃牌的、其他人都弃牌直接赢的那一轮也亮，弃牌的不计分）。" : ""}两轮下注都从庄家左边开始；庄家每轮顺时针轮换。</li>
      <li><b>计分</b>：你的元素牌对 2 张公共层牌分别计分求和（克制 +1 / 劣势 −1 / 其余 0，加两张天气的修正，修正直接相加不设上限）；最高分拿走底池，同分平分。微光反转克制表（能量除外），也反转另一张天气的修正（含给能量的、酸雨打装甲那一项），微光自己给能量的 +1 保留。</li>
      <li><b>下注</b>：过牌 / 跟注 / 加注 / 弃牌；加注至少等于上一次加注额，每个下注回合最多加注 ${H.maxRaises} 次；想押多少押多少，跟不起可以先借、全押（多押的部分开边池），或者弃牌；跟注后有 ${C.callWindowSec} 秒追加窗口，还可以加注或弃牌。弃牌的不参与比分。只按底池结算，不用分档赔付。</li>
      <li><b>${esc(wn(C.allInWeather))}</b>：翻开时没弃牌的人全押（上限 = 没弃牌的人里筹码最少那位的全部筹码，这一轮已下的 + 手上的），不再下注，直接比分；第 2 张天气（亮牌时翻开）是${esc(wn(C.allInWeather))}：比分之前补押到这个数。全押后同分，底池留在桌上滚到下一轮；最后一轮同分的人平分。</li>
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
    // 联机牌桌（#526）：who 写这一桌是谁（多人桌写几名玩家 + AI），另有「返回赌场」
    if (S.casino) return `${head}<span class="cc-role">${esc(S.casino.label || "赌场")} · ${esc(S.casino.who || `对手：${levelName(S.level)} AI`)}</span><span class="cc-spacer"></span>${T.casinoBtns()}`;
    return `${head}<span class="cc-role">${v.order.length} 人桌 · 对手：${esc(levelName(S.level))} AI</span><span class="cc-spacer"></span>${T.btn("setup", "换人数 / 难度")}${T.btn("title", "回到标题")}`;
  }
  /** 庄 / 小盲 / 大盲的小牌子 */
  const badges = (s) => [s.dealer ? "庄" : "", s.sb ? "小盲" : "", s.bb ? "大盲" : ""].filter(Boolean).map(x => `<i class="fh-badge">${x}</i>`).join("");
  function seatHtml(T, v, s) {
    const S = T.state(), turn = !v.over && v.waiting.indexOf(s.id) >= 0 && !(v.betting && v.betting.window);
    const status = s.out ? "出局" : s.folded ? "弃牌" : s.allIn ? "全押" : "";
    const backs = Array.from({ length: Math.min(s.handCount, 4) }, () => T.back({ cls: "fh-small" })).join("");
    // 结算前的过渡里亮牌（s.shown）：盖下的那张翻过来
    const flip = T.bump("shown:" + s.id, s.shown ? v.round + ":" + s.shown : "") && !!s.shown;
    const played = s.shown ? T.handCard(s.shown, { cls: "fh-small fh-face" + (flip ? " cc-flip" : "") })
      : s.played ? T.back({ cls: "fh-small cc-down" + (T.bump("thrown:" + s.id, v.round) ? " cc-thrown" : "") }) : `<span class="cc-empty">${s.out ? "" : "还没盖牌"}</span>`;
    return `<div class="fh-seat${turn ? " turn" : ""}${s.folded ? " folded" : ""}${s.out ? " out" : ""}" data-seat="${s.id}">
      <div class="fh-name"><b>${esc(s.name)}</b><small>${esc(S.seatTag ? S.seatTag(s.id) : `${levelName(S.levels[s.id])} AI`)}</small>${badges(s)}</div>
      ${T.chips(s.chips, { title: s.name + "的筹码", anim: T.bump("chips:" + s.id, s.chips), cls: T.collecting(s.id) ? "cc-collect" : "" })}
      <small class="fh-bet">本轮押 ${s.bet}${status ? ` · ${status}` : ""}</small>
      <div class="cc-hand cc-hand-back fh-backs" title="手牌 ${s.handCount} 张">${backs}</div>
      <div class="fh-played">${played}</div>
      ${T.actedTag(s.id)}${T.loanTag(s, s.name)}
    </div>`;
  }
  function boardHtml(T, v) {
    const S = T.state(), H = FH().HOLDEM_CONFIG, me = v.me, deal = !!S.anim.deal;
    // 结算前的过渡里又翻开一张（第 2 张层牌也翻牌）、亮牌时自己那张翻过来；判定中亮出来的牌轻轻抖、底池发光
    const anim = { me: T.bump("myChips", me.chips), pot: T.bump("pot", v.pot), wx: T.bump("wx", v.round + ":" + v.weathers.join("+")) && v.weathers.length > 0 && !deal,
      ly: T.bump("ly", v.round + ":" + v.layers.join("+")) && v.layers.length > 1 && !deal,
      mine: T.bump("myShown", me.shown ? v.round + ":" + me.shown : "") && !!me.shown };
    const J = T.judging() ? " cc-judging" : "";
    const opps = v.seats.filter(s => s.id !== v.side).map(s => seatHtml(T, v, s)).join("");
    const layers = Array.from({ length: H.layersPerRound }, (_, i) => (v.layers[i]
      ? T.handCard(v.layers[i], { cls: "fh-layer" + (anim.ly && i === v.layers.length - 1 ? " cc-flip" : "") }) : T.back({ cls: "fh-hidden" }))).join("");
    const weathers = Array.from({ length: H.weathersPerRound }, (_, i) => (v.weathers[i]
      ? T.weatherCard(v.weathers[i], { cls: anim.wx && i === v.weathers.length - 1 ? "cc-flip" : "" }) : T.back({ cls: "fh-hidden fd-wback" }))).join("");
    const deck = Array.from({ length: Math.min(v.deckCount, 7) }, (_, i) => `<i style="--i:${i}"></i>`).join("");
    const last = v.weathers[v.weathers.length - 1];
    const flash = anim.wx ? `<div class="cc-flash" style="--c:${T.weatherColor(last)}" aria-hidden="true"></div>` : "";
    const playing = v.stage === "play" && v.myTurn;
    const hand = me.hand.map((c, i) => T.handCard(c, { act: playing ? "play" : null, tip: true, cls: (deal ? "cc-deal " : "") + (playing ? "cc-can" : ""), delay: deal ? i : null })).join("");
    const slot = me.shown ? T.handCard(me.shown, { cls: "cc-down" + (anim.mine ? " cc-flip" : "") })
      : me.card ? T.back({ mine: me.card, cls: "cc-down" }) : `<span class="cc-empty">${me.out ? "出局了" : "还没盖牌"}</span>`;
    return `${flash}<div class="fh-opps${J}">${opps}</div>
      <div class="cc-center fh-center">
        <div class="fh-community">
          <div class="fh-group"><small>公共层牌</small><div class="fh-cards">${layers}</div></div>
          <div class="fh-group"><small>天气（叠加）</small><div class="fh-cards">${weathers}</div></div>
          <div class="cc-deck" title="天气堆还剩 ${v.deckCount} 张"><span class="cc-deckstack">${deck}</span><b>${v.deckCount}</b><small>天气堆</small></div>
          ${v.discards.length ? `<div class="cc-gone" title="弃掉的天气（天气堆抽完时洗回去）">${v.discards.map(T.miniWeather).join("")}</div>` : ""}
        </div>
        <div class="cc-pot${J}">
          ${T.chips(v.pot, { cls: "cc-potstack", title: "底池", label: "底池", anim: anim.pot })}
          ${v.carry ? `<small class="cc-roll">含滚存 ${v.carry.amount} 枚</small>` : ""}
          <span class="cc-bets"><span>你本轮 ${me.bet}</span>${v.betting && v.betting.toCall ? `<span>要跟 ${v.betting.toCall}</span>` : ""}</span>
          ${J ? T.judgeTag() : ""}
        </div>
      </div>
      <div class="cc-seat cc-me">
        ${T.chips(me.chips, { title: "你的筹码", anim: anim.me, cls: T.collecting(v.side) ? "cc-collect" : "" })}
        <div class="cc-hand">${hand || `<span class="cc-empty">手里没有牌</span>`}</div>
        <div class="cc-slot${J}">${slot}</div>
        <div class="cc-who"><b>你</b><span class="fh-badges">${badges(me)}</span>${me.folded ? "<small>弃牌了</small>" : me.allIn ? "<small>全押了</small>" : ""}${T.loanTag(me, "你")}${T.actedTag(v.side)}</div>
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
    if (v.carry) parts.push(`底池含上一轮滚存 ${v.carry.amount} 枚`);
    if (v.betting) parts.push(`翻到${wn(CC().CC_CONFIG.allInWeather)}：没弃牌的人全押`);
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
    // 相位全押后同分：主池不分，滚到下一轮
    if (main.carried && (main.tied || []).indexOf(side) >= 0) return { cls: "tie", text: "同分，底池滚到下一轮", carry: true };
    if (main.winners.indexOf(side) >= 0) return main.winners.length > 1 ? { cls: "tie", text: `你和别人平分主池（${main.winners.length} 人）` } : { cls: "win", text: "你拿走主池" };
    return r.pots.some(p => p.winners.indexOf(side) >= 0) ? { cls: "tie", text: "你只分到边池" } : { cls: "lose", text: main.carried ? "你没赢到（底池滚到下一轮）" : "你没赢到" };
  }
  /** 一轮的主池 / 边池归谁（横幅、和规则层的结算记录同一种说法） */
  function potsText(r, n) {
    const carryIn = r.carryIn ? `（含上一轮滚存的 ${r.carryIn} 枚）` : "";
    if (r.outcome === "fold") return `其他人都弃牌，${n(r.winners[0])}拿走底池 ${r.pot} 枚${carryIn}${r.played ? "" : "（不亮牌）"}`;
    return r.pots.map((p, i) => `${i ? `边池 ${i}` : "主池"} ${p.amount} 枚`
      + (p.carried ? `：${p.tied.map(n).join("、")}同分（相位全押），滚到下一轮`
        : p.winners.length > 1 ? `由${p.winners.map(n).join("、")}平分${r.allIn ? "（相位全押，最后一轮不再滚存）" : ""}` : `归${n(p.winners[0])}`)
      + (i === 0 ? carryIn : "")).join("；");
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
    const big = o.carry ? o.text : { win: "你赢了", lose: o.text === "你弃牌" ? "你弃牌了" : "你输了", tie: "平分" }[o.cls];
    const n = (id) => nameIn(v, id);
    const main = r.pots[0] || { winners: [] };
    // 比分的人写得分；弃牌的人（和其他人都弃牌直接赢的那一轮）只亮牌（r.played，主人 10/31）
    const rows = (r.shown ? Object.keys(r.shown).map(id => `<li class="${main.winners.indexOf(id) >= 0 ? "win" : (main.tied || []).indexOf(id) >= 0 ? "tie" : ""}">${esc(n(id))}〔${esc(cn(r.shown[id].card))}〕得 ${signed(r.shown[id].score)}</li>`) : [])
      .concat(r.played ? v.order.filter(id => r.played[id] && !(r.shown && r.shown[id])).map(id =>
        `<li class="${r.folded.indexOf(id) >= 0 ? "folded" : main.winners.indexOf(id) >= 0 ? "win" : ""}">${esc(n(id))}〔${esc(cn(r.played[id]))}〕${r.folded.indexOf(id) >= 0 ? "弃牌" : ""}</li>`) : []);
    const shown = rows.length ? `<ul class="fh-shown">${rows.join("")}</ul>` : "";
    const phase = r.allIn ? `<p class="cc-tier">翻到${esc(wn(CC().CC_CONFIG.allInWeather))}（第 ${r.phaseAt} 张天气）：没弃牌的人全押，各押到 ${r.cap} 枚</p>` : "";
    return `<div class="cc-banner-card ${o.cls}" role="dialog" aria-label="第 ${r.r} 轮结算">
      <small>第 ${r.r} 轮结算 · 层牌 ${esc(r.layers.map(x => `〔${cn(x)}〕`).join(""))} · 天气 ${esc(ws(r.weathers))}</small>
      <h3>${big}</h3>
      ${shown}
      ${phase}
      <p class="cc-tier">${esc(potsText(r, n))}</p>
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
        ? T.casinoFinalBtns()
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

  /* ---------- 结算前的过渡（主人 10/30 试玩反馈，#525）：最后一步 → 又翻开的牌一张一步 → 亮牌 → 判定中 → 结算横幅 ----------
   * 记录里这一轮的结算在 from（做最后一步之前记录有几条）和结算那一条之间：先是最后一步（下注、关窗）那几条，后面是规则层自己翻的牌——
   * 第一轮下注打完翻第 1 张天气（是相位：没弃牌的人全押），亮牌时同时翻第 2 张层牌和第 2 张天气（第 2 张是相位：补押到全押的数目）。
   * 一张牌一步：最后一步做完马上翻的第一张和最后一步算同一步，之后每张另起一步，相位全押一口气翻完剩下的也一张一张翻；
   * 亮牌：没弃牌的人盖下的牌翻过来（不写分，分在结算横幅上）。其他人都弃牌直接赢的只有最后一步，不判定。
   * 每一步（frames）记下：翻到第几张层牌 / 天气（nL / nW）、天气堆剩几张（deck；抽完洗回去的那一下算在下一张天气那一步，wiped = 弃掉的那几张洗回去了）、
   * 相位全押了没有（allIn）、记录写到哪（cut）、操作栏写什么（lines） */
  const AUTO_LOG = ["weather", "reshuffle", "allIn", "reveal"];   // 规则层自己翻牌、全押的那几种记录
  function settleBeats(T, pre, now, res) {
    const CS = root.CounterCardsUI.settle, log = now.log, from = pre.log.length;
    const end = log.findIndex((e, i) => i >= from && e.t === "result" && e.res && e.res.r === res.r);
    const logEnd = end < 0 ? log.length : end;
    let k = from;
    while (k < logEnd && AUTO_LOG.indexOf(log[k].t) < 0) k++;
    const steps = CS.lastSteps(log, from, k);   // 最后一步：追加窗口关了才结算的，从开窗的那一下跟注写起（同 High Flux）
    let cur = { kind: "last", nL: pre.layers.length, nW: pre.weathers.length, deck: pre.deckCount, wiped: false, allIn: false, flipped: false, lines: steps.map(e => e.text), cut: k };
    const frames = [cur];
    let pend = null, pendAt = 0;   // 天气堆抽完、洗回去的那一条（和它在记录里的位置）：算在下一张天气那一步
    const fresh = () => { if (cur.flipped) { cur = Object.assign({}, cur, { kind: "flip", flipped: false, lines: [] }); frames.push(cur); } };
    const drawWeather = (text) => {
      fresh();
      if (pend) { cur.deck = pend.count; cur.wiped = true; cur.lines.push(pend.text); pend = null; }
      cur.nW += 1; cur.deck -= 1; cur.flipped = true; cur.lines.push(text);
    };
    for (let i = k; i < logEnd; i++) {
      const e = log[i];
      if (e.t === "reshuffle") { pend = e; pendAt = i; continue; }
      if (e.t === "weather" && e.weather) drawWeather(e.text);
      else if (e.t === "reveal") {
        // 规则上第 2 张层牌和第 2 张天气同时翻开（中间不下注），桌上一张一步：先层牌、再天气（这一条记录写着两张，等天气那一步才进记录）
        if (e.layer) { fresh(); cur.nL += 1; cur.flipped = true; cur.lines.push(`翻开第 2 张公共层牌〔${cn(e.layer)}〕。`); cur.cut = pend ? pendAt : i; }
        if (e.weather) drawWeather(`翻开第 2 张天气〔${wn(e.weather)}〕。`);
        else if (!e.layer) cur.lines.push(e.text);
      } else {
        if (e.t === "allIn") cur.allIn = true;
        cur.lines.push(e.text);
      }
      cur.cut = i + 1;
    }
    // 亮牌：比分的人；每轮亮出所有人这一轮盖下的牌时（res.played，主人 10/31）弃牌的、其他人都弃牌直接赢的那一轮也亮
    const shownIds = res.played ? now.order.filter(id => res.played[id]) : res.outcome === "showdown" ? Object.keys(res.shown) : [];
    if (shownIds.length) {
      const cardOf = (id) => (res.played ? res.played[id] : res.shown[id].card);
      const cards = shownIds.map(id => `${nameIn(now, id)}〔${cn(cardOf(id))}〕${res.folded.indexOf(id) >= 0 ? "（弃牌）" : ""}`).join("、");
      frames.push(cur = Object.assign({}, cur, { kind: "show", flipped: false, lines: [`亮牌：${cards}。`], cut: logEnd }));
    }
    // 筹码：相位全押之前那几步照「最后一步做完」（做之前的画面 + 这一步跟注 / 全押推进底池的），之后照「结算之前」（这一轮下注额 res.bets、手上 = 结算后 − 分到的）。
    // 这一段没有相位全押就都照「结算之前」（这时两样一样）
    const paid = {};
    log.slice(from, k).forEach(e => { if (e.t === "bet" && (e.op === "call" || e.op === "allIn") && e.amount) paid[e.by] = (paid[e.by] || 0) + e.amount; });
    const won = (id) => res.pots.reduce((t, p) => t + ((p.shares && p.shares[id]) || 0), 0);
    const before = { bet: {}, chips: {} }, after = { bet: {}, chips: {} };
    pre.seats.forEach(s => {
      before.bet[s.id] = s.bet + (paid[s.id] || 0); before.chips[s.id] = s.chips - (paid[s.id] || 0);
      after.bet[s.id] = res.bets[s.id]; after.chips[s.id] = res.chips[s.id] - won(s.id);
    });
    const anyAllIn = frames.some(f => f.allIn);
    frames.forEach(f => { f.money = !anyAllIn || f.allIn ? after : before; });
    return { beats: frames.map(f => f.kind), frames, texts: frames.map(f => f.lines.join(" ")), judge: res.outcome !== "fold", acted: CS.actedOf(steps) };
  }
  /** 过渡中的画面（第 st.at 步；判定中照最后一步）：规则层已经结算完、开了下一轮，桌上停在结算之前——
   *  这一轮的庄 / 盲注、手牌和盖下的牌、轮数照做最后一步之前的画面；公共层牌、天气翻到这一步；筹码照这一步（见 settleBeats）；
   *  亮牌那一步起没弃牌的人的牌翻过来（shown）；记录、每轮结算里还没有这一轮的结果 */
  function settleView(T, v, st) {
    const f = st.frames[st.at], r = st.res, pre = st.pre, m = f.money, show = f.kind === "show";
    const seat = (s) => {
      const folded = r.folded.indexOf(s.id) >= 0, chips = m.chips[s.id], bet = m.bet[s.id];
      return Object.assign({}, s, { chips, bet, st: 0, folded, allIn: s.allIn || (!folded && !s.out && chips <= 0 && bet > 0),
        shown: !show ? null : r.played ? r.played[s.id] || null : r.shown && r.shown[s.id] ? r.shown[s.id].card : null });
    };
    const seats = pre.seats.map(seat);
    return Object.assign({}, v, {
      round: r.r, stage: "settle", over: false, waiting: [], myTurn: false, legal: [], betting: null, loanAsk: null, peek: null, final: null,
      dealer: pre.dealer, sb: pre.sb, bb: pre.bb, blinds: pre.blinds, minBet: pre.minBet,
      layers: r.layers.slice(0, f.nL), usedLayers: pre.usedLayers, layerDeckCount: pre.layerDeckCount, elementDeckCount: pre.elementDeckCount,
      weathers: r.weathers.slice(0, f.nW), deckCount: f.deck, discards: f.wiped ? [] : pre.discards,
      pot: seats.reduce((t, s) => t + s.bet, 0) + (r.carryIn || 0), carry: pre.carry,
      me: seat(pre.me), seats,
      results: v.results.slice(0, -1), log: v.log.slice(0, f.cut)
    });
  }
  /** 弹横幅时筹码「收进来」的：分到池子的人（滚到下一轮的池子没人分） */
  const settleCollect = (T, r) => (r.pots || []).reduce((out, p) => out.concat(Object.keys(p.shares || {}).filter(id => p.shares[id] > 0 && out.indexOf(id) < 0)), []);

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
    settle: { beats: settleBeats, view: settleView, collect: settleCollect, note: UI_CONFIG.settle.judgeNote },
    loanNeedText: () => "该下的盲注 + 最低下注额",
    bustText: "你已经输光了，不借就出局。", bustNoLoan: "不借（出局）",
    foldTitle: "弃牌：不参与这一轮比分，已经押下去的筹码留在底池"
  });
  root.FluxHoldemUI = Object.assign({}, T, { UI_CONFIG, SETUP, outcomeOf });
})(typeof window !== "undefined" ? window : globalThis);
