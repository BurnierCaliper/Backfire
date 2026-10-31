/* 角鳞 · 无界面战斗的「列动作 + 沙盒试跑 + 平行世界」（sim-search.js）
 *
 * 只给模拟、测试、工具用（游戏里玩家这边没有 AI）。两处共用这一份：
 *   - tools/dpt.js：理想状态下每个角色的输出循环（束搜索）
 *   - sim.js · BattleSim.SKILL_POLICY：看情况用技能的打法（每一步列出合法动作，在沙盒里试跑，按打分挑）
 *
 *   列动作      candidateActions：每个能行动的玩家单位的每个技能 × 每种分步选择 × 每个目标、移动、（可选）道具
 *   沙盒试跑    snap / load 存取整个局面（state + 队伍档案 LEDGER），execute 照战斗指令执行一次、结算完格挡 / 协助
 *   平行世界    trial：同一个动作在几份局面（同一串动作、不同的骰子）里各跑一遍，各自记一个数（调用方取平均）
 *   沙盒        sandbox：试跑期间换掉战斗日志、骰子，跑完把局面、日志、骰子原样还回去（真实战斗的随机数一个都不动）
 *
 * 动作写成战斗指令（battle-commands.js）：{ type: "skill", actor, skill, target, picks } / { type: "move", actor, dest } /
 * { type: "useItem", actor, item, target, dest }。不同的平行世界里唤出的武器人编号不一样（编号走随机数），
 * 所以记动作时把玩家单位的编号换成「@kit」（tokenize），执行前再换回当时场上的编号（resolve）。
 */
const BATTLE_SEARCH_CFG = {
  flowMax: 40,     // 一个技能的分步选择最多列几种（列到这么多就不再往下展开）
  flowDepth: 6,    // 分步最多展开几层
  // 局面快照里不拷贝、原样留着的（战斗记录、计算器的撤销记录、画面）：规则不读它们，拷贝又很慢（撤销记录最多 30 份单位）
  skip: ["roster", "history", "logPages", "floaters"],
  // 试跑时不当成主动出手的技能：反应（格挡、协助、借机攻击）只在被问的时候用
  reaction: /_opp$|_block$|assist/
};

