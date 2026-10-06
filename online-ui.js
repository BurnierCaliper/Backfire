/* D3 display client. This module only reads the OnlineGame presentation API;
 * it never invokes battle rules or uses a received DTO as authoritative state. */
(function (global) {
  "use strict";
  let mounted;
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const copy = value => JSON.parse(JSON.stringify(value));
  const labels = { flesh: "生命", armor: "护甲", shield: "护盾", sand: "砂甲", spirit: "灵体", none: "常态", heat: "酷暑", snow: "雪天", acid: "酸雨", thunder: "雷鸣", glow: "微光", phase: "相位" };
  const names = { nano: "纳米", bean: "咖啡豆", liquid: "咖啡液", durability: "耐久", shield: "盾", charge: "充能", energyPct: "能量", light: "光", debrisCount: "碎块", burn: "灼烧", shock: "感电", corr: "腐蚀", frostbite: "冻伤", shockwave: "震荡", high: "高能", reso: "共振", weak: "虚弱", inspire: "振奋", hide: "躲藏", advantage: "优势", chase: "紧追", sturdy: "坚固" };
  function mount(api) {
    if (mounted) mounted.destroy();
    if (!api || typeof api.getView !== "function" || typeof document === "undefined") return null;
    let view = {}, panelOpen = false, entry = "join", notice = "", pending = false, destroyed = false;
    let currentMenu = null, request = null, selectedActor = "", actionGeneration = 0, playbackGeneration = 0;
    let displayState = null, animating = false, messagesInitialized = false, seenMessages = new Set(), toastTimer;
    let historyRows = [], historyRoom = "", historyHasMore = true, historyLoading = false, historyGeneration = 0;
    let form = { url: "", name: "", roomCode: "", slot: "0", campaignName: "", to: "all", text: "", chatText: "" }, assignments = {};
    const unsubs = [], nodes = [], titleButtons = [], lastMarkup = {};
    const byId = id => document.getElementById(id);
    const own = () => view.identity && view.identity.id;
    const players = () => view.players || [];
    const playerName = id => (players().find(p => p.id === id) || {}).name || id || "主持人";
    const hs = () => view.packet && view.packet.view || {};
    const paused = () => !view.status?.connected || !view.status?.hostOnline || !!view.status?.paused;
    const disabled = () => pending || paused() || animating;
    const button = (text, action, data = "", off = false, primary = false) => `<button type="button" class="ol-button${primary ? " ol-primary" : ""}" data-online="${action}" ${data}${off ? " disabled" : ""}>${esc(text)}</button>`;
    const option = (value, text, selected) => `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(text)}</option>`;
    function make(tag, id, className, attrs = {}) {
      const node = document.createElement(tag); node.id = id; node.className = "ol-ui " + className;
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      document.body.appendChild(node); nodes.push(node); return node;
    }
    const dock = make("div", "online-dock", "ol-dock");
    const stage = make("main", "online-stage", "ol-stage", { "aria-label": "联机战场" });
    const panel = make("section", "online-panel", "ol-overlay", { role: "dialog", "aria-label": "联机房间" });
    const toast = make("aside", "online-toast", "ol-toast", { role: "status", "aria-live": "polite" });
    toast.hidden = true;
    for (const node of [dock, stage, panel]) {
      node.addEventListener("click", click);
      node.addEventListener("keydown", event => { event.stopPropagation(); if (event.key === "Escape" && panelOpen && view.screen !== "lobby") { panelOpen = false; render(); } });
      node.addEventListener("input", input); node.addEventListener("change", change);
      node.addEventListener("submit", event => { event.preventDefault(); if (event.target.id === "ol-message-form") sendMessage(); if (event.target.id === "ol-lobby-chat") sendLobbyChat(); });
    }
    function html(node, markup, key) {
      if (lastMarkup[key] === markup) return;
      const focused = document.activeElement, id = focused && node.contains(focused) ? focused.id : "";
      const start = focused && typeof focused.selectionStart === "number" ? focused.selectionStart : null;
      lastMarkup[key] = markup; node.innerHTML = markup;
      if (id && byId(id)) { const el = byId(id); el.focus({ preventScroll: true }); if (start != null && el.setSelectionRange) { try { el.setSelectionRange(start, start); } catch (_) {} } }
    }
    function entryMarkup() {
      const slots = typeof api.slots === "function" ? api.slots() : [];
      return `<div class="ol-card"><header><h2>${entry === "create" ? "联机开房" : "加入房间"}</h2>${button("关闭", "close")}</header><div class="ol-entry-tabs">${button("我来主持", "createTab", "", pending, entry === "create")}${button("加入朋友", "joinTab", "", pending, entry === "join")}</div><label>转发服务地址<input id="ol-url" data-field="url" type="url" placeholder="https://你的转发服务" value="${esc(form.url)}" autocomplete="url"></label><label>昵称<input id="ol-name" data-field="name" maxlength="24" value="${esc(form.name)}" autocomplete="nickname"></label>${entry === "create" ? `<label>跑团存档<select id="ol-slot" data-field="slot">${slots.map(s => option(s.index, `${s.index + 1} · ${s.name}`, String(s.index) === form.slot)).join("")}</select></label><label>新团名称<input id="ol-campaign" data-field="campaignName" maxlength="40" placeholder="空白存档使用此名称" value="${esc(form.campaignName)}"></label>` : `<label>房间码<input id="ol-code" data-field="roomCode" maxlength="6" autocapitalize="characters" spellcheck="false" placeholder="六位房间码" value="${esc(form.roomCode)}"></label>`}<p class="ol-muted">使用与朋友相同的转发服务地址。进入房间后，断线会自动尝试重连。</p><footer>${button(pending ? "连接中…" : entry === "create" ? "创建房间" : "加入", "connect", "", pending, true)}${api.hasSaved?.() ? button("恢复上次房间", "resume", "", pending) : ""}</footer><p class="ol-notice" role="status">${esc(notice)}</p></div>`;
    }
    function rosterMarkup() {
      const heroes = view.heroes || [], mayAssign = view.isHost && ["lobby", "exploration", "ended"].includes(view.screen);
      return `<section><h3>房间成员</h3><ul class="ol-roster">${players().map(p => `<li><span><b>${esc(p.name)}</b>${p.gm ? ' <small>主持人</small>' : ""}</span><span class="${p.online ? "ol-online" : "ol-muted"}">${p.online ? "在线" : "离线"}</span><small>${esc(heroes.filter(h => h.owner === p.id).map(h => h.name).join("、") || (p.gm ? "未分配角色由主持人操作" : "等待分配角色"))}</small></li>`).join("")}</ul>${mayAssign ? `<div class="ol-assignments">${heroes.map(h => `<label><span>${esc(h.name)}</span><select data-assign="${esc(h.id)}" aria-label="${esc(h.name)}的玩家">${players().map(p => option(p.id, p.name + (p.gm ? " · 主持人" : ""), (assignments[h.id] || h.owner) === p.id)).join("")}</select></label>`).join("")}</div>${button("保存角色分配", "assign", "", disabled() || !heroes.length)}` : ""}</section>`;
    }
    function messagesMarkup() {
      const rows = historyRows;
      return `<section class="ol-messages"><h3>消息</h3><p class="ol-muted">消息保存在主持人设备；私信仅双方可见。</p>${typeof api.messageHistory === "function" && historyHasMore ? button(historyLoading ? "加载中…" : "查看更早消息", "messageHistory", "", historyLoading || paused()) : ""}<ol aria-live="polite">${rows.map(m => `<li data-message-id="${esc(m.id)}"><div><b>${esc(playerName(m.from))}</b> <small>${m.to === "all" ? "给全体" : m.from === own() ? "给 " + esc(playerName(m.to)) : "仅你可见"}</small></div><p>${esc(m.text)}</p></li>`).join("") || '<li class="ol-muted">还没有消息。</li>'}</ol><form id="ol-message-form">${view.isHost ? `<label>收件人<select id="ol-to" data-field="to">${option("all", "全体玩家", form.to === "all")}${players().filter(p => !p.gm).map(p => option(p.id, p.name, form.to === p.id)).join("")}</select></label>` : '<p class="ol-muted">回复只发送给主持人。</p>'}<label class="ol-sr-only" for="ol-message">消息正文</label><textarea id="ol-message" data-field="text" maxlength="2000" rows="3" placeholder="写一条消息…">${esc(form.text)}</textarea><button type="submit" class="ol-button ol-primary"${disabled() ? " disabled" : ""}>${view.isHost ? "发送消息" : "回复主持人"}</button></form></section>`;
    }
    function mergeMessages(rows) {
      const unique = new Map();
      for (const row of rows) if (row && typeof row.id === "string") unique.set(row.id, row);
      return [...unique.values()];
    }
    async function earlierMessages() {
      if (historyLoading || paused() || typeof api.messageHistory !== "function") return;
      const generation = historyGeneration;
      historyLoading = true; render();
      try {
        const page = await api.messageHistory(historyRows.length ? { beforeId: historyRows[0].id } : {});
        if (destroyed || generation !== historyGeneration) return;
        if (page?.ok === false) throw new Error(page.error || "历史消息暂时无法读取");
        if (page?.type !== "messageHistory" || !Array.isArray(page.messages)) throw new Error("没有收到有效的历史消息");
        historyRows = mergeMessages([...page.messages, ...historyRows]);
        historyHasMore = page.hasMore === true;
        // Reading earlier messages must not notify as if they just arrived.
        for (const row of page.messages) seenMessages.add(row.id);
      } catch (error) { if (generation === historyGeneration) notice = error.message || "历史消息暂时无法读取"; }
      finally { if (generation === historyGeneration) { historyLoading = false; render(); } }
    }
    function roomMarkup() {
      const starting = view.screen === "lobby", canClose = !starting;
      return `<div class="ol-card"><header><div><span class="ol-muted">${starting ? "大厅" : "联机房间"}</span><h2 class="ol-code">${esc(view.roomCode)}</h2></div>${canClose ? button("收起", "close") : ""}</header><p class="ol-connection" role="status">${esc(paused() ? view.status?.connected ? "房主离线，等待恢复" : "连接中断，正在重连" : "已连接")}</p>${rosterMarkup()}${starting ? `<footer>${view.isHost ? button("开始跑团", "start", "", disabled() || !players().some(p => !p.gm && p.online), true) : '<p class="ol-muted">等待主持人分配角色并开始。</p>'}</footer>` : ""}${starting ? lobbyChatMarkup() : ""}${messagesMarkup()}<footer>${button("重新连接", "reconnect", "", pending)}${button(view.isHost ? "离开并保存" : "离开房间", "leave", "", pending)}</footer><p class="ol-notice" role="status">${esc(notice || view.notice || view.packet?.systemNotice || (view.storageError ? "本机保存失败，请保持页面打开并检查存储空间。" : ""))}</p></div>`;
    }
    function lobbyChatMarkup() {
      return `<section class="ol-messages"><h3>大厅交流</h3><ol aria-live="polite">${(hs().chat || []).map(m => `<li><b>${esc(m.name || m.operatorName || "玩家")}</b><p>${esc(m.text)}</p></li>`).join("") || '<li class="ol-muted">在这里与所有人商量准备事项。</li>'}</ol><form id="ol-lobby-chat"><label class="ol-sr-only" for="ol-lobby-text">大厅聊天</label><input id="ol-lobby-text" data-field="chatText" maxlength="500" value="${esc(form.chatText)}" placeholder="所有人都能看到…"><button class="ol-button" type="submit"${disabled() ? " disabled" : ""}>发送到大厅</button></form></section>`;
    }
    function fieldsMarkup(data, zone) {
      const field = data.fields?.[zone] || {}, parts = [];
      if (field.fireOn || field.fire > 0) parts.push(`火场 ${field.fire || 1}`);
      for (const [key, label] of Object.entries({ electric: "通电", acid: "酸液", ice: "冰面", harmonic: "干涉场", heal: "治疗", highland: "高地", abyss: "深渊", isolate: "隔绝" })) if (field[key]) parts.push(label);
      if (field.energy) parts.push(`能量 ${field.energyVal || 0}`);
      if (field.collapseOn) parts.push(`塌陷 ${field.collapse || 0} / 5`);
      if (field.ruinOn) parts.push(`损毁地面 ${field.ruinHp || 0} / ${field.ruinMax || 0}`);
      if (field.fieldLocked) parts.push("场地已锁定");
      return parts.length ? `<p class="ol-field">${esc(parts.join(" · "))}</p>` : "";
    }
    function gapsMarkup(data) {
      const labels = { open: "畅通", wall: "危墙", bridge: "不稳桥梁", door: "机关门", void: "空隙" };
      return `<div class="ol-gaps">${Object.entries(data.gaps || {}).filter(([key]) => ["1-2", "2-3"].includes(key)).map(([key, gap]) => `<span>${esc(key.replace("-", " ↔ "))}：${esc(labels[gap.type] || "间隔")}${["wall", "bridge"].includes(gap.type) ? ` · 耐久 ${esc(gap.hp ?? 0)}` : gap.type === "door" ? gap.open ? " · 开" : " · 关" : ""}</span>`).join("")}</div>`;
    }
    function suppliesMarkup(data) {
      const bag = data.bag || {}, items = (bag.items || []).filter(item => item.qty > 0);
      return `<section class="ol-supplies" aria-label="队伍公共物资"><h3>队伍公共物资</h3><div class="ol-points"><span>奎支 ${esc(data.kuizhi ?? 0)}</span><span>水 ${esc(bag.water ?? 0)} ml</span></div><ul>${items.map(item => `<li>${esc(item.name || item.id)} × ${esc(item.qty)}</li>`).join("") || '<li class="ol-muted">背包为空</li>'}</ul></section>`;
    }
    function weatherMarkup(data) {
      const symbols = { none: "☀", heat: "♨", snow: "❄", acid: "☂", thunder: "ϟ", glow: "✦", sand: "≋", phase: "◒" };
      const weather = Object.hasOwn(symbols, data.weather) ? data.weather : "none";
      const details = [];
      if (weather === "sand" && /^[123]{2}$/.test(data.sandDir || "")) details.push(`风向 ${data.sandDir[0]} 区 → ${data.sandDir[1]} 区`);
      if (weather === "phase" && [0, 1, 2, 3].includes(data.phaseStep)) details.push(`相位 ${["波谷", "平衡", "波峰", "平衡"][data.phaseStep]}（${data.phaseStep}）`);
      if (data.weatherLocked) details.push("天气已锁定");
      return `<aside class="ol-weather ol-weather-${weather}" aria-label="天气"><span class="ol-weather-icon" aria-hidden="true">${symbols[weather]}</span><div><b>${esc(weather === "sand" ? "沙暴" : labels[weather])}</b>${details.length ? `<small>${esc(details.join(" · "))}</small>` : ""}</div></aside>`;
    }
    function resultMarkup() {
      const result = view.packet?.result || {}, grade = result.grade || {};
      const heading = { win: "战斗胜利", lose: "战斗失败", retreat: "队伍撤退" }[result.outcome] || "遭遇结束";
      return `<section class="ol-result" aria-label="战斗结算"><h2>${heading}</h2>${["D", "C", "B", "A", "S", "SS", "SSS"].includes(grade.grade) ? `<p class="ol-result-grade">评价 ${esc(grade.grade)}${grade.score == null ? "" : ` · ${esc(grade.score)} 分`}</p>` : ""}${grade.xpMult == null ? "" : `<p>战斗经验倍率 ×${esc(grade.xpMult)}</p>`}<p class="ol-muted">等待主持人返回探索。</p></section>`;
    }
    function card(u) {
      const owner = (hs().units || []).find(x => x.id === u.id)?.owner;
      const resources = Object.entries(u.resources || {}).filter(([k, v]) => names[k] && (typeof v === "number" || v === true)).map(([k, v]) => `${names[k]} ${v === true ? "" : v}`);
      const conditions = Object.entries(u.statuses || {}).filter(([k, v]) => names[k] && v).map(([k, v]) => `${names[k]}${typeof v === "number" && v !== 1 ? " " + v : ""}`);
      if (u.dying) conditions.unshift("倒地"); if (u.dead) conditions.unshift("阵亡"); if (u.stunned) conditions.unshift("失衡"); if (u.flying) conditions.push("飞行");
      const available = view.screen === "battle" && u.isPlayer && owner === own() && hs().currentUnitId === u.id && hs().phase === "acting";
      return `<article class="ol-unit${u.isPlayer ? " ol-ally" : " ol-enemy"}${selectedActor === u.id ? " ol-selected" : ""}" data-unit-id="${esc(u.id)}"><header><h3>${esc(u.name || u.id)}</h3><small>Lv${esc(u.level || 1)}</small></header>${owner ? `<small>${esc(playerName(owner))}${u.weaponOf ? " · 武器人" : ""}</small>` : ""}${u.isPlayer && !u.weaponOf ? `<p class="ol-xp">经验 ${esc(u.xp ?? 0)}</p>` : ""}<div class="ol-layers">${(u.layers || []).map(l => `<div class="ol-layer"><span>${esc(labels[l.type] || "生命")}</span><meter min="0" max="${esc(Math.max(1, Number(l.max) || 1))}" value="${esc(Math.max(0, Number(l.current) || 0))}" aria-label="${esc(labels[l.type] || "生命")}"></meter><b>${esc(l.current ?? 0)} / ${esc(l.max ?? 0)}</b></div>`).join("")}</div><div class="ol-points"><span>行动 ${esc(u.ap ?? 0)} / ${esc(u.apMax ?? 0)}</span><span>附赠 ${esc(u.bonus ?? 0)} / ${esc(u.bonusMax ?? 0)}</span>${u.def != null ? `<span>架势 ${esc(u.def)} / ${esc(u.defMax ?? u.def)}</span>` : ""}</div>${resources.length ? `<p class="ol-muted">${esc(resources.join(" · "))}</p>` : ""}${conditions.length ? `<p class="ol-conditions">${esc(conditions.join(" · "))}</p>` : ""}${available ? button("选择行动", "actor", `data-actor="${esc(u.id)}"`, disabled(), true) : ""}<span class="ol-popup" aria-live="polite"></span></article>`;
    }
    function actionsMarkup() {
      const current = hs().currentUnitId, mine = (hs().units || []).some(u => u.id === current && u.owner === own());
      if (view.screen !== "battle" || hs().phase !== "acting" || !mine) return `<p class="ol-muted">${esc(view.packet?.manualPhase || view.manualPhase ? "主持人正在操控敌人" : hs().phase === "enemy" ? "敌方行动中" : "等待当前玩家行动")}</p>`;
      const choices = currentMenu?.choices;
      return `<section class="ol-actions" aria-label="我的行动"><header><h3>${esc(choices?.title || "轮到你行动")}</h3>${currentMenu ? button("重选技能", "resetMenu", "", disabled()) : ""}</header>${choices ? choices.kind === "ready" ? `<p>选项已确认。</p>${button("执行行动", "execute", "", disabled() || !choices.command, true)}` : `<div class="ol-action-options">${(choices.options || []).map((o, index) => `<div>${button(o.label ?? String(o.value ?? "不选"), "option", `data-option="${index}"`, disabled() || o.disabled, true)}${o.sub || o.reason ? `<small>${esc(o.reason || o.sub)}</small>` : ""}</div>`).join("") || '<p class="ol-muted">当前没有可选项。</p>'}</div>` : button("选择行动", "actor", `data-actor="${esc(current)}"`, disabled(), true)}${button("结束我的行动", "endTurn", `data-actor="${esc(current)}"`, disabled())}</section>`;
    }
    function stageMarkup() {
      const data = displayState || view.state, screen = view.screen;
      if (screen === "lobby" || !data) return '<div class="ol-wait"><h2>等待房间同步</h2><p>房主准备好后会更新这里。</p></div>';
      const units = (data.units || []).filter(u => !u.hidden), logs = view.packet?.publicLogs || [];
      return `<header class="ol-stage-heading"><div><span class="ol-muted">${esc(view.roomCode)} · ${screen === "battle" ? `第 ${data.turnNo || 1} 回合` : screen === "ended" ? "遭遇结束" : "探索环节"}</span><h1>${screen === "battle" ? "战场" : screen === "ended" ? "战斗结算" : "与队伍同行"}</h1></div>${weatherMarkup(data)}</header>${screen === "ended" ? resultMarkup() : ""}${suppliesMarkup(data)}${paused() ? '<p class="ol-pause" role="status">房间暂停，正在等待连接恢复。</p>' : ""}${view.offlineWait ? `<p class="ol-pause">${esc(view.offlineWait.name)} 离线，等待其返回。</p>` : ""}${screen === "battle" || screen === "ended" ? `<div class="ol-zones">${Array.from({ length: Math.min(3, Math.max(2, Number(data.zoneMode) || 3)) }, (_, i) => `<section class="ol-zone"><h2>${i + 1} 区</h2>${fieldsMarkup(data, i + 1)}${units.filter(u => Number(u.zone) === i + 1).map(card).join("") || '<p class="ol-muted">空区域</p>'}${(data.props || []).filter(p => Number(p.zone) === i + 1 && !p.destroyed).map(p => `<article class="ol-prop"><b>${esc(p.name || p.kind || "配置物")}</b>${p.hp != null ? `<span>耐久 ${esc(p.hp)}${p.maxHp == null ? "" : " / " + esc(p.maxHp)}</span>` : ""}</article>`).join("")}</section>`).join("")}</div>${gapsMarkup(data)}${screen === "ended" ? "" : actionsMarkup()}` : `<p class="ol-muted">主持人正在管理探索与遭遇。你可以在房间消息里回复主持人。</p><div class="ol-exploration-party">${units.filter(u => u.isPlayer && !u.weaponOf).map(card).join("")}</div>`}<details class="ol-logs"><summary>公开记录</summary><ol>${logs.map(l => `<li>${esc(l.text || "")}</li>`).join("") || '<li class="ol-muted">还没有公开记录。</li>'}</ol></details>`;
    }
    function observeMessages() {
      const rows = view.messages || [], incoming = rows.filter(m => !seenMessages.has(m.id) && m.from !== own());
      for (const m of rows) seenMessages.add(m.id);
      if (messagesInitialized && incoming.length) {
        const message = incoming[incoming.length - 1];
        toast.textContent = `${message.to === "all" ? "主持人消息" : "仅你可见"}：${message.text}`; toast.hidden = false;
        clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
      }
      messagesInitialized = true;
    }
    function render() {
      if (destroyed) return;
      view = api.getView() || {};
      const nextRoom = view.active ? `${view.roomCode || ""}:${own() || ""}` : "";
      if (historyRoom !== nextRoom) {
        historyRoom = nextRoom; historyRows = []; historyHasMore = true; historyLoading = false; historyGeneration++;
        seenMessages = new Set(); messagesInitialized = false; clearTimeout(toastTimer); toast.hidden = true;
      }
      if (view.active) historyRows = mergeMessages([...historyRows, ...(view.messages || [])]);
      stage.hidden = !view.active || view.isHost;
      dock.hidden = !view.active;
      document.body.classList.toggle("online-player", !!view.active && !view.isHost);
      if (view.active) {
        if (!animating) displayState = view.state || null;
        if (request && (request.actor !== hs().currentUnitId || hs().phase !== "acting")) { request = currentMenu = null; actionGeneration++; }
        html(dock, button(`${view.roomCode || "房间"} · ${paused() ? "重连中" : "消息与成员"}`, "openRoom", "", false), "dock");
        observeMessages();
      }
      panel.hidden = !(panelOpen || view.active && view.screen === "lobby");
      if (!panel.hidden) html(panel, view.active ? roomMarkup() : entryMarkup(), "panel");
      if (!stage.hidden) html(stage, `${notice || view.notice || view.packet?.systemNotice ? `<p class="ol-notice" role="status">${esc(notice || view.notice || view.packet?.systemNotice)}</p>` : ""}${stageMarkup()}`, "stage");
    }
    async function call(fn) {
      if (pending) return false;
      pending = true; notice = ""; render();
      try { const result = await fn(); if (result?.ok === false) { notice = result.error || "操作未生效"; return false; } return true; }
      catch (error) { notice = error.message || String(error); return false; }
      finally { pending = false; render(); }
    }
    async function menu(next) {
      if (disabled()) return;
      const generation = ++actionGeneration; request = copy(next); selectedActor = request.actor; currentMenu = null;
      await call(async () => {
        const result = await api.actionMenu(copy(next));
        if (generation !== actionGeneration || destroyed) return;
        if (result?.ok === false || result?.error) { notice = result.error || "动作菜单不可用"; currentMenu = null; return; }
        if (result?.type !== "actionOptions" || result.displayOnly !== true) throw new Error("没有收到有效的动作选项");
        currentMenu = copy(result);
      });
    }
    async function choose(index) {
      const choices = currentMenu?.choices, chosen = choices?.options?.[index];
      if (!chosen || chosen.disabled || !request) return;
      const next = copy(request), value = copy(chosen.value);
      if (choices.kind === "skill") { next.skill = value; next.picks = {}; delete next.target; delete next.dest; delete next.item; }
      else if (choices.key === "item") next.item = value;
      else if (choices.key === "dest" && ["__move", "__item"].includes(next.skill)) next.dest = value;
      else if (choices.key === "target" && (next.skill === "__item" || !(next.skill && choices.optional != null))) {
        // Flow menus always carry optional (even false); a final target menu
        // has no optional field and becomes the command's primary target.
        next.target = value;
      } else { next.picks ||= {}; next.picks[choices.key] = value; }
      await menu(next);
    }
    async function sendMessage() {
      const text = form.text.trim(); if (!text || disabled()) return;
      if (await call(() => api.submit(view.isHost ? { type: "gm.msg", to: form.to, text } : { type: "gmReply", text }))) { form.text = ""; render(); }
    }
    async function sendLobbyChat() {
      const text = form.chatText.trim(); if (!text || disabled()) return;
      if (await call(() => api.submit({ type: "chat", text }))) { form.chatText = ""; render(); }
    }
    function input(event) { const key = event.target.dataset.field; if (key && Object.hasOwn(form, key)) form[key] = event.target.value; }
    function change(event) { input(event); if (event.target.dataset.assign) assignments[event.target.dataset.assign] = event.target.value; }
    async function click(event) {
      const b = event.target.closest("[data-online]"); if (!b || b.disabled) return;
      switch (b.dataset.online) {
        case "createTab": entry = "create"; render(); break;
        case "joinTab": entry = "join"; render(); break;
        case "close": panelOpen = false; render(); break;
        case "openRoom": panelOpen = true; render(); break;
        case "messageHistory": await earlierMessages(); break;
        case "connect": {
          const opts = { url: form.url.trim(), name: form.name.trim() || (entry === "create" ? "主持人" : "玩家") };
          if (entry === "create") Object.assign(opts, { slot: Number(form.slot), campaignName: form.campaignName.trim() || "联机跑团" });
          else opts.roomCode = form.roomCode.trim().toUpperCase();
          if (await call(() => api[entry === "create" ? "create" : "join"](opts))) { panelOpen = false; assignments = {}; render(); }
          break;
        }
        case "resume": if (await call(() => api.resume())) { panelOpen = false; render(); } break;
        case "reconnect": await call(() => api.reconnect()); break;
        case "leave": await call(() => api.leave()); break;
        case "assign": await call(() => api.assign(Object.fromEntries((view.heroes || []).map(h => [h.id, assignments[h.id] || h.owner || own()])))); assignments = {}; break;
        case "start": if (await call(() => api.start())) { panelOpen = false; render(); } break;
        case "actor": await menu({ actor: b.dataset.actor }); break;
        case "resetMenu": if (request) await menu({ actor: request.actor }); break;
        case "option": await choose(Number(b.dataset.option)); break;
        case "execute": if (currentMenu?.choices?.command && !disabled()) { const command = copy(currentMenu.choices.command); if (await call(() => api.submit(command))) { currentMenu = request = null; render(); } } break;
        case "endTurn": if (!disabled()) await call(() => api.submit({ type: "endTurn", actor: b.dataset.actor })); break;
      }
    }
    async function playPacket(packet) {
      if (destroyed || api.getView().isHost || packet?.displayOnly !== true) return;
      const generation = ++playbackGeneration;
      if (packet.type === "resync") {
        actionGeneration++; request = currentMenu = null; selectedActor = "";
        // A long disconnect can skip more than the live history window. Restart
        // pagination at this window, rather than retaining two disjoint ranges.
        historyRows = []; historyHasMore = true; historyLoading = false; historyGeneration++;
        seenMessages = new Set(); messagesInitialized = false; clearTimeout(toastTimer); toast.hidden = true;
        displayState = packet.state || null; animating = false; return;
      }
      const tape = packet.tape || [];
      if (!tape.length) return;
      animating = true; render();
      try {
        for (const event of tape) {
          if (destroyed || generation !== playbackGeneration) break;
          if (event.type !== "pop") continue;
          if (Array.isArray(event.snap)) displayState = { ...(displayState || packet.state || {}), units: copy(event.snap) };
          html(stage, stageMarkup(), "stage");
          const card = [...stage.querySelectorAll("[data-unit-id]")].find(node => node.dataset.unitId === event.unitId);
          if (card) {
            const bubble = card.querySelector(".ol-popup");
            bubble.textContent = event.text || (event.value == null ? ({ dmg: "受击", heal: "恢复", break: "击破", status: "状态变化" }[event.kind] || "行动") : `${event.kind === "heal" ? "+" : event.kind === "dmg" ? "−" : ""}${event.value}`);
            card.classList.add("ol-impact"); bubble.classList.add("ol-visible");
          }
          await new Promise(resolve => setTimeout(resolve, 180));
          if (card) { card.classList.remove("ol-impact"); card.querySelector(".ol-popup")?.classList.remove("ol-visible"); }
        }
      } finally { if (generation === playbackGeneration) { animating = false; displayState = packet.state || displayState; } }
    }
    function addTitleButton(text, which) {
      const menu = document.querySelector("#scr-title .t-menu"); if (!menu) return;
      const b = document.createElement("button"); b.type = "button"; b.className = "t-btn ol-title-entry";
      b.innerHTML = `<b>${esc(text)}</b><small>${which === "create" ? "主持跑团，与朋友共享房间" : "输入房间码，以自己的角色加入"}</small>`;
      b.onclick = () => { entry = which; panelOpen = true; notice = ""; render(); };
      menu.appendChild(b); titleButtons.push(b);
    }
    addTitleButton("联机开房", "create"); addTitleButton("加入房间", "join");
    if (typeof api.subscribe === "function") unsubs.push(api.subscribe(render));
    if (typeof api.onPacket === "function") unsubs.push(api.onPacket(playPacket));
    render();
    const instance = { render, open(which = "join") { entry = which; panelOpen = true; render(); }, destroy() {
      destroyed = true; playbackGeneration++; actionGeneration++; historyGeneration++; clearTimeout(toastTimer);
      for (const off of unsubs) if (typeof off === "function") off();
      for (const node of [...nodes, ...titleButtons]) node.remove();
      document.body.classList.remove("online-player"); if (mounted === instance) mounted = null;
    } };
    mounted = instance; return instance;
  }
  global.OnlineUI = { mount };
  const boot = () => { if (global.OnlineGame) mount(global.OnlineGame); };
  if (typeof document !== "undefined") { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
})(typeof globalThis !== "undefined" ? globalThis : window);
