/* High Flux 黑市玩法：猜大猜小（#489）· 界面：标题 → 本地玩法 → 猜大猜小 → 选桌 → 牌桌；赌命桌（长线养成 / 跑团接进来）
 * 规则在 counter-cards-guess.js；画面只拿 CounterCardsGuess.view(这一手, 你)，没翻开的牌根本不在里面。
 * 牌面、筹码堆、按钮借用 High Flux 的（counter-cards-ui.js · cardHtml / backHtml / chipsHtml / weatherMods，counter-cards.css），
 * 侧栏的记录贴底也借（logScroll / stickLog）；自己的布局在 counter-cards-guess.css。
 * 侧栏：每手结算、记录都按先后排，最新的在最下面（同 High Flux，#499）。
 * 桌上：庄家盖着的三张牌（元素 / 天气 / 层牌，翻开一张亮一张，天气翻开有天气特效）；赔率表 5 格（−2 … +2：赔率、「k / N 种」，
 *   不开盘的格子灰掉写「不开」）。轮到你押时点开盘的格子加进这一轮的押注（默认最低注，− / + 调），「押注」一次交上去；
 *   押过的注摆在格子上，写锁定的赔率。第一轮「不押」= 这一手后面都不能押（按钮上写清楚）。
 * 结算横幅：结果、三张牌、押中几格、连本带利拿回多少、这一手净输赢（含入场费）。
 * 本地试玩：坐下拿 UI_CONFIG.startChips 枚筹码（null = 和 High Flux 的开局筹码一样），一手接一手，筹码带到下一手；
 *   交不起入场费就回设置页重新坐下。庄家是 AI（筹码无限，不用做决定）。
 * 赌命桌（startLife）：押注的角色只给名字——界面根本拿不到坚毅，所以不管还剩多少，按钮、提示、能押的格子都一模一样
 *   （不会变灰、不会写「坚毅不足」、不会少几个选项）。每格写固定代价「押上 1 点坚毅」（规则文字）；结算横幅只写「坚毅受创」，
 *   不写扣了多少、还剩多少。扣坚毅、发奖、真死由接进来的那一边做（opt.settle），横幅只照它说的写「永久死亡」。
 * 页面骨架在 game.html 的 #scr-ccg；没有 Screens（测试里）时自己切 hidden。
 *
 *   CounterCardsGuessUI.open()                                         打开设置页（选桌）
 *   CounterCardsGuessUI.start({ table: "street", chips: 50, seed, deals })   直接坐下开一手（deals：测试用，按顺序指定每一手的三张牌）
 *   CounterCardsGuessUI.startLife({ seat: { id, name }, settle(bill) → { dead, notes }, back(), seed, deals })   坐上赌命桌
 */
