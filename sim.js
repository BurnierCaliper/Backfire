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
    state.partySize = 2;
    state.weather = opt.weather || "none";
    state.weatherLock = null;
    state.phaseStep = 0;
    state.assistQueue = [];
    state.blockQueue = [];
    state.koltSwapQueue = [];
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
    state.lootByRank = null;
    state.weaponMods = null;     // 单局图纸加成，在 before 里按本局写进来     // 掉落按手册；单局在 before 里换成三档
    state.exhaustTier = 0;
  }

  /**
   * 布置一场战斗。
   *   party     角色 kit 列表（武器人自动随角色进场，持在手上）
   *   enemies   [{ id, lv, zone }]，或者给 encounter（run.js 的遭遇，走 buildEncounter）
   *   level     敌人等级（enemies 里没写 lv 时用）
   *   seed      给了就装种子随机数，整场可复现
   *   before    布置完、放敌人之前调用（单局层用来盖回跨战斗的血量等）
   */
  function setup(opt) {
    opt = opt || {};
    if (opt.seed != null) RNG.install(opt.seed);
    resetField(opt);
    loadLiveParty(opt.party);
    if (typeof randomizeNoraMood === "function") randomizeNoraMood();
    state.units.forEach(u => resetBattleFlags(u));
    if (typeof opt.before === "function") opt.before(state);
    const partyN = syncPartySizeFromField();
    const level = Number(opt.level) || 1;
    if (opt.encounter) {
      const enc = JSON.parse(JSON.stringify(opt.encounter));
      if (typeof applyEncounterLayout === "function") applyEncounterLayout(enc);
      if (enc.playerZone) state.units.forEach(u => { if (u.isPlayer && !u.hidden) u.zone = Number(enc.playerZone); });
      buildEncounter(enc, level, partyN);
    } else {
      (opt.enemies || []).forEach(row => {
        spawnEnemyGroup(row.id, Number(row.lv) || level, partyN, row.zone).forEach(u => state.units.push(u));
      });
    }
    return state;
  }

  /* ---------- 胜负 ---------- */
  function outcome() {
    const heroes = state.units.filter(u => u.isPlayer && !u.hidden && !u.dead && !isWeapon(u));
    const standing = heroes.filter(u => !u.dying);
    if (!EnemyAI.foes().length) return "player";
    if (!standing.length) return "enemy";
    return null;
  }

  /* ---------- 需要选择的结算（格挡、协助、换刀头） ----------
   * 画面里这些会弹窗让玩家选；这里按 policy 自动选。 */
  function withPhaseOf(u, fn) {
    const prev = state.combatPhase;
    if (u) state.combatPhase = u.isPlayer ? "player" : "enemy";
    try { fn(); } finally { state.combatPhase = prev; }
  }

  function resolveQueues(policy) {
    for (let guard = 0; guard < 60; guard++) {
      if (outcome()) return;
      if (state.blockQueue && state.blockQueue.length) {
        const job = state.blockQueue[0];
        const attacker = unitById(job.attackerId), target = unitById(job.targetId);
        if (!attacker || !target) { state.blockQueue.shift(); continue; }
        const helpers = eligibleBlockers(target);
        const choice = helpers.length ? policy.pickBlocker(helpers, attacker, target) : null;
        const blocker = unitById(choice);
        let forced = null;
        if (blocker) {
          const chance = finalBlockChance(blocker, attacker);
          const iai = blocker.kit === "hiaki" && blocker.resources && blocker.resources.stance === "iai";
          const roll = 1 + Math.floor(Math.random() * 100);
          forced = { roll, ok: iai ? true : roll <= chance, chance, iai };
        }
        finishBlock(choice, forced);
        continue;
      }
      if (state.assistQueue && state.assistQueue.length) pruneAssistQueue();
      if (state.assistQueue && state.assistQueue.length) {
        const job = state.assistQueue[0];
        const target = unitById(job.targetId), breaker = unitById(job.breakerId);
        const list = target ? eligibleAssisters(breaker, target) : [];
        let choice = null;
        if (list.length) choice = job.vsPlayer ? EnemyAI.pickAssister(list) : policy.pickAssister(list, target);
        const helper = unitById(choice);
        const extra = {};
        if (helper && helper.kit === "hiaki") {
          const r = helper.resources || {};
          extra.blade = !r.niuOut ? "niu" : !r.narutoOut ? "naruto" : "niu";
        }
        withPhaseOf(helper, () => finishAssist(choice, extra));
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
      return;
    }
  }

  /* ---------- 玩家一方的默认打法 ---------- */
  function skillRangeOf(id, hint) {
    return (typeof SKILL_RANGE !== "undefined" && SKILL_RANGE[id]) || parseSkillRange(hint) || { min: 0, max: 1 };
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
        return (Number(u.shp) || 0) > 0 && !u.upOnShp ? () => standUp(u) : null;
      }
      if (u.stunned) return null;
      const foes = EnemyAI.foes().filter(f => !f.untargetable);
      if (!foes.length) return null;
      let list = [];
      try { list = skillList(u) || []; } catch (e) { list = []; }
      const aa = list.find(s => s.id === u.kit + "_aa") || list.find(s => /_aa$/.test(s.id || ""));
      if (canUse(u, aa)) {
        const r = skillRangeOf(aa.id, aa.hint);
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
    pickBlocker(helpers, attacker) {
      return helpers.slice().sort((a, b) => finalBlockChance(b, attacker) - finalBlockChance(a, attacker))[0].id;
    },
    pickAssister(list) {
      return list.slice().sort((a, b) => (effectiveAtk(b, state.units) || 0) - (effectiveAtk(a, state.units) || 0))[0].id;
    }
  };

  /* ---------- 回合 ---------- */
  const sig = (u) => u ? `${u.ap}|${u.bonus}|${u.zone}|${u.dying}|${u.upOnShp}` : "gone";

  function playerPhase(policy, stats) {
    const ids = state.units.filter(u => u.isPlayer && alive(u)).map(u => u.id);
    for (const id of ids) {
      for (let n = 0; n < 6; n++) {
        const u = unitById(id);
        if (!u || !alive(u) || outcome()) break;
        const thunk = policy.act(u);
        if (!thunk) break;
        const before = sig(u);
        thunk();
        stats.actions++;
        resolveQueues(policy);
        if (outcome()) return;
        if (sig(unitById(id)) === before) break;   // 没花掉任何东西 → 别卡死
      }
    }
  }

  function enemyPhase(policy, stats) {
    for (const id of EnemyAI.actingOrder()) {
      for (let n = 0; n < 5; n++) {
        const u = unitById(id);
        if (!u || !alive(u) || u.stunned || (u.ap || 0) <= 0) break;
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
      endEnemyTurn();
      resolveQueues(policy);
      winner = outcome();
    }
    const brief = (u) => ({ kit: u.kit, name: u.name, hp: hpOf(u), dead: !!u.dead, dying: !!u.dying });
    return {
      winner: winner || "timeout",
      rounds: state.turnNo,
      actions: stats.actions,
      heroes: state.units.filter(u => u.isPlayer && !isWeapon(u)).map(brief),
      foes: state.units.filter(u => !u.isPlayer && u.kit !== "ironwall").map(brief)
    };
  }

  return { setup, run, outcome, resolveQueues, BASIC_POLICY };
})();
