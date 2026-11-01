/* Antlerscale: Backfire · 联机玩法「争斗」的房间画面和翻硬币动画（#543 第 2 步，docs/pvp.md 第 8 节）
 * 房主、玩家共用（online-ui.js 挂上）。数据只用 view.packet.brawl（online-brawl.js · viewFor → online-view.js · projectBrawl）：
 *   设定（等级段、每队几人、允许起身、回合上限、哪一队是 AI）、两队每个位置的角色和操控者、谁准备好了、能不能开打；
 *   自己的位置才带养成草稿。每一步能选什么在本机照规则层算（brawl.js · brawlChoices：和房主校验用的同一套），选了就发给房主存（brawl.build）。
 *   房主：改设定（brawl.set）、给 AI 那一队换角色（brawl.ai）、都准备好了点「开打」（OnlineGame.start）。
 *   玩家：选进 1 队或 2 队的空位、选角色（brawl.seat：同一队里不能重复，两队之间可以；一个人只在一队，可以拿几个位置），
 *         一项一项选专长、属性加点、血量层改造，点「准备好」（brawl.ready）。
 *   开打：所有人的画面放一次翻硬币（toss.no 每局一个），写清楚谁先手、后手的补偿（照决斗，enemies.js · PVP_DUEL_CFG.lateBonus）。
 * 不显示任何坚毅生命数值。房间画面在「房间码 · 菜单」按钮（.ol-dock）下面一层：菜单里的「消息与成员」「离开」照旧点得到。
 *   const b = BrawlUI.mount({ api, view: () => view, own, call }); b.sync(); b.destroy() */
