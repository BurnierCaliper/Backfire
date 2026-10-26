/* D3 display client. This module only reads the OnlineGame presentation API;
 * it never invokes battle rules or uses a received DTO as authoritative state. */
(function (global) {
  "use strict";
  let mounted;
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const copy = value => JSON.parse(JSON.stringify(value));
  const labels = { flesh: "生命", armor: "护甲", shield: "护盾", sand: "砂甲", spirit: "灵体", none: "常态", heat: "酷暑", snow: "雪天", acid: "酸雨", thunder: "雷鸣", glow: "微光", phase: "相位" };
  const names = { nano: "纳米", nanoReserve: "储备", bean: "咖啡豆", liquid: "咖啡液", durability: "耐久", shield: "盾", charge: "充能", energyPct: "能量", light: "光", debrisCount: "碎块", burn: "灼烧", shock: "感电", corr: "腐蚀", frostbite: "冻伤", shockwave: "震荡", high: "高能", reso: "共振", weak: "虚弱", inspire: "振奋", hide: "躲藏", advantage: "优势", chase: "紧追", sturdy: "坚固", blind: "目盲" };
  // 玩家右侧栏收起（#298）：电脑上把「战斗 / 小队」右侧栏收成一条窄边（只剩展开按钮，收起时来了新消息挂数字），战斗画面变宽；
  // 收起状态记在这台电脑上。手机竖屏的右侧栏在底部，照旧用自己的「展开 ▴ / 收起 ▾」
  const SIDE_COLLAPSE = { key: "backfire.online.sideCollapsed", collapse: "▸", expand: "◂", collapseTitle: "收起右侧栏（战斗画面变宽）", expandTitle: "展开右侧栏：战斗记录与小队聊天" };
  // 「菜单」按钮（#298，以前这里是「房间码 · 消息与成员」）：房间码照旧写在前面，断线时写「重连中」
  const DOCK_TEXT = { room: "房间", reconnecting: "重连中", menu: "菜单", title: "菜单（Esc）：消息与成员、大厅、克制表、主持人工具……" };
  // 单位详情（作者 10/20 定）：悬停只出简短说明（unit-tip.js · html 的 brief），末尾写 more；不在选目标时点一下单位（手机上轻点）打开详情面板看完整的
  const UNIT_DETAIL = { more: "点一下单位看全部说明", label: "单位详情", close: "关闭单位详情" };
  function mount(api) {
    if (mounted) mounted.destroy();
    if (!api || typeof api.getView !== "function" || typeof document === "undefined") return null;
    let view = {}, panelOpen = false, entry = "join", notice = "", pending = false, destroyed = false, rogueHeroesSeen = false, lastScreen = "";
    let lobbyView = false;   // 房间面板显示成「大厅」那张卡（暂停页面里的「大厅」，#298）；面板一收起就回到「消息与成员」
    let focusKit = "";   // 一名玩家可以操控好几名角色：「角色资料 / 武器」默认打开哪一名（队伍卡上切换）
    let currentMenu = null, request = null, selectedActor = "", actionGeneration = 0, playbackGeneration = 0;
    // 战斗画面（online-battle.js）：和单人 / 跑团同一套画面；skillOptions 是当前角色的技能栏，autoKey 防止重复自动取技能
    let battle = null, skillOptions = [], skillsFor = "", autoKey = "";
    let displayState = null, animating = false, messagesInitialized = false, seenMessages = new Set(), toastTimer;
    // 纸片画面（#308，online-paper.js）：联机玩家的战斗画面开着新画面时换的新排版。paperOn 这一刻是不是、toolsOpen「工具 ▾」开着没、
    // swapOpen 点开了 ⇅ 的那一格吊牌、paperDrawer 右边的记录 / 聊天抽屉拉出来没有（记在本机，平时收着）
    let paperOn = false, toolsOpen = false, swapOpen = null, paperDrawer = false;
    const paperStore = (() => { try { return global.localStorage || null; } catch (e) { return null; } })();
    let questSeen = null, questBoxOpen = false;
    let restSeen;   // 已经弹过的长休结算（第一次收到不弹，免得进房间就弹旧的）   // 任务日志：上一包的摘要（算「任务更新」提示）、日志面板开着没
    let historyRows = [], historyRoom = "", historyHasMore = true, historyLoading = false, historyGeneration = 0;
    // 默认的转发服务（docs/d3/relay.md 里部署的那一个）：大家都用它，就不用每次填；要换别的服务再展开「更换转发服务」
    const DEFAULT_RELAY = "https://backfire-relay.richardguu22.workers.dev";
    // 昵称记在本机（只是方便，读不到就空着）
    const NAME_KEY = "backfire.online.name";
    const savedName = (() => { try { return localStorage.getItem(NAME_KEY) || ""; } catch (e) { return ""; } })();
    let partyDraft = null;   // 主持人正在勾的队员（还没点「按勾选换队员」）
    let form = { url: "", name: savedName, roomCode: "", slot: "0", campaignName: "", mode: "trpg", to: "all", text: "", chatText: "" }, assignments = {}, transferDraft = {};
    const unsubs = [], nodes = [], titleButtons = [], lastMarkup = {};
    const byId = id => document.getElementById(id);
    const own = () => view.identity && view.identity.id;
    const players = () => view.players || [];
    const playerName = id => (players().find(p => p.id === id) || {}).name || id || "主持人";
    const hs = () => view.packet && view.packet.view || {};
    const paused = () => !view.status?.connected || !view.status?.hostOnline || !!view.status?.paused;
    const disabled = () => pending || paused() || animating;
    const button = (text, action, data = "", off = false, primary = false) => `<button type="button" class="g-btn ol-button${primary ? " ol-primary" : ""}" data-online="${action}" ${data}${off ? " disabled" : ""}>${esc(text)}</button>`;
    const option = (value, text, selected) => `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(text)}</option>`;
    // 未读红点（#207）：「菜单」按钮右上角（#298 起由 pause-menu.js 画）、「大厅交流」标题旁、「小队」标签同一个样式；超过 9 条写「9+」。数字只给眼睛看，读屏念后面的「（N 条新消息）」
    const dotText = n => n > 9 ? "9+" : String(n);
    const dotMarkup = (n, extra = "") => n > 0 ? `<span class="ol-dot${extra}" aria-hidden="true">${dotText(n)}</span><span class="ol-sr-only">（${n} 条新消息）</span>` : "";
    /** 红点刚出现的那一下轻轻弹一下（动画在 online.css 的 .ol-dot-pop；系统开了「减少动态效果」就不播） */
    const popDot = el => { if (el) el.classList.add("ol-dot-pop"); };
    function make(tag, id, className, attrs = {}) {
      const node = document.createElement(tag); node.id = id; node.className = "ol-ui " + className;
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      document.body.appendChild(node); nodes.push(node); return node;
    }
    const dock = make("div", "online-dock", "ol-dock");
    const stage = make("main", "online-stage", "ol-stage ol-skin", { "aria-label": "联机战场" });
    // 纸片画面（#308）的顶栏、行动顺序吊牌、「工具 ▾」下拉：浮在铺满的战场和右边的抽屉上面；不是纸片画面时藏着、里面是空的
    const paperBox = make("div", "online-paper", "olp-root", { "aria-label": "战斗画面顶栏" });
    paperBox.hidden = true;
    const panel = make("section", "online-panel", "ol-overlay", { role: "dialog", "aria-label": "联机房间" });
    const toast = make("aside", "online-toast", "ol-toast", { role: "status", "aria-live": "polite" });
    toast.hidden = true;
    // 玩家右侧栏：「战斗 / 记录」和「小队」两个频道。输入框只建一次，收到新消息只更新列表，不会打断输入
    const side = make("aside", "online-side", "ol-side", { "aria-label": "战斗记录与小队聊天" });
    side.innerHTML = `<nav class="ol-side-tabs" role="tablist"><button type="button" role="tab" data-side="log" class="ol-tab"></button><button type="button" role="tab" data-side="chat" class="ol-tab">小队<span class="ol-dot ol-badge ol-dot-pop" hidden></span></button><button type="button" class="ol-side-fold" data-side-fold hidden>展开 ▴</button><button type="button" class="ol-side-collapse" data-side-collapse aria-controls="online-side"><span class="ol-side-collapse-icon" aria-hidden="true"></span><span class="ol-dot ol-side-collapse-dot ol-dot-pop" aria-hidden="true" hidden></span><span class="ol-sr-only ol-side-collapse-sr"></span></button></nav><ol class="ol-side-log" aria-live="polite"></ol><ol class="ol-side-chat" aria-live="polite"></ol><form class="ol-side-form" id="ol-side-form"><label class="ol-sr-only" for="ol-side-text">小队消息</label><button type="button" class="ol-button ol-dice" data-roll-open="1" title="选一个熟练项掷 d100">🎲 掷骰</button><textarea id="ol-side-text" rows="1" maxlength="500" autocomplete="off" enterkeyhint="send" title="Enter 发送，Shift+Enter 换行" placeholder="和队友说点什么…"></textarea><button type="submit" class="ol-button ol-primary">发送</button></form>`;
    side.hidden = true;
    const bagBox = make("section", "online-bag", "ol-overlay ol-bag", { role: "dialog", "aria-label": "战绩与任务" });
    bagBox.hidden = true;
    // 钱包与商店（原「物资」：钱包 / 商店 / 工匠 / 工坊 / 诊所；道具在「背包」）：收进弹窗，不再压在舞台内容上面把战场、检定挤下去
    const suppliesBox = make("section", "online-supplies", "ol-overlay ol-bag ol-supplies-box", { role: "dialog", "aria-label": "钱包与商店" });
    suppliesBox.hidden = true;
    let suppliesOpen = false, privUnread = 0, autoResumeTried = false;
    // 大厅交流的未读（#207）：大厅里别人发的、还没看到的条数；lobbySeen 为 null 时下一次只记下已有的消息（刚进大厅、重新同步）
    // lobbyDot：「大厅交流」标题旁上一次画出来的红点数，从 0 变成有的那一下才弹（「菜单」按钮上的红点由 pause-menu.js 画）
    let lobbyUnread = 0, lobbySeen = null, lobbyDot = 0;
    // 房间暂停：固定在顶栏下面的一条横幅，不会被内容挤到下面
    const pauseBar = make("div", "online-pause", "ol-pause-bar", { role: "status", "aria-live": "polite" });
    pauseBar.hidden = true;
    // 掷骰：选角色、选熟练项，掷一颗 d100（点数越低越好）
    const rollBox = make("section", "online-roll", "ol-overlay ol-bag ol-roll", { role: "dialog", "aria-label": "掷骰" });
    rollBox.hidden = true;
    let checkReq = null;   // 申请检定（check-request-ui.js）：玩家申请 / 主持人批准的浮层，下面 mount
    let loreUi = null;     // NPC 资料（lore-ui.js）：主持人编辑 / 玩家只读的浮层，下面 mount
    const rollForm = { unit: "", prof: "", note: "", secret: false };
    // 大字：主持人发，所有人画面中间出现（像 Minecraft 的 /title）
    const titleShow = make("div", "online-title", "ol-title-show", { "aria-live": "assertive" });
    titleShow.hidden = true;
    // 游戏内确认框（代替浏览器原生 confirm()：不阻塞页面、和游戏画风一致；Esc / 点外面 = 取消）
    const confirmBox = make("section", "online-confirm", "ol-overlay ol-bag ol-roll ol-confirm", { role: "alertdialog", "aria-modal": "true", "aria-label": "确认" });
    confirmBox.hidden = true;
    let confirmResolve = null;
    const titleBox = make("section", "online-title-form", "ol-overlay ol-bag ol-roll", { role: "dialog", "aria-label": "发大字" });
    titleBox.hidden = true;
    const titleForm = { text: "", sub: "", tone: "plain", seconds: 4 };
    let lastTitle = null, titlePrimed = false, titleTimer = null;
    let sideTab = { battle: "log", other: "chat" }, sideKeys = { log: "", chat: "" }, seenChat = new Set(), chatPrimed = false, unread = 0, chatSending = false;
    // 手机竖屏探索 / 战斗：聊天栏默认收成底部一条（只剩频道标签），点标签展开、点「收起」再收回去
    let sideOpen = false;
    const phoneSide = () => typeof matchMedia === "function" && matchMedia("(max-width: 760px)").matches;   // 战斗画面同样默认收起，战场和技能栏不被挤掉
    function paintSideFold() {
      const fold = phoneSide() && !paperOn && !sideOpen && !side.hidden;   // 纸片画面（#308）的手机上不用底部那一条，用下面的抽屉
      side.classList.toggle("ol-side-folded", fold); document.body.classList.toggle("ol-side-folded", fold);
      const t = side.querySelector("[data-side-fold]"); if (t) { t.hidden = !phoneSide() || paperOn; t.textContent = sideOpen ? "收起 ▾" : "展开 ▴"; }
      paintSideCollapse();
    }
    // 电脑上的右侧栏收起（#298）：读写 localStorage 都包 try/catch（隐私模式、存储满了就只在这一页记着）
    let sideCollapsed = (() => { try { return localStorage.getItem(SIDE_COLLAPSE.key) === "1"; } catch (e) { return false; } })();
    // 纸片画面（#308）：右边的战斗记录 / 小队聊天是一个抽屉，平时收成右边缘一个竖标签（手机上也是）；收着没有另记在本机（online-paper.js · PAPER.keys.drawer）
    const collapsedNow = () => !side.hidden && (paperOn ? !paperDrawer : sideCollapsed && !phoneSide());
    /** 收起 / 展开按钮：收起时只剩它一个，小队来了新消息挂数字（和「小队」标签的红点同一个数）；纸片画面收着时它就是那个竖标签「记录 · 聊天」 */
    function paintSideCollapse() {
      const on = collapsedNow(), b = side.querySelector("[data-side-collapse]");
      side.classList.toggle("ol-side-collapsed", on); document.body.classList.toggle("ol-side-collapsed", on);
      if (!b) return;
      const P = paperOn ? global.OnlinePaper.PAPER.text : null;
      const n = on ? unread : 0, dot = b.querySelector(".ol-side-collapse-dot"), label = P ? (on ? P.drawerOpen : P.drawerClose) : on ? SIDE_COLLAPSE.expandTitle : SIDE_COLLAPSE.collapseTitle;
      b.hidden = phoneSide() && !P;
      b.setAttribute("aria-expanded", String(!on)); b.title = label;
      b.querySelector(".ol-side-collapse-icon").textContent = P && on ? P.drawer : on ? SIDE_COLLAPSE.expand : SIDE_COLLAPSE.collapse;
      dot.hidden = !n; dot.textContent = dotText(n);
      b.querySelector(".ol-side-collapse-sr").textContent = label + (n ? `（${n} 条新消息）` : "");
    }
    function setSideCollapsed(on) {
      sideCollapsed = !!on;
      try { localStorage.setItem(SIDE_COLLAPSE.key, sideCollapsed ? "1" : "0"); } catch (e) { /* 存不了就只在这一页记着 */ }
      renderSide(true);
      // 舞台变宽 / 变窄：按窗口大小排版的（战场、新画面）重新量一次
      if (typeof dispatchEvent === "function" && typeof Event === "function") dispatchEvent(new Event("resize"));
    }
    /** 纸片画面的抽屉拉出来 / 收回去（#308）：记在本机（存不了就只在这一页记着）；抽屉浮在战场上，战场不用重新量 */
    function setPaperDrawer(open) {
      paperDrawer = !!open;
      global.OnlinePaper.setOpen("drawer", paperDrawer, paperStore);
      renderSide(true);
    }
    if (typeof addEventListener === "function") addEventListener("resize", () => { if (!destroyed) { paintSideFold(); seeLobbyChat(); } });
    // 房间面板往下翻到「大厅交流」：看到了，红点消失
    panel.addEventListener("scroll", () => seeLobbyChat(), { passive: true });
    side.addEventListener("click", event => {
      if (event.target.closest("[data-side-collapse]")) { if (paperOn) setPaperDrawer(!paperDrawer); else setSideCollapsed(!sideCollapsed); return; }
      if (event.target.closest("[data-side-fold]")) { sideOpen = !sideOpen; paintSideFold(); return; }
      const tab = event.target.closest("[data-side]"); if (!tab) return;
      if (phoneSide() && !sideOpen) { sideOpen = true; paintSideFold(); }
      sideTab[view.screen === "battle" || view.screen === "ended" ? "battle" : "other"] = tab.dataset.side; renderSide(true);
      if (tab.dataset.side === "chat") side.querySelector("#ol-side-text")?.focus({ preventScroll: true });
    });
    side.addEventListener("keydown", event => { event.stopPropagation(); chatEnter(event); });
    side.addEventListener("input", event => fitChatBox(event.target));
    side.addEventListener("submit", event => { event.preventDefault(); sendSideChat(); });
    bagBox.addEventListener("click", event => { if (event.target === bagBox || event.target.closest('[data-bag="close"]')) bagBox.hidden = true; });
    const onRollOpen = event => {
      if (!event.target.closest) return;
      if (event.target.closest("[data-roll-open]")) openRoll();
      if (event.target.closest("[data-title-open]")) openTitleForm();
    };
    titleBox.addEventListener("click", event => {
      if (event.target === titleBox || event.target.closest('[data-title="close"]')) { titleBox.hidden = true; return; }
      const preset = event.target.closest("[data-title-preset]");
      if (preset) { const [t, tone] = preset.dataset.titlePreset.split("|"); titleForm.text = t; titleForm.tone = tone; paintTitleForm(); return; }
      if (event.target.closest('[data-title="go"]')) sendTitle();
    });
    titleBox.addEventListener("input", event => { const k = event.target.dataset.tf; if (k) titleForm[k] = event.target.value; });
    stage.addEventListener("change", event => {
      const sel = event.target.closest && event.target.closest("[data-ol-cmp]");
      const r = view.packet?.rogue;
      if (!sel || !r || !r.smith) return;
      const [kit, slot] = sel.value.split(":");
      const out = byId(sel.id + "-cmp");
      if (out) out.innerHTML = partCompare(r, sel.dataset.olCmp, { kit, slot: Number(slot) });
    });
    titleBox.addEventListener("change", event => { const k = event.target.dataset.tf; if (k) titleForm[k] = event.target.value; });
    titleBox.addEventListener("keydown", event => { event.stopPropagation(); if (event.key === "Escape") titleBox.hidden = true; if (event.key === "Enter" && event.target.tagName === "INPUT") sendTitle(); });
    document.addEventListener("click", onRollOpen);
    rollBox.addEventListener("click", event => {
      if (event.target === rollBox || event.target.closest('[data-roll="close"]')) { rollBox.hidden = true; return; }
      if (event.target.closest('[data-roll="go"]')) doRoll();
      if (event.target.closest('[data-roll="ask"]')) askCheck();
    });
    rollBox.addEventListener("change", event => {
      const t = event.target;
      if (t.id === "ol-roll-unit") { rollForm.unit = t.value; paintRoll(); }
      else if (t.id === "ol-roll-prof") { rollForm.prof = t.value; paintRoll(); }
      else if (t.id === "ol-roll-secret") rollForm.secret = t.checked;
    });
    rollBox.addEventListener("input", event => { if (event.target.id === "ol-roll-note") rollForm.note = event.target.value; });
    rollBox.addEventListener("keydown", event => { event.stopPropagation(); if (event.key === "Escape") rollBox.hidden = true; if (event.key === "Enter" && event.target.id === "ol-roll-note") doRoll(); });
    confirmBox.addEventListener("click", event => {
      if (event.target === confirmBox || event.target.closest('[data-confirm="no"]')) closeConfirm(false);
      else if (event.target.closest('[data-confirm="yes"]')) closeConfirm(true);
    });
    confirmBox.addEventListener("keydown", event => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); closeConfirm(false); } });
    suppliesBox.addEventListener("click", event => { if (event.target === suppliesBox || event.target.closest('[data-online="suppliesClose"]')) { suppliesOpen = false; suppliesBox.hidden = true; } });
    suppliesBox.addEventListener("keydown", event => { if (event.key === "Escape") { suppliesOpen = false; suppliesBox.hidden = true; } });
    bagBox.addEventListener("keydown", event => { event.stopPropagation(); if (event.key === "Escape") bagBox.hidden = true; });
    for (const node of [dock, stage, panel, suppliesBox, paperBox]) {
      node.addEventListener("click", click);
      node.addEventListener("keydown", event => { event.stopPropagation(); if (event.key === "Escape" && panelOpen && view.screen !== "lobby") { panelOpen = false; render(); } });
      node.addEventListener("input", input); node.addEventListener("change", change);
      node.addEventListener("submit", event => { event.preventDefault(); if (event.target.id === "ol-message-form") sendMessage(); if (event.target.id === "ol-lobby-chat") sendLobbyChat(); });
    }
    // 纸片画面（#308）的顶栏 / 吊牌：「工具 ▾」开关、镜头按钮（点新画面原来那几个）、⇅ 点开「延后 / 换位」（点热座栏原来那几个按钮）；
    // 下拉里的一项（地图、战绩……：上面的 click 照旧处理；申请检定、新画面开关由它们自己的模块处理）点完就收起
    paperBox.addEventListener("click", event => {
      const t = event.target, OP = global.OnlinePaper;
      if (!t || !t.closest || !OP) return;
      if (t.closest('[data-olp="tools"]')) { toolsOpen = !toolsOpen; swapOpen = null; paintPaper(); return; }
      const cam = t.closest("[data-olp-cam]");
      if (cam) { OP.pressCam(stage, Number(cam.dataset.olpCam)); return; }
      const sw = t.closest("[data-olp-swap]");
      if (sw) { const i = Number(sw.dataset.olpSwap); swapOpen = swapOpen === i ? null : i; toolsOpen = false; paintPaper(); return; }
      const mv = t.closest("[data-olp-move]");
      if (mv) { if (mv.disabled) return; const [i, n] = mv.dataset.olpMove.split(" ").map(Number); swapOpen = null; OP.pressMove(document, i, n); paintPaper(); return; }
    });
    // 下拉里点了一项：在捕获阶段先认出来（处理它的时候可能马上重画，按钮就换掉了），等它处理完再收起
    paperBox.addEventListener("click", event => {
      if (toolsOpen && event.target && event.target.closest && event.target.closest(".olp-tools-list button")) setTimeout(() => { if (destroyed || !toolsOpen) return; toolsOpen = false; paintPaper(); }, 0);
    }, true);
    /** 点到别处 / 按 Esc：「工具 ▾」下拉、⇅ 点开的按钮收起来（新画面的 3D 战场自己拦了点击，所以在捕获阶段看） */
    const closePaperMenus = () => { if (!toolsOpen && swapOpen == null) return false; toolsOpen = false; swapOpen = null; paintPaper(); return true; };
    const onPaperOutside = event => {
      const t = event.target, inside = sel => !!(t && t.closest && t.closest(sel));
      if (!paperOn) return;
      let changed = false;
      if (toolsOpen && !inside("#olp-tools") && !inside('[data-olp="tools"]')) { toolsOpen = false; changed = true; }
      if (swapOpen != null && !inside(".olp-tags")) { swapOpen = null; changed = true; }
      if (changed) paintPaper();
    };
    const onPaperKey = event => { if (paperOn && event.key === "Escape" && closePaperMenus()) { event.preventDefault(); event.stopPropagation(); } };
    document.addEventListener("click", onPaperOutside, true);
    document.addEventListener("keydown", onPaperKey, true);
    // 悬停在单位 / 配置物上：图鉴描述 + 身上效果的文字说明（unit-tip.js）
    const TIP_STATUS = { burn: "灼烧", shock: "感电", corr: "腐蚀", frostbite: "冻伤", shockwave: "震荡", reso: "共振", unstable: "不稳", weak: "虚弱", inspire: "振奋", sturdy: "坚挺", hide: "躲藏", advantage: "优势", chase: "紧追", blind: "目盲" };
    const TIP_INSTANT = { melt: "熔融", sting: "刺骨", overload: "过载", shift: "错位", spread: "扩散", refract: "折射", iceNext: "冰冻+50%" };
    const TIP_SELF = { burn: "自焚", frost: "霜结", splash: "溅射", conductor: "导体", anchor: "千钧", store: "蓄能", doppler: "多普勒", frenzy: "狂暴" };
    const TIP_ATK = { combust: "爆燃", icebreak: "破冰", bolt: "雷击", etch: "蚀刻", backflow: "倒流", inertia: "惯性", diffract: "衍射" };
    const TIP_GAP = { open: "畅通", wall: "危墙", bridge: "不稳桥梁", door: "机关门", void: "空隙", wave: "驻波墙" };
    const TIP_ELE = { fire: "火", acid: "酸", electric: "电", ice: "冰", energy: "能量", physical: "物理", harmonic: "谐波" };
    /** 间隔现在的样子：「危墙（耐久 12）」「机关门（关着）」 */
    const gapStateTip = (g) => !g ? "畅通" : (TIP_GAP[g.type] || "间隔") +
      (g.type === "wall" || g.type === "bridge" ? `（耐久 ${Number(g.hp) || 0}）` : g.type === "door" ? (g.open ? "（开着）" : "（关着）") : "");
    /** 说明的是哪一个：{ gapKey } 两区之间的间隔 / { propId } 配置物 / { unitId } 单位。
     *  refOf：战场上点 / 悬停给的 id（旧画面的单位卡、新画面的铭牌：单位 id、prop:…、gap:…）；refOfNode：旧画面悬停到的单位卡 / 间隔竖条 */
    const refOf = id => { const s = String(id == null ? "" : id); return s.indexOf("gap:") === 0 ? { gapKey: s.slice(4) } : s.indexOf("prop:") === 0 ? { propId: s.slice(5) } : { unitId: s }; };
    const refOfNode = node => node.classList && node.classList.contains("g-gap") && node.dataset.key ? { gapKey: node.dataset.key } : node.dataset.propId ? { propId: node.dataset.propId } : { unitId: node.dataset.unitId };
    const refKey = ref => !ref ? "" : ref.gapKey != null ? "gap:" + ref.gapKey : ref.propId != null ? "prop:" + ref.propId : String(ref.unitId || "");
    /** 说明的内容（unit-tip.js · html）：opt 原样交过去（{ brief, more }：悬停的简短版；不给是完整版，详情面板用）。
     *  不在战场上了（拿掉、藏起来、被打倒的敌人、摧毁的配置物）给 "" */
    function tipHtml(ref, opt) {
      const T = global.UnitTip, data = displayState || view.state || {};
      if (!T || !ref) return "";
      // 两区之间的间隔（危墙、桥、驻波墙……）：和本机画面一样写名字、耐久 / 开关，驻波墙另写它过滤的属性和降幅 / 增幅
      if (ref.gapKey != null) {
        const key = String(ref.gapKey), gp = (data.gaps || {})[key] || {}, where = "（" + key.replace("-", "–") + " 区之间）";
        if (gp.type === "wave" && gp.wave) {
          const w = gp.wave, el = TIP_ELE[w.el] || "?", amp = w.mode === "amplify";
          const text = `这一道过滤${el}属性，${amp ? "增幅" : "降幅"}：穿过它的${el}属性伤害${amp ? "提高，击破照常" : "降低，并且不造成任何击破"}；任何单位穿过时${amp ? "获得坚挺和振奋" : "受到不稳和虚弱"}。`;
          return T.html({ kind: "gap", gapType: "wave", text }, [], { name: `驻波墙·${el}·${amp ? "增幅" : "降幅"}${where}`,
            sub: w.saved && w.saved.type && w.saved.type !== "open" ? "暂时取代：" + gapStateTip(w.saved) : "" }, opt);
        }
        return T.html({ kind: "gap", gapType: gp.type || "open" }, [], { name: (TIP_GAP[gp.type || "open"] || "间隔") + where,
          sub: gp.type === "wall" || gp.type === "bridge" ? `耐久 ${Number(gp.hp) || 0}` : gp.type === "door" ? (gp.open ? "开着" : "关着") : "" }, opt);
      }
      if (ref.propId != null) {
        const p = (data.props || []).find(x => String(x.id) === String(ref.propId));
        if (!p || p.destroyed || p.hidden) return "";
        return T.html({ kind: "prop", propKind: p.kind }, [], { name: p.name || p.kind, sub: [p.hp != null ? `耐久 ${p.hp}${p.maxHp == null ? "" : "/" + p.maxHp}` : "", p.zone + " 区"].filter(Boolean).join(" · ") }, opt);
      }
      const u = (data.units || []).find(x => x.id === ref.unitId);
      if (!u || u.hidden || (u.dead && !u.isPlayer)) return "";
      const st = u.statuses || {}, tokens = [];
      if (u.dead) tokens.push(u.isPlayer ? "倒下" : "");
      if (u.dying && !u.dead) tokens.push("濒死");
      if (u.stunned && !u.dead) tokens.push("失衡");
      if (u.flying) tokens.push("飞行");
      Object.keys(TIP_STATUS).forEach(k => { if (st[k]) tokens.push(k === "burn" && Number(st.burn) > 0 ? "灼烧×" + st.burn : TIP_STATUS[k]); });
      if (st.high) tokens.push("高能 " + (Number(u.highEnergy) || 0));
      else if (Number(u.highEnergy) > 0) tokens.push("蓄能 " + Number(u.highEnergy));   // 蓄能攒的高能值，不算高能（#52）
      Object.keys(TIP_INSTANT).forEach(k => { if ((u.instant || {})[k]) tokens.push(TIP_INSTANT[k]); });
      if (TIP_SELF[u.self] && !(u.self === "store" && !st.high && Number(u.highEnergy) > 0)) tokens.push(TIP_SELF[u.self] + (u.self === "burn" && Number(u.selfBurnStacks) > 1 ? "×" + u.selfBurnStacks : ""));
      ((u.resources || {}).nextAtkFx || []).forEach(k => { if (TIP_ATK[k]) tokens.push(TIP_ATK[k]); });
      (u.marks || []).forEach(m => tokens.push(m === "needle" ? "刺入" : m === "bond" ? "牵挂" : ""));
      // 载具：和车合并的驾驶员按车写（和本机画面一样，game.js · unitTipHtml）——乘员和驾驶员写在乘员名单里，不当成身上的效果
      const vc = u.vehicle && typeof u.vehicle === "object" ? u.vehicle : null;
      statusTokens(u).forEach(t => { if (!tokens.includes(t) && !(vc && (t === vc.seatText || /^驾驶员[:：]/.test(t)))) tokens.push(t); });
      const owner = u.weaponOf ? (data.units || []).find(x => x.kit === u.weaponOf && !x.weaponOf) : null;
      const kind = u.isPlayer ? (u.escort ? "escort" : u.weaponOf || u.weaponUnit ? "weapon" : "hero") : "enemy";
      // 首领机制的倒计时：主机投影好的 display.marks / casts（online-view.js），这里只拼文字
      const mechs = global.UnitCard && global.UnitCard.mechLines ? global.UnitCard.mechLines({ marks: (u.display || {}).marks, casts: (u.display || {}).casts }) : [];
      if (vc) return T.html({ kind: "prop", propKind: vc.kind }, tokens.filter(Boolean), { name: vc.name || u.name || u.id, sub: `Lv${vc.level || 1} · ${u.zone} 区 · ${u.isPlayer ? "我方" : "敌方"}`, mechs,
        rows: Array.isArray(vc.roster) ? vc.roster : null, rowsTitle: vc.seatText || "" }, opt);
      // 分阶段的首领 / 精英：主机算好的阶段编号（display.stage），能力只列这一阶段的，和单机一样
      return T.html({ kind, kit: u.kit, ownerName: owner && owner.name, escort: u.escort, stage: (u.display || {}).stage }, tokens.filter(Boolean), { name: u.name || u.id, sub: `Lv${u.level || 1} · ${u.zone} 区`, mechs }, opt);
    }
    /** 悬停说明（旧画面的单位卡 / 间隔竖条、新画面的铭牌）：只出简短版——名字、行动方式、效果名字、首领机制的倒计时，末尾提示点一下看全部
     *  （作者 10/20 定：以前首领的悬停说明占满整屏、盖住被悬停的卡，最后几行被「回到…」按钮挡住）。详情面板正开着这一个就不弹 */
    function unitTip(node) {
      const ref = refOfNode(node);
      if (detailOpen() && refKey(ref) === refKey(detailRef)) return "";
      return tipHtml(ref, { brief: true, more: UNIT_DETAIL.more });
    }
    /* 单位详情面板（作者 10/20 定）：不在选目标时点一下单位 / 配置物 / 间隔（手机上轻点；手机没有悬停，以前根本看不到敌人说明）打开完整说明——
     * 桌面靠右、手机贴底，自带滚动条（hud-icons.css · .ut-panel），跟着战场刷新；✕、Esc、再点同一个收起，点别的换成别的。
     * Esc 先收它：暂停菜单那边登记了「开着就不开菜单」（PauseMenu.addBlocker，见下面的 pauseItems），这里在捕获阶段收起、不往下传（选着技能时这一下不取消技能） */
    const detailBox = make("aside", "online-unit-detail", "ut-panel", { role: "dialog", "aria-label": UNIT_DETAIL.label });
    detailBox.hidden = true;
    let detailRef = null;
    const detailOpen = () => !!detailRef && !detailBox.hidden;
    /** 照这一刻的战场重画面板（内容一样不动，滚到哪留在哪）；不在联机玩家的战斗画面了、说明的东西不在战场上了就收起 */
    function paintDetail() {
      const inBattle = view.active && !view.isHost && !stage.hidden && (view.screen === "battle" || view.screen === "ended");
      const body = detailRef && inBattle ? tipHtml(detailRef) : "";
      if (!body) { closeDetail(); return; }
      const h = `<button type="button" class="ut-close" data-ut-close aria-label="${esc(UNIT_DETAIL.close)}" title="${esc(UNIT_DETAIL.close)}">✕</button>${body}`;
      if (detailBox.dataset.html !== h) { const top = detailBox.scrollTop; detailBox.innerHTML = h; detailBox.dataset.html = h; detailBox.scrollTop = top; }
      detailBox.hidden = false;
    }
    /** 点了一下（id：单位 id、prop:…、gap:…）：打开这一个的详情；正开着的就是它 = 收起 */
    function openDetail(id) {
      const ref = refOf(id);
      if (detailOpen() && refKey(detailRef) === refKey(ref)) { closeDetail(); return; }
      detailRef = ref; detailBox.dataset.html = "";
      if (global.UnitTip) global.UnitTip.hide();
      paintDetail();
      if (!detailBox.hidden) detailBox.scrollTop = 0;
    }
    function closeDetail() {
      detailRef = null;
      if (detailBox.hidden && !detailBox.dataset.html) return;
      detailBox.hidden = true; detailBox.dataset.html = ""; detailBox.innerHTML = "";
    }
    detailBox.addEventListener("click", event => { if (event.target.closest && event.target.closest("[data-ut-close]")) closeDetail(); });
    const onDetailKey = event => {
      if (event.key !== "Escape" || event.defaultPrevented || !detailOpen()) return;
      const t = event.target;
      if (t && t.closest && t.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])")) return;   // 打字的时候 Esc 留给输入框
      // 上面还盖着别的弹窗（房间面板、背包、协助询问……）：这一下 Esc 是关它的（别人在回答的询问只挂一条小提示，不算）
      if (global.PauseMenu && global.PauseMenu.visibleLayers().some(el => el !== detailBox && !el.classList.contains("hs-ask-mini"))) return;
      event.preventDefault(); event.stopPropagation();
      closeDetail();
    };
    document.addEventListener("keydown", onDetailKey, true);
    const hoverable = (t) => t && t.closest && t.closest("[data-unit-id], [data-prop-id], .g-gap[data-key]");
    stage.addEventListener("mouseover", event => {
      const node = hoverable(event.target);
      if (!node || !global.UnitTip || (global.matchMedia && global.matchMedia("(hover: none)").matches)) return;
      const h = unitTip(node);
      if (h) global.UnitTip.show(node, h);
    });
    stage.addEventListener("mouseout", event => {
      const node = hoverable(event.target);
      if (node && !node.contains(event.relatedTarget)) global.UnitTip?.hide();
    });
    // 中文输入法正在拼字时，不重画含有正在输入的输入框的区域（重画会把拼到一半的字打断），拼完再补画
    let composing = false, deferred = false;
    const onCompStart = () => { composing = true; };
    const onCompEnd = () => { composing = false; if (deferred) { deferred = false; setTimeout(() => { if (!destroyed) render(); }, 0); } };
    document.addEventListener("compositionstart", onCompStart, true);
    document.addEventListener("compositionend", onCompEnd, true);
    // 「消息」「大厅交流」这类自带滚动条的列表（data-keep-scroll）：整块重画会换成新的列表、滚动位置归零，
    // 以前每来一条消息就跳回最上面。记下玩家把每个列表滚到了哪：在底部（或从没滚过）就继续贴底看新消息，往上翻着看旧的就停在原处
    const keptScroll = {};
    const onListScroll = e => {
      const el = e.target;
      if (!el || !el.dataset || !el.dataset.keepScroll) return;
      keptScroll[el.dataset.keepScroll] = { top: el.scrollTop, bottom: el.scrollHeight - el.scrollTop - el.clientHeight < 24 };
    };
    document.addEventListener("scroll", onListScroll, true);
    function restoreScroll(node) {
      node.querySelectorAll("[data-keep-scroll]").forEach(el => {
        const kept = keptScroll[el.dataset.keepScroll];
        el.scrollTop = !kept || kept.bottom ? el.scrollHeight : kept.top;
      });
    }
    function html(node, markup, key) {
      if (lastMarkup[key] === markup) return;
      if (composing && node.contains(document.activeElement)) { deferred = true; return; }
      const focused = document.activeElement, id = focused && node.contains(focused) ? focused.id : "";
      const start = focused && typeof focused.selectionStart === "number" ? focused.selectionStart : null;
      const nodeTop = node.scrollTop;
      lastMarkup[key] = markup; node.innerHTML = markup;
      if (nodeTop) node.scrollTop = nodeTop;   // 面板 / 舞台自己的滚动位置也不动
      restoreScroll(node);
      if (id && byId(id)) { const el = byId(id); el.focus({ preventScroll: true }); if (start != null && el.setSelectionRange) { try { el.setSelectionRange(start, start); } catch (_) {} } }
    }
    function entryMarkup() {
      const slots = typeof api.slots === "function" ? api.slots() : [];
      return `<div class="ol-card"><header><h2>${entry === "create" ? "联机开房" : "加入房间"}</h2>${button("关闭", "close")}</header><div class="ol-entry-tabs">${button("我来主持", "createTab", "", pending, entry === "create")}${button("加入朋友", "joinTab", "", pending, entry === "join")}</div><details class="ol-relay"${form.url.trim() ? " open" : ""}><summary>转发服务：${form.url.trim() ? "自定义" : "默认"}（一般不用改）</summary><label>转发服务地址（空着 = 默认）<input id="ol-url" data-field="url" type="url" placeholder="${esc(DEFAULT_RELAY)}" value="${esc(form.url)}" autocomplete="url"></label></details><label>昵称<input id="ol-name" data-field="name" maxlength="24" value="${esc(form.name)}" autocomplete="nickname"></label>${entry === "create" ? `<label>玩法<select id="ol-mode" data-field="mode">${option("trpg", "跑团（我当主持人）", form.mode !== "rogue")}${option("rogue", "联机单局（Roguelike，一起闯）", form.mode === "rogue")}</select></label>` : ""}${entry === "create" && form.mode === "rogue" ? `<p class="ol-muted">联机单局：创建后你先选队伍出发，再把角色分给进房间的朋友。路线大家投票决定，钱各算各的，战利品按需求分。</p>` : entry === "create" ? `<label>跑团存档<select id="ol-slot" data-field="slot">${slots.map(s => option(s.index, `${s.index + 1} · ${s.name}`, String(s.index) === form.slot)).join("")}</select></label><label>新团名称<input id="ol-campaign" data-field="campaignName" maxlength="40" placeholder="空白存档使用此名称" value="${esc(form.campaignName)}"></label>` : `<label>房间码<input id="ol-code" data-field="roomCode" maxlength="16" autocapitalize="characters" spellcheck="false" placeholder="六位房间码" value="${esc(form.roomCode)}"></label>`}<p class="ol-muted">${entry === "create" ? "创建后把房间码发给朋友。" : "填朋友发来的房间码就能进去。"}大家都用默认的转发服务就行。进入房间后，断线会自动尝试重连。</p><footer>${button(pending ? "连接中…" : entry === "create" ? "创建房间" : "加入", "connect", "", pending, true)}${pending && api.cancelConnect ? button("取消", "cancelConnect") : ""}${api.hasSaved?.() ? button("恢复上次房间", "resume", "", pending) : ""}</footer><p class="ol-notice" role="status">${esc(notice)}</p></div>`;
    }
    function rosterMarkup() {
      const heroes = view.heroes || [], mayAssign = view.isHost && ["lobby", "exploration", "ended"].includes(view.screen);
      // 联机跑团：主持人在大厅 / 探索时直接勾选队员（单机的「队伍」页被房间面板挡着）
      const choices = mayAssign && view.mode !== "rogue" && api.partyChoices ? api.partyChoices() : [];
      const partyPicker = choices.length ? `<section class="ol-party-pick" aria-label="队员"><h3>队员</h3><p class="ol-muted">勾选这次跑团的角色。换人后，留下来的角色还是原来的人操控，新加入的先归主持人。</p><div class="ol-party-list">${choices.map(c => `<label class="ol-check"><input type="checkbox" data-party-kit="${esc(c.kit)}"${(partyDraft ? partyDraft.includes(c.kit) : c.on) ? " checked" : ""}> ${esc(c.name)}</label>`).join("")}</div>${button("按勾选换队员", "setParty", "", disabled())}</section>` : "";
      return `<section><h3>房间成员</h3><ul class="ol-roster">${players().map(p => `<li><span><b>${esc(p.name)}</b>${p.gm ? ' <small>主持人</small>' : ""}</span><span class="${p.online ? "ol-online" : "ol-muted"}">${p.online ? "在线" : "离线"}</span><small>${esc(heroes.filter(h => h.owner === p.id).map(h => h.name).join("、") || (p.gm ? "未分配角色由主持人操作" : "等待分配角色"))}</small>${view.isHost && !p.gm ? seatTools(p) : ""}</li>`).join("")}</ul>${mayAssign ? `<h3 id="ol-assign-head">角色分配</h3><div class="ol-assignments">${heroes.map(h => `<label><span>${esc(h.name)}</span><select data-assign="${esc(h.id)}" aria-label="${esc(h.name)}的玩家">${players().map(p => option(p.id, p.name + (p.gm ? " · 主持人" : ""), (assignments[h.id] || h.owner) === p.id)).join("")}</select></label>`).join("")}</div>${button("保存角色分配", "assign", "", disabled() || !heroes.length)}` : view.isHost && view.screen === "battle" ? transferMarkup(heroes) : ""}</section>${partyPicker}`;
    }
    /** 战斗中转交角色（只在两个单位的回合之间；不满足时按钮灰掉并写明原因；联机单局不能转交） */
    function transferMarkup(heroes) {
      if (view.mode === "rogue" || typeof api.transfer !== "function") return '<p class="ol-muted">联机单局开局后座位固定，不能转交；玩家掉线可以先「接管」。</p>';
      const gate = typeof api.transferState === "function" ? api.transferState() : { ok: false, reason: "这个版本不支持转交" };
      const rows = heroes.map(h => { const to = transferDraft[h.id] || own(); return `<label><span>${esc(h.name)}</span><select data-transfer="${esc(h.id)}" aria-label="${esc(h.name)}转交给"${gate.ok ? "" : " disabled"}>${players().map(p => option(p.id, p.name + (p.gm ? " · 主持人（收回）" : ""), to === p.id)).join("")}</select>${button("转交", "transfer", `data-hero="${esc(h.id)}"`, !gate.ok || pending)}</label>`; }).join("");
      return `<h3>战斗中转交角色</h3><p class="ol-muted">只能在两个单位的回合之间转交，武器人跟着角色一起转；一名玩家可以操控几名角色；玩家掉线可以先「接管」。</p>${gate.ok ? "" : `<p class="ol-muted" role="status" data-transfer-reason>现在不能转交：${esc(gate.reason)}</p>`}<div class="ol-assignments">${rows}</div>`;
    }
    /** 主持人对玩家座位的操作：掉线时「接管」他的角色（战斗中也行）；「释放座位」让丢了恢复令牌的人能用同一个昵称重新加入 */
    function seatTools(p) {
      const units = (view.packet?.view?.units || []).filter(u => u.owner === p.id);
      const take = !p.online && units.length ? button("接管", "takeOver", `data-player="${esc(p.id)}" title="由主持人替他操作 ${esc(units.map(u => u.name).join("、"))}"`, pending) : "";
      return `<span class="ol-seat-tools">${take}${button("释放座位", "releaseSeat", `data-player="${esc(p.id)}" data-name="${esc(p.name)}"`, pending)}</span>`;
    }
    function messagesMarkup() {
      const rows = historyRows;
      return `<section class="ol-messages"><h3>消息</h3><p class="ol-muted">消息保存在主持人设备；私信仅双方可见。</p>${typeof api.messageHistory === "function" && historyHasMore ? button(historyLoading ? "加载中…" : "查看更早消息", "messageHistory", "", historyLoading || paused()) : ""}<ol aria-live="polite" data-keep-scroll="messages">${rows.map(m => `<li data-message-id="${esc(m.id)}"><div><b>${esc(playerName(m.from))}</b> <small>${m.to === "all" ? "给全体" : m.from === own() ? "给 " + esc(playerName(m.to)) : "仅你可见"}</small></div><p>${esc(m.text)}</p></li>`).join("") || '<li class="ol-muted">还没有消息。</li>'}</ol><form id="ol-message-form">${view.isHost ? `<label>收件人<select id="ol-to" data-field="to">${option("all", "全体玩家", form.to === "all")}${players().filter(p => !p.gm).map(p => option(p.id, p.name, form.to === p.id)).join("")}</select></label>` : '<p class="ol-muted">回复只发送给主持人。</p>'}<label class="ol-sr-only" for="ol-message">消息正文</label><textarea id="ol-message" data-field="text" maxlength="2000" rows="3" placeholder="写一条消息…">${esc(form.text)}</textarea><button type="submit" class="ol-button ol-primary"${disabled() ? " disabled" : ""}>${view.isHost ? "发送消息" : "回复主持人"}</button></form></section>`;
    }
    function mergeMessages(rows) {
      const unique = new Map();
      for (const row of rows) if (row && typeof row.id === "string") unique.set(row.id, row);
      return [...unique.values()];
    }
    async function earlierMessages() {
      if (historyLoading || paused() || typeof api.messageHistory !== "function") return;
      const generation = historyGeneration;
      historyLoading = true; render();
      try {
        const page = await api.messageHistory(historyRows.length ? { beforeId: historyRows[0].id } : {});
        if (destroyed || generation !== historyGeneration) return;
        if (page?.ok === false) throw new Error(page.error || "历史消息暂时无法读取");
        if (page?.type !== "messageHistory" || !Array.isArray(page.messages)) throw new Error("没有收到有效的历史消息");
        historyRows = mergeMessages([...page.messages, ...historyRows]);
        historyHasMore = page.hasMore === true;
        // Reading earlier messages must not notify as if they just arrived.
        for (const row of page.messages) seenMessages.add(row.id);
      } catch (error) { if (generation === historyGeneration) notice = error.message || "历史消息暂时无法读取"; }
      finally { if (generation === historyGeneration) { historyLoading = false; render(); } }
    }
    /** 开局以后从暂停页面看大厅（#298）：大厅那张卡（房间码、连接、成员）和大厅交流（和「小队」频道是同一份聊天） */
    function lobbyCardMarkup() {
      return `<div class="ol-card ol-lobby-card"><header><div><span class="ol-muted">大厅</span><div class="ol-code-row"><h2 class="ol-code">${esc(view.roomCode)}</h2>${view.roomCode ? button("复制房间码", "copyCode") : ""}</div></div>${button("收起", "close")}</header><p class="ol-connection" role="status">${esc(paused() ? view.status?.connected ? "房主离线，等待恢复" : "连接中断，正在重连" : "已连接")}</p>${rosterMarkup()}${lobbyChatMarkup()}<p class="ol-notice" role="status">${esc(notice || view.notice || "")}</p></div>`;
    }
    function roomMarkup() {
      if (lobbyView && view.screen !== "lobby") return lobbyCardMarkup();
      const starting = view.screen === "lobby", canClose = !starting || view.isHost && view.mode === "rogue";
      return `<div class="ol-card"><header><div><span class="ol-muted">${starting ? "大厅" : "联机房间"}</span><div class="ol-code-row"><h2 class="ol-code">${esc(view.roomCode)}</h2>${view.roomCode ? button("复制房间码", "copyCode") : ""}</div></div>${canClose ? button("收起", "close") : ""}</header><p class="ol-connection" role="status">${esc(paused() ? view.status?.connected ? "房主离线，等待恢复" : "连接中断，正在重连" : "已连接")}</p>${rosterMarkup()}${starting ? `<footer>${view.isHost ? button(view.mode === "rogue" ? "开始" : "开始跑团", "start", "", disabled() || !players().some(p => !p.gm && p.online), true) + (view.mode === "rogue" && !(view.heroes || []).length ? '<p class="ol-muted">先在单局画面选好队伍、点「出发」，这里才能把角色分给大家。</p>' : "") : '<p class="ol-muted">等待房主分配角色并开始。</p>'}</footer>` : ""}${starting ? lobbyChatMarkup() : ""}${messagesMarkup()}<footer>${button("重新连接", "reconnect", "", pending)}${button(view.isHost ? "离开并保存" : "离开房间", "leave", "", pending)}</footer><p class="ol-notice" role="status">${esc(notice || view.notice || view.packet?.systemNotice || (view.storageError ? "本机保存失败，请保持页面打开并检查存储空间。" : ""))}</p></div>`;
    }
    function lobbyChatMarkup() {
      return `<section class="ol-messages ol-lobby-chat"><h3>大厅交流${dotMarkup(lobbyUnread, " ol-badge")}</h3><ol aria-live="polite" data-keep-scroll="lobby">${(hs().chat || []).map(m => `<li><b>${esc(m.name || m.operatorName || "玩家")}</b><p${artAttr(m.text)}>${esc(m.text)}</p></li>`).join("") || '<li class="ol-muted">在这里与所有人商量准备事项。</li>'}</ol><form id="ol-lobby-chat"><label class="ol-sr-only" for="ol-lobby-text">大厅聊天</label><input id="ol-lobby-text" data-field="chatText" maxlength="500" value="${esc(form.chatText)}" placeholder="所有人都能看到…"><button class="ol-button" type="submit"${disabled() ? " disabled" : ""}>发送到大厅</button></form></section>`;
    }
    /** 大厅交流（#207）：大厅里别人发的新消息先记成未读，「大厅交流」露出来了才算看到（seeLobbyChat）。
     *  开局后同一份聊天在「小队」频道里，那里有自己的红点，这里清零 */
    function observeLobbyChat() {
      if (view.screen !== "lobby") { lobbyUnread = 0; lobbySeen = null; return; }
      const rows = chatRows();
      if (!lobbySeen) { lobbySeen = new Set(rows.map(m => m.id)); return; }
      const fresh = rows.filter(m => m.id && !lobbySeen.has(m.id));
      fresh.forEach(m => lobbySeen.add(m.id));
      lobbyUnread += fresh.filter(m => m.operatorId !== own()).length;
    }
    /** 「大厅交流」最下面（新消息在那）露在房间面板里，算看到了 */
    function lobbyChatInView() {
      const list = panel.hidden ? null : panel.querySelector('[data-keep-scroll="lobby"]');
      if (!list) return false;
      const r = list.getBoundingClientRect(), box = panel.getBoundingClientRect();
      return r.height > 0 && r.bottom <= box.bottom + 2 && r.bottom >= box.top + Math.min(r.height, 40);
    }
    function seeLobbyChat() {
      if (destroyed || !lobbyUnread || !lobbyChatInView()) return;
      lobbyUnread = 0; paintDock(); paintPanel();
    }
    /** 跑团私人钱包（房主按收件人算好：自己的角色有余额，队友只有名字）：看余额、给队友转钱 */
    const purseDraft = { from: "", to: "", n: "" };   // 转账表单：包刷新重画时保留填了一半的值
    const shopDraft = { payer: "", qty: {} };              // 商店：由谁付、每件填的数量（包刷新时保留）
    /** 跑团商人（主持人开着的那家店，房主算好的 view.packet.shop）：玩家用自己角色的钱包买，积分兑换用队伍积分 */
    function shopMarkup() {
      const s = view.packet?.shop;
      if (!s || !Array.isArray(s.rows)) return "";
      const mine = ((view.packet?.purse || {}).heroes || []).filter(h => h.mine && h.amount != null);
      if (!mine.some(h => h.kit === shopDraft.payer)) shopDraft.payer = mine[0] ? mine[0].kit : "";
      const wallet = (mine.find(h => h.kit === shopDraft.payer) || {}).amount ?? 0;
      const groups = [];
      s.rows.forEach(r => { if (!groups.includes(r.group)) groups.push(r.group); });
      const z = (100 - s.discount) / 10;
      const rows = groups.map(g => `<h4>${esc(g || "商品")}</h4><ul class="ol-shop-rows">${s.rows.filter(r => r.group === g).map(r => {
        const n = Math.max(1, Number(shopDraft.qty[r.key]) || 1), out = r.stock === 0;
        return `<li><span class="ol-shop-name"><b>${esc(r.name)}</b>${r.hint ? `<small>${esc(r.hint)}</small>` : ""}</span>
          <span class="ol-shop-price">${r.price !== r.base ? `<s>${esc(r.base)}</s> ` : ""}<b>${esc(r.price)}</b> 奎支${r.stock != null ? ` · 剩 ${esc(r.stock)}` : ""}</span>
          <input type="number" min="1" step="1" value="${esc(n)}" data-shop-qty="${esc(r.key)}" aria-label="买几份">${button(out ? "卖完了" : "买", "shopBuy", `data-key="${esc(r.key)}"`, disabled() || out || !shopDraft.payer || wallet < r.price * n)}${why(out ? "卖完了" : !shopDraft.payer ? "先选付款人" : lack(wallet, r.price * n))}</li>`;
      }).join("")}</ul>`).join("");
      const pts = s.points ? `<h4>积分兑换（队伍商店积分 ${esc(s.points.have)}）</h4><div class="ol-shop-redeem">${s.points.rows.map(x => button(`${x.name} · ${x.points} 积分`, "shopRedeem", `data-item="${esc(x.item)}"`, disabled() || s.points.have < x.points) + why(s.points.have < x.points ? `还差 ${x.points - s.points.have} 积分` : "")).join("") || '<span class="ol-muted">这里没有能兑换的东西。</span>'}</div>` : "";
      const buyHtml = `${mine.length ? `<label>由谁付 <select data-shop-payer>${mine.map(h => option(h.kit, `${h.name}（${h.amount} 奎支）`, h.kit === shopDraft.payer)).join("")}</select></label>` : '<p class="ol-muted">你还没有操控的角色，不能买东西。</p>'}
        ${rows || '<p class="ol-muted">这家店还没有商品。</p>'}${pts}
        <p class="ol-muted">买到的东西进队伍背包；买东西照常攒商店积分。主持人关店后这里就收起来。</p>`;
      return `<section class="ol-shop" aria-label="商店"><header><h3>🛒 ${esc(s.name)}</h3>${s.discount ? `<span class="ol-q-tag ol-q-main">${esc(Number.isInteger(z) ? z : z.toFixed(1))} 折</span>` : ""}</header>
        ${s.note ? `<p class="ol-muted">${esc(s.note)}</p>` : ""}
        ${sellTabs("trpg", view.packet?.shopSell || null, buyHtml, () => sellModelTrpg(s))}</section>`;
    }
    function purseMarkup() {
      const p = view.packet?.purse;
      if (!p || !Array.isArray(p.heroes)) return "";
      const mine = p.heroes.filter(h => h.mine && h.amount != null);
      if (!mine.length) return "";
      const others = p.heroes.filter(h => !h.mine);
      const to = [["party", "队伍公账"]].concat(others.map(h => [h.kit, h.name]));
      return `<section class="ol-purse" aria-label="私人钱包"><h3>私人钱包</h3><div class="ol-points">${mine.map(h => `<span>${esc(h.name)} <b>${esc(h.amount)}</b> 奎支</span>`).join("")}</div>
        <div class="ol-purse-send"><label>从 <select id="ol-purse-from" data-purse="from">${mine.map(h => option(h.kit, h.name, h.kit === purseDraft.from)).join("")}</select></label>
        <label>转给 <select id="ol-purse-to" data-purse="to">${to.map(([k, n]) => option(k, n, k === purseDraft.to)).join("")}</select></label>
        <label><input type="number" id="ol-purse-n" data-purse="n" min="1" max="${esc(Math.max(1, Number((mine.find(h => h.kit === purseDraft.from) || mine[0]).amount) || 0))}" step="1" placeholder="数额" value="${esc(purseDraft.n)}" aria-label="转多少奎支"> 奎支</label>${button("转过去", "purseTransfer", "", disabled())}</div>
        <p class="ol-muted">任务的奎支报酬自动平分进各人钱包，个人任务的只进你自己的。转账会写进小队频道。</p></section>`;
    }
    /** 跑团工匠（主持人开了才有，房主算好的 view.packet.smith）：给自己的武器升级，加工费从这名角色的钱包出 */
    function trpgSmithMarkup() {
      const heroes = view.packet?.smith?.heroes || [];
      if (view.mode === "rogue" || !heroes.length) return "";
      const rows = heroes.map(h => `<li><b>${esc(h.name)}</b> <span class="ol-muted">钱包 ${esc(h.purse)} 奎支</span><ul>${h.weapons.map(w => {
        if (w.max) return `<li>${esc(w.name)} Lv${esc(w.lv)} · 已满级</li>`;
        const mats = w.mats.map(m => `<span class="${m.have >= m.need ? "" : "ol-bad"}">${esc(m.name)} ${esc(m.have)}/${esc(m.need)}</span>`).join("、");
        const data = `data-kit="${esc(h.kit)}" data-weapon="${esc(w.kit)}"`;
        return `<li>${esc(w.name)} Lv${esc(w.lv)} → ${esc(w.next)} <small>材料：${mats}</small>
          ${w.canSelf ? button("在工作站自己升（只耗材料）", "smithUpgrade", `${data} data-mode="self"`, disabled() || !w.enough) : ""}
          ${button(`找工匠升（${w.fee} 奎支）`, "smithUpgrade", `${data} data-mode="smith"`, disabled() || !w.enough || h.purse < w.fee, !w.canSelf)}</li>`;
      }).join("") || '<li class="ol-muted">没有可升级的武器</li>'}</ul></li>`).join("");
      return `<section class="ol-rogue-box ol-trpg-smith" aria-label="武器升级"><h3>🔨 武器升级（工匠开着）</h3><ul>${rows}</ul>
        <p class="ol-muted">材料从队伍背包出；加工费用参考价，从这名角色自己的钱包出。</p></section>`;
    }
    /** 跑团工坊（主持人开了才有）：制作已会的配方（程序掷骰，队友可打下手）、拆解背包里的东西；学配方由主持人教会 */
    const workshopDraft = { kit: "", helper: "" };
    function trpgWorkshopMarkup() {
      const heroes = view.packet?.workshop?.heroes || [];
      if (view.mode === "rogue" || !heroes.length) return "";
      if (!heroes.some(h => h.kit === workshopDraft.kit)) workshopDraft.kit = heroes[0].kit;
      const hero = heroes.find(h => h.kit === workshopDraft.kit);
      const others = (view.packet?.purse?.heroes || []).filter(h => h.kit !== hero.kit);
      if (!others.some(h => h.kit === workshopDraft.helper)) workshopDraft.helper = "";
      const recipes = hero.recipes.map(r => {
        const mats = r.mats.map(m => `<span class="${m.have >= m.need ? "" : "ol-bad"}">${esc(m.name)} ${esc(m.have)}/${esc(m.need)}</span>`).join(" + ");
        const can = r.known && r.chance > 0 && r.mats.every(m => m.have >= m.need);
        return `<li><b>${esc(r.name)}</b> <small>${esc(r.prof)} · ${esc(r.diffName)} · ${esc(r.hours)} 小时 · ${mats}${r.known ? ` · 成功率 ${esc(r.chance)}%` : ""}</small>
          ${r.known ? button("制作", "workshopCraft", `data-item="${esc(r.id)}"`, disabled() || !can) : '<span class="ol-muted">还不会（找主持人教会）</span>'}</li>`;
      }).join("");
      const salvage = hero.salvage.map(x => `<li>${esc(x.name)} ×${esc(x.qty)} → ${esc(x.yields)} ${button("拆一件", "workshopSalvage", `data-item="${esc(x.id)}"`, disabled())}</li>`).join("");
      return `<section class="ol-rogue-box ol-trpg-workshop" aria-label="工坊"><h3>⚙ 工坊（开着）</h3>
        <p><label>谁做 <select data-workshop="kit">${heroes.map(h => option(h.kit, h.name, h.kit === hero.kit)).join("")}</select></label>
        <label>打下手 <select data-workshop="helper">${[["", "没人帮"]].concat(others.map(h => [h.kit, h.name])).map(([k, n]) => option(k, n, k === workshopDraft.helper)).join("")}</select></label></p>
        <h4>制作</h4><ul>${recipes || '<li class="ol-muted">没有配方</li>'}</ul>
        <h4>拆解（不花时间）</h4><ul>${salvage || '<li class="ol-muted">背包里没有能拆的东西</li>'}</ul>
        <p class="ol-muted">制作由程序掷骰，会推进游戏时间；失败会损失一部分材料。学新配方要主持人教会。</p></section>`;
    }
    /** 「钱包与商店」：钱（公账 + 各人钱包）和花钱的地方（商店、工匠、工坊、诊所 · 义体）。道具清单只在「背包」里，这里不再重复列 */
    function suppliesMarkup(data) {
      const hint = `<p class="ol-muted ol-supplies-hint">这里是钱和花钱的地方：钱包、商店、工匠、工坊、诊所。队伍的道具在「背包」里看。</p>`;
      return `${hint}<section class="ol-supplies" aria-label="队伍公账"><div class="ol-points"><span>${view.packet?.purse ? "队伍公账" : "奎支"} ${esc(data.kuizhi ?? 0)}</span></div></section>${purseMarkup()}${shopMarkup()}${trpgSmithMarkup()}${trpgWorkshopMarkup()}${trpgCyberwareMarkup()}${trpgClinicMarkup()}`;
    }
    function suppliesCard(data) {
      return `<div class="ol-card ol-supplies-card"><header><h2>钱包与商店</h2>${button("关闭", "suppliesClose")}</header>${suppliesMarkup(data)}</div>`;
    }
    /** 舞台顶上的「钱包与商店」按钮（以前叫「物资」）：商店 / 工匠 / 工坊 / 诊所开着时带提示 */
    function suppliesButton() {
      // 联机单局：钱包、商店、工匠、诊所、工坊都在正文和队伍卡上，这个弹窗读的是跑团字段（单局里只剩临时公账，一般是 0）→ 不显示
      if (view.packet?.mode === "rogue") return "";
      const tags = [view.packet?.shop ? "🛒" : "", view.packet?.smith?.heroes?.length ? "🔨" : "", view.packet?.workshop?.heroes?.length ? "⚙" : "",view.packet?.clinic?.heroes?.length || view.packet?.cyberware?.heroes?.length ? "🦾" : ""].filter(Boolean).join("");
      return button(`钱包与商店${tags ? " · " + tags : ""}`, "supplies", (tags ? 'data-alert="1" ' : "") + 'title="钱包、商店、工匠、工坊、诊所（道具在「背包」）"');
    }
    function paintSupplies() {
      suppliesBox.hidden = !(suppliesOpen && view.active && !view.isHost);
      if (!suppliesBox.hidden) html(suppliesBox, suppliesCard(displayState || view.state || {}), "supplies");
    }
    function weatherMarkup(data) {
      const symbols = { none: "☀", heat: "♨", snow: "❄", acid: "☂", thunder: "ϟ", glow: "✦", sand: "≋", phase: "◒" };
      const weather = Object.hasOwn(symbols, data.weather) ? data.weather : "none";
      const details = [];
      if (weather === "sand" && /^[123]{2}$/.test(data.sandDir || "")) details.push(`风向 ${data.sandDir[0]} 区 → ${data.sandDir[1]} 区`);
      if (weather === "phase" && [0, 1, 2, 3].includes(data.phaseStep)) details.push(`相位 ${["波谷", "平衡", "波峰", "平衡"][data.phaseStep]}（${data.phaseStep}）`);
      if (data.weatherLocked) details.push("天气已锁定");
      return `<aside class="ol-weather ol-weather-${weather}" aria-label="天气"><span class="ol-weather-icon" aria-hidden="true">${symbols[weather]}</span><div><b>${esc(weather === "sand" ? "沙暴" : labels[weather])}</b>${details.length ? `<small>${esc(details.join(" · "))}</small>` : ""}</div></aside>`;
    }
    function resultMarkup() {
      const result = view.packet?.result || {}, grade = result.grade || {};
      const heading = { win: "战斗胜利", lose: "战斗失败", retreat: "队伍撤退" }[result.outcome] || "遭遇结束";
      const d = result.drops, dropText = d ? [d.kuizhi ? `${d.kuizhi} 奎支` : "", ...(d.items || []).map(x => `${x.name} ×${x.qty}`)].filter(Boolean).join("、") : "";
      return `<section class="ol-result" aria-label="战斗结算"><h2>${heading}</h2>${["D", "C", "B", "A", "S", "SS", "SSS"].includes(grade.grade) ? `<p class="ol-result-grade">评价 ${esc(grade.grade)}${grade.score == null ? "" : ` · ${esc(grade.score)} 分`}</p>` : ""}${grade.xpMult == null ? "" : `<p>战斗经验倍率 ×${esc(grade.xpMult)}</p>`}${dropText ? `<p class="ol-drops">战斗掉落：<b>${esc(dropText)}</b>（已放进队伍背包）</p>` : ""}<div class="ol-info-tools">${button("查看这场的战斗记录", "showLog")}${button("最近 10 场战绩", "info", 'data-info="record"', pending)}</div><p class="ol-muted">${view.packet?.mode === "rogue" ? "等房主点「继续」回到单局。" : "等待主持人返回探索。"}</p></section>`;
    }
    const ATTRS = { str: "力量", con: "体质", dex: "敏捷", wil: "意志", int: "智力", sta: "耐力" };
    /** 升级的属性点：玩家自己选，主持人确认后才加上 */
    function attrMarkup(u) {
      const pend = (hs().attrRequests || []).find(r => r.unitId === u.id && r.status === "pending");
      const last = (hs().attrRequests || []).filter(r => r.unitId === u.id && r.status !== "pending").slice(-1)[0];
      const lastText = last && Date.now() - (last.at || 0) < 10 * 60 * 1000 ? `<p class="ol-muted">上次申请 ${esc((last.attrs || []).map(a => ATTRS[a]).join("、"))} +1：${({ approved: "主持人已同意", rejected: "主持人没有同意", cancelled: "已撤回" })[last.status] || ""}</p>` : "";
      if (pend) return `<div class="ol-attr"><p>等主持人确认：${esc(pend.attrs.map(a => ATTRS[a]).join("、"))} +1</p>${button("撤回", "attrCancel", `data-request="${esc(pend.id)}"`, disabled())}</div>${lastText}`;
      if (!(Number(u.attrPoints) > 0)) return lastText;
      const picked = u.attrPicks || [];
      return `<div class="ol-attr"><p>有 ${esc(u.attrPoints)} 点属性点可以分配（选好后由主持人确认）</p><div class="ol-attr-btns">${Object.keys(ATTRS).map(k => button(`${ATTRS[k]} ${(u.attrs || {})[k] ?? ""} +1`, "attrRequest", `data-unit="${esc(u.id)}" data-attr="${k}"`, disabled() || (picked.length >= 1 && picked.includes(k)))).join("")}</div>${picked.length ? '<p class="ol-muted">8 级那一点不能加在曾经加过的同一项上。</p>' : ""}</div>${lastText}`;
    }
    /** 主持人发起的检定：自己的角色点「掷骰」；结果所有人都看得到 */
    function checksMarkup(compact) {
      const list = hs().checks || [];
      const open = list.filter(c => c.status === "open");
      const recent = list.filter(c => c.status !== "open" && Date.now() - (c.at || 0) < 15 * 60 * 1000).slice(-1);
      const mineIds = new Set((hs().units || []).filter(u => u.owner === own()).map(u => u.id));
      const rows = open.concat(recent);
      if (!rows.length) return "";
      // 战斗中：检定收成一行窄条（只列进行中的），把高度留给战场；说明放在悬停提示里
      if (compact) {
        if (!open.length) return "";
        return `<section class="ol-checks ol-checks-compact" aria-label="检定">${open.map(c => `<div class="ol-check-bar"${c.note ? ` title="${esc(c.note)}"` : ""}><b>${esc(c.diffName)}「${esc(c.prof)}」检定</b>${(c.targets || []).map(t => {
          const can = t.base > 0;
          const st = t.result ? `<b class="${t.result.ok ? "ol-ok" : "ol-bad"}">${t.result.ok ? "成功" : "失败"}</b>` : !can ? '<small class="ol-muted">0%</small>' : mineIds.has(t.unitId) ? button("掷骰", "checkRoll", `data-check="${esc(c.id)}" data-unit="${esc(t.unitId)}"`, disabled(), true) : '<small class="ol-muted">等待</small>';
          return `<span class="ol-check-who">${esc(t.name)}${can && !t.result ? ` <small>${Math.round((t.base || 0) * 1000) / 10}%</small>` : ""} ${st}</span>`;
        }).join("")}</div>`).join("")}</section>`;
      }
      return `<section class="ol-checks" aria-label="检定">${rows.map(c => `<article class="ol-check${c.status === "open" ? " ol-open" : ""}"><header><h3>${esc(c.diffName)}「${esc(c.prof)}」检定</h3><small>${c.status === "open" ? "进行中" : "已结束"}</small></header>${c.note ? `<p>${esc(c.note)}</p>` : ""}<ul>${(c.targets || []).map(t => {
        const can = t.base > 0;
        const odds = `成功率 ${Math.round((t.base || 0) * 1000) / 10}%${can && t.adv ? " · 优势" : can && t.dis ? " · 劣势" : ""}${can && t.reroll ? " · 失败可重掷" : ""}`;
        const res = t.result ? `<b class="${t.result.ok ? "ol-ok" : "ol-bad"}">${t.result.ok ? "成功" : "失败"}</b> <small>${esc(t.result.rolls.map(r => r.roll == null ? r.label : (r.label ? r.label + " " : "") + r.roll).join("，"))}</small>` : c.status === "open" && !can ? '<small class="ol-muted ol-check-no">成功率 0%：这项熟练不够、这个难度没法尝试，由主持人决定怎么处理</small>' : c.status === "open" && mineIds.has(t.unitId) ? button("掷骰", "checkRoll", `data-check="${esc(c.id)}" data-unit="${esc(t.unitId)}"`, disabled(), true) : '<small class="ol-muted">等待掷骰</small>';
        return `<li><span><b>${esc(t.name)}</b><small>${esc(odds)}</small></span>${res}</li>`;
      }).join("")}</ul></article>`).join("")}</section>`;
    }
    /** 聚焦：和本地卡片一样写成「聚焦护甲 火→[冰]→电」（方括号是下一步要的属性） */
    function focusTokens(u) {
      const ele = { fire: "火", acid: "酸", electric: "电", ice: "冰", energy: "能量", physical: "物理", harmonic: "谐波" };
      const layer = { flesh: "肉体", armor: "装甲", shield: "护盾", sand: "沙尘", spirit: "星灵" };
      return (u.focuses || []).map(f => "聚焦" + (layer[f.layerType] || f.layerType) + " " + (f.seq || []).map((e, i) => i === f.step ? "[" + (ele[e] || e) + "]" : (ele[e] || e)).join("→"));
    }
    /** 高能值：淡青绿色的液体灌进一条总血条，液面越过血量就会自爆 */
    /** 主机算好的状态行（和本地卡片一样）；旧主机没发就只拼聚焦 */
    function statusTokens(u) {
      const st = u.display && u.display.status;
      return typeof st === "string" && st ? st.split(" · ").filter(Boolean) : focusTokens(u);
    }
    function highBar(u) {
      const he = Number(u.highEnergy) || 0; if (he <= 0) return "";
      const max = (u.layers || []).reduce((a, l) => a + (Number(l.max) || 0), 0) || 1, cur = (u.layers || []).reduce((a, l) => a + Math.max(0, Number(l.current) || 0), 0);
      return `<div class="ol-high" title="高能 ${esc(he)}：血量低于高能值时自爆"><span>高能</span><div class="ol-high-track"><i class="ol-high-hp" style="width:${Math.min(100, cur / max * 100)}%"></i><i class="u-high${he >= cur * 0.75 ? " danger" : ""}" style="width:${Math.min(100, he / max * 100)}%"></i></div><b>${esc(he)} / ${esc(cur)}</b></div>`;
    }
    function card(u) {
      const owner = (hs().units || []).find(x => x.id === u.id)?.owner;
      const resources = Object.entries(u.resources || {}).filter(([k, v]) => names[k] && (typeof v === "number" || v === true)).map(([k, v]) => `${names[k]} ${v === true ? "" : v}`);
      const conditions = Object.entries(u.statuses || {}).filter(([k, v]) => names[k] && v).map(([k, v]) => `${names[k]}${typeof v === "number" && v !== 1 ? " " + v : ""}`);
      // 状态 / 效果画成图标（hud-icons.js）；没有图标模块时还是写字
      const HI = global.HudIcons, badges = HI ? HI.unitBadges(u, u.marks) : [];
      if (HI) conditions.length = 0;
      if (u.dying) conditions.unshift("倒地"); if (u.dead) conditions.unshift("阵亡"); if (u.stunned) conditions.unshift("失衡"); if (u.flying) conditions.push("飞行"); conditions.push(...statusTokens(u).filter(t => !(HI && HI.covered(t)) && !conditions.includes(t)));
      const gauge = HI && u.hud && view.screen !== "exploration" ? HI.gauge(u.hud) : "";
      const available = view.screen === "battle" && u.isPlayer && owner === own() && hs().currentUnitId === u.id && hs().phase === "acting";
      return `<article class="ol-unit${u.isPlayer ? " ol-ally" : " ol-enemy"}${selectedActor === u.id ? " ol-selected" : ""}" data-unit-id="${esc(u.id)}"><header><h3>${esc(u.name || u.id)}</h3><small>Lv${esc(u.level || 1)}</small></header>${owner ? `<small>${esc(playerName(owner))}${u.weaponOf ? " · 武器人" : ""}</small>` : ""}${u.isPlayer && !u.weaponOf ? `<p class="ol-xp">经验 ${esc(u.xp ?? 0)}${typeof xpToNext === "function" && xpToNext(u.level || 1) ? ` / ${esc(xpToNext(u.level || 1))}` : ""}</p>` : ""}${view.screen === "exploration" && u.isPlayer && !u.weaponOf && owner === own() ? attrMarkup(u) : ""}<div class="ol-layers">${(u.layers || []).map(l => `<div class="ol-layer"><span>${esc(labels[l.type] || "生命")}</span><meter min="0" max="${esc(Math.max(1, Number(l.max) || 1))}" value="${esc(Math.max(0, Number(l.current) || 0))}" aria-label="${esc(labels[l.type] || "生命")}"></meter><b>${esc(l.current ?? 0)} / ${esc(l.max ?? 0)}</b></div>`).join("")}${highBar(u)}</div><div class="ol-points"><span>行动 ${esc(u.ap ?? 0)} / ${esc(u.apMax ?? 0)}</span><span>附赠 ${esc(u.bonus ?? 0)} / ${esc(u.bonusMax ?? 0)}</span>${u.def != null ? `<span>架势 ${esc(u.def)} / ${esc(u.defMax ?? u.def)}</span>` : ""}</div>${gauge ? `<div class="hi-gauge ol-gauge" aria-label="${esc(u.name || "")}的角色仪表">${gauge}</div>` : resources.length ? `<p class="ol-muted">${esc(resources.join(" · "))}</p>` : ""}${badges.length ? `<div class="hi-badges ol-badges">${badges.map(b => HI.badge(b.key, b.stack, b.title)).join("")}</div>` : ""}${conditions.length ? `<p class="ol-conditions">${esc(conditions.join(" · "))}</p>` : ""}${available ? button("选择行动", "actor", `data-actor="${esc(u.id)}"`, disabled(), true) : ""}<span class="ol-popup" aria-live="polite"></span></article>`;
    }
    /* ---------- 联机单局（online-rogue.js 在房主那里算好，按收件人发来） ---------- */
    // 按钮灰掉要写原因：off 传字符串 = 灰掉，并把这句话写在按钮旁边
    const why = text => text ? `<small class="ol-why">${esc(text)}</small>` : "";
    const lack = (have, need) => Number(have) < Number(need) ? `还差 ${Math.ceil(Number(need) - Number(have))} 奎支` : false;
    const rogueAct = (text, cmd, off = false, primary = false) => button(text, "rogueAct", `data-cmd="${esc(JSON.stringify(cmd))}"`, disabled() || !!off, primary) + why(typeof off === "string" ? off : "");
    /** 装件前后对比：只算选中的那一个（房主算好的 smith.installPreviews） */
    function partCompare(r, part, slot) {
      if (!slot || !r.smith || !global.ModCompare) return "";
      const list = r.smith.installPreviews || [];
      const p = list.find(x => x.weapon === slot.kit && x.slot === slot.slot && (x.part === part || "part_" + x.part === part));
      return p ? ModCompare.text(p) : "";
    }
    /** 克制表：房主算好发来的 view.matchup（不含坚毅）；玩家端不自己算 */
    // 房主的 matchup 按他当前行动的单位算；玩家这边按自己选中的单位（选行动时的那个，没有就当前轮到的自己的单位）改冻土再算
    const matchupOf = () => {
      const m = view.matchup || view.packet?.matchup || null;
      if (!m || !global.MatchupUI) return m;
      const st = displayState || view.state || {}, cur = hs().currentUnitId;
      const mine = (hs().units || []).some(u => u.id === cur && u.owner === own());
      return global.MatchupUI.viewChart(m, st, selectedActor || (mine ? cur : null));
    };
    function openWorkshop(mat) {
      if (!global.WorkshopUI || !global.WorkshopData) return;
      // 学配方 / 拆解：从工坊里选中的那名角色出钱、拆他的东西（一个玩家操控多名角色时不能总用第一个）
      const payerOf = () => WorkshopData.payerKit(view.packet?.rogue, global.WorkshopUI && global.WorkshopUI.state.kit);
      WorkshopUI.open(() => { const r = view.packet?.rogue; return r ? WorkshopData.viewWorkshopModel(r) : null; },
        cmd => { if (disabled()) return; const c = ["learnRecipe", "salvage"].includes(cmd.action) ? Object.assign({ payer: payerOf() }, cmd) : cmd; call(() => api.submit({ type: "rogue.act", command: c })); },
        { mat: mat || "" });
    }
    /* 诊所 · 义体（cyberware-ui.js）：读 online-view 投影后的 packet.cyberware = { heroes:[{kit,name,purse,view,shop,previews}] }
     * 单局：指令走 rogue.act（install/removeCyberware）；跑团（诊所开着时）：cyberwareInstall / cyberwareRemove，从这名角色的钱包出，不用主持人同意 */
    function cyberwareSrc() { const p = view.packet; return p && p.cyberware && (p.cyberware.heroes || []).length ? p : null; }
    function cyberwareCommand(cmd) {
      if (view.mode === "rogue") return { type: "rogue.act", command: cmd };
      return { type: cmd.action === "removeCyberware" ? "cyberwareRemove" : "cyberwareInstall", kit: cmd.kit, id: cmd.id };
    }
    function openCyberware() {
      if (!global.CyberwareUI) return;
      CyberwareUI.open(() => { const src = cyberwareSrc(); return src ? CyberwareUI.viewModel(src) : null; },   // 每次重画都读最新的包：钱包 / 预览 / 已装列表
        cmd => { if (disabled()) return; call(() => api.submit(cyberwareCommand(cmd))); });
    }
    /** 跑团诊所开着时的入口（和下面旧的血量层改造申请并列） */
    function trpgCyberwareMarkup() {
      const src = view.mode !== "rogue" && global.CyberwareUI ? cyberwareSrc() : null;
      if (!src) return "";
      const hs = src.cyberware.heroes;
      return `<section class="ol-rogue-box ol-cw-entry ol-trpg-cw" aria-label="诊所 · 义体"><h3>🦾 诊所：义体</h3>
        <p class="ol-muted">${hs.map(h => `${esc(h.name)} 的钱包 ${esc(h.purse)} 奎支 · 改造率 ${esc(h.view.rate)}% / ${esc(h.view.cap)}%`).join("<br>")}</p>
        <p class="ol-muted">装 / 拆从这名角色自己的钱包出，不用主持人同意；结果会发到小队频道。</p>
        <div class="ol-attr-btns">${button("打开诊所 · 义体", "trpgCyberware", "", disabled(), true)}</div></section>`;
    }
    /** 「背包」：队伍的全部道具，用和房主同一个背包浮层（backpack-ui.js）。单局用单局的数据（含各人名下的）；
     *  跑团用舞台上的 state.bag（online-view.js · projectState 白名单：道具 id / name / qty，外加 water），
     *  说明（hint）在本地查道具目录（和房主 bagDetail 同一套）；战斗中只读 */
    function trpgBagModel() {
      // 背包不参与动画：直接读最新的包（view.state），不读 displayState——render() 里 refresh 在 displayState 赋值之前，读它会慢一包
      const bag = (view.state || {}).bag || {}, inBattle = view.screen !== "exploration";
      const catOf = id => (global.WorkshopData && global.WorkshopData.itemCategory(id)) || "consumable";
      const shared = { material: [], consumable: [], mod: [], key: [] };
      (bag.items || []).filter(x => x && Number(x.qty) > 0).forEach(x => {
        const c = typeof ITEM_CATALOG !== "undefined" ? ITEM_CATALOG[x.id] : null;
        const k = shared[catOf(x.id)] ? catOf(x.id) : "consumable";   // 图纸已登记进 ITEM_CATALOG（rogue-data.js），按目录分到「改装件」
        shared[k].push({ id: x.id, name: x.name || (c && c.name) || x.id, qty: Number(x.qty), hint: (c && c.hint) || "", category: k });
      });
      return { readOnly: inBattle, inBattle, workshop: null, views: [{ name: "队伍", shared, personal: null }], cyber: [],
        uses: global.WorkshopData ? global.WorkshopData.recipesUsingMaterial : () => [],
        note: `水 ${Number(bag.water) || 0} ml · 队伍共用的道具；用道具在自己的行动里选「使用道具」，钱在「钱包与商店」。` };
    }
    function openBag() {
      if (!global.BackpackUI) return;
      if (view.packet?.mode === "rogue" && view.packet.rogue) return openBackpack();
      bagOpened = true;
      BackpackUI.open(() => view.active ? trpgBagModel() : null, { keep: true });
    }
    /** 只收自己（玩家端）打开的背包，不碰房主那边的背包浮层 */
    let bagOpened = false;
    function closeMyBag() { if (bagOpened && global.BackpackUI && global.BackpackUI.isOpen()) global.BackpackUI.close(); if (!(global.BackpackUI && global.BackpackUI.isOpen())) bagOpened = false; }
    function openBackpack() {
      bagOpened = true;
      if (!global.BackpackUI || !global.WorkshopData) return;
      BackpackUI.open(() => { const r = view.packet?.rogue; return r ? WorkshopData.viewBackpackModel(r, { battle: view.screen !== "exploration" }) : null; }, { openWorkshop: id => openWorkshop(id), keep: true });
    }
    /* ---------- 商店 · 买 / 卖页签（shop-sell-ui.js）：视图是房主算好的，这里只画；离开商店（包里没有卖出视图）就回到「买」 ---------- */
    const arrOf = v => Array.isArray(v) ? v : Array.isArray(v?.rows) ? v.rows : [];
    /** 联机单局：packet.rogue.shopSell（online-rogue.js · Rogue.shopSellView(r, { kits: mine })）：只有自己的英雄和公用 */
    const rogueSellView = r => r?.shopSell || null;
    function sellModelRogue(r, payer) {
      const heroes = (r.heroes || []).filter(h => !h.dead).map(h => ({ kit: h.kit, name: h.name, purse: h.mine ? h.purse : null, mine: h.mine }));
      return ShopSellUI.model(rogueSellView(r), { key: "rogue", heroes, mine: k => heroes.some(h => h.kit === k && h.mine), actor: payer,
        money: k => (heroes.find(h => h.kit === k) || {}).purse ?? null, disabled: disabled() });
    }
    function sellModelTrpg(s) {
      const heroes = ((view.packet?.purse || {}).heroes || []).map(h => ({ kit: h.kit, name: h.name, purse: h.mine ? h.amount ?? null : null, mine: h.mine }));
      return ShopSellUI.model(view.packet?.shopSell, { key: "trpg", heroes, mine: k => heroes.some(h => h.kit === k && h.mine), actor: shopDraft.payer,
        money: k => (heroes.find(h => h.kit === k) || {}).purse ?? null, disabled: disabled() });
    }
    function sellTabs(key, sellView, buyHtml, modelFn) {
      if (!global.ShopSellUI) return buyHtml;
      ShopSellUI.sync(key, !!sellView);
      const sell = ShopSellUI.tabOf(key) === "sell";
      return `<div class="ss-host" data-ss-host="${esc(key)}">${ShopSellUI.tabsHtml(key, { sellOff: !sellView })}${sell ? ShopSellUI.html(modelFn()) : buyHtml}</div>`;
    }
    /** 卖 / 买回：单局走 rogue.act；跑团是 shopSell / shopBuyback 消息。结果带 payout 时提示钱进了谁的钱包 */
    async function sellSubmit(cmd) {
      if (disabled()) return;
      const trpg = view.mode !== "rogue" && view.packet?.mode !== "rogue";
      const msg = !trpg ? { type: "rogue.act", command: cmd }
        : cmd.action === "sellItem" ? { type: "shopSell", kit: cmd.kit, id: cmd.id, qty: cmd.qty, owner: cmd.owner } : { type: "shopBuyback", kit: cmd.kit, token: cmd.token };
      // 提示不看这次 submit 的回执：房主算好的结果放在包里的 shopSell.last（只有卖的人看得到），observeSellLast 按 seq 只弹一次
      if (await call(() => api.submit(msg)) && global.Sfx) Sfx.ui("coin");
    }
    /** 卖 / 买回的结果：packet.rogue.shopSell.last（单局）或 packet.shopSell.last（跑团）= {seq,kind,by,ok,total,payout,msg}；
     * 每个 seq 只弹一次（之后的包还带着同一个 last 不再弹）；离开商店 last 变 null 时忘掉记录（seq 不会重复） */
    let sellSeen = null, sellHadView = false;
    function observeSellLast() {
      const sv = (view.packet?.mode === "rogue" ? view.packet?.rogue?.shopSell : view.packet?.shopSell) || null, last = sv ? sv.last || null : null;
      const appeared = !!sv && !sellHadView;   // 刚进店 / 刚连上：包里已经带着的旧结果不重播
      sellHadView = !!sv;
      if (!last) { sellSeen = null; return; }
      if (appeared || !global.ShopSellUI) { sellSeen = last.seq; return; }
      if (sellSeen !== null && last.seq <= sellSeen) return;
      sellSeen = last.seq;
      const heroes = view.packet?.rogue?.heroes || view.packet?.purse?.heroes || [];
      toast.textContent = ShopSellUI.toastText(last, k => k === "party" ? "队伍公账" : (heroes.find(h => h.kit === k) || {}).name || k);
      toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
    }
    function rogueMarkup(r) {
      const mine = (r.heroes || []).filter(h => h.mine), payer = mine[0] ? mine[0].kit : null, purse = mine[0] ? mine[0].purse : 0;
      const stageName = { board: "任务板", task: "任务途中", camp: "回城休整", boss: "幕末首领", interlude: "幕间", victory: "四幕通关", over: "本局结束" }[r.stage] || "";
      const head = `<header class="ol-stage-heading"><div><span class="ol-muted">${esc(view.roomCode)} · 联机单局 · ${esc(stageName)}</span><h1>第 ${esc(r.act)} 幕 · ${esc(r.region)}</h1><p class="ol-muted">第 ${esc(r.day)} 天 · 本幕剩 ${esc(r.daysLeft)}/${esc(r.daysPerAct)} 天${r.main ? r.main.done ? " · 主线已完成" : ` · 主线需 ${esc(r.main.days)} 天` : ""} · 队伍公用：水 ${esc(r.supplies.water)} ml · 食物 ${esc(r.supplies.food)} 份 · 距上次长休 ${esc(r.supplies.hours)} 小时</p><div class="ol-info-tools">${button("角色资料", "info", 'data-info="sheet"', pending)}${button("武器", "info", 'data-info="armory"', pending)}${button("背包", "info", 'data-info="bag" title="队伍的全部道具（材料、消耗品、改装件…）"')}${button("战绩", "info", 'data-info="record"', pending)}${suppliesButton()}</div></div></header>`;
      const over = r.result ? `<section class="ol-result"><h2>${r.result.win ? "通关" : "本局结束"}</h2><p>${esc(r.result.text)}</p></section>` : "";
      const heroes = `<section class="ol-rogue-party" aria-label="队伍">${(r.heroes || []).map(h => `<article class="ol-unit ol-ally${h.mine ? " ol-selected" : ""}"><header><h3>${esc(h.name)}</h3><small>Lv${esc(h.level)}${h.pending ? " · 待选升级" : ""}</small></header><small>${esc(h.ownerName)}${h.mine ? "（你）" : ""}</small><p>血 ${esc(h.hp)}/${esc(h.hpMax)} · 经验 ${esc(h.xp)}${h.xpNext ? "/" + esc(h.xpNext) : ""} · <b>${esc(h.purse)} 奎支</b></p><p class="ol-muted">${esc((h.weapons || []).map(w => `${w.name} Lv${w.level} 耐久 ${w.dur}/${w.durMax}`).join("；"))}</p>${(h.items || []).length ? `<p>名下：${esc(h.items.map(x => `${x.name}×${x.qty}`).join("、"))}</p>` : ""}</article>`).join("")}${(r.fallen || []).length ? `<p class="ol-muted">阵亡：${esc(r.fallen.join("、"))}</p>` : ""}${(r.freeItems || []).length ? `<p class="ol-muted">队伍公用：${esc(r.freeItems.map(x => `${x.name}×${x.qty}`).join("、"))}</p>` : ""}</section>`;
      const choice = r.choice ? `<section class="ol-rogue-box" aria-label="升级"><h3>${esc(r.choice.name)} ${esc(r.choice.level)} 级：${esc(r.choice.title)}${r.choice.more > 0 ? ` <small class="ol-muted">还有 ${esc(r.choice.more)} 项待选</small>` : ""}</h3><div class="ol-attr-btns">${r.choice.options.map(o => rogueAct(o.label + (o.hint ? "（" + o.hint + "）" : ""), { action: "choose", kit: r.choice.kit, index: r.choice.index, value: o.value }, false, true)).join("")}</div></section>` : "";
      const v = r.vote || { options: [] };
      const vote = v.options.length ? `<section class="ol-rogue-box ol-rogue-vote" aria-label="队伍投票"><h3>队伍投票</h3><p class="ol-muted">需要 ${esc(v.voted)} / ${esc(v.voters)} 人投票。只有在线、分到角色的人算票，旁观者不用投；投完按多数决定，平票随机。${v.spectator ? "你没有分到角色，只能旁观。" : ""}${v.blocked ? esc(v.blocked) + "。" : ""}</p><ul>${v.options.map(o => `<li>${button((o.mine ? "✔ " : "") + o.label, "rogueVote", `data-option="${esc(o.id)}"`, disabled() || !!v.spectator, o.mine)}<small>${esc(o.voters.join("、"))}</small></li>`).join("")}</ul>${v.options.some(o => o.mine) ? button("撤回我的票", "rogueUnvote", "", disabled()) : ""}</section>` : "";
      const last = r.lastVote ? `<p class="ol-muted">上一次队伍决定：${esc(r.lastVote)}</p>` : "";
      const waits = (r.waitingLevel || []).length ? `<p class="ol-muted">等 ${esc(r.waitingLevel.join("、"))} 选升级。</p>` : "";
      const loot = (r.loot || []).map(l => `<section class="ol-rogue-box" aria-label="战利品"><h3>战利品：${esc(l.name)} ×${esc(l.qty)}</h3><p class="ol-muted">${esc(l.source)} · 需求：${esc(l.needs.join("、") || "无")} · 放弃：${esc(l.passes.join("、") || "无")}。在需求的人里抽一个；没人需求就随机给。</p><div class="ol-attr-btns">${(l.mine || []).map(m => m.answer ? `<span>${esc(m.name)}：${m.answer === "need" ? "需求" : "放弃"}</span>` : button(m.name + " 需求", "rogueNeed", `data-loot="${esc(l.no)}" data-kit="${esc(m.kit)}" data-want="1"`, disabled(), true) + button(m.name + " 放弃", "rogueNeed", `data-loot="${esc(l.no)}" data-kit="${esc(m.kit)}" data-want="0"`, disabled())).join("")}</div></section>`).join("");
      const lootLog = (r.lootLog || []).length ? `<p class="ol-muted">${esc(r.lootLog.slice(-3).join(" "))}</p>` : "";
      const board = r.board ? `<section class="ol-rogue-box" aria-label="任务板"><h3>任务板</h3><ul>${r.board.map(t => `<li><b>${esc(t.name)}</b>（${esc(t.days)} 天 · 报酬 ${esc(t.kuizhi)} 奎支 · 每人 ${esc(t.xp)} 经验）<br><small>${esc(t.goal)}${t.blocked ? " · " + esc(t.blocked) : ""}</small></li>`).join("")}</ul></section>` : "";
      const task = r.task ? `<section class="ol-rogue-box" aria-label="任务"><h3>${esc(r.task.name)}</h3><p class="ol-muted">${esc(r.task.goal)}</p><ol class="ol-rogue-route">${r.task.nodes.map(n => `<li class="${n.current ? "ol-open" : n.done ? "ol-muted" : ""}">${esc(n.label)}${n.done ? " ✓" : n.current ? " ←" : ""}</li>`).join("")}</ol></section>` : "";
      const pts = r.points;
      const redeem = pts && pts.redeem && pts.redeem.length ? `<h4>积分兑换（你有 ${esc(pts.points)} 积分，再花 ${esc(pts.next)} 奎支得 1 分）</h4><ul>${pts.redeem.map(it => `<li>${esc(it.name)} · ${esc(it.points)} 积分 ${rogueAct("兑换", { action: "redeem", item: it.id, payer }, pts.points < it.points && `还差 ${it.points - pts.points} 积分`)}</li>`).join("")}</ul>` : "";
      const buyList = r.shop ? `<ul>${arrOf(r.shop).map(row => `<li>${esc(row.name)} · ${esc(row.price)} 奎支${row.team ? " · 归队伍公用" : ""} ${rogueAct("买", { action: "buy", key: row.key, qty: 1, payer }, lack(purse, row.price))}</li>`).join("")}</ul>${redeem}` : "";
      const shop = r.shop && payer ? `<section class="ol-rogue-box" aria-label="商店"><h3>商店（你有 ${esc(purse)} 奎支）</h3>${sellTabs("rogue", rogueSellView(r), buyList, () => sellModelRogue(r, payer))}</section>` : "";
      const smith = r.smith && payer ? `<section class="ol-rogue-box" aria-label="工匠"><h3>${esc(r.smith.name)}（你有 ${esc(purse)} 奎支）</h3><ul>${r.smith.upgrades.map(o => `<li>${esc(o.name)} Lv${esc(o.level)} ${o.max ? "已满级" : rogueAct(`升到 ${o.level + 1} 级（${o.cost}）`, { action: "upgradeWeapon", kit: o.kit, smith: r.smith.id }, lack(purse, o.cost))}</li>`).join("")}${r.smith.offers.map(o => `<li>改装件 ${esc(o.name)}<small>${esc(o.text)}</small> ${o.sold ? "已卖出" : rogueAct(`买（${o.price}）`, { action: "buyPart", smith: r.smith.id, index: o.index, payer }, lack(purse, o.price))}</li>`).join("")}</ul></section>` : "";
      const bp = r.smith && r.smith.bp;
      // 领图纸：进度 x/need；攒满了列出还没有的图纸（rogue.js · claimBlueprint 校验），领完就只显示「图纸已领完」
      const bpBox = bp && payer ? `<section class="ol-rogue-box ol-smith-bp" aria-label="领图纸"><h3>图纸 ${bp.done ? "已领完" : `${esc(bp.progress)}/${esc(bp.need)}`}</h3>${bp.done ? "" : bp.canClaim && bp.options.length
        ? `<ul>${bp.options.map(o => `<li>${esc(o.name)}<small>${esc(o.text)}</small> ${rogueAct("领图纸", { action: "claimBlueprint", smith: r.smith.id, blueprint: o.id, payer })}</li>`).join("")}</ul>`
        : `<p class="ol-muted">${rogueAct("领图纸", { action: "claimBlueprint", smith: r.smith.id, payer }, `再升级 ${Math.max(0, bp.need - bp.progress)} 次`)}</p>`}</section>` : "";
      const slots = r.smith ? r.smith.slots || [] : [];
      const parts = r.parts && r.parts.length && payer ? `<section class="ol-rogue-box" aria-label="改装件"><h3>你的改装件</h3><ul>${r.parts.map((p, i) => `<li>${esc(p.name)} ×${esc(p.have)}<small>${esc(p.text)}</small> ${rogueAct(`卖掉（${p.sell}）`, { action: "sellPart", part: p.id, payer })}${slots.length ? `<select id="ol-rp-${i}" data-ol-cmp="${esc(p.id)}" aria-label="装到哪个槽">${slots.map(x => option(`${x.kit}:${x.slot}`, `${x.name} 槽 ${x.slot + 1}${x.cur ? "（现在：" + x.cur + "）" : ""}`, false)).join("")}</select>${button(`装上（${p.install}）`, "roguePartInstall", `data-part="${esc(p.id)}" data-select="ol-rp-${i}" data-smith="${esc(r.smith.id)}"`, disabled() || !!lack(purse, p.install))}${why(lack(purse, p.install))}<span class="pt-cmp" id="ol-rp-${i}-cmp">${partCompare(r, p.id, slots[0])}</span>` : ""}</li>`).join("")}</ul></section>` : "";
      const filled = slots.filter(x => x.cur);
      const unmount = r.smith && filled.length ? `<section class="ol-rogue-box" aria-label="拆改装件"><h3>已装的改装件</h3><ul>${filled.map(x => `<li>${esc(x.name)} 槽 ${esc(x.slot + 1)}：${esc(x.cur)} ${rogueAct("拆下（不要钱）", { action: "removePart", kit: x.kit, slot: x.slot, smith: r.smith.id })}</li>`).join("")}</ul></section>` : "";
      const clinic = r.clinic && r.clinic.length ? `<section class="ol-rogue-box" aria-label="诊所"><h3>诊所（你有 ${esc(purse)} 奎支）</h3><ul>${r.clinic.map(c => `<li>${esc(c.name)} ${c.cost ? rogueAct(`治疗到满血（${c.cost}）`, { action: "healHero", kit: c.kit }, lack(purse, c.cost)) : "满血"}</li>${c.cyber ? cyberMarkup(c, purse) : ""}`).join("")}</ul></section>` : "";
      const cwEntry = global.CyberwareUI && cyberwareSrc() ? `<section class="ol-rogue-box ol-cw-entry" aria-label="义体"><div class="ol-attr-btns">${button("诊所 · 义体", "rogueCyberware", "", false, true)}</div></section>` : "";
      const wk = r.workshop;
      // 工坊：按钮打开浮层（背包在标题工具栏「背包」）（workshop-ui.js / backpack-ui.js，和房主同一套渲染器；数据是 viewFor 的 craft / bag / materialBar …）
      const workshop = payer && r.workshopAvailable && wk ? `<section class="ol-rogue-box ol-ws-entry" aria-label="工坊"><div class="ol-attr-btns">${button("工坊", "rogueWorkshop", "", false, true)}</div></section>` : "";
      const log = (r.log || []).length ? `<section class="ol-rogue-box" aria-label="最近发生"><h3>最近发生</h3><ul>${r.log.map(t => `<li>${esc(t)}</li>`).join("")}</ul></section>` : "";
      return head + over + choice + waits + loot + lootLog + vote + last + heroes + board + task + shop + smith + bpBox + parts + unmount + clinic + cwEntry + workshop + log;
    }
    /** 义体改造：和单机诊所一样填装甲 / 护盾 / 沙尘层的点数、要不要换成星灵；价格按房主发来的单价估 */
    const CYBER_LAYERS = [["armor", "装甲"], ["shield", "护盾"], ["sand", "沙尘"]];
    const cyberDraft = {};   // 正在填的改造方案（重画时保留）
    function cyberPlanOf(kit) {
      const sel = `[data-cyber-box="${CSS.escape(kit)}"]`, box = (!suppliesBox.hidden && suppliesBox.querySelector(sel)) || stage.querySelector(sel);
      if (!box) return null;
      const plan = { spirit: !!box.querySelector("[data-cy-spirit]")?.checked };
      for (const [k] of CYBER_LAYERS) plan[k] = Math.max(0, Math.floor(Number(box.querySelector(`[data-cy-layer="${k}"]`)?.value) || 0));
      return plan;
    }
    function cyberEstimate(c, plan) {
      const a = c.cyber.current || {};
      let pts = CYBER_LAYERS.reduce((s, [k]) => s + Math.abs((plan[k] || 0) - (Number(a[k]) || 0)), 0);
      if (!!a.spirit !== !!plan.spirit) pts += c.cyber.fleshMax - CYBER_LAYERS.reduce((s, [k]) => s + (plan[k] || 0), 0);
      return pts * (Number(c.cyber.perHp) || 0);
    }
    function cyberMarkup(c, purse, action, label) {
      const cur = cyberDraft[c.kit] || c.cyber.current || {};
      return `<li class="ol-cyber" data-cyber-box="${esc(c.kit)}"><span>义体改造（肉体 ${esc(c.cyber.fleshMax)}，最多改 ${esc(c.cyber.limit)} 点）</span>${CYBER_LAYERS.map(([k, label]) => `<label>${label}<input type="number" min="0" max="${esc(c.cyber.limit)}" step="1" data-cy-layer="${k}" value="${esc(Number(cur[k]) || 0)}"></label>`).join("")}<label><input type="checkbox" data-cy-spirit${cur.spirit ? " checked" : ""}> 换成星灵</label>${button(label || "改造", action || "rogueCyber", `data-kit="${esc(c.kit)}" data-purse="${esc(purse)}"`, disabled())}</li>`;
    }
    /** 跑团诊所（主持人开放时）：给自己的角色填改造方案、提交申请，主持人同意后才生效；钱从这名角色的钱包出 */
    function trpgClinicMarkup() {
      const c = view.packet?.clinic;
      if (!c || !Array.isArray(c.heroes) || !c.heroes.length) return "";
      const st = { pending: "等主持人同意", done: "已改造", denied: "被拒绝" };
      return `<section class="ol-rogue-box ol-trpg-clinic" aria-label="诊所"><h3>🦾 诊所：义体改造</h3><ul>${c.heroes.map(h => `${cyberMarkup(h, h.purse, "trpgCyber", "申请改造")}
        <li class="ol-muted">${esc(h.name)} 的钱包 ${esc(h.purse)} 奎支 · 改造率 ${esc(Math.round(h.cyber.rate * 100))}% · 每动 1 点肉体 ${esc(h.cyber.perHp)} 奎支${h.request ? ` · 最近的申请：${esc(st[h.request.status])}${h.request.cost ? `（${esc(h.request.cost)} 奎支）` : ""}${h.request.note ? "：" + esc(h.request.note) : ""}` : ""}</li>`).join("")}</ul>
        <p class="ol-muted">一个角色最多 3 种血量，最内层要留肉体或星灵。伤势照旧带着，缺的血先从外层扣。</p></section>`;
    }
    /* ---------- 升级提示：自己操控的角色升级 / 武器升级 / 学到新技能（levelup-ui.js 的画法） ---------- */
    const lvBox = make("div", "online-levelup", "lvu-overlay");
    lvBox.hidden = true;
    const lvDone = new Set();
    lvBox.addEventListener("click", async event => {
      const ok = event.target.closest('[data-lvu="ok"]'); if (!ok) return;
      const id = lvBox.dataset.id; if (!id) return;
      lvDone.add(id); paintLevelUps();
      try { await api.submit({ type: "levelup.seen", id }); } catch (_) { /* 下次同步再说 */ }
    });
    function paintLevelUps() {
      const list = !view.active || view.isHost || !global.LevelUpUI ? [] : (view.packet?.levelUps || []).filter(ev => ev && !lvDone.has(ev.id));
      if (!list.length) { lvBox.hidden = true; lvBox.dataset.id = ""; return; }
      global.LevelUpUI.ensureStyle();
      if (lvBox.dataset.id !== list[0].id) { lvBox.innerHTML = global.LevelUpUI.html(list[0], { more: list.length - 1 }); lvBox.dataset.id = list[0].id; }
      lvBox.hidden = false;
    }
    function stageMarkup() {
      const data = displayState || view.state, screen = view.screen;
      if (screen === "lobby" || !data) return '<div class="ol-wait"><h2>等待房间同步</h2><p>房主准备好后会更新这里。</p></div>';
      if (view.packet?.mode === "rogue" && view.packet.rogue && screen === "exploration") return rogueMarkup(view.packet.rogue);
      const units = (data.units || []).filter(u => !u.hidden), logs = view.packet?.publicLogs || [];
      return `<header class="ol-stage-heading"><div><span class="ol-muted">${esc(view.roomCode)} · ${screen === "battle" ? `第 ${data.turnNo || 1} 回合` : screen === "ended" ? "遭遇结束" : "探索环节"}</span>${screen === "battle" && global.Chain && data.chainStatus ? `<div class="ol-chain">${global.Chain.barHtml(data.chainStatus)}</div>` : ""}<h1>${screen === "battle" ? "战场" : screen === "ended" ? "战斗结算" : "与队伍同行"}</h1>${clockLine()}<div class="ol-info-tools">${global.WorldMap ? button("地图", "map") : ""}${button("角色资料", "info", 'data-info="sheet"', pending)}${button("武器", "info", 'data-info="armory"', pending)}${button("背包", "info", 'data-info="bag" title="队伍的全部道具（材料、消耗品、改装件…）"')}${button("战绩", "info", 'data-info="record"', pending)}${suppliesButton()}${view.packet?.mode !== "rogue" ? questsButton() : ""}${loreButton()}${(screen === "battle" || screen === "ended") && global.HD2DField ? '<span class="ol-hd2d-slot"></span>' : ""}</div></div>${weatherMarkup(data)}</header>${screen === "ended" ? resultMarkup() : ""}${checksMarkup(screen === "battle")}${screen === "battle" || screen === "ended" ? '<div class="ol-battle-slot"></div>' : `<p class="ol-muted ol-explore-hint">主持人正在管理探索与遭遇。右侧「小队」频道可以和大家聊天，「菜单」里的「消息与成员」可以私下回复主持人。</p>${partyMarkup(units)}`}`;
    }
    /** 「任务日志」按钮：进行中的任务带条数（舞台顶上那一排、纸片画面的「工具 ▾」同一个） */
    const questsButton = () => button(`任务日志${questList().some(q => q.status === "active") ? ` · ${questList().filter(q => q.status === "active").length}` : ""}`, "quests");

    /* ---------- 纸片画面（#308，online-paper.js；设计在 docs/ui-paper/）----------
     * 联机玩家的战斗画面开着新画面（3D 建好了）时：战场铺满，顶栏 / 行动顺序吊牌 / 「工具 ▾」在 #online-paper 里，队伍栏挪到左上角、技能栏浮在底下（hd2d-shell.js 的外壳），
     * 右边的记录 / 聊天收成抽屉。只换排版，出手流程、快捷键、点 3D 铭牌选目标照旧走上面那一份；只读收到的包，坚毅生命一个字都不碰 */
    /** 这一刻是不是纸片画面：换了就给 body 加 / 去 .ol-paper，抽屉读本机记着的；战场的大小变了，新画面重新量一次 */
    function setPaper(on) {
      if (on === paperOn) return;
      paperOn = on;
      document.body.classList.toggle(global.OnlinePaper ? global.OnlinePaper.PAPER.bodyClass : "ol-paper", on);
      toolsOpen = false; swapOpen = null;
      if (on) paperDrawer = global.OnlinePaper.isOpen("drawer", paperStore);
      else paperCover();   // 出纸片画面：新画面不用再让开纸片的面板（进来时贴纸纹那一下量）
      setTimeout(() => { if (!destroyed && typeof dispatchEvent === "function" && typeof Event === "function") dispatchEvent(new Event("resize")); }, 0);
    }
    /** 「工具 ▾」下拉里的：原来舞台顶上那一排里除了角色资料 / 武器 / 背包（挪到队伍栏下面）的几个，同一个画法、同一个处理（不留两份）；
     *  申请检定照旧由 check-request-ui.js 补进来，新画面开关（#g-hd2d-toggle）照旧由 hd2d-field.js 挪进 .ol-hd2d-slot */
    function paperTools() {
      return [global.WorldMap ? button("地图", "map") : "", button("战绩", "info", 'data-info="record"', pending), suppliesButton(),
        view.packet?.mode !== "rogue" ? questsButton() : "", loreButton(), global.HD2DField ? '<span class="ol-hd2d-slot"></span>' : ""];
    }
    /** 纸片画面的舞台：只剩铺满的战场那一格；提示、战斗结算、连锁、检定浮在吊牌下面（.olp-float） */
    function paperStageMarkup(note) {
      const data = displayState || view.state || {}, screen = view.screen;
      const chain = screen === "battle" && global.Chain && data.chainStatus ? `<div class="ol-chain">${global.Chain.barHtml(data.chainStatus)}</div>` : "";
      return `<div class="olp-float">${note}${screen === "ended" ? resultMarkup() : ""}${chain}${checksMarkup(screen === "battle")}</div><div class="ol-battle-slot"></div>`;
    }
    const weatherName = w => (w === "sand" ? "沙暴" : labels[w] || labels.none);
    /** 夜晚：这一包的光影（pv.light：傍晚也算夜）；旧主机没发光影就按游戏时钟 */
    function paperNight(data) {
      if (data && data.light) return data.light !== "day";
      const ck = view.packet?.clock;
      return !!(ck && global.PartyCards && global.PartyCards.isNight(ck.clock));
    }
    /** 行动顺序吊牌：收到的包里的行动顺序（hs().order）+ 每一格现在的按钮（热座栏里原来那几个，OnlinePaper.readMoves）；头像按投影过的单位（hd2d-ui.js） */
    function paperSlots(data, moves) {
      const phase = hs().phase;
      if (!["picking", "acting", "enemy"].includes(phase)) return [];
      const units = data.units || [], SH = global.HD2DShell, UI = global.HD2DUI;
      return (hs().order || []).map((slot, i) => {
        slot = slot || {};
        const actor = slot.actor || "", u = units.find(x => x.id === actor), hu = (hs().units || []).find(x => x.id === actor) || {};
        const owner = slot.owner || slot.operatorId || hu.owner;
        const face = u && SH && UI ? UI.avatarHtml(UI.avatarOf(SH.lookOf(u))) : "";
        return { index: i, actor, name: (u && u.name) || hu.name || actor, owner: actor ? playerName(owner) : "", face,
          current: !!actor && (!!slot.current || (phase === "acting" && actor === hs().currentUnitId)), done: !!slot.done, locked: !!slot.locked,
          vacated: !actor && phase !== "picking", mine: !!actor && owner === own(), moves: moves.get(i) || [] };
      });
    }
    /** 顶栏、「工具 ▾」、吊牌、热座栏的提示（online-paper.js 画，各占一块分开重画）；不是纸片画面就清空藏起来。
     *  顶栏重画了就把菜单按钮上的新消息红点补上（pause-menu.js 画在所有 [data-pause-open] 上）；
     *  下拉的按钮列表重画了就把新画面开关、申请检定放回去（平时由 hd2d-field.js / check-request-ui.js 放，这里只是不让它们在两次之间丢掉） */
    const PAPER_KEYS = ["paperTop", "paperTools", "paperTags"];
    function paintPaper() {
      const OP = global.OnlinePaper;
      paperBox.hidden = !paperOn;
      if (!paperOn || !OP) { if (paperBox.firstChild) { paperBox.innerHTML = ""; PAPER_KEYS.forEach(k => delete lastMarkup[k]); } watchPaper(false); paintPaperTheme(null); return; }
      if (!paperBox.querySelector(".olp-top-host")) { paperBox.innerHTML = OP.shellHtml(); PAPER_KEYS.forEach(k => delete lastMarkup[k]); }
      const q = sel => paperBox.querySelector(sel);
      const data = displayState || view.state || {}, ck = view.packet?.clock, PC = global.PartyCards, moves = OP.readMoves(document);
      paintPaperTheme(OP.themeOf({ light: data.light, night: paperNight(data), weather: data.weather }));
      const moving = [...moves.values()].some(list => list.some(m => m.hs === "moveCancel"));
      const top = lastMarkup.paperTop, tools = lastMarkup.paperTools, list = q(".olp-tools-list"), toggle = list.querySelector("#g-hd2d-toggle");
      html(q(".olp-top-host"), OP.topHtml({
        rogue: view.packet?.mode === "rogue", room: view.roomCode, reconnecting: paused(), turnNo: data.turnNo,
        day: ck ? ck.day || 1 : 0, time: ck && PC ? PC.clockText(ck.clock == null ? 480 : ck.clock) : "", period: ck && PC ? PC.dayPeriod(ck.clock == null ? 480 : ck.clock) : "",
        weather: weatherName(data.weather), night: paperNight(data), cams: OP.readCam(stage), toolsOpen
      }), "paperTop");
      q(".olp-tools").hidden = !toolsOpen;
      html(list, OP.toolsHtml(paperTools()), "paperTools");
      if (lastMarkup.paperTools !== tools) {
        const slot = list.querySelector(".ol-hd2d-slot");
        if (toggle && slot && toggle.parentNode !== slot) slot.appendChild(toggle);
        if (checkReq) checkReq.sync();
      }
      html(q(".olp-tags-host"), OP.tagsHtml(paperSlots(data, moves), { open: swapOpen, moving }), "paperTags");
      const hn = document.getElementById("hs-notice"), note = hn && !hn.hidden ? String(hn.textContent || "").trim() : "", noteEl = q(".olp-note");
      noteEl.hidden = !note; if (noteEl.textContent !== note) noteEl.textContent = note;
      watchPaper(true);
      if (lastMarkup.paperTop !== top && global.PauseMenu) global.PauseMenu.refresh();
    }
    /** 白天 / 夜晚 / 天气的配色（第 2 步）：body 上记一下是哪一套（data-olp-time / data-olp-weather），配色（online-paper.js · PAPER.palette / weathers）写成 CSS 变量；
     *  th = null（不是纸片画面）：都拿掉 */
    let paperThemeKey = "", paperTheme = null;
    function paintPaperTheme(th) {
      const key = th ? th.time + "|" + th.weather : "";
      paperTheme = th;
      if (key === paperThemeKey) return;
      const b = document.body, vars = th ? global.OnlinePaper.themeVars(th) : {};
      const phone = global.OnlinePaper.phoneVars();   // 手机竖屏的技能栏最多多高（#311）
      if (paperThemeKey) { Object.keys(global.OnlinePaper.themeVars({ time: "day" })).concat(Object.keys(phone)).forEach(k => b.style.removeProperty(k)); b.style.removeProperty("--olp-grit"); }
      paperThemeKey = key;
      if (!th) { delete b.dataset.olpTime; delete b.dataset.olpWeather; b.style.removeProperty("--olp-dock-h"); return; }
      b.dataset.olpTime = th.time; b.dataset.olpWeather = th.weather;
      Object.keys(vars).forEach(k => b.style.setProperty(k, vars[k]));
      Object.keys(phone).forEach(k => b.style.setProperty(k, phone[k]));
      const grit = global.OnlinePaper.grit(document);   // 印章、喷漆的斑驳（只一点点）
      if (grit) b.style.setProperty("--olp-grit", `url("${grit}")`);
    }
    /** 3D 白卡让开浮在战场上的面板（#339 第 4 步）：量一下顶栏胶带、吊牌、左上角的队伍、技能栏、右边的抽屉（OnlinePaper.PAPER.cover）交给新画面
     *  （hd2d-field.js · cover：换成战场里的坐标、算上下左右让多少，变了才重排）；不是纸片画面时交 null。和上次一样就不交 */
    let paperCoverKey = "null";
    function paperCover() {
      const F = global.HD2DField;
      if (!F || typeof F.cover !== "function" || !global.OnlinePaper) return;
      const rects = paperOn && !destroyed ? global.OnlinePaper.cover(document) : null, key = JSON.stringify(rects);
      if (key === paperCoverKey) return;
      paperCoverKey = key;
      F.cover(rects);
    }
    /** 纸片美术（第 3 步）：面板贴上照 mock.html 程序生成的纹理（online-paper.js · dress：揉皱的纸、天气，每种纸 × 每套配色一张平铺的小纹理，开局画好；
     *  撕边、影子按面板大小只换 CSS 变量，#321）。每次画完叫一次；面板大小变了（收起 / 展开、窗口变了）由 ResizeObserver 叫，下一帧一起换撕边（不画纹理） */
    let paperSizer = null, paperDressQueued = false;
    function paperDress() {
      if (!paperOn || !global.OnlinePaper) return;
      global.OnlinePaper.dress(document, null, paperTheme);
      paperCover();
      // 技能栏现在多高（--olp-dock-h）：手机上右边缘的竖标签挂在它上面，技能栏换行变高了也不压在一起。
      // 选中技能以后先收着的这一段照旧用收起之前的（online-paper.js / paper-ui.js · dockHeight 给 null，#362）：竖标签不跟着挪，取景也就不变
      const hud = stage.querySelector(".ol-battle > .g-hud"), dockH = global.OnlinePaper.dockHeight(hud);
      if (dockH != null && document.body.style.getPropertyValue("--olp-dock-h") !== dockH) document.body.style.setProperty("--olp-dock-h", dockH);
      if (typeof ResizeObserver !== "function") return;
      if (!paperSizer) paperSizer = new ResizeObserver(() => {
        if (paperDressQueued) return;
        paperDressQueued = true;
        const next = () => { paperDressQueued = false; if (!destroyed) paperDress(); };
        if (typeof global.requestAnimationFrame === "function") global.requestAnimationFrame(next); else setTimeout(next, 16);
      });
      [paperBox.querySelector(".olp-top"), paperBox.querySelector(".olp-tools"), stage.querySelector(".ol-battle > .g-hud"), stage.querySelector(".ol-battle .hd2d-party"), side].forEach(n => { if (n) paperSizer.observe(n); });
    }
    /** 热座栏（延后 / 换位的按钮、提示）、新画面的镜头按钮自己会变（点了换位、滚轮换镜头……，不经过这里）：变了就重画一次（只看这几块，下一刻一起画） */
    let paperWatch = null, paperWatched = [], paperQueued = false;
    function watchPaper(on) {
      const want = on ? [document.getElementById("hs-order"), document.getElementById("hs-notice"), stage.querySelector(".hd2d-cam")].filter(Boolean) : [];
      if (want.length === paperWatched.length && want.every((n, i) => n === paperWatched[i])) return;
      if (paperWatch) paperWatch.disconnect();
      paperWatched = want;
      if (!want.length || typeof MutationObserver !== "function") return;
      if (!paperWatch) paperWatch = new MutationObserver(() => {
        if (paperQueued) return;
        paperQueued = true;
        setTimeout(() => { paperQueued = false; if (!destroyed && paperOn) render(); }, 0);
      });
      want.forEach(n => paperWatch.observe(n, n.classList.contains("hd2d-cam") ? { subtree: true, attributes: true, attributeFilter: ["class"] }
        : { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "disabled", "hidden"] }));
    }
    /** 纸片画面：队伍栏下面接「角色资料 / 武器 / 背包」（原来舞台顶上那一排里的三个，同一个画法、同一个处理），技能栏那一行写「轮到你了」；不是纸片画面就拿掉。
     *  手机竖屏上技能栏没手动点过时，轮到你才展开（#311） */
    function paintPaperHud(el) {
      const panel = el.querySelector(".g-hud > .hd2d-party"), row = el.querySelector(".g-hud > .hd2d-dock-row");
      let tools = el.querySelector(".olp-party-tools"), turn = el.querySelector(".olp-turn");
      if (!paperOn) { if (tools) tools.remove(); if (turn) turn.remove(); return; }
      if (panel) {
        const markup = `${button("角色资料", "info", 'data-info="sheet"', pending)}${button("武器", "info", 'data-info="armory"', pending)}${button("背包", "info", 'data-info="bag" title="队伍的全部道具（材料、消耗品、改装件…）"')}`;
        if (!tools) { tools = document.createElement("div"); tools.className = "olp-party-tools"; }
        if (tools.parentNode !== panel) panel.appendChild(tools);
        if (tools.dataset.html !== markup) { tools.innerHTML = markup; tools.dataset.html = markup; }
      }
      const mine = isMyTurn() && !animating;
      if (row && mine && !turn) { turn = document.createElement("span"); turn.className = "olp-turn olp-stamp"; turn.textContent = global.OnlinePaper.PAPER.text.yourTurn; row.appendChild(turn); }
      else if (turn && (!mine || !row)) turn.remove();
      // 手机竖屏（#311）：技能栏没手动点过「技能 ▼ / ▲」时，轮到你（演出播完）展开、不是你就收起，让出战场（online-paper.js · dockAuto；不记在本机）；
      // 手动点过的照本机记着的（hd2d-shell.js · manual）。电脑上不动
      const SH = global.HD2DShell, hud = el.querySelector(".g-hud");
      if (SH && SH.setPanel && hud && SH.on(hud)) {
        const want = global.OnlinePaper.dockAuto({ phone: paperPhone(), manual: SH.manual(hud, "dock"), mine: isMyTurn(), busy: animating });
        if (want != null) SH.setPanel(hud, "dock", want);
      }
    }
    /** 这一刻算不算手机竖屏（online-paper.js · PAPER.phone.media，和 online-paper.css 手机那一段一样宽） */
    function paperPhone() {
      try { return !!(global.matchMedia && global.matchMedia(global.OnlinePaper.PAPER.phone.media).matches); } catch (e) { return false; }
    }
    /** 联机跑团的时钟行：和主持人顶栏同一句（party-cards.js · clockHtml，含「距上次长休」和力竭提示） */
    function clockLine() {
      const c = view.packet?.clock;
      if (!c || view.packet?.mode === "rogue" || !global.PartyCards) return "";
      return `<p class="ol-clock">${global.PartyCards.clockHtml(c)}</p>`;
    }
    /** 探索时的队伍卡：和主持人左栏同一个渲染器（party-cards.js），数据是 online-view.js · projectParty（没有坚毅）。
     *  一名玩家可以操控好几名角色：自己的都标「（你）」，有两名以上时可以切换「当前角色」（资料 / 武器默认打开它） */
    function partyMarkup(units) {
      const party = view.packet?.party, PC = global.PartyCards;
      if (!Array.isArray(party) || !PC) return `<div class="ol-exploration-party">${units.filter(u => u.isPlayer && !u.weaponOf).map(card).join("")}</div>`;
      const ownerOf = h => ((hs().heroes || []).find(x => x.id === h.id) || (hs().units || []).find(x => x.id === h.id) || {}).owner;
      const mineKits = party.filter(h => ownerOf(h) === own()).map(h => h.kit);
      const focus = mineKits.includes(focusKit) ? focusKit : mineKits[0];
      return `<section class="tr-party ol-party" aria-label="队伍">${party.map(h => {
        const owner = ownerOf(h), mine = owner === own();
        // 自己的角色卡下面接属性点申请（attrMarkup 要 state.units 里的 attrs / attrPicks，队伍卡数据里没有）
        const u = mine ? units.find(x => x.id === h.id) : null, attr = u ? attrMarkup(u) : "";
        const html = PC.heroCardHtml(h, { gm: false, buttons: mine ? "online" : false, owner: owner ? playerName(owner) : "", mine, focusable: mine && mineKits.length > 1, focus: mine && h.kit === focus });
        // .ol-party 是网格：申请区要和卡片放进同一格，不然会单独占一格，排到卡片旁边像多了一张卡
        return attr ? `<div class="ol-party-cell">${html}${attr}</div>` : html;
      }).join("")}</section>`;
    }
    function observeMessages() {
      const rows = view.messages || [], incoming = rows.filter(m => !seenMessages.has(m.id) && m.from !== own());
      for (const m of rows) seenMessages.add(m.id);
      // 消息提示一闪就没：别人发来的新私信（房主收到玩家的回复也算）记在「消息与成员」按钮的红点上（#207）。
      // 面板开着就算看到了——按面板实际开没开算：大厅里玩家 / 跑团房主的面板一直开着，以前只看 panelOpen，大厅里来的私信会在开局后的按钮上留一个过期的数
      if (!panel.hidden) privUnread = 0;
      else if (messagesInitialized && incoming.length) privUnread += incoming.length;
      if (messagesInitialized && incoming.length) {
        const message = incoming[incoming.length - 1];
        toast.textContent = `${message.to === "all" ? "主持人消息" : "仅你可见"}：${message.text}`; toast.hidden = false;
        clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
      }
      messagesInitialized = true;
    }
    /* ---------- 小队聊天 ---------- */
    const chatRows = () => (hs().chat || []).filter(m => m && typeof m.text === "string");
    const clock = at => { if (!at) return ""; const d = new Date(at); return isNaN(d) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
    /** paper：纸片画面（#308）的便利贴——每条带上这个发送人固定的便利贴颜色（online-paper.js · noteColor） */
    function chatListMarkup(rows, paper) {
      return rows.map(m => { const mine = !!(m.operatorId && m.operatorId === own()); return `<li class="${mine ? "ol-mine" : ""}${m.roll ? " ol-roll" : ""}${m.tier ? " ol-tier-" + m.tier : ""}${m.secret ? " ol-secret" : ""}${m.title ? " ol-title-row" : ""}"${paper ? ` style="--olp-note:${global.OnlinePaper.noteColor(m.operatorId || m.name, mine)}"` : ""}><div><b>${esc(m.name || m.operatorName || playerName(m.operatorId))}</b><small>${esc(clock(m.at))}</small></div><p${artAttr(m.text)}>${esc(m.text)}</p></li>`; }).join("") || '<li class="ol-muted">还没有人说话。消息所有人都能看到，并一直保留在记录里。</li>';
    }
    /** 更新列表（只换列表内容，不碰输入框）；原来在底部就继续贴底 */
    function fillList(list, markup) {
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      list.innerHTML = markup;
      if (atBottom) list.scrollTop = list.scrollHeight;
    }
    /** 新消息：不在小队频道时累计未读数 */
    function trackUnread(onChat) {
      const rows = chatRows();
      if (!chatPrimed) { rows.forEach(m => seenChat.add(m.id)); chatPrimed = true; return 0; }
      const fresh = rows.filter(m => m.id && !seenChat.has(m.id));
      fresh.forEach(m => seenChat.add(m.id));
      if (onChat) unread = 0; else unread += fresh.filter(m => m.operatorId !== own()).length;
      return fresh.length;
    }
    function renderSide(force) {
      paintSideFold();
      if (side.hidden) return;
      const battle = view.screen === "battle" || view.screen === "ended";
      const tab = sideTab[battle ? "battle" : "other"];
      side.dataset.tab = tab;
      const logTab = side.querySelector('[data-side="log"]'), chatTab = side.querySelector('[data-side="chat"]');
      logTab.textContent = paperOn ? global.OnlinePaper.PAPER.text.logTab : battle ? "战斗" : "记录";
      logTab.classList.toggle("on", tab === "log"); chatTab.classList.toggle("on", tab === "chat");
      logTab.setAttribute("aria-selected", String(tab === "log")); chatTab.setAttribute("aria-selected", String(tab === "chat"));
      trackUnread(tab === "chat" && !collapsedNow());   // 右侧栏收着时「小队」频道看不见，新消息不算看到（#298）
      const badge = chatTab.querySelector(".ol-badge"); badge.hidden = !unread; badge.textContent = dotText(unread);
      paintSideCollapse();
      const logs = view.packet?.publicLogs || [];
      // 纸片画面（#308）：战斗记录是一长条热敏收据（online-paper.js · receiptHtml：同样这几条记录，按回合分好、伤害靠右、本回合合计）
      const logMarkup = paperOn ? global.OnlinePaper.receiptHtml(logs, { room: view.roomCode }) : logs.map(l => `<li>${esc(l.text || "")}</li>`).join("") || '<li class="ol-muted">还没有公开记录。</li>';
      if (force || sideKeys.log !== logMarkup) { sideKeys.log = logMarkup; fillList(side.querySelector(".ol-side-log"), logMarkup); }
      const chatMarkup = chatListMarkup(chatRows(), paperOn);
      if (force || sideKeys.chat !== chatMarkup) { sideKeys.chat = chatMarkup; fillList(side.querySelector(".ol-side-chat"), chatMarkup); }
      side.querySelector(".ol-side-form button[type=submit]").disabled = chatSending || paused();
      if (paperOn) paperDress();   // 换了频道（收据 ↔ 便利贴底下那张纸）、拉出来 / 收回去：换一张纸
    }
    /** 聊天框：Enter 发送，Shift+Enter 换行；输入法选字时按的 Enter 不算 */
    function chatEnter(event) {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229 || event.target.tagName !== "TEXTAREA") return;
      event.preventDefault();
      event.target.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    }
    /** 聊天框跟着内容长高，最多 160px，再多就在框里滚动 */
    function fitChatBox(box) {
      if (box?.tagName !== "TEXTAREA") return;
      box.style.height = "auto"; box.style.height = Math.min(box.scrollHeight + 2, 160) + "px";
    }
    /** 多行字符画（有行首空格或全角空格）：不自动折行，CSS 按最长一行的字宽（--cols，全角算 1）缩小字号；普通消息不加 */
    function artAttr(t) {
      if (typeof t !== "string" || !t.includes("\n") || !/(?:^|\n)[ \t　]|　/.test(t)) return "";
      const wide = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
      const cols = Math.max(...t.split("\n").map(line => Array.from(line).reduce((w, ch) => w + (wide.test(ch) || ch.codePointAt(0) > 0xffff ? 1 : 0.55), 0)));
      return ` class="ol-art" style="--cols:${Math.ceil(cols) + 0.5}"`;
    }
    async function sendChatText(input, button) {
      // 原样发给房主，由房主统一整理空白（多行消息要保留第一行行首的空格）
      const text = input.value;
      if (!text.trim() || chatSending || paused()) return;
      chatSending = true; if (button) button.disabled = true;
      try {
        const result = await api.submit({ type: "chat", text });
        if (result?.ok === false) { notice = result.error || "消息没有发出去"; render(); }
        else { input.value = ""; fitChatBox(input); }
      } catch (error) { notice = error.message || "消息没有发出去"; render(); }
      finally { chatSending = false; if (button) button.disabled = paused(); }
    }
    function sendSideChat() { sendChatText(side.querySelector("#ol-side-text"), side.querySelector(".ol-side-form button[type=submit]")); }

    /* 主持人这边：战斗记录栏加「战斗 / 小队」，探索记录栏加「探索 / 小队」 */
    const hostMounts = [];
    function mountHostChat() {
      const want = !!(view.active && view.isHost);
      if (!want) { while (hostMounts.length) hostMounts.pop().remove(); return; }
      if (!hostMounts.length) {
        for (const [root, label, def] of [[document.getElementById("g-log"), "战斗", "log"], [document.querySelector("#scr-trpg .tr-log"), "探索", "chat"]]) {
          if (!root) continue;
          const nav = document.createElement("nav"); nav.className = "ol-host-tabs"; nav.setAttribute("role", "tablist");
          nav.innerHTML = `<button type="button" role="tab" data-host-tab="log" class="ol-tab">${label}</button><button type="button" role="tab" data-host-tab="chat" class="ol-tab">小队<span class="ol-dot ol-badge ol-dot-pop" hidden></span></button>`;
          const box = document.createElement("div"); box.className = "ol-host-chat";
          box.innerHTML = `<ol class="ol-side-chat" aria-live="polite"></ol><form class="ol-side-form"><button type="button" class="ol-button ol-dice" data-roll-open="1" title="选角色和熟练项掷 d100（可以暗骰）">🎲</button><button type="button" class="ol-button ol-dice" data-title-open="1" title="在所有玩家画面中间打出大字（比如「援军来了」）">📢</button><textarea rows="1" maxlength="500" autocomplete="off" enterkeyhint="send" aria-label="小队消息" title="Enter 发送，Shift+Enter 换行" placeholder="说点什么…"></textarea><button type="submit" class="ol-button ol-primary">发送</button></form>`;
          root.prepend(nav); root.appendChild(box);
          const m = { root, nav, box, tab: def, key: "", seen: null, unread: 0, remove() { nav.remove(); box.remove(); root.classList.remove("ol-chat-mode"); } };
          nav.addEventListener("click", e => { const b = e.target.closest("[data-host-tab]"); if (!b) return; m.tab = b.dataset.hostTab; paintHost(m, true); if (m.tab === "chat") box.querySelector("textarea").focus({ preventScroll: true }); });
          box.addEventListener("keydown", e => { e.stopPropagation(); chatEnter(e); });
          box.addEventListener("input", e => fitChatBox(e.target));
          box.addEventListener("submit", e => { e.preventDefault(); sendChatText(box.querySelector("textarea"), box.querySelector("button[type=submit]")); });
          hostMounts.push(m);
        }
      }
      for (const m of hostMounts) paintHost(m);
    }
    function paintHost(m, force) {
      m.root.classList.toggle("ol-chat-mode", m.tab === "chat");
      m.nav.querySelectorAll("[data-host-tab]").forEach(b => { const on = b.dataset.hostTab === m.tab; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
      const rows = chatRows();
      if (!m.seen) m.seen = new Set(rows.map(r => r.id));
      const fresh = rows.filter(r => r.id && !m.seen.has(r.id)); fresh.forEach(r => m.seen.add(r.id));
      if (m.tab === "chat") m.unread = 0; else m.unread += fresh.filter(r => r.operatorId !== own()).length;
      const badge = m.nav.querySelector(".ol-badge"); badge.hidden = !m.unread; badge.textContent = dotText(m.unread);
      const markup = chatListMarkup(rows);
      if (force || m.key !== markup) { m.key = markup; fillList(m.box.querySelector(".ol-side-chat"), markup); }
    }

    /* ---------- 地图：看主持人标的队伍位置（只读，不能改位置） ---------- */
    function openMap() {
      if (!global.WorldMap) return;
      const m = hs().map || {};
      const place = m.place && typeof global.worldPlace === "function" ? global.worldPlace(m.place) : null;
      const party = (((displayState || view.state || {}).units) || []).filter(u => u.isPlayer && !u.weaponOf).map(u => u.name);
      global.WorldMap.open({
        here: place ? m.place : null,
        herePos: place && m.x != null && m.y != null ? { x: m.x, y: m.y } : null,
        party, canMove: false,
        sub: place ? `联机 · 队伍在${place.name}${m.x != null ? "附近" : ""}` : "联机 · 主持人还没在地图上标出队伍的位置"
      });
    }
    /* ---------- 角色资料 / 武器（向房主要数据，只读显示）；背包见 openBag ---------- */
    function myKit() {
      const units = (displayState || view.state || {}).units || [];
      const mine = (hs().units || []).filter(u => u.owner === own()).map(u => units.find(x => x.id === u.id)).filter(Boolean);
      const heroes = mine.filter(u => !u.weaponOf);
      const hero = heroes.find(u => u.kit === focusKit) || heroes[0] || mine[0];
      return hero ? hero.kit : null;
    }
    /* ---------- 任务日志（房主按收件人算好，online-view.js · projectQuests 白名单）---------- */
    const QUEST_STATUS = { posted: ["可接", "ol-q-posted"], active: ["进行中", "ol-q-active"], done: ["已完成", "ol-q-done"], failed: ["失败", "ol-q-failed"] };
    const questList = () => (Array.isArray(view.packet?.quests) ? view.packet.quests : []);
    function questRewardText(xp, kuizhi) {
      const out = [];
      if (xp) out.push(`<span class="ol-q-xp">+${esc(xp)} 经验</span>`);
      if (kuizhi) out.push(`<span class="ol-q-kz">+${esc(kuizhi)} 奎支</span>`);
      return out.join(" · ");
    }
    function questCard(q) {
      const [stText, stCls] = QUEST_STATUS[q.status] || ["", ""];
      const steps = q.steps.length ? `<ol class="ol-q-steps">${q.steps.map(st => {
        const rw = questRewardText(st.xp, st.kuizhi);
        const mark = st.state === "done" ? "✔" : st.state === "cur" ? "▶" : "·";
        return `<li class="ol-q-${st.state}${st.hidden ? " ol-q-lock" : ""}"><span class="ol-q-mark">${mark}</span><span class="ol-q-t">${st.hidden ? "？？？（尚未揭示）" : esc(st.title)}</span>${rw ? `<span class="ol-q-rw${st.got ? " ol-q-got" : ""}">${rw}${st.got ? " · 已领" : ""}</span>` : ""}</li>`;
      }).join("")}</ol>` : "";
      const r = q.reward || {};
      const done = q.got ? " ✓" : "";
      const chips = [r.xp ? `<span class="ol-q-xp">经验 ${esc(r.xp)}/人${done}</span>` : "", r.kuizhi ? `<span class="ol-q-kz">奎支 ${esc(r.kuizhi)}${done}</span>` : ""]
        .concat((r.items || []).map(x => `<span>${esc(x)}${done}</span>`)).filter(Boolean).join("");
      return `<article class="ol-q-card ${stCls}"><header><b>${esc(q.name)}</b><span class="ol-q-tag${q.category === "main" ? " ol-q-main" : q.category === "personal" ? " ol-q-personal" : ""}">${q.category === "main" ? "主线" : q.category === "personal" ? `个人${q.owner ? " · " + esc(q.owner) : ""}` : "支线"}${q.private ? " · 仅你可见" : ""}</span><span class="ol-q-st">${stText}</span>${q.days ? `<span class="ol-muted">${esc(q.days)} 天</span>` : ""}</header>${q.goal ? `<p class="ol-q-goal">${esc(q.goal)}</p>` : ""}${q.status === "failed" && q.failWhy ? `<p class="ol-muted">${esc(q.failWhy)}</p>` : ""}${steps}${chips ? `<div class="ol-q-rewards"><span class="ol-muted">完成奖励</span>${chips}</div>` : ""}</article>`;
    }
    function questMarkup() {
      const list = questList();
      const order = { active: 0, posted: 1, done: 2, failed: 3 };
      const group = (cat, title) => {
        const rows = list.filter(q => q.category === cat).sort((a, b) => order[a.status] - order[b.status]);
        return `<h3 class="ol-q-sec">${title}</h3>${rows.map(questCard).join("") || '<p class="ol-muted">暂无。</p>'}`;
      };
      return `<div class="ol-card ol-quest-card"><header><h2>任务日志</h2><button type="button" class="ol-button" data-bag="close">关闭</button></header>${group("main", "主线任务")}${group("side", "支线任务")}${list.some(q => q.category === "personal") ? group("personal", "个人任务") : ""}<p class="ol-muted">任务由主持人发布和推进。每一步的奖励在完成这一步时发：经验每人一份，奎支进队伍钱包。个人任务只有你看得到，经验只给你的角色。</p></div>`;
    }
    function openQuests() {
      bagBox.innerHTML = questMarkup(); bagBox.hidden = false; questBoxOpen = true;
      bagBox.querySelector('[data-bag="close"]')?.focus({ preventScroll: true });
    }
    /* ---------- NPC 资料（角色资料，lore-ui.js；房主发来的只有已发布条目的索引 packet.lore）---------- */
    // 不带条数：390px 下工具栏一格只有 84px，再长就被截（新发布的会弹提示）
    function loreButton() {
      if (!global.LoreUI || view.packet?.mode === "rogue") return "";
      return button(global.LoreUI.ENTRY, "lore", 'title="主持人发布的人物资料（只读）"');
    }
    /** 和上一包比：新任务、推进、完成、失败 → 提示一句（第一次收到不提示） */
    /** 主持人开店 / 关店：提示一句（第一次收到不提示） */
    let shopSeen;
    function observeShop() {
      const s = view.packet?.shop || null, id = s ? s.id : null;
      if (shopSeen !== undefined && shopSeen !== id) {
        toast.textContent = s ? `🛒「${s.name}」开张了，可以买东西` : "🛒 商店收摊了";
        toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
        if (s) toast.textContent += "（点顶上的「钱包与商店」打开）";
      }
      shopSeen = id;
    }
    function observeQuests() {
      const list = questList();
      const now = Object.fromEntries(list.map(q => [q.id, { status: q.status, done: q.steps.filter(s => s.state === "done").length, name: q.name, q }]));
      if (questSeen) {
        const msgs = [];   // 一个包里可能同时有好几条变动：都收集起来，合成一句提示
        for (const id of Object.keys(now)) {
          const a = questSeen[id], b = now[id];
          if (!a) msgs.push(`新任务：「${b.name}」（${b.q.category === "main" ? "主线" : b.q.category === "personal" ? "个人" : "支线"}）`);
          else if (a.status !== b.status && b.status === "done") msgs.push(`任务完成：「${b.name}」${b.q.reward.xp ? ` · 每人 +${b.q.reward.xp} 经验` : ""}${b.q.reward.kuizhi ? ` · +${b.q.reward.kuizhi} 奎支` : ""}`);
          else if (a.status !== b.status && b.status === "failed") msgs.push(`任务失败：「${b.name}」`);
          else if (a.status !== b.status && b.status === "active") msgs.push(`接下任务：「${b.name}」`);
          else if (b.done > a.done) {
            const st = b.q.steps[b.done - 1] || {};
            msgs.push(`任务更新：「${b.name}」推进到第 ${b.done + 1} 步${st.xp ? ` · 每人 +${st.xp} 经验` : ""}${st.kuizhi ? ` · +${st.kuizhi} 奎支` : ""}`);
          }
        }
        if (msgs.length) { toast.textContent = "📜 " + msgs.join("；"); toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 4500); }
      }
      questSeen = now;
      // 任务日志和背包 / 资料共用 bagBox：只在容器里真的还是任务日志时才跟着更新，别把正在看的背包盖掉
      if (questBoxOpen && !bagBox.hidden && bagBox.querySelector(".ol-quest-card")) bagBox.innerHTML = questMarkup();
      if (bagBox.hidden) questBoxOpen = false;
    }
    /** 长休结算：房主那边长休完，玩家画面也弹（单局在 rogue.lastRest，跑团在 rest） */
    function observeRest() {
      const r = view.packet?.mode === "rogue" ? view.packet?.rogue?.lastRest : view.packet?.rest;
      const id = r && r.id ? r.id : null;
      if (restSeen === undefined) { restSeen = id; return; }
      if (id && id !== restSeen && global.RestReport) global.RestReport.play(r, { gm: false });
      restSeen = id;
    }
    /** 营地（跑团，长休前）：主持人开了营地就显示全队状态，收起就关掉 */
    function observeCamp() {
      if (!global.RestReport || view.packet?.mode === "rogue") return;
      const c = view.packet?.camp;
      if (c && !global.RestReport.isOpen("camp")) global.RestReport.camp(c, { host: false, hostName: view.hostName || view.packet?.hostName || "", force: c.force });
      if (!c && global.RestReport.isOpen("camp")) global.RestReport.hide();
    }
    /* ---------- 大字 ---------- */
    const TITLE_PRESETS = [["援军来了", "hope"], ["他们来了", "danger"], ["小心！", "danger"], ["天亮了", "hope"]];
    function paintTitleForm() {
      const tones = { plain: "普通（金色）", danger: "危险（红色）", hope: "希望（青色）" };
      titleBox.innerHTML = `<div class="ol-card"><header><h2>发大字</h2><button type="button" class="ol-button" data-title="close">关闭</button></header><p class="ol-muted">所有玩家画面中间会突然出现这行大字，几秒后淡出；小队频道里也会留一条记录。</p><div class="ol-attr-btns">${TITLE_PRESETS.map(([t, tone]) => `<button type="button" class="ol-button" data-title-preset="${esc(t)}|${tone}">${esc(t)}</button>`).join("")}</div><label>大字<input id="ol-title-text" data-tf="text" maxlength="40" value="${esc(titleForm.text)}" placeholder="比如：援军来了"></label><label>小字（可不填）<input data-tf="sub" maxlength="80" value="${esc(titleForm.sub)}" placeholder="比如：北边的山坡上亮起了火把"></label><label>风格<select data-tf="tone">${Object.keys(tones).map(k => option(k, tones[k], k === titleForm.tone)).join("")}</select></label><label>停留秒数<input data-tf="seconds" type="number" min="2" max="15" value="${esc(titleForm.seconds)}"></label><footer><button type="button" class="ol-button ol-primary" data-title="go"${disabled() ? " disabled" : ""}>发出去</button></footer></div>`;
    }
    function openTitleForm() { if (!view.active || !view.isHost) return; paintTitleForm(); titleBox.hidden = false; titleBox.querySelector("#ol-title-text")?.focus({ preventScroll: true }); }
    async function sendTitle() {
      if (!titleForm.text.trim() || disabled()) return;
      const cmd = { type: "showTitle", text: titleForm.text.trim(), sub: titleForm.sub.trim(), tone: titleForm.tone, seconds: Number(titleForm.seconds) || 4 };
      if (await call(() => api.submit(cmd))) { titleForm.text = ""; titleForm.sub = ""; titleBox.hidden = true; }
    }
    /** 收到新的大字就播一次（刚进房间时已经有的那条不重播） */
    function playTitle() {
      const t = hs().title;
      if (!view.active || !view.packet) return;
      if (!titlePrimed) { titlePrimed = true; lastTitle = t ? t.id : null; return; }
      if (!t || t.id === lastTitle) return;
      lastTitle = t.id;
      clearTimeout(titleTimer);
      titleShow.className = "ol-ui ol-title-show ol-tone-" + (t.tone || "plain");
      titleShow.innerHTML = `<div class="ol-title-main">${esc(t.text)}</div>${t.sub ? `<div class="ol-title-sub">${esc(t.sub)}</div>` : ""}`;
      titleShow.hidden = false;
      void titleShow.offsetWidth; titleShow.classList.add("on");
      const ms = Math.max(2, Math.min(15, Number(t.seconds) || 4)) * 1000;
      titleTimer = setTimeout(() => { titleShow.classList.remove("on"); titleShow.classList.add("out"); titleTimer = setTimeout(() => { titleShow.hidden = true; }, 700); }, ms);
      if (global.Sfx && Sfx.enabled && Sfx.enabled() && Sfx.ui) { try { Sfx.ui("turn"); } catch (_) {} }
    }
    /* ---------- 掷骰（按钮式 d100） ---------- */
    const LV = ["没有熟练", "一级熟练", "二级熟练", "三级熟练"];
    /** 能替谁掷：玩家是自己的角色，主持人是全队 */
    function rollUnits() {
      const units = ((displayState || view.state || {}).units || []).filter(u => u.isPlayer && !u.weaponOf && !u.hidden && u.kit);
      if (view.isHost) return units;
      const mine = new Set((hs().units || []).filter(u => u.owner === own()).map(u => u.id));
      return units.filter(u => mine.has(u.id));
    }
    function profLevel(kit, prof) {
      const p = typeof heroProfile === "function" ? heroProfile(kit) : null;
      return Math.min(3, Number(((p && p.profs) || {})[prof]) || 0);
    }
    function rollLines(level) {
      const row = (typeof ROGUE_CHECKS !== "undefined" && ROGUE_CHECKS.chance[level]) || [0, 0, 0, 0];
      const pct = x => Math.floor(x * 100 + 1e-9);   // 点数是整数：12.5 就是 ≤12
      const out = [];
      [["大成功", 5], ["极难", pct(row[3])], ["困难", pct(row[2])], ["普通", pct(row[1])], ["简单", pct(row[0])]].filter(([, v]) => v > 5).forEach(([n, v]) => {
        const last = out[out.length - 1];
        if (last && last.v === v) last.n += " / " + n; else out.push({ n, v });
      });
      return ["大成功 ≤5"].concat(out.map(x => `${x.n} ≤${x.v}`)).join(" · ") + (out.length && out[out.length - 1].v < 100 ? ` · 更高是失败` : "");
    }
    function paintRoll() {
      const units = rollUnits();
      if (!units.some(u => u.id === rollForm.unit)) rollForm.unit = units[0]?.id || "";
      const u = units.find(x => x.id === rollForm.unit);
      const groups = typeof PROFICIENCIES !== "undefined" ? PROFICIENCIES : {};
      const all = Object.values(groups).flat();
      if (!all.includes(rollForm.prof)) rollForm.prof = all[0] || "";
      const profOpts = Object.keys(groups).map(g => `<optgroup label="${esc(g)}">${groups[g].map(p => { const lv = u ? profLevel(u.kit, p) : 0; return option(p, `${p}${lv ? "（" + LV[lv] + "）" : ""}`, p === rollForm.prof); }).join("")}</optgroup>`).join("");
      const level = u ? profLevel(u.kit, rollForm.prof) : 0;
      const perks = u && typeof checkPerksFor === "function" ? checkPerksFor(u.kit, rollForm.prof, false) : {};
      rollBox.innerHTML = `<div class="ol-card"><header><h2>掷骰 · d100</h2><button type="button" class="ol-button" data-roll="close">关闭</button></header>${units.length ? `<label>角色<select id="ol-roll-unit">${units.map(x => option(x.id, x.name, x.id === rollForm.unit)).join("")}</select></label><label>熟练项<select id="ol-roll-prof">${profOpts}</select></label><p class="ol-roll-lines"><b>${esc(LV[level])}</b>　点数越低越好：${esc(rollLines(level))}${perks.adv ? "（种族优势：掷两颗取低）" : perks.dis ? "（种族劣势：掷两颗取高）" : ""}</p><label>说明（可不填）<input id="ol-roll-note" maxlength="80" value="${esc(rollForm.note)}" placeholder="比如：撬开仓库的锁"></label>${view.isHost ? `<label class="ol-check-line"><input type="checkbox" id="ol-roll-secret"${rollForm.secret ? " checked" : ""}> 暗骰（结果只有主持人看得到）</label>` : ""}<footer>${view.isHost ? "" : `<button type="button" class="ol-button" data-roll="ask"${disabled() ? " disabled" : ""} title="请主持人定难度，同意后由房主掷骰，结果大家都看得到">申请检定</button>`}<button type="button" class="ol-button ol-primary" data-roll="go"${disabled() ? " disabled" : ""}>掷 d100</button></footer>` : '<p class="ol-muted">还没有分配到你的角色。</p>'}</div>`;
    }
    /** 游戏内确认：返回 Promise<boolean>。同时只开一个，新的会把旧的当作取消 */
    function askConfirm(title, text, okLabel = "确定", cancelLabel = "取消") {
      if (confirmResolve) closeConfirm(false);
      confirmBox.innerHTML = `<div class="ol-card"><header><h2>${esc(title)}</h2></header>${String(text || "").split("\n").map(t => `<p>${esc(t)}</p>`).join("")}<div class="ol-confirm-actions"><button type="button" class="ol-button" data-confirm="no">${esc(cancelLabel)}</button><button type="button" class="ol-button ol-primary" data-confirm="yes">${esc(okLabel)}</button></div></div>`;
      confirmBox.hidden = false;
      confirmBox.querySelector('[data-confirm="yes"]')?.focus({ preventScroll: true });
      return new Promise(resolve => { confirmResolve = resolve; });
    }
    /** 暂停页面的「离开房间 / 离开并保存」：确认了才走和房间面板底下同一个 api.leave() */
    async function leaveAsk() {
      const c = global.PauseMenu ? global.PauseMenu.CONFIG.items.leave : null;
      if (!c || !view.active) return;
      const host = !!view.isHost;
      if (await askConfirm(host ? c.hostConfirmTitle : c.confirmTitle, host ? c.hostConfirmText : c.confirmText, host ? c.hostLabel : c.label, c.cancel)) await call(() => api.leave());
    }
    function closeConfirm(ok) {
      confirmBox.hidden = true; confirmBox.innerHTML = "";
      const r = confirmResolve; confirmResolve = null; if (r) r(!!ok);
    }
    function openRoll() { if (!view.active) return; paintRoll(); rollBox.hidden = false; rollBox.querySelector("#ol-roll-prof, [data-roll=close]")?.focus({ preventScroll: true }); }
    async function doRoll() {
      if (!rollForm.unit || !rollForm.prof || disabled()) return;
      const cmd = { type: "skillRoll", unitId: rollForm.unit, prof: rollForm.prof, note: rollForm.note.trim() };
      if (view.isHost && rollForm.secret) cmd.secret = true;
      if (await call(() => api.submit(cmd))) { rollForm.note = ""; rollBox.hidden = true; }
    }
    /** 主动发起检定（规则层 hotseat.js · requestCheck）：主持人定难度同意后房主掷骰 */
    async function askCheck() {
      if (!rollForm.unit || !rollForm.prof || disabled()) return;
      if (await call(() => api.submit({ type: "checkRequest", unitId: rollForm.unit, prof: rollForm.prof, note: rollForm.note.trim() }))) { rollForm.note = ""; rollBox.hidden = true; }
    }
    /** 最近 10 场战绩：每场的结果、评价、掉落，和每个人的数据 */
    function recordMarkup(list) {
      const out = { win: "胜利", lose: "失败", retreat: "撤退" };
      const cols = [["dmg", "伤害"], ["share", "占比%"], ["brk", "击破"], ["kills", "击杀"], ["staggers", "失衡"], ["assists", "协助攻击"], ["blockOk", "格挡成功"], ["taken", "承伤"], ["heal", "治疗"], ["score", "得分"]];
      const rows = list.slice().reverse().map(b => {
        const d = b.drops, dropText = d ? [d.kuizhi ? `${d.kuizhi} 奎支` : "", ...(d.items || []).map(x => `${x.name}×${x.qty}`)].filter(Boolean).join("、") : "";
        return `<article class="ol-record"><header><b>第 ${esc(b.no)} 场${b.name ? " · " + esc(b.name) : ""}</b><span>${esc(out[b.outcome] || "")} · ${esc(b.turns)} 回合${b.grade ? ` · 评价 ${esc(b.grade)}（${esc(b.score)} 分）` : ""}</span></header>${b.when ? `<small class="ol-muted">${esc(b.when)}</small>` : ""}${dropText ? `<p>掉落：${esc(dropText)}</p>` : ""}${(b.rows || []).length ? `<div class="ol-record-table"><table><thead><tr><th>角色</th>${cols.map(c => `<th>${c[1]}</th>`).join("")}</tr></thead><tbody>${b.rows.map(r => `<tr><td>${r.weaponOf ? "　" : ""}${esc(r.name)}</td>${cols.map(c => `<td>${esc(r[c[0]] ?? 0)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : '<p class="ol-muted">这场没有明细。</p>'}</article>`;
      }).join("");
      return `<div class="ol-card ol-record-card"><header><h2>最近 10 场战绩</h2><button type="button" class="ol-button" data-bag="close">关闭</button></header>${rows || '<p class="ol-muted">还没有打过仗。</p>'}</div>`;
    }
    async function openInfo(kind, kitWanted) {
      if (pending || typeof api.sheetData !== "function") return;
      let data = null;
      const ok = await call(async () => { data = await api.sheetData(); if (data?.ok === false) return data; });
      if (!ok || !data || destroyed) return;
      const kit = kitWanted || myKit();
      if (kind === "sheet" && global.HeroSheet) global.HeroSheet.open(data.sheets || [], kit);
      else if (kind === "armory" && global.Armory) global.Armory.open(data.armory || [], kit);
      else if (kind === "record") { bagBox.innerHTML = recordMarkup(data.battles || []); bagBox.hidden = false; bagBox.querySelector('[data-bag="close"]')?.focus({ preventScroll: true }); }
    }

    function render() {
      if (destroyed) return;
      view = api.getView() || {};
      const nextRoom = view.active ? `${view.roomCode || ""}:${own() || ""}` : "";
      if (historyRoom !== nextRoom) {
        historyRoom = nextRoom; historyRows = []; historyHasMore = true; historyLoading = false; historyGeneration++;
        seenMessages = new Set(); messagesInitialized = false; clearTimeout(toastTimer); toast.hidden = true;
        questSeen = null; questBoxOpen = false; restSeen = undefined;
        privUnread = 0; lobbyUnread = 0; lobbySeen = null;   // 换了房间：上一个房间的未读红点不带过来
      }
      if (view.active) historyRows = mergeMessages([...historyRows, ...(view.messages || [])]);
      playTitle();
      stage.hidden = !view.active || view.isHost;
      side.hidden = !view.active || view.isHost || view.screen === "lobby";
      document.body.classList.toggle("ol-has-side", !side.hidden);
      document.body.classList.toggle("ol-host-online", !!(view.active && view.isHost));
      document.body.classList.toggle("ol-in-battle", view.screen === "battle" || view.screen === "ended");
      dock.hidden = !view.active;
      if (view.active && !view.isHost) {
        // 进战斗（或离开单局画面）：工坊、非战斗模式的背包收起来
        if (view.screen !== "exploration") { if (global.WorkshopUI) global.WorkshopUI.close(); if (global.BackpackUI && !global.BackpackUI.inBattleMode()) global.BackpackUI.close(); }
        if (global.WorkshopUI) global.WorkshopUI.refresh(); if (global.BackpackUI) global.BackpackUI.refresh();
        // 诊所 · 义体：离开探索就收起；否则按新包重画（钱包、预览、已装列表）；包里没有 cyberware 了（离开诊所）refresh 会自己关
        if (view.screen !== "exploration" && global.CyberwareUI) global.CyberwareUI.close();
        if (global.CyberwareUI) global.CyberwareUI.refresh();
        if (global.MatchupUI) { if (!matchupOf()) global.MatchupUI.close(); else global.MatchupUI.refresh(); }
      }
      document.body.classList.toggle("online-player", !!view.active && !view.isHost);
      // 纸片画面（#308）：联机玩家的战斗画面开着新画面（3D 建好了）时换成新排版；新画面关着（还在加载、打不开）、主持人、单机都照旧
      setPaper(!!global.OnlinePaper && global.OnlinePaper.active({ active: view.active, isHost: view.isHost, screen: view.screen, on3d: !!(field3d && field3d.on()) }));
      // 先定房间面板开不开（下面数新消息要用：面板开着，私信就算看到了）
      // 联机单局的房主：大厅里先要在单局画面选队伍，房间面板不挡着；队伍选好（有角色可分）时自动打开一次
      const rogueHost = view.active && view.isHost && view.mode === "rogue";
      const heroCount = (view.heroes || []).length;
      if (rogueHost && view.screen === "lobby" && heroCount && !rogueHeroesSeen) panelOpen = true;
      if (rogueHost && lastScreen === "lobby" && view.screen !== "lobby") panelOpen = false;   // 开始了：收起房间面板
      lastScreen = view.screen;
      rogueHeroesSeen = heroCount > 0;
      // 有协助 / 格挡询问轮到我回应：先收起房间面板、钱包与商店弹窗、背包浮层（.ovl 8500 会盖住询问），别把询问挡住（倒计时到了会自动放弃）
      const myAsk = view.active && !view.isHost && hs().ask && hs().ask.eligible && !hs().ask.declined;
      // 暂停页面（#298）也收起：联机不会真的暂停，询问照样在倒计时
      if (myAsk && view.screen !== "lobby") { panelOpen = false; suppliesOpen = false; closeMyBag(); if (loreUi) loreUi.close(); if (global.PauseMenu) global.PauseMenu.close(); }
      // 离开房间 / 被移出 / 变成房主：玩家打开的背包浮层（keep: true 不会自己收）收起来
      if (!(view.active && !view.isHost)) closeMyBag();
      panel.hidden = !(panelOpen || view.active && view.screen === "lobby" && !rogueHost);
      if (panel.hidden) lobbyView = false;
      // 暂停页面：联机时标题写「菜单」、说明不会真的暂停；在哪个画面都能开（主持人、玩家）
      if (global.PauseMenu) global.PauseMenu.setOnline(view.active ? { host: !!view.isHost } : null);
      if (view.active) {
        if (!animating) displayState = view.state || null;
        if (request && (request.actor !== hs().currentUnitId || hs().phase !== "acting")) { request = currentMenu = null; actionGeneration++; }
        observeMessages(); observeLobbyChat();
        paintDock();   // 数完新消息再画按钮：红点和这一包的消息一起出来（以前按钮先画，未读数要等下一次重画）
        if (!view.isHost) { observeQuests(); observeCamp(); observeRest(); observeShop(); observeSellLast(); }
      }
      pauseBar.hidden = !(view.active && !view.isHost && view.screen !== "lobby" && (paused() || view.offlineWait));
      // 离线等待：显示还剩几秒（到时间自动跳过 / 结束他的行动）；截止时间已换成本机的钟（online-game.js · localDeadlines）
      if (!pauseBar.hidden) {
        const bar = paused() ? "⏸ 房间暂停：正在等待连接恢复，恢复后会自动继续。"
          : `⏳ ${esc(view.offlineWait.name)} 离线，等待其返回${Number(view.offlineWait.deadline) > 0 ? `（<span role="timer" aria-live="off" data-ol-deadline="${Number(view.offlineWait.deadline)}"></span>，到时间自动跳过）` : ""}。`;
        if (pauseBar.dataset.html !== bar) { pauseBar.innerHTML = bar; pauseBar.dataset.html = bar; if (global.OnlineBattle && global.OnlineBattle.tickCountdowns) global.OnlineBattle.tickCountdowns(pauseBar); }
      }
      document.body.classList.toggle("ol-paused", !pauseBar.hidden);
      paintLevelUps();
      paintPanel();
      seeLobbyChat();
      renderSide();
      mountHostChat();
      paintPaper();   // 纸片画面的顶栏 / 吊牌先画好：新画面开关要挪进它的「工具 ▾」（paintStage → paintField3d）
      if (!stage.hidden) paintStage();
      else paintField3d(null);
      paintDetail();   // 单位详情面板跟着这一包刷新（离开战斗画面、说明的东西不在战场上了就收起）
      paintSupplies();
      if (checkReq) checkReq.sync();
      if (loreUi) loreUi.sync();
      paperDress();   // 纸片画面（#308）：画完再贴纸纹（量得到大小）
      if (view.active && !view.isHost) scheduleAutoMenu();
      // 轮到自己的角色行动：响一次 DJ 搓碟（同一次只响一次；页面刚打开、重新同步时只记下）。演出还在播时等播完（行动开始的那一刻）
      if (turnCue && !animating) turnCue.see(turnInfo(null, view.screen));
    }
    /** 「房间码 · 菜单」（#298）：点它打开暂停页面（pause-menu.js），「消息与成员」「大厅」「角色分配」「克制表」「主持人工具」都在里面
     *  （以前这里是「房间码 · 消息与成员」和「角色分配」两个按钮）。别人发来的新私信、大厅交流里还没看到的新消息，
     *  照旧记在按钮右上角的红点上（#207；由 PauseMenu.refresh 按「消息与成员」那一项的数字画）。
     *  手机上太长时省略的是按钮里的文字，红点不被裁掉；按钮带 id：来消息重画时键盘焦点留在按钮上（html() 按 id 找回焦点） */
    function paintDock() {
      html(dock, `<button type="button" class="g-btn ol-button pm-open" id="ol-menu-open" data-pause-open="1" title="${esc(DOCK_TEXT.title)}"><span class="ol-dock-label">${esc(`${view.roomCode || DOCK_TEXT.room} · ${paused() ? DOCK_TEXT.reconnecting : DOCK_TEXT.menu}`)}</span></button>`, "dock");
      if (global.PauseMenu) global.PauseMenu.refresh();
    }
    /** 打开房间面板（暂停页面里的「消息与成员」「大厅」「角色分配」，和以前点原来的按钮一样）。which：room / lobby / assign */
    function openPanel(which) {
      panelOpen = true; lobbyView = which === "lobby";
      render();
      if (which === "assign") document.getElementById("ol-assign-head")?.scrollIntoView({ block: "start" });
      if (which === "lobby") panel.querySelector('[data-keep-scroll="lobby"]')?.scrollIntoView({ block: "nearest" });
    }
    // 暂停页面里的联机项（#298）：按身份显示，主持人工具在 online-gm-ui.js 登记
    const pauseItems = global.PauseMenu ? [
      global.PauseMenu.register({ id: "room", visible: () => !!view.active, badge: () => privUnread + lobbyUnread,
        label: () => `${view.roomCode || DOCK_TEXT.room} · ${paused() ? DOCK_TEXT.reconnecting : global.PauseMenu.CONFIG.items.room.label}`, run: () => openPanel("room") }),
      global.PauseMenu.register({ id: "lobby", visible: () => !!view.active && view.screen !== "lobby", run: () => openPanel("lobby") }),
      global.PauseMenu.register({ id: "assign", visible: () => !!(view.active && view.isHost && view.mode !== "rogue" && ["exploration", "ended"].includes(view.screen)), run: () => openPanel("assign") }),
      // 联机玩家的克制表：房主算好发来的 view.matchup（不含坚毅）；主持人用单机那一项（matchup-ui.js）
      global.PauseMenu.register({ id: "matchupOnline", config: "matchup", visible: () => !!(view.active && !view.isHost && view.screen === "battle" && matchupOf()),
        run: () => { if (global.MatchupUI) global.MatchupUI.open(() => matchupOf()); } }),
      // 音效开关（#304）：联机玩家看不到房主顶栏的「音效 开 / 关」，放在菜单里（点了菜单不收起）；
      // 和单机同一个本机开关（sfx.js · Sfx.enabled / setEnabled 的 localStorage 键），只影响这台电脑，不发给别人
      global.PauseMenu.register({ id: "sfx", stay: true, visible: () => !!(view.active && !view.isHost && global.Sfx),
        pressed: () => !!(global.Sfx && global.Sfx.enabled()),
        label: () => { const c = global.PauseMenu.CONFIG.items.sfx; return global.Sfx && global.Sfx.enabled() ? c.on : c.off; },
        run: () => { const S = global.Sfx; if (!S) return; S.setEnabled(!S.enabled()); if (S.enabled()) S.play("physical"); } }),
      // 离开房间 / 离开并保存（主持人）：每个画面都直接看得见，不用先进「消息与成员」；点了先确认（游戏内确认框）
      global.PauseMenu.register({ id: "leave", visible: () => !!view.active,
        label: () => { const c = global.PauseMenu.CONFIG.items.leave; return view.isHost ? c.hostLabel : c.label; },
        hint: () => { const c = global.PauseMenu.CONFIG.items.leave; return view.isHost ? c.hostHint : c.hint; },
        run: () => leaveAsk() }),
      // 玩家选着技能、正在选目标、战场上有要点选的询问：Esc 留给战场取消（online-battle.js），不开菜单
      global.PauseMenu.addBlocker(() => !!(view.active && !view.isHost && view.screen === "battle" && (request?.skill || fieldAsk()))),
      // 纸片画面（#308）的「工具 ▾」下拉、⇅ 点开的按钮开着：Esc 先收它们
      global.PauseMenu.addBlocker(() => !!(paperOn && (toolsOpen || swapOpen != null))),
      // 单位详情面板开着（作者 10/20）：Esc 先收面板（onDetailKey），不开菜单
      global.PauseMenu.addBlocker(() => detailOpen())
    ] : [];
    function paintPanel() {
      if (panel.hidden) return;
      const count = view.active && view.screen === "lobby" ? lobbyUnread : 0, was = lobbyDot; lobbyDot = count;
      html(panel, view.active ? roomMarkup() : entryMarkup(), "panel");
      if (count && !was) popDot(panel.querySelector(".ol-lobby-chat .ol-dot"));
    }
    /** 舞台：文字部分照旧拼 HTML；战斗画面是常驻的一块（单位卡有动画，不能每次重建），每次画完再挂回占位处 */
    function paintStage() {
      // 重画文字部分时战场那一块会先被拿掉，舞台一下子变矮、滚动位置被压到顶上；等战场挂回去再把滚动位置放回原处
      // （以前玩家每行动一次，画面就跳回最上面，要再往下翻）
      const top = stage.scrollTop, fieldEl = battle && battle.el.querySelector(".g-field"), fieldTop = fieldEl ? fieldEl.scrollTop : 0;
      // 夜晚色调：和主持人 / 单机一样按游戏时钟（game.js 给 .g-app 加 is-night）；联机跑团和联机单局都发 packet.clock
      const ck = view.packet?.clock, night = !!(view.active && ck && global.PartyCards && global.PartyCards.isNight(ck.clock));
      stage.classList.toggle("is-night", night); document.body.classList.toggle("ol-night", night);
      const note = notice || view.notice || view.packet?.systemNotice ? `<p class="ol-notice" role="status">${esc(notice || view.notice || view.packet?.systemNotice)}</p>` : "";
      // 纸片画面（#308）：舞台只剩铺满的战场，提示 / 结算 / 检定浮在吊牌下面，原来那一排按钮不画
      html(stage, paperOn ? paperStageMarkup(note) : `${note}${stageMarkup()}`, "stage");
      const slot = stage.querySelector(".ol-battle-slot");
      if (!slot) { paintField3d(null); return; }
      const b = battleView();
      if (!b) return;
      if (b.el.parentElement !== slot) slot.appendChild(b.el);
      const ui = battleUi();
      b.update(displayState || view.state || {}, ui);
      paintPaperHud(b.el);
      paintField3d(ui);   // 新画面（HD-2D，#289）：开着就跟着这一包重排；关着只把开关挪过来
      if (stage.scrollTop !== top) stage.scrollTop = top;
      // 战斗中舞台本身不滚动，是战场自己滚动：同样放回原处
      if (fieldEl && fieldEl.isConnected && fieldEl.scrollTop !== fieldTop) fieldEl.scrollTop = fieldTop;
    }
    const myUnits = () => (hs().units || []).filter(u => u.owner === own()).map(u => u.id);
    /** 战场点选的规则询问（柯尔特更换刀头、赫米卡环境扫描……）：轮到自己回答时，敌人在战场上亮起、点它；其余选项放提示栏按钮 */
    function fieldAsk() { const a = hs().ask; return view.screen === "battle" && a && a.kind === "choice" && a.field && a.eligible && !a.declined && (a.options || []).length ? a : null; }
    async function answerField(index) {
      const a = fieldAsk(), o = a && a.options[index]; if (!o || disabled()) return;
      const command = { type: "answer", askId: a.id, helper: o.helper || null };
      if (Object.prototype.hasOwnProperty.call(o, "extra")) command.extra = copy(o.extra);
      await call(() => api.submit(command));
    }
    const isMyTurn = () => view.screen === "battle" && hs().phase === "acting" && myUnits().includes(hs().currentUnitId);
    /* 联机玩家的音效（online-sfx.js，#304）：播包时和单机响一样的音效、轮到自己时响一次 DJ 搓碟。声音只从收到的包推出来，不读房主的 state */
    const turnCue = global.OnlineSfx ? global.OnlineSfx.turnWatch() : null;
    /** 这一刻轮到谁（只看收到的包：view 里的行动阶段 / 谁在行动 / 角色归谁，state 里的回合数）；p = 刚收到、还没换上的包 */
    const turnInfo = (p, screen) => {
      p = p || view.packet || {};
      const v = p.view || {};
      return { active: !!view.active, isHost: !!view.isHost, screen: screen || p.screen || view.screen, phase: v.phase, current: v.currentUnitId, turnNo: (p.state || view.state || {}).turnNo,
        room: view.roomCode || "", mine: (v.units || []).filter(u => u.owner === own()).map(u => u.id) };
    };
    /** 播一个包的音效：被新的包顶掉、离开房间、演出倍率 0（跳过）以后不再响 */
    const sfxFor = (packet, before, generation) => global.OnlineSfx ? global.OnlineSfx.start(packet, {
      before, bigHit: typeof global.bigHitInfo === "function" ? global.bigHitInfo : null,
      live: () => !destroyed && generation === playbackGeneration && hd2dSpec.clock() > 0
    }) : null;
    function battleUi() {
      const data = displayState || view.state || {}, cur = hs().currentUnitId, acting = view.screen === "battle" && hs().phase === "acting";
      const curUnit = (data.units || []).find(u => u.id === cur), mine = myUnits();
      const choices = currentMenu?.choices || null;
      let hint = "";
      if (view.screen === "ended") hint = "战斗结束。";
      else if (animating) hint = "结算中…";
      else if (!acting) hint = view.packet?.manualPhase || view.manualPhase ? "主持人正在操控敌人。" : hs().phase === "enemy" ? "敌人行动中。" : "等待开始。";
      else if (!mine.includes(cur)) hint = `等待 ${curUnit ? curUnit.name : "队友"}${curUnit && hs().units ? `（${playerName((hs().units.find(u => u.id === cur) || {}).owner)}）` : ""} 行动。`;
      else if (!choices) hint = "正在取技能…";
      else hint = `${curUnit ? curUnit.name : ""}　${global.OnlineBattle && global.OnlineBattle.isTouch && global.OnlineBattle.isTouch() ? "选择技能。点技能看说明。" : "选择技能（1–9）。悬停技能看说明，空格结束行动。"}`;
      const field = fieldAsk();
      if (field) {
        // 有对应单位的选项 → value 是单位 id（战场上亮起、编号）；其余 value 为空 → 提示栏按钮
        const menuOf = { kind: "unit", title: field.title || "选择", options: field.options.map(o => ({ label: o.label + (o.sub ? `（${o.sub}）` : ""), value: o.target || null })) };
        return { mine, current: cur, acting, menu: menuOf, skills: [], armed: "__field", rule: true, hint: field.title || "", busy: disabled(), deadline: Number(field.deadline) || 0 };
      }
      return { mine, current: cur, acting, menu: choices, skills: skillsFor === cur && acting ? skillOptions : [],
        armed: request && request.skill || "", hint, busy: disabled() };
    }
    function battleView() {
      if (battle || !global.OnlineBattle) return battle;
      battle = global.OnlineBattle.create(battleCb);
      return battle;
    }
    /** 战场上的点选：旧画面的单位卡 / 区（online-battle.js）、新画面的铭牌 / 地台（hd2d/hd2d-field.js，#289）都走这一份，规则和预演都问主机 */
    const battleCb = {
        onSkill: id => { if (!isMyTurn() || disabled()) return; menu({ actor: hs().currentUnitId, skill: id }); },
        onOption: index => { if (disabled()) return; if (fieldAsk()) { answerField(index); return; } choose(index); },
        onUnit: id => {
          const field = fieldAsk();
          if (field) { const i = field.options.findIndex(o => o.target && String(o.target) === String(id)); if (i >= 0) answerField(i); return; }
          // 不是在选目标（没选技能）：点一下单位 / 配置物 / 间隔打开详情面板（作者 10/20 定；选了技能就照旧是选目标）
          if (!request?.skill) { openDetail(id); return; }
          const m = currentMenu?.choices; if (!m || disabled()) return;
          let i = (m.options || []).findIndex(o => !o.disabled && String(o.value) === String(id));
          if (i < 0 && m.kind === "zone") {   // 区域选择时点到区里的单位，算点那个区
            const u = ((displayState || view.state || {}).units || []).find(x => x.id === id);
            if (u) i = (m.options || []).findIndex(o => !o.disabled && Number(o.value) === Number(u.zone));
          }
          if (i >= 0) choose(i);
        },
        onZone: z => {
          const m = currentMenu?.choices; if (!m || disabled()) return;
          const i = (m.options || []).findIndex(o => !o.disabled && Number(o.value) === Number(z));
          if (i >= 0) choose(i);
        },
        onCancel: () => { if (fieldAsk()) return; if (request?.skill && !disabled()) menu({ actor: request.actor }); },
        onEnd: async () => { if (!isMyTurn() || disabled()) return; const actor = hs().currentUnitId; if (!(await endTurnOk(actor))) return; if (await call(() => api.submit({ type: "endTurn", actor }))) { request = currentMenu = null; } }
    };
    /* ---------- 新画面（HD-2D，#289）----------
     * 开关、云雾转场、镜头、场景都是 hd2d/hd2d-field.js 那一份：舞台上有战斗画面就 attach 过去（开关 #g-hd2d-toggle 挪到舞台顶上的工具栏，同一个按钮），
     * 离开战斗 / 离开房间 detach（开关放回单机的顶栏）。画面只用收到的包（displayState / view.state：online-view.js 的白名单投影过的，packetView），不碰房主的 state；
     * 点铭牌 / 地台走旧战场同样的回调（battleCb），悬停铭牌弹旧画面同样的单位说明（unitTip）；演出中点战场 = 跳过。
     * 开关只记在这台电脑上（localStorage），镜头是自己的，都不发给别人（不经过 api） */
    let field3d = null;
    const hover3d = { unit: null, zone: null };
    const hd2dSpec = {
      field: () => (battle ? battle.el.querySelector(".g-field") : null),
      app: () => (battle ? battle.el : null),
      view: () => global.HD2DField.packetView(displayState || view.state || null, { OB: global.OnlineBattle, OV: global.OnlineView }),
      input: {
        unit: id => { if (animating) { skip3d(); return; } battleCb.onUnit(id); },
        hover: (id, on, el) => {
          hover3d.unit = on ? String(id) : null;
          marks3d();
          const T = global.UnitTip;
          if (!T) return;
          if (!on || (global.matchMedia && global.matchMedia("(hover: none)").matches)) { T.hide(); return; }
          // 新画面上间隔的字牌（驻波墙，hd2d-field.js · syncWaveTags）悬停也走同一份说明
          const key = String(id), node = key.indexOf("gap:") === 0 ? { classList: { contains: c => c === "g-gap" }, dataset: { key: key.slice(4) } }
            : { dataset: key.indexOf("prop:") === 0 ? { propId: key.slice(5) } : { unitId: key } };
          const h = el ? unitTip(node) : "";
          if (h) T.show(el, h); else T.hide();
        },
        zone: z => { if (animating) { skip3d(); return; } if (z != null) battleCb.onZone(z); },
        zoneHover: (z, on) => { hover3d.zone = on ? Number(z) : null; marks3d(); }
      },
      // 演出倍率：和旧画面的攻击演出（attack-fx.js）同一个钟（game.js 开页面时交给 AttackFx 的「演出 1× / 2×」）；这台机器上没有就按 1
      clock: () => { try { const G = global.GAME; return G && typeof G.fxClock === "function" ? G.fxClock() : 1; } catch (_) { return 1; } },
      refresh: () => setTimeout(() => { if (!destroyed) render(); }, 0),
      hint: msg => { notice = msg; setTimeout(() => { if (!destroyed) render(); }, 0); },
      // 纸片画面（#308）：开关在顶栏「工具 ▾」下拉里
      slot: () => stage.querySelector(".ol-hd2d-slot") || paperBox.querySelector(".ol-hd2d-slot")
    };
    const skip3d = () => { if (field3d) field3d.skip(); };
    /** 选目标 / 选区的标记（和 online-battle.js 画单位卡、区的 is-targetable / is-dim / is-move-target 同一个判断：这一步菜单里能选的） */
    function marksOf3d(ui) {
      const m = ui.menu, ok = o => !o.disabled && o.value != null && o.value !== "";
      const unit = !!(m && m.kind === "unit"), zone = !!(m && m.kind === "zone");
      return { pick: unit, targets: unit ? (m.options || []).filter(ok).map(o => String(o.value)) : [], hover: hover3d.unit,
        zones: zone ? (m.options || []).filter(ok).map(o => Number(o.value)) : [], hoverZone: hover3d.zone };
    }
    function marks3d() { if (field3d) field3d.marks(marksOf3d(battleUi())); }
    /** 新画面跟着舞台：有战斗画面就挂上去，跟着这一包重排、谁在行动、选目标的标记；没有就拆下来 */
    function paintField3d(ui) {
      const F = global.HD2DField;
      if (!F || typeof F.attach !== "function") return;
      if (!ui || !battle) {
        if (field3d) { F.detach(hd2dSpec); field3d = null; hover3d.unit = hover3d.zone = null; }
        return;
      }
      field3d = F.attach(hd2dSpec);
      if (!field3d) return;
      field3d.actor(ui.acting ? ui.current || null : null);
      field3d.marks(marksOf3d(ui));
      // 正在播行动包（#330）：换了区的铭牌在两个地台之间滑过去、新出现的单位亮个相（和单机的新画面一样）
      field3d.view({ animate: animating });
    }
    /** 新画面开着时播一个行动包（hd2d-play.js，和原型页同一份）：出招前的画面留着，第一下打中时换成包里的 state（铭牌的血条跟着掉），播完回到这一包 */
    async function play3d(packet, generation) {
      const before = displayState || null;
      animating = true; render();
      const snd = sfxFor(packet, before, generation);   // 音效（online-sfx.js）：出手、每一段打中、格挡、演完的那一刻由 hd2d-play.js 叫
      try {
        await field3d.play(packet, {
          before, bigHit: typeof global.bigHitInfo === "function" ? global.bigHitInfo : null,
          onImpact: () => { if (destroyed || generation !== playbackGeneration) return; displayState = packet.state || displayState; render(); },
          sound: snd ? (kind, i) => { if (typeof snd[kind] === "function") snd[kind](i); } : null
        });
      } catch (_) { /* 画坏了不影响结算 */ }
      finally { if (generation === playbackGeneration) { animating = false; displayState = packet.state || displayState; render(); } }
    }
    /** 结束行动前：这个单位还有行动点或附赠没用就先问一句（防止误触） */
    async function endTurnOk(actor) {
      const u = (((displayState || view.state || {}).units) || []).find(x => x.id === actor);
      if (!u || !((Number(u.ap) || 0) > 0 || (Number(u.bonus) || 0) > 0)) return true;
      const ok = await askConfirm("结束行动", `${u.name || "这个单位"} 还有 ${Number(u.ap) || 0} 点行动、${Number(u.bonus) || 0} 次附赠没用，确定结束行动吗？`, "结束行动", "继续行动");
      // 等确认的这段时间里回合可能已经变了（超时 / 主持人操作），只在还是这名角色时才结束
      return ok && isMyTurn() && hs().currentUnitId === actor;
    }
    /** 轮到自己的角色：自动取技能栏（不用再点「选择行动」）。每个回合 / 每次结算后的新状态取一次 */
    function scheduleAutoMenu() {
      if (!isMyTurn() || request || pending || animating) return;
      const key = hs().currentUnitId + ":" + (view.packet?.seq ?? "") + ":" + (hs().turnNo ?? "");
      if (autoKey === key) return;
      autoKey = key;
      setTimeout(() => { if (!destroyed && isMyTurn() && !request && !pending) menu({ actor: hs().currentUnitId }); }, 0);
    }
    async function call(fn) {
      if (pending) return false;
      pending = true; notice = ""; render();
      try { const result = await fn(); if (result?.ok === false) { notice = result.error || "操作未生效"; return false; } return true; }
      catch (error) { notice = error.message || String(error); return false; }
      finally { pending = false; render(); }
    }
    async function menu(next) {
      if (disabled()) return;
      const generation = ++actionGeneration; request = copy(next); selectedActor = request.actor; currentMenu = null;
      await call(async () => {
        const result = await api.actionMenu(copy(next));
        if (generation !== actionGeneration || destroyed) return;
        if (result?.ok === false || result?.error) { notice = result.error || "动作菜单不可用"; currentMenu = null; return; }
        if (result?.type !== "actionOptions" || result.displayOnly !== true) throw new Error("没有收到有效的动作选项");
        currentMenu = copy(result);
        if (currentMenu.choices?.kind === "skill") { skillOptions = currentMenu.choices.options || []; skillsFor = request.actor; }
      });
      // 选完最后一步（主机回「确认执行」）就直接执行，和其他模式点目标就出手一样
      if (generation === actionGeneration && currentMenu?.choices?.kind === "ready" && currentMenu.choices.command && battle) {
        const command = copy(currentMenu.choices.command), actor = request?.actor;
        if (await call(() => api.submit(command))) { request = currentMenu = null; autoKey = ""; render(); }
        else if (actor && !destroyed) { const why = notice; await menu({ actor }); if (why) { notice = why; render(); } }   // 没执行成功：回到技能栏，顶上写原因
      }
    }
    async function choose(index) {
      const choices = currentMenu?.choices, chosen = choices?.options?.[index];
      if (!chosen || chosen.disabled || !request) return;
      const next = copy(request), value = copy(chosen.value);
      if (choices.kind === "skill") { next.skill = value; next.picks = {}; delete next.target; delete next.dest; delete next.item; }
      else if (choices.key === "item") next.item = value;
      else if (choices.key === "dest" && ["__move", "__item"].includes(next.skill)) next.dest = value;
      else if (choices.key === "target" && (next.skill === "__item" || !(next.skill && choices.optional != null))) {
        // Flow menus always carry optional (even false); a final target menu
        // has no optional field and becomes the command's primary target.
        next.target = value;
      } else { next.picks ||= {}; next.picks[choices.key] = value; }
      await menu(next);
    }
    /** 复制房间码：优先用剪贴板接口，不行（file:// 等不安全来源）就退回选中文字再复制 */
    async function copyRoomCode() {
      const code = String(view.roomCode || "");
      if (!code) return;
      let ok = false;
      try { if (navigator.clipboard && window.isSecureContext !== false) { await navigator.clipboard.writeText(code); ok = true; } } catch (e) { ok = false; }
      if (!ok) {
        const ta = document.createElement("textarea");
        ta.value = code; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        ta.remove();
      }
      notice = ok ? `已复制房间码 ${code}` : "无法自动复制，请长按或拖选房间码手动复制。";
      render();
    }
    async function sendMessage() {
      const text = form.text.trim(); if (!text || disabled()) return;
      if (await call(() => api.submit(view.isHost ? { type: "gm.msg", to: form.to, text } : { type: "gmReply", text }))) { form.text = ""; render(); }
    }
    async function sendLobbyChat() {
      const text = form.chatText.trim(); if (!text || disabled()) return;
      if (await call(() => api.submit({ type: "chat", text }))) { form.chatText = ""; render(); }
    }
    function input(event) {
      const box = event.target.closest && event.target.closest("[data-cyber-box]");
      if (box) { cyberDraft[box.dataset.cyberBox] = cyberPlanOf(box.dataset.cyberBox); return; }
      if (event.target.dataset.workshop) { workshopDraft[event.target.dataset.workshop] = event.target.value; if (event.type === "change") { lastMarkup.supplies = ""; render(); paintSupplies(); } return; }
      if (event.target.dataset.purse) { purseDraft[event.target.dataset.purse] = event.target.value; return; }
      if (event.target.dataset.shopQty) { shopDraft.qty[event.target.dataset.shopQty] = event.target.value; return; }
      if (event.target.hasAttribute && event.target.hasAttribute("data-shop-payer")) { shopDraft.payer = event.target.value; if (event.type === "change") render(); return; }
      const key = event.target.dataset.field; if (key && Object.hasOwn(form, key)) form[key] = event.target.value; }
    function change(event) {
      input(event); if (event.target.dataset.field === "mode") render(); if (event.target.dataset.assign) assignments[event.target.dataset.assign] = event.target.value;
      if (event.target.dataset.transfer) transferDraft[event.target.dataset.transfer] = event.target.value;
      if (event.target.dataset.partyKit) partyDraft = [...document.querySelectorAll("[data-party-kit]")].filter(x => x.checked).map(x => x.dataset.partyKit);
    }
    async function click(event) {
      if (global.ShopSellUI && event.target.closest?.("[data-ss-host]")) {
        let cmd = null;
        if (ShopSellUI.handle(event, c => { cmd = c; }, () => { lastMarkup.supplies = ""; render(); paintSupplies(); })) { if (cmd) await sellSubmit(cmd); return; }
      }
      const b = event.target.closest("[data-online]"); if (!b || b.disabled) return;
      switch (b.dataset.online) {
        case "createTab": entry = "create"; render(); break;
        case "joinTab": entry = "join"; render(); break;
        case "close": panelOpen = false; render(); break;
        case "cancelConnect": api.cancelConnect?.(); break;   // 连接中的「取消」：call() 收到「已取消连接」后恢复表单
        // 打开房间面板（消息与成员 / 大厅 / 角色分配）在暂停页面里（openPanel）；面板开了，私信的红点在 observeMessages 里清掉
        case "messageHistory": await earlierMessages(); break;
        case "connect": {
          const opts = { url: form.url.trim() || DEFAULT_RELAY, name: form.name.trim() || (entry === "create" ? "主持人" : "玩家") };
          try { if (form.name.trim()) localStorage.setItem(NAME_KEY, form.name.trim()); } catch (e) { /* 存不了就算了 */ }
          if (entry === "create" && form.mode === "rogue") opts.mode = "rogue";
          else if (entry === "create") Object.assign(opts, { slot: Number(form.slot), campaignName: form.campaignName.trim() || "联机跑团" });
          else opts.roomCode = form.roomCode.replace(/[^0-9a-z]/gi, "").toUpperCase();   // 粘贴时带的空格、标点去掉
          if (await call(() => api[entry === "create" ? "create" : "join"](opts))) { panelOpen = false; assignments = {}; render(); }
          break;
        }
        case "resume": if (await call(() => api.resume())) { panelOpen = false; render(); } break;
        case "reconnect": await call(() => api.reconnect()); break;
        case "copyCode": await copyRoomCode(); break;
        case "leave": await call(() => api.leave()); break;
        case "setParty": {
          const kits = partyDraft || [...document.querySelectorAll("[data-party-kit]")].filter(x => x.checked).map(x => x.dataset.partyKit);
          if (await call(() => api.setParty(kits))) { partyDraft = null; assignments = {}; }
          break;
        }
        case "assign": await call(() => api.assign(Object.fromEntries((view.heroes || []).map(h => [h.id, assignments[h.id] || h.owner || own()])))); assignments = {}; break;
        case "transfer": if (typeof api.transfer === "function") { const hero = b.dataset.hero; await call(() => api.transfer(hero, transferDraft[hero] || own())); transferDraft = {}; } break;
        case "takeOver": if (typeof api.takeOver === "function") await call(() => api.takeOver(b.dataset.player)); break;
        case "releaseSeat":
          if (typeof api.releaseSeat !== "function") break;
          if (!(await askConfirm("释放座位", `释放「${b.dataset.name}」的座位？\n他会被移出房间，角色交回主持人；之后可以用同一个昵称重新加入（丢了恢复令牌、换了设备时用）。`, "释放座位"))) break;
          await call(() => api.releaseSeat(b.dataset.player)); break;
        case "start": if (await call(() => api.start())) { panelOpen = false; render(); } break;
        case "actor": await menu({ actor: b.dataset.actor }); break;
        case "resetMenu": if (request) await menu({ actor: request.actor }); break;
        case "option": await choose(Number(b.dataset.option)); break;
        case "execute": if (currentMenu?.choices?.command && !disabled()) { const command = copy(currentMenu.choices.command); if (await call(() => api.submit(command))) { currentMenu = request = null; render(); } } break;
        case "endTurn": if (!disabled() && await endTurnOk(b.dataset.actor)) await call(() => api.submit({ type: "endTurn", actor: b.dataset.actor })); break;
        case "info": if (b.dataset.info === "bag") { openBag(); break; } await openInfo(b.dataset.info, b.dataset.kit || null); break;
        case "focusHero": focusKit = b.dataset.kit || ""; render(); break;
        case "quests": openQuests(); break;
        case "lore": if (loreUi) loreUi.open(); break;
        case "map": openMap(); break;
        case "supplies": suppliesOpen = true; lastMarkup.supplies = ""; paintSupplies(); suppliesBox.querySelector('[data-online="suppliesClose"]')?.focus({ preventScroll: true }); break;
        case "showLog": sideTab.battle = "log"; if (paperOn && !paperDrawer) setPaperDrawer(true); renderSide(true); side.querySelector(".ol-side-log")?.scrollIntoView({ block: "nearest" }); break;
        case "checkRoll": if (!disabled()) await call(() => api.submit({ type: "checkRoll", checkId: b.dataset.check, unitId: b.dataset.unit })); break;
        case "attrRequest": if (!disabled()) await call(() => api.submit({ type: "attrRequest", unitId: b.dataset.unit, attr: b.dataset.attr })); break;
        case "shopBuy": if (!disabled()) { if (global.Sfx) Sfx.ui("coin"); await call(() => api.submit({ type: "shopBuy", merchant: view.packet?.shop?.id, key: b.dataset.key, qty: Math.max(1, Number(shopDraft.qty[b.dataset.key]) || 1), payer: shopDraft.payer })); } break;
        case "smithUpgrade": if (!disabled()) await call(() => api.submit({ type: "smithUpgrade", kit: b.dataset.kit, weapon: b.dataset.weapon, mode: b.dataset.mode })); break;
        case "workshopCraft": if (!disabled()) await call(() => api.submit({ type: "workshopCraft", kit: workshopDraft.kit, item: b.dataset.item, helper: workshopDraft.helper || null })); break;
        case "workshopSalvage": if (!disabled()) await call(() => api.submit({ type: "workshopSalvage", kit: workshopDraft.kit, item: b.dataset.item })); break;
        case "shopRedeem": if (!disabled()) await call(() => api.submit({ type: "shopRedeem", merchant: view.packet?.shop?.id, item: b.dataset.item })); break;
        case "purseTransfer": if (!disabled()) await call(() => api.submit({ type: "purseTransfer", from: byId("ol-purse-from")?.value, to: byId("ol-purse-to")?.value, amount: Number(byId("ol-purse-n")?.value) || 0 })); break;
        case "rogueVote": if (!disabled()) await call(() => api.submit({ type: "rogue.vote", option: b.dataset.option })); break;
        case "rogueUnvote": if (!disabled()) await call(() => api.submit({ type: "rogue.vote", option: null })); break;
        case "rogueNeed": if (!disabled()) await call(() => api.submit({ type: "rogue.need", loot: Number(b.dataset.loot), kit: b.dataset.kit, need: b.dataset.want === "1" })); break;
        case "rogueAct": if (!disabled()) await call(() => api.submit({ type: "rogue.act", command: JSON.parse(b.dataset.cmd) })); break;
        case "trpgCyber": {
          const kit = b.dataset.kit, plan = cyberPlanOf(kit), c = (view.packet?.clinic?.heroes || []).find(x => x.kit === kit);
          if (!plan || !c || disabled()) break;
          const cost = cyberEstimate(c, plan);
          if (!cost) { notice = "方案没有变化"; render(); break; }
          if (cost > Number(b.dataset.purse)) { notice = `预计要 ${cost} 奎支，${c.name} 的钱包不够`; render(); break; }
          if (!(await askConfirm("义体改造", `申请给 ${c.name} 做义体改造，预计花 ${cost} 奎支？\n主持人同意后才会改；伤势照旧带着，缺的血先从外层扣。`, "提交申请"))) break;
          if (await call(() => api.submit({ type: "cyberRequest", kit, plan }))) delete cyberDraft[kit];
          break;
        }
        case "rogueCyber": {
          const kit = b.dataset.kit, plan = cyberPlanOf(kit), c = (view.packet?.rogue?.clinic || []).find(x => x.kit === kit);
          if (!plan || !c || !c.cyber || disabled()) break;
          const cost = cyberEstimate(c, plan);
          if (!cost) { notice = "方案没有变化"; render(); break; }
          if (cost > Number(b.dataset.purse)) { notice = `预计要 ${cost} 奎支，你的钱不够`; render(); break; }
          if (!(await askConfirm("义体改造", `给 ${c.name} 做义体改造，预计花 ${cost} 奎支？\n伤势照旧带着，缺的血先从外层扣。`, "改造"))) break;
          if (await call(() => api.submit({ type: "rogue.act", command: { action: "modifyHero", kit, plan } }))) delete cyberDraft[kit];
          break;
        }
        case "rogueWorkshop": openWorkshop(); break;
        case "rogueCyberware": case "trpgCyberware": openCyberware(); break;
        case "rogueCraftJob": {
          const kit = b.dataset.kit, item = byId("ol-wk-item-" + kit)?.value || null, helper = byId("ol-wk-help-" + kit)?.value || null;
          if (!disabled() && kit) await call(() => api.submit({ type: "rogue.act", command: { action: "setCraftJob", kit, item, helper } }));
          break;
        }
        case "roguePartInstall": {
          const [kit, slot] = String(byId(b.dataset.select)?.value || ":").split(":");
          if (!disabled() && kit) await call(() => api.submit({ type: "rogue.act", command: { action: "installPart", kit, slot: Number(slot), part: b.dataset.part, smith: b.dataset.smith } }));
          break;
        }
        case "attrCancel": if (!disabled()) await call(() => api.submit({ type: "attrDecide", requestId: b.dataset.request, decision: "cancel" })); break;
      }
    }
    async function playPacket(packet) {
      if (destroyed || api.getView().isHost || packet?.displayOnly !== true) return;
      const generation = ++playbackGeneration;
      if (packet.type === "resync") {
        actionGeneration++; request = currentMenu = null; selectedActor = ""; autoKey = "";
        // A long disconnect can skip more than the live history window. Restart
        // pagination at this window, rather than retaining two disjoint ranges.
        historyRows = []; historyHasMore = true; historyLoading = false; historyGeneration++;
        seenMessages = new Set(); messagesInitialized = false; clearTimeout(toastTimer); toast.hidden = true;
        lobbySeen = null;   // 重新同步带来的大厅聊天记录不算新消息
        skip3d();           // 新画面正在播的立刻结束（#289；关着什么都不做）
        if (turnCue) turnCue.prime();   // 重新同步（断线重连）以后第一次看到的回合只记下，不响搓碟
        displayState = packet.state || null; animating = false; return;
      }
      // 页面在后台（别的标签页）：不等演出播完（后台的计时器很慢），收到包就看轮没轮到自己——这正是提示音最有用的时候
      if (turnCue && typeof document !== "undefined" && document.hidden) turnCue.see(turnInfo(packet, packet.screen));
      const tape = packet.tape || [];
      if (!tape.length) return;
      // 新画面（HD-2D）开着：整包交给 hd2d/hd2d-field.js · play（纸片风数字、纸片感、推镜头，#289）；关着照旧走下面的旧画面
      if (field3d && field3d.on()) { await play3d(packet, generation); return; }
      animating = true; render();
      const held = [];   // 这一段演完之前留在场上的被打倒的敌人（卡片 + 红叉），演完一起淡出
      let zoomed = false;
      const snd = sfxFor(packet, displayState, generation);   // 音效跟着画面一下一下响（online-sfx.js）
      try {
        // 攻击演出（attack-fx.js）：房主发来这一下谁打谁、哪种招式（有专属演出的再带脚本名和现场数据）——
        // 先播出手和弹道，再一段段跳数字，主攻击那几段补上打中的形状（刀光、冲击星……），敌人倒下喷一个红叉
        const AF = global.AttackFx, fx = packet.fx && AF ? packet.fx : null;
        const cardFor = (uid) => (battle && battle.cardOf(uid)) || [...stage.querySelectorAll("[data-unit-id]")].find(node => node.dataset.unitId === uid);
        const rectOf = (node) => { if (!node || !node.isConnected) return null; const r = node.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height * .42, w: r.width, h: r.height } : null; };
        const scr = fx && fx.script ? AF.script(fx.script) : null;
        const ctx = scr ? onlineCtx(fx, tape, cardFor, rectOf) : null;
        let fxFrom = null, mainNo = 0;
        if (fx && generation === playbackGeneration) {
          // 协助攻击、碎渣重炮、狂瀑：镜头推近
          if (fx.assist || (scr && scr.zoom)) { zoomed = zoomOnline(rectOf(cardFor(fx.target))); if (zoomed) await AF.after(300); }
          // 拉斯缪尔的能量罐
          if (fx.tank) { const tr = rectOf(cardFor(fx.tank.id)); if (tr) AF.tank(tr, fx.tank.from, fx.tank.to, { ms: fx.tank.ms }); }
          if (snd) snd.strike();   // 出手：开枪声 / 近战的破风声
          try { fxFrom = await strikeOnline(fx, scr, ctx, cardFor, rectOf); } catch (_) { fxFrom = null; }
          // 格挡成功：协助格挡的火花在两人连线的中点，自己格挡的在格挡的人身上
          if (fx.parried) {
            const b = rectOf(cardFor(fx.blocker || fx.target)), a = rectOf(cardFor(fx.actor));
            if (fx.blocker && a && b) AF.sparks({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); else if (b) AF.clash(b);
            if (snd) snd.parry();
          }
        }
        const deadBefore = new Set(((displayState || {}).units || []).filter(u => u && u.dead).map(u => u.id));
        for (const event of tape) {
          if (destroyed || generation !== playbackGeneration) break;
          if (event.type !== "pop") continue;
          const main = !!(fx && fxFrom && event.kind === "dmg" && event.main), n = main ? mainNo++ : -1;
          // 主攻击的后几段：有专属演出的照脚本再来一下（再飞一发、再撞一次……）；一闪这类一下子全部结算的不用
          if (main && n > 0 && scr && scr.again && !scr.instant) { try { await scr.again(ctx, event, n); } catch (_) { /* 画坏了不影响结算 */ } }
          // 只打击破的那一下（二次盾突……）：有专属演出的先演出手
          if (fxFrom && event.kind === "break" && scr && scr.brk) { try { await scr.brk(ctx, event); } catch (_) { /* 同上 */ } }
          if (Array.isArray(event.snap)) displayState = { ...(displayState || packet.state || {}), units: copy(event.snap) };
          paintStage();
          if (snd) snd.pop(event);   // 打中、治疗、状态字；这一下的快照里有人被击倒 / 濒死 / 换区也一起响
          const card = cardFor(event.unitId);
          if (AF && card && event.kind === "dmg") {
            const u = ((displayState || {}).units || []).find(x => x && x.id === event.unitId);
            if (u && u.dead && !u.isPlayer && !deadBefore.has(u.id)) {
              // 被打倒：这一段演完之前卡片和红叉都先留着（game.css · .unit-wrap.dead.ko-held）
              deadBefore.add(u.id);
              card.classList.add("ko-held");
              const uid = u.id;
              held.push({ id: uid, slow: !!(u.display && u.display.killBig), h: AF.ko(rectOf(card), { hold: "manual", track: () => rectOf(cardFor(uid)) }) });
            }
          }
          if (event.kind === "proc") {
            // 效果生效：卡上对应的图标放大一下并发光，不弹字
            if (card) global.HudIcons?.procIn(card, event.fx);
            await new Promise(resolve => setTimeout(resolve, 60));
            continue;
          }
          if (card) {
            // 战斗画面的单位卡没有自带弹字框：临时挂一个
            let bubble = card.querySelector(".ol-popup");
            if (!bubble) { bubble = document.createElement("span"); bubble.className = "ol-popup ol-pop-temp"; bubble.setAttribute("aria-live", "polite"); card.appendChild(bubble); }
            bubble.textContent = event.text || (event.value == null ? ({ dmg: "受击", heal: "恢复", break: "击破", status: "状态变化" }[event.kind] || "行动") : `${event.kind === "heal" ? "+" : event.kind === "dmg" ? "−" : ""}${event.value}`);
            const fk = (event.kind === "fxword" || event.kind === "status") && event.text && global.HudIcons?.keyOf(event.text);
            if (fk && event.kind === "fxword") { bubble.insertAdjacentHTML("afterbegin", global.HudIcons.badge(fk)); global.HudIcons.proc(bubble.firstElementChild); }
            if (fk) global.HudIcons.procIn(card, fk);
            card.classList.add("ol-impact"); bubble.classList.add("ol-visible");
            if (global.HitFx && (event.kind === "dmg" || event.kind === "highboom" || event.kind === "carboom")) global.HitFx.burst(event.element || "physical", card.getBoundingClientRect(), { big: event.kind !== "dmg" });
            if (event.kind === "carboom") {
              // 自爆小车死亡引爆：在小车身上炸开（和房主画面一样：震屏、爆炸形状；爆炸声在 online-sfx.js），炸到的人的数字跟在后面
              const w = battle && battle.el;
              if (w) { w.classList.remove("quake", "quake-s"); void w.offsetWidth; w.classList.add("quake"); setTimeout(() => w.classList.remove("quake"), 600); }
              if (AF && AF.impact) { try { AF.impact(rectOf(card), { kind: "explode", el: event.element || "energy", area: true }, {}); } catch (_) { /* 画坏了不影响结算 */ } }
            }
            if (main && !fx.parried) {
              if (scr && scr.impact) { try { scr.impact(ctx, event, n, false); } catch (_) { /* 同上 */ } }
              else AF.impact(rectOf(card), fx.move, { n, from: fxFrom });
            }
          }
          await new Promise(resolve => setTimeout(resolve, main && scr && scr.instant ? 40 : 180));
          if (card) { card.classList.remove("ol-impact"); card.querySelector(".ol-popup")?.classList.remove("ol-visible"); card.querySelector(".ol-pop-temp")?.remove(); }
        }
        if (snd) snd.end();   // 演完：失衡、还没响过的击倒 / 护盾 / 换区（被新的包顶掉了就不响）
      } finally {
        if (zoomed) zoomOutOnline();
        held.forEach(k => {
          const c = battle && battle.cardOf(k.id);
          if (c) c.classList.remove("ko-held");
          if (k.h) (k.slow ? k.h.release(2400, 1400) : k.h.release(1200, 500));
        });
        if (generation === playbackGeneration) { animating = false; displayState = packet.state || displayState; render(); }
      }
    }
    /** 联机玩家：照房主发来的招式播出手——有专属演出的照脚本演；没有的近身冲过去（打到之后再回位）、远程蓄力 + 弹道、支援 / 挂效果拉一条线；返回出手的人的位置 */
    async function strikeOnline(fx, scr, ctx, cardFor, rectOf) {
      const AF = global.AttackFx, a = cardFor(fx.actor), t = cardFor(fx.target), m = fx.move;
      const ra = rectOf(a), rt = rectOf(t);
      if (!ra || !m) return null;
      if (scr && (scr.pre || scr.self)) { try { await (scr.pre || scr.self)(ctx); } catch (_) { /* 画坏了不影响结算 */ } return rectOf(a) || ra; }
      if (!rt) return null;
      if (m.kind === "support" || m.kind === "hex") {
        if (fx.actor !== fx.target) await AF.link(ra, rt, m);
        AF.impact(rt, m, { from: ra });
        return ra;
      }
      if (m.melee) {
        await dashCard(a, ra, rt, { heavy: m.heavy });
        if (m.flash) AF.area(rt, ra, m);
        return ra;
      }
      await AF.windup(ra, rt, m);
      if (m.area) AF.area(rt, ra, m);
      await AF.travel(ra, rt, m);
      return ra;
    }
    /** 把一张卡冲向 t（和 game.js · dashTo 一样：先往后一收再扑上去，打到之后回原位）。
     *  o.reach 冲多远（999 = 一直冲到 t）· o.heavy 冲得远一点 · o.speed 时间倍率 · o.hold 到了停多久 · o.keep 冲过去就消失的（等它隐去再悄悄回位） */
    async function dashCard(node, a, t, o) {
      o = o || {};
      if (!node || !a || !t) return;
      const AF = global.AttackFx;
      const dx = t.x - a.x, dy = t.y - a.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
      const reach = o.reach >= 999 ? d : Math.max(16, Math.min(d - Math.min(a.w, t.w) * .5, o.reach || (o.heavy ? 112 : 92)));
      const k = o.speed || 1, token = String(fxRandom());
      node.dataset.olDash = token; node.style.zIndex = "5";
      node.style.transition = `transform ${90 * k}ms cubic-bezier(.2, .7, .3, 1)`;
      node.style.transform = `translate(${(-ux * 12).toFixed(1)}px, ${(-uy * 12).toFixed(1)}px)`;
      await AF.after(90 * k);
      node.style.transition = `transform ${100 * k}ms cubic-bezier(.55, 0, .9, .55)`;
      node.style.transform = `translate(${(ux * reach).toFixed(1)}px, ${(uy * reach).toFixed(1)}px)`;
      await AF.after(100 * k);
      settleCard(node, token, o.hold || (o.keep ? 560 : 130), o.keep ? 0 : 240);
    }
    /** 出手后回原位；中途这张卡又被别的动作接管就不管了 */
    function settleCard(node, token, hold, back) {
      setTimeout(() => {
        if (node.dataset.olDash !== token) return;
        node.style.transition = `transform ${back}ms cubic-bezier(.3, .8, .3, 1)`; node.style.transform = "";
        setTimeout(() => { if (node.dataset.olDash !== token) return; node.style.transition = ""; node.style.zIndex = ""; delete node.dataset.olDash; }, back + 20);
      }, hold);
    }
    /** 专属演出（attack-fx.js · SCRIPTS）的「现场」：和 game.js · strikeCtx 一样的几样东西，换成联机画面里的卡片 */
    function onlineCtx(fx, tape, cardFor, rectOf) {
      const AF = global.AttackFx;
      const boxOf = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } : null; };
      const zoneRect = (x) => boxOf(typeof x === "number" ? battle && battle.el.querySelector(`.g-zone[data-num="${x}"]`) : cardFor(x)?.closest(".g-zone"));
      const pops = tape.filter(e => e.type === "pop");
      const targets = [];
      // 爆炸（tag "boom"）炸到的不算这次出手的目标（和 game.js · strikePlan 一样）
      pops.forEach(e => { if (e.unitId && e.unitId !== fx.actor && e.tag !== "boom" && /^(dmg|break|status|fxword)$/.test(e.kind) && !targets.includes(e.unitId)) targets.push(e.unitId); });
      const shakeEl = () => battle && battle.el;
      return {
        actor: fx.actor, target: fx.target, mains: pops.filter(e => e.kind === "dmg" && e.main), targets, move: fx.move || {}, data: fx.data || {},
        rect: (id) => (typeof id === "number" ? zoneRect(id) : rectOf(cardFor(id))),
        zoneRect,
        wait: (ms) => AF.after(ms),
        dash: (id, to, o) => { const n = cardFor(id); return dashCard(n, rectOf(n), to, o); },
        recoil: (id, to, px) => {
          const n = cardFor(id), a = rectOf(n); if (!n || !a || !to) return;
          const dx = to.x - a.x, dy = to.y - a.y, d = Math.hypot(dx, dy) || 1, k = px || 8, token = String(fxRandom());
          n.dataset.olDash = token; n.style.transition = "transform 70ms ease-out";
          n.style.transform = `translate(${(-dx / d * k).toFixed(1)}px, ${(-dy / d * k).toFixed(1)}px)`;
          settleCard(n, token, 110, 220);
        },
        nudge: (id, dx, dy, ms) => {
          const n = cardFor(id); if (!n) return;
          const token = String(fxRandom()); ms = ms || 240;
          n.dataset.olDash = token; n.style.transition = `transform ${ms * .4}ms cubic-bezier(.2, .8, .3, 1)`;
          n.style.transform = `translate(${dx}px, ${dy}px)`;
          settleCard(n, token, ms * .9, 260);
        },
        shake: (p) => {
          const w = shakeEl(); if (!w) return;
          const c = p >= 1 ? "quake" : "quake-s";
          w.classList.remove("quake", "quake-s"); void w.offsetWidth; w.classList.add(c);
          setTimeout(() => w.classList.remove(c), p >= 1 ? 600 : 340);
        },
        cls: (id, name, ms) => {
          const n = cardFor(id); if (!n) return;
          n.classList.remove(name); void n.offsetWidth; n.classList.add(name);
          setTimeout(() => n.classList.remove(name), (ms || 500) + 40);
        },
        burst: (el, r, big) => { if (global.HitFx && r) global.HitFx.burst(el || "physical", { left: r.x - r.w / 2, top: r.y - r.h * .42, width: r.w, height: r.h }, { big: !!big }); },
        owner: () => (fx.data && fx.data.owner) || null
      };
    }
    /** 镜头推近（协助攻击、碎渣重炮、狂瀑）：和单人画面一样——战场里的东西朝目标放大一点（战场的框不动）、底下的栏压暗，演完迅速拉回 */
    let zoomAnims = [];
    function zoomOnline(rect) {
      const wrap = battle && battle.el, f = wrap && wrap.querySelector(".g-field");
      if (!f || !rect || typeof f.animate !== "function" || wrap.classList.contains("assist-focus")) return false;
      const fr = f.getBoundingClientRect();
      f.style.setProperty("--focus-x", ((rect.x - fr.left) / Math.max(1, fr.width) * 100).toFixed(1) + "%");
      f.style.setProperty("--focus-y", ((rect.y - fr.top) / Math.max(1, fr.height) * 100).toFixed(1) + "%");
      wrap.classList.add("assist-focus");
      const still = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches, ease = "cubic-bezier(.2, .8, .3, 1)";
      if (!still) [...f.children].forEach(ch => {
        const r = ch.getBoundingClientRect(), o = `${(rect.x - r.left).toFixed(1)}px ${(rect.y - r.top).toFixed(1)}px`;
        zoomAnims.push(ch.animate([{ scale: "1", transformOrigin: o }, { scale: "1.12", transformOrigin: o }], { duration: 300, easing: ease, fill: "forwards" }));
      });
      wrap.querySelectorAll(":scope > .g-hud").forEach(d => zoomAnims.push(d.animate([{ filter: "brightness(1) saturate(1)" }, { filter: "brightness(.5) saturate(.6)" }], { duration: 300, easing: "ease-out", fill: "forwards" })));
      return true;
    }
    function zoomOutOnline() {
      const wrap = battle && battle.el;
      if (wrap) wrap.classList.remove("assist-focus");
      const list = zoomAnims; zoomAnims = [];
      list.forEach(a => { a.onfinish = () => a.cancel(); a.playbackRate = -1.6; a.play(); });
    }
    function addTitleButton(text, which) {
      const menu = document.querySelector("#scr-title .t-menu"); if (!menu) return;
      const b = document.createElement("button"); b.type = "button"; b.className = "t-btn ol-title-entry";
      b.innerHTML = `<b>${esc(text)}</b><small>${which === "create" ? "主持跑团，与朋友共享房间" : "输入房间码，以自己的角色加入"}</small>`;
      b.onclick = () => { entry = which; panelOpen = true; notice = ""; render(); };
      menu.appendChild(b); titleButtons.push(b);
    }
    addTitleButton("联机开房", "create"); addTitleButton("加入房间", "join");
    // 刷新 / 误关页面后：玩家自动回到上次的房间；失败就留在标题页，给一个显眼的「回到房间」按钮
    function addResumeButton() {
      const info = api.savedInfo?.(); const menu = document.querySelector("#scr-title .t-menu");
      // 用 querySelector：game.html 给 getElementById 垫了一层，找不到的 id 会凭空造一个隐藏的 div，以前这里永远「已经有了」，按钮一直没出来
      if (!info || !menu || document.querySelector("#ol-title-resume")) return;
      const b = document.createElement("button"); b.type = "button"; b.className = "t-btn ol-title-entry ol-title-resume"; b.id = "ol-title-resume";
      b.innerHTML = `<b>回到房间 ${esc(info.roomCode || "")}</b><small>${info.role === "host" ? "恢复你主持的房间" : `以「${esc(info.name)}」重新连上`}</small>`;
      b.onclick = async () => { entry = "join"; if (await call(() => api.resume())) { panelOpen = false; b.remove(); render(); } else { panelOpen = true; render(); } };
      menu.prepend(b); titleButtons.push(b);
      // 这个按钮在「联机玩法」子页里，首页看不到：在首页的「联机玩法」上提示一句
      const home = document.querySelector("#t-online small");
      if (home && !home.dataset.olOrig) { home.dataset.olOrig = home.textContent; home.textContent = `上次的房间 ${info.roomCode || ""}：点进来可以回去`; }
      b.addEventListener("click", () => { if (home && home.dataset.olOrig) { home.textContent = home.dataset.olOrig; delete home.dataset.olOrig; } });
    }
    async function autoResume() {
      if (autoResumeTried || destroyed) return; autoResumeTried = true;
      const info = api.savedInfo?.();
      // 玩家自己点了「离开房间」的（info.left）不自动回去，只留按钮
      if (!info || info.role !== "player" || info.left || api.getView()?.active) { if (info) addResumeButton(); return; }
      notice = `正在回到房间 ${info.roomCode}…`;
      try { const r = await api.resume(); if (r && r.ok === false) throw new Error(r.error || "恢复失败"); notice = ""; }
      catch (e) { notice = `没能自动回到房间：${e.message || e}`; addResumeButton(); toast.textContent = notice; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 6000); }
      render();
    }
    if (typeof api.savedInfo === "function") setTimeout(autoResume, 0);
    // 倒计时（询问、离线等待）每半秒刷新一次文字
    const countdownTimer = setInterval(() => { if (global.OnlineBattle && global.OnlineBattle.tickCountdowns) global.OnlineBattle.tickCountdowns(document); }, 500);
    unsubs.push(() => clearInterval(countdownTimer));
    // 申请检定：规则在 hotseat.js · requestCheck / decideCheck；角色是自己操控的（可以好几名），主持人看全队
    if (global.CheckRequestUI) checkReq = global.CheckRequestUI.mount({ api, view: () => view, own, call, profLevel, playerName,
      units: () => view.isHost ? ((displayState || view.state || {}).units || []).filter(u => u.isPlayer && !u.weaponOf && u.kit) : rollUnits() });
    // NPC 资料：规则在 lore.js（主持人的写入走 api.submit），玩家看 packet.lore、点开一条用 api.loreEntry 要详细内容
    if (global.LoreUI) loreUi = global.LoreUI.mount({ api, view: () => view, confirm: askConfirm,
      toast: text => { toast.textContent = text; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 4500); } });
    if (typeof api.subscribe === "function") unsubs.push(api.subscribe(render));
    if (typeof api.onPacket === "function") unsubs.push(api.onPacket(playPacket));
    render();
    const instance = { render, open(which = "join") { entry = which; panelOpen = true; render(); }, destroy() {
      destroyed = true; closeMyBag(); if (checkReq) { checkReq.destroy(); checkReq = null; } if (loreUi) { loreUi.destroy(); loreUi = null; } paintField3d(null); if (battle) { battle.destroy(); battle = null; } playbackGeneration++; actionGeneration++; historyGeneration++; clearTimeout(toastTimer);
      document.removeEventListener("compositionstart", onCompStart, true); document.removeEventListener("compositionend", onCompEnd, true);
      document.removeEventListener("click", onRollOpen); document.removeEventListener("scroll", onListScroll, true); clearTimeout(titleTimer);
      document.removeEventListener("click", onPaperOutside, true); document.removeEventListener("keydown", onPaperKey, true); if (paperWatch) paperWatch.disconnect(); if (paperSizer) paperSizer.disconnect(); paintPaperTheme(null);
      document.removeEventListener("keydown", onDetailKey, true);
      while (hostMounts.length) hostMounts.pop().remove(); document.body.classList.remove("ol-has-side", "ol-host-online", "ol-in-battle", "ol-side-collapsed", "ol-paper");
      pauseItems.forEach(off => off()); if (global.PauseMenu) global.PauseMenu.setOnline(null);
      paperCover();   // #339：新画面不用再让开纸片的面板（destroyed 了交 null）
      if (turnCue) turnCue.unmark();   // 标签页标题上的「▶ 轮到你」去掉
      for (const off of unsubs) if (typeof off === "function") off();
      for (const node of [...nodes, ...titleButtons]) node.remove();
      document.body.classList.remove("online-player"); if (mounted === instance) mounted = null;
    } };
    mounted = instance; return instance;
  }
  global.OnlineUI = { mount };
  const boot = () => { if (global.OnlineGame) mount(global.OnlineGame); };
  if (typeof document !== "undefined") { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
})(typeof globalThis !== "undefined" ? globalThis : window);
