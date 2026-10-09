/* Antlerscale: Backfire · 图鉴（界面）：敌人 / 配置物 / 效果
 * Bestiary.open(opt) 打开全屏图鉴。opt.partySize：按几人队算血量（默认 4，界面上可以切）；
 * opt.mode：先打开哪一本（"enemy" 默认 / "prop" / "effect"）。
 * 配置物、效果图鉴是规则说明（数据在 codex.js），一直都能查，可以按分类筛、按关键词搜。
 * 左边是卡片墙（按 杂兵 / 精英 / 首领 筛），右边是选中敌人的详情：
 *   遭遇过 → 行动方式、能力、按等级和人数现算的血量 / 架势 / atk、遭遇记录；
 *   没遭遇过 → 「？？？」，只看得到阵营和出没区域。数据在 bestiary.js。 */
"use strict";
const Bestiary = (() => {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  const RANGE = { melee: "近距离", ranged: "远距离", any: "远近皆可" };
  let root = null, filter = "all", sel = null, lv = null, party = 4, sub = "";
  let mode = "enemy", query = "";
  const MODES = [["enemy", "敌人"], ["prop", "配置物"], ["effect", "效果"]];
  const codexSel = { prop: null, effect: null }, codexFilter = { prop: "all", effect: "all" };

  function build() {
    root = document.createElement("div");
    root.className = "bx";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "图鉴");
    root.innerHTML = `
      <div class="bx-frame">
        <header class="bx-head">
          <span class="bx-tag">图鉴</span>
          <h3>敌人图鉴</h3>
          <nav class="bx-modes" role="tablist">${MODES.map(([k, n]) => `<button role="tab" data-mode="${k}">${n}</button>`).join("")}</nav>
          <div class="bx-progress"><span class="bx-prog-text"></span><span class="bx-bar"><i></i></span></div>
          <span class="bx-spacer"></span>
          <button class="g-btn" data-bx="close">关闭</button>
        </header>
        <div class="bx-body">
          <section class="bx-list">
            <nav class="bx-tabs"></nav>
            <input class="bx-search" type="search" placeholder="搜索名字或效果文字（例：灼烧、击破、飞行）" aria-label="搜索">
            <div class="bx-grid"></div>
          </section>
          <aside class="bx-detail" aria-live="polite"></aside>
        </div>
      </div>`;
    document.body.appendChild(root);
    root.addEventListener("click", (e) => {
      if (e.target.closest('[data-bx="close"]') || e.target === root) { close(); return; }
      const md = e.target.closest("[data-mode]");
      if (md) { setMode(md.dataset.mode); return; }
      const tab = e.target.closest("[data-filter]");
      if (tab) { if (mode === "enemy") filter = tab.dataset.filter; else codexFilter[mode] = tab.dataset.filter; render(); return; }
      const cx = e.target.closest("[data-cx]");
      if (cx) { codexSel[mode] = cx.dataset.cx; render(); root.querySelector(".bx-detail").scrollTop = 0; return; }
      const card = e.target.closest("[data-kit]");
      if (card) { sel = card.dataset.kit; lv = null; render(); root.querySelector(".bx-detail").scrollTop = 0; return; }
      const ps = e.target.closest("[data-party]");
      if (ps) { party = Number(ps.dataset.party) || 4; root.querySelectorAll("[data-party]").forEach(b => b.classList.toggle("on", Number(b.dataset.party) === party)); renderStats(); }
    });
    root.addEventListener("input", (e) => {
      if (e.target.matches(".bx-search")) { query = e.target.value; render(); return; }
      if (e.target.matches("[data-lv]")) { lv = Number(e.target.value) || 1; e.target.nextElementSibling.textContent = lv; renderStats(); }
    });
    document.addEventListener("keydown", (e) => { if (root && root.classList.contains("show") && e.key === "Escape") { e.stopPropagation(); close(); } }, true);
  }

  function entries() { return typeof bestiaryEntries === "function" ? bestiaryEntries() : []; }

  function setMode(m) {
    if (!MODES.some(([k]) => k === m)) m = "enemy";
    mode = m;
    query = "";
    const box = root.querySelector(".bx-search");
    if (box) box.value = "";
    render();
    root.querySelector(".bx-detail").scrollTop = 0;
  }

  function render() {
    root.querySelectorAll("[data-mode]").forEach(b => { const on = b.dataset.mode === mode; b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
    root.querySelector(".bx-head h3").textContent = (MODES.find(([k]) => k === mode) || [, "敌人"])[1] + "图鉴";
    root.querySelector(".bx-search").hidden = mode === "enemy";
    root.querySelector(".bx-bar").hidden = mode !== "enemy";
    if (mode !== "enemy") { renderCodex(); return; }
    const all = entries();
    const seen = all.filter(e => e.seen).length;
    root.querySelector(".bx-prog-text").innerHTML = `已收录 <b>${seen}</b> / ${all.length}${sub ? ` · ${esc(sub)}` : ""}`;
    root.querySelector(".bx-bar i").style.width = (all.length ? seen / all.length * 100 : 0) + "%";
    const tabs = [["all", "全部"], ["minion", "杂兵"], ["elite", "精英"], ["boss", "首领"]];
    root.querySelector(".bx-tabs").innerHTML = tabs.map(([k, n]) => {
      const list = k === "all" ? all : all.filter(e => e.rank === k);
      return `<button class="bx-tab${filter === k ? " on" : ""}" data-filter="${k}">${n}<small>${list.filter(e => e.seen).length}/${list.length}</small></button>`;
    }).join("");
    const shown = filter === "all" ? all : all.filter(e => e.rank === filter);
    if (!sel || !all.some(e => e.kit === sel)) sel = (shown.find(e => e.seen) || shown[0] || {}).kit || null;
    root.querySelector(".bx-grid").innerHTML = shown.map(e => {
      const st = e.seen ? bestiaryStats(e.kit, e.rec && e.rec.maxLv || 1, party) : null;
      return `<button class="bx-card ${e.rank}${e.seen ? " seen" : " locked"}${e.kit === sel ? " sel" : ""}" data-kit="${esc(e.kit)}" aria-label="${esc(e.seen ? e.name : "未遭遇的敌人")}">
        <span class="bx-rank">${esc(e.rankName)}</span>
        ${e.seen
          ? `<span class="bx-sigil e-${esc(st ? st.element : "physical")}">${window.Icons ? Icons.element(st ? st.element : "physical") : ""}</span>
             <b class="bx-name">${esc(e.name)}</b>
             <small>${esc(e.faction || "—")}${e.rec ? ` · 遭遇 ${e.rec.met} 次` : ""}</small>`
          : `<span class="bx-sigil unknown">?</span>
             <b class="bx-name">？？？</b>
             <small>${esc(e.faction || "未知阵营")}</small>`}
      </button>`;
    }).join("") || `<p class="bx-empty">这一类还没有敌人。</p>`;
    renderDetail();
  }

  function renderDetail() {
    const box = root.querySelector(".bx-detail");
    const e = entries().find(x => x.kit === sel);
    if (!e) { box.innerHTML = ""; return; }
    root.querySelectorAll(".bx-card").forEach(c => c.classList.toggle("sel", c.dataset.kit === sel));
    const where = e.regions.length ? e.regions.join("、") : "不明";
    if (!e.seen) {
      box.innerHTML = `<div class="bx-d-locked">
          <div class="bx-kicker">${esc(e.rankName)} · 未遭遇</div>
          <h4>？？？</h4>
          <div class="bx-silhouette">?</div>
          <dl class="bx-facts"><dt>阵营</dt><dd>${esc(e.faction || "不明")}</dd><dt>出没</dt><dd>${esc(where)}</dd></dl>
          <p class="bx-hint">还没和它交过手，无法确认它的能力和数值。<br>遭遇它并打完一场战斗（胜利、落败、撤退都算）之后，这里会记下它的情报。</p>
        </div>`;
      return;
    }
    const rec = e.rec || {};
    const lvMax = 30;
    if (lv == null) lv = rec.maxLv || 1;
    const st = bestiaryStats(e.kit, lv, party);
    const t = e.text || {};
    box.innerHTML = `<div class="bx-d">
        <div class="bx-kicker">${esc(e.rankName)} · ${esc(e.faction || "—")}</div>
        <h4>${esc(e.name)}</h4>
        <div class="bx-chips">
          ${st ? `<span class="bx-chip e-${esc(st.element)}">${window.Icons ? Icons.element(st.element) : ""}${esc(st.elementName)}</span>
          <span class="bx-chip">${esc(RANGE[st.range] || st.range)}</span>${st.flying ? `<span class="bx-chip">飞行</span>` : ""}` : ""}
          <span class="bx-chip dim">出没：${esc(where)}</span>
        </div>
        <section class="bx-sec">
          <div class="bx-sec-h"><span>数值</span>
            <label class="bx-lv">Lv <input type="range" min="1" max="${lvMax}" value="${lv}" data-lv><b>${lv}</b></label>
            <span class="bx-party">${[2, 3, 4].map(n => `<button class="${n === party ? "on" : ""}" data-party="${n}">${n}人</button>`).join("")}</span>
          </div>
          <div class="bx-stats-wrap"></div>
        </section>
        ${t.move ? `<section class="bx-sec"><div class="bx-sec-h"><span>行动方式</span></div><p class="bx-move">${esc(t.move)}</p></section>` : ""}
        ${(t.abilities || []).length ? `<section class="bx-sec"><div class="bx-sec-h"><span>能力</span></div><ul class="bx-abil">${t.abilities.map(a => {
          const i = a.indexOf("：");
          return `<li>${i > 0 && i < 18 ? `<b>${esc(a.slice(0, i))}</b>${esc(a.slice(i))}` : esc(a)}</li>`;
        }).join("")}</ul></section>` : ""}
        <section class="bx-sec"><div class="bx-sec-h"><span>遭遇记录</span></div>
          <dl class="bx-facts">
            <dt>遭遇</dt><dd>${rec.met || 0} 场</dd>
            <dt>击倒</dt><dd>${rec.kills || 0} 只</dd>
            <dt>见过的等级</dt><dd>${rec.minLv != null ? (rec.minLv === rec.maxLv ? `Lv${rec.minLv}` : `Lv${rec.minLv}–${rec.maxLv}`) : "—"}</dd>
            <dt>首次遭遇</dt><dd>${rec.first ? new Date(rec.first).toLocaleDateString() : "—"}</dd>
          </dl>
        </section>
      </div>`;
    renderStats();
  }
  /** 数值那一块：按现在的等级、人数现算（拖等级条时只重画这一块） */
  function renderStats() {
    const wrap = root.querySelector(".bx-stats-wrap");
    const e = entries().find(x => x.kit === sel);
    if (!wrap || !e) return;
    const st = bestiaryStats(e.kit, lv, party);
    const total = st ? st.layers.reduce((a, l) => a + l.hp, 0) : 0;
    wrap.innerHTML = st ? `<div class="bx-stats">
        <div class="bx-layers">${st.layers.map(l => `<div class="bx-layer ${esc(l.type)}" style="flex:${Math.max(1, l.hp)}"><span>${esc(l.name)}</span><b>${l.hp}</b></div>`).join("")}</div>
        <div class="bx-nums">
          <div><small>血量合计</small><b>${total}</b></div>
          <div><small>架势</small><b>${st.def}</b></div>
          <div><small>atk</small><b>${st.atk}</b></div>
          ${st.dice ? `<div><small>伤害骰</small><b>${st.dice[0]}d${st.dice[1]}</b></div>` : ""}
        </div>
        <p class="bx-note">按 ${party} 人队、Lv${lv} 计算（和战斗里一样）。${esc(e.rankNote)}</p>
      </div>` : `<p class="bx-note">这个敌人的数值没法单独计算。</p>`;
  }

  /* ---------- 配置物 / 效果图鉴 ---------- */
  const PROP_TABS = [["all", "全部"], ["zone", "区域"], ["gap", "间隔"], ["skill", "技能产物"]];
  const eleIcon = (el) => (el && window.Icons ? Icons.element(el) : "");
  function codexList() {
    if (mode === "prop") return typeof codexPropEntries === "function" ? codexPropEntries() : [];
    return typeof codexEffectEntries === "function" ? codexEffectEntries() : [];
  }
  function codexTabs() {
    if (mode === "prop") return PROP_TABS;
    return [["all", "全部"]].concat((typeof CODEX_EFFECT_GROUPS !== "undefined" ? CODEX_EFFECT_GROUPS : []).map(g => [g.id, g.name]));
  }
  function renderCodex() {
    const all = codexList();
    const f = codexFilter[mode];
    const matched = all.filter(e => typeof codexMatch !== "function" || codexMatch(e, query));
    root.querySelector(".bx-prog-text").innerHTML = query.trim()
      ? `搜到 <b>${matched.length}</b> 条`
      : `共 <b>${all.length}</b> 条${mode === "prop" ? "配置物" : "效果"}`;
    root.querySelector(".bx-tabs").innerHTML = codexTabs().map(([k, n]) => {
      const c = k === "all" ? matched.length : matched.filter(e => e.group === k).length;
      return `<button class="bx-tab${f === k ? " on" : ""}" data-filter="${k}">${esc(n)}<small>${c}</small></button>`;
    }).join("");
    const shown = f === "all" ? matched : matched.filter(e => e.group === f);
    const key = (e) => e.id;
    if (!codexSel[mode] || !shown.some(e => key(e) === codexSel[mode])) codexSel[mode] = shown[0] ? key(shown[0]) : null;
    root.querySelector(".bx-grid").innerHTML = shown.map(e => {
      const kicker = mode === "prop" ? (e.source ? "技能产物" : e.place) : e.groupName;
      const el = e.element || null;
      return `<button class="bx-card cx seen${el ? " e-" + esc(el) : ""}${key(e) === codexSel[mode] ? " sel" : ""}" data-cx="${esc(key(e))}">
        <span class="bx-rank">${esc(kicker)}</span>
        ${el ? `<span class="bx-sigil e-${esc(el)}">${eleIcon(el)}</span>` : ""}
        <b class="bx-name">${esc(e.name)}</b>
        <small>${esc(codexBlurb(e))}</small>
      </button>`;
    }).join("") || `<p class="bx-empty">${query.trim() ? "没有符合搜索的条目。" : "这一类还没有条目。"}</p>`;
    renderCodexDetail(shown.find(e => key(e) === codexSel[mode]) || null);
  }
  /** 卡片上的一行摘要：说明第一句截短 */
  function codexBlurb(e) {
    const t = String((e.lines || [])[0] || "");
    return t.length > 26 ? t.slice(0, 25) + "…" : t;
  }
  function renderCodexDetail(e) {
    const box = root.querySelector(".bx-detail");
    if (!e) { box.innerHTML = ""; return; }
    const chips = [];
    if (e.element) chips.push(`<span class="bx-chip e-${esc(e.element)}">${eleIcon(e.element)}${esc(typeof ELE !== "undefined" ? ELE[e.element] : e.element)}属性</span>`);
    if (mode === "prop") {
      chips.push(`<span class="bx-chip">放置在${esc(e.place)}</span>`);
      if (e.movable) chips.push(`<span class="bx-chip">可以被移动</span>`);
      if (e.source) chips.push(`<span class="bx-chip dim">来源：${esc(e.source)}</span>`);
    } else {
      chips.push(`<span class="bx-chip dim">${esc(e.groupName)}</span>`);
    }
    const group = mode === "effect" && typeof CODEX_EFFECT_GROUPS !== "undefined" ? CODEX_EFFECT_GROUPS.find(g => g.id === e.group) : null;
    const lines = (e.lines || []).map(a => {
      const i = a.indexOf("：");
      return `<li>${i > 0 && i < 10 ? `<b>${esc(a.slice(0, i))}</b>${esc(a.slice(i))}` : esc(a)}</li>`;
    }).join("");
    const chart = e.chart ? `<section class="bx-sec"><div class="bx-sec-h"><span>${e.group === "element" ? "对各血量层" : "受各属性伤害"}</span></div>
        <div class="cx-chart">${e.chart.map(c => `<div class="cx-cell ${c.value > 0 ? "up" : c.value < 0 ? "down" : ""}">
          <small>${c.element ? `<span class="e-${esc(c.element)}">${eleIcon(c.element)}</span>` : ""}${esc(c.name)}</small><b>${typeof codexPct === "function" ? codexPct(c.value) : c.value}</b></div>`).join("")}</div>
        <p class="bx-note">正数是克制（伤害提高），负数是劣势（伤害降低）；和战斗里的克制表一致。</p></section>` : "";
    box.innerHTML = `<div class="bx-d">
        <div class="bx-kicker">${esc(mode === "prop" ? "配置物" : "效果")} · ${esc(mode === "prop" ? (e.source ? "技能产物" : e.place) : e.groupName)}</div>
        <h4>${esc(e.name)}</h4>
        <div class="bx-chips">${chips.join("")}</div>
        ${lines ? `<section class="bx-sec"><div class="bx-sec-h"><span>${mode === "prop" ? "说明" : "效果"}</span></div><ul class="bx-abil">${lines}</ul></section>` : ""}
        ${chart}
        ${group && group.note ? `<p class="bx-note cx-groupnote">${esc(group.name)}：${esc(group.note)}</p>` : ""}
      </div>`;
  }

  function open(opt) {
    opt = opt || {};
    if (!root) build();
    party = [2, 3, 4].includes(Number(opt.partySize)) ? Number(opt.partySize) : 4;
    sub = opt.sub || "";
    lv = null;
    mode = MODES.some(([k]) => k === opt.mode) ? opt.mode : "enemy";
    query = "";
    root.querySelector(".bx-search").value = "";
    render();
    root.classList.add("show");
    document.body.classList.add("bx-open");
    root.querySelector('[data-bx="close"]').focus({ preventScroll: true });
  }
  function close() {
    if (!root) return;
    root.classList.remove("show");
    document.body.classList.remove("bx-open");
  }
  return { open, close, isOpen: () => !!(root && root.classList.contains("show")) };
})();
if (typeof window !== "undefined") window.Bestiary = Bestiary;
