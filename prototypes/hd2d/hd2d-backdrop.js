/* Antlerscale: Backfire · HD-2D 战场原型 · 远景
 *
 * 地台外面不是空色：一大片暗色废土，上面立着按场景变的剪影（几何体拼的），放在景深焦点以外，自然会糊。
 *   采矿场 mine：矿井架、烟囱、传送带、矿渣堆
 *   沙漠 desert：沙丘、远处的岩柱和桌山
 *   夜晚 night：城市楼群（亮着灯的窗）；星空画在天空贴图里（见 starSky）
 *   其余 wasteland：碎石岩丘
 *
 *   const bd = buildBackdrop("mine", bounds, "dusk");   // bounds = layout.bounds
 *   scene.add(bd.group); ... bd.dispose();
 * 剪影不吃雾（雾会把远处全抹成一个色），改成自己按主题染色，再靠景深糊开。 */
import * as THREE from "three";
import { rng } from "./hd2d-world.js";

/* ---------- 配置 ---------- */
const BACKDROP = {
  keepOut: 5,         // 离地台边缘多远以内不放东西
  reach: 52,          // 往外最远放到多远
  count: { mine: 34, desert: 30, night: 40, wasteland: 22 },
  frontShare: 0.12,   // 放在镜头这一侧（前面）的比例；前面只放矮东西，免得挡住战场
  // 剪影的颜色（按光影主题）：近处暗、远处靠雾色
  tint: {
    day: { body: 0x6b6558, far: 0x9fb1b2, sand: 0xb59a68, rock: 0x7d6a55 },
    dusk: { body: 0x2f2420, far: 0x6d4f45, sand: 0x7c5a3c, rock: 0x4a3226 },
    night: { body: 0x0c1018, far: 0x1a2438, sand: 0x232a36, rock: 0x161c26 }
  },
  groundRepeat: 26
};

