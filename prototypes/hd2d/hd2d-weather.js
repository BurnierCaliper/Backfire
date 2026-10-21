/* Antlerscale: Backfire · HD-2D 战场原型 · 天气粒子、飘浮物和雷击
 *
 * 跟着 state.weather 走：sand 沙暴 / snow 雪 / acid 酸雨 / thunder 雷鸣（不下雨：乌云 + 随机雷击）/ heat 酷暑（热浪）/ glow 微光 / phase 相位。
 * 另外一直有一层慢慢飘的「飘浮物」（AMBIENT）：晴天是光里看得见的尘埃（按光影主题换颜色），各种天气各有各的
 * （沙暴里的大团沙尘、雪天的冰晶、酸雨往上冒的孢子、雷鸣时风卷起来的尘、酷暑的热尘……）。
 * 雷鸣的乌云画在远景里（hd2d-backdrop.js 的 BACKDROP.storm）；这里管雷击：隔一段随机的时间（STORM.interval）劈一道闪电，
 * 多半劈在远处的乌云下面，偶尔劈在战场边缘；每一道连闪几下（全屏闪白、推亮灯光由场景做），镜头轻微抖一下。
 *
 *   const fx = createWeather(scene, { bounds, random });   // random 不给就用 Math.random
 *   fx.setBounds(bounds, { camera, farPoint });   // camera = 布局的默认镜头（闪电从画面上沿外面劈下来、粗细按像素算）；farPoint(r) = 远处的雷劈在哪（远景给）
 *   fx.setWind({ x, z });   // 沙暴的风（世界里的方向，hd2d-wfx.js · windOf 按 state.sandDir 算）：配置里写了 wind 的粒子顺着它飞（#240）
 *   fx.set("sand", "day");  fx.update(dt, t, { dt: 真实的 dt, reduced });
 *   fx.flash        // 雷击的闪光 0–1（场景拿去全屏闪白、推亮灯光；减少动态效果时这里已经减弱过）
 *   fx.shake        // { x, y }：这一帧镜头抖动的偏移（像素；减少动态效果时恒为 0）
 *   fx.strike       // 最近一道雷 { n, x, z, edge, age }（远景拿 x 照亮那一片云），还没打过是 null
 *   fx.storm        // 有没有乌云 + 雷击（场景拿去压暗灯光）
 *   fx.heat         // 酷暑的热浪强度 0–1，由场景拿去开扭曲后期
 *   fx.tint         // { fog: 0xRRGGBB, near, far, mix, sky, haze, veil, sun, dof }：这个天气想要的雾（near / far 乘在场景算好的雾距上，见 fogRange；
 *                   //   雾色往 fog 靠 mix，见 fogColor）；sky / haze / veil / sun = 远景蒙上多少沙尘（hd2d-backdrop.js 的 colors.dust）；dof = 远处景深多糊几倍
 * 减少动态效果时场景传 dt = 0、t 停住：粒子停在原地；雷击按真实时间（opts.dt）照打，但只闪一下、亮度打折，镜头不抖。
 * 2D 的天气层（正式画面的 weather-fx.css / weather-fx.js 原样套上来）在 hd2d-wfx.js，压在这些 3D 粒子上面（#240）。 */
import * as THREE from "three";

/** 布局（hd2d-layout.js，普通脚本，比这个模块先加载）：闪电从画面上沿那条视线（frameTop）外面劈下来 */
const L = window.HD2DLayout;

