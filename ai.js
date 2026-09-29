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
  function foes() { return state.units.filter(u => !u.isPlayer && unitAlive(u) && u.kit !== "ironwall"); }

  function hpOf(u) {
    if (u.upOnShp) return Number(u.shp) || 0;
    return (u.layers || []).reduce((a, l) => a + Math.max(0, Number(l.current) || 0), 0);
  }
  function validPrey() {
    return players().filter(u => unitAlive(u) && !u.hidden && !(u.dying && !u.upOnShp));
  }
  function canAimSkill(u, sid, t) {
    if (!u || !t || !unitAlive(t) || t.hidden || t.fused) return false;
    if (t.dying && !t.upOnShp) return false;
    const d = zdist(u.zone, t.zone);
    const table = (typeof SKILL_RANGE !== "undefined" && SKILL_RANGE[sid]) || null;
    if (table) return d >= (table.min || 0) && d <= (table.max == null ? 99 : table.max);
    if (sid === "en_aa" || !sid) {
      const rg = u.range || "any";
      if (rg === "melee") return d === 0;
      if (rg === "ranged") return d === 1;
      return d <= 1;
    }
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
  function adjacentZones(z) {
    const n = Number(state.zoneMode);
    const out = [];
    for (let i = 1; i <= n; i++) if (Math.abs(i - Number(z)) === 1) out.push(i);
    return out;
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
    const duel = typeof touDuelVictim === "function" ? touDuelVictim(u) : null;
    if (duel && unitAlive(duel) && !(duel.dying && !duel.upOnShp)) return { unit: duel, forced: true };
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
    if (aim === "lowest") return { unit: lowest(prey) };
    if (aim === "nearest") return { unit: nearestFirst(u, prey)[0] };
    if (aim === "topAtk") {
      const s = prey.slice().sort((a, b) =>
        (effectiveAtk(b, state.units) || 0) - (effectiveAtk(a, state.units) || 0));
      return { unit: s[0] };
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
        return kz === from ? null : (from < kz ? from + 1 : from - 1);
      }
    }
    if (spec.dist == null || u.noMove) return null;
    const d = zdist(u.zone, target.zone);
    if (d === spec.dist) return null;
    if (d > spec.dist) {                            // 太远 → 接近一格
      const from = Number(u.zone), to = Number(target.zone);
      return from < to ? from + 1 : from - 1;
    }
    // 太近 → 后撤。手册规定优先退到没有敌人的区，退不掉才留下打。
    const open = adjacentZones(u.zone).filter(z => !preyInZone(prey, z).length);
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
      return prey.some(p => zdist(u.zone, p.zone) === 1) ? "en_boat_arc" : null;
    }
    if (spec.special === "king") {
      if (r.hostage) return null;                   // 被挟持，无法行动
      const thugs = state.units.filter(x =>
        !x.isPlayer && !x.dead && !x.hidden && /^(thug_|bandit_boss)/.test(x.kit || ""));
      const scattered = thugs.some(x => Number(x.zone) !== Number(u.zone));
      if (scattered && thugs.length >= 2 && has("en_king_hold") && u._aiHoldTurn !== state.turnNo) {
        return "en_king_hold";
      }
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
      if (ph === 2) {
        if (has("en_agg2_overheat")) return "en_agg2_overheat";
        if (has("en_agg2_charge")) return "en_agg2_charge";
        return sameZone ? "en_agg2_melee" : null;   // 主动接近，靠移动逻辑走过去
      }
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
    if (sid === "en_gl") {
      const zones = [];
      for (let z = 1; z <= Number(state.zoneMode); z++) zones.push({ z, n: preyInZone(prey, z).length });
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

  /** 手册第十章的行为描述 → 一次行动。 */
  function aiPlan(u) {
    if (typeof mutinyTick === "function") mutinyTick();
    const prey = validPrey();
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
          const dest = Number(u.zone) + (Number(boss.zone) > Number(u.zone) ? 1 : -1);
          return {
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

    const move = (dest) => ({
      thunk: () => { state.attackerId = u.id; doMove(u, dest); },
      meta: { actorId: u.id, skillName: `移动到 ${dest} 区` }
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
      meta: { actorId: u.id, targetId: target.id, skillName: enemyLabel(u, sid) }
    });

    // 强制目标（嘲讽 / 决一死战）时不后撤，直接想办法打到人
    const step = pick.forced && zdist(u.zone, target.zone) < (spec.dist || 0)
      ? null
      : aiStep(u, target, spec, prey);

    let sid = aiSpecial(u, spec, target, prey, has, list);
    if (sid && !["en_agg3_debris", "en_king_hold", "en_bigsand_summon", "en_bigsand_heal", "ufo_prime", "ufo_boom", "ufo_stomp", "ufo_sweep", "en_agg2_overheat", "en_gl", "en_gl_fire"].includes(sid)) {
      const rt = retargetLegal(u, sid, target, prey, pick.forced);
      if (rt.target) target = rt.target;
      if (rt.sid) sid = rt.sid;
    }
    const inRange = target && zdist(u.zone, target.zone) === (spec.dist == null ? zdist(u.zone, target.zone) : spec.dist);

    // 手册：够不着就先移动；special 已经给出可用技能且位置合适时直接用
    const noTargetNeeded = sid === "en_agg3_debris" || sid === "en_king_hold" ||
      sid === "en_bigsand_summon" || sid === "en_bigsand_heal" || sid === "ufo_prime" ||
      sid === "ufo_boom" || sid === "ufo_stomp" || sid === "ufo_sweep" || sid === "en_agg2_overheat";
    if (sid && (inRange || !step || noTargetNeeded)) return attack(sid, aiPicks(u, sid, target, prey));
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
    return attack(use, aiPicks(u, use, target, prey));
  }

  function aiPickAssister(list) {
    return list.slice().sort((a, b) => (effectiveAtk(b, state.units) || 0) - (effectiveAtk(a, state.units) || 0))[0].id;
  }

  /** 敌人回合的出手顺序：杂兵 → 精英 → BOSS */
  function actingOrder() {
    const r = { minion: 0, elite: 1, boss: 2 };
    return foes().sort((a, b) => (r[enemyRankOf(a)] || 0) - (r[enemyRankOf(b)] || 0)).map(u => u.id);
  }

  return {
    SPEC: AI_SPEC,
    plan: aiPlan,
    pickAssister: aiPickAssister,
    actingOrder,
    target: aiTarget,
    step: aiStep,
    special: aiSpecial,
    unitAlive, players, foes
  };
})();
