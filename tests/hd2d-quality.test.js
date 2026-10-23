// 新画面（3D 战场）的画质选项（#321，hd2d/hd2d-field.js · FIELD.quality，暂停页面 pause-menu.js 里那一项）：
//   · 自动 / 高 / 低，记在本机（localStorage，读写都包 try/catch），单机 / 联机同一个设置
//   · 低 = 像素比最多 1、关掉景深和泛光；高 = 和以前一样；自动 = 先用高，满帧画时一直卡（场景叫 onSlow）就降到低（只这一次打开页面）
//   · 场景（hd2d-scene.js · setQuality）马上换上；有演出在播时告诉场景照常满帧（options.busy）
// 都是 Node 能跑的：hd2d-field.js 在 vm 里按页面跑，场景、天气的 2D 层换成假的，暂停页面用真的 pause-menu.js（没有网页，只登记、不画）；场景的接线查源码
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");   // 去掉注释，只看代码
const field = () => require("../hd2d/hd2d-field.js");
const mem = (init) => { const m = new Map(Object.entries(init || {})); return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; };
const settle = () => new Promise(r => setImmediate(r));

test("#321 画质的配置都在 FIELD.quality：本机记住的键、三档（自动 / 高 / 低）、默认自动；低 = 像素比最多 1、不加景深和泛光；高 = 和以前一样；自动先用高、卡了降到低", () => {
  const F = field(), Q = F.FIELD.quality;
  assert.equal(Q.storageKey, "backfire-hd2d-quality");
  assert.deepEqual(Q.choices, ["auto", "high", "low"]);
  assert.equal(Q.dflt, "auto");
  assert.deepEqual(Q.levels.low, { pixelRatio: 1, bokeh: false, bloom: false });
  assert.deepEqual(Q.levels.high, { pixelRatio: 2, bokeh: true, bloom: true });
  assert.deepEqual(Q.auto, { from: "high", to: "low" });
  // 场景没给画质时（原型页）用的就是高：和以前一样
  const scfg = /const QUALITY = (\{[^}]*\});/.exec(read("hd2d/hd2d-scene.js"));
  assert.ok(scfg, "场景里的默认画质");
  assert.deepEqual(Function("return " + scfg[1])(), Q.levels.high);
});

test("#321 画质记在本机（读写都包 try/catch）：没记过 / 认不得 / 读不了 = 自动；点一下按 自动 → 高 → 低 → 自动 换；自动用高、卡过用低，选了高 / 低就不降", () => {
  const F = field(), s = mem();
  assert.equal(F.quality(s), "auto", "没记过：自动");
  assert.equal(F.setQuality("low", s), true);
  assert.equal(s.m.get(F.FIELD.quality.storageKey), "low");
  assert.equal(F.quality(s), "low", "记住了");
  s.m.set(F.FIELD.quality.storageKey, "超高");
  assert.equal(F.quality(s), "auto", "认不得：按默认");
  assert.equal(F.setQuality("超高", s), false, "认不得的不记");
  const bad = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("QuotaExceededError"); } };
  assert.equal(F.quality(bad), "auto", "读不了：按默认");
  assert.equal(F.setQuality("low", bad), false, "存不了：不报错");
  assert.equal(F.quality(null), "auto");
  assert.deepEqual(["auto", "high", "low"].map(F.nextQuality), ["high", "low", "auto"]);
  assert.equal(F.levelOf("auto", false), "high");
  assert.equal(F.levelOf("auto", true), "low", "自动：一直卡就降一档");
  assert.equal(F.levelOf("high", true), "high", "选了高：不降");
  assert.equal(F.levelOf("low", false), "low");
  const src = code(read("hd2d/hd2d-field.js"));
  const get = src.slice(src.indexOf("function quality("), src.indexOf("function setQuality("));
  const set = src.slice(src.indexOf("function setQuality("), src.indexOf("function levelOf("));
  assert.match(get, /try \{[\s\S]*getItem\(Q\.storageKey\)[\s\S]*\} catch/, "读在 try 里");
  assert.match(set, /try \{[\s\S]*setItem\(FIELD\.quality\.storageKey, choice\)[\s\S]*\} catch/, "写在 try 里");
});

