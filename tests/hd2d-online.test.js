// 新画面接入（三）（#289）：联机玩家（不是房主 / 主持人）的战斗画面也能开新画面——
//   · 同一个开关（#g-hd2d-toggle 挪到联机舞台顶上的工具栏）、同一套云雾转场（HD2DField.switchTo），开关只记在本机，不经过联机的 api 发给别人；
//   · 画面只用收到的包（OnlineView.projectState 投影过的）：带着房主私有字段的 state 投影后喂给新画面，交给场景的布局、新画面的 DOM 里没有私有内容，也没有坚毅生命的数字；
//   · 收到行动包：开着整包交给 hd2d-play.js 播（纸片风数字），关着照旧是旧画面的弹字（单位卡上的 .ol-popup）；
//   · 3D 上点铭牌 / 地台 = 旧战场点单位卡 / 区（online-ui.js 的 battleCb），选目标、选区、出手照旧问主机；悬停铭牌弹旧画面同样的单位说明。
// 都在 Node 里跑：原型页的假网页（tests/hd2d-fake-page.js）里放进 online-battle.js 和正式画面的 hd2d-field.js，3D 场景换成假的；
// online-ui.js 里联机玩家战斗画面的那几段（battleCb、新画面、battleUi、menu / choose / call、playPacket）从源码里抠出来跑，其余的给假的。WebGL 画面由仓库主人看。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const HP = require("./hd2d-paths");

