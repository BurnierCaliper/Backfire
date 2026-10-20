/* 诊所 · 义体（cyberware.js）浮层：外框和工坊 / 背包同一套（workshop.css · .ovl / .ovl-card / .ws-head），这里只放内容。
 * 数据只走一个适配层：CyberwareUI.localModel(...)（单机 / 房主，Rogue.cyberwarePacketFor = cyberwarePacket）
 *   和 CyberwareUI.viewModel(view, ...)（联机玩家，online-view.js · projectCyberware 之后的 view.cyberware）
 *   都变成同一个界面模型：{ heroes:[{kit,name}], kit, packet:{kit,view,shop}, money, net, preview?(id), error, note }
 * 红线：坚毅（shp）数值永远不出现；只显示 burdenText / warning。
 * 按钮发出的指令：{ action:"installCyberware"|"removeCyberware", kit, id }，交给打开浮层的一方的 act()。 */
(function (root) {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = v => (typeof v === "number" && isFinite(v) ? v : 0);
  const pc = v => `${Math.round(num(v) * 10) / 10}%`;
  const cmdAttr = cmd => `data-cw-cmd="${esc(JSON.stringify(cmd))}"`;
  const ELEMENT = { fire: "火", acid: "酸", electric: "电", ice: "冰", energy: "能量", physical: "物理", harmonic: "谐振" };
  const RANGE = { melee: "近战", ranged: "远程" };
  const KIND = { attack: "攻击义体" };
  const HEAVY = "这会给身体带来极大负担。";

  const ui = { kit: "", confirm: "" };
  function resetUi() { ui.kit = ""; ui.confirm = ""; }

  /* ---------- 适配层 ---------- */
  /** 单机 / 房主：packetOf(kit) 返回 cyberwarePacket；previewOf(kit,id) 返回 cyberwareInstallPreview（可省） */
  function localModel(o) {
    o = o || {};
    const heroes = o.heroes || [];
    const kit = heroes.some(h => h.kit === ui.kit) ? ui.kit : (heroes[0] || {}).kit || "";
    return { heroes, kit, packet: kit && o.packetOf ? o.packetOf(kit) : null, money: num(o.money ? o.money(kit) : 0),
      net: false, preview: o.previewOf ? id => o.previewOf(kit, id) : null, error: o.error || "", note: o.note || "" };
  }
  /** 联机玩家：读 online-view 投影后的 view.cyberware（单个 packet 或 { [kit]: packet } 都接） */
  function viewModel(view, o) {
    o = o || {};
    const cw = view && view.cyberware;
    // Burnier 5edbb78：{ heroes:[{kit,name,view,shop}] }；也认单个 packet 或 { [kit]: packet }
    const packets = !cw ? [] : Array.isArray(cw.heroes) ? cw.heroes.filter(p => p && p.view) : cw.view ? [cw] : Object.keys(cw).map(k => cw[k]).filter(p => p && p.view);
    const heroes = packets.map(p => ({ kit: p.kit, name: p.name || (o.nameOf && o.nameOf(p.kit)) || p.kit }));
    const kit = heroes.some(h => h.kit === ui.kit) ? ui.kit : (heroes[0] || {}).kit || "";
    return { heroes, kit, packet: packets.find(p => p.kit === kit) || null, money: num(o.money ? o.money(kit) : 0),
      net: true, preview: null, error: o.error || "", note: o.note || "" };
  }
  /** 确认步骤用的预览：有真预览（cyberwareInstallPreview）就用，没有就从目录行 + 当前视图拼一份同形状的 */
  function previewFor(model, id) {
    const p = model.preview ? model.preview(id) : null;
    if (p) return p;
    const v = (model.packet && model.packet.view) || {}, r = ((model.packet && model.packet.shop) || []).find(x => x.id === id);
    if (!r) return { ok: false, error: "没有这件义体" };
    const over = num(r.rateAfter) > num(v.cap) + 1e-9;
    return { ok: !!r.canInstall, error: r.error || null, cost: num(r.price), name: r.name, tier: r.tier, rateBefore: num(v.rate), rateAfter: num(r.rateAfter),
      cap: num(v.cap), overinstall: over, conflictWith: null, burden: over ? "heavy" : r.warning ? "strain" : "none", warning: r.warning || "" };
  }

  /* ---------- 渲染（纯函数） ---------- */
  function rateBar(v) {
    const cap = Math.max(1, num(v.cap)), scale = Math.max(100, num(v.rate), cap);
    const w = x => `${Math.max(0, Math.min(100, num(x) / scale * 100))}%`;
    const over = num(v.rate) > cap + 1e-9;
    return `<section class="cw-rate${over ? " over" : ""}" aria-label="改造率">
      <div class="cw-rate-top"><b>改造率</b><span class="cw-rate-num"><b>${pc(v.rate)}</b> / ${pc(v.cap)}</span>
        <span class="cw-legend"><i class="cw-sw cw"></i>义体 ${pc(v.cyberwareRate)} <i class="cw-sw ly"></i>血量层改造 ${pc(v.layerRate)}</span></div>
      <div class="cw-track" role="img" aria-label="改造率 ${pc(v.rate)}，上限 ${pc(v.cap)}">
        <span class="cw-seg ly" style="width:${w(v.layerRate)}"></span><span class="cw-seg cw" style="width:${w(v.cyberwareRate)}"></span>
        <span class="cw-cap" style="left:${w(cap)}" title="上限 ${pc(cap)}"></span></div>
      <p class="cw-burden b-${esc(v.burden || "none")}">${esc(v.burdenText || "")}${over ? "" : ` · 还能换掉约 ${esc(num(v.remainingHp))} 点生命`}</p>
    </section>`;
  }
  const meta = r => [`${num(r.tier)} 级`, KIND[r.kind] || r.kind, RANGE[r.range] || r.range, ELEMENT[r.element] || r.element,
    r.damageText ? `伤害 ${r.damageText}` : "", r.break ? `${r.break} 击破` : "", r.hpCut ? `生命上限 −${r.hpCut}` : ""].filter(Boolean).map(esc).join(" · ");
  function installedHtml(model) {
    const list = model.packet.view.installed || [];
    return `<section class="ws-group cw-installed"><h3>已安装 <small>${list.length}</small></h3>
      <ul class="ws-list">${list.map(r => `<li class="cw-row on"><div class="cw-txt"><b>${esc(r.name)}</b><small>${meta(r)} · 短休前还能用 ${esc(num(r.usesLeft))} 次</small></div>
        <button type="button" class="g-btn" ${cmdAttr({ action: "removeCyberware", kit: model.kit, id: r.id })} ${model.money < num(r.removeCost) ? "disabled title=\"奎支不够\"" : ""}>拆除<small>${esc(num(r.removeCost))} 奎支</small></button></li>`).join("")
        || `<li class="ws-empty">还没有安装义体。</li>`}</ul></section>`;
  }
  function shopHtml(model) {
    const shop = model.packet.shop || [];
    const rows = shop.filter(r => !r.installed);
    const conflictText = r => r.conflict ? `<small class="cw-conf">冲突标签「${esc(r.conflict)}」：同标签的义体不能同时安装</small>` : "";
    const why = r => !r.canInstall ? (r.error || "现在不能安装") : model.money < num(r.price) ? "奎支不够" : "";
    return `<section class="ws-group cw-shop"><h3>可安装 <small>${rows.length}</small></h3>
      <ul class="ws-list">${rows.map(r => {
        const no = why(r), heavy = r.warning === HEAVY;
        return `<li class="cw-row${no ? " miss" : " ok"}${ui.confirm === r.id ? " sel" : ""}"><div class="cw-txt"><b>${esc(r.name)}</b>
          <small>${meta(r)}</small>${r.text ? `<span class="cw-desc">${esc(r.text)}</span>` : ""}
          <small>安装后改造率 <b class="cw-after${heavy ? " over" : ""}">${pc(r.rateAfter)}</b> / ${pc(model.packet.view.cap)}${r.warning && !no ? ` · <span class="${heavy ? "cw-heavy-tag" : ""}">${esc(r.warning)}</span>` : ""}</small>
          ${conflictText(r)}${no ? `<small class="ws-need">${esc(no)}</small>` : ""}</div>
          <span class="s-price">${esc(num(r.price))}</span>
          <button type="button" class="g-btn r-main" data-cw-pick="${esc(r.id)}" ${no ? "disabled" : ""} ${no ? `title="${esc(no)}"` : ""}>安装</button></li>`;
      }).join("") || `<li class="ws-empty cw-none">${shop.length ? "目录里的义体都装上了。" : "暂无可安装的义体"}</li>`}</ul></section>`;
  }
  function confirmHtml(model) {
    if (!ui.confirm) return "";
    const p = previewFor(model, ui.confirm);
    const heavy = p.overinstall || p.burden === "heavy";
    const blocked = !p.ok || model.money < num(p.cost);
    return `<div class="cw-confirm${heavy ? " heavy" : ""}" role="alertdialog" aria-label="确认安装">
      <h3>确认安装：${esc(p.name || ui.confirm)}</h3>
      ${heavy ? `<p class="cw-heavy" role="alert">⚠ ${esc(p.warning || HEAVY)}</p>` : p.warning ? `<p class="cw-strain">${esc(p.warning)}</p>` : ""}
      <ul class="cw-pv"><li>费用 <b>${esc(num(p.cost))}</b> 奎支（手里 ${esc(model.money)}）</li>
        <li>改造率 <b>${pc(p.rateBefore)}</b> → <b class="${heavy ? "cw-after over" : "cw-after"}">${pc(p.rateAfter)}</b> / 上限 ${pc(p.cap)}${heavy ? "（超出上限：过度安装）" : ""}</li>
        ${p.conflictWith ? `<li class="ws-need">和已安装的义体冲突</li>` : ""}</ul>
      ${!p.ok ? `<p class="ws-need big">${esc(p.error || "不能安装")}</p>` : model.money < num(p.cost) ? `<p class="ws-need big">奎支不够</p>` : ""}
      <div class="cw-actions"><button type="button" class="g-btn" data-cw-cancel>取消</button>
        <button type="button" class="g-btn r-main${heavy ? " cw-danger" : ""}" ${cmdAttr({ action: "installCyberware", kit: model.kit, id: ui.confirm })} ${blocked ? "disabled" : ""}>${heavy ? "仍然安装" : "确认安装"}</button></div>
    </div>`;
  }
  function html(model) {
    const heroTabs = (model.heroes || []).length > 1 ? `<div class="ws-heroes" role="tablist" aria-label="给谁装">${model.heroes.map(h => `<button type="button" class="g-btn ws-hero" data-cw-kit="${esc(h.kit)}" aria-pressed="${model.kit === h.kit}">${esc(h.name)}</button>`).join("")}</div>` : "";
    const body = model.packet && model.packet.view
      ? `${rateBar(model.packet.view)}${confirmHtml(model)}<div class="ws-main cw-main"><div class="ws-col">${installedHtml(model)}</div><div class="ws-col">${shopHtml(model)}</div></div>`
      : `<p class="ws-empty cw-none">暂无可安装的义体</p>`;
    return `<div class="ws-card ovl-card cw-card" role="dialog" aria-label="诊所 · 义体">
      <header class="ws-head"><span class="ws-tape">诊所 · 义体</span><span class="ws-sub">手里有 ${esc(model.money)} 奎支 · 拆除完全可逆</span>
        <button type="button" class="g-btn ws-close" data-cw-close aria-label="关闭">关闭</button></header>
      ${model.error ? `<p class="r-warn r-error">没做成：${esc(model.error)}</p>` : model.note ? `<p class="ws-note">${esc(model.note)}</p>` : ""}
      ${heroTabs}${body}</div>`;
  }

  /* ---------- 浮层 ---------- */
  let box = null, getModel = null, onCmd = null;
  function ensureBox() {
    if (box) return box;
    box = document.createElement("div");
    box.id = "cw-overlay"; box.className = "ws-overlay ovl cw-overlay"; box.hidden = true;
    box.addEventListener("click", e => {
      if (e.target === box || e.target.closest("[data-cw-close]")) return close();
      const t = e.target.closest("[data-cw-cmd],[data-cw-pick],[data-cw-kit],[data-cw-cancel]");
      if (!t || t.disabled) return;
      if (t.dataset.cwCmd) { const c = JSON.parse(t.dataset.cwCmd); ui.confirm = ""; if (onCmd) onCmd(c); refresh(); return; }
      if (t.dataset.cwPick) ui.confirm = t.dataset.cwPick;
      else if (t.dataset.cwKit) { ui.kit = t.dataset.cwKit; ui.confirm = ""; }
      else if (t.hasAttribute("data-cw-cancel")) ui.confirm = "";
      refresh();
    });
    document.body.appendChild(box);
    return box;
  }
  function open(model, cmd, opt) {
    opt = opt || {};
    getModel = model; onCmd = cmd;
    if (opt.kit) ui.kit = opt.kit;
    ui.confirm = "";
    ensureBox().hidden = false;
    refresh();
  }
  function close() { if (box) box.hidden = true; getModel = null; onCmd = null; ui.confirm = ""; }
  function isOpen() { return !!(box && !box.hidden); }
  function refresh() {
    if (!isOpen() || !getModel) return;
    const m = getModel();
    if (!m) return close();
    const card = box.querySelector(".cw-card"), scroll = card ? card.scrollTop : 0;
    box.innerHTML = html(m);
    const c2 = box.querySelector(".cw-card"); if (c2) c2.scrollTop = scroll;
  }
  function button(kit, id) {
    return `<button type="button" class="g-btn cw-open" ${id ? `id="${esc(id)}"` : ""} data-cw-open="${esc(kit || "")}">义体</button>`;
  }
  if (typeof MutationObserver !== "undefined" && typeof document !== "undefined" && document.body) {
    let last = document.body.dataset.screen;
    new MutationObserver(() => { const now = document.body.dataset.screen; if (now !== last) { last = now; close(); } })
      .observe(document.body, { attributes: true, attributeFilter: ["data-screen"] });
  }

  root.CyberwareUI = { html, open, close, refresh, isOpen, button, localModel, viewModel, previewFor, state: ui, reset: resetUi, HEAVY };
})(typeof window !== "undefined" ? window : globalThis);
