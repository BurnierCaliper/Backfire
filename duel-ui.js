/* Antlerscale: Backfire · 联机跑团「决斗」的申请 / 准备界面（PvP 第三步，#472，docs/pvp.md 第 1.2 节）
 * 规则：hotseat.js · requestDuel / decideDuel / openDuel / pickDuel / setDuelOptions（会话里的申请、选队、选项），hotseat-game.js · duelSpec，
 *       trpg-ui.js · toDuel（主持人开始决斗：布置战场），enemies.js · PVP_DUEL_CFG / pvpDuel*（战斗里的规则）
 *   玩家：探索环节标题工具栏「决斗」→ 浮层：
 *         没有决斗时「申请发起决斗」（duelRequest）；自己的申请在等主持人时可以撤回（duelDecide cancel）；
 *         准备中：给自己操控的角色选 1 队 / 2 队 / 不参加（duelPick），看得到每名角色选了哪一队、每队几人、主持人定的选项
 *   主持人：探索顶栏「进入战斗环节」旁边「决斗」（有人申请时写「决斗 · 有申请」）→ 浮层：同意 / 拒绝申请，没有申请时直接开启（duelOpen）；
 *         准备中：给没分配给玩家的角色选队，定「允许起身」「限定回合数」（duelOptions），两队都有人了点「开始决斗」（TrpgFlow.toDuel）；也可以取消
 *   只在探索环节（战斗中没有）。数据只用 view.duel（online-view.js 白名单：角色 kit、名字、操控者、选的队、选项），没有任何血量、坚毅生命数值。
 *   浮层带 .ovl（联机玩家页 online.css 只放行 .ol-ui / .ovl 等）；按钮 44px，样式沿用申请检定（.crq-*）。
 *   const d = DuelUI.mount({ api, view: () => view, own, call, playerName(id), toDuel() }); d.sync(); d.destroy() */
