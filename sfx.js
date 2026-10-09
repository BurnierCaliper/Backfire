/* 角鳞 · 音效：录音音效（sfx-samples.js，CC0）+ WebAudio 现场合成
 *
 * 录音音效：有录音的类别放录音（SFX_SAMPLES），没有的照旧用下面的合成音效。
 *   电属性、格挡、失衡、爆炸按作者的选择保留合成音效。
 *   Sfx.ui(key)：界面 / 演出音效（click hover back error open toggle dice coin turn heal shield debuff
 *   swing draw mech gun move ko levelup）。按钮点击、悬停、返回、切换由这里统一挂在页面上，不用每个按钮自己写。
 *   每个录音的音量、音高、截取起止、淡出、随机音高都在 SFX_TUNE 里调（sfx-tuner.html 可以拖滑块试听再复制参数）。
 *
 * 合成音效：
 * 每种属性一个音效，按属性给人的印象来做：
 *   physical 物理  沉闷的重击：低频下坠的「咚」+ 一点撞击噪声
 *   fire     火    呼的一下燃起：扫频的风声 + 噼啪的火星
 *   ice      冰    清脆的冰晶：高频的玻璃般泛音 + 一声脆裂
 *   electric 电    电弧滋啦：抖动的锯齿波 + 快速下扫的电火花
 *   acid     酸    腐蚀的嘶嘶声 + 冒泡
 *   energy   能量  光束：快速下扫的激光音
 *   harmonic 谐波  共振：拍频的嗡鸣 + 共鸣的环响
 *
 * 用法：Sfx.play("fire", { big: true })。重击（big）更响、多一层低频。
 * 同一属性 60 ms 内只响一次，范围攻击同时打中好几个人不会叠成噪音。
 * 浏览器要求先有一次点击 / 按键才能出声，这里在第一次点击或按键时启动。
 * 开关记在本机（localStorage「anterscale-sfx」），战斗顶栏「音效」按钮切换。 */
