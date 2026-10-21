/* Antlerscale: Backfire · HD-2D 战场原型 · 远景
 *
 * 镜头俯角 30°、视角只有 22°，画面最上沿也是往下看的——真正的天空根本进不了画面。所以在战场后面立一圈「天幕」
 * （像舞台的天幕布，绕到两侧），按镜头真正看得到的那一截画天空渐变；天幕前面两层剪影：
 *   1. 天边一圈画出来的远景（canvas 画在一条弧形带子上）：远处的厂区 / 桌山 / 城市
 *   2. 中景几何体：大小按「画面上沿那条视线在那里有多高」来定，整个轮廓都在画面里，不会只露半截
 *        采矿场 mine：矿井架（A 字架 + 天轮）、烟囱（冒烟、顶上红灯一闪一闪）、传送带通到料仓、筒仓、矿渣堆
 *        沙漠 desert：沙丘、风蚀岩柱、带岩层的桌山、半埋在沙里的船骨
 *        夜晚 night：亮着窗的楼群、水塔、天线（红灯）；天幕上有星星
 *        其余 wasteland：碎石岩丘
 * 剪影越远越接近天边的雾色（空气透视），景深再稍微糊一点（远处的糊上限在场景的 THEMES.dofFar）。
 *
 *   const bd = buildBackdrop("mine", bounds, "dusk", layout.camera, { sky: [...4 色], fog: 0xRRGGBB });
 *   scene.add(bd.group); 每帧 bd.update(t, dt)；bd.dispose();
 * 剪影和天幕不吃场景雾（雾会把它们全抹成一个色），颜色自己按远近调。 */
import * as THREE from "three";
import { rng } from "./hd2d-world.js";

/** 布局（hd2d-layout.js，普通脚本，先加载）：画面上沿那条视线的高度用它的 frameTop */
const L = window.HD2DLayout;

/* ---------- 配置 ---------- */
const BACKDROP = {
  skyGap: 11,         // 天幕离战场后沿多远（世界单位）
  sideGap: 12,        // 天幕离战场左右两边多远
  skyArc: 0.6,        // 天幕从正后方往左右各绕多少（× π）
  skyH: 70,           // 天幕高度（镜头往上转也够）
  stops: [0, 0.3, 0.66, 1.08],   // 天空四个颜色在「默认镜头看得到的那截天幕」里的位置（0 = 地平线，1 = 画面上沿）
  bandH: 0.52,        // 天边画出来的那圈远景，高度占看得到的天幕的比例
  mid: { near: 2.6, far: 9.2, fill: 0.84, side: 9, sideMaxH: 6 },   // 中景剪影：离战场后沿 near–far；最高 = 画面上沿视线高度 × fill（两侧的再不超过 sideMaxH）；两侧最多离战场边 side
  count: { mine: 14, desert: 12, night: 22, wasteland: 12 },
  smoke: { puffs: 7, rise: 0.55, life: 5.5 },        // 烟囱的烟：每根几团、往上飘多快、一团飘多久
  blink: 1.3,         // 红灯闪的周期（秒）
  groundRepeat: 26,
  /* 剪影颜色：近处（body）→ 远处靠向天边的雾色 */
  tint: {
    day: { body: 0x7a6248, rock: 0x8a6a4c, sand: 0xc89c62, dark: 0x5a4636 },
    dusk: { body: 0x2c1f28, rock: 0x3d2a2c, sand: 0x6a4436, dark: 0x1e1519 },
    night: { body: 0x0b0f18, rock: 0x121824, sand: 0x1a2030, dark: 0x06080e }
  }
};
const D2R = Math.PI / 180;

/** 屏幕背景（只在镜头转到天幕外面时露出来）：四色渐变，夜晚加星星 */
export function skyTexture(stops, stars) {
  const W = stars ? 512 : 4, H = 512;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d"), grd = g.createLinearGradient(0, 0, 0, H);
  const s = stops && stops.length ? stops : ["#9fb8c8", "#cfd8d0", "#e8e0c8", "#f0e0c0"];
  grd.addColorStop(0, s[s.length - 1]); grd.addColorStop(0.55, s[Math.max(0, s.length - 2)]); grd.addColorStop(1, s[0]);
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  if (stars) {
    const r = rng(77);
    for (let i = 0; i < 170; i++) {
      const y = Math.pow(r(), 1.6) * H * 0.8, a = 0.25 + r() * 0.75, sz = r() < 0.12 ? 2.2 : 1.2;
      g.fillStyle = `rgba(${r() < 0.3 ? "255,230,190" : "205,225,255"},${a})`;
      g.beginPath(); g.arc(r() * W, y, sz, 0, 7); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** 废土地面：干裂的地、车辙、碎石 */
function groundTexture() {
  const S = 256;
  const c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d"), r = rng(31);
  g.fillStyle = "#fff"; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26; i++) {   // 大块深浅
    g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.05})`;
    g.beginPath(); g.ellipse(r() * S, r() * S, 20 + r() * 50, 10 + r() * 30, r() * 3, 0, 7); g.fill();
  }
  for (let i = 0; i < 2600; i++) {
    const v = r() < 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${0.04 + r() * 0.08})`;
    g.fillRect(r() * S, r() * S, 1 + r() * 3, 1 + r() * 2);
  }
  g.strokeStyle = "rgba(0,0,0,.16)"; g.lineWidth = 1;   // 干裂的纹
  for (let i = 0; i < 40; i++) {
    let x = r() * S, y = r() * S; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 22; y += (r() - 0.5) * 22; g.lineTo(x, y); }
    g.stroke();
  }
  g.strokeStyle = "rgba(0,0,0,.10)"; g.lineWidth = 3;   // 车辙
  for (let i = 0; i < 2; i++) { const y = r() * S; g.beginPath(); for (let x = 0; x <= S; x += 16) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 10); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(BACKDROP.groundRepeat, BACKDROP.groundRepeat); t.anisotropy = 4;
  return t;
}

