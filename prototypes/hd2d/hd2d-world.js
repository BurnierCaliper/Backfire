/* Antlerscale: Backfire · HD-2D 战场原型 · 沙盘地台、间隔、装饰
 *
 * 全部用几何体拼出来，贴图是 canvas 画的程序纹理，没有图片文件。
 * 输入是 hd2d-layout.js 算出来的 zones / gaps；这里只管把它们变成 three.js 的物体。
 *
 *   const ctx = { anim: [], lamps: [], theme: "dusk" };
 *   const group = buildZone(zone, ctx);     // 每帧调 ctx.anim 里的函数：fn(t, dt)（减少动态效果时 t 停住、dt = 0）
 *   const group = buildGap(gap, ctx);
 * 路灯放进 ctx.lamps（{ light, bulb, bulbColor, base, wait, flick, seed }），由场景每帧管亮度和偶尔的闪烁。
 */
import * as THREE from "three";

/* ---------- 配置 ---------- */
const WORLD = {
  maxLamps: 5,              // 带点光源的路灯最多几盏（再多的只摆灯具、不发光，省显卡）
  maxFxLights: 3,           // 酸液 / 火 / 电的点光源最多几盏
  texRepeat: 0.28,          // 地台顶面贴图：每个单位长度铺多少（0.28 ≈ 每 3.6 格一块）
  sideRepeat: 0.5,          // 地台侧面贴图：每 2 个单位一块（砖 / 铁皮 / 岩层）
  decals: { oil: 3, crack: 3, gravel: 4 },   // 每块地台上的油渍 / 裂缝 / 碎石贴花各几块
  pebbles: 26,              // 每块地台上零散的小石子
  trim: { w: 0.07, h: 0.05, emissive: 0.32 },   // 地台上沿的一圈亮边（轮廓光）
  acidBubbles: 11,          // 酸液里同时冒的泡
  colors: {
    rust: 0x8a4a2a, metal: 0x58606a, dark: 0x2c2a28, concrete: 0x77716a, tan: 0xb89a68,
    acid: 0x78d02a, fire: 0xff6a2a, ice: 0xbfeaff, electric: 0xfff27a, energy: 0x35e0c0, harmonic: 0xc07cf0, heal: 0x8fe05a,
    coral1: 0xff7a8a, coral2: 0xff9a5a, hazard: 0xf2c230, warn: 0xff3b2e, abyss: 0x9a5cff
  },
  /** 各光影主题下地台亮边的颜色（和场景的轮廓光同色） */
  rimColor: { day: 0xfff0c8, dusk: 0xffb090, night: 0x8fb8ff }
};

/** 危墙：一排水泥块。高度 / 厚度都按桌面宽度下好看的比例定，手机上同样的比例 */
const WALL = { blocks: 6, baseH: 0.75, varyH: 0.12, thickRatio: 0.2, maxThick: 0.55 };

/* ---------- 随机数 / 贴图 ---------- */
export function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const texCache = new Map();
function canvasTex(key, size, draw, opt) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  draw(g, size, rng(key.length * 131 + size));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;   // 像素感：放大不糊
  t.anisotropy = 4;
  if (opt && opt.repeat) t.repeat.set(opt.repeat, opt.repeat);
  if (opt && opt.clamp) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  if (opt && opt.smooth) t.magFilter = THREE.LinearFilter;
  t.userData.shared = true;
  texCache.set(key, t);
  return t;
}

function speckle(g, s, r, n, light, dark) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = r() < 0.5 ? light : dark;
    g.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2);
  }
}
/** 一条歪歪扭扭、会分叉的裂缝 */
function crack(g, r, x, y, len, w, depth) {
  g.lineWidth = w; g.beginPath(); g.moveTo(x, y);
  let a = r() * Math.PI * 2;
  for (let i = 0; i < len; i++) {
    a += (r() - 0.5) * 0.9; x += Math.cos(a) * (3 + r() * 5); y += Math.sin(a) * (3 + r() * 5); g.lineTo(x, y);
    if (depth > 0 && r() < 0.18) { g.stroke(); crack(g, r, x, y, Math.floor(len / 2), Math.max(0.6, w * 0.6), depth - 1); g.lineWidth = w; g.beginPath(); g.moveTo(x, y); }
  }
  g.stroke();
}
/** 一摊油渍：几块叠在一起的深色椭圆，边上一圈淡淡的彩虹光 */
function oilBlob(g, r, cx, cy, rad) {
  for (let k = 0; k < 6; k++) {
    g.fillStyle = `rgba(14,10,8,${0.22 + r() * 0.2})`;
    g.beginPath(); g.ellipse(cx + (r() - 0.5) * rad, cy + (r() - 0.5) * rad * 0.7, rad * (0.4 + r() * 0.6), rad * (0.25 + r() * 0.4), r() * 3, 0, 7); g.fill();
  }
  g.lineWidth = 1.2;
  ["rgba(120,80,200,.16)", "rgba(60,160,170,.14)", "rgba(200,170,60,.12)"].forEach((c, i) => {
    g.strokeStyle = c; g.beginPath(); g.ellipse(cx, cy, rad * (0.75 + i * 0.12), rad * (0.5 + i * 0.08), 0.3, 0, 7); g.stroke();
  });
}
/** 一撮碎石：亮面 + 暗面两个像素 */
function gravel(g, r, cx, cy, rad, n) {
  for (let i = 0; i < n; i++) {
    const a = r() * 7, d = Math.sqrt(r()) * rad, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, s = 1 + r() * 2.2;
    g.fillStyle = "rgba(0,0,0,.45)"; g.fillRect(x + 1, y + 1, s, s);
    g.fillStyle = r() < 0.5 ? "rgba(190,180,165,.95)" : "rgba(140,130,118,.95)"; g.fillRect(x, y, s, s);
  }
}

