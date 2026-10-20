const ELE = {
  fire: "火", acid: "酸", electric: "电", ice: "冰",
  energy: "能量", physical: "物理", harmonic: "谐波"
};
const LAYER = {
  flesh: "肉体", armor: "装甲", shield: "护盾", sand: "沙尘", spirit: "星灵"
};
const LAYER_COLOR = {
  flesh: "#ef9a9a", armor: "#90a4ae", shield: "#80deea",
  sand: "#ffcc80", spirit: "#b39ddb"
};

const CHART = {
  fire:      { flesh: 0.50, armor: -0.25, shield: 0,     sand: 0,     spirit: -0.25 },
  acid:      { flesh: 0,    armor: 0.50,  shield: -0.25, sand: -0.25, spirit: 0 },
  electric:  { flesh: 0,    armor: -0.25, shield: 0.50,  sand: -0.25, spirit: 0 },
  ice:       { flesh: 0,    armor: 0,     shield: 0,     sand: 0,     spirit: -0.25 },
  energy:    { flesh: 0,    armor: -0.25, shield: 0,     sand: 0,     spirit: 0.50 },
  physical:  { flesh: 0,    armor: -0.25, shield: -0.25, sand: 0,     spirit: 0 },
  harmonic:  { flesh: -0.25,armor: -0.25, shield: -0.25, sand: 0.50,  spirit: 0 }
};