/** 废土地面：地台下面一大片暗地，像把地台摆在场景里（远处藏在天幕后面） */
export function buildGround() {
  const tex = groundTexture();
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(150, 56),
    new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 1, map: tex, flatShading: true })
  );
  m.rotation.x = -Math.PI / 2; m.position.y = -0.32; m.receiveShadow = true;
  return m;
}

/* ---------- 天幕 ---------- */
/** 天幕的形状：绕着战场中心的半个椭圆筒（开口朝镜头），u 沿着弧，v 沿着高 */
function arcGeometry(cx, cz, rx, rz, arc, y0, y1, seg) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const th = -arc + (2 * arc * i) / seg, x = cx + Math.sin(th) * rx, z = cz - Math.cos(th) * rz;
    pos.push(x, y0, z, x, y1, z); uv.push(i / seg, 0, i / seg, 1);
    if (i < seg) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** 天空：按「默认镜头在这里看得到多高」把四个颜色铺开（地平线 → 画面上沿），傍晚加一团夕阳光晕和几条被照亮的云，夜晚加星星 */
function skyMaterial(colors, opts) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide, fog: false, depthWrite: true,
    uniforms: {
      c0: { value: new THREE.Color(colors[0]) }, c1: { value: new THREE.Color(colors[1]) },
      c2: { value: new THREE.Color(colors[2]) }, c3: { value: new THREE.Color(colors[3]) },
      stops: { value: new THREE.Vector4(...BACKDROP.stops) },
      camY: { value: opts.camY }, camZ: { value: opts.camZ }, slope: { value: opts.slope }, base: { value: -0.35 },
      haze: { value: new THREE.Color(opts.fog) },
      sun: { value: new THREE.Vector3(opts.sun[0], opts.sun[1], opts.sun[2]) }, sunColor: { value: new THREE.Color(opts.sunColor) },
      stars: { value: opts.stars ? 1 : 0 }, clouds: { value: opts.clouds || 0 }, cloudColor: { value: new THREE.Color(opts.cloudColor || 0xffffff) }
    },
    vertexShader: `varying vec3 vW; varying vec2 vUv;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 c0; uniform vec3 c1; uniform vec3 c2; uniform vec3 c3; uniform vec4 stops;
      uniform float camY; uniform float camZ; uniform float slope; uniform float base; uniform vec3 haze;
      uniform vec3 sun; uniform vec3 sunColor; uniform float stars; uniform float clouds; uniform vec3 cloudColor;
      varying vec3 vW; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main(){
        float hv = max(1.5, camY - (camZ - vW.z) * slope);       // 默认镜头在这里看得到的天幕高度
        float s = (vW.y - base) / hv;
        vec3 col = mix(c0, c1, smoothstep(stops.x, stops.y, s));
        col = mix(col, c2, smoothstep(stops.y, stops.z, s));
        col = mix(col, c3, smoothstep(stops.z, stops.w, s));
        // 夕阳 / 太阳的光晕：横向按弧上的位置（u），纵向按高度
        float du = (vUv.x - sun.x) / sun.z, dv = (s - sun.y) / (sun.z * 1.6);
        col += sunColor * exp(-(du * du + dv * dv)) * 0.9;
        // 被照亮的云：几条横向的软带子
        if (clouds > 0.0) {
          float n = noise(vec2(vUv.x * 18.0, s * 5.0)) * 0.6 + noise(vec2(vUv.x * 41.0, s * 11.0)) * 0.4;
          float band = smoothstep(0.2, 0.45, s) * (1.0 - smoothstep(0.75, 1.05, s));
          col = mix(col, cloudColor, smoothstep(0.58, 0.82, n) * band * clouds);
        }
        // 星星：只在上面一截，稀稀落落
        if (stars > 0.0) {
          vec2 g = floor(vec2(vUv.x * 900.0, vW.y * 9.0));
          float h = hash(g);
          col += vec3(0.85, 0.9, 1.0) * step(0.9965, h) * smoothstep(0.35, 0.8, s) * (0.5 + 0.5 * hash(g + 3.1));
        }
        // 贴地的一截融进雾里（和远处的地面接上）
        col = mix(haze, col, smoothstep(-0.02, 0.1, s));
        gl_FragColor = vec4(col, 1.0);
      }`
  });
}

