/* Antlerscale: Backfire · 敌人图鉴（界面）
 * Bestiary.open(opt) 打开全屏图鉴。opt.partySize：按几人队算血量（默认 4，界面上可以切）。
 * 左边是卡片墙（按 杂兵 / 精英 / 首领 筛），右边是选中敌人的详情：
 *   遭遇过 → 行动方式、能力、按等级和人数现算的血量 / 架势 / atk、遭遇记录；
 *   没遭遇过 → 「？？？」，只看得到阵营和出没区域。数据在 bestiary.js。 */
"use strict";
const Bestiary = (() => {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  const RANGE = { melee: "近距离", ranged: "远距离", any: "远近皆可" };
  let root = null, filter = "all", sel = null, lv = null, party = 4, sub = "";

  function build() {
    root = document.createElement("div");
    root.className = "bx";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "敌人图鉴");
    root.innerHTML = `
      <div class="bx-frame">
        <header class="bx-head">
          <span class="bx-tag">图鉴</span>
          <h3>敌人图鉴</h3>
          <div class="bx-progress"><span class="bx-prog-text"></span><span class="bx-bar"><i></i></span></div>
          <span class="bx-spacer"></span>
          <button class="g-btn" data-bx="close">关闭</button>
        </header>
        <div class="bx-body">
          <section class="bx-list">
            <nav class="bx-tabs"></nav>
            <div class="bx-grid"></div>
          </section>
          <aside class="bx-detail" aria-live="polite"></aside>
        </div>
      </div>`;
    document.body.appendChild(root);
    root.addEventListener("click", (e) => {
      if (e.target.closest('[data-bx="close"]') || e.target === root) { close(); return; }
      const tab = e.target.closest("[data-filter]");
      if (tab) { filter = tab.dataset.filter; render(); return; }
      const card = e.target.closest("[data-kit]");
      if (card) { sel = card.dataset.kit; lv = null; render(); root.querySelector(".bx-detail").scrollTop = 0; return; }
      const ps = e.target.closest("[data-party]");
      if (ps) { party = Number(ps.dataset.party) || 4; root.querySelectorAll("[data-party]").forEach(b => b.classList.toggle("on", Number(b.dataset.party) === party)); renderStats(); }
    });
    root.addEventListener("input", (e) => {
      if (e.target.matches("[data-lv]")) { lv = Number(e.target.value) || 1; e.target.nextElementSibling.textContent = lv; renderStats(); }
    });
    document.addEventListener("keydown", (e) => { if (root && root.classList.contains("show") && e.key === "Escape") { e.stopPropagation(); close(); } }, true);
  }

  function entries() { return typeof bestiaryEntries === "function" ? bestiaryEntries() : []; }

  function render() {
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

  function open(opt) {
    opt = opt || {};
    if (!root) build();
    party = [2, 3, 4].includes(Number(opt.partySize)) ? Number(opt.partySize) : 4;
    sub = opt.sub || "";
    lv = null;
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
