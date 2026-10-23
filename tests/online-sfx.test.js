// 联机玩家的音效（#304）：
//   · 播收到的包时和单机响一样的音效（online-sfx.js；旧画面 online-ui.js · playPacket、新画面 hd2d/hd2d-play.js 都接上），跳过 / 被顶掉 / 音效关着时不响
//   · 轮到自己时的提示音：DJ 搓碟（sfx.js · Sfx.scratch，数值在 SCRATCH，sfx-tuner.html 能试听、调参数）；同一次只响一次
//   · 暂停页面里的「音效 开 / 关」（pause-menu.js；online-ui.js 登记），和单机同一个本机开关
// 不用浏览器：假的 AudioContext 记下建了哪些声音节点；画面那一边给 Sfx 打桩。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

/** 无界面加载 sfx.js：假的 AudioContext 记下建了哪些声音节点（波形、音高、扫频曲线、起止、滤波器、音量） */
function loadSfx(store) {
  const nodes = [];
  const param = (value) => ({ value, events: [],
    setValueAtTime(v, t) { this.events.push(["set", v, t]); }, exponentialRampToValueAtTime(v, t) { this.events.push(["exp", v, t]); },
    linearRampToValueAtTime(v, t) { this.events.push(["lin", v, t]); }, setValueCurveAtTime(c, t, d) { this.events.push(["curve", Array.from(c), t, d]); } });
  const node = (kind, extra) => { const n = Object.assign({ kind, connect() {}, disconnect() {} }, extra); nodes.push(n); return n; };
  let ac = null;
  class FakeAudioContext {
    constructor() { ac = this; this.currentTime = 0; this.state = "running"; this.sampleRate = 44100; this.destination = {}; }
    createDynamicsCompressor() { return node("comp", { threshold: param(0), ratio: param(1) }); }
    createGain() { return node("gain", { gain: param(1) }); }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
    createOscillator() { return node("osc", { type: "sine", frequency: param(440), start(t) { this.at = t; }, stop(t) { this.end = t; } }); }
    createBiquadFilter() { return node("filter", { type: "lowpass", frequency: param(350), Q: param(1) }); }
    createBufferSource() { return node("src", { playbackRate: param(1), start(t) { this.at = t; }, stop(t) { this.end = t; } }); }
    createConvolver() { return node("conv", {}); }
    resume() { return Promise.resolve(); }
  }
  store = store || new Map();
  const win = { AudioContext: FakeAudioContext, addEventListener() {}, localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) } };
  win.window = win;
  vm.runInContext(read("sfx.js"), vm.createContext(win));
  return { Sfx: win.Sfx, nodes, ac: () => ac, store };
}
const curveOf = (p) => (p.events.find(e => e[0] === "curve") || null);
const plain = v => JSON.parse(JSON.stringify(v));   // vm 里建的数组换成这边的，deepEqual 才比得了

