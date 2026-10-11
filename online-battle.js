/* Antlerscale: Backfire · 联机玩家的战斗画面
 * 和单人 / 跑团的战斗画面一样：战场上是同一套单位卡（unit-card.js），底下是队伍栏、角色仪表、技能栏、结束回合；
 * 选了技能以后在战场上直接点目标（单位卡 / 区域），分步里的其他选项排在提示栏里。
 * 规则和预演都在主机上：这里只画主机发来的展示数据（online-view.js 的投影），点选通过回调交给 online-ui.js 去问主机。
 *   const b = OnlineBattle.create({ onUnit, onZone, onSkill, onOption, onCancel, onEnd })
 *   b.el → 挂到页面上；b.update(data, ui)：data 是展示用的战场，ui 是 { mine, current, acting, menu, skills, armed, hint, busy } */
(function (root) {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const make = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const ATK_NAME = { combust: "爆燃", icebreak: "破冰", bolt: "雷击", etch: "蚀刻", backflow: "倒流", inertia: "惯性", diffract: "衍射" };
  const DEVICE = ["button", "lever"];

  const ELE_NAME = { fire: "火", acid: "酸", electric: "电", ice: "冰", energy: "能量", physical: "物理", harmonic: "谐波" };
  const LAYER_NAME = { flesh: "肉体", armor: "装甲", shield: "护盾", sand: "沙尘", spirit: "星灵" };
  /** 聚焦：和本地卡片一样写「聚焦装甲 火→[冰]→电」（方括号是下一步要的属性） */
  function focusText(u) {
    return (u.focuses || []).map(f => "聚焦" + (LAYER_NAME[f.layerType] || f.layerType) + " " +
      (f.seq || []).map((e, i) => i === f.step ? "[" + (ELE_NAME[e] || e) + "]" : (ELE_NAME[e] || e)).join("→")).join(" · ");
  }
  /** 投影过的单位 → 单位卡要的快照（字段和 game.js · snapUnit 一样；主机不发的就留空） */
  function snapUnit(u) {
    const layers = (u.layers || []).map(l => ({ type: l.type || "flesh", cur: Math.max(0, Math.round(Number(l.current) || 0)), max: Math.max(0, Number(l.max) || 0) }));
    return {
      id: u.id, name: u.name || u.id, level: u.level || 1, isPlayer: !!u.isPlayer, kit: u.kit || "", zone: Number(u.zone) || 1,
      hidden: !!u.hidden, dead: !!u.dead, weaponUnit: !!(u.weaponOf || u.weaponUnit), dying: !!u.dying, upOnShp: false,
      stunned: !!u.stunned, iceNext: !!(u.instant && u.instant.iceNext),
      def: Math.max(0, Number(u.def) || 0), defMax: Math.max(0, Number(u.defMax) || 0), layers, shp: 0, shpMax: 0,
      flying: !!u.flying, highEnergy: Number(u.highEnergy) || 0,
      hung: ((u.resources || {}).nextAtkFx || []).map(k => ATK_NAME[k] || k),
      ap: Number(u.ap) || 0, apMax: Number(u.apMax) || 0, bonus: Number(u.bonus) || 0, bonusMax: Number(u.bonusMax) || 0,
      status: focusText(u), res: "", atk: Math.round(Number(u.atk) || 0), weapon: !!u.weaponOf, dur: null, marks: [], casts: [],
      overkill: 0, killBig: false,
      badges: root.HudIcons ? HudIcons.unitBadges(u, u.marks) : []
    };
  }
  function snapProp(p) {
    const max = Math.max(1, Number(p.maxHp) || Number(p.hp) || 1), cur = Math.max(0, Number(p.hp) || 0);
    const name = ({ button: "按钮", lever: "拉杆", battery: "超充能电池", boom: "爆炸桶", acid: "酸液桶", scrap: "碎渣机炮", turret: "防卫自律炮台", ironwall: "铁壁", scrapwall: "废铁墙", dome: "防护罩" })[p.kind] || p.kind || "配置物";
    return {
      id: "prop:" + p.id, name: p.name || name, isPlayer: p.faction !== "enemy", isProp: true, isDevice: DEVICE.includes(p.kind),
      zone: Number(p.zone) || 1, level: p.level || 1, atk: 0, layers: [{ type: "armor", max, cur }],
      def: 0, defMax: 0, ap: 0, apMax: 0, bonus: 0, bonusMax: 0, status: name, res: p.kind === "battery" || p.kind === "turret" ? (p.faction === "enemy" ? "敌方" : "我方") : "",
      highEnergy: 0, flying: false, stunned: false, dying: false, dead: !!p.destroyed || (cur <= 0 && !DEVICE.includes(p.kind)), hidden: false, marks: [], casts: [], hung: [], badges: []
    };
  }
  /** 区域的颜色和文字（和 app.js · fieldThemeClass / fieldTags 同样的判断；这里只看主机发来的展示字段，不碰规则） */
  function fieldClass(f) {
    if (!f) return "";
    if (f.abyss) return "field-abyss";
    if (f.collapseOn) return "field-collapse";
    if (f.fireOn || Number(f.fire) > 0) return "field-fire";
    for (const k of ["electric", "ice", "acid", "energy", "harmonic"]) if (f[k]) return "field-" + k;
    return "";
  }
  function fieldText(f) {
    if (!f) return "";
    const a = [];
    if (f.fireOn || Number(f.fire) > 0) a.push("火场 " + (Number(f.fire) || 1));
    if (f.collapseOn) a.push(`塌陷 ${Number(f.collapse) || 0} / 5`);
    if (f.ruinOn) a.push(`损毁地面 ${Number(f.ruinHp) || 0} / ${Number(f.ruinMax) || 0}`);
    const names = { electric: "高压", acid: "酸液", ice: "冻土", harmonic: "干涉", heal: "治愈", highland: "高地", abyss: "深渊", isolate: "隔离" };
    Object.keys(names).forEach(k => { if (f[k]) a.push(names[k]); });
    if (f.energy) a.push("能量场 " + (Number(f.energyVal) || 0));
    if (f.fieldLocked || f.fieldLock) a.push("锁定");
    return a.join(" · ");
  }
  const gapName = (t) => ({ open: "畅通", wall: "危墙", bridge: "不稳桥梁", door: "机关门", void: "空隙" })[t] || "间隔";

  function create(cb) {
    cb = cb || {};
    const el = make("div", "ol-battle");
    const field = make("main", "g-field ol-field");
    const hud = make("footer", "g-hud ol-hud");
    hud.innerHTML = `<div class="party"></div><div class="hud-row"><div class="hi-gauge" aria-label="角色仪表"></div><div class="skills"></div>
      <div class="hud-side"><button class="endturn" type="button" data-ob="end">结束行动<small>空格</small></button></div></div><div class="hint"></div>`;
    el.append(field, hud);
    const cards = new Map();
    let layoutKey = "", last = { ui: {} };

    /** 战场骨架：两区 / 三区直排，或者主机发来的特殊棋盘（和 game.js · syncFieldDom 同一套摆法） */
    function layout(data) {
      const b = data.board && Array.isArray(data.board.zones) && data.board.zones.length ? data.board : null;
      const n = Math.max(2, Math.min(9, Number(data.zoneMode) || 2));
      const key = b ? "b:" + JSON.stringify(b.zones) + JSON.stringify(b.links || []) : "z" + n;
      if (key === layoutKey) return;
      layoutKey = key;
      field.innerHTML = ""; field.removeAttribute("style");
      const zone = (z) => { const s = make("section", "g-zone"); s.dataset.num = String(z); s.innerHTML = `<span class="zlabel">${z} 区</span><div class="grp enemy"></div><div class="grp prop"></div><div class="grp player"></div>`; return s; };
      const gap = (a, c, horiz) => { const g = make("div", "g-gap" + (horiz ? " horiz" : "")); g.dataset.key = Math.min(a, c) + "-" + Math.max(a, c); return g; };
      if (b) {
        const W = Math.max(...b.zones.map(q => Number(q.x))) + 1, Hh = Math.max(...b.zones.map(q => Number(q.y))) + 1;
        field.className = "g-field ol-field board-grid " + (W >= 3 ? "z3" : "z2") + (Hh >= 2 ? " rows" + Hh : "");
        const track = (k, z, g) => Array.from({ length: 2 * k - 1 }, (_, i) => (i % 2 ? g : z)).join(" ");
        field.style.gridTemplateColumns = track(W, "minmax(0, 1fr)", W >= 3 ? "32px" : "28px");
        field.style.gridTemplateRows = track(Hh, "minmax(0, 1fr)", "24px");
        b.zones.forEach(q => { const s = zone(Number(q.id)); s.style.gridColumn = String(2 * Number(q.x) + 1); s.style.gridRow = String(2 * Number(q.y) + 1); field.appendChild(s); });
        (b.links || []).forEach(([za, zb]) => {
          const qa = b.zones.find(q => Number(q.id) === Number(za)), qb = b.zones.find(q => Number(q.id) === Number(zb));
          if (!qa || !qb) return;
          const dx = Math.abs(qa.x - qb.x), dy = Math.abs(qa.y - qb.y);
          if (dx + dy !== 1) return;
          const g = gap(za, zb, dy);
          g.style.gridColumn = String(dx ? 2 * Math.min(qa.x, qb.x) + 2 : 2 * qa.x + 1);
          g.style.gridRow = String(dy ? 2 * Math.min(qa.y, qb.y) + 2 : 2 * qa.y + 1);
          field.appendChild(g);
        });
      } else {
        field.className = "g-field ol-field z" + n;
        for (let z = 1; z <= n; z++) { if (z > 1) field.appendChild(gap(z - 1, z)); field.appendChild(zone(z)); }
      }
      cards.forEach(c => c.wrap.remove());
    }

    /** 正在选目标 / 区域时，能选的按选项顺序编号（①②…）：同名的敌人（两只狂徒）也分得清是哪一只 */
    function pickNumbers(ui, kind) {
      if (!ui.menu || ui.menu.kind !== kind) return null;
      const map = new Map(); let n = 0;
      (ui.menu.options || []).forEach(o => { if (!o.disabled && o.value != null && o.value !== "") map.set(String(o.value), ++n); });
      return map;
    }
    function setPickBadge(node, n) {
      let b = node.querySelector(":scope > .ob-pick-no");
      if (!n) { if (b) b.remove(); return; }
      if (!b) { b = document.createElement("span"); b.className = "ob-pick-no"; b.setAttribute("aria-hidden", "true"); node.appendChild(b); }
      b.textContent = String(n);
    }
    function paintZones(data, ui) {
      const zoneNo = pickNumbers(ui, "zone");
      const zoneOpts = zoneNo ? new Set([...zoneNo.keys()].map(Number)) : null;
      field.querySelectorAll(".g-zone").forEach(z => {
        const f = (data.fields || {})[z.dataset.num] || null;
        const cls = fieldClass(f), tags = fieldText(f);
        [...z.classList].filter(c => /^field-/.test(c)).forEach(c => z.classList.remove(c));
        if (cls) z.classList.add(cls);
        z.querySelector(".zlabel").textContent = `${z.dataset.num} 区${tags ? "　" + tags : ""}`;
        z.classList.toggle("is-move-target", !!(zoneOpts && zoneOpts.has(Number(z.dataset.num))));
        setPickBadge(z, zoneNo ? zoneNo.get(String(z.dataset.num)) : 0);
      });
      field.querySelectorAll(".g-gap").forEach(g => {
        const gp = (data.gaps || {})[g.dataset.key] || {};
        g.className = "g-gap gap-" + (gp.type || "open") + (g.classList.contains("horiz") ? " horiz" : "");
        const hp = gp.type === "bridge" || gp.type === "wall" ? " " + (gp.hp || 0) : "";
        g.innerHTML = `<span class="gap-lab">${esc(gapName(gp.type || "open"))}${hp}${gp.type === "door" ? (gp.open ? " 开" : " 关") : ""}</span>`;
      });
    }

    function paintCards(data, ui) {
      const kit = root.UnitCard;
      if (!kit) return;
      const snaps = (data.units || []).filter(u => !u.hidden).map(snapUnit)
        .concat((data.props || []).filter(p => !p.destroyed).map(snapProp));
      const seen = new Set();
      const targetNo = pickNumbers(ui, "unit");
      const targets = targetNo ? new Set(targetNo.keys()) : null;
      snaps.forEach(s => {
        seen.add(s.id);
        let c = cards.get(s.id);
        if (!c) {
          c = kit.create(s);
          c.wrap.dataset.unitId = s.isProp ? "" : s.id;
          if (s.isProp) c.wrap.dataset.propId = s.id.slice(5);
          c.wrap.addEventListener("click", (e) => { e.stopPropagation(); if (cb.onUnit) cb.onUnit(s.isProp ? s.id : c.id); });
          cards.set(s.id, c);
        }
        try { kit.update(c, s, {}); } catch (e) { /* 少字段的快照画不全也不要卡住整个画面 */ }
        const grp = field.querySelector(`.g-zone[data-num="${s.zone}"] .grp.${s.isProp ? "prop" : s.isPlayer ? "player" : "enemy"}`) || field.querySelector(".g-zone .grp");
        if (grp && c.wrap.parentElement !== grp) grp.appendChild(c.wrap);
        c.wrap.classList.toggle("is-actor", !!ui.current && s.id === ui.current && !!ui.acting);
        c.wrap.classList.toggle("is-targetable", !!targets && targets.has(s.id));
        c.wrap.classList.toggle("is-dim", !!targets && !targets.has(s.id) && s.id !== ui.current);
        setPickBadge(c.wrap, targetNo ? targetNo.get(s.id) : 0);
      });
      cards.forEach((c, id) => { if (!seen.has(id)) { c.wrap.remove(); cards.delete(id); } });
    }

    function paintHud(data, ui) {
      const units = data.units || [], mine = new Set(ui.mine || []);
      const allies = units.filter(u => u.isPlayer && !u.hidden);
      const pct = (u) => { const L = u.layers || [], m = L.reduce((a, l) => a + (Number(l.max) || 0), 0); return m ? L.reduce((a, l) => a + Math.max(0, Number(l.current) || 0), 0) / m * 100 : 0; };
      const econ = (u) => Array.from({ length: Math.max(u.apMax || 0, u.ap || 0) }, (_, k) => `<i class="econ-ap${k < (u.ap || 0) ? " on" : ""}"></i>`).join("") +
        Array.from({ length: Math.max(u.bonusMax || 0, u.bonus || 0) }, (_, k) => `<i class="econ-bonus${k < (u.bonus || 0) ? " on" : ""}"></i>`).join("");
      hud.querySelector(".party").innerHTML = allies.map(u => `<button type="button" class="pc${u.weaponOf ? " weapon" : ""}${u.dead ? " downed" : ""}${u.id === ui.current ? " on" : ""}${mine.has(u.id) ? " mine" : " off"}" data-ob-unit="${esc(u.id)}" title="${esc(mine.has(u.id) ? "你的角色" : "队友")}">
        <span class="n"><span>${esc(u.name || u.id)}</span><span class="k">${mine.has(u.id) ? "你" : ""}</span></span><div class="mini"><i style="width:${pct(u)}%"></i></div>
        <div class="u-econ">${u.dead ? '<span style="font-size:11px;color:#9d9081">倒下</span>' : econ(u)}${!u.dead && u.stunned ? '<span style="font-size:11px;color:var(--gold)">失衡</span>' : ""}${!u.dead && u.dying ? '<span style="font-size:11px;color:var(--foe)">濒死</span>' : ""}</div></button>`).join("");
      const cur = units.find(u => u.id === ui.current);
      const gauge = hud.querySelector(".hi-gauge");
      const gh = cur && mine.has(cur.id) && cur.hud && root.HudIcons ? HudIcons.gauge(cur.hud) : "";
      if (gauge.dataset.html !== gh) { gauge.innerHTML = gh; gauge.dataset.html = gh; }
      // 技能栏：主机给的技能选项（不能用的灰掉，写原因）。选了某个技能后它高亮，点别的技能就换
      const skills = (ui.skills || []);
      const costText = (id) => root.SkillText && SkillText.skillCostText ? SkillText.skillCostText(id) : "";
      hud.querySelector(".skills").innerHTML = skills.map((o, i) => {
        const cost = costText(o.value);
        return `<button type="button" class="sk${ui.armed === o.value ? " armed" : ""}" data-ob-skill="${esc(o.value)}"${o.disabled || ui.busy ? " disabled" : ""} aria-label="${esc(o.label + (o.reason ? "：" + o.reason : ""))}">
          <span class="key">${i < 9 ? i + 1 : ""}</span><span class="nm">${esc(o.label)}</span><span class="cost">${esc(cost || (o.reason || ""))}</span></button>`;
      }).join("") || (ui.acting && mine.has(ui.current) ? '<p class="ol-muted">正在取技能…</p>' : "");
      const end = hud.querySelector(".endturn");
      end.disabled = !(ui.acting && mine.has(ui.current)) || !!ui.busy;
      // 提示栏：现在要做什么；分步里的「选项」类选择、可以不选的步骤、取消，放成按钮
      const m = ui.menu;
      let hint = esc(ui.hint || "");
      if (m && ui.armed && m.kind !== "skill") {
        const extra = m.kind === "choice" ? (m.options || []).map((o, i) => `<button type="button" class="g-btn small" data-ob-opt="${i}"${o.disabled || ui.busy ? " disabled" : ""}>${esc(o.label)}</button>`).join("")
          : (m.options || []).map((o, i) => o.value == null ? `<button type="button" class="g-btn small" data-ob-opt="${i}"${ui.busy ? " disabled" : ""}>${esc(o.label)}</button>` : "").join("");
        const what = m.kind === "unit" ? "点战场上亮起的单位" : m.kind === "zone" ? "点亮起的区域" : "选一项";
        const empty = (m.kind === "unit" || m.kind === "zone") && !(m.options || []).some(o => o.value != null && !o.disabled) ? `<span style="color:var(--foe)">没有能选的${m.kind === "zone" ? "区域" : "目标"}</span>` : "";
        hint = `<b>${esc(m.title || "")}</b>　${what}${empty ? "　" + empty : ""}　${extra}<button type="button" class="g-btn small" data-ob="cancel">取消（Esc）</button>`;
      }
      const h = hud.querySelector(".hint");
      if (h.dataset.html !== hint) { h.innerHTML = hint; h.dataset.html = hint; }
    }

    function update(data, ui) {
      data = data || {}; ui = ui || {};
      last = { data, ui };
      layout(data);
      paintZones(data, ui);
      paintCards(data, ui);
      paintHud(data, ui);
    }

    // 点击：技能、分步选项、取消、结束行动；区域
    el.addEventListener("click", (e) => {
      const t = e.target;
      const sk = t.closest("[data-ob-skill]");
      if (sk && !sk.disabled) { if (root.HeroSheet) HeroSheet.hideTip(); if (cb.onSkill) cb.onSkill(sk.dataset.obSkill); return; }
      const op = t.closest("[data-ob-opt]");
      if (op && !op.disabled) { if (cb.onOption) cb.onOption(Number(op.dataset.obOpt)); return; }
      const b = t.closest("[data-ob]");
      if (b && !b.disabled) { if (b.dataset.ob === "cancel" && cb.onCancel) cb.onCancel(); if (b.dataset.ob === "end" && cb.onEnd) cb.onEnd(); return; }
      const z = t.closest(".g-zone");
      if (z && z.classList.contains("is-move-target") && cb.onZone) { cb.onZone(Number(z.dataset.num)); return; }
    });
    el.addEventListener("contextmenu", (e) => { if (last.ui.armed && cb.onCancel) { e.preventDefault(); cb.onCancel(); } });
    // 技能悬停：完整技能说明（和战斗画面同一个浮窗）
    el.addEventListener("mouseover", (e) => {
      const sk = e.target.closest && e.target.closest("[data-ob-skill]");
      if (!sk || !root.HeroSheet || !HeroSheet.tip) return;
      const o = (last.ui.skills || []).find(x => x.value === sk.dataset.obSkill);
      if (o) HeroSheet.tip(sk, HeroSheet.skillTipHtml({ id: o.value, name: o.label, hint: "" }, o.reason || ""));
    });
    el.addEventListener("mouseout", (e) => {
      const sk = e.target.closest && e.target.closest("[data-ob-skill]");
      if (sk && !sk.contains(e.relatedTarget) && root.HeroSheet) HeroSheet.hideTip();
    });
    /** 键盘：1–9 选技能，Esc / 右键取消，空格结束行动（输入框里打字时不管） */
    function onKey(e) {
      if (!el.isConnected || e.target.closest && e.target.closest("input, textarea, select")) return;
      const ui = last.ui || {};
      if (e.key === "Escape" && ui.armed && cb.onCancel) { cb.onCancel(); e.preventDefault(); return; }
      if (/^[1-9]$/.test(e.key)) {
        const o = (ui.skills || [])[Number(e.key) - 1];
        if (o && !o.disabled && !ui.busy && cb.onSkill) { cb.onSkill(o.value); e.preventDefault(); }
        return;
      }
      if (e.key === " " && !ui.busy && ui.acting && (ui.mine || []).includes(ui.current) && cb.onEnd) { cb.onEnd(); e.preventDefault(); }
    }
    document.addEventListener("keydown", onKey);
    function cardOf(id) { const c = cards.get(id); return c ? c.wrap : null; }
    function destroy() { document.removeEventListener("keydown", onKey); el.remove(); }
    return { el, update, cardOf, destroy };
  }

  const api = { create, snapUnit, snapProp };
  root.OnlineBattle = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
