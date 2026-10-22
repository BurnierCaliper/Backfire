/* 暂停页面（#298）：按 Esc 或点屏幕角上的「菜单」按钮打开，盖住全屏；再按 Esc、点「继续」或点空白处关掉。
 *   · Esc 先做它原来的事：取消选中的技能 / 选择、跳过演出、关掉最上层的面板（game.js · bindInput、online-ui.js 的弹框……）。
 *     按下时有开着的面板（PAUSE_MENU.layers），或者别的处理拿这一下取消了东西（preventDefault），就不打开；
 *     打字的时候（输入框、聊天框里）也不打开。
 *   · 菜单里的每一项由对应的模块自己登记（PauseMenu.register）：克制表（matchup-ui.js；联机玩家在 online-ui.js）、
 *     主持人工具（online-gm-ui.js）、消息与成员 / 大厅 / 角色分配（online-ui.js）、教程（#263 合进来后接上，见 PAUSE_MENU.tutorial）。
 *     点一项 = 关掉暂停页面 + 打开对应的面板，和以前点原来的按钮一样。
 *   · 联机不会真的暂停：只盖住自己的画面，房间、计时照旧走（标题写「菜单」，下面一行小字说明）。
 * 只开关画面上的面板，不碰任何规则和联机数据。 */
(function (root) {
  "use strict";
  const PAUSE_MENU = {
    text: {
      title: "暂停",                // 单机
      titleOnline: "菜单",          // 联机：不会真的暂停
      noteOnline: "联机不会暂停：房间和计时照旧在走，这里只盖住你自己的画面。",
      resume: "继续",
      resumeKey: "Esc",
      open: "菜单",                 // 角上的按钮
      openTitle: "菜单（Esc）：克制表等都在这里",
      empty: "这里暂时没有别的选项。",
      newCount: n => `（${n} 条新消息）`,
      attention: "（有事要处理）"
    },
    // 每一项的名字和说明；label / hint 也可以由登记的模块给函数（随状态变）
    items: {
      tutorial: { label: "教程", hint: "上手教程和规则说明" },
      matchup: { label: "克制表", hint: "属性 × 血量层的克制关系，随时能看，不打断回合" },
      gmTools: { label: "主持人工具", hint: "敌人、单位、配置物、地形、天气、安排攻击（仅主持人）" },
      assign: { label: "角色分配", hint: "把角色分给房间里的玩家" },
      room: { label: "消息与成员", hint: "房间码、成员、私信、重新连接 / 离开" },
      lobby: { label: "大厅", hint: "房间大厅：成员和大厅交流" }
    },
    // 先后（小的在前）；没写的排在最后
    order: { tutorial: 10, matchup: 20, gmTools: 30, assign: 40, room: 50, lobby: 60 },
    // 教程（#263）：教程页挂出 window.Tutorial.open() 后这一项才出现。#263 的入口名不一样就改这一行
    tutorial: { global: "Tutorial", method: "open" },
    // Esc / 菜单按钮在这些画面里有效（<body data-screen>）；联机时（主持人、玩家）在哪个画面都有效
    screens: ["battle", "run", "trpg"],
    // 角上的「菜单」按钮插在这些顶栏的最前面（单机：战斗、单局、跑团探索；联机玩家的在 online-ui.js 的 #online-dock）
    mounts: ["#g-app > .g-top", "#scr-run > .run-top", "#scr-trpg > .tr-top"],
    // 按 Esc 时这些东西开着：这一下是用来关它们的，不打开暂停页面（看得见才算开着）
    layers: [".sheet.show", ".choice.show", ".ovl:not([hidden])", ".ol-overlay:not([hidden])", "#ogm-panel", ".wm.show", ".bx.show",
      "#g-levelup", "[role=dialog]:not([hidden])", "[role=alertdialog]:not([hidden])"],
    // 打字的地方：Esc 留给输入框（输入法、清空……）
    typing: "input, textarea, select, [contenteditable]:not([contenteditable=false])"
  };

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hasDoc = () => typeof document !== "undefined" && !!document.body;
  const items = new Map();
  let box = null, online = null, lastFocus = null;

  /* ---------- 菜单项 ---------- */
  /** 登记一项：{ id, run(), visible?(), label?, hint?, badge?() }；label / hint 没给就用 PAUSE_MENU.items[id]。同一个 id 再登记会换掉旧的。返回撤销函数 */
  function register(item) {
    if (!item || !item.id || typeof item.run !== "function") throw new TypeError("PauseMenu.register 需要 id 和 run()");
    items.set(item.id, item);
    refresh();
    return () => { if (items.get(item.id) === item) unregister(item.id); };
  }
  function unregister(id) { items.delete(id); refresh(); }
  const val = (v, fallback) => { try { const x = typeof v === "function" ? v() : v; return x == null ? fallback : x; } catch (e) { return fallback; } };
  const orderOf = id => (Object.prototype.hasOwnProperty.call(PAUSE_MENU.order, id) ? PAUSE_MENU.order[id] : 1000);
  /** 现在该显示的项（按先后排好）：[{ id, label, hint, badge }] */
  function list() {
    return [...items.values()]
      .filter(it => val(it.visible, true))
      .map(it => {
        const cfg = PAUSE_MENU.items[it.id] || {};
        return { id: it.id, label: String(val(it.label, cfg.label || it.id)), hint: String(val(it.hint, cfg.hint || "")), badge: val(it.badge, 0) || 0 };
      })
      .sort((a, b) => orderOf(a.id) - orderOf(b.id));
  }
  /** 角上按钮的提示：数字加起来；有不是数字的（比如「!」= 有事要处理）就显示它 */
  function badgeOf(rows) {
    let n = 0, flag = "";
    rows.forEach(r => { if (typeof r.badge === "number") n += r.badge > 0 ? r.badge : 0; else if (r.badge) flag = String(r.badge); });
    return n > 0 ? n : flag;
  }
  const dotText = b => (typeof b === "number" ? (b > 9 ? "9+" : String(b)) : String(b));
  const srText = b => (typeof b === "number" ? PAUSE_MENU.text.newCount(b) : PAUSE_MENU.text.attention);
  const dotHtml = b => (b ? `<span class="pm-dot" aria-hidden="true">${esc(dotText(b))}</span><span class="pm-sr">${esc(srText(b))}</span>` : "");

  /* ---------- 教程（#263） ---------- */
  function tutorialOpen() {
    const t = PAUSE_MENU.tutorial, o = root[t.global];
    return o && typeof o[t.method] === "function" ? () => o[t.method]() : null;
  }
  register({ id: "tutorial", visible: () => !!tutorialOpen(), run: () => { const f = tutorialOpen(); if (f) f(); } });

  /* ---------- 在哪能开 ---------- */
  /** 联机时由 online-ui.js 告诉这里：null = 不在房间里；{ host } = 主持人 / 玩家 */
  function setOnline(ctx) {
    online = ctx ? { host: !!ctx.host } : null;
    if (hasDoc()) { document.body.classList.toggle("pm-online", !!online); document.body.classList.toggle("pm-online-host", !!(online && online.host)); }
    if (isOpen()) paint();
    refresh();
  }
  function allowed() {
    if (!hasDoc()) return false;
    return !!online || PAUSE_MENU.screens.includes(document.body.dataset.screen);
  }
  const typing = t => !!(t && t.closest && t.closest(PAUSE_MENU.typing));
  /** 有没有开着的面板 / 弹框（暂停页面自己不算） */
  function layerOpen() {
    if (!hasDoc()) return false;
    return PAUSE_MENU.layers.some(sel => {
      let nodes;
      try { nodes = document.querySelectorAll(sel); } catch (e) { return false; }
      return [...nodes].some(el => !(box && (el === box || box.contains(el))) && el.getClientRects().length > 0);
    });
  }

  /* ---------- 画面 ---------- */
  function ensureBox() {
    if (box || !hasDoc()) return box;
    box = document.createElement("div");
    box.id = "pm-overlay"; box.className = "pm-overlay"; box.hidden = true;
    box.addEventListener("click", e => {
      if (e.target === box || (e.target.closest && e.target.closest("[data-pause-resume]"))) { close(); return; }
      const b = e.target.closest && e.target.closest("[data-pause-item]");
      if (b) choose(b.dataset.pauseItem);
    });
    document.body.appendChild(box);
    return box;
  }
  function paint() {
    if (!ensureBox()) return;
    const rows = list(), T = PAUSE_MENU.text;
    const focusId = document.activeElement && box.contains(document.activeElement) ? document.activeElement.dataset.pauseItem || "" : "";
    box.innerHTML = `<section class="pm-card" role="dialog" aria-modal="true" aria-labelledby="pm-title">
      <header class="pm-head"><h2 id="pm-title">${esc(online ? T.titleOnline : T.title)}</h2>${online ? `<p class="pm-note">${esc(T.noteOnline)}</p>` : ""}</header>
      <div class="pm-list">${rows.map(r => `<button type="button" class="pm-item" data-pause-item="${esc(r.id)}"><b>${esc(r.label)}</b>${r.hint ? `<small>${esc(r.hint)}</small>` : ""}${dotHtml(r.badge)}</button>`).join("") || `<p class="pm-empty">${esc(T.empty)}</p>`}</div>
      <footer class="pm-foot"><button type="button" class="pm-resume" data-pause-resume>${esc(T.resume)}<kbd>${esc(T.resumeKey)}</kbd></button></footer>
    </section>`;
    if (focusId) { const again = box.querySelector(`[data-pause-item="${focusId}"]`); if (again) again.focus({ preventScroll: true }); }
  }
  /** 角上的「菜单」按钮：单机顶栏里各插一个；提示（红点 / 数字）画在所有 [data-pause-open] 上（联机玩家的那个在 #online-dock） */
  function mountButtons() {
    if (!hasDoc()) return;
    PAUSE_MENU.mounts.forEach(sel => {
      const bar = document.querySelector(sel);
      if (!bar || bar.querySelector("[data-pause-open]")) return;
      const b = document.createElement("button");
      b.type = "button"; b.className = "g-btn pm-open"; b.dataset.pauseOpen = "1";
      b.title = PAUSE_MENU.text.openTitle; b.textContent = PAUSE_MENU.text.open;
      bar.insertBefore(b, bar.firstChild);
    });
  }
  function paintButtons() {
    if (!hasDoc()) return;
    const b = badgeOf(list()), html = dotHtml(b);
    document.querySelectorAll("[data-pause-open]").forEach(btn => {
      let slot = btn.querySelector(".pm-badge");
      if (!slot) { slot = document.createElement("span"); slot.className = "pm-badge"; btn.appendChild(slot); }
      if (slot.innerHTML !== html) {
        const fresh = !slot.innerHTML && !!html;
        slot.innerHTML = html;
        if (fresh) slot.classList.add("pm-pop");
      }
      if (!html) slot.classList.remove("pm-pop");
    });
  }
  /** 状态变了（联机来了新消息、换了身份、换了画面……）：重画角上按钮的提示，开着的菜单也重画 */
  function refresh() {
    if (!hasDoc()) return;
    paintButtons();
    if (isOpen()) paint();
  }

  /* ---------- 开 / 关 ---------- */
  function isOpen() { return !!(box && !box.hidden); }
  function open() {
    if (!hasDoc() || isOpen()) return false;
    if (!allowed()) return false;
    if (root.UnitTip && typeof root.UnitTip.hide === "function") root.UnitTip.hide();
    lastFocus = document.activeElement;
    ensureBox(); paint(); box.hidden = false;
    document.body.classList.add("pm-open");
    const first = box.querySelector("[data-pause-item], [data-pause-resume]");
    if (first) first.focus({ preventScroll: true });
    return true;
  }
  /** keepFocus：点了一项，焦点交给新打开的面板，不还给原来的元素 */
  function close(keepFocus) {
    if (!isOpen()) return false;
    box.hidden = true;
    document.body.classList.remove("pm-open");
    const back = lastFocus; lastFocus = null;
    if (!keepFocus && back && back.isConnected && typeof back.focus === "function" && back !== document.body) { try { back.focus({ preventScroll: true }); } catch (e) { /* 拿不回焦点就算了 */ } }
    return true;
  }
  function toggle() { return isOpen() ? close() : open(); }
  /** 点了一项：先关掉暂停页面，再打开对应的面板 */
  function choose(id) {
    const it = items.get(id);
    if (!it || !val(it.visible, true)) return false;
    close(true);
    if (hasDoc() && document.activeElement && box && box.contains(document.activeElement)) document.activeElement.blur();
    it.run();
    return true;
  }

  /* ---------- 按键 ---------- */
  // 捕获阶段最先看到按键：联机舞台、聊天栏、主持人工具会拦掉冒泡的按键
  function onKey(e) {
    if (isOpen()) {
      // 菜单开着：后面的战斗快捷键（空格结束回合、数字选技能、Tab 换人……）一律不响应
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key === "Tab") trapTab(e);
      else if (!box.contains(e.target)) e.preventDefault();
      return;
    }
    if (e.key !== "Escape" || e.isComposing || e.keyCode === 229 || e.repeat) return;
    if (!allowed() || typing(e.target) || layerOpen()) return;
    // 等这一下传完：别的处理拿它取消了东西（取消技能、跳过演出……都会 preventDefault）就不开
    setTimeout(() => { if (!e.defaultPrevented && !isOpen() && allowed() && !layerOpen()) open(); }, 0);
  }
  function trapTab(e) {
    const f = [...box.querySelectorAll("button:not([disabled])")];
    if (!f.length) { e.preventDefault(); return; }
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i < 0 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
  }
  function onClick(e) {
    const b = e.target && e.target.closest ? e.target.closest("[data-pause-open]") : null;
    if (!b || b.disabled) return;
    e.preventDefault();
    toggle();
  }
  function boot() {
    mountButtons();
    paintButtons();
  }
  if (typeof document !== "undefined") {
    if (typeof addEventListener === "function") addEventListener("keydown", onKey, true);
    document.addEventListener("click", onClick);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  }

  root.PauseMenu = { CONFIG: PAUSE_MENU, register, unregister, list, badgeOf, open, close, toggle, isOpen, refresh, setOnline, allowed, layerOpen, choose, mountButtons };
})(typeof window !== "undefined" ? window : globalThis);
