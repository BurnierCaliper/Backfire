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
  const tableTypes = new Set(["checkOpen", "checkRoll", "checkClose", "attrRequest", "attrDecide", "skillRoll", "showTitle", "purseTransfer", "shopBuy", "shopRedeem", "cyberRequest", "cyberwareInstall", "cyberwareRemove"]);
  const orderTypes = new Set(["orderPick", "orderConfirm", "orderStart", "orderMove", "orderSwapAccept", "answer", "chat", ...tableTypes]);
  const copy = value => JSON.parse(JSON.stringify(value));
  const active = () => !!(enabled && configured && session && authority && !state.solo);
  const heroes = () => (state.units || []).filter(u => u.isPlayer && !u.weaponOf && !u.isPartner && livePartyCards().some(c => c.kit === u.kit && !c.weaponOf));
  const gm = () => (config.players.find(p => p.gm) || config.players[0]).id;
  const fail = text => { throw new Error(text); };
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
      getUnits: () => state.units, canStand: u => !standUpBlocked(u) });
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
      if (network && (value.mode !== "trpg" || value.players.filter(p => p.gm).length !== 1 || value.players.some(p => !p.gm && list.filter(u => assignments[u.id] === p.id).length > 1))) fail("每名在线玩家最多操控一名角色，未分配角色由主持人操作");
      if (value.mode === "coop" && (list.length !== ids.length || ids.some(id => list.filter(u => assignments[u.id] === id).length !== 1))) fail("合作模式需要每名操作者恰好一名角色，请先调整队伍");
      config = copy(value); ownerByKit = {}; for (const u of list) ownerByKit[u.kit] = assignments[u.id] || gm();
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
      phase: s?.phase === "selecting" ? "picking" : s?.phase || "setup", currentUnitId: s?.currentUnitId || null,
      order: (s?.slots || []).map(r => r && ({ actor: r.unitId, name: r.unitName, owner: r.operatorId, locked: r.spent, done: r.completed, current: r.unitId === s.currentUnitId })),
      confirmed: s?.confirmed || [], swap: s?.pendingSwaps?.length ? { requestId: s.pendingSwaps[0].id, from: s.pendingSwaps[0].actor, to: s.pendingSwaps[0].target, recipient: s.pendingSwaps[0].responder } : null,
      ask: s?.ask || null, chat: (s?.chat || []).map(r => ({ id: r.id, operatorId: r.operatorId, name: r.operatorName, text: r.text, at: r.at, roll: r.roll ? (typeof r.roll === "object" ? { tier: r.roll.tier || null } : true) : false, tier: r.roll && r.roll.tier || null, secret: !!r.secret, title: !!r.title })),
      title: s?.table?.title ? copy(s.table.title) : null, checks: copy(s?.table?.checks || []), attrRequests: copy(s?.table?.attrs || []),
      // 跑团地图：主持人在地图上标的队伍位置（玩家只能看，不能改）
      map: typeof LEDGER !== "undefined" && LEDGER ? { place: LEDGER.place || null, x: LEDGER.placePos ? LEDGER.placePos.x : null, y: LEDGER.placePos ? LEDGER.placePos.y : null } : null,
      canConfigure: !network && canConfigure() && (!configured || id === gm()), canDisable: !network && canConfigure() && (!configured || id === gm()) };
  }
  const getView = () => getViewFor(playerId);
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
    if (choice || session.snapshot().ask) fail("正在等待其他操作者回应");
    if (orderTypes.has(cmd.type)) { if (cmd.type === "orderSwapAccept" && typeof cmd.accept !== "boolean") fail("互换回答必须为同意或拒绝"); return; }
    if (actionTypes.has(cmd.type)) {
      if (GAME.depth > 0 && !GAME.tape) fail("正在播放行动，请稍候");
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
    if (["battle.panel", "battle.setup", "trpg", "trpg.ui", "backstage", "calc"].includes(cmd.type)) {
      hostOnly(id);
      if (cmd.type === "calc" && ["move", "skill", "skillPick", "skillCancel", "standUp", "blockAnswer", "assistAnswer", "koltSwap", "startCombat", "endTurn", "blade"].includes(cmd.action)) fail("热座战斗动作必须使用当前单位的技能与询问入口");
      if (config.mode === "coop" && state.combatStarted && !GAME.ended && ["battle.panel", "battle.setup", "trpg", "trpg.ui", "backstage", "calc"].includes(cmd.type)) fail("合作战斗中没有主持人数据编辑权限");
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
    try { if (cmd.type === "battle.endEnemyTurn") newRoundSpends = []; const result = Commands.dispatch(cmd, context || authorityContext); if (active()) { if (cmd.type === "battle.finish") session.endBattle(); session.reconcile(); } return result; }
    finally { executing--; if (active() && !executing) authority.broadcast(); }
  }
  function reason(unit) {
    if (!active()) return "";
    if (choice) return "正在等待其他操作者选择";
    if (network && root.OnlineGame?.isPaused()) return "房主连接中断，等待恢复";
    try { session.assertAction(commandOperator || playerId, unit?.id); return ""; } catch (e) { return e.message; }
  }
  function beginRound() { if (!active()) return; session.beginRound(state.turnNo); if (newRoundSpends?.length) session.markSpent(newRoundSpends); newRoundSpends = null; GAME.disarm(); refresh(); }
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
      const reopened = session.openAsk({ kind, jobId: job.seq || null, targetId: job.targetId || null, candidates: eligible().map(u => u.id), chooser,
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
        finish: index => resolve(options[index].value) };
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
    const targets = c.unitIds.map(id => {
      const u = heroes().find(h => h.id === id); if (!u) fail("没有这名角色");
      const p = heroProfile(u.kit), level = Math.min(PROF_MAX, Number(((p && p.profs) || {})[prof] || ((p && p.profs) || {})[c.prof]) || 0);
      const hp = (u.layers || []).reduce((a, l) => a + (Number(l.current) || 0), 0), max = (u.layers || []).reduce((a, l) => a + (Number(l.max) || 0), 0);
      const perks = checkPerksFor(u.kit, prof, hp * 2 < max);
      const base = K.chance[level][diffs.indexOf(c.diff)] || 0;
      return { unitId: u.id, name: u.name, base, adv: perks.adv, dis: perks.dis, reroll: perks.reroll, level, perkText: perks.text };
    });
    return { prof, diff: c.diff, diffName: K.diffs[c.diff].name, note: typeof c.note === "string" ? c.note : "", targets };
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
  const orderHandlers = {
    orderPick: c => session.pick(sender, c.actor, c.index), orderConfirm: () => session.confirm(sender),
    orderStart: () => session.forceStart(sender), orderMove: c => session.move(sender, c.actor, c.index),
    orderSwapAccept: c => session.acceptSwap(sender, c.requestId, c.accept), chat: c => session.chat(sender, c.text),
    checkOpen: c => session.openCheck(sender, checkSpec(c)),
    checkRoll: c => session.rollCheck(sender, c.checkId, c.unitId),
    checkClose: c => session.closeCheck(sender, c.checkId),
    attrRequest: c => { const u = attrUnit(c); return session.requestAttr(sender, u.id, c.attr, u.name); },
    attrDecide: c => session.decideAttr(sender, c.requestId, c.decision),
    skillRoll: c => session.skillRoll(sender, rollSpec(c), !!c.secret),
    showTitle: c => session.showTitle(sender, c),
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
      session.chat(sender, "🛒 " + notes.join(" "));
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
      session.chat(sender, "🦾 " + notes.join(" "));
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
      session.chat(sender, "🦾 " + notes.join(" "));
      return { notes };
    },
    shopRedeem: c => {
      if (typeof trpgMerchantRedeem !== "function" || typeof TRPG === "undefined" || !TRPG.active) fail("只有跑团模式有商人");
      const open = trpgMerchantOpenNow();
      if (!open || open.id !== c.merchant) fail("这家店已经关门了");
      const notes = trpgMerchantRedeem(open.id, c.item);
      if (!trpgMerchantOk(notes)) fail(notes[0] || "换不了");
      if (root.GAME && GAME.rememberCampaign) GAME.rememberCampaign();
      session.chat(sender, "🎟 " + notes.join(" "));
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
      session.chat(sender, "💰 " + notes[0]);
      return { notes };
    },
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
    checkpoint(now = Date.now()) { if (!active()) return null; const snapshot = session.checkpoint(); return copy({ config, ownerByKit, playerId, session: snapshot,
      askRemainingMs: snapshot.ask ? Math.max(0, snapshot.ask.deadline - now) : null, newRoundSpends, choiceNo, openingChoice: !!choice && !state.combatStarted }); },
    restoreOnline(saved) { network = enabled = true; configured = false; config = copy(saved.config); ownerByKit = copy(saved.ownerByKit); playerId = saved.playerId; newRoundSpends = saved.newRoundSpends || null; choiceNo = saved.choiceNo || 0;
      restoredAsk = saved.session?.ask ? { ...copy(saved.session.ask), remainingMs: saved.askRemainingMs ?? 20000 } : null;
      setupSession(); configured = true; executing++; try { session.restore(restorable(saved.session)); } finally { executing--; } authority.broadcast(); refresh(); },
    onPacket(fn) { packetListeners.add(fn); return () => packetListeners.delete(fn); },
    reason, beginRound, system, requestAsk, ownedChoice,
    isHost: () => !active() || playerId === gm(), hasAsk: () => !!choice || !!session?.snapshot().ask,
    currentUnit: () => active() ? session.snapshot().currentUnitId : null,
    needsEnemy: () => active() && session.snapshot().phase === "enemy" && !session.snapshot().currentUnitId,
    canStart: () => !enabled || !!state.solo || active() && playerId === gm() && !choice && !session.snapshot().ask,
    startCombat() { const ack = clients.get(gm()).send({ type: "startCombat" }); if (!ack.ok) throw new Error(ack.error); return ack.result; },
    switchPlayer(id) { if (!config.players.some(p => p.id === id)) return { ok: false, error: "没有这个操作者" }; playerId = id; GAME.disarm(); refresh(); return { ok: true }; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    disable() { if (!canConfigure() || configured && playerId !== gm()) return { ok: false, error: "本场战斗结束后由房主退出热座" }; enabled = false; if (authority) authority.close(); refresh(); return { ok: true }; }
  };
})(window);
