// 新旧画面之间的云雾转场（#261 追加，主人：「在远景情况下如果还继续缩小，就会变回之前的战斗画面，具体是镜头上升到正上方然后一阵白色云雾后切换成之前的战斗画面」）。
// 新 → 旧：新画面远景再往外拉（滚轮 / 双指捏小）→ 镜头升到正上方 → 白色云雾从四边涌进来盖满 → 切到旧画面（开关拨到关）→ 云雾散开；
// 旧 → 新反过来：旧战场上往前滚 → 云雾涌进来 → 切到新画面（镜头在正上方）→ 云雾散开、镜头降回远景。顶栏开关走同一段；转场中滚轮、开关都不理；
// 减少动态效果时直接切。都是 Node 能跑的：转场的几段、滚轮、镜头是纯函数，页面用假网页 + 假场景 + 假计时器走一遍；WebGL 画面和截图由仓库主人跑。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const HP = require("./hd2d-paths");
const L = require("../hd2d/hd2d-layout.js");
const C = require("../hd2d/hd2d-camera.js");

const vm = require("vm");
const H = require("./headless");

const field = () => require("../hd2d/hd2d-field.js");
const read = (f) => fs.readFileSync(path.join(HP.ROOT, f), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");   // 去掉注释，只看代码
const DESKTOP = { width: 1100, height: 620, top: 0, bottom: 40 };
const SHP = 7771, SHP_MAX = 7772;
const settle = () => new Promise(r => setImmediate(r));

/* ---------- 页面里走一遍用的：规则环境里摆一场战斗（每个单位塞上特殊的坚毅生命数），假网页、假场景、假计时器 ---------- */
function battle() {
  const ctx = H.load();
  const st = ctx.BattleSim.setup({
    party: ["kolt", "helu", "ruby", "yuito"], zoneMode: 3, seed: "hd2d-mist", region: "第一采矿场", light: "dusk",
    enemies: [{ id: "guard_sword", lv: 2, zone: 3 }, { id: "thug_hammer", lv: 2, zone: 2 }]
  });
  st.units.forEach(u => { u.shp = SHP; u.shpMax = SHP_MAX; u.baseShp = SHP; });
  vm.runInContext(read("online-view.js"), ctx, { filename: "online-view.js" });
  ["hd2d/hd2d-layout.js", "hd2d/hd2d-camera.js", "hd2d/hd2d-fx.js", "hd2d/hd2d-field.js"].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  ctx.HD2DWfx = { windOf: () => ({ x: 1, z: 0 }), create: () => ({ sync() {}, dispose() {} }) };   // 天气的 2D 层要真的网页
  return { ctx, st };
}
/** 假网页：#g-app、#g-field、开关按钮；元素能挂、能拆、记得住行内的 CSS 变量和监听 */
function fakeDoc() {
  const els = {};
  const make = (tag, id) => {
    const cls = new Set(), vars = {};
    const e = {
      tagName: String(tag).toUpperCase(), children: [], parentNode: null, attrs: {}, listeners: {}, hidden: false, textContent: "", title: "", type: "",
      style: { setProperty: (k, v) => { vars[k] = String(v); }, vars }, offsetHeight: 30, offsetWidth: 1100, clientWidth: 1100, clientHeight: 620,
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; if (v) cls.add(c); else cls.delete(c); return v; } },
      get className() { return [...cls].join(" "); },
      set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => cls.add(c)); },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      addEventListener(t, f, o) { (this.listeners[t] = this.listeners[t] || []).push(f); (this.opts = this.opts || {})[t] = o; }, removeEventListener() {},
      appendChild(c) { if (c.parentNode) c.remove(); c.parentNode = this; this.children.push(c); return c; },
      append(...cs) { cs.forEach(c => this.appendChild(c)); },
      remove() { if (this.parentNode) { const k = this.parentNode.children; k.splice(k.indexOf(this), 1); this.parentNode = null; } },
      querySelector() { return null; },
      getBoundingClientRect() { return { left: 100, top: 50, width: 1100, height: 620 }; }
    };
    if (id) els[id] = e;
    return e;
  };
  make("button", "g-hd2d-toggle"); make("div", "g-app"); make("main", "g-field");
  return { els, doc: { getElementById: (id) => els[id] || null, createElement: (t) => make(t), head: make("head") } };
}
/** 假的场景：记下转场叫它的镜头（overhead / descend）、拆掉没有，onZoomOut 等回调在 options 里 */
function fakeScene(log) {
  return (stage, options) => {
    const sc = {
      portrait: false, motion: true, tier: "far", zone: null, close: null, flash: 0, layout: null, options, stage, disposed: false,
      view: () => DESKTOP,
      setInsets() {}, setBattle(layout) { sc.layout = layout; }, refit() {}, setMarks() {}, setActor() {}, setWind() {}, setTier() {}, stepZone() {},
      lensNow: () => ({ pos: sc.layout.camera.pos, target: sc.layout.camera.target, fov: sc.layout.camera.fov, width: DESKTOP.width, height: DESKTOP.height }),
      plateOf: () => null, zoneOf: () => null,
      overhead: (o) => log.calls.push(["overhead", Object.assign({}, o)]),
      descend: (o) => log.calls.push(["descend", Object.assign({}, o)]),
      dispose: () => { sc.disposed = true; log.calls.push(["dispose"]); }
    };
    log.scenes.push(sc);
    return sc;
  };
}
/** 假计时器：wait 排上，tick 跑最早排上的那一个（不自己走时间）；now 是滚轮看的时间（秒），advance 往前拨 */
function clock() {
  const q = [];
  let t = 100;
  return {
    q,
    wait: (secs, fn) => { q.push({ secs, fn }); },
    now: () => t,
    advance: (s) => { t += s; },
    tick() { const x = q.shift(); assert.ok(x, "没有排着的计时器"); x.fn(); return x.secs; }
  };
}
const wheelEv = (deltaY, extra) => Object.assign({
  deltaY, deltaMode: 0, ctrlKey: false, prevented: 0, stopped: 0, preventDefault() { this.prevented++; }, stopPropagation() { this.stopped++; }
}, extra || {});
/** 打开一页：on = 本机记着开（一打开就建新画面，不播转场）；reduced = 减少动态效果；load = 换掉加载（默认交出假场景） */
async function page(opts) {
  opts = opts || {};
  const { ctx, st } = battle();
  const F = ctx.HD2DField, P = fakeDoc(), T = clock();
  const mem = new Map(opts.on ? [[F.FIELD.storageKey, "on"]] : []), writes = [];
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); writes.push(String(v)); } };
  const log = { calls: [], scenes: [], loads: 0, refresh: 0 };
  ctx.GAME = { depth: 0, snapAll: () => null, refresh: () => { log.refresh++; }, fieldInput: { unit() {}, hover() {}, zone() {}, zoneHover() {} } };
  const load = opts.load || (() => { log.loads++; return Promise.resolve(fakeScene(log)); });
  F.boot({ doc: P.doc, storage, load, hint: (m) => log.calls.push(["hint", m]), reduced: () => !!opts.reduced, wait: T.wait, now: T.now });
  await settle(); await settle();
  const btn = P.els["g-hd2d-toggle"], fieldEl = P.els["g-field"];
  return {
    ctx, st, F, P, T, mem, writes, log, btn, field: fieldEl, app: P.els["g-app"],
    wheel: (ev) => { fieldEl.listeners.wheel.forEach(f => f(ev)); return ev; },
    click: () => btn.listeners.click[0]({}),
    mist: () => fieldEl.children.find(c => c.className.split(" ").includes("hd2d-mist")) || null,
    scene: () => log.scenes[log.scenes.length - 1]
  };
}
/** 云雾那一层里不能有字、不能有坚毅生命的数（行内的 CSS 变量也查） */
function noNumbersIn(el, tag) {
  const all = [];
  const walk = (n) => { all.push(n); n.children.forEach(walk); };
  walk(el);
  all.forEach(n => {
    assert.equal(n.textContent, "", tag + "：云雾里没有字");
    const s = JSON.stringify({ attrs: n.attrs, vars: n.style.vars, cls: n.className });
    assert.ok(!/shp|坚毅/i.test(s) && !s.includes(String(SHP)) && !s.includes(String(SHP_MAX)), tag + "：云雾里出现了坚毅生命");
  });
  return all;
}

