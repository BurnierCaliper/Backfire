/* 克制表（属性 × 血量层）浮层：暂停页面（Esc / 角上「菜单」，#298）里的「克制表」随时能开，不打断回合（只读，不碰 GAME 的选技能 / 选目标状态）。
 * 数据：matchup.js 的纯函数 matchupChart(weather, opt)（也挂在 Rogue.matchupChart）；联机玩家读房主发来的 view.matchup。
 * 没有数据接口时菜单里没有这一项（available() = false），不自己算一份规则。
 *   表头：当前天气、相位阶段、恶劣环境 / 末日倍数（≠1 时）、冻土（跟随当前选中单位所在区域）
 *   行 = 属性（带属性图标），列 = 血量层；整行的天气增减伤写在 notes（数据没写的这里补上）
 *   格子按 adv 克制 / dis 被克制 / neu 普通 上色；天气改过的格子照常上色，只写「原（删除线）→ 现」，悬停 / 点开看原因
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
  /* 显示名统一：谐波（数据里要是出现旧名「谐振」，界面这里改过来） */
  const NAME_FIX = { "谐振": "谐波" };
  const disp = n => NAME_FIX[n] || n;
  const elIcon = id => (root.Icons && typeof root.Icons.element === "function" ? root.Icons.element(id) : "");
  /** 整行的天气增减伤不再单列一栏：没写进 notes 的（例如相位 ±50%）补到 notes 里 */
  function allNotes(c) {
    const notes = (c.notes || []).slice();
    const has = t => notes.some(n => n.indexOf(t) >= 0);
    const groups = {};
    (c.rows || []).forEach(r => {
      if (!Number(r.pct)) return;
      const k = pct(r.pct);
      (groups[k] = groups[k] || []).push(disp(r.name));
    });
    const reasons = [...new Set((c.rows || []).filter(r => Number(r.pct) && r.pctReason).map(r => r.pctReason))];
    // 已经写在 notes 里的不重复：每条整行说明原文都在，或者相位（notes 里已有「相位…伤害」）
    const covered = (reasons.length && reasons.every(t => has(t))) || (c.weather === "phase" && notes.some(n => /相位/.test(n) && /伤害/.test(n)));
    const parts = Object.keys(groups).map(k => `${groups[k].join("、")} ${k}`);
    if (parts.length && !covered) notes.unshift(`${disp(c.weatherName || c.weather)}伤害修正：${parts.join("；")}${Number(c.envX) > 1 ? `（已含 ×${c.envX}）` : ""}`);
    if (c.iceLabel && !has(c.iceLabel)) notes.push(c.iceLabel);
    return notes.map(disp);
  }
  /** 一格实际的增减伤：克制 + 整行天气修正（相位 ±50% 等在整行 pct 里）。changed 按「原（base + pctBase）」和「现（value + pct）」比，
   *  不能只看格子的 changed（相位波峰 / 波谷时格子本身没变，整行变了） */
  function eff(x, r) {
    // 熔融的冰 ×2（row.mult）另外相乘：实际 = (1 + 克制 + 整行) × mult − 1
    const mult = Number(r && r.mult) || 1;
    const before = (Number(x.base) || 0) + (Number(r && r.pctBase) || 0), now = (1 + (Number(x.value) || 0) + (Number(r && r.pct) || 0)) * mult - 1;
    const changed = Math.abs(now - before) > 1e-9;
    const reasons = [x.changed && x.reason, Number(r && r.pct) !== Number(r && r.pctBase) && r.pctReason, mult !== 1 && (r.multReason || `伤害 ×${mult}`)].filter(Boolean);
    if (!changed && x.reason) reasons.push(x.reason);
    return { before, now, changed, reason: [...new Set(reasons)].join("；") };
  }
  const KIND_TEXT = { adv: "克制", dis: "被克制", neu: "普通" };   // 和 matchup.js · MATCHUP_KIND_CN 一致；数据里带了 kind 就用数据的

  /** 取数据接口：matchupChart（matchup.js）或 Rogue.matchupChart；没有 → null */
  function chartFn() {
    if (typeof root.matchupChart === "function") return root.matchupChart;
    if (typeof matchupChart === "function") return matchupChart;   // eslint-disable-line no-undef
    const R = typeof Rogue !== "undefined" ? Rogue : root.Rogue;
    return R && typeof R.matchupChart === "function" ? R.matchupChart : null;
  }
  function available() { return !!chartFn(); }

  const ST = () => root.state || (typeof state !== "undefined" ? state : null) || {};   // eslint-disable-line no-undef
  const forStateFn = () => (typeof root.matchupForState === "function" ? root.matchupForState : typeof matchupForState === "function" ? matchupForState : null);   // eslint-disable-line no-undef
  /** 本机战斗：按战场现状算（matchup.js · matchupForState），冻土 / 恶劣环境跟着「选中的」单位（GAME.actorId） */
  function localChart(unitId) {
    const fs = forStateFn();
    if (!fs) return null;
    const st = ST(), id = unitId !== undefined ? unitId : (root.GAME || {}).actorId || null;
    const u = (st.units || []).find(x => x && x.id === id);
    try { return Object.assign(fs(st, id), { unitName: u ? u.name : "" }); } catch (e) { return null; }
  }
  /** 改参数再算一次（界面切换用）：weather + opt（envX / field / phaseStep） */
  function chartWith(weather, opt) {
    const f = chartFn();
    if (!f) return null;
    try { return Object.assign(f(weather, opt || {}), { opt: opt || {} }); } catch (e) { return null; }
  }
  /** 联机玩家：房主发来的 matchup（按房主当前行动单位算）+ 玩家自己选中的单位。
   *  拿 m.opt，按选中单位所在区（view.state.fields）改冻土（飞行不算），本机用纯函数 matchupChart 重算；没有纯函数就照用房主的 */
  function viewChart(m, st, unitId) {
    if (!m) return null;
    st = st || {};
    const u = unitId ? (st.units || []).find(x => x && x.id === unitId) : null;
    // #83：房主按每个看得见的单位各算一份（作为受击者，含个体效果）；有就直接用
    const per = unitId && m.units && m.units[unitId];
    if (per) return Object.assign({}, per, { iceZones: per.iceZones || m.iceZones, iceLabel: per.iceLabel || m.iceLabel, unitName: per.unitName || (u && u.name) || "" });
    const f = chartFn();
    if (!u || !f) return m;
    const zf = (st.fields || {})[u.zone] || {};
    const opt = Object.assign({}, m.opt || {});
    if (!u.flying && zf.ice) opt.field = { ice: true }; else delete opt.field;
    const weather = zf.isolate ? "none" : (st.weather || m.weather || "none");
    if (weather === "phase" && opt.phaseStep == null) opt.phaseStep = Number(st.phaseStep) || 0;
    try { return Object.assign(f(weather, opt), { opt, unitId: u.id, zone: u.zone, unitName: u.name || "" }); } catch (e) { return m; }
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
      c.field && c.field.ice ? `<span class="mu-tag mu-ice">冻土${c.field.zone != null ? ` · ${esc(c.field.zone)}区` : c.zone != null ? ` · ${esc(c.zone)}区` : ""}</span>` : ""
    ].join("");
    const sel = view.cell;
    const head = `<tr><th class="mu-corner">属性 \\ 血量</th>${cols.map(k => `<th class="mu-col mu-l-${esc(k.id)}">${esc(k.name)}</th>`).join("")}</tr>`;
    const body = rows.map((r, i) => {
      const cells = cols.map((k, j) => {
        const x = ((c.cells || [])[i] || [])[j] || {};
        const kind = x.kindId || "neu", on = sel && sel[0] === i && sel[1] === j;
        const e = eff(x, r);
        const tip = `${disp(r.name)} → ${k.name}：${x.kind || KIND_TEXT[kind] || ""} ${pct(e.now)}${e.changed ? `（原 ${pct(e.before)}）` : ""}${e.reason ? " · " + e.reason : ""}`;
        return `<td class="mu-cell mu-${esc(kind)}${e.changed ? " changed" : ""}${on ? " sel" : ""}" data-mu-cell="${i}:${j}" tabindex="0" title="${esc(tip)}">
          ${e.changed ? `<s>${pct(e.before)}</s><span class="mu-arrow">→</span>` : ""}<b>${pct(e.now)}</b></td>`;
      }).join("");
      return `<tr><th class="mu-row mu-e-${esc(r.id)}">${elIcon(r.id)}<span>${esc(disp(r.name))}</span></th>${cells}</tr>`;
    }).join("");
    let detail = "";
    if (sel) {
      const r = rows[sel[0]], k = cols[sel[1]], x = ((c.cells || [])[sel[0]] || [])[sel[1]];
      const e = r && x ? eff(x, r) : null;
      if (r && k && x) detail = `<p class="mu-detail"><b>${esc(disp(r.name))} → ${esc(k.name)}</b>：${esc(x.kind || KIND_TEXT[x.kindId] || "")} ${pct(e.now)}${e.changed ? `（原来 ${esc(x.baseKind || "")} ${pct(e.before)}）` : ""}${e.reason ? ` · ${esc(e.reason)}` : ""}</p>`;
    }
    const nl = allNotes(c);
    const notes = nl.length ? `<ul class="mu-notes">${nl.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : "";
    return `<div class="mu-card ovl-card" role="dialog" aria-label="克制表">
      <header class="ws-head"><span class="ws-tape">克制表</span>${c.unitName ? `<span class="mu-who">${esc(disp(c.unitName))} 挨打时</span>` : ""}<span class="ws-sub">${tags}</span>
        <button type="button" class="g-btn ws-close" data-mu-close aria-label="关闭">关闭</button></header>
      <p class="mu-legend"><span class="mu-adv">克制</span><span class="mu-dis">被克制</span><span class="mu-neu">普通</span></p>
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

  /* 入口在暂停页面里（pause-menu.js，#298；以前是战斗顶栏 #g-matchup / 单局顶栏 #r-matchup）：
   * 战斗画面按战场现状算，单局画面没有天气按常态。联机玩家的那一项在 online-ui.js（读房主发来的 view.matchup） */
  const screenNow = () => (typeof document !== "undefined" && document.body ? document.body.dataset.screen : "");
  const onlinePlayer = () => typeof document !== "undefined" && !!document.body && document.body.classList.contains("online-player");
  function openFromMenu() {
    if (screenNow() === "run") open(() => chartWith("none", {}));
    else open(() => localChart());
  }
  if (root.PauseMenu) root.PauseMenu.register({ id: "matchup", visible: () => available() && !onlinePlayer() && ["battle", "run"].includes(screenNow()), run: openFromMenu });

  root.MatchupUI = { html, open, close, toggle, refresh, isOpen, available, localChart, chartWith, viewChart, allNotes, eff, pct, state: ui, openFromMenu };
})(typeof window !== "undefined" ? window : globalThis);
