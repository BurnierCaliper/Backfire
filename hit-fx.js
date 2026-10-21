/* 受击特效：按伤害属性在被打的单位卡上放一段粒子动画（全部用代码画，不依赖素材文件）。
 *
 *   HitFx.burst(element, rect, { big })   rect = 单位卡的 getBoundingClientRect()
 *
 *   fire      火焰往上窜、火星飞散
 *   electric  几道折线电弧在卡片上跳、蓝白电火花
 *   ice       冰晶碎片向外炸开、一圈霜环
 *   acid      绿色酸液四溅往下落、冒泡
 *   energy    青色冲击环 + 光球向外射
 *   physical  冲击放射线 + 碎屑
 *   harmonic  紫色正弦波纹一圈圈扩散
 *
 * 一块全屏 canvas 盖在画面上（不挡点击）；没有粒子时停掉动画循环。
 * 系统设置了「减少动态效果」时粒子数量减到很少、不画闪电。 */
(function (root) {
  "use strict";
  const fxRand = () => (typeof fxRandom === "function" ? fxRandom() : Math.random());   // 画面效果的随机数：不动战斗用的种子随机数（run.js · fxRandom）
  const MAX = 900;
  let canvas = null, ctx = null, parts = [], arcs = [], rings = [], raf = 0, last = 0, dpr = 1;
  const reduced = () => !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const rnd = (a, b) => a + fxRand() * (b - a);
  const pick = arr => arr[Math.floor(fxRand() * arr.length)];

  function ensure() {
    if (canvas && canvas.isConnected) return true;
    if (typeof document === "undefined" || !document.body) return false;
    canvas = document.createElement("canvas");
    canvas.id = "hit-fx";
    canvas.className = "ol-ui hitfx";   // ol-ui：联机玩家画面只显示 ol-ui 元素，这里也要能看到
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:90";
    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d");
    resize();
    root.addEventListener("resize", resize);
    return !!ctx;
  }
  function resize() {
    if (!canvas) return;
    dpr = Math.min(2, root.devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
  }
  function add(p) { if (parts.length < MAX) parts.push(Object.assign({ age: 0, rot: 0, vr: 0, g: 0, drag: 0, shrink: true }, p)); }

  /** 闪电：从 a 到 b 的一条折线，中途分叉 */
  function bolt(ax, ay, bx, by, spread, depth) {
    const pts = [[ax, ay]], n = 7;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      pts.push([ax + (bx - ax) * t + rnd(-spread, spread), ay + (by - ay) * t + rnd(-spread, spread)]);
    }
    pts.push([bx, by]);
    const out = [pts];
    if (depth > 0) {
      const k = 2 + Math.floor(fxRand() * 3), [sx, sy] = pts[k];
      out.push(...bolt(sx, sy, sx + rnd(-40, 40), sy + rnd(-30, 30), spread * 0.6, depth - 1));
    }
    return out;
  }

  const EMIT = {
    fire(cx, cy, w, h, k) {
      for (let i = 0; i < 46 * k; i++) add({ kind: "flame", x: cx + rnd(-w * .42, w * .42), y: cy + rnd(-h * .1, h * .4), vx: rnd(-30, 30), vy: rnd(-170, -60), size: rnd(10, 22) * Math.sqrt(k), life: rnd(.45, .9), hue: rnd(8, 42) });
      for (let i = 0; i < 26 * k; i++) add({ kind: "spark", x: cx + rnd(-w * .3, w * .3), y: cy + rnd(-h * .2, h * .3), vx: rnd(-160, 160), vy: rnd(-260, -40), g: 260, size: rnd(1.5, 3), life: rnd(.5, 1.1), color: pick(["#ff9a1f", "#ff6a00", "#ffc23a"]) });
    },
    electric(cx, cy, w, h, k) {
      const n = Math.round(4 * k);
      for (let i = 0; i < n; i++) {
        const a = rnd(0, Math.PI * 2), r1 = rnd(.1, .25), r2 = rnd(.55, .75);
        arcs.push({ age: 0, life: rnd(.18, .32), delay: i * .05, lines: bolt(cx + Math.cos(a) * w * r1, cy + Math.sin(a) * h * r1, cx + Math.cos(a + rnd(-1.5, 1.5)) * w * r2, cy + Math.sin(a + rnd(-1.5, 1.5)) * h * r2, 10, 1) });
      }
      for (let i = 0; i < 34 * k; i++) { const a = rnd(0, Math.PI * 2), v = rnd(120, 380); add({ kind: "spark", x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 3, size: rnd(1.2, 2.6), life: rnd(.25, .55), color: pick(["#ffd500", "#2f8bff", "#00b7ff"]) }); }
      rings.push({ x: cx, y: cy, r: 6, vr: 260, life: .22, age: 0, color: "rgba(47,139,255,", width: 3 });
    },
    ice(cx, cy, w, h, k) {
      for (let i = 0; i < 26 * k; i++) { const a = rnd(0, Math.PI * 2), v = rnd(110, 300); add({ kind: "shard", x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, g: 320, drag: 1.2, size: rnd(5, 11) * Math.sqrt(k), life: rnd(.55, .95), rot: a, vr: rnd(-8, 8), color: pick(["#4aa8e8", "#7cc6f5", "#2b86c9"]) }); }
      for (let i = 0; i < 14 * k; i++) add({ kind: "flake", x: cx + rnd(-w * .5, w * .5), y: cy + rnd(-h * .5, h * .2), vx: rnd(-20, 20), vy: rnd(10, 50), size: rnd(3, 5), life: rnd(.8, 1.3), rot: rnd(0, 3), vr: rnd(-2, 2), color: "#5fb4ec", shrink: false });
      rings.push({ x: cx, y: cy, r: 8, vr: 200, life: .45, age: 0, color: "rgba(74,168,232,", width: 3.5 });
    },
    acid(cx, cy, w, h, k) {
      for (let i = 0; i < 34 * k; i++) { const a = rnd(-Math.PI * .95, -Math.PI * .05), v = rnd(120, 300); add({ kind: "drop", x: cx + rnd(-w * .2, w * .2), y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 620, size: rnd(3, 6.5) * Math.sqrt(k), life: rnd(.6, 1), color: pick(["#6cc33a", "#4fa828", "#9be35a"]) }); }
      for (let i = 0; i < 12 * k; i++) add({ kind: "bubble", x: cx + rnd(-w * .4, w * .4), y: cy + rnd(0, h * .4), vx: rnd(-10, 10), vy: rnd(-70, -30), size: rnd(3, 7), life: rnd(.6, 1.1), color: "#5fae2e", shrink: false });
    },
    energy(cx, cy, w, h, k) {
      rings.push({ x: cx, y: cy, r: 4, vr: 300 * Math.sqrt(k), life: .4, age: 0, color: "rgba(20,180,190,", width: 5 });
      rings.push({ x: cx, y: cy, r: 2, vr: 190 * Math.sqrt(k), life: .5, age: 0, delay: .08, color: "rgba(95,214,220,", width: 2.5 });
      for (let i = 0; i < 22 * k; i++) { const a = rnd(0, Math.PI * 2), v = rnd(80, 240); add({ kind: "orb", x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 2.2, size: rnd(3, 6), life: rnd(.4, .8), color: pick(["#14b4be", "#3fd2dc", "#0e8f98"]) }); }
    },
    physical(cx, cy, w, h, k) {
      for (let i = 0; i < 12 * k; i++) { const a = (i / (12 * k)) * Math.PI * 2 + rnd(-.15, .15), len = rnd(18, 34) * Math.sqrt(k); add({ kind: "streak", x: cx, y: cy, vx: Math.cos(a) * 420, vy: Math.sin(a) * 420, drag: 6, len, rot: a, size: 3, life: .24, color: "#c0622a" }); }
      for (let i = 0; i < 20 * k; i++) { const a = rnd(0, Math.PI * 2), v = rnd(90, 260); add({ kind: "chip", x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, g: 700, size: rnd(2.5, 5), life: rnd(.4, .8), rot: a, vr: rnd(-10, 10), color: pick(["#c0622a", "#8a4a1e", "#6b5c48"]) }); }
      rings.push({ x: cx, y: cy, r: 4, vr: 240, life: .18, age: 0, color: "rgba(192,98,42,", width: 4 });
    },
    harmonic(cx, cy, w, h, k) {
      for (let i = 0; i < 3 + Math.round(k); i++) rings.push({ x: cx, y: cy, r: 6, vr: 150, life: .7, age: 0, delay: i * .12, color: "rgba(150,90,220,", width: 3, wave: true });
      for (let i = 0; i < 16 * k; i++) { const a = rnd(0, Math.PI * 2), v = rnd(60, 150); add({ kind: "note", x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, drag: 1.5, size: rnd(2.5, 4.5), life: rnd(.6, 1), color: pick(["#9a5ce0", "#d36fbf", "#b98be0"]) }); }
    }
  };

  function draw(p, t) {
    const fade = 1 - t, s = p.shrink ? p.size * (1 - t * .7) : p.size;
    ctx.globalAlpha = Math.max(0, fade);
    switch (p.kind) {
      case "flame": {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, s);
        const l = 70 - t * 25;
        g.addColorStop(0, `hsla(${p.hue + 20}, 100%, ${l + 15}%, .95)`); g.addColorStop(.5, `hsla(${p.hue}, 100%, ${l - 10}%, .7)`); g.addColorStop(1, `hsla(${p.hue - 5}, 100%, 40%, 0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(p.x, p.y, s * .7, s, 0, 0, Math.PI * 2); ctx.fill(); break;
      }
      case "spark": case "orb": case "note":
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, Math.PI * 2); ctx.fill(); break;
      case "bubble":
        ctx.strokeStyle = p.color; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, Math.PI * 2); ctx.stroke(); break;
      case "drop":
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.ellipse(p.x, p.y, s * .7, s, Math.atan2(p.vy, p.vx) + Math.PI / 2, 0, Math.PI * 2); ctx.fill(); break;
      case "shard":
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(-s * .5, s * .35); ctx.lineTo(-s * .5, -s * .35); ctx.closePath(); ctx.fill(); ctx.restore(); break;
      case "flake":
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.strokeStyle = p.color; ctx.lineWidth = 1.2; ctx.beginPath();
        for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; ctx.moveTo(Math.cos(a) * s, Math.sin(a) * s); ctx.lineTo(-Math.cos(a) * s, -Math.sin(a) * s); }
        ctx.stroke(); ctx.restore(); break;
      case "streak":
        ctx.strokeStyle = p.color; ctx.lineWidth = p.size; ctx.lineCap = "round"; ctx.beginPath();
        ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - Math.cos(p.rot) * p.len * fade, p.y - Math.sin(p.rot) * p.len * fade); ctx.stroke(); break;
      case "chip":
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color; ctx.fillRect(-s / 2, -s / 2, s, s * .7); ctx.restore(); break;
    }
  }
  function frame(now) {
    const dt = Math.min(.05, (now - (last || now)) / 1000); last = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-over";   // 单位卡是浅色的，叠加混合会发白看不见
    for (const r of rings) {
      if (r.delay > 0) { r.delay -= dt; continue; }
      r.age += dt; r.r += r.vr * dt;
      const t = r.age / r.life; if (t >= 1) continue;
      ctx.globalAlpha = 1; ctx.strokeStyle = r.color + (1 - t).toFixed(3) + ")"; ctx.lineWidth = r.width * (1 - t * .5);
      ctx.beginPath();
      if (r.wave) { for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2, rr = r.r + Math.sin(a * 8 + r.age * 20) * 3; i ? ctx.lineTo(r.x + Math.cos(a) * rr, r.y + Math.sin(a) * rr) : ctx.moveTo(r.x + Math.cos(a) * rr, r.y + Math.sin(a) * rr); } }
      else ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    rings = rings.filter(r => r.delay > 0 || r.age < r.life);
    for (const a of arcs) {
      if (a.delay > 0) { a.delay -= dt; continue; }
      a.age += dt; const t = a.age / a.life; if (t >= 1) continue;
      for (const pts of a.lines) {
        for (const [lw, col] of [[7, "rgba(30,110,255,.55)"], [3, "rgba(255,230,40,1)"], [1.2, "rgba(255,255,255,1)"]]) {
          ctx.globalAlpha = 1 - t; ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineJoin = "round"; ctx.beginPath();
          pts.forEach(([x, y], i) => i ? ctx.lineTo(x + rnd(-1.5, 1.5), y + rnd(-1.5, 1.5)) : ctx.moveTo(x, y)); ctx.stroke();
        }
      }
    }
    arcs = arcs.filter(a => a.delay > 0 || a.age < a.life);
    for (const p of parts) {
      p.age += dt;
      p.vy += p.g * dt;
      if (p.drag) { const f = Math.max(0, 1 - p.drag * dt); p.vx *= f; p.vy *= f; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      if (p.kind === "bubble") p.x += Math.sin(p.age * 12) * .4;
      const t = p.age / p.life; if (t < 1) draw(p, t);
    }
    parts = parts.filter(p => p.age < p.life);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    if (parts.length || arcs.length || rings.length) raf = requestAnimationFrame(frame);
    else { raf = 0; last = 0; ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }

  function burst(element, rect, opt) {
    opt = opt || {};
    if (!rect || !ensure()) return false;
    const fn = EMIT[element] || EMIT.physical;
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    let k = opt.big ? 1.8 : 1;
    if (reduced()) { k = 0.25; if (element === "electric") { EMIT.physical(cx, cy, rect.width, rect.height, k); return start(); } }
    fn(cx, cy, Math.max(40, rect.width), Math.max(30, rect.height), k);
    return start();
  }
  function start() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } return true; }
  function clear() { parts = []; arcs = []; rings = []; }

  root.HitFx = { burst, clear, ELEMENTS: Object.keys(EMIT) };
})(typeof window !== "undefined" ? window : globalThis);