const read = (f) => fs.readFileSync(path.join(HP.ROOT, f), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");   // 去掉注释，只看代码
const PARTY = ["kolt", "helu", "ruby", "yuito"];
const DESKTOP = { width: 1100, height: 620, top: 40, bottom: 40 };
const STAGE = { left: 100, top: 50 };
const SHP = 7771, SHP_MAX = 7772;
const SECRET = "房主私有笔记甲乙丙";       // 房主 state 里的私有内容：投影过就不该出现在新画面的任何地方
const settle = async (n) => { for (let i = 0; i < (n || 6); i++) await new Promise(r => setImmediate(r)); };

/** 从源码里抠出一个函数（连着前面的 async；按大括号配对，这几个函数的字符串里大括号都是配对的） */
function fnSrc(src, name) {
  let at = src.indexOf("function " + name + "(");
  assert.ok(at >= 0, "找不到 " + name);
  if (src.slice(at - 6, at) === "async ") at -= 6;
  let i = src.indexOf("{", src.indexOf(")", at)), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(at, i + 1);
}
/** online-ui.js 里联机玩家战斗画面的那几段：战场点选（battleCb）+ 新画面（#289）一段、battleUi、menu / choose / call、playPacket */
function onlineSrc() {
  const src = read("online-ui.js");
  const a = src.indexOf("    const battleCb = {"), b = src.indexOf("    /** 结束行动前");
  assert.ok(a > 0 && b > a, "online-ui.js 里 battleCb 后面接着新画面那一段");
  return { src, block: src.slice(a, b), fns: ["battleUi", "menu", "choose", "call", "playPacket"].map(n => fnSrc(src, n)).join("\n") };
}

/** 假的 3D 场景：记下交给它的布局、标记、谁在行动；点击 / 悬停的回调在 options 里 */
function fakeScene(log) {
  return (stage, options) => {
    const C = log.ctx.HD2DCamera;
    const sc = {
      portrait: false, motion: true, tier: "far", zone: null, flash: 0, layout: null, stage, options, layouts: [], marks: [], actors: [], disposed: false,
      view: () => DESKTOP,
      setInsets: () => {}, refit: () => {}, setWind: () => {}, setTier: () => {}, stepZone: () => {},
      setMarks: (m) => sc.marks.push(m), setActor: (id) => sc.actors.push(id),
      setBattle: (layout, meta) => { sc.layouts.push(layout); sc.layout = layout; sc.meta = meta; },
      lensNow: () => ({ pos: sc.layout.camera.pos, target: sc.layout.camera.target, fov: sc.layout.camera.fov, width: DESKTOP.width, height: DESKTOP.height }),
      plateOf: (id) => { const u = sc.layout && sc.layout.units.find(x => x.id === id); return u ? { x: u.x, y: u.y, z: u.z, lift: u.lift, big: false, zoom: 1 } : null; },
      zoneOf: (id) => (sc.layout ? sc.layout.zones.find(z => z.id === Number(id)) || null : null),
      poseNow: () => Object.assign(C.pose(sc.layout, "far", null, {}), { tier: "far" }),
      posePush: () => {}, poseRelease: () => {},
      dispose: () => { sc.disposed = true; }
    };
    log.scenes.push(sc);
    return sc;
  };
}

/**
 * 一位联机玩家的页面：原型页的假网页 + online-battle.js + hd2d-field.js；单机的 #g-app（顶栏里有开关）/ #g-field 照 game.html 摆着，
 * 联机舞台（顶上工具栏的 .ol-hd2d-slot、战斗画面 .ol-battle 的战场）另建。房主的 state 每个人塞上特殊的坚毅生命数、私有笔记，玩家拿到的是投影过的。
 * opts.on = 本机记着新画面开；opts.reduced = 减少动态效果（转场直接切）
 */
async function olPage(opts) {
  opts = opts || {};
  const page = require("./hd2d-fake-page").load();
  assert.deepEqual(page.errors, []);
  const ctx = page.ctx, doc = page.document, proto = ctx.HTMLElement.prototype;
  const log = { ctx, scenes: [], nums: [], bubbles: [], tips: [], hints: [], loads: 0 };
  // 3D 战场那一层量得到大小和位置；监听记下来（点开关）；挂上去的纸片风数字、旧画面的弹字记下来；云雾那一层要写行内的 CSS 变量
  const rect0 = proto.getBoundingClientRect, ap = proto.appendChild;
  Object.defineProperty(proto, "clientWidth", { configurable: true, get() { return this.classList.contains("hd2d-field") ? DESKTOP.width : 0; } });
  proto.getBoundingClientRect = function () {
    return this.classList.contains("hd2d-field") ? { left: STAGE.left, top: STAGE.top, width: DESKTOP.width, height: DESKTOP.height, right: STAGE.left + DESKTOP.width, bottom: STAGE.top + DESKTOP.height } : rect0.call(this);
  };
  proto.addEventListener = function (t, f) { const on = this._on || (this._on = {}); (on[t] = on[t] || []).push(f); };
  proto.appendChild = function (c) {
    const cls = c && typeof c === "object" && c.className ? String(c.className) : "";
    if (/\bhd2d-num\b/.test(cls)) log.nums.push(c);
    if (/\bol-pop-temp\b/.test(cls)) log.bubbles.push(c);
    return ap.call(this, c);
  };
  const ce = doc.createElement;
  doc.createElement = function (t) { const e = ce.call(doc, t); e.style.setProperty = function (k, v) { this[k] = String(v); }; return e; };
  ctx.setTimeout = (fn) => setTimeout(fn, 0);          // 假网页的计时器不走：演出、弹字的停顿换成马上（真的计时器）
  ctx.requestAnimationFrame = (fn) => { fn(); return 0; };
  ctx.HitFx = { burst() {}, clear() {} };              // 受击粒子要真的画布
  ctx.HD2DWfx = { windOf: () => ({ x: 1, z: 0 }), create: () => ({ sync() {}, dispose() {} }) };
  ["online-battle.js", "hd2d/hd2d-field.js"].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const F = ctx.HD2DField, OV = ctx.OnlineView;

  // 房主那边的战斗：坚毅生命、私有笔记都塞上；一个爆炸桶（配置物也有私有字段）
  const st = ctx.BattleSim.setup({
    party: PARTY, zoneMode: 3, seed: "hd2d-online", region: "第一采矿场", light: "dusk",
    enemies: [{ id: "guard_sword", lv: 2, zone: 3 }, { id: "thug_hammer", lv: 2, zone: 2 }]
  });
  st.units.forEach(u => { u.shp = SHP; u.shpMax = SHP_MAX; u.baseShp = SHP; u.shpBase = SHP; u.shpBonus = SHP_MAX; u.gmNote = SECRET; u.aiPlan = SECRET; });
  st.props = (st.props || []).concat([{ id: "boom1", kind: "boom", zone: 2, hp: 3, maxHp: 3, faction: "neutral", gmNote: SECRET }]);
  st.gmNote = SECRET; st.scenePick = SECRET;
  const kolt = st.units.find(u => u.kit === "kolt"), foe = st.units.find(u => u.kit === "thug_hammer"), guard = st.units.find(u => u.kit === "guard_sword");
  const pv = OV.projectState(st, { itemCatalog: {} });

  // 单机的战斗画面（game.html）：顶栏里的开关、#g-field；单机的 GAME 也在（联机玩家的页面就是 game.html）
  const app = doc.createElement("div"); app.id = "g-app"; doc.body.appendChild(app);
  const top = doc.createElement("header"); app.appendChild(top);
  const btn = doc.createElement("button"); btn.id = "g-hd2d-toggle"; top.appendChild(btn);
  const nextBtn = doc.createElement("a"); top.appendChild(nextBtn);
  const field = doc.createElement("main"); field.id = "g-field"; app.appendChild(field);
  const solo = [];
  ctx.GAME = { depth: 0, fxClock: () => 1, snapAll: () => null, refresh() {}, fieldInput: { unit: (id) => solo.push(id), hover() {}, zone() {}, zoneHover() {} } };
  // 联机舞台：顶上工具栏的开关位置、战斗画面（online-battle.js 的 .ol-battle：战场 + 单位卡）
  const stage = doc.createElement("main"); stage.className = "ol-ui ol-stage"; doc.body.appendChild(stage);
  const slot = doc.createElement("span"); slot.className = "ol-hd2d-slot"; stage.appendChild(slot);
  const ol = doc.createElement("div"); ol.className = "ol-battle"; stage.appendChild(ol);
  const olField = doc.createElement("main"); olField.className = "g-field ol-field"; ol.appendChild(olField);
  stage.querySelector = (sel) => (sel === ".ol-hd2d-slot" ? slot : null);
  ol.querySelector = (sel) => (sel === ".g-field" ? olField : null);
  const cards = {};
  st.units.forEach(u => { const c = doc.createElement("div"); c.dataset.unitId = u.id; cards[u.id] = c; });
  const battle = { el: ol, cardOf: (id) => cards[id] || null };

  const mem = new Map(opts.on ? [[F.FIELD.storageKey, "on"]] : []), writes = [];
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); writes.push([k, String(v)]); } };
  const q = [], clock = { t: 100 };
  F.boot({ doc, storage, load: () => { log.loads++; return Promise.resolve(fakeScene(log)); }, hint: (m) => log.hints.push(m), reduced: () => !!opts.reduced, wait: (s, fn) => q.push(fn), now: () => clock.t });
  await settle();

  // 联机那边（online-ui.js 抠出来的几段）：这位玩家（p1）操控柯尔特，轮到他；主机的动作菜单照 online-player-ui.test.js 的样子回
  const heroes = st.units.filter(u => u.isPlayer).map((u, i) => ({ id: u.id, owner: i === 0 ? "p1" : "p2" }));
  const calls = [];
  const api = {
    getView: () => ({ isHost: false }),
    submit(cmd) { calls.push(["submit", JSON.parse(JSON.stringify(cmd))]); return { ok: true }; },
    async actionMenu(req) {
      calls.push(["menu", JSON.parse(JSON.stringify(req))]);
      const base = { type: "actionOptions", displayOnly: true, actor: req.actor, skill: req.skill };
      if (!req.skill) return Object.assign(base, { choices: { kind: "skill", options: [{ value: "kolt_aa", label: "普通攻击" }, { value: "__move", label: "移动" }] } });
      if (req.skill === "__move" && req.dest == null) return Object.assign(base, { choices: { kind: "zone", key: "dest", title: "选择区域", options: [{ value: 2, label: "2 区" }, { value: 3, label: "3 区", disabled: true }] } });
      if (req.skill === "kolt_aa" && !req.target) return Object.assign(base, { choices: { kind: "unit", key: "target", title: "选择目标", options: [{ value: foe.id, label: "敌人" }, { value: guard.id, label: "够不着", disabled: true }] } });
      const command = req.skill === "__move" ? { type: "move", actor: req.actor, dest: req.dest } : { type: "skill", actor: req.actor, skill: req.skill, target: req.target };
      return Object.assign(base, { choices: { kind: "ready", title: "确认执行", command, options: [] } });
    }
  };
  const V = {
    global: { HD2DField: F, OnlineBattle: ctx.OnlineBattle, OnlineView: OV, GAME: ctx.GAME, matchMedia: ctx.matchMedia, bigHitInfo: ctx.bigHitInfo,
      UnitTip: { show: (el, h) => log.tips.push([el, h]), hide: () => log.tips.push(null) } },
    api, stage, battle, renders: 0,
    view: { active: true, isHost: false, screen: "battle", state: pv, packet: { view: { phase: "acting", currentUnitId: kolt.id, units: heroes } } },
    tip: (node) => "单位说明 " + JSON.stringify(node.dataset)
  };
  const { block, fns } = onlineSrc();
  const make = new vm.Script(`(function (V) {
    const global = V.global, api = V.api, stage = V.stage, copy = (v) => JSON.parse(JSON.stringify(v));
    let view = V.view, displayState = null, animating = false, destroyed = false, notice = "", pending = false, battle = V.battle;
    let currentMenu = null, request = null, selectedActor = "", actionGeneration = 0, playbackGeneration = 0, skillOptions = [], skillsFor = "", autoKey = "";
    let historyRows = [], historyHasMore = true, historyLoading = false, historyGeneration = 0, seenMessages = new Set(), messagesInitialized = false, toastTimer = 0, lobbySeen = null;
    const toast = { hidden: true };
    const hs = () => (view.packet && view.packet.view) || {};
    const own = () => "p1", playerName = (id) => id;
    const disabled = () => pending || animating;
    const fieldAsk = () => null, answerField = () => {}, endTurnOk = async () => true;
    const myUnits = () => (hs().units || []).filter(u => u.owner === own()).map(u => u.id);
    const isMyTurn = () => view.screen === "battle" && hs().phase === "acting" && myUnits().includes(hs().currentUnitId);
    const render = () => { V.renders++; };
    const paintStage = () => {};
    const unitTip = (node) => V.tip(node);
    const strikeOnline = async () => null, onlineCtx = () => null, zoomOnline = () => false, zoomOutOnline = () => {};
    ${block}
    ${fns}
    return { battleCb, hd2dSpec, marksOf3d, paintField3d, playPacket, battleUi, menu,
      get field3d() { return field3d; }, get displayState() { return displayState; }, get animating() { return animating; }, get menuNow() { return currentMenu; } };
  })`, { filename: "online-ui.js（抠出来的联机玩家战斗画面）" });
  const U = make.runInContext(ctx)(V);
  /** paintStage 画完战斗画面以后那一下（online-ui.js · paintStage → paintField3d） */
  const paint = () => U.paintField3d(U.battleUi());
  /** 跑排着的转场计时器，一段一段走到底 */
  const drain = async () => { for (let i = 0; i < 12 && (q.length || F.transition().busy); i++) { const fn = q.shift(); if (fn) fn(); await settle(); } };
  const scene = () => log.scenes[log.scenes.length - 1];
  const mist = () => olField.childNodes.find(c => c && c.className && String(c.className).split(" ").includes("hd2d-mist")) || null;
  /** 联机战场上的一下滚轮（往前滚 = 拉近）；target = 落在哪个元素上 */
  const wheel = (target, deltaY) => {
    const ev = { deltaY: deltaY == null ? -120 : deltaY, deltaMode: 0, ctrlKey: false, target, prevented: 0, preventDefault() { this.prevented++; }, stopPropagation() {} };
    (olField._on.wheel || []).forEach(f => f(ev));
    return ev;
  };
  return { page, ctx, doc, F, OV, st, pv, kolt, foe, guard, app, top, btn, nextBtn, field, stage, slot, ol, olField, cards, mem, writes, calls, log, V, U, paint, drain, scene, mist, q, solo, wheel, clock };
}
/** 一棵 DOM 里的字（文字、属性、行内样式、innerHTML）都拼起来 */
function domText(el) {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    out.push(String(n.textContent || ""), String(n._html || ""), JSON.stringify(n._attrs || {}), JSON.stringify(n.style || {}), String(n.title || ""), String(n.className || ""));
    (n.childNodes || []).forEach(walk);
  };
  walk(el);
  return out.join("\n");
}
function noSecret(text, tag) {
  assert.ok(!text.includes(SECRET), tag + "：出现了房主的私有内容");
  assert.ok(!text.includes(String(SHP)) && !text.includes(String(SHP_MAX)), tag + "：出现了坚毅生命的数字");
  assert.doesNotMatch(text, /"shp(Max|Base|Bonus)?"|baseShp|坚毅/, tag + "：出现了坚毅生命的字段");
}

