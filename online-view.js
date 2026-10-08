/* D3 outbound presentation boundary. Player DTOs are deliberately incomplete:
 * never restore them into rule state, run a preview, or execute rules on them.
 * New fields are private until explicitly added to a projector below. */
(function (root) {
  "use strict";
  const SCHEMA = "backfire-online-display-v1";
  const own = (o, k) => o && typeof o === "object" && Object.getOwnPropertyDescriptor(o, k);
  const get = (o, k) => { const d = own(o, k); return d && Object.hasOwn(d, "value") ? d.value : undefined; };
  const obj = v => !!v && typeof v === "object" && !Array.isArray(v);
  const arr = v => Array.isArray(v) ? v : [];
  const sensitive = /s\s*h\s*p|坚[\s\u200b-\u200f]*毅|毅[\s\u200b-\u200f]*生命|后台|backstage|gm[_ -]?(?:secret|note|data)|private[_ -]?(?:note|history)|reconnect[_ -]?token/i;
  function text(v, limit = 120) {
    if (typeof v !== "string") return null;
    const clean = v.normalize("NFKC").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, "");
    return sensitive.test(clean) ? null : clean.slice(0, limit);
  }
  function id(v) { return typeof v === "string" && /^[\w:./-]{1,160}$/.test(v) && !sensitive.test(v) && !["__proto__", "prototype", "constructor"].includes(v) ? v : null; }
  function number(v) { return typeof v === "number" && Number.isFinite(v) ? v : undefined; }
  function copyFields(src, dst, strings = [], numbers = [], booleans = []) {
    for (const key of strings) { const v = text(get(src, key)); if (v !== null) dst[key] = v; }
    for (const key of numbers) { const v = number(get(src, key)); if (v !== undefined) dst[key] = v; }
    for (const key of booleans) if (typeof get(src, key) === "boolean") dst[key] = get(src, key);
    return dst;
  }
  function identifiers(src, dst, keys) { for (const key of keys) { const v = id(get(src, key)); if (v !== null) dst[key] = v; } return dst; }
  function enumField(src, dst, key, values) { if (values.includes(get(src, key))) dst[key] = get(src, key); }
  function selected(src, keys) {
    const dst = {};
    for (const key of keys) { const v = get(src, key); if (typeof v === "boolean" || number(v) !== undefined) dst[key] = v; }
    return dst;
  }
  function clone(value, seen = new Set()) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (!value || typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);
    const out = Array.isArray(value) ? value.map(v => clone(v, seen)) : {};
    if (!Array.isArray(value)) for (const key of Object.keys(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) continue;
      const v = get(value, key); if (v !== undefined && typeof v !== "function") out[key] = clone(v, seen);
    }
    seen.delete(value); return out;
  }
  const layerTypes = ["flesh", "armor", "shield", "sand", "spirit"];
  const resourceNumbers = ["nano", "bean", "liquid", "durability", "shield", "tauntLeft", "charge", "energyPct", "light", "lockLeft", "smashUsed", "phase", "debrisCount"];
  const resourceFlags = ["mecha", "engine", "prepared", "preparedActive", "preparedPending", "smashNext", "smashOnce", "niuOut", "narutoOut", "forceCruelNext", "scanned", "unstable", "forceCharge", "forceOverheat"];
  const statusKeys = ["burn", "shock", "corr", "frostbite", "shockwave", "high", "reso", "unstable", "weak", "inspire", "hide", "advantage", "chase", "sturdy"];
  function projectUnit(unit) {
    if (!obj(unit) || !id(get(unit, "id"))) return null;
    const out = identifiers(unit, {}, ["id", "kit", "weaponOf", "owner", "operatorId"]);
    copyFields(unit, out, ["name"], ["level", "xp", "zone", "atk", "def", "defMax", "ap", "apMax", "bonus", "bonusMax", "highEnergy", "stunMarks"], ["isPlayer", "weaponUnit", "isProp", "isGap", "isDevice", "dying", "stunned", "flying", "dead", "hidden", "noMove"]);
    if (get(unit, "fused") || get(unit, "_removed")) out.hidden = true;
    out.layers = arr(get(unit, "layers")).slice(0, 20).filter(obj).map(layer => {
      const result = {}; enumField(layer, result, "type", layerTypes);
      const current = number(get(layer, "current")) ?? number(get(layer, "cur"));
      if (current !== undefined) result.current = current;
      const max = number(get(layer, "max")); if (max !== undefined) result.max = max;
      return result;
    });
    out.statuses = selected(get(unit, "statuses"), statusKeys);
    out.instant = selected(get(unit, "instant"), ["melt", "sting", "overload", "shift", "spread", "refract", "iceNext"]);
    const r = get(unit, "resources"); out.resources = copyFields(r, {}, [], resourceNumbers, resourceFlags);
    enumField(r, out.resources, "stance", ["draw", "iai", "waki"]);
    enumField(r, out.resources, "blade", ["niu", "naruto"]);
    enumField(r, out.resources, "mood", ["gentle", "cruel"]);
    enumField(r, out.resources, "bit", ["acid", "drill"]);
    identifiers(r, out.resources, ["bondId", "piercedId"]);
    // 首领机制（死刑 / 分担 / 远离 / 踩塔）是公开的预告：只给标记目标、落下回合和时机，不给伤害数值
    const mech = arr(get(unit, "mechanics")).slice(0, 8).filter(m => obj(m) && ["execution", "share", "spread", "tower"].includes(get(m, "type"))).map(m => {
      const dto = { type: get(m, "type") }; copyFields(m, dto, ["name"], ["need", "count"], []); enumField(m, dto, "phase", ["enemy", "player"]);
      const st = get(m, "st"); dto.st = copyFields(st, {}, [], ["due"], ["done"]); identifiers(st, dto.st, ["targetId"]);
      const ids = arr(get(st, "targetIds")).slice(0, 20).map(id).filter(Boolean); if (ids.length) dto.st.targetIds = ids;
      const zs = arr(get(st, "zones")).slice(0, 20).map(number).filter(z => z !== undefined); if (zs.length) dto.st.zones = zs;
      return dto;
    });
    if (mech.length) out.mechanics = mech;
    // status/res are legacy free-form strings and must not bypass these DTOs.
    return out;
  }
  function projectProp(prop) {
    if (!obj(prop) || !id(get(prop, "id"))) return null;
    const out = identifiers(prop, {}, ["id"]);
    copyFields(prop, out, ["name"], ["zone", "level", "hp", "maxHp"], ["destroyed"]);
    enumField(prop, out, "kind", ["button", "lever", "battery", "boom", "acid", "scrap", "turret", "ironwall", "scrapwall", "dome"]);
    enumField(prop, out, "faction", ["player", "enemy", "neutral"]);
    return out;
  }
  function projectState(state, context = {}) {
    if (!obj(state)) return null;
    const out = { displayOnly: true, schema: SCHEMA };
    copyFields(state, out, [], ["turnNo", "zoneMode", "phaseStep", "partySize", "kuizhi"], ["combatStarted", "retreated", "ambush"]);
    enumField(state, out, "sandDir", ["12", "21", "23", "32", "13", "31", "E", "W", "S", "N"]);
    out.weatherLocked = !!get(state, "weatherLock");
    enumField(state, out, "combatPhase", ["player", "enemy"]);
    enumField(state, out, "weather", ["none", "heat", "snow", "acid", "thunder", "glow", "sand", "phase"]);
    out.units = arr(get(state, "units")).slice(0, 200).map(projectUnit).filter(Boolean);
    const bag = get(state, "bag");
    if (obj(bag)) {
      out.bag = copyFields(bag, {}, [], ["water"], []);
      out.bag.items = arr(get(bag, "items")).slice(0, 200).flatMap(item => {
        const itemId = id(get(item, "id")), qty = number(get(item, "qty"));
        if (!itemId || qty === undefined || qty <= 0) return [];
        // Catalog descriptions contain hidden-pool effects; only names are public.
        const name = text(get(get(context.itemCatalog, itemId), "name"));
        return [{ id: itemId, name: name || itemId, qty }];
      });
    }
    out.props = arr(get(state, "props")).slice(0, 100).map(projectProp).filter(Boolean);
    out.fields = {}; out.gaps = {};
    for (const key of ["1", "2", "3"]) if (obj(get(get(state, "fields"), key))) {
      const field = get(get(state, "fields"), key);
      out.fields[key] = selected(field, ["fire", "fireOn", "electric", "acid", "ice", "collapse", "energy", "energyVal", "harmonic", "heal", "highland", "abyss", "isolate", "collapseOn", "collapseLv", "ruinOn", "ruinHp", "ruinMax"]);
      out.fields[key].fieldLocked = !!get(field, "fieldLock");
    }
    for (const key of ["1-2", "2-3"]) if (obj(get(get(state, "gaps"), key))) {
      const gap = get(get(state, "gaps"), key), dto = copyFields(gap, {}, [], ["hp", "maxHp", "level"], ["open"]);
      enumField(gap, dto, "type", ["open", "bridge", "wall", "door", "void"]); out.gaps[key] = dto;
    }
    return out;
  }
  const popupWords = new Set(["无效", "失衡", "起身", "倒下", "刺入", "温和", "残忍", "登场支援！", "聚焦抹层", "灼烧", "感电", "腐蚀", "冻伤", "震荡", "共振", "高能", "虚弱", "振奋", "躲藏", "优势", "紧追", "熔融", "刺骨", "过载", "错位", "扩散", "折射"]);
  function projectTape(tape, context = {}) {
    const units = arr(get(context.state, "units"));
    return arr(tape).slice(0, 256).flatMap(event => {
      if (!obj(event) || get(event, "type") !== "pop" || !id(get(event, "unitId"))) return [];
      const kind = get(event, "kind"); if (!["dmg", "heal", "break", "status", "fxword", "highboom", "partner"].includes(kind)) return [];
      const out = identifiers(event, { type: "pop", kind }, ["unitId", "targetId"]);
      enumField(event, out, "element", ["physical", "fire", "ice", "electric", "acid", "energy", "harmonic"]);
      const snap = arr(get(event, "snap")), subject = snap.find(u => get(u, "id") === out.unitId) || units.find(u => get(u, "id") === out.unitId);
      // Legacy damage/healing numbers can include the hidden life pool. Without
      // proof that the subject uses visible HP, omit numbers rather than infer.
      const visibleHp = subject && !get(subject, "upOnShp") && !get(subject, "dying") && !get(subject, "dead");
      if (kind === "break" || kind === "highboom" || visibleHp && ["dmg", "heal"].includes(kind)) {
        const n = number(get(event, "value")); if (n !== undefined) out.value = n;
      }
      if (popupWords.has(get(event, "text"))) out.text = get(event, "text");
      if (snap.length) out.snap = snap.map(projectUnit).filter(Boolean);
      return [out];
    });
  }
  function projectMessages(messages, context) {
    const { recipientId, gmId } = context;
    if (recipientId === gmId) return clone(arr(messages));
    return arr(messages).flatMap(message => {
      if (!obj(message)) return [];
      const from = id(get(message, "from")), to = id(get(message, "to"));
      if (!from || !to || !(from === gmId && (to === "all" || to === recipientId) || from === recipientId && to === gmId)) return [];
      const body = text(get(message, "text"), 2000); if (body === null) return [];
      const out = identifiers(message, { from, to, text: body }, ["id"]);
      copyFields(message, out, [], ["at"], []); out.private = to !== "all";
      return [out];
    }).slice(-300);
  }
  function projectLogs(logs) {
    // Only host-created semantic events are accepted. Never accept generic
    // text/notes/logPages or a caller-supplied "public:true" escape hatch.
    const templates = { action: "单位执行了行动", phase: "战斗阶段变化", gm: "主持人调整了战场", round: "回合开始", victory: "战斗胜利", defeat: "战斗结束", retreat: "队伍撤退", gmUpdate: "主持人调整了战场", spawn: "有单位加入战场", remove: "有单位离开战场" };
    return arr(logs).slice(-100).flatMap(row => {
      if (!obj(row) || get(row, "silent") === true || !Object.hasOwn(templates, get(row, "kind"))) return [];
      const out = identifiers(row, { kind: get(row, "kind"), text: templates[get(row, "kind")] }, ["id", "actorId"]);
      copyFields(row, out, [], ["turnNo", "turn", "at", "seq"], []);
      if (out.kind === "action") {
        const actor = text(get(row, "actorName"), 60), action = text(get(row, "actionName"), 60);
        if (actor && action) out.text = actor + " · " + action;
      }
      if (out.kind === "phase") {
        enumField(row, out, "phase", ["player", "enemy", "exploration", "ended"]);
        out.text = ({ player: "我方回合", enemy: "敌人回合", exploration: "返回探索", ended: "战斗结束" })[out.phase] || out.text;
      }
      if (out.kind === "gm") {
        const summary = get(row, "summary");
        if (["主持人调整了战场", "主持人更新了单位数据", "主持人更新了天气", "主持人添加了配置物", "主持人移除了配置物", "主持人调整了队伍物资"].includes(summary)) out.text = summary;
        // Public spawn metadata is safe; arbitrary free-form GM notes are not.
        if (get(row, "action") === "spawn" && text(get(row, "unitName"), 60) && [1, 2, 3].includes(get(row, "zone")) && number(get(row, "level")) !== undefined) out.text = `主持人在 ${get(row, "zone")} 区加入 ${text(get(row, "unitName"), 60)} Lv${get(row, "level")}`;
        const action = get(row, "action"), unitName = text(get(row, "unitName"), 60), propName = text(get(row, "propName"), 60);
        if (action === "remove") out.text = `主持人移出了${unitName || "一个单位"}（不计击杀）`;
        if (action === "kill") out.text = `主持人击杀了${unitName || "一个单位"}`;
        if (action === "propRemove") out.text = `主持人移除了${propName || "一个配置物"}（未触发摧毁效果）`;
        if (action === "propDestroy") out.text = `主持人摧毁了${propName || "一个配置物"}`;
        if (action === "manualOn") out.text = `主持人开启了${unitName || "敌人"}的手动控制`;
        if (action === "manualOff") out.text = `主持人关闭了${unitName || "敌人"}的手动控制`;
      }
      return [out];
    });
  }
  function publicResult(result) {
    if (!obj(result)) return null;
    const out = copyFields(result, {}, [], [], ["accepted", "executed", "roundDone", "alreadySettled"]);
    enumField(result, out, "outcome", ["win", "lose", "retreat"]);
    const grade = get(result, "grade");
    if (obj(grade)) { out.grade = copyFields(grade, {}, [], ["score", "par", "xpMult"], []); enumField(grade, out.grade, "grade", ["D", "C", "B", "A", "S", "SS", "SSS"]); }
    return out;
  }
  const pickKeys = new Set(["partner", "target", "target1", "target2", "ally", "dest", "prop", "layer", "status", "mode", "carry", "burn", "rangeMode", "carryMode", "blade", "again", "item", "index"]);
  function choiceValue(value) {
    if (value === null || typeof value === "boolean" || number(value) !== undefined) return value;
    if (typeof value === "string") return text(value, 160) === value ? value : undefined;
    // Existing flow choices are primitives. The only accepted object is a flat
    // public pick tuple; no unknown nested object is ever forwarded.
    if (!obj(value) || Object.keys(value).some(k => !pickKeys.has(k))) return undefined;
    const out = {};
    for (const k of Object.keys(value)) {
      const v = get(value, k);
      if (v !== null && typeof v !== "boolean" && number(v) === undefined && typeof v !== "string") return undefined;
      const safe = choiceValue(v); if (safe === undefined) return undefined; out[k] = safe;
    }
    return out;
  }
  function actionCommand(command) {
    if (!obj(command) || !["skill", "move", "standUp", "useItem", "endTurn"].includes(get(command, "type"))) return null;
    if (Object.keys(command).some(k => !["type", "actor", "skill", "target", "picks", "dest", "item"].includes(k))) return null;
    const out = identifiers(command, { type: get(command, "type") }, ["actor", "skill", "target", "item"]);
    for (const key of ["target", "dest"]) if (get(command, key) === null) out[key] = null;
    if (number(get(command, "dest")) !== undefined) out.dest = get(command, "dest");
    if (own(command, "picks")) {
      const picks = choiceValue(get(command, "picks")); if (!obj(picks)) return null; out.picks = picks;
    }
    return out;
  }
  function projectActionMenu(menu) {
    if (!obj(menu)) return null;
    const out = identifiers(menu, { type: "actionOptions", displayOnly: true }, ["actor", "skill"]);
    copyFields(menu, out, [], ["requestId"], ["ok"]);
    const choices = get(menu, "choices");
    if (obj(choices)) {
      const dto = copyFields(choices, {}, ["title"], [], ["optional"]);
      enumField(choices, dto, "kind", ["skill", "choice", "unit", "zone", "ready"]);
      if (pickKeys.has(get(choices, "key"))) dto.key = get(choices, "key");
      dto.options = arr(get(choices, "options")).slice(0, 200).flatMap(option => {
        const value = choiceValue(get(option, "value")); if (value === undefined) return [];
        const item = copyFields(option, { value }, ["label", "sub"], [], ["disabled"]);
        if (get(option, "reason")) item.reason = safeError(get(option, "reason"));
        return [item];
      });
      const command = actionCommand(get(choices, "command")); if (command) dto.command = command;
      out.choices = dto;
    }
    const command = actionCommand(get(menu, "command")); if (command) out.command = command;
    if (get(menu, "error")) out.error = safeError(get(menu, "error"));
    return out;
  }
  function safeError(error) {
    const value = text(error, 500);
    if (!value) return "操作未生效，请检查当前权限与可用选项";
    const reasons = [
      [/不是你的|不属于你|不能代替/, "不能操作或代答其他玩家的单位"],
      [/还没轮到|不是你的回合|当前顺位/, "还没轮到这个单位"],
      [/行动点不足/, "行动点不足"], [/附赠行动不足/, "附赠行动不足"],
      [/只有房主|只有主持人/, "只有主持人可以执行此操作"],
      [/版本不同/, "版本不同，请刷新"], [/等待.*回应|等待.*选择/, "正在等待玩家回应"],
      [/选择顺序|确定行动顺序/, "请先确定行动顺序"], [/已被占用/, "已被占用"],
      [/固定.*调整|锁定/, "这个顺序格已经固定"], [/失衡/, "失衡中，无法行动"],
      [/濒死|起身/, "当前状态不允许该行动"], [/敌人回合|敌方回合/, "当前是敌人回合"],
      [/超出.*射程|射程.*不足/, "目标超出技能射程"], [/分步|技能目标|可用目标/, "目标或分步选择已失效"],
      [/没有.*道具|缺货/, "没有这件可用道具"], [/相邻|移动/, "当前不能移动到该区域"],
      [/战斗.*结束|战斗.*开始/, "当前战斗阶段不允许该操作"], [/过期|失效/, "这个选择已经失效"],
      [/掉线|离线|暂停/, "房主离线，等待恢复连接"], [/结算|播放行动/, "正在结算，请稍候"]
    ];
    return (reasons.find(([pattern]) => pattern.test(value)) || [null, "操作未生效，请检查当前权限与可用选项"])[1];
  }
  function projectView(view, context) {
    if (!obj(view)) return null;
    const out = identifiers(view, { displayOnly: true, playerId: context.recipientId, canConfigure: false, canDisable: false }, ["currentUnitId", "gmId", "hostId"]);
    copyFields(view, out, [], ["turnNo"], ["configured", "enabled", "network"]);
    enumField(view, out, "phase", ["setup", "selecting", "picking", "acting", "enemy", "ended", "exploration"]);
    enumField(view, out, "mode", ["trpg", "coop"]);
    for (const key of ["players", "operators"]) if (Array.isArray(get(view, key))) out[key] = get(view, key).map(p => identifiers(p, copyFields(p, {}, ["name"], [], ["online", "gm"]), ["id"]));
    const row = item => !obj(item) ? null : identifiers(item, copyFields(item, {}, ["unitName", "operatorName", "name"], [], ["spent", "completed", "locked", "done", "current"]), ["id", "unitId", "actor", "operatorId", "owner", "weaponOf"]);
    for (const key of ["roster", "slots", "order", "units", "heroes"]) if (Array.isArray(get(view, key))) out[key] = get(view, key).slice(0, 200).map(row);
    out.confirmed = arr(get(view, "confirmed")).map(id).filter(Boolean);
    out.chat = arr(get(view, "chat")).slice(-100).flatMap(m => {
      const t = text(get(m, "text"), 500); return t === null ? [] : [identifiers(m, copyFields(m, { text: t }, ["operatorName", "name"], ["at"], []), ["id", "operatorId"])];
    });
    out.messages = projectMessages(get(view, "messages"), context);
    const swap = get(view, "swap"); out.swap = obj(swap) ? identifiers(swap, {}, ["requestId", "from", "to", "recipient"]) : null;
    const ask = get(view, "ask"); out.ask = null;
    if (obj(ask)) {
      const dto = identifiers(ask, copyFields(ask, {}, ["title"], ["deadline"], ["declined"]), ["id"]);
      enumField(ask, dto, "kind", ["choice", "block", "assist"]);
      if (get(ask, "deadline") === null) dto.deadline = null;
      dto.waitingNames = arr(get(ask, "waitingNames")).map(n => text(n, 60)).filter(n => n !== null);
      // Ownership is checked again here, even if the caller already projected
      // an ask, so passing the wrong cached view cannot expose another's menu.
      const owned = new Set([...(out.units || []), ...(out.heroes || []), ...(out.roster || [])].filter(u => u && (u.owner || u.operatorId) === context.recipientId).map(u => u.id || u.unitId));
      dto.options = arr(get(ask, "options")).flatMap(option => {
        if (!owned.has(get(option, "helper"))) return [];
        const item = identifiers(option, copyFields(option, {}, ["label", "sub"]), ["helper"]);
        if (own(option, "extra")) { const extra = choiceValue(get(option, "extra")); if (extra === undefined) return []; item.extra = extra; }
        return [item];
      });
      dto.eligible = dto.options.length > 0; out.ask = dto;
    }
    return out;
  }
  function projectPacket(packet, context = {}) {
    if (!id(context.recipientId) || !id(context.gmId)) throw new TypeError("A bound recipient and GM identity are required");
    if (context.recipientId === context.gmId) return clone(packet);
    if (!obj(packet)) return null;
    if (get(packet, "type") === "actionOptions") return Object.assign(projectActionMenu(packet), copyFields(packet, {}, ["build"], ["protocol", "seq"], []), { schema: SCHEMA });
    const out = { displayOnly: true, schema: SCHEMA };
    copyFields(packet, out, ["type", "build", "roomCode", "hostName"], ["protocol", "seq", "requestId"], ["ok", "paused", "manualPhase"]);
    if (get(packet, "systemNotice") === "房主遇到处理错误，请等待主持人确认后继续") out.systemNotice = get(packet, "systemNotice");
    if (get(packet, "type") === "messageHistory") copyFields(packet, out, [], [], ["hasMore"]);
    if (own(packet, "offlineWait")) {
      const wait = get(packet, "offlineWait");
      out.offlineWait = obj(wait) ? identifiers(wait, copyFields(wait, {}, ["name"], ["deadline"], []), ["actor", "owner"]) : null;
    }
    enumField(packet, out, "screen", ["lobby", "exploration", "battle", "ended"]);
    if (get(packet, "ok") === false || get(packet, "error") != null) out.error = safeError(get(packet, "error"));
    if (own(packet, "state")) out.state = projectState(get(packet, "state"), context);
    if (own(packet, "tape")) out.tape = projectTape(get(packet, "tape"), { state: get(packet, "state") || context.state });
    if (own(packet, "view")) out.view = projectView(get(packet, "view"), context);
    if (own(packet, "result")) out.result = publicResult(get(packet, "result"));
    if (own(packet, "messages")) out.messages = projectMessages(get(packet, "messages"), context);
    if (get(packet, "type") === "messageHistory" && out.messages) out.messages = out.messages.slice(-100);
    if (own(packet, "publicLogs")) out.publicLogs = projectLogs(get(packet, "publicLogs"));
    // Resync is another envelope using these same explicit projectors, not a
    // path for forwarding an opaque nested packet or raw save snapshot.
    return out;
  }
  const api = { SCHEMA, projectPacket, projectUnit, projectState, projectTape, projectMessages, projectLogs, projectView, projectActionMenu, safeText: text, safeError };
  root.OnlineView = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