/* 每种天气的参数（数量 / 速度 / 颜色都在这里）。kind 是天气粒子（points 点 / lines 雨丝），没有 kind 就不生成粒子。
 * 雷鸣不下雨（主人要求）：只有雾色和 storm（乌云 + 雷击，参数在下面的 STORM）；酸雨照旧是雨丝。
 * 雾：fog 雾色（可以按光影主题分开写 { day, dusk, night }）、mix 场景的雾色往它靠多少（不写 = FOG_MIX）、near / far 起雾 / 全进雾的地方乘多少（fogRange）。
 * 沙暴（#240：主人嫌「还没有之前的天气效果明显」）——
 *   沙粒顺着风横飞（wind：速度的 x 分量是顺风的、z 分量是横着飘的，转到 setWind 给的风向上；和 2D 层的沙雾一个方向），
 *   再加一层短短的拖影（streak：lines，跟着沙粒一起飞，看得出在横飞）；
 *   雾更浓更黄：雾色更偏沙黄、mix 更往它靠，起雾 / 全进雾都更近（以前 near 0.55 / far 2.3：起雾早但拉得很长，战场后面的地反而比晴天还清楚）；
 *   远景蒙上沙色（hd2d-backdrop.js 的 colors.dust：sky 天幕往雾色靠多少、haze 贴地融进雾里的那一截多高、veil 中景剪影至少蒙多少、sun 太阳的光晕剩几成，星星和亮云盖住）；
 *   远处景深更糊（dof：远处的糊上限 × 这个数）。2D 的沙雾在 hd2d-wfx.js（正式画面的 .wfx-sand 原样套上来） */
const FOG_MIX = 0.6;
const WEATHER = {
  sand: {
    kind: "points", count: 1600, size: 0.16, color: 0xe6bd7c, opacity: 0.85, vel: [8.5, -0.35, 1.2], jitter: 1.5, wind: true,
    streak: { count: 520, len: 0.75, color: 0xf2d29a, opacity: 0.45 },
    fog: { day: 0xd09a50, dusk: 0xc08850, night: 0x8a6a3a }, mix: 0.8, near: 0.76, far: 0.9,
    sky: 0.5, haze: 0.42, veil: 0.35, sun: 0.6, dof: 1.8
  },
  snow: { kind: "points", count: 1300, size: 0.18, color: 0xffffff, opacity: 0.9, vel: [0.25, -1.3, 0.1], jitter: 0.45, sway: 0.5, fog: 0xc6d3de, near: 0.7, far: 3.0 },
  acid: { kind: "lines", count: 1000, len: 0.75, color: 0xa6e04a, opacity: 0.6, vel: [0.6, -15, 0.2], fog: 0x6a8a34, near: 0.65, far: 2.8, additive: true },
  thunder: { fog: 0x39465a, near: 0.6, far: 2.6, storm: true },
  heat: { kind: "points", count: 90, size: 0.17, color: 0xffb060, opacity: 0.7, vel: [0.1, 0.55, 0], jitter: 0.2, sway: 0.4, fog: 0xe0b37a, near: 0.9, far: 3.7, additive: true, heat: 1 },
  glow: { kind: "points", count: 220, size: 0.15, color: 0x6affd8, opacity: 0.85, vel: [0.05, 0.16, 0.03], jitter: 0.25, sway: 0.7, fog: null, near: 1, far: 1, additive: true },
  phase: { kind: "points", count: 160, size: 0.16, color: 0xc07cf0, opacity: 0.8, vel: [0, 0.3, 0], jitter: 0.5, sway: 0.9, fog: null, near: 1, far: 1, additive: true }
};
/* 飘浮物：一直在，慢；只飘在战场上方一层（top 以下），光里亮的那几颗更亮（bright = 亮的比例）。
 * 晴天按光影主题，其余按天气；写了 wind 的顺着沙暴的风飘（同 WEATHER） */
