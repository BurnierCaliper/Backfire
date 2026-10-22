/* Antlerscale: Backfire · HD-2D 战场原型 · three.js 场景
 *
 * 把 hd2d-layout.js 排好的战场画出来：地台 / 间隔 / 装饰（hd2d-world.js）、天幕 / 远景剪影 / 废土地面（hd2d-backdrop.js）、
 * 铭牌（CSS2DRenderer：DOM 立在 3D 位置上，始终正面朝向镜头）、天气和飘浮物（hd2d-weather.js），
 * 加上镜头、灯光（主光 + 轮廓光）、雾和后期（景深 + 泛光 + 热浪 + 调色：色温 / 暗角 / 胶片颗粒 / 雷击闪白），打雷时镜头轻微抖一下。
 *
 *   const sc = createHd2dScene(container, { onPortraitChange(p) {...}, onViewChange() {...} });
 *   sc.setBattle(layout, { weather: "sand", theme: "dusk", actorId });
 *     // layout = HD2DLayout.build(state, { portrait: sc.portrait, view: sc.view(), region: "沙漠", theme: "dusk" })；默认镜头就用 layout.camera。
 *     // 这场战斗所在的区域定了地面主题（layout.ground）：远景、地台外大片地面的颜色、灯（layout.lamps）都跟着它；
 *     // meta.backdrop 可以硬指定远景，区域认不得时按光影主题猜
 *   sc.setInsets({ top, bottom });   // 上下被界面盖住的像素（布局取景时让开），改了以后外面重排一次
 *   sc.setTier("near") / sc.stepTier(±1) / sc.setZone(区号) / sc.stepZone(±1)   // 三段镜头（远景 / 中景 / 近景看单个区域，hd2d-camera.js）
 *   sc.closeUp(单位 id)   // 近景里特写一个单位（双击铭牌 / 站位就是它，#237）；拉远（滚轮往后、2 / 1、远 / 中按钮）退出，状态机在 hd2d-camera.js · camStep
 *   sc.setWind({ x, z })  // 沙暴的风（hd2d-wfx.js · windOf 按投影里的 sandDir 算）：3D 的沙粒顺着它飞，和 2D 层的沙雾一个方向（#240）
 *   sc.flash              // 这一帧雷击的闪光 0–1：天气的 2D 层跟着淡掉（#240）
 *   createHd2dScene(container, { camera: { tier, zone }, onCameraChange(info) {...} })   // 开场的镜头；镜头一变就告诉外面（换按钮、网址）
 *   sc.dispose();
 * 镜头是这个玩家自己的视角：滚轮在三段之间跳、点地台 / 铭牌选区，都只动这边的画面，不写进战斗状态，也不同步给别人。
 * 系统开了「减少动态效果」（prefers-reduced-motion）时，待机动画、飘浮物、天气粒子、乌云、胶片颗粒都停住；雷照打，但闪光减弱、只闪一下，镜头不抖；
 * 换镜头不插值，直接切过去。
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
import { buildZone, buildGap, buildLamps, disposeTree, rng } from "./hd2d-world.js";
import { buildBackdrop, buildGround, skyTexture, dustSky, BACKDROP } from "./hd2d-backdrop.js";
import { createWeather, weatherPlan, fogRange as fogRangeOf, fogColor } from "./hd2d-weather.js";

/** 布局（hd2d-layout.js，普通脚本，比这个模块先加载）：镜头和铭牌尺寸跟布局用同一份配置 */
const L = window.HD2DLayout;
/** 三段镜头（hd2d-camera.js，普通脚本，紧跟着布局加载）：每一段的俯角、视野、距离、景深、过渡都在它的 CAMERA 里 */
const C = window.HD2DCamera;
/** 区域场景的美术（#242，hd2d-scene-art.js）：场景自己的光照 / 调色（矿内、矿底压暗；矿底不分白天黑夜）。没加载就照旧按光影主题 */
const ART = window.HD2DSceneArt || { lighting: () => null, weather: (k, w) => ({ fx: w || "none" }) };

/* ---------- 配置 ---------- */
const CAM = {
  fov: L.CONFIG.camera.fov,   // 视角窄一点，像看沙盘模型（取景算法在 hd2d-layout.js 的 fitView）；中景 / 近景的视野在 C.CAMERA
  maxAzimuth: 0.5,            // 左右最多转多少弧度（拖动能转到的俯角范围每一段不同：C.CAMERA[段].tilt）
  near: 1, far: 220,          // 近裁剪面每一段不同（C.CAMERA[段].clip）；滚轮不再缩放，在三段之间跳
  panPad: 3                   // 平移时目标点最多离战场边缘多远
};
/* 景深：焦点在镜头看的那一点（远景是战场中间，中景 / 近景是选中的区），离焦点差 1 个单位约糊 aperture 这么多；
 * 比焦点近的最多糊 maxblur，比焦点远的最多糊各主题的 dofFar × 这一段的 far（远景剪影只稍微出焦）；
 * 近景另按横着离开焦点区多远再糊一层（lateral，左右相邻的区和焦点区差不多远，光按深度糊不掉）。数值在 C.CAMERA[段].dof */
/** 铭牌（DOM）：远的淡一点；状态小圆点 / 架势菱形最多画几个（多的写成数字）；近景放大的铭牌最多写几个状态、画几个架势菱形；
 *  近景里别的区的铭牌乘多少透明度（再糊一点，CSS 的 .dim）。大小和缩放公式在 L.CONFIG.plate */
const PLATE = { fadeRange: 14, fadeMin: 0.72, maxDots: 4, maxPips: 6, bigChips: 3, bigPips: 6, dim: 0.5 };
/** 选中的区：地台顶面靠边一圈细框（inset = 离地台边多远、width 多宽），慢慢一明一暗（减少动态效果时不闪）；颜色 × glow 亮到泛光抓得到 */
const FOCUS = { inset: 0.28, width: 0.09, color: 0xf2c230, glow: 1.5, opacity: 0.55, pulse: 0.15, speed: 2.2 };
/** 当前行动的光圈：慢慢转；选中的单位脚下一圈白圈 */
const RING = { radius: 1.05, spin: 0.45, pulse: 0.05 };
/** 脚下的接触阴影：一小块很实的核心 + 一圈软的 */
const SHADOW = { core: 0.42, coreOpacity: 0.78, soft: 1.05, softOpacity: 0.42 };
/** 灯（战场外缘的路灯 / 矿灯）偶尔闪一下：隔 wait 秒（随机）闪 dur 秒 */
const FLICKER = { wait: [3, 11], dur: [0.18, 0.55], low: 0.12 };
/** 雾：从镜头到战场后沿开始起雾，再往后 depth 远基本全进雾（天幕的底边在这一段里，地面和天边连成一片）。
 *  #237：远处收得近一点（以前 30），像一个舞台场景，不是一望无际的星球 */