/* ---------- 1. 开关、云雾转场：同一个入口，只在这台电脑上 ---------- */
test("联机玩家开 / 关新画面：同一个开关（#g-hd2d-toggle 挪到联机舞台顶上）、同一套云雾转场（switchTo，云雾铺在联机的战场上），开关只记在本机 localStorage，什么都不经过联机的 api 发出去；离开战斗开关放回单机的顶栏", async () => {
  const P = await olPage();
  assert.equal(typeof P.F.attach, "function", "hd2d-field.js 有 attach（联机玩家的战斗画面挂上去）");
  P.paint();
  assert.equal(P.btn.parentNode, P.slot, "同一个按钮挪到联机舞台顶上的工具栏");
  assert.equal(P.btn.textContent, "新画面 关");
  assert.equal(P.log.loads, 0, "关着：什么都不加载");
  assert.equal(P.ol.classList.contains("hd2d-on"), false, "关着：旧战场照旧");
  // 旧战场上往前滚：联机的战场（或者区）还没滚到顶 → 照旧滚，这一次滚动不打开新画面；滚到顶了再往前滚 → 同一个入口打开
  P.olField.scrollTop = 200;
  const e1 = P.wheel(P.olField);
  P.wheel(P.olField);
  assert.equal(P.F.transition().busy, false, "还没滚到顶：不打开新画面");
  assert.equal(e1.prevented, 0, "照旧是战场自己的滚动");
  P.olField.scrollTop = 0; P.clock.t += 5;
  const e2 = P.wheel(P.olField);
  assert.deepEqual(JSON.parse(JSON.stringify(P.F.transition())), { busy: true, to: "new", step: "cover" }, "滚到顶了往前滚：云雾转场打开新画面");
  assert.ok(e2.prevented > 0);
  await P.drain();
  assert.ok(P.scene() && P.ol.classList.contains("hd2d-on"), "打开了");
  P.btn._on.click.forEach(f => f({}));
  await P.drain();
  assert.equal(P.ol.classList.contains("hd2d-on"), false, "开关关掉");
  P.writes.length = 0;
  // 点开关：和单机同一个入口（switchTo）——云雾从四边涌进来（铺在联机的战场上），盖满时建好 3D，云雾散开
  P.btn._on.click.forEach(f => f({}));
  assert.deepEqual(JSON.parse(JSON.stringify(P.F.transition())), { busy: true, to: "new", step: "cover" }, "走云雾转场");
  assert.ok(P.mist(), "云雾铺在联机玩家的战场上");
  assert.equal(P.field.childNodes.some(c => c && String(c.className || "").includes("hd2d-mist")), false, "不铺到单机的 #g-field");
  await P.drain();
  assert.equal(P.F.transition().busy, false, "转场走完");
  assert.equal(P.mist(), null, "云雾拿掉");
  const sc = P.scene();
  assert.ok(sc && !sc.disposed, "3D 战场建好了");
  assert.equal(sc.stage.parentNode, P.olField, "3D 那一层铺在联机的战场里");
  assert.ok(P.ol.classList.contains("hd2d-on"), "联机的战斗画面加 hd2d-on（旧的单位卡看不见）");
  assert.equal(P.app.classList.contains("hd2d-on"), false, "单机的 #g-app 不动");
  assert.equal(P.btn.textContent, "新画面 开");
  assert.deepEqual(P.writes, [[P.F.FIELD.storageKey, "on"]], "开关只记在本机");
  // 再点：转回旧画面（镜头升到正上方 → 云雾 → 拆掉）
  P.btn._on.click.forEach(f => f({}));
  assert.equal(P.F.transition().to, "old");
  await P.drain();
  assert.ok(sc.disposed && !P.ol.classList.contains("hd2d-on"), "拆干净，旧战场回来");
  assert.equal(P.btn.textContent, "新画面 关");
  assert.deepEqual(P.writes.map(w => w[1]), ["on", "off"]);
  assert.deepEqual(P.calls, [], "开 / 关新画面、转场都不经过联机的 api（不发给别人）");
  // 离开战斗（探索、离开房间）：拆下来，开关放回单机顶栏原来的位置
  P.U.paintField3d(null);
  assert.equal(P.btn.parentNode, P.top, "开关放回单机的顶栏");
  assert.equal(P.top.childNodes.indexOf(P.btn), P.top.childNodes.indexOf(P.nextBtn) - 1, "原来的位置");
  // 源码：联机这边的新画面一段只交给 hd2d-field.js，不碰 api、不发包
  const { block } = onlineSrc();
  const own = code(block.slice(block.indexOf("let field3d")));
  assert.doesNotMatch(own, /\bapi\.|submit\(|actionMenu/, "新画面那一段不经过联机的 api");
  assert.match(code(read("online-ui.js")), /screen === "battle" \|\| screen === "ended"\) && global\.HD2DField \? '<span class="ol-hd2d-slot"><\/span>' : ""/, "舞台顶上的工具栏给开关留位置（有战斗画面时）");
});

