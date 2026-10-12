/* 战斗模板：主持人提前布置好的战场（区制 / 棋盘、天气、我方站位、敌人和首领机制、场地、间隙、配置物）。
 *
 * 模板存在本机（localStorage「anterscale-battle-templates」），不跟着存档走，所有团、联机房间共用。
 * 开战时把模板转成一份遭遇（run.js · buildEncounter 认的格式），进战斗画面的那一刻战场就已经摆好，
 * 不用开打之后再一个个放敌人。
 *
 * 模板格式：
 *   { id, name, note, tier: "normal" | "elite" | "boss", board: 2 | 3 | "line4" | "square4" | "cross5",
 *     weather, playerZone,
 *     enemies: [{ preset, level (null = 跟着战斗等级), zone, mechanics?: [首领机制配置] }],
 *     fields: { 区号: { 和默认场地不同的字段 } },
 *     gaps: { "1-2": { type, hp (null = 按规则掷), open } },
 *     props: [{ kind, zone, level (null = 跟着战斗等级), faction }],
 *     updatedAt }
 */
const BATTLE_TEMPLATE_KEY = "anterscale-battle-templates";
const BATTLE_TEMPLATE_MAX = 200;
const BATTLE_TEMPLATE_WEATHERS = ["none", "heat", "snow", "acid", "thunder", "glow", "sand", "phase"];
const BATTLE_TEMPLATE_PROPS = ["button", "lever", "battery", "boom", "acid", "scrap", "turret"];
const BATTLE_TEMPLATE_GAPS = ["open", "bridge", "wall", "door", "void"];
const BATTLE_TEMPLATE_TIERS = { normal: "普通", elite: "精英", boss: "首领" };
/** 编辑表单里一区的「主场地」选项（和战场配置面板的 setField 一样） */
const BATTLE_TEMPLATE_FIELD_KINDS = { "": "无", fireOn: "火场", ice: "冰面", acid: "酸液", electric: "电场", energy: "能量", harmonic: "谐波", heal: "疗愈", abyss: "深渊", collapseOn: "坍塌", ruinOn: "损毁地面", isolate: "隔离区" };

function btClone(x) { return JSON.parse(JSON.stringify(x)); }
function btInt(v, d, lo, hi) {
  let n = v === null || v === undefined || v === "" ? d : Math.floor(Number(v));
  if (!isFinite(n)) n = d;
  return Math.min(hi, Math.max(lo, n));
}
/** 2 / 3 = 普通直排；其他 = 特殊棋盘名 */
function btBoard(v) {
  if (typeof v === "string" && typeof BOARD_LAYOUTS !== "undefined" && BOARD_LAYOUTS[v]) {
    if (v === "line2") return 2;
    if (v === "line3") return 3;
    return v;
  }
  return Number(v) === 3 ? 3 : 2;
}
function btLayout(board) {
  if (typeof board === "string" && typeof BOARD_LAYOUTS !== "undefined") return BOARD_LAYOUTS[board];
  return typeof BOARD_LAYOUTS !== "undefined" ? BOARD_LAYOUTS[board === 3 ? "line3" : "line2"] : null;
}
function battleTemplateZones(board) {
  const b = btLayout(btBoard(board));
  if (b) return b.zones.map(z => Number(z.id)).sort((x, y) => x - y);
  return btBoard(board) === 3 ? [1, 2, 3] : [1, 2];
}
function battleTemplateGapKeys(board) {
  const b = btLayout(btBoard(board));
  if (!b) return btBoard(board) === 3 ? ["1-2", "2-3"] : ["1-2"];
  return b.links.map(([x, y]) => Math.min(x, y) + "-" + Math.max(x, y));
}
function battleTemplateBoardName(board) {
  board = btBoard(board);
  if (board === 2) return "两区";
  if (board === 3) return "三区";
  const b = btLayout(board);
  return b ? b.name : String(board);
}
function btPresetIds() { return typeof enemyPresets === "function" ? enemyPresets().map(p => p.id) : null; }
function btFieldDefaults() { return typeof emptyField === "function" ? emptyField() : {}; }
/** 只留和默认场地不同、类型对得上的字段 */
function btFieldDiff(f) {
  const base = btFieldDefaults(), out = {};
  if (!f || typeof f !== "object") return out;
  Object.keys(base).forEach(k => {
    const v = f[k];
    if (v === undefined || v === base[k]) return;
    if (base[k] === null) { if (v === null || typeof v === "string") out[k] = v == null ? null : String(v).slice(0, 40); return; }
    if (typeof v !== typeof base[k]) return;
    if (typeof v === "number" && !isFinite(v)) return;
    out[k] = v;
  });
  return out;
}
/** 首领机制：只留配置，去掉战斗里的进度（st） */
function btMechanics(list) {
  if (!Array.isArray(list)) return undefined;
  const out = list.filter(m => m && typeof m === "object" && typeof m.type === "string").slice(0, 6).map(m => {
    const c = btClone(m);
    delete c.st;
    return c;
  });
  return out.length ? out : undefined;
}

