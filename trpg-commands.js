/* D1: existing TRPG and calculator operations as data commands.
 * Inputs are captured by UI adapters before dispatch. No DOM input is read here.
 * Rules and save formats remain in their original modules. */
"use strict";
const TrpgCommands = (() => {
  const handlers = {
    giveXp: c => trpgGiveXp(c.kits, c.amount),
    spendAttr: c => trpgSpendAttr(c.kit, c.attr),
    pickFeat: c => trpgPickFeat(c.kit, c.feat, c.full),
    passHours: c => trpgPassHours(c.hours),
    passMinutes: c => trpgPassMinutes(c.minutes),
    passUntil: c => trpgPassUntil(c.time),
    shortRest: c => trpgShortRest(c.kits),
    longRest: c => trpgLongRest(c.plan),
    campOpen: c => trpgCampOpen(c.plan),
    campClose: () => trpgCampClose(),
    restore: () => ledgerRestoreAll([]),
    buy: c => trpgBuy(c.key, c.qty, c.free),
    adjustKuizhi: c => trpgAdjustKuizhi(c.amount, c.why),
    purseTransfer: c => trpgPurseTransfer(c.from, c.to, c.amount),
    purseSplit: c => { const n = c.amount == null ? trpgPurse("party") : Math.min(trpgPurse("party"), Math.floor(Number(c.amount) || 0)); if (n <= 0) return ["队伍公账没有钱可分。"]; trpgPurseSet("party", trpgPurse("party") - n); return trpgPurseSplit(n, null, "公账分给大家"); },
    adjustWater: c => trpgAdjustWater(c.amount),
    adjustItem: c => trpgAdjustItem(c.item, c.amount),
    heal: c => trpgUseHeal(c.item, c.kit),
    repair: c => trpgRepair(c.kit),
    upgradeWeapon: c => trpgUpgradeWeapon(c.owner, c.kit, c.mode, c.fee),
    installPart: c => trpgInstallPart(c.owner, c.kit, c.slot, c.part, !!c.free),
    removePart: c => trpgRemovePart(c.owner, c.kit, c.slot),
    randomPart: c => trpgRandomPart(c.grade),
    teachRecipe: c => trpgTeachRecipe(c.item, c.on),
    adjustPoints: c => trpgAdjustPoints(c.amount, c.why),
    redeem: c => trpgRedeem(c.item),
    craft: c => trpgCraft({ kit: c.kit, item: c.item, diff: c.diff, helper: c.helper, result: c.result }),
    salvage: c => trpgSalvage(c.item),
    taskCreate: c => trpgTaskCreate(c.kind, c.category),
    taskSave: c => trpgTaskSave(c.task),
    taskDelete: c => trpgTaskDelete(c.id),
    taskStatus: c => trpgTaskSetStatus(c.id, c.status),
    taskAccept: c => trpgTaskAccept(c.id),
    taskNodeDone: c => trpgTaskNodeDone(c.id),
    taskRollback: c => trpgTaskRollback(c.id),
    taskReveal: c => trpgTaskReveal(c.id, c.node, !!c.hidden),
    taskMove: c => trpgTaskMove(c.id, Number(c.dir) || 1),
    taskComplete: c => trpgTaskComplete(c.id),
    taskFail: c => trpgTaskFail(c.id, c.why),
    installBlueprint: c => trpgInstallBlueprint(c.owner, c.kit, c.blueprint, c.fee, !!c.free),
    removeBlueprint: c => trpgRemoveBlueprint(c.owner, c.kit),
    backstage: c => trpgBackstageApply(c.edit, c.why),
    xpMultiplier: c => { state.xpMult = Number(c.value) || 1; },
    setPlace: c => trpgSetPlace(c.place || null, c.x, c.y),
    writeSlot: c => trpgWriteSlot(c.index, c.slot),
    clearSlot: c => trpgClearSlot(c.index)
  };
  // 花钱的操作可以指定由谁付（payer：角色 kit；不写 / "party" = 队伍公账）
  const PAYABLE = new Set(["buy", "repair", "upgradeWeapon", "installPart", "installBlueprint", "craft", "redeem", "teachRecipe"]);
  function execute(c) {
    if (!Object.hasOwn(handlers, c.action)) throw new Error("Unknown TRPG action: " + c.action);
    if (c.payer && PAYABLE.has(c.action)) return trpgPayWith(c.payer, () => handlers[c.action](c));
    return handlers[c.action](c);
  }
  Commands.register("trpg", execute, { domain: "trpg" });
  return { execute, actions: Object.keys(handlers) };
})();