test("联机玩家本机记着开：进战斗直接在他的战斗画面上建好（不播转场）；单机那边已经建好的拆掉；game.js 的刷新管不到联机的画面", async () => {
  const P = await olPage({ on: true });
  assert.equal(P.log.scenes.length, 1, "刚打开页面：照旧建在单机的 #g-field 上（和以前一样）");
  const soloScene = P.scene();
  assert.equal(soloScene.stage.parentNode, P.field);
  P.paint();
  await settle();
  assert.ok(soloScene.disposed, "单机那边的拆掉");
  assert.equal(P.app.classList.contains("hd2d-on"), false);
  const sc = P.scene();
  assert.ok(sc !== soloScene && sc.stage.parentNode === P.olField, "建在联机玩家的战场上");
  assert.equal(P.F.transition().busy, false, "不播转场");
  assert.equal(P.log.loads, 1, "加载过的不再加载");
  assert.equal(P.F.on(), false, "game.js 看的 on()：单机的新画面没开（演出位置照旧问单位卡）");
  assert.equal(P.U.field3d.on(), true, "联机的把手：开着");
  const n = sc.layouts.length;
  P.F.view([]); P.F.actor("x"); P.F.marks({ pick: true, targets: ["x"] });
  assert.equal(sc.layouts.length, n, "game.js 的 setView 不重排联机的画面");
  assert.ok(!sc.actors.includes("x"), "game.js 的 refreshHud 管不到联机的画面");
});

