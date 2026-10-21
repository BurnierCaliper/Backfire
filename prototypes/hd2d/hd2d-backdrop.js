/* Antlerscale: Backfire · HD-2D 战场原型 · 远景
 *
 * 镜头俯角 30°、视角只有 22°，画面最上沿也是往下看的——真正的天空根本进不了画面。所以在战场后面立一圈「天幕」
 * （像舞台的天幕布，绕到两侧），按镜头真正看得到的那一截画天空渐变；天幕前面两层剪影：
 *   1. 天边一圈画出来的远景（canvas 画在一条弧形带子上）：远处的厂区（后面一道矿坑的台阶状坑壁）/ 桌山 / 城市
 *   2. 中景几何体：大小按「画面上沿那条视线在那里有多高」来定，整个轮廓都在画面里，不会只露半截
 *        采矿场 mine：两侧台阶状的岩壁（露天矿坑的坑壁）、矿井架（A 字架 + 天轮）、烟囱（冒烟、顶上红灯一闪一闪）、传送带通到料仓、筒仓、矿渣堆
 *        沙漠 desert：沙丘、风蚀岩柱、带岩层的桌山、半埋在沙里的船骨；天网设施 skynet：同样的沙漠，加一座孤零零的天网塔
 *        城市 city（以前叫 night，还认）：楼群（夜里亮着窗、傍晚亮一些、白天窗是暗的；skyline = 楼的高度倍数）、水塔、天线（红灯）
 *        其余 wasteland：碎石岩丘
 *      用哪种由这场战斗所在的区域定（hd2d-layout.js 的 GROUNDS[].backdrop：沙漠 → 沙丘，采矿场 → 岩壁，城市 → 楼群）；
 *      区域认不得时场景照旧按光影主题挑。夜晚天幕上有星星
 * 剪影越远越接近天边的雾色（空气透视），景深再稍微糊一点（远处的糊上限在场景的 THEMES.dofFar）。
 * 雷鸣（storm）时天幕换成压暗的风暴色、画上慢慢翻滚的厚云（星星被盖住），中景上方再挂一层半透明的低云；
 * 打雷时云从里面亮起来，离雷近的那一片更亮。远处的雷劈在哪由这里给（farPoint：低云前面；天幕、低云都是弧，两边离得近，要按弧算）。
 *
 *   const bd = buildBackdrop("mine", bounds, "dusk", layout.camera, { sky: [...4 色], fog: 0xRRGGBB, storm, skyline });
 *   scene.add(bd.group); 每帧 bd.update(t, dt, { flash, x })（flash / x = 雷击的闪光和位置）；bd.farPoint(r)；bd.dispose();
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
  count: { mine: 14, desert: 12, city: 22, wasteland: 12 },
  cliff: { benches: 4, width: 9, fill: 0.85 },        // 采矿场两侧的岩壁：几级台阶、多宽、多高（× 两侧剪影的高度上限）
  skynet: { u: -0.12, depth: 0.5, h: 0.86, glow: 0x4fd8ff },   // 天网塔：横向位置（−1…1）、远近（0–1）、多高（× 高度上限）、顶上灯带的颜色
  windows: { night: 0.38, dusk: 0.2, day: 0.15 },     // 楼群的窗：夜里 / 傍晚有几成亮着；白天有几成反着天光
  smoke: { puffs: 7, rise: 0.55, life: 5.5 },        // 烟囱的烟：每根几团、往上飘多快、一团飘多久
  blink: 1.3,         // 红灯闪的周期（秒）
  groundRepeat: 26,
  /* 剪影颜色：近处（body）→ 远处靠向天边的雾色 */
  tint: {
    day: { body: 0x7a6248, rock: 0x8a6a4c, sand: 0xc89c62, dark: 0x5a4636 },
    dusk: { body: 0x2c1f28, rock: 0x3d2a2c, sand: 0x6a4436, dark: 0x1e1519 },
    night: { body: 0x0b0f18, rock: 0x121824, sand: 0x1a2030, dark: 0x06080e }
  },
  /* 雷鸣的乌云 */
  storm: {
    sky: {   // 天幕四色（地平线 → 画面上沿），都比平时暗
      day: ["#8b8a84", "#6c6f78", "#525866", "#3a4050"],
      dusk: ["#a86650", "#6e4a5a", "#45384e", "#262036"],
      night: ["#363244", "#232535", "#151824", "#07080e"]
    },
    cloud: {   // 云的暗面 / 底下被地面（夜晚是城市的灯）照到的亮面
      day: [0x3a3f4a, 0x8f8e88], dusk: [0x2a2232, 0x9a5e62], night: [0x0e1119, 0x463e4c]
    },
    flash: 0xd8e2ff,          // 雷光把云照亮的颜色
    cover: 0.7,               // 天幕上的云盖得多满（0–1；0.5 大约盖住六成天，0.7 大约八成）
    speed: [0.003, 0.006],    // 天幕上远 / 近两层云往右飘的速度（每秒走过多少圈弧：很慢）
    scale: [26, 47],          // 天幕上远 / 近两层云的疏密（沿弧一圈有几团）
    low: { inset: 5.5, arc: 0.42, base: 0.25, opacity: 0.6, speed: 0.011, scale: 30 },   // 中景上方的低云：离天幕多远、左右绕多宽（× π）、下沿在画面上沿视线的几成高、多不透明、飘多快、多密
    strike: { arc: 0.5, inset: 6 }   // 远处的雷劈在哪：左右最多偏多少（弧度）、离天幕多远（比低云近一点：劈在低云前面、中景的楼 / 山之间，整道看得见）
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

/** 废土地面：地台下面一大片暗地，像把地台摆在场景里（远处藏在天幕后面）。颜色由场景按光影主题 / 区域的地面主题设 */
export function buildGround() {
  const tex = groundTexture();
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(150, 56),
    new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 1, map: tex, flatShading: true })
  );
  m.rotation.x = -Math.PI / 2; m.position.y = L.CONFIG.groundY; m.receiveShadow = true;
  return m;
}

