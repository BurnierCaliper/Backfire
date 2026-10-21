/* Antlerscale: Backfire · HD-2D 战场原型 · 区域场景的美术包：三个采矿场（#242）
 *
 * 主人试玩反馈 · 五：第一采矿场分矿外 / 矿内 / 矿底三个场景；第二采矿场是它的变体（更红，时不时喷火的管道、橙红发光的岩石）；
 * 第三采矿场的矿坑浅（只有矿外 / 矿底：深色的坑里到处是紫色晶体、背景半截埋在地里发紫光的大陨石、时不时跳紫色电弧）。
 * 每个场景一套：地面（顶面贴图）、地台侧面、地台上的装饰、远景、光照 / 调色、环境动画；数值都在下面的配置表里。
 * 怎么接进画面见 hd2d-scene-art.js（登记处）：这里不 import three.js，three.js 和画贴图 / 拼几何体的小工具由挂钩那边打包成 kit 传进来。
 *
 *   矿外 rim：站在矿坑边上的砂岩地上。战场后面是一个往下陷的巨大坑口——地台外面那片地铺到坑边为止（远景给 groundEdge），坑边一排碎石和栏杆；
 *            坑的对面崖壁在很远处（按镜头摆：画面上沿刚好露出对面的坑沿），一级级台阶往下、平面上像半个碗（两边弯过来），
 *            越往下越黑，到这边坑沿挡住的地方之前就漆黑一片；坑壁上零星几盏灯（偶尔闪一下），两部运载电梯（亮着灯的小方块）
 *            沿着竖直的轨道慢慢上下；对面坑沿上远远的矿井架、筒仓、烟囱。天幕挪到坑后面（skyGap），不挡住坑
 *   矿内 mid：大矿坑里大约一半深的地方，站在坑壁半腰的运输道上，光压得更暗。运输道的边一排挡车土埂（几个路锥），后面往下还是坑；
 *            远远的对面坑壁一级级台阶，往上出了画面（看不到天）、往下越来越黑；左右后方岩石堆成的不规则的墙，中间的大开口看得到对面；
 *            前景左右两角几块大石头
 *
 * 地台上的装饰只摆在左右两条边带和左右矮一截的台子上（站位区以外，见 hd2d-scene-art.js · zoneSpots），不压住站位、铭牌；
 * 战场周围的东西都在战场范围外面（后面先让开灯）。只读布局给的地台 / 战场范围，不碰单位数据（没有坚毅生命）。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./hd2d-layout.js"), require("./hd2d-scene-art.js"));
  else root.HD2DScenesMine = factory(root.HD2DLayout, root.HD2DSceneArt);
})(typeof self !== "undefined" ? self : this, function (L, A) {
  "use strict";

  /* ---------- 配置 ---------- */
  /** 各采矿场的色调：rock 坑壁 / 石头的几层颜色（一级级台阶轮着用）、wall 坑里近处的岩壁 / 大石头（暗一点）、dark 坑底的黑（带一点雾的颜色）、
   *  metal 钢架 / 栏杆、lamp 工作灯、cone 路锥 */
  const PALETTE = {
    mine1: { rock: [0xc39363, 0xa9784c, 0xd2a571, 0x9b6c45, 0xb88654], wall: [0x6e5843, 0x5c4836, 0x7a634c, 0x524032], dark: 0x0d0b0a, metal: 0x5d4636, lamp: 0xffc46e, cone: 0xe8742a }
  };
  /** 大矿坑（矿外 rim）：对面坑壁一级级台阶往下（平面上像半个碗：正中最远，往画面两边弯过来），越往下越黑，到底漆黑一片
   *   rim       坑边在灯后面再往后多远（地台外面那片地铺到这里为止）
   *   rise      对面坑沿比这边低多少（负数：对面坑沿低一点，坑壁可以摆得更远、画面上沿还露得出坑沿）
   *   view      对面坑壁摆多远：远景镜头的画面上沿正好在对面坑沿往上 view 高的地方（小棋盘的镜头近、低，坑壁就跟着近）；far 夹住（离坑边最近 / 最远）
   *   curve / wide   往两边弯过来多少（× 坑壁离坑边的距离）、弯到哪为止（× 画面在坑壁那里的半宽）；gap 台阶最近到坑边前多远
   *   step / run / benches   每级台阶多高、往前伸多少、一共几级（坑壁陡，看起来深）
   *   seg / jitter           横着分几段、每段的台阶边随机歪多少
   *   dark      从哪开始变黑、到哪全黑：按「对面坑沿 → 这边坑沿挡住的地方」那一截的比例（每块棋盘看得到多深不一样，都在挡住之前就漆黑一片）
   *   dim       整面坑壁的亮度；haze 最上面往远处的雾色靠多少（越往下越少）、hazeDark 雾色先往坑底的黑靠多少
   *   bottom    最后一级一直往下到多深；sky 天幕在对面坑沿后面多远（天幕挪到坑后面，不挡住坑）；land 对面坑沿往后那片地往雾色靠多少
   *   shaft     电梯井：那一段台阶不往前伸，竖着切下去（半宽、过渡多宽），电梯的轨道贴着它
   * 矿内 mid 还是以前的一面台阶坑壁（下一步改） */
  const PIT = {
    rim: {
      rim: 1.4, rise: -2.5, view: 3, far: [12, 40], curve: 0.42, wide: 1.15, gap: 1.5, step: 1, run: 0.3, benches: 44, seg: 96, jitter: 0.07,
      dark: [0.12, 0.68], dim: 1, haze: 0.5, hazeDark: 0, bottom: -70, sky: 14, land: 0.6, shaft: [0.6, 1.1]
    },
    mid: { rim: 1.4, far: 1.4, top: 11, back: 0.9, step: 0.36, run: 0.07, benches: 64, road: [14, 29], roadRun: 3, seg: 48, jitter: 0.05, dark: [27, 41], haze: 0.55, hazeDark: 0.45, bottom: -16 }
  };
  /** 运载电梯：两根竖轨的间距（半个）、轨道粗细、一格横撑多高；罐笼的宽 / 高 / 深、亮着的窗多高；轨道从坑沿往上伸多少、往下伸到挡住的地方再往下多少 */
  const LIFT = { gauge: 0.2, rail: 0.05, tie: 0.55, car: [0.46, 0.4, 0.34], window: 0.16, above: 0.3, below: 5 };
  /** 矿内：近处岩石堆成的不规则的墙（左右各一段，中间留开口）。gap 开口的半宽（× 战场半宽）、reach 往外铺到战场左右再外面多远、
   *  columns 每边几堆、depth 往坑里摆多深（坑边后面）、h 墙顶多高（× 画面上沿那条视线的高度：开口那头矮、外面高） */
  const WALLS = { mid: { gap: 0.42, reach: 12, columns: 7, depth: 2.2, h: [0.5, 0.95] } };
  /** 矿内：坑边的挡车土埂（一排大石头，上面几个路锥）；前景的石头：战场前沿再往前（离前沿 front，按石头大小再让开），
   *  横着在战场左、右两边的 span 那一截（× 战场半宽，中间空出来），镜头前面框住画面的两个下角；矮，挡不到最前排的脚下 */
  const BERM = { size: [0.28, 0.5], spacing: [0.55, 0.9], cones: 5 };
  const FORE = { mid: { n: 4, size: [0.5, 0.9], span: [0.45, 0.95], front: [0.7, 2.6], squash: 0.62 } };
  /** 环境动画的频率（秒）。减少动态效果时都停住：电梯、矿车停在原地，灯不闪
   *   lift    运载电梯：每次停多久、走多慢（每秒走全程的几成：全程要二三十秒）、停在哪几处（0 = 对面坑沿，1 = 这边坑沿挡住的地方再往下，看不见了）
   *   skip    斜井里的矿车：每次停多久、走多快（每秒走井道全长的几成）、停在哪几处（0 = 坑沿，1 = 井底，越往下越黑）
   *   blink   坑壁上的灯：隔多久暗一下、每次暗多久 */
  const AMBIENT = {
    lift: { wait: [3, 8], speed: [0.03, 0.055], stops: [0, 0.3, 0.62, 1] },
    skip: { wait: [2.5, 7], speed: [0.08, 0.16], stops: [0, 0.35, 0.7, 1] },
    blink: { every: [1.2, 4.5], dur: [0.08, 0.3] }
  };
  /** 每个场景（键 = 地面主题）：
   *   palette / depth（rim 矿外、mid 矿内）/ pit（PIT 的哪一套）
   *   decor     地台上的装饰：band 左右边带上几个、ledge 台子上几个、size 半径范围、tone 用色调里的哪组颜色（rock 砂岩 / wall 暗的岩石）
   *   backdrop  远景：lights 坑壁上几盏灯（blink 几成会闪）、lifts 运载电梯在哪（× 画面在对面坑壁那里的半宽，从中间往左右）、
   *             skips 斜井在哪（× 战场半宽 + 6）、rail 坑边栏杆、farRim 对面坑沿上的矿井架 / 筒仓 / 烟囱；
   *             berm 坑边的挡车土埂、walls 近处的岩壁（WALLS）、fore 前景的石头（FORE）
   *   ambient   有哪些环境动画（AMBIENT 的键）
   *   light     光照 / 调色（写法见 hd2d-scene-art.js · lighting）：矿内压暗（灯更显眼），雾往坑里的暗色靠 */
  const ART = {
    mine1_rim: {
      palette: "mine1", depth: "rim", pit: "rim",
      decor: { band: 3, ledge: 2, size: [0.1, 0.17], tone: "rock" },
      backdrop: { lights: 12, blink: 0.45, lifts: [-0.48, 0.34], rail: true, farRim: true },
      ambient: ["lift", "blink"],
      light: { all: { tint: { fog: [0xc29466, 0.15], hemiGround: [0x8c6642, 0.3] } } }
    },
    mine1_mid: {
      palette: "mine1", depth: "mid", pit: "mid",
      decor: { band: 3, ledge: 2, size: [0.1, 0.17], tone: "wall" },
      backdrop: { lights: 20, blink: 0.4, skips: [0.12], berm: true, walls: "mid", fore: "mid" },
      ambient: ["skip", "blink"],
      light: {
        all: {
          scale: { hemi: 0.55, sunI: 0.42, rimI: 0.75, exposure: 0.9, lamp: 1.8 },
          tint: { fog: [0x221a14, 0.6], sky: [0x261c15, 0.6], ground: [0x2a2018, 0.25], hemiSky: [0xa08c72, 0.35], hemiGround: [0x1c140e, 0.5], sun: [0xffe2b4, 0.25] },
          set: { dofFar: 0.011 }, grade: { vignette: 0.48 }
        }
      }
    }
  };
  /** 地面主题（并进布局的 GROUNDS，写法同 hd2d-layout.js 的 GROUNDS）：顶面 / 侧面贴图是这里画的（art 开头），backdrop 指回这一套 */
  const GROUNDS = {
    mine1_rim: {   // 第一采矿场 · 矿外：砂岩地（一块块砂岩板、层理细纹），侧面砂岩层；地台外面是砂岩色的地；一盏矿灯
      tex: "artSandstone", tint: 0xffffff, side: "artSandstoneSide", decals: { crack: 2, gravel: 2, artSandDrift: 3 },
      pebbles: 14, pebble: 0xa98560, rock: 0x9c7752, decor: "art", ground: 0xa27c55, backdrop: "mine1_rim",
      lamps: { kind: "hanging", color: 0xffc46e, day: 1, dusk: 1, night: 1 }
    },
    mine1_mid: {   // 第一采矿场 · 矿内：坑壁半腰的运输道（压实的土、两道车辙、碎石），侧面是爆破过的台阶断面；地台外面是暗褐的土；矿灯傍晚以后两盏
      tex: "artHaulRoad", tint: 0xffffff, side: "artBenchSide", decals: { gravel: 3, slag: 2, crack: 2 },
      pebbles: 22, pebble: 0x7a6856, rock: 0x5c4a3a, decor: "art", ground: 0x5e4c3c, backdrop: "mine1_mid",
      lamps: { kind: "hanging", color: 0xffc46e, day: 1, dusk: 2, night: 2 }
    }
  };
  /** 区域 → 场景 id（world-data.js · BATTLE_SCENES）→ 地面主题 */
  const SCENES = {
    "第一采矿场": { rim: "mine1_rim", mid: "mine1_mid" }
  };

  /* ---------- 小工具 ---------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const D2R = Math.PI / 180;
  /** 字符串 → 种子（同一个场景每次一样） */
  const seedOf = (s) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 100003; };
  const named = (t, name) => { t.name = name; return t; };
  /** 一块低多边形的石头：二十面体的每个顶点沿半径随机往里收一点（同一个位置的顶点一起动，面不裂开；不超出 rad），再压扁一点 */
  function rockGeo(kit, rad, r, squash) {
    const geo = new kit.THREE.IcosahedronGeometry(rad, 0), p = geo.attributes.position, seen = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = p.getX(i).toFixed(3) + "," + p.getY(i).toFixed(3) + "," + p.getZ(i).toFixed(3);
      if (!seen.has(key)) seen.set(key, 0.68 + r() * 0.32);
      const k = seen.get(key);
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * (squash || 1), p.getZ(i) * k);
    }
    geo.computeVertexNormals();
    return geo;
  }
  /** 战场范围（远景的 env 给的是中心和半宽） */
  const boundsOf = (env) => ({ minX: env.cx - env.hx, maxX: env.cx + env.hx, minZ: env.cz - env.hz, maxZ: env.cz + env.hz });
  /** 关掉阴影、打上标签（测试按 userData.art 认是什么） */
  function tag(o, what) {
    o.userData.art = what;
    o.traverse(m => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
    return o;
  }

  /* ---------- 贴图（canvas 程序贴图，没有图片文件）---------- */
  /** 一张美术包的贴图：kit.canvasTex 画（按名字缓存），贴图的 name 就是它在包里的名字（测试按它认） */
  const paint = (name, size, draw, opt) => (kit) => named(kit.canvasTex("art-" + name, size, (g, s, r) => draw(g, s, r, kit), opt), name);
  const TEXTURES = {
    /** 砂岩地（矿外）：一行行砂岩板（高低、宽窄不一，接缝在贴图边上首尾相接），每块颜色略不同、带交错层理的细纹，接缝里积着沙，零星的裂缝和碎石 */
    artSandstone: paint("artSandstone", 256, (g, s, r, kit) => {
      const hues = ["#c39465", "#b88859", "#cfa173", "#ad7d50", "#c99a69", "#b48356", "#d6ab7c"];
      g.fillStyle = hues[0]; g.fillRect(0, 0, s, s);
      const joints = [];
      for (let y = 0; y < s;) {
        let h = 40 + Math.floor(r() * 42);
        if (s - y - h < 34) h = s - y;
        let x = Math.floor(r() * 60);
        const x0 = x;
        while (x < x0 + s) {
          let w = 52 + Math.floor(r() * 64);
          if (x0 + s - x - w < 36) w = x0 + s - x;
          const col = hues[Math.floor(r() * hues.length)], ang = (r() - 0.5) * 0.7, layers = 3 + Math.floor(r() * 5);
          [0, -s].forEach(dx => {   // 跨过右边的那一截绕回左边画
            g.save(); g.beginPath(); g.rect(x + dx, y, w, h); g.clip();
            g.fillStyle = col; g.fillRect(x + dx, y, w, h);
            g.strokeStyle = "rgba(110,70,36,.22)"; g.lineWidth = 1;
            for (let k = 0; k < layers; k++) {   // 交错层理：斜着的几道细纹
              const yy = y + (k + 0.5) * h / layers;
              g.beginPath(); g.moveTo(x + dx, yy); g.lineTo(x + dx + w, yy + Math.tan(ang) * w); g.stroke();
            }
            g.fillStyle = r() < 0.5 ? "rgba(255,236,200,.07)" : "rgba(60,34,16,.07)"; g.fillRect(x + dx, y, w, h);
            g.restore();
          });
          joints.push([x % s, y, h]);
          x += w;
        }
        joints.push([null, y, 0]);
        y += h;
      }
      kit.speckle(g, s, r, 2200, "rgba(255,240,214,.16)", "rgba(80,48,22,.18)");
      g.strokeStyle = "rgba(48,28,14,.55)"; g.lineWidth = 2.5;   // 接缝（横的一整行、竖的一块块）
      joints.forEach(([x, y, h]) => {
        g.beginPath();
        if (x == null) { g.moveTo(0, y + 1); g.lineTo(s, y + 1); } else { g.moveTo(x + 1, y); g.lineTo(x + 1, y + h); }
        g.stroke();
      });
      g.strokeStyle = "rgba(255,232,196,.14)"; g.lineWidth = 1;   // 接缝的亮边
      joints.forEach(([x, y, h]) => { g.beginPath(); if (x == null) { g.moveTo(0, y + 3); g.lineTo(s, y + 3); } else { g.moveTo(x + 3, y); g.lineTo(x + 3, y + h); } g.stroke(); });
      g.strokeStyle = "rgba(52,30,14,.5)";
      for (let k = 0; k < 4; k++) kit.crack(g, r, r() * s, r() * s, 5 + Math.floor(r() * 6), 1.2, 1);
      for (let k = 0; k < 3; k++) kit.gravel(g, r, r() * s, r() * s, 5 + r() * 7, 8 + Math.floor(r() * 8));
    }),
    /** 地台侧面（矿外）：砂岩层——一层层暖色的砂岩（厚薄不一、上沿被风化得坑坑洼洼），厚的几层里有斜的层理，竖着几道裂缝 */
    artSandstoneSide: paint("artSandstoneSide", 128, (g, s, r, kit) => {
      const cols = ["#c8925c", "#b07a4a", "#d8a874", "#9c6a40", "#c08654", "#e0b684", "#a8723f"];
      for (let y = 0; y < s;) {
        const h = 5 + r() * 15, col = cols[Math.floor(r() * cols.length)];
        g.fillStyle = col; g.beginPath(); g.moveTo(0, y);
        for (let x = 0; x <= s; x += 8) g.lineTo(x, y + Math.sin(x * 0.09 + y) * 1.4 + (r() - 0.5) * 1.2);
        g.lineTo(s, y + h); g.lineTo(0, y + h); g.fill();
        if (h > 12) { g.strokeStyle = "rgba(90,52,24,.25)"; g.lineWidth = 1; for (let k = 0; k < 5; k++) { const x = r() * s; g.beginPath(); g.moveTo(x, y + 2); g.lineTo(x + h * 0.9, y + h - 2); g.stroke(); } }
        g.fillStyle = "rgba(40,22,10,.28)"; g.fillRect(0, y + h - 1, s, 1.5);
        y += h;
      }
      kit.speckle(g, s, r, 800, "rgba(255,236,206,.14)", "rgba(40,22,10,.22)");
      g.strokeStyle = "rgba(40,22,10,.4)";
      for (let k = 0; k < 4; k++) { const x = r() * s; g.lineWidth = 1 + r(); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 10, s * (0.3 + r() * 0.7)); g.stroke(); }
    }),
    /** 运输道（矿内）：压实的土（深浅不一、潮的几块），两道车辙横着穿过（一格格斜的胎纹，压痕边上翻起来的土），密密的碎石和几块小石头 */
    artHaulRoad: paint("artHaulRoad", 256, (g, s, r, kit) => {
      g.fillStyle = "#6b5a47"; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 16; i++) {
        g.fillStyle = r() < 0.55 ? `rgba(28,18,10,${0.06 + r() * 0.08})` : `rgba(255,236,206,${0.03 + r() * 0.05})`;
        g.beginPath(); g.ellipse(r() * s, r() * s, 22 + r() * 54, 14 + r() * 34, r() * 3, 0, 7); g.fill();
      }
      kit.speckle(g, s, r, 2600, "rgba(255,236,210,.10)", "rgba(20,12,6,.22)");
      [s * 0.2, s * 0.6].forEach(y0 => [0, 44].forEach(off => {   // 车辙：两个轮子各压一道
        const y = y0 + off;
        g.fillStyle = "rgba(24,16,8,.3)"; g.fillRect(0, y, s, 17);
        g.fillStyle = "rgba(0,0,0,.18)";
        for (let x = 0; x < s; x += 9) { g.beginPath(); g.moveTo(x, y + 2); g.lineTo(x + 5, y + 2); g.lineTo(x + 2, y + 15); g.lineTo(x - 3, y + 15); g.fill(); }
        g.fillStyle = "rgba(255,232,200,.08)"; g.fillRect(0, y - 2, s, 2); g.fillRect(0, y + 17, s, 2);
      }));
      for (let i = 0; i < 520; i++) {
        const x = r() * s, y = r() * s, w = 1.2 + r() * 3, h = 1 + r() * 2.2, v = 96 + Math.floor(r() * 64);
        g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(x + 1, y + 1, w, h);
        g.fillStyle = `rgb(${v + 14},${v + 4},${v - 10})`; g.fillRect(x, y, w, h);
      }
      for (let k = 0; k < 4; k++) kit.gravel(g, r, r() * s, r() * s, 6 + r() * 8, 10 + Math.floor(r() * 10));
    }),
    /** 地台侧面（矿内）：爆破过的台阶断面——暗的岩层，一道道竖着的半个钻孔（左边亮、右边暗），几道裂缝 */
    artBenchSide: paint("artBenchSide", 128, (g, s, r, kit) => {
      const cols = ["#6e5a48", "#5e4c3c", "#7a6450", "#54443a", "#685444"];
      for (let y = 0; y < s;) {
        const h = 8 + r() * 18;
        g.fillStyle = cols[Math.floor(r() * cols.length)]; g.fillRect(0, y, s, h);
        g.fillStyle = "rgba(0,0,0,.22)"; g.fillRect(0, y + h - 1, s, 1.5);
        y += h;
      }
      for (let x = 5 + r() * 6; x < s; x += 13 + r() * 8) {
        const y0 = r() * s * 0.3, grd = g.createLinearGradient(x - 3, 0, x + 3, 0);
        grd.addColorStop(0, "rgba(255,240,220,.18)"); grd.addColorStop(0.5, "rgba(0,0,0,.28)"); grd.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grd; g.fillRect(x - 3, y0, 6, s * (0.45 + r() * 0.55));
      }
      kit.speckle(g, s, r, 700, "rgba(255,236,206,.10)", "rgba(0,0,0,.25)");
      g.strokeStyle = "rgba(10,6,2,.45)";
      for (let k = 0; k < 4; k++) kit.crack(g, r, r() * s, r() * s, 5, 1, 0);
    }),
    /** 贴花：一摊被风吹积的浮沙（浅色、软边，几道细沙纹） */
    artSandDrift: paint("artSandDrift", 128, (g, s, r, kit) => {
      const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.46);
      grd.addColorStop(0, "rgba(226,196,148,.75)"); grd.addColorStop(0.6, "rgba(220,188,140,.45)"); grd.addColorStop(1, "rgba(220,188,140,0)");
      g.fillStyle = grd; g.beginPath(); g.ellipse(s / 2, s / 2, s * 0.46, s * 0.3, 0, 0, 7); g.fill();
      g.strokeStyle = "rgba(150,108,62,.3)"; g.lineWidth = 1.5;
      for (let k = 0; k < 4; k++) { g.beginPath(); for (let x = s * 0.2; x <= s * 0.8; x += 5) g.lineTo(x, s * (0.38 + k * 0.08) + Math.sin(x * 0.12 + k) * 2.5); g.stroke(); }
      kit.speckle(g, s, r, 120, "rgba(255,240,210,.3)", "rgba(120,80,40,.2)");
    }, { clamp: true, smooth: true })
  };
  /** 贴花（写法同 hd2d-world.js 的 DECALS） */
  const DECALS = {
    artSandDrift: { tex: "artSandDrift", size: [1.2, 2.1] }
  };

  /* ---------- 地台上的装饰 ---------- */
  /**
   * 一块地台上摆什么、摆在哪（纯函数，测试用同一份）：左右边带上 decor.band 个、左右的台子上 decor.ledge 个（hd2d-scene-art.js · zoneSpots），
   * 两两隔开。返回 [{ kind, x, z, y（摆在多高的台面上）, size（半径）, on }]（局部坐标）
   */
  function zonePlan(z, key) {
    const art = ART[key];
    if (!art) return [];
    const D = art.decor, R = A.rand(z.id * 977 + seedOf(key)), spots = A.zoneSpots(z, D.size[0]);
    const band = A.pick(spots.filter(s => s.on === "band"), D.band, R, 1.4);
    const ledge = A.pick(spots.filter(s => s.on === "ledge"), D.ledge, R, 0.8);
    return band.concat(ledge).map(s => ({ kind: D.kind || "rock", x: s.x, z: s.z, y: s.y, size: Math.min(A.span(R, D.size), s.r), on: s.on }));
  }
  /** 挂钩：地台上的装饰（hd2d-world.js · buildZone 交过来；地台本体、贴花、小石子已经画好了） */
  function zone(kit, g, z, ctx, r, look, a) {
    const art = a.art, P = PALETTE[art.palette], R = A.rand(z.id * 131 + seedOf(a.key)), tones = P[art.decor.tone] || P.rock;
    zonePlan(z, a.key).forEach(d => {
      const col = tones[Math.floor(R() * tones.length)];
      const m = kit.mesh(rockGeo(kit, d.size, R, 0.62), kit.mat("art-rock-" + art.palette, col, { roughness: 1 }), d.x, d.y + d.size * 0.32, d.z);
      m.rotation.y = R() * Math.PI * 2;
      m.userData.art = d.kind; m.userData.size = d.size;
      g.add(m);
    });
  }

  /* ---------- 远景：大矿坑（矿外）---------- */
  /**
   * 矿坑摆在哪（纯函数，天幕挪多远也用它）：坑边（这边）在灯后面再往后 Q.rim；对面坑壁按镜头摆——远景镜头的画面上沿正好在对面坑沿往上 Q.view 高的地方，
   * 夹在 Q.far 里。返回 { rimZ 坑边, zFar 对面坑沿（正中）, D 两边隔多远, top 对面坑沿多高, cx, halfW 画面在对面坑壁那里的半宽, W 坑壁弯到哪,
   *   yOcc 从镜头看过来，这边的坑沿把对面坑壁挡到多深（再往下看不见）, sky 天幕离战场后沿多远 }
   */
  function pitDims(Q, b, cam) {
    const gY = L.CONFIG.groundY, rimZ = b.minZ - L.CONFIG.lamps.back - Q.rim, top = gY + Q.rise, cx = (b.minX + b.maxX) / 2;
    const ok = !!(cam && cam.pos && Number.isFinite(cam.elevation) && Number.isFinite(cam.fov));
    const tan = ok ? Math.tan((cam.elevation - cam.fov / 2) * D2R) : 0;
    const D = clamp(tan > 1e-3 ? rimZ - (cam.pos.z - (cam.pos.y - (top + Q.view)) / tan) : Q.far[1], Q.far[0], Q.far[1]), zFar = rimZ - D;
    let halfW = (b.maxX - b.minX) / 2 + D * 0.4;
    if (ok && cam.right && cam.tanHalf && cam.aspect) {
      const p = L.toNdc(cam, { x: cx, y: top, z: zFar }), q = L.toNdc(cam, { x: cx + 1, y: top, z: zFar });
      if (q.x - p.x > 1e-6) halfW = 1 / (q.x - p.x);
    }
    const occ = ok && cam.pos.z > rimZ + 1 ? gY - D * (cam.pos.y - gY) / (cam.pos.z - rimZ) : top - 12;
    return { rimZ, zFar, D, top, cx, halfW, W: halfW * Q.wide, yOcc: Math.min(occ, top - 2), sky: b.minZ - zFar + Q.sky };
  }
  /**
   * 对面的坑壁：一级级台阶往下（第 k 级的台面在 top − k × step，台阶边在 zFar + 弯过来的那一点 + k × run，越往下越靠近这边，最近到坑边前 gap），
   * 平面上像半个碗（bowl：画面两边的台阶更近，一级级台阶在画面上是往两边垂下去的弧）；电梯井那一段竖着切下去（cut）。横着分 seg 段，每段的台阶边随机歪一点。
   * 拼成一个几何体，颜色按顶点给：一层层岩石的颜色，台面亮、立面暗；上面往远处的雾色靠，往下越来越黑（按看得到的那一截算，挡住之前就漆黑一片）。
   * 对面坑沿往后一片地，慢慢升到天幕前（低镜头时接上天）。不吃场景的雾（雾会把坑底也抹亮），自己按远近调颜色。
   * 返回 { mesh, d, Q, n, edgeAt(k, x) → { y, z }, faceAt(x) 电梯井那里的竖壁在哪（z）, darkAt(y) 0–1 多黑, landAt(z) 对面那片地多高 }
   */
  function pitWall(kit, env, Q, P, R, d, shafts) {
    const THREE = kit.THREE, n = Q.benches, seg = Q.seg, xs = [], ys = [], zs = [];
    for (let i = 0; i <= seg; i++) xs.push(env.x0 + (env.x1 - env.x0) * i / seg);
    const cut = (x) => shafts.reduce((m, s) => Math.max(m, 1 - smooth(Q.shaft[0], Q.shaft[0] + Q.shaft[1], Math.abs(x - s))), 0);
    const bowl = (x) => { const u = Math.min(1, Math.abs(x - d.cx) / d.W); return d.D * Q.curve * (1 - Math.sqrt(1 - u * u)); };
    const zMax = d.rimZ - Q.gap;
    for (let k = 0; k < n; k++) {
      ys.push(xs.map(() => d.top - k * Q.step + (k ? (R() - 0.5) * 2 * Q.jitter : 0)));
      zs.push(xs.map(x => { const c = cut(x); return Math.min(zMax, d.zFar + bowl(x) + k * Q.run * (1 - c) + (R() - 0.5) * 2 * Q.jitter * (1 - c)); }));
    }
    const back = env.skyZ + 0.3, gY = L.CONFIG.groundY, backY = Math.max(d.top, gY + 0.2);
    const landAt = (z) => d.top + (backY - d.top) * clamp((d.zFar - z) / Math.max(1e-3, d.zFar - back), 0, 1);
    const mist = new THREE.Color(P.dark), haze = env.hazeOf(1).lerp(mist, Q.hazeDark || 0);
    const d0 = d.top - (d.top - d.yOcc) * Q.dark[0], d1 = d.top - (d.top - d.yOcc) * Q.dark[1];
    const darkAt = (y) => smooth(0, 1, (d0 - y) / Math.max(1e-3, d0 - d1));
    const hazeAt = (y) => Q.haze * (1 - smooth(0, 1, (d.top - y) / Math.max(1e-3, d.top - d0)));
    const colorOf = (k, lit, v) => {   // 立面按它下半截的高度算黑不黑（一整面同一个颜色）
      const y = d.top - (k + (lit ? 0 : 0.6)) * Q.step, c = new THREE.Color(P.rock[k % P.rock.length]).multiplyScalar((lit ? 1.06 : 0.7) * v * Q.dim);
      return c.lerp(haze, hazeAt(y)).lerp(mist, darkAt(y));
    };
    const pos = [], col = [];
    const quad = (a, b, c, e, color) => [a, b, c, a, c, e].forEach(p => { pos.push(p[0], p[1], p[2]); col.push(color.r, color.g, color.b); });
    const land = new THREE.Color(P.rock[0]).multiplyScalar(Q.dim).lerp(haze, Q.land);
    for (let i = 0; i < seg; i++) {
      const xa = xs[i], xb = xs[i + 1], v = 0.92 + R() * 0.16;
      // 对面坑沿往后那片地：慢慢升到天幕前
      quad([xa, backY, back], [xa, ys[0][i], zs[0][i]], [xb, ys[0][i + 1], zs[0][i + 1]], [xb, backY, back], land.clone().multiplyScalar(v));
      for (let k = 0; k < n; k++) {
        const yb = k + 1 < n ? ys[k + 1] : null, lo = (j) => (yb ? yb[j] : Q.bottom);
        quad([xa, ys[k][i], zs[k][i]], [xa, lo(i), zs[k][i]], [xb, lo(i + 1), zs[k][i + 1]], [xb, ys[k][i + 1], zs[k][i + 1]], colorOf(k, false, v));   // 立面
        if (yb) quad([xa, yb[i], zs[k][i]], [xa, yb[i], zs[k + 1][i]], [xb, yb[i + 1], zs[k + 1][i + 1]], [xb, yb[i + 1], zs[k][i + 1]], colorOf(k + 1, true, v));   // 下一级的台面
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mesh = tag(new THREE.Mesh(geo, env.keep(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0, fog: false }))), "pitWall");
    const edgeAt = (k, x) => {
      const kk = clamp(Math.round(k), 0, n - 1), t = clamp((x - env.x0) / (env.x1 - env.x0) * seg, 0, seg - 1e-6), i = Math.floor(t), f = t - i;
      return { y: ys[kk][i] + (ys[kk][i + 1] - ys[kk][i]) * f, z: zs[kk][i] + (zs[kk][i + 1] - zs[kk][i]) * f };
    };
    return { mesh, d, Q, n, edgeAt, faceAt: (x) => Math.min(zMax, d.zFar + bowl(x)), darkAt, landAt };
  }
  /** 坑壁上零星的灯：落在看得到的那一截台阶边上（对面坑沿往下、这边坑沿挡住之前，大多在暗处），横着在画面里，让开电梯井；
   *  一部分偶尔暗一下（AMBIENT.blink；减少动态效果时一直亮着） */
  function pitLights(kit, env, wall, art, P, R, shafts) {
    const THREE = kit.THREE, d = wall.d, Q = wall.Q, BD = art.backdrop, cfg = AMBIENT.blink;
    const mat = env.keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(P.lamp).multiplyScalar(2.6), toneMapped: false, fog: false }));
    const geo = new THREE.SphereGeometry(0.075, 6, 5);
    const k0 = Math.ceil((d.top - (d.top - (d.top - d.yOcc) * 0.12)) / Q.step), k1 = Math.max(k0 + 1, Math.floor((d.top - d.yOcc - 0.4) / Q.step));
    for (let i = 0, tries = 0; i < BD.lights && tries < BD.lights * 20; tries++) {
      const x = d.cx + (R() * 2 - 1) * d.halfW * 1.05;
      if (shafts.some(s => Math.abs(x - s) < Q.shaft[0] + Q.shaft[1] + 0.3)) continue;
      const k = k0 + Math.floor(R() * (k1 - k0 + 1)), e = wall.edgeAt(k, x);
      const m = tag(kit.put(new THREE.Mesh(geo, mat), x, e.y + 0.07, e.z + 0.06), "pitLight");
      env.group.add(m);
      if (R() < BD.blink) {
        const beat = A.beat(A.rand(i * 59 + 3), cfg.every, cfg.dur);
        m.userData.ambient = { kind: "blink", beat };
        env.anims.push((t, dt) => { if (dt === 0) { m.visible = true; return; } m.visible = beat.step(dt) < 0; });
      }
      i++;
    }
  }
  /** 运载电梯：贴着对面坑壁竖着切下去的那一道（电梯井），两根竖轨 + 一格格横撑，从坑沿一直下到这边坑沿挡住的地方再往下；
   *  亮着灯的小方块（罐笼）沿着轨道慢慢上下（AMBIENT.lift：停一阵、挑另一个停靠点、慢慢开过去；最下面那处在挡住的地方下面，开下去就看不见了）。
   *  轨道越往下越黑（实例颜色），罐笼的外壳跟着暗下去，亮着的窗一直亮着。x = 电梯井在哪 */
  function lift(kit, env, wall, P, R, x, i) {
    const THREE = kit.THREE, d = wall.d, z = wall.faceAt(x) + 0.12, yTop = d.top + LIFT.above, yBot = d.yOcc - LIFT.below;
    const nT = Math.ceil((yTop - yBot) / LIFT.tie), metal = new THREE.Color(P.metal), dark = new THREE.Color(P.dark), c = new THREE.Color();
    const mat = env.keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.4, flatShading: true, fog: false }));
    const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(LIFT.rail, LIFT.tie, LIFT.rail), mat, nT * 2);
    const ties = new THREE.InstancedMesh(new THREE.BoxGeometry(LIFT.gauge * 2 + LIFT.rail * 2, LIFT.rail * 0.8, LIFT.rail), mat, nT);
    const o = new THREE.Object3D();
    for (let j = 0; j < nT; j++) {
      const y = yTop - (j + 0.5) * LIFT.tie;
      c.copy(metal).lerp(dark, wall.darkAt(y));
      [-1, 1].forEach((s, h) => { o.position.set(x + s * LIFT.gauge, y, z); o.updateMatrix(); rails.setMatrixAt(j * 2 + h, o.matrix); rails.setColorAt(j * 2 + h, c); });
      o.position.set(x, y + LIFT.tie / 2, z - 0.02); o.updateMatrix(); ties.setMatrixAt(j, o.matrix); ties.setColorAt(j, c);
    }
    const g = new THREE.Group();
    g.add(rails, ties);
    // 罐笼：外壳 + 正面一条亮着的窗 + 顶上一盏小灯
    const [cw, ch, cd] = LIFT.car, shell = env.keep(new THREE.MeshStandardMaterial({ color: P.metal, roughness: 0.6, metalness: 0.4, flatShading: true, fog: false }));
    const glow = env.keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(P.lamp).multiplyScalar(2.2), toneMapped: false, fog: false }));
    const car = new THREE.Group();
    car.add(new THREE.Mesh(new THREE.BoxGeometry(cw, ch, cd), shell));
    car.add(kit.put(new THREE.Mesh(new THREE.BoxGeometry(cw * 0.8, LIFT.window, 0.02), glow), 0, ch * 0.12, cd / 2 + 0.01));
    car.add(kit.put(new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), glow), 0, ch / 2 + 0.04, cd * 0.2));
    const cfg = AMBIENT.lift, mv = A.mover(A.rand(i * 733 + 29), cfg, cfg.stops[Math.floor(R() * cfg.stops.length)]);
    const y0 = d.top - 0.05 + ch / 2, y1 = d.yOcc - 1.5;
    const place = () => {
      const y = y0 + (y1 - y0) * mv.s;
      car.position.set(x, y, z + cd / 2 + 0.06);
      shell.color.copy(metal).lerp(dark, wall.darkAt(y) * 0.85);
    };
    place();
    car.userData.ambient = { kind: "lift", mover: mv, y0, y1 };
    g.add(tag(car, "lift"));
    env.group.add(tag(g, "liftShaft"));
    env.anims.push((t, dt) => { if (dt > 0) { mv.step(dt); place(); } });
  }
  /** 对面坑沿上远远的东西：电梯井口的矿井架、几座筒仓 / 小厂房、一根冒烟的烟囱（远景剪影的材质：远的偏向雾色） */
  function farRim(kit, env, wall, P, R, shafts) {
    const d = wall.d, M = env.mats(1);
    const at = (x, back) => { const z = wall.edgeAt(0, x).z - back; return { x, y: wall.landAt(z) - 0.02, z }; };
    const add = (o, p, what) => { o.position.set(p.x, p.y, p.z); env.group.add(tag(o, what)); return o; };
    shafts.forEach(x => add(kit.headframe(M, 1.3), at(x + 0.3, 0.5), "farHeadframe"));
    [[-0.85, "silos"], [-0.25, "shed"], [0.12, "silos"], [0.68, "shed"]].forEach(([u, what]) => {
      const x = d.cx + u * d.halfW + (R() - 0.5) * 2;
      add(what === "silos" ? kit.silos(M, 0.9 + R() * 0.5, 2 + Math.floor(R() * 2)) : kit.shed(M, 1.1 + R() * 0.8, 0.5 + R() * 0.3), at(x, 0.9 + R() * 0.6), "farRim");
    });
    const p = at(d.cx + 0.5 * d.halfW, 1.2), ch = kit.chimney(M, 1.9, 0.16);
    add(ch.group, p, "farRim");
    env.smoke(p.x, p.y + ch.top, p.z, 0.35);
    env.blinker(p.x, p.y + ch.top + 0.12, p.z, 0.4);
  }
  /** 矿外：战场后面往下陷的大矿坑。返回 groundEdge（坑边：地台外面那片地铺到这里为止） */
  function rimScene(kit, env, art, P, R, b) {
    const Q = PIT[art.pit], BD = art.backdrop, d = pitDims(Q, b, env.cam);
    const shafts = (BD.lifts || []).map(u => d.cx + u * d.halfW);
    const wall = pitWall(kit, env, Q, P, R, d, shafts);
    env.group.add(wall.mesh);
    rimLip(kit, env, P, R, d.rimZ);
    if (BD.rail) railing(kit, env, P, R, b, d.rimZ, null);
    pitLights(kit, env, wall, art, P, R, shafts);
    shafts.forEach((x, i) => lift(kit, env, wall, P, R, x, i));
    if (BD.farRim) farRim(kit, env, wall, P, R, shafts);
    return d.rimZ;
  }

  /* ---------- 远景：矿内（以前的一面台阶坑壁，下一步改）---------- */
  /**
   * 对面的坑壁：一级级台阶往下（第 k 级的台面在 top − k × step，台阶边在 edge + k × run，越往下越靠近这边），横着分 seg 段，
   * 每段的台阶边随机歪一点（quiet 那几处不歪：斜井的铁轨沿着它走）。拼成一个几何体，颜色按顶点给：
   * 一层层砂岩的颜色，台面亮、立面暗；最上面几级往天边的雾色靠，往下越来越黑。不吃场景的雾（雾会把坑底也抹亮），自己按远近调颜色。
   * 返回 { mesh, edgeAt(k, x) → { y, z }（第 k 级台阶边在 x 处的位置）, Q }
   */
  function benchWall(kit, env, Q, P, R, o) {
    const THREE = kit.THREE, n = Q.benches, seg = Q.seg, xs = [], ys = [], zs = [];
    for (let i = 0; i <= seg; i++) xs.push(env.x0 + (env.x1 - env.x0) * i / seg);
    const calm = (x) => ((o.quiet || []).some(q => Math.abs(x - q) < (env.x1 - env.x0) / seg + 0.2) ? 0 : 1);
    let edge = o.edge;
    for (let k = 0; k < n; k++) {
      if (k) edge += Q.run * ((Q.road || []).includes(k) ? Q.roadRun : 1);
      ys.push(xs.map(x => Q.top - k * Q.step + (R() - 0.5) * 2 * Q.jitter * calm(x)));
      zs.push(xs.map(x => edge + (R() - 0.5) * 2 * Q.jitter * calm(x)));
    }
    const mist = new THREE.Color(P.dark), haze = env.hazeOf(1).lerp(mist, Q.hazeDark || 0);
    const colorOf = (k, lit, v) => {
      const c = new THREE.Color(P.rock[k % P.rock.length]).multiplyScalar((lit ? 1.06 : 0.7) * v);
      c.lerp(haze, Q.haze * clamp(1 - k / Math.max(1, Q.dark[0] + 1), 0, 1));
      return c.lerp(mist, smooth(Q.dark[0], Q.dark[1], k));
    };
    const pos = [], col = [];
    const quad = (a, b, c, d, color) => [a, b, c, a, c, d].forEach(p => { pos.push(p[0], p[1], p[2]); col.push(color.r, color.g, color.b); });
    for (let i = 0; i < seg; i++) {
      const xa = xs[i], xb = xs[i + 1], v = 0.92 + R() * 0.16;
      // 最上面那级的台面：坑沿那片平地，往后铺到天幕前
      quad([xa, ys[0][i], o.back], [xa, ys[0][i], zs[0][i]], [xb, ys[0][i + 1], zs[0][i + 1]], [xb, ys[0][i + 1], o.back], colorOf(0, true, v));
      for (let k = 0; k < n; k++) {
        const yb = k + 1 < n ? ys[k + 1] : null, lo = (j) => (yb ? yb[j] : Q.bottom);
        quad([xa, ys[k][i], zs[k][i]], [xa, lo(i), zs[k][i]], [xb, lo(i + 1), zs[k][i + 1]], [xb, ys[k][i + 1], zs[k][i + 1]], colorOf(k, false, v));   // 立面
        if (yb) quad([xa, yb[i], zs[k][i]], [xa, yb[i], zs[k + 1][i]], [xb, yb[i + 1], zs[k + 1][i + 1]], [xb, yb[i + 1], zs[k][i + 1]], colorOf(k + 1, true, v));   // 下一级的台面
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mesh = tag(new THREE.Mesh(geo, env.keep(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0, fog: false }))), "pitWall");
    const edgeAt = (k, x) => {
      const kk = clamp(Math.round(k), 0, n - 1), t = clamp((x - env.x0) / (env.x1 - env.x0) * seg, 0, seg - 1e-6), i = Math.floor(t), f = t - i;
      return { y: ys[kk][i] + (ys[kk][i + 1] - ys[kk][i]) * f, z: zs[kk][i] + (zs[kk][i + 1] - zs[kk][i]) * f };
    };
    return { mesh, edgeAt, Q };
  }
  /** 这边的坑沿：地台外面那片地到这里为止，沿着断口一排半埋的碎石（盖住地面的直边），几个实例网格 */
  function rimLip(kit, env, P, R, rimZ) {
    const THREE = kit.THREE, x0 = env.x0 + 4, x1 = env.x1 - 4, groups = 3, list = [[], [], []];
    for (let x = x0; x < x1; x += 0.5 + R() * 0.45) list[Math.floor(R() * groups)].push(x);
    list.forEach((xs, gi) => {
      const geo = rockGeo(kit, 1, R, 0.7), m = new THREE.InstancedMesh(geo, env.keep(new THREE.MeshStandardMaterial({ color: P.rock[gi % P.rock.length], roughness: 1, flatShading: true })), xs.length);
      const o = new THREE.Object3D();
      xs.forEach((x, i) => {
        const s = 0.2 + R() * 0.2;
        o.position.set(x, L.CONFIG.groundY - s * 0.25, rimZ + (R() - 0.5) * 0.3); o.rotation.set((R() - 0.5) * 0.5, R() * 3, (R() - 0.5) * 0.5); o.scale.set(s * (1 + R() * 0.4), s * 0.75, s);
        o.updateMatrix(); m.setMatrixAt(i, o.matrix);
      });
      env.group.add(tag(m, "rimLip"));
    });
  }
  /** 坑边的栏杆：一根根柱子 + 上下两道横杆（锈铁），吊架那一段空出来 */
  function railing(kit, env, P, R, b, rimZ, skip) {
    const THREE = kit.THREE, mat = env.keep(new THREE.MeshStandardMaterial({ color: P.metal, roughness: 0.7, metalness: 0.4, flatShading: true }));
    const z = rimZ + 0.4, y0 = L.CONFIG.groundY, from = b.minX - 9, to = b.maxX + 9, posts = [];
    let run = null;
    const runs = [];
    for (let x = from; x <= to; x += 1.35) {
      if (skip && Math.abs(x - skip) < 1.6) { if (run) { runs.push(run); run = null; } continue; }
      posts.push(x);
      if (!run) run = [x, x]; else run[1] = x;
    }
    if (run) runs.push(run);
    const g = new THREE.Group(), pm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.6, 0.06), mat, posts.length), o = new THREE.Object3D();
    posts.forEach((x, i) => { o.position.set(x, y0 + 0.3, z + (R() - 0.5) * 0.06); o.rotation.set((R() - 0.5) * 0.12, 0, (R() - 0.5) * 0.12); o.updateMatrix(); pm.setMatrixAt(i, o.matrix); });
    g.add(pm);
    runs.forEach(([a, c]) => [0.55, 0.3].forEach(h => g.add(kit.put(new THREE.Mesh(new THREE.BoxGeometry(c - a, 0.035, 0.035), mat), (a + c) / 2, y0 + h, z))));
    env.group.add(tag(g, "rail"));
  }
  /** 矿内：坑壁上零星的灯，落在看得到的那几级台阶边上；一部分偶尔暗一下（AMBIENT.blink；减少动态效果时一直亮着） */
  function benchLights(kit, env, wall, art, P, R, b) {
    const THREE = kit.THREE, Q = wall.Q, BD = art.backdrop, mat = env.keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(P.lamp).multiplyScalar(2.6), toneMapped: false, fog: false }));
    const geo = new THREE.SphereGeometry(0.075, 6, 5), cfg = AMBIENT.blink;
    for (let i = 0; i < BD.lights; i++) {
      const k = 1 + Math.floor(R() * (Q.dark[1] - 1)), x = (b.minX - 14) + R() * (b.maxX - b.minX + 28), e = wall.edgeAt(k, x);
      const m = tag(kit.put(new THREE.Mesh(geo, mat), x, e.y + 0.07, e.z - 0.1), "pitLight");
      env.group.add(m);
      if (R() < BD.blink) {
        const beat = A.beat(A.rand(i * 59 + 3), cfg.every, cfg.dur);
        m.userData.ambient = { kind: "blink", beat };
        env.anims.push((t, dt) => { if (dt === 0) { m.visible = true; return; } m.visible = beat.step(dt) < 0; });
      }
    }
  }
  /** 斜井：沿着台阶边一路斜下去的两根铁轨，矿车时不时上下（AMBIENT.skip）；井口一座小矿井架。x = 斜井在哪（那一段的台阶边是直的） */
  function skipTrack(kit, env, wall, P, R, x, i) {
    const THREE = kit.THREE, Q = wall.Q, kEnd = Q.dark[1] + 3;
    const top = wall.edgeAt(0, x), bot = wall.edgeAt(kEnd, x);
    const dy = bot.y - top.y, dz = bot.z - top.z, len = Math.hypot(dy, dz), ang = Math.atan2(-dy, dz);
    const at = (s) => ({ y: top.y + dy * s + 0.06, z: top.z + dz * s + 0.04 });
    const mat = env.keep(new THREE.MeshStandardMaterial({ color: P.metal, roughness: 0.6, metalness: 0.5, flatShading: true, fog: false }));
    const g = new THREE.Group();
    [-0.11, 0.11].forEach(dx => { const m = kit.put(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, len), mat), x + dx, (top.y + bot.y) / 2 + 0.05, (top.z + bot.z) / 2 + 0.03); m.rotation.x = ang; g.add(m); });
    const car = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.15, 0.22), mat);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), env.keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(P.lamp).multiplyScalar(2.6), toneMapped: false, fog: false })));
    light.position.set(0, 0.05, 0.12); car.add(body, light); car.rotation.x = ang;
    const cfg = AMBIENT.skip, mv = A.mover(A.rand(i * 977 + 11), cfg, cfg.stops[Math.floor(R() * cfg.stops.length)]);
    const place = () => { const p = at(mv.s); car.position.set(x, p.y + 0.08, p.z); };
    place();
    car.userData.ambient = { kind: "skip", mover: mv, top, bot };
    g.add(tag(car, "skip"));
    env.group.add(tag(g, "skipTrack"));
    env.anims.push((t, dt) => { if (dt > 0) { mv.step(dt); place(); } });
  }

  /* ---------- 远景：矿内 ---------- */
  /** 运输道边上的挡车土埂：一排半埋的大石头（几个实例网格），上面立几个路锥 */
  function berm(kit, env, P, R, b, rimZ) {
    const THREE = kit.THREE, x0 = env.x0 + 4, x1 = env.x1 - 4, list = P.wall.map(() => []), y0 = L.CONFIG.groundY;
    for (let x = x0; x < x1; x += A.span(R, BERM.spacing)) list[Math.floor(R() * list.length)].push(x);
    const top = [];
    list.forEach((xs, gi) => {
      const m = new THREE.InstancedMesh(rockGeo(kit, 1, R, 0.8), env.keep(new THREE.MeshStandardMaterial({ color: P.wall[gi], roughness: 1, flatShading: true })), xs.length), o = new THREE.Object3D();
      xs.forEach((x, i) => {
        const s = A.span(R, BERM.size);
        o.position.set(x, y0 + s * 0.15, rimZ + 0.1 + (R() - 0.5) * 0.25); o.rotation.set((R() - 0.5) * 0.4, R() * 3, (R() - 0.5) * 0.4); o.scale.set(s * (1 + R() * 0.3), s * 0.8, s);
        o.updateMatrix(); m.setMatrixAt(i, o.matrix);
        if (x > b.minX - 6 && x < b.maxX + 6) top.push({ x, y: y0 + s * 0.85 });
      });
      env.group.add(tag(m, "berm"));
    });
    // 路锥：橘色的锥 + 一道白反光带，立在土埂上（挑几块石头顶上）
    const cm = env.keep(new THREE.MeshStandardMaterial({ color: P.cone, roughness: 0.6, flatShading: true })), wm = env.keep(new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4, flatShading: true }));
    A.pick(top, BERM.cones, R, 2.5).forEach(p => {
      const c = new THREE.Group();
      c.add(kit.put(new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 8), cm), 0, 0.15, 0));
      c.add(kit.put(new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.062, 0.05, 8), wm), 0, 0.15, 0));
      c.position.set(p.x, p.y - 0.05, rimZ + 0.1);
      env.group.add(tag(c, "cone"));
    });
  }
  /** 近处岩石堆成的不规则的墙：左右各一段（开口那头矮、往外越来越高），中间留一个大开口看得到对面的坑壁。
   *  一堆一堆从坑里立起来（底下被坑边挡住），每堆上面再压一两块小一点的，顶上参差不齐；整个在坑边后面（灯后面） */
  function rockWalls(kit, env, P, R, b, rimZ, W) {
    const THREE = kit.THREE, y0 = -8;
    const mats = P.wall.map(c => env.keep(new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true })));
    [-1, 1].forEach(side => {
      const g = new THREE.Group(), inner = env.cx + side * env.hx * W.gap, outer = env.cx + side * (env.hx + W.reach);
      for (let i = 0; i < W.columns; i++) {
        const t = i / (W.columns - 1), sx = 1.1 + R() * 1.3, sz = 0.8 + R() * 0.8;
        const x = inner + (outer - inner) * t + side * sx * 0.6 + (R() - 0.5) * 0.8, z = rimZ - 0.2 - sz - R() * W.depth;
        const top = env.topY(z) * (W.h[0] + (W.h[1] - W.h[0]) * Math.pow(t, 0.6)) * (0.85 + R() * 0.25);
        const base = new THREE.Mesh(rockGeo(kit, 1, R, 1), mats[i % mats.length]);
        base.scale.set(sx, (top - y0) / 2, sz); base.position.set(x, (top + y0) / 2, z); base.rotation.y = (R() - 0.5) * 0.8;
        g.add(base);
        for (let k = 0, y = top * (0.75 + R() * 0.1); k < 1 + Math.floor(R() * 2); k++) {   // 顶上压着的石头
          const s = sx * (0.45 + R() * 0.3), m = new THREE.Mesh(rockGeo(kit, 1, R, 0.8), mats[(i + k + 1) % mats.length]);
          m.scale.set(s, s * (0.7 + R() * 0.6), Math.min(sz, s)); m.position.set(x + (R() - 0.5) * sx, y, z - R() * 0.3); m.rotation.y = R() * 3;
          g.add(m); y += s * 0.6;
        }
      }
      env.group.add(tag(g, "rockWall"));
    });
  }
  /** 前景的石头：战场前沿再往前、左右两边各几块，镜头前面框住画面的两个下角（近景里景深把它们糊掉） */
  function foreRocks(kit, env, P, R, b, F) {
    const THREE = kit.THREE;
    for (let i = 0; i < F.n; i++) {
      const side = i % 2 ? 1 : -1, s = A.span(R, F.size);
      const x = env.cx + side * env.hx * A.span(R, F.span), z = b.maxZ + s + A.span(R, F.front);
      const m = new THREE.Mesh(rockGeo(kit, s, R, F.squash), env.keep(new THREE.MeshStandardMaterial({ color: P.wall[i % P.wall.length], roughness: 1, flatShading: true })));
      m.position.set(x, L.CONFIG.groundY + s * 0.25, z); m.rotation.y = R() * 3;
      env.group.add(tag(m, "foreRock"));
    }
  }
  /** 矿内：站在坑壁半腰的运输道上。运输道的边（地台外面那片地到这里为止）一排挡车土埂；坑那头远远的对面坑壁一级级台阶，
   *  往上出了画面、往下越来越黑（坑底更黑）；左右后方岩石堆成的墙，中间的大开口看得到对面；前景几块大石头。返回 groundEdge */
  function midScene(kit, env, art, P, R, b) {
    const Q = PIT[art.pit], BD = art.backdrop;
    const rimZ = b.minZ - L.CONFIG.lamps.back - Q.rim;
    const quiet = (BD.skips || []).map(u => env.cx + u * (env.hx + 6));
    const wall = benchWall(kit, env, Q, P, R, { back: env.skyZ + Q.back, edge: env.skyZ + Q.far, quiet });
    env.group.add(wall.mesh);
    if (BD.berm) berm(kit, env, P, R, b, rimZ);
    if (BD.walls) rockWalls(kit, env, P, R, b, rimZ, WALLS[BD.walls]);
    if (BD.fore) foreRocks(kit, env, P, R, b, FORE[BD.fore]);
    benchLights(kit, env, wall, art, P, R, b);
    quiet.forEach((x, i) => skipTrack(kit, env, wall, P, R, x, i));
    return rimZ;
  }

  /* ---------- 挂钩：远景 ---------- */
  /** 天边画的远景：矿外用以前采矿场的那条（远处的厂区 + 坑壁），在对面坑沿后面露出来；矿内被对面的坑壁整个挡住，用以前的 */
  function band(kit, colors, seed, a) {
    return a.art.depth === "rim" ? kit.bandTexture("mine", colors, seed) : null;
  }
  /** 中景、矿坑、战场周围的装饰、环境动画（hd2d-backdrop.js · buildBackdrop 交过来）：返回 { groundEdge } */
  function backdrop(kit, env, a) {
    const art = a.art, P = PALETTE[art.palette], b = boundsOf(env), R = A.rand(seedOf(a.key) + Math.round(env.hx * 10) + Math.round(env.hz * 7));
    if (art.depth === "rim") return { groundEdge: rimScene(kit, env, art, P, R, b) };
    if (art.depth === "mid") return { groundEdge: midScene(kit, env, art, P, R, b) };
    return {};
  }
  /** 天幕挪到多远（hd2d-backdrop.js 建天幕前问）：大矿坑的天幕在对面坑沿后面 PIT.sky；别的场景照旧（null） */
  function skyGap(bounds, cam, a) {
    return a.art.depth === "rim" ? pitDims(PIT[a.art.pit], bounds, cam).sky : null;
  }

  const pack = { name: "mine", scenes: SCENES, grounds: GROUNDS, art: ART, textures: TEXTURES, decals: DECALS, zone, band, backdrop, skyGap };
  A.add(pack);
  return Object.assign({ PALETTE, PIT, LIFT, WALLS, BERM, FORE, AMBIENT, zonePlan, seedOf, pitDims }, pack);
});