/* ---------- 1. 配置表 ---------- */
test("转场的数值都在配置表里（hd2d-field.js 顶部的 MIST）：镜头升起的俯角 / 距离 / 时长、降回去的时长、云雾涌进来 / 停 / 散开的时长、颜色、透明度、几团、旧画面滚轮的门槛", () => {
  const F = field(), M = F.MIST;
  assert.ok(M, "有 MIST");
  assert.ok(M.rise.elevation >= 80 && M.rise.elevation < 90, "升到接近正上方（正 90 度镜头朝向算不出来）");
  assert.ok(M.rise.dist > 0 && M.rise.secs > 0 && C.EASE[M.rise.ease], "升多远、多久、缓动");
  assert.ok(M.descend.secs > 0 && C.EASE[M.descend.ease], "降回远景多久、缓动");
  ["cover", "hold", "clear", "overlap"].forEach(k => assert.ok(Number.isFinite(M[k]) && M[k] >= 0, k));
  assert.ok(M.overlap < M.rise.secs, "云雾在镜头升到顶之前就开始涌");
  assert.ok(Array.isArray(M.color) && M.color.length === 3 && M.color.every(v => v >= 0 && v <= 255), "云雾的颜色（白）");
  assert.deepEqual(M.color, [255, 255, 255], "白色云雾");
  assert.ok(M.opacity > 0.8 && M.opacity <= 1, "最浓时差不多盖满");
  assert.ok(M.puffs >= 4 && M.size > 0 && M.spread >= 0 && M.push > 0 && M.stagger >= 0, "几团、多大、离中心多远、从外面多远涌进来");
  assert.ok(M.wheel.step > 0 && M.wheel.idle > 0 && M.wheel.line > 0 && M.wheel.page > 0, "旧画面滚轮的门槛");
  const src = read("hd2d/hd2d-field.js");
  assert.ok(src.indexOf("const MIST = {") > 0 && src.indexOf("const MIST = {") < src.indexOf("function enabled("), "MIST 在文件顶部（配置区）");
});

