/* Antlerscale: Backfire · HD-2D 战场原型 · three.js 场景
 *
 * 把 hd2d-layout.js 排好的战场画出来：地台 / 间隔 / 装饰（hd2d-world.js）、天幕 / 远景剪影 / 废土地面（hd2d-backdrop.js）、
 * 铭牌（CSS2DRenderer：DOM 立在 3D 位置上，始终正面朝向镜头）、天气和飘浮物（hd2d-weather.js），
 * 加上镜头、灯光（主光 + 轮廓光）、雾和后期（景深 + 泛光 + 热浪 + 调色：色温 / 暗角 / 胶片颗粒 / 雷击闪白），打雷时镜头轻微抖一下。
 *
 *   const sc = createHd2dScene(container, { onPortraitChange(p) {...}, onViewChange() {...} });
 *   sc.setBattle(layout, { weather: "sand", theme: "dusk", backdrop: "desert", actorId });
 *     // layout = HD2DLayout.build(state, { portrait: sc.portrait, view: sc.view() })；默认镜头就用 layout.camera
 *   sc.setInsets({ top, bottom });   // 上下被界面盖住的像素（布局取景时让开），改了以后外面重排一次
 *   sc.dispose();
 * 系统开了「减少动态效果」（prefers-reduced-motion）时，待机动画、飘浮物、天气粒子、乌云、胶片颗粒都停住；雷照打，但闪光减弱、只闪一下，镜头不抖。
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
import { buildZone, buildGap, disposeTree, rng } from "./hd2d-world.js";
import { buildBackdrop, buildGround, skyTexture, BACKDROP } from "./hd2d-backdrop.js";
import { createWeather, weatherPlan } from "./hd2d-weather.js";

/** 布局（hd2d-layout.js，普通脚本，比这个模块先加载）：镜头和铭牌尺寸跟布局用同一份配置 */
const L = window.HD2DLayout;

/* ---------- 配置 ---------- */
const CAM = {
  fov: L.CONFIG.camera.fov,   // 视角窄一点，像看沙盘模型（取景算法在 hd2d-layout.js 的 fitView）
  minElev: 22, maxElev: 46,   // 鼠标拖动能转到的俯角范围（默认俯角 L.CONFIG.camera.elevation）
  maxAzimuth: 0.5,            // 左右最多转多少弧度
  near: 1, far: 220,
  zoomIn: 0.5, zoomOut: 1.12, // 相对「刚好装下整个战场」的距离
  panPad: 3                   // 平移时目标点最多离战场边缘多远
};
/* 景深：焦点在战场中间，离焦点差 1 个单位约糊 aperture 这么多；近处最多糊 maxblur，远处最多糊各主题的 dofFar（远景剪影只稍微出焦） */
const DOF = { aperture: 0.0018, maxblur: 0.014 };
/** 铭牌（DOM）：远的淡一点；状态小圆点 / 架势菱形最多画几个（多的写成数字）。大小和缩放公式在 L.CONFIG.plate */
const PLATE = { fadeRange: 14, fadeMin: 0.72, maxDots: 4, maxPips: 6 };
/** 当前行动的光圈：慢慢转；选中的单位脚下一圈白圈 */
const RING = { radius: 1.05, spin: 0.45, pulse: 0.05 };
/** 脚下的接触阴影：一小块很实的核心 + 一圈软的 */
const SHADOW = { core: 0.42, coreOpacity: 0.78, soft: 1.05, softOpacity: 0.42 };
/** 路灯偶尔闪一下：隔 wait 秒（随机）闪 dur 秒 */
const FLICKER = { wait: [3, 11], dur: [0.18, 0.55], low: 0.12 };
/** 雾：从镜头到战场后沿开始起雾，再往后 depth 远基本全进雾（天幕的底边在这一段里，地面和天边连成一片） */
const FOG = { depth: 30 };
/** 雷击（天气给的闪光 0–1，减少动态效果时天气那边已经减弱过）：全屏往白色推多少（white；color 是显示用的 sRGB 颜色）、
 *  灯光 / 曝光 / 泛光推亮多少；乌云下面平时的灯光压暗到几成（dim）。间隔、连闪、抖动幅度在 hd2d-weather.js 的 STORM */
const FLASH = { white: 0.42, color: [0.92, 0.95, 1.0], hemi: 3.2, sun: 2.5, exposure: 0.35, bloom: 0.5, dim: 0.8 };
const LAYER_COLOR = { flesh: "#d8574a", armor: "#9aa7b3", shield: "#4fb8ff", sand: "#d1a85a", spirit: "#c07cf0" };
const STATUS_COLOR = { burn: "#ff5b2e", shock: "#ffd32e", corr: "#9be03a", frostbite: "#7ccfe8", shockwave: "#ff9a3c", high: "#ff4fa3", reso: "#c07cf0", unstable: "#c07cf0", weak: "#a8977b", inspire: "#39e6b4", sturdy: "#ffc93c", hide: "#6b7a8a", advantage: "#f2c230", chase: "#ff7a2e" };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* 光影主题：白天（沙漠的土黄天）/ 傍晚（橙到紫）/ 夜晚（深蓝）。
 *   sky      天幕从地平线往上的四个颜色（hd2d-backdrop.js 画天幕）
 *   sunPos   主光（斜上方打来）相对战场中心的位置；rimPos 轮廓光（右后上方）
 *   grade    调色：temp 色温（乘到 RGB 上）、sat 饱和度、contrast 对比度、shadow 暗部偏色、high 亮部偏色、vignette 暗角、grain 胶片颗粒
 *   rimCss   铭牌边框上的轮廓光颜色 */
