// 联机玩家的音效（#304）：
//   · 轮到自己时的提示音：DJ 搓碟（sfx.js · Sfx.scratch，数值在 SCRATCH，sfx-tuner.html 能试听、调参数）
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
