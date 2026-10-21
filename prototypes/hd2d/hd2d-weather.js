/* Antlerscale: Backfire · HD-2D 战场原型 · 天气粒子
 *
 * 跟着 state.weather 走：sand 沙暴 / snow 雪 / acid 酸雨 / thunder 雷鸣（雨 + 闪光）/ heat 酷暑（热浪）/ glow 微光 / phase 相位。
 * 其余（none 常态）什么都不放。
 *
 *   const fx = createWeather(scene, { bounds });
 *   fx.set("sand");  fx.update(dt, t);  fx.flash   // 雷鸣的闪光强度 0–1，由场景拿去推亮灯光
 *   fx.heat         // 酷暑的热浪强度 0–1，由场景拿去开扭曲后期
 *   fx.tint         // { fog: 0xRRGGBB|null, near, far }：这个天气想要的雾色 */
import * as THREE from "three";

/* 每种天气的参数（数量 / 速度 / 颜色都在这里） */
const WEATHER = {
  sand: { kind: "points", count: 1100, size: 0.1, color: 0xe0b878, opacity: 0.75, vel: [7.5, -0.35, 1.2], jitter: 1.5, fog: 0xc9a164, near: 0.55, far: 1.25 },
  snow: { kind: "points", count: 1300, size: 0.13, color: 0xffffff, opacity: 0.9, vel: [0.25, -1.3, 0.1], jitter: 0.45, sway: 0.5, fog: 0xc6d3de, near: 0.7, far: 1.6 },
  acid: { kind: "lines", count: 1000, len: 0.75, color: 0xa6e04a, opacity: 0.6, vel: [0.6, -15, 0.2], fog: 0x6a8a34, near: 0.65, far: 1.5, additive: true },
  thunder: { kind: "lines", count: 800, len: 0.7, color: 0x9ab4d8, opacity: 0.5, vel: [1.4, -17, 0.4], fog: 0x39465a, near: 0.6, far: 1.4, bolt: true },
  heat: { kind: "points", count: 90, size: 0.12, color: 0xffb060, opacity: 0.7, vel: [0.1, 0.55, 0], jitter: 0.2, sway: 0.4, fog: 0xe0b37a, near: 0.9, far: 2.0, additive: true, heat: 1 },
  glow: { kind: "points", count: 220, size: 0.11, color: 0x6affd8, opacity: 0.85, vel: [0.05, 0.16, 0.03], jitter: 0.25, sway: 0.7, fog: null, near: 1, far: 1, additive: true },
  phase: { kind: "points", count: 160, size: 0.12, color: 0xc07cf0, opacity: 0.8, vel: [0, 0.3, 0], jitter: 0.5, sway: 0.9, fog: null, near: 1, far: 1, additive: true }
};
const HEIGHT = 14;   // 粒子盒子的高度

export function createWeather(scene, opt) {
  const api = { kind: "none", flash: 0, heat: 0, tint: null, set, update, setBounds, dispose };
  let obj = null, cfg = null, box = null, data = null;
  let nextBolt = 3, boltLife = 0, bolt = null;
  setBounds(opt.bounds);

  function setBounds(b) {
    const pad = 9;
    box = { x0: b.minX - pad, x1: b.maxX + pad, z0: b.minZ - pad, z1: b.maxZ + pad };
    if (api.kind !== "none") set(api.kind, true);
  }

  function clear() {
    if (obj) { scene.remove(obj); obj.geometry.dispose(); obj.material.dispose(); obj = null; }
    if (bolt) { scene.remove(bolt); bolt.geometry.dispose(); bolt.material.dispose(); bolt = null; }
    data = null; cfg = null; api.flash = 0; api.heat = 0; api.tint = null;
  }

  function set(kind, force) {
    if (!force && kind === api.kind) return;
    clear();
    api.kind = kind;
    cfg = WEATHER[kind];
    if (!cfg) return;
    const n = cfg.count, W = box.x1 - box.x0, D = box.z1 - box.z0;
    const pos = new Float32Array(n * (cfg.kind === "lines" ? 6 : 3));
    data = { seed: new Float32Array(n * 3), n };
    for (let i = 0; i < n; i++) {
      data.seed[i * 3] = box.x0 + Math.random() * W;
      data.seed[i * 3 + 1] = Math.random() * HEIGHT;
      data.seed[i * 3 + 2] = box.z0 + Math.random() * D;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const common = { color: cfg.color, transparent: true, opacity: cfg.opacity, depthWrite: false, blending: cfg.additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false };
    if (cfg.kind === "lines") obj = new THREE.LineSegments(geo, new THREE.LineBasicMaterial(common));
    else obj = new THREE.Points(geo, new THREE.PointsMaterial(Object.assign({ size: cfg.size, sizeAttenuation: true }, common)));
    obj.frustumCulled = false;
    scene.add(obj);
    api.tint = cfg.fog != null ? { fog: cfg.fog, near: cfg.near, far: cfg.far } : null;
    if (cfg.bolt) nextBolt = 2 + Math.random() * 3;
    fill(0);
  }

  function fill(t) {
    const p = obj.geometry.attributes.position, s = data.seed;
    const W = box.x1 - box.x0, D = box.z1 - box.z0, v = cfg.vel;
    for (let i = 0; i < data.n; i++) {
      const sx = s[i * 3], sy = s[i * 3 + 1], sz = s[i * 3 + 2];
      const wob = cfg.sway ? Math.sin(t * cfg.sway * 2 + i) * (cfg.jitter || 0.3) : 0;
      const x = box.x0 + mod(sx - box.x0 + v[0] * t, W) + wob;
      const y = mod(sy + v[1] * t, HEIGHT);
      const z = box.z0 + mod(sz - box.z0 + v[2] * t, D) + (cfg.sway ? Math.cos(t * cfg.sway * 1.7 + i) * (cfg.jitter || 0.3) : 0);
      if (cfg.kind === "lines") {
        const k = cfg.len / Math.hypot(v[0], v[1], v[2]);
        p.setXYZ(i * 2, x, y, z); p.setXYZ(i * 2 + 1, x - v[0] * k, y - v[1] * k, z - v[2] * k);
      } else p.setXYZ(i, x, y + (cfg.jitter && !cfg.sway ? Math.sin(t * 3 + i) * 0.1 : 0), z);
    }
    p.needsUpdate = true;
  }

  const mod = (a, m) => ((a % m) + m) % m;

  function update(dt, t) {
    if (!cfg) return;
    fill(t);
    api.heat = cfg.heat ? 1 : 0;
    if (cfg.bolt) {
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
