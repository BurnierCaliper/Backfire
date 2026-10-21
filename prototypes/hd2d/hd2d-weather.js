/* Antlerscale: Backfire · HD-2D 战场原型 · 天气粒子和飘浮物
 *
 * 跟着 state.weather 走：sand 沙暴 / snow 雪 / acid 酸雨 / thunder 雷鸣（雨 + 闪光）/ heat 酷暑（热浪）/ glow 微光 / phase 相位。
 * 另外一直有一层慢慢飘的「飘浮物」（AMBIENT）：晴天是光里看得见的尘埃（按光影主题换颜色），各种天气各有各的
 * （沙暴里的大团沙尘、雪天的冰晶、酸雨往上冒的孢子、雷雨里的水雾、酷暑的热尘……）。
 *
 *   const fx = createWeather(scene, { bounds });
 *   fx.set("sand", "day");  fx.update(dt, t);  fx.flash   // 雷鸣的闪光强度 0–1，由场景拿去推亮灯光
 *   fx.heat         // 酷暑的热浪强度 0–1，由场景拿去开扭曲后期
 *   fx.tint         // { fog: 0xRRGGBB|null, near, far }：这个天气想要的雾色（near / far 乘在场景算好的雾距上）
 * 减少动态效果时场景传 dt = 0、t 停住：粒子停在原地，不打闪电。 */
import * as THREE from "three";

/* 每种天气的参数（数量 / 速度 / 颜色都在这里） */
const WEATHER = {
  sand: { kind: "points", count: 1100, size: 0.14, color: 0xe0b878, opacity: 0.75, vel: [7.5, -0.35, 1.2], jitter: 1.5, fog: 0xc9a164, near: 0.55, far: 2.3 },
  snow: { kind: "points", count: 1300, size: 0.18, color: 0xffffff, opacity: 0.9, vel: [0.25, -1.3, 0.1], jitter: 0.45, sway: 0.5, fog: 0xc6d3de, near: 0.7, far: 3.0 },
  acid: { kind: "lines", count: 1000, len: 0.75, color: 0xa6e04a, opacity: 0.6, vel: [0.6, -15, 0.2], fog: 0x6a8a34, near: 0.65, far: 2.8, additive: true },
  thunder: { kind: "lines", count: 800, len: 0.7, color: 0x9ab4d8, opacity: 0.5, vel: [1.4, -17, 0.4], fog: 0x39465a, near: 0.6, far: 2.6, bolt: true },
  heat: { kind: "points", count: 90, size: 0.17, color: 0xffb060, opacity: 0.7, vel: [0.1, 0.55, 0], jitter: 0.2, sway: 0.4, fog: 0xe0b37a, near: 0.9, far: 3.7, additive: true, heat: 1 },
  glow: { kind: "points", count: 220, size: 0.15, color: 0x6affd8, opacity: 0.85, vel: [0.05, 0.16, 0.03], jitter: 0.25, sway: 0.7, fog: null, near: 1, far: 1, additive: true },
  phase: { kind: "points", count: 160, size: 0.16, color: 0xc07cf0, opacity: 0.8, vel: [0, 0.3, 0], jitter: 0.5, sway: 0.9, fog: null, near: 1, far: 1, additive: true }
};
/* 飘浮物：一直在，慢；只飘在战场上方一层（top 以下），光里亮的那几颗更亮（bright = 亮的比例）。
 * 晴天按光影主题，其余按天气 */