(function () {
  "use strict";
  const KEY = "anterscale-sfx";
  const ELEMENTS = ["physical", "fire", "ice", "electric", "acid", "energy", "harmonic"];
  let ctx = null, master = null, noiseBuf = null;
  const last = {};

  function enabled() {
    try { return localStorage.getItem(KEY) !== "off"; } catch (e) { return true; }
  }
  function setEnabled(on) {
    try { localStorage.setItem(KEY, on ? "on" : "off"); } catch (e) {}
  }

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 6;
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(comp); comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; }
    return ctx;
  }
  /* ---------- 录音音效 ---------- */
  /** 每个录音的微调：gain 音量倍数、rate 播放速度（同时改音高，1 = 原样）、start / end 截取起止秒（end 0 = 到结尾）、
   *  fade 结尾淡出秒数、delay 延迟秒数、vary 每次随机音高幅度（0.04 = ±4%，连续命中不那么单调）、on 是否启用 */
  const SFX_TUNE = {
    physical: { gain: 1, rate: 0.75, start: 0, end: 0, fade: 0, delay: 0, vary: 0.05, on: true },
    fire:     { gain: 1, rate: 0.8, start: 0.61, end: 0, fade: 0, delay: 0, vary: 0.04, on: true },
    ice:      { gain: 2.1, rate: 0.65, start: 0, end: 0, fade: 1.21, delay: 0, vary: 0.04, on: true },
    acid:     { gain: 1, rate: 1.4, start: 0, end: 0, fade: 0, delay: 0, vary: 0.19, on: true },
    energy:   { gain: 0.9, rate: 0.85, start: 0, end: 0, fade: 0.1, delay: 0, vary: 0.18, on: true },
    harmonic: { gain: 1, rate: 1.29, start: 0, end: 0, fade: 0.1, delay: 0, vary: 0.03, on: true },
    click:    { gain: 1.3, rate: 1, start: 0, end: 0, fade: 0, delay: 0, vary: 0, on: true },
    hover:    { gain: 0.3, rate: 1, start: 0.03, end: 0, fade: 0, delay: 0, vary: 0, on: true },
    back:     { gain: 1.2, rate: 1, start: 0.03, end: 0, fade: 0, delay: 0, vary: 0, on: true },
    error:    { gain: 1, rate: 1.01, start: 0, end: 0, fade: 0, delay: 0, vary: 0, on: true },
    open:     { gain: 0.7, rate: 1, start: 0.27, end: 0, fade: 0, delay: 0, vary: 0, on: true },
    toggle:   { gain: 0.6, rate: 1, start: 0, end: 0, fade: 0, delay: 0, vary: 0, on: true },
    dice:     { gain: 1, rate: 1, start: 0, end: 0, fade: 0.15, delay: 0, vary: 0, on: true },
    coin:     { gain: 1, rate: 1.19, start: 0, end: 0, fade: 0, delay: 0, vary: 0.03, on: true },
    turn:     { gain: 1, rate: 0.92, start: 0, end: 0, fade: 0, delay: 0, vary: 0, on: true },
    heal:     { gain: 0.8, rate: 1.34, start: 0, end: 0, fade: 0, delay: 0, vary: 0.04, on: true },
    shield:   { gain: 0.7, rate: 1.32, start: 0, end: 0, fade: 0.15, delay: 0, vary: 0, on: true },
    debuff:   { gain: 1.9, rate: 0.72, start: 0, end: 0, fade: 0, delay: 0, vary: 0, on: true },
    swing:    { gain: 0.7, rate: 0.94, start: 0, end: 0, fade: 0, delay: 0, vary: 0.12, on: true },
    draw:     { gain: 0.8, rate: 1, start: 0, end: 0, fade: 0, delay: 0, vary: 0, on: true },
    mech:     { gain: 0.8, rate: 0.8, start: 0, end: 0, fade: 0, delay: 0, vary: 0, on: true },
    gun:      { gain: 1, rate: 1.26, start: 0, end: 0, fade: 0, delay: 0, vary: 0.04, on: true },
    move:     { gain: 1, rate: 1.07, start: 0, end: 0, fade: 0, delay: 0, vary: 0.06, on: true },
    ko:       { gain: 1, rate: 0.69, start: 0, end: 0, fade: 0.07, delay: 0, vary: 0, on: true },
    levelup:  { gain: 1, rate: 1.25, start: 0, end: 1.8, fade: 0, delay: 0, vary: 0, on: true }
  };
  const UI_LABEL = { physical: "物理命中", fire: "火属性", ice: "冰属性", acid: "酸属性", energy: "能量属性", harmonic: "谐波属性",
    click: "按钮点击", hover: "鼠标悬停", back: "返回 / 取消", error: "不能这样做", open: "打开面板", toggle: "切换开关", dice: "掷骰",
    coin: "钱币 / 购买", turn: "回合开始", heal: "治疗", shield: "护盾 / 增益", debuff: "减益 / 状态", swing: "挥砍 / 出手",
    draw: "拔刀 / 收刀", mech: "机械 / 上膛", gun: "枪声", move: "移动", ko: "倒地 / 击倒", levelup: "升级" };
  const buffers = {}, decoding = {};
  function samples() { return (typeof window !== "undefined" && window.SFX_SAMPLES) || {}; }
  function hasSample(key) {
    const t = SFX_TUNE[key];
    return !!(samples()[key] && (!t || t.on !== false));
  }
  function b64ToBuf(uri) {
    const b64 = String(uri).slice(String(uri).indexOf(",") + 1);
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  /** 第一次用到时才解码（每个录音只解一次） */
  function bufferOf(key) {
    if (buffers[key]) return Promise.resolve(buffers[key]);
    if (decoding[key]) return decoding[key];
    const c = ensure();
    if (!c || !samples()[key]) return Promise.resolve(null);
    decoding[key] = new Promise(res => {
      try { c.decodeAudioData(b64ToBuf(samples()[key]), b => { buffers[key] = b; res(b); }, () => res(null)); } catch (e) { res(null); }
    });
    return decoding[key];
  }
  /** 播一个录音。tune 可以临时覆盖 SFX_TUNE（调音页用），vol 是额外的音量倍数（重击更响） */
  function playSample(key, opt) {
    opt = opt || {};
    const c = ensure();
    if (!c || !samples()[key]) return false;
    if (c.state === "suspended") c.resume().catch(() => {});
    const t = Object.assign({ gain: 1, rate: 1, start: 0, end: 0, fade: 0, delay: 0, vary: 0 }, SFX_TUNE[key] || {}, opt.tune || {});
    bufferOf(key).then(buf => {
      if (!buf) return;
      const s = c.createBufferSource();
      s.buffer = buf;
      const jitter = t.vary ? 1 + (Math.random() * 2 - 1) * t.vary : 1;
      s.playbackRate.value = Math.max(0.25, Math.min(4, (Number(t.rate) || 1) * jitter * (opt.rateMul || 1)));
      const g = c.createGain();
      const vol = Math.max(0, Number(t.gain) || 0) * (opt.vol || 1);
      const start = Math.max(0, Math.min(buf.duration - 0.01, Number(t.start) || 0));
      const end = Number(t.end) > start ? Math.min(buf.duration, Number(t.end)) : buf.duration;
      const len = Math.max(0.01, end - start);
      const real = len / s.playbackRate.value;            // 实际播放时长（变速后）
      const at = c.currentTime + Math.max(0, Number(t.delay) || 0) + 0.005;
      g.gain.setValueAtTime(vol, at);
      const fade = Math.min(real, Math.max(0, Number(t.fade) || 0));
      if (fade > 0) { g.gain.setValueAtTime(vol, at + real - fade); g.gain.linearRampToValueAtTime(0.0001, at + real); }
      s.connect(g); g.connect(opt.dest || master);
      s.start(at, start, len);
      if (opt.onEnd) s.onended = opt.onEnd;
    });
    return true;
  }
  /* ---------- 克制 / 劣势 ---------- */
  /** 克制：音量、音高提高一点，再加一层混响；劣势反过来：音量、音高降低，声音发闷（低通，没有混响） */
  const TONE = {
    adv: { vol: 1.3, rate: 1.12, wet: 0.5 },
    dis: { vol: 0.7, rate: 0.88, lowpass: 1100 }
  };
  let reverbIr = null;
  /** 程序生成的房间混响脉冲：1.8 秒衰减的立体声噪声 */
  function reverbBuffer(c) {
    if (reverbIr && reverbIr.sampleRate === c.sampleRate) return reverbIr;
    const len = Math.round(c.sampleRate * 1.8);
    const ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    reverbIr = ir;
    return ir;
  }
  /** 给一次命中搭一条临时的效果链，返回声音该接进去的节点（null = 直接进 master） */
  function toneBus(tone) {
    const cfg = TONE[tone];
    if (!cfg || !ctx) return null;
    const input = ctx.createGain();
    if (cfg.wet) {
      input.connect(master);
      const conv = ctx.createConvolver();
      conv.buffer = reverbBuffer(ctx);
      const wet = ctx.createGain();
      wet.gain.value = cfg.wet;
      input.connect(conv); conv.connect(wet); wet.connect(master);
    } else if (cfg.lowpass) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = cfg.lowpass; lp.Q.value = 0.7;
      input.connect(lp); lp.connect(master);
    } else input.connect(master);
    return input;
  }

  const uiLast = {};
  let explicitAt = 0;
  /** 界面 / 演出音效：没有录音的类别不出声 */
  function ui(key, opt) {
    opt = opt || {};
    if (!enabled() || !hasSample(key)) return false;
    const c = ensure();
    if (!c) return false;
    const now = c.currentTime;
    const gap = opt.throttle != null ? opt.throttle : key === "hover" ? 0.04 : key === "move" ? 0.12 : 0.05;
    if (uiLast[key] != null && now - uiLast[key] < gap) return false;
    uiLast[key] = now;
    if (!opt.auto) explicitAt = performance.now();
    return playSample(key, opt);
  }

  /* ---------- 页面上统一挂按钮音效 ---------- */
  const CLICKABLE = "button, [role=button], [role=tab], a.t-btn, .g-btn, .t-btn, summary, select, input[type=checkbox], input[type=radio]";
  const BACK_WORDS = /^(关闭|取消|返回|算了|放弃|不用了|×|✕)/;
  function clickKind(el) {
    if (el.closest("[data-sfx-none]") || el.matches("[disabled], [aria-disabled=true]")) return null;
    if (el.dataset && el.dataset.sfxUi) return el.dataset.sfxUi;
    const id = (el.id || "") + " " + (el.className && el.className.baseVal == null ? el.className : "");
    const text = (el.textContent || "").trim();
    if (/close|cancel|(^|[-_ ])back([-_ ]|$)/i.test(id) || BACK_WORDS.test(text) || el.matches('[data-bx="close"]')) return "back";
    if (el.matches("[aria-pressed], [role=tab], [role=switch], input[type=checkbox], input[type=radio], select, [data-mode], [data-filter], [data-party]")) return "toggle";
    return "click";
  }
  function onUiClick(e) {
    const el = e.target && e.target.closest ? e.target.closest(CLICKABLE) : null;
    if (!el) return;
    const kind = clickKind(el);
    if (!kind) return;
    const at = performance.now();
    // 点下去之后才知道这次点击有没有自己的音效（买东西是钱币声、不能这样做是错误声……），有的话就不再响点击声
    setTimeout(() => { if (explicitAt < at) ui(kind, { auto: true }); }, 0);
  }
  let hoverEl = null;
  function onUiHover(e) {
    if (e.pointerType && e.pointerType !== "mouse") return;
    const el = e.target && e.target.closest ? e.target.closest(CLICKABLE) : null;
    if (el === hoverEl) return;
    hoverEl = el;
    if (el && !el.matches("[disabled]") && !el.closest("[data-sfx-none]")) ui("hover", { auto: true });
  }
  if (typeof document !== "undefined") {
    document.addEventListener("click", onUiClick, true);
    document.addEventListener("pointerover", onUiHover, true);
  }

  function unlock() {
    const c = ensure();
    if (c && c.state === "suspended") c.resume().catch(() => {});
  }
  ["pointerdown", "keydown"].forEach(ev => window.addEventListener(ev, unlock, { capture: true, passive: true }));

  /* ---------- 小零件 ---------- */
  function gainEnv(t, attack, peak, decay, dest) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest || master);
    return g;
  }
  function osc(type, t, dur, f0, f1, out) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    o.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  function noise(t, dur, out) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    s.connect(out);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
    return s;
  }
  function filter(type, freq, q, dest) {
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    if (q != null) f.Q.value = q;
    f.connect(dest);
    return f;
  }

  /* ---------- 七种属性 ---------- */
  const VOICES = {
    physical(t, v) {
      osc("sine", t, 0.16, 170, 42, gainEnv(t, 0.004, 0.95 * v, 0.2));
      noise(t, 0.06, filter("lowpass", 1400, 0.7, gainEnv(t, 0.002, 0.55 * v, 0.06)));
      osc("triangle", t, 0.05, 420, 120, gainEnv(t, 0.002, 0.25 * v, 0.05));
    },
    fire(t, v) {
      const bp = filter("bandpass", 500, 1.2, gainEnv(t, 0.05, 1.3 * v, 0.34));
      bp.frequency.setValueAtTime(420, t);
      bp.frequency.exponentialRampToValueAtTime(2000, t + 0.28);
      noise(t, 0.42, bp);
      osc("sine", t, 0.25, 110, 60, gainEnv(t, 0.02, 0.4 * v, 0.24));
      for (let i = 0; i < 7; i++) {
        const tt = t + 0.03 + Math.random() * 0.34;
        noise(tt, 0.012, filter("highpass", 2500, 0.8, gainEnv(tt, 0.001, (0.3 + Math.random() * 0.3) * v, 0.012)));
      }
    },
    ice(t, v) {
      [[1760, 0.45, 0.42], [2793, 0.3, 0.3], [3951, 0.2, 0.2], [2217, 0.16, 0.5]].forEach(([f, a, d], i) => {
        osc("sine", t + i * 0.012, d, f, f * 0.985, gainEnv(t + i * 0.012, 0.002, a * v, d));
      });
      noise(t, 0.035, filter("highpass", 5000, 0.7, gainEnv(t, 0.001, 0.45 * v, 0.035)));
      osc("triangle", t, 0.05, 1320, 900, gainEnv(t, 0.001, 0.18 * v, 0.05));
    },
    electric(t, v) {
      const out = gainEnv(t, 0.003, 0.42 * v, 0.24);
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 5); }
      shaper.curve = curve;
      shaper.connect(out);
      const buzz = osc("sawtooth", t, 0.24, 120, 90, shaper);
      const lfo = ctx.createOscillator(); lfo.type = "square"; lfo.frequency.value = 38;
      const depth = ctx.createGain(); depth.gain.value = 70;
      lfo.connect(depth); depth.connect(buzz.frequency);
      lfo.start(t); lfo.stop(t + 0.3);
      osc("square", t, 0.12, 2600, 260, gainEnv(t, 0.002, 0.16 * v, 0.12));
      const gate = gainEnv(t, 0.002, 0.3 * v, 0.2);
      const glfo = ctx.createOscillator(); glfo.type = "square"; glfo.frequency.value = 57;
      const gd = ctx.createGain(); gd.gain.value = 0.25 * v;
      glfo.connect(gd); gd.connect(gate.gain);
      glfo.start(t); glfo.stop(t + 0.25);
      noise(t, 0.22, filter("highpass", 3200, 0.8, gate));
    },
    acid(t, v) {
      noise(t, 0.4, filter("highpass", 3800, 0.6, gainEnv(t, 0.03, 0.4 * v, 0.38)));
      for (let i = 0; i < 6; i++) {
        const tt = t + 0.02 + i * 0.055 + Math.random() * 0.03;
        const f = 260 + Math.random() * 220;
        osc("sine", tt, 0.05, f, f * 2.4, gainEnv(tt, 0.004, (0.25 + Math.random() * 0.15) * v, 0.05));
      }
      osc("sine", t, 0.18, 90, 70, gainEnv(t, 0.01, 0.2 * v, 0.18));
    },
    energy(t, v) {
      const main = osc("sine", t, 0.26, 1500, 170, gainEnv(t, 0.004, 0.5 * v, 0.28));
      const vib = ctx.createOscillator(); vib.frequency.value = 22;
      const vd = ctx.createGain(); vd.gain.value = 40;
      vib.connect(vd); vd.connect(main.frequency);
      vib.start(t); vib.stop(t + 0.3);
      osc("sawtooth", t, 0.22, 1510, 175, filter("lowpass", 2200, 0.8, gainEnv(t, 0.004, 0.12 * v, 0.22)));
      osc("sine", t + 0.02, 0.2, 3000, 600, gainEnv(t + 0.02, 0.003, 0.1 * v, 0.18));
    },
    harmonic(t, v) {
      const trem = gainEnv(t, 0.02, 0.5 * v, 0.55);
      const tr = ctx.createOscillator(); tr.frequency.value = 13;
      const td = ctx.createGain(); td.gain.value = 0.18 * v;
      tr.connect(td); td.connect(trem.gain);
      tr.start(t); tr.stop(t + 0.6);
      [[330, 1], [337, 1], [660, 0.5], [669, 0.5]].forEach(([f, a]) => {
        const g = ctx.createGain(); g.gain.value = 0.35 * a; g.connect(trem);
        osc("sine", t, 0.58, f, f, g);
      });
      const ring = filter("bandpass", 800, 28, gainEnv(t, 0.01, 0.7 * v, 0.45));
      ring.frequency.setValueAtTime(700, t);
      ring.frequency.exponentialRampToValueAtTime(1500, t + 0.4);
      noise(t, 0.45, ring);
    }
  };

  /* ---------- 格挡成功：钢铁相撞（只狼拼刀 / 法环弹反那种「铛——」） ----------
   * 一下极短的宽频撞击 + 钢条的非谐和泛音长鸣（高的先消失）+ 高频「锵」的金属擦响
   * + FM 合成的金属尖响 + 一点低频分量让它有重量。 */
  function parryVoice(t, v) {
    v *= 0.82;   // 音高带一点随机，部分组合叠得比较响：留出余量，不削顶
    // 撞击瞬间
    noise(t, 0.03, filter("highpass", 1800, 0.7, gainEnv(t, 0.001, 0.55 * v, 0.028)));
    osc("sine", t, 0.05, 220, 90, gainEnv(t, 0.002, 0.35 * v, 0.06));
    // 钢条的振动模式：1 : 2.76 : 5.40 : 8.93，再各加一条略微失谐的，互相拍出「嗡嗡」的金属光泽
    const f0 = 1180 + Math.random() * 60;
    [[1, 0.42, 1.7], [2.76, 0.3, 1.1], [5.40, 0.2, 0.6], [8.93, 0.12, 0.32]].forEach(([r, a, d]) => {
      osc("sine", t, d, f0 * r, f0 * r, gainEnv(t, 0.001, a * 0.62 * v, d));
      osc("sine", t, d * 0.9, f0 * r * 1.006, f0 * r * 1.006, gainEnv(t, 0.001, a * 0.34 * v, d * 0.9));
    });
    // FM 金属尖响（「锵」）
    const car = ctx.createOscillator(); car.frequency.value = 2350;
    const mod = ctx.createOscillator(); mod.frequency.value = 3290;
    const idx = ctx.createGain();
    idx.gain.setValueAtTime(2600, t); idx.gain.exponentialRampToValueAtTime(40, t + 0.25);
    mod.connect(idx); idx.connect(car.frequency);
    car.connect(gainEnv(t, 0.001, 0.22 * v, 0.3));
    car.start(t); mod.start(t); car.stop(t + 0.35); mod.stop(t + 0.35);
    // 刀刃擦过的高频「嘶——」
    const shing = filter("bandpass", 7000, 3, gainEnv(t + 0.005, 0.004, 0.3 * v, 0.28));
    shing.frequency.setValueAtTime(8200, t); shing.frequency.exponentialRampToValueAtTime(5200, t + 0.28);
    noise(t, 0.3, shing);
  }
  VOICES.parry = parryVoice;

  /* ---------- 打出失衡：比格挡更沉、更悠长（法环削韧破防 / 只狼架势崩溃那种「咚——嗡——」） ----------
   * 一记很低很重的冲击 + 一口低沉的钟（泛音按钟的比例：hum 0.5 / 1 / 1.19 / 1.5 / 2 / 2.66 / 3），
   * 各泛音在几秒里缓缓下滑一点（像时间被拖慢），再送进一段长混响，尾音悠扬。 */
  let irCache = null;
  function reverb(seconds) {
    if (!irCache || irCache.ctx !== ctx) {
      const len = Math.round(ctx.sampleRate * seconds);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      // 固定种子的噪声：混响尾巴每次都一样，不会偶尔起伏得像「嗡嗡」
      let seed = 0x1a2b3c4;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      irCache = { ctx, ir };
    }
    const conv = ctx.createConvolver();
    conv.buffer = irCache.ir;
    const wet = ctx.createGain(); wet.gain.value = 0.55;
    conv.connect(wet); wet.connect(master);
    return conv;
  }
  function staggerVoice(t, v) {
    const verb = reverb(3.2);
    const both = (g) => { g.connect(verb); return g; };   // 干声进总线，同时送一份进混响
    // 撞木敲上去的一下：硬的撞击声 + 一点短促的低频分量（只给重量，不拖长，免得变成嗡嗡声）
    noise(t, 0.035, filter("bandpass", 1800, 1.1, both(gainEnv(t, 0.001, 0.55 * v, 0.035))));
    osc("sine", t, 0.18, 110, 55, gainEnv(t, 0.003, 0.45 * v, 0.18));
    // 钟：以 392 Hz（G4）为「击音」，泛音照真钟的比例。
    // 一开头高泛音最亮（「当」），然后高的先消失，只剩低的慢慢收尾（「——」）。
    // 不加失谐、不滑音、低频 hum 放轻，就不会嗡嗡地晃。
    const nominal = 392;
    [
      [0.25, 0.08, 3.8],   // hum（很轻）
      [0.5,  0.2,  3.2],   // prime
      [0.6,  0.2,  2.5],   // tierce（小三度，钟声的「苦味」）
      [0.75, 0.1,  1.9],   // quint
      [1,    0.34, 2.8],   // nominal：听到的音高
      [1.5,  0.14, 1.4],   // superquint
      [2,    0.12, 1.0],   // octave nominal
      [2.66, 0.08, 0.6],
      [3.33, 0.06, 0.42]
    ].forEach(([r, a, d]) => {
      const f = nominal * r;
      osc("sine", t, d, f, f, both(gainEnv(t, 0.002, a * 1.25 * v, d)));
    });
  }
  VOICES.stagger = staggerVoice;

  /* ---------- 高能自爆：能量的爆炸（低频轰鸣 + 扫下来的爆裂噪声 + 能量尖啸） ---------- */
  function boomVoice(t, v) {
    const verb = reverb(3.2);
    const both = (g) => { g.connect(verb); return g; };
    const lp = filter("lowpass", 3000, 0.8, both(gainEnv(t, 0.003, 0.85 * v, 0.9)));
    lp.frequency.setValueAtTime(4200, t); lp.frequency.exponentialRampToValueAtTime(160, t + 0.8);
    noise(t, 0.95, lp);
    osc("sine", t, 0.7, 95, 28, both(gainEnv(t, 0.004, 0.8 * v, 0.75)));
    osc("sawtooth", t, 0.35, 1900, 140, filter("lowpass", 2600, 0.7, gainEnv(t, 0.002, 0.2 * v, 0.35)));
    osc("sine", t + 0.02, 0.4, 2600, 400, both(gainEnv(t + 0.02, 0.003, 0.12 * v, 0.38)));
  }
  VOICES.boom = boomVoice;
  const RENDER_SECONDS = { parry: 1.4, stagger: 4.2, boom: 4.2 };

  function play(element, opt) {
    opt = opt || {};
    if (!enabled()) return false;
    const c = ensure();
    if (!c) return false;
    if (c.state === "suspended") c.resume().catch(() => {});
    const el = VOICES[element] ? element : "physical";
    const now = c.currentTime;
    if (last[el] != null && now - last[el] < (opt.throttle || 0.06)) return false;
    last[el] = now;
    const tone = opt.adv ? "adv" : opt.dis ? "dis" : "";
    const cfg = TONE[tone] || { vol: 1, rate: 1 };
    const v = (opt.big ? 1.25 : 1) * cfg.vol;
    const bus = toneBus(tone);
    // 有录音的属性放录音；重击照旧叠一层低频
    if (hasSample(el)) {
      playSample(el, { vol: v, rateMul: cfg.rate, dest: bus || undefined });
      if (opt.big) { try { osc("sine", now + 0.005, 0.3, 75, 38, gainEnv(now + 0.005, 0.005, 0.5, 0.3, bus || master)); } catch (e) {} }
      return true;
    }
    // 合成音效：所有声部默认接 master，临时把 master 换成效果链（音高不变，音量和混响 / 发闷照样起作用）
    const realMaster = master;
    try {
      if (bus) master = bus;
      VOICES[el](now + 0.005, v);
      if (opt.big) osc("sine", now + 0.005, 0.3, 75, 38, gainEnv(now + 0.005, 0.005, 0.5, 0.3));
    } catch (e) { return false; } finally { master = realMaster; }
    return true;
  }

  /** 离线渲染一个音效，返回采样（测试用：检查有声、不削顶、音色区分） */
  function render(element, opt) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return Promise.resolve(null);
    const saved = [ctx, master, noiseBuf];
    const off = new OAC(1, Math.round(44100 * (RENDER_SECONDS[element] || 1.4)), 44100);
    try {
      ctx = off;
      master = off.createGain(); master.gain.value = 0.55; master.connect(off.destination);
      noiseBuf = off.createBuffer(1, off.sampleRate, off.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const v = opt && opt.big ? 1.25 : 1;
      VOICES[VOICES[element] ? element : "physical"](0.005, v);
      if (opt && opt.big) osc("sine", 0.005, 0.3, 75, 38, gainEnv(0.005, 0.005, 0.5, 0.3));
    } finally { [ctx, master, noiseBuf] = saved; }
    return off.startRendering().then(buf => buf.getChannelData(0));
  }

  /** 格挡成功的钢铁碰撞声 */
  function parry() { return play("parry", { throttle: 0.15 }); }
  /** 打出失衡：范围攻击同时打崩好几个人也只响一次 */
  function stagger() { return play("stagger", { throttle: 0.4 }); }
  /** 高能自爆的爆炸声（连锁自爆时间隔 0.25 秒以上才再响） */
  function boom() { return play("boom", { throttle: 0.25 }); }

  window.Sfx = { render, parry, stagger, boom, play, ui, playSample, hasSample, TUNE: SFX_TUNE, TONE, UI_LABEL, enabled, setEnabled, ELEMENTS, NAMES: { physical: "物理", fire: "火", ice: "冰", electric: "电", acid: "酸", energy: "能量", harmonic: "谐波" } };
})();
