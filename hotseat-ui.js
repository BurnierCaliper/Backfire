/* D2 热座表现层：只读取桥接投影并提交数据，不直接访问规则 state。 */
(function (global) {
  "use strict";
  let mounted = null;
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const option = (value, label, selected) => `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;

  function mount(api) {
    if (mounted) mounted.destroy();
    if (!api || typeof api.getView !== "function" || typeof document === "undefined") return null;
    let root = null, panel = null, reaction = null, swapBox = null, unsubscribe = null, observer = null;
    let view = {}, lastMarkup = {}, draft = null, configOpen = null, chosenActor = "", chatDraft = "", notice = "", pending = false, dragActor = "";
    let destroyed = false;
    const byId = id => document.getElementById(id);
    const players = () => view.players || [];
    const playerName = id => (players().find(p => p.id === id) || {}).name || id || "未分配";
    const units = () => view.units || view.heroes || [];
    const unitName = id => (units().find(u => (u.id || u.actor) === id) || (view.order || []).find(u => u && u.actor === id) || {}).name || id || "空位";
    const ownerOf = u => u && (u.owner || u.operatorId);
    const unitId = u => u && (u.id || u.actor || u.unitId);
    const order = () => (view.order || []).map(u => u || {});
    const confirmed = id => Array.isArray(view.confirmed) ? view.confirmed.includes(id) : !!(view.confirmed || {})[id];
    const mayConfigure = () => view.canConfigure == null ? ["setup", "ended"].includes(view.phase) : !!view.canConfigure;
    const isHost = () => view.playerId === view.hostId;
    const canMove = slot => ["picking", "acting"].includes(view.phase) && slot.actor && !slot.locked && !slot.done && (ownerOf(slot) === view.playerId || (view.mode === "trpg" && isHost()));
    const slotFixed = slot => !!slot && !!(slot.locked || slot.done);
    const legalDestination = (from, to) => to >= 0 && to < order().length + (view.phase === "acting" ? 1 : 0) && from !== to && !slotFixed(order()[to]) && !order().some((slot, index) => slotFixed(slot) && index > to);

    function ensure() {
      if (root) return;
      root = document.createElement("section"); root.id = "hotseat-root"; root.className = "hs-ui"; root.setAttribute("aria-label", "热座控制");
      root.innerHTML = '<div id="hs-bar"></div><div id="hs-order"></div><p id="hs-notice" role="status" aria-live="polite" hidden></p>';
      document.body.appendChild(root);
      panel = document.createElement("section"); panel.id = "hs-panel"; panel.className = "hs-ui hs-overlay"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "热座分配与行动顺序");
      reaction = document.createElement("section"); reaction.id = "hs-reaction"; reaction.className = "hs-ui hs-overlay"; reaction.setAttribute("role", "dialog"); reaction.setAttribute("aria-label", "协助询问");
      swapBox = document.createElement("section"); swapBox.id = "hs-swap"; swapBox.className = "hs-ui hs-swap"; swapBox.setAttribute("role", "status");
      document.body.append(panel, reaction, swapBox);
      for (const node of [root, panel, reaction, swapBox]) {
        node.addEventListener("click", click);
        // The battle's Tab/number/Space shortcuts must not consume form/button keys.
        node.addEventListener("keydown", event => event.stopPropagation());
      }
      root.addEventListener("change", change); panel.addEventListener("change", change);
      panel.addEventListener("input", input);
      panel.addEventListener("submit", event => { event.preventDefault(); if (event.target.id === "hs-chat-form") sendChat(); });
      root.addEventListener("dragstart", event => {
        const item = event.target.closest("[data-drag-actor]");
        if (!item || !item.draggable) return;
        dragActor = item.dataset.dragActor; if (event.dataTransfer) { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", dragActor); }
      });
      root.addEventListener("dragover", event => {
        const item = event.target.closest("[data-order-index]");
        const from = order().findIndex(slot => slot.actor === dragActor);
        if (item && from >= 0 && legalDestination(from, Number(item.dataset.orderIndex))) event.preventDefault();
      });
      root.addEventListener("drop", event => {
        const item = event.target.closest("[data-order-index]"), from = order().findIndex(slot => slot.actor === dragActor);
        if (!item || from < 0 || !legalDestination(from, Number(item.dataset.orderIndex))) return;
        event.preventDefault(); const actor = dragActor; dragActor = ""; send({ type: "orderMove", actor, index: Number(item.dataset.orderIndex) });
      });
      root.addEventListener("dragend", () => { dragActor = ""; });
      if (typeof ResizeObserver !== "undefined") { observer = new ResizeObserver(reserveSpace); observer.observe(root); }
    }
    function reserveSpace() { if (root && !root.hidden) document.body.style.setProperty("--hs-top-height", `${Math.ceil(root.getBoundingClientRect().height)}px`); }
    function html(node, value, key) {
      if (lastMarkup[key] === value) return;
      const focused = document.activeElement, focusId = focused && node.contains(focused) ? focused.id : "";
      const start = focused && typeof focused.selectionStart === "number" ? focused.selectionStart : null;
      lastMarkup[key] = value; node.innerHTML = value;
      if (focusId && byId(focusId)) { const el = byId(focusId); el.focus({ preventScroll: true }); if (start != null && el.setSelectionRange) { try { el.setSelectionRange(start, start); } catch (_) {} } }
    }
    function initDraft() {
      const list = players().length >= 2 ? players().map(p => ({ id: p.id, name: p.name, gm: !!p.gm })) : [{ id: "p1", name: "主持人", gm: true }, { id: "p2", name: "玩家 2", gm: false }];
      const mode = view.mode || "trpg", assignments = {};
      (view.heroes || []).forEach((u, i) => { assignments[unitId(u)] = (view.configured === false ? null : ownerOf(u)) || (list[i] || list[0]).id; });
      draft = { mode, players: list, assignments };
      if (mode === "trpg" && !list.some(p => p.gm)) list[0].gm = true;
    }
    function button(label, action, data = "", disabled = false, cls = "") { return `<button type="button" class="hs-button ${cls}" data-hs="${action}" ${data}${disabled || pending ? " disabled" : ""}>${esc(label)}</button>`; }
    function chatMarkup() {
      if (!["setup", "picking"].includes(view.phase)) return "";
      const rows = (view.chat || []).map(row => `<li><b>${esc(row.name || playerName(row.playerId || row.sender))}</b><span>${esc(row.text)}</span></li>`).join("");
      return `<section class="hs-chat" aria-label="顺序协商"><h3>商量一下</h3><ul id="hs-chat-log" aria-live="polite">${rows || '<li class="hs-muted">在这里商量本回合的行动顺序。</li>'}</ul><form id="hs-chat-form"><label class="hs-sr-only" for="hs-chat-text">交流内容</label><input id="hs-chat-text" type="text" maxlength="500" autocomplete="off" placeholder="输入消息…" value="${esc(chatDraft)}"><button class="hs-button" type="submit"${pending ? " disabled" : ""}>发送</button></form></section>`;
    }
    function setupMarkup() {
      if (!draft) initDraft();
      const liveIds = new Set((view.heroes || []).map(unitId));
      for (const id of Object.keys(draft.assignments)) if (!liveIds.has(id)) delete draft.assignments[id];
      (view.heroes || []).forEach((u, i) => {
        if (!draft.assignments[unitId(u)]) draft.assignments[unitId(u)] = (view.configured === false ? null : ownerOf(u)) || (draft.players[i] || draft.players[0]).id;
      });
      const gm = (draft.players.find(p => p.gm) || draft.players[0]).id;
      const heroRows = (view.heroes || []).map(u => `<label class="hs-assignment"><span>${esc(u.name || unitId(u))}</span><select data-assignment="${esc(unitId(u))}" aria-label="${esc(u.name || unitId(u))}的操作者">${draft.players.map(p => option(p.id, p.name + (draft.mode === "trpg" && p.id === gm ? " · 主持人" : ""), draft.assignments[unitId(u)] === p.id)).join("")}</select></label>`).join("");
      return `<div class="hs-card"><header class="hs-heading"><h2>角色分配</h2>${button("收起", "closeConfig")}</header><p class="hs-muted">在一台设备上轮流操作。开始战斗后，本场分配固定。</p><div class="hs-config-row"><label>模式<select id="hs-mode">${option("trpg", "跑团 · 主持人可代操作多名角色", draft.mode === "trpg")}${option("coop", "合作 · 每人一名角色", draft.mode === "coop")}</select></label><label>操作员<select id="hs-count">${[2, 3, 4].map(n => option(n, `${n} 人`, n === draft.players.length)).join("")}</select></label></div><div class="hs-players">${draft.players.map((p, i) => `<label>操作者 ${i + 1}<input id="hs-name-${i}" data-player-name="${esc(p.id)}" maxlength="24" value="${esc(p.name)}"></label>`).join("")}</div>${draft.mode === "trpg" ? `<label class="hs-gm">主持人<select id="hs-gm">${draft.players.map(p => option(p.id, p.name, p.id === gm)).join("")}</select></label>` : '<p class="hs-muted">上场英雄数应等于操作员人数，每人分配一名。可先收起此面板，用「队伍配置」调整。</p>'}<div class="hs-assignments">${heroRows || '<p class="hs-muted">请先进入战斗准备画面，配置上场队伍。</p>'}</div><footer class="hs-footer">${button("应用分配", "configure", "", !(view.heroes || []).length, "hs-primary")}${api.disable && view.canDisable !== false ? button("退出热座", "disable") : ""}</footer>${chatMarkup()}</div>`;
    }
    function pickingMarkup() {
      const own = units().filter(u => ownerOf(u) === view.playerId);
      if (!own.some(u => unitId(u) === chosenActor)) chosenActor = own.length ? unitId(own[0]) : "";
      const allPlaced = own.every(u => order().some(slot => slot.actor === unitId(u)));
      return `<div class="hs-card"><header class="hs-heading"><h2>行动顺序</h2><span class="hs-muted">选择不限时</span></header><p>为自己的每个单位选一个格子，再点「确定」。武器人各占一格。</p>${own.length ? `<label class="hs-unit-picker">正在安排<select id="hs-pick-unit">${own.map(u => option(unitId(u), u.name || unitId(u), chosenActor === unitId(u))).join("")}</select></label>` : '<p class="hs-muted">你目前没有可行动的单位，本场旁观。</p>'}<div class="hs-slots">${order().map((slot, i) => button(`${i + 1} · ${slot.actor ? unitName(slot.actor) : "空位"}`, "pick", `data-index="${i}"`, !chosenActor, slot.actor === chosenActor ? "hs-selected" : "")).join("")}</div><ul class="hs-confirmations">${players().map(p => `<li>${esc(p.name)} <b>${!units().some(u => ownerOf(u) === p.id) ? "旁观" : confirmed(p.id) ? "已确定" : "选择中"}</b></li>`).join("")}</ul><footer class="hs-footer">${button(confirmed(view.playerId) ? "已确定 · 可继续改选" : "确定我的顺序", "confirm", "", !own.length || !allPlaced || confirmed(view.playerId), "hs-primary")}${isHost() ? button("按当前格子开始", "forceStart") : ""}</footer>${chatMarkup()}</div>`;
    }
    function renderBar() {
      const labels = { setup: "战前分配", picking: "选择行动顺序", acting: "我方行动", enemy: "敌方行动", ended: "战斗结束" };
      const operator = view.network ? `<span>${esc(playerName(view.playerId))} · ${isHost() ? "主持人" : "玩家"}</span>` : `<label for="hs-player">当前操作员</label><select id="hs-player">${players().map(p => option(p.id, p.name + (p.gm ? " · 主持人" : ""), p.id === view.playerId)).join("")}</select>`;
      html(byId("hs-bar"), `<strong class="hs-tag">${view.network ? "联机跑团" : "热座"}</strong>${operator}<span class="hs-phase">${esc(labels[view.phase] || "等待战斗")}</span>${view.network ? "" : button("分配角色", "openConfig", "", !mayConfigure())}`, "bar");
      const visible = ["picking", "acting", "enemy"].includes(view.phase);
      byId("hs-order").hidden = !visible;
      if (!visible) return;
      const current = order().find(slot => slot.current) || order().find(slot => slot.actor === view.currentUnitId);
      const text = view.phase === "acting" && current ? `现在轮到 ${unitName(current.actor)} · ${playerName(ownerOf(current))}` : view.phase === "enemy" ? "敌人行动中" : "为本回合选择行动顺序";
      html(byId("hs-order"), `<div class="hs-turn" role="status">${esc(text)}</div><ol class="hs-strip">${order().map((slot, i) => {
        const movable = canMove(slot), actor = slot.actor || "", status = slot.done ? "已结束" : slot.locked ? "已用点数 · 锁定" : slot.current || actor === view.currentUnitId ? "当前" : "未行动";
        return `<li data-order-index="${i}" data-drag-actor="${esc(actor)}" draggable="${movable}" class="${slot.current || actor === view.currentUnitId ? "hs-current " : ""}${slotFixed(slot) ? "hs-locked" : ""}${!actor && view.phase !== "picking" ? " hs-vacated" : ""}"><span class="hs-slot-num">${i + 1}</span><div><b>${esc(actor ? unitName(actor) : "空位")}</b><small>${esc(actor ? `${playerName(ownerOf(slot))} · ${status}` : view.phase === "picking" ? "等待选择" : "已挪走")}</small></div>${movable ? `<div class="hs-moves">${button("前移", "move", `data-actor="${esc(actor)}" data-index="${i - 1}" aria-label="${esc(unitName(actor))}前移"`, !legalDestination(i, i - 1))}${button("后移", "move", `data-actor="${esc(actor)}" data-index="${i + 1}" aria-label="${esc(unitName(actor))}后移"`, !legalDestination(i, i + 1))}${view.phase === "acting" ? button("末尾", "move", `data-actor="${esc(actor)}" data-index="${order().length}" aria-label="${esc(unitName(actor))}移至末尾"`) : ""}</div>` : ""}</li>`;
      }).join("")}${view.phase === "acting" ? `<li class="hs-tail" data-order-index="${order().length}"><span class="hs-slot-num">${order().length + 1}</span><div><b>空位</b><small>拖到这里移至末尾</small></div></li>` : ""}</ol>`, "order");
    }
    function renderAsk() {
      const ask = view.ask;
      reaction.hidden = !ask;
      if (!ask) { lastMarkup.ask = ""; return; }
      const options = ask.eligible && !ask.declined ? ask.options || [] : [];
      const waiting = (ask.waitingNames || []).join("、");
      const choice = ask.kind === "choice", canDecline = ask.allowDecline == null ? !choice : !!ask.allowDecline;
      html(reaction, `<div class="hs-card hs-ask-card"><header class="hs-heading"><h2>${esc(ask.title || (choice ? "选择" : ask.kind === "block" ? "协助格挡" : "协助攻击"))}</h2><strong id="hs-countdown" role="timer" aria-label="回应剩余时间"${Number(ask.deadline) > 0 ? "" : " hidden"}></strong></header><p>${esc(ask.declined ? "你已选择不协助，正在等待其他玩家回应。" : options.length ? choice ? "请为自己操作的角色选择。" : "选择自己的单位协助。先回答「我来」的玩家生效。" : `正在等待${waiting || "符合条件的玩家"}回应。`)}</p><div class="hs-ask-options">${options.map((o, index) => `${button(`${choice ? "" : "我来 · "}${o.label || unitName(o.helper)}`, "answer", `data-option="${index}" data-helper="${esc(o.helper)}"`, false, "hs-primary")}${o.sub ? `<small>${esc(o.sub)}</small>` : ""}`).join("")}${options.length && canDecline ? button(ask.cancelLabel || "不协助", "decline") : ""}</div></div>`, "ask");
      updateCountdown();
    }
    function updateCountdown() {
      const node = byId("hs-countdown");
      if (node && view.ask && Number(view.ask.deadline) > 0) node.textContent = `${Math.max(0, Math.ceil((Number(view.ask.deadline) - Date.now()) / 1000)) || 0} 秒`;
    }
    function renderSwap() {
      const swap = view.swap; swapBox.hidden = !swap;
      if (!swap) { lastMarkup.swap = ""; return; }
      const mine = swap.recipient === view.playerId;
      html(swapBox, `<strong>${esc(unitName(swap.from))} ↔ ${esc(unitName(swap.to))}</strong><p>${esc(mine ? "对方想与你的单位互换顺序。" : `正在等待${playerName(swap.recipient)}同意互换。`)}</p>${mine ? `<div class="hs-footer">${button("同意互换", "swapYes", "", false, "hs-primary")}${button("不同意", "swapNo")}</div>` : ""}`, "swap");
    }
    function render() {
      if (destroyed) return;
      view = api.getView() || {};
      if (!view.enabled) {
        if (root) for (const node of [root, panel, reaction, swapBox]) node.hidden = true;
        document.body.classList.remove("hotseat-active"); document.body.style.removeProperty("--hs-top-height"); return;
      }
      ensure(); root.hidden = false; document.body.classList.add("hotseat-active");
      renderBar();
      if (configOpen == null) configOpen = view.phase === "setup";
      const showConfig = configOpen && mayConfigure(), showPick = view.phase === "picking";
      panel.hidden = !(showConfig || showPick);
      if (!panel.hidden) html(panel, showPick ? pickingMarkup() : setupMarkup(), "panel");
      renderAsk(); renderSwap();
      const n = byId("hs-notice"), message = notice || view.notice || ""; n.textContent = message; n.hidden = !message; reserveSpace();
    }
    async function call(fn, value) {
      if (pending) return;
      pending = true; notice = ""; render();
      try { const result = await fn.call(api, value); if (result && result.ok === false) { notice = result.error || "操作未生效"; return false; } return true; }
      catch (error) { notice = error.message || String(error); return false; }
      finally { pending = false; render(); }
    }
    const send = command => call(api.submit, command);
    async function sendChat() { const text = chatDraft.trim(); if (!text) return; if (await send({ type: "chat", text })) { chatDraft = ""; render(); } }
    async function click(event) {
      const b = event.target.closest("[data-hs]"); if (!b || b.disabled) return;
      switch (b.dataset.hs) {
        case "openConfig": initDraft(); configOpen = true; render(); break;
        case "closeConfig": configOpen = false; render(); break;
        case "configure": {
          if (await call(api.configure, JSON.parse(JSON.stringify(draft)))) { configOpen = false; draft = null; render(); }
          break;
        }
        case "disable": if (api.disable) await call(api.disable); break;
        case "pick": await send({ type: "orderPick", actor: chosenActor, index: Number(b.dataset.index) }); break;
        case "confirm": await send({ type: "orderConfirm" }); break;
        case "forceStart": await send({ type: "orderStart" }); break;
        case "move": await send({ type: "orderMove", actor: b.dataset.actor, index: Number(b.dataset.index) }); break;
        case "swapYes": case "swapNo": if (view.swap) await send({ type: "orderSwapAccept", requestId: view.swap.requestId, accept: b.dataset.hs === "swapYes" }); break;
        case "answer": case "decline": if (view.ask) {
          const selected = (view.ask.options || [])[Number(b.dataset.option)], command = { type: "answer", askId: view.ask.id, helper: b.dataset.hs === "decline" ? null : selected.helper };
          if (b.dataset.hs === "answer" && Object.prototype.hasOwnProperty.call(selected, "extra")) command.extra = JSON.parse(JSON.stringify(selected.extra));
          await send(command);
        } break;
      }
    }
    function input(event) {
      const t = event.target;
      if (t.id === "hs-chat-text") chatDraft = t.value;
      if (t.dataset.playerName && draft) { const p = draft.players.find(p => p.id === t.dataset.playerName); if (p) p.name = t.value; }
    }
    function change(event) {
      const t = event.target;
      if (t.id === "hs-player") { call(api.switchPlayer, t.value); return; }
      if (t.id === "hs-pick-unit") { chosenActor = t.value; render(); return; }
      if (!draft) return;
      if (t.id === "hs-mode") {
        draft.mode = t.value; draft.players.forEach((p, i) => { p.gm = draft.mode === "trpg" && i === 0; });
      } else if (t.id === "hs-count") {
        const count = Number(t.value);
        while (draft.players.length < count) { const i = draft.players.length + 1; let id = `p${i}`; while (draft.players.some(p => p.id === id)) id += "_"; draft.players.push({ id, name: `玩家 ${i}`, gm: false }); }
        draft.players.length = count;
        for (const id of Object.keys(draft.assignments)) if (!draft.players.some(p => p.id === draft.assignments[id])) draft.assignments[id] = draft.players[0].id;
        if (draft.mode === "trpg" && !draft.players.some(p => p.gm)) draft.players[0].gm = true;
      } else if (t.id === "hs-gm") draft.players.forEach(p => { p.gm = p.id === t.value; });
      else if (t.dataset.assignment) draft.assignments[t.dataset.assignment] = t.value;
      render();
    }
    function destroy() {
      destroyed = true; if (unsubscribe) unsubscribe(); if (observer) observer.disconnect(); clearInterval(timer);
      for (const node of [root, panel, reaction, swapBox]) if (node) node.remove();
      document.body.classList.remove("hotseat-active"); document.body.style.removeProperty("--hs-top-height"); if (mounted && mounted.destroy === destroy) mounted = null;
    }
    const timer = setInterval(updateCountdown, 250);
    mounted = { render, destroy };
    if (typeof api.subscribe === "function") unsubscribe = api.subscribe(render);
    render(); return mounted;
  }
  global.HotseatUI = { mount };
  function boot() { if (new URLSearchParams(location.search).get("hotseat") === "1" && global.HotseatGame) mount(global.HotseatGame); }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
  }
})(typeof window !== "undefined" ? window : globalThis);
