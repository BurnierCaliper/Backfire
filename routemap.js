/* Antlerscale: Backfire · 任务路线图（从左到右，类似《杀戮尖塔》）
 *
 * 美术按 art/style-guide.html 定稿：
 *   每幕一张区域底图（外城区 / 沙漠 / 巨人城 / 天网设施，全是 SVG 画的地形剪影 + 颗粒 + 暗角 + 墙上涂鸦），
 *   节点是立在地图上的全息投影（地面光斑、光柱、扫描条纹、漂浮闪烁、红蓝错位），
 *   路线是青蓝虚线，下一步能走的会流动，走过的变金色，走过的节点打红色毛笔勾（粗笔、转折积墨、尾巴飞白）。
 *
 * 只负责画：RouteMap.html(model) 返回一段 HTML；可以点的节点带 data-route="序号"，由 rogue-ui.js 绑定点击。
 * model：{ region, title, cols:[[类型]], nodes:[节点或 null], pick:[选了第几个], index, choices:[可选序号], seed }
 */
const RouteMap = (() => {
  const W_STEP = 150, H = 330, PAD = 74;

  /* ---------- 小工具：按种子的随机数（同一张图每次画出来一样） ---------- */
  function seeded(str) {
    let h = 2166136261;
    for (let i = 0; i < String(str).length; i++) { h ^= String(str).charCodeAt(i); h = Math.imul(h, 16777619); }
    let s = (h >>> 0) % 233280;
    return () => (s = (s * 9301 + 49297) % 233280) / 233280;
  }
  let rnd = Math.random;
  const rr = (a, b) => a + rnd() * (b - a);

  /* ---------- 图标（和 art/style-guide.html 同一套线稿） ---------- */
  const G = {
    battle: `<path d="M11 11 L33 33 M27 37 L37 27 M33 33 L39 39"/><path d="M37 11 L15 33 M11 27 L21 37 M15 33 L9 39"/>`,
    elite: `<path d="M8 12 L16 21 L24 16 L32 21 L40 12 L37 31 L24 40 L11 31 Z"/><path d="M17 27 L22 28 M31 27 L26 28"/><path class="thin" d="M24 21 L24 33"/>`,
    boss: `<path d="M24 5 L40.5 14.5 L40.5 33.5 L24 43 L7.5 33.5 L7.5 14.5 Z"/><path d="M13 24 Q24 13 35 24 Q24 35 13 24 Z"/><circle class="solid" cx="24" cy="24" r="3.6"/>`,
    rest: `<path d="M6 38 L42 38"/><path d="M10 38 L24 15 L38 38"/><path d="M19 38 L24 29 L29 38"/><path class="thin" d="M34 8 A5 5 0 1 0 40 15 A6.5 6.5 0 0 1 34 8 Z"/>`,
    shop: `<path d="M24 7 L39 15.5 L39 32.5 L24 41 L9 32.5 L9 15.5 Z"/><path d="M9 15.5 L24 24 L39 15.5 M24 24 L24 41"/>`,
    smith: `<path d="M13 37 L27 23"/><path d="M23 11 L37 25 L41 21 L27 7 Z"/><path class="thin" d="M7 25 L12 25 M11 13 L14.5 16.5 M19 5 L19 10"/><path d="M8 42 L18 42"/>`,
    clinic: `<path d="M16 6 H32 L42 16 V32 L32 42 H16 L6 32 V16 Z"/><path class="bold" d="M24 14 V34 M14 24 H34"/>`,
    check: `<path d="M24 5 L40.5 14.5 L40.5 33.5 L24 43 L7.5 33.5 L7.5 14.5 Z"/><path d="M24 13 L34 30 H14 Z"/><path class="thin" d="M24 5 L24 13 M40.5 33.5 L34 30 M7.5 33.5 L14 30"/>`,
    ambush: `<path d="M24 6 L43 39 H5 Z"/><path class="bold" d="M24 18 V28"/><rect class="solid" x="22" y="31.5" width="4" height="4"/>`,
    start: `<path d="M12 42 V7"/><path d="M12 9 H36 L30 16 L36 23 H12"/>`
  };
  const COLOR = {
    battle: "#ece0c6", elite: "#ff7a2e", boss: "#ff3b2e", rest: "#7ccfe8", shop: "#f2c230",
    smith: "#ff9a3c", clinic: "#8fe05a", check: "#c07cf0", ambush: "#ff4f6e", start: "#ece0c6"
  };

  /* ---------- 公用滤镜 / 图案：整页只放一份 ---------- */
  function ensureDefs() {
    // 用 querySelector：game.html 的计算器垫片会让 getElementById 对不存在的 id 造一个替身
    if (typeof document === "undefined" || document.querySelector("#rm-defs")) return;
    // 经 HTML 解析器生成（直接对 svg 元素写 innerHTML 会得到 HTML 命名空间的元素，滤镜全部失效）
    const wrap = document.createElement("div");
    wrap.innerHTML = `<svg id="rm-defs" width="0" height="0" aria-hidden="true" style="position:absolute"><defs>
      <filter id="rm-spray" x="-10%" y="-20%" width="120%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="6" xChannelSelector="R" yChannelSelector="G" result="d"/>
        <feGaussianBlur in="d" stdDeviation=".6"/></filter>
      <filter id="rm-brush" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency=".09 .55" numOctaves="2" seed="5" result="f"/>
        <feDisplacementMap in="SourceGraphic" in2="f" scale="3.2" xChannelSelector="R" yChannelSelector="G"/></filter>
      <filter id="rm-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2.2" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="rm-grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="2"/>
        <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .35 0"/>
        <feComposite in2="SourceGraphic" operator="in"/></filter>
      <filter id="rm-blur3"><feGaussianBlur stdDeviation="3"/></filter>
      <filter id="rm-blur6"><feGaussianBlur stdDeviation="6"/></filter>
      <filter id="rm-blur14"><feGaussianBlur stdDeviation="14"/></filter>
      <pattern id="rm-scan" width="4" height="4" patternUnits="userSpaceOnUse">
        <rect width="4" height="2.6" fill="#fff"/><rect y="2.6" width="4" height="1.4" fill="#fff" fill-opacity=".35"/></pattern>
      <mask id="rm-holo-mask" maskContentUnits="userSpaceOnUse"><rect x="-4000" y="-4000" width="9000" height="9000" fill="url(#rm-scan)"/></mask>
      <linearGradient id="rm-beam" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".5"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
      <pattern id="rm-rain" width="14" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(14)">
        <path d="M7 0 V16" stroke="#9fb3d6" stroke-opacity=".18" stroke-width="1"/></pattern>
    </defs></svg>`;
    document.body.appendChild(wrap.firstChild);
  }

  /* ---------- 区域底图 ---------- */
  const BG = {
    "外城区": { en: "OUTER CITY", draw: (W) => {
      let s = `<rect width="${W}" height="${H}" fill="url(#rm-g-oc)"/>
        <defs><linearGradient id="rm-g-oc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a3326"/><stop offset=".55" stop-color="#2a1d16"/><stop offset="1" stop-color="#140e0a"/></linearGradient></defs>
        <g filter="url(#rm-blur14)" opacity=".55">
          <ellipse cx="${W * .18}" cy="95" rx="160" ry="40" fill="#6b4a36"/><ellipse cx="${W * .62}" cy="70" rx="220" ry="46" fill="#5a3e2e"/></g>`;
      let x = 0, d = `M0 ${H}`;
      while (x < W) { const w = rr(24, 74), h = rr(40, 120); d += ` L${x.toFixed(0)} ${(H - h).toFixed(0)} L${(x + w * .3).toFixed(0)} ${(H - h - rr(0, 14)).toFixed(0)} L${(x + w).toFixed(0)} ${(H - h).toFixed(0)}`; x += w; }
      s += `<path d="${d} L${W} ${H} Z" fill="#0f0a07" opacity=".85"/>`;
      const cx = W * .77;
      s += `<path d="M${cx} ${H} L${cx + 10} 110 L${cx + 20} ${H} M${cx + 10} 110 L${cx + 90} 110 M${cx + 80} 110 V138" stroke="#0f0a07" stroke-width="5" fill="none"/>`;
      [[cx + 10, 106], [W * .3, 170], [W * .52, 160]].forEach(([a, b]) => { s += `<circle cx="${a}" cy="${b}" r="3" fill="#ff4a2e"/><circle cx="${a}" cy="${b}" r="10" fill="#ff4a2e" opacity=".25" filter="url(#rm-blur6)"/>`; });
      s += tag(W * .04, 244, "OUTLAWS", "#ff4fa3", -6, 26) + tag(W * .56, 252, "别回头", "#39e6b4", 4, 30, true);
      return s;
    } },
    "沙漠": { en: "THE WASTES", draw: (W) => `<defs><linearGradient id="rm-g-ds" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3cf86"/><stop offset=".45" stop-color="#e0a85a"/><stop offset="1" stop-color="#a8642a"/></linearGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#rm-g-ds)"/>
      <circle cx="${W * .82}" cy="62" r="42" fill="#fff1c4" opacity=".55"/><circle cx="${W * .82}" cy="62" r="84" fill="#fff1c4" opacity=".2" filter="url(#rm-blur14)"/>
      <path d="M0 132 C${W * .14} 106 ${W * .26} 150 ${W * .4} 124 S${W * .68} 98 ${W * .82} 132 S${W * .96} 124 ${W} 116 V${H} H0 Z" fill="#d49646"/>
      <path d="M0 178 C${W * .12} 150 ${W * .3} 196 ${W * .47} 164 S${W * .76} 152 ${W * .9} 182 S${W * .98} 178 ${W} 174 V${H} H0 Z" fill="#bd7b36"/>
      <path d="M0 222 C${W * .18} 200 ${W * .34} 240 ${W * .52} 214 S${W * .82} 210 ${W} 228 V${H} H0 Z" fill="#9c5d27"/>
      <path d="M${W * .09} ${H} L${W * .11} 205 L${W * .118} ${H} M${W * .6} ${H} L${W * .612} 222 L${W * .63} ${H}" stroke="#5b3416" stroke-width="4" fill="none"/>
      ${tag(W * .08, 252, "NO WATER >>>", "#5b2a10", -4, 20)}` },
    "巨人城": { en: "TITAN CITY", draw: (W) => {
      let s = `<defs><linearGradient id="rm-g-gc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3f55"/><stop offset=".5" stop-color="#232838"/><stop offset="1" stop-color="#0f121a"/></linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#rm-g-gc)"/>
        <g filter="url(#rm-blur14)" opacity=".6"><ellipse cx="${W * .3}" cy="36" rx="260" ry="38" fill="#555b78"/><ellipse cx="${W * .78}" cy="28" rx="240" ry="32" fill="#4a5070"/></g>`;
      [[.04, 70, 180], [.15, 60, 135], [.43, 90, 205], [.56, 55, 150], [.7, 80, 225], [.88, 70, 170]].forEach(([fx, w, h]) => {
        const x = W * fx;
        s += `<path d="M${x} ${H} L${x} ${H - h} L${x + w * .4} ${H - h + 22} L${x + w * .7} ${H - h - 14} L${x + w} ${H - h + 10} L${x + w} ${H} Z" fill="#0b0d13" opacity=".9"/>`;
        for (let yy = H - h + 30; yy < H - 10; yy += 22) s += `<rect x="${x + 8}" y="${yy}" width="${w - 16}" height="3" fill="#2a3044" opacity=".7"/>`;
      });
      const hx = W * .32;
      s += `<path d="M${hx} ${H} L${hx + 25} 145 L${hx + 10} 108 L${hx + 40} 80 M${hx + 25} 145 L${hx + 70} 118 L${hx + 90} 86 M${hx + 25} 145 L${hx - 20} 126 L${hx - 35} 94" stroke="#0b0d13" stroke-width="12" fill="none" stroke-linecap="round"/>`;
      const lx = W * .64;
      s += `<path d="M${lx} 8 L${lx - 20} 62 L${lx + 5} 64 L${lx - 30} 134" stroke="#cbbcff" stroke-width="2.5" fill="none" opacity=".65"/>`;
      s += `<rect width="${W}" height="${H}" fill="url(#rm-rain)"/>` + tag(W * .44, 248, "THEY WALK", "#f2c230", -8, 24);
      return s;
    } },
    "天网设施": { en: "SKYNET FACILITY", draw: (W) => {
      let s = `<defs><linearGradient id="rm-g-sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f3236"/><stop offset=".6" stop-color="#0a1f22"/><stop offset="1" stop-color="#050d0f"/></linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#rm-g-sk)"/>`;
      for (let i = -10; i <= 10; i++) s += `<path d="M${W / 2 + i * 30} 130 L${W / 2 + i * 160} ${H}" stroke="#35e0c0" stroke-opacity=".12"/>`;
      [140, 154, 174, 202, 238].forEach(yy => { s += `<path d="M0 ${yy} H${W}" stroke="#35e0c0" stroke-opacity=".12"/>`; });
      s += `<path d="M0 36 H${W} M0 48 H${W}" stroke="#16393c" stroke-width="7"/>`;
      [[.06, 66], [.2, 56], [.82, 74], [.93, 60]].forEach(([fx, h]) => {
        const x = W * fx;
        s += `<rect x="${x}" y="${130 - h}" width="44" height="${h}" fill="#071416" stroke="#1f4c50"/>`;
        for (let k = 0; k < 4; k++) s += `<rect x="${x + 8}" y="${130 - h + 10 + k * 13}" width="${8 + (k * 7) % 20}" height="3" fill="${k % 3 ? "#35e0c0" : "#ff4a2e"}" opacity=".7"/>`;
      });
      s += `<circle cx="${W / 2}" cy="86" r="30" fill="none" stroke="#ff4a2e" stroke-opacity=".35" stroke-width="2"/><circle cx="${W / 2}" cy="86" r="5" fill="#ff4a2e" opacity=".8"/>`;
      s += tag(W * .72, 250, "UNPLUG IT", "#ff4fa3", 6, 22);
      return s;
    } }
  };
  /** 墙上的喷漆字 */
  function tag(x, y, text, color, rot, size, cn) {
    // 字体还没打包进游戏：先用系统粗体 + 斜体顶上（装了 Permanent Marker / 指芒星 会自动用上）
    const font = cn ? `"Zhi Mang Xing", "ZCOOL QingKe HuangYou", "PingFang SC", "Microsoft YaHei", sans-serif`
      : `"Permanent Marker", Impact, "Arial Black", sans-serif`;
    return `<g opacity=".5" filter="url(#rm-spray)"><text x="${x.toFixed(0)}" y="${y}" font-family='${font}' font-weight="900" font-style="italic" font-size="${size}" fill="${color}" transform="rotate(${rot} ${x.toFixed(0)} ${y})">${text}</text></g>`;
  }

  /* ---------- 红色毛笔勾 ---------- */
  let brushN = 0;
  function brushCheck(x, y, big) {
    const id = "rm-bm" + (brushN++);
    const s = big ? 1.9 : 1.5;
    const W = (big ? 14 : 11) * rr(.92, 1.08);
    const rot = rr(-12, 6);
    const A = [x - rr(19, 23) * s, y - rr(2, 7) * s];
    const B = [x - rr(4, 8) * s, y + rr(14, 18) * s];
    const C = [x + rr(26, 33) * s, y - rr(24, 32) * s];
    const qa = [A[0] + rr(3, 6) * s, A[1] + rr(9, 13) * s];
    const qb = [B[0] + rr(10, 15) * s, B[1] - rr(16, 24) * s];
    const quad = (p0, p1, p2, t) => [
      (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
      (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]];
    const pts = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push({ p: quad(A, qa, B, t), w: W * (.5 + .45 * Math.pow(t, .8)) }); }
    for (let i = 1; i <= 30; i++) { const t = i / 30; pts.push({ p: quad(B, qb, C, t), w: W * Math.max(.1, 1 - .88 * Math.pow(t, 1.7)) * rr(.95, 1.05) }); }
    const side = (i, k) => {
      const a = pts[Math.max(0, i - 1)].p, b = pts[Math.min(pts.length - 1, i + 1)].p;
      let nx = -(b[1] - a[1]), ny = b[0] - a[0];
      const len = Math.hypot(nx, ny) || 1;
      return [pts[i].p[0] + nx / len * pts[i].w * k, pts[i].p[1] + ny / len * pts[i].w * k];
    };
    const path = (arr) => arr.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    const left = pts.map((_, i) => side(i, .5)), right = pts.map((_, i) => side(i, -.5)).reverse();
    let streaks = "";
    [-.3, .05, .3].forEach(off => {
      const from = Math.floor(rr(26, 32)), seg = [];
      for (let i = from; i < pts.length; i++) seg.push(side(i, off));
      streaks += `<path d="${path(seg)}" stroke="#000" stroke-width="${rr(.7, 1.3).toFixed(1)}" fill="none" stroke-dasharray="${rr(4, 9).toFixed(0)} ${rr(2, 5).toFixed(0)}" stroke-linecap="round"/>`;
    });
    return `<g class="rm-check" transform="rotate(${rot.toFixed(1)} ${x} ${y})" pointer-events="none">
      <mask id="${id}" maskUnits="userSpaceOnUse" x="${x - 120}" y="${y - 120}" width="240" height="240">
        <path d="${path(left.concat(right))} Z" fill="#fff"/><circle cx="${A[0].toFixed(1)}" cy="${A[1].toFixed(1)}" r="${(W * .32).toFixed(1)}" fill="#fff"/>${streaks}</mask>
      <g filter="url(#rm-brush)" mask="url(#${id})">
        <rect x="${x - 120}" y="${y - 120}" width="240" height="240" fill="#c8241c"/>
        <circle cx="${B[0].toFixed(1)}" cy="${B[1].toFixed(1)}" r="${(W * .55).toFixed(1)}" fill="#7e130e" opacity=".4"/>
        <circle cx="${A[0].toFixed(1)}" cy="${A[1].toFixed(1)}" r="${(W * .4).toFixed(1)}" fill="#8f1a12" opacity=".45"/></g></g>`;
  }

  /* ---------- 全息节点 ---------- */
  function holoNode(type, x, y, state, idx, label) {
    const big = type === "elite" || type === "boss";
    const c = COLOR[type] || COLOR.battle;
    const sz = big ? 50 : 40;
    const top = y - sz * .85;
    const prx = big ? 26 : 19, pry = big ? 7 : 5.5;
    const g = G[type] || G.battle;
    const clickable = state === "pickable";
    const box = (cls, dx) => `<svg x="${(x - sz / 2 + dx).toFixed(1)}" y="${(top - sz / 2).toFixed(1)}" width="${sz}" height="${sz}" viewBox="0 0 48 48" overflow="visible">${cls}</svg>`;
    return `<g class="rm-node ${state}" style="--c:${c}" ${clickable ? `data-route="${idx}" role="button" tabindex="0" aria-label="前往：${label}"` : ""}>
      ${clickable ? `<rect class="rm-hit" x="${x - 34}" y="${top - sz / 2 - 6}" width="68" height="${y + 18 - (top - sz / 2 - 6)}"/>` : ""}
      <ellipse class="pad" cx="${x}" cy="${y + 10}" rx="${prx}" ry="${pry}" filter="url(#rm-blur3)"/>
      <ellipse class="pad-ring" cx="${x}" cy="${y + 10}" rx="${prx}" ry="${pry}"/>
      ${state === "now" || state === "pickable" ? `<ellipse class="ping" cx="${x}" cy="${y + 10}" rx="${prx}" ry="${pry}"/>` : ""}
      <path class="beam" d="M${x - prx * .9} ${y + 10} L${x - sz * .45} ${top + sz * .3} L${x + sz * .45} ${top + sz * .3} L${x + prx * .9} ${y + 10} Z"/>
      <g class="float" style="animation-delay:-${rr(0, 3).toFixed(2)}s">
        ${box(`<g class="shade" filter="url(#rm-blur3)">${g}</g>`, 0)}
        ${box(`<g class="ghost">${g}</g>`, -1.5)}
        ${box(`<g class="ghost b">${g}</g>`, 1.5)}
        ${box(`<g class="glyph" filter="url(#rm-glow)" mask="url(#rm-holo-mask)">${g}</g>`, 0)}
      </g>
      ${state === "done" ? brushCheck(x, top + 10, big) : ""}
      <title>${label}</title>
    </g>`;
  }

  /* ---------- 整张图 ---------- */
  function html(m) {
    ensureDefs();
    rnd = seeded(m.seed || "map");
    const cols = m.cols || [];
    const W = Math.max(640, PAD * 2 + (cols.length - 1) * W_STEP);
    const colX = (c) => cols.length === 1 ? W / 2 : PAD + c * ((W - PAD * 2) / (cols.length - 1));
    const rowY = (k, i) => k === 1 ? 195 : k === 2 ? [140, 250][i] : [112, 200, 288][i];
    const pos = (c, i) => [colX(c), rowY(cols[c].length, i)];
    const pick = m.pick || [];
    const idx = m.index || 0;
    const chosenHere = !!(m.nodes && m.nodes[idx]);
    const choices = new Set(m.choices || []);
    const links = m.links || ((k, n) => { const out = []; for (let i = 0; i < k; i++) for (let j = 0; j < n; j++) { const lo = Math.max(i / k, j / n), hi = Math.min((i + 1) / k, (j + 1) / n); if (hi - lo > 1e-9) out.push([i, j]); } return out; });
    const bg = BG[m.region] || BG["外城区"];
    let s = bg.draw(W);
    s += `<rect width="${W}" height="${H}" fill="#000" filter="url(#rm-grain)" opacity=".9"/>`;
    s += `<defs><radialGradient id="rm-vg" cx="50%" cy="50%" r="75%"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#rm-vg)"/>`;
    // 连线
    let halo = "", edges = "";
    for (let c = 0; c < cols.length - 1; c++) {
      links(cols[c].length, cols[c + 1].length).forEach(([i, j]) => {
        const [x1, y1] = pos(c, i), [x2, y2] = pos(c + 1, j);
        const mx = (x1 + x2) / 2;
        const d = `M${x1} ${y1 + 10} C${mx} ${y1 + 10} ${mx} ${y2 + 10} ${x2} ${y2 + 10}`;
        const walked = pick[c] === i && pick[c + 1] === j && (c + 1 < idx || (c + 1 === idx && chosenHere));
        const next = (c === idx && chosenHere && pick[c] === i) || (c === idx - 1 && !chosenHere && pick[c] === i && choices.has(j));
        const dead = c < idx && pick[c] !== i;
        halo += `<path class="rm-edge-halo" d="${d}"/>`;
        edges += `<path class="rm-edge${walked ? " done" : next ? " next" : dead ? " dead" : ""}" d="${d}"/>`;
      });
    }
    s += halo + edges;
    // 节点
    cols.forEach((col, c) => col.forEach((type, i) => {
      const [x, y] = pos(c, i);
      let state = "later";
      if (c < idx) state = pick[c] === i ? "done" : "skip";
      else if (c === idx) state = chosenHere ? (pick[c] === i ? "now" : "skip") : choices.has(i) ? "pickable" : "skip";
      const label = (m.labels && m.labels[type]) || type;
      s += holoNode(type, x, y, state, i, label);
    }));
    return `<div class="route-map" data-region="${m.region || ""}">
      <div class="rm-title">${m.region || ""}<small>${bg.en}</small></div>
      <div class="rm-scroll"><svg class="rm-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${m.title || "路线图"}">${s}</svg></div>
    </div>`;
  }

  return { html, COLOR, ICONS: G };
})();
if (typeof window !== "undefined") window.RouteMap = RouteMap;