/* ---------- 天边一圈画出来的远景（canvas） ---------- */
function bandTexture(kind, colors, seed) {
  const W = 2048, H = 256;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d"), r = rng(seed);
  const far = colors.far, near = colors.near;
  const rect = (x, w, h, col) => { g.fillStyle = col; g.fillRect(x, H - h, w, h); };
  if (kind === "desert") {
    // 远处的桌山 / 孤峰：平顶、陡壁，两层（远的淡）
    [far, near].forEach((col, layer) => {
      g.fillStyle = col;
      let x = -50;
      while (x < W + 50) {
        const w = 120 + r() * 260, h = (layer ? 50 : 80) + r() * (layer ? 60 : 90), top = w * (0.45 + r() * 0.3);
        g.beginPath(); g.moveTo(x, H); g.lineTo(x + (w - top) / 2, H - h); g.lineTo(x + (w + top) / 2, H - h); g.lineTo(x + w, H); g.fill();
        x += w + r() * (layer ? 160 : 90);
      }
      // 低矮的沙丘线
      g.beginPath(); g.moveTo(0, H);
      for (let px = 0; px <= W; px += 16) g.lineTo(px, H - (layer ? 18 : 28) - Math.sin(px * 0.004 + layer * 2) * 10 - Math.sin(px * 0.013) * 6);
      g.lineTo(W, H); g.fill();
    });
  } else if (kind === "night") {
    // 城市天际线：高低错落的楼，亮着零星的窗
    [far, near].forEach((col, layer) => {
      let x = 0;
      while (x < W) {
        const w = 26 + r() * 60, h = (layer ? 50 : 80) + r() * (layer ? 90 : 140);
        rect(x, w, h, col);
        if (r() < 0.25) rect(x + w * 0.4, 3, h + 18 + r() * 20, col);            // 天线
        for (let wy = H - h + 8; wy < H - 6; wy += 9) for (let wx = x + 4; wx < x + w - 5; wx += 8) {
          if (r() < (layer ? 0.22 : 0.12)) { g.fillStyle = r() < 0.7 ? "rgba(255,206,120,.95)" : "rgba(150,210,255,.9)"; g.fillRect(wx, wy, 3, 4); }
        }
        x += w + r() * 14;
      }
    });
  } else if (kind === "mine") {
    // 远处的厂区：烟囱、矿井架、冷却塔、管廊、料仓，两层
    [far, near].forEach((col, layer) => {
      g.fillStyle = col; g.strokeStyle = col;
      let x = r() * 60;
      while (x < W) {
        const pick = r(), base = H;
        if (pick < 0.22) {                         // 烟囱（一两根）
          const n = 1 + Math.floor(r() * 2);
          for (let i = 0; i < n; i++) { const h = (layer ? 120 : 160) + r() * 70, w = 10 + r() * 6; g.fillRect(x + i * 22, base - h, w, h); g.fillRect(x + i * 22 - 2, base - h, w + 4, 6); }
          x += 30 + n * 22;
        } else if (pick < 0.42) {                  // 矿井架：A 字架 + 天轮
          const h = (layer ? 110 : 150) + r() * 50, w = h * 0.55;
          g.lineWidth = 7; g.beginPath(); g.moveTo(x, base); g.lineTo(x + w / 2, base - h); g.lineTo(x + w, base); g.stroke();
          g.lineWidth = 4; for (let k = 1; k < 4; k++) { const yy = base - h * k / 4, dx = w / 2 * (1 - k / 4); g.beginPath(); g.moveTo(x + w / 2 - dx, yy); g.lineTo(x + w / 2 + dx, yy); g.stroke(); }
          g.beginPath(); g.arc(x + w / 2, base - h, h * 0.12, 0, 7); g.lineWidth = 5; g.stroke();
          g.fillRect(x + w * 0.7, base - h * 0.28, w * 0.9, h * 0.28);   // 绞车房
          x += w * 1.7;
        } else if (pick < 0.56) {                  // 冷却塔（双曲线的轮廓）
          const h = (layer ? 90 : 120) + r() * 40, w = h * 0.8;
          g.beginPath(); g.moveTo(x, base); g.quadraticCurveTo(x + w * 0.3, base - h * 0.55, x + w * 0.15, base - h); g.lineTo(x + w * 0.85, base - h); g.quadraticCurveTo(x + w * 0.7, base - h * 0.55, x + w, base); g.fill();
          x += w + 20;
        } else if (pick < 0.72) {                  // 料仓 / 筒仓
          const n = 2 + Math.floor(r() * 3), h = (layer ? 70 : 100) + r() * 40, w = 22;
          for (let i = 0; i < n; i++) { g.fillRect(x + i * (w + 3), base - h, w, h); g.beginPath(); g.moveTo(x + i * (w + 3), base - h); g.lineTo(x + i * (w + 3) + w / 2, base - h - 14); g.lineTo(x + i * (w + 3) + w, base - h); g.fill(); }
          x += n * (w + 3) + 20;
        } else {                                   // 斜着的传送带 + 厂房
          const len = 120 + r() * 80, rise = 60 + r() * 50;
          g.lineWidth = 6; g.beginPath(); g.moveTo(x, base - 10); g.lineTo(x + len, base - 10 - rise); g.stroke();
          for (let k = 1; k < 4; k++) g.fillRect(x + len * k / 4 - 2, base - 10 - rise * k / 4, 4, 10 + rise * k / 4);
          g.fillRect(x + len - 10, base - 20 - rise - 30, 60, 50 + rise);
          x += len + 70;
        }
        x += 10 + r() * 50;
      }
      g.fillRect(0, H - 14 - layer * 6, W, 14 + layer * 6);   // 连成一片的厂区地面
    });
  } else {
    [far, near].forEach((col, layer) => {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
      for (let px = 0; px <= W; px += 24) g.lineTo(px, H - (layer ? 40 : 70) - Math.abs(Math.sin(px * 0.006 + layer)) * 60 - r() * 12);
      g.lineTo(W, H); g.fill();
    });
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

/* ---------- 中景几何体剪影 ---------- */
function put(m, x, y, z) { m.position.set(x, y, z); return m; }
const box = (M, w, h, d, x, y, z) => put(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M), x, y, z);
const cyl = (M, r0, r1, h, x, y, z, seg) => put(new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg || 10), M), x, y, z);