const FOG = { depth: 24 };
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
  controls.rotateSpeed = 0.45; controls.panSpeed = 0.8;
  controls.enableZoom = false;               // 滚轮不缩放：在远景 / 中景 / 近景三段之间跳（下面的 wheel）
  controls.screenSpacePanning = false;       // 平移沿着地面走
  controls.minAzimuthAngle = -CAM.maxAzimuth; controls.maxAzimuthAngle = CAM.maxAzimuth;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };   // 手机：单指转、双指平移（不缩放）

  // 后期：渲染 → 景深 → 泛光 → 热浪 → 输出（色调映射 + sRGB）→ 调色
  const composer = new EffectComposer(renderer);
  const DOF0 = C.CAMERA.far.dof;
  const bokeh = new BokehPass(scene, camera, { focus: 40, aperture: DOF0.aperture, maxblur: DOF0.maxblur });
  // 远处单独夹一个上限：远景剪影只稍微出焦，轮廓认得出来（近处、战场照旧）
  bokeh.uniforms.maxblurFar = { value: DOF0.maxblur };
  const bokehSrc = bokeh.materialBokeh.fragmentShader;
  const blurLine = "vec2 dofblur = vec2 ( clamp( factor * aperture, -maxblur, maxblur ) );";
  if (bokehSrc.includes(blurLine)) {
    bokeh.materialBokeh.fragmentShader = bokehSrc.replace("uniform float maxblur;", "uniform float maxblur;\n\t\tuniform float maxblurFar;")
      .replace(blurLine, "vec2 dofblur = vec2 ( clamp( factor * aperture, -maxblurFar, maxblur ) );");
    bokeh.materialBokeh.needsUpdate = true;
  }
  // 近景：焦点区左右两边、和它差不多远的东西（相邻的区）光按深度糊不掉——按横着离开焦点区多远（镜头空间的横坐标，离焦点区中心 focusX 超过 focusHalf 的部分），
  // 再当作多差 lateral 倍那么多深度去糊（C.CAMERA[段].dof.lateral；远景 / 中景是 0，和以前一样）。JS 里同一个算法：hd2d-camera.js · blurAt
  bokeh.uniforms.lateral = { value: 0 }; bokeh.uniforms.focusX = { value: 0 }; bokeh.uniforms.focusHalf = { value: 1 };
  bokeh.uniforms.tanHalf = { value: Math.tan(THREE.MathUtils.degToRad(CAM.fov / 2)) };
  const factorLine = "float factor = ( focus + viewZ );";
  const bokehSrc2 = bokeh.materialBokeh.fragmentShader;
  if (bokehSrc2.includes("uniform float maxblurFar;") && bokehSrc2.includes(factorLine)) {
    bokeh.materialBokeh.fragmentShader = bokehSrc2
      .replace("uniform float maxblurFar;", "uniform float maxblurFar;\n\t\tuniform float lateral;\n\t\tuniform float focusX;\n\t\tuniform float focusHalf;\n\t\tuniform float tanHalf;")
      .replace(factorLine, factorLine + "\n\t\t\tfloat latBlur = max( 0.0, abs( ( vUv.x * 2.0 - 1.0 ) * ( - viewZ ) * tanHalf * aspect - focusX ) - focusHalf ) * lateral;" +
        "\n\t\t\tfactor += factor >= 0.0 ? latBlur : - latBlur;");
    bokeh.materialBokeh.needsUpdate = true;
  }
  const focusV = new THREE.Vector3();
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

  // 镜头（每个玩家自己的）：tier 远 / 中 / 近、zone 选中的区（null = 跟着当前行动单位）、close 特写的单位（近景里双击，#237；null = 没在特写）、
  // pose 这一段的镜头（hd2d-camera.js · pose / closePose）、cur 这一帧实际用的（过渡中是插值出来的）、tween 正在过渡
  const start = options.camera || {};
  const state = {
    portrait: false, layout: null, meta: { weather: "none", theme: "day" }, insets: { top: 0, bottom: 0 },
    world: null, backdrop: null, backdropSig: "", plates: new Map(), ctx: null, fit: 20, bounds: null, themeName: "day",
    actorId: null, selectedId: null, wantFit: true, motion: true,
    tier: C.tierName(start.tier), zone: start.zone != null && start.zone !== "" ? Number(start.zone) : null, close: null, pose: null, cur: null, tween: null
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
  /** 这一场用的光影主题：场景有自己的光照（#242）就是改过的那一套（setBattle 里算好放在 state.lit），不然是光影主题本来的 */
  const themeNow = () => state.lit || THEMES[state.meta.theme] || THEMES.day;
  function applyTheme() {
    const T = themeNow();
    state.themeName = state.meta.theme;
    if (scene.background && scene.background.dispose) scene.background.dispose();
    // 天幕以外露出来的地方（转到很偏时）；雷鸣时和天幕一样换成风暴色、没有星星；沙暴时和天幕一样蒙上沙色、没有星星
    const storm = weather.storm, dust = dustOf(T, weather.tint);
    scene.background = skyTexture(storm ? BACKDROP.storm.sky[state.themeName] || T.sky : dustSky(T.sky, dust), state.themeName === "night" && !storm && !dust);
    hemi.color.set(T.hemiSky); hemi.groundColor.set(T.hemiGround);
    sun.color.set(T.sun); rim.color.set(T.rim); rim.intensity = T.rimI;
    ground.material.color.copy(groundColor(T));
    renderer.toneMappingExposure = T.exposure;
    bloom.strength = T.bloom[0]; bloom.radius = T.bloom[1]; bloom.threshold = T.bloom[2];
    bokeh.uniforms.maxblurFar.value = T.dofFar;
    const G = T.grade, u = grade.uniforms;
    u.temp.value.set(...G.temp); u.sat.value = G.sat; u.contrast.value = G.contrast;
    u.shadow.value.set(...G.shadow); u.high.value.set(...G.high); u.vignette.value = G.vignette; u.grain.value = G.grain;
    labels.domElement.style.setProperty("--rim", T.rimCss);
    applyFog();
  }
  /** 地台外面那一大片地：区域的地面主题有自己的颜色（白天的），傍晚 / 夜晚照以前光影主题的地面比白天暗多少来压暗；
   *  认不得的区域照旧用光影主题的颜色（THEMES.ground） */
  function groundColor(T) {
    const look = state.layout && L.GROUNDS[state.layout.ground];
    if (!look || look.ground == null) return new THREE.Color(T.ground);
    const day = new THREE.Color(THEMES.day.ground), now = new THREE.Color(T.ground);
    return new THREE.Color(look.ground).multiply(new THREE.Color(now.r / day.r, now.g / day.g, now.b / day.b));
  }
  /** 雾色：光影主题的雾，往这个天气想要的雾色靠（靠多少按天气配置 tint.mix，hd2d-weather.js · fogColor） */
  function fogColorOf(T, tint) { return fogColor(T.fog, tint); }
  /** 沙暴（#240）：远景蒙上的沙尘（hd2d-backdrop.js 的 colors.dust）——颜色就是这时的雾色，蒙多少按天气配置（tint.sky / haze / veil）；别的天气是 null */
  function dustOf(T, tint) {
    return tint && tint.sky > 0 ? { color: fogColorOf(T, tint).getHex(), sky: tint.sky, haze: tint.haze, veil: tint.veil, sun: tint.sun } : null;
  }
  function applyFog() {
    const T = themeNow();
    const color = fogColorOf(T, weather.tint);
    scene.fog = new THREE.Fog(color, 1, 2);
    fogRange(state.cur ? state.cur.fogShift : 0);
    ground.material.color.copy(groundColor(T)).lerp(color, 0.12);
  }
  /** 雾从哪开始、到哪全进雾：默认镜头到战场后沿的大致距离起雾；中景 / 近景镜头推近了，起雾的地方跟着挪近 shift（hd2d-camera.js · pose 的 fogShift；远景是 0）。
   *  算法在 hd2d-weather.js · fogRange（纯函数，测试也用它算每个区进了几成雾） */
  function fogRange(shift) {
    if (!scene.fog) return;
    const r = fogRangeOf(state.layout, shift, weather.tint, FOG.depth);
    scene.fog.near = r.near; scene.fog.far = r.far;
  }

  /* ---------- 铭牌（DOM，竖立，正面朝镜头）---------- */
  /** 铭牌的 HTML。只读 plate（layout 给的白名单数据，原型页交进来的是联机投影过的状态），没有坚毅生命。
   *  平时只有名字 + 状态小圆点 + 分层血条 + 架势；等级、ATK、血量数字、状态文字在悬停 / 选中时从头顶展开。
   *  近景里选中的区的铭牌换成放大的那张（.pl-big，CSS 的 .big）：名字 + 等级、血条 + 血量数字、架势 + ATK、状态文字，一眼都看得到 */
  function plateHtml(p) {
    const total = Math.max(1, p.hp.max);
    const segs = p.layers.slice().reverse().map(l =>     // 数组 0 是最外层，画在最右
      `<i style="width:${100 * l.max / total}%;background:linear-gradient(90deg,${LAYER_COLOR[l.type] || "#d8574a"} ${l.max ? 100 * l.cur / l.max : 0}%,#2a2520 0)"></i>`).join("");
    // 架势菱形：超过 n 个时紧凑版写成数字（text），放大版旁边本来就写着数字，就不画了
    const pips = (n, text) => {
      if (p.def.big || p.def.max > n) return text ? `<span class="n">◆${p.def.cur}${p.def.big ? "+" : "/" + p.def.max}</span>` : "";
      let s = "";
      for (let i = 0; i < p.def.max; i++) s += `<b class="${i < p.def.cur ? "on" : ""}"></b>`;
      return s;
    };
    const def = pips(PLATE.maxPips, true);
    const chips = p.statuses.map(s => ({ key: s.key, label: s.label })).concat(p.flags.map(f => ({ key: f.key, label: f.label })));
    const colorOf = (k) => k === "dying" ? "#d8322a" : k === "stunned" ? "#ff9a3c" : (STATUS_COLOR[k] || "#a8977b");
    const dots = chips.slice(0, PLATE.maxDots).map(c => `<i style="background:${colorOf(c.key)}"></i>`).join("");
    const more = chips.map(c => `<em style="background:${colorOf(c.key)}">${esc(c.label)}</em>`).join("");
    const tags = chips.length
      ? chips.slice(0, PLATE.bigChips).map(c => `<em style="background:${colorOf(c.key)}">${esc(c.label)}</em>`).join("") + (chips.length > PLATE.bigChips ? `<em class="pl-x">+${chips.length - PLATE.bigChips}</em>` : "")
      : `<span class="pl-none">无状态</span>`;
    const defText = `架势 ${p.def.cur}/${p.def.max}${p.def.big ? "+" : ""}`;
    // 行动点 / 附赠（#238，画法照 unit-card.js）：紧凑铭牌贴在卡片右上角，放大的写在名字那一行；HTML 在 hd2d-ui.js · econHtml
    const UIX = window.HD2DUI, econ = (big) => (UIX ? UIX.econHtml(p.econ, big) : ""), econText = UIX && p.econ ? `<span>${esc(UIX.econText(p.econ))}</span>` : "";
    return `<div class="pl-more" role="tooltip"><div class="pl-stats"><b>Lv${p.level}</b><span>ATK ${p.atk}</span><span>血量 ${p.hp.cur}/${p.hp.max}</span><span>${defText}</span>${econText}</div>${more ? `<div class="pl-chips">${more}</div>` : ""}</div>
      <div class="pl-big" data-hit tabindex="0" role="button" aria-label="${esc(p.name)}"><span class="pl-mark" aria-hidden="true"></span>
      <div class="pl-r1"><span class="pl-nm">${esc(p.name)}</span>${econ(true)}<span class="pl-lv">Lv${p.level}</span></div>
      <div class="pl-r2"><div class="pl-bar">${segs}</div><span class="pl-hp">${p.hp.cur}/${p.hp.max}</span></div>
      <div class="pl-r3"><span class="pl-def">${pips(PLATE.bigPips, false)}</span><span class="pl-dn">${defText}</span><span class="pl-atk">ATK ${p.atk}</span></div>
      <div class="pl-r4">${tags}</div></div>
      <div class="pl-card" data-hit tabindex="0" role="button" aria-label="${esc(p.name)}"><span class="pl-mark" aria-hidden="true"></span>${econ(false)}<span class="pl-name">${esc(p.name)}</span>
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
    const p = { id: u.id, el, inner: el.firstChild, bob: el.firstChild.firstChild, post: el.lastChild, label, core, soft, ripple, ring, pick, group, key: "", sc: 0, hover: false,
      lift: 0, liftFrom: 0, liftTo: 0, liftSet: false, big: false, dim: false, close: false, hide: false, zoom: 1 };
    // 悬停高亮、点击选中（只是画面，不接规则；顺便选中这个单位所在的区，近景看的就是它）。只有卡片接鼠标（铭牌其余部分、细杆都不拦）；
    // 滚轮冒泡到外面的容器，照样在三段镜头之间跳
    const onCard = (e) => e.target && e.target.hasAttribute && e.target.hasAttribute("data-hit");
    el.addEventListener("pointerenter", (e) => { if (onCard(e)) setHover(p, true); }, true);
    el.addEventListener("pointerleave", (e) => { if (onCard(e)) setHover(p, false); }, true);
    el.addEventListener("click", (e) => { if (!e.target.closest("[data-hit]")) return; e.stopPropagation(); select(state.selectedId === p.id ? null : p.id); });
    // 近景里双击铭牌：镜头推到这个单位面前特写（#237；远景 / 中景里双击就是点两下）
    el.addEventListener("dblclick", (e) => { if (!e.target.closest("[data-hit]")) return; e.stopPropagation(); closeUp(p.id); });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(state.selectedId === p.id ? null : p.id); }
      else if (e.key === "Escape") select(null);
    });
    return p;
  }
  /** 后排抬高（像素）：铭牌下面那根细杆的长度；换镜头时从上一段的高度插值到这一段的 */
  function setLift(p, lift) {
    lift = Math.max(0, lift || 0);
    if (p.liftSet && Math.abs(lift - p.lift) < 0.05) return;
    p.lift = lift; p.liftSet = true;
    p.post.style.height = lift.toFixed(1) + "px";
    p.el.classList.toggle("lifted", lift > 0.5);
  }
  function disposePlate(p) {
    scene.remove(p.group, p.core, p.soft, p.ripple, p.ring, p.pick);
    p.group.remove(p.label);                 // 触发 removed 事件，把 DOM 摘掉
    [p.core, p.soft, p.ring, p.pick].forEach(m => m.material.dispose());
    p.ripple.geometry.dispose(); p.ripple.material.dispose();
  }
  function setHover(p, on) { p.hover = on; markPlates(); }
  /** 选中一个单位（再点一下取消）；同时选中它所在的区（中景 / 近景跟过去） */
  function select(id) {
    state.selectedId = id; markPlates();
    const u = id != null && state.layout ? state.layout.units.find(x => x.id === id) : null;
    if (u && u.zone !== state.zone) setZone(u.zone);
  }
  function syncPlates() {
    const live = new Set();
    const size = state.layout.plateSize || L.plateSize(view()), big = L.plateSize(state.layout.view || view(), true);
    labels.domElement.style.setProperty("--pw", size.w + "px");
    labels.domElement.style.setProperty("--ph", size.h + "px");
    labels.domElement.style.setProperty("--bw", big.w + "px");   // 近景放大的铭牌（L.CONFIG.plate.big）
    labels.domElement.style.setProperty("--bh", big.h + "px");
    state.layout.units.forEach(u => {
      live.add(u.id);
      let p = state.plates.get(u.id);
      if (!p) { p = makePlate(u); state.plates.set(u.id, p); }
      const key = JSON.stringify(u.plate);
      if (key !== p.key) { p.key = key; p.bob.innerHTML = plateHtml(u.plate); }
      p.u = u;
      p.group.position.set(u.x, u.y, u.z);
      if (!p.liftSet) setLift(p, u.lift);   // 后排抬高：铭牌下面一根细杆连到脚下（每一段镜头的抬高在 goTo 里换）
      const g = u.groundY;
      p.core.position.set(u.x, g + 0.02, u.z); p.soft.position.set(u.x, g + 0.015, u.z);
      p.ripple.position.set(u.x, g + 0.03, u.z);
      p.ring.position.set(u.x, g + 0.04, u.z); p.pick.position.set(u.x, g + 0.035, u.z);
      p.ripple.visible = u.submerged;
      const air = u.flying ? 0.45 : u.submerged ? 0.3 : 1;     // 飞着的影子淡、小；下潜的几乎没有
      p.core.material.opacity = SHADOW.coreOpacity * air; p.soft.material.opacity = SHADOW.softOpacity * (u.flying ? 0.7 : air);
      p.core.scale.setScalar(SHADOW.core * (u.flying ? 0.8 : 1)); p.soft.scale.set(SHADOW.soft * 1.15, SHADOW.soft, 1);
      p.el.classList.toggle("foe", u.side === "foe");
      p.el.classList.toggle("sub", u.submerged);
      p.el.classList.toggle("dying", u.plate.flags.some(f => f.key === "dying"));
    });
    state.plates.forEach((p, id) => { if (!live.has(id)) { disposePlate(p); state.plates.delete(id); } });
    if (state.selectedId != null && !state.plates.has(state.selectedId)) state.selectedId = null;
    markPlates();
  }
  /** 当前行动 / 选中 / 悬停：铭牌加样式，脚下的光圈开关；悬停 / 选中的铭牌叠在最上面（CSS2DRenderer 按 renderOrder 先排）。
   *  近景：选中的区的铭牌放大（.big），别的区的变淡、糊掉（.dim）——按这一段镜头（state.pose.plates）定 */
  function markPlates() {
    state.plates.forEach(p => {
      const actor = p.id === state.actorId, sel = p.id === state.selectedId;
      const q = state.pose && state.pose.plates[p.id];
      p.big = !!(q && q.big); p.dim = !!(q && q.dim);
      // 特写（#237）：这个单位的铭牌再放大 zoom 倍、在最上面；别的压到它的藏起来
      p.close = !!(q && q.close); p.hide = !!(q && q.hide); p.zoom = q && q.zoom > 0 ? q.zoom : 1;
      p.el.classList.toggle("actor", actor); p.ring.visible = actor;
      p.el.classList.toggle("sel", sel); p.el.classList.toggle("hover", p.hover);
      p.el.classList.toggle("big", p.big); p.el.classList.toggle("dim", p.dim);
      p.el.classList.toggle("close", p.close); p.el.classList.toggle("hide", p.hide);
      p.pick.visible = sel || p.hover; p.pick.material.opacity = sel ? 0.9 : 0.45;
      p.label.renderOrder = p.close ? 4 : p.hover ? 3 : sel ? 2 : p.big ? 1 : 0;
    });
  }

  /* ---------- 战场 ---------- */
  function clearWorld() {
    if (state.world) { scene.remove(state.world); disposeTree(state.world); }
    state.world = null;
  }
  function setBattle(layout, meta) {
    state.layout = layout; state.meta = Object.assign({ weather: "none", theme: "day" }, meta || {});
    // 场景的光照（#242）：换成场景自己的那一套；矿底这种不分白天黑夜的，按它定的光影主题画（地台亮边、远景剪影、飘浮物都跟着）
    const lit = ART.lighting(THEMES, state.meta.theme, layout.ground);
    state.lit = lit ? lit.T : null;
    if (lit) state.meta.theme = lit.name;
    state.actorId = state.meta.actorId != null ? state.meta.actorId : state.actorId;
    const newBoard = !state.bounds || JSON.stringify(layout.bounds) !== JSON.stringify(state.bounds) || state.boardSig !== boardSig(layout);
    if (newBoard && state.boardSig) state.zone = null;   // 换了棋盘：选中的区回到当前行动单位所在的区（开场时用外面给的 camera.zone）
    if (newBoard || state.worldSig !== worldSig(layout)) {
      clearWorld();
      state.ctx = { anim: [], lamps: [], fxLights: 0, theme: state.meta.theme };
      const root = new THREE.Group();
      layout.zones.forEach(z => { const g = buildZone(z, state.ctx); g.userData.zoneId = z.id; root.add(g); });   // 点地台选区时按 zoneId 认
      layout.gaps.forEach(g => root.add(buildGap(g, state.ctx)));
      root.add(buildLamps(layout.lamps, state.ctx));   // 灯：战场外缘 0–2 盏（地台上不放）
      scene.add(root); state.world = root;
      state.worldSig = worldSig(layout);
    }
    state.boardSig = boardSig(layout);
    state.bounds = layout.bounds;
    const fx = ART.weather(layout.ground, state.meta.weather || "none").fx;   // 室内的场景（下水道）不画天上来的天气（#241，hd2d-scene-art.js · weather）
    const plan = weatherPlan(fx, state.meta.theme);   // 雷鸣：远景要画乌云
    const look = L.GROUNDS[layout.ground] || {};   // 远景跟着区域（沙漠 → 沙丘，采矿场 → 岩壁，城市 → 楼群）
    syncBackdrop(layout, state.meta.backdrop || look.backdrop || backdropOf(state.meta.theme), plan, look.skyline);
    // 天气：闪电从默认镜头的画面上沿外面劈下来；远处的雷劈在哪问远景
    weather.setBounds(layout.bounds, { camera: layout.camera, farPoint: state.backdrop.farPoint });
    weather.set(fx, state.meta.theme);
    syncPlates();
    // 特写的单位不在了（被打倒、藏起来）：退出特写，镜头平滑拉回正常的近景（#237）
    const wasClose = state.close, reset = newBoard || state.wantFit;
    state.close = C.camStep(camState(), { type: "units", ids: layout.units.map(u => u.id) }).close;
    applyTheme();
    fitShadow();
    fitCamera(reset);
    if (wasClose != null && state.close == null && !reset) goTo(state.tier, state.zone);
  }
  /** 区域认不得（布局给的地面主题没有远景）也没指定时，按光影主题猜 */
  const backdropOf = (theme) => theme === "night" ? "night" : theme === "dusk" ? "mine" : "wasteland";
  /** plan = 天气要建的东西（weatherPlan）：雷鸣时远景换成风暴色的天、画乌云，天边接上压暗了的雾色；
   *  沙暴时整片远景蒙上沙色（dust，天边也接上沙黄的雾色，#240）；skyline = 楼群的高度倍数 */
  function syncBackdrop(layout, kind, plan, skyline) {
    const c = layout.camera, storm = !!plan.storm, T = themeNow(), dust = dustOf(T, plan.tint);   // themeNow：场景有自己的光照（state.lit，#242）就用它
    const sig = [kind, skyline || 1, state.meta.theme, state.meta.weather || "none", storm ? "storm" : "", dust ? ["dust", dust.color, dust.sky, dust.haze, dust.veil, dust.sun].join(",") : "",
      Object.values(layout.bounds).map(v => Math.round(v)).join(","), c ? [c.dist, c.pos.y, c.pos.z].map(v => Math.round(v)).join(",") : ""].join("|");
    if (sig === state.backdropSig) return;
    state.backdropSig = sig;
    if (state.backdrop) { scene.remove(state.backdrop.group); state.backdrop.dispose(); }
    state.backdrop = buildBackdrop(kind, layout.bounds, state.meta.theme, c, { sky: T.sky, fog: storm || dust ? fogColorOf(T, plan.tint).getHex() : T.fog, weather: state.meta.weather || "none", storm, skyline, dust });
    scene.add(state.backdrop.group);
  }
  const boardSig = (l) => l.zones.map(z => [z.id, Math.round(z.cx * 10), Math.round(z.cz * 10)].join(",")).join(";");
  /** 不规则外轮廓的签名（#237：形状按棋盘 + 区号 + 区域定，换了区域要重建） */
  const outlineSig = (z) => (z.outline && z.outline.pts ? z.outline.pts.map(p => p.x.toFixed(2) + "," + p.z.toFixed(2)).join(" ") : "");
  const worldSig = (l) => boardSig(l) + "|" + (state.meta.theme || "") + "|" + l.zones.map(z => z.kind + z.effects.join("+") + z.h + (z.ground || "") + "/" + outlineSig(z)).join(";") + "|" + l.gaps.map(g => [g.key, g.type, g.open, g.maxHp ? Math.ceil((g.hp / g.maxHp) * 4) : 4].join(",")).join(";") +
    "|" + (l.lamps || []).map(p => [p.kind, Math.round(p.x * 10), Math.round(p.z * 10), p.color].join(",")).join(";");

  /* ---------- 镜头 ---------- */
  /** 现在的画面：给布局取景 / 算铭牌在屏幕上的位置用 */
  function view() {
    return { width: Math.max(1, container.clientWidth), height: Math.max(1, container.clientHeight), top: state.insets.top, bottom: state.insets.bottom };
  }
  /** 远景直接用布局算好的默认镜头（hd2d-layout.js 的 fitView，和铭牌的站位是同一个镜头），中景 / 近景按 hd2d-camera.js 算。
   *  reset = 把玩家转过的视角放回这一段的镜头（直接切过去）；不 reset 就只换这一段的铭牌抬高，镜头不动 */
  function fitCamera(reset) {
    const c = state.layout && state.layout.camera;
    if (!c) return;
    state.fit = c.dist;
    camera.far = Math.max(CAM.far, c.dist * 7); camera.updateProjectionMatrix();
    bokeh.uniforms.farClip.value = camera.far;
    goTo(state.tier, state.zone, reset || !state.cur ? { snap: true } : { keep: true });
    state.wantFit = false;
    applyFog();
  }

  /* ---------- 三段镜头（远景 / 中景 / 近景看单个区域）---------- */
  const now = () => performance.now() / 1000;
  /** 换到 tier 段、看 zone 区：算这一段的镜头（hd2d-camera.js · pose），从现在的镜头平滑过渡过去（减少动态效果 / snap：直接切过去）。
   *  铭牌放大 / 变淡马上换，抬高跟着镜头一起插值。keep = 镜头不动，只换铭牌（同一块棋盘重排了一次） */
  function goTo(tier, zone, opts) {
    opts = opts || {};
    if (!state.layout) return;
    if (opts.keep && state.tween && !state.tween.push) opts = {};   // 正在过渡：改成过渡到新算的这一段（攻击演出推镜头的过渡不打断）
    if (!opts.keep) state.pushBack = null;     // 玩家自己换了镜头：演出播完不再拉回推之前的位置
    // 特写（#237）：镜头推到那个单位面前（还算近景）；不然是这一段的镜头
    const to = (state.close != null && C.closePose(state.layout, state.close, { actorId: state.actorId })) || C.pose(state.layout, tier, zone, { actorId: state.actorId });
    if (to.close == null) state.close = null;
    state.tier = to.tier; state.zone = to.zone; state.pose = to;
    state.plates.forEach((p, id) => { const q = to.plates[id]; p.liftFrom = p.lift; p.liftTo = q ? q.lift : 0; });
    markPlates();
    placeFocus();
    if (opts.keep) {
      state.plates.forEach(p => setLift(p, p.liftTo));
    } else {
      // 起点 = 镜头现在实际在哪（玩家可能拖动过、可能正在过渡），景深 / 雾 / 裁剪面接着上一次的
      const from = C.poseFrom(camera.position, controls.target, camera.fov, state.cur || to);
      const tw = C.tween(from, to, { reduced: !!opts.snap || !state.motion });
      if (tw.duration > 0) {
        state.tween = Object.assign(tw, { t0: now() });
        controls.enabled = false;      // 过渡中不接拖动
        openLimits();
      } else {
        state.tween = null;
        applyPose(C.at(tw, 0));
        arrive();
      }
    }
    notify();
  }
  /** 把镜头摆成 p（位置、朝向、视野、近裁剪面；景深和雾每帧按 state.cur 设） */
  function applyPose(p) {
    state.cur = p;
    if (Math.abs(camera.fov - p.fov) > 1e-4 || Math.abs(camera.near - p.clip) > 1e-4) { camera.fov = p.fov; camera.near = p.clip; camera.updateProjectionMatrix(); }
    controls.target.set(p.target.x, p.target.y, p.target.z);
    camera.position.set(p.pos.x, p.pos.y, p.pos.z);
    camera.lookAt(controls.target);
  }
  /** 到了：铭牌抬高到位，拖动的范围换成这一段的（俯角 C.CAMERA[段].tilt，特写是 C.CAMERA.close.tilt；距离固定，滚轮不缩放），把拖动交还给玩家 */
  function arrive() {
    const p = state.pose, tilt = p.tilt || C.CAMERA[p.tier].tilt;
    state.plates.forEach(pl => setLift(pl, pl.liftTo));
    controls.minDistance = controls.maxDistance = p.dist;
    controls.minPolarAngle = THREE.MathUtils.degToRad(90 - tilt[1]);
    controls.maxPolarAngle = THREE.MathUtils.degToRad(90 - tilt[0]);
    controls.enabled = true;
  }
  /** 过渡中镜头由插值摆，先放开 OrbitControls 的限制（不然它会把镜头夹回上一段的范围） */
  function openLimits() {
    controls.minDistance = 0; controls.maxDistance = Infinity;
    controls.minPolarAngle = 0; controls.maxPolarAngle = Math.PI;
  }
  /** 镜头的状态（hd2d-camera.js · camStep 的输入）：哪一段、哪个区、特写谁 */
  const camState = () => ({ tier: state.tier, zone: state.zone, close: state.close });
  /** 状态机走一步以后：换到新的段 / 区 / 特写，平滑过渡过去 */
  function move(next) {
    state.close = next.close;
    goTo(next.tier, next.zone);
  }
  /** 换段（按钮、键盘 1 / 2 / 3）：特写时就退出特写（按 3、点「近」回到正常的近景） */
  function setTier(tier) { move(C.camStep(camState(), { type: "tier", tier: C.tierName(tier) })); }
  /** 选中一个区：远景里只挪选区的框；中景 / 近景镜头跟过去；特写时点同一个区不动，选了别的区就退出特写 */
  function setZone(id) {
    if (!state.layout || !state.layout.zones.some(z => z.id === Number(id))) return;
    if (state.tier === "far" && state.pose) {
      state.zone = Number(id);
      state.pose = C.pose(state.layout, "far", state.zone, { actorId: state.actorId });
      placeFocus(); notify();
      return;
    }
    if (state.close != null) {
      const next = C.camStep(camState(), { type: "zone", zone: Number(id) });
      if (next.close == null) move(next);
      return;
    }
    goTo(state.tier, Number(id));
  }
  /** 近景里双击一个单位（铭牌或者脚下的站位）：镜头推到它面前特写，顺便选中它（#237；远景 / 中景里不特写）。减少动态效果时直接切过去 */
  function closeUp(id) {
    const u = id != null && state.layout ? state.layout.units.find(x => x.id === id) : null;
    if (!u) return;
    const next = C.camStep(camState(), { type: "dblclick", unit: id, zone: u.zone });
    if (next.close == null) return;
    state.selectedId = id;
    move(next);
  }
  /** 换到相邻的区（左右键 / 屏幕箭头；顺序见 hd2d-camera.js · zoneOrder） */
  function stepZone(dir) {
    if (!state.layout) return;
    const n = C.neighborZone(state.layout, state.zone, dir);
    if (n != null) setZone(n);
  }
  /** 给外面的：现在是哪一段、看哪个区、左右是哪个区（到头是 null） */
  function cameraInfo() {
    const l = state.layout;
    if (!l) return { tier: state.tier, zone: state.zone, zones: [], tag: "", prev: null, next: null };
    const prev = C.neighborZone(l, state.zone, -1), next = C.neighborZone(l, state.zone, 1);
    const cu = state.close != null ? l.units.find(u => u.id === state.close) : null;   // 特写的单位（铭牌数据里的名字，没有坚毅生命）
    return {
      tier: state.tier, name: C.CAMERA[state.tier].name, zone: state.zone, zones: state.pose ? state.pose.zones.slice() : [], tag: C.zoneTag(l, state.zone),
      prev, next, prevTag: prev != null ? C.zoneTag(l, prev) : "", nextTag: next != null ? C.zoneTag(l, next) : "",
      close: cu ? cu.id : null, closeName: cu ? cu.plate.name : ""
    };
  }
  function notify() { if (options.onCameraChange) options.onCameraChange(cameraInfo()); }

  /** 选中的区：地台顶面靠边一圈细框（跟着不规则的外轮廓走：离边 inset、宽 width，#237） */
  let focusRing = null, focusKey = "";
  function placeFocus() {
    const z = state.layout && state.layout.zones.find(q => q.id === state.zone);
    if (!z) { if (focusRing) focusRing.visible = false; return; }
    const hw = z.w / 2, hd = z.d / 2;
    const pts = z.outline && z.outline.pts && z.outline.pts.length >= 3 ? z.outline.pts : [{ x: -hw, z: -hd }, { x: hw, z: -hd }, { x: hw, z: hd }, { x: -hw, z: hd }];
    const key = z.id + "|" + outlineSig(z);
    if (!focusRing || key !== focusKey) {
      const outer = L.offsetOutline(pts, FOCUS.inset), inner = L.offsetOutline(pts, FOCUS.inset + FOCUS.width);
      const shape = new THREE.Shape(), hole = new THREE.Path();
      outer.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z))); shape.closePath();   // 转 −90° 以后形状的 y = −z
      inner.forEach((p, i) => (i ? hole.lineTo(p.x, -p.z) : hole.moveTo(p.x, -p.z))); hole.closePath();
      shape.holes.push(hole);
      if (focusRing) { focusRing.geometry.dispose(); focusRing.geometry = new THREE.ShapeGeometry(shape); }
      else {
        focusRing = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({
          color: new THREE.Color(FOCUS.color).multiplyScalar(FOCUS.glow), transparent: true, opacity: FOCUS.opacity, depthWrite: false, toneMapped: false,
          polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
        }));
        focusRing.rotation.x = -Math.PI / 2; focusRing.renderOrder = 2;
        scene.add(focusRing);
      }
      focusKey = key;
    }
    focusRing.position.set(z.cx, z.topY + 0.025, z.cz);
    focusRing.visible = true;
  }

  // 滚轮：在远景 / 中景 / 近景之间跳，一次滚动只跳一段（往前滚拉近）；特写时往后滚回到正常的近景（#237）。铭牌上滚也一样（冒泡到这里）
  let wheelState = null;
  const onWheel = (e) => {
    e.preventDefault();
    const r = C.wheelStep(wheelState, C.wheelPixels(e), now());
    wheelState = r.state;
    if (r.step) move(C.camStep(camState(), { type: "wheel", step: r.step }));
  };
  container.addEventListener("wheel", onWheel, { passive: false });
  function fitShadow() {
    const b = state.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const r = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 3;
    sun.target.position.set(cx, 0, cz); rim.target.position.set(cx, 0, cz);
    const T = themeNow();
    sun.position.set(cx + T.sunPos[0], T.sunPos[1] + r * 0.4, cz + T.sunPos[2]);
    rim.position.set(cx + T.rimPos[0], T.rimPos[1], cz + T.rimPos[2]);
    const c = sun.shadow.camera; c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 1; c.far = 90; c.updateProjectionMatrix();
    // 地台外面那片地：矿坑的场景（#242）铺到坑边为止（远景给的 groundEdge），后面是往下的坑
    const edge = state.backdrop && state.backdrop.groundEdge;
    ground.position.x = cx; ground.position.z = edge != null ? edge + BACKDROP.ground.size / 2 : cz;
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
    const click = downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5;
    downAt = null;
    if (!click) return;
    // 点到地台（左键）：选中这个区，中景 / 近景跟过去（选中的单位不在这个区就取消）；点到空地：取消选中的单位
    const zid = e.button === 0 ? zoneAt(e) : null;
    if (zid != null) {
      const sel = state.selectedId != null && state.layout ? state.layout.units.find(u => u.id === state.selectedId) : null;
      if (sel && sel.zone !== zid) { state.selectedId = null; markPlates(); }
      setZone(zid);
    } else if (state.selectedId != null) select(null);
  });
  // 近景里双击地台上一个单位的站位（脚下）：特写它（#237；双击铭牌在铭牌上接）
  renderer.domElement.addEventListener("dblclick", (e) => {
    const hit = groundAt(e);
    if (hit && state.layout) closeUp(C.unitAt(state.layout, hit.zone, hit.point.x, hit.point.z));
  });
  /** 鼠标下面是哪个区的地台、点在哪（地台上的装饰、贴花也算；间隔、空地不算）：{ zone, point 世界坐标 } */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function groundAt(e) {
    if (!state.world) return null;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / Math.max(1, r.width) * 2 - 1, -((e.clientY - r.top) / Math.max(1, r.height)) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const zones = state.world.children.filter(o => o.userData.zoneId != null);
    for (const h of ray.intersectObjects(zones, true)) {
      for (let o = h.object; o; o = o.parent) if (o.userData.zoneId != null) return { zone: o.userData.zoneId, point: h.point };
    }
    return null;
  }
  function zoneAt(e) { const h = groundAt(e); return h ? h.zone : null; }

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
    const T = themeNow(), dim = weather.storm ? FLASH.dim : 1;
    hemi.intensity = T.hemi * dim + fl * FLASH.hemi; sun.intensity = T.sunI * dim + fl * FLASH.sun;
    renderer.toneMappingExposure = T.exposure * (1 + fl * FLASH.exposure);
    bloom.strength = T.bloom[0] + fl * FLASH.bloom;
    grade.uniforms.flash.value = fl * FLASH.white;
    heatPass.enabled = weather.heat > 0;
    heatPass.uniforms.time.value = animT;
    grade.uniforms.time.value = animT;
    updateLamps(T, dt);
    // 镜头：过渡中按时间插值（位置、朝向、视野、焦点、景深、雾一起走，铭牌的抬高也跟着）；到了以后交还给 OrbitControls（小幅转动 / 平移）
    if (state.tween) {
      controls.update();                   // 拖动留下的惯性在过渡期间衰减掉（不然到了以后镜头还会自己漂一下）；镜头马上被插值盖掉
      const p = C.at(state.tween, now() - state.tween.t0);
      applyPose(p);
      state.plates.forEach(pl => setLift(pl, pl.liftFrom + (pl.liftTo - pl.liftFrom) * p.k));
      if (p.k >= 1) { const pushed = state.tween.push; state.tween = null; if (!pushed) arrive(); }   // 推镜头推到了：等演出播完 poseRelease 拉回来再交还拖动
    } else {
      clampPan();
      controls.update();
    }
    // 铭牌：DOM 自己就正对镜头；这里管飞行的上下浮动、影子跟着缩放、行动光圈旋转，以及按远近缩放 / 变淡（近景里别的区再淡一截）
    const focus = camera.position.distanceTo(controls.target);
    state.plates.forEach(p => {
      const u = p.u;
      const bob = u.flying ? Math.sin(animT * 2 + u.x) * 0.1 : 0;
      p.group.position.y = u.y + bob;
      if (u.flying) p.soft.scale.x = SHADOW.soft * (1.15 - bob * 0.6);
      if (u.submerged) p.ripple.scale.setScalar(1.2 + ((animT * 0.6) % 1) * 0.5);
      if (p.ring.visible) { p.ring.rotation.z = animT * RING.spin; p.ring.scale.setScalar(1 + Math.sin(animT * 2.4) * RING.pulse); }
      const d = camera.position.distanceTo(p.group.position);
      const sc = L.plateScale({ pos: camera.position, dist: focus }, p.group.position) * p.zoom;   // 特写的那块再乘 zoom
      if (Math.abs(sc - p.sc) > 0.004) { p.sc = sc; p.inner.style.transform = "scale(" + sc.toFixed(3) + ")"; }
      const op = (1 - (1 - PLATE.fadeMin) * THREE.MathUtils.clamp((d - focus) / PLATE.fadeRange, 0, 1)) * (p.dim ? PLATE.dim : 1);
      p.el.style.opacity = u.submerged ? Math.min(op, 0.82).toFixed(2) : op.toFixed(2);
    });
    // 景深：焦点 = 镜头到它看的那一点 + 这一段的 shift（远景是战场中间，中景 / 近景对准选中的区）；糊多少按这一段的（C.CAMERA[段].dof）。
    // 远处的糊上限再乘天气的 dof（沙暴：远处看不清，#240；别的天气是 1）
    const cur = state.cur, D = cur ? cur.dof : DOF0, wt = weather.tint;
    bokeh.uniforms.focus.value = focus + (cur ? cur.dof.shift : 0);
    bokeh.uniforms.aperture.value = D.aperture; bokeh.uniforms.maxblur.value = D.maxblur;
    bokeh.uniforms.maxblurFar.value = T.dofFar * D.far * (wt && wt.dof > 0 ? wt.dof : 1);
    // 近景：焦点区左右两边再按横着离开多远糊一层——焦点区中心换到镜头空间的横坐标
    bokeh.uniforms.lateral.value = D.lateral || 0;
    if (D.lateral > 0) {
      camera.updateMatrixWorld();
      focusV.set(D.cx, D.cy, D.cz).applyMatrix4(camera.matrixWorldInverse);
      bokeh.uniforms.focusX.value = focusV.x; bokeh.uniforms.focusHalf.value = D.half;
      bokeh.uniforms.tanHalf.value = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    }
    fogRange(cur ? cur.fogShift : 0);
    if (focusRing && focusRing.visible) focusRing.material.opacity = FOCUS.opacity + (moving ? Math.sin(animT * FOCUS.speed) * FOCUS.pulse : 0);
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
    get tier() { return state.tier; },
    get zone() { return state.zone; },
    get close() { return state.close; },
    closeUp,
    setBattle, resize, view, renderer, camera, controls, scene,
    setInsets(ins) { state.insets = { top: ins.top || 0, bottom: ins.bottom || 0 }; },
    refit() { state.wantFit = true; fitCamera(true); },
    /** 换当前行动单位：中景 / 近景跟到他所在的区 */
    setActor(id) {
      state.actorId = id; markPlates();
      const u = state.layout ? state.layout.units.find(x => x.id === id) : null;
      if (u && u.zone !== state.zone) setZone(u.zone);
    },
    select, setTier, setZone, stepZone, cameraInfo,
    stepTier(dir) { setTier(C.stepTier(state.tier, dir)); },
    /** 沙暴的风（世界里的方向 { x, z }，hd2d-wfx.js · windOf）：3D 的沙粒、拖影、大团沙尘顺着它飞（#240） */
    setWind(w) { weather.setWind(w); },
    /** 这一帧雷击的闪光（0–1，减少动态效果时已经减弱过）：天气的 2D 层跟着淡掉，不把闪白压暗一块（#240） */
    get flash() { return weather.flash; },
    /** 攻击演出的适配器（hd2d-fx.js · adapter）问的：这一刻的镜头、一块铭牌现在在哪（抬多高、是不是近景放大的那张）、一个区的地台 */
    lensNow() {
      return { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov, width: Math.max(1, container.clientWidth), height: Math.max(1, container.clientHeight) };
    },
    plateOf(id) {
      const p = state.plates.get(id);
      if (!p || !p.u) return null;
      const g = p.group.position;
      return { x: g.x, y: g.y, z: g.z, lift: p.lift, big: p.big, zoom: p.zoom, hide: p.hide, zone: p.u.zone };
    },
    zoneOf(id) { return state.layout ? state.layout.zones.find(z => z.id === Number(id)) || null : null; },
    /** 这一刻的镜头（hd2d-camera.js · poseFrom：玩家拖动过的也算），带上这一段是远 / 中 / 近（推镜头只推远景 / 中景） */
    poseNow() {
      return Object.assign(C.poseFrom(camera.position, controls.target, camera.fov, state.cur || state.pose), { tier: state.tier });
    },
    /** 出手时镜头稍微推一下（p = hd2d-fx.js · pushPose 算的）：secs 秒过渡过去，过渡中、推着的时候不接拖动；段和选中的区不变。
     *  第一次推之前记下现在的位置，poseRelease 拉回这里（玩家原来选的这一段、拖动过的也回到拖动过的地方）。减少动态效果时外面不会叫它 */
    posePush(p, secs) {
      if (!state.layout || !p) return;
      const from = C.poseFrom(camera.position, controls.target, camera.fov, state.cur || state.pose);
      if (!state.pushBack) state.pushBack = Object.assign({}, from, { k: 1 });
      state.plates.forEach(pl => { pl.liftFrom = pl.lift; });   // 过渡里铭牌的抬高照常插值：从现在的高度接着走，不跳回上一次换段的起点
      state.tween = { from, to: p, duration: Math.max(0, secs || 0), ease: p.ease || "inOutCubic", push: true, t0: now() };
      controls.enabled = false;
      openLimits();
    },
    /** 演出播完：拉回推之前的位置（secs 秒；玩家中途自己换了镜头就不拉），到了交还拖动 */
    poseRelease(secs) {
      const back = state.pushBack;
      state.pushBack = null;
      if (!back || !state.layout) return;
      const from = C.poseFrom(camera.position, controls.target, camera.fov, state.cur || state.pose);
      state.plates.forEach(pl => { pl.liftFrom = pl.lift; });
      state.tween = { from, to: back, duration: Math.max(0, secs || 0), ease: "inOutCubic", t0: now() };
      if (!(state.tween.duration > 0)) { state.tween = null; applyPose(Object.assign({}, back, { k: 1 })); arrive(); }
    },
    dispose() {
      disposed = true; cancelAnimationFrame(raf); ro.disconnect(); container.removeEventListener("wheel", onWheel);
      state.plates.forEach(disposePlate); clearWorld(); weather.dispose();
      if (state.backdrop) { scene.remove(state.backdrop.group); state.backdrop.dispose(); }
      if (focusRing) { scene.remove(focusRing); focusRing.geometry.dispose(); focusRing.material.dispose(); }
      Object.values(tex).forEach(t => t.dispose()); shadowGeo.dispose(); ringGeo.dispose();
      labels.domElement.remove();
      composer.dispose(); controls.dispose(); renderer.dispose(); renderer.domElement.remove();
    }
  };
}
