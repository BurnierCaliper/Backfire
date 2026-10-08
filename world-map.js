/* Antlerscale: Backfire · 角鳞星地图（界面）
 *
 * WorldMap.open(opt) 打开全屏地图：
 *   opt.here      当前位置（地点 id 或游戏里的区域名，没有就不标）
 *   opt.sub       标题后面的一行小字（例：「单局 · 第 2 幕」）
 *   opt.party     队伍里的人名（画在「你在这里」的牌子上）
 *   opt.route     路线：[{ place, label, state: "done" | "now" | "next" }]，按顺序连成虚线（单局的各幕）
 *   opt.herePos   当前位置不在地点上、而是地图上任意一点时的坐标 { x, y }（百分比）；opt.here 是最近的地点
 *   opt.canMove   能不能在地图上改位置（跑团主持人）：可以直接拖动「你在这里」的标记，或在地点卡上点「把队伍移到这里」
 *                 opt.onMove(loc) 改位置时调用：loc = { place } / { place, x, y }（任意位置，place 是最近的地点）/ null（不再标出）
 *                 opt.refresh() 改完以后重新取一份 opt
 * 地图可以拖动、滚轮 / 双指缩放；点地点看简介。数据在 world-data.js。
 * 「测距」：选起点、终点，看路程（km）和徒步 / 各种车要多久。距离按 world-travel.js 的设定表算，不量图（地图有透视）。 */
