/* Antlerscale: Backfire · 武器工坊（每个模式都能打开的武器页）
 * 数据来自 skill-text.js（SkillText.armoryData），单局用 Rogue.armoryData(run)。
 *
 *   Armory.open(list, kit)        打开：list 是 armoryData 的结果，kit 是先看哪把武器（填角色 kit 就看他手里那把）
 *   Armory.openFrom(src, kit)     按登记的数据来源打开（默认 field：当前战场 / 跑团队伍）
 *   Armory.register(src, fn)      页面登记自己的数据来源（单局：run）
 * 页面里任何带 data-armory="kit" 的元素点一下就打开；data-armory-src 指定数据来源。 */
(function (root) {
  "use strict";
  const sources = { field: () => (root.SkillText && SkillText.armoryData ? SkillText.armoryData() : []) };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v, d) => { const n = Number(v) || 0; return (Math.round(n * Math.pow(10, d || 2)) / Math.pow(10, d || 2)).toString(); };
  const signed = (v) => (v > 0 ? "+" : v < 0 ? "−" : "±") + num(Math.abs(v));
  let box = null, list = [], cur = null;

  function ensure() {
    if (box) return box;
    box = document.createElement("div");
    box.className = "sheet ar-sheet";
    box.id = "armory-sheet";
    box.innerHTML = `<div class="sheet-card wide ar-card" role="dialog" aria-label="武器工坊">
      <div class="ar-head">
        <div class="ar-brand"><span class="ar-tape">武器工坊</span><span class="ar-sub">WORKSHOP · 补正 / 改装 / 客制化</span></div>
        <button class="g-btn" id="ar-close">关闭</button>
      </div>
      <div class="ar-wrap"><nav class="ar-rack" id="ar-rack"></nav><div class="ar-body" id="ar-body"></div></div></div>`;
    document.body.appendChild(box);
    box.addEventListener("click", (e) => {
      if (e.target === box || e.target.id === "ar-close") close();
      const t = e.target.closest("[data-ar-kit]");
      if (t) { cur = t.dataset.arKit; paint(); }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && box.classList.contains("show")) { e.stopPropagation(); close(); } }, true);
    return box;
  }
  function close() { if (box) box.classList.remove("show"); }
  const weapons = () => list.flatMap(h => h.weapons);

  /* ---------- 各块 ---------- */
  function plate(w) {
    const tags = [];
    if (w.broken) tags.push('<span class="ar-chip bad">损坏</span>');
    if (w.held) tags.push('<span class="ar-chip">握在手里</span>');
    if (w.out) tags.push('<span class="ar-chip on">武器人在场</span>');
    if (!w.held && !w.out) tags.push('<span class="ar-chip dim">收着</span>');
    const notches = Array.from({ length: w.maxLevel }, (_, i) => {
      const L = i + 1, mark = w.track.find(x => x.lv === L);
      return `<i class="${L <= w.level ? "on" : ""}${mark ? " mark" : ""}" title="${mark ? esc(`Lv${L} · ${mark.text}`) : "Lv" + L}"><b>${L}</b></i>`;
    }).join("");
    return `<div class="ar-plate">
      <span class="ar-bolt tl"></span><span class="ar-bolt tr"></span><span class="ar-bolt bl"></span><span class="ar-bolt br"></span>
      <div class="ar-plate-top"><h4>${esc(w.name)}</h4><span class="ar-lv">LV<b>${w.level}</b></span></div>
      <div class="ar-plate-sub">${esc(w.ownerName)} 的武器 ${tags.join("")}</div>
      <div class="ar-notch">${notches}</div>
    </div>`;
  }
  function stats(w) {
    const layers = (w.layers || []).map(l => `${esc(l.name)} ${l.max}`).join(" · ") || "—";
    const cell = (k, v, small) => `<div><span>${k}</span><b>${v}</b>${small ? `<small>${small}</small>` : ""}</div>`;
    return `<div class="ar-stats">
      ${cell("武器 ATK", w.atk, `角色拿着：${w.personalAtk} + ${w.atk} = ${w.personalAtk + w.atk}`)}
      ${cell("架势", w.def != null ? w.def : "—", "武器人形态")}
      ${cell("耐久", w.durability != null ? `${w.durability}/${w.durMax}` : "—", w.durBase != null && w.durBase !== w.durMax ? `原本上限 ${w.durBase}` : "")}
      ${cell("持握格挡", `+${w.blockBonus}%`, "拿在手里加到协助格挡")}
      ${cell("独立格挡", w.blockAlone != null ? w.blockAlone + "%" : "—", "武器人自己协助格挡")}
      ${cell("血量层", "", layers)}
    </div>`;
  }
  /** atk 工单：和 growth.js · computeWeaponAtk 一样逐项算 */
  function ticket(w) {
    const b = w.breakdown;
    if (!b) return "";
    const flatLine = b.flat ? `<div class="ar-line"><span>改装件固定加成</span><b>+${b.flat}</b></div>` : "";
    if (!b.formula) return `<div class="ar-ticket"><div class="ar-line"><span>这把武器按成长表算</span><b>${b.base}</b></div>${flatLine}${b.flat ? `<div class="ar-line sum"><span>合计</span><b>${b.atk}</b></div>` : ""}</div>`;
    const rows = b.rows.map(r => {
      const src = r.partCoef ? `<small>（本体 ${num(r.baseCoef)} ${signed(r.partCoef)} 改装）</small>` : "";
      return `<div class="ar-line${r.coef < 0 ? " neg" : ""}"><span>${esc(r.name)} ${r.value} × 补正 ${num(r.coef)}${src} × 等级系数 ${num(b.tier)}</span><b>${signed(r.part)}</b></div>`;
    }).join("");
    return `<div class="ar-ticket">
      <div class="ar-ticket-h">ATK 工单 <small>基础 + 等级 + Σ(属性 × 补正) × 等级系数（0.5 × 等级）+ 改装件固定加成</small></div>
      <div class="ar-line"><span>基础</span><b>${b.base}</b></div>
      <div class="ar-line"><span>等级加成（Lv${w.level} − 1）</span><b>+${b.lvBase}</b></div>
      ${rows}
      ${b.flat ? `<div class="ar-line"><span>小计 ${num(b.raw)} → 四舍五入</span><b>${b.atk - b.flat}</b></div>${flatLine}` : ""}
      <div class="ar-line sum"><span>${b.flat ? "合计" : `合计 ${num(b.raw)} → 四舍五入`}</span><b>${b.atk}</b></div>
    </div>`;
  }
  /** 补正系数刻度：本体一段、改装件一段 */
  function gauges(w) {
    const b = w.breakdown;
    if (!b || !b.formula || !b.rows.length) return "";
    const max = Math.max(1, ...b.rows.map(r => Math.max(Math.abs(r.coef), Math.abs(r.baseCoef))));
    const pct = (v) => Math.min(50, Math.abs(v) / max * 50);
    return `<div class="ar-gauges">${b.rows.map(r => {
      const base = r.baseCoef, part = r.partCoef;
      const baseBar = base ? `<i class="g-base${base < 0 ? " neg" : ""}" style="${base < 0 ? "right:50%" : "left:50%"};width:${pct(base)}%"></i>` : "";
      // 改装段接在本体后面；方向和本体相反时从本体末端往回画
      let partBar = "";
      if (part) {
        const from = base, to = base + part;
        const lo = Math.min(from, to), hi = Math.max(from, to);
        const left = 50 + (lo / max) * 50, width = (hi - lo) / max * 50;
        partBar = `<i class="g-part${part < 0 ? " neg" : ""}" style="left:${Math.max(0, left)}%;width:${Math.min(100, width)}%"></i>`;
      }
      return `<div class="ar-gauge"><span class="ar-g-name">${esc(r.name)}</span>
        <div class="ar-g-track"><em></em>${baseBar}${partBar}</div>
        <span class="ar-g-val${r.coef < 0 ? " neg" : ""}">${num(r.coef)}${part ? `<small>${signed(part)}</small>` : ""}</span></div>`;
    }).join("")}
      <p class="ar-hint">深色：武器本体的补正；亮色：改装件带来的增减。负数是负补正（属性越高 atk 越低）。</p></div>`;
  }
  function sockets(w) {
    const filled = w.slots.map((s, i) => s
      ? `<div class="ar-socket full"><span class="ar-grade g-${esc(s.grade || "C")}">${esc(s.grade || "?")}</span>
          <b>${esc(s.name)}</b><small>槽 ${i + 1}</small><p>${esc(s.text)}</p></div>`
      : `<div class="ar-socket empty"><span class="ar-grade">—</span><b>空槽</b><small>槽 ${i + 1}</small><p>还没装改装件</p></div>`).join("");
    const locked = w.lockedSlots.map(L => `<div class="ar-socket locked"><span class="ar-grade">🔒</span><b>未开放</b><small>Lv${L}</small><p>武器升到 ${L} 级开放</p></div>`).join("");
    return `<div class="ar-sockets">${filled}${locked}</div>`;
  }
  function blueprint(w) {
    const bp = w.blueprint;
    if (!bp) return `<div class="ar-bp none"><p>没有装客制化图纸。单局模式里从工匠处领图纸，再找工匠装到武器上。</p></div>`;
    const rows = bp.effects.map(e => `<li class="${e.tone}"><span>${esc(e.k)}</span><b>${esc(e.v)}</b></li>`).join("");
    return `<div class="ar-bp">
      <div class="ar-bp-top"><span class="ar-tape small">${esc(bp.name)}</span>${bp.smith ? `<small>出自 ${esc(bp.smith)}</small>` : ""}</div>
      ${bp.text ? `<p class="ar-bp-text">图纸原文：${esc(bp.text)}</p>` : ""}
      <ul class="ar-fx">${rows || "<li><span>效果</span><b>—</b></li>"}</ul>
    </div>`;
  }
  function track(w) {
    return `<ol class="ar-track">${w.track.map(t => `<li class="${t.done ? "done" : ""}"><b>Lv${t.lv}</b><span>${esc(t.text)}</span><em>${t.done ? "已解锁" : "未解锁"}</em></li>`).join("")}</ol>`;
  }
  function weaponHtml(w) {
    return `${plate(w)}${stats(w)}
      <h5>武器补正</h5>${gauges(w)}${ticket(w)}
      <h5>改装槽</h5>${sockets(w)}
      <h5>客制化</h5>${blueprint(w)}
      <h5>成长节点</h5>${track(w)}`;
  }

  function paint() {
    ensure();
    const all = weapons();
    const w = all.find(x => x.kit === cur) || all[0];
    if (w) cur = w.kit;
    box.querySelector("#ar-rack").innerHTML = list.map(h => `<div class="ar-rack-group"><span>${esc(h.name)}</span>
      ${h.weapons.map(x => `<button class="ar-tag${x.kit === cur ? " on" : ""}${x.broken ? " bad" : ""}" data-ar-kit="${esc(x.kit)}"><b>${esc(x.name)}</b><small>Lv${x.level} · ATK ${x.atk}</small></button>`).join("")}</div>`).join("");
    const body = box.querySelector("#ar-body");
    body.innerHTML = w ? weaponHtml(w) : '<p class="sheet-empty">队伍里还没有武器。</p>';
    body.scrollTop = 0;
  }
  function open(data, kit) {
    if (window.Sfx) Sfx.ui("open");
    list = Array.isArray(data) ? data : [];
    const all = weapons();
    cur = null;
    if (kit) {
      if (all.some(w => w.kit === kit)) cur = kit;
      else {
        // 点的是角色：先看他手里那把，没有就看第一把
        const h = list.find(x => x.kit === kit);
        if (h && h.weapons.length) cur = (h.weapons.find(w => w.held) || h.weapons[0]).kit;
      }
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

  if (typeof document !== "undefined") {
    document.addEventListener("click", (e) => {
      const t = e.target.closest && e.target.closest("[data-armory]");
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      openFrom(t.dataset.armorySrc || "field", t.dataset.armory);
    }, true);
  }

  root.Armory = { open, openFrom, openField: (kit) => openFrom("field", kit), register, close, weaponHtml };
})(window);
