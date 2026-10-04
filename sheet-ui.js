/* Antlerscale: Backfire · 角色资料面板 + 技能悬停说明
 * 数据来自 skill-text.js（SkillText.sheetData / heroSheet）。
 *
 *   HeroSheet.open(list, kit)        打开资料面板：list 是 SkillText 生成的角色资料数组，kit 是先看谁
 *   HeroSheet.openField(kit)         按当前战场 / 跑团队伍（state.units）打开
 *   HeroSheet.register(src, fn)      页面登记自己的数据来源（单局：Rogue.sheetData(run)）
 *   HeroSheet.tip(el, html) / hideTip()   技能按钮的悬停说明浮窗
 * 页面里任何带 data-sheet="kit" 的元素点一下就打开；data-sheet-src 指定数据来源（默认 field）。 */
(function (root) {
  "use strict";
  const sources = { field: () => (root.SkillText ? SkillText.sheetData() : []) };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ATTR = [["str", "力量"], ["con", "体质"], ["dex", "敏捷"], ["wil", "意志"], ["int", "智力"], ["sta", "耐力"]];
  let box = null, list = [], cur = null;

  function ensure() {
    if (box) return box;
    box = document.createElement("div");
    box.className = "sheet hs-sheet";
    box.id = "hero-sheet";
    box.innerHTML = `<div class="sheet-card wide hs-card" role="dialog" aria-label="角色资料">
      <div class="sheet-head"><h3>角色资料</h3><button class="g-btn" id="hs-close">关闭</button></div>
      <div class="hs-tabs" id="hs-tabs"></div>
      <div class="hs-body" id="hs-body"></div></div>`;
    document.body.appendChild(box);
    box.addEventListener("click", (e) => {
      if (e.target === box || e.target.id === "hs-close") close();
      const t = e.target.closest("[data-hs-kit]");
      if (t) { cur = t.dataset.hsKit; paint(); }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && box.classList.contains("show")) { e.stopPropagation(); close(); } }, true);
    return box;
  }
  function close() { if (box) box.classList.remove("show"); }

  function layersText(layers) {
    return (layers || []).map(l => `<span class="hs-layer hs-${esc(l.type)}">${esc(l.name)} <b>${l.cur}</b>/${l.max}</span>`).join("");
  }
  function skillsHtml(sk) {
    if (!sk) return "";
    const row = (s, locked) => `<div class="hs-skill${locked ? " locked" : ""}">
      <div class="hs-sk-top"><b>${esc(s.name)}</b><span class="hs-cost">${esc(s.cost)}</span>${locked ? `<span class="hs-lv">Lv${s.minLv} 解锁</span>` : ""}</div>
      <p>${esc(s.text)}</p></div>`;
    return sk.now.map(s => row(s, false)).join("") + sk.later.map(s => row(s, true)).join("");
  }
  function blockText(b, unarmed) {
    if (!b) return "—";
    const extra = b.extra ? ` + 引擎 ${b.extra}%` : "";
    return `<b>${b.total}%</b> <small>= 空手 ${b.bare}%（敏捷 ${b.dex}）${unarmed ? "，空手中" : ` + 武器 ${b.weapon}%`}${extra}</small>`;
  }
  function heroHtml(h) {
    const roles = h.roles.map(r => `${r.label} ${esc(r.role)}`).join(" · ");
    const attrs = ATTR.map(([k, n]) => `<div class="hs-attr"><span>${n}</span><b>${h.attrs[k] != null ? h.attrs[k] : "—"}</b></div>`).join("");
    const passives = h.passives.map(p => `<div class="hs-pass"><b>${esc(p.name)}</b><p>${esc(p.text)}</p></div>`).join("");
    const weapons = h.weapons.map(w => `<section class="hs-weapon">
        <h4>${esc(w.name)} <small>Lv${w.level} · 武器人${w.out ? " · 在场" : ""}</small></h4>
        <div class="hs-stats">
          <div><span>atk</span><b>${w.atk}</b></div>
          <div><span>架势</span><b>${w.def != null ? w.def : "—"}</b></div>
          <div><span>耐久</span><b>${w.durability != null ? w.durability : "—"}</b></div>
          <div><span>持在手里提供格挡</span><b>+${w.blockBonus}%</b></div>
          <div><span>独立协助格挡</span><b>${w.blockAlone != null ? w.blockAlone + "%" : "—"}</b></div>
        </div>
        <div class="hs-layers">${layersText(w.layers)}</div>
        ${w.growth ? `<p class="hs-note">${esc(w.growth)}</p>` : ""}
        ${w.passives.map(p => `<div class="hs-pass"><b>${esc(p.name)}</b><p>${esc(p.text)}</p></div>`).join("")}
        ${w.assistBlock ? `<div class="hs-pass"><b>协助格挡 · ${w.blockAlone != null ? w.blockAlone + "%" : ""}</b><p>${esc(w.assistBlock)}</p></div>` : ""}
        <h5>技能</h5>${skillsHtml(w.skills)}
      </section>`).join("");
    return `<div class="hs-hero">
      <div class="hs-title"><b>${esc(h.name)}</b>${h.enName && h.enName !== h.name ? `<small>${esc(h.enName)}</small>` : ""}
        <span>Lv${h.level} · 经验 ${h.xp}/${h.xpNext || "满"}${h.attrPoints ? ` · 待分配属性点 ${h.attrPoints}` : ""}</span></div>
      <p class="hs-sub">${esc([h.race, h.job].filter(Boolean).join(" · "))}${roles ? " · " + esc(roles) : ""}</p>
      ${h.status ? `<p class="hs-sub">当前：${esc(h.status)}</p>` : ""}
      <div class="hs-stats">
        <div><span>atk</span><b>${h.atk}</b><small>${h.personalAtk} 角色${h.weaponAtk ? ` + ${h.weaponAtk} 武器` : ""}</small></div>
        <div><span>架势</span><b>${h.def}/${h.defMax}</b></div>
        <div><span>坚毅生命</span><b>${h.shp != null ? h.shp : "—"}/${h.shpMax != null ? h.shpMax : "—"}</b></div>
        <div><span>义体改造率</span><b>${h.cyber != null ? h.cyber + "%" : "—"}</b></div>
        <div class="wide"><span>协助格挡</span>${blockText(h.block, h.unarmed)}</div>
        <div class="wide"><span>长休消耗</span><b>${h.rest ? `${h.rest.water} ml 水 · ${h.rest.food} 份食物` : "—"}</b></div>
      </div>
      <div class="hs-layers">${layersText(h.layers)}</div>
      <div class="hs-attrs">${attrs}</div>
      <h5>被动</h5>${passives || '<p class="hs-note">无</p>'}
      ${h.assistAttack ? `<div class="hs-pass"><b>协助攻击</b><p>${esc(h.assistAttack)}</p></div>` : ""}
      <div class="hs-pass"><b>协助格挡 · ${h.block ? h.block.total + "%" : ""}</b><p>${esc(h.assistBlock || "")}${h.assistBlock ? " " : ""}成功率 = 空手格挡（30% +（敏捷 − 5）× 5%，15%–50%）+ 手里武器的格挡加成。</p></div>
      <h5>技能</h5>${skillsHtml(h.skills)}
      ${weapons}
    </div>`;
  }
  function paint() {
    ensure();
    const tabs = box.querySelector("#hs-tabs");
    tabs.innerHTML = list.map(h => `<button class="g-btn${h.kit === cur ? " on" : ""}" data-hs-kit="${esc(h.kit)}">${esc(h.name)}</button>`).join("");
    const h = list.find(x => x.kit === cur) || list[0];
    box.querySelector("#hs-body").innerHTML = h ? heroHtml(h) : '<p class="sheet-empty">队伍里还没有角色。</p>';
    box.querySelector("#hs-body").scrollTop = 0;
  }
  function open(data, kit) {
    list = Array.isArray(data) ? data : [];
    cur = kit && list.some(h => h.kit === kit) ? kit : (list[0] && list[0].kit);
    // 点的是武器人：打开主人那一页
    if (kit && !list.some(h => h.kit === kit)) {
      const owner = list.find(h => h.weapons.some(w => w.kit === kit));
      if (owner) cur = owner.kit;
    }
    paint();
    box.classList.add("show");
  }
  function openFrom(src, kit) {
    let data = [];
    try { data = (sources[src] || sources.field)() || []; } catch (e) { data = []; }
    open(data, kit);
  }
  function register(src, fn) { sources[src] = fn; }

  /* ---------- 技能悬停说明 ---------- */
  let tipEl = null;
  function tip(anchor, html) {
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.className = "sk-tip";
      tipEl.setAttribute("role", "tooltip");
      document.body.appendChild(tipEl);
    }
    tipEl.innerHTML = html;
    tipEl.classList.add("show");
    const r = anchor.getBoundingClientRect();
    const w = Math.min(360, window.innerWidth - 16);
    tipEl.style.width = w + "px";
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    tipEl.style.left = left + "px";
    const h = tipEl.offsetHeight;
    const top = r.top - h - 8 >= 8 ? r.top - h - 8 : r.bottom + 8;
    tipEl.style.top = Math.max(8, top) + "px";
  }
  function hideTip() { if (tipEl) tipEl.classList.remove("show"); }
  /** 技能悬停浮窗的内容 */
  function skillTipHtml(sk, why) {
    const text = (root.SkillText && SkillText.skillText(sk.id)) || sk.hint || "";
    const cost = root.SkillText ? SkillText.skillCostText(sk.id) : "";
    return `<div class="sk-tip-top"><b>${esc(sk.name)}</b>${cost ? `<span>${esc(cost)}</span>` : ""}</div>
      <p>${esc(text)}</p>${sk.hint && text !== sk.hint ? `<p class="sk-tip-short">${esc(sk.hint)}</p>` : ""}${why ? `<p class="sk-tip-why">${esc(why)}</p>` : ""}`;
  }

  if (typeof document !== "undefined") {
    document.addEventListener("click", (e) => {
      const t = e.target.closest && e.target.closest("[data-sheet]");
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      openFrom(t.dataset.sheetSrc || "field", t.dataset.sheet);
    }, true);
  }

  root.HeroSheet = { open, openFrom, openField: (kit) => openFrom("field", kit), register, close, tip, hideTip, skillTipHtml, heroHtml };
})(window);
