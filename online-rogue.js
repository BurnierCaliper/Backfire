/* 联机单局（Roguelike）：规则只在房主一端跑（rogue.js / rogue-ui.js），这里管联机才有的几件事。
 *
 *   · 队伍一起决定：任务板接哪个任务、路线走哪一站、迎战 / 休息 / 离开 / 检定谁去……
 *     每个在线的人投一票（房主也是一票）。人齐了按多数决定，平票在最多票的里面随机；房主可以「按现在的票数决定」。
 *     有人还没选完升级时先不结算（升级会影响接下来的战斗）。
 *   · 钱各算各的：每名角色一个钱包。任务报酬、敌人掉的奎支、检定奖励……进账一律平分给还活着的角色
 *     （分不尽的零头从队伍靠前的角色起每人多 1）。买东西、升级武器、治疗……都从做这件事的角色的钱包里扣。
 *   · 东西也各归各的：改装件和战斗道具记在买下 / 分到它的角色名下，别人不能用；
 *     水、食物、维修工具包、睡袋这些补给是队伍公用的。死去角色的钱平分给其他人，东西变成公用。
 *   · 战斗或任务拿到改装件、道具时按「需求」分配：每名角色选「需求」或「放弃」，在需求的角色里抽一个拿走；
 *     没人需求就在所有活着的角色里随机给。离线玩家的角色不用等，房主可以「现在分配」。
 *
 * 状态都记在 run.online 里，跟着单局一起存档。角色 = 队伍里的英雄 kit，归属 owners[kit] = 玩家 id（没分配的归房主）。
 */