const AMBIENT = {
  clear: {
    day: { count: 150, size: 0.1, color: 0xfff1cf, opacity: 0.55, vel: [0.12, 0.05, 0.04], sway: 0.35, jitter: 0.5, bright: 0.25, additive: true },
    dusk: { count: 180, size: 0.11, color: 0xffc896, opacity: 0.6, vel: [0.1, 0.06, 0.03], sway: 0.35, jitter: 0.5, bright: 0.3, additive: true },
    night: { count: 110, size: 0.09, color: 0xb0ccff, opacity: 0.45, vel: [0.06, 0.04, 0.02], sway: 0.3, jitter: 0.4, bright: 0.2, additive: true }
  },
  sand: { count: 160, size: 0.26, color: 0xe8c48a, opacity: 0.36, vel: [1.6, 0.05, 0.3], sway: 0.6, jitter: 0.8, bright: 0.1, wind: true },
  snow: { count: 90, size: 0.12, color: 0xeaf6ff, opacity: 0.8, vel: [0.05, 0.08, 0.02], sway: 0.5, jitter: 0.5, bright: 0.4, additive: true },
  acid: { count: 90, size: 0.12, color: 0xb8ff6a, opacity: 0.65, vel: [0.04, 0.18, 0.02], sway: 0.6, jitter: 0.4, bright: 0.3, additive: true },
  thunder: { count: 100, size: 0.22, color: 0x8d96a6, opacity: 0.24, vel: [0.85, 0.03, 0.12], sway: 0.6, jitter: 0.9, bright: 0.12 },   // 风卷起来的尘（不是雨）
  heat: { count: 120, size: 0.1, color: 0xffd090, opacity: 0.5, vel: [0.05, 0.12, 0.02], sway: 0.5, jitter: 0.5, bright: 0.25, additive: true },
  glow: { count: 60, size: 0.1, color: 0xd8fff4, opacity: 0.5, vel: [0.04, 0.05, 0.02], sway: 0.6, jitter: 0.4, bright: 0.3, additive: true },
  phase: { count: 60, size: 0.1, color: 0xe8d0ff, opacity: 0.5, vel: [0.03, 0.06, 0.02], sway: 0.7, jitter: 0.5, bright: 0.3, additive: true }
};
const HEIGHT = 14;            // 天气粒子盒子的高度
const AMB = { low: 0.4, top: 6, pad: 2 };   // 飘浮物：离地 low–top 之间，比战场每边多 pad

/* 雷鸣的雷击（全屏闪白有多白、灯光推亮多少在 hd2d-scene.js 的 FLASH；乌云在 hd2d-backdrop.js 的 BACKDROP.storm） */
const STORM = {
  first: [1.5, 3.5],          // 进场后第一道雷多久劈下来（秒，随机）
  interval: [4, 10],          // 两道雷之间隔多久（秒，在这个范围里随机）：闪光多频繁就调这个
  edge: 0.3,                  // 劈在战场边缘的概率（其余劈在远处的乌云下面）
  edgeDepth: [0.8, 2.2],      // 战场边缘的雷劈在后沿再往后多远（世界单位）
  power: { far: 0.75, edge: 1 },                  // 闪光多亮（远处的暗一点）
  flicker: [[0, 1], [0.09, 0.5], [0.19, 0.85]],   // 一道雷连闪几下：[第几秒, 亮度]
  fade: 14,                   // 每一下闪完退得多快（每秒；越大越短促）
  /* 闪电本身：挂多久（秒）、芯 / 外圈光的粗细（像素，按远近换成世界单位）、外圈光多亮、颜色、亮度（超过 1 让泛光抓到）、
   * 每一节横着歪多少（× 总高）、分几条叉、劈在战场边缘时地上那团光多大 */
  bolt: { life: 0.32, core: 2.5, glow: 18, glowLevel: 0.35, color: 0xdfe8ff, bright: 3, jag: 0.09, branches: [1, 3], impact: 3.2 },
  shake: { far: 2.5, edge: 6, dur: 0.45, freq: 23 },   // 镜头抖动：远处 / 战场边缘的雷抖多少（像素）、抖多久（秒）、抖多快（每秒几下）
  reduced: { flash: 0.35, fade: 5, bolt: 0.6 }         // 减少动态效果：闪光只到 35%、只闪一下（退得慢一点，不刺眼）、闪电淡一点；镜头不抖
};

/** 一种天气要建哪些东西（纯数据，不碰 three.js）：main 天气粒子（雨 / 雪 / 沙……，没有就是 null）、streak 沙粒的拖影（没有就是 null）、
 *  ambient 飘浮物、storm 乌云 + 雷击、tint 雾（雾色按光影主题挑好；mix / sky / haze / veil / dof 没写的用不改变画面的默认值） */
export function weatherPlan(kind, theme) {
  const cfg = WEATHER[kind] || null;
  const fog = cfg && cfg.fog != null && typeof cfg.fog === "object" ? (cfg.fog[theme] != null ? cfg.fog[theme] : cfg.fog.day) : cfg && cfg.fog;
  return {
    main: cfg && cfg.kind ? cfg : null,
    streak: cfg && cfg.kind && cfg.streak ? Object.assign({ kind: "lines", vel: cfg.vel, wind: cfg.wind }, cfg.streak) : null,
    ambient: AMBIENT[kind] || AMBIENT.clear[theme] || AMBIENT.clear.day,
    storm: !!(cfg && cfg.storm),
    tint: fog != null ? { fog, near: cfg.near, far: cfg.far, mix: cfg.mix != null ? cfg.mix : FOG_MIX, sky: cfg.sky || 0, haze: cfg.haze || 0, veil: cfg.veil || 0, sun: cfg.sun != null ? cfg.sun : 1, dof: cfg.dof || 1 } : null
  };
}