/* ---------- 2. 只用投影过的数据 ---------- */
test("新画面只用收到的包：带房主私有字段的 state 投影后喂给新画面——交给场景的布局、3D 战场 / 镜头按钮 / 开关的 DOM 里都没有私有内容，也没有坚毅生命的数字；不读单机的快照", async () => {
  const P = await olPage({ on: true });
  P.ctx.GAME.snapAll = () => { throw new Error("联机玩家的新画面读了单机的快照"); };
  P.ctx.battleLookSync = () => { throw new Error("联机玩家的新画面去同步房主的区域 / 光影"); };
  P.paint();
  await settle();
  const sc = P.scene(), lay = sc.layouts[sc.layouts.length - 1];
  assert.ok(lay, "排了布局");
  noSecret(JSON.stringify(lay), "交给场景的布局");
  noSecret(JSON.stringify(sc.meta), "交给场景的天气 / 光影");
  noSecret(domText(P.olField), "联机战场里新画面的 DOM");
  noSecret(domText(P.btn), "开关");
  // 画面就是收到的那一份：单位、区域 / 光影、配置物（照单机的样子当铭牌）都来自投影
  assert.equal(lay.region, "第一采矿场");
  assert.equal(sc.meta.theme, "dusk", "光影读投影");
  assert.deepEqual(lay.units.map(u => u.id).filter(id => id.indexOf("prop:") !== 0).sort(), P.pv.units.filter(u => !u.hidden && !u.dead).map(u => u.id).sort(), "单位都是投影里的");
  assert.ok(lay.units.some(u => u.id === "prop:boom1"), "爆炸桶也有铭牌");
  const v = P.F.packetView(P.pv, { OB: P.ctx.OnlineBattle, OV: P.OV });
  assert.deepEqual(JSON.parse(JSON.stringify(v.units.filter(u => u.id.indexOf("prop:") !== 0))), JSON.parse(JSON.stringify(P.pv.units)), "单位原样用投影里的，不加字段");
  noSecret(JSON.stringify(v), "packetView");
  // 演出途中换过单位的那一份也照样（online-ui.js 按演出带换 displayState.units）
  assert.equal(P.F.packetView(null), null);
  assert.equal(P.F.packetView({ units: "x" }), null);
});

