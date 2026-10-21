/* Antlerscale: Backfire · 联机跑团「申请检定」界面（规则在 hotseat.js · requestCheck / decideCheck，PR #193）
 *   玩家：标题工具栏「申请检定」→ 浮层：选自己的哪名角色（可以有好几名）、熟练项、说明 → checkRequest；
 *         下面列出申请：待主持人 / 已同意（结果）/ 未同意 / 已撤回，待处理的可以撤回（checkDecide cancel）
 *   主持人：有待处理的申请时左下角出现「检定申请 · N」→ 浮层：每条选难度（带这名角色的成功率）批准 / 拒绝
 *   数据只用 view.checkRequests（online-view.js 白名单）和 view.checks（公开的检定结果）；没有任何坚毅生命数值。
 *   浮层带 .ovl（联机玩家页 online.css 只放行 .ol-ui / .ovl 等）；按钮 44px。
 *   const c = CheckRequestUI.mount({ api, view: () => view, own, call, units: () => [...], profLevel(kit, prof), playerName(id) }); c.sync(); c.destroy() */
(function (root) {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  const LV = ["没有熟练", "一级熟练", "二级熟练", "三级熟练"];
  const STATUS = { pending: "等主持人", approved: "已同意", rejected: "主持人没有同意", cancelled: "已撤回" };
  const DIFFS = () => (typeof ROGUE_CHECKS !== "undefined" ? Object.keys(ROGUE_CHECKS.diffs).map(k => [k, ROGUE_CHECKS.diffs[k].name]) : [["easy", "简单"], ["normal", "普通"], ["hard", "困难"], ["extreme", "极难"]]);
  const groups = () => (typeof PROFICIENCIES !== "undefined" ? PROFICIENCIES : {});
  const pct = v => Math.round((Number(v) || 0) * 1000) / 10 + "%";

  /** 已同意的申请：在 view.checks 里找对应的检定，写成「成功 · d100 23」 */
  function resultText(req, checks) {
    const c = (checks || []).find(x => x.id === req.checkId);
    const t = c && (c.targets || []).find(x => x.unitId === req.unitId) || (c && (c.targets || [])[0]);
    if (!c || !t) return "";
    if (!t.result) return `${c.diffName || ""}检定 · 掷骰中`;
    const rolls = (t.result.rolls || []).map(r => r.roll == null ? r.label : (r.label ? r.label + " " : "") + r.roll).join("，");
    return `${c.diffName || ""}（成功率 ${pct(t.base)}）· <b class="${t.result.ok ? "ol-ok" : "ol-bad"}">${t.result.ok ? "成功" : "失败"}</b>${rolls ? ` · d100 ${esc(rolls)}` : ""}`;
  }
  function rowHtml(r, opt) {
    const res = r.status === "approved" ? resultText(r, opt.checks) : "";
    const cancel = r.status === "pending" && (opt.isHost || r.operatorId === opt.own) && !opt.gmList
      ? `<button type="button" class="g-btn ol-button crq-btn" data-crq="cancel" data-req="${esc(r.id)}">撤回</button>` : "";
    return `<li class="crq-row crq-${esc(r.status)}" data-req-id="${esc(r.id)}"><div><b>${esc(r.unitName)}</b>「${esc(r.prof)}」${r.note ? `<small>（${esc(r.note)}）</small>` : ""}
      ${opt.showWho && opt.playerName ? `<small class="ol-muted"> · ${esc(opt.playerName(r.operatorId))}</small>` : ""}</div>
      <div class="crq-state"><span class="crq-chip">${esc(STATUS[r.status] || r.status)}</span>${res ? `<span class="crq-res">${res}</span>` : ""}${cancel}</div></li>`;
  }
  /** 玩家浮层 */
  function playerHtml(m) {
    const units = m.units || [], f = m.form;
    if (!units.some(u => u.id === f.unit)) f.unit = units[0] ? units[0].id : "";
    const u = units.find(x => x.id === f.unit);
    const all = Object.values(groups()).flat(); if (!all.includes(f.prof)) f.prof = all[0] || "";
    const profOpts = Object.keys(groups()).map(g => `<optgroup label="${esc(g)}">${groups()[g].map(p => { const lv = u && m.profLevel ? m.profLevel(u.kit, p) : 0; return `<option value="${esc(p)}"${p === f.prof ? " selected" : ""}>${esc(p)}${lv ? "（" + LV[lv] + "）" : ""}</option>`; }).join("")}</optgroup>`).join("");
    const reqs = (m.requests || []).slice().reverse();
    const mine = reqs.filter(r => r.operatorId === m.own), others = reqs.filter(r => r.operatorId !== m.own && r.status === "approved").slice(0, 5);
    const busy = u && reqs.some(r => r.unitId === u.id && r.status === "pending");
    const form = units.length ? `<div class="crq-form">
        <label>角色<select id="crq-unit">${units.map(x => `<option value="${esc(x.id)}"${x.id === f.unit ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
        <label>熟练项<select id="crq-prof">${profOpts}</select></label>
        <label>想做什么（可不填）<input id="crq-note" maxlength="80" value="${esc(f.note)}" placeholder="比如：撬开仓库的锁"></label>
        <p class="ol-muted">主持人定难度、同意后由房主掷骰，结果所有人都看得到。${busy ? "<br><b>这名角色还有一条申请在等主持人。</b>" : ""}</p>
        <button type="button" class="g-btn ol-button ol-primary crq-btn" data-crq="send"${busy || m.busy ? " disabled" : ""}>提交申请</button></div>`
      : '<p class="ol-muted">还没有分配到你的角色。</p>';
    return `<div class="ol-card crq-card"><header><h2>申请检定</h2><button type="button" class="g-btn ol-button crq-btn" data-crq="close">关闭</button></header>${form}
      <h3>我的申请</h3><ul class="crq-list">${mine.map(r => rowHtml(r, m)).join("") || '<li class="ol-muted">还没有申请过。</li>'}</ul>
      ${others.length ? `<h3>队友的检定结果</h3><ul class="crq-list">${others.map(r => rowHtml(r, Object.assign({}, m, { showWho: true }))).join("")}</ul>` : ""}</div>`;
  }
  /** 主持人浮层：每条待处理的申请选难度（带成功率）批准 / 拒绝 */
  function gmHtml(m) {
    const pending = (m.requests || []).filter(r => r.status === "pending");
    const K = typeof ROGUE_CHECKS !== "undefined" ? ROGUE_CHECKS : null;
    const rows = pending.map(r => {
      const u = (m.units || []).find(x => x.id === r.unitId), lv = u && m.profLevel ? m.profLevel(u.kit, r.prof) : 0;
      const d = m.diff[r.id] || "normal";
      const opts = DIFFS().map(([k, n], i) => `<option value="${k}"${k === d ? " selected" : ""}>${esc(n)}${K && K.chance[lv] ? `（成功率 ${pct(K.chance[lv][i])}）` : ""}</option>`).join("");
      return `<li class="crq-row crq-pending" data-req-id="${esc(r.id)}"><div><b>${esc(r.unitName)}</b>「${esc(r.prof)}」<small>${esc(LV[lv] || "")}</small>${r.note ? `<small>（${esc(r.note)}）</small>` : ""}
        ${m.playerName ? `<small class="ol-muted"> · ${esc(m.playerName(r.operatorId))}</small>` : ""}</div>
        <div class="crq-state"><label>难度<select data-crq-diff="${esc(r.id)}">${opts}</select></label>
        <button type="button" class="g-btn ol-button ol-primary crq-btn" data-crq="approve" data-req="${esc(r.id)}"${m.busy ? " disabled" : ""}>批准并掷骰</button>
        <button type="button" class="g-btn ol-button crq-btn" data-crq="reject" data-req="${esc(r.id)}"${m.busy ? " disabled" : ""}>拒绝</button></div></li>`;
    }).join("");
    const done = (m.requests || []).filter(r => r.status !== "pending").slice(-5).reverse().map(r => rowHtml(r, Object.assign({}, m, { gmList: true, showWho: true }))).join("");
    return `<div class="ol-card crq-card"><header><h2>玩家申请的检定</h2><button type="button" class="g-btn ol-button crq-btn" data-crq="close">关闭</button></header>
      <ul class="crq-list">${rows || '<li class="ol-muted">没有待处理的申请。</li>'}</ul>${done ? `<h3>最近处理的</h3><ul class="crq-list">${done}</ul>` : ""}</div>`;
  }

  function mount(o) {
    const doc = root.document;
    const box = doc.createElement("section"); box.id = "online-check-req"; box.className = "ol-ui ol-overlay ol-bag ovl crq"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "申请检定"); box.hidden = true;
    const pill = doc.createElement("button"); pill.type = "button"; pill.className = "ol-ui g-btn ol-button ol-primary crq-pill"; pill.dataset.crq = "open"; pill.hidden = true;
    doc.body.appendChild(box); doc.body.appendChild(pill);
    const form = { unit: "", prof: "", note: "" }, diff = {};
    let open = false, busy = false, last = "";
    const v = () => o.view() || {}, hs = () => (v().packet && v().packet.view) || {};
    const enabled = () => !!(v().active && v().packet && v().packet.mode !== "rogue" && ["exploration", "battle", "ended"].includes(v().screen));
    const model = () => ({ own: o.own(), isHost: !!v().isHost, units: o.units(), requests: hs().checkRequests || [], checks: hs().checks || [], form, diff, busy, profLevel: o.profLevel, playerName: o.playerName });
    function paint() {
      if (!open) return;
      const html = v().isHost ? gmHtml(model()) : playerHtml(model());
      if (html !== last) { last = html; box.innerHTML = html; }
    }
    function sync() {
      const on = enabled(), isHost = !!v().isHost;
      if (!on || isHost) doc.querySelectorAll('#online-stage [data-crq="open"]').forEach(b => b.remove());
      if (!on) { open = false; box.hidden = true; pill.hidden = true; return; }
      const pending = (hs().checkRequests || []).filter(r => r.status === "pending");
      // 主持人：有人申请时左下角提示；玩家：标题工具栏里放「申请检定」（舞台每次重画后补回去）
      pill.hidden = !(isHost && pending.length) || open; pill.textContent = `检定申请 · ${pending.length}`;
      if (!isHost) {
        const tools = doc.querySelector("#online-stage .ol-stage-heading .ol-info-tools");
        const mine = pending.filter(r => r.operatorId === o.own()).length;
        if (tools) {
          let b = tools.querySelector('[data-crq="open"]');
          if (!b) { b = doc.createElement("button"); b.type = "button"; b.className = "g-btn ol-button"; b.dataset.crq = "open"; tools.appendChild(b); }
          const label = `申请检定${mine ? " · 等待 " + mine : ""}`; if (b.textContent !== label) b.textContent = label;
        }
      }
      box.hidden = !open; paint();
    }
    async function submit(cmd) {
      if (busy) return false; busy = true; last = ""; paint();
      try { return await o.call(() => o.api.submit(cmd)); } finally { busy = false; last = ""; paint(); }
    }
    async function onClick(e) {
      const b = e.target.closest("[data-crq]"); if (!b) { if (e.target === box) { open = false; sync(); } return; }
      const a = b.dataset.crq;
      if (a === "open") { open = true; last = ""; sync(); box.querySelector('[data-crq="close"]')?.focus({ preventScroll: true }); return; }
      if (a === "close") { open = false; sync(); return; }
      if (a === "send") { if (form.unit && form.prof && await submit({ type: "checkRequest", unitId: form.unit, prof: form.prof, note: form.note.trim() })) form.note = ""; return; }
      if (a === "cancel") return void submit({ type: "checkDecide", requestId: b.dataset.req, decision: "cancel" });
      if (a === "reject") return void submit({ type: "checkDecide", requestId: b.dataset.req, decision: "reject" });
      if (a === "approve") return void submit({ type: "checkDecide", requestId: b.dataset.req, decision: "approve", diff: diff[b.dataset.req] || "normal" });
    }
    function onChange(e) {
      const t = e.target;
      if (t.id === "crq-unit") { form.unit = t.value; last = ""; paint(); }
      else if (t.id === "crq-prof") { form.prof = t.value; last = ""; paint(); }
      else if (t.dataset.crqDiff) diff[t.dataset.crqDiff] = t.value;
    }
    const onInput = e => { if (e.target.id === "crq-note") form.note = e.target.value; };
    const onKey = e => { e.stopPropagation(); if (e.key === "Escape") { open = false; sync(); } };
    const onDocClick = e => { if (e.target.closest('#online-stage [data-crq="open"]')) onClick(e); };
    box.addEventListener("click", onClick); pill.addEventListener("click", onClick); box.addEventListener("change", onChange); box.addEventListener("input", onInput); box.addEventListener("keydown", onKey);
    doc.addEventListener("click", onDocClick);
    return { sync, el: box, pill, destroy() { doc.removeEventListener("click", onDocClick); box.remove(); pill.remove(); } };
  }

  const api = { mount, playerHtml, gmHtml, resultText };
  root.CheckRequestUI = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