const BackstageCommands = (() => {
  const fields = ["level", "xp", "attrPoints", "shp", "shpMax", "def", "defMax", "zone", "atk"];
  function execute(c) {
    if (["attack", "environment"].includes(c.action)) {
      if (!c.input || typeof c.input !== "object" || Array.isArray(c.input)) throw new Error("Backstage attack requires explicit input");
      return c.action === "attack" ? dmDealAttack(c.input) : dmDealEnv(c.input);
    }
    if (c.action === "grantXp") return grantXpToPlayers(Number(c.amount) || 0, "后台发放");
    if (c.action === "durability") {
      const before = weaponDur(c.kit);
      LEDGER.dur[c.kit] = Math.max(0, Math.min(weaponDurMax(c.kit), Math.floor(Number(c.value) || 0)));
      const owner = weaponOwner(c.kit);
      if (owner && LEDGER.dur[c.kit] > 0 && owner.weaponHeld === false && !owner.dead) owner.weaponHeld = true;
      appendLog(`后台：${weaponCardName(c.kit)} 耐久 ${before} → ${LEDGER.dur[c.kit]}。`);
      return;
    }
    if (c.action === "passive" || c.action === "focus") {
      const u = unitById(c.actor);
      if (!u) throw new Error("Unknown unit: " + c.actor);
      appendLog(c.action === "passive"
        ? dmSetPassive(u, c.key, c.value)
        : dmSetFocus(u, c.op, c.layerType || null, Array.isArray(c.seq) ? c.seq.slice() : parseFocusSeqText(c.seq), c.step));
      return;
    }
    const actions = ["set", "weaponLevel", "attr", "recalc", "levelUp", "layer", "fillHp", "fillDef", "stun", "unstun", "knockOut", "revive"];
    if (!actions.includes(c.action)) throw new Error("Unknown backstage action: " + c.action);
    if (c.action === "set" && !fields.includes(c.field)) throw new Error("Unknown backstage field: " + c.field);
    if (c.action === "attr" && !["str", "con", "dex", "wil", "int", "sta"].includes(c.attr)) throw new Error("Unknown attribute: " + c.attr);
    const u = unitById(c.actor); if (!u) return;
    switch (c.action) {
      case "set": {
        const lvBefore = c.field === "level" && typeof LevelUp !== "undefined" ? LevelUp.snapshot(u) : null, oldLv = u.level || 1;
        u[c.field] = c.field === "level" ? Math.max(1, Number(c.value) || 1)
          : c.field === "zone" ? Math.max(1, Math.min(Number(state.zoneMode) || 3, Number(c.value) || 1))
          : Math.max(0, Number(c.value) || 0);
        if (c.field === "defMax" && (u.def || 0) > u.defMax) u.def = u.defMax;
        if (c.field === "level") { applyLevelStats(u); if (u.kit === "hiaki") refreshHiakiAtk(u); if (lvBefore && u.level > oldLv) LevelUp.note("level", u, lvBefore); }
        break;
      }
      case "weaponLevel": {
        const before = typeof LevelUp !== "undefined" ? LevelUp.snapshot(u) : null;
        const old = Number((u.weaponLevels || {})[c.kit]) || 1;
        setOwnedWeaponLevel(u, c.kit, c.value);
        if (before && (Number(u.weaponLevels[c.kit]) || 1) > old) LevelUp.note("weapon", u, before, { weapon: weaponCardName(c.kit) });
        // 跑团：武器升到 / 降到 4 级上下，装着的客制化图纸跟着生效 / 失效（武器页、耐久上限一起重算）
        if (typeof TRPG !== "undefined" && TRPG.active && typeof trpgSyncWeaponMods === "function") trpgSyncWeaponMods();
        appendLog(`${u.name} 的 ${weaponCardName(c.kit)} 设为 ${u.weaponLevels[c.kit]} 级。`);
        break;
      }
      case "attr": {
        u.attrs = u.attrs || { str: 5, con: 5, dex: 5, wil: 5, int: 5, sta: 5 };
        const next = Math.max(1, Number(c.value) || 1), prev = Number(u.attrs[c.attr]) || 5;
        if (next > prev && (u.attrPoints || 0) > 0) { u.attrPoints--; u.attrs[c.attr] = next; }
        else if (next <= prev) u.attrs[c.attr] = next;
        else appendLog(`${u.name} 没有可分配属性点。4 级、8 级、19 级各得 1 点。`);
        break;
      }
      case "recalc": applyLevelStats(u); appendLog(`${u.name} 已按规则重算 HP/ATK/DEF/SHP。`); break;
      case "levelUp": if (!tryLevelUp(u)) appendLog(`${u.name} 经验不足（${u.xp || 0}/${xpToNext(u.level)}）。`); break;
      case "layer": dmApplyLayer(u, c.index, c.current, c.max); break;
      case "fillHp": dmFillHp(u); appendLog(`${u.name} 后台满血。`); break;
      case "fillDef": dmFillDef(u); appendLog(`${u.name} 后台满架势。`); break;
      case "stun": dmForceStun(u); appendLog(`${u.name} 被后台打入失衡。`); queueAssistAttack(null, u); break;
      case "unstun": u.stunned = false; if ((u.def || 0) <= 0) u.def = u.defMax || 1; appendLog(`${u.name} 解除失衡。`); break;
      // Existing backstage knock-out deliberately does not become D3's normal-kill operation.
      case "knockOut": (u.layers || []).forEach(l => { l.current = 0; }); u.dead = true; u.dying = !!u.isPlayer; appendLog(`${u.name} 被后台击倒。`); break;
      case "revive": dmRevive(u); appendLog(`${u.name} 后台复活。`); break;
    }
  }
  Commands.register("backstage", execute, { domain: "backstage" });
  return { execute };
})();

