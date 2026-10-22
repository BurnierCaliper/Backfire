/* Antlerscale: Backfire · 联机玩家战斗画面的「纸片风」界面（#308，主人 10/22 定稿，设计在 docs/ui-paper/）
 *
 * 只在联机玩家（不是房主 / 主持人）的战斗画面、并且开着新画面（3D 战场建好了）时用；新画面关着时的联机画面、单机 game.html、主持人那边一点不变。
 * online-ui.js 在 body 上加 .ol-paper（PAPER.bodyClass），样子都挂在这个类下面（online-paper.css）：
 *   · 战场铺满整个画面（联机舞台铺满，热座栏让开：它的内容搬到下面的顶栏和吊牌上）
 *   · 顶上一条（.olp-top）：联机跑团 · 房间码 · 第 N 回合 · 时间 · 天气；右边镜头 远 / 中 / 近、「工具 ▾」、「菜单」
 *   · 顶栏下面中间挂行动顺序吊牌（.olp-tags）：当前行动的高亮；自己的角色带 ⇅，点开是「延后 / 换位」——
 *     按钮点的就是热座栏（hotseat-ui.js）里原来那几个按钮（延后、换位、换到这里、取消换位……），同一份操作，这里只是换个样子摆出来
 *   · 左上角队伍（hd2d-shell.js 的队伍栏挪过来）：收起成只剩头像一列；下面角色资料 / 武器 / 背包
 *   · 「工具 ▾」下拉（.olp-tools）：地图、战绩、钱包与商店、任务日志、NPC 资料、申请检定、新画面开关，点完收起；原来舞台顶上那一排按钮不画了
 *   · 右边战斗记录 / 小队聊天（#online-side）：平时收成右边缘一个竖标签，有新消息挂数字
 *   · 底下技能栏（hd2d-shell.js 的 .g-hud）：能收起成一行
 * 各块的收起状态记在本机（localStorage，读写都包 try/catch）。只用联机玩家收到的包（online-view.js 白名单投影过的），不读房主的 state；
 * 坚毅生命（shp / shpMax）这里一个字都不碰。
 *
 *   纯函数（Node 里能 require，tests/online-paper.test.js）：
 *     PAPER                                 配置：类名、本机记住收起的键、文字、……
 *     active(o)                             这一刻是不是纸片画面：o = { active, isHost, screen, on3d }
 *     isOpen(name, storage, dflt) / setOpen(name, open, storage)   各块的收起 / 展开（读写都包 try/catch）
 *     shellHtml()                           骨架：顶栏、「工具 ▾」下拉、吊牌、提示各占一块（分开重画）
 *     topHtml(info)                         顶栏
 *     tagsHtml(slots, o)                    行动顺序吊牌
 *     toolsHtml(items)                      「工具 ▾」下拉里的按钮
 *   页面（online-ui.js 调）：
 *     readMoves(root)                       热座栏里每一格现在的按钮（延后 / 换位 / 换到这里……）
 *     pressMove(root, index, n)             点热座栏里第 index 格的第 n 个按钮（原来那一个）
 *     readCam(root) / pressCam(root, i)     新画面的镜头按钮（远 / 中 / 近）现在哪个亮着 / 点第 i 个 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else root.OnlinePaper = factory(root);
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  /* ---------- 配置 ----------
   *   bodyClass   纸片画面开着时 body 上的类（所有样子都挂在它下面）
   *   screens     哪些画面算战斗画面（战斗、战斗结算：新画面在这两个画面都挂着）
   *   keys        本机记住收起 / 展开的键（存 "open" / "closed"）：drawer 右边的战斗记录 / 小队聊天抽屉。
   *               技能栏、队伍栏用 hd2d-shell.js 的 SHELL.keys（单机新画面、原型页同一个习惯）
   *   defaults    没记过时开不开：抽屉平时收着（主人：「平时藏在右边」）
   *   text        顶栏、吊牌、下拉、抽屉上的字
   *   cam         镜头按钮读屏念的
   *   tilt        吊牌轮流歪的角度（度；主人：纸片都稍微歪一点 ±0.5～3°）*/
  const PAPER = {
    bodyClass: "ol-paper",
    screens: ["battle", "ended"],
    keys: { drawer: "backfire.online.paper.drawer" },
    defaults: { drawer: false },
    text: {
      title: "联机跑团", titleRogue: "联机单局",
      roomTitle: "房间码", reconnecting: "重连中",
      turn: "第 {0} 回合", day: "第 {0} 天", nightPrefix: "夜 · ",
      tools: "工具", toolsArrow: "▾", toolsTitle: "地图、战绩、钱包与商店、任务日志、NPC 资料、申请检定、新画面开关",
      toolsHead: "工具（点了就收起）",
      menu: "菜单", menuKey: "Esc", menuTitle: "菜单（Esc）：消息与成员、大厅、克制表……",
      order: "行动顺序", swap: "⇅", swapTitle: "延后 / 换位", empty: "空位", vacated: "已挪走",
      drawer: "记录 · 聊天", drawerOpen: "展开战斗记录与小队聊天", drawerClose: "收起战斗记录与小队聊天", logTab: "战斗记录",
      party: "我方队伍", you: "你", yourTurn: "轮到你了"
    },
    cam: { label: "镜头：远景 / 中景 / 近景" },
    tilt: [-3, 2, -1.5, 3, -2, 1.5]
  };

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fill = (t, v) => String(t).replace("{0}", v);

  /* ---------- 这一刻是不是纸片画面 ---------- */
  /** o = { active 在房间里, isHost 是房主 / 主持人, screen 画面, on3d 新画面建好了（online-ui.js 的 field3d.on()） }：
   *  联机玩家、战斗 / 战斗结算画面、新画面开着才是；新画面还在加载、打不开（退回旧画面）都不是 */
  function active(o) {
    o = o || {};
    return !!(o.active && !o.isHost && PAPER.screens.includes(o.screen) && o.on3d);
  }

  /* ---------- 收起 / 展开（读写 localStorage 都包 try/catch）---------- */
  /** 本机记着的：name = PAPER.keys 里的一项；没记过、记了认不得的、读不了（隐私模式、被禁用）都按 dflt（没给就按 PAPER.defaults） */
  function isOpen(name, storage, dflt) {
    const d = dflt !== undefined ? !!dflt : !!PAPER.defaults[name];
    try {
      const k = PAPER.keys[name];
      const v = storage && k ? storage.getItem(k) : null;
      if (v === "open") return true;
      if (v === "closed") return false;
    } catch (e) { /* 读不了就按默认 */ }
    return d;
  }
  /** 记住；存不了（隐私模式、存满了）不报错，返回 false */
  function setOpen(name, open, storage) {
    try {
      const k = PAPER.keys[name];
      if (!storage || !k) return false;
      storage.setItem(k, open ? "open" : "closed");
      return true;
    } catch (e) { return false; }
  }

  /* ---------- 骨架：顶栏、「工具 ▾」下拉、吊牌、提示各占一块，分开重画 ----------
   * 下拉里的按钮列表（.olp-tools-list）只在按钮变了时重画：申请检定（check-request-ui.js 补进来的）、新画面开关（hd2d-field.js 挪进来的）
   * 都在这个列表里，开 / 收下拉只换 hidden，不重画它们 */
  function shellHtml() {
    const T = PAPER.text;
    return `<div class="olp-top-host"></div>` +
      `<div class="olp-tools olp-sheet" id="olp-tools" data-paper="kraft" role="group" aria-label="${esc(T.tools)}" hidden><p class="olp-tools-head">${esc(T.toolsHead)}</p><div class="olp-tools-list"></div></div>` +
      `<div class="olp-tags-host"></div><p class="olp-note" role="status" hidden></p>`;
  }

  /* ---------- 顶栏 ---------- */
  /**
   * info = { rogue 联机单局, room 房间码, reconnecting 断线重连中, turnNo 回合, day / time / period 游戏时间（没有 = 不写）,
   *          weather 天气的名字, night 夜晚（天气前面加「夜 · 」）, cams [{ label, on }] 镜头按钮（新画面的那几个，没有 = 不画）,
   *          toolsOpen 「工具」下拉开着没 }
   * 菜单按钮带 data-pause-open（pause-menu.js 接点击、画新消息的红点）
   */
  function topHtml(info) {
    info = info || {};
    const T = PAPER.text;
    const room = info.reconnecting ? T.reconnecting : (info.room || "");
    const time = info.time ? `<span class="olp-meta olp-time">${info.day ? esc(fill(T.day, info.day)) + " · " : ""}<b>${esc(info.time)}</b>${info.period ? " " + esc(info.period) : ""}</span>` : "";
    const weather = info.weather ? `<span class="olp-meta olp-weather">${info.night ? esc(T.nightPrefix) : ""}${esc(info.weather)}</span>` : "";
    const cams = (info.cams || []).length ? `<span class="olp-cam" role="group" aria-label="${esc(PAPER.cam.label)}">${info.cams.map((c, i) =>
      `<button type="button" class="olp-cam-b${c.on ? " on" : ""}" data-olp-cam="${i}" aria-pressed="${c.on ? "true" : "false"}"${c.title ? ` title="${esc(c.title)}"` : ""}>${esc(c.label)}</button>`).join("")}</span>` : "";
    return `<div class="olp-top olp-sheet" data-paper="tapebar">` +
      `<span class="olp-title">${esc(info.rogue ? T.titleRogue : T.title)}</span>` +
      (room ? `<span class="olp-room olp-stamp" title="${esc(T.roomTitle)}">${esc(room)}</span>` : "") +
      `<span class="olp-meta olp-turn">${esc(fill(T.turn, Math.max(1, Math.round(Number(info.turnNo) || 1))))}</span>${time}${weather}` +
      `<span class="olp-right">${cams}` +
      `<button type="button" class="olp-tools-b olp-sheet" data-paper="board" data-olp="tools" aria-expanded="${info.toolsOpen ? "true" : "false"}" aria-controls="olp-tools" title="${esc(T.toolsTitle)}">${esc(T.tools)} ${esc(T.toolsArrow)}</button>` +
      `<button type="button" class="olp-menu-b olp-sheet" data-paper="boardy" data-pause-open="1" title="${esc(T.menuTitle)}">${esc(T.menu)} <kbd>${esc(T.menuKey)}</kbd></button>` +
      `</span></div>`;
  }

  /* ---------- 「工具 ▾」下拉 ---------- */
  /** 下拉里的按钮列表：items = 一个个按钮的 HTML（online-ui.js 用原来那一排按钮同一个画法：同一个 data-online、同一个处理），空的不画 */
  function toolsHtml(items) {
    return (items || []).filter(Boolean).join("");
  }

  /* ---------- 行动顺序吊牌 ---------- */
  /**
   * slots = [{ index, actor, name, owner 操控者的名字, current 正在行动, done 已结束, locked 已用点数（锁定）, vacated 挪走了的空位,
   *            mine 自己的, face 头像的 HTML（hd2d-ui.js · avatarHtml，没有就空着）,
   *            moves [{ label, aria, primary, disabled }] 热座栏这一格现在的按钮（readMoves）}]
   * o = { open 点开了 ⇅ 的那一格（index）, moving 正在换位（热座栏里有「取消换位」）}
   * 自己能动的格子：平时只露 ⇅，点开才摆出「延后 / 换位」；正在换位时每一格的按钮（换到这里 / 取消换位……）都直接摆出来。
   * 按钮带 data-olp-move="格子 第几个"：online-ui.js 收到点击就点热座栏里原来那一个
   */
  function tagsHtml(slots, o) {
    o = o || {};
    const T = PAPER.text, tilt = PAPER.tilt;
    const list = (slots || []).map((s, k) => {
      const moves = s.moves || [];
      const shown = moves.length && (o.moving || o.open === s.index);
      const btns = shown ? `<span class="olp-moves">${moves.map((m, n) =>
        `<button type="button" class="olp-move olp-sheet${m.primary ? " primary" : ""}" data-paper="card" data-olp-move="${esc(s.index)} ${n}"${m.disabled ? " disabled" : ""}${m.aria ? ` aria-label="${esc(m.aria)}"` : ""}${m.title ? ` title="${esc(m.title)}"` : ""}>${esc(m.label)}</button>`).join("")}</span>` : "";
      const sw = moves.length && !o.moving ? `<button type="button" class="olp-swap" data-olp-swap="${esc(s.index)}" aria-expanded="${o.open === s.index ? "true" : "false"}" title="${esc(T.swapTitle)}" aria-label="${esc((s.name || "") + " " + T.swapTitle)}">${esc(T.swap)}</button>` : "";
      const cls = ["olp-tag", s.current ? "on" : "", s.done || s.locked ? "done" : "", s.vacated ? "vacated" : "", s.mine ? "mine" : ""].filter(Boolean).join(" ");
      return `<li class="${cls}" data-olp-slot="${esc(s.index)}" style="--tilt:${tilt[k % tilt.length]}deg">` +
        `<span class="olp-tag-card olp-sheet" data-paper="${s.current ? "tagon" : "tag"}"><span class="olp-hole" aria-hidden="true"></span>${s.face || ""}` +
        `<span class="olp-tag-nm"><b>${esc(s.actor ? s.name || s.actor : T.empty)}</b><small>${esc(s.actor ? s.owner || "" : s.vacated ? T.vacated : "")}</small></span>${sw}</span>${btns}</li>`;
    }).join("");
    return `<ol class="olp-tags" aria-label="${esc(T.order)}">${list}</ol>`;
  }

  /* ---------- 页面：热座栏里原来的按钮、新画面的镜头按钮 ---------- */
  /** 热座栏（#hs-order）里每一格现在的按钮：Map 格子 → [{ hs 哪一种（move / moveStart / moveCancel）, label, aria, title, primary, disabled }] */
  function readMoves(doc) {
    const out = new Map();
    if (!doc || typeof doc.querySelectorAll !== "function") return out;
    doc.querySelectorAll("#hs-order li[data-order-index]").forEach(li => {
      const btns = [...li.querySelectorAll(".hs-moves [data-hs]")];
      if (!btns.length) return;
      out.set(Number(li.dataset.orderIndex), btns.map(b => ({
        hs: b.dataset.hs, label: (b.textContent || "").trim(), aria: b.getAttribute("aria-label") || "", title: b.getAttribute("title") || "",
        primary: b.classList.contains("hs-primary"), disabled: !!b.disabled
      })));
    });
    return out;
  }
  /** 点热座栏里第 index 格的第 n 个按钮（原来那一个：发同样的指令、进同样的换位状态）；找不到 / 灰着返回 false */
  function pressMove(doc, index, n) {
    if (!doc || typeof doc.querySelector !== "function") return false;
    const li = doc.querySelector(`#hs-order li[data-order-index="${Number(index)}"]`);
    const b = li ? li.querySelectorAll(".hs-moves [data-hs]")[Number(n)] : null;
    if (!b || b.disabled) return false;
    b.click();
    return true;
  }
  /** 新画面的镜头按钮（hd2d-field.js 建在 3D 战场里的 .hd2d-cam）：[{ label, on, title }] */
  function readCam(scope) {
    if (!scope || typeof scope.querySelectorAll !== "function") return [];
    return [...scope.querySelectorAll(".hd2d-cam .hd2d-cam-b")].map(b => ({ label: (b.textContent || "").trim(), on: b.classList.contains("on"), title: b.getAttribute("title") || "" }));
  }
  function pressCam(scope, i) {
    const b = scope && typeof scope.querySelectorAll === "function" ? scope.querySelectorAll(".hd2d-cam .hd2d-cam-b")[Number(i)] : null;
    if (!b) return false;
    b.click();
    return true;
  }

  return { PAPER, active, isOpen, setOpen, shellHtml, topHtml, toolsHtml, tagsHtml, readMoves, pressMove, readCam, pressCam };
});
