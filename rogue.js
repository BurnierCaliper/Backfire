/* 角鳞：四幕 · 单局流程（规则部分）
 *
 * 不碰网页：界面在 rogue-ui.js，测试可以直接在 Node 里跑整局。所有数值在 rogue-data.js。
 *
 * 一幕：
 *   开幕自动接下主线（有期限）→ 任务板上挑支线或执行主线 → 任务内节点线性推进
 *   （战斗 / 精英战 / 休息 / 商店 / 工匠）→ 任务完成 → 休整（算一天）→ 回任务板 …
 *   本幕天数用完（主线必须已完成）→ 幕末首领 → 赢了进入下一幕。主线完成后剩下的天数可以继续做支线发育。
 *   主线期限内没完成、任何战斗团灭：本局结束。
 *   四幕打完可以选择通关，或者继续挑战额外幕（敌人到 20、25 级）。
 *
 * 手册里的资源规则（武器耐久、距上次长休的小时数与力竭、短休次数、长休吃的食物、
 * 睡袋、维修工具包、水）与战斗原型共用 ledger.js：单局期间把队伍档案换成本局的，
 * 离开单局时换回来。所以两种模式的这些规则永远一致。
 */

const Rogue = (function () {
  "use strict";
  const C = ROGUE_CONFIG;
  const NODE = ROGUE_NODE_TYPES;
  const SOLO = ROGUE_SOLO;
  const clone = (x) => JSON.parse(JSON.stringify(x));

  /* ---------- 随机数 ----------
   * 任务板、节点、遭遇都用「种子 + 位置」派生的独立随机流：
   * 读档后看到的完全一样，也不会被战斗里的掷骰打乱。 */
  function withRng(key, fn) {
    const prev = Math.random;
    Math.random = makeRng(key);
    try { return fn(); } finally { Math.random = prev; }
  }
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const between = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  function pickWeighted(weights, exclude) {
    const keys = Object.keys(weights).filter(k => weights[k] > 0 && NODE[k] && (!exclude || exclude.indexOf(k) < 0));
    const total = keys.reduce((s, k) => s + weights[k], 0);
    let r = Math.random() * total;
    for (const k of keys) { r -= weights[k]; if (r < 0) return k; }
    return keys[keys.length - 1] || "battle";
  }

  function log(run, text) {
    run.log = run.log || [];
    run.log.push({ act: run.act, day: run.day, text });
    if (run.log.length > 300) run.log.splice(0, run.log.length - 300);
  }
  function logAll(run, notes) { notes.forEach(t => log(run, t)); return notes; }

  /* ---------- 幕、区域、天数、敌人等级 ---------- */
  const totalActs = (run) => C.acts + (run.extra ? C.extraActs : 0);
  const region = (run) => C.regions[(run.act - 1) % C.regions.length];
  const daysLeft = (run) => Math.max(0, C.daysPerAct - (run.actDay || 0));
  function levelRange(run) {
    if (run.act <= C.acts) return C.actLevels[run.act - 1] || C.actLevels[C.actLevels.length - 1];
    return C.extraActLevels[run.act - C.acts - 1] || C.extraActLevels[C.extraActLevels.length - 1];
  }
  /** 本幕此刻的敌人等级：随本幕已用天数从「起」涨到「止」 */
  function enemyLevel(run, bonus) {
    const [a, b] = levelRange(run);
    const t = Math.min(1, (run.actDay || 0) / Math.max(1, C.daysPerAct));
    return Math.max(a, Math.min(b, Math.round(a + (b - a) * t) + (bonus || 0)));
  }

  /* ---------- 角色 ---------- */
  function cardOf(kit) { return livePartyCards().find(c => c.kit === kit) || null; }
  function heroName(kit) { const c = cardOf(kit); return c ? c.name : kit; }
  /** 可选角色：所有不是武器人的角色卡（Meta 解锁以后在这里过滤） */
  function heroPool() { return livePartyCards().filter(c => !c.weaponOf); }
  /** 单人模式能选哪些第二副职责：角色卡上已有的主 / 副职责之外的 */
  function role2Options(kit) {
    const c = cardOf(kit);
    const have = c && c.roles ? [c.roles.primary, c.roles.secondary] : [];
    return ROLE_LIST.filter(r => have.indexOf(r) < 0);
  }
  function checkSoloSetup(opt) {
    const kit = (opt.party || [])[0];
    const pool = heroPool().map(c => c.kit);
    const ps = opt.partners || [];
    if (ps.length !== SOLO.partners) throw new Error(`单人模式要选 ${SOLO.partners} 名伙伴。`);
    if (new Set(ps).size !== ps.length || ps.indexOf(kit) >= 0) throw new Error("伙伴不能重复，也不能是主角自己。");
    if (ps.some(k => pool.indexOf(k) < 0)) throw new Error("伙伴只能从可选角色里挑。");
    if (role2Options(kit).indexOf(opt.role2) < 0) throw new Error("第二副职责要选一个角色卡上没有的职责。");
  }
  /** 本局里这个角色的熟练项 { 名字: 等级 }。开局照角色资料（party.js · HERO_PROFILES），升级时自选的往上加 */
  function heroProfs(h) {
    if (!h.profs) {
      const p = heroProfile(h.kit);
      h.profs = {};
      Object.keys((p && p.profs) || {}).forEach(k => { h.profs[profName(k)] = p.profs[k]; });
      // 旧存档：以前「一个自选熟练项」只是记在 notes 上，现在补成待选
      const owed = Number((h.notes || {}).proficiency) || 0;
      if (owed) {
        h.pending = h.pending || [];
        for (let i = 0; i < owed; i++) h.pending.push({ type: "prof", level: h.level || 1, noRepeat: false });
        delete h.notes.proficiency;
      }
    }
    return h.profs;
  }

  /* ---------- 本局的「队伍档案」 ----------
   * 进入单局：先把战斗原型的档案收起来，换上本局的；离开时换回。 */
  let stash = null;
  function stashSandbox() {
    if (stash) return;
    stash = { ledger: LEDGER.save(), bag: clone(state.bag || { items: [] }), kuizhi: Number(state.kuizhi) || 0 };
  }
  function loadWorld(run) {
    state.bag = clone(run.world.bag);
    state.kuizhi = run.world.kuizhi;
    LEDGER.load(run.world.ledger);
  }
  function syncWorld(run) {
    if (!stash) return;   // 不在单局里：场上的档案不是本局的，不能写回
    run.world = { ledger: LEDGER.save(), bag: clone(state.bag || { items: [] }), kuizhi: Number(state.kuizhi) || 0 };
  }
  function enterRunMode(run) {
    stashSandbox();
    setXpRequirementScale(C.xpReqScale);
    if (run && run.world) {
      loadWorld(run);
      // 旧版存档升级上来时还没有主线：按当前幕补上
      if (!run.main && run.stage !== "over") {
        run.main = makeTask(run, ROGUE_MAIN_TASK, "main");
        run.main.done = false;
      }
    }
  }
  /** 存档：先把场上的物资写回本局 */
  function save(run) {
    syncWorld(run);
    return SaveStore.saveRun(run);
  }
  function leaveRunMode(run) {
    if (run) syncWorld(run);
    setXpRequirementScale(1);
    state.exhaustTier = 0;
    state.weaponMods = null;
    if (stash) {
      state.bag = stash.bag;
      state.kuizhi = stash.kuizhi;
      LEDGER.load(stash.ledger);
      stash = null;
    }
  }

  const water = () => ledgerWater();
  const hoursAwake = () => Number(LEDGER.hours) || 0;
  function supplies() {
    const food = {};
    FOOD_ORDER.forEach(id => { food[id] = bagCount(id); });
    return { water: water(), kuizhi: Number(state.kuizhi) || 0, food, foodTotal: FOOD_ORDER.reduce((s, id) => s + food[id], 0) };
  }

  /* ---------- 开局 ---------- */
  function newRun(opt) {
    opt = opt || {};
    if (opt.solo) checkSoloSetup(opt);
    const run = SaveStore.newRun({ party: opt.party, seed: opt.seed, solo: !!opt.solo });
    // 单人模式：一名主角 + 三名伙伴（支援技能）+ 自选的第二副职责
    run.solo = !!opt.solo;
    run.partners = run.solo ? opt.partners.slice() : [];
    run.actDay = 0;
    run.taskNo = 0;
    run.boardNo = 0;
    run.tasksDone = 0;
    run.extra = false;
    run.smithUses = {};      // 工匠 id → 在他那里升级过几次
    run.smithClaimed = {};   // 工匠 id → 已经领过的图纸 id
    run.blueprints = [];     // 领到、还没装上的图纸 id
    run.installed = {};      // 武器 kit → 装上的图纸 id
    run.party.forEach(h => {
      h.weaponLevels = {};
      h.weapons.forEach(k => { h.weaponLevels[k] = 1; });
      h.attrPicks = [];
      h.rolePicks = {};
      h.pending = [];
      h.notes = {};
      heroProfs(h);
      if (run.solo) { h.role2 = opt.role2; h.role2Picks = []; }
      // 单人模式：主角开局坚毅生命上限 +15（前期一个人太容易倒）
      if (run.solo && h === run.party[0]) h.shpBonus = SOLO.shpBonus || 0;
    });
    // 本局的物资：档案从零开始
    enterRunMode();
    LEDGER.reset();
    state.bag = { items: [] };
    state.kuizhi = C.start.kuizhi;
    setLedgerWater(C.start.water);
    Object.keys(C.start.items || {}).forEach(id => bagAdd(id, C.start.items[id]));
    syncWorld(run);
    log(run, `出发：${run.party.map(h => heroName(h.kit)).join("、")}（种子 ${run.seed}）`);
    startAct(run);
    run.smiths = [];         // 开局第一块任务板还没完成过任务，不来工匠
    return run;
  }

  function startAct(run) {
    run.actDay = 0;
    run.main = makeTask(run, ROGUE_MAIN_TASK, "main");
    run.main.done = false;
    log(run, `第 ${run.act} 幕 · ${region(run)}：主线「${run.main.goal.split("。")[0]}」，期限 ${C.daysPerAct} 天。`);
    makeBoard(run);
  }

  /* ---------- 任务 ---------- */
  function makeTask(run, tpl, slot) {
    return withRng(`${run.seed}:task:${run.act}:${run.boardNo}:${slot}`, () => {
      const n = between(tpl.nodes[0], tpl.nodes[1]);
      const types = [];
      for (let i = 0; i < n - 1; i++) {
        // 同一种非战斗节点不连着出
        const prev = types[i - 1];
        types.push(pickWeighted(tpl.mix || { battle: 1 }, prev && prev !== "battle" ? [prev] : null));
      }
      types.push(tpl.elite ? "elite" : "battle");
      // 每个任务正好一个休息点（能长休的地方）：插在中间，不在第一站、也不在最后一站
      types.splice(between(1, types.length - 1), 0, "rest");
      const weather = rollTaskWeather(run);
      insertChecks(types);
      const cols = buildRoute(types, tpl);   // 放在最后掷：主干、天气和以前完全一样
      return {
        weather,
        kind: tpl.kind, name: tpl.name,
        goal: tpl.goal.replace("{region}", region(run)),
        days: tpl.days, diff: tpl.diff || 0, key: !!tpl.key,
        reward: clone(tpl.reward), supply: clone(tpl.supply || {}),
        nodeTypes: types,    // 主干：任务板上不给玩家看
        cols                 // 路线图：每一列可选的节点（接下任务后在地图上一列一列选）
      };
    });
  }

  /** 路线图（类似《杀戮尖塔》，从左到右）：主干的每一站是一列，中间的列多给 1–2 个可选节点。
   *  第一列、休息点那一列、最后一列（战斗 / 精英战）都只有一个节点：
   *  所以不管怎么走都正好经过一次休息点，终点都是任务目标。相邻两列的连线见 routeLinks。 */
  const ROUTE = { width: [[.25, 1], [.8, 2], [1, 3]], extra: { check: 1 } };
  function buildRoute(types, tpl) {
    return types.map((t, c) => {
      if (c === 0 || t === "rest" || c === types.length - 1) return [t];
      const r = Math.random();
      const k = ROUTE.width.find(([p]) => r < p)[1];
      const opts = [t];
      const weights = Object.assign({}, tpl.mix || { battle: 1 }, ROUTE.extra);
      delete weights.rest;
      for (let guard = 0; opts.length < k && guard < 8; guard++) {
        const x = pickWeighted(weights, opts);
        if (opts.indexOf(x) < 0) opts.splice(Math.floor(Math.random() * (opts.length + 1)), 0, x);
      }
      return opts;
    });
  }
  /** 第 c 列有 k 个节点、第 c+1 列有 m 个：按上下位置比例连线，互不交叉。返回 [[i, j], …] */
  function routeLinks(k, m) {
    const out = [];
    for (let i = 0; i < k; i++) for (let j = 0; j < m; j++) {
      const lo = Math.max(i / k, j / m), hi = Math.min((i + 1) / k, (j + 1) / m);
      if (hi - lo > 1e-9) out.push([i, j]);
    }
    return out;
  }
  /** 当前这一列可以选哪些节点（由上一列选的那个决定） */
  function nodeChoices(run) {
    const t = run && run.task;
    if (!t || run.stage !== "task" || !t.cols) return [];
    const c = t.index, col = t.cols[c] || [];
    if (t.nodes[c]) return [];
    const prev = c > 0 ? (t.pick || [])[c - 1] : null;
    const ok = c === 0 || prev == null ? col.map((_, i) => i)
      : routeLinks(t.cols[c - 1].length, col.length).filter(([i]) => i === prev).map(([, j]) => j);
    return ok.map(i => ({ i, type: col[i] }));
  }
  /** 在路线图上选下一站 */
  function chooseNode(run, i) {
    const ok = nodeChoices(run);
    if (!ok.length) throw new Error("现在不用选路线");
    const hit = ok.find(o => o.i === Number(i));
    if (!hit) throw new Error("这一站从上一站走不过去");
    const t = run.task;
    t.pick = t.pick || [];
    t.pick[t.index] = hit.i;
    t.nodes[t.index] = { type: hit.type, done: false };
    const notes = [`前往：${NODE[hit.type] ? NODE[hit.type].label : hit.type}。`];
    return logAll(run, notes);
  }

  /** 熟练项检定插在两场战斗之间（「战斗 / 精英战」紧挨着的地方），每处按概率插一个 */
  function insertChecks(types) {
    const K = ROGUE_CHECKS;
    let added = 0;
    for (let i = 1; i < types.length && added < K.maxPerTask; i++) {
      const fight = (t) => t === "battle" || t === "elite";
      if (fight(types[i - 1]) && fight(types[i]) && Math.random() < K.insertChance) {
        types.splice(i, 0, "check");
        added += 1;
        i += 1;
      }
    }
    return types;
  }

  function makeBoard(run) {
    run.boardNo = (run.boardNo || 0) + 1;
    const pool = ROGUE_TASKS.slice();
    const tasks = [];
    withRng(`${run.seed}:board:${run.act}:${run.boardNo}`, () => {
      while (tasks.length < C.sideTasksOnBoard && pool.length) {
        tasks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      }
    });
    run.board = tasks.map((tpl, i) => makeTask(run, tpl, i));
    rollBoardSmiths(run);
    run.stage = "board";
    return run.board;
  }

  /** 这个任务现在能不能接。null 表示可以，否则是原因 */
  function taskBlocked(run, task) {
    if (!task) return "没有这个任务";
    if (task.key && run.main && run.main.done) return "主线已完成";
    if (task.days > daysLeft(run)) return `剩余天数不够（还剩 ${daysLeft(run)} 天）`;
    return null;
  }
  /** 接下这个支线之后，主线还来不来得及。来不及返回提示 */
  function taskWarning(run, task) {
    if (!task || task.key || !run.main || run.main.done) return null;
    const left = daysLeft(run) - task.days - C.restDays;
    return left < run.main.days ? `接下后只剩 ${Math.max(0, left)} 天，主线（${run.main.days} 天）将来不及完成` : null;
  }

  /* ---------- 报酬与补给（按人数、按幕，见 rogue-data.js · 经济） ---------- */
  const headScale = (run) => run.party.length / Math.max(1, C.perHeadBase || run.party.length);
  function actScale(run) {
    const list = C.rewardActScale || [1];
    return list[Math.min(list.length, run.act) - 1] || 1;
  }
  /** 这个任务现在实际给多少：{ kuizhi, xp, water, items } */
  function taskPay(run, task) {
    const h = headScale(run);
    const s = task.supply || {};
    const items = {};
    Object.keys(s.items || {}).forEach(id => { items[id] = Math.max(0, Math.round(s.items[id] * h)); });
    return {
      kuizhi: Math.round((task.reward.kuizhi || 0) * h * actScale(run) / 100) * 100,
      xp: task.reward.xp || 0,
      water: Math.round((s.water || 0) * h / 100) * 100,
      items
    };
  }

  /** which：支线在任务板上的序号，或 "main" */
  function acceptTask(run, which) {
    const task = which === "main" ? run.main : (run.board || [])[which];
    const why = taskBlocked(run, task);
    if (why) throw new Error(why);
    run.taskNo += 1;
    // 路线图：只有一个选项的列直接定下，有岔路的列走到那里再选（chooseNode）
    const cols = task.cols || task.nodeTypes.map(t => [t]);
    run.task = Object.assign(clone(task), {
      index: 0, cols: clone(cols),
      nodes: cols.map(col => col.length === 1 ? { type: col[0], done: false } : null),
      pick: cols.map(col => col.length === 1 ? 0 : null)
    });
    run.board = null;
    run.stage = "task";
    const notes = [];
    const pay = taskPay(run, task);
    if (pay.water) setLedgerWater(water() + pay.water);
    Object.keys(pay.items).forEach(id => bagAdd(id, pay.items[id]));
    notes.push(`${task.key ? "开始执行主线" : "接下任务「" + task.name + "」"}：${task.goal.split("。")[0]}。` +
      `委托方提供 ${pay.water} ml 水${Object.keys(pay.items).filter(id => pay.items[id]).map(id => "、" + ITEM_CATALOG[id].name + "×" + pay.items[id]).join("")}。`);
    arriveAtNode(run, notes);
    return logAll(run, notes);
  }

  function currentNode(run) {
    if (run.stage !== "task" || !run.task) return null;
    return run.task.nodes[run.task.index] || null;
  }

  /* ---------- 时间与力竭 ---------- */
  /** 推进时间（计入距上次长休）。满 80 小时队伍死亡 → 本局结束 */
  function passHours(run, hours, notes) {
    if (!hours) return;
    ledgerAdvance(hours, notes);
    if (exhaustTierFromHours(hoursAwake()) >= 4) {
      run.party.slice().forEach(h => killHero(run, h, notes, "力竭致死"));
      endRun(run, false, "力竭致死：太久没能好好睡一觉。");
    }
  }
  function arriveAtNode(run, notes) {
    if (run.task.index > 0) passHours(run, C.hours.travel, notes);
    const left = nodeChoices(run);
    if (left.length === 1) chooseNode(run, left[0].i);   // 只有一条路：直接走
  }

  /* ---------- 把队伍摆到场上（战斗，或者战斗外要用到规则的时候） ---------- */
  function applyHero(u, h) {
    u.weaponLevels = Object.assign({}, u.weaponLevels || {}, h.weaponLevels || {});
    if (h.attrs) u.attrs = Object.assign({}, h.attrs);
    u.rolePicks = Object.assign({}, h.rolePicks || {});
    u.role2 = h.role2 || null;
    u.role2Picks = (h.role2Picks || []).slice();
    u.level = h.level || 1;
    u.xp = h.xp || 0;
    u.attrPoints = 0;               // 属性点在单局里走升级选择，不用后台的可分配点
    u.cyberPlan = h.cyber ? Object.assign({}, h.cyber) : null;   // 义体改造（growth.js 按方案重建血量层）
    u.shpBonus = Number(h.shpBonus) || 0;   // 单人模式主角：坚毅生命上限 +15
    applyLevelStats(u);
    if (Array.isArray(h.hp)) {
      (u.layers || []).forEach((l, i) => {
        const s = h.hp[i];
        if (s && s.type === l.type) l.current = Math.max(0, Math.min(Number(l.max) || 0, Number(s.current) || 0));
      });
    }
    if (h.shp != null) u.shp = Math.max(0, Math.min(Number(u.shpMax) || 0, Number(h.shp) || 0));
    else if (u.shpBonus) u.shp = Number(u.shpMax) || 0;   // 第一场：带着加成后的满坚毅出发
    u.dying = false;
    u.upOnShp = false;
  }
  function applyPartyToField(run, notes) {
    // 旧的单人存档也补上主角的坚毅加成
    if (run.solo && run.party[0] && run.party[0].shpBonus == null) run.party[0].shpBonus = SOLO.shpBonus || 0;
    run.party.forEach(h => {
      const u = findKit(h.kit, state.units);
      if (!u) return;
      applyHero(u, h);
      u.profs = clone(heroProfs(h));   // 战斗里的检定（改写炮台）按本局的熟练等级
      // 耐久为 0 的武器拿在手里也用不了（手册第五章）
      const held = heldWeaponKit(u);
      if (held && weaponBroken(held)) disarmBrokenWeapon(u, notes);
    });
    state.exhaustTier = Math.min(3, exhaustTierFromHours(hoursAwake()));
    state.lootByRank = C.lootByRank || null;
    state.lootByKit = C.lootByKit || null;
    state.weaponMods = weaponModsOf(run);
    if (typeof syncBpAll === "function") syncBpAll();
  }
  function captureHero(u, h) {
    h.level = u.level || 1;
    h.xp = u.xp || 0;
    h.hp = persistentLayers(u);
    h.shp = Math.max(0, Number(u.shp) || 0);
  }
  /** 战斗外：把队伍摆上场，做完 fn 再把状态收回来 */
  function withParty(run, fn) {
    BattleSim.setup({ party: run.party.map(h => h.kit), enemies: [], before: () => applyPartyToField(run) });
    const out = fn();
    const notes = [];
    captureParty(run, notes);
    return { out, notes };
  }

  /* ---------- 升级（手册第三章） ---------- */
  function queueLevelRewards(h, from, to, notes, run) {
    for (let L = from + 1; L <= to; L++) {
      // 单人模式：每 4 级额外一次六维属性，每 5 级从第二副职责里额外学一个技能
      if (run && run.solo) {
        h.pending = h.pending || [];
        if (L % SOLO.attrEvery === 0) h.pending.push({ type: "attr", level: L, noRepeat: false, solo: true });
        if (h.role2 && L % SOLO.role2Every === 0 && role2Left(h).length) h.pending.push({ type: "role2", level: L });
      }
      (ROGUE_LEVEL_REWARDS[L] || []).forEach(r => {
        if (r.type === "note") {
          h.notes = h.notes || {};
          h.notes[r.key] = (h.notes[r.key] || 0) + 1;
          notes.push(`${heroName(h.kit)} ${L} 级：获得${r.text}（系统尚未实装，先记下）。`);
        } else if (r.type === "role" && roleOptionsFor(h, L).length <= 1) {
          // 只有一个合规选项（10、15 级按路线；角色卡本来是专精）：直接给
          const x = roleOptionsFor(h, L)[0];
          if (x) {
            h.rolePicks = Object.assign({}, h.rolePicks || {}, { [L]: x });
            notes.push(`${heroName(h.kit)} ${L} 级：学会职责技能「${(roleSkillDef(x.role, x.n) || {}).name || x.role + x.n}」（${x.role}${"一二三四"[x.n - 1]}）。`);
          }
        } else {
          h.pending = h.pending || [];
          h.pending.push({ type: r.type, level: L, noRepeat: !!r.noRepeat });
        }
      });
    }
  }
  function killHero(run, h, notes, why) {
    if (run.party.indexOf(h) < 0) return;
    SaveStore.killHero(run, h.kit);
    const ws = h.weapons.map(heroName).join("、");
    notes.push(`${heroName(h.kit)} ${why || "永久死亡"}${ws ? "，" + ws + " 随之离开队伍" : ""}。`);
  }
  /** 场上的状态写回单局：升级、升级奖励、血量；死亡的角色连同武器人永久离队 */
  function captureParty(run, notes) {
    run.party.slice().forEach(h => {
      const u = findKit(h.kit, state.units);
      if (!u) return;
      const from = h.level || 1;
      tryLevelUp(u);
      if (u.dead) { killHero(run, h, notes, "永久死亡"); return; }
      if (u.level > from) {
        notes.push(`${u.name} 升到 ${u.level} 级。`);
        queueLevelRewards(h, from, u.level, notes, run);
      }
      captureHero(u, h);
    });
    return notes;
  }

  /** 单局角色在某个里程碑能拿的职责技能（按手册的专精规则，见 growth.js · roleChoicesAt） */
  function roleOptionsFor(h, level) {
    const u = spawnLiveCard(cardOf(h.kit), 1);
    u.level = level;
    u.rolePicks = Object.assign({}, h.rolePicks || {});
    return roleChoicesAt(u, level);
  }

  /** 第二副职责还没学的技能序号（一到 role2MaxSkill） */
  function role2Left(h) {
    const out = [];
    for (let n = 1; n <= SOLO.role2MaxSkill; n++) if ((h.role2Picks || []).indexOf(n) < 0) out.push(n);
    return out;
  }

  /** 还没做的升级选择：[{ kit, name, index, choice }] */
  function pendingChoices(run) {
    const out = [];
    run.party.forEach(h => (h.pending || []).forEach((p, i) => out.push({ kit: h.kit, name: heroName(h.kit), index: i, choice: p })));
    return out;
  }
  /** 一个升级选择有哪些选项：[{ value, label, hint }] */
  function choiceOptions(run, kit, index) {
    const h = run.party.find(x => x.kit === kit);
    const p = h && h.pending && h.pending[index];
    if (!p) return [];
    if (p.type === "attr") {
      const attrs = h.attrs || (cardOf(kit) || {}).attrs || {};
      return Object.keys(ATTR_NAMES)
        .filter(k => !(p.noRepeat && (h.attrPicks || []).indexOf(k) >= 0))
        .map(k => ({ value: k, label: `${ATTR_NAMES[k]} +1`, hint: `现在 ${attrs[k] || 0}` }));
    }
    if (p.type === "role2") {
      const u = spawnLiveCard(cardOf(kit), 1);
      u.level = p.level;
      return role2Left(h).map(n => {
        const def = roleSkillDef(h.role2, n, u) || {};
        return { value: n, label: `第二副职责 ${h.role2} ${"一二三四"[n - 1]}：${def.name || "?"}`, hint: def.hint || "" };
      });
    }
    if (p.type === "prof") {
      const have = heroProfs(h);
      const opts = PROF_LIST.filter(n => (have[n] || 0) < PROF_MAX)
        .map(n => ({ value: n, label: have[n] ? `${n} ${have[n]} → ${have[n] + 1} 级` : `${n}（新学）`, hint: profCategory(n) }));
      // 已有的排前面（升级），新学的按手册顺序
      return opts.filter(o => have[o.value]).concat(opts.filter(o => !have[o.value]));
    }
    if (p.type === "role") {
      const u = spawnLiveCard(cardOf(kit), 1);
      u.level = p.level;
      u.rolePicks = Object.assign({}, h.rolePicks || {});
      const prim = u.roles && u.roles.primary;
      return roleChoicesAt(u, p.level).map(x => {
        const def = roleSkillDef(x.role, x.n, u) || {};
        // 5 级这一选决定路线，写清楚之后会拿到什么
        const path = p.level !== 5 ? ""
          : x.role === prim && x.n === 2
            ? `走专精（放弃副职责）：之后 10 级${prim}三、15 级${prim}四（最强的技能四只有专精能拿）`
            : `不走专精：之后 10 级${prim}二、15 级${prim}三`;
        return { value: x, label: `${x.role === prim ? "主职责" : "副职责"} ${x.role} ${"一二三四"[x.n - 1]}：${def.name || "?"}`,
          hint: [path, def.hint].filter(Boolean).join(" · ") };
      });
    }
    return [];
  }
  function choose(run, kit, index, value) {
    const h = run.party.find(x => x.kit === kit);
    const p = h && h.pending && h.pending[index];
    if (!p) throw new Error("没有这个升级选择");
    const ok = choiceOptions(run, kit, index).some(o => JSON.stringify(o.value) === JSON.stringify(value));
    if (!ok) throw new Error("这个选项不可选");
    const notes = [];
    if (p.type === "attr") {
      h.attrs = Object.assign({}, h.attrs || (cardOf(kit) || {}).attrs || {});
      h.attrs[value] = (Number(h.attrs[value]) || 0) + 1;
      h.attrPicks = (h.attrPicks || []).concat(value);
      notes.push(`${heroName(kit)} ${ATTR_NAMES[value]} +1。`);
    } else if (p.type === "role2") {
      h.role2Picks = (h.role2Picks || []).concat(Number(value));
      notes.push(`${heroName(kit)} 学会第二副职责技能：${(roleSkillDef(h.role2, Number(value)) || {}).name || h.role2 + value}。`);
    } else if (p.type === "prof") {
      const have = heroProfs(h);
      have[value] = (have[value] || 0) + 1;
      notes.push(`${heroName(kit)} 熟练项「${value}」${have[value] > 1 ? "升到 " + have[value] + " 级" : "（新学，一级）"}。`);
    } else if (p.type === "role") {
      h.rolePicks = Object.assign({}, h.rolePicks || {}, { [p.level]: value });
      notes.push(`${heroName(kit)} 学会职责技能：${(roleSkillDef(value.role, value.n) || {}).name || value.role + value.n}。`);
    }
    h.pending.splice(index, 1);
    // 属性变了，血量上限等跟着变：摆上场重新算一次
    if (p.type === "attr") withParty(run, () => null);
    return logAll(run, notes);
  }

  /* ---------- 战场上的配置物与地形（rogue-data.js · ROGUE_BATTLEFIELD） ---------- */
  function rollBattlefield(run, isBoss, zoneMode) {
    const B = typeof ROGUE_BATTLEFIELD !== "undefined" ? ROGUE_BATTLEFIELD : null;
    if (!B) return [];
    const i = Math.max(0, Math.min((run.act || 1) - 1, B.chanceByAct.length - 1));
    const chance = isBoss ? (B.bossChance || 0) : B.chanceByAct[i];
    if (Math.random() >= chance) return [];
    const [lo, hi] = B.countByAct[Math.min(i, B.countByAct.length - 1)];
    const want = between(lo, hi);
    const reg = region(run);
    let pool = B.pool.filter(x => (!x.regions || x.regions.indexOf(reg) >= 0) && (run.act || 1) >= (x.minAct || 1));
    const zm = Number(zoneMode) || 2;
    const gapKeys = zm === 3 ? ["1-2", "2-3"] : ["1-2"];
    const usedField = new Set(), usedGap = new Set(), usedHigh = new Set();
    const out = [];
    for (let guard = 0; guard < 20 && out.length < want && pool.length; guard++) {
      const total = pool.reduce((s, x) => s + (x.weight || 1), 0);
      let r = Math.random() * total, k = 0;
      while (k < pool.length - 1 && r >= (pool[k].weight || 1)) { r -= pool[k].weight || 1; k++; }
      const item = pool.splice(k, 1)[0];
      if (item.type === "gap") {
        const free = gapKeys.filter(g => !usedGap.has(g));
        if (!free.length) continue;
        const key = pick(free); usedGap.add(key);
        out.push({ type: "gap", what: item.what, key, name: item.name });
      } else if (item.type === "field" && item.what === "highland") {
        // 高地和其他区域效果共存：不占这一区的场地，也不会被别的场地挤掉
        const free = [1, 2, 3].slice(0, zm).filter(z => !usedHigh.has(z));
        if (!free.length) continue;
        const zone = pick(free); usedHigh.add(zone);
        out.push({ type: "field", what: item.what, zone, name: item.name });
      } else if (item.type === "field") {
        const free = [1, 2, 3].slice(0, zm).filter(z => !usedField.has(z));
        if (!free.length) continue;
        const zone = pick(free); usedField.add(zone);
        out.push({ type: "field", what: item.what, zone, name: item.name });
      } else {
        out.push({ type: "prop", what: item.what, faction: item.faction || null, zone: between(1, zm), name: item.name });
      }
    }
    return out;
  }
  /** 任务带的天气（rogue-data.js · ROGUE_TASK_WEATHER）：null 表示不带 */
  function rollTaskWeather(run) {
    const W = typeof ROGUE_TASK_WEATHER !== "undefined" ? ROGUE_TASK_WEATHER : null;
    if (!W || Math.random() >= W.chance) return null;
    const list = W.byRegion[region(run)] || Object.keys(W.byRegion).reduce((a, k) => a.concat(W.byRegion[k]), []);
    return list.length ? pick(list) : null;
  }

  /* ---------- 战斗 ---------- */
  /** 当前节点 / 首领的战斗配置（给 BattleSim.setup 或战斗画面用） */
  function battleSpec(run) {
    const partyKits = run.party.map(h => h.kit);
    const before = () => { applyPartyToField(run); state.openingBreaks = openingBreaks(run); state.solo = soloBattleInfo(run); state.scoreAct = run.act; };
    if (run.stage === "boss") {
      const key = `${run.seed}:boss:${run.act}`;
      const enc = withRng(key, () => {
        const pool = (C.bosses[region(run)] || []).filter(Boolean);
        const all = Object.keys(C.bosses).reduce((a, k) => a.concat(C.bosses[k]), []);
        return rollBossEncounter(pick(pool.length ? pool : all), { region: region(run), tokens: C.bossEscortTokens });
      });
      enc.features = withRng(key + ":field", () => rollBattlefield(run, true, enc.zoneMode));
      return { kind: "boss", title: `第 ${run.act} 幕 · 首领战`, party: partyKits, encounter: enc,
        level: Math.max(1, levelRange(run)[1] + (C.bossLevelOffset || 0)), seed: key, before, retreat: C.bossRetreat };
    }
    if (run.ambush && run.stage === "task") {
      // 遭遇战：3 枚代币，敌人不分地区、不分阵营；天气照这一站
      const key = `${run.seed}:ambush-fight:${run.taskNo}:${run.task.index}`;
      const enc = withRng(key, () => {
        const opt = { region: region(run), anyRegion: true, mixed: true, tokens: AMB.tokens };
        if (run.task.weather) opt.weather = run.task.weather;
        return rollEncounter(opt);
      });
      enc.features = withRng(key + ":field", () => rollBattlefield(run, false, enc.zoneMode));
      const ambushBefore = () => { before(); state.ambush = true; };
      return {
        kind: "ambush", title: `${run.task.name} · 遭遇战（休息点被偷袭）`,
        party: partyKits, encounter: enc, level: enemyLevel(run, run.task.diff), seed: key, before: ambushBefore, retreat: true
      };
    }
    const node = currentNode(run);
    if (!node || (node.type !== "battle" && node.type !== "elite")) return null;
    const key = `${run.seed}:fight:${run.taskNo}:${run.task.index}`;
    const enc = withRng(key, () => {
      const opt = { region: region(run) };
      if (NODE[node.type].tokens) opt.tokens = NODE[node.type].tokens;
      if (run.task.weather) opt.weather = run.task.weather;   // 带天气的任务：每一场都是这种天气
      return rollEncounter(opt);
    });
    enc.features = withRng(key + ":field", () => rollBattlefield(run, false, enc.zoneMode));
    const bonus = run.task.diff + (node.type === "elite" ? C.eliteLevelBonus : 0);
    return {
      kind: node.type,
      title: `${run.task.name} · 第 ${run.task.index + 1} 站${node.type === "elite" ? "（精英）" : ""}`,
      party: partyKits, encounter: enc, level: enemyLevel(run, bonus), seed: key, before, retreat: true
    };
  }

  /** 单人模式这场战斗要用到的：主角、伙伴（等级、武器等级都和主角一样）、已经用过的支援 */
  function soloBattleInfo(run) {
    if (!run.solo || !run.party[0]) return null;
    const h = run.party[0];
    const wl = Math.max(1, ...Object.values(h.weaponLevels || {}).map(Number).filter(x => x > 0), 1);
    return { heroKit: h.kit, partners: run.partners.slice(), level: h.level || 1, weaponLevel: wl, used: [],
      bank: Math.min(SOLO.supportMax || 99, Math.max(0, Number(run.supportBank) || 0)), earned: 0, pool: 0, scoreSeen: 0 };
  }

  /** 战斗结束后调用。outcome：win / lose / retreat */
  function finishBattle(run, outcome) {
    const notes = [];
    const boss = run.stage === "boss";
    // 单人：这场没用完的支援次数带到之后的战斗
    if (run.solo && state.solo && typeof soloSupportInfo === "function") {
      const info = soloSupportInfo();
      if (info) {
        run.supportBank = info.left;
        if (info.left) notes.push(`支援次数还剩 ${info.left} 次，带到之后的战斗。`);
      }
    }
    ledgerAfterBattle(notes);                 // 手册：耐久结算、濒死恢复到 1 点生命、记下武器人伤势
    if (run.solo && outcome === "win") {
      // 单人模式：击杀经验照常，每场胜利再固定 +50
      run.party.forEach(h => {
        const u = findKit(h.kit, state.units);
        if (!u || u.dead) return;
        u.xp = (u.xp || 0) + SOLO.battleXp;
        notes.push(`${u.name} 单人模式战斗经验 +${SOLO.battleXp}。`);
      });
    }
    const ambush = !!run.ambush && !boss;
    if (ambush && outcome === "win") {
      // 遭遇战胜利：每人额外 50 × 敌人等级 经验
      const lv = enemyLevel(run, run.task.diff);
      const xp = AMB.xpPerLevel * lv;
      run.party.forEach(h => {
        const u = findKit(h.kit, state.units);
        if (!u || u.dead) return;
        u.xp = (u.xp || 0) + xp;
        notes.push(`${u.name} 遭遇战胜利经验 +${xp}。`);
      });
    }
    captureParty(run, notes);
    run.party.forEach(h => { delete h.pendingBreaks; });   // 检定受伤的击破已在开场结算
    if (ambush) {
      run.ambush = null;
      if ((outcome === "lose" || !run.party.length) && C.wipeEndsRun) {
        notes.push("团灭。本局结束。");
        endRun(run, false, "在休息点被偷袭，全队倒下。");
        return logAll(run, notes);
      }
      if (outcome === "win") {
        notes.push("打退了偷袭的敌人，总算可以睡下了。");
        doLongRest(run, notes);
      } else {
        notes.push("撤退：没能在这里休息，连夜离开。");
        passHours(run, NODE.battle.hours, notes);
      }
      if (run.stage !== "over") advanceNode(run, notes);
      return logAll(run, notes);
    }
    const node = currentNode(run);
    passHours(run, boss ? NODE.elite.hours : NODE[(node && node.type) || "battle"].hours, notes);
    if (run.stage === "over") return logAll(run, notes);
    if ((outcome === "lose" || !run.party.length) && C.wipeEndsRun) {
      notes.push("团灭。本局结束。");
      endRun(run, false, boss ? `倒在第 ${run.act} 幕的首领面前。` : "全队倒在了任务途中。");
      return logAll(run, notes);
    }
    if (boss) {
      notes.push(`击败第 ${run.act} 幕首领。`);
      run.stage = run.act === C.acts && !run.extra ? "victory" : run.act >= totalActs(run) ? "over" : "interlude";
      if (run.stage === "over") endRun(run, true, `连额外的第 ${run.act} 幕也打穿了。`);
      return logAll(run, notes);
    }
    if (outcome === "retreat") notes.push("撤退：这一站的敌人没有解决，绕开继续前进。");
    advanceNode(run, notes);
    return logAll(run, notes);
  }

  /* ---------- 节点推进 ---------- */
  function advanceNode(run, notes) {
    const node = currentNode(run);
    if (node) node.done = true;
    run.task.index += 1;
    if (run.task.index >= run.task.nodes.length) completeTask(run, notes);
    else arriveAtNode(run, notes);
    return notes;
  }
  /** 商店、工匠这类节点：逛完了继续走 */
  function leaveNode(run) {
    const node = currentNode(run);
    if (!node || ["shop", "smith", "clinic"].indexOf(node.type) < 0) throw new Error("这里没有可以离开的节点");
    const notes = [];
    passHours(run, NODE[node.type].hours, notes);
    if (run.stage !== "over") advanceNode(run, notes);
    return logAll(run, notes);
  }

  /* ---------- 熟练项检定（手册第一章；事件内容占位） ---------- */
  const CHECK_DIFFS = ["easy", "normal", "hard", "extreme"];
  /** 当前检定节点的内容：难度、熟练项、会不会受伤、奖励。到这一站时按种子定下来，存在节点上 */
  function checkInfo(run) {
    const node = currentNode(run);
    if (!node || node.type !== "check") return null;
    if (!node.check) {
      const K = ROGUE_CHECKS;
      node.check = withRng(`${run.seed}:check:${run.taskNo}:${run.task.index}`, () => {
        const w = K.weightsByAct[Math.min(K.weightsByAct.length, run.act) - 1];
        const keys = Object.keys(w).filter(k => w[k] > 0);
        let r = Math.random() * keys.reduce((a, k) => a + w[k], 0);
        let diff = keys[keys.length - 1];
        for (const k of keys) { r -= w[k]; if (r < 0) { diff = k; break; } }
        const injure = Math.random() < K.injure.chance;
        const prof = pick(K.profs);
        return { diff, prof, injure, reward: K.diffs[diff].reward + (injure ? K.injure.bonus : 0) };
      });
    }
    const c = node.check;
    const dmg = ROGUE_CHECKS.injure.dmgByAct[Math.min(ROGUE_CHECKS.injure.dmgByAct.length, run.act) - 1];
    return Object.assign({}, c, { diffName: ROGUE_CHECKS.diffs[c.diff].name, dmg: c.injure ? dmg.slice() : null,
      brk: c.injure ? ROGUE_CHECKS.injure.brk : 0 });
  }
  /** 成功率：熟练等级 0–3 × 难度。0 表示没有资格尝试 */
  function checkChance(diff, prof) {
    const row = ROGUE_CHECKS.chance[Math.max(0, Math.min(3, Number(prof) || 0))];
    return row[CHECK_DIFFS.indexOf(diff)] || 0;
  }
  /** 一名角色做当前检定的情况：熟练等级、优劣势、重掷、最终成功率 */
  function checkOdds(run, kit) {
    const info = checkInfo(run);
    const h = run.party.find(x => x.kit === kit);
    if (!info || !h) return null;
    const level = Math.min(PROF_MAX, heroProfs(h)[profName(info.prof)] || 0);
    const v = heroView(run, h);
    const perks = checkPerksFor(kit, info.prof, v.hp * 2 < v.hpMax);
    const base = checkChance(info.diff, level);
    // 优势：掷两次取好的；劣势：两次都要过；迎难直上：整个检定失败后再来一次
    let p = perks.adv ? 1 - (1 - base) * (1 - base) : perks.dis ? base * base : base;
    if (perks.reroll) p = 1 - (1 - p) * (1 - p);
    return { kit, name: v.name, level, base, chance: base ? p : 0, adv: perks.adv, dis: perks.dis,
      reroll: perks.reroll, softFail: perks.softFail, perkText: perks.text, hp: v.hp, hpMax: v.hpMax };
  }

  /** 失败受伤：随机属性的伤害按克制表打在检定者的血量层上，最少留 1 点生命；击破留到下一场战斗开场 */
  function injureHero(run, h, info, notes) {
    const K = ROGUE_CHECKS;
    let amount = between(info.dmg[0], info.dmg[1]);
    const element = pick(K.elements);
    if (info.softFail) amount = Math.max(1, Math.floor(amount / 2));
    const r = withParty(run, () => {
      const u = findKit(h.kit, state.units);
      if (!u) return null;
      const before = totalHp(u);
      const inner = [];
      applyTypedDot(u, amount, element, inner, `检定失败：${ELE[element]}属性伤害 ${amount}`);
      if (totalHp(u) <= 0) {
        // 不致死：留 1 点在最里层
        const last = (u.layers || []).filter(l => l.type !== "shield").slice(-1)[0];
        if (last) last.current = 1;
        u.dying = false;
        u.dead = false;
      }
      return { before, after: totalHp(u) };
    });
    notes.push(...r.notes);
    const lost = r.out ? r.out.before - r.out.after : 0;
    h.pendingBreaks = (h.pendingBreaks || []).concat([{ amount: info.brk, element }]);
    notes.push(`${heroName(h.kit)} 受伤：${ELE[element]}属性 ${amount} 点，实际损失 ${lost} 点生命` +
      `（剩 ${r.out ? r.out.after : "?"}）；下一场战斗开始时受到 ${info.brk} ${ELE[element]}属性击破。`);
    return { amount, element, lost };
  }
  /** 选一名角色进行检定：熟练等级读角色的熟练项，种族特长自动算 */
  function attemptCheck(run, kit) {
    const info = checkInfo(run);
    if (!info) throw new Error("当前节点不是检定");
    const h = run.party.find(x => x.kit === kit);
    if (!h) throw new Error("没有这名角色");
    const o = checkOdds(run, kit);
    if (!o.base) throw new Error(`${info.diffName}检定需要「${info.prof}」熟练项才能尝试`);
    const notes = [];
    const profText = o.level ? `「${info.prof}」${["", "一", "二", "三"][o.level]}级熟练` : `没有「${info.prof}」熟练`;
    const mod = o.adv ? "，优势" : o.dis ? "，劣势" : "";
    let ok = false, rerolled = false;
    // 每颗骰子记成 d100：掷出 ≤ 成功线（基础成功率 × 100）就算成功。画面按这些点数播检定动画
    const line = o.base * 100;
    const rolls = [];
    withRng(`${run.seed}:checkroll:${run.taskNo}:${run.task.index}:${kit}`, () => {
      const d100 = (label) => {
        const r = Math.random();
        const hit = r < o.base;
        let roll = Math.floor(r * 100) + 1;
        // 成功线不是整数（12.5）时，边上那一点按实际结果显示，概率不变
        if (hit && roll > line) roll = Math.max(1, Math.floor(line));
        if (!hit && roll <= line) roll = Math.floor(line) + 1;
        rolls.push({ roll, ok: hit, label });
        return hit;
      };
      const once = (tag) => {
        if (o.base >= 1) { rolls.push({ roll: null, ok: true, label: tag + "必定成功" }); return true; }
        if (!o.adv && !o.dis) return d100(tag);
        const a = d100(tag + (o.adv ? "优势 · 第 1 颗" : "劣势 · 第 1 颗"));
        const b = d100(tag + (o.adv ? "优势 · 第 2 颗" : "劣势 · 第 2 颗"));
        return o.adv ? a || b : a && b;
      };
      ok = once("");
      if (!ok && o.reroll) { rerolled = true; ok = once("迎难直上重掷 · "); }
    });
    run.lastCheck = { name: o.name, prof: info.prof, diffName: info.diffName, line, chance: o.chance, rolls, ok,
      adv: !!o.adv, dis: !!o.dis };
    notes.push(`${o.name} 进行${info.diffName}「${info.prof}」检定（${profText}${mod}，成功率 ${Math.round(o.chance * 1000) / 10}%）：` +
      (rerolled ? `失败，迎难直上重掷——${ok ? "成功" : "还是失败"}。` : ok ? "成功。" : "失败。"));
    const node = currentNode(run);
    node.check.result = { kit, prof: o.level, ok };
    if (ok) {
      state.kuizhi = (Number(state.kuizhi) || 0) + info.reward;
      notes.push(`获得 ${info.reward} 奎支（现有 ${state.kuizhi}）。`);
    } else if (info.injure) {
      withRng(`${run.seed}:checkhurt:${run.taskNo}:${run.task.index}`, () => injureHero(run, h, Object.assign({ softFail: o.softFail }, info), notes));
    } else {
      notes.push("没什么损失，继续前进。");
    }
    passHours(run, NODE.check.hours, notes);
    if (run.stage !== "over") advanceNode(run, notes);
    return logAll(run, notes);
  }
  /** 不检定，直接绕过去：没有奖励也不会受伤 */
  function skipCheck(run) {
    if (!checkInfo(run)) throw new Error("当前节点不是检定");
    const notes = ["没有冒险，绕了过去。"];
    passHours(run, NODE.check.hours, notes);
    if (run.stage !== "over") advanceNode(run, notes);
    return logAll(run, notes);
  }
  /** 战斗开场要结算的击破（检定受的伤）。battleSpec 的 before 里交给战斗，打完这场清掉 */
  function openingBreaks(run) {
    return run.party.filter(h => (h.pendingBreaks || []).length)
      .map(h => ({ kit: h.kit, breaks: h.pendingBreaks.map(b => Object.assign({}, b)) }));
  }

  /* ---------- 休息（手册第五章） ---------- */
  function restPlan(run) {
    return withParty(run, () => longRestNeeds({})).out;
  }
  function canLongRest(run) { return restPlan(run).ok; }
  /** 角色资料面板（skill-text.js）：把队伍摆上场算一份，不改动本局 */
  function sheetData(run) {
    if (typeof SkillText === "undefined") return [];
    return withParty(run, () => SkillText.sheetData()).out;
  }
  function doLongRest(run, notes, watch) {
    const r = withParty(run, () => ledgerLongRest({ hours: C.hours.longRest, watch: watch || null }, notes));
    notes.push(...r.notes);
    return r.out && r.out.ok;
  }
  /** 进下一站 / 首领战之前能短休的地方（休息点自己有短休按钮） */
  function restSpot(run) {
    if (run.stage === "boss") return run;
    const node = currentNode(run);
    return node && node.type !== "rest" ? node : null;
  }

  /** 进下一站 / 首领战之前也能短休（手册：1 小时，每人每天 2 次，熊兽人 1 次）。不限这一站几次，只看今天的次数 */
  function shortRestLeftAll(run) {
    return withParty(run, () => partyHeroes().filter(h => !h.dead).map(h => ({ kit: h.kit, name: h.name, left: shortRestLeft(h) }))).out;
  }
  function canShortRestBefore(run) {
    if (!restSpot(run)) return { ok: false, why: "这里不能短休" };
    const who = shortRestLeftAll(run);
    if (!who.some(x => x.left > 0)) return { ok: false, why: "今天大家的短休次数都用完了", who };
    return { ok: true, who };
  }
  function shortRestBeforeNode(run) {
    const can = canShortRestBefore(run);
    if (!can.ok) throw new Error(can.why);
    const notes = ["原地歇一会儿。"];
    const r = withParty(run, () => ledgerShortRest(null, notes));
    notes.push(...r.notes);
    return logAll(run, notes);
  }

  /* ---------- 遭遇战：休息点长休时被偷袭 ---------- */
  const AMB = C.ambush;
  /** 下一次在休息点长休被偷袭的概率 */
  function ambushChance(run) {
    return run.ambushChance == null ? AMB.base : Number(run.ambushChance);
  }
  /** 可以守夜的人：还活着的角色，以及他们的武器人 */
  function watchOptions(run) {
    return withParty(run, () => {
      const out = [];
      partyHeroes().filter(h => !h.dead).forEach(h => {
        out.push({ kit: h.kit, name: h.name, weapon: false });
        (h.linkedKits || []).forEach(k => out.push({ kit: k, name: weaponName(k), weapon: true, owner: h.name }));
      });
      return out;
    }).out;
  }

  /** 休息点。mode：long / short / leave。长休可以带 opt.watch（守夜者 kit） */
  function restAtNode(run, mode, opt) {
    const node = currentNode(run);
    if (!node || node.type !== "rest") throw new Error("当前节点不是休息点");
    if (run.ambush) throw new Error("正在遭遇战中");
    const notes = [];
    if (mode === "long") {
      if (!canLongRest(run)) throw new Error("补给不够长休");
      const watch = (opt && opt.watch) || null;
      if (watch && !watchOptions(run).some(w => w.kit === watch)) throw new Error("守夜的人不在队伍里");
      const chance = ambushChance(run);
      const hit = !watch && withRng(`${run.seed}:ambush:${run.taskNo}:${run.task.index}`, () => Math.random() < chance);
      if (hit) {
        // 恢复之前就被偷袭：先打，赢了再长休
        run.ambushChance = AMB.base;
        run.ambush = { chance };
        notes.push(`长休时被偷袭！（这次的概率 ${Math.round(chance * 100)}%）还没来得及恢复，敌人就摸了上来。`);
        return logAll(run, notes);
      }
      run.ambushChance = Math.min(1, chance + AMB.step);
      notes.push(watch ? "有人守夜，这一夜平安无事。" : "这一夜平安无事。");
      notes.push(`下次长休被偷袭的概率 ${Math.round(run.ambushChance * 100)}%。`);
      doLongRest(run, notes, watch);
    } else if (mode === "leave") {
      // 不休息直接走：拿一笔奎支，不花时间
      const pay = Number(C.restSkipKuizhi) || 0;
      state.kuizhi = (Number(state.kuizhi) || 0) + pay;
      notes.push(`没有停下休息，顺手做了点零活：获得 ${pay} 奎支（现有 ${state.kuizhi}）。`);
    } else {
      const r = withParty(run, () => ledgerShortRest(null, notes));
      notes.push(...r.notes);
    }
    advanceNode(run, notes);
    return logAll(run, notes);
  }

  /* ---------- 诊所：治疗与义体改造 ---------- */
  /** 现在能不能进诊所：诊所节点，或者任务之间回到城里 */
  function canClinic(run) {
    const node = currentNode(run);
    return !!(node && node.type === "clinic") || (run.stage === "camp" && !!C.campClinic);
  }
  /** 没改造时的肉体上限、改造率、可改造上限 */
  function cyberInfo(run, kit) {
    const h = run.party.find(x => x.kit === kit);
    if (!h) throw new Error("队伍里没有这个角色");
    const u = spawnLiveCard(cardOf(kit), 1);
    applyHero(u, Object.assign({}, h, { cyber: null, hp: null }));
    const fleshMax = (u.layers.find(l => l.type === "flesh") || {}).max || 0;
    const rate = cyberRateOf(u.attrs || h.attrs || (cardOf(kit) || {}).attrs, u.level);
    return { h, fleshMax, rate, limit: cyberConvertLimit(fleshMax, rate), current: normPlan(h.cyber) };
  }
  function normPlan(p) {
    p = p || {};
    return { armor: Number(p.armor) || 0, shield: Number(p.shield) || 0, sand: Number(p.sand) || 0, spirit: !!p.spirit };
  }
  /** 改造要花多少：动了多少点肉体（加减都算），换成 / 换回星灵按被换的肉体点数算 */
  function cyberCost(run, kit, plan) {
    const info = cyberInfo(run, kit);
    const a = info.current, b = normPlan(plan);
    let pts = CYBER_OUTER.reduce((s, t) => s + Math.abs(b[t] - a[t]), 0);
    if (a.spirit !== b.spirit) {
      const used = CYBER_OUTER.reduce((s, t) => s + b[t], 0);
      pts += info.fleshMax - used;
    }
    return pts * ROGUE_CLINIC.cyberPerHp;
  }
  /** 改造预览：{ error, cost, layers（从外到内）, limit, rate } */
  function cyberPreview(run, kit, plan) {
    const info = cyberInfo(run, kit);
    const p = normPlan(plan);
    const error = cyberPlanError(p, info.fleshMax, info.rate);
    return {
      error, cost: error ? 0 : cyberCost(run, kit, p),
      layers: error ? [] : cyberLayersFor(info.fleshMax, p),
      limit: info.limit, rate: info.rate, fleshMax: info.fleshMax, current: info.current
    };
  }
  /** 做改造。做完顺便治好（手术后在诊所躺好了才出来） */
  function modifyHero(run, kit, plan) {
    if (!canClinic(run)) throw new Error("这里没有诊所");
    const pv = cyberPreview(run, kit, plan);
    if (pv.error) throw new Error(pv.error);
    if (!pv.cost) throw new Error("方案没有变化");
    if ((Number(state.kuizhi) || 0) < pv.cost) throw new Error("奎支不够");
    state.kuizhi -= pv.cost;
    const h = run.party.find(x => x.kit === kit);
    const p = normPlan(plan);
    h.cyber = (p.armor || p.shield || p.sand || p.spirit) ? p : null;
    h.hp = null;
    const text = pv.layers.map(l => `${LAYER[l.type] || l.type} ${l.max}`).join(" / ");
    return logAll(run, [`${heroName(kit)} 完成义体改造（${text}），花掉 ${pv.cost} 奎支。`]);
  }
  /** 治疗：把血量补满，按缺的点数收钱 */
  function healCost(run, kit) {
    const h = run.party.find(x => x.kit === kit);
    const v = heroView(run, h);
    return Math.max(0, v.hpMax - v.hp) * ROGUE_CLINIC.healPerHp;
  }
  function healHero(run, kit) {
    if (!canClinic(run)) throw new Error("这里没有诊所");
    const cost = healCost(run, kit);
    if (!cost) throw new Error("不需要治疗");
    if ((Number(state.kuizhi) || 0) < cost) throw new Error("奎支不够");
    state.kuizhi -= cost;
    const h = run.party.find(x => x.kit === kit);
    h.hp = null;
    return logAll(run, [`${heroName(kit)} 在诊所治好了伤，花掉 ${cost} 奎支。`]);
  }

  /* ---------- 商店 ---------- */
  function shopItemName(row) {
    return row.name || (ITEM_CATALOG[row.give.item] || {}).name || row.key;
  }
  /** 现在能不能买东西：商店节点，或者任务之间的休整（回到城里） */
  function canShop(run) {
    const node = currentNode(run);
    return !!(node && node.type === "shop") || (run.stage === "camp" && !!C.campShop);
  }
  function buy(run, key, qty) {
    if (!canShop(run)) throw new Error("这里没有商店");
    const row = ROGUE_SHOP.find(r => r.key === key);
    if (!row) throw new Error("没有这件商品");
    qty = Math.max(1, Math.floor(Number(qty) || 1));
    const cost = row.price * qty;
    if ((Number(state.kuizhi) || 0) < cost) throw new Error("奎支不够");
    state.kuizhi -= cost;
    if (row.give.water) setLedgerWater(water() + row.give.water * qty);
    if (row.give.item) bagAdd(row.give.item, qty);
    return logAll(run, [`买下 ${shopItemName(row)} ×${qty}，花掉 ${cost} 奎支。`]);
  }

  /* ---------- 工匠 ---------- */
  /** 升到某一级的报价（rogue-data.js · ROGUE_SMITH.recipe × 材料价 + 加工费，再按工匠的收费规则）。
   *  smithId 不给时按标准价算。返回 { cost, hours, mats, labor } 或 null（没有这一级） */
  function smithQuote(run, smithId, level) {
    const rc = ROGUE_SMITH.recipe[level];
    if (!rc) return null;
    const s = smithId ? smithById(smithId) : null;
    const pr = (s && s.price) || {};
    const mats = Object.assign({}, rc.mats);
    if (pr.extraMats) {
      const cheap = Object.keys(mats).sort((a, b) => ROGUE_MATERIALS[a].price - ROGUE_MATERIALS[b].price)[0];
      mats[cheap] += pr.extraMats;
    }
    const matCost = Object.keys(mats).reduce((sum, k) => sum + ROGUE_MATERIALS[k].price * mats[k], 0);
    let labor = (rc.labor || 0) * (pr.laborMul != null ? pr.laborMul : 1);
    const hours = pr.laborHours && rc.labor ? pr.laborHours : 0;
    if (pr.laborHours) labor = 0;
    let mul = pr.priceMul != null ? pr.priceMul : 1;
    if (run && smithId && pr.friendAfter && ((run.smithUses || {})[smithId] || 0) >= pr.friendAfter) mul *= 1 - (pr.friendDiscount || 0);
    if (pr.armsDiscount && C.armsMember) mul *= 1 - pr.armsDiscount;
    const raw = (matCost + labor) * mul * (C.smithPriceScale || 1);
    return { cost: Math.max(100, Math.round(raw / 100) * 100), hours, mats, labor: Math.round(labor) };
  }
  /** 兼容旧接口：标准价 */
  function smithCost(level) {
    const q = smithQuote(null, null, level);
    return q ? q.cost : null;
  }
  function smithOptions(run, smithId) {
    const out = [];
    run.party.forEach(h => h.weapons.forEach(k => {
      const lv = (h.weaponLevels || {})[k] || 1;
      const next = lv + 1;
      const q = next <= ROGUE_SMITH.maxLevel ? smithQuote(run, smithId, next) : null;
      out.push({ owner: h.kit, kit: k, name: heroName(k), level: lv, cost: q ? q.cost : null, hours: q ? q.hours : 0, max: !q });
    }));
    return out;
  }
  /* 工匠名单与客制化图纸（rogue-data.js · ROGUE_SMITHS / ROGUE_SMITH_RULES）
   *   任务板：每次回到任务板随机来 onBoard 位不同的工匠；任务里的工匠节点是随机的一位。
   *   在同一位工匠那里升级满 blueprintAfter 次，就能从他的图纸里挑一张；
   *   图纸花 installCost 装到武器上（任何工匠处都能装），拿着这把武器时生效。 */
  const SR = () => (typeof ROGUE_SMITH_RULES !== "undefined" ? ROGUE_SMITH_RULES : { onBoard: 3, blueprintAfter: 5, installCost: 5000 });
  const smithById = (id) => (typeof ROGUE_SMITHS !== "undefined" ? ROGUE_SMITHS : []).find(s => s.id === id) || null;
  function blueprintById(id) {
    for (const s of (typeof ROGUE_SMITHS !== "undefined" ? ROGUE_SMITHS : [])) {
      const b = (s.blueprints || []).find(x => x.id === id);
      if (b) return Object.assign({ smith: s.id, smithName: s.name }, b);
    }
    return null;
  }
  function ensureSmithState(run) {
    run.smithUses = run.smithUses || {};
    run.smithClaimed = run.smithClaimed || {};
    run.blueprints = run.blueprints || [];
    run.installed = run.installed || {};
  }
  /** 按权重抽不重复的工匠：设定里的所在地和本幕区域一致时机会翻倍；摩尔玛之类权重低的很少见 */
  function drawSmiths(run, n) {
    const pool = (typeof ROGUE_SMITHS !== "undefined" ? ROGUE_SMITHS : []).map(s => ({
      id: s.id, w: (s.weight != null ? s.weight : 1) * (s.home && s.home === region(run) ? 2 : 1)
    }));
    const out = [];
    while (out.length < n && pool.length) {
      const total = pool.reduce((a, x) => a + x.w, 0);
      let r = Math.random() * total, i = 0;
      while (i < pool.length - 1 && r >= pool[i].w) { r -= pool[i].w; i++; }
      out.push(pool.splice(i, 1)[0].id);
    }
    return out;
  }
  function rollBoardSmiths(run) {
    run.smiths = withRng(`${run.seed}:smiths:${run.act}:${run.boardNo}`, () => drawSmiths(run, SR().onBoard));
  }
  /** 任务里的工匠节点是哪位（第一次走到时随机定下） */
  function nodeSmith(run, node) {
    if (!node || node.type !== "smith") return null;
    if (!node.smith) {
      node.smith = withRng(`${run.seed}:nodesmith:${run.taskNo}:${run.task ? run.task.index : 0}`, () => drawSmiths(run, 1)[0]);
    }
    return node.smith;
  }
  /** 此刻在场的工匠 id 列表：任务板上的几位，或者当前工匠节点那一位 */
  function presentSmiths(run) {
    if (run.stage === "board") return (run.smiths || []).slice();
    const node = run.stage === "task" ? currentNode(run) : null;
    const id = nodeSmith(run, node);
    return id ? [id] : [];
  }
  function smithInfo(run, id) {
    ensureSmithState(run);
    const s = smithById(id);
    if (!s) return null;
    const uses = run.smithUses[id] || 0;
    const claimed = run.smithClaimed[id] || null;
    const pr = s.price || {};
    return {
      id, name: s.name, blurb: s.blurb || "", uses, need: SR().blueprintAfter,
      claimed, canClaim: !claimed && uses >= SR().blueprintAfter,
      blueprints: (s.blueprints || []).map(b => blueprintById(b.id)),
      canInstall: s.canInstall !== false,
      needsIntro: !!pr.needsIntro && !(run.smithIntro || {})[id],
      priceNote: smithPriceNote(run, s)
    };
  }
  function requireSmith(run, smithId) {
    const here = presentSmiths(run);
    const id = smithId || here[0];
    if (!id || here.indexOf(id) < 0) throw new Error("这里没有这位工匠");
    return id;
  }
  /** 工匠的收费说明（界面上显示） */
  function smithPriceNote(run, s) {
    const pr = s.price || {};
    const out = [];
    if (pr.needsIntro && !(run.smithIntro || {})[s.id]) out.push("不帮陌生人：先给他看看你的武器");
    if (pr.friendAfter) {
      const uses = (run.smithUses || {})[s.id] || 0;
      out.push(uses >= pr.friendAfter ? `关系变好：总价 ${Math.round((1 - pr.friendDiscount) * 10)} 折`
        : `在他这里升级满 ${pr.friendAfter} 次后关系变好，打 ${Math.round((1 - pr.friendDiscount) * 10)} 折`);
    }
    if (pr.armsDiscount) out.push(C.armsMember ? `ARMS 成员 ${Math.round((1 - pr.armsDiscount) * 10)} 折` : "对非成员也一视同仁");
    if (pr.laborHours) out.push(`不收加工费，5 级起每次要帮他建庇护所 ${pr.laborHours} 小时`);
    if (pr.laborMul != null && pr.laborMul !== 1) out.push(`加工费 ${Math.round(pr.laborMul * 10)} 折`);
    if (pr.extraMats) out.push(`每次多耗 ${pr.extraMats} 个材料`);
    if (s.canInstall === false) out.push("装不了图纸");
    return out.join("；");
  }
  /** 崔佛这类不帮陌生人的工匠：给他看看武器之后才肯接活 */
  function introduceSmith(run, smithId) {
    ensureSmithState(run);
    const sid = requireSmith(run, smithId);
    run.smithIntro = run.smithIntro || {};
    run.smithIntro[sid] = true;
    return logAll(run, [`${smithById(sid).name} 端详了你们的武器好一会儿：「用巨人的东西改成武器……这个点子不坏。」他愿意接活了。`]);
  }
  function upgradeWeapon(run, kit, smithId) {
    ensureSmithState(run);
    const sid = requireSmith(run, smithId);
    if (smithInfo(run, sid).needsIntro) throw new Error("他不帮陌生人强化武器，先给他看看你的武器");
    const opt = smithOptions(run, sid).find(o => o.kit === kit);
    if (!opt || opt.max) throw new Error("已经满级");
    if ((Number(state.kuizhi) || 0) < opt.cost) throw new Error("奎支不够");
    state.kuizhi -= opt.cost;
    const h = run.party.find(x => x.kit === opt.owner);
    h.weaponLevels[kit] = opt.level + 1;
    run.smithUses[sid] = (run.smithUses[sid] || 0) + 1;
    const s = smithInfo(run, sid);
    const notes = [`${s.name} 把 ${opt.name} 升到 ${opt.level + 1} 级，花掉 ${opt.cost} 奎支。`];
    if (opt.hours) {
      notes.push(`帮 ${s.name} 建庇护所，花了 ${opt.hours} 小时。`);
      passHours(run, opt.hours, notes);
    }
    if (s.canClaim && s.uses === s.need) notes.push(`${s.name} 愿意把自己的客制化图纸给你一张（在他这里升级满 ${s.need} 次）。`);
    return logAll(run, notes);
  }
  /** 领图纸：在同一位工匠那里升级满次数后，从他的图纸里挑一张（每位工匠只能领一次） */
  function claimBlueprint(run, smithId, bpId) {
    ensureSmithState(run);
    const sid = requireSmith(run, smithId);
    const s = smithInfo(run, sid);
    if (!s.canClaim) throw new Error(s.claimed ? "这位工匠的图纸已经领过了" : `还要在他这里升级 ${s.need - s.uses} 次`);
    const bp = s.blueprints.find(b => b.id === bpId);
    if (!bp) throw new Error("没有这张图纸");
    run.smithClaimed[sid] = bpId;
    run.blueprints.push(bpId);
    return logAll(run, [`从 ${s.name} 那里拿到图纸「${bp.name}」（${bp.text}）。装到武器上要 ${SR().installCost} 奎支。`]);
  }
  /** 装图纸：任何工匠处都能装，花 installCost。一把武器一张，装新的替换旧的 */
  function installBlueprint(run, bpId, kit, smithId) {
    ensureSmithState(run);
    const sid = requireSmith(run, smithId);
    if (!smithInfo(run, sid).canInstall) throw new Error(`${smithById(sid).name} 装不了图纸，去找别的武器工匠`);
    const i = run.blueprints.indexOf(bpId);
    if (i < 0) throw new Error("手里没有这张图纸");
    const owner = run.party.find(h => (h.weapons || []).indexOf(kit) >= 0);
    if (!owner) throw new Error("队伍里没有这把武器");
    const cost = SR().installCost;
    if ((Number(state.kuizhi) || 0) < cost) throw new Error(`奎支不够：装图纸要 ${cost}，手里只有 ${Number(state.kuizhi) || 0}`);
    state.kuizhi -= cost;
    run.blueprints.splice(i, 1);
    const bp = blueprintById(bpId);
    const old = run.installed[kit] ? blueprintById(run.installed[kit]) : null;
    run.installed[kit] = bpId;
    const notes = [`${smithById(sid).name} 把「${bp.name}」装到 ${heroName(kit)} 上（${bp.text}），花掉 ${cost} 奎支。`];
    if (old) notes.push(`原来的「${old.name}」被拆掉了。`);
    return logAll(run, notes);
  }
  /** 本局各武器的图纸加成：kit → { atk, dur, block } */
  function weaponModsOf(run) {
    const out = {};
    Object.keys((run && run.installed) || {}).forEach(k => {
      const bp = blueprintById(run.installed[k]);
      if (bp && bp.mod) out[k] = Object.assign({}, bp.mod);
    });
    return out;
  }
  /** 维修工具包（手册：修复 10 点耐久）。商店、工匠、休整时都能用 */
  function repairWeapon(run, kit) {
    const notes = [];
    withParty(run, () => ledgerRepair(kit, notes));
    return logAll(run, notes);
  }

  /* ---------- 任务完成、休整 ---------- */
  function completeTask(run, notes) {
    const t = run.task;
    const pay = taskPay(run, t);
    state.kuizhi = (Number(state.kuizhi) || 0) + pay.kuizhi;
    notes.push(`${t.key ? "主线" : "任务「" + t.name + "」"}完成：获得 ${pay.kuizhi} 奎支，每人 ${pay.xp} 经验。`);
    run.party.forEach(h => { h.xp = (h.xp || 0) + pay.xp; });
    const r = withParty(run, () => null);     // 摆上场按规则结算升级
    notes.push(...r.notes);
    run.tasksDone += 1;
    advanceDays(run, t.days);
    if (t.key) run.main.done = true;
    run.task = null;
    run.stage = "camp";
    return notes;
  }
  function advanceDays(run, n) {
    run.actDay = (run.actDay || 0) + n;
    run.day += n;
    LEDGER.shortUsed = {};     // 新的一天，短休次数刷新
  }

  /** 休整一次：补给够就长休，不够只能硬撑。之后回任务板、进首领战，或者主线过期 → 结束 */
  function camp(run) {
    if (run.stage !== "camp") throw new Error("现在不是休整的时候");
    const notes = [];
    if (canLongRest(run)) doLongRest(run, notes);
    else {
      notes.push("补给不足，无法长休，只能硬撑着过夜。");
      passHours(run, C.hours.longRest, notes);
      if (run.stage === "over") return logAll(run, notes);
    }
    advanceDays(run, C.restDays);
    // 首领在本幕天数用完时才出现（主线完成后可以继续做支线发育）
    if (!run.main.done && C.mainDeadlineEndsRun && daysLeft(run) < run.main.days) {
      notes.push(`只剩 ${daysLeft(run)} 天，主线（${run.main.days} 天）已经来不及完成。`);
      endRun(run, false, `第 ${run.act} 幕的主线没能在期限内完成。`);
    } else if (run.main.done && daysLeft(run) <= 0) {
      run.stage = "boss";
      notes.push(`第 ${run.act} 幕的日子到头了：前往首领所在。`);
    } else {
      makeBoard(run);
      if (run.main.done && !run.board.some(t => !taskBlocked(run, t))) {
        run.stage = "boss";
        notes.push(`剩下的 ${daysLeft(run)} 天已经接不了任何任务：前往第 ${run.act} 幕的首领所在。`);
      }
    }
    return logAll(run, notes);
  }

  /* ---------- 幕间、额外幕、结局 ---------- */
  function nextAct(run) {
    if (run.stage !== "interlude") throw new Error("现在不是幕间");
    run.act += 1;
    const notes = [`进入第 ${run.act} 幕：${region(run)}。`];
    startAct(run);
    return logAll(run, notes);
  }
  /** 四幕打完：通关（结束），或者继续挑战额外幕 */
  function afterVictory(run, goOn) {
    if (run.stage !== "victory") throw new Error("现在不是通关的时候");
    if (!goOn || C.extraActs <= 0) {
      endRun(run, true, "四幕全部通过。");
      return logAll(run, ["通关。"]);
    }
    run.extra = true;
    run.stage = "interlude";
    return nextAct(run);
  }
  function endRun(run, win, text) {
    run.stage = "over";
    run.result = { win: !!win, text, act: run.act, day: run.day, extra: !!run.extra };
    log(run, (win ? "通关：" : "失败：") + text);
  }

  /** 界面用：一名角色的当前状态（上限按等级算好） */
  function heroView(run, h) {
    const u = spawnLiveCard(cardOf(h.kit), 1);
    applyHero(u, h);
    return {
      kit: h.kit, name: u.name, level: u.level || 1,
      hp: totalCurHp(u), hpMax: baseMaxHp(u),
      layers: (u.layers || []).map(l => ({ type: l.type, current: Number(l.current) || 0, max: Number(l.max) || 0 })),
      cyber: h.cyber ? normPlan(h.cyber) : null,
      shp: Number(u.shp) || 0, shpMax: Number(u.shpMax) || 0,
      xp: u.xp || 0, xpNext: xpToNext(u.level),
      pending: (h.pending || []).length,
      role2: h.role2 || null,
      role2Skills: (h.role2Picks || []).map(n => (roleSkillDef(h.role2, n) || {}).name || h.role2 + n),
      race: (heroProfile(h.kit) || {}).race || "", job: (heroProfile(h.kit) || {}).job || "",
      profs: Object.assign({}, heroProfs(h)),
      pendingBreak: (h.pendingBreaks || []).reduce((a, b) => a + (Number(b.amount) || 0), 0),
      weapons: h.weapons.map(k => {
        const w = weaponCarryLayers(k);
        const cur = w ? w.reduce((s, l) => s + (Number(l.current) || 0), 0) : null;
        return { kit: k, name: heroName(k), level: (h.weaponLevels || {})[k] || 1,
          dur: weaponDurFor(h, k, run), durMax: weaponDurMaxFor(h, k, run), hp: cur,
          blueprint: (run.installed || {})[k] ? blueprintById(run.installed[k]) : null };
      })
    };
  }
  /** 耐久为 0 的武器：带进战斗就只能空手（绯秋另一把刀还能用时会自动换刀） */
  function brokenWeapons(run) {
    const out = [];
    run.party.forEach(h => (h.weapons || []).forEach(k => {
      if (weaponDurFor(h, k, run) <= 0) out.push({ kit: k, name: heroName(k), owner: heroName(h.kit) });
    }));
    return out;
  }
  // 耐久上限跟武器等级走（growth.js / ledger.js）。战斗外角色不在场上，这里按单局记录的等级算
  function weaponDurMaxFor(h, k, run) {
    const g = WEAPON_GROWTH[k] || {};
    const base = (g.baseDur || 5) + Math.floor(((h.weaponLevels || {})[k] || 1) / 2);
    const mod = weaponModsOf(run)[k] || {};
    return typeof bpDurMax === "function" ? bpDurMax(base, mod) : base;
  }
  function weaponDurFor(h, k, run) {
    const v = LEDGER.dur[k];
    return v == null ? weaponDurMaxFor(h, k, run) : Math.max(0, Number(v) || 0);
  }

  return {
    CONFIG: C,
    newRun, heroPool, heroName, cardOf, region, daysLeft, enemyLevel, levelRange, totalActs,
    heroView, supplies, hoursAwake, brokenWeapons,
    makeBoard, taskBlocked, taskWarning, acceptTask, currentNode, nodeChoices, chooseNode, routeLinks,
    battleSpec, applyPartyToField, finishBattle,
    checkInfo, checkChance, checkOdds, attemptCheck, skipCheck, heroProfs,
    role2Options, soloBattleInfo,
    restPlan, canLongRest, sheetData, restAtNode, leaveNode, canShortRestBefore, shortRestBeforeNode,
    ambushChance, watchOptions,
    buy, canShop, shopItemName, smithOptions, smithCost, upgradeWeapon, repairWeapon, taskPay,
    presentSmiths, smithInfo, claimBlueprint, installBlueprint, blueprintById, weaponModsOf,
    smithQuote, introduceSmith,
    canClinic, cyberInfo, cyberPreview, cyberCost, modifyHero, healCost, healHero,
    pendingChoices, choiceOptions, choose, queueLevelRewards,
    camp, nextAct, afterVictory, endRun,
    enterRunMode, leaveRunMode, syncWorld, save
  };
})();
