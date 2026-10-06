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
    const passives = h.passives.map((p, i) => `<div class="hs-pass${p.plus ? " plus" : ""}"><b>${esc(p.name)}</b><p>${esc(p.text)}</p>${!p.plus && p.next ? `<p class="hs-note">武器 ${i === 0 ? 5 : 10} 级时升级为「${esc(p.name)}+」：${esc(p.next)}</p>` : ""}</div>`).join("");
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

/* ---------- 整局战场记录（LEDGER.career，ledger.js · careerRecordBattle） ----------
 * 单局：本局所有战斗；跑团：这个存档空位所有战斗。页面上带 data-career 的元素点一下就打开。 */
(function (root) {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const COLS = [["battles", "出场"], ["dmg", "造成伤害"], ["share", "输出占比"], ["brk", "击破"], ["staggers", "打出失衡"], ["kills", "击杀"],
    ["assists", "协助攻击"], ["blocks", "协助格挡"], ["avoided", "格挡规避伤害"], ["reduced", "减伤减免"], ["taken", "承受伤害"], ["takenShare", "承伤占比"], ["heal", "治疗 / 护盾"], ["score", "得分"]];
  const OUT = { win: "胜利", lose: "战败", retreat: "撤退" };
  let box = null;
  const n = (v) => Math.round(Number(v) || 0);
  function cell(r, k) {
    if (k === "share" || k === "takenShare") return (Number(r[k]) || 0).toFixed(1) + "%";
    if (k === "blocks") return `${n(r.blockOk)}/${n(r.blocks)}`;
    return String(n(r[k]));
  }
  function rowsOf(c) {
    const kits = Object.keys(c.kits || {}).map(k => c.kits[k]);
    const heroes = kits.filter(r => !r.weaponOf);
    const out = [];
    heroes.forEach(h => {
      out.push(Object.assign({ sub: false }, h));
      kits.filter(w => w.weaponOf === h.kit).forEach(w => out.push(Object.assign({ sub: true }, w)));
    });
    kits.filter(w => w.weaponOf && !heroes.some(h => h.kit === w.weaponOf)).forEach(w => out.push(Object.assign({ sub: true }, w)));
    const dmg = out.reduce((a, r) => a + n(r.dmg), 0), taken = out.reduce((a, r) => a + n(r.taken), 0);
    out.forEach(r => {
      r.share = dmg > 0 ? n(r.dmg) / dmg * 100 : 0;
      r.takenShare = taken > 0 ? n(r.taken) / taken * 100 : 0;
    });
    return out;
  }
  function html() {
    const c = typeof careerData === "function" ? careerData() : { battles: [], kits: {} };
    const battles = c.battles || [];
    if (!battles.length) return `<p class="sheet-empty">这一局还没有打过仗。打完一场战斗后，这里会累计每个角色的输出和团队贡献。</p>`;
    const rows = rowsOf(c);
    const tot = {};
    ["dmg", "brk", "staggers", "kills", "assists", "blocks", "blockOk", "avoided", "reduced", "taken", "heal", "score"].forEach(k => { tot[k] = rows.reduce((a, r) => a + n(r[k]), 0); });
    const cnt = (o) => battles.filter(b => b.outcome === o).length;
    const best = {}; COLS.forEach(([k]) => { best[k] = Math.max(0, ...rows.map(r => Number(r[k]) || 0)); });
    const tiles = [["战斗场数", `${battles.length}`, `胜 ${cnt("win")} · 败 ${cnt("lose")} · 撤 ${cnt("retreat")}`],
      ["全队造成伤害", tot.dmg, `击杀 ${tot.kills}`], ["全队击破", tot.brk, `打出失衡 ${tot.staggers} 次`],
      ["协助攻击", tot.assists, ""], ["协助格挡", `${tot.blockOk}/${tot.blocks}`, `规避伤害 ${tot.avoided}`],
      ["全队承受伤害", tot.taken, `减伤减免 ${tot.reduced} · 治疗 / 护盾 ${tot.heal}`], ["总得分", tot.score, ""]];
    const bars = rows.filter(r => !r.sub || n(r.dmg) > 0).map(r =>
      `<div class="cl-bar"><span class="cl-bar-name">${r.sub ? "└ " : ""}${esc(r.name)}</span><span class="cl-bar-track"><i style="width:${Math.max(0, Math.min(100, r.share)).toFixed(1)}%"></i></span><b>${r.share.toFixed(1)}%</b></div>`).join("");
    const hist = battles.slice().reverse().map(b => `<tr class="cl-${esc(b.outcome)}"><td>#${b.no}</td><td>${esc(b.when || "")}</td><td>${OUT[b.outcome] || esc(b.outcome)}</td><td>${b.turns} 回合</td>
      <td>${b.grade ? `${esc(b.grade)} · ${n(b.score)} 分` : "—"}</td><td>${n(b.teamDmg)}</td><td>${b.mvp ? `${esc(b.mvp.name)}（${n(b.mvp.dmg)}）` : "—"}</td></tr>`).join("");
    return `<div class="cl-tiles">${tiles.map(([k, v, sub]) => `<div><span>${k}</span><b>${esc(v)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div>`).join("")}</div>
      <h5 class="cl-h">输出占比</h5><div class="cl-bars">${bars}</div>
      <h5 class="cl-h">每个角色</h5>
      <div class="stats-scroll"><table class="stats-table">
        <thead><tr><th>角色</th>${COLS.map(([, t]) => `<th>${t}</th>`).join("")}</tr></thead>
        <tbody>${rows.map(r => `<tr class="${r.sub ? "sub" : ""}"><td>${r.sub ? "└ " : ""}${esc(r.name)}${r.sub ? "<small>武器人</small>" : ""}</td>
          ${COLS.map(([k]) => `<td class="${!r.sub || k !== "battles" ? (best[k] > 0 && Number(r[k]) === best[k] ? "top" : "") : ""}">${r.sub && k === "battles" ? "—" : cell(r, k)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>
      <h5 class="cl-h">每场战斗</h5>
      <div class="stats-scroll"><table class="stats-table cl-hist"><thead><tr><th>场次</th><th>时间</th><th>结果</th><th>回合</th><th>评价</th><th>全队伤害</th><th>输出最高</th></tr></thead><tbody>${hist}</tbody></table></div>
      <p class="stats-note">从这一局（跑团：这个存档空位）的第一场战斗开始累计，跟着存档走；新开一局 / 重新开团时清空。输出占比按造成伤害算，承伤占比按承受伤害算。武器人分出去单独打的数据记在武器人那一行。</p>`;
  }
  function text() {
    const c = typeof careerData === "function" ? careerData() : { battles: [], kits: {} };
    const rows = rowsOf(c);
    return [`整局数据 · ${(c.battles || []).length} 场战斗`, "角色\t" + COLS.map(([, t]) => t).join("\t")]
      .concat(rows.map(r => (r.sub ? "  " + r.name + "（武器人）" : r.name) + "\t" + COLS.map(([k]) => (r.sub && k === "battles") ? "—" : cell(r, k)).join("\t"))).join("\n");
  }
  function open() {
    if (!box) {
      box = document.createElement("div");
      box.className = "sheet cl-sheet";
      box.id = "career-sheet";
      box.innerHTML = `<div class="sheet-card stats-card cl-card"><div class="sheet-head"><h3>整局数据</h3>
        <button class="g-btn small" id="cl-copy">复制</button><button class="g-btn" id="cl-close">关闭</button></div><div id="cl-body"></div></div>`;
      document.body.appendChild(box);
      box.addEventListener("click", (e) => {
        if (e.target === box || e.target.id === "cl-close") box.classList.remove("show");
        if (e.target.id === "cl-copy") { try { navigator.clipboard.writeText(text()); e.target.textContent = "已复制"; } catch (err) { /* 浏览器不让复制就算了 */ } }
      });
    }
    box.querySelector("#cl-body").innerHTML = html();
    box.classList.add("show");
  }
  if (typeof document !== "undefined") {
    document.addEventListener("click", (e) => {
      const t = e.target.closest && e.target.closest("[data-career]");
      if (!t) return;
      e.preventDefault();
      open();
    }, true);
  }
  root.CareerLog = { open, html, text };
})(window);
