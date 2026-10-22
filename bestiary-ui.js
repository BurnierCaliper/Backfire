/* Antlerscale: Backfire · 图鉴（界面）：角色 / 专长 / 义体 / 敌人 / 配置物 / 效果 / 规则
 * Bestiary.open(opt) 打开全屏图鉴。opt.partySize：按几人队算血量（默认 4，界面上可以切）；
 * opt.mode：先打开哪一本（"enemy" 默认 / "hero" / "feat" / "cyber" / "prop" / "effect" / "rules"）。
 * 配置物、效果、义体图鉴是规则说明（数据在 codex.js），一直都能查，可以按分类筛、按关键词搜。
 * 义体图鉴只写固定的规则（可以写坚毅生命的具体消耗），不显示任何角色当前的坚毅生命。
 * 「规则」一本是规则说明页（章节在 rulebook.js）：按分类筛、能搜，详情按节画出列表、表格和说明。
 * 左边是卡片墙（按 杂兵 / 精英 / 首领 筛），右边是选中敌人的详情：
 *   遭遇过 → 行动方式、能力、按等级和人数现算的血量 / 架势 / atk、遭遇记录；
 *   没遭遇过 → 「？？？」，只看得到阵营和出没区域。数据在 bestiary.js。 */
"use strict";
const Bestiary = (() => {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  const RANGE = { melee: "近距离", ranged: "远距离", any: "远近皆可" };
  let root = null, filter = "all", sel = null, lv = null, party = 4, sub = "";
  let mode = "enemy", query = "";
  const MODES = [["hero", "角色"], ["feat", "专长"], ["cyber", "义体"], ["enemy", "敌人"], ["prop", "配置物"], ["effect", "效果"], ["rules", "规则"]];
  const SEARCH_HINT = { rules: "搜索规则（例：检定、atk、改造率、力竭）", other: "搜索名字或效果文字（例：灼烧、击破、飞行）" };
  let heroLv = 1;   // 角色图鉴：查看哪个等级的技能（默认 1 级，点别的等级才显示后面的技能，免得剧透）
  const codexSel = { hero: null, feat: null, cyber: null, prop: null, effect: null, rules: null }, codexFilter = { hero: "all", feat: "all", cyber: "all", prop: "all", effect: "all", rules: "all" };

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
            <input class="bx-search" type="search" placeholder="${SEARCH_HINT.other}" aria-label="搜索">
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
      const hl = e.target.closest("[data-hxlv]");
      if (hl) { heroLv = Number(hl.dataset.hxlv) || 1; render(); return; }
      if (cx) { if (codexSel[mode] !== cx.dataset.cx) heroLv = 1; codexSel[mode] = cx.dataset.cx; render(); root.querySelector(".bx-detail").scrollTop = 0; return; }
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
    root.querySelector(".bx-head h3").textContent = mode === "rules" ? "规则说明" : (MODES.find(([k]) => k === mode) || [, "敌人"])[1] + "图鉴";
    root.classList.toggle("bx-rules", mode === "rules");   // 规则正文多：详情栏放宽（bestiary.css）
    root.querySelector(".bx-search").hidden = mode === "enemy";
    root.querySelector(".bx-search").placeholder = mode === "rules" ? SEARCH_HINT.rules : SEARCH_HINT.other;
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
        ${dropsSection(e)}
        <section class="bx-sec"><div class="bx-sec-h"><span>遭遇记录</span></div>
          <dl class="bx-facts">
            <dt>遭遇</dt><dd>${rec.met || 0} 场</dd>
            ${e.race ? `<dt>种族</dt><dd>${esc(e.race)}${e.racesSeen.length && e.race.startsWith("随机") ? `<br><small>见过：${esc(e.racesSeen.join("、"))}</small>` : ""}${(e.racePerks || []).map(t => `<br><small>${esc(t)}</small>`).join("")}</dd>` : ""}
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
          ${st.dice ? `<div><small>伤害骰</small><b>${st.dice[0]}d${st.dice[1]}</b>${st.diceScale ? `<small>（基础骰，${esc(st.diceScale)}）</small>` : ""}</div>` : ""}
        </div>
        <p class="bx-note">按 ${party} 人队、Lv${lv} 计算（和战斗里一样）。${esc(e.rankNote)}</p>
      </div>` : `<p class="bx-note">这个敌人的数值没法单独计算。</p>`;
  }

  /* ---------- 掉落（items.js · ENEMY_DROPS → bestiary.js 的 e.drops）---------- */
  const TIER_NAME = { 0: "基础", 1: "常见", 2: "精制" };
  function matTier(id) {
    const m = typeof CRAFT_MATERIALS !== "undefined" ? CRAFT_MATERIALS.find(x => x.id === id) : null;
    return m ? m.tier : null;
  }
  /* 图鉴里不给玩家看具体掉率 / 份数（策划要求），只给模糊档位。
   * 期望份数 ≥ 1 → 「必掉」（有小数部分 → 「必掉，有时更多」）；
   * 否则按掉 1 份的概率分档：≥ 40% 常见，15%–40% 少见，< 15% 罕见。改档位只改这里。 */
  const DROP_RARITY = [[0.4, "常见"], [0.15, "少见"], [0, "罕见"]];
  /** 一条掉落的模糊说明（不含数字） */
  function dropChanceText(chance) {
    const p = Number(chance) || 0;
    if (p >= 1) return p - Math.floor(p) > 1e-9 ? "必掉，有时更多" : "必掉";
    return DROP_RARITY.find(([min]) => p >= min)[1];
  }
  /** 详情里的「可能掉落」一节（没登记掉落的敌人写「不掉制作材料」） */
  function dropsSection(e) {
    const drops = (e && e.drops) || [];
    const body = drops.length
      ? `<ul class="bx-drops">${drops.map(d => {
          const t = matTier(d.id);
          return `<li class="bx-drop t${t == null ? "" : t}"><b>${esc(d.name)}</b>${t != null ? `<span class="bx-chip dim">${TIER_NAME[t] || ""}</span>` : ""}<span class="bx-drop-p">${esc(dropChanceText(d.chance))}</span></li>`;
        }).join("")}</ul><p class="bx-note">打赢后，被打倒的敌人各自掷一次；材料进队伍公用背包。</p>`
      : `<p class="bx-note">不掉制作材料。</p>`;
    return `<section class="bx-sec bx-drops-sec"><div class="bx-sec-h"><span>可能掉落</span></div>${body}</section>`;
  }

  /* ---------- 配置物 / 效果图鉴 ---------- */
  const PROP_TABS = [["all", "全部"], ["zone", "区域"], ["gap", "间隔"], ["skill", "技能产物"]];
  const eleIcon = (el) => (el && window.Icons ? Icons.element(el) : "");
  function codexList() {
    if (mode === "hero") return typeof codexHeroEntries === "function" ? codexHeroEntries() : [];
    if (mode === "prop") return typeof codexPropEntries === "function" ? codexPropEntries() : [];
    if (mode === "feat") return typeof codexFeatEntries === "function" ? codexFeatEntries() : [];
    if (mode === "cyber") return typeof codexCyberwareEntries === "function" ? codexCyberwareEntries() : [];
    if (mode === "rules") return typeof rulebookEntries === "function" ? rulebookEntries() : [];
    return typeof codexEffectEntries === "function" ? codexEffectEntries() : [];
  }
  function codexTabs() {
    if (mode === "hero") return [["all", "全部"], ["easy", "入门 ★1–2"], ["mid", "进阶 ★3"], ["hard", "高手 ★4–5"]];
    if (mode === "prop") return PROP_TABS;
    if (mode === "feat") return [["all", "全部"], ["t1", "①7级"], ["t2", "②11级"], ["t3", "③13级"], ["t4", "④16级"]];
    // 义体：按种类分（codex.js · codexCyberwareGroups，加了新种类自动多一个标签）
    if (mode === "cyber") return [["all", "全部"]].concat((typeof codexCyberwareGroups === "function" ? codexCyberwareGroups() : []).map(g => [g.id, g.name]));
    if (mode === "rules") return [["all", "全部"]].concat((typeof RULEBOOK_GROUPS !== "undefined" ? RULEBOOK_GROUPS : []).map(g => [g.id, g.name]));
    return [["all", "全部"]].concat((typeof CODEX_EFFECT_GROUPS !== "undefined" ? CODEX_EFFECT_GROUPS : []).map(g => [g.id, g.name]));
  }
  function renderCodex() {
    const all = codexList();
    const f = codexFilter[mode];
    const matched = all.filter(e => typeof codexMatch !== "function" || codexMatch(e, query));
    root.querySelector(".bx-prog-text").innerHTML = query.trim()
      ? `搜到 <b>${matched.length}</b> 条`
      : `共 <b>${all.length}</b> ${mode === "hero" ? "名角色" : mode === "feat" ? "项专长" : mode === "cyber" ? "件义体" : mode === "prop" ? "种配置物" : mode === "rules" ? "章规则" : "条效果"}`;
    root.querySelector(".bx-tabs").innerHTML = codexTabs().map(([k, n]) => {
      const c = k === "all" ? matched.length : matched.filter(e => e.group === k).length;
      return `<button class="bx-tab${f === k ? " on" : ""}" data-filter="${k}">${esc(n)}<small>${c}</small></button>`;
    }).join("");
    const shown = f === "all" ? matched : matched.filter(e => e.group === f);
    const key = (e) => e.id;
    if (!codexSel[mode] || !shown.some(e => key(e) === codexSel[mode])) codexSel[mode] = shown[0] ? key(shown[0]) : null;
    if (mode === "hero") {
      root.querySelector(".bx-grid").innerHTML = shown.map(e => `<button class="bx-card cx hero${e.id === codexSel.hero ? " sel" : ""}" data-cx="${esc(e.id)}">
          <span class="bx-rank hx-stars" aria-label="难度 ${e.stars} 星">${starText(e.stars)}</span>
          <b class="bx-name">${esc(e.name)}</b>
          <small>${esc([e.race, e.job].filter(Boolean).join(" · "))}</small>
        </button>`).join("") || `<p class="bx-empty">没有符合搜索的角色。</p>`;
      renderHeroDetail(shown.find(e => e.id === codexSel.hero) || null);
      return;
    }
    root.querySelector(".bx-grid").innerHTML = shown.map(e => {
      const kicker = mode === "prop" ? (e.source ? "技能产物" : e.place) : mode === "feat" ? `专长 · ${e.kindName}` : mode === "cyber" ? `${e.kindName} · ${e.tier} 级` : e.groupName;
      const el = e.element || null;
      return `<button class="bx-card cx seen${el ? " e-" + esc(el) : ""}${key(e) === codexSel[mode] ? " sel" : ""}" data-cx="${esc(key(e))}">
        <span class="bx-rank">${esc(kicker)}</span>
        ${el ? `<span class="bx-sigil e-${esc(el)}">${eleIcon(el)}</span>` : ""}
        <b class="bx-name">${esc(e.name)}</b>
        <small>${esc(mode === "cyber" && e.short ? e.short : codexBlurb(e))}</small>
      </button>`;
    }).join("") || `<p class="bx-empty">${query.trim() ? "没有符合搜索的条目。" : "这一类还没有条目。"}</p>`;
    renderCodexDetail(shown.find(e => key(e) === codexSel[mode]) || null);
  }
  const starText = (n) => "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
  const ATTR_CN = [["str", "力量"], ["con", "体质"], ["dex", "敏捷"], ["wil", "意志"], ["int", "智力"], ["sta", "耐力"]];
  function textItem(name, text, extra) {
    return `<li><b>${esc(name)}</b>${extra ? ` <span class="hx-tag">${esc(extra)}</span>` : ""}<br>${esc(text)}</li>`;
  }
  function layerBar(layers) {
    return `<div class="bx-layers">${(layers || []).map(l => `<div class="bx-layer ${esc(l.type)}" style="flex:${Math.max(1, l.max)}"><span>${esc(l.name)}</span><b>${l.max}</b></div>`).join("")}</div>`;
  }
  function renderHeroDetail(e) {
    const box = root.querySelector(".bx-detail");
    if (!e) { box.innerHTML = ""; return; }
    const s = e.sheet;
    const sec = (title, body) => body ? `<section class="bx-sec"><div class="bx-sec-h"><span>${title}</span></div>${body}</section>` : "";
    const profs = Object.keys(e.profs || {}).map(k => `${k}${e.profs[k] > 1 ? " ×" + e.profs[k] : ""}`).join("、");
    let body = "";
    if (s) {
      const blk = s.block && s.block.total != null ? s.block.total + "%" : "—";
      body += sec("基础数值（Lv1）", `${layerBar(s.layers)}
        <div class="bx-nums">
          <div><small>atk</small><b>${s.atk}</b></div>
          ${typeof shpHidden === "function" && shpHidden() ? "" : `<div><small>坚毅生命</small><b>${s.shpMax != null ? s.shpMax : "—"}</b></div>`}
          <div><small>架势</small><b>${s.defMax}</b></div>
          <div><small>协助格挡</small><b>${blk}</b></div>
        </div>
        <dl class="bx-facts hx-attrs">${ATTR_CN.map(([k, n]) => `<dt>${n}</dt><dd>${s.attrs[k] != null ? s.attrs[k] : "—"}</dd>`).join("")}</dl>
        <p class="bx-note">atk = 角色 ${s.personalAtk} + 武器 ${s.weaponAtk}。${s.roles.length ? "职责：" + s.roles.map(r => r.label + " " + r.role).join("、") + "。" : ""}</p>`);
      const plusLv = (n) => typeof codexPlusLevel === "function" && codexPlusLevel(n) ? `武器 Lv${codexPlusLevel(n)}` : "";
      body += sec("被动", `<ul class="bx-abil">${s.passives.map((p, i) => `<li><b>${esc(p.name)}</b><br>${esc(p.text)}
          ${p.next ? `<div class="hx-plus"><b>${esc(p.name)}+</b><span class="hx-tag">${esc(plusLv(i + 1))} 升级</span><br>${esc(p.next)}</div>`
            : i < 2 && !p.plus ? `<div class="hx-plus dim">被动升级：待定</div>` : ""}</li>`).join("")}</ul>`);
      const skillLi = (k) => textItem(k.name, k.text, [k.cost, (k.minLv || 1) > 1 ? `Lv${k.minLv} 解锁` : ""].filter(Boolean).join(" · "));
      const roleIds = new Set((e.roleSkills || []).map(k => k.id));   // 职责技能单独列一节
      // 按等级查看：默认 1 级；可以点到后面的等级看那时会有的技能（角色和武器人的技能一起按等级筛）
      const allOf = (sk) => (sk && sk.all) || (sk && sk.now) || [];
      const atLv = (sk) => allOf(sk).filter(k => (k.minLv || 1) <= heroLv);
      const lvs = Array.from(new Set([1].concat(allOf(s.skills).filter(k => !roleIds.has(k.id)).map(k => k.minLv || 1),
        ...(s.weapons || []).map(w => allOf(w.skills).map(k => k.minLv || 1))))).sort((a, b) => a - b);
      if (!lvs.includes(heroLv)) heroLv = lvs.filter(x => x <= heroLv).pop() || 1;
      const lvPick = lvs.length > 1 ? `<div class="bx-lvpick"><span>查看等级</span>${lvs.map(x =>
        `<button class="bx-tab${x === heroLv ? " on" : ""}" data-hxlv="${x}">Lv${x}</button>`).join("")}</div>` : "";
      body += sec("技能", `${lvPick}<ul class="bx-abil">${atLv(s.skills).filter(k => !roleIds.has(k.id)).map(k => skillLi(k)).join("")}</ul>`);
      const ms = typeof ROLE_MILESTONES !== "undefined" ? ROLE_MILESTONES.join(" / ") : "5 / 10 / 15";
      if ((e.roleSkills || []).length) body += sec("职责技能", `<ul class="bx-abil">${e.roleSkills.map(k => textItem(k.name, k.text,
          [`${k.label}「${k.role}」${k.n}`, k.cost].filter(Boolean).join(" · "))).join("")}</ul>
        <p class="bx-note">开局拥有主职责的 1 号技能；之后在 ${ms} 级按职责路线选择解锁更多职责技能。</p>`);
      body += sec("协助", `<ul class="bx-abil">${s.assistAttack ? textItem("协助攻击", s.assistAttack) : ""}${s.assistBlock ? textItem("协助格挡", s.assistBlock) : ""}</ul>`);
      body += s.weapons.map(w => sec(`武器人 · ${esc(w.name)}`, `${layerBar(w.layers)}
        <div class="bx-nums">
          <div><small>atk</small><b>${w.atk}</b></div>
          <div><small>架势</small><b>${w.def}</b></div>
          <div><small>耐久</small><b>${w.durability != null ? w.durability : "—"}</b></div>
          <div><small>格挡加成</small><b>${w.blockBonus != null ? "+" + w.blockBonus + "%" : "—"}</b></div>
        </div>
        <ul class="bx-abil">${(w.passives || []).map(p => textItem(p.name, p.text)).join("")}
          ${atLv(w.skills).map(k => skillLi(k)).join("")}
          ${w.assistBlock ? textItem("协助格挡", w.assistBlock) : ""}
          ${w.growth ? textItem("成长", w.growth) : ""}</ul>`)).join("");
    }
    box.innerHTML = `<div class="bx-d">
        <div class="bx-kicker">角色 · ${esc([e.race, e.job].filter(Boolean).join(" · "))}</div>
        <h4>${esc(e.name)}${e.enName ? ` <small class="hx-en">${esc(e.enName)}</small>` : ""}</h4>
        ${e.fullName ? `<div class="hx-full">全名：${esc(e.fullName)}</div>` : ""}
        <div class="hx-diff"><span>游玩难度</span><b class="hx-stars" aria-label="${e.stars} 星（满分 5 星）">${starText(e.stars)}</b></div>
        <p class="hx-intro">${esc(e.intro)}</p>
        <div class="bx-chips">${profs ? `<span class="bx-chip dim">熟练：${esc(profs)}</span>` : ""}${e.note ? `<span class="bx-chip dim">${esc(e.note)}</span>` : ""}</div>
        ${body}
      </div>`;
  }
  /** 卡片上的一行摘要：说明第一句截短 */
  function codexBlurb(e) {
    const t = String((e.lines || [])[0] || "");
    return t.length > 26 ? t.slice(0, 25) + "…" : t;
  }
  /** 每日挑战的选取率（rogue.js · featPickRates，本机记下的局）：出现过才写 */
  function pickRateNote(id) {
    let r = null;
    // Rogue 是 rogue.js 顶层的 const，不挂在 window 上，所以不能写 window.Rogue
    try { r = typeof Rogue !== "undefined" && Rogue.featPickRates ? Rogue.featPickRates()[id] : null; } catch (e) { r = null; }
    if (!r || !r.shown) return "";
    return `<section class="bx-sec"><div class="bx-sec-h"><span>每日挑战</span></div><p class="bx-note">本机记下的每日挑战里出现 ${r.shown} 次，被选 ${r.picked} 次（选取率 ${Math.round(r.rate * 100)}%）。</p></section>`;
  }
  /** 专长详情：层级与起始等级、种类、次数、消耗、效果文字、涉猎来源、标签 */
  function renderFeatDetail(e) {
    const box = root.querySelector(".bx-detail");
    const chips = [`<span class="bx-chip">${esc(e.kindName)}</span>`];
    if (e.uses) chips.push(`<span class="bx-chip">${esc(e.uses)}</span>`);
    if (e.cost) chips.push(`<span class="bx-chip">${esc(e.cost)}</span>`);
    e.tags.forEach(t => chips.push(`<span class="bx-chip dim">${esc(t)}</span>`));
    box.innerHTML = `<div class="bx-d">
        <div class="bx-kicker">专长 · ${esc(e.groupName)}</div>
        <h4>${esc(e.name)}</h4>
        <div class="bx-chips">${chips.join("")}</div>
        <section class="bx-sec"><div class="bx-sec-h"><span>效果</span></div><ul class="bx-abil">${e.lines.map(a => `<li>${esc(a)}</li>`).join("")}</ul></section>
        ${e.dabbleFrom ? `<section class="bx-sec"><div class="bx-sec-h"><span>涉猎来源</span></div><p class="bx-note">${esc(e.dabbleFrom)}</p></section>` : ""}
        ${pickRateNote(e.featId)}
        <p class="bx-note">${esc(e.level ? `${e.level} 级起可以选（选专长时可以选本级或更低级的）。` : "")}这是专长，不是同名的技能 / 配置物 / 效果。</p>
      </div>`;
  }
  /** 义体详情：种类、等级、效果、改造率、坚毅生命的消耗（固定的规则文字）、诊所（价格、拆除、以新换旧）。
   *  数据都来自 codex.js · codexCyberwareEntries，不读任何角色，所以也不会显示谁现在还剩多少坚毅生命 */
  function renderCyberDetail(e) {
    const box = root.querySelector(".bx-detail");
    const chips = [`<span class="bx-chip">${esc(e.tier)} 级 · .vol${esc(e.vol)}</span>`, `<span class="bx-chip">${esc(e.kindName)}</span>`];
    if (e.element) chips.push(`<span class="bx-chip e-${esc(e.element)}">${eleIcon(e.element)}${esc(typeof ELE !== "undefined" ? ELE[e.element] : e.element)}属性</span>`);
    (e.tags || []).forEach(t => chips.push(`<span class="bx-chip dim">${esc(t)}</span>`));
    const sec = (title, list) => (list || []).length ? `<section class="bx-sec"><div class="bx-sec-h"><span>${esc(title)}</span></div><ul class="bx-abil">${list.map(a => `<li>${esc(a)}</li>`).join("")}</ul></section>` : "";
    box.innerHTML = `<div class="bx-d">
        <div class="bx-kicker">义体 · ${esc(e.kindName)} · ${esc(e.tier)} 级</div>
        <h4>${esc(e.name)}</h4>
        <div class="bx-chips">${chips.join("")}</div>
        ${sec("效果", (e.effect || []).concat(e.use ? [e.use] : []))}
        ${sec("改造率", e.rate ? [e.rate] : [])}
        ${sec("坚毅生命", e.grit)}
        ${sec("诊所", e.clinic)}
        <p class="bx-note">这是义体，不是同名的专长 / 技能。这里只写固定的规则，不显示任何角色现在的状态。</p>
      </div>`;
  }
  /* ---------- 规则说明（rulebook.js） ---------- */
  /** 一条规则：「：」前面的短标签加粗（和效果图鉴一样）；括号里的「：」不算（「瑞比（角色卡：力量 6…）」不会只加粗半个括号） */
  function ruleLine(a) {
    let depth = 0, i = -1;
    for (let k = 0; k < a.length && i < 0; k++) {
      const ch = a[k];
      if (ch === "（" || ch === "(") depth++;
      else if (ch === "）" || ch === ")") depth = Math.max(0, depth - 1);
      else if (ch === "：" && !depth) i = k;
    }
    return `<li>${i > 0 && i < 12 ? `<b>${esc(a.slice(0, i))}</b>${esc(a.slice(i))}` : esc(a)}</li>`;
  }
  /** 一章规则的详情（纯函数，测试直接调）：导语，然后每一节画出列表、表格和说明 */
  function rulebookHtml(e) {
    if (!e) return "";
    const secs = (e.sections || []).map(s => {
      const t = s.table;
      const table = t ? `<div class="rx-table-wrap"><table class="rx-table"><thead><tr>${t.head.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead>` +
        `<tbody>${t.rows.map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : "";
      return `<section class="bx-sec"><div class="bx-sec-h"><span>${esc(s.title)}</span></div>` +
        `${(s.lines || []).length ? `<ul class="bx-abil">${s.lines.map(ruleLine).join("")}</ul>` : ""}${table}${s.note ? `<p class="bx-note">${esc(s.note)}</p>` : ""}</section>`;
    }).join("");
    return `<div class="bx-d rx-d">
        <div class="bx-kicker">规则 · ${esc(e.groupName)}</div>
        <h4>${esc(e.name)}</h4>
        ${e.blurb ? `<p class="hx-intro">${esc(e.blurb)}</p>` : ""}
        ${secs}
      </div>`;
  }
  function renderCodexDetail(e) {
    const box = root.querySelector(".bx-detail");
    if (!e) { box.innerHTML = ""; return; }
    if (mode === "feat") { renderFeatDetail(e); return; }
    if (mode === "cyber") { renderCyberDetail(e); return; }
    if (mode === "rules") { box.innerHTML = rulebookHtml(e); return; }
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
    if (window.Sfx) Sfx.ui("open");
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
  return { open, close, pickRateNote, dropsSection, dropChanceText, rulebookHtml, modes: MODES.map(m => m.slice()),
    isOpen: () => !!(root && root.classList.contains("show")) };
})();
if (typeof window !== "undefined") window.Bestiary = Bestiary;