const BattleSearch = (function () {
  "use strict";
  const SKIP = new Set(BATTLE_SEARCH_CFG.skip);

  /* ---------- 局面存取（state + LEDGER） ---------- */
  /** 深拷贝纯数据（和 game.js · deepClone 同一种：数组、普通对象逐层拷贝，其他对象原样引用）。
   *  「普通对象」按原型链认（原型的原型是 null）：测试、工具从外面（Node）塞进来的普通对象也照样拷贝 */
  function cloneData(o, seen) {
    if (o === null || typeof o !== "object") return o;
    if (seen.has(o)) return seen.get(o);
    if (Array.isArray(o)) {
      const a = new Array(o.length);
      seen.set(o, a);
      for (let i = 0; i < o.length; i++) a[i] = cloneData(o[i], seen);
      return a;
    }
    const proto = Object.getPrototypeOf(o);
    if (proto !== null && Object.getPrototypeOf(proto) !== null) return o;
    const out = {};
    seen.set(o, out);
    for (const k of Object.keys(o)) out[k] = cloneData(o[k], seen);
    return out;
  }
  /** 整个 state 一起拷（同一个对象在几处被引用时，拷出来也是同一个） */
  function copyState(keys, from) {
    const seen = new Map(), data = {};
    keys.forEach(k => { data[k] = SKIP.has(k) ? from[k] : cloneData(from[k], seen); });
    return data;
  }
  /** 存一份局面：之后 load 多少次都行（存的时候拷一份，读的时候再拷一份，存下的那份不会被改） */
  function snap() {
    const keys = Object.keys(state);
    return { keys, data: copyState(keys, state), ledger: typeof LEDGER !== "undefined" && LEDGER ? LEDGER.save() : null };
  }
  function load(s) {
    const keep = new Set(s.keys);
    Object.keys(state).forEach(k => { if (!keep.has(k)) delete state[k]; });
    const data = copyState(s.keys, s.data);
    s.keys.forEach(k => { state[k] = data[k]; });
    if (s.ledger && typeof LEDGER !== "undefined" && LEDGER) LEDGER.load(JSON.parse(JSON.stringify(s.ledger)));
  }

  /** 用来判断「这一下有没有真的做了什么」以及去重 */
  function signature() {
    return JSON.stringify(state.units.filter(u => !u._removed).map(u => [u.id, u.zone, u.hidden ? 1 : 0, u.dead ? 1 : 0, u.ap, u.bonus,
      (u.layers || []).map(l => l.current), u.def, u.statuses, u.instant, u.self, u.resources, u.highEnergy, u.focuses]));
  }

  /* ---------- 列出合法动作 ---------- */
  /** 现在能行动的玩家单位（有行动点或附赠、没晕眩、在场） */
  function actors() {
    return state.units.filter(u => u.isPlayer && !u.hidden && !u.dead && !u._removed && !u.fused &&
      ((u.ap || 0) > 0 || (u.bonus || 0) > 0) && !u.stunned);
  }
  /** 技能的分步选择：深度优先列出每一种选法（单位 / 区域 / 选项；可选的那一步多一种「不选」） */
  function flowPicks(id, actor, picks, depth, out) {
    if (out.length > BATTLE_SEARCH_CFG.flowMax) return;
    let steps = [];
    try { steps = skillFlowSteps(id, actor, picks) || []; } catch (e) { steps = []; }
    const step = steps.find(s => picks[s.key] === undefined);
    if (!step || depth > BATTLE_SEARCH_CFG.flowDepth) { out.push(Object.assign({}, picks)); return; }
    let vals = [];
    if (step.type === "unit") vals = (step.units || []).map(u => u.id);
    else if (step.type === "zone") vals = (step.zones || []).map(Number);
    else vals = (step.options || []).map(o => o.value);
    if (step.optional || !vals.length) vals = vals.concat([null]);
    vals.forEach(v => flowPicks(id, actor, Object.assign({}, picks, { [step.key]: v }), depth + 1, out));
  }
  /** 行动点 / 附赠够、前提满足 */
  function affordable(a, id) {
    const cost = skillCost(id) || {};
    if ((cost.ap || 0) > (a.ap || 0) || (cost.bonus || 0) > (a.bonus || 0)) return false;
    return !skillRequirementError(a, id);
  }
  /**
   * 列出合法动作（候选）。不给 opt 时：所有能行动的玩家单位、每个技能 × 每种分步选择 × 每个目标（分步里没选目标的：不选 + 场上每个单位）、
   * 走到每个相连的区（tools/dpt.js 用这个）。opt：
   *   actors    只列这几个单位的
   *   targets   (a, sk, picks) → 目标编号列表（分步里没选目标时用；不给 = 不选 + 场上每个单位）
   *   canMove   (a) → 能不能走（不给 = 有行动点或附赠就能）
   *   skip      (a, sk) → true 不列这个技能
   *   items     true：再列背包里能在战斗中用的道具（itemTargets 决定目标）
   *   itemTargets (a, spec) → [{ target, dest }]
   */
  function candidateActions(opt) {
    opt = opt || {};
    const out = [];
    (opt.actors || actors()).forEach(a => {
      let list = [];
      try { list = skillList(a) || []; } catch (e) { list = []; }
      list.forEach(sk => {
        if (!sk || !sk.id || (opt.skip && opt.skip(a, sk))) return;
        if (!affordable(a, sk.id)) return;
        const picksList = [];
        flowPicks(sk.id, a, {}, 0, picksList);
        picksList.forEach(picks => {
          const flowTarget = picks.target;
          const targets = flowTarget !== undefined ? [flowTarget] : opt.targets ? opt.targets(a, sk, picks) :
            [null].concat(state.units.filter(u => !u.hidden && !u.dead && !u._removed).map(u => u.id));
          targets.forEach(t => out.push({ type: "skill", actor: a.id, skill: sk.id, target: t || null, picks, label: `${a.name}·${sk.name}` }));
        });
      });
      if (opt.items && (a.bonus || 0) > 0 && !a.dying && typeof ITEM_CATALOG !== "undefined" && typeof bagCount === "function") {
        Object.keys(ITEM_CATALOG).forEach(id => {
          const spec = ITEM_CATALOG[id];
          if (!spec || !(spec.combat || spec.effect) || spec.target === "weapon" || bagCount(id) < 1) return;
          (opt.itemTargets ? opt.itemTargets(a, spec) : [{ target: a.id }]).forEach(t =>
            out.push({ type: "useItem", actor: a.id, item: id, target: t.target || null, dest: t.dest != null ? t.dest : null, label: `${a.name}·${spec.name}` }));
        });
      }
      if (opt.canMove ? opt.canMove(a) : ((a.bonus || 0) > 0 || (a.ap || 0) > 0)) {
        (zoneNeighbors(a.zone) || []).forEach(z => out.push({ type: "move", actor: a.id, dest: Number(z), label: `${a.name}·移动到${z}区` }));
      }
    });
    return out;
  }

  /* ---------- 记录 / 重放用的编号 ---------- */
  // 玩家单位换成「@kit」（同一个角色、武器人在一场里只有一个）；alias(u) 给了别的记法就用它（tools/dpt.js 的训练假人是 @dummy）
  function tokenOf(id, alias) {
    const u = state.units.find(x => x.id === id);
    if (!u) return id;
    const a = alias && alias.token ? alias.token(u) : null;
    if (a) return a;
    return u.isPlayer ? "@" + u.kit : id;
  }
  function idOf(tok, alias) {
    if (typeof tok !== "string" || tok[0] !== "@") return tok;
    const live = state.units.filter(u => !u._removed);
    const hit = alias && alias.find ? alias.find(tok, live) : undefined;
    const u = hit !== undefined ? hit : (live.find(x => x.kit === tok.slice(1) && !x.hidden) || live.find(x => x.kit === tok.slice(1)));
    return u ? u.id : tok;
  }
  function tokenize(cmd, alias) {
    const out = Object.assign({}, cmd, { actor: tokenOf(cmd.actor, alias) });
    if (cmd.target) out.target = tokenOf(cmd.target, alias);
    if (cmd.picks) { out.picks = {}; Object.keys(cmd.picks).forEach(k => { out.picks[k] = typeof cmd.picks[k] === "string" ? tokenOf(cmd.picks[k], alias) : cmd.picks[k]; }); }
    return out;
  }
  function resolve(cmd, alias) {
    const out = Object.assign({}, cmd, { actor: idOf(cmd.actor, alias) });
    if (cmd.target) out.target = idOf(cmd.target, alias);
    if (cmd.picks) { out.picks = {}; Object.keys(cmd.picks).forEach(k => { out.picks[k] = idOf(cmd.picks[k], alias); }); }
    return out;
  }

  /* ---------- 执行 ---------- */
  /** 照战斗指令执行一次，再把格挡 / 协助 / 换刀头这些要选的结算按 policy 选完（不给 = BattleSim.BASIC_POLICY）。指令本身报错返回 false */
  function execute(cmd, policy) {
    const plain = JSON.parse(JSON.stringify(cmd)); delete plain.label;
    if (plain.type === "move") { delete plain.target; delete plain.picks; delete plain.skill; }
    if (plain.type === "useItem") { delete plain.picks; delete plain.skill; if (plain.dest == null) delete plain.dest; }
    try { BattleCommands.execute(plain); } catch (e) { return false; }
    try { BattleSim.resolveQueues(policy || BattleSim.BASIC_POLICY); } catch (e) { /* 结算队列出错就当这一步无效 */ }
    return true;
  }

  /* ---------- 平行世界 ---------- */
  /**
   * 同一个动作（tok，tokenize 过的）在每一份局面里各跑一遍：snaps[w] 是第 w 个平行世界（同一串动作、不同的骰子）。
   * 基准世界（第 0 个）里没做成（指令报错、局面一点没变）返回 null；opt.reject() 返回 true 也返回 null。
   *   seed(w)   这个世界用的种子（不给就不换骰子）       measure()  跑完记一个数（调用方取平均）
   *   before0   基准世界执行前的签名（给了省一次）       keep       false：不存跑完的局面（最后一层用不着）
   *   exec(cmd) 怎么执行（不给 = execute(cmd, policy)） snap()     怎么存局面（不给 = snap）
   *   alias     编号的别名（见 tokenOf）                 onBase()   基准世界跑完调一次，返回值放在 base
   * 返回 { snaps, vals, base }
   */
  function trial(snaps, tok, opt) {
    opt = opt || {};
    const out = { snaps: [], vals: [], base: null };
    for (let w = 0; w < snaps.length; w++) {
      load(snaps[w]);
      const before = w === 0 ? (opt.before0 != null ? opt.before0 : signature()) : null;
      if (opt.seed) RNG.install(opt.seed(w));
      const cmd = resolve(tok, opt.alias);
      const ok = opt.exec ? opt.exec(cmd) : execute(cmd, opt.policy);
      if (w === 0 && (!ok || signature() === before)) return null;
      if (opt.reject && opt.reject()) return null;
      out.vals.push(opt.measure ? opt.measure() : 0);
      if (opt.keep !== false) out.snaps.push(opt.snap ? opt.snap() : snap());
      if (w === 0 && opt.onBase) out.base = opt.onBase();
    }
    return out;
  }

  /* ---------- 沙盒 ---------- */
  // 正在沙盒里试跑（工具装的计数这时不该记：tools/pvp-balance.js · instrument）
  let BUSY = 0;
  function busy() { return BUSY > 0; }
  /**
   * 在沙盒里跑 fn(root)：root 是进沙盒时的局面。试跑期间战斗日志、计算器的撤销记录换成临时的，骰子由 fn 自己换（trial 的 seed）；
   * 跑完把局面、日志、撤销记录、骰子（种子随机数连同已经掷到第几个）原样还回去——真实战斗的随机数一个都不动，同一种子结果一样。
   */
  function sandbox(fn) {
    const keep = { seed: RNG.seed, fn: RNG.fn, random: Math.random, logPages: state.logPages, logIndex: state.logIndex, history: state.history };
    BUSY++;
    state.logPages = [{ turn: state.turnNo || 1, lines: [] }];
    state.logIndex = 0;
    state.history = [];
    const root = snap();
    try { return fn(root); } finally {
      load(root);
      state.logPages = keep.logPages; state.logIndex = keep.logIndex; state.history = keep.history;
      RNG.seed = keep.seed; RNG.fn = keep.fn; Math.random = keep.random;
      BUSY--;
    }
  }

  return { snap, load, cloneData: o => cloneData(o, new Map()), signature, actors, flowPicks, affordable, candidateActions, tokenOf, idOf, tokenize, resolve, execute, trial, sandbox, busy };
})();