/* ---------- 2. 转场的几段（纯函数）---------- */
test("转场的几段：新 → 旧 = 升镜头 → 云雾涌进来 → 切 → 散开；旧 → 新 = 云雾涌进来 → 切 → 散开（镜头同时降回远景）；时长都按 MIST；减少动态效果 / 新画面还没建好时只有 0 秒的切换", () => {
  const F = field(), M = F.MIST;
  const steps = (p) => p.map(s => s.step);
  const out = F.mistPlan("old", { live: true });
  assert.deepEqual(steps(out), ["rise", "cover", "swap", "clear"]);
  assert.equal(out[0].secs, M.rise.secs - M.overlap, "升到最后 overlap 秒时云雾就开始涌");
  assert.equal(out[1].secs, M.cover);
  assert.equal(out[2].secs, M.hold);
  assert.equal(out[3].secs, M.clear);
  const back = F.mistPlan("new", {});
  assert.deepEqual(steps(back), ["cover", "swap", "clear"], "旧 → 新：没有升镜头（旧画面没有镜头），云雾直接涌进来");
  assert.equal(back[2].secs, Math.max(M.clear, M.descend.secs), "散开和镜头降回远景一起走完");
  assert.deepEqual(F.mistPlan("old", { live: true, reduced: true }), [{ step: "swap", secs: 0 }], "减少动态效果：直接切");
  assert.deepEqual(F.mistPlan("new", { reduced: true }), [{ step: "swap", secs: 0 }], "减少动态效果：直接切");
  assert.deepEqual(F.mistPlan("old", { live: false }), [{ step: "swap", secs: 0 }], "3D 还没建好（加载中 / 打不开）：没有镜头能升，直接切");
});

/* ---------- 3. 滚轮 ---------- */
test("战场上的滚轮：一次滚动只算一下（攒够门槛才算）；停顿一下才是新的一次；ate（这一次已经换过画面）到新的一次滚动才清掉", () => {
  const F = field(), W = F.MIST.wheel;
  let r = F.wheelGate(null, -(W.step - 1), 10);
  assert.equal(r.step, 0, "滚得太少不算");
  r = F.wheelGate(r.state, -2, 10.05);
  assert.equal(r.step, 1, "攒够了：往前 = 拉近");
  r = F.wheelGate(r.state, -400, 10.1);
  assert.equal(r.step, 0, "同一次滚动里后面的都不算");
  r.state.ate = true;
  r = F.wheelGate(r.state, -100, 10.1 + W.idle * 0.9);
  assert.equal(r.state.ate, true, "还是同一次滚动（触控板的惯性）：ate 留着");
  r = F.wheelGate(r.state, 100, 10.1 + W.idle * 0.9 + W.idle + 0.01);
  assert.equal(r.step, -1, "停顿一下再往后滚：新的一次，拉远");
  assert.equal(r.state.ate, false, "新的一次：ate 清掉");
  assert.equal(F.wheelPixels({ deltaY: 3, deltaMode: 1 }), 3 * W.line, "按行");
  assert.equal(F.wheelPixels({ deltaY: 1, deltaMode: 2 }), W.page, "按页");
  assert.equal(F.wheelPixels({ deltaY: -53 }), -53);
});

/* ---------- 4. 镜头（纯函数）---------- */
test("镜头：远景到头了还往外拉才算转回旧画面（pastFar），中景 / 近景往外拉只换段；正上方的镜头看的还是战场中间、俯角接近 90 度；双指张开 / 捏小一下算一段", () => {
  assert.equal(C.pastFar({ tier: "far" }, -1), true, "远景往外拉：转回旧画面");
  assert.equal(C.pastFar({ tier: "mid" }, -1), false, "中景往外拉：只换到远景");
  assert.equal(C.pastFar({ tier: "near" }, -1), false);
  assert.equal(C.pastFar({ tier: "near", close: "u1" }, -1), false, "特写往外拉：回到正常的近景");
  assert.equal(C.pastFar({ tier: "far" }, 1), false, "远景往里推：拉近到中景");
  assert.equal(C.pastFar({ tier: "far" }, 0), false);
  assert.deepEqual(C.camStep({ tier: "mid", zone: 2, close: null }, { type: "wheel", step: -1 }), { tier: "far", zone: 2, close: null }, "中景往外拉：换到远景");
  // 正上方
  const out = L.build({ zoneMode: 3, units: [], fields: {}, gaps: {} }, { view: DESKTOP });
  const far = C.pose(out, "far", 1);
  const top = C.overheadPose(far, { elevation: 88, dist: 1.2 });
  assert.deepEqual(top.target, far.target, "看的还是远景看的那一点（战场中间）");
  assert.equal(top.elevation, 88);
  assert.ok(Math.abs(top.dist - far.dist * 1.2) < 1e-9, "离远一点");
  assert.ok(Math.abs(top.pos.y - top.target.y - top.dist * Math.sin(88 * Math.PI / 180)) < 1e-9, "在正上方");
  assert.ok(Math.hypot(top.pos.x - top.target.x, top.pos.z - top.target.z) < top.dist * 0.05, "几乎没有水平偏移");
  assert.equal(top.azimuth, 0);
  assert.equal(top.fov, far.fov);
  assert.ok(Math.abs(top.fogShift - (far.fogShift + top.dist - far.dist)) < 1e-9, "起雾的地方跟着往后挪多出来的那一截（离远了战场不蒙上雾）");
  assert.equal(C.overheadPose(far, { elevation: 95 }).elevation, 89.5, "正 90 度以上夹住（镜头朝向算不出来）");
  assert.equal(JSON.stringify(far), JSON.stringify(C.pose(out, "far", 1)), "不改传进来的");
  // 双指
  const P = C.CAMERA.pinch.ratio;
  assert.equal(C.pinchStep(1 + P), 1, "张开：拉近");
  assert.equal(C.pinchStep(1 / (1 + P)), -1, "捏小：拉远");
  assert.equal(C.pinchStep(1.05), 0);
  assert.equal(C.pinchStep(0.95), 0);
  assert.equal(C.pinchStep(NaN), 0);
});

