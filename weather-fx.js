/* 天气动效（PR #53）：在战场里放 .wfx-{天气} 叠加层，样式在 weather-fx.css。
 * 酸雨的涟漪、雷鸣的区域闪光 / 远处闪电是 JS 随机生成的小元素，播完自己删掉；离开这个天气，计时链自己停。
 * 游戏画面每次刷新天气时调 WeatherFx.sync（game.js · applyEnv）。 */
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

  let acidTimer = null, thunderGen = 0, thunderOn = false;

  function makeLayer(cls) {
    const fx = doc().createElement("div");
    fx.className = cls;
    fx.innerHTML = "<i></i><i></i>";
    return fx;
  }

  /* 酸雨：随机位置 / 大小 / 时长的涟漪 */
  function startAcid() {
    if (acidTimer || reduced()) return;
    const spawn = () => {
      const host = doc().querySelector(".wfx-acid");
      if (!host) { acidTimer = null; return; }
      if (!doc().hidden && host.childElementCount < 40) {
        const r = doc().createElement("b"), big = fxRand() < .25;
        const sz = big ? 70 + fxRand() * 60 : 16 + fxRand() * 46;
        r.style.cssText = `left:${(fxRand() * 100).toFixed(2)}%;top:${(fxRand() * 100).toFixed(2)}%;width:${sz | 0}px;height:${(sz * (.82 + fxRand() * .1)) | 0}px;--d:${(1.6 + fxRand() * 1.6 + sz / 120).toFixed(2)}s`;
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
   *  opt：{ field：战场元素（放叠加层），app：#g-app，weather，sandDir，phaseStep } */
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
    if (weather === "acid") startAcid();
    if (weather === "thunder") startThunder(); else stopThunder();
    return fx;
  }

  const api = { sync, phaseStepName, layerClass, PHASE_STEPS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WeatherFx = api;
})(typeof window !== "undefined" ? window : globalThis);