/* ---------- 页面里走一遍（场景是假的：WebGL 在 Node 里跑不了） ---------- */
function fakeDoc() {
  const els = {};
  const make = (tag, id) => {
    const cls = new Set();
    const e = {
      tagName: String(tag).toUpperCase(), children: [], parentNode: null, attrs: {}, listeners: {}, hidden: false, textContent: "", title: "", type: "",
      style: { setProperty() {} }, offsetHeight: 30, clientWidth: 1100, clientHeight: 620,
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; if (v) cls.add(c); else cls.delete(c); return v; } },
      get className() { return [...cls].join(" "); },
      set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => cls.add(c)); },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, removeEventListener() {},
      appendChild(c) { if (c.parentNode) c.remove(); c.parentNode = this; this.children.push(c); return c; },
      append(...cs) { cs.forEach(c => this.appendChild(c)); },
      remove() { if (this.parentNode) { const k = this.parentNode.children; k.splice(k.indexOf(this), 1); this.parentNode = null; } },
      querySelector() { return null; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 1100, height: 620 }; }
    };
    if (id) els[id] = e;
    return e;
  };
  make("button", "g-hd2d-toggle"); make("div", "g-app"); make("main", "g-field");
  return { els, doc: { getElementById: (id) => els[id] || null, createElement: (t) => make(t), head: make("head") } };
}
/** 页面：hd2d-field.js（按页面跑）+ 真的 pause-menu.js；场景假的（记下开场的选项、setQuality 叫了几次）。old = 浏览器缓存里还是旧的场景包（没有 setQuality） */
function page(storage, opts) {
  opts = opts || {};
  const sandbox = { console, setTimeout, clearTimeout, performance };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  ["hd2d/hd2d-layout.js", "hd2d/hd2d-camera.js", "hd2d/hd2d-fx.js", "hd2d/hd2d-field.js", "pause-menu.js"].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  ctx.HD2DWfx = { windOf: () => ({ x: 1, z: 0 }), create: () => ({ sync() {}, dispose() {} }) };
  ctx.GAME = { depth: 0, refresh() {}, snapAll: () => [] };
  const log = { options: null, quality: [], scenes: 0 };
  const create = (stage, options) => {
    log.scenes++; log.options = options;
    const sc = { portrait: false, motion: true, tier: "far", zone: null, flash: 0, view: () => ({ width: 1100, height: 620, top: 0, bottom: 0 }), setInsets() {}, setBattle() {}, refit() {}, setMarks() {}, setActor() {}, setWind() {}, setTier() {}, stepZone() {}, lensNow: () => null, plateOf: () => null, zoneOf: () => null, dispose() {} };
    if (!opts.old) sc.setQuality = (q) => log.quality.push(q);
    return sc;
  };
  const P = fakeDoc();
  ctx.HD2DField.boot({ doc: P.doc, storage, load: () => Promise.resolve(create), hint: () => {}, reduced: () => true, pauseMenu: ctx.PauseMenu });
  const item = () => ctx.PauseMenu.list().find(r => r.id === "quality") || null;
  return { ctx, log, item, F: ctx.HD2DField, PM: ctx.PauseMenu, els: P.els };
}