/** 打赢之后的掉落：{ kuizhi, items: [{ id, qty }] }，没有就是 null */
function btDrops(d) {
  if (!d || typeof d !== "object") return null;
  const known = id => typeof ITEM_CATALOG === "undefined" || Object.prototype.hasOwnProperty.call(ITEM_CATALOG, id);
  const kuizhi = btInt(d.kuizhi, 0, 0, 999999);
  const items = (Array.isArray(d.items) ? d.items : []).filter(x => x && typeof x.id === "string" && known(x.id)).slice(0, 30).map(x => ({ id: x.id, qty: btInt(x.qty, 1, 1, 999) }));
  return kuizhi || items.length ? { kuizhi, items } : null;
}
function battleTemplateNormalize(t) {
  t = t && typeof t === "object" ? t : {};
  const board = btBoard(t.board);
  const zones = battleTemplateZones(board);
  const maxZ = zones[zones.length - 1];
  const zoneOk = (z, d) => { z = btInt(z, d, 1, maxZ); return zones.includes(z) ? z : d; };
  const presets = btPresetIds();
  const lvOf = v => (v === null || v === undefined || v === "") ? null : btInt(v, 1, 1, 30);
  // 个体值水平（enemies.js）：−10～10，空着 = 开战时随机
  const ivOf = v => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) ? null : Math.max(-10, Math.min(10, Math.round(Number(v))));
  const withIv = (row, e) => {
    const iv = e && e.iv && typeof e.iv === "object" ? { hp: ivOf(e.iv.hp), atk: ivOf(e.iv.atk) } : null;
    if (iv && (iv.hp != null || iv.atk != null)) row.iv = iv;
    return row;
  };
  const enemies = (Array.isArray(t.enemies) ? t.enemies : []).filter(e => e && typeof e.preset === "string" && (!presets || presets.includes(e.preset)))
    .slice(0, 30).map(e => {
      const row = withIv({ preset: e.preset, level: lvOf(e.level), zone: zoneOk(e.zone, maxZ) }, e);
      const m = btMechanics(e.mechanics);
      if (m) row.mechanics = m;
      return row;
    });
  const fields = {};
  zones.forEach(z => {
    const src = t.fields && typeof t.fields === "object" ? t.fields[z] || t.fields[String(z)] : null;
    const d = btFieldDiff(src);
    if (Object.keys(d).length) fields[z] = d;
  });
  const gaps = {};
  battleTemplateGapKeys(board).forEach(k => {
    const g = t.gaps && typeof t.gaps === "object" ? t.gaps[k] : null;
    if (!g || !BATTLE_TEMPLATE_GAPS.includes(g.type) || g.type === "open") return;
    gaps[k] = { type: g.type, hp: (g.hp === null || g.hp === undefined || g.hp === "") ? null : btInt(g.hp, 1, 1, 999), open: g.type === "door" ? !!g.open : false };
  });
  const props = (Array.isArray(t.props) ? t.props : []).filter(p => p && BATTLE_TEMPLATE_PROPS.includes(p.kind)).slice(0, 20)
    .map(p => ({ kind: p.kind, zone: zoneOk(p.zone, 1), level: lvOf(p.level), faction: p.faction === "enemy" ? "enemy" : "player" }));
  const defaultPlayer = (btLayout(board) || {}).playerZone || 1;
  // 援军（chain.js）：第几回合抵达、敌人进哪个区；最多 6 波，每波最多 12 个
  const waves = (Array.isArray(t.waves) ? t.waves : []).filter(w => w && typeof w === "object").slice(0, 6).map(w => ({
    turns: btInt(w.turns, 2, 1, 30),
    enemies: (Array.isArray(w.enemies) ? w.enemies : []).filter(e => e && typeof e.preset === "string" && (!presets || presets.includes(e.preset)))
      .slice(0, 12).map(e => withIv({ preset: e.preset, level: lvOf(e.level), zone: zoneOk(e.zone, maxZ) }, e))
  }));
  // 连续战斗：打完接着打的模板（按 id；最多 9 场）
  const chain = (Array.isArray(t.chain) ? t.chain : []).filter(id => typeof id === "string" && /^[\w-]{1,40}$/.test(id)).slice(0, 9);
  return {
    id: typeof t.id === "string" && /^[\w-]{1,40}$/.test(t.id) ? t.id : "bt" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: String(t.name == null ? "" : t.name).trim().slice(0, 40) || "未命名战场",
    note: String(t.note == null ? "" : t.note).slice(0, 300),
    tier: BATTLE_TEMPLATE_TIERS[t.tier] ? t.tier : "normal",
    board,
    weather: BATTLE_TEMPLATE_WEATHERS.includes(t.weather) ? t.weather : "none",
    playerZone: zoneOk(t.playerZone, defaultPlayer),
    enemies, fields, gaps, props, waves, chain,
    drops: btDrops(t.drops),
    updatedAt: Number(t.updatedAt) || Date.now()
  };
}