/* ---------- 5. 页面里走一遍：新 → 旧 ---------- */
test("新 → 旧：新画面远景再往外拉（场景的 onZoomOut）→ 镜头升到正上方 → 云雾从四边涌进来 → 盖满时切到旧画面（开关拨到关、记成关）→ 云雾散开；转场中滚轮、开关、再往外拉都不理；战斗状态没动，云雾里没有字也没有数", async () => {
  const p = await page({ on: true });
  const { F, T, mem, log, btn, field, app, st } = p, M = F.MIST;
  assert.equal(F.on(), true, "记着开：一打开就是新画面（不播转场）");
  assert.equal(T.q.length, 0);
  assert.equal(p.mist(), null);
  const sc = p.scene(), before = JSON.stringify(st);
  // 场景在远景又往外拉了一下（hd2d-scene.js · zoomStep → zoomAction 给了 out）
  sc.options.onZoomOut();
  assert.deepEqual({ ...F.transition() },{ busy: true, to: "old", step: "rise" });
  assert.deepEqual(log.calls.filter(c => c[0] === "overhead"), [["overhead", { elevation: M.rise.elevation, dist: M.rise.dist, secs: M.rise.secs, ease: M.rise.ease }]], "镜头升到正上方：俯角、距离、时长、缓动都按 MIST");
  const mist = p.mist();
  assert.ok(mist && mist.parentNode === field, "云雾那一层马上铺上（还透明）：转场中点不到下面的东西");
  assert.ok(!mist.classList.contains("in"), "镜头还在升：云雾还没来");
  assert.equal(F.on(), true);
  ["click", "dblclick", "contextmenu", "pointerdown"].forEach(t => {
    const e = { prevented: 0, stopped: 0, preventDefault() { this.prevented++; }, stopPropagation() { this.stopped++; } };
    mist.listeners[t].forEach(f => f(e));
    assert.ok(e.prevented && e.stopped, t + "：吞掉，不落到 3D 铭牌 / 地台、也不冒到 #g-field 的点击");
  });
  // 转场中：点开关、滚轮、再往外拉都不理
  p.click();
  assert.deepEqual({ ...F.transition() },{ busy: true, to: "old", step: "rise" }, "点开关不理");
  assert.equal(btn.textContent, "新画面 开");
  assert.equal(mem.get(F.FIELD.storageKey), "on");
  const ev = p.wheel(wheelEv(-300));
  assert.ok(ev.prevented && ev.stopped, "滚轮吞掉（场景收不到，镜头不换段）");
  sc.options.onZoomOut();
  assert.equal(log.calls.filter(c => c[0] === "overhead").length, 1, "再往外拉不理");
  assert.equal(T.q.length, 1, "只有转场自己那一个计时器");
  // 镜头升到最后 overlap 秒：云雾开始涌
  assert.equal(T.tick(), M.rise.secs - M.overlap);
  assert.equal(F.transition().step, "cover");
  assert.ok(mist.classList.contains("in"), "云雾从四边涌进来");
  assert.equal(F.on(), true, "还没盖满：还是新画面");
  // 盖满：切到旧画面（等于把开关拨到关）
  assert.equal(T.tick(), M.cover);
  assert.equal(F.transition().step, "swap");
  assert.equal(F.on(), false, "切到旧画面");
  assert.ok(sc.disposed, "3D 拆掉");
  assert.ok(!app.classList.contains("hd2d-on"), "旧战场露出来");
  assert.equal(mem.get(F.FIELD.storageKey), "off", "开关记成关");
  assert.equal(btn.textContent, "新画面 关", "开关的字跟着转场的结果");
  assert.equal(btn.getAttribute("aria-pressed"), "false");
  assert.equal(mist.parentNode, field, "云雾还盖着");
  assert.ok(log.refresh >= 1, "game.js 再画一遍旧战场");
  p.click();
  assert.equal(F.transition().step, "swap", "还在转：点开关不理");
  await settle();
  // 停 hold 秒：云雾散开
  assert.equal(T.tick(), M.hold);
  assert.equal(F.transition().step, "clear");
  assert.ok(mist.classList.contains("out") && !mist.classList.contains("in"), "云雾散开");
  assert.ok(!log.calls.some(c => c[0] === "descend"), "新 → 旧不降镜头（3D 已经拆了）");
  assert.equal(T.tick(), M.clear);
  assert.deepEqual({ ...F.transition() },{ busy: false, to: null, step: null }, "走完");
  assert.equal(mist.parentNode, null, "云雾那一层拿掉");
  assert.equal(T.q.length, 0);
  assert.equal(F.on(), false);
  assert.equal(p.writes.join(","), "off", "开关只记了一次（关）");
  assert.equal(JSON.stringify(st), before, "转场没动战斗状态");
  const nodes = noNumbersIn(mist, "新 → 旧");
  assert.equal(nodes.length, 1 + 1 + M.puffs, "一层 + 整片的蒙层 + 每团一个");
  assert.deepEqual(Object.keys(mist.attrs).sort(), ["aria-hidden"]);
  assert.equal(mist.style.vars["--mist-c"], M.color.join(", "), "颜色按 MIST");
  assert.equal(mist.style.vars["--mist-o"], String(M.opacity), "透明度按 MIST");
  assert.equal(mist.style.vars["--mist-in"], M.cover + "s");
  assert.equal(mist.style.vars["--mist-out"], M.clear + "s");
});

