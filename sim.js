/* 角鳞 · 无界面战斗（布置 + 自动对打）
 *
 * 不碰网页，只调用规则函数。用途：
 *   - 自动化测试（tests/）：整场打完不报错、同一种子结果一致
 *   - 以后调数值：批量跑同一场遭遇，看胜率、回合数、剩余血量
 *   - Roguelike 单局层要开一场战斗时，用 BattleSim.setup 布置战场
 *
 *   BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "ABC" });
 *   const r = BattleSim.run({ maxRounds: 30 });   // → { winner, rounds, heroes, foes, actions }
 *
 * 敌人用 ai.js 的 EnemyAI（与战斗画面同一份）。玩家一方用 policy 决定，
 * 默认的 BASIC_POLICY 很朴素：能打到就普攻血最少的，打不到就走近一格。
 * SKILL_POLICY 会看情况用技能（列出合法动作、沙盒里试跑、按打分挑，sim-search.js）：BattleSim.run({ policy: BattleSim.SKILL_POLICY })。
 */
const BattleSim = (function () {
  "use strict";

  const isWeapon = (u) => typeof isWeaponUnit === "function" && isWeaponUnit(u);
  const alive = (u) => EnemyAI.unitAlive(u);

  /** 与 game.js 的 setupBattle 相同的战场重置，但不碰画面 */
  function resetField(opt) {
    state.units = [];
    state.props = [];
    state.fields = { 1: emptyField(), 2: emptyField(), 3: emptyField() };
    state.gaps = { "1-2": emptyGap(), "2-3": emptyGap() };
    state.zoneMode = Number(opt.zoneMode) || 2;
    state.board = null;          // 特殊棋盘：setup 里按 opt.board 换上（普通战斗两区 / 三区直排）
    state.partySize = 2;
    state.weather = opt.weather || "none"; state.weatherBy = null;
    if (typeof rollSandDir === "function") rollSandDir();   // 每场重新定风向（不是沙暴时不起作用）
    state.weatherLock = null;
    state.phaseStep = 0;
    state.assistQueue = [];
    state.blockQueue = [];
    state.koltSwapQueue = [];
    state.heluScanQueue = [];
    state.longgeSafetyQueue = [];
    state.standQueue = [];       // 全员倒地、回合结束前要问「要不要起身」的人（#470）
    state.skillFlow = null;
    state.history = [];
    state.actionAcc = null;
    state.statusDmg = {};
    state.turnNo = 1;
    state.logPages = [{ turn: 1, lines: [] }];
    state.logIndex = 0;
    state.combatPhase = "player";
    state.combatStarted = false;
    state.attackerId = null;
    state.targetId = null;
    state.lootByRank = null;     // 掉落按手册；单局在 before 里换成三档
    state.lootByKit = null;
    state.weaponMods = null;     // 单局图纸加成，在 before 里按本局写进来
    state.weaponBlueprints = null;   // 武器 kit → 装着的图纸 id（武器页显示名字用）
    state.exhaustTier = 0;
    state.openingBreaks = null;  // 单局：检定受伤留到开场的击破，在 before 里写进来
    state.solo = null;           // 单人模式：在 before 里写进来
    state.scoreAct = null;       // 评分按第几幕的分数线：单局在 before 里写进来
    state.ambush = false;        // 遭遇战（长休被偷袭）：第一回合我方没有行动，分数 ×2
    state.playerAllies = [];     // 和我方同阵营的敌人阵营（跑团战斗模板设的；buildEncounter 里写进来）
  }

  /**
   * 布置一场战斗。
   *   party     角色 kit 列表（武器人自动随角色进场，持在手上）
   *   enemies   [{ id, lv, zone }]，或者给 encounter（run.js 的遭遇，走 buildEncounter）
   *   level     敌人等级（enemies 里没写 lv 时用）
   *   seed      给了就装种子随机数，整场可复现
   *   before    布置完、放敌人之前调用（单局层用来盖回跨战斗的血量等）
   *   region    这场战斗在哪个区域（只是画面；不给就用 encounter 的 region，单局的遭遇带着这一幕的区域）
   *   scene     区域里的哪个场景（只是画面，world-data.js · BATTLE_SCENES 的 id；和主持人选的一样，这个区域没有的不认；不给就按默认）
   *   sceneSeed 单局：按这个种子在区域的场景里随机抽一个（rogue.js · battleSpec 给；不动战斗用的随机数）
   *   light     光影 day / dusk / night（只是画面；不给就跟着时钟）
   */
  function setup(opt) {
    opt = opt || {};
    if (opt.seed != null) RNG.install(opt.seed);
    resetField(opt);
    if (opt.board) applyBoard(opt.board);
    if (typeof resetBattleRecords === "function") resetBattleRecords();
    loadLiveParty(opt.party);
    placePartyOnBoard();
    if (typeof randomizeNoraMood === "function") randomizeNoraMood();
    state.units.forEach(u => resetBattleFlags(u));
    if (typeof opt.before === "function") opt.before(state);
    const partyN = syncPartySizeFromField();
    const level = Number(opt.level) || 1;
    // 个体值（enemies.js）：默认不波动（测试、数值模拟要确定的数字）；单局的战斗（battle.setupRogue）打开
    const ivOff = typeof ENEMY_IV !== "undefined" && !opt.iv;
    if (ivOff) ENEMY_IV.off++;
    try { spawnAll(opt, level, partyN); } finally { if (ivOff) ENEMY_IV.off--; }
    // 所在区域、场景、光影（只是画面，world-data.js · battleLookStart）
    if (typeof battleLookStart === "function") battleLookStart({ region: opt.region != null ? opt.region : opt.encounter && opt.encounter.region,
      scene: opt.scene, sceneSeed: opt.sceneSeed, light: opt.light });
    return state;
  }
  function spawnAll(opt, level, partyN) {
    if (opt.encounter) {
      const enc = JSON.parse(JSON.stringify(opt.encounter));
      if (typeof applyEncounterLayout === "function") applyEncounterLayout(enc);
      if (enc.playerZone) state.units.forEach(u => { if (u.isPlayer && !u.hidden) u.zone = Number(enc.playerZone); });
      buildEncounter(enc, level, partyN);
      if (typeof Chain !== "undefined") Chain.init(enc, level, partyN);
    } else {
      if (typeof Chain !== "undefined") Chain.clear();
      (opt.enemies || []).forEach(row => {
        spawnEnemyGroup(row.id, Number(row.lv) || level, partyN, row.zone, row.iv, row.race).forEach(u => state.units.push(u));
      });
    }
  }

  /* ---------- 胜负 ---------- */
  /** 返回 "player"（我方 / 某个玩家阵营赢了）、"enemy"（全员倒地）或 null（还没分出来）。
   *  全员倒地但还有人能起身时还没分出来（#470，app.js · heroStillFighting）：回合结束前问过、都不起身才算 "enemy"。
   *  场上有两个以上玩家阵营的角色时按阵营判（app.js · pvpBattleOutcome，#445），赢的阵营记在 lastPvpWinners */
  let lastPvpWinners = null, lastDuel = null;
  function outcome() {
    if (typeof soloDownCheck === "function") soloDownCheck([]);   // 单人：倒地起不来才算死亡
    // 决斗（enemies.js · pvpDuelOutcome，#472）：一队全倒（含再起不能）另一队赢、两队同时全倒或回合上限一样是平局（"draw"）
    const duel = typeof pvpDuelOutcome === "function" ? pvpDuelOutcome() : null;
    if (duel) {
      if (!duel.over) return null;
      lastDuel = duel;
      if (duel.winner) { lastPvpWinners = [duel.winner]; return "player"; }
      return "draw";
    }
    const heroes = state.units.filter(u => u.isPlayer && !u.hidden && !u.dead && !isWeapon(u));
    const standing = heroes.filter(u => typeof heroStillFighting === "function" ? heroStillFighting(u) : !u.dying);
    const pvp = typeof pvpBattleOutcome === "function" && !!pvpBattleOutcome();
    // 援军 / 连续战斗还没打完：继续（chain.js）
    if (!EnemyAI.foes().length) {
      const notes = [];
      const goOn = typeof Chain !== "undefined" && Chain.onCleared(notes);
      notes.forEach(t => appendLog(t));
      if (!goOn && !pvp) return "player";
    }
    if (pvp) {
      const r = pvpBattleOutcome();
      if (r && r.winners.length) { lastPvpWinners = r.winners.slice(); return "player"; }
      return r && r.wiped ? "enemy" : null;
    }
    if (!EnemyAI.foes().length) return null;
    if (!standing.length) return "enemy";
    return null;
  }

  /* ---------- 需要选择的结算（格挡、协助、换刀头） ----------
   * 画面里这些会弹窗让玩家选；这里按 policy 自动选。 */
  function withPhaseOf(u, fn) {
    const prev = state.combatPhase;
    // 按这个单位在哪个回合行动（enemies.js · unitTurnPhase，#445：在敌人回合行动的玩家阵营算敌人回合）
    if (u) state.combatPhase = typeof unitTurnPhase === "function" ? unitTurnPhase(u) : (u.isPlayer ? "player" : "enemy");
    try { fn(); } finally { state.combatPhase = prev; }
  }

  function resolveQueues(policy) {
    for (let guard = 0; guard < 60; guard++) {
      // 敌人全灭时，还在等协助格挡的那一击照样落下（例：最后一只空投蜂群撞完就死了），不能直接丢掉。
      // 回合结束前问「要不要起身」（#470）也要问完再判：两个阵营同时全员倒地时，不能先问的那边一说不起身，另一边没问就算赢
      const done = outcome();
      if (done && !(done === "player" && state.blockQueue && state.blockQueue.length) && !(state.standQueue && state.standQueue.length)) return;
      if (state.blockQueue && state.blockQueue.length) {
        const job = state.blockQueue[0];
        const attacker = blockJobAttacker(job), target = unitById(job.targetId);
        if (!attacker || !target) { state.blockQueue.shift(); continue; }
        const helpers = eligibleBlockers(target, job);
        const choice = helpers.length ? policy.pickBlocker(helpers, attacker, target) : null;
        const blocker = unitById(choice);
        let forced = null;
        if (blocker) {
          const chance = finalBlockChance(blocker, attacker, target);
          const iai = blocker.kit === "hiaki" && blocker.resources && blocker.resources.stance === "iai";
          const roll = 1 + Math.floor(Math.random() * 100);
          forced = { roll, ok: iai ? true : roll <= chance, chance, iai };
        }
        finishBlock(choice, forced);
        continue;
      }
      if (state.koltSwapQueue && state.koltSwapQueue.length) {
        const job = state.koltSwapQueue[0];
        const k = unitById(job.actorId);
        if (!k) { state.koltSwapQueue.shift(); continue; }
        const pick = policy.koltSwap ? policy.koltSwap(k) : { swap: false };
        resolveKoltSwap(!!(pick && pick.swap), pick && pick.targetId);
        continue;
      }
      if (state.longgeSafetyQueue && state.longgeSafetyQueue.length) {
        const job = state.longgeSafetyQueue[0];
        resolveLonggeSafety(policy.longgeSafety ? !!policy.longgeSafety(job) : false);
        continue;
      }
      if (state.heluScanQueue && state.heluScanQueue.length) {
        const job = state.heluScanQueue[0];
        resolveHeluScan(policy.heluScan ? policy.heluScan(job) : { act: "spawn" });
        continue;
      }
      if (state.assistQueue && state.assistQueue.length) pruneAssistQueue();
      if (state.assistQueue && state.assistQueue.length) {
        const job = state.assistQueue[0];
        const target = unitById(job.targetId), breaker = unitById(job.breakerId);
        const list = target ? eligibleAssisters(breaker, target, job) : [];   // job：PvP 分两轮问（job.pvpStage，#445）
        let choice = null;
        if (list.length) choice = job.vsPlayer ? EnemyAI.pickAssister(list, target) : policy.pickAssister(list, target);
        const helper = unitById(choice);
        const extra = {};
        if (helper && helper.kit === "hiaki") {
          const r = helper.resources || {};
          extra.blade = !r.niuOut ? "niu" : !r.narutoOut ? "naruto" : "niu";
        }
        if (helper && helper.kit === "longge") extra.mode = ((helper.resources || {}).ammo || []).length ? "gun" : "cane";
        withPhaseOf(helper, () => finishAssist(choice, extra));
        continue;
      }
      // 全员倒地还能起身（#470）：回合结束前一个一个问要不要起身（policy.standAsk 返回 { stand, dest }；不给就原地起身）
      if (state.standQueue && state.standQueue.length) {
        const job = state.standQueue[0];
        const u = unitById(job.unitId);
        const pick = u && policy.standAsk ? policy.standAsk(u, standRollZones(u)) : { stand: true };
        answerWipeStand(job.unitId, !!(pick && pick.stand), pick && pick.dest ? Number(pick.dest) : null);
        continue;
      }
      return;
    }
  }
  /** 回合结束前（endEnemyTurn 之前）：全员倒地、还有人能起身的那一队，问每个能起身的人要不要起身（#470）。
   *  policy 只给 standAsk 也行（其余照默认打法） */
  function standCheck(policy) {
    if (!queueWipeStand()) return;
    resolveQueues(Object.assign({}, BASIC_POLICY, policy || {}));
  }

  /* ---------- 玩家一方的默认打法 ---------- */
  function skillRangeOf(id, hint, actor) {
    return (typeof skillRangeFor === "function" && skillRangeFor(actor, id)) || parseSkillRange(hint) || { min: 0, max: 1 };
  }
  function hpOf(u) {
    return (u.layers || []).reduce((s, l) => s + Math.max(0, Number(l.current) || 0), 0);
  }
  function canUse(u, sk) {
    if (!sk) return false;
    const cost = skillCost(sk.id) || {};
    if ((cost.ap || 0) > (u.ap || 0) || (cost.bonus || 0) > (u.bonus || 0)) return false;
    return !skillRequirementError(u, sk.id);
  }

  const BASIC_POLICY = {
    name: "basic",
    /** 这个单位下一步做什么：返回 thunk，或 null 表示本回合不再行动 */
    act(u) {
      if (u.dying && !isWeapon(u)) {
        // 决斗设成不允许起身（#472）：倒地的人不自己起身（只在决斗里看，别的时候和以前一样）
        if (typeof pvpDuelNoStand === "function" && pvpDuelNoStand(u)) return null;
        return (Number(u.shp) || 0) > 0 && !u.upOnShp ? () => standUp(u) : null;
      }
      if (u.stunned) return null;
      // 配置了玩家阵营（PvP，#445）：打和自己敌对的单位（敌对玩家阵营的角色也算，倒地没起身的不打）；没配置照旧打敌人。
      // 被敌对的人嘲讽着（#464，enemies.js · playerTauntTarget）：只打嘲讽它的那个（和敌人 AI 被嘲讽一样）
      const taunt = typeof playerTauntTarget === "function" ? playerTauntTarget(u) : null;
      const foes = (taunt ? [taunt] : typeof pvpOn === "function" && pvpOn() ? hostilesOf(u).filter(f => !(f.dying && !f.upOnShp)) : EnemyAI.foes()).filter(f => !f.untargetable);
      if (!foes.length) return null;
      let list = [];
      try { list = skillList(u) || []; } catch (e) { list = []; }
      const aa = list.find(s => s.id === u.kit + "_aa") || list.find(s => /_aa$/.test(s.id || ""));
      if (canUse(u, aa)) {
        const r = skillRangeOf(aa.id, aa.hint, u);
        const inRange = foes.filter(f => {
          const d = zoneDist(Number(u.zone), Number(f.zone), Number(state.zoneMode));
          return d >= r.min && d <= r.max;
        }).sort((a, b) => hpOf(a) - hpOf(b));
        if (inRange.length) {
          const t = inRange[0];
          return () => { state.attackerId = u.id; state.targetId = t.id; runSkill(aa.id); };
        }
        // 够不着：走一格，朝能打到的距离靠
        if ((u.bonus || 0) > 0 && !u.noMove) {
          const near = foes.slice().sort((a, b) =>
            zoneDist(Number(u.zone), Number(a.zone), Number(state.zoneMode)) -
            zoneDist(Number(u.zone), Number(b.zone), Number(state.zoneMode)))[0];
          const d = zoneDist(Number(u.zone), Number(near.zone), Number(state.zoneMode));
          let dest = null;
          if (d > r.max) dest = Number(u.zone) + (Number(near.zone) > Number(u.zone) ? 1 : -1);
          else if (d < r.min) {
            const away = Number(u.zone) + (Number(near.zone) >= Number(u.zone) ? -1 : 1);
            if (away >= 1 && away <= Number(state.zoneMode)) dest = away;
          }
          if (dest != null) return () => { state.attackerId = u.id; doMove(u, dest); };
        }
      }
      return null;
    },
    pickBlocker(helpers, attacker, target) {
      return helpers.slice().sort((a, b) => finalBlockChance(b, attacker, target) - finalBlockChance(a, attacker, target))[0].id;
    },
    pickAssister(list) {
      return list.slice().sort((a, b) => (effectiveAtk(b, state.units) || 0) - (effectiveAtk(a, state.units) || 0))[0].id;
    },
    /** 全员倒地、回合结束前问要不要起身（#470）：原地起身 */
    standAsk() {
      return { stand: true };
    }
  };

  /* ---------- 看情况用技能的打法（SKILL_POLICY，issue #538） ----------
   * 只给模拟、测试、工具用（游戏里玩家这边没有 AI）。哪一边都能用（PvP 两队、PvE 我方），从轮到的那个单位自己这一边看局面。
   * 轮到一个单位：列出它所有的合法动作（技能 × 分步选择 × 目标、移动、道具、召唤武器人），在沙盒里几个平行世界各试跑一遍，
   * 一个回合之内往前看几步（束搜索），按打分挑最好的那一步做（sim-search.js · BattleSearch.plan；宽度、深度、平行世界数、权重在 SKILL_POLICY_CFG）。
   * 倒地起身、协助格挡 / 协助攻击照 BASIC_POLICY。随机数照旧走战斗种子：试跑用自己的种子，真实的骰子一个都不动，同一种子结果一样。
   * skillPolicy(opt) 造一份新的（opt.cfg 改设置），stats 里记它做了什么：用了哪些技能、召唤、道具、移动、试跑了多少个候选 */
  function skillPolicy(opt) {
    opt = opt || {};
    const base = typeof SKILL_POLICY_CFG !== "undefined" ? SKILL_POLICY_CFG : {};
    const cfg = Object.assign({}, base, opt.cfg || {}, { w: Object.assign({}, base.w || {}, (opt.cfg && opt.cfg.w) || {}) });
    const stats = { decisions: 0, tried: 0, ok: 0, actions: 0, skills: {}, names: {}, summons: 0, items: 0, moves: 0 };
    const pol = Object.assign({}, BASIC_POLICY, {
      name: "skill",
      cfg, stats,
      act(u) {
        if (u.dying && !isWeapon(u)) return BASIC_POLICY.act(u);   // 倒地：照 BASIC_POLICY 起身
        if (u.stunned || ((u.ap || 0) <= 0 && (u.bonus || 0) <= 0)) return null;
        const tok = BattleSearch.plan(u.id, pol, cfg);
        stats.decisions++;
        const last = BattleSearch.plan.last || {};
        stats.tried += last.tried || 0; stats.ok += last.ok || 0;
        if (!tok) return null;
        return () => {
          const cmd = BattleSearch.resolve(tok);
          stats.actions++;
          if (cmd.type === "move") stats.moves++;
          else if (cmd.type === "useItem") stats.items++;
          else {
            stats.skills[cmd.skill] = (stats.skills[cmd.skill] || 0) + 1;
            if (/_summon$/.test(cmd.skill)) stats.summons++;
            // 报告里写技能名用：谁用的、叫什么
            const a = unitById(cmd.actor);
            if (a && !stats.names[cmd.skill]) stats.names[cmd.skill] = { kit: a.kit, unit: a.name, name: typeof skillDisplayName === "function" ? skillDisplayName(a, cmd.skill) : cmd.skill };
          }
          BattleSearch.execute(cmd, pol);
        };
      }
    });
    return pol;
  }
  const SKILL_POLICY = skillPolicy();

  /* ---------- 回合 ---------- */
  const sig = (u) => u ? `${u.ap}|${u.bonus}|${u.zone}|${u.dying}|${u.upOnShp}` : "gone";
  /** 一个阶段里「同一个单位」怎么认（#547）：武器人按「持有者 + 哪把武器」认——收回再唤出是新建一个单位、编号会变（app.js · spawnWeapon），
   *  还算同一个（和联机行动顺序 hotseat.js 的 stableKey 一样）；别的单位按编号认（解除机甲放出来的明特、下车的炮手编号不变） */
  const turnKey = (u) => (u.weaponOf ? "weapon:" + (u.ownerId != null ? u.ownerId : u.weaponOf) + ":" + u.kit : "id:" + u.id);   // 争斗两队同一个角色时按 ownerId 分开（#543）

  /** phase：哪一个回合里行动的玩家角色（默认我方回合；在敌人回合行动的玩家阵营，#445，由 enemyPhase 先叫一次）。
   *  阶段开始时按场上的顺序排好要行动的人；每轮完一个人再看一遍场上：这一阶段新进场、还没轮到过的（唤出的武器人、解除机甲放出来的明特……，#547）
   *  接着轮到它们（排在剩下的人前面；原来就在场的人顺序不变）。同一个单位（turnKey）一个阶段最多轮到一次：
   *  已经轮到过的不会因为重新看一遍场上又轮到；还没轮到就离场的（被收回、坐进车里当炮手）不算轮到过，同一阶段再进场照样轮到 */
  function playerPhase(policy, stats, phase) {
    const when = phase || "player";
    const acts = (u) => u.isPlayer && alive(u) && (typeof unitTurnPhase !== "function" || unitTurnPhase(u) === when);
    const queue = state.units.filter(acts).map(u => u.id);
    const taken = new Set();   // 这一阶段已经轮到过的（turnKey）
    while (queue.length) {
      const id = queue.shift();
      const u0 = unitById(id);
      if (!u0 || !acts(u0) || taken.has(turnKey(u0))) continue;
      taken.add(turnKey(u0));
    // 在轮到的这个人的结算上下文里想、做（争斗两队同一个角色：按 kit 找到的是他自己，party.js · withKitScope，#543）
    const scoped = (u, fn) => (typeof withKitScope === "function" ? withKitScope(u, fn) : fn());
      for (let n = 0; n < 6; n++) {
        const u = unitById(id);
        if (!u || !alive(u) || outcome()) break;
        const thunk = scoped(u, () => policy.act(u));
        if (!thunk) break;
        const before = sig(u);
        scoped(u, thunk);
        stats.actions++;
        resolveQueues(policy);
        if (outcome()) return;
        if (sig(unitById(id)) === before) break;   // 没花掉任何东西 → 别卡死
      }
      // 这个人轮完了：这一阶段新进场、还没轮到过的（唤出的武器人……，#547）接着轮到，按场上的顺序排在剩下的人前面。
      // 以前阶段开始就把名单定死，中途唤出的武器人要等下一个阶段才动（游戏里唤出来就带着行动点、附赠，当回合就能动）
      const fresh = state.units.filter(u => acts(u) && !taken.has(turnKey(u)) && !queue.includes(u.id)).map(u => u.id);
      queue.unshift(...fresh);
    }
  }

  function enemyPhase(policy, stats) {
    // 在敌人回合行动的玩家阵营（PvP，#445）：同一回合里玩家角色总比非玩家单位先动——先等它们行动完，再跑敌人的 AI
    if (state.units.some(u => u.isPlayer && alive(u) && typeof unitTurnPhase === "function" && unitTurnPhase(u) === "enemy")) {
      playerPhase(policy, stats, "enemy");
      if (outcome()) return;
    }
    for (const id of EnemyAI.actingOrder()) {
      for (let n = 0; n < 5; n++) {
        const u = unitById(id);
        if (!u || !(alive(u) || (typeof vehicleRiderActs === "function" && vehicleRiderActs(u))) || u.stunned || (u.ap || 0) <= 0) break;
        const plan = EnemyAI.plan(u);
        if (!plan) break;
        const before = sig(u);
        plan.thunk();
        stats.actions++;
        resolveQueues(policy);
        if (outcome()) return;
        if (sig(unitById(id)) === before) break;
      }
    }
  }

  /** 从开战打到分出胜负（或回合上限）。返回摘要。 */
  function run(opt) {
    opt = opt || {};
    const policy = Object.assign({}, BASIC_POLICY, opt.policy || {});
    const maxRounds = Number(opt.maxRounds) || 40;
    const stats = { actions: 0 };
    lastPvpWinners = null; lastDuel = null;
    if (!state.combatStarted) startCombat();
    resolveQueues(policy);
    let winner = outcome();
    while (!winner && state.turnNo <= maxRounds) {
      playerPhase(policy, stats);
      if ((winner = outcome())) break;
      endPlayerTurn();
      resolveQueues(policy);
      if ((winner = outcome())) break;
      enemyPhase(policy, stats);
      if ((winner = outcome())) break;
      standCheck(policy);   // 全员倒地还能起身：回合结束前先问（#470）
      if ((winner = outcome())) break;
      endEnemyTurn();
      resolveQueues(policy);
      winner = outcome();
    }
    const brief = (u) => ({ kit: u.kit, name: u.name, hp: hpOf(u), dead: !!u.dead, dying: !!u.dying });
    const out = {
      winner: winner || "timeout",
      rounds: state.turnNo,
      actions: stats.actions,
      heroes: state.units.filter(u => u.isPlayer && !isWeapon(u)).map(brief),
      foes: state.units.filter(u => !u.isPlayer && u.kit !== "ironwall").map(brief)
    };
    // 按阵营分出胜负（#445）：赢的是哪几个玩家阵营
    if (winner === "player" && lastPvpWinners) out.pvpWinners = lastPvpWinners.slice();
    // 决斗（#472）：怎么分出的胜负（全倒 / 回合上限）、剩余血量百分比
    if (lastDuel) out.duel = { winner: lastDuel.winner || null, draw: !!lastDuel.draw, why: lastDuel.why, pct: lastDuel.pct || null };
    return out;
  }

  return { setup, run, outcome, resolveQueues, standCheck, BASIC_POLICY, SKILL_POLICY, skillPolicy };
})();
