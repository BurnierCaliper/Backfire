// HD-2D 战场原型 · 主人试玩反馈 · 三（#240）：天气效果套用正式战斗画面的 weather-fx.js（沙暴先做）。
// 正式画面的 2D 天气叠加层（weather-fx.css / weather-fx.js）原样压在 3D 画面上面、铭牌和界面面板下面；
// 3D 那边配合：沙暴的雾更浓更黄、远景蒙上沙色、远处景深更糊、沙粒顺着风向横飞（和 2D 的沙雾一个方向）。
// 都是 Node 能跑的：2D 层怎么叠、雾、风向是纯函数；weather-fx.js 和 hd2d-wfx.js 在一个最小的假网页里跑；
// 粒子、远景在 Node 里用 vendor 的真 three.js 建。画面（WebGL）截图由仓库主人跑。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("./headless");
const HP = require("./hd2d-paths");
const L = require("../hd2d/hd2d-layout.js");
const OV = require("../online-view.js");

// 缺这几个文件 / 函数时只是这几条失败（每条测试里各自 require）
const wfxm = () => require("../hd2d/hd2d-wfx.js");
const cams = () => require("../hd2d/hd2d-camera.js");

const ROOT = path.join(__dirname, "..");
const DIR = HP.MOD;   // 战场的模块（#261 起在正式目录 hd2d/）；原型页在 HP.PAGE，hd2d.css 读原型页加载的那两份（HP.protoCss）
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const PARTY = ["kolt", "helu", "ruby", "yuito"];
const DESKTOP = { width: 1440, height: 900, top: 46, bottom: 160 };   // 桌面 1440×900：顶栏 + 展开的技能栏
const PHONE = { width: 390, height: 844, top: 42, bottom: 56 };
const gapOf = (type, hp, open) => ({ type, hp: hp || 0, maxHp: hp || 0, open: open !== false, lastFrom: null });

/** 三个演示战场（和 index.html 的 DEMOS 一样：区域、光影写进战斗状态） */
const DEMOS = {
  mine(S) {
    const st = S.setup({ party: PARTY, zoneMode: 3, seed: "hd2d-mine", region: "第一采矿场", light: "dusk", enemies: [{ id: "guard_sword", lv: 2, zone: 3 }, { id: "guard_gun", lv: 2, zone: 3 }, { id: "thug_hammer", lv: 2, zone: 2 }, { id: "boomcar", lv: 2, zone: 2 }] });
    st.fields[2].acid = true; st.fields[3].highland = true; st.gaps["1-2"] = gapOf("bridge", 12); st.gaps["2-3"] = gapOf("wall", 20, false);
    return st;
  },
  desert(S) {
    const st = S.setup({ party: PARTY, board: "square4", weather: "sand", seed: "hd2d-desert", region: "沙漠", light: "day", enemies: [{ id: "sandfish_ambush", lv: 2, zone: 1 }, { id: "sandfish_lead", lv: 2, zone: 2 }, { id: "sand_beast", lv: 2, zone: 4 }, { id: "sand_human", lv: 2, zone: 4 }] });
    st.fields[1].quicksand = true; st.fields[4].coral = true; st.gaps["1-3"] = gapOf("void"); st.gaps["2-4"] = gapOf("bridge", 10);
    return st;
  },
  cross(S) {
    const st = S.setup({ party: PARTY, board: "cross5", weather: "thunder", seed: "hd2d-cross", region: "外城区", light: "night", enemies: [{ id: "crow", lv: 2, zone: 1 }, { id: "buoy", lv: 2, zone: 1 }, { id: "thug_hammer", lv: 2, zone: 3 }, { id: "guard_gun", lv: 2, zone: 4 }] });
    st.fields[1].abyss = true; st.fields[2].highland = true; st.fields[3].electric = true; st.fields[4].acid = true;
    st.gaps["1-3"] = gapOf("void"); st.gaps["2-3"] = gapOf("door", 0, false); st.gaps["3-4"] = gapOf("bridge", 12);
    return st;
  }
};
/** 在规则环境里投影（和原型页一样：online-view.js 和规则文件在同一个页面里，主机的展示函数 sandWind 这些拿得到） */
function projectIn(ctx, st) {
  if (!ctx.OnlineView) vm.runInContext(read("online-view.js"), ctx, { filename: "online-view.js" });
  return ctx.OnlineView.projectState(st, { itemCatalog: ctx.ITEM_CATALOG || {} });
}
/** 演示战场投影成联机玩家拿到的那一份，再排布局（和原型页一样：先投影，再交给布局） */
function demoLayout(id, opts) {
  const ctx = H.load(), st = DEMOS[id](ctx.BattleSim), pv = projectIn(ctx, st);
  return { ctx, st, pv, layout: L.build(pv, Object.assign({ view: DESKTOP, region: pv.region, theme: pv.light }, opts || {})) };
}