/* ---------- 6. 页面里走一遍：旧 → 新 ---------- */
test("旧 → 新：旧战场上往前滚（拉近）→ 云雾涌进来（同时开始加载）→ 盖满时切到新画面（开关拨到开），镜头先摆在正上方 → 云雾散开、镜头同时降回远景；这一次滚动剩下的（触控板的惯性）都不理，停顿以后新的一次滚动交还给场景", async () => {
  const p = await page({ on: false });
  const { F, T, mem, log, btn, field, app, st } = p, M = F.MIST, W = M.wheel;
  assert.equal(F.on(), false);
  const before = JSON.stringify(st);
  // 往后滚、按着 Ctrl 往前滚（触控板双指 / 浏览器缩放）：旧画面照旧，不管
  let ev = p.wheel(wheelEv(400));
  assert.equal(ev.prevented + ev.stopped, 0, "往后滚：不管");
  T.advance(1);
  ev = p.wheel(wheelEv(-400, { ctrlKey: true }));
  assert.equal(ev.prevented + ev.stopped, 0, "Ctrl + 滚轮：浏览器自己的缩放");
  assert.equal(F.transition().busy, false);
  T.advance(1);
  // 往前滚：滚得太少不算；同一次滚动攒够了才算
  ev = p.wheel(wheelEv(-(W.step - 1)));
  assert.equal(F.transition().busy, false, "滚得太少不算");
  assert.equal(ev.prevented, 0);
  T.advance(0.03);
  ev = p.wheel(wheelEv(-2));
  assert.ok(ev.prevented && ev.stopped);
  assert.deepEqual({ ...F.transition() },{ busy: true, to: "new", step: "cover" }, "旧 → 新：云雾直接涌进来（旧画面没有镜头可升）");
  const mist = p.mist();
  assert.ok(mist && mist.classList.contains("in"));
  assert.equal(log.loads, 1, "云雾一涌进来就开始加载");
  assert.equal(F.on(), false, "还没盖满：还是旧画面");
  assert.equal(btn.textContent, "新画面 关");
  assert.equal(mem.get(F.FIELD.storageKey), undefined, "还没切：开关没动");
  // 转场中：同一次滚动接着滚（惯性）、点开关：不理
  const inertia = (secs) => {
    for (let k = 0; k < Math.round(secs / 0.1); k++) { T.advance(0.1); const e = p.wheel(wheelEv(-60)); assert.ok(e.prevented && e.stopped, "惯性的滚轮吞掉"); }
  };
  inertia(M.cover);
  p.click();
  assert.deepEqual({ ...F.transition() },{ busy: true, to: "new", step: "cover" }, "点开关不理");
  // 盖满：建好新画面，镜头先摆在正上方
  assert.equal(T.tick(), M.cover);
  assert.equal(F.transition().step, "swap");
  await settle(); await settle();
  assert.equal(F.on(), true, "切到新画面");
  assert.equal(log.loads, 1, "没有再加载一次");
  assert.ok(app.classList.contains("hd2d-on"));
  assert.equal(mem.get(F.FIELD.storageKey), "on", "开关记成开");
  assert.equal(btn.textContent, "新画面 开", "开关的字跟着转场的结果");
  assert.equal(btn.getAttribute("aria-pressed"), "true");
  assert.deepEqual(log.calls.filter(c => c[0] === "overhead"), [["overhead", { elevation: M.rise.elevation, dist: M.rise.dist, secs: 0 }]], "新画面从正上方开始（直接摆过去，云雾还盖着）");
  assert.ok(!log.calls.some(c => c[0] === "descend"), "还盖着：镜头先停在正上方");
  assert.equal(mist.parentNode, field, "云雾还盖着");
  inertia(M.hold);
  // 停 hold 秒：云雾散开，镜头同时降回远景
  assert.equal(T.tick(), M.hold);
  assert.equal(F.transition().step, "clear");
  assert.ok(mist.classList.contains("out"));
  assert.deepEqual(log.calls.filter(c => c[0] === "descend"), [["descend", { secs: M.descend.secs, ease: M.descend.ease }]], "降回远景：时长、缓动按 MIST");
  inertia(M.descend.secs);
  assert.equal(T.tick(), Math.max(M.clear, M.descend.secs));
  assert.deepEqual({ ...F.transition() },{ busy: false, to: null, step: null });
  assert.equal(mist.parentNode, null);
  // 转场走完了，这一次滚动的惯性还在来：照样不理（镜头不会接着被推到中景）
  inertia(0.5);
  // 停顿一下，新的一次滚动：交给场景（这里不吞）
  T.advance(W.idle + 0.1);
  ev = p.wheel(wheelEv(-120));
  assert.equal(ev.prevented + ev.stopped, 0, "新的一次滚动：场景自己在三段之间跳");
  assert.equal(F.transition().busy, false);
  assert.equal(p.writes.join(","), "on", "开关只记了一次（开）");
  assert.equal(JSON.stringify(st), before, "转场没动战斗状态");
  noNumbersIn(mist, "旧 → 新");
});

