/* Antlerscale: Backfire · HD-2D 战场原型 · 区域场景的美术：登记处（#242）
 *
 * 区域下面的场景（#239 的 pv.scene：采矿场的矿外 / 矿内 / 矿底、沙漠的沙丘 / 沙珊瑚台地……）各有一套美术，
 * 放在各自的「美术包」里（hd2d-scenes-mine.js、hd2d-scenes-desert.js）；这里只管登记、转交，再给美术包几个共用的小工具。
 *
 *   HD2DSceneArt.add(pack)   美术包加载时登记：pack.grounds（地面主题）并进布局的 GROUNDS，pack.scenes（区域 → 场景 id → 地面主题的键）
 *                            并进布局的 SCENES（只认正式场景表里已经有的区域、场景 id，不另加）。布局（hd2d-layout.js）一行不用改：
 *                            groundOf(区域, 场景) 查到的就是这个场景自己的地面主题，build 出来的 out.ground / zone.ground 也是它
 *   of(地面主题的键)          这一套是哪个美术包、哪个区域的哪个场景：{ pack, key, region, scene, art（美术包里这一套的配置）}；不是 = null
 *
 * 共用文件里的挂钩（各一两行；没登记的地面主题照旧）：
 *   hd2d-world.js     texture(名字, kit)（顶面 / 侧面 / 贴花的贴图）、decal(名字)（贴花）、zone(kit, g, 区, ctx, r, look)
 *                     （地台上的装饰和环境动画；接管了就不画以前的废铁 / 管道 / 石块）
 *   hd2d-backdrop.js  band(kit, kind, colors, seed)（天边画的远景）、backdrop(kit, kind, env)（中景、矿坑、战场周围的装饰、环境动画；
 *                     返回 { groundEdge }：地台外面那片地到哪为止，后面是坑）、skyGap(kind, bounds, cam)（天幕挪到多远：矿坑在天幕前面）
 *   hd2d-scene.js     lighting(THEMES, 光影主题, 地面主题)（场景自己的光照 / 调色：矿内、矿底压暗；矿底不分白天黑夜，返回固定的一套）
 * 美术包不 import three.js：three.js 和画贴图 / 拼几何体的小工具由挂钩那边打包成 kit 传进来，所以 Node 里可以直接 require 来测配置和摆放
 * （tests/hd2d-scenes.test.js）。画的都是几何体 + canvas 程序贴图，没有图片文件；只读布局给的地台 / 战场范围，不碰单位数据（没有坚毅生命）。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./hd2d-layout.js"));
  else root.HD2DSceneArt = factory(root.HD2DLayout);
})(typeof self !== "undefined" ? self : this, function (L) {
  "use strict";

  /* ---------- 配置 ----------
   * 地台上能摆装饰的地方（「装饰不压住站位 / 铭牌」）：布局排人时，脚下的点横着最多到站位区的边（地台边长的一半 − pad，一排两头的人站在那里），
   * 前后挤的时候也会站到前后边带上。所以地台上的装饰只摆在左右两条边带上：横着离区中心至少 站位区半宽 + foot（脚下那一圈接触阴影）+ 装饰的半径；
   * 再加左右两边矮一截的台子顶上（台子在外轮廓外面）。
   *   foot   让开脚下多远（接触阴影的核心半径 0.42，hd2d-scene.js 的 SHADOW.core）
   *   clear  离外轮廓的边至少多远（不悬在缺口上）；step 沿着边带每隔多远试一个点 */
  const SPOT = { foot: 0.45, clear: 0.06, step: 0.2 };

  const packs = [], byKey = {};
  const own = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- 登记 / 查找 ---------- */
  /** 美术包加载时登记（同一个包登记两次也只算一次） */
  function add(pack) {
    if (!pack || packs.includes(pack)) return pack;
    packs.push(pack);
    Object.keys(pack.scenes || {}).forEach(region => {
      const list = pack.scenes[region] || {};
      Object.keys(list).forEach(scene => {
        const key = list[scene], look = pack.grounds && pack.grounds[key];
        if (!look || !own(L.SCENES, region) || !own(L.SCENES[region], scene)) return;   // 区域、场景 id 以正式的场景表为准，美术包不另加
        L.GROUNDS[key] = look;
        L.SCENES[region][scene] = key;
        byKey[key] = { pack, key, region, scene, art: (pack.art && pack.art[key]) || {} };
      });
    });
    return pack;
  }
  const of = (key) => (typeof key === "string" && own(byKey, key) ? byKey[key] : null);
  /** 登记过的所有场景：[{ region, scene, key, pack }]（测试、调试用） */
  const list = () => Object.keys(byKey).map(k => byKey[k]);

  /* ---------- 挂钩 ---------- */
  /** 贴图：美术包画的（名字在包的 textures 里）；返回一个函数，调用时才画（canvas 贴图由 kit.canvasTex 缓存） */
  function texture(name, kit) {
    const p = packs.find(q => own(q.textures, name));
    return p ? () => p.textures[name](kit) : null;
  }
  /** 贴花：美术包里的（和 hd2d-world.js 的 DECALS 同一种写法） */
  function decal(name) {
    const p = packs.find(q => own(q.decals, name));
    return p ? p.decals[name] : null;
  }
  /** 地台上的装饰、环境动画：这块地台的地面主题是登记过的场景，就交给它的美术包画（返回 true = 接管了，不再画以前的废铁 / 管道 / 石块） */
  function zone(kit, g, z, ctx, r, look) {
    const a = of(z && z.ground);
    if (!a || typeof a.pack.zone !== "function") return false;
    a.pack.zone(kit, g, z, ctx, r, look, a);
    return true;
  }
  /** 天边画的远景（一条 canvas 贴图）：美术包没给就用以前的 */
  function band(kit, kind, colors, seed) {
    const a = of(kind);
    return a && typeof a.pack.band === "function" ? a.pack.band(kit, colors, seed, a) || null : null;
  }
  /** 中景、矿坑、战场周围的装饰、环境动画：返回 { groundEdge }（没接管 = null） */
  function backdrop(kit, kind, env) {
    const a = of(kind);
    if (!a || typeof a.pack.backdrop !== "function") return null;
    return a.pack.backdrop(kit, env, a) || {};
  }
  /** 天幕离战场后沿多远：矿坑往后很深（对面坑壁在一二十个单位外），天幕要挪到坑后面，不然把坑挡住。美术包没给 = null（用以前的） */
  function skyGap(kind, bounds, cam) {
    const a = of(kind), v = a && typeof a.pack.skyGap === "function" ? a.pack.skyGap(bounds, cam, a) : null;
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  /* ---------- 光照 / 调色 ----------
   * 美术包里每一套的 light：
   *   fixed   不分白天黑夜（矿底）：按这个光影主题的名字画（world 的亮边、远景剪影的颜色、飘浮物都按它），光照不看现在是几点
   *   all     各光影主题都要的改动；day / dusk / night 只在那个光影主题时再叠一层
   * 改动的写法：scale { 键: 倍数 }（hemi / sunI / rimI / exposure / lamp……）、tint { 键: [颜色, 比例] }（往这个颜色靠：fog / ground / hemiSky /
   *   hemiGround / sun / rim / sky（四个颜色都靠））、set { 键: 值 }（直接换）、grade { 调色的键: 值 }（直接换）*/
  function lighting(themes, name, key) {
    const a = of(key), spec = a && a.art && a.art.light;
    if (!spec || !themes) return null;
    const as = spec.fixed ? spec.fixed : own(themes, name) ? name : "day";
    const T = applyLight(themes[as] || themes.day, [spec.all, spec[as]]);
    // 不分白天黑夜的：地台外大片地面就是地面主题自己的颜色（场景按「这个主题 / 白天」的比例压暗，比例取 1）
    if (spec.fixed && !(spec.all && spec.all.set && own(spec.all.set, "ground"))) T.ground = (themes.day || T).ground;
    return { name: as, T, fixed: !!spec.fixed };
  }
  /** 主题 base 照 ops（一串改动）改一份（不改 base） */
  function applyLight(base, ops) {
    const T = clone(base);
    (ops || []).filter(Boolean).forEach(op => {
      Object.keys(op.scale || {}).forEach(k => { if (typeof T[k] === "number") T[k] *= op.scale[k]; });
      Object.keys(op.tint || {}).forEach(k => {
        const [c, f] = op.tint[k];
        if (k === "sky" && Array.isArray(T.sky)) T.sky = T.sky.map(s => mixCss(s, c, f));
        else if (T[k] != null) T[k] = mixHex(T[k], c, f);
      });
      Object.keys(op.set || {}).forEach(k => { T[k] = clone(op.set[k]); });
      if (op.grade) T.grade = Object.assign({}, T.grade, clone(op.grade));
    });
    return T;
  }
  const clone = (v) => (Array.isArray(v) ? v.map(clone) : v && typeof v === "object" ? Object.keys(v).reduce((o, k) => { o[k] = clone(v[k]); return o; }, {}) : v);

  /* ---------- 颜色 ---------- */
  const hexOf = (c) => (typeof c === "string" ? parseInt(c.replace("#", "").slice(0, 6), 16) : Number(c) || 0);
  const rgb = (c) => { const n = hexOf(c); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  /** 两个颜色（0xRRGGBB 或 "#rrggbb"）按 k 混合，返回 0xRRGGBB */
  function mixHex(a, b, k) {
    const p = rgb(a), q = rgb(b);
    const c = p.map((v, i) => Math.round(v + (q[i] - v) * clamp(k, 0, 1)));
    return (c[0] << 16) | (c[1] << 8) | c[2];
  }
  const css = (n) => "#" + hexOf(n).toString(16).padStart(6, "0");
  const mixCss = (a, b, k) => css(mixHex(a, b, k));
  /** 亮度（0–1，按 sRGB 的数粗算，比较「哪个暗」够用了） */
  const luma = (c) => { const [r, g, b] = rgb(c); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
  /** 颜色乘一个数（压暗 / 提亮），返回 0xRRGGBB */
  const scaleHex = (c, k) => { const v = rgb(c).map(x => clamp(Math.round(x * k), 0, 255)); return (v[0] << 16) | (v[1] << 8) | v[2]; };

  /* ---------- 随机数 / 节拍 ---------- */
  /** 小随机数（mulberry32，和 hd2d-world.js 的 rng 同一个算法）：同一个种子每次出一样的数 */
  function rand(seed) {
    let a = (seed * 2654435761) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const span = (r, range) => range[0] + r() * (range[1] - range[0]);
  /**
   * 环境动画的节拍（纯数据，不碰 three.js）：隔 every 秒（范围里随机）来一阵、每阵持续 dur 秒（随机）。
   * step(dt) 往前走 dt 秒，返回这一阵走到哪（0–1；没在动 = −1）；n = 来过几阵，gaps = 每两阵之间隔了多久（测试看频率）。
   * dt = 0（减少动态效果）时不走：动画那边自己换成安静的样子
   */
  function beat(r, every, dur, first) {
    let wait = first != null ? first : span(r, every), left = 0, len = 1, n = 0, idle = 0;
    const gaps = [];
    return {
      get n() { return n; }, gaps, every, dur,
      get active() { return left > 0; },
      step(dt) {
        if (!(dt > 0)) return left > 0 ? 1 - left / len : -1;
        if (left > 0) {
          left -= dt;
          if (left > 0) return 1 - left / len;
          left = 0; wait = span(r, every); idle = 0;
          return -1;
        }
        wait -= dt; idle += dt;
        if (wait > 0) return -1;
        if (n > 0) gaps.push(idle);
        n++; len = left = Math.max(1e-3, span(r, dur));
        return 0;
      }
    };
  }

  /**
   * 来回走的东西（矿车、罐笼……）的状态（纯数据）：停 wait 秒（随机）→ 挑另一个停靠点（stops，0–1）→ 按 speed（每秒走全程的几成，随机）走过去 → 再停。
   * step(dt) 往前走 dt 秒；s = 现在在哪（0–1）；trips 走了几趟、waits 每次停了多久（测试看频率）。dt = 0（减少动态效果）时停在原地
   */
  function mover(r, cfg, start) {
    const st = { s: start || 0, to: start || 0, moving: false, speed: 0, wait: span(r, cfg.wait), idle: 0, trips: 0, waits: [] };
    st.step = (dt) => {
      if (!(dt > 0)) return st.s;
      if (st.moving) {
        const d = st.to - st.s, go = st.speed * dt;
        if (Math.abs(d) <= go) { st.s = st.to; st.moving = false; st.trips++; st.wait = span(r, cfg.wait); st.idle = 0; }
        else st.s += Math.sign(d) * go;
        return st.s;
      }
      st.idle += dt;
      if ((st.wait -= dt) > 0) return st.s;
      const next = cfg.stops.filter(v => Math.abs(v - st.s) > 1e-6);
      st.waits.push(st.idle);
      st.to = next[Math.floor(r() * next.length)]; st.speed = span(r, cfg.speed); st.moving = true;
      return st.s;
    };
    return st;
  }

  /* ---------- 地台上能摆装饰的地方 ---------- */
  /**
   * 一块地台上能摆装饰的点（局部坐标，相对区中心；纯函数）：
   *   左右两条边带：横着离区中心 ≥ 站位区半宽 + foot，在外轮廓里面（每隔 step 试一个点，放在边带能放的那一截的正中）；
   *     挨着别的区的那条边，中间桥 / 墙 / 门接上来的那一段（布局的 CONFIG.outline.mouth）不摆；高地的台阶那一段也不摆
   *   左右两边矮一截的台子顶上（台子在外轮廓外面）
   * 每个点带着那里放得下多大（r：离站位区、离外轮廓的边都还隔着 r，离边再多 clear），放不下 rad 的不要。
   * 返回 [{ x, z, y（台面多高）, r, on: "band" / "ledge", side: -1 左 / 1 右 }]
   */
  function zoneSpots(z, rad) {
    const pts = outlineOf(z), hw = z.w / 2, hd = z.d / 2, stand = hw - L.CONFIG.pad, out = [], O = z.outline || {}, sides = O.sides || {};
    const inner = stand + SPOT.foot;
    const stairs = O.stairs === "left" ? -1 : O.stairs === "right" ? 1 : 0, sw = L.CONFIG.outline.stairs * z.d + 0.3;   // 台阶从那里爬上来
    const mouth = L.CONFIG.outline.mouth * z.d / 2 + 0.3;
    [-1, 1].forEach(sx => {
      const near = sides[sx < 0 ? "left" : "right"];
      for (let zz = -hd + 0.25; zz <= hd - 0.25 + 1e-9; zz += SPOT.step) {
        if ((sx === stairs && Math.abs(zz) < sw + rad) || (near && Math.abs(zz) < mouth + rad)) continue;
        let edge = null;   // 这一行在外轮廓里面最往外能到哪（离边还隔着 clear）
        for (let xx = inner; xx <= hw + 0.6; xx += 0.02) if (L.outlineDist(pts, sx * xx, zz) >= SPOT.clear) edge = xx;
        if (edge == null) continue;
        const x = (inner + edge) / 2, r = Math.min(x - inner, L.outlineDist(pts, sx * x, zz) - SPOT.clear);
        if (r >= rad) out.push({ x: round3(sx * x), z: round3(zz), y: z.h, r: round3(r), on: "band", side: sx });
      }
    });
    (O.ledges || []).forEach(l => {
      if (l.side !== "left" && l.side !== "right") return;
      const c = l.pts.reduce((a, p) => ({ x: a.x + p.x / l.pts.length, z: a.z + p.z / l.pts.length }), { x: 0, z: 0 });
      const r = L.outlineDist(l.pts, c.x, c.z) - SPOT.clear;
      if (r >= rad) out.push({ x: round3(c.x), z: round3(c.z), y: round3(z.h * l.h), r: round3(r), on: "ledge", side: l.side === "left" ? -1 : 1 });
    });
    return out;
  }
  /** 从候选点里按种子挑 n 个，两两至少隔开 apart（挑不够就少放几个） */
  function pick(spots, n, r, apart) {
    const pool = spots.slice(), got = [];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    pool.forEach(s => { if (got.length < n && got.every(q => Math.hypot(q.x - s.x, q.z - s.z) >= apart)) got.push(s); });
    return got;
  }
  /** 地台的外轮廓（布局给的不规则多边形；没给就是正方形） */
  function outlineOf(z) {
    const hw = z.w / 2, hd = z.d / 2;
    return z.outline && z.outline.pts && z.outline.pts.length >= 3 ? z.outline.pts : [{ x: -hw, z: -hd }, { x: hw, z: -hd }, { x: hw, z: hd }, { x: -hw, z: hd }];
  }
  const round3 = (v) => Math.round(v * 1e3) / 1e3;

  /* ---------- 战场周围（远景那一层）：哪里能摆 ---------- */
  /**
   * 战场周围的装饰（矿坑边的栏杆、矿底的管道、前景的石头……）摆在战场范围外面：bounds 是布局的 out.bounds。
   * 后面先让开灯（灯在最后一排地台后沿再往后 CONFIG.lamps.back，见 hd2d-layout.js · lampSpots），所以后面的东西从 back 往后摆。
   * 返回 { cx, cz, hx, hz, back（后面的东西最近到哪）, sideX（左右的东西最近到哪，离中心）, front（前面的东西最近到哪） }
   */
  function around(b, margin) {
    const m = margin || {}, C = L.CONFIG.lamps;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, hx = (b.maxX - b.minX) / 2, hz = (b.maxZ - b.minZ) / 2;
    return {
      cx, cz, hx, hz,
      back: b.minZ - C.back - (m.back != null ? m.back : 1.2),
      sideX: hx + (m.side != null ? m.side : 1.4),
      front: b.maxZ + (m.front != null ? m.front : 1.2)
    };
  }

  return {
    SPOT, add, of, list, texture, decal, zone, band, backdrop, skyGap, lighting, applyLight,
    mixHex, mixCss, css, luma, scaleHex, hexOf, rand, span, beat, mover, zoneSpots, pick, outlineOf, around
  };
});
