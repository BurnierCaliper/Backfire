/* D3 authority-only GM commands. The room supplies an unforgeable host context.
 * Enemy control metadata is a sidecar: it never enters the legacy save schema. */
(function (root) {
  "use strict";
  let adapter = {}, round = 0, manualAll = false;
  const metadata = new Map();
  const TYPES = ["spawnEnemy", "removeUnit", "editUnit", "copyUnit", "addProp", "editProp", "removeProp", "editGap", "setField", "setWeather", "setEncounter", "forceAttack", "setManual", "enemyAct", "enemyEndTurn"].map(x => "gm." + x);
  const PROP_KINDS = ["button", "lever", "battery", "boom", "acid", "scrap", "turret", "ironwall", "scrapwall", "dome", "coral_branch", "coral_tentacle"];   // 沙珊瑚枝 / 触须：和沙漠遭遇同一套（props.js · desert.js）
  const WEATHERS = ["none", "heat", "snow", "acid", "thunder", "glow", "sand", "phase"];
  const STATUS_NUM = ["burn"];
  const STATUS_BOOL = ["shock", "corr", "frostbite", "shockwave", "high", "reso", "unstable", "weak", "inspire", "sturdy", "advantage", "hide", "chase"];
  const NO_TARGET = new Set("en_boom_fuse en_patrol_chase en_patrol_near en_gl en_gl_fire en_ant_shell en_ant_shell_fire en_riot_bottle en_riot_bottle_fire en_gas_ignite en_hunter_heat en_alarm_zap en_bigsand_summon en_bigsand_heal en_live_absorb en_giant_sand_pulse en_boat_arc en_king_hold en_king_exec en_thug_mutiny en_chi_cover ufo_stomp ufo_sweep ufo_prime ufo_boom en_agg2_overheat en_agg3_debris en_agg1_rush en_agg1_rush_prep ufo_summon".split(" "));
  const INSTANTS = ["melt", "sting", "overload", "shift", "spread", "refract"];   // 即时效果（trpg-commands.js · CalcCommands 同一份）
  const UNIT_NAME_MAX = 40, MAX_LAYERS = 6;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const copy = x => JSON.parse(JSON.stringify(x));
  const present = u => !!u && !u.dead && !u.hidden && !u.fused && !u._removed;
  function fail(message, code = "invalid_gm_command") { const error = new Error(message); error.code = code; throw error; }
  function object(x, label) { if (!x || typeof x !== "object" || Array.isArray(x)) fail(label + "必须是对象"); return x; }
  function keys(x, allowed, label) { object(x, label); if (Object.keys(x).some(k => !allowed.includes(k))) fail(label + "包含未知字段"); }
  function number(x, label, min = 0, max = Number.MAX_SAFE_INTEGER, integer = false) {
    if (typeof x !== "number" || !Number.isFinite(x) || x < min || x > max || (integer && !Number.isInteger(x))) fail(label + "超出合法范围");
    return x;
  }
  /** 个体值水平 { hp, atk }：各 −10～10 的整数，null / 不写 = 随机（生成时）或不变（修改时） */
  function ivCheck(iv) {
    if (!iv || typeof iv !== "object" || Array.isArray(iv)) fail("个体值必须是 { hp, atk }");
    keys(iv, ["hp", "atk"], "个体值");
    ["hp", "atk"].forEach(k => { if (own(iv, k) && iv[k] !== null) number(iv[k], "个体值 " + k, -10, 10, true); });
  }
  /** 种族："红皮人" / "类人" / "兽人·牛"（大支·小分支）；只有有种族的敌人能指定 */
  function raceCheck(r, u) {
    if (typeof r !== "string" || typeof raceParse !== "function" || !raceParse(r)) fail("未知的种族");
    if (u && (typeof enemyRaceInfo !== "function" || !enemyRaceInfo(u))) fail("这个敌人没有种族");
  }
  function bool(x, label) { if (typeof x !== "boolean") fail(label + "必须是布尔值"); }
  function one(x, values, label) { if (!values.includes(x)) fail("未知的" + label); }
  function zone(z, count = Number(state.zoneMode)) { return number(z, "区域", 1, count, true); }
  // Existing battle/exploration level selectors and progression tables cover 1–25.
  // Higher levels can otherwise create unbounded addedDiceByLevel roll counts.
  function level(lv) { return number(lv, "等级", 1, 25, true); }
  function unit(id) { if (typeof id !== "string") fail("单位编号必须是字符串"); const u = unitById(id); if (!u) fail("没有这个单位"); return u; }
  function enemy(id, live = true) { const u = unit(id); if (u.isPlayer || (live && !present(u))) fail("没有这个可用敌人"); return u; }
  function prop(id) { const p = (state.props || []).find(p => p.id === id); if (!p) fail("没有这个配置物"); return p; }
  function gapKeyCheck(k) { one(k, boardGapKeys(), "间隔"); }
  function requireHost(context) { if (typeof adapter.requireHost !== "function" || adapter.requireHost(context) !== true) fail("只有房间主持人可以操作", "gm_forbidden"); }
  function configure(next) { adapter = Object.assign({}, adapter, next || {}); }
  function reset() { metadata.clear(); manualAll = false; round = 0; }
  function info(u) { return u ? metadata.get(typeof u === "string" ? u : u.id) : undefined; }
  function isManual(u) { const actor = typeof u === "string" ? unitById(u) : u; if (!actor || actor.isPlayer) return false; const m = info(actor); return m && own(m, "manual") ? m.manual : manualAll; }
  function enemyMayAct(u, at = Number(state.turnNo) || round || 1) { const m = info(u); return !!u && !u.isPlayer && present(u) && (!m || at >= m.eligibleEnemyRound); }
  function beginEnemyRound(at) { number(at, "敌人回合", 1, Number.MAX_SAFE_INTEGER, true); round = at; return round; }
  function snapshot() { return { version: 1, round, manualAll, units: Array.from(metadata, ([id, data]) => Object.assign({ id }, data)).filter(row => unitById(row.id)) }; }
  function restore(input, context) {
    requireHost(context);
    const data = Commands.validate({ type: "gm.sidecar", data: input }).data;
    keys(data, ["version", "round", "manualAll", "units"], "控制快照");
    if (data.version !== 1) fail("不支持的控制快照版本");
    number(data.round, "敌人回合", 0, Number.MAX_SAFE_INTEGER, true); bool(data.manualAll, "全体手动");
    if (!Array.isArray(data.units)) fail("控制快照单位必须是数组");
    const next = new Map();
    data.units.forEach(row => {
      keys(row, ["id", "manual", "eligibleEnemyRound"], "控制快照单位"); enemy(row.id, false);
      if (next.has(row.id)) fail("控制快照有重复单位");
      number(row.eligibleEnemyRound, "允许行动回合", 0, Number.MAX_SAFE_INTEGER, true);
      if (own(row, "manual")) bool(row.manual, "手动开关");
      const value = { eligibleEnemyRound: row.eligibleEnemyRound };
      if (own(row, "manual")) value.manual = row.manual;
      next.set(row.id, value);
    });
    metadata.clear(); next.forEach((v, k) => metadata.set(k, v)); manualAll = data.manualAll; round = data.round;
    return snapshot();
  }
  function patchUnit(u, p) {
    const numeric = ["hp", "shp", "shpMax", "def", "defMax", "ap", "apMax", "bonus", "bonusMax", "atk", "highEnergy"];
    const flags = ["stunned", "stun", "dying", "dead", "flying"];
    // 和单机的单位编辑器（app.js · renderEditor）一样的字段：名称、即时效果、挂下一击的属性专属攻击效果、加 / 删血量层、血量层类型、结算中和
    keys(p, numeric.concat(flags, ["layers", "level", "zone", "statuses", "self", "iv", "race", "enriched", "name", "instant", "atkFx", "addLayer", "removeLayer", "neutralize"]), "单位补丁");
    if (own(p, "race")) raceCheck(p.race, u);
    if (own(p, "name")) { if (typeof p.name !== "string" || !p.name.trim() || p.name.length > UNIT_NAME_MAX) fail(`名称要 1–${UNIT_NAME_MAX} 个字`); }
    if (own(p, "instant")) { keys(p.instant, INSTANTS, "即时效果"); Object.values(p.instant).forEach(v => bool(v, "即时效果")); if (!Object.keys(p.instant).length) fail("即时效果补丁为空"); }
    if (own(p, "atkFx")) {
      object(p.atkFx, "攻击效果"); if (!Object.keys(p.atkFx).length) fail("攻击效果补丁为空");
      Object.entries(p.atkFx).forEach(([k, v]) => { if (typeof ATKFX === "undefined" || !own(ATKFX, k)) fail("未知的攻击效果"); bool(v, "攻击效果"); });
    }
    if (own(p, "addLayer")) { if (p.addLayer !== true) fail("加层只能写 true"); if ((u.layers || []).length >= MAX_LAYERS) fail(`最多 ${MAX_LAYERS} 层血量`); }
    if (own(p, "removeLayer")) {
      number(p.removeLayer, "要删的层", 0, MAX_LAYERS, true);
      if (!(u.layers || [])[p.removeLayer]) fail("没有这一层");
      if ((u.layers || []).length <= 1) fail("至少要留一层血量");
      if (own(p, "layers") || own(p, "hp") || own(p, "addLayer")) fail("删层不能和其他血量修改一起提交");
    }
    if (own(p, "neutralize")) { if (p.neutralize !== true) fail("结算中和只能写 true"); if (typeof applyNeutralize !== "function") fail("这个版本没有中和规则"); }
    if (own(p, "enriched")) { bool(p.enriched, "富集"); if (typeof isSandFish !== "function" || !isSandFish(u)) fail("只有沙鱼能设富集"); }
    if (own(p, "iv")) { if (typeof ivEligible !== "function" || !ivEligible(u)) fail("只有杂兵、精英有个体值"); ivCheck(p.iv); }
    if (!Object.keys(p).length) fail("单位补丁为空");
    numeric.forEach(k => { if (own(p, k)) number(p[k], k, 0, Number.MAX_SAFE_INTEGER, ["ap", "apMax", "bonus", "bonusMax"].includes(k)); });
    flags.forEach(k => { if (own(p, k)) bool(p[k], k); });
    if (own(p, "stun") && own(p, "stunned") && p.stun !== p.stunned) fail("失衡字段冲突");
    if (own(p, "level")) level(p.level);
    if (own(p, "zone")) zone(p.zone);
    if (own(p, "self")) one(p.self, ["none", "burn", "frost", "splash", "conductor", "anchor", "store", "doppler"], "自身状态");
    if (own(p, "layers")) {
      if (!Array.isArray(p.layers) || p.layers.length !== (u.layers || []).length) fail("层数必须与单位一致");
      p.layers.forEach(l => {
        keys(l, ["current", "max", "type"], "血量层"); if (!Object.keys(l).length) fail("血量层为空");
        if (own(l, "type")) one(l.type, Object.keys(LAYER), "血量层类型");
        Object.keys(l).filter(k => k !== "type").forEach(k => number(l[k], "血量层 " + k));
      });
    }
    if (own(p, "hp") && own(p, "layers")) fail("hp 与 layers 不能同时提交");
    if (own(p, "statuses")) {
      keys(p.statuses, STATUS_NUM.concat(STATUS_BOOL, ["latestElement"]), "状态");
      Object.entries(p.statuses).forEach(([k, v]) => {
        if (k === "latestElement") { if (v !== null) one(v, Object.keys(ELE), "最近元素"); }
        else if (STATUS_BOOL.includes(k)) { if (typeof v !== "boolean") number(v, k); }
        else number(v, k);
      });
    }
  }
  function patchProp(p) {
    keys(p, ["zone", "level", "faction", "link", "hp", "maxHp", "movable"], "配置物补丁");
    if (!Object.keys(p).length) fail("配置物补丁为空");
    if (own(p, "zone")) zone(p.zone);
    if (own(p, "level")) level(p.level);
    if (own(p, "faction")) one(p.faction, ["player", "enemy", "neutral"], "阵营");
    if (own(p, "link")) gapKeyCheck(p.link);
    ["hp", "maxHp"].forEach(k => { if (own(p, k)) number(p[k], k); });
    if (own(p, "movable")) bool(p.movable, "可移动");
  }
  function patchGap(p) {
    keys(p, ["type", "hp", "maxHp", "open", "level", "lastFrom"], "间隔补丁");
    if (!Object.keys(p).length) fail("间隔补丁为空");
    if (own(p, "type")) one(p.type, ["open", "bridge", "wall", "door", "void"], "间隔类型");
    ["hp", "maxHp"].forEach(k => { if (own(p, k)) number(p[k], k); });
    if (own(p, "open")) bool(p.open, "机关门开关");
    if (own(p, "level")) level(p.level);
    if (own(p, "lastFrom") && p.lastFrom !== null) zone(p.lastFrom);
  }
  function patchField(p) {
    // innate：固有场地（app.js · markInnateEnvironment，技能改不掉）。不在 emptyField 里，单独放行（以前主持人开战后没法设 / 取消）
    const template = emptyField(); keys(p, Object.keys(template).concat(["innate"]), "场地补丁");
    if (own(p, "innate")) bool(p.innate, "固有场地");
    if (!Object.keys(p).length) fail("场地补丁为空");
    Object.entries(p).forEach(([k, v]) => {
      if (k === "innate") return;
      if (k === "fieldLock") { if (v !== null && (typeof v !== "string" || v.length > 100)) fail("场地锁定标记非法"); }
      else if (typeof template[k] === "boolean") bool(v, k);
      else number(v, k, k === "collapseLv" ? 1 : 0);
    });
    if (FIELD_EFFECT_KEYS.filter(k => p[k] === true).length > 1) fail("同一区不能设置多个主场地效果");
    if (p.fire > 0 && FIELD_EFFECT_KEYS.some(k => k !== "fireOn" && p[k] === true)) fail("火场层数与其他主场地效果冲突");
    if (p.fire > 0 && p.fireOn === false) fail("火场层数与开关冲突");
  }
  function readOnly(fn) {
    const old = Object.getOwnPropertyDescriptors(state), draft = copy(state);
    try { Object.keys(state).forEach(k => delete state[k]); Object.assign(state, draft); return fn(); }
    finally { Object.keys(state).forEach(k => delete state[k]); Object.defineProperties(state, old); }
  }
  function checkMove(a, dest, extraAp = 0) {
    zone(dest);
    if (!zonesAdjacent(dest, a.zone)) fail("一次只能移动一格（只能走到相连的区）");
    if (a.noMove || a.self === "frost" || (typeof isCrushing === "function" && isCrushing(a)) || (typeof touDuelVictim === "function" && touDuelVictim(a))) fail("这个单位现在不能移动");
    const f = (state.fields || {})[a.zone] || {};
    if (f.abyss && !a.flying) fail("地面单位不能从深渊移动");
    const why = zoneReachable(a, dest, true); if (why) fail(why);
    let ap = 0, bonus = 0;
    if (f.acid && !a.flying) ap = 1;
    // 狂暴（effects.js）：这回合还有免费移动就不花附赠 / 行动点，和 app.js · doMoveInner 一样
    else if (a.self !== "conductor" && !(typeof frenzyFreeMoveReady === "function" && frenzyFreeMoveReady(a))) { if (enemyRankOf(a) === "minion") ap = 1; else bonus = 1; }
    const gap = (state.gaps || {})[gapKey(a.zone, dest)];
    if (gap && gap.type === "void" && !a.flying) { ap = 1; bonus = 0; }   // 越过空隙这一步花 1 行动点（不花附赠），另掷运动检定
    if ((a.ap || 0) < ap + extraAp || (a.bonus || 0) < bonus) fail("移动所需行动预算不足");
  }
  function checkFlow(a, cmd) {
    const picks = cmd.picks || {}; object(picks, "分步选择");
    const accepted = {}, done = new Set(); let last = null;
    for (let i = 0; i < 16; i++) {
      const step = skillFlowSteps(cmd.skill, a, accepted).find(s => !done.has(s.key)); if (!step) break;
      done.add(step.key); const value = picks[step.key];
      if (value == null) { if (!step.optional) fail("缺少分步选择：" + step.label); accepted[step.key] = null; continue; }
      const valid = step.type === "zone" ? Number.isInteger(value) && step.zones.includes(value)
        : step.type === "unit" ? typeof value === "string" && step.units.some(u => u.id === value && present(u))
        : (step.options || []).some(o => o.value === value);
      if (!valid) fail("非法分步选择：" + step.label);
      accepted[step.key] = value; if (step.type === "unit") last = value;
    }
    if (Object.keys(picks).some(k => !done.has(k))) fail("未知分步选择");
    if (last && cmd.target !== last) fail("主目标与分步选择不一致");
    return !!last;
  }
  function checkEnemyAct(cmd) {
    const a = enemy(cmd.actor);
    if (!state.combatStarted || state.combatPhase !== "enemy") fail("还没有到敌人回合");
    if (!isManual(a)) fail("这个敌人未开启手动控制");
    if (!enemyMayAct(a)) fail("新生成的敌人需等下个敌人回合");
    if (a.stunned || (typeof isEffectivelyStunned === "function" && isEffectivelyStunned(a))) fail("失衡敌人不能行动");
    if (a.dying) fail("濒死敌人不能行动");
    if (!enemySkillList(a).length) fail("这个敌人现在不能行动");
    one(cmd.action, ["move", "skill"], "敌人动作");
    if (cmd.action === "move") {
      if (own(cmd, "skill") || own(cmd, "target") || own(cmd, "picks")) fail("移动不能夹带技能参数");
      checkMove(a, cmd.dest); return;
    }
    if (own(cmd, "dest")) fail("技能位置请使用分步选择");
    const sk = enemySkillList(a).find(s => s.id === cmd.skill);
    if (!sk || /协助|借机/.test(sk.label) || /_assist$|_opp$|_block$/.test(cmd.skill)) fail("这个敌人没有这项主动技能");
    // 技能花费：默认 1 行动点；赤牙的霰弹枪 / 掩体 2 行动点，追猎 1 附赠（enemies.js · enemySkillCost）
    const cost = typeof enemySkillCost === "function" ? enemySkillCost(a, cmd.skill) : { ap: 1, bonus: 0 };
    if ((a.ap || 0) < cost.ap) fail("行动点不足");
    if ((a.bonus || 0) < cost.bonus) fail("附赠行动不足");
    if (cmd.skill === "en_chi_shot" && !(a.resources && a.resources.primed)) fail("霰弹枪尚未预热");
    const t = cmd.target == null ? null : unit(cmd.target);
    if (t && !present(t)) fail("目标不在场");
    const flowTarget = checkFlow(a, cmd);
    if (!NO_TARGET.has(cmd.skill) && !t) fail("技能需要目标");
    if (!t) return;
    if (cmd.skill === "en_thug_mutiny") { if (t.kit !== "bandit_boss") fail("反水只能攻击强盗头子"); return; }
    if (!t.isPlayer) fail("敌人主动技能需要玩家目标");
    if (flowTarget) return;
    if (cmd.skill === "en_approach" || cmd.skill === "en_flee") {
      if ((cmd.skill === "en_flee") !== (Number(a.zone) === Number(t.zone))) fail("当前距离不允许这个移动技能");
      const path = zonePath(a.zone, t.zone);
      const dest = cmd.skill === "en_flee" ? otherZone(a.zone, t.zone) : (path && path.length > 1 ? path[1] : Number(a.zone) + Math.sign(Number(t.zone) - Number(a.zone)));
      checkMove(a, dest, 1); return;
    }
    if (NO_TARGET.has(cmd.skill)) fail("这个技能不接受主目标");
    const d = zoneDist(a.zone, t.zone, state.zoneMode);
    const moves = ["en_guard_sword", "en_thug_knife", "en_thug_hammer", "en_wolf"].includes(cmd.skill) || (cmd.skill === "en_sand_aa" && a.kit === "sand_beast");
    let effectiveDistance = d;
    if (moves && d > 0) { if (d !== 1) fail("目标超出进攻移动距离"); checkMove(a, Number(t.zone), 1); effectiveDistance = 0; }
    const range = ENEMY_SKILL_RANGE[cmd.skill] || a.range || "any";
    if ((range === "melee" && effectiveDistance !== 0) || (range === "ranged" && effectiveDistance !== 1) || (range === "any" && effectiveDistance > 1)) fail("目标超出技能射程");
    const duel = typeof touDuelVictim === "function" && touDuelVictim(a);
    if (duel && t.id !== duel.id) fail("决一死战只能攻击灯");
  }
  function checkAttack(input) {
    keys(input, ["dmAtk", "dmTgt", "dmEle", "dmMult", "dmSplash", "dmFlat", "dmBrk", "dmSplashBrk", "dmDiceN", "dmDiceS", "dmSkipBlock", "hits"], "安排攻击");
    if (input.dmAtk != null && input.dmAtk !== "" && input.dmAtk !== "__env") unit(input.dmAtk);
    if (input.dmTgt != null && input.dmTgt !== "") { if (!present(unit(input.dmTgt))) fail("主目标不在场"); }
    if (own(input, "dmEle")) one(input.dmEle, Object.keys(ELE), "攻击元素");
    ["dmMult", "dmSplash", "dmFlat", "dmBrk", "dmSplashBrk", "dmDiceN", "dmDiceS"].forEach(k => {
      if (!own(input, k)) return;
      const v = input[k]; if (typeof v !== "number" && !(typeof v === "string" && /^\d+(\.\d+)?$/.test(v))) fail("非法攻击数值：" + k);
      number(Number(v), k, 0, k === "dmDiceN" ? 1000 : Number.MAX_SAFE_INTEGER, k === "dmDiceN" || k === "dmDiceS");
    });
    if (Number(input.dmDiceN) > 0 && !(Number(input.dmDiceS) >= 1)) fail("骰子面数必须大于零");
    if (own(input, "dmSkipBlock")) bool(input.dmSkipBlock, "跳过格挡");
    if (own(input, "hits") && !Array.isArray(input.hits)) fail("波及目标必须是数组");
    const hits = input.hits || []; if (new Set(hits).size !== hits.length) fail("波及目标重复");
    hits.forEach(id => { if (!present(unit(id))) fail("波及目标不在场"); });
    if (!hits.length && !input.dmTgt) fail("安排攻击需要目标");
  }
  function validate(cmd, context) {
    requireHost(context); cmd = Commands.validate(cmd);
    if (!TYPES.includes(cmd.type)) fail("未知主持人指令");
    if (own(cmd, "silent")) bool(cmd.silent, "静默");
    const fields = {
      spawnEnemy: ["enemyId", "level", "zone", "count", "iv", "race", "enriched"], removeUnit: ["actor", "mode"], editUnit: ["actor", "patch"], copyUnit: ["actor"],
      addProp: ["kind", "zone", "level", "faction", "link"], editProp: ["id", "patch"], removeProp: ["id", "mode"],
      editGap: ["key", "patch"], setField: ["zone", "patch"], setWeather: ["weather", "sandDir", "phaseStep", "lock"],
      setEncounter: ["encounter", "zoneMode"], forceAttack: ["input"], setManual: ["actors", "enabled"],
      enemyAct: ["actor", "action", "skill", "target", "picks", "dest"], enemyEndTurn: []
    };
    const type = cmd.type.slice(3); keys(cmd, ["type", "silent"].concat(fields[type]), "主持人指令");
    switch (type) {
      case "spawnEnemy":
        if (!enemyPresets().some(p => p.id === cmd.enemyId && p.id !== "blank_pc")) fail("未知敌人种类");
        level(cmd.level); zone(cmd.zone); if (own(cmd, "count")) number(cmd.count, "生成数量", 1, 100, true); if (own(cmd, "iv")) ivCheck(cmd.iv);
        if (own(cmd, "race") && cmd.race !== null && cmd.race !== "") raceCheck(cmd.race);
        // 富集与否（沙鱼，desert.js）：true / false；不写 = 开战时照常随机
        if (own(cmd, "enriched")) { bool(cmd.enriched, "富集"); if (typeof SAND_FISH_KITS === "undefined" || !SAND_FISH_KITS.includes(cmd.enemyId)) fail("只有沙鱼能设富集"); } break;
      case "removeUnit": enemy(cmd.actor); one(cmd.mode, ["remove", "kill"], "移出模式"); break;
      case "editUnit": patchUnit(unit(cmd.actor), cmd.patch); break;
      case "copyUnit": { const u = enemy(cmd.actor); if (/^ufo_/.test(u.kit || "") || u.linkedIds) fail("多部件的敌人不能复制"); break; }
      case "addProp": one(cmd.kind, PROP_KINDS, "配置物种类"); zone(cmd.zone); if (own(cmd, "level")) level(cmd.level); if (own(cmd, "faction")) one(cmd.faction, ["player", "enemy", "neutral"], "阵营"); if (own(cmd, "link")) gapKeyCheck(cmd.link); break;
      case "editProp": prop(cmd.id); patchProp(cmd.patch); break;
      case "removeProp": prop(cmd.id); one(cmd.mode, ["remove", "destroy"], "移除模式"); break;
      case "editGap": gapKeyCheck(cmd.key); patchGap(cmd.patch); break;
      case "setField": zone(cmd.zone); patchField(cmd.patch); break;
      case "setWeather":
        if (!["weather", "sandDir", "phaseStep", "lock"].some(k => own(cmd, k))) fail("天气补丁为空");
        if (own(cmd, "weather")) one(cmd.weather, WEATHERS, "天气"); if (own(cmd, "sandDir")) one(cmd.sandDir, ["12", "21", "E", "W", "S", "N"], "沙暴风向");
        if (own(cmd, "phaseStep")) number(cmd.phaseStep, "相位阶段", 0, 3, true); if (own(cmd, "lock")) bool(cmd.lock, "天气锁定"); break;
      case "setEncounter":
        if (state.combatStarted) fail("遭遇和区数只能在开战前修改");
        if (!own(cmd, "zoneMode") && !own(cmd, "encounter")) fail("遭遇配置为空");
        if (own(cmd, "zoneMode")) one(cmd.zoneMode, [2, 3], "区数");
        if (own(cmd, "encounter")) { if (typeof cmd.encounter !== "string" || !encounterById(cmd.encounter)) fail("未知遭遇编号"); if (typeof adapter.setEncounter !== "function") fail("房间尚未接入遭遇配置"); }
        break;
      case "forceAttack": checkAttack(cmd.input); break;
      case "setManual":
        bool(cmd.enabled, "手动开关");
        if (cmd.actors !== "all") { if (!Array.isArray(cmd.actors) || !cmd.actors.length || new Set(cmd.actors).size !== cmd.actors.length) fail("手动敌人列表非法"); cmd.actors.forEach(id => enemy(id)); } break;
      case "enemyAct": readOnly(() => checkEnemyAct(cmd)); break;
      case "enemyEndTurn": if (!state.combatStarted || state.combatPhase !== "enemy") fail("还没有到敌人回合"); if (typeof adapter.enemyEndTurn !== "function") fail("房间尚未接入敌人回合协调"); break;
    }
    return true;
  }
  function kill(u, notes) { (u.layers || []).forEach(l => { l.current = 0; }); settleEnemyKill(u, notes); notes.push(...sweepDeadEnemies()); }
  function edit(u, p, notes) {
    // 个体值：按波动之前的数值重算血量上限和 atk（先做，后面同一次补丁里写的具体数值照样生效）
    if (own(p, "iv")) {
      const cur = u.iv || { hp: 0, atk: 0 }, pick = k => (p.iv[k] === null || p.iv[k] === undefined ? cur[k] : p.iv[k]);
      setEnemyIV(u, { hp: pick("hp"), atk: pick("atk") });
    }
    // 种族：按原始数值重算六维（先减掉旧种族加的、再加新的），个体值跟着重算
    if (own(p, "race")) setEnemyRace(u, p.race);
    if (own(p, "level")) { u.level = p.level; if (typeof applyLevelStats === "function") applyLevelStats(u); }
    // 富集与否（desert.js）：装甲层 ×1.5 / 除回去，名字加 / 去「富集」；定了以后开战不再随机
    if (own(p, "enriched") && typeof desertSetEnriched === "function") desertSetEnriched(u, p.enriched);
    if (p.dead === false) { dmRevive(u); u._removed = false; }
    ["shpMax", "defMax", "apMax", "bonusMax", "atk", "zone", "self", "highEnergy", "flying", "dying", "dead"].forEach(k => { if (own(p, k)) u[k] = p[k]; });
    // Combat reads personalAtk plus the currently held weapon, not the legacy
    // cached atk field. A GM's ATK edit changes that base, keeping weapon rules.
    if (own(p, "atk")) u.personalAtk = p.atk;
    if (own(p, "name")) u.name = p.name.trim();
    // 加 / 删血量层：和单机一样（新层是 10/10 的肉体层）
    if (own(p, "addLayer")) u.layers.push({ type: "flesh", current: 10, max: 10 });
    if (own(p, "removeLayer")) u.layers.splice(p.removeLayer, 1);
    if (own(p, "instant")) { u.instant = Object.assign({}, u.instant, p.instant); }
    if (own(p, "atkFx")) {
      u.resources = u.resources || {};
      let cur = hungAtkFx(u);
      Object.entries(p.atkFx).forEach(([k, on]) => { if (on && !cur.includes(k)) cur.push(k); if (!on) cur = cur.filter(x => x !== k); });
      u.resources.nextAtkFx = cur;
    }
    if (p.layers) p.layers.forEach((l, i) => { if (own(l, "type")) u.layers[i].type = l.type; });
    if (p.layers) p.layers.forEach((l, i) => dmApplyLayer(u, i, own(l, "current") ? l.current : Math.min(u.layers[i].current, own(l, "max") ? l.max : u.layers[i].max), own(l, "max") ? l.max : null));
    // hp is an explicit shorthand for the innermost layer; layers edits every layer.
    if (own(p, "hp") && u.layers.length) dmApplyLayer(u, u.layers.length - 1, p.hp, null);
    ["shp", "def", "ap", "bonus"].forEach(k => {
      const maxKey = k + "Max";
      if (own(p, k) || own(p, maxKey)) u[k] = Math.min(own(p, k) ? p[k] : Math.max(0, Number(u[k]) || 0), Math.max(0, Number(u[maxKey]) || 0));
    });
    if (own(p, "self")) u.selfBurnStacks = p.self === "burn" ? Math.max(1, Number(u.selfBurnStacks) || 1) : 0;   // 同单机的「自我效果」
    if (own(p, "self") && typeof syncFrenzyPosture === "function") syncFrenzyPosture(u, null);   // 改掉了狂暴：扣的架势上限还回去
    if (p.statuses) { u.statuses = Object.assign({}, u.statuses, p.statuses); if (own(p.statuses, "shockwave") && typeof syncShockwave === "function") syncShockwave(u, null); }
    if (own(p, "neutralize")) notes.push(...applyNeutralize(u));
    const stun = own(p, "stunned") ? p.stunned : p.stun;
    if (stun === true) dmForceStun(u); else if (stun === false) { u.stunned = false; u._imbalanceLock = false; }
    if (!u.isPlayer && (u.dead || isInnerDepleted(u))) kill(u, notes);
    notes.push("修改 " + u.name + "：" + JSON.stringify(p));
  }
  function execute(input, context) {
    validate(input, context); const cmd = Commands.validate(input), type = cmd.type.slice(3);
    const notes = []; let publicSummary = "主持人：调整了战场数据。", result = {};
    const captured = withLogSink(() => {
      switch (type) {
        case "spawnEnemy": {
          const ids = [], eligible = state.combatStarted ? (Number(state.turnNo) || 1) + (state.combatPhase === "enemy" ? 1 : 0) : 1;
          for (let i = 0; i < (cmd.count || 1); i++) {
            const pack = spawnEnemyGroup(cmd.enemyId, cmd.level, Number(state.partySize) || 2, cmd.zone, cmd.iv, cmd.race);
            if (own(cmd, "enriched") && typeof desertSetEnriched === "function") pack.forEach(u => desertSetEnriched(u, cmd.enriched));
            pack.forEach(u => { state.units.push(u); metadata.set(u.id, { eligibleEnemyRound: eligible }); ids.push(u.id); });
          }
          result = { ids, eligibleEnemyRound: eligible };
          publicSummary = `主持人：在 ${cmd.zone} 区加入 ${enemyPresets().find(p => p.id === cmd.enemyId).name || cmd.enemyId} Lv${cmd.level} ×${cmd.count || 1}。`; break;
        }
        case "removeUnit": {
          const u = enemy(cmd.actor); publicSummary = `主持人：${cmd.mode === "kill" ? "击杀" : "移出"} ${u.name}。`;
          if (cmd.mode === "kill") kill(u, notes);
          else {
            const legs = u.kit === "ufo_body" && typeof ufoAllLegs === "function" ? ufoAllLegs(u) : [];
            const ids = new Set([u.id].concat(legs.map(x => x.id)));
            state.units = state.units.filter(x => !ids.has(x.id)); ids.forEach(id => metadata.delete(id));
            ["selectedId", "attackerId", "targetId"].forEach(k => { if (ids.has(state[k])) state[k] = null; });
          }
          break;
        }
        case "editUnit": { const u = unit(cmd.actor); edit(u, cmd.patch, notes); publicSummary = `主持人：调整了 ${u.name} 的数据。`; break; }
        case "copyUnit": {
          // 和单机的「复制单位」一样：原样复制一份，名字加「 复制」；新单位从下一个允许的敌方回合起行动（同生成敌人）
          const u = enemy(cmd.actor), made = copy(u);
          made.id = uid(); made.name = u.name + " 复制"; state.units.push(made);
          metadata.set(made.id, { eligibleEnemyRound: state.combatStarted ? (Number(state.turnNo) || 1) + (state.combatPhase === "enemy" ? 1 : 0) : 1 });
          result = { id: made.id }; publicSummary = `主持人：复制了 ${u.name}。`; break;
        }
        case "addProp": {
          const p = makeProp(cmd.kind, cmd.zone, cmd.level || 1); if (cmd.faction) p.faction = cmd.faction; if (cmd.link) p.link = cmd.link;
          state.props.push(p); if (p.kind === "battery") syncBatteryShields(); result.id = p.id; publicSummary = `主持人：在 ${p.zone} 区加入 ${p.name}。`; break;
        }
        case "editProp": { const p = prop(cmd.id); Object.assign(p, cmd.patch); p.hp = Math.min(p.hp, p.maxHp); if (p.kind === "battery") syncBatteryShields(); publicSummary = `主持人：调整了 ${p.name}。`; break; }
        case "removeProp": {
          const p = prop(cmd.id); publicSummary = `主持人：${cmd.mode === "destroy" ? "摧毁" : "移除"} ${p.name}。`;
          if (cmd.mode === "destroy") { p.hp = 0; notes.push(...(destroyProp(p, null) || [])); notes.push(...sweepDeadEnemies()); }
          else { state.props = state.props.filter(x => x.id !== p.id); if (p.kind === "battery") syncBatteryShields(); }
          break;
        }
        case "editGap": {
          const g = state.gaps[cmd.key] || emptyGap(); Object.assign(g, cmd.patch);
          g.hp = Math.min(g.hp, g.maxHp); state.gaps[cmd.key] = g; publicSummary = `主持人：调整了 ${cmd.key} 区间地形。`; break;
        }
        case "setField": {
          const f = state.fields[cmd.zone] || emptyField(), p = cmd.patch;
          if (FIELD_EFFECT_KEYS.some(k => p[k] === true) || p.fire > 0) clearFieldEffects(f);
          Object.assign(f, p); if (p.fire > 0) f.fireOn = true; if (f.fireOn && !f.fire) f.fire = 1;
          if (!f.fireOn) f.fire = 0; f.ruinHp = Math.min(f.ruinHp, f.ruinMax);
          // 固有场地只对有主场地的区有意义：清掉主场地时一起取消
          if (!(f.fireOn || FIELD_EFFECT_KEYS.some(k => k !== "fireOn" && f[k]))) f.innate = false;
          state.fields[cmd.zone] = f; publicSummary = `主持人：调整了 ${cmd.zone} 区场地。`; break;
        }
        case "setWeather":
          if (own(cmd, "weather")) setWeather(cmd.weather, { force: true });
          if (own(cmd, "sandDir")) state.sandDir = cmd.sandDir;
          if (own(cmd, "phaseStep")) state.phaseStep = cmd.phaseStep;
          if (own(cmd, "lock")) state.weatherLock = cmd.lock ? "主持人" : null;
          publicSummary = "主持人：调整了天气。"; break;
        case "setEncounter":
          if (own(cmd, "encounter")) adapter.setEncounter(cmd, context);
          if (own(cmd, "zoneMode")) { state.zoneMode = cmd.zoneMode; state.board = null; state.units.forEach(u => { u.zone = Math.min(Number(u.zone), cmd.zoneMode); }); state.props.forEach(p => { p.zone = Math.min(Number(p.zone), cmd.zoneMode); }); }
          publicSummary = "主持人：配置了战前遭遇。"; break;
        case "forceAttack": dmDealAttack(cmd.input); notes.push(...sweepDeadEnemies()); publicSummary = "主持人：安排了一次攻击。"; break;
        case "setManual":
          if (cmd.actors === "all") { manualAll = cmd.enabled; metadata.forEach(m => { delete m.manual; }); }
          else cmd.actors.forEach(id => metadata.set(id, Object.assign({}, metadata.get(id) || { eligibleEnemyRound: 0 }, { manual: cmd.enabled })));
          publicSummary = `主持人：${cmd.enabled ? "开启" : "关闭"}敌人手动控制。`; break;
        case "enemyAct":
          BattleCommands.execute({ type: cmd.action === "move" ? "move" : "skill", actor: cmd.actor, ...(cmd.action === "move" ? { dest: cmd.dest } : { skill: cmd.skill, target: cmd.target || null, picks: cmd.picks || {} }) });
          notes.push(...sweepDeadEnemies()); publicSummary = `主持人：操控 ${unit(cmd.actor).name} 行动。`; break;
        case "enemyEndTurn": adapter.enemyEndTurn(context); publicSummary = "主持人：结束了敌人回合。"; break;
      }
    });
    notes.push(...captured);
    return Object.assign(result, { publicSummary: cmd.silent === true ? null : publicSummary, notes });
  }
  TYPES.forEach(type => Commands.register(type, execute, { domain: "gm" }));
  root.GMCommands = { configure, validate, execute, reset, beginEnemyRound, enemyMayAct, isManual, snapshot, restore, types: TYPES.slice() };
  if (typeof module !== "undefined" && module.exports) module.exports = root.GMCommands;
})(typeof globalThis !== "undefined" ? globalThis : window);