const AMBIENT = {
  clear: {
    day: { count: 150, size: 0.1, color: 0xfff1cf, opacity: 0.55, vel: [0.12, 0.05, 0.04], sway: 0.35, jitter: 0.5, bright: 0.25, additive: true },
    dusk: { count: 180, size: 0.11, color: 0xffc896, opacity: 0.6, vel: [0.1, 0.06, 0.03], sway: 0.35, jitter: 0.5, bright: 0.3, additive: true },
    night: { count: 110, size: 0.09, color: 0xb0ccff, opacity: 0.45, vel: [0.06, 0.04, 0.02], sway: 0.3, jitter: 0.4, bright: 0.2, additive: true }
  },
  sand: { count: 120, size: 0.26, color: 0xe8c48a, opacity: 0.32, vel: [1.6, 0.05, 0.3], sway: 0.6, jitter: 0.8, bright: 0.1 },
  snow: { count: 90, size: 0.12, color: 0xeaf6ff, opacity: 0.8, vel: [0.05, 0.08, 0.02], sway: 0.5, jitter: 0.5, bright: 0.4, additive: true },
  acid: { count: 90, size: 0.12, color: 0xb8ff6a, opacity: 0.65, vel: [0.04, 0.18, 0.02], sway: 0.6, jitter: 0.4, bright: 0.3, additive: true },
  thunder: { count: 110, size: 0.32, color: 0x9ab0cc, opacity: 0.2, vel: [0.25, -0.05, 0.05], sway: 0.4, jitter: 0.8, bright: 0.1 },
  heat: { count: 120, size: 0.1, color: 0xffd090, opacity: 0.5, vel: [0.05, 0.12, 0.02], sway: 0.5, jitter: 0.5, bright: 0.25, additive: true },
  glow: { count: 60, size: 0.1, color: 0xd8fff4, opacity: 0.5, vel: [0.04, 0.05, 0.02], sway: 0.6, jitter: 0.4, bright: 0.3, additive: true },
  phase: { count: 60, size: 0.1, color: 0xe8d0ff, opacity: 0.5, vel: [0.03, 0.06, 0.02], sway: 0.7, jitter: 0.5, bright: 0.3, additive: true }
};
const HEIGHT = 14;            // 天气粒子盒子的高度
const AMB = { low: 0.4, top: 6, pad: 2 };   // 飘浮物：离地 low–top 之间，比战场每边多 pad

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

export function createWeather(scene, opt) {
  const api = { kind: "none", theme: "day", flash: 0, heat: 0, tint: null, set, update, setBounds, dispose };
  let main = null, amb = null, cfg = null, box = null, ambBox = null;
  let nextBolt = 3, boltLife = 0, bolt = null;
  setBounds(opt.bounds);

  function setBounds(b) {
    const pad = 9;
    box = { x0: b.minX - pad, x1: b.maxX + pad, z0: b.minZ - pad, z1: b.maxZ + pad };
    ambBox = { x0: b.minX - AMB.pad, x1: b.maxX + AMB.pad, z0: b.minZ - AMB.pad, z1: b.maxZ + AMB.pad };
    if (main || amb) set(api.kind, api.theme, true);
  }

  function clear() {
    if (main) { main.dispose(); main = null; }
    if (amb) { amb.dispose(); amb = null; }
    if (bolt) { scene.remove(bolt); bolt.geometry.dispose(); bolt.material.dispose(); bolt = null; }
    cfg = null; api.flash = 0; api.heat = 0; api.tint = null;
  }

  function set(kind, theme, force) {
    theme = theme || api.theme;
    if (!force && kind === api.kind && theme === api.theme && (main || amb)) return;
    clear();
    api.kind = kind; api.theme = theme;
    cfg = WEATHER[kind] || null;
    if (cfg) {
      main = particles(scene, cfg, box, HEIGHT);
      api.tint = cfg.fog != null ? { fog: cfg.fog, near: cfg.near, far: cfg.far } : null;
      if (cfg.bolt) nextBolt = 2 + Math.random() * 3;
    }
    const a = AMBIENT[kind] || AMBIENT.clear[theme] || AMBIENT.clear.day;
    amb = particles(scene, a, ambBox, AMB.top - AMB.low, { low: AMB.low });
  }

  function update(dt, t) {
    if (main) main.fill(t);
    if (amb) amb.fill(t);
    if (!cfg) return;
    api.heat = cfg.heat ? 1 : 0;
    if (cfg.bolt) {
      if (dt === 0) { if (bolt) bolt.visible = false; return; }   // 减少动态效果：不打闪电
      // 雷鸣：隔几秒一道闪电，闪光会被场景拿去推亮灯光，余光慢慢退
      nextBolt -= dt;
      if (nextBolt <= 0) {
        nextBolt = 2.5 + Math.random() * 5;
        boltLife = 0.16;
        api.flash = 1;
        makeBolt();
      }
      api.flash = Math.max(0, api.flash - dt * 3.2);
      if (boltLife > 0) { boltLife -= dt; if (boltLife <= 0 && bolt) bolt.visible = false; }
    }
  }

  function makeBolt() {
    if (bolt) { scene.remove(bolt); bolt.geometry.dispose(); bolt.material.dispose(); }
    const pts = [];
    let x = box.x0 + Math.random() * (box.x1 - box.x0), z = box.z0 - 4 + Math.random() * 3, y = 22;
    while (y > 0) { pts.push(new THREE.Vector3(x, y, z)); y -= 1.4 + Math.random() * 1.6; x += (Math.random() - 0.5) * 3; }
    bolt = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: new THREE.Color(0xe8f0ff).multiplyScalar(3), toneMapped: false, fog: false }));
    scene.add(bolt);
  }

  function dispose() { clear(); }
  return api;
}

export { WEATHER, AMBIENT };