test("搓碟提示音的参数都在配置表 SCRATCH 里（总长、来回几下、扫多快多宽、音量、滤波、唱针）；sfx-tuner.html 能试听、调这些参数", () => {
  const { Sfx } = loadSfx();
  const S = Sfx.SCRATCH;
  for (const k of ["len", "strokes", "lead", "gap", "low", "high", "speed", "back", "q", "tone", "toneLow", "toneHigh", "gain", "throttle"]) assert.equal(typeof S[k], "number", "SCRATCH." + k);
  for (const k of ["at", "gain", "freq", "len", "click"]) assert.equal(typeof S.needle[k], "number", "SCRATCH.needle." + k);
  assert.ok(S.strokes >= 2 && S.strokes <= 4, "来回两三下");
  assert.ok(S.low < S.high, "扫频有宽度");
  // 不加录音文件：现场合成
  assert.doesNotMatch(read("sfx-samples.js"), /\bscratch\s*:/);
  // 调音台：有这一块，推子按 SCRATCH 的键生成，试听叫 Sfx.scratch，复制参数带上 SCRATCH
  const tuner = read("sfx-tuner.html");
  assert.match(tuner, /Sfx\.SCRATCH/);
  assert.match(tuner, /Sfx\.scratch\(/);
  for (const k of ["len", "strokes", "gap", "low", "high", "speed", "q", "gain"]) assert.match(tuner, new RegExp(`\\["${k}",`), "调音台能调 " + k);
  assert.match(tuner, /（SCRATCH）/, "复制参数里带上 SCRATCH");
});

test("搓碟（sfx.js · Sfx.scratch）：噪声过带通，每一下的带通中心 / 播放速度 / 音量按半个正弦扫上去再落下来；第一下长、后面短，推拉轮流；最后唱针落下；音效关着时一点声音都不出", () => {
  const { Sfx, nodes, ac } = loadSfx();
  const S = Sfx.SCRATCH;
  assert.equal(Sfx.scratch(), true);
  const bands = nodes.filter(n => n.kind === "filter" && n.type === "bandpass");
  assert.equal(bands.length, S.strokes, "一下一个带通");
  bands.forEach(b => assert.equal(b.Q.value, S.q, "带通的 Q 照配置"));
  const plan = Sfx.scratchPlan();
  assert.equal(plan.length, S.strokes);
  assert.ok(plan[0].len > plan[1].len, "第一下长（「嚓—」），后面短（「嚓嚓」）");
  assert.deepEqual(plain(plan.map(p => p.dir)), Array.from({ length: S.strokes }, (_, i) => (i % 2 ? -1 : 1)), "一推一拉轮流");
  const end = plan[plan.length - 1].at + plan[plan.length - 1].len;
  assert.ok(Math.abs(end - S.len) < 1e-9, "总长照配置");
  for (let i = 1; i < plan.length; i++) assert.ok(Math.abs(plan[i].at - (plan[i - 1].at + plan[i - 1].len) - S.gap) < 1e-9, "两下之间停 gap");
  // 扫频：两头在下沿，中间到顶；往前推的到上沿，往回拉的低一点
  bands.forEach((b, i) => {
    const c = curveOf(b.frequency);
    assert.ok(c, "带通中心在扫");
    const top = Math.max(...c[1]);
    assert.ok(Math.abs(c[1][0] - S.low) < 1e-6 && Math.abs(c[1][c[1].length - 1] - S.low) < 1e-6, "两头（手换方向）在下沿");
    assert.ok(Math.abs(top - (plan[i].dir > 0 ? S.high : S.low + (S.high - S.low) * S.back)) < 1, "中间到顶：" + top);
    assert.ok(Math.abs(c[2] - (0.005 + plan[i].at)) < 1e-9 && Math.abs(c[3] - plan[i].len) < 1e-9, "时间照计划");
  });
  // 噪声的播放速度也跟着扫，最快的那一下照 speed
  const srcs = nodes.filter(n => n.kind === "src" && curveOf(n.playbackRate));
  assert.equal(srcs.length, S.strokes);
  assert.ok(Math.abs(Math.max(...srcs.flatMap(s => curveOf(s.playbackRate)[1])) - S.speed) < 1e-6, "播放速度扫到 speed");
  // 音量：每一下两头是 0（没有「咔」），中间最大 = gain
  const vols = nodes.filter(n => n.kind === "gain" && curveOf(n.gain)).map(n => curveOf(n.gain)[1]);
  assert.equal(vols.length, S.strokes);
  vols.forEach(v => assert.ok(v[0] === 0 && v[v.length - 1] < 1e-6, "两头没声音"));
  assert.ok(Math.abs(Math.max(...vols.flat()) - S.gain) < 1e-6, "音量照配置");
  // 跟着扫的锯齿波
  const saws = nodes.filter(n => n.kind === "osc" && n.type === "sawtooth");
  assert.equal(saws.length, S.strokes);
  assert.ok(Math.abs(Math.max(...saws.flatMap(o => curveOf(o.frequency)[1])) - S.toneHigh) < 1e-6);
  // 唱针落下：搓完之后一下低频的「咚」
  const thump = nodes.find(n => n.kind === "osc" && n.type === "sine");
  assert.ok(thump && Math.abs(thump.at - (0.005 + S.len + S.needle.at)) < 1e-9 && thump.frequency.events[0][1] === S.needle.freq, "唱针落下");
  // 配置表改了，声音跟着变：只搓两下
  const n0 = nodes.length;
  assert.equal(Sfx.scratch(), false, "同一刻再叫一次不叠");
  assert.equal(nodes.length, n0);
  S.strokes = 2;
  ac().currentTime = S.throttle + 1;
  assert.equal(Sfx.scratch(), true);
  assert.equal(nodes.slice(n0).filter(n => n.kind === "filter" && n.type === "bandpass").length, 2, "来回几下照配置");
  Sfx.setEnabled(false);
  ac().currentTime += S.throttle + 1;
  const n1 = nodes.length;
  assert.equal(Sfx.scratch(), false, "音效关着不响");
  assert.equal(nodes.length, n1, "一个声音节点都不建");
});

/* ---------- 播包时的音效（online-sfx.js） ---------- */
const OS = require("../online-sfx.js");
/** 给 Sfx 打桩：记下调了哪个接口；on = 音效开着没有 */
function stubSfx(on) {
  const S = { calls: [], on: on !== false };
  S.enabled = () => S.on;
  ["play", "ui", "stagger", "parry", "boom", "marker", "scratch"].forEach(k => { S[k] = (...a) => { S.calls.push([k].concat(a.map(x => (x && typeof x === "object" ? JSON.parse(JSON.stringify(x)) : x)))); return true; }; });
  return S;
}
function withSfx(on, fn) {
  const keep = Object.getOwnPropertyDescriptor(globalThis, "Sfx");
  const S = stubSfx(on);
  globalThis.Sfx = S;
  const done = () => { if (keep) Object.defineProperty(globalThis, "Sfx", keep); else delete globalThis.Sfx; };
  let out;
  try { out = fn(S); } catch (e) { done(); throw e; }
  if (out && typeof out.then === "function") return out.finally(done);
  done();
  return out;
}
const unit = (id, o) => Object.assign({ id, name: id, level: 2, zone: 1, isPlayer: false, layers: [{ type: "flesh", current: 30, max: 30 }] }, o || {});
/** 投影过的一包（online-view.js · projectPacket 的样子）：红玉打敌人一下打死它（火，主攻击），绯秋给自己治疗，柯尔特被打在坚毅生命上（投影不给数） */
function packetOf() {
  const before = { units: [unit("ruby", { isPlayer: true }), unit("hiaki", { isPlayer: true }), unit("kolt", { isPlayer: true, upOnShp: true }), unit("foe", { zone: 1 })] };
  const deadFoe = unit("foe", { dead: true, layers: [{ type: "flesh", current: 0, max: 30 }] });
  const after = { units: [unit("ruby", { isPlayer: true }), unit("hiaki", { isPlayer: true }), unit("kolt", { isPlayer: true, upOnShp: true }), deadFoe] };
  const tape = [
    { type: "pop", kind: "dmg", unitId: "foe", element: "fire", value: 12, main: true, snap: after.units },
    { type: "pop", kind: "heal", unitId: "hiaki", element: "physical", value: 5 },
    { type: "pop", kind: "dmg", unitId: "kolt", element: "acid" }
  ];
  return { before, packet: { type: "result", displayOnly: true, seq: 3, screen: "battle", state: after, tape, fx: { actor: "ruby", target: "foe", move: { kind: "slash", el: "fire", melee: true } } } };
}
const names = (calls) => calls.map(c => c[0] === "play" ? `play:${c[1]}${c[2] && c[2].big ? "!" : ""}` : c[0] === "ui" ? `ui:${c[1]}` : c[0]);

test("投影过的一下要响什么（和 game.js 播的一样）：打中按属性、治疗、状态字（护盾 / 减益 / 打不动不响）、高能自爆、伙伴登场；坚毅生命上不给数的那一下照样是普通的打中声", () => {
  const bigHit = (lv, v) => ({ big: v >= 20 });
  const o = { bigHit, level: () => 2 };
  assert.deepEqual(names(OS.popCalls({ type: "pop", kind: "dmg", unitId: "a", element: "ice", value: 8 }, o)), ["play:ice"]);
  assert.deepEqual(names(OS.popCalls({ type: "pop", kind: "dmg", unitId: "a", element: "ice", value: 25 }, o)), ["play:ice!"], "大伤害 = 重击");
  assert.deepEqual(names(OS.popCalls({ type: "pop", kind: "dmg", unitId: "a", element: "ice", value: 0 }, o)), [], "打出 0：和单机一样不响");
  // 打在坚毅生命上（投影不给数）：和打在看得见的血上的一般打中同一个声音，不另给一种、也不算重击
  const hidden = OS.popCalls({ type: "pop", kind: "dmg", unitId: "kolt", element: "ice" }, o);
  assert.deepEqual(hidden, OS.popCalls({ type: "pop", kind: "dmg", unitId: "a", element: "ice", value: 3 }, o), "坚毅生命上的那一下和普通的一下一模一样");
  assert.deepEqual(names(OS.popCalls({ type: "pop", kind: "dmg", unitId: "a", element: "nope" }, o)), ["play:physical"]);
  assert.deepEqual(names(OS.popCalls({ type: "pop", kind: "heal", unitId: "a", value: 4 }, o)), ["ui:heal"]);
  assert.deepEqual(names(OS.popCalls({ type: "pop", kind: "status", unitId: "a", text: "振奋" }, o)), ["ui:shield"]);
  assert.deepEqual(names(OS.popCalls({ type: "pop", kind: "status", unitId: "a", text: "灼烧" }, o)), ["ui:debuff"]);
  assert.deepEqual(names(OS.popCalls({ type: "pop", kind: "status", unitId: "a", text: "无效" }, o)), []);
  assert.deepEqual(names(OS.popCalls({ type: "pop", kind: "highboom", unitId: "a" }, o)), ["boom", "play:energy!"]);
  assert.deepEqual(names(OS.popCalls({ type: "pop", kind: "partner", unitId: "a" }, o)), ["parry"]);
  // 出手：开枪的招式响枪声（有专属演出的不算），近战打同一区的人响破风声
  assert.deepEqual(names(OS.strikeCalls({ fx: { actor: "a", target: "b", move: { kind: "shot" } } })), ["ui:gun"]);
  assert.deepEqual(names(OS.strikeCalls({ fx: { actor: "a", target: "b", script: "laser", move: { kind: "shot" } } })), []);
  assert.deepEqual(names(OS.strikeCalls({ fx: { actor: "a", target: "b", move: { kind: "slash", melee: true } }, state: { units: [unit("a"), unit("b")] } })), ["ui:swing"]);
  assert.deepEqual(names(OS.strikeCalls({ fx: { actor: "a", target: "b", move: { kind: "slash", melee: true } }, state: { units: [unit("a"), unit("b", { zone: 2 })] } })), []);
  // 前后两份画面比一比：失衡、击倒、濒死、护盾变多、换区（和 game.js · setView 一样）
  const prev = new Map([["a", unit("a")], ["b", unit("b")], ["c", unit("c")], ["d", unit("d", { layers: [{ type: "shield", current: 0 }] })], ["e", unit("e")]]);
  const next = new Map([["a", unit("a", { stunned: true })], ["b", unit("b", { dead: true })], ["c", unit("c", { dying: true })], ["d", unit("d", { layers: [{ type: "shield", current: 6 }] })], ["e", unit("e", { zone: 2 })]]);
  assert.deepEqual(OS.changes(prev, next).map(b => b.kind + ":" + b.id), ["stun:a", "kill:b", "down:c", "shield:d", "move:e"]);
  // 只认投影里有的字段：不读房主的 state、不碰坚毅生命
  const code = read("online-sfx.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /shp|坚毅|OnlineGame|GAME\./, "不读房主的 state、不碰坚毅生命");
});

/* ---------- online-ui.js 抠出来跑（和 tests/hd2d-online.test.js 一样的做法） ---------- */
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
/** 联机玩家的旧画面：playPacket 和音效那一段（turnCue / turnInfo / sfxFor）从源码里抠出来，其余给假的（没有单位卡、没有攻击演出） */
function oldView(opts) {
  opts = opts || {};
  const src = read("online-ui.js");
  const a = src.indexOf("    /* 联机玩家的音效（online-sfx.js，#304）"), b = src.indexOf("    function battleUi()");
  assert.ok(a > 0 && b > a, "online-ui.js 里音效那一段在 battleUi 前面");
  const V = { global: { OnlineSfx: OS }, ticks: [], doc: opts.doc || null,
    view: opts.view || { active: true, isHost: false, screen: "battle", roomCode: "ABCD", state: null, packet: null } };
  const make = new vm.Script(`(function (V) {
    const global = V.global, copy = (v) => JSON.parse(JSON.stringify(v)), document = V.doc || undefined;
    const api = { getView: () => ({ isHost: false }) };
    let view = V.view, displayState = null, animating = false, destroyed = false, battle = null, field3d = null;
    let currentMenu = null, request = null, selectedActor = "", actionGeneration = 0, playbackGeneration = 0, autoKey = "";
    let historyRows = [], historyHasMore = true, historyLoading = false, historyGeneration = 0, seenMessages = new Set(), messagesInitialized = false, toastTimer = 0, lobbySeen = null;
    const toast = { hidden: true };
    const stage = { querySelectorAll: () => [] };
    const hd2dSpec = { clock: () => 1 };
    const own = () => "p1", hs = () => (view.packet && view.packet.view) || {};
    const render = () => {}, paintStage = () => {}, skip3d = () => {}, play3d = async () => {};
    const strikeOnline = async () => null, onlineCtx = () => null, zoomOnline = () => false, zoomOutOnline = () => {};
    const setTimeout = (fn) => { V.ticks.forEach(f => f()); return V.later(fn); };
    const clearTimeout = () => {};
    ${src.slice(a, b)}
    ${fnSrc(src, "playPacket")}
    return { playPacket, turnCue, turnInfo, setBefore(s) { displayState = s; }, cut() { playbackGeneration++; } };
  })`, { filename: "online-ui.js（抠出来的联机玩家播包和音效）" });
  V.later = (fn) => setImmediate(fn);
  const ctx = vm.createContext({ console });
  const U = make.runInContext(ctx)(V);
  return Object.assign(U, { V, onTick: (f) => V.ticks.push(f) });
}

test("旧画面（online-ui.js · playPacket）：联机玩家播一个带打中、击倒、治疗的包，调到了对应的 Sfx 接口（打中 → Sfx.play、击倒 → ko、治疗 → heal）；被新的包顶掉（跳过）以后不再响；音效关着时什么都不调", async () => {
  const run = (on, cut) => withSfx(on, async (S) => {
    const H = oldView();
    const { before, packet } = packetOf();
    H.setBefore(before);
    if (cut) H.onTick(() => H.cut());           // 播到第一下之后就被新的包顶掉（重新同步 / 新的包来了）
    await H.playPacket(packet);
    return S.calls;
  });
  assert.deepEqual(names(await run(true)), ["play:fire", "ui:ko", "ui:heal", "play:acid"], "打中（火）→ 敌人倒下 → 治疗 → 坚毅生命上那一下照样是普通的打中声");
  assert.deepEqual(names(await run(true, true)), ["play:fire", "ui:ko"], "顶掉以后后面的都不响");
  assert.deepEqual(await run(false), [], "音效关着：一个 Sfx 接口都不调（enabled 以外）");
  // 源码：出手、格挡、每一下、演完都接上了
  const pp = fnSrc(read("online-ui.js"), "playPacket");
  assert.match(pp, /const snd = sfxFor\(packet, displayState, generation\);/);
  assert.match(pp, /if \(snd\) snd\.strike\(\);[^\n]*\n\s*try \{ fxFrom = await strikeOnline/);
  assert.match(pp, /AF\.clash\(b\);\s*if \(snd\) snd\.parry\(\);/);
  assert.match(pp, /paintStage\(\);\s*if \(snd\) snd\.pop\(event\);/);
  assert.match(pp, /if \(snd\) snd\.end\(\);/);
});

test("新画面（hd2d/hd2d-play.js）：出手、每一段打中、演完的那一刻叫 sound 钩子——同一个包调到同样的 Sfx 接口；跳过时不调；演出倍率 0 时不调；音效关着时什么都不调", async () => {
  const page = require("./hd2d-fake-page").load();
  assert.deepEqual(page.errors, []);
  const ctx = page.ctx;
  let hang = false;
  const rec = { windup: () => (hang ? new Promise(() => {}) : Promise.resolve()), travel: () => Promise.resolve(), after: () => Promise.resolve(),
    impact() {}, area() {}, ko() {}, clash() {}, skip() {}, setClock() {} };
  ctx.AttackFx = rec;
  ctx.HitFx = { burst() {}, clear() {} };
  const rect = { x: 300, y: 300, w: 120, h: 40, left: 240, top: 283, width: 120, height: 40, right: 360, bottom: 323, foot: 330 };
  const ad = { rectOf: () => rect, zoneRectOf: () => null, track: () => () => rect, remember() {} };
  const view = () => ({ width: 1100, height: 620, top: 40, bottom: 40 });
  const play = (on, clock, skip) => withSfx(on, async (S) => {
    ctx.HD2DPlay.setClock(() => clock);
    const { before, packet } = packetOf();
    const snd = OS.start(packet, { before });
    hang = !!skip;
    const p = ctx.HD2DPlay.play(packet, ad, { before, view, sound: (kind, i) => snd[kind](i) });
    if (skip) ctx.HD2DPlay.skip();
    await p;
    return S.calls;
  });
  assert.deepEqual(names(await play(true, 1)), ["ui:swing", "play:fire", "ui:heal", "play:acid", "ui:ko"], "出手破风 → 这一段打中（火、治疗、坚毅生命上的那一下）→ 演完：敌人倒下");
  assert.deepEqual(names(await play(true, 0.5)), ["ui:swing", "play:fire", "ui:heal", "play:acid", "ui:ko"], "两倍速：同样的声音（跟着画面的时间点）");
  assert.deepEqual(names(await play(true, 1, true)), ["ui:swing"], "跳过：卡在出手那一下就跳过，后面一下都不响");
  assert.deepEqual(await play(true, 0), [], "演出倍率 0（跳过演出）：不响");
  assert.deepEqual(await play(false, 1), [], "音效关着：什么都不调");
  ctx.HD2DPlay.setClock(() => 1);
  // 接线：online-ui.js 的新画面把钩子交给 hd2d-field.js，hd2d-field.js 原样交给 hd2d-play.js
  assert.match(fnSrc(read("online-ui.js"), "play3d"), /const snd = sfxFor\(packet, before, generation\);[\s\S]*sound: snd \? \(kind, i\) => \{ if \(typeof snd\[kind\] === "function"\) snd\[kind\]\(i\); \} : null/);
  assert.match(fnSrc(read("hd2d/hd2d-field.js"), "play"), /sound: o\.sound \|\| null/);
  assert.deepEqual(page.errors, []);
});

/* ---------- 轮到你：DJ 搓碟 ---------- */
/** 一个假的标签页：hidden、标题、visibilitychange */
function fakeDoc() {
  const d = { hidden: false, visibilityState: "visible", title: "角鳞 · Backfire", on: [] };
  d.addEventListener = (t, f) => { if (t === "visibilitychange") d.on.push(f); };
  d.removeEventListener = (t, f) => { d.on = d.on.filter(x => x !== f); };
  d.show = (vis) => { d.hidden = !vis; d.visibilityState = vis ? "visible" : "hidden"; d.on.slice().forEach(f => f()); };
  return d;
}
const turn = (o) => Object.assign({ active: true, isHost: false, screen: "battle", phase: "acting", current: "a", turnNo: 1, room: "ABCD", mine: ["a", "w"] }, o || {});
const scratches = (S) => S.calls.filter(c => c[0] === "scratch").length;

test("轮到你：轮到这名玩家操作自己的角色时搓碟只响一次；页面刚打开、重新同步、断线重连、重播旧包、别人的回合、敌人回合都不响；音效关着不响", () => withSfx(true, (S) => {
  const w = OS.turnWatch({ doc: fakeDoc() });
  assert.equal(w.see(turn()), false, "页面刚打开时已经轮到自己：只记下，不响");
  assert.equal(w.see(turn({ current: "b", mine: ["a"] })), false, "别人的回合");
  assert.equal(w.see(turn({ phase: "enemy", current: null })), false, "敌人回合");
  assert.equal(w.see(turn({ turnNo: 2 })), true, "下一回合轮到自己：响");
  assert.equal(scratches(S), 1);
  assert.equal(w.see(turn({ turnNo: 2 })), false, "同一次轮到：画面再更新（出了一招、结算完）不再响");
  assert.equal(w.see(turn({ turnNo: 2, current: "w" })), true, "接着轮到自己的另一名角色：这名角色的行动开始，再响一次");
  assert.equal(scratches(S), 2);
  // 重新同步 / 断线重连：下一次看到的只记下
  w.prime();
  assert.equal(w.see(turn({ turnNo: 3 })), false, "重新同步以后：只记下，不响");
  assert.equal(w.see(turn({ turnNo: 3 })), false);
  // 重播旧包：以前轮到过的那一次再出现，不再响
  assert.equal(w.see(turn({ turnNo: 2 })), false, "重播旧包");
  assert.equal(w.see(turn({ turnNo: 5, isHost: true })), false, "主持人那边不响（只给联机玩家）");
  assert.equal(scratches(S), 2);
  // 打完一场，下一场的回合数从头算：同一名角色第 1 回合照样响
  w.see(turn({ screen: "exploration", phase: "exploration", current: null }));
  assert.equal(w.see(turn({ turnNo: 1 })), true, "下一场战斗");
  // 音效关着：不调搓碟
  S.on = false;
  w.see(turn({ turnNo: 2, current: "b", mine: ["a"] }));
  assert.equal(w.see(turn({ turnNo: 4 })), true, "还是新的一次轮到（记下了）");
  assert.equal(scratches(S), 3, "音效关着：没有调 Sfx.scratch");
}));

test("轮到你：页面在后台（别的标签页）也照样响；标签页标题前加「▶ 轮到你」，回到页面时去掉（已经不是自己的回合也去掉）", () => withSfx(true, (S) => {
  const d = fakeDoc(), w = OS.turnWatch({ doc: d }), T = OS.CONFIG.turn;
  w.see(turn({ current: "b", mine: ["a"] }));
  d.show(false);
  assert.equal(w.see(turn()), true, "后台也响");
  assert.equal(scratches(S), 1);
  assert.equal(d.title, T.title + "角鳞 · Backfire", "标题前加标记");
  w.see(turn());
  assert.equal(d.title, T.title + "角鳞 · Backfire", "只加一次");
  d.show(true);
  assert.equal(d.title, "角鳞 · Backfire", "回到页面时去掉");
  d.show(false);
  w.see(turn({ turnNo: 2 }));
  assert.ok(d.title.startsWith(T.title));
  w.see(turn({ turnNo: 2, current: "b", mine: ["a"] }));
  assert.equal(d.title, "角鳞 · Backfire", "轮到别人了：标记去掉");
  // 页面在前台：不改标题
  d.show(true);
  w.see(turn({ turnNo: 3 }));
  assert.equal(d.title, "角鳞 · Backfire");
  assert.equal(scratches(S), 3);
}));

test("轮到你（online-ui.js 接线）：每次画面更新看一次（演出播完才算，行动开始那一刻）；收到重新同步的包只记下；页面在后台时收到包就看，不等演出", async () => {
  const d = fakeDoc(), keepDoc = Object.getOwnPropertyDescriptor(globalThis, "document");
  globalThis.document = d;   // 浏览器里 online-sfx.js 看的是页面的 document（标签页标题）
  await withSfx(true, async (S) => {
    const H = oldView({ doc: d });
    const view = H.V.view;
    const pkt = (o) => ({ type: "result", displayOnly: true, screen: "battle", seq: 1, state: { turnNo: o.turnNo || 1, units: [] }, tape: [], view: { phase: "acting", currentUnitId: o.current || "a", units: [{ id: "a", owner: "p1" }, { id: "b", owner: "p2" }] } });
    const show = (p) => { view.packet = p; view.state = p.state; H.turnCue.see(H.turnInfo(null, view.screen)); };   // render() 里的那一下
    show(pkt({ current: "a" }));
    assert.equal(scratches(S), 0, "刚连进来就轮到自己：不响");
    show(pkt({ current: "b" }));
    show(pkt({ current: "a", turnNo: 2 }));
    assert.equal(scratches(S), 1, "轮到自己：响");
    // 重新同步：只记下
    await H.playPacket(Object.assign(pkt({ current: "a", turnNo: 3 }), { type: "resync" }));
    show(pkt({ current: "a", turnNo: 3 }));
    assert.equal(scratches(S), 1, "重新同步以后不响");
    // 后台：收到包时就看（不等演出播完），之后画面更新时不再重复
    d.show(false);
    show(pkt({ current: "b", turnNo: 3 }));
    await H.playPacket(pkt({ current: "a", turnNo: 4 }));
    assert.equal(scratches(S), 2, "后台：收到包就响");
    assert.ok(d.title.startsWith(OS.CONFIG.turn.title));
    show(pkt({ current: "a", turnNo: 4 }));
    assert.equal(scratches(S), 2, "同一次不再响");
  }).finally(() => { if (keepDoc) Object.defineProperty(globalThis, "document", keepDoc); else delete globalThis.document; });
  const src = read("online-ui.js");
  assert.match(src, /if \(turnCue && !animating\) turnCue\.see\(turnInfo\(null, view\.screen\)\);/, "render 里：演出播完才看");
  assert.match(fnSrc(src, "playPacket"), /if \(turnCue\) turnCue\.prime\(\);/, "重新同步只记下");
  assert.match(read("game.html"), /<script src="online-sfx\.js"><\/script>\s*<script src="online-ui\.js"><\/script>/, "game.html 在 online-ui.js 前面加载 online-sfx.js");
});

/* ---------- 暂停页面里的音效开关 ---------- */
test("暂停页面：联机玩家的菜单里有「音效 开 / 关」，点了菜单不收起；和单机顶栏的「音效」按钮同一个本机开关（sfx.js 的 localStorage 键）", () => {
  const store = new Map();
  const { Sfx } = loadSfx(store);
  const ctx = vm.createContext({ console });
  ctx.window = ctx;
  vm.runInContext(read("pause-menu.js"), ctx, { filename: "pause-menu.js" });
  const M = ctx.PauseMenu;
  // online-ui.js 登记的那一项，原样抠出来
  const src = read("online-ui.js"), at = src.indexOf('global.PauseMenu.register({ id: "sfx"');
  assert.ok(at > 0, "online-ui.js 登记了音效开关");
  const end = src.indexOf("} }),", at) + 4;
  const view = { active: true, isHost: false, screen: "battle" };
  vm.runInContext(`(function (global, view) { return ${src.slice(at, end)}; })`, ctx)({ PauseMenu: M, Sfx }, view);
  const row = () => M.list().find(r => r.id === "sfx");
  assert.ok(row(), "联机玩家看得到");
  assert.equal(row().label, "音效 开");
  assert.equal(row().pressed, true);
  assert.match(M.html(M.list(), true), /data-pause-item="sfx" aria-pressed="true"><b>音效 开<\/b>/);
  assert.equal(M.choose("sfx"), true);
  assert.equal(Sfx.enabled(), false, "关掉了");
  assert.equal(store.get("anterscale-sfx"), "off", "记在单机同一个本机键上");
  assert.equal(row().label, "音效 关");
  assert.equal(row().pressed, false);
  M.choose("sfx");
  assert.equal(store.get("anterscale-sfx"), "on");
  // 单机顶栏的按钮切的是同一个开关
  assert.match(read("game.js"), /Sfx\.setEnabled\(!Sfx\.enabled\(\)\)/);
  // 主持人那边不在菜单里（顶栏有自己的按钮）；离开房间也没有
  view.isHost = true;
  assert.equal(row(), undefined, "主持人：不在菜单里");
  view.isHost = false; view.active = false;
  assert.equal(row(), undefined);
  // 文字放在配置表里；开关这一类点了菜单不收起
  const C = M.CONFIG.items.sfx;
  assert.deepEqual([C.on, C.off], ["音效 开", "音效 关"]);
  assert.match(fnSrc(read("pause-menu.js"), "choose"), /if \(it\.stay\) \{ it\.run\(\); refresh\(\); return true; \}/);
});