/** 雾从哪开始、到哪全进雾（场景每帧按它设 scene.fog；three.js 的线性雾按 smoothstep(near, far, 沿视线的深度) 混进雾色）：
 *  镜头到战场后沿的大致距离 back（默认镜头的距离 + 半个战场的进深 × cos 俯角；中景 / 近景推近了再挪 shift = hd2d-camera.js · pose 的 fogShift）起雾，
 *  再往后 depth（hd2d-scene.js 的 FOG.depth）全进雾；天气想要的雾（tint）把起雾的地方乘 near、全进雾的地方乘 far */
export function fogRange(layout, shift, tint, depth) {
  const b = layout && layout.bounds, fit = layout && layout.camera ? layout.camera.dist : 20;
  const back = Math.max(0, fit + (b ? (b.maxZ - b.minZ) / 2 * Math.cos(L.CONFIG.camera.elevation * Math.PI / 180) : 8) + (shift || 0));
  return { near: back * (tint ? tint.near : 1), far: (back + depth) * (tint ? tint.far : 1) };
}
/** 雾色：光影主题的雾（themeFog），往这个天气想要的雾色靠 tint.mix（场景的雾、雷鸣 / 沙暴时远景的天边都用它） */
export function fogColor(themeFog, tint) {
  const c = new THREE.Color(themeFog);
  if (tint && tint.fog != null) c.lerp(new THREE.Color(tint.fog), tint.mix != null ? tint.mix : FOG_MIX);
  return c;
}
/** 顺着风飞（配置里写了 wind 的粒子）：速度的 x 分量（顺风）转到风向 wind = { x, z } 上，z 分量（横着飘）跟着转；y 不动 */
export function windVel(vel, wind) {
  const w = wind || { x: 1, z: 0 };
  return [vel[0] * w.x - vel[2] * w.z, vel[1], vel[0] * w.z + vel[2] * w.x];
}
const windy = (cfg, wind) => (cfg && cfg.wind ? Object.assign({}, cfg, { vel: windVel(cfg.vel, wind) }) : cfg);

/** 软的圆点（所有点状粒子共用）：不再是方块 */
let dotTex = null;
function dotTexture() {
  if (dotTex) return dotTex;
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.35, "rgba(255,255,255,.75)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c); dotTex.colorSpace = THREE.SRGBColorSpace;
  return dotTex;
}
const mod = (a, m) => ((a % m) + m) % m;