/* ---------- 天幕 ---------- */
/** 着色器里共用的噪声：hash / 值噪声 / 分形噪声（云用） */
const NOISE_GLSL = `float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
      float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; } return v; }`;

/** 天幕的形状：绕着战场中心的半个椭圆筒（开口朝镜头），u 沿着弧，v 沿着高。y0 / y1 可以是数，也可以按进深 z 给（低云的上下沿跟着画面上沿视线走） */
function arcGeometry(cx, cz, rx, rz, arc, y0, y1, seg) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const th = -arc + (2 * arc * i) / seg, x = cx + Math.sin(th) * rx, z = cz - Math.cos(th) * rz;
    pos.push(x, typeof y0 === "function" ? y0(z) : y0, z, x, typeof y1 === "function" ? y1(z) : y1, z); uv.push(i / seg, 0, i / seg, 1);
    if (i < seg) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** 天空：按「默认镜头在这里看得到多高」把四个颜色铺开（地平线 → 画面上沿），傍晚加一团夕阳光晕和几条被照亮的云，夜晚加星星；
 *  雷鸣（opts.storm）时画上两层慢慢飘的厚云，打雷时云从里面亮起来（time / flash / flashU 每帧由 update 设） */
function skyMaterial(colors, opts) {
  const ST = BACKDROP.storm;
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide, fog: false, depthWrite: true,
    uniforms: {
      c0: { value: new THREE.Color(colors[0]) }, c1: { value: new THREE.Color(colors[1]) },
      c2: { value: new THREE.Color(colors[2]) }, c3: { value: new THREE.Color(colors[3]) },
      stops: { value: new THREE.Vector4(...BACKDROP.stops) },
      camY: { value: opts.camY }, camZ: { value: opts.camZ }, slope: { value: opts.slope }, base: { value: -0.35 },
      haze: { value: new THREE.Color(opts.fog) },
      sun: { value: new THREE.Vector3(opts.sun[0], opts.sun[1], opts.sun[2]) }, sunColor: { value: new THREE.Color(opts.sunColor) },
      stars: { value: opts.stars ? 1 : 0 }, clouds: { value: opts.clouds || 0 }, cloudColor: { value: new THREE.Color(opts.cloudColor || 0xffffff) },
      storm: { value: opts.storm ? 1 : 0 }, time: { value: 0 }, cover: { value: ST.cover },
      speed: { value: new THREE.Vector2(...ST.speed) }, scale: { value: new THREE.Vector2(...ST.scale) },
      cloudDark: { value: new THREE.Color(opts.cloudDark || 0x333333) }, cloudLit: { value: new THREE.Color(opts.cloudLit || 0x888888) },
      flashColor: { value: new THREE.Color(ST.flash) }, flash: { value: 0 }, flashU: { value: 0.5 }
    },
    vertexShader: `varying vec3 vW; varying vec2 vUv;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 c0; uniform vec3 c1; uniform vec3 c2; uniform vec3 c3; uniform vec4 stops;
      uniform float camY; uniform float camZ; uniform float slope; uniform float base; uniform vec3 haze;
      uniform vec3 sun; uniform vec3 sunColor; uniform float stars; uniform float clouds; uniform vec3 cloudColor;
      uniform float storm; uniform float time; uniform float cover; uniform vec2 speed; uniform vec2 scale;
      uniform vec3 cloudDark; uniform vec3 cloudLit; uniform vec3 flashColor; uniform float flash; uniform float flashU;
      varying vec3 vW; varying vec2 vUv;
      ${NOISE_GLSL}
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
        // 乌云（雷鸣）：远近两层厚云往右慢慢飘、慢慢翻滚，贴地平线的一截薄、往上越厚；底下被地面 / 城市的光照到一点。
        // 打雷时云从里面亮起来：云厚的地方更亮，离雷近的那一片最亮
        if (storm > 0.0) {
          float n1 = fbm(vec2((vUv.x - time * speed.x) * scale.x, s * 2.6 + time * 0.012));
          float n2 = fbm(vec2((vUv.x - time * speed.y) * scale.y, s * 4.4 + 3.7 - time * 0.008));
          float lo = 0.58 - cover * 0.38;   // 分形噪声大约是 0.48 ± 0.12：cover 越大，盖住的越多
          float dens = clamp(smoothstep(lo, lo + 0.22, n1) * 0.85 + smoothstep(lo + 0.05, lo + 0.25, n2) * 0.5, 0.0, 1.0) * smoothstep(-0.05, 0.3, s);
          vec3 cc = mix(cloudLit, cloudDark, clamp(smoothstep(0.0, 0.8, s) * 0.75 + smoothstep(0.5, 0.75, n1) * 0.35, 0.0, 1.0));
          col = mix(col, cc, dens);
          float fu = (vUv.x - flashU) * 7.0, glow = exp(-fu * fu);
          col += flashColor * flash * (0.12 + 0.88 * dens) * (0.25 + 0.75 * glow);
        }
        // 贴地的一截融进雾里（和远处的地面接上）
        col = mix(haze, col, smoothstep(-0.02, 0.1, s));
        gl_FragColor = vec4(col, 1.0);
      }`
  });
}