(function (root) {
  "use strict";
  // rogue.js / items.js / screens.js 的这些是顶层 const，不在 window 上：按名字取
  const G_Commands = typeof Commands !== "undefined" ? Commands : null;
  const G_ITEM_CATALOG = typeof ITEM_CATALOG !== "undefined" ? ITEM_CATALOG : {};
  const G_ROGUE_NODE_TYPES = typeof ROGUE_NODE_TYPES !== "undefined" ? ROGUE_NODE_TYPES : {};
  const G_Rogue = typeof Rogue !== "undefined" ? Rogue : null;
  const G_SaveStore = typeof SaveStore !== "undefined" ? SaveStore : null;
  const G_Screens = typeof Screens !== "undefined" ? Screens : null;
  const copy = v => JSON.parse(JSON.stringify(v));
  const fail = text => { throw new Error(text); };
  // 个人行为：花自己的钱、动自己的东西（choose 是升级选择，不花钱）
  const PERSONAL = ["buy", "redeem", "learnRecipe", "salvage", "setCraftJob", "buyPart", "sellPart", "installPart", "removePart", "upgradeWeapon", "repairWeapon", "healHero", "modifyHero"];
  // 玩家可以自己发的个人指令（其余的个人行为由房主代自己的角色做）
  const REMOTE = ["buy", "redeem", "learnRecipe", "salvage", "setCraftJob", "buyPart", "sellPart", "installPart", "removePart", "upgradeWeapon", "repairWeapon", "healHero", "modifyHero", "choose"];
  let enabled = false, resolving = false, hostId = "";

  const flow = () => root.RunFlow || null;
  const run = () => (flow() && flow().current ? flow().current() : null);
  const game = () => root.OnlineGame || null;
  function active() { const g = game(); return enabled && !!run() && !!g && g.isHost(); }
  function data(r) {
    r = r || run();
    if (!r.online) r.online = {};
    const d = r.online;
    for (const [k, v] of Object.entries({ owners: {}, purse: {}, owned: {}, loot: [], lootNo: 0, lootLog: [], ballots: {}, voteKey: "", lastVote: null })) if (d[k] == null) d[k] = copy(v);
    return d;
  }
  const name = kit => (G_Rogue ? Rogue.heroName(kit) : kit);
  const itemName = id => ((G_ITEM_CATALOG || {})[id] || {}).name || id;
  const living = r => (r.party || []).map(h => h.kit);
  function heroOf(r, kit) { return (r.party || []).find(h => h.kit === kit || (h.weapons || []).includes(kit)) || null; }
  function ownerOf(r, heroKit) { const o = data(r).owners[heroKit]; return o && rosterIds().includes(o) ? o : hostId; }
  const roster = () => { const g = game(); return g && g.players ? g.players() : []; };
  function rosterIds() { return roster().map(p => p.id); }
  function onlineIds() { return roster().filter(p => p.online).map(p => p.id); }
  function playerName(id) { return roster().find(p => p.id === id)?.name || "房主"; }
  const kitsOf = (r, playerId) => living(r).filter(k => ownerOf(r, k) === playerId);
  // 补给（水、食物、维修工具包、睡袋……）队伍公用；其余（战斗道具、改装件）归个人
  const ownable = id => { const s = (G_ITEM_CATALOG || {})[id]; return !!s && !s.supply; };

  /* ---------- 钱包 ---------- */
  function split(r, amount, notes) {
    const kits = living(r), d = data(r);
    if (!kits.length || !(amount > 0)) return;
    const each = Math.floor(amount / kits.length), rest = amount - each * kits.length;
    kits.forEach((k, i) => { d.purse[k] = (Number(d.purse[k]) || 0) + each + (i < rest ? 1 : 0); });
    if (notes) notes.push(`${amount} 奎支平分给 ${kits.length} 人：每人 ${each}${rest ? "（零头 " + rest + " 从前面的人起每人多 1）" : ""}。`);
  }
  /** 队伍的进账（state.kuizhi 是这一步攒下的公账）平分进各人钱包；死去角色的钱和东西一并处理 */
  function settle(r, notes) {
    const d = data(r);
    const pool = Math.max(0, Number(state.kuizhi) || 0);
    state.kuizhi = 0;
    if (pool) split(r, pool, notes);
    for (const kit of Object.keys(d.purse)) {
      if (living(r).includes(kit)) continue;
      const left = Number(d.purse[kit]) || 0;
      delete d.purse[kit];
      if (left > 0) split(r, left, notes);
    }
    living(r).forEach(k => { if (d.purse[k] == null) d.purse[k] = 0; });
    clampOwned(r);
  }

  /* ---------- 物品归属 ---------- */
  function ownedTotal(d, id) { return Object.values(d.owned).reduce((s, m) => s + (Number(m[id]) || 0), 0); }
  function free(r, id) { return Math.max(0, bagCount(id) - ownedTotal(data(r), id)); }
  function available(r, heroKit, id) { return (Number((data(r).owned[heroKit] || {})[id]) || 0) + free(r, id); }
  function addOwned(d, kit, id, n) {
    d.owned[kit] = d.owned[kit] || {};
    d.owned[kit][id] = Math.max(0, (Number(d.owned[kit][id]) || 0) + n);
    if (!d.owned[kit][id]) delete d.owned[kit][id];
  }
  /** 背包里少了的东西先从记在名下的扣；名下的总数不超过背包里实际有的；死去角色的东西变公用 */
  function clampOwned(r) {
    const d = data(r);
    for (const kit of Object.keys(d.owned)) if (!living(r).includes(kit)) delete d.owned[kit];
    const ids = new Set(Object.values(d.owned).flatMap(m => Object.keys(m)));
    for (const id of ids) {
      let over = ownedTotal(d, id) - bagCount(id);
      for (const kit of Object.keys(d.owned)) {
        if (over <= 0) break;
        const take = Math.min(over, Number(d.owned[kit][id]) || 0);
        addOwned(d, kit, id, -take); over -= take;
      }
    }
  }
  const bagSnap = () => Object.fromEntries((ensureBag().items || []).map(x => [x.id, Number(x.qty) || 0]));
  function applyBagDiff(r, before, kit) {
    const d = data(r), after = bagSnap();
    for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const delta = (after[id] || 0) - (before[id] || 0);
      if (delta > 0 && ownable(id)) addOwned(d, kit, id, delta);
      else if (delta < 0) addOwned(d, kit, id, -Math.min(-delta, Number((d.owned[kit] || {})[id]) || 0));
    }
    clampOwned(r);
  }
  /** 这条个人指令由哪名角色付钱、东西记在谁名下 */
  function payerOf(r, c) {
    if (c.payer != null) {
      if (!living(r).includes(c.payer)) fail("没有这名角色");
      return c.payer;
    }
    const h = c.kit ? heroOf(r, c.kit) : null;
    if (!h) fail("要指定由哪名角色付钱");
    return h.kit;
  }
  function checkItems(r, c, payer) {
    if ((c.action === "installPart" || c.action === "sellPart") && typeof weaponPartItemId === "function") {
      if (available(r, payer, weaponPartItemId(c.part)) < 1) fail("这件改装件不是你的");
    }
    if ((c.action === "installPart" || c.action === "removePart" || c.action === "upgradeWeapon" || c.action === "repairWeapon") && heroOf(r, c.kit)?.kit !== payer) fail("只能动自己角色的武器");
    if ((c.action === "healHero" || c.action === "modifyHero") && c.kit !== payer) fail("只能给自己的角色治疗、改造");
    if (c.action === "setCraftJob" && c.kit !== payer) fail("只能给自己的角色排活");
    if (c.action === "salvage" && available(r, payer, c.item) < 1) fail("这件东西不是你的");
  }

  /* ---------- 规则指令外面包一层：钱从谁的钱包出、进账怎么分 ---------- */
  if (G_Commands) Commands.intercept((cmd, context, next) => {
    if (cmd.type !== "run" || !active() || (root.GAME && GAME.sim)) return next();
    const r = (context && context.run) || run();
    if (!r) return next();
    if (PERSONAL.includes(cmd.action)) {
      const payer = payerOf(r, cmd), d = data(r);
      checkItems(r, cmd, payer);
      const pool = Number(state.kuizhi) || 0, before = bagSnap();
      state.kuizhi = Number(d.purse[payer]) || 0;
      r._pointsPayer = payer;   // 商店积分记在付钱的那名角色名下（rogue.js · pointsBook）
      try {
        const out = next();
        d.purse[payer] = Math.max(0, Number(state.kuizhi) || 0);
        applyBagDiff(r, before, payer);
        return out;
      } finally { state.kuizhi = pool; delete r._pointsPayer; }
    }
    const out = next();
    const notes = Array.isArray(out) ? out : Array.isArray(out && out.notes) ? out.notes : [];
    settle(r, notes);
    return out;
  });
  // 制作：补金属的钱从做的人自己的钱包出；做出来的道具记在做的人名下
  if (G_Rogue && Rogue.setCraftHooks) Rogue.setCraftHooks({
    applies: r => active() && r === run(),
    balance: (r, kit) => Number(data(r).purse[kit]) || 0,
    pay: (r, kit, n) => { const d = data(r); d.purse[kit] = Math.max(0, (Number(d.purse[kit]) || 0) - n); },
    made: (r, kit, id) => { if (ownable(id)) addOwned(data(r), kit, id, 1); }
  });
  // 背包按类分个人 / 公用（rogue.js · bagByCategory）：联机时按 run.online.owned
  if (G_Rogue && Rogue.setBagOwnership) Rogue.setBagOwnership(r => (active() && r === run() ? data(r).owned : null));
  // 战斗里用道具：自己的 + 公用的；用掉的先从自己名下扣
  if (typeof setItemAccess === "function") setItemAccess((unit, id) => {
    if (!active()) return bagCount(id);
    const r = run(), h = heroOf(r, unit.weaponOf || unit.kit);
    return h ? available(r, h.kit, id) : free(r, id);
  });
  if (G_Commands) Commands.intercept((cmd, context, next) => {
    if (cmd.type !== "useItem" || !active() || (root.GAME && GAME.sim)) return next();
    const r = run(), actor = (state.units || []).find(u => u.id === cmd.actor), h = actor && heroOf(r, actor.weaponOf || actor.kit);
    const before = bagSnap(), out = next();
    if (h) applyBagDiff(r, before, h.kit); else clampOwned(r);
    return out;
  });

  /* ---------- 掉落：按需求分配 ---------- */
  if (G_Rogue && Rogue.setLootHandler) Rogue.setLootHandler((r, id, qty, notes, source) => {
    if (!active() || r !== run()) return false;
    if (!ownable(id)) return false;   // 队伍公用的东西（制作材料……）直接进公用背包，不用大家选需求
    const d = data(r);
    d.loot.push({ no: ++d.lootNo, id, qty, source: source || "战利品", needs: {} });
    notes.push(`${source || "战利品"}：${itemName(id)} ×${qty}——各人选「需求」或「放弃」，在需求的人里抽一个。`);
    return true;
  });
  function lootWaiting(r, l) {
    const online = onlineIds();
    return living(r).filter(k => !l.needs[k] && online.includes(ownerOf(r, k)));
  }
  function resolveLoot(r, l) {
    const d = data(r), kits = living(r);
    d.loot = d.loot.filter(x => x !== l);
    if (!kits.length) return;
    const needers = kits.filter(k => l.needs[k] === "need");
    const pool = needers.length ? needers : kits;
    const winner = pool[Math.floor(Math.random() * pool.length)];
    bagAdd(l.id, l.qty);
    if (ownable(l.id)) addOwned(d, winner, l.id, l.qty);
    const how = needers.length ? `在需求的 ${needers.map(name).join("、")} 里抽中` : "没人需求，随机给了";
    const text = `${itemName(l.id)} ×${l.qty}：${how} ${name(winner)}。`;
    d.lootLog.push({ no: l.no, id: l.id, qty: l.qty, winner, text });
    d.lootLog = d.lootLog.slice(-20);
    (r.log = r.log || []).push({ act: r.act, day: r.day, text: "分配战利品：" + text });
  }
  function need(playerId, no, kit, wants) {
    const r = run(), d = data(r);
    const l = d.loot.find(x => x.no === no);
    if (!l) fail("这件战利品已经分完了");
    if (!living(r).includes(kit) || ownerOf(r, kit) !== playerId) fail("只能替自己的角色选");
    l.needs[kit] = wants ? "need" : "pass";
    if (!lootWaiting(r, l).length) resolveLoot(r, l);
    changed();
  }
  function forceLoot() { const r = run(); data(r).loot.slice().forEach(l => resolveLoot(r, l)); changed(); }

  /* ---------- 投票 ---------- */
  const nodeLabel = n => ((G_ROGUE_NODE_TYPES || {})[n.type] || {}).label || n.type;
  /** 现在要队伍一起决定的事：[{ id, label, cmd }]（cmd.fight = 开战） */
  function options(r) {
    r = r || run();
    if (!r || !G_Rogue || inBattle()) return [];
    const out = [], add = (id, label, cmd) => out.push({ id, label, cmd });
    const shortRest = () => { try { if (Rogue.canShortRestBefore(r).ok) add("shortRest", "先短休一次（每人回复 等级×2+体质）", { action: "shortRestBeforeNode" }); } catch (e) {} };
    switch (r.stage) {
      case "board": {
        const task = (t, which) => {
          if (!t || Rogue.taskBlocked(r, t)) return;
          const pay = Rogue.taskPay(r, t);
          add("task:" + which, `${t.key ? "执行主线" : "接下「" + t.name + "」"}（${t.days} 天 · 报酬 ${pay.kuizhi} 奎支）`, { action: "acceptTask", which });
        };
        if (r.main && !r.main.done) task(r.main, "main");
        (r.board || []).forEach((t, i) => task(t, i));
        break;
      }
      case "task": {
        const node = Rogue.currentNode(r);
        if (!node) { Rogue.nodeChoices(r).forEach(o => add("node:" + o.i, "下一站走「" + nodeLabel(o) + "」", { action: "chooseNode", index: o.i })); break; }
        if (node.type === "battle" || node.type === "elite") {
          add("fight", node.type === "elite" ? "迎战（精英战）" : "迎战", { fight: true });
          // 舌灿莲花（专长）：每个任务一次，谈掉一场普通战斗
          (Rogue.parleyOptions ? Rogue.parleyOptions(r) : []).forEach(o => add("parley:" + o.kit, `${name(o.kit)} 交涉（舌灿莲花 · 成功率 ${Math.round(o.chance * 100)}%）`, { action: "parley", kit: o.kit }));
          shortRest();
        }
        else if (node.type === "rest") {
          if (r.ambush) add("fight", "迎击偷袭的敌人", { fight: true });
          else {
            let plan = { ok: false };
            try { plan = Rogue.restPlan(r, {}); } catch (e) {}
            if (plan.ok) add("rest:long", "长休（血量、耐久回满）", { action: "restAtNode", mode: "long" });
            add("rest:short", "短休", { action: "restAtNode", mode: "short" });
            add("rest:leave", "不休息，直接离开", { action: "restAtNode", mode: "leave" });
          }
        } else if (node.type === "check") {
          let c = null;
          try { c = Rogue.checkInfo(r); } catch (e) {}
          const opts = c ? (c.options && c.options.length ? c.options : [c]) : [];
          opts.forEach((o, i) => r.party.forEach(h => {
            const odds = Rogue.checkOdds(r, h.kit, i);
            if (odds && odds.chance > 0) add(`check:${h.kit}:${i}`, `${name(h.kit)} 去做「${o.prof}」检定（成功率 ${Math.round(odds.chance * 1000) / 10}%）`, { action: "attemptCheck", kit: h.kit, opt: i });
          }));
          add("check:skip", "不冒险，绕过去", { action: "skipCheck" });
        } else { add("leave", "离开这里，继续前进", { action: "leaveNode" }); shortRest(); }
        break;
      }
      case "camp": add("camp", "休整（补给够就长休，不够硬撑）", { action: "camp" }); break;
      case "boss": add("fight", "迎战首领", { fight: true }); shortRest(); break;
      case "interlude":
        // 幕间选择：下一幕去哪（原本的区域 / 采矿场），队伍投票
        Rogue.interludeOptions(r).forEach(o => add("nextAct:" + o.region, `前往第 ${r.act + 1} 幕：${o.region}${o.alt ? "（改走采矿场）" : ""}`, { action: "nextAct", region: o.region }));
        break;
      case "victory": add("win:stop", "就此收手（通关）", { action: "afterVictory", goOn: false }); add("win:more", "继续挑战额外幕", { action: "afterVictory", goOn: true }); break;
    }
    return out;
  }
  function voteKey(r, opts) {
    return [r.stage, r.act, r.day, r.taskNo, r.task ? r.task.index : "", r.ambush ? "amb" : "", opts.map(o => o.id).join(",")].join("|");
  }
  function currentVote(r) {
    const d = data(r);
    if (inBattle()) return { opts: [], ballots: {} };
    const opts = options(r), key = voteKey(r, opts);
    if (d.voteKey !== key) { d.voteKey = key; d.ballots = {}; }
    return { opts, ballots: d.ballots };
  }
  /** 还不能结算投票的原因（空 = 可以） */
  function blocker(r) {
    // 掉线玩家的角色还没选的升级不卡全队（和战利品分配一样只等在线的人）；回来以后照样能选，房主也可以替他选
    const online = onlineIds();
    const pend = Rogue.pendingChoices(r).filter(p => online.includes(ownerOf(r, p.kit)));
    if (pend.length) return `等 ${[...new Set(pend.map(p => p.name))].join("、")} 选完升级`;
    if (G_Screens && Screens.is("battle")) return "战斗中";
    if (root.GAME && GAME.depth > 0) return "正在结算";
    return "";
  }
  /** cmd（房主在单局界面上点的按钮）对应哪一个选项 */
  function matchOption(cmd) {
    const r = run();
    if (!r) return null;
    const same = o => (cmd.fight && o.cmd.fight) || (!cmd.fight && !o.cmd.fight && o.cmd.action === cmd.action &&
      ["which", "index", "mode", "kit", "opt", "goOn", "region"].every(k => o.cmd[k] == null || o.cmd[k] === cmd[k]));
    return options(r).find(same) || null;
  }
  function isTeamCommand(cmd) {
    return !!cmd && (cmd.fight || ["acceptTask", "chooseNode", "restAtNode", "shortRestBeforeNode", "camp", "attemptCheck", "skipCheck", "parley", "leaveNode", "nextAct", "afterVictory"].includes(cmd.action));
  }
  function vote(playerId, optionId) {
    const r = run();
    if (!r) fail("还没有开始单局");
    const v = currentVote(r);
    if (!v.opts.some(o => o.id === optionId)) fail("这个选项已经失效");
    v.ballots[playerId] = optionId;
    changed();
    return { ok: true };
  }
  function unvote(playerId) { const r = run(); if (r) { delete currentVote(r).ballots[playerId]; changed(); } return { ok: true }; }
  function tryResolve(force) {
    const r = run();
    if (!active() || !r || resolving) return false;
    const { opts, ballots } = currentVote(r);
    if (!opts.length || blocker(r)) return false;
    const voters = onlineIds();
    const cast = Object.entries(ballots).filter(([, o]) => opts.some(x => x.id === o));
    if (!cast.length) return false;
    if (!force && !voters.every(id => ballots[id])) return false;
    const tally = {};
    cast.forEach(([, o]) => { tally[o] = (tally[o] || 0) + 1; });
    const top = Math.max(...Object.values(tally));
    const best = opts.filter(o => tally[o.id] === top);
    const pick = best[Math.floor(Math.random() * best.length)];
    const d = data(r);
    d.lastVote = { label: pick.label, text: `${pick.label}（${top} 票${best.length > 1 ? "，平票随机" : ""}）` };
    d.ballots = {}; d.voteKey = "";
    (r.log = r.log || []).push({ act: r.act, day: r.day, text: "队伍决定：" + d.lastVote.text });
    resolving = true;
    Promise.resolve().then(() => flow().perform(copy(pick.cmd))).catch(e => console.error(e)).finally(() => { resolving = false; changed(); });
    return true;
  }

  /* ---------- 有变化：重新分配战斗里的操控、看能不能结算、发给大家 ---------- */
  let soon = false;
  function changed() {
    const g = game();
    if (!active()) return;
    if (soon) return;
    soon = true;
    setTimeout(() => {
      soon = false;
      if (!active()) return;
      const r = run();
      data(r).loot.slice().forEach(l => { if (!lootWaiting(r, l).length) resolveLoot(r, l); });
      tryResolve(false);
      if (g.reassign) g.reassign();
      if (flow() && flow().refresh) flow().refresh();
      if (g.touch) g.touch();
    }, 0);
  }

  /* ---------- 玩家发来的指令 ---------- */
  function handle(playerId, cmd) {
    const r = run();
    if (!r) fail("还没有开始单局");
    if (cmd.type === "rogue.vote") return cmd.option == null ? unvote(playerId) : vote(playerId, String(cmd.option));
    if (cmd.type === "rogue.need") { need(playerId, Number(cmd.loot), String(cmd.kit), !!cmd.need); return { ok: true }; }
    if (cmd.type === "rogue.force") {
      if (playerId !== hostId) fail("只有房主可以执行此操作");
      if (cmd.what === "loot") forceLoot(); else if (!tryResolve(true)) fail("现在还不能决定：" + (blocker(r) || "没有人投票"));
      return { ok: true };
    }
    if (cmd.type !== "rogue.act" || !cmd.command || typeof cmd.command !== "object") fail("无效指令");
    const c = copy(cmd.command);
    if (!REMOTE.includes(c.action)) fail("这件事要队伍一起决定，或者由房主来做");
    if (G_Screens && Screens.is("battle")) fail("战斗中不能做这件事");
    const kit = c.action === "choose" ? c.kit : payerOf(r, c);
    if (!living(r).includes(kit) || ownerOf(r, kit) !== playerId) fail("只能动自己的角色");
    // 付钱的人和被动到的角色 / 武器必须是同一个人的（拆改装件、义体改造、治疗……不能拿自己的钱动别人的东西）
    if (c.action !== "choose") checkItems(r, c, kit);
    flow().actRaw(c);
    changed();
    return { ok: true };
  }
  /** 房主在单局界面上做个人行为：只能动房主自己操控的角色 */
  function checkHost(c) {
    if (!active() || !PERSONAL.includes(c.action) && c.action !== "choose") return;
    const r = run(), kit = c.action === "choose" ? c.kit : payerOf(r, c);
    // 操控者掉线时，房主可以替他选升级（不然只能等他回来）
    if (c.action === "choose" && !onlineIds().includes(ownerOf(r, kit))) return;
    if (ownerOf(r, kit) !== hostId) fail(`${name(kit)} 由 ${playerName(ownerOf(r, kit))} 操控，房主不能替他花钱或做选择`);
  }

  /* ---------- 给每个人看的数据（发送前还要经过 OnlineView.projectRogue） ---------- */
  // 单局的不少查询（restPlan、canShortRestBefore、sheetData……）会把队伍重新摆上场（rogue.js · withParty）：
  // 战斗中绝不能调，否则战场被清空。战斗中给每个人发开战前算好的那一份
  const viewCache = new Map();
  const inBattle = () => !!(G_Screens && Screens.is("battle")) || !!(root.GAME && GAME.rogue);
  function viewFor(playerId) {
    if (inBattle()) return viewCache.get(playerId) || null;
    const v = computeView(playerId);
    viewCache.set(playerId, v);
    return v;
  }
  function computeView(playerId) {
    const r = run();
    if (!r || !G_Rogue) return null;
    const d = data(r), mine = kitsOf(r, playerId);
    const { opts, ballots } = currentVote(r);
    const sup = Rogue.supplies();
    const C = Rogue.CONFIG;
    const heroes = r.party.map(h => {
      const v = Rogue.heroView(r, h);
      const owner = ownerOf(r, h.kit);
      return { kit: h.kit, name: v.name, level: v.level, hp: v.hp, hpMax: v.hpMax, xp: v.xp, xpNext: v.xpNext || 0,
        owner, ownerName: playerName(owner), mine: owner === playerId, purse: Number(d.purse[h.kit]) || 0, pending: !!v.pending,
        weapons: (v.weapons || []).map(w => ({ kit: w.kit, name: w.name, level: w.level, dur: w.dur, durMax: w.durMax })),
        items: Object.entries(d.owned[h.kit] || {}).filter(([, n]) => n > 0).map(([id, qty]) => ({ id, name: itemName(id), qty })) };
    });
    const freeItems = (ensureBag().items || []).map(x => ({ id: x.id, name: itemName(x.id), qty: free(r, x.id) })).filter(x => x.qty > 0);
    let task = null;
    if (r.task) {
      const t = r.task;
      task = { name: t.key ? "主线" : t.name, goal: t.goal, nodes: (t.nodes || []).map((n, i) => ({ label: n ? nodeLabel(n) : "（岔路）", done: !!(n && n.done), current: i === t.index })) };
    }
    const board = r.stage === "board" ? [r.main && !r.main.done ? r.main : null, ...(r.board || [])].filter(Boolean).map(t => {
      const pay = Rogue.taskPay(r, t);
      return { name: t.key ? "主线：" + t.name : t.name, goal: t.goal, days: t.days, kuizhi: pay.kuizhi, xp: pay.xp, blocked: Rogue.taskBlocked(r, t) || "" };
    }) : null;
    // 升级：自己的角色要选的第一项
    let choice = null;
    const myPend = Rogue.pendingChoices(r).filter(p => mine.includes(p.kit));
    const pend = myPend[0];
    if (pend) {
      const t = pend.choice.type;
      choice = { kit: pend.kit, index: pend.index, name: pend.name, level: pend.choice.level,
        title: t === "attr" ? "分配 1 点六维属性" + (pend.choice.noRepeat ? "（不能加在之前加过的同一项上）" : "") : t === "prof" ? "一个自选熟练项" : t === "role2" ? "从第二副职责里学一个技能" : t === "feat" ? "选择一项专长（不限职责和属性）" : t === "featFull" ? "兼修：选一张职责涉猎专长升成完整版" : t === "prof3" ? "万事通：选一项熟练项升到三级" : "选择一项职责技能",
        options: Rogue.choiceOptions(r, pend.kit, pend.index).map(o => ({ label: o.label, hint: o.hint || "", value: o.value })),
        more: myPend.length - 1 };   // 后面还有几项待选（房主界面有，玩家界面以前没有）
    }
    const waitingLevel = [...new Set(Rogue.pendingChoices(r).filter(p => !mine.includes(p.kit)).map(p => p.name))];
    // 个人能做的事：商店、工匠、诊所
    const shop = Rogue.canShop(r) ? Rogue.shopStock(r).map(row => ({ key: row.key, name: Rogue.shopItemName(row), price: row.price, team: !row.give.item || !ownable(row.give.item) })) : null;
    // 商店积分：各人自己的（记在自己操控的角色名下）
    const pointsOf = kit => { r._pointsPayer = kit; try { return Rogue.shopPoints(r); } finally { delete r._pointsPayer; } };
    const points = shop && mine[0] ? Object.assign(pointsOf(mine[0]), { redeem: Rogue.redeemList() }) : null;
    const smithId = (Rogue.presentSmiths(r) || [])[0] || null;
    const smith = smithId ? {
      id: smithId, name: (Rogue.smithInfo(r, smithId) || {}).name || "工匠",
      upgrades: Rogue.smithOptions(r, smithId).filter(o => mine.includes(o.owner)).map(o => ({ kit: o.kit, name: o.name, level: o.level, cost: o.cost, max: !!o.max })),
      offers: Rogue.partOffers(r, smithId).map((o, i) => ({ index: i, id: o.id, name: typeof weaponPartLabel === "function" ? weaponPartLabel(o.id) : o.id, text: typeof weaponPartText === "function" ? weaponPartText(o.id) : "", price: o.price, sold: !!o.sold })),
      slots: r.party.filter(h => mine.includes(h.kit)).flatMap(h => (h.weapons || []).flatMap(k => (typeof weaponPartRow === "function" ? weaponPartRow(h, k) : []).map((cur, slot) => ({ kit: k, name: name(k), slot, cur: cur ? (typeof weaponPartLabel === "function" ? weaponPartLabel(cur) : cur) : "" }))))
    } : null;
    const parts = Rogue.canSellParts(r) || smith ? Rogue.partStock().map(p => {
      const id = typeof weaponPartItemId === "function" ? weaponPartItemId(p.id) : "part_" + p.id;
      const have = mine.reduce((s, k) => s + (Number((d.owned[k] || {})[id]) || 0), 0) + (mine.length ? free(r, id) : 0);
      return { id: p.id, name: p.name, text: p.text, sell: p.sell, install: p.install, have: Math.min(have, p.qty) };
    }).filter(p => p.have > 0) : null;
    // 工匠装改装件前后对比（rogue.js · modInstallPreview）：只给自己的角色、自己能用的件（自己名下的 + 公用的），房主算好再发
    if (smith) {
      const usable = (parts || []).filter(p => p.have > 0).map(p => p.id);
      smith.installPreviews = r.party.filter(h => mine.includes(h.kit)).flatMap(h => (h.weapons || []).flatMap(w => {
        const n = typeof weaponPartRow === "function" ? weaponPartRow(h, w).length : 0;
        const out = [];
        for (let slot = 0; slot < n; slot++) usable.forEach(part => {
          const pv = Rogue.modInstallPreview(r, h.kit, w, part, slot);
          if (pv) out.push({ kit: h.kit, weapon: w, weaponName: name(w), partName: typeof weaponPartLabel === "function" ? weaponPartLabel(part) : part,
            slot: pv.slot, part, replaced: pv.replaced, cost: pv.cost, before: pv.before, after: pv.after, delta: pv.delta });
        });
        return out;
      }));
    }
    // 诊所：治疗；义体改造带上现在的方案和上限，玩家那边按同样的公式估价（真正扣多少以房主结算为准）
    const cyberOf = kit => { try { const i = Rogue.cyberInfo(r, kit); return { current: i.current, limit: i.limit, rate: i.rate, fleshMax: i.fleshMax, perHp: (typeof ROGUE_CLINIC !== "undefined" && ROGUE_CLINIC.cyberPerHp) || 0 }; } catch (e) { return null; } };
    // 工坊：大家排的活、自己的角色能做什么、能学的配方、能拆的东西
    const place = Rogue.craftPlace(r);
    const workshop = place && mine.length ? {
      place, queue: Rogue.craftQueue(r),
      mine: r.party.filter(h => mine.includes(h.kit)).map(h => ({ kit: h.kit, name: name(h.kit),
        options: Rogue.craftList(r).filter(x => x.known && (place === "bench" || !x.bench)).map(x => {
          const o = Rogue.craftOdds(r, h.kit, x.id) || {};
          return o.base ? { id: x.id, name: x.name, chance: o.chance, hours: x.hours, prof: x.prof, mats: x.mats.map(m => `${m.name} ${m.have}/${m.need}`).join("、") } : null;
        }).filter(Boolean) })),
      helpers: living(r).map(k => ({ kit: k, name: name(k) })),
      learn: Rogue.learnOptions(r),
      salvage: Rogue.salvageList().map(x => Object.assign(x, { have: mine.reduce((s, k) => s + (Number((d.owned[k] || {})[x.id]) || 0), 0) + free(r, x.id) })).filter(x => x.have > 0)
    } : null;
    // 背包 / 配方簿（inventory.js · buildInventory；rogue.js · inventory / recipeBook）：数量只在房主这边算，
    // 每人只拿到自己角色名下的 + 公用的；别人名下的东西不发。成功率只给材料够、能做的配方
    const backpack = backpackFor(r, mine);
    if (workshop) workshop.recipes = r.party.filter(h => mine.includes(h.kit)).map(h => ({ kit: h.kit, name: name(h.kit),
      list: Rogue.recipeBook(r, h.kit, { counts: backpack.usable[h.kit] || backpack.sharedCounts }) }));
    // 给新工坊 / 背包界面（和房主界面同一套接口：rogue.js · workshopAvailable / craftListGrouped / craftPreview / bagByCategory / materialBar / cyberSummary）
    const wkAt = Rogue.workshopAvailable(r);
    const bag = mine.map(k => Rogue.bagByCategory(r, k));
    const materialBar = Rogue.materialBar(r, backpack.sharedCounts);
    const craft = wkAt ? mine.map(k => {
      const counts = backpack.usable[k] || backpack.sharedCounts, kuizhi = Number(d.purse[k]) || 0;
      const grouped = Rogue.craftListGrouped(r, { counts, kuizhi });
      return { kit: k, name: name(k), grouped, previews: grouped.craftable.map(x => Rogue.craftPreview(r, k, x.id, null, { counts, kuizhi })) };
    }) : null;
    const cyber = mine.map(k => Rogue.cyberSummary(r, k)).filter(Boolean);
    const clinic = Rogue.canClinic(r) ? r.party.filter(h => mine.includes(h.kit)).map(h => ({ kit: h.kit, name: name(h.kit), cost: Rogue.healCost(r, h.kit), cyber: cyberOf(h.kit) })) : null;
    return {
      act: r.act, day: r.day, region: Rogue.region(r), daysLeft: Rogue.daysLeft(r), daysPerAct: C.daysPerAct, stage: r.stage,
      main: r.main ? { done: !!r.main.done, days: r.main.days } : null,
      supplies: { water: sup.water, food: sup.foodTotal, hours: Rogue.hoursAwake() },
      heroes, mine, freeItems, task, board,
      fallen: (r.fallen || []).map(f => name(f.kit)),
      result: r.stage === "over" && r.result ? { win: !!r.result.win, text: r.result.text || "" } : null,
      vote: { options: opts.map(o => ({ id: o.id, label: o.label, voters: Object.entries(ballots).filter(([, x]) => x === o.id).map(([p]) => playerName(p)), mine: ballots[playerId] === o.id })),
        blocked: blocker(r), voted: Object.keys(ballots).filter(id => onlineIds().includes(id)).length, voters: onlineIds().length },
      lastVote: d.lastVote ? d.lastVote.text : "",
      loot: d.loot.map(l => ({ no: l.no, name: itemName(l.id), qty: l.qty, source: l.source,
        needs: living(r).filter(k => l.needs[k] === "need").map(name), passes: living(r).filter(k => l.needs[k] === "pass").map(name),
        mine: mine.map(k => ({ kit: k, name: name(k), answer: l.needs[k] || "" })) })),
      lootLog: d.lootLog.slice(-5).map(x => x.text),
      choice, waitingLevel, shop, points, smith, parts, clinic, workshop, backpack, workshopAvailable: wkAt, bag, materialBar, craft, cyber,
      lastRest: r.lastRest || null,   // 长休结算画面（坚毅字段在 online-view.js · scrubHidden 里去掉）
      log: (r.log || []).slice(-8).map(l => l.text)
    };
  }

  /** 一名玩家的背包：自己操控的角色名下的 + 公用的（总数由房主按 state.bag − 所有人名下的算） */
  function backpackFor(r, mine) {
    const inv = Rogue.inventory(r, { owned: data(r).owned, kits: mine });
    return { tabs: inv.tabs, shared: inv.shared, personal: inv.personal, usable: inv.usable, sharedCounts: inv.sharedCounts, water: inv.water };
  }

  /* ---------- 开局、分配角色 ---------- */
  function onNewRun(r) { data(r); settle(r, null); changed(); }
  function setOwners(map) {
    const r = run();
    if (!r) return;
    const d = data(r);
    d.owners = {};
    Object.entries(map || {}).forEach(([kit, pid]) => { if (living(r).includes(kit) && pid && pid !== hostId) d.owners[kit] = pid; });
    changed();
  }
  /** 座位被释放的玩家：他的角色回到房主 */
  function release(playerId) {
    const r = run();
    if (!r) return;
    const d = data(r);
    for (const kit of Object.keys(d.owners)) if (d.owners[kit] === playerId) delete d.owners[kit];
    changed();
  }
  /** 战斗里的操控分配（hotseat）：按单局里记的「角色 → 玩家」 */
  function assignmentsFor(units) {
    const r = run();
    if (!r) return {};
    const out = {};
    (units || []).forEach(u => { const o = data(r).owners[u.kit]; if (o && rosterIds().includes(o)) out[u.id] = o; });
    return out;
  }

  root.OnlineRogue = {
    enable(on, host) { enabled = !!on; hostId = host || hostId; if (G_SaveStore && SaveStore.useOnlineRunSlot) SaveStore.useOnlineRunSlot(!!on); },
    get enabled() { return enabled; }, active, data, options, matchOption, isTeamCommand, vote, unvote, tryResolve, need, forceLoot,
    handle, checkHost, viewFor, onNewRun, setOwners, release, assignmentsFor, changed, ownerOf: kit => (run() ? ownerOf(run(), kit) : hostId),
    hostKits: () => (run() ? kitsOf(run(), hostId) : []), purse: kit => (run() ? Number(data(run()).purse[kit]) || 0 : 0),
    available: (kit, id) => (run() ? available(run(), kit, id) : 0), backpackFor: playerId => (run() ? backpackFor(run(), kitsOf(run(), playerId)) : null), blocker: () => (run() ? blocker(run()) : ""), inBattle
  };
})(typeof window !== "undefined" ? window : globalThis);
