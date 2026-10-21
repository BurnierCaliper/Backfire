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
/** opts.reduced = 系统开了「减少动态效果」。计时器不真的跑：记下来，测试里手动推（timers） */
function wfxPage(opts) {
  const doc = fakeDom(), timers = [];
  const sandbox = {
    document: doc, console, Math,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    matchMedia: (q) => ({ matches: !!(opts && opts.reduced) && /prefers-reduced-motion: reduce/.test(q) })
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of ["weather-fx.js", "prototypes/hd2d/hd2d-wfx.js"]) vm.runInContext(read(f), ctx, { filename: f });
  const stage = doc.createElement("div");
  doc.body.appendChild(stage);
  return { doc, stage, timers, WF: sandbox.WeatherFx, W: sandbox.HD2DWfx };
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
      assert.ok(tint.sky > 0 && tint.haze > B.BACKDROP.haze && tint.veil > 0, "沙暴的远景蒙多少在配置里（WEATHER.sand 的 sky / haze / veil）");
      const dust = { color: fog.getHex(), sky: tint.sky, haze: tint.haze, veil: tint.veil };
      const calm = B.buildBackdrop(kind, b, theme, layout.camera, { sky: SKY[theme], fog: F.theme[theme] });
      const sand = B.buildBackdrop(kind, b, theme, layout.camera, { sky: SKY[theme], fog: fog.getHex(), dust });
      const skyOf = (bd) => bd.group.children.find(o => o.material && o.material.uniforms && o.material.uniforms.c0).material.uniforms;
      const su = skyOf(sand), cu = skyOf(calm);
      ["c0", "c1", "c2", "c3"].forEach(k => assert.ok(dist(su[k].value, fog) < dist(cu[k].value, fog) - 0.01, `${tag}：天幕的 ${k} 没有往沙黄的雾色靠`));
      assert.ok(su.hazeH.value === tint.haze && cu.hazeH.value === B.BACKDROP.haze, tag + "：贴地的雾更高");
      assert.ok(su.stars.value === 0 && su.clouds.value === 0, tag + "：星星、亮云看不见");
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
  assert.ok(/tier: camInfo \? camInfo\.tier : sc\.tier, close: !!\(camInfo && camInfo\.close != null\), reduced: !sc\.motion/.test(html), "段、特写、减少动态效果交给 2D 层");
});

/* ---------- 6. 原型页接线 ---------- */
test("原型页（#240）：原样加载 weather-fx.css / weather-fx.js（正式画面一行没改），2D 层在 #stage 里：3D 画布之上、铭牌之下，界面面板在上面，不挡鼠标；只读投影里的天气 / 风向 / 相位 / 光影，3D 沙粒按同一个风飞；假网页里加载不报错", () => {
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8"), css = fs.readFileSync(path.join(DIR, "hd2d.css"), "utf8");
  const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(html.indexOf('href="../../weather-fx.css"') > 0 && html.indexOf('href="../../weather-fx.css"') < html.indexOf('href="hd2d.css"'), "weather-fx.css 在 hd2d.css 前面（原型的样式能盖过它）");
  assert.ok(html.indexOf('src="../../weather-fx.js"') > 0 && html.indexOf('src="hd2d-wfx.js"') > html.indexOf('src="../../weather-fx.js"') && html.indexOf('src="hd2d-wfx.js"') < html.indexOf('<script type="module">'), "加载 weather-fx.js 和 hd2d-wfx.js");
  assert.ok(/wfx = WX\.create\(\$\("stage"\)\)/.test(mod), "2D 层放在 #stage 里");
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
