/* Antlerscale: Backfire · 单机战斗画面的「纸片风」界面（#339；和联机玩家的同一套：paper-ui.js / online-paper.css，设计在 docs/ui-paper/）
 *
 * 单机（单局 / 单人模式 / 跑团、联机跑团的房主 / 热座 / 自定义战斗 / 训练场……）的战斗画面开着新画面（3D 战场建好了）时，换成和联机玩家一样的排版；
 * 新画面关着（还在加载、打不开）时什么都不加，旧画面一点不变。联机玩家的战斗画面不归这里管（online-paper.js）。
 * body 上加 .ol-paper（和联机共用的纸片样子，online-paper.css）+ .g-paper（单机自己的排版，game-paper.css）：
 *   · 战场铺满整个画面（#g-app 不再分顶栏 / 右侧栏的格子）
 *   · 顶上一条（#g-paper .olp-top）：模式（单局 / 跑团 / 联机跑团……，房主带房间码红章）· 遭遇 · 第 N 回合 · 我方 / 敌人行动 · 时间 · 天气；
 *     右边镜头 远 / 中 / 近（点的就是新画面原来那几个按钮）、「工具 ▾」、「菜单 Esc」（pause-menu.js 接）
 *   · 顶栏下面中间挂行动顺序吊牌：热座 / 联机房主是热座栏的行动顺序，⇅ 点开是热座栏原来的「延后 / 换位」（点的就是热座栏那几个按钮）；
 *     一个人打的时候是我方每个人（行动中 / 待行动 / 已行动），点牌子 = 点队伍栏里同一个人
 *   · 「工具 ▾」= 旧顶栏（.g-top）原地变成的下拉：同一批按钮、同一个 id、同一个点击处理，按模式藏的（单局、跑团、热座）照旧藏——
 *     只是换了位置、分了组（GPAPER.tools），点完收起；顶栏上的字（回合、天气、时钟、遭遇）挪到上面那一条胶带上
 *   · 左上角队伍、底下技能栏：hd2d-shell.js 的外壳（和联机同一份样子，online-paper.css）
 *   · 右边战斗记录抽屉（#g-log）：平时收成右边缘一个竖标签；联机房主的小队聊天照旧在里面（有新消息时竖标签上挂数字）
 * 各块的收起状态记在本机（localStorage，读写都包 try/catch）。只换排版，规则、出手流程、快捷键都不碰；
 * 画的东西只用页面上已经写好的字和投影过的单位（OnlineView.projectUnit 的白名单），坚毅生命（shp / shpMax）一个字都不碰。
 *
 *   纯函数（Node 里能 require，tests/game-paper.test.js）：
 *     GPAPER                       配置：paper-ui.js 的 BASE 合上下面这一份（类名、本机记住收起的键、文字、下拉的分组、贴纸纹的面板……）
 *     active(o)                    这一刻是不是单机的纸片画面：o = { screen, on3d, onlinePlayer }
 *     modeOf(o)                    顶栏最前面写什么模式
 *     soloSlots(list, o)           一个人打的时候的吊牌：我方每个人
 *     hotseatSlots(view, units, moves)   热座 / 联机房主的吊牌：热座栏的行动顺序
 *     receiptHead(mode)            战斗记录抽屉顶上的收据头（BACKFIRE / 战斗记录 · 模式 + 一排等号；记录本身照旧是 game.js 画的，game-paper.css 换成收据的样子）
 *   页面：boot() 页面加载完自己跑；sync() 有变化时（画面、新画面、顶栏、队伍栏、热座栏、镜头……）排一次 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root, require("./paper-ui.js"));
  else root.GamePaper = factory(root, root.PaperUI);
})(typeof self !== "undefined" ? self : this, function (root, UI) {
  "use strict";

  /* ---------- 配置（单机自己的；配色、纸纹这些在 paper-ui.js 的 BASE）----------
   *   bodyClass    单机的纸片画面开着时 body 上另加的类（单机独有的排版都挂在它下面，game-paper.css）；和联机共用的 .ol-paper 也加（BASE.paperClass）
   *   screens      哪些画面算战斗画面（<body data-screen>）
   *   keys         本机记住收起 / 展开的键：drawer 右边的战斗记录抽屉（技能栏、队伍栏用 hd2d-shell.js 的 SHELL.keys，和联机、原型页同一个习惯）
   *   defaults     没记过时开不开：抽屉平时收着（主人：「平时藏在右边」）
   *   toolsId      旧顶栏变成「工具 ▾」下拉时给它的 id（顶栏「工具」按钮的 aria-controls）
   *   text         顶栏最前面的模式名（modes）、吊牌上每个人的状态（status）、抽屉的竖标签……
   *   tools        「工具 ▾」下拉里的分组：每组一个小标题，ids = 旧顶栏里的按钮（下拉框住的是 <label> 就排整个 label）。
   *                没列在这里的按钮排在最后（以后顶栏多了按钮，下拉里照样有，不会丢）；hide = 只是字的那几块，挪到胶带上了，下拉里不再显示
   *   extras       纸片画面的下拉里另加的（#339 要的：单局 / 跑团探索画面顶栏上的「图鉴」「规则」、「战场数据」面板里的「整局数据」，战斗里也能直接点）：
   *                group 排在哪一组的最后、mode 图鉴打开哪一本（bestiary-ui.js · Bestiary.open；不给 = 默认那本），career 打开整局数据（sheet-ui.js · CareerLog），
   *                title 悬停说明（和原来那个按钮的同一句）。离开纸片画面就拿掉
   *   cover        浮在战场上、3D 白卡要让开的面板（第 4 步：顶栏胶带、吊牌、左上角的队伍、技能栏、右边的抽屉、一台电脑热座的那一条；量好交给 hd2d-field.js · cover）。
   *                「工具 ▾」下拉、悬停预演只是一下子，不让（不然一开下拉镜头就动）
   *   art.targets  哪些面板贴哪种纸（paper-ui.js · dress） */
  const P = UI.make({
    bodyClass: "g-paper",
    screens: ["battle"],
    keys: { drawer: "backfire.paper.drawer" },
    defaults: { drawer: false },
    toolsId: "g-paper-tools",
    text: {
      title: "战斗",
      modes: { host: "联机跑团", hostRogue: "联机单局", hotseat: "热座", trpg: "跑团", training: "训练场", solo: "单人模式", rogue: "单局", custom: "战斗" },
      roomTitle: "房间码",
      toolsTitle: "开始战斗、撤销、撤退、地图、战场数据、队伍 / 遭遇 / 战场配置、休整、存档、后台、天气、敌人等级、音效、新画面开关……（顶栏原来的按钮都在这里）",
      menuTitle: "菜单（Esc）：克制表等都在这里",
      status: { acting: "行动中", ready: "待行动", spent: "已行动", stunned: "失衡", down: "倒下" },
      drawer: "战斗记录", drawerOpen: "展开战斗记录", drawerClose: "收起战斗记录", drawerClosed: "收起 ▸"
    },
    tools: [
      { head: "战斗", ids: ["g-start", "g-undo", "g-retreat", "g-restart", "g-fast", "g-to-explore"] },
      { head: "查看", ids: ["g-map", "g-backpack", "g-stats"] },
      { head: "布置 · 主持人", ids: ["g-party-cfg", "g-enc-cfg", "g-field-cfg", "g-bag", "g-rest", "g-save", "g-bs", "g-weather-sel", "g-level", "g-xp-mult"] },
      { head: "其他", ids: ["g-sfx", "g-hd2d-toggle", "g-calc", "g-title"] }
    ],
    hide: ["g-round", "g-phasel", "g-weather", "g-clock", "g-enc-name", "g-log-open"],
    extras: [
      { id: "gp-bestiary", label: "图鉴", title: "图鉴：敌人、配置物和所有效果", group: "查看" },
      { id: "gp-rules", label: "规则", title: "规则说明：回合、行动点、检定、伤害、武器 ATK、义体改造率……", group: "查看", mode: "rules" },
      // 整局数据：以前在「战场数据」面板里（单局探索画面另有一个），战斗里也直接能点；career = 带 data-career（sheet-ui.js · CareerLog 同一个入口）
      { id: "gp-career", label: "整局数据", title: "本局 / 这个跑团存档所有战斗里每个角色的输出占比和团队贡献", group: "查看", career: true }
    ],
    // 打开图鉴时按几人队算敌人血量（同单局顶栏：场上的角色数，夹在 2–4 里）
    bestiaryParty: { min: 2, max: 4 },
    cover: ["#g-paper .olp-top", "#g-paper .olp-tags", ".g-app > .g-hud.hd2d-shell > .hd2d-party", ".g-app > .g-hud.hd2d-shell", ".g-app > .g-log.gp-drawer", "#hotseat-root"],
    art: {
      targets: [
        ["#g-paper .olp-top", "tapebar"], ["#g-paper .olp-tag-card", "tag|tagon"], ["#g-paper .olp-tools-b", "board"], ["#g-paper .olp-menu-b", "boardy"], ["#g-paper .olp-move", "card"],
        [".g-app > .g-top.gp-open", "kraft"],
        [".g-app > .g-hud.hd2d-shell > .hd2d-party", "kraft"], [".g-app > .g-hud.hd2d-shell", "dock"],
        [".g-app > .g-hud.hd2d-shell > .hd2d-party > .party > .pm", "card"], [".g-app > .g-hud.hd2d-shell > .hd2d-party > .party > .pc-sheet", "card"],
        [".g-app > .g-hud.hd2d-shell .skills .sk", "tag"], [".g-app > .g-hud.hd2d-shell .summonbtn", "board"], [".g-app > .g-hud.hd2d-shell .endturn", "board"],
        [".g-app > .g-log.gp-drawer:not(.gp-collapsed)", "receipt"], [".g-app > .g-log.gp-drawer.gp-collapsed", "kraft"]
      ]
    }
  });
  const GPAPER = P.PAPER;

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 纯函数 ---------- */
  /** 这一刻是不是单机的纸片画面：o = { screen <body data-screen>, on3d 单机的新画面建好了（#g-app.hd2d-on）, onlinePlayer 联机玩家（他的战斗画面归 online-paper.js）}。
   *  战斗画面 + 新画面建好了才是；新画面还在加载、打不开（退回旧画面）、标题 / 单局 / 跑团探索画面都不是 */
  function active(o) {
    o = o || {};
    return !!(GPAPER.screens.includes(o.screen) && o.on3d && !o.onlinePlayer);
  }
  /** 顶栏最前面的模式名：o = { host 联机房主, hostRogue 联机单局的房主, hotseat 热座, trpg 跑团, training 训练场, rogue 单局里的战斗, solo 单人模式 }；都不是 = 自定义的战斗 */
  function modeOf(o) {
    o = o || {};
    const M = GPAPER.text.modes;
    if (o.host) return o.hostRogue ? M.hostRogue : M.host;
    if (o.hotseat) return M.hotseat;
    if (o.trpg) return M.trpg;
    if (o.training) return M.training;
    if (o.rogue) return o.solo ? M.solo : M.rogue;
    return M.custom;
  }
  /**
   * 一个人打的时候的吊牌：我方每个人（队伍栏的顺序）。list = [{ id, name, face, on 队伍栏里选着的（行动中）, down 倒下, stunned 失衡, spent 行动点 / 附赠都用完了 }]，
   * o = { acting 我方回合 }。点牌子 = 点队伍栏里同一个人（pick）；没有延后 / 换位（一个人打不用排顺序）
   */
  function soloSlots(list, o) {
    o = o || {};
    const S = GPAPER.text.status;
    return (list || []).filter(u => u && u.id != null).map((u, i) => {
      const current = !!(o.acting && u.on && !u.down);
      const done = !!(u.down || u.stunned || u.spent);
      return { index: i, actor: String(u.id), name: u.name || String(u.id), face: u.face || "", current, done, pick: !u.down,
        owner: u.down ? S.down : u.stunned ? S.stunned : current ? S.acting : u.spent ? S.spent : S.ready };
    });
  }
  /**
   * 热座 / 联机房主的吊牌：view = 热座栏画的那一份（HotseatGame.getView()：行动顺序 order、操作者 players、阶段 phase……），
   * units = 投影过的单位（id → { name, face }），moves = 热座栏里每一格现在的按钮（PaperUI.readMoves）。和联机玩家的吊牌（online-ui.js · paperSlots）同一个算法
   */
  function hotseatSlots(view, units, moves) {
    view = view || {};
    const phase = view.phase;
    if (!["picking", "acting", "enemy"].includes(phase)) return [];
    const players = view.players || [], nameOf = id => (players.find(p => p.id === id) || {}).name || id || "";
    const get = id => (units && typeof units.get === "function" ? units.get(id) : null) || null;
    return (view.order || []).map((slot, i) => {
      slot = slot || {};
      const actor = slot.actor || "", u = get(actor), hu = (view.units || []).find(x => x.id === actor) || {};
      const owner = slot.owner || slot.operatorId || hu.owner;
      return { index: i, actor, name: (u && u.name) || slot.name || hu.name || actor, owner: actor ? nameOf(owner) : "", face: (u && u.face) || "",
        current: !!actor && (!!slot.current || (phase === "acting" && actor === view.currentUnitId)), done: !!slot.done, locked: !!slot.locked,
        vacated: !actor && phase !== "picking", mine: !!actor && owner === view.playerId, moves: (moves && moves.get(i)) || [] };
    });
  }

  /** 收据顶上那一块（战斗记录抽屉里，.gp-rc-head）：BACKFIRE / 战斗记录 · 模式 + 一排等号。字和联机的收据同一份（paper-ui.js · BASE.receipt），模式 = modeOf 的那个名字 */
  function receiptHead(mode) {
    const R = GPAPER.receipt;
    return `<b>${esc(R.brand)}</b><span>${esc(String(R.head).replace("{0}", mode || ""))}</span><i aria-hidden="true">${esc(R.rule)}</i>`;
  }

  /* ---------- 页面 ---------- */
  const env = { doc: null, storage: null, box: null, on: false, toolsOpen: false, swapOpen: null, drawerOpen: false, queued: false, last: {}, theme: null, themeKey: "",
    watch: null, watched: [], sizer: null, dressQueued: false, added: null, tab: null, rcHead: null, blocker: null, coverKey: "null" };
  /** 单机画面自己的元素（g- 开头：game.html 的垫片找不到时老实返回 null） */
  const $ = (id) => (env.doc ? env.doc.getElementById(id) : null);
  /** 别的模块的元素（热座栏 #hs-…）：用 querySelector——game.html 的垫片会给找不到的 id 现造一个替身，getElementById 会把替身塞进页面 */
  const q = (sel) => (env.doc ? env.doc.querySelector(sel) : null);
  const app = () => $("g-app");
  const topBar = () => { const a = app(); return a ? a.querySelector(":scope > .g-top") : null; };
  function storageOf() { try { return root.localStorage || null; } catch (e) { return null; } }
  /** 内容变了才写（键盘焦点、悬停不被打断） */
  function html(node, markup, key) {
    if (!node || env.last[key] === markup) return false;
    env.last[key] = markup;
    node.innerHTML = markup;
    return true;
  }

  /** 页面里读这一刻的情况：画面、新画面、模式（只读 body 的类、几个全局开关；不碰规则的 state 以外的东西） */
  function readMode() {
    const b = env.doc.body, OG = root.OnlineGame, ogv = (() => { try { return OG && OG.getView ? OG.getView() : null; } catch (e) { return null; } })();
    const host = !!(b.classList.contains("ol-host-online") && ogv && ogv.active && ogv.isHost);
    const hs = root.HotseatGame && typeof root.HotseatGame.isActive === "function" && root.HotseatGame.isActive();
    const st = typeof state !== "undefined" ? state : null;   // app.js 的全局：只看是不是单人模式
    return {
      host, hostRogue: host && ogv.mode === "rogue", room: host ? ogv.roomCode || "" : "", reconnecting: host && !!(ogv.status && ogv.status.connected === false),
      hotseat: !!hs, trpg: b.classList.contains("trpg"), training: !!(root.Training && root.Training.active), rogue: b.classList.contains("rogue-battle"), solo: !!(st && st.solo)
    };
  }
  function isActive() {
    const a = app();
    return active({ screen: env.doc.body.dataset.screen, on3d: !!(a && a.classList.contains("hd2d-on")), onlinePlayer: env.doc.body.classList.contains("online-player") });
  }

  /** 页面加载完：建顶栏那一层、接点击 / 按键、开始看着各处的变化。opts（测试用）：doc / storage 换成假的 */
  function boot(opts) {
    opts = opts || {};
    env.doc = opts.doc || root.document || null;
    env.storage = opts.storage !== undefined ? opts.storage : storageOf();
    if (!env.doc || !env.doc.body) return;
    if (!env.box) {
      const box = env.doc.createElement("div");
      box.id = "g-paper"; box.className = "olp-root"; box.hidden = true;
      box.setAttribute("aria-label", "战斗画面顶栏");
      env.doc.body.appendChild(box);
      box.addEventListener("click", onBoxClick);
      env.box = box;
      env.doc.addEventListener("click", onOutside, true);
      env.doc.addEventListener("keydown", onKey, true);
      const top = topBar();
      if (top) {
        // 下拉里点了一项：在捕获阶段先认出来（处理它的时候可能马上重画），等它处理完再收起；换了下拉框的选项也收起
        top.addEventListener("click", (e) => { if (env.on && env.toolsOpen && e.target && e.target.closest && e.target.closest("button, a")) setTimeout(() => setTools(false), 0); }, true);
        top.addEventListener("change", () => { if (env.on && env.toolsOpen) setTimeout(() => setTools(false), 0); });
      }
      if (root.PauseMenu && typeof root.PauseMenu.addBlocker === "function") env.blocker = root.PauseMenu.addBlocker(() => !!(env.on && (env.toolsOpen || env.swapOpen != null)));
      if (typeof root.addEventListener === "function") root.addEventListener("resize", schedule);
      if (typeof MutationObserver === "function") {
        const mo = new MutationObserver(schedule);
        mo.observe(env.doc.body, { attributes: true, attributeFilter: ["class", "data-screen"] });
        if (app()) mo.observe(app(), { attributes: true, attributeFilter: ["class", "data-weather"] });
      }
    }
    sync();
  }
  /** 有变化：这一刻之后排一次（同一刻来的变化只排一次） */
  function schedule() {
    if (env.queued || !env.doc) return;
    env.queued = true;
    setTimeout(() => { env.queued = false; sync(); }, 0);
  }

  /** 排一次：该不该是纸片画面（换了就进 / 出），是的话把顶栏、吊牌、下拉、抽屉、配色都画一遍 */
  function sync() {
    if (!env.doc || !env.box) return;
    const on = isActive();
    if (on !== env.on) (on ? enter : leave)();
    if (!on) return;
    const b = env.doc.body;
    // 联机那边重新挂界面时会把 .ol-paper 拿掉（online-ui.js · destroy）：单机的纸片画面还开着就加回来
    if (!b.classList.contains(GPAPER.paperClass)) b.classList.add(GPAPER.paperClass);
    paint();
  }
  /** 进纸片画面：body 加类、旧顶栏变成下拉（分组、加小标题）、战斗记录变成抽屉、开始看着各处的变化 */
  function enter() {
    const b = env.doc.body, top = topBar(), log = $("g-log");
    env.on = true;
    env.toolsOpen = false; env.swapOpen = null;
    env.drawerOpen = P.isOpen("drawer", env.storage);
    // styles：动过行内样式（排顺序）的元素和它原来的 style 属性，出纸片画面时原样放回（旧顶栏和进来之前一模一样）
    env.added = { heads: [], ordered: [], hidden: [], groups: [], styles: new Map() };
    const keepStyle = (el) => { if (!env.added.styles.has(el)) env.added.styles.set(el, el.getAttribute("style")); };
    b.classList.add(GPAPER.paperClass, GPAPER.bodyClass);
    env.box.hidden = false;
    if (!env.box.querySelector(".olp-top-host")) { env.box.innerHTML = P.shellHtml({ tools: false }); env.last = {}; }
    if (top) {
      top.id = GPAPER.toolsId; top.setAttribute("role", "group"); top.setAttribute("aria-label", GPAPER.text.tools);
      let n = 0;
      GPAPER.tools.forEach(g => {
        const h = env.doc.createElement("p");
        h.className = "gp-tools-h"; h.textContent = g.head; h.style.order = String(n++);
        top.appendChild(h); env.added.heads.push(h);
        const members = [];
        g.ids.forEach(id => {
          const el = $(id), box = el && el.closest ? el.closest("label") || el : el;
          if (!box || !top.contains(box)) return;
          keepStyle(box); box.style.order = String(n++); env.added.ordered.push(box); members.push(box);
        });
        // 纸片画面另加的（图鉴、规则）：排在这一组最后，离开纸片画面就拿掉
        (GPAPER.extras || []).filter(x => x.group === g.head).forEach(x => {
          const b = env.doc.createElement("button");
          b.type = "button"; b.className = "g-btn gp-extra"; b.id = x.id; b.textContent = x.label; b.title = x.title || "";
          b.style.order = String(n++);
          if (x.career) b.dataset.career = "1";   // 页面上带 data-career 的点一下就打开整局数据（sheet-ui.js 在捕获阶段接）
          else b.addEventListener("click", () => openBestiary(x.mode));
          top.appendChild(b); env.added.heads.push(b); members.push(b);
        });
        env.added.groups.push({ head: h, members });
      });
      // 只是字的那几块（挪到胶带上了）：记在 data-gp-hide 上（game.js 会整个改写 #g-clock 的 className，类名留不住）
      GPAPER.hide.forEach(id => { const el = $(id); if (el && top.contains(el)) { el.dataset.gpHide = "1"; env.added.hidden.push(el); } });
      keepStyle(top); top.style.setProperty("--gp-last", String(n));
    }
    if (log) {
      keepStyle(log);
      const tab = env.doc.createElement("button");
      tab.type = "button"; tab.className = "gp-drawer-tab"; tab.setAttribute("aria-controls", "g-log");
      tab.innerHTML = '<span class="gp-drawer-label"></span><span class="gp-drawer-dot" aria-hidden="true" hidden></span><span class="gp-sr"></span>';
      tab.addEventListener("click", () => setDrawer(!env.drawerOpen));
      log.insertBefore(tab, log.firstChild);
      // 收据顶上那一块：插在「复制本回合 / 复制全部」那一行前面（记录本身 #g-logs 每场重画，不放在里面）
      const head = env.doc.createElement("div");
      head.className = "gp-rc-head";
      log.insertBefore(head, log.querySelector(":scope > .log-tools") || tab.nextSibling);
      log.classList.add("gp-drawer");
      env.tab = tab; env.rcHead = head;
    }
    paintDrawer();
    watch(true);
    // 战场的大小变了（铺满了）：新画面重新量一次
    setTimeout(() => { if (typeof root.dispatchEvent === "function" && typeof Event === "function") root.dispatchEvent(new Event("resize")); }, 0);
  }
  /** 出纸片画面：加过的类、小标题、顺序、id、抽屉的竖标签、配色都拿掉——旧画面和进来之前一模一样 */
  function leave() {
    const b = env.doc.body, top = topBar(), log = $("g-log");
    env.on = false;
    env.toolsOpen = false; env.swapOpen = null;
    b.classList.remove(GPAPER.bodyClass, "gp-drawer-open");
    // .ol-paper：联机玩家的纸片画面开着就是它的（不会同时开着，保险起见看一下）
    if (!(b.classList.contains("online-player") && root.OnlinePaper)) b.classList.remove(GPAPER.paperClass);
    env.box.hidden = true; env.box.innerHTML = ""; env.last = {};
    const A = env.added || { heads: [], ordered: [], hidden: [], styles: new Map() };
    A.heads.forEach(h => h.remove());
    A.hidden.forEach(el => { delete el.dataset.gpHide; });
    if (top) {
      top.removeAttribute("id"); top.removeAttribute("role"); top.removeAttribute("aria-label");
      top.classList.remove("gp-open");
      untex(top);
    }
    // 行内样式原样放回（排顺序、纸纹的变量都是加在 style 上的）：原来没有 style 属性的连属性一起拿掉
    A.styles.forEach((v, el) => { if (v == null) el.removeAttribute("style"); else el.setAttribute("style", v); });
    env.added = null;
    if (env.tab) { env.tab.remove(); env.tab = null; }
    if (env.rcHead) { env.rcHead.remove(); env.rcHead = null; }
    if (log) log.classList.remove("gp-drawer", "gp-collapsed");
    // 技能栏、技能按钮、队伍栏这些贴过纸纹的（game.js 会接着用同一个按钮）：纸纹、撕边的标记、补进去的影子层都拿掉
    // （纹理还没画好的面板没有 data-olp-tex，撕边、影子层已经补上了：按 --olp-clip、.olp-ply 也找一遍）
    const a = app();
    if (a) {
      a.querySelectorAll('[data-olp-tex], [style*="--olp-clip"]').forEach(untex);
      a.querySelectorAll(".olp-ply").forEach(p => { const el = p.parentNode; untex(el); if (p.parentNode) p.parentNode.removeChild(p); });
    }
    watch(false);
    if (env.sizer) env.sizer.disconnect();
    pushCover();   // 新画面不用再让开纸片的面板
    paintTheme(null);
    setTimeout(() => { if (typeof root.dispatchEvent === "function" && typeof Event === "function") root.dispatchEvent(new Event("resize")); }, 0);
  }
  /** 纸纹（paper-ui.js · dress）贴过的拿掉（离开纸片画面时：旧画面的顶栏、记录栏不留纸纹、撕边、影子层；paper-ui.js · undress） */
  function untex(el) {
    if (!el || el.nodeType !== 1) return;
    UI.undress(el);
    if (el.getAttribute("style") === "") el.removeAttribute("style");
  }

  /** 看着会变的几处（顶栏的字、队伍栏、热座栏、镜头按钮、房主的小队聊天标签）：变了就排一次 */
  function watch(on) {
    if (typeof MutationObserver !== "function") return;
    const want = on ? [topBar(), $("g-party"), q("#hs-order"), q("#hs-notice"), app() && app().querySelector(".hd2d-cam"), q("#g-log > .ol-host-tabs")].filter(Boolean) : [];
    if (want.length === env.watched.length && want.every((n, i) => n === env.watched[i])) return;
    if (env.watch) env.watch.disconnect();
    env.watched = want;
    if (!want.length) return;
    if (!env.watch) env.watch = new MutationObserver(schedule);
    want.forEach(n => env.watch.observe(n, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "hidden", "disabled"] }));
  }

  /** 画一遍：配色、顶栏、吊牌、热座栏的提示、抽屉、纸纹 */
  function paint() {
    const top = topBar(), st = typeof state !== "undefined" ? state : null, a = app();
    // 配色：这一场的光影（战场配置里改的、跟着时钟的，state.light）和天气；没有光影按时钟算的夜晚
    paintTheme(UI.themeOf({ light: st && st.light, night: !!(a && a.classList.contains("is-night")), weather: (a && a.dataset.weather) || (st && st.weather) }));
    const mode = readMode();
    html(env.box.querySelector(".olp-top-host"), P.topHtml(topInfo(mode)), "top");
    html(env.rcHead, receiptHead(modeOf(mode)), "rc");
    if (top) {
      top.classList.toggle("gp-open", env.toolsOpen);
      // 一组的按钮这一局都藏着（单局里的「布置 · 主持人」……按模式藏的照旧藏）：小标题也不留
      if (env.toolsOpen && env.added) env.added.groups.forEach(g => { const none = !g.members.some(el => root.getComputedStyle(el).display !== "none"); if (g.head.hidden !== none) g.head.hidden = none; });
    }
    const moves = UI.readMoves(env.doc);
    const moving = [...moves.values()].some(list => list.some(m => m.hs === "moveCancel"));
    html(env.box.querySelector(".olp-tags-host"), P.tagsHtml(slots(mode, moves), { open: env.swapOpen, moving }), "tags");
    UI.revealTag(env.box.querySelector(".olp-tags-host"));   // 触屏上吊牌放不下横着滑（#429）：轮到的 / 点开 ⇅ 的那一张滑进来
    const hn = q("#hs-notice"), note = mode.hotseat && hn && !hn.hidden ? String(hn.textContent || "").trim() : "", noteEl = env.box.querySelector(".olp-note");
    if (noteEl) { noteEl.hidden = !note; if (noteEl.textContent !== note) noteEl.textContent = note; }
    paintDrawer();
    watch(true);
    if (root.PauseMenu && typeof root.PauseMenu.refresh === "function" && env.last.pm !== env.last.top) { env.last.pm = env.last.top; root.PauseMenu.refresh(); }
    dressSoon();
  }
  /** 顶栏那一条要的：旧顶栏上已经写好的字（回合、我方 / 敌人行动、天气、遭遇）+ 时钟 + 镜头按钮 */
  function topInfo(mode) {
    const text = id => { const el = $(id); return el ? String(el.textContent || "").replace(/\s+/g, " ").trim() : ""; };
    const ph = $("g-phasel"), ck = $("g-clock"), a = app();
    let time = "", period = "", day = 0;
    if (ck && !ck.hidden) {
      const b = ck.querySelector("b");
      time = b ? String(b.textContent || "").trim() : "";
      try { period = typeof dayPeriod === "function" && typeof clockNow === "function" ? dayPeriod(clockNow()) : ""; } catch (e) { period = ""; }
      try { day = typeof LEDGER !== "undefined" && LEDGER && Number(LEDGER.day) > 0 ? Number(LEDGER.day) : 0; } catch (e) { day = 0; }
    }
    const weather = text("g-weather").replace(/^天气\s*/, "");
    return {
      title: modeOf(mode), room: mode.room, reconnecting: mode.reconnecting, sub: text("g-enc-name"),
      turnText: text("g-round"), phase: ph ? { text: text("g-phasel"), enemy: ph.classList.contains("enemy") } : null,
      day, time, period, weather, night: !!(a && a.classList.contains("is-night")), cams: UI.readCam(a), toolsOpen: env.toolsOpen
    };
  }
  /** 吊牌：热座 / 联机房主是热座栏的行动顺序；一个人打的时候是我方每个人（队伍栏的顺序、谁选着） */
  function slots(mode, moves) {
    const units = new Map(), faceOf = (u) => {
      const SH = root.HD2DShell, U = root.HD2DUI;
      try { return SH && U ? U.avatarHtml(U.avatarOf(SH.lookOf(u))) : ""; } catch (e) { return ""; }
    };
    const st = typeof state !== "undefined" ? state : null, OV = root.OnlineView;
    const view = (id) => {
      const u = st && (st.units || []).find(x => x && String(x.id) === String(id));
      let p = null;
      try { p = u && OV && OV.projectUnit ? OV.projectUnit(u) : null; } catch (e) { p = null; }
      return p ? { p, name: p.name, face: faceOf(p) } : null;
    };
    if (mode.hotseat) {
      let v = null;
      try { v = root.HotseatGame.getView(); } catch (e) { v = null; }
      if (!v) return [];
      (v.order || []).forEach(s => { if (s && s.actor && !units.has(s.actor)) units.set(s.actor, view(s.actor)); });
      return hotseatSlots(v, units, moves);
    }
    const list = [...env.doc.querySelectorAll("#g-party > .pc[data-id]")].map(b => {
      const x = view(b.dataset.id), p = x ? x.p : {};
      const spent = (Number(p.ap) || 0) + (Number(p.bonus) || 0) === 0 && !p.dying;
      return { id: b.dataset.id, name: x ? x.name : "", face: x ? x.face : "", on: b.classList.contains("on"), down: !!p.dead, stunned: !!p.stunned && !p.dead, spent };
    });
    return soloSlots(list, { acting: !!(st && st.combatStarted && st.combatPhase === "player") || !(st && st.combatStarted) });
  }

  /** 图鉴 / 规则说明（bestiary-ui.js，单局顶栏的「图鉴」「规则」同一个入口）：按场上几名角色算敌人血量，副标题写这一局的模式 */
  function openBestiary(mode) {
    const B = root.Bestiary, st = typeof state !== "undefined" ? state : null, R = GPAPER.bestiaryParty;
    if (!B || typeof B.open !== "function") return;
    const heroes = st ? (st.units || []).filter(u => u && u.isPlayer && !u.weaponOf && !u.escort && !u._removed).length : R.max;
    const o = { partySize: Math.max(R.min, Math.min(R.max, heroes || R.max)), sub: modeOf(readMode()) };
    if (mode) o.mode = mode;
    B.open(o);
  }

  /* ---------- 「工具 ▾」下拉（旧顶栏原地变的）、吊牌的 ⇅、镜头 ---------- */
  function setTools(open) {
    if (!env.on || env.toolsOpen === !!open) return;
    env.toolsOpen = !!open;
    if (open) env.swapOpen = null;
    paint();
  }
  function onBoxClick(e) {
    const t = e.target;
    if (!t || !t.closest || !env.on) return;
    if (t.closest('[data-olp="tools"]')) { setTools(!env.toolsOpen); return; }
    // 镜头：远 / 中 / 近，手机上收成的那一个（#429：点下一段）点的都是新画面原来那几个按钮
    const cam = t.closest("[data-olp-cam], [data-olp-cam-next]");
    if (cam) { UI.pressCam(app(), Number(cam.dataset.olpCam != null ? cam.dataset.olpCam : cam.dataset.olpCamNext)); return; }
    const sw = t.closest("[data-olp-swap]");
    if (sw) { const i = Number(sw.dataset.olpSwap); env.swapOpen = env.swapOpen === i ? null : i; env.toolsOpen = false; paint(); return; }
    const mv = t.closest("[data-olp-move]");
    if (mv) { if (mv.disabled) return; const [i, n] = mv.dataset.olpMove.split(" ").map(Number); env.swapOpen = null; UI.pressMove(env.doc, i, n); paint(); return; }
    // 一个人打的时候：点牌子 = 点队伍栏里同一个人（game.js 自己判断能不能换人）
    const pick = t.closest("[data-olp-pick]");
    if (pick) {
      const b = [...env.doc.querySelectorAll("#g-party > .pc[data-id]")].find(x => x.dataset.id === pick.dataset.olpPick);
      if (b) b.click();
    }
  }
  /** 点到别处：「工具 ▾」下拉、⇅ 点开的按钮收起来（新画面的 3D 战场自己拦了点击，所以在捕获阶段看） */
  function onOutside(e) {
    if (!env.on) return;
    const t = e.target, inside = sel => !!(t && t.closest && t.closest(sel));
    let changed = false;
    if (env.toolsOpen && !inside("#" + GPAPER.toolsId) && !inside('#g-paper [data-olp="tools"]')) { env.toolsOpen = false; changed = true; }
    if (env.swapOpen != null && !inside("#g-paper .olp-tags")) { env.swapOpen = null; changed = true; }
    if (changed) paint();
  }
  /** Esc：先收下拉 / ⇅（这一下不打开暂停页面，pause-menu.js 的 addBlocker 也看着它） */
  function onKey(e) {
    if (!env.on || e.key !== "Escape" || (!env.toolsOpen && env.swapOpen == null)) return;
    e.preventDefault(); e.stopPropagation();
    env.toolsOpen = false; env.swapOpen = null;
    paint();
  }

  /* ---------- 右边的战斗记录抽屉（#g-log）---------- */
  function setDrawer(open) {
    env.drawerOpen = !!open;
    P.setOpen("drawer", env.drawerOpen, env.storage);
    paintDrawer();
    dressSoon();
  }
  /** 抽屉收着 / 拉开；收着时竖标签写「战斗记录」，联机房主有没看的小队消息时挂数字（online-ui.js 画在「小队」标签上的那个数） */
  function paintDrawer() {
    const log = $("g-log"), tab = env.tab, T = GPAPER.text;
    if (!log || !tab) return;
    const collapsed = !env.drawerOpen;
    log.classList.toggle("gp-collapsed", collapsed);
    env.doc.body.classList.toggle("gp-drawer-open", !collapsed);
    const badge = env.doc.querySelector("#g-log > .ol-host-tabs .ol-badge"), n = collapsed && badge && !badge.hidden ? String(badge.textContent || "").trim() : "";
    const label = collapsed ? T.drawer : T.drawerClosed, title = collapsed ? T.drawerOpen : T.drawerClose;
    const lab = tab.querySelector(".gp-drawer-label"), dot = tab.querySelector(".gp-drawer-dot"), sr = tab.querySelector(".gp-sr");
    if (lab.textContent !== label) lab.textContent = label;
    dot.hidden = !n; if (dot.textContent !== n) dot.textContent = n;
    tab.title = title; tab.setAttribute("aria-expanded", String(!collapsed));
    const srText = title + (n ? `（${n} 条新消息）` : "");
    if (sr.textContent !== srText) sr.textContent = srText;
  }

  /* ---------- 白天 / 夜晚 / 天气的配色、纸纹 ---------- */
  /** 配色写成 CSS 变量放在 body 上（和联机玩家同一套变量，online-paper.css 只用变量）；th = null（离开纸片画面）都拿掉 */
  function paintTheme(th) {
    const key = th ? th.time + "|" + th.weather : "";
    env.theme = th;
    if (key === env.themeKey) return;
    const b = env.doc.body, vars = th ? UI.themeVars(th) : {}, phone = UI.phoneVars();
    if (env.themeKey) { Object.keys(UI.themeVars({ time: "day" })).concat(Object.keys(phone)).forEach(k => b.style.removeProperty(k)); b.style.removeProperty("--olp-grit"); }
    env.themeKey = key;
    if (!th) { delete b.dataset.olpTime; delete b.dataset.olpWeather; b.style.removeProperty("--olp-dock-h"); return; }
    b.dataset.olpTime = th.time; b.dataset.olpWeather = th.weather;
    Object.keys(vars).forEach(k => b.style.setProperty(k, vars[k]));
    Object.keys(phone).forEach(k => b.style.setProperty(k, phone[k]));
    const grit = UI.grit(env.doc);
    if (grit) b.style.setProperty("--olp-grit", `url("${grit}")`);
  }
  /** 纸纹：画完下一刻再贴（量得到大小）；面板大小变了（收起 / 展开、窗口变了）由 ResizeObserver 叫 */
  function dressSoon() {
    if (env.dressQueued) return;
    env.dressQueued = true;
    const next = () => { env.dressQueued = false; dress(); };
    if (typeof root.requestAnimationFrame === "function") root.requestAnimationFrame(next); else setTimeout(next, 16);
  }
  function dress() {
    if (!env.on) return;
    P.dress(env.doc, null, env.theme);
    pushCover();
    // 技能栏现在多高（--olp-dock-h）：右边的抽屉、悬停预演让开它（技能多了换行变高也跟着让）；手机上抽屉的竖标签挂在它上面。
    // 选中技能以后先收着的这一段照旧用收起之前的（paper-ui.js · dockHeight 给 null，#362）：挂在它上面的面板不跟着挪，取景也就不变
    const hud = app() && app().querySelector(":scope > .g-hud"), b = env.doc.body, dockH = UI.dockHeight(hud);
    if (dockH != null && b.style.getPropertyValue("--olp-dock-h") !== dockH) { if (dockH) b.style.setProperty("--olp-dock-h", dockH); else b.style.removeProperty("--olp-dock-h"); }
    if (typeof ResizeObserver !== "function") return;
    if (!env.sizer) env.sizer = new ResizeObserver(() => dressSoon());
    [env.box.querySelector(".olp-top"), topBar(), app() && app().querySelector(":scope > .g-hud"), app() && app().querySelector(".hd2d-party"), $("g-log")].forEach(n => { if (n) env.sizer.observe(n); });
  }

  /* ---------- 3D 白卡让开浮在战场上的面板（第 4 步）---------- */
  /** 量一下浮在战场上的面板（GPAPER.cover）交给新画面（hd2d-field.js · cover：换成战场里的坐标、算上下左右让多少，变了才重排）；
   *  出纸片画面时交 null（旧画面、新画面关着都不让）。和上次一样就不交 */
  function pushCover() {
    const F = root.HD2DField;
    if (!F || typeof F.cover !== "function") return;
    const rects = env.on ? P.cover(env.doc) : null, key = JSON.stringify(rects);
    if (key === env.coverKey) return;
    env.coverKey = key;
    F.cover(rects);
  }

  const api = { PAPER: GPAPER, GPAPER, active, modeOf, soloSlots, hotseatSlots, receiptHead, boot, sync, isOn: () => env.on };
  // 页面里：等页面加载完（game.js、hd2d-field.js 先登记在 DOMContentLoaded 上）再接
  if (!(typeof module === "object" && module.exports) && root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", () => boot());
    else boot();
  }
  return api;
});
