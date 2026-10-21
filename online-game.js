/* Online TRPG coordinator. Only a host invokes GAME; recipients hold display
 * packets separately from the rules state. Every network send is projected. */
(function (root) {
  "use strict";
  const PROTOCOL = 1, BUILD = "backfire-d3-v1", KEY = "backfire-online-v1";
  const copy = v => JSON.parse(JSON.stringify(v));
  const listeners = new Set(), packetListeners = new Set(), pending = new Map(), requests = new Map(), requestHighWater = new Map();
  const gmContext = Object.freeze({}), controls = new Set(["orderPick", "orderConfirm", "orderMove", "orderSwapAccept", "answer", "chat", "checkOpen", "checkRoll", "checkClose", "attrRequest", "attrDecide", "skillRoll", "showTitle", "purseTransfer", "shopBuy", "shopRedeem", "cyberRequest", "cyberwareInstall", "cyberwareRemove", "shopSell", "shopBuyback"]);
  const messageContexts = new WeakMap();
  const recipientWires = new Map(), displayWire = OnlineWire.create();
  let endpoint = null, identity = null, status = { connected: false, paused: true, roster: [] }, active = false;
  let screen = "lobby", seq = 0, lastSeq = -1, requestNo = Date.now() * 100, messageNo = 0, messages = [], publicLogs = [];
  let remote = null, notice = "", systemNotice = "", readying = false, restoring = false, started = false, settledResult = null;
  let queue = Promise.resolve(), gmQueue = Promise.resolve(), animation = Promise.resolve(), actionMenu = null, manualResolve = null, manualPhase = false;
  let offlineWait = null, storageError = false, epoch = 0;
  let pausedAt = null, resumeAI = false, awaitingResync = false;
  // 房间玩法：trpg 跑团（有主持人） / rogue 联机单局（online-rogue.js：投票、各人钱包、按需求分战利品）
  let mode = "trpg";
  const rogue = () => mode === "rogue" && !!root.OnlineRogue;
  const rogueTypes = ["rogue.vote", "rogue.need", "rogue.act", "rogue.force"];
  /** 这名角色（kit）归哪个玩家：联机单局按单局里记的，跑团按热座分配；没分配的归房主 */
  function ownerOfKit(kit) {
    if (rogue()) return OnlineRogue.ownerOf(kit);
    const view = HotseatGame.isActive() ? HotseatGame.getView() : null;
    const row = view && view.heroes.find(h => (state.units.find(u => u.id === h.id) || {}).kit === kit);
    return (row && row.owner) || identity?.id;
  }
  /** 发给某个玩家的升级提示：只有他自己操控的角色的；坚毅生命对玩家保密 */
  function levelUpsFor(id) {
    if (typeof LevelUp === "undefined") return [];
    return LevelUp.unseen().filter(ev => ownerOfKit(ev.kit) === id)
      .map(ev => ({ ...ev, stats: (ev.stats || []).filter(r => r.key !== "shp") })).slice(0, 10);
  }
  const isHost = () => active && identity?.role === "host";
  const isPaused = () => active && (!status.connected || !status.hostOnline || status.paused);
  function notify() { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } }
  function error(message) { throw new Error(message); }
  function roster() { return status.roster.map(p => ({ id: p.id, name: p.name, gm: p.role === "host", online: !!p.online })); }
  function liveScreen() { return !started ? "lobby" : GAME.ended && Screens.is("battle") ? "ended" : Screens.is("battle") ? "battle" : "exploration"; }
  /** 联机单局的角色分配按角色 kit（场上单位每次重摆 id 都会变） */
  function rogueHeroes() {
    const run = root.RunFlow?.current();
    return run ? run.party.map(h => ({ id: h.kit, name: Rogue.heroName(h.kit), owner: OnlineRogue.ownerOf(h.kit) })) : [];
  }
  function getView() {
    return { active, mode, isHost: isHost(), identity: copy(identity), status: copy(status), notice, storageError,
      screen: isHost() ? liveScreen() : remote?.screen || screen, roomCode: identity?.roomCode || "", players: roster(),
      packet: isHost() ? { state, view: HotseatGame.getView(), messages: messages.slice(-300), publicLogs: OnlineView.projectLogs(publicLogs), systemNotice } : remote,
      state: isHost() ? state : remote?.state, messages: isHost() ? messages.slice(-300) : remote?.messages || [],
      heroes: isHost() ? (rogue() ? rogueHeroes() : HotseatGame.getView().heroes) : remote?.view?.heroes || [], offlineWait: copy(isHost() ? offlineWait : remote?.offlineWait || null),
      manualPhase: isHost() ? manualPhase : !!remote?.manualPhase,
      // 克制表（matchup.js）：房主按战场现状算，玩家读房主发来的（packet.matchup）
      matchup: isHost() ? matchupNow() : remote?.matchup || null };
  }
  /** 克制表：当前天气 + 当前行动单位所在区的冻土 / 恶劣环境 + 相位（matchup.js · matchupForState）。不含坚毅 */
  function matchupNow() {
    // 顶层：只看环境（和以前一样，按房主当前行动单位所在区）；units：每个看得见的单位作为受击者各一份（选中谁就用谁的），不含血量、坚毅
    try {
      if (typeof matchupForState !== "function") return null;
      const m = matchupForState(state, root.GAME && GAME.actorId, { defender: false });
      if (typeof matchupUnitCharts === "function") m.units = matchupUnitCharts(state);
      return m;
    } catch (e) { return null; }
  }
  let leftRoom = false;   // 玩家点了「离开房间」：之后（包括刷新时的 pagehide）不再覆盖存档里的 left 标记
  function save() {
    if (!endpoint || !identity || leftRoom) return;
    const data = { version: 1, credentials: endpoint.credentials(), identity, requestNo, savedAt: Date.now() };
    if (isHost()) Object.assign(data, { mode, levelUps: typeof LevelUp !== "undefined" ? LevelUp.save() : [], game: GAME.onlineCheckpoint(), hotseat: HotseatGame.checkpoint(pausedAt ?? Date.now()),
      trpg: rogue() ? null : TrpgFlow.onlineCheckpoint(), rogue: rogue() ? RunFlow.onlineCheckpoint() : null,
      gm: GMCommands.snapshot(), screen: Screens.current(), started, seq, messageNo, messages, publicLogs, settledResult, systemNotice, offlineWait, requests: [...requests].slice(-200), requestHighWater: [...requestHighWater] });
    try { localStorage.setItem(KEY, JSON.stringify(data)); storageError = false; } catch (_) { storageError = true; }
  }
  /** 倒计时换成本机的钟：房主发来「还剩多少毫秒」，按收到这一包的时刻算本机的截止时间（播动画的延迟不算进去） */
  function localDeadlines(packet, at) {
    const ask = packet && packet.view && packet.view.ask;
    if (ask && Number.isFinite(ask.remainingMs)) ask.deadline = at + ask.remainingMs;
    const wait = packet && packet.offlineWait;
    if (wait && Number.isFinite(wait.remainingMs)) wait.deadline = at + wait.remainingMs;
  }
  function readSaved() { try { const v = JSON.parse(localStorage.getItem(KEY)); return v?.version === 1 ? v : null; } catch (_) { return null; } }
  function rawPacket(id, type = "result", tape = [], result = null, fx = null) {
    const view = HotseatGame.getViewFor(id); view.players = roster(); view.network = true;
    return { protocol: PROTOCOL, build: BUILD, type, seq, state, tape, result: result || settledResult, view, screen: liveScreen(),
      fx,   // 这一下的攻击演出（谁打谁、哪种招式；game.js · strikePlan），玩家画面照着播出手和弹道
      roomCode: identity.roomCode, hostName: identity.name, paused: isPaused(), messages, publicLogs, manualPhase, systemNotice,
      offlineWait: offlineWait ? { ...offlineWait, remainingMs: Math.max(0, offlineWait.deadline - Date.now()) } : null,
      mode, matchup: matchupNow(), rogue: rogue() ? OnlineRogue.viewFor(id) : null, levelUps: levelUpsFor(id),
      // 义体（单局诊所）：自己操控的角色的义体视图和诊所目录（online-rogue.js · cyberwareFor；online-view.js · projectCyberware 白名单 + scrubHidden）
      // 跑团：诊所开着时同样的 { heroes:[{kit,name,purse,view,shop,previews}] }（trpg.js · trpgCyberwarePacket）
      cyberware: rogue() ? (OnlineRogue.cyberwareFor ? OnlineRogue.cyberwareFor(id) : null)
        : typeof trpgCyberwarePacket === "function" && typeof TRPG !== "undefined" && TRPG.active && TRPG.clinicOpen ? trpgCyberwareFor(id, id === identity.id) : null,
      // 任务日志（跑团）：房主按收件人挑好（草稿、没指定给他的不给），online-view.js 再按白名单投影
      quests: !rogue() && typeof trpgQuestLog === "function" ? trpgQuestLog(id, id === identity.id, kitsOwnedBy(id)) : null,
      // 跑团私人钱包：自己操控的角色看得到余额，队友只给名字（转账用）；主持人看全部（online-view.js · projectPurse）
      purse: !rogue() && typeof trpgPurse === "function" && typeof TRPG !== "undefined" && TRPG.active ? purseFor(id, id === identity.id) : null,
      // 跑团商人：主持人开着的那家店（trpg-merchants.js · trpgMerchantView；online-view.js · projectShop 白名单）
      shop: !rogue() && typeof trpgMerchantView === "function" && typeof TRPG !== "undefined" && TRPG.active ? trpgMerchantView() : null,
      // 跑团卖东西 / 回购（shop-sell.js · trpgShopSellView；online-view.js · projectShopSell 白名单）
      shopSell: !rogue() && typeof trpgShopSellView === "function" && typeof TRPG !== "undefined" && TRPG.active ? trpgShopSellFor(id, id === identity.id) : null,
      // 跑团诊所开放时：自己操控的角色的改造信息和申请状态（online-view.js · projectClinic）
      clinic: !rogue() && typeof trpgCyberInfo === "function" && typeof TRPG !== "undefined" && TRPG.active && TRPG.clinicOpen ? clinicFor(id, id === identity.id) : null,
      // 长休结算（跑团；单局的在 rogue.lastRest 里）和游戏时钟：online-view.js · projectRest / clock 白名单
      rest: !rogue() && typeof TRPG !== "undefined" ? TRPG.lastRest || null : null,
      camp: !rogue() && typeof TRPG !== "undefined" && TRPG.camp ? Object.assign({ force: TRPG.camp.force }, TRPG.camp.status) : null,
      clock: typeof LEDGER !== "undefined" ? { day: LEDGER.day, clock: LEDGER.clock } : null };
  }
  function sendProjected(id, packet) {
    const safe = OnlineView.projectPacket(packet, { recipientId: id, gmId: identity.id, itemCatalog: typeof ITEM_CATALOG !== "undefined" ? ITEM_CATALOG : {} });
    if (!recipientWires.has(id)) recipientWires.set(id, OnlineWire.create());
    return endpoint.send(recipientWires.get(id).pack(safe), id).catch(e => { if (status.connected) { notice = e.message; notify(); } });
  }
  function publish(tape = [], result = null, fx = null) {
    if (!isHost() || !HotseatGame.isActive()) return;
    if (manualResolve && GAME.ended) { const finish = manualResolve; manualResolve = null; manualPhase = false; finish(); }
    if ((!state.combatStarted || GAME.ended) && HotseatGame.getView().players.map(p => p.id).join("|") !== roster().map(p => p.id).join("|")) setupOperators();
    seq++;
    for (const p of status.roster) if (p.role !== "host" && p.online) sendProjected(p.id, rawPacket(p.id, "result", tape, result, fx));
    save(); notify();
  }
  function resync(id) { if (isHost() && HotseatGame.isActive()) return sendProjected(id, rawPacket(id, "resync")); }
  function clinicFor(id, isGM) {
    const mine = isGM ? (typeof trpgHeroes === "function" ? trpgHeroes().map(h => h.kit) : []) : kitsOwnedBy(id);
    return { heroes: mine.map(kit => {
      const info = trpgCyberInfo(kit);
      if (!info) return null;
      const req = (TRPG.cyberRequests || []).filter(r => r.kit === kit).slice(-1)[0] || null;
      return { kit, name: info.name, purse: trpgPurse(kit), cyber: { current: info.current, limit: info.limit, rate: info.rate, fleshMax: info.fleshMax, perHp: info.perHp },
        request: req ? { status: req.status, cost: req.cost, note: req.note } : null };
    }).filter(Boolean) };
  }
  /** 跑团卖出视图：背包都是公用的；回购单只给自己角色卖的（主持人看全部） */
  function trpgShopSellFor(id, isGM) { return trpgShopSellView(isGM ? null : kitsOwnedBy(id)); }
  function trpgCyberwareFor(id, isGM) {
    const mine = isGM ? (typeof trpgHeroes === "function" ? trpgHeroes().map(h => h.kit) : []) : kitsOwnedBy(id);
    const heroes = mine.map(kit => { try { return trpgCyberwarePacket(kit); } catch (e) { return null; } }).filter(Boolean);
    return heroes.length ? { heroes } : null;
  }
  function purseFor(id, isGM) {
    const mine = isGM ? null : kitsOwnedBy(id);
    const heroes = typeof trpgHeroes === "function" ? trpgHeroes().filter(h => !h.dead) : [];
    return {
      party: trpgPurse("party"),
      heroes: heroes.map(h => (isGM || mine.includes(h.kit) ? { kit: h.kit, name: h.name, amount: trpgPurse(h.kit), mine: !isGM } : { kit: h.kit, name: h.name }))
    };
  }
  /** 这名房间成员操控的角色 kit（个人任务只给操控这名角色的人看，trpg-tasks.js · trpgQuestLog） */
  function kitsOwnedBy(pid) {
    if (typeof HotseatGame === "undefined" || !HotseatGame.isActive()) return [];
    return (HotseatGame.getView().heroes || []).filter(h => h.owner === pid)
      .map(h => (state.units.find(u => u.id === h.id) || {}).kit).filter(Boolean);
  }
  function setupOperators(assignments) {
    const old = HotseatGame.isActive() ? HotseatGame.getView().heroes : [];
    // 联机单局：角色归谁记在单局里（按角色 kit），场上的单位每次重摆 id 都会变
    // 已经离开房间（座位被释放）的玩家不在名单里：他的角色回到房主
    const ids = roster().map(p => p.id);
    const next = assignments || (rogue() ? OnlineRogue.assignmentsFor(state.units.filter(u => u.isPlayer && !u.weaponOf)) : Object.fromEntries(old.filter(u => ids.includes(u.owner)).map(u => [u.id, u.owner])));
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
      if (isHost() && rogue()) OnlineRogue.changed();
      save(); notify();
    });
    mountOrder(); save(); notify();
  }
  // 连接中可以取消（联机面板的「取消」）：开房、加入都带着这个信号
  let connectAbort = null;
  const connectSignal = () => { connectAbort = typeof AbortController === "function" ? new AbortController() : null; return connectAbort ? connectAbort.signal : undefined; };
  async function create(options) {
    if (active) error("请先离开当前房间");
    if (options.mode === "rogue") return createRogue(options);
    const index = Number(options.slot);
    if (!Number.isInteger(index) || index < 0 || index > 2) error("请选择跑团存档空位");
    const ep = await RelayTransport.createHost({ ...options, protocol: PROTOCOL, build: BUILD, signal: connectSignal() });
    // Existing slot loading/creation remains on the established command path.
    if (trpgReadSlots()[index]) TrpgFlow.enter(index);
    else Commands.dispatch({ type: "trpg.ui", action: "new", index, name: options.campaignName || "联机跑团", level: 1 });
    GMCommands.reset(); restoring = true; bind(ep); configureGM(); configureActions(); setupOperators(); restoring = false;
    started = false; screen = "lobby"; await ready(); publish(); return getView();
  }
  /** 联机单局：房主先选队伍出发，再把角色分给进房间的玩家，然后开始 */
  async function createRogue(options) {
    if (!root.OnlineRogue || !root.RunFlow) error("这个版本没有联机单局");
    const ep = await RelayTransport.createHost({ ...options, protocol: PROTOCOL, build: BUILD, signal: connectSignal() });
    mode = "rogue";
    if (typeof TRPG !== "undefined") TRPG.active = false;
    state.units = [];
    RunFlow.startOnline();   // 选队伍画面（在热座会话接管指令之前）
    GMCommands.reset(); restoring = true; bind(ep); OnlineRogue.enable(true, identity.id); configureGM(); configureActions(); setupOperators(); restoring = false;
    started = false; screen = "lobby"; await ready(); publish(); return getView();
  }
  async function join(options) {
    if (active) error("请先离开当前房间");
    const ep = await RelayTransport.join({ ...options, protocol: PROTOCOL, build: BUILD, signal: options.resumeToken ? undefined : connectSignal() });
    bind(ep); screen = "lobby"; document.body.classList.add("online-player");
    if (!status.paused) await ep.send({ type: "resync", protocol: PROTOCOL, build: BUILD });
    return getView();
  }
  // 同时来的两次恢复（刷新后自动恢复 + 手动点「恢复」）合并成一次；已经用同一个身份回到房间就直接返回
  let resuming = null;
  function resume() { if (resuming) return resuming; resuming = doResume().finally(() => { resuming = null; }); return resuming; }
  async function doResume() {
    const saved = readSaved();
    if (active && saved && identity && saved.identity && saved.identity.id === identity.id) return getView();
    if (active) error("已经在房间中");
    if (!saved) error("没有可恢复的房间");
    const c = saved.credentials; if (c.build !== BUILD || c.protocol !== PROTOCOL) error("版本不同，请刷新并新建房间");
    requestNo = Math.max(requestNo, saved.requestNo || 0); restoring = true;
    try {
      if (c.role === "host") {
        const ep = await RelayTransport.resumeHost({ ...c, hostToken: c.token });
        bind(ep); configureGM(); configureActions();
        mode = saved.mode === "rogue" ? "rogue" : "trpg";
        if (rogue()) { OnlineRogue.enable(true, identity.id); RunFlow.restoreOnline(saved.rogue); }
        if (typeof LevelUp !== "undefined") LevelUp.load(saved.levelUps || []);
        GAME.restoreOnline(saved.game); if (!rogue()) TrpgFlow.restoreOnline(saved.trpg); HotseatGame.restoreOnline(saved.hotseat); GMCommands.restore(saved.gm, gmContext);
        started = saved.started; seq = saved.seq || 0; messages = saved.messages || []; publicLogs = saved.publicLogs || []; settledResult = saved.settledResult || null; systemNotice = saved.systemNotice || "";
        messageNo = Math.max(0, Number.isSafeInteger(saved.messageNo) ? saved.messageNo : 0,
          ...messages.map(m => /^msg-\d+$/.test(m.id) ? Number(m.id.slice(4)) : 0).filter(Number.isSafeInteger));
        offlineWait = saved.offlineWait ? { ...saved.offlineWait, deadline: Date.now() + Math.max(0, saved.offlineWait.deadline - saved.savedAt) } : null;
        requests.clear(); for (const [key, entry] of saved.requests || []) {
          if (!entry.response) entry.response = { type: "ack", requestId: Number(key.slice(key.lastIndexOf(":") + 1)), protocol: PROTOCOL, build: BUILD, ok: false, error: "房主已经恢复，请按当前画面确认该操作结果" };
          requests.set(key, entry);
        }
        requestHighWater.clear(); for (const [id, number] of saved.requestHighWater || []) requestHighWater.set(id, number);
        HotseatGame.system({ type: "screen", action: "show", name: saved.screen || (rogue() ? "run" : "trpg") });
        // 单局战斗打到一半刷新：结算面板的「继续」重新接回单局
        if (rogue() && Screens.is("battle") && RunFlow.battleSpecLite()) GAME.resumeRogueBattle(RunFlow.battleSpecLite(), RunFlow.battleEnd);
        // 单局在战斗外恢复：存档里可能还带着上一场战斗的状态（combatStarted / 已结束），
        // 这时接着跑战斗流程会判「敌人全灭」，弹出过期的「胜利 · 第1回合结束」结算面板。战斗外不接战斗流程，面板也收起
        const outOfBattle = rogue() && !Screens.is("battle");
        if (outOfBattle) { const panel = root.document && document.getElementById("g-result"); if (panel) panel.classList.remove("show");
          const reopen = root.document && document.getElementById("g-reopen"); if (reopen) reopen.classList.remove("show"); }
        restoring = false; await ready(); publish();
        if (!outOfBattle) (saved.hotseat?.openingChoice && !state.combatStarted ? GAME.startOrEnd() : GAME.resumeOnline()).catch(reportError);
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
    if (cmd.type === "levelup.seen") {
      const ev = typeof LevelUp !== "undefined" && LevelUp.unseen().find(e => e.id === cmd.id);
      if (!ev || ownerOfKit(ev.kit) !== sender) error("这条升级提示不是你的");
      LevelUp.markSeen(ev.id); publish(); return { ok: true };
    }
    if (rogueTypes.includes(cmd.type)) {
      if (!rogue()) error("这个房间不是联机单局");
      const result = OnlineRogue.handle(sender, cmd); publish(); return result && result.ok === false ? result : { ok: true };
    }
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
      const result = await HotseatGame.withOperator(sender, () => GAME.act(cmd, { actorId: cmd.actor, skillName: actionLabel(cmd) }));
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
  function sheetPacket(recipient) {
    const ST = root.SkillText;
    let sheets = [], armory = [];
    const run = rogue() && root.RunFlow ? RunFlow.current() : null;
    // 联机单局：角色资料、武器按单局里的数据；背包是自己的钱包、自己名下的东西和队伍公用的补给
    if (run) {
      // 战斗中：场上就是队伍，直接读；战斗外按单局记录摆上场再读（会重摆场上，战斗中不能这样）
      const live = OnlineRogue.inBattle();
      try { sheets = live ? ST.sheetData() : Rogue.sheetData(run); } catch (e) { sheets = []; }
      try { armory = live ? ST.armoryData() : Rogue.armoryData(run); } catch (e) { armory = []; }
      const v = OnlineRogue.viewFor(recipient) || { heroes: [], freeItems: [] };
      const mine = v.heroes.filter(h => h.mine);
      const items = mine.flatMap(h => h.items.map(x => ({ ...x, name: (mine.length > 1 ? h.name + "：" : "") + x.name, hint: (ITEM_CATALOG[x.id] || {}).hint || "" })))
        .concat(v.freeItems.map(x => ({ ...x, name: "（公用）" + x.name, hint: (ITEM_CATALOG[x.id] || {}).hint || "" })));
      return { type: "sheetData", protocol: PROTOCOL, build: BUILD, sheets, armory, bag: { water: Number(state.bag?.water) || 0, kuizhi: mine.reduce((s, h) => s + h.purse, 0), items }, battles: (LEDGER.career?.battles || []).slice(-10) };
    }
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
      if (packet.type === "sheetData") return sendProjected(sender, { ...sheetPacket(sender), requestId: packet.requestId });
      if (packet.type === "actionOptions") {
        if (isPaused()) error("房间暂停");
        const menu = actionMenu.menu(packet.request, sender);
        return sendProjected(sender, { ...menu, type: "actionOptions", requestId: packet.requestId, protocol: PROTOCOL, build: BUILD });
      }
      if (packet.type !== "cmd") error("未知消息");
      if (!packet.command || ![...controls, ...rogueTypes, "levelup.seen", "skill", "move", "standUp", "useItem", "endTurn", "gmReply"].includes(packet.command.type)) error("只有主持人可以执行此操作");
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
    localDeadlines(packet, Date.now());
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
  /** 战斗记录里的行动名：查技能的中文名，不把内部技能 id（ruby_aa）露给玩家 */
  function actionLabel(cmd) {
    // 移动写去了哪一区，用道具写用了什么、对谁，起身写清楚；都是玩家画面上本来就看得到的信息，不带任何坚毅生命数值
    if (cmd.type === "move") return Number.isFinite(Number(cmd.dest)) && cmd.dest !== null ? `移动 → ${Number(cmd.dest)} 区` : "移动";
    if (cmd.type === "standUp") return "起身 · 重新站起";
    if (cmd.type === "useItem") {
      const item = typeof ITEM_CATALOG !== "undefined" && cmd.item ? ITEM_CATALOG[cmd.item] : null;
      const target = cmd.target ? state.units.find(u => u.id === cmd.target) : null;
      return "使用道具" + (item?.name ? " " + item.name : "") + (target?.name ? " → " + target.name : "") + (Number.isFinite(Number(cmd.dest)) && cmd.dest !== null ? ` · 到 ${Number(cmd.dest)} 区` : "");
    }
    const fixed = { endTurn: "结束行动" }[cmd.type];
    if (fixed) return fixed;
    const id = cmd.skill;
    if (!id) return "行动";
    try {
      const actor = state.units.find(u => u.id === cmd.actor);
      const sk = actor && typeof GAME !== "undefined" && typeof GAME.gameSkills === "function" ? (GAME.gameSkills(actor) || []).find(s => s.id === id) : null;
      if (sk && sk.name) return sk.name;
    } catch (_) { /* 取不到就用通用名 */ }
    return { __move: "移动", __item: "使用道具", __stand: "起身" }[id] || "行动";
  }
  /** 这一下的结算摘要（战场日志用）：按单位合计伤害 / 击破 / 治疗，和弹出的状态字（失衡、倒下、感电……）。
   *  只用玩家画面上本来就看得到的那些弹字：落在坚毅生命上（起身 / 濒死 / 死亡）的伤害和治疗不写数字，online-view.js · projectLogs 再过一遍白名单 */
  function hitSummary(tape) {
    const rows = new Map();
    (tape || []).forEach(ev => {
      if (!ev || ev.type !== "pop" || !ev.unitId) return;
      const u = state.units.find(x => x.id === ev.unitId), snap = (ev.snap || []).find(x => x && x.id === ev.unitId) || u;
      if (!u) return;
      const row = rows.get(u.id) || { name: u.name, dmg: 0, brk: 0, heal: 0, words: [], aliveBefore: !(snap && (snap.dead || snap._removed)) };
      const hpVisible = snap && !snap.upOnShp && !snap.dying && !snap.dead;
      const n = Math.floor(Number(ev.value) || 0);
      if (ev.kind === "dmg" && hpVisible) row.dmg += n;
      else if (ev.kind === "heal" && hpVisible) row.heal += n;
      else if (ev.kind === "break") row.brk += n;
      if (ev.text && !row.words.includes(ev.text)) row.words.push(String(ev.text));
      if (ev.kind === "dmg" && ev.adv && !row.words.includes("克制")) row.words.push("克制");
      rows.set(u.id, row);
    });
    rows.forEach((r, id) => { const u = state.units.find(x => x.id === id); if (r.aliveBefore && u && !u.isPlayer && u.dead && !r.words.includes("被打倒")) r.words.push("被打倒"); delete r.aliveBefore; });
    return [...rows.values()].filter(r => r.dmg || r.brk || r.heal || r.words.length).slice(0, 12);
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
      else if (actor) publicLogs.push({ kind: "action", actorName: actor.name, actionName: (!["move", "standUp", "useItem"].includes(cmd.type) && meta.skillName && meta.skillName !== cmd.skill && meta.skillName !== cmd.type ? meta.skillName : actionLabel(cmd)), hits: hitSummary(tape), turn: state.turnNo, at: Date.now() });
      // 新一回合开始（敌人回合收尾 / 开战）：写回合数，回合开始的持续伤害、倒下也跟着这一行
      else if (cmd.type === "battle.endEnemyTurn" || cmd.type === "startCombat") publicLogs.push({ kind: "round", turn: state.turnNo, hits: hitSummary(tape), at: Date.now() });
      else publicLogs.push({ kind: "phase", phase: state.combatPhase, turn: state.turnNo, at: Date.now() });
      publicLogs = publicLogs.slice(-100);
    }
    publish(tape, result, meta.fx || null);
  }
  function offlineTick() {
    if (!isHost() || isPaused() || !HotseatGame.isActive()) return;
    const view = HotseatGame.getView(), unit = view.order.find(u => u?.actor === view.currentUnitId);
    for (const p of status.roster) if (p.role === "player" && !p.online) {
      const ask = HotseatGame.getViewFor(p.id).ask;
      // 掉线的人：协助询问一律不协助；掉线的是打出失衡、要拍板的人时，有人举手就让最先举手的出手，没人举手就等到时间
      if (ask?.isChooser) { if (ask.hands?.length) HotseatGame.receiveFrom(p.id, { type: "answer", askId: ask.id, helper: ask.hands[0].helper }); }
      else if (ask?.eligible && !ask.declined && ask.kind !== "choice") HotseatGame.receiveFrom(p.id, { type: "answer", askId: ask.id, helper: null, extra: {} });
      // 选项为空时（没有可替掉线玩家选的项）跳过，别抛错，也别挡住后面「掉线玩家回合超时」的处理
      const option = ask?.eligible && ask.kind === "choice" ? ask.options?.[0] : null;
      if (option) {
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
      if (cmd.type === "battle.finish") {
        settledResult = { ...value, outcome: cmd.outcome };
        // 战斗结果进公开记录（只写结果，不带评分 / 坚毅数值）
        const kind = { win: "victory", lose: "defeat", retreat: "retreat" }[cmd.outcome];
        if (kind && outer) { publicLogs.push({ kind, turn: state.turnNo, at: Date.now() }); publicLogs = publicLogs.slice(-100); }
      }
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
    hasSaved: () => !!readSaved(),
    savedInfo: () => { const s = readSaved(); return s ? { role: s.credentials?.role || "", roomCode: s.credentials?.roomCode || "", name: s.identity?.name || "", left: !!s.left } : null; }, slots: () => trpgReadSlots().map((s, index) => ({ index, name: s?.name || "空白存档" })),
    assign(assignments) {
      if (!isHost()) error("只有主持人可以分配角色");
      if (rogue()) {
        const map = assignments || {}, ids = roster().map(p => p.id);
        if (Object.values(map).some(pid => !ids.includes(pid))) error("没有这名玩家");
        const counts = {};
        Object.values(map).forEach(pid => { if (pid !== identity.id) counts[pid] = (counts[pid] || 0) + 1; });
        if (Object.values(counts).some(n => n > 1)) error("每名玩家最多操控一名角色，没分配的角色由房主操控");
        OnlineRogue.setOwners(map);
        root.OnlineGame.reassign();
      } else setupOperators(assignments);
      publish(); return { ok: true };
    },
    /** 联机单局：角色归属变了 / 场上重摆过之后，重新分配战斗里的操控（战斗进行中不动） */
    reassign() {
      if (!isHost() || !rogue() || (state.combatStarted && !GAME.ended)) return;
      const want = OnlineRogue.assignmentsFor(state.units.filter(u => u.isPlayer && !u.weaponOf));
      const view = HotseatGame.isActive() ? HotseatGame.getView() : null;
      const same = view && view.heroes.every(h => (want[h.id] || identity.id) === h.owner) && view.players.map(p => p.id).join("|") === roster().map(p => p.id).join("|");
      if (same) { if (OnlineRogue.inBattle()) HotseatGame.syncAssignments(); return; }
      try { setupOperators(want); } catch (e) { notice = e.message; }
    },
    /** 接管：玩家掉线时，房主把他的角色（连同武器人）接过来自己操作。战斗中也可以；
     *  联机单局里只管这一场战斗，打完按单局记的归属还给他；跑团里一直归房主，要还给他就在「保存角色分配」里重新分配 */
    takeOver(playerId) {
      if (!isHost()) error("只有主持人可以接管角色");
      const p = status.roster.find(x => x.id === playerId && x.role === "player");
      if (!p) error("没有这名玩家");
      if (!HotseatGame.isActive()) error("现在没有可接管的角色");
      const ack = HotseatGame.takeOver(playerId);
      if (!ack.ok) error(ack.error);
      if (offlineWait && offlineWait.owner === playerId) offlineWait = null;
      publish(); return { ok: true };
    },
    /** 战斗中能不能转交角色：{ ok, reason }。只有联机跑团的主持人，且只在两个单位的回合之间 */
    transferState() {
      if (!isHost()) return { ok: false, reason: "只有主持人可以转交角色" };
      if (rogue()) return { ok: false, reason: "联机单局开局后座位固定，不能转交" };
      if (!HotseatGame.isActive() || !state.combatStarted || GAME.ended) return { ok: false, reason: "只在战斗中转交；探索时用「角色分配」" };
      return HotseatGame.transferState();
    },
    /** 战斗中转交：主持人把角色（连同武器人）交给某名玩家；toId 为主持人自己 = 收回。成功后写一行公开记录 */
    transfer(heroId, toId) {
      const gate = root.OnlineGame.transferState();
      if (!gate.ok) error(gate.reason);
      const ack = HotseatGame.transferHero(heroId, toId);
      publicLogs.push({ kind: "transfer", heroName: ack.heroName, toName: ack.toName, toGM: toId === identity.id, turn: state.turnNo, at: Date.now() }); publicLogs = publicLogs.slice(-100);
      publish(); return { ok: true };
    },
    /** 释放座位：转发服务丢掉这名玩家的恢复令牌（昵称和名额可以重新用），他的角色回到房主 */
    async releaseSeat(playerId) {
      if (!isHost()) error("只有主持人可以释放座位");
      const p = status.roster.find(x => x.id === playerId && x.role === "player");
      if (!p) error("没有这名玩家");
      if (typeof endpoint.releaseSeat !== "function") error("这个版本的转发连接不支持释放座位");
      await endpoint.releaseSeat(playerId);
      if (rogue()) OnlineRogue.release(playerId);
      if (HotseatGame.isActive() && HotseatGame.getView().heroes.some(h => h.owner === playerId)) {
        try { HotseatGame.takeOver(playerId); } catch (e) { notice = e.message; }
      }
      if (offlineWait && offlineWait.owner === playerId) offlineWait = null;
      recipientWires.delete(playerId);
      publish(); return { ok: true };
    },
    touch() { if (isHost()) publish(); },
    /** 联机跑团：主持人能选的队员（大厅 / 探索时换人用）：[{ kit, name, on }] */
    partyChoices() {
      if (!isHost() || rogue() || typeof livePartyCards !== "function") return [];
      const on = new Set((root.GAME && GAME.partyKits) || []);
      return livePartyCards().filter(c => !c.weaponOf).map(c => ({ kit: c.kit, name: c.name, on: on.has(c.kit) }));
    },
    /** 联机跑团：换队员（不在战斗中）。留下来的角色保留原来的操控者，新来的先归主持人 */
    setParty(kits) {
      if (!isHost()) error("只有主持人可以换队员");
      if (rogue()) error("联机单局在单局画面选队伍");
      if (state.combatStarted && !GAME.ended) error("战斗中不能换队员");
      const valid = new Set((typeof livePartyCards === "function" ? livePartyCards() : []).filter(c => !c.weaponOf).map(c => c.kit));
      kits = (Array.isArray(kits) ? kits : []).filter((k, i, a) => valid.has(k) && a.indexOf(k) === i);
      if (!kits.length) error("至少选一名队员");
      const ownerByKit = {};
      (HotseatGame.isActive() ? HotseatGame.getView().heroes : []).forEach(h => { const u = state.units.find(x => x.id === h.id); if (u) ownerByKit[u.kit] = h.owner; });
      Commands.dispatch({ type: "trpg.ui", action: "party", kits, level: (root.GAME && GAME.level) || 1 });
      const ids = roster().map(p => p.id);
      const next = {};
      state.units.filter(u => u.isPlayer && !u.weaponOf).forEach(u => { const o = ownerByKit[u.kit]; if (o && ids.includes(o)) next[u.id] = o; });
      setupOperators(next);
      publish(); return { ok: true };
    },
    /** 取消正在进行的开房 / 加入（连接中的等待可能要十几秒） */
    cancelConnect() { if (connectAbort) { connectAbort.abort(); connectAbort = null; } return { ok: true }; },
    players: () => roster(),
    ownerOfKit,
    start() { if (!isHost()) error("只有主持人可以开始"); if (rogue() && !RunFlow.current()) error("先选好队伍出发"); if (!status.roster.some(p => p.role === "player" && p.online)) error("请等待至少一名玩家加入"); started = true; publish(); return { ok: true }; },
    actionMenu: request => rpc("actionOptions", { request }),
    sheetData: () => isHost() ? Promise.resolve(OnlineView.projectPacket(sheetPacket(identity.id), { recipientId: identity.id, gmId: identity.id })) : rpc("sheetData", {}),
    messageHistory: (request = {}) => isHost() ? Promise.resolve(messagePage(identity.id, request)) : rpc("messageHistory", { beforeId: request.beforeId || null }),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onPacket(fn) { packetListeners.add(fn); return () => packetListeners.delete(fn); },
    reconnect: () => endpoint?.reconnect(),
    // 玩家主动离开：存档标上 left，刷新后不再自动回房（以前照存照回，玩家点「离开房间」又被拉回去），标题页留「回到房间」按钮；
    // 主持人「离开并保存」照旧（主持人本来就不自动回房）
    leave() {
      save();
      if (!isHost()) { leftRoom = true; const s = readSaved(); if (s) { s.left = true; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {} } }
      endpoint?.close(); epoch++; active = false; location.reload();
    }
  };
  const boot = () => { if (root.OnlineGMUI) OnlineGMUI.mount(root.OnlineGame); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})(window);
