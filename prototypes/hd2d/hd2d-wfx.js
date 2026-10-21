/* Antlerscale: Backfire · HD-2D 战场原型 · 天气的 2D 层（#240）
 *
 * 主人试玩反馈：「沙暴天现在还没有之前的天气效果明显。可以把两者结合一下，保留之前的战场画面特效直接套用在新的画面上面」。
 * 正式战斗画面的天气动效（weather-fx.css 的 .wfx-{天气} 叠加层 + weather-fx.js 的 WeatherFx.sync）原样搬过来，
 * 当成一层压在 3D 画面上面、铭牌和界面面板下面的 2D 层（.hd2d-wfx，放在 #stage 里）。画法一行不另写，这里只管：
 *   - 这一刻叠哪一层（plan）：只读联机投影过的战斗状态（pv.weather / pv.sandDir / pv.phaseStep / pv.light），不碰坚毅生命
 *   - 风往屏幕哪边吹：规则的 state.sandDir 是棋盘上的方向（engine.js · SAND_WIND_VEC）；竖屏时棋盘整块转了 90°（hd2d-layout.js · build），
 *     所以先换成 3D 世界里的风（windOf：3D 的沙粒跟着它飞），再看它在屏幕上往哪边吹（screenDir：给 weather-fx 的 data-sand-dir），两边一个方向
 *   - 夜晚：光影是傍晚 / 夜晚时用 weather-fx.css 的夜晚样子（和正式画面一样：规则上的夜晚 = 傍晚 + 夜晚，daylight.js）
 *   - 三段镜头：远景淡一点，近景 / 特写稍微加强、放大一点，像身处其中（WFX.tier）
 *   - 和 3D 场景已有的天气不重复、不打架（WFX.weather）：
 *       雷鸣：3D 已经有乌云和雷击（hd2d-weather.js · STORM），2D 层只留暗色的云影和紫调，不再自己打闪电、闪区域（weather-fx.js 的 strikes: false）；
 *             3D 打雷闪白的那一下 2D 层跟着淡掉（不然暗色的云影把闪白压暗一块）。雷鸣照旧不下雨（2D 的雷鸣本来就没有雨）
 *       酸雨：雨丝是 3D 的；2D 的涟漪落在地台顶面上（rippleAt：按这一刻的镜头投到屏幕上，weather-fx.js 的 spot），按俯角压扁、越近越大，不飘在天上；
 *             近景 / 特写只落在看的那个区（别的区被景深糊掉了）
 *       雪 / 酷暑 / 微光 / 相位：3D 是场景里的粒子（雪花、火星、光点），2D 是贴着画面的那一层（前景的雪、底下升腾的热浪、四角的光晕、谐波雾带），一前一后
 * 3D 那边配合的（沙暴的雾更浓更黄、远景蒙上沙色、远处景深更糊、沙粒顺着风横飞）在 hd2d-weather.js 的 WEATHER.sand 和 hd2d-scene.js。
 *
 *   const plan = HD2DWfx.plan({ weather, theme, sandDir, phaseStep, portrait, tier, close, zone, reduced });   // 纯函数，Node 里 require 来测
 *   const wfx = HD2DWfx.create(stage, { lens, view, flash });   // 页面用：在 #stage 里放 2D 层。lens() = 这一刻投影用的镜头（hd2d-fx.js · lens），
 *                                                               // view() = 画面大小和上下被界面盖住的像素，flash() = 3D 雷击的闪光 0–1（sc.flash）
 *   wfx.sync({ … 同上, layout });     // 天气 / 光影 / 镜头变了就叫一次（WeatherFx.sync 本来就是幂等的）；layout = 布局（酸雨的涟漪落在它的地台上）
 * 「减少动态效果」照 weather-fx 现有的处理（weather-fx.css 的媒体查询、weather-fx.js 不生成涟漪）；换段时 2D 层也不渐变。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root, require("./hd2d-layout.js"), require("./hd2d-camera.js"));
  else root.HD2DWfx = factory(root, root.HD2DLayout, root.HD2DCamera);
})(typeof self !== "undefined" ? self : globalThis, function (root, L, C) {
  "use strict";

  /* ---------- 配置（数值都在这里，逻辑里不写死）---------- */
  const WFX = {
    /* 2D 层叠在哪（#stage 里的 z-index）：0 = 3D 画布之上、铭牌（.hd2d-labels，z 1）之下，铭牌照常看得清；
     * 改成 2 就连铭牌一起盖住（像正式画面的单位卡）。界面面板、攻击演出、伤害数字都在 #stage 外面，永远在它上面 */
    z: 0,
    /* 光影 → 用不用 weather-fx.css 的夜晚样子（.g-app.is-night .wfx-…：沙暴更暗更淡、酸雨的涟漪更亮）。
     * 和正式画面一样：规则上的夜晚 = 傍晚 + 夜晚（daylight.js · isNight；game.js · applyEnv 的 is-night） */
    night: { day: false, dusk: true, night: true },
    /* 风向（state.sandDir）→ 棋盘上的方向 [x, y]（x 向右、y 向下）：和规则 engine.js · SAND_WIND_VEC 一样，认不得的按 "12" */
    wind: { "12": [1, 0], E: [1, 0], "21": [-1, 0], W: [-1, 0], S: [0, 1], N: [0, -1] },
    /* 三段镜头下 2D 层多强：o 整层的不透明度、s 从画面中间放大多少（沙雾一团团、雪花、云影更大、更近，像身处其中）；close = 近景里双击单位的特写 */
    tier: { far: { o: 0.85, s: 1 }, mid: { o: 0.92, s: 1.06 }, near: { o: 1, s: 1.14 }, close: { o: 1, s: 1.22 } },
    /* 换段时 2D 层渐变多久（秒，和镜头过渡 hd2d-camera.js · CAMERA.transition 一样长；减少动态效果时不渐变） */
    fade: 0.5,
    /* 每种天气：on 叠不叠 2D 层；scale 跟不跟三段镜头放大（酷暑的热浪贴着画面底边升起来、微光的光晕贴着四角、酸雨的涟漪要落在地台上，都不放大）；
     * strikes: false = weather-fx.js 不自己打闪电 / 区域闪光（3D 场景有雷击）；flash = 3D 打雷闪白时 2D 层跟着淡掉多少（× 闪光 0–1）；
     * ripples = 酸雨的涟漪落在地台顶面上（rippleAt） */
    weather: {
      sand: { on: true, scale: true },
      snow: { on: true, scale: true },
      acid: { on: true, scale: false, ripples: true },
      thunder: { on: true, scale: true, strikes: false, flash: 0.85 },
      heat: { on: true, scale: false },
      glow: { on: true, scale: false },
      phase: { on: true, scale: true }
    },
    /* 酸雨的涟漪：在地台顶面上离外轮廓至少 inset、离深渊的洞口至少 hole（世界单位）；挑 tries 次都落在画面外 / 界面底下就这一下不落；
     * 按镜头俯角压扁（高 × sin 俯角，夹在 squash 里：地上的一圈斜着看是扁的）；size = 每一段放大多少（越近地面在屏幕上越大，涟漪跟着大）；
     * focus = 这几段只落在看的那个区（近景 / 特写里别的区被景深糊掉了，2D 的涟漪糊不到，落在上面一清二楚反而不对） */
    ripple: { inset: 0.6, hole: 0.35, tries: 8, squash: [0.25, 1], size: { far: 1, mid: 1.3, near: 1.7, close: 2 }, focus: { near: true, close: true } }
  };
  const D2R = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- 风向 ---------- */
  /** 风向 → 3D 世界里的风（单位向量 { x, z }：x 向右、z 朝镜头）。棋盘 → 世界和 hd2d-layout.js · build 一样：
   *  横屏 棋盘 x → 世界 x、棋盘 y → 世界 z；竖屏整块转 90°：棋盘 y → 世界 x、棋盘 x → 世界 −z */
  function windOf(sandDir, portrait) {
    const v = WFX.wind[sandDir] || WFX.wind["12"];
    return portrait ? { x: v[1], z: 0 - v[0] } : { x: v[0], z: v[1] };
  }
  /** 3D 的风在屏幕上往哪边吹（镜头正对 −z 看：世界 +x = 屏幕右，+z = 朝镜头 = 屏幕下）→ weather-fx 的 data-sand-dir：E 往右 / W 往左 / S 往下 / N 往上 */
  function screenDir(w) {
    if (!w) return "E";
    return Math.abs(w.x) >= Math.abs(w.z) ? (w.x >= 0 ? "E" : "W") : (w.z > 0 ? "S" : "N");
  }
  /** 这一段镜头的俯角（度）：远景是布局的默认镜头，中景 / 近景 / 特写在 hd2d-camera.js 的 CAMERA */
  function elevationOf(tier) {
    const T = C && C.CAMERA ? (tier === "close" ? C.CAMERA.close : C.CAMERA[tier]) : null;
    return T && Number.isFinite(T.elevation) ? T.elevation : L.CONFIG.camera.elevation;
  }

  /* ---------- 这一刻叠哪一层 ---------- */
  /**
   * s = { weather, theme（day / dusk / night）, sandDir, phaseStep, portrait, tier（far / mid / near）, close（特写中）, zone（看的那个区）, reduced（减少动态效果）}
   * 返回 { weather 交给 WeatherFx.sync 的天气（不叠 2D 层的是 "none"）, night 用夜晚样子, sandDir 屏幕上的风向（沙暴才有）, phaseStep,
   *        tier 这一段（特写是 close）, opacity / scale 这一段的强弱, fade 换段渐变的秒数,
   *        strikes weather-fx.js 自己打不打闪电, flash 打雷闪白时淡掉多少, ripples 涟漪落在地台上, squash / rippleScale 涟漪压扁 / 放大多少,
   *        rippleZones 涟漪只落在这几个区（null = 哪个区都行） }
   */
  function plan(s) {
    s = s || {};
    const w = s.weather && s.weather !== "none" ? String(s.weather) : "none";
    const cfg = WFX.weather[w] || null, on = !!(cfg && cfg.on);
    const tier = s.close ? "close" : (WFX.tier[s.tier] ? s.tier : "far"), T = WFX.tier[tier], R = WFX.ripple;
    return {
      weather: on ? w : "none",
      night: !!WFX.night[s.theme],
      sandDir: on && w === "sand" ? screenDir(windOf(s.sandDir, !!s.portrait)) : "",
      phaseStep: s.phaseStep,
      tier, opacity: on ? T.o : 1, scale: on && cfg.scale ? T.s : 1,
      fade: s.reduced ? 0 : WFX.fade,
      strikes: !(on && cfg.strikes === false),
      flash: on && cfg.flash > 0 ? cfg.flash : 0,
      ripples: on && !!cfg.ripples,
      squash: clamp(Math.sin(elevationOf(tier) * D2R), R.squash[0], R.squash[1]),
      rippleScale: R.size[tier] || 1,
      rippleZones: R.focus[tier] && s.zone != null ? [Number(s.zone)] : null
    };
  }

  /** 酸雨的一个涟漪落在哪（叠加层里的百分比 { x, y }）：随机挑一个区、在它的地台顶面上随机挑一点（离不规则的外轮廓至少 inset，深渊的洞口让开），
   *  按这一刻的镜头投到屏幕上；落在画面外或者顶栏 / 技能栏底下就再挑，挑 tries 次都不行这一下不落（null）。
   *  cam = 投影用的镜头（hd2d-fx.js · lens(sc.lensNow())，和布局的 L.project 同一种）；view = { top, bottom } 上下被界面盖住的像素；
   *  only = 只落在这几个区（plan 的 rippleZones；不给 = 哪个区都行） */
  function rippleAt(layout, cam, rand, view, only) {
    const R = WFX.ripple, zones = ((layout && layout.zones) || []).filter(z => !only || only.includes(z.id));
    if (!cam || !zones.length) return null;
    rand = rand || Math.random;
    const W = cam.width, H = cam.height, top = (view && view.top) || 0, bottom = (view && view.bottom) || 0;
    for (let i = 0; i < R.tries; i++) {
      const z = zones[Math.min(zones.length - 1, Math.floor(rand() * zones.length))];
      const lx = (rand() - 0.5) * z.w, lz = (rand() - 0.5) * z.d;
      const pts = z.outline && z.outline.pts && z.outline.pts.length >= 3 ? z.outline.pts : null;
      if (pts ? L.outlineDist(pts, lx, lz) < R.inset : Math.abs(lx) > z.w / 2 - R.inset || Math.abs(lz) > z.d / 2 - R.inset) continue;
      if (z.hole > 0 && Math.hypot(lx, lz) < z.hole + R.hole) continue;
      const s = L.project(cam, { x: z.cx + lx, y: z.topY, z: z.cz + lz });
      if (!(s.depth > 0) || s.x < 0 || s.x > W || s.y < top || s.y > H - bottom) continue;
      return { x: s.x / W * 100, y: s.y / H * 100 };
    }
    return null;
  }

  /* ---------- 页面用：在 #stage 里放 2D 层 ---------- */
  /** stage = #stage（3D 画布和铭牌层都在里面）；opts = { lens(), view(), flash(), random }（见文件头）。返回 { host, sync(s), plan（上一次的）, dispose() } */
  function create(stage, opts) {
    opts = opts || {};
    const doc = stage.ownerDocument || root.document;
    const host = doc.createElement("div");
    host.className = "hd2d-wfx";
    host.setAttribute("aria-hidden", "true");
    host.style.zIndex = String(WFX.z);
    stage.appendChild(host);
    let last = null, layout = null, raf = 0, flashNow = -1;
    const spot = () => rippleAt(layout, opts.lens ? opts.lens() : null, opts.random, opts.view ? opts.view() : null, last && last.rippleZones);
    function sync(s) {
      const p = plan(s), WF = root.WeatherFx;
      last = p;
      if (s && s.layout) layout = s.layout;
      // weather-fx.css 的夜晚样子写在 .g-app.is-night .wfx-… 上（正式画面的 #g-app）：这一层也带上这两个 class。
      // 不写 data-weather，所以 weather-fx.css 里给正式画面面板换色的 .g-app[data-weather=…] 那些规则一条都不会套到原型上
      host.classList.toggle("g-app", p.night);
      host.classList.toggle("is-night", p.night);
      host.style.setProperty("--wfx-o", String(p.opacity));
      host.style.setProperty("--wfx-s", String(p.scale));
      host.style.setProperty("--wfx-t", p.fade + "s");
      host.style.setProperty("--wfx-sq", p.squash.toFixed(3));     // 酸雨的涟漪按俯角压扁、按远近放大（hd2d.css 的 .wfx-acid b）
      host.style.setProperty("--wfx-rs", String(p.rippleScale));
      if (WF) WF.sync({ field: host, weather: p.weather, sandDir: p.sandDir, phaseStep: p.phaseStep, strikes: p.strikes, spot: p.ripples ? spot : null });
      watchFlash(p.flash > 0);
      return p;
    }
    /** 雷鸣：3D 打雷闪白的那一下，2D 层跟着淡掉（--wfx-flash）。只在要淡的天气里每帧读 opts.flash()（场景的 sc.flash，减少动态效果时那边已经减弱过） */
    function watchFlash(on) {
      const raf0 = root.requestAnimationFrame, caf = root.cancelAnimationFrame;
      if (on && !raf && opts.flash && raf0) {
        const tick = () => { raf = raf0(tick); setFlash(opts.flash() * (last ? last.flash : 0)); };
        raf = raf0(tick);
      } else if (!on && raf) {
        if (caf) caf(raf);
        raf = 0;
      }
      if (!on) setFlash(0);
    }
    function setFlash(v) {
      v = clamp(Number(v) || 0, 0, 1);
      if (Math.abs(v - flashNow) < 0.004) return;
      flashNow = v;
      host.style.setProperty("--wfx-flash", v.toFixed(3));
    }
    return {
      host, sync,
      get plan() { return last; },
      dispose() { watchFlash(false); if (root.WeatherFx) root.WeatherFx.sync({ field: host, weather: "none" }); host.remove(); }
    };
  }

  return { WFX, windOf, screenDir, elevationOf, plan, rippleAt, create };
});
