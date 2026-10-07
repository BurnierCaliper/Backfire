/* Antlerscale: Backfire · 角鳞星地图（界面）
 *
 * WorldMap.open(opt) 打开全屏地图：
 *   opt.here      当前位置（地点 id 或游戏里的区域名，没有就不标）
 *   opt.sub       标题后面的一行小字（例：「单局 · 第 2 幕」）
 *   opt.party     队伍里的人名（画在「你在这里」的牌子上）
 *   opt.route     路线：[{ place, label, state: "done" | "now" | "next" }]，按顺序连成虚线（单局的各幕）
 *   opt.canMove   能不能在地图上改位置（跑团主持人）；opt.onMove(id) 改位置时调用；opt.refresh() 改完以后重新取一份 opt
 * 地图可以拖动、滚轮 / 双指缩放；点地点看简介。数据在 world-data.js。 */
"use strict";
const WorldMap = (() => {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  const IMG_W = 1672, IMG_H = 941;
  let root = null, opt = {}, sel = null;
  const view = { s: 1, tx: 0, ty: 0 };
  const MIN_S = 1, MAX_S = 5;

  function build() {
    root = document.createElement("div");
    root.className = "wm";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "角鳞星地图");
    root.innerHTML = `
      <div class="wm-frame">
        <header class="wm-head">
          <span class="wm-tag">角鳞星</span>
          <h3>星球地图</h3>
          <span class="wm-sub"></span>
          <span class="wm-spacer"></span>
          <div class="wm-tools">
            <button class="g-btn small" data-wm="out" title="缩小">−</button>
            <button class="g-btn small" data-wm="in" title="放大">＋</button>
            <button class="g-btn small" data-wm="home" title="回到当前位置">定位</button>
            <button class="g-btn small" data-wm="fit" title="看整张地图">全图</button>
          </div>
          <button class="g-btn" data-wm="close">关闭</button>
        </header>
        <div class="wm-body">
          <div class="wm-view">
            <div class="wm-stage">
              <img class="wm-img" alt="角鳞星地图" draggable="false">
              <svg class="wm-route" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
              <div class="wm-pins"></div>
            </div>
            <div class="wm-vignette"></div>
            <div class="wm-hint">拖动查看 · 滚轮 / 双指缩放 · 点地点看简介</div>
          </div>
          <aside class="wm-card" aria-live="polite"></aside>
        </div>
      </div>`;
    document.body.appendChild(root);
    root.querySelector(".wm-img").src = typeof WORLD_MAP_IMAGE !== "undefined" ? WORLD_MAP_IMAGE : "art/world-map.webp";
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-wm]");
      if (b) {
        const a = b.dataset.wm;
        if (a === "close") close();
        else if (a === "in") zoomAt(view.s * 1.5);
        else if (a === "out") zoomAt(view.s / 1.5);
        else if (a === "fit") { view.s = 1; view.tx = 0; view.ty = 0; apply(true); }
        else if (a === "home") focus(opt.here, 2.2);
        return;
      }
      const go = e.target.closest("[data-goto]");
      if (go) { focus(go.dataset.goto, Math.max(view.s, 1.8)); select(go.dataset.goto); return; }
      const pin = e.target.closest("[data-place]");
      if (pin && !dragMoved) { select(pin.dataset.place); return; }
      const mv = e.target.closest("[data-move]");
      if (mv && opt.canMove && typeof opt.onMove === "function") {
        opt.onMove(mv.dataset.move || null);
        if (typeof opt.refresh === "function") opt = Object.assign({}, opt, opt.refresh());   // 例如副标题「还没设定位置」
        else opt.here = mv.dataset.move || null;
        root.querySelector(".wm-sub").textContent = opt.sub || "";
        renderPins(); select(sel);
        if (hereId()) focus(opt.here, Math.max(view.s, 1.6));
      }
      if (e.target === root) close();
    });
    document.addEventListener("keydown", (e) => { if (root && root.classList.contains("show") && e.key === "Escape") { e.stopPropagation(); close(); } }, true);
    bindPanZoom();
  }

  /* ---------- 拖动 / 缩放 ---------- */
  const vp = () => root.querySelector(".wm-view");
  const stage = () => root.querySelector(".wm-stage");
  /** 地图在视口里铺满宽（或高）时的基础尺寸 */
  function baseSize() {
    // 用布局尺寸（offsetWidth）：打开时边框有个缩放动画，getBoundingClientRect 会量小
    const v = vp(), W = v.offsetWidth, Hh = v.offsetHeight;
    const k = Math.min(W / IMG_W, Hh / IMG_H);   // 整张图放得下（多出来的地方是星空底色）
    return { w: IMG_W * k, h: IMG_H * k, vw: W, vh: Hh };
  }
  function clamp() {
    const b = baseSize();
    view.s = Math.max(MIN_S, Math.min(MAX_S, view.s));
    const w = b.w * view.s, h = b.h * view.s;
    // 比视口小的方向居中，比视口大的方向不让拖出边
    view.tx = w <= b.vw ? (b.vw - w) / 2 : Math.min(0, Math.max(b.vw - w, view.tx));
    view.ty = h <= b.vh ? (b.vh - h) / 2 : Math.min(0, Math.max(b.vh - h, view.ty));
  }
  function apply(animate) {
    if (!root) return;
    const b = baseSize();
    clamp();
    const st = stage();
    st.style.width = b.w + "px";
    st.style.height = b.h + "px";
    st.classList.toggle("anim", !!animate);
    st.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`;
    st.style.setProperty("--inv", String(1 / view.s));
  }
  function zoomAt(s, cx, cy) {
    const b = baseSize();
    if (cx == null) { cx = b.vw / 2; cy = b.vh / 2; }
    const ns = Math.max(MIN_S, Math.min(MAX_S, s));
    // 以 (cx, cy) 为中心缩放：那一点下面的地图位置不动
    view.tx = cx - (cx - view.tx) * ns / view.s;
    view.ty = cy - (cy - view.ty) * ns / view.s;
    view.s = ns;
    apply(true);
  }
  /** 把地点移到视口中间 */
  function focus(id, s) {
    const p = typeof worldPlaceOf === "function" ? worldPlaceOf(id) : null;
    if (!p) { view.s = 1; view.tx = 0; view.ty = 0; apply(true); return; }
    const b = baseSize();
    view.s = Math.max(MIN_S, Math.min(MAX_S, s || view.s));
    view.tx = b.vw / 2 - (p.x / 100) * b.w * view.s;
    view.ty = b.vh / 2 - (p.y / 100) * b.h * view.s;
    apply(true);
  }
  let dragMoved = false;
  function bindPanZoom() {
    const v = vp();
    const pts = new Map();
    let last = null, pinch = null;
    v.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = v.getBoundingClientRect();
      zoomAt(view.s * (e.deltaY < 0 ? 1.18 : 1 / 1.18), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    v.addEventListener("pointerdown", (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { last = { x: e.clientX, y: e.clientY }; dragMoved = false; }
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: view.s };
      }
    });
    v.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size >= 2 && pinch) {
        const [a, b] = [...pts.values()];
        const r = v.getBoundingClientRect();
        zoomAt(pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        dragMoved = true;
        return;
      }
      if (!last) return;
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) { dragMoved = true; v.classList.add("dragging"); }
      if (!dragMoved) return;
      last = { x: e.clientX, y: e.clientY };
      view.tx += dx; view.ty += dy;
      apply(false);
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!pts.size) { last = null; v.classList.remove("dragging"); setTimeout(() => { dragMoved = false; }, 0); }
    };
    v.addEventListener("pointerup", up);
    v.addEventListener("pointercancel", up);
    window.addEventListener("resize", () => { if (root && root.classList.contains("show")) apply(false); });
  }

  /* ---------- 地点、路线、简介 ---------- */
  function hereId() { const p = typeof worldPlaceOf === "function" ? worldPlaceOf(opt.here) : null; return p ? p.id : null; }
  function routeOf(id) { return (opt.route || []).filter(r => { const p = worldPlaceOf(r.place); return p && p.id === id; }); }
  function renderPins() {
    const here = hereId();
    const box = root.querySelector(".wm-pins");
    box.innerHTML = WORLD_PLACES.map(p => {
      const rt = routeOf(p.id);
      const isHere = p.id === here;
      const badges = rt.map(r => `<i class="wm-badge ${esc(r.state || "")}">${esc(r.label)}</i>`).join("");
      return `<button class="wm-pin${isHere ? " here" : ""}${rt.length ? " on-route" : ""}" data-place="${esc(p.id)}" style="left:${p.x}%;top:${p.y}%" title="${esc(p.name)}" aria-label="${esc(p.name)}${isHere ? "（当前位置）" : ""}">
        <span class="wm-dot"></span>${badges ? `<span class="wm-badges">${badges}</span>` : ""}
        ${isHere ? `<span class="wm-here"><b>你在这里</b>${(opt.party || []).length ? `<small>${esc(opt.party.join("、"))}</small>` : ""}</span>` : ""}
      </button>`;
    }).join("");
    // 路线：各幕按顺序连成虚线；走过的实线、没走的虚线
    const pts = (opt.route || []).map(r => worldPlaceOf(r.place)).map((p, i) => p ? { x: p.x, y: p.y, st: opt.route[i].state } : null).filter(Boolean);
    let svg = "";
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const done = b.st === "done" || b.st === "now";
      svg += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${done ? "done" : "next"}" vector-effect="non-scaling-stroke"/>`;
    }
    root.querySelector(".wm-route").innerHTML = svg;
  }
  function select(id) {
    sel = id;
    root.querySelectorAll(".wm-pin").forEach(b => b.classList.toggle("sel", b.dataset.place === id));
    const card = root.querySelector(".wm-card");
    const p = worldPlace(id) || worldPlaceOf(opt.here);
    if (!p) {
      card.innerHTML = `<div class="wm-card-empty"><b>角鳞星</b><p>点地图上的地点看简介。${opt.canMove ? "主持人点一个地点，就能把队伍移过去。" : ""}</p></div>` + cardExtras();
      return;
    }
    const here = hereId();
    const rt = routeOf(p.id);
    const tags = [];
    if (p.id === here) tags.push(`<span class="wm-chip here">当前位置</span>`);
    rt.forEach(r => tags.push(`<span class="wm-chip ${esc(r.state || "")}">${esc(r.label)}${r.state === "done" ? " · 已经过" : r.state === "now" ? " · 进行中" : " · 之后"}</span>`));
    card.innerHTML = cardPlace(p, tags, here) + cardExtras();
  }
  function cardPlace(p, tags, here) {
    return `<div class="wm-card-in">
        <div class="wm-card-kicker">地点</div>
        <h4>${esc(p.name)}</h4>
        ${tags.length ? `<div class="wm-chips">${tags.join("")}</div>` : ""}
        <p>${esc(p.desc || "")}</p>
        ${opt.canMove ? (p.id === here
          ? `<button class="g-btn small" data-move="">不再标出队伍位置</button>`
          : `<button class="g-btn r-main" data-move="${esc(p.id)}">把队伍移到这里</button>`) : ""}
      </div>`;
  }
  /** 地点卡下面：路线（单局各幕）和地点一览，点了跳过去 */
  function cardExtras() {
    const route = (opt.route || []).map(r => {
      const p = worldPlaceOf(r.place);
      return p ? `<li class="${esc(r.state || "")}" data-goto="${esc(p.id)}"><b>${esc(r.label)}</b><span>${esc(p.name)}</span><i>${r.state === "done" ? "已经过" : r.state === "now" ? "进行中" : ""}</i></li>` : "";
    }).join("");
    const seen = new Set();
    const places = WORLD_PLACES.filter(p => { if (seen.has(p.name)) return false; seen.add(p.name); return true; })
      .map(p => `<li data-goto="${esc(p.id)}" class="${p.id === hereId() ? "here" : ""}${p.id === sel ? " sel" : ""}">${esc(p.name)}</li>`).join("");
    return (route ? `<div class="wm-sec"><div class="wm-card-kicker">路线</div><ol class="wm-route-list">${route}</ol></div>` : "") +
      `<div class="wm-sec"><div class="wm-card-kicker">地点一览</div><ul class="wm-index">${places}</ul></div>`;
  }

  function open(o) {
    opt = o || {};
    if (!root) build();
    root.querySelector(".wm-sub").textContent = opt.sub || "";
    root.classList.toggle("can-move", !!opt.canMove);
    renderPins();
    root.classList.add("show");
    document.body.classList.add("wm-open");
    const img = root.querySelector(".wm-img");
    // 打开时：有当前位置就放大到那里（至少放大到能铺满视口，竖屏手机上不会上下留一大片空）
    const start = () => {
      view.s = 1; view.tx = 0; view.ty = 0; apply(false);
      const b = baseSize(), cover = Math.max(b.vw / b.w, b.vh / b.h);
      if (hereId()) focus(opt.here, Math.max(1.6, cover)); else if (cover > 1.05) zoomAt(cover);
      select(hereId());
    };
    if (img.complete) requestAnimationFrame(start); else img.onload = start;
    root.querySelector('[data-wm="close"]').focus({ preventScroll: true });
  }
  function close() {
    if (!root) return;
    root.classList.remove("show");
    document.body.classList.remove("wm-open");
  }
  return { open, close, isOpen: () => !!(root && root.classList.contains("show")) };
})();
if (typeof window !== "undefined") window.WorldMap = WorldMap;
