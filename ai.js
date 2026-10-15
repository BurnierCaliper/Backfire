/* 角鳞 · 敌人 AI（行为决策）
 *
 * 从 game.js 抽出来，战斗画面和无界面的批量模拟（sim.js）共用同一份。
 * 这里只做「决定下一步做什么」：aiPlan(u) 返回 { thunk, meta }，
 * thunk 调用规则函数（runSkill / doMove）真正执行，meta 给画面用来演出。
 * 行为表 AI_SPEC 的说明见 README「敌人 AI 怎么改」。
 */
const EnemyAI = (function () {
  "use strict";

  function unitAlive(u) { return u && !u.hidden && !u.fused && !u.dead && !u._removed; }
  function players() { return state.units.filter(u => u.isPlayer && unitAlive(u)); }
  function foes() { return state.units.filter(u => !u.isPlayer && unitAlive(u) && u.kit !== "ironwall" && !(typeof playerAllied === "function" && playerAllied(u)) &&
    !(typeof isNeutralCreature === "function" && isNeutralCreature(u))); }   // 友军、中立生物不算要打的敌人

  function hpOf(u) {
    if (u.upOnShp) return Number(u.shp) || 0;
    return (u.layers || []).reduce((a, l) => a + Math.max(0, Number(l.current) || 0), 0);
  }
  /** 这个敌人能打的人：我方，以及和它敌对的其他阵营的敌人（异星生物 ↔ 其他阵营） */
  function validPrey(me) {
    const pool = me && typeof hostileTo === "function"
      ? state.units.filter(u => hostileTo(me, u) && unitAlive(u) && u.kit !== "ironwall" && !u.fused)
      : players();
    // 下潜中的单位选不中（谐波攻击能打，敌人的 AI 先不专门找它）
    return pool.filter(u => unitAlive(u) && !u.hidden && !u.submerged && !(u.dying && !u.upOnShp) &&
      !(typeof bpUntargetable === "function" && bpUntargetable(u)));   // 单局图纸：安全的迷彩（武器人形态）
  }
  // 不按「打单个目标」瞄准的技能：标定区域的榴弹（落点任意），不看危墙
  const ZONE_PICK = { en_gl: true, en_gl_fire: true, en_ant_shell: true, en_ant_shell_fire: true };
  // 不需要目标 / 不是攻击的技能：找站位时不拿它们来算「能不能打到」
  const NO_TARGET = { en_agg3_debris: true, en_king_hold: true, en_king_exec: true, en_bigsand_summon: true, en_bigsand_heal: true, ufo_prime: true,
    ufo_boom: true, ufo_stomp: true, ufo_sweep: true, ufo_summon: true, en_agg2_overheat: true, en_giant_sand_pulse: true, en_thug_mutiny: true, en_gas_ignite: true, en_hunter_heat: true, en_alarm_zap: true };
  function canAimSkill(u, sid, t) {
    if (!inSkillReach(u, sid, t)) return false;
    // 隔着危墙 / 关着的门打不到（dealTo 会挡下来）：以前照样瞄准，结果每回合白打
    if (!ZONE_PICK[sid] && typeof lineBlocked === "function" && lineBlocked(u.zone, t.zone)) return false;
    return true;
  }
  function inSkillReach(u, sid, t) {
    if (!u || !t || !unitAlive(t) || t.hidden || t.fused) return false;
    if (t.dying && !t.upOnShp) return false;
    const d = zdist(u.zone, t.zone);
    const table = (typeof SKILL_RANGE !== "undefined" && SKILL_RANGE[sid]) || null;
    if (table) return d >= (table.min || 0) && d <= (table.max == null ? 99 : table.max);
    // 敌人技能的射程表（enemies.js · ENEMY_SKILL_RANGE）：近距离只打 0，远距离只打 1。
    // 之前这里没查它，远距技能被当成 0–1 都能打，于是瞄准同区的人、结果打不到。
    const erg = typeof ENEMY_SKILL_RANGE !== "undefined" && sid ? ENEMY_SKILL_RANGE[sid] : null;
    if (erg === "melee") return d === 0;
    if (erg === "ranged") return d === 1 || (d === 0 && typeof enemyForcedPointBlank === "function" && enemyForcedPointBlank(u, t));
    if (erg === "any") return d <= 1;
    // 射程表里没有的技能按单位卡上的射程判断，和 dealTo 一致（以前一律按 0–1：远距离的人形沙灵瞄准同区的人，每回合空放）
    const rg = u.range || "any";
    if (rg === "melee") return d === 0;
    if (rg === "ranged") return d === 1;
    return d <= 1;
  }
  function retargetLegal(u, sid, preferred, prey, forced) {
    if (forced && preferred && unitAlive(preferred)) return { target: preferred, sid };
    if (preferred && canAimSkill(u, sid, preferred)) return { target: preferred, sid };
    const hit = (prey || []).find(p => p !== preferred && canAimSkill(u, sid, p));
    if (hit) return { target: hit, sid };
    const list = (() => { try { return enemySkillList(u) || []; } catch (e) { return []; } })();
    for (let i = 0; i < list.length; i++) {
      const alt = list[i].id;
      if (alt === sid) continue;
      if (preferred && canAimSkill(u, alt, preferred)) return { target: preferred, sid: alt };
      const t2 = (prey || []).find(p => canAimSkill(u, alt, p));
      if (t2) return { target: t2, sid: alt };
    }
    return { target: preferred, sid };
  }
  function lowest(list) {
    return list.slice().sort((a, b) => hpOf(a) - hpOf(b))[0] || null;
  }
  function highest(list) {
    return list.slice().sort((a, b) => hpOf(b) - hpOf(a))[0] || null;
  }
  function enemyLabel(u, id) {
    try {
      const s = (enemySkillList(u) || []).find(x => x.id === id);
      if (s) return s.label;
    } catch (e) {}
    return id === "en_aa" ? "普通攻击" : id;
  }

  /* ---- 敌人行为表 ----------------------------------------------------
   * 全部按《主持人手册》第十章每个敌人的行为描述填写。
   *   dist  希望与目标保持的距离：0 贴近，1 远距离（3 区制下太远会接近、太近会远离），
   *         null 不主动移动。
   *   aim   打谁：
   *         local   同区优先（同区有人就打同区，手册没写明追谁的都用这个）
   *         lowest  血量最低者（手册写明的）
   *         nearest 最近的
   *         topAtk  ATK 最高者
   *   near / far  同区、隔区分别用哪个技能。
   *   special     需要单独判断的（自爆、召唤、阶段、命令等）。
   * ------------------------------------------------------------------ */
  const AI_SPEC = {
    // 杂兵
    guard_sword:    { dist: 0,    aim: "local",   near: "en_guard_sword" },
    guard_gun:      { dist: 1,    aim: "local",   near: "en_guard_gun_near", far: "en_guard_gun_far" },
    patrol_car:     { dist: 0,    aim: "topAtk",  near: "en_patrol_near",    far: "en_patrol_far" },
    boomcar:        { dist: 0,    aim: "nearest", special: "boomcar", noBasic: true },
    buoy:           { dist: 0,    aim: "nearest", near: "en_buoy" },
    dumpdrone:      { dist: 1,    aim: "local",   near: "en_dump",           far: "en_dump" },
    mine_guard:     { dist: 0,    aim: "local",   near: "en_mine_guard" },
    mine_overseer:  { dist: 0,    aim: "local",   near: "en_overseer" },
    flint_sweeper:  { dist: 1,    aim: "local",   near: "en_flint",          far: "en_flint" },
    alarm_bot:      { dist: null, aim: "local",   special: "alarm", fixed: true },
    meteor_miner:   { dist: 1,    aim: "local",   near: "en_miner_shot",     far: "en_miner_shot" },
    meteor_spider:  { dist: 0,    aim: "local",   near: "en_spider_bite" },
    sandfish_lead:  { dist: 0,    aim: "local",   near: "en_fish_lead_hit" },
    sandfish_drive: { dist: 0,    aim: "local",   near: "en_fish_drive_tail" },
    sandfish_ambush:{ dist: 0,    aim: "local",   near: "en_fish_ambush_bite" },
    meteor_centipede: { dist: 1,  aim: "lowest",  near: "en_centi_shot",     far: "en_centi_shot", fixed: true },
    thug_knife:     { dist: 0,    aim: "local",   near: "en_thug_knife" },
    thug_hammer:    { dist: 0,    aim: "local",   near: "en_thug_hammer" },
    crow:           { dist: 0,    aim: "lowest",  near: "en_crow" },
    sand_beast:     { dist: 0,    aim: "local",   near: "en_sand_aa" },
    sand_human:     { dist: null, aim: "local",   near: "en_sand_aa",        far: "en_sand_aa" },
    swarm:          { dist: 0,    aim: "lowest",  near: "en_swarm" },
    // 精英
    mecha_mg:       { dist: null, aim: "local",   near: "en_mg_near",        far: "en_mg_far" },
    mecha_gl:       { dist: 1,    aim: "local",   special: "gl" },
    bandit_boss:    { dist: 0,    aim: "lowest",  near: "en_boss_near",      far: "en_boss_far" },
    captain_wolf:   { dist: 0,    aim: "local",   near: "en_wolf" },
    captain_ox:     { dist: 0,    aim: "local",   near: "en_ox" },
    captain_lizard: { dist: 1,    aim: "local",   near: "en_liz",            far: "en_liz" },
    ant_guard:      { dist: 1,    aim: "local",   near: "en_ant_spray",      far: "en_ant_spray", special: "ant" },
    gas_collector:  { dist: 0,    aim: "local",   special: "gas" },
    ant_hunter:     { dist: 1,    aim: "local",   near: "en_hunter_shot",    far: "en_hunter_shot" },
    bigsand:        { dist: null, aim: "local",   near: "en_bigsand",        special: "bigsand" },
    livesand:       { dist: null, aim: "local",   special: "livesand" },
    giant:          { dist: null, aim: "local",   near: "en_giant_near",     far: "en_giant_far" },
    patrolboat:     { dist: 1,    aim: "local",   special: "boat" },
    spreader:       { dist: 1,    aim: "local",   near: "en_spread",         far: "en_spread" },
    watchcrow:      { dist: 1,    aim: "local",   near: "en_watch",          far: "en_watch" },
    dustbody:       { dist: 0,    aim: "nearest", near: "en_dust_grind",     far: "en_dust_lift", farWhenLast: true },
    // BOSS
    outlaw_king:    { dist: null, aim: "local",   special: "king" },
    ufo_body:       { dist: null, aim: "lowest",  special: "ufo" },
    sand_aggregate: { dist: null, aim: "local",   special: "aggregate" }
  };

  const zdist = (a, b) => zoneDist(Number(a), Number(b), Number(state.zoneMode));
  function adjacentZones(z) { return zoneNeighbors(z); }
  /** 朝目标区走一步：从相连的区里挑离目标最近的（方形 / 十字棋盘区号不一定挨着，以前写死 ±1 会走不动）。
   *  不会自己走进深渊（飞行单位除外）；没有更近的区返回 null */
  function stepToward(u, to) {
    const from = Number(u.zone), goal = Number(to);
    const here = zdist(from, goal);
    const abyss = (z) => !u.flying && state.fields && state.fields[z] && state.fields[z].abyss;
    const opts = adjacentZones(from).map(Number).filter(z => !abyss(z) && zdist(z, goal) < here);
    if (!opts.length) return null;
    return opts.sort((a, b) => zdist(a, goal) - zdist(b, goal) || a - b)[0];
  }
  /** 这一步移动付不付得起：杂兵用行动点，精英 / 首领只能用附赠行动；被禁足 / 霜结不能动 */
  function canPayMove(u) {
    if (!u || u.noMove || u.self === "frost") return false;
    if (AI_SPEC[u.kit] && AI_SPEC[u.kit].fixed) return false;   // 不会主动移动（矿场警戒自动机）
    const rank = typeof enemyRankOf === "function" ? enemyRankOf(u) : "minion";
    return rank === "minion" ? (u.ap || 0) >= 1 : (u.bonus || 0) >= 1;
  }
  /** 能正常走过去的相邻区（不隔危墙 / 关着的门；地面单位不走空隙、不进深渊） */
  function walkableNeighbors(u) {
    const from = Number(u.zone);
    return adjacentZones(from).map(Number).filter(z => {
      const g = typeof getGap === "function" ? getGap(from, z) : { type: "open" };
      if (g.type === "wall" || (g.type === "door" && !g.open)) return false;
      if (g.type === "void" && !u.flying) return false;
      if (!u.flying && state.fields && state.fields[z] && state.fields[z].abyss) return false;
      return true;
    });
  }
  /** 找站位：在这里打不到人时，看走一步到哪个相邻区能打到（优先能打到原定目标的，其次能打到的人多的；
   *  想保持距离的远程单位再优先没有敌人的区）。走一步也打不到、又没有固定射程的单位，就朝目标靠近一步。
   *  only：强制目标（嘲讽 / 决一死战）时只算那一个人。找不到返回 null */
  function firingStep(u, spec, prey, target, list, only) {
    if (!canPayMove(u)) return null;
    // 手册：强盗头子守在亡命之王身边（远处的人用远程手段打），不为了找站位离开王；被挟持的王也不动
    if (u.kit === "bandit_boss" && !(u.resources && u.resources.mutinied)) {
      const king = typeof findKit === "function" ? findKit("outlaw_king", state.units) : null;
      if (king && !king.dead) return null;
    }
    if (u.kit === "outlaw_king" && u.resources && u.resources.hostage) return null;
    const sids = (list || []).map(s => s.id).filter(id => id && !NO_TARGET[id]);
    if (!sids.length) return null;
    const pool = only ? [only] : prey;
    const from = u.zone;
    let best = null;
    walkableNeighbors(u).forEach(z => {
      u.zone = z;
      let hits = 0, hitsTarget = false;
      try {
        pool.forEach(p => {
          if (sids.some(sid => canAimSkill(u, sid, p))) { hits++; if (p === target) hitsTarget = true; }
        });
      } finally { u.zone = from; }
      if (!hits) return;
      const quiet = spec && spec.dist === 1 && !preyInZone(prey, z).length ? 1 : 0;
      const score = (hitsTarget ? 100 : 0) + hits * 10 + quiet;
      if (!best || score > best.score || (score === best.score && z < best.z)) best = { z, score };
    });
    if (best) return best.z;
    // 一步之内哪里都打不到：没有固定射程的单位（机枪机甲、巨人……）朝目标走一步，别原地干等
    if (spec && spec.dist == null && target) {
      const step = stepToward(u, target.zone);
      if (step != null && walkableNeighbors(u).includes(Number(step))) return step;
    }
    return null;
  }
  function preyInZone(list, z) {
    return list.filter(p => Number(p.zone) === Number(z));
  }
  function nearestFirst(u, list) {
    return list.slice().sort((a, b) =>
      (zdist(u.zone, a.zone) - zdist(u.zone, b.zone)) || (hpOf(a) - hpOf(b)));
  }

  /** 选目标。强制目标（决一死战 / 嘲讽）优先，其次手册写明的追击规则，最后才是同区优先。 */
  function aiTarget(u, spec, prey) {
    const pick = aiTargetBase(u, spec, prey);
    // 单局图纸：蠢货让敌人更倾向于打你，安全的迷彩让敌人很少选你
    return typeof bpRetarget === "function" ? bpRetarget(pick, prey) : pick;
  }
  function aiTargetBase(u, spec, prey) {
    const duel = typeof touDuelVictim === "function" ? touDuelVictim(u) : null;
    if (duel && unitAlive(duel) && !(duel.dying && !duel.upOnShp)) return { unit: duel, forced: true };
    // 禁足怒吼：这一回合只能攻击施放的坦克（回合结束清掉；不像嘲讽打一下就没了）
    if (u.lockdownBy) {
      const t = unitById(u.lockdownBy);
      if (t && unitAlive(t) && !t.dying) return { unit: t, forced: true };
    }
    if (u.tauntTo) {
      const t = unitById(u.tauntTo);
      if (t && unitAlive(t) && !t.dying) return { unit: t, forced: true };
    }
    // 手册：亡命之王的攻击命令让所有狂徒目标切到此人
    if (isOutlawThug(u) && typeof kingFocusTarget === "function") {
      const f = kingFocusTarget();
      if (f && prey.includes(f)) return { unit: f, forced: true };
    }
    let aim = spec.aim || "local";
    // 手册：强盗头子在场时，所有狂徒集火血量最低者
    if (/^thug_/.test(u.kit || "") && foes().some(x => x.kit === "bandit_boss")) aim = "lowest";
    if (aim === "lowest") {
      // 不会移动的远程单位（陨体弦蚣）：在打得到的人里挑血量最低的
      if (spec.fixed && spec.dist != null) {
        const reach = prey.filter(p => zdist(u.zone, p.zone) === spec.dist);
        if (reach.length) return { unit: lowest(reach) };
      }
      return { unit: lowest(prey) };
    }
    if (aim === "nearest") return { unit: nearestFirst(u, prey)[0] };
    if (aim === "topAtk") {
      const s = prey.slice().sort((a, b) =>
        (effectiveAtk(b, state.units) || 0) - (effectiveAtk(a, state.units) || 0));
      return { unit: s[0] };
    }
    // 远程单位（想保持距离 1）：先挑打得到的，也就是隔一区的人
    if (spec.dist === 1) {
      const far = prey.filter(p => zdist(u.zone, p.zone) === 1);
      if (far.length) return { unit: highest(far) };
    }
    // 手册没写明追谁时，倾向于打血量最高的
    const here = preyInZone(prey, u.zone);          // local：同区有人就打同区
    return { unit: here.length ? highest(here) : highest(nearestFirst(u, prey).slice(0, 2)) };
  }

  /** 该不该移动。返回要走到的区，null 表示原地行动。 */
  function aiStep(u, target, spec, prey) {
    // 主持人手册：强盗头子会主动与亡命之王同区（留在王身边，远处的人用远程手段打）
    if (u.kit === "bandit_boss" && !u.noMove && !(u.resources && u.resources.mutinied)) {
      const king = findKit("outlaw_king", state.units);
      if (king && !king.dead) {
        const kz = Number(king.zone), from = Number(u.zone);
        return kz === from ? null : stepToward(u, kz);
      }
    }
    if (spec.dist == null || u.noMove || spec.fixed) return null;   // fixed：不会主动移动
    if (typeof sinkStuck === "function" && sinkStuck(u)) return null;   // 陷在流沙里走不出去
    if (u.entangled) return null;   // 被沙珊瑚缠住
    const d = zdist(u.zone, target.zone);
    if (d === spec.dist) return null;
    if (d > spec.dist) {                            // 太远 → 接近一格
      return stepToward(u, target.zone);
    }
    // 太近 → 后撤。手册规定优先退到没有敌人的区，退不掉才留下打。
    const open = adjacentZones(u.zone).filter(z => !preyInZone(prey, z).length && (u.flying || !(state.fields && state.fields[z] && state.fields[z].abyss)));
    if (!open.length) return null;
    return open.sort((a, b) => zdist(b, target.zone) - zdist(a, target.zone))[0];
  }

  function aiSpecial(u, spec, target, prey, has, list) {
    const r = u.resources || {};
    const sameZone = target && Number(target.zone) === Number(u.zone);

    if (spec.special === "boomcar") {
      // 贴近后引爆；引信未到就继续接近
      if (sameZone && (r.fuse == null || r.fuse <= 0) && has("en_boom_fuse")) return "en_boom_fuse";
      return null;
    }
    if (spec.special === "gl") {
      if (has("en_gl_fire")) return "en_gl_fire";
      return has("en_gl") ? "en_gl" : null;
    }
    if (spec.special === "alarm") {
      // 不移动：场上有高能的敌人就电涌，没有就待机
      return has("en_alarm_zap") && alarmTargets(u).length ? "en_alarm_zap" : null;
    }
    if (spec.special === "gas") {
      // 每回合先移动（够不着目标就先走过去），然后：所在区是火场就喷火；不是火场、能点着就点燃燃气
      if (!sameZone && canPayMove(u)) return null;
      if (zoneOnFire(u.zone)) return sameZone && has("en_gas_spray") ? "en_gas_spray" : null;
      if (gasCanIgnite(u.zone) && has("en_gas_ignite")) return "en_gas_ignite";
      return sameZone && has("en_gas_spray") ? "en_gas_spray" : null;   // 点不着（固有场地 / 被锁定）：照样喷火
    }
    if (spec.special === "ant") {
      // 大酸液弹待发就发；站在酸液地面上就标定；否则用普通的酸液喷枪（交给 near / far）
      if (has("en_ant_shell_fire")) return "en_ant_shell_fire";
      if (has("en_ant_shell") && target && zdist(u.zone, target.zone) <= 1) return "en_ant_shell";
      return null;
    }
    if (spec.special === "bigsand") {
      const sands = state.units.filter(x =>
        !x.isPlayer && !x.dead && !x.hidden &&
        (x.kit === "sand_beast" || x.kit === "sand_human"));
      if (sands.length < 3 && has("en_bigsand_summon")) return "en_bigsand_summon";
      if (!preyInZone(prey, u.zone).length && has("en_bigsand_heal")) return "en_bigsand_heal";
      return null;
    }
    if (spec.special === "livesand") {
      if (!r.giant) return "en_live";
      if ((r.giantTurns || 0) >= 3 && has("en_giant_sand_pulse")) return "en_giant_sand_pulse";
      if (sameZone && has("en_giant_sand_melee")) return "en_giant_sand_melee";
      return has("en_giant_sand_vortex") ? "en_giant_sand_vortex" : "en_giant_sand_melee";
    }
    if (spec.special === "boat") {
      // 电弧扫射打距离 1 的全部敌人，感电是它自带的附加，没有单体攻击
      // 被牵制而牵制者在同区：抵近扫自己所在的区（enemies.js · en_boat_arc）
      const forced = typeof enemyForcedTarget === "function" ? enemyForcedTarget(u) : null;
      if (forced && Number(forced.zone) === Number(u.zone)) return "en_boat_arc";
      return prey.some(p => zdist(u.zone, p.zone) === 1) ? "en_boat_arc" : null;
    }
    if (spec.special === "king") {
      if (r.hostage) return null;                   // 被挟持，无法行动
      const thugs = state.units.filter(x =>
        !x.isPlayer && !x.dead && !x.hidden && /^(thug_|bandit_boss)/.test(x.kit || ""));
      const scattered = thugs.some(x => Number(x.zone) !== Number(u.zone));
      // 回防只在他危险时下（回防会花掉狂徒的行动点）：有人冲进他所在的区、或这一回合他挨了打，
      // 而且身边没有狂徒能替他挡（同区还有狂徒就不叫）。狂徒出去打人不算危险
      const pressed = prey.some(p => Number(p.zone) === Number(u.zone));
      const hurt = (Number(u.damagedThisTurn) || 0) > 0;
      const guarded = thugs.some(x => x !== u && Number(x.zone) === Number(u.zone));
      const holdReady = r.holdTurn == null || state.turnNo - Number(r.holdTurn) >= (Number(KING_CFG.hold.cooldown) || 0);
      // 手下被打倒过：这回合改成回防（之后狂徒们齐射）
      if (r.crewDown && holdReady && has("en_king_hold")) return "en_king_hold";
      if (scattered && thugs.length >= 2 && !guarded && (pressed || hurt) && holdReady && has("en_king_hold") && u._aiHoldTurn !== state.turnNo) {
        return "en_king_hold";
      }
      // 公开处刑：没有挂着的、离上次标记过了冷却就用（标记 → 两回合后落下）
      if (has("en_king_exec") && typeof kingExecutionReady === "function" && kingExecutionReady(u)) return "en_king_exec";
      if (sameZone && has("en_king_kill")) return "en_king_kill";
      return has("en_king_atk") ? "en_king_atk" : "en_king_kill";
    }
    if (spec.special === "ufo") {
      if (has("ufo_boom")) return "ufo_boom";
      if (has("ufo_stomp")) return "ufo_stomp";
      if (has("ufo_sweep")) return "ufo_sweep";
      if (has("ufo_prime")) return "ufo_prime";
      if (has("ufo_summon")) return "ufo_summon";
      if (has("ufo_laser")) return "ufo_laser";
      return list && list[0] ? list[0].id : null;
    }
    if (spec.special === "aggregate") {
      const ph = r.phase || 1;
      if (ph === 1) return sameZone ? "en_agg1_melee" : "en_agg1_range";
      if (ph === 2) return sameZone ? "en_agg2_melee" : null;   // 主动接近，靠移动逻辑走过去（电能炮是死刑机制，回合开始自己落下）
      // 三阶段：每回合必吸引碎片一次 + 攻击一次
      if (u._aiDebrisTurn !== state.turnNo && has("en_agg3_debris")) return "en_agg3_debris";
      if (has("en_agg3_control")) return "en_agg3_control";
      return has("en_agg3_push") ? "en_agg3_push" : "en_agg3_debris";
    }
    return null;
  }

  /** 三阶段的聚合体主动逃离，二阶段主动接近：覆盖表里的 dist */
  function aiDistOverride(u, spec) {
    if (u.kit !== "sand_aggregate") return spec;
    const ph = (u.resources && u.resources.phase) || 1;
    if (ph === 2) return Object.assign({}, spec, { dist: 0 });
    if (ph === 3) return Object.assign({}, spec, { dist: 1 });
    return spec;
  }

  /** 给需要额外选择的技能补上 picks（榴弹落点、激光区域、穿刺的两个目标） */
  function aiPicks(u, sid, target, prey) {
    if (sid === "ufo_sweep") {
      const zones = [];
      for (let z = 1; z <= Number(state.zoneMode); z++) {
        if (zdist(u.zone, z) <= 1) zones.push({ z, n: preyInZone(prey, z).length });
      }
      zones.sort((a, b) => b.n - a.n);
      return zones.length ? { dest: zones[0].z } : null;
    }
    if (sid === "en_gl" || sid === "en_ant_shell") {
      // 被决一死战 / 嘲讽牵制：只能选牵制者所在的区（作者定）
      const forced = typeof enemyForcedTarget === "function" ? enemyForcedTarget(u) : null;
      if (forced) return { dest: Number(forced.zone) };
      // 榴弹 / 大酸液弹发射时照样会被危墙 / 关着的门挡住：隔着墙的区不算人数
      const zones = [];
      const open = (z) => !(typeof lineBlocked === "function" && lineBlocked(u.zone, z));
      for (let z = 1; z <= Number(state.zoneMode); z++) zones.push({ z, n: open(z) ? preyInZone(prey, z).length : 0 });
      zones.sort((a, b) => b.n - a.n);
      return zones.length && zones[0].n ? { dest: zones[0].z } : { dest: target ? Number(target.zone) : 1 };
    }
    if (sid === "en_giant_sand_melee") {
      const here = nearestFirst(u, preyInZone(prey, u.zone));
      const pick = { target1: (here[0] || target || {}).id };
      if (here[1]) pick.target2 = here[1].id;
      return pick;
    }
    return null;
  }

  /** 敌人被危墙挡住：没有任何一个目标能不隔着墙打到时，返回挡在它前进方向上的那堵墙（间隔的键，如 "1-2"），否则 null */
  function wallInTheWay(u, prey, target) {
    if (typeof lineBlocked !== "function" || typeof getGap !== "function") return null;
    if (prey.some(p => !lineBlocked(u.zone, p.zone))) return null;      // 还有不隔墙的目标：照常打人
    const from = Number(u.zone), to = Number(target.zone);
    if (from === to) return null;
    const path = zonePath(from, to);
    const next = path && path.length > 1 ? path[1] : from + (to > from ? 1 : -1);
    const g = getGap(from, next);
    if (!g || g.type !== "wall") return null;                            // 墙不在眼前：先照常走过去
    return Math.min(from, next) + "-" + Math.max(from, next);
  }

  /** 手册第十章的行为描述 → 一次行动。 */
  function aiPlanBase(u) {
    if (typeof mutinyTick === "function") mutinyTick();
    const prey = validPrey(u);
    if (!prey.length) return null;

    let list = [];
    try { list = enemySkillList(u) || []; } catch (e) { list = []; }
    if (!list.length) return null;                  // 例如被挟持的亡命之王
    const has = (id) => list.some(s => s.id === id);

    // 哗变：狂徒只剩反水这一个选项，目标强制为强盗头子
    if (has("en_thug_mutiny")) {
      const boss = findKit("bandit_boss", state.units);
      if (boss && !boss.dead) {
        // 反水是近战：不在同区就先走过去
        if (Number(u.zone) !== Number(boss.zone)) {
          const dest = stepToward(u, boss.zone);
          if (dest != null) return {
            thunk: () => { state.attackerId = u.id; doMove(u, dest); },
            meta: { actorId: u.id, skillName: `移动到 ${dest} 区` }
          };
        }
        return {
          thunk: () => { state.attackerId = u.id; state.targetId = boss.id; runSkill("en_thug_mutiny"); },
          meta: { actorId: u.id, targetId: boss.id, skillName: "反水" }
        };
      }
    }

    const spec = aiDistOverride(u, AI_SPEC[u.kit] || { dist: 0, aim: "local" });
    const pick = aiTarget(u, spec, prey);
    let target = pick.unit;
    if (!target) return null;

    // 狂徒：同区有碎渣机炮、机炮 2 距离内有玩家时，花 1 行动点操控它开火（嘲讽 / 决一死战时只打强制目标）
    if (typeof scrapsFor === "function" && (u.ap || 0) >= 1) {
      const sp = scrapsFor(u).filter(scrapReady)[0];   // 这回合发射过的不再去操控
      const inR = sp ? scrapTargets(sp, u) : [];
      const tgt = inR.includes(target) ? target : (pick.forced ? null : (inR.length ? lowest(inR) : null));
      if (sp && tgt) {
        return {
          thunk: () => { state.attackerId = u.id; state.targetId = tgt.id; runSkill("use_scrap:" + sp.id); },
          meta: { actorId: "prop:" + sp.id, targetId: tgt.id, skillName: `${u.name} 操控碎渣机炮` }
        };
      }
    }

    // 所有目标都隔着危墙（走不过去、也打不过去），而墙就挡在前进方向的下一条间隔上：先打墙
    const wallKey = wallInTheWay(u, prey, target);
    if (wallKey) {
      const sidW = (spec.near && has(spec.near)) ? spec.near : has("en_aa") ? "en_aa" : (list[0] && list[0].id);
      if (sidW) {
        return {
          thunk: () => { state.attackerId = u.id; state.targetId = "gap:" + wallKey; runSkill(sidW); },
          meta: { actorId: u.id, targetId: "gap:" + wallKey, skillName: `攻击危墙（${wallKey.replace("-", "–")} 区之间）` }
        };
      }
    }

    const move = (dest) => ({
      thunk: () => { state.attackerId = u.id; doMove(u, dest); },
      meta: { actorId: u.id, skillName: `移动到 ${dest} 区` },
      ai: { kind: "move", dest: Number(dest), target }
    });
    const attack = (sid, picks) => ({
      thunk: () => {
        state.attackerId = u.id;
        state.targetId = target.id;
        if (picks) state.skillFlow = { id: sid, actorId: u.id, picks, index: 99 };
        try { runSkill(sid); } finally { state.skillFlow = null; }
        if (sid === "en_agg3_debris") u._aiDebrisTurn = state.turnNo;
        if (sid === "en_king_hold") u._aiHoldTurn = state.turnNo;
        if (u.tauntTo === target.id) u.tauntTo = null;
      },
      meta: { actorId: u.id, targetId: target.id, skillName: enemyLabel(u, sid) },
      ai: { kind: "attack", sid, target, picks }
    });

    // 强制目标（嘲讽 / 决一死战）时不后撤，直接想办法打到人；决一死战里根本不能移动
    const duelLocked = typeof touDuelVictim === "function" && !!touDuelVictim(u);
    let step = duelLocked || (pick.forced && zdist(u.zone, target.zone) < (spec.dist || 0))
      ? null
      : aiStep(u, target, spec, prey);
    // 空隙：地面单位越过要花 1 行动点并过运动检定（敌人没有熟练，50%）。目标在空隙那边时照样去试
    // （以前过不去，两区制桥塌后近战双方永远碰不到），有一样近、不用越过空隙的路就走那条；后撤不越过空隙，宁可留在原地打
    if (step != null && !u.flying && typeof getGap === "function" && getGap(u.zone, step).type === "void") {
      const near = zdist(step, target.zone);
      const passable = (z) => { const g = getGap(u.zone, z); return g.type === "open" || g.type === "bridge" || (g.type === "door" && g.open); };
      const alt = adjacentZones(u.zone).map(Number).find(z => z !== step && passable(z) && zdist(z, target.zone) === near &&
        !(state.fields && state.fields[z] && state.fields[z].abyss));
      if (near >= zdist(u.zone, target.zone)) step = null;
      else if (alt != null) step = alt;
    }

    // 沙漠生物的习性：夜晚 / 沙暴不走进有沙珊瑚的区（desert.js · coralAvoid）
    if (step != null && typeof coralAvoid === "function" && coralAvoid(u, step)) step = null;
    let sid = aiSpecial(u, spec, target, prey, has, list);
    if (sid && !["en_agg3_debris", "en_king_hold", "en_king_exec", "en_bigsand_summon", "en_bigsand_heal", "ufo_prime", "ufo_boom", "ufo_stomp", "ufo_sweep", "en_agg2_overheat", "en_gl", "en_gl_fire", "en_ant_shell", "en_ant_shell_fire", "en_gas_ignite", "en_alarm_zap", "en_giant_sand_pulse"].includes(sid)) {
      const rt = retargetLegal(u, sid, target, prey, pick.forced);
      if (rt.target) target = rt.target;
      if (rt.sid) sid = rt.sid;
    }
    const inRange = target && zdist(u.zone, target.zone) === (spec.dist == null ? zdist(u.zone, target.zone) : spec.dist);

    // 手册：够不着就先移动；special 已经给出可用技能且位置合适时直接用
    const noTargetNeeded = sid === "en_agg3_debris" || sid === "en_king_hold" || sid === "en_king_exec" ||
      sid === "en_bigsand_summon" || sid === "en_bigsand_heal" || sid === "ufo_prime" ||
      sid === "ufo_boom" || sid === "ufo_stomp" || sid === "ufo_sweep" || sid === "en_agg2_overheat" ||
      sid === "en_giant_sand_pulse" ||   // 全域沙暴打所有区域，不用瞄准
      sid === "en_gas_ignite" ||         // 点燃燃气打自己所在的区
      sid === "en_alarm_zap";            // 电涌打所有高能的敌人，不用瞄准
    if (sid && (inRange || !step || noTargetNeeded)) {
      // 打不到（射程外、自己又不移动）就不出手，免得每回合空放
      if (noTargetNeeded || canAimSkill(u, sid, target)) return attack(sid, aiPicks(u, sid, target, prey));
      if (step == null) {
        // 这里打不到：先找一个走一步就能打到的站位；找不到时强制目标照旧硬打，其余不出手
        // （决一死战不能移动：不找站位，以前每回合都规划移动、被拦下，整场不出手）
        const fs = duelLocked ? null : firingStep(u, spec, prey, target, list, pick.forced ? target : null);
        if (fs != null) return move(fs);
        if (pick.forced) return attack(sid, aiPicks(u, sid, target, prey));
        return null;
      }
    }
    // 最后一个行动点还够不着时，有远距手段的就先用远距（扬尘体的卷扬）
    const lastAction = (u.ap || 0) <= 1 && (u.bonus || 0) <= 0;
    if (step != null && lastAction && spec.farWhenLast && spec.far && has(spec.far) &&
        zdist(u.zone, target.zone) <= 1) {
      return attack(spec.far, aiPicks(u, spec.far, target, prey));
    }
    if (step != null) return move(step);
    if (sid) return attack(sid, aiPicks(u, sid, target, prey));

    const same = Number(target.zone) === Number(u.zone);
    let use = same ? (spec.near || spec.far) : spec.far;
    if (!use && !AI_SPEC[u.kit]) use = has("en_aa") ? "en_aa" : (list[0] && list[0].id);
    if (!use) return null;                          // 够不着，又没有远距手段（也包括自爆小车等待引信）
    if (!has(use)) use = has("en_aa") ? "en_aa" : (list[0] && list[0].id);
    if (!use) return null;
    const legal = retargetLegal(u, use, target, prey, pick.forced);
    if (legal.target) target = legal.target;
    if (legal.sid) use = legal.sid;
    // 谁都打不到（远距离单位身边只剩同区的人、三区里隔着两区、隔着危墙……）：
    // 先找一个走一步就能打到的站位；没有就这一步不出手，不空放（强制目标照旧硬打）
    if (!canAimSkill(u, use, target)) {
      const fs = duelLocked ? null : firingStep(u, spec, prey, target, list, pick.forced ? target : null);
      if (fs != null) return move(fs);
      if (!pick.forced) return null;
    }
    return attack(use, aiPicks(u, use, target, prey));
  }

  /* ---------- 沙暴风向：飞行敌人会自己走出逆风、走进顺风 ----------
   * 回合开始时按所在区的风向结算：飞行单位顺风 +1 行动点、逆风 −1 行动点。
   * - 本来就要移动：一样能走到 / 一样近的几个区里挑风向好的；
   * - 精英 / 首领（移动用附赠行动）要出手前：换到风向更好、照样打得到原目标的相邻区再打；
   * - 这一步没事可做（打不到人）：往风向更好的相邻区挪（杂兵移动要花行动点，只在这时才为风向挪）。 */
  function windOf(u, z) {
    if (!u || !u.flying || state.weather !== "sand" || typeof sandWind !== "function") return 0;
    if (state.fields && state.fields[z] && state.fields[z].isolate) return 0;
    return sandWind(z, state.zoneMode, state.sandDir);
  }
  function windStep(u, keep) {
    if (!canPayMove(u)) return null;
    const here = windOf(u, u.zone);
    const opts = walkableNeighbors(u).filter(z => windOf(u, z) > here && (!keep || keep(z)));
    if (!opts.length) return null;
    return opts.sort((a, b) => windOf(u, b) - windOf(u, a) || a - b)[0];
  }
  function windMove(u, dest) {
    return { thunk: () => { state.attackerId = u.id; doMove(u, dest); }, meta: { actorId: u.id, skillName: `移动到 ${dest} 区（${windOf(u, dest) > 0 ? "顺风" : "躲开逆风"}）` }, ai: { kind: "wind", dest } };
  }
  function aiPlan(u) {
    if (u && u.trainingDummy) return null;   // 训练场的木桩：不行动
    if (u && u.dormant) return null;         // 休眠：不行动，直到被叫醒
    if (typeof sinkLocked === "function" && sinkLocked(u)) return null;   // 流沙没顶：不能行动
    if (typeof isNeutralCreature === "function" && isNeutralCreature(u)) return null;   // 中立生物不行动
    if (typeof sandFishPlan === "function") {   // 沙鱼：捕食、白天的伏咬沙鱼潜伏不动（desert.js）
      const fp = sandFishPlan(u);
      if (fp === "wait") return null;
      if (fp) return fp;
    }
    const plan = aiPlanBase(u);
    if (!u || !u.flying || state.weather !== "sand" || u.noMove || u.self === "frost") return plan;
    if (typeof touDuelVictim === "function" && touDuelVictim(u)) return plan;   // 决一死战中不移动
    const info = plan && plan.ai;
    if (!plan) {
      const z = windStep(u);
      return z != null ? windMove(u, z) : null;
    }
    if (!info) return plan;
    if (info.kind === "move") {
      // 换一个一样近（离目标的距离相同）、风向更好的区走
      const want = info.target ? zdist(info.dest, info.target.zone) : null;
      const alt = want == null ? null : walkableNeighbors(u).filter(z => z !== info.dest && windOf(u, z) > windOf(u, info.dest) && zdist(z, info.target.zone) === want)
        .sort((a, b) => windOf(u, b) - windOf(u, a) || a - b)[0];
      return alt != null ? windMove(u, alt) : plan;
    }
    if (info.kind === "attack") {
      const rank = typeof enemyRankOf === "function" ? enemyRankOf(u) : "minion";
      if (rank === "minion" || !info.target || info.target.kind) return plan;   // 杂兵移动要花行动点，不为风向放弃出手
      const from = u.zone;
      const z = windStep(u, (zz) => { u.zone = zz; try { return canAimSkill(u, info.sid, info.target); } finally { u.zone = from; } });
      return z != null ? windMove(u, z) : plan;
    }
    return plan;
  }

  /** 做决定时用「回合 + 单位 + 第几步」派生的固定随机数。
   *  局势没变时，同一个敌人在同一回合的决定总是一样的——Helumica「环境监测」的预测靠这个才准。
   *  （执行动作时的掷骰、格挡判定仍然是真随机。） */
  function planFor(u, step) {
    if (!u || typeof makeRng !== "function") return aiPlan(u);
    const prev = Math.random;
    Math.random = makeRng(`ai:${state.turnNo}:${u.id}:${step || 0}`);
    try { return aiPlan(u); } finally { Math.random = prev; }
  }

  /** 敌人选谁来协助攻击：只在打得到的人里挑 atk 最高的；谁都打不到就不发动（返回 null）。
   *  以前打不到的也会被选上：先回满架势，再打空。target 不给时取协助队列队首的目标 */
  function aiPickAssister(list, target) {
    const t = target || (state.assistQueue && state.assistQueue[0] ? unitById(state.assistQueue[0].targetId) : null);
    const ok = (list || []).filter(u => !t || typeof enemyAssistReach !== "function" || enemyAssistReach(u, t));
    if (!ok.length) return null;
    return ok.slice().sort((a, b) => (effectiveAtk(b, state.units) || 0) - (effectiveAtk(a, state.units) || 0))[0].id;
  }

  /** 敌人回合的出手顺序：杂兵 → 精英 → BOSS */
  /** 发号施令的敌人总是第一个行动：亡命之王的命令要用狂徒们这一回合的行动点（回防筑墙）、
   *  改狂徒们的目标（攻击命令），排在最后的话狂徒早就把行动点用完了。其余照「杂兵 → 精英 → 首领」 */
  const COMMANDERS = ["outlaw_king"];
  function actingOrder() {
    const r = { minion: 0, elite: 1, boss: 2 };
    const key = u => (COMMANDERS.includes(u.kit) ? -1 : (r[enemyRankOf(u)] || 0));
    return foes().sort((a, b) => key(a) - key(b)).map(u => u.id);
  }

  return {
    SPEC: AI_SPEC,
    plan: aiPlan,
    planFor,
    pickAssister: aiPickAssister,
    actingOrder,
    target: aiTarget,
    step: aiStep,
    special: aiSpecial,
    unitAlive, players, foes
  };
})();
