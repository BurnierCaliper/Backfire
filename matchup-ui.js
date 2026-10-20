/* 克制表（属性 × 血量层）浮层：战斗顶栏「克制表」随时能开，不打断回合（只读，不碰 GAME 的选技能 / 选目标状态）。
 * 数据：matchup.js 的纯函数 matchupChart(weather, opt)（也挂在 Rogue.matchupChart）；联机玩家读房主发来的 view.matchup。
 * 没有数据接口时按钮不出现（available() = false），不自己算一份规则。
 *   表头：当前天气、相位阶段、恶劣环境 / 末日倍数（≠1 时）、冻土（跟随当前选中单位所在区域）
 *   行 = 属性（带整行天气增减伤 pct，和 pctBase 不同时写「原 → 现」），列 = 血量层
 *   格子按 adv 克制 / dis 抵抗 / neu 普通 上色；天气改过的格子高亮，写「原 → 现」，悬停 / 点开看原因
 *   下面列 notes */
(function (root) {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const PHASE = ["波谷", "平缓", "波峰"];
  /** 0.5 → +50%；−0.25 → −25%；0 → ±0 */
  function pct(v) {
    const n = Math.round((Number(v) || 0) * 1000) / 10;
    return n > 0 ? `+${n}%` : n < 0 ? `−${Math.abs(n)}%` : "±0";
  }
  const KIND_TEXT = { adv: "克制", dis: "抵抗", neu: "普通" };

  /** 取数据接口：matchupChart（matchup.js）或 Rogue.matchupChart；没有 → null */
  function chartFn() {
    if (typeof root.matchupChart === "function") return root.matchupChart;
    if (typeof matchupChart === "function") return matchupChart;   // eslint-disable-line no-undef
    const R = typeof Rogue !== "undefined" ? Rogue : root.Rogue;
    return R && typeof R.matchupChart === "function" ? R.matchupChart : null;
  }
  function available() { return !!chartFn(); }

  /** 本机战斗的参数：天气、相位、恶劣环境 / 末日倍数、选中单位所在区域是不是冻土（飞行单位不受冻土影响） */
  function battleOpts() {
    const st = root.state || (typeof state !== "undefined" ? state : null) || {};   // eslint-disable-line no-undef
    const G = root.GAME || {};
    const u = (st.units || []).find(x => x.id === G.actorId) || null;
    const field = u && st.fields ? st.fields[u.zone] || null : null;
    const envX = typeof root.envMult === "function" ? root.envMult(u) : (st.apocalypse ? 2 : 1);
    return { weather: st.weather || "none", opt: { envX, phaseStep: Number(st.phaseStep) || 0, field: { ice: !!(field && field.ice && !(u && u.flying)) } }, unitName: u ? u.name : "" };
  }
  /** 本机算一份；没有接口或出错 → null */
  function localChart(o) {
    const f = chartFn();
    if (!f) return null;
    o = o || battleOpts();
    // 表头要的相位阶段、冻土：接口返回里没有就用传进去的参数
    try { return Object.assign({ unitName: o.unitName || "", phaseStep: o.opt.phaseStep, field: o.opt.field }, f(o.weather, o.opt)); } catch (e) { return null; }
  }

  /** 整张卡片 HTML（纯函数） */
  function html(c, view) {
    view = view || ui;
    if (!c) return `<div class="mu-card ovl-card" role="dialog" aria-label="克制表"><header class="ws-head"><span class="ws-tape">克制表</span><span class="ws-sub">暂时没有数据</span><button type="button" class="g-btn ws-close" data-mu-close>关闭</button></header></div>`;
    const cols = c.cols || [], rows = c.rows || [];
    const phase = c.weather === "phase" && c.phaseStep != null ? ` · ${PHASE[c.phaseStep] || c.phaseStep}` : "";
    const tags = [
      `<span class="mu-tag mu-weather">天气 ${esc(c.weatherName || c.weather)}${esc(phase)}</span>`,
      Number(c.envX) && Number(c.envX) !== 1 ? `<span class="mu-tag mu-env">天气效果 ×${esc(c.envX)}（恶劣环境 / 末日）</span>` : "",
      c.field && c.field.ice ? `<span class="mu-tag mu-ice">冻土${c.unitName ? `（${esc(c.unitName)} 所在区域）` : ""}</span>` : ""
    ].join("");
    const sel = view.cell;
    const head = `<tr><th class="mu-corner">属性 \\ 血量</th><th class="mu-pct">整行增减伤</th>${cols.map(k => `<th class="mu-col mu-l-${esc(k.id)}">${esc(k.name)}</th>`).join("")}</tr>`;
    const body = rows.map((r, i) => {
      const pctCell = `<td class="mu-pct${r.pctBase != null && r.pctBase !== r.pct ? " changed" : ""}" title="${esc(r.pctReason || "")}">${r.pctBase != null && r.pctBase !== r.pct ? `<s>${pct(r.pctBase)}</s> → ` : ""}<b>${pct(r.pct)}</b></td>`;
      const cells = cols.map((k, j) => {
        const x = ((c.cells || [])[i] || [])[j] || {};
        const kind = x.kindId || "neu", on = sel && sel[0] === i && sel[1] === j;
        const tip = `${r.name} → ${k.name}：${KIND_TEXT[kind] || ""} ${pct(x.value)}${x.changed ? `（原 ${pct(x.base)}）` : ""}${x.reason ? " · " + x.reason : ""}`;
        return `<td class="mu-cell mu-${esc(kind)}${x.changed ? " changed" : ""}${on ? " sel" : ""}" data-mu-cell="${i}:${j}" tabindex="0" title="${esc(tip)}">
          ${x.changed ? `<s>${pct(x.base)}</s><span class="mu-arrow">→</span>` : ""}<b>${pct(x.value)}</b></td>`;
      }).join("");
      return `<tr><th class="mu-row mu-e-${esc(r.id)}">${esc(r.name)}</th>${pctCell}${cells}</tr>`;
    }).join("");
    let detail = "";
    if (sel) {
      const r = rows[sel[0]], k = cols[sel[1]], x = ((c.cells || [])[sel[0]] || [])[sel[1]];
      if (r && k && x) detail = `<p class="mu-detail"><b>${esc(r.name)} → ${esc(k.name)}</b>：${esc(KIND_TEXT[x.kindId] || "")} ${pct(x.value)}${x.changed ? `（原来 ${esc(KIND_TEXT[x.baseKind] || x.baseKind || "")} ${pct(x.base)}）` : ""}${x.reason ? ` · ${esc(x.reason)}` : ""}</p>`;
    }
    const notes = (c.notes || []).length ? `<ul class="mu-notes">${c.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : "";
    return `<div class="mu-card ovl-card" role="dialog" aria-label="克制表">
      <header class="ws-head"><span class="ws-tape">克制表</span><span class="ws-sub">${tags}</span>
        <button type="button" class="g-btn ws-close" data-mu-close aria-label="关闭">关闭</button></header>
      <p class="mu-legend"><span class="mu-adv">克制（多吃伤害）</span><span class="mu-dis">抵抗（少吃伤害）</span><span class="mu-neu">普通</span><span class="mu-chg">天气改过</span></p>
      <div class="mu-scroll"><table class="mu-grid">${head}${body}</table></div>
      ${detail}${notes}
    </div>`;
  }

  /* ---------- 浮层 ---------- */
  const ui = { cell: null };
  let box = null, getChart = null;
  function ensureBox() {
    if (box) return box;
    box = document.createElement("div");
    box.id = "mu-overlay"; box.className = "mu-overlay ovl"; box.hidden = true;
    box.addEventListener("click", e => {
      if (e.target === box || e.target.closest("[data-mu-close]")) return close();
      const t = e.target.closest("[data-mu-cell]");
      if (!t) return;
      const [i, j] = t.dataset.muCell.split(":").map(Number);
      ui.cell = ui.cell && ui.cell[0] === i && ui.cell[1] === j ? null : [i, j];
      refresh();
    });
    box.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      else if (e.key === "Enter" && e.target.dataset && e.target.dataset.muCell) e.target.click();
    });
    return box;
  }
  /** 战斗里挂在 #g-app 下（天气写在 #g-app[data-weather]，卡片的天气 ::before 才套得上）；别处挂在 body */
  function mount() {
    const app = document.getElementById("g-app");
    const parent = app && !app.hidden && document.body.dataset.screen === "battle" ? app : document.body;
    if (ensureBox().parentNode !== parent) parent.appendChild(box);
  }
  /** chart() 每次重画时取最新数据（天气、选中单位变了表跟着变） */
  function open(chart) { getChart = chart || (() => localChart()); ui.cell = null; mount(); box.hidden = false; refresh(); }
  function close() { if (box) box.hidden = true; getChart = null; }
  function isOpen() { return !!(box && !box.hidden); }
  function refresh() { if (isOpen() && getChart) box.innerHTML = html(getChart()); }
  function toggle(chart) { if (isOpen()) close(); else open(chart); }

  /* 战斗顶栏 #g-matchup / 单局顶栏 #r-matchup（单局画面没有天气：按常态） */
  function syncButtons() {
    const ok = available();
    ["g-matchup", "r-matchup"].forEach(id => { const b = typeof document !== "undefined" && document.getElementById(id); if (b) b.hidden = !ok; });
  }
  if (typeof document !== "undefined") {
    document.addEventListener("click", e => {
      if (!e.target.closest) return;
      if (e.target.closest("#g-matchup")) toggle(() => localChart());
      else if (e.target.closest("#r-matchup")) toggle(() => localChart({ weather: "none", opt: { envX: 1, phaseStep: 0, field: { ice: false } } }));
    });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", syncButtons); else syncButtons();
  }

  root.MatchupUI = { html, open, close, toggle, refresh, isOpen, available, localChart, battleOpts, pct, state: ui, syncButtons };
})(typeof window !== "undefined" ? window : globalThis);
