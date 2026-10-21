/* Antlerscale: Backfire · HD-2D 战场原型 · 布局（纯函数）
 *
 * 只做计算：输入战斗状态（state），输出每个区在 3D 世界里的位置 / 大小、区之间的间隔、每个单位的站位、铭牌上要写的字，
 * 还有默认镜头（取景）和每块铭牌在屏幕上的矩形。
 * 不碰 three.js，也不碰 DOM，所以 Node 里可以直接 require 来测（tests/hd2d-layout.test.js）。
 *
 *   const out = HD2DLayout.build(state, { portrait: false, view: { width, height, top, bottom } });
 *   out.zones   [{ id, cx, cz, w, d, h, topY, kind, effects, hole … }]
 *   out.gaps    [{ key, a, b, type, open, x, z, axis, length, width … }]
 *   out.units   [{ id, zone, x, y, z, flying, submerged, lift, rect, plate … }]
 *   out.bounds  { minX, maxX, minZ, maxZ, maxY }
 *   out.camera  { target, dist, pos, fov, elevation, aspect, width, height }   // 场景照这个摆默认镜头（= 远景；中景 / 近景在 hd2d-camera.js）
 *   out.region / out.ground / out.lamps   // 这场战斗在哪个区域（opts.region）、地面主题（GROUNDS 的键）、灯摆在哪（战场外缘，0–2 盏）
 * state 用联机投影过的（online-view.js · projectState，和联机玩家拿到的一样）；房主的完整 state 也排得出来，结果一样。
 *
 * 坐标：x 向右，y 向上，z 朝镜头（镜头在 +z 一侧看过来）。我方站在 +z（前排），敌方站在 −z（后排）。
 * 铭牌是固定像素大小的 DOM，所以站位按屏幕算：用和场景同一套透视镜头（fitView）把脚下的点投到屏幕上，
 * 同一排相邻两人至少隔开一块铭牌宽；前后排在屏幕上叠到的，后排整排往上抬（lift，像素，铭牌下面拉一根细杆连到脚下），
 * 这样任意两块铭牌的矩形都不重叠。没给 view 时按桌面 1440×900 估（手机竖屏按 390×844）。
 * 坚毅生命（shp）的具体数值是手册规定不给玩家看的：铭牌数据（plateData）里压根不读它。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HD2DLayout = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- 配置（数值都在这里，逻辑里不写死）---------- */
  const CONFIG = {
    zoneSize: 7.2,        // 每个区的地台边长（第二轮从 6.4 放大，给站位留空）
    zoneGap: 2.6,         // 区和区之间的缝（桥 / 墙 / 门 / 空隙摆在这条缝里）
    baseH: 0.8,           // 普通地台的厚度（顶面高度）；加厚了，侧面的砖 / 铁皮 / 岩层才看得出来
    highH: 1.6,           // 高地 / 沙珊瑚台地的顶面高度
    pad: 0.8,             // 地台边缘留给装饰的一圈，单位不站进去
    holeRatio: 0.2,       // 深渊黑洞半径 = 地台边长 × 这个比例
    unit: {
      d: 0.9,             // 站位格子的进深（世界单位）
      rowStep: 1.6,       // 前后两排的间距（地台放不下时压缩，最小 = d）
      stagger: 0.28,      // 同一排里相邻的单位前后错开多少（隔一个往前挪一点；排距放不下时自动缩小）
      groupGap: 0.5,      // 敌我两拨之间多留的空
      minCol: 1.2,        // 同一排相邻两人脚下至少隔多远（世界单位；铭牌宽另外按屏幕算）
      flyLift: 1.25,      // 飞行单位浮起的高度
      sink: 0.55,         // 下潜单位沉下去的深度（铭牌只露半截）
      plateH: 1.7         // 取景时给竖起来的铭牌（含后排抬高）留的高度（世界单位）
    },
    /* 铭牌（DOM）的像素尺寸：hd2d-scene.js 照这个设铭牌的宽高，这里照这个算它在屏幕上的矩形 */
    plate: {
      w: 120, h: 40,                  // 桌面：名字一行 + 血条 / 架势一行（13px 的字，8 个汉字的名字放得下）
      phoneW: 100, phoneH: 36, phoneMax: 720,   // 窗口宽度 ≤ phoneMax 时用手机尺寸
      // 近景放大的铭牌（hd2d-camera.js 的近景）：名字 + 等级、血条 + 血量数字、架势 + ATK、状态文字四行
      big: { w: 200, h: 84, phoneW: 156, phoneH: 74 },
      gapX: 8, gapY: 6,               // 两块铭牌之间至少留的空（像素）
      bob: 2,                         // 待机时上下浮动的幅度（像素）：算矩形时上下各让出这么多
      maxLift: 140,                   // 后排最多抬高多少像素（再高就和脚下的点脱节了）；中景 / 近景另有上限（hd2d-camera.js）
      scaleExp: 0.85, minScale: 0.74, maxScale: 1.15   // 按离镜头远近缩放：(焦距 / 距离)^scaleExp，夹在这个范围里
    },
    /* 默认镜头：场景（hd2d-scene.js）也用这一份 */
    camera: { fov: 22, elevation: 30, margin: 0.97, targetY: 0.6 },
    view: { width: 1440, height: 900, top: 46, bottom: 160 },        // 桌面：顶栏 + 展开的技能栏
    phoneView: { width: 390, height: 844, top: 42, bottom: 56 },     // 手机竖屏：面板默认收起
    maxDefPips: 12,       // 架势菱形最多画几个（训练木桩之类的巨大架势不画满）
    groundY: -0.32,       // 地台外面那一大片地的高度（hd2d-backdrop.js 的地面；灯立在上面）
    /* 灯（路灯 / 矿灯）：整场最多 max 盏，不放在地台上，放在最后面那排地台的后角再往外 out、往后 back（世界单位）；
     * h = 各种灯的灯头离地多高（hd2d-world.js 照这个立灯杆）。每张地图放几盏、放什么在下面 GROUNDS 的 lamps */
    lamps: { max: 2, out: 0.9, back: 1.1, h: { street: 2.6, hanging: 2.0 } }
  };

  /** 地台样子的优先级：靠前的盖过靠后的 */
  const KIND_ORDER = ["abyss", "acid", "quicksand", "coral", "highland", "fire", "ice", "electric", "energy", "harmonic", "heal"];

  /* ---------- 地面主题：这场战斗在哪个区域 → 默认地台长什么样、地台外面的地、远景、灯 ----------
   * 只管「没有场地效果的地台」（只是垫高的高地也算）。酸液、电、冰、流沙、珊瑚、深渊……有场地效果的照旧用自己的样子
   * （hd2d-world.js 的 TOP_STYLE），不看区域。认不得的区域（或者没给）用 concrete：就是以前的水泥砖 + 油渍，远景照旧按光影主题挑。
   * 每一套：
   *   tex / tint / rough / metal   顶面贴图（hd2d-world.js 的 TEX 里画）、乘上去的颜色、粗糙度、金属感（不写用默认）
   *   side / sideTint   侧面：brick 砖墙、sheet 瓦楞铁皮、strata 岩层、steel 铆钢板、panelSide 金属面板
   *   glow              会发光的那一点的颜色（天网设施：顶面和侧面的接缝；采矿场：矿渣里的余火、晶矿）；不写 = 不发光
   *   decals            贴花各几块：oil 油渍、crack 裂缝、gravel 碎石、ripple 沙纹、patch 沥青补丁、slag 矿渣、ember 带余火的矿渣、
   *                     crystal 晶矿、grate 格栅、puddle 积水
   *   pebbles / pebble / rock   零散小石子几颗（不写用 hd2d-world.js 的 WORLD.pebbles）和颜色；地台边上石块的颜色
   *   decor             地台边上的装饰：scrap 废铁堆 + 管道、sand 沙地（不放废铁、石块大一点）、clean 干净（不放废铁、石块）；crystals 晶簇几丛
   *   ground            地台外面那一大片地的颜色（白天的；傍晚 / 夜晚场景按光影主题压暗）；null = 照旧用光影主题的颜色
   *   backdrop          远景：city 楼群（skyline = 楼的高度倍数）、desert 沙丘 / 桌山、mine 岩壁 + 矿井架 / 烟囱、skynet 沙丘里的天网塔
   *   lamps             灯：kind（street 路灯 / hanging 矿灯、吊灯）、color，白天 / 傍晚 / 夜晚各几盏；不写 = 一盏都不放 */
  const GROUNDS = {
    concrete: {   // 兜底（以前的样子）
      tex: "concrete", tint: 0xffffff, side: "brick", decals: { oil: 3, crack: 3, gravel: 4 }, decor: "scrap", ground: null, backdrop: null,
      lamps: { kind: "street", color: 0xffd9a0, day: 1, dusk: 1, night: 2 }
    },
    outer: {      // 外城区：开裂的沥青 / 水泥、补丁、褪色的标线，侧面瓦楞铁皮
      tex: "asphalt", tint: 0xffffff, side: "sheet", sideTint: 0xe0d6cc, decals: { crack: 4, patch: 2, oil: 2, gravel: 2 },
      pebble: 0x7c766e, rock: 0x6f6a63, decor: "scrap", ground: 0x58524b, backdrop: "city", skyline: 0.7,
      lamps: { kind: "street", color: 0xffc98a, day: 1, dusk: 2, night: 2 }
    },
    desert: {     // 沙漠：沙地 + 风吹出来的沙纹，侧面岩层；不放灯
      tex: "dune", tint: 0xffffff, side: "strata", sideTint: 0xf0cf98, decals: { ripple: 4, gravel: 2 },
      pebbles: 16, pebble: 0xb8996a, rock: 0xb89a68, decor: "sand", ground: 0xa58357, backdrop: "desert"
    },
    mine1: {      // 第一采矿场（露天矿坑）：碎石 + 矿渣、车辙，侧面岩层；一盏矿灯
      tex: "gravel", tint: 0xffffff, side: "strata", sideTint: 0xc8b6a0, decals: { slag: 3, gravel: 3, crack: 2 },
      pebble: 0x857565, rock: 0x6f6152, decor: "scrap", ground: 0x655446, backdrop: "mine",
      lamps: { kind: "hanging", color: 0xffc46e, day: 1, dusk: 1, night: 1 }
    },
    mine2: {      // 第二采矿场（熔岩）：偏暗偏红的碎石，矿渣里带一点余火
      tex: "gravel", tint: 0xd8c0b0, side: "strata", sideTint: 0xa88a7c, glow: 0xff5a1e, decals: { ember: 2, slag: 2, gravel: 3 },
      pebble: 0x6c584e, rock: 0x584640, decor: "scrap", ground: 0x4d3c35, backdrop: "mine",
      lamps: { kind: "hanging", color: 0xffb060, day: 1, dusk: 1, night: 1 }
    },
    mine3: {      // 第三采矿场（晶矿）：偏冷的碎石，零星几块发冷光的能量矿
      tex: "gravel", tint: 0xc6c8d8, side: "strata", sideTint: 0xaaa8c0, glow: 0x8f7dff, decals: { crystal: 3, slag: 1, gravel: 3 }, crystals: 2,
      pebble: 0x787888, rock: 0x625f70, decor: "scrap", ground: 0x4c4a57, backdrop: "mine",
      lamps: { kind: "hanging", color: 0xc8d6ff, day: 1, dusk: 1, night: 1 }
    },
    giant: {      // 巨人城：花纹钢板地面、格栅，侧面铆钢板
      tex: "plate", tint: 0xffffff, rough: 0.55, metal: 0.3, side: "steel", decals: { grate: 2, oil: 2 },
      pebble: 0x606268, rock: 0x5a6068, decor: "scrap", ground: 0x45484e, backdrop: "city", skyline: 1.25,
      lamps: { kind: "street", color: 0xffe2b8, day: 1, dusk: 2, night: 2 }
    },
    skynet: {     // 天网设施：干净的金属面板 + 发光的接缝，地台外面是沙漠
      tex: "panel", tint: 0xffffff, rough: 0.38, metal: 0.4, side: "panelSide", glow: 0x4fd8ff, decals: {},
      pebbles: 0, decor: "clean", ground: 0x9a845e, backdrop: "skynet",
      lamps: { kind: "street", color: 0xd6f4ff, day: 1, dusk: 2, night: 2 }
    },
    sewer: {      // 下水道：湿水泥、积水反光，侧面泛潮的砖墙；吊灯
      tex: "wet", tint: 0xffffff, rough: 0.42, side: "brick", sideTint: 0x93a091, decals: { puddle: 4, crack: 2, gravel: 1 },
      pebble: 0x5d635b, rock: 0x565a50, decor: "scrap", ground: 0x343b36, backdrop: "city", skyline: 0.85,
      lamps: { kind: "hanging", color: 0xe2eea0, day: 1, dusk: 1, night: 2 }
    }
  };
  const GROUND_DEFAULT = "concrete";
  /** 区域名 → 地面主题。区域名用游戏里现成的：rogue-data.js 的 regions（单局各幕）/ altRegions（幕间改走的采矿场），也是遭遇的 region。
   *  正式的区域名列表在 world-data.js 的 BATTLE_REGIONS（战斗状态的 state.region、联机白名单只认它）：这里的区域名、下面的别名
   *  和它一一对上，加区域两边一起加（tests/region-light.test.js 核对） */
  const REGIONS = {
    "外城区": "outer", "沙漠": "desert", "巨人城": "giant", "天网设施": "skynet",
    "第一采矿场": "mine1", "第二采矿场": "mine2", "第三采矿场": "mine3",
    "下水道": "sewer"     // 游戏里还没有这张图（ROADMAP 里的「下水道」），先放在这里，名字定了再对上
  };
  /** 同一个地方的别名 → 区域名：world-data.js 的地图地点 id（跑团 LEDGER.place、联机跑团 view.map.place 发的是它）、天网塔 */
  const REGION_ALIAS = {
    "天网塔": "天网设施", outer_city: "外城区", desert: "沙漠", giant_city: "巨人城", skynet: "天网设施",
    mine_1: "第一采矿场", mine_2: "第二采矿场", mine_3: "第三采矿场"
  };

  /** 状态徽章：statuses 里的键 → 铭牌上的字（敌我通用）。数值型的（灼烧层数）带上层数 */
  const STATUS_LABELS = {
    burn: "灼烧", shock: "感电", corr: "腐蚀", frostbite: "冻伤", shockwave: "震荡", high: "高能", reso: "共振",
    unstable: "不稳", weak: "虚弱", inspire: "鼓舞", sturdy: "坚毅", hide: "隐匿", advantage: "优势", chase: "追击"
  };

  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const D2R = Math.PI / 180;

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

  /* ---------- 地面主题 / 灯 ---------- */
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  /** 游戏里的区域名、地图地点 id → 区域名（认不得的返回 null） */
  function regionName(x) {
    if (typeof x !== "string") return null;
    const s = x.trim();
    return own(REGIONS, s) ? s : own(REGION_ALIAS, s) ? REGION_ALIAS[s] : null;
  }
  /** 区域 → 地面主题（GROUNDS 的键）；认不得的用兜底 GROUND_DEFAULT */
  function groundOf(x) {
    const name = regionName(x);
    return name ? REGIONS[name] : GROUND_DEFAULT;
  }
  /** 这场战斗放几盏灯、什么灯：看地面主题和光影主题（day / dusk / night），不超过 CONFIG.lamps.max */
  function lampPlan(ground, theme) {
    const p = (GROUNDS[ground] || GROUNDS[GROUND_DEFAULT]).lamps;
    if (!p) return { kind: null, color: null, count: 0 };
    return { kind: p.kind, color: p.color, count: clamp(Math.round(num(p[theme], num(p.day, 0))), 0, CONFIG.lamps.max) };
  }
  /** 灯摆在哪：最后面那排地台的两个后角再往外、往后一点（在战场外缘的地上，不在地台上，也不在两块地台之间的缝里）。
   *  一盏放右后角（主光从左上方来，右边补一点光），两盏左右各一；dir = 灯臂往哪边伸（朝战场里面） */
  function lampSpots(zones, plan) {
    if (!plan.count || !zones.length) return [];
    const C = CONFIG.lamps;
    const back = Math.min(...zones.map(z => z.cz - z.d / 2));
    const row = zones.filter(z => z.cz - z.d / 2 < back + 1e-6);
    const left = row.reduce((a, z) => (z.cx - z.w / 2 < a.cx - a.w / 2 ? z : a));
    const right = row.reduce((a, z) => (z.cx + z.w / 2 > a.cx + a.w / 2 ? z : a));
    const spots = [{ x: right.cx + right.w / 2 + C.out, dir: -1 }, { x: left.cx - left.w / 2 - C.out, dir: 1 }];
    return spots.slice(0, plan.count).map((s, i) => ({ x: s.x, z: back - C.back, dir: s.dir, kind: plan.kind, color: plan.color, seed: i }));
  }

  /* ---------- 铭牌数据 ---------- */
  /** 铭牌上要写的内容。只读白名单里的字段——坚毅生命（shp）不在其中。
   *  原型页交进来的是联机投影过的状态（online-view.js · projectState），和联机玩家拿到的一样；
   *  ATK 用主机算好的实际 ATK（投影里的 display.atk，联机单位卡也是这个数：online-battle.js · snapUnit），没有就用 atk */
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
    const shownAtk = u.display && typeof u.display.atk === "number" && Number.isFinite(u.display.atk) ? u.display.atk : num(u.atk, 0);
    const plate = {
      id: u.id, name: String(u.name || "?"), level: num(u.level, 1), atk: shownAtk,
      side: u.isPlayer ? "player" : "foe",
      hp: { cur, max }, layers,
      def: { cur: Math.min(def, shown), max: shown, big: Math.max(defMax, def) > CONFIG.maxDefPips },
      statuses, flags
    };
    plate.text = [plate.name, "Lv" + plate.level, "ATK " + plate.atk, cur + "/" + max]
      .concat(statuses.map(s => s.label), flags.map(f => f.label));
    return plate;
  }

  /* ---------- 镜头（和 hd2d-scene.js 用同一套：透视、俯角 elevation、正对 −z 方向）---------- */
  /** 镜头摆在 target 后上方 dist 远处，朝 target 看。lens = { elevation, fov }（度）不给就用默认镜头的（CONFIG.camera）；
   *  中景 / 近景（hd2d-camera.js）用自己的俯角和视野 */
  function camAt(target, dist, aspect, lens) {
    const C = CONFIG.camera;
    const elevation = lens && Number.isFinite(lens.elevation) ? lens.elevation : C.elevation, fov = lens && Number.isFinite(lens.fov) ? lens.fov : C.fov;
    const e = elevation * D2R, se = Math.sin(e), ce = Math.cos(e);
    return {
      target: { x: target.x, y: target.y, z: target.z }, dist,
      pos: { x: target.x, y: target.y + se * dist, z: target.z + ce * dist },
      right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: ce, z: -se }, back: { x: 0, y: se, z: ce },
      fov, elevation, aspect, tanHalf: Math.tan(fov * D2R / 2)
    };
  }
  /** 世界坐标 → NDC（−1…1，y 向上）；depth 是沿视线到镜头的距离 */
  function toNdc(cam, p) {
    const vx = p.x - cam.pos.x, vy = p.y - cam.pos.y, vz = p.z - cam.pos.z;
    const xv = vx * cam.right.x + vy * cam.right.y + vz * cam.right.z;
    const yv = vx * cam.up.x + vy * cam.up.y + vz * cam.up.z;
    const depth = -(vx * cam.back.x + vy * cam.back.y + vz * cam.back.z);
    return { x: xv / (depth * cam.tanHalf * cam.aspect), y: yv / (depth * cam.tanHalf), depth };
  }
  /** 世界坐标 → 屏幕像素（左上角为原点，y 向下） */
  function project(cam, p) {
    const n = toNdc(cam, p);
    return { x: (n.x + 1) / 2 * cam.width, y: (1 - n.y) / 2 * cam.height, depth: n.depth };
  }
  /** 铭牌按离镜头远近的缩放（场景每帧用同一个公式） */
  function plateScale(cam, p) {
    const P = CONFIG.plate;
    const d = Math.hypot(p.x - cam.pos.x, p.y - cam.pos.y, p.z - cam.pos.z);
    return clamp(Math.pow(cam.dist / Math.max(1e-6, d), P.scaleExp), P.minScale, P.maxScale);
  }
  function viewOf(opts) {
    const base = opts.portrait ? CONFIG.phoneView : CONFIG.view, v = opts.view || {};
    return {
      width: Math.max(1, num(v.width, base.width)), height: Math.max(1, num(v.height, base.height)),
      top: Math.max(0, num(v.top, base.top)), bottom: Math.max(0, num(v.bottom, base.bottom))
    };
  }
  /** 取景：让整个战场刚好装进「上下被界面盖住之后剩下的那一块」（迭代：先居中，再按超出 / 留空的比例推拉） */
  function fitView(bounds, view) {
    const C = CONFIG.camera;
    const W = Math.max(1, view.width), H = Math.max(1, view.height), aspect = W / H;
    const lo = -1 + 2 * (view.bottom || 0) / H, hi = 1 - 2 * (view.top || 0) / H;
    const b = bounds, top = b.maxY + 0.5, pts = [];
    [b.minX, b.maxX].forEach(x => [0, top].forEach(y => [b.minZ, b.maxZ].forEach(z => pts.push({ x, y, z }))));
    const t = { x: (b.minX + b.maxX) / 2, y: C.targetY, z: (b.minZ + b.maxZ) / 2 };
    let dist = 40, cam = null;
    for (let it = 0; it < 14; it++) {
      cam = camAt(t, dist, aspect);
      let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      pts.forEach(p => { const n = toNdc(cam, p); x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); });
      const dy = (lo + hi) / 2 - (y0 + y1) / 2, dx = -(x0 + x1) / 2;
      const half = cam.tanHalf * dist, mu = -dy * half, mr = -dx * half * aspect;
      t.x += cam.up.x * mu + cam.right.x * mr; t.y += cam.up.y * mu + cam.right.y * mr; t.z += cam.up.z * mu + cam.right.z * mr;
      const k = Math.max((x1 - x0) / (2 * C.margin), (y1 - y0) / ((hi - lo) * C.margin));
      dist *= Math.min(1.6, Math.max(0.6, k));
    }
    cam = camAt(t, dist, aspect);
    cam.width = W; cam.height = H; cam.view = { top: view.top || 0, bottom: view.bottom || 0 };
    return cam;
  }
  /** 默认镜头的画面上沿那条视线，在进深 z 处离地多高：远景剪影不超过这个高度，整个轮廓就都在画面里（hd2d-backdrop.js 用） */
  function frameTop(cam, z) {
    return cam.pos.y - (cam.pos.z - z) * Math.tan((cam.elevation - cam.fov / 2) * D2R);
  }
  /** 铭牌的像素尺寸（桌面 / 手机）；big = 近景放大的那种 */
  function plateSize(view, big) {
    const P = CONFIG.plate, S = big ? P.big : P;
    return view.width <= P.phoneMax ? { w: S.phoneW, h: S.phoneH } : { w: S.w, h: S.h };
  }
  /** 一块铭牌在屏幕上的矩形（像素，y 向下）：底边中点在脚下的点往上 lift 像素，大小按远近缩放，上下各让出浮动的幅度 */
  function plateRect(cam, size, anchor, lift) {
    const s = project(cam, anchor), k = plateScale(cam, anchor), bob = CONFIG.plate.bob;
    const w = size.w * k, h = size.h * k;
    return { cx: s.x, foot: s.y, scale: k, x0: s.x - w / 2, x1: s.x + w / 2, y0: s.y - lift - h - bob, y1: s.y - lift + bob };
  }

  /* ---------- 站位 ---------- */
  /** 一个区里一排最多站几个人，以及相邻两人的间距（世界单位）。
   *  铭牌按 (焦距 / 距离)^0.85 缩放，比地面缩得慢，所以越远越挤：前沿、后沿都量一遍，取挤的那边 */
  function columnsOf(zone, cam, size) {
    const P = CONFIG.plate, U = CONFIG.unit;
    const usableW = zone.w - 2 * CONFIG.pad;
    if (!cam) return { per: Math.max(1, Math.floor(usableW / U.minCol + 1e-9) + 1), step: U.minCol };
    let step = U.minCol, plateW = 0, overhang = Infinity;
    [1, -1].forEach(edge => {
      const z = zone.cz + edge * (zone.d / 2 - CONFIG.pad), y = zone.topY;
      const a = project(cam, { x: zone.cx - 0.5, y, z }), b = project(cam, { x: zone.cx + 0.5, y, z });
      const ppu = Math.max(1e-6, Math.abs(b.x - a.x));                     // 这里 1 个世界单位横向多少像素
      const w = size.w * plateScale(cam, { x: zone.cx, y, z }) / ppu;         // 铭牌宽（世界单位）
      plateW = Math.max(plateW, w);
      step = Math.max(step, w + P.gapX / ppu);
      overhang = Math.min(overhang, Math.max(0, CONFIG.zoneGap / 2 - P.gapX / ppu));   // 铭牌最多伸出地台边缘多少（不压到隔壁区的铭牌）
    });
    let per = 1;
    while (per * step <= usableW + 1e-9 && per * step / 2 + plateW / 2 <= zone.w / 2 + overhang + 1e-9) per++;
    return { per, step };
  }

  /** 一个区里所有单位的站位（局部坐标，相对区中心）。敌方在后排（−z），我方在前排（+z）。
   *  cam / size 给了就按屏幕上的铭牌宽排列数；没给就按 minCol 的间距排（只看脚下不重叠） */
  function arrangeUnits(zone, list, cam, size) {
    const U = CONFIG.unit;
    const usableD = zone.d - 2 * CONFIG.pad;
    const cols = columnsOf(zone, cam, size || plateSize(CONFIG.view));
    const foes = list.filter(u => !u.isPlayer), mine = list.filter(u => u.isPlayer);
    const rowsOf = (g) => {
      const rows = [];
      if (!g.length) return rows;
      const n = Math.ceil(g.length / cols.per), per = Math.ceil(g.length / n);   // 排得匀一点：4 人分 2+2，不分 3+1
      for (let i = 0; i < g.length; i += per) rows.push(g.slice(i, i + per));
      return rows;
    };
    const fr = rowsOf(foes), mr = rowsOf(mine);
    const total = fr.length + mr.length;
    const both = fr.length && mr.length;
    const extra = both ? U.groupGap : 0;
    const step = total > 1 ? Math.max(U.d, Math.min(U.rowStep, (usableD - extra) / (total - 1))) : 0;
    const out = [];
    // 前后错开：隔一个往前（+z）挪一点，铭牌不排成一条线；排距小的时候少挪，保证不压到前后排。深渊区不挪（要贴着洞沿）
    const stag = zone.hole > 0 ? 0 : (total > 1 ? Math.min(U.stagger, Math.max(0, (step - U.d) / 2)) : U.stagger);
    const put = (rows, zOf, tag) => rows.forEach((row, r) => row.forEach((u, i) => {
      out.push({ unit: u, x: (i - (row.length - 1) / 2) * cols.step, z: zOf(r) + (i % 2 ? stag : -stag), row: tag + r, col: i, colStep: cols.step });
    }));
    if (zone.hole > 0) {
      // 深渊：黑洞在地台中间，地面单位站在洞的两侧边沿上，敌方在后、我方在前
      const rim = zone.hole + U.d / 2 + 0.35;
      put(fr, r => -rim - r * step, "f");
      put(mr, r => rim + r * step, "m");
    } else {
      // 其余：两拨一起居中。后排是敌方（第 0 排最靠后），紧接着是我方
      const top = -((total - 1) * step + extra) / 2;
      put(fr, r => top + r * step, "f");
      put(mr, r => top + (fr.length + r) * step + extra, "m");
    }
    return out;
  }

  /**
   * 后排抬高：从屏幕上最靠下（离镜头最近）的一排开始放，后面每一排如果和已经放好的铭牌在屏幕上叠到，
   * 就整排往上抬，直到让开 gapY（最多抬 maxLift）。不改传进来的单位，返回 Map（单位 id → { lift 像素, rect 屏幕矩形 }）。
   * sizeOf(u) = 这个单位的铭牌像素尺寸（近景里选中那个区的铭牌是放大的）；默认镜头和中景 / 近景（hd2d-camera.js）都用这一个
   */
  function liftPlates(units, cam, sizeOf, maxLift) {
    const P = CONFIG.plate, cap = Number.isFinite(maxLift) ? maxLift : P.maxLift;
    const rows = new Map();
    units.forEach(u => {
      const key = u.zone + ":" + u.row;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(u);
    });
    const anchor = (u) => ({ x: u.x, y: u.y, z: u.z });
    const list = [...rows.values()].map(items => ({ items, foot: items.reduce((a, u) => a + project(cam, anchor(u)).y, 0) / items.length }));
    list.sort((a, b) => b.foot - a.foot);
    const placed = [], out = new Map();
    const hits = (r, p) => r.x0 < p.x1 && p.x0 < r.x1 && r.y0 < p.y1 + P.gapY && p.y0 < r.y1 + P.gapY;
    list.forEach(row => {
      let lift = 0;
      for (let guard = 0; guard < 40; guard++) {
        let need = 0;
        row.items.forEach(u => {
          const r = plateRect(cam, sizeOf(u), anchor(u), lift);
          placed.forEach(p => { if (hits(r, p)) need = Math.max(need, r.y1 - (p.y0 - P.gapY)); });
        });
        if (need <= 0.01) break;
        lift = Math.min(cap, lift + need);
        if (lift >= cap) break;
      }
      row.items.forEach(u => {
        const l = Math.round(lift * 10) / 10, rect = plateRect(cam, sizeOf(u), anchor(u), l);
        out.set(u.id, { lift: l, rect });
        placed.push(rect);
      });
    });
    return out;
  }
  /** 默认镜头下的后排抬高：每个单位写上 lift 和 rect */
  function liftRows(units, cam, size) {
    const out = liftPlates(units, cam, () => size);
    units.forEach(u => { const r = out.get(u.id); u.lift = r.lift; u.rect = r.rect; });
  }

  /* ---------- 总入口 ---------- */
  /**
   * 排出整个战场。
   *   opts.portrait  竖屏（手机）：整块棋盘转 90°，直排沿进深（前后）排开，我方在最前面
   *   opts.view      { width, height, top, bottom }：画面大小和上下被界面盖住的像素（场景传真实的；不给按桌面 / 手机的默认值）
   *   opts.region    这场战斗在哪个区域（游戏里的区域名或地图地点 id）：没有场地效果的地台按它换地面（zone.ground），灯按它摆；认不得 / 不给 = 以前的样子
   *   opts.theme     光影主题 day / dusk / night（灯的盏数看白天还是夜晚；不给按白天）
   */
  function build(state, opts) {
    opts = opts || {};
    const portrait = !!opts.portrait;
    const board = boardOf(state);
    const S = CONFIG.zoneSize, pitch = S + CONFIG.zoneGap;
    const xs = board.zones.map(z => z.x), ys = board.zones.map(z => z.y);
    const midX = (Math.min(...xs) + Math.max(...xs)) / 2, midY = (Math.min(...ys) + Math.max(...ys)) / 2;
    const region = regionName(opts.region), ground = groundOf(opts.region);

    const zones = board.zones.map(bz => {
      const fk = fieldKinds((state.fields || {})[bz.id]);
      const high = fk.effects.includes("highland") || fk.effects.includes("coral");
      const h = high ? CONFIG.highH : CONFIG.baseH;
      const cx = portrait ? (bz.y - midY) * pitch : (bz.x - midX) * pitch;
      const cz = portrait ? (midX - bz.x) * pitch : (bz.y - midY) * pitch;
      return {
        id: bz.id, gx: bz.x, gy: bz.y, cx, cz, w: S, d: S, h, topY: h,
        kind: fk.kind, effects: fk.effects, highland: high,
        hole: fk.effects.includes("abyss") ? S * CONFIG.holeRatio : 0,
        // 地面主题：只给没有场地效果的地台（只是垫高的高地也算）；兜底时不给，照旧画以前的样子
        ground: ground !== GROUND_DEFAULT && fk.effects.every(e => e === "highland") ? ground : null
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

    // 整个战场的范围（取景用）：只看地台，和单位站在哪无关，镜头才不会跟着站位来回变
    const U = CONFIG.unit;
    const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, maxY: 0 };
    zones.forEach(z => {
      b.minX = Math.min(b.minX, z.cx - z.w / 2); b.maxX = Math.max(b.maxX, z.cx + z.w / 2);
      b.minZ = Math.min(b.minZ, z.cz - z.d / 2); b.maxZ = Math.max(b.maxZ, z.cz + z.d / 2);
      b.maxY = Math.max(b.maxY, z.topY + U.flyLift + U.plateH);
    });
    const view = viewOf(opts);
    const camera = fitView(b, view);
    const size = plateSize(view);

    // 单位：藏起来的、死了的、被移出的不画
    const visible = (state.units || []).filter(u => u && !u.hidden && !u.dead && !u._removed && !u.fused);
    const byZone = {};
    visible.forEach(u => {
      let z = zoneById[Number(u.zone)];
      if (!z) z = u.isPlayer ? zones[0] : zones[zones.length - 1];   // 旧档 / 计算器里留着的、棋盘上没有的区号
      (byZone[z.id] = byZone[z.id] || []).push(u);
    });
    const units = [];
    zones.forEach(z => {
      const list = byZone[z.id];
      if (!list) return;
      arrangeUnits(z, list, camera, size).forEach(slot => {
        const u = slot.unit;
        const flying = !!u.flying && !u.submerged;
        const submerged = !!u.submerged;
        units.push({
          id: u.id, zone: z.id, side: u.isPlayer ? "player" : "foe",
          x: z.cx + slot.x, z: z.cz + slot.z,
          groundY: z.topY, flying, submerged,
          y: z.topY + (flying ? U.flyLift : 0) - (submerged ? U.sink : 0),
          row: slot.row, col: slot.col,
          footprint: { w: slot.colStep, d: U.d },
          lift: 0, rect: null,             // liftRows 填：后排抬高的像素、铭牌在屏幕上的矩形
          plate: plateData(u)
        });
      });
    });
    liftRows(units, camera, size);
    const lamps = lampSpots(zones, lampPlan(ground, opts.theme || "day"));
    return { portrait, boardId: board.id, zones, gaps, units, bounds: b, camera, view, plateSize: size, region, ground, lamps };
  }

  return {
    CONFIG, KIND_ORDER, STATUS_LABELS, GROUNDS, GROUND_DEFAULT, REGIONS, REGION_ALIAS, build, boardOf, fieldKinds, plateData, arrangeUnits, gapKeyOf,
    fitView, camAt, toNdc, project, plateScale, plateRect, plateSize, liftPlates, frameTop, regionName, groundOf, lampPlan
  };
});
