/* 工坊面板（单局 · 任务板 / 休整 / 工匠 / 休息点）：按钮打开的浮层，不再拼在页面底部，战斗里没有。
 * 房主 / 单机（rogue-ui.js）和联机玩家（online-ui.js）用同一个渲染器，数据走 workshop-data-adapter.js 的界面模型。
 *   顶：材料条 · 分类标签 + 只看可做
 *   左：可做（展开、高亮）/ 缺材料（折叠、灰，只写「还差 X×n」，不给成功率）；每张都写道具效果
 *   右：选中配方的详情（道具效果、材料 ✓ / ✗、每人成功率 + 打下手、耗时、产出、失败损失、制作 / 排活）
 *   下：学配方（也写道具效果）、拆解
 * 按钮都是 data-ws-cmd（JSON 指令），由打开面板的一方交给自己的 act()。 */
(function (root) {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = p => `${Math.round((Number(p) || 0) * 1000) / 10}%`;
  const nameOf = id => ((typeof ITEM_CATALOG !== "undefined" ? ITEM_CATALOG : {})[id] || {}).name || id;
  /* 道具效果（items.js · ITEM_CATALOG 的 hint，固定的规则文字）：配方列表、详情、学配方都写。
   * 联机玩家也读本机的道具表，联机发的数据不用多带 */
  const hintOf = id => ((typeof ITEM_CATALOG !== "undefined" ? ITEM_CATALOG : {})[id] || {}).hint || "";
  const effectLine = id => { const h = hintOf(id); return h ? `<small class="ws-effect">${esc(h)}</small>` : ""; };
  const cmdAttr = cmd => `data-ws-cmd="${esc(JSON.stringify(cmd))}"`;
  const KINDS = [["", "全部"], ["status", "投掷罐"], ["instant", "弹针"], ["common", "增益 / 减益"], ["stun", "晕眩"], ["field", "场地"], ["self", "自我效果"]];
  const PLACE_TEXT = { bench: "工作台：五类都能做", rest: "休息点：场地、自我效果做不了" };

  /* 面板状态（跨重画保留） */
  const ui = { kind: "", only: false, sel: "", kit: "", helper: {}, mat: "", missOpen: false };
  function resetUi() { Object.assign(ui, { kind: "", only: false, sel: "", kit: "", helper: {}, mat: "", missOpen: false }); }

  /** 「还差 废料×1、电芯×2」 */
  function needLine(row) {
    return (row.missing || []).map(m => `${nameOf(m.id)}×${Math.max(0, m.need - m.have)}`).join("、");
  }
  function filterRows(list, model) {
    return list.filter(r => (!ui.kind || r.kind === ui.kind) && (!ui.mat || (r.mats || []).some(m => m.id === ui.mat)));
  }
  function missReason(r) {
    if (r.missing && r.missing.length) return `还差 ${needLine(r)}`;
    if (!r.known) return "还不会这张配方";
    if (!r.canMakeHere) return "要在工坊的工作台上做";
    if (r.affordable === false) return `奎支不够补金属（要 ${r.metalKuizhi}）`;
    return "现在做不了";
  }

  /** 整块面板 HTML（纯函数：给测试和两种界面共用） */
  function html(model) {
    const heroes = model.heroes || [];
    if (!heroes.some(h => h.kit === ui.kit)) ui.kit = (heroes[0] || {}).kit || "";
    const g = ui.kit ? model.grouped(ui.kit) : { craftable: [], missing: [] };
    const craftable = filterRows(g.craftable || [], model), missing = ui.only ? [] : filterRows(g.missing || [], model);
    const all = craftable.concat(missing);
    if (!all.some(r => r.id === ui.sel)) ui.sel = (craftable[0] || missing[0] || {}).id || "";
    const bar = (model.mats || []).map(m => `<span class="ws-mat${m.have ? "" : " zero"}${ui.mat === m.id ? " on" : ""}" title="${esc(m.hint || "")}" data-ws-mat="${esc(m.id)}">${esc(m.name)} <b>${esc(m.have)}</b></span>`).join("");
    const tabs = KINDS.map(([k, n]) => `<button type="button" class="g-btn ws-tab" data-ws-kind="${esc(k)}" aria-pressed="${ui.kind === k}">${esc(n)}</button>`).join("");
    const heroTabs = heroes.length > 1 ? `<div class="ws-heroes" role="tablist" aria-label="谁来做">${heroes.map(h => `<button type="button" class="g-btn ws-hero" data-ws-kit="${esc(h.kit)}" aria-pressed="${ui.kit === h.kit}">${esc(h.name)}</button>`).join("")}</div>` : "";
    const okRow = r => `<li class="ws-recipe ok${ui.sel === r.id ? " sel" : ""}" data-ws-pick="${esc(r.id)}" tabindex="0">
        <b>${esc(r.name)}</b><small>${esc(r.prof)} · ${esc(r.diffName)} · ${esc(r.hours)} 小时${r.metalKuizhi ? ` · 补金属 ${esc(r.metalKuizhi)} 奎支` : ""}</small>${effectLine(r.id)}</li>`;
    const missRow = r => `<li class="ws-recipe miss${ui.sel === r.id ? " sel" : ""}" data-ws-pick="${esc(r.id)}" tabindex="0"><b>${esc(r.name)}</b><small class="ws-need">${esc(missReason(r))}</small>${effectLine(r.id)}</li>`;
    const matFilter = ui.mat ? `<p class="ws-filter">只看用到「${esc(nameOf(ui.mat))}」的配方 <button type="button" class="g-btn small" data-ws-mat="">清除</button></p>` : "";
    const list = `${matFilter}<section class="ws-group ws-ok"><h3>可做 <small>${craftable.length}</small></h3>
        <ul class="ws-list">${craftable.map(okRow).join("") || `<li class="ws-empty">${ui.only || !missing.length ? "现在没有材料够的配方。" : "没有材料够的配方，看看下面缺什么。"}</li>`}</ul></section>
      ${ui.only ? "" : `<details class="ws-group ws-miss" ${ui.missOpen ? "open" : ""}><summary>缺材料 / 做不了 <small>${missing.length}</small></summary>
        <ul class="ws-list">${missing.map(missRow).join("") || `<li class="ws-empty">都能做。</li>`}</ul></details>`}`;
    return `<div class="ws-card ovl-card" role="dialog" aria-label="工坊">
      <header class="ws-head"><span class="ws-tape">工坊</span><span class="ws-sub">${esc(PLACE_TEXT[model.place] || "这里不能制作")}</span>
        <button type="button" class="g-btn ws-close" data-ws-close aria-label="关闭">关闭</button></header>
      ${model.error ? `<p class="r-warn r-error">没做成：${esc(model.error)}</p>` : model.note ? `<p class="ws-note">${esc(model.note)}</p>` : ""}
      <div class="ws-bar" aria-label="材料">${bar}</div>
      <div class="ws-tools"><div class="ws-tabs" role="tablist" aria-label="分类">${tabs}</div>
        <label class="ws-only"><input type="checkbox" data-ws-only ${ui.only ? "checked" : ""}> 只看可做</label></div>
      ${heroTabs}
      <div class="ws-main"><div class="ws-col ws-left">${list}</div>
        <div class="ws-col ws-detail" aria-live="polite">${detail(model, all.find(r => r.id === ui.sel))}</div></div>
      ${queueHtml(model)}${learnHtml(model)}${salvageHtml(model)}
    </div>`;
  }

  function detail(model, row) {
    if (!row) return `<p class="r-hint">选一张配方看详情。</p>`;
    const ok = (row.missing || []).length === 0;
    const mats = (row.mats || []).map(m => {
      const metal = m.id === "mat_metal", enough = m.have >= m.need;
      const mark = enough ? `<i class="ws-yes">✓</i>` : metal ? `<i class="ws-pay">¥</i>` : `<i class="ws-no">✗</i>`;
      return `<li class="${enough ? "ok" : metal ? "pay" : "bad"}">${mark} ${esc(m.name || nameOf(m.id))} <b>${esc(m.have)}/${esc(m.need)}</b>${!enough && metal ? `<small>缺的按 ${esc(row.metalKuizhi)} 奎支补</small>` : ""}</li>`;
    }).join("");
    const isCraftable = (model.grouped(ui.kit).craftable || []).some(r => r.id === row.id);
    const effect = hintOf(row.id);
    const head = `<h3>${esc(row.name)}</h3><p class="ws-meta">${esc(row.prof)} · ${esc(row.diffName)} · ${esc(row.hours)} 小时 · 产出 ${esc(row.name)}×1</p>
      ${effect ? `<p class="ws-effect">效果：${esc(effect)}</p>` : ""}<ul class="ws-mats">${mats}</ul>`;
    if (!isCraftable) {
      // 缺材料 / 做不了：不给成功率
      return `${head}<p class="ws-need big">${esc(missReason(row))}</p>
        <button type="button" class="g-btn r-main" disabled>${ok ? "做不了" : "材料不够"}</button>`;
    }
    const heroes = (model.heroes || []).filter(h => !ui.kit || h.kit === ui.kit);
    const rows = heroes.map(h => {
      const help = ui.helper[h.kit] || "";
      const p = model.preview(h.kit, row.id, help || null) || {};
      const o = p.odds;
      const helpers = (model.helpers || []).filter(x => x.kit !== h.kit).map(x => `<option value="${esc(x.kit)}"${help === x.kit ? " selected" : ""}>${esc(x.name)} 打下手</option>`).join("");
      const can = !!(p.craftable && o && o.chance > 0);
      const cmd = model.net ? { action: "setCraftJob", kit: h.kit, item: row.id, helper: help || null } : { action: "craft", jobs: [{ kit: h.kit, item: row.id, helper: help || null }] };
      const why = can ? "" : (p.reasons || []).join("；") || "做不了";
      return `<div class="ws-who"><b>${esc(h.name)}</b>
        <select data-ws-helper="${esc(h.kit)}" aria-label="谁打下手"><option value="">没人帮</option>${helpers}</select>
        <span class="ws-odds">${can ? `成功率 <b>${pct(o.chance)}</b>${o.adv ? " · 优势" : o.dis ? " · 劣势" : ""}${o.reroll ? " · 可重掷" : ""}` : `<small>${esc(why)}</small>`}</span>
        <button type="button" class="g-btn r-main ws-go" ${cmdAttr(cmd)} ${can ? "" : "disabled"}>${model.net ? "排上" : "制作"}</button></div>`;
    }).join("");
    const p0 = model.preview(ui.kit, row.id, null) || {};
    const fail = p0.onFail ? `<p class="r-hint">失败：时间照花，非壳体材料丢 ${esc(p0.onFail.lose)} 份（${esc(p0.onFail.from.map(x => x.name).join("、"))} 里随机），${esc((p0.onFail.keep || []).map(nameOf).join("、") || "壳体")}留着。</p>` : "";
    return `${head}${rows}${fail}`;
  }
  function queueHtml(model) {
    if (!model.net) return "";
    const q = model.queue || [];
    return `<section class="ws-sec"><h3>排好的活</h3><ul class="ws-q">${q.map(j => `<li>${esc(j.name)}：${esc(j.itemName)}${j.helperName ? `（${esc(j.helperName)} 打下手）` : ""} · ${pct(j.chance)} · ${esc(j.hours)} 小时</li>`).join("") || "<li>还没有人排活。</li>"}</ul>
      ${model.host ? `<button type="button" class="g-btn r-main" ${cmdAttr({ action: "craftQueued" })} ${q.length ? "" : "disabled"}>开工</button>` : `<p class="r-hint">房主按「开工」大家一起做，时间按最久的算。</p>`}</section>`;
  }
  function learnHtml(model) {
    const l = model.learn || [];
    if (!l.length) return "";
    const money = model.money ? model.money(ui.kit) : 0;
    return `<details class="ws-sec"><summary>学配方（${esc(l[0].smithName)}）</summary><ul class="ws-q">${l.map(x => `<li>${esc(x.name)} · ${esc(x.prof)} · ${esc(x.diffName || "")}
      <button type="button" class="g-btn small" ${cmdAttr({ action: "learnRecipe", item: x.item, smith: x.smith })} ${money < x.price ? "disabled" : ""}>学 · ${esc(x.price)} 奎支</button>${effectLine(x.item)}</li>`).join("")}</ul></details>`;
  }
  function salvageHtml(model) {
    const s = model.salvage || [];
    if (!s.length) return "";
    return `<details class="ws-sec"><summary>拆解（不花时间）</summary><ul class="ws-q">${s.map(x => `<li>${esc(x.name)} ×${esc(x.qty)} → ${esc((x.yield || []).map(y => `${y.name}×${y.qty}`).join("、"))}
      <button type="button" class="g-btn small" ${cmdAttr({ action: "salvage", item: x.id })}>拆一件</button></li>`).join("")}</ul></details>`;
  }

  /* ---------- 浮层 ---------- */
  let box = null, getModel = null, onCmd = null;
  function ensureBox() {
    if (box) return box;
    box = document.createElement("div");
    box.id = "ws-overlay"; box.className = "ws-overlay ovl"; box.hidden = true;
    box.addEventListener("click", e => {
      if (e.target === box || e.target.closest("[data-ws-close]")) return close();
      const t = e.target.closest("[data-ws-cmd],[data-ws-kind],[data-ws-kit],[data-ws-pick],[data-ws-mat]");
      if (!t || t.disabled) return;
      if (t.dataset.wsCmd) { if (onCmd) onCmd(JSON.parse(t.dataset.wsCmd)); return refresh(); }
      if (t.dataset.wsKind != null) ui.kind = t.dataset.wsKind;
      else if (t.dataset.wsKit) ui.kit = t.dataset.wsKit;
      else if (t.dataset.wsPick) ui.sel = t.dataset.wsPick;
      else if (t.dataset.wsMat != null) ui.mat = ui.mat === t.dataset.wsMat ? "" : t.dataset.wsMat;
      refresh();
    });
    box.addEventListener("keydown", e => {
      if (e.key === "Escape") close();
      else if (e.key === "Enter" && e.target.dataset && e.target.dataset.wsPick) { ui.sel = e.target.dataset.wsPick; refresh(); }
    });
    box.addEventListener("change", e => {
      const t = e.target;
      if (t.matches("[data-ws-only]")) ui.only = t.checked;
      else if (t.dataset.wsHelper) ui.helper[t.dataset.wsHelper] = t.value;
      else return;
      refresh();
    });
    box.addEventListener("toggle", e => { if (e.target.classList && e.target.classList.contains("ws-miss")) ui.missOpen = e.target.open; }, true);
    document.body.appendChild(box);
    return box;
  }
  /** 打开：model() 每次重画时取最新数据；cmd(command) 交给调用方的 act。opt.mat / opt.select 预设筛选 */
  function open(model, cmd, opt) {
    opt = opt || {};
    getModel = model; onCmd = cmd;
    if (opt.mat != null) ui.mat = opt.mat;
    if (opt.select) ui.sel = opt.select;
    ensureBox().hidden = false;
    refresh();
  }
  function close() { if (box) box.hidden = true; getModel = null; onCmd = null; }
  function isOpen() { return !!(box && !box.hidden); }
  function refresh() {
    if (!isOpen() || !getModel) return;
    const m = getModel();
    if (!m || !m.place) return close();
    const scroll = box.querySelector(".ws-card") ? box.querySelector(".ws-card").scrollTop : 0;
    box.innerHTML = html(m);
    const card = box.querySelector(".ws-card"); if (card) card.scrollTop = scroll;
  }
  /** 入口按钮（只在能开工坊的地方） */
  function button(place, id) {
    return place ? `<button type="button" class="g-btn ws-open" id="${esc(id || "r-workshop")}" title="${esc(PLACE_TEXT[place])}">工坊</button>` : "";
  }

  /* 换画面（例如进战斗）就收起来：Screens.show 会改 body[data-screen] */
  if (typeof MutationObserver !== "undefined" && typeof document !== "undefined" && document.body) {
    let last = document.body.dataset.screen;
    new MutationObserver(() => { const now = document.body.dataset.screen; if (now !== last) { last = now; close(); } })
      .observe(document.body, { attributes: true, attributeFilter: ["data-screen"] });
  }

  root.WorkshopUI = { html, open, close, refresh, isOpen, button, state: ui, reset: resetUi, needLine };
})(typeof window !== "undefined" ? window : globalThis);
