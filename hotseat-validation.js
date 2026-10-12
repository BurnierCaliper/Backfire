/* D2 host-side battle input checks. No action, dice, animation or point spend is
 * executed here. Existing read helpers run against disposable state data because
 * a few legacy readers normalize resources/bags as they read them.
 * validateBattle(cmd,{session,sender,game}) returns true or throws (code + message).
 * reason(unit,skill,session,sender,game) returns a button-level reason or null;
 * final target/flow validation is exclusively validateBattle's responsibility.
 */
(function (root) {
  "use strict";
  const actionTypes = ["skill", "move", "standUp", "useItem"];
  // runSkillInner's needT branches, plus its equivalent explicit target guards.
  // This only says whether a primary target is mandatory; the existing flow and
  // range helpers remain authoritative for the options and their legal ranges.
  const needsTarget = new Set(("ruby_aa ruby_trigger wing_aa mint_steal yuito_aa latte_puff hiaki_aa niu_slash naruto_wind mochi_roar " +
    "xia_aa xia_execute berniel_ignite berniel_flare chuan_aa chuan_whip chuan_cover nora_needle vitas_dance xia_crush " +
    "chuan_over bili_beam bili_storm ruby_surge wing_surge ruby_short mint_banish latte_love hiaki_pot niu_tsubame naruto_fly tou_ultra " +
    "role_double_dot role_halve role_omen role_buffer role_renew role_shelter role_harsh role_boost role_sturdy role_gold role_firstaid " +
    "role_cover role_pull kolt_aa kolt_chase helu_aa ecmo_bite ras_aa ras_dump edc_shock bare_aa yuito_inspire chuan_blade role_spread " +
    "longge_aa longge_chill longge_spit xiaoxiao_punch xiaoxiao_heal xiaoxiao_combo").split(" "));
  function fail(message, code) { const e = new Error(message); e.code = code || "invalid_battle_action"; throw e; }
  function duplicate(value, seen = new Map()) {
    if (!value || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);
    const result = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
    seen.set(value, result);
    for (const key of Object.keys(value)) result[key] = duplicate(value[key], seen);
    return result;
  }
  function readOnly(fn) {
    const descriptors = Object.getOwnPropertyDescriptors(state), draft = duplicate(state);
    const ledger = typeof LEDGER === "undefined" ? null : LEDGER;
    const ledgerDescriptors = ledger && Object.getOwnPropertyDescriptors(ledger), ledgerDraft = ledger && duplicate(ledger);
    try {
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, draft);
      if (ledger) { for (const key of Object.keys(ledger)) delete ledger[key]; Object.assign(ledger, ledgerDraft); }
      return fn();
    } finally {
      for (const key of Object.keys(state)) delete state[key];
      Object.defineProperties(state, descriptors);
      if (ledger) { for (const key of Object.keys(ledger)) delete ledger[key]; Object.defineProperties(ledger, ledgerDescriptors); }
    }
  }
  const present = u => !!u && !u.dead && !u.hidden && !u.fused && !u._removed;
  function descriptor(actor, id) {
    if (id === "__stand") return { id, cost: {} };
    if (id === "__move" || id === "__item") return { id, cost: { bonus: 1 } };
    if (typeof id !== "string" || /^fx_|_assist$|_opp$/.test(id) || id === "assist_block") return null;
    if (id.startsWith("use_device:")) {
      const p = (state.props || []).find(x => "use_device:" + x.id === id && Number(x.zone) === Number(actor.zone) && ["button", "lever"].includes(x.kind));
      return p ? { id, name: p.name, cost: { ap: 1 } } : null;
    }
    if (id.startsWith("use_scrap:")) {
      const p = (state.props || []).find(x => "use_scrap:" + x.id === id);
      if (!p || typeof scrapsFor !== "function" || !scrapsFor(actor).includes(p)) return null;
      return { id, name: "操控 " + p.name, cost: { ap: 1 } };
    }
    if (id.startsWith("hack_turret:")) {
      const p = (state.props || []).find(x => "hack_turret:" + x.id === id);
      if (!p || typeof turretHackError !== "function" || turretHackError(actor, p)) return null;
      return { id, name: p.name, cost: { ap: 1 } };
    }
    const sk = (skillList(actor) || []).find(x => x.id === id && !/协助攻击|协助格挡|空手格挡/.test(x.name || ""));
    return sk ? Object.assign({}, sk, { cost: skillCost(id) || {} }) : null;
  }
  function baseReason(actor, sk, game) {
    if (!present(actor) || !actor.isPlayer) return "这个单位不能行动";
    if (actor.dying && sk.id !== "__stand") return "濒死中，请先起身";
    if (game && typeof game.baseBlockReason === "function") return game.baseBlockReason(actor, sk) || null;
    // Headless callers have no GAME. This is the same basic gate as game.js;
    // actual skill requirements and dynamic costs still come from rule helpers.
    if (game && game.ended) return "战斗已结束";
    if (!state.combatStarted) return "战斗尚未开始";
    if (state.combatPhase !== "player") return "敌人回合";
    if (sk.id === "__stand") return standUpBlocked(actor);
    if (actor.stunned) return "失衡中，本回合无法行动";
    if ((sk.cost.ap || 0) > (actor.ap || 0)) return "行动点不足";
    if ((sk.cost.bonus || 0) > (actor.bonus || 0)) return "附赠行动不足";
    if (sk.id === "__move" && actor.noMove) return "本回合无法移动";
    return skillRequirementError(actor, sk.id) || null;
  }
  function assertBase(actor, sk, game) {
    if (!sk) fail("这个单位没有这项可用技能", "unknown_skill");
    const why = baseReason(actor, sk, game);
    if (why) fail(why);
  }
  function reason(unit, skill, session, sender, game) {
    try {
      if (!unit) fail("没有行动单位");
      session.assertAction(sender, unit.id);
      return readOnly(() => {
        const actor = unitById(unit.id), id = typeof skill === "string" ? skill : skill && skill.id;
        if (!id) {
          if (!present(actor) || !actor.isPlayer) fail("这个单位不能行动");
          return null;
        }
        assertBase(actor, descriptor(actor, id), game);
        return null;
      });
    } catch (error) { return error.message || String(error); }
  }
  function checkFlow(actor, cmd) {
    const picks = cmd.picks || {}, accepted = {}, processed = new Set();
    let lastUnit = null;
    for (let count = 0; count < 16; count++) {
      const steps = skillFlowSteps(cmd.skill, actor, accepted) || [];
      const step = steps.find(x => !processed.has(x.key));
      if (!step) break;
      processed.add(step.key);
      const value = picks[step.key];
      if (value == null) {
        if (!step.optional) fail("请完成分步选择：" + step.label, "invalid_pick");
        accepted[step.key] = null;
        continue;
      }
      let valid;
      if (step.type === "zone") valid = Number.isInteger(value) && (step.zones || []).includes(value);
      else if (step.type === "unit") valid = typeof value === "string" && (step.units || []).some(u => u.id === value && present(u));
      else valid = (step.options || []).some(x => x.value === value);
      if (!valid) fail("不合法的分步选择：" + step.label, "invalid_pick");
      accepted[step.key] = value;
      if (step.type === "unit" && value) lastUnit = value;
    }
    if (Object.keys(picks).some(key => !processed.has(key))) fail("包含未提供的分步选项", "invalid_pick");
    if (lastUnit && cmd.target !== lastUnit) fail("技能目标与分步选择不一致", "invalid_target");
    return { hasUnit: !!lastUnit, picks: accepted };
  }
  function targetObject(id) {
    if (!id) return null;
    const unit = unitById(id);
    if (unit) return present(unit) ? unit : null;
    if (typeof id !== "string") return null;
    if (id.startsWith("prop:")) {
      const p = propByRef(id);
      return p ? Object.assign({}, p, { id, isPlayer: p.faction !== "enemy", isStructure: true }) : null;
    }
    if (id.startsWith("gap:")) {
      const key = id.slice(4), g = (state.gaps || {})[key];
      if (!g || !["wall", "bridge"].includes(g.type) || !(Number(g.hp) > 0)) return null;
      return { id, zone: Number(key.split("-")[0]), zones: key.split("-").map(Number), isPlayer: false, isStructure: true };
    }
    return null;
  }
  function checkTarget(actor, cmd, sk, flow) {
    let target = targetObject(cmd.target);
    if (cmd.target != null && !target) fail("没有这个可用目标", "invalid_target");
    const pinned = ["nora_aa", "vitas_slash"].includes(cmd.skill) && piercedTarget(cmd.skill === "nora_aa" ? actor : noraOf());
    if (pinned && !target) target = pinned;
    // 不倒战意 15 级选「全部友方」（行动点）不需要单独的目标
    const wholeParty = cmd.skill === "role_sturdy" && flow.picks.mode === "all";
    if (!wholeParty && (needsTarget.has(cmd.skill) || ["nora_aa", "vitas_slash"].includes(cmd.skill)) && !target) fail("请先选择技能目标", "invalid_target");
    const why = skillTargetError(actor, cmd.skill, target);
    if (why) fail(why, "invalid_target");
    if (!target || flow.hasUnit || pinned) return;
    const hint = (sk.hint || "") + " " + (sk.name || "");
    const side = typeof SKILL_TARGET_SIDE !== "undefined" && SKILL_TARGET_SIDE[cmd.skill] ||
      (/任意单位|拉到|磁力/.test(hint) ? "any" : /友方|队友/.test(hint) ? "ally" : "enemy");
    if (!target.isStructure && ((target.id === actor.id && side !== "allySelf" && side !== "anySelf") ||
      (["ally", "allySelf"].includes(side) && !target.isPlayer) || (side === "enemy" && target.isPlayer))) fail("这项技能不能选择这一方的目标", "invalid_target");
    if (target.isStructure && ["ally", "allySelf", "anySelf"].includes(side)) fail("这项技能需要以单位为目标", "invalid_target");
    const ov = skillRangeFor(actor, cmd.skill), zones = target.zones || [target.zone];
    const reachable = zones.some(zone => {
      if (ov) { const d = zoneDist(actor.zone, zone, state.zoneMode); return d >= ov.min && d <= ov.max; }
      return inSkillRange(actor, Object.assign({}, target, { zone }), hint, state.zoneMode);
    });
    if (!reachable) fail("目标超出技能射程", "invalid_target");
  }
  function checkMove(actor, cmd) {
    const from = Number(actor.zone), dest = cmd.dest;
    if (!Number.isInteger(dest) || dest < 1 || dest > Number(state.zoneMode) || Math.abs(dest - from) !== 1) fail("一次只能移动到相邻的有效区域", "invalid_move");
    if (typeof isCrushing === "function" && isCrushing(actor)) fail("正抓在敌人身上，无法主动移动", "invalid_move");
    if (typeof touDuelVictim === "function" && touDuelVictim(actor)) fail("决一死战中不能移动", "invalid_move");
    if (actor.self === "frost") fail("霜结：无法自行移动", "invalid_move");
    const field = (state.fields || {})[from] || {};
    if (field.abyss && !actor.flying) fail("深渊只有飞行单位才能通过", "invalid_move");
    const why = zoneReachable(actor, dest, true);
    if (why) fail(why, "invalid_move");
    if (field.acid && !actor.flying && (actor.ap || 0) < 1) fail("离开酸液地面需要行动点", "invalid_move");
    // 空隙：地面单位花 1 行动点做运动检定才能越过（检定在执行时掷）
    const gap = (state.gaps || {})[gapKey(from, dest)];
    if (gap && gap.type === "void" && !actor.flying && (actor.ap || 0) < 1) fail("越过空隙需要 1 行动点", "invalid_move");
  }
  function checkItem(actor, cmd) {
    const spec = typeof cmd.item === "string" && Object.hasOwn(ITEM_CATALOG, cmd.item) && ITEM_CATALOG[cmd.item];
    const have = spec && spec.target === "weapon" && typeof repairPoints === "function" ? repairPoints() : typeof itemCountFor === "function" ? itemCountFor(actor, cmd.item) : bagCount(cmd.item);
    if (!spec || !spec.combat || have < 1) fail("背包里没有这件可用战斗道具", "invalid_item");
    if (spec.target === "weapon") {
      // 维修工具包：dest 是要修的武器 kit
      if (typeof cmd.dest !== "string" || !repairTargets().some(r => r.kit === cmd.dest && r.need > 0)) fail("维修工具包需要选一把要修的武器", "invalid_item");
      return;
    }
    if (spec.target === "ally") {
      const target = unitById(cmd.target);
      if (!present(target) || !target.isPlayer) fail("道具需要选择在场友方", "invalid_item");
    } else if (spec.target === "zone") {
      if (!Number.isInteger(cmd.dest) || cmd.dest < 1 || cmd.dest > Number(state.zoneMode)) fail("道具需要选择有效区域", "invalid_item");
      if (cmd.target != null) fail("区域道具不能夹带单位目标", "invalid_item");
      if (typeof lineBlocked === "function" && lineBlocked(actor.zone, cmd.dest)) fail("隔着危墙 / 关着的门，道具影响不到那一区", "invalid_item");
    } else if (cmd.target != null && cmd.target !== actor.id) fail("这件道具只能对自己使用", "invalid_item");
    if (spec.target !== "zone" && cmd.dest != null) fail("这件道具不接受区域选项", "invalid_item");
  }
  function validateBattle(cmd, context) {
    if (!cmd || !actionTypes.includes(cmd.type)) fail("不是可执行的战斗动作", "unknown_action");
    const { session, sender, game } = context || {};
    if (!session || typeof session.assertAction !== "function") fail("没有热座会话");
    if (typeof cmd.actor !== "string" || !cmd.actor) fail("缺少行动单位");
    session.assertAction(sender, cmd.actor);
    return readOnly(() => {
      const actor = unitById(cmd.actor);
      if (!present(actor) || !actor.isPlayer) fail("没有这个可用玩家单位");
      if (cmd.target != null && typeof cmd.target !== "string") fail("目标编号必须是字符串", "invalid_target");
      if (cmd.picks != null && (typeof cmd.picks !== "object" || Array.isArray(cmd.picks))) fail("分步选项必须是对象", "invalid_pick");
      state.attackerId = actor.id; state.selectedId = actor.id; state.targetId = cmd.target || null;
      state.skillFlow = cmd.type === "skill" ? { id: cmd.skill, actorId: actor.id, picks: duplicate(cmd.picks || {}), index: 99 } : null;
      const id = { move: "__move", standUp: "__stand", useItem: "__item" }[cmd.type] || cmd.skill;
      const sk = descriptor(actor, id);
      if (cmd.type === "skill" && ["__stand", "__move", "__item"].includes(id)) fail("请使用对应的语义动作类型", "unknown_skill");
      assertBase(actor, sk, game);
      if (cmd.type === "standUp") {
        if (isWeaponUnit(actor) || (!actor.dying && totalHp(actor) > 0)) fail("这个单位现在不需要或不能起身");
      } else if (cmd.type === "move") checkMove(actor, cmd);
      else if (cmd.type === "useItem") checkItem(actor, cmd);
      else {
        const flow = checkFlow(actor, cmd);
        checkTarget(actor, cmd, sk, flow);
        const duel = typeof touDuelVictim === "function" && touDuelVictim(actor);
        if (duel && ((cmd.target && cmd.target !== duel.id) || (!cmd.target && /aoe|all|zone|area|扫/.test(id)) || /move|shift|dash|进出|移动/.test(id) || id.startsWith("use_device:"))) fail("决一死战中只能攻击灯");
      }
      return true;
    });
  }
  root.HotseatValidation = { validateBattle, reason, inspect: readOnly };
  if (typeof module !== "undefined" && module.exports) module.exports = root.HotseatValidation;
})(typeof globalThis !== "undefined" ? globalThis : window);
