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
    // 玩家右侧栏：「战斗 / 记录」和「小队」两个频道。输入框只建一次，收到新消息只更新列表，不会打断输入
    const side = make("aside", "online-side", "ol-side", { "aria-label": "战斗记录与小队聊天" });
    side.innerHTML = `<nav class="ol-side-tabs" role="tablist"><button type="button" role="tab" data-side="log" class="ol-tab"></button><button type="button" role="tab" data-side="chat" class="ol-tab">小队<span class="ol-badge" hidden></span></button></nav><ol class="ol-side-log" aria-live="polite"></ol><ol class="ol-side-chat" aria-live="polite"></ol><form class="ol-side-form" id="ol-side-form"><label class="ol-sr-only" for="ol-side-text">小队消息</label><button type="button" class="ol-button ol-dice" data-roll-open="1" title="选一个熟练项掷 d100">🎲 掷骰</button><input id="ol-side-text" maxlength="500" autocomplete="off" placeholder="和队友说点什么…"><button type="submit" class="ol-button ol-primary">发送</button></form>`;
    side.hidden = true;
    const bagBox = make("section", "online-bag", "ol-overlay ol-bag", { role: "dialog", "aria-label": "背包" });
    bagBox.hidden = true;
    // 掷骰：选角色、选熟练项，掷一颗 d100（点数越低越好）
    const rollBox = make("section", "online-roll", "ol-overlay ol-bag ol-roll", { role: "dialog", "aria-label": "掷骰" });
    rollBox.hidden = true;
    const rollForm = { unit: "", prof: "", note: "", secret: false };
    // 大字：主持人发，所有人画面中间出现（像 Minecraft 的 /title）
    const titleShow = make("div", "online-title", "ol-title-show", { "aria-live": "assertive" });
    titleShow.hidden = true;
    const titleBox = make("section", "online-title-form", "ol-overlay ol-bag ol-roll", { role: "dialog", "aria-label": "发大字" });
    titleBox.hidden = true;
    const titleForm = { text: "", sub: "", tone: "plain", seconds: 4 };
    let lastTitle = null, titlePrimed = false, titleTimer = null;
    let sideTab = { battle: "log", other: "chat" }, sideKeys = { log: "", chat: "" }, seenChat = new Set(), chatPrimed = false, unread = 0, chatSending = false;
    side.addEventListener("click", event => {
      const tab = event.target.closest("[data-side]"); if (!tab) return;
      sideTab[view.screen === "battle" || view.screen === "ended" ? "battle" : "other"] = tab.dataset.side; renderSide(true);
      if (tab.dataset.side === "chat") side.querySelector("#ol-side-text")?.focus({ preventScroll: true });
    });
    side.addEventListener("keydown", event => event.stopPropagation());
    side.addEventListener("submit", event => { event.preventDefault(); sendSideChat(); });
    bagBox.addEventListener("click", event => { if (event.target === bagBox || event.target.closest('[data-bag="close"]')) bagBox.hidden = true; });
    const onRollOpen = event => {
      if (!event.target.closest) return;
      if (event.target.closest("[data-roll-open]")) openRoll();
      if (event.target.closest("[data-title-open]")) openTitleForm();
    };
    titleBox.addEventListener("click", event => {
      if (event.target === titleBox || event.target.closest('[data-title="close"]')) { titleBox.hidden = true; return; }
      const preset = event.target.closest("[data-title-preset]");
      if (preset) { const [t, tone] = preset.dataset.titlePreset.split("|"); titleForm.text = t; titleForm.tone = tone; paintTitleForm(); return; }
      if (event.target.closest('[data-title="go"]')) sendTitle();
    });
    titleBox.addEventListener("input", event => { const k = event.target.dataset.tf; if (k) titleForm[k] = event.target.value; });
    titleBox.addEventListener("change", event => { const k = event.target.dataset.tf; if (k) titleForm[k] = event.target.value; });
    titleBox.addEventListener("keydown", event => { event.stopPropagation(); if (event.key === "Escape") titleBox.hidden = true; if (event.key === "Enter" && event.target.tagName === "INPUT") sendTitle(); });
    document.addEventListener("click", onRollOpen);
    rollBox.addEventListener("click", event => {
      if (event.target === rollBox || event.target.closest('[data-roll="close"]')) { rollBox.hidden = true; return; }
      if (event.target.closest('[data-roll="go"]')) doRoll();
    });
    rollBox.addEventListener("change", event => {
      const t = event.target;
      if (t.id === "ol-roll-unit") { rollForm.unit = t.value; paintRoll(); }
      else if (t.id === "ol-roll-prof") { rollForm.prof = t.value; paintRoll(); }
      else if (t.id === "ol-roll-secret") rollForm.secret = t.checked;
    });
    rollBox.addEventListener("input", event => { if (event.target.id === "ol-roll-note") rollForm.note = event.target.value; });
    rollBox.addEventListener("keydown", event => { event.stopPropagation(); if (event.key === "Escape") rollBox.hidden = true; if (event.key === "Enter" && event.target.id === "ol-roll-note") doRoll(); });
    bagBox.addEventListener("keydown", event => { event.stopPropagation(); if (event.key === "Escape") bagBox.hidden = true; });
    for (const node of [dock, stage, panel]) {
      node.addEventListener("click", click);
      node.addEventListener("keydown", event => { event.stopPropagation(); if (event.key === "Escape" && panelOpen && view.screen !== "lobby") { panelOpen = false; render(); } });
      node.addEventListener("input", input); node.addEventListener("change", change);
      node.addEventListener("submit", event => { event.preventDefault(); if (event.target.id === "ol-message-form") sendMessage(); if (event.target.id === "ol-lobby-chat") sendLobbyChat(); });
    }
    // 悬停在单位 / 配置物上：图鉴描述 + 身上效果的文字说明（unit-tip.js）
    const TIP_STATUS = { burn: "灼烧", shock: "感电", corr: "腐蚀", frostbite: "冻伤", shockwave: "震荡", reso: "共振", unstable: "不稳", weak: "虚弱", inspire: "振奋", sturdy: "坚挺", hide: "躲藏", advantage: "优势", chase: "紧追" };
    const TIP_INSTANT = { melt: "熔融", sting: "刺骨", overload: "过载", shift: "错位", spread: "扩散", refract: "折射", iceNext: "冰冻+50%" };
    const TIP_SELF = { burn: "自焚", frost: "霜结", splash: "溅射", conductor: "导体", anchor: "千钧", store: "蓄能", doppler: "多普勒" };
    const TIP_ATK = { combust: "爆燃", icebreak: "破冰", bolt: "雷击", etch: "蚀刻", backflow: "倒流", inertia: "惯性", diffract: "衍射" };
    function unitTip(node) {
      const T = global.UnitTip, data = displayState || view.state || {};
      if (!T) return "";
      if (node.dataset.propId) {
        const p = (data.props || []).find(x => String(x.id) === node.dataset.propId);
        if (!p) return "";
        return T.html({ kind: "prop", propKind: p.kind }, [], { name: p.name || p.kind, sub: [p.hp != null ? `耐久 ${p.hp}${p.maxHp == null ? "" : "/" + p.maxHp}` : "", p.zone + " 区"].filter(Boolean).join(" · ") });
      }
      const u = (data.units || []).find(x => x.id === node.dataset.unitId);
      if (!u) return "";
      const st = u.statuses || {}, tokens = [];
      if (u.dead) tokens.push(u.isPlayer ? "倒下" : "");
      if (u.dying && !u.dead) tokens.push("濒死");
      if (u.stunned && !u.dead) tokens.push("失衡");
      if (u.flying) tokens.push("飞行");
      Object.keys(TIP_STATUS).forEach(k => { if (st[k]) tokens.push(k === "burn" && Number(st.burn) > 0 ? "灼烧×" + st.burn : TIP_STATUS[k]); });
      if (st.high || Number(u.highEnergy) > 0) tokens.push("高能 " + (Number(u.highEnergy) || 0));
      Object.keys(TIP_INSTANT).forEach(k => { if ((u.instant || {})[k]) tokens.push(TIP_INSTANT[k]); });
      if (TIP_SELF[u.self]) tokens.push(TIP_SELF[u.self] + (u.self === "burn" && Number(u.selfBurnStacks) > 1 ? "×" + u.selfBurnStacks : ""));
      ((u.resources || {}).nextAtkFx || []).forEach(k => { if (TIP_ATK[k]) tokens.push(TIP_ATK[k]); });
      (u.marks || []).forEach(m => tokens.push(m === "needle" ? "刺入" : m === "bond" ? "牵挂" : ""));
      const owner = u.weaponOf ? (data.units || []).find(x => x.kit === u.weaponOf && !x.weaponOf) : null;
      const kind = u.isPlayer ? (u.weaponOf || u.weaponUnit ? "weapon" : "hero") : "enemy";
      return T.html({ kind, kit: u.kit, ownerName: owner && owner.name }, tokens.filter(Boolean), { name: u.name || u.id, sub: `Lv${u.level || 1} · ${u.zone} 区` });
    }
    const hoverable = (t) => t && t.closest && t.closest("[data-unit-id], [data-prop-id]");
    stage.addEventListener("mouseover", event => {
      const node = hoverable(event.target);
      if (!node || !global.UnitTip || (global.matchMedia && global.matchMedia("(hover: none)").matches)) return;
      const h = unitTip(node);
      if (h) global.UnitTip.show(node, h);
    });
    stage.addEventListener("mouseout", event => {
      const node = hoverable(event.target);
      if (node && !node.contains(event.relatedTarget)) global.UnitTip?.hide();
    });
    // 中文输入法正在拼字时，不重画含有正在输入的输入框的区域（重画会把拼到一半的字打断），拼完再补画
    let composing = false, deferred = false;
    const onCompStart = () => { composing = true; };
    const onCompEnd = () => { composing = false; if (deferred) { deferred = false; setTimeout(() => { if (!destroyed) render(); }, 0); } };
    document.addEventListener("compositionstart", onCompStart, true);
    document.addEventListener("compositionend", onCompEnd, true);
    function html(node, markup, key) {
      if (lastMarkup[key] === markup) return;
      if (composing && node.contains(document.activeElement)) { deferred = true; return; }
      const focused = document.activeElement, id = focused && node.contains(focused) ? focused.id : "";
      const start = focused && typeof focused.selectionStart === "number" ? focused.selectionStart : null;
      lastMarkup[key] = markup; node.innerHTML = markup;
      if (id && byId(id)) { const el = byId(id); el.focus({ preventScroll: true }); if (start != null && el.setSelectionRange) { try { el.setSelectionRange(start, start); } catch (_) {} } }
    }
    function entryMarkup() {
      const slots = typeof api.slots === "function" ? api.slots() : [];
      return `<div class="ol-card"><header><h2>${entry === "create" ? "联机开房" : "加入房间"}</h2>${button("关闭", "close")}</header><div class="ol-entry-tabs">${button("我来主持", "createTab", "", pending, entry === "create")}${button("加入朋友", "joinTab", "", pending, entry === "join")}</div><label>转发服务地址<input id="ol-url" data-field="url" type="url" placeholder="https://你的转发服务" value="${esc(form.url)}" autocomplete="url"></label><label>昵称<input id="ol-name" data-field="name" maxlength="24" value="${esc(form.name)}" autocomplete="nickname"></label>${entry === "create" ? `<label>跑团存档<select id="ol-slot" data-field="slot">${slots.map(s => option(s.index, `${s.index + 1} · ${s.name}`, String(s.index) === form.slot)).join("")}</select></label><label>新团名称<input id="ol-campaign" data-field="campaignName" maxlength="40" placeholder="空白存档使用此名称" value="${esc(form.campaignName)}"></label>` : `<label>房间码<input id="ol-code" data-field="roomCode" maxlength="16" autocapitalize="characters" spellcheck="false" placeholder="六位房间码" value="${esc(form.roomCode)}"></label>`}<p class="ol-muted">使用与朋友相同的转发服务地址。进入房间后，断线会自动尝试重连。</p><footer>${button(pending ? "连接中…" : entry === "create" ? "创建房间" : "加入", "connect", "", pending, true)}${api.hasSaved?.() ? button("恢复上次房间", "resume", "", pending) : ""}</footer><p class="ol-notice" role="status">${esc(notice)}</p></div>`;
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
      return `<div class="ol-card"><header><div><span class="ol-muted">${starting ? "大厅" : "联机房间"}</span><div class="ol-code-row"><h2 class="ol-code">${esc(view.roomCode)}</h2>${view.roomCode ? button("复制房间码", "copyCode") : ""}</div></div>${canClose ? button("收起", "close") : ""}</header><p class="ol-connection" role="status">${esc(paused() ? view.status?.connected ? "房主离线，等待恢复" : "连接中断，正在重连" : "已连接")}</p>${rosterMarkup()}${starting ? `<footer>${view.isHost ? button("开始跑团", "start", "", disabled() || !players().some(p => !p.gm && p.online), true) : '<p class="ol-muted">等待主持人分配角色并开始。</p>'}</footer>` : ""}${starting ? lobbyChatMarkup() : ""}${messagesMarkup()}<footer>${button("重新连接", "reconnect", "", pending)}${button(view.isHost ? "离开并保存" : "离开房间", "leave", "", pending)}</footer><p class="ol-notice" role="status">${esc(notice || view.notice || view.packet?.systemNotice || (view.storageError ? "本机保存失败，请保持页面打开并检查存储空间。" : ""))}</p></div>`;
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
    /** 区的排版：普通直排一行；特殊棋盘按坐标摆成格子（四区方形 2×2、五区十字……） */
    function zoneGrid(data) {
      const b = data.board;
      if (b && Array.isArray(b.zones) && b.zones.length) {
        const cols = Math.max(...b.zones.map(z => z.x)) + 1;
        return { style: ` style="--ol-cols:${cols}"`, zones: b.zones.slice().sort((p, q) => p.id - q.id).map(z => ({ id: z.id, style: ` style="--ol-col:${z.x + 1};--ol-row:${z.y + 1}"` })) };
      }
      const n = Math.min(9, Math.max(2, Number(data.zoneMode) || 3));
      return { style: ` style="--ol-cols:${n}"`, zones: Array.from({ length: n }, (_, i) => ({ id: i + 1, style: "" })) };
    }
    function gapsMarkup(data) {
      const labels = { open: "畅通", wall: "危墙", bridge: "不稳桥梁", door: "机关门", void: "空隙" };
      return `<div class="ol-gaps">${Object.entries(data.gaps || {}).filter(([key]) => /^\d-\d$/.test(key)).map(([key, gap]) => `<span>${esc(key.replace("-", " ↔ "))}：${esc(labels[gap.type] || "间隔")}${["wall", "bridge"].includes(gap.type) ? ` · 耐久 ${esc(gap.hp ?? 0)}` : gap.type === "door" ? gap.open ? " · 开" : " · 关" : ""}</span>`).join("")}</div>`;
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
      const d = result.drops, dropText = d ? [d.kuizhi ? `${d.kuizhi} 奎支` : "", ...(d.items || []).map(x => `${x.name} ×${x.qty}`)].filter(Boolean).join("、") : "";
      return `<section class="ol-result" aria-label="战斗结算"><h2>${heading}</h2>${["D", "C", "B", "A", "S", "SS", "SSS"].includes(grade.grade) ? `<p class="ol-result-grade">评价 ${esc(grade.grade)}${grade.score == null ? "" : ` · ${esc(grade.score)} 分`}</p>` : ""}${grade.xpMult == null ? "" : `<p>战斗经验倍率 ×${esc(grade.xpMult)}</p>`}${dropText ? `<p class="ol-drops">战斗掉落：<b>${esc(dropText)}</b>（已放进队伍背包）</p>` : ""}<div class="ol-info-tools">${button("查看这场的战斗记录", "showLog")}${button("最近 10 场战绩", "info", 'data-info="record"', pending)}</div><p class="ol-muted">等待主持人返回探索。</p></section>`;
    }
    const ATTRS = { str: "力量", con: "体质", dex: "敏捷", wil: "意志", int: "智力", sta: "耐力" };
    /** 升级的属性点：玩家自己选，主持人确认后才加上 */
    function attrMarkup(u) {
      const pend = (hs().attrRequests || []).find(r => r.unitId === u.id && r.status === "pending");
      const last = (hs().attrRequests || []).filter(r => r.unitId === u.id && r.status !== "pending").slice(-1)[0];
      const lastText = last && Date.now() - (last.at || 0) < 10 * 60 * 1000 ? `<p class="ol-muted">上次申请 ${esc((last.attrs || []).map(a => ATTRS[a]).join("、"))} +1：${({ approved: "主持人已同意", rejected: "主持人没有同意", cancelled: "已撤回" })[last.status] || ""}</p>` : "";
      if (pend) return `<div class="ol-attr"><p>等主持人确认：${esc(pend.attrs.map(a => ATTRS[a]).join("、"))} +1</p>${button("撤回", "attrCancel", `data-request="${esc(pend.id)}"`, disabled())}</div>${lastText}`;
      if (!(Number(u.attrPoints) > 0)) return lastText;
      const picked = u.attrPicks || [];
      // 单项属性硬性上限 10（玩家手册）：已经满的那项不能申请（以前能申请，主持人同意时才被拒）
      const attrCap = typeof ATTR_HARD_MAX === "number" ? ATTR_HARD_MAX : 10;
      return `<div class="ol-attr"><p>有 ${esc(u.attrPoints)} 点属性点可以分配（选好后由主持人确认）</p><div class="ol-attr-btns">${Object.keys(ATTRS).map(k => button(`${ATTRS[k]} ${(u.attrs || {})[k] ?? ""} +1`, "attrRequest", `data-unit="${esc(u.id)}" data-attr="${k}"`, disabled() || (picked.length >= 1 && picked.includes(k)) || (Number((u.attrs || {})[k]) || 0) >= attrCap)).join("")}</div>${picked.length ? '<p class="ol-muted">8 级那一点不能加在曾经加过的同一项上。</p>' : ""}</div>${lastText}`;
    }
    /** 主持人发起的检定：自己的角色点「掷骰」；结果所有人都看得到 */
    function checksMarkup() {
      const list = hs().checks || [];
      const open = list.filter(c => c.status === "open");
      const recent = list.filter(c => c.status !== "open" && Date.now() - (c.at || 0) < 15 * 60 * 1000).slice(-1);
      const mineIds = new Set((hs().units || []).filter(u => u.owner === own()).map(u => u.id));
      const rows = open.concat(recent);
      if (!rows.length) return "";
      return `<section class="ol-checks" aria-label="检定">${rows.map(c => `<article class="ol-check${c.status === "open" ? " ol-open" : ""}"><header><h3>${esc(c.diffName)}「${esc(c.prof)}」检定</h3><small>${c.status === "open" ? "进行中" : "已结束"}</small></header>${c.note ? `<p>${esc(c.note)}</p>` : ""}<ul>${(c.targets || []).map(t => {
        const odds = `成功率 ${Math.round((t.base || 0) * 1000) / 10}%${t.adv ? " · 优势" : t.dis ? " · 劣势" : ""}${t.reroll ? " · 失败可重掷" : ""}`;
        const res = t.result ? `<b class="${t.result.ok ? "ol-ok" : "ol-bad"}">${t.result.ok ? "成功" : "失败"}</b> <small>${esc(t.result.rolls.map(r => r.roll == null ? r.label : (r.label ? r.label + " " : "") + r.roll).join("，"))}</small>` : c.status === "open" && mineIds.has(t.unitId) ? button("掷骰", "checkRoll", `data-check="${esc(c.id)}" data-unit="${esc(t.unitId)}"`, disabled() || !(t.base > 0), true) : '<small class="ol-muted">等待掷骰</small>';
        return `<li><span><b>${esc(t.name)}</b><small>${esc(odds)}</small></span>${res}</li>`;
      }).join("")}</ul></article>`).join("")}</section>`;
    }
    /** 高能值：淡青绿色的液体灌进一条总血条，液面越过血量就会自爆 */
    function highBar(u) {
      const he = Number(u.highEnergy) || 0; if (he <= 0) return "";
      const max = (u.layers || []).reduce((a, l) => a + (Number(l.max) || 0), 0) || 1, cur = (u.layers || []).reduce((a, l) => a + Math.max(0, Number(l.current) || 0), 0);
      return `<div class="ol-high" title="高能 ${esc(he)}：血量低于高能值时自爆"><span>高能</span><div class="ol-high-track"><i class="ol-high-hp" style="width:${Math.min(100, cur / max * 100)}%"></i><i class="u-high${he >= cur * 0.75 ? " danger" : ""}" style="width:${Math.min(100, he / max * 100)}%"></i></div><b>${esc(he)} / ${esc(cur)}</b></div>`;
    }
    function card(u) {
      const owner = (hs().units || []).find(x => x.id === u.id)?.owner;
      const resources = Object.entries(u.resources || {}).filter(([k, v]) => names[k] && (typeof v === "number" || v === true)).map(([k, v]) => `${names[k]} ${v === true ? "" : v}`);
      const conditions = Object.entries(u.statuses || {}).filter(([k, v]) => names[k] && v).map(([k, v]) => `${names[k]}${typeof v === "number" && v !== 1 ? " " + v : ""}`);
      // 状态 / 效果画成图标（hud-icons.js）；没有图标模块时还是写字
      const HI = global.HudIcons, badges = HI ? HI.unitBadges(u, u.marks) : [];
      if (HI) conditions.length = 0;
      if (u.dying) conditions.unshift("倒地"); if (u.dead) conditions.unshift("阵亡"); if (u.stunned) conditions.unshift("失衡"); if (u.flying) conditions.push("飞行");
      const gauge = HI && u.hud && view.screen !== "exploration" ? HI.gauge(u.hud) : "";
      const available = view.screen === "battle" && u.isPlayer && owner === own() && hs().currentUnitId === u.id && hs().phase === "acting";
      return `<article class="ol-unit${u.isPlayer ? " ol-ally" : " ol-enemy"}${selectedActor === u.id ? " ol-selected" : ""}" data-unit-id="${esc(u.id)}"><header><h3>${esc(u.name || u.id)}</h3><small>Lv${esc(u.level || 1)}</small></header>${owner ? `<small>${esc(playerName(owner))}${u.weaponOf ? " · 武器人" : ""}</small>` : ""}${u.isPlayer && !u.weaponOf ? `<p class="ol-xp">经验 ${esc(u.xp ?? 0)}${typeof xpToNext === "function" && xpToNext(u.level || 1) ? ` / ${esc(xpToNext(u.level || 1))}` : ""}</p>` : ""}${view.screen === "exploration" && u.isPlayer && !u.weaponOf && owner === own() ? attrMarkup(u) : ""}<div class="ol-layers">${(u.layers || []).map(l => `<div class="ol-layer"><span>${esc(labels[l.type] || "生命")}</span><meter min="0" max="${esc(Math.max(1, Number(l.max) || 1))}" value="${esc(Math.max(0, Number(l.current) || 0))}" aria-label="${esc(labels[l.type] || "生命")}"></meter><b>${esc(l.current ?? 0)} / ${esc(l.max ?? 0)}</b></div>`).join("")}${highBar(u)}</div><div class="ol-points"><span>行动 ${esc(u.ap ?? 0)} / ${esc(u.apMax ?? 0)}</span><span>附赠 ${esc(u.bonus ?? 0)} / ${esc(u.bonusMax ?? 0)}</span>${u.def != null ? `<span>架势 ${esc(u.def)} / ${esc(u.defMax ?? u.def)}</span>` : ""}</div>${gauge ? `<div class="hi-gauge ol-gauge" aria-label="${esc(u.name || "")}的角色仪表">${gauge}</div>` : resources.length ? `<p class="ol-muted">${esc(resources.join(" · "))}</p>` : ""}${badges.length ? `<div class="hi-badges ol-badges">${badges.map(b => HI.badge(b.key, b.stack)).join("")}</div>` : ""}${conditions.length ? `<p class="ol-conditions">${esc(conditions.join(" · "))}</p>` : ""}${available ? button("选择行动", "actor", `data-actor="${esc(u.id)}"`, disabled(), true) : ""}<span class="ol-popup" aria-live="polite"></span></article>`;
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
      return `<header class="ol-stage-heading"><div><span class="ol-muted">${esc(view.roomCode)} · ${screen === "battle" ? `第 ${data.turnNo || 1} 回合` : screen === "ended" ? "遭遇结束" : "探索环节"}</span><h1>${screen === "battle" ? "战场" : screen === "ended" ? "战斗结算" : "与队伍同行"}</h1><div class="ol-info-tools">${button("角色资料", "info", 'data-info="sheet"', pending)}${button("武器", "info", 'data-info="armory"', pending)}${button("背包", "info", 'data-info="bag"', pending)}${button("战绩", "info", 'data-info="record"', pending)}</div></div>${weatherMarkup(data)}</header>${screen === "ended" ? resultMarkup() : ""}${suppliesMarkup(data)}${paused() ? '<p class="ol-pause" role="status">房间暂停，正在等待连接恢复。</p>' : ""}${view.offlineWait ? `<p class="ol-pause">${esc(view.offlineWait.name)} 离线，等待其返回。</p>` : ""}${checksMarkup()}${screen === "battle" || screen === "ended" ? `<div class="ol-zones"${zoneGrid(data).style}>${zoneGrid(data).zones.map(z => `<section class="ol-zone"${z.style}><h2>${z.id} 区</h2>${fieldsMarkup(data, z.id)}${units.filter(u => Number(u.zone) === z.id).map(card).join("") || '<p class="ol-muted">空区域</p>'}${(data.props || []).filter(p => Number(p.zone) === z.id && !p.destroyed).map(p => `<article class="ol-prop" data-prop-id="${esc(p.id)}"><b>${esc(p.name || p.kind || "配置物")}</b>${p.hp != null ? `<span>耐久 ${esc(p.hp)}${p.maxHp == null ? "" : " / " + esc(p.maxHp)}</span>` : ""}</article>`).join("")}</section>`).join("")}</div>${gapsMarkup(data)}${screen === "ended" ? "" : actionsMarkup()}` : `<p class="ol-muted">主持人正在管理探索与遭遇。右侧「小队」频道可以和大家聊天，「消息与成员」里可以私下回复主持人。</p><div class="ol-exploration-party">${units.filter(u => u.isPlayer && !u.weaponOf).map(card).join("")}</div>`}`;
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
    /* ---------- 小队聊天 ---------- */
    const chatRows = () => (hs().chat || []).filter(m => m && typeof m.text === "string");
    const clock = at => { if (!at) return ""; const d = new Date(at); return isNaN(d) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
    function chatListMarkup(rows) {
      return rows.map(m => `<li class="${m.operatorId && m.operatorId === own() ? "ol-mine" : ""}${m.roll ? " ol-roll" : ""}${m.tier ? " ol-tier-" + m.tier : ""}${m.secret ? " ol-secret" : ""}${m.title ? " ol-title-row" : ""}"><div><b>${esc(m.name || m.operatorName || playerName(m.operatorId))}</b><small>${esc(clock(m.at))}</small></div><p>${esc(m.text)}</p></li>`).join("") || '<li class="ol-muted">还没有人说话。消息所有人都能看到，并一直保留在记录里。</li>';
    }
    /** 更新列表（只换列表内容，不碰输入框）；原来在底部就继续贴底 */
    function fillList(list, markup) {
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      list.innerHTML = markup;
      if (atBottom) list.scrollTop = list.scrollHeight;
    }
    /** 新消息：不在小队频道时累计未读数 */
    function trackUnread(onChat) {
      const rows = chatRows();
      if (!chatPrimed) { rows.forEach(m => seenChat.add(m.id)); chatPrimed = true; return 0; }
      const fresh = rows.filter(m => m.id && !seenChat.has(m.id));
      fresh.forEach(m => seenChat.add(m.id));
      if (onChat) unread = 0; else unread += fresh.filter(m => m.operatorId !== own()).length;
      return fresh.length;
    }
    function renderSide(force) {
      if (side.hidden) return;
      const battle = view.screen === "battle" || view.screen === "ended";
      const tab = sideTab[battle ? "battle" : "other"];
      side.dataset.tab = tab;
      const logTab = side.querySelector('[data-side="log"]'), chatTab = side.querySelector('[data-side="chat"]');
      logTab.textContent = battle ? "战斗" : "记录";
      logTab.classList.toggle("on", tab === "log"); chatTab.classList.toggle("on", tab === "chat");
      logTab.setAttribute("aria-selected", String(tab === "log")); chatTab.setAttribute("aria-selected", String(tab === "chat"));
      trackUnread(tab === "chat");
      const badge = chatTab.querySelector(".ol-badge"); badge.hidden = !unread; badge.textContent = unread > 99 ? "99+" : String(unread);
      const logs = view.packet?.publicLogs || [];
      const logMarkup = logs.map(l => `<li>${esc(l.text || "")}</li>`).join("") || '<li class="ol-muted">还没有公开记录。</li>';
      if (force || sideKeys.log !== logMarkup) { sideKeys.log = logMarkup; fillList(side.querySelector(".ol-side-log"), logMarkup); }
      const chatMarkup = chatListMarkup(chatRows());
      if (force || sideKeys.chat !== chatMarkup) { sideKeys.chat = chatMarkup; fillList(side.querySelector(".ol-side-chat"), chatMarkup); }
      side.querySelector(".ol-side-form button[type=submit]").disabled = chatSending || paused();
    }
    async function sendChatText(input, button) {
      const text = input.value.trim();
      if (!text || chatSending || paused()) return;
      chatSending = true; if (button) button.disabled = true;
      try {
        const result = await api.submit({ type: "chat", text });
        if (result?.ok === false) { notice = result.error || "消息没有发出去"; render(); }
        else input.value = "";
      } catch (error) { notice = error.message || "消息没有发出去"; render(); }
      finally { chatSending = false; if (button) button.disabled = paused(); }
    }
    function sendSideChat() { sendChatText(side.querySelector("#ol-side-text"), side.querySelector(".ol-side-form button[type=submit]")); }

    /* 主持人这边：战斗记录栏加「战斗 / 小队」，探索记录栏加「探索 / 小队」 */
    const hostMounts = [];
    function mountHostChat() {
      const want = !!(view.active && view.isHost);
      if (!want) { while (hostMounts.length) hostMounts.pop().remove(); return; }
      if (!hostMounts.length) {
        for (const [root, label, def] of [[document.getElementById("g-log"), "战斗", "log"], [document.querySelector("#scr-trpg .tr-log"), "探索", "chat"]]) {
          if (!root) continue;
          const nav = document.createElement("nav"); nav.className = "ol-host-tabs"; nav.setAttribute("role", "tablist");
          nav.innerHTML = `<button type="button" role="tab" data-host-tab="log" class="ol-tab">${label}</button><button type="button" role="tab" data-host-tab="chat" class="ol-tab">小队<span class="ol-badge" hidden></span></button>`;
          const box = document.createElement("div"); box.className = "ol-host-chat";
          box.innerHTML = `<ol class="ol-side-chat" aria-live="polite"></ol><form class="ol-side-form"><button type="button" class="ol-button ol-dice" data-roll-open="1" title="选角色和熟练项掷 d100（可以暗骰）">🎲</button><button type="button" class="ol-button ol-dice" data-title-open="1" title="在所有玩家画面中间打出大字（比如「援军来了」）">📢</button><input maxlength="500" autocomplete="off" aria-label="小队消息" placeholder="说点什么…"><button type="submit" class="ol-button ol-primary">发送</button></form>`;
          root.prepend(nav); root.appendChild(box);
          const m = { root, nav, box, tab: def, key: "", seen: null, unread: 0, remove() { nav.remove(); box.remove(); root.classList.remove("ol-chat-mode"); } };
          nav.addEventListener("click", e => { const b = e.target.closest("[data-host-tab]"); if (!b) return; m.tab = b.dataset.hostTab; paintHost(m, true); if (m.tab === "chat") box.querySelector("input").focus({ preventScroll: true }); });
          box.addEventListener("keydown", e => e.stopPropagation());
          box.addEventListener("submit", e => { e.preventDefault(); sendChatText(box.querySelector("input"), box.querySelector("button[type=submit]")); });
          hostMounts.push(m);
        }
      }
      for (const m of hostMounts) paintHost(m);
    }
    function paintHost(m, force) {
      m.root.classList.toggle("ol-chat-mode", m.tab === "chat");
      m.nav.querySelectorAll("[data-host-tab]").forEach(b => { const on = b.dataset.hostTab === m.tab; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
      const rows = chatRows();
      if (!m.seen) m.seen = new Set(rows.map(r => r.id));
      const fresh = rows.filter(r => r.id && !m.seen.has(r.id)); fresh.forEach(r => m.seen.add(r.id));
      if (m.tab === "chat") m.unread = 0; else m.unread += fresh.filter(r => r.operatorId !== own()).length;
      const badge = m.nav.querySelector(".ol-badge"); badge.hidden = !m.unread; badge.textContent = String(m.unread);
      const markup = chatListMarkup(rows);
      if (force || m.key !== markup) { m.key = markup; fillList(m.box.querySelector(".ol-side-chat"), markup); }
    }

    /* ---------- 角色资料 / 武器 / 背包（向房主要数据，只读显示） ---------- */
    function myKit() {
      const units = (displayState || view.state || {}).units || [];
      const mine = (hs().units || []).filter(u => u.owner === own()).map(u => units.find(x => x.id === u.id)).filter(Boolean);
      const hero = mine.find(u => !u.weaponOf) || mine[0];
      return hero ? hero.kit : null;
    }
    function bagMarkup(bag) {
      const items = (bag && bag.items) || [];
      return `<div class="ol-card"><header><h2>背包</h2><button type="button" class="ol-button" data-bag="close">关闭</button></header><div class="ol-points"><span>奎支 ${esc(bag?.kuizhi ?? 0)}</span><span>水 ${esc(bag?.water ?? 0)} ml</span></div><ul class="ol-bag-list">${items.map(it => `<li><div><b>${esc(it.name)}</b><span>× ${esc(it.qty)}</span></div>${it.hint ? `<p>${esc(it.hint)}</p>` : ""}</li>`).join("") || '<li class="ol-muted">背包是空的。</li>'}</ul><p class="ol-muted">队伍共用的背包。使用道具请在自己的行动里选「使用道具」。</p></div>`;
    }
    /* ---------- 大字 ---------- */
    const TITLE_PRESETS = [["援军来了", "hope"], ["他们来了", "danger"], ["小心！", "danger"], ["天亮了", "hope"]];
    function paintTitleForm() {
      const tones = { plain: "普通（金色）", danger: "危险（红色）", hope: "希望（青色）" };
      titleBox.innerHTML = `<div class="ol-card"><header><h2>发大字</h2><button type="button" class="ol-button" data-title="close">关闭</button></header><p class="ol-muted">所有玩家画面中间会突然出现这行大字，几秒后淡出；小队频道里也会留一条记录。</p><div class="ol-attr-btns">${TITLE_PRESETS.map(([t, tone]) => `<button type="button" class="ol-button" data-title-preset="${esc(t)}|${tone}">${esc(t)}</button>`).join("")}</div><label>大字<input id="ol-title-text" data-tf="text" maxlength="40" value="${esc(titleForm.text)}" placeholder="比如：援军来了"></label><label>小字（可不填）<input data-tf="sub" maxlength="80" value="${esc(titleForm.sub)}" placeholder="比如：北边的山坡上亮起了火把"></label><label>风格<select data-tf="tone">${Object.keys(tones).map(k => option(k, tones[k], k === titleForm.tone)).join("")}</select></label><label>停留秒数<input data-tf="seconds" type="number" min="2" max="15" value="${esc(titleForm.seconds)}"></label><footer><button type="button" class="ol-button ol-primary" data-title="go"${disabled() ? " disabled" : ""}>发出去</button></footer></div>`;
    }
    function openTitleForm() { if (!view.active || !view.isHost) return; paintTitleForm(); titleBox.hidden = false; titleBox.querySelector("#ol-title-text")?.focus({ preventScroll: true }); }
    async function sendTitle() {
      if (!titleForm.text.trim() || disabled()) return;
      const cmd = { type: "showTitle", text: titleForm.text.trim(), sub: titleForm.sub.trim(), tone: titleForm.tone, seconds: Number(titleForm.seconds) || 4 };
      if (await call(() => api.submit(cmd))) { titleForm.text = ""; titleForm.sub = ""; titleBox.hidden = true; }
    }
    /** 收到新的大字就播一次（刚进房间时已经有的那条不重播） */
    function playTitle() {
      const t = hs().title;
      if (!view.active || !view.packet) return;
      if (!titlePrimed) { titlePrimed = true; lastTitle = t ? t.id : null; return; }
      if (!t || t.id === lastTitle) return;
      lastTitle = t.id;
      clearTimeout(titleTimer);
      titleShow.className = "ol-ui ol-title-show ol-tone-" + (t.tone || "plain");
      titleShow.innerHTML = `<div class="ol-title-main">${esc(t.text)}</div>${t.sub ? `<div class="ol-title-sub">${esc(t.sub)}</div>` : ""}`;
      titleShow.hidden = false;
      void titleShow.offsetWidth; titleShow.classList.add("on");
      const ms = Math.max(2, Math.min(15, Number(t.seconds) || 4)) * 1000;
      titleTimer = setTimeout(() => { titleShow.classList.remove("on"); titleShow.classList.add("out"); titleTimer = setTimeout(() => { titleShow.hidden = true; }, 700); }, ms);
      if (global.Sfx && Sfx.enabled && Sfx.enabled() && Sfx.ui) { try { Sfx.ui("turn"); } catch (_) {} }
    }
    /* ---------- 掷骰（按钮式 d100） ---------- */
    const LV = ["没有熟练", "一级熟练", "二级熟练", "三级熟练"];
    /** 能替谁掷：玩家是自己的角色，主持人是全队 */
    function rollUnits() {
      const units = ((displayState || view.state || {}).units || []).filter(u => u.isPlayer && !u.weaponOf && !u.hidden && u.kit);
      if (view.isHost) return units;
      const mine = new Set((hs().units || []).filter(u => u.owner === own()).map(u => u.id));
      return units.filter(u => mine.has(u.id));
    }
    function profLevel(kit, prof) {
      const p = typeof heroProfile === "function" ? heroProfile(kit) : null;
      return Math.min(3, Number(((p && p.profs) || {})[prof]) || 0);
    }
    function rollLines(level) {
      const row = (typeof ROGUE_CHECKS !== "undefined" && ROGUE_CHECKS.chance[level]) || [0, 0, 0, 0];
      const pct = x => Math.floor(x * 100 + 1e-9);   // 点数是整数：12.5 就是 ≤12
      const out = [];
      [["大成功", 5], ["极难", pct(row[3])], ["困难", pct(row[2])], ["普通", pct(row[1])], ["简单", pct(row[0])]].filter(([, v]) => v > 5).forEach(([n, v]) => {
        const last = out[out.length - 1];
        if (last && last.v === v) last.n += " / " + n; else out.push({ n, v });
      });
      return ["大成功 ≤5"].concat(out.map(x => `${x.n} ≤${x.v}`)).join(" · ") + (out.length && out[out.length - 1].v < 100 ? ` · 更高是失败` : "");
    }
    function paintRoll() {
      const units = rollUnits();
      if (!units.some(u => u.id === rollForm.unit)) rollForm.unit = units[0]?.id || "";
      const u = units.find(x => x.id === rollForm.unit);
      const groups = typeof PROFICIENCIES !== "undefined" ? PROFICIENCIES : {};
      const all = Object.values(groups).flat();
      if (!all.includes(rollForm.prof)) rollForm.prof = all[0] || "";
      const profOpts = Object.keys(groups).map(g => `<optgroup label="${esc(g)}">${groups[g].map(p => { const lv = u ? profLevel(u.kit, p) : 0; return option(p, `${p}${lv ? "（" + LV[lv] + "）" : ""}`, p === rollForm.prof); }).join("")}</optgroup>`).join("");
      const level = u ? profLevel(u.kit, rollForm.prof) : 0;
      const perks = u && typeof checkPerksFor === "function" ? checkPerksFor(u.kit, rollForm.prof, false) : {};
      rollBox.innerHTML = `<div class="ol-card"><header><h2>掷骰 · d100</h2><button type="button" class="ol-button" data-roll="close">关闭</button></header>${units.length ? `<label>角色<select id="ol-roll-unit">${units.map(x => option(x.id, x.name, x.id === rollForm.unit)).join("")}</select></label><label>熟练项<select id="ol-roll-prof">${profOpts}</select></label><p class="ol-roll-lines"><b>${esc(LV[level])}</b>　点数越低越好：${esc(rollLines(level))}${perks.adv ? "（种族优势：掷两颗取低）" : perks.dis ? "（种族劣势：掷两颗取高）" : ""}</p><label>说明（可不填）<input id="ol-roll-note" maxlength="80" value="${esc(rollForm.note)}" placeholder="比如：撬开仓库的锁"></label>${view.isHost ? `<label class="ol-check-line"><input type="checkbox" id="ol-roll-secret"${rollForm.secret ? " checked" : ""}> 暗骰（结果只有主持人看得到）</label>` : ""}<footer><button type="button" class="ol-button ol-primary" data-roll="go"${disabled() ? " disabled" : ""}>掷 d100</button></footer>` : '<p class="ol-muted">还没有分配到你的角色。</p>'}</div>`;
    }
    function openRoll() { if (!view.active) return; paintRoll(); rollBox.hidden = false; rollBox.querySelector("#ol-roll-prof, [data-roll=close]")?.focus({ preventScroll: true }); }
    async function doRoll() {
      if (!rollForm.unit || !rollForm.prof || disabled()) return;
      const cmd = { type: "skillRoll", unitId: rollForm.unit, prof: rollForm.prof, note: rollForm.note.trim() };
      if (view.isHost && rollForm.secret) cmd.secret = true;
      if (await call(() => api.submit(cmd))) { rollForm.note = ""; rollBox.hidden = true; }
    }
    /** 最近 10 场战绩：每场的结果、评价、掉落，和每个人的数据 */
    function recordMarkup(list) {
      const out = { win: "胜利", lose: "失败", retreat: "撤退" };
      const cols = [["dmg", "伤害"], ["share", "占比%"], ["brk", "击破"], ["kills", "击杀"], ["staggers", "失衡"], ["assists", "协助攻击"], ["blockOk", "格挡成功"], ["taken", "承伤"], ["heal", "治疗"], ["score", "得分"]];
      const rows = list.slice().reverse().map(b => {
        const d = b.drops, dropText = d ? [d.kuizhi ? `${d.kuizhi} 奎支` : "", ...(d.items || []).map(x => `${x.name}×${x.qty}`)].filter(Boolean).join("、") : "";
        return `<article class="ol-record"><header><b>第 ${esc(b.no)} 场${b.name ? " · " + esc(b.name) : ""}</b><span>${esc(out[b.outcome] || "")} · ${esc(b.turns)} 回合${b.grade ? ` · 评价 ${esc(b.grade)}（${esc(b.score)} 分）` : ""}</span></header>${b.when ? `<small class="ol-muted">${esc(b.when)}</small>` : ""}${dropText ? `<p>掉落：${esc(dropText)}</p>` : ""}${(b.rows || []).length ? `<div class="ol-record-table"><table><thead><tr><th>角色</th>${cols.map(c => `<th>${c[1]}</th>`).join("")}</tr></thead><tbody>${b.rows.map(r => `<tr><td>${r.weaponOf ? "　" : ""}${esc(r.name)}</td>${cols.map(c => `<td>${esc(r[c[0]] ?? 0)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : '<p class="ol-muted">这场没有明细。</p>'}</article>`;
      }).join("");
      return `<div class="ol-card ol-record-card"><header><h2>最近 10 场战绩</h2><button type="button" class="ol-button" data-bag="close">关闭</button></header>${rows || '<p class="ol-muted">还没有打过仗。</p>'}</div>`;
    }
    async function openInfo(kind) {
      if (pending || typeof api.sheetData !== "function") return;
      let data = null;
      const ok = await call(async () => { data = await api.sheetData(); if (data?.ok === false) return data; });
      if (!ok || !data || destroyed) return;
      const kit = myKit();
      if (kind === "sheet" && global.HeroSheet) global.HeroSheet.open(data.sheets || [], kit);
      else if (kind === "armory" && global.Armory) global.Armory.open(data.armory || [], kit);
      else if (kind === "record") { bagBox.innerHTML = recordMarkup(data.battles || []); bagBox.hidden = false; bagBox.querySelector('[data-bag="close"]')?.focus({ preventScroll: true }); }
      else if (kind === "bag") { bagBox.innerHTML = bagMarkup(data.bag); bagBox.hidden = false; bagBox.querySelector('[data-bag="close"]')?.focus({ preventScroll: true }); }
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
      playTitle();
      stage.hidden = !view.active || view.isHost;
      side.hidden = !view.active || view.isHost || view.screen === "lobby";
      document.body.classList.toggle("ol-has-side", !side.hidden);
      document.body.classList.toggle("ol-host-online", !!(view.active && view.isHost));
      document.body.classList.toggle("ol-in-battle", view.screen === "battle" || view.screen === "ended");
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
      renderSide();
      mountHostChat();
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
    /** 复制房间码：优先用剪贴板接口，不行（file:// 等不安全来源）就退回选中文字再复制 */
    async function copyRoomCode() {
      const code = String(view.roomCode || "");
      if (!code) return;
      let ok = false;
      try { if (navigator.clipboard && window.isSecureContext !== false) { await navigator.clipboard.writeText(code); ok = true; } } catch (e) { ok = false; }
      if (!ok) {
        const ta = document.createElement("textarea");
        ta.value = code; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        ta.remove();
      }
      notice = ok ? `已复制房间码 ${code}` : "无法自动复制，请长按或拖选房间码手动复制。";
      render();
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
          else opts.roomCode = form.roomCode.replace(/[^0-9a-z]/gi, "").toUpperCase();   // 粘贴时带的空格、标点去掉
          if (await call(() => api[entry === "create" ? "create" : "join"](opts))) { panelOpen = false; assignments = {}; render(); }
          break;
        }
        case "resume": if (await call(() => api.resume())) { panelOpen = false; render(); } break;
        case "reconnect": await call(() => api.reconnect()); break;
        case "copyCode": await copyRoomCode(); break;
        case "leave": await call(() => api.leave()); break;
        case "assign": await call(() => api.assign(Object.fromEntries((view.heroes || []).map(h => [h.id, assignments[h.id] || h.owner || own()])))); assignments = {}; break;
        case "start": if (await call(() => api.start())) { panelOpen = false; render(); } break;
        case "actor": await menu({ actor: b.dataset.actor }); break;
        case "resetMenu": if (request) await menu({ actor: request.actor }); break;
        case "option": await choose(Number(b.dataset.option)); break;
        case "execute": if (currentMenu?.choices?.command && !disabled()) { const command = copy(currentMenu.choices.command); if (await call(() => api.submit(command))) { currentMenu = request = null; render(); } } break;
        case "endTurn": if (!disabled()) await call(() => api.submit({ type: "endTurn", actor: b.dataset.actor })); break;
        case "info": await openInfo(b.dataset.info); break;
        case "showLog": sideTab.battle = "log"; renderSide(true); side.querySelector(".ol-side-log")?.scrollIntoView({ block: "nearest" }); break;
        case "checkRoll": if (!disabled()) await call(() => api.submit({ type: "checkRoll", checkId: b.dataset.check, unitId: b.dataset.unit })); break;
        case "attrRequest": if (!disabled()) await call(() => api.submit({ type: "attrRequest", unitId: b.dataset.unit, attr: b.dataset.attr })); break;
        case "attrCancel": if (!disabled()) await call(() => api.submit({ type: "attrDecide", requestId: b.dataset.request, decision: "cancel" })); break;
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
          if (event.kind === "proc") {
            // 效果生效：卡上对应的图标放大一下并发光，不弹字
            if (card) global.HudIcons?.procIn(card, event.fx);
            await new Promise(resolve => setTimeout(resolve, 60));
            continue;
          }
          if (card) {
            const bubble = card.querySelector(".ol-popup");
            bubble.textContent = event.text || (event.value == null ? ({ dmg: "受击", heal: "恢复", break: "击破", status: "状态变化" }[event.kind] || "行动") : `${event.kind === "heal" ? "+" : event.kind === "dmg" ? "−" : ""}${event.value}`);
            const fk = (event.kind === "fxword" || event.kind === "status") && event.text && global.HudIcons?.keyOf(event.text);
            if (fk && event.kind === "fxword") { bubble.insertAdjacentHTML("afterbegin", global.HudIcons.badge(fk)); global.HudIcons.proc(bubble.firstElementChild); }
            if (fk) global.HudIcons.procIn(card, fk);
            card.classList.add("ol-impact"); bubble.classList.add("ol-visible");
            if (global.HitFx && (event.kind === "dmg" || event.kind === "highboom")) global.HitFx.burst(event.element || "physical", card.getBoundingClientRect(), { big: event.kind === "highboom" });
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
      document.removeEventListener("compositionstart", onCompStart, true); document.removeEventListener("compositionend", onCompEnd, true);
      document.removeEventListener("click", onRollOpen); clearTimeout(titleTimer);
      while (hostMounts.length) hostMounts.pop().remove(); document.body.classList.remove("ol-has-side", "ol-host-online", "ol-in-battle");
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