(function (root) {
  "use strict";

  const UI_CONFIG = {
    startChips: null,      // 本地试玩坐下拿几枚筹码；null = 和 High Flux 一样（CC_CONFIG.startChips）
    logLines: 14,          // 侧栏记录显示最近几条
    historyLines: 10,      // 侧栏「每手结算」显示最近几手
    // 每一轮下注时桌上是什么情况（提示语）
    roundText: { 1: "三张都盖着", 2: "元素翻开了", 3: "天气也翻开了，只剩层牌" },
    // 赌命桌的字：结算只写「坚毅受创」，不写数字
    life: { hurt: "坚毅受创", safe: "坚毅无损", dead: "坚毅耗尽——永久死亡", online: "联机不开赌命桌" }
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
  /** 现在开着联机房间（主持人或玩家）或者本机热座：赌命桌不开（#489：联机对赌不开） */
  const onlineNow = () => {
    try {
      if (root.OnlineGame && root.OnlineGame.getView && root.OnlineGame.getView().active) return true;
      return !!(root.HotseatGame && root.HotseatGame.isActive && root.HotseatGame.isActive());
    } catch (e) { return false; }
  };

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
  let S = null;   // { table, chips, seed, n（第几手）, hand, draft（这一轮还没交的押注 { 结果: 押多少 }）, msg, banner, last（上次画的，放动画用）, history, deals,
                  //   life（赌命桌才有：{ seat: { id, name }, settle, back, outcome（这一手结算后接入层说的：{ dead, notes }）, dead }）}
  let bound = false;
  const meId = () => (S && S.life ? S.life.seat.id : ME);

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
    ["scr-title", "scr-run", "scr-trpg"].forEach(id => { const el = $(id); if (el) el.hidden = true; });
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
    if (table === G().GUESS_CONFIG.life.id) throw new Error("赌命桌从长线养成 / 跑团进（startLife）");
    SETUP.table = table;
    S = { table, chips: opt.chips != null ? Math.max(0, Math.floor(Number(opt.chips) || 0)) : startChips(), seed: seedOf(opt), n: 0, hand: null, draft: {}, msg: "",
      banner: false, last: {}, anim: {}, history: [], deals: (opt.deals || []).slice(), life: null };
    enterScreen();
    show("game");
    if (!deal()) { renderSetup(); show("setup"); return null; }
    render();
    return S.hand;
  }
  /** 坐上赌命桌（长线养成 / 跑团接进来）：
   *  opt.seat = { id, name }（押注的角色：只要 id 和名字，不带坚毅——界面根本拿不到）；
   *  opt.settle(bill) → { dead, notes }：每一手结算后由接入的那一边扣坚毅、发奖（bill = CounterCardsGuess.lifeBill，界面不看里面的数）；
   *  opt.back()：离桌回到原来的画面（没给就回标题）；opt.dealer：谁当庄（跑团是主持人，默认黑市庄家）；opt.seed、opt.deals（测试用）。
   *  联机开着房间 / 本机热座时不开 */
  function startLife(opt) {
    opt = opt || {};
    if (onlineNow()) throw new Error(UI_CONFIG.life.online);
    if (!opt.seat || opt.seat.id == null) throw new Error("赌命桌要有押注的角色");
    bind();
    S = { table: G().GUESS_CONFIG.life.id, chips: null, seed: seedOf(opt), n: 0, hand: null, draft: {}, msg: "", banner: false, last: {}, anim: {}, history: [],
      deals: (opt.deals || []).slice(),
      life: { seat: { id: String(opt.seat.id), name: String(opt.seat.name || opt.seat.id) }, dealer: opt.dealer ? String(opt.dealer) : null,
        settle: opt.settle || null, back: opt.back || null, outcome: null, dead: false } };
    enterScreen();
    show("game");
    deal();
    render();
    return S.hand;
  }
  function seedOf(opt) { return String(opt.seed || ("ccg" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36))); }
  /** 开下一手：普通桌的入场费从带上桌的筹码里扣（交不起返回 false）；赌命桌押注的角色已经死了也返回 false */
  function deal() {
    const t = G().tableOf(S.table);
    if (S.life) {
      if (S.life.dead) return false;
    } else if (S.chips < t.entry) { S.msg = `筹码不够入场费 ${t.entry} 枚`; return false; }
    S.n += 1;
    const d = S.deals.length ? S.deals.shift() : null;
    const seat = S.life ? { id: S.life.seat.id, name: S.life.seat.name } : { id: ME, name: "你", chips: S.chips };
    S.hand = G().newHand({ seed: S.seed + "|" + S.n, table: S.table, players: [seat], deal: d || undefined });
    S.draft = {}; S.msg = ""; S.banner = false; S.last.shown = null; S.anim = { deal: true };
    if (S.life) S.life.outcome = null;
    sync();
    return true;
  }
  /** 这一手的筹码写回带上桌的筹码；结算了记一笔。赌命桌：结算了把账交给接入的那一边（扣坚毅、发奖、真死），记下它说的结果 */
  function sync() {
    const h = S.hand, me = h.players[0];
    if (!S.life) S.chips = me.chips;
    if (!h.over || S.banner) return;
    S.banner = true;
    if (S.life) {
      const bill = G().lifeBill(h, me.id);
      let out = null;
      try { out = S.life.settle ? S.life.settle(bill) : null; } catch (e) { S.msg = e.message; }
      S.life.outcome = { dead: !!(out && out.dead), notes: ((out && out.notes) || []).map(String) };
      if (S.life.outcome.dead) S.life.dead = true;
      S.history.push({ n: S.n, score: h.result.score, bet: me.slips.length > 0, hits: me.slips.filter(x => x.win).length, hurt: !!me.hurt, dead: S.life.dead });
      return;
    }
    S.history.push({ n: S.n, score: h.result.score, net: me.net, bet: me.slips.length > 0 });
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
  /** 离开赌命桌：这一手押了还没结算的不算（规则层只在结算时出账，接入层什么都没扣），回到原来的画面 */
  function leaveLife() {
    const back = S && S.life && S.life.back;
    leave();
    S = null;
    if (back) back(); else toTitle();
  }

  /* ---------- 押注：先在画面上攒好这一轮押哪几格，「押注」一次交上去 ---------- */
  const betOpt = (v) => v.legal.find(o => o.type === "bet") || null;
  const draftTotal = () => Object.keys(S.draft).reduce((s, k) => s + S.draft[k], 0);
  function humanAct(a) {
    if (!S || !S.hand || S.hand.over) return;
    try { G().act(S.hand, meId(), a); } catch (e) { S.msg = e.message; render(); return; }
    S.draft = {}; S.msg = "";
    sync();
    render();
  }
  function pick(result) {
    const v = G().view(S.hand, meId()), o = betOpt(v);
    if (!v.myTurn || !o) return;
    const cell = o.cells.find(x => x.result === result);
    if (!cell) return;
    if (S.draft[result] != null) delete S.draft[result];
    else if (S.life) S.draft[result] = o.stake;   // 赌命桌：每格押上固定点数，不看还剩多少
    else if (draftTotal() + o.min > o.max) { S.msg = `筹码不够再押一格（每格至少 ${o.min} 枚）`; render(); return; }
    else S.draft[result] = o.min;
    S.msg = "";
    render();
  }
  function adjust(result, d) {
    if (S.life) return;
    const v = G().view(S.hand, meId()), o = betOpt(v);
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
    const GC = G().GUESS_CONFIG, C = CC().CC_CONFIG, life = !!(S && S.life);
    const t = G().tableOf(life ? GC.life.id : (SETUP.table || (S && S.table)));
    const pct = Math.round(C.pctStep * 100);
    const guard = life
      ? `<li><b>押坚毅</b>：每格押上固定的坚毅生命——第一轮 ${t.stake[0]} 点、第二轮 ${t.stake[1]} 点、第三轮 ${t.stake[2]} 点；不收入场费；第一轮没押，后两轮不能再押。押输了坚毅受创，坚毅扣光即真正死亡。押坚毅永远能下。</li>
         <li><b>奖品</b>：押中的格子，押上的点数 × 赔率（向下取整）× ${GC.life.kuizhiPerPoint} 奎支；单格赔率 ${GC.life.items.map(x => `≥ ${x.minOdds} 另给${esc(itemName(x.item))}`).join("、")}。</li>`
      : `<li><b>防白看</b>：每手入场费 ${t.entry} 枚（不退）；每格最低注第一轮 ${t.minBet[0]}、第二轮 ${t.minBet[1]}、第三轮 ${t.minBet[2]}；第一轮没押，后两轮不能再押。</li>`;
    return `<details class="cc-rules"><summary>${esc(life ? GC.life.name : GC.name)} 规则</summary><ul>
      <li><b>牌</b>：庄家随机抽 1 张元素（${C.elements.length} 选 1）、1 张天气（${C.weathers.length} 选 1）、1 张层牌（${C.layers.length} 选 1），都盖在桌上。猜这一手的得分：${GC.results.map(G().label).join(" / ")}（超出按两头算）。</li>
      <li><b>计分</b>：和 ${esc(C.name)} 一样——克制 +1、劣势 −1、其余 0，天气修正每 ${pct}% 记 ±1（微光里能量以外的克制反转；酸雨里酸、冰以外打装甲另 +1）。相位只把克制分翻倍（+1→+2、−1→−2，0 不变），不加天气修正。</li>
      <li><b>下注</b>：三张盖好 → 第一轮下注 → 翻开元素 → 第二轮 → 翻开天气 → 第三轮 → 翻开层牌结算。每轮可押任意几格，押注按下注那一刻的赔率锁定。</li>
      ${guard}
      <li><b>赔率</b>（连本带利）= ${t.odds[0]}/${t.odds[1]} × N ÷ k：N 是还没排除的组合数（245 → 35 → 5），k 是其中得出这个结果的组合数；不满 ${GC.halfBelow} 倍向下取到 0.5，满 ${GC.halfBelow} 倍取整；赔出半枚向下取整。不可能、必中、算出来不到 1 倍以上的格子不开盘。</li>
    </ul></details>`;
  }
  function itemName(id) {
    const cat = typeof ITEM_CATALOG !== "undefined" ? ITEM_CATALOG : (root.ITEM_CATALOG || {});
    return (cat[id] && cat[id].name) || id;
  }
  function render() {
    if (!S || !S.hand) return;
    const v = G().view(S.hand, meId());
    const app = $("ccg-game");
    if (!app) return;
    app.dataset.weather = v.shown.weather || "none";
    app.dataset.table = v.table.life ? "life" : "chips";
    const was = S.last.shown || {};
    ["element", "weather", "layer"].forEach(k => { if (v.shown[k] && !was[k]) S.anim.flip = (S.anim.flip || []).concat([k]); });
    S.last.shown = Object.assign({}, v.shown);
    const top = $("ccg-top"), board = $("ccg-board"), actions = $("ccg-actions"), side = $("ccg-side"), banner = $("ccg-banner");
    if (top) top.innerHTML = topHtml(v);
    if (board) board.innerHTML = boardHtml(v);
    if (actions) actions.innerHTML = actionsHtml(v);
    // 记录：在底部就滚到底看新记录，往上翻着看旧的就停在原处（借 High Flux 的 logScroll / stickLog，#499）
    if (side) { const was = CUI().logScroll(side); side.innerHTML = sideHtml(v); CUI().stickLog(side, was); }
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
    if (S.life) {
      return `<b class="cc-brand">${esc(CC().CC_CONFIG.name)} · ${esc(v.table.name)}</b><span class="cc-round">${status}</span>`
        + `<span class="cc-role"><b>${esc(S.life.seat.name)}</b>下注 · 第 ${S.n} 手 · 庄家：${esc(S.life.dealer || v.table.dealer)}</span>`
        + `<span class="cc-spacer"></span><button type="button" class="cc-btn" data-ccg="leave">离桌</button>`;
    }
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
    const dealer = S.life ? `<div class="cc-who"><b>${esc(S.life.dealer || v.table.dealer)}</b><small>${S.life.dealer ? "坐庄" : "黑市 NPC"}</small></div>` : `<div class="cc-who"><b>庄家</b><small>AI · 筹码无限</small></div>`;
    let seat;
    if (S.life) {
      // 赌命桌：没有筹码堆，也不写押上的点数加起来是多少（每格的固定代价写在格子上）
      seat = `<div class="cc-seat ccg-seat ccg-lifeseat"><div class="cc-who"><b>${esc(S.life.seat.name)}</b><small>押的是坚毅生命</small><small>这一手押了 ${v.me.slips.length} 格</small></div></div>`;
    } else {
      const staked = v.me.slips.reduce((s, x) => s + x.amount, 0);
      const bump = (k, val) => { const old = S.last[k]; S.last[k] = val; return old !== undefined && old !== val; };
      seat = `<div class="cc-seat ccg-seat">${CUI().chipsHtml(v.me.chips, { title: "你的筹码", label: "你的筹码", anim: bump("chips", v.me.chips) })}
        <div class="cc-who"><b>你</b><small>入场费 ${v.me.paid} 枚（不退）</small><small>这一手押了 ${staked} 枚</small></div></div>`;
    }
    return `<div class="ccg-dealer">${dealer}<div class="ccg-slots">${G().GUESS_CONFIG.order.map(slot).join("")}</div></div>
      ${oddsHtml(v)}
      ${seat}`;
  }
  /** 一张押注条：普通桌写押了几枚；赌命桌写押上的固定点数（规则文字） */
  const slipText = (x) => (S.life ? `押上 ${x.stake} 点 ×${x.odds}` : `${x.amount} 枚 ×${x.odds}`);
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
        `<span class="ccg-slip${x.win ? " win" : x.win === false ? " lose" : ""}" title="第 ${x.round} 轮押的，赔率锁定 ${x.odds} 倍">${esc(slipText(x))}</span>`).join("");
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
    if (S.life) p += o ? `点赔率表上开盘的格子押上坚毅：这一轮每格押上 ${o.stake} 点坚毅（固定代价），可以押好几格；押注按现在的赔率锁定。` : "";
    else p += o ? `点赔率表上开盘的格子押注，可以押好几格，每格至少 ${o.min} 枚；押注按现在的赔率锁定。` : `你的筹码不够这一轮的最低注 ${v.minBet} 枚，只能不押。`;
    if (v.round === 1) p += S.life ? "第一轮不押，这一手后面都不能再押。" : "第一轮不押，这一手后面都不能再押（入场费不退）。";
    const keys = Object.keys(S.draft).map(Number).sort((a, b) => a - b);
    const lines = keys.map(r => {
      const cell = v.board.cells.find(x => x.result === r), n = S.draft[r];
      const head = `<b class="ccg-res">${esc(G().label(r))}</b><small>×${cell ? cell.odds : "?"}</small>`;
      if (S.life) return `<span class="cc-amount ccg-line" role="group" aria-label="押 ${esc(G().label(r))}">${head}<small class="ccg-stake">押上 ${n} 点坚毅</small>`
        + btn("pick", "✕", { data: { result: r }, title: "这一格不押了" }) + `</span>`;
      const room = o ? o.max - draftTotal() : 0;
      return `<span class="cc-amount ccg-line" role="group" aria-label="押 ${esc(G().label(r))}">${head}`
        + btn("amt", "−", { data: { result: r, d: -1 }, disabled: !o || n <= o.min, title: "少一枚" })
        + `<b class="cc-amt">${n}</b>`
        + btn("amt", "+", { data: { result: r, d: 1 }, disabled: room <= 0, title: "多一枚" })
        + btn("pick", "✕", { data: { result: r }, title: "这一格不押了" }) + `</span>`;
    }).join("");
    const total = draftTotal();
    const passTitle = v.round === 1 ? (S.life ? "第一轮不押，后两轮也不能押" : "第一轮不押，后两轮也不能押；入场费不退") : "第一轮押过了，这一轮不押下一轮照样能押";
    const go = S.life
      ? btn("bet", keys.length ? `押上坚毅（${keys.length} 格）` : "先点格子", { primary: true, disabled: !keys.length })
      : (o ? btn("bet", total ? `押注 ${total} 枚` : "先点格子", { primary: true, disabled: !total || total > o.max }) : "");
    const b = lines + go + btn("pass", v.round === 1 ? "不押（这一手不玩了）" : "这一轮不押", { cls: v.round === 1 ? "cc-danger" : "", primary: !o, title: passTitle });
    const info = S.life ? `<p class="cc-info">押输了坚毅受创，坚毅扣光即真正死亡。</p>` : o ? `<p class="cc-info">手上 ${o.max} 枚 · 这一轮押了 ${total} 枚</p>` : "";
    return `<p class="cc-prompt">${p}</p><div class="cc-btns">${b}</div>${info}${msg}`;
  }
  function sideHtml(v) {
    const L = UI_CONFIG.life;
    // 每手结算、记录都按先后排，最新的在最下面（同 High Flux 的侧栏和战斗记录，#499；以前都是最新的在最上面）
    const rows = S.history.slice(-UI_CONFIG.historyLines).map(x => {
      if (S.life) {
        const what = !x.bet ? "没押" : x.dead ? L.dead : [x.hits ? `押中 ${x.hits} 格` : "没押中", x.hurt ? L.hurt : ""].filter(Boolean).join(" · ");
        return `<li class="cc-res ${x.dead || x.hurt ? "lose" : x.hits ? "win" : "tie"}"><b>第 ${x.n} 手</b><span>结果 ${esc(G().label(x.score))}</span><span class="cc-wxname">${esc(what)}</span><span class="cc-delta"></span></li>`;
      }
      return `<li class="cc-res ${x.net > 0 ? "win" : x.net < 0 ? "lose" : "tie"}"><b>第 ${x.n} 手</b><span>结果 ${esc(G().label(x.score))}</span><span class="cc-wxname">${x.bet ? "" : "没押"}</span><span class="cc-delta">${signed(x.net)}</span></li>`;
    }).join("");
    const log = v.log.slice(-UI_CONFIG.logLines).map(e => `<li>${esc(e.text)}</li>`).join("");
    return `<h3>每手结算</h3><ol class="cc-results">${rows || "<li class=\"cc-empty\">还没有结算</li>"}</ol>
      ${rulesHtml()}
      <h3>记录</h3><ul class="cc-log">${log}</ul>`;
  }
  /** 结算横幅：结果、三张牌、押中几格；普通桌写拿回多少、这一手净输赢（含入场费）；
   *  赌命桌写赢到的奖品、「坚毅受创」（不写数字）、接入层说死了就写永久死亡（只能离桌） */
  function bannerHtml(v) {
    const r = v.result, me = v.me, P = G().GUESS_CONFIG.phase;
    const hits = me.slips.filter(x => x.win);
    const how = `${CC().cardName(r.element)}打${CC().cardName(r.layer)} · 天气${CC().weatherName(r.weather)}${r.weather === P.weather ? `（克制分 ×${P.mult}）` : ""}`;
    const cards = `<div class="ccg-slots ccg-mini">${G().GUESS_CONFIG.order.map(k => faceOf(k, r[k])).join("")}</div>`;
    if (S.life) {
      const L = UI_CONFIG.life, out = S.life.outcome || { dead: false, notes: [] };
      const won = hits.length ? `押中 ${hits.length} 格：赢得 ${G().prizeText(me.prize)}。` : me.slips.length ? "没押中。" : "这一手没押。";
      const grit = me.slips.length ? (me.hurt ? L.hurt : L.safe) : "";
      const tone = out.dead || me.hurt ? "lose" : hits.length ? "win" : "";
      const dead = out.dead ? `<p class="ccg-dead">${esc(S.life.seat.name)} ${esc(L.dead)}</p>${out.notes.map(t => `<p class="cc-quiet">${esc(t)}</p>`).join("")}` : "";
      const btns = out.dead ? btn("leave", "离桌", { primary: true }) : btn("again", "再来一手", { primary: true }) + btn("leave", "离桌");
      return `<div class="cc-banner-card ccg-result ${tone}" role="dialog" aria-label="第 ${S.n} 手结算">
      <small>第 ${S.n} 手结算 · ${esc(v.table.name)}</small>
      <h3>结果 ${esc(G().label(r.score))}</h3>
      ${cards}
      <p class="cc-tier">${esc(how)}</p>
      <p class="cc-tier">${esc(won)}</p>
      ${grit ? `<p class="ccg-grit ${me.hurt ? "hurt" : ""}">${esc(grit)}</p>` : ""}
      ${dead}
      <div class="cc-btns">${btns}</div>
    </div>`;
    }
    const tone = me.net > 0 ? "win" : me.net < 0 ? "lose" : "";
    const line = !me.slips.length ? "这一手你没押。" : hits.length ? `押中 ${hits.length} 格，连本带利拿回 ${me.won} 枚。` : "没押中。";
    const entry = v.table.entry, can = S.chips >= entry;
    return `<div class="cc-banner-card ccg-result ${tone}" role="dialog" aria-label="第 ${S.n} 手结算">
      <small>第 ${S.n} 手结算 · ${esc(v.table.name)}</small>
      <h3>结果 ${esc(G().label(r.score))}</h3>
      ${cards}
      <p class="cc-tier">${esc(how)}</p>
      <p class="cc-tier">${esc(line)}</p>
      <p class="cc-deltas"><span class="${me.net > 0 ? "up" : me.net < 0 ? "down" : ""}">这一手 ${signed(me.net)} 枚</span><span>手上 ${S.chips} 枚</span></p>
      <p class="cc-quiet">净输赢含入场费 ${me.paid} 枚。</p>
      <div class="cc-btns">${btn("again", can ? `再来一手（入场费 ${entry}）` : `筹码不够入场费 ${entry} 枚`, { primary: can, disabled: !can })}${btn("setup", can ? "换桌" : "重新坐下", { primary: !can })}${btn("title", "回到标题")}</div>
    </div>`;
  }

  /** 黑市入口（长线养成的任务板、跑团的「商人」页都用这一段）：规则说明 + 每名能上桌的角色一个「上桌」按钮（data-ccg-black = 角色 id）。
   *  seats = [{ id, name }]——只要名字：不写谁还剩多少坚毅，按钮也不会按坚毅变灰（押坚毅永远能下）。
   *  opt.dealer：谁当庄（默认黑市庄家）；opt.death：坚毅扣光以后怎么样（各模式自己的死亡规则，规则文字）。
   *  联机开着房间 / 本机热座时只写「联机不开赌命桌」，没有按钮 */
  function blackMarketHtml(seats, opt) {
    opt = opt || {};
    const L = G().GUESS_CONFIG.life;
    const head = `<p class="ccg-bm-title"><b>${esc(L.name)}</b></p>`;
    if (onlineNow()) return `<div class="ccg-bm">${head}<p class="r-hint">${esc(UI_CONFIG.life.online)}。</p></div>`;
    const list = (seats || []).filter(s => s && s.id != null);
    const rules = `${esc(opt.dealer || L.dealer)}坐庄猜大猜小（${esc(CC().CC_CONFIG.name)}），押的是坚毅生命：每格押上 ${L.stake.join(" / ")} 点（第一 / 二 / 三轮），押坚毅永远能下。`
      + `押输了坚毅受创，${esc(opt.death || "坚毅扣光即真正死亡")}。押中按赔率赢奎支，赔率高另给稀有材料。`;
    const btns = list.map(s => `<button type="button" class="g-btn small" data-ccg-black="${esc(s.id)}">${esc(s.name)} 上桌</button>`).join("");
    return `<div class="ccg-bm">${head}<p class="r-hint">${rules}</p><div class="r-choices">${btns || `<span class="r-hint">没有能上桌的角色。</span>`}</div></div>`;
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
      case "leave": leaveLife(); return;
    }
    if (!S || !S.hand) return;
    switch (d.ccg) {
      case "again": if (deal()) render(); else if (S.life) render(); else { renderSetup(); show("setup"); } break;
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
    UI_CONFIG, open, start, startLife, blackMarketHtml, online: onlineNow, render, weatherFace,
    state: () => S, view: () => (S && S.hand ? G().view(S.hand, meId()) : null), act: humanAct
  };
})(typeof window !== "undefined" ? window : globalThis);
