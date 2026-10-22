/* 天气动效（PR #53）：在战场里放 .wfx-{天气} 叠加层，样式在 weather-fx.css。
 * 酸雨的涟漪、雷鸣的区域闪光 / 远处闪电是 JS 随机生成的小元素，播完自己删掉；离开这个天气，计时链自己停。
 * 游戏画面每次刷新天气时调 WeatherFx.sync（game.js · applyEnv）。
 * HD-2D 战场（hd2d/hd2d-wfx.js，#240；#261 起从原型目录挪到仓库根目录的 hd2d/）把它当成一层 2D 压在 3D 画面上，多给两个可选参数（不给 = 正式画面的样子，一点不变）：
 *   strikes: false   雷鸣不打区域闪光、远处闪电（3D 场景自己有雷击）
 *   spot()           酸雨的涟漪落在哪：返回 { x, y }（叠加层里的百分比）或 null（这一下不落）；不给 = 整层随机 */
(function (root) {
  "use strict";
  const fxRand = () => (typeof fxRandom === "function" ? fxRandom() : Math.random());   // 画面效果的随机数：不动战斗用的种子随机数（run.js · fxRandom）
  const PHASE_STEPS = ["trough", "balance", "peak", "balance"];   // 相位天气 0..3：波谷 / 平衡 / 波峰 / 平衡（app.js · phaseWeatherName）
  /** 相位阶段 → data-phase-step；不是相位天气返回 "" */
  function phaseStepName(weather, step) {
    if (weather !== "phase") return "";
    return PHASE_STEPS[((Number(step) || 0) % 4 + 4) % 4];
  }
  /** 战场叠加层的 class；没有天气返回 "" */
  function layerClass(weather) {
    return weather && weather !== "none" ? "wfx wfx-" + weather : "";
  }
  const reduced = () => !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const doc = () => root.document;

  let acidTimer = null, acidSpot = null, thunderGen = 0, thunderOn = false;   // acidSpot：sync 的可选参数 spot（HD-2D 原型）

  function makeLayer(cls) {
    const fx = doc().createElement("div");
    fx.className = cls;
    fx.innerHTML = "<i></i><i></i>";
    return fx;
  }

  /* 酸雨：随机位置 / 大小 / 时长的涟漪（给了 spot 就问它落在哪，返回 null 这一下不落） */
  function startAcid() {
    if (acidTimer || reduced()) return;
    const spawn = () => {
      const host = doc().querySelector(".wfx-acid");
      if (!host) { acidTimer = null; return; }
      const at = !doc().hidden && host.childElementCount < 40 && acidSpot ? acidSpot() : null;
      if (!doc().hidden && host.childElementCount < 40 && (!acidSpot || at)) {
        const r = doc().createElement("b"), big = fxRand() < .25;
        const sz = big ? 70 + fxRand() * 60 : 16 + fxRand() * 46;
        const left = at ? Number(at.x) : fxRand() * 100, top = at ? Number(at.y) : fxRand() * 100;
        r.style.cssText = `left:${left.toFixed(2)}%;top:${top.toFixed(2)}%;width:${sz | 0}px;height:${(sz * (.82 + fxRand() * .1)) | 0}px;--d:${(1.6 + fxRand() * 1.6 + sz / 120).toFixed(2)}s`;
        r.addEventListener("animationend", () => r.remove());
        host.appendChild(r);
      }
      acidTimer = setTimeout(spawn, 60 + fxRand() * fxRand() * 420);
    };
    spawn();
  }

  /* 雷鸣：随机一个区域柔和闪光（单闪或轻微闪烁）+ 顶部远处的细闪电 */
  function startThunder() {
    if (thunderOn || reduced()) return;
    thunderOn = true;
    const R = fxRand;
    const zoneFlash = () => {
      const host = doc().querySelector(".wfx-thunder");
      if (!host) return false;
      const zs = Array.from(host.parentElement.querySelectorAll(".g-zone"));
      if (!doc().hidden && zs.length) {
        const z = zs[(R() * zs.length) | 0], hr = host.getBoundingClientRect(), r = z.getBoundingClientRect(), u = doc().createElement("u");
        if (R() < .4) u.className = "flick";
        u.style.cssText = `left:${(r.left - hr.left) | 0}px;top:${(r.top - hr.top) | 0}px;width:${r.width | 0}px;height:${r.height | 0}px;--pk:${(.25 + R() * .05).toFixed(3)};--d:${(1.4 + R() * .6).toFixed(2)}s`;
        u.addEventListener("animationend", () => u.remove());
        host.appendChild(u);
      }
      return true;
    };
    const bolt = () => {
      const host = doc().querySelector(".wfx-thunder");
      if (!host) return false;
      if (!doc().hidden) {
        const w = 60 + R() * 50, h = 50 + R() * 50;
        let x = w / 2, y = 0, d = `M${x | 0} 0`, br = "";
        while (y < h) {
          x += (R() - .5) * 22; y += 6 + R() * 10; d += ` L${x | 0} ${y | 0}`;
          if (!br && y > h * .3 && R() < .5) {
            const s2 = R() < .5 ? -1 : 1;
            br = `M${x | 0} ${y | 0} L${(x + s2 * (10 + R() * 14)) | 0} ${(y + 10 + R() * 12) | 0} L${(x + s2 * (16 + R() * 18)) | 0} ${(y + 22 + R() * 14) | 0}`;
          }
        }
        const s = doc().createElement("s");
        s.innerHTML = `<svg width="${w | 0}" height="${h | 0}" viewBox="0 0 ${w | 0} ${h | 0}" fill="none" stroke="rgb(236,228,255)" stroke-width="1.4" stroke-linejoin="round"><path d="${d}"/><path d="${br}" stroke-width="1"/></svg>`;
        s.style.cssText = `left:${(5 + R() * 85).toFixed(1)}%;--pk:${(.25 + R() * .15).toFixed(2)};--d:${(.9 + R() * .5).toFixed(2)}s`;
        s.addEventListener("animationend", () => s.remove());
        host.appendChild(s);
      }
      return true;
    };
    const gen = ++thunderGen;
    const tick = (fn, lo, span) => setTimeout(() => {
      if (gen !== thunderGen) return;
      if (fn()) tick(fn, lo, span); else thunderOn = false;
    }, lo + R() * span);
    tick(zoneFlash, 6000, 8000);
    tick(bolt, 3000, 7000);
  }
  function stopThunder() { if (thunderOn) { thunderOn = false; thunderGen++; } }

  /** 按现在的天气摆好战场叠加层和界面的 data-*。
   *  opt：{ field：战场元素（放叠加层），app：#g-app，weather，sandDir，phaseStep；可选（HD-2D 原型用，不给 = 正式画面的样子）：strikes，spot } */
  function sync(opt) {
    opt = opt || {};
    const field = opt.field, app = opt.app, weather = opt.weather || "none";
    const want = layerClass(weather);
    const ps = phaseStepName(weather, opt.phaseStep);
    if (app) {
      app.dataset.sandDir = opt.sandDir || "";
      if (ps) app.dataset.phaseStep = ps; else delete app.dataset.phaseStep;
    }
    if (!field) return null;
    let fx = field.querySelector(".wfx");
    if (fx && fx.className !== want) { fx.remove(); fx = null; }
    if (want && !fx) { fx = makeLayer(want); field.appendChild(fx); }
    if (fx) {
      fx.dataset.sandDir = opt.sandDir || "";
      if (ps) fx.dataset.phaseStep = ps; else delete fx.dataset.phaseStep;
    }
    acidSpot = typeof opt.spot === "function" ? opt.spot : null;
    if (weather === "acid") startAcid();
    if (weather === "thunder" && opt.strikes !== false) startThunder(); else stopThunder();
    return fx;
  }

  const api = { sync, phaseStepName, layerClass, PHASE_STEPS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WeatherFx = api;
})(typeof window !== "undefined" ? window : globalThis);
