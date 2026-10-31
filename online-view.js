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
  // 人打的字（小队聊天、私信）：拦后台 / 令牌这类技术字段，和明说的「坚毅生命」/ 单独成词的 SHP（坚毅数值绝不给玩家看）。
  // 以前和规则数据用同一个过滤，带「坚毅」两个字、甚至 "this hp"（s h p）的整条消息都会消失（报告「中」）
  const sensitiveTech = /后台|backstage|gm[_ -]?(?:secret|note|data)|private[_ -]?(?:note|history)|reconnect[_ -]?token|坚[\s\u200b-\u200f]*毅[\s\u200b-\u200f]*生命|毅[\s\u200b-\u200f]*生命|(?<![a-z])s[\s._-]*h[\s._-]*p(?![a-z])/i;
  /** keepLines（小队聊天）：保留换行和全角字符（字符画靠全角空格对齐），其余控制字符、零宽和双向控制字符照样去掉；敏感词照样按规范化后的文字判断 */
  function chatText(v, limit, keepLines = false) {
    if (typeof v !== "string") return null;
    const clean = v.normalize("NFKC").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, "");
    if (sensitiveTech.test(clean)) return null;
    return keepLines ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, "").slice(0, limit) : clean.slice(0, limit);
  }
  // （新）#340 第 11 条：和 hotseat-game.js · hideWallets 同一套规则。
  // 房间检查点里可能还留着这次修复之前带余额的旧聊天（最多 300 条），投影时再滤一遍。
  function hideWallets(text) {
    return String(text)
      .replace(/（([^（）]*?) 剩 \d+，([^（）]*?) 现有 \d+）/g, "")
      .replace(/（由 ([^（），]+?) 付，钱包剩 \d+）/g, "（由 $1 付）")
      .replace(/进 ([^（）]+?) 的钱包（现有 \d+）/g, "进 $1 的钱包");
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
  // 主机本地的展示函数（状态行、资源、实际 atk、首领标记……）：玩家端没有规则，靠主机算好了按白名单发过去
  function call(name, ...args) { const fn = root[name]; if (typeof fn !== "function") return undefined; try { return fn(...args); } catch (e) { return undefined; } }
  /** 「a · b · c」这种展示文字：一段一段过滤（含敏感字样的那一段丢掉，不连累整行） */
  function tokenLine(v, max = 30) {
    if (typeof v !== "string") return "";
    return v.split(" · ").map(t => text(t.trim(), 48)).filter(t => t && t !== "无状态").slice(0, max).join(" · ");
  }
  const mechTypes = ["execution", "share", "spread", "tower", "volley"], phases = ["enemy", "player"];
  function markDto(m, strings, numbers, booleans) {
    if (!obj(m)) return null;
    const o = {}; enumField(m, o, "type", mechTypes); if (!o.type) return null;
    copyFields(m, o, strings, numbers, booleans); enumField(m, o, "phase", phases);
    return o;
  }
  /** 单位卡上要的展示信息：和主机本地卡片同一套（game.js · snapUnit） */
  function displayOf(unit) {
    const d = {};
    let status = call("statusLine", unit);
    if (call("touDuelVictim", unit)) status = (typeof status === "string" && status !== "无状态" ? status + " · " : "") + "决一死战";
    const st = tokenLine(status); if (st) d.status = st;
    if (get(unit, "isPlayer")) { const r = tokenLine(call("resourceText", unit), 12); if (r) d.res = r; }
    const atk = number(call("effectiveAtk", unit, root.state && root.state.units)); if (atk !== undefined) d.atk = Math.round(atk);
    if (get(unit, "isPlayer") && !get(unit, "escort")) {
      const weapon = typeof root.isWeaponUnit === "function" ? !!call("isWeaponUnit", unit) : !!get(unit, "weaponOf");
      const kit = weapon ? get(unit, "kit") : call("heldWeaponKit", unit);
      const max = number(call("weaponDurMax", kit));
      if (typeof kit === "string" && max > 0) {
        const r = get(unit, "resources");
        const cur = weapon && number(get(r, "durability")) !== undefined ? get(r, "durability") : (number(call("weaponDur", kit)) ?? max);
        d.dur = { cur: Math.max(0, Math.min(max, cur)), max };
        const name = text(call("weaponName", kit), 40); if (name) d.dur.name = name;
      }
    }
    const marks = arr(call("bossMarksOn", unit)).slice(0, 8).map(m => markDto(m, ["name", "by", "shot"], ["left", "pool", "group", "blast", "stack", "brk", "mates"], ["delayed"])).filter(Boolean);
    if (marks.length) d.marks = marks;
    const casts = arr(call("bossCastsBy", unit)).slice(0, 8).map(m => markDto(m, ["name", "target"], ["left"], [])).filter(Boolean);
    if (casts.length) d.casts = casts;
    const intents = arr(call("enemyIntents", unit)).slice(0, 4).map(x => text(x, 12)).filter(Boolean);
    if (intents.length) d.intents = intents;
    // 分阶段的首领 / 精英现在在第几阶段：玩家端悬停说明只列这一阶段的能力。规则单位现算（bestiary.js · bestiaryStageOf）；
    // 演出用的画面快照（game.js · snapUnit）身上没有 resources、现算不出来，用快照里已经算好的 stage。
    // 只发阶段编号（1、2、3……），换阶段的血量门槛之类的规则数值不发
    const stage = number(get(unit, "stage")) ?? number(call("bestiaryStageOf", unit));
    if (Number.isInteger(stage) && stage >= 1 && stage <= 9) d.stage = stage;
    if (!get(unit, "isPlayer") && (get(unit, "dead") || get(unit, "_removed"))) {
      const ok = number(get(unit, "overkill")); if (ok > 0) d.overkill = Math.round(ok);
      if (get(unit, "killBig") === true) d.killBig = true;
    }
    return Object.keys(d).length ? d : null;
  }
  /** 区域上的展示：已标定的范围攻击预警、沙暴风向、踩塔（game.js · snapEnv） */
  function zoneViewOf(z, state) {
    const v = {};
    const threats = arr(call("zoneThreatsIn", z)).slice(0, 8).filter(obj).map(t => {
      const o = {}; const label = text(get(t, "label"), 60); if (!label) return null;
      o.label = label; const from = text(get(t, "from"), 40); if (from) o.from = from; if (get(t, "ready") === true) o.ready = true; return o;
    }).filter(Boolean);
    if (threats.length) v.threats = threats;
    if (get(state, "weather") === "sand") { const w = text(call("sandWindLabel", call("sandWind", z, get(state, "zoneMode"), get(state, "sandDir"))), 8); if (w) v.wind = w; }
    const towers = arr(call("bossZoneMarks", z)).slice(0, 4).map(m => markDto(m, ["name", "by"], ["left", "need", "have", "soak", "fail"], ["delayed"])).filter(Boolean);
    if (towers.length) v.towers = towers;
    return Object.keys(v).length ? v : null;
  }
  // nanoReserve：瑞比的储备能源（#219，不是坚毅数值，公开）
  const resourceNumbers = ["nano", "nanoReserve", "bean", "liquid", "durability", "shield", "tauntLeft", "charge", "energyPct", "light", "lockLeft", "smashUsed", "phase", "debrisCount"];
  const resourceFlags = ["mecha", "engine", "prepared", "preparedActive", "preparedPending", "smashNext", "smashOnce", "niuOut", "narutoOut", "forceCruelNext", "scanned", "unstable", "forceCharge", "forceOverheat"];
  const statusKeys = ["burn", "shock", "corr", "frostbite", "shockwave", "high", "reso", "unstable", "weak", "inspire", "hide", "advantage", "chase", "sturdy", "blind"];
  // 中立生物（沙漠的尘虫 / 管虫）身上的小标签（#358）：键 → 写什么，和单机旧画面 game.js · snapUnit 的 neutralTags 同一套字
  const neutralTagText = { stun: "失衡", flat: "摊平", seen: "已发现" };
  /** 中立生物的小标签：演出快照给了 neutralTags 就只认上面表里的键；规则单位按失衡 / 摊平 / 被声呐发现现算。字一律用上面那张表 */
  function neutralTagsOf(unit) {
    const given = get(unit, "neutralTags");
    const has = new Set(Array.isArray(given) ? given.filter(obj).map(t => get(t, "key"))
      : [get(unit, "stunned") ? "stun" : "", get(get(unit, "resources"), "flattened") ? "flat" : "", get(unit, "detected") ? "seen" : ""]);
    return Object.keys(neutralTagText).filter(k => has.has(k)).map(key => ({ key, text: neutralTagText[key] }));
  }
  function projectUnit(unit) {
    if (!obj(unit) || !id(get(unit, "id"))) return null;
    const out = identifiers(unit, {}, ["id", "kit", "weaponOf", "owner", "operatorId"]);
    // pvpOut：决斗里「再起不能」（#472）——只发这个状态，坚毅数值不发
    copyFields(unit, out, ["name", "escort"], ["level", "xp", "attrPoints", "zone", "atk", "def", "defMax", "ap", "apMax", "bonus", "bonusMax", "highEnergy", "stunMarks", "sink"], ["isPlayer", "weaponUnit", "isProp", "isGap", "isDevice", "dying", "stunned", "upOnShp", "flying", "dead", "hidden", "noMove", "dormant", "submerged", "neutral", "pvpOut"]);
    if (get(unit, "fused") || get(unit, "_removed")) out.hidden = true;
    // 玩家阵营（PvP 第一步，enemies.js · PVP_CFG，#445）：配置了阵营时每个单位带上它属于哪个阵营——玩家这一边是玩家阵营的
    // id（faction）和名字（factionName），非玩家单位是图鉴里的敌人阵营名（enemyFaction）。只发阵营 id / 名字（过 text 过滤），
    // 敌友关系、坚毅数值都不发；没配置阵营时一个字段都不加（和以前一样）
    if (call("pvpOn") === true) {
      const fid = call("playerFactionOf", unit);
      if (typeof fid === "string") {
        const f = text(fid, 16), name = text(get(call("playerFactionInfo", fid), "name"), 16);
        if (f) { out.faction = f; if (name) out.factionName = name; }
      } else {
        const fe = text(call("factionOf", unit), 24); if (fe) out.enemyFaction = fe;
      }
    }
    // 带着高能被打死的敌人：高能自爆演完之前先不算死（和本机画面一样，卡片等自爆后才淡出）
    if (out.dead && !out.isPlayer && (number(call("highBoomValue", unit)) || 0) > 0) { out.dead = false; out.hidden = false; }
    // 中立生物（desert.js）：新画面的「沙下动静」（#358）要的——是不是中立生物、下潜的几回合后离开、小标签（失衡 / 摊平 / 已发现）。
    // 规则单位身上没有 neutral（单机旧画面是 game.js · snapUnit 现算的），由主机按 isNeutralCreature 算好发过去；演出快照已经带着 neutral / neutralTags，照同一份白名单转。
    // 都是旧画面上写着的公开信息，不含坚毅生命
    if (typeof get(unit, "neutral") !== "boolean" && call("isNeutralCreature", unit) === true) out.neutral = true;
    if (out.neutral) {
      const leave = number(get(unit, "leaveIn")); if (leave !== undefined) out.leaveIn = leave;
      out.neutralTags = neutralTagsOf(unit);
    }
    // 首领 / 10 级起精英 / 和载具合并的驾驶员（敌我都算）：要攒几个晕眩标记才晕眩（玩家那边画「晕眩标记 n/2」徽章；他们自己算不出敌人的级别规则）
    try { if (typeof root.isBossUnit === "function" && root.isBossUnit(unit)) out.stunMax = 2; } catch (e) {}
    // 属性（升级加点要看）：六项数值和曾经加过的项
    const attrs = get(unit, "attrs");
    if (obj(attrs)) { out.attrs = {}; for (const k of ["str", "con", "dex", "wil", "int", "sta"]) { const v = number(get(attrs, k)); if (v !== undefined) out.attrs[k] = v; } }
    const picks = arr(get(unit, "attrPicks")).filter(a => ["str", "con", "dex", "wil", "int", "sta"].includes(a));
    if (picks.length) out.attrPicks = picks.slice(0, 10);
    out.layers = arr(get(unit, "layers")).slice(0, 20).filter(obj).map(layer => {
      const result = {}; enumField(layer, result, "type", layerTypes);
      const current = number(get(layer, "current")) ?? number(get(layer, "cur"));
      if (current !== undefined) result.current = current;
      const max = number(get(layer, "max")); if (max !== undefined) result.max = max;
      return result;
    });
    // 个体值（杂兵、精英）：血量 / ATK 水平（百分比，公开）
    const iv = get(unit, "iv");
    if (obj(iv)) { const h = number(get(iv, "hp")), a = number(get(iv, "atk")); if (h !== undefined && a !== undefined) out.iv = { hp: h, atk: a }; }
    // 种族（敌人，公开）：{ race, branch }，只放行文本
    const race = get(unit, "race");
    if (obj(race) && typeof get(race, "race") === "string") { out.race = { race: String(get(race, "race")).slice(0, 12) }; if (typeof get(race, "branch") === "string" && get(race, "branch")) out.race.branch = String(get(race, "branch")).slice(0, 12); }
    out.statuses = selected(get(unit, "statuses"), statusKeys);
    out.instant = selected(get(unit, "instant"), ["melt", "sting", "overload", "shift", "spread", "refract", "iceNext"]);
    const r = get(unit, "resources"); out.resources = copyFields(r, {}, [], resourceNumbers, resourceFlags);
    enumField(r, out.resources, "stance", ["draw", "iai", "waki"]);
    enumField(r, out.resources, "blade", ["niu", "naruto"]);
    enumField(r, out.resources, "mood", ["gentle", "cruel"]);
    enumField(r, out.resources, "bit", ["acid", "drill"]);
    identifiers(r, out.resources, ["bondId", "piercedId"]);
    // 首领机制（死刑 / 分担 / 远离 / 踩塔）是公开的预告：只给标记目标、落下回合和时机，不给伤害数值
    const mech = arr(get(unit, "mechanics")).slice(0, 8).filter(m => obj(m) && ["execution", "share", "spread", "tower", "volley"].includes(get(m, "type"))).map(m => {
      const dto = { type: get(m, "type") }; copyFields(m, dto, ["name"], ["need", "count"], []); enumField(m, dto, "phase", ["enemy", "player"]);
      const st = get(m, "st"); dto.st = copyFields(st, {}, [], ["due"], ["done"]); identifiers(st, dto.st, ["targetId"]);
      const ids = arr(get(st, "targetIds")).slice(0, 20).map(id).filter(Boolean); if (ids.length) dto.st.targetIds = ids;
      const zs = arr(get(st, "zones")).slice(0, 20).map(number).filter(z => z !== undefined); if (zs.length) dto.st.zones = zs;
      return dto;
    });
    if (mech.length) out.mechanics = mech;
    // Helumica 的聚焦：哪一层、属性序列、走到第几步（公开信息，本地卡片上也写着）
    const focusEls = ["fire", "acid", "electric", "ice", "energy", "physical", "harmonic"];
    const focuses = arr(get(unit, "focuses")).slice(0, 5).filter(obj).map(f => {
      const dto = {}; enumField(f, dto, "layerType", layerTypes);
      dto.seq = arr(get(f, "seq")).slice(0, 12).filter(e => focusEls.includes(e));
      const step = number(get(f, "step")); dto.step = step === undefined ? 0 : Math.max(0, Math.min(dto.seq.length, step));
      return dto;
    }).filter(f => f.layerType && f.seq.length);
    if (focuses.length) out.focuses = focuses;
    // 状态图标（hud-icons.js）：自我效果、挂着的攻击效果、刺入 / 牵挂标记、角色仪表的数据
    enumField(unit, out, "self", ["burn", "frost", "splash", "conductor", "anchor", "store", "doppler", "frenzy"]);   // frenzy：狂暴（下水道狂鼠）
    const sbs = number(get(unit, "selfBurnStacks")); if (sbs !== undefined) out.selfBurnStacks = sbs;
    const hung = arr(get(r, "nextAtkFx")).filter(x => ["combust", "icebreak", "bolt", "etch", "backflow", "inertia", "diffract"].includes(x)).slice(0, 7);
    if (hung.length && out.resources) out.resources.nextAtkFx = hung;
    const marks = [];
    try { if (typeof root.isPierced === "function" && root.isPierced(unit)) marks.push("needle"); } catch (e) {}
    try { if (arr(root.state && root.state.units).some(x => x && x.kit === "yuito" && x.resources && x.resources.bondId === get(unit, "id"))) marks.push("bond"); } catch (e) {}
    if (marks.length) out.marks = marks;
    if (obj(r) && get(unit, "isPlayer") && root.HudIcons) { let hud = null; try { hud = root.HudIcons.gaugeState(unit); } catch (e) {} const dto = projectHud(hud); if (dto) out.hud = dto; }
    // status/res 不直接转发：上面 displayOf 一段一段过滤后放进 display
    const display = displayOf(unit); if (display) out.display = display;
    // 载具（vehicle.js）：和车合并的驾驶员画成车的卡片——名字、等级、ATK 按车，写乘员 n / 4、驾驶员是谁（只有名字，不含坚毅数值）。
    // name 照旧是驾驶员自己的名字（队伍栏用），卡片上的名字看 vehicle.name。演出里每一下的快照（game.js · snapUnit）已经带着 vehicle，照同一份白名单转
    const vc = call("vehicleCardOf", unit) || get(unit, "vehicle");
    if (obj(vc)) {
      const v = {}; enumField(vc, v, "kind", vehicleKinds);
      copyFields(vc, v, ["name", "seatText", "pilot"], ["level", "atk"], []);
      const roster = arr(get(vc, "roster")).slice(0, 8).map(t => text(t, 60)).filter(Boolean);
      if (roster.length) v.roster = roster;
      if (v.kind && v.name) out.vehicle = v;
    }
    return out;
  }
  /** 角色仪表的数据：只放数字、开关和几个固定取值的字段（gaugeState 的输出） */
  const hudEnums = { mood: ["gentle", "cruel"], blade: ["niu", "naruto"], out: ["none", "niu", "naruto"], stance: ["draw", "iai", "guard"], bit: ["drill", "acid"] };
  function projectHud(hud) {
    if (!obj(hud)) return null;
    const kits = ["xia", "chuan", "nora", "ruby", "yuito", "hiaki", "tou", "kolt", "helu", "ras", "longge"];
    if (!kits.includes(get(hud, "kit"))) return null;
    const dto = { kit: get(hud, "kit") };
    for (const key of Object.keys(hud)) {
      if (["__proto__", "constructor", "prototype", "kit"].includes(key) || !/^[a-zA-Z]{1,16}$/.test(key)) continue;
      const v = get(hud, key);
      if (typeof v === "boolean") dto[key] = v;
      else if (number(v) !== undefined) dto[key] = Math.max(-999, Math.min(999, v));
      else if (hudEnums[key] && hudEnums[key].includes(v)) dto[key] = v;
      else if (key === "bondName") { const t = text(v, 40); if (t !== null) dto[key] = t; }
      // 龙哥的胶囊弹：没窥探到的那几发不发颜色（以前照发，所有玩家都能从包里看出弹序）
      else if (key === "ammo") dto.ammo = arr(v).slice(0, 6).filter(obj).map(a => get(a, "seen") === true ? { c: get(a, "c") === "blue" ? "blue" : "red", seen: true } : { c: "unknown", seen: false });
    }
    return dto;
  }
  const vehicleKinds = ["fortress"];   // 载具配置物的种类（vehicle.js · VEHICLES 的键）
  function projectProp(prop) {
    if (!obj(prop) || !id(get(prop, "id"))) return null;
    const out = identifiers(prop, {}, ["id"]);
    copyFields(prop, out, ["name"], ["zone", "level", "hp", "maxHp", "shield", "shieldMax"], ["destroyed"]);
    enumField(prop, out, "kind", ["button", "lever", "battery", "boom", "acid", "scrap", "turret", "ironwall", "scrapwall", "dome", "coral_branch", "coral_tentacle", "death_statue"].concat(vehicleKinds));
    enumField(prop, out, "faction", ["player", "enemy", "neutral"]);
    // 载具（vehicle.js）：乘员 n / 4，悬停列出谁在车里、谁是驾驶员（只有名字，不含任何坚毅数值）
    if (get(prop, "isVehicle") === true) {
      out.isVehicle = true;
      const seat = text(call("vehicleSeatText", prop), 20); if (seat) out.seatText = seat;
      const roster = arr(call("vehicleRosterLines", prop)).slice(0, 8).map(t => text(t, 60)).filter(Boolean);
      if (roster.length) out.roster = roster;
      // 有驾驶员：和本机画面一样只画合并后的那张车的卡片（驾驶员那边的 vehicle），配置物卡片藏起来
      if (call("vehiclePropHidden", prop) === true) out.hidden = true;
    }
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
    // 这场战斗在哪个区域、光影（白天 / 傍晚 / 夜晚）：只是画面的标签（HD-2D 战场的地面、远景、天空、灯）。
    // 区域只放行主机配置表认得的名字（world-data.js · battleRegionName；地图地点 id 换成区域名），光影只放行三个值（daylight.js · LIGHTS）；
    // 认不得的、主机没有配置表的，一律不发。主持人选过的 / 跟着地图、时钟的，房主发包前已经算好写在 state 里（world-data.js · battleLookSync）
    const region = text(call("battleRegionName", get(state, "region")), 12); if (region) out.region = region;
    enumField(state, out, "light", ["day", "dusk", "night"]);
    // 场景（区域里的哪个地方：采矿场的矿外 / 矿内 / 矿底……，#239）：只放行当前区域认得的场景 id（world-data.js · battleSceneId），
    // 别的区域的、乱写的、主机没有配置表的一律不发；没有区域就没有场景。主持人选的、单局抽场景的数（scenePick / sceneRoll）是房主自己的，不发
    const scene = region ? id(call("battleSceneId", region, get(state, "scene"))) : null; if (scene) out.scene = scene;
    // 友伤开关（#428，enemies.js · FRIENDLY_FIRE）：每个玩家各自开没开（操控者 id → true / false），大家都看得到谁开着。
    // 只放行开关本身：键是操控者 id（id() 认得的），值只能是 true / false，别的一律不发；不带任何坚毅数值
    const ff = get(state, "friendlyFire");
    if (obj(ff)) {
      const map = {};
      Object.keys(ff).slice(0, 16).forEach(k => { const who = id(k), v = get(ff, k); if (who && typeof v === "boolean") map[who] = v; });
      out.friendlyFire = map;
    }
    out.units = arr(get(state, "units")).slice(0, 200).map(projectUnit).filter(Boolean);
    // 决斗（#472，enemies.js · state.pvpDuel）：允许起身没有、限定几回合、谁先手（抛硬币的结果，战斗记录里也写着）。
    // 只放行这三样；两队是谁看单位的阵营（faction），决斗前的血量 / 坚毅（restore）这些一律不发
    const duel = get(state, "pvpDuel");
    if (obj(duel) && obj(get(duel, "teams"))) {
      const dto = { stand: get(duel, "stand") !== false };
      const rounds = number(get(duel, "rounds")); if (Number.isInteger(rounds) && rounds >= 1 && rounds <= 99) dto.rounds = rounds;
      enumField(duel, dto, "first", ["1队", "2队"]);
      out.duel = dto;
    }
    // 连续战斗第几场 / 共几场、援军还有几回合到哪个区（chain.js · status 的格式）
    const chain = get(state, "chain"), waves = arr(get(state, "waves")).filter(w => obj(w) && !get(w, "done"));
    if (obj(chain) || waves.length) {
      const stages = obj(chain) ? arr(get(chain, "stages")) : [];
      const t = number(get(state, "turnNo")) || 1;
      out.chainStatus = {
        total: Math.max(1, stages.length), index: obj(chain) ? Math.max(0, number(get(chain, "index")) || 0) : 0,
        names: stages.slice(0, 12).map((s, i) => text(get(s, "name"), 40) || `第 ${i + 1} 场`),
        waves: waves.slice(0, 8).map(w => {
          const rows = arr(get(w, "enemies"));
          return { no: number(get(w, "no")) || 0, in: Math.max(0, (number(get(w, "at")) || t) - t),
            zones: [...new Set(rows.map(r => number(get(r, "zone")) || 2))].sort().map(z => z + " 区").join("、"),
            count: rows.reduce((s, r) => s + Math.max(1, number(get(r, "count")) || 1), 0) };
        })
      };
    }
    const bag = get(state, "bag");
    if (obj(bag)) {
      out.bag = copyFields(bag, {}, [], ["water"], []);
      out.bag.items = arr(get(bag, "items")).slice(0, 200).flatMap(item => {
        const itemId = id(get(item, "id")), qty = number(get(item, "qty"));
        if (!itemId || qty === undefined || qty <= 0) return [];
        // 舞台包里的背包只带道具名（说明玩家端本地查目录）。道具 / 效果说明可以写明坚毅生命的消耗（固定的规则文字）；
        // 绝不能给玩家看的是玩家当前剩余的坚毅生命（shp / shpMax）：舞台包里靠 projectUnit 的白名单挡（根本不复制这些键），
        // 能推出剩余值的数字（shpBase / shpBonus、实际扣了多少、前后对比、百分比）同样不给；
        // 角色资料 / 单局这些整份转发的数据才靠 hiddenSheetKey / scrubHidden。
        const name = text(get(get(context.itemCatalog, itemId), "name"));
        return [{ id: itemId, name: name || itemId, qty }];
      });
    }
    out.props = arr(get(state, "props")).slice(0, 100).map(projectProp).filter(Boolean);
    // 特殊棋盘（四区方形、五区十字……）：只发区号、坐标和连接，玩家端照着排版
    const board = get(state, "board");
    if (obj(board)) {
      const zones = arr(get(board, "zones")).slice(0, 9).flatMap(z => {
        const zid = number(get(z, "id")), x = number(get(z, "x")), y = number(get(z, "y"));
        return Number.isInteger(zid) && zid >= 1 && zid <= 9 && Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < 9 && y < 9 ? [{ id: zid, x, y }] : [];
      });
      const ids = new Set(zones.map(z => z.id));
      const links = arr(get(board, "links")).slice(0, 20).flatMap(l => {
        const a = number(get(l, 0)), b = number(get(l, 1));
        return ids.has(a) && ids.has(b) && a !== b ? [[a, b]] : [];
      });
      if (zones.length) { out.board = { zones, links }; const bid = id(get(board, "id")); if (bid) out.board.id = bid; }
    }
    const zoneKeys = out.board ? out.board.zones.map(z => String(z.id)) : ["1", "2", "3"];
    const gapKeys = out.board ? out.board.links.map(([a, b]) => Math.min(a, b) + "-" + Math.max(a, b)) : ["1-2", "2-3"];
    out.fields = {}; out.gaps = {};
    for (const key of zoneKeys) if (obj(get(get(state, "fields"), key))) {
      const field = get(get(state, "fields"), key);
      out.fields[key] = selected(field, ["fire", "fireOn", "electric", "acid", "ice", "quicksand", "coral", "innate", "collapse", "energy", "energyVal", "harmonic", "heal", "highland", "abyss", "isolate", "collapseOn", "collapseLv", "ruinOn", "ruinHp", "ruinMax"]);
      out.fields[key].fieldLocked = !!get(field, "fieldLock");
    }
    for (const key of gapKeys) if (obj(get(get(state, "gaps"), key))) {
      const gap = get(get(state, "gaps"), key), dto = copyFields(gap, {}, [], ["hp", "maxHp", "level"], ["open"]);
      enumField(gap, dto, "type", ["open", "bridge", "wall", "door", "void", "wave"]);
      // 驻波墙（频域造物）：过滤的属性、降幅 / 增幅、暂时取代的是什么（耐久、门的开关）——都是棋盘上公开的东西，没有任何坚毅数值
      const wave = get(gap, "wave");
      if (dto.type === "wave" && obj(wave)) {
        const w = {};
        enumField(wave, w, "el", ["physical", "fire", "ice", "electric", "acid", "energy", "harmonic"]);
        enumField(wave, w, "mode", ["dampen", "amplify"]);
        const saved = get(wave, "saved");
        if (obj(saved)) {
          const base = copyFields(saved, {}, [], ["hp", "maxHp"], ["open"]);
          enumField(saved, base, "type", ["open", "bridge", "wall", "door", "void"]);
          w.saved = base;
        }
        dto.wave = w;
      }
      out.gaps[key] = dto;
    }
    for (const key of zoneKeys) { const zv = zoneViewOf(Number(key), state); if (zv) (out.zoneView = out.zoneView || {})[key] = zv; }
    return out;
  }
  const popupWords = new Set(["无效", "失衡", "起身", "倒下", "刺入", "温和", "残忍", "登场支援！", "聚焦抹层", "灼烧", "感电", "腐蚀", "冻伤", "震荡", "共振", "高能", "虚弱", "振奋", "躲藏", "优势", "紧追", "目盲", "落空", "熔融", "刺骨", "过载", "错位", "扩散", "折射", "红弹", "蓝弹", "导体", "霜结", "自焚", "溅射", "千钧", "蓄能", "多普勒", "狂暴", "爆燃", "破冰", "雷击", "蚀刻", "倒流", "惯性", "衍射", "穿刺", "猛击", "弱点特效", "超载", "中和", "被打倒", "克制", "引爆", "坚毅受创", "再起不能"]);   // 再起不能：决斗里伤害不会致死（#472），只是这个字
  function projectTape(tape, context = {}) {
    const units = arr(get(context.state, "units"));
    return arr(tape).slice(0, 256).flatMap(event => {
      if (!obj(event) || get(event, "type") !== "pop" || !id(get(event, "unitId"))) return [];
      const kind = get(event, "kind"); if (!["dmg", "heal", "break", "status", "fxword", "highboom", "carboom", "partner", "bullet", "proc"].includes(kind)) return [];
      const out = identifiers(event, { type: "pop", kind }, ["unitId", "targetId"]);
      if (kind === "proc") { const fx = get(event, "fx"); if (typeof fx !== "string" || !/^[a-zA-Z]{2,16}$/.test(fx)) return []; out.fx = fx; }
      enumField(event, out, "element", ["physical", "fire", "ice", "electric", "acid", "energy", "harmonic"]);
      const snap = arr(get(event, "snap")), subject = snap.find(u => get(u, "id") === out.unitId) || units.find(u => get(u, "id") === out.unitId);
      // Legacy damage/healing numbers can include the hidden life pool. Without
      // proof that the subject uses visible HP, omit numbers rather than infer.
      const visibleHp = subject && !get(subject, "upOnShp") && !get(subject, "dying") && !get(subject, "dead");
      if (kind === "break" || kind === "highboom" || visibleHp && ["dmg", "heal"].includes(kind)) {
        const n = number(get(event, "value")); if (n !== undefined) out.value = n;
      }
      // #340 第 15 条：打进坚毅的伤害（主机标了 grit，或者挨打的人还在起身中）照旧是一下伤害（演打中），
      // 只带标记 grit: true、不带数字：玩家画面写「坚毅受创」（hd2d-fx.js · numberOf、online-ui.js）
      if (kind === "dmg" && (get(event, "grit") === true || subject && get(subject, "upOnShp") && !get(subject, "dying") && !get(subject, "dead"))) { delete out.value; out.grit = true; }
      if (kind === "dmg" && get(event, "main") === true) out.main = true;   // 攻击动作本身的伤害（玩家画面在这几段补攻击演出的打击形状）
      if (get(event, "tag") === "boom") out.tag = "boom";   // 爆炸（高能自爆的余波、自爆小车的死亡引爆）：不算这次出手打到的目标
      if (popupWords.has(get(event, "text"))) out.text = get(event, "text");
      if (snap.length) out.snap = snap.map(projectUnit).filter(Boolean);
      return [out];
    });
  }
  /* 攻击演出（attack-fx.js · resolve 挑出来的招式）：只有两个单位 id、招式种类、属性和几个画法开关，没有任何数值。
   * 专属演出（attack-fx.js · SCRIPTS）再带上脚本名和几样现场数据：谁被刺入、伯妮尔 / EDC 的主人、推还是拉、打哪一区、隔几区；
   * 以及协助攻击要推镜头、格挡火花画在哪、拉斯缪尔的能量罐（累积能量百分比——玩家自己的角色仪表上本来就看得到） */
  const FX_KINDS = ["slash", "thrust", "smash", "claw", "bite", "shot", "spread", "bolt", "beam", "zap", "shard", "lob", "flame", "wave", "explode", "support", "hex"];
  const FX_FLAGS = ["melee", "area", "heavy", "flash", "flurry", "shield", "needle", "fur", "roar", "drill", "cane", "fist", "stream", "glitch", "big", "sweep"];
  const FX_ELEMENTS = ["physical", "fire", "ice", "electric", "acid", "energy", "harmonic"];
  const FX_SCRIPT = /^[a-z][a-z_]{1,31}$/;
  const clampInt = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(n)));
  function projectFx(fx) {
    if (!obj(fx)) return null;
    const actor = id(get(fx, "actor")), target = id(get(fx, "target")), move = get(fx, "move");
    if (!actor || !target || !obj(move) || !FX_KINDS.includes(get(move, "kind"))) return null;
    const out = { kind: get(move, "kind"), el: FX_ELEMENTS.includes(get(move, "el")) ? get(move, "el") : "physical" };
    FX_FLAGS.forEach(k => { if (get(move, k) === true) out[k] = true; });
    if (["katana", "knife", "rapier"].includes(get(move, "blade"))) out.blade = get(move, "blade");
    const hits = number(get(move, "hits")); if (hits !== undefined) out.hits = Math.max(1, Math.min(20, Math.floor(hits)));
    const res = { actor, target, move: out };
    const script = get(fx, "script"); if (typeof script === "string" && FX_SCRIPT.test(script)) res.script = script;
    const d = get(fx, "data");
    if (obj(d)) {
      const data = {};
      if (get(d, "ally") === true) data.ally = true;
      const dist = number(get(d, "dist")); if (dist !== undefined) data.dist = clampInt(dist, 0, 8);
      ["pierced", "owner"].forEach(k => { const v = id(get(d, k)); if (v) data[k] = v; });
      if (["push", "pull"].includes(get(d, "dir"))) data.dir = get(d, "dir");
      const zoneOf = number(get(d, "zoneOf")); if (zoneOf !== undefined) data.zoneOf = clampInt(zoneOf, 1, 9);
      if (get(d, "twice") === true) data.twice = true;
      if (Object.keys(data).length) res.data = data;
    }
    if (get(fx, "assist") === true) res.assist = true;
    if (get(fx, "parried") === true) res.parried = true;
    const blocker = id(get(fx, "blocker")); if (blocker) res.blocker = blocker;
    const tank = get(fx, "tank");
    if (obj(tank)) {
      const tid = id(get(tank, "id")), from = number(get(tank, "from")), to = number(get(tank, "to")), ms = number(get(tank, "ms"));
      if (tid && from !== undefined && to !== undefined) res.tank = { id: tid, from: clampInt(from, 0, 300), to: clampInt(to, 0, 300), ms: ms === undefined ? 900 : clampInt(ms, 200, 2000) };
    }
    return res;
  }
  function projectMessages(messages, context) {
    const { recipientId, gmId } = context;
    if (recipientId === gmId) return clone(arr(messages));
    return arr(messages).flatMap(message => {
      if (!obj(message)) return [];
      const from = id(get(message, "from")), to = id(get(message, "to"));
      if (!from || !to || !(from === gmId && (to === "all" || to === recipientId) || from === recipientId && to === gmId)) return [];
      const body = chatText(get(message, "text"), 2000); if (body === null) return [];
      const out = identifiers(message, { from, to, text: body }, ["id"]);
      copyFields(message, out, [], ["at"], []); out.private = to !== "all";
      return [out];
    }).slice(-300);
  }
  function projectLogs(logs) {
    // Only host-created semantic events are accepted. Never accept generic
    // text/notes/logPages or a caller-supplied "public:true" escape hatch.
    const templates = { action: "单位执行了行动", phase: "战斗阶段变化", gm: "主持人调整了战场", round: "回合开始", victory: "战斗胜利", defeat: "战斗结束", retreat: "队伍撤退", gmUpdate: "主持人调整了战场", spawn: "有单位加入战场", remove: "有单位离开战场", transfer: "主持人转交了角色", duel: "决斗" };
    const duelTeam = t => ({ "1队": "1 队", "2队": "2 队" })[t] || "";
    return arr(logs).slice(-100).flatMap(row => {
      if (!obj(row) || get(row, "silent") === true || !Object.hasOwn(templates, get(row, "kind"))) return [];
      const out = identifiers(row, { kind: get(row, "kind"), text: templates[get(row, "kind")] }, ["id", "actorId"]);
      copyFields(row, out, [], ["turnNo", "turn", "at", "seq"], []);
      if (out.kind === "round" && number(get(row, "turn")) > 0) out.text = `第 ${Math.floor(number(get(row, "turn")))} 回合开始`;
      if (out.kind === "action" || out.kind === "round") {
        const actor = text(get(row, "actorName"), 60), action = text(get(row, "actionName"), 60);
        if (actor && action) out.text = actor + " · " + action;
        // 结算摘要（online-game.js · hitSummary）：谁受了多少伤害 / 击破 / 治疗、弹出的状态字。只认数字和白名单里的弹字
        const hits = arr(get(row, "hits")).slice(0, 12).flatMap(h => {
          if (!obj(h)) return [];
          const name = text(get(h, "name"), 60); if (!name) return [];
          const parts = [];
          const n = k => { const v = number(get(h, k)); return v !== undefined && v > 0 ? Math.floor(v) : 0; };
          if (n("dmg")) parts.push(`${n("dmg")} 伤害`);
          if (n("brk")) parts.push(`击破 ${n("brk")}`);
          if (n("heal")) parts.push(`治疗 ${n("heal")}`);
          arr(get(h, "words")).forEach(w => { if (popupWords.has(w) && !parts.includes(w)) parts.push(w); });
          return parts.length ? [`${name}：${parts.join("，")}`] : [];
        });
        if (hits.length) out.text += " → " + hits.join("；");
      }
      // 决斗（#472）：开始、抛硬币谁先手、哪一队赢 / 平局——只认事件名和队伍 id，按模板写
      if (out.kind === "duel") {
        const ev = get(row, "event"), first = duelTeam(get(row, "first")), win = duelTeam(get(row, "winner"));
        if (ev === "start") out.text = "决斗开始";
        else if (ev === "toss" && first) out.text = `抛硬币：${first}先手（我方回合行动），${duelTeam(get(row, "first") === "1队" ? "2队" : "1队")}后手（敌人回合行动）`;
        else if (ev === "end") out.text = (get(row, "why") === "rounds" ? "回合上限到了，按剩余血量百分比：" : "") + (win ? `${win}获胜` : "平局");
        else return [];
      }
      // 按阵营分出的胜负（主持人分阵营，#490）：写哪几个阵营获胜（阵营名字），不是人人都「战斗胜利」
      if (out.kind === "victory") {
        const names = arr(get(row, "winners")).slice(0, 8).map(n => text(n, 16)).filter(Boolean);
        if (names.length) out.text = `${names.join("、")} 获胜`;
      }
      if (out.kind === "transfer") {
        const hero = text(get(row, "heroName"), 60), to = text(get(row, "toName"), 60);
        out.text = get(row, "toGM") === true ? `主持人收回了 ${hero || "一名角色"}` : `主持人把 ${hero || "一名角色"} 交给 ${to || "一名玩家"} 操作`;
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
    enumField(result, out, "outcome", ["win", "lose", "retreat", "draw"]);   // draw：决斗平局（#472）
    const grade = get(result, "grade");
    if (obj(grade)) { out.grade = copyFields(grade, {}, [], ["score", "par", "xpMult"], []); enumField(grade, out.grade, "grade", ["D", "C", "B", "A", "S", "SS", "SSS"]); }
    const drops = projectDrops(get(result, "drops")); if (drops) out.drops = drops;
    const duel = projectDuelResult(get(result, "duel")); if (duel) out.duel = duel;
    const teams = projectTeamScores(get(result, "teams")); if (teams.length) out.teams = teams;
    const winners = projectWinners(get(result, "winners")); if (winners.length) out.winners = winners;
    return out;
  }
  /** 按阵营分出的胜负（主持人分阵营，#445 / #490，app.js · pvpWinnersPublic）：获胜的玩家阵营，只有阵营 id / 名字 */
  function projectWinners(list) {
    return arr(list).slice(0, 8).flatMap(w => {
      if (!obj(w)) return [];
      const name = text(get(w, "name"), 16), fid = text(get(w, "id"), 16);
      return name && fid ? [{ id: fid, name }] : [];
    });
  }
  const DUEL_TEAMS = ["1队", "2队"];
  /** 决斗分出的胜负（#472，enemies.js · pvpDuelPublic 的 result）：哪一队赢 / 平局、怎么分出来的（全倒 / 回合上限），
   *  回合上限时两队的剩余血量百分比（只算血量层，不算坚毅生命）。决斗前的坚毅、谁再起不能这些不在这里 */
  function projectDuelResult(d) {
    const r = obj(d) ? get(d, "result") : null;
    if (!obj(r) || get(r, "over") !== true) return null;
    const out = { draw: get(r, "draw") === true };
    enumField(r, out, "winner", DUEL_TEAMS);
    enumField(r, out, "why", ["wipe", "rounds"]);
    const pct = get(r, "pct");
    if (obj(pct)) {
      const p = {};
      DUEL_TEAMS.forEach(k => { const v = number(get(pct, k)); if (v !== undefined) p[k] = Math.max(0, Math.min(1, v)); });
      if (Object.keys(p).length) out.pct = p;
    }
    const rounds = number(get(d, "rounds")); if (Number.isInteger(rounds) && rounds >= 1 && rounds <= 99) out.rounds = rounds;
    return out;
  }
  const TEAM_SCORE_PARTS = ["dmg", "heal", "brk", "stagger", "block", "reduce", "blockSave", "kill", "action"];
  /** 每队单独计分（#472，app.js · pvpTeamScores）：阵营 id / 名字、总分、各项分数（只有这几项原本的分数）。都是给所有人看的；没有坚毅数值 */
  function projectTeamScores(list) {
    return arr(list).slice(0, 8).flatMap(t => {
      if (!obj(t)) return [];
      const name = text(get(t, "name"), 16), fid = text(get(t, "id"), 16), total = number(get(t, "total"));
      if (!name || !fid || total === undefined) return [];
      const parts = {};
      const src = get(t, "parts");
      TEAM_SCORE_PARTS.forEach(k => { const v = number(get(src, k)); if (v !== undefined && v > 0) parts[k] = Math.round(v); });
      return [{ id: fid, name, total: Math.round(total), parts }];
    });
  }
  /** 决斗的申请 / 准备画面（#472，hotseat-game.js · duelView）：状态、谁申请的、选项（允许起身、限定回合数）、
   *  每名能参加的角色（kit、名字、归谁操控、选了哪一队）。没有血量、坚毅 */
  function projectDuel(d) {
    if (!obj(d)) return null;
    const out = {};
    enumField(d, out, "status", ["asked", "prep"]);
    if (!out.status) return null;
    identifiers(d, out, ["id", "by"]);
    const byName = text(get(d, "byName"), 40); if (byName) out.byName = byName;
    const at = number(get(d, "at")); if (at !== undefined) out.at = at;
    out.stand = get(d, "stand") !== false;
    const rounds = number(get(d, "rounds")); out.rounds = Number.isInteger(rounds) && rounds >= 1 && rounds <= 99 ? rounds : null;
    out.heroes = arr(get(d, "heroes")).slice(0, 12).flatMap(h => {
      if (!obj(h)) return [];
      const row = identifiers(h, {}, ["kit", "owner"]), name = text(get(h, "name"), 40);
      if (!row.kit || !name) return [];
      row.name = name;
      enumField(h, row, "team", DUEL_TEAMS);
      return [row];
    });
    return out;
  }
  /* 赌场（#487）：hotseat-game.js · casinoView 按收件人造好（trpg.js · trpgCasinoPacket：自己角色的钱包、自己那一方的牌局；
   * 主持人另有自己坐庄的那几桌——庄家那一方），这里只按白名单一项项拷。牌局照 counter-cards.js · view 的字段拷：
   * 对方的手牌、暗出 / 暗弃的牌、庄家偷看到的天气本来就只在那一方的 view 里；记录只拷文字。没登记的字段一律丢掉 */
  // tables：四种玩法各三张赌场桌（#526 加了猜大猜小）还有富余
  const CASINO_CAP = { tables: 16, open: 20, mine: 6, dealing: 12, seated: 24, hand: 12, history: 8, log: 60, results: 8, legal: 40, gone: 10 };
  const CC_SIDES = ["dealer", "player"];
  const sideOf = v => (CC_SIDES.includes(v) ? v : null);
  const nullableNum = v => (v === null ? null : number(v));
  function projectSidePair(o, fn, sides = CC_SIDES) { if (!obj(o)) return null; const out = {}; sides.forEach(k => { const v = fn(get(o, k)); if (v !== undefined) out[k] = v; }); return out; }
  /** 牌局按玩法投影（#526）：High Flux 的对局没有 mode；Flux Duel 是 "duel"、Flux Hold'em 是 "holdem"、猜大猜小是 "guess" */
  function projectCasinoGame(g) {
    if (!obj(g)) return null;
    if (get(g, "mode") === "duel") return projectDuelGame(g);
    if (get(g, "mode") === "holdem") return projectHoldemGame(g);
    if (get(g, "mode") === "guess") return projectGuessGame(g);
    return projectFluxHigh(g);
  }
  /** 牌局的记录（各玩法 view 里已经只剩这一方看得到的）：文字、第几轮，另带结算前的过渡要用的几项——
   *  t（哪种记录）、by（谁做的）、op、amount（筹码数）、street；公开的那几条另带翻开的天气 / 层牌（weather / layer）、洗回几张（count）、
   *  结算那一条的轮数（res.r）。只给自己看的（to = 自己那一方）只带文字，牌名都不另拷。
   *  logFrom：前面丢掉了几条（记录只发最后 CASINO_CAP.log 条；界面按它对齐两包之间新加的记录） */
  function projectCasinoLog(list, sides, out) {
    const all = arr(list), from = Math.max(0, all.length - CASINO_CAP.log);
    out.logFrom = from;
    out.log = all.slice(from).flatMap(e => {
      const t = obj(e) && text(get(e, "text"), 160); if (!t) return [];
      const d = { r: number(get(e, "r")) || 0, text: t };
      const kind = id(get(e, "t")); if (kind) d.t = kind;
      const by = get(e, "by"); if (sides.includes(by)) d.by = by;
      const to = get(e, "to");
      // 只给某一方看的：只留给这个收件人那一方的（规则层的 view 已经滤过，这里再查一次，拿错了也漏不出别人的牌）
      if (to != null) { if (to !== out.side) return []; d.mine = true; d.to = to; return [d]; }
      d.mine = false;
      const op = id(get(e, "op")); if (op) d.op = op;
      for (const k of ["amount", "street", "count"]) { const v = number(get(e, k)); if (v !== undefined) d[k] = v; }
      for (const k of ["weather", "layer", "element"]) { const v = id(get(e, k)); if (v) d[k] = v; }   // element：庄家叫的那张（#503，公开）
      const res = get(e, "res"); if (obj(res) && number(get(res, "r")) !== undefined) d.res = { r: get(res, "r") };
      return [d];
    });
  }
  /** 一方的筹码这几项（各玩法都一样，都是公开的）：筹码（赌场那一方无限 = null）、开局、本轮下注、滚存、借了多少 / 要还多少 */
  function projectPurseSide(s) {
    const d = selected(s, ["infinite", "bet", "pot", "st", "loan", "owe"]);
    d.chips = nullableNum(get(s, "chips")); if (d.chips === undefined) d.chips = null;
    d.start = nullableNum(get(s, "start")); if (d.start === undefined) d.start = null;
    return d;
  }
  /** 下注回合里能做的（各玩法的 legal）：类型、额度，另带牌 / 位置（暗出、偷看后放哪） */
  function projectLegal(list) {
    return arr(list).slice(0, CASINO_CAP.legal).flatMap(o => {
      if (!obj(o) || !id(get(o, "type"))) return [];
      const d = Object.assign({ type: get(o, "type") }, selected(o, ["min", "max", "step", "need", "amount", "round"]));
      for (const k of ["op", "where", "card", "layer", "element"]) { const v = id(get(o, k)); if (v) d[k] = v; }
      return [d];
    });
  }
  /* Flux Duel（#526，flux-duel.js · view）：两方 a / b。对方的层牌、元素牌只有张数，暗出了没有只写一句 played；
   * 这一轮背面朝上的天气只写有没有（facedown），天气堆只有张数（顺序不发）；unseen 是还没公开过的天气（集合，不是顺序）。
   * 不亮牌时结算里没有牌；亮牌开关打开时（DUEL_CONFIG.reveal）结算的 shown 是两边公开的牌和得分 */
  const DUEL_SIDES = ["a", "b"];
  const duelSide = v => (DUEL_SIDES.includes(v) ? v : null);
  function projectDuelGame(g) {
    const out = copyFields(g, { mode: "duel" }, ["stage"], ["round", "rounds", "deckCount", "buried", "ante", "minBet", "maxRaises", "pot"], ["over", "myTurn", "facedown", "allIn", "reveal"]);
    out.side = duelSide(get(g, "side")); out.opponent = duelSide(get(g, "opponent"));
    if (!out.side || !out.opponent || out.side === out.opponent) return null;
    out.lead = duelSide(get(g, "lead"));
    const names = get(g, "names"); out.names = {};
    DUEL_SIDES.forEach(k => { const t = text(get(names, k), 40); if (t) out.names[k] = t; });
    out.waiting = arr(get(g, "waiting")).filter(s => DUEL_SIDES.includes(s));
    out.weather = id(get(g, "weather"));
    out.gone = arr(get(g, "gone")).map(id).filter(Boolean).slice(0, CASINO_CAP.gone);
    out.unseen = arr(get(g, "unseen")).map(id).filter(Boolean).slice(0, CASINO_CAP.gone);
    const loan = get(g, "loan"); out.loan = obj(loan) ? selected(loan, ["unit", "repay"]) : null;
    const ask = get(g, "loanAsk"); out.loanAsk = Array.isArray(ask) ? ask.filter(s => DUEL_SIDES.includes(s)) : null;
    const cards = (list) => arr(list).map(id).filter(Boolean).slice(0, CASINO_CAP.hand);
    const me = get(g, "me"), opp = get(g, "opp");
    if (!obj(me) || !obj(opp)) return null;
    out.me = Object.assign(projectPurseSide(me), { layers: cards(get(me, "layers")), elements: cards(get(me, "elements")), layer: id(get(me, "layer")), element: id(get(me, "element")),
      history: arr(get(me, "history")).slice(0, CASINO_CAP.history).flatMap(h => obj(h) ? [{ r: number(get(h, "r")) || 0, layer: id(get(h, "layer")), element: id(get(h, "element")) }] : []) });
    out.opp = Object.assign(projectPurseSide(opp), selected(opp, ["layerCount", "elementCount", "played"]));
    const b = get(g, "betting");
    if (obj(b)) {
      out.betting = Object.assign(selected(b, ["street", "raises", "toCall"]), { toAct: duelSide(get(b, "toAct")) });
      const w = get(b, "window");
      out.betting.window = obj(w) ? Object.assign(selected(w, ["n", "sec", "passed"]), { by: duelSide(get(w, "by")) }) : null;
    } else out.betting = null;
    const pair = (o, fn) => projectSidePair(o, fn, DUEL_SIDES);
    out.results = arr(get(g, "results")).slice(-CASINO_CAP.results).flatMap(r => {
      if (!obj(r)) return [];
      const d = copyFields(r, {}, [], ["r", "tier", "extra", "pot"], ["allIn", "refund", "rollover", "split", "buried"]);
      d.weather = id(get(r, "weather"));
      enumField(r, d, "outcome", ["a", "b", "tie", "fold"]);
      d.winner = duelSide(get(r, "winner")); const folded = duelSide(get(r, "folded")); if (folded) d.folded = folded;
      d.bets = pair(get(r, "bets"), number); d.delta = pair(get(r, "delta"), number); d.chips = pair(get(r, "chips"), nullableNum);
      // 亮牌（DUEL_CONFIG.reveal 打开时才有）：两边结算时公开的牌和得分
      const shown = get(r, "shown");
      if (obj(shown)) d.shown = pair(shown, s => (obj(s) ? Object.assign({ layer: id(get(s, "layer")), element: id(get(s, "element")) }, selected(s, ["score"])) : undefined));
      return [d];
    });
    projectCasinoLog(get(g, "log"), DUEL_SIDES, out);
    out.legal = projectLegal(get(g, "legal"));
    const f = get(g, "final");
    out.final = obj(f) ? { rounds: number(get(f, "rounds")) || 0, winner: duelSide(get(f, "winner")), chips: pair(get(f, "chips"), nullableNum), net: pair(get(f, "net"), nullableNum),
      held: pair(get(f, "held"), nullableNum), loans: pair(get(f, "loans"), l => (obj(l) ? selected(l, ["loan", "owe"]) : undefined)), busted: arr(get(f, "busted")).filter(s => DUEL_SIDES.includes(s)) } : null;
    return out;
  }
  /* Flux Hold'em（#526，flux-holdem.js · view）：座位 p1…p4。别人只有筹码、押了多少、弃没弃牌、手牌张数、盖了没有（played 只是有没有盖）；
   * 自己的手牌、盖下的那张只在自己的包里；牌堆（元素 / 层牌 / 天气）只有张数，顺序不发；庄家偷看的那张只给庄家。
   * 亮牌的结果（results[i].shown：比到最后的人的牌和得分）是公开的；每轮结算时亮出的每人这一轮盖下的牌（results[i].played，
   * HOLDEM_CONFIG.revealAll，#530：弃牌的、其他人都弃牌直接赢的那一轮也亮）结算后也是公开的——结算之前别人盖下的牌照旧不放。
   * 累积奖池（#534）：jackpot 数目、每人这一轮交了多少盲注（blind）、每轮结算的 jackpot（归谁 / 同分留到下一轮 / 加赛 / 平分）公开；
   * 最后一轮同分的加赛（playoff）只放第几次、谁参加、谁已经盖了——盖的是哪张亮牌前不放（自己的在 me.card），加赛的结算（outcome "playoff"）亮牌后公开 */
  const HOLDEM_SEAT = /^p[1-4]$/;
  const holdemId = v => (typeof v === "string" && HOLDEM_SEAT.test(v) ? v : null);
  const holdemIds = list => arr(list).map(holdemId).filter(Boolean).slice(0, 4);
  function holdemMap(o, fn, ids) { if (!obj(o)) return null; const out = {}; ids.forEach(k => { const v = fn(get(o, k)); if (v !== undefined) out[k] = v; }); return out; }
  /** 一轮结算里的累积奖池（#534，flux-holdem.js · jackpotRound）：数目、这一轮交进去的盲注、归谁、同分的、谁分了多少、留到下一轮 / 加赛 / 平分（手牌用光的人） */
  function projectHoldemJackpot(j, ids) {
    if (!obj(j)) return null;
    const d = selected(j, ["amount", "added", "kept", "playoff", "split"]);
    d.winner = holdemId(get(j, "winner")); d.tied = holdemIds(get(j, "tied")); d.shares = holdemMap(get(j, "shares"), number, ids) || {};
    const empty = holdemIds(get(j, "empty")); if (empty.length) d.empty = empty;
    return d;
  }
  function projectHoldemGame(g) {
    const out = copyFields(g, { mode: "holdem" }, ["stage"], ["round", "rounds", "layerDeckCount", "deckCount", "elementDeckCount", "minBet", "maxRaises", "pot", "jackpot"], ["over", "myTurn"]);
    out.side = holdemId(get(g, "side"));
    out.order = holdemIds(get(g, "order"));
    if (!out.side || !out.order.includes(out.side)) return null;
    const ids = out.order;
    for (const k of ["dealer", "sb", "bb"]) out[k] = holdemId(get(g, k));
    out.waiting = holdemIds(get(g, "waiting"));
    const cards = (list) => arr(list).map(id).filter(Boolean).slice(0, 12);
    out.layers = cards(get(g, "layers")); out.usedLayers = cards(get(g, "usedLayers"));
    out.weathers = cards(get(g, "weathers")); out.discards = cards(get(g, "discards"));
    out.blinds = arr(get(g, "blinds")).map(number).filter(n => n !== undefined).slice(0, 2);
    const loan = get(g, "loan"); out.loan = obj(loan) ? selected(loan, ["unit", "repay"]) : null;
    const ask = get(g, "loanAsk"); out.loanAsk = Array.isArray(ask) ? holdemIds(ask) : null;
    const carry = get(g, "carry");
    out.carry = obj(carry) ? Object.assign(selected(carry, ["amount", "r"]), { from: holdemIds(get(carry, "from")) }) : null;
    // 加赛（#534）：第几次、谁参加、谁已经盖了（盖的是哪张不放）
    const po = get(g, "playoff");
    out.playoff = obj(po) && number(get(po, "n")) !== undefined ? { n: get(po, "n"), ids: holdemIds(get(po, "ids")), played: holdemIds(get(po, "played")) } : null;
    const seat = (s) => {
      if (!obj(s) || !holdemId(get(s, "id"))) return null;
      const d = Object.assign({ id: get(s, "id") }, selected(s, ["chips", "start", "bet", "st", "blind", "loan", "owe", "handCount", "folded", "allIn", "out", "played", "dealer", "sb", "bb"]));
      const name = text(get(s, "name"), 40); if (name) d.name = name;
      return d;
    };
    out.seats = arr(get(g, "seats")).slice(0, 4).map(seat).filter(Boolean);
    const me = seat(get(g, "me"));
    if (!me || me.id !== out.side) return null;
    const m = get(g, "me");
    out.me = Object.assign(me, { hand: cards(get(m, "hand")), card: id(get(m, "card")),
      history: arr(get(m, "history")).slice(0, CASINO_CAP.history).flatMap(h => obj(h) ? [{ r: number(get(h, "r")) || 0, card: id(get(h, "card")) }] : []) });
    const b = get(g, "betting");
    if (obj(b)) {
      out.betting = Object.assign(selected(b, ["street", "raises", "cur", "minRaise", "toCall"]), { toAct: holdemId(get(b, "toAct")) });
      const w = get(b, "window");
      out.betting.window = obj(w) ? Object.assign(selected(w, ["n", "sec", "passed"]), { by: holdemId(get(w, "by")) }) : null;
    } else out.betting = null;
    out.results = arr(get(g, "results")).slice(-CASINO_CAP.results).flatMap(r => {
      if (!obj(r)) return [];
      // n：第几次加赛（outcome "playoff"，#534）
      const d = copyFields(r, {}, [], ["r", "n", "pot", "carryIn", "carry", "phaseAt", "cap"], ["split", "allIn"]);
      enumField(r, d, "outcome", ["showdown", "fold", "playoff"]);
      d.dealer = holdemId(get(r, "dealer"));
      d.layers = cards(get(r, "layers")); d.weathers = cards(get(r, "weathers"));
      d.winners = holdemIds(get(r, "winners")); d.folded = holdemIds(get(r, "folded"));
      d.bets = holdemMap(get(r, "bets"), number, ids); d.delta = holdemMap(get(r, "delta"), number, ids); d.chips = holdemMap(get(r, "chips"), number, ids);
      // 累积奖池（#534）：每人交的盲注、这一轮的累积奖池归谁；加赛的那一次另有参加的人（ids）
      const blinds = holdemMap(get(r, "blinds"), number, ids); if (blinds) d.blinds = blinds;
      const jp = projectHoldemJackpot(get(r, "jackpot"), ids); if (jp) d.jackpot = jp;
      if (Array.isArray(get(r, "ids"))) d.ids = holdemIds(get(r, "ids"));
      // 亮牌：比到最后的人（没弃牌）的牌和得分——公开的
      d.shown = holdemMap(get(r, "shown"), s => (obj(s) && id(get(s, "card")) ? Object.assign({ card: get(s, "card") }, selected(s, ["score"])) : undefined), ids) || {};
      // 每人这一轮盖下的牌（revealAll 打开时规则层结算才写，#530）：公开的；没有这一项（revealAll 关着）就不放，牌桌照旧写「不亮牌」
      const played = holdemMap(get(r, "played"), c => id(c) || undefined, ids); if (played) d.played = played;
      d.pots = arr(get(r, "pots")).slice(0, 4).flatMap(p => obj(p) ? [Object.assign(selected(p, ["amount", "carried"]), { eligible: holdemIds(get(p, "eligible")), winners: holdemIds(get(p, "winners")),
        tied: holdemIds(get(p, "tied")), shares: holdemMap(get(p, "shares"), number, ids) || {} })] : []);
      return [d];
    });
    projectCasinoLog(get(g, "log"), ids, out);
    out.legal = projectLegal(get(g, "legal"));
    const f = get(g, "final");
    out.final = obj(f) ? { rounds: number(get(f, "rounds")) || 0, winners: holdemIds(get(f, "winners")), chips: holdemMap(get(f, "chips"), number, ids), held: holdemMap(get(f, "held"), number, ids),
      net: holdemMap(get(f, "net"), number, ids), loans: holdemMap(get(f, "loans"), l => (obj(l) ? selected(l, ["loan", "owe"]) : undefined), ids), out: holdemIds(get(f, "out")) } : null;
    // 庄家偷看的那张：只有这一方是这一轮的庄家才放
    const p = get(g, "peek");
    if (obj(p) && out.side === out.dealer) out.peek = { card: id(get(p, "card")), where: id(get(p, "where")) };
    return out;
  }
  /** High Flux（counter-cards.js · view）的对局 */
  function projectFluxHigh(g) {
    const out = copyFields(g, {}, ["stage"], ["round", "rounds", "deckCount", "minBet", "ante", "maxRaises", "pot"], ["over", "myTurn", "allIn", "normalUsed"]);
    out.side = sideOf(get(g, "side")); out.opponent = sideOf(get(g, "opponent"));
    if (!out.side) return null;
    out.weather = id(get(g, "weather")); out.revealed = id(get(g, "revealed"));
    out.waiting = arr(get(g, "waiting")).filter(s => CC_SIDES.includes(s));
    out.gone = arr(get(g, "gone")).map(id).filter(Boolean).slice(0, CASINO_CAP.gone);
    const loan = get(g, "loan"); out.loan = obj(loan) ? selected(loan, ["unit", "repay"]) : null;
    const ask = get(g, "loanAsk"); out.loanAsk = Array.isArray(ask) ? ask.filter(s => CC_SIDES.includes(s)) : null;
    const seat = (s, mine) => {
      if (!obj(s)) return null;
      const d = selected(s, ["infinite", "bet", "pot", "st", "loan", "owe"]);
      d.chips = nullableNum(get(s, "chips")); if (d.chips === undefined) d.chips = null;
      d.start = nullableNum(get(s, "start")); if (d.start === undefined) d.start = null;
      if (mine) {
        d.hand = arr(get(s, "hand")).map(id).filter(Boolean).slice(0, CASINO_CAP.hand);
        d.card = id(get(s, "card"));
        d.history = arr(get(s, "history")).slice(0, CASINO_CAP.history).flatMap(h => obj(h) && id(get(h, "card")) ? [{ r: number(get(h, "r")) || 0, card: get(h, "card") }] : []);
        d.discards = arr(get(s, "discards")).slice(0, CASINO_CAP.history).flatMap(h => obj(h) && id(get(h, "card")) ? [{ r: number(get(h, "r")) || 0, card: get(h, "card"), why: id(get(h, "why")) }] : []);
        const spare = number(get(s, "spare")); if (spare !== undefined) d.spare = spare;
      } else Object.assign(d, selected(s, ["handCount", "discardCount", "played"]));
      return d;
    };
    out.me = seat(get(g, "me"), true); out.opp = seat(get(g, "opp"), false);
    const b = get(g, "betting");
    out.betting = obj(b) ? Object.assign(selected(b, ["street", "raises", "toCall"]), { toAct: sideOf(get(b, "toAct")) }) : null;
    // 跟注后的追加窗口（#496）：第几个、谁跟的注、几秒、自己放弃追加了没有（对方放没放弃不发）——牌桌按它倒计时（#526）
    const w = obj(b) ? get(b, "window") : null;
    if (out.betting) out.betting.window = obj(w) ? Object.assign(selected(w, ["n", "sec", "passed"]), { by: sideOf(get(w, "by")) }) : null;
    out.results = arr(get(g, "results")).slice(-CASINO_CAP.results).flatMap(r => {
      if (!obj(r)) return [];
      const d = copyFields(r, {}, [], ["r", "tier", "extra", "pot"], ["allIn", "refund", "rollover"]);
      d.weather = id(get(r, "weather"));
      enumField(r, d, "outcome", ["dealer", "player", "tie", "fold"]);
      d.winner = sideOf(get(r, "winner")); const folded = sideOf(get(r, "folded")); if (folded) d.folded = folded;
      d.bets = projectSidePair(get(r, "bets"), number); d.delta = projectSidePair(get(r, "delta"), number); d.chips = projectSidePair(get(r, "chips"), nullableNum);
      // 叫牌的一轮（#503）：叫了哪张、叫对没有（公开的）
      const call = get(r, "call"); if (obj(call) && id(get(call, "element"))) d.call = { element: get(call, "element"), correct: get(call, "correct") === true };
      return [d];
    });
    // 庄家叫牌（#503）：能不能叫、叫过没有、叫了哪张、叫对没有是公开的；叫错时亮出的层牌（revealed）只发给玩家那一方
    const dc = get(g, "dealerCall");
    if (obj(dc)) {
      out.dealerCall = copyFields(dc, {}, [], [], ["enabled", "used", "available"]);
      out.dealerCall.round = nullableNum(get(dc, "round")); if (out.dealerCall.round === undefined) out.dealerCall.round = null;
      out.dealerCall.element = id(get(dc, "element"));
      const ok = get(dc, "correct"); out.dealerCall.correct = typeof ok === "boolean" ? ok : null;
      out.dealerCall.revealed = out.side === "player" ? arr(get(dc, "revealed")).slice(0, CASINO_CAP.history).flatMap(x => obj(x) && id(get(x, "layer")) ? [{ r: number(get(x, "r")) || 0, layer: get(x, "layer") }] : []) : [];
    }
    out.dealerCallUsed = get(g, "dealerCallUsed") === true;
    // 记录：同 Flux 两种牌桌（结算前的过渡要用 t / by / op……，#526；只给自己看的只带文字）
    projectCasinoLog(get(g, "log"), CC_SIDES, out);
    out.legal = projectLegal(get(g, "legal"));
    const f = get(g, "final");
    out.final = obj(f) ? { rounds: number(get(f, "rounds")) || 0, winner: sideOf(get(f, "winner")), chips: projectSidePair(get(f, "chips"), nullableNum), net: projectSidePair(get(f, "net"), number),
      loans: projectSidePair(get(f, "loans"), l => (obj(l) ? selected(l, ["loan", "owe"]) : undefined)), busted: arr(get(f, "busted")).filter(s => CC_SIDES.includes(s)) } : null;
    // 庄家那一方才有：偷看到的堆顶、知道位置的堆顶 / 堆底（counter-cards.js · view 只给庄家）
    if (out.side === "dealer") {
      const p = get(g, "peek"); out.peek = obj(p) ? { card: id(get(p, "card")), where: id(get(p, "where")) } : null;
      out.deckTop = id(get(g, "deckTop")); out.deckBottom = id(get(g, "deckBottom"));
      // 看过的天气（#502，偷看按顺序往下看）：堆顶往下连续看过的几张、压到牌堆底的几张、还有几张没看过
      const ds = get(g, "deckSeen");
      out.deckSeen = obj(ds) ? { top: arr(get(ds, "top")).map(id).filter(Boolean).slice(0, CASINO_CAP.hand), bottom: arr(get(ds, "bottom")).map(id).filter(Boolean).slice(0, CASINO_CAP.hand), unseen: number(get(ds, "unseen")) || 0 } : null;
    }
    return out;
  }
  /* 猜大猜小（#526，counter-cards-guess.js · view）：一手只有这一个人（赌场桌、黑市赌命桌都是各坐各的，没有 others）。
   * 没翻开的牌（secret）、种子本来就不在 view 里；翻开的牌、赔率表、自己的押注（下注那一刻锁定的赔率）、记录是公开的。
   * 赌命桌（table.life）押的是坚毅生命：包里不放任何和坚毅有关的数字——每格押上的固定点数（slips / legal 的 stake）、
   * 每轮的固定代价（minBet）也不放，牌桌照规则配置（GUESS_CONFIG.life.stake，规则文字）写；押输了一共几点（due / lifeBill）view 里本来就没有，
   * 坚毅剩多少规则层根本不知道。结算只有押中没有（win）、奖品（prize：奎支、材料）、坚毅受没受创（hurt）。
   * 记录里带「坚毅」两个字的那几条（开局说明、押注、押输了的结算）文字过不了 text()：只发哪一种（t）、第几轮、谁，牌桌按公开的押注自己写 */
  const GUESS_CARDS = ["element", "weather", "layer"];
  const guessResult = v => (Number.isInteger(v) && Math.abs(v) <= 9 ? v : undefined);
  function projectGuessLog(list, out, life) {
    const all = arr(list), from = Math.max(0, all.length - CASINO_CAP.log);
    out.logFrom = from;
    out.log = all.slice(from).flatMap(e => {
      if (!obj(e) || get(e, "to") != null) return [];   // 只给某一方看的记录猜大猜小没有：有也不放
      const d = { r: number(get(e, "r")) || 0 };
      const kind = id(get(e, "t")); if (kind) d.t = kind;
      const by = id(get(e, "by")); if (by) d.by = by;
      // 结算前的过渡要用：翻开的是哪一张（card）、是什么（value）；结果（score）；押筹码的桌子从钱包补了几枚（amount）
      if (kind === "reveal") { if (GUESS_CARDS.includes(get(e, "card"))) d.card = get(e, "card"); const v = id(get(e, "value")); if (v) d.value = v; }
      if (kind === "result") { const s = guessResult(get(e, "score")); if (s !== undefined) d.score = s; }
      if (kind === "topUp" && !life) { const n = number(get(e, "amount")); if (n !== undefined) d.amount = n; }
      const t = text(get(e, "text"), 160);
      if (t) d.text = t;
      else if (!(life && ["open", "bet", "pay"].includes(kind))) return [];
      return [d];
    });
  }
  function projectGuessGame(g) {
    const t = get(g, "table"), me = get(g, "me");
    if (!obj(t) || !obj(me) || !id(get(me, "id"))) return null;
    const life = get(t, "life") === true;
    const out = copyFields(g, { mode: "guess" }, ["stage"], ["round", "rounds"], ["over", "myTurn"]);
    out.table = Object.assign(identifiers(t, copyFields(t, {}, ["name", "dealer"], life ? [] : ["entry"]), ["id"]), { life });
    if (!life) {
      out.table.minBet = arr(get(t, "minBet")).map(number).filter(n => n !== undefined).slice(0, 3);
      const mb = number(get(g, "minBet")); if (mb !== undefined) out.minBet = mb;
    }
    const shown = get(g, "shown");
    out.shown = {}; GUESS_CARDS.forEach(k => { out.shown[k] = id(get(shown, k)); });
    const b = get(g, "board");
    out.board = { N: number(get(b, "N")) || 0, cells: arr(get(b, "cells")).slice(0, 9).flatMap(c => {
      const r = obj(c) ? guessResult(get(c, "result")) : undefined;
      if (r === undefined) return [];
      const odds = number(get(c, "odds"));
      return [{ result: r, k: number(get(c, "k")) || 0, odds: odds === undefined ? null : odds, open: get(c, "open") === true }];
    }) };
    out.waiting = arr(get(g, "waiting")).map(id).filter(Boolean).slice(0, 8);
    // 能做的：押注（开盘的格子、锁定前的赔率；押筹码的另有每格至少 / 一共最多押多少）、不押
    const cells = list => arr(list).slice(0, 9).flatMap(c => { const r = obj(c) ? guessResult(get(c, "result")) : undefined; return r === undefined ? [] : [Object.assign({ result: r }, selected(c, ["odds", "k"]))]; });
    out.legal = arr(get(g, "legal")).slice(0, 4).flatMap(o => {
      if (!obj(o)) return [];
      if (get(o, "type") === "pass") return [{ type: "pass" }];
      if (get(o, "type") !== "bet") return [];
      return [Object.assign({ type: "bet", cells: cells(get(o, "cells")) }, selected(o, life ? ["round"] : ["round", "min", "max"]))];
    });
    const acted = get(me, "acted"), act = {};
    [1, 2, 3].forEach(r => { const v = get(acted, String(r)); if (v === "bet" || v === "pass") act[r] = v; });
    const slip = s => {
      const r = obj(s) ? guessResult(get(s, "result")) : undefined;
      if (r === undefined) return [];
      const d = Object.assign({ result: r }, selected(s, life ? ["round", "odds", "win"] : ["round", "odds", "amount", "win", "pay"]));
      return [d];
    };
    out.me = { id: get(me, "id"), name: text(get(me, "name"), 40) || "", in: get(me, "in") !== false, acted: act, slips: arr(get(me, "slips")).slice(0, 24).flatMap(slip) };
    if (life) {
      const p = get(me, "prize");
      if (obj(p)) out.me.prize = { kuizhi: number(get(p, "kuizhi")) || 0, items: arr(get(p, "items")).slice(0, 8).flatMap(x => obj(x) && id(get(x, "id")) && number(get(x, "n")) > 0 ? [{ id: get(x, "id"), n: get(x, "n") }] : []) };
      if (typeof get(me, "hurt") === "boolean") out.me.hurt = get(me, "hurt");
    } else Object.assign(out.me, selected(me, ["chips", "paid", "won", "net", "topUp"]));
    const res = get(g, "result"), score = obj(res) ? guessResult(get(res, "score")) : undefined;
    out.result = score === undefined ? null : Object.assign({ score }, identifiers(res, {}, GUESS_CARDS));
    projectGuessLog(get(g, "log"), out, life);
    return out;
  }
  /** 坐着的那一局的桌子信息（公开的：哪种桌子、押什么、对手名字）+ 这一方的牌局。
   *  buyIn = 总买入、topUp = 牌局里桌上不够时从钱包补了几枚（#520）；mode = 哪种玩法（#526） */
  const CASINO_MODES = ["highflux", "duel", "holdem", "guess"];
  const SEAT_SIDES = [...CC_SIDES, ...DUEL_SIDES];
  // Flux Hold'em 多人桌（kind "holdem"）另有：size 几人桌、host 自己是不是开桌的人、auto 托管中、started 开局了没有；
  // 黑市赌命桌（kind "life"，只在主持人的 seated 里）：谁坐着、第几轮（#526）
  function projectCasinoSeat(s, withGame) {
    if (!obj(s)) return null;
    const out = identifiers(s, copyFields(s, {}, ["tableName", "opponent"], ["rate", "buyIn", "fee", "start", "round", "topUp", "size"], ["over", "host", "auto", "started"]), ["table", "level"]);
    enumField(s, out, "kind", ["ai", "gm", "pvp", "holdem", "life"]); enumField(s, out, "stakeKind", ["chips", "kuizhi"]); enumField(s, out, "mode", CASINO_MODES);
    if (!out.kind) return null;
    // 人坐哪一方：High Flux 庄家 / 玩家、Flux Duel 甲 / 乙、Flux Hold'em 座位；猜大猜小是配置里的座位 id（GUESS_CONFIG.casino.seat）
    const side = get(s, "side"); if (SEAT_SIDES.includes(side) || holdemId(side) || (out.mode === "guess" && id(side))) out.side = side;
    if (withGame) out.game = projectCasinoGame(get(s, "game"));
    return out;
  }
  /** Flux Hold'em 多人桌的大厅（#526）：桌子的配置、每个座位坐着谁（玩家 / 主持人 / AI / 空着）、开没开局；没有牌 */
  function projectHoldemTables(list) {
    return arr(list).slice(0, CASINO_CAP.open).flatMap(t => {
      if (!obj(t) || !id(get(t, "id"))) return [];
      const d = identifiers(t, copyFields(t, {}, ["name", "host"], ["rate", "buyIn", "fee", "size", "round"], ["started", "over"]), ["id", "table"]);
      enumField(t, d, "difficulty", ["easy", "normal", "hard"]);
      d.seats = arr(get(t, "seats")).slice(0, 4).flatMap(s => {
        if (!obj(s) || !holdemId(get(s, "id"))) return [];
        const row = { id: get(s, "id"), name: text(get(s, "name"), 40), auto: get(s, "auto") === true };
        enumField(s, row, "kind", ["player", "gm", "ai", "empty"]);
        return [row];
      });
      return [d];
    });
  }
  function projectCasino(c) {
    if (!obj(c)) return null;
    const cfg = get(c, "config");
    const out = { config: obj(cfg) ? selected(cfg, ["buy", "sell", "face", "gift"]) : {} };
    // 桌子：game = 哪种玩法、gameName 玩法名、short 配置里的桌名、gm = 能不能由主持人坐庄（#526）；猜大猜小另有每轮每格最低注 minBet
    out.tables = arr(get(c, "tables")).slice(0, CASINO_CAP.tables).flatMap(t => {
      if (!obj(t) || !id(get(t, "id"))) return [];
      const d = identifiers(t, copyFields(t, {}, ["name", "gameName", "short"], ["rate", "minBuyIn", "entryFee", "minBuyInChips", "entryFeeChips", "perChip", "players"], ["gm"]), ["id"]);
      enumField(t, d, "difficulty", ["easy", "normal", "hard"]);
      enumField(t, d, "game", CASINO_MODES);
      if (d.game === "guess") d.minBet = arr(get(t, "minBet")).map(number).filter(n => n !== undefined).slice(0, 3);
      return [d];
    });
    // 等人坐的对赌桌：每一方坐着谁的名字（High Flux：dealer / player；Flux Duel：a / b，空着的是 null）
    out.open = arr(get(c, "open")).slice(0, CASINO_CAP.open).flatMap(t => {
      if (!obj(t) || !id(get(t, "id"))) return [];
      const d = identifiers(t, copyFields(t, {}, [], ["start"]), ["id"]);
      enumField(t, d, "stakeKind", ["chips", "kuizhi"]);
      d.mode = get(t, "mode") === "duel" ? "duel" : "highflux";
      (d.mode === "duel" ? DUEL_SIDES : CC_SIDES).forEach(k => { d[k] = text(get(t, k), 40); });
      return [d];
    });
    out.mine = arr(get(c, "mine")).slice(0, CASINO_CAP.mine).flatMap(m => {
      if (!obj(m) || !id(get(m, "kit"))) return [];
      const d = identifiers(m, copyFields(m, {}, ["name", "last"], ["purse", "sellable"]), ["kit"]);
      const ch = get(m, "chips");
      d.chips = obj(ch) ? selected(ch, ["gift", "normal", "total", "gifted"]) : {};
      d.seat = projectCasinoSeat(get(m, "seat"), true);
      return [d];
    });
    out.dealing = arr(get(c, "dealing")).slice(0, CASINO_CAP.dealing).flatMap(m => {
      if (!obj(m) || !id(get(m, "kit"))) return [];
      const seat = projectCasinoSeat(m, true);
      return seat && seat.game ? [Object.assign(identifiers(m, copyFields(m, {}, ["name"]), ["kit"]), seat)] : [];
    });
    out.seated = arr(get(c, "seated")).slice(0, CASINO_CAP.seated).flatMap(m => {
      if (!obj(m) || !id(get(m, "kit"))) return [];
      const seat = projectCasinoSeat(m, false);
      return seat ? [Object.assign(identifiers(m, copyFields(m, {}, ["name"]), ["kit"]), seat)] : [];
    });
    out.holdem = projectHoldemTables(get(c, "holdem"));
    // 主持人自己坐的多人桌座位（只给主持人，projectView 里对别人清空）
    out.gmSeats = arr(get(c, "gmSeats")).slice(0, CASINO_CAP.dealing).flatMap(m => {
      const seat = projectCasinoSeat(m, true);
      return seat && seat.kind === "holdem" && seat.table ? [seat] : [];
    });
    // 自己角色坐着的黑市赌命桌（#526）：这一手（projectGuessGame：坚毅的数字一个都不放）、结论 dead（这名角色死了没有）
    out.life = arr(get(c, "life")).slice(0, CASINO_CAP.mine).flatMap(m => {
      if (!obj(m) || !id(get(m, "kit"))) return [];
      const game = projectCasinoGame(get(m, "game"));
      return game && game.mode === "guess" && game.table.life ? [Object.assign(identifiers(m, copyFields(m, {}, ["name"]), ["kit"]), { dead: get(m, "dead") === true, game })] : [];
    });
    return out;
  }
  /** 战斗掉落：奎支和物品名、数量 */
  function projectDrops(d) {
    if (!obj(d)) return null;
    const out = copyFields(d, {}, [], ["kuizhi"], []);
    out.items = arr(get(d, "items")).slice(0, 30).flatMap(x => {
      const itemId = id(get(x, "id")), qty = number(get(x, "qty"));
      return itemId && qty > 0 ? [{ id: itemId, name: text(get(x, "name"), 60) || itemId, qty }] : [];
    });
    return out;
  }
  /** 最近 10 场战绩：概要 + 每个人的数据（伤害、击破、承伤……都是公开的战场数据） */
  function projectBattles(list) {
    const keys = ["dmg", "brk", "taken", "kills", "heal", "score", "assists", "blocks", "blockOk", "avoided", "staggers", "reduced", "share"];
    return arr(list).slice(-10).flatMap(b => {
      if (!obj(b)) return [];
      const out = copyFields(b, {}, ["name", "when", "grade"], ["no", "turns", "score", "teamDmg"], []);
      enumField(b, out, "outcome", ["win", "lose", "retreat"]);
      const mvp = get(b, "mvp"); if (obj(mvp)) out.mvp = copyFields(mvp, {}, ["name"], ["dmg"], []);
      const drops = projectDrops(get(b, "drops")); if (drops) out.drops = drops;
      out.rows = arr(get(b, "rows")).slice(0, 20).flatMap(r => obj(r) ? [identifiers(r, copyFields(r, {}, ["name"], keys, []), ["kit", "weaponOf"])] : []);
      return [out];
    });
  }
  // 技能分步的 key（app.js · skillFlowSteps）：不在这里的分步，联机玩家收不到也答不了（报告 H13：川川电鞭 / 铁壁、取回武器、推人、
  // Helumica 扫描后的互动 / 危墙倒向 / 干涉场……以前都缺）。新加分步 key 时要一起加进来（tests/online-view.test.js 会对照检查）
  const pickKeys = new Set(["partner", "target", "target1", "target2", "ally", "dest", "prop", "layer", "status", "mode", "carry", "burn", "rangeMode", "carryMode", "blade", "again", "item", "index",
    "act", "boost", "fall", "pull", "push", "shield", "sign", "swapTarget", "weapon",
    // Helumica「频域造物」：选间隙、选属性（降幅 / 增幅用 mode）
    "gap", "element",
    // 询问选项的 extra：以身作盾（{ ironwall: true }）、龙哥手杖协助顺手治疗谁（{ mode: "cane", heal: 单位 }）
    "ironwall", "heal"]);
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
    // 维修工具包：dest 是要修的武器 kit（字符串）。以前只放行数字，玩家战斗中用不了维修工具包（报告「中」）
    else if (typeof get(command, "dest") === "string" && /^[A-Za-z0-9_]{1,40}$/.test(get(command, "dest"))) out.dest = get(command, "dest");
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
        const item = copyFields(option, { value }, ["label", "sub", "cost"], [], ["disabled"]);
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
    // 原因文字照原样给玩家看（和单机一样）；text() 的敏感词过滤会挡掉提到坚毅生命具体数值 / 后台的句子，挡掉的才换成笼统的话
    // 敏感词用规范化后的文字判断（全角 ＳＨＰ 也挡得住），给玩家看的是去掉控制字符的原句（全角逗号不被改成半角）
    return value ? error.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁯]/g, "").slice(0, 500) : "操作未生效，请检查当前权限与可用选项";
  }
  function projectView(view, context) {
    if (!obj(view)) return null;
    const out = identifiers(view, { displayOnly: true, playerId: context.recipientId, canConfigure: false, canDisable: false }, ["currentUnitId", "gmId", "hostId"]);
    copyFields(view, out, [], ["turnNo"], ["configured", "enabled", "network"]);
    enumField(view, out, "phase", ["setup", "selecting", "picking", "acting", "enemy", "ended", "exploration"]);
    enumField(view, out, "segment", ["player", "enemy"]);   // 行动顺序排的是哪一段：敌人回合开始时玩家阵营先动的那一段是 enemy（PvP #464）
    enumField(view, out, "mode", ["trpg", "coop"]);
    for (const key of ["players", "operators"]) if (Array.isArray(get(view, key))) out[key] = get(view, key).map(p => identifiers(p, copyFields(p, {}, ["name"], [], ["online", "gm"]), ["id"]));
    const row = item => !obj(item) ? null : identifiers(item, copyFields(item, {}, ["unitName", "operatorName", "name"], [], ["spent", "completed", "locked", "done", "current"]), ["id", "unitId", "actor", "operatorId", "owner", "weaponOf"]);
    // operable：场上所有能操作的单位归谁（PvP #464：敌人回合那一段 units 只有这一段的人；只有 id / 名字 / 操控者）
    for (const key of ["roster", "slots", "order", "units", "heroes", "operable"]) if (Array.isArray(get(view, key))) out[key] = get(view, key).slice(0, 200).map(row);
    out.confirmed = arr(get(view, "confirmed")).map(id).filter(Boolean);
    out.chat = arr(get(view, "chat")).slice(-300).flatMap(m => {
      if (get(m, "secret")) return [];   // 主持人暗骰：只在房主本机
      const isTitle = !!get(m, "title");
      const raw = chatText(get(m, "text"), 500, true); if (raw === null) return [];
      // #340 第 11 条：敏感词过完再去余额（旧检查点消息也走这里；sensitiveTech 已在挡坚毅）
      const t = hideWallets(raw);
      const dto = identifiers(m, copyFields(m, { text: t }, ["operatorName", "name"], ["at"], []), ["id", "operatorId"]);
      const roll = get(m, "roll");
      if (roll) { dto.roll = true; const tier = obj(roll) ? get(roll, "tier") : null; if (["crit", "extreme", "hard", "normal", "easy", "fail"].includes(tier)) dto.tier = tier; }
      if (isTitle) dto.title = true;
      return [dto];
    });
    // 跑团地图：队伍位置（地点 id + 地图上的百分比坐标），玩家只读
    const map = get(view, "map");
    if (obj(map)) {
      const place = get(map, "place");
      const dto = { place: typeof place === "string" && /^[a-z0-9_-]{1,40}$/i.test(place) ? place : null };
      const x = number(get(map, "x")), y = number(get(map, "y"));
      if (x !== undefined && y !== undefined) { dto.x = Math.max(0, Math.min(100, x)); dto.y = Math.max(0, Math.min(100, y)); }
      out.map = dto;
    }
    // 主持人的大字（像 /title）：主标题、小字、风格、停留秒数
    const title = get(view, "title");
    if (obj(title) && id(get(title, "id"))) {
      const tt = text(get(title, "text"), 40);
      if (tt) {
        out.title = identifiers(title, copyFields(title, { text: tt }, ["sub"], ["seconds", "at"], []), ["id"]);
        enumField(title, out.title, "tone", ["plain", "danger", "hope"]);
      }
    }
    // 主持人发起的检定：熟练项、难度、每个人的成功率和掷出的点数（都是公开的）
    out.checks = arr(get(view, "checks")).slice(-20).flatMap(c => {
      if (!obj(c) || !id(get(c, "id"))) return [];
      if (get(c, "secret")) return [];   // 主持人暗骰检定：检定本身和结果都只在房主本机
      const dto = identifiers(c, copyFields(c, {}, ["prof", "diffName", "note"], ["at"], []), ["id"]);
      enumField(c, dto, "status", ["open", "done", "closed"]);
      dto.targets = arr(get(c, "targets")).slice(0, 12).flatMap(t => {
        if (!obj(t) || !id(get(t, "unitId"))) return [];
        const row = identifiers(t, copyFields(t, {}, ["name", "perkText"], ["base", "level"], ["adv", "dis", "reroll"]), ["unitId"]);
        const r = get(t, "result");
        if (obj(r)) row.result = { ok: !!get(r, "ok"), rerolled: !!get(r, "rerolled"), rolls: arr(get(r, "rolls")).slice(0, 4).map(x => ({ roll: number(get(x, "roll")) ?? null, ok: !!get(x, "ok"), label: text(get(x, "label"), 40) || "" })) };
        return [row];
      });
      return [dto];
    });
    out.attrRequests = arr(get(view, "attrRequests")).slice(-20).flatMap(r => {
      if (!obj(r) || !id(get(r, "id"))) return [];
      const dto = identifiers(r, copyFields(r, {}, ["unitName"], ["at"], []), ["id", "unitId", "operatorId"]);
      enumField(r, dto, "status", ["pending", "approved", "rejected", "cancelled"]);
      dto.attrs = arr(get(r, "attrs")).filter(a => ["str", "con", "dex", "wil", "int", "sta"].includes(a)).slice(0, 4);
      return [dto];
    });
    // 玩家主动发起的检定申请（hotseat.js · requestCheck）：熟练项、说明、状态，同意后对应的检定 id
    out.checkRequests = arr(get(view, "checkRequests")).slice(-20).flatMap(r => {
      if (!obj(r) || !id(get(r, "id"))) return [];
      const dto = identifiers(r, copyFields(r, {}, ["unitName", "prof", "note"], ["at"], []), ["id", "unitId", "operatorId", "checkId"]);
      enumField(r, dto, "status", ["pending", "approved", "rejected", "cancelled"]);
      return [dto];
    });
    // 决斗的申请 / 准备画面（#472）：谁申请的、选项、每名角色选了哪一队
    const duel = projectDuel(get(view, "duel")); if (duel) out.duel = duel;
    // 赌场（#487）：自己角色的钱包、自己那一方的牌局（hotseat-game.js 按收件人造）。再查一次是不是给这个人造的：
    // 拿错了别人的 view 也漏不出别人的钱包和牌；主持人坐庄的那几桌、谁坐在哪桌只给主持人
    if (get(view, "playerId") === context.recipientId) {
      const casino = projectCasino(get(view, "casino"));
      if (casino) {
        if (get(view, "hostId") !== context.recipientId) { casino.dealing = []; casino.seated = []; casino.gmSeats = []; }
        out.casino = casino;
      }
    }
    out.messages = projectMessages(get(view, "messages"), context);
    const swap = get(view, "swap"); out.swap = obj(swap) ? identifiers(swap, {}, ["requestId", "from", "to", "recipient"]) : null;
    const ask = get(view, "ask"); out.ask = null;
    if (obj(ask)) {
      const dto = identifiers(ask, copyFields(ask, {}, ["title"], ["deadline", "remainingMs"], ["declined", "field"]), ["id"]);
      enumField(ask, dto, "kind", ["choice", "block", "assist"]);
      if (get(ask, "deadline") === null) dto.deadline = null;
      dto.waitingNames = arr(get(ask, "waitingNames")).map(n => text(n, 60)).filter(n => n !== null);
      // Ownership is checked again here, even if the caller already projected
      // an ask, so passing the wrong cached view cannot expose another's menu.
      const owned = new Set([...(out.units || []), ...(out.heroes || []), ...(out.roster || [])].filter(u => u && (u.owner || u.operatorId) === context.recipientId).map(u => u.id || u.unitId));
      dto.options = arr(get(ask, "options")).flatMap(option => {
        if (!owned.has(get(option, "helper"))) return [];
        const item = identifiers(option, copyFields(option, {}, ["label", "sub"]), ["helper", "target"]);
        if (own(option, "extra")) { const extra = choiceValue(get(option, "extra")); if (extra === undefined) return []; item.extra = extra; }
        return [item];
      });
      // 协助攻击举手：举手名单只给打出失衡的那名玩家（他来选）；每个人只看到自己举的是哪一个
      const chooser = get(ask, "isChooser") === true;
      dto.isChooser = chooser;
      dto.chooserName = text(get(ask, "chooserName"), 60);
      dto.raised = id(get(ask, "raised")) ? get(ask, "raised") : null;
      dto.hands = chooser ? arr(get(ask, "hands")).flatMap(h => {
        const item = identifiers(h, copyFields(h, {}, ["label", "sub", "operatorName"]), ["helper"]);
        if (!item.helper) return [];
        if (own(h, "extra")) { const extra = choiceValue(get(h, "extra")); if (extra === undefined) return []; item.extra = extra; }
        return [item];
      }) : [];
      dto.eligible = dto.options.length > 0 || dto.hands.length > 0; out.ask = dto;
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
    if (get(packet, "type") === "sheetData") {
      out.sheets = projectSheets(get(packet, "sheets"));
      out.armory = projectSheets(get(packet, "armory"));
      out.bag = projectBagDetail(get(packet, "bag"));
      out.battles = projectBattles(get(packet, "battles"));
    }
    // 角色资料的详细内容（玩家点开一条时才要，online-game.js · loreEntry）：只有已发布的，草稿在房主那边就是 null
    if (get(packet, "type") === "loreEntry") out.entry = projectLoreEntry(get(packet, "entry"));
    if (own(packet, "offlineWait")) {
      const wait = get(packet, "offlineWait");
      out.offlineWait = obj(wait) ? identifiers(wait, copyFields(wait, {}, ["name"], ["deadline", "remainingMs"], []), ["actor", "owner"]) : null;
    }
    enumField(packet, out, "screen", ["lobby", "exploration", "battle", "ended"]);
    if (get(packet, "ok") === false || get(packet, "error") != null) out.error = safeError(get(packet, "error"));
    if (own(packet, "state")) out.state = projectState(get(packet, "state"), context);
    if (own(packet, "tape")) out.tape = projectTape(get(packet, "tape"), { state: get(packet, "state") || context.state });
    if (own(packet, "fx")) out.fx = projectFx(get(packet, "fx"));
    if (own(packet, "view")) out.view = projectView(get(packet, "view"), context);
    if (own(packet, "result")) out.result = publicResult(get(packet, "result"));
    if (own(packet, "messages")) out.messages = projectMessages(get(packet, "messages"), context);
    if (get(packet, "type") === "messageHistory" && out.messages) out.messages = out.messages.slice(-100);
    if (own(packet, "publicLogs")) out.publicLogs = projectLogs(get(packet, "publicLogs"));
    // 联机单局：房主按收件人算好的单局画面（投票、钱包、战利品、自己能做的事），只去掉坚毅生命这类隐藏数值
    enumField(packet, out, "mode", ["trpg", "rogue"]);
    // 升级提示：房主已经按收件人挑好（只有自己的角色、去掉了坚毅生命那一行）
    if (own(packet, "levelUps")) out.levelUps = arr(get(packet, "levelUps")).slice(0, 10).filter(obj).map(ev => {
      const e = scrubHidden(clone(ev)); e.stats = arr(e.stats).filter(r => obj(r) && r.key !== "shp"); return e;
    });
    // 克制表（matchup.js）：房主算好的公开规则数据（天气、克制表、说明文字），只去掉隐藏数值
    if (own(packet, "matchup")) { const m = get(packet, "matchup"); out.matchup = obj(m) ? scrubHidden(clone(m)) : null; }
    if (own(packet, "rogue")) { const r = get(packet, "rogue"); out.rogue = obj(r) ? scrubHidden(clone(r)) : null; }
    // 任务日志：只留玩家该看的字段（主持人备注、敌人配置、隐藏站的内容在房主那边就去掉了，这里再按白名单过一遍）
    if (own(packet, "quests")) out.quests = projectQuests(get(packet, "quests"));
    // 角色资料：已发布条目的索引（不带详细内容；草稿在房主那边就没放进来，这里再挡一次）
    if (own(packet, "lore")) out.lore = projectLore(get(packet, "lore"));
    if (own(packet, "purse")) out.purse = projectPurse(get(packet, "purse"));
    if (own(packet, "shop")) out.shop = projectShop(get(packet, "shop"));
    if (own(packet, "shopSell")) out.shopSell = projectShopSell(get(packet, "shopSell"));
    if (own(packet, "clinic")) out.clinic = projectClinic(get(packet, "clinic"));
    if (own(packet, "smith")) out.smith = projectSmith(get(packet, "smith"));
    if (own(packet, "workshop")) out.workshop = projectWorkshop(get(packet, "workshop"));
    if (own(packet, "cyberware")) out.cyberware = projectCyberware(get(packet, "cyberware"));
    // 长休结算：不带坚毅（只带那一句 mood）；游戏时钟
    if (own(packet, "rest")) out.rest = projectRest(get(packet, "rest"));
    if (own(packet, "camp")) out.camp = projectCamp(get(packet, "camp"));
    if (own(packet, "clock")) { const ck = get(packet, "clock"); out.clock = obj(ck) ? { day: Math.max(1, Math.floor(Number(ck.day) || 1)), clock: ((Math.floor(Number(ck.clock) || 0) % 1440) + 1440) % 1440, hours: Math.max(0, Math.round((Number(ck.hours) || 0) * 60) / 60) } : null; }
    if (own(packet, "party")) out.party = projectParty(get(packet, "party"));
    // Resync is another envelope using these same explicit projectors, not a
    // path for forwarding an opaque nested packet or raw save snapshot.
    return out;
  }
  /** 跑团探索的队伍卡（party-cards.js · heroDto）：白名单，坚毅生命（shp / shpMax）不在里面，房主那份就算带了也丢掉 */
  function projectParty(list) {
    if (!Array.isArray(list)) return null;
    const str = (v, k) => typeof v === "string" ? text(v, k) || "" : "";
    const num = v => (typeof v === "number" && isFinite(v) ? Math.round(v) : 0);
    return list.slice(0, 12).filter(obj).map(h => ({ id: str(h.id, 60), kit: str(h.kit, 40), name: str(h.name, 40), level: num(h.level) || 1,
      dead: !!h.dead, dying: !!h.dying, upOnShp: !!h.upOnShp, hp: num(h.hp), hpMax: num(h.hpMax), atk: num(h.atk), def: num(h.def), defMax: num(h.defMax),
      block: typeof h.block === "number" && isFinite(h.block) ? Math.round(h.block) : null, xp: num(h.xp), xpNext: num(h.xpNext),
      attrPoints: num(h.attrPoints), featPoints: num(h.featPoints), feats: arr(h.feats).slice(0, 20).map(f => str(f, 30)).filter(Boolean),
      weapons: arr(h.weapons).slice(0, 6).filter(obj).map(w => ({ kit: str(w.kit, 40), name: str(w.name, 40), level: num(w.level) || 1, bond: num(w.bond), dur: num(w.dur), max: num(w.max) })) }));
  }
  /** 营地（长休前）：全队状态和补给，坚毅只留短词 mood */
  function projectCamp(c) {
    if (!obj(c)) return null;
    const str = (v, n) => typeof v === "string" ? v.slice(0, n) : "";
    const num = v => (typeof v === "number" && isFinite(v) ? Math.floor(v) : 0);
    const nh = v => (obj(v) ? { need: num(v.need), have: num(v.have) } : { need: 0, have: 0 });
    return {
      day: num(c.day), clock: num(c.clock), hoursAwake: num(c.hoursAwake), exhaust: num(c.exhaust), force: !!c.force,
      water: nh(c.water), food: nh(c.food), ok: !!c.ok, lack: arr(c.lack).slice(0, 8).map(x => str(x, 60)),
      heroes: arr(c.heroes).slice(0, 12).filter(obj).map(h => ({ kit: str(h.kit, 40), name: str(h.name, 40), dead: !!h.dead, dying: !!h.dying,
        hp: num(h.hp), hpMax: num(h.hpMax), mood: str(h.mood, 20),
        weapons: arr(h.weapons).slice(0, 4).filter(obj).map(w => ({ name: str(w.name, 40), dur: num(w.dur), max: num(w.max) })) }))
    };
  }
  function projectRest(r) {
    if (!obj(r)) return null;
    const str = (v, n) => typeof v === "string" ? v.slice(0, n) : "";
    const num = v => (typeof v === "number" && isFinite(v) ? Math.floor(v) : 0);
    const pair = v => (Array.isArray(v) ? [num(v[0]), num(v[1])] : [0, 0]);
    const t = v => (obj(v) ? { day: num(v.day), clock: num(v.clock) } : { day: 0, clock: 0 });
    return {
      id: str(r.id, 40), ok: !!r.ok, hours: num(r.hours), forced: !!r.forced, from: t(r.from), to: t(r.to),
      water: num(r.water), food: num(r.food), exhaust: pair(r.exhaust), watch: str(r.watch, 40),
      ambush: obj(r.ambush) ? { text: str(r.ambush.text, 120) } : null,
      heroes: arr(r.heroes).slice(0, 12).filter(obj).map(h => ({
        kit: str(h.kit, 40), name: str(h.name, 40), dead: !!h.dead, watch: !!h.watch,
        hp: pair(h.hp), hpMax: num(h.hpMax), mood: str(h.mood, 80),
        weapons: arr(h.weapons).slice(0, 4).filter(obj).map(w => ({ name: str(w.name, 40), dur: pair(w.dur), max: num(w.max) }))
      }))
    };
  }
  /** 跑团私人钱包：{ party 公账, heroes: [{ kit, name, amount?（只有自己的 / 主持人才有）, mine }] } */
  function projectPurse(p) {
    if (!obj(p)) return null;
    const num = v => (typeof v === "number" && isFinite(v) ? Math.max(0, Math.floor(v)) : null);
    const str = (v, n) => typeof v === "string" ? v.slice(0, n) : "";
    return { party: num(p.party) || 0, heroes: arr(p.heroes).slice(0, 12).filter(obj).map(h => {
      const o = { kit: str(h.kit, 40), name: str(h.name, 40), mine: !!h.mine };
      if (num(h.amount) != null) o.amount = num(h.amount);
      return o;
    }).filter(h => h.kit) };
  }
  /** 跑团商人（主持人开着的那家店）：名字、介绍、折扣、商品（名字、说明、原价、现价、库存）、积分兑换 */
  function projectShop(s) {
    if (!obj(s)) return null;
    const str = (v, n) => typeof v === "string" ? v.slice(0, n) : "";
    const num = v => (typeof v === "number" && isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
    const pts = obj(s.points) ? { have: num(s.points.have), rows: arr(s.points.rows).slice(0, 60).filter(obj).map(r => ({ item: str(r.item, 40), name: str(r.name, 40), points: num(r.points) })).filter(r => r.item) } : null;
    return { id: str(s.id, 40), name: str(s.name, 30), note: str(s.note, 200), discount: num(s.discount),
      rows: arr(s.rows).slice(0, 200).filter(obj).map(r => ({ key: str(r.key, 40), name: str(r.name, 60), hint: str(r.hint, 160), group: str(r.group, 30),
        base: num(r.base), price: num(r.price), stock: r.stock == null ? null : num(r.stock) })).filter(r => r.key),
      points: pts };
  }
  /** 卖东西 / 回购（shop-sell.js）：{ items: [{ id, name, qty, unitPrice, owner, ok, reason }], buyback: [{ token, id, name, qty, price, owner, seller }] } */
  function projectShopSell(s) {
    if (!obj(s)) return null;
    const str = (v, n) => typeof v === "string" ? v.slice(0, n) : "";
    const num = v => (typeof v === "number" && isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
    return {
      items: arr(s.items).slice(0, 300).filter(obj).map(r => ({ id: str(r.id, 60), name: str(r.name, 60), qty: num(r.qty), unitPrice: r.unitPrice == null ? null : num(r.unitPrice),
        owner: str(r.owner, 40), ok: !!r.ok, reason: str(r.reason, 20) })).filter(r => r.id),
      buyback: arr(s.buyback).slice(0, 100).filter(obj).map(r => ({ token: str(r.token, 20), id: str(r.id, 60), name: str(r.name, 60), qty: num(r.qty), price: num(r.price),
        owner: str(r.owner, 40), seller: str(r.seller, 40) })).filter(r => r.token),
      last: obj(s.last) ? { seq: num(s.last.seq), kind: s.last.kind === "buyback" ? "buyback" : "sell", by: str(s.last.by, 40), ok: !!s.last.ok, total: num(s.last.total),
        payout: arr(s.last.payout).slice(0, 12).filter(obj).map(p => ({ to: str(p.to, 40), amount: typeof p.amount === "number" && isFinite(p.amount) ? Math.floor(p.amount) : 0 })), msg: str(s.last.msg, 200) } : null
    };
  }
  /** 跑团工匠（trpg.js · trpgSmithPacket）：{ heroes: [{ kit, name, purse, weapons: [{ kit, name, lv, next, max, canSelf, enough, fee, mats: [{ name, need, have }] }] }] }，只有公开数字 */
  function projectSmith(s) {
    if (!obj(s)) return null;
    const str = (v, n) => typeof v === "string" ? v.slice(0, n) : "";
    const num = v => (typeof v === "number" && isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
    return { heroes: arr(s.heroes).slice(0, 8).filter(obj).map(h => ({
      kit: str(h.kit, 40), name: str(h.name, 40), purse: num(h.purse),
      weapons: arr(h.weapons).slice(0, 8).filter(obj).map(w => ({ kit: str(w.kit, 40), name: str(w.name, 40), lv: num(w.lv), next: num(w.next), max: !!w.max, canSelf: !!w.canSelf,
        enough: !!w.enough, fee: num(w.fee), mats: arr(w.mats).slice(0, 8).filter(obj).map(m => ({ name: str(m.name, 40), need: num(m.need), have: num(m.have) })) })).filter(w => w.kit)
    })).filter(h => h.kit) };
  }
  /** 跑团工坊（trpg.js · trpgWorkshopPacket）：{ heroes: [{ kit, name, points, recipes: [...], salvage: [{ id, name, qty, yields }] }] } */
  function projectWorkshop(w) {
    if (!obj(w)) return null;
    const str = (v, n) => typeof v === "string" ? v.slice(0, n) : "";
    const num = v => (typeof v === "number" && isFinite(v) ? Math.max(0, v) : 0);
    return { heroes: arr(w.heroes).slice(0, 8).filter(obj).map(h => ({
      kit: str(h.kit, 40), name: str(h.name, 40), points: Math.floor(num(h.points)),
      recipes: arr(h.recipes).slice(0, 80).filter(obj).map(r => ({ id: str(r.id, 60), name: str(r.name, 60), prof: str(r.prof, 20), diffName: str(r.diffName, 20), hours: Math.floor(num(r.hours)),
        known: !!r.known, level: Math.floor(num(r.level)), chance: num(r.chance),
        mats: arr(r.mats).slice(0, 12).filter(obj).map(m => ({ id: str(m.id, 60), name: str(m.name, 40), need: Math.floor(num(m.need)), have: Math.floor(num(m.have)) })) })).filter(r => r.id),
      salvage: arr(h.salvage).slice(0, 100).filter(obj).map(x => ({ id: str(x.id, 60), name: str(x.name, 60), qty: Math.floor(num(x.qty)), yields: str(x.yields, 120) })).filter(x => x.id)
    })).filter(h => h.kit) };
  }
  /** 跑团诊所：自己的角色的改造信息（肉体上限、可改上限、改造率、单价、现在的方案）和最近一条申请的状态 */
  function projectClinic(c) {
    if (!obj(c)) return null;
    const str = (v, n) => typeof v === "string" ? v.slice(0, n) : "";
    const num = v => (typeof v === "number" && isFinite(v) ? Math.max(0, v) : 0);
    const plan = p => obj(p) ? { armor: Math.floor(num(p.armor)), shield: Math.floor(num(p.shield)), sand: Math.floor(num(p.sand)), spirit: !!p.spirit } : { armor: 0, shield: 0, sand: 0, spirit: false };
    return { heroes: arr(c.heroes).slice(0, 8).filter(obj).map(h => ({
      kit: str(h.kit, 40), name: str(h.name, 40), purse: Math.floor(num(h.purse)),
      cyber: obj(h.cyber) ? { current: plan(h.cyber.current), limit: Math.floor(num(h.cyber.limit)), rate: num(h.cyber.rate), fleshMax: Math.floor(num(h.cyber.fleshMax)), perHp: Math.floor(num(h.cyber.perHp)) } : null,
      request: obj(h.request) ? { status: ["pending", "done", "denied"].includes(h.request.status) ? h.request.status : "pending", cost: Math.floor(num(h.request.cost)), note: str(h.request.note, 80) } : null
    })).filter(h => h.kit && h.cyber) };
  }
  /** 义体（cyberware.js · cyberwarePacket）：白名单 + scrubHidden，坚毅只有档位文字 */
  function projectCyberware(c) {
    if (!obj(c)) return null;
    // 多名角色：{ heroes: [cyberwarePacket…] }（online-rogue.js · cyberwareFor）
    if (Array.isArray(c.heroes)) return { heroes: c.heroes.slice(0, 8).map(projectCyberware).filter(h => h && h.kit) };
    const str = (v, n) => typeof v === "string" ? v.slice(0, n) : "";
    const num = v => (typeof v === "number" && isFinite(v) ? v : 0);
    const BUR = ["none", "strain", "heavy"];
    // vol / line / kindName / summary：义体种类表写好的展示文字（cyberware.js · cwPublic），界面不用认得是哪一种
    const item = d => ({ id: str(d.id, 60), name: str(d.name, 60), tier: num(d.tier), vol: num(d.vol), line: d.line ? str(d.line, 30) : null,
      kind: str(d.kind, 20), kindName: str(d.kindName, 20), summary: str(d.summary, 120), range: str(d.range, 10), element: str(d.element, 20),
      damageText: str(d.damageText, 40), break: num(d.break), hpCut: num(d.hpCut), conflict: d.conflict ? str(d.conflict, 30) : null, example: !!d.example });
    // 以新换旧：会先拆掉同系列的哪件、它的拆除费
    const swap = d => ({ replaces: d.replaces ? str(d.replaces, 60) : null, replaceName: str(d.replaceName, 60), replaceCost: num(d.replaceCost) });
    const v = obj(c.view) ? c.view : {};
    // locked / unlockLevel：不到 5 级不能在诊所装 / 拆（cyberware.js · cyberwareLockWhy，#315），界面据此把按钮灰掉、写「5 级解锁」；
    // needLevel：这一件的档位要的等级还没到（cyberware.js · cyberwareTierNeed），界面写「需要 10 级」之类
    const out = { kit: str(c.kit, 40), name: str(c.name, 40), view: {
      rate: num(v.rate), cap: num(v.cap), cyberwareRate: num(v.cyberwareRate), layerRate: num(v.layerRate), remainingHp: num(v.remainingHp),
      overinstall: !!v.overinstall, canOverinstall: !!v.canOverinstall, locked: !!v.locked, unlockLevel: num(v.unlockLevel),
      burden: BUR.includes(v.burden) ? v.burden : "none", burdenText: str(v.burdenText, 80),
      installed: arr(v.installed).slice(0, 16).filter(obj).map(d => Object.assign(item(d), { usesLeft: num(d.usesLeft), removeCost: num(d.removeCost) })) },
      shop: arr(c.shop).slice(0, 64).filter(obj).map(d => Object.assign(item(d), { price: num(d.price), text: str(d.text, 300), installed: !!d.installed,
        canInstall: !!d.canInstall, error: d.error ? str(d.error, 80) : null, locked: !!d.locked, needLevel: num(d.needLevel), warning: str(d.warning, 80), rateAfter: num(d.rateAfter) }, swap(d))) };
    out.purse = Math.max(0, Math.floor(num(c.purse)));
    const pv = obj(c.previews) ? c.previews : {};
    out.previews = {};
    Object.keys(pv).slice(0, 64).forEach(k => {
      const p = pv[k], key = str(k, 60);
      if (!obj(p) || !key) return;
      out.previews[key] = Object.assign({ ok: !!p.ok, error: p.error ? str(p.error, 80) : null, locked: !!p.locked, needLevel: num(p.needLevel), cost: num(p.cost), price: num(p.price), id: str(p.id, 60), name: str(p.name, 60), tier: num(p.tier),
        rateBefore: num(p.rateBefore), rateAfter: num(p.rateAfter), cap: num(p.cap), overinstall: !!p.overinstall, hpCut: num(p.hpCut),
        conflictWith: p.conflictWith ? str(p.conflictWith, 60) : null, burden: BUR.includes(p.burden) ? p.burden : "none", warning: str(p.warning, 80) }, swap(p));
    });
    return scrubHidden(out);
  }
  /* 角色资料（lore.js，issue #264）：每种类型给玩家看哪些字段在这里登记（新加的字段、类型没登记就不发）。
   * 都是主持人写给玩家看的文字（和任务目标一样）：只去控制字符、截长度，不按敏感词整段丢掉——人物介绍里「后台」是常用词（「有后台」）；
   * 坚毅生命这类规则数值根本不在条目里（条目只有主持人写的字）。条数、长度上限都比 lore.js 的配置宽，只是兜底（tests/lore.test.js 查：调大配置时这里也要跟着调） */
  const LORE_PUBLIC = Object.freeze({ npc: Object.freeze(["name", "gender", "race", "faction", "title"]) });
  const LORE_CAP = Object.freeze({ entries: 400, field: 60, body: 4000 });
  function loreStr(v, max, lines) {
    if (typeof v !== "string") return "";
    // 控制字符（\p{Cc}）和零宽 / 双向控制这类格式字符（\p{Cf}）去掉；详细内容留着换行
    const clean = lines ? v.replace(/\r\n?/g, "\n").replace(/(?!\n)[\p{Cc}\p{Cf}]/gu, "") : v.replace(/[\p{Cc}\p{Cf}]/gu, "");
    const cut = clean.slice(0, max), last = cut.charCodeAt(cut.length - 1);
    return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
  }
  /** 索引：{ id, type, fields: { 登记过的字段 }, rev, more（有没有详细内容）}。带着 status 又不是已发布的（草稿）直接丢掉；id 重复的只留第一条 */
  function projectLore(list) {
    if (!Array.isArray(list)) return null;
    const seen = new Set();
    return list.slice(0, LORE_CAP.entries).flatMap(e => {
      if (!obj(e)) return [];
      const lid = id(get(e, "id")), type = get(e, "type");
      if (!lid || seen.has(lid) || !Object.hasOwn(LORE_PUBLIC, type) || own(e, "status") && get(e, "status") !== "published") return [];
      seen.add(lid);
      const src = get(e, "fields"), fields = {};
      for (const key of LORE_PUBLIC[type]) { const v = loreStr(get(src, key), LORE_CAP.field); if (v) fields[key] = v; }
      const rev = number(get(e, "rev"));
      const out = { id: lid, type, fields, rev: Number.isSafeInteger(rev) && rev > 0 ? rev : 1 };
      if (get(e, "more") === true) out.more = true;
      return [out];
    });
  }
  /** 一条的详细内容：索引那几样 + body（保留换行） */
  function projectLoreEntry(e) {
    const row = obj(e) ? projectLore([e])[0] : null;
    if (!row) return null;
    delete row.more;
    const body = loreStr(get(e, "body"), LORE_CAP.body, true); if (body) row.body = body;
    return row;
  }
  function projectQuests(list) {
    if (!Array.isArray(list)) return null;
    const str = (v, n) => typeof v === "string" ? v.slice(0, n) : "";
    const num = v => (typeof v === "number" && isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
    const STATUS = ["posted", "active", "done", "failed"], STEP = ["done", "cur", "todo"];
    return list.slice(0, 40).filter(obj).map(q => ({
      id: str(q.id, 40), name: str(q.name, 40), category: q.category === "main" || q.category === "personal" ? q.category : "side", owner: str(q.owner, 20),
      status: STATUS.includes(q.status) ? q.status : "posted", goal: str(q.goal, 400), days: num(q.days),
      private: !!q.private, index: num(q.index), got: !!q.got, failWhy: str(q.failWhy, 120),
      reward: obj(q.reward) ? { xp: num(q.reward.xp), kuizhi: num(q.reward.kuizhi), items: arr(q.reward.items).slice(0, 20).map(x => str(x, 60)) } : { xp: 0, kuizhi: 0, items: [] },
      steps: arr(q.steps).slice(0, 20).filter(obj).map(st => st.hidden
        ? { title: "", state: STEP.includes(st.state) ? st.state : "todo", hidden: true, xp: 0, kuizhi: 0, got: false }
        : { title: str(st.title, 120), state: STEP.includes(st.state) ? st.state : "todo", hidden: false, xp: num(st.xp), kuizhi: num(st.kuizhi), got: !!st.got })
    })).filter(q => q.id);
  }
  /* 玩家请求的角色资料、武器页和背包明细：都是规则说明和公开数值，只去掉坚毅生命这类隐藏数值 */
  const hiddenSheetKey = /^(shp|shpMax|shpBase|shpBonus|upOnShp)$/i;
  function scrubHidden(value) {
    if (Array.isArray(value)) return value.map(scrubHidden);
    if (!obj(value)) return value;
    const out = {};
    for (const key of Object.keys(value)) if (!hiddenSheetKey.test(key)) out[key] = scrubHidden(value[key]);
    return out;
  }
  function projectSheets(list) { return arr(list).slice(0, 16).map(row => scrubHidden(clone(row))).filter(obj); }
  function projectBagDetail(bag) {
    if (!obj(bag)) return null;
    const out = copyFields(bag, {}, [], ["water", "kuizhi"], []);
    out.items = arr(get(bag, "items")).slice(0, 200).flatMap(item => {
      const itemId = id(get(item, "id")), qty = number(get(item, "qty"));
      if (!itemId || qty === undefined || qty <= 0) return [];
      const row = { id: itemId, name: text(get(item, "name"), 80) || itemId, qty };
      // 道具说明是固定的目录文字，可以提到坚毅生命；要藏的只是玩家自己的坚毅生命数值（scrubHidden 管）
      const rawHint = get(item, "hint");
      if (typeof rawHint === "string") {
        const hint = rawHint.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, "").slice(0, 300);
        if (hint) row.hint = hint;
      }
      return [row];
    });
    return out;
  }
  const api = { SCHEMA, pickKeys, projectHud, projectPacket, projectQuests, projectLore, projectLoreEntry, LORE_PUBLIC, LORE_CAP, projectPurse, projectShop, projectShopSell, projectClinic, projectSmith, projectWorkshop, projectCyberware, projectRest, projectCamp, projectParty, projectSheets, projectBagDetail, projectUnit, projectState, projectTape, projectFx, projectMessages, projectLogs, projectView, projectActionMenu, hideWallets, safeText: text, safeError };
  root.OnlineView = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
