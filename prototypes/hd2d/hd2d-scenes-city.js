/* Antlerscale: Backfire · HD-2D 战场原型 · 区域场景的美术包：城市类（#241）
 *
 * 主人试玩反馈 · 四：外城区、巨人城、天网设施、下水道各一套美术（地面、地台侧面、装饰、远景、光照 / 调色）。数值都在下面的配置表里。
 * 怎么接进画面见 hd2d-scene-art.js（#242 的登记处）：这里不 import three.js，three.js 和画贴图 / 拼几何体的小工具由挂钩那边打包成 kit 传进来。
 *
 *   外城区 street：黄沙上的贫民窟。地面是黄沙（车辙、脚印、零碎的垃圾），地台侧面是一块块拼起来的瓦楞铁皮；
 *                  地台上零星的油桶、旧轮胎；战场后面、左右两边一圈矮房子和铁皮棚屋（不挡战场）；
 *                  再远处横穿整个画面的大管道（架在支架上、一道道法兰、几盏红灯），最后面一道沙岩悬崖（左右两边的更高，像峡谷）
 *   下水道 tunnel：巨大圆管的里面（只画后半边，像剖开的模型）：管壁从灯后面往后往上弯过竖直，比画面上沿高，看不到天；
 *                  一段段混凝土、水位线、接缝，管壁上几盏灯（照亮的那一圈另外叠一层）、沿壁的管子；地上铺满污水（贴图在流），
 *                  地台是湿的混凝土板；光照不分白天黑夜、很暗
 *
 * 地台上的装饰只摆在左右两条边带和左右矮一截的台子上（站位区以外，见 hd2d-scene-art.js · zoneSpots），不压住站位、铭牌；
 * 战场周围的东西都在战场范围外面（后面先让开灯，hd2d-scene-art.js · around）。只读布局给的地台 / 战场范围，不碰单位数据（没有坚毅生命）。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./hd2d-layout.js"), require("./hd2d-scene-art.js"));
  else root.HD2DScenesCity = factory(root.HD2DLayout, root.HD2DSceneArt);
})(typeof self !== "undefined" ? self : this, function (L, A) {
  "use strict";

  /* ---------- 配置 ---------- */
  /** 各区域的色调：sheet 铁皮（锈褐、镀锌灰、红锈、褪色的青、土黄……轮着用）、wall 矮房子的土坯 / 砖墙、roof 屋顶、dark 门洞 / 窗洞、
   *  barrel 油桶的漆色、tire 轮胎 */
  const PALETTE = {
    street: {
      sheet: [0x8c6a4e, 0x7c7e7a, 0x9c5c3c, 0x6c8482, 0xa58e66, 0x84563e],
      wall: [0xbf9f74, 0xa88c6a, 0xcaa97c, 0x9e8566],
      roof: [0x6a5644, 0x7c7066, 0x5c4a3c, 0x8a6248],
      dark: 0x1e1712, barrel: [0x3f6a8a, 0x9a3a2a, 0xc8962e, 0x5a6a4a], tire: 0x24201c
    },
    tunnel: {
      barrel: [0x4a5a3a, 0x6a4a32, 0x3c4a4a], tire: 0x1c1e1a, pipe: 0x4a3c30, wheel: 0x8a3a26
    }
  };
  /** 下水道 tunnel：在一根巨大的圆管里面。只画后面那半边（像剖开的模型，镜头从剖开的那边看进去）：管底就是地面，
   *  管壁从灯后面 gap 处开始往后、往上弯，过了竖直再往头顶弯过来成拱顶（arc 弧度），比画面上沿高得多，看不到天；天幕和天边那条远景也收起来。
   *  （默认镜头俯角 30°、视角 22°：管壁在画面里只露出离地两三到六的那一截，近景几乎只看得到地面。所以「弧形」靠这一截上的灯带、接缝、铆钉和水面的倒影看出来；
   *   拱顶在镜头往上转时才看得到。拱顶弯到 arc 为止：再往前弯，镜头就看到管壁的外面了）
   *   r          管子的半径（世界单位；还要让弯到竖直的那一截在天幕前面，放不下就小一点）
   *   seg / rows 横着几段、沿弧几段；wall 管壁混凝土的颜色（一段段轮着）；glow 管壁自己发的一点光（昏暗里也看得出形状）
   *   joint      每隔 every 一道接缝（宽 w，颜色 × dark）；rivet 接缝两边各一排铆钉（沿弧每隔 step 一颗，半径 r、颜色）
   *   rings      灯带：每隔 each 道接缝，接缝上一圈沿着管壁的灯带（宽 w，颜色 × gain，泛光会抓到）；照亮两边的管壁（spread 以内，最亮加 level 的灯色）
   *   stain      水位线：离地 h 以下颜色 × dark、往 tint（泡过污水的绿褐）靠
   *   lamps      管壁上 n 盏灯：离地 h；照亮的那一圈 reach 大，另外叠一层加色的网格（最亮加 gain × 0.18 的灯色，不受场景光照影响）；
   *              前 blink 盏会闪（AMBIENT.flicker）
   *   pipes      沿管壁横着走的管子 / 电缆：离地 h、半径 r、颜色
   *   water      地上的污水：比地面高 y，贴图往左流 speed（每秒走多少世界单位），颜色；
   *              streak 水面上一道道顺着流向的亮纹（另一层，比污水快 fast 倍：两层流速不同，看得出在流）；
   *              shine 灯带、壁灯在水面上的倒影：一条条往前伸 len、宽 w 的亮纹（亮度 level，贴图晃动着往左流 speed） */
  const TUNNEL = {
    r: 8.6, gap: 0.6, arc: 2.55, seg: 96, rows: 34,
    wall: [0x6c776c, 0x637066, 0x737d72], glow: 0x10160f,
    joint: { every: 4.2, w: 0.35, dark: 0.55, rivet: { step: 0.5, r: 0.055, color: 0xa4ac98 } },
    rings: { each: 2, w: 0.16, color: 0xd8f0a8, gain: 2.4, spread: 1.5, level: 0.2 },
    stain: { h: 1.2, dark: 0.62, tint: 0x3a4628 },
    lamps: { n: 6, h: 2.7, reach: 3.4, gain: 2.2, color: 0xe4f0a8, blink: 1 },
    pipes: [{ h: 1.6, r: 0.17, color: 0x4a3a2e }, { h: 2.05, r: 0.08, color: 0x2a3032 }, { h: 3.6, r: 0.26, color: 0x50463a }],
    water: {
      y: 0.04, speed: 0.35, color: 0x5f6a44,
      streak: { fast: 2.2, opacity: 0.55 },
      shine: { len: 6.5, w: 0.9, level: 0.5, speed: 0.6 }
    },
    // 排污口：管壁上伸出来一截横着的管子（u 横向位置 × 战场半宽，离地 h，半径 r），污水从管口往下流进地上的污水里（fall 每秒往下走多少）
    outfall: { u: 0.55, h: 1.7, r: 0.55, fall: 1.2, color: 0x6a7048 }
  };
  /** 环境动画的频率（秒）：flicker 管壁上会闪的灯隔多久闪一下、每次暗多久。减少动态效果时灯一直亮着、污水不流 */
  const AMBIENT = { flicker: { every: [1.5, 5], dur: [0.06, 0.25] } };
  /** 战场周围的贫民窟（hd2d-scene-art.js · around 给的范围外面，margin 是再让开多少）：
   *   rows     后面几排：每排离「后面最近到哪」再往后 gap，横着每隔 step（± jitter 成）一间，往左右各伸出战场半宽 + reach
   *   side     左右两边各几列：每列离「左右最近到哪」再往外 gap，从后面一直排到战场前后的正中（不排到前面，不挡人）
   *   shack / house   铁皮棚屋 / 矮房子的宽、高、深的范围（世界单位）；house = 几成是矮房子（其余是铁皮棚屋） */
  const SLUM = {
    margin: { back: 0.5, side: 0.9 },
    rows: [{ gap: 0, step: 1.7, jitter: 0.25 }, { gap: 2.0, step: 2.0, jitter: 0.3 }],
    reach: 8,
    side: [{ gap: 0, step: 1.8 }, { gap: 2.1, step: 2.1 }],
    shack: { w: [1.0, 1.5], h: [0.75, 1.05], d: [0.8, 1.1] },
    house: { w: [1.3, 2.0], h: [0.95, 1.4], d: [1.0, 1.4] },
    houses: 0.4,
    lit: { day: 0, dusk: 0.3, night: 0.55 },   // 几成的门洞 / 窗洞透出暖光（自己发光，泛光会抓到）；glow 光的颜色
    glow: 0xffb060,
    flue: 0.35                                 // 几成的棚屋顶上插一根烟囱管
  };
  /** 一间棚屋 / 矮房子的样子（× 这一间的宽 / 进深 / 高）：roof 屋顶比墙宽多少、深多少，lean 屋顶往门那边挪多少，eave 中心离门前那条线至少多远
   *  （= 屋顶伸出去的那一截：roof.d / 2 + lean，再留一点），door / win 门洞、窗洞的宽高 */
  const HUT = { roof: { w: 1.14, d: 1.3 }, lean: 0.06, eave: 0.75, tilt: { shack: 0.16, house: 0.05 }, door: [0.26, 0.62], win: [0.18, 0.2] };
  /** 贫民窟后面、再远处（都在天幕前面，离天幕 sky 远；高度 × 那里「画面上沿那条视线」能放多高 hmax）：
   *   pipes   横穿整个画面的大管道（几根）：sky 离天幕多远、r 半径（× hmax，至少 min）、y 管中心多高（× hmax，至少 2.4 个半径：支架露得出来）、
   *           k 远近（0–1，越远越偏雾色）；
   *           每隔 flange 一道法兰、每隔 legs 一副支架；warn 几盏一闪一闪的红灯
   *   cliff   沙岩悬崖：一段段（宽 w）一层层沙岩叠起来（layers 层，越往上越往里收 inset），高 h（× hmax），离天幕 sky、厚 d；
   *           wings 左右两边的高多少倍（像夹着这片贫民窟的峡谷），reach 往战场左右各铺出去多宽 */
  const FAR = {
    pipes: [{ sky: 3.4, r: 0.13, min: 0.5, y: 0.36, k: 0.55 }, { sky: 2.5, r: 0.085, min: 0.34, y: 0.22, k: 0.7 }],
    flange: 2.6, legs: 4.4, warn: 3,
    cliff: { sky: 1.25, d: 1.1, w: [2.4, 4.6], h: [0.5, 0.82], layers: [3, 5], inset: 0.08, wings: 1.3, reach: 26 }
  };
  /** 每个场景（键 = 地面主题）：
   *   palette   PALETTE 的哪一套
   *   decor     地台上的装饰：band 左右边带上几个、ledge 台子上几个、size 半径范围、kinds 摆什么（barrel 油桶、tire 旧轮胎、valve 阀门），轮着挑
   *   backdrop  远景：slum 战场周围的贫民窟（SLUM）、pipes 远处的大管道 / cliffs 沙岩悬崖（FAR）、tunnel 下水道的圆管（TUNNEL）、
   *             band 天边画的远景用哪种（bandTexture 的 kind；null = 用以前的）
   *   light     光照 / 调色（写法见 hd2d-scene-art.js · lighting） */
  const ART = {
    outer_street: {
      palette: "street",
      decor: { band: 3, ledge: 2, size: [0.16, 0.22], kinds: ["barrel", "barrel", "tire"] },
      backdrop: { slum: true, pipes: true, cliffs: true, band: "desert" },
      // 黄沙反上来的暖光、带沙尘的雾；白天天色偏土黄，夜里棚屋透出暖光（SLUM.lit），路灯亮一点
      light: {
        all: { tint: { fog: [0xd8b47a, 0.25], hemiGround: [0xb08850, 0.35] } },
        day: { tint: { sky: [0xe8cf98, 0.18] }, grade: { temp: [1.06, 1.0, 0.9] } },
        dusk: { tint: { fog: [0xd0905a, 0.12] } },
        night: { tint: { hemiGround: [0x3a2c20, 0.3] }, scale: { lamp: 1.15 } }
      }
    },
    sewer_tunnel: {
      palette: "tunnel",
      decor: { band: 3, ledge: 2, size: [0.15, 0.2], kinds: ["valve", "barrel", "tire"] },
      backdrop: { tunnel: true, band: null },
      // 管子里：不分白天黑夜（按夜晚画、光照固定），天是黑的（反正被管壁挡住）；环境光、主光压暗，偏一点污水的黄绿，灯更亮；调色更闷、暗角更重。
      // 截图验收（主人：「远景、近景都太暗」）：环境光、主光比上一版亮一点，暗角轻一点（整体还是昏暗，结构靠灯带、铆钉、倒影看清）
      light: {
        fixed: "night",
        all: {
          set: { sky: ["#141a15", "#0e130f", "#090c0a", "#050706"], fog: 0x121a11, ground: 0x2e362e, hemiSky: 0x9fb09a, hemiGround: 0x283022, sun: 0xd8e8b0, rim: 0xb8d0a0 },
          scale: { hemi: 1.1, sunI: 0.72, rimI: 0.75, lamp: 1.4 },
          grade: { temp: [0.97, 1.02, 0.93], sat: 0.94, contrast: 1.1, vignette: 0.42 }
        }
      }
    }
  };
  /** 地面主题（并进布局的 GROUNDS，写法同 hd2d-layout.js 的 GROUNDS）：顶面 / 侧面贴图是这里画的（art 开头），backdrop 指回这一套 */
  const GROUNDS = {
    outer_street: {   // 外城区：黄沙地（车辙、脚印、零碎的垃圾），侧面拼起来的瓦楞铁皮；地台外面是沙地；路灯
      tex: "artSlumSand", tint: 0xffffff, side: "artSlumSheet", decals: { ripple: 3, gravel: 2, oil: 1 },
      pebbles: 12, pebble: 0xa08058, rock: 0x8c7052, decor: "sand", ground: 0xc29a62, backdrop: "outer_street",
      lamps: { kind: "street", color: 0xffc98a, day: 1, dusk: 2, night: 2 }
    },
    sewer_tunnel: {   // 下水道：湿的混凝土板（青苔、污渍），侧面泡过水的混凝土；积水贴花；地台外面是污水（远景铺的）；两盏吊灯
      tex: "artSewerSlab", tint: 0xffffff, rough: 0.5, side: "artSewerSide", decals: { puddle: 3, crack: 2 },
      pebbles: 6, pebble: 0x4c5248, rock: 0x464c42, decor: "art", ground: 0x2a312a, backdrop: "sewer_tunnel",
      lamps: { kind: "hanging", color: 0xe4f0a8, day: 2, dusk: 2, night: 2 }
    }
  };
  /** 区域 → 场景 id（world-data.js · BATTLE_SCENES）→ 地面主题 */
  const SCENES = {
    "外城区": { street: "outer_street" },
    "下水道": { tunnel: "sewer_tunnel" }
  };

  /* ---------- 小工具 ---------- */
  /** 字符串 → 种子（同一个场景每次一样） */
  const seedOf = (s) => { let h = 11; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 100003; };
  const named = (t, name) => { t.name = name; return t; };
  /** 战场范围（远景的 env 给的是中心和半宽） */
  const boundsOf = (env) => ({ minX: env.cx - env.hx, maxX: env.cx + env.hx, minZ: env.cz - env.hz, maxZ: env.cz + env.hz });
  /** 关掉阴影、打上标签（测试按 userData.art 认是什么） */
  function tag(o, what) {
    o.userData.art = what;
    o.traverse(m => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
    return o;
  }
  /** 远景用的 canvas 贴图（远景的小工具里没有 canvasTex：在这里画，交给 env.keep 一起清） */
  function farTex(kit, env, size, draw, seed) {
    const THREE = kit.THREE, c = document.createElement("canvas");
    c.width = c.height = size;
    draw(c.getContext("2d"), size, kit.rng(seed));
    const t = env.keep(new THREE.CanvasTexture(c));
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
    return t;
  }
  const hex = (n) => "#" + (n >>> 0).toString(16).padStart(6, "0");

  /* ---------- 贴图（canvas 程序贴图，没有图片文件）---------- */
  /** 一张美术包的贴图：kit.canvasTex 画（按名字缓存），贴图的 name 就是它在包里的名字（测试按它认） */
  const paint = (name, size, draw, opt) => (kit) => named(kit.canvasTex("art-" + name, size, (g, s, r) => draw(g, s, r, kit), opt), name);
  /** 瓦楞铁皮：竖着一块块（宽窄、颜色不一），一道道楞（亮暗相间），上沿往下流的锈迹，接缝的阴影和一排铆钉。顶面、侧面、远景的棚屋都用它 */
  function drawSheet(g, s, r, cols) {
    let x = 0;
    while (x < s) {
      let w = Math.round(s * (0.18 + r() * 0.2));
      if (s - x - w < s * 0.12) w = s - x;
      g.fillStyle = cols[Math.floor(r() * cols.length)]; g.fillRect(x, 0, w, s);
      const off = Math.round((r() - 0.5) * s * 0.3);   // 这块铁皮上下错开一点，横缝不齐
      for (let k = x + 2; k < x + w; k += 5) {
        g.fillStyle = "rgba(255,240,220,.16)"; g.fillRect(k, 0, 1.5, s);
        g.fillStyle = "rgba(20,12,6,.22)"; g.fillRect(k + 2.5, 0, 1.5, s);
      }
      for (let k = 0; k < 3; k++) {   // 锈迹：从上沿 / 钉眼往下流
        const rx = x + r() * w, len = s * (0.2 + r() * 0.5), grd = g.createLinearGradient(0, 0, 0, len);
        grd.addColorStop(0, "rgba(120,52,20,.55)"); grd.addColorStop(1, "rgba(120,52,20,0)");
        g.fillStyle = grd; g.fillRect(rx, 0, 2 + r() * 5, len);
      }
      g.fillStyle = "rgba(18,10,6,.5)"; g.fillRect(x, 0, 2, s);                     // 接缝
      g.fillStyle = "rgba(18,10,6,.35)"; g.fillRect(x, (s / 2 + off + s) % s, w, 2);   // 横缝
      g.fillStyle = "rgba(230,220,200,.6)";
      for (let y = 4; y < s; y += s / 4) g.fillRect(x + 3, y, 2, 2);                // 铆钉
      x += w;
    }
  }
  const TEXTURES = {
    /** 黄沙地（外城区）：黄沙底、深浅不一的几片，风吹的沙纹，一道车辙（左右首尾相接）、一串脚印，零碎的垃圾（锈铁片、瓶盖、压扁的纸箱）和碎石 */
    artSlumSand: paint("artSlumSand", 256, (g, s, r, kit) => {
      g.fillStyle = "#d2aa6a"; g.fillRect(0, 0, s, s);
      for (let k = 0; k < 14; k++) {
        const x = r() * s, y = r() * s, rad = 20 + r() * 50, grd = g.createRadialGradient(x, y, 0, x, y, rad);
        const c = r() < 0.5 ? "226,190,128" : "176,136,82";
        grd.addColorStop(0, `rgba(${c},.35)`); grd.addColorStop(1, `rgba(${c},0)`);
        [-s, 0, s].forEach(dx => [-s, 0, s].forEach(dy => { g.fillStyle = grd; g.save(); g.translate(dx, dy); g.fillRect(x - rad, y - rad, rad * 2, rad * 2); g.restore(); }));
      }
      kit.speckle(g, s, r, 2600, "rgba(255,236,196,.2)", "rgba(110,76,36,.2)");
      g.lineWidth = 1.2;
      for (let k = 0; k < 9; k++) {   // 沙纹：横着的波浪线（周期 = 贴图宽，左右接得上）
        const y0 = r() * s, a = 2 + r() * 3, ph = r() * 7;
        g.strokeStyle = k % 2 ? "rgba(140,100,52,.22)" : "rgba(255,236,190,.22)";
        g.beginPath();
        for (let x = 0; x <= s; x += 4) g.lineTo(x, y0 + Math.sin(x / s * Math.PI * 4 + ph) * a);
        g.stroke();
      }
      const ty = s * 0.68;   // 车辙：两道压实的深色带子 + 一格格胎纹
      [0, 22].forEach(dy => {
        for (let x = 0; x < s; x += 3) {
          const y = ty + dy + Math.sin(x / s * Math.PI * 2) * 10;
          g.fillStyle = "rgba(120,86,46,.32)"; g.fillRect(x, y, 3, 9);
          if (x % 9 === 0) { g.fillStyle = "rgba(90,60,30,.3)"; g.fillRect(x, y + 1, 2, 7); }
        }
      });
      for (let k = 0; k < 7; k++) {   // 一串脚印
        const x = s * 0.15 + k * 18, y = s * 0.28 + (k % 2) * 8 + k * 5;
        g.fillStyle = "rgba(120,84,44,.35)"; g.beginPath(); g.ellipse(x, y, 3, 5.5, 0.5, 0, 7); g.fill();
      }
      for (let k = 0; k < 5; k++) {   // 锈铁片
        g.save(); g.translate(r() * s, r() * s); g.rotate(r() * 3);
        g.fillStyle = ["#7a4a2a", "#8a6a4a", "#5a6a6a"][k % 3]; g.fillRect(-6, -3, 10 + r() * 8, 5 + r() * 4);
        g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(-6, 2, 12, 1.5);
        g.restore();
      }
      for (let k = 0; k < 10; k++) { g.fillStyle = r() < 0.5 ? "#b8b0a0" : "#a84a30"; g.beginPath(); g.arc(r() * s, r() * s, 1.6, 0, 7); g.fill(); }   // 瓶盖
      g.save(); g.translate(s * 0.78, s * 0.2); g.rotate(0.4);   // 压扁的纸箱
      g.fillStyle = "#b08e62"; g.fillRect(-14, -9, 28, 18); g.strokeStyle = "rgba(80,56,30,.5)"; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -9); g.lineTo(0, 9); g.stroke();
      g.restore();
      for (let k = 0; k < 4; k++) kit.gravel(g, r, r() * s, r() * s, 5 + r() * 6, 6 + Math.floor(r() * 6));
    }),
    /** 地台侧面（外城区）：拼起来的瓦楞铁皮 */
    artSlumSheet: paint("artSlumSheet", 128, (g, s, r) => drawSheet(g, s, r, ["#8c6a4e", "#7c7e7a", "#9c5c3c", "#6c8482", "#a58e66", "#84563e"])),
    /** 湿的混凝土板（下水道）：一块块方板（颜色深浅不一、接缝发黑），湿的地方更深、反一点光，接缝和角落长青苔，零星的污渍和裂缝 */
    artSewerSlab: paint("artSewerSlab", 256, (g, s, r, kit) => {
      const n = 4, w = s / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const v = 92 + Math.floor(r() * 22);
        g.fillStyle = `rgb(${v - 6},${v},${v - 8})`; g.fillRect(i * w, j * w, w, w);
      }
      for (let k = 0; k < 9; k++) {   // 湿的一片片（更深）
        const x = r() * s, y = r() * s, rad = 16 + r() * 40, grd = g.createRadialGradient(x, y, 0, x, y, rad);
        grd.addColorStop(0, "rgba(30,38,30,.45)"); grd.addColorStop(1, "rgba(30,38,30,0)");
        g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      kit.speckle(g, s, r, 2400, "rgba(200,210,190,.12)", "rgba(20,26,18,.25)");
      g.fillStyle = "rgba(14,18,12,.75)";   // 接缝
      for (let i = 0; i <= n; i++) { g.fillRect(i * w - 2, 0, 4, s); g.fillRect(0, i * w - 2, s, 4); }
      g.fillStyle = "rgba(70,96,40,.45)";   // 接缝里的青苔
      for (let k = 0; k < 60; k++) { const i = Math.floor(r() * (n + 1)), t = r() * s, horiz = r() < 0.5; g.fillRect(horiz ? t : i * w - 3, horiz ? i * w - 3 : t, 3 + r() * 6, 3 + r() * 6); }
      g.strokeStyle = "rgba(16,20,14,.55)";
      for (let k = 0; k < 4; k++) kit.crack(g, r, r() * s, r() * s, 5 + Math.floor(r() * 6), 1.2, 1);
      for (let k = 0; k < 5; k++) { g.fillStyle = "rgba(60,48,26,.3)"; g.beginPath(); g.ellipse(r() * s, r() * s, 6 + r() * 14, 4 + r() * 8, r() * 3, 0, 7); g.fill(); }   // 污渍
    }),
    /** 地台侧面（下水道）：泡过水的混凝土——横着几道水位线（下面更深更绿），往下流的水渍、青苔，零星露出的砖 */
    artSewerSide: paint("artSewerSide", 128, (g, s, r, kit) => {
      const grd = g.createLinearGradient(0, 0, 0, s);
      grd.addColorStop(0, "#6c7468"); grd.addColorStop(0.55, "#59625a"); grd.addColorStop(1, "#3a4636");
      g.fillStyle = grd; g.fillRect(0, 0, s, s);
      kit.speckle(g, s, r, 900, "rgba(210,220,200,.1)", "rgba(16,22,14,.25)");
      [0.58, 0.72, 0.86].forEach((k, i) => { g.fillStyle = `rgba(40,52,26,${0.25 + i * 0.1})`; g.fillRect(0, s * k, s, 2 + i); });   // 水位线
      for (let k = 0; k < 10; k++) {   // 往下流的水渍
        const x = r() * s, len = s * (0.2 + r() * 0.5), y = r() * s * 0.4, w = 2 + r() * 4, gg = g.createLinearGradient(0, y, 0, y + len);
        gg.addColorStop(0, "rgba(24,30,20,.45)"); gg.addColorStop(1, "rgba(24,30,20,0)");
        g.fillStyle = gg; g.fillRect(x, y, w, len);
      }
      g.fillStyle = "rgba(80,110,46,.5)";   // 青苔（下半截多）
      for (let k = 0; k < 50; k++) { const y = s * (0.6 + Math.pow(r(), 0.6) * 0.4); g.fillRect(r() * s, y, 2 + r() * 5, 2 + r() * 4); }
      g.strokeStyle = "rgba(20,24,18,.35)"; g.lineWidth = 1;   // 露出的砖
      const bx = r() * s * 0.6, by = s * (0.15 + r() * 0.25);
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) g.strokeRect(bx + x * 14 + (y % 2) * 7, by + y * 8, 14, 8);
    })
  };
  /** 贴花（写法同 hd2d-world.js 的 DECALS）：这一版都用 hd2d-world.js 里现成的（沙纹、碎石、油渍） */
  const DECALS = {};

  /* ---------- 地台上的装饰 ---------- */
  /**
   * 一块地台上摆什么、摆在哪（纯函数，测试用同一份）：左右边带上 decor.band 个、左右的台子上 decor.ledge 个（hd2d-scene-art.js · zoneSpots），
   * 两两隔开。返回 [{ kind, x, z, y（摆在多高的台面上）, size（半径）, on }]（局部坐标）
   */
  function zonePlan(z, key) {
    const art = ART[key];
    if (!art) return [];
    const D = art.decor, R = A.rand(z.id * 977 + seedOf(key)), spots = A.zoneSpots(z, D.size[0]);
    const band = A.pick(spots.filter(s => s.on === "band"), D.band, R, 1.2);
    const ledge = A.pick(spots.filter(s => s.on === "ledge"), D.ledge, R, 0.8);
    // 台子在外轮廓外面，但外轮廓往里凹的地方台子离站位区也近：装饰再小一点，横着离站位区至少 foot + 半径
    const room = (s) => Math.abs(s.x) - (z.w / 2 - L.CONFIG.pad) - A.SPOT.foot;
    return band.concat(ledge).map((s, i) => ({ kind: D.kinds[(i + z.id) % D.kinds.length], x: s.x, z: s.z, y: s.y, size: Math.min(A.span(R, D.size), s.r, room(s)), on: s.on }))
      .filter(d => d.size >= D.size[0] * 0.75);
  }
  /** 一个油桶（半径 rad）：桶身 + 两道箍 + 桶盖，漆色掉了一半 */
  function barrel(kit, rad, col) {
    const THREE = kit.THREE, g = new THREE.Group(), h = rad * 2.6;
    g.add(kit.mesh(new THREE.CylinderGeometry(rad, rad, h, 10), kit.mat("art-barrel-" + col, col, { roughness: 0.75, metalness: 0.3 }), 0, h / 2, 0));
    [0.3, 0.7].forEach(k => g.add(kit.mesh(new THREE.CylinderGeometry(rad * 1.04, rad * 1.04, h * 0.05, 10), kit.mat("art-barrel-ring", 0x3a2e26, { roughness: 0.6, metalness: 0.5 }), 0, h * k, 0)));
    g.add(kit.mesh(new THREE.CylinderGeometry(rad * 0.98, rad * 0.98, 0.012, 10), kit.mat("art-barrel-lid", 0x4a3c30, { roughness: 0.7, metalness: 0.4 }), 0, h + 0.006, 0));
    return g;
  }
  /** 一个平躺着的旧轮胎（外半径 rad） */
  function tire(kit, rad, col) {
    const THREE = kit.THREE, m = kit.mesh(new THREE.TorusGeometry(rad * 0.72, rad * 0.28, 6, 12), kit.mat("art-tire", col, { roughness: 0.95 }), 0, rad * 0.28, 0);
    m.rotation.x = Math.PI / 2;
    return m;
  }
  /** 一个阀门（半径 rad 以内）：地上冒出来一截管子（底下一圈法兰），顶上一个红色的手轮 */
  function valve(kit, rad, P) {
    const THREE = kit.THREE, g = new THREE.Group(), h = rad * 2.4, pr = rad * 0.3;
    const pm = kit.mat("art-valve-pipe", P.pipe, { roughness: 0.7, metalness: 0.4 }), wm = kit.mat("art-valve-wheel", P.wheel, { roughness: 0.6, metalness: 0.3 });
    g.add(kit.mesh(new THREE.CylinderGeometry(pr * 1.7, pr * 1.7, rad * 0.16, 10), pm, 0, rad * 0.08, 0));
    g.add(kit.mesh(new THREE.CylinderGeometry(pr, pr, h, 8), pm, 0, h / 2, 0));
    const wheel = kit.mesh(new THREE.TorusGeometry(rad * 0.68, rad * 0.08, 5, 14), wm, 0, h + rad * 0.05, 0);
    wheel.rotation.x = Math.PI / 2; g.add(wheel);
    [0, Math.PI / 2].forEach(a => { const sp = kit.mesh(new THREE.BoxGeometry(rad * 1.36, rad * 0.06, rad * 0.07), wm, 0, h + rad * 0.05, 0); sp.rotation.y = a; g.add(sp); });
    return g;
  }
  /** 挂钩：地台上的装饰（hd2d-world.js · buildZone 交过来；地台本体、贴花、小石子已经画好了） */
  function zone(kit, g, z, ctx, r, look, a) {
    const P = PALETTE[a.art.palette], R = A.rand(z.id * 131 + seedOf(a.key));
    zonePlan(z, a.key).forEach(d => {
      const o = d.kind === "tire" ? tire(kit, d.size, P.tire) : d.kind === "valve" ? valve(kit, d.size, P) : barrel(kit, d.size * 0.8, P.barrel[Math.floor(R() * P.barrel.length)]);
      o.position.set(d.x, d.y, d.z); o.rotation.y = R() * Math.PI * 2;
      o.userData.art = d.kind; o.userData.size = d.size;
      g.add(o);
    });
  }

  /* ---------- 远景：战场周围的贫民窟 ---------- */
  /**
   * 贫民窟里每一间摆在哪（纯函数，测试用同一份）：后面 SLUM.rows 几排、左右 SLUM.side 几列，都在战场范围外面（hd2d-scene-art.js · around）。
   * 每间的门朝着战场（后面的朝前、左右的朝里），屋顶往门那边多伸出一截（HUT.eave）：中心离边上再让开 HUT.eave × 进深。
   * 返回 [{ kind: "shack" / "house", x, z（中心）, w, h, d, rot }]
   */
  function slumPlan(b, seed) {
    const S = SLUM, R = A.rand(seed), at = A.around(b, S.margin), out = [];
    const one = (kind, x, z, rot, D) => out.push({ kind, x, z, w: D.w, h: D.h, d: D.d, rot });
    const size = () => { const kind = R() < S.houses ? "house" : "shack", D = S[kind]; return { kind, w: A.span(R, D.w), h: A.span(R, D.h), d: A.span(R, D.d) }; };
    S.rows.forEach((row, i) => {
      const from = at.cx - at.hx - S.reach, to = at.cx + at.hx + S.reach;
      for (let x = from + R() * row.step * 0.5; x < to; x += row.step * (1 + (R() - 0.5) * 2 * row.jitter)) {
        const D = size();
        one(D.kind, x, at.back - row.gap - HUT.eave * D.d - (i ? R() * 0.4 : 0), (R() - 0.5) * 0.25, D);
      }
    });
    [-1, 1].forEach(sx => S.side.forEach(col => {
      for (let z = at.back; z < at.cz;) {
        const D = size();
        z += D.w * 0.6;
        one(D.kind, at.cx + sx * (at.sideX + col.gap + HUT.eave * D.d), z, -sx * Math.PI / 2 + (R() - 0.5) * 0.2, D);
        z += D.w * 0.6 + col.step * 0.3 * R();
      }
    }));
    return out;
  }
  /** 远景的材质：铁皮（几种颜色各一个，贴瓦楞铁皮）、墙、屋顶、门洞 */
  function slumMats(kit, env, P, seed) {
    const THREE = kit.THREE, std = (color, map, opt) => env.keep(new THREE.MeshStandardMaterial(Object.assign({ color, map, roughness: 0.9, metalness: 0.15, flatShading: true }, opt || {})));
    const sheetTex = farTex(kit, env, 64, (g, s, r) => drawSheet(g, s, r, ["#d8d0c4", "#c4bcb0", "#e4dcd0"]), seed);
    const wallTex = farTex(kit, env, 64, (g, s, r) => {   // 土坯 / 砖墙：一行行错开的砖，抹的灰掉了几块
      g.fillStyle = "#e8e0d4"; g.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y += 8) for (let x = (y / 8) % 2 ? -6 : 0; x < s; x += 12) { g.fillStyle = r() < 0.5 ? "#ddd4c6" : "#f2eade"; g.fillRect(x + 1, y + 1, 10, 6); }
      for (let k = 0; k < 4; k++) { g.fillStyle = "rgba(255,250,240,.5)"; g.fillRect(r() * s, r() * s, 10 + r() * 14, 8 + r() * 10); }
    }, seed + 7);
    return {
      sheet: P.sheet.map(c => std(c, sheetTex)), wall: P.wall.map(c => std(c, wallTex, { metalness: 0 })),
      roof: P.roof.map(c => std(c, sheetTex)), dark: std(P.dark, null, { roughness: 1, metalness: 0 }),
      glow: env.keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(SLUM.glow).multiplyScalar(1.8), toneMapped: false, fog: false })),
      lit: SLUM.lit[env.theme] || 0
    };
  }
  /** 一间铁皮棚屋 / 矮房子：方盒子（铁皮的 / 砖墙的），单坡屋顶往前伸出一截，前面一个黑门洞、矮房子再开一两个窗洞；屋顶上压几块石头 */
  function hut(kit, M, h, R) {
    const THREE = kit.THREE, g = new THREE.Group(), pick = (list) => list[Math.floor(R() * list.length)];
    const body = new THREE.Mesh(new THREE.BoxGeometry(h.w, h.h, h.d), h.kind === "house" ? pick(M.wall) : pick(M.sheet));
    body.position.y = h.h / 2; g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(h.w * HUT.roof.w, 0.05, h.d * HUT.roof.d), pick(M.roof));
    roof.position.set(0, h.h + 0.05, h.d * HUT.lean); roof.rotation.x = HUT.tilt[h.kind]; g.add(roof);
    const hole = () => (R() < M.lit ? M.glow : M.dark);   // 傍晚 / 夜里一部分透出暖光
    const door = new THREE.Mesh(new THREE.PlaneGeometry(h.w * HUT.door[0], h.h * HUT.door[1]), hole());
    door.position.set((R() - 0.5) * h.w * 0.4, h.h * HUT.door[1] / 2, h.d / 2 + 0.006); g.add(door);
    if (h.kind === "house") {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(h.w * HUT.win[0], h.h * HUT.win[1]), hole());
      win.position.set(door.position.x > 0 ? -h.w * 0.25 : h.w * 0.25, h.h * 0.6, h.d / 2 + 0.006); g.add(win);
    } else if (R() < SLUM.flue) {   // 棚屋顶上的烟囱管
      const flue = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, h.h * 0.5, 6), M.dark);
      flue.position.set((R() - 0.5) * h.w * 0.6, h.h * 1.2, -h.d * 0.2); g.add(flue);
    }
    return g;
  }
  /** 外城区：战场周围一圈矮房子、铁皮棚屋 */
  function slumScene(kit, env, art, P, b, seed) {
    const M = slumMats(kit, env, P, seed), R = A.rand(seed + 3);
    slumPlan(b, seed).forEach(h => {
      const o = hut(kit, M, h, R);
      o.position.set(h.x, L.CONFIG.groundY, h.z); o.rotation.y = h.rot;
      env.group.add(tag(o, h.kind));
    });
  }

  /** 横穿整个画面的大管道（FAR.pipes）：一根根架在支架（两条腿 + 托住管子的横梁）上，每隔一段一道法兰；
   *  前面那根上几盏红灯一闪一闪（减少动态效果时一直亮着）。法兰、支架是实例网格 */
  function bigPipes(kit, env, R) {
    const THREE = kit.THREE, F = FAR, y0 = L.CONFIG.groundY, from = env.cx - env.hx - F.cliff.reach, to = env.cx + env.hx + F.cliff.reach, len = to - from;
    const o = new THREE.Object3D();
    F.pipes.forEach((p, i) => {
      const z = env.skyZ + p.sky, hm = Math.max(1, env.topY(z) * 0.84), r = Math.max(p.min, hm * p.r), y = y0 + Math.max(hm * p.y, r * 2.4), M = env.mats(p.k), g = new THREE.Group();
      g.add(kit.put(new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 14, 1, true), M.body), (from + to) / 2, y, z));
      g.children[0].rotation.z = Math.PI / 2;
      const nF = Math.floor(len / F.flange), fl = new THREE.InstancedMesh(new THREE.CylinderGeometry(r * 1.12, r * 1.12, r * 0.22, 14), M.dark, nF);
      for (let k = 0; k < nF; k++) { o.position.set(from + (k + 0.5) * F.flange, y, z); o.rotation.set(0, 0, Math.PI / 2); o.updateMatrix(); fl.setMatrixAt(k, o.matrix); }
      const nL = Math.floor(len / F.legs), legH = y - r * 0.9 - y0;
      const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(r * 0.22, legH, r * 0.22), M.dark, nL * 2);
      const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(r * 0.3, r * 0.25, r * 2.4), M.dark, nL);
      for (let k = 0; k < nL; k++) {
        const x = from + (k + 0.5) * F.legs + (R() - 0.5) * 0.6;
        [-1, 1].forEach((s, j) => { o.position.set(x, y0 + legH / 2, z + s * r * 0.9); o.rotation.set(s * 0.12, 0, 0); o.updateMatrix(); legs.setMatrixAt(k * 2 + j, o.matrix); });
        o.position.set(x, y - r * 0.95, z); o.rotation.set(0, 0, 0); o.updateMatrix(); beams.setMatrixAt(k, o.matrix);
      }
      g.add(fl, legs, beams);
      env.group.add(tag(g, "pipe"));
      if (i === 0) for (let k = 0; k < F.warn; k++) env.blinker(env.cx + (k / Math.max(1, F.warn - 1) - 0.5) * env.hx * 1.6 + (R() - 0.5), y + r + 0.12, z, R());
    });
  }
  /** 沙岩悬崖（FAR.cliff）：一段段、一层层沙岩（沙色 / 岩色轮着，越往上越往里收），顶上高低错落；战场左右两边外面的更高，像夹着这片贫民窟的峡谷。
   *  用远景最远那层的材质（偏雾色） */
  function sandCliffs(kit, env, R) {
    const C = FAR.cliff, z = env.skyZ + C.sky, hm = Math.max(1, env.topY(z) * 0.84), M = env.mats(1), g = new kit.THREE.Group();
    const from = env.cx - env.hx - C.reach, to = env.cx + env.hx + C.reach;
    for (let x = from; x < to;) {
      const w = A.span(R, C.w), wing = Math.abs(x + w / 2 - env.cx) > env.hx + 2 ? C.wings : 1;
      const h = hm * A.span(R, C.h) * wing, n = Math.round(A.span(R, C.layers));
      let y = L.CONFIG.groundY;
      for (let i = 0; i < n; i++) {
        const hh = h / n * (0.75 + R() * 0.5), k = 1 - i * C.inset;
        g.add(kit.box(i % 2 ? M.rock : M.sand, w * k, hh, C.d * k, x + w / 2, y + hh / 2, z + (R() - 0.5) * 0.2));
        y += hh;
      }
      x += w * (0.85 + R() * 0.2);
    }
    env.group.add(tag(g, "cliff"));
  }

  /* ---------- 远景：下水道（巨大圆管的里面）---------- */
  /**
   * 管壁的形状（纯函数，测试用同一份）：管子的轴沿 x，管底在地面上、从 zw（最后一排地台后沿 → 灯 → 再往后 TUNNEL.gap）开始往后往上弯。
   * 半径放不下 TUNNEL.r 就小一点（弯到竖直的那一截要在天幕前面）。
   * 返回 { r, yc, zc（轴）, zw, y0（地面）, point(φ) / at(离地多高) → { y, z, ny, nz }（管壁上的点、朝管子中心的方向）}
   */
  function tunnelShape(env) {
    const T = TUNNEL, y0 = L.CONFIG.groundY, zw = env.cz - env.hz - L.CONFIG.lamps.back - T.gap;
    const r = Math.max(3, Math.min(T.r, zw - env.skyZ - 0.8)), yc = y0 + r, zc = zw;
    const point = (phi) => ({ y: yc - r * Math.cos(phi), z: zc - r * Math.sin(phi), ny: Math.cos(phi), nz: Math.sin(phi) });
    const at = (h) => point(Math.acos(Math.max(-1, Math.min(1, (r - h) / r))));
    return { r, yc, zc, zw, y0, point, at };
  }
  /** 管壁上的灯在哪（战场左右再往外一点，等距排开，贴着管壁往里 0.12） */
  function tunnelLamps(env, S) {
    const T = TUNNEL.lamps, p = S.at(T.h), span = env.hx + 10, out = [];
    for (let i = 0; i < T.n; i++) out.push({ x: env.cx - span + 2 * span * (i + 0.5) / T.n, y: p.y + p.ny * 0.12, z: p.z + p.nz * 0.12 });
    return out;
  }
  /** 一片沿着管壁的网格（x 从 xa 到 xb 分 nx 段、沿弧从 0 到 arc 分 rows 段；往管子中心挪 lift）：顶点颜色 color(x, 点, 离地多高) */
  function wallSheet(kit, S, xa, xb, nx, arc, rows, lift, color) {
    const THREE = kit.THREE, pos = [], col = [], idx = [], w = nx + 1;
    for (let j = 0; j <= rows; j++) {
      const p = S.point(arc * j / rows);
      for (let i = 0; i <= nx; i++) {
        const x = xa + (xb - xa) * i / nx, c = color(x, p, p.y - S.y0);
        pos.push(x, p.y + p.ny * lift, p.z + p.nz * lift); col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < nx; i++) { const a = j * w + i; idx.push(a, a + w, a + 1, a + 1, a + w, a + w + 1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    return geo;
  }
  /** 接缝在哪（x，从战场中间往两边每隔 joint.every 一道）；哪几道上有灯带（每隔 rings.each 道，正中那道有） */
  function tunnelJoints(env) {
    const J = TUNNEL.joint, xs = [], rings = [];
    for (let k = -Math.floor((env.cx - env.x0) / J.every); env.cx + k * J.every <= env.x1; k++) {
      const x = env.cx + k * J.every;
      xs.push(x);
      if (((k % TUNNEL.rings.each) + TUNNEL.rings.each) % TUNNEL.rings.each === 0) rings.push(x);
    }
    return { xs, rings };
  }
  /** 管壁：混凝土一段段（颜色轮着），水位线以下更暗更绿；每隔一段一道接缝（略凸出来的一圈暗色的环），接缝两边各一排铆钉；
   *  隔几道接缝一圈灯带（从管底沿着管壁一直亮到拱顶：管壁的弧形就看这一圈圈的环）；
   *  灯带、壁灯照亮的那一片另外叠一层（加色混合，不受场景光照影响：管子里就靠这些灯） */
  function tunnelWall(kit, env, S, lamps, joints) {
    const THREE = kit.THREE, T = TUNNEL, J = T.joint, c = new THREE.Color(), stain = new THREE.Color(T.stain.tint);
    const base = (x, p, h) => {
      const k = Math.floor((x - env.cx) / J.every);
      c.set(T.wall[((k % T.wall.length) + T.wall.length) % T.wall.length]);
      if (h < T.stain.h) { const f = 1 - h / T.stain.h; c.lerp(stain, 0.5 * f).multiplyScalar(1 - (1 - T.stain.dark) * f); }
      return c;
    };
    const geo = wallSheet(kit, S, env.x0, env.x1, T.seg, T.arc, T.rows, 0, base);
    env.group.add(tag(new THREE.Mesh(geo, env.keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.04, side: THREE.DoubleSide, fog: false, emissive: T.glow }))), "tunnelWall"));
    // 接缝：每道一条窄窄的环，贴着管壁往里一点；两边各一排铆钉（实例网格）
    const ribs = new THREE.Group(), ribM = env.keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, fog: false }));
    joints.xs.forEach(x => ribs.add(new THREE.Mesh(wallSheet(kit, S, x - J.w / 2, x + J.w / 2, 1, T.arc, T.rows, 0.04, (xx, p, h) => base(xx, p, h).multiplyScalar(J.dark)), ribM)));
    env.group.add(tag(ribs, "tunnelRib"));
    const RV = J.rivet, per = Math.floor(T.arc * S.r / RV.step), o = new THREE.Object3D();
    const rivets = new THREE.InstancedMesh(new THREE.SphereGeometry(RV.r, 6, 4), env.keep(new THREE.MeshStandardMaterial({ color: RV.color, roughness: 0.45, metalness: 0.6, fog: false, emissive: T.glow })), joints.xs.length * 2 * per);
    let n = 0;
    joints.xs.forEach(x => [-1, 1].forEach(s => {
      for (let i = 0; i < per; i++) {
        const p = S.point((i + 0.5) * RV.step / S.r);
        o.position.set(x + s * J.w * 0.32, p.y + p.ny * 0.06, p.z + p.nz * 0.06); o.updateMatrix(); rivets.setMatrixAt(n++, o.matrix);
      }
    }));
    env.group.add(tag(rivets, "rivet"));
    // 灯带：接缝上一圈细细的亮带（自己发光，泛光会抓到）
    const RG = T.rings, ringM = env.keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(RG.color).multiplyScalar(RG.gain), toneMapped: false, fog: false, side: THREE.DoubleSide }));
    const rings = new THREE.Group();
    joints.rings.forEach(x => rings.add(new THREE.Mesh(wallSheet(kit, S, x - RG.w / 2, x + RG.w / 2, 1, T.arc, T.rows, 0.075, () => c.setRGB(1, 1, 1)), ringM)));
    env.group.add(tag(rings, "lightRing"));
    // 灯带、壁灯照亮的那一片
    const lc = new THREE.Color(T.lamps.color), rc = new THREE.Color(RG.color), add = new THREE.Color(), R2 = T.lamps.reach * T.lamps.reach, S2 = RG.spread * RG.spread;
    const glow = (x, p) => {
      let lit = 0, band = 0;
      lamps.forEach(l => { lit += Math.exp(-((x - l.x) ** 2 + (p.y - l.y) ** 2 + (p.z - l.z) ** 2) / R2); });
      joints.rings.forEach(rx => { band += Math.exp(-((x - rx) ** 2) / S2); });
      return c.copy(lc).multiplyScalar(Math.min(1, lit) * T.lamps.gain * 0.18).add(add.copy(rc).multiplyScalar(Math.min(1, band) * RG.level));
    };
    const pool = new THREE.Mesh(wallSheet(kit, S, env.x0, env.x1, T.seg * 3, T.arc, T.rows, 0.06, glow), env.keep(new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false
    })));
    env.group.add(tag(pool, "lampPool"));
  }
  /** 管壁上的灯：一个暗色的灯罩 + 发光的灯泡 + 一团柔光；有几盏时不时闪一下（AMBIENT.flicker；减少动态效果时一直亮着） */
  function wallLamps(kit, env, lamps) {
    const THREE = kit.THREE, T = TUNNEL.lamps, cfg = AMBIENT.flicker;
    const house = env.keep(new THREE.MeshStandardMaterial({ color: 0x2a2e2a, roughness: 0.7, metalness: 0.4, fog: false }));
    const bulb = env.keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(T.color).multiplyScalar(2.6), toneMapped: false, fog: false }));
    const glowTex = farTex(kit, env, 64, (g, s) => {
      const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grd.addColorStop(0, "rgba(255,255,255,.9)"); grd.addColorStop(0.35, "rgba(255,255,255,.3)"); grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd; g.fillRect(0, 0, s, s);
    }, 5);
    lamps.forEach((l, i) => {
      const g = new THREE.Group();
      g.add(kit.put(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.2), house), l.x, l.y + 0.1, l.z));
      const b = kit.put(new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), bulb), l.x, l.y - 0.02, l.z + 0.04);
      const sm = env.keep(new THREE.SpriteMaterial({ map: glowTex, color: T.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.55 }));
      const sp = new THREE.Sprite(sm); sp.position.set(l.x, l.y, l.z + 0.1); sp.scale.setScalar(1.6);
      g.add(b, sp);
      env.group.add(tag(g, "wallLamp"));
      if (i < T.blink) {
        const beat = A.beat(A.rand(i * 59 + 7), cfg.every, cfg.dur);
        g.userData.ambient = { kind: "flicker", beat };
        env.anims.push((t, dt) => { const on = dt === 0 || beat.step(dt) < 0; b.visible = on; sm.opacity = on ? 0.55 : 0.08; });
      }
    });
  }
  /** 沿管壁横着走的管子 / 电缆（TUNNEL.pipes），每隔 3 一个卡箍 */
  function wallPipes(kit, env, S) {
    const THREE = kit.THREE, len = env.x1 - env.x0, o = new THREE.Object3D();
    TUNNEL.pipes.forEach(p => {
      const w = S.at(p.h), y = w.y + w.ny * (p.r + 0.05), z = w.z + w.nz * (p.r + 0.05), m = env.keep(new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.6, metalness: 0.45, flatShading: true, fog: false }));
      const g = new THREE.Group(), pipe = kit.put(new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, len, 10, 1, true), m), (env.x0 + env.x1) / 2, y, z);
      pipe.rotation.z = Math.PI / 2; g.add(pipe);
      const n = Math.floor(len / 3), clips = new THREE.InstancedMesh(new THREE.CylinderGeometry(p.r * 1.25, p.r * 1.25, 0.08, 10), m, n);
      for (let k = 0; k < n; k++) { o.position.set(env.x0 + (k + 0.5) * 3, y, z); o.rotation.set(0, 0, Math.PI / 2); o.updateMatrix(); clips.setMatrixAt(k, o.matrix); }
      g.add(clips);
      env.group.add(tag(g, "wallPipe"));
    });
  }
  /** 地上的污水：一大片铺满管底（地台从水里冒出来），浑浊的黄绿、一道道水纹和浮沫，贴图慢慢往左流（减少动态效果时不流）。
   *  平铺在地面上、比地台低，不算「装饰」（不打 userData.art，userData.flow 标出来） */
  function sewage(kit, env, S, seed) {
    const THREE = kit.THREE, W = TUNNEL.water, z0 = S.zw, z1 = env.cz + env.hz + 30, tile = 6;
    const tex = farTex(kit, env, 256, (g, s, r) => {
      g.fillStyle = hex(W.color); g.fillRect(0, 0, s, s);
      for (let k = 0; k < 14; k++) {   // 深浅不一的几片（左右上下都接得上）
        const x = r() * s, y = r() * s, rad = 20 + r() * 50, dark = r() < 0.6, grd = g.createRadialGradient(x, y, 0, x, y, rad);
        grd.addColorStop(0, dark ? "rgba(30,34,18,.35)" : "rgba(120,124,70,.25)"); grd.addColorStop(1, "rgba(0,0,0,0)");
        [-s, 0, s].forEach(dx => [-s, 0, s].forEach(dy => { g.fillStyle = grd; g.save(); g.translate(dx, dy); g.fillRect(x - rad, y - rad, rad * 2, rad * 2); g.restore(); }));
      }
      for (let k = 0; k < 70; k++) {   // 顺着流向的水纹（横着的细长条）
        const x = r() * s, y = r() * s, w = 14 + r() * 40;
        g.fillStyle = r() < 0.5 ? "rgba(190,196,140,.18)" : "rgba(20,24,12,.2)";
        [0, -s].forEach(dx => g.fillRect(x + dx, y, w, 1 + r() * 1.5));
      }
      for (let k = 0; k < 40; k++) { g.fillStyle = "rgba(210,214,170,.35)"; g.fillRect(r() * s, r() * s, 1 + r() * 3, 1 + r() * 2); }   // 浮沫
    }, seed);
    tex.magFilter = THREE.LinearFilter; tex.repeat.set((env.x1 - env.x0) / tile, (z1 - z0) / tile);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(env.x1 - env.x0, z1 - z0), env.keep(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.12, metalness: 0.35, fog: true, emissive: TUNNEL.glow })));
    m.rotation.x = -Math.PI / 2; m.position.set((env.x0 + env.x1) / 2, S.y0 + W.y, (z0 + z1) / 2);
    m.receiveShadow = true; m.userData.flow = "sewage";
    env.group.add(m);
    // 水面上一道道顺着流向的亮纹：另一层（透明），比污水流得快——两层流速不同，一眼看得出水在往一边流
    const st = farTex(kit, env, 128, (g, s, r) => {
      for (let k = 0; k < 46; k++) {
        const x = r() * s, y = r() * s, w = 10 + r() * 34, a = 0.25 + r() * 0.5;
        [0, -s].forEach(dx => {
          g.fillStyle = `rgba(214,222,170,${a})`; g.fillRect(x + dx, y, w, 1);
          g.fillStyle = `rgba(214,222,170,${a * 0.4})`; g.fillRect(x + dx + w * 0.2, y + 1, w * 0.6, 1);
        });
      }
    }, seed + 37);
    st.magFilter = THREE.LinearFilter; st.repeat.set((env.x1 - env.x0) / (tile * 0.7), (z1 - z0) / (tile * 0.7));
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(env.x1 - env.x0, z1 - z0), env.keep(new THREE.MeshBasicMaterial({ map: st, transparent: true, opacity: W.streak.opacity, depthWrite: false, fog: true })));
    sm.rotation.x = -Math.PI / 2; sm.position.set((env.x0 + env.x1) / 2, S.y0 + W.y + 0.008, (z0 + z1) / 2);
    sm.userData.flow = "streak";
    env.group.add(sm);
    env.anims.push((t, dt) => {
      if (!(dt > 0)) return;
      tex.offset.x = (tex.offset.x + W.speed * dt / tile) % 1;
      st.offset.x = (st.offset.x + W.speed * W.streak.fast * dt / (tile * 0.7)) % 1;
    });
    return m;
  }
  /** 灯带、壁灯在水面上的倒影（TUNNEL.water.shine）：每个 x 一条从管底往前伸的亮纹（中间亮、两边和前头淡掉，加色混合），
   *  贴图是一道道横着的碎光，晃动着往左流（减少动态效果时不动）。平铺在水面上，不算「装饰」（userData.flow） */
  function shine(kit, env, S, xs, seed) {
    const THREE = kit.THREE, W = TUNNEL.water, SH = W.shine, y = S.y0 + W.y + 0.016;
    const tex = farTex(kit, env, 128, (g, s, r) => {
      for (let k = 0; k < 70; k++) {
        const x = r() * s, yy = r() * s, w = 4 + r() * 22, a = 0.3 + r() * 0.7;
        g.fillStyle = `rgba(255,255,255,${a})`;
        [0, -s].forEach(dx => g.fillRect(x + dx, yy, w, 1 + r() * 2));
      }
    }, seed + 41);
    tex.magFilter = THREE.LinearFilter;
    const pos = [], col = [], uv = [], idx = [];
    xs.forEach(x => {
      const b = pos.length / 3;
      // 横着三列（两边 0、中间 1）× 往前五行（越往前越淡）
      for (let j = 0; j <= 4; j++) {
        const z = S.zw + 0.15 + SH.len * j / 4, f = Math.pow(1 - j / 4, 1.4);
        [-1, 0, 1].forEach(sx => {
          pos.push(x + sx * SH.w / 2, y, z); uv.push((x + sx * SH.w / 2) / 2, z / 2);
          const v = sx === 0 ? f : 0; col.push(v, v, v);
        });
      }
      for (let j = 0; j < 4; j++) for (let i = 0; i < 2; i++) { const a = b + j * 3 + i; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4); }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, env.keep(new THREE.MeshBasicMaterial({
      map: tex, vertexColors: true, color: new THREE.Color(TUNNEL.lamps.color).multiplyScalar(SH.level), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false
    })));
    m.userData.flow = "shine";
    env.group.add(m);
    env.anims.push((t, dt) => {
      if (!(dt > 0)) return;
      tex.offset.x = (tex.offset.x + SH.speed * dt / 2) % 1;
      tex.offset.y = Math.sin(t * 1.7) * 0.04;
    });
    return m;
  }
  /** 排污口（TUNNEL.outfall）：管壁上伸出来一截横着的管子（管口里面是黑的），一股污水从管口往下流进地上的污水里（贴图往下走），
   *  落水的地方一圈浮沫一胀一缩。减少动态效果时都停住 */
  function outfall(kit, env, S, seed) {
    const THREE = kit.THREE, O = TUNNEL.outfall, x = env.cx + O.u * env.hx, yo = S.y0 + O.h;
    const zTop = S.at(O.h + O.r).z, zBot = S.at(Math.max(0.05, O.h - O.r)).z, mouth = zBot + 0.4, len = mouth - (zTop - 0.2);
    const g = new THREE.Group(), metal = env.keep(new THREE.MeshStandardMaterial({ color: 0x4c4a40, roughness: 0.75, metalness: 0.35, flatShading: true, fog: false, side: THREE.DoubleSide }));
    const pipe = kit.put(new THREE.Mesh(new THREE.CylinderGeometry(O.r, O.r, len, 14, 1, true), metal), x, yo, mouth - len / 2);
    pipe.rotation.x = Math.PI / 2; g.add(pipe);
    const lip = kit.put(new THREE.Mesh(new THREE.TorusGeometry(O.r, 0.06, 5, 16), metal), x, yo, mouth); g.add(lip);
    g.add(kit.put(new THREE.Mesh(new THREE.CircleGeometry(O.r * 0.98, 14), env.keep(new THREE.MeshBasicMaterial({ color: 0x050605, fog: false }))), x, yo, mouth - 0.5));
    // 往下流的那一股：竖着的一条，贴图（一道道竖的水纹，左右两边透明）往下走
    const flowTex = farTex(kit, env, 64, (gc, s, r) => {
      for (let k = 0; k < 40; k++) {
        const xx = s * (0.15 + r() * 0.7), a = 0.25 + r() * 0.5;
        gc.fillStyle = `rgba(${150 + Math.floor(r() * 60)},${150 + Math.floor(r() * 50)},${90 + Math.floor(r() * 40)},${a})`;
        gc.fillRect(xx, r() * s, 1 + r() * 3, 8 + r() * 24);
      }
    }, seed + 23);
    flowTex.magFilter = THREE.LinearFilter;
    // 管壁底下往前弯，所以这股水不是直着掉下去，是从管口下沿顺着管壁流到管底（一条贴着管壁往里一点的带子，往下稍微散开）；
    // uv 的 v 按流过的长度算（每 0.8 一张贴图）
    const pos = [], uv = [], idx = [], w = O.r * 1.3, rows = 12, lipH = O.h - O.r - 0.1, phiLip = Math.acos((S.r - lipH) / S.r), step = S.r * phiLip / rows;
    const row = (xw, y, z, v) => { [-1, 1].forEach(s => { pos.push(x + s * xw / 2, y, z); uv.push(s < 0 ? 0 : 1, v); }); };
    row(w * 0.9, yo - O.r * 0.92, mouth, 0.5 / 0.8);   // 管口下沿
    for (let j = 0; j <= rows; j++) { const p = S.point(phiLip * (1 - j / rows)); row(w * (1 + 0.35 * j / rows), p.y + p.ny * 0.04, p.z + p.nz * 0.04, -j * step / 0.8); }
    for (let j = 0; j <= rows; j++) { const a = j * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); fg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    fg.setIndex(idx); fg.computeVertexNormals();
    g.add(new THREE.Mesh(fg, env.keep(new THREE.MeshStandardMaterial({ map: flowTex, color: O.color, transparent: true, depthWrite: false, roughness: 0.3, metalness: 0.1, side: THREE.DoubleSide, fog: false }))));
    env.group.add(tag(g, "outfall"));
    // 流到管底的地方：一圈浮沫，平铺在污水上（和污水一样不算「装饰」）
    const foamTex = farTex(kit, env, 64, (gc, s, r) => {
      for (let k = 0; k < 90; k++) {
        const a = r() * 7, d = Math.sqrt(r()) * s * 0.45;
        gc.fillStyle = `rgba(220,224,186,${0.2 + r() * 0.5})`; gc.fillRect(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d * 0.6, 1 + r() * 3, 1 + r() * 2);
      }
    }, seed + 29);
    const foam = kit.put(new THREE.Mesh(new THREE.PlaneGeometry(w * 2.2, 1.0), env.keep(new THREE.MeshBasicMaterial({ map: foamTex, color: 0xb8bc98, transparent: true, depthWrite: false, fog: false }))), x, S.y0 + TUNNEL.water.y + 0.02, S.zw + 0.3);
    foam.rotation.x = -Math.PI / 2; foam.userData.flow = "foam";
    env.group.add(foam);
    env.anims.push((t, dt) => {
      if (!(dt > 0)) return;
      flowTex.offset.y = (flowTex.offset.y + O.fall * dt / 0.8) % 1;
      const k = 1 + Math.sin(t * 3.1) * 0.08; foam.scale.set(k, k, 1);
    });
  }
  /** 下水道：巨大圆管的后半边（管壁、接缝和铆钉、灯带、拱顶、灯照亮的那一片）、管壁上的灯和管子、排污口、地上的污水和倒影。
   *  管子里看不到天：天幕和天边那条远景收起来（没有天光、太阳的光晕、星星、乌云） */
  function tunnelScene(kit, env, seed) {
    const S = tunnelShape(env), lamps = tunnelLamps(env, S), joints = tunnelJoints(env);
    env.group.children.forEach(o => { if (o.userData.layer === "sky" || o.userData.layer === "band") o.visible = false; });
    tunnelWall(kit, env, S, lamps, joints);
    wallLamps(kit, env, lamps);
    wallPipes(kit, env, S);
    outfall(kit, env, S, seed);
    sewage(kit, env, S, seed);
    shine(kit, env, S, joints.rings.concat(lamps.map(l => l.x)), seed);
  }

  /* ---------- 挂钩：远景 ---------- */
  /** 天边画的远景：外城区先借现成的（沙漠的桌山：远处的沙岩悬崖）；下水道没有（被管壁挡住，用以前的那条也看不到） */
  function band(kit, colors, seed, a) {
    return a.art.backdrop.band ? kit.bandTexture(a.art.backdrop.band, colors, seed) : null;
  }
  /** 中景、战场周围的装饰、环境动画（hd2d-backdrop.js · buildBackdrop 交过来）：返回 { groundEdge }（地台外面那片地一直铺到天幕 = 不给） */
  function backdrop(kit, env, a) {
    const art = a.art, P = PALETTE[art.palette], b = boundsOf(env), seed = seedOf(a.key) + Math.round(env.hx * 10) + Math.round(env.hz * 7);
    const R = A.rand(seed + 17);
    if (art.backdrop.slum) slumScene(kit, env, art, P, b, seed);
    if (art.backdrop.pipes) bigPipes(kit, env, R);
    if (art.backdrop.cliffs) sandCliffs(kit, env, R);
    if (art.backdrop.tunnel) tunnelScene(kit, env, seed);
    return {};
  }

  const pack = { name: "city", scenes: SCENES, grounds: GROUNDS, art: ART, textures: TEXTURES, decals: DECALS, zone, band, backdrop };
  A.add(pack);
  return Object.assign({ PALETTE, SLUM, HUT, FAR, TUNNEL, AMBIENT, zonePlan, slumPlan, tunnelShape, seedOf }, pack);
});
