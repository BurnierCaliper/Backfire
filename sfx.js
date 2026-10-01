/* 角鳞 · 攻击音效（WebAudio 现场合成，不用音频文件）
 *
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
    const v = opt.big ? 1.25 : 1;
    try {
      VOICES[el](now + 0.005, v);
      if (opt.big) osc("sine", now + 0.005, 0.3, 75, 38, gainEnv(now + 0.005, 0.005, 0.5, 0.3));
    } catch (e) { return false; }
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

  window.Sfx = { render, parry, stagger, boom, play, enabled, setEnabled, ELEMENTS, NAMES: { physical: "物理", fire: "火", ice: "冰", electric: "电", acid: "酸", energy: "能量", harmonic: "谐波" } };
})();
