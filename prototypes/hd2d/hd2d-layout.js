/* Antlerscale: Backfire · HD-2D 战场原型 · 布局（纯函数）
 *
 * 只做计算：输入战斗状态（state），输出每个区在 3D 世界里的位置 / 大小、区之间的间隔、每个单位的站位和铭牌上要写的字。
 * 不碰 three.js，也不碰 DOM，所以 Node 里可以直接 require 来测（tests/hd2d-layout.test.js）。
 *
 *   const out = HD2DLayout.build(state, { portrait: false });
 *   out.zones   [{ id, cx, cz, w, d, h, topY, kind, effects, hole … }]
 *   out.gaps    [{ key, a, b, type, open, x, z, axis, length, width … }]
 *   out.units   [{ id, zone, x, y, z, flying, submerged, plate … }]
 *   out.bounds  { minX, maxX, minZ, maxZ, maxY }
 *
 * 坐标：x 向右，y 向上，z 朝镜头（镜头在 +z 一侧看过来）。我方站在 +z（前排），敌方站在 −z（后排）。
 * 坚毅生命（shp）的具体数值是手册规定不给玩家看的：铭牌数据（plateData）里压根不读它。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HD2DLayout = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- 配置（数值都在这里，逻辑里不写死）---------- */
  const CONFIG = {
    zoneSize: 6.4,        // 每个区的地台边长
    zoneGap: 2.6,         // 区和区之间的缝（桥 / 墙 / 门 / 空隙摆在这条缝里）
    baseH: 0.5,           // 普通地台的厚度（顶面高度）
    highH: 1.3,           // 高地 / 沙珊瑚台地的顶面高度
    pad: 0.9,             // 地台边缘留给装饰的一圈，单位不站进去
    holeRatio: 0.2,       // 深渊黑洞半径 = 地台边长 × 这个比例
    unit: {
      w: 1.5,             // 铭牌占的宽
      d: 0.9,             // 铭牌占的进深（站位格子的大小，不是画出来的厚度）
      rowStep: 1.15,      // 前后两排的间距（地台放不下时压缩，最小 = d）
      groupGap: 0.5,      // 敌我两拨之间多留的空
      flyLift: 1.25,      // 飞行单位浮起的高度
      sink: 0.55,         // 下潜单位沉下去的深度（铭牌只露半截）
      plateW: 1.5,        // 铭牌画出来的宽
      plateH: 1.1         // 铭牌画出来的高
    },
    maxDefPips: 12        // 架势菱形最多画几个（训练木桩之类的巨大架势不画满）
  };

  /** 地台样子的优先级：靠前的盖过靠后的 */
  const KIND_ORDER = ["abyss", "acid", "quicksand", "coral", "highland", "fire", "ice", "electric", "energy", "harmonic", "heal"];

  /** 状态徽章：statuses 里的键 → 铭牌上的字（敌我通用）。数值型的（灼烧层数）带上层数 */
  const STATUS_LABELS = {
    burn: "灼烧", shock: "感电", corr: "腐蚀", frostbite: "冻伤", shockwave: "震荡", high: "高能", reso: "共振",
    unstable: "不稳", weak: "虚弱", inspire: "鼓舞", sturdy: "坚毅", hide: "隐匿", advantage: "优势", chase: "追击"
  };

  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

  /* ---------- 棋盘 ---------- */
  /** 读棋盘：特殊棋盘用 state.board；没有就按 zoneMode 当直排（和规则里 currentBoard 的口径一致） */
  function boardOf(state) {
    const b = state && state.board;
    if (b && Array.isArray(b.zones) && b.zones.length) {
      return {
        id: b.id || "custom",
        zones: b.zones.map(z => ({ id: Number(z.id), x: Number(z.x), y: Number(z.y) })),
        links: (b.links || []).map(l => [Number(l[0]), Number(l[1])])
      };
    }
    const n = Math.max(1, Math.min(6, Math.round(num(state && state.zoneMode, 2))));
    const zones = [], links = [];
    for (let i = 1; i <= n; i++) { zones.push({ id: i, x: i - 1, y: 0 }); if (i > 1) links.push([i - 1, i]); }
    return { id: "line" + n, zones, links };
  }

  const gapKeyOf = (a, b) => Math.min(a, b) + "-" + Math.max(a, b);

  /** 一个区的场地标记 → 地台样子 */
  function fieldKinds(f) {
    f = f || {};
    const on = {
      abyss: !!f.abyss, acid: !!f.acid, quicksand: !!f.quicksand, coral: !!f.coral, highland: !!f.highland,
      fire: num(f.fire, 0) > 0 || !!f.fireOn, ice: !!f.ice, electric: !!f.electric,
      energy: !!f.energy, harmonic: !!f.harmonic, heal: !!f.heal
    };
    const effects = KIND_ORDER.filter(k => on[k]);
    return { kind: effects[0] || "concrete", effects };
  }

  /* ---------- 铭牌数据 ---------- */
  /** 铭牌上要写的内容。只读白名单里的字段——坚毅生命（shp）不在其中 */
  function plateData(u) {
    const layers = (u.layers || []).map(l => ({ type: String(l.type), cur: Math.max(0, num(l.current, 0)), max: Math.max(0, num(l.max, 0)) }));
    const cur = layers.reduce((a, l) => a + l.cur, 0), max = layers.reduce((a, l) => a + l.max, 0);
    const defMax = Math.max(0, num(u.defMax, 0)), def = Math.max(0, num(u.def, 0));
    const shown = Math.min(CONFIG.maxDefPips, Math.max(defMax, def));
    const sts = u.statuses || {};
    const statuses = [];
    Object.keys(STATUS_LABELS).forEach(k => {
      const v = sts[k];
      if (!v) return;
      const n = typeof v === "number" && v > 1 ? v : 0;
      statuses.push({ key: k, label: STATUS_LABELS[k] + (n ? n : ""), n });
    });
    const flags = [];
    if (u.stunned) flags.push({ key: "stunned", label: "失衡" });
    if (u.dying) flags.push({ key: "dying", label: "濒死" });
    const plate = {
      id: u.id, name: String(u.name || "?"), level: num(u.level, 1), atk: num(u.atk, 0),
      side: u.isPlayer ? "player" : "foe",
      hp: { cur, max }, layers,
      def: { cur: Math.min(def, shown), max: shown, big: Math.max(defMax, def) > CONFIG.maxDefPips },
      statuses, flags
    };
    plate.text = [plate.name, "Lv" + plate.level, "ATK " + plate.atk, cur + "/" + max]
      .concat(statuses.map(s => s.label), flags.map(f => f.label));
    return plate;
  }

  /* ---------- 站位 ---------- */
  /** 一个区里所有单位的站位（局部坐标，相对区中心）。敌方在后排（−z），我方在前排（+z） */
  function arrangeUnits(zone, list) {
    const U = CONFIG.unit;
    const usableW = zone.w - 2 * CONFIG.pad, usableD = zone.d - 2 * CONFIG.pad;
    const perRow = Math.max(1, Math.floor(usableW / U.w + 1e-9));
    const foes = list.filter(u => !u.isPlayer), mine = list.filter(u => u.isPlayer);
    const rowsOf = (g) => {
      const rows = [];
      for (let i = 0; i < g.length; i += perRow) rows.push(g.slice(i, i + perRow));
      return rows;
    };
    const fr = rowsOf(foes), mr = rowsOf(mine);
    const total = fr.length + mr.length;
    const both = fr.length && mr.length;
    const extra = both ? U.groupGap : 0;
    const step = total > 1 ? Math.max(U.d, Math.min(U.rowStep, (usableD - extra) / (total - 1))) : 0;
    const out = [];
    const put = (rows, zOf) => rows.forEach((row, r) => row.forEach((u, i) => {
      out.push({ unit: u, x: (i - (row.length - 1) / 2) * U.w, z: zOf(r), row: r, col: i });
    }));
    if (zone.hole > 0) {
      // 深渊：黑洞在地台中间，地面单位站在洞的两侧边沿上，敌方在后、我方在前
      const rim = zone.hole + U.d / 2 + 0.35;
      put(fr, r => -rim - r * step);
      put(mr, r => rim + r * step);
    } else {
      // 其余：两拨一起居中。后排是敌方（第 0 排最靠后），紧接着是我方
      const top = -((total - 1) * step + extra) / 2;
      put(fr, r => top + r * step);
      put(mr, r => top + (fr.length + r) * step + extra);
    }
    return out;
  }

  /* ---------- 总入口 ---------- */
  /**
   * 排出整个战场。
   *   opts.portrait  竖屏（手机）：整块棋盘转 90°，直排沿进深（前后）排开，我方在最前面
   */
  function build(state, opts) {
    opts = opts || {};
    const portrait = !!opts.portrait;
    const board = boardOf(state);
    const S = CONFIG.zoneSize, pitch = S + CONFIG.zoneGap;
    const xs = board.zones.map(z => z.x), ys = board.zones.map(z => z.y);
    const midX = (Math.min(...xs) + Math.max(...xs)) / 2, midY = (Math.min(...ys) + Math.max(...ys)) / 2;

    const zones = board.zones.map(bz => {
      const fk = fieldKinds((state.fields || {})[bz.id]);
      const high = fk.effects.includes("highland") || fk.effects.includes("coral");
      const h = high ? CONFIG.highH : CONFIG.baseH;
      const cx = portrait ? (bz.y - midY) * pitch : (bz.x - midX) * pitch;
      const cz = portrait ? (midX - bz.x) * pitch : (bz.y - midY) * pitch;
      return {
        id: bz.id, gx: bz.x, gy: bz.y, cx, cz, w: S, d: S, h, topY: h,
        kind: fk.kind, effects: fk.effects, highland: high,
        hole: fk.effects.includes("abyss") ? S * CONFIG.holeRatio : 0
      };
    });
    const zoneById = {};
    zones.forEach(z => { zoneById[z.id] = z; });

    // 区之间的间隔：每条连接一个
    const gaps = board.links.map(([a, b]) => {
      const za = zoneById[a], zb = zoneById[b];
      const g = ((state.gaps || {})[gapKeyOf(a, b)]) || {};
      if (!za || !zb) return null;
      const dx = zb.cx - za.cx, dz = zb.cz - za.cz;
      const axis = Math.abs(dx) >= Math.abs(dz) ? "x" : "z";
      return {
        key: gapKeyOf(a, b), a, b, type: g.type || "open", open: g.open !== false,
        hp: num(g.hp, 0), maxHp: num(g.maxHp, 0),
        x: (za.cx + zb.cx) / 2, z: (za.cz + zb.cz) / 2, axis,
        length: Math.max(0.1, (axis === "x" ? Math.abs(dx) : Math.abs(dz)) - S),
        width: S, topY: Math.min(za.topY, zb.topY)
      };
    }).filter(Boolean);

    // 单位：藏起来的、死了的、被移出的不画
    const visible = (state.units || []).filter(u => u && !u.hidden && !u.dead && !u._removed && !u.fused);
    const byZone = {};
    visible.forEach(u => {
      let z = zoneById[Number(u.zone)];
      if (!z) z = u.isPlayer ? zones[0] : zones[zones.length - 1];   // 旧档 / 计算器里留着的、棋盘上没有的区号
      (byZone[z.id] = byZone[z.id] || []).push(u);
    });
    const units = [];
    const U = CONFIG.unit;
    zones.forEach(z => {
      const list = byZone[z.id];
      if (!list) return;
      arrangeUnits(z, list).forEach(slot => {
        const u = slot.unit;
        const flying = !!u.flying && !u.submerged;
        const submerged = !!u.submerged;
        units.push({
          id: u.id, zone: z.id, side: u.isPlayer ? "player" : "foe",
          x: z.cx + slot.x, z: z.cz + slot.z,
          groundY: z.topY, flying, submerged,
          y: z.topY + (flying ? U.flyLift : 0) - (submerged ? U.sink : 0),
          footprint: { w: U.w, d: U.d },
          plateW: U.plateW, plateH: U.plateH,
          plate: plateData(u)
        });
      });
    });

    // 整个战场的范围（镜头取景用）
    const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, maxY: 0 };
    zones.forEach(z => {
      b.minX = Math.min(b.minX, z.cx - z.w / 2); b.maxX = Math.max(b.maxX, z.cx + z.w / 2);
      b.minZ = Math.min(b.minZ, z.cz - z.d / 2); b.maxZ = Math.max(b.maxZ, z.cz + z.d / 2);
      b.maxY = Math.max(b.maxY, z.topY + U.flyLift + U.plateH);
    });
    return { portrait, boardId: board.id, zones, gaps, units, bounds: b };
  }

  return { CONFIG, KIND_ORDER, STATUS_LABELS, build, boardOf, fieldKinds, plateData, arrangeUnits, gapKeyOf };
});
