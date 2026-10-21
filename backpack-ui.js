/* 背包浮层（单局：任务板 / 路线图 / 休整 / 工匠 / 休息点都能开；战斗里只读）。
 * 分页：材料 / 消耗品 / 改装件 / 义体 / 关键道具。点材料 → 列出用到它的配方，能开工坊时有「去工坊」。
 * 房主 / 单机（rogue-ui.js、战斗顶栏 #g-backpack）和联机玩家（online-ui.js）共用这一个渲染器，数据见 workshop-data-adapter.js。 */
(function (root) {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TABS = [["material", "材料"], ["consumable", "消耗品"], ["mod", "改装件"], ["cyber", "义体"], ["key", "关键道具"]];
  const CYBER = { armor: "装甲", shield: "护盾", sand: "沙尘", spirit: "星灵" };
  const ui = { tab: "material", sel: "" };

  /** 一个分类下的行：个人的在前（标「自己的」），公用的在后 */
  function rowsOf(model, cat) {
    const out = [];
    (model.views || []).forEach(v => {
      ((v.personal && v.personal[cat]) || []).forEach(r => out.push(Object.assign({ owner: v.name }, r)));
      ((v.shared && v.shared[cat]) || []).forEach(r => { if (!out.some(x => x.id === r.id && !x.owner)) out.push(Object.assign({}, r)); });
    });
    return out;
  }
  function html(model) {
    const counts = {};
    TABS.forEach(([k]) => { counts[k] = k === "cyber" ? (model.cyber || []).length : rowsOf(model, k).length; });
    const tabs = TABS.map(([k, n]) => `<button type="button" class="g-btn bp-tab" data-bp-tab="${k}" aria-pressed="${ui.tab === k}">${n} <small>${counts[k]}</small></button>`).join("");
    let body;
    if (ui.tab === "cyber") {
      body = model.inBattle ? `<p class="r-hint">战斗中看不了义体方案（回到路线图或休整时再看）。</p>`
        : (model.cyber || []).map(c => `<li class="bp-row"><b>${esc(c.name)}</b><small>${esc(Object.keys(CYBER).filter(k => Number((c.current || {})[k])).map(k => `${CYBER[k]} ${c.current[k]}`).join(" · ") || "没有义体改造")} · 已用 ${esc(c.used)}/${esc(c.limit)}</small></li>`).join("");
      body = body ? (body.startsWith("<p") ? body : `<ul class="bp-list">${body}</ul>`) : `<p class="r-hint">没有义体信息。</p>`;
    } else {
      const rows = rowsOf(model, ui.tab);
      body = rows.length ? `<ul class="bp-list">${rows.map(r => `<li class="bp-row${ui.sel === r.id ? " sel" : ""}${ui.tab === "material" ? " click" : ""}" ${ui.tab === "material" ? `data-bp-pick="${esc(r.id)}" tabindex="0"` : ""}>
          <b>${esc(r.name)}</b><span class="bp-qty">×${esc(r.qty)}</span>${r.owner ? `<em class="bp-own">${esc(r.owner)} 的</em>` : ""}<small>${esc(r.hint || "")}</small></li>`).join("")}</ul>`
        : `<p class="r-hint">${ui.tab === "key" ? "还没有关键道具。" : "这一类是空的。"}</p>`;
    }
    const det = ui.tab === "material" && ui.sel ? matDetail(model, ui.sel) : "";
    return `<div class="bp-card ovl-card" role="dialog" aria-label="背包">
      <header class="ws-head"><span class="ws-tape">背包</span><span class="ws-sub">${model.readOnly ? "只读（战斗中）" : "BACKPACK"}</span>
        <button type="button" class="g-btn ws-close" data-bp-close aria-label="关闭">关闭</button></header>
      <div class="ws-tabs bp-tabs" role="tablist">${tabs}</div>
      <div class="bp-main"><div class="bp-col">${body}</div>${det ? `<div class="bp-col bp-detail">${det}</div>` : ""}</div>
    </div>`;
  }
  function matDetail(model, id) {
    const uses = (model.uses ? model.uses(id) : []) || [];
    const name = ((typeof ITEM_CATALOG !== "undefined" ? ITEM_CATALOG : {})[id] || {}).name || id;
    const go = model.workshop && !model.readOnly ? `<button type="button" class="g-btn r-main" data-bp-workshop="${esc(id)}">去工坊</button>` : "";
    return `<h3>${esc(name)}</h3><p class="r-hint">用到它的配方：</p>
      <ul class="bp-uses">${uses.map(u => `<li>${esc(u.name)} <small>×${esc(u.need)}</small></li>`).join("") || "<li>没有配方用到它。</li>"}</ul>${go}`;
  }

  let box = null, getModel = null, opts = {};
  function ensureBox() {
    if (box) return box;
    box = document.createElement("div");
    box.id = "bp-overlay"; box.className = "bp-overlay ovl"; box.hidden = true;
    box.addEventListener("click", e => {
      if (e.target === box || e.target.closest("[data-bp-close]")) return close();
      const t = e.target.closest("[data-bp-tab],[data-bp-pick],[data-bp-workshop]");
      if (!t) return;
      if (t.dataset.bpTab) { ui.tab = t.dataset.bpTab; ui.sel = ""; }
      else if (t.dataset.bpPick) ui.sel = ui.sel === t.dataset.bpPick ? "" : t.dataset.bpPick;
      else if (t.dataset.bpWorkshop) { const id = t.dataset.bpWorkshop, f = opts.openWorkshop; close(); if (f) f(id); return; }
      refresh();
    });
    box.addEventListener("keydown", e => {
      if (e.key === "Escape") close();
      else if (e.key === "Enter" && e.target.dataset && e.target.dataset.bpPick) { ui.sel = e.target.dataset.bpPick; refresh(); }
    });
    // 战斗里挂在 #g-app 下面，天气的面板 ::before 也能套上
    (document.getElementById("g-app") && opts.battle ? document.getElementById("g-app") : document.body).appendChild(box);
    return box;
  }
  /** model() 取最新数据；opt.openWorkshop(materialId) 点「去工坊」；opt.battle 战斗中（只读） */
  function open(model, opt) {
    opts = opt || {};
    if (box && box.parentNode && !!opts.battle !== (box.parentNode.id === "g-app")) { box.remove(); box = null; }
    getModel = model;
    ensureBox().hidden = false;
    refresh();
  }
  function close() { if (box) box.hidden = true; getModel = null; }
  function isOpen() { return !!(box && !box.hidden); }
  function refresh() { if (isOpen() && getModel) { const m = getModel(); if (m) box.innerHTML = html(m); } }
  function button(id) { return `<button type="button" class="g-btn bp-open" id="${esc(id || "r-backpack")}">背包</button>`; }

  /* 战斗顶栏的「背包」（#g-backpack；旧的 #g-bag 是沙盒的编辑背包页，不动）（只读）：单局里读当前这局，别的模式读整个背包 */
  function battleModel() {
    // 联机玩家：读房主发来的包（view.packet.rogue），不读本机浏览器里的背包
    const OG = root.OnlineGame;
    const v = OG && OG.getView ? OG.getView() || {} : {};
    if (v.active && !v.isHost) { const r = v.packet && v.packet.rogue; return r ? WorkshopData.viewBackpackModel(r, { battle: true }) : null; }
    const run = root.RunFlow && typeof RunFlow.current === "function" ? RunFlow.current() : null;
    const kits = run && root.OnlineRogue && OnlineRogue.active && OnlineRogue.active() ? OnlineRogue.hostKits() : null;
    return WorkshopData.hostBackpackModel(run, { battle: true, kits });
  }
  if (typeof document !== "undefined") document.addEventListener("click", e => {
    if (e.target.closest && e.target.closest("#g-backpack")) open(battleModel, { battle: true });
  });

  const inBattleMode = () => isOpen() && !!opts.battle;
  /* 换画面就收起来（战斗里开的只读背包除外，它本来就在战斗画面里） */
  if (typeof MutationObserver !== "undefined" && typeof document !== "undefined" && document.body) {
    let last = document.body.dataset.screen;
    new MutationObserver(() => { const now = document.body.dataset.screen; if (now !== last) { last = now; if (!inBattleMode()) close(); } })
      .observe(document.body, { attributes: true, attributeFilter: ["data-screen"] });
  }

  root.BackpackUI = { html, open, close, refresh, isOpen, inBattleMode, button, state: ui, rowsOf, battleModel };
})(typeof window !== "undefined" ? window : globalThis);