/* ---------- 7. 不在远档时缩小只换档 ---------- */
test("不在「远」档时缩小只换档：场景里滚轮 / 双指走 zoomStep——中景一次长长的滚动往外只到远景（同一次滚动不会接着转回旧画面），停顿以后再往外拉才转；近景往外到中景；原型（不接 onZoomOut）远景往外拉照旧停在远景", () => {
  const W = C.CAMERA.wheel;
  /** 照场景的 onWheel → zoomStep：wheelStep（一次滚动一段）→ 远景到头了（pastFar）、外面又接才交出去，不然状态机 camStep 换段 */
  function scene(tier, exit) {
    let s = { tier, zone: 1, close: null }, ws = null, outs = 0;
    return {
      wheel(dy, t) {
        const r = C.wheelStep(ws, dy, t);
        ws = r.state;
        if (!r.step) return;
        if (exit && C.pastFar(s, r.step)) { outs++; return; }
        s = C.camStep(s, { type: "wheel", step: r.step });
      },
      get tier() { return s.tier; }, get outs() { return outs; }
    };
  }
  const mid = scene("mid", true);
  for (let i = 0; i < 60; i++) mid.wheel(30, 10 + i * 0.016);   // 触控板：一次长长的滚动往外
  assert.equal(mid.tier, "far", "中景往外拉：换到远景");
  assert.equal(mid.outs, 0, "同一次滚动：不会接着转回旧画面");
  mid.wheel(120, 10 + 60 * 0.016 + W.idle + 0.05);
  assert.equal(mid.outs, 1, "停顿一下再往外拉：转回旧画面");
  assert.equal(mid.tier, "far", "交出去了：镜头这一段不变");
  const near = scene("near", true);
  near.wheel(120, 1);
  assert.equal(near.tier, "mid");
  assert.equal(near.outs, 0, "近景往外：只到中景");
  assert.equal(C.pastFar({ tier: "near", zone: 1, close: "u1" }, -1), false, "特写往外：不交出去");
  assert.deepEqual(C.camStep({ tier: "near", zone: 1, close: "u1" }, { type: "wheel", step: -1 }), { tier: "near", zone: 1, close: null }, "特写往外：回到正常的近景");
  const proto = scene("far", false);
  proto.wheel(120, 1);
  assert.equal(proto.outs, 0, "原型不接：不交出去");
  assert.equal(proto.tier, "far", "照旧停在远景");
  const farIn = scene("far", true);
  farIn.wheel(-120, 1);
  assert.equal(farIn.tier, "mid", "远景往里推：拉近到中景");
  assert.equal(farIn.outs, 0);
  // 场景源码：滚轮、双指都走 zoomStep；转场占着镜头时不理
  const src = code(read("hd2d/hd2d-scene.js"));
  assert.match(src, /function zoomStep\(step\) \{\s*if \(!step \|\| state\.lock\) return;\s*if \(options\.onZoomOut && C\.pastFar\(camState\(\), step\)\) \{ options\.onZoomOut\(\); return; \}\s*move\(C\.camStep\(camState\(\), \{ type: "wheel", step \}\)\);\s*\}/);
  assert.match(src, /wheelState = r\.state;\s*zoomStep\(r\.step\);/, "滚轮");
  assert.match(src, /const step = C\.pinchStep\(pinchGap\(\) \/ pinch\.d0\);\s*if \(step\) \{ pinch\.done = true; zoomStep\(step\); \}/, "双指：一次手势一下");
  assert.match(src, /if \(pinch\.pts\.size === 2\) \{ pinch\.d0 = pinchGap\(\); pinch\.done = false; \}/, "两根手指按下才开始量");
  assert.equal((src.match(/options\.onZoomOut\(\)/g) || []).length, 1, "只有远景到头这一处交出去");
});

