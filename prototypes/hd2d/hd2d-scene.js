/* Antlerscale: Backfire · HD-2D 战场原型 · three.js 场景
 *
 * 把 hd2d-layout.js 排好的战场画出来：地台 / 间隔 / 装饰（hd2d-world.js）、远景和废土地面（hd2d-backdrop.js）、
 * 铭牌（CSS2DRenderer：DOM 立在 3D 位置上，始终正面朝向镜头）、天气（hd2d-weather.js），加上镜头、灯光、雾和后期（景深 + 泛光 + 热浪）。
 *
 *   const sc = createHd2dScene(container, { onPortraitChange(p) {...} });
 *   sc.setBattle(layout, { weather: "sand", theme: "dusk", backdrop: "desert", actorId });   // layout = HD2DLayout.build(state, { portrait: sc.portrait })
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
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { buildZone, buildGap, disposeTree } from "./hd2d-world.js";
import { buildBackdrop, buildGround, skyTexture } from "./hd2d-backdrop.js";
import { createWeather } from "./hd2d-weather.js";

/* ---------- 配置 ---------- */
const CAM = {
  fov: 22,                // 视角窄一点，像看沙盘模型
  elevation: 30,          // 默认俯角（度）；低一点才看得到地台后面的远景
  minElev: 22, maxElev: 46,   // 鼠标拖动能转到的俯角范围
  maxAzimuth: 0.5,        // 左右最多转多少弧度
  near: 1, far: 220,
  zoomIn: 0.5, zoomOut: 1.12,   // 相对「刚好装下整个战场」的距离
  margin: 0.97,           // 取景时留的边（NDC 的比例）：地台尽量填满画面宽度
  panPad: 3               // 平移时目标点最多离战场边缘多远
};
const DOF = { aperture: 0.0018, maxblur: 0.014 };   // 景深：焦点在战场中间，前后两头、远景糊开（距焦点差 1 个单位约糊 aperture 这么多）
/** 铭牌（DOM）：随距离缩放、远的淡一点。基准大小在 hd2d.css 的 .hd2d-plate（名字 13px） */
const PLATE = { scaleExp: 0.85, minScale: 0.74, maxScale: 1.15, fadeRange: 14, fadeMin: 0.7, maxChips: 3 };
const LAYER_COLOR = { flesh: "#d8574a", armor: "#9aa7b3", shield: "#4fb8ff", sand: "#d1a85a", spirit: "#c07cf0" };
const STATUS_COLOR = { burn: "#ff5b2e", shock: "#ffd32e", corr: "#9be03a", frostbite: "#7ccfe8", shockwave: "#ff9a3c", high: "#ff4fa3", reso: "#c07cf0", unstable: "#c07cf0", weak: "#a8977b", inspire: "#39e6b4", sturdy: "#ffc93c", hide: "#6b7a8a", advantage: "#f2c230", chase: "#ff7a2e" };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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
  const ground = buildGround();       // 地台下面一大片暗色废土
  scene.add(ground);
  // 铭牌层：DOM 叠在画面上，每块铭牌挂在 3D 位置上，不拦鼠标（拖动转镜头仍然落在 canvas 上）
  const labels = new CSS2DRenderer();
  labels.domElement.className = "hd2d-labels";
  container.appendChild(labels.domElement);

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
    world: null, backdrop: null, backdropSig: "", plates: new Map(), ctx: null, fit: 20, bounds: null, themeName: "day", actorId: null, wantFit: true
  };
  const weather = createWeather(scene, { bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 } });
  const clock = new THREE.Clock();
  let time = 0, raf = 0, disposed = false;

  /* ---------- 主题 / 天气 ---------- */
  function applyTheme() {
    const T = THEMES[state.meta.theme] || THEMES.day;
    state.themeName = state.meta.theme;
    if (scene.background && scene.background.dispose) scene.background.dispose();
    scene.background = skyTexture(T.skyTop, T.skyBot, state.themeName === "night");
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
    const near = state.fit * (tint ? tint.near : 1) * 1.1, far = state.fit * (tint ? tint.far : 1) * 3.4;   // 雾放远一点：近处地台不蒙，远处废土渐渐沉进雾里
    scene.fog = new THREE.Fog(color, near, far);
    ground.material.color.set(T.ground).lerp(color, 0.15);
  }

  /* ---------- 铭牌（DOM，竖立，正面朝镜头）---------- */
  /** 铭牌的 HTML。只读 plate（layout 给的白名单数据），没有坚毅生命 */
  function plateHtml(p) {
    const total = Math.max(1, p.hp.max);
    const segs = p.layers.slice().reverse().map(l =>     // 数组 0 是最外层，画在最右
      `<i style="width:${100 * l.max / total}%;background:linear-gradient(90deg,${LAYER_COLOR[l.type] || "#d8574a"} ${l.max ? 100 * l.cur / l.max : 0}%,#2a2520 0)"></i>`).join("");
    let def = "";
    if (p.def.big) def = `<span class="pl-big">架势 ${p.def.cur}+</span>`;
    else for (let i = 0; i < p.def.max; i++) def += `<b class="${i < p.def.cur ? "on" : ""}"></b>`;
    const chips = p.statuses.map(s => ({ key: s.key, label: s.label })).concat(p.flags.map(f => ({ key: f.key, label: f.label })));
    const shown = chips.slice(0, PLATE.maxChips).map(c => {
      const col = c.key === "dying" ? "#d8322a" : c.key === "stunned" ? "#ff9a3c" : (STATUS_COLOR[c.key] || "#a8977b");
      return `<em style="background:${col}">${esc(c.label)}</em>`;
    }).join("") + (chips.length > PLATE.maxChips ? `<em class="more">+${chips.length - PLATE.maxChips}</em>` : "");
    return `<div class="pl-chips">${shown}</div><div class="pl-card ${p.side}">
      <div class="pl-top"><span class="pl-name">${esc(p.name)}</span><span class="pl-lv">Lv${p.level}</span></div>
      <div class="pl-bar">${segs}<span>${p.hp.cur}/${p.hp.max}</span></div>
      <div class="pl-low"><span class="pl-def">${def}</span><span class="pl-atk">ATK ${p.atk}</span></div></div>`;
  }

  function makePlate(u) {
    const el = document.createElement("div");
    el.className = "hd2d-plate";
    el.innerHTML = '<div class="pl-in"></div><div class="pl-arrow" aria-hidden="true"></div>';
    const label = new CSS2DObject(el);
    label.center.set(0.5, 1);                 // 下边缘贴着脚下的点
    // 地面影子：一个压扁的圆（比铭牌略宽）
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.62, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    shadow.rotation.x = -Math.PI / 2;
    // 下潜时脚边的沙纹
    const ripple = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.52, 28), new THREE.MeshBasicMaterial({ color: 0xe8d29a, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    ripple.rotation.x = -Math.PI / 2; ripple.scale.set(1.4, 0.8, 1);
    // 当前行动：脚下一圈发光的光圈（铭牌上方另有一个跳动的箭头）
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.78, 0.95, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf2c230).multiplyScalar(2.2), toneMapped: false, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.visible = false;
    const group = new THREE.Group();
    group.add(label);
    scene.add(group, shadow, ripple, ring);
    return { id: u.id, el, inner: el.firstChild, label, shadow, ripple, ring, group, key: "", sc: 0 };
  }
  function disposePlate(p) {
    scene.remove(p.group, p.shadow, p.ripple, p.ring);
    p.group.remove(p.label);                 // 触发 removed 事件，把 DOM 摘掉
    p.shadow.geometry.dispose(); p.shadow.material.dispose(); p.ripple.geometry.dispose(); p.ripple.material.dispose();
    p.ring.geometry.dispose(); p.ring.material.dispose();
  }
  function syncPlates() {
    const live = new Set();
    state.layout.units.forEach(u => {
      live.add(u.id);
      let p = state.plates.get(u.id);
      if (!p) { p = makePlate(u); state.plates.set(u.id, p); }
      const key = JSON.stringify(u.plate);
      if (key !== p.key) { p.key = key; p.inner.innerHTML = plateHtml(u.plate); }
      p.u = u;
      p.group.position.set(u.x, u.y, u.z);
      p.shadow.position.set(u.x, u.groundY + 0.025, u.z);
      p.ripple.position.set(u.x, u.groundY + 0.03, u.z);
      p.ring.position.set(u.x, u.groundY + 0.04, u.z);
      p.ripple.visible = u.submerged;
      p.shadow.material.opacity = u.flying ? 0.3 : u.submerged ? 0.15 : 0.45;
      p.shadow.scale.set(u.flying ? 1.3 : 1.6, u.flying ? 0.7 : 0.85, 1);
      p.el.classList.toggle("sub", u.submerged);
      p.el.classList.toggle("dying", u.plate.flags.some(f => f.key === "dying"));
    });
    state.plates.forEach((p, id) => { if (!live.has(id)) { disposePlate(p); state.plates.delete(id); } });
    markActor();
  }
  function markActor() { state.plates.forEach(p => { const on = p.id === state.actorId; p.el.classList.toggle("actor", on); p.ring.visible = on; }); }

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
    syncBackdrop(layout.bounds, state.meta.backdrop || backdropOf(state.meta.theme));
    weather.setBounds(layout.bounds);
    weather.set(state.meta.weather || "none");
    syncPlates();
    applyTheme();
    fitShadow();
    fitCamera(newBoard || state.wantFit);
  }
  /** 远景按场景变：没指定就按光影主题猜 */
  const backdropOf = (theme) => theme === "night" ? "night" : theme === "dusk" ? "mine" : "wasteland";
  function syncBackdrop(bounds, kind) {
    const sig = [kind, state.meta.theme, Object.values(bounds).map(v => Math.round(v)).join(",")].join("|");
    if (sig === state.backdropSig) return;
    state.backdropSig = sig;
    if (state.backdrop) { scene.remove(state.backdrop.group); state.backdrop.dispose(); }
    state.backdrop = buildBackdrop(kind, bounds, state.meta.theme);
    scene.add(state.backdrop.group);
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
    camera.far = Math.max(CAM.far, dist * 7); camera.updateProjectionMatrix();
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
    labels.setSize(w, h);
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
    // 铭牌：DOM 自己就正对镜头；这里管飞行的上下浮动、影子跟着缩放、行动光圈脉动，以及按远近缩放 / 变淡
    const focus = camera.position.distanceTo(controls.target);
    state.plates.forEach(p => {
      const u = p.u;
      const bob = u.flying ? Math.sin(time * 2 + u.x) * 0.1 : 0;
      p.group.position.y = u.y + bob;
      if (u.flying) p.shadow.scale.x = 1.3 - bob * 0.5;
      if (u.submerged) p.ripple.scale.setScalar(1.2 + ((time * 0.6) % 1) * 0.5);
      if (p.ring.visible) { const k = 1 + Math.sin(time * 4) * 0.06; p.ring.scale.set(1.5 * k, 0.9 * k, 1); }
      const d = camera.position.distanceTo(p.group.position);
      const sc = THREE.MathUtils.clamp(Math.pow(focus / d, PLATE.scaleExp), PLATE.minScale, PLATE.maxScale);
      if (Math.abs(sc - p.sc) > 0.004) { p.sc = sc; p.inner.style.transform = "scale(" + sc.toFixed(3) + ")"; }
      const op = 1 - (1 - PLATE.fadeMin) * THREE.MathUtils.clamp((d - focus) / PLATE.fadeRange, 0, 1);
      p.el.style.opacity = u.submerged ? 0.6 : op.toFixed(2);
    });
    clampPan();
    controls.update();
    bokeh.uniforms.focus.value = focus;   // 焦点在战场中间
    composer.render(dt);
    labels.render(scene, camera);
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
      if (state.backdrop) { scene.remove(state.backdrop.group); state.backdrop.dispose(); }
      labels.domElement.remove();
      composer.dispose(); controls.dispose(); renderer.dispose(); renderer.domElement.remove();
    }
  };
}