(function (root) {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  // 规则层的配置表、函数（brawl.js / enemies.js / rogue-data.js / engine.js 的顶层 const / function，不在 window 上：按名字取）
  const CFG = () => (typeof BRAWL_CFG !== "undefined" ? BRAWL_CFG : { tiers: [], sizeMin: 1, sizeMax: 4, roundsDefault: 10 });
  const ROOM = () => (typeof BRAWL_ROOM_CFG !== "undefined" ? BRAWL_ROOM_CFG : { tossMs: 2800 });
  const DUEL = () => (typeof PVP_DUEL_CFG !== "undefined" ? PVP_DUEL_CFG : { teams: [{ id: "1队", name: "1 队" }, { id: "2队", name: "2 队" }], lateBonus: 1, roundsMax: 99 });
  const TEAMS = () => DUEL().teams.map(t => ({ id: t.id, name: t.name }));
  const teamName = id => (TEAMS().find(t => t.id === id) || { name: id }).name;
  const ATTRS = () => (typeof ATTR_NAMES !== "undefined" ? ATTR_NAMES : { str: "力量", con: "体质", dex: "敏捷", wil: "意志", int: "智力", sta: "耐力" });
  const LAYERS = () => (typeof LAYER !== "undefined" ? LAYER : { flesh: "肉体", armor: "装甲", shield: "护盾", sand: "沙尘", spirit: "星灵" });
  const kits = () => (typeof brawlHeroKits === "function" ? brawlHeroKits() : []);
  const heroName = kit => { const c = typeof brawlCard === "function" ? brawlCard(kit) : null; return c ? c.name : kit || ""; };
  const featOf = id => (typeof featDef === "function" ? featDef(id) : null);
  const choices = (kit, tier, build) => (typeof brawlChoices === "function" ? brawlChoices(kit, tier, build) : null);
  const hostState = () => (typeof state !== "undefined" ? state : null);
  /** 争斗房间开着吗（房主看本机的玩法，玩家看房主发来的包） */
  const on = v => !!(v && v.active && (v.isHost ? v.mode === "brawl" : v.packet && v.packet.mode === "brawl"));
  // 玩家看的规则说明（固定的文字，不带任何数值；坚毅这两个字不写——玩家画面上一律不出现）
  const RULES = "照决斗打：3 区制，1 队站 1 区、2 队站 3 区；开打翻硬币定先手，后手每个角色开局多 1 个附赠动作（先手的第一回合里就能用，没用掉的一直留着）。" +
    "伤害不会致死：打到底的人「再起不能」、移出战场；一队全部倒地，另一队获胜。职责照角色给，熟练项不给，不带义体、改装件、道具。打完不给经验、奎支、掉落，不读也不写存档。";
  function optionText(b) {
    const tier = CFG().tiers[b.tier] || { name: "" };
    return `${tier.name} · ${b.size}v${b.size} · ${b.stand ? "允许起身" : "不允许起身（倒地的人留在场上，能被专长救起来）"} · ${b.rounds ? `限定 ${b.rounds} 回合（到了还没分出胜负，剩余血量百分比多的一队获胜，一样算平局）` : "不限回合"}` +
      (b.ai ? ` · ${teamName(b.ai)}交给 AI` : "");
  }
  const sel = (attrs, list, cur, blank) => `<select ${attrs}>${blank != null ? `<option value=""${cur ? "" : " selected"}>${esc(blank)}</option>` : ""}${list.map(o => `<option value="${esc(o.value)}"${String(o.value) === String(cur) ? " selected" : ""}${o.off ? " disabled" : ""}>${esc(o.label)}</option>`).join("")}</select>`;

  /* ---------- 设定 ---------- */
  function optsHtml(b, m) {
    if (!b.host) return `<p class="brawl-opts-text"><b>房主定的设定：</b>${esc(optionText(b))}</p>`;
    const off = m.busy ? " disabled" : "";
    const tiers = CFG().tiers.map((t, i) => ({ value: i, label: t.name }));
    const sizes = []; for (let n = CFG().sizeMin; n <= CFG().sizeMax; n++) sizes.push({ value: n, label: `${n}v${n}` });
    const ai = [{ value: "", label: "不要 AI（两队都是真人）" }].concat(TEAMS().map(t => ({ value: t.id, label: `${t.name}交给 AI` })));
    return `<div class="brawl-opts">
      <label>等级段 ${sel(`data-brawl-opt="tier"${off}`, tiers, b.tier)}</label>
      <label>每队人数 ${sel(`data-brawl-opt="size"${off}`, sizes, b.size)}</label>
      <label>AI ${sel(`data-brawl-opt="ai"${off}`, ai, b.ai || "")}</label>
      <label><input type="checkbox" data-brawl-opt="stand"${b.stand ? " checked" : ""}${off}> 允许起身</label>
      <label><input type="checkbox" data-brawl-opt="limit"${b.rounds ? " checked" : ""}${off}> 限定回合数</label>
      <label>回合数 <input type="number" data-brawl-opt="rounds" min="1" max="${DUEL().roundsMax || 99}" value="${esc(b.rounds || m.rounds || CFG().roundsDefault)}"${b.rounds && !m.busy ? "" : " disabled"}></label>
    </div><p class="ol-muted brawl-opts-text">${esc(optionText(b))}</p>`;
  }

  /* ---------- 两队的位置 ---------- */
  function slotHtml(b, t, row, m) {
    const off = m.busy || b.phase !== "setup" ? " disabled" : "";
    const where = `data-team="${esc(t.id)}" data-index="${row.index}"`;
    const used = (b.teams[t.id] || []).filter(r => r.kit && r.index !== row.index).map(r => r.kit);
    const kitList = cur => kits().map(k => ({ value: k, label: heroName(k) + (used.includes(k) ? "（这一队已经有了）" : ""), off: used.includes(k) && k !== cur }));
    if (row.ai) {
      const body = row.kit ? `<b>${esc(heroName(row.kit))}</b>` : '<span class="ol-muted">空</span>';
      const tools = b.host && b.phase === "setup" ? `${sel(`data-brawl-ai="${row.index}" aria-label="AI 的角色"${off}`, kitList(row.kit), row.kit)}<button type="button" class="g-btn ol-button crq-btn" data-brawl="aiRandom" ${where}${off}>随机</button>` : "";
      return `<li class="brawl-slot brawl-ai" ${where}><div>${body} <span class="crq-chip">AI</span></div>${tools ? `<div class="crq-state">${tools}</div>` : ""}</li>`;
    }
    if (!row.kit) {
      const join = b.phase === "setup" && !m.otherTeam(t.id) ? sel(`data-brawl-seat ${where} aria-label="选角色加入${esc(t.name)}"${off}`, kitList(null), "", "选角色加入") : "";
      return `<li class="brawl-slot brawl-empty" ${where}><div><span class="ol-muted">空位</span></div>${join ? `<div class="crq-state">${join}</div>` : ""}</li>`;
    }
    const ready = (b.ready || []).includes(row.owner);
    const state = `<span class="crq-chip${row.done ? " brawl-done" : ""}">${row.done ? "养成选好了" : "还在选养成"}</span>${ready ? '<span class="crq-chip brawl-ready">准备好了</span>' : ""}`;
    if (row.mine) {
      return `<li class="brawl-slot brawl-mine" ${where}><div><b>${esc(heroName(row.kit))}</b><small class="ol-muted"> · 你</small> ${state}</div>
        ${b.phase === "setup" ? `<div class="crq-state">${sel(`data-brawl-seat ${where} aria-label="换角色"${off}`, kitList(row.kit), row.kit)}<button type="button" class="g-btn ol-button crq-btn" data-brawl="leave" ${where}${off}>让出</button></div>` : ""}</li>`;
    }
    return `<li class="brawl-slot" ${where}><div><b>${esc(heroName(row.kit))}</b><small class="ol-muted"> · ${esc(row.ownerName || "")}</small> ${state}</div></li>`;
  }
  function teamsHtml(b, m) {
    return `<div class="brawl-teams">${TEAMS().map(t => `<section class="brawl-team" data-brawl-team="${esc(t.id)}"><h3>${esc(t.name)}${b.ai === t.id ? "（AI）" : ""}</h3>
      <ol class="crq-list">${(b.teams[t.id] || []).map(row => slotHtml(b, t, row, m)).join("")}</ol></section>`).join("")}</div>`;
  }

  /* ---------- 自己角色的养成（一项一项选） ---------- */
  function buildHtml(b, t, row, m) {
    const key = `${t.id}:${row.index}`, draft = m.draft(key, row.build), ch = choices(row.kit, b.tier, draft);
    const tier = CFG().tiers[b.tier] || { name: "", level: "", weapon: "" };
    const off = m.busy ? " disabled" : "";
    if (!ch) return `<article class="brawl-build" data-brawl-slot="${esc(key)}"><h3>${esc(heroName(row.kit))}</h3><p class="ol-bad">这名角色选不了</p></article>`;
    const A = ATTRS(), L = LAYERS();
    const attrs = ch.attrs.map((a, i) => `<label class="brawl-pick">${esc(a.level)} 级${a.noRepeat ? "（不能加在之前加过的同一项上）" : ""}
      ${sel(`data-brawl-attr="${i}"${off}`, Object.keys(A).map(k => ({ value: k, label: A[k], off: !a.options.includes(k) })), a.pick || "", "选一项属性")}
      ${a.bad ? `<small class="ol-bad">${esc(a.bad)}</small>` : ""}</label>`).join("");
    const featLabel = id => { const f = featOf(id); return f ? f.name + (f.kind === "action" ? "（战斗动作）" : "") : id; };
    const feats = ch.feats.map((f, i) => {
      const list = f.options.slice();
      if (f.pick && !list.includes(f.pick)) list.unshift(f.pick);   // 选了、现在不能选的照样列出来（写原因），不悄悄换掉
      const def = f.pick ? featOf(f.pick) : null;
      return `<label class="brawl-pick">${esc(f.level)} 级
        ${sel(`data-brawl-feat="${i}"${off}`, list.map(id => ({ value: id, label: featLabel(id) })), f.pick || "", "选一项专长")}
        ${def ? `<small class="brawl-feat-text">${esc(def.text || "")}</small>` : ""}${f.bad ? `<small class="ol-bad">${esc(f.bad)}</small>` : ""}</label>`;
    }).join("");
    const full = ch.full.need ? Array.from({ length: ch.full.need }, (_, i) => `<label class="brawl-pick">兼修：升成完整版
      ${sel(`data-brawl-full="${i}"${off}`, ch.full.options.concat(ch.full.picks.filter(x => !ch.full.options.includes(x))).map(id => ({ value: id, label: featLabel(id) })), ch.full.picks[i] || "", "选一张涉猎专长")}</label>`).join("") : "";
    const cy = ch.cyber, plan = cy.plan || {};
    const layerText = (cy.layers || []).map(l => `${L[l.type] || l.type} ${l.max}`).join(" / ");
    const cyber = `<div class="brawl-cyber" data-brawl-cyber="${esc(key)}">
      <p class="ol-muted">改造率 ${Math.round((Number(cy.rate) || 0) * 100)}% · 肉体 ${esc(cy.fleshMax)}，最多改 ${esc(cy.limit)} 点（肉体 8 : 装甲 7 : 护盾 6 : 沙尘 6；剩下的肉体可以全换成星灵）。不收钱。</p>
      <div class="crq-state">${["armor", "shield", "sand"].map(k => `<label>${esc(L[k] || k)} <input type="number" min="0" max="${esc(cy.limit)}" data-brawl-cy="${k}" value="${esc(plan[k] || 0)}"${off}></label>`).join("")}
      <label><input type="checkbox" data-brawl-cy="spirit"${plan.spirit ? " checked" : ""}${off}> 换成星灵</label></div>
      <p>${cy.bad ? `<span class="ol-bad">${esc(cy.bad)}</span>` : `改完：${esc(layerText)}`}</p></div>`;
    const state = ch.error ? `<p class="ol-bad brawl-why" role="status">${esc(ch.error)}</p>` : '<p class="ol-ok brawl-why" role="status">✓ 养成选好了</p>';
    return `<article class="brawl-build" data-brawl-slot="${esc(key)}"><h3>${esc(heroName(row.kit))} <small class="ol-muted">${esc(t.name)}第 ${row.index + 1} 个 · ${esc(tier.name)}</small></h3>
      <p class="ol-muted">职责照角色给；熟练项不给；所有武器 ${esc(tier.weapon)} 级。对方开打之前看不到你选的养成。</p>
      <h4>属性加点</h4><div class="brawl-steps">${attrs || '<span class="ol-muted">这个等级段没有</span>'}</div>
      <h4>专长</h4><div class="brawl-steps">${feats || '<span class="ol-muted">这个等级段没有</span>'}${full}</div>
      <h4>血量层改造（诊所的规则）</h4>${cyber}${state}</article>`;
  }

  function roomHtml(v, b, m) {
    const mine = TEAMS().flatMap(t => (b.teams[t.id] || []).filter(r => r.mine).map(r => ({ t, r })));
    const ready = (b.ready || []).includes(m.own);
    const builds = mine.map(x => buildHtml(b, x.t, x.r, m)).join("");
    const off = m.busy ? " disabled" : "";
    const readyBtn = mine.length ? `<button type="button" class="g-btn ol-button crq-btn${ready ? "" : " ol-primary"}" data-brawl="ready"${off}>${ready ? "取消准备" : "准备好"}</button>` : "";
    const startBtn = b.host ? `<button type="button" class="g-btn ol-button ol-primary crq-btn" data-brawl="start"${b.start && b.start.ok && !m.busy ? "" : " disabled"}>开打</button>` : "";
    const why = b.start && !b.start.ok && (b.start.why || []).length ? `<ul class="brawl-wait">${b.start.why.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : "";
    return `<div class="ol-card brawl-card">
      <header><div><span class="ol-muted">${esc(v.roomCode || "")} · 联机玩法</span><h2>争斗 · 第 ${esc(b.no || 1)} 局</h2></div></header>
      ${optsHtml(b, m)}
      <details class="brawl-rules"><summary>争斗的规则</summary><p>${esc(RULES)}</p></details>
      ${teamsHtml(b, m)}
      ${mine.length ? "" : `<p class="ol-muted">选进 1 队或 2 队的空位就能拿一个角色（同一队里不能重复，两队之间可以；一个人只在一队，可以拿几个位置）。${b.ai ? `${teamName(b.ai)}交给了 AI。` : ""}</p>`}
      ${builds}
      <footer class="brawl-foot"><div class="crq-state">${readyBtn}${startBtn}</div>
        ${b.start && b.start.ok ? `<p class="ol-ok">都准备好了${b.host ? "：点「开打」" : "，等房主点「开打」"}。</p>` : why}
      </footer>
      ${m.error ? `<p class="ol-bad brawl-error" role="alert">${esc(m.error)}</p>` : ""}</div>`;
  }

  function mount(o) {
    const doc = root.document;
    const box = doc.createElement("section"); box.id = "online-brawl"; box.className = "ol-ui brawl-room"; box.setAttribute("aria-label", "争斗房间"); box.hidden = true;
    const toss = doc.createElement("div"); toss.id = "brawl-toss"; toss.className = "ol-ui brawl-toss"; toss.setAttribute("role", "status"); toss.setAttribute("aria-live", "polite"); toss.hidden = true;
    doc.body.appendChild(box); doc.body.appendChild(toss);
    let last = "", busy = false, error = "", rounds = null, seenToss = null, tossTimers = [];
    const pending = {};   // 发给房主、还没回来的养成草稿（先照它画菜单，免得一项一项选的时候跳回去）
    const v = () => o.view() || {};
    const data = () => { const x = v(); return x.packet && x.packet.brawl || null; };
    const model = () => {
      const b = data() || { teams: {} }, me = o.own();
      return { own: me, busy, error, rounds,
        draft: (key, build) => pending[key] || build,
        otherTeam: team => TEAMS().some(t => t.id !== team && (b.teams[t.id] || []).some(r => r.mine)) };
    };
    function paint() {
      const b = data();
      if (box.hidden || !b) return;
      const html = roomHtml(v(), b, model());
      if (html === last) return;
      // 重画时保住滚动位置和焦点（手机上一项一项选，不要每选一项就跳回最上面）
      const top = box.scrollTop, focus = doc.activeElement && box.contains(doc.activeElement) ? doc.activeElement : null;
      const fkey = focus ? ["data-brawl-opt", "data-brawl-attr", "data-brawl-feat", "data-brawl-full", "data-brawl-cy", "data-brawl-ai", "data-brawl"].map(a => focus.getAttribute(a) != null ? `[${a}="${focus.getAttribute(a)}"]` : "").join("") : "";
      const fslot = focus && focus.closest("[data-brawl-slot]") ? focus.closest("[data-brawl-slot]").dataset.brawlSlot : null;
      last = html; box.innerHTML = html; box.scrollTop = top;
      if (fkey) { const scope = fslot ? box.querySelector(`[data-brawl-slot="${fslot}"]`) : box; const el = scope && scope.querySelector(fkey); if (el) el.focus({ preventScroll: true }); }
    }
    /** 翻硬币：每一局放一次（toss.no）；已经开战了（刷新、半路进来）就不放 */
    function playToss(t, started) {
      if (!t || !t.first || seenToss === t.no) return;
      seenToss = t.no;
      if (started) return;
      tossTimers.forEach(clearTimeout); tossTimers = [];
      const first = t.first, second = TEAMS().find(x => x.id !== first) || { id: "", name: "" }, bonus = DUEL().lateBonus || 1, ms = Math.max(1200, Number(ROOM().tossMs) || 2800);
      toss.dataset.first = first;
      toss.innerHTML = `<div class="brawl-toss-card"><div class="brawl-coin" aria-hidden="true"><span class="brawl-coin-a">1</span><span class="brawl-coin-b">2</span></div>
        <p class="brawl-toss-head">翻硬币……</p><p class="brawl-toss-sub"></p></div>`;
      toss.classList.remove("brawl-toss-done"); toss.hidden = false;
      tossTimers.push(setTimeout(() => {
        toss.classList.add("brawl-toss-done");
        const h = toss.querySelector(".brawl-toss-head"), s = toss.querySelector(".brawl-toss-sub");
        if (h) h.textContent = `${teamName(first)}先手`;
        if (s) s.textContent = `${second.name}后手：开局每个角色多 ${bonus} 个附赠动作，先手的第一回合里就能用（主要拿来协助格挡），没用掉的一直留到用掉。`;
      }, Math.round(ms * 0.45)));
      tossTimers.push(setTimeout(() => { toss.hidden = true; }, ms + 1600));
    }
    function sync() {
      const x = v(), b = data(), live = on(x) && !!b;
      box.hidden = !(live && x.screen === "lobby");
      document.body.classList.toggle("ol-brawl-room", !box.hidden);
      if (!box.hidden) paint(); else last = "";
      if (!live) { toss.hidden = true; return; }
      if (b.toss && b.phase !== "setup") {
        const st = x.isHost ? hostState() : x.state;
        playToss(b.toss, !!(st && st.combatStarted));
      }
    }
    async function submit(cmd, key) {
      if (busy) return false;
      busy = true; error = ""; last = ""; paint();
      try {
        const r = await o.api.submit(cmd);
        if (r && r.ok === false) { error = r.error || "没做成"; return false; }
        return true;
      } catch (e) { error = (e && e.message) || "没做成"; return false; }
      finally { busy = false; if (key) delete pending[key]; last = ""; sync(); }
    }
    /** 读出一个角色的养成编辑区（没选的写 null） */
    function draftOf(art) {
      const vals = attr => [...art.querySelectorAll(`[${attr}]`)].sort((a, b) => Number(a.getAttribute(attr)) - Number(b.getAttribute(attr))).map(s => s.value || null);
      const num = k => { const el = art.querySelector(`[data-brawl-cy="${k}"]`); return Math.max(0, Math.floor(Number(el && el.value) || 0)); };
      const spirit = art.querySelector('[data-brawl-cy="spirit"]');
      const plan = { armor: num("armor"), shield: num("shield"), sand: num("sand"), spirit: !!(spirit && spirit.checked) };
      return { attrs: vals("data-brawl-attr"), feats: vals("data-brawl-feat"), featFull: vals("data-brawl-full").filter(Boolean),
        cyberPlan: plan.armor || plan.shield || plan.sand || plan.spirit ? plan : null };
    }
    async function onChange(e) {
      const t = e.target, b = data();
      if (!b) return;
      if (t.hasAttribute("data-brawl-opt")) {
        const k = t.getAttribute("data-brawl-opt");
        if (k === "tier" || k === "size") return void submit({ type: "brawl.set", [k]: Number(t.value) });
        if (k === "ai") return void submit({ type: "brawl.set", ai: t.value || null });
        if (k === "stand") return void submit({ type: "brawl.set", stand: !!t.checked });
        if (k === "limit") return void submit({ type: "brawl.set", rounds: t.checked ? Math.max(1, Math.min(DUEL().roundsMax || 99, Math.floor(Number(rounds) || CFG().roundsDefault || 10))) : null });
        if (k === "rounds") {
          const n = Math.floor(Number(t.value)), max = DUEL().roundsMax || 99;
          if (!Number.isFinite(n) || n < 1 || n > max) { error = `回合数要在 1 到 ${max} 之间`; last = ""; paint(); return; }
          rounds = n;
          if (b.rounds) return void submit({ type: "brawl.set", rounds: n });
        }
        return;
      }
      if (t.hasAttribute("data-brawl-seat")) return void submit({ type: "brawl.seat", team: t.dataset.team, index: Number(t.dataset.index), kit: t.value || null });
      if (t.hasAttribute("data-brawl-ai")) return void submit({ type: "brawl.ai", index: Number(t.getAttribute("data-brawl-ai")), kit: t.value || null });
      const art = t.closest("[data-brawl-slot]");
      if (art) {
        const key = art.dataset.brawlSlot, [team, index] = key.split(":"), build = draftOf(art);
        pending[key] = build; last = ""; paint();   // 先照新草稿画菜单（后面几步能选什么跟着变）
        await submit({ type: "brawl.build", team, index: Number(index), build }, key);
      }
    }
    async function onClick(e) {
      const btn = e.target.closest("[data-brawl]"); if (!btn || btn.disabled) return;
      const a = btn.dataset.brawl, b = data(); if (!b) return;
      if (a === "leave") return void submit({ type: "brawl.seat", team: btn.dataset.team, index: Number(btn.dataset.index), kit: null });
      if (a === "aiRandom") return void submit({ type: "brawl.ai", index: Number(btn.dataset.index), kit: null });
      if (a === "ready") return void submit({ type: "brawl.ready", on: !(b.ready || []).includes(o.own()) });
      if (a === "start") {
        if (busy) return;
        busy = true; error = ""; last = ""; paint();
        try { const r = await o.api.start(); if (r && r.ok === false) error = r.error || "开打不了"; }
        catch (err) { error = (err && err.message) || "开打不了"; }
        finally { busy = false; last = ""; sync(); }
      }
    }
    box.addEventListener("change", onChange); box.addEventListener("click", onClick);
    return { sync, el: box, toss, destroy() { tossTimers.forEach(clearTimeout); box.remove(); toss.remove(); document.body.classList.remove("ol-brawl-room"); } };
  }

  const api = { mount, roomHtml, optionText, RULES, on };
  root.BrawlUI = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
