/* D2 browser bridge. Rules run once on complete host state. The local clients
 * receive detached display packets; no transport snapshot is restored to state.
 * Ownership/order are session data and never enter the existing save format. */
(function (root) {
  "use strict";
  const requested = new URLSearchParams(root.location.search).get("hotseat") === "1";
  let enabled = requested, configured = false, session = null, authority = null;
  let clients = new Map(), playerId = "p1", config = { mode: "trpg", players: [{ id: "p1", name: "主持人", gm: true }, { id: "p2", name: "玩家 2" }] };
  let ownerByKit = {}, executing = 0, pendingContext = null, sender = null, askDetails = null, choice = null;
  let newRoundSpends = null, notice = "", restoredAsk = null;
  let network = false, commandOperator = null;
  const packetListeners = new Set();
  const listeners = new Set(), authorityContext = {}, actionTypes = new Set(["skill", "move", "standUp", "useItem"]);
  const automatic = new Set(["battle.supportInfo", "battle.checkSolo", "battle.rememberCampaign", "battle.loadCampaign"]);
  const tableTypes = new Set(["checkOpen", "checkRoll", "checkClose", "attrRequest", "attrDecide", "checkRequest", "checkDecide", "skillRoll", "showTitle", "duelRequest", "duelDecide", "duelOpen", "duelPick", "duelOptions", "purseTransfer", "shopBuy", "shopRedeem", "smithUpgrade", "workshopCraft", "workshopSalvage", "cyberRequest", "cyberwareInstall", "cyberwareRemove", "shopSell", "shopBuyback", "casino"]);
  const orderTypes = new Set(["orderPick", "orderConfirm", "orderStart", "orderMove", "orderSwapAccept", "answer", "chat", ...tableTypes]);
  const copy = value => JSON.parse(JSON.stringify(value));
  const active = () => !!(enabled && configured && session && authority && !state.solo);
  const heroes = () => (state.units || []).filter(u => u.isPlayer && !u.weaponOf && !u.isPartner && livePartyCards().some(c => c.kit === u.kit && !c.weaponOf));
  const gm = () => (config.players.find(p => p.gm) || config.players[0]).id;
  const fail = text => { throw new Error(text); };
  // （新）#340 第 11 条：小队聊天所有人都看得到，私人钱包余额只能本人和主持人看（README「队友……看不到余额」）。
  // 写进聊天的说明去掉「剩 N / 现有 N / 钱包剩 N」，只留谁付、付多少。
  // 按 trpg.js 的原句删：转账 trpgPurseTransfer「（A 剩 N，B 现有 N）」、代付 trpgPayWith「（由 X 付，钱包剩 N）」；
  // 第三条「进 X 的钱包（现有 N）」只有 trpgPurseSplit 会写，它现在不经小队聊天，留着只是预防
  const hideWallets = text => String(text)
    .replace(/（([^（）]*?) 剩 \d+，([^（）]*?) 现有 \d+）/g, "")
    .replace(/（由 ([^（），]+?) 付，钱包剩 \d+）/g, "（由 $1 付）")
    .replace(/进 ([^（）]+?) 的钱包（现有 \d+）/g, "进 $1 的钱包");
  // （新）商业相关的说明写进小队聊天都走这里
  const teamChat = (sender, text) => session.chat(sender, hideWallets(text));
  function notify() { for (const fn of [...listeners]) fn(); }
  function refresh() { notify(); if (root.GAME && document.getElementById("g-party")) GAME.refresh(); }
  function hostOnly(id) { if (id !== gm()) fail("只有房主可以执行此操作"); }
  function canConfigure() { return !choice && !session?.snapshot().ask && (!state.combatStarted || !!(root.GAME && GAME.ended)); }
  // 单局战斗外查询会把队伍重摆上场（rogue.js · withParty），单位 id 会变，而存档里的分配还是旧 id。
  // 恢复时只保留还在场上的英雄，其余按职业沿用原来的操控者，否则 setAssignments 报「只能分配英雄角色」、房主恢复失败
  function restorable(saved) {
    const out = copy(saved || {}), list = heroes(), ids = new Set(list.map(u => u.id)), assignments = {};
    for (const [id, owner] of Object.entries(out.assignments || {})) if (ids.has(id)) assignments[id] = owner;
    const byKit = kitAssignments(); for (const u of list) if (!assignments[u.id] && byKit[u.id]) assignments[u.id] = byKit[u.id];
    out.assignments = assignments; return out;
  }
  // 场上按职业（kit）该归谁：和恢复存档时（restorable）用同一份 ownerByKit，两处结论一致
  function kitAssignments() {
    const out = {};
    for (const u of heroes()) if (ownerByKit[u.kit] && config.players.some(p => p.id === ownerByKit[u.kit])) out[u.id] = ownerByKit[u.kit];
    return out;
  }
  // 单局战斗外的查询 / 开战会重摆队伍（rogue.js · withParty → BattleSim.setup），单位 id 全换了，
  // 会话里按 id 记的分配却还是旧的 → 玩家操作自己角色时被判「不是你的角色」。开战布好场后（还没开打）按 kit 重新对齐。
  // 战斗外不要每次都对齐：发视图本身就会 withParty 重摆，对齐→广播→重摆会无限循环；战斗外的单局操作按 kit 判断，不看这份分配
  function syncAssignments() {
    if (!active() || !session) return false;
    const snap = session.snapshot();
    if (!["setup", "ended"].includes(snap.phase)) return false;
    const want = kitAssignments(), held = snap.assignments || {};
    const keys = o => Object.keys(o).sort().map(k => k + "=" + o[k]).join("|");
    if (keys(want) === keys(held)) return false;
    executing++; try { session.setAssignments(want); } finally { executing--; }
    authority.broadcast(); refresh(); return true;
  }
  function setupSession() {
    if (authority) authority.close();
    clients = new Map();
    const assignments = {};
    for (const u of heroes()) if (ownerByKit[u.kit] && config.players.some(p => p.id === ownerByKit[u.kit])) assignments[u.id] = ownerByKit[u.kit];
    const keepChat = session ? session.snapshot().chat || [] : [];   // 重建会话时带上小队聊天记录
    const keepTable = session ? session.snapshot().table || null : null;   // 检定、属性点申请也带上
    session = Hotseat.create({ operators: config.players, gmId: gm(), mode: config.mode, assignments, chat: keepChat, table: keepTable,
      getUnits: () => state.units, canStand: u => !standUpBlocked(u),
      // 玩家阵营定在哪个回合行动（enemies.js · unitTurnPhase，PvP #445）：这一轮开始时所有人一起排行动顺序（#478），我方回合里只轮到在我方回合行动的，
      // 敌人回合开始时先动的那一段（#464，beginRound("enemy")）照排好的顺序轮到在敌人回合行动的；没配置阵营时都在我方回合
      inRound: (u, segment) => typeof unitTurnPhase !== "function" || unitTurnPhase(u) === (segment === "enemy" ? "enemy" : "player") });
    authority = HotseatAuthority.create({ session, validate, execute, afterCommand,
      getState: () => state, getTape: () => GAME.tape || [], viewFor: project });
    session.onChange(() => { if (!executing) authority.broadcast(); });
    for (const p of config.players) {
      const client = authority.connect(p.id); clients.set(p.id, client);
      client.onMessage(message => { if (message.type === "result" && p.id === playerId) { notify(); for (const fn of packetListeners) fn(message); } });
    }
  }
  function configure(value) {
    try {
      if (!enabled || !canConfigure()) fail("战斗中不能重新分配角色");
      if (configured) hostOnly(playerId);
      Commands.validate({ type: "hotseat.configure", value });
      if (!["trpg", "coop"].includes(value.mode) || !Array.isArray(value.players) || value.players.length < (network ? 1 : 2) || value.players.length > (network ? 5 : 4)) fail(network ? "在线跑团最多 1 名主持人与 4 名玩家" : "热座需要 2–4 名操作者");
      const ids = value.players.map(p => p.id);
      if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || !id)) fail("操作者编号必须唯一");
      const assignments = value.assignments || {}, list = heroes();
      if (Object.keys(assignments).some(id => !list.some(u => u.id === id) || !ids.includes(assignments[id]))) fail("角色分配无效");
      // #165 的「每名在线玩家最多一名角色」已取消（策划定）：主持人可以把几名角色分给同一名玩家
      if (network && (value.mode !== "trpg" || value.players.filter(p => p.gm).length !== 1)) fail("在线跑团需要恰好一名主持人");
      if (value.mode === "coop" && (list.length !== ids.length || ids.some(id => list.filter(u => assignments[u.id] === id).length !== 1))) fail("合作模式需要每名操作者恰好一名角色，请先调整队伍");
      // 不在场的角色（这场战斗没上、被收起来）保留原来的操控者：以前这里整份清空重建，
      // 有人进 / 出房间时（online-game.js · setupOperators 只按场上英雄重新配置）不在场的角色就被悄悄收回给主持人
      const prevOwners = ownerByKit, keep = {}, onField = new Set(list.map(u => u.kit)), nextGm = (value.players.find(p => p.gm) || value.players[0]).id;
      for (const kit of Object.keys(prevOwners || {})) if (!onField.has(kit) && ids.includes(prevOwners[kit]) && prevOwners[kit] !== nextGm) keep[kit] = prevOwners[kit];
      config = copy(value); ownerByKit = keep; for (const u of list) ownerByKit[u.kit] = assignments[u.id] || gm();
      if (!ids.includes(playerId)) playerId = gm();
      setupSession(); configured = true; notice = "";
      state.history = []; GAME.undo = []; GAME.disarm(); refresh();
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  function project(id, base) {
    const ask = session.askFor(id);
    if (ask) {
      const detail = askDetails || {};
      const sameExtra = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});
      const labelOf = h => (detail.options || []).find(o => o.helper === h.unitId && sameExtra(o.extra, h.extra)) ||
        (detail.options || []).find(o => o.helper === h.unitId) || { label: h.unitName, sub: "" };
      // remainingMs：发出这一包时还剩多少毫秒。联机玩家按收到的时刻用自己的钟算倒计时（deadline 是房主电脑的钟，两边不一定对得上）
      base.ask = { id: ask.id, kind: ask.kind, title: detail.title || "协助询问", deadline: ask.deadline, remainingMs: Number(ask.deadline) > 0 ? Math.max(0, ask.deadline - Date.now()) : null,
        waitingNames: ask.waiting.map(p => p.operatorName), eligible: ask.eligible, declined: ask.declined,
        options: (detail.options || []).filter(o => ask.options.some(u => u.unitId === o.helper)),
        // 协助攻击举手：打出失衡的人（chooser）看得到谁举了手并从中选人；举手的人看得到自己举的是哪一个
        chooserName: ask.chooserName || null, isChooser: !!ask.isChooser, raised: ask.raised || null,
        hands: ask.chooser ? ask.hands.map(h => { const o = labelOf(h); return { helper: h.unitId, label: o.label, sub: o.sub || "", operatorName: h.operatorName, extra: copy(h.extra || {}) }; }) : [] };
    }
    // field：有选项对应战场上的单位 → 回答的人在战场上点，不弹整屏卡片
    if (choice) base.ask = { id: choice.id, kind: "choice", title: choice.title, deadline: null, field: choice.options.some(o => !!o.target),
      eligible: id === choice.owner, declined: false, waitingNames: [(config.players.find(p => p.id === choice.owner) || {}).name || "主持人"],
      options: id === choice.owner ? choice.options : [] };
    return base;
  }
  function getViewFor(id) {
    const s = session ? (config.players.some(p => p.id === id) ? project(id, session.snapshot()) : { ...session.snapshot(), ask: null }) : null;
    return { enabled: enabled && !state.solo, network, configured, notice, mode: config.mode, playerId: id, hostId: gm(), players: copy(config.players),
      heroes: heroes().map(u => ({ id: u.id, name: u.name, owner: ownerByKit[u.kit] || gm() })),
      units: (s?.roster || []).map(r => ({ id: r.unitId, name: r.unitName, owner: r.operatorId })),
      // 场上所有能操作的单位归谁（#464）：units 只是这一段排进行动顺序的；敌人回合那一段里，在我方回合行动的角色归谁看这一份
      operable: (s?.operable || []).map(r => ({ id: r.unitId, name: r.unitName, owner: r.operatorId })),
      phase: s?.phase === "selecting" ? "picking" : s?.phase || "setup", currentUnitId: s?.currentUnitId || null,
      // 排的是哪一段：敌人回合开始时玩家阵营先动的那一段是 "enemy"（#464，行动顺序栏写「敌人回合」）
      segment: s?.segment === "enemy" ? "enemy" : "player",
      order: (s?.slots || []).map(r => r && ({ actor: r.unitId, name: r.unitName, owner: r.operatorId, locked: r.spent, done: r.completed, current: r.unitId === s.currentUnitId })),
      confirmed: s?.confirmed || [], swap: s?.pendingSwaps?.length ? { requestId: s.pendingSwaps[0].id, from: s.pendingSwaps[0].actor, to: s.pendingSwaps[0].target, recipient: s.pendingSwaps[0].responder } : null,
      ask: s?.ask || null, chat: (s?.chat || []).map(r => ({ id: r.id, operatorId: r.operatorId, name: r.operatorName, text: r.text, at: r.at, roll: r.roll ? (typeof r.roll === "object" ? { tier: r.roll.tier || null } : true) : false, tier: r.roll && r.roll.tier || null, secret: !!r.secret, title: !!r.title })),
      title: s?.table?.title ? copy(s.table.title) : null, checks: copy(s?.table?.checks || []), attrRequests: copy(s?.table?.attrs || []), checkRequests: copy(s?.table?.checkReqs || []),
      // 决斗的申请 / 准备画面（#472）：每名能参加的角色（kit、名字、归谁操控、选了哪一队），只有这些，没有血量、坚毅
      duel: duelView(s?.table?.duel),
      // 跑团地图：主持人在地图上标的队伍位置（玩家只能看，不能改）
      map: typeof LEDGER !== "undefined" && LEDGER ? { place: LEDGER.place || null, x: LEDGER.placePos ? LEDGER.placePos.x : null, y: LEDGER.placePos ? LEDGER.placePos.y : null } : null,
      // 赌场（#487）：按收件人造——自己角色的钱包、自己那一方的牌局；主持人另有自己坐庄的那几桌（庄家那一方）
      casino: casinoView(id),
      canConfigure: !network && canConfigure() && (!configured || id === gm()), canDisable: !network && canConfigure() && (!configured || id === gm()) };
  }
  const getView = () => getViewFor(playerId);
  /* ---------- 决斗（PvP 第三步，#472，docs/pvp.md 第 1.2 节）----------
   * 联机探索环节（不在战斗画面）里：玩家申请（duelRequest）→ 主持人同意（duelDecide），或者主持人直接开启（duelOpen）；
   * 准备画面里各人给自己操控的角色选队（duelPick，主持人给没分配给玩家的选），主持人定选项（duelOptions）；
   * 主持人点「开始决斗」→ trpg-ui.js · toDuel 按 duelSpec 布置战场，duelStarted 收起准备画面。规则在 hotseat.js（会话）和 enemies.js（战斗） */
  /** 能参加决斗的角色：场上（探索时摆好的队伍）的英雄，倒下死亡的不算 */
  const duelHeroes = () => heroes().filter(u => !u.dead);
  function duelView(d) {
    if (!d) return null;
    return { id: d.id, status: d.status, by: d.by, byName: d.byName, at: d.at, stand: d.stand !== false, rounds: d.rounds || null,
      heroes: duelHeroes().map(u => ({ kit: u.kit, name: u.name, owner: ownerByKit[u.kit] || gm(), team: (d.teams || {})[u.kit] || null })) };
  }
  /** 决斗只能在探索环节：房主在战斗画面（打着、打完还没回去）时不行 */
  function duelExploring() {
    if (state.combatStarted && !(root.GAME && GAME.ended)) fail("战斗中不能决斗");
    // screens.js 的 Screens 是顶层 const，不挂在 window 上：按名字找（以前写 root.Screens，浏览器里永远找不到，这一条从来没拦过，#490）
    if (typeof Screens !== "undefined" && Screens && typeof Screens.is === "function" && Screens.is("battle")) fail("先回到探索环节再决斗");
    if (typeof TRPG === "undefined" || !TRPG.active) fail("只有联机跑团的探索环节能决斗");
  }
  function duelHero(kit) {
    const u = duelHeroes().find(x => x.kit === String(kit || ""));
    if (!u) fail("没有这名角色");
    return u;
  }
  /** 主持人点「开始决斗」：准备画面里选好的两队（角色 kit）和选项，人数不对就说原因 */
  function duelSpec() {
    if (!active()) fail("热座尚未配置");
    duelExploring();
    const d = session.snapshot().table.duel;
    if (!d || d.status !== "prep") fail("决斗还没开始准备");
    const C = typeof PVP_DUEL_CFG !== "undefined" ? PVP_DUEL_CFG : { teams: [{ id: "1队", name: "1 队" }, { id: "2队", name: "2 队" }], teamMax: 4, teamMin: 1 };
    const list = duelHeroes(), teams = {};
    for (const t of C.teams) {
      teams[t.id] = list.filter(u => d.teams[u.kit] === t.id).map(u => u.kit);
      if (teams[t.id].length < C.teamMin) fail(`${t.name}至少要 ${C.teamMin} 人才能开打`);
      if (teams[t.id].length > C.teamMax) fail(`${t.name}最多 ${C.teamMax} 人`);
    }
    return { teams, stand: d.stand !== false, rounds: d.rounds || null };
  }
  function validate(cmd, id) {
    if (!active()) fail("热座尚未配置或当前为单人模式");
    if (network && root.OnlineGame?.isPaused()) fail("房主连接中断，等待恢复");
    if (cmd.type === "answer") {
      if (choice) {
        if (cmd.askId !== choice.id || id !== choice.owner) fail("不能代替其他操作者回答");
        if (!choice.options.some(o => o.helper === cmd.helper && JSON.stringify(o.extra) === JSON.stringify(cmd.extra))) fail("选择已经失效");
      } else if (cmd.helper) {
        // 打出失衡的人选举手的人：按举手时的方式出手，不用再对选项
        const open = session.snapshot().ask;
        const hand = open && open.chooser === id && (open.hands || []).some(h => h.unitId === cmd.helper);
        if (!hand && (!askDetails || !askDetails.options.some(o => o.helper === cmd.helper && JSON.stringify(o.extra || {}) === JSON.stringify(cmd.extra || {})))) fail("协助选项已经失效");
        const eligible = askDetails.eligible(); if (!eligible.some(u => u.id === cmd.helper)) fail("这名单位已不能协助");
      }
      return;
    }
    if (cmd.type === "chat" || tableTypes.has(cmd.type)) return;   // 小队聊天、检定、属性点申请不受询问、战斗阶段影响
    // 友伤开关（#428）：每人只改自己的那一个（execute 里按发指令的人填 owner），随时能改，不受询问、行动顺序影响
    if (cmd.type === "battle.friendlyFire") { if (cmd.owner != null && cmd.owner !== id) fail("只能改自己的友伤开关"); return; }
    // 主持人放弃这场战斗回到探索：等人回答的询问 / 分步选择由它收回（trpg-ui.js · backFromBattle → abandon），不用等（#322）
    const leaving = cmd.type === "trpg.ui" && cmd.action === "backFromBattle";
    if ((choice || session.snapshot().ask) && !leaving) fail("正在等待其他操作者回应");
    if (orderTypes.has(cmd.type)) { if (cmd.type === "orderSwapAccept" && typeof cmd.accept !== "boolean") fail("互换回答必须为同意或拒绝"); return; }
    if (actionTypes.has(cmd.type)) {
      if (GAME.depth > 0 && !GAME.tape) fail("正在播放行动，请稍候");
      // 敌人回合里先动的玩家阵营（#464）也按会话的行动顺序：分配给玩家的只有那名玩家能动，没分配的只有主持人能动
      HotseatValidation.validateBattle(cmd, { session, sender: id, game: GAME }); return;
    }
    if (cmd.type === "endTurn") { session.assertAction(id, session.snapshot().currentUnitId); return; }
    if (cmd.type === "startCombat") {
      hostOnly(id); if (state.combatStarted || GAME.ended) fail("战斗已经开始或结束");
      if (config.mode === "coop" && (heroes().length !== config.players.length || config.players.some(p => heroes().filter(u => session.ownerOf(u.id) === p.id).length !== 1))) fail("合作模式必须每人一名角色");
      return;
    }
    if (cmd.type === "retreat") { hostOnly(id); if (!state.combatStarted || state.combatPhase !== "player" || GAME.ended || !["selecting", "acting"].includes(session.snapshot().phase)) fail("现在不能撤退"); return; }
    // 联机单局（online-rogue.js）：单局的规则指令和开战 / 结算只由房主的流程执行；玩家的投票、需求、个人购买另走房主校验
    if (["run", "run.query", "run.session", "battle.setupRogue", "battle.continue", "screen"].includes(cmd.type)) { hostOnly(id); return; }
    // 玩家阵营（battle.playerFaction，PvP 第一步 #445）：只有房主（主持人）能分阵营、设敌友；布置决斗（battle.duel，#472）也只有房主
    if (["battle.panel", "battle.setup", "battle.playerFaction", "battle.duel", "trpg", "trpg.ui", "backstage", "calc"].includes(cmd.type)) {
      hostOnly(id);
      if (cmd.type === "calc" && ["move", "skill", "skillPick", "skillCancel", "standUp", "blockAnswer", "assistAnswer", "koltSwap", "startCombat", "endTurn", "blade"].includes(cmd.action)) fail("热座战斗动作必须使用当前单位的技能与询问入口");
      if (config.mode === "coop" && state.combatStarted && !GAME.ended && ["battle.panel", "battle.setup", "battle.playerFaction", "trpg", "trpg.ui", "backstage", "calc"].includes(cmd.type)) fail("合作战斗中没有主持人数据编辑权限");
      if (cmd.type === "battle.panel" && cmd.action === "loadSlot" && state.combatStarted && !GAME.ended) fail("战斗中不能读档");
      if (cmd.action === "undo" || cmd.type === "calc" && /undo|restore/i.test(cmd.action)) fail("热座不能撤销");
      return;
    }
    fail("这条指令只能由房主的规则流程执行");
  }
  function execute(cmd, id) {
    const prev = sender; sender = id; executing++;
    try {
      if (cmd.type === "startCombat") newRoundSpends = [];
      if (cmd.type === "battle.friendlyFire") cmd = Object.assign({}, cmd, { owner: id });   // 友伤开关记在发指令的人名下
      const context = cmd.type === "endTurn" ? { ...pendingContext, endUnit: c => session.finishUnit(id, c.actor) } : pendingContext || authorityContext;
      return Commands.dispatch(cmd, context);
    }
    finally { executing--; sender = prev; }
  }
  function afterCommand(cmd) {
    executing++;
    try {
      if (cmd.type === "battle.setup" || cmd.type === "battle.setupRogue" || cmd.type === "trpg.ui" && !state.combatStarted) {
        session.reset(); const assignments = {}; for (const u of heroes()) assignments[u.id] = ownerByKit[u.kit] || gm(); session.setAssignments(assignments);
      }
      session.reconcile();
    } finally { executing--; }
    setTimeout(() => { if (active() && GAME.resumeHotseat) GAME.resumeHotseat(); }, 0);
  }
  /** 主持人「加入玩家角色」（gm.addHero，#464）加进来的这一个：这张角色卡已经分配给房间里某名玩家的，照旧归他操控
   *  （ownerByKit 记着每张角色卡归谁，不在场的也留着）；没分配过的归主持人。只管这一个——战场配置「加入队员」加进来的照旧归主持人（一切照旧） */
  function adoptAddedHero(unitId) {
    const u = heroes().find(x => x.id === unitId), owner = u && ownerByKit[u.kit];
    if (!u || !owner || owner === gm() || !config.players.some(p => p.id === owner)) return;
    if (Object.hasOwn(session.snapshot().assignments || {}, u.id)) return;
    session.adopt(u.id, owner);
  }
  function submit(cmd) {
    try {
      if (!active()) fail("请先应用角色分配");
      const ack = clients.get(commandOperator || playerId).send(cmd);
      notice = ack.ok ? "" : ack.error; notify();
      if (ack.ok && orderTypes.has(cmd.type)) { GAME.disarm(); const current = session.snapshot().currentUnitId; if (current) GAME.actorId = current; refresh(); }
      return ack;
    } catch (e) { return { ok: false, error: e.message }; }
  }
  function system(cmd, context) {
    executing++;
    try { if (cmd.type === "battle.endEnemyTurn") newRoundSpends = []; const result = Commands.dispatch(cmd, context || authorityContext); if (active()) { if (cmd.type === "battle.finish") session.endBattle(); if (cmd.type === "gm.addHero" && result && result.id) adoptAddedHero(result.id); session.reconcile(); } return result; }
    finally { executing--; if (active() && !executing) authority.broadcast(); }
  }
  function reason(unit) {
    if (!active()) return "";
    if (choice) return "正在等待其他操作者选择";
    if (network && root.OnlineGame?.isPaused()) return "房主连接中断，等待恢复";
    try { session.assertAction(commandOperator || playerId, unit?.id); return ""; } catch (e) { return e.message; }
  }
  /** 不给 = 这一轮开始：所有玩家角色一起排这一轮的行动顺序（#478），我方回合接着开始；"enemy" = 敌人回合开始时、在敌人回合行动的玩家阵营先动的那一段
   *  （PvP #464，game.js · endTurn），照这一轮开始时排好的顺序接着动（这一轮从敌人回合开始的突袭开局才在这时排） */
  function beginRound(segment) {
    if (!active()) return;
    session.beginRound(state.turnNo, segment);
    // 开战 / 新回合开始时攒下的花费这一段开始时记上，以后的直接记（onActionSpend）。敌人回合那一段也一样：
    // 突袭开局先进敌人回合时还攒着，不清掉的话这一段里花的点数一直攒在这里，格子锁不上（还能挪、能转交）
    if (newRoundSpends?.length) session.markSpent(newRoundSpends);
    newRoundSpends = null;
    GAME.disarm(); refresh();
  }
  /** 敌人回合先动的那一段（#464）已经全部结束了（或者一个能动的都没有）：该跑敌人的 AI 了 */
  function segmentDone() { if (!active()) return false; const s = session.snapshot(); return s.segment === "enemy" && s.phase === "enemy"; }
  function requestAsk(kind, title, options, eligible, job) {
    return new Promise(resolve => {
      askDetails = { title, options: copy(options), eligible };
      const off = session.onAskClosed(result => { off(); askDetails = null; resolve(result); });
      const previous = restoredAsk; restoredAsk = null;
      const sameAsk = previous && previous.kind === kind && previous.jobId === (job.seq || null) && previous.targetId === (job.targetId || null);
      // 联机协助攻击：打出失衡的那名玩家决定谁出手，其他人举手（hotseat.js · answer）
      const breaker = kind === "assist" && network && job.breakerId ? state.units.find(u => u.id === job.breakerId) : null;
      const breakerKit = breaker && breaker.isPlayer ? (breaker.weaponOf || breaker.kit) : null;
      const chooser = breakerKit ? ownerByKit[breakerKit] || gm() : null;
      const reopened = session.openAsk({ kind, jobId: job.seq || null, targetId: job.targetId || null, candidates: eligible().map(u => u.id), chooser, untimed: !network,
        ...(sameAsk ? { remainingMs: previous.remainingMs } : {}) });
      if (sameAsk) {
        const waiting = new Set(previous.waiting.map(p => p.operatorId));
        for (const p of reopened.waiting) if (!waiting.has(p.operatorId) && session.snapshot().ask) session.answer(p.operatorId, reopened.id, { unitId: null });
        session.tick();
      }
      refresh();
    });
  }
  let choiceNo = 0;
  /** 选项对应战场上的哪个单位（value 是单位 id，或 { targetId }）：联机玩家端可以直接在战场上点它 */
  function choiceTarget(o) {
    const v = o && o.value, id = v && typeof v === "object" ? v.targetId : v;
    return typeof id === "string" && ((typeof state !== "undefined" && state.units) || []).some(u => u.id === id) ? id : null;
  }
  function ownedChoice(unit, title, options) {
    return new Promise(resolve => {
      // 问的单位倒地 / 不在顺序名单里时 ownerOf 是 null：交给按角色分配的人，再不行交给主持人（以前 owner 是 null，画面一算就出错，整局卡死）
      const owner = session.ownerOf(unit.id) || ownerByKit[unit.weaponOf || unit.kit] || gm();
      choice = { id: "choice-" + (++choiceNo), title, owner,
        options: options.map((o, index) => Object.assign({ helper: unit.id, label: o.label, sub: o.sub || "", extra: { index } }, choiceTarget(o) ? { target: choiceTarget(o) } : {})),
        finish: index => resolve(options[index].value),
        drop: () => resolve(null) };   // 主持人放弃了这场战斗（abandon）：等着的流程收到 null，看到战斗已经放弃就退出
      authority.broadcast(); refresh();
    });
  }
  /** 检定：按角色卡的熟练项、种族特长（party.js）和手册的成功率表（ROGUE_CHECKS）算出每个人的成功率 */
  function checkSpec(c) {
    const K = root.ROGUE_CHECKS || (typeof ROGUE_CHECKS !== "undefined" ? ROGUE_CHECKS : null);
    const diffs = ["easy", "normal", "hard", "extreme"];
    if (!K || typeof c.prof !== "string" || !diffs.includes(c.diff) || !Array.isArray(c.unitIds) || !c.unitIds.length) fail("检定需要熟练项、难度和至少一名角色");
    const prof = profName(c.prof);
    if (!PROF_LIST.includes(prof)) fail("没有这个熟练项");
    // 暗骰检定（secret）：主持人可以给任何在场单位掷（敌人、中立、NPC）；没有角色卡的按没有熟练算
    const pool = c.secret ? (state.units || []).filter(u => u && !u._removed && !u.weaponOf) : heroes();
    const targets = c.unitIds.map(id => {
      const u = pool.find(h => h.id === id); if (!u) fail("没有这名角色");
      const p = heroProfile(u.kit), level = Math.min(PROF_MAX, Number(((p && p.profs) || {})[prof] || ((p && p.profs) || {})[c.prof]) || 0);
      const hp = (u.layers || []).reduce((a, l) => a + (Number(l.current) || 0), 0), max = (u.layers || []).reduce((a, l) => a + (Number(l.max) || 0), 0);
      const perks = checkPerksFor(u.kit, prof, hp * 2 < max);
      const base = K.chance[level][diffs.indexOf(c.diff)] || 0;
      return { unitId: u.id, name: u.name, base, adv: perks.adv, dis: perks.dis, reroll: perks.reroll, level, perkText: perks.text };
    });
    return { prof, diff: c.diff, diffName: K.diffs[c.diff].name, note: typeof c.note === "string" ? c.note : "", targets, secret: !!c.secret };
  }
  /** 按钮掷骰：这名角色这项熟练的等级、种族优劣势、各档成功线（手册成功率表 × 100） */
  function rollSpec(c) {
    const K = root.ROGUE_CHECKS || (typeof ROGUE_CHECKS !== "undefined" ? ROGUE_CHECKS : null);
    const u = heroes().find(h => h.id === c.unitId); if (!u) fail("没有这名角色");
    const prof = profName(String(c.prof || ""));
    if (!PROF_LIST.includes(prof)) fail("没有这个熟练项");
    const p = heroProfile(u.kit), profs = (p && p.profs) || {};
    const level = Math.min(PROF_MAX, Number(profs[prof] || profs[c.prof]) || 0);
    const hp = (u.layers || []).reduce((a, l) => a + (Number(l.current) || 0), 0), max = (u.layers || []).reduce((a, l) => a + (Number(l.max) || 0), 0);
    const perks = checkPerksFor(u.kit, prof, hp * 2 < max);
    const row = K ? K.chance[level] : [0, 0, 0, 0];
    return { unitId: u.id, name: u.name, prof, level, adv: perks.adv, dis: perks.dis, note: typeof c.note === "string" ? c.note : "",
      lines: { easy: row[0] * 100, normal: row[1] * 100, hard: row[2] * 100, extreme: row[3] * 100 } };
  }
  /** 属性点申请：自己的角色、还有点数、这一项能加（8 级那点不能和以前加过的同一项） */
  function attrUnit(c) {
    const u = heroes().find(h => h.id === c.unitId); if (!u) fail("没有这名角色");
    if (!root.ATTR_NAMES?.[c.attr] && !(typeof ATTR_NAMES !== "undefined" && ATTR_NAMES[c.attr])) fail("没有这项属性");
    if (!(Number(u.attrPoints) > 0)) fail(u.name + " 没有可分配的属性点");
    if ((u.attrPicks || []).length >= 1 && (u.attrPicks || []).includes(c.attr)) fail("8 级的属性点不能加在曾经加过的同一项上");
    return u;
  }
  /* ---------- 赌场（#487）：联机跑团的探索环节里去赌场打 High Flux、Flux Duel（#526） ----------
   * 规则在 trpg.js · trpgCasino…（钱在 casino.js，牌局在 counter-cards.js / flux-duel.js）。每位玩家的筹码钱包按操控的角色记（LEDGER.casino.wallets[kit]），
   * 买筹码 / 卖筹码、押奎支都走这名角色的私人钱包。三种桌子：AI 坐庄、主持人坐庄（赌场桌，收入场费）、玩家对赌（不收入场费）。
   * 玩家只能动自己角色的钱包、自己坐着的那一局；主持人替主持人坐庄的那几桌出庄家那一方，也能让任何人离桌（卡住的桌子）。
   * 每一步都写进存档（rememberCampaign）；不进小队聊天——谁赢谁输、钱包剩多少只给自己看。 */
  /** 这个人能看到的赌场（trpg.js · trpgCasinoPacket；online-view.js · projectCasino 再按白名单拷）。不是联机跑团 → null */
  function casinoView(id) {
    if (typeof trpgCasinoPacket !== "function" || typeof TRPG === "undefined" || !TRPG.active || config.mode !== "trpg" || !session) return null;
    const kits = heroes().filter(u => !u.dead && session.ownerOf(u.id) === id).map(u => u.kit);
    try { return trpgCasinoPacket(kits, id === gm()); } catch (e) { return null; }
  }
  function casinoExploring() {
    if (typeof trpgCasinoPacket !== "function" || typeof TRPG === "undefined" || !TRPG.active) fail("只有联机跑团有赌场");
    if (state.combatStarted && !(root.GAME && GAME.ended)) fail("战斗中不能去赌场");
    if (typeof Screens !== "undefined" && Screens && typeof Screens.is === "function" && Screens.is("battle")) fail("先回到探索环节再去赌场");
  }
  /** 牌局里的一步：只拷规则认的字段（各玩法的 act 再查合不合法；Flux Duel 暗出要 layer + element，#526） */
  function casinoAction(a) {
    const out = {};
    if (!a || typeof a !== "object") return out;
    for (const k of ["type", "op", "where", "card", "layer", "element"]) if (typeof a[k] === "string") out[k] = a[k];
    if (a.amount != null && Number.isFinite(Number(a.amount))) out.amount = Number(a.amount);
    return out;
  }
  /** 主持人自己坐的 Flux Hold'em 多人桌座位（#526）：坐下、开局、出牌、离桌、托管后接着打——不用角色，c.table = 哪一桌 */
  function casinoGmSeat(c) {
    if (sender !== gm()) fail("只有主持人能坐赌场那一边的座位");
    const table = String(c.table || ""), G = Casino.HOLDEM_GM;
    let notes;
    try {
      switch (String(c.op || "")) {
        case "holdemGm": notes = trpgCasinoHoldemGm(table, c.seat ? String(c.seat) : null); break;
        case "holdemStart": notes = trpgCasinoHoldemStart(table, G); break;
        case "act": notes = trpgCasinoHoldemAct(table, G, casinoAction(c.action)); break;
        case "leave": notes = trpgCasinoHoldemLeave(table, G); break;
        case "holdemBack": notes = trpgCasinoHoldemBack(table, G); break;
        default: fail("没有这种赌场操作");
      }
    } catch (e) { fail(e.message); }
    if (root.GAME && GAME.rememberCampaign) GAME.rememberCampaign();
    return { notes };
  }
  function casinoCommand(c) {
    casinoExploring();
    if (c.asGm) return casinoGmSeat(c);
    const kit = String(c.kit || ""), u = heroes().find(h => h.kit === kit && !h.dead), isGM = sender === gm();
    // 坐着的角色死了 / 离队了：主持人照样能让他离桌（不然那一桌一直卡着）
    if (!u && !(isGM && c.op === "leave")) fail("没有这名角色");
    const mine = !!u && session.ownerOf(u.id) === sender;
    const own = () => { if (!mine) fail("只能用自己角色的钱包"); };
    const op = String(c.op || "");
    let notes;
    try {
      switch (op) {
        case "open": own(); notes = trpgCasinoOpen(kit); break;
        case "buy": own(); notes = trpgCasinoBuy(c.n, kit, kit); break;
        case "sell": own(); notes = trpgCasinoSell(c.n, kit, kit); break;
        case "sit": own(); notes = trpgCasinoSitAt(kit, String(c.table || ""), c.buyIn, { dealer: c.dealer === "gm" ? "gm" : "ai" }); break;
        // 对赌：High Flux 坐庄家 / 玩家；Flux Duel（mode "duel"，#526）坐甲 / 乙（第 1 轮甲先手）
        case "pvpOpen": {
          own();
          const duel = c.mode === "duel";
          const side = duel ? (c.side === "b" ? "b" : "a") : (c.side === "dealer" ? "dealer" : "player");
          notes = trpgCasinoPvpOpen(kit, side, String(c.stakeKind || ""), { mode: duel ? "duel" : "highflux" });
          break;
        }
        case "pvpJoin": own(); notes = trpgCasinoPvpJoin(kit, String(c.table || "")); break;
        // Flux Hold'em 多人桌（#526）：开桌（定买入、几人桌）、坐空座位、开桌的人开局、托管后接着打
        case "holdemOpen": own(); notes = trpgCasinoHoldemOpen(kit, String(c.table || ""), c.buyIn, c.size); break;
        case "holdemJoin": own(); notes = trpgCasinoHoldemJoin(kit, String(c.table || ""), c.seat ? String(c.seat) : null); break;
        case "holdemStart": own(); notes = trpgCasinoHoldemStart(String(c.table || ""), kit); break;
        case "holdemBack": own(); notes = trpgCasinoHoldemBack(String(c.table || ""), kit); break;
        case "act":
          if (c.asDealer) { if (!isGM) fail("只有主持人能替主持人坐庄的那一桌出牌"); }
          else own();
          notes = trpgCasinoAct(kit, casinoAction(c.action), { asDealer: !!c.asDealer });
          break;
        case "leave": if (!mine && !isGM) fail("只能让自己的角色离桌"); notes = trpgCasinoLeave(kit); break;
        default: fail("没有这种赌场操作");
      }
    } catch (e) { fail(e.message); }
    if (root.GAME && GAME.rememberCampaign) GAME.rememberCampaign();
    return { notes };
  }
  /** 跑团工匠 / 工坊的消息：必须是跑团模式；玩家只能用自己操控的角色（主持人哪个都行），返回角色 kit */
  function trpgOwnKit(rawKit, deny) {
    if (typeof TRPG === "undefined" || !TRPG.active || typeof trpgSmithUpgrade !== "function") fail("只有跑团模式有工匠和工坊");
    const kit = String(rawKit || "");
    const own = heroes().find(u => u.kit === kit);
    if (!own || (sender !== gm() && session.ownerOf(own.id) !== sender)) fail(deny);
    return kit;
  }
  const orderHandlers = {
    orderPick: c => session.pick(sender, c.actor, c.index), orderConfirm: () => session.confirm(sender),
    orderStart: () => session.forceStart(sender), orderMove: c => session.move(sender, c.actor, c.index),
    orderSwapAccept: c => session.acceptSwap(sender, c.requestId, c.accept), chat: c => session.chat(sender, c.text),
    checkOpen: c => session.openCheck(sender, checkSpec(c)),
    checkRoll: c => session.rollCheck(sender, c.checkId, c.unitId),
    checkClose: c => session.closeCheck(sender, c.checkId),
    attrRequest: c => { const u = attrUnit(c); return session.requestAttr(sender, u.id, c.attr, u.name); },
    attrDecide: c => session.decideAttr(sender, c.requestId, c.decision),
    // 主动发起检定：玩家提（checkRequest），主持人定难度同意（checkDecide）后房主掷骰
    checkRequest: c => { const u = heroes().find(h => h.id === c.unitId); if (!u) fail("没有这名角色"); const prof = profName(String(c.prof || "")); if (!PROF_LIST.includes(prof)) fail("没有这个熟练项"); return session.requestCheck(sender, u.id, prof, typeof c.note === "string" ? c.note : "", u.name); },
    checkDecide: c => {
      if (c.decision !== "approve") return session.decideCheck(sender, c.requestId, c.decision);
      const req = (session.snapshot().table.checkReqs || []).find(r => r.id === c.requestId); if (!req) fail("没有这条检定申请");
      return session.decideCheck(sender, c.requestId, "approve", checkSpec({ prof: req.prof, diff: c.diff, unitIds: [req.unitId], note: req.note }));
    },
    skillRoll: c => session.skillRoll(sender, rollSpec(c), !!c.secret),
    showTitle: c => session.showTitle(sender, c),
    // 决斗（#472）：只在探索环节；选队只能选自己操控的角色（没分配给玩家的归主持人）
    duelRequest: () => { duelExploring(); return session.requestDuel(sender); },
    duelDecide: c => { duelExploring(); if (!["approve", "reject", "cancel"].includes(c.decision)) fail("没有这种处理"); return session.decideDuel(sender, c.decision); },
    duelOpen: () => { duelExploring(); return session.openDuel(sender); },
    // 每队的人数只数现在还能参加的角色（duelHeroes）：选了队以后死亡 / 被移出队伍的不占名额（#490）
    duelPick: c => { duelExploring(); const u = duelHero(c.kit); return session.pickDuel(sender, u.kit, c.team == null ? null : String(c.team), ownerByKit[u.kit] || gm(), duelHeroes().map(x => x.kit)); },
    duelOptions: c => { duelExploring(); const opt = {}; if ("stand" in c) opt.stand = c.stand; if ("rounds" in c) opt.rounds = c.rounds; return session.setDuelOptions(sender, opt); },
    // 跑团私人钱包（trpg.js）：玩家只能从自己角色的钱包转出；主持人哪个钱包都能动。转完写进小队频道，大家看得到
    // 跑团商人（trpg-merchants.js）：只能在主持人开着的那家店买；钱从自己角色的钱包出（主持人可以替任何人付）
    shopBuy: c => {
      if (typeof trpgMerchantBuy !== "function" || typeof TRPG === "undefined" || !TRPG.active) fail("只有跑团模式有商人");
      const open = trpgMerchantOpenNow();
      if (!open || open.id !== c.merchant) fail("这家店已经关门了");
      const payer = String(c.payer || "");
      if (sender !== gm()) {
        const own = heroes().find(u => u.kit === payer);
        if (!own || session.ownerOf(own.id) !== sender) fail("只能用自己角色的钱包付钱");
      }
      const notes = trpgMerchantBuy(open.id, c.key, c.qty, payer || null);
      if (!trpgMerchantOk(notes)) fail(notes[0] || "买不了");
      if (root.GAME && GAME.rememberCampaign) GAME.rememberCampaign();
      teamChat(sender, "🛒 " + notes.join(" "));
      return { notes };
    },
    // 跑团诊所（trpg.js · trpgCyberRequest）：玩家只能给自己操控的角色申请义体改造，主持人在「诊所」页同意后才生效
    cyberRequest: c => {
      if (typeof trpgCyberRequest !== "function" || typeof TRPG === "undefined" || !TRPG.active) fail("只有跑团模式有诊所");
      const kit = String(c.kit || "");
      const own = heroes().find(u => u.kit === kit);
      if (!own || (sender !== gm() && session.ownerOf(own.id) !== sender)) fail("只能给自己的角色申请改造");
      const name = (config.players.find(p => p.id === sender) || {}).name || "";
      const out = trpgCyberRequest(kit, c.plan, sender, name);
      if (out.error) fail(out.error);
      session.chat(sender, `🦾 申请给 ${own.name} 做义体改造（${out.request.cost} 奎支），等主持人同意`);
      return { request: out.request.id };
    },
    // 跑团诊所 · 义体（trpg.js · trpgCyberwareInstall / Remove）：只能给自己操控的角色装 / 拆，钱从这名角色的钱包出；主持人哪个都能动
    cyberwareInstall: c => {
      if (typeof trpgCyberwareInstall !== "function" || typeof TRPG === "undefined" || !TRPG.active) fail("只有跑团模式有诊所");
      const kit = String(c.kit || ""), id = String(c.id || "");
      const own = heroes().find(u => u.kit === kit);
      if (!own || (sender !== gm() && session.ownerOf(own.id) !== sender)) fail("只能给自己的角色装、拆义体");
      let notes;
      try { notes = false ? trpgCyberwareRemove(kit, id) : trpgCyberwareInstall(kit, id); } catch (e) { fail(e.message); }
      if (root.GAME && GAME.rememberCampaign) GAME.rememberCampaign();
      teamChat(sender, "🦾 " + notes.join(" "));
      return { notes };
    },
    cyberwareRemove: c => {
      if (typeof trpgCyberwareInstall !== "function" || typeof TRPG === "undefined" || !TRPG.active) fail("只有跑团模式有诊所");
      const kit = String(c.kit || ""), id = String(c.id || "");
      const own = heroes().find(u => u.kit === kit);
      if (!own || (sender !== gm() && session.ownerOf(own.id) !== sender)) fail("只能给自己的角色装、拆义体");
      let notes;
      try { notes = true ? trpgCyberwareRemove(kit, id) : trpgCyberwareInstall(kit, id); } catch (e) { fail(e.message); }
      if (root.GAME && GAME.rememberCampaign) GAME.rememberCampaign();
      teamChat(sender, "🦾 " + notes.join(" "));
      return { notes };
    },
    // 跑团工匠 / 工坊（trpg.js · trpgSmithUpgrade / trpgWorkshopCraft / trpgWorkshopSalvage）：主持人开了才能用；只能动自己操控的角色，加工费从这名角色的钱包出；主持人哪个都能动
    smithUpgrade: c => {
      const kit = trpgOwnKit(c.kit, "只能给自己的角色升级武器");
      let notes;
      try { notes = trpgSmithUpgrade(kit, String(c.weapon || ""), String(c.mode || "")); } catch (e) { fail(e.message); }
      if (root.GAME && GAME.rememberCampaign) GAME.rememberCampaign();
      teamChat(sender, "🔨 " + notes.join(" "));
      return { notes };
    },
    workshopCraft: c => {
      const kit = trpgOwnKit(c.kit, "只能让自己的角色制作");
      let notes;
      try { notes = trpgWorkshopCraft(kit, String(c.item || ""), c.helper ? String(c.helper) : null); } catch (e) { fail(e.message); }
      if (root.GAME && GAME.rememberCampaign) GAME.rememberCampaign();
      teamChat(sender, "⚙ " + notes.join(" "));
      return { notes };
    },
    workshopSalvage: c => {
      const kit = trpgOwnKit(c.kit, "只能让自己的角色拆解");
      let notes;
      try { notes = trpgWorkshopSalvage(kit, String(c.item || "")); } catch (e) { fail(e.message); }
      if (root.GAME && GAME.rememberCampaign) GAME.rememberCampaign();
      teamChat(sender, "⚙ " + notes.join(" "));
      return { notes };
    },
    // 跑团卖东西 / 回购（shop-sell.js）：要有开着的店；玩家只能以自己操控的角色卖（钱进队伍公账）、回购（从自己钱包付）；主持人哪个都能
    shopSell: c => {
      if (typeof trpgShopSell !== "function" || typeof TRPG === "undefined" || !TRPG.active) fail("只有跑团模式有商人");
      const kit = String(c.kit || "");
      if (sender !== gm()) { const own = heroes().find(u => u.kit === kit); if (!own || session.ownerOf(own.id) !== sender) fail("只能以自己的角色卖东西"); }
      let out;
      try { out = trpgShopSell(kit || null, String(c.id || ""), c.qty, c.owner); } catch (e) { fail(e.message); }
      if (root.GAME && GAME.rememberCampaign) GAME.rememberCampaign();
      teamChat(sender, "💰 " + out.msg);
      return out;
    },
    shopBuyback: c => {
      if (typeof trpgShopBuyback !== "function" || typeof TRPG === "undefined" || !TRPG.active) fail("只有跑团模式有商人");
      const kit = String(c.kit || "");
      if (sender !== gm()) { const own = heroes().find(u => u.kit === kit); if (!own || session.ownerOf(own.id) !== sender) fail("只能用自己角色的钱包回购"); }
      let out;
      try { out = trpgShopBuyback(kit || null, String(c.token || "")); } catch (e) { fail(e.message); }
      if (root.GAME && GAME.rememberCampaign) GAME.rememberCampaign();
      teamChat(sender, "💰 " + out.msg);
      return out;
    },
    shopRedeem: c => {
      if (typeof trpgMerchantRedeem !== "function" || typeof TRPG === "undefined" || !TRPG.active) fail("只有跑团模式有商人");
      const open = trpgMerchantOpenNow();
      if (!open || open.id !== c.merchant) fail("这家店已经关门了");
      const notes = trpgMerchantRedeem(open.id, c.item);
      if (!trpgMerchantOk(notes)) fail(notes[0] || "换不了");
      if (root.GAME && GAME.rememberCampaign) GAME.rememberCampaign();
      teamChat(sender, "🎟 " + notes.join(" "));
      return { notes };
    },
    purseTransfer: c => {
      if (typeof trpgPurseTransfer !== "function" || typeof TRPG === "undefined" || !TRPG.active) fail("只有跑团模式有私人钱包");
      const from = String(c.from || ""), to = String(c.to || "");
      if (sender !== gm()) {
        const own = heroes().find(u => u.kit === from);
        if (!own || session.ownerOf(own.id) !== sender) fail("只能从自己角色的钱包转钱");
      }
      const notes = trpgPurseTransfer(from, to, c.amount);
      if (!/^.+ 转给 /.test(notes[0] || "")) fail(notes[0] || "转不了");
      if (root.GAME && GAME.rememberCampaign) GAME.rememberCampaign();
      teamChat(sender, "💰 " + notes[0]);
      return { notes };
    },
    // 赌场（#487）：兑换、坐桌、对赌、出牌、离桌都是这一种指令（op），权限和探索环节在 casinoCommand 里查
    casino: c => casinoCommand(c),
    answer: c => { if (choice) { const old = choice; choice = null; old.finish(c.extra.index); return { accepted: true }; } return session.answer(sender, c.askId, { unitId: c.helper || null, extra: c.extra || {} }); }
  };
  for (const [type, fn] of Object.entries(orderHandlers)) {
    const run = c => { if (!executing || !active()) fail("顺序指令需要热座权威会话"); return fn(c); };
    if (["orderMove", "orderSwapAccept"].includes(type)) Commands.activate(type, "D2", run, { domain: "hotseat" });
    else Commands.register(type, run, { domain: "hotseat" });
  }
  Commands.intercept((cmd, context, next) => {
    if (GAME.sim || executing) {
      return next();
    }
    if (!active()) { const result = next(); if (enabled) notify(); return result; }
    if (automatic.has(cmd.type) || cmd.type === "battle.panel" && /^normalize/.test(cmd.action)) return system(cmd, context);
    const prev = pendingContext; pendingContext = context;
    try { const ack = submit(cmd); if (!ack.ok) { const error = new Error(ack.error); error.code = "HOTSEAT_REJECT"; throw error; } return ack.result; }
    finally { pendingContext = prev; }
  });
  onActionSpend(event => { if (active() && executing && !GAME.sim) { if (newRoundSpends) newRoundSpends.push(event); else session.markSpent([event]); } });
  // 友伤开关（enemies.js · setFriendlyFireOwner，#428）：热座 / 联机时每个单位归谁操控——每人的开关只管自己的单位（武器人跟着持有者；
  // 倒地、不在行动顺序名单里的按角色分配，再不行归房主，和 ownedChoice 一样）。没开热座（本机一个人、单人模式）返回 null：规则层按本机那一个开关
  if (typeof setFriendlyFireOwner === "function") setFriendlyFireOwner(u => (active() && session ? session.ownerOf(u.id) || ownerByKit[u.weaponOf || u.kit] || gm() : null));
  setInterval(() => { if (active() && !(network && root.OnlineGame?.isPaused())) session.tick(); }, 250);
  // Legacy panel handlers were written before the command boundary. Surface an
  // expected authorization rejection in the hotseat bar; unrelated errors keep
  // their normal browser diagnostics and remain visible to UI regression tests.
  if (root.addEventListener) root.addEventListener("error", event => {
    if (active() && event.error?.code === "HOTSEAT_REJECT") { notice = event.error.message; notify(); event.preventDefault(); }
  });
  root.HotseatGame = { getView, getViewFor, syncAssignments, assignments: () => (active() && session ? copy(session.snapshot().assignments || {}) : {}), configure, submit, isActive: active, isRequested: () => enabled && !state.solo, checkSpec, rollSpec,
    enableOnline(value) { network = true; enabled = true; if (!configured) playerId = value.players.find(p => p.gm).id; return configure(value); },
    isNetwork: () => network,
    receiveFrom(id, cmd) { return this.withOperator(id, () => submit(cmd)); },
    withOperator(id, fn) { if (!clients.has(id)) fail("没有这个操作者"); const prev = commandOperator; commandOperator = id; try { return fn(); } finally { commandOperator = prev; } },
    assertActionFrom(id, actor) { return session.assertAction(id, actor); },
    extendAsk(ms) { session?.extendAsk(ms); },
    validateFrom(id, cmd) { return validate(cmd, id); },
    /** 主持人接管某名玩家的角色（玩家掉线时，战斗中也能用）；之后由主持人在本机替他行动 */
    takeOver(id) {
      if (!active()) fail("热座尚未配置");
      if (id === gm() || !config.players.some(p => p.id === id)) fail("没有这名玩家");
      session.takeOver(gm(), id);
      for (const kit of Object.keys(ownerByKit)) if (ownerByKit[kit] === id) ownerByKit[kit] = gm();
      if (config.assignments) for (const u of Object.keys(config.assignments)) if (config.assignments[u] === id) delete config.assignments[u];
      if (choice && choice.owner === id) choice.owner = gm();
      authority.broadcast(); refresh();
      return { ok: true };
    },
    /** 战斗中能不能转交角色：{ ok, reason }（按钮灰掉时把 reason 写在旁边） */
    transferState() {
      if (!active()) return { ok: false, reason: "热座尚未配置" };
      if (choice) return { ok: false, reason: "有分步选择在等人回答，回答完才能转交" };
      return session.transferState();
    },
    /** 主持人把英雄（连同武器人）转交给另一名操作者；toId 为主持人 = 收回。联机一名玩家可以操控几名角色（#165 的限制已取消） */
    transferHero(heroId, toId) {
      const gate = this.transferState();
      if (!gate.ok) fail(gate.reason);
      const hero = heroes().find(u => u.id === heroId);
      if (!hero) fail("只能转交英雄角色");
      if (!config.players.some(p => p.id === toId)) fail("没有这名玩家");
      session.transfer(gm(), heroId, toId);
      ownerByKit[hero.kit] = toId;
      if (config.assignments) { if (toId === gm()) delete config.assignments[heroId]; else config.assignments[heroId] = toId; }
      authority.broadcast(); refresh();
      return { ok: true, heroName: hero.name, toName: config.players.find(p => p.id === toId).name };
    },
    /** 主持人放弃这场战斗、回到探索（game.js · abandonBattle，#322）：收回等人回答的协助询问、分步选择——
     *  等着的流程收到「没人回答」，看到战斗已经放弃就直接退出；行动顺序回到战前（交回探索后 afterCommand 再按角色对齐分配） */
    abandon() {
      if (!active()) return false;
      const pending = choice;
      choice = null; restoredAsk = null; newRoundSpends = null;
      executing++;
      try { session.reset(); } finally { executing--; }
      if (pending) pending.drop();
      authority.broadcast(); refresh();
      return true;
    },
    checkpoint(now = Date.now()) { if (!active()) return null; const snapshot = session.checkpoint(); return copy({ config, ownerByKit, playerId, session: snapshot,
      askRemainingMs: snapshot.ask && snapshot.ask.deadline != null ? Math.max(0, snapshot.ask.deadline - now) : null, newRoundSpends, choiceNo, openingChoice: !!choice && !state.combatStarted }); },
    restoreOnline(saved) { network = enabled = true; configured = false; config = copy(saved.config); ownerByKit = copy(saved.ownerByKit); playerId = saved.playerId; newRoundSpends = saved.newRoundSpends || null; choiceNo = saved.choiceNo || 0;
      restoredAsk = saved.session?.ask ? { ...copy(saved.session.ask), remainingMs: saved.askRemainingMs ?? 20000 } : null;
      setupSession(); configured = true; executing++; try { session.restore(restorable(saved.session)); } finally { executing--; } authority.broadcast(); refresh(); },
    onPacket(fn) { packetListeners.add(fn); return () => packetListeners.delete(fn); },
    reason, beginRound, segmentDone, system, requestAsk, ownedChoice,
    /** 决斗（#472）：主持人点「开始决斗」时要布置的两队（角色 kit）和选项；布好以后 duelStarted 收起准备画面、频道里写一句 */
    duelSpec,
    duelStarted(text) { if (active()) { executing++; try { session.closeDuel(gm(), text); } finally { executing--; } } },
    isHost: () => !active() || playerId === gm(), hasAsk: () => !!choice || !!session?.snapshot().ask,
    currentUnit: () => active() ? session.snapshot().currentUnitId : null,
    /** 我方回合的行动顺序都结束了（敌人回合先动的那一段结束看 segmentDone） */
    needsEnemy: () => { if (!active()) return false; const s = session.snapshot(); return s.phase === "enemy" && !s.currentUnitId && s.segment !== "enemy"; },
    /** 现在排的是哪一段：我方回合 "player" / 敌人回合先动的玩家阵营 "enemy"（#464） */
    segment: () => active() ? session.snapshot().segment || "player" : "player",
    canStart: () => !enabled || !!state.solo || active() && playerId === gm() && !choice && !session.snapshot().ask,
    startCombat() { const ack = clients.get(gm()).send({ type: "startCombat" }); if (!ack.ok) throw new Error(ack.error); return ack.result; },
    switchPlayer(id) { if (!config.players.some(p => p.id === id)) return { ok: false, error: "没有这个操作者" }; playerId = id; GAME.disarm(); refresh(); return { ok: true }; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    disable() { if (!canConfigure() || configured && playerId !== gm()) return { ok: false, error: "本场战斗结束后由房主退出热座" }; enabled = false; if (authority) authority.close(); refresh(); return { ok: true }; }
  };
})(window);
