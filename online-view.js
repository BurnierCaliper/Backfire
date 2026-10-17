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
  const resourceNumbers = ["nano", "bean", "liquid", "durability", "shield", "tauntLeft", "charge", "energyPct", "light", "lockLeft", "smashUsed", "phase", "debrisCount"];
  const resourceFlags = ["mecha", "engine", "prepared", "preparedActive", "preparedPending", "smashNext", "smashOnce", "niuOut", "narutoOut", "forceCruelNext", "scanned", "unstable", "forceCharge", "forceOverheat"];
  const statusKeys = ["burn", "shock", "corr", "frostbite", "shockwave", "high", "reso", "unstable", "weak", "inspire", "hide", "advantage", "chase", "sturdy"];
  function projectUnit(unit) {
    if (!obj(unit) || !id(get(unit, "id"))) return null;
    const out = identifiers(unit, {}, ["id", "kit", "weaponOf", "owner", "operatorId"]);
    copyFields(unit, out, ["name", "escort"], ["level", "xp", "attrPoints", "zone", "atk", "def", "defMax", "ap", "apMax", "bonus", "bonusMax", "highEnergy", "stunMarks", "sink"], ["isPlayer", "weaponUnit", "isProp", "isGap", "isDevice", "dying", "stunned", "flying", "dead", "hidden", "noMove", "dormant", "submerged", "neutral"]);
    if (get(unit, "fused") || get(unit, "_removed")) out.hidden = true;
    // 带着高能被打死的敌人：高能自爆演完之前先不算死（和本机画面一样，卡片等自爆后才淡出）
    if (out.dead && !out.isPlayer && (number(call("highBoomValue", unit)) || 0) > 0) { out.dead = false; out.hidden = false; }
    // 首领 / 10 级起精英：要攒几个晕眩标记才晕眩（玩家那边画「晕眩标记 n/2」徽章；他们自己算不出敌人的级别规则）
    try { if (!get(unit, "isPlayer") && typeof root.isBossUnit === "function" && root.isBossUnit(unit)) out.stunMax = 2; } catch (e) {}
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
    enumField(unit, out, "self", ["burn", "frost", "splash", "conductor", "anchor", "store", "doppler"]);
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
  function projectProp(prop) {
    if (!obj(prop) || !id(get(prop, "id"))) return null;
    const out = identifiers(prop, {}, ["id"]);
    copyFields(prop, out, ["name"], ["zone", "level", "hp", "maxHp", "shield", "shieldMax"], ["destroyed"]);
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
        // Catalog descriptions contain hidden-pool effects; only names are public.
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
      out.fields[key] = selected(field, ["fire", "fireOn", "electric", "acid", "ice", "collapse", "energy", "energyVal", "harmonic", "heal", "highland", "abyss", "isolate", "collapseOn", "collapseLv", "ruinOn", "ruinHp", "ruinMax"]);
      out.fields[key].fieldLocked = !!get(field, "fieldLock");
    }
    for (const key of gapKeys) if (obj(get(get(state, "gaps"), key))) {
      const gap = get(get(state, "gaps"), key), dto = copyFields(gap, {}, [], ["hp", "maxHp", "level"], ["open"]);
      enumField(gap, dto, "type", ["open", "bridge", "wall", "door", "void"]); out.gaps[key] = dto;
    }
    for (const key of zoneKeys) { const zv = zoneViewOf(Number(key), state); if (zv) (out.zoneView = out.zoneView || {})[key] = zv; }
    return out;
  }
  const popupWords = new Set(["无效", "失衡", "起身", "倒下", "刺入", "温和", "残忍", "登场支援！", "聚焦抹层", "灼烧", "感电", "腐蚀", "冻伤", "震荡", "共振", "高能", "虚弱", "振奋", "躲藏", "优势", "紧追", "熔融", "刺骨", "过载", "错位", "扩散", "折射", "红弹", "蓝弹", "导体", "霜结", "自焚", "溅射", "千钧", "蓄能", "多普勒", "爆燃", "破冰", "雷击", "蚀刻", "倒流", "惯性", "衍射", "穿刺", "猛击", "弱点特效", "超载", "中和"]);
  function projectTape(tape, context = {}) {
    const units = arr(get(context.state, "units"));
    return arr(tape).slice(0, 256).flatMap(event => {
      if (!obj(event) || get(event, "type") !== "pop" || !id(get(event, "unitId"))) return [];
      const kind = get(event, "kind"); if (!["dmg", "heal", "break", "status", "fxword", "highboom", "partner", "bullet", "proc"].includes(kind)) return [];
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
      const body = chatText(get(message, "text"), 2000); if (body === null) return [];
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
    const drops = projectDrops(get(result, "drops")); if (drops) out.drops = drops;
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
      [/只能从自己角色的钱包/, "只能从自己角色的钱包转钱"], [/只能用自己角色的钱包/, "只能用自己角色的钱包付钱"], [/已经关门/, "这家店已经关门了"], [/只能给自己的角色申请/, "只能给自己的角色申请改造"], [/诊所现在没开/, "诊所现在没开"],
      [/最多只能改造|内层必须|最多 \d+ 种血量|改造量必须/, "改造方案不合规则"], [/方案没有变化/, "方案没有变化"], [/钱包里的钱不够/, "钱包里的钱不够"],
      [/卖完了|只剩 \d+ 份/, "库存不够了"], [/积分不够/, "商店积分不够"], [/不能用积分兑换|换不到/, "这家店换不到这件"], [/奎支不够/, "钱包里的钱不够"], [/不够转|奎支，不够/, "钱包里的钱不够"], [/不能转给自己/, "不能转给自己"],
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
    out.chat = arr(get(view, "chat")).slice(-300).flatMap(m => {
      if (get(m, "secret")) return [];   // 主持人暗骰：只在房主本机
      const isTitle = !!get(m, "title");
      const t = chatText(get(m, "text"), 500, true); if (t === null) return [];
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
    out.messages = projectMessages(get(view, "messages"), context);
    const swap = get(view, "swap"); out.swap = obj(swap) ? identifiers(swap, {}, ["requestId", "from", "to", "recipient"]) : null;
    const ask = get(view, "ask"); out.ask = null;
    if (obj(ask)) {
      const dto = identifiers(ask, copyFields(ask, {}, ["title"], ["deadline"], ["declined", "field"]), ["id"]);
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
    // 联机单局：房主按收件人算好的单局画面（投票、钱包、战利品、自己能做的事），只去掉坚毅生命这类隐藏数值
    enumField(packet, out, "mode", ["trpg", "rogue"]);
    // 升级提示：房主已经按收件人挑好（只有自己的角色、去掉了坚毅生命那一行）
    if (own(packet, "levelUps")) out.levelUps = arr(get(packet, "levelUps")).slice(0, 10).filter(obj).map(ev => {
      const e = scrubHidden(clone(ev)); e.stats = arr(e.stats).filter(r => obj(r) && r.key !== "shp"); return e;
    });
    if (own(packet, "rogue")) { const r = get(packet, "rogue"); out.rogue = obj(r) ? scrubHidden(clone(r)) : null; }
    // 任务日志：只留玩家该看的字段（主持人备注、敌人配置、隐藏站的内容在房主那边就去掉了，这里再按白名单过一遍）
    if (own(packet, "quests")) out.quests = projectQuests(get(packet, "quests"));
    if (own(packet, "purse")) out.purse = projectPurse(get(packet, "purse"));
    if (own(packet, "shop")) out.shop = projectShop(get(packet, "shop"));
    if (own(packet, "clinic")) out.clinic = projectClinic(get(packet, "clinic"));
    // 长休结算：不带坚毅（只带那一句 mood）；游戏时钟
    if (own(packet, "rest")) out.rest = projectRest(get(packet, "rest"));
    if (own(packet, "camp")) out.camp = projectCamp(get(packet, "camp"));
    if (own(packet, "clock")) { const ck = get(packet, "clock"); out.clock = obj(ck) ? { day: Math.max(1, Math.floor(Number(ck.day) || 1)), clock: ((Math.floor(Number(ck.clock) || 0) % 1440) + 1440) % 1440 } : null; }
    // Resync is another envelope using these same explicit projectors, not a
    // path for forwarding an opaque nested packet or raw save snapshot.
    return out;
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
  const api = { SCHEMA, pickKeys, projectHud, projectPacket, projectQuests, projectPurse, projectShop, projectClinic, projectRest, projectCamp, projectSheets, projectBagDetail, projectUnit, projectState, projectTape, projectMessages, projectLogs, projectView, projectActionMenu, safeText: text, safeError };
  root.OnlineView = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