test("#321 暂停页面里的「画质」（新画面开着时才有）：点一下换下一档（菜单不收起）、记在本机、马上交给场景（setQuality）；单机 / 联机同一个；开场按记着的那一档建场景", async () => {
  const F = field(), Q = F.FIELD.quality, s = mem({ [F.FIELD.storageKey]: "on" });
  const p = page(s);
  await settle(); await settle();
  assert.equal(p.log.scenes, 1, "建好了");
  assert.deepEqual(JSON.parse(JSON.stringify(p.log.options.quality)), Q.levels.high, "没记过 = 自动：先用高");
  const T = p.PM.CONFIG.items.quality;
  assert.ok(T && T.label === "画质" && T.hint, "名字、说明在 PAUSE_MENU.items.quality");
  assert.equal(p.item().label, T.auto);
  assert.equal(p.item().hint, T.hint);
  // 点一下：高 → 低 → 自动（菜单不收起：stay）
  assert.equal(p.PM.choose("quality"), true);
  assert.equal(s.m.get(Q.storageKey), "high");
  assert.deepEqual(JSON.parse(JSON.stringify(p.log.quality.pop())), Q.levels.high);
  assert.equal(p.item().label, T.high);
  p.PM.choose("quality");
  assert.equal(s.m.get(Q.storageKey), "low", "记在本机");
  assert.deepEqual(JSON.parse(JSON.stringify(p.log.quality.pop())), Q.levels.low, "低：像素比最多 1、不加景深和泛光，马上换上");
  assert.equal(p.item().label, T.low);
  // 下一次打开页面（单机、联机都走 hd2d-field.js 这一份）：按记着的低建场景
  const p2 = page(s);
  await settle(); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(p2.log.options.quality)), Q.levels.low, "开场就是低");
  assert.equal(p2.item().label, T.low);
  p2.PM.choose("quality");
  assert.equal(s.m.get(Q.storageKey), "auto");
  assert.deepEqual(JSON.parse(JSON.stringify(p2.log.quality.pop())), Q.levels.high, "回到自动：先用高");
  // 新画面关着：没有这一项（画质用不上）
  const off = page(mem({ [F.FIELD.storageKey]: "off" }));
  await settle();
  assert.equal(off.item(), null, "新画面关着：菜单里没有画质");
  // 存不了（隐私模式）：照样换，照这一次选的
  const bad = { getItem: (k) => (k === F.FIELD.storageKey ? "on" : null), setItem() { throw new Error("QuotaExceededError"); } };
  const p3 = page(bad);
  await settle(); await settle();
  p3.PM.choose("quality");
  assert.equal(p3.item().label, T.high, "存不了也换到高");
  assert.deepEqual(JSON.parse(JSON.stringify(p3.log.quality.pop())), Q.levels.high);
  // 浏览器缓存里还是旧的场景包（没有 setQuality）：点了不报错
  const p4 = page(mem({ [F.FIELD.storageKey]: "on" }), { old: true });
  await settle(); await settle();
  assert.doesNotThrow(() => p4.PM.choose("quality"));
  assert.equal(p4.item().label, T.high);
});

test("#321 自动：场景量到一直卡（onSlow）就降一档到低（只降一次、只这一次打开页面，不记在本机），菜单上写已降到低；选了高 / 低就不管", async () => {
  const F = field(), Q = F.FIELD.quality, s = mem({ [F.FIELD.storageKey]: "on" });
  const p = page(s);
  await settle(); await settle();
  assert.equal(typeof p.log.options.onSlow, "function", "交给场景");
  p.log.options.onSlow();
  assert.deepEqual(JSON.parse(JSON.stringify(p.log.quality.pop())), Q.levels.low, "降到低");
  assert.equal(p.item().label, p.PM.CONFIG.items.quality.autoLow);
  assert.equal(s.m.get(Q.storageKey), undefined, "不记在本机（还是自动）");
  p.log.options.onSlow();
  assert.equal(p.log.quality.length, 0, "只降一次");
  // 重新打开页面：自动从高开始
  const again = page(s);
  await settle(); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(again.log.options.quality)), Q.levels.high);
  // 选了高：卡也不降
  s.m.set(Q.storageKey, "high");
  const high = page(s);
  await settle(); await settle();
  high.log.options.onSlow();
  assert.equal(high.log.quality.length, 0, "选了高：不降");
  assert.equal(high.item().label, high.PM.CONFIG.items.quality.high);
});