const TEX = {
  /** 水泥地：板缝、深浅不一的污渍、分叉的裂缝、油渍、碎石、褪色的黄线 */
  concrete: () => canvasTex("concrete2", 256, (g, s, r) => {
    g.fillStyle = "#6a645c"; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 14; i++) {   // 大块的深浅
      g.fillStyle = r() < 0.5 ? `rgba(255,250,235,${0.03 + r() * 0.04})` : `rgba(20,14,10,${0.04 + r() * 0.06})`;
      g.beginPath(); g.ellipse(r() * s, r() * s, 20 + r() * 50, 14 + r() * 36, r() * 3, 0, 7); g.fill();
    }
    speckle(g, s, r, 2600, "rgba(255,255,255,.10)", "rgba(0,0,0,.18)");
    g.fillStyle = "rgba(242,194,48,.20)"; g.fillRect(s * 0.08, s * 0.71, s * 0.36, 5);   // 褪色的黄线
    g.strokeStyle = "rgba(0,0,0,.45)"; g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, s - 3, s - 3);                       // 板缝
    g.beginPath(); g.moveTo(s * 0.5, 0); g.lineTo(s * 0.5, s); g.stroke();
    g.strokeStyle = "rgba(255,255,255,.07)"; g.lineWidth = 1;   // 板缝的亮边
    g.beginPath(); g.moveTo(s * 0.5 + 2, 0); g.lineTo(s * 0.5 + 2, s); g.stroke();
    g.strokeStyle = "rgba(0,0,0,.5)";
    for (let k = 0; k < 6; k++) crack(g, r, r() * s, r() * s, 8 + Math.floor(r() * 8), 1.4, 2);
    for (let k = 0; k < 3; k++) oilBlob(g, r, r() * s, r() * s, 10 + r() * 16);
    for (let k = 0; k < 5; k++) gravel(g, r, r() * s, r() * s, 6 + r() * 10, 10 + Math.floor(r() * 14));
  }),
  metal: () => canvasTex("metal", 128, (g, s, r) => {
    g.fillStyle = "#4b4741"; g.fillRect(0, 0, s, s);
    speckle(g, s, r, 400, "rgba(255,255,255,.10)", "rgba(0,0,0,.25)");
    g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(0, s / 2 - 1, s, 2); g.fillRect(s / 2 - 1, 0, 2, s);
    g.fillStyle = "#8c8579";
    [[10, 10], [s - 10, 10], [10, s - 10], [s - 10, s - 10], [s / 2 + 10, s / 2 + 10], [s / 2 - 10, s / 2 - 10]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); });
  }),
  sand: () => canvasTex("sand", 128, (g, s, r) => {
    g.fillStyle = "#cfae6e"; g.fillRect(0, 0, s, s);
    speckle(g, s, r, 600, "rgba(255,240,200,.30)", "rgba(120,80,30,.25)");
    g.strokeStyle = "rgba(120,80,30,.22)"; g.lineWidth = 2;
    for (let k = 0; k < 7; k++) { const y = (k + 0.5) * s / 7; g.beginPath(); for (let x = 0; x <= s; x += 8) g.lineTo(x, y + Math.sin(x * 0.12 + k) * 3); g.stroke(); }
  }),
  /** 侧面：砖墙（灰缝、每块砖深浅不一、缺角） */
  brick: () => canvasTex("brick", 128, (g, s, r) => {
    g.fillStyle = "#5a524a"; g.fillRect(0, 0, s, s);              // 灰缝
    const rows = 8, bh = s / rows, bw = s / 4;
    for (let y = 0; y < rows; y++) {
      const off = (y % 2) * bw / 2;
      for (let x = -1; x < 5; x++) {
        const v = r();
        g.fillStyle = v < 0.3 ? "#7c4433" : v < 0.6 ? "#8a5038" : v < 0.85 ? "#6e3d2e" : "#95604a";
        g.fillRect(x * bw + off + 1.5, y * bh + 1.5, bw - 3, bh - 3);
        g.fillStyle = "rgba(255,230,200,.10)"; g.fillRect(x * bw + off + 1.5, y * bh + 1.5, bw - 3, 1.5);   // 上沿受光
        if (r() < 0.2) { g.fillStyle = "#5a524a"; g.fillRect(x * bw + off + 1.5 + r() * (bw - 8), y * bh + 1.5, 4, 3); }   // 缺角
      }
    }
    speckle(g, s, r, 500, "rgba(255,255,255,.08)", "rgba(0,0,0,.22)");
    g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(0, s * 0.82, s, s * 0.18);   // 底部泛潮
  }),
  /** 侧面：瓦楞铁皮（竖条棱、铆钉、锈迹往下流） */
  sheet: () => canvasTex("sheet", 128, (g, s, r) => {
    for (let x = 0; x < s; x += 8) {
      const grd = g.createLinearGradient(x, 0, x + 8, 0);
      grd.addColorStop(0, "#4a5058"); grd.addColorStop(0.45, "#7a828c"); grd.addColorStop(1, "#3e434a");
      g.fillStyle = grd; g.fillRect(x, 0, 8, s);
    }
    for (let i = 0; i < 9; i++) {   // 锈
      const x = r() * s, w = 3 + r() * 10, h = 20 + r() * 80;
      const grd = g.createLinearGradient(0, r() * 30, 0, h);
      grd.addColorStop(0, "rgba(150,70,30,.75)"); grd.addColorStop(1, "rgba(150,70,30,0)");
      g.fillStyle = grd; g.fillRect(x, 0, w, h);
    }
    g.fillStyle = "rgba(0,0,0,.4)"; g.fillRect(0, s / 2 - 1, s, 2);
    g.fillStyle = "#a59c8e";
    for (let x = 4; x < s; x += 16) { g.fillRect(x, 4, 2, 2); g.fillRect(x, s / 2 + 4, 2, 2); }
    speckle(g, s, r, 300, "rgba(255,255,255,.08)", "rgba(0,0,0,.2)");
  }),
  /** 侧面：岩层（一层层颜色、厚薄不同，夹着碎石和裂纹） */
  strata: () => canvasTex("strata", 128, (g, s, r) => {
    let y = 0;
    const cols = ["#7a6650", "#8f7a5e", "#6a5644", "#a08868", "#5e4c3c", "#86704f"];
    while (y < s) {
      const h = 6 + r() * 16;
      g.fillStyle = cols[Math.floor(r() * cols.length)];
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= s; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + y) * 1.5);
      g.lineTo(s, y + h); g.lineTo(0, y + h); g.fill();
      g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(0, y + h - 1, s, 1.5);
      y += h;
    }
    speckle(g, s, r, 700, "rgba(255,240,210,.12)", "rgba(0,0,0,.22)");
    g.strokeStyle = "rgba(0,0,0,.35)";
    for (let k = 0; k < 4; k++) crack(g, r, r() * s, r() * s, 5, 1, 0);
  }),
  hazard: () => canvasTex("hazard", 64, (g, s) => {
    g.fillStyle = "#f2c230"; g.fillRect(0, 0, s, s);
    g.fillStyle = "#1a1511";
    for (let i = -s; i < s * 2; i += 24) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 12, 0); g.lineTo(i + 12 - s, s); g.lineTo(i - s, s); g.fill(); }
  }),
  acid: () => canvasTex("acid", 128, (g, s, r) => {
    g.fillStyle = "#3f9a1c"; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(190,255,90,${0.10 + r() * 0.2})`; g.beginPath(); g.ellipse(r() * s, r() * s, 6 + r() * 16, 3 + r() * 8, r() * 3, 0, 7); g.fill(); }
  }),
  spiral: () => canvasTex("spiral", 256, (g, s) => {
    g.fillStyle = "#c9a35e"; g.fillRect(0, 0, s, s);
    g.translate(s / 2, s / 2);
    for (let k = 0; k < 7; k++) {
      g.strokeStyle = k % 2 ? "rgba(255,235,180,.55)" : "rgba(110,70,25,.5)"; g.lineWidth = 10;
      g.beginPath();
      for (let a = 0; a < 6.3 * 2; a += 0.15) { const rad = 6 + a * 8 + k * 0.1; g.lineTo(Math.cos(a + k * 0.9) * rad, Math.sin(a + k * 0.9) * rad); }
      g.stroke();
    }
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, 40); grd.addColorStop(0, "rgba(40,25,10,.9)"); grd.addColorStop(1, "rgba(40,25,10,0)");
    g.fillStyle = grd; g.beginPath(); g.arc(0, 0, 40, 0, 7); g.fill();
  }),
  /* 贴花（透明底）：油渍 / 裂缝 / 碎石 / 沙纹，零散地铺在地台上，打破贴图的重复感 */
  decalOil: () => canvasTex("decal-oil", 128, (g, s, r) => { oilBlob(g, r, s / 2, s / 2, s * 0.26); }, { clamp: true, smooth: true }),
  decalCrack: () => canvasTex("decal-crack", 128, (g, s, r) => {
    g.strokeStyle = "rgba(10,8,6,.75)"; crack(g, r, s / 2, s / 2, 10, 2, 3);
    g.strokeStyle = "rgba(255,255,255,.08)"; crack(g, rng(5), s / 2 + 1, s / 2 + 1, 10, 1, 1);
  }, { clamp: true }),
  decalGravel: () => canvasTex("decal-gravel", 128, (g, s, r) => { gravel(g, r, s / 2, s / 2, s * 0.36, 70); }, { clamp: true }),
  decalRipple: () => canvasTex("decal-ripple", 128, (g, s, r) => {
    g.strokeStyle = "rgba(120,80,30,.35)"; g.lineWidth = 2;
    for (let k = 0; k < 5; k++) { g.beginPath(); for (let x = 8; x <= s - 8; x += 6) g.lineTo(x, 30 + k * 16 + Math.sin(x * 0.1 + k) * 4); g.stroke(); }
  }, { clamp: true })
};
const tex = (name) => TEX[name]();

const matCache = new Map();
function mat(key, color, opt) {
  const k = key + ":" + color;   // 同一个 key 的参数永远一样（opt 里有贴图，不能拿来序列化）
  if (matCache.has(k)) return matCache.get(k);
  const m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.9, metalness: 0.0, flatShading: true }, opt || {}));
  m.userData.shared = true;
  matCache.set(k, m);
  return m;
}
const glow = (color, k, opt) => {
  // 会发光的材质：自发光 > 1 才会被泛光抓到
  const m = new THREE.MeshStandardMaterial(Object.assign({ color: 0x111111, emissive: color, emissiveIntensity: k || 2, roughness: 0.4, flatShading: true }, opt || {}));
  return m;
};

function mesh(geo, material, x, y, z, cast = true, recv = true) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x || 0, y || 0, z || 0);
  m.castShadow = cast; m.receiveShadow = recv;
  return m;
}

/* ---------- 地台 ---------- */
/** 顶面贴图；side 是侧面材质：砖（水泥地）、铁皮（酸液 / 电 / 能量这些铁板地）、岩层（高地、沙地、深渊、冰） */
const TOP_STYLE = {
  concrete: { tex: "concrete", tint: 0xffffff, side: "brick" },
  acid: { tex: "metal", tint: 0xd8e0d0, side: "sheet" },
  quicksand: { tex: "sand", tint: 0xffffff, side: "strata", sideTint: 0xe8c890 },
  coral: { tex: "sand", tint: 0xf0cfb8, side: "strata", sideTint: 0xf0c8a8 },
  abyss: { tex: "concrete", tint: 0xb8b0b0, side: "strata", sideTint: 0xa89cb0 },
  highland: { tex: "concrete", tint: 0xd8d0c4, side: "strata" },
  fire: { tex: "concrete", tint: 0xe0b8a0, side: "brick" },
  ice: { tex: "concrete", tint: 0xd0e4f0, side: "strata", sideTint: 0xc8d8e8 },
  electric: { tex: "metal", tint: 0xffffff, side: "sheet" },
  energy: { tex: "metal", tint: 0xd0f0ea, side: "sheet" },
  harmonic: { tex: "concrete", tint: 0xe4d0f0, side: "brick" },
  heal: { tex: "concrete", tint: 0xd8f0d0, side: "brick" }
};

function zoneBody(z) {
  const hw = z.w / 2, hd = z.d / 2;
  const s = new THREE.Shape();
  s.moveTo(-hw, -hd); s.lineTo(hw, -hd); s.lineTo(hw, hd); s.lineTo(-hw, hd); s.closePath();
  if (z.hole > 0) { const p = new THREE.Path(); p.absarc(0, 0, z.hole, 0, Math.PI * 2, true); s.holes.push(p); }
  const geo = new THREE.ExtrudeGeometry(s, { depth: z.h, bevelEnabled: false, curveSegments: 28 });
  geo.rotateX(-Math.PI / 2);   // 挤出方向 +z → +y，顶面正好在 y = h
  const style = TOP_STYLE[z.kind] || TOP_STYLE.concrete;
  const t = tex(style.tex);
  t.repeat.set(WORLD.texRepeat, WORLD.texRepeat);
  const top = mat("top-" + style.tex, style.tint, { map: t });
  const st = tex(style.side);
  st.repeat.set(WORLD.sideRepeat, WORLD.sideRepeat);
  const side = mat("side-" + style.side, style.sideTint || 0xffffff, { map: st, roughness: style.side === "sheet" ? 0.55 : 0.95, metalness: style.side === "sheet" ? 0.35 : 0 });
  const m = new THREE.Mesh(geo, [top, side]);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** 地台上沿一圈细亮边：主光 / 轮廓光照到边角的那一道高光（颜色跟着光影主题） */
function addTrim(g, z, theme) {
  const T = WORLD.trim, y = z.h + T.h / 2 - 0.01;
  const rimC = WORLD.rimColor[theme] || WORLD.rimColor.day;
  const m = mat("trim-" + (theme || "day"), 0xd9d2c4, { emissive: rimC, emissiveIntensity: T.emissive, roughness: 0.45 });
  const hw = z.w / 2, hd = z.d / 2;
  g.add(mesh(new THREE.BoxGeometry(z.w, T.h, T.w), m, 0, y, hd - T.w / 2, false, true));     // 前沿（朝镜头，最显眼）
  g.add(mesh(new THREE.BoxGeometry(z.w, T.h, T.w), m, 0, y, -hd + T.w / 2, false, true));
  g.add(mesh(new THREE.BoxGeometry(T.w, T.h, z.d), m, -hw + T.w / 2, y, 0, false, true));
  g.add(mesh(new THREE.BoxGeometry(T.w, T.h, z.d), m, hw - T.w / 2, y, 0, false, true));
}

/** 地面细节：油渍 / 裂缝 / 碎石贴花，加一把小石子。避开黑洞，酸液池上不铺 */
function addGroundDetail(g, z, r) {
  const sandy = z.kind === "quicksand" || z.kind === "coral";
  const pool = z.kind === "acid" ? { hw: (z.w - 1.6) / 2, hd: (z.d - 1.6) / 2 } : null;
  const ok = (x, zz, rad) => {
    if (Math.abs(x) > z.w / 2 - rad - 0.15 || Math.abs(zz) > z.d / 2 - rad - 0.15) return false;
    if (z.hole > 0 && Math.hypot(x, zz) < z.hole + rad + 0.2) return false;
    if (pool && Math.abs(x) < pool.hw + rad && Math.abs(zz) < pool.hd + rad) return false;
    return true;
  };
  const place = (kind, n, size) => {
    const tx = tex(kind);
    const m = new THREE.MeshStandardMaterial({ map: tx, transparent: true, depthWrite: false, roughness: kind === "decalOil" ? 0.28 : 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    for (let i = 0, tries = 0; i < n && tries < n * 8; tries++) {
      const s = size[0] + r() * (size[1] - size[0]), x = (r() * 2 - 1) * z.w / 2, zz = (r() * 2 - 1) * z.d / 2;
      if (!ok(x, zz, s / 2)) continue;
      const d = new THREE.Mesh(new THREE.PlaneGeometry(s, s), m);
      d.rotation.set(-Math.PI / 2, 0, r() * Math.PI * 2);
      d.position.set(x, z.h + 0.006 + i * 0.001, zz); d.receiveShadow = true; d.renderOrder = 1;
      g.add(d); i++;
    }
  };
  const D = WORLD.decals;
  if (sandy) place("decalRipple", D.oil + D.crack, [1.2, 2.2]);
  else {
    place("decalOil", D.oil, [0.8, 1.6]);
    place("decalCrack", D.crack, [1.0, 1.9]);
  }
  place("decalGravel", D.gravel, [0.7, 1.3]);
  // 小石子：一个 InstancedMesh
  const stones = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.06, 0), mat(sandy ? "pebble-s" : "pebble", sandy ? 0xb8996a : 0x8a8378), WORLD.pebbles);
  const o = new THREE.Object3D();
  let n = 0;
  for (let tries = 0; n < WORLD.pebbles && tries < WORLD.pebbles * 6; tries++) {
    const x = (r() * 2 - 1) * (z.w / 2 - 0.25), zz = (r() * 2 - 1) * (z.d / 2 - 0.25);
    if (!ok(x, zz, 0.08)) continue;
    const k = 0.6 + r() * 1.3;
    o.position.set(x, z.h + 0.03 * k, zz); o.rotation.set(r() * 3, r() * 3, r() * 3); o.scale.set(k, k * 0.65, k);
    o.updateMatrix(); stones.setMatrixAt(n++, o.matrix);
  }
  stones.count = n; stones.castShadow = false; stones.receiveShadow = true;
  g.add(stones);
}

/** 一块地台（含场地效果和装饰）。位置已经放到 (cx, 0, cz) */
export function buildZone(z, ctx) {
  const g = new THREE.Group();
  g.position.set(z.cx, 0, z.cz);
  const r = rng(z.id * 97 + 13);
  g.add(zoneBody(z));
  g.add(mesh(new THREE.BoxGeometry(z.w + 0.4, 0.3, z.d + 0.4), mat("skirt", 0x2a2622), 0, -0.15, 0, false, true));   // 底座
  addTrim(g, z, ctx.theme);
  if (z.highland) {                                                    // 高地：前沿两级台阶
    g.add(mesh(new THREE.BoxGeometry(z.w * 0.5, z.h * 0.34, 0.9), mat("step", 0x5d574f, { map: tex("concrete") }), 0, z.h * 0.17, z.d / 2 + 0.45));
    g.add(mesh(new THREE.BoxGeometry(z.w * 0.4, z.h * 0.68, 0.6), mat("step", 0x5d574f, { map: tex("concrete") }), 0, z.h * 0.34, z.d / 2 + 0.2));
  }
  addGroundDetail(g, z, r);
  const fx = new Set(z.effects);
  if (fx.has("abyss")) addAbyss(g, z, ctx);
  if (fx.has("acid")) addAcid(g, z, ctx, r);
  if (fx.has("quicksand")) addQuicksand(g, z, ctx);
  if (fx.has("coral")) addCoral(g, z, r);
  if (fx.has("fire")) addFire(g, z, ctx, r);
  if (fx.has("ice")) addIce(g, z, r);
  if (fx.has("electric")) addElectric(g, z, ctx);
  ["energy", "harmonic", "heal"].forEach(k => { if (fx.has(k)) addRing(g, z, k, ctx); });
  decorate(g, z, r, ctx);
  return g;
}

/** 深渊：黑洞 + 洞沿一圈紫光（慢慢地一明一暗，像在呼吸）+ 洞里往上冒的一点紫雾 */
function addAbyss(g, z, ctx) {
  const R = z.hole;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.92, z.h + 3, 28, 1, true), new THREE.MeshBasicMaterial({ color: 0x050308, side: THREE.BackSide }));
  wall.position.y = z.h / 2 - 1.2; g.add(wall);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R * 0.95, 28), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -2.6; g.add(floor);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R + 0.04, 0.06, 6, 40), glow(WORLD.colors.abyss, 2.2));
  rim.rotation.x = Math.PI / 2; rim.position.y = z.h + 0.03; g.add(rim);
  // 洞口往下一点的一层紫色光晕（加色混合），跟着洞沿一起呼吸
  const haze = new THREE.Mesh(new THREE.CircleGeometry(R * 0.98, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(WORLD.colors.abyss).multiplyScalar(0.9), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  haze.rotation.x = -Math.PI / 2; haze.position.y = z.h - 0.35; g.add(haze);
  // 紫雾：几颗慢慢往上飘、到洞口上方淡掉的光点
  const n = 14, pos = new Float32Array(n * 3), seeds = [];
  const rr = rng(z.id * 7 + 3);
  for (let i = 0; i < n; i++) seeds.push({ a: rr() * Math.PI * 2, d: Math.sqrt(rr()) * R * 0.85, p: rr(), v: 0.18 + rr() * 0.2 });
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const motes = new THREE.Points(geo, new THREE.PointsMaterial({ color: new THREE.Color(0xc79bff).multiplyScalar(1.6), size: 0.09, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  motes.frustumCulled = false; g.add(motes);
  ctx.anim.push((time) => {
    const breath = 0.5 + 0.5 * Math.sin(time * 1.25);
    rim.material.emissiveIntensity = 1.3 + 1.7 * breath;
    haze.material.opacity = 0.16 + 0.26 * breath;
    seeds.forEach((s, i) => {
      const k = (time * s.v + s.p) % 1;
      pos[i * 3] = Math.cos(s.a + time * 0.2) * s.d; pos[i * 3 + 1] = z.h - 0.9 + k * 1.6; pos[i * 3 + 2] = Math.sin(s.a + time * 0.2) * s.d;
    });
    geo.attributes.position.needsUpdate = true;
  });
}

/** 酸液池：液面慢慢流动、微微明暗；泡泡此起彼伏地冒上来，到顶啪地破掉，留一圈涟漪 */
function addAcid(g, z, ctx, r) {
  const w = z.w - 1.6, d = z.d - 1.6;
  const t = tex("acid").clone(); t.needsUpdate = true; t.repeat.set(w / 3, d / 3);
  const poolMat = glow(WORLD.colors.acid, 1.5, { map: t, emissiveMap: t, color: 0x224410, roughness: 0.25 });
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(w, d), poolMat);
  pool.rotation.x = -Math.PI / 2; pool.position.y = z.h + 0.04; pool.receiveShadow = true;
  g.add(pool);
  const rimM = mat("rim", 0x3a3631, { map: tex("metal") });
  [[0, -d / 2, w + 0.3, 0.3], [0, d / 2, w + 0.3, 0.3]].forEach(([x, zz, ww, dd]) => g.add(mesh(new THREE.BoxGeometry(ww, 0.14, dd), rimM, x, z.h + 0.07, zz)));
  [[-w / 2, 0], [w / 2, 0]].forEach(([x, zz]) => g.add(mesh(new THREE.BoxGeometry(0.3, 0.14, d), rimM, x, z.h + 0.07, zz)));
  const bubbleM = glow(0xc8ff70, 2.4), popM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd8ff90).multiplyScalar(1.8), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const bubbleGeo = new THREE.SphereGeometry(0.1, 8, 6), popGeo = new THREE.RingGeometry(0.08, 0.12, 18);
  const bubbles = [];
  for (let i = 0; i < WORLD.acidBubbles; i++) {
    const b = new THREE.Mesh(bubbleGeo, bubbleM), pop = new THREE.Mesh(popGeo, popM.clone());
    pop.rotation.x = -Math.PI / 2;
    g.add(b, pop);
    bubbles.push({ b, pop, period: 1.4 + r() * 1.6, phase: r(), size: 0.7 + r() * 0.8, cycle: -1 });
  }
  const spot = (i, c) => { const h = rng(i * 7919 + c * 104729 + z.id); return [(h() - 0.5) * (w - 0.5), (h() - 0.5) * (d - 0.5)]; };
  ctx.anim.push((time, dt) => {
    t.offset.x += dt * 0.03; t.offset.y += dt * 0.012;
    poolMat.emissiveIntensity = 1.45 + 0.25 * Math.sin(time * 1.3);
    bubbles.forEach((s, i) => {
      const u = time / s.period + s.phase, cyc = Math.floor(u), k = u - cyc;
      if (cyc !== s.cycle) { s.cycle = cyc; const [x, zz] = spot(i, cyc); s.b.position.x = s.pop.position.x = x; s.b.position.z = s.pop.position.z = zz; }
      const rise = Math.min(1, k / 0.72);
      s.b.visible = k < 0.72;
      s.b.position.y = z.h + 0.05 + rise * 0.24;
      s.b.scale.setScalar(s.size * (0.25 + 0.75 * Math.sin(rise * Math.PI * 0.5)));
      const pk = (k - 0.72) / 0.28;             // 破掉以后的涟漪
      s.pop.visible = k >= 0.72;
      s.pop.position.y = z.h + 0.06;
      s.pop.scale.setScalar(s.size * (1 + pk * 3));
      s.pop.material.opacity = 0.8 * (1 - pk);
    });
  });
  fxLight(g, ctx, WORLD.colors.acid, 7, z.h + 1.3, 0, 0);
}

function addQuicksand(g, z, ctx) {
  const R = Math.min(z.w, z.d) * 0.42;
  const pivot = new THREE.Group(); pivot.position.y = z.h + 0.03;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 40), new THREE.MeshStandardMaterial({ map: tex("spiral"), roughness: 1 }));
  disc.rotation.x = -Math.PI / 2; disc.receiveShadow = true;
  pivot.add(disc); g.add(pivot);
  ctx.anim.push((time, dt) => { pivot.rotation.y += dt * 0.25; });
}

function addCoral(g, z, r) {
  const cm = [mat("coral1", WORLD.colors.coral1, { emissive: 0x401018 }), mat("coral2", WORLD.colors.coral2, { emissive: 0x401a08 })];
  const spots = [[-1, -1], [1, -1], [-1, 0.2], [1, 0.4]];
  spots.forEach(([sx, sz], i) => {
    const n = 3 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const h = 0.5 + r() * 0.9;
      const c = mesh(new THREE.CylinderGeometry(0.04, 0.13, h, 5), cm[(i + k) % 2], sx * (z.w / 2 - 0.45) + (r() - 0.5) * 0.4, z.h + h / 2 - 0.05, sz * (z.d / 2 - 0.5) + (r() - 0.5) * 0.4);
      c.rotation.set((r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5);
      g.add(c);
      const tip = mesh(new THREE.SphereGeometry(0.1, 6, 5), cm[(i + k) % 2], c.position.x, c.position.y + h / 2, c.position.z);
      g.add(tip);
    }
  });
}

function addFire(g, z, ctx, r) {
  const flames = [];
  for (let i = 0; i < 5; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 6), glow(WORLD.colors.fire, 2.6));
    f.position.set((r() - 0.5) * (z.w - 2.4), z.h + 0.3, (r() - 0.5) * (z.d - 2.4));
    g.add(f); flames.push(f);
    const patch = new THREE.Mesh(new THREE.CircleGeometry(0.5 + r() * 0.4, 7), new THREE.MeshBasicMaterial({ color: 0x331008 }));
    patch.rotation.x = -Math.PI / 2; patch.position.set(f.position.x, z.h + 0.02, f.position.z); g.add(patch);   // 焦黑的地面
  }
  ctx.anim.push((time) => flames.forEach((f, i) => { f.scale.set(1, 0.8 + 0.4 * Math.sin(time * 9 + i * 2), 1); f.rotation.y = time * 2 + i; }));
  fxLight(g, ctx, WORLD.colors.fire, 6, z.h + 1.0, 0, 0);
}

function addIce(g, z, r) {
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(z.w - 1.2, z.d - 1.2), new THREE.MeshStandardMaterial({ color: WORLD.colors.ice, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.2 }));
  sheet.rotation.x = -Math.PI / 2; sheet.position.y = z.h + 0.02; g.add(sheet);
  for (let i = 0; i < 6; i++) {
    const h = 0.5 + r() * 0.8;
    const c = mesh(new THREE.OctahedronGeometry(0.28, 0), new THREE.MeshStandardMaterial({ color: WORLD.colors.ice, emissive: 0x2a6a8a, emissiveIntensity: 0.8, transparent: true, opacity: 0.85, flatShading: true, roughness: 0.15 }),
      (r() < 0.5 ? -1 : 1) * (z.w / 2 - 0.5 - r() * 0.2), z.h + h / 2, (r() - 0.6) * (z.d - 1.2));
    c.scale.set(1, h / 0.28, 1); g.add(c);
  }
}

function addElectric(g, z, ctx) {
  const lines = [];
  for (let i = 0; i < 3; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(7 * 3), 3));
    const col = new THREE.Color(WORLD.colors.electric).multiplyScalar(2.6);
    const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: col, toneMapped: false }));
    l.frustumCulled = false; g.add(l); lines.push(l);
  }
  let acc = 0, seeded = false;
  const hw = z.w / 2 - 0.9, hd = z.d / 2 - 0.9;
  ctx.anim.push((time, dt) => {
    acc += dt;
    if (seeded && acc < 0.07) return;      // 减少动态效果时 dt = 0：画一次就停在那里
    acc = 0; seeded = true;
    lines.forEach((l, i) => {
      l.visible = Math.sin(time * 13 + i * 5) > -0.35;     // 电火花一闪一闪
      const p = l.geometry.attributes.position;
      const x0 = (Math.random() * 2 - 1) * hw, z0 = (Math.random() * 2 - 1) * hd, x1 = (Math.random() * 2 - 1) * hw, z1 = (Math.random() * 2 - 1) * hd;
      for (let k = 0; k < 7; k++) {
        const u = k / 6;
        p.setXYZ(k, x0 + (x1 - x0) * u + (k && k < 6 ? (Math.random() - 0.5) * 0.5 : 0), z.h + 0.08 + (k && k < 6 ? Math.random() * 0.45 : 0), z0 + (z1 - z0) * u + (k && k < 6 ? (Math.random() - 0.5) * 0.5 : 0));
      }
      p.needsUpdate = true;
    });
  });
  fxLight(g, ctx, 0x9ad0ff, 5, z.h + 1.2, 0, 0);
}

function addRing(g, z, kind, ctx) {
  const color = WORLD.colors[kind];
  const R = Math.min(z.w, z.d) * 0.46;
  const ring = new THREE.Mesh(new THREE.RingGeometry(R - 0.12, R, 48), glow(color, 1.8, { side: THREE.DoubleSide, transparent: true }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = z.h + 0.05; g.add(ring);
  ctx.anim.push((time) => { ring.material.opacity = 0.55 + 0.35 * Math.sin(time * 2.2); });
}

function fxLight(g, ctx, color, dist, y, x, zz) {
  if (ctx.fxLights >= WORLD.maxFxLights) return;
  ctx.fxLights++;
  const l = new THREE.PointLight(color, 8, dist, 2);
  l.position.set(x, y, zz); g.add(l);
}

/* ---------- 装饰：废铁、管道、碎石、路灯。只放在地台外缘一圈（pad 以外），不挡铭牌 ---------- */
function decorate(g, z, r, ctx) {
  const hw = z.w / 2, hd = z.d / 2, y = z.h;
  const sandy = z.kind === "quicksand" || z.kind === "coral";
  const C = WORLD.colors;
  const lampAt = (sx, sz, color) => addLamp(g, z, sx * (hw - 0.42), sz * (hd - 0.42), color, ctx);

  if (!sandy) lampAt(r() < 0.5 ? -1 : 1, -1, z.kind === "acid" ? 0xb8ff80 : z.kind === "abyss" ? 0xff6a5a : 0xffd9a0);
  if (!sandy && r() < 0.35) lampAt(r() < 0.5 ? -1 : 1, 1, 0xffd9a0);

  // 管道：沿后沿一根，两头弯下去
  if (!sandy && z.kind !== "abyss" ? true : r() < 0.4) {
    const len = z.w - 1.8, pm = mat("pipe", C.metal, { roughness: 0.6, metalness: 0.4 });
    const pipe = mesh(new THREE.CylinderGeometry(0.14, 0.14, len, 8), pm, 0, y + 0.42, -hd + 0.4);
    pipe.rotation.z = Math.PI / 2; g.add(pipe);
    [-1, 1].forEach(s => g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.42, 8), pm, s * (len / 2), y + 0.21, -hd + 0.4)));
    [-0.3, 0.3].forEach(k => g.add(mesh(new THREE.TorusGeometry(0.16, 0.035, 5, 10), mat("band", C.rust), k * len, y + 0.42, -hd + 0.4)));
  }

  // 废铁堆：贴着左右边
  const heaps = sandy ? 0 : 2;
  for (let i = 0; i < heaps; i++) {
    const sx = i ? 1 : -1, zz = (r() - 0.2) * (hd - 1);
    const n = 3 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const s = 0.2 + r() * 0.3;
      const b = mesh(new THREE.BoxGeometry(s * 1.6, s, s * 1.2), mat("scrap" + (k % 2), k % 2 ? C.rust : C.metal), sx * (hw - 0.4) + (r() - 0.5) * 0.3, y + s / 2 + (k > 1 ? s * 0.8 : 0), zz + (r() - 0.5) * 0.7);
      b.rotation.set(r() * 0.4, r() * 3, r() * 0.4); g.add(b);
    }
  }
  if (z.kind === "acid") {                                           // 酸液桶
    for (let i = 0; i < 2; i++) g.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 8), mat("barrel", 0x5a7a2a, { roughness: 0.6 }), (i ? 1 : -1) * (hw - 0.5), y + 0.25, hd - 0.45 - i * 0.5));
  }

  // 碎石 / 沙地的岩石
  const rocks = sandy ? 7 : 6;
  for (let i = 0; i < rocks; i++) {
    const edge = r();
    const x = edge < 0.5 ? (r() < 0.5 ? -1 : 1) * (hw - 0.3 - r() * 0.3) : (r() * 2 - 1) * (hw - 0.6);
    const zz = edge < 0.5 ? (r() * 2 - 1) * (hd - 0.6) : (r() < 0.5 ? -1 : 1) * (hd - 0.3 - r() * 0.3);
    const s = (sandy ? 0.25 : 0.14) + r() * (sandy ? 0.3 : 0.16);
    const rock = mesh(new THREE.DodecahedronGeometry(s, 0), mat(sandy ? "rock-s" : "rock", sandy ? C.tan : C.concrete), x, y + s * 0.6, zz);
    rock.rotation.set(r() * 3, r() * 3, r() * 3); rock.scale.y = 0.7; g.add(rock);
  }
}

function addLamp(g, z, x, zz, color, ctx) {
  const y = z.h;
  const pm = mat("lamp-pole", 0x3b3a38, { roughness: 0.5, metalness: 0.5 });
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.09, 2.5, 6), pm, x, y + 1.25, zz));
  g.add(mesh(new THREE.BoxGeometry(0.5, 0.06, 0.06), pm, x + (x > 0 ? -0.2 : 0.2), y + 2.5, zz));
  const hx = x + (x > 0 ? -0.42 : 0.42);
  g.add(mesh(new THREE.BoxGeometry(0.28, 0.1, 0.2), pm, hx, y + 2.46, zz));
  const bulbColor = new THREE.Color(color).multiplyScalar(2.4);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: bulbColor.clone(), toneMapped: false }));
  bulb.position.set(hx, y + 2.38, zz); g.add(bulb);
  // 闪烁的节奏每盏灯不一样（第一次闪在 1–9 秒之后）
  const seed = ctx.lamps.length * 1.7 + z.id;
  const lamp = { light: null, bulb, bulbColor, base: 0, wait: 1 + ((seed * 7.31) % 8), flick: 0, seed };
  if (ctx.lamps.length < WORLD.maxLamps) {
    const l = new THREE.PointLight(color, 10, 9, 2);
    l.position.set(hx, y + 2.2, zz); g.add(l);
    lamp.light = l; lamp.base = 10;
  }
  ctx.lamps.push(lamp);
}

/* ---------- 间隔：桥 / 危墙 / 机关门 / 空隙 / 畅通 ---------- */
export function buildGap(gap, ctx) {
  const g = new THREE.Group();
  g.position.set(gap.x, 0, gap.z);
  g.rotation.y = gap.axis === "z" ? Math.PI / 2 : 0;   // 本地坐标：长度沿 X，宽度沿 Z
  const L = gap.length, W = gap.width;
  const y = gap.topY, C = WORLD.colors;
  const ratio = gap.maxHp > 0 ? Math.max(0, Math.min(1, gap.hp / gap.maxHp)) : 1;

  if (gap.type === "bridge") {
    const bw = W * 0.34;
    const n = Math.ceil(L / 0.42), step = L / n;
    const wood = mat("plank", 0x8b6a40, { roughness: 1 });
    const planks = [];
    for (let i = 0; i < n; i++) {
      if (ratio < 1 && ((i * 7 + 3) % 10) / 10 > 0.35 + ratio * 0.65) continue;     // 桥受损：缺几块板
      const p = mesh(new THREE.BoxGeometry(step * 0.86, 0.08, bw), wood, -L / 2 + step * (i + 0.5), y - 0.06 - Math.sin(((i + 0.5) / n) * Math.PI) * -0.05, 0);
      p.rotation.y = (((i * 13) % 7) - 3) * 0.012; g.add(p); planks.push(p);
    }
    [-1, 1].forEach(s => {
      const rope = mesh(new THREE.CylinderGeometry(0.03, 0.03, L + 0.7, 5), mat("rope", 0x2a2118), 0, y + 0.55, s * (bw / 2 + 0.06));
      rope.rotation.z = Math.PI / 2; g.add(rope);
      [-1, 1].forEach(e => g.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.62, 5), mat("post", 0x4a3a28), e * (L / 2 + 0.3), y + 0.28, s * (bw / 2 + 0.06))));
    });
    const base = planks.map(p => p.position.y);
    ctx.anim.push((time) => planks.forEach((p, i) => { p.position.y = base[i] + Math.sin(time * 1.6 + i * 0.7) * 0.012; }));   // 不稳：轻轻晃
  } else if (gap.type === "wall") {
    const bm = mat("wallblk", 0x6f6a62, { map: tex("concrete") });
    const hz = mat("hazard", 0xffffff, { map: tex("hazard") });
    // 矮而薄的一道墙：高不过铭牌的一半，厚度只有缝宽的 1/5，竖屏下也盖不住铭牌
    const n = WALL.blocks, bw = (W * 0.92) / n, thick = Math.min(L * WALL.thickRatio, WALL.maxThick);
    for (let i = 0; i < n; i++) {
      const h = (WALL.baseH + (((i * 5) % 4) * WALL.varyH)) * (0.55 + ratio * 0.45);    // 越破越矮
      const b = mesh(new THREE.BoxGeometry(thick, h, bw * 0.95), bm, 0, y + h / 2, -W * 0.46 + bw * (i + 0.5));
      b.rotation.set(0, (((i * 3) % 5) - 2) * 0.02, (((i * 7) % 5) - 2) * 0.015); g.add(b);
      g.add(mesh(new THREE.BoxGeometry(thick + 0.02, 0.1, bw * 0.95), hz, 0, y + h - 0.07, -W * 0.46 + bw * (i + 0.5), false, true));
    }
  } else if (gap.type === "door") {
    const dm = mat("door", 0x56606a, { map: tex("metal"), metalness: 0.4, roughness: 0.6 });
    const H = 2.3, half = W * 0.22;
    [-1, 1].forEach(s => g.add(mesh(new THREE.BoxGeometry(0.5, H + 0.3, 0.5), mat("doorframe", 0x3a3631), 0, y + H / 2, s * (W * 0.46))));
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.3, W * 0.96), mat("doorframe", 0x3a3631), 0, y + H + 0.15, 0));
    [-1, 1].forEach(s => g.add(mesh(new THREE.BoxGeometry(0.28, H, half * 1.9), dm, 0, y + H / 2, s * (gap.open ? W * 0.34 : half))));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(gap.open ? C.heal : C.warn).multiplyScalar(2.4), toneMapped: false }));
    lamp.position.set(0, y + H + 0.45, 0); g.add(lamp);
  } else if (gap.type === "void") {
    const pit = new THREE.Mesh(new THREE.BoxGeometry(L, 0.1, W * 0.98), new THREE.MeshBasicMaterial({ color: 0x030206 }));
    pit.position.y = -0.6; g.add(pit);
    [-1, 1].forEach(s => g.add(new THREE.Mesh(new THREE.BoxGeometry(L, 0.05, 0.08), new THREE.MeshBasicMaterial({ color: new THREE.Color(C.warn).multiplyScalar(2), toneMapped: false })).translateZ(s * W * 0.49).translateY(y + 0.02)));
  } else {
    // 畅通：一条低矮的碎石路面
    g.add(mesh(new THREE.BoxGeometry(L + 0.4, 0.14, W * 0.6), mat("road", 0x58524a, { map: tex("concrete") }), 0, 0.07, 0, false, true));
  }
  return g;
}

/* ---------- 清理 ---------- */
export function disposeTree(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    ms.forEach(m => { if (!m.userData.shared) m.dispose(); });
  });
}

export { WORLD, WALL, canvasTex };