/* ---------- 3. 收到行动包 ---------- */
function actionPacket(P) {
  const before = P.foe.layers.map(l => l.current);
  P.foe.layers[P.foe.layers.length - 1].current = Math.max(1, P.foe.layers[P.foe.layers.length - 1].current - 12);
  const after = P.OV.projectState(P.st, { itemCatalog: {} });
  P.foe.layers.forEach((l, i) => { l.current = before[i]; });
  const tape = P.OV.projectTape([{ type: "pop", kind: "dmg", unitId: P.foe.id, value: 12, element: "physical", main: true, snap: [{ id: P.foe.id, shp: SHP, shpMax: SHP_MAX }] }], { state: P.st });
  assert.equal(tape.length, 1);
  assert.equal(tape[0].value, 12, "投影过的演出带给了数（敌人的血是看得见的）");
  return { type: "action", displayOnly: true, seq: 2, state: after, tape, fx: null };
}
test("收到行动包：新画面开着整包交给 hd2d-play.js 播——弹纸片风数字（.hd2d-num），旧画面的弹字一个都没有，画面换成包里的 state；关着照旧是旧画面的弹字（单位卡上的 .ol-popup），纸片风一个都没有", async () => {
  // 开着
  const A = await olPage({ on: true });
  A.paint(); await settle();
  assert.equal(A.U.field3d.on(), true);
  const pa = actionPacket(A);
  await A.U.playPacket(pa);
  assert.ok(A.log.nums.length >= 1, "弹了纸片风数字");
  assert.ok(A.log.nums.some(n => /12/.test(n.textContent)), "数字是包里给的");
  assert.equal(A.log.bubbles.length, 0, "旧画面的弹字一个都没有");
  assert.equal(A.U.displayState, pa.state, "播完画面是包里的 state");
  assert.equal(A.U.animating, false);
  A.log.nums.forEach(n => noSecret(domText(n), "纸片风数字"));
  // 关着
  const B = await olPage();
  B.paint();
  assert.equal(B.U.field3d.on(), false);
  const pb = actionPacket(B);
  await B.U.playPacket(pb);
  assert.equal(B.log.nums.length, 0, "关着：纸片风一个都没有");
  assert.ok(B.log.bubbles.length >= 1, "关着：旧画面的弹字照旧挂在单位卡上");
  assert.equal(B.log.bubbles[0].parentNode === B.cards[B.foe.id] || B.log.bubbles[0].textContent === "−12", true, "旧的写法：挨打的人卡上「−12」");
  assert.equal(B.U.displayState, pb.state);
  // 源码：开着的分支在旧写法之前，旧写法一点没变
  const src = code(fnSrc(read("online-ui.js"), "playPacket"));
  assert.match(src, /if \(!tape\.length\) return;\s*if \(field3d && field3d\.on\(\)\) \{ await play3d\(packet, generation\); return; \}\s*animating = true; render\(\);/);
  assert.match(src, /bubble\.textContent = event\.text \|\| \(event\.value == null \?/, "旧画面的弹字照旧");
  const f = code(read("hd2d/hd2d-field.js"));
  assert.match(fnSrc(f, "play"), /PL\.play\(packet, S\.ad, \{/, "交给 hd2d-play.js（原型页同一份），不复制一份演出");
});

/* ---------- 4. 3D 上点铭牌 / 地台 ---------- */
test("轮到这位玩家：3D 上点铭牌选目标、出手；点地台选区、移动；悬停铭牌弹旧画面同样的单位说明——都走旧战场的回调（battleCb），出手照旧问主机", async () => {
  const P = await olPage({ on: true });
  P.paint(); await settle();
  const sc = P.scene(), o = sc.options;
  assert.equal(typeof o.onUnitClick, "function", "铭牌的点击接上了");
  // 选了普通攻击：能点的目标描边、其余变暗（和旧画面的 is-targetable / is-dim 同一个判断）
  await P.U.menu({ actor: P.kolt.id, skill: "kolt_aa" });
  P.paint();
  const m = sc.marks[sc.marks.length - 1];
  assert.deepEqual([...m.targets], [P.foe.id], "能选的目标（够不着的灰掉的不算）");
  assert.ok(m.dim.has(P.guard.id) && !m.dim.has(P.foe.id) && !m.dim.has(P.kolt.id), "不是目标的变暗，行动的人不暗");
  assert.equal(sc.actors[sc.actors.length - 1], P.kolt.id, "谁在行动");
  // 悬停铭牌：旧画面同样的单位说明挂在铭牌上，标记跟着
  const plate = P.doc.createElement("div");
  o.onUnitHover(P.foe.id, true, plate);
  const tip = P.log.tips[P.log.tips.length - 1];
  assert.ok(tip && tip[0] === plate && tip[1].includes(P.foe.id), "单位说明挂在铭牌上");
  assert.equal(sc.marks[sc.marks.length - 1].aim, P.foe.id, "悬停的目标亮起来");
  o.onUnitHover(P.foe.id, false, plate);
  assert.equal(P.log.tips[P.log.tips.length - 1], null, "移开就收起");
  // 点够不着的：什么都不发；点敌人的铭牌：出手
  o.onUnitClick(P.guard.id); await settle();
  assert.ok(!P.calls.some(c => c[0] === "submit"), "点不能选的铭牌不出手");
  o.onUnitClick(P.foe.id); await settle();
  assert.deepEqual(P.calls.filter(c => c[0] === "submit").map(c => c[1]), [{ type: "skill", actor: P.kolt.id, skill: "kolt_aa", target: P.foe.id }], "点铭牌 = 点单位卡：选目标、出手");
  // 移动：点地台选区（灰掉的区不算）
  await P.U.menu({ actor: P.kolt.id, skill: "__move" });
  P.paint();
  assert.deepEqual([...sc.marks[sc.marks.length - 1].zones], [2], "能去的区亮框");
  o.onZoneHover(2, true);
  assert.equal(sc.marks[sc.marks.length - 1].hoverZone, 2);
  o.onZoneClick(3); await settle();
  assert.equal(P.calls.filter(c => c[0] === "submit").length, 1, "点不能去的区不动");
  o.onZoneClick(2); await settle();
  assert.deepEqual(P.calls.filter(c => c[0] === "submit").pop()[1], { type: "move", actor: P.kolt.id, dest: 2 }, "点地台 = 点区：移动");
  assert.deepEqual(P.solo, [], "不走单机的 GAME.fieldInput");
  // 源码：3D 的点击转给 battleCb（旧战场同一份），不另开一条路
  const { block } = onlineSrc();
  assert.match(block, /battle = global\.OnlineBattle\.create\(battleCb\)|const battleCb = \{/);
  assert.match(code(read("online-ui.js")), /battle = global\.OnlineBattle\.create\(battleCb\);/, "旧战场用的也是 battleCb");
  assert.match(code(block), /unit: id => \{ if \(animating\) \{ skip3d\(\); return; \} battleCb\.onUnit\(id\); \}/);
  assert.match(code(block), /zone: z => \{ if \(animating\) \{ skip3d\(\); return; \} if \(z != null\) battleCb\.onZone\(z\); \}/);
});

/* ---------- 5. 样式 ---------- */
test("样式：联机的战斗画面开着新画面时盖住旧的区和单位卡（首领横幅、云雾照旧露在上面）；纸片风数字那一层联机玩家也看得到；关着时这些一条都套不上", () => {
  const css = read("hd2d/hd2d.css"), ol = read("online.css");
  assert.match(css, /\.ol-battle\.hd2d-on > \.g-field \{ visibility: hidden;/);
  assert.match(css, /\.ol-battle\.hd2d-on > \.g-field > \.hd2d-field, \.ol-battle\.hd2d-on > \.g-field > \.g-topstack, \.ol-battle\.hd2d-on > \.g-field > \.hd2d-mist \{ visibility: visible; \}/);
  assert.match(ol, /body\.online-player > :not\(\.ol-ui\)[^{]*:not\(#hd2d-pop\) \{ display: none !important; \}/, "#hd2d-pop 不被联机玩家画面藏掉");
});