const CalcCommands = (() => {
  const cloneData = x => JSON.parse(JSON.stringify(x));
  const render = () => { if (typeof renderAll === "function") renderAll(); };
  const byId = c => unitById(c.actor);
  const unitFields = ["name", "level", "atk", "def", "defMax", "highEnergy", "flying", "stunned"];
  const statuses = ["burn", "shock", "corr", "frostbite", "shockwave", "high", "reso", "unstable", "weak", "inspire", "hide", "advantage", "latestElement"];
  const instants = ["melt", "sting", "overload", "shift", "spread", "refract"];
  const weather = ["none", "heat", "snow", "acid", "thunder", "glow", "sand", "phase"];
  function member(value, allowed, label) { if (!allowed.includes(value)) throw new Error("Unknown " + label + ": " + value); }
  function execute(c) {
    // These values originally came from fixed select/checkbox controls. Reject
    // values the UI could never submit instead of inserting arbitrary state keys.
    if (c.action === "gap" && c.field === "type") member(c.value, ["open", "bridge", "wall", "door", "void"], "gap type");
    if (c.action === "self") member(c.value, ["none", "burn", "frost", "splash", "conductor", "anchor", "store", "doppler"], "self effect");
    if (c.action === "blade") member(c.value, ["niu", "naruto"], "blade");
    if (["unitLayer", "pcLayer"].includes(c.action) && c.op === "set" && c.field === "type") member(c.value, Object.keys(LAYER), "layer type");
    if (c.action === "status" && c.key === "latestElement") member(c.value, [null, ...Object.keys(ELE)], "element");
    if (c.action === "global") {
      const values = { zoneMode: [2, 3], partySize: [2, 3, 4], weather, weatherLock: [true, false], phaseStep: [0, 1, 2, 3], sandDir: ["12", "21"] };
      if (Object.hasOwn(values, c.field)) member(c.value, values[c.field], c.field);
    }
    if (c.action === "addProp") { member(c.kind, ["button", "lever", "battery", "boom", "acid", "scrap", "turret"], "prop kind"); member(c.faction, ["player", "enemy"], "faction"); member(c.zone, [1, 2, 3], "prop zone"); }
    if (c.action === "unitZone") member(c.dest, [1, 2, 3], "unit zone");
    const u = c.actor ? byId(c) : null;
    switch (c.action) {
      case "field": {
        const z = Number(c.zone), k = c.key, value = c.value;
        const allowed = ["fieldLock", "fire", "fireOn", "highland", "abyss", "isolate", "collapseOn", "collapse", "collapseLv", "ruinOn", "ruinHp", "ruinMax", ...FIELD_EFFECT_KEYS];
        if (!allowed.includes(k) || !state.fields[z]) throw new Error("Unknown field setting");
        if (k === "fieldLock") state.fields[z].fieldLock = value ? (state.fields[z].fieldLock || "手动锁定") : null;
        else if (k === "fire") {
          const n = Math.max(0, Number(value) || 0);
          if (n > 0) { const err = setZoneField(z, "fire", { stacks: n, innateOk: true }); if (err) appendLog(err); }
          else if (!state.fields[z].fieldLock) { state.fields[z].fire = 0; state.fields[z].fireOn = false; }
        } else if (k === "fireOn" || FIELD_EFFECT_KEYS.includes(k)) {
          if (value) { const err = setZoneField(z, k === "fireOn" ? "fire" : k, k === "fireOn" ? { stacks: state.fields[z].fire || 1, innateOk: true } : { innateOk: true }); if (err) appendLog(err); }
          else if (!state.fields[z].fieldLock) clearFieldEffects(state.fields[z]);
        } else state.fields[z][k] = value;
        if (k === "abyss" && value) { const notes = []; state.units.filter(v => Number(v.zone) === z && !v.hidden && !v.dead).forEach(v => applyAbyssFall(v, otherZone(z), notes)); if (notes.length) appendLog(notes.join("\n")); }
        renderZones(); return;
      }
      case "gap": {
        const g = state.gaps[c.key]; if (!g) return;
        if (c.field === "type") { g.type = c.value; if (["bridge", "wall"].includes(g.type) && !g.hp) g.maxHp = g.hp = defaultGapHp(g.type); if (g.type === "door") g.open = false; if (g.type === "open") { g.hp = 0; g.open = true; } render(); }
        else if (c.field === "hp") { g.hp = Number(c.value) || 0; g.maxHp = Math.max(g.maxHp || 0, g.hp); }
        else if (c.field === "open") { g.open = c.value; render(); }
        else if (c.field === "force") state.forceVoid[c.key] = c.value;
        else if (c.field === "target") { state.targetId = "gap:" + c.key; render(); appendLog(`已把间隔 ${c.key}（${gapLabel(g.type)}）设为攻击目标。`); }
        else throw new Error("Unknown gap field");
        return;
      }
      case "prop": {
        const p = (state.props || []).find(p => p.id === c.id); if (!p) return;
        if (c.op === "target") { const step = flowStep(), id = "prop:" + p.id; if (state.skillFlow && step && step.type === "unit" && (step.units || []).some(v => v.id === id)) return applyFlowPick(id); state.targetId = id; render(); }
        else if (c.op === "use") return useDevice(p);
        else if (c.op === "fire") return fireScrap(p);
        else if (c.op === "move") { const dest = c.dest; if (canCross(null, p.zone, dest, true)) { snapshot(); p.zone = dest; appendLog(`${p.name} 移到 ${dest} 区。`); render(); } }
        else if (c.op === "remove") { snapshot(); state.props = state.props.filter(v => v.id !== p.id); render(); }
        else throw new Error("Unknown prop action");
        return;
      }
      case "select": if (!["attackerId", "targetId"].includes(c.field)) throw new Error("Unknown selection"); state[c.field] = c.value || null; render(); return;
      case "clickUnit": return onUnitClick(c.actor);
      case "clearSelection": return clearUnitSelection();
      case "move": if (u) return doMove(u, c.dest); return;
      case "unitField": {
        if (!unitFields.includes(c.field)) throw new Error("Unknown unit field"); if (!u) return;
        u[c.field] = c.value;
        if (c.field === "highEnergy") { checkHighBoom(u); render(); }
        else if (["name", "def", "flying", "stunned"].includes(c.field)) { renderZones(); if (c.field === "name") renderSelects(); }
        return;
      }
      case "unitZone": if (!u) return; if (Math.abs(Number(c.dest) - Number(u.zone)) === 1) return doMove(u, Number(c.dest)); snapshot(); u.zone = Number(c.dest); paintSkillLog(`${u.name} 被直接放到 ${u.zone} 区（GM 强制换位，不走移动规则）。`); render(); return;
      case "status": if (!statuses.includes(c.key)) throw new Error("Unknown status"); if (u) { u.statuses[c.key] = c.value; if (c.key === "shockwave") syncShockwave(u, null); } return;
      case "instant": if (!instants.includes(c.key)) throw new Error("Unknown instant effect"); if (u) u.instant[c.key] = c.value; return;
      case "neutralize": if (u) { snapshot(); const notes = applyNeutralize(u); appendLog(notes.join("\n") || `${u.name} 身上没有可中和的属性状态。`); render(); } return;
      case "self": if (u) { u.self = c.value; u.selfBurnStacks = u.self === "burn" ? Math.max(1, Number(u.selfBurnStacks) || 1) : 0; renderZones(); } return;
      case "hang": if (!Object.hasOwn(ATKFX, c.key)) throw new Error("Unknown attack effect"); if (u) { u.resources = u.resources || {}; let cur = hungAtkFx(u); if (c.value && !cur.includes(c.key)) cur.push(c.key); if (!c.value) cur = cur.filter(k => k !== c.key); u.resources.nextAtkFx = cur; renderZones(); } return;
      case "unitLayer": if (!u) return; if (c.op === "add") u.layers.push({ type: "flesh", current: 10, max: 10 }); else if (c.op === "remove") u.layers.splice(c.index, 1); else if (c.op === "set" && ["type", "current", "max"].includes(c.field) && u.layers[c.index]) u.layers[c.index][c.field] = c.value; else throw new Error("Unknown layer edit"); if (c.op !== "set") drawLayers(u); renderZones(); return;
      case "removeUnit": if (u) { snapshot(); state.units = state.units.filter(v => v.id !== u.id); ["selectedId", "attackerId", "targetId"].forEach(k => { if (state[k] === u.id) state[k] = null; }); render(); } return;
      case "copyUnit": if (u) { snapshot(); const copy = cloneData(u); copy.id = uid(); copy.name = u.name + " 复制"; state.units.push(copy); render(); } return;
      case "fullDef": if (u) { u.def = u.defMax; render(); } return;
      case "rosterSaveUnit": return saveUnitToRoster(u, true);
      case "pcLayer": if (c.op === "add") state.pcLayers.push({ type: "flesh", current: 10, max: 10 }); else if (c.op === "remove") { if (state.pcLayers.length <= 1) return; state.pcLayers.splice(c.index, 1); } else if (c.op === "set" && ["type", "current", "max"].includes(c.field) && state.pcLayers[c.index]) { state.pcLayers[c.index][c.field] = c.value; if (c.field === "max" && !Number(state.pcLayers[c.index].current)) state.pcLayers[c.index].current = Number(c.value); return; } else throw new Error("Unknown form layer edit"); renderPcLayers(); return;
      case "rosterSaveForm": return saveUnitToRoster(unitFromForm(c.form), true);
      case "rosterAddForm": { snapshot(); const added = unitFromForm(c.form); state.units.push(added); state.selectedId = state.attackerId = added.id; render(); return added.name; }
      case "rosterAddKit": { const card = livePartyCards().find(v => v.kit === c.kit); if (!card) return; if (state.units.some(v => v.kit === c.kit && !v.hidden)) return { exists: card.name }; snapshot(); const added = spawnLiveCard(card, c.zone); added.weaponHeld = true; added.atk = (added.personalAtk || 0) + (added.weaponAtk || 0); state.units.push(added); state.selectedId = state.attackerId = added.id; render(); return { name: added.name }; }
      case "rosterLoad": { const card = state.roster.find(v => v.cardId === c.id); if (!card) return; snapshot(); const added = spawnFromCard(card); state.units.push(added); state.selectedId = state.attackerId = added.id; render(); return added.name; }
      case "rosterEdit": { const card = state.roster.find(v => v.cardId === c.id); if (card) { fillFormFromCard(card); return card.name; } return; }
      case "rosterDelete": { const card = state.roster.find(v => v.cardId === c.id); if (!card) return; state.roster = state.roster.filter(v => v.cardId !== c.id); persistRoster(); setRosterHint(`已删除「${card.name}」。`); return; }
      case "rosterImport": if (!Array.isArray(c.cards)) throw new Error("Invalid roster"); c.cards.forEach(original => { const card = cloneData(original); if (!card.cardId) card.cardId = "c" + Math.random().toString(36).slice(2, 9); const i = state.roster.findIndex(v => v.name === card.name); if (i >= 0) state.roster[i] = Object.assign({}, state.roster[i], card, { cardId: state.roster[i].cardId }); else state.roster.push(card); }); persistRoster(); setRosterHint(`导入完成，卡组现有 ${state.roster.length} 张。`); return;
      case "global": {
        if (!["zoneMode", "partySize", "weather", "weatherLock", "phaseStep", "sandDir"].includes(c.field)) throw new Error("Unknown calculator setting");
        if (c.field === "weather") { const err = setWeather(c.value, { innateOk: true }); if (err) { appendLog(err); return err; } }
        else if (c.field === "weatherLock") state.weatherLock = c.value ? (state.weatherLock || "手动锁定") : null;
        else state[c.field] = c.value;
        if (c.field === "zoneMode") state.board = null;   // 计算器只有两区 / 三区直排
        if (!["partySize", "phaseStep"].includes(c.field)) render(); return;
      }
      case "advancePhase": state.phaseStep = (Number(state.phaseStep) + 1) % 4; return state.phaseStep;
      case "clearField": snapshot(); state.units = []; state.props = []; state.gaps = { "1-2": emptyGap(), "2-3": emptyGap() }; state.fields = { 1: emptyField(), 2: emptyField(), 3: emptyField() }; if (state.board) applyBoard(state.board); state.forceVoid = {}; state.combatStarted = false; state.combatPhase = "player"; state.selectedId = state.attackerId = state.targetId = state.lastResult = null; state.blockQueue = []; state.assistQueue = []; appendLog("已清空战场（单位、配置物、间隔、场地）。天气和区制保留。可点撤销恢复。"); render(); return;
      case "undo": return undo();
      case "persist":
        try { localStorage.setItem("anterscale-calc", JSON.stringify({ zoneMode: state.zoneMode, partySize: state.partySize, weather: state.weather, phaseStep: state.phaseStep, sandDir: state.sandDir, units: state.units, fields: state.fields })); } catch (_) {}
        return;
      case "clearLog": return clearLogs();
      case "logPage": if (c.direction < 0 && state.logIndex > 0) state.logIndex--; if (c.direction > 0 && state.logIndex < state.logPages.length - 1) state.logIndex++; renderLog(); return;
      case "skill": state.attackerId = c.actor; state.targetId = c.target || null; if (skillFlowSteps(c.skill, u, {}).length) return beginSkillFlow(c.skill); return runSkill(c.skill);
      case "skillPick": return applyFlowPick(c.value);
      case "skillCancel": return cancelSkillFlow();
      case "standUp": if (u) return standUp(u); return;
      case "blockAnswer": return finishBlock(c.helper);
      case "assistAnswer": return finishAssist(c.helper);
      case "koltSwap": return resolveKoltSwap(c.swap, c.target);
      case "startCombat": return startCombat();
      case "endTurn": if (!state.combatStarted) return startCombat(); return state.combatPhase === "enemy" ? endEnemyTurn() : endPlayerTurn();
      case "loadLive": return loadLiveParty();
      case "blade": { const h = findKit("hiaki", state.units), want = c.value; if (h && h.resources) { if ((want === "niu" && h.resources.niuOut) || (want === "naruto" && h.resources.narutoOut)) { appendLog(`${want === "niu" ? "丹生谷" : "鳴門"} 已分出，收回前不能切换到这把刀。`); syncBladeSel(); return; } h.resources.blade = want; refreshHiakiAtk(h); render(); } return; }
      case "addProp": { snapshot(); const p = makeProp(c.kind, c.zone, c.level); p.faction = c.faction || "player"; state.props.push(p); appendLog(`在 ${c.zone} 区放置 ${p.name}（${p.faction === "enemy" ? "敌方" : "我方"}）。`); if (c.kind === "battery") syncBatteryShields().forEach(s => appendLog(s)); render(); return; }
      case "addPreset": { snapshot(); if (c.id === "ufo_boss") { syncPartySizeFromField(); const pack = spawnUfoBoss(c.level); pack.forEach(v => state.units.push(v)); state.selectedId = state.attackerId = pack[0].id; appendLog(`飞碟触灵登场（Lv${c.level}）：本体在 2 区，机械足甲乙丙在 2 区，丁戊在 1 区。本体不能被通常攻击。`); render(); return; } const p = enemyPresets().find(v => v.id === c.id); if (!p) throw new Error("Unknown enemy preset"); const added = p.build(c.level, syncPartySizeFromField()); if (typeof applyEnemyIV === "function") applyEnemyIV(added, c.iv); added.zone = enemySpawnZone(); state.units.push(added); state.selectedId = state.targetId = added.id; if (isMechanicalUnit(added)) syncBatteryShields().forEach(s => appendLog(s)); render(); return; }
      case "calculate":
      case "applyAttack":
        if (!c.input || typeof c.input !== "object" || Array.isArray(c.input)) throw new Error("Calculator attack requires explicit input");
        return c.action === "calculate" ? doCalc(c.input) : doApply(c.input);
      default: throw new Error("Unknown calculator action: " + c.action);
    }
  }
  Commands.register("calc", execute, { domain: "calculator" });
  return { execute };
})();
