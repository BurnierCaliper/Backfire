/* 长休结算画面（issue #52）：单局休息点 / 任务间休整、跑团长休、联机玩家共用。
 *   RestReport.html(report, { gm })   画面内容（report 来自 ledger.js · restReport）
 *   RestReport.show(report, { gm })   弹出（点「好」或按 Esc 关）
 * 坚毅生命：gm 为真（跑团主持人）才写数值；否则只写按比例抽的那一句（report.heroes[].mood）。
 * 守夜的人标红：这次长休没恢复。 */
(function (root) {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clock = m => { m = ((Math.floor(Number(m) || 0) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
  const EXHAUST = ["没有力竭", "力竭 1", "力竭 2", "力竭 3", "力竭致死"];
  const arrow = (a, b) => (a === b ? `${esc(b)}` : `${esc(a)} → <b>${esc(b)}</b>`);
  function heroRow(h, gm) {
    const ws = (h.weapons || []).map(w => `<span class="rr-w">${esc(w.name)} 耐久 ${arrow(w.dur[0], w.dur[1])}/${esc(w.max)}</span>`).join("");
    const shp = gm && h.shp ? `<span class="rr-gm">坚毅 ${arrow(h.shp[0], h.shp[1])}/${esc(h.shpMax)}（仅主持人）</span>` : "";
    return `<li class="rr-hero${h.watch ? " rr-watch" : ""}${h.dead ? " rr-dead" : ""}">
      <div class="rr-head"><span class="rr-ava" aria-hidden="true">${esc(String(h.name || "?").slice(0, 1))}</span><b>${esc(h.name)}</b>${h.watch ? '<span class="rr-tag">守夜 · 没有恢复</span>' : ""}${h.dead ? '<span class="rr-tag">已阵亡</span>' : ""}</div>
      ${h.dead ? "" : `<div class="rr-nums"><span>血量 ${arrow(h.hp[0], h.hp[1])}/${esc(h.hpMax)}</span>${ws}${shp}</div>`}
      ${h.mood ? `<p class="rr-mood">「${esc(h.mood)}」</p>` : ""}
    </li>`;
  }
  function html(r, opt) {
    if (!r) return "";
    const gm = !!(opt && opt.gm);
    const day = r.to.day !== r.from.day ? `第 ${esc(r.from.day)} 天 ${clock(r.from.clock)} → 第 ${esc(r.to.day)} 天 ${clock(r.to.clock)}` : `${clock(r.from.clock)} → ${clock(r.to.clock)}`;
    const supply = r.ok ? (r.forced ? "主持人安排的休息，不扣补给" : `消耗 ${esc(r.water)} ml 水、${esc(r.food)} 份食物`) : "补给不够，只能硬撑着消磨时间：没有恢复";
    const ex = r.exhaust && r.exhaust[0] !== r.exhaust[1] ? `${EXHAUST[r.exhaust[0]] || ""} → ${EXHAUST[r.exhaust[1]] || ""}` : (EXHAUST[(r.exhaust || [0])[1]] || "");
    const ambush = r.ambush ? `<p class="rr-line rr-bad">${esc(r.ambush.text || "休息前被偷袭了")}</p>` : "";
    return `<div class="rr-card" role="document">
      <header><h2>${r.ok ? "长休结束" : "没能好好休息"}</h2><span class="rr-time">${day} · ${esc(r.hours)} 小时</span></header>
      ${ambush}
      <p class="rr-line">${supply} · ${esc(ex)}${r.watch ? ` · <span class="rr-bad">${esc(r.watch)} 守夜</span>` : ""}</p>
      <ul class="rr-list">${(r.heroes || []).map(h => heroRow(h, gm)).join("")}</ul>
      <footer><button type="button" class="g-btn r-main" data-rr="close">好</button></footer>
    </div>`;
  }
  let box = null;
  function show(r, opt) {
    if (!r || typeof document === "undefined") return;
    if (!box) {
      box = document.createElement("section");
      box.id = "rest-report"; box.className = "rr-overlay"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "长休结算");
      box.addEventListener("click", e => { if (e.target === box || e.target.closest('[data-rr="close"]')) box.hidden = true; });
      box.addEventListener("keydown", e => { if (e.key === "Escape") box.hidden = true; });
      document.body.appendChild(box);
    }
    box.innerHTML = html(r, opt);
    box.hidden = false;
    box.querySelector('[data-rr="close"]')?.focus({ preventScroll: true });
  }
  root.RestReport = { html, show };
})(typeof globalThis !== "undefined" ? globalThis : window);