(function (root) {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  /** 两队、每队最多几人、打开回合上限时默认几回合：照规则层的 PVP_DUEL_CFG（enemies.js），没加载规则时用默认值 */
  function cfg() {
    const C = typeof PVP_DUEL_CFG !== "undefined" ? PVP_DUEL_CFG : null;
    return { teams: C ? C.teams.map(t => ({ id: t.id, name: t.name })) : [{ id: "1队", name: "1 队" }, { id: "2队", name: "2 队" }],
      max: C ? C.teamMax : 4, min: C ? C.teamMin : 1, rounds: C ? C.roundsDefault : 10, roundsMax: C ? C.roundsMax : 99 };
  }
  const teamName = id => (cfg().teams.find(t => t.id === id) || { name: id }).name;
  // 玩家看的规则说明（固定的文字，不带任何数值；坚毅这两个字不写——玩家画面上一律不出现）
  const RULES = "3 区制：1 队全站 1 区、2 队全站 3 区。开局抛硬币决定先手，后手每个角色先有 1 个附赠动作（先手的第一回合里就能用，没用掉的留到自己的第一回合）。" +
    "伤害不会致死：打到底的人「再起不能」、移出战场。一队全部倒地，另一队获胜。没有掉落、经验、奎支；结束后血量、伤势、武器耐久恢复成决斗前的样子，用掉的道具不恢复。";
  function optionText(d) {
    return `${d.stand ? "允许起身" : "不允许起身（倒地的人留在场上，能被专长救起来）"}；${d.rounds ? `限定 ${d.rounds} 回合（到了还没分出胜负，剩余血量百分比多的一队获胜，一样算平局）` : "不限回合"}`;
  }
  /** 两队各有谁、还没选的人 */
  function rosterHtml(m) {
    const heroes = m.duel.heroes || [];
    const cols = cfg().teams.map(t => {
      const list = heroes.filter(h => h.team === t.id);
      return `<div class="duel-team" data-duel-team="${esc(t.id)}"><h3>${esc(t.name)}（${list.length}/${cfg().max}）</h3><p>${list.length ? list.map(h => esc(h.name)).join("、") : '<span class="ol-muted">还没有人</span>'}</p></div>`;
    }).join("");
    const rest = heroes.filter(h => !h.team);
    return `<div class="duel-teams">${cols}</div>${rest.length ? `<p class="ol-muted duel-rest">不参加 / 还没选：${rest.map(h => esc(h.name)).join("、")}</p>` : ""}`;
  }
  /** 给一名角色选队的一行（自己操控的才有按钮） */
  function pickRow(h, m) {
    const full = id => (m.duel.heroes || []).filter(x => x.team === id).length >= cfg().max;
    const btn = (team, label) => {
      const on = (h.team || null) === team;
      return `<button type="button" class="g-btn ol-button crq-btn${on ? " ol-primary" : ""}" data-duel="pick" data-kit="${esc(h.kit)}" data-team="${esc(team || "")}" aria-pressed="${on ? "true" : "false"}"${on || m.busy || (team && full(team)) ? " disabled" : ""}>${esc(label)}</button>`;
    };
    return `<li class="crq-row duel-row" data-duel-kit="${esc(h.kit)}"><div><b>${esc(h.name)}</b>${m.showOwner && m.playerName ? `<small class="ol-muted"> · ${esc(m.playerName(h.owner))}</small>` : ""}</div>
      <div class="crq-state">${cfg().teams.map(t => btn(t.id, t.name)).join("")}${btn(null, "不参加")}</div></li>`;
  }
  /** 玩家浮层 */
  function playerHtml(m) {
    const d = m.duel, head = `<header><h2>决斗</h2><button type="button" class="g-btn ol-button crq-btn" data-duel="close">关闭</button></header>`;
    let body;
    if (!d) body = `<p>和队友切磋：只能在探索环节发起，主持人同意后大家选进 1 队或 2 队（每队最多 ${cfg().max} 人，两队人数可以不一样）。</p>
      <button type="button" class="g-btn ol-button ol-primary crq-btn" data-duel="request"${m.busy ? " disabled" : ""}>申请发起决斗</button>`;
    else if (d.status === "asked") body = d.by === m.own
      ? `<p>已经申请，等主持人同意。</p><button type="button" class="g-btn ol-button crq-btn" data-duel="cancel"${m.busy ? " disabled" : ""}>撤回申请</button>`
      : `<p>${esc(d.byName || "有人")} 申请了决斗，等主持人同意。</p>`;
    else {
      const mine = (d.heroes || []).filter(h => h.owner === m.own);
      body = `<p>主持人${d.by === m.gmId ? "开启" : "同意"}了决斗：给自己的角色选队，主持人点「开始决斗」后开打。</p>
        ${mine.length ? `<ul class="crq-list duel-mine">${mine.map(h => pickRow(h, m)).join("")}</ul>` : '<p class="ol-muted">你还没有操控的角色，看看就好。</p>'}
        ${rosterHtml(m)}<p class="duel-options"><b>主持人定的规则：</b>${esc(optionText(d))}</p>`;
    }
    return `<div class="ol-card crq-card duel-card">${head}${body}${m.error ? `<p class="ol-bad duel-error" role="alert">${esc(m.error)}</p>` : ""}<details class="duel-rules"><summary>决斗的规则</summary><p>${esc(RULES)}</p></details></div>`;
  }
  /** 主持人浮层 */
  function gmHtml(m) {
    const d = m.duel, head = `<header><h2>决斗</h2><button type="button" class="g-btn ol-button crq-btn" data-duel="close">关闭</button></header>`;
    let body;
    if (!d) body = `<p>开启以后玩家各自给自己的角色选进 1 队或 2 队（每队最多 ${cfg().max} 人）；没分配给玩家的角色由你来选。</p>
      <button type="button" class="g-btn ol-button ol-primary crq-btn" data-duel="open"${m.busy ? " disabled" : ""}>开启决斗</button>`;
    else if (d.status === "asked") body = `<p><b>${esc(d.byName || "有人")}</b> 申请发起决斗。</p>
      <div class="crq-state"><button type="button" class="g-btn ol-button ol-primary crq-btn" data-duel="approve"${m.busy ? " disabled" : ""}>同意</button>
      <button type="button" class="g-btn ol-button crq-btn" data-duel="reject"${m.busy ? " disabled" : ""}>不同意</button></div>`;
    else {
      const heroes = d.heroes || [];
      const ready = cfg().teams.every(t => { const n = heroes.filter(h => h.team === t.id).length; return n >= cfg().min && n <= cfg().max; });
      const others = heroes.filter(h => h.owner !== m.own);
      body = `${heroes.some(h => h.owner === m.own) ? `<h3>没分配给玩家的角色</h3><ul class="crq-list duel-mine">${heroes.filter(h => h.owner === m.own).map(h => pickRow(h, m)).join("")}</ul>` : ""}
        ${others.length ? `<h3>玩家的角色（由玩家自己选）</h3><ul class="crq-list duel-others">${others.map(h => `<li class="crq-row"><div><b>${esc(h.name)}</b><small class="ol-muted"> · ${esc(m.playerName ? m.playerName(h.owner) : h.owner)}</small></div><div class="crq-state"><span class="crq-chip">${esc(h.team ? teamName(h.team) : "不参加")}</span></div></li>`).join("")}</ul>` : ""}
        ${rosterHtml(m)}
        <div class="duel-opts"><label><input type="checkbox" id="duel-stand"${d.stand ? " checked" : ""}${m.busy ? " disabled" : ""}> 允许起身</label>
        <label><input type="checkbox" id="duel-limit"${d.rounds ? " checked" : ""}${m.busy ? " disabled" : ""}> 限定回合数</label>
        <label>回合数 <input type="number" id="duel-rounds" min="1" max="${cfg().roundsMax}" value="${esc(d.rounds || m.rounds || cfg().rounds)}"${d.rounds && !m.busy ? "" : " disabled"}></label></div>
        <p class="ol-muted">${esc(optionText(d))}</p>
        <div class="crq-state"><button type="button" class="g-btn ol-button ol-primary crq-btn" data-duel="start"${ready && !m.busy ? "" : " disabled"}>开始决斗</button>
        <button type="button" class="g-btn ol-button crq-btn" data-duel="cancel"${m.busy ? " disabled" : ""}>取消决斗</button></div>
        ${ready ? "" : `<p class="ol-muted">每队至少 ${cfg().min} 人、最多 ${cfg().max} 人才能开打。</p>`}`;
    }
    return `<div class="ol-card crq-card duel-card">${head}${body}${m.error ? `<p class="ol-bad duel-error" role="alert">${esc(m.error)}</p>` : ""}</div>`;
  }

  // 玩家的入口：探索环节舞台顶上那一排（战斗中没有：纸片画面的「工具 ▾」只在战斗里，不放）
  const TOOLS = "#online-stage .ol-stage-heading .ol-info-tools";
  const OPENERS = '#online-stage [data-duel="open-box"], #tr-duel';
  function mount(o) {
    const doc = root.document;
    const box = doc.createElement("section"); box.id = "online-duel"; box.className = "ol-ui ol-overlay ol-bag ovl duel"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "决斗"); box.hidden = true;
    doc.body.appendChild(box);
    let open = false, busy = false, last = "", error = "", seenPrep = null, rounds = null;
    const v = () => o.view() || {}, hs = () => (v().packet && v().packet.view) || {};
    const duel = () => hs().duel || null;
    // 只在联机跑团的探索环节（房主本机看 screen：不在战斗画面）
    const enabled = () => !!(v().active && v().packet && v().packet.mode !== "rogue" && v().screen === "exploration");
    const model = () => ({ own: o.own(), gmId: hs().hostId || hs().gmId || null, duel: duel(), busy, error, rounds, playerName: o.playerName, showOwner: !!v().isHost });
    function paint() {
      if (!open) return;
      const html = v().isHost ? gmHtml(model()) : playerHtml(model());
      if (html !== last) { last = html; box.innerHTML = html; }
    }
    function label() {
      const d = duel();
      if (v().isHost) return d && d.status === "asked" ? "决斗 · 有申请" : d ? "决斗 · 准备中" : "决斗";
      if (!d) return "决斗";
      return d.status === "asked" ? (d.by === o.own() ? "决斗 · 等主持人" : "决斗 · 有人申请") : "决斗 · 选队";
    }
    /** 主持人：探索顶栏「进入战斗环节」旁边一个入口（不是联机跑团的房主、不在探索环节就拿掉） */
    function hostButton(on) {
      const at = doc.querySelector("#tr-fight");   // 用 querySelector：game.html 给 getElementById 垫了一层，找不到的 id 会凭空造一个 div
      let b = doc.querySelector("#tr-duel");
      if (!on || !at) { if (b) b.remove(); return; }
      if (!b) { b = doc.createElement("button"); b.type = "button"; b.id = "tr-duel"; b.className = "g-btn"; b.title = "决斗：玩家之间切磋（只能在探索环节）"; at.after(b); }
      const text = label(); if (b.textContent !== text) b.textContent = text;
      b.dataset.alert = duel() && duel().status === "asked" ? "1" : "";
    }
    function sync() {
      const on = enabled(), isHost = !!v().isHost;
      hostButton(on && isHost);
      if (!on || isHost) doc.querySelectorAll('#online-stage [data-duel="open-box"]').forEach(b => b.remove());
      if (!on) { open = false; box.hidden = true; return; }
      const d = duel();
      // 主持人同意 / 开启了：有能参加的角色的玩家自动打开一次浮层（每场决斗只开一次）
      if (!isHost && d && d.status === "prep" && seenPrep !== d.id) {
        seenPrep = d.id;
        if ((d.heroes || []).some(h => h.owner === o.own())) { open = true; last = ""; }
      }
      if (!isHost) {
        const tools = doc.querySelector(TOOLS);
        if (tools) {
          let b = tools.querySelector('[data-duel="open-box"]');
          if (!b) { b = doc.createElement("button"); b.type = "button"; b.className = "g-btn ol-button"; b.dataset.duel = "open-box"; tools.appendChild(b); }
          const text = label(); if (b.textContent !== text) b.textContent = text;
          if (d && (d.status === "prep" || d.by === o.own())) b.dataset.alert = "1"; else delete b.dataset.alert;
        }
      }
      box.hidden = !open; paint();
    }
    // 出错（满员、不在探索环节……）照申请检定的做法由 o.call 写在联机画面的提示里
    async function submit(cmd) {
      if (busy) return false; busy = true; error = ""; last = ""; paint();
      try { return await o.call(() => o.api.submit(cmd)); } finally { busy = false; last = ""; paint(); }
    }
    async function onClick(e) {
      const b = e.target.closest("[data-duel]"); if (!b) { if (e.target === box) { open = false; sync(); } return; }
      const a = b.dataset.duel;
      if (a === "close") { open = false; sync(); return; }
      if (a === "request") return void submit({ type: "duelRequest" });
      if (a === "cancel") return void submit({ type: "duelDecide", decision: "cancel" });
      if (a === "approve") return void submit({ type: "duelDecide", decision: "approve" });
      if (a === "reject") return void submit({ type: "duelDecide", decision: "reject" });
      if (a === "open") return void submit({ type: "duelOpen" });
      if (a === "pick") return void submit({ type: "duelPick", kit: b.dataset.kit, team: b.dataset.team || null });
      if (a === "start") {
        // 布置战场在房主本机（trpg-ui.js · toDuel）：人数不对这些直接把原因写在浮层上
        error = ""; last = "";
        try { if (typeof o.toDuel === "function") o.toDuel(); open = false; } catch (err) { error = (err && err.message) || "开始不了"; }
        sync();
      }
    }
    async function onChange(e) {
      const t = e.target;
      if (t.id === "duel-stand") await submit({ type: "duelOptions", stand: !!t.checked });
      else if (t.id === "duel-limit") await submit({ type: "duelOptions", rounds: t.checked ? Math.max(1, Math.min(cfg().roundsMax, Math.floor(Number(rounds) || cfg().rounds))) : null });
      else if (t.id === "duel-rounds") {
        const n = Math.floor(Number(t.value));
        if (!Number.isFinite(n) || n < 1 || n > cfg().roundsMax) { error = `回合数要在 1 到 ${cfg().roundsMax} 之间`; last = ""; paint(); return; }
        rounds = n;
        if (duel() && duel().rounds) await submit({ type: "duelOptions", rounds: n });
      }
    }
    const onKey = e => { e.stopPropagation(); if (e.key === "Escape") { open = false; sync(); } };
    // 入口按钮（玩家舞台顶上那一排、主持人探索顶栏）会跟着画面重画，点击统一在 document 上接
    const openFrom = e => { const b = e.target.closest(OPENERS); if (b) { open = true; error = ""; last = ""; sync(); box.querySelector('[data-duel="close"]')?.focus({ preventScroll: true }); } };
    box.addEventListener("click", onClick); box.addEventListener("change", onChange); box.addEventListener("keydown", onKey);
    doc.addEventListener("click", openFrom);
    return { sync, el: box, destroy() { doc.removeEventListener("click", openFrom); box.remove(); const b = doc.querySelector("#tr-duel"); if (b) b.remove(); } };
  }

  const api = { mount, playerHtml, gmHtml, optionText, RULES };
  root.DuelUI = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