const THEMES = {
  day: {
    sky: ["#f6e3b4", "#ecc98c", "#dcac6a", "#c29a66"], fog: 0xd6b985, ground: 0x6e5b42,
    hemiSky: 0xfff1d8, hemiGround: 0x735c40, hemi: 0.9, sun: 0xfff0d2, sunI: 2.7, sunPos: [-11, 19, 8],
    rim: 0xfff0c8, rimI: 0.55, rimPos: [10, 9, -14], rimCss: "rgba(255, 242, 206, .62)",
    exposure: 1.0, bloom: [0.32, 0.5, 0.9], lamp: 0.25, dofFar: 0.007,
    grade: { temp: [1.04, 1.0, 0.93], sat: 1.12, contrast: 1.08, shadow: [0.0, 0.008, 0.03], high: [1.02, 1.0, 0.95], vignette: 0.3, grain: 0.035 }
  },
  dusk: {
    sky: ["#ffc47c", "#f28a5a", "#b9587a", "#4b3368"], fog: 0xc98a72, ground: 0x4a3a3c,
    hemiSky: 0xffc9a2, hemiGround: 0x3e2c3c, hemi: 0.8, sun: 0xffa262, sunI: 3.0, sunPos: [-16, 15, 7],
    rim: 0xffa0b4, rimI: 0.8, rimPos: [12, 8, -15], rimCss: "rgba(255, 190, 160, .65)",
    exposure: 1.05, bloom: [0.5, 0.65, 0.8], lamp: 0.8, dofFar: 0.008,
    grade: { temp: [1.06, 0.99, 0.92], sat: 1.15, contrast: 1.1, shadow: [0.035, 0.0, 0.055], high: [1.03, 0.99, 0.93], vignette: 0.38, grain: 0.04 }
  },
  night: {
    sky: ["#2f4673", "#1d2d52", "#101b38", "#060b1a"], fog: 0x1b2742, ground: 0x1c2029,
    hemiSky: 0x6f8fc8, hemiGround: 0x141a24, hemi: 0.6, sun: 0x9fbfff, sunI: 1.25, sunPos: [-9, 22, 5],
    rim: 0x8fb8ff, rimI: 0.9, rimPos: [11, 9, -14], rimCss: "rgba(160, 200, 255, .6)",
    exposure: 1.0, bloom: [0.85, 0.75, 0.62], lamp: 1.5, dofFar: 0.014,
    grade: { temp: [0.95, 0.98, 1.06], sat: 1.06, contrast: 1.12, shadow: [0.0, 0.01, 0.04], high: [1.03, 1.0, 0.96], vignette: 0.42, grain: 0.045 }
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

/* 调色（放在 OutputPass 后面，读到的已经是色调映射、sRGB 编码过的颜色）：
 * 色温 → 饱和度 → 对比度 → 暗部 / 亮部偏色 → 暗角（主要在四个角）→ 雷击闪白（整个画面往白色推）→ 胶片颗粒 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, time: { value: 0 }, res: { value: new THREE.Vector2(1, 1) },
    temp: { value: new THREE.Vector3(1, 1, 1) }, sat: { value: 1 }, contrast: { value: 1 },
    shadow: { value: new THREE.Vector3(0, 0, 0) }, high: { value: new THREE.Vector3(1, 1, 1) },
    vignette: { value: 0.3 }, grain: { value: 0.03 }, flash: { value: 0 }, flashColor: { value: new THREE.Vector3(1, 1, 1) }
  },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform vec2 res; uniform vec3 temp; uniform float sat; uniform float contrast;
    uniform vec3 shadow; uniform vec3 high; uniform float vignette; uniform float grain; uniform float flash; uniform vec3 flashColor; varying vec2 vUv;
    float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb * temp;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, sat);
      c = (c - 0.5) * contrast + 0.5;
      l = clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
      c += shadow * (1.0 - smoothstep(0.0, 0.55, l));
      c *= mix(vec3(1.0), high, smoothstep(0.45, 1.0, l));
      float v = smoothstep(0.38, 0.82, length((vUv - 0.5) * vec2(1.0, 1.1)));
      c *= 1.0 - vignette * v;
      c = mix(c, flashColor, flash);
      float n = hash(floor(vUv * res) + floor(fract(time * 0.37) * 97.0) * 1.37) - 0.5;
      c += n * grain * (1.0 - 0.5 * l);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`
};

/* ---------- 程序贴图（几块小 canvas，场景里共用）---------- */
function canvasTexture(size, draw, linear) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  return t;
}
/** 软影子：中间实、边缘渐隐（当 alphaMap 用，白 = 不透明；是数据不是颜色，不做 sRGB 换算） */
const blobTex = () => canvasTexture(128, (g, s) => {
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, "#fff"); grd.addColorStop(0.45, "rgba(255,255,255,.75)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = "#000"; g.fillRect(0, 0, s, s); g.fillStyle = grd; g.fillRect(0, 0, s, s);
}, true);
/** 行动光圈：一圈虚线 + 内圈细线 + 一点光晕（转起来看得出在转） */
const actorRingTex = () => canvasTexture(256, (g, s) => {
  const c = s / 2;
  const glow = g.createRadialGradient(c, c, s * 0.3, c, c, s * 0.5);
  glow.addColorStop(0, "rgba(255,255,255,0)"); glow.addColorStop(0.75, "rgba(255,255,255,.18)"); glow.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = glow; g.fillRect(0, 0, s, s);
  g.strokeStyle = "#fff"; g.lineCap = "round";
  g.lineWidth = s * 0.045;
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.beginPath(); g.arc(c, c, s * 0.42, a, a + 0.32); g.stroke(); }
  g.lineWidth = s * 0.012; g.beginPath(); g.arc(c, c, s * 0.34, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 4; i++) {   // 四个小三角，指向中心
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.save(); g.translate(c + Math.cos(a) * s * 0.47, c + Math.sin(a) * s * 0.47); g.rotate(a + Math.PI);
    g.fillStyle = "#fff"; g.beginPath(); g.moveTo(s * 0.03, 0); g.lineTo(-s * 0.025, s * 0.03); g.lineTo(-s * 0.025, -s * 0.03); g.fill(); g.restore();
  }
});
/** 选中：一圈细白线 */
const selectRingTex = () => canvasTexture(256, (g, s) => {
  g.strokeStyle = "#fff"; g.lineWidth = s * 0.02; g.beginPath(); g.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2); g.stroke();
  g.lineWidth = s * 0.008; g.globalAlpha = 0.6; g.beginPath(); g.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2); g.stroke();
});
/** 铭牌的浮动节奏：按 id 错开（3.2–4.4 秒一个来回，起点也错开） */
function bobOf(id) {
  let h = 0; const s = String(id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return { dur: 3.2 + (h % 13) / 10, delay: -((h >>> 4) % 40) / 10 };
}

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
  const sun = new THREE.DirectionalLight(0xffffff, 2);          // 主光：从左上方斜着打下来，投影子
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  const rim = new THREE.DirectionalLight(0xffffff, 0.6);        // 轮廓光：从右后上方，勾出地台边缘
  scene.add(hemi, sun, sun.target, rim, rim.target);
  const ground = buildGround();       // 地台下面一大片废土
  scene.add(ground);
  // 铭牌层：DOM 叠在画面上，每块铭牌挂在 3D 位置上。层本身不拦鼠标（拖动转镜头仍然落在 canvas 上），铭牌的卡片可以悬停 / 点击
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

  // 后期：渲染 → 景深 → 泛光 → 热浪 → 输出（色调映射 + sRGB）→ 调色
  const composer = new EffectComposer(renderer);
  const bokeh = new BokehPass(scene, camera, { focus: 40, aperture: DOF.aperture, maxblur: DOF.maxblur });
  // 远处单独夹一个上限：远景剪影只稍微出焦，轮廓认得出来（近处、战场照旧）
  bokeh.uniforms.maxblurFar = { value: DOF.maxblur };
  const bokehSrc = bokeh.materialBokeh.fragmentShader;
  const blurLine = "vec2 dofblur = vec2 ( clamp( factor * aperture, -maxblur, maxblur ) );";
  if (bokehSrc.includes(blurLine)) {
    bokeh.materialBokeh.fragmentShader = bokehSrc.replace("uniform float maxblur;", "uniform float maxblur;\n\t\tuniform float maxblurFar;")
      .replace(blurLine, "vec2 dofblur = vec2 ( clamp( factor * aperture, -maxblurFar, maxblur ) );");
    bokeh.materialBokeh.needsUpdate = true;
  }
  // BokehPass 用深度材质把整个场景重画一遍量距离；屏幕背景是张贴图，不该进深度图，这一遍先摘掉
  const bokehRender = bokeh.render.bind(bokeh);
  bokeh.render = function (...args) {
    const bg = scene.background, fog = scene.fog;
    scene.background = null; scene.fog = null;
    try { bokehRender(...args); } finally { scene.background = bg; scene.fog = fog; }
  };
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.6, 0.85);
  const heatPass = new ShaderPass(HeatShader);
  heatPass.enabled = false;
  const grade = new ShaderPass(GradeShader);
  grade.uniforms.flashColor.value.set(...FLASH.color);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bokeh); composer.addPass(bloom); composer.addPass(heatPass);
  composer.addPass(new OutputPass());
  composer.addPass(grade);

  const state = {
    portrait: false, layout: null, meta: { weather: "none", theme: "day" }, insets: { top: 0, bottom: 0 },
    world: null, backdrop: null, backdropSig: "", plates: new Map(), ctx: null, fit: 20, bounds: null, themeName: "day",
    actorId: null, selectedId: null, wantFit: true, motion: true
  };
  const weather = createWeather(scene, { bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 } });
  const clock = new THREE.Clock();
  let animT = 0, raf = 0, disposed = false;   // animT：动画用的时间，减少动态效果时停住
  const shakeR = new THREE.Vector3(), shakeU = new THREE.Vector3(), shakeV = new THREE.Vector3();   // 打雷时镜头抖动用

  // 系统的「减少动态效果」：开着就让待机动画、飘浮物、颗粒都停住（CSS 那边铭牌浮动也停）
  const motionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const applyMotion = () => {
    state.motion = !(motionQuery && motionQuery.matches);
    labels.domElement.classList.toggle("still", !state.motion);
  };
  applyMotion();
  if (motionQuery) {
    if (motionQuery.addEventListener) motionQuery.addEventListener("change", applyMotion);
    else if (motionQuery.addListener) motionQuery.addListener(applyMotion);
  }

  // 共用的贴图 / 材质
  const tex = { blob: blobTex(), actor: actorRingTex(), select: selectRingTex() };
  const shadowGeo = new THREE.PlaneGeometry(2, 2);
  const ringGeo = new THREE.PlaneGeometry(2 * RING.radius, 2 * RING.radius);

  /* ---------- 主题 / 天气 ---------- */
  function applyTheme() {
    const T = THEMES[state.meta.theme] || THEMES.day;
    state.themeName = state.meta.theme;
    if (scene.background && scene.background.dispose) scene.background.dispose();
    // 天幕以外露出来的地方（转到很偏时）；雷鸣时和天幕一样换成风暴色、没有星星
    const storm = weather.storm;
    scene.background = skyTexture(storm ? BACKDROP.storm.sky[state.themeName] || T.sky : T.sky, state.themeName === "night" && !storm);
    hemi.color.set(T.hemiSky); hemi.groundColor.set(T.hemiGround);
    sun.color.set(T.sun); rim.color.set(T.rim); rim.intensity = T.rimI;
    ground.material.color.set(T.ground);
    renderer.toneMappingExposure = T.exposure;
    bloom.strength = T.bloom[0]; bloom.radius = T.bloom[1]; bloom.threshold = T.bloom[2];
    bokeh.uniforms.maxblurFar.value = T.dofFar;
    const G = T.grade, u = grade.uniforms;
    u.temp.value.set(...G.temp); u.sat.value = G.sat; u.contrast.value = G.contrast;
    u.shadow.value.set(...G.shadow); u.high.value.set(...G.high); u.vignette.value = G.vignette; u.grain.value = G.grain;
    labels.domElement.style.setProperty("--rim", T.rimCss);
    applyFog();
  }
  /** 雾色：光影主题的雾，往这个天气想要的雾色靠 */
  function fogColorOf(T, tint) {
    const color = new THREE.Color(T.fog);
    if (tint && tint.fog != null) color.lerp(new THREE.Color(tint.fog), 0.6);
    return color;
  }
  function applyFog() {
    const T = THEMES[state.themeName] || THEMES.day;
    const tint = weather.tint;
    const color = fogColorOf(T, tint);
    const b = state.bounds;
    const back = state.fit + (b ? (b.maxZ - b.minZ) / 2 * Math.cos(THREE.MathUtils.degToRad(L.CONFIG.camera.elevation)) : 8);   // 镜头到战场后沿的大致距离
    const near = back * (tint ? tint.near : 1), far = (back + FOG.depth) * (tint ? tint.far : 1);
    scene.fog = new THREE.Fog(color, near, far);
    ground.material.color.set(T.ground).lerp(color, 0.12);
  }

  /* ---------- 铭牌（DOM，竖立，正面朝镜头）---------- */
  /** 铭牌的 HTML。只读 plate（layout 给的白名单数据），没有坚毅生命。
   *  平时只有名字 + 状态小圆点 + 分层血条 + 架势；等级、ATK、血量数字、状态文字在悬停 / 选中时从头顶展开 */
  function plateHtml(p) {
    const total = Math.max(1, p.hp.max);
    const segs = p.layers.slice().reverse().map(l =>     // 数组 0 是最外层，画在最右
      `<i style="width:${100 * l.max / total}%;background:linear-gradient(90deg,${LAYER_COLOR[l.type] || "#d8574a"} ${l.max ? 100 * l.cur / l.max : 0}%,#2a2520 0)"></i>`).join("");
    let def = "";
    if (p.def.big || p.def.max > PLATE.maxPips) def = `<span class="n">◆${p.def.cur}${p.def.big ? "+" : "/" + p.def.max}</span>`;
    else for (let i = 0; i < p.def.max; i++) def += `<b class="${i < p.def.cur ? "on" : ""}"></b>`;
    const chips = p.statuses.map(s => ({ key: s.key, label: s.label })).concat(p.flags.map(f => ({ key: f.key, label: f.label })));
    const colorOf = (k) => k === "dying" ? "#d8322a" : k === "stunned" ? "#ff9a3c" : (STATUS_COLOR[k] || "#a8977b");
    const dots = chips.slice(0, PLATE.maxDots).map(c => `<i style="background:${colorOf(c.key)}"></i>`).join("");
    const more = chips.map(c => `<em style="background:${colorOf(c.key)}">${esc(c.label)}</em>`).join("");
    return `<div class="pl-more" role="tooltip"><div class="pl-stats"><b>Lv${p.level}</b><span>ATK ${p.atk}</span><span>血量 ${p.hp.cur}/${p.hp.max}</span><span>架势 ${p.def.cur}/${p.def.max}${p.def.big ? "+" : ""}</span></div>${more ? `<div class="pl-chips">${more}</div>` : ""}</div>
      <div class="pl-card" tabindex="0" role="button" aria-label="${esc(p.name)}"><span class="pl-mark" aria-hidden="true"></span><span class="pl-name">${esc(p.name)}</span>
      <div class="pl-mid">${dots ? `<span class="pl-dots">${dots}</span>` : ""}<div class="pl-bar">${segs}</div><span class="pl-def">${def}</span></div></div>`;
  }

  function makePlate(u) {
    const el = document.createElement("div");
    el.className = "hd2d-plate";
    el.innerHTML = '<div class="pl-in"><div class="pl-bob"></div></div><div class="pl-post" aria-hidden="true"></div>';
    const bob = bobOf(u.id);
    el.style.setProperty("--bob-t", bob.dur.toFixed(1) + "s");
    el.style.setProperty("--bob-d", bob.delay.toFixed(1) + "s");
    const label = new CSS2DObject(el);
    label.center.set(0.5, 1);                 // 下边缘（细杆的底）贴着脚下的点
    // 接触阴影：一小块很实的核心 + 一圈软的
    const shadowMat = (op) => new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: tex.blob, transparent: true, opacity: op, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const core = new THREE.Mesh(shadowGeo, shadowMat(SHADOW.coreOpacity));
    const soft = new THREE.Mesh(shadowGeo, shadowMat(SHADOW.softOpacity));
    [core, soft].forEach(m => { m.rotation.x = -Math.PI / 2; m.renderOrder = 1; });
    // 下潜时脚边的沙纹
    const ripple = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.52, 28), new THREE.MeshBasicMaterial({ color: 0xe8d29a, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    ripple.rotation.x = -Math.PI / 2; ripple.scale.set(1.4, 0.8, 1);
    // 当前行动：脚下一圈发光的光圈，慢慢转；选中：一圈白线
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: tex.actor, color: new THREE.Color(0xf2c230).multiplyScalar(2.2), toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.rotation.x = -Math.PI / 2; ring.visible = false; ring.renderOrder = 2;
    const pick = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: tex.select, color: new THREE.Color(0xfff4dc).multiplyScalar(1.6), toneMapped: false, transparent: true, depthWrite: false, opacity: 0.9 }));
    pick.rotation.x = -Math.PI / 2; pick.visible = false; pick.renderOrder = 2;
    const group = new THREE.Group();
    group.add(label);
    scene.add(group, core, soft, ripple, ring, pick);
    const p = { id: u.id, el, inner: el.firstChild, bob: el.firstChild.firstChild, post: el.lastChild, label, core, soft, ripple, ring, pick, group, key: "", sc: 0, hover: false };
    // 悬停高亮、点击选中（只是画面，不接规则）；滚轮照样交给镜头。只有卡片接鼠标（铭牌其余部分、细杆都不拦）
    const onCard = (e) => e.target && e.target.classList && e.target.classList.contains("pl-card");
    el.addEventListener("pointerenter", (e) => { if (onCard(e)) setHover(p, true); }, true);
    el.addEventListener("pointerleave", (e) => { if (onCard(e)) setHover(p, false); }, true);
    el.addEventListener("click", (e) => { if (!e.target.closest(".pl-card")) return; e.stopPropagation(); select(state.selectedId === p.id ? null : p.id); });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(state.selectedId === p.id ? null : p.id); }
      else if (e.key === "Escape") select(null);
    });
    el.addEventListener("wheel", (e) => { e.preventDefault(); renderer.domElement.dispatchEvent(new WheelEvent("wheel", e)); }, { passive: false });
    return p;
  }
  function disposePlate(p) {
    scene.remove(p.group, p.core, p.soft, p.ripple, p.ring, p.pick);
    p.group.remove(p.label);                 // 触发 removed 事件，把 DOM 摘掉
    [p.core, p.soft, p.ring, p.pick].forEach(m => m.material.dispose());
    p.ripple.geometry.dispose(); p.ripple.material.dispose();
  }
  function setHover(p, on) { p.hover = on; markPlates(); }
  function select(id) { state.selectedId = id; markPlates(); }
  function syncPlates() {
    const live = new Set();
    const size = state.layout.plateSize || L.plateSize(view());
    labels.domElement.style.setProperty("--pw", size.w + "px");
    labels.domElement.style.setProperty("--ph", size.h + "px");
    state.layout.units.forEach(u => {
      live.add(u.id);
      let p = state.plates.get(u.id);
      if (!p) { p = makePlate(u); state.plates.set(u.id, p); }
      const key = JSON.stringify(u.plate);
      if (key !== p.key) { p.key = key; p.bob.innerHTML = plateHtml(u.plate); }
      p.u = u;
      p.group.position.set(u.x, u.y, u.z);
      p.post.style.height = Math.max(0, u.lift || 0) + "px";   // 后排抬高：铭牌下面一根细杆连到脚下
      const g = u.groundY;
      p.core.position.set(u.x, g + 0.02, u.z); p.soft.position.set(u.x, g + 0.015, u.z);
      p.ripple.position.set(u.x, g + 0.03, u.z);
      p.ring.position.set(u.x, g + 0.04, u.z); p.pick.position.set(u.x, g + 0.035, u.z);
      p.ripple.visible = u.submerged;
      const air = u.flying ? 0.45 : u.submerged ? 0.3 : 1;     // 飞着的影子淡、小；下潜的几乎没有
      p.core.material.opacity = SHADOW.coreOpacity * air; p.soft.material.opacity = SHADOW.softOpacity * (u.flying ? 0.7 : air);
      p.core.scale.setScalar(SHADOW.core * (u.flying ? 0.8 : 1)); p.soft.scale.set(SHADOW.soft * 1.15, SHADOW.soft, 1);
      p.el.classList.toggle("foe", u.side === "foe");
      p.el.classList.toggle("lifted", (u.lift || 0) > 0.5);
      p.el.classList.toggle("sub", u.submerged);
      p.el.classList.toggle("dying", u.plate.flags.some(f => f.key === "dying"));
    });
    state.plates.forEach((p, id) => { if (!live.has(id)) { disposePlate(p); state.plates.delete(id); } });
    if (state.selectedId != null && !state.plates.has(state.selectedId)) state.selectedId = null;
    markPlates();
  }
  /** 当前行动 / 选中 / 悬停：铭牌加样式，脚下的光圈开关；悬停 / 选中的铭牌叠在最上面（CSS2DRenderer 按 renderOrder 先排） */
  function markPlates() {
    state.plates.forEach(p => {
      const actor = p.id === state.actorId, sel = p.id === state.selectedId;
      p.el.classList.toggle("actor", actor); p.ring.visible = actor;
      p.el.classList.toggle("sel", sel); p.el.classList.toggle("hover", p.hover);
      p.pick.visible = sel || p.hover; p.pick.material.opacity = sel ? 0.9 : 0.45;
      p.label.renderOrder = p.hover ? 2 : sel ? 1 : 0;
    });
  }

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
      state.ctx = { anim: [], lamps: [], fxLights: 0, theme: state.meta.theme };
      const root = new THREE.Group();
      layout.zones.forEach(z => root.add(buildZone(z, state.ctx)));
      layout.gaps.forEach(g => root.add(buildGap(g, state.ctx)));
      scene.add(root); state.world = root;
      state.worldSig = worldSig(layout);
    }
    state.boardSig = boardSig(layout);
    state.bounds = layout.bounds;
    const plan = weatherPlan(state.meta.weather || "none", state.meta.theme);   // 雷鸣：远景要画乌云
    syncBackdrop(layout, state.meta.backdrop || backdropOf(state.meta.theme), plan);
    // 天气：闪电从默认镜头的画面上沿外面劈下来；远处的雷劈在哪问远景
    weather.setBounds(layout.bounds, { camera: layout.camera, farPoint: state.backdrop.farPoint });
    weather.set(state.meta.weather || "none", state.meta.theme);
    syncPlates();
    applyTheme();
    fitShadow();
    fitCamera(newBoard || state.wantFit);
  }
  /** 远景按场景变：没指定就按光影主题猜 */
  const backdropOf = (theme) => theme === "night" ? "night" : theme === "dusk" ? "mine" : "wasteland";
  /** plan = 天气要建的东西（weatherPlan）：雷鸣时远景换成风暴色的天、画乌云，天边接上压暗了的雾色 */
  function syncBackdrop(layout, kind, plan) {
    const c = layout.camera, storm = !!plan.storm;
    const sig = [kind, state.meta.theme, storm ? "storm" : "", Object.values(layout.bounds).map(v => Math.round(v)).join(","), c ? [c.dist, c.pos.y, c.pos.z].map(v => Math.round(v)).join(",") : ""].join("|");
    if (sig === state.backdropSig) return;
    state.backdropSig = sig;
    if (state.backdrop) { scene.remove(state.backdrop.group); state.backdrop.dispose(); }
    const T = THEMES[state.meta.theme] || THEMES.day;
    state.backdrop = buildBackdrop(kind, layout.bounds, state.meta.theme, c, { sky: T.sky, fog: storm ? fogColorOf(T, plan.tint).getHex() : T.fog, storm });
    scene.add(state.backdrop.group);
  }
  const boardSig = (l) => l.zones.map(z => [z.id, Math.round(z.cx * 10), Math.round(z.cz * 10)].join(",")).join(";");
  const worldSig = (l) => boardSig(l) + "|" + (state.meta.theme || "") + "|" + l.zones.map(z => z.kind + z.effects.join("+") + z.h).join(";") + "|" + l.gaps.map(g => [g.key, g.type, g.open, g.maxHp ? Math.ceil((g.hp / g.maxHp) * 4) : 4].join(",")).join(";");

  /* ---------- 镜头 ---------- */
  /** 现在的画面：给布局取景 / 算铭牌在屏幕上的位置用 */
  function view() {
    return { width: Math.max(1, container.clientWidth), height: Math.max(1, container.clientHeight), top: state.insets.top, bottom: state.insets.bottom };
  }
  /** 默认镜头直接用布局算好的（hd2d-layout.js 的 fitView，和铭牌的站位是同一个镜头）。reset = 把玩家转过的视角放回去 */
  function fitCamera(reset) {
    const c = state.layout && state.layout.camera;
    if (!c) return;
    state.fit = c.dist;
    state.fitTarget = new THREE.Vector3(c.target.x, c.target.y, c.target.z);
    controls.minDistance = c.dist * CAM.zoomIn; controls.maxDistance = c.dist * CAM.zoomOut;
    if (reset) {
      camera.position.set(c.pos.x, c.pos.y, c.pos.z);
      controls.target.copy(state.fitTarget);
      camera.lookAt(controls.target);
      controls.update();
    }
    state.wantFit = false;
    camera.far = Math.max(CAM.far, c.dist * 7); camera.updateProjectionMatrix();
    bokeh.uniforms.farClip.value = camera.far;
    applyFog();
  }
  function fitShadow() {
    const b = state.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const r = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 3;
    sun.target.position.set(cx, 0, cz); rim.target.position.set(cx, 0, cz);
    const T = THEMES[state.meta.theme] || THEMES.day;
    sun.position.set(cx + T.sunPos[0], T.sunPos[1] + r * 0.4, cz + T.sunPos[2]);
    rim.position.set(cx + T.rimPos[0], T.rimPos[1], cz + T.rimPos[2]);
    const c = sun.shadow.camera; c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 1; c.far = 90; c.updateProjectionMatrix();
    ground.position.x = cx; ground.position.z = cz;
  }
  function clampPan() {
    if (!state.bounds) return;
    const b = state.bounds, t = controls.target, P = CAM.panPad;
    const nx = THREE.MathUtils.clamp(t.x, b.minX - P, b.maxX + P), nz = THREE.MathUtils.clamp(t.z, b.minZ - P, b.maxZ + P), ny = THREE.MathUtils.clamp(t.y, -1, 2);
    const d = new THREE.Vector3(nx - t.x, ny - t.y, nz - t.z);
    if (d.lengthSq() > 0) { t.add(d); camera.position.add(d); }
  }

  /* ---------- 尺寸 / 循环 ---------- */
  function resize() {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    labels.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    bokeh.uniforms.aspect.value = camera.aspect;
    grade.uniforms.res.value.set(w * pr, h * pr);
    const portrait = w / h < 0.85;
    state.wantFit = true;                    // 窗口变了：铭牌位置按新画面重排，镜头回到默认
    if (portrait !== state.portrait) {
      state.portrait = portrait;
      if (options.onPortraitChange) options.onPortraitChange(portrait);   // 外面会重排战场再 setBattle
    } else if (options.onViewChange) options.onViewChange();
    else if (state.layout) fitCamera(true);
  }

  // 点到空地（没拖动）：取消选中
  let downAt = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { downAt = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5 && state.selectedId != null) select(null);
    downAt = null;
  });

  const lampRand = rng(901);
  function updateLamps(T, dt) {
    if (!state.ctx) return;
    state.ctx.lamps.forEach(l => {
      let k = 1;
      if (state.motion) {
        if (l.flick > 0) {                    // 正在闪：一阵快速的明灭
          l.flick -= dt;
          k = Math.sin(l.flick * 57 + l.seed) > 0.15 ? 1 : FLICKER.low;
        } else if ((l.wait -= dt) <= 0) {
          l.flick = FLICKER.dur[0] + lampRand() * (FLICKER.dur[1] - FLICKER.dur[0]);
          l.wait = FLICKER.wait[0] + lampRand() * (FLICKER.wait[1] - FLICKER.wait[0]);
        }
      }
      if (l.light) l.light.intensity = l.base * T.lamp * k;
      if (l.bulb && l.bulbColor) l.bulb.material.color.copy(l.bulbColor).multiplyScalar(0.2 + 0.8 * k);
    });
  }

  function frame() {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden) { clock.getDelta(); return; }
    const dt = Math.min(0.1, clock.getDelta());
    const moving = state.motion, adt = moving ? dt : 0;   // 减少动态效果：动画时间停住
    animT += adt;
    if (state.ctx) state.ctx.anim.forEach(fn => fn(animT, adt));
    // 天气：粒子按动画时间走；雷击按真实时间走（减少动态效果时照打，由天气减弱闪光、不给抖动）
    weather.update(adt, animT, { dt, reduced: !moving });
    const fl = weather.flash, strike = weather.strike;
    if (state.backdrop && state.backdrop.update) state.backdrop.update(animT, adt, { flash: fl, x: strike ? strike.x : 0 });   // 乌云飘、打雷时被照亮
    // 雷击：全屏闪白，灯光 / 曝光 / 泛光瞬间推亮；乌云下面平时的灯光压暗一点
    const T = THEMES[state.themeName] || THEMES.day, dim = weather.storm ? FLASH.dim : 1;
    hemi.intensity = T.hemi * dim + fl * FLASH.hemi; sun.intensity = T.sunI * dim + fl * FLASH.sun;
    renderer.toneMappingExposure = T.exposure * (1 + fl * FLASH.exposure);
    bloom.strength = T.bloom[0] + fl * FLASH.bloom;
    grade.uniforms.flash.value = fl * FLASH.white;
    heatPass.enabled = weather.heat > 0;
    heatPass.uniforms.time.value = animT;
    grade.uniforms.time.value = animT;
    updateLamps(T, dt);
    // 铭牌：DOM 自己就正对镜头；这里管飞行的上下浮动、影子跟着缩放、行动光圈旋转，以及按远近缩放 / 变淡
    const focus = camera.position.distanceTo(controls.target);
    state.plates.forEach(p => {
      const u = p.u;
      const bob = u.flying ? Math.sin(animT * 2 + u.x) * 0.1 : 0;
      p.group.position.y = u.y + bob;
      if (u.flying) p.soft.scale.x = SHADOW.soft * (1.15 - bob * 0.6);
      if (u.submerged) p.ripple.scale.setScalar(1.2 + ((animT * 0.6) % 1) * 0.5);
      if (p.ring.visible) { p.ring.rotation.z = animT * RING.spin; p.ring.scale.setScalar(1 + Math.sin(animT * 2.4) * RING.pulse); }
      const d = camera.position.distanceTo(p.group.position);
      const sc = L.plateScale({ pos: camera.position, dist: focus }, p.group.position);
      if (Math.abs(sc - p.sc) > 0.004) { p.sc = sc; p.inner.style.transform = "scale(" + sc.toFixed(3) + ")"; }
      const op = 1 - (1 - PLATE.fadeMin) * THREE.MathUtils.clamp((d - focus) / PLATE.fadeRange, 0, 1);
      p.el.style.opacity = u.submerged ? Math.min(op, 0.82).toFixed(2) : op.toFixed(2);
    });
    clampPan();
    controls.update();
    bokeh.uniforms.focus.value = focus;   // 焦点在战场中间
    // 打雷那一下镜头轻微抖动：天气给的像素换成焦点处的世界长度，沿镜头的左右 / 上下挪。
    // 只挪这一帧的渲染（铭牌跟着一起抖），渲染完挪回去，OrbitControls 看不到
    const sh = weather.shake, shaking = sh.x !== 0 || sh.y !== 0;
    if (shaking) {
      const px = 2 * focus * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, container.clientHeight);
      camera.updateMatrixWorld();
      shakeR.setFromMatrixColumn(camera.matrixWorld, 0); shakeU.setFromMatrixColumn(camera.matrixWorld, 1);
      shakeV.copy(shakeR).multiplyScalar(sh.x * px).addScaledVector(shakeU, sh.y * px);
      camera.position.add(shakeV); camera.updateMatrixWorld();
    }
    composer.render(dt);
    labels.render(scene, camera);
    if (shaking) { camera.position.sub(shakeV); camera.updateMatrixWorld(); }
  }

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  frame();

  return {
    get portrait() { return state.portrait; },
    get motion() { return state.motion; },
    setBattle, resize, view, renderer, camera, controls, scene,
    setInsets(ins) { state.insets = { top: ins.top || 0, bottom: ins.bottom || 0 }; },
    refit() { state.wantFit = true; fitCamera(true); },
    setActor(id) { state.actorId = id; markPlates(); },
    select,
    dispose() {
      disposed = true; cancelAnimationFrame(raf); ro.disconnect();
      state.plates.forEach(disposePlate); clearWorld(); weather.dispose();
      if (state.backdrop) { scene.remove(state.backdrop.group); state.backdrop.dispose(); }
      Object.values(tex).forEach(t => t.dispose()); shadowGeo.dispose(); ringGeo.dispose();
      labels.domElement.remove();
      composer.dispose(); controls.dispose(); renderer.dispose(); renderer.domElement.remove();
    }
  };
}