/** 夜空：渐变 + 星星（画在屏幕背景贴图里，不进深度，会被景深一起糊开一点） */
export function skyTexture(top, bot, stars) {
  const W = stars ? 512 : 4, H = 512;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d"), grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, top); grd.addColorStop(1, bot);
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  if (stars) {
    const r = rng(77);
    for (let i = 0; i < 170; i++) {
      const y = Math.pow(r(), 1.6) * H * 0.8, a = 0.25 + r() * 0.75, s = r() < 0.12 ? 2.2 : 1.2;
      g.fillStyle = `rgba(${r() < 0.3 ? "255,230,190" : "205,225,255"},${a})`;
      g.beginPath(); g.arc(r() * W, y, s, 0, 7); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function groundTexture(base) {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"), r = rng(31);
  g.fillStyle = "#fff"; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    const v = r() < 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${0.04 + r() * 0.08})`;
    g.fillRect(r() * 128, r() * 128, 1 + r() * 3, 1 + r() * 2);
  }
  for (let i = 0; i < 6; i++) {   // 车辙 / 干裂的纹
    g.strokeStyle = "rgba(0,0,0,.10)"; g.lineWidth = 1; g.beginPath();
    let x = r() * 128, y = r() * 128; g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 30; y += (r() - 0.5) * 30; g.lineTo(x, y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(BACKDROP.groundRepeat, BACKDROP.groundRepeat); t.anisotropy = 4;
  return t;
}

/** 废土地面：地台下面一大片暗地，像把地台摆在场景里。返回 { mesh, texture } 给场景管理 */
export function buildGround() {
  const tex = groundTexture();
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(150, 56),
    new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 1, map: tex, flatShading: true })
  );
  m.rotation.x = -Math.PI / 2; m.position.y = -0.32; m.receiveShadow = true;
  return m;
}

/** 把物体放到 { position } 给的位置（three 的 position 是只读属性，不能直接 Object.assign） */
function put(m, o) { m.position.copy(o.position); return m; }

/** 一座矿井架：两条斜腿 + 顶上的天轮 + 横梁 */
function headframe(M, h) {
  const g = new THREE.Group();
  const leg = new THREE.BoxGeometry(0.5, h * 1.06, 0.5);
  [-1, 1].forEach(s => {
    const l = new THREE.Mesh(leg, M.body); l.position.set(s * h * 0.17, h / 2, 0); l.rotation.z = -s * 0.17; g.add(l);
  });
  for (let k = 1; k <= 3; k++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(h * 0.34 * (1 - k * 0.2), 0.22, 0.3), M.body); b.position.y = h * k * 0.22; g.add(b);
  }
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.1, h * 0.1, 0.4, 14), M.body);
  wheel.rotation.x = Math.PI / 2; wheel.position.y = h * 1.02; g.add(wheel);
  const hut = new THREE.Mesh(new THREE.BoxGeometry(h * 0.34, h * 0.14, 1.4), M.body); hut.position.set(h * 0.4, h * 0.07, 0); g.add(hut);
  return g;
}
function chimney(M, h, r) {
  const g = new THREE.Group();
  g.add(put(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r, h, 10), M.body), { position: new THREE.Vector3(0, h / 2, 0) }));
  g.add(put(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.78, r * 0.7, 0.5, 10), M.far), { position: new THREE.Vector3(0, h - 0.1, 0) }));
  if (M.lampTop) g.add(put(new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), M.lampTop), { position: new THREE.Vector3(0, h + 0.3, 0) }));
  return g;
}
function conveyor(M, len) {
  const g = new THREE.Group();
  const belt = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, 1.1), M.body);
  const slope = 0.28;
  belt.position.y = 5 + len * slope * 0.5; belt.rotation.z = slope;
  g.add(belt);
  for (let i = 0; i <= 4; i++) {
    const x = (i / 4 - 0.5) * len * 0.96, hh = 5 + (x + len / 2) * Math.tan(slope);
    g.add(put(new THREE.Mesh(new THREE.BoxGeometry(0.35, hh, 0.35), M.body), { position: new THREE.Vector3(x, hh / 2, 0) }));
  }
  return g;
}
function heap(M, s) { return put(new THREE.Mesh(new THREE.ConeGeometry(s, s * 0.75, 7), M.rock), { position: new THREE.Vector3(0, s * 0.37, 0) }); }
function dune(M, s) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(s, 14, 8), M.sand);
  m.scale.set(1.8, 0.32, 1); m.position.y = 0; return m;
}
function pillar(M, h, r) {
  const g = new THREE.Group();
  g.add(put(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 1.15, h, 7), M.rock), { position: new THREE.Vector3(0, h / 2, 0) }));
  g.add(put(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.3, r * 0.9, h * 0.16, 7), M.rock), { position: new THREE.Vector3(0, h * 0.95, 0) }));
  return g;
}
function mesa(M, w, h) {
  const g = new THREE.Group();
  g.add(put(new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.6), M.rock), { position: new THREE.Vector3(0, h / 2, 0) }));
  g.add(put(new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, h * 0.35, w * 0.45), M.rock), { position: new THREE.Vector3(w * 0.1, h * 1.17, 0) }));
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
  g.add(put(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), win), { position: new THREE.Vector3(0, h / 2, 0) }));
  g.add(put(new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 0.8, d * 0.5), M.body), { position: new THREE.Vector3(0, h + 0.4, 0) }));
  return g;
}

/**
 * 建一圈远景。bounds 是战场范围，放置时绕开地台，主要放在后面和两侧（前面只放矮的）。
 * 返回 { group, dispose }。
 */
export function buildBackdrop(kind, bounds, themeName) {
  const T = BACKDROP.tint[themeName] || BACKDROP.tint.day;
  const own = [];     // 自己建的材质 / 贴图 / 几何，dispose 时清
  const std = (color, opt) => { const m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 1, flatShading: true, fog: false }, opt || {})); own.push(m); return m; };
  const M = { body: std(T.body), far: std(T.far), sand: std(T.sand), rock: std(T.rock) };
  const night = themeName === "night";
  if (kind === "mine" || kind === "night") M.lampTop = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5a2a).multiplyScalar(2.2), toneMapped: false, fog: false });
  if (M.lampTop) own.push(M.lampTop);
  const windows = kind === "night" ? [1, 2, 3].map(s => { const t = windowTexture(s * 17); own.push(t); const m = new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.5, 1.5, 1.5), toneMapped: false, fog: false }); own.push(m); return m; }) : null;

  const group = new THREE.Group();
  const r = rng(kind.length * 31 + Math.round((bounds.maxX - bounds.minX) * 7) + Math.round((bounds.maxZ - bounds.minZ) * 3));
  const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
  const hx = (bounds.maxX - bounds.minX) / 2, hz = (bounds.maxZ - bounds.minZ) / 2;
  const K = BACKDROP.keepOut, R = BACKDROP.reach;
  const n = BACKDROP.count[kind] || BACKDROP.count.wasteland;

  for (let i = 0; i < n; i++) {
    // 采样位置：后面（-z）和两侧为主；在「地台外框 + keepOut」以外
    let x = 0, z = 0, ok = false, front = r() < BACKDROP.frontShare;
    for (let t = 0; t < 12 && !ok; t++) {
      x = cx + (r() * 2 - 1) * (hx + K + R);
      z = front ? cz + hz + K + r() * R * 0.6 : cz - hz - K - r() * R;
      if (!front && r() < 0.35) { z = cz + (r() * 2 - 1) * (hz + R * 0.4); x = cx + (r() < 0.5 ? -1 : 1) * (hx + K + r() * R); }   // 两侧
      ok = !(Math.abs(x - cx) < hx + K && Math.abs(z - cz) < hz + K);
    }
    if (!ok) continue;
    const far = Math.hypot(x - cx, z - cz) > R * 0.7;
    const k = 0.7 + r() * 0.8;
    let o;
    if (kind === "mine") {
      const pick = r();
      if (front) o = heap(M, 1.2 + r() * 1.6);
      else if (pick < 0.3) o = headframe(M, (9 + r() * 8) * k);
      else if (pick < 0.55) o = chimney(M, (10 + r() * 10) * k, 0.7 + r() * 0.5);
      else if (pick < 0.75) o = conveyor(M, 12 + r() * 10);
      else o = heap(M, (2.5 + r() * 3.5) * k);
    } else if (kind === "desert") {
      const pick = r();
      if (front || pick < 0.5) o = dune(M, (4 + r() * 6) * k);
      else if (pick < 0.85) o = pillar(M, (7 + r() * 9) * k, 1.2 + r() * 1.2);
      else o = mesa(M, 8 + r() * 7, (5 + r() * 5) * k);
    } else if (kind === "night") {
      if (front) o = heap(M, 1 + r() * 1.4);
      else if (r() < 0.2) o = chimney(M, (9 + r() * 8) * k, 0.7 + r() * 0.4);
      else o = tower(M, 3 + r() * 3, (7 + r() * 16) * k, 3 + r() * 2.5, windows[Math.floor(r() * windows.length)]);
    } else {
      o = r() < 0.5 ? heap(M, 2 + r() * 4) : pillar(M, (3 + r() * 4) * k, 1 + r());
    }
    o.position.set(x, -0.3, z);
    o.rotation.y = r() * Math.PI * 2;
    if (far && kind !== "night") o.traverse(m => { if (m.isMesh && m.material === M.body) m.material = M.far; });
    o.traverse(m => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
    group.add(o);
  }

  // 采矿场 / 夜晚：天边一圈远处的橙色炉火（泛光会抓到）
  if (kind === "mine" || night) {
    const glowM = new THREE.MeshBasicMaterial({ color: new THREE.Color(night ? 0xffb35a : 0xff7a2a).multiplyScalar(2.4), toneMapped: false, fog: false });
    own.push(glowM);
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 5), glowM);
      m.position.set(cx + (r() * 2 - 1) * (hx + R * 0.8), 0.6 + r() * 1.2, cz - hz - K - 10 - r() * (R - 10));
      group.add(m);
    }
  }

  return {
    group,
    dispose() {
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      own.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
    }
  };
}

export { BACKDROP };
