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
 * 3D 那边配合的（雾更浓更黄、远景蒙上沙色、远处景深更糊、沙粒顺着风横飞）在 hd2d-weather.js 的 WEATHER.sand 和 hd2d-scene.js。
 *
 *   const plan = HD2DWfx.plan({ weather, theme, sandDir, phaseStep, portrait, tier, close, reduced });   // 纯函数，Node 里 require 来测
 *   const wfx = HD2DWfx.create(stage);   // 页面用：在 #stage 里放 2D 层
 *   wfx.sync({ … 同上 });                 // 天气 / 光影 / 镜头变了就叫一次（WeatherFx.sync 本来就是幂等的）
 * 「减少动态效果」照 weather-fx 现有的处理（weather-fx.css 的媒体查询）；换段时 2D 层也不渐变。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else root.HD2DWfx = factory(root);
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  /* ---------- 配置（数值都在这里，逻辑里不写死）---------- */
  const WFX = {
    /* 2D 层叠在哪（#stage 里的 z-index）：0 = 3D 画布之上、铭牌（.hd2d-labels，z 1）之下，铭牌照常看得清；
     * 改成 2 就连铭牌一起盖住（像正式画面的单位卡）。界面面板、攻击演出、伤害数字都在 #stage 外面，永远在它上面 */
    z: 0,
    /* 光影 → 用不用 weather-fx.css 的夜晚样子（.g-app.is-night .wfx-…：沙暴更暗更淡）。
     * 和正式画面一样：规则上的夜晚 = 傍晚 + 夜晚（daylight.js · isNight；game.js · applyEnv 的 is-night） */
    night: { day: false, dusk: true, night: true },
    /* 风向（state.sandDir）→ 棋盘上的方向 [x, y]（x 向右、y 向下）：和规则 engine.js · SAND_WIND_VEC 一样，认不得的按 "12" */
    wind: { "12": [1, 0], E: [1, 0], "21": [-1, 0], W: [-1, 0], S: [0, 1], N: [0, -1] },
    /* 三段镜头下 2D 层多强：o 整层的不透明度、s 从画面中间放大多少（沙雾一团团更大、更近，像身处其中）；close = 近景里双击单位的特写 */
    tier: { far: { o: 0.85, s: 1 }, mid: { o: 0.92, s: 1.06 }, near: { o: 1, s: 1.14 }, close: { o: 1, s: 1.22 } },
    /* 换段时 2D 层渐变多久（秒，和镜头过渡 hd2d-camera.js · CAMERA.transition 一样长；减少动态效果时不渐变） */
    fade: 0.5,
    /* 每种天气：on 叠不叠 2D 层；scale 跟不跟三段镜头放大 */
    weather: {
      sand: { on: true, scale: true }
    }
  };

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

  /* ---------- 这一刻叠哪一层 ---------- */
  /**
   * s = { weather, theme（day / dusk / night）, sandDir, phaseStep, portrait, tier（far / mid / near）, close（特写中）, reduced（减少动态效果）}
   * 返回 { weather 交给 WeatherFx.sync 的天气（不叠 2D 层的是 "none"）, night 用夜晚样子, sandDir 屏幕上的风向（沙暴才有）, phaseStep,
   *        tier 这一段（特写是 close）, opacity / scale 这一段的强弱, fade 换段渐变的秒数 }
   */
  function plan(s) {
    s = s || {};
    const w = s.weather && s.weather !== "none" ? String(s.weather) : "none";
    const cfg = WFX.weather[w] || null, on = !!(cfg && cfg.on);
    const tier = s.close ? "close" : (WFX.tier[s.tier] ? s.tier : "far"), T = WFX.tier[tier];
    return {
      weather: on ? w : "none",
      night: !!WFX.night[s.theme],
      sandDir: on && w === "sand" ? screenDir(windOf(s.sandDir, !!s.portrait)) : "",
      phaseStep: s.phaseStep,
      tier, opacity: on ? T.o : 1, scale: on && cfg.scale ? T.s : 1,
      fade: s.reduced ? 0 : WFX.fade
    };
  }

  /* ---------- 页面用：在 #stage 里放 2D 层 ---------- */
  /** stage = #stage（3D 画布和铭牌层都在里面）。返回 { host, sync(s), plan（上一次的）, dispose() } */
  function create(stage) {
    const doc = stage.ownerDocument || root.document;
    const host = doc.createElement("div");
    host.className = "hd2d-wfx";
    host.setAttribute("aria-hidden", "true");
    host.style.zIndex = String(WFX.z);
    stage.appendChild(host);
    let last = null;
    function sync(s) {
      const p = plan(s), WF = root.WeatherFx;
      last = p;
      // weather-fx.css 的夜晚样子写在 .g-app.is-night .wfx-… 上（正式画面的 #g-app）：这一层也带上这两个 class。
      // 不写 data-weather，所以 weather-fx.css 里给正式画面面板换色的 .g-app[data-weather=…] 那些规则一条都不会套到原型上
      host.classList.toggle("g-app", p.night);
      host.classList.toggle("is-night", p.night);
      host.style.setProperty("--wfx-o", String(p.opacity));
      host.style.setProperty("--wfx-s", String(p.scale));
      host.style.setProperty("--wfx-t", p.fade + "s");
      if (WF) WF.sync({ field: host, weather: p.weather, sandDir: p.sandDir, phaseStep: p.phaseStep });
      return p;
    }
    return {
      host, sync,
      get plan() { return last; },
      dispose() { if (root.WeatherFx) root.WeatherFx.sync({ field: host, weather: "none" }); host.remove(); }
    };
  }

  return { WFX, windOf, screenDir, plan, create };
});