/* ---------- 存 / 读（本机） ---------- */
function btStore() {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (e) { return null; }
}
function battleTemplateList() {
  const st = btStore();
  let d = null;
  try { d = st ? JSON.parse(st.getItem(BATTLE_TEMPLATE_KEY) || "null") : null; } catch (e) { d = null; }
  const list = d && Array.isArray(d.list) ? d.list : [];
  return list.map(battleTemplateNormalize);
}
function btWrite(list) {
  const st = btStore();
  if (!st) throw new Error("这台电脑存不了模板（浏览器禁用了本地存储）");
  st.setItem(BATTLE_TEMPLATE_KEY, JSON.stringify({ version: 1, list: list.slice(0, BATTLE_TEMPLATE_MAX) }));
}
function battleTemplateById(id) { return battleTemplateList().find(t => t.id === id) || null; }
/** 新建或覆盖（同 id）。返回存好的模板 */
function battleTemplateSave(t) {
  const n = battleTemplateNormalize(Object.assign({}, t, { updatedAt: Date.now() }));
  const list = battleTemplateList();
  const i = list.findIndex(x => x.id === n.id);
  if (i >= 0) list[i] = n;
  else {
    if (list.length >= BATTLE_TEMPLATE_MAX) throw new Error(`模板最多存 ${BATTLE_TEMPLATE_MAX} 个，先删掉一些`);
    list.push(n);
  }
  btWrite(list);
  return n;
}
function battleTemplateDelete(id) {
  const list = battleTemplateList();
  const next = list.filter(t => t.id !== id);
  if (next.length !== list.length) btWrite(next);
  return next.length !== list.length;
}
/** 复制一份（新 id，名字加「副本」） */
function battleTemplateDuplicate(id) {
  const t = battleTemplateById(id);
  if (!t) return null;
  const c = btClone(t);
  delete c.id;
  c.name = (t.name + " 副本").slice(0, 40);
  return battleTemplateSave(c);
}
/** 导出成一段文字（换电脑、发给别的主持人） */
function battleTemplateExport(ids) {
  const list = battleTemplateList().filter(t => !ids || ids.includes(t.id));
  return JSON.stringify({ kind: "backfire-battle-templates", version: 1, list });
}
/** 导入：同 id 的覆盖，其余加在后面。返回导入了几个 */
function battleTemplateImport(text) {
  let d;
  try { d = typeof text === "string" ? JSON.parse(text) : text; } catch (e) { throw new Error("不是有效的模板文字"); }
  const rows = Array.isArray(d) ? d : d && Array.isArray(d.list) ? d.list : d && d.enemies ? [d] : null;
  if (!rows) throw new Error("不是有效的模板文字");
  const list = battleTemplateList();
  let n = 0;
  rows.forEach(r => {
    if (!r || typeof r !== "object") return;
    const t = battleTemplateNormalize(r);
    const i = list.findIndex(x => x.id === t.id);
    if (i >= 0) list[i] = t;
    else if (list.length < BATTLE_TEMPLATE_MAX) list.push(t);
    else return;
    n++;
  });
  btWrite(list);
  return n;
}

