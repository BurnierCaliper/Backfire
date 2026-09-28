/* 角鳞：四幕 · 单局流程（规则部分）
 *
 * 不碰网页：界面在 rogue-ui.js，测试可以直接在 Node 里跑整局。
 *
 *   四幕。每幕：任务板 → 接任务 → 任务内节点线性推进（战斗 / 休息）
 *   → 任务完成 → 休整（算一天）→ 下一个任务 …
 *   天数耗尽或主线任务完成 → 休整 → 幕末 BOSS → 赢了进入下一幕，输了本局结束。
 *
 * 所有还没敲定的数值都集中在 ROGUE_CONFIG，改一行就能试另一种方案。
 * 标「占位」的是为了先跑通流程临时定的，等设计确定后替换。
 */

const ROGUE_CONFIG = {
  acts: 4,
  daysPerAct: 8,                  // 占位：每幕可用天数
  restDays: 1,                    // 任务之间的休整算几天
  boardSize: 3,                   // 任务板同时挂几个任务（其中 1 个主线）
  xpReqScale: 1 / 3,              // 已定（试行）：升级所需经验为原来的 1/3
  weaponLevelEveryTasks: 2,       // 已定方向，数值占位：每完成 N 个任务，全队武器 +1 级
  // 占位：第 1–4 幕所在区域
  regions: ["外城区", "沙漠", "巨人城", "天网设施"],
  // 占位：每个区域的轮换 BOSS 池（手册设想每区约 3 个，目前只接入了 3 个 BOSS）
  bosses: {
    "外城区": ["outlaw_king"],
    "沙漠": ["sand_aggregate"],
    "巨人城": ["ufo_boss"],
    "天网设施": ["ufo_boss"]
  },
  // 占位：敌人等级 = 幕基准 + 任务难度
  actBaseLevel: [1, 3, 5, 7],
  startSupplies: { water: 6000, food: 12, kuizhi: 1000 },
  // 团灭即本局结束（手册只写明了 BOSS 战；普通战斗团灭先按同样处理）
  wipeEndsRun: true
};

/* 占位任务：只有结构，文字与数值都是临时的。
 *   nodes   节点数范围；battle 战斗 / elite 精英战 / rest 休息
 *   days    需要几天
 *   reward  完成奖励（奎支、每人经验）
 *   supply  接任务时委托方提供的补给
 *   diff    敌人等级 = 幕基准 + diff */
const ROGUE_TASKS = [
  { kind: "clear",  name: "清剿",   goal: "清掉盘踞在{region}的一伙敌人",     nodes: [2, 3], days: 1, diff: 0, rest: 0,
    reward: { kuizhi: 400, xp: 15 },  supply: { water: 500, food: 1 } },
  { kind: "escort", name: "护送",   goal: "护送一批货穿过{region}",            nodes: [3, 4], days: 2, diff: 0, rest: 1,
    reward: { kuizhi: 700, xp: 25 },  supply: { water: 2000, food: 4 } },
  { kind: "scout",  name: "侦察",   goal: "摸清{region}深处的动静",            nodes: [3, 3], days: 1, diff: 1, rest: 1,
    reward: { kuizhi: 500, xp: 20 },  supply: { water: 1000, food: 2 } },
  { kind: "bounty", name: "悬赏",   goal: "在{region}找到并击败悬赏目标",      nodes: [2, 3], days: 1, diff: 1, rest: 0, elite: true,
    reward: { kuizhi: 900, xp: 30 },  supply: { water: 500, food: 1 } }
];
const ROGUE_MAIN_TASK = {
  kind: "main", name: "主线", goal: "推进本幕的关键目标（完成后直接进入幕末 BOSS）", nodes: [4, 4], days: 3, diff: 1, rest: 1, elite: true,
  reward: { kuizhi: 1200, xp: 40 }, supply: { water: 3000, food: 6 }, key: true
};