/** 雷鸣时中景上方的低云：一条弧形的带子（v 从下沿到画面外面），云的噪声慢慢往右飘；下沿软、坑坑洼洼，两头淡出；打雷时被照亮 */
function lowCloudMaterial(opts) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: {
      time: { value: 0 }, speed: { value: opts.speed }, scale: { value: opts.scale }, opacity: { value: opts.opacity },
      cloudDark: { value: new THREE.Color(opts.dark) }, cloudLit: { value: new THREE.Color(opts.lit) },
      flashColor: { value: new THREE.Color(opts.flashColor) }, flash: { value: 0 }, flashU: { value: 0.5 }
    },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform float time; uniform float speed; uniform float scale; uniform float opacity; uniform vec3 cloudDark; uniform vec3 cloudLit;
      uniform vec3 flashColor; uniform float flash; uniform float flashU; varying vec2 vUv;
      ${NOISE_GLSL}
      void main(){
        float n = fbm(vec2((vUv.x - time * speed) * scale, vUv.y * 2.4 + time * 0.02));
        float n2 = fbm(vec2((vUv.x - time * speed * 1.5) * scale * 2.1, vUv.y * 4.5 + 5.3));
        float edge = smoothstep(0.0, 0.22, vUv.y + (n2 - 0.5) * 0.35);                 // 下沿：软的、坑坑洼洼
        float ends = smoothstep(0.0, 0.15, vUv.x) * (1.0 - smoothstep(0.85, 1.0, vUv.x));   // 两头淡出
        float d = smoothstep(0.36, 0.62, n * 0.75 + n2 * 0.35) * edge * ends;
        vec3 col = mix(cloudLit, cloudDark, smoothstep(0.0, 0.7, vUv.y));
        float fu = (vUv.x - flashU) * 4.0;
        col += flashColor * flash * (0.3 + 0.7 * exp(-fu * fu));
        gl_FragColor = vec4(col, d * opacity);
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
  } else if (kind === "city") {
    // 城市天际线：高低错落的楼，亮着零星的窗（colors.lit：夜里 1、傍晚一半、白天不亮）
    const lit = colors.lit || 0;
    [far, near].forEach((col, layer) => {
      let x = 0;
      while (x < W) {
        const w = 26 + r() * 60, h = (layer ? 50 : 80) + r() * (layer ? 90 : 140);
        rect(x, w, h, col);
        if (r() < 0.25) rect(x + w * 0.4, 3, h + 18 + r() * 20, col);            // 天线
        for (let wy = H - h + 8; wy < H - 6; wy += 9) for (let wx = x + 4; wx < x + w - 5; wx += 8) {
          if (r() < (layer ? 0.22 : 0.12) * lit) { g.fillStyle = r() < 0.7 ? "rgba(255,206,120,.95)" : "rgba(150,210,255,.9)"; g.fillRect(wx, wy, 3, 4); }
        }
        x += w + r() * 14;
      }
    });
  } else if (kind === "mine") {
    // 最远的一层：露天矿坑台阶状的坑壁（岩壁），一级级平台，平台的边上一道暗线
    if (colors.wall) {
      g.fillStyle = colors.wall; g.beginPath(); g.moveTo(0, H);
      let x = 0, y = H * (0.42 + r() * 0.1);
      while (x < W) {
        g.lineTo(x, y); x += 60 + r() * 140; g.lineTo(x, y);
        y = Math.max(H * 0.3, Math.min(H * 0.58, y + (r() < 0.5 ? -1 : 1) * (8 + r() * 14)));
        x += 6; g.lineTo(x, y);
      }
      g.lineTo(W, H); g.fill();
      g.strokeStyle = "rgba(0,0,0,.14)"; g.lineWidth = 2;
      for (let k = 1; k <= 3; k++) { g.beginPath(); g.moveTo(0, H * (0.55 + k * 0.1)); g.lineTo(W, H * (0.55 + k * 0.1)); g.stroke(); }
    }
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
  g.userData.kind = "headframe";
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
/** 露天矿坑的岩壁：几级往后退、往上高的台阶，每级顶上参差不齐，一层岩一层土；w = 宽、h = 最高 */
function cliff(M, w, h, benches, rand) {
  const g = new THREE.Group(), step = h / benches;
  for (let i = 0; i < benches; i++) {
    const segs = 4 + Math.floor(rand() * 3), sw = w / segs;
    for (let k = 0; k < segs; k++) {
      const hh = step * (i + 1) * (0.86 + rand() * 0.22);
      g.add(box(i % 2 ? M.sand : M.rock, sw * (1.02 + rand() * 0.1), hh, step * 1.5, -w / 2 + sw * (k + 0.5), hh / 2, -i * step * 1.25));
    }
  }
  g.userData.kind = "cliff";
  return g;
}
/** 沙丘：顺滑的长条（光滑着色，迎光面亮、背光面暗，一看就是沙丘不是土堆） */
function dune(M, s) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.sandSmooth);
  m.scale.set(s * 2.4, s * 0.5, s); m.userData.kind = "dune"; return m;
}
/** 天网塔：沙漠里孤零零的一座细高的塔（下粗上细，腰上两道箍），顶上一圈圆盘平台、一圈发青光的灯带和一根天线；h = 总高 */
function skynetTower(M, h, glowMat) {
  const g = new THREE.Group(), r = Math.max(0.35, h * 0.045);
  g.add(cyl(M.body, r * 0.7, r * 1.25, h * 0.86, 0, h * 0.43, 0, 10));
  [0.35, 0.62].forEach(k => g.add(cyl(M.dark, r * 1.35, r * 1.35, h * 0.02, 0, h * k, 0, 12)));
  g.add(cyl(M.body, r * 2.6, r * 1.5, h * 0.06, 0, h * 0.88, 0, 14));
  g.add(cyl(M.dark, r * 2.7, r * 2.7, h * 0.012, 0, h * 0.915, 0, 14));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 2.62, r * 0.09, 4, 28), glowMat);
  ring.rotation.x = Math.PI / 2; ring.position.y = h * 0.9; g.add(ring);
  g.add(box(M.dark, r * 0.18, h * 0.1, r * 0.18, 0, h * 0.97, 0));
  g.userData.kind = "skynet";
  return g;
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
/** 楼的窗：lit = 夜里 / 傍晚有几成亮着（黑墙 + 黄 / 青的亮窗）；day = 白天（浅色的墙、暗窗，lit 成反着天光） */
function windowTexture(seed, lit, day) {
  const c = document.createElement("canvas"); c.width = 64; c.height = 128;
  const g = c.getContext("2d"), r = rng(seed);
  g.fillStyle = day ? "#cfc8bc" : "#07090e"; g.fillRect(0, 0, 64, 128);
  for (let y = 6; y < 124; y += 9) for (let x = 6; x < 58; x += 9) {
    if (day) { g.fillStyle = r() < lit ? "#8fa4b4" : "#3c4048"; g.fillRect(x, y, 5, 5); }
    else if (r() < lit) { g.fillStyle = r() < 0.7 ? "#ffd27a" : "#9fd8ff"; g.fillRect(x, y, 5, 5); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t;
}
function tower(M, w, h, d, win) {
  const g = new THREE.Group();
  g.add(put(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), win), 0, h / 2, 0));
  g.add(box(M.body, w * 0.5, Math.min(0.8, h * 0.08), d * 0.5, 0, h + 0.4, 0));
  g.userData.kind = "tower";
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
 * 建一圈远景。kind = city / mine / desert / skynet / wasteland（night 是 city 的旧名字）；bounds 是战场范围；
 * camera 是布局算好的默认镜头（hd2d-layout.js 的 fitView），用来算「画面上沿那条视线」有多高；
 * colors = { sky: [地平线 → 天顶 4 个颜色], fog, storm, skyline }（storm = 雷鸣：天空换成 BACKDROP.storm 的风暴色、加乌云和低云；
 * skyline = 楼群的高度倍数，外城区矮、巨人城高）。返回 { group, update(t, dt, { flash, x }), farPoint(r), dispose }。
 */
export function buildBackdrop(kind, bounds, themeName, camera, colors) {
  colors = colors || {};
  const T = BACKDROP.tint[themeName] || BACKDROP.tint.day;
  const own = [];     // 自己建的材质 / 贴图 / 几何，dispose 时清
  const keep = (x) => { own.push(x); return x; };
  const night = themeName === "night", dusk = themeName === "dusk";
  const storm = !!colors.storm, ST = BACKDROP.storm, cloud = ST.cloud[themeName] || ST.cloud.day;
  const group = new THREE.Group();
  const anims = [];
  const seed = kind.length;   // 随机种子按传进来的名字算（night 改叫 city 以后，认不得区域时的夜景还是原来那一套）
  if (kind === "night") kind = "city";
  const r = rng(seed * 31 + Math.round((bounds.maxX - bounds.minX) * 7) + Math.round((bounds.maxZ - bounds.minZ) * 3));
  const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
  const hx = (bounds.maxX - bounds.minX) / 2, hz = (bounds.maxZ - bounds.minZ) / 2;
  const cam = camera || { pos: { y: 25, z: cz + 45 }, elevation: 30, fov: 22 };
  const slope = Math.tan((cam.elevation - cam.fov / 2) * D2R);   // 天空的着色器里用同一条视线
  /** 默认镜头的画面上沿那条视线，在 z 处离地多高（这么高以内的东西整个都在画面里） */
  const topY = (z) => L.frameTop(cam, z);
  const sky = storm ? (ST.sky[themeName] || ST.sky.day) : (colors.sky || ["#e8d8b8", "#d8c8a8", "#b8b0a0", "#8a8a90"]);
  const fog = new THREE.Color(colors.fog != null ? colors.fog : 0x888888);
  const hazeOf = (k) => new THREE.Color(sky[0]).lerp(fog, 0.5).lerp(new THREE.Color(T.body), 1 - k);   // k 越大越靠近天边的雾色

  /* 1. 天幕（雷鸣时：风暴色 + 乌云，星星和亮云不画，夕阳只透出一点） */
  const rz = hz + BACKDROP.skyGap, rx = hx + BACKDROP.sideGap, arc = BACKDROP.skyArc * Math.PI;
  const skyM = keep(skyMaterial(sky, {
    camY: cam.pos.y, camZ: cam.pos.z, slope, fog,
    sun: dusk ? [0.3, 0.12, 0.09] : night ? [0.22, 0.9, 0.05] : [0.28, 0.75, 0.16],
    sunColor: new THREE.Color(dusk ? 0xff9a50 : night ? 0x30405a : 0x6a5530).multiplyScalar(storm ? 0.35 : 1), stars: night && !storm,
    clouds: storm ? 0 : dusk ? 0.55 : themeName === "day" ? 0.25 : 0, cloudColor: dusk ? 0xffb090 : 0xf4e2bc,
    storm, cloudDark: cloud[0], cloudLit: cloud[1]
  }));
  const skyMesh = new THREE.Mesh(keep(arcGeometry(cx, cz, rx, rz, arc, -0.6, BACKDROP.skyH, 72)), skyM);
  skyMesh.renderOrder = -1;
  group.add(skyMesh);
  /* 1b. 雷鸣：中景上方再挂一层半透明的低云（离天幕 low.inset，下沿按画面上沿视线定，上沿伸出画面），比天幕上的云飘得快一点 */
  const LW = ST.low, low = storm ? { rx: rx - LW.inset, rz: rz - LW.inset, arc: LW.arc * Math.PI } : null;
  if (low) {
    low.mat = keep(lowCloudMaterial({ speed: LW.speed, scale: LW.scale, opacity: LW.opacity, dark: cloud[0], lit: cloud[1], flashColor: ST.flash }));
    const m = new THREE.Mesh(keep(arcGeometry(cx, cz, low.rx, low.rz, low.arc, (z) => topY(z) * LW.base, (z) => topY(z) + 1.5, 64)), low.mat);
    m.renderOrder = -0.5;   // 比战场上的半透明东西、远处的闪电（在它前面）先画
    m.frustumCulled = false; m.userData.cloud = true;
    group.add(m);
  }

  /* 2. 天边画出来的远景：一条弧形带子，贴在天幕前面一点 */
  const backTop = topY(cz - rz);
  const bandH = Math.max(1.2, backTop * BACKDROP.bandH);
  const nearC = hazeOf(0.55), farC = hazeOf(0.82), wallC = hazeOf(0.92);
  const bandTex = keep(bandTexture(kind === "skynet" ? "desert" : kind, {
    far: "#" + farC.getHexString(), near: "#" + nearC.getHexString(), wall: "#" + wallC.getHexString(), lit: night ? 1 : dusk ? 0.5 : 0
  }, seed * 97 + 11));
  const bandLen = ((rx + rz) / 2) * 2 * arc;
  bandTex.repeat.set(Math.max(1, Math.round(bandLen / (bandH * 8))), 1);
  const bandM = keep(new THREE.MeshBasicMaterial({ map: bandTex, transparent: true, alphaTest: 0.02, fog: false, side: THREE.DoubleSide, color: night ? new THREE.Color(1.5, 1.5, 1.5) : 0xffffff, toneMapped: !night }));
  const band = new THREE.Mesh(keep(arcGeometry(cx, cz, rx - 0.7, rz - 0.7, arc * 0.98, -0.4, bandH, 72)), bandM);
  band.renderOrder = -0.7;   // 半透明的东西里最先画（它最远）：低云、远处的闪电、烟都在它前面
  group.add(band);

  /* 3. 中景几何体 */
  const std = (color, opt) => keep(new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 1, flatShading: true, fog: false }, opt || {})));
  /** 一层的材质：远一点的偏向雾色，再带一点自发光（像被雾里的光照着） */
  const mixOf = (c, k) => new THREE.Color(c).lerp(hazeOf(1), k * 0.55);
  const emOf = (k) => hazeOf(1).multiplyScalar(0.18 + k * 0.35);
  const layerMats = (k) => {
    const mix = (c) => mixOf(c, k), em = emOf(k);
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
  /** 楼的窗（三种排法）：夜里 / 傍晚是黑墙 + 亮窗（自己发光，泛光会抓到；不分远近）；白天是浅墙暗窗，按远近偏向雾色，跟别的剪影一样 */
  const W8 = BACKDROP.windows;
  const winTex = kind === "city" ? [1, 2, 3].map(s => keep(windowTexture(s * 17, night ? W8.night : dusk ? W8.dusk : W8.day, !night && !dusk))) : null;
  const winLit = winTex && (night || dusk) ? winTex.map(t => keep(new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.5, 1.5, 1.5).multiplyScalar(night ? 1 : 0.8), toneMapped: false, fog: false }))) : null;
  const winDay = {};
  const windowMat = (k, i) => {
    if (winLit) return winLit[i];
    const lv = k < 0.34 ? 0 : k < 0.67 ? 0.5 : 1, key = lv + ":" + i;   // 和 mats(k) 一样分三层
    return winDay[key] || (winDay[key] = std(mixOf(T.body, lv), { map: winTex[i], emissive: emOf(lv) }));
  };

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
    // 两侧台阶状的岩壁（露天矿坑的坑壁），斜着朝向战场；最后才摆，上面那些厂房的位置不变
    const CL = BACKDROP.cliff;
    [-1, 1].forEach(sd => {
      const s2 = spot(sd, depthAt(0.3), true);
      place(cliff(mats(s2.k), CL.width, s2.hmax * CL.fill, CL.benches, r), s2, -sd * 0.75);
    });
  } else if (kind === "desert" || kind === "skynet") {
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
    if (kind === "skynet") {
      // 天网设施：沙漠里孤零零的天网塔，顶上一圈青光（和地台的发光接缝同色）、天线上一盏红灯
      const SK = BACKDROP.skynet, s2 = spot(SK.u, depthAt(SK.depth)), h = s2.hmax * SK.h;
      const ringM = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(SK.glow).multiplyScalar(2.2), toneMapped: false, fog: false }));
      place(skynetTower(mats(s2.k), h, ringM), s2, 0); blinker(s2.x, -0.3 + h * 1.02, s2.z, 0.3);
    }
  } else if (kind === "city") {
    // 楼群：高楼可以冲出画面上沿（城市就该这样）；水塔、带红灯的天线。楼的高低按区域（colors.skyline：外城区矮、巨人城高）
    const tall = colors.skyline || 1;
    for (let i = 0; i < BACKDROP.count.city; i++) {
      const side = r() < 0.3, sp = spot(r() * 2 - 1, depthAt(r()), side);
      const h = sp.hmax * (0.5 + r() * 0.75) * tall;
      place(tower(mats(sp.k), 1.6 + r() * 2.4, h, 1.6 + r() * 2, windowMat(sp.k, Math.floor(r() * winTex.length))), sp, 0);
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

  /** 世界 x 在一条弧上对应的 u（0–1，打雷时照亮云用） */
  const uOf = (x, r, a) => (Math.asin(Math.max(-1, Math.min(1, (x - cx) / r))) + a) / (2 * a);
  return {
    group,
    /** light = { flash, x }：雷击的闪光（0–1）和位置；乌云跟着 t 慢慢飘（减少动态效果时 t 停住） */
    update(t, dt, light) {
      anims.forEach(fn => fn(t, dt));
      if (!storm) return;
      const f = (light && light.flash) || 0, x = (light && light.x) || 0, u = skyM.uniforms;
      u.time.value = t; u.flash.value = f; u.flashU.value = uOf(x, rx, arc);
      if (low) { const lu = low.mat.uniforms; lu.time.value = t; lu.flash.value = f; lu.flashU.value = uOf(x, low.rx, low.arc); }
    },
    /** 远处的雷劈在哪：r ∈ [−1, 1] 从左到右；在低云前面一点（天幕、低云都是绕着战场的弧，两边离得近，所以也按弧算） */
    farPoint(r) {
      const S = ST.strike, th = Math.max(-1, Math.min(1, r)) * S.arc;
      return { x: cx + Math.sin(th) * (rx - S.inset), z: cz - Math.cos(th) * (rz - S.inset) };
    },
    dispose() {
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      own.forEach(m => { if (m.map && m.map.dispose) m.map.dispose(); if (m.dispose) m.dispose(); });
    }
  };
}

export { BACKDROP };