/* ---------- 从当前战场记下来 ---------- */
function btMostCommon(arr, d) {
  const count = {};
  arr.forEach(x => { count[x] = (count[x] || 0) + 1; });
  const keys = Object.keys(count);
  if (!keys.length) return d;
  return Number(keys.sort((a, b) => count[b] - count[a])[0]);
}
/** 把战斗画面上现在摆好的东西记成模板（还没存，返回模板对象） */
function battleTemplateCapture(name) {
  const board = state.board && state.board.id && typeof BOARD_LAYOUTS !== "undefined" && BOARD_LAYOUTS[state.board.id] ? state.board.id : Number(state.zoneMode) === 3 ? 3 : 2;
  const gone = u => u.dead || u._removed || u.hidden || u.fused;
  const heroes = (state.units || []).filter(u => u.isPlayer && !gone(u) && !u.weaponOf && !u.escort && !u.isPartner);
  const presets = btPresetIds();
  const enemies = [];
  (state.units || []).forEach(u => {
    if (u.isPlayer || u.isProp || gone(u)) return;
    if (u.kit === "ufo_leg") return;   // 飞碟的机械足跟着本体一起生成
    const preset = u.kit === "ufo_body" ? "ufo_boss" : u.kit;
    if (!preset || (presets && !presets.includes(preset))) return;
    const row = { preset, level: Number(u.level) || 1, zone: Number(u.zone) || 2 };
    const m = btMechanics(u.mechanics);
    if (m) row.mechanics = m;
    enemies.push(row);
  });
  const fields = {};
  Object.keys(state.fields || {}).forEach(z => { fields[z] = btClone(state.fields[z]); });
  const gaps = {};
  Object.keys(state.gaps || {}).forEach(k => {
    const g = state.gaps[k];
    if (g && g.type !== "open") gaps[k] = { type: g.type, hp: Number(g.maxHp) || Number(g.hp) || null, open: !!g.open };
  });
  const props = (state.props || []).filter(p => p && !p.destroyed && !p.dead && BATTLE_TEMPLATE_PROPS.includes(p.kind))
    .map(p => ({ kind: p.kind, zone: Number(p.zone) || 1, level: Number(p.level) || null, faction: p.faction || "player" }));
  const enc = typeof GAME !== "undefined" && GAME && GAME.encounter;
  return battleTemplateNormalize({
    name, board, weather: state.weather || "none", drops: state.battleDrops || null,
    tier: enc && BATTLE_TEMPLATE_TIERS[enc.tier] ? enc.tier : "normal",
    playerZone: btMostCommon(heroes.map(u => Number(u.zone) || 1), (btLayout(board) || {}).playerZone || 1),
    enemies, fields, gaps, props
  });
}

/* ---------- 开战：模板 → 遭遇 ---------- */
/** 转成 buildEncounter 认的遭遇格式（站位锁定，不再随机打乱）。
 *  带连续战斗的：后面几场按模板 id 找到，放进 enc.stages（它们自己的「连续战斗」不再往下展开）；掉落加在一起 */
