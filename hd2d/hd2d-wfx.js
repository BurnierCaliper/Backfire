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
 *   - 室内的场景（下水道，#241）不叠天上来的天气：sync 先问区域场景的美术这个场景换成哪种（indoor → hd2d-scene-art.js · weather）
 * 3D 那边配合的（沙暴的雾更浓更黄、远景蒙上沙色、远处景深更糊、沙粒顺着风横飞）在 hd2d-weather.js 的 WEATHER.sand 和 hd2d-scene.js。
 * #251（主人试玩反馈 · 三续：「沙暴还不够明显——要有旧画面那种翻滚的大团沙雾」）：正式画面的沙雾套上来以后和沙地、沙暴的雾几乎一个颜色，看不见。
 * 沙暴时 2D 层里再铺一层原型自己的沙雾（.hd2d-sand：整层蒙的、远处更浓的一层、一团团顺着风飘过的，见 sandOf / hazeAt / sandPuffs），
 * 正式画面那两层大沙雾也换成更深、更浑的棕灰（行内变量，画法照旧）。数值都在 WFX.sand，样子在 hd2d.css；weather-fx.css / weather-fx.js 一行没改。
 *
 *   const plan = HD2DWfx.plan({ weather, theme, sandDir, phaseStep, portrait, tier, close, zone, reduced });   // 纯函数，Node 里 require 来测
 *   const wfx = HD2DWfx.create(stage, { lens, view, flash });   // 页面用：在 #stage 里放 2D 层。lens() = 这一刻投影用的镜头（hd2d-fx.js · lens），
 *                                                               // view() = 画面大小和上下被界面盖住的像素，flash() = 3D 雷击的闪光 0–1（sc.flash）
 *   wfx.sync({ … 同上, layout });     // 天气 / 光影 / 镜头变了就叫一次（WeatherFx.sync 本来就是幂等的）；layout = 布局（酸雨的涟漪落在它的地台上）
 * 「减少动态效果」照 weather-fx 现有的处理（weather-fx.css 的媒体查询、weather-fx.js 不生成涟漪）；换段时 2D 层也不渐变；
 *  沙暴的沙雾不飘，停在各自的位置上照样蒙着（2D 层带上 .still，hd2d.css 另有媒体查询）。 */
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
    ripple: { inset: 0.6, hole: 0.35, tries: 8, squash: [0.25, 1], size: { far: 1, mid: 1.3, near: 1.7, close: 2 }, focus: { near: true, close: true } },
    /* 沙暴的 2D 沙雾（#251，主人试玩反馈 · 三续：「沙暴还不够明显——要有旧画面那种翻滚的大团沙雾」）。
     * 旧画面（game.html）的沙雾画在浅灰的战场上，一团团棕黄一眼就看得出；套到原型上以后画在沙黄的 3D 画面上，颜色（214, 164, 96）和沙地
     * （地台的沙 #d0aa6c）、白天沙暴的雾色（#d1a15e）亮度只差两三个百分点，就看不见了。下面全是原型自己的，weather-fx.css / weather-fx.js 一行没改：
     *   gust     正式画面那两层一阵阵卷过去的大沙雾（.wfx-sand i）：画法照旧，颜色换成比沙地更深、更浑的棕灰（行内的 --sand / --sand2，盖过 weather-fx.css 的），
     *            最浓到 peak（第二层 weather-fx.css 再 × 0.75）；still = 减少动态效果时停住的那两层多浓（正式画面停住只留 0.15，看不出是沙暴）
     *   color    原型自己那层（.hd2d-sand）的颜色，按光影：puff 一团团沙雾（两种色调，一团一团交替）、veil 整层蒙的、deep 远处压的（[r, g, b]）
     *   puffs    一团团沙雾分两层——far 远处那层：横风时在画面上半截（画面上沿就是最远的地方），小一点、浓一点、飘得慢；
     *            near 近处那层：整个画面都有，大、淡一点、飘得快。n 几团；w / h 宽高（vmax：按画面长的那一边量，横竖屏都是横着的一团）、
     *            o 最浓多少、t 飘过一趟几秒，都在范围里随机；cross 横风时团的中心在画面哪一截高度（竖风时横向随便放）
     *   approach 风朝镜头吹（屏幕上往下，S）时一团团从远处飘近、越来越大：飘进来时 × [0]、飘出去时 × [1]（往远处吹 N 反过来，横风不变）
     *   tier     三段镜头（特写是 close）：veil 整层蒙多浓；deep 远处那一层多浓，往下到 at 处还剩 mid 成、到 to 处淡到 0（画面高度的比例）；
     *            zoom 一团团放大多少。远景整体最浑、看不清远处；越近沙团越大，近景从眼前飘过
     *   core     一团沙雾的框里看得出是雾的那一块占几成（hd2d.css 的 .puff 渐变到这里还有三成浓）
     *   min      下限（测试按它核对，调数值别低于它）：count 至少几团；cover 看得出的那一块至少盖住半个地台（× 地台在屏幕上的宽 / 高）；
     *            opacity 每团最浓至少多少（远处那层要挡住远处，近处那层半透明）；deep 画面上沿（最远的地方）至少多浓；still 减少动态效果时停住的大沙雾至少多浓 */
    sand: {
      gust: {
        day: { sand: [148, 118, 88], sand2: [118, 96, 76], peak: 0.75 },
        dusk: { sand: [140, 102, 86], sand2: [116, 82, 72], peak: 0.7 },
        night: { sand: [82, 72, 62], sand2: [66, 58, 52], peak: 0.65 },
        still: 0.4
      },
      color: {
        day: { puff: [[138, 112, 86], [112, 92, 74]], veil: [160, 134, 106], deep: [150, 122, 92] },
        dusk: { puff: [[136, 100, 88], [108, 80, 74]], veil: [156, 116, 100], deep: [144, 104, 88] },
        night: { puff: [[84, 74, 64], [66, 58, 52]], veil: [88, 78, 68], deep: [80, 70, 60] }
      },
      puffs: {
        far: { n: 4, w: [44, 60], h: [21, 29], o: [0.46, 0.58], t: [18, 26], cross: [0.05, 0.42] },
        near: { n: 3, w: [62, 92], h: [28, 42], o: [0.3, 0.4], t: [9, 14], cross: [0.2, 0.92] }
      },
      approach: [0.7, 1.35],
      tier: {
        far: { veil: 0.12, deep: 0.56, at: 0.24, mid: 0.6, to: 0.6, zoom: 1 },
        mid: { veil: 0.09, deep: 0.54, at: 0.22, mid: 0.58, to: 0.54, zoom: 1.25 },
        near: { veil: 0.06, deep: 0.52, at: 0.2, mid: 0.55, to: 0.46, zoom: 1.6 },
        close: { veil: 0.05, deep: 0.5, at: 0.18, mid: 0.5, to: 0.42, zoom: 2 }
      },
      core: 0.6,
      min: { count: 6, cover: 0.5, opacity: { far: 0.45, near: 0.3 }, deep: 0.5, still: 0.3 }
    }
  };
  const D2R = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rgb = (c) => c.join(", ");                   // [r, g, b] → "r, g, b"（hd2d.css 里拼成 rgba(var(--c), …)）
  const pct = (v) => (v * 100).toFixed(2) + "%";

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
   *        tier 这一段（特写是 close）, opacity / scale 这一段的强弱, fade 换段渐变的秒数, still 减少动态效果（2D 层带上 .still）,
   *        strikes weather-fx.js 自己打不打闪电, flash 打雷闪白时淡掉多少, ripples 涟漪落在地台上, squash / rippleScale 涟漪压扁 / 放大多少,
   *        rippleZones 涟漪只落在这几个区（null = 哪个区都行）, sand 沙暴的 2D 沙雾这一刻的样子（sandOf；不是沙暴是 null） }
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
      still: !!s.reduced,
      strikes: !(on && cfg.strikes === false),
      flash: on && cfg.flash > 0 ? cfg.flash : 0,
      ripples: on && !!cfg.ripples,
      squash: clamp(Math.sin(elevationOf(tier) * D2R), R.squash[0], R.squash[1]),
      rippleScale: R.size[tier] || 1,
      rippleZones: R.focus[tier] && s.zone != null ? [Number(s.zone)] : null,
      sand: on && w === "sand" ? sandOf(s.theme, tier) : null
    };
  }

  /* ---------- 沙暴的 2D 沙雾（#251）---------- */
  /** 这一刻的样子（纯数据，plan 的 sand）：theme 按光影挑颜色（认不得的按白天），tier = 这一段（特写是 close）。颜色都是 "r, g, b"。
   *  返回 { theme, gust: { sand, sand2, peak, still }（正式画面那两层的行内变量）, veil: { c, o }（整层蒙的）, deep: { c, o, at, mid, to }（远处那一层）,
   *        zoom（一团团放大多少）, colors（一团团的两种色调）} */
  function sandOf(theme, tier) {
    const S = WFX.sand, th = S.color[theme] ? theme : "day", G = S.gust[th], K = S.color[th], T = S.tier[tier] || S.tier.far;
    return {
      theme: th,
      gust: { sand: rgb(G.sand), sand2: rgb(G.sand2), peak: G.peak, still: S.gust.still },
      veil: { c: rgb(K.veil), o: T.veil },
      deep: { c: rgb(K.deep), o: T.deep, at: T.at, mid: T.mid, to: T.to },
      zoom: T.zoom,
      colors: K.puff.map(rgb)
    };
  }
  /** 画面高度 y 处（0 = 上沿 = 最远，1 = 下沿 = 最近）整层的沙雾多浓：veil 和 deep 叠起来。和 hd2d.css 的 .veil / .deep 同一套数
   *  （deep 的渐变：上沿 1 → at 处 mid → to 处 0，再乘 deep 的不透明度）；sand = sandOf 的 */
  function hazeAt(sand, y) {
    if (!sand) return 0;
    const d = sand.deep;
    const k = y <= 0 ? 1 : y < d.at ? 1 + (d.mid - 1) * y / d.at : y < d.to ? d.mid * (1 - (y - d.at) / (d.to - d.at)) : 0;
    return 1 - (1 - sand.veil.o) * (1 - d.o * k);
  }
  /** 一团团沙雾放在哪（纯函数；rand 不给用 Math.random）：dir = 屏幕上的风向（plan 的 sandDir：E / W / S / N），aspect = 画面宽 / 高（不给按 16:10）。
   *  每层 n 团顺着风分成 n 段，每段里随机一个位置（u = 离上风那条边几成：减少动态效果时就停在这里，开场时也正好飘到这里，不会一起从画面外进来）；
   *  横风时团的中心在 cross 那一截高度，竖风时横向随便放；大小、多浓、飘多快在配置的范围里随机。
   *  返回 [{ layer（far / near）, x, y（停住时团的中心，画面的比例）, u, w, h（vmax）, o, t（秒）, delay（秒，≤ 0）, tone（0 / 1：两种色调）, alt（另一种形状）, s0, s1 }] */
  function sandPuffs(dir, rand, aspect) {
    const S = WFX.sand, r = rand || Math.random, A = aspect > 0 ? aspect : 1.6, out = [];
    const pick = (a) => a[0] + r() * (a[1] - a[0]);
    const vert = dir === "S" || dir === "N", flip = dir === "W" || dir === "N";
    const ap = dir === "S" ? S.approach : dir === "N" ? [S.approach[1], S.approach[0]] : [1, 1];
    ["far", "near"].forEach((layer, li) => {
      const P = S.puffs[layer];
      for (let i = 0; i < P.n; i++) {
        const u = (i + 0.15 + r() * 0.7) / P.n, cross = vert ? 0.08 + r() * 0.84 : pick(P.cross);
        const w = pick(P.w), h = pick(P.h), o = pick(P.o), t = pick(P.t);
        // 飘一趟：从「整团在上风那边画面外」（偏移 −(u × 画面 + 半团)）走到「整团出了下风那边」（+((1 − u) × 画面 + 半团)）；走到偏移 0（停在 u 那里）是第几成。
        // 团顺着风那一边有多长（画面的百分比）：vmax 换成 vw = × max(1, 高 / 宽)，换成 vh = × max(1, 宽 / 高)
        const size = vert ? h * Math.max(1, A) : w * Math.max(1, 1 / A), at = (u * 100 + size / 2) / (100 + size);
        const along = flip ? 1 - u : u;
        out.push({ layer, x: vert ? cross : along, y: vert ? along : cross, u, w, h, o, t, delay: -at * t, tone: (i + li) % 2, alt: r() < 0.5, s0: ap[0], s1: ap[1] });
      }
    });
    return out;
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

  /** 室内的场景（下水道）不叠天上来的天气（#241）：区域场景的美术说这个场景换成哪种（hd2d-scene-art.js · weather，按布局的地面主题）；
   *  没加载 / 没有布局 = 原样。layout 不给就用 s.layout */
  function indoor(s, layout) {
    const A = root.HD2DSceneArt, lay = layout || (s && s.layout);
    return s && lay && A && typeof A.weather === "function" ? Object.assign({}, s, { weather: A.weather(lay.ground, s.weather).wfx }) : s;
  }

  /* ---------- 页面用：在 #stage 里放 2D 层 ---------- */
  /** stage = #stage（3D 画布和铭牌层都在里面）；opts = { lens(), view(), flash(), random }（见文件头；random = 酸雨的涟漪、沙暴的一团团沙雾放在哪用的随机数，
   *  不给用 Math.random）。返回 { host, sync(s), plan（上一次的）, dispose() } */
  function create(stage, opts) {
    opts = opts || {};
    const doc = stage.ownerDocument || root.document;
    const host = doc.createElement("div");
    host.className = "hd2d-wfx";
    host.setAttribute("aria-hidden", "true");
    host.style.zIndex = String(WFX.z);
    stage.appendChild(host);
    let last = null, layout = null, raf = 0, flashNow = -1, sandEl = null, sandDir = "";
    const spot = () => rippleAt(layout, opts.lens ? opts.lens() : null, opts.random, opts.view ? opts.view() : null, last && last.rippleZones);
    function sync(s) {
      if (s && s.layout) layout = s.layout;
      const p = plan(indoor(s, layout)), WF = root.WeatherFx;
      last = p;
      // weather-fx.css 的夜晚样子写在 .g-app.is-night .wfx-… 上（正式画面的 #g-app）：这一层也带上这两个 class。
      // 不写 data-weather，所以 weather-fx.css 里给正式画面面板换色的 .g-app[data-weather=…] 那些规则一条都不会套到原型上
      host.classList.toggle("g-app", p.night);
      host.classList.toggle("is-night", p.night);
      host.classList.toggle("still", p.still);                  // 减少动态效果：沙暴的沙雾停住照样蒙着（hd2d.css，#251）
      host.style.setProperty("--wfx-o", String(p.opacity));
      host.style.setProperty("--wfx-s", String(p.scale));
      host.style.setProperty("--wfx-t", p.fade + "s");
      host.style.setProperty("--wfx-sq", p.squash.toFixed(3));     // 酸雨的涟漪按俯角压扁、按远近放大（hd2d.css 的 .wfx-acid b）
      host.style.setProperty("--wfx-rs", String(p.rippleScale));
      const fx = WF ? WF.sync({ field: host, weather: p.weather, sandDir: p.sandDir, phaseStep: p.phaseStep, strikes: p.strikes, spot: p.ripples ? spot : null }) : null;
      paintSand(p, fx);
      watchFlash(p.flash > 0);
      return p;
    }
    /** 沙暴的 2D 沙雾（#251）：正式画面那两层（fx = WeatherFx.sync 摆好的 .wfx-sand）换颜色（行内变量），原型自己那层（.hd2d-sand）铺上 / 拿掉。
     *  一团团的只在换了风向时重新铺（不然每重排一次就从头飘）；换段、换光影只换层上的变量（浓淡、放大、颜色，hd2d.css 读） */
    function paintSand(p, fx) {
      const sp = p.sand;
      if (fx && sp) [["--sand", sp.gust.sand], ["--sand2", sp.gust.sand2], ["--peak", sp.gust.peak], ["--still", sp.gust.still]].forEach(([k, v]) => fx.style.setProperty(k, String(v)));
      if (!sp) {
        if (sandEl) { sandEl.remove(); sandEl = null; sandDir = ""; }
        return;
      }
      if (!sandEl) {
        sandEl = doc.createElement("div");
        sandEl.className = "hd2d-sand";
        host.appendChild(sandEl);
      }
      if (sandDir !== p.sandDir) {
        sandDir = p.sandDir;
        sandEl.dataset.sandDir = sandDir;
        while (sandEl.children.length) sandEl.children[0].remove();
        ["veil", "deep"].forEach(k => { const el = doc.createElement("i"); el.className = k; sandEl.appendChild(el); });
        const v = opts.view ? opts.view() : null;
        sandPuffs(sandDir, opts.random, v && v.width > 0 && v.height > 0 ? v.width / v.height : 0).forEach(q => {
          const el = doc.createElement("i");
          el.className = "puff " + q.layer + " t" + q.tone + (q.alt ? " alt" : "");
          [["--x", pct(q.x)], ["--y", pct(q.y)], ["--u", q.u.toFixed(3)], ["--w", q.w.toFixed(1) + "vmax"], ["--h", q.h.toFixed(1) + "vmax"], ["--o", q.o.toFixed(2)],
            ["--t", q.t.toFixed(1) + "s"], ["--dl", q.delay.toFixed(2) + "s"], ["--s0", String(q.s0)], ["--s1", String(q.s1)]].forEach(([k, val]) => el.style.setProperty(k, val));
          sandEl.appendChild(el);
        });
      }
      [["--veil", sp.veil.o], ["--veil-c", sp.veil.c], ["--deep", sp.deep.o], ["--deep-c", sp.deep.c], ["--deep-mid", sp.deep.mid], ["--deep-at", pct(sp.deep.at)],
        ["--deep-to", pct(sp.deep.to)], ["--zoom", sp.zoom], ["--c0", sp.colors[0]], ["--c1", sp.colors[1] || sp.colors[0]]].forEach(([k, v]) => sandEl.style.setProperty(k, String(v)));
    }
    /** 雷鸣：3D 打雷闪白的那一下，2D 层跟着淡掉（--wfx-flash）。只在要淡的天气里每帧读 opts.flash()（场景的 sc.flash，减少动态效果时那边已经减弱过） */
    function watchFlash(on) {
      if (on && !raf && opts.flash && root.requestAnimationFrame) {
        const tick = () => { raf = root.requestAnimationFrame(tick); setFlash(opts.flash() * (last ? last.flash : 0)); };
        raf = root.requestAnimationFrame(tick);
      } else if (!on && raf) {
        if (root.cancelAnimationFrame) root.cancelAnimationFrame(raf);
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
      dispose() { watchFlash(false); if (root.WeatherFx) root.WeatherFx.sync({ field: host, weather: "none" }); sandEl = null; sandDir = ""; host.remove(); }
    };
  }

  return { WFX, windOf, screenDir, elevationOf, plan, indoor, sandOf, hazeAt, sandPuffs, rippleAt, create };
});