/* ---------- 8. 减少动态效果 ---------- */
test("减少动态效果：开关、远景再往外拉、旧战场往前滚都直接切——不升镜头、不铺云雾、不排计时器", async () => {
  const p = await page({ on: true, reduced: true });
  const { F, T, mem, log, btn } = p;
  assert.equal(F.on(), true);
  p.scene().options.onZoomOut();
  assert.equal(F.on(), false, "远景再往外拉：直接切到旧画面");
  assert.equal(mem.get(F.FIELD.storageKey), "off");
  assert.equal(btn.textContent, "新画面 关");
  assert.equal(p.mist(), null, "不铺云雾");
  assert.equal(T.q.length, 0, "不排计时器");
  assert.deepEqual({ ...F.transition() },{ busy: false, to: null, step: null });
  // 开关：直接打开
  p.click();
  await settle(); await settle();
  assert.equal(F.on(), true, "开关：直接切到新画面");
  assert.equal(btn.textContent, "新画面 开");
  assert.equal(p.mist(), null);
  assert.equal(T.q.length, 0);
  // 开关：直接关掉
  p.click();
  assert.equal(F.on(), false);
  // 旧战场往前滚：直接打开
  T.advance(1);
  p.wheel(wheelEv(-200));
  await settle(); await settle();
  assert.equal(F.on(), true, "往前滚：直接切到新画面");
  assert.equal(p.mist(), null);
  assert.equal(T.q.length, 0);
  assert.ok(!log.calls.some(c => c[0] === "overhead" || c[0] === "descend"), "镜头不升也不降");
});

