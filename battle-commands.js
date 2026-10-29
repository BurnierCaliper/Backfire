/* Local battle commands. Data crosses this boundary; presentation stays in game.js. */
(function (root) {
  "use strict";
  let local = {};
  const types = ["skill", "move", "standUp", "useItem", "startCombat", "endTurn", "openingChoice", "blockAnswer", "assistAnswer", "koltSwapAnswer", "heluScanAnswer", "longgeSafetyAnswer", "standAnswer", "battle.standCheck", "retreat", "battle.endPlayerTurn", "battle.endEnemyTurn", "battle.enemyAction", "battle.finish", "battle.afterBattle", "battle.checkSolo", "battle.supportInfo", "battle.rememberCampaign", "battle.loadCampaign", "battle.cleanQueues", "battle.setup", "battle.setupRogue", "battle.panel", "battle.undo", "battle.continue", "battle.chain", "battle.friendlyFire", "battle.playerFaction", "battle.duel"];
  const panelActions = ["bagAdd", "currency", "water", "healItem", "repair", "advance", "shortRest", "longRest", "restore", "cheat", "saveSlot", "loadSlot", "clearSlot", "addParty", "removeParty", "addEnemy", "removeEnemy", "setField", "ruinHp", "setGap", "gapHp", "rollWall", "toggleDoor", "addProp", "removeProp", "setZones", "setPartySize", "setWeather", "setRegion", "setScene", "setLight", "rollEncounter", "rollBossEncounter", "selectEncounter", "normalizeBag", "normalizeGaps", "normalizeField", "setHighland", "setExecution", "setShare", "setSpread", "setTower", "setDrops"];
  function configure(adapter) { local = Object.assign({}, local, adapter || {}); }
  function environment(context) { return Object.assign({}, local, context || {}); }
  // Rogue's legacy encounter rows explicitly contain level: undefined when they
  // inherit the encounter level. Omit only that documented optional field.
  // Preserve descriptors/prototypes so the strict boundary still rejects other
  // functions, accessors and non-data objects instead of silently cleaning them.
  function battleSpecData(spec) {
    const copy = value => Object.create(Object.getPrototypeOf(value), Object.getOwnPropertyDescriptors(value));
    const data = copy(spec);
    delete data.before;
    const enc = data.encounter;
    if (enc && typeof enc === "object" && Array.isArray(enc.enemies)) {
      data.encounter = copy(enc);
      data.encounter.enemies = enc.enemies.map(row => {
        if (!row || typeof row !== "object") return row;
        const level = Object.getOwnPropertyDescriptor(row, "level");
        if (!level || level.get || level.set || level.value !== undefined) return row;
        const next = copy(row);
        delete next.level;
        return next;
      });
    }
    return data;
  }
  function seeded(key, fn) {
    if (key == null || typeof makeRng !== "function") return fn();
    const random = Math.random;
    Math.random = makeRng(key);
    try { return fn(); } finally { Math.random = random; }
  }
  function actor(id) {
    const u = unitById(id);
    if (!u) throw new Error("Unknown battle actor: " + id);
    return u;
  }
  /** 首领机制：挂上时带上主持人填的技能名（去掉首尾空格；空着就不带，用机制原名 BOSS_MECH_DEFAULTS，boss-mechanics.js） */
  function named(m, c) {
    const name = typeof c.name === "string" ? c.name.trim() : "";
    if (name) m.name = name;
    return m;
  }
  /** 这个敌人身上这种机制现在叫什么（填过的技能名 / 机制原名）：去掉之前先记下来写提示 */
  function mechLabel(u, type) { return mechConfig(bossMechList(u, type)[0] || { type }).name; }
  /** 玩家阵营指令（PvP 第一步，enemies.js · setPlayerFaction，#445）的字段：
   *  reset 只能单独给 true；其余都要有 faction（阵营 id）。id / 名字是去掉首尾空格、不带「|」的非空字符串（字数见 PVP_CFG），
   *  要能原样发给玩家（online-view.js · safeText 不整段丢掉）；phase 只收 "player" / "enemy"；remove 只能和 faction 一起给 true；
   *  unit 是场上的玩家角色或护送对象（武器人跟着持有者，不能单独分）；other（另一个玩家阵营）和 enemy（图鉴里的敌人阵营名）一次只给一个，
   *  这时 hostile 只收 true（敌对）/ false（友好）/ null（回到默认） */
  function playerFactionCheck(c) {
    const C = root.PVP_CFG || (typeof PVP_CFG !== "undefined" ? PVP_CFG : { idMax: 16, nameMax: 16, enemyMax: 24, phases: ["player", "enemy"] });
    const known = ["type", "reset", "faction", "name", "phase", "remove", "unit", "other", "enemy", "hostile"];
    Object.keys(c).forEach(k => { if (!known.includes(k)) throw new Error("Unknown player faction field: " + k); });
    const has = k => Object.prototype.hasOwnProperty.call(c, k);
    if (has("reset")) {
      if (c.reset !== true) throw new Error("player faction reset must be true");
      if (Object.keys(c).some(k => k !== "type" && k !== "reset")) throw new Error("player faction reset takes no other fields");
      return;
    }
    const label = (v, field, max) => {
      if (typeof v !== "string" || !v || v !== v.trim() || v.includes("|") || Array.from(v).length > max || ["__proto__", "prototype", "constructor"].includes(v))
        throw new Error("player faction " + field + " must be a nonempty trimmed string without | (at most " + max + " characters)");
      if (root.OnlineView && typeof root.OnlineView.safeText === "function" && root.OnlineView.safeText(v) === null) throw new Error("player faction " + field + " can't be shown to players: " + v);
    };
    label(c.faction, "id", C.idMax);
    if (has("name")) label(c.name, "name", C.nameMax);
    if (has("phase") && !C.phases.includes(c.phase)) throw new Error("Unknown player faction phase: " + c.phase);
    if (has("remove")) {
      if (c.remove !== true) throw new Error("player faction remove must be true");
      if (Object.keys(c).some(k => !["type", "faction", "remove"].includes(k))) throw new Error("player faction remove takes no other fields");
    }
    if (has("unit")) {
      const u = actor(c.unit);
      if (!u.isPlayer || (typeof isWeaponUnit === "function" && isWeaponUnit(u) && !u.escort)) throw new Error("player faction unit must be a player character (weapon units follow their holder)");
    }
    if (has("other") && has("enemy")) throw new Error("player faction relation: give other or enemy, not both");
    if (has("other")) { label(c.other, "other", C.idMax); if (c.other === c.faction) throw new Error("player faction other must be a different faction"); }
    if (has("enemy")) {
      label(c.enemy, "enemy", C.enemyMax);
      const info = typeof ENEMY_INFO !== "undefined" ? ENEMY_INFO : null;
      if (info && !Object.keys(info).some(k => info[k] && info[k].faction === c.enemy)) throw new Error("Unknown enemy faction: " + c.enemy);
    }
    const rel = has("other") || has("enemy");
    if (rel && !(c.hostile === true || c.hostile === false || c.hostile === null)) throw new Error("player faction hostile must be true, false or null");
    if (!rel && has("hostile")) throw new Error("player faction hostile needs other or enemy");
  }
  /** 决斗指令（PvP 第三步，enemies.js · pvpDuelSetup，#472）的字段：teams 只有「1队」「2队」两个键，各是不重复的单位 id 数组
   *  （人数、是不是场上的角色由 pvpDuelSetup 再查）；stand 允许起身（布尔，可不给 = 默认允许）；rounds 回合上限（null / 不给 = 不限，
   *  否则 1 到 PVP_DUEL_CFG.roundsMax 的整数） */
  function duelCheck(c) {
    const C = root.PVP_DUEL_CFG || (typeof PVP_DUEL_CFG !== "undefined" ? PVP_DUEL_CFG : { teams: [{ id: "1队" }, { id: "2队" }], roundsMax: 99 });
    const known = ["type", "teams", "stand", "rounds"];
    Object.keys(c).forEach(k => { if (!known.includes(k)) throw new Error("Unknown duel field: " + k); });
    const ids = C.teams.map(t => t.id);
    if (!c.teams || typeof c.teams !== "object" || Array.isArray(c.teams)) throw new Error("duel teams must be an object");
    Object.keys(c.teams).forEach(k => { if (!ids.includes(k)) throw new Error("Unknown duel team: " + k); });
    ids.forEach(k => {
      const list = c.teams[k];
      if (!Array.isArray(list) || list.some(id => typeof id !== "string" || !id)) throw new Error("duel team " + k + " must be a list of unit ids");
      if (new Set(list).size !== list.length) throw new Error("duel team " + k + " has duplicates");
    });
    if (c.stand != null && typeof c.stand !== "boolean") throw new Error("duel stand must be a boolean");
    if (c.rounds != null && !(Number.isInteger(c.rounds) && c.rounds >= 1 && c.rounds <= C.roundsMax)) throw new Error("duel rounds must be 1-" + C.roundsMax);
  }
  function validate(cmd) {
    if (types.indexOf(cmd.type) < 0) throw new Error("Unknown battle command: " + cmd.type);
    if (["skill", "move", "standUp", "useItem", "openingChoice", "battle.enemyAction"].includes(cmd.type)) actor(cmd.actor);
    if (cmd.type === "skill" && typeof cmd.skill !== "string") throw new Error("skill must be a string");
    if (cmd.type === "move" && !Number.isFinite(cmd.dest)) throw new Error("dest must be a number");
    // 起身时顺便免费翻滚到的相邻区（#470）：不给 / null = 原地起身
    if (cmd.type === "standUp" && cmd.dest != null && !Number.isInteger(cmd.dest)) throw new Error("standUp dest must be a zone number");
    // 全员倒地、回合结束前问「要不要起身」的回答（#470）：actor 是被问的人，stand 起不起身，dest 顺便翻滚到的相邻区
    if (cmd.type === "standAnswer") {
      if (typeof cmd.actor !== "string" || !cmd.actor) throw new Error("standAnswer actor must be a unit id");
      if (typeof cmd.stand !== "boolean") throw new Error("standAnswer stand must be a boolean");
      if (cmd.dest != null && !Number.isInteger(cmd.dest)) throw new Error("standAnswer dest must be a zone number");
    }
    if (cmd.type === "battle.panel" && panelActions.indexOf(cmd.action) < 0) throw new Error("Unknown battle panel action: " + cmd.action);
    const oneOf = (value, values, field) => { if (!values.includes(value)) throw new Error("Unknown " + field + ": " + value); };
    // 首领机制的技能名（选填）：字符串，去掉首尾空格后最多 BOSS_MECH_NAME_MAX 个字（boss-mechanics.js）；空着 = 用机制原名。
    // 联机时玩家收到的要和主持人填的一样：玩家数据的白名单（online-view.js · safeText）会整段丢掉的字样不收
    const mechName = (c, kind) => {
      if (c.name == null) return;
      if (typeof c.name !== "string") throw new Error(kind + " name must be a string");
      const name = c.name.trim();
      if (Array.from(name).length > BOSS_MECH_NAME_MAX) throw new Error(kind + " name must be at most " + BOSS_MECH_NAME_MAX + " characters");
      if (name && root.OnlineView && typeof root.OnlineView.safeText === "function" && root.OnlineView.safeText(name) === null) throw new Error(kind + " name can't be shown to players: " + name);
    };
    if (cmd.type === "openingChoice" && cmd.mood == null) oneOf(cmd.bit, ["acid", "drill"], "opening bit");
    if (cmd.type === "openingChoice" && cmd.mood != null) oneOf(cmd.mood, ["gentle", "cruel"], "opening mood");
    if (cmd.type === "battle.cleanQueues") oneOf(cmd.queue, ["block", "assist", "kolt", "helu", "longge", "stand"], "reaction queue");
    // 友伤开关（enemies.js · FRIENDLY_FIRE，#428）：on 开 / 关；owner = 改谁的开关（热座 / 联机由 hotseat-game.js 按发指令的人填，本机不填）
    if (cmd.type === "battle.friendlyFire") {
      if (typeof cmd.on !== "boolean") throw new Error("friendly fire on must be a boolean");
      if (cmd.owner != null && (typeof cmd.owner !== "string" || !cmd.owner)) throw new Error("friendly fire owner must be a nonempty string");
    }
    if (cmd.type === "battle.playerFaction") playerFactionCheck(cmd);
    if (cmd.type === "battle.duel") duelCheck(cmd);
    if (cmd.type === "heluScanAnswer" && cmd.picks != null && (typeof cmd.picks !== "object" || Array.isArray(cmd.picks))) throw new Error("picks must be an object");
    if (cmd.type === "battle.panel") {
      if (cmd.action === "setField") oneOf(cmd.kind, ["", "fireOn", "ice", "acid", "electric", "energy", "harmonic", "heal", "abyss", "highland", "collapseOn", "ruinOn", "isolate"], "field kind");
      if (cmd.action === "setGap") oneOf(cmd.kind, ["open", "bridge", "wall", "door", "void"], "gap kind");
      if (["setGap", "gapHp", "rollWall", "toggleDoor"].includes(cmd.action)) oneOf(cmd.key, ["1-2", "2-3"], "gap key");
      if (cmd.action === "setWeather") oneOf(cmd.value, ["none", "heat", "snow", "acid", "thunder", "glow", "sand", "phase"], "weather");
      // 所在区域 / 场景 / 光影（只是画面）："" = 跟着地图 / 默认 / 跟着时钟；区域只认 world-data.js 的 BATTLE_REGIONS，
      // 场景只认当前区域的（world-data.js · BATTLE_SCENES），光影只认 daylight.js 的三个值
      if (cmd.action === "setRegion") oneOf(cmd.value, [""].concat(typeof BATTLE_REGIONS !== "undefined" ? BATTLE_REGIONS : []), "battle region");
      if (cmd.action === "setScene") oneOf(cmd.value, [""].concat(typeof battleScenes === "function" ? battleScenes(state.region).map(s => s.id) : []), "battle scene");
      if (cmd.action === "setLight") oneOf(cmd.value, [""].concat(typeof DayLight !== "undefined" ? DayLight.LIGHTS : []), "battle light");
      if (cmd.action === "setZones") oneOf(cmd.value, [2, 3].concat(typeof BOARD_LAYOUTS !== "undefined" ? Object.keys(BOARD_LAYOUTS) : []), "zone count");
      if (cmd.action === "setPartySize") oneOf(cmd.value, [2, 3, 4], "party size");
      if (["setField", "ruinHp", "setHighland", "addProp", "addParty", "addEnemy"].includes(cmd.action)) oneOf(cmd.zone, [1, 2, 3], "zone");
      if (cmd.action === "addProp") {
        oneOf(cmd.kind, ["button", "lever", "battery", "boom", "acid", "scrap", "turret"], "prop kind");
        oneOf(cmd.faction, ["player", "enemy"], "prop faction");
      }
      if (cmd.action === "setExecution" && cmd.cfg != null) {
        const c = cmd.cfg;
        if (typeof c !== "object" || Array.isArray(c)) throw new Error("execution cfg must be an object");
        oneOf(c.phase, ["enemy", "player"], "execution phase");
        oneOf(c.then, ["repeat", "once"], "execution then");
        if (!Number.isInteger(c.turns) || c.turns < 1 || c.turns > 20) throw new Error("execution turns must be 1-20");
        if (!Array.isArray(c.hits) || !c.hits.length || c.hits.length > 10 || !c.hits.every(h => h && isFinite(Number(h.mult)) && Number(h.mult) > 0 && Number(h.mult) <= 20)) throw new Error("execution hits must be 1-10 multipliers");
        mechName(c, "execution");
      }
      if (cmd.action === "setShare" && cmd.cfg != null) {
        const c = cmd.cfg;
        if (typeof c !== "object" || Array.isArray(c)) throw new Error("share cfg must be an object");
        oneOf(c.phase, ["enemy", "player"], "share phase");
        oneOf(c.then, ["repeat", "once"], "share then");
        if (!Number.isInteger(c.turns) || c.turns < 1 || c.turns > 20) throw new Error("share turns must be 1-20");
        if (!isFinite(Number(c.mult)) || Number(c.mult) <= 0 || Number(c.mult) > 50) throw new Error("share pool multiplier must be 0-50");
        if (c.element != null) oneOf(c.element, ["physical", "fire", "ice", "electric", "acid", "energy", "harmonic"], "share element");
        mechName(c, "share");
      }
      if (cmd.action === "setSpread" && cmd.cfg != null) {
        const c = cmd.cfg;
        if (typeof c !== "object" || Array.isArray(c)) throw new Error("spread cfg must be an object");
        oneOf(c.phase, ["enemy", "player"], "spread phase");
        oneOf(c.then, ["repeat", "once"], "spread then");
        if (!Number.isInteger(c.turns) || c.turns < 1 || c.turns > 20) throw new Error("spread turns must be 1-20");
        if (!isFinite(Number(c.mult)) || Number(c.mult) <= 0 || Number(c.mult) > 20) throw new Error("spread blast multiplier must be 0-20");
        mechName(c, "spread");
      }
      if (cmd.action === "setTower" && cmd.cfg != null) {
        const c = cmd.cfg;
        if (typeof c !== "object" || Array.isArray(c)) throw new Error("tower cfg must be an object");
        oneOf(c.phase, ["enemy", "player"], "tower phase");
        oneOf(c.then, ["repeat", "once"], "tower then");
        if (!Number.isInteger(c.turns) || c.turns < 1 || c.turns > 20) throw new Error("tower turns must be 1-20");
        if (!Number.isInteger(c.count) || c.count < 1 || c.count > 5) throw new Error("tower count must be 1-5");
        if (!Number.isInteger(c.need) || c.need < 1 || c.need > 4) throw new Error("tower need must be 1-4");
        if (!isFinite(Number(c.soak)) || Number(c.soak) < 0 || Number(c.soak) > 20) throw new Error("tower soak multiplier must be 0-20");
        if (!isFinite(Number(c.fail)) || Number(c.fail) <= 0 || Number(c.fail) > 50) throw new Error("tower fail multiplier must be 0-50");
        mechName(c, "tower");
      }
      if (["bagAdd", "healItem"].includes(cmd.action) && !Object.prototype.hasOwnProperty.call(ITEM_CATALOG, cmd.item)) throw new Error("Unknown item: " + cmd.item);
    }
  }
  function skill(cmd) {
    const a = actor(cmd.actor);
    state.attackerId = cmd.actor;
    state.selectedId = cmd.actor;
    state.targetId = cmd.target || null;
    if (cmd.type === "move") return doMove(a, cmd.dest);
    if (cmd.type === "standUp") return standUp(a, cmd.dest == null ? null : cmd.dest);   // dest：起身并免费翻滚到相邻区（#470）
    if (cmd.type === "useItem") {
      // 开着友伤把对敌人用的道具用在队友身上（items.js · itemFriendlyFire，#432）：不计分数——超频针翻倍护盾这类让队友血量变多的也不算治疗
      const ff = typeof itemFriendlyFire === "function" && itemFriendlyFire(a, cmd.item, unitById(cmd.target));
      const taunt = typeof playerTauntTarget === "function" ? playerTauntTarget(a) : null;   // 嘲讽对玩家（#464）：对嘲讽者用了道具也算出过手
      const notes = typeof trackHealBy === "function" && !ff
        ? trackHealBy(a, () => useItemOn(a, cmd.item, unitById(cmd.target), cmd.dest))
        : useItemOn(a, cmd.item, unitById(cmd.target), cmd.dest);
      (notes || []).forEach(s => appendLog(s));
      if (taunt && cmd.target === taunt.id && !(notes && notes.unused)) playerTauntDone(a, taunt);
      if (!a.dying && !(notes && notes.unused) && (a.bonus || 0) > 0) { a.bonus -= 1; if (typeof scoreSpend === "function") scoreSpend(a, 0, 1); }   // 濒死时用不了道具、道具没用出去（射程不够等），不扣附赠
      return;
    }
    if (cmd.picks && Object.keys(cmd.picks).length) state.skillFlow = { id: cmd.skill, actorId: cmd.actor, picks: Object.assign({}, cmd.picks), index: 99 };
    try { return runSkill(cmd.skill); } finally { state.skillFlow = null; }
  }
  function setup(cmd, env) {
    const g = env.game || root.GAME || {};
    let enc = typeof cmd.encounter === "string" ? (typeof encounterById === "function" ? encounterById(cmd.encounter) : null) : cmd.encounter || null;
    if (enc) { enc = JSON.parse(JSON.stringify(enc)); if (typeof applyEncounterLayout === "function") applyEncounterLayout(enc); }
    g.encounter = enc;
    if (enc) g.lastEncounter = enc;
    g.level = cmd.level;
    state.units = []; state.props = [];
    state.fields = { 1: emptyField(), 2: emptyField(), 3: emptyField() };
    state.gaps = { "1-2": emptyGap(), "2-3": emptyGap() };
    state.zoneMode = Number(g.zoneMode) || 2;
    state.board = null;
    state.partySize = 2;
    state.weather = g.weather || "none"; state.weatherBy = null;
    if (typeof rollSandDir === "function") rollSandDir();
    state.weatherLock = null; state.phaseStep = 0; state.assistQueue = []; state.blockQueue = []; state.standQueue = [];
    state.skillFlow = null; state.history = []; state.actionAcc = null; state.statusDmg = {};
    state.turnNo = 1; state.logPages = [{ turn: 1, lines: [] }]; state.logIndex = 0;
    state.combatPhase = "player"; state.combatStarted = false; state.exhaustTier = 0;
    state.openingBreaks = null; state.solo = null; state.scoreAct = null; state.ambush = false; state.playerAllies = [];
    state.retreated = false; state.lootByRank = null; state.lootByKit = null;
    resetBattleRecords();
    g.undo = [];
    state.xpMult = Number(cmd.xpMult) || 1;
    if (g.board) applyBoard(g.board);   // 特殊棋盘（战场配置里选的布局）
    loadLiveParty(g.partyKits);
    placePartyOnBoard();
    if (enc && enc.playerZone) state.units.forEach(u => { if (u.isPlayer && !u.hidden) u.zone = Number(enc.playerZone); });
    if (typeof randomizeNoraMood === "function") randomizeNoraMood();
    if (env.applyCampaignToField) env.applyCampaignToField();
    // 客制化图纸：跑团按队伍里装的图纸重算；其他模式（战斗原型）没有图纸
    if (typeof TRPG !== "undefined" && TRPG.active && typeof trpgSyncWeaponMods === "function") trpgSyncWeaponMods();
    else { state.weaponMods = null; state.weaponBlueprints = null; }
    // 跑团任务战斗：护送对象跟着上场（trpg-tasks.js）
    if (typeof TRPG !== "undefined" && TRPG.active && typeof trpgSpawnTaskEscort === "function") trpgSpawnTaskEscort();
    state.units.forEach(u => { if (typeof resetBattleFlags === "function") resetBattleFlags(u); });
    const notes = [];
    if (typeof ledgerApplyToField === "function") ledgerApplyToField(notes);
    if (typeof TRPG !== "undefined" && TRPG.active && typeof exhaustTier === "function") state.exhaustTier = Math.min(3, exhaustTier());
    const partyN = typeof syncPartySizeFromField === "function" ? syncPartySizeFromField() : liveHeroCount();
    if (typeof RUN !== "undefined" && RUN.active) RUN.apply();
    // 战斗掉落：遭遇（战斗模板）里带的；没有就清空，主持人可以在战场配置里再设
    state.battleDrops = enc && enc.drops && typeof normalizeBattleDrops === "function" ? normalizeBattleDrops(enc.drops) : null;
    // 援军、连续战斗（chain.js）
    if (typeof Chain !== "undefined") Chain.clear();
    if (enc && typeof buildEncounter === "function") { buildEncounter(enc, cmd.level, partyN); if (typeof Chain !== "undefined") Chain.init(enc, cmd.level, partyN); }
    else {
      const presets = enemyPresets();
      const plan = g.enemyPlan && g.enemyPlan.length ? g.enemyPlan : [{ id: "thug_knife", lv: cmd.level, zone: 2 }, { id: "thug_hammer", lv: cmd.level, zone: 2 }, { id: "bandit_boss", lv: cmd.level, zone: 2 }];
      plan.forEach(row => {
        const pack = typeof spawnEnemyGroup === "function" ? spawnEnemyGroup(row.id, Number(row.lv) || cmd.level, partyN, row.zone, null, row.race) : null;
        // 任务节点里主持人定的富集与否（沙鱼，desert.js）
        if (pack && typeof row.enriched === "boolean" && typeof desertSetEnriched === "function") pack.forEach(u => desertSetEnriched(u, row.enriched));
        if (pack && pack.length) { pack.forEach(u => state.units.push(u)); return; }
        const p = presets.find(x => x.id === row.id);
        if (!p || !p.build) return;
        const u = p.build(Number(row.lv) || cmd.level, partyN);
        if (typeof applyEnemyIV === "function") applyEnemyIV(u, null, row.race);
        u.zone = Math.min(Number(state.zoneMode), Number(row.zone) || Number(state.zoneMode)); state.units.push(u);
      });
    }
    // 所在区域、光影（只是画面）：遭遇的 region / 跑团队伍在地图上的地点；光影跟着时钟（world-data.js · battleLookStart）
    if (typeof battleLookStart === "function") battleLookStart({ region: enc && enc.region });
    return { encounter: enc, partySize: partyN, notes };
  }
  function panel(cmd, env) {
    const g = env.game || root.GAME || {};
    const notes = [];
    let value;
    switch (cmd.action) {
      case "normalizeBag": ensureBag(); break;
      case "normalizeGaps": state.gaps = state.gaps || {}; boardLinks().map(([a, b]) => gapKey(a, b)).forEach(k => { if (!state.gaps[k]) state.gaps[k] = emptyGap(); }); break;
      case "normalizeField": panel({ action: "normalizeGaps" }, env); (state.units || []).forEach(u => { if (Number(u.zone) > Number(state.zoneMode)) u.zone = Number(state.zoneMode); }); break;
      case "bagAdd": bagAdd(cmd.item, cmd.amount); notes.push(`背包：${ITEM_CATALOG[cmd.item].name} ${cmd.amount < 0 ? "−" : "+"}${Math.abs(cmd.amount)}`); break;
      case "currency": state.kuizhi = Math.max(0, (Number(state.kuizhi) || 0) + cmd.amount); notes.push(`背包：奎支 ${cmd.amount < 0 ? "−" : "+"}${Math.abs(cmd.amount)} → ${state.kuizhi}`); break;
      case "water": setLedgerWater(ledgerWater() + cmd.amount); notes.push(`背包：水 ${cmd.amount < 0 ? "−" : "+"}${Math.abs(cmd.amount)} ml → ${ledgerWater()} ml`); break;
      case "healItem": return { notes: ledgerHealItem(cmd.item, cmd.kit, []) };
      case "repair": return { notes: ledgerRepair(cmd.kit, []) };
      case "advance": ledgerAdvance(cmd.hours, notes); notes.unshift(`时间推进 ${cmd.hours} 小时。`); break;
      case "shortRest": return { notes: ledgerShortRest(cmd.kits || null, []) };
      case "longRest": return ledgerLongRest(cmd.plan, []);
      case "restore": return { notes: ledgerRestoreAll([]) };
      case "cheat": return { notes: cheatFillBag() };
      case "saveSlot": return env.writeSlot(cmd.index);
      case "loadSlot": return env.loadSlot(cmd.index, cmd.level);
      case "clearSlot": return env.clearSlot(cmd.index);
      case "addParty": {
        const card = livePartyCards().find(c => c.kit === cmd.kit); if (!card) break;
        const u = spawnLiveCard(card, Number(cmd.zone) || 1);
        u.weaponHeld = true; u.atk = (u.personalAtk || 0) + (u.weaponAtk || 0);
        if (typeof resetBattleFlags === "function") resetBattleFlags(u);
        if (typeof applyLevelStats === "function") applyLevelStats(u);
        state.units.push(u);
        g.partyKits = g.partyKits || []; if (g.partyKits.indexOf(cmd.kit) < 0) g.partyKits.push(cmd.kit);
        if (state.combatStarted && state.combatPhase === "player") { u.ap = u.apMax || 1; u.bonus = u.bonusMax || 1; }
        value = u.id; break;
      }
      case "removeParty": { const u = actor(cmd.actor); state.units = state.units.filter(x => x.id !== u.id && x.weaponOf !== u.kit); g.partyKits = (g.partyKits || []).filter(k => k !== u.kit); break; }
      case "removeEnemy": { const u = actor(cmd.actor); state.units = state.units.filter(x => x.id !== u.id && x.ufoParent !== u.id); g.enemyPlan = (g.enemyPlan || []).filter(p => !(p.id === u.kit && Number(p.zone) === Number(u.zone))); break; }
      case "addEnemy": {
        const p = enemyPresets().find(x => x.id === cmd.preset); if (!p) break;
        const partyN = typeof syncPartySizeFromField === "function" ? syncPartySizeFromField() : liveHeroCount();
        const pack = typeof spawnEnemyGroup === "function" ? spawnEnemyGroup(cmd.preset, cmd.level, partyN, cmd.zone, cmd.iv, cmd.race) : null;
        if (pack && pack.length) pack.forEach(u => state.units.push(u));
        else { const u = p.build(cmd.level, partyN); u.zone = Math.min(cmd.zone, Number(state.zoneMode)); state.units.push(u); if (typeof refreshEnemyEconomy === "function") refreshEnemyEconomy(u); }
        g.enemyPlan = (g.enemyPlan || []).concat([{ id: cmd.preset, lv: cmd.level, zone: cmd.zone }]); break;
      }
      case "setField": {
        // 高地和其他区域效果共存：换场地时保留高地；选「高地」只是加上高地
        const old = state.fields[cmd.zone] || emptyField();
        if (cmd.kind === "highland") { old.highland = true; state.fields[cmd.zone] = old; break; }
        const f = emptyField(); if (cmd.kind) f[cmd.kind] = true; if (cmd.kind === "fireOn") f.fire = 1;
        f.highland = !!old.highland; state.fields[cmd.zone] = f; break;
      }
      case "ruinHp": { const f = state.fields[cmd.zone] || emptyField(); f.ruinHp = f.ruinMax = Math.max(1, Math.floor(Number(cmd.hp) || 1)); state.fields[cmd.zone] = f; break; }   // 损毁地面的耐久
      case "setHighland": { const f = state.fields[cmd.zone] || emptyField(); f.highland = !!cmd.value; state.fields[cmd.zone] = f; break; }
      case "setGap": { const gap = state.gaps[cmd.key]; gap.type = cmd.kind; if (["bridge", "wall"].includes(gap.type)) { gap.hp = defaultGapHp(gap.type); gap.maxHp = gap.hp; gap.level = Number(g.level) || 1; } if (gap.type === "door") gap.open = false; if (gap.type === "open") { gap.hp = 0; gap.open = true; } break; }
      case "gapHp": state.gaps[cmd.key].hp = state.gaps[cmd.key].maxHp = Math.max(1, Math.floor(Number(cmd.hp) || 1)); break;
      case "rollWall": state.gaps[cmd.key].hp = state.gaps[cmd.key].maxHp = rollWallHp(); break;
      case "toggleDoor": state.gaps[cmd.key].open = !state.gaps[cmd.key].open; break;
      case "addProp": { const p = makeProp(cmd.kind, cmd.zone, cmd.level); p.faction = cmd.faction || "player"; state.props = state.props || []; state.props.push(p); if (cmd.kind === "battery" && typeof syncBatteryShields === "function") syncBatteryShields(); value = p.id; break; }
      case "setExecution": {
        // 首领机制·死刑（boss-mechanics.js）：给敌人挂上 / 去掉。cfg = null 去掉；cfg.name 技能名（选填，不填叫「死刑」）
        const u = actor(cmd.actor);
        const was = mechLabel(u, "execution");
        removeBossMechanics(u, "execution");
        if (cmd.cfg) {
          const c = cmd.cfg;
          const m = addBossMechanic(u, named({ type: "execution", phase: c.phase, turns: c.turns, then: c.then, hits: c.hits.map(h => ({ mult: Number(h.mult), element: h.element || undefined })) }, c));
          bossMechSync(notes);
          notes.unshift(`${u.name} 加上「${mechConfig(m).name}」：标记后 ${c.turns} 回合、${c.phase === "player" ? "我方" : "敌人"}回合开始时落下，${c.hits.length} 段（× ${c.hits.map(h => h.mult).join(" / ")} atk），${c.then === "repeat" ? "落下后重新标记" : "只放一次"}。`);
        } else notes.push(`${u.name} 去掉了「${was}」。`);
        break;
      }
      case "setShare": {
        // 首领机制·分担（boss-mechanics.js）：给敌人挂上 / 去掉。cfg = null 去掉；cfg.name 技能名（选填，不填叫「分担」）
        const u = actor(cmd.actor);
        const was = mechLabel(u, "share");
        removeBossMechanics(u, "share");
        if (cmd.cfg) {
          const c = cmd.cfg;
          const m = addBossMechanic(u, named({ type: "share", phase: c.phase, turns: c.turns, then: c.then, pool: { mult: Number(c.mult) }, element: c.element || null }, c));
          bossMechSync(notes);
          notes.unshift(`${u.name} 加上「${mechConfig(m).name}」：随机标记一人，${c.turns} 回合后${c.phase === "player" ? "我方" : "敌人"}回合开始时落下，伤害池 ${c.mult} × atk 由他所在区的友方平均分担，${c.then === "repeat" ? "落下后重新标记" : "只放一次"}。`);
        } else notes.push(`${u.name} 去掉了「${was}」。`);
        break;
      }
      case "setSpread": {
        // 首领机制·远离（boss-mechanics.js）：给敌人挂上 / 去掉。cfg = null 去掉；cfg.name 技能名（选填，不填叫「远离」）
        const u = actor(cmd.actor);
        const was = mechLabel(u, "spread");
        removeBossMechanics(u, "spread");
        if (cmd.cfg) {
          const c = cmd.cfg;
          const m = addBossMechanic(u, named({ type: "spread", phase: c.phase, turns: c.turns, then: c.then, blast: { mult: Number(c.mult) } }, c));
          bossMechSync(notes);
          notes.unshift(`${u.name} 加上「${mechConfig(m).name}」：标记我方全员，${c.turns} 回合后${c.phase === "player" ? "我方" : "敌人"}回合开始时每人在自己的区爆炸一次（每次对同区每个友方 ${c.mult} × atk），${c.then === "repeat" ? "落下后重新标记" : "只放一次"}。`);
        } else notes.push(`${u.name} 去掉了「${was}」。`);
        break;
      }
      case "setTower": {
        // 首领机制·踩塔（boss-mechanics.js）：给敌人挂上 / 去掉。cfg = null 去掉；cfg.name 技能名（选填，不填叫「踩塔」）
        const u = actor(cmd.actor);
        const was = mechLabel(u, "tower");
        removeBossMechanics(u, "tower");
        if (cmd.cfg) {
          const c = cmd.cfg;
          const m = addBossMechanic(u, named({ type: "tower", phase: c.phase, turns: c.turns, then: c.then, count: c.count, need: c.need, soak: { mult: Number(c.soak) }, fail: { kind: "raid", mult: Number(c.fail) } }, c));
          bossMechSync(notes);
          notes.unshift(`${u.name} 加上「${mechConfig(m).name}」：随机标记 ${c.count} 个区，${c.turns} 回合后${c.phase === "player" ? "我方" : "敌人"}回合开始时落下，每座塔至少 ${c.need} 人踩住（每人挨 ${c.soak} × atk），没人踩则全员各挨 ${c.fail} × atk，${c.then === "repeat" ? "落下后重新标记" : "只放一次"}。`);
        } else notes.push(`${u.name} 去掉了「${was}」。`);
        break;
      }
      case "removeProp": state.props = state.props.filter(x => x.id !== cmd.id); break;
      case "setZones": {
        // 数字 = 普通两区 / 三区直排；布局名（line4 / square4 / cross5 …）= 特殊棋盘
        if (typeof cmd.value === "string" && typeof BOARD_LAYOUTS !== "undefined" && BOARD_LAYOUTS[cmd.value] && !/^line[23]$/.test(cmd.value)) {
          g.board = cmd.value; applyBoard(cmd.value); g.zoneMode = state.zoneMode;
        } else { g.board = null; state.board = null; g.zoneMode = state.zoneMode = Number(cmd.value) || (cmd.value === "line3" ? 3 : 2); }
        panel({ action: "normalizeField" }, env); break;
      }
      case "setPartySize": g.partySize = state.partySize = Number(cmd.value) || 2; break;
      case "setWeather": { const was = state.weather; state.weather = cmd.value || "none"; state.weatherBy = null; if (cmd.persist) g.weather = state.weather; if (state.weather === "sand" && was !== "sand" && typeof rollSandDir === "function") rollSandDir(); break; }
      // 所在区域 / 场景 / 光影：只是画面的标签，不改结算（规则的白天 / 夜晚照旧跟着时钟）。只管这一场，下一场开战回到跟着地图 / 默认 / 时钟
      case "setRegion": value = battleLookSet({ region: cmd.value }); break;
      case "setScene": value = battleLookSet({ scene: cmd.value }); break;
      case "setLight": value = battleLookSet({ light: cmd.value }); break;
      case "rollEncounter": value = rollEncounter({ region: cmd.region, ...(cmd.faction ? { faction: cmd.faction } : {}) }); break;
      case "rollBossEncounter": { const bosses = Object.keys(ENEMY_INFO || {}).filter(k => ENEMY_INFO[k].boss && ENEMY_INFO[k].regions.indexOf(cmd.region) >= 0); if (bosses.length) value = rollBossEncounter(bosses[Math.floor(Math.random() * bosses.length)], { region: cmd.region }); break; }
      case "selectEncounter": g.lastEncounter = cmd.encounter; value = cmd.encounter; break;
      case "setDrops": state.battleDrops = typeof normalizeBattleDrops === "function" ? normalizeBattleDrops(cmd.drops) : null; value = state.battleDrops; break;
    }
    return value === undefined ? { notes } : { notes, value };
  }
  function execute(cmd, context) {
    validate(cmd);
    const env = environment(context);
    switch (cmd.type) {
      case "skill": case "move": case "standUp": case "useItem": return skill(cmd);
      case "startCombat": return startCombat();
      case "openingChoice": {
        const u = actor(cmd.actor); u.resources = u.resources || {};
        if (cmd.mood) { if (typeof setMood === "function") setMood(u, cmd.mood, null); else u.resources.mood = cmd.mood; return u.resources.mood; }   // 双相冲动+：自选初始状态
        u.resources.bit = cmd.bit === "acid" ? "acid" : "drill"; return u.resources.bit;
      }
      case "blockAnswer": return seeded(cmd.seed, () => finishBlock(cmd.helper || null, cmd.forced || null));
      // 按协助的人在哪个回合行动（enemies.js · unitTurnPhase，#445：在敌人回合行动的玩家阵营算敌人回合）
      case "assistAnswer": { const helper = unitById(cmd.helper); const prev = state.combatPhase; if (helper) state.combatPhase = typeof unitTurnPhase === "function" ? unitTurnPhase(helper) : (helper.isPlayer ? "player" : "enemy"); try { return finishAssist(cmd.helper || null, cmd.extra || {}); } finally { state.combatPhase = prev; } }
      case "koltSwapAnswer": return resolveKoltSwap(!!cmd.swap, cmd.target || null);
      case "heluScanAnswer": return resolveHeluScan(cmd.picks || null);
      case "longgeSafetyAnswer": return resolveLonggeSafety(!!cmd.front);
      // 全员倒地还能起身（#470，app.js · queueWipeStand / answerWipeStand）：回合结束前（battle.endEnemyTurn 之前）排上要问的人，一个一个回答
      case "battle.standCheck": return queueWipeStand();
      case "standAnswer": return answerWipeStand(cmd.actor, cmd.stand, cmd.dest == null ? null : cmd.dest);
      case "retreat": {
        // 这场不许撤退（单局首领战 spec.retreat === false）：指令层也拒绝，不只靠界面把按钮变灰
        const g = env.game || root.GAME || {};
        if (g.rogue && g.rogue.spec && g.rogue.spec.retreat === false) throw new Error("这场战斗不能撤退");
        if (typeof pvpDuelOn === "function" && pvpDuelOn()) throw new Error("决斗不能撤退");   // 决斗（#472）打到分出胜负，主持人可以直接回到探索环节放弃
        return performRetreat(cmd.rearguard || null);
      }
      case "endTurn": if (env.endUnit) return env.endUnit(cmd);
      case "battle.endPlayerTurn": return seeded(cmd.seed, () => endPlayerTurn());
      case "battle.endEnemyTurn": return endEnemyTurn();
      case "battle.enemyAction": { const plan = EnemyAI.planFor(actor(cmd.actor), cmd.step); if (!plan) return { executed: false }; seeded(cmd.seed, plan.thunk); return { executed: true, meta: plan.meta }; }
      case "battle.finish": return settleBattleRewards(cmd.outcome);
      case "battle.afterBattle": return typeof ledgerAfterBattle === "function" ? ledgerAfterBattle([]) : [];
      case "battle.checkSolo": return typeof soloDownCheck === "function" ? soloDownCheck([]) : [];
      case "battle.supportInfo": return typeof soloSupportInfo === "function" ? soloSupportInfo() : null;
      case "battle.rememberCampaign": return env.rememberCampaign ? env.rememberCampaign() : null;
      case "battle.loadCampaign": return env.loadCampaignMem ? env.loadCampaignMem() : null;
      case "battle.cleanQueues": {
        if (cmd.queue === "assist") return pruneAssistQueue();
        if (cmd.queue === "stand") return pruneWipeStand();   // 已经不用问的人（自己起来了、被移出……）去掉
        const queue = cmd.queue === "block" ? state.blockQueue : cmd.queue === "helu" ? state.heluScanQueue : cmd.queue === "longge" ? state.longgeSafetyQueue : state.koltSwapQueue;
        if (queue && queue.length) queue.shift();
        return;
      }
      case "battle.setup": return setup(cmd, env);
      case "battle.setupRogue": { const spec = Object.assign({}, cmd.spec); if (env.before) spec.before = env.before; BattleSim.setup(spec); return; }
      case "battle.panel": return panel(cmd, env);
      case "battle.undo": return env.undo ? env.undo() : false;
      case "battle.continue": return env.continueBattle ? env.continueBattle(cmd.outcome) : false;
      // 敌人打完：还有援军 / 下一场就不结束（chain.js）
      case "battle.chain": { const notes = []; const goOn = typeof Chain !== "undefined" ? Chain.onCleared(notes) : false; notes.forEach(t => appendLog(t)); return { continued: goOn, notes }; }
      // 友伤开关：只改这一个人的，改了立刻生效（下一次选目标、出手就按新的算）
      case "battle.friendlyFire": {
        const owner = cmd.owner == null ? null : cmd.owner;
        const on = setFriendlyFire(owner, cmd.on);
        return { owner: owner == null ? FRIENDLY_FIRE.localOwner : owner, on };
      }
      // 玩家阵营（PvP 第一步，enemies.js · setPlayerFaction，#445）：把玩家角色分到不同的阵营、定在哪个回合行动、和其他阵营是敌是友；改了立刻生效
      case "battle.playerFaction": return { factions: setPlayerFaction(cmd) };
      // 决斗（PvP 第三步，enemies.js · pvpDuelSetup，#472）：布好战场之后、开战之前，把选好的两队摆成两个互相敌对的玩家阵营
      case "battle.duel": return { duel: pvpDuelSetup(cmd) };
    }
  }
  root.BattleCommands = { execute, configure, battleSpecData, types: types.slice(), panelActions: panelActions.slice() };
  if (root.Commands) types.forEach(type => root.Commands.register(type, execute, { domain: "battle", validate }));
})(typeof window !== "undefined" ? window : globalThis);
