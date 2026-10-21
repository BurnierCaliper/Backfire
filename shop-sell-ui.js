/* 商店 · 卖东西（买 / 卖 页签里的「卖」）：单机单局、联机单局、跑团（主持人 / 联机玩家）共用一套界面。
 * 规则在别处（rogue.js · shopSellView / sellItem / buybackItem；trpg · trpgShopSellFor）：这里只画房主 / 本机算好的视图，不自己算价钱。
 * 视图 shopSellView（单机 run.query shopSell；联机单局 packet.rogue.shopSell；跑团 packet.shopSell / trpgShopSellView）：{ items:[{id,name,qty,unitPrice,owner,ok,reason}], buyback:[{token,id,name,qty,price,owner,seller}] }
 *   owner 是 "shared"（公用）或某位英雄的 kit；ok=false 的行置灰并写明原因（任务道具 / 图纸 / 已装备 / 无标准价 / 改装件；改装件照旧走 sellPart）。
 * 按钮发出的指令：{ action:"sellItem", kit, id, qty, owner } / { action:"buybackItem", kit, token }，交给调用方的 onCmd。
 * 结果 {ok,total,payout:[{to,amount}],msg}：toastText() 写一句「钱进了谁的钱包」（to = kit 或 "party"）。 */
(function (root) {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = v => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);
  const arr = v => (Array.isArray(v) ? v : []);
  const cmdAttr = cmd => `data-ss-cmd="${esc(JSON.stringify(cmd))}"`;
  const SHARED = "shared";

  /** 页签和每行数量：按商店 / 面板记（key），包刷新重画时保留 */
  const ui = { tab: {}, qty: {} };
  function reset() { ui.tab = {}; ui.qty = {}; }
  const tabOf = key => ui.tab[key || ""] === "sell" ? "sell" : "buy";
  function setTab(key, tab) { ui.tab[key || ""] = tab === "sell" ? "sell" : "buy"; }
  const qtyKey = r => `${r.owner}|${r.id}`;
  function qtyOf(r) { const n = Math.floor(num(ui.qty[qtyKey(r)]) || 1); return Math.max(1, Math.min(Math.max(1, num(r.qty)), n)); }

  /** 视图清洗：缺字段的行丢掉，数字取整 */
  function normalize(v) {
    if (!v || typeof v !== "object") return null;
    const items = arr(v.items).filter(r => r && r.id != null).map(r => ({ id: String(r.id), name: String(r.name || r.id), qty: Math.max(0, Math.floor(num(r.qty))),
      unitPrice: Math.max(0, Math.floor(num(r.unitPrice))), owner: String(r.owner || SHARED), ok: r.ok !== false, reason: r.reason ? String(r.reason) : "" }));
    const buyback = arr(v.buyback).filter(b => b && b.token != null).map(b => ({ token: String(b.token), id: String(b.id || ""), name: String(b.name || b.id || ""),
      qty: Math.max(0, Math.floor(num(b.qty))), price: Math.max(0, Math.floor(num(b.price))), owner: String(b.owner || SHARED), seller: String(b.seller || "") }));
    return { items, buyback };
  }

  /** 界面模型：{ view, heroes:[{kit,name,purse?}], actor（公用东西由谁出手卖），canAct(kit), money(kit)?, disabled, note } */
  function model(view, o) {
    o = o || {};
    const heroes = arr(o.heroes).filter(h => h && h.kit);
    const mine = o.mine ? heroes.filter(h => o.mine(h.kit)) : heroes;
    const actor = o.actor || (mine[0] || {}).kit || "";
    return { view: normalize(view), heroes, actor, canAct: o.canAct || (k => k === SHARED || mine.some(h => h.kit === k)),
      money: o.money || null, disabled: !!o.disabled, note: o.note || "", key: o.key || "" };
  }
  const nameOf = (m, k) => k === SHARED ? "公用" : k === "party" ? "队伍公账" : ((m.heroes.find(h => h.kit === k) || {}).name || k);

  /* ---------- 渲染（纯函数） ---------- */
  function tabsHtml(key, opt) {
    opt = opt || {};
    const t = tabOf(key);
    const b = (id, label) => `<button type="button" class="g-btn ss-tab${t === id ? " on" : ""}" role="tab" aria-selected="${t === id}" data-ss-tab="${id}" data-ss-key="${esc(key || "")}"${id === "sell" && opt.sellOff ? ' disabled title="这里不收东西"' : ""}>${label}</button>`;
    return `<div class="ss-tabs" role="tablist" aria-label="买 / 卖">${b("buy", "买")}${b("sell", "卖")}</div>`;
  }
  function rowHtml(m, r) {
    const n = qtyOf(r), off = m.disabled || !r.ok || !r.qty || !m.canAct(r.owner);
    const kit = r.owner === SHARED ? m.actor : r.owner;
    const why = !r.ok ? r.reason || "不收" : !m.canAct(r.owner) ? "不是你的角色" : "";
    return `<li class="ss-row${r.ok ? "" : " off"}" data-ss-row="${esc(qtyKey(r))}">
      <span class="ss-name"><b>${esc(r.name)}</b><small>有 ${esc(r.qty)}${why ? ` · <span class="ss-why">${esc(why)}</span>` : ""}</small></span>
      <span class="ss-unit"><small>单价</small><b>${r.ok ? esc(r.unitPrice) : "—"}</b></span>
      <span class="ss-step" role="group" aria-label="卖几份">
        <button type="button" class="g-btn ss-dec" data-ss-step="-1" data-ss-q="${esc(qtyKey(r))}" data-ss-max="${esc(r.qty)}"${off || n <= 1 ? " disabled" : ""} aria-label="少一份">−</button>
        <b class="ss-n">${esc(n)}</b>
        <button type="button" class="g-btn ss-inc" data-ss-step="1" data-ss-q="${esc(qtyKey(r))}" data-ss-max="${esc(r.qty)}"${off || n >= r.qty ? " disabled" : ""} aria-label="多一份">＋</button></span>
      <span class="ss-total"><small>共</small><b>${r.ok ? esc(r.unitPrice * n) : "—"}</b></span>
      <button type="button" class="g-btn ss-sell" ${cmdAttr({ action: "sellItem", kit, id: r.id, qty: n, owner: r.owner })}${off || !kit ? " disabled" : ""}>卖</button></li>`;
  }
  function groupsHtml(m) {
    const owners = [SHARED].concat(m.heroes.map(h => h.kit));
    m.view.items.forEach(r => { if (!owners.includes(r.owner)) owners.push(r.owner); });
    return owners.map(o => {
      const rows = m.view.items.filter(r => r.owner === o);
      if (!rows.length) return "";
      const h = m.heroes.find(x => x.kit === o);
      const purse = h && h.purse != null ? ` <small>钱包 ${esc(h.purse)} 奎支</small>` : "";
      return `<section class="ss-group" data-ss-owner="${esc(o)}"><h4>${esc(nameOf(m, o))}${o === SHARED ? " <small>卖得的钱进队伍</small>" : purse}</h4><ul class="ss-list">${rows.map(r => rowHtml(m, r)).join("")}</ul></section>`;
    }).join("");
  }
  function buybackHtml(m) {
    const list = m.view.buyback;
    if (!list.length) return "";
    return `<section class="ss-group ss-buyback"><h4>可买回 <small>离开商店前按卖出价买回，离开后就没了</small></h4><ul class="ss-list">${list.map(b => {
      const mineSale = m.canAct(b.seller) || m.canAct(b.owner) && b.owner !== SHARED;
      const kit = b.seller || (b.owner === SHARED ? m.actor : b.owner);
      const off = m.disabled || !mineSale || (m.money && m.money(kit) != null && m.money(kit) < b.price);
      return `<li class="ss-row ss-bb"><span class="ss-name"><b>${esc(b.name)} ×${esc(b.qty)}</b><small>${esc(nameOf(m, b.owner))} · ${esc(nameOf(m, b.seller))} 卖的</small></span>
        <span class="ss-total"><small>买回</small><b>${esc(b.price)}</b></span>
        <button type="button" class="g-btn ss-back" ${cmdAttr({ action: "buybackItem", kit, token: b.token })}${off ? " disabled" : ""}>买回</button></li>`;
    }).join("")}</ul></section>`;
  }
  function html(m) {
    if (!m || !m.view) return `<div class="ss-panel"><p class="ss-empty">这里现在不收东西。</p></div>`;
    const body = m.view.items.length ? groupsHtml(m) : `<p class="ss-empty">没有能卖的东西。</p>`;
    return `<div class="ss-panel" aria-label="卖东西"><p class="ss-hint">按标准价的一半收（向下取整）。英雄名下的东西钱进他自己的钱包；公用的东西钱进队伍。</p>
      ${m.note ? `<p class="ss-note">${esc(m.note)}</p>` : ""}${body}${buybackHtml(m)}</div>`;
  }

  /** 结果 → 一句提示：「卖出 2 件，得 30 奎支 → 柯尔特 30」 */
  function toastText(res, names) {
    if (!res) return "";
    if (res.ok === false) return `没做成：${res.msg || res.error || "不能卖"}`;
    const nm = k => (typeof names === "function" ? names(k) : names && names[k]) || (k === "party" ? "队伍公账" : k);
    const pay = arr(res.payout).filter(p => p && num(p.amount)).map(p => `${nm(p.to)} ${num(p.amount) > 0 ? "+" : ""}${num(p.amount)}`);
    return `💰 ${res.msg || `${num(res.total) >= 0 ? "得" : "花"} ${Math.abs(num(res.total))} 奎支`}${pay.length ? ` → ${pay.join("、")}` : ""}`;
  }

  /** 事件委托：容器里的页签 / 步进 / 卖 / 买回。rerender() 由调用方重画；onCmd(cmd) 发指令 */
  function handle(e, onCmd, rerender) {
    const t = e.target && e.target.closest && e.target.closest("[data-ss-tab],[data-ss-step],[data-ss-cmd]");
    if (!t || t.disabled) return false;
    if (t.dataset.ssTab) { setTab(t.dataset.ssKey, t.dataset.ssTab); if (rerender) rerender(); return true; }
    if (t.dataset.ssStep) {
      const k = t.dataset.ssQ, max = Math.max(1, num(t.dataset.ssMax));
      ui.qty[k] = Math.max(1, Math.min(max, (Math.floor(num(ui.qty[k])) || 1) + num(t.dataset.ssStep)));
      if (rerender) rerender(); return true;
    }
    if (t.dataset.ssCmd) {
      const c = JSON.parse(t.dataset.ssCmd);
      if (c.action === "sellItem") delete ui.qty[`${c.owner}|${c.id}`];
      if (onCmd) onCmd(c); if (rerender) rerender(); return true;
    }
    return false;
  }
  /** 包里没有卖出视图了（离开商店 / 收摊）：页签回到「买」 */
  function sync(key, hasView) { if (!hasView && tabOf(key) === "sell") setTab(key, "buy"); if (!hasView) ui.qty = {}; }

  /** 本机 / 房主的提示条（联机玩家用 online-ui 自己的 .ol-toast） */
  let toastBox = null, toastTimer = 0;
  function toast(text) {
    if (typeof document === "undefined" || !document.body || !text) return;
    if (!toastBox) { toastBox = document.createElement("div"); toastBox.className = "ss-toast"; toastBox.setAttribute("role", "status"); document.body.appendChild(toastBox); }
    toastBox.textContent = text; toastBox.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastBox.hidden = true; }, 4500);
  }

  root.ShopSellUI = { toast, html, tabsHtml, model, normalize, toastText, handle, sync, tabOf, setTab, reset, state: ui, SHARED };
})(typeof window !== "undefined" ? window : globalThis);
