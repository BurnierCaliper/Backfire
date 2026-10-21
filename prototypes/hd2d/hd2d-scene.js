/* Antlerscale: Backfire · HD-2D 战场原型 · three.js 场景
 *
 * 把 hd2d-layout.js 排好的战场画出来：地台 / 间隔 / 装饰（hd2d-world.js）、铭牌、天气（hd2d-weather.js），
 * 加上镜头、灯光、雾和后期（景深 + 泛光 + 热浪）。
 *
 *   const sc = createHd2dScene(container, { onPortraitChange(p) {...} });
 *   sc.setBattle(layout, { weather: "sand", theme: "dusk", actorId });   // layout = HD2DLayout.build(state, { portrait: sc.portrait })
 *   sc.setInsets({ top, bottom });   // 上下被界面盖住的像素，取景时让开
 *   sc.dispose();
 * 页面只在 index.html 里被 import；不改正式游戏的任何文件。 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { buildZone, buildGap, disposeTree } from "./hd2d-world.js";
import { createWeather } from "./hd2d-weather.js";

/* ---------- 配置 ---------- */
const CAM = {
  fov: 22,                // 视角窄一点，像看沙盘模型
  elevation: 36,          // 默认俯角（度）；斜 30–40°
  minElev: 24, maxElev: 48,   // 鼠标拖动能转到的俯角范围
  maxAzimuth: 0.5,        // 左右最多转多少弧度
  near: 1, far: 220,
  zoomIn: 0.5, zoomOut: 1.12,   // 相对「刚好装下整个战场」的距离
  margin: 0.93,           // 取景时留的边（NDC 的比例）
  panPad: 3               // 平移时目标点最多离战场边缘多远
};
const DOF = { aperture: 0.00075, maxblur: 0.009 };   // 景深：焦点在战场中间，远近两头微微糊
const PLATE = { canvasW: 360, canvasH: 264, sideColor: { player: "#39e6b4", foe: "#d8322a" } };
const LAYER_COLOR = { flesh: "#d8574a", armor: "#9aa7b3", shield: "#4fb8ff", sand: "#d1a85a", spirit: "#c07cf0" };
const STATUS_COLOR = { burn: "#ff5b2e", shock: "#ffd32e", corr: "#9be03a", frostbite: "#7ccfe8", shockwave: "#ff9a3c", high: "#ff4fa3", reso: "#c07cf0", unstable: "#c07cf0", weak: "#a8977b", inspire: "#39e6b4", sturdy: "#ffc93c", hide: "#6b7a8a", advantage: "#f2c230", chase: "#ff7a2e" };
const FONT = "'Microsoft YaHei','PingFang SC','Noto Sans CJK SC','Heiti SC','WenQuanYi Micro Hei',sans-serif";

/* 光影主题：白天 / 傍晚的暖光 / 夜晚的冷光 */
const THEMES = {
  day: {
    skyTop: "#7fb2d6", skyBot: "#dfe9d8", fog: 0xb8cfd6, ground: 0x5d5a50,
    hemiSky: 0xdceeff, hemiGround: 0x6d5f4a, hemi: 0.95, sun: 0xfff0d2, sunI: 2.6, sunPos: [-9, 20, 12],
    exposure: 1.0, bloom: [0.32, 0.5, 0.9], lamp: 0.25
  },
  dusk: {
    skyTop: "#4a3a63", skyBot: "#f0a35e", fog: 0xb98a68, ground: 0x4a3a30,
    hemiSky: 0xffc89a, hemiGround: 0x4a3030, hemi: 0.75, sun: 0xff9a52, sunI: 2.9, sunPos: [-14, 9, 10],
    exposure: 1.05, bloom: [0.5, 0.65, 0.8], lamp: 0.8
  },
  night: {
    skyTop: "#05080f", skyBot: "#1c2b44", fog: 0x1a2438, ground: 0x1c2026,
    hemiSky: 0x5f7fb8, hemiGround: 0x141a24, hemi: 0.55, sun: 0x8fb4ff, sunI: 1.15, sunPos: [8, 22, 6],
    exposure: 1.0, bloom: [0.85, 0.75, 0.62], lamp: 1.5
  }
};