const Rogue = (function () {
  "use strict";
  const C = ROGUE_CONFIG;

  /* ---------- 随机数 ----------
   * 任务板、节点、遭遇都用「种子 + 位置」派生的独立随机流，
   * 所以同一局读档后看到的任务板和敌人完全一样，也不会被战斗里的掷骰打乱。 */
  function withRng(key, fn) {
    const prev = Math.random;
    Math.random = makeRng(key);
    try { return fn(); } finally { Math.random = prev; }
  }
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const between = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

  function log(run, text) {
    run.log = run.log || [];
    run.log.push({ act: run.act, day: run.day, text });
    if (run.log.length > 200) run.log.splice(0, run.log.length - 200);
  }

  const region = (run) => C.regions[Math.min(C.regions.length, run.act) - 1] || C.regions[0];
  const daysLeft = (run) => Math.max(0, C.daysPerAct - (run.actDay || 0));

  function cardOf(kit) {
    return livePartyCards().find(c => c.kit === kit) || null;
  }
  function heroName(kit) {
    const c = cardOf(kit);
    return c ? c.name : kit;
  }
  /** 可选角色：所有不是武器人的角色卡（Meta 解锁以后在这里过滤） */
  function heroPool() {
    return livePartyCards().filter(c => !c.weaponOf);
  }

  /* ---------- 开局 ---------- */
  function newRun(opt) {
    opt = opt || {};
    const run = SaveStore.newRun({ party: opt.party, seed: opt.seed, supplies: Object.assign({}, C.startSupplies) });
    run.actDay = 0;          // 本幕已用天数
    run.tasksDone = 0;
    run.taskNo = 0;          // 本局第几个任务（派生随机数用）
    run.party.forEach(h => { h.weaponLevels = {}; h.weapons.forEach(k => { h.weaponLevels[k] = 1; }); });
    log(run, `出发：${run.party.map(h => heroName(h.kit)).join("、")}（种子 ${run.seed}）`);
    makeBoard(run);
    return run;
  }

  /* ---------- 任务板 ---------- */
  function makeTask(run, tpl, slot) {
    const key = `${run.seed}:board:${run.act}:${run.boardNo}:${slot}`;
    return withRng(key, () => {
      const n = between(tpl.nodes[0], tpl.nodes[1]);
      const types = [];
      for (let i = 0; i < n; i++) types.push("battle");
      // 休息点：不放在第一个和最后一个
      for (let r = 0; r < (tpl.rest || 0) && n >= 3; r++) types[between(1, n - 2)] = "rest";
      if (tpl.elite) types[n - 1] = "elite";
      return {
        kind: tpl.kind,
        name: tpl.name,
        goal: tpl.goal.replace("{region}", region(run)),
        days: tpl.days,
        diff: tpl.diff,
        key: !!tpl.key,
        reward: Object.assign({}, tpl.reward),
        supply: Object.assign({}, tpl.supply),
        nodeTypes: types     // 任务板上不给玩家看
      };
    });
  }

  function makeBoard(run) {
    run.boardNo = (run.boardNo || 0) + 1;
    const tasks = [];
    if (!run.mainDone) tasks.push(makeTask(run, ROGUE_MAIN_TASK, 0));
    const pool = ROGUE_TASKS.slice();
    withRng(`${run.seed}:boardpick:${run.act}:${run.boardNo}`, () => {
      while (tasks.length < C.boardSize && pool.length) {
        const i = Math.floor(Math.random() * pool.length);
        tasks.push(makeTask(run, pool.splice(i, 1)[0], tasks.length));
      }
    });
    run.board = tasks;
    run.stage = "board";
    return tasks;
  }

  /** 这个任务现在能不能接。返回 null 表示可以，否则是原因 */
  function taskBlocked(run, task) {
    if (!task) return "没有这个任务";
    if (!task.key && task.days > daysLeft(run)) return `剩余天数不够（还剩 ${daysLeft(run)} 天）`;
    return null;
  }

  function acceptTask(run, index) {
    const task = run.board && run.board[index];
    const why = taskBlocked(run, task);
    if (why) throw new Error(why);
    run.taskNo += 1;
    run.task = Object.assign({}, task, { index: 0, nodes: task.nodeTypes.map(t => ({ type: t, done: false })) });
    run.board = null;
    run.stage = "task";
    run.supplies.water += task.supply.water || 0;
    run.supplies.food += task.supply.food || 0;
    log(run, `接下任务「${task.name}」：${task.goal}。委托方提供 ${task.supply.water || 0} ml 水、${task.supply.food || 0} 份食物。`);
    return run.task;
  }

  function currentNode(run) {
    if (run.stage !== "task" || !run.task) return null;
    return run.task.nodes[run.task.index] || null;
  }

  /* ---------- 战斗 ---------- */
  function enemyLevel(run, extra) {
    return Math.max(1, (C.actBaseLevel[run.act - 1] || 1) + (extra || 0));
  }

  /** 当前节点 / BOSS 的战斗配置（给 BattleSim.setup 或战斗画面用） */
  function battleSpec(run) {
    const partyKits = run.party.map(h => h.kit);
    const before = () => applyPartyToField(run);
    if (run.stage === "boss") {
      const key = `${run.seed}:boss:${run.act}`;
      const enc = withRng(key, () => {
        const pool = (C.bosses[region(run)] || []).filter(Boolean);
        const all = Object.keys(C.bosses).reduce((a, k) => a.concat(C.bosses[k]), []);
        const boss = pick(pool.length ? pool : all);
        return rollBossEncounter(boss, { region: region(run) });
      });
      return { kind: "boss", title: `第 ${run.act} 幕 · 首领战`, party: partyKits, encounter: enc,
        level: enemyLevel(run, 1), seed: key, before };
    }
    const node = currentNode(run);
    if (!node || (node.type !== "battle" && node.type !== "elite")) return null;
    const key = `${run.seed}:fight:${run.taskNo}:${run.task.index}`;
    const enc = withRng(key, () => {
      const opt = { region: region(run) };
      if (node.type === "elite") opt.tokens = 5;
      return rollEncounter(opt);
    });
    return {
      kind: node.type,
      title: `${run.task.name} · 第 ${run.task.index + 1} 站${node.type === "elite" ? "（精英）" : ""}`,
      party: partyKits, encounter: enc,
      level: enemyLevel(run, run.task.diff + (node.type === "elite" ? 1 : 0)),
      seed: key, before
    };
  }

  /** 单局里的角色状态 → 战场上的单位（在 BattleSim.setup 的 before 里调用） */
  function applyHero(u, h) {
    u.weaponLevels = Object.assign({}, u.weaponLevels || {}, h.weaponLevels || {});
    u.level = h.level || 1;
    u.xp = h.xp || 0;
    u.attrPoints = h.attrPoints || 0;
    applyLevelStats(u);
    if (Array.isArray(h.hp)) {
      (u.layers || []).forEach((l, i) => {
        const s = h.hp[i];
        if (s && s.type === l.type) l.current = Math.max(0, Math.min(Number(l.max) || 0, Number(s.current) || 0));
      });
    }
    if (h.shp != null) u.shp = Math.max(0, Math.min(Number(u.shpMax) || 0, Number(h.shp) || 0));
    u.dying = !!h.dying;
    u.upOnShp = !!h.upOnShp;
  }
  function applyPartyToField(run) {
    // 战斗里的掉落和道具用本局的钱包和背包，不碰跑团版的队伍档案
    state.kuizhi = run.supplies.kuizhi;
    run.bag = run.bag || { items: [] };
    state.bag = run.bag;
    run.party.forEach(h => {
      const u = findKit(h.kit, state.units);
      if (u) applyHero(u, h);
    });
  }

  function captureHero(u, h) {
    h.level = u.level || 1;
    h.xp = u.xp || 0;
    h.attrPoints = u.attrPoints || 0;
    h.hp = persistentLayers(u);
    h.shp = Math.max(0, Number(u.shp) || 0);
    h.dying = !!u.dying;
    h.upOnShp = !!u.upOnShp;
  }

  /** 离开战斗时的状态（血量、经验、等级）写回单局；阵亡的角色连同武器人永久离队 */
  function captureParty(run, notes) {
    notes = notes || [];
    run.party.slice().forEach(h => {
      const u = findKit(h.kit, state.units);
      if (!u) return;
      if (typeof tryLevelUp === "function") {
        const from = u.level;
        if (tryLevelUp(u) && u.level > from) notes.push(`${u.name} 升到 ${u.level} 级。`);
      }
      if (u.dead) {
        SaveStore.killHero(run, h.kit);
        const ws = h.weapons.map(heroName).join("、");
        notes.push(`${u.name} 永久死亡${ws ? "，" + ws + " 随之离开队伍" : ""}。`);
        return;
      }
      captureHero(u, h);
    });
    return notes;
  }

  /** 战斗结束后调用。win：我方是否胜利。返回要显示的记录。 */
  function finishBattle(run, win) {
    const notes = captureParty(run, []);
    run.supplies.kuizhi = Number(state.kuizhi) || 0;
    run.bag = JSON.parse(JSON.stringify(state.bag || { items: [] }));
    const wiped = !win || !run.party.length;
    if (wiped && C.wipeEndsRun) {
      endRun(run, false, run.stage === "boss" ? `倒在第 ${run.act} 幕的首领面前。` : "全队倒在了任务途中。");
      notes.push("团灭。本局结束。");
      return notes;
    }
    if (run.stage === "boss") {
      notes.push(`击败第 ${run.act} 幕首领。`);
      if (run.act >= C.acts) {
        endRun(run, true, "四幕全部通过。");
      } else {
        run.stage = "interlude";
      }
      notes.forEach(t => log(run, t));
      return notes;
    }
    notes.forEach(t => log(run, t));
    advanceNode(run, notes);
    return notes;
  }

  /* ---------- 任务节点推进 ---------- */
  function advanceNode(run, notes) {
    notes = notes || [];
    const node = currentNode(run);
    if (node) node.done = true;
    run.task.index += 1;
    if (run.task.index >= run.task.nodes.length) completeTask(run, notes);
    return notes;
  }

  /** 任务内休息点：长休（消耗水和食物，回满）或短休（不消耗，回一部分） */
  function restCost(run) {
    let water = 0, food = 0;
    run.party.forEach(h => {
      const c = longRestCost(cardOf(h.kit) || {});
      water += c.water; food += c.food;
    });
    return { water, food };
  }
  function canLongRest(run) {
    const c = restCost(run);
    return run.supplies.water >= c.water && run.supplies.food >= c.food;
  }

  /** 在一个临时单位上操作角色状态（算上限、回血），再写回 */
  function withHeroUnit(h, fn) {
    const u = spawnLiveCard(cardOf(h.kit), 1);
    applyHero(u, h);
    fn(u);
    captureHero(u, h);
  }

  /** 界面用：一名角色的当前状态（上限按等级算好） */
  function heroView(h) {
    let v = null;
    withHeroUnit(h, u => {
      v = {
        kit: h.kit,
        name: u.name,
        level: u.level || 1,
        hp: totalCurHp(u),
        hpMax: baseMaxHp(u),
        shp: Number(u.shp) || 0,
        shpMax: Number(u.shpMax) || 0,
        dying: !!u.dying,
        xp: u.xp || 0,
        xpNext: xpToNext(u.level),
        weapons: h.weapons.map(k => ({ kit: k, name: heroName(k), level: (h.weaponLevels || {})[k] || 1 }))
      };
    });
    return v;
  }

  function longRest(run, notes, hours) {
    hours = hours || 8;
    const c = restCost(run);
    run.supplies.water -= c.water;
    run.supplies.food -= c.food;
    notes.push(`长休：消耗 ${c.water} ml 水、${c.food} 份食物。`);
    run.party.forEach(h => withHeroUnit(h, u => {
      (u.layers || []).forEach(l => { l.current = l.max; });
      u.dying = false;
      u.upOnShp = false;
      u.shp = Math.min(Number(u.shpMax) || 0, (Number(u.shp) || 0) + hours * 2);
      notes.push(`${u.name} 血量回满，坚毅 ${u.shp}/${u.shpMax}。`);
    }));
  }
  function shortRest(run, notes) {
    run.party.forEach(h => withHeroUnit(h, u => {
      if (u.dying) { notes.push(`${u.name} 濒死，短休无法恢复。`); return; }
      const con = (u.attrs && Number(u.attrs.con)) || 0;
      const heal = (Number(u.level) || 1) * 2 + con;
      healUnit(u, heal);
      notes.push(`${u.name} 短休恢复 ${heal}。`);
    }));
  }

  function restAtNode(run, mode) {
    const node = currentNode(run);
    if (!node || node.type !== "rest") throw new Error("当前节点不是休息点");
    const notes = [];
    if (mode === "long") {
      if (!canLongRest(run)) throw new Error("补给不够长休");
      longRest(run, notes);
    } else {
      shortRest(run, notes);
    }
    notes.forEach(t => log(run, t));
    advanceNode(run, notes);
    return notes;
  }

  /* ---------- 任务完成、武器成长 ---------- */
  function completeTask(run, notes) {
    const t = run.task;
    run.supplies.kuizhi += t.reward.kuizhi || 0;
    notes.push(`任务「${t.name}」完成：获得 ${t.reward.kuizhi || 0} 奎支，每人 ${t.reward.xp || 0} 经验。`);
    run.party.forEach(h => { h.xp = (h.xp || 0) + (t.reward.xp || 0); });
    levelUpOutOfBattle(run, notes);
    run.tasksDone += 1;
    if (C.weaponLevelEveryTasks > 0 && run.tasksDone % C.weaponLevelEveryTasks === 0) {
      run.party.forEach(h => h.weapons.forEach(k => {
        h.weaponLevels[k] = (h.weaponLevels[k] || 1) + 1;
        notes.push(`${heroName(k)} 升到 ${h.weaponLevels[k]} 级。`);
      }));
    }
    run.actDay = (run.actDay || 0) + t.days;
    run.day += t.days;
    if (t.key) run.mainDone = true;
    run.task = null;
    run.stage = "camp";
    notes.forEach(s => log(run, s));
    return notes;
  }

  function levelUpOutOfBattle(run, notes) {
    run.party.forEach(h => withHeroUnit(h, u => {
      const from = u.level;
      if (tryLevelUp(u) && u.level > from) notes.push(`${u.name} 升到 ${u.level} 级。`);
    }));
  }

  /* ---------- 任务之间的休整 ---------- */
  /** 休整一次：补给够就长休，不够只能硬撑。之后回任务板，或者进入幕末 BOSS。 */
  function camp(run) {
    if (run.stage !== "camp") throw new Error("现在不是休整的时候");
    const notes = [];
    if (canLongRest(run)) longRest(run, notes);
    else notes.push("补给不足，无法长休，只能硬撑着过夜。");
    run.actDay += C.restDays;
    run.day += C.restDays;
    const reason = run.mainDone ? "主线任务完成" : daysLeft(run) <= 0 ? "天数耗尽" : null;
    if (reason) {
      run.stage = "boss";
      notes.push(`${reason}：前往第 ${run.act} 幕的首领所在。`);
    } else {
      makeBoard(run);
      if (!run.board.some(t => !taskBlocked(run, t))) {
        run.stage = "boss";
        notes.push("剩下的天数已经接不了任何任务：前往首领所在。");
      }
    }
    notes.forEach(t => log(run, t));
    return notes;
  }

  /* ---------- 幕间 ---------- */
  function nextAct(run) {
    if (run.stage !== "interlude") throw new Error("现在不是幕间");
    run.act += 1;
    run.actDay = 0;
    run.mainDone = false;
    const notes = [`进入第 ${run.act} 幕：${region(run)}。`];
    makeBoard(run);
    notes.forEach(t => log(run, t));
    return notes;
  }

  function endRun(run, win, text) {
    run.stage = "over";
    run.result = { win: !!win, text, act: run.act, day: run.day };
    log(run, (win ? "通关：" : "失败：") + text);
  }

  return {
    CONFIG: C, TASKS: ROGUE_TASKS, MAIN_TASK: ROGUE_MAIN_TASK,
    newRun, heroPool, heroName, cardOf, region, daysLeft, heroView,
    makeBoard, taskBlocked, acceptTask, currentNode,
    battleSpec, applyPartyToField, finishBattle,
    restCost, canLongRest, restAtNode,
    camp, nextAct, endRun,
    enterRunMode: () => setXpRequirementScale(C.xpReqScale),
    leaveRunMode: () => setXpRequirementScale(1)
  };
})();
