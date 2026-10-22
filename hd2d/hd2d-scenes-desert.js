/* Antlerscale: Backfire · HD-2D 战场原型 · 区域场景的美术包：沙漠（#242）
 *
 * 主人试玩反馈 · 五：沙漠分成沙丘和沙珊瑚台地。
 *   沙丘 dune：和沙漠的感觉一样，一望无际，只有起伏的沙丘和时不时吹起的一些风沙。
 *              战场后面一整片起伏的沙丘（几层沙丘叠起来：迎风坡缓、背风坡陡，沙脊横着弯），越远越高，一直铺到雾里（天幕挪到很远，skyGap），
 *              没有别的东西；几处沙脊上时不时吹起一阵风沙（顺着风一缕缕飘出去、越飘越大越淡）。天边画的是远处一层层的沙丘（不画桌山）
 *   沙珊瑚台地 coral：背景中有类似各种珊瑚的巨大结构，但都是砂岩的色调。
 *              战场后面一排排砂岩的「珊瑚」：枝状（鹿角）、脑珊瑚（扁圆顶上一道道迷宫一样的沟）、桌状（柄上一大片平板）、
 *              管状（一簇竖管，管口黑洞洞）、扇形（竖着的一片细枝网）、指状（一簇粗指头）；近的一排矮、越远越高（远的比画面上沿还高），
 *              都是一层层砂岩的颜色（底下暗、朝上的面落着沙），脚下堆着沙；偶尔吹起一阵风沙
 * 每个场景一套：地面（顶面贴图）、地台侧面、地台上的装饰、远景、光照 / 调色、环境动画；数值都在下面的配置表里。
 * 怎么接进画面见 hd2d-scene-art.js（登记处）：这里不 import three.js，three.js 和画贴图 / 拼几何体的小工具由挂钩那边打包成 kit 传进来。
 * 地台上的装饰只摆在左右两条边带和左右矮一截的台子上（站位区以外，见 hd2d-scene-art.js · zoneSpots），不压住站位、铭牌；
 * 战场周围的东西都在战场后沿的灯线后面。只读布局给的地台 / 战场范围，不碰单位数据（没有坚毅生命）。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./hd2d-layout.js"), require("./hd2d-scene-art.js"));
  else root.HD2DScenesDesert = factory(root.HD2DLayout, root.HD2DSceneArt);
})(typeof self !== "undefined" ? self : this, function (L, A) {
  "use strict";

  /* ---------- 配置 ---------- */
  /** 色调：sand 沙子的几种颜色（大片深浅）、crest 沙脊上亮一点、dust 风沙；stone 砂岩一层层的颜色、foot 根部暗的颜色、hole 管口的黑洞；
   *  rock 地台上的石头、shrub 枯草丛 */
  const PALETTE = {
    dune: { sand: [0xdcb27a, 0xd2a46a, 0xe4c08a, 0xc89a60], crest: 0xf2d8a8, dust: 0xead2a2, rock: [0xb8925e, 0xa8824e, 0xc49c68], shrub: 0x7a6440 },
    coral: {
      sand: [0xd8ae78, 0xcea068, 0xe2bc86], crest: 0xeed0a0, dust: 0xe6cc9a, rock: [0xb48a58, 0xa47a4a, 0xc29462], shrub: 0x7a6440,
      stone: [0xd6a670, 0xc4905a, 0xe4bc86, 0xb8844e, 0xd09a62, 0xeac896], foot: 0x7e5a38, hole: 0x3a2818
    }
  };
  /** 沙丘：战场后面一整片起伏的沙丘（一望无际：天幕挪到战场后沿后面 sky，沙丘铺到 back，远处进雾里）
   *   start / ramp   灯后面再往后 start 开始起伏，再往后 ramp 起伏到底（战场边上是平的）
   *   waves          几层沙丘叠起来：len 波长、amp 多高、ang 沙脊歪多少（弧度）、wob 沙脊横着弯（幅度 × 波长、频率）；
   *                  crest 一个波长里沙脊在哪（迎风坡缓、背风坡陡）；grow 越远越高（最远 × grow）
   *   seg            横 / 纵分几格（近处密）；gusts 几处沙脊上会吹起风沙 */
  const DUNE = {
    start: 0.6, ramp: 6, back: 44, sky: 46, crest: 0.74, grow: 1.7, seg: [140, 64], gusts: 4,
    waves: [{ len: 9, amp: 1.4, ang: 0.16, wob: [0.12, 1.7] }, { len: 4.6, amp: 0.45, ang: -0.35, wob: [0.2, 1.1] }, { len: 21, amp: 2.4, ang: 0.06, wob: [0.06, 2.6] }]
  };
  /** 沙珊瑚台地：战场后面一排排砂岩的珊瑚（天幕在后沿后面 sky）
   *   rows     一排排：back 在灯后面多远、n 横着几座、h 多高（世界单位：近的矮、远的比画面上沿还高）、kinds 轮着摆哪几种
   *   band     砂岩一层多厚；branch 枝状（几层分叉、每层几成长 / 多细、往外歪多少、往上翘多少、几成分三叉、粗细 × 高）；
   *   brain    脑珊瑚（球面多细、沟多深、压多扁）；table 桌状；tube 管状（几根）；fan 扇形（几层分叉）；finger 指状（几根）
   *   mound    每座脚下堆的沙（× 占地半径、多高）；gusts 几处会吹起风沙 */
  const CORAL = {
    sky: 36, band: 0.55, gusts: 2,
    rows: [
      { back: [1.6, 3.8], n: 6, h: [1.5, 3.2], kinds: ["brain", "tube", "finger", "table", "brain", "tube"] },
      { back: [7, 12], n: 7, h: [5, 9.5], kinds: ["branch", "table", "fan", "tube", "brain", "finger", "branch"] },
      { back: [15, 26], n: 7, h: [10, 20], kinds: ["branch", "table", "fan", "branch", "brain", "table", "fan"] }
    ],
    branch: { depth: [3, 4], shrink: [0.62, 0.8], taper: 0.74, spread: [0.38, 0.75], lift: 0.35, three: 0.35, thick: 0.065, sides: 6 },
    brain: { detail: 7, groove: 0.07, squash: 0.72 },
    table: { stem: [0.16, 0.24], thick: 0.11, tilt: 0.22, second: 0.5 },
    tube: { n: [5, 9], r: [0.12, 0.22] },
    fan: { depth: 5, spread: [0.25, 0.6], thick: 0.035 },
    finger: { n: [4, 8], r: [0.13, 0.2] },
    mound: [1.25, 0.16]
  };
  /** 环境动画的频率（秒）。gust 风沙：隔多久吹一阵、每阵多久；一阵几团沙、顺着风飘多远、往上飘多高、一团从多大长到多大（横着拉长 stretch 倍）、多不透明
   *  （减少动态效果时不吹） */
  const AMBIENT = {
    gust: { every: [2.5, 7], dur: [2.4, 4], puffs: 10, drift: [2.5, 5], rise: 0.7, size: [0.35, 1.4], stretch: 1.9, opacity: 0.42 }
  };
  /** 每个场景（键 = 地面主题）：
   *   decor     地台上的装饰：band 左右边带上几个、ledge 台子上几个、size 半径范围、kinds 轮着摆什么（drift 一堆沙、rock 半埋的砂岩、
   *             shrub 一丛枯草、brain 小脑珊瑚、finger 一小簇指状珊瑚）
   *   backdrop  远景：dunes 沙丘 / coral 珊瑚
   *   ambient   有哪些环境动画（AMBIENT 的键）
   *   light     光照 / 调色（写法见 hd2d-scene-art.js · lighting）：露天，跟着光影主题，往沙子的暖色靠一点 */
  const ART = {
    desert_dune: {
      palette: "dune",
      decor: { band: 3, ledge: 2, size: [0.1, 0.17], kinds: ["drift", "drift", "rock", "shrub"] },
      backdrop: { dunes: true },
      ambient: ["gust"],
      light: { all: { tint: { fog: [0xe0b880, 0.2], hemiGround: [0xc09058, 0.35], sun: [0xfff0d0, 0.1] }, grade: { temp: [1.05, 1.0, 0.92] } } }
    },
    desert_coral: {
      palette: "coral",
      decor: { band: 3, ledge: 2, size: [0.1, 0.17], kinds: ["brain", "finger", "rock", "drift"] },
      backdrop: { coral: true },
      ambient: ["gust"],
      light: { all: { tint: { fog: [0xd8a878, 0.2], hemiGround: [0xb08050, 0.35] }, grade: { temp: [1.06, 0.99, 0.9], contrast: 1.12 } } }
    }
  };
  /** 地面主题（并进布局的 GROUNDS，写法同 hd2d-layout.js 的 GROUNDS）：顶面 / 侧面贴图是这里画的（art 开头）或者 hd2d-world.js 原有的；不放灯 */
  const GROUNDS = {
    desert_dune: {   // 沙漠 · 沙丘：细沙（一道道风吹出来的沙纹），侧面沙层；地台外面是沙色的地
      tex: "artDuneSand", tint: 0xffffff, side: "strata", sideTint: 0xf2d6a2, decals: { ripple: 5, gravel: 1 },
      pebbles: 8, pebble: 0xc8a46e, rock: 0xb8925e, decor: "art", ground: 0xc49a62, backdrop: "desert_dune"
    },
    desert_coral: {   // 沙漠 · 沙珊瑚台地：砂岩台地（多孔，一个个珊瑚化石的印子），侧面多孔的砂岩层；地台外面是砂岩色的地
      tex: "artReefRock", tint: 0xffffff, side: "artReefSide", decals: { ripple: 2, gravel: 2, crack: 2 },
      pebbles: 14, pebble: 0xb88c5a, rock: 0xa87e52, decor: "art", ground: 0xb08458, backdrop: "desert_coral"
    }
  };
  /** 区域 → 场景 id（world-data.js · BATTLE_SCENES）→ 地面主题 */
  const SCENES = { "沙漠": { dune: "desert_dune", coral: "desert_coral" } };

  /* ---------- 小工具 ---------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const seedOf = (s) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 100003; };
  const named = (t, name) => { t.name = name; return t; };
  /** 关掉阴影、打上标签（测试按 userData.art 认是什么） */
  function tag(o, what) {
    o.userData.art = what;
    o.traverse(m => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
    return o;
  }
  /** 一块低多边形的石头（同 hd2d-scenes-mine.js · rockGeo）：二十面体的顶点沿半径随机往里收一点，再压扁一点 */
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
  /** 把几块（几何体 + 摆法 + 上色）拼成一个几何体（非索引、低多边形，一面一个颜色）。parts = [{ geo, m: Matrix4, color(y 面的中心多高, ny 面朝上几成) → Color }] */
  function merge(kit, parts) {
    const THREE = kit.THREE, pos = [], col = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3();
    parts.forEach(pt => {
      const g = pt.geo.index ? pt.geo.toNonIndexed() : pt.geo;
      g.applyMatrix4(pt.m);
      const p = g.attributes.position;
      for (let i = 0; i + 2 < p.count; i += 3) {
        a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
        n.subVectors(c, b).cross(t.subVectors(a, b));
        const len = n.length();
        if (len < 1e-9) continue;   // 退化的面（圆柱的尖、贴在一起的点）不要
        const k = pt.color((a.y + b.y + c.y) / 3, n.y / len);
        [a, b, c].forEach(v => { pos.push(v.x, v.y, v.z); col.push(k.r, k.g, k.b); });
      }
      g.dispose(); if (g !== pt.geo) pt.geo.dispose();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    return geo;
  }
  /** 砂岩的上色（纯函数 + 随机深浅）：一层层的颜色（按高度，CORAL.band 一层），根部暗，朝上的面落着一层沙（亮一点） */
  function stoneColor(kit, P, R) {
    const THREE = kit.THREE, tones = P.stone.map(c => new THREE.Color(c)), foot = new THREE.Color(P.foot), dust = new THREE.Color(P.dust), off = R() * 10;
    return (y, ny) => {
      const u = y / CORAL.band + off, i = Math.floor(u), f = smooth(0.75, 1, u - i);
      const c = tones[((i % tones.length) + tones.length) % tones.length].clone().lerp(tones[(((i + 1) % tones.length) + tones.length) % tones.length], f);
      c.lerp(foot, 0.5 * (1 - smooth(0, 1.2, y))).multiplyScalar(0.94 + R() * 0.12);
      return ny > 0.65 ? c.lerp(dust, 0.35 * smooth(0.65, 1, ny)) : c;
    };
  }

  /* ---------- 贴图（canvas 程序贴图，没有图片文件）---------- */
  const paint = (name, size, draw, opt) => (kit) => named(kit.canvasTex("art-" + name, size, (g, s, r) => draw(g, s, r, kit), opt), name);
  const around9 = (s, fn) => [-s, 0, s].forEach(dx => [-s, 0, s].forEach(dy => fn(dx, dy)));
  const TEXTURES = {
    /** 细沙（沙丘）：大片深浅不一的沙，一道道风吹出来的沙纹（横着的波浪线，暗边 + 亮边；整数个周期，贴图首尾相接），细碎的沙粒，零星几颗小石子 */
    artDuneSand: paint("artDuneSand", 256, (g, s, r, kit) => {
      g.fillStyle = "#d8ae76"; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 16; i++) {
        const x = r() * s, y = r() * s, rad = 30 + r() * 60, col = r() < 0.5 ? "rgba(120,80,40," : "rgba(255,240,210,", grd = g.createRadialGradient(x, y, 0, x, y, rad);
        grd.addColorStop(0, col + (0.06 + r() * 0.06) + ")"); grd.addColorStop(1, col + "0)");
        around9(s, (dx, dy) => { g.fillStyle = grd; g.save(); g.translate(dx, dy); g.fillRect(x - rad, y - rad, rad * 2, rad * 2); g.restore(); });
      }
      for (let y0 = 0; y0 < s; y0 += 8) {   // 沙纹：每 8 像素一道，横着按整数个周期起伏
        const k1 = 1 + Math.floor(r() * 3), k2 = 3 + Math.floor(r() * 4), a1 = 2 + r() * 2.5, a2 = 0.8 + r() * 1.2, p1 = r() * 6.3, p2 = r() * 6.3;
        const yAt = (x) => y0 + a1 * Math.sin((x / s) * Math.PI * 2 * k1 + p1) + a2 * Math.sin((x / s) * Math.PI * 2 * k2 + p2);
        [[0, "rgba(130,88,44,.32)", 1.6], [1.8, "rgba(255,238,206,.34)", 1.2]].forEach(([dy, col, w]) => {
          g.strokeStyle = col; g.lineWidth = w; g.beginPath();
          for (let x = 0; x <= s; x += 4) (x ? g.lineTo(x, yAt(x) + dy) : g.moveTo(x, yAt(x) + dy));
          g.stroke();
        });
      }
      kit.speckle(g, s, r, 2600, "rgba(255,242,214,.18)", "rgba(120,80,40,.16)");
      for (let k = 0; k < 2; k++) kit.gravel(g, r, r() * s, r() * s, 4 + r() * 5, 5 + Math.floor(r() * 5));
    }),
    /** 砂岩台地（沙珊瑚台地）：砂岩底色、几片深浅，密密的小孔（暗的洞、下沿一道亮边），一个个珊瑚化石的印子（一圈 + 放射的细纹），几道枝状的化石纹，裂缝和细沙 */
    artReefRock: paint("artReefRock", 256, (g, s, r, kit) => {
      g.fillStyle = "#c99a66"; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 14; i++) {
        g.fillStyle = r() < 0.5 ? `rgba(110,70,36,${0.06 + r() * 0.07})` : `rgba(255,236,200,${0.05 + r() * 0.06})`;
        const x = r() * s, y = r() * s, rx = 24 + r() * 50, ry = 16 + r() * 34, a = r() * 3;
        around9(s, (dx, dy) => { g.beginPath(); g.ellipse(x + dx, y + dy, rx, ry, a, 0, 7); g.fill(); });
      }
      kit.speckle(g, s, r, 2400, "rgba(255,238,206,.16)", "rgba(90,56,26,.2)");
      for (let i = 0; i < 16; i++) {   // 珊瑚化石的印子
        const x = r() * s, y = r() * s, rad = 5 + r() * 9, n = 8 + Math.floor(r() * 6);
        around9(s, (dx, dy) => {
          const cx = x + dx, cy = y + dy;
          if (cx < -20 || cx > s + 20 || cy < -20 || cy > s + 20) return;
          g.strokeStyle = "rgba(96,60,30,.45)"; g.lineWidth = 1.2; g.beginPath(); g.arc(cx, cy, rad, 0, 7); g.stroke();
          g.strokeStyle = "rgba(96,60,30,.3)"; g.lineWidth = 0.8;
          for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * rad * 0.25, cy + Math.sin(a) * rad * 0.25); g.lineTo(cx + Math.cos(a) * rad * 0.9, cy + Math.sin(a) * rad * 0.9); g.stroke(); }
          g.fillStyle = "rgba(70,42,20,.4)"; g.beginPath(); g.arc(cx, cy, rad * 0.2, 0, 7); g.fill();
        });
      }
      for (let i = 0; i < 260; i++) {   // 小孔
        const x = r() * s, y = r() * s, rad = 0.8 + r() * 2.2;
        g.fillStyle = "rgba(60,36,16,.55)"; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
        g.fillStyle = "rgba(255,232,196,.25)"; g.fillRect(x - rad * 0.6, y + rad * 0.7, rad * 1.2, 0.8);
      }
      g.strokeStyle = "rgba(90,56,26,.35)";
      for (let k = 0; k < 4; k++) kit.crack(g, r, r() * s, r() * s, 6 + Math.floor(r() * 5), 1, 2);   // 枝状的化石纹 / 裂缝
    }),
    /** 地台侧面（沙珊瑚台地）：一层层砂岩（厚薄不一、上沿被风化得坑坑洼洼），层里密密的小孔，几道竖着的裂缝 */
    artReefSide: paint("artReefSide", 128, (g, s, r, kit) => {
      const cols = ["#cf9c62", "#b98650", "#dcb078", "#a8763f", "#c8925a", "#e2bc86"];
      for (let y = 0; y < s;) {
        const h = 6 + r() * 14, col = cols[Math.floor(r() * cols.length)];
        g.fillStyle = col; g.beginPath(); g.moveTo(0, y);
        for (let x = 0; x <= s; x += 8) g.lineTo(x, y + Math.sin(x * 0.11 + y) * 1.3 + (r() - 0.5) * 1.2);
        g.lineTo(s, y + h); g.lineTo(0, y + h); g.fill();
        g.fillStyle = "rgba(50,28,10,.3)"; g.fillRect(0, y + h - 1, s, 1.5);
        y += h;
      }
      for (let i = 0; i < 160; i++) { const x = r() * s, y = r() * s, rad = 0.6 + r() * 1.6; g.fillStyle = "rgba(56,32,14,.5)"; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill(); }
      kit.speckle(g, s, r, 700, "rgba(255,236,206,.14)", "rgba(40,22,10,.2)");
      g.strokeStyle = "rgba(40,22,10,.38)";
      for (let k = 0; k < 4; k++) { const x = r() * s; g.lineWidth = 1 + r(); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 10, s * (0.3 + r() * 0.7)); g.stroke(); }
    })
  };

  /* ---------- 珊瑚的形状（拼成一个几何体，上色交给 color(y, ny)）---------- */
  const up = (kit) => new kit.THREE.Vector3(0, 1, 0);
  /** 一段圆柱：p0 → p1，两头半径 r0 / r1，sides 边（拼进 parts） */
  function segment(kit, parts, p0, p1, r0, r1, sides, color) {
    const THREE = kit.THREE, d = new THREE.Vector3().subVectors(p1, p0), len = d.length();
    if (len < 1e-6) return;
    const m = new THREE.Matrix4().compose(p0.clone().add(p1).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(up(kit), d.normalize()), new THREE.Vector3(1, 1, 1));
    parts.push({ geo: new THREE.CylinderGeometry(r1, r0, len, sides, 1, false), m, color });
  }
  const knob = (kit, parts, p, r, color) => parts.push({ geo: new kit.THREE.IcosahedronGeometry(r, 0), m: new kit.THREE.Matrix4().makeTranslation(p.x, p.y, p.z), color });
  /** 枝状珊瑚（鹿角 / 树状）：一根粗主干往上，一路分叉（每次 2–3 根，往外歪、往上翘），越分越细，关节和枝头一个圆头；整个高约 h */
  function branchCoral(kit, R, h, color) {
    const THREE = kit.THREE, C = CORAL.branch, parts = [], depth = C.depth[0] + Math.floor(R() * (C.depth[1] - C.depth[0] + 1));
    let sum = 0;
    for (let k = 0; k <= depth; k++) sum += Math.pow((C.shrink[0] + C.shrink[1]) / 2, k);
    const grow = (p0, dir, len, r, d) => {
      const p1 = p0.clone().addScaledVector(dir, len), r1 = r * C.taper;
      segment(kit, parts, p0, p1, r, r1, C.sides, color);
      knob(kit, parts, p1, r1 * (d <= 0 ? 1.3 : 1.05), color);
      if (d <= 0) return;
      const n = 2 + (R() < C.three ? 1 : 0), a0 = R() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const az = a0 + (i / n) * Math.PI * 2 + (R() - 0.5) * 0.6, tilt = A.span(R, C.spread);
        const nd = dir.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(new THREE.Vector3(Math.cos(az), 0, Math.sin(az)), Math.sin(tilt));
        nd.y += C.lift; nd.normalize();
        grow(p1, nd, len * A.span(R, C.shrink), r1, d - 1);
      }
    };
    grow(new THREE.Vector3(0, -0.3, 0), up(kit), (h / sum) * 1.08, h * C.thick, depth);
    return merge(kit, parts);
  }
  /** 脑珊瑚：一个扁的大圆顶，表面一道道弯弯曲曲的沟（迷宫一样）；半径 rad（同一个位置的顶点挪得一样，面不裂开） */
  function brainCoral(kit, R, rad, color, detail) {
    const THREE = kit.THREE, C = CORAL.brain, geo = new THREE.IcosahedronGeometry(1, detail || C.detail), p = geo.attributes.position, v = new THREE.Vector3(), ph = [R() * 6, R() * 6, R() * 6];
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const s = Math.sin(v.x * 9 + Math.sin(v.z * 7 + ph[0]) * 1.6 + v.y * 4 + ph[1]) * Math.sin(v.z * 8 - v.x * 3 + Math.sin(v.y * 6 + ph[2]));
      const k = 1 - C.groove * (1 - smooth(0, 0.35, Math.abs(s)));
      p.setXYZ(i, v.x * k * rad, Math.max(-0.08, v.y) * k * rad * C.squash, v.z * k * rad);
    }
    return merge(kit, [{ geo, m: new THREE.Matrix4(), color }]);
  }
  /** 桌状珊瑚：一根粗短的柄，上面一大片歪着的平板（边缘不规则），一半的下面再一层小的；高 h、板子半径 rad */
  function tableCoral(kit, R, h, rad, color) {
    const THREE = kit.THREE, C = CORAL.table, parts = [], stem = A.span(R, C.stem) * rad;
    segment(kit, parts, new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, h, 0), stem * 1.5, stem, 7, color);
    const plate = (y, r, dx) => {
      const geo = new THREE.CylinderGeometry(r, r * 0.86, r * C.thick, 12, 1), p = geo.attributes.position, ph = R() * 6;
      for (let i = 0; i < p.count; i++) {   // 边缘不规则：按方向往外 / 往里一点
        const x = p.getX(i), z = p.getZ(i), d = Math.hypot(x, z);
        if (d > r * 0.5) { const k = 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(Math.atan2(z, x) * 3 + ph)) + 0.06 * Math.sin(Math.atan2(z, x) * 7 + ph * 2); p.setX(i, x * k); p.setZ(i, z * k); }
      }
      const m = new THREE.Matrix4().compose(new THREE.Vector3(dx, y, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler((R() - 0.5) * C.tilt, R() * 3, (R() - 0.5) * C.tilt)), new THREE.Vector3(1, 1, 1));
      parts.push({ geo, m, color });
    };
    plate(h, rad, 0);
    if (R() < C.second) { const y = h * (0.45 + R() * 0.2); segment(kit, parts, new THREE.Vector3(0, y - 0.1, 0), new THREE.Vector3(rad * 0.35, y, 0), stem * 0.8, stem * 0.7, 6, color); plate(y, rad * 0.55, rad * 0.35); }
    return merge(kit, parts);
  }
  /** 管状珊瑚（管风琴）：一簇竖着的管子，高矮粗细不一，管口是黑洞（朝上的那一面涂黑）；占地半径 rad、最高 h */
  function tubeCoral(kit, R, h, rad, color, hole) {
    const THREE = kit.THREE, C = CORAL.tube, parts = [], n = C.n[0] + Math.floor(R() * (C.n[1] - C.n[0] + 1));
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, d = i ? rad * (0.25 + R() * 0.5) : 0, r = rad * A.span(R, C.r), top = h * (i ? 0.45 + R() * 0.55 : 1);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      parts.push({ geo: new THREE.CylinderGeometry(r, r * 1.15, top + 0.2, 9, 1), m: new THREE.Matrix4().makeTranslation(x, (top - 0.2) / 2, z), color: (y, ny) => (ny > 0.9 && y > top - 0.05 ? hole : color(y, ny)) });
    }
    return merge(kit, parts);
  }
  /** 扇形珊瑚（海扇）：竖着的一片扇面，从根部在一个竖直的平面里一路分叉，枝很细、织成一张网；高 h */
  function fanCoral(kit, R, h, color) {
    const THREE = kit.THREE, C = CORAL.fan, parts = [];
    const grow = (p0, ang, len, r, d) => {
      const p1 = new THREE.Vector3(p0.x + Math.sin(ang) * len, p0.y + Math.cos(ang) * len, p0.z + (R() - 0.5) * len * 0.15);
      segment(kit, parts, p0, p1, r, r * 0.75, 5, color);
      if (d <= 0) { knob(kit, parts, p1, r * 0.9, color); return; }
      [-1, 1].forEach(s => grow(p1, ang + s * A.span(R, C.spread) + (R() - 0.5) * 0.15, len * (0.68 + R() * 0.12), r * 0.75, d - 1));
    };
    grow(new THREE.Vector3(0, -0.2, 0), (R() - 0.5) * 0.2, h * 0.3, h * C.thick, C.depth);
    return merge(kit, parts);
  }
  /** 指状珊瑚：一簇竖着的粗指头（上面圆头），高矮不一；占地半径 rad、最高 h */
  function fingerCoral(kit, R, h, rad, color) {
    const THREE = kit.THREE, C = CORAL.finger, parts = [], n = C.n[0] + Math.floor(R() * (C.n[1] - C.n[0] + 1));
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, d = i ? rad * (0.2 + R() * 0.5) : 0, r = rad * A.span(R, C.r), top = h * (i ? 0.5 + R() * 0.45 : 1) - r;
      const base = new THREE.Vector3(Math.cos(a) * d, -0.2, Math.sin(a) * d), tip = new THREE.Vector3(base.x * 1.25, top, base.z * 1.25);
      segment(kit, parts, base, tip, r * 1.1, r, 7, color);
      knob(kit, parts, tip, r * 1.02, color);
    }
    return merge(kit, parts);
  }

  /* ---------- 地台上的装饰 ---------- */
  /**
   * 一块地台上摆什么、摆在哪（纯函数，测试用同一份）：左右边带上 decor.band 个、左右的台子上 decor.ledge 个（hd2d-scene-art.js · zoneSpots），
   * 两两隔开，kinds 轮着摆。返回 [{ kind, x, z, y, size, on }]（局部坐标）
   */
  function zonePlan(z, key) {
    const art = ART[key];
    if (!art) return [];
    const D = art.decor, R = A.rand(z.id * 977 + seedOf(key)), spots = A.zoneSpots(z, D.size[0]);
    const band = A.pick(spots.filter(s => s.on === "band"), D.band, R, 1.3);
    const ledge = A.pick(spots.filter(s => s.on === "ledge"), D.ledge, R, 0.8);
    return band.concat(ledge).map((s, i) => ({ kind: D.kinds[i % D.kinds.length], x: s.x, z: s.z, y: s.y, size: Math.min(A.span(R, D.size), s.r), on: s.on }));
  }
  /** 挂钩：地台上的装饰（hd2d-world.js · buildZone 交过来）：一堆沙（扁的半球，光滑）、半埋的砂岩、一丛枯草、小脑珊瑚、一小簇指状珊瑚——都在装饰的半径里 */
  function zone(kit, g, z, ctx, r, look, a) {
    const THREE = kit.THREE, art = a.art, P = PALETTE[art.palette], R = A.rand(z.id * 131 + seedOf(a.key));
    const stone = P.stone ? stoneColor(kit, P, R) : null;
    zonePlan(z, a.key).forEach(d => {
      let m;
      if (d.kind === "drift") {
        m = kit.mesh(new THREE.SphereGeometry(d.size, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), kit.mat("art-drift-" + art.palette, P.sand[0], { roughness: 1, flatShading: false }), d.x, d.y - 0.01, d.z);
        m.scale.set(1, 0.36, 0.78); m.rotation.y = R() * Math.PI;
      } else if (d.kind === "shrub") {
        m = new THREE.Group();
        const mat = kit.mat("art-shrub-" + art.palette, P.shrub, { roughness: 1 });
        for (let i = 0; i < 7; i++) {   // 几根细枝从根部往外、往上斜着伸（尖不出半径）
          const a2 = (i / 7) * Math.PI * 2 + R() * 0.5, len = d.size * (0.8 + R() * 0.2), tilt = 0.5 + R() * 0.45;
          const tw = kit.mesh(new THREE.CylinderGeometry(0.008, 0.016, len, 4), mat, Math.cos(a2) * Math.sin(tilt) * len * 0.5, Math.cos(tilt) * len * 0.5, Math.sin(a2) * Math.sin(tilt) * len * 0.5);
          tw.rotation.set(Math.sin(a2) * tilt, 0, -Math.cos(a2) * tilt, "XZY");
          m.add(tw);
        }
        m.position.set(d.x, d.y, d.z);
      } else if (d.kind === "brain" && stone) {
        m = kit.mesh(brainCoral(kit, R, d.size, stone, 4), kit.mat("art-reef-" + art.palette, 0xffffff, { vertexColors: true, roughness: 1 }), d.x, d.y - 0.02, d.z);
        m.rotation.y = R() * Math.PI * 2;
      } else if (d.kind === "finger" && stone) {
        m = kit.mesh(fingerCoral(kit, R, d.size * 1.6, d.size * 0.6, stone), kit.mat("art-reef-" + art.palette, 0xffffff, { vertexColors: true, roughness: 1 }), d.x, d.y, d.z);
        m.rotation.y = R() * Math.PI * 2;
      } else {
        m = kit.mesh(rockGeo(kit, d.size, R, 0.6), kit.mat("art-rock-" + art.palette, P.rock[Math.floor(R() * P.rock.length)], { roughness: 1 }), d.x, d.y + d.size * 0.12, d.z);
        m.rotation.y = R() * Math.PI * 2;
      }
      m.userData.art = d.kind; m.userData.size = d.size;
      g.add(m);
    });
  }

  /* ---------- 远景：沙丘 ---------- */
  /** 沙丘有多高（纯函数）：几层沙丘叠起来（DUNE.waves：迎风坡缓、背风坡陡，沙脊横着弯），灯后面 start 开始、ramp 以内慢慢起伏起来，越远越高。
   *  z0 = 从哪开始起伏（灯后面 start）；seed 沙脊弯的相位。返回 { h, crest（这一点离主沙脊多近，0–1）} */
  function duneAt(x, z, z0, seed) {
    const back = z0 - z, ramp = smooth(0, 1, back / DUNE.ramp), grow = 1 + (DUNE.grow - 1) * clamp(back / DUNE.back, 0, 1), c = DUNE.crest;
    let h = 0, crest = 0;
    DUNE.waves.forEach((w, i) => {
      const u = (back * Math.cos(w.ang) + x * Math.sin(w.ang)) / w.len + w.wob[0] * Math.sin((x / w.len) * w.wob[1] + seed + i * 1.7), p = u - Math.floor(u);
      const prof = p < c ? Math.pow(p / c, 1.7) : Math.pow((1 - p) / (1 - c), 0.75);
      h += w.amp * prof;
      if (i === 0) crest = prof;
    });
    return { h: h * ramp * grow, crest: crest * ramp };
  }
  /** 一整片起伏的沙丘：x0–x1，灯后面 start 一直铺到 back；顶点颜色（几种沙的大片深浅、沙脊亮一点），光滑着色（迎光面亮、背光面暗）；
   *  吃场景的雾（远处进雾里，和天边接成一片；沙暴时被沙尘吞掉）。比地面低一点点起步（不和地面打架）。返回 { mesh, at(x, z) → 高度 } */
  function duneField(kit, env, P, R, b) {
    const THREE = kit.THREE, gY = L.CONFIG.groundY, z0 = b.minZ - L.CONFIG.lamps.back - DUNE.start, z1 = b.minZ - DUNE.back, seed = R() * 6.3;
    const [nx, nz] = DUNE.seg, pos = [], col = [], idx = [], sand = P.sand.map(c => new THREE.Color(c)), crest = new THREE.Color(P.crest), c = new THREE.Color();
    for (let j = 0; j <= nz; j++) {
      const z = z0 - (z0 - z1) * Math.pow(j / nz, 1.35);   // 近处密
      for (let i = 0; i <= nx; i++) {
        const x = env.x0 + (env.x1 - env.x0) * i / nx, d = duneAt(x, z, z0, seed);
        pos.push(x, gY - 0.03 + d.h, z);
        const v = 0.5 + 0.5 * Math.sin(x * 0.21 + z * 0.13) * Math.sin(x * 0.07 - z * 0.19), k = Math.floor(v * (sand.length - 1e-6));
        c.copy(sand[k]).lerp(sand[(k + 1) % sand.length], v * sand.length - k).lerp(crest, 0.45 * smooth(0.75, 1, d.crest)).multiplyScalar(0.97 + R() * 0.06);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b2 = a + 1, e = a + nx + 1, f = e + 1;
      idx.push(a, b2, f, a, f, e);   // 朝上（z 往后减小）
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = tag(new THREE.Mesh(geo, env.keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: false }))), "dunes");
    return { mesh, z0, at: (x, z) => gY - 0.03 + duneAt(x, z, z0, seed).h, crestAt: (x, z) => duneAt(x, z, z0, seed).crest };
  }
  /**
   * 一处风沙（AMBIENT.gust）：时不时从 o 吹起一阵——几团沙（横着拉长的软团）顺着风 wind 一缕缕飘出去、往上扬一点，越飘越大越淡；
   * 减少动态效果时不吹。返回 Group（userData.ambient.puffs = 那几团沙）
   */
  function gust(kit, env, P, i, o, wind, tex) {
    const THREE = kit.THREE, S = AMBIENT.gust, g = new THREE.Group(), r = A.rand(i * 613 + 7), puffs = [], jit = [];
    for (let k = 0; k < S.puffs; k++) {
      const sp = new THREE.Sprite(env.keep(new THREE.SpriteMaterial({ map: tex, color: P.dust, transparent: true, depthWrite: false, opacity: 0 })));
      sp.visible = false; sp.position.set(o.x, o.y, o.z); sp.scale.setScalar(S.size[0]);
      g.add(sp); puffs.push(sp); jit.push({ x: (r() - 0.5) * 0.6, y: r(), z: (r() - 0.5) * 0.4, k: 0.7 + r() * 0.6 });
    }
    const beat = A.beat(r, S.every, S.dur, 0.5 + r() * S.every[1]), drift = A.span(r, S.drift);
    g.userData.ambient = { kind: "gust", beat, puffs };
    env.anims.push((t, dt) => {
      const p = dt > 0 ? beat.step(dt) : -1;
      puffs.forEach((sp, k) => {
        const q = p < 0 ? -1 : (p - (k / S.puffs) * 0.55) / 0.45;
        sp.visible = q >= 0 && q <= 1;
        if (!sp.visible) return;
        const j = jit[k], s = (S.size[0] + (S.size[1] - S.size[0]) * q) * j.k;
        sp.position.set(o.x + wind.x * drift * q + j.x, o.y + S.rise * q * (0.5 + j.y), o.z + wind.z * drift * q + j.z);
        sp.scale.set(s * S.stretch, s, 1);
        sp.material.opacity = S.opacity * Math.sin(Math.PI * q);
      });
    });
    env.group.add(tag(g, "gust"));
    return g;
  }
  /** 风往哪吹（这一片远景里都一样：往左或往右，稍微往后） */
  const windOf = (R) => { const s = R() < 0.5 ? -1 : 1, z = -0.15 - R() * 0.15, l = Math.hypot(1, z); return { x: s / l, z: z / l }; };
  /** 沙丘：战场后面一整片起伏的沙丘，几处沙脊上时不时吹起风沙 */
  function duneScene(kit, env, P, R, b) {
    const f = duneField(kit, env, P, R, b), wind = windOf(R), tex = env.keep(kit.smokeTexture()), spots = [];
    env.group.add(f.mesh);
    // 风沙从看得到的沙脊上吹起（灯后面 3–18，横着在画面里），几处两两隔开
    for (let tries = 0; spots.length < DUNE.gusts && tries < 400; tries++) {
      const z = f.z0 - 3 - R() * 15, x = env.cx + (R() * 2 - 1) * (env.hx + 4);
      if (f.crestAt(x, z) < 0.85 || spots.some(q => Math.hypot(q.x - x, q.z - z) < 5)) continue;
      spots.push({ x, y: f.at(x, z) + 0.15, z });
    }
    spots.forEach((o, i) => gust(kit, env, P, i, o, wind, tex));
  }

  /* ---------- 远景：沙珊瑚台地 ---------- */
  /** 沙珊瑚台地：战场后面一排排砂岩的珊瑚（近的矮、越远越高），各种形状轮着摆，脚下堆着沙；偶尔吹起一阵风沙。都在灯后面 */
  function coralScene(kit, env, P, R, b) {
    const THREE = kit.THREE, gY = L.CONFIG.groundY, lampZ = b.minZ - L.CONFIG.lamps.back, color = stoneColor(kit, P, R), hole = new THREE.Color(P.hole);
    const mat = env.keep(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 }));
    const sandM = env.keep(new THREE.MeshStandardMaterial({ color: P.sand[0], roughness: 1, metalness: 0 }));
    const cam = env.cam, halfAt = (z) => (cam && cam.pos ? (cam.pos.z - z) * Math.tan(((cam.fov || 22) * Math.PI) / 360) * (cam.aspect || 1.6) : env.hx + 6) * 1.05;
    const tops = [];
    CORAL.rows.forEach((row, ri) => {
      for (let i = 0; i < row.n; i++) {
        const kind = row.kinds[i % row.kinds.length], h = A.span(R, row.h);
        const geo = kind === "branch" ? branchCoral(kit, R, h, color) : kind === "brain" ? brainCoral(kit, R, h * 0.9, color)
          : kind === "table" ? tableCoral(kit, R, h, h * 0.55, color) : kind === "tube" ? tubeCoral(kit, R, h, h * 0.42, color, hole)
            : kind === "fan" ? fanCoral(kit, R, h, color) : fingerCoral(kit, R, h, h * 0.4, color);
        geo.computeBoundingBox();
        const bb = geo.boundingBox, foot = Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z);
        const reach = Math.max(Math.hypot(Math.max(-bb.min.x, bb.max.x), Math.max(-bb.min.z, bb.max.z)), foot * CORAL.mound[0]);   // 转到哪个方向都不超出（连脚下的沙）
        const z = Math.min(lampZ - A.span(R, row.back), lampZ - 0.6 - reach), half = halfAt(z);   // 整座都在灯后面
        const x = env.cx + ((i + 0.5) / row.n * 2 - 1) * half + (R() - 0.5) * (half / row.n);
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, gY - 0.05, z);
        m.rotation.y = kind === "fan" ? (R() - 0.5) * 0.7 : R() * Math.PI * 2;   // 扇面大致对着镜头
        env.group.add(tag(m, "coral"));
        m.userData.kind = kind;
        // 脚下堆的沙
        const mound = new THREE.Mesh(new THREE.SphereGeometry(foot * CORAL.mound[0], 14, 5, 0, Math.PI * 2, 0, Math.PI / 2), sandM);
        mound.scale.y = Math.min(1, (h * CORAL.mound[1]) / Math.max(0.1, foot * CORAL.mound[0])); mound.position.set(x, gY - 0.04, z);
        env.group.add(tag(mound, "sand"));
        if (ri > 0) tops.push({ x, y: gY + Math.min(bb.max.y, 2.5), z });
      }
    });
    // 风沙：从中间那排珊瑚脚下吹起
    const wind = windOf(R), tex = env.keep(kit.smokeTexture());
    for (let i = 0; i < CORAL.gusts && i < tops.length; i++) { const o = tops[Math.floor((i + 0.5) * tops.length / CORAL.gusts)]; gust(kit, env, P, i, { x: o.x, y: gY + 0.4, z: o.z + 0.5 }, wind, tex); }
  }

  /* ---------- 挂钩：远景 ---------- */
  /** 天边画的远景：沙丘画一层层远处的沙丘（一望无际，不画桌山）；沙珊瑚台地用以前沙漠的那条（远处的桌山、台地） */
  function band(kit, colors, seed, a) {
    if (!a.art.backdrop.dunes) return kit.bandTexture("desert", colors, seed);
    const THREE = kit.THREE, W = 2048, H = 256, c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"), r = A.rand(seed);
    [colors.far, colors.near].forEach((col, layer) => {   // 两层平缓起伏的沙丘线（整数个周期，首尾相接）
      const k = [2 + Math.floor(r() * 3), 5 + Math.floor(r() * 4), 11 + Math.floor(r() * 5)], ph = [r() * 6.3, r() * 6.3, r() * 6.3], base = H * (layer ? 0.66 : 0.52);
      g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) { const u = (x / W) * Math.PI * 2; g.lineTo(x, base - 18 * Math.sin(u * k[0] + ph[0]) - 9 * Math.sin(u * k[1] + ph[1]) - 4 * Math.abs(Math.sin(u * k[2] + ph[2]))); }
      g.lineTo(W, H); g.fill();
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  }
  /** 中景、战场周围的装饰、环境动画（hd2d-backdrop.js · buildBackdrop 交过来）：沙漠没有坑，地台外面的地一直铺到天幕（不返回 groundEdge） */
  function backdrop(kit, env, a) {
    const art = a.art, P = PALETTE[art.palette], b = { minX: env.cx - env.hx, maxX: env.cx + env.hx, minZ: env.cz - env.hz, maxZ: env.cz + env.hz };
    const R = A.rand(seedOf(a.key) + Math.round(env.hx * 10) + Math.round(env.hz * 7));
    if (art.backdrop.dunes) duneScene(kit, env, P, R, b);
    if (art.backdrop.coral) coralScene(kit, env, P, R, b);
    return {};
  }
  /** 天幕挪到多远：沙丘一望无际（DUNE.sky），珊瑚一排排往后（CORAL.sky） */
  function skyGap(bounds, cam, a) {
    return a.art.backdrop.dunes ? DUNE.sky : a.art.backdrop.coral ? CORAL.sky : null;
  }

  const pack = { name: "desert", scenes: SCENES, grounds: GROUNDS, art: ART, textures: TEXTURES, decals: {}, zone, band, backdrop, skyGap };
  A.add(pack);
  return Object.assign({ PALETTE, DUNE, CORAL, AMBIENT, zonePlan, duneAt, seedOf }, pack);
});