function uid() {
  return "u" + Math.random().toString(36).slice(2, 9);
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function diceExpect(n, s, b) {
  if (!n || !s) return b || 0;
  return n * (s + 1) / 2 + (b || 0);
}

function rollDice(n, s, b) {
  if (!n || !s) return { total: b || 0, parts: [], text: String(b || 0) };
  const parts = [];
  let total = b || 0;
  for (let i = 0; i < n; i++) {
    const v = 1 + Math.floor(Math.random() * s);
    parts.push(v);
    total += v;
  }
  const label = `${n}d${s}${b ? "+" + b : ""}`;
  const text = `${label}〔${parts.join("+")}${b ? "+" + b : ""}〕=${total}`;
  return { total, parts, text };
}

function takeDice(n, s, b) {
  return rollDice(n, s, b || 0);
}

function totalMaxHp(unit) {
  return (unit.layers || []).reduce((s, l) => s + Number(l.max || 0), 0);
}

/** 不含临时血量（废物利用、拆卸等战斗内获得、战斗结束消失的部分）的血量上限 */
function baseMaxHp(unit) {
  return (unit.layers || []).reduce((s, l) => {
    if (l.temp) return s;
    return s + Math.max(0, Number(l.max || 0) - Number(l.tempBonus || 0) - tempShieldOf(l));
  }, 0);
}

/* ---------- 临时护盾 ----------
 * 技能、道具、扫描……施加的护盾都是临时护盾（tempShield）：并在护盾层里显示，不算额外一层，克制表照护盾算；
 * 但不会在「一回合没挨打」时回满——单位自带的那部分护盾才回满。挨打时临时护盾先扣。
 * 护盾层的 max = 自带上限 + 剩下的临时护盾；临时护盾扣掉多少，max 就跟着少多少，所以「回满」（current = max）只补自带的部分。
 * 不管伤害从哪条路扣的护盾，syncTempShield 按上次记下的 current（_lastCur）结算掉了多少。 */
function tempShieldOf(layer) { return layer && layer.type === "shield" ? Math.max(0, Number(layer.tempShield) || 0) : 0; }
function syncTempShield(unit) {
  if (!unit || !unit.layers) return;
  unit.layers.forEach(l => {
    if (l.type !== "shield") return;
    const cur = Math.max(0, Number(l.current) || 0);
    const t = tempShieldOf(l);
    if (t > 0 && l._lastCur != null) {
      const use = Math.min(t, Math.max(0, Number(l._lastCur) - cur));
      if (use > 0) { l.tempShield = t - use; l.max = Math.max(0, (Number(l.max) || 0) - use); }
    }
    if (tempShieldOf(l) > cur) { l.max = Math.max(0, (Number(l.max) || 0) - (tempShieldOf(l) - cur)); l.tempShield = cur; }
    if (l.current > l.max) l.current = l.max;
    l._lastCur = Math.max(0, Number(l.current) || 0);
  });
  // 纯临时的护盾层（单位本来没有护盾）用完就去掉
  unit.layers = unit.layers.filter(l => !(l.type === "shield" && (l.granted || l.temp) && !l.batteryShield && !(Number(l.max) > 0)));
}
/** 加临时护盾：并进现有的护盾层（没有就新开一层，标 granted） */
function addTempShield(unit, amt) {
  amt = Math.max(0, Math.floor(Number(amt) || 0));
  if (!unit || !amt) return null;
  unit.layers = unit.layers || [];
  syncTempShield(unit);
  let layer = unit.layers.find(l => l.type === "shield" && !l.batteryShield);
  if (!layer) { layer = { type: "shield", current: 0, max: 0, granted: true }; unit.layers.unshift(layer); }
  layer.max = (Number(layer.max) || 0) + amt;
  layer.current = (Number(layer.current) || 0) + amt;
  layer.tempShield = tempShieldOf(layer) + amt;
  layer._lastCur = layer.current;
  return layer;
}

/** 给单位加一段临时血量层（战斗结束消失）。已有同类型的层就叠上去，并记在 tempBonus 里，
 *  这样战斗结束只扣掉加上去的那部分，原本的层不受影响。 */
function addTempLayer(unit, type, amt) {
  amt = Math.max(0, Number(amt) || 0);
  if (!unit || !amt) return null;
  if (type === "shield") return addTempShield(unit, amt);   // 护盾一律是临时护盾
  unit.layers = unit.layers || [];
  let layer = unit.layers.find(l => l.type === type);
  if (!layer) {
    layer = { type, current: 0, max: 0, temp: true };
    unit.layers.unshift(layer);
  } else if (!layer.temp) {
    layer.tempBonus = (Number(layer.tempBonus) || 0) + amt;
  }
  layer.max = (Number(layer.max) || 0) + amt;
  layer.current = (Number(layer.current) || 0) + amt;
  return layer;
}

/** 不含临时部分的各层当前值（跨战斗存档用：临时层不存，叠加的临时部分截掉） */
function persistentLayers(unit) {
  // 机甲模式：瑞比身上标了 mecha 的外层是明特的，记到明特名下；明特（合体中）读瑞比身上的那几层
  let src = (unit.layers || []).filter(l => !l.mecha);
  if (unit.kit === "mint" && unit.fused && typeof state !== "undefined") {
    const ruby = (state.units || []).find(x => x.kit === "ruby" && x.resources && x.resources.mecha);
    if (ruby) src = (ruby.layers || []).filter(l => l.mecha);
  }
  return src.filter(l => !l.temp).map(l => {
    const cap = Math.max(0, Number(l.max || 0) - Number(l.tempBonus || 0) - tempShieldOf(l));
    return { type: l.type, current: Math.max(0, Math.min(cap, Number(l.current) || 0)) };
  });
}

/** 战斗结束：去掉临时层，以及叠在原有层上的临时部分 */
function stripTempLayers(unit) {
  if (!unit || !unit.layers) return;
  unit.layers = unit.layers.filter(l => !l.temp && !(l.type === "shield" && l.granted));
  unit.layers.forEach(l => {
    const ts = tempShieldOf(l);
    if (ts) { l.max = Math.max(0, (Number(l.max) || 0) - ts); l.current = Math.min(Number(l.current) || 0, l.max); l.tempShield = 0; }
    const b = Number(l.tempBonus) || 0;
    if (!b) return;
    l.max = Math.max(0, (Number(l.max) || 0) - b);
    l.current = Math.min(Number(l.current) || 0, l.max);
    l.tempBonus = 0;
  });
}

function totalCurHp(unit) {
  return (unit.layers || []).reduce((s, l) => s + Math.max(0, Number(l.current || 0)), 0);
}

function livingLayers(unit) {
  return (unit.layers || []).filter(l => Number(l.current) > 0);
}

/** 内层血量。标记写在层对象上，所以错位这类交换层顺序的效果不会改变哪一层算内层。
 *  内层归零 = 这个单位死亡（玩家角色则进入濒死）。 */
function markInnerLayer(unit) {
  const ls = (unit && unit.layers) || [];
  if (!ls.length) return null;
  let inner = ls.find(l => l && l.inner);
  if (!inner) {
    inner = ls[ls.length - 1];
    inner.inner = true;
  }
  ls.forEach(l => { if (l !== inner) delete l.inner; });
  return inner;
}

function innermostLayer(unit) {
  const ls = (unit && unit.layers) || [];
  if (!ls.length) return null;
  return ls.find(l => l && l.inner) || markInnerLayer(unit);
}

function innerHp(unit) {
  const l = innermostLayer(unit);
  return l ? Math.max(0, Number(l.current) || 0) : 0;
}

function isInnerDepleted(unit) {
  return innerHp(unit) <= 0;
}

function isUnitDown(unit) {
  if (!unit) return true;
  if (unit.dead) return true;
  if (unit.upOnShp && (Number(unit.shp) || 0) > 0) return false;
  return isInnerDepleted(unit);
}

function outerLayer(unit) {
  return livingLayers(unit)[0] || null;
}

function secondOuterLayer(unit) {
  return livingLayers(unit)[1] || livingLayers(unit)[0] || null;
}

function innermostOrganic(unit) {
  const pref = ["flesh", "spirit", "sand"];
  const layers = unit.layers || [];
  for (let i = layers.length - 1; i >= 0; i--) {
    if (pref.includes(layers[i].type) && Number(layers[i].current) > 0) return layers[i];
    if (pref.includes(layers[i].type)) return layers[i];
  }
  return layers[layers.length - 1] || null;
}

/* ===== 区制棋盘（拓扑）=====
 * 战场由若干「区」拼成：每个区有编号（1…N，连续）和在棋盘上的格子坐标 x / y（画面按坐标摆），
 * 区和区之间的「连接」决定相邻关系；距离 = 沿连接走几步（2×2 方形对角是距离 2，十字形两臂之间是 2）。
 * 每条连接上可以有间隔（危墙、桥梁、空隙、机关门），键是 gapKey(a, b) = "小-大"。
 * 普通战斗还是两区 / 三区直排（state.board 为空时按 state.zoneMode 当直排处理，行为和以前完全一样）；
 * 特殊棋盘（大型 boss 用）通过 applyBoard(布局名或布局对象) 换上，state.zoneMode = 区数。
 *   布局对象：{ id, name, zones: [{ id, x, y }], links: [[a, b], …], playerZone, enemyZone } */
const BOARD_LAYOUTS = {
  line2:   { name: "两区直排", zones: [{ id: 1, x: 0, y: 0 }, { id: 2, x: 1, y: 0 }], links: [[1, 2]], playerZone: 1, enemyZone: 2 },
  line3:   { name: "三区直排", zones: [{ id: 1, x: 0, y: 0 }, { id: 2, x: 1, y: 0 }, { id: 3, x: 2, y: 0 }], links: [[1, 2], [2, 3]], playerZone: 1, enemyZone: 3 },
  line4:   { name: "四区直排", zones: [1, 2, 3, 4].map((id, i) => ({ id, x: i, y: 0 })), links: [[1, 2], [2, 3], [3, 4]], playerZone: 1, enemyZone: 4 },
  square4: { name: "四区方形（2×2）", zones: [{ id: 1, x: 0, y: 0 }, { id: 2, x: 1, y: 0 }, { id: 3, x: 0, y: 1 }, { id: 4, x: 1, y: 1 }],
             links: [[1, 2], [1, 3], [2, 4], [3, 4]], playerZone: 3, enemyZone: 2 },
  cross5:  { name: "五区十字", zones: [{ id: 1, x: 1, y: 0 }, { id: 2, x: 0, y: 1 }, { id: 3, x: 1, y: 1 }, { id: 4, x: 2, y: 1 }, { id: 5, x: 1, y: 2 }],
             links: [[1, 3], [2, 3], [3, 4], [3, 5]], playerZone: 5, enemyZone: 3 }
};
Object.keys(BOARD_LAYOUTS).forEach(k => { BOARD_LAYOUTS[k].id = k; });
/** 现在用的棋盘。没有特殊棋盘时按区制当直排 */
function currentBoard(zoneMode) {
  const b = typeof state !== "undefined" ? state.board : null;
  if (b && Array.isArray(b.zones) && b.zones.length) return b;
  const m = Number(zoneMode != null ? zoneMode : (typeof state !== "undefined" ? state.zoneMode : 2));
  return m === 3 ? BOARD_LAYOUTS.line3 : BOARD_LAYOUTS.line2;
}
function isLineBoard(b) { b = b || currentBoard(); return /^line/.test(b.id || "") || (b.zones || []).every(z => Number(z.y) === 0); }
/** 所有区编号（从小到大） */
function boardZoneIds(b) { return (b || currentBoard()).zones.map(z => Number(z.id)).sort((x, y) => x - y); }
function boardZone(id, b) { return (b || currentBoard()).zones.find(z => Number(z.id) === Number(id)) || null; }
function boardLinks(b) { return ((b || currentBoard()).links || []).map(([x, y]) => [Number(x), Number(y)]); }
/** 和 z 相邻的区（有连接） */
function zoneNeighbors(z, b) {
  z = Number(z);
  return boardLinks(b).filter(l => l[0] === z || l[1] === z).map(l => (l[0] === z ? l[1] : l[0])).sort((x, y) => x - y);
}
function zonesAdjacent(a, b, board) { return zoneNeighbors(a, board).includes(Number(b)); }
const _boardDistCache = new Map();
function boardDistTable(b) {
  b = b || currentBoard();
  const key = b.key || (b.key = (b.id || "custom") + ":" + JSON.stringify(b.links));
  if (_boardDistCache.has(key)) return _boardDistCache.get(key);
  const ids = boardZoneIds(b), table = {};
  ids.forEach(src => {
    const d = { [src]: 0 }, q = [src];
    while (q.length) { const z = q.shift(); zoneNeighbors(z, b).forEach(n => { if (d[n] == null) { d[n] = d[z] + 1; q.push(n); } }); }
    table[src] = d;
  });
  _boardDistCache.set(key, table);
  return table;
}
/** 两区之间的距离：沿连接走几步（直排就是编号差）。zoneMode 参数保留给旧调用（没有特殊棋盘时决定两区 / 三区） */
function zoneDist(a, b, zoneMode) {
  if (a == null || b == null) return 0;
  const board = currentBoard(zoneMode);
  const row = boardDistTable(board)[Number(a)];
  const d = row ? row[Number(b)] : null;
  if (d != null) return d;
  // 不在棋盘上的区号（旧档 / 计算器里两区制留着的 3 区）：按以前的直排算法
  if (!(typeof state !== "undefined" && state.board)) return Number(zoneMode != null ? zoneMode : state.zoneMode) === 2 ? (Number(a) === Number(b) ? 0 : 1) : Math.abs(Number(a) - Number(b));
  return 99;
}
/** 换上一个棋盘（布局名或布局对象；null = 回到普通的两区 / 三区直排）。补齐每个区的场地、每条连接的间隔 */
function applyBoard(spec) {
  if (typeof state === "undefined") return null;
  if (!spec) { state.board = null; return null; }
  const src = typeof spec === "string" ? BOARD_LAYOUTS[spec] : spec;
  if (!src || !Array.isArray(src.zones) || !src.zones.length) throw new Error("没有这种棋盘：" + spec);
  const b = JSON.parse(JSON.stringify(src));
  b.id = b.id || "custom";
  delete b.key;
  const ids = boardZoneIds(b);
  ids.forEach((id, i) => { if (id !== i + 1) throw new Error("棋盘的区编号要从 1 开始连续"); });
  // 直排两区 / 三区就是普通区制，不另外存棋盘
  if (b.id === "line2" || b.id === "line3") { state.board = null; state.zoneMode = ids.length; }
  else { state.board = b; state.zoneMode = ids.length; }
  state.fields = state.fields || {};
  ids.forEach(id => { if (!state.fields[id] && typeof emptyField === "function") state.fields[id] = emptyField(); });
  state.gaps = state.gaps || {};
  const keys = boardGapKeys(b);
  if (state.board) Object.keys(state.gaps).forEach(k => { if (!keys.includes(k)) delete state.gaps[k]; });   // 直排留下的、这块棋盘上没有的连接
  keys.forEach(k => { if (!state.gaps[k] && typeof emptyGap === "function") state.gaps[k] = emptyGap(); });
  // 换了棋盘：风向换成这块棋盘能用的方向（直排的 "12" / "21" → 往右 / 往左；没有左右就往下 / 往上）
  if (typeof sandDirOptions === "function") {
    const opts = sandDirOptions();
    if (!opts.includes(state.sandDir)) {
      const map = state.sandDir === "21" ? ["W", "N", "21"] : ["E", "S", "12"];
      state.sandDir = map.find(d => opts.includes(d)) || opts[0];
    }
  }
  return b;
}
/** 每条连接的间隔键（"1-2" …） */
function boardGapKeys(b) { return boardLinks(b).map(([x, y]) => (typeof gapKey === "function" ? gapKey(x, y) : Math.min(x, y) + "-" + Math.max(x, y))); }
/** from 到 dest 的一条最短路线（含两端），走不到返回 null。passable(a, b) 可以排除某些连接 */
function zonePath(from, dest, passable, b) {
  from = Number(from); dest = Number(dest);
  if (from === dest) return [from];
  const prev = { [from]: null }, q = [from];
  while (q.length) {
    const z = q.shift();
    for (const n of zoneNeighbors(z, b)) {
      if (prev[n] !== undefined || (passable && !passable(z, n))) continue;
      prev[n] = z;
      if (n === dest) { const path = [n]; let c = z; while (c != null) { path.unshift(c); c = prev[c]; } return path; }
      q.push(n);
    }
  }
  return null;
}
/** 特殊棋盘：队员默认站在布局写的我方区（普通直排不动，还是 1 区） */
function placePartyOnBoard() {
  const b = typeof state !== "undefined" ? state.board : null;
  if (!b || !b.playerZone) return;
  (state.units || []).forEach(u => { if (u.isPlayer && Number(u.zone) === 1) u.zone = Number(b.playerZone); });
}
/** 普通区制下的一份干净场地 / 间隔（新建战场用） */
function freshBoardState(zoneMode) {
  state.board = null;
  state.zoneMode = Number(zoneMode) === 3 ? 3 : 2;
  state.fields = { 1: emptyField(), 2: emptyField(), 3: emptyField() };
  state.gaps = { "1-2": emptyGap(), "2-3": emptyGap() };
}

/* 少数技能的真实射程没法从提示文字推出来，在这里写明，优先于文字解析。
 * 通常是两类：先移动再作用（文字里的「同区」指的是移动之后），
 * 以及同区和距离 1 都允许（文字只写了其中一个距离）。 */
const SKILL_RANGE = {
  // 声波切割：同区目标、距离 1 的目标各可选一个（至少一个），在技能分步里选。
  // 提示文字里有「距离1」，不写明会被误判成只能打距离 1
  tou_sonic: { min: 0, max: 1 },
  tou_start: { min: 0, max: 1 },      // 先移动 ≤1，再对到达后的同区敌人施加错位
  mochi_pounce: { min: 0, max: 1 },   // 跃向距离 1 的敌人，或带走同区敌人
  // 诺拉普攻的射程随刺入变化，见下面的 SKILL_RANGE_BY_STATE
  nora_needle: { min: 0, max: 1 },
  latte_love: { min: 0, max: 99 },    // 爱意：移动到一名友方的区域（提示里的「同区」指移动之后）
  // 焰袭由夕夏在收回武器后结算，射程按夕夏算，技能内部另有判定。
  // 写在这里是为了避免提示里的「不同区」被解析成「同区」。
  berniel_flare: { min: 0, max: 99 },
  chuan_aa: { min: 0, max: 0 },       // 川川普通攻击是近距离
  bare_aa: { min: 0, max: 0 },        // 空手攻击一律同区
  chuan_blade: { min: 0, max: 1 },   // 巨刃划空：1 距离以内
  kolt_rot: { min: 1, max: 1 },      // 腐坏抛射：1 距离的敌人
  kolt_mod: { min: 0, max: 1 },      // 「非法」改装：1 距离以内任意单位
  xia_crush: { min: 0, max: 0 },
  kolt_aa: { min: 0, max: 1 },
  // 更换刀头的追击射程取决于换上去的新刀头（电钻近距离 / 酸液炮远距离），
  // 所以外层放到 0–1，具体由技能内部按新刀头判定
  kolt_swap: { min: 0, max: 0 },   // 更换刀头的切刀攻击总是打同区
  kolt_short: { min: 0, max: 1 },
  kolt_chase: { min: 0, max: 99 },
  torque_boost: { min: 0, max: 1 },
  torque_swap: { min: 0, max: 1 },   // 拆装部件：电钻打同区、酸液炮打距离 1（按换上去的刀头）
  torque_strip: { min: 0, max: 0 },
  helu_aa: { min: 1, max: 1 },
  helu_scan: { min: 0, max: 99 },
  ecmo_bite: { min: 0, max: 0 },
  ecmo_focus: { min: 0, max: 99 },
  ecmo_boom: { min: 0, max: 0 },
  ras_aa: { min: 1, max: 1 },
  ras_dump: { min: 0, max: 99 },
  ras_flee: { min: 0, max: 99 },
  edc_shock: { min: 1, max: 1 },      // 电流冲击：距离 1 的敌人
  edc_flash: { min: 0, max: 0 },
  // 龙哥：手杖近距离、霰弹枪远距离（距离 1），按分步里选的模式在技能内部再判定
  longge_aa: { min: 0, max: 1 },
  longge_chill: { min: 0, max: 1 },
  longge_spit: { min: 0, max: 0 },     // 吐酸：近距离
  xiaoxiao_punch: { min: 0, max: 0 },  // 直冲拳：近距离
  xiaoxiao_combo: { min: 0, max: 0 },  // 连续拳：近距离
  longge_heat: { min: 0, max: 0 },     // 热能轰击：手杖、霰弹枪都是近距离
  ras_torrent: { min: 0, max: 99 },    // 狂瀑：任意距离的高能敌人
  ruby_algo: { min: 0, max: 99 },      // 算法改变：任意距离
  latte_claw: { min: 0, max: 0 },
  naruto_frost: { min: 0, max: 0 },
  tou_accuse: { min: 0, max: 1 },
  tou_bash: { min: 0, max: 1 },        // 盾击突进：先移动 ≤1，再打到达后同区的敌人（按出发位置算是距离 0–1）
  mochi_bite: { min: 0, max: 0 },
  yuito_duet: { min: 0, max: 99 },
};

/* 技能能选哪一边的目标。界面原本是从提示文字里猜的（出现「友方」就只让选友方），
 * 对「打敌人、顺带治疗友方」这类技能会猜错。这里写明的优先于文字猜测。
 *   enemy 只能选敌人 / ally 只能选友方（不含自己）/ allySelf 友方含自己 / any 敌我皆可 */
const SKILL_TARGET_SIDE = {
  vitas_dance: "enemy",     // 三段冰伤打敌人，温和的治疗只是附带效果
  yuito_espresso: "enemy",  // 加行动点那一档在分步里选友方，走到这里的是酸液攻击
  nora_needle: "any",       // 针尖可以扎敌人，也可以扎队友当治疗手段
  nora_aa: "any",           // 有刺入时打刺入目标，刺入的可能是队友
  kolt_mod: "anySelf",
  ras_torrent: "enemy",
  ruby_algo: "enemy",
  latte_claw: "enemy",
  naruto_frost: "enemy",
  tou_accuse: "enemy",
  mochi_bite: "enemy",
  yuito_duet: "allySelf",
  chuan_reclaim: "allySelf", // 回收护盾：任意一名友方（含自己）      // 「非法」改装：任意单位（含自己）施加过载
  role_renew: "ally",       // 续命：任意距离一名友方（以前没登记，被推断成敌方）
  role_harsh: "anySelf",    // 恶劣环境：「一名单位」敌我都行（以前被推断成只能选敌人）
  role_double_dot: "enemy", // 加倍计量：一个敌人
  chuan_over: "anySelf"     // 电站超频：任意单位（敌人也行：主动让敌人过载），也可以对川川自己用
};

/** 射程随状态变的技能（例如绯秋的普攻按刀势）。返回 {min,max}，不在表里返回 null */
const SKILL_RANGE_BY_STATE = {
  // 拔刀 / 胁构：只打同区；居合：先移动 1 距离再出刀，所以最远打到距离 1
  hiaki_aa: (a) => ((a && a.resources && a.resources.stance) === "iai" ? { min: 0, max: 1 } : { min: 0, max: 0 }),
  // 诺拉普攻：没有刺入时是「距离 1 的敌人」；有刺入时针尖把两人连在一起，刺入目标在同区也能打（刺入超过距离 1 会自己断）
  // 碎渣重炮：酸液炮（迫击炮，越墙）距离 1-2；电钻（机枪，选区域）距离 0-1
  kolt_cannon: (a) => ((a && a.resources && a.resources.bit) === "acid" ? { min: 1, max: 2 } : { min: 0, max: 1 }),
  nora_aa: (a) => (typeof piercedTargets === "function" && a && piercedTargets(a).length ? { min: 0, max: 1 } : { min: 1, max: 1 })
};
/** 技能射程：先看随状态变的表，再看固定表（SKILL_RANGE）。都没写返回 null（由提示文字推断） */
function skillRangeFor(actor, id) {
  const fn = SKILL_RANGE_BY_STATE[id];
  if (fn) return fn(actor);
  return (typeof SKILL_RANGE !== "undefined" && SKILL_RANGE[id]) || null;
}

function parseSkillRange(text) {
  const s = String(text || "");
  if (/任意距离/.test(s)) return { min: 0, max: 99 };
  const scan = (chunk) => {
    if (!chunk) return null;
    if (/距离\s*1\s*以?内|1距离以?内/.test(chunk)) return { min: 0, max: 1 };
    const span = chunk.match(/距离\s*(\d)\s*[-~到至]\s*(\d)/);
    if (span) return { min: Number(span[1]), max: Number(span[2]) };
    const one = chunk.match(/距离\s*(\d+)/);
    if (one) return { min: Number(one[1]), max: Number(one[1]) };
    if (/近距离|近战/.test(chunk)) return { min: 0, max: 0 };
    if (/同区域|同区/.test(chunk) && !/同区其他|同区其余|同区域其他/.test(chunk)) return { min: 0, max: 0 };
    return null;
  };
  const parts = s.split(/[·。；]/).map(x => x.trim()).filter(Boolean);
  for (const part of parts) {
    const r = scan(part);
    if (r) return r;
  }
  return scan(s);
}

function inSkillRange(actor, target, text, zoneMode) {
  const r = parseSkillRange(text);
  if (!r || !actor || !target) return true;
  const d = zoneDist(actor.zone, target.zone, zoneMode != null ? zoneMode : (typeof state !== "undefined" ? state.zoneMode : 2));
  return d >= r.min && d <= r.max;
}

/** field：受击者所在区的场地（飞行单位、保释中的单位由调用方传空——冻土对飞行无效）；
 *  fieldMult：恶劣环境 / 末日让场地效果翻倍（冻土对冰 25% → 50%） */
function chartMod(element, layerType, weather, field, acidRainCancelArmor, fieldMult) {
  // 平衡测算（tools/dpt.js）：关掉属性克制表，所有属性对所有血量层都按 0 修正
  if (typeof state !== "undefined" && state && state.noChart) return 0;
  let table = CHART[element];
  if (!table) return 0;
  let v = table[layerType] || 0;

  if (weather === "glow" && element !== "energy") {
    v = -v;
  }
  // 冻土：强制冰属性对目标易伤 25%（恶劣环境/末日可翻倍）。独立于天气，雪天等天气修正不会覆盖或取消这个强制易伤。
  if (field && field.ice && element === "ice") {
    v = 0.25 * (Number(fieldMult) || 1);
  }
  if (acidRainCancelArmor && layerType === "armor" && element !== "acid" && element !== "ice") {
    v += 0.25;
  }
  return v;
}

function matchupKind(mod) {
  if (mod > 0.001) return "adv";
  if (mod < -0.001) return "dis";
  return "neu";
}

/** 沙暴风向：1 顺风 / -1 逆风 / 0 无风向。
 *  三区制下中间 2 区不受风向影响；电/酸伤害修正与沙尘回复仍全局生效。
 */
/* 沙暴风向：直排棋盘用 "12"（从 1 区吹向另一头）/ "21"；其他棋盘用 E / W / S / N（往右 / 往左 / 往下 / 往上吹）。
 * 顺风 = 上风那半边，逆风 = 下风那半边，正好在中线上的区无风向（直排三区的 2 区）。 */
const SAND_WIND_VEC = { "12": [1, 0], E: [1, 0], "21": [-1, 0], W: [-1, 0], S: [0, 1], N: [0, -1] };
function sandWind(zone, zoneMode, sandDir) {
  const z = Number(zone);
  const dir = sandDir || "12";
  const b = typeof currentBoard === "function" ? currentBoard(zoneMode) : null;
  const zz = b ? boardZone(z, b) : null;
  if (!zz) {
    const mode = Number(zoneMode) || 2;
    if (mode === 3 && z === 2) return 0;
    if (dir === "12") return z === 1 ? 1 : -1;
    return z === 1 ? -1 : 1;
  }
  const [dx, dy] = SAND_WIND_VEC[dir] || SAND_WIND_VEC["12"];
  const along = (q) => Number(q.x) * dx + Number(q.y) * dy;
  const vals = b.zones.map(along);
  const mid = (Math.min(...vals) + Math.max(...vals)) / 2;
  const v = along(zz);
  if (Math.abs(v - mid) < 1e-9) return 0;
  return v < mid ? 1 : -1;
}
/** 这块棋盘能用的风向（直排只有两个方向；方形 / 十字四个方向都有） */
function sandDirOptions() {
  const b = typeof currentBoard === "function" ? currentBoard() : null;
  if (!b || isLineBoard(b)) return ["12", "21"];
  const xs = b.zones.map(q => q.x), ys = b.zones.map(q => q.y);
  const out = [];
  if (Math.max(...xs) > Math.min(...xs)) out.push("E", "W");
  if (Math.max(...ys) > Math.min(...ys)) out.push("S", "N");
  return out.length ? out : ["12", "21"];
}
/** 反过来吹 */
function reverseSandDir(dir) { return ({ "12": "21", "21": "12", E: "W", W: "E", S: "N", N: "S" })[dir || "12"] || "21"; }

/** 沙暴风向（玩家手册：从 1 区吹向 2 区或相反，总是对释放者所在区域顺风）。
 *  有释放者时让他所在的区顺风；没有（开场天气、手动切换）就随机。返回 "12" 或 "21"。 */
function rollSandDir(casterZone) {
  const opts = sandDirOptions();
  let dir;
  if (opts[0] === "12") {
    // 直排：和以前一样（1 区吹向另一头 / 反过来），释放者那一区总是顺风
    const z = Number(casterZone);
    if (z === 1) dir = "12";
    else if (z >= 2 && !(Number(state.zoneMode) === 3 && z === 2)) dir = "21";
    else dir = Math.random() < 0.5 ? "12" : "21";
  } else {
    const good = casterZone != null ? opts.filter(d => sandWind(casterZone, state.zoneMode, d) > 0) : [];
    const pool = good.length ? good : opts;
    dir = pool[Math.floor(Math.random() * pool.length)];
  }
  state.sandDir = dir;
  return dir;
}
/** 风向文字：「1 区 → 2 区」（三区制是 1 区 → 3 区） */
function sandDirText(dir, zoneMode) {
  const named = { E: "从左往右吹 →", W: "从右往左吹 ←", S: "从上往下吹 ↓", N: "从下往上吹 ↑" };
  if (named[dir]) return named[dir];
  const b = typeof currentBoard === "function" ? currentBoard(zoneMode) : null;
  const last = b ? Math.max(...boardZoneIds(b)) : (Number(zoneMode) === 3 ? 3 : 2);
  return (dir || "12") === "12" ? `1 区 → ${last} 区` : `${last} 区 → 1 区`;
}

function sandWindLabel(v) {
  if (v > 0) return "顺风";
  if (v < 0) return "逆风";
  return "无风向";
}

function weatherDamagePct(weather, element) {
  switch (weather) {
    case "heat":
      if (element === "fire" || element === "acid") return 0.25;
      if (element === "ice") return -0.25;
      return 0;
    case "snow":
      if (element === "ice" || element === "physical") return 0.25;
      if (element === "fire" || element === "acid") return -0.25;
      return 0;
    case "acid":
      if (element === "acid" || element === "electric") return 0.25;
      if (element !== "acid" && element !== "electric" && element !== "energy") return -0.25;
      return 0;
    case "thunder":
      if (element === "electric" || element === "energy") return 0.25;
      return 0;
    case "glow":
      if (element === "energy") return 0.25;
      return 0;
    case "sand":
      if (element === "electric" || element === "acid") return -0.25;
      return 0;
    default:
      return 0;
  }
}

/** 干涉场叠层上限（作者定）：±100%，到顶后不再叠加（以前无上限，曾叠到 −2425% 把伤害全变成 0） */
const INTERFERE_CAP = 1;
function milestone(level, every = 5) {
  // 达到 5/10/15… 或 2/4/6… 的当级就加，不是下一级才加
  return Math.floor(Math.max(1, Number(level) || 1) / every);
}
function dieStep(level, every = 5) {
  return milestone(level, every);
}

const DIE_LADDER = [4, 6, 8, 10, 12, 20];
function upgradeDieSides(baseSides, steps) {
  let i = DIE_LADDER.indexOf(Number(baseSides));
  if (i < 0) i = 0;
  const s = Math.max(0, Number(steps) || 0);
  return DIE_LADDER[Math.min(DIE_LADDER.length - 1, i + s)];
}
function leveledSides(level, baseSides) {
  return upgradeDieSides(baseSides || 4, dieStep(level, 5));
}

/** envX：恶劣环境 / 末日让天气效果翻倍（腐蚀：酷暑 / 酸雨 +2 个骰，雪天骰数减半两次） */
function statusDotDice(kind, level, weather, extraArmor = false, envX = 1) {
  const step = dieStep(level, 5);
  envX = Math.max(1, Number(envX) || 1);
  if (kind === "burn") {
    const s = upgradeDieSides(4, step);
    return { n: 1, s, label: `1d${s}×层` };
  }
  if (kind === "shock") {
    const s = upgradeDieSides(4, step);
    const penalty = weather === "thunder" ? 0 : (1 + step);
    return { n: 1, s, bonus: -penalty, min: 1, label: `1d${s}${penalty ? "−" + penalty : ""}` };
  }
  if (kind === "corr") {
    let n = 2;
    if (weather === "heat") n += envX;
    if (weather === "acid") n += envX;
    if (weather === "snow") n = Math.max(1, Math.floor(n / Math.pow(2, envX)));
    const s = upgradeDieSides(4, step + (extraArmor ? 1 : 0));
    return { n, s, label: `${n}d${s}` };
  }
  if (kind === "firefield") {
    const s = upgradeDieSides(4, step);
    return { n: 1, s, label: `1d${s}×层` };
  }
  if (kind === "acidfield") {
    let n = 2;
    if (weather === "acid") n += 1;
    const s = upgradeDieSides(4, step);
    return { n, s, label: `${n}d${s}` };
  }
  if (kind === "healfield") {
    return { n: 1 + step, s: 4, label: `${1 + step}d4` };
  }
  if (kind === "hvfield") {
    const s = upgradeDieSides(4, step);
    return { n: 1, s, label: `1d${s}` };
  }
  if (kind === "high") {
    const s = upgradeDieSides(4, step);
    return { n: 1, s, bonus: 1, label: `1d${s}+1` };
  }
  return { n: 1, s: upgradeDieSides(4, step) };
}

/**
 * Core attack resolution.
 * ctx: {
 *   attacker, target, atk, mult, flat, diceValue,
 *   element, baseBreak, hits,
 *   flags, weather, phaseStep, zoneMode,
 *   attackerField, targetField, highGround,
 *   dist
 * }
 */
function resolveAttack(ctx) {
  const log = [];
  const add = (s) => log.push(s);
  const t = ctx.target;
  const a = ctx.attacker;
  const flags = ctx.flags || {};
  const weather = ctx.weather || "none";
  // 保释：此回合豁免天气与场地（天气由调用方的 currentWeatherFor 处理，场地在这里清空：冻土、干涉都不吃）
  const fieldT = t && (t.shelterTurn || t.isolate) ? {} : (ctx.targetField || {});
  const fieldA = ctx.attackerField || {};

  if (!t) return { ok: false, log: ["没有受击者。"] };
  // 只对「攻击」生效的修正（相位击破 ±1、错位受克制 +1 击破、扩散改属性、熔融沙尘 +1 击破、冰打熔融、千钧击破）：
  // 灼烧 / 腐蚀这类状态伤害、场地伤害、雷击转移这类派生伤害（action: false 或 environment）都不吃
  const isAttack = flags.action !== false && !flags.environment;
  // 恶劣环境（这个单位，到回合结束）/ 末日（整场）：天气与场地效果翻倍
  // 恶劣环境 / 末日：天气与场地效果翻倍，两个叠加 ×4
  const envX = (t.harshEnv ? 2 : 1) * (typeof state !== "undefined" && state && state.apocalypse ? 2 : 1);

  if (flags.immune) {
    // 血量层原样带回：应用结果时要用（原来缺了这一项，屹立不倒一挨打就报错）
    const defNow = Number(t.def) || 0;
    // 完全免伤也算减伤：这一击本来的伤害全部算「减免」
    const immuneRaw = Math.max(0, (Number(ctx.atk) || 0) * (Number(ctx.mult) || 0) + (Number(ctx.flat) || 0) + (Number(ctx.diceValue) || 0)) * Math.max(1, Number(ctx.hits) || 1);
    return {
      ok: true, total: 0, breakDealt: 0, hits: 0, log: ["屹立不倒 / 免疫：伤害与击破均为 0。"], reduced: Math.round(immuneRaw),
      perHit: [], preventSand: false, applied: [],
      layersAfter: clone(t.layers || []), defBefore: defNow, defAfter: defNow, broke: false,
      element: ctx.element, flags, interfereAfter: t.interfere || 0, interfereZone: t.interfereZone != null ? t.interfereZone : null
    };
  }

  if (flags.assist && flags.block === "assistOk") {
    add("协助攻击无法被格挡，忽略协助格挡成功。");
    flags.block = "none";
  }

  let element = ctx.element;
  // 扩散：此回合内「对其发动的攻击」改按最新状态属性结算（状态 / 场地伤害不改）
  if (isAttack && t.instant && t.instant.spread && t.statuses) {
    const latest = t.statuses.latestElement;
    if (latest) {
      add(`扩散：本次按受击者最新状态属性结算（${ELE[latest]}）。`);
      element = latest;
    }
  }

  let atk = Number(ctx.atk) || 0;
  if (a && a.statuses) {
    if (a.statuses.weak) { atk *= 0.75; add("攻击者虚弱：ATK −25%。"); }
    if (a.statuses.inspire) { atk *= 1.25; add("攻击者振奋：ATK +25%。"); }
  }

  let mult = Number(ctx.mult) || 0;
  if (a && a.self === "anchor") {
    mult += 0.2;
    add("千钧：伤害倍率 +0.2。");
    if (flags.junAdd) { mult += 0.2; add("千钧附赠：伤害倍率再 +0.2。"); }
  }

  const diceV = Number(ctx.diceValue) || 0;
  let rawBase = Math.max(0, atk * mult + (Number(ctx.flat) || 0) + diceV);
  // 减伤的参照：攻击者本来的伤害（算振奋，不算玩家给它上的虚弱——那也是减伤的一部分）
  const refAtk = (Number(ctx.atk) || 0) * (a && a.statuses && a.statuses.inspire ? 1.25 : 1);
  const refBase = Math.max(0, refAtk * mult + (Number(ctx.flat) || 0) + diceV);
  let totalReduced = 0;
  // 天气带来的伤害变化（环境分数：天气的所有者按这部分加分）：up 多打出来的，down 少挨的
  let weatherUp = 0, weatherDown = 0;
  add(`基础包 = ATK ${round2(atk)} × 倍率 ${round2(mult)} + 固定 ${ctx.flat || 0} + 骰子 ${round2(diceV)} = ${round2(rawBase)}`);
  // 只加在第一击基础包上的骰（「准备」：复数攻击只生效一次），之后照样吃倍率和克制
  const firstBonus = Math.max(0, Number(ctx.firstHitBonus) || 0);
  if (firstBonus) add(`第一击基础包 +${round2(firstBonus)}（${ctx.firstHitNote || "额外骰"}）`);

  let hits = Math.max(1, Number(ctx.hits) || 1);
  if (a && a.instant && a.instant.overload && hits > 1) {
    hits += 1;
    add("攻击者过载：复数次攻击额外再打一次（沿用本段倍率）。");
  }
  // 导体：和过载一样，只对本来就是复数次的攻击起效，多打一次（重复最后一段）
  if (a && a.self === "conductor" && hits > 1) {
    hits += 1;
    add("攻击者导体：复数次攻击额外再打一次（重复最后一段）。");
  }

  // 「共 N 击破」的多段攻击（breakOnce）：攻击次数被加多了（过载、导体、不稳翻倍……），
  // 额外击破 = 多出来的次数 × 原本的 击破 / 次数，向上取整，和原本的击破一起记在第一击上
  const origHits = Math.max(1, Number(ctx.baseHits) || Number(ctx.hits) || 1);
  let onceBreak = Number(ctx.baseBreak) || 0;
  if (ctx.breakOnce && hits > origHits && onceBreak > 0) {
    const extraBreak = Math.ceil((hits - origHits) * onceBreak / origHits - 1e-9);
    add(`攻击次数 ${origHits} → ${hits}：按原本 ${onceBreak} 击破 / ${origHits} 次的比例，额外击破 +${extraBreak}（向上取整）。`);
    onceBreak += extraBreak;
  }

  const layersWork = clone(t.layers || []);
  const perHit = [];
  let advHits = 0;   // 触发属性克制的段数（评分用）
  let disHits = 0;   // 被克制（劣势）的段数（预览用）
  let totalDealt = 0;
  let totalIntended = 0;
  let extraHarmonic = 0;
  let totalBreak = 0;
  let preventSand = false;
  let meltEnded = false;
  let pierColdRetrig = false;
  let knockdownHp = 0;
  let selfBreak = 0;
  // 干涉场：叠层只在单位站在干涉场里时生效（叠层记着是在哪一区叠的，换了区就不算）；不在干涉场里挨打就清掉
  const interfHere = !!fieldT.harmonic && (t.interfereZone == null || Number(t.interfereZone) === Number(t.zone));
  let interfDelta = interfHere ? Math.max(-INTERFERE_CAP, Math.min(INTERFERE_CAP, Number(t.interfere) || 0)) : 0;
  let firstStartType = null;
  // 熔融：多段攻击每一段都吃熔融（冰 ×2 伤害、+1 击破），整次攻击结算完才结束（作者定：每段都算）
  let meltLive = !!(t.instant && t.instant.melt);
  // 千钧：每一段攻击都 +1 击破（作者定：每段都算）
  const anchorDone = false;
  let anchorBreak = false;
  // 蚀刻残留：接下来受到此属性的伤害视为被克制（弱点特效、错位、干涉场都按克制算）
  const etchAdv = (t.etchMarks || []).some(m => m && m.element === element);

  for (let h = 0; h < hits; h++) {
    const hitLog = [];
    const hAdd = (s) => { hitLog.push(s); add(`#${h + 1} ${s}`); };
    // hitMults：每段倍率不同的多段攻击（例如柯尔特电钻普攻 0.3 / 0.3 / 0.4）；多出来的段数沿用最后一段
    const hm = Array.isArray(ctx.hitMults) && ctx.hitMults.length ? Number(ctx.hitMults[Math.min(h, ctx.hitMults.length - 1)]) || 0 : null;
    const multAdj = hm == null ? 0 : hm - (Number(ctx.mult) || 0);
    // 这一段的基础包（只含攻击者一侧：ATK × 倍率 + 固定 + 骰子 + 第一击加骰），还没吃目标一侧的任何修正。导体额外那一下用它重新结算
    const segBase = Math.max(0, rawBase + atk * multAdj) + (h === 0 ? firstBonus : 0);

    if (flags.block === "assistOk") {
      let br = ctx.breakOnce ? onceBreak : (Number(ctx.baseBreak) || 0);
      if (ctx.breakOnce && h > 0) {
        perHit.push({ dealt: 0, breakDealt: 0, base: segBase, layers: clone(layersWork) });
        continue;
      }
      if (flags.smash) br *= 2;
      if (weather === "glow" && br > 0) br = Math.max(1, br - 1);
      if (weather === "phase" && Number(ctx.phaseStep) === 0) br = Math.max(0, br - 1);
      if (weather === "phase" && Number(ctx.phaseStep) === 2) br += 1;
      totalBreak += br;
      hAdd("协助格挡成功：目标免伤，击破 " + br + " 改由格挡者承担。");
      perHit.push({ dealt: 0, breakDealt: br, base: segBase, layers: clone(layersWork) });
      continue;
    }

    if (multAdj) hAdd(`本段倍率 ${round2(hm)}`);
    let packet = segBase;

    const startIdx = pickStartIndex(layersWork, flags.pierce, flags.focusLayer);
    let startLayer = layersWork[startIdx] || layersWork.find(l => l.current > 0);
    if (firstStartType == null && startLayer) firstStartType = startLayer.type;
    const onShp = !!(t.upOnShp && t.isPlayer);
    // 敌人在这次攻击动作里被打死：它留到动作结束，后面的段数照常结算，伤害全部算溢出（不再扣血、不再击破）
    let ghost = false;
    if (!onShp && (!startLayer || totalCurFrom(layersWork) <= 0)) {
      if (!t.isPlayer && (h > 0 || ctx.ghostOk) && layersWork.length) {
        ghost = true;
        startLayer = layersWork[innermostIndex(layersWork)];
      } else {
        hAdd(t.dying ? "目标已濒死，需先起身。" : "没有可结算的血量层。");
        break;
      }
    }

    let pct = 0;
    const acidRain = weather === "acid";
    const layerTypeForChart = onShp ? "shp" : startLayer.type;
    // 冻土对飞行单位无效：飞行的受击者不吃冻土的冰易伤
    let cMod = onShp ? 0 : chartMod(element, layerTypeForChart, weather, t.flying ? null : fieldT, acidRain, envX);
    // 天气改了克制表的那部分（微光反转克制、酸雨让装甲减伤失效）
    let wSum = onShp || weather === "none" ? 0 : cMod - chartMod(element, layerTypeForChart, "none", t.flying ? null : fieldT, false, envX);
    if (!onShp && meltLive && startLayer && startLayer.type === "armor" && element === "physical") {
      hAdd(`克制表原值 ${pctTxt(cMod)}，熔融装甲将物理修正强制改为 +50%。`);
      cMod = 0.50;
      wSum = 0;
    }
    if (!onShp && typeof bpChartCap === "function") {
      const capped = bpChartCap(t, cMod);
      if (capped !== cMod) { hAdd(`愿你无恙：属性克制加成 ${pctTxt(cMod)} → ${pctTxt(capped)}。`); cMod = capped; }
    }
    pct += cMod;
    if (matchupKind(cMod) === "adv") advHits++;
    else if (matchupKind(cMod) === "dis") disHits++;
    if (onShp) hAdd(`起身状态：克制表无修正（坚毅生命对全属性 0%）`);
    else hAdd(`克制表 ${ELE[element]} → ${LAYER[startLayer.type]}：${pctTxt(cMod)}（溢出不重算）`);
    // 克制 / 劣势的判定（弱点特效、错位、干涉场用）：蚀刻残留让这一属性视为被克制
    const kindNow = etchAdv ? "adv" : matchupKind(cMod);

    const wPct = weatherDamagePct(weather, element) * envX;
    if (wPct) { pct += wPct; wSum += wPct; hAdd(`天气：${pctTxt(wPct)}${envX > 1 ? "（恶劣环境 / 末日：翻倍）" : ""}`); }

    if (flags.weak) {
      const w = kindNow === "adv" ? 0.25 : -0.25;
      pct += w;
      hAdd(`弱点特效（${kindNow === "adv" ? (etchAdv && matchupKind(cMod) !== "adv" ? "蚀刻视为克制" : "克制") : "非克制"}）：${pctTxt(w)}`);
    }

    if (ctx.dist >= 1 && ctx.atkRange !== "melee") {   // 隔区的远程攻击（三区模式隔两区的也算）
      if (ctx.highA && !ctx.highT) { pct += 0.25; hAdd("高地打低地远程：+25%。"); }
      const pointBlank = typeof featHas === "function" && featHas(ctx.attacker, "pointblank");   // 抵近射击（feats.js）
      if (!ctx.highA && ctx.highT && !pointBlank) { pct -= 0.25; hAdd("低地打高地远程：−25%。"); }
      if (!ctx.highA && ctx.highT && pointBlank) hAdd("低地打高地远程：抵近射击，不受 −25%。");
    }
    // 无可阻挡（feats.js）：这一击无视目标的百分比减伤（血量层照常要打）
    const noDr = !!flags.unstoppable;
    if (noDr) hAdd("无可阻挡：无视目标的百分比减伤。");
    // 尘虫摊平（desert.js）：受到的伤害 −50%
    if (t && t.resources && t.resources.flattened && !noDr) { pct -= (typeof DESERT !== "undefined" ? DESERT.flattenCut : 0.5); hAdd("摊平：受到伤害 −50%。"); }

    if (interfDelta) {
      pct += interfDelta;
      hAdd(`干涉场叠层带入：${pctTxt(interfDelta)}`);
    }

    // 冰属性攻击打熔融：每一段 ×2 伤害、+1 击破，攻击结算完熔融结束
    const meltIceHit = isAttack && meltLive && element === "ice" && !ghost;
    if (meltIceHit) {
      hAdd("冰打熔融：伤害 ×2，击破 +1，并结束熔融。");
    }

    if (flags.fuelPct) { pct += flags.fuelPct; hAdd(`燃油：伤害 +${Math.round(flags.fuelPct * 100)}%。`); }
    if (a && a.self === "burn") {
      const st = Math.max(1, Number(a.selfBurnStacks) || 1);
      if (element === "fire") { pct += 0.10 * st; hAdd("自焚×" + st + "：火焰伤害 +" + (10 * st) + "%。"); }
    }
    if (t.kit === "outlaw_king" && t.resources && t.resources.hostage) {
      pct += 0.25; hAdd("亡命之王被挟持：易伤 +25%。");
    }
    if (t.self === "burn") {
      const st = Math.max(1, Number(t.selfBurnStacks) || 1);
      if (element === "fire" || element === "ice") { pct -= 0.10 * st; hAdd("目标自焚×" + st + "：火/冰受伤 −" + (10 * st) + "%。"); }
    }
    if (a && a.self === "frost" && element === "ice") { pct += 0.25; hAdd("霜结：冰伤害 +25%。"); }
    if (t.self === "frost") {
      if (["physical", "acid", "energy", "harmonic", "ice"].includes(element)) {
        pct -= 0.25; hAdd("目标霜结：该类受伤 −25%。");
      }
      if (weather === "snow") { pct -= 0.10 * envX; wSum -= 0.10 * envX; hAdd(`雪天霜结：全属性再 −${10 * envX}%。`); }
    }
    if (t.self === "splash") {
      if (element === "acid" || element === "fire") { pct -= 0.25; hAdd("目标溅射：酸/火受伤 −25%。"); }
    }
    // 种族缺陷「鳞片」（兽人-蜥蜴）：能量属性对你造成 25% 额外伤害
    if (element === "energy" && t.kit && typeof heroProfile === "function" && (heroProfile(t.kit) || {}).race === "兽人-蜥蜴" && t.isPlayer && !t.weaponOf) {
      pct += 0.25; hAdd("鳞片（兽人-蜥蜴）：能量受伤 +25%。");
    }
    // 蓄能：能量、谐波、电攻击造成的伤害提高「高能值占血量上限的百分比」
    // （手册正文没写电，作者确认是手册漏写，电也加）
    if (a && a.self === "store" && (element === "energy" || element === "harmonic" || element === "electric")) {
      const maxhp = Math.max(1, totalMaxHp(a));
      const extra = (Number(a.highEnergy) || 0) / maxhp;
      pct += extra;
      hAdd(`蓄能：能量/谐波/电伤害 +${(extra * 100).toFixed(1)}%。`);
    }
    if (t.self === "store" && element === "harmonic") {
      pct += 0.25; hAdd("目标蓄能：谐波受伤 +25%。");
    }
    if (a && a.self === "doppler" && element === "harmonic") {
      if (flags.dopplerCloser) { pct += 0.25; hAdd("多普勒接近：谐波 +25%。"); }
      if (flags.dopplerFarther) { pct -= 0.25; hAdd("多普勒远离：谐波 −25%。"); }
    }
    if (t.self === "doppler") {
      if (flags.dopplerCloser) { pct += 0.25; hAdd("目标多普勒：来自接近区域伤害 +25%。"); }
      if (flags.dopplerFarther) { pct -= 0.25; hAdd("目标多普勒：来自远离区域伤害 −25%。"); }
    }

    if (weather === "phase" && Number(ctx.phaseStep) === 2) {
      pct += 0.50 * envX; wSum += 0.50 * envX; hAdd(`相位波峰：伤害 +${50 * envX}%。`);
    }

    if (flags.icebreak) {
      const over = (Number(t.defMax) || 0) > 0 && (Number(t.def) || 0) > (Number(t.defMax) || 0) * 0.5;
      const frozen = !!(t.instant && t.instant.iceNext);
      if (over || frozen) {
        pct += 0.25;
        hAdd(over ? "破冰：架势超过上限 50%，伤害 +25%。" : "破冰：目标处于冰冻，伤害 +25%。");
      }
    }
    if (flags.etchHit) {
      pct -= 0.25;
      hAdd("蚀刻：本次伤害 −25%。");
    }
    if (t.etchMarks && t.etchMarks.length) {
      t.etchMarks.forEach(m => {
        if (m && m.element === element) {
          const addp = Number(m.pct) || 0.1;
          pct += addp;
          hAdd("蚀刻残留：" + (ELE[element] || element) + " +" + Math.round(addp * 100) + "%，且视为被该属性克制。");
        }
      });
    }

    // 以百分比写的增伤 / 减伤（攻击方、受击方都算）一律和上面的加在一起，不连乘：
    // 相位波谷、减伤率、自保、过度自信、全队集结的坦克减伤、冰冻 +50%
    // 波谷 −50% 伤害；恶劣环境 / 末日翻倍成 −100%
    if (weather === "phase" && Number(ctx.phaseStep) === 0) { pct -= 0.5 * envX; wSum -= 0.5 * envX; hAdd(`相位波谷：伤害 −${50 * envX}%。`); }
    if (flags.dr50 && !noDr) { pct -= 0.5; hAdd("目标减伤 +50%：−50%。"); }
    if (flags.dr25 && !noDr) { pct -= 0.25; hAdd("自保模式：受伤 −25%。"); }
    if (flags.drPct && !noDr) { pct -= Number(flags.drPct) || 0; hAdd(`${flags.drWhy || "减伤"}：−${Math.round((Number(flags.drPct) || 0) * 100)}%。`); }
    if (flags.prideReduce && !noDr) {
      const pr = typeof flags.prideReduce === "number" ? flags.prideReduce : 0.25;
      pct -= pr; hAdd(`过度自信：血量不低于进入战斗时的上限，受伤 −${Math.round(pr * 100)}%。`);
    }
    // 集结持续到自己失衡或濒死
    if (t.resources && t.resources.rallyDr && (t.stunned || t.dying)) delete t.resources.rallyDr;
    if (t.resources && t.resources.rallyDr && !noDr) { pct -= 0.15; hAdd("全队集结（坦克）：全属性减伤 +15%：−15%。"); }
    if (h === 0 && t.instant && t.instant.iceNext && flags.action !== false) {
      pct += 0.5;
      hAdd("冰冻（冰属性击破失衡）：本动作第一击伤害 +50%。");
      t.instant.iceNext = false;
    }

    const packetNoWeather = wSum ? packet * Math.max(0, 1 + pct - wSum) : null;
    packet *= Math.max(0, 1 + pct);
    hAdd(`加算百分比合计 ${pctTxt(pct)} → ${round2(packet)}`);

    // 写成「翻倍 / 减半 / ×N」的才另外相乘
    let mul = 1;
    if (flags.doubleDeal) { mul *= 2; hAdd("造成伤害翻倍。"); }
    if (flags.doubleTake) { mul *= 2; hAdd("目标受伤翻倍。"); }
    if (flags.holyShield && !noDr) { mul *= 0.5; hAdd("圣盾：本次伤害减半。"); }
    if (flags.pointBlank) {   // 抵近射击（feats.js）：远距离攻击打同区，倍率只有原本的 60%
      const pb = typeof FEAT_CFG !== "undefined" && FEAT_CFG.pointblank ? FEAT_CFG.pointblank.mult : 0.6;
      mul *= pb; hAdd(`抵近射击：远距离攻击打同区，倍率 ×${pb}。`);
    }
    // 事故幸存+：拉斯缪尔不稳态下受到的伤害 ×3（不再倒地 / 死亡）
    if (t.kit === "ras" && t.resources && t.resources.unstable && typeof passivePlus === "function" && passivePlus(t, 2)) {
      mul *= 3; hAdd("事故幸存+：不稳态受伤 ×3。");
    }
    if (flags.diceMin) { hAdd("决一死战：伤害掷骰已按最低值计算。"); }
    if (t.flying && flags.action) { mul *= 0.5; hAdd("飞行单位：攻击行动伤害减半。"); }
    if (meltIceHit) { mul *= 2; }
    if (flags.block === "bareOk") { mul *= 0.5; hAdd("空手格挡成功：伤害一半。"); }
    packet *= mul;

    packet = Math.max(0, packet);
    const floored = Math.floor(packet + 1e-9);
    if (floored !== packet) hAdd(`最终伤害包 ${round2(packet)} → 向下取整 ${floored}`);
    else hAdd(`最终伤害包 ${floored}`);
    packet = floored;
    totalIntended += packet;
    if (packetNoWeather != null && !ghost) {
      const diff = packet - Math.floor(Math.max(0, packetNoWeather * mul) + 1e-9);
      if (diff > 0) weatherUp += diff; else if (diff < 0) weatherDown -= diff;
    }
    // 减伤：这一段比参照少了多少（空手格挡减半那部分不算，归格挡）
    if (!ghost) totalReduced += Math.max(0, (Math.max(0, refBase + refAtk * multAdj) + (h === 0 ? firstBonus : 0)) * (flags.block === "bareOk" ? 0.5 : 1) - packet);

    let hitDealt = packet;
    if (ghost) {
      hitDealt = 0;
      hAdd(`目标已倒下：这一段 ${packet} 全部算作溢出伤害。`);
    } else if (!onShp) {
      const distribute = distributePacket({
        layers: layersWork,
        startIdx,
        packet,
        element,
        refraction: !!(t.instant && t.instant.refract),
        sting: !!(t.instant && t.instant.sting),
        harmonicStun: element === "harmonic" && (typeof isEffectivelyStunned === "function" ? isEffectivelyStunned(t) : !!t.stunned),
        phaseHarmonic: weather === "phase" && element === "harmonic" && (typeof isEffectivelyStunned === "function" ? isEffectivelyStunned(t) : !!t.stunned),
        extraShockInner: element === "electric" && t.instant && t.instant.sting
      });
      distribute.notes.forEach(hAdd);
      hitDealt = distribute.dealt;
      extraHarmonic += Number(distribute.extraHarmonic) || 0;
    } else {
      hAdd("起身状态：本段伤害改由坚毅生命承受（不显示剩余值）。");
    }
    totalDealt += hitDealt;

    if (element === "fire" || element === "energy") preventSand = true;

    let br = ghost ? 0 : (ctx.breakOnce ? onceBreak : (Number(ctx.baseBreak) || 0));
    // breakOnce：多段攻击的击破整次只结算一回（记在第一击上），卡面写「共 N 击破」的用这个
    const skipBreak = (ctx.breakOnce && h > 0) || ghost;
    if (skipBreak) br = 0;
    if (!skipBreak) {
      if (!onShp && startLayer && startLayer.type === "armor" && element === "physical") {
        if (!meltLive) { br += 1; hAdd("物理打装甲：击破 +1。"); }
        else hAdd("熔融装甲：失去物理 +1 击破。");
      }
      if (isAttack && !onShp && meltLive && startLayer && startLayer.type === "sand") {
        br += 1; hAdd("熔融沙尘：击破 +1。");
      }
      if (meltIceHit) br += 1;
      if (flags.smash) {
        selfBreak += br;
        br *= 2;
        hAdd("猛击：击破 ×2，攻击者承受原击破。");
      }
      if (a && a.self === "anchor" && isAttack && !anchorDone) {
        br += 1; anchorBreak = true;
        hAdd("千钧：击破 +1。");
      }
      if (weather === "glow") {
        if (br > 0) br = Math.max(1, br - envX);
        hAdd(`微光：击破 −${envX}（不会减到 0）。`);
      }
      if (isAttack && weather === "phase" && Number(ctx.phaseStep) === 0) { br = Math.max(0, br - envX); hAdd(`相位波谷：击破 −${envX}。`); }
      if (isAttack && weather === "phase" && Number(ctx.phaseStep) === 2) { br += envX; hAdd(`相位波峰：击破 +${envX}。`); }
      if (isAttack && t.instant && t.instant.shift) {
        const meltArmor = !!(meltLive && startLayer && startLayer.type === "armor" && element === "physical");
        if (kindNow === "adv" || meltArmor) {
          br += 1; hAdd(meltArmor ? "错位 + 熔融装甲加伤：击破 +1。" : "错位 + 克制/蚀刻：击破 +1。");
        }
      }
    }
    // 冰打熔融：这次攻击结算完熔融结束（后面的段数照样吃熔融）
    if (meltIceHit) meltEnded = true;
    // 干涉场：每一段按「当前」叠层判断是不是反向（多段攻击里前一段叠上去的也算）
    if (fieldT.harmonic && (kindNow === "adv" || kindNow === "dis")) {
      const up = kindNow === "adv";
      const step = 0.25 * envX;
      const stepTxt = `${up ? "+" : "−"}${25 * envX}%`;
      if (up ? interfDelta < 0 : interfDelta > 0) {
        interfDelta = up ? step : -step;
        hAdd(`干涉场遇到反向：清空后从 ${stepTxt} 重计。`);
      } else {
        const before = interfDelta;
        interfDelta = Math.max(-INTERFERE_CAP, Math.min(INTERFERE_CAP, interfDelta + (up ? step : -step)));
        hAdd(interfDelta === before
          ? `干涉场：叠层已到上限 ${pctTxt(interfDelta)}，不再叠加。`
          : `干涉场：本次${up ? "克制" : "劣势"}，下次伤害 ${stepTxt}。`);
      }
    }

    totalBreak += br;

    perHit.push({
      dealt: hitDealt,
      intended: packet,   // 这一段打出去的伤害（不按剩余血量封顶），画面按段弹字用
      base: segBase,      // 这一段吃目标修正之前的基础包（导体额外一下用）
      breakDealt: br,
      notes: hitLog,
      shp: onShp
    });
  }

  // 高压场地额外电伤改在 dealTo 里自动写入血条，避免这里只记账不结算。

  // 过度自信：这次攻击受到的击破 −1
  if (flags.prideReduce && totalBreak > 0) { totalBreak -= 1; add("过度自信：受到的击破 −1。"); }
  const defBefore = Number(t.def) || 0;
  let defAfter = defBefore;
  let helperBreak = 0;
  if (flags.block === "assistOk") {
    // 协助格挡成功（作者定的规则）：目标免伤且不扣架势，这一击的击破全部由格挡者承担（最少留 1）
    defAfter = defBefore;
    helperBreak = Math.max(0, totalBreak);
    totalBreak = 0;
    totalDealt = 0;
    add(`协助格挡成功：目标免伤且不扣架势。格挡者承担结算后击破 ${helperBreak}（含微光/相位等修正）。`);
  } else {
    defAfter = Math.max(0, defBefore - totalBreak);
  }

  const broke = defBefore > 0 && defAfter <= 0;
  if (broke) {
    add("架势归零：目标将晕眩，直到其下一次行动。");
    if (t.flying && t.resources && t.resources.mecha) {
      // 瑞比机甲被击落：结束机甲，瑞比和明特各自受坠落伤害（app.js · exitMecha）；以前这里先按整台机甲扣一次 20%，叠了两次
      add("机甲被击落：结束机甲模式，瑞比和明特分别受到坠落伤害。");
    } else if (t.flying) {
      knockdownHp = Math.floor(totalMaxHp(t) * 0.2);
      add(`飞行单位被击破：强制击落，并扣除 20% 最大生命 = ${knockdownHp}（真伤，应用时从外层扣）。`);
    }
    if (t.instant && t.instant.overload) {
      add("过载期间被击破：额外承受 等级 × 1d4 电伤。");
    }
    if (t.instant && t.instant.sting) pierColdRetrig = true;
  }

  if (t.self === "cat" && totalBreak > 2) {
    add("兽人猫·灵巧：一回合失去架势不超过 2。已在应用阶段封顶。");
  }

  const sandNote = preventSand ? "火/能量命中：本回合可阻止沙尘自动恢复。" : "";

  return {
    ok: true,
    advantage: advHits > 0,                // 这一击触发了属性克制
    disadvantage: advHits === 0 && disHits > 0,   // 这一击被克制表减伤（劣势）
    blocked: flags.block === "assistOk",   // 主攻击被挡住 → 不产生溅射
    // 协助格挡成功时这一击本来的伤害（基础包 × 次数，未算抗性），战场数据「格挡规避伤害」用
    blockedRaw: flags.block === "assistOk" ? Math.round(rawBase * hits + firstBonus) : 0,
    // 受击方的减伤减免掉的伤害（天气、血量层抗性、角色能力、减半……；协助格挡成功的不算）
    reduced: flags.block === "assistOk" ? 0 : Math.round(totalReduced),
    weatherUp, weatherDown,
    total: totalDealt,
    intended: totalIntended,
    extraHarmonic,
    breakDealt: totalBreak,
    helperBreak,
    defBefore,
    defAfter,
    broke,
    iceBreak: !!(ctx.iceBreak || element === "ice") && totalBreak > 0,
    element,
    startLayerType: firstStartType,
    shpDealt: (t.upOnShp && t.isPlayer) ? totalDealt : 0,
    hits,
    preventSand,
    meltEnded,
    pierColdRetrig,
    knockdownHp,
    selfBreak,
    anchorBreak,                            // 千钧这一下加过击破了（同一行动里后面的攻击不再加）
    interfereAfter: interfDelta,
    interfereZone: interfDelta ? t.zone : null,   // 干涉叠层是在哪一区叠的（离开这一区就不再生效）
    layersAfter: layersWork,
    perHit,
    log,
    sandNote,
    element,
    rawBase,
    flags
  };
}

function pickStartIndex(layers, pierce, focusType) {
  const living = [];
  layers.forEach((l, i) => { if (Number(l.current) > 0) living.push(i); });
  if (!living.length) return 0;
  if (focusType) {
    const hit = living.find(i => layers[i].type === focusType);
    if (hit != null) return hit;
  }
  if (pierce && living.length >= 2) return living[1];
  return living[0];
}

function totalCurFrom(layers) {
  return layers.reduce((s, l) => s + Math.max(0, Number(l.current) || 0), 0);
}

function distributePacket(opt) {
  const notes = [];
  let remaining = opt.packet;
  let dealt = 0;
  let extraHarmonic = 0;
  const layers = opt.layers;

  const applyToIndex = (idx, amount, tag) => {
    if (amount <= 0) return 0;
    if (idx < 0 || idx >= layers.length) return 0;
    const layer = layers[idx];
    const before = Math.max(0, Number(layer.current) || 0);
    const take = Math.min(before, amount);
    layer.current = Math.max(0, Math.floor((before - take) + 1e-9));
    let leftover = amount - take;
    dealt += take;
    notes.push(`${tag}${LAYER[layer.type]} ${before} → ${layer.current}（吸收 ${take}）`);
    if (leftover > 0 && before > 0 && leftover > 0 && opt.refraction) {
      leftover = Math.floor(leftover * 1.5 + 1e-9);
      notes.push(`折射：击穿 ${LAYER[layer.type]}，溢出 ×1.5 后向下取整 = ${leftover}`);
    }
    return leftover;
  };

  if (opt.phaseHarmonic) {
    notes.push("相位 + 谐波 + 晕眩：每一层血量都吃一次伤害包（只有一层就只吃一次）。");
    let layersHit = 0;
    for (let i = 0; i < layers.length; i++) {
      if (Number(layers[i].current) > 0) {
        layersHit++;
        const left = applyToIndex(i, remaining, "相位层：");
        if (left > 0) {
          let r = left;
          for (let j = i + 1; j < layers.length && r > 0; j++) r = applyToIndex(j, r, "相位溢出：");
        }
      }
    }
    // 额外的那几次（第一层之外）：画面另外跳一个数字
    return { dealt, notes, extraHarmonic: remaining * Math.max(0, layersHit - 1) };
  }

  // 谐波打晕眩：次外层 = 这一击之前从外往里第二层还有血的；单层目标没有次外层，不额外打
  let second = null;
  if (opt.harmonicStun) {
    const livingBefore = [];
    layers.forEach((l, i) => { if (Number(l.current) > 0) livingBefore.push(i); });
    second = livingBefore[1] != null ? livingBefore[1] : null;
  }

  let idx = opt.startIdx;
  let r = remaining;
  if (opt.extraShockInner) {
    const inner = innermostIndex(layers);
    const split = Math.floor(r * 0.5 + 1e-9);
    notes.push(`刺骨：电击伤害 50%（${split}）改打最内层肉体/星灵/沙尘。`);
    let innerLeft = applyToIndex(inner, split, "刺骨内层：");
    for (let j = inner + 1; j < layers.length && innerLeft > 0; j++) {
      innerLeft = applyToIndex(j, innerLeft, "内层溢出：");
    }
    r = Math.floor(r - split + 1e-9);
  }

  r = applyToIndex(idx, r, "主目标：");
  for (let j = idx + 1; j < layers.length && r > 0; j++) {
    r = applyToIndex(j, r, "溢出：");
  }

  if (opt.harmonicStun) {
    if (second != null) {
      notes.push("谐波打晕眩：次外层再吃一次同等伤害包。");
      let extra = opt.packet;
      extra = applyToIndex(second, extra, "谐波追加：");
      for (let j = second + 1; j < layers.length && extra > 0; j++) {
        extra = applyToIndex(j, extra, "谐波追加溢出：");
      }
      extraHarmonic += opt.packet;
    } else {
      notes.push("谐波打晕眩：只有一层血量，没有次外层，不额外结算。");
    }
  }
  return { dealt, notes, extraHarmonic };
}

/** 濒死且还没选择起身：在玩家自己按下「起身」之前，不受任何伤害，
 *  也不会因为架势归零而被协助攻击。 */
function isDownProtected(u) {
  return !!(u && u.isPlayer && u.dying && !u.upOnShp && !u.dead);
}

function innermostIndex(layers) {
  const pref = ["flesh", "spirit", "sand"];
  for (let i = layers.length - 1; i >= 0; i--) {
    if (pref.includes(layers[i].type)) return i;
  }
  return layers.length - 1;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function pctTxt(v) {
  const p = Math.round(v * 1000) / 10;
  return (p >= 0 ? "+" : "") + p + "%";
}

function applyTrueDamage(layers, amount) {
  let r = Math.floor(Math.max(0, Number(amount) || 0) + 1e-9);
  for (let i = 0; i < layers.length && r > 0; i++) {
    const cur = Math.max(0, Number(layers[i].current) || 0);
    const take = Math.min(cur, r);
    layers[i].current = round2(cur - take);
    r -= take;
  }
  return amount - r;
}

function isIceBreakResult(result, spent) {
  if (!result) return false;
  const br = spent != null ? spent : result.breakDealt;
  if (!(br > 0)) return false;
  if (result.iceBreak) return true;
  return result.element === "ice";
}

function applyResultToUnit(target, result, attacker) {
  const notes = [];
  if (!result.ok) return notes;
  target.layers = clone(result.layersAfter);
  if (result.knockdownHp) {
    const d = applyTrueDamage(target.layers, result.knockdownHp);
    notes.push(`击落真伤 ${d}`);
    target.flying = false;
  }
  let spent = result.breakDealt;
  if (target.kit === "xia" && target.upOnShp && (typeof passiveOn !== "function" || passiveOn(target))) {
    spent = 0;
    notes.push("背水一战：起身中不失去架势。");
  }
  if (target.raceTrait === "catFocus") spent = Math.min(spent, Math.max(0, 2 - (target.lostDefThisTurn || 0)));
  // 坚挺：架势不会被打到 1 以下（不倒战意给的，本回合有效）
  if (target.statuses && target.statuses.sturdy && (Number(target.def) || 0) >= 1 && spent > (Number(target.def) || 0) - 1) {
    spent = Math.max(0, (Number(target.def) || 0) - 1);
    notes.push(`${target.name} 坚挺：架势保留 1。`);
  }
  // 决不后退（feats.js）：这一击要把架势打空时，有附赠动作就先 +2 架势
  if (spent > 0 && typeof featUnbowedAuto === "function") featUnbowedAuto(target, spent, notes);
  target.lostDefThisTurn = (target.lostDefThisTurn || 0) + spent;
  const defBeforeHit = Math.max(0, Number(target.def) || 0);
  const wasStunned = !!target.stunned;
  target.def = Math.max(0, (Number(target.def) || 0) - spent);
  if (spent > 0 && typeof registerZoneBreak === "function" && target.kit !== "ufo_leg" && !target.noPosture) {
    notes.push(...registerZoneBreak(target.zone, spent));
  }
  if (result.shpDealt > 0 && target.upOnShp) {
    target.shp = Math.max(0, (Number(target.shp) || 0) - result.shpDealt);
    notes.push("起身状态受伤，伤害已打入坚毅生命。");
    if (target.shp <= 0) {
      target.dead = true;
      target.upOnShp = false;
      target.dying = false;
      notes.push(`${target.name} 坚毅生命耗尽，死亡。`);
    }
  }
  if (target.noPosture || target.kit === "ufo_leg" || (target.name && String(target.name).indexOf("机械足") === 0)) {
    target.noPosture = true;
    target.stunned = false;
    target.def = 0;
    target.defMax = 0;
  } else if (target.def <= 0) {
    // 只有这一击把架势打到 0（之前还没失衡）才算「打进失衡」。
    // 打已经失衡的目标不会再挂一次冰冻加伤。
    const brokeIntoStun = defBeforeHit > 0 && !wasStunned;
    target.stunned = true;
    if (brokeIntoStun && isIceBreakResult(result, spent)) {
      target.instant = target.instant || {};
      target.instant.iceNext = true;
      notes.push(`${target.name} 因冰属性击破失衡：下次受到的攻击动作第一击 +50% 伤害。`);
    }
  }
  if (result.preventSand) target.sandLocked = true;
  if (result.meltEnded && target.instant) target.instant.melt = false;
  target.interfere = result.interfereAfter || 0;
  // 干涉叠层记下是在哪一区叠的：离开这一区（换到别的干涉场也一样）就不再生效，回合开始清掉
  target.interfereZone = !target.interfere ? null
    : result.interfereZone !== undefined ? result.interfereZone : target.zone;
  target.damagedThisTurn = (target.damagedThisTurn || 0) + result.total;
  // 瑞比「算法改变」：被它标记的敌人这一回合每次受到伤害，瑞比 +5 纳米
  if (result.total > 0 && target.algoTurn != null && typeof state !== "undefined" && target.algoTurn === state.turnNo && typeof addNano === "function") {
    addNano(5);
    if (typeof appendLog === "function") appendLog(`算法改变：${target.name} 受到伤害，瑞比纳米 +5。`);
  }
  if (result.total > 0) target.gotHitThisTurn = true;
  if (result.selfBreak && attacker) {
    attacker.def = Math.max(0, (Number(attacker.def) || 0) - result.selfBreak);
    notes.push(`猛击反震：攻击者架势 −${result.selfBreak}`);
    if (attacker.def <= 0) attacker.stunned = true;
  }
  // 自焚吸血只在 app.js · applyCombat 里结算一次（以前这里也治一次，吸血翻倍）
  return notes;
}

function healUnit(unit, amount, opt) {
  if (!unit || unit.dead || unit.dying) return 0;
  let raw = Math.max(0, Number(amount) || 0);
  if (!raw) return 0;
  if (typeof bpHealBonus === "function") raw += bpHealBonus(unit);   // 单局图纸：愿你无恙
  // 事故幸存+：拉斯缪尔不稳态下受到的治疗 ×3
  if (unit.kit === "ras" && unit.resources && unit.resources.unstable && typeof passivePlus === "function" && passivePlus(unit, 2)) raw *= 3;
  opt = opt || {};
  // 起身中（靠坚毅生命战斗）：普通治疗不回坚毅生命，只有自焚吸血回（这场战斗里临时有效，见 ledgerCapture）
  if (unit.upOnShp && !opt.selfBurn) return 0;
  if (unit.upOnShp) {
    const cap = Number(unit.shpMax) || 0;
    const before = Number(unit.shp) || 0;
    const give = cap > 0 ? Math.min(raw, Math.max(0, cap - before)) : raw;
    unit.shp = before + give;
    // 自焚吸来的坚毅生命只在这场战斗里有用：记下吸血前真正的坚毅，战后存档时不超过它
    if (opt.selfBurn && give > 0 && unit.shpBurnBase == null) unit.shpBurnBase = before;
    if (give > 0 && typeof pulseResonanceHeal === "function") pulseResonanceHeal(unit, give);
    return give;
  }
  let r = raw;
  // opt.inner：医疗包「治疗内层生命」只补最内层（肉体 / 星灵），不溢到外层的装甲 / 护盾
  const ls = opt.inner ? [innermostLayer(unit)].filter(Boolean) : (unit.layers || []);
  for (let i = ls.length - 1; i >= 0 && r > 0; i--) {
    const l = ls[i];
    const room = Math.max(0, Number(l.max) - Number(l.current));
    const give = Math.min(room, r);
    l.current = round2(Number(l.current) + give);
    r -= give;
  }
  const given = Math.max(0, raw - r);
  if (given > 0 && typeof pulseResonanceHeal === "function") pulseResonanceHeal(unit, given);
  return given;
}

/* ---------- presets ---------- */

function liveHeroCount() {
  const n = (typeof state !== "undefined" && state.units || []).filter(u =>
    u && u.isPlayer && !u.hidden && !u.dead && !u.weaponOf &&
    !(typeof isWeaponUnit === "function" && isWeaponUnit(u))
  ).length;
  if (n > 0) return n;
  if (typeof GAME !== "undefined" && GAME.partyKits && GAME.partyKits.length) return GAME.partyKits.length;
  if (typeof state !== "undefined" && Number(state.partySize)) return Number(state.partySize);
  return 2;
}

function syncPartySizeFromField() {
  let n = liveHeroCount();
  if (n < 2) n = 2;
  if (n > 4) n = 4;
  if (typeof state !== "undefined") state.partySize = n;
  if (typeof document !== "undefined") {
    const a = document.getElementById("partySize");
    if (a) a.value = String(n);
    const b = document.getElementById("g-cfg-ps");
    if (b) b.value = String(n);
  }
  if (typeof GAME !== "undefined") GAME.partySize = n;
  return n;
}

function partyScaleCount(party) {
  let p = party != null ? Number(party) : (typeof liveHeroCount === "function" ? liveHeroCount() : 2);
  if (!p || p < 2) p = 2;
  if (p > 4) p = 4;
  return p;
}

function scaleByParty(v, party) {
  const p = partyScaleCount(party);
  const m = p === 4 ? 2.5 : p === 3 ? 1.5 : 1;
  return Math.round((Number(v) || 0) * m);
}
function partyHpMult(party) {
  const p = partyScaleCount(party);
  return p === 4 ? 2.5 : p === 3 ? 1.5 : 1;
}
// scaleHp 记下这次按几人队缩放，紧接着的 unitOf 把它写到单位上（hpParty），
// 开战时 rebalanceEnemiesForParty 据此把敌人换算到实际队伍人数。
let _lastHpParty = null;
function scaleHp(v, party) {
  _lastHpParty = partyScaleCount(party);
  return scaleByParty(v, party);
}
/* 首领、以及 10 级起的精英的架势（已定）：每个等级都是原来的 60%（四舍五入），人数加成也一样打六折（四舍五入）。
 * 它们另有晕眩标记：失衡照常，但要攒满 2 个才真正跳过回合（app.js · bossShrugStun）。 */
const BOSS_POSTURE_MULT = 0.6;
const ELITE_RULE_MIN_LEVEL = 10;   // 精英从这一级起才用首领的架势 / 晕眩规则
function isBossKit(kit, level) {
  const rank = typeof enemyRankOf === "function" ? enemyRankOf({ kit: kit })
    : (typeof ENEMY_RANK !== "undefined" ? ENEMY_RANK[kit] : null);
  return rank === "boss" || (rank === "elite" && (Number(level) || 1) >= ELITE_RULE_MIN_LEVEL);
}
function scaleDefAdd(party, kit, level) {
  const p = partyScaleCount(party);
  let rank = "minion";
  if (typeof enemyRankOf === "function") rank = enemyRankOf({ kit: kit }) || "minion";
  else if (typeof ENEMY_RANK !== "undefined" && kit && ENEMY_RANK[kit]) rank = ENEMY_RANK[kit];
  if (rank === "minion") return 0;
  const k = isBossKit(kit, level) ? BOSS_POSTURE_MULT : 1;
  if (p === 3) return Math.round((rank === "boss" ? 3 : 2) * k);
  if (p >= 4) return Math.round((rank === "boss" ? 6 : 4) * k);
  return 0;
}
function scaleDef(v, party, kit, level) {
  const base = isBossKit(kit, level) ? Math.round((Number(v) || 0) * BOSS_POSTURE_MULT) : (Number(v) || 0);
  return base + scaleDefAdd(party, kit, level);
}

/** 把场上敌人的血量与架势换算到 party 人队。
 *  只动用 scaleHp / scaleDef 缩放过的数值（hpParty / defParty 记录了当时按几人算的），
 *  临时层不动。满血的层换算后仍是满血，受过伤的按比例换算。返回日志。 */
function rebalanceEnemiesForParty(party, units) {
  const n = partyScaleCount(party);
  const list = units || ((typeof state !== "undefined" && state.units) || []);
  const changed = [];
  list.forEach(u => {
    if (!u || u.isPlayer || u.dead) return;
    let touched = false;
    if (u.hpParty != null && u.hpParty !== n) {
      const f = partyHpMult(n) / partyHpMult(u.hpParty);
      (u.layers || []).forEach(l => {
        if (l.temp) return;
        const oldMax = Number(l.max) || 0;
        const cur = Number(l.current) || 0;
        const newMax = Math.max(oldMax > 0 ? 1 : 0, Math.round(oldMax * f));
        l.current = cur >= oldMax ? newMax : Math.max(0, Math.round(cur * f));
        l.max = newMax;
      });
      u.hpParty = n;
      touched = true;
    }
    if (u.defParty != null && u.defParty !== n && !u.noPosture) {
      const delta = scaleDefAdd(n, u.kit, u.level) - scaleDefAdd(u.defParty, u.kit, u.level);
      if (delta) {
        u.defMax = Math.max(0, (Number(u.defMax) || 0) + delta);
        u.def = Math.max(0, Math.min(u.defMax, (Number(u.def) || 0) + delta));
        touched = true;
      }
      u.defParty = n;
    }
    if (touched) changed.push(u.name);
  });
  // 飞碟触灵本体的血量是各机械足之和
  if (changed.length && typeof syncUfoBody === "function") {
    list.filter(u => u && u.kit === "ufo_body").forEach(u => syncUfoBody(u));
  }
  return changed.length ? [`人数平衡：按 ${n} 人队重新换算 ${changed.join("、")} 的血量与架势。`] : [];
}

/** 沙灵聚合体三层血量（人数缩放前）：最外 30 沙尘 / 40 装甲 / 最内 50 沙尘，每级 +9 外沙尘 +8 装甲 +6 内沙尘，再 × AGG_HP_MULT。
 *  三阶段「吸引碎片两次后装甲回满」也按这个算回装甲上限（enemies.js · en_agg3_debris） */
function aggregateLayerHp(lv) {
  const d = Math.max(0, (Number(lv) || 1) - 1);
  const k = AGG_HP_MULT;
  return { outer: Math.round((30 + d * 9) * k), armor: Math.round((40 + d * 8) * k), inner: Math.round((50 + d * 6) * k) };
}
/** 沙灵聚合体三层血量的倍率（终局平衡：原本三个首领里它血最少，聪明打法 6 回合就打穿，机制来不及放） */
const AGG_HP_MULT = 1.5;

/** 沙灵聚合体二阶段 · 电能炮（作者定：做成「死刑」首领机制，boss-mechanics.js）
 *  进入二阶段就锁定血量上限最高的我方单位，turns 回合后在敌人回合开始时开炮；开完炮过 interval 回合再开下一炮。
 *  hits：每一段 mult × atk + 1d(diceS)，各自可以协助格挡；目标和聚合体不同区时每段衰减为 far.mult × atk + 1d(far.diceS)。
 *  splash：目标所在区的其他友方各挨 splash × atk（范围伤害，不能格挡）——要分开站。
 *  chargeDr：开炮那一回合（倒数到 0）聚合体蓄满能量，我方这回合打它伤害 −chargeDr——要考虑防御和移动，而不是硬拼。
 *  开炮后机体过热：给自己上熔融，留到下一个我方回合结束（以前是空过一回合）。 */
const AGG_CANNON = {
  turns: 1,
  interval: 2,
  hits: [{ mult: 1, diceS: 20, baseBreak: 2 }, { mult: 1, diceS: 20, baseBreak: 1 }],
  far: { mult: 0.5, diceS: 10 },
  splash: 0.5,
  chargeDr: 0.5
};

/** 亡命之王（作者定的强化：用首领机制把「指挥官」做实，boss-mechanics.js）
 *  exec · 公开处刑（死刑，王在自己回合用的技能，花 1 行动点）：标记血量上限最高的我方单位，turns 回合后的敌人回合开始时落下；
 *    落下之后过 cooldown 回合（从标记那回合算）才会再用。
 *    第一刀是王自己：kingMult × atk + 1d(kingDie 随等级升档) 酸；之后每个还站着的手下（狂徒 / 强盗头子）各补一刀：
 *    crewMult × 自己的 atk + 1d(crewDie 随等级升档)。每一刀都可以协助格挡——先清掉手下，处刑就轻。
 *    落下后强盗头子还在：grab 概率擒拿，目标失去下回合行动。王被挟持（哗变）时推迟。
 *  volley · 齐射（回防命令之后）：回防时标记我方每个角色，下一个敌人回合开始时王朝每人各开一枪（mult × atk + 1d(diceS)，物理，
 *    baseBreak 击破，每枪都能协助格挡）。开枪用掉王那一回合的行动点。和公开处刑撞在同一回合时，处刑往后推一回合。
 *  援军：首领战开场就写着狂徒援军要赶来（run.js · ENEMY_INFO.outlaw_king.waves，chain.js）；场上敌人全灭、战斗结束就不来了。
 *  攻击命令 / 处死命令的骰子随等级升档（每 5 级一档，和杂兵一样）。 */
const KING_CFG = {
  exec: { turns: 2, cooldown: 3, kingMult: 1.5, kingDie: 6, crewMult: 1, crewDie: 6, grab: 0.5 },
  volley: { mult: 1, diceS: 8, baseBreak: 2 },
  // 回防：手下（狂徒 / 强盗头子）被打倒过，王下次行动改成回防命令；cooldown 回合内最多一次（作者定：先设 3，实际游玩再调）
  hold: { cooldown: 3 }
};

/** 沙灵聚合体一阶段 · 沙尘爆裂（作者定：「远离」首领机制）：开场标记我方全员，turns 回合后在敌人回合开始时
 *  每个被标记的人在自己所在的区爆炸一次，对这个区每个友方各 blast × atk（不能格挡）——要分开站。之后每 interval 回合一次；外层沙壳打穿就停。 */
const AGG_SPREAD = { firstTurn: 1, turns: 1, interval: 2, blast: 0.6 };

/** 沙灵聚合体一阶段 · 狂暴连打（作者定）：聚合体回合花 1 行动点预备，指定一名随机敌人（被嘲讽 / 决一死战时就是牵制者）；
 *  下一个敌人回合冲到目标所在的区连打 hits 击：每击 mult × atk + 1d(diceS) 物理、baseBreak 击破，每击都能协助格挡，成功率 +blockBonus%。
 *  出手时被嘲讽就转火牵制者；原目标倒下就随机换一个。全部被格挡下来：聚合体自己受到 selfBreak 击破。
 *  firstTurn 起才会预备；打完过 cooldown 回合（从出手那回合算）才会再预备。进入二阶段就作废。 */
const AGG_RUSH = { firstTurn: 2, cooldown: 3, hits: 4, mult: 1, diceS: 8, baseBreak: 1, blockBonus: 10, selfBreak: 4 };

function ufoLegStats(lv) {
  const extra = Math.max(0, (Number(lv) || 1) - 1);
  return {
    spirit: 8 + extra * 2,
    armor: 6 + extra * 2,
    shield: 6 + extra * 3,
    def: 10 + milestone(lv, 2),
    atk: 9 + extra
  };
}

function enemyPresets() {
  return [
    { id: "guard_sword", name: "机器人看守（剑）", build(lv, p) {
      const extra = lv - 1;
      const armor = 14 + extra * 5;
      const def = 3 + Math.floor(lv / 5);
      const atk = 4 + Math.floor(lv / 2);
      let dice = [1, 4], extraFlat = 0;
      if (lv >= 4) dice = [1, 6];
      if (lv >= 8) dice = [1, 8];
      if (lv >= 12) dice = [1, 10];
      if (lv >= 16) dice = [1, 12];
      if (lv >= 20) dice = [1, 20];
      if (lv >= 25) extraFlat = 10;
      if (lv >= 30) extraFlat = 20;
      return unitOf(this.name, lv, [{ type: "armor", hp: scaleHp(armor, p) }], def, atk, { kit: "guard_sword", range: "melee", dice, flat: extraFlat, element: "electric" });
    }},
    // 第一采矿场：数值同机器人看守（剑），装甲的一半换成护盾（护盾在外）；攻击改成酸
    { id: "mine_guard", name: "矿场看守机器人", build(lv, p) {
      const extra = lv - 1;
      const armor = 14 + extra * 5;
      const shield = Math.round(armor / 2);
      const def = 3 + Math.floor(lv / 5);
      const atk = 4 + Math.floor(lv / 2);
      let dice = [1, 4], extraFlat = 0;
      if (lv >= 4) dice = [1, 6];
      if (lv >= 8) dice = [1, 8];
      if (lv >= 12) dice = [1, 10];
      if (lv >= 16) dice = [1, 12];
      if (lv >= 20) dice = [1, 20];
      if (lv >= 25) extraFlat = 10;
      if (lv >= 30) extraFlat = 20;
      return unitOf(this.name, lv, [
        { type: "shield", hp: scaleHp(shield, p) },
        { type: "armor", hp: scaleHp(armor - shield, p) }
      ], def, atk, { kit: "mine_guard", range: "melee", dice, flat: extraFlat, element: "acid" });
    }},
    { id: "guard_gun", name: "机器人看守（枪）", build(lv, p) {
      const armor = 12 + (lv - 1) * 4;
      const atk = 5 + (lv - 1);
      const def = 3 + milestone(lv, 10);
      return unitOf(this.name, lv, [{ type: "armor", hp: scaleHp(armor, p) }], def, atk, { kit: "guard_gun", range: "ranged", dice: [1, 4], element: "energy" });
    }},
    { id: "thug_knife", name: "狂徒（匕首）", build(lv, p) {
      return unitOf(this.name, lv, [{ type: "flesh", hp: scaleHp(17 + (lv - 1) * 4, p) }], 3 + milestone(lv, 10), 5 + (lv - 1), { kit: "thug_knife", range: "melee", dice: [1, 8], element: "physical" });
    }},
    { id: "thug_hammer", name: "狂徒（锤）", build(lv, p) {
      return unitOf(this.name, lv, [{ type: "flesh", hp: scaleHp(20 + (lv - 1) * 6, p) }], 4 + milestone(lv, 10), 4 + (lv - 1), { kit: "thug_hammer", range: "melee", dice: [1, 6], element: "physical", baseBreak: 2 });
    }},
    { id: "boomcar", name: "自爆小车", build(lv, p) {
      return unitOf(this.name, lv, [
        { type: "shield", hp: scaleHp(5 + (lv - 1) * 2, p) },
        { type: "armor", hp: scaleHp(3, p) }
      ], 2, 7 + (lv - 1) * 2, { kit: "boomcar", range: "melee", dice: [1, 6], element: "energy", baseBreak: 2, resources: { fuse: 1 } });
    }},
    { id: "sand_beast", name: "沙灵（四足）", build(lv, p) {
      const atk = 5 + milestone(lv, 2) + milestone(lv, 5);
      return unitOf(this.name, lv, [{ type: "sand", hp: scaleHp(18 + (lv - 1) * 4, p) }], 3, atk, { kit: "sand_beast", range: "melee", dice: [1, 4], element: "physical" });
    }},
    { id: "sand_human", name: "沙灵（人形）", build(lv, p) {
      const atk = 6 + (lv - 1) + milestone(lv, 5);
      return unitOf(this.name, lv, [{ type: "sand", hp: scaleHp(10 + (lv - 1) * 4, p) }], 3, atk, { kit: "sand_human", range: "ranged", dice: [1, 4], element: "physical" });
    }},
    { id: "buoy", name: "巡检浮标", build(lv, p) {
      return unitOf(this.name, lv, [
        { type: "shield", hp: scaleHp(10 + (lv - 1) * 3, p) },
        { type: "armor", hp: scaleHp(1, p) }
      ], 3 + milestone(lv, 2), 4 + (lv - 1) * 2, { kit: "buoy", flying: true, range: "melee", dice: [1, 4], element: "electric" });
    }},
    { id: "dumpdrone", name: "投料无人机", build(lv, p) {
      return unitOf(this.name, lv, [{ type: "armor", hp: scaleHp(8 + (lv - 1) * 3, p) }], 2 + milestone(lv, 2), 5 + (lv - 1) * 2, { kit: "dumpdrone", flying: true, range: "ranged", dice: [1, 4], element: "acid" });
    }},
    { id: "swarm", name: "空投蜂群", build(lv, p) {
      const u = unitOf(this.name, lv, [
        { type: "shield", hp: scaleHp(4 + (lv - 1) * 2, p) },
        { type: "armor", hp: scaleHp(1, p) }
      ], 1 + milestone(lv, 2), 6 + (lv - 1) * 2, { kit: "swarm", flying: true, range: "melee", dice: [2, 4], element: "physical" });
      // 靠数量取胜的小兵：架势无论几级、几人队都不超过 3（作者定）
      u.defMax = Math.min(3, u.defMax);
      u.def = Math.min(u.def, u.defMax);
      return u;
    }},
    { id: "crow", name: "穴鸦", build(lv, p) {
      return unitOf(this.name, lv, [{ type: "flesh", hp: scaleHp(10 + (lv - 1) * 3, p) }], 2 + milestone(lv, 5), 5 + (lv - 1) * 2, { kit: "crow", flying: true, range: "melee", dice: [1, 4], element: "harmonic" });
    }},
    { id: "mecha_mg", name: "机甲触灵（机枪）", build(lv, p) {
      return unitOf(this.name, lv, [
        { type: "shield", hp: scaleHp(17 + (lv - 1) * 5, p) },
        { type: "armor", hp: scaleHp(20 + (lv - 1) * 4, p) },
        { type: "spirit", hp: scaleHp(5 + (lv - 1) * 2 + milestone(lv, 5) * 2, p) }
      ], 5 + milestone(lv, 5), 5 + (lv - 1), { kit: "mecha_mg", range: "any", dice: [1, 6], element: "physical", baseBreak: 2 });
    }},
    { id: "mecha_gl", name: "机甲触灵（榴弹）", build(lv, p) {
      return unitOf(this.name, lv, [
        { type: "shield", hp: scaleHp(10 + (lv - 1) * 4 + milestone(lv, 5) * 2, p) },
        { type: "armor", hp: scaleHp(15 + (lv - 1) * 4, p) },
        { type: "spirit", hp: scaleHp(5 + (lv - 1) * 2, p) }
      ], 5 + milestone(lv, 5), 6 + (lv - 1), { kit: "mecha_gl", range: "ranged", dice: [1, 4], element: "fire", baseBreak: 2 });
    }},
    { id: "bandit_boss", name: "强盗头子", build(lv, p) {
      const armor = milestone(lv, 5) * 20;
      const layers = [{ type: "flesh", hp: scaleHp(28 + (lv - 1) * 7, p) }];
      if (armor) layers.unshift({ type: "armor", hp: scaleHp(armor, p) });
      return unitOf(this.name, lv, layers, 6 + milestone(lv, 5), 6 + (lv - 1) + milestone(lv, 5), { kit: "bandit_boss", range: "any", dice: [1, 8], element: "fire", baseBreak: 2 });
    }},
    { id: "captain_wolf", name: "警卫队队长（狼）", build(lv, p) {
      return unitOf(this.name, lv, [
        { type: "shield", hp: scaleHp(15 + (lv - 1) * 6, p) },
        { type: "flesh", hp: scaleHp(20 + (lv - 1) * 5, p) }
      ], 4 + milestone(lv, 5), 8 + milestone(lv, 2) + milestone(lv, 5) * 2, { kit: "captain_wolf", range: "melee", dice: [1, 4], element: "ice" });
    }},
    { id: "captain_ox", name: "警卫队队长（牛）", build(lv, p) {
      return unitOf(this.name, lv, [
        { type: "shield", hp: scaleHp(16 + (lv - 1) * 5 + milestone(lv, 5) * 4, p) },
        { type: "flesh", hp: scaleHp(26 + (lv - 1) * 7, p) }
      ], 5 + milestone(lv, 5), 6 + milestone(lv, 5) * 2, { kit: "captain_ox", range: "any", dice: [1 + milestone(lv, 5), 4], element: "ice", baseBreak: 2 });
    }},
    { id: "captain_lizard", name: "警卫队队长（蜥蜴）", build(lv, p) {
      return unitOf(this.name, lv, [
        { type: "shield", hp: scaleHp(12 + (lv - 1) * 5 + milestone(lv, 2) * 5, p) },
        { type: "flesh", hp: scaleHp(14 + (lv - 1) * 2, p) }
      ], 4, 7 + milestone(lv, 2) + milestone(lv, 5), { kit: "captain_lizard", range: "ranged", dice: [1, 6], element: "acid", baseBreak: 2 });
    }},
    // 第一采矿场精英（暂定数值，按狼队长的总血量 / 架势 / atk 拆成护盾、装甲、肉体三层）
    { id: "ant_guard", name: "蚁型特殊戒备兵种", build(lv, p) {
      return unitOf(this.name, lv, [
        { type: "shield", hp: scaleHp(10 + (lv - 1) * 4, p) },
        { type: "armor", hp: scaleHp(10 + (lv - 1) * 3, p) },
        { type: "flesh", hp: scaleHp(15 + (lv - 1) * 4, p) }
      ], 4 + milestone(lv, 5), 8 + milestone(lv, 2) + milestone(lv, 5) * 2, { kit: "ant_guard", range: "ranged", dice: [1, 6], element: "acid" });
    }},
    // —— 第二采矿场（火）——
    // 矿场监工：数值同狂徒（锤），血量的一半换成装甲（装甲在外）
    { id: "mine_overseer", name: "矿场监工", build(lv, p) {
      const hp = 20 + (lv - 1) * 6, armor = Math.round(hp / 2);
      return unitOf(this.name, lv, [
        { type: "armor", hp: scaleHp(armor, p) },
        { type: "flesh", hp: scaleHp(hp - armor, p) }
      ], 4 + milestone(lv, 10), 4 + (lv - 1), { kit: "mine_overseer", range: "melee", dice: [1, 6], element: "fire", baseBreak: 2 });
    }},
    // 火石清扫机：数值同机器人看守（枪）
    { id: "flint_sweeper", name: "火石清扫机", build(lv, p) {
      return unitOf(this.name, lv, [{ type: "armor", hp: scaleHp(12 + (lv - 1) * 4, p) }], 3 + milestone(lv, 10), 5 + (lv - 1),
        { kit: "flint_sweeper", range: "ranged", dice: [1, 4], element: "fire" });
    }},
    // 燃气收集机：数值同机甲触灵（榴弹），星灵换成肉体
    { id: "gas_collector", name: "燃气收集机", build(lv, p) {
      return unitOf(this.name, lv, [
        { type: "shield", hp: scaleHp(10 + (lv - 1) * 4 + milestone(lv, 5) * 2, p) },
        { type: "armor", hp: scaleHp(15 + (lv - 1) * 4, p) },
        { type: "flesh", hp: scaleHp(5 + (lv - 1) * 2, p) }
      ], 5 + milestone(lv, 5), 6 + (lv - 1), { kit: "gas_collector", range: "melee", dice: [0, 0], element: "fire", baseBreak: 1 });
    }},
    // 蚁型特殊剿灭兵种：血量 / 架势同牛队长，护盾换成装甲；atk 线性成长（1 级 6、20 级 30）
    { id: "ant_hunter", name: "蚁型特殊剿灭兵种", build(lv, p) {
      return unitOf(this.name, lv, [
        { type: "armor", hp: scaleHp(16 + (lv - 1) * 5 + milestone(lv, 5) * 4, p) },
        { type: "flesh", hp: scaleHp(26 + (lv - 1) * 7, p) }
      ], 5 + milestone(lv, 5), Math.round(6 + (lv - 1) * 24 / 19), { kit: "ant_hunter", range: "ranged", dice: [1, 8], element: "fire", baseBreak: 1 });
    }},
    // —— 第三采矿场（能量）——
    // 矿场警戒自动机：数值同机器人看守（剑），血量 60% 装甲 + 40% 护盾（护盾在外）；开场休眠
    { id: "alarm_bot", name: "矿场警戒自动机", build(lv, p) {
      const total = 14 + (lv - 1) * 5, shield = Math.round(total * 0.4);
      const u = unitOf(this.name, lv, [
        { type: "shield", hp: scaleHp(shield, p) },
        { type: "armor", hp: scaleHp(total - shield, p) }
      ], 3 + Math.floor(lv / 5), 4 + Math.floor(lv / 2), { kit: "alarm_bot", range: "any", dice: [1, 4], element: "energy" });
      u.dormant = true;
      return u;
    }},
    // 陨石开采机：数值同投料无人机，血量 60% 星灵 + 40% 护盾（护盾在外）；开场带蓄能
    { id: "meteor_miner", name: "陨石开采机", build(lv, p) {
      const total = 8 + (lv - 1) * 3, shield = Math.round(total * 0.4);
      const u = unitOf(this.name, lv, [
        { type: "shield", hp: scaleHp(shield, p) },
        { type: "spirit", hp: scaleHp(total - shield, p) }
      ], 2 + milestone(lv, 2), 5 + (lv - 1) * 2, { kit: "meteor_miner", flying: true, range: "ranged", dice: [0, 0], element: "energy" });
      u.self = "store";
      return u;
    }},
    // —— 第三采矿场 · 异星生物（星灵）——
    // 陨体衍蛛：血量同空投蜂群（全部星灵），架势同机器人看守（枪），atk 同巡检浮标
    { id: "meteor_spider", name: "陨体衍蛛", build(lv, p) {
      return unitOf(this.name, lv, [{ type: "spirit", hp: scaleHp(5 + (lv - 1) * 2, p) }], 3 + milestone(lv, 10), 4 + (lv - 1) * 2,
        { kit: "meteor_spider", range: "melee", dice: [0, 0], element: "energy" });
    }},
    // 陨体弦蚣：数值同狂徒（匕首），血量全部星灵
    { id: "meteor_centipede", name: "陨体弦蚣", build(lv, p) {
      return unitOf(this.name, lv, [{ type: "spirit", hp: scaleHp(17 + (lv - 1) * 4, p) }], 3 + milestone(lv, 10), 5 + (lv - 1),
        { kit: "meteor_centipede", range: "ranged", dice: [0, 0], element: "energy" });
    }},
    // —— 沙漠生物（desert.js）：沙尘 + 装甲 ——
    { id: "sandfish_lead", name: "领潮沙鱼", build(lv, p) {
      return unitOf(this.name, lv, [
        { type: "sand", hp: scaleHp(15 + (lv - 1) * 4, p) },
        { type: "armor", hp: scaleHp(20 + (lv - 1) * 5, p) }
      ], 5 + milestone(lv, 5), 6 + (lv - 1), { kit: "sandfish_lead", range: "melee", dice: [1, 6], element: "physical", baseBreak: 2 });
    }},
    { id: "sandfish_drive", name: "赶潮沙鱼", build(lv, p) {
      return unitOf(this.name, lv, [
        { type: "sand", hp: scaleHp(6 + (lv - 1) * 2, p) },
        { type: "armor", hp: scaleHp(8 + (lv - 1) * 2, p) }
      ], 3 + milestone(lv, 10), 4 + (lv - 1), { kit: "sandfish_drive", range: "melee", dice: [1, 4], element: "physical" });
    }},
    { id: "sandfish_ambush", name: "伏咬沙鱼", build(lv, p) {
      return unitOf(this.name, lv, [
        { type: "sand", hp: scaleHp(5 + (lv - 1) * 2, p) },
        { type: "armor", hp: scaleHp(7 + (lv - 1) * 2, p) }
      ], 3 + milestone(lv, 10), 6 + (lv - 1), { kit: "sandfish_ambush", range: "melee", dice: [1, 6], element: "physical" });
    }},
    // —— 中立生物：不攻击，血量 = 沙鱼吞掉它能回的血 ——
    { id: "dust_bug", name: "尘虫", build(lv, p) {
      return unitOf(this.name, lv, [
        { type: "sand", hp: scaleHp(2 + (lv - 1), p) },
        { type: "armor", hp: scaleHp(3 + (lv - 1), p) }
      ], 2 + milestone(lv, 10), 0, { kit: "dust_bug", range: "melee", dice: [0, 0], element: "physical" });
    }},
    { id: "tube_worm", name: "管虫", build(lv, p) {
      return unitOf(this.name, lv, [
        { type: "sand", hp: scaleHp(3 + (lv - 1), p) },
        { type: "armor", hp: scaleHp(5 + (lv - 1), p) }
      ], 1 + milestone(lv, 10), 0, { kit: "tube_worm", range: "melee", dice: [0, 0], element: "physical" });
    }},
    { id: "bigsand", name: "大沙灵", build(lv, p) {
      return unitOf(this.name, lv, [{ type: "sand", hp: scaleHp(37 + (lv - 1) * 6 + milestone(lv, 2), p) }], 4, 5 + milestone(lv, 2), { kit: "bigsand", range: "melee", dice: [1, 4], element: "physical" });
    }},
    { id: "livesand", name: "活沙", build(lv, p) {
      return unitOf(this.name, lv, [{ type: "sand", hp: scaleHp(20 + (lv - 1), p) }], 4, 7, { kit: "livesand", range: "any", dice: [0, 0], element: "physical" });
    }},
    { id: "giant", name: "巨人", build(lv, p) {
      return unitOf(this.name, lv, [
        { type: "shield", hp: scaleHp(15 + (lv - 1) * 4, p) },
        { type: "flesh", hp: scaleHp(35 + (lv - 1) * 5, p) }
      ], 5 + milestone(lv, 10), 6, { kit: "giant", range: "any", dice: [1 + (lv - 1), 8], element: "physical", baseBreak: 2 });
    }},
    { id: "patrolboat", name: "高压巡逻艇", build(lv, p) {
      const d = Math.max(0, lv - 3);
      return unitOf(this.name, lv, [
        { type: "shield", hp: scaleHp(15 + d * 4, p) },
        { type: "armor", hp: scaleHp(17 + d * 5, p) }
      ], 5 + milestone(lv, 5) - milestone(3, 5), 9 + d * 3, { kit: "patrolboat", flying: true, range: "ranged", dice: [1, 6], element: "electric" });
    }},
    { id: "spreader", name: "播撒者", build(lv, p) {
      const d = Math.max(0, lv - 3);
      return unitOf(this.name, lv, [
        { type: "shield", hp: scaleHp(10 + d * 3, p) },
        { type: "armor", hp: scaleHp(22 + d * 6, p) }
      ], 4 + milestone(lv, 5) - milestone(3, 5), 7 + d * 2, { kit: "spreader", flying: true, range: "ranged", dice: [1, 6], element: "acid" });
    }},
    { id: "watchcrow", name: "观测鸦", build(lv, p) {
      const d = Math.max(0, lv - 4);
      return unitOf(this.name, lv, [
        { type: "shield", hp: scaleHp(15 + d * 5, p) },
        { type: "spirit", hp: scaleHp(12 + d * 3, p) }
      ], 6 + milestone(lv, 5) - milestone(4, 5), 10 + d * 3, { kit: "watchcrow", flying: true, range: "ranged", dice: [1, 8], element: "energy", resources: { reflect: true } });
    }},
    { id: "dustbody", name: "扬尘体", build(lv, p) {
      const d = Math.max(0, lv - 3);
      return unitOf(this.name, lv, [
        { type: "armor", hp: scaleHp(15 + d * 3, p) },
        { type: "sand", hp: scaleHp(20 + d * 4, p) }
      ], 4 + milestone(lv, 5) - milestone(3, 5), 8 + d * 3, { kit: "dustbody", flying: true, range: "melee", dice: [1, 6], element: "physical" });
    }},
    { id: "sand_aggregate", name: "沙灵聚合体", build(lv, p) {
      const d = Math.max(0, (lv || 1) - 1);
      const { outer, armor, inner } = aggregateLayerHp(lv);
      const atk = 10 + d;
      const def = 11 + milestone(lv, 2);
      const u = unitOf("沙灵聚合体", lv, [
        { type: "sand", hp: scaleHp(outer, p) },
        { type: "armor", hp: scaleHp(armor, p) },
        { type: "sand", hp: scaleHp(inner, p) }
      ], def, atk, {
        kit: "sand_aggregate", range: "any", element: "physical", dice: [1, 8], baseBreak: 3,
        resources: { phase: 1, debrisCount: 0 }
      });
      if (typeof aggArmSpread === "function") aggArmSpread(u);   // 一阶段：沙尘爆裂（远离机制）
      return u;
    }},
    { id: "outlaw_king", name: "亡命之王", build(lv, p) {
      const u = unitOf(this.name, lv, [
        { type: "armor", hp: scaleHp(35 + (lv - 1) * 7, p) },
        { type: "flesh", hp: scaleHp(50 + (lv - 1) * 11, p) }
      ], 7 + milestone(lv, 5), 11 + (lv - 1) + milestone(lv, 5) * 2, { kit: "outlaw_king", range: "any", dice: [1, leveledSides(lv, 4)], element: "fire" });
      return u;
    }},
    { id: "chixia", name: "赤牙", build(lv, p) {
      const table = {
        5: { flesh: 45, armor: 45, sand: 25, def: 10, atk: 23 },
        10: { flesh: 70, armor: 70, sand: 50, def: 11, atk: 30 },
        15: { flesh: 95, armor: 95, sand: 65, def: 12, atk: 37 },
        20: { flesh: 140, armor: 130, sand: 90, def: 13, atk: 44 },
        25: { flesh: 160, armor: 160, sand: 120, def: 14, atk: 51 }
      };
      const row = table[lv] || table[5];
      return unitOf(this.name, lv, [
        { type: "sand", hp: scaleHp(row.sand, p) },
        { type: "armor", hp: scaleHp(row.armor, p) },
        { type: "flesh", hp: scaleHp(row.flesh, p) }
      ], row.def, row.atk, { kit: "chixia", range: "any", dice: [0, 0], element: "fire", resources: { primed: false, cover: false } });
    }},
    { id: "ufo_boss", name: "飞碟触灵（Boss 组）", build(lv, p) {
      const s = ufoLegStats(lv);
      return unitOf("飞碟触灵·本体", lv, [
        { type: "shield", hp: scaleHp(s.shield * 5, p) },
        { type: "armor", hp: scaleHp(s.armor * 5, p) },
        { type: "spirit", hp: scaleHp(s.spirit * 5, p) }
      ], s.def, s.atk, { kit: "ufo_body", range: "any", flying: true, element: "energy", dice: [1, 4], baseBreak: 1, resources: { boomReady: false } });
    }},
    { id: "ufo_leg", name: "飞碟触灵·机械足", build(lv, p) {
      const s = ufoLegStats(lv);
      return unitOf("机械足", lv, [
        { type: "shield", hp: scaleHp(s.shield, p) },
        { type: "armor", hp: scaleHp(s.armor, p) },
        { type: "spirit", hp: scaleHp(s.spirit, p) }
      ], 0, 0, { kit: "ufo_leg", range: "any", element: "physical" });
    }},
    { id: "patrol_car", name: "安保巡逻车", build(lv, p) {
      const extra = Math.max(0, (lv || 1) - 1);
      const armor = 16 + extra * 5;
      const atk = 6 + milestone(lv, 2);
      const def = 4 + milestone(lv, 10);
      return unitOf(this.name, lv, [{ type: "armor", hp: scaleHp(armor, p) }], def, atk, {
        kit: "patrol_car", range: "any", element: "harmonic", dice: [0, 4], baseBreak: 1,
        resources: { blockUsedThisTurn: false },
        lootKuizhi: 30
      });
    }},
    { id: "blank_pc", name: "玩家角色（空白）", build(lv) {
      return unitOf("玩家", lv, [
        { type: "flesh", hp: 12 }
      ], 4, 4, { range: "any", isPlayer: true });
    }}
  ];
}

function enemySpawnZone(mode) {
  const b = typeof state !== "undefined" ? state.board : null;
  if (b && b.zones && b.enemyZone) return Number(b.enemyZone);
  const m = mode != null ? mode : (typeof state !== "undefined" ? state.zoneMode : 2);
  return Number(m) === 3 ? 3 : 2;
}

function unitOf(name, level, layers, def, atk, extra = {}) {
  const hpParty = extra.isPlayer ? null : _lastHpParty;
  _lastHpParty = null;
  // 架势的人数加成和血量按同一个人数算：预设的 build(lv, p) 只把 p 交给了 scaleHp，这里接着用它
  // （以前没传，按场上人数算，图鉴里 3 / 4 人队的架势就少了人数加成）
  const party = extra.party != null ? extra.party : hpParty;
  return {
    id: uid(),
    name,
    level: level || 1,
    zone: extra.zone != null ? extra.zone : (extra.isPlayer ? 1 : enemySpawnZone()),
    layers: layers.map((l, i) => ({ type: l.type, current: l.hp, max: l.hp, inner: i === layers.length - 1 })),
    def: extra.isPlayer ? def : scaleDef(def, party, extra.kit, level),
    defMax: extra.isPlayer ? def : scaleDef(def, party, extra.kit, level),
    atk,
    flying: !!extra.flying,
    stunned: false,
    isPlayer: !!extra.isPlayer,
    range: extra.range || "melee",
    suggest: {
      element: extra.element || "physical",
      dice: extra.dice || [1, 4],
      flat: extra.flat || 0,
      baseBreak: extra.baseBreak || 1
    },
    statuses: {
      burn: 0, shock: false, corr: false, frostbite: false, shockwave: false,
      high: false, reso: false, unstable: false, weak: false, inspire: false,
      sturdy: false, hide: false, advantage: false, chase: false, latestElement: null
    },
    instant: { melt: false, sting: false, overload: false, shift: false, spread: false, refract: false },
    self: "none",
    highEnergy: 0,
    interfere: 0,
    sandLocked: false,
    gotHitThisTurn: false,
    damagedThisTurn: 0,
    lostDefThisTurn: 0,
    ap: extra.ap != null ? extra.ap : (extra.isPlayer ? 1 : 0),
    apMax: extra.apMax != null ? extra.apMax : (extra.isPlayer ? 1 : 0),
    bonus: extra.bonus != null ? extra.bonus : (extra.isPlayer ? 1 : 0),
    bonusMax: extra.bonusMax != null ? extra.bonusMax : (extra.isPlayer ? 1 : 0),
    loseBonusNext: !!extra.loseBonusNext,
    shp: extra.shp != null ? extra.shp : 0,
    shpMax: extra.shpMax != null ? extra.shpMax : (extra.shp || 0),
    dying: false,
    upOnShp: false,
    dead: false,
    kit: extra.kit || null,
    role: extra.role || (extra.isPlayer ? "player" : "enemy"),
    personalAtk: extra.personalAtk != null ? extra.personalAtk : atk,
    weaponAtk: extra.weaponAtk || 0,
    weaponHeld: extra.weaponHeld !== false,
    resources: extra.resources ? Object.assign({}, extra.resources) : {},
    linked: extra.linked || [],
    hidden: !!extra.hidden,
    fused: !!extra.fused,
    lootKuizhi: extra.lootKuizhi || 0,
    noPosture: !!extra.noPosture,
    party: extra.party,
    hpParty,
    defParty: extra.isPlayer ? null : partyScaleCount(party)
  };
}