/** 一组循环飘动的粒子：在盒子 box 里按速度走，出界从另一边绕回来（位置只看时间 t，停住 t 就停住） */
function particles(scene, cfg, box, height, opts) {
  const n = cfg.count, lines = cfg.kind === "lines", W = box.x1 - box.x0, D = box.z1 - box.z0;
  const pos = new Float32Array(n * (lines ? 6 : 3)), seed = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { seed[i * 3] = Math.random() * W; seed[i * 3 + 1] = Math.random() * height; seed[i * 3 + 2] = Math.random() * D; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const common = { color: cfg.color, transparent: true, opacity: cfg.opacity, depthWrite: false, blending: cfg.additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false };
  let obj, colors = null, base = null;
  if (lines) obj = new THREE.LineSegments(geo, new THREE.LineBasicMaterial(common));
  else {
    if (cfg.bright) {   // 光里的尘埃：一部分亮、慢慢闪
      colors = new Float32Array(n * 3); base = new Float32Array(n);
      for (let i = 0; i < n; i++) base[i] = Math.random() < cfg.bright ? 1.6 + Math.random() * 0.8 : 0.45 + Math.random() * 0.4;
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    }
    obj = new THREE.Points(geo, new THREE.PointsMaterial(Object.assign({ size: cfg.size, sizeAttenuation: true, map: dotTexture(), vertexColors: !!colors }, common)));
  }
  obj.frustumCulled = false;
  scene.add(obj);
  const y0 = (opts && opts.low) || 0;
  function fill(t) {
    const p = geo.attributes.position, v = cfg.vel;
    for (let i = 0; i < n; i++) {
      const sx = seed[i * 3], sy = seed[i * 3 + 1], sz = seed[i * 3 + 2];
      const wob = cfg.sway ? Math.sin(t * cfg.sway * 2 + i) * (cfg.jitter || 0.3) : 0;
      const x = box.x0 + mod(sx + v[0] * t, W) + wob;
      const y = y0 + mod(sy + v[1] * t, height);
      const z = box.z0 + mod(sz + v[2] * t, D) + (cfg.sway ? Math.cos(t * cfg.sway * 1.7 + i) * (cfg.jitter || 0.3) : 0);
      if (lines) {
        const k = cfg.len / Math.hypot(v[0], v[1], v[2]);
        p.setXYZ(i * 2, x, y, z); p.setXYZ(i * 2 + 1, x - v[0] * k, y - v[1] * k, z - v[2] * k);
      } else p.setXYZ(i, x, y + (cfg.jitter && !cfg.sway ? Math.sin(t * 3 + i) * 0.1 : 0), z);
      if (colors) { const b = base[i] * (0.8 + 0.2 * Math.sin(t * 1.3 + i * 2.1)); colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = b; }
    }
    p.needsUpdate = true;
    if (colors) geo.attributes.color.needsUpdate = true;
  }
  fill(0);
  return { obj, fill, dispose() { scene.remove(obj); geo.dispose(); obj.material.dispose(); } };
}

/* ---------- 闪电的形状 ---------- */
/** 主干：从 top 往下一节一节劈到 bottom，每节横着随机歪一点（[x, y] 点列） */
function boltPath(x, top, bottom, rand) {
  const H = top - bottom, J = STORM.bolt.jag, lean = (rand() - 0.5) * 0.25, pts = [[x, top]];
  let px = x, py = top;
  while (py > bottom) {
    py = Math.max(bottom, py - H * (0.04 + rand() * 0.07));
    px += (rand() - 0.5) * H * J + lean * H * 0.06;
    pts.push([px, py]);
  }
  return pts;
}
/** 分叉：从主干上的一点往斜下方劈出去一小段 */
function branchPath(from, bottom, rand) {
  const side = rand() < 0.5 ? -1 : 1, len = (from[1] - bottom) * (0.2 + rand() * 0.25), end = from[1] - len, pts = [from.slice()];
  let px = from[0], py = from[1];
  while (py > end) {
    py = Math.max(end, py - len * (0.15 + rand() * 0.2));
    px += side * len * (0.12 + rand() * 0.22) + (rand() - 0.5) * len * 0.15;
    pts.push([px, py]);
  }
  return pts;
}
/** 折线做成正对镜头的带子（在进深 z 的竖直面上）：芯宽 w、实心；外圈光宽 gw，从中间往两边淡到 0（顶点颜色 = 亮度，叠加混合） */
function ribbon(pos, col, pts, z, w, gw, level) {
  const n = pts.length, nx = [], ny = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    nx.push(-dy / l); ny.push(dx / l);
  }
  const v = (i, off, c) => { pos.push(pts[i][0] + nx[i] * off, pts[i][1] + ny[i] * off, z); col.push(c, c, c); };
  const g = level * STORM.bolt.glowLevel;
  for (let i = 0; i < n - 1; i++) {
    v(i, -w / 2, level); v(i + 1, -w / 2, level); v(i, w / 2, level);
    v(i, w / 2, level); v(i + 1, -w / 2, level); v(i + 1, w / 2, level);
    [-1, 1].forEach(s => {
      v(i, 0, g); v(i + 1, 0, g); v(i, s * gw / 2, 0);
      v(i, s * gw / 2, 0); v(i + 1, 0, g); v(i + 1, s * gw / 2, 0);
    });
  }
}

