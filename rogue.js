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
  /** 这一幕在哪：幕间选过的就用选的（run.regionPick[幕]），否则照 C.regions 的表 */
  const defaultRegion = (act) => C.regions[(act - 1) % C.regions.length];
  const region = (run) => (!run.growth && run.regionPick && run.regionPick[run.act]) || defaultRegion(run.growth ? growthAct(run) : run.act);
  const daysLeft = (run) => Math.max(0, C.daysPerAct - (run.actDay || 0));
  /* ---------- 长线养成（rogue-data.js · ROGUE_GROWTH） ---------- */
  const G = () => (typeof ROGUE_GROWTH !== "undefined" ? ROGUE_GROWTH : { startParty: 2, partyMax: 4, fusionPerTask: 1, drawCost: 1, recruitLevel: 1, maxLevel: 20, fusionItem: "heart_fusion" });
  let growthOn = false;   // 当前载入的是长线养成：经验照跑团模式（growth.js · grantXpToPlayers、app.js 战斗结算看这个）
  /** 队伍平均等级（四舍五入） */
  function partyLevel(run) {
    const ls = run.party.map(h => Number(h.level) || 1);
    return Math.max(1, Math.round(ls.reduce((a, b) => a + b, 0) / Math.max(1, ls.length)));
  }
  /** 养成模式按平均等级落在哪一幕的等级段里，决定区域 */
  function growthAct(run) {
    const all = C.actLevels.concat(C.extraActLevels || []);
    const lv = partyLevel(run);
    const i = all.findIndex(r => lv <= r[1]);
    return (i < 0 ? all.length - 1 : i) + 1;
  }
  function levelRange(run) {
    if (run.growth) { const lv = partyLevel(run); return [lv, lv]; }
    if (run.act <= C.acts) return C.actLevels[run.act - 1] || C.actLevels[C.actLevels.length - 1];
    return C.extraActLevels[run.act - C.acts - 1] || C.extraActLevels[C.extraActLevels.length - 1];
  }
  /** 本幕此刻的敌人等级：随本幕已用天数从「起」涨到「止」 */
  function enemyLevel(run, bonus) {
    if (run.growth) return Math.max(1, partyLevel(run) + (bonus || 0));
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
  /** 新入队的角色：武器 1 级，没有任何升级选择 */
  function initHero(h) {
    h.weaponLevels = {};
    h.weapons.forEach(k => { h.weaponLevels[k] = 1; });
    h.attrPicks = [];
    h.rolePicks = {};
    h.pending = [];
    h.notes = {};
    heroProfs(h);
    return h;
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
    growthOn = !!(run && run.growth);
    // 长线养成：升级所需经验照跑团模式（不打折）
    setXpRequirementScale(growthOn ? 1 : C.xpReqScale);
    if (run && run.world) {
      loadWorld(run);
      LEDGER.day = Number(run.day) || 1;   // 旧存档里两套天数可能已经对不上：以本局的为准
      // 旧版存档升级上来时还没有主线：按当前幕补上
      if (!run.main && !run.growth && run.stage !== "over") {
        run.main = makeTask(run, ROGUE_MAIN_TASK, "main");
        run.main.done = false;
      }
    }
  }
  /** 存档：先把场上的物资写回本局。长线养成走独立槽位 */
  function save(run) {
    syncWorld(run);
    if (run && run.growth && typeof SaveStore.saveGrowth === "function") return SaveStore.saveGrowth(run);
    return SaveStore.saveRun(run);
  }
  function leaveRunMode(run) {
    if (run) syncWorld(run);
    growthOn = false;
    setXpRequirementScale(1);
    state.exhaustTier = 0;
    state.weaponMods = null;
    state.weaponBlueprints = null;
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
    if (opt.daily) {
      if (opt.solo || opt.growth) throw new Error("每日挑战不能和单人模式 / 长线养成一起开。");
      const m = /^daily-(\d{4}-\d{2}-\d{2})$/.exec(String(run.seed || ""));
      run.daily = { date: m ? m[1] : dailyDate(opt.date), offers: {}, party: run.party.map(h => h.kit) };   // 开局队伍：阵亡后 party 会变，记录用这份
      run.featLog = [];      // 每次专长选择：{ key, kit, level, offered, picked }（选取率 = 被选 / 出现）
    }
    if (opt.growth) {
      if (opt.solo) throw new Error("长线养成不能和单人模式一起开。");
      if (run.party.length !== G().startParty) throw new Error(`长线养成开局选 ${G().startParty} 名角色。`);
      run.growth = true;
      run.reserve = [];      // 候补：抽到的角色队伍满员时先放这里，任务板前可以换上场
      run.draws = 0;
    }
    run.party.forEach(h => {
      initHero(h);
      if (run.solo) { h.role2 = opt.role2; h.role2Picks = []; }
      // 单人模式：主角开局坚毅生命上限 +15（前期一个人太容易倒）
      if (run.solo && h === run.party[0]) h.shpBonus = SOLO.shpBonus || 0;
    });
    // 本局的物资：档案从零开始
    enterRunMode(run);
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
    if (run.growth) {
      run.main = null;
      // 每天的赫心融合体从「过了一天」开始发：开局当天不发（开局抽不了，靠完成任务 / 过天获得）
      run.lastFusionDay = Number(run.day) || 1;
      grantDailyFusion(run);
      log(run, `长线养成：从任务板接任务赚钱升级。每天获得${ITEM_CATALOG[G().fusionItem].name}，可以在角色抽取机里抽角色。`);
      makeBoard(run);
      return;
    }
    run.main = makeTask(run, ROGUE_MAIN_TASK, "main");
    run.main.done = false;
    log(run, `第 ${run.act} 幕 · ${region(run)}：主线「${run.main.goal.split("。")[0]}」，期限 ${C.daysPerAct} 天。`);
    makeBoard(run);
  }

  /* ---------- 任务 ---------- */
  function makeTask(run, tpl, slot) {
    const task = withRng(`${run.seed}:task:${run.act}:${run.boardNo}:${slot}`, () => {
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
    task.part = rollTaskPart(run, tpl, slot);   // 完成时额外给的改装件（部分任务有）
    if (tpl.hunt) {
      // 悬赏：路线不预先给出，从第一个线索检定开始一站一站往前走（huntNext）
      task.nodeTypes = ["check"];
      task.cols = [["check"]];
      task.huntMulti = true;   // 悬赏的线索检定：一次给三种熟练项任选（checkInfo）
      task.hunt = { need: BOUNTY().need, failMax: BOUNTY().failMax };
    }
    if (tpl.kind === "escort") task.escort = rollEscort(run, slot);
    return task;
  }
  /** 护送任务的护送对象：货车或人物（单独一条随机流） */
  function rollEscort(run, slot) {
    if (typeof ROGUE_ESCORT === "undefined") return null;
    return withRng(`${run.seed}:escort:${run.act}:${run.boardNo}:${slot}`, () => {
      const kind = Math.random() * (ROGUE_ESCORT.kinds.cart + ROGUE_ESCORT.kinds.vip) < ROGUE_ESCORT.kinds.cart ? "cart" : "vip";
      return { kind, name: pick(kind === "cart" ? ROGUE_ESCORT.cartNames : ROGUE_ESCORT.vipNames) };
    });
  }
  /** 护送对象此刻的情况：{ name, kind, hp, max, lost, intact } */
  function escortInfo(run, task) {
    const e = task && task.escort;
    if (!e || typeof escortSpec !== "function") return null;
    const sp = escortSpec(e, e.level || enemyLevel(run, 0));
    const hp = e.lost ? 0 : e.cur != null ? e.cur : sp.hpMax;
    return { name: sp.name, kind: sp.kind, hp, max: sp.hpMax, def: sp.def, atk: sp.atk, lost: !!e.lost,
      intact: !e.lost && escortIntact(hp, sp.hpMax), note: ESCORT_KINDS[sp.kind].note };
  }
  /** 任务奖励的改装件：单独一条随机流，不影响任务的路线和天气 */
  function rollTaskPart(run, tpl, slot) {
    const cfg = typeof ROGUE_PARTS !== "undefined" && ROGUE_PARTS.taskReward[tpl.kind];
    if (!cfg || typeof rollWeaponPart !== "function") return null;
    return withRng(`${run.seed}:taskpart:${run.act}:${run.boardNo}:${slot}`, () => (Math.random() < cfg.chance ? rollWeaponPart(cfg.grades) : null));
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
    if (!run.growth && task.days > daysLeft(run)) return `剩余天数不够（还剩 ${daysLeft(run)} 天）`;
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
    // 只能在任务板前接任务：任务中途接新任务会覆盖当前任务、跳过休整和期限检查（以前只靠界面拦）
    if (run.stage !== "board") throw new Error("现在不在任务板前，不能接任务");
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
    if (run.task.escort) run.task.escort = Object.assign({}, run.task.escort, { level: enemyLevel(run, 0), cur: null, lost: false });
    if (run.task.hunt) run.task.hunt = Object.assign({ found: 0, fails: 0, located: false, lastFailProf: null, restUsed: false, target: null }, run.task.hunt);
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
    exhaustDeath(run, notes);
  }
  /** 满 80 小时：队伍力竭致死，本局结束。短休、补给不够只能硬撑的长休也会推进时间，都要判
   *  （以前只有 passHours 判，短休推过 80 小时照样活着） */
  function exhaustDeath(run, notes) {
    if (run.stage === "over" || exhaustTierFromHours(hoursAwake()) < 4) return false;
    if (run.growth) {
      // 长线养成不会永久死亡：撑不住就倒头昏睡过去（不吃不喝，醒来时间清零）
      LEDGER.hours = 0;
      notes.push("力竭：全队撑不住，倒头昏睡过去。（长线养成不会力竭致死）");
      return false;
    }
    run.party.slice().forEach(h => killHero(run, h, notes, "力竭致死"));
    endRun(run, false, "力竭致死：太久没能好好睡一觉。");
    return true;
  }
  /** 走到下一个节点要几小时（荒野向导 −1/3） */
  function travelHours(run) {
    const mul = typeof featTravelMul === "function" ? featTravelMul(run && run.party) : 1;
    return Math.round(C.hours.travel * mul * 10) / 10;
  }
  function arriveAtNode(run, notes) {
    if (run.task.index > 0) passHours(run, travelHours(run), notes);
    const left = nodeChoices(run);
    if (left.length === 1) chooseNode(run, left[0].i);   // 只有一条路：直接走
  }

  /* ---------- 把队伍摆到场上（战斗，或者战斗外要用到规则的时候） ---------- */
  function applyHero(u, h) {
    u.weaponLevels = Object.assign({}, u.weaponLevels || {}, h.weaponLevels || {});
    if (h.weaponParts) u.weaponParts = JSON.parse(JSON.stringify(h.weaponParts));
    if (h.attrs) u.attrs = Object.assign({}, h.attrs);
    u.rolePicks = Object.assign({}, h.rolePicks || {});
    u.role2 = h.role2 || null;
    u.role2Picks = (h.role2Picks || []).slice();
    u.level = h.level || 1;
    u.xp = h.xp || 0;
    u.attrPoints = 0;               // 属性点在单局里走升级选择，不用后台的可分配点
    u.cyberPlan = h.cyber ? Object.assign({}, h.cyber) : null;
    u.cyberware = (h.cyberware || []).map(x => Object.assign({}, typeof x === "string" ? { id: x } : x));   // 义体（cyberware.js）；老存档没有 = 空
    u.cyberOverinstall = !!h.cyberOverinstall;   // 过度安装（占位开关；也可以靠专长 overinstall，见 cyberware.js）
    u.shpBonus = Number(h.shpBonus) || 0;   // 单人模式主角：坚毅生命上限 +15
    u.feats = (h.feats || []).slice();      // 专长（feats.js）
    u.featFull = (h.featFull || []).slice();   // 兼修升成完整版的涉猎专长
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
    state.weaponBlueprints = Object.assign({}, run.installed || {});
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
        if (r.type === "note" && r.key === "feat" && typeof featsReady === "function" && featsReady() && featChoicesFor(h, L).length) {
          // 专长（feats.js）：有内容可选就是升级选择，否则先记下欠一项
          h.pending = h.pending || [];
          h.pending.push({ type: "feat", level: L });
        } else if (r.type === "note") {
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
  /** 坚毅生命耗尽（真正死亡的唯一条件；长线养成用） */
  function shpDepleted(u) {
    return (Number(u.shpMax) || 0) > 0 && (Number(u.shp) || 0) <= 0;
  }
  /** 场上的状态写回单局：升级、升级奖励、血量；死亡的角色连同武器人永久离队 */
  function captureParty(run, notes) {
    run.party.slice().forEach(h => {
      const u = findKit(h.kit, state.units);
      if (!u) return;
      const from = h.level || 1;
      tryLevelUp(u);
      if (u.dead && run.growth && !shpDepleted(u)) {
        // 长线养成：倒下（团灭）不是死亡，只有坚毅生命耗尽才真正死亡。战后被队友拖回来，留 1 点生命
        const last = (u.layers || []).filter(l => l.type !== "shield").slice(-1)[0];
        if (last) last.current = Math.max(1, Number(last.current) || 0);
        u.dead = false; u.dying = false; u.upOnShp = false;
        notes.push(`${u.name} 倒下了，被队友拖了回来（剩 1 点生命）。`);
      } else if (u.dead && run.growth) {
        // 长线养成：坚毅生命耗尽 = 真正死亡 → 清零等级与武器等级，移出队伍。下次抽到从 1 级重新培养
        notes.push(`${u.name} 永久死亡，等级与武器等级清零，移出队伍。`);
        const idx = run.party.indexOf(h);
        if (idx >= 0) run.party.splice(idx, 1);
        // 同时从候补移除（如果有）
        if (run.reserve) run.reserve = run.reserve.filter(x => x.kit !== h.kit);
        // 记录已死亡过的角色，下次抽到时强制 1 级
        run.deadKits = run.deadKits || [];
        if (run.deadKits.indexOf(h.kit) < 0) run.deadKits.push(h.kit);
        return;
      } else if (u.dead) { killHero(run, h, notes, "永久死亡"); return; }
      if (u.level > from) {
        notes.push(`${u.name} 升到 ${u.level} 级。`);
        const n0 = (h.pending || []).length;
        queueLevelRewards(h, from, u.level, notes, run);
        // 升级提示里写上还要选的奖励
        const PEND = { attr: "分配 1 点六维属性", prof: "一个自选熟练项", role: "一项职责技能", role2: "第二副职责的一个技能", feat: "一项专长", featFull: "兼修：选一张涉猎专长升成完整版", prof3: "万事通：一项熟练升到三级" };
        if (typeof LevelUp !== "undefined") LevelUp.amend(h.kit, (h.pending || []).slice(n0).map(p => `${p.level} 级：${PEND[p.type] || "一项奖励"}（在升级选择里选）`));
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
  /** 以前专长没有内容时只在 notes 上记「欠几项」：现在有专长可选了，补成待选。
   *  升级表改过（专长从 9 / 13 / 16 / 19 改成 7 / 11 / 13 / 16）：按现在的表数一数这个等级该有几项，
   *  已有的 + 待选的 + 欠着的不够就补上（多拿的不收回） */
  function settleOwedFeats(h) {
    if (typeof FEAT_LEVELS !== "undefined") {
      const should = FEAT_LEVELS.filter(L => L <= (Number(h.level) || 1)).length;
      const have = (h.feats || []).length + (h.pending || []).filter(p => p.type === "feat").length + (Number((h.notes || {}).feat) || 0);
      if (should > have) { h.notes = h.notes || {}; h.notes.feat = (Number(h.notes.feat) || 0) + should - have; }
    }
    const owed = Number((h.notes || {}).feat) || 0;
    if (!owed || typeof featsReady !== "function" || !featsReady() || !featChoicesFor(h).length) return;
    h.pending = h.pending || [];
    for (let i = 0; i < owed; i++) h.pending.push({ type: "feat", level: h.level || 1 });
    delete h.notes.feat;
  }
  function pendingChoices(run) {
    const out = [];
    run.party.forEach(settleOwedFeats);
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
      // 同一组（多面手的三项）已经选过的不能再选
      const taken = p.group ? ((h.profGroups || {})[p.group] || []) : [];
      const opts = PROF_LIST.filter(n => (have[n] || 0) < PROF_MAX && taken.indexOf(n) < 0)
        .map(n => ({ value: n, label: have[n] ? `${n} ${have[n]} → ${have[n] + 1} 级` : `${n}（新学）`, hint: profCategory(n) }));
      // 已有的排前面（升级），新学的按手册顺序
      return opts.filter(o => have[o.value]).concat(opts.filter(o => !have[o.value]));
    }
    if (p.type === "feat") {
      // 专长不限职责和属性：列出这一级（和更低级）还能选的
      let ids = featChoicesFor(h, p.level);
      if (run.daily) ids = dailyFeatOffer(run, h, p, ids);   // 每日挑战：按种子固定抽 4 个
      return ids.map(id => ({ value: id, label: featLabel(id), hint: FEATS[id].text || "" }));
    }
    if (p.type === "featFull") {
      // 兼修：选一张 ①–③ 的职责涉猎专长升成原技能的完整版
      return featFullOptions(h).map(id => {
        const d = FEATS[id].dabble;
        const def = roleSkillDef(d.role, d.n, { level: h.level }) || {};
        return { value: id, label: `${FEATS[id].name} → ${def.name || d.base}（完整版）`, hint: def.hint || "" };
      });
    }
    if (p.type === "prof3") {
      // 万事通：选一项熟练升到三级
      const have = heroProfs(h);
      return PROF_LIST.filter(n => (have[n] || 0) < PROF_MAX)
        .map(n => ({ value: n, label: `${n} ${have[n] || 0} → ${PROF_MAX} 级`, hint: profCategory(n) }));
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
    // 升级提示：学到的职责技能也弹出来，带完整说明
    const learn = (p.type === "role" || p.type === "role2") && typeof LevelUp !== "undefined";
    const before = learn ? withParty(run, () => LevelUp.snapshot(findKit(kit, state.units))).out : null;
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
      if (p.group) {
        h.profGroups = Object.assign({}, h.profGroups);
        h.profGroups[p.group] = (h.profGroups[p.group] || []).concat(value);
        // 这一组选完了就清掉记录
        if (!h.pending.some((q, i) => i !== index && q.group === p.group)) delete h.profGroups[p.group];
      }
      notes.push(`${heroName(kit)} 熟练项「${value}」${have[value] > 1 ? "升到 " + have[value] + " 级" : "（新学，一级）"}。`);
    } else if (p.type === "feat") {
      if (run.daily) dailyNotePick(run, kit, value);   // 每日挑战：记下这次选了哪个（在加进 feats 之前，按出现的那一行找）
      h.feats = (h.feats || []).concat(value);
      notes.push(`${heroName(kit)} 获得专长：${featLabel(value)}。`);
      // 选了以后还要再选的（多面手的三项熟练、兼修选哪张、万事通的三级熟练）
      const more = typeof FEATS[value].onTake === "function" ? FEATS[value].onTake(h) || [] : [];
      more.forEach(x => h.pending.push(Object.assign({ level: p.level }, x)));
    } else if (p.type === "featFull") {
      h.featFull = (h.featFull || []).concat(value);
      notes.push(`${heroName(kit)} 兼修：「${FEATS[value].name}」改成原职责技能的完整版。`);
    } else if (p.type === "prof3") {
      const have = heroProfs(h);
      have[value] = PROF_MAX;
      notes.push(`${heroName(kit)} 万事通：熟练项「${value}」升到 ${PROF_MAX} 级。`);
    } else if (p.type === "role") {
      h.rolePicks = Object.assign({}, h.rolePicks || {}, { [p.level]: value });
      notes.push(`${heroName(kit)} 学会职责技能：${(roleSkillDef(value.role, value.n) || {}).name || value.role + value.n}。`);
    }
    h.pending.splice(index, 1);
    // 属性变了，血量上限等跟着变：摆上场重新算一次
    if (p.type === "attr" || p.type === "feat" || p.type === "featFull") withParty(run, () => null);
    if (before) withParty(run, () => LevelUp.note("choice", findKit(kit, state.units), before));
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
  /** 当前节点 / 首领的战斗配置（给 BattleSim.setup 或战斗画面用）。单局的敌人有个体值（iv: true，enemies.js） */
  function battleSpec(run) {
    const spec = battleSpecOf(run);
    if (spec && spec.iv === undefined) spec.iv = true;
    return spec;
  }
  function battleSpecOf(run) {
    const partyKits = run.party.map(h => h.kit);
    const before = () => {
      applyPartyToField(run); state.openingBreaks = openingBreaks(run); state.solo = soloBattleInfo(run); state.scoreAct = run.act;
      // 护送任务：护送对象跟着上场，血量接着上一场
      const e = run.stage === "task" && run.task && run.task.escort;
      if (e && !e.lost && typeof spawnEscort === "function") spawnEscort(e, e.level || enemyLevel(run, 0), e.cur);
    };
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
    if (node.target && run.task.hunt && run.task.hunt.target) {
      // 悬赏目标那一战
      const B = BOUNTY(), tg = run.task.hunt.target;
      const enc = withRng(key, () => rollBountyEncounter(tg.preset, { region: region(run), tokens: NODE.elite.tokens, extraTokens: B.extraTokens,
        hpMul: B.hpMul, atkMul: B.atkMul, weather: run.task.weather || undefined, targetName: tg.name }));
      enc.features = withRng(key + ":field", () => rollBattlefield(run, false, enc.zoneMode));
      return {
        kind: "elite", title: `${run.task.name} · ${tg.name}`,
        party: partyKits, encounter: enc, level: enemyLevel(run, run.task.diff + C.eliteLevelBonus), seed: key, before, retreat: true
      };
    }
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
    // 首领战不能撤退（rogue-data.js · bossRetreat）：规则层也拒绝，撤退不能算击败首领（以前只靠界面拦）
    if (boss && outcome === "retreat") throw new Error("首领战不能撤退");
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
    const ambushPlan = ambush ? run.ambush.plan || null : null;
    if (ambush && outcome === "win") {
      // 遭遇战胜利：每人额外 50 × 敌人等级 经验（倒地的人也给，作者定）
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
    run.party.forEach(h => { delete h.pendingBreaks; });
    if (outcome === "win" && run.party.length) {
      if (run.growth) updateGrowthDailyProgress(run, notes);
      const node = !boss && !ambush ? currentNode(run) : null;
      rollItemDrops(run, boss ? "boss" : node && node.type === "elite" ? "elite" : "battle", notes);
      rollMaterialDrops(run, notes);
      if (boss || (node && node.type === "elite")) rollRecipeChip(run, boss ? "boss" : "elite", notes);
      // 拾荒者（feats.js，跑团规则）：每个带这张专长的人多掷一次战利品
      const scav = typeof featExploreOk === "function" && featExploreOk() ? featPartyCount(run.party, "scavenger") : 0;
      for (let i = 0; i < scav; i++) { notes.push("拾荒者：又在战场上翻了一遍。"); rollItemDrops(run, "battle", notes); }
    }   // 检定受伤的击破已在开场结算
    // 护送：记下护送对象剩下的血量；被摧毁 = 任务失败
    const esc = !boss && run.task && run.task.escort;
    if (esc && !esc.lost && typeof escortStatus === "function") {
      const st = escortStatus();
      if (st) { esc.cur = st.hp; esc.lost = st.destroyed; }
      if (esc.lost && !(outcome === "lose" && C.wipeEndsRun)) {
        run.ambush = null;
        passHours(run, NODE.battle.hours, notes);
        if (run.stage !== "over") failTask(run, notes, `${esc.name || "护送对象"}被摧毁`);
        return logAll(run, notes);
      }
    }
    if (ambush) {
      run.ambush = null;
      if (outcome === "lose" && run.growth) {
        notes.push("被偷袭的敌人打倒了：醒来时敌人已经走了，没能睡好。");
        passHours(run, NODE.battle.hours, notes);
        if (run.stage !== "over") advanceNode(run, notes);
        return logAll(run, notes);
      }
      if ((outcome === "lose" || !run.party.length) && C.wipeEndsRun) {
        notes.push("团灭。本局结束。");
        endRun(run, false, "在休息点被偷袭，全队倒下。");
        return logAll(run, notes);
      }
      if (outcome === "win") {
        notes.push("打退了偷袭的敌人，总算可以睡下了。");
        // 偷袭前选好的吃什么、睡什么；打完补给变了不够就按默认再分一次
        const plan = ambushPlan;
        doLongRest(run, notes, null, plan && canLongRest(run, plan) ? plan : null, { text: "长休前被偷袭：打退了敌人才睡下。" });
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
    if (outcome === "lose" && run.growth && run.task) {
      // 长线养成：团灭只算任务失败
      failTask(run, notes, "全队倒下", "任务失败");
      return logAll(run, notes);
    }
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
    if (outcome === "retreat" && node && node.target) {
      failTask(run, notes, "悬赏目标逃走了", "悬赏失败");
      return logAll(run, notes);
    }
    // 任务最后一站（目标战）撤退：任务目标没完成 → 任务失败（以前照样算完成、拿全额报酬）
    if (outcome === "retreat" && run.task && !run.task.hunt && run.task.index >= run.task.nodes.length - 1) {
      failTask(run, notes, "在最后一战撤退，任务目标没有完成", "任务失败");
      return logAll(run, notes);
    }
    if (outcome === "retreat") notes.push("撤退：这一站的敌人没有解决，绕开继续前进。");
    advanceNode(run, notes);
    return logAll(run, notes);
  }

  /* ---------- 掉落的道具 / 改装件 ----------
   * 单机直接进背包；联机单局（online-rogue.js）换成「按需求分配」：setLootHandler 接管 */
  let lootHandler = null;
  function setLootHandler(fn) { lootHandler = typeof fn === "function" ? fn : null; }
  function grantLoot(run, id, qty, notes, source) {
    if (!ITEM_CATALOG[id] || !(qty > 0)) return;
    if (lootHandler && lootHandler(run, id, qty, notes, source) !== false) return;
    bagAdd(id, qty);
    notes.push(`${source ? source + "：" : ""}获得 ${ITEM_CATALOG[id].name} ×${qty}。`);
  }
  /** 打赢之后打倒的敌人掉制作材料（items.js · rollCraftMaterials）：合在一起记一行，进背包（材料是队伍公用的） */
  function rollMaterialDrops(run, notes) {
    if (typeof rollCraftMaterials !== "function") return;
    const foes = (state.units || []).filter(u => u && !u.isPlayer && u.dead && !u.summonedBy && u.kit !== "ironwall" && u.kit !== "ufo_leg" &&
      !(typeof isNeutralCreature === "function" && isNeutralCreature(u)));
    if (!foes.length) return;
    const key = `${run.seed}:mats:${run.act}:${run.taskNo}:${run.task ? run.task.index : "b"}:${run.day}:${(run.matNo = (run.matNo || 0) + 1)}`;
    const total = {};
    withRng(key, () => foes.forEach(u => rollCraftMaterials(u).forEach(m => { total[m.id] = (total[m.id] || 0) + m.qty; })));
    const ids = Object.keys(total);
    if (!ids.length) return;
    ids.forEach(id => grantLoot(run, id, total[id], [], "材料"));
    notes.push(`材料：${ids.map(id => `${ITEM_CATALOG[id].name} ×${total[id]}`).join("、")}。`);
  }
  /** 打赢之后掉的道具（rogue-data.js · ROGUE_CONFIG.itemDrops）：kind = battle / elite / boss */
  function rollItemDrops(run, kind, notes) {
    const D = C.itemDrops;
    if (!D || !(D.pool || []).length) return;
    const key = `${run.seed}:drop:${run.act}:${run.taskNo}:${run.task ? run.task.index : "b"}:${run.day}:${kind}:${(run.dropNo = (run.dropNo || 0) + 1)}`;
    const ids = withRng(key, () => {
      const v = D[kind] == null ? D.battle : D[kind];
      const n = v >= 1 ? Math.floor(v) : (Math.random() < v ? 1 : 0);
      const out = [];
      for (let i = 0; i < n; i++) out.push(pick(D.pool));
      return out;
    });
    ids.forEach(id => grantLoot(run, id, 1, notes, "战利品"));
  }

  /* ---------- 节点推进 ---------- */
  function advanceNode(run, notes) {
    const node = currentNode(run);
    if (node) node.done = true;
    if (run.task.hunt && run.task.index >= run.task.nodes.length - 1) huntNext(run, node, notes);
    run.task.index += 1;
    if (run.task.index >= run.task.nodes.length) completeTask(run, notes);
    else arriveAtNode(run, notes);
    return notes;
  }
  /* ---------- 悬赏：一站一站往前走 ---------- */
  const BOUNTY = () => (typeof ROGUE_BOUNTY !== "undefined" ? ROGUE_BOUNTY : { need: 3, failMax: 5, hpMul: 1.5, atkMul: 1.5, extraTokens: 1, other: { battle: 1 } });
  function pushHuntNode(t, node) {
    t.cols.push([node.type]);
    t.nodes.push(Object.assign({ done: false }, node));
    t.pick = t.pick || [];
    t.pick.push(0);
  }
  /** 刚走完路线上的最后一站：决定下一站是什么（目标那一战之后就没有了 → 任务完成） */
  function huntNext(run, node, notes) {
    const t = run.task, h = t.hunt;
    if (!node || node.target) return;
    if (node.type === "check") {
      const ok = !!(node.check && node.check.result && node.check.result.ok);
      // 失败：下一次不再出这次试的熟练项；绕过去：这次给的几种都不再出
      const tried = !node.check ? [] : node.check.result ? [node.check.result.profName || node.check.prof]
        : (node.check.options || [{ prof: node.check.prof }]).map(o => o.prof);
      if (ok) { h.found += 1; h.lastFailProf = null; h.lastFailProfs = null; }
      else { h.fails += 1; h.lastFailProfs = tried.filter(Boolean); h.lastFailProf = h.lastFailProfs[0] || null; }
      notes.push(ok ? `找到一条线索（${h.found}/${h.need}）。` : `没有找到线索（失败 ${h.fails}/${h.failMax}）${h.lastFailProfs && h.lastFailProfs.length ? `，下一次换个方向打听（不再是「${h.lastFailProfs.join("」「")}」）` : ""}。`);
      if (h.found >= h.need || h.fails >= h.failMax) {
        h.located = true;
        h.target = withRng(`${run.seed}:bounty:${run.taskNo}`, () => {
          const preset = pick(bountyCandidates(region(run)));
          const p = enemyPresets().find(x => x.id === preset);
          return { preset, name: "【目标】" + ((p && p.name) || preset) };
        });
        notes.push(h.found >= h.need ? `线索凑齐了：找到了悬赏目标 ${h.target.name}！` : `虽然没问出什么，${h.target.name} 却自己找上门来了！`);
        pushHuntNode(t, { type: "elite", target: true });
        return;
      }
      const w = Object.assign({}, BOUNTY().other);
      if (h.restUsed) delete w.rest;
      const type = withRng(`${run.seed}:hunt:${run.taskNo}:${t.nodes.length}`, () => pickWeighted(w));
      if (type === "rest") h.restUsed = true;
      pushHuntNode(t, { type });
      return;
    }
    const ex = h.lastFailProfs || (h.lastFailProf ? [h.lastFailProf] : []);
    pushHuntNode(t, ex.length ? { type: "check", excludeProfs: ex } : { type: "check" });
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
  /** 当前检定节点的内容：难度、熟练项、会不会受伤、奖励。到这一站时按种子定下来，存在节点上。
   *  悬赏的线索检定一次给三种不同的熟练项（options），各自的难度、奖励分开掷，用哪一种成功都算过；
   *  其余检定只有一种。opt：看第几种（默认第一种）；返回值顶层的 diff / prof / reward 是这一种的 */
  function checkInfo(run, opt) {
    const node = currentNode(run);
    if (!node || node.type !== "check") return null;
    if (!node.check) {
      const K = ROGUE_CHECKS;
      const multi = !!(run.task && run.task.huntMulti);
      node.check = withRng(`${run.seed}:check:${run.taskNo}:${run.task.index}`, () => {
        const w = K.weightsByAct[Math.min(K.weightsByAct.length, run.act) - 1];
        const keys = Object.keys(w).filter(k => w[k] > 0);
        const rollDiff = () => {
          let r = Math.random() * keys.reduce((a, k) => a + w[k], 0);
          let diff = keys[keys.length - 1];
          for (const k of keys) { r -= w[k]; if (r < 0) { diff = k; break; } }
          return diff;
        };
        const diff = rollDiff();
        const injure = Math.random() < K.injure.chance;
        // 悬赏：上次没成功的熟练项不再出
        const ex = node.excludeProfs || (node.excludeProf ? [node.excludeProf] : []);
        let pool = K.profs.filter(p => ex.indexOf(p) < 0);
        if (!pool.length) pool = K.profs.slice();
        const reward = (d) => K.diffs[d].reward + (injure ? K.injure.bonus : 0);
        const prof = pick(pool);
        const options = [{ diff, prof, reward: reward(diff) }];
        if (multi) {
          while (options.length < 3) {
            const left = pool.filter(p => !options.some(o => o.prof === p));
            if (!left.length) break;
            const d = rollDiff();
            options.push({ diff: d, prof: pick(left), reward: reward(d) });
          }
        }
        return { diff, prof, injure, reward: reward(diff), options };
      });
    }
    const c = node.check;
    const opts = c.options || [{ diff: c.diff, prof: c.prof, reward: c.reward }];
    const i = Math.max(0, Math.min(opts.length - 1, Number(opt) || 0));
    const o = opts[i];
    const dmg = ROGUE_CHECKS.injure.dmgByAct[Math.min(ROGUE_CHECKS.injure.dmgByAct.length, run.act) - 1];
    return Object.assign({}, c, { diff: o.diff, prof: o.prof, reward: o.reward, opt: i,
      options: opts.map(x => Object.assign({}, x, { diffName: ROGUE_CHECKS.diffs[x.diff].name })),
      diffName: ROGUE_CHECKS.diffs[o.diff].name, dmg: c.injure ? dmg.slice() : null,
      brk: c.injure ? ROGUE_CHECKS.injure.brk : 0 });
  }
  /** 成功率：熟练等级 0–3 × 难度。0 表示没有资格尝试 */
  function checkChance(diff, prof) {
    const row = ROGUE_CHECKS.chance[Math.max(0, Math.min(3, Number(prof) || 0))];
    return row[CHECK_DIFFS.indexOf(diff)] || 0;
  }
  /** 一名角色做当前检定的情况：熟练等级、优劣势、重掷、最终成功率 */
  function checkOdds(run, kit, opt) {
    const info = checkInfo(run, opt);
    const h = run.party.find(x => x.kit === kit);
    if (!info || !h) return null;
    let level = Math.min(PROF_MAX, heroProfs(h)[profName(info.prof)] || 0);
    if (!level && typeof featHas === "function" && featExploreOk() && featHas(h, "polymath")) level = 1;   // 万事通：没有的熟练项视为一级
    const v = heroView(run, h);
    let perks = checkPerksFor(kit, info.prof, v.hp * 2 < v.hpMax);
    // 探索专长（feats.js · hooks.check）：重掷、优势、失败减伤……
    if (typeof featHook === "function") perks = featHook(h, "check", Object.assign({}, perks), { run, prof: info.prof, diff: info.diff, kit });
    const base = checkChance(info.diff, level);
    // 优势：掷两次取好的；劣势：两次都要过；迎难直上：整个检定失败后再来一次
    let p = perks.adv ? 1 - (1 - base) * (1 - base) : perks.dis ? base * base : base;
    if (perks.reroll) p = 1 - (1 - p) * (1 - p);
    return { kit, opt: info.opt, prof: info.prof, diff: info.diff, diffName: info.diffName, name: v.name, level, base, chance: base ? p : 0, adv: perks.adv, dis: perks.dis,
      reroll: perks.reroll, rerollName: perks.rerollName || "迎难直上", softFail: perks.softFail, noHurt: !!perks.noHurt, perkText: perks.text, hp: v.hp, hpMax: v.hpMax };
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
  function attemptCheck(run, kit, opt) {
    const info = checkInfo(run, opt);
    if (!info) throw new Error("当前节点不是检定");
    const h = run.party.find(x => x.kit === kit);
    if (!h) throw new Error("没有这名角色");
    const o = checkOdds(run, kit, info.opt);
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
      if (!ok && o.reroll) { rerolled = true; ok = once(`${o.rerollName}重掷 · `); }
    });
    // 赌徒的运气（feats.js）：每长休一次，失败改成成功
    const gambled = !ok && typeof featGambleSave === "function" && featGambleSave(h);
    if (gambled) ok = true;
    run.lastCheck = { name: o.name, prof: info.prof, diffName: info.diffName, line, chance: o.chance, rolls, ok,
      adv: !!o.adv, dis: !!o.dis };
    notes.push(`${o.name} 进行${info.diffName}「${info.prof}」检定（${profText}${mod}，成功率 ${Math.round(o.chance * 1000) / 10}%）：` +
      (gambled ? "失败——赌徒的运气：改成成功。" : rerolled ? `失败，${o.rerollName}重掷——${ok ? "成功" : "还是失败"}。` : ok ? "成功。" : "失败。"));
    const node = currentNode(run);
    node.check.result = { kit, prof: o.level, ok, opt: info.opt, profName: info.prof };
    if (ok) {
      growthDailyBump(run, "check_ok", 1, notes);   // 长线养成每日任务「完成检定」
      state.kuizhi = (Number(state.kuizhi) || 0) + info.reward;
      notes.push(`获得 ${info.reward} 奎支（现有 ${state.kuizhi}）。`);
    } else if (info.injure && o.noHurt) {
      notes.push("眼尖：看出了危险，没有受伤。");
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
  /* ---------- 舌灿莲花（feats.js，跑团规则）：每个任务一次，用普通交涉检定谈掉一场普通战斗 ---------- */
  function parleyOptions(run) {
    const node = run && run.task ? currentNode(run) : null;
    if (!node || node.type !== "battle" || node.done || run.ambush || run.task.parleyUsed) return [];
    if (typeof featExploreOk !== "function" || !featExploreOk()) return [];
    const talk = PROFICIENCIES["交涉类"];
    return run.party.filter(h => featHas(h, "silver")).map(h => {
      const have = heroProfs(h);
      const prof = talk.reduce((b, n) => ((have[n] || 0) > (have[b] || 0) ? n : b), talk[0]);
      let level = Math.min(PROF_MAX, have[prof] || 0);
      if (!level && featHas(h, "polymath")) level = 1;
      const base = checkChance("normal", level);
      return { kit: h.kit, name: heroName(h.kit), prof, level, chance: 1 - (1 - base) * (1 - base) };   // 交涉类有优势
    }).filter(o => o.chance > 0);   // 普通难度没有熟练项不能尝试
  }
  function parley(run, kit) {
    const o = parleyOptions(run).find(x => x.kit === kit);
    if (!o) throw new Error("现在不能交涉");
    const h = run.party.find(x => x.kit === kit);
    run.task.parleyUsed = true;
    const notes = [];
    let ok = withRng(`${run.seed}:parley:${run.taskNo}:${run.task.index}`, () => Math.random() < o.chance);
    const gambled = !ok && typeof featGambleSave === "function" && featGambleSave(h);
    if (gambled) ok = true;
    notes.push(`${o.name} 舌灿莲花：普通「${o.prof}」检定（优势，成功率 ${Math.round(o.chance * 1000) / 10}%）——` +
      (ok ? `${gambled ? "失败，赌徒的运气改成成功：" : "成功："}对方让开了路（这一场没有掉落和经验）。` : "失败，谈崩了，只能打。"));
    if (ok) {
      passHours(run, NODE.check.hours, notes);
      if (run.stage !== "over") advanceNode(run, notes);
    }
    return logAll(run, notes);
  }
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
  /** 长休计划只留 food / sleep 两张表（每个角色吃什么、用什么睡眠道具），不写就按默认 */
  function restChoice(plan) {
    const pick = (o) => (o && typeof o === "object" ? Object.assign({}, o) : undefined);
    return { food: pick(plan && plan.food), sleep: pick(plan && plan.sleep), spit: pick(plan && plan.spit), ammo: pick(plan && plan.ammo) };
  }
  function restPlan(run, plan) {
    return withParty(run, () => longRestNeeds(restChoice(plan))).out;
  }
  /** 长休界面：每个角色的需求、选择和可选的食物 / 睡眠道具 */
  function restOptions(run, plan) {
    return withParty(run, () => longRestOptions(restChoice(plan))).out;
  }
  function canLongRest(run, plan) { return restPlan(run, plan).ok; }
  /** 营地画面（长休前，ledger.js · campStatus）：把队伍摆上场算一份，不改动本局 */
  function campStatusOf(run, plan) { return withParty(run, () => campStatus(restChoice(plan))).out; }
  /** 角色资料面板（skill-text.js）：把队伍摆上场算一份，不改动本局 */
  function sheetData(run) {
    if (typeof SkillText === "undefined") return [];
    return withParty(run, () => SkillText.sheetData()).out;
  }
  /** 武器工坊（armory-ui.js）：同样摆上场算一份，不改动本局 */
  function armoryData(run) {
    if (typeof SkillText === "undefined" || !SkillText.armoryData) return [];
    return withParty(run, () => SkillText.armoryData()).out;
  }
  function doLongRest(run, notes, watch, plan, ambush) {
    const r = withParty(run, () => ledgerLongRest(Object.assign(restChoice(plan), { hours: C.hours.longRest, watch: watch || null }), notes));
    // 长休结算画面（rest-report.js）：玩家看的，坚毅只给一句模糊的话
    if (r.out && r.out.report) run.lastRest = Object.assign(r.out.report, ambush ? { ambush } : {});
    const e = run.task && run.task.escort;
    if (e && !e.lost && e.kind === "vip" && e.cur != null) { e.cur = null; notes.push(`${e.name || "委托人"}也休息好了，血量回满。`); }
    notes.push(...r.notes);
    // 补给不够只能消磨时间：时间照样过，满 80 小时力竭致死（以前这里不判）
    if (!(r.out && r.out.ok)) exhaustDeath(run, notes);
    else growthDailyBump(run, "long_rest", 1, notes);   // 长线养成每日任务「长休」
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
  /** 进战斗前的低血量提醒：只在这里能短休时提醒 */
  function lowHpWarning(run) {
    if (!canShortRestBefore(run).ok || typeof lowHpRestWarning !== "function") return [];
    return withParty(run, () => lowHpRestWarning()).out;
  }
  function shortRestBeforeNode(run) {
    const can = canShortRestBefore(run);
    if (!can.ok) throw new Error(can.why);
    const notes = ["原地歇一会儿。"];
    const r = withParty(run, () => ledgerShortRest(null, notes));
    notes.push(...r.notes);
    exhaustDeath(run, notes);   // 短休也花 1 小时：推过 80 小时一样力竭致死
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
      const plan = restChoice(opt);
      const need = restPlan(run, plan);
      if (!need.ok) throw new Error("补给不够长休：" + need.lack.join("，"));
      const watch = (opt && opt.watch) || null;
      if (watch && !watchOptions(run).some(w => w.kit === watch)) throw new Error("守夜的人不在队伍里");
      const chance = ambushChance(run);
      const hit = !watch && withRng(`${run.seed}:ambush:${run.taskNo}:${run.task.index}`, () => Math.random() < chance);
      if (hit) {
        // 恢复之前就被偷袭：先打，赢了再长休
        run.ambushChance = AMB.base;
        run.ambush = { chance, plan };
        notes.push(`长休时被偷袭！（这次的概率 ${Math.round(chance * 100)}%）还没来得及恢复，敌人就摸了上来。`);
        return logAll(run, notes);
      }
      run.ambushChance = Math.min(1, chance + AMB.step);
      notes.push(watch ? "有人守夜，这一夜平安无事。" : "这一夜平安无事。");
      notes.push(`下次长休被偷袭的概率 ${Math.round(run.ambushChance * 100)}%。`);
      doLongRest(run, notes, watch, plan);
    } else if (mode === "leave") {
      // 不休息直接走：拿一笔奎支，不花时间
      const pay = Number(C.restSkipKuizhi) || 0;
      state.kuizhi = (Number(state.kuizhi) || 0) + pay;
      notes.push(`没有停下休息，顺手做了点零活：获得 ${pay} 奎支（现有 ${state.kuizhi}）。`);
    } else {
      const r = withParty(run, () => ledgerShortRest(null, notes));
      notes.push(...r.notes);
      exhaustDeath(run, notes);
    }
    if (run.stage !== "over") advanceNode(run, notes);
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
    let rate = cyberRateOf(u.attrs || h.attrs || (cardOf(kit) || {}).attrs, u.level);
    if (u.cyberware.length && typeof cyberwareLayerRateFor === "function") rate = cyberwareLayerRateFor(u, fleshMax);   // 和义体共用改造率
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
  /** 做改造。伤势照旧带着（以前做完直接回满：改一点装甲比治疗便宜得多，被拿来免费回血）——
   *  缺的血量先从外层扣，最内层至少留 1 */
  function modifyHero(run, kit, plan) {
    if (!canClinic(run)) throw new Error("这里没有诊所");
    const pv = cyberPreview(run, kit, plan);
    if (pv.error) throw new Error(pv.error);
    if (!pv.cost) throw new Error("方案没有变化");
    if ((Number(state.kuizhi) || 0) < pv.cost) throw new Error("奎支不够");
    state.kuizhi -= pv.cost;
    const h = run.party.find(x => x.kit === kit);
    const before = heroView(run, h);
    let missing = Math.max(0, (Number(before.hpMax) || 0) - (Number(before.hp) || 0));
    const p = normPlan(plan);
    h.cyber = (p.armor || p.shield || p.sand || p.spirit) ? p : null;
    if (!missing) h.hp = null;
    else {
      const layers = pv.layers.map(l => ({ type: l.type, current: l.max }));
      layers.forEach((l, i) => {
        const keep = i === layers.length - 1 ? 1 : 0;
        const take = Math.min(missing, Math.max(0, l.current - keep));
        l.current -= take; missing -= take;
      });
      h.hp = layers;
    }
    const text = pv.layers.map(l => `${LAYER[l.type] || l.type} ${l.max}`).join(" / ");
    return logAll(run, [`${heroName(kit)} 完成义体改造（${text}），花掉 ${pv.cost} 奎支。`]);
  }
  /* ---- 义体（cyberware.js）：记在角色档案 h.cyberware；钱从 state.kuizhi 出（联机时 online-rogue.js 换成付钱角色的钱包） ---- */
  function cyberwareUnit(run, kit) {
    const h = run.party.find(x => x.kit === kit);
    if (!h) throw new Error("队伍里没有这个角色");
    const u = spawnLiveCard(cardOf(kit), 1);
    applyHero(u, h);
    return { h, u };
  }
  /** 给界面 / 联机包：cyberware.js · cyberwarePacket（只有档位文字，没有坚毅数值） */
  function cyberwarePacketFor(run, kit) {
    if (typeof cyberwarePacket !== "function") return null;
    const { u } = cyberwareUnit(run, kit);
    const previews = {};
    cyberwareCatalog().forEach(d => { previews[d.id] = cyberwareInstallPreview(u, d.id); });
    // purse：单机是队伍的钱；联机由 online-rogue.js · cyberwareFor 换成这名角色自己的钱包
    return Object.assign(cyberwarePacket(u), { kit, name: heroName(kit), purse: Math.max(0, Number(state.kuizhi) || 0), previews });
  }
  function cyberwarePreviewFor(run, kit, id) { return cyberwareInstallPreview(cyberwareUnit(run, kit).u, id); }
  function installCyberware(run, kit, id) {
    if (!canClinic(run)) throw new Error("这里没有诊所");
    const { h, u } = cyberwareUnit(run, kit);
    const purse = { kuizhi: Number(state.kuizhi) || 0 };
    const pv = cyberwareInstall(u, id, purse);
    state.kuizhi = purse.kuizhi;
    h.cyberware = (u.cyberware || []).map(x => ({ id: x.id }));
    return logAll(run, [`${heroName(kit)} 安装了义体「${pv.name}」，花掉 ${pv.cost} 奎支。${pv.warning || ""}`]);
  }
  function removeCyberware(run, kit, id) {
    if (!canClinic(run)) throw new Error("这里没有诊所");
    const { h, u } = cyberwareUnit(run, kit);
    const purse = { kuizhi: Number(state.kuizhi) || 0 };
    const name = (cyberwareDef(id) || {}).name || id;
    const out = cyberwareRemove(u, id, purse);
    state.kuizhi = purse.kuizhi;
    h.cyberware = (u.cyberware || []).map(x => ({ id: x.id }));
    return logAll(run, [`${heroName(kit)} 拆掉了义体「${name}」，花掉 ${out.cost} 奎支。`]);
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
  /** 这家商店的货架：水和食物一定有，其余商品随机 randomCount 种（同一家店看几次都一样，换一家重新进货） */
  function shopPlace(run) { return run.stage === "camp" ? `c${run.act}.${run.taskNo}` : partPlace(run); }
  function shopStock(run) {
    const place = shopPlace(run);
    if (!run.shopStock || run.shopStock.place !== place) {
      const n = (typeof ROGUE_SHOP_RULES !== "undefined" && ROGUE_SHOP_RULES.randomCount) || 8;
      const pool = ROGUE_SHOP.filter(r => !r.always && !r.effect).map(r => r.key);
      const fxPool = ROGUE_SHOP.filter(r => r.effect).map(r => r.key);
      const fxN = (typeof ROGUE_SHOP_RULES !== "undefined" && ROGUE_SHOP_RULES.effectCount) || 0;
      const draw = (list, k) => { const left = list.slice(), out = []; while (out.length < k && left.length) out.push(left.splice(Math.floor(Math.random() * left.length), 1)[0]); return out; };
      const picked = withRng(`${run.seed}:shop:${place}`, () => draw(pool, n));
      // 效果道具另用一条随机流抽：加了它们以后，原来那 8 种商品的进货不变
      const fxPicked = withRng(`${run.seed}:shopfx:${place}`, () => draw(fxPool, fxN));
      run.shopStock = { place, keys: ROGUE_SHOP.filter(r => r.always).map(r => r.key).concat(pool.filter(k => picked.includes(k)), fxPool.filter(k => fxPicked.includes(k))) };
    }
    const rows = ROGUE_SHOP.filter(r => run.shopStock.keys.includes(r.key));
    // 长线养成：武器升级要实物材料，商店常备（价格照物品表）
    return run.growth ? rows.concat(HANDBOOK_SHOP.filter(r => r.group === "材料")) : rows;
  }
  function buy(run, key, qty) {
    if (!canShop(run)) throw new Error("这里没有商店");
    const row = shopStock(run).find(r => r.key === key);
    if (!row) throw new Error(ROGUE_SHOP.some(r => r.key === key) ? "这家店没有这件商品" : "没有这件商品");
    qty = Math.max(1, Math.floor(Number(qty) || 1));
    const cost = Math.round(row.price * qty * (typeof featHaggleMul === "function" ? featHaggleMul(run.party, 1) : 1));   // 巧手匠人：八折
    if ((Number(state.kuizhi) || 0) < cost) throw new Error("奎支不够");
    state.kuizhi -= cost;
    if (row.give.water) setLedgerWater(water() + row.give.water * qty);
    if (row.give.item) bagAdd(row.give.item, qty);
    const notes = [`买下 ${shopItemName(row)} ×${qty}，花掉 ${cost} 奎支。`];
    earnShopPoints(run, cost, notes);
    growthDailyBump(run, "shop", cost, notes);   // 长线养成每日任务「商店消费」
    return logAll(run, notes);
  }

  /* ---------- 商店积分（ROGUE_SHOP_POINTS）：联机时记在付钱的那名角色名下（online-rogue.js 设 _pointsPayer），单人记在队伍名下 ---------- */
  function pointsBook(run) {
    const key = run._pointsPayer || "team";
    run.shopPoints = run.shopPoints || {};
    return run.shopPoints[key] || (run.shopPoints[key] = { points: 0, carry: 0 });
  }
  function earnShopPoints(run, cost, notes) {
    const per = (typeof ROGUE_SHOP_POINTS !== "undefined" && ROGUE_SHOP_POINTS.per) || 0;
    if (!per || !(cost > 0)) return;
    const b = pointsBook(run);
    b.carry += cost;
    const got = Math.floor(b.carry / per);
    b.carry -= got * per;
    b.points += got;
    if (got && notes) notes.push(`商店积分 +${got} → ${b.points}（自我效果道具可以用积分兑换）。`);
  }
  /** { points, carry, per, next（再花多少奎支得下一分）} */
  function shopPoints(run) {
    const b = pointsBook(run), per = (typeof ROGUE_SHOP_POINTS !== "undefined" && ROGUE_SHOP_POINTS.per) || 0;
    return { points: b.points, carry: b.carry, per, next: per ? per - b.carry : 0 };
  }
  /** 积分能兑换的道具：[{ id, name, hint, points }] */
  function redeemList() {
    return (typeof EFFECT_ITEMS !== "undefined" ? EFFECT_ITEMS : []).filter(it => it.points > 0)
      .map(it => ({ id: it.id, name: it.name, hint: (ITEM_CATALOG[it.id] || {}).hint || "", points: it.points }));
  }
  function redeem(run, itemId) {
    if (!canShop(run)) throw new Error("这里没有商店");
    const it = redeemList().find(x => x.id === itemId);
    if (!it) throw new Error("这件东西不能用积分兑换");
    const b = pointsBook(run);
    if (b.points < it.points) throw new Error(`积分不够（要 ${it.points}，现有 ${b.points}）`);
    b.points -= it.points;
    bagAdd(itemId, 1);
    return logAll(run, [`用 ${it.points} 积分兑换 ${it.name}（剩 ${b.points} 积分）。`]);
  }

  /* ---------- 制作（items.js · CRAFT_RECIPES / CRAFT_RULES；rogue-data.js · ROGUE_CRAFT）---------- */
  const CR = () => (typeof ROGUE_CRAFT !== "undefined" ? ROGUE_CRAFT : { smithProfs: {}, learnPrice: {}, chip: {} });
  const metalPrice = () => ((ROGUE_MATERIALS || {}).metal || {}).price || 1000;
  /** 现在能在哪做：bench 工坊（城里、工匠节点，五类都能做）/ rest 休息点（场地、自我效果做不了）/ null */
  function craftPlace(run) {
    if (!run || run.stage === "over" || run.ambush) return null;
    if (run.stage === "board" || run.stage === "camp") return "bench";
    const node = currentNode(run);
    if (node && node.type === "smith") return "bench";
    if (node && node.type === "rest") return "rest";
    return null;
  }
  function knowsRecipe(run, id) {
    const it = typeof craftItem === "function" ? craftItem(id) : null;
    if (!it) return false;
    return CRAFT_RULES.knownDiffs.includes(it.diff) || (run.recipes || []).includes(id);
  }
  /** 一名角色在某个熟练项上的等级（万事通：没有的视为一级） */
  function profLevel(h, prof) {
    let level = Math.min(PROF_MAX, heroProfs(h)[profName(prof)] || 0);
    if (!level && typeof featHas === "function" && featExploreOk() && featHas(h, "polymath")) level = 1;
    return level;
  }
  /** 制作成功率：手册检定表 × 优劣势（打下手的队友给优势）× 重掷 */
  function craftOdds(run, kit, itemId, helper) {
    const it = craftItem(itemId);
    const h = run.party.find(x => x.kit === kit);
    if (!it || !h) return null;
    const level = profLevel(h, it.prof);
    const v = heroView(run, h);
    let perks = checkPerksFor(kit, it.prof, v.hp * 2 < v.hpMax);
    if (typeof featHook === "function") perks = featHook(h, "check", Object.assign({}, perks), { run, prof: it.prof, diff: it.diff, kit, craft: true });
    const hh = helper ? run.party.find(x => x.kit === helper) : null;
    const helped = !!(hh && hh.kit !== kit && profLevel(hh, it.prof) > 0);
    const adv = !!perks.adv || helped, dis = !!perks.dis && !adv;
    const base = checkChance(it.diff, level);
    let p = adv ? 1 - (1 - base) * (1 - base) : dis ? base * base : base;
    if (perks.reroll) p = 1 - (1 - p) * (1 - p);
    return { kit, item: it.id, prof: it.prof, diff: it.diff, diffName: ROGUE_CHECKS.diffs[it.diff].name, level, base, chance: base ? p : 0,
      adv, dis, helped, reroll: !!perks.reroll, perkText: perks.text, hours: CRAFT_RULES.hours[it.diff] };
  }
  /** 配方一览：[{ id, name, prof, diff, diffName, hours, known, bench, mats: [{ id, name, need, have }], metalKuizhi }] */
  function craftList(run) {
    return EFFECT_ITEMS.filter(it => CRAFT_RECIPES[it.id]).map(it => {
      const rc = CRAFT_RECIPES[it.id];
      const mats = Object.keys(rc).map(id => ({ id, name: (ITEM_CATALOG[id] || {}).name || id, need: rc[id], have: bagCount(id) }));
      const metal = mats.find(m => m.id === "mat_metal");
      return { id: it.id, name: it.name, kind: it.kind, prof: it.prof, diff: it.diff, diffName: ROGUE_CHECKS.diffs[it.diff].name,
        hours: CRAFT_RULES.hours[it.diff], known: knowsRecipe(run, it.id), bench: CRAFT_RULES.benchKinds.includes(it.kind),
        learnPrice: CR().learnPrice[it.diff] || 0, mats, metalKuizhi: metal ? Math.max(0, metal.need - metal.have) * metalPrice() : 0 };
    });
  }
  /* 联机单局（online-rogue.js）接管：金属的钱从做的人自己钱包出（balance / pay），做出来的东西记在做的人名下（made） */
  let craftHooks = null;
  function setCraftHooks(h) { craftHooks = h && typeof h === "object" ? h : null; }
  const hook = (run) => (craftHooks && (!craftHooks.applies || craftHooks.applies(run)) ? craftHooks : null);
  /** 一起开工：jobs = [{ kit, item, helper? }]。大家同时做，花的时间按最久的那个人算。
   *  材料从队伍背包里扣；单局里没有金属实物时按参考价付奎支。失败：时间照花，非壳体材料损失一半（向上取整） */
  function craft(run, jobs) {
    const place = craftPlace(run);
    if (!place) throw new Error("这里不能制作（城里、工匠处、休息点才行）");
    jobs = (Array.isArray(jobs) ? jobs : [jobs]).filter(Boolean);
    if (!jobs.length) throw new Error("没有要做的东西");
    const busy = new Set();
    jobs.forEach(j => {
      const it = craftItem(j.item);
      if (!it) throw new Error("没有这个配方");
      const h = run.party.find(x => x.kit === j.kit);
      if (!h) throw new Error("队伍里没有这名角色");
      if (busy.has(j.kit)) throw new Error(`${heroName(j.kit)} 同时只能做一样东西`);
      busy.add(j.kit);
      if (j.helper) {
        if (busy.has(j.helper)) throw new Error(`${heroName(j.helper)} 已经在忙了`);
        const hh = run.party.find(x => x.kit === j.helper);
        if (!hh) throw new Error("打下手的人不在队伍里");
        if (!profLevel(hh, it.prof)) throw new Error(`打下手要有「${it.prof}」熟练项`);
        busy.add(j.helper);
      }
      if (!knowsRecipe(run, it.id)) throw new Error(`还不会做${it.name}`);
      if (place === "rest" && CRAFT_RULES.benchKinds.includes(it.kind)) throw new Error(`${it.name}要在工坊的工作台上做`);
      if (!craftOdds(run, j.kit, it.id, null).base) throw new Error(`${heroName(j.kit)} 没有「${it.prof}」熟练，做不了${ROGUE_CHECKS.diffs[it.diff].name}配方`);
    });
    // 材料够不够（合在一起算）
    const need = {};
    jobs.forEach(j => { const rc = CRAFT_RECIPES[j.item]; Object.keys(rc).forEach(id => { need[id] = (need[id] || 0) + rc[id]; }); });
    const lack = Object.keys(need).filter(id => id !== "mat_metal" && bagCount(id) < need[id]);
    if (lack.length) throw new Error("材料不够：" + lack.map(id => `${ITEM_CATALOG[id].name} 差 ${need[id] - bagCount(id)}`).join("，"));
    // 金属：背包里的先按顺序分给各人，不够的按参考价付奎支（联机时各付各的）
    const H = hook(run), metalOwe = {};
    let metalLeft = bagCount("mat_metal");
    jobs.forEach(j => {
      const n = CRAFT_RECIPES[j.item].mat_metal || 0, fromBag = Math.min(n, metalLeft);
      metalLeft -= fromBag;
      if (n - fromBag) metalOwe[j.kit] = (metalOwe[j.kit] || 0) + (n - fromBag) * metalPrice();
    });
    if (H) Object.keys(metalOwe).forEach(k => { if (metalOwe[k] > H.balance(run, k)) throw new Error(`${heroName(k)} 的奎支不够补金属（要 ${metalOwe[k]}）`); });
    else {
      const metalPay = Object.values(metalOwe).reduce((a, b) => a + b, 0);
      if (metalPay > (Number(state.kuizhi) || 0)) throw new Error(`金属不够，按参考价补要 ${metalPay} 奎支`);
    }
    const notes = [];
    let hours = 0;
    run.craftNo = (run.craftNo || 0) + 1;
    jobs.forEach(j => {
      const it = craftItem(j.item), rc = CRAFT_RECIPES[it.id];
      const o = craftOdds(run, j.kit, it.id, j.helper);
      hours = Math.max(hours, o.hours);
      const r = withRng(`${run.seed}:craft:${run.craftNo}:${j.kit}`, () => {
        const once = () => {
          if (o.base >= 1) return true;
          const a = Math.random() < o.base;
          if (!o.adv && !o.dis) return a;
          const b = Math.random() < o.base;
          return o.adv ? a || b : a && b;
        };
        let ok = once();
        if (!ok && o.reroll) ok = once();
        return { ok, loss: ok ? null : craftFailLoss(rc) };
      });
      const spend = r.ok ? rc : r.loss;
      const used = [];
      Object.keys(spend).forEach(id => {
        let n = spend[id];
        if (id === "mat_metal") {
          const fromBag = Math.min(n, bagCount(id));
          if (fromBag) bagAdd(id, -fromBag);
          const rest = n - fromBag;
          if (rest && H) H.pay(run, j.kit, rest * metalPrice());
          else if (rest) state.kuizhi = (Number(state.kuizhi) || 0) - rest * metalPrice();
        } else bagAdd(id, -n);
        used.push(`${ITEM_CATALOG[id].name}×${n}`);
      });
      const who = heroName(j.kit) + (o.helped ? `（${heroName(j.helper)} 打下手）` : "");
      if (r.ok) {
        bagAdd(it.id, 1);
        if (H && H.made) H.made(run, j.kit, it.id);
        notes.push(`${who} 制作${it.name}：成功（${Math.round(o.chance * 100)}%）。用掉 ${used.join("、")}。`);
      } else {
        notes.push(`${who} 制作${it.name}：失败（${Math.round(o.chance * 100)}%）。损失 ${used.join("、") || "无"}，壳体留着。`);
      }
    });
    notes.push(`制作花了 ${hours} 小时。`);
    passHours(run, hours, notes);
    return logAll(run, notes);
  }
  /* 排队开工（联机时各人给自己的角色排一样，房主按「开工」一起做；时间照样按最久的算） */
  function craftJobsOf(run) {
    if (!craftPlace(run)) { run.craftJobs = {}; return run.craftJobs; }
    return (run.craftJobs = run.craftJobs || {});
  }
  function setCraftJob(run, kit, item, helper) {
    if (!craftPlace(run)) throw new Error("这里不能制作");
    if (!run.party.some(h => h.kit === kit)) throw new Error("队伍里没有这名角色");
    const q = craftJobsOf(run);
    if (!item) {
      if (!q[kit]) return [];
      delete q[kit];
      return logAll(run, [`${heroName(kit)} 不做东西了。`]);
    }
    if (helper === kit) throw new Error("不能给自己打下手");
    const others = Object.keys(q).filter(k => k !== kit);
    if (others.some(k => q[k].helper === kit)) throw new Error(`${heroName(kit)} 已经在给别人打下手`);
    if (helper && (q[helper] && helper !== kit || others.some(k => q[k].helper === helper))) throw new Error(`${heroName(helper)} 已经在忙了`);
    // 单独验一遍这一样能不能做（材料最后开工时合起来算）
    const it = craftItem(item);
    if (!it) throw new Error("没有这个配方");
    if (!knowsRecipe(run, item)) throw new Error(`还不会做${it.name}`);
    if (craftPlace(run) === "rest" && CRAFT_RULES.benchKinds.includes(it.kind)) throw new Error(`${it.name}要在工坊的工作台上做`);
    const o = craftOdds(run, kit, item, helper);
    if (!o.base) throw new Error(`${heroName(kit)} 没有「${it.prof}」熟练，做不了${o.diffName}配方`);
    if (helper && !o.helped) throw new Error(`打下手要有「${it.prof}」熟练项`);
    q[kit] = { item, helper: helper || null };
    return logAll(run, [`${heroName(kit)} 准备制作${it.name}${helper ? `（${heroName(helper)} 打下手）` : ""}：成功率 ${Math.round(o.chance * 100)}%，${o.hours} 小时。`]);
  }
  /** 排好的活：[{ kit, name, item, itemName, helper, helperName, chance, hours }] */
  function craftQueue(run) {
    const q = craftJobsOf(run);
    return Object.keys(q).map(kit => {
      const o = craftOdds(run, kit, q[kit].item, q[kit].helper) || {};
      return { kit, name: heroName(kit), item: q[kit].item, itemName: (ITEM_CATALOG[q[kit].item] || {}).name || q[kit].item,
        helper: q[kit].helper, helperName: q[kit].helper ? heroName(q[kit].helper) : "", chance: o.chance || 0, hours: o.hours || 0 };
    });
  }
  function craftQueued(run) {
    const q = craftJobsOf(run), kits = Object.keys(q);
    if (!kits.length) throw new Error("还没有人排活");
    const notes = craft(run, kits.map(kit => ({ kit, item: q[kit].item, helper: q[kit].helper })));
    run.craftJobs = {};
    return notes;
  }
  /** 背包里能拆的东西：[{ id, name, qty, yield: [{ id, name, qty }] }] */
  function salvageList() {
    ensureBag();
    return state.bag.items.filter(r => r.qty > 0 && salvageYield(r.id)).map(r => {
      const y = salvageYield(r.id);
      return { id: r.id, name: ITEM_CATALOG[r.id].name, qty: r.qty, yield: Object.keys(y).map(id => ({ id, name: ITEM_CATALOG[id].name, qty: y[id] })) };
    });
  }
  /** 拆一件：道具拆回壳体和一半材料，改装件拆成废料。不花时间 */
  function salvage(run, itemId) {
    if (!craftPlace(run)) throw new Error("这里不能拆（城里、工匠处、休息点才行）");
    const y = salvageYield(itemId);
    if (!y) throw new Error("这件东西拆不了");
    if (bagCount(itemId) < 1) throw new Error("背包里没有这件东西");
    bagAdd(itemId, -1);
    Object.keys(y).forEach(id => bagAdd(id, y[id]));
    return logAll(run, [`拆掉 ${ITEM_CATALOG[itemId].name}：拿回 ${Object.keys(y).map(id => `${ITEM_CATALOG[id].name}×${y[id]}`).join("、")}。`]);
  }
  /** 向在场的工匠学配方：只教自己那一类熟练项的，简单配方本来就会 */
  function learnOptions(run) {
    const out = [];
    presentSmiths(run).forEach(sid => {
      const prof = CR().smithProfs[sid];
      if (!prof) return;
      EFFECT_ITEMS.filter(it => it.prof === prof && CRAFT_RECIPES[it.id] && !knowsRecipe(run, it.id)).forEach(it =>
        out.push({ smith: sid, smithName: (smithById(sid) || {}).name || sid, item: it.id, name: it.name, prof, diff: it.diff,
          diffName: ROGUE_CHECKS.diffs[it.diff].name, price: CR().learnPrice[it.diff] || 0 }));
    });
    return out;
  }
  function learnRecipe(run, itemId, smithId) {
    const o = learnOptions(run).find(x => x.item === itemId && (!smithId || x.smith === smithId));
    if (!o) throw new Error("这里没有人教这张配方");
    if ((Number(state.kuizhi) || 0) < o.price) throw new Error(`奎支不够（要 ${o.price}）`);
    state.kuizhi = (Number(state.kuizhi) || 0) - o.price;
    run.recipes = (run.recipes || []).concat([itemId]);
    return logAll(run, [`向${o.smithName}学会了${o.name}的配方（${o.diffName} · ${o.prof}），花 ${o.price} 奎支。`]);
  }
  /** 打赢精英 / 首领：按概率掉一张配方芯片，学会一张还不会的配方（优先队伍里有人能做的熟练项） */
  function rollRecipeChip(run, kind, notes) {
    const p = CR().chip[kind] || 0;
    if (!(p > 0) || typeof CRAFT_RECIPES === "undefined") return;
    const key = `${run.seed}:chip:${run.act}:${run.taskNo}:${run.task ? run.task.index : "b"}:${run.day}:${(run.chipNo = (run.chipNo || 0) + 1)}`;
    const id = withRng(key, () => {
      if (Math.random() >= p) return null;
      const left = EFFECT_ITEMS.filter(it => CRAFT_RECIPES[it.id] && !knowsRecipe(run, it.id));
      if (!left.length) return null;
      const good = left.filter(it => run.party.some(h => profLevel(h, it.prof) > 0));
      return pick(good.length ? good : left).id;
    });
    if (!id) return;
    run.recipes = (run.recipes || []).concat([id]);
    const it = craftItem(id);
    notes.push(`配方芯片：学会了${it.name}的配方（${ROGUE_CHECKS.diffs[it.diff].name} · ${it.prof}）。`);
  }

  /* ---------- 背包 / 工坊共用的读数（inventory.js）：只读，不改存档 ---------- */
  /** 背包里现有的：{ 物品 id: 数量 } */
  function bagCounts() {
    const out = {};
    ((ensureBag().items) || []).forEach(x => { const n = Number(x.qty) || 0; if (n > 0) out[x.id] = (out[x.id] || 0) + n; });
    return out;
  }
  /** 一名角色身上装着的（改装件、图纸、义体）：给背包「武器与改装件」「义体」页用 */
  function heroGear(run, h) {
    const installed = [], blueprints = [];
    (h.weapons || []).forEach(k => {
      (typeof weaponPartRow === "function" ? weaponPartRow(h, k) : []).forEach((id, slot) => {
        if (id) installed.push({ weapon: k, weaponName: heroName(k), slot, part: id, name: typeof weaponPartLabel === "function" ? weaponPartLabel(id) : id });
      });
      const bp = (run.installed || {})[k];
      if (bp) blueprints.push({ weapon: k, weaponName: heroName(k), blueprint: bp, name: (blueprintById(bp) || {}).name || bp });
    });
    return { kit: h.kit, name: heroName(h.kit), installed, blueprints, cyber: h.cyber ? normPlan(h.cyber) : null };
  }
  /** 背包（分类、公用 / 个人）。opt.owned / opt.kits 见 inventory.js · buildInventory；单机不传 = 全部公用。
   *  战斗中也能调（不重摆队伍） */
  function inventory(run, opt) {
    opt = opt || {};
    const out = buildInventory(bagCounts(), { owned: opt.owned || null, kits: opt.kits || null, heroes: (run.party || []).map(h => heroGear(run, h)) });
    out.water = ledgerWater();
    return out;
  }
  /** 一张配方对一名角色的状态。opt.counts：能用的材料数量（联机传自己的 + 公用的；不传 = 整个背包）；opt.helper 打下手的人。
   *  → recipeCheck 的结果 + { kit, kind, prof, diff, diffName, hours, known, bench, placeOk, reasons: [文字], odds }
   *  craftable = 会这张配方 && 这里能做 && 材料够 && 有对应熟练项；只有 craftable 时 odds 才有（{ chance, base, adv, dis, helped, reroll, level, hours }），否则 null */
  function recipeStatus(run, kit, itemId, opt) {
    opt = opt || {};
    const it = craftItem(itemId);
    if (!it) return null;
    const chk = recipeCheck(itemId, opt.counts || bagCounts());
    const place = craftPlace(run), bench = CRAFT_RULES.benchKinds.includes(it.kind);
    const known = knowsRecipe(run, itemId), placeOk = !!place && (place === "bench" || !bench);
    const reasons = [];
    if (!known) reasons.push("还不会这张配方");
    if (!place) reasons.push("这里不能制作");
    else if (!placeOk) reasons.push("要在工坊的工作台上做");
    if (chk.missing.length) reasons.push("材料不够");
    let odds = null;
    if (known && placeOk && !chk.missing.length && kit) {
      const o = craftOdds(run, kit, itemId, opt.helper || null);
      if (!o) reasons.push("没有这名角色");
      else if (!o.base) reasons.push(`没有「${it.prof}」熟练`);
      else odds = { chance: o.chance, base: o.base, adv: o.adv, dis: o.dis, helped: o.helped, reroll: o.reroll, level: o.level, hours: o.hours };
    }
    return Object.assign(chk, { kit: kit || null, kind: it.kind, prof: it.prof, diff: it.diff, diffName: ROGUE_CHECKS.diffs[it.diff].name,
      hours: CRAFT_RULES.hours[it.diff], known, bench, placeOk, craftable: !!odds, reasons, odds });
  }
  /** 配方簿：全部配方对一名角色的状态，能做的排前面（其余按配方表顺序）。opt 同 recipeStatus，另有 opt.kind 只要某一类、opt.onlyCraftable */
  function recipeBook(run, kit, opt) {
    opt = opt || {};
    const counts = opt.counts || bagCounts();
    let list = EFFECT_ITEMS.filter(it => CRAFT_RECIPES[it.id] && (!opt.kind || it.kind === opt.kind))
      .map(it => recipeStatus(run, kit, it.id, Object.assign({}, opt, { counts })));
    if (opt.onlyCraftable) list = list.filter(x => x.craftable);
    return list.filter(x => x.craftable).concat(list.filter(x => !x.craftable));
  }
  /** 这种材料用在哪些配方上（背包里点材料 → 跳到工坊的配方） */
  function materialUses(materialId) { return recipesUsing(materialId); }

  /* ---------- 给工坊 / 背包界面的接口（Akane 定的名字；纯数据） ---------- */
  /* 工坊在哪能开：键是 board 任务板 / camp 休整 / smith 工匠节点 / rest 休息点，值是那里的工坊档（bench 五类都能做 / rest 场地、自我效果做不了）。
   * 作者 10/20 定：四处都开（= 现在的规则 craftPlace）。以后要改地点只改这张表 */
  const WORKSHOP_AT = { board: "bench", camp: "bench", smith: "bench", rest: "rest" };
  function workshopSpot(run) {
    if (!run || run.stage === "over" || run.ambush) return null;
    if (run.stage === "board" || run.stage === "camp") return run.stage;
    const node = currentNode(run);
    return node && (node.type === "smith" || node.type === "rest") ? node.type : null;
  }
  /** 现在能不能开工坊 → "bench" / "rest" / null（和 craftPlace 同值，再按 WORKSHOP_AT 过滤） */
  function workshopAvailable(run) {
    const place = craftPlace(run), spot = workshopSpot(run);
    return place && spot && WORKSHOP_AT[spot] ? place : null;
  }
  /** 配方分两组：{ craftable: [...], missing: [...] }。每张 = craftList 那一行 +
   *  { missing: [{ id, need, have }]（金属不算，金属可用奎支补）, affordable（补金属的钱够不够）, metalKuizhi, canMakeHere }
   *  craftable 组 = 会 && 这里能做 && 材料够 && 钱够补金属。opt.kind 只要某类；opt.onlyCraftable 时 missing 组为空；opt.counts / opt.kuizhi 联机时传某人能用的 */
  function craftListGrouped(run, opt) {
    opt = opt || {};
    const counts = opt.counts || bagCounts(), place = workshopAvailable(run);
    const money = opt.kuizhi != null ? Number(opt.kuizhi) || 0 : Number(state.kuizhi) || 0;
    const out = { craftable: [], missing: [] };
    craftList(run).filter(x => !opt.kind || x.kind === opt.kind).forEach(x => {
      const mats = x.mats.map(m => Object.assign({}, m, { have: Math.max(0, Number(counts[m.id]) || 0) }));
      const metal = mats.find(m => m.id === "mat_metal");
      const metalKuizhi = metal ? Math.max(0, metal.need - metal.have) * metalPrice() : 0;
      const missing = mats.filter(m => m.id !== "mat_metal" && m.have < m.need).map(m => ({ id: m.id, need: m.need, have: m.have }));
      const canMakeHere = !!place && (place === "bench" || !x.bench);
      const row = Object.assign({}, x, { mats, missing, metalKuizhi, affordable: metalKuizhi <= money, canMakeHere });
      (x.known && canMakeHere && !missing.length && row.affordable ? out.craftable : out.missing).push(row);
    });
    if (opt.onlyCraftable) out.missing = [];
    return out;
  }
  /** 选中一张配方后的详情：{ craftable, reasons, missing, odds（craftOdds，只有 craftable 时才有，否则 null）,
   *  output: { id, name, qty }, onFail: { lose: 份数, from: [{ id, name, qty }] 可能被扣的非壳体材料, keep: [壳体 id] }, hours, metalKuizhi }
   *  opt.counts / opt.kuizhi 同 craftListGrouped */
  function craftPreview(run, kit, itemId, helper, opt) {
    opt = opt || {};
    const it = craftItem(itemId);
    if (!it) return null;
    const st = recipeStatus(run, kit, itemId, { counts: opt.counts, helper });
    const g = craftListGrouped(run, opt), row = g.craftable.concat(g.missing).find(x => x.id === itemId);
    const reasons = st.reasons.slice();
    if (row && !row.affordable) reasons.push(`奎支不够补金属（要 ${row.metalKuizhi}）`);
    if (!workshopAvailable(run) && !reasons.includes("这里不能制作")) reasons.push("这里不能制作");
    const craftable = st.craftable && !!row && row.affordable && !!workshopAvailable(run);
    const rc = CRAFT_RECIPES[itemId], from = [], keep = [];
    let pieces = 0;
    Object.keys(rc).forEach(id => { if (CRAFT_RULES.shells.includes(id)) keep.push(id); else { pieces += rc[id]; from.push({ id, name: (ITEM_CATALOG[id] || {}).name || id, qty: rc[id] }); } });
    return { id: itemId, kit, helper: helper || null, craftable, reasons, missing: row ? row.missing : [],
      odds: craftable ? craftOdds(run, kit, itemId, helper || null) : null,
      output: { id: it.id, name: it.name, qty: 1 },
      onFail: { lose: Math.ceil(pieces * CRAFT_RULES.failLoss), from, keep },
      hours: CRAFT_RULES.hours[it.diff], metalKuizhi: row ? row.metalKuizhi : 0 };
  }
  function recipesUsingMaterial(id) { return recipesUsing(id); }
  /* 联机单局（online-rogue.js）告诉背包谁名下有什么：fn(run) → run.online.owned；单机没有 → 全部公用 */
  let bagOwnership = null;
  function setBagOwnership(fn) { bagOwnership = typeof fn === "function" ? fn : null; }
  /** 背包按类：{ kit, shared: { material, consumable, mod, key }, personal: 同结构 | null（单机为 null）, usable: { 物品 id: 自己的 + 公用的 } }
   *  每行 { id, name, hint, qty, category, uses?（材料：用到它的配方） }。viewerKit 不传 = 只看公用 */
  function bagByCategory(run, viewerKit) {
    const owned = bagOwnership ? bagOwnership(run) : null;
    const inv = buildInventory(bagCounts(), { owned, kits: viewerKit ? [viewerKit] : [], heroes: (run.party || []).map(h => heroGear(run, h)) });
    const regroup = g => {
      const out = { material: [], consumable: [], mod: [], key: [] };
      ["materials", "consumables", "parts"].forEach(k => (g[k] || []).forEach(r => { const c = itemCategory(r.id); out[c].push(Object.assign({}, r, { category: c })); }));
      return out;
    };
    const mine = inv.personal[0];
    return { kit: viewerKit || null, shared: regroup(inv.shared), personal: owned && mine ? regroup(mine) : null,
      usable: viewerKit ? inv.usable[viewerKit] : inv.sharedCounts };
  }
  /** 材料条：7 种制作材料 + 金属 → [{ id, name, have, cls, tier, hint }]（取代 rogue-ui.js 里写死的那 8 个）。counts 不传 = 整个背包 */
  function materialBar(run, counts) {
    counts = counts || bagCounts();
    const list = CRAFT_MATERIALS.map(m => ({ id: m.id, name: m.name, cls: m.cls, tier: m.tier, hint: m.hint }))
      .concat([{ id: "mat_metal", name: (ITEM_CATALOG.mat_metal || {}).name || "金属", cls: "metal", tier: 0, hint: (ITEM_CATALOG.mat_metal || {}).hint || "" }]);
    return list.map(m => Object.assign(m, { have: Math.max(0, Number(counts[m.id]) || 0) }));
  }
  /** 义体概况：{ kit, name, current: { armor, shield, sand, spirit }, used, limit, rate, fleshMax, perHp } | null（战斗中别调：会重摆队伍） */
  function cyberSummary(run, kit) {
    let i;
    try { i = cyberInfo(run, kit); } catch (e) { return null; }
    if (!i || !i.h) return null;
    const cur = i.current || {};
    return { kit, name: heroName(kit), current: cur, used: CYBER_OUTER.reduce((s, t) => s + (Number(cur[t]) || 0), 0),
      limit: i.limit, rate: i.rate, fleshMax: i.fleshMax, perHp: ROGUE_CLINIC.cyberPerHp };
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
    if (run && typeof featHaggleMul === "function") mul = featHaggleMul(run.party, mul);   // 巧手匠人：八折，不和别的折扣叠加
    if (run && run.growth) {
      // 长线养成照跑团模式：材料要实物（背包里拿），奎支只付加工费（按工匠的收费规则打折 / 加价）
      const fee = Math.round(labor * mul / 100) * 100;
      return { cost: fee, hours, mats, labor: Math.round(labor), items: true };
    }
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
      const row = { owner: h.kit, kit: k, name: heroName(k), level: lv, cost: q ? q.cost : null, hours: q ? q.hours : 0, max: !q };
      if (q && q.items) {
        // 长线养成：列出要的材料和背包里有几个
        row.mats = Object.keys(q.mats).map(m => ({ id: "mat_" + m, name: ROGUE_MATERIALS[m].name, need: q.mats[m], have: bagCount("mat_" + m) }));
        row.enough = row.mats.every(m => m.have >= m.need);
      }
      out.push(row);
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
  /** 折扣写法：价格倍率 0.85 → 「85 折」，0.8 → 「8 折」（以前一律 ×10 取整，85 折写成了 9 折） */
  function zhe(mul) {
    const n = Math.round(Number(mul) * 100);
    return `${n % 10 === 0 ? n / 10 : n} 折`;
  }
  /** 工匠的收费说明（界面上显示） */
  function smithPriceNote(run, s) {
    const pr = s.price || {};
    const out = [];
    if (pr.needsIntro && !(run.smithIntro || {})[s.id]) out.push("不帮陌生人：先给他看看你的武器");
    if (pr.friendAfter) {
      const uses = (run.smithUses || {})[s.id] || 0;
      out.push(uses >= pr.friendAfter ? `关系变好：总价 ${zhe(1 - pr.friendDiscount)}`
        : `在他这里升级满 ${pr.friendAfter} 次后关系变好，打 ${zhe(1 - pr.friendDiscount)}`);
    }
    if (pr.armsDiscount) out.push(C.armsMember ? `ARMS 成员 ${zhe(1 - pr.armsDiscount)}` : "对非成员也一视同仁");
    if (pr.laborHours) out.push(`不收加工费，5 级起每次要帮他建庇护所 ${pr.laborHours} 小时`);
    if (pr.laborMul != null && pr.laborMul !== 1) out.push(`加工费 ${zhe(pr.laborMul)}`);
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
    if (opt.mats && !opt.enough) throw new Error(`材料不够：${opt.mats.map(m => `${m.name} ${m.have}/${m.need}`).join("、")}`);
    if ((Number(state.kuizhi) || 0) < opt.cost) throw new Error("奎支不够");
    state.kuizhi -= opt.cost;
    if (opt.mats) opt.mats.forEach(m => bagAdd(m.id, -m.need));
    const h = run.party.find(x => x.kit === opt.owner);
    // 升级提示（levelup.js）：把队伍摆上场比一比武器升级前后多了什么
    const snap = () => (typeof LevelUp !== "undefined" ? withParty(run, () => LevelUp.snapshot(findKit(h.kit, state.units))).out : null);
    const before = snap();
    h.weaponLevels[kit] = opt.level + 1;
    if (before) withParty(run, () => LevelUp.note("weapon", findKit(h.kit, state.units), before, { weapon: opt.name }));
    clampDur(run, h, kit);   // 旧存档里装在 3 级武器上的图纸升到 4 级才生效：大杀器这类会压低耐久上限
    run.smithUses[sid] = (run.smithUses[sid] || 0) + 1;
    const s = smithInfo(run, sid);
    const matText = opt.mats ? `消耗 ${opt.mats.map(m => `${m.name}×${m.need}`).join("、")}，` : "";
    const notes = [`${s.name} 把 ${opt.name} 升到 ${opt.level + 1} 级，${matText}花掉 ${opt.cost} 奎支${opt.mats ? "加工费" : ""}。`];
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
    // 武器 4 级才解锁客制化（主持人手册「本版规则修订」；mods.js · BLUEPRINT_MIN_LEVEL）
    const lv = typeof weaponRewardLevel === "function" ? weaponRewardLevel(owner, kit) : (owner.weaponLevels || {})[kit] || 1;
    if (lv < BLUEPRINT_MIN_LEVEL) throw new Error(`${heroName(kit)} 要升到 ${BLUEPRINT_MIN_LEVEL} 级才能装客制化图纸（现在 ${lv} 级）`);
    const cost = SR().installCost;
    if ((Number(state.kuizhi) || 0) < cost) throw new Error(`奎支不够：装图纸要 ${cost}，手里只有 ${Number(state.kuizhi) || 0}`);
    state.kuizhi -= cost;
    run.blueprints.splice(i, 1);
    const bp = blueprintById(bpId);
    const old = run.installed[kit] ? blueprintById(run.installed[kit]) : null;
    run.installed[kit] = bpId;
    clampDur(run, owner, kit);
    const notes = [`${smithById(sid).name} 把「${bp.name}」装到 ${heroName(kit)} 上（${bp.text}），花掉 ${cost} 奎支。`];
    if (old) notes.push(`原来的「${old.name}」被拆掉了。`);
    return logAll(run, notes);
  }
  /* ---------- 改装件（C / B 级，rogue-data.js · ROGUE_PARTS） ----------
   * 改装件放在本局背包里。工匠处每次随机摆 3 件卖；商店和工匠处都能按原价 40% 卖掉；
   * 在工匠处花工钱装上（C 300 / B 500），拆下不要钱，拆下的放回背包。 */
  const PR = () => ROGUE_PARTS;
  const partBase = (id) => (WEAPON_PARTS[id] ? PR().price[WEAPON_PARTS[id].grade] || 0 : 0);
  function partSellPrice(id) { return Math.round(partBase(id) * PR().sellRate); }
  function partInstallCost(id) { return WEAPON_PARTS[id] ? PR().install[WEAPON_PARTS[id].grade] || 0 : 0; }
  /** 此刻在哪里（任务板 / 第几个任务的第几站）：工匠的货架按这个刷新 */
  const partPlace = (run) => (run.stage === "board" ? `b${run.act}.${run.boardNo}` : `t${run.taskNo}.${run.task ? run.task.index : 0}`);
  /** 工匠摆出来卖的改装件：[{ id, base, price, discount, sold }]。第一次看时随机定下 */
  function partOffers(run, smithId) {
    const sid = requireSmith(run, smithId);
    const place = partPlace(run);
    run.partOffers = run.partOffers || {};
    Object.keys(run.partOffers).forEach(k => { if (k.split(":")[0] !== place) delete run.partOffers[k]; });   // 离开了就不留
    const key = `${place}:${sid}`;
    if (!run.partOffers[key]) {
      run.partOffers[key] = withRng(`${run.seed}:partoffer:${key}`, () => {
        const out = [];
        for (let i = 0; i < PR().smithOffer; i++) {
          const id = rollWeaponPart(PR().smithGrades);
          const base = partBase(id);
          const discount = Math.random() < PR().discountChance;
          out.push({ id, base, price: discount ? Math.round(base * PR().discount) : base, discount, sold: false });
        }
        return out;
      });
    }
    return run.partOffers[key];
  }
  function buyPart(run, smithId, index) {
    const offer = partOffers(run, smithId)[Number(index)];
    if (!offer) throw new Error("没有这件改装件");
    if (offer.sold) throw new Error("这件已经卖掉了");
    if ((Number(state.kuizhi) || 0) < offer.price) throw new Error(`奎支不够：要 ${offer.price}`);
    state.kuizhi -= offer.price;
    offer.sold = true;
    bagAdd(weaponPartItemId(offer.id), 1);
    return logAll(run, [`买下改装件 ${weaponPartLabel(offer.id)}（${weaponPartText(offer.id)}），花掉 ${offer.price} 奎支${offer.discount ? "（打折）" : ""}。`]);
  }
  /** 能不能卖改装件：商店节点、休整时的商店，或者有工匠在场 */
  function canSellParts(run) { return canShop(run) || presentSmiths(run).length > 0; }
  /** 背包里的改装件：[{ id, name, grade, text, qty, sell, install }] */
  function partStock() {
    return Object.keys(WEAPON_PARTS).map(id => ({ id, qty: bagCount(weaponPartItemId(id)) })).filter(x => x.qty > 0)
      .map(x => Object.assign(x, { name: weaponPartLabel(x.id), grade: WEAPON_PARTS[x.id].grade, text: weaponPartText(x.id),
        sell: partSellPrice(x.id), install: partInstallCost(x.id) }));
  }
  function sellPart(run, partId) {
    if (!canSellParts(run)) throw new Error("这里没人收改装件（去商店或者工匠那里卖）");
    if (!WEAPON_PARTS[partId] || bagCount(weaponPartItemId(partId)) < 1) throw new Error("背包里没有这件改装件");
    const price = partSellPrice(partId);
    bagAdd(weaponPartItemId(partId), -1);
    state.kuizhi = (Number(state.kuizhi) || 0) + price;
    return logAll(run, [`卖掉改装件 ${weaponPartLabel(partId)}，得到 ${price} 奎支。`]);
  }
  function partOwner(run, kit) {
    const h = run.party.find(x => (x.weapons || []).indexOf(kit) >= 0);
    if (!h) throw new Error("队伍里没有这把武器");
    return h;
  }
  /** 在工匠处装上改装件：slot 槽位（从 0 数）；槽里原来的件放回背包 */
  function installPart(run, kit, slot, partId, smithId) {
    requireSmith(run, smithId);
    const h = partOwner(run, kit);
    if (!WEAPON_PARTS[partId] || bagCount(weaponPartItemId(partId)) < 1) throw new Error("背包里没有这件改装件");
    const row = weaponPartRow(h, kit);
    if (!row.length) throw new Error(`${heroName(kit)} 要升到 ${WEAPON_PART_SLOT_LEVELS[0]} 级才有改装槽`);
    const i = Math.floor(Number(slot) || 0);
    if (i < 0 || i >= row.length) throw new Error(`${heroName(kit)} 只有 ${row.length} 个改装槽`);
    const cost = partInstallCost(partId);
    if ((Number(state.kuizhi) || 0) < cost) throw new Error(`奎支不够：装上要 ${cost}`);
    state.kuizhi -= cost;
    bagAdd(weaponPartItemId(partId), -1);
    const notes = [];
    if (row[i]) { bagAdd(weaponPartItemId(row[i]), 1); notes.push(`拆下 ${weaponPartLabel(row[i])} 放回背包。`); }
    row[i] = partId;
    h.weaponParts = h.weaponParts || {};
    h.weaponParts[kit] = row;
    notes.push(`工匠把 ${weaponPartLabel(partId)}（${weaponPartText(partId)}）装到 ${heroName(kit)} 的第 ${i + 1} 个改装槽，工钱 ${cost} 奎支。`);
    return logAll(run, notes);
  }
  /** 装改装件之前 / 之后的数值（工匠装件界面做对比用；纯计算，不动背包、不扣钱）。
   *  slot 不传 = 第一个空槽，没有空槽就第 1 个（替换）。
   *  → { kit, weapon, slot, part, replaced, cost, before: Stats, after: Stats, delta: { atk, block, hp } } | null
   *  Stats = { atk, block（%）, hp: { 层类型: 上限 } | null, coefs: { 属性: 补正 }, parts: [改装件 id] } */
  function modInstallPreview(run, kit, weapon, partId, slot) {
    const h = (run.party || []).find(x => x.kit === kit && (x.weapons || []).includes(weapon));
    if (!h || !WEAPON_PARTS[partId]) return null;
    const row = weaponPartRow(h, weapon);
    if (!row.length) return null;
    let i = slot == null ? row.indexOf(null) : Math.floor(Number(slot) || 0);
    if (i < 0) i = 0;
    if (i >= row.length) return null;
    const u = spawnLiveCard(cardOf(h.kit), 1);
    applyHero(u, h);
    const lv = (h.weaponLevels || {})[weapon] || 1;
    const stats = parts => {
      const bd = weaponAtkBreakdown(weapon, u.attrs || {}, lv, parts);
      return { atk: bd.atk, block: partsBlock(parts), hp: weaponUnitHp(weapon, lv, parts), coefs: typeof weaponCoefs === "function" ? weaponCoefs(weapon, parts) : {}, parts: parts.slice() };
    };
    const now = row.filter(Boolean), next = row.slice();
    next[i] = partId;
    const before = stats(now), after = stats(next.filter(Boolean));
    const hpSum = s => Object.values(s.hp || {}).reduce((a, b) => a + (Number(b) || 0), 0);
    return { kit, weapon, slot: i, part: partId, replaced: row[i] || null, cost: partInstallCost(partId), before, after,
      delta: { atk: after.atk - before.atk, block: after.block - before.block, hp: hpSum(after) - hpSum(before) } };
  }
  /** 拆下改装件：不要钱，放回背包（要有工匠在场） */
  function removePart(run, kit, slot, smithId) {
    requireSmith(run, smithId);
    const h = partOwner(run, kit);
    const row = weaponPartRow(h, kit);
    const i = Math.floor(Number(slot) || 0);
    if (!row[i]) throw new Error("这个槽是空的");
    const id = row[i];
    row[i] = null;
    h.weaponParts = h.weaponParts || {};
    h.weaponParts[kit] = row;
    bagAdd(weaponPartItemId(id), 1);
    return logAll(run, [`拆下 ${heroName(kit)} 第 ${i + 1} 槽的 ${weaponPartLabel(id)}，放回背包（不要钱）。`]);
  }

  /** 本局各武器的图纸加成：kit → { atk, dur, block }。武器不到 4 级的（旧存档）图纸不生效 */
  function weaponModsOf(run) {
    const out = {};
    Object.keys((run && run.installed) || {}).forEach(k => {
      const bp = blueprintById(run.installed[k]);
      if (bp && bp.mod && bpLevelOk(run, k)) out[k] = Object.assign({}, bp.mod);
    });
    return out;
  }
  /** 这把武器够不够 4 级、装的图纸能不能生效（mods.js · BLUEPRINT_MIN_LEVEL） */
  function bpLevelOk(run, kit) {
    const h = run.party.find(x => (x.weapons || []).indexOf(kit) >= 0);
    return !!h && (typeof weaponRewardLevel === "function" ? weaponRewardLevel(h, kit) : (h.weaponLevels || {})[kit] || 1) >= BLUEPRINT_MIN_LEVEL;
  }
  /** 耐久上限变小（装上大杀器、耐久 −N 的图纸，或者旧存档里的图纸随升级生效）：当前耐久跟着压下来
   *  （跑团 trpg.js · trpgSyncWeaponMods 一样）。以前要等下次长休，期间耐久比上限还高 */
  function clampDur(run, h, kit) {
    const max = weaponDurMaxFor(h, kit, run);
    if (LEDGER.dur[kit] != null && Number(LEDGER.dur[kit]) > max) LEDGER.dur[kit] = max;
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
    if (t.part && WEAPON_PARTS[t.part]) {
      notes.push(`委托方额外给了一个改装件：${weaponPartLabel(t.part)}（${weaponPartText(t.part)}）。`);
      grantLoot(run, weaponPartItemId(t.part), 1, notes, "任务报酬");
    }
    run.party.forEach(h => { h.xp = (h.xp || 0) + pay.xp; });
    if (run.growth && G().fusionPerTask > 0) {
      bagAdd(G().fusionItem, G().fusionPerTask);
      notes.push(`获得 ${ITEM_CATALOG[G().fusionItem].name}×${G().fusionPerTask}（现有 ${bagCount(G().fusionItem)}），可以去角色抽取机抽角色。`);
    }
    const ei = escortInfo(run, t);
    if (ei && ei.intact) {
      const bonus = Math.round(pay.kuizhi * ESCORT_RULES.intactBonus / 100) * 100;
      state.kuizhi += bonus;
      notes.push(`${ei.name}完好送达（剩 ${ei.hp}/${ei.max}）：额外报酬 ${bonus} 奎支。`);
    } else if (ei) {
      notes.push(`${ei.name}送到了，但受损严重（剩 ${ei.hp}/${ei.max}），没有额外报酬。`);
    }
    const r = withParty(run, () => null);     // 摆上场按规则结算升级
    notes.push(...r.notes);
    run.tasksDone += 1;
    advanceDays(run, t.days);
    if (t.key) run.main.done = true;
    run.task = null;
    run.stage = "camp";
    return notes;
  }
  /** 任务失败（护送对象被摧毁）：没有报酬，照样花掉任务天数，回城休整 */
  function failTask(run, notes, why, label) {
    const t = run.task;
    notes.push(`${label || "护送失败"}：${why}，任务「${t.name}」失败，没有报酬。`);
    advanceDays(run, t.days);
    run.task = null;
    run.stage = "camp";
    return notes;
  }
  /** 长线养成：每天获得 1 个赫心融合体（按天数差补发，避免重复） */
  function grantDailyFusion(run, notes) {
    if (!run || !run.growth) return;
    const today = Number(run.day) || 1;
    const last = Number(run.lastFusionDay) || 0;
    if (today <= last) return;
    const n = today - last;
    bagAdd(G().fusionItem, n);
    run.lastFusionDay = today;
    const name = (ITEM_CATALOG[G().fusionItem] || {}).name || "赫心融合体";
    (notes || []).push(`第 ${today} 天：获得 ${name}×${n}（现有 ${bagCount(G().fusionItem)}）。`);
  }
  
  /* ---------- 长线养成：每日挑战 ----------
   * 每天按日期种子刷 3 个：1 个角色任务 + 2 个通用任务。
   * 角色任务：从持有角色里随机挑一个，用该角色完成 1 次指定类型的任务。
   * 通用任务：造成（最高等级×100）点持有属性伤害 / 15 击破 / 击杀杂兵 / 击杀精英 等。
   * 每个完成：随机武器材料 + 1000 奎支；三个全完成：额外 1 个赫心融合体。 */
  const GROWTH_DAILY_TYPES = ["battle", "elite", "check"];
  const GROWTH_CHAR_TASKS = [
    { id: "char_task", name: (n) => `${n} 完成任务`, desc: (n, type) => `使用 ${n} 完成 1 次${ROGUE_NODE_TYPES[type]?.label || type}` },
    { id: "char_kill", name: (n) => `${n} 击杀`, desc: (n) => `使用 ${n} 击杀 3 个敌人` },
    { id: "char_brk", name: (n) => `${n} 击破`, desc: (n) => `使用 ${n} 打出 6 点击破` }
  ];
  const GROWTH_GENERAL_POOL = [
    { id: "dmg", name: "造成伤害", desc: (lv, els) => `造成 ${lv * 100} 点${els.length ? "（" + els.join("/") + "）" : ""}伤害`, target: (lv) => lv * 100 },
    { id: "brk", name: "造成击破", desc: () => "造成 15 点击破", target: () => 15 },
    { id: "kill_minion", name: "击杀杂兵", desc: () => "击杀 20 个杂兵", target: () => 20 },
    { id: "kill_elite", name: "击杀精英", desc: () => "击杀 6 个精英", target: () => 6 },
    { id: "stagger", name: "打出失衡", desc: () => "造成 8 次失衡", target: () => 8 },
    { id: "assist", name: "协助攻击", desc: () => "发动 6 次协助攻击", target: () => 6 },
    { id: "block", name: "协助格挡", desc: () => "成功协助格挡 5 次", target: () => 5 },
    { id: "elem_dmg", name: "属性伤害", desc: (lv, els) => `造成 ${lv * 80} 点${els.length ? pick(els) : "任意"}属性伤害`, target: (lv) => lv * 80 },
    { id: "no_death", name: "无死亡通关", desc: () => "完成 1 个任务且无人倒下", target: () => 1 },
    { id: "long_rest", name: "长休", desc: () => "进行 1 次长休", target: () => 1 },
    { id: "check_ok", name: "完成检定", desc: () => "成功完成 2 次熟练项检定", target: () => 2 },
    { id: "shop", name: "商店消费", desc: () => "在商店花费 500 奎支", target: () => 500 },
    { id: "weather", name: "更换天气", desc: () => "主动将天气改为指定天气 1 次", target: () => 1 }
  ];
  function growthDailyKey(run) {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }
  function ensureGrowthDaily(run) {
    if (!run || !run.growth) return null;
    const key = growthDailyKey(run);
    if (run.growthDaily && run.growthDaily.key === key) return run.growthDaily;
    const owned = (run.party || []).concat(run.reserve || []);
    const maxLv = Math.max(1, ...owned.map(h => h.level || 1));
    const els = [...new Set(owned.flatMap(h => {
      const note = (typeof HEROES !== "undefined" && HEROES.find(x => x.kit === h.kit) || {}).note || "";
      const m = note.match(/([冰电能量火物理谐波酸]+)/);
      return m ? m[1].split("") : [];
    }))];
    const seed = `${run.seed || "g"}:${key}`;
    const daily = withRng(seed, () => {
      const char = owned.length ? pick(owned) : null;
      const charName = char ? heroName(char.kit) : "角色";
      const charTask = pick(GROWTH_CHAR_TASKS);
      const type = pick(GROWTH_DAILY_TYPES);
      const gens = GROWTH_GENERAL_POOL.slice();
      const g1 = gens.splice(Math.floor(Math.random() * gens.length), 1)[0];
      const g2 = gens.splice(Math.floor(Math.random() * gens.length), 1)[0];
      const charTarget = charTask.id === "char_kill" ? 3 : charTask.id === "char_brk" ? 6 : 1;
      return {
        key,
        tasks: [
          { id: charTask.id, name: charTask.name(charName), desc: charTask.desc(charName, type), kit: char?.kit || null, type, progress: 0, target: charTarget, done: false },
          { id: g1.id, name: g1.name, desc: g1.desc(maxLv, els), progress: 0, target: g1.target(maxLv), done: false },
          { id: g2.id, name: g2.name, desc: g2.desc(maxLv, els), progress: 0, target: g2.target(maxLv), done: false }
        ],
        allDone: false
      };
    });
    run.growthDaily = daily;
    return daily;
  }
  function updateGrowthDailyProgress(run, notes) {
    const daily = ensureGrowthDaily(run);
    if (!daily) return;
    // 简单进度：胜利时按任务类型累加（实际伤害/击杀数据可后续接入 ledger）
    const node = currentNode(run);
    const isElite = node && node.type === "elite";
    daily.tasks.forEach(t => {
      if (t.done) return;
      const inParty = t.kit && run.party.some(h => h.kit === t.kit);
      if (t.id === "char_task" && inParty && node && node.type === t.type) {
        t.progress = Math.min(t.target, t.progress + 1);
      } else if (t.id === "char_kill" && inParty) {
        t.progress = Math.min(t.target, t.progress + 1);
      } else if (t.id === "char_brk" && inParty) {
        t.progress = Math.min(t.target, t.progress + 2);
      } else if (t.id === "dmg") {
        t.progress = Math.min(t.target, t.progress + Math.floor(t.target * 0.3));
      } else if (t.id === "brk") {
        t.progress = Math.min(t.target, t.progress + 3);
      } else if (t.id === "kill_minion") {
        t.progress = Math.min(t.target, t.progress + (isElite ? 0 : 4));
      } else if (t.id === "kill_elite") {
        t.progress = Math.min(t.target, t.progress + (isElite ? 1 : 0));
      } else if (t.id === "stagger") {
        t.progress = Math.min(t.target, t.progress + 2);
      } else if (t.id === "assist") {
        t.progress = Math.min(t.target, t.progress + 2);
      } else if (t.id === "block") {
        t.progress = Math.min(t.target, t.progress + 1);
      } else if (t.id === "elem_dmg") {
        t.progress = Math.min(t.target, t.progress + Math.floor(t.target * 0.25));
      } else if (t.id === "no_death") {
        t.progress = Math.min(t.target, t.progress + 1);
      } else if (t.id === "weather") {
        // 本场我方主动改过天气（app.js · setWeather 记数）
        t.progress = Math.min(t.target, t.progress + (Number(state.playerWeatherChanges) || 0));
      }
      // long_rest / check_ok / shop 不在战后结算：分别在 doLongRest / attemptCheck / buy 里写入（growthDailyBump）
      if (t.progress >= t.target && !t.done) completeGrowthDailyTask(run, t, notes);
    });
  }
  /** 长线养成每日任务：给指定 id 的任务加进度（长休 / 检定成功 / 商店消费在发生的地方调用） */
  function growthDailyBump(run, id, n, notes) {
    if (!run || !run.growth || !(n > 0)) return;
    const daily = ensureGrowthDaily(run);
    if (!daily) return;
    daily.tasks.forEach(t => {
      if (t.id !== id || t.done) return;
      t.progress = Math.min(t.target, t.progress + n);
      if (t.progress >= t.target) completeGrowthDailyTask(run, t, notes);
    });
  }
  function completeGrowthDailyTask(run, task, notes) {
    if (!task || task.done) return;
    task.done = true;
    task.progress = task.target;
    // 材料概率：50% 金属 / 30% 精炼合金 / 14% 聚合材料 / 4% 稀有晶体 / 2% 赫心结晶
    const roll = Math.random();
    const mat = roll < 0.50 ? "mat_metal"
      : roll < 0.80 ? "mat_alloy"
      : roll < 0.94 ? "mat_polymer"
      : roll < 0.98 ? "mat_crystal"
      : "mat_heart";
    bagAdd(mat, 1);
    state.kuizhi = (Number(state.kuizhi) || 0) + 1000;
    notes.push(`每日挑战「${task.name}」完成：获得 ${(ITEM_CATALOG[mat]||{}).name || mat}×1 和 1000 奎支。`);
    const all = run.growthDaily.tasks.every(t => t.done);
    if (all && !run.growthDaily.allDone) {
      run.growthDaily.allDone = true;
      bagAdd(G().fusionItem, 1);
      state.kuizhi = (Number(state.kuizhi) || 0) + 1000;
      notes.push(`三个每日挑战全部完成：额外获得 ${(ITEM_CATALOG[G().fusionItem]||{}).name || "赫心融合体"}×1 和 1000 奎支。`);
    }
  }
function advanceDays(run, n) {
    run.actDay = (run.actDay || 0) + n;
    run.day += n;
    LEDGER.day = run.day;      // 队伍档案的「第几天」（整局数据里每场战斗的时间）跟着本局走，不再另算（ledger.js · ledgerInRun）
    LEDGER.shortUsed = {};     // 新的一天，短休次数刷新
    grantDailyFusion(run);     // 长线养成每天发赫心融合体
  }

  /** 休整一次：补给够就长休，不够只能硬撑。之后回任务板、进首领战，或者主线过期 → 结束 */
  function camp(run, plan) {
    if (run.stage !== "camp") throw new Error("现在不是休整的时候");
    const notes = [];
    plan = restChoice(plan);
    if (canLongRest(run, plan)) doLongRest(run, notes, null, plan);
    else {
      notes.push("补给不足，无法长休，只能硬撑着过夜。");
      passHours(run, C.hours.longRest, notes);
      if (run.stage === "over") return logAll(run, notes);
    }
    advanceDays(run, C.restDays);
    if (run.growth) {
      makeBoard(run);
      return logAll(run, notes);
    }
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
  /** 幕间选择：下一幕可以去哪（原本的区域，第 2–4 幕再加一个采矿场）。
   *  [{ region, alt, desc, enemies: [名字…] }]；额外幕只有原本的区域 */
  function interludeOptions(run) {
    const next = run.act + 1;
    const out = [defaultRegion(next)];
    const alt = !run.extra && C.altRegions && C.altRegions[next];
    if (alt && out.indexOf(alt) < 0) out.push(alt);
    const places = typeof WORLD_PLACES !== "undefined" ? WORLD_PLACES : [];
    const info = typeof ENEMY_INFO !== "undefined" ? ENEMY_INFO : {};
    const names = typeof enemyPresets === "function" ? Object.fromEntries(enemyPresets().map(p => [p.id, p.name])) : {};
    return out.map((reg, i) => ({
      region: reg, alt: i > 0, desc: ((places.find(p => p.name === reg) || {}).desc) || "",
      enemies: Object.keys(info).filter(id => (info[id].regions || []).indexOf(reg) >= 0).map(id => names[id] || id)
    }));
  }
  /** 去下一幕。pick：幕间选的区域（不给就走原本的区域） */
  function nextAct(run, pick) {
    if (run.stage !== "interlude") throw new Error("现在不是幕间");
    const opts = interludeOptions(run);
    const choice = pick ? opts.find(o => o.region === pick) : opts[0];
    if (!choice) throw new Error("下一幕不能去这里");
    run.act += 1;
    run.regionPick = Object.assign({}, run.regionPick || {}, { [run.act]: choice.region });
    const notes = [`进入第 ${run.act} 幕：${region(run)}${choice.alt ? "（幕间选择：改走采矿场）" : ""}。`];
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
    if (run.daily) dailyRecord(run);
  }

  /* ---------- 每日挑战（#52） ----------
   * 每天一个固定种子（本机日期），所有人打同一局：队伍由种子抽，专长每次 4 选 1、选项也由种子定。
   * 每次专长选择记下「出现了哪几个、选了哪个」，局结束时连同队伍和结果存到本机（DAILY_STATS_KEY），用来算选取率。 */
  const DAILY_STATS_KEY = "antlerscale.daily.v1";
  const D = () => C.daily || {};
  const pad2 = (n) => String(n).padStart(2, "0");
  /** 本机日期 YYYY-MM-DD；传字符串就原样用 */
  function dailyDate(date) {
    if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const d = date instanceof Date ? date : new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function dailySeed(date) { return "daily-" + dailyDate(date); }
  /** 种子定队伍：从全部角色里随便抽，不限职责搭配（全是坦克、没有输出都可能，方便测极端情况） */
  function dailyParty(seed, size) {
    size = size || D().partySize || 4;
    const left = heroPool().map(c => c.kit);
    return withRng(`${seed}:daily-party`, () => {
      const out = [];
      while (out.length < size && left.length) out.push(left.splice(Math.floor(Math.random() * left.length), 1)[0]);
      return out;
    });
  }
  /** 每日挑战的专长选项：这个人第 N 次选专长 → 按种子抽 featOffer 个（抽一次就记下，读档、刷新都一样），并记一次「出现」 */
  function dailyFeatOffer(run, h, p, ids) {
    const key = `${h.kit}:${(h.feats || []).length}`;
    const offers = run.daily.offers = run.daily.offers || {};
    if (!offers[key]) {
      const n = D().featOffer || 4;
      offers[key] = withRng(`${run.seed}:feat:${key}`, () => {
        const left = ids.slice(), out = [];
        while (out.length < n && left.length) out.push(left.splice(Math.floor(Math.random() * left.length), 1)[0]);
        return out;
      });
      run.featLog = run.featLog || [];
      run.featLog.push({ key, kit: h.kit, level: p.level, offered: offers[key].slice(), picked: null });
    }
    return offers[key].filter(id => ids.indexOf(id) >= 0);
  }
  function dailyNotePick(run, kit, value) {
    const row = (run.featLog || []).find(r => r.kit === kit && r.picked == null && r.offered.indexOf(value) >= 0);
    if (row) row.picked = value;
  }
  function dailyStorage() {
    try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (e) { return null; }
  }
  function dailyStats() {
    const ls = dailyStorage();
    try { const s = ls && JSON.parse(ls.getItem(DAILY_STATS_KEY) || "null"); return s && Array.isArray(s.runs) ? s : { runs: [] }; } catch (e) { return { runs: [] }; }
  }
  /** 局结束：把这一局的队伍、结果、专长选择存到本机（同一局只记一次） */
  function dailyRecord(run) {
    if (!run.daily || run.daily.recorded) return;
    run.daily.recorded = true;
    const s = dailyStats();
    s.runs.push({ date: run.daily.date, seed: run.seed, party: (run.daily.party || run.party.map(h => h.kit).concat((run.fallen || []).map(f => f.kit))).slice(), result: clone(run.result || null), feats: clone(run.featLog || []) });
    const keep = D().keepRuns || 200;
    if (s.runs.length > keep) s.runs = s.runs.slice(-keep);
    const ls = dailyStorage();
    try { if (ls) ls.setItem(DAILY_STATS_KEY, JSON.stringify(s)); } catch (e) { /* 存不下就算了 */ }
  }
  /** 选取率：{ 专长 id: { shown, picked, rate } }（本机记下的每日挑战） */
  function featPickRates(stats) {
    const out = {};
    ((stats || dailyStats()).runs || []).forEach(r => (r.feats || []).forEach(f => {
      (f.offered || []).forEach(id => { const o = out[id] = out[id] || { shown: 0, picked: 0 }; o.shown++; });
      if (f.picked) { const o = out[f.picked] = out[f.picked] || { shown: 0, picked: 0 }; o.picked++; }
    }));
    Object.keys(out).forEach(id => { out[id].rate = out[id].shown ? out[id].picked / out[id].shown : 0; });
    return out;
  }

  /* ---------- 长线养成：角色抽取机、候补 ---------- */
  function requireGrowth(run) {
    if (!run || !run.growth) throw new Error("只有长线养成有这个");
  }
  /** 抽取机的状态：{ fusion, cost, canDraw, why, pool: [{ kit, name, owned, level }] } */
  function drawInfo(run) {
    requireGrowth(run);
    const fusion = bagCount(G().fusionItem);
    const all = run.party.concat(run.reserve || []);
    const pool = heroPool().map(c => {
      const h = all.find(x => x.kit === c.kit);
      return { kit: c.kit, name: c.name, owned: !!h, level: h ? h.level || 1 : 0 };
    });
    const why = run.stage !== "board" ? "回到任务板前才能用抽取机"
      : fusion < G().drawCost ? `${ITEM_CATALOG[G().fusionItem].name}不够（要 ${G().drawCost}，有 ${fusion}）`
      : pool.every(p => p.owned && p.level >= G().maxLevel) ? "所有角色都满级了" : null;
    return { fusion, cost: G().drawCost, canDraw: !why, why, pool };
  }
  /** 抽一次：所有角色等概率；新角色入队（满员进候补），已有的角色 +1 级（满级的不会抽到） */
  function drawHero(run) {
    const info = drawInfo(run);
    if (!info.canDraw) throw new Error(info.why);
    const cand = info.pool.filter(p => !(p.owned && p.level >= G().maxLevel)).map(p => p.kit);
    run.draws = (run.draws || 0) + 1;
    const kit = withRng(`${run.seed}:draw:${run.draws}`, () => pick(cand));
    bagAdd(G().fusionItem, -G().drawCost);
    const notes = [`投入 ${ITEM_CATALOG[G().fusionItem].name}×${G().drawCost}，抽取机吐出了……${heroName(kit)}！`];
    const h = run.party.concat(run.reserve || []).find(x => x.kit === kit);
    if (h) {
      const from = h.level || 1;
      h.level = from + 1;
      notes.push(`已经有 ${heroName(kit)} 了：${heroName(kit)} 升到 ${h.level} 级。`);
      queueLevelRewards(h, from, h.level, notes, run);
    } else {
      // 以前永久死亡过的角色：从 1 级重新开始
      const wasDead = (run.deadKits || []).indexOf(kit) >= 0;
      const startLv = wasDead ? 1 : G().recruitLevel;
      const nh = initHero({ kit, weapons: SaveStore.weaponsOf(kit), level: startLv, xp: 0, hp: null, shp: null, weaponState: {}, weaponLevels: wasDead ? {} : null });
      if (wasDead) {
        notes.push(`${heroName(kit)} 曾永久死亡，从 1 级重新培养。`);
        const di = run.deadKits.indexOf(kit);
        if (di >= 0) run.deadKits.splice(di, 1);
      }
      if (nh.level > 1) queueLevelRewards(nh, 1, nh.level, notes, run);
      if (run.party.length < G().partyMax) {
        run.party.push(nh);
        notes.push(`${heroName(kit)} 加入队伍（${nh.level} 级）。`);
      } else {
        run.reserve.push(nh);
        notes.push(`${heroName(kit)} 加入候补（队伍已满 ${G().partyMax} 人，任务板前可以换上场）。`);
      }
    }
    return { kit, levelUp: !!h, notes: logAll(run, notes) };
  }
  /** 换人：候补 inKit 换下队伍里的 outKit（outKit 不给就是直接加入，队伍要有空位）；inKit 不给就是 outKit 下场 */
  function swapHero(run, outKit, inKit) {
    requireGrowth(run);
    if (run.stage !== "board") throw new Error("回到任务板前才能换人");
    const oi = outKit ? run.party.findIndex(h => h.kit === outKit) : -1;
    const ii = inKit ? run.reserve.findIndex(h => h.kit === inKit) : -1;
    if (outKit && oi < 0) throw new Error("队伍里没有这名角色");
    if (inKit && ii < 0) throw new Error("候补里没有这名角色");
    if (!inKit && run.party.length <= 1) throw new Error("队伍至少要留 1 人");
    if (inKit && !outKit && run.party.length >= G().partyMax) throw new Error(`队伍满员（${G().partyMax} 人），要先换下一个人`);
    const out = oi >= 0 ? run.party.splice(oi, 1)[0] : null;
    const inn = ii >= 0 ? run.reserve.splice(ii, 1)[0] : null;
    if (inn) run.party.push(inn);
    if (out) run.reserve.push(out);
    const notes = [inn && out ? `${heroName(inn.kit)} 上场，${heroName(out.kit)} 换到候补。` : inn ? `${heroName(inn.kit)} 上场。` : `${heroName(out.kit)} 换到候补。`];
    return logAll(run, notes);
  }

  /** 路线图上每一列大约几点到（只算节点本身和路上的时间，不算休息）：[{ text, night, days } | null] */
  function routeEta(run) {
    const t = run && run.task;
    if (!t) return [];
    const cols = t.cols || t.nodes.map(n => [n ? n.type : "battle"]);
    const hoursOf = (type) => Number((NODE[type] || {}).hours) || 0;
    const idx = t.index || 0;
    const here = t.nodes[idx];
    let h = 0;
    return cols.map((col, c) => {
      if (c < idx) return null;
      if (c === idx) {
        if (!here) h = idx > 0 ? travelHours(run) : 0;   // 还没选这一站：走过去要时间
        const out = clockAfter(h);
        h += hoursOf(here ? here.type : col[0]);
        return out;
      }
      h += travelHours(run);
      const out = clockAfter(h);
      const n = t.nodes[c];
      h += hoursOf(n ? n.type : col.reduce((m, x) => Math.max(m, hoursOf(x)), 0));
      return out;
    });
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
      feats: (typeof featIds === "function" ? featIds(h) : []).map(id => FEATS[id].name),
      pendingBreak: (h.pendingBreaks || []).reduce((a, b) => a + (Number(b.amount) || 0), 0),
      weapons: h.weapons.map(k => {
        const w = weaponCarryLayers(k);
        const cur = w ? w.reduce((s, l) => s + (Number(l.current) || 0), 0) : null;
        return { kit: k, name: heroName(k), level: (h.weaponLevels || {})[k] || 1,
          dur: weaponDurFor(h, k, run), durMax: weaponDurMaxFor(h, k, run), hp: cur,
          blueprint: (run.installed || {})[k] ? blueprintById(run.installed[k]) : null,
          bpOff: !!(run.installed || {})[k] && !bpLevelOk(run, k),   // 装着图纸但武器不到 4 级：不生效
          parts: weaponPartRow(h, k).map(id => id ? { id, name: weaponPartLabel(id), text: weaponPartText(id) } : null) };
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
    const base = weaponBaseDur(k, (h.weaponLevels || {})[k] || 1);
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
    checkInfo, checkChance, checkOdds, attemptCheck, skipCheck, heroProfs, parleyOptions, parley,
    role2Options, soloBattleInfo,
    restPlan, restOptions, canLongRest, sheetData, armoryData, lowHpWarning, escortInfo, partOffers, buyPart, sellPart, canSellParts, partStock, partSellPrice, partInstallCost, installPart, removePart, restAtNode, leaveNode, canShortRestBefore, shortRestBeforeNode,
    ambushChance, watchOptions,
    interludeOptions, campStatus: campStatusOf, buy, shopPoints, redeemList, redeem, craftPlace, craftList, craftOdds, craft, knowsRecipe, learnOptions, learnRecipe, rollRecipeChip, salvageList, salvage, setCraftHooks, setCraftJob, craftQueue, craftQueued, bagCounts, inventory, recipeStatus, recipeBook, materialUses, workshopAvailable, craftListGrouped, craftPreview, recipesUsingMaterial, setBagOwnership, bagByCategory, materialBar, cyberSummary, modInstallPreview, matchupChart: (w, o) => matchupChart(w, o), matchupForState: (st, id) => matchupForState(st, id), itemCategory: id => itemCategory(id),  canShop, shopItemName, shopStock, smithOptions, smithCost, upgradeWeapon, repairWeapon, taskPay,
    presentSmiths, smithInfo, claimBlueprint, installBlueprint, blueprintById, weaponModsOf,
    smithQuote, introduceSmith,
    canClinic, cyberInfo, cyberPreview, cyberCost, modifyHero, cyberwarePacketFor, cyberwarePreviewFor, installCyberware, removeCyberware, healCost, healHero,
    pendingChoices, choiceOptions, choose, queueLevelRewards,
    dailyDate, dailySeed, dailyParty, dailyStats, featPickRates,
    drawInfo, drawHero, swapHero, partyLevel, growthXp: () => growthOn, routeEta, growthDaily: ensureGrowthDaily, growthDailyBump,
    camp, nextAct, afterVictory, endRun,
    enterRunMode, leaveRunMode, syncWorld, save, inRunMode: () => !!stash,
    setLootHandler, grantLoot, rollItemDrops
  };
})();