/** 矿井架：两条斜腿 + 斜撑 + 顶上两个天轮 + 旁边的绞车房；h = 总高 */
function headframe(M, h) {
  const g = new THREE.Group(), leg = h * 0.06, spread = h * 0.24;
  [-1, 1].forEach(s => {
    const l = box(M.body, leg, h * 1.04, leg, s * spread / 2, h / 2, 0); l.rotation.z = -s * Math.atan2(spread / 2, h); g.add(l);
  });
  for (let k = 1; k <= 3; k++) g.add(box(M.body, spread * (1 - k * 0.24) + leg, leg * 0.7, leg * 0.8, 0, h * k * 0.24, 0));
  const brace = box(M.body, leg * 0.6, h * 0.75, leg * 0.6, h * 0.22, h * 0.36, 0); brace.rotation.z = 0.55; g.add(brace);   // 往绞车房那边的斜撑
  [-0.07, 0.07].forEach(dz => {
    const w = new THREE.Mesh(new THREE.TorusGeometry(h * 0.085, leg * 0.35, 6, 18), M.body);
    w.position.set(0, h * 1.0, dz * h); g.add(w);
    const spoke = box(M.body, h * 0.17, leg * 0.25, leg * 0.25, 0, h, dz * h); g.add(spoke);
  });
  g.add(box(M.body, h * 0.36, h * 0.17, h * 0.22, h * 0.42, h * 0.085, 0));   // 绞车房
  g.add(box(M.body, h * 0.36, h * 0.03, h * 0.24, h * 0.42, h * 0.18, 0));
  return g;
}
/** 烟囱：上细下粗，两道箍，顶上一盏红灯（返回 { group, top }，烟从 top 冒出来） */
function chimney(M, h, r) {
  const g = new THREE.Group();
  g.add(cyl(M.body, r * 0.65, r, h, 0, h / 2, 0, 12));
  [0.55, 0.85].forEach(k => g.add(cyl(M.dark, r * (1 - k * 0.35) + 0.06, r * (1 - k * 0.35) + 0.06, h * 0.03, 0, h * k, 0, 12)));
  g.add(cyl(M.dark, r * 0.75, r * 0.68, h * 0.04, 0, h, 0, 12));
  return { group: g, top: h * 1.02 };
}
/** 传送带：从地面斜着通到料仓顶上；len = 水平长度 */
function conveyor(M, len, rise) {
  const g = new THREE.Group();
  const ang = Math.atan2(rise, len), L = Math.hypot(len, rise);
  const belt = box(M.body, L, Math.max(0.18, rise * 0.06), Math.max(0.3, rise * 0.1), len / 2, rise / 2 + 0.2, 0); belt.rotation.z = ang; g.add(belt);
  const roof = box(M.dark, L, rise * 0.04, rise * 0.12, len / 2, rise / 2 + 0.2 + rise * 0.06, 0); roof.rotation.z = ang; g.add(roof);
  for (let i = 1; i <= 3; i++) { const x = len * i / 4, hh = rise * i / 4 + 0.2; g.add(box(M.body, rise * 0.05, hh, rise * 0.05, x, hh / 2, 0)); }
  const binH = rise * 1.25, binW = rise * 0.6;   // 料仓：方仓 + 漏斗
  g.add(box(M.body, binW, binH * 0.6, binW, len + binW * 0.3, binH * 0.7, 0));
  const hopper = new THREE.Mesh(new THREE.ConeGeometry(binW * 0.7, binH * 0.4, 4), M.body);
  hopper.rotation.y = Math.PI / 4; hopper.rotation.z = Math.PI; hopper.position.set(len + binW * 0.3, binH * 0.2, 0); g.add(hopper);
  [-1, 1].forEach(s => g.add(box(M.dark, rise * 0.04, binH * 0.45, rise * 0.04, len + binW * 0.3 + s * binW * 0.4, binH * 0.22, 0)));
  return g;
}
function silos(M, h, n) {
  const g = new THREE.Group(), r = h * 0.16;
  for (let i = 0; i < n; i++) {
    g.add(cyl(M.body, r, r, h, i * r * 2.15, h / 2, 0, 12));
    const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 1.02, r * 0.8, 12), M.body); cap.position.set(i * r * 2.15, h + r * 0.4, 0); g.add(cap);
  }
  g.add(box(M.dark, n * r * 2.15, h * 0.05, r * 0.6, (n - 1) * r * 1.075, h * 0.92, 0));   // 顶上的走道
  return g;
}
function heap(M, s) { return put(new THREE.Mesh(new THREE.ConeGeometry(s, s * 0.6, 8), M.rock), 0, s * 0.3, 0); }
function shed(M, w, h) {
  const g = new THREE.Group();
  g.add(box(M.body, w, h, w * 0.6, 0, h / 2, 0));
  const roof = box(M.dark, w * 1.05, h * 0.12, w * 0.66, 0, h + h * 0.04, 0); roof.rotation.z = 0.08; g.add(roof);
  return g;
}
/** 沙丘：顺滑的长条（光滑着色，迎光面亮、背光面暗，一看就是沙丘不是土堆） */
function dune(M, s) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.sandSmooth);
  m.scale.set(s * 2.4, s * 0.5, s); return m;
}
/** 风蚀岩柱：一节节上粗下细，顶上一块大的 */
function pillar(M, h, r) {
  const g = new THREE.Group();
  g.add(cyl(M.rock, r * 0.75, r * 1.15, h * 0.55, 0, h * 0.275, 0, 7));
  g.add(cyl(M.rock, r * 0.6, r * 0.8, h * 0.3, 0.05, h * 0.7, 0, 7));
  g.add(cyl(M.rock, r * 1.25, r * 0.7, h * 0.18, -0.05, h * 0.92, 0, 7));
  return g;
}
/** 桌山：平顶、陡壁，侧面一道道岩层（深浅两色叠起来） */
function mesa(M, w, h) {
  const g = new THREE.Group();
  const layers = 4;
  for (let i = 0; i < layers; i++) {
    const k = 1 - i * 0.08, hh = h / layers;
    g.add(box(i % 2 ? M.rock : M.sand, w * k, hh, w * 0.55 * k, 0, hh * (i + 0.5), 0));
  }
  g.add(box(M.rock, w * 0.5, h * 0.3, w * 0.3, w * 0.12, h * 1.15, 0));
  return g;
}
/** 半埋在沙里的船骨：一排弯弯的肋骨 */
function wreck(M, len) {
  const g = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(len * 0.16, len * 0.012, 4, 10, Math.PI * 0.9), M.dark);
    rib.position.set(i * len * 0.16, 0, 0); rib.rotation.y = Math.PI / 2; rib.rotation.x = 0.1 * (i - 2.5); g.add(rib);
  }
  g.add(box(M.dark, len * 0.9, len * 0.025, len * 0.025, len * 0.4, len * 0.01, 0));   // 龙骨
  return g;
}
function windowTexture(seed) {
  const c = document.createElement("canvas"); c.width = 64; c.height = 128;
  const g = c.getContext("2d"), r = rng(seed);
  g.fillStyle = "#07090e"; g.fillRect(0, 0, 64, 128);
  for (let y = 6; y < 124; y += 9) for (let x = 6; x < 58; x += 9) {
    if (r() < 0.38) { g.fillStyle = r() < 0.7 ? "#ffd27a" : "#9fd8ff"; g.fillRect(x, y, 5, 5); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t;
}
function tower(M, w, h, d, win) {
  const g = new THREE.Group();
  g.add(put(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), win), 0, h / 2, 0));
  g.add(box(M.body, w * 0.5, Math.min(0.8, h * 0.08), d * 0.5, 0, h + 0.4, 0));
  return g;
}
function waterTower(M, h) {
  const g = new THREE.Group(), r = h * 0.2;
  [-1, 1].forEach(sx => [-1, 1].forEach(sz => g.add(box(M.body, h * 0.04, h * 0.7, h * 0.04, sx * r * 0.7, h * 0.35, sz * r * 0.7))));
  g.add(cyl(M.body, r, r, h * 0.28, 0, h * 0.84, 0, 12));
  const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 1.05, h * 0.12, 12), M.body); cap.position.y = h * 1.04; g.add(cap);
  return g;
}