"use strict";
const WorldMap = (() => {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  const IMG_W = 1672, IMG_H = 941;
  let root = null, opt = {}, sel = null;
  let measure = null;   // 测距：{ from, to }；null = 没在测距
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
            <button class="g-btn small wm-drop" data-wm="drop" title="在地图中间放下队伍标记，之后可以拖到任何地方">放标记</button>
            <button class="g-btn small" data-wm="fit" title="看整张地图">全图</button>
            <button class="g-btn small wm-measure-btn" data-wm="measure" title="算两地之间的路程和用时">测距</button>
          </div>
          <button class="g-btn" data-wm="close">关闭</button>
        </header>
        <div class="wm-body">
          <div class="wm-view">
            <div class="wm-stage">
              <img class="wm-img" alt="角鳞星地图" draggable="false">
              <svg class="wm-route" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
              <svg class="wm-trip" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
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
        else if (a === "home") focusHere(2.2);
        else if (a === "measure") toggleMeasure();
        else if (a === "swap" && measure) { measure = { from: measure.to, to: measure.from }; renderMeasure(); }
        else if (a === "trip-go" && measure && opt.canMove && measure.to) {
          doMove({ place: measure.to });
          measure = { from: measure.to, to: null };
          renderMeasure();
          focusHere(Math.max(view.s, 1.6));
        }
        else if (a === "drop" && opt.canMove) {
          // 放在现在看到的地图正中间
          const b = baseSize();
          const x = Math.max(0, Math.min(100, (b.vw / 2 - view.tx) / (b.w * view.s) * 100));
          const y = Math.max(0, Math.min(100, (b.vh / 2 - view.ty) / (b.h * view.s) * 100));
          dropMark(x, y);
        }
        return;
      }
      const go = e.target.closest("[data-goto]");
      if (go) { focus(go.dataset.goto, Math.max(view.s, 1.8)); select(go.dataset.goto); return; }
      if (e.target.closest("[data-mark]") && !dragMoved) { select(hereId()); return; }
      const pin = e.target.closest("[data-place]");
      if (pin && !dragMoved) {
        if (measure) pickMeasure(pin.dataset.place); else select(pin.dataset.place);
        return;
      }
      const mv = e.target.closest("[data-move]");
      if (mv && opt.canMove) {
        doMove(mv.dataset.move ? { place: mv.dataset.move } : null);
        if (hereId()) focusHere(Math.max(view.s, 1.6));
      }
      if (e.target === root) close();
    });
    root.addEventListener("change", (e) => {
      const s = e.target.closest("[data-trip]");
      if (!s || !measure) return;
      measure[s.dataset.trip] = s.value || null;
      renderMeasure();
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
    focusXY(p.x, p.y, s);
  }
  function focusXY(x, y, s) {
    const b = baseSize();
    view.s = Math.max(MIN_S, Math.min(MAX_S, s || view.s));
    view.tx = b.vw / 2 - (x / 100) * b.w * view.s;
    view.ty = b.vh / 2 - (y / 100) * b.h * view.s;
    apply(true);
  }
  function focusHere(s) { const h = hereXY(); if (h) focusXY(h.x, h.y, s); else focus(null); }
  let dragMoved = false, markDrag = null;
  const SNAP = 48;   // 标记放在离地点多近（地图图片上的像素）就吸到地点上
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
      // 跑团主持人：按住「你在这里」的标记拖动（不拖地图）
      if (opt.canMove && e.target.closest("[data-mark]")) {
        e.preventDefault();
        markDrag = { id: e.pointerId, moved: false };
        v.setPointerCapture && v.setPointerCapture(e.pointerId);
        root.querySelector(".wm-mark").classList.add("dragging");
        return;
      }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { last = { x: e.clientX, y: e.clientY }; dragMoved = false; }
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: view.s };
      }
    });
    v.addEventListener("pointermove", (e) => {
      if (markDrag && e.pointerId === markDrag.id) {
        const r = stage().getBoundingClientRect();   // 带缩放的实际大小
        markDrag.x = Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100));
        markDrag.y = Math.max(0, Math.min(100, (e.clientY - r.top) / r.height * 100));
        markDrag.moved = true;
        const mk = root.querySelector(".wm-mark");
        mk.style.left = markDrag.x + "%"; mk.style.top = markDrag.y + "%";
        const near = worldNearestPlace(markDrag.x, markDrag.y);
        mk.querySelector(".wm-here small.where").textContent = near ? (near.dist <= SNAP ? `放到 ${near.place.name}` : `${near.place.name}附近`) : "";
        return;
      }
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
      if (markDrag && e.pointerId === markDrag.id) {
        const d = markDrag; markDrag = null;
        const mk = root.querySelector(".wm-mark");
        if (mk) mk.classList.remove("dragging");
        if (d.moved) dropMark(d.x, d.y);
        dragMoved = true; setTimeout(() => { dragMoved = false; }, 0);
        return;
      }
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
  /** 「你在这里」画在哪：拖到任意位置的坐标，或者地点本身 */
  function hereXY() {
    const pos = opt.herePos;
    if (pos && isFinite(Number(pos.x)) && isFinite(Number(pos.y))) return { x: Number(pos.x), y: Number(pos.y), free: true };
    const p = worldPlaceOf(opt.here);
    return p ? { x: p.x, y: p.y, free: false } : null;
  }
  /** 改位置：交给外面（跑团写进存档），再按新的位置重画 */
  function doMove(loc) {
    if (!opt.canMove || typeof opt.onMove !== "function") return;
    opt.onMove(loc);
    if (typeof opt.refresh === "function") opt = Object.assign({}, opt, opt.refresh());   // 例如副标题「还没设定位置」
    else { opt.here = loc ? loc.place : null; opt.herePos = loc && loc.x != null ? { x: loc.x, y: loc.y } : null; }
    root.querySelector(".wm-sub").textContent = opt.sub || "";
    root.classList.toggle("no-here", !hereXY());
    renderPins(); select(hereId() || sel);
  }
  /** 标记放下：离地点够近就吸到地点上，否则停在原地（记最近的地点，显示「××附近」） */
  function dropMark(x, y) {
    const near = worldNearestPlace(x, y);
    if (!near) return;
    doMove(near.dist <= SNAP ? { place: near.place.id } : { place: near.place.id, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }
  function routeOf(id) { return (opt.route || []).filter(r => { const p = worldPlaceOf(r.place); return p && p.id === id; }); }
  function renderPins() {
    const here = hereId();
    const box = root.querySelector(".wm-pins");
    const h = hereXY();
    box.innerHTML = WORLD_PLACES.map(p => {
      const rt = routeOf(p.id);
      const isHere = p.id === here;
      const badges = rt.map(r => `<i class="wm-badge ${esc(r.state || "")}">${esc(r.label)}</i>`).join("");
      return `<button class="wm-pin${isHere ? " near-here" : ""}${rt.length ? " on-route" : ""}" data-place="${esc(p.id)}" style="left:${p.x}%;top:${p.y}%" title="${esc(p.name)}" aria-label="${esc(p.name)}${isHere ? "（当前位置）" : ""}">
        <span class="wm-dot"></span>${badges ? `<span class="wm-badges">${badges}</span>` : ""}
      </button>`;
    }).join("") + (h ? `<div class="wm-pin here wm-mark${opt.canMove ? " movable" : ""}" data-mark="1" style="left:${h.x}%;top:${h.y}%"${opt.canMove ? ' title="按住拖动，把队伍移到地图上任何地方"' : ""}>
        <span class="wm-dot"></span>
        <span class="wm-here"><b>你在这里</b>${(opt.party || []).length ? `<small>${esc(opt.party.join("、"))}</small>` : ""}<small class="where">${h.free && here ? esc(worldPlace(here).name + "附近") : ""}</small></span>
      </div>` : "");
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
    if (measure) { renderMeasure(); return; }
    root.querySelectorAll(".wm-pin").forEach(b => b.classList.toggle("sel", b.dataset.place === id));
    const card = root.querySelector(".wm-card");
    const p = worldPlace(id) || worldPlaceOf(opt.here);
    if (!p) {
      card.innerHTML = `<div class="wm-card-empty"><b>角鳞星</b><p>点地图上的地点看简介。${opt.canMove ? "主持人：点上面的「放标记」把队伍标记放到地图上，再拖到任何地方；也可以点一个地点 →「把队伍移到这里」。" : ""}</p></div>` + cardExtras();
      return;
    }
    const here = hereId();
    const rt = routeOf(p.id);
    const tags = [];
    if (p.id === here) tags.push(`<span class="wm-chip here">${hereXY() && hereXY().free ? "队伍在这附近" : "当前位置"}</span>`);
    rt.forEach(r => tags.push(`<span class="wm-chip ${esc(r.state || "")}">${esc(r.label)}${r.state === "done" ? " · 已经过" : r.state === "now" ? " · 进行中" : " · 之后"}</span>`));
    card.innerHTML = cardPlace(p, tags, here) + cardExtras();
  }
  function cardPlace(p, tags, here) {
    return `<div class="wm-card-in">
        <div class="wm-card-kicker">地点</div>
        <h4>${esc(p.name)}</h4>
        ${tags.length ? `<div class="wm-chips">${tags.join("")}</div>` : ""}
        <p>${esc(p.desc || "")}</p>
        ${opt.canMove ? (p.id === here && !(hereXY() && hereXY().free)
          ? `<button class="g-btn small" data-move="">不再标出队伍位置</button>`
          : `<button class="g-btn r-main" data-move="${esc(p.id)}">把队伍移到这里</button>${p.id === here ? ' <button class="g-btn small" data-move="">不再标出</button>' : ""}`) : ""}
        ${opt.canMove ? `<p class="wm-gm-tip">主持人：按住黄色的「你在这里」标记可以拖到地图上任何地方；放在地点旁边会吸上去。</p>` : ""}
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

  /* ---------- 测距 ---------- */
  const canTravel = () => typeof worldTravelPlan === "function";
  /** 测距能用的地点 id（去掉泛指的「沙漠」）；当前位置不在表里时起点空着 */
  function travelIds() { return canTravel() ? travelPlaceIds() : []; }
  function toggleMeasure() {
    if (measure) { measure = null; root.classList.remove("measuring"); renderTrip(); select(sel); return; }
    const h = hereId();
    measure = { from: travelIds().includes(h) ? h : null, to: null };
    root.classList.add("measuring");
    renderMeasure();
  }
  /** 点地点：没有起点就当起点，否则当终点 */
  function pickMeasure(id) {
    if (!travelIds().includes(id)) { renderMeasure(`${worldPlace(id) ? worldPlace(id).name : id}没有固定的距离（「沙漠」是泛指），选别的地点。`); return; }
    if (!measure.from) measure.from = id;
    else if (measure.from !== id) measure.to = id;
    renderMeasure();
  }
  /** 路线上每个点画在地图哪里：聚落边缘画在外城区那里 */
  function nodeXY(id) {
    const p = worldPlace(id === "rim" ? "outer_city" : id);
    return p ? { x: p.x, y: p.y } : null;
  }
  function renderTrip(plan) {
    const svg = root.querySelector(".wm-trip");
    root.querySelectorAll(".wm-pin").forEach(b => b.classList.remove("trip-a", "trip-b"));
    if (!measure) { svg.innerHTML = ""; return; }
    const mark = (id, cls) => { const b = root.querySelector(`.wm-pin[data-place="${id}"]`); if (b) b.classList.add(cls); };
    if (measure.from) mark(measure.from, "trip-a");
    if (measure.to) mark(measure.to, "trip-b");
    if (!plan || !plan.route.ok || !plan.route.legs.length) { svg.innerHTML = ""; return; }
    const ids = [plan.route.from].concat(plan.route.legs.map(l => l.b));
    const pts = ids.map(nodeXY).filter(Boolean)
      .filter((p, i, a) => !i || p.x !== a[i - 1].x || p.y !== a[i - 1].y);
    svg.innerHTML = pts.length > 1
      ? `<polyline points="${pts.map(p => `${p.x},${p.y}`).join(" ")}" vector-effect="non-scaling-stroke"/>` : "";
  }
  function kmText(km) {
    const f = (v) => km[1] >= 20 ? Math.round(v) : v;   // 远路取整（700–900.6 → 700–901）
    return f(km[0]) === f(km[1]) ? `${f(km[0])} km` : `${f(km[0])}–${f(km[1])} km`;
  }
  function renderMeasure(msg) {
    if (!measure) return;
    const card = root.querySelector(".wm-card");
    const ids = travelIds();
    const options = (cur) => `<option value="">— 选地点 —</option>` + ids.map(id => {
      const p = worldPlace(id);
      return `<option value="${esc(id)}"${id === cur ? " selected" : ""}>${esc(travelNodeName(id))}${p && WORLD_PLACES.filter(q => q.name === p.name).length > 1 ? `（${esc(id === "solar_w" ? "西" : id === "solar_c" ? "南" : id === "solar_e" ? "东" : id)}）` : ""}</option>`;
    }).join("");
    const plan = measure.from && measure.to ? worldTravelPlan(measure.from, measure.to) : null;
    renderTrip(plan);
    let body = "";
    if (msg) body += `<p class="wm-trip-msg">${esc(msg)}</p>`;
    if (!plan) body += `<p class="wm-trip-msg">${measure.from ? "点地图上的地点（或在上面选）当终点。" : "先选起点：点地图上的地点，或在上面选。"}</p>`;
    else if (!plan.route.ok) body += `<p class="wm-trip-msg">${esc(plan.route.why)}</p>`;
    else if (!plan.route.legs.length) body += `<p class="wm-trip-msg">起点和终点是同一个地方。</p>`;
    else {
      const r = plan.route;
      const legs = r.legs.map(l => {
        const roads = Object.keys(l.road || {}).map(k => `${WORLD_ROAD_NAME[k] || k}${l.road[k] < 1 ? ` ${Math.round(l.road[k] * 100)}%` : ""}`).join(" + ");
        return `<li${l.tbd || l.tbdRoad ? ' class="tbd"' : ""}><div><b>${esc(travelNodeName(l.a))} → ${esc(travelNodeName(l.b))}</b><span>${esc(kmText(l.km))}</span></div>
          <small>${esc(roads)}${l.note ? " · " + esc(l.note) : ""}${l.tbd ? " · <em>距离暂定</em>" : l.tbdRoad ? " · <em>路况暂定</em>" : ""}</small></li>`;
      }).join("");
      const modes = plan.modes.map(m => `<li class="wm-mode-${esc(m.mode)}${m.tbd ? " tbd" : ""}"><span>${esc(m.name)}</span><b>${esc(m.text)}</b>
          ${m.warn.length ? `<small>⚠ ${esc(m.warn.join("；"))}</small>` : ""}${m.tbd ? `<small><em>速度暂定</em></small>` : ""}</li>`).join("");
      body += `<div class="wm-trip-total"><span>路程</span><b>${esc(kmText(r.km))}</b>${r.tbd ? `<em>含暂定数据</em>` : ""}</div>
        <ol class="wm-trip-legs">${legs}</ol>
        <div class="wm-card-kicker">用时</div>
        <ul class="wm-trip-modes">${modes}</ul>
        <p class="wm-trip-note">城外距离从聚落边缘（外城区外圈）量起。地图有透视，图上的远近不等于实际距离，以这里的数字为准。</p>
        ${opt.canMove && measure.from === hereId() && !(hereXY() && hereXY().free) ? `<button class="g-btn r-main" data-wm="trip-go">队伍到达${esc(travelNodeName(measure.to))}</button><p class="wm-gm-tip">主持人：只移动队伍标记；路上花的时间请在「推进时间」里按上面的用时推进。</p>` : ""}`;
    }
    card.innerHTML = `<div class="wm-card-in wm-trip-card">
        <div class="wm-card-kicker">测距</div>
        <h4>路程与用时</h4>
        <div class="wm-trip-pick">
          <label><i class="a">起</i><select data-trip="from">${options(measure.from)}</select></label>
          <button class="g-btn small" data-wm="swap" title="起点终点对调">⇅</button>
          <label><i class="b">终</i><select data-trip="to">${options(measure.to)}</select></label>
        </div>
        ${body}
      </div>`;
  }

  function open(o) {
    opt = o || {};
    measure = null;
    if (!root) build();
    root.querySelector(".wm-sub").textContent = opt.sub || "";
    root.classList.toggle("can-move", !!opt.canMove);
    root.classList.toggle("no-here", !hereXY());
    root.classList.remove("measuring");
    root.classList.toggle("can-measure", canTravel());
    root.querySelector(".wm-hint").textContent = opt.canMove ? "拖动黄色标记移动队伍 · 拖动空白处查看地图 · 滚轮 / 双指缩放" : "拖动查看 · 滚轮 / 双指缩放 · 点地点看简介";
    renderPins();
    renderTrip();
    root.classList.add("show");
    document.body.classList.add("wm-open");
    const img = root.querySelector(".wm-img");
    // 打开时：有当前位置就放大到那里（至少放大到能铺满视口，竖屏手机上不会上下留一大片空）
    const start = () => {
      view.s = 1; view.tx = 0; view.ty = 0; apply(false);
      const b = baseSize(), cover = Math.max(b.vw / b.w, b.vh / b.h);
      if (hereXY()) focusHere(Math.max(1.6, cover)); else if (cover > 1.05) zoomAt(cover);
      if (opt.measure && canTravel()) { toggleMeasure(); if (opt.measure.to) pickMeasure(opt.measure.to); }
      else select(hereId());
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
