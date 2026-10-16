/* Antlerscale: Backfire · 单位卡（战场上的铭牌）的画法
 * 战斗画面（game.js）和联机玩家的战斗画面（online-battle.js）共用：只管 DOM，不碰规则和战场状态。
 *   const c = UnitCard.create(snap)   → { id, wrap, unit, … }（snap 的字段见 game.js · snapUnit）
 *   UnitCard.update(c, snap, { sim })  → 按快照更新血条、架势、耐久、行动点、状态徽章；sim 时不播放生效动画 */
(function (root) {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const sumCur = (s) => (s.layers || []).reduce((a, l) => a + l.cur, 0);
  const sumMax = (s) => (s.layers || []).reduce((a, l) => a + l.max, 0);
  const LAYER_NAME = (function () { try { if (typeof LAYER !== "undefined") return LAYER; } catch (e) {} return { flesh: "肉体", armor: "装甲", shield: "护盾", sand: "沙尘", spirit: "星灵" }; })();

  function create(s) {
    const wrap = el("div", "unit-wrap");
    wrap.dataset.id = s.id;
    const unit = el("div", "unit " + (s.isProp ? "prop " : "") + (s.isDevice ? "device " : "") + (s.neutral ? "mini neutral " : "") + (s.isPlayer ? "player" : "foe"),
      `<div class="u-head"><span class="u-name"></span><span class="u-lv"></span><span class="u-atk"></span></div>
       <div class="u-hp"></div>
       <div class="u-hpline"><span class="hpn"></span><span class="shpn"></span></div>
       <div class="u-def"></div>
       <div class="u-dur"><div class="u-durbar"></div><div class="u-durline"><span class="durn"></span><span class="durlbl"></span></div></div>
       <div class="u-foot"><div class="u-econ"></div><div class="u-status"></div></div>
       <div class="u-res"></div>
       <span class="u-flag stun">失衡</span><span class="u-flag dying">濒死</span><span class="u-flag downed">倒下</span>`);
    const flash = el("div", "flash");
    const tag = el("div", "pvtag");
    const intents = el("div", "u-intents");   // 名牌上方的行动提示（连击……）：红底白字
    wrap.append(intents, unit, flash, tag);
    const c = { id: s.id, wrap, unit, flash, tag, intents, segs: [], pips: [], layersKey: "", prev: null };
    return c;
  }

  function update(c, s, opts) {
    const q = (sel) => c.unit.querySelector(sel);
    q(".u-name").textContent = s.name;
    if (c.intents) {
      const list = Array.isArray(s.intents) ? s.intents : [];
      const key = list.join("|");
      if (c.intents.dataset.key !== key) {
        c.intents.dataset.key = key;
        c.intents.innerHTML = list.map(x => `<span class="u-intent">${esc(x)}</span>`).join("");
      }
      c.wrap.classList.toggle("has-intent", list.length > 0);
    }
    q(".u-lv").textContent = "Lv" + s.level;
    // 个体值（杂兵、精英）：铭牌上停一下就能看到血量 / ATK 水平
    const ivSign = (n) => (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n) + "%";
    q(".u-lv").title = s.iv ? `个体值：血量 ${ivSign(s.iv.hp)} · ATK ${ivSign(s.iv.atk)}` : "";
    c.unit.dataset.iv = s.iv ? `${s.iv.hp},${s.iv.atk}` : "";
    q(".u-atk").textContent = "ATK " + s.atk;

    // 分层血条：数组 0 是最外层，显示在最右
    const key = s.layers.map(l => l.type + ":" + l.max).join("|");
    const hp = q(".u-hp");
    if (key !== c.layersKey) {
      hp.innerHTML = "";
      c.segs = [];
      c.highBar = null;
      for (let i = s.layers.length - 1; i >= 0; i--) {
        const l = s.layers[i];
        const seg = el("div", "seg t-" + l.type, `<div class="ghost"></div><div class="fill"></div><div class="pv maybe"></div><div class="pv sure"></div><div class="pv heal"></div>`);
        seg.style.flex = `${Math.max(1, l.max)} 1 0`;
        seg.style.minWidth = "10px";
        seg.title = (LAYER_NAME[l.type] || l.type);
        hp.appendChild(seg);
        c.segs[i] = {
          el: seg, fill: seg.querySelector(".fill"), ghost: seg.querySelector(".ghost"),
          sure: seg.querySelector(".pv.sure"), maybe: seg.querySelector(".pv.maybe"), heal: seg.querySelector(".pv.heal")
        };
      }
      c.layersKey = key;
      c.prev = null;
    }
    s.layers.forEach((l, i) => {
      const sg = c.segs[i];
      if (!sg) return;
      const pct = l.max > 0 ? (l.cur / l.max) * 100 : 0;
      sg.fill.style.width = pct + "%";
      sg.ghost.style.width = pct + "%";
      const was = c.prev && c.prev.layers[i] ? c.prev.layers[i].cur : l.cur;
      if (was > 0 && l.cur === 0) { sg.el.classList.remove("crack"); void sg.el.offsetWidth; sg.el.classList.add("crack"); }
    });
    if (!c.highBar || c.highBar.parentElement !== hp) {
      c.highBar = el("div", "u-high");
      hp.appendChild(c.highBar);
    }
    {
      const tot = Math.max(1, sumMax(s));
      const he = Math.max(0, Number(s.highEnergy) || 0);
      c.highBar.style.width = (he > 0 ? Math.min(100, (he / tot) * 100) : 0) + "%";
      c.highBar.style.display = he > 0 ? "" : "none";
      c.highBar.title = he > 0 ? ("高能 " + he + "（血量低于高能值时自爆）") : "";
      c.highBar.classList.toggle("danger", he > 0 && he >= sumCur(s) * 0.75);
    }
    // 被打死的敌人：溢出的伤害显示成负血量（纯画面，给一击的分量感）
    q(".hpn").innerHTML = s.overkill > 0 ? `<b class="neg">−${s.overkill}</b>/${sumMax(s)}` : `<b>${sumCur(s)}</b>/${sumMax(s)}`;
    c.wrap.classList.toggle("overkill", s.overkill > 0);
    q(".shpn").textContent = s.upOnShp ? "起身" : "";

    // 架势
    const defBox = q(".u-def");
    const n = Math.max(s.defMax, s.def);
    // 架势特别高（训练场的木桩等）：一格一个菱形画不下，改写数字
    if (n > 40) {
      defBox.textContent = n >= 100000 ? "架势 ∞" : `架势 ${s.def}/${s.defMax}`;
      c.pips = [];
    } else if (c.pips.length !== n) {
      defBox.innerHTML = "";
      c.pips = [];
      for (let i = 0; i < n; i++) { const p = el("i", "pip"); defBox.appendChild(p); c.pips.push(p); }
    }
    const prevDef = c.prev ? c.prev.def : s.def;
    c.pips.forEach((p, i) => {
      p.classList.toggle("on", i < s.def);
      if (i >= s.def && i < prevDef) { p.classList.remove("shatter"); void p.offsetWidth; p.classList.add("shatter"); }
    });

    // 武器耐久（黄色条）
    const durBox = q(".u-dur");
    if (durBox) {
      const d = s.dur;
      durBox.style.display = d ? "" : "none";
      if (d) {
        // 和血条一样：每点耐久一格，掉了的格子变空；下面一行写数字
        const bar = durBox.querySelector(".u-durbar");
        if (bar.children.length !== d.max) {
          bar.innerHTML = "";
          for (let i = 0; i < d.max; i++) { const g = el("div", "dseg"); g.appendChild(el("div", "fill")); bar.appendChild(g); }
        }
        [...bar.children].forEach((g, i) => g.classList.toggle("on", i < d.cur));
        durBox.querySelector(".durn").innerHTML = `<b>${d.cur}</b>/${d.max}`;
        durBox.querySelector(".durlbl").textContent = "耐久";
        durBox.title = `${d.name} 耐久 ${d.cur}/${d.max}`;
        durBox.classList.toggle("broken", d.cur <= 0);
      }
    }

    // 行动点 / 附赠
    const econ = q(".u-econ");
    {
      let h = "";
      for (let i = 0; i < Math.max(s.apMax, s.ap); i++) h += `<i class="econ-ap${i < s.ap ? " on" : ""}"></i>`;
      for (let i = 0; i < Math.max(s.bonusMax, s.bonus); i++) h += `<i class="econ-bonus${i < s.bonus ? " on" : ""}"></i>`;
      if (s.flying) h += `<span class="chip">飞</span>`;
      if (!window.HudIcons) (s.hung || []).forEach(n => { h += `<span class="chip">${esc(n)}</span>`; });
      econ.innerHTML = h;
      econ.title = `行动点 ${s.ap}/${s.apMax} · 附赠 ${s.bonus}/${s.bonusMax}`;
    }

    // 高能和其他状态放在同一行、同一种样式（之前放在行动点那一行，字体大小不一样）
    const icons = !!window.HudIcons;
    // #52：高能只看高能状态（状态文字里的「高能」）；没有高能状态的高能值显示成蓄能
    const isHigh = !!(s.status && /(^| )高能( |$)/.test(s.status));
    const highChip = icons ? "" : isHigh ? `<span class="chip">高能${s.highEnergy > 0 ? " " + s.highEnergy : ""}</span>`
      : s.highEnergy > 0 ? `<span class="chip">蓄能 ${s.highEnergy}</span>` : "";
    // 首领机制（死刑 / 分担）的标记：被标记的人身上一个倒计时，首领身上写着标了谁
    const when = (x) => x.left > 0 ? `${x.left} 回合后` : `这回合${x.phase === "player" ? "我方" : "敌人"}回合开始时`;
    const markTip = (x) => x.type === "volley"
      ? `${x.by} 的${x.name}：${when(x)}朝这个人开一枪（${x.shot || "atk"}、${x.brk != null ? x.brk : 2} 击破）${x.delayed ? "（首领失衡，会推迟一回合）" : ""}。每一枪都可以协助格挡——站在一起、留着附赠动作互相挡（现在同区还有 ${x.mates || 0} 个被瞄准的队友）。`
      : x.type === "spread"
      ? `${x.by} 的${x.name}：${when(x)}在这个人所在的区爆炸，${x.blast > 0 ? `每次对同区每个友方 ${x.blast}` : "每次波及同区每个友方"}，不能格挡。同一个区有几个标记就炸几次——现在这里有 ${x.stack} 个标记${x.stack > 1 ? `，每人会挨 ${x.stack} 次，快分开站` : "，没有和别人重叠"}。${x.delayed ? "（首领失衡，会推迟一回合）" : ""}`
      : x.type === "share"
      ? `${x.by} 的${x.name}：${when(x)}落下${x.delayed ? "（首领失衡，会推迟一回合）" : ""}。${x.pool > 0 ? `伤害池 ${x.pool}，` : ""}由这个人所在区的所有友方平均分担，不能格挡——大家聚过来一起扛（现在同区 ${x.group} 人${x.pool > 0 ? `，每人约 ${Math.ceil(x.pool / Math.max(1, x.group))}` : ""}）。`
      : `${x.by} 的${x.name}：${when(x)}落下${x.delayed ? "（首领失衡，会推迟一回合）" : ""}。每一段都可以协助格挡。`;
    const execChip = (s.marks || []).map(x => `<span class="chip mark-${x.type}" title="${esc(markTip(x))}">${esc(x.name)} ${x.left > 0 ? x.left : "!"}${x.type === "share" ? ` · ${x.group}人` : x.type === "spread" ? ` · ×${x.stack}` : ""}</span>`).join("") +
      (s.casts || []).map(x => `<span class="chip cast-${x.type}" title="${esc(`${x.name} → ${x.target || "（无目标）"}：${when(x)}落下`)}">${esc(x.name)}→${esc(x.target || "?")} ${x.left > 0 ? x.left : "!"}</span>`).join("");
    // 有图标的状态画成徽章（hud-icons.js），没有图标的（聚焦、掩护、首领阶段……）还是写字
    const badges = icons ? (s.badges || []) : [];
    const badgeKey = badges.map(b => b.key + ":" + b.stack).join("|");
    q(".u-status").innerHTML = execChip + highChip + (badges.length ? `<span class="hi-badges">${badges.map(b => HudIcons.badge(b.key, b.stack, b.title)).join("")}</span>` : "") + (s.status
      ? s.status.split(" · ").filter(t => t && t !== "无状态" && !/^高能/.test(t) && !(icons && HudIcons.covered(t))).map(t => `<span class="chip">${esc(t)}</span>`).join("")
      : "");
    // 新挂上的、层数变了的徽章：生效一下（放大 + 发光）
    if (icons && c.prev && c.prevBadges !== badgeKey && !(opts && opts.sim)) {
      const before = {};
      (c.prev.badges || []).forEach(b => { before[b.key] = String(b.stack); });
      badges.forEach(b => { if (before[b.key] !== String(b.stack)) HudIcons.procIn(q(".u-status"), b.key); });
    }
    c.prevBadges = badgeKey;
    // 中立生物的迷你名牌：只挂几个小标签（失衡 / 摊平 / 已发现）
    if (s.neutral) q(".u-status").innerHTML = (s.neutralTags || []).map(t => `<span class="chip m-${esc(t.key)}">${esc(t.text)}</span>`).join("");
    // 有耐久条时，资源文字里的「耐久 N」就不重复写了
    const resText = s.dur ? String(s.res || "").split(" · ").filter(t => !/^耐久 /.test(t)).join(" · ") : (s.res || "");
    q(".u-res").textContent = resText;
    q(".u-res").style.display = resText ? "" : "none";

    c.wrap.classList.toggle("stunned", s.stunned && !s.dead);
    const ex = (s.marks || []).filter(x => x.type === "execution"), sh = (s.marks || []).filter(x => x.type === "share");
    c.wrap.classList.toggle("doomed", ex.length > 0 && !s.dead);
    const sp = (s.marks || []).filter(x => x.type === "spread");
    c.wrap.classList.toggle("shared", sh.length > 0 && !ex.length && !s.dead);
    c.wrap.classList.toggle("spread", sp.length > 0 && !ex.length && !sh.length && !s.dead);
    c.wrap.classList.toggle("spread-clash", sp.some(x => x.stack > 1) && !s.dead);
    c.wrap.classList.toggle("volley", (s.marks || []).some(x => x.type === "volley") && !ex.length && !sh.length && !sp.length && !s.dead);
    c.wrap.classList.toggle("doom-now", (s.marks || []).some(x => x.left <= 0) && !s.dead);
    c.wrap.classList.toggle("dying", s.dying && !s.dead);
    c.wrap.classList.toggle("dead", s.dead && !s.isPlayer);
    c.wrap.classList.toggle("dead-slow", s.dead && !s.isPlayer && s.killBig);   // 一记重击打死：多停一会儿再慢慢消失
    c.wrap.classList.toggle("downed", s.dead && s.isPlayer);
    c.prev = s;
  }

  const api = { create, update, sumCur, sumMax };
  root.UnitCard = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