/* ---------- 9. 开关和滚轮同一套逻辑 ---------- */
test("开关和滚轮走同一套逻辑（switchTo）：新 → 旧（开关 / 远景再往外拉）、旧 → 新（开关 / 旧战场往前滚）走的几段、叫场景的、记在本机的、开关上的字都一样", async () => {
  /** 走一遍：how 触发，记下每一段、叫场景的、写进本机的、开关上的字 */
  async function run(on, how) {
    const p = await page({ on });
    const trace = [];
    const snap = () => trace.push([p.F.transition().step, p.F.on(), p.btn.textContent, p.mist() ? p.mist().className : null]);
    how(p);
    snap();
    while (p.T.q.length) { p.T.tick(); await settle(); await settle(); snap(); }
    return { trace, calls: p.log.calls.map(c => c[0] + (c[1] ? JSON.stringify(c[1]) : "")), writes: p.writes.slice() };
  }
  const outByToggle = await run(true, (p) => p.click());
  const outByWheel = await run(true, (p) => p.scene().options.onZoomOut());
  assert.deepEqual(outByWheel, outByToggle, "新 → 旧：开关和远景再往外拉一样");
  assert.deepEqual(outByToggle.trace.map(t => t[0]), ["rise", "cover", "swap", "clear", null]);
  const inByToggle = await run(false, (p) => p.click());
  const inByWheel = await run(false, (p) => { p.T.advance(1); p.wheel(wheelEv(-200)); });
  assert.deepEqual(inByWheel, inByToggle, "旧 → 新：开关和旧战场往前滚一样");
  assert.deepEqual(inByToggle.trace.map(t => t[0]), ["cover", "swap", "clear", null]);
  // 源码：三个入口都叫 switchTo；开关不再自己拆 / 建
  const src = code(read("hd2d/hd2d-field.js"));
  assert.match(src, /function toggle\(\) \{ switchTo\(S\.want \? "old" : "new"\); \}/, "开关");
  assert.match(src, /onZoomOut: \(\) => \{ if \(switchTo\("old"\) && T\.gesture\) T\.gesture\.ate = true; \}/, "新画面远景再往外拉");
  assert.match(src, /if \(switchTo\("new"\)\) T\.gesture\.ate = true;/, "旧战场往前滚");
  assert.equal((src.match(/switchTo\(/g) || []).length, 4, "定义 + 三个入口");
  assert.equal((src.match(/teardown\(true\)/g) || []).length, 2, "拆 3D 只在切画面（swapNow）和打不开（fail）两处");
});

/* ---------- 10. 打不开 ---------- */
test("旧 → 新打不开（没有 WebGL / 本地文件打不开 ES 模块）：云雾盖满后留在旧画面、开关记成关、提示为什么，云雾照样散开；这一次打开页面就不再用滚轮去开（点开关还能试），用 file:// 打开时旧战场的滚轮照旧", async () => {
  let loads = 0;
  const p = await page({ on: false, load: () => { loads++; return Promise.reject(new Error("WebGL 不可用")); } });
  const { F, T, mem, log, btn } = p;
  T.advance(1);
  p.wheel(wheelEv(-200));
  assert.equal(F.transition().step, "cover");
  assert.equal(loads, 1);
  T.tick();
  await settle(); await settle();
  assert.equal(F.on(), false, "打不开：还是旧画面");
  assert.equal(mem.get(F.FIELD.storageKey), "off", "开关记成关");
  assert.equal(btn.textContent, "新画面 关");
  assert.ok(log.calls.some(c => c[0] === "hint" && /WebGL/.test(c[1])), "提示为什么打不开");
  T.tick();
  assert.equal(F.transition().step, "clear", "云雾照样散开");
  T.tick();
  assert.equal(F.transition().busy, false);
  assert.equal(p.mist(), null);
  // 再往前滚：不再去开（不然每滚一下就白雾一阵 + 一句提示）
  T.advance(1);
  const ev = p.wheel(wheelEv(-200));
  assert.equal(ev.prevented + ev.stopped, 0);
  assert.equal(F.transition().busy, false);
  assert.equal(loads, 1);
  // 点开关：还能试（走同样的转场）
  p.click();
  assert.equal(F.transition().to, "new");
  assert.equal(loads, 2);
  while (T.q.length) { T.tick(); await settle(); await settle(); }
  assert.equal(F.on(), false);
  // file:// 打开：旧战场的滚轮照旧（新画面根本打不开），开关还在
  const q = await page({ on: false });
  q.ctx.location = { protocol: "file:" };
  q.T.advance(1);
  const e2 = q.wheel(wheelEv(-200));
  assert.equal(e2.prevented + e2.stopped, 0);
  assert.equal(q.F.transition().busy, false);
  assert.equal(q.log.loads, 0);
});

/* ---------- 11. 场景：转场占着镜头 ---------- */
test("场景：转场占着镜头（state.lock）——升到正上方用 hd2d-camera.js · overheadPose，到了停在那里；重排 / 换行动的人只换铭牌不动镜头；推镜头、滚轮、双指、拖动都不接；从正上方降回远景到了才交还", () => {
  const src = code(read("hd2d/hd2d-scene.js"));
  const body = (name) => src.slice(src.indexOf(name), src.indexOf("\n    },", src.indexOf(name)));
  const up = body("overhead(o) {"), down = body("descend(o) {");
  assert.match(up, /C\.overheadPose\(C\.pose\(state\.layout, "far", state\.zone, \{ actorId: state\.actorId \}\), o\)/, "看的还是远景看的那一点");
  assert.match(up, /state\.lock = true;/);
  assert.match(up, /controls\.enabled = false; openLimits\(\);/, "拖动不接、俯角放开（OrbitControls 不把镜头夹回去）");
  assert.match(up, /lock: "up"/);
  assert.match(down, /if \(!state\.layout \|\| !state\.lock \|\| !state\.pose\) return;/, "没在转场里就不管");
  assert.match(down, /lock: "down"/);
  assert.match(src, /if \(state\.lock\) opts = \{ keep: true, lock: true \};/, "重排（goTo）时镜头照转场走");
  assert.match(src, /if \(opts\.lock && state\.tween && state\.tween\.lock === "down"\) state\.tween\.to = to;/, "降回来的途中重排了：降到新算的这一段");
  assert.match(src, /posePush\(p, secs\) \{\s*if \(!state\.layout \|\| !p \|\| state\.lock\) return;/, "推镜头不接");
  assert.match(src, /if \(!back \|\| !state\.layout \|\| state\.lock\) return;/, "拉回不接");
  assert.match(src, /const pushed = state\.tween\.push \|\| state\.tween\.lock === "up";\s*if \(state\.tween\.lock === "down"\) state\.lock = false;\s*state\.tween = null;\s*if \(!pushed\) arrive\(\);/, "升到了停住；降到了交还");
  assert.match(src, /\} else if \(!state\.lock\) \{\s*clampPan\(\);\s*controls\.update\(\);/, "停在正上方时 OrbitControls 不碰镜头");
  // 样式：云雾那一层在新画面、首领横幅上面，挡住点击；新画面开着时也看得见；颜色走变量；减少动态效果不过渡
  const css = read("hd2d/hd2d.css");
  const z = (sel) => Number(new RegExp(sel.replace(/[.]/g, "\\.") + " \\{[^}]*z-index: (\\d+)").exec(css)[1]);
  assert.ok(z(".hd2d-mist") > z(".hd2d-field"), "云雾在 3D 战场上面");
  assert.ok(z(".hd2d-mist") > 6, "也盖住首领机制横幅（.g-topstack 是 6）");
  assert.match(css, /\.hd2d-mist \{[^}]*pointer-events: auto;/);
  assert.match(css, /\.g-app\.hd2d-on > \.g-field > \.hd2d-mist \{ visibility: visible; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.hd2d-mist > i, \.hd2d-mist > \.veil \{ transition: none; \} \}/);
  const mistCss = css.slice(css.indexOf(".hd2d-mist {"), css.indexOf("@media (prefers-reduced-motion: reduce) { .hd2d-mist"));
  assert.ok(!/#fff|white|rgba?\(\s*255/i.test(mistCss), "云雾的颜色只走 --mist-c（MIST.color），不写死");
  assert.match(mistCss, /var\(--mist-o\)/);
  assert.match(mistCss, /var\(--mist-in\)/);
  assert.match(mistCss, /var\(--mist-out\)/);
});