/* 热浪：画面按时间轻轻扭曲（越靠上越厉害），只在酷暑时打开 */
const HeatShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, amount: { value: 1 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform float amount; varying vec2 vUv;
    void main(){
      float w = sin(vUv.y * 70.0 + time * 2.6) * 0.0016 + sin(vUv.y * 31.0 - time * 1.7 + vUv.x * 6.0) * 0.0012;
      vec2 uv = vUv + vec2(w * amount, 0.0);
      gl_FragColor = texture2D(tDiffuse, uv);
    }`
};

export function createHd2dScene(container, options) {
  options = options || {};
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.localClippingEnabled = true;     // 下潜单位的铭牌只露半截，靠裁剪面
  renderer.domElement.className = "hd2d-canvas";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAM.fov, 1, CAM.near, CAM.far);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(hemi, sun, sun.target);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 48), new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.32; ground.receiveShadow = true;
  scene.add(ground);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.09;
  controls.rotateSpeed = 0.45; controls.zoomSpeed = 0.8; controls.panSpeed = 0.8;
  controls.screenSpacePanning = false;       // 平移沿着地面走
  controls.minPolarAngle = THREE.MathUtils.degToRad(90 - CAM.maxElev);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(90 - CAM.minElev);
  controls.minAzimuthAngle = -CAM.maxAzimuth; controls.maxAzimuthAngle = CAM.maxAzimuth;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };   // 手机：单指转、双指缩放 / 平移

  // 后期：渲染 → 景深 → 泛光 → 热浪 → 输出
  const composer = new EffectComposer(renderer);
  const bokeh = new BokehPass(scene, camera, { focus: 40, aperture: DOF.aperture, maxblur: DOF.maxblur });
  // BokehPass 用深度材质把整个场景重画一遍量距离；天空背景是张贴图，不该进深度图，这一遍先摘掉
  const bokehRender = bokeh.render.bind(bokeh);
  bokeh.render = function (...args) {
    const bg = scene.background, fog = scene.fog;
    scene.background = null; scene.fog = null;
    try { bokehRender(...args); } finally { scene.background = bg; scene.fog = fog; }
  };
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.6, 0.85);
  const heatPass = new ShaderPass(HeatShader);
  heatPass.enabled = false;
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bokeh); composer.addPass(bloom); composer.addPass(heatPass);
  composer.addPass(new OutputPass());

  const state = {
    portrait: false, layout: null, meta: { weather: "none", theme: "day" }, insets: { top: 0, bottom: 0 },
    world: null, plates: new Map(), ctx: null, fit: 20, bounds: null, themeName: "day", actorId: null, wantFit: true
  };
  const weather = createWeather(scene, { bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 } });
  const clock = new THREE.Clock();
  let time = 0, raf = 0, disposed = false;

  /* ---------- 主题 / 天气 ---------- */
  function skyTexture(top, bot) {
    const c = document.createElement("canvas"); c.width = 4; c.height = 256;
    const g = c.getContext("2d"), grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, top); grd.addColorStop(1, bot);
    g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function applyTheme() {
    const T = THEMES[state.meta.theme] || THEMES.day;
    state.themeName = state.meta.theme;
    if (scene.background && scene.background.dispose) scene.background.dispose();
    scene.background = skyTexture(T.skyTop, T.skyBot);
    hemi.color.set(T.hemiSky); hemi.groundColor.set(T.hemiGround);
    sun.color.set(T.sun); sun.position.set(...T.sunPos).add(sun.target.position);
    ground.material.color.set(T.ground);
    renderer.toneMappingExposure = T.exposure;
    bloom.strength = T.bloom[0]; bloom.radius = T.bloom[1]; bloom.threshold = T.bloom[2];
    applyFog();
    if (state.ctx) state.ctx.lamps.forEach(l => { if (l.light) l.light.intensity = l.base * T.lamp; });
  }
  function applyFog() {
    const T = THEMES[state.themeName] || THEMES.day;
    const tint = weather.tint;
    const color = new THREE.Color(T.fog);
    if (tint && tint.fog != null) color.lerp(new THREE.Color(tint.fog), 0.6);
    const near = state.fit * (tint ? tint.near : 1) * 0.95, far = state.fit * (tint ? tint.far : 1) * 2.3;
    scene.fog = new THREE.Fog(color, near, far);
    ground.material.color.set(T.ground).lerp(color, 0.15);
  }

  /* ---------- 铭牌 ---------- */
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  /** 画一块铭牌：名字 / 等级 / 分层血条 / 架势菱形 / 状态 / ATK。只读 plate（layout 给的白名单数据），没有坚毅生命 */
  function drawPlate(canvas, p) {
    const W = canvas.width, H = canvas.height, g = canvas.getContext("2d");
    g.clearRect(0, 0, W, H);
    const side = PLATE.sideColor[p.side];
    g.fillStyle = "#17120e"; roundRect(g, 4, 4, W - 8, H - 8, 18); g.fill();
    g.strokeStyle = side; g.lineWidth = 8; roundRect(g, 4, 4, W - 8, H - 8, 18); g.stroke();
    g.fillStyle = "rgba(255,255,255,.05)"; roundRect(g, 12, 12, W - 24, 52, 10); g.fill();
    // 名字（黑体加粗，太长就缩小）+ 等级
    g.textBaseline = "middle"; g.fillStyle = "#ece0c6";
    let fs = 32; g.font = `900 ${fs}px ${FONT}`;
    while (g.measureText(p.name).width > W - 130 && fs > 18) { fs -= 2; g.font = `900 ${fs}px ${FONT}`; }
    g.fillText(p.name, 24, 38);
    g.font = `900 22px ${FONT}`; const lv = "Lv" + p.level, lw = g.measureText(lv).width;
    g.fillStyle = "#c99a46"; g.fillText(lv, W - 24 - lw, 38);
    // 分层血条
    const bx = 22, by = 76, bw = W - 44, bh = 28;
    g.fillStyle = "#050403"; roundRect(g, bx - 3, by - 3, bw + 6, bh + 6, 6); g.fill();
    const total = Math.max(1, p.hp.max);
    let x = bx;
    for (let i = p.layers.length - 1; i >= 0; i--) {       // 数组 0 是最外层，画在最右
      const l = p.layers[i], w = bw * l.max / total;
      g.fillStyle = "#2a2520"; g.fillRect(x, by, w - 2, bh);
      g.fillStyle = LAYER_COLOR[l.type] || "#d8574a"; g.fillRect(x, by, Math.max(0, (w - 2) * (l.max ? l.cur / l.max : 0)), bh);
      x += w;
    }
    g.fillStyle = "rgba(255,255,255,.18)"; g.fillRect(bx, by, bw, 5);
    g.font = `900 22px ${FONT}`; g.fillStyle = "#ece0c6"; g.textAlign = "left";
    g.fillText(`${p.hp.cur}/${p.hp.max}`, 24, 126);
    g.textAlign = "right"; g.fillStyle = "#ffc93c"; g.fillText("ATK " + p.atk, W - 24, 126); g.textAlign = "left";
    // 架势菱形
    if (p.def.big) { g.fillStyle = "#f2c230"; g.font = `900 22px ${FONT}`; g.fillText(`架势 ${p.def.cur}+`, 24, 160); }
    else for (let i = 0; i < p.def.max; i++) {
      const cx = 30 + i * 26, cy = 160;
      g.beginPath(); g.moveTo(cx, cy - 11); g.lineTo(cx + 10, cy); g.lineTo(cx, cy + 11); g.lineTo(cx - 10, cy); g.closePath();
      if (i < p.def.cur) { g.fillStyle = "#f2c230"; g.fill(); } else { g.strokeStyle = "#6a5a3a"; g.lineWidth = 3; g.stroke(); }
    }
    // 状态徽章（最多一行半，多的写 +n）
    let sx = 22, sy = 200;
    const chips = p.statuses.concat(p.flags.map(f => ({ key: f.key, label: f.label })));
    g.font = `900 20px ${FONT}`;
    chips.forEach((s, i) => {
      const w = g.measureText(s.label).width + 18;
      if (sx + w > W - 22) { if (sy > 200) { return; } sx = 22; sy = 236; }
      if (sy > 236) return;
      g.fillStyle = s.key === "dying" ? "#d8322a" : s.key === "stunned" ? "#ff9a3c" : (STATUS_COLOR[s.key] || "#a8977b");
      roundRect(g, sx, sy - 14, w, 28, 6); g.fill();
      g.fillStyle = "#0b0806"; g.fillText(s.label, sx + 9, sy + 1);
      sx += w + 8;
    });
  }

  function makePlate(u) {
    const canvas = document.createElement("canvas");
    canvas.width = PLATE.canvasW; canvas.height = PLATE.canvasH;
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
    const material = new THREE.MeshBasicMaterial({ map, transparent: true, side: THREE.DoubleSide, depthWrite: true, alphaTest: 0.02 });
    const geo = new THREE.PlaneGeometry(u.plateW, u.plateH); geo.translate(0, u.plateH / 2, 0);
    const card = new THREE.Mesh(geo, material);
    // 地面影子：一个压扁的圆
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.62, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    shadow.rotation.x = -Math.PI / 2; shadow.scale.set(1.15, 0.62, 1);
    // 下潜时脚边的沙纹
    const ripple = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.52, 28), new THREE.MeshBasicMaterial({ color: 0xe8d29a, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    ripple.rotation.x = -Math.PI / 2; ripple.scale.set(1.4, 0.8, 1);
    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.3, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf2c230).multiplyScalar(1.6), toneMapped: false }));
    marker.rotation.x = Math.PI; marker.visible = false;
    const group = new THREE.Group();
    group.add(card, marker);
    scene.add(group, shadow, ripple);
    return { id: u.id, canvas, map, material, card, shadow, ripple, marker, group, geo, key: "", clip: null };
  }
  function disposePlate(p) {
    scene.remove(p.group, p.shadow, p.ripple);
    p.map.dispose(); p.material.dispose(); p.geo.dispose();
    p.shadow.geometry.dispose(); p.shadow.material.dispose(); p.ripple.geometry.dispose(); p.ripple.material.dispose();
    p.marker.geometry.dispose(); p.marker.material.dispose();
  }
  function syncPlates() {
    const live = new Set();
    state.layout.units.forEach(u => {
      live.add(u.id);
      let p = state.plates.get(u.id);
      if (!p) { p = makePlate(u); state.plates.set(u.id, p); }
      const key = JSON.stringify(u.plate);
      if (key !== p.key) { p.key = key; drawPlate(p.canvas, u.plate); p.map.needsUpdate = true; }
      p.u = u;
      p.group.position.set(u.x, u.y, u.z);
      p.shadow.position.set(u.x, u.groundY + 0.025, u.z);
      p.ripple.position.set(u.x, u.groundY + 0.03, u.z);
      p.ripple.visible = u.submerged;
      p.shadow.material.opacity = u.flying ? 0.28 : u.submerged ? 0.15 : 0.42;
      p.shadow.scale.set(u.flying ? 0.9 : 1.15, u.flying ? 0.5 : 0.62, 1);
      p.material.opacity = u.submerged ? 0.6 : u.plate.flags.some(f => f.key === "dying") ? 0.8 : 1;
      p.material.clippingPlanes = u.submerged ? [new THREE.Plane(new THREE.Vector3(0, 1, 0), -u.groundY)] : null;
      p.material.needsUpdate = true;
      p.marker.position.set(0, u.plateH + 0.4, 0);
    });
    state.plates.forEach((p, id) => { if (!live.has(id)) { disposePlate(p); state.plates.delete(id); } });
    markActor();
  }
  function markActor() { state.plates.forEach(p => { p.marker.visible = p.id === state.actorId; }); }

  /* ---------- 战场 ---------- */
  function clearWorld() {
    if (state.world) { scene.remove(state.world); disposeTree(state.world); }
    state.world = null;
  }
  function setBattle(layout, meta) {
    state.layout = layout; state.meta = Object.assign({ weather: "none", theme: "day" }, meta || {});
    state.actorId = state.meta.actorId != null ? state.meta.actorId : state.actorId;
    const newBoard = !state.bounds || JSON.stringify(layout.bounds) !== JSON.stringify(state.bounds) || state.boardSig !== boardSig(layout);
    if (newBoard || state.worldSig !== worldSig(layout)) {
      clearWorld();
      state.ctx = { anim: [], lamps: [], fxLights: 0 };
      const root = new THREE.Group();
      layout.zones.forEach(z => root.add(buildZone(z, state.ctx)));
      layout.gaps.forEach(g => root.add(buildGap(g, state.ctx)));
      scene.add(root); state.world = root;
      state.worldSig = worldSig(layout);
    }
    state.boardSig = boardSig(layout);
    state.bounds = layout.bounds;
    weather.setBounds(layout.bounds);
    weather.set(state.meta.weather || "none");
    syncPlates();
    applyTheme();
    fitShadow();
    fitCamera(newBoard || state.wantFit);
  }
  const boardSig = (l) => l.zones.map(z => [z.id, Math.round(z.cx * 10), Math.round(z.cz * 10)].join(",")).join(";");
  const worldSig = (l) => boardSig(l) + "|" + l.zones.map(z => z.kind + z.effects.join("+") + z.h).join(";") + "|" + l.gaps.map(g => [g.key, g.type, g.open, g.maxHp ? Math.ceil((g.hp / g.maxHp) * 4) : 4].join(",")).join(";");

  /* ---------- 镜头 ---------- */
  function boundsCorners() {
    const b = state.bounds, h = b.maxY + 0.5, pts = [];
    [b.minX, b.maxX].forEach(x => [0, h].forEach(y => [b.minZ, b.maxZ].forEach(z => pts.push(new THREE.Vector3(x, y, z)))));
    return pts;
  }
  function placeCamera(target, dist) {
    const e = THREE.MathUtils.degToRad(CAM.elevation);
    camera.position.set(target.x, target.y + Math.sin(e) * dist, target.z + Math.cos(e) * dist);
    camera.lookAt(target);
    camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  }
  /** 取景：让整个战场刚好装进「上下被界面盖住之后剩下的那一块」 */
  function fitCamera(reset) {
    if (!state.bounds) return;
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    const b = state.bounds;
    const target = new THREE.Vector3((b.minX + b.maxX) / 2, 0.6, (b.minZ + b.maxZ) / 2);
    const lo = -1 + 2 * state.insets.bottom / h, hi = 1 - 2 * state.insets.top / h;
    const corners = boundsCorners();
    const keepPos = camera.position.clone(), keepQuat = camera.quaternion.clone();   // 不重置时，算完要把玩家转好的视角还回去
    let dist = 40;
    const v = new THREE.Vector3();
    for (let it = 0; it < 14; it++) {
      placeCamera(target, dist);
      let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      corners.forEach(c => { v.copy(c).project(camera); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); });
      // 把战场放到可用区域正中
      const dy = ((lo + hi) / 2) - (y0 + y1) / 2, dx = -(x0 + x1) / 2;
      const half = Math.tan(THREE.MathUtils.degToRad(CAM.fov / 2)) * dist;
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1), right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      target.addScaledVector(up, -dy * half).addScaledVector(right, -dx * half * camera.aspect);
      const k = Math.max((x1 - x0) / (2 * CAM.margin), (y1 - y0) / ((hi - lo) * CAM.margin));
      dist *= Math.min(1.6, Math.max(0.6, k));
    }
    state.fit = dist;
    state.fitTarget = target.clone();
    controls.minDistance = dist * CAM.zoomIn; controls.maxDistance = dist * CAM.zoomOut;
    if (reset) { placeCamera(target, dist); controls.target.copy(target); controls.update(); }
    else { camera.position.copy(keepPos); camera.quaternion.copy(keepQuat); camera.updateMatrixWorld(); }
    state.wantFit = false;
    camera.far = Math.max(CAM.far, dist * 4); camera.updateProjectionMatrix();
    bokeh.uniforms.farClip.value = camera.far;
    applyFog();
  }
  function fitShadow() {
    const b = state.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const r = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 3;
    sun.target.position.set(cx, 0, cz);
    const T = THEMES[state.meta.theme] || THEMES.day;
    sun.position.set(cx + T.sunPos[0], T.sunPos[1] + r * 0.4, cz + T.sunPos[2]);
    const c = sun.shadow.camera; c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 1; c.far = 80; c.updateProjectionMatrix();
    ground.position.x = cx; ground.position.z = cz;
  }
  function clampPan() {
    if (!state.bounds) return;
    const b = state.bounds, t = controls.target, P = CAM.panPad;
    const nx = THREE.MathUtils.clamp(t.x, b.minX - P, b.maxX + P), nz = THREE.MathUtils.clamp(t.z, b.minZ - P, b.maxZ + P), ny = THREE.MathUtils.clamp(t.y, 0, 2);
    const d = new THREE.Vector3(nx - t.x, ny - t.y, nz - t.z);
    if (d.lengthSq() > 0) { t.add(d); camera.position.add(d); }
  }

  /* ---------- 尺寸 / 循环 ---------- */
  function resize() {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    bokeh.uniforms.aspect.value = camera.aspect;
    const portrait = w / h < 0.85;
    if (portrait !== state.portrait) {
      state.portrait = portrait;
      state.wantFit = true;
      if (options.onPortraitChange) options.onPortraitChange(portrait);   // 外面会重排战场再 setBattle
    } else if (state.bounds) fitCamera(true);
  }

  function frame() {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden) { clock.getDelta(); return; }
    const dt = Math.min(0.1, clock.getDelta());
    time += dt;
    if (state.ctx) state.ctx.anim.forEach(fn => fn(time, dt));
    weather.update(dt, time);
    // 雷闪：把灯光瞬间推亮
    const T = THEMES[state.themeName] || THEMES.day;
    const fl = weather.flash;
    hemi.intensity = T.hemi + fl * 3.2; sun.intensity = T.sunI + fl * 2.5;
    renderer.toneMappingExposure = T.exposure * (1 + fl * 0.35);
    bloom.strength = T.bloom[0] + fl * 0.5;
    heatPass.enabled = weather.heat > 0;
    heatPass.uniforms.time.value = time;
    if (state.ctx) state.ctx.lamps.forEach((l, i) => { if (l.light) l.light.intensity = l.base * T.lamp * (1 + Math.sin(time * 7 + i * 3) * 0.04); });
    // 铭牌：面向镜头（只绕竖轴转，铭牌始终直立）；飞行的上下浮动，影子跟着缩放
    state.plates.forEach(p => {
      const u = p.u;
      p.group.rotation.y = Math.atan2(camera.position.x - p.group.position.x, camera.position.z - p.group.position.z);
      const bob = u.flying ? Math.sin(time * 2 + u.x) * 0.1 : 0;
      p.group.position.y = u.y + bob;
      if (u.flying) p.shadow.scale.x = 0.9 - bob * 0.5;
      if (u.submerged) p.ripple.scale.setScalar(1.2 + ((time * 0.6) % 1) * 0.5);
      if (p.marker.visible) p.marker.position.y = u.plateH + 0.4 + Math.sin(time * 4) * 0.07;
      p.marker.rotation.y = time * 2;
    });
    clampPan();
    controls.update();
    bokeh.uniforms.focus.value = camera.position.distanceTo(controls.target);   // 焦点在战场中间
    composer.render(dt);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  frame();

  return {
    get portrait() { return state.portrait; },
    setBattle, resize, renderer, camera, controls, scene,
    setInsets(ins) { state.insets = { top: ins.top || 0, bottom: ins.bottom || 0 }; if (state.bounds) fitCamera(false); },
    refit() { state.wantFit = true; fitCamera(true); },
    setActor(id) { state.actorId = id; markActor(); },
    dispose() {
      disposed = true; cancelAnimationFrame(raf); ro.disconnect();
      state.plates.forEach(disposePlate); clearWorld(); weather.dispose();
      composer.dispose(); controls.dispose(); renderer.dispose(); renderer.domElement.remove();
    }
  };
}
