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

/* 看情况用技能的打法（sim.js · BattleSim.SKILL_POLICY）的设置。只给模拟、测试、工具用。
 * 轮到一个单位时：列出它所有的合法动作，每个动作在几个平行世界（不同的骰子）里试跑，按打分（跑完的局面比跑之前好了多少）取平均；
 * 留最好的 width 条路线接着往下看，这个单位自己的动作最多看 depth 步（连招、攒资源再放）；任何一步停下（结束这个单位的回合）都算一条路线，
 * 挑总分最高的那条，做它的第一步——做完、骰子出来以后再从头看一遍。一步都不做最好（分数都不到 0）就结束。
 * 分数的单位：把一名对手打掉一整条血 = w.hp（100）分，别的都按它比着定。坚毅生命只在 AI 自己算分时用（打到起身中的对手身上的伤害），
 * 不给任何人看。 */
const SKILL_POLICY_CFG = {
  width: 3,          // 束宽：每一步留几条路线往下看
  depth: 3,          // 这个单位一个回合里往前看几步
  worlds: 2,         // 平行世界几个（同一串动作、不同的骰子），分数取平均
  items: true,       // 用背包里的道具（背包空着就没有：PvP 平衡模拟满状态、不带道具）
  summon: true,      // 召唤武器人
  freeSkills: false, // 不花行动点、附赠的技能（开关、换姿态）：BattleSim 的回合循环里做了它这个单位就停下了，默认不用
  // 血量都按「一整条」= 场上角色（不含武器人）血量上限的平均数算：打首领一下和打角色一下按同样的点数算，
  // 不然首领血太厚，打它几乎不得分，AI 会一直去放增益
  w: {
    hp: 100,         // 对手掉的血：一整条 = 100
    shp: 60,         // 对手起身中（靠坚毅生命战斗）挨的伤害：一整条 = 60
    down: 60,        // 打倒一名对手（倒地）
    out: 120,        // 一名对手再起不能 / 死亡 / 离场（再加上打倒的分）
    stagger: 40,     // 打出失衡
    def: 30,         // 对手掉的架势：一整条 = 30
    ownHp: 80,       // 自己一方掉的血（一整条 = 80）；治疗回的血也按这个算
    ownShp: 50,      // 自己一方起身中掉的坚毅生命（自焚这类）
    ownDown: 60,
    ownOut: 120,
    ownStagger: 40,
    ownDef: 20,
    weapon: 0.5,     // 武器人的血、倒地、站位按这个比例算（决斗里武器人倒了不算输）
    // 攻击力（effectiveAtk）：一名角色的平均攻击力 = atk 分。增益 / 减益改了攻击力的照算；打倒攻击力高的对手更值。
    // 召唤武器人主要看它：多数角色唤出武器人以后自己的攻击力掉到只剩徒手，和武器人加起来差不多，武器人血又少，不一定划算
    atk: 60,         // 自己一方（在场、没倒地）的攻击力合计
    foeAtk: 40,      // 对手（在场、没倒地）的攻击力合计（扣分）
    weaponAtk: 0.8,  // 武器人的攻击力按这个比例算（血少，容易被打倒）
    summon: 8,       // 场上多一个自己的武器人（多一个能行动、能协助格挡的单位），再加上它的攻击力
    summonDecay: 0.1,  // 召唤的这一项每过一个回合少这么多（比例），最少剩 summonMin
    summonMin: 0.3,
    reach: 12,       // 普攻打得到至少一名对手（站位）
    risk: 15,        // 远程（同区打不了）留在有对手近战的区：每个近战对手扣这么多
    keepBonus: 10,   // 留着附赠（对面回合里能协助格挡）：身边有队友时，每个角色留着 1 个就算
    instant: 5,      // 对手身上每个即时效果（热熔、超频、预告……）
    self: 5,         // 自己人的自我效果（自焚、超导……）；对手的算负
    high: 1,         // 对手每 1 点高能值
    focus: 4,        // 对手身上每个聚焦
    // 状态效果：挂在对手身上加分、挂在自己人身上扣分（减益）；增益反过来。比一下普攻（一整条血的三分之一左右 ≈ 30 分）小，只拿来分高下
    debuff: { burn: 10, shock: 8, corr: 10, frostbite: 8, shockwave: 6, high: 10, reso: 6, weak: 8, blind: 6, unstable: 6, chase: 4 },
    buff: { inspire: 6, sturdy: 4, hide: 6, advantage: 6 }
  }
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
    // 先读队伍档案（它会顺手把水写进 state.bag），再整个盖回 state：局面和存的时候一模一样
    if (s.ledger && typeof LEDGER !== "undefined" && LEDGER) LEDGER.load(JSON.parse(JSON.stringify(s.ledger)));
    const keep = new Set(s.keys);
    Object.keys(state).forEach(k => { if (!keep.has(k)) delete state[k]; });
    const data = copyState(s.keys, s.data);
    s.keys.forEach(k => { state[k] = data[k]; });
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
    // 在这个单位的结算上下文里列（争斗两队同一个角色：按 kit 找到的是他自己，party.js · withKitScope）
    (opt.actors || actors()).forEach(a => (typeof withKitScope === "function" ? withKitScope(a, () => listFor(a)) : listFor(a)));
    return out;
    function listFor(a) {
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
    }
  }

  /* ---------- 记录 / 重放用的编号 ---------- */
  // 玩家单位换成「@kit」（同一个角色、武器人在一场里只有一个）；alias(u) 给了别的记法就用它（tools/dpt.js 的训练假人是 @dummy）。
  // 争斗（brawl.js）两队可以有同一个角色：场上同一个 kit 的玩家单位不止一个时接上队伍「@kit#1队」（武器人跟着持有者那一队）
  const teamOf = (u) => (typeof pvpDuelTeamOf === "function" ? pvpDuelTeamOf(u) : null);
  function tokenOf(id, alias) {
    const u = state.units.find(x => x.id === id);
    if (!u) return id;
    const a = alias && alias.token ? alias.token(u) : null;
    if (a) return a;
    if (!u.isPlayer) return id;
    const team = state.units.some(x => x !== u && x.isPlayer && x.kit === u.kit && !x._removed) ? teamOf(u) : null;
    return "@" + u.kit + (team ? "#" + team : "");
  }
  function idOf(tok, alias) {
    if (typeof tok !== "string" || tok[0] !== "@") return tok;
    const live = state.units.filter(u => !u._removed);
    const hit = alias && alias.find ? alias.find(tok, live) : undefined;
    const cut = tok.indexOf("#"), kit = cut > 0 ? tok.slice(1, cut) : tok.slice(1), team = cut > 0 ? tok.slice(cut + 1) : null;
    const pool = team ? live.filter(x => x.kit === kit && teamOf(x) === team) : live.filter(x => x.kit === kit);
    const u = hit !== undefined ? hit : (pool.find(x => !x.hidden) || pool[0]);
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
   * 在沙盒里跑 fn(root)：root 是进沙盒时的局面（load(root) 读出来的是拷贝）。试跑期间战斗日志、计算器的撤销记录换成临时的，
   * 骰子由 fn 自己换（trial 的 seed）。跑完把进沙盒时的局面原样放回去：state 的每一项还是原来那个对象（试跑只动拷贝，原来的一点没动，
   * 手里拿着的单位照样能用），队伍档案、日志、撤销记录、骰子（种子随机数连同已经掷到第几个）也都还回去——真实战斗的随机数一个都不动，
   * 同一种子结果一样。
   */
  function sandbox(fn) {
    const keys = Object.keys(state), refs = {};
    keys.forEach(k => { refs[k] = state[k]; });
    const keep = { seed: RNG.seed, fn: RNG.fn, random: Math.random, ledger: typeof LEDGER !== "undefined" && LEDGER ? LEDGER.save() : null };
    BUSY++;
    state.logPages = [{ turn: state.turnNo || 1, lines: [] }];
    state.logIndex = 0;
    state.history = [];
    const root = { keys: Object.keys(state), data: Object.assign({}, state), ledger: keep.ledger };
    try {
      // 先换成一份拷贝再交给 fn（队伍档案不用读：和现在一样；读了会往原来的 state.bag 里写水）
      const data = copyState(root.keys, root.data);
      root.keys.forEach(k => { state[k] = data[k]; });
      return fn(root);
    } finally {
      if (keep.ledger) LEDGER.load(JSON.parse(JSON.stringify(keep.ledger)));   // 先读档案（会写 state.bag 的水），再放回原来的 state
      Object.keys(state).forEach(k => { if (!Object.prototype.hasOwnProperty.call(refs, k)) delete state[k]; });
      keys.forEach(k => { state[k] = refs[k]; });
      RNG.seed = keep.seed; RNG.fn = keep.fn; Math.random = keep.random;
      BUSY--;
    }
  }

  /* ---------- 看情况用技能：打分 ---------- */
  const isWeapon = (u) => typeof isWeaponUnit === "function" && isWeaponUnit(u);
  const onField = (u) => !!u && !u.hidden && !u.dead && !u._removed && !u.fused;
  const downed = (u) => !!u && !!u.dying && !u.upOnShp;
  const hpNow = (u) => (u.layers || []).reduce((s, l) => s + Math.max(0, Number(l.current) || 0), 0);
  const zdist = (a, b) => zoneDist(Number(a), Number(b), Number(state.zoneMode));
  const on = (v) => v === true || (typeof v === "number" && v > 0);
  /** 普攻的射程（站位打分用；和 sim.js · skillRangeOf 一样） */
  function aaRange(u) {
    let list = [];
    try { list = skillList(u) || []; } catch (e) { list = []; }
    const aa = list.find(s => s.id === u.kit + "_aa") || list.find(s => /_aa$/.test(s.id || ""));
    if (!aa) return null;
    return (typeof skillRangeFor === "function" && skillRangeFor(u, aa.id)) || parseSkillRange(aa.hint) || { min: 0, max: 1 };
  }
  /** 场上和 a 敌对、打得到的单位（倒地没起身的不算：和 BASIC_POLICY 一样不去打） */
  function foesOf(a) {
    const taunt = typeof playerTauntTarget === "function" ? playerTauntTarget(a) : null;
    if (taunt) return [taunt];
    return state.units.filter(x => onField(x) && hostileTo(a, x) && !downed(x) && !x.untargetable && !x.submerged);
  }
  function alliesOf(a) { return state.units.filter(x => onField(x) && x.isPlayer && (x.id === a.id || teammateOf(a, x))); }

  /**
   * 站在 me 这一边看局面的打分器：value() = 现在的局面值多少分（只有差值有意义）。
   * 进沙盒时（root）记下场上有哪些单位、各是哪一边、对手的普攻射程；之后新出现的自己人武器人算召唤。
   */
  function scorer(me, cfg) {
    const W = cfg.w;
    // 普攻射程进沙盒时记一次（站位打分每个局面都要用，每次都重新列技能太慢）
    const side = new Map(), range = new Map(), rootVal = new Map(), rootIds = [];
    state.units.forEach(x => {
      if (!onField(x)) return;
      const s = x.isPlayer && (x.id === me.id || teammateOf(me, x)) ? 1 : hostileTo(me, x) ? -1 : 0;
      if (!s) return;
      side.set(x.id, s); rootIds.push(x.id);
      range.set(x.id, aaRange(x));
    });
    const turn = Number(state.turnNo) || 1;
    const summonPts = W.summon * Math.max(W.summonMin, 1 - (turn - 1) * W.summonDecay);
    const melee = (r) => !!r && r.max === 0;
    const maxHp = (x) => Math.max(1, typeof totalMaxHp === "function" ? totalMaxHp(x) : 1);
    // 一整条血：场上角色（玩家这一边、不含武器人）血量上限的平均数
    const heroes = state.units.filter(x => onField(x) && x.isPlayer && !isWeapon(x));
    const bar = Math.max(1, heroes.length ? heroes.reduce((s, x) => s + maxHp(x), 0) / heroes.length : maxHp(me));
    // 一名角色的平均攻击力（攻击力那一项的单位）
    const atkOf = (x) => Math.max(0, Number(typeof effectiveAtk === "function" ? effectiveAtk(x, state.units) : x.atk) || 0);
    const atkBar = Math.max(1, heroes.length ? heroes.reduce((s, x) => s + atkOf(x), 0) / heroes.length : atkOf(me));
    const atkPts = (x) => atkOf(x) * (isWeapon(x) ? W.weaponAtk : 1) / atkBar;
    const maxOf = new Map();
    /** 一个单位对我方的好坏（x 不在了按离场算） */
    function unitValue(id, x) {
      const s = side.get(id);
      // 收回手上的武器人、躲起来的：当作没变（武器人的攻击力不算：收回以后算在持有者身上）
      if (x && x.hidden && !x.dead && !x._removed && rootVal.has(id)) return rootVal.get(id) - (rootAtk.get(id) || 0);
      const imp = x && isWeapon(x) ? W.weapon : 1;
      const out = !x || x.dead || x._removed || x.pvpOut;
      if (x && !maxOf.has(id)) maxOf.set(id, maxHp(x));
      const max = maxOf.get(id) || bar;
      const lost = out || !x ? max / bar : Math.max(0, max - hpNow(x)) / bar;   // 掉了几整条
      const hp = 1 - lost;                                                       // 下面照「剩下多少」写（只有差值有意义）
      const shp = out || !x || !x.upOnShp ? 0 : (Number(x.shp) || 0) / bar;
      const down = out || downed(x);
      const defFrac = x && !out && !x.noPosture && Number(x.defMax) > 0 ? Math.max(0, Number(x.def) || 0) / Number(x.defMax) : 1;
      const stun = !!(x && !out && x.stunned);
      let v = 0, st = 0;
      if (x && !out) {
        const ss = x.statuses || {};
        Object.keys(W.debuff).forEach(k => { if (on(ss[k])) st += W.debuff[k]; });
        Object.keys(W.buff).forEach(k => { if (on(ss[k])) st -= W.buff[k]; });
        if (x.self && x.self !== "none") st -= W.self;
      }
      // 攻击力：在场、没倒地的才算
      const atk = x && !out && !down ? atkPts(x) : 0;
      if (s < 0) {
        v = imp * (W.hp * (1 - hp) - W.shp * shp + (down ? W.down : 0) + (out ? W.out : 0)) + (stun ? W.stagger : 0) + W.def * (1 - defFrac) + st - W.foeAtk * atk;
        if (x && !out) {
          v += W.instant * Object.keys(x.instant || {}).filter(k => x.instant[k]).length;
          v += W.high * (Number(x.highEnergy) || 0) + W.focus * ((x.focuses || []).length || 0);
        }
      } else {
        v = -imp * (W.ownHp * (1 - hp) - W.ownShp * shp + (down ? W.ownDown : 0) + (out ? W.ownOut : 0)) - (stun ? W.ownStagger : 0) - W.ownDef * (1 - defFrac) - st + W.atk * atk;
        if (x && !out && !down) {
          // 站位：普攻打得到对手；远程（同区打不了）和对手的近战在同一区
          const r = range.get(id);
          const foes = state.units.filter(f => side.get(f.id) === -1 && onField(f) && !downed(f));
          if (r && foes.some(f => { const d = zdist(x.zone, f.zone); return d >= r.min && d <= r.max; })) v += imp * W.reach;
          if (r && r.min >= 1) v -= imp * W.risk * foes.filter(f => Number(f.zone) === Number(x.zone) && !f.stunned && melee(range.get(f.id))).length;
          // 留着附赠：对面回合里能替队友协助格挡（身边有别的自己人才算）
          if (!isWeapon(x) && (Number(x.bonus) || 0) >= 1 && state.units.some(y => y !== x && side.get(y.id) === 1 && onField(y) && !downed(y))) v += W.keepBonus;
        }
      }
      return v;
    }
    function value() {
      let v = 0;
      for (const id of rootIds) v += unitValue(id, state.units.find(u => u.id === id));
      // 新出现的自己人武器人：召唤（多一个单位 + 它的攻击力；持有者掉的攻击力在持有者那一项里）
      state.units.forEach(x => { if (!side.has(x.id) && onField(x) && x.isPlayer && isWeapon(x) && teammateOf(me, x)) v += summonPts + W.atk * atkPts(x); });
      return v;
    }
    const rootAtk = new Map();
    rootIds.forEach(id => {
      const x = state.units.find(u => u.id === id);
      rootVal.set(id, unitValue(id, x));
      rootAtk.set(id, (side.get(id) > 0 ? W.atk : -W.foeAtk) * atkPts(x));
    });
    return { value };
  }

  /* ---------- 看情况用技能：这个单位能做的动作 ---------- */
  function candidatesFor(a, cfg) {
    const foes = foesOf(a), allies = alliesOf(a);
    const inRange = (r) => (x) => { if (!r) return true; const d = zdist(a.zone, x.zone); return d >= r.min && d <= r.max; };
    return candidateActions({
      actors: [a],
      skip: (u, sk) => BATTLE_SEARCH_CFG.reaction.test(sk.id) || (!cfg.summon && /_summon$/.test(sk.id)) ||
        (!cfg.freeSkills && !((skillCost(sk.id) || {}).ap) && !((skillCost(sk.id) || {}).bonus)),
      // 目标：按技能选的那一边（敌人 / 友方 / 任意）和射程挑场上的单位。有射程的技能只试射程里的（不选目标白花行动点）；
      // 没写射程的先试「不选」，plan 里再看选了目标有没有不一样（召唤、给自己的增益选谁都一样，就不再一个一个试）
      targets: (u, sk) => {
        const side = typeof skillSideOf === "function" ? skillSideOf(u, sk.id) : "enemy";
        const r = (typeof skillRangeFor === "function" && skillRangeFor(u, sk.id)) || parseSkillRange(sk.hint);
        const list = (/^ally/.test(side) ? allies : /^any/.test(side) ? foes.concat(allies) : foes).filter(inRange(r)).map(x => x.id);
        return r ? list : [null].concat(list);
      },
      canMove: u => (u.bonus || 0) > 0 && !u.noMove,
      items: !!cfg.items,
      itemTargets: (u, spec) => spec.target === "self" ? [{ target: u.id }]
        : spec.target === "ally" ? allies.map(x => ({ target: x.id }))
        : spec.target === "enemy" ? foes.map(x => ({ target: x.id }))
        : spec.target === "zone" ? Array.from({ length: Number(state.zoneMode) || 2 }, (_, i) => ({ dest: i + 1 })) : []
    });
  }
  function canAct(u) { return onField(u) && !u.stunned && !downed(u) && ((u.ap || 0) > 0 || (u.bonus || 0) > 0); }

  /* ---------- 看情况用技能：束搜索 ---------- */
  let PLAN_NO = 0;
  /**
   * 轮到 actorId 时挑一个动作（tokenize 过的指令，执行前 resolve）；一步都不做最好就返回 null。
   * policy：试跑时格挡 / 协助怎么选（BattleSim.resolveQueues 用）。在沙盒里跑：真实的局面、日志、骰子都不动。
   * 每一步的平行世界种子 = 这场战斗的种子 + 已经掷了几次骰子 + 单位 + 第几步 + 第几个世界：同一种子整场结果一样，同一步的所有候选用同一批种子（公平比较）
   */
  function plan(actorId, policy, cfg) {
    cfg = cfg || SKILL_POLICY_CFG;
    const me0 = unitById(actorId);
    if (!canAct(me0)) return null;
    const seedBase = `skill:${RNG.seed != null ? RNG.seed + ":" + RNG.draws() : "free:" + (++PLAN_NO)}:${actorId}`;
    const info = { tried: 0, ok: 0, depth: 0 };
    const tok = sandbox(root => {
      const ev = scorer(me0, cfg);
      const v0 = ev.value();
      const W = Math.max(1, Number(cfg.worlds) || 1), depth = Math.max(1, Number(cfg.depth) || 1), width = Math.max(1, Number(cfg.width) || 1);
      let beam = [{ snaps: Array.from({ length: W }, () => root), path: [], score: 0 }];
      let best = { path: [], score: 0 };
      for (let d = 0; d < depth && beam.length; d++) {
        const last = d === depth - 1, next = new Map();
        const seed = w => `${seedBase}:${d}:${w}`;
        beam.forEach(node => {
          load(node.snaps[0]);
          const me = unitById(actorId);
          if (!canAct(me)) return;
          const before0 = signature();
          // 同一个技能、同一种分步选择：「不选目标」做成了，第一个目标的结果又和它一样 → 这个技能不看目标，后面的目标不用再试
          const groups = new Map();
          candidatesFor(me, cfg).map(cmd => tokenize(cmd)).forEach(tok => {
            const gk = tok.type === "skill" && tok.picks && tok.picks.target === undefined ? tok.skill + "|" + JSON.stringify(tok.picks) : null;
            const g = gk ? groups.get(gk) : null;
            if (g && g.same) return;
            info.tried++;
            // 先不存跑完的局面（存一份和跑一遍差不多慢）：留进束里的那几条再跑一遍存下来（同一批种子，结果一样）
            const r = trial(node.snaps, tok, { before0, policy, seed, measure: () => ev.value() - v0, keep: false, onBase: signature });
            if (gk) {
              if (tok.target == null) groups.set(gk, { none: r ? r.base : null, checked: false });
              else if (g && !g.checked) { g.checked = true; g.same = !!r && g.none != null && r.base === g.none; }
            }
            if (!r) return;
            info.ok++;
            const score = r.vals.reduce((a, b) => a + b, 0) / r.vals.length;
            const prev = next.get(r.base);
            if (!prev || score > prev.score) next.set(r.base, { from: node, tok, path: node.path.concat([tok]), score });
          });
        });
        const all = [...next.values()].sort((a, b) => b.score - a.score);
        if (all.length && all[0].score > best.score) best = all[0];
        info.depth = d + 1;
        beam = last ? [] : all.slice(0, width).map(n => {
          const r = trial(n.from.snaps, n.tok, { policy, seed });
          return r ? { snaps: r.snaps, path: n.path, score: n.score } : null;
        }).filter(Boolean);
      }
      info.best = best.score;
      return best.path.length ? best.path[0] : null;
    });
    plan.last = info;
    return tok;
  }

  return { snap, load, cloneData: o => cloneData(o, new Map()), signature, actors, flowPicks, affordable, candidateActions, tokenOf, idOf, tokenize, resolve, execute, trial, sandbox, busy,
    scorer, candidatesFor, plan, aaRange };
})();