function battleTemplateToEncounter(t, nested) {
  t = battleTemplateNormalize(t);
  const enc = btOneEncounter(t);
  if (nested) return enc;
  const next = t.chain.map(id => (typeof battleTemplateById === "function" ? battleTemplateById(id) : null)).filter(Boolean);
  if (next.length) {
    enc.stages = next.map(x => battleTemplateToEncounter(x, true));
    const all = [enc.drops].concat(enc.stages.map(s => s.drops)).filter(Boolean);
    if (all.length) {
      const items = {};
      all.forEach(d => (d.items || []).forEach(x => { items[x.id] = (items[x.id] || 0) + x.qty; }));
      enc.drops = { kuizhi: all.reduce((s, d) => s + (Number(d.kuizhi) || 0), 0), items: Object.keys(items).map(id => ({ id, qty: items[id] })) };
    }
    enc.stages.forEach(s => { delete s.drops; delete s.weather; });
  }
  return enc;
}
function btOneEncounter(t) {
  const zones = battleTemplateZones(t.board);
  const enc = {
    id: "tpl:" + t.id, name: t.name, template: t.id, tier: t.tier,
    zoneMode: zones.length, weather: t.weather, playerZone: t.playerZone,
    layout: "custom", layoutLocked: true,
    enemies: t.enemies.map(e => {
      const row = { preset: e.preset, zone: e.zone, count: 1 };
      if (e.level != null) row.level = e.level;
      if (e.iv) row.iv = btClone(e.iv);
      if (e.mechanics) row.mechanics = btClone(e.mechanics);
      return row;
    }),
    fields: btClone(t.fields),
    features: []
  };
  if (t.waves.length) enc.waves = t.waves.map(w => ({ turns: w.turns, enemies: w.enemies.map(e => Object.assign({ preset: e.preset, zone: e.zone, count: 1 }, e.level != null ? { level: e.level } : {}, e.iv ? { iv: btClone(e.iv) } : {})) }));
  if (t.drops) enc.drops = btClone(t.drops);
  if (typeof t.board === "string") enc.board = t.board;
  Object.keys(t.gaps).forEach(k => {
    const g = t.gaps[k];
    const f = { type: "gap", what: g.type, key: k, open: g.open };
    if (g.hp != null) f.hp = g.hp;
    enc.features.push(f);
  });
  t.props.forEach(p => {
    const f = { type: "prop", what: p.kind, zone: p.zone, faction: p.faction };
    if (p.level != null) f.level = p.level;
    enc.features.push(f);
  });
  return enc;
}

/* ---------- 给界面用的说明 ---------- */
function btEnemyName(id) {
  const p = typeof enemyPresets === "function" ? enemyPresets().find(x => x.id === id) : null;
  return p ? p.name : id;
}
/** 一行概括：「三区 · 沙暴 · 持刀暴徒 Lv3（2 区）、…」 */
function battleTemplateSummary(t) {
  t = battleTemplateNormalize(t);
  const W = { none: "", heat: "酷暑", snow: "雪天", acid: "酸雨", thunder: "雷鸣", glow: "微光", sand: "沙暴", phase: "相位" };
  const bits = [battleTemplateBoardName(t.board)];
  if (t.tier !== "normal") bits.push(BATTLE_TEMPLATE_TIERS[t.tier]);
  if (W[t.weather]) bits.push(W[t.weather]);
  const foes = t.enemies.map(e => `${btEnemyName(e.preset)} ${e.level != null ? "Lv" + e.level : "Lv随队"}（${e.zone} 区）${e.mechanics ? "·机制" : ""}`);
  bits.push(foes.length ? foes.join("、") : "没有敌人");
  const extra = [];
  const nf = Object.keys(t.fields).length, ng = Object.keys(t.gaps).length;
  if (nf) extra.push(`${nf} 个区有场地`);
  if (ng) extra.push(`${ng} 处间隙`);
  if (t.props.length) extra.push(`${t.props.length} 个配置物`);
  if (t.waves.length) extra.push(`援军 ${t.waves.length} 波`);
  if (t.chain.length) extra.push(`连续 ${t.chain.length + 1} 场`);
  if (t.drops) extra.push("有掉落");
  return bits.join(" · ") + (extra.length ? `（${extra.join("、")}）` : "");
}
/** 一区的主场地（编辑表单用） */
function battleTemplateFieldKind(f) {
  f = f || {};
  return Object.keys(BATTLE_TEMPLATE_FIELD_KINDS).find(k => k && f[k]) || "";
}
/** 编辑表单改了一区的主场地 / 高地：换成和战场配置面板一样的字段。ruinHp：损毁地面的耐久（不给就用原来的 / 默认值） */
function battleTemplateSetField(t, zone, kind, highland, ruinHp) {
  t.fields = t.fields || {};
  const old = t.fields[zone] || {};
  const f = btFieldDefaults();
  if (kind && BATTLE_TEMPLATE_FIELD_KINDS[kind] !== undefined) { f[kind] = true; if (kind === "fireOn") f.fire = 1; }
  if (kind === "ruinOn") {
    const hp = ruinHp != null ? ruinHp : old.ruinOn ? old.ruinHp : null;
    if (hp != null) f.ruinHp = f.ruinMax = btInt(hp, 30, 1, 999);
  }
  f.highland = !!highland;
  const d = btFieldDiff(f);
  if (Object.keys(d).length) t.fields[zone] = d;
  else delete t.fields[zone];
  return t;
}
