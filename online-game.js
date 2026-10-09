/* Online TRPG coordinator. Only a host invokes GAME; recipients hold display
 * packets separately from the rules state. Every network send is projected. */
(function (root) {
  "use strict";
  const PROTOCOL = 1, BUILD = "backfire-d3-v1", KEY = "backfire-online-v1";
  const copy = v => JSON.parse(JSON.stringify(v));
  const listeners = new Set(), packetListeners = new Set(), pending = new Map(), requests = new Map(), requestHighWater = new Map();
  const gmContext = Object.freeze({}), controls = new Set(["orderPick", "orderConfirm", "orderMove", "orderSwapAccept", "answer", "chat", "checkOpen", "checkRoll", "checkClose", "attrRequest", "attrDecide", "skillRoll", "showTitle"]);
  const messageContexts = new WeakMap();
  const recipientWires = new Map(), displayWire = OnlineWire.create();
  let endpoint = null, identity = null, status = { connected: false, paused: true, roster: [] }, active = false;
  let screen = "lobby", seq = 0, lastSeq = -1, requestNo = Date.now() * 100, messageNo = 0, messages = [], publicLogs = [];
  let remote = null, notice = "", systemNotice = "", readying = false, restoring = false, started = false, settledResult = null;
  let queue = Promise.resolve(), gmQueue = Promise.resolve(), animation = Promise.resolve(), actionMenu = null, manualResolve = null, manualPhase = false;
  let offlineWait = null, storageError = false, epoch = 0;
  let pausedAt = null, resumeAI = false, awaitingResync = false;
  const isHost = () => active && identity?.role === "host";
  const isPaused = () => active && (!status.connected || !status.hostOnline || status.paused);
  function notify() { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } }
  function error(message) { throw new Error(message); }
  function roster() { return status.roster.map(p => ({ id: p.id, name: p.name, gm: p.role === "host", online: !!p.online })); }
  function liveScreen() { return !started ? "lobby" : GAME.ended && Screens.is("battle") ? "ended" : Screens.is("battle") ? "battle" : "exploration"; }
  function getView() {
    return { active, isHost: isHost(), identity: copy(identity), status: copy(status), notice, storageError,
      screen: isHost() ? liveScreen() : remote?.screen || screen, roomCode: identity?.roomCode || "", players: roster(),
      packet: isHost() ? { state, view: HotseatGame.getView(), messages: messages.slice(-300), publicLogs: OnlineView.projectLogs(publicLogs), systemNotice } : remote,
      state: isHost() ? state : remote?.state, messages: isHost() ? messages.slice(-300) : remote?.messages || [],
      heroes: isHost() ? HotseatGame.getView().heroes : remote?.view?.heroes || [], offlineWait: copy(isHost() ? offlineWait : remote?.offlineWait || null),
      manualPhase: isHost() ? manualPhase : !!remote?.manualPhase };
  }
  function save() {
    if (!endpoint || !identity) return;
    const data = { version: 1, credentials: endpoint.credentials(), identity, requestNo, savedAt: Date.now() };
    if (isHost()) Object.assign(data, { game: GAME.onlineCheckpoint(), hotseat: HotseatGame.checkpoint(pausedAt ?? Date.now()), trpg: TrpgFlow.onlineCheckpoint(),
      gm: GMCommands.snapshot(), screen: Screens.current(), started, seq, messageNo, messages, publicLogs, settledResult, systemNotice, offlineWait, requests: [...requests].slice(-200), requestHighWater: [...requestHighWater] });
    try { localStorage.setItem(KEY, JSON.stringify(data)); storageError = false; } catch (_) { storageError = true; }
  }
  function readSaved() { try { const v = JSON.parse(localStorage.getItem(KEY)); return v?.version === 1 ? v : null; } catch (_) { return null; } }
  function rawPacket(id, type = "result", tape = [], result = null) {
    const view = HotseatGame.getViewFor(id); view.players = roster(); view.network = true;
    return { protocol: PROTOCOL, build: BUILD, type, seq, state, tape, result: result || settledResult, view, screen: liveScreen(),
      roomCode: identity.roomCode, hostName: identity.name, paused: isPaused(), messages, publicLogs, manualPhase, offlineWait, systemNotice };
  }
  function sendProjected(id, packet) {
    const safe = OnlineView.projectPacket(packet, { recipientId: id, gmId: identity.id, itemCatalog: typeof ITEM_CATALOG !== "undefined" ? ITEM_CATALOG : {} });
    if (!recipientWires.has(id)) recipientWires.set(id, OnlineWire.create());
    return endpoint.send(recipientWires.get(id).pack(safe), id).catch(e => { if (status.connected) { notice = e.message; notify(); } });
  }
  function publish(tape = [], result = null) {
    if (!isHost() || !HotseatGame.isActive()) return;
    if (manualResolve && GAME.ended) { const finish = manualResolve; manualResolve = null; manualPhase = false; finish(); }
    if ((!state.combatStarted || GAME.ended) && HotseatGame.getView().players.map(p => p.id).join("|") !== roster().map(p => p.id).join("|")) setupOperators();
    seq++;
    for (const p of status.roster) if (p.role !== "host" && p.online) sendProjected(p.id, rawPacket(p.id, "result", tape, result));
    save(); notify();
  }
  function resync(id) { if (isHost() && HotseatGame.isActive()) return sendProjected(id, rawPacket(id, "resync")); }
  function setupOperators(assignments) {
    const old = HotseatGame.isActive() ? HotseatGame.getView().heroes : [];
    const next = assignments || Object.fromEntries(old.map(u => [u.id, u.owner]));
    const ack = HotseatGame.enableOnline({ mode: "trpg", players: roster(), assignments: next });
    if (!ack.ok) error(ack.error);
  }
  function mountOrder() {
    HotseatUI.mount({ getView: () => isHost() ? HotseatGame.getView() : { ...(remote?.view || {}), enabled: active, configured: true, network: true, canConfigure: false, canDisable: false },
      submit: cmd => submit(cmd), subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } });
  }
  function configureGM() {
    GMCommands.configure({ requireHost: ctx => { if (!isHost() || ctx !== gmContext) error("只有主持人可以执行此操作"); return true; },
      enemyEndTurn: () => { if (!manualResolve) error("当前不是主持人敌人行动阶段"); const finish = manualResolve; manualResolve = null; manualPhase = false; finish(); },
      setEncounter: cmd => GAME.setupBattle(GAME.level, cmd.encounter) });
  }
  function configureActions() {
    actionMenu = OnlineActions.create({ game: GAME, validation: HotseatValidation, inspect: HotseatValidation.inspect,
      assertAction: (id, actor) => HotseatGame.assertActionFrom(id, actor), getState: () => state });
  }
  async function ready() {
    if (!isHost() || readying || restoring || !status.connected || !status.hostOnline) return;
    readying = true;
    try { await endpoint.setReady(true); for (const p of status.roster) if (p.role === "player" && p.online) resync(p.id); }
    catch (e) { notice = e.message; } finally { readying = false; notify(); }
  }
  function bind(ep) {
    endpoint = ep; identity = ep.identity; active = true; epoch++;
    ep.onMessage((packet, from) => { if (isHost()) receive(packet, from); else receiveDisplay(packet); });
    ep.onStatus(next => {
      const before = status; status = next;
      if (!isHost() && (!next.connected || next.paused)) {
        for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("连接中断，重连后请按当前画面确认操作结果")); }
        pending.clear();
      }
      if (isHost()) {
        if (isPaused() && pausedAt === null) pausedAt = Date.now();
        else if (!isPaused() && pausedAt !== null) { const elapsed = Date.now() - pausedAt; pausedAt = null; HotseatGame.extendAsk(elapsed); if (offlineWait) offlineWait.deadline += elapsed; }
      }
      if (isHost() && !restoring) {
        const oldIds = (HotseatGame.isActive() ? HotseatGame.getView().players : []).map(p => p.id).join("|");
        const newIds = roster().map(p => p.id).join("|");
        if ((!state.combatStarted || GAME.ended) && oldIds !== newIds) {
          try { setupOperators(); } catch (e) { notice = e.message; }
        }
        if (next.connected && next.paused) ready();
        else if (next.connected) {
          for (const p of next.roster) if (p.role === "player" && p.online && !before.roster?.some(b => b.id === p.id && b.online)) resync(p.id);
          publish();
        }
      } else if (!isHost() && next.connected && !next.paused && (before.paused || !before.connected)) {
        endpoint.send({ type: "resync", protocol: PROTOCOL, build: BUILD }).catch(() => {});
      }
      save(); notify();
    });
    mountOrder(); save(); notify();
  }
  async function create(options) {
    if (active) error("请先离开当前房间");
    const index = Number(options.slot);
    if (!Number.isInteger(index) || index < 0 || index > 2) error("请选择跑团存档空位");
    const ep = await RelayTransport.createHost({ ...options, protocol: PROTOCOL, build: BUILD });
    // Existing slot loading/creation remains on the established command path.
    if (trpgReadSlots()[index]) TrpgFlow.enter(index);
    else Commands.dispatch({ type: "trpg.ui", action: "new", index, name: options.campaignName || "联机跑团", level: 1 });
    GMCommands.reset(); restoring = true; bind(ep); configureGM(); configureActions(); setupOperators(); restoring = false;
    started = false; screen = "lobby"; await ready(); publish(); return getView();
  }
  async function join(options) {
    if (active) error("请先离开当前房间");
    const ep = await RelayTransport.join({ ...options, protocol: PROTOCOL, build: BUILD });
    bind(ep); screen = "lobby"; document.body.classList.add("online-player");
    if (!status.paused) await ep.send({ type: "resync", protocol: PROTOCOL, build: BUILD });
    return getView();
  }
  async function resume() {
    if (active) error("已经在房间中");
    const saved = readSaved(); if (!saved) error("没有可恢复的房间");
    const c = saved.credentials; if (c.build !== BUILD || c.protocol !== PROTOCOL) error("版本不同，请刷新并新建房间");
    requestNo = Math.max(requestNo, saved.requestNo || 0); restoring = true;
    try {
      if (c.role === "host") {
        const ep = await RelayTransport.resumeHost({ ...c, hostToken: c.token });
        bind(ep); configureGM(); configureActions();
        GAME.restoreOnline(saved.game); TrpgFlow.restoreOnline(saved.trpg); HotseatGame.restoreOnline(saved.hotseat); GMCommands.restore(saved.gm, gmContext);
        started = saved.started; seq = saved.seq || 0; messages = saved.messages || []; publicLogs = saved.publicLogs || []; settledResult = saved.settledResult || null; systemNotice = saved.systemNotice || "";
        messageNo = Math.max(0, Number.isSafeInteger(saved.messageNo) ? saved.messageNo : 0,
          ...messages.map(m => /^msg-\d+$/.test(m.id) ? Number(m.id.slice(4)) : 0).filter(Number.isSafeInteger));
        offlineWait = saved.offlineWait ? { ...saved.offlineWait, deadline: Date.now() + Math.max(0, saved.offlineWait.deadline - saved.savedAt) } : null;
        requests.clear(); for (const [key, entry] of saved.requests || []) {
          if (!entry.response) entry.response = { type: "ack", requestId: Number(key.slice(key.lastIndexOf(":") + 1)), protocol: PROTOCOL, build: BUILD, ok: false, error: "房主已经恢复，请按当前画面确认该操作结果" };
          requests.set(key, entry);
        }
        requestHighWater.clear(); for (const [id, number] of saved.requestHighWater || []) requestHighWater.set(id, number);
        HotseatGame.system({ type: "screen", action: "show", name: saved.screen || "trpg" });
        restoring = false; await ready(); publish();
        (saved.hotseat?.openingChoice && !state.combatStarted ? GAME.startOrEnd() : GAME.resumeOnline()).catch(reportError);
      } else { restoring = false; return join({ ...c, name: saved.identity.name, resumeToken: c.token }); }
    } finally { restoring = false; }
    return getView();
  }
  function reportError(e) {
    console.error(e); notice = e.message || "联机操作失败";
    if (isHost()) { systemNotice = "房主遇到处理错误，请等待主持人确认后继续"; publish(); }
    else notify();
  }
  function enqueue(fn) { const next = queue.then(fn, fn); queue = next.catch(() => {}); return next; }
  async function execute(cmd, sender) {
    if (isPaused()) error("房主离线，房间暂停");
    if (!cmd || typeof cmd.type !== "string") error("无效指令");
    Commands.validate(cmd);
    if (cmd.type === "gm.msg" || cmd.type === "gmReply") {
      const context = Object.freeze({}); messageContexts.set(context, sender);
      try { HotseatGame.system(cmd, context); publish(); return { ok: true }; }
      finally { messageContexts.delete(context); }
    }
    if (cmd.type.startsWith("gm.")) {
      if (sender !== identity.id) error("只有主持人可以执行此操作");
      if (["gm.enemyAct", "gm.enemyEndTurn"].includes(cmd.type) && !manualPhase) error("当前不是主持人敌人行动阶段");
      GMCommands.validate(cmd, gmContext);
      if (cmd.type === "gm.enemyEndTurn") { HotseatGame.system(cmd, gmContext); publish(); return { ok: true }; }
      const meta = { unitName: state.units.find(u => u.id === cmd.actor)?.name, propName: state.props.find(p => p.id === cmd.id)?.name };
      await GAME.actSystem(cmd, meta, gmContext);
      if (cmd.type === "gm.setManual" && !cmd.enabled && manualResolve) { resumeAI = true; const finish = manualResolve; manualResolve = null; manualPhase = false; finish(); }
      publish(); return { ok: true };
    }
    if (controls.has(cmd.type) || cmd.type === "orderStart") {
      const ack = HotseatGame.receiveFrom(sender, cmd); if (!ack.ok) error(ack.error); publish(); return { ok: true };
    }
    if (!["skill", "move", "standUp", "useItem", "endTurn"].includes(cmd.type)) error("只有主持人可以执行此操作");
    HotseatGame.validateFrom(sender, cmd);
    if (cmd.type === "endTurn") await HotseatGame.withOperator(sender, () => GAME.endTurn());
    else {
      const result = await HotseatGame.withOperator(sender, () => GAME.act(cmd, { actorId: cmd.actor, skillName: cmd.skill || cmd.type }));
      if (result === false) error("规则不允许这个行动");
    }
    publish(); return { ok: true };
  }
  function recordMessage(cmd, context) {
      const sender = messageContexts.get(context);
      if (!isHost() || !sender) error("消息需要房间绑定的发送者");
      if (typeof cmd.text !== "string" || !cmd.text.trim() || cmd.text.length > 2000) error("消息应为 1–2000 字");
      if (cmd.type === "gm.msg" && sender !== identity.id) error("只有主持人可以执行此操作");
      const to = cmd.type === "gmReply" ? identity.id : cmd.to;
      if (to !== "all" && !status.roster.some(p => p.id === to)) error("没有这个收件人");
      messages.push({ id: "msg-" + (++messageNo), from: sender, to, text: cmd.text.trim(), at: Date.now() });
      return { accepted: true };
  }
  // Keep the complete room history on the host. Ordinary display packets carry
  // only a recent window; older pages are filtered BEFORE choosing the cursor,
  // so neither a page nor its metadata reveals other players' private traffic.
  /** 角色资料、武器页、背包明细（玩家点「角色资料 / 武器 / 背包」时向房主要；发送前经过 OnlineView 去掉隐藏数值） */
  function bagDetail() {
    const bag = state.bag && typeof state.bag === "object" ? state.bag : { items: [] };
    const items = (Array.isArray(bag.items) ? bag.items : []).filter(x => x && (Number(x.qty) || 0) > 0).map(x => {
      const cat = typeof ITEM_CATALOG !== "undefined" ? ITEM_CATALOG[x.id] : null;
      const bp = !cat && typeof blueprintSpec === "function" ? blueprintSpec(x.id) : null;
      return { id: x.id, qty: Number(x.qty) || 0, name: (cat && cat.name) || (bp && "图纸·" + bp.name) || x.id, hint: (cat && cat.hint) || (bp && bp.text) || "" };
    });
    return { water: Number(bag.water) || 0, kuizhi: Number(state.kuizhi) || 0, items };
  }
  function sheetPacket() {
    const ST = root.SkillText;
    let sheets = [], armory = [];
    try { sheets = ST ? ST.sheetData() : []; } catch (e) { sheets = []; }
    try { armory = ST && ST.armoryData ? ST.armoryData() : []; } catch (e) { armory = []; }
    const battles = typeof LEDGER !== "undefined" && LEDGER.career && Array.isArray(LEDGER.career.battles) ? LEDGER.career.battles.slice(-10) : [];
    return { type: "sheetData", protocol: PROTOCOL, build: BUILD, sheets, armory, bag: bagDetail(), battles };
  }
  function messagePage(sender, request = {}) {
    const visible = sender === identity.id ? messages : messages.flatMap(m => OnlineView.projectMessages([m], { recipientId: sender, gmId: identity.id }));
    let end = visible.length;
    if (request.beforeId != null) {
      if (typeof request.beforeId !== "string") error("无效消息位置");
      end = visible.findIndex(m => m.id === request.beforeId);
      if (end < 0) error("消息位置已经失效");
    }
    return { type: "messageHistory", protocol: PROTOCOL, build: BUILD, displayOnly: true,
      messages: copy(visible.slice(Math.max(0, end - 100), end)), hasMore: end > 100 };
  }
  Commands.register("gm.msg", recordMessage, { domain: "online" });
  Commands.register("gmReply", recordMessage, { domain: "online" });
  function immediate(cmd) { return controls.has(cmd.type) || ["gm.msg", "gmReply", "orderStart"].includes(cmd.type); }
  async function receive(packet, sender) {
    if (!active || !isHost() || !status.roster.some(p => p.id === sender && p.role === "player")) return;
    try {
      if (packet.protocol !== PROTOCOL || packet.build !== BUILD) error("版本不同，请刷新");
      if (packet.type === "resync") return resync(sender);
      if (!Number.isSafeInteger(packet.requestId) || packet.requestId < 1) error("无效指令编号");
      if (packet.type === "messageHistory") return sendProjected(sender, { ...messagePage(sender, packet), requestId: packet.requestId });
      if (packet.type === "sheetData") return sendProjected(sender, { ...sheetPacket(), requestId: packet.requestId });
      if (packet.type === "actionOptions") {
        if (isPaused()) error("房间暂停");
        const menu = actionMenu.menu(packet.request, sender);
        return sendProjected(sender, { ...menu, type: "actionOptions", requestId: packet.requestId, protocol: PROTOCOL, build: BUILD });
      }
      if (packet.type !== "cmd") error("未知消息");
      if (!packet.command || ![...controls, "skill", "move", "standUp", "useItem", "endTurn", "gmReply"].includes(packet.command.type)) error("只有主持人可以执行此操作");
      const key = sender + ":" + packet.requestId, fingerprint = JSON.stringify(packet.command), previous = requests.get(key);
      if (previous) {
        if (previous.fingerprint !== fingerprint) error("指令编号已经用于另一操作");
        if (previous.response) return sendProjected(sender, previous.response);
        return; // Original in-flight command will send the acknowledgement.
      }
      if (packet.requestId <= (requestHighWater.get(sender) || 0)) error("这个指令编号已经失效，请按当前画面重新选择");
      requestHighWater.set(sender, packet.requestId);
      requests.set(key, { fingerprint, response: null }); save();
      const run = () => execute(packet.command, sender);
      let response;
      try { response = await (immediate(packet.command) ? run() : enqueue(run)); }
      catch (e) { response = { ok: false, error: e.message }; }
      const ack = { ...response, type: "ack", requestId: packet.requestId, protocol: PROTOCOL, build: BUILD };
      requests.set(key, { fingerprint, response: ack });
      while (requests.size > 200) requests.delete(requests.keys().next().value);
      save(); await sendProjected(sender, ack);
    } catch (e) { sendProjected(sender, { type: "ack", requestId: packet.requestId || 0, ok: false, error: e.message, protocol: PROTOCOL, build: BUILD }); }
  }
  function receiveDisplay(packet) {
    if (!active || packet.protocol !== PROTOCOL || packet.build !== BUILD || packet.displayOnly !== true) return;
    if (packet.type === "ack" || packet.type === "actionOptions" || packet.type === "messageHistory" || packet.type === "sheetData") {
      const item = pending.get(packet.requestId); if (!item) return;
      clearTimeout(item.timer); pending.delete(packet.requestId); item.resolve(packet); return;
    }
    if (!["result", "resync"].includes(packet.type) || !Number.isSafeInteger(packet.seq)) return;
    if (awaitingResync && packet.type !== "resync") return;
    if (packet.type !== "resync" && packet.seq <= lastSeq || packet.type === "resync" && packet.seq < lastSeq) return;
    if (packet.type !== "resync" && lastSeq >= 0 && packet.seq !== lastSeq + 1) {
      endpoint.send({ type: "resync", protocol: PROTOCOL, build: BUILD }).catch(reportError); return;
    }
    try { packet = displayWire.unpack(packet); }
    catch (e) { reportError(e); endpoint.send({ type: "resync", protocol: PROTOCOL, build: BUILD }).catch(reportError); return; }
    lastSeq = packet.seq;
    const currentEpoch = epoch;
    if (packet.type === "resync") { epoch++; animation = Promise.resolve(); awaitingResync = false; }
    const incomingEpoch = packet.type === "resync" ? epoch : currentEpoch;
    animation = animation.then(async () => {
      if (incomingEpoch !== epoch) return;
      for (const fn of packetListeners) { if (incomingEpoch !== epoch) return; await fn(copy(packet)); if (incomingEpoch !== epoch) return; }
      if (incomingEpoch !== epoch) return;
      remote = copy(packet); remote.view.network = true; screen = packet.screen; notice = ""; notify();
    }).catch(e => { if (incomingEpoch !== epoch) return; epoch++; animation = Promise.resolve(); awaitingResync = true; reportError(e); endpoint.send({ type: "resync", protocol: PROTOCOL, build: BUILD }).catch(reportError); });
  }
  function rpc(type, fields) {
    if (!active || isHost()) return Promise.reject(new Error("没有玩家连接"));
    if (isPaused()) return Promise.reject(new Error("房主离线，等待恢复连接"));
    const requestId = ++requestNo; save();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("等待房主回应超时，请重连确认结果")); }, 90000);
      pending.set(requestId, { resolve, reject, timer });
      endpoint.send({ type, ...fields, requestId, protocol: PROTOCOL, build: BUILD }).catch(e => { clearTimeout(timer); pending.delete(requestId); reject(e); });
    });
  }
  async function submit(cmd) {
    try {
      if (!isHost()) return await rpc("cmd", { command: cmd });
      const run = async () => { while (GAME.depth > (manualPhase || GAME.onlineEditWindow ? 1 : 0)) await new Promise(r => setTimeout(r, 50)); return execute(cmd, identity.id); };
      if (cmd.type.startsWith("gm.") && cmd.type !== "gm.msg") { const next = gmQueue.then(run, run); gmQueue = next.catch(() => {}); return await next; }
      return await (immediate(cmd) ? execute(cmd, identity.id) : enqueue(run));
    } catch (e) { notice = e.message; notify(); return { ok: false, error: e.message }; }
  }
  async function waitUntilReady() { while (active && isPaused()) await new Promise(r => setTimeout(r, 100)); }
  function queueHostEdit(fn) {
    if (!isHost()) return Promise.reject(new Error("只有主持人可以执行此操作"));
    const run = async () => {
      while (GAME.depth > (manualPhase || GAME.onlineEditWindow ? 1 : 0)) await new Promise(r => setTimeout(r, 50));
      await waitUntilReady(); const result = await GAME.actLegacy(fn);
      if (typeof TRPG !== "undefined" && TRPG.active) GAME.rememberCampaign();
      GAME.refresh(); if (Screens.is("trpg")) TrpgFlow.refresh(); if (state.combatStarted) GAME.checkEnd(); publish(); return result;
    };
    const next = gmQueue.then(run, run); gmQueue = next.catch(reportError); return next;
  }
  function legacyAddedEnemies(beforeIds) {
    if (!isHost()) return;
    const added = state.units.filter(u => !u.isPlayer && !beforeIds.includes(u.id));
    if (added.length) {
      const saved = GMCommands.snapshot(), existing = new Set(saved.units.map(u => u.id));
      for (const u of added) if (!existing.has(u.id)) saved.units.push({ id: u.id, eligibleEnemyRound: state.combatStarted ? Number(state.turnNo) + (state.combatPhase === "enemy" ? 1 : 0) : 0 });
      GMCommands.restore(saved, gmContext);
    }
    if (!GAME.depth && !GAME.tape && [state.blockQueue, state.assistQueue, state.koltSwapQueue, state.heluScanQueue, state.longgeSafetyQueue].some(q => q?.length)) {
      queueMicrotask(() => { GAME.resolveOnlineEdits().then(() => publish()).catch(reportError); });
    }
  }
  async function flushGM() { GAME.onlineEditWindow = true; try { await gmQueue; } finally { GAME.onlineEditWindow = false; } }
  async function manualEnemyPhase() {
    if (!isHost()) return;
    const eligible = state.units.some(u => !u.isPlayer && GMCommands.isManual(u) && GMCommands.enemyMayAct(u) && EnemyAI.unitAlive(u));
    if (!eligible) return;
    manualPhase = true; publish();
    await new Promise(resolve => { manualResolve = resolve; });
    manualPhase = false; publish();
  }
  function onActionSettled(cmd, result, tape, meta) {
    if (!isHost() || restoring) return;
    if (!meta.onlineError && result?.executed !== false) systemNotice = "";
    if (cmd.type === "battle.endPlayerTurn") GAME.onlineEnemyCursor = {};
    if (cmd.type === "battle.enemyAction") { GAME.onlineEnemyCursor ||= {}; GAME.onlineEnemyCursor[cmd.actor] = cmd.step + 1; }
    if (cmd.type === "battle.endEnemyTurn") GAME.onlineEnemyCursor = {};
    if (cmd.silent !== true) {
      const actor = state.units.find(u => u.id === cmd.actor);
      if (cmd.type?.startsWith("gm.")) publicLogs.push({ kind: "gm", summary: { "gm.editUnit": "主持人更新了单位数据", "gm.setWeather": "主持人更新了天气", "gm.addProp": "主持人添加了配置物" }[cmd.type] || "主持人调整了战场",
        action: cmd.type === "gm.spawnEnemy" ? "spawn" : cmd.type === "gm.removeUnit" ? cmd.mode : cmd.type === "gm.removeProp" ? (cmd.mode === "destroy" ? "propDestroy" : "propRemove") : cmd.type === "gm.setManual" ? (cmd.enabled ? "manualOn" : "manualOff") : "edit",
        unitName: cmd.type === "gm.spawnEnemy" ? enemyPresets().find(p => p.id === cmd.enemyId)?.name : meta.unitName, propName: meta.propName, zone: cmd.zone, level: cmd.level, at: Date.now() });
      else if (actor) publicLogs.push({ kind: "action", actorName: actor.name, actionName: meta.skillName || cmd.skill || "行动", at: Date.now() });
      else publicLogs.push({ kind: "phase", phase: state.combatPhase, turn: state.turnNo, at: Date.now() });
      publicLogs = publicLogs.slice(-100);
    }
    publish(tape, result);
  }
  function offlineTick() {
    if (!isHost() || isPaused() || !HotseatGame.isActive()) return;
    const view = HotseatGame.getView(), unit = view.order.find(u => u?.actor === view.currentUnitId);
    for (const p of status.roster) if (p.role === "player" && !p.online) {
      const ask = HotseatGame.getViewFor(p.id).ask;
      if (ask?.eligible && !ask.declined && ask.kind !== "choice") HotseatGame.receiveFrom(p.id, { type: "answer", askId: ask.id, helper: null, extra: {} });
      if (ask?.eligible && ask.kind === "choice") {
        const option = ask.options[0];
        if (offlineWait?.askId && offlineWait.actor === option.helper) offlineWait.askId = ask.id;
        if (!offlineWait || offlineWait.askId !== ask.id) { offlineWait = { actor: option.helper, name: p.name, owner: p.id, askId: ask.id, deadline: Date.now() + 60000 }; publish(); }
        if (Date.now() >= offlineWait.deadline) { HotseatGame.receiveFrom(p.id, { type: "answer", askId: ask.id, helper: option.helper, extra: option.extra }); offlineWait.askId = null; }
        return;
      }
    }
    if (view.phase !== "acting" || !unit || status.roster.some(p => p.id === unit.owner && p.online)) { if (offlineWait) { offlineWait = null; publish(); } return; }
    if (!offlineWait || offlineWait.actor !== unit.actor) { offlineWait = { actor: unit.actor, name: unit.name, owner: unit.owner, deadline: Date.now() + 60000 }; publish(); }
    if (Date.now() >= offlineWait.deadline && GAME.depth === 0 && !HotseatGame.hasAsk()) { offlineWait = null; HotseatGame.withOperator(unit.owner, () => GAME.endTurn()).catch(reportError); }
  }
  let scheduled = false;
  let commandDepth = 0;
  Commands.intercept((cmd, context, next) => {
    if (!isHost() || GAME.sim || restoring) return next();
    const outer = commandDepth++ === 0;
    try {
      const value = next();
      if (cmd.type === "battle.finish") settledResult = { ...value, outcome: cmd.outcome };
      if (cmd.type === "startCombat" || cmd.type === "battle.setup") settledResult = null;
      if (outer && !GAME.tape && ["trpg", "trpg.ui", "backstage", "calc", "battle.panel"].includes(cmd.type) &&
          !/^(normalize|saveCaptured|recordBattle)/.test(cmd.action || "")) {
        publicLogs.push({ kind: "gm", summary: "主持人调整了队伍物资", at: Date.now() }); publicLogs = publicLogs.slice(-100);
      }
      return value;
    } finally { commandDepth--; }
  });
  HotseatGame.onPacket(() => {
    if (!isHost() || restoring || GAME.tape || scheduled) return;
    scheduled = true; queueMicrotask(() => { scheduled = false; publish(); });
  });
  setInterval(offlineTick, 250);
  root.addEventListener("pagehide", save);
  root.OnlineGame = { PROTOCOL, BUILD, create, join, resume, submit, getView, isHost, isPaused, waitUntilReady, manualEnemyPhase, onActionSettled, flushGM, queueHostEdit, legacyAddedEnemies, reportError,
    takeAIResume() { const value = resumeAI; resumeAI = false; return value; },
    hasSaved: () => !!readSaved(), slots: () => trpgReadSlots().map((s, index) => ({ index, name: s?.name || "空白存档" })),
    assign(assignments) { if (!isHost()) error("只有主持人可以分配角色"); setupOperators(assignments); publish(); return { ok: true }; },
    start() { if (!isHost()) error("只有主持人可以开始"); if (!status.roster.some(p => p.role === "player" && p.online)) error("请等待至少一名玩家加入"); started = true; publish(); return { ok: true }; },
    actionMenu: request => rpc("actionOptions", { request }),
    sheetData: () => isHost() ? Promise.resolve(OnlineView.projectPacket(sheetPacket(), { recipientId: identity.id, gmId: identity.id })) : rpc("sheetData", {}),
    messageHistory: (request = {}) => isHost() ? Promise.resolve(messagePage(identity.id, request)) : rpc("messageHistory", { beforeId: request.beforeId || null }),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onPacket(fn) { packetListeners.add(fn); return () => packetListeners.delete(fn); },
    reconnect: () => endpoint?.reconnect(),
    leave() { save(); endpoint?.close(); epoch++; active = false; location.reload(); }
  };
  const boot = () => { if (root.OnlineGMUI) OnlineGMUI.mount(root.OnlineGame); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})(window);