/** 烟：几团软的、越飘越大越淡的烟（Sprite，总是正对镜头） */
function smokeTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,.9)"); grd.addColorStop(0.5, "rgba(255,255,255,.4)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/**
 * 建一圈远景。bounds 是战场范围；camera 是布局算好的默认镜头（hd2d-layout.js 的 fitView），用来算「画面上沿那条视线」有多高；
 * colors = { sky: [地平线 → 天顶 4 个颜色], fog }。返回 { group, update(t, dt), dispose }。
 */
export function buildBackdrop(kind, bounds, themeName, camera, colors) {
  colors = colors || {};
  const T = BACKDROP.tint[themeName] || BACKDROP.tint.day;
  const own = [];     // 自己建的材质 / 贴图 / 几何，dispose 时清
  const keep = (x) => { own.push(x); return x; };
  const night = themeName === "night", dusk = themeName === "dusk";
  const group = new THREE.Group();
  const anims = [];
  const r = rng(kind.length * 31 + Math.round((bounds.maxX - bounds.minX) * 7) + Math.round((bounds.maxZ - bounds.minZ) * 3));
  const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
  const hx = (bounds.maxX - bounds.minX) / 2, hz = (bounds.maxZ - bounds.minZ) / 2;
  const cam = camera || { pos: { y: 25, z: cz + 45 }, elevation: 30, fov: 22 };
  const slope = Math.tan((cam.elevation - cam.fov / 2) * D2R);   // 天空的着色器里用同一条视线
  /** 默认镜头的画面上沿那条视线，在 z 处离地多高（这么高以内的东西整个都在画面里） */
  const topY = (z) => L.frameTop(cam, z);
  const sky = colors.sky || ["#e8d8b8", "#d8c8a8", "#b8b0a0", "#8a8a90"];
  const fog = new THREE.Color(colors.fog != null ? colors.fog : 0x888888);
  const hazeOf = (k) => new THREE.Color(sky[0]).lerp(fog, 0.5).lerp(new THREE.Color(T.body), 1 - k);   // k 越大越靠近天边的雾色

  /* 1. 天幕 */
  const rz = hz + BACKDROP.skyGap, rx = hx + BACKDROP.sideGap, arc = BACKDROP.skyArc * Math.PI;
  const skyM = keep(skyMaterial(sky, {
    camY: cam.pos.y, camZ: cam.pos.z, slope, fog,
    sun: dusk ? [0.3, 0.12, 0.09] : night ? [0.22, 0.9, 0.05] : [0.28, 0.75, 0.16],
    sunColor: dusk ? 0xff9a50 : night ? 0x30405a : 0x6a5530, stars: night,
    clouds: dusk ? 0.55 : themeName === "day" ? 0.25 : 0, cloudColor: dusk ? 0xffb090 : 0xf4e2bc
  }));
  const skyMesh = new THREE.Mesh(keep(arcGeometry(cx, cz, rx, rz, arc, -0.6, BACKDROP.skyH, 72)), skyM);
  skyMesh.renderOrder = -1;
  group.add(skyMesh);

  /* 2. 天边画出来的远景：一条弧形带子，贴在天幕前面一点 */
  const backTop = topY(cz - rz);
  const bandH = Math.max(1.2, backTop * BACKDROP.bandH);
  const nearC = hazeOf(0.55), farC = hazeOf(0.82);
  const bandTex = keep(bandTexture(kind, { far: "#" + farC.getHexString(), near: "#" + nearC.getHexString() }, kind.length * 97 + 11));
  const bandLen = ((rx + rz) / 2) * 2 * arc;
  bandTex.repeat.set(Math.max(1, Math.round(bandLen / (bandH * 8))), 1);
  const bandM = keep(new THREE.MeshBasicMaterial({ map: bandTex, transparent: true, alphaTest: 0.02, fog: false, side: THREE.DoubleSide, color: night ? new THREE.Color(1.5, 1.5, 1.5) : 0xffffff, toneMapped: !night }));
  const band = new THREE.Mesh(keep(arcGeometry(cx, cz, rx - 0.7, rz - 0.7, arc * 0.98, -0.4, bandH, 72)), bandM);
  group.add(band);

  /* 3. 中景几何体 */
  const std = (color, opt) => keep(new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 1, flatShading: true, fog: false }, opt || {})));
  /** 一层的材质：远一点的偏向雾色，再带一点自发光（像被雾里的光照着） */
  const layerMats = (k) => {
    const mix = (c) => new THREE.Color(c).lerp(hazeOf(1), k * 0.55);
    const em = hazeOf(1).multiplyScalar(0.18 + k * 0.35);
    return {
      body: std(mix(T.body), { emissive: em }), dark: std(mix(T.dark), { emissive: em }),
      rock: std(mix(T.rock), { emissive: em }), sand: std(mix(T.sand), { emissive: em }),
      sandSmooth: std(mix(T.sand), { emissive: em, flatShading: false })
    };
  };
  const layers = [0, 0.5, 1].map(layerMats);
  const lamp = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4a2a).multiplyScalar(2.6), toneMapped: false, fog: false }));
  const smokeTex = keep(smokeTexture());
  const smokeColor = dusk ? 0x7a6470 : night ? 0x2a3040 : 0x9a8a78;
  const windows = night ? [1, 2, 3].map(s => { const t = keep(windowTexture(s * 17)); return keep(new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.5, 1.5, 1.5), toneMapped: false, fog: false })); }) : null;

  /** 一盏一闪一闪的红灯（减少动态效果时一直亮着） */
  const blinker = (x, y, z, phase) => {
    const m = new THREE.Mesh(keep(new THREE.SphereGeometry(0.16, 8, 6)), lamp);
    m.position.set(x, y, z); group.add(m);
    anims.push((t, dt) => { m.visible = dt === 0 || ((t / BACKDROP.blink + phase) % 1) < 0.55; });
  };
  /** 烟囱冒的烟：一串 Sprite 循环往上飘 */
  const smoke = (x, y, z, scale) => {
    const S = BACKDROP.smoke;
    for (let i = 0; i < S.puffs; i++) {
      const m = keep(new THREE.SpriteMaterial({ map: smokeTex, color: smokeColor, transparent: true, depthWrite: false, fog: false, opacity: 0 }));
      const sp = new THREE.Sprite(m); group.add(sp);
      const ph = i / S.puffs, drift = 0.3 + r() * 0.3;
      anims.push((t) => {
        const k = (t / S.life + ph) % 1;
        sp.position.set(x + k * drift * 3 * scale, y + k * S.rise * S.life * scale, z);
        sp.scale.setScalar(scale * (0.7 + k * 2.2));
        m.opacity = 0.55 * Math.sin(Math.PI * Math.min(1, k * 1.4)) * (1 - k);
      });
    }
  };

  /** 中景的位置：后面（和两侧），离战场边至少 near；返回 { x, z, depth, k（远近 0–1）, hmax } */
  const M3 = BACKDROP.mid;
  const spot = (u, depth, side) => {
    // u ∈ [-1, 1] 横向位置；side = true 时放在战场左右两侧
    let x, z;
    if (side) { x = cx + Math.sign(u || 1) * (hx + M3.near + Math.abs(depth - M3.near) * (M3.side / M3.far)); z = cz - hz * (0.2 + r() * 1.0) - (depth - M3.near) * 0.5; }
    else { x = cx + u * (hx + M3.side * 0.6); z = cz - hz - depth; }
    const k = Math.min(1, Math.max(0, (depth - M3.near) / (M3.far - M3.near)));
    const hmax = Math.max(1, topY(z) * M3.fill);
    return { x, z, k, hmax: side ? Math.min(hmax, M3.sideMaxH) : hmax };
  };
  const place = (o, s, rot) => { o.position.set(s.x, -0.3, s.z); o.rotation.y = rot != null ? rot : (r() - 0.5) * 0.5; o.traverse(m => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } }); group.add(o); return o; };
  const mats = (k) => layers[k < 0.34 ? 0 : k < 0.67 ? 1 : 2];
  const depthAt = (a) => M3.near + a * (M3.far - M3.near);

  if (kind === "mine") {
    // 主角：左后方的矿井架；右后方一对冒烟的烟囱；中间一条传送带通到料仓；再撒些筒仓、矿渣堆、小厂房
    let s = spot(-0.55, depthAt(0.45));
    const hf = headframe(mats(s.k), s.hmax * 0.92); place(hf, s, 0.15); blinker(s.x, -0.3 + s.hmax * 0.92 * 1.1, s.z, 0.2);
    [0.55, 0.68].forEach((u, i) => {
      const s2 = spot(u, depthAt(0.55 + i * 0.12)), h = s2.hmax * (0.95 - i * 0.12);
      const ch = chimney(mats(s2.k), h, Math.max(0.35, h * 0.07)); place(ch.group, s2, 0);
      smoke(s2.x, -0.3 + ch.top, s2.z, Math.max(0.6, h * 0.12)); blinker(s2.x, -0.3 + ch.top + 0.2, s2.z, 0.6 + i * 0.3);
    });
    s = spot(-0.1, depthAt(0.2));
    place(conveyor(mats(s.k), Math.min(9, hx * 0.5), s.hmax * 0.5), s, 0);
    s = spot(0.25, depthAt(0.75)); place(silos(mats(s.k), s.hmax * 0.6, 3), s, 0);
    for (let i = 0; i < BACKDROP.count.mine; i++) {
      const side = r() < 0.4, d = depthAt(r()), sp = spot(r() * 2 - 1, d, side);
      const pick = r();
      if (pick < 0.45) place(heap(mats(sp.k), Math.min(sp.hmax * 0.45, 1.2 + r() * 2.2)), sp);
      else if (pick < 0.75) place(shed(mats(sp.k), 1.6 + r() * 2.2, Math.min(sp.hmax * 0.35, 0.9 + r() * 1.4)), sp);
      else place(silos(mats(sp.k), Math.min(sp.hmax * 0.5, 2.5 + r() * 2), 1 + Math.floor(r() * 2)), sp);
    }
  } else if (kind === "desert") {
    // 两侧和后面的大沙丘；后方一座带岩层的桌山、几根风蚀岩柱；左边半埋的船骨
    [-1, 1].forEach(sd => {
      const s = spot(sd, depthAt(0.15), true); place(dune(mats(s.k), Math.min(s.hmax * 0.9, 3.5 + r() * 1.5)), s, sd * 0.4);
    });
    let s = spot(0.35, depthAt(0.7)); place(mesa(mats(s.k), Math.min(10, hx * 0.7), s.hmax * 0.6), s, 0);
    [-0.6, -0.35, 0.75].forEach((u, i) => { const s2 = spot(u, depthAt(0.3 + i * 0.25)); place(pillar(mats(s2.k), s2.hmax * (0.75 - i * 0.1), 0.6 + r() * 0.4), s2); });
    s = spot(-1, depthAt(0.35), true); const wk = wreck(mats(s.k), Math.min(6, s.hmax * 1.6)); place(wk, s, 0.6);
    for (let i = 0; i < BACKDROP.count.desert; i++) {
      const side = r() < 0.5, sp = spot(r() * 2 - 1, depthAt(r()), side);
      if (r() < 0.65) place(dune(mats(sp.k), Math.min(sp.hmax * 0.6, 1.6 + r() * 2.4)), sp, r() * 3);
      else place(pillar(mats(sp.k), Math.min(sp.hmax * 0.6, 2 + r() * 2), 0.4 + r() * 0.4), sp);
    }
  } else if (kind === "night") {
    // 楼群（亮窗）：高楼可以冲出画面上沿（城市就该这样）；水塔、带红灯的天线
    for (let i = 0; i < BACKDROP.count.night; i++) {
      const side = r() < 0.3, sp = spot(r() * 2 - 1, depthAt(r()), side);
      const h = sp.hmax * (0.5 + r() * 0.75);
      place(tower(mats(sp.k), 1.6 + r() * 2.4, h, 1.6 + r() * 2, windows[Math.floor(r() * windows.length)]), sp, 0);
      if (r() < 0.3) blinker(sp.x, -0.3 + h + 1.1, sp.z, r());
    }
    let s = spot(-0.3, depthAt(0.3)); place(waterTower(mats(s.k), s.hmax * 0.6), s, 0);
    s = spot(0.45, depthAt(0.5)); const ant = box(mats(s.k).dark, 0.18, s.hmax * 0.95, 0.18, 0, s.hmax * 0.475, 0); place(ant, s, 0); blinker(s.x, -0.3 + s.hmax * 0.95, s.z, 0.5);
  } else {
    for (let i = 0; i < BACKDROP.count.wasteland; i++) {
      const sp = spot(r() * 2 - 1, depthAt(r()), r() < 0.4);
      place(r() < 0.5 ? heap(mats(sp.k), Math.min(sp.hmax * 0.5, 1.5 + r() * 2.5)) : pillar(mats(sp.k), Math.min(sp.hmax * 0.7, 2 + r() * 3), 0.6 + r() * 0.6), sp);
    }
  }

  // 采矿场 / 夜晚：天边一串远处的炉火 / 灯（泛光会抓到）
  if (kind === "mine" || night) {
    const glowM = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(night ? 0xffb35a : 0xff7a2a).multiplyScalar(2.4), toneMapped: false, fog: false }));
    const geo = keep(new THREE.SphereGeometry(0.2, 6, 5));
    for (let i = 0; i < 12; i++) {
      const th = (r() * 2 - 1) * arc * 0.9;
      const m = new THREE.Mesh(geo, glowM);
      m.position.set(cx + Math.sin(th) * (rx - 1.2), 0.1 + r() * bandH * 0.3, cz - Math.cos(th) * (rz - 1.2));
      group.add(m);
    }
  }

  return {
    group,
    update(t, dt) { anims.forEach(fn => fn(t, dt)); },
    dispose() {
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      own.forEach(m => { if (m.map && m.map.dispose) m.map.dispose(); if (m.dispose) m.dispose(); });
    }
  };
}

export { BACKDROP };
