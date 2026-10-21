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
const L = require("../prototypes/hd2d/hd2d-layout.js");
const OV = require("../online-view.js");

// 缺这几个文件 / 函数时只是这几条失败（每条测试里各自 require）
const wfxm = () => require("../prototypes/hd2d/hd2d-wfx.js");
const cams = () => require("../prototypes/hd2d/hd2d-camera.js");

const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "prototypes", "hd2d");
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
  const files = opts.only ? ["weather-fx.js"] : ["prototypes/hd2d/hd2d-layout.js", "prototypes/hd2d/hd2d-camera.js", "weather-fx.js", "prototypes/hd2d/hd2d-wfx.js"];
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
      return /\\/(prototypes\\/hd2d|vendor\\/three)\\//.test(r.url) ? Object.assign({}, r, { format: "module" }) : r;
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
  assert.ok(!/\.wfx-sand/.test(fs.readFileSync(path.join(DIR, "hd2d.css"), "utf8")), "原型的 hd2d.css 不另画沙暴");
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
  const css = fs.readFileSync(path.join(DIR, "hd2d.css"), "utf8");
  assert.ok(/\.hd2d-wfx > \.wfx \{[^}]*opacity: var\(--wfx-o, 1\)[^}]*transform: scale\(var\(--wfx-s, 1\)\)/.test(css), "整层的不透明度 / 放大读 hd2d-wfx.js 写的变量");
  assert.ok(/@media \(prefers-reduced-motion: reduce\) \{ \.hd2d-wfx > \.wfx \{ transition: none; \} \}/.test(css), "减少动态效果：不渐变");
  assert.ok(!/\.hd2d-wfx[^{]*\{[^}]*animation/.test(css), "原型不给 2D 层另加动画（减少动态效果照 weather-fx.css 的处理）");
  // 页面：换段 / 特写时跟着换
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
  assert.ok(/syncUrl\(\);\s*syncWeather\(\);/.test(html), "镜头变了（syncCamera）就重排一次 2D 层");
  assert.ok(/tier: camInfo \? camInfo\.tier : sc\.tier, close: !!\(camInfo && camInfo\.close != null\), zone: camInfo \? camInfo\.zone : sc\.zone, reduced: !sc\.motion/.test(html), "段、特写、看的那个区、减少动态效果交给 2D 层");
});

/* ---------- 6. 原型页接线 ---------- */
test("原型页（#240）：原样加载 weather-fx.css / weather-fx.js（正式画面一行没改），2D 层在 #stage 里：3D 画布之上、铭牌之下，界面面板在上面，不挡鼠标；只读投影里的天气 / 风向 / 相位 / 光影，3D 沙粒按同一个风飞；假网页里加载不报错", () => {
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8"), css = fs.readFileSync(path.join(DIR, "hd2d.css"), "utf8");
  const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(html.indexOf('href="../../weather-fx.css"') > 0 && html.indexOf('href="../../weather-fx.css"') < html.indexOf('href="hd2d.css"'), "weather-fx.css 在 hd2d.css 前面（原型的样式能盖过它）");
  assert.ok(html.indexOf('src="../../weather-fx.js"') > 0 && html.indexOf('src="hd2d-wfx.js"') > html.indexOf('src="../../weather-fx.js"') && html.indexOf('src="hd2d-wfx.js"') < html.indexOf('<script type="module">'), "加载 weather-fx.js 和 hd2d-wfx.js");
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
  const P = wfxPage(), W = P.W, wfx = W.create(P.stage), css = read("weather-fx.css"), mine = fs.readFileSync(path.join(DIR, "hd2d.css"), "utf8");
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
    assert.ok(!new RegExp("\\.wfx-" + w + "(?![\\w-])[^{]*\\{[^}]*(background|animation)").test(mine), w + "：原型的 hd2d.css 不另画（不另写背景 / 动画）");
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
  assert.ok(/\.hd2d-wfx \{[^}]*opacity: calc\(1 - var\(--wfx-flash, 0\)\)/.test(fs.readFileSync(path.join(DIR, "hd2d.css"), "utf8")), "2D 层跟着闪光淡掉");
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
  const W = wfxm(), C = cams(), FXM = require("../prototypes/hd2d/hd2d-fx.js"), css = fs.readFileSync(path.join(DIR, "hd2d.css"), "utf8");
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
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8"), mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(/wfx = WX\.create\(\$\("stage"\), \{ lens: \(\) => HD2DFx\.lens\(sc\.lensNow\(\)\), view: \(\) => sc\.view\(\), flash: \(\) => sc\.flash \}\)/.test(mod), "镜头、画面、闪光交给 2D 层");
  assert.ok(/reduced: !sc\.motion, layout: wfxLayout/.test(mod), "布局交给 2D 层");
  assert.ok(/params\.get\("weather"\)/.test(mod) && /st\.weather = weatherPick\.weather/.test(mod) && /st = demo\.make\(pageRegion\(\)\);\s*pickWeather\(\);/.test(mod), "?weather= 写进战斗状态（换演示也带着）");
  assert.ok(/sandDirOptions\(\)\.includes\(weatherPick\.wind\)/.test(mod), "?wind= 只认这块棋盘能用的风向");
  // 规则环境里照页面的做法把演示战场改成酸雨再投影：投影里是改过的天气，2D 层照它叠
  const ctx = H.load(), st = DEMOS.cross(ctx.BattleSim);
  st.weather = "acid";
  const pv = projectIn(ctx, st);
  assert.equal(pv.weather, "acid", "投影里是改过的天气");
  const p = wfxm().plan({ weather: pv.weather, theme: pv.light, sandDir: pv.sandDir, phaseStep: pv.phaseStep, tier: "far" });
  assert.ok(p.weather === "acid" && p.ripples && p.night);
});