export function createWeather(scene, opt) {
  const api = { kind: "none", theme: "day", flash: 0, heat: 0, tint: null, storm: false, shake: { x: 0, y: 0 }, strike: null, wind: { x: 1, z: 0 }, set, update, setBounds, setWind, dispose };
  const rand = opt.random || Math.random;
  const between = (r) => r[0] + rand() * (r[1] - r[0]);
  let main = null, streak = null, amb = null, cfg = null, box = null, ambBox = null, bounds = null, view = {};
  let nextBolt = 0, strikes = 0, hit = null, bolt = null;   // hit：最近一道雷（就是 api.strike）；bolt：它的闪电
  setBounds(opt.bounds);

  function setBounds(b, v) {
    const pad = 9;
    bounds = b;
    if (v) view = v;
    box = { x0: b.minX - pad, x1: b.maxX + pad, z0: b.minZ - pad, z1: b.maxZ + pad };
    ambBox = { x0: b.minX - AMB.pad, x1: b.maxX + AMB.pad, z0: b.minZ - AMB.pad, z1: b.maxZ + AMB.pad };
    if (main || amb) set(api.kind, api.theme, true);
  }
  /** 沙暴的风（世界里的方向，长度不论）：变了而且这个天气的粒子要顺着风飞，就按新的风向重新铺一遍 */
  function setWind(w) {
    const x = Number(w && w.x) || 0, z = Number(w && w.z) || 0, l = Math.hypot(x, z);
    const next = l > 1e-9 ? { x: x / l, z: z / l } : { x: 1, z: 0 };
    if (Math.abs(next.x - api.wind.x) < 1e-9 && Math.abs(next.z - api.wind.z) < 1e-9) return;
    api.wind = next;
    if (cfg && cfg.wind) set(api.kind, api.theme, true);
  }

  function clearBolt() {
    if (!bolt) return;
    scene.remove(bolt);
    bolt.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    bolt = null;
  }
  function clear() {
    if (main) { main.dispose(); main = null; }
    if (streak) { streak.dispose(); streak = null; }
    if (amb) { amb.dispose(); amb = null; }
    clearBolt();
    cfg = null; hit = null;
    api.flash = 0; api.heat = 0; api.tint = null; api.storm = false; api.strike = null; api.shake.x = 0; api.shake.y = 0;
  }

  function set(kind, theme, force) {
    theme = theme || api.theme;
    if (!force && kind === api.kind && theme === api.theme && (main || amb)) return;
    clear();
    api.kind = kind; api.theme = theme;
    const plan = weatherPlan(kind, theme);
    cfg = WEATHER[kind] || null;
    if (plan.main) main = particles(scene, windy(plan.main, api.wind), box, HEIGHT);
    if (plan.streak) streak = particles(scene, windy(plan.streak, api.wind), box, HEIGHT);
    api.tint = plan.tint;
    api.storm = plan.storm;
    if (plan.storm) nextBolt = between(STORM.first);
    amb = particles(scene, windy(plan.ambient, api.wind), ambBox, AMB.top - AMB.low, { low: AMB.low });
  }

  /** opts.dt：真实经过的时间（雷击按它数，减少动态效果时也照走）；opts.reduced：减少动态效果。不给 opts 时 dt = 0 当作减少动态效果 */
  function update(dt, t, opts) {
    if (main) main.fill(t);
    if (streak) streak.fill(t);
    if (amb) amb.fill(t);
    if (!cfg) return;
    api.heat = cfg.heat ? 1 : 0;
    if (api.storm) thunder(opts && opts.dt != null ? opts.dt : dt, opts ? !!opts.reduced : dt === 0);
  }

  /** 雷鸣：数到下一道雷就劈；正在闪的那道算闪光、闪电亮度和镜头抖动 */
  function thunder(dt, reduced) {
    const S = STORM, R = S.reduced;
    nextBolt -= dt;
    if (nextBolt <= 0) { nextBolt += between(S.interval); strike(); }
    if (!hit) return;
    // 闪光：连闪几下，每一下很快退掉；减少动态效果时只闪第一下，亮度打折、退得慢一点
    let env = 0;
    (reduced ? S.flicker.slice(0, 1) : S.flicker).forEach(([at, amp]) => {
      if (hit.age >= at) env = Math.max(env, amp * Math.exp(-(reduced ? R.fade : S.fade) * (hit.age - at)));
    });
    api.flash = env * hit.power * (reduced ? R.flash : 1);
    if (bolt) {
      bolt.visible = hit.age < S.bolt.life;
      const op = Math.min(1, env * 1.6) * (reduced ? R.bolt : 1);
      bolt.children.forEach(m => { m.material.opacity = op; });
    }
    // 镜头抖动：一开始最大，按（剩下的比例）² 退掉；横竖两个方向频率不同，抖起来不像在画圈
    const left = S.shake.dur - hit.age;
    if (!reduced && left > 0) {
      const k = left / S.shake.dur, a = hit.amp * k * k, w = S.shake.freq * 2 * Math.PI, e = hit.age;
      let x = a * (0.75 * Math.cos(w * e) + 0.25 * Math.sin(w * 2.3 * e + 1.1));
      let y = a * (0.75 * Math.sin(w * 1.3 * e + 0.6) + 0.25 * Math.cos(w * 3.1 * e));
      const m = Math.hypot(x, y);
      if (m > a) { x *= a / m; y *= a / m; }
      api.shake.x = x; api.shake.y = y;
    } else { api.shake.x = 0; api.shake.y = 0; }
    hit.age += dt;
  }

  /** 劈一道雷：多半劈在远处的乌云下面（远景给位置，在低云前面、中景之间），偶尔劈在战场后沿外面 */
  function strike() {
    const S = STORM, edge = rand() < S.edge, b = bounds;
    let p;
    if (edge) p = { x: b.minX + 1 + rand() * Math.max(0, b.maxX - b.minX - 2), z: b.minZ - between(S.edgeDepth) };
    else if (view.farPoint) p = view.farPoint(rand() * 2 - 1);
    else p = { x: box.x0 + rand() * (box.x1 - box.x0), z: box.z0 - 2 };   // 没有远景时：天气粒子盒子后面
    hit = api.strike = { n: ++strikes, x: p.x, z: p.z, edge, age: 0, power: edge ? S.power.edge : S.power.far, amp: edge ? S.shake.edge : S.shake.far };
    makeBolt(p, edge);
  }

  /** 闪电：主干 + 几条分叉，做成正对镜头的发光带子（叠加混合、不吃雾，泛光会抓到）；劈在战场边缘时地上再亮一团 */
  function makeBolt(p, edge) {
    clearBolt();
    const B = STORM.bolt, cam = view.camera;
    const top = cam ? L.frameTop(cam, p.z) + 1.5 : 22, bottom = -0.3;   // 从画面上沿外面劈下来，劈到地面
    const px = cam ? 2 * Math.hypot(p.x - cam.pos.x, (top + bottom) / 2 - cam.pos.y, p.z - cam.pos.z) * Math.tan(cam.fov * Math.PI / 360) / (cam.height || 900) : 0.03;   // 1 像素在那里多宽
    const trunk = boltPath(p.x, top, bottom, rand), pos = [], col = [];
    ribbon(pos, col, trunk, p.z, B.core * px, B.glow * px, 1);
    const nb = B.branches[0] + Math.floor(rand() * (B.branches[1] - B.branches[0] + 1));
    for (let i = 0; i < nb; i++) {
      const from = trunk[1 + Math.floor(rand() * Math.max(1, trunk.length * 0.6 - 1))];   // 从主干上半截分出去
      ribbon(pos, col, branchPath(from, bottom, rand), p.z, B.core * px * 0.55, B.glow * px * 0.6, 0.6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const glow = (o) => new THREE.MeshBasicMaterial(Object.assign({ color: new THREE.Color(B.color).multiplyScalar(B.bright), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }, o));
    bolt = new THREE.Group();
    const m = new THREE.Mesh(geo, glow({ vertexColors: true, side: THREE.DoubleSide }));
    m.renderOrder = edge ? 3 : -0.4;   // 远处的雷在远景的低云前面，紧接着低云画；战场边缘的最后画
    m.frustumCulled = false;
    bolt.add(m);
    if (edge) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(B.impact, B.impact), glow({ map: dotTexture() }));
      g.rotation.x = -Math.PI / 2; g.position.set(p.x, bottom + 0.04, p.z); g.renderOrder = 3;
      bolt.add(g);
    }
    scene.add(bolt);
  }

  function dispose() { clear(); }
  return api;
}

export { WEATHER, AMBIENT, STORM, FOG_MIX };