/* ---------- 假网页：weather-fx.js + hd2d-wfx.js（和原型页一样都是普通脚本，root = window）---------- */
/** 最小的假 DOM：这两个脚本用到的那几样（建元素、挂上去、按 class 找、拿掉、dataset、classList、style） */
function fakeDom() {
  class El {
    constructor(tag, doc) {
      this.tagName = String(tag).toUpperCase(); this.ownerDocument = doc; this.children = []; this.parentElement = null;
      this.dataset = {}; this.attrs = {}; this._cls = new Set(); this.innerHTML = ""; this.listeners = {};
      const self = this;
      this.style = { cssText: "", props: {}, setProperty(k, v) { this.props[k] = String(v); }, getPropertyValue(k) { return this.props[k] || ""; } };
      this.classList = {
        toggle(c, on) { const v = on === undefined ? !self._cls.has(c) : !!on; if (v) self._cls.add(c); else self._cls.delete(c); return v; },
        contains: (c) => self._cls.has(c), add: (...c) => c.forEach(x => self._cls.add(x)), remove: (...c) => c.forEach(x => self._cls.delete(x))
      };
    }
    get className() { return [...this._cls].join(" "); }
    set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get childElementCount() { return this.children.length; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    hasAttribute(k) { return k in this.attrs; }
    appendChild(c) { if (c.parentElement) c.remove(); c.parentElement = this; this.children.push(c); return c; }
    remove() { const p = this.parentElement; if (p) { p.children.splice(p.children.indexOf(this), 1); this.parentElement = null; } }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    querySelectorAll(sel) {
      const cls = String(sel).replace(/^\./, ""), out = [];
      const walk = (e) => e.children.forEach(c => { if (c._cls.has(cls)) out.push(c); walk(c); });
      walk(this);
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    getBoundingClientRect() { return { left: 0, top: 0, width: DESKTOP.width, height: DESKTOP.height }; }
  }
  const doc = { hidden: false, createElement: (t) => new El(t, doc) };
  doc.body = new El("body", doc);
  doc.querySelector = (sel) => doc.body.querySelector(sel);
  doc.querySelectorAll = (sel) => doc.body.querySelectorAll(sel);
  return doc;
}
/** 固定种子的随机数（每次跑都一样） */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), a | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
/** 照原型页的顺序加载普通脚本（布局 → 镜头 → weather-fx.js → hd2d-wfx.js）。opts.reduced = 系统开了「减少动态效果」；opts.only = 只加载 weather-fx.js（正式画面那样）。
 *  计时器、动画帧都不真的跑：记下来，测试里手动推（timers / frames）；Math.random 换成固定种子的 */
function wfxPage(opts) {
  opts = opts || {};
  const doc = fakeDom(), timers = [], frames = new Map();
  const M = Object.create(Math);
  M.random = seeded(opts.seed || 11);
  let fid = 0;
  const sandbox = {
    document: doc, console, Math: M,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    requestAnimationFrame: (fn) => { frames.set(++fid, fn); return fid; }, cancelAnimationFrame: (id) => { frames.delete(id); },
    matchMedia: (q) => ({ matches: !!opts.reduced && /prefers-reduced-motion: reduce/.test(q) })
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  const files = opts.only ? ["weather-fx.js"] : ["hd2d/hd2d-layout.js", "hd2d/hd2d-camera.js", "weather-fx.js", "hd2d/hd2d-wfx.js"];
  for (const f of files) vm.runInContext(read(f), ctx, { filename: f });
  const stage = doc.createElement("div");
  doc.body.appendChild(stage);
  /** 推 n 下计时器 / 动画帧（每次把排着的都跑一遍；跑的时候新排的留到下一下） */
  const runTimers = (n) => { for (let i = 0; i < (n || 1); i++) timers.splice(0).forEach(t => t.fn()); };
  const runFrames = (n) => { for (let i = 0; i < (n || 1); i++) { const list = [...frames.values()]; frames.clear(); list.forEach(fn => fn()); } };
  return { doc, stage, timers, frames, runTimers, runFrames, WF: sandbox.WeatherFx, W: sandbox.HD2DWfx, random: M.random };
}

/* ---------- 真的 three.js（和 tests/hd2d-layout.test.js 的 protoEnv 一样）---------- */
let protoHooked = false;
async function protoEnv(t) {
  const mod = require("node:module"), { pathToFileURL } = require("url");
  if (typeof mod.register !== "function") { t.skip("这个 Node 版本没有 module.register"); return null; }
  const threeUrl = pathToFileURL(path.join(ROOT, "vendor", "three", "three.module.min.js")).href;
  if (!protoHooked) {
    protoHooked = true;
    mod.register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
      if (s === "three") return { url: ${JSON.stringify(threeUrl)}, format: "module", shortCircuit: true };
      const r = await n(s, c);
      return /\\/(hd2d|vendor\\/three)\\//.test(r.url) ? Object.assign({}, r, { format: "module" }) : r;
    }`));
  }
  const any = () => new Proxy(function () {}, { get: (o, k) => (k === Symbol.toPrimitive ? () => 0 : any()), set: () => true, apply: () => any() });
  const keep = { document: globalThis.document, window: globalThis.window };
  const restore = () => {
    globalThis.document = keep.document; globalThis.window = keep.window;
    if (keep.document === undefined) delete globalThis.document;
    if (keep.window === undefined) delete globalThis.window;
  };
  globalThis.document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => any() }) };
  globalThis.window = { HD2DLayout: L };
  try {
    const url = (f) => pathToFileURL(path.join(DIR, f)).href;
    const THREE = await import(threeUrl);
    const B = await import(url("hd2d-backdrop.js")), WX = await import(url("hd2d-weather.js"));
    return { THREE, B, WX, restore };
  } catch (e) { restore(); throw e; }
}

/** 沙暴以前的雾（hd2d-weather.js 的 WEATHER.sand，#240 以前）：起雾早但拉得很长 */
const OLD_SAND = { fog: 0xc9a164, mix: 0.6, near: 0.55, far: 2.3 };
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };   // three.js 的线性雾：smoothstep(near, far, 深度)
/** hd2d-scene.js 里的雾距（FOG.depth）、光影主题的雾色（THEMES[].fog） */
function sceneFog() {
  const src = fs.readFileSync(path.join(DIR, "hd2d-scene.js"), "utf8");
  const depth = Number(/const FOG = \{ depth: (\d+)/.exec(src)[1]);
  const theme = {};
  ["day", "dusk", "night"].forEach(k => { theme[k] = Number(new RegExp(`\\n  ${k}: \\{[\\s\\S]*?fog: (0x[0-9a-f]{6})`).exec(src)[1]); });
  return { depth, theme, src };
}

/* ---------- 1. 2D 层：正式画面的 weather-fx 原样套上来 ---------- */
test("2D 天气层（#240）：沙暴时在 #stage 里放正式画面 weather-fx.js 生成的 .wfx.wfx-sand（画法用 weather-fx.css 的，一行不另写）；风向写在 data-sand-dir；傍晚 / 夜晚用正式画面的夜晚样子；不写 data-weather，正式画面给面板换色的规则不会套上来；晴天拿掉", () => {
  const P = wfxPage(), W = P.W;
  assert.ok(W && P.WF, "页面里有 HD2DWfx 和正式画面的 WeatherFx");
  const wfx = W.create(P.stage), host = wfx.host;
  assert.equal(host.parentElement, P.stage, "2D 层放在 #stage 里（3D 画布、铭牌层也在里面）");
  assert.ok(host.classList.contains("hd2d-wfx") && host.getAttribute("aria-hidden") === "true");
  assert.equal(host.style.zIndex, String(W.WFX.z), "叠在哪一层按配置（WFX.z）");
  for (const [theme, night] of [["day", false], ["dusk", true], ["night", true]]) {
    const p = wfx.sync({ weather: "sand", theme, sandDir: "E", tier: "far" });
    const layers = host.querySelectorAll("wfx");
    assert.equal(layers.length, 1, "只有一层");
    assert.equal(layers[0].className, P.WF.layerClass("sand"), "就是正式画面的 .wfx.wfx-sand（WeatherFx.layerClass）");
    assert.equal(layers[0].innerHTML, "<i></i><i></i>", "里面两层沙雾是 weather-fx.js 自己建的");
    assert.equal(layers[0].dataset.sandDir, p.sandDir, "风向写在 data-sand-dir（weather-fx.css 按它决定往哪边卷）");
    assert.equal(host.classList.contains("g-app") && host.classList.contains("is-night"), night, theme + "：夜晚样子（.g-app.is-night）");
    assert.ok(!("weather" in host.dataset) && !host.hasAttribute("data-weather"), "不写 data-weather：weather-fx.css 里 .g-app[data-weather=…] 那些给正式画面面板换色的规则套不上来");
  }
  // weather-fx.css 里沙暴的夜晚样子确实挂在 .g-app.is-night .wfx-sand 上（不另写一套）
  const css = read("weather-fx.css");
  assert.ok(/\.g-app\.is-night \.wfx-sand \{/.test(css) && /\.wfx-sand\[data-sand-dir="21"\], \.wfx-sand\[data-sand-dir="W"\]/.test(css), "夜晚样子 / 风向都是 weather-fx.css 的");
  // #251 起原型给这一层换了颜色（行内变量）、减少动态效果时把它停住（见下面 #251 那几条），但不另画：背景、动画还是 weather-fx.css 的
  const sandRules = [...HP.protoCss().replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/\.wfx-sand[^{]*\{([^}]*)\}/g)].map(m => m[1]);
  assert.ok(sandRules.every(r => !/background/.test(r) && (!/animation/.test(r) || /animation: none/.test(r))), "原型的 hd2d.css 不另画正式画面的沙雾（只在减少动态效果时停住它）");
  wfx.sync({ weather: "none", theme: "day", tier: "far" });
  assert.equal(host.querySelectorAll("wfx").length, 0, "晴天拿掉");
  wfx.sync({ weather: "sand", theme: "day", sandDir: "W", tier: "far" });
  wfx.dispose();
  assert.equal(host.parentElement, null, "dispose 拿掉整层");
});

/* ---------- 2. 风向：2D 沙雾、3D 沙粒、规则上的顺风 / 逆风一致 ---------- */
const BOARDS = [
  { tag: "两区直排", opt: { zoneMode: 2 } }, { tag: "三区直排", opt: { zoneMode: 3 } },
  { tag: "2×2", opt: { board: "square4" } }, { tag: "十字五区", opt: { board: "cross5" } }
];
test("风向（#240）：规则的 sandDir 换成 3D 世界里的风（竖屏时棋盘转了 90° 也跟着转）——风从规则上「顺风」的区吹向「逆风」的区；2D 沙雾在屏幕上往同一边卷；方向表和规则 engine.js · SAND_WIND_VEC 一样", () => {
  const W = wfxm();
  const ctx = H.load();
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext("SAND_WIND_VEC", ctx))), W.WFX.wind, "风向表和规则一样（认不得的按 12）");
  assert.deepEqual(W.windOf("??", false), W.windOf("12", false));
  for (const b of BOARDS) {
    const st = ctx.BattleSim.setup(Object.assign({ party: PARTY, weather: "sand", seed: "wind", enemies: [{ id: "guard_sword", lv: 2, zone: 2 }] }, b.opt));
    const dirs = vm.runInContext("sandDirOptions()", ctx);
    assert.ok(dirs.length >= 2, b.tag);
    for (const dir of dirs) {
      st.sandDir = dir;
      const pv = projectIn(ctx, st);
      assert.equal(pv.sandDir, dir, "风向在联机投影里（画面只读投影）");
      for (const portrait of [false, true]) {
        const view = portrait ? PHONE : DESKTOP, layout = L.build(pv, { view, portrait }), tag = `${b.tag} 风向 ${dir}${portrait ? " 竖屏" : ""}`;
        const wind = W.windOf(pv.sandDir, portrait);
        const zones = (label) => layout.zones.filter(z => pv.zoneView && pv.zoneView[z.id] && pv.zoneView[z.id].wind === label);
        const up = zones("顺风"), down = zones("逆风");
        assert.ok(up.length && down.length, tag + "：有顺风区也有逆风区");
        up.forEach(a => down.forEach(c => assert.ok((c.cx - a.cx) * wind.x + (c.cz - a.cz) * wind.z > 1, `${tag}：风没有从顺风的 ${a.id} 区吹向逆风的 ${c.id} 区`)));
        // 屏幕上：从顺风的区到逆风的区往哪边，2D 的沙雾就往哪边卷（weather-fx.css：E 往右 / W 往左 / S 往下 / N 往上）
        const mid = (list) => { const s = list.map(z => L.project(layout.camera, { x: z.cx, y: z.topY, z: z.cz })); return { x: s.reduce((a, q) => a + q.x, 0) / s.length, y: s.reduce((a, q) => a + q.y, 0) / s.length }; };
        const a = mid(up), c = mid(down), dx = c.x - a.x, dy = c.y - a.y;
        const want = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "E" : "W") : (dy > 0 ? "S" : "N");
        const p = W.plan({ weather: "sand", theme: "day", sandDir: pv.sandDir, portrait, tier: "far" });
        assert.equal(p.sandDir, want, `${tag}：屏幕上风往 ${want} 吹，2D 沙雾却往 ${p.sandDir}`);
        assert.equal(W.screenDir(wind), p.sandDir);
      }
    }
  }
  // 不是沙暴：不写风向
  assert.equal(W.plan({ weather: "none", sandDir: "E" }).sandDir, "");
});

test("3D 沙粒顺着同一个风横飞（#240）：粒子、拖影、大团沙尘都转到风向上（以前一直往 +x 飞，不看风向）；拖影是顺着风的短线；别的天气不跟着风转", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { THREE, WX } = P, W = wfxm();
  try {
    const scene = new THREE.Scene(), fx = WX.createWeather(scene, { bounds: { minX: -13.4, maxX: 13.4, minZ: -8.5, maxZ: 8.5 } });
    assert.equal(typeof fx.setWind, "function", "天气有 setWind");
    fx.set("sand", "day");
    const groups = () => { const out = []; scene.traverse(o => { if ((o.isPoints || o.isLineSegments) && o.geometry.attributes.position) out.push(o); }); return out; };
    for (const dir of ["E", "W", "S", "N"]) {
      const wind = W.windOf(dir, false);
      fx.setWind(wind);
      fx.update(1 / 60, 2, { dt: 1 / 60 });
      const before = new Map(groups().map(o => [o, Float32Array.from(o.geometry.attributes.position.array)]));
      fx.update(1 / 60, 2.05, { dt: 1 / 60 });
      let lines = 0;
      before.forEach((a, o) => {
        const b = o.geometry.attributes.position.array, along = [], up = [];
        for (let i = 0; i < a.length; i += 3) {
          const dx = b[i] - a[i], dy = b[i + 1] - a[i + 1], dz = b[i + 2] - a[i + 2], h = Math.hypot(dx, dz);
          if (h > 2) continue;   // 出界从另一边绕回来的不算
          along.push(h > 1e-6 ? (dx * wind.x + dz * wind.z) / h : 0); up.push(Math.abs(dy) / Math.max(h, 1e-6));
        }
        along.sort((p, q) => p - q); up.sort((p, q) => p - q);
        assert.ok(along[along.length >> 1] > 0.85, `风往 ${dir}：${o.type} 的粒子没有顺着风飞（${along[along.length >> 1].toFixed(2)}）`);
        assert.ok(up[up.length >> 1] < 0.35, `风往 ${dir}：${o.type} 是横着飞的，不是往下落`);
        if (o.isLineSegments) {
          lines++;
          for (let i = 0; i < b.length; i += 6) {
            const dx = b[i] - b[i + 3], dz = b[i + 2] - b[i + 5], l = Math.hypot(dx, dz);
            assert.ok(l > 0.2 && (dx * wind.x + dz * wind.z) / l > 0.9, `风往 ${dir}：拖影不是顺着风的短线`);
          }
        }
      });
      assert.equal(lines, 1, "沙暴有一层拖影（短线，跟着沙粒飞）");
    }
    // 别的天气不跟着风转：雪照旧往右下飘
    fx.set("snow", "day");
    const snow = WX.WEATHER.snow.vel;
    fx.setWind(W.windOf("W", false));
    assert.ok(!WX.WEATHER.snow.wind && !WX.weatherPlan("snow", "day").streak, "雪不跟风、没有拖影");
    assert.deepEqual(WX.windVel([8, -0.3, 1], { x: 1, z: 0 }), [8, -0.3, 1], "风往右（以前的方向）：速度不变");
    assert.deepEqual(snow, [0.25, -1.3, 0.1]);
    fx.dispose();
    assert.equal(scene.children.length, 0, "天气拿掉后场景里不留东西（拖影也拿掉）");
  } finally { P.restore(); }
});

/* ---------- 3. 3D 的雾：更浓、更黄，焦点区照样看得清 ---------- */
test("沙暴的 3D 雾更浓、更黄（#240）：三个演示 × 远 / 中 / 近，战场后面的地进雾比以前多得多（以前起雾早但拉得很长，后面的地反而比晴天还清楚），近景看的那个区几乎不进雾、中景只蒙一层薄雾、远景每个区都看得清；雾色更偏沙黄；三种光影都是", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { THREE, WX } = P, C = cams(), F = sceneFog();
  try {
    assert.equal(typeof WX.fogRange, "function", "雾距是一个纯函数（场景和测试同一个算法）");
    assert.ok(/fogRangeOf\(state\.layout, shift, weather\.tint, FOG\.depth\)/.test(F.src), "场景的雾按 fogRange 设");
    for (const id of Object.keys(DEMOS)) {
      const { layout, pv } = demoLayout(id), b = layout.bounds;
      const tint = WX.weatherPlan("sand", pv.light).tint;
      for (const tier of ["far", "mid", "near"]) for (const zone of layout.zones) {
        const p = C.pose(layout, tier, zone.id), c = p.cam, tag = `${id} ${tier} ${zone.id} 区`;
        const depth = (q) => (c.pos.x - q.x) * c.back.x + (c.pos.y - q.y) * c.back.y + (c.pos.z - q.z) * c.back.z;
        const fogAt = (tn, q) => { const r = WX.fogRange(layout, p.fogShift, tn, F.depth); return smooth(r.near, r.far, depth(q)); };
        const center = (z) => ({ x: z.cx, y: z.topY, z: z.cz });
        const ground = { x: (b.minX + b.maxX) / 2, y: 0, z: b.minZ - 10 }, edge = { x: (b.minX + b.maxX) / 2, y: 0, z: b.minZ };
        if (tier === "far") layout.zones.forEach(z => assert.ok(fogAt(tint, center(z)) <= 0.45, `${tag}：远景的 ${z.id} 区进了 ${fogAt(tint, center(z)).toFixed(2)} 成雾，看不清`));
        else assert.ok(fogAt(tint, center(zone)) <= (tier === "near" ? 0.05 : 0.15), `${tag}：看的那个区进了 ${fogAt(tint, center(zone)).toFixed(2)} 成雾`);
        assert.ok(fogAt(tint, ground) >= 0.55, `${tag}：战场后面的地只进了 ${fogAt(tint, ground).toFixed(2)} 成雾（不够浓）`);
        assert.ok(fogAt(tint, ground) >= fogAt(OLD_SAND, ground) + 0.3 && fogAt(tint, ground) > fogAt(null, ground) + 0.2, `${tag}：战场后面的地比以前的沙暴、比晴天都浓得多`);
        assert.ok(fogAt(tint, edge) >= fogAt(OLD_SAND, edge), tag + "：战场后沿不比以前淡");
      }
    }
    // 雾色：每种光影都比以前更偏沙黄（色相在黄橙之间、更饱和、蓝更少）
    const hsv = (c) => {
      const s = "#" + c.getHexString(), r = parseInt(s.slice(1, 3), 16), g = parseInt(s.slice(3, 5), 16), bl = parseInt(s.slice(5, 7), 16);
      const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), h = mx === mn ? 0 : mx === r ? 60 * (((g - bl) / (mx - mn)) % 6) : mx === g ? 60 * ((bl - r) / (mx - mn) + 2) : 60 * ((r - g) / (mx - mn) + 4);
      return { h: (h + 360) % 360, s: mx ? (mx - mn) / mx : 0, br: bl / Math.max(1, r) };
    };
    for (const theme of ["day", "dusk", "night"]) {
      const now = hsv(WX.fogColor(F.theme[theme], WX.weatherPlan("sand", theme).tint)), old = hsv(new THREE.Color(F.theme[theme]).lerp(new THREE.Color(OLD_SAND.fog), OLD_SAND.mix));
      assert.ok(now.h >= 25 && now.h <= 50, `${theme}：沙暴的雾色不是沙黄（色相 ${now.h.toFixed(0)}°）`);
      assert.ok(now.s > old.s + 0.05 && now.br < old.br, `${theme}：沙暴的雾色没有比以前更黄（饱和 ${now.s.toFixed(2)} / 以前 ${old.s.toFixed(2)}）`);
    }
    // 别的天气的雾一点没变（雾色靠多少、起雾的地方都和以前一样）
    for (const w of ["snow", "acid", "thunder", "heat"]) {
      const tn = WX.weatherPlan(w, "day").tint;
      assert.ok(tn.mix === 0.6 && tn.sky === 0 && tn.dof === 1, w + "：雾照旧");
    }
  } finally { P.restore(); }
});

/* ---------- 4. 远景蒙上沙色、远处更糊 ---------- */
test("沙暴时远景也蒙上沙色（#240）：天幕往沙黄的雾色靠、贴地的雾更高，中景剪影也更偏雾色，星星和亮云看不见（以前远景的材质不吃场景雾，沙暴时和晴天一模一样）；远处景深更糊；别的天气远景不变", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { THREE, B, WX } = P, F = sceneFog();
  try {
    const { layout } = demoLayout("desert"), b = layout.bounds;
    const SKY = { day: ["#f6e3b4", "#ecc98c", "#dcac6a", "#c29a66"], dusk: ["#ffc47c", "#f28a5a", "#b9587a", "#4b3368"], night: ["#2f4673", "#1d2d52", "#101b38", "#060b1a"] };
    const dist = (a, c) => Math.hypot(a.r - c.r, a.g - c.g, a.b - c.b);
    for (const theme of ["day", "dusk", "night"]) for (const kind of ["desert", "mine", "city"]) {
      const tint = WX.weatherPlan("sand", theme).tint, fog = WX.fogColor(F.theme[theme], tint), tag = `${theme} ${kind}`;
      assert.ok(tint.sky > 0 && tint.haze > B.BACKDROP.haze && tint.veil > 0 && tint.sun < 1, "沙暴的远景蒙多少在配置里（WEATHER.sand 的 sky / haze / veil / sun）");
      const dust = { color: fog.getHex(), sky: tint.sky, haze: tint.haze, veil: tint.veil, sun: tint.sun };
      const calm = B.buildBackdrop(kind, b, theme, layout.camera, { sky: SKY[theme], fog: F.theme[theme] });
      const sand = B.buildBackdrop(kind, b, theme, layout.camera, { sky: SKY[theme], fog: fog.getHex(), dust });
      const skyOf = (bd) => bd.group.children.find(o => o.material && o.material.uniforms && o.material.uniforms.c0).material.uniforms;
      const su = skyOf(sand), cu = skyOf(calm);
      ["c0", "c1", "c2", "c3"].forEach(k => assert.ok(dist(su[k].value, fog) < dist(cu[k].value, fog) - 0.01, `${tag}：天幕的 ${k} 没有往沙黄的雾色靠`));
      assert.ok(su.hazeH.value === tint.haze && cu.hazeH.value === B.BACKDROP.haze, tag + "：贴地的雾更高");
      assert.ok(su.stars.value === 0 && su.clouds.value === 0, tag + "：星星、亮云看不见");
      const lum = (c) => c.r + c.g + c.b;
      assert.ok(Math.abs(lum(su.sunColor.value) - lum(cu.sunColor.value) * tint.sun) < 1e-6, tag + "：太阳的光晕只剩 sun 成");
      if (theme === "night") assert.equal(cu.stars.value, 1, "平时夜里有星星");
      // 中景剪影（MeshStandardMaterial）更偏雾色
      const props = (bd) => { const out = []; bd.group.traverse(o => { if (o.isMesh && o.material && o.material.type === "MeshStandardMaterial") out.push(o.material.color); }); return out; };
      const avg = (list) => list.reduce((a, c) => a + dist(c, fog), 0) / list.length;
      assert.ok(avg(props(sand)) < avg(props(calm)) - 0.02, `${tag}：中景剪影没有更偏沙黄的雾色`);
      calm.dispose(); sand.dispose();
    }
    // 屏幕背景也一样蒙上沙色（dustSky）；没有沙尘原样返回
    assert.deepEqual(B.dustSky(SKY.day, null), SKY.day);
    // 场景：远景按天气挑（雷鸣的风暴色优先，沙暴蒙沙色）、换了天气要重建；远处景深乘天气的 dof
    assert.ok(/dust = dustOf\(T, plan\.tint\)/.test(F.src) && /buildBackdrop\(kind, layout\.bounds, state\.meta\.theme, c, \{[^}]*storm, skyline, dust \}\)/.test(F.src) && /"dust", dust\.color/.test(F.src), "场景把沙尘交给远景，签名里有它（换天气就重建）");
    assert.ok(/dustSky\(T\.sky, dust\)/.test(F.src), "屏幕背景也蒙上沙色");
    assert.ok(/maxblurFar\.value = T\.dofFar \* D\.far \* \(wt && wt\.dof > 0 \? wt\.dof : 1\)/.test(F.src), "远处的景深糊上限乘天气的 dof");
    assert.ok(WX.WEATHER.sand.dof >= 1.5, "沙暴远处更糊");
    ["snow", "acid", "thunder", "heat", "glow", "phase"].forEach(w => { const tn = WX.weatherPlan(w, "day").tint; assert.ok(!tn || (tn.sky === 0 && tn.dof === 1), w + "：远景、景深照旧"); });
  } finally { P.restore(); }
});

/* ---------- 5. 三段镜头：近景稍微加强 ---------- */
test("三段镜头（#240）：2D 天气层远景淡一点，中景、近景、特写一段比一段强（不透明度 × 放大），像身处其中；强弱在配置（WFX.tier）；减少动态效果时换段不渐变（CSS 照 weather-fx.css 的媒体查询）", () => {
  const W = wfxm();
  const k = (tier, close) => { const p = W.plan({ weather: "sand", theme: "day", sandDir: "E", tier, close }); return p.opacity * p.scale; };
  const seq = [k("far"), k("mid"), k("near"), k("near", true)];
  seq.slice(1).forEach((v, i) => assert.ok(v > seq[i], `第 ${i + 2} 段没有比上一段强（${seq.map(x => x.toFixed(2))}）`));
  assert.ok(W.plan({ weather: "sand", tier: "near" }).opacity === 1 && W.plan({ weather: "sand", tier: "far" }).opacity < 1, "近景是正式画面原样的强度，远景淡一点");
  assert.equal(W.plan({ weather: "sand", tier: "?" }).tier, "far", "认不得的段按远景");
  assert.equal(W.plan({ weather: "sand", tier: "near", close: true }).tier, "close", "特写");
  assert.ok(W.plan({ weather: "sand", tier: "far" }).fade > 0 && W.plan({ weather: "sand", tier: "far", reduced: true }).fade === 0, "减少动态效果：换段不渐变");
  const css = HP.protoCss();
  assert.ok(/\.hd2d-wfx > \.wfx \{[^}]*opacity: var\(--wfx-o, 1\)[^}]*transform: scale\(var\(--wfx-s, 1\)\)/.test(css), "整层的不透明度 / 放大读 hd2d-wfx.js 写的变量");
  assert.ok(/@media \(prefers-reduced-motion: reduce\) \{ \.hd2d-wfx > \.wfx \{ transition: none; \} \}/.test(css), "减少动态效果：不渐变");
  // 原型给 2D 层加的动画只有沙暴自己的那层沙雾（#251 的 .hd2d-sand）和停住它们的规则；别的天气减少动态效果照 weather-fx.css 的处理
  const anim = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]*)\{[^}]*animation[^}]*\}/g)].map(m => m[1].trim()).filter(sel => /hd2d-wfx|hd2d-sand|\.wfx/.test(sel));
  assert.ok(anim.every(sel => /hd2d-sand|wfx-sand/.test(sel)), "原型只给沙暴的 2D 沙雾加 / 停动画：" + anim.join(" | "));
  // 页面：换段 / 特写时跟着换
  const html = HP.readPage("index.html");
  assert.ok(/syncUrl\(\);\s*syncWeather\(\);/.test(html), "镜头变了（syncCamera）就重排一次 2D 层");
  assert.ok(/tier: camInfo \? camInfo\.tier : sc\.tier, close: !!\(camInfo && camInfo\.close != null\), zone: camInfo \? camInfo\.zone : sc\.zone, reduced: !sc\.motion/.test(html), "段、特写、看的那个区、减少动态效果交给 2D 层");
});

/* ---------- 6. 原型页接线 ---------- */
test("原型页（#240）：原样加载 weather-fx.css / weather-fx.js（正式画面一行没改），2D 层在 #stage 里：3D 画布之上、铭牌之下，界面面板在上面，不挡鼠标；只读投影里的天气 / 风向 / 相位 / 光影，3D 沙粒按同一个风飞；假网页里加载不报错", () => {
  const html = HP.readPage("index.html"), css = HP.protoCss();
  const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];
  // 战场的样子和模块 #261 起在正式目录 hd2d/（原型页用 ../../hd2d/… 引）
  const ownCss = `href="${HP.pageSrc("hd2d.css")}"`, ownWfx = `src="${HP.pageSrc("hd2d-wfx.js")}"`;
  assert.ok(html.indexOf('href="../../weather-fx.css"') > 0 && html.indexOf('href="../../weather-fx.css"') < html.indexOf(ownCss), "weather-fx.css 在 hd2d.css 前面（原型的样式能盖过它）");
  assert.ok(html.indexOf('src="../../weather-fx.js"') > 0 && html.indexOf(ownWfx) > html.indexOf('src="../../weather-fx.js"') && html.indexOf(ownWfx) < html.indexOf('<script type="module">'), "加载 weather-fx.js 和 hd2d-wfx.js");
  assert.ok(/wfx = WX\.create\(\$\("stage"\)/.test(mod), "2D 层放在 #stage 里");
  assert.ok(/sc\.setWind\(WX\.windOf\(pv\.sandDir, portrait\)\)/.test(mod), "3D 沙粒按投影里的风向飞");
  assert.ok(/weather: pv\.weather, theme: themeNow\(\), sandDir: pv\.sandDir, phaseStep: pv\.phaseStep/.test(mod), "2D 层只读投影（天气、风向、相位、光影）");
  assert.ok(!/st\.sandDir\b(?! =)/.test(mod.replace(/if \(weatherPick\.wind[^\n]*/, "")) && !/st\.phaseStep\b(?! =)/.test(mod) && !/weather: st\.weather/.test(mod), "不绕开白名单读房主的原始 state（网址 ?weather= 是往战斗状态里写，和主持人改天气一样）");
  assert.ok(/renderLog\(\);\s*syncWeather\(layout\);/.test(mod), "每次重画（开场、换区域、出招后换成包里的 state）都同步 2D 层");
  // 层级：#stage（z 0）里 3D 画布（不定位）< 2D 层（定位，z WFX.z）< 铭牌层（z 1）；面板在 #stage 外面（z 5 / 6）
  const z = (sel) => Number(new RegExp(sel.replace(/[.#]/g, "\\$&") + " \\{[^}]*z-index: (\\d+)").exec(css)[1]);
  const W = wfxm();
  assert.ok(W.WFX.z < z(".hd2d-labels") && z(".hd2d-wfx") === W.WFX.z, "2D 层在铭牌下面");
  assert.ok(z(".panel") > z("#stage") && z("#topbar") > z("#stage"), "界面面板在 #stage（3D 画面 + 2D 天气层）上面");
  assert.ok(/\.hd2d-wfx \{[^}]*position: absolute; inset: 0;[^}]*pointer-events: none/.test(css), "2D 层铺满画面、不挡鼠标（拖动转镜头照样落在画布上）");
  // 正式画面的两个文件：weather-fx.js 只加可选参数、默认值不变（git 里看得到；这里查它还是给 game.js 用的同一个 WeatherFx.sync）
  assert.ok(/WeatherFx\.sync\(\{ field: fieldEl, app: \$\("g-app"\), weather: env\.weather, sandDir: state\.sandDir, phaseStep: state\.phaseStep \}\)/.test(read("game.js")), "正式画面照旧这样调");
  // 假网页：照 index.html 的顺序加载不报错，HD2DWfx / WeatherFx 都在
  const page = require("./hd2d-fake-page").load();
  assert.deepEqual(page.errors, [], "假网页加载报错");
  assert.ok(page.ctx.HD2DWfx && page.ctx.WeatherFx && typeof page.ctx.HD2DWfx.create === "function");
});

/* ---------- 7. weather-fx.js 只加可选参数、默认值不变 ---------- */
test("weather-fx.js 只加了两个可选参数（#240），不给就是正式画面原来的样子：雷鸣照打区域闪光 / 远处闪电，strikes: false 才不打；酸雨的涟漪照旧整层随机（位置、大小、时长和以前的公式一模一样），给了 spot 才落在它说的地方、它说 null 这一下就不落；减少动态效果时照旧不生成", () => {
  // 正式画面（只加载 weather-fx.js、不给新参数）
  const F = wfxPage({ only: true, seed: 5 }), field = F.doc.createElement("div");
  F.doc.body.appendChild(field);
  F.WF.sync({ field, weather: "thunder" });
  assert.equal(F.timers.length, 2, "雷鸣：区域闪光、远处闪电两条计时链都开着");
  F.runTimers(1);
  assert.ok(field.querySelector("wfx").children.some(c => c.tagName === "S"), "到点打了远处闪电");
  // 酸雨：涟漪的位置 / 大小 / 时长和以前的公式一模一样（同一串随机数）
  const ref = seeded(7);
  const want = () => {
    const big = ref() < 0.25, sz = big ? 70 + ref() * 60 : 16 + ref() * 46;
    return `left:${(ref() * 100).toFixed(2)}%;top:${(ref() * 100).toFixed(2)}%;width:${sz | 0}px;height:${(sz * (0.82 + ref() * 0.1)) | 0}px;--d:${(1.6 + ref() * 1.6 + sz / 120).toFixed(2)}s`;
  };
  const A = wfxPage({ only: true, seed: 7 }), af = A.doc.createElement("div");
  A.doc.body.appendChild(af);
  A.WF.sync({ field: af, weather: "acid" });
  const ripples = () => af.querySelector("wfx-acid").children.filter(c => c.tagName === "B");
  const first = ripples()[0];
  assert.ok(first, "进了酸雨马上落第一个涟漪");
  assert.equal(first.style.cssText, want(), "不给 spot：涟漪和以前一模一样");
  ref(); ref(); A.runTimers(1);   // 两次涟漪之间的间隔用了两个随机数（setTimeout 的时长）
  assert.equal(ripples()[1].style.cssText, want(), "第二个也一样");
  // strikes: false：雷鸣不打区域闪光、远处闪电（HD-2D 原型：3D 场景自己有雷击）
  const T = wfxPage({ only: true }), tf = T.doc.createElement("div");
  T.doc.body.appendChild(tf);
  T.WF.sync({ field: tf, weather: "thunder", strikes: false });
  assert.equal(T.timers.length, 0, "strikes: false 一条计时链都不开");
  assert.ok(tf.querySelector("wfx-thunder") && tf.querySelector("wfx-thunder").innerHTML === "<i></i><i></i>", "雷鸣的叠加层（暗色云影）照旧");
  // spot：落在它说的地方；它说 null 这一下不落，计时链照走
  const S = wfxPage({ only: true }), sf = S.doc.createElement("div");
  S.doc.body.appendChild(sf);
  let n = 0;
  S.WF.sync({ field: sf, weather: "acid", spot: () => (n++ % 2 ? null : { x: 12.5, y: 70 }) });
  S.runTimers(5);
  const bs = sf.querySelector("wfx-acid").children;
  assert.equal(bs.length, 3, "6 下里 spot 给了 3 个位置，只落了 3 个");
  bs.forEach(b => assert.ok(/^left:12\.50%;top:70\.00%;/.test(b.style.cssText), "落在 spot 说的地方"));
  assert.equal(S.timers.length, 1, "计时链照走");
  // 减少动态效果：照旧不生成涟漪、不打闪电（给了参数也一样）
  const R = wfxPage({ only: true, reduced: true }), rf = R.doc.createElement("div");
  R.doc.body.appendChild(rf);
  R.WF.sync({ field: rf, weather: "acid", spot: () => ({ x: 50, y: 50 }) });
  R.WF.sync({ field: rf, weather: "thunder" });
  assert.equal(R.timers.length, 0, "减少动态效果：不生成");
  // 正式画面照旧这样调（不给新参数）
  assert.ok(/WeatherFx\.sync\(\{ field: fieldEl, app: \$\("g-app"\), weather: env\.weather, sandDir: state\.sandDir, phaseStep: state\.phaseStep \}\)/.test(read("game.js")));
});

/* ---------- 8. 其他天气逐个接上 ---------- */
test("其他天气逐个接上（#240）：雪、酸雨、雷鸣、酷暑、微光、相位都叠正式画面的那一层（.wfx-…，相位的阶段跟着投影里的 phaseStep），原型不另画；跟不跟三段镜头放大按配置（酷暑贴着底边、微光贴着四角、酸雨的涟漪要落在地台上，不放大）", () => {
  const P = wfxPage(), W = P.W, wfx = W.create(P.stage), css = read("weather-fx.css"), mine = HP.protoCss();
  const all = ["sand", "snow", "acid", "thunder", "heat", "glow", "phase"];
  assert.deepEqual(Object.keys(W.WFX.weather).sort(), all.slice().sort(), "七种天气都接上了");
  for (const w of all) {
    for (const tier of ["far", "near"]) {
      const p = wfx.sync({ weather: w, theme: "dusk", sandDir: "W", phaseStep: 2, tier });
      const layer = wfx.host.querySelectorAll("wfx");
      assert.equal(layer.length, 1, w + "：一层");
      assert.equal(layer[0].className, P.WF.layerClass(w), w + "：就是正式画面的那一层");
      assert.ok(css.includes(".wfx-" + w), w + "：样子在 weather-fx.css 里");
      assert.equal(p.scale > 1, tier === "near" && ["sand", "snow", "thunder", "phase"].includes(w), `${w} ${tier}：跟不跟镜头放大`);
    }
    // 不另写背景 / 动画；#251 起沙暴只在减少动态效果时把正式画面那层停住（原型自己的沙雾在 .hd2d-sand，不是这一层）
    const rules = [...mine.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(new RegExp("\\.wfx-" + w + "(?![\\w-])[^{]*\\{([^}]*)\\}", "g"))].map(m => m[1]);
    assert.ok(rules.every(r => !/background/.test(r) && (!/animation/.test(r) || (w === "sand" && /animation: none/.test(r)))), w + "：原型的 hd2d.css 不另画（不另写背景 / 动画）");
  }
  // 相位：阶段跟着投影里的 phaseStep（0 波谷 / 1 平衡 / 2 波峰 / 3 平衡）
  [[0, "trough"], [1, "balance"], [2, "peak"], [3, "balance"]].forEach(([step, name]) => {
    wfx.sync({ weather: "phase", theme: "day", phaseStep: step, tier: "far" });
    assert.equal(wfx.host.querySelector("wfx").dataset.phaseStep, name, "相位 " + step);
  });
  // 只有雷鸣不让 weather-fx.js 自己打闪电；只有酸雨的涟漪落在地台上
  all.forEach(w => {
    const p = W.plan({ weather: w, tier: "far" });
    assert.equal(p.strikes, w !== "thunder", w + "：strikes");
    assert.equal(p.ripples, w === "acid", w + "：ripples");
    assert.equal(p.flash > 0, w === "thunder", w + "：打雷闪白时淡掉");
  });
  assert.equal(W.plan({ weather: "rain" }).weather, "none", "认不得的天气不叠");
});

test("雷鸣（#240）：2D 层只留正式画面的暗色云影和紫调——不打闪电、不闪区域（3D 场景已经有雷击，不重复），也不下雨；3D 打雷闪白的那一下 2D 层跟着淡掉（不把闪白压暗一块），雷过去就回来；换别的天气不再跟着闪", () => {
  const P = wfxPage();
  let flash = 0;
  const wfx = P.W.create(P.stage, { flash: () => flash }), host = wfx.host;
  wfx.sync({ weather: "thunder", theme: "night", tier: "far" });
  P.runTimers(10); P.runFrames(1);
  const layer = host.querySelector("wfx-thunder");
  assert.ok(layer && layer.innerHTML === "<i></i><i></i>" && layer.children.length === 0, "只有两层云影：没有区域闪光（u）、闪电（s），也没有雨");
  assert.equal(P.timers.length, 0, "weather-fx.js 没开雷击的计时链");
  assert.ok(!/rain|雨/.test(read("weather-fx.css").split("\n").filter(l => /wfx-thunder/.test(l)).join("\n")), "正式画面的雷鸣层本来就没有雨");
  // 打雷：2D 层跟着淡掉（× 配置的 flash），雷过去就回来
  const cfg = P.W.WFX.weather.thunder.flash;
  assert.ok(cfg > 0 && cfg <= 1);
  flash = 1; P.runFrames(1);
  assert.equal(host.style.getPropertyValue("--wfx-flash"), cfg.toFixed(3), "闪白最亮时淡掉 flash 那么多");
  flash = 0.4; P.runFrames(1);
  assert.equal(host.style.getPropertyValue("--wfx-flash"), (0.4 * cfg).toFixed(3));
  flash = 0; P.runFrames(1);
  assert.equal(host.style.getPropertyValue("--wfx-flash"), "0.000", "雷过去就回来");
  // 换成沙暴：不再每帧读闪光，淡掉的也回来
  flash = 1; wfx.sync({ weather: "sand", theme: "night", sandDir: "E", tier: "far" });
  P.runFrames(3);
  assert.equal(host.style.getPropertyValue("--wfx-flash"), "0.000", "沙暴不跟着闪");
  assert.equal(P.frames.size, 0, "不在雷鸣时不占动画帧");
  // CSS：整层的不透明度跟着 --wfx-flash；场景把这一帧的闪光给出来；3D 的雷鸣照旧不下雨（hd2d-weather.js 的 WEATHER.thunder 没有粒子）
  assert.ok(/\.hd2d-wfx \{[^}]*opacity: calc\(1 - var\(--wfx-flash, 0\)\)/.test(HP.protoCss()), "2D 层跟着闪光淡掉");
  assert.ok(/get flash\(\) \{ return weather\.flash; \}/.test(fs.readFileSync(path.join(DIR, "hd2d-scene.js"), "utf8")), "场景给出这一帧的闪光");
  assert.ok(!/thunder: \{[^}]*kind:/.test(fs.readFileSync(path.join(DIR, "hd2d-weather.js"), "utf8")), "3D 的雷鸣照旧没有雨粒子");
});

/* ---------- 9. 酸雨的涟漪落在地台上 ---------- */
/** 点在不在多边形里（屏幕坐标） */
function inPoly(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/** 解 hd2d.css 里一条 scale / translate 的值（只认这里用到的：数、var(--x, 默认)、calc(… N% …)），pct = 百分比对着的长度 */
function cssVal(token, vars, pct) {
  let e = token.replace(/var\((--[\w-]+), ([\d.]+)\)/g, (m, k, d) => String(k in vars ? vars[k] : Number(d)));
  e = e.replace(/calc\(/g, "(").replace(/([\d.]+)%/g, (m, num) => `(${num} / 100 * ${pct})`);
  assert.ok(/^[\d.\s()+\-*/]+$/.test(e), "认得的写法：" + token);
  return Function("return " + e)();
}
/** 按最外层的空格切开（calc(…) 里的空格不切） */
function splitTop(s) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of s.trim()) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === " " && !depth) { if (cur) out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
test("酸雨的涟漪（#240）：落在地台顶面上（三个演示 × 远 / 中 / 近，按这一刻的镜头投到屏幕上，都在某个区的地台轮廓里、深渊的洞口外、顶栏和技能栏之间），不在天上；近景只落在看的那个区（别的区被景深糊掉了）；按镜头俯角压扁、越近越大，压扁 / 放大以后中心还在落点；涟漪的画法、动画照旧是 weather-fx.css 的", () => {
  const W = wfxm(), C = cams(), FXM = require("../hd2d/hd2d-fx.js"), css = HP.protoCss();
  for (const id of Object.keys(DEMOS)) {
    const { layout } = demoLayout(id);
    for (const tier of ["far", "mid", "near"]) {
      const focus = layout.zones[layout.zones.length - 1].id, p = C.pose(layout, tier, focus), only = W.plan({ weather: "acid", tier, zone: focus }).rippleZones;
      assert.deepEqual(only, tier === "near" ? [focus] : null, tier + "：涟漪落在哪几个区");
      const cam = FXM.lens({ pos: p.pos, target: p.target, fov: p.fov, width: DESKTOP.width, height: DESKTOP.height });
      const polys = layout.zones.map(z => {
        const pts = z.outline && z.outline.pts ? z.outline.pts : [{ x: -z.w / 2, z: -z.d / 2 }, { x: z.w / 2, z: -z.d / 2 }, { x: z.w / 2, z: z.d / 2 }, { x: -z.w / 2, z: z.d / 2 }];
        const hole = z.hole > 0 ? Array.from({ length: 24 }, (_, i) => L.project(cam, { x: z.cx + Math.cos(i / 24 * Math.PI * 2) * z.hole, y: z.topY, z: z.cz + Math.sin(i / 24 * Math.PI * 2) * z.hole })) : null;
        return { id: z.id, poly: pts.map(q => L.project(cam, { x: z.cx + q.x, y: z.topY, z: z.cz + q.z })), hole };
      });
      const rand = seeded(3), hits = new Map(), tag = `${id} ${tier}`;
      let got = 0;
      for (let i = 0; i < 300; i++) {
        const s = W.rippleAt(layout, cam, rand, DESKTOP, only);
        if (!s) continue;
        got++;
        const x = s.x / 100 * DESKTOP.width, y = s.y / 100 * DESKTOP.height;
        assert.ok(y >= DESKTOP.top && y <= DESKTOP.height - DESKTOP.bottom && x >= 0 && x <= DESKTOP.width, tag + "：涟漪落在画面外 / 界面底下");
        // 屏幕上前后的地台会叠住一点（高地的顶面投上去盖住后面的区）：在哪几个区的轮廓里都算
        const inside = polys.filter(q => inPoly(q.poly, x, y)).filter(q => !q.hole || !inPoly(q.hole, x, y));
        assert.ok(inside.length, `${tag}：涟漪（${x.toFixed(0)}, ${y.toFixed(0)}）没落在任何一个区的地台上（或者落进了深渊的洞口）`);
        if (tier === "near") assert.ok(inside.some(q => q.id === focus), `${tag}：近景的涟漪没落在看的那个区`);
        hits.set(inside[0].id, (hits.get(inside[0].id) || 0) + 1);
      }
      assert.ok(got > 200, `${tag}：300 下只落了 ${got} 个`);
      if (tier === "far") assert.equal(hits.size, layout.zones.length, id + " 远景：每个区都下着");
    }
  }
  // 压扁 / 放大：俯角越低越扁（sin 俯角）、越近越大
  const tiers = [["far"], ["mid"], ["near"], ["near", true]].map(([tier, close]) => W.plan({ weather: "acid", tier, close }));
  tiers.forEach(p => assert.ok(Math.abs(p.squash - Math.sin(W.elevationOf(p.tier) * Math.PI / 180)) < 1e-9 && p.squash < 0.6, p.tier + "：按俯角压扁"));
  tiers.slice(1).forEach((p, i) => assert.ok(p.squash < tiers[i].squash && p.rippleScale > tiers[i].rippleScale, p.tier + "：越近越扁（俯角越低）、越大"));
  // hd2d.css：用单独的 scale / translate 叠在 weather-fx.css 的涟漪动画（transform: translate(-50%, -50%) scale(k)）外面；
  // 按 CSS 的合成顺序（translate · scale · transform，绕盒子中心）算一遍：涟漪横向放大 rs、纵向 rs × sq，中心还在落点（left / top）
  const rule = /\.hd2d-wfx \.wfx-acid b \{([^}]*)\}/.exec(css);
  assert.ok(rule && !/background|animation|transform:/.test(rule[1]), "只加 scale / translate，涟漪的画法、动画、transform 都是 weather-fx.css 的");
  assert.ok(/\.wfx-acid b \{[^}]*transform: translate\(-50%, -50%\) scale\(\.08\)/.test(read("weather-fx.css")), "正式画面的涟漪：transform 把盒子中心放在 left / top");
  const prop = (k) => splitTop(new RegExp("(?:^|;|\\s)" + k + ": ([^;]+);").exec(rule[1])[1]);
  for (const [rs, sq] of [[1, 1], [1.7, 0.41], [2, 0.34], [0.8, 0.5]]) {
    const vars = { "--wfx-rs": rs, "--wfx-sq": sq }, w = 120, h = 104;
    const [sx, sy] = prop("scale").map(t => cssVal(t, vars, 0)), [tx, ty] = prop("translate").map((t, i) => cssVal(t, vars, i ? h : w));
    assert.ok(Math.abs(sx - rs) < 1e-9 && Math.abs(sy - rs * sq) < 1e-9, "横向放大 rs、纵向再压扁 sq");
    // 盒子中心（相对绕着转的中心是 0, 0）：transform 先挪到 (−w/2, −h/2)（动画里 scale(k) 对中心没有影响），再 scale、再 translate；加回 (w/2, h/2) 就是相对盒子左上角（= left / top）的位置
    const cx = sx * (-w / 2) + tx + w / 2, cy = sy * (-h / 2) + ty + h / 2;
    assert.ok(Math.abs(cx) < 1e-9 && Math.abs(cy) < 1e-9, `rs=${rs} sq=${sq}：中心偏离落点 (${cx.toFixed(2)}, ${cy.toFixed(2)})`);
  }
  // 假网页：酸雨时 weather-fx.js 问 rippleAt 落在哪（页面给这一刻的镜头和画面），涟漪都在地台上；压扁 / 放大写在 2D 层上
  const P = wfxPage(), { layout } = demoLayout("cross"), pose = C.pose(layout, "far", 3);
  const cam = FXM.lens({ pos: pose.pos, target: pose.target, fov: pose.fov, width: DESKTOP.width, height: DESKTOP.height });
  const wfx = P.W.create(P.stage, { lens: () => cam, view: () => DESKTOP, random: seeded(9) });
  const pl = wfx.sync({ weather: "acid", theme: "night", tier: "far", layout });
  P.runTimers(30);
  const bs = wfx.host.querySelector("wfx-acid").children;
  assert.ok(bs.length >= 20, "下着涟漪");
  const polys = layout.zones.map(z => z.outline.pts.map(q => L.project(cam, { x: z.cx + q.x, y: z.topY, z: z.cz + q.z })));
  bs.forEach(b => {
    const m = /^left:([\d.]+)%;top:([\d.]+)%;/.exec(b.style.cssText), x = m[1] / 100 * DESKTOP.width, y = m[2] / 100 * DESKTOP.height;
    assert.ok(polys.some(poly => inPoly(poly, x, y)), "页面里的涟漪落在地台上");
  });
  assert.equal(wfx.host.style.getPropertyValue("--wfx-sq"), pl.squash.toFixed(3));
  assert.equal(wfx.host.style.getPropertyValue("--wfx-rs"), String(pl.rippleScale));
  assert.ok(wfx.host.classList.contains("is-night"), "夜晚样子（正式画面：涟漪更亮）");
});

/* ---------- 10. 原型页接线（其他天气）---------- */
test("原型页（#240）：2D 层拿到这一刻的镜头（酸雨的涟漪落在地台上）、画面大小（让开顶栏和技能栏）、雷击的闪光（雷鸣闪白时淡掉）和布局；网址 ?weather= 换天气（截图用）是往战斗状态里写，画面照样只读投影", () => {
  const html = HP.readPage("index.html"), mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(/wfx = WX\.create\(\$\("stage"\), \{ lens: \(\) => HD2DFx\.lens\(sc\.lensNow\(\)\), view: \(\) => sc\.view\(\), flash: \(\) => sc\.flash \}\)/.test(mod), "镜头、画面、闪光交给 2D 层");
  assert.ok(/reduced: !sc\.motion, layout: wfxLayout/.test(mod), "布局交给 2D 层");
  assert.ok(/params\.get\("weather"\)/.test(mod) && /st\.weather = weatherPick\.weather/.test(mod) && /st = demo\.make\(pageRegion\(\)\);\s*(?:placeLook\(\);\s*)?pickWeather\(\);/.test(mod), "?weather= 写进战斗状态（换演示也带着）");
  assert.ok(/sandDirOptions\(\)\.includes\(weatherPick\.wind\)/.test(mod), "?wind= 只认这块棋盘能用的风向");
  // 规则环境里照页面的做法把演示战场改成酸雨再投影：投影里是改过的天气，2D 层照它叠
  const ctx = H.load(), st = DEMOS.cross(ctx.BattleSim);
  st.weather = "acid";
  const pv = projectIn(ctx, st);
  assert.equal(pv.weather, "acid", "投影里是改过的天气");
  const p = wfxm().plan({ weather: pv.weather, theme: pv.light, sandDir: pv.sandDir, phaseStep: pv.phaseStep, tier: "far" });
  assert.ok(p.weather === "acid" && p.ripples && p.night);
});

/* ---------- 11. #251：沙暴还不够明显——要有旧画面那种翻滚的大团沙雾 ---------- */
// 主人试玩反馈 · 三续（issue #251）：桌面 1440×900 截图对比，原型的沙暴还是比旧战斗画面弱很多——远景只是整体偏黄一点，近景只有几条很细的横线和零星沙粒，
// 大团的沙雾基本看不见。查下来是颜色：正式画面的沙雾（214, 164, 96）和沙地（地台的沙）、沙暴的 3D 雾色亮度只差几个百分点（旧画面画在浅灰的战场上才看得见）。
// 2D 层：原型自己铺一层更深、更浑（偏棕灰）的沙雾（.hd2d-sand：整层的雾、远处更浓的一层、一团团飘过的沙雾），正式画面那两层大沙雾也换成这种颜色；
// 3D：远景剪影几乎被沙色吞掉，沙粒更多更大，再加一层粗的沙线。只改原型；正式画面（weather-fx.css / weather-fx.js）一个字没改

/** 颜色 [r, g, b]（0–255，直接按 sRGB 值算）的亮度（Rec. 709 的系数）、饱和度（HSV）、色相（度） */
const lumOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const satOf = (c) => { const mx = Math.max(...c), mn = Math.min(...c); return mx ? (mx - mn) / mx : 0; };
function hueOf(c) {
  const [r, g, b] = c, mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const rgbList = (s) => String(s).split(",").map(Number);   // "r, g, b" → [r, g, b]
const hexRgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
/** 正式画面的沙雾颜色（weather-fx.css 的 .wfx-sand 的 --sand / --sand2；傍晚 / 夜晚是 .g-app.is-night .wfx-sand 的） */
const OFFICIAL_SAND = { day: [[214, 164, 96], [190, 132, 66]], night: [[196, 156, 108], [170, 128, 84]] };
/** 正式画面的沙暴规则（weather-fx.css，#240 时的样子）：#251 一个字没改 */
const OFFICIAL_SAND_CSS = [
  `.wfx-sand { --dx: 1; --dy: 0; --peak: .7; --sand: 214, 164, 96; --sand2: 190, 132, 66;
  background: rgba(var(--sand), .06); }
.wfx-sand[data-sand-dir="21"], .wfx-sand[data-sand-dir="W"] { --dx: -1; --dy: 0; }
.wfx-sand[data-sand-dir="S"] { --dx: 0; --dy: 1; }
.wfx-sand[data-sand-dir="N"] { --dx: 0; --dy: -1; }
.wfx-sand i { inset: -40%; opacity: 0; filter: blur(18px); will-change: transform, opacity;
  background:
    radial-gradient(ellipse 22% 16% at 30% 40%, rgba(var(--sand), .95), transparent 70%),
    radial-gradient(ellipse 28% 20% at 55% 62%, rgba(var(--sand2), .85), transparent 72%),
    radial-gradient(ellipse 18% 24% at 72% 35%, rgba(var(--sand), .8), transparent 70%),
    radial-gradient(ellipse 30% 14% at 45% 22%, rgba(var(--sand2), .6), transparent 70%),
    radial-gradient(ellipse 25% 18% at 20% 75%, rgba(var(--sand), .7), transparent 72%);
  animation: wfxGust 7s cubic-bezier(.45, .05, .55, .95) infinite; }
.wfx-sand i + i { animation-duration: 5.3s; animation-delay: -2.4s; --peak2: .75;
  background:
    radial-gradient(ellipse 34% 12% at 40% 50%, rgba(var(--sand2), .8), transparent 70%),
    radial-gradient(ellipse 20% 16% at 65% 28%, rgba(var(--sand), .75), transparent 70%),
    radial-gradient(ellipse 24% 20% at 25% 30%, rgba(var(--sand), .6), transparent 72%),
    radial-gradient(ellipse 26% 14% at 60% 78%, rgba(var(--sand2), .7), transparent 70%); }`,
  `@keyframes wfxGust {
  0%   { transform: translate(calc(var(--dx) * -38%), calc(var(--dy) * -38%)); opacity: 0; }
  20%  { opacity: calc(var(--peak) * var(--peak2, 1) * .7); }
  35%  { opacity: calc(var(--peak) * var(--peak2, 1)); }
  55%  { opacity: calc(var(--peak) * var(--peak2, 1) * .35); }
  65%, 100% { transform: translate(calc(var(--dx) * 38%), calc(var(--dy) * 38%)); opacity: 0; }
}
.g-app.is-night .wfx-sand { --peak: .5; --sand: 196, 156, 108; --sand2: 170, 128, 84; background: rgba(var(--sand), .05); }`,
  `@media (prefers-reduced-motion: reduce) { .wfx i { animation: none !important; } .wfx-sand i { opacity: .15; transform: none; }`
];
/** #251 以前的沙粒（hd2d-weather.js 的 WEATHER.sand / AMBIENT.sand）、远景蒙的沙色（WEATHER.sand 的 sky / haze / veil / sun） */
const OLD_GRAINS = { count: 1600, size: 0.16, streak: 520, ambient: { count: 160, size: 0.26 } };
const OLD_DUST = { sky: 0.5, haze: 0.42, veil: 0.35, sun: 0.6 };
/** 光影主题的天幕四色（hd2d-scene.js 的 THEMES[].sky，同上面 #240 那条） */
const SKY_OF = { day: ["#f6e3b4", "#ecc98c", "#dcac6a", "#c29a66"], dusk: ["#ffc47c", "#f28a5a", "#b9587a", "#4b3368"], night: ["#2f4673", "#1d2d52", "#101b38", "#060b1a"] };
/** 沙地：地台顶面的沙（hd2d-world.js 的 dune 贴图底色）、地台外面那一大片地（hd2d-layout.js 的 GROUNDS.desert.ground） */
function sandGround() {
  const m = /dune: \(\) => canvasTex\("dune", \d+, \(g, s, r\) => \{\s*g\.fillStyle = "#([0-9a-f]{6})"/.exec(fs.readFileSync(path.join(DIR, "hd2d-world.js"), "utf8"));
  return { dune: hexRgb(parseInt(m ? m[1] : "d0aa6c", 16)), ground: hexRgb(L.GROUNDS.desert.ground) };
}
/** 一块地台在这一刻的镜头里占屏幕多大（像素；伸出画面的那截不算） */
function platformBox(cam, z, view) {
  const pts = z.outline && z.outline.pts && z.outline.pts.length >= 3 ? z.outline.pts : [{ x: -z.w / 2, z: -z.d / 2 }, { x: z.w / 2, z: -z.d / 2 }, { x: z.w / 2, z: z.d / 2 }, { x: -z.w / 2, z: z.d / 2 }];
  const s = pts.map(q => L.project(cam, { x: z.cx + q.x, y: z.topY, z: z.cz + q.z }));
  const x0 = Math.max(0, Math.min(...s.map(q => q.x))), x1 = Math.min(view.width, Math.max(...s.map(q => q.x)));
  const y0 = Math.max(0, Math.min(...s.map(q => q.y))), y1 = Math.min(view.height, Math.max(...s.map(q => q.y)));
  return { w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}
/** css 里每个以 head（以「{」结尾）开头的块的内容（花括号配对） */
function cssBlocks(css, head) {
  const out = [];
  for (let i = css.indexOf(head); i >= 0; i = css.indexOf(head, i + 1)) {
    let depth = 0, j = i + head.length - 1;
    for (; j < css.length; j++) { if (css[j] === "{") depth++; else if (css[j] === "}" && --depth === 0) break; }
    out.push(css.slice(i + head.length, j));
  }
  return out;
}
/** s 里第一个 name(…) 的参数（按最外层的逗号切开） */
function callArgs(s, name) {
  const out = [];
  let depth = 0, cur = "";
  for (let j = s.indexOf(name + "(") + name.length; j < s.length; j++) {
    const ch = s[j];
    if (ch === "(" && ++depth === 1) continue;
    if (ch === ")" && --depth === 0) { out.push(cur.trim()); break; }
    if (ch === "," && depth === 1) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  return out;
}
/** 解 hd2d.css 里一个 translate 分量（只认这里用到的：var(--x)、calc(…)、数、vw / vh、%（对着团自己的宽 / 高 size）） */
function cssCalc(expr, vars, view, size) {
  let e = expr.replace(/var\((--[\w-]+)\)/g, (m, k) => { assert.ok(k in vars, "认得的变量：" + k); return "(" + vars[k] + ")"; });
  e = e.replace(/calc\(/g, "(").replace(/([\d.]+)vw/g, (m, n) => `(${n} * ${view.width / 100})`).replace(/([\d.]+)vh/g, (m, n) => `(${n} * ${view.height / 100})`)
    .replace(/([\d.]+)%/g, (m, n) => `(${n} / 100 * ${size})`);
  assert.ok(/^[\d.\s()+\-*/]+$/.test(e), "认得的写法：" + expr);
  return Function("return " + e)();
}
const flatCss = (f) => (f === "hd2d.css" ? HP.protoCss() : fs.readFileSync(path.join(DIR, f), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");   // 去掉注释

test("沙暴的 2D 沙雾团（#251）：数量、大小、浓淡都达到配置的下限（WFX.sand.min）——三个演示 × 桌面 / 手机 × 远 / 中 / 近，每一团看得出是雾的那一块都盖得住半个地台以上；颜色比沙地更深、更浑（偏棕灰），不再和沙地一个颜色；沙雾在铭牌底下，铭牌照样看得清", () => {
  const P = wfxPage({ seed: 21 }), W = P.W, C = cams(), FXM = require("../hd2d/hd2d-fx.js");
  assert.ok(W.WFX.sand && W.WFX.sand.min, "沙雾的数值在配置里（WFX.sand）");
  const S = W.WFX.sand, M = S.min;
  // 下限本身要够（不然调成 0 也能过）：至少 6 团、盖住半个地台、远处那层挡得住远处（≥ 0.45）、近处那层半透明但看得见（≥ 0.3）
  assert.ok(M.count >= 6 && M.cover >= 0.5 && M.opacity.far >= 0.45 && M.opacity.near >= 0.3 && M.deep >= 0.5 && M.still >= 0.3, "下限太低：" + JSON.stringify(M));
  const wfx = W.create(P.stage), host = wfx.host;
  wfx.sync({ weather: "sand", theme: "day", sandDir: "E", tier: "far" });
  const layer = host.querySelector("hd2d-sand");
  assert.ok(layer && layer.parentElement === host, "2D 层里铺着原型自己的沙雾（.hd2d-sand）");
  const puffs = layer.querySelectorAll("puff"), prop = (el, k) => el.style.getPropertyValue(k);
  assert.equal(puffs.length, S.puffs.far.n + S.puffs.near.n, "远处一层、近处一层");
  assert.ok(puffs.length >= M.count, `只有 ${puffs.length} 团沙雾（下限 ${M.count}）`);
  const vmaxOf = (el, k) => { const m = /^([\d.]+)vmax$/.exec(prop(el, k)); assert.ok(m, `${k} 用 vmax：${prop(el, k)}`); return Number(m[1]); };
  const sizes = puffs.map(el => {
    const lay = el.classList.contains("far") ? "far" : "near", o = Number(prop(el, "--o")), w = vmaxOf(el, "--w"), h = vmaxOf(el, "--h");
    assert.ok(o >= M.opacity[lay] && o < 0.75, `${lay} 那层一团最浓 ${o}（下限 ${M.opacity[lay]}；也别浓成实的一块）`);
    assert.ok(w >= S.puffs[lay].w[0] && h >= S.puffs[lay].h[0] && w > h, lay + "：大小在配置的范围里，横着的一团");
    return { w, h };
  });
  // 尺寸：每一团（配置里最小的那种也算）在屏幕上看得出是雾的那一块（框 × core）≥ 半个地台（cover × 地台在屏幕上的宽 / 高）。
  // 远景看每个区的地台，中景 / 近景看选中的那个区；vmax 按画面长的那一边换成像素，再 × 这一段的放大（zoom）
  const least = { w: Math.min(S.puffs.far.w[0], S.puffs.near.w[0], ...sizes.map(q => q.w)), h: Math.min(S.puffs.far.h[0], S.puffs.near.h[0], ...sizes.map(q => q.h)) };
  for (const [tagV, view, portrait] of [["桌面", DESKTOP, false], ["手机", PHONE, true]]) {
    const px = Math.max(view.width, view.height) / 100;
    for (const id of Object.keys(DEMOS)) {
      const { layout } = demoLayout(id, { view, portrait });
      for (const tier of ["far", "mid", "near"]) {
        const zoom = W.plan({ weather: "sand", tier }).sand.zoom, pw = least.w * px * zoom * S.core, ph = least.h * px * zoom * S.core;
        const cases = tier === "far" ? [{ zone: layout.zones[0].id, zones: layout.zones }] : layout.zones.map(z => ({ zone: z.id, zones: [z] }));
        cases.forEach(({ zone, zones }) => {
          const p = C.pose(layout, tier, zone), cam = FXM.lens({ pos: p.pos, target: p.target, fov: p.fov, width: view.width, height: view.height });
          zones.forEach(z => {
            const b = platformBox(cam, z, view);
            assert.ok(pw >= M.cover * b.w && ph >= M.cover * b.h, `${tagV} ${id} ${tier} ${z.id} 区：地台 ${b.w.toFixed(0)}×${b.h.toFixed(0)}，最小的一团看得出的只有 ${pw.toFixed(0)}×${ph.toFixed(0)}，盖不住半个`);
          });
        });
      }
    }
  }
  // 颜色：比沙地（地台的沙、地台外面的地）更深、更浑（饱和度更低，偏棕灰）；正式画面的沙雾和地台的沙几乎一样亮（这就是以前看不见的原因）
  const G = sandGround(), day = W.plan({ weather: "sand", theme: "day", tier: "far" }).sand;
  [...day.colors, day.gust.sand, day.gust.sand2].map(rgbList).forEach(c => {
    assert.ok(lumOf(c) <= 0.75 * lumOf(G.dune) && lumOf(c) < lumOf(G.ground), `沙雾 ${c} 不比沙地深`);
    assert.ok(satOf(c) <= satOf(G.dune) - 0.04 && satOf(c) < satOf(G.ground), `沙雾 ${c} 不比沙地浑`);
  });
  assert.ok(Math.abs(lumOf(OFFICIAL_SAND.day[0]) - lumOf(G.dune)) / lumOf(G.dune) < 0.05, "（以前）正式画面的沙雾和地台的沙几乎一样亮");
  // 每种光影都比正式画面同一种样子的沙雾深、浑（白天比白天的；傍晚 / 夜晚比正式画面的夜晚样子）
  for (const theme of ["day", "dusk", "night"]) {
    const sp = W.plan({ weather: "sand", theme, tier: "far" }).sand, off = OFFICIAL_SAND[theme === "day" ? "day" : "night"];
    [...sp.colors, sp.gust.sand, sp.gust.sand2].map(rgbList).forEach(c => assert.ok(lumOf(c) <= 0.8 * lumOf(off[0]) && satOf(c) < satOf(off[0]), `${theme}：沙雾 ${c} 不比正式画面的深、浑`));
  }
  // 铭牌照样看得清：沙雾在 2D 层里（铭牌层下面），不用 backdrop-filter / mix-blend-mode（糊不到铭牌上）；铭牌自己有不透明的底，沙雾再浓，字也看得清
  const css = flatCss("hd2d.css"), zOf = (sel) => Number(new RegExp(sel.replace(/[.#]/g, "\\$&") + " \\{[^}]*z-index: (\\d+)").exec(css)[1]);
  assert.ok(W.WFX.z < zOf(".hd2d-labels"), "2D 层在铭牌下面");
  const sandRules = [...css.matchAll(/([^{}]*(?:hd2d-sand|wfx-sand)[^{}]*)\{([^}]*)\}/g)];
  assert.ok(sandRules.length && sandRules.every(m => !/backdrop-filter|mix-blend-mode/.test(m[2])), "沙雾不糊到铭牌上");
  const bgAlpha = (sel) => { const m = new RegExp(sel.replace(/[.]/g, "\\.") + " \\{[^}]*background: [^;]*rgba\\(\\d+, \\d+, \\d+, ([\\d.]+)\\);").exec(css); return m ? Number(m[1]) : 0; };
  assert.ok(bgAlpha(".pl-card") >= 0.9 && bgAlpha(".pl-big") >= 0.9, "铭牌自己有不透明的底");
});

test("沙雾有层次（#251）：远处更浓——画面上沿（最远的地方）压一层厚的沙雾往下变淡，3D 的雾、远景蒙的沙色在那里接上；远处那层沙雾团在画面上半截，小、浓、慢，近处那层大、淡、快；三段镜头都明显：远景整体最浑、看不清远处，越近沙团越大（近景从眼前飘过）；换段只换变量，沙雾不从头飘", () => {
  const W = wfxm(), S = W.WFX.sand;
  assert.ok(S && typeof W.hazeAt === "function" && typeof W.sandPuffs === "function", "整层的雾多浓、一团团放在哪都是纯函数");
  const tiers = [["far"], ["mid"], ["near"], ["near", true]].map(([tier, close]) => W.plan({ weather: "sand", theme: "day", sandDir: "E", tier, close }));
  assert.deepEqual(tiers.map(p => p.tier), ["far", "mid", "near", "close"]);
  tiers.forEach(p => {
    assert.ok(p.sand, p.tier + "：有沙雾");
    const top = W.hazeAt(p.sand, 0);
    assert.ok(top >= S.min.deep, `${p.tier}：画面上沿（最远的地方）只蒙 ${top.toFixed(2)}`);
    for (let i = 1; i <= 20; i++) assert.ok(W.hazeAt(p.sand, i / 20) <= W.hazeAt(p.sand, (i - 1) / 20) + 1e-9, p.tier + "：越往下（越近）越淡");
    const bottom = W.hazeAt(p.sand, 1);
    assert.ok(Math.abs(bottom - p.sand.veil.o) < 1e-9 && bottom <= 0.2, p.tier + "：画面下沿（最近的地方）只蒙薄薄一层");
  });
  const [far, mid, near, close] = tiers;
  assert.ok(W.hazeAt(far.sand, 0.5) >= 0.15, `远景整体浑浊：画面中间也蒙着（${W.hazeAt(far.sand, 0.5).toFixed(2)}）`);
  assert.ok(far.sand.veil.o > mid.sand.veil.o && mid.sand.veil.o > near.sand.veil.o && near.sand.veil.o >= close.sand.veil.o, "远景整体最浑");
  assert.ok(far.sand.zoom < mid.sand.zoom && mid.sand.zoom < near.sand.zoom && near.sand.zoom < close.sand.zoom && near.sand.zoom >= 1.5, "越近沙团越大（近景从眼前飘过）");
  assert.equal(W.plan({ weather: "snow", tier: "far" }).sand, null, "别的天气没有");
  // 远处那层（横风时）在画面上半截，小、浓、慢；近处那层大、淡、快
  const avg = (l, k) => l.reduce((a, q) => a + q[k], 0) / l.length;
  for (const seed of [1, 2, 3]) {
    const list = W.sandPuffs("E", seeded(seed), DESKTOP.width / DESKTOP.height), fp = list.filter(q => q.layer === "far"), np = list.filter(q => q.layer === "near");
    assert.ok(fp.length === S.puffs.far.n && np.length === S.puffs.near.n);
    assert.ok(fp.every(q => q.y <= 0.5), "远处那层在画面上半截（画面上沿是最远的地方）");
    assert.ok(avg(fp, "w") < avg(np, "w") && avg(fp, "o") > avg(np, "o") && avg(fp, "t") > avg(np, "t"), "远处那层小、浓、慢；近处那层大、淡、快");
  }
  // 页面：整层的雾、放大写在 .hd2d-sand 上（hd2d.css 读）；换段只换变量、不重建一团团的（不会每换一段就从头飘）
  const P = wfxPage(), wfx = P.W.create(P.stage);
  wfx.sync({ weather: "sand", theme: "day", sandDir: "E", tier: "far" });
  const layer = wfx.host.querySelector("hd2d-sand"), before = layer.querySelectorAll("puff"), v = (k) => layer.style.getPropertyValue(k);
  const pct = (x) => (x * 100).toFixed(2) + "%";
  [["far"], ["mid"], ["near"], ["near", true], ["far"]].forEach(([tier, close]) => {
    const p = wfx.sync({ weather: "sand", theme: "day", sandDir: "E", tier, close }), after = layer.querySelectorAll("puff");
    assert.ok(after.length === before.length && after.every((el, i) => el === before[i]), p.tier + "：换段不重建");
    assert.ok(Number(v("--veil")) === p.sand.veil.o && Number(v("--deep")) === p.sand.deep.o && Number(v("--deep-mid")) === p.sand.deep.mid && Number(v("--zoom")) === p.sand.zoom, p.tier + "：浓淡 / 放大写在层上");
    assert.ok(v("--deep-at") === pct(p.sand.deep.at) && v("--deep-to") === pct(p.sand.deep.to) && v("--veil-c") === p.sand.veil.c && v("--deep-c") === p.sand.deep.c, p.tier + "：远处那一层的渐变");
  });
  // hd2d.css：.deep 的渐变、.veil、.puff 的放大都读这些变量（和 hazeAt 同一套）；换段时渐变
  const css = flatCss("hd2d.css");
  assert.ok(/\.hd2d-sand > \.deep \{[^}]*opacity: var\(--deep, 0\)[^}]*background: linear-gradient\(180deg, rgb\(var\(--deep-c\)\) 0%, rgba\(var\(--deep-c\), var\(--deep-mid\)\) var\(--deep-at\), rgba\(var\(--deep-c\), 0\) var\(--deep-to\)\)/.test(css), "远处那一层：上沿最浓 → at 处剩 mid → to 处淡到 0");
  assert.ok(/\.hd2d-sand > \.veil \{[^}]*background: rgb\(var\(--veil-c\)\); opacity: var\(--veil, 0\)/.test(css), "整层蒙的");
  assert.ok(/\.hd2d-sand > \.puff \{[^}]*scale: var\(--zoom, 1\)[^}]*transition: scale var\(--wfx-t/.test(css), "一团团跟着镜头放大，换段时渐变");
});

test("沙雾顺着风飘（#251）：风向跟着投影里的 sandDir（和正式画面那层、3D 的沙粒一个方向，竖屏跟着转）——一团团从上风那边整团在画面外飘进来、从下风那边整团飘出去，风朝镜头吹时越飘越大；换了风向才重新铺，换光影只换颜色；减少动态效果时不飘，停在各自的位置上照样铺满画面（正式画面那两层也停住，比 weather-fx.css 停住时的 0.15 浓）", () => {
  const P = wfxPage({ seed: 8 }), W = P.W, S = W.WFX.sand, wfx = W.create(P.stage), host = wfx.host, css = flatCss("hd2d.css");
  // data-sand-dir → 往哪边飘（和 weather-fx.css 的 .wfx-sand 一样：E 往右 / W 往左 / S 往下 / N 往上）
  const vecOf = (d) => {
    const m = new RegExp('\\.hd2d-sand\\[data-sand-dir="' + d + '"\\] \\{ --dx: (-?\\d); --dy: (-?\\d); \\}').exec(css) || /\.hd2d-sand \{[^}]*--dx: (-?\d); --dy: (-?\d);/.exec(css);
    assert.ok(m, "风向表：" + d);
    return [Number(m[1]), Number(m[2])];
  };
  assert.deepEqual(["E", "W", "S", "N"].map(vecOf), [[1, 0], [-1, 0], [0, 1], [0, -1]], "风向表");
  // 规则的风向 × 横竖屏：2D 沙雾和正式画面那层往同一边（3D 的沙粒也是这个风，见 #240 那条）；换了风向才重新铺
  let last = null, lastDir = null;
  for (const portrait of [false, true]) for (const dir of ["12", "21", "E", "W", "S", "N"]) {
    const p = wfx.sync({ weather: "sand", theme: "day", sandDir: dir, portrait, tier: "far" });
    const layer = host.querySelector("hd2d-sand"), fx = host.querySelector("wfx-sand"), puffs = layer.querySelectorAll("puff");
    assert.equal(p.sandDir, W.screenDir(W.windOf(dir, portrait)));
    assert.ok(layer.dataset.sandDir === p.sandDir && fx.dataset.sandDir === p.sandDir, `${dir}${portrait ? " 竖屏" : ""}：2D 沙雾和正式画面那层往同一边（${p.sandDir}）`);
    if (last) assert.equal(puffs[0] === last[0], p.sandDir === lastDir, "换了风向才重新铺");
    last = puffs; lastDir = p.sandDir;
  }
  // 飘一趟（hd2d.css 的 @keyframes hd2d-puff，按 CSS 的算法代进去算）：开头整团在上风那边画面外，结尾整团出了下风那边，横着那个方向不动；
  // 风朝镜头吹（S）时从小飘到大，往远处吹（N）反过来，横风不变
  const kf = cssBlocks(css, "@keyframes hd2d-puff {")[0];
  assert.ok(kf, "一团团飘的动画");
  const frame = (k) => { const m = new RegExp("(?:^|\\s)" + k + "% \\{([^}]*)\\}").exec(kf); assert.ok(m, k + "%"); return m[1]; };
  assert.ok(/opacity: 0/.test(frame(0)) && /opacity: 0/.test(frame(100)) && /12%, 88% \{ opacity: var\(--o\); \}/.test(kf), "两头淡入淡出，中间是这一团的浓淡");
  for (const dir of ["E", "W", "S", "N"]) {
    const [dx, dy] = vecOf(dir), view = DESKTOP, px = Math.max(view.width, view.height) / 100;
    W.sandPuffs(dir, seeded(3), view.width / view.height).forEach(q => {
      const w = q.w * px, h = q.h * px, vars = { "--dx": dx, "--dy": dy, "--u": Number(q.u.toFixed(3)) }, tag = `${dir} ${q.layer}`;
      const at = (k) => { const [a, b] = callArgs(frame(k), "translate"); return { x: q.x * view.width + cssCalc(a, vars, view, w), y: q.y * view.height + cssCalc(b, vars, view, h) }; };
      const s = at(0), e = at(100), tol = 1;
      if (dir === "E") assert.ok(s.x + w / 2 <= tol && e.x - w / 2 >= view.width - tol, tag + "：从左边画面外飘到右边画面外");
      if (dir === "W") assert.ok(s.x - w / 2 >= view.width - tol && e.x + w / 2 <= tol, tag + "：从右边画面外飘到左边画面外");
      if (dir === "S") assert.ok(s.y + h / 2 <= tol && e.y - h / 2 >= view.height - tol, tag + "：从上边画面外飘到下边画面外");
      if (dir === "N") assert.ok(s.y - h / 2 >= view.height - tol && e.y + h / 2 <= tol, tag + "：从下边画面外飘到上边画面外");
      const cross = dx ? [s.y, e.y, q.y * view.height] : [s.x, e.x, q.x * view.width];
      assert.ok(Math.abs(cross[0] - cross[2]) < 1e-6 && Math.abs(cross[1] - cross[2]) < 1e-6, tag + "：横着那个方向不动");
      assert.ok(dir === "S" ? q.s0 < 1 && q.s1 > 1 : dir === "N" ? q.s0 > 1 && q.s1 < 1 : q.s0 === 1 && q.s1 === 1, tag + "：风朝镜头吹时越飘越大");
      if (dx) assert.ok(q.layer === "near" || q.y <= 0.5, tag + "：横风时远处那层在画面上半截");
    });
  }
  assert.ok(/scale\(var\(--s0, 1\)\)/.test(frame(0)) && /scale\(var\(--s1, 1\)\)/.test(frame(100)), "一趟里从 --s0 放大到 --s1");
  // 减少动态效果：不飘，停在各自的位置上（--x / --y），照样铺满画面；正式画面那两层也停住，浓淡用 --still
  const p = wfx.sync({ weather: "sand", theme: "day", sandDir: "E", tier: "far", reduced: true });
  assert.ok(p.still && host.classList.contains("still"), "减少动态效果：2D 层带上 still");
  const layer = host.querySelector("hd2d-sand"), puffs = layer.querySelectorAll("puff"), fx = host.querySelector("wfx-sand"), prop = (el, k) => el.style.getPropertyValue(k);
  assert.ok(puffs.length >= S.min.count, "沙雾照样在");
  puffs.forEach(el => assert.ok(Number(prop(el, "--o")) >= S.min.opacity[el.classList.contains("far") ? "far" : "near"], "停住时照样那么浓"));
  const vw = Math.max(DESKTOP.width, DESKTOP.height) / 100;
  const spans = puffs.map(el => { const x = parseFloat(prop(el, "--x")) / 100 * DESKTOP.width, w = parseFloat(prop(el, "--w")) * vw * S.core; return [x - w / 2, x + w / 2]; }).sort((a, b) => a[0] - b[0]);
  let covered = 0, reach = 0;
  spans.forEach(([a, b]) => { const lo = Math.max(a, reach, 0), hi = Math.min(b, DESKTOP.width); if (hi > lo) covered += hi - lo; reach = Math.max(reach, hi); });
  assert.ok(covered >= 0.85 * DESKTOP.width, `停住时一团团铺开：只盖住画面宽度的 ${(covered / DESKTOP.width * 100).toFixed(0)}%`);
  assert.ok(/\.hd2d-wfx\.still \.hd2d-sand > \.puff \{ animation: none; opacity: var\(--o\); \}/.test(css), "still：一团团不飘，停在那里照样那么浓");
  assert.ok(/\.hd2d-wfx\.still \.wfx-sand i \{ animation: none; transform: none; opacity: var\(--still, \.15\); \}/.test(css), "still：正式画面那两层也停住，浓淡用 --still");
  const media = cssBlocks(css, "@media (prefers-reduced-motion: reduce) {").join("\n");
  assert.ok(/\.hd2d-sand > \.puff \{ animation: none; opacity: var\(--o\);/.test(media) && /\.hd2d-wfx \.wfx-sand i \{ opacity: var\(--still, \.15\); \}/.test(media), "系统的减少动态效果：马上停住（不用等重排）");
  assert.ok(Number(prop(fx, "--still")) === S.gust.still && S.gust.still >= S.min.still && S.gust.still > 0.15, "停住的大沙雾比正式画面停住时（0.15）浓");
  assert.ok(!wfx.sync({ weather: "sand", theme: "day", sandDir: "E", tier: "far" }).still && !host.classList.contains("still"), "不减少动态效果时不带 still");
  // 换光影只换颜色（--c0 / --c1），不重铺
  const before = host.querySelector("hd2d-sand").querySelectorAll("puff"), pn = wfx.sync({ weather: "sand", theme: "night", sandDir: "E", tier: "far" }), now = host.querySelector("hd2d-sand");
  assert.ok(now.querySelectorAll("puff").every((el, i) => el === before[i]) && prop(now, "--c0") === pn.sand.colors[0] && prop(now, "--c1") === pn.sand.colors[1], "换光影只换颜色");
  assert.ok(/\.hd2d-sand > \.puff \{[^}]*--c: var\(--c0\)/.test(css) && /\.hd2d-sand > \.puff\.t1 \{ --c: var\(--c1\); \}/.test(css), "一团一团交替两种色调");
  // 不是沙暴：拿掉；dispose 也拿掉
  wfx.sync({ weather: "snow", theme: "day", tier: "far" });
  assert.ok(host.querySelector("hd2d-sand") === null && wfx.plan.sand === null, "换成别的天气就拿掉");
  wfx.sync({ weather: "sand", theme: "day", sandDir: "W", tier: "far" });
  wfx.dispose();
  assert.equal(host.parentElement, null);
});

test("正式画面那两层大沙雾在原型里换成更深更浑的棕灰（#251：行内的 --sand / --sand2 / --peak 盖过 weather-fx.css 的，画法照旧），正式画面的默认参数一点没变——weather-fx.css 的沙暴规则一个字没改，WeatherFx.sync 不给新参数时生成的和以前一样；原型的样式都挂在原型自己的类名底下", () => {
  const P = wfxPage(), W = P.W, wfx = W.create(P.stage);
  assert.ok(W.WFX.sand && W.WFX.sand.gust, "正式画面那层在原型里的颜色在配置里（WFX.sand.gust）");
  for (const theme of ["day", "dusk", "night"]) {
    const p = wfx.sync({ weather: "sand", theme, sandDir: "E", tier: "far" }), G = W.WFX.sand.gust[theme];
    const fx = wfx.host.querySelector("wfx-sand"), v = (k) => fx.style.getPropertyValue(k);
    assert.ok(v("--sand") === G.sand.join(", ") && v("--sand2") === G.sand2.join(", ") && Number(v("--peak")) === G.peak && Number(v("--still")) === W.WFX.sand.gust.still, theme + "：行内变量");
    // 最浓不比正式画面同一种样子淡（weather-fx.css：白天 --peak .7，夜晚样子 .5；傍晚在正式画面也算夜晚）
    assert.ok(p.sand.gust.sand === v("--sand") && G.peak >= (theme === "day" ? 0.7 : 0.5), theme + "：最浓不比正式画面淡");
    assert.equal(fx.innerHTML, "<i></i><i></i>", "画法还是 weather-fx.js / weather-fx.css 的两层");
  }
  // 正式画面：只加载 weather-fx.js、不给新参数——沙暴的叠加层和以前一模一样（没有行内变量、没有别的东西、不开计时器）
  const F = wfxPage({ only: true }), field = F.doc.createElement("div");
  F.doc.body.appendChild(field);
  const fx = F.WF.sync({ field, weather: "sand", sandDir: "W" });
  assert.ok(fx.className === "wfx wfx-sand" && fx.innerHTML === "<i></i><i></i>" && fx.children.length === 0 && fx.dataset.sandDir === "W", "正式画面的沙暴层照旧");
  assert.deepEqual(fx.style.props, {}, "正式画面不写行内变量");
  assert.equal(F.timers.length, 0, "沙暴不开计时器");
  assert.ok(F.WF.sync.length <= 1 && /function sync\(opt\)/.test(read("weather-fx.js")), "WeatherFx.sync 还是那一个参数");
  // weather-fx.css 的沙暴规则一个字没改
  const official = read("weather-fx.css");
  OFFICIAL_SAND_CSS.forEach(block => assert.ok(official.includes(block), "正式画面的沙暴规则改了：" + block.split("\n")[0]));
  // 原型的样式都挂在原型自己的类名底下（.hd2d-wfx / .hd2d-sand）；正式画面（game.html）不加载原型的样式 / 脚本；game.js 照旧不给新参数
  const sels = [...flatCss("hd2d.css").matchAll(/([^{}]+)\{/g)].map(m => m[1].trim()).filter(s => /wfx-sand|hd2d-sand/.test(s));
  assert.ok(sels.length && sels.every(s => s.split(",").every(x => /^\.hd2d-(wfx|sand)\b/.test(x.trim()))), "原型的沙暴样式都在 .hd2d-wfx / .hd2d-sand 底下：" + sels.join(" | "));
  assert.ok(!/hd2d\.css|hd2d-wfx\.js/.test(read("game.html")), "正式画面不加载原型的样式 / 脚本");
  assert.ok(/WeatherFx\.sync\(\{ field: fieldEl, app: \$\("g-app"\), weather: env\.weather, sandDir: state\.sandDir, phaseStep: state\.phaseStep \}\)/.test(read("game.js")), "正式画面照旧这样调");
});

test("3D 的雾和 2D 层配合（#251）：沙暴的 3D 雾比晴天浓、越远越浓（三个演示 × 远 / 中 / 近 × 每个区）；远景几乎被沙色吞掉——中景剪影离雾色只剩晴天的三成以下、天幕盖上八成沙色（以前只蒙 0.35 / 0.5，剪影清清楚楚）；2D 的沙雾比 3D 的雾色深、色调接得上（以前正式画面的沙雾和雾色一样亮，所以看不见）", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { B, WX } = P, C = cams(), F = sceneFog(), W = wfxm();
  try {
    // 1. 雾：比晴天浓，越远越浓
    for (const id of Object.keys(DEMOS)) {
      const { layout, pv } = demoLayout(id), b = layout.bounds, tint = WX.weatherPlan("sand", pv.light).tint, mx = (b.minX + b.maxX) / 2;
      for (const tier of ["far", "mid", "near"]) for (const zone of layout.zones) {
        const p = C.pose(layout, tier, zone.id), c = p.cam, tag = `${id} ${tier} ${zone.id} 区`;
        const depth = (q) => (c.pos.x - q.x) * c.back.x + (c.pos.y - q.y) * c.back.y + (c.pos.z - q.z) * c.back.z;
        const fogAt = (tn, q) => { const r = WX.fogRange(layout, p.fogShift, tn, F.depth); return smooth(r.near, r.far, depth(q)); };
        const pts = [{ x: zone.cx, y: zone.topY, z: zone.cz }].concat([0, 5, 10, 20].map(d => ({ x: mx, y: 0, z: b.minZ - d })));
        const sand = pts.map(q => fogAt(tint, q)), clear = pts.map(q => fogAt(null, q));
        sand.forEach((v, i) => assert.ok(v >= clear[i] - 1e-9, tag + "：沙暴的雾不比晴天淡"));
        sand.slice(2).forEach((v, i) => assert.ok(v >= sand[i + 1] - 1e-9, tag + "：越远越浓"));
        assert.ok(sand[1] >= clear[1] + 0.05 && sand[2] >= clear[2] + 0.18 && sand[3] >= clear[3] + 0.2 && sand[4] >= 0.95,
          `${tag}：战场后面比晴天浓得多、最远处几乎全进雾（${sand.slice(1).map(x => x.toFixed(2))} / 晴天 ${clear.slice(1).map(x => x.toFixed(2))}）`);
      }
    }
    // 2. 远景几乎被吞掉
    const tint0 = WX.weatherPlan("sand", "day").tint;
    assert.ok(tint0.sky >= 0.75 && tint0.veil >= 0.75 && tint0.haze >= 0.55 && tint0.sun <= 0.35, "远景蒙多少在配置里（WEATHER.sand 的 sky / haze / veil / sun）");
    const { layout } = demoLayout("desert"), b = layout.bounds;
    const dist = (a, c) => Math.hypot(a.r - c.r, a.g - c.g, a.b - c.b);
    const props = (bd) => { const out = []; bd.group.traverse(o => { if (o.isMesh && o.material && o.material.type === "MeshStandardMaterial") out.push(o.material.color); }); return out; };
    const skyU = (bd) => bd.group.children.find(o => o.material && o.material.uniforms && o.material.uniforms.c0).material.uniforms;
    for (const theme of ["day", "dusk", "night"]) for (const kind of ["desert", "mine", "city"]) {
      const tint = WX.weatherPlan("sand", theme).tint, fog = WX.fogColor(F.theme[theme], tint), tag = `${theme} ${kind}`;
      const build = (d) => B.buildBackdrop(kind, b, theme, layout.camera, d ? { sky: SKY_OF[theme], fog: fog.getHex(), dust: Object.assign({ color: fog.getHex() }, d) } : { sky: SKY_OF[theme], fog: F.theme[theme] });
      const calm = build(null), now = build({ sky: tint.sky, haze: tint.haze, veil: tint.veil, sun: tint.sun }), old = build(OLD_DUST);
      const base = props(calm).reduce((a, c) => a + dist(c, fog), 0) / props(calm).length;
      const avgK = (bd) => props(bd).reduce((a, c) => a + dist(c, fog), 0) / props(bd).length / base, maxK = (bd) => Math.max(...props(bd).map(c => dist(c, fog))) / base;
      assert.ok(avgK(now) <= 0.3 && maxK(now) <= 0.45, `${tag}：剪影离雾色还有晴天的 ${avgK(now).toFixed(2)}（最近那层 ${maxK(now).toFixed(2)}），没被吞掉`);
      assert.ok(avgK(old) > 0.3 && maxK(old) > 0.45, `${tag}：以前那样蒙就达不到（${avgK(old).toFixed(2)} / ${maxK(old).toFixed(2)}）`);
      ["c0", "c1", "c2", "c3"].forEach(k => assert.ok(dist(skyU(now)[k].value, fog) <= 0.25 * dist(skyU(calm)[k].value, fog) + 1e-6, `${tag}：天幕的 ${k} 没被沙色盖住`));
      [calm, now, old].forEach(bd => bd.dispose());
    }
    // 3. 2D 的沙雾和 3D 的雾：每种光影都比 3D 的雾色深（亮度 ≤ 八成）、色相差不到 20°（同一片沙尘，接得上）；以前正式画面的沙雾和白天的雾色只差几个百分点
    for (const theme of ["day", "dusk", "night"]) {
      const f = hexRgb(WX.fogColor(F.theme[theme], WX.weatherPlan("sand", theme).tint).getHex()), sp = W.plan({ weather: "sand", theme, tier: "far" }).sand;
      [...sp.colors, sp.gust.sand, sp.gust.sand2, sp.deep.c].map(rgbList).forEach(c => {
        assert.ok(lumOf(c) <= 0.8 * lumOf(f), `${theme}：2D 的沙雾 ${c} 不比 3D 的雾色 ${f} 深`);
        const dh = Math.abs(hueOf(c) - hueOf(f));
        assert.ok(Math.min(dh, 360 - dh) <= 20, `${theme}：2D 的沙雾 ${c} 和 3D 的雾色 ${f} 色调接不上`);
      });
    }
    const fDay = hexRgb(WX.fogColor(F.theme.day, tint0).getHex());
    assert.ok(Math.abs(lumOf(OFFICIAL_SAND.day[0]) - lumOf(fDay)) / lumOf(fDay) < 0.05, "（以前看不见的原因）正式画面的沙雾和白天沙暴的雾色几乎一样亮");
  } finally { P.restore(); }
});

test("横飞的沙粒 / 沙线更多、更粗（#251）：沙粒更多更大、拖影更多、大团沙尘更大更多；再加一层粗的沙线（两片交叉的长条，世界里有宽度——越近越粗，近景时更明显），顺着风横飞、尾巴淡掉；别的天气不加", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { THREE, WX } = P, W = wfxm(), C = cams(), FXM = require("../hd2d/hd2d-fx.js");
  try {
    const S = WX.WEATHER.sand, A = WX.AMBIENT.sand;
    assert.ok(S.count >= OLD_GRAINS.count * 1.3 && S.size >= OLD_GRAINS.size * 1.2, `沙粒更多更大（${S.count} 颗 / ${S.size}）`);
    assert.ok(S.streak.count > OLD_GRAINS.streak, "细拖影更多");
    assert.ok(A.count > OLD_GRAINS.ambient.count && A.size >= OLD_GRAINS.ambient.size * 1.4, "大团沙尘更多更大");
    const R = WX.weatherPlan("sand", "day").ribbon;
    assert.ok(R && R.kind === "ribbons" && R.count >= 300 && R.width >= 0.05 && R.len >= 1 && R.wind && R.taper < 1, "粗的沙线在配置里（WEATHER.sand.ribbon），顺着风");
    ["snow", "acid", "thunder", "heat", "glow", "phase", "none"].forEach(w => assert.equal(WX.weatherPlan(w, "day").ribbon, null, w + "：没有粗沙线"));
    // 场景里：一层 Mesh，每条 12 个顶点（两片 × 两个三角）；顺着风、头上宽 width、尾巴细一点、头上不透明尾巴透明
    const scene = new THREE.Scene(), fx = WX.createWeather(scene, { bounds: { minX: -13.4, maxX: 13.4, minZ: -8.5, maxZ: 8.5 } });
    fx.set("sand", "day");
    for (const dir of ["E", "W", "S", "N"]) {
      const wind = W.windOf(dir, false);
      fx.setWind(wind);
      fx.update(1 / 60, 3, { dt: 1 / 60 });
      const meshes = [];
      scene.traverse(o => { if (o.isMesh && o.geometry.attributes.color && o.geometry.attributes.color.itemSize === 4) meshes.push(o); });
      assert.equal(meshes.length, 1, "一层粗沙线");
      const m = meshes[0], a = m.geometry.attributes.position.array, col = m.geometry.attributes.color.array;
      assert.equal(a.length, R.count * 12 * 3, "每条 12 个顶点");
      assert.ok(m.material.vertexColors && m.material.transparent && !m.material.depthWrite && m.material.side === THREE.DoubleSide && !m.material.fog, "半透明、两面都画、不吃雾（和别的粒子一样）");
      for (let i = 0; i < R.count; i++) {
        const v = (j) => { const o = (i * 12 + j) * 3; return [a[o], a[o + 1], a[o + 2]]; };
        const len = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        // 竖着那片：0 头 +、1 尾 +、2 头 −、5 尾 −；平着那片：6 头 +、7 尾 +、8 头 −、11 尾 −
        const H = v(0), T = v(1), dx = H[0] - T[0], dz = H[2] - T[2], h = Math.hypot(dx, dz);
        assert.ok(h > R.len * 0.9 && (dx * wind.x + dz * wind.z) / h > 0.95, `风往 ${dir}：沙线不是顺着风的`);
        assert.ok(Math.abs(len(v(0), v(2)) - R.width) < 1e-4 && Math.abs(len(v(6), v(8)) - R.width) < 1e-4, "头上宽 width（两片都是）");
        assert.ok(Math.abs(len(v(1), v(5)) - R.width * R.taper) < 1e-4, "尾巴细一点");
        assert.ok(Math.abs(v(0)[1] - v(2)[1] - R.width) < 1e-4 && Math.abs(v(6)[1] - v(8)[1]) < 1e-6, "一片竖着、一片平着（镜头从哪边看都有一片对着它）");
        assert.ok(col[(i * 12) * 4 + 3] === 1 && col[(i * 12 + 1) * 4 + 3] === 0, "头上不透明、尾巴淡到 0");
      }
    }
    // 近景时更明显：同一条沙线 / 同一颗沙粒（世界里的宽度），在近景的镜头里比远景粗得多
    const { layout } = demoLayout("desert");
    layout.zones.forEach(z => {
      const px = (tier) => {
        const p = C.pose(layout, tier, z.id), cam = FXM.lens({ pos: p.pos, target: p.target, fov: p.fov, width: DESKTOP.width, height: DESKTOP.height });
        const at = { x: z.cx, y: z.topY + 1, z: z.cz };
        return Math.abs(L.project(cam, at).y - L.project(cam, { x: at.x, y: at.y + R.width, z: at.z }).y);
      };
      const far = px("far"), near = px("near");
      assert.ok(far >= 1.5 && near >= 2 * far && near >= 4, `${z.id} 区：粗沙线远景 ${far.toFixed(1)}px、近景 ${near.toFixed(1)}px`);
    });
    fx.dispose();
    assert.equal(scene.children.length, 0, "天气拿掉后不留东西（粗沙线也拿掉）");
  } finally { P.restore(); }
});