test("#321 演出在播时告诉场景照常满帧（options.busy）：单机看 game.js 的 G.depth（出招演出 / 敌人行动），联机玩家 / 原型看 hd2d-play.js 的 busy", async () => {
  const F = field(), p = page(mem({ [F.FIELD.storageKey]: "on" }));
  await settle(); await settle();
  const busy = p.log.options.busy;
  assert.equal(typeof busy, "function");
  assert.equal(busy(), false, "没在演出");
  p.ctx.GAME.depth = 1;
  assert.equal(busy(), true, "单机：演出 / 敌人行动中");
  p.ctx.GAME.depth = 0;
  p.ctx.HD2DPlay = { busy: true };
  assert.equal(busy(), true, "整包演出在播（联机玩家）");
  p.ctx.HD2DPlay.busy = false;
  assert.equal(busy(), false);
});

test("#321 场景换画质（hd2d-scene.js · setQuality）：像素比 = 屏幕的、最多到这一档的 pixelRatio（只换像素不重排）；景深、泛光那两道后期按这一档开关；换了以后帧时间从头量", () => {
  const src = code(read("hd2d/hd2d-scene.js"));
  assert.match(src, /let quality = Object\.assign\(\{\}, QUALITY, options\.quality \|\| \{\}\);\s*function applyPasses\(\) \{ bokeh\.enabled = quality\.bokeh !== false; bloom\.enabled = quality\.bloom !== false; \}\s*applyPasses\(\);/, "开场的画质：景深 / 泛光");
  const px = src.slice(src.indexOf("function applyPixels() {"), src.indexOf("function resize() {"));
  assert.match(px, /const pr = Math\.min\(window\.devicePixelRatio \|\| 1, quality\.pixelRatio > 0 \? quality\.pixelRatio : QUALITY\.pixelRatio\);/, "像素比最多到这一档的");
  assert.match(px, /renderer\.setPixelRatio\(pr\);[\s\S]*composer\.setPixelRatio\(pr\);[\s\S]*grade\.uniforms\.res\.value\.set\(w \* pr, h \* pr\);/);
  assert.ok(!/devicePixelRatio \|\| 1, 2\)/.test(src), "不再写死 2");
  assert.match(src, /function resize\(\) \{\s*const \{ w, h \} = applyPixels\(\);/, "窗口变了也走同一份");
  assert.match(src, /setQuality\(q\) \{\s*quality = Object\.assign\(\{\}, QUALITY, q \|\| \{\}\);\s*applyPasses\(\); applyPixels\(\);\s*meter = null; lastFull = false;\s*\}/, "马上换上、不重排；帧时间从头量");
  // hd2d-field.js：建场景时交画质、演出在播、一直卡；没有 setQuality 的旧场景包不叫
  const fsrc = code(read("hd2d/hd2d-field.js"));
  assert.match(fsrc, /quality: FIELD\.quality\.levels\[qualityLevel\(\)\], busy: fxBusy, onSlow,/);
  assert.match(fsrc, /if \(S\.sc && typeof S\.sc\.setQuality === "function"\) S\.sc\.setQuality\(FIELD\.quality\.levels\[qualityLevel\(\)\]\);/);
});

test("#321 暂停页面（pause-menu.js）登记了「画质」这一项：字在 PAUSE_MENU.items.quality，排在音效后面、离开房间前面；说明里写清楚低画质是什么、只影响这台电脑", () => {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.runInContext(read("pause-menu.js"), vm.createContext(sandbox), { filename: "pause-menu.js" });
  const C = sandbox.PauseMenu.CONFIG;
  assert.deepEqual(Object.keys(C.items.quality).sort(), ["auto", "autoLow", "high", "hint", "label", "low"]);
  assert.ok(C.order.quality > C.order.sfx && C.order.quality < C.order.leave);
  assert.match(C.items.quality.hint, /像素比最高 1/);
  assert.match(C.items.quality.hint, /景深/);
  assert.match(C.items.quality.hint, /这台电脑/);
  assert.doesNotMatch(JSON.stringify(C.items.quality), /坚毅|shp/i);
});
