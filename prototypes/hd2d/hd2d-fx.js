/* Antlerscale: Backfire · HD-2D 战场原型 · 攻击演出的适配器和伤害数字（纯函数）
 *
 * attack-fx.js / hit-fx.js 画在一块全屏的 2D 画布上，要的是「单位在屏幕上的矩形」。正式游戏里是单位卡的 DOM 矩形（game.js / online-ui.js 的 rectOf），
 * 这里换成 3D 沙盘：把铭牌 / 地台按这一刻的镜头投影到屏幕上（镜头动了、远 / 中 / 近切换了，矩形跟着变）。
 *   const lens = HD2DFx.lens({ pos, target, fov, width, height });      // 这一刻的镜头（场景每次问 sc.lensNow()）
 *   HD2DFx.rectOf(lens, plate, size)    → { x, y, w, h, left, top, width, height }   // 铭牌：x / y 是 attack-fx 要的中心（y 在卡片高 42% 处），left / top / width / height 给 HitFx.burst
 *   HD2DFx.zoneRect(lens, zone)         → 同上，地台顶面在屏幕上的外框
 *   HD2DFx.adapter({ lens, plate, zone, size })  → { rectOf(id), zoneRectOf(id), track(id) }   // 每次调用都按当时的镜头重新投影
 * 演出只用联机玩家收到的那一份（OnlineView.projectPacket 投影过的包：state / tape / fx），不读房主的原始 state：
 *   HD2DFx.cues(packet, { before, bigHit })   → 这一下怎么演：谁打谁、招式、每一段打中谁、要弹哪些数字、谁被击倒、有没有格挡
 *   HD2DFx.placeNumbers(numbers, rectOf, view) → 每个数字摆在哪、多大（近景大、远景小；几个数字同时出来两两不压住）
 * 坚毅生命（shp）的具体数值绝不显示：投影里本来就没有（projectTape 遇到打在坚毅生命上的、濒死的，干脆不给数），这里也只认投影里的 value。
 * 不碰 three.js 和 DOM：Node 里 require 来测（tests/hd2d-fx.test.js），浏览器里是全局的 HD2DFx（在 hd2d-layout.js 之后加载）。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./hd2d-layout.js"));
  else root.HD2DFx = factory(root.HD2DLayout);
})(typeof self !== "undefined" ? self : this, function (L) {
  "use strict";

  /* ---------- 配置（数值都在这里，逻辑里不写死）----------
   *   anchorY     给 attack-fx 的矩形，y 取卡片高的几成处（和 game.js / online-ui.js 一样：刀光、弹字都落在 42% 处）
   *   num.size    各种数字的基准字号（像素；远景桌面铭牌 120px 宽时是 1 倍）：dmg 普通伤害、big 大伤害（暴击，规则的 bigHitInfo 判定，数字后面加 !!）、
   *               brk 击破、heal 治疗、block 格挡、word 状态字（灼烧、无效……投影白名单里的弹字）
   *   num.scale   字号按「铭牌在屏幕上的宽 ÷ 基准铭牌宽」缩放，夹在这个范围里（近景放大的铭牌上数字大，远景小）
   *   num.ink     墨线描边粗细 = 字号 × ink；num.pad 贴纸底（大伤害 / 击破）四周多出来的边（× 字号）
   *   num.glyph   估算字宽（× 字号）：数字、汉字、别的；num.lineH 行高
   *   num.lift    数字底边离铭牌上沿多高；num.gap 两个数字之间至少留的空；num.rise 消失前往上飘多少（排位置时也让出这么多，飘起来也不压住）
   *   num.spread  同一块铭牌上的几个数字先左右错开（× 铭牌宽），再不行往上叠
   *   num.tilt    贴纸歪一点（度，按顺序轮流取）
   *   num.dur     弹出 / 停住 / 淡出各多少毫秒（跟着演出倍率走）
   *   num.colors  属性色（和 attack-fx.js 的 COL 一样，测试核对）、击破 / 治疗 / 格挡 / 墨线 / 贴纸底的颜色
   *   timing      每一段打中之间隔多久、击倒的红叉晚多久（毫秒，跟着演出倍率走）
   *   paper       纸片感（打中的那一下）：attack-fx 的画布按镜头俯角在竖直方向压扁一点（一张贴纸立在沙盘上、被斜着看：压扁 = cos(俯角)，
   *               远景 30° ≈ 0.87、中景 22° ≈ 0.93、近景 14° ≈ 0.97，不小于 squash.min），脚下地台上投一道淡影子（地上的椭圆：
   *               宽 = 贴纸大小 × shadow.w，高 = 宽 × sin(俯角) × shadow.flat，越平视越扁；透明度 opacity，显示 dur 毫秒，跟着演出倍率）。
   *               贴纸大小和 attack-fx.js 的 sizeOf 一样（铭牌屏幕宽 × size.k，夹在 min–max：近景铭牌大，贴纸跟着大；远景小）。on = 开关（网址 ?paper=0 关）
   *   push        出手时镜头稍微推一下（tiers 里的段：远景 / 中景；近景已经够近不推）：看的那一点往攻击者和目标中间挪 toward，距离乘 dist；
   *               推过去攻击者或目标的铭牌出了画面就少推一点，退 steps 次还不行就不推。in / out = 推过去、拉回来各多少秒（跟着演出倍率），ease 缓动；
   *               on = 开关（页面上的「推镜头」按钮、网址 ?push=0）；减少动态效果、跳过时不推
   *   speeds      页面上「演出 n×」按钮轮流切的速度（演出倍率 = 1 / 速度，交给 AttackFx.setClock） */
  const FX = {
    anchorY: 0.42,
    num: {
      size: { dmg: 22, big: 32, brk: 15, heal: 20, block: 18, word: 13 },
      scale: { min: 0.78, max: 1.6 },
      ink: 0.16, pad: 0.22,
      glyph: { digit: 0.62, cjk: 1.0, other: 0.6 }, lineH: 1.15,
      lift: 6, gap: 4, rise: 8,
      spread: 0.3,
      tilt: [-5, 4, -2, 6, -6, 3],
      dur: { pop: 160, hold: 900, out: 320 },
      colors: {
        fire: "#ff5b2e", acid: "#9be03a", electric: "#ffd32e", ice: "#7ccfe8", energy: "#35e0c0", physical: "#ff9a3c", harmonic: "#c07cf0",
        brk: "#e8edf2", heal: "#39e6b4", block: "#3fe0ff", ink: "#0b0806", paper: "#fff4dc"
      }
    },
    timing: { hitGap: 170, koDelay: 120 },
    paper: { on: true, squash: { min: 0.8 }, size: { k: 0.5, min: 36, max: 110 }, shadow: { w: 2.2, flat: 1, opacity: 0.3, dur: 460 } },
    push: { on: true, tiers: ["far", "mid"], toward: 0.35, dist: 0.86, steps: 4, in: 0.28, out: 0.42, ease: "inOutCubic" },
    speeds: [1, 2]
  };

  const D2R = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

  /* ---------- 镜头 → 屏幕 ---------- */
  /** 这一刻的镜头：pos 镜头在哪、target 看的那一点、fov 竖直视野（度）、width / height 画面像素。
   *  算出和布局同一种镜头对象（hd2d-layout.js · camAt：right / up / back / tanHalf / aspect / dist），L.project / L.plateRect 直接能用。
   *  玩家拖动过（左右转了）也对：right 按水平方向算，up 垂直于视线 */
  function lens(c) {
    const pos = { x: c.pos.x, y: c.pos.y, z: c.pos.z }, target = { x: c.target.x, y: c.target.y, z: c.target.z };
    let bx = pos.x - target.x, by = pos.y - target.y, bz = pos.z - target.z;
    const dist = Math.hypot(bx, by, bz) || 1e-6;
    bx /= dist; by /= dist; bz /= dist;
    // right = 世界的上方 × back（水平），up = back × right
    let rx = bz, rz = -bx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    const width = Math.max(1, c.width || 1), height = Math.max(1, c.height || 1), fov = c.fov || L.CONFIG.camera.fov;
    return {
      pos, target, dist, fov, width, height, aspect: width / height, tanHalf: Math.tan(fov * D2R / 2),
      right: { x: rx, y: 0, z: rz }, up: { x: by * rz, y: bz * rx - bx * rz, z: -by * rx }, back: { x: bx, y: by, z: bz }
    };
  }
  /** 屏幕矩形的两种写法都给：attack-fx 要中心 + 宽高（{ x, y, w, h }，y 在卡片高 anchorY 处），HitFx.burst 要 getBoundingClientRect 那种 */
  function box(left, top, w, h, anchor) {
    return { x: left + w / 2, y: top + h * anchor, w, h, left, top, width: w, height: h, right: left + w, bottom: top + h };
  }
  /** 一块铭牌在屏幕上的矩形。plate = { x, y, z 脚下的点（铭牌挂在这里）, lift 后排抬高的像素 }，size = 铭牌的像素尺寸（近景放大的那张是 L.plateSize(view, true)）。
   *  和布局 / 场景同一个公式（L.plateRect：按远近缩放、底边在脚下往上 lift），只是不算待机浮动让出的那 2px */
  function rectOf(ln, plate, size) {
    if (!ln || !plate || !size) return null;
    const r = L.plateRect(ln, size, { x: plate.x, y: plate.y, z: plate.z }, plate.lift || 0), bob = L.CONFIG.plate.bob;
    const top = r.y0 + bob, h = (r.y1 - bob) - top, w = r.x1 - r.x0;
    if (!(w > 0) || !(h > 0) || !Number.isFinite(top)) return null;
    return Object.assign(box(r.x0, top, w, h, FX.anchorY), { scale: r.scale, foot: r.foot });
  }
  /** 一个区的地台顶面在屏幕上的外框（四个角投影过去取外框；范围攻击、整区的演出用它） */
  function zoneRect(ln, z) {
    if (!ln || !z) return null;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    [-1, 1].forEach(sx => [-1, 1].forEach(sz => {
      const s = L.project(ln, { x: z.cx + sx * z.w / 2, y: z.topY, z: z.cz + sz * z.d / 2 });
      x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
    }));
    if (!Number.isFinite(x0) || !(x1 > x0) || !(y1 > y0)) return null;
    return box(x0, y0, x1 - x0, y1 - y0, 0.5);
  }

  /**
   * 适配器：attack-fx / hit-fx 拿单位、区在屏幕上的位置都问它。src（场景给的，都是函数，每次调用拿当时的）：
   *   lens()      这一刻的镜头输入 { pos, target, fov, width, height }
   *   plate(id)   这块铭牌现在在哪 { x, y, z, lift, big }（没有这块铭牌 = null）
   *   zone(id)    这个区的地台 { cx, cz, w, d, topY }
   *   size(big)   铭牌的像素尺寸（big = 近景放大的那张）
   *   offset()    画面左上角在视口里的位置（不给 = 0, 0；原型的画面铺满整个窗口）
   * 被击倒、已经从画面上拿掉的单位：返回最后一次看到它的地方（红叉、数字留在原地）
   */
  function adapter(src) {
    const last = new Map();
    const shift = (r) => {
      const o = src.offset ? src.offset() : null;
      if (!o || !(o.left || o.top)) return r;
      const s = box(r.left + (o.left || 0), r.top + (o.top || 0), r.w, r.h, (r.y - r.top) / r.h);
      return r.foot != null ? Object.assign(s, { scale: r.scale, foot: r.foot + (o.top || 0) }) : s;
    };
    const unit = (id) => {
      const p = src.plate(id);
      const r = p ? rectOf(lens(src.lens()), p, src.size(!!p.big)) : null;
      if (r) { const s = shift(r); last.set(id, s); return s; }
      return last.get(id) || null;
    };
    return {
      rectOf: unit,
      zoneRectOf(id) { const z = src.zone(id), r = z ? zoneRect(lens(src.lens()), z) : null; return r ? shift(r) : null; },
      /** 给 attack-fx 的 track：返回「这块铭牌现在在哪」的函数（镜头推近 / 拉回时红叉跟着铭牌走） */
      track: (id) => () => unit(id),
      /** 演出开始前先记一遍（被打死的单位，结算后的画面里就没有了） */
      remember(ids) { (ids || []).forEach(unit); }
    };
  }

  /* ---------- 这一下怎么演（只读投影过的包）---------- */
  const alive = (u) => u && !u.dead && !u.hidden && !u._removed && !u.fused;
  /**
   * packet = 联机玩家收到的那一份（OnlineView.projectPacket）：只读 packet.fx（招式）、packet.tape（弹字：伤害 / 击破 / 治疗 / 状态字）、packet.state.units（等级、谁还在）。
   * opts.before = 出招前画面上的那一份（上一个包的 state）：两边比一比，谁被击倒了。
   * opts.bigHit(等级, 伤害) = 规则的 bigHitInfo（app.js · spawnPopup 判「大伤害」用的同一个公式；只用投影里的等级和伤害数字）
   * 返回 { actor, target, move, script, parried, blocker, waves: [{ unitId, el }], numbers: [{ unitId, kind, text, el, wave }], ko: [id] }
   *   waves = 每一段主攻击打中谁（打中的那一下：刀光 / 冲击星 + 受击粒子 + 这一段的数字）
   */
  function cues(packet, opts) {
    opts = opts || {};
    const fx = packet && packet.fx, tape = (packet && Array.isArray(packet.tape) ? packet.tape : []).filter(e => e && e.type === "pop" && e.unitId);
    const units = (packet && packet.state && Array.isArray(packet.state.units)) ? packet.state.units : [];
    const byId = new Map(units.map(u => [u.id, u]));
    const out = { actor: fx ? fx.actor : null, target: fx ? fx.target : null, move: fx ? fx.move : null, script: fx && fx.script || null,
      parried: !!(fx && fx.parried), blocker: fx && fx.blocker || null, waves: [], numbers: [], ko: [] };
    let wave = -1;
    const word = (e) => typeof e.text === "string" && e.text ? e.text : null;
    tape.forEach(e => {
      const el = typeof e.element === "string" ? e.element : "physical";
      const value = num(e.value);
      if (e.kind === "dmg" && (e.main || wave < 0)) { wave++; out.waves.push({ unitId: e.unitId, el }); }
      const at = Math.max(0, wave);
      if (e.kind === "dmg") {
        if (value === undefined || value <= 0) return;      // 投影没给数（打在坚毅生命上、濒死）：只演打中，不弹数字
        const u = byId.get(e.unitId), big = !!(opts.bigHit && u && (opts.bigHit(u.level, value) || {}).big);
        out.numbers.push({ unitId: e.unitId, kind: big ? "big" : "dmg", text: big ? value + "!!" : String(value), el, wave: at });
      } else if (e.kind === "break") {
        if (value !== undefined && value > 0) out.numbers.push({ unitId: e.unitId, kind: "brk", text: "击破" + value, el, wave: at });
      } else if (e.kind === "heal") {
        if (value !== undefined && value > 0) out.numbers.push({ unitId: e.unitId, kind: "heal", text: "+" + value, el, wave: at });
      } else if (e.kind === "highboom") {
        out.numbers.push({ unitId: e.unitId, kind: "big", text: "高能自爆", el, wave: at });
      } else if ((e.kind === "status" || e.kind === "fxword") && word(e)) {
        out.numbers.push({ unitId: e.unitId, kind: e.text === "无效" ? "block" : "word", text: e.text, el, wave: at });
      }
    });
    if (out.parried && out.target) out.numbers.push({ unitId: out.blocker || out.target, kind: "block", text: "格挡", el: "physical", wave: Math.max(0, wave) });
    // 击倒：出招前还站着、结算后不在了（死了 / 被移出）的，只算这一下碰到的单位
    const hit = new Set(tape.map(e => e.unitId).concat(out.target ? [out.target] : []));
    const before = opts.before && Array.isArray(opts.before.units) ? opts.before.units : null;
    if (before) before.forEach(u => { if (alive(u) && hit.has(u.id) && !alive(byId.get(u.id))) out.ko.push(u.id); });
    return out;
  }

  /* ---------- 伤害数字摆在哪 ---------- */
  /** 估一行字多宽（按字号）：数字窄、汉字宽 */
  function textWidth(text, size) {
    const G = FX.num.glyph;
    let w = 0;
    for (const ch of String(text)) w += (/[0-9+\-!]/.test(ch) ? G.digit : /[　-鿿＀-￯]/.test(ch) ? G.cjk : G.other) * size;
    return w;
  }
  /** 数字的字号：基准字号 × 铭牌在屏幕上有多宽（近景放大的铭牌宽，数字跟着大；远景小） */
  function sizeOf(kind, rect) {
    const N = FX.num, base = L.CONFIG.plate.w;
    return (N.size[kind] || N.size.dmg) * clamp(rect.w / base, N.scale.min, N.scale.max);
  }
  /**
   * 摆数字：numbers = cues().numbers（或其中这一段的），rectOf(id) = 铭牌现在的屏幕矩形（适配器的），view = { width, height, top, bottom }（上下被界面盖住的像素）。
   * 先放在铭牌头顶正中，同一块铭牌上的第二个、第三个左右错开；和已经放好的压到了就往上叠，顶到顶栏了换旁边一列（右、左、再右……）从铭牌头顶重新叠。
   * 每个数字占的范围连「往上飘」的那一截一起算，所以飘起来也不压住；实在放不下（画面挤满了）就不弹这一个，宁可少一个也不压住。
   * 返回 [{ ...数字, x, y（中心）, w, h, size 字号, ink 描边, tilt 歪几度, box 占的范围 }]
   */
  function placeNumbers(numbers, rectOf, view) {
    const N = FX.num, out = [], used = new Map();
    view = view || {};
    const W = view.width || Infinity, Hh = view.height || Infinity, top = (view.top || 0) + 2;
    const hits = (a, b) => a.x0 < b.x1 + N.gap && b.x0 < a.x1 + N.gap && a.y0 < b.y1 + N.gap && b.y0 < a.y1 + N.gap;
    (numbers || []).forEach((n, i) => {
      const r = rectOf(n.unitId);
      if (!r || r.x < 0 || r.x > W || r.y < 0 || r.y > Hh) return;   // 铭牌不在画面里（近景看的是别的区）：不弹
      const size = sizeOf(n.kind, r), ink = Math.max(1.5, size * N.ink), pad = n.kind === "big" || n.kind === "brk" ? size * N.pad : 0;
      const w = textWidth(n.text, size) + 2 * (ink + pad), h = size * N.lineH + 2 * (ink + pad * 0.5);
      const k = used.get(n.unitId) || 0;
      used.set(n.unitId, k + 1);
      const side = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2);
      const cx = r.x + side * N.spread * r.w;
      const place = (x, bottom) => ({ x0: x - w / 2, x1: x + w / 2, y0: bottom - h - N.rise, y1: bottom });
      const start = Math.max(r.top - N.lift, top + h + N.rise);     // 铭牌贴着顶栏时，数字压在铭牌上也不顶进顶栏
      let b = null;
      for (let c = 0; c < 40 && !b; c++) {
        const off = c === 0 ? 0 : (c % 2 ? 1 : -1) * Math.ceil(c / 2);
        const x = clamp(cx + off * (w + N.gap), w / 2, W - w / 2);
        let cand = place(x, start);
        for (let g = 0; g < 60 && cand.y0 >= top; g++) {
          const p = out.find(q => hits(cand, q.box));
          if (!p) { b = cand; break; }
          cand = place(x, p.box.y0 - N.gap - 0.01);
        }
      }
      if (!b) return;
      out.push(Object.assign({}, n, { x: (b.x0 + b.x1) / 2, y: b.y1 - h / 2, w, h, size, ink, tilt: N.tilt[i % N.tilt.length], box: b }));
    });
    return out;
  }
  /** 一个数字的颜色：伤害 / 大伤害 / 状态字按属性，击破 / 治疗 / 格挡各一种 */
  function colorOf(n) {
    const C = FX.num.colors;
    if (n.kind === "brk") return C.brk;
    if (n.kind === "heal") return C.heal;
    if (n.kind === "block") return C.block;
    return C[n.el] || C.physical;
  }

  /* ---------- 纸片感：压扁 + 地台上的淡影子 ---------- */
  /** 镜头的俯角（弧度）：视线往下斜多少 */
  const elevationOf = (ln) => Math.asin(clamp(ln.back.y, -1, 1));
  /**
   * 打中那一下的纸片感（ln = 这一刻的镜头，rect = 目标铭牌的矩形，适配器给的，带 foot 脚下的点）：
   * { squash 竖直方向乘多少, origin 压扁的中心（打中的那一点）, size 贴纸大小, shadow { x, y 中心（脚下、地台上）, w, h, opacity } }。关掉（FX.paper.on）= null
   */
  function paperOf(ln, rect) {
    const P = FX.paper;
    if (!P.on || !ln || !rect) return null;
    const e = elevationOf(ln);
    const squash = clamp(Math.cos(e), P.squash.min, 1);
    const size = clamp(rect.w * P.size.k, P.size.min, P.size.max);
    const w = size * P.shadow.w, h = w * Math.max(0.05, Math.sin(e)) * P.shadow.flat;
    const foot = rect.foot != null ? rect.foot : rect.top + rect.h;
    return { squash, origin: { x: rect.x, y: rect.y }, size, shadow: { x: rect.x, y: foot, w, h, opacity: P.shadow.opacity } };
  }

  /* ---------- 出手时镜头稍微推一下 ---------- */
  /** 镜头的位置：在 t 后上方 dist 远，俯角 elevation（度）、方位 azimuth（弧度）——和 hd2d-camera.js · posOf 同一个公式 */
  function posOf(t, dist, elevation, azimuth) {
    const e = elevation * D2R, a = azimuth || 0, ce = Math.cos(e);
    return { x: t.x + dist * ce * Math.sin(a), y: t.y + dist * Math.sin(e), z: t.z + dist * ce * Math.cos(a) };
  }
  /**
   * 推一下以后的镜头。pose = 这一刻的镜头（hd2d-camera.js 的 pose / poseFrom：tier、target、dist、elevation、azimuth、fov）；a / b = 攻击者、目标脚下的点。
   * opts：enabled（页面上的开关）、reduced（减少动态效果）、view（画面大小和上下被盖住的像素）、plates（[{ x, y, z, lift, size }]：攻击者和目标的铭牌，推过去也要在画面里）。
   * 不推（关了、减少动态效果、近景、推不进画面）= null；镜头的段、选中的区不变
   */
  function pushPose(pose, a, b, opts) {
    opts = opts || {};
    const P = FX.push;
    if (!P.on || opts.enabled === false || opts.reduced || !pose || !a || !b || !P.tiers.includes(pose.tier)) return null;
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, v = opts.view;
    const fits = (p) => !v || !opts.plates || opts.plates.every(q => {
      const r = rectOf(lens({ pos: p.pos, target: p.target, fov: p.fov, width: v.width, height: v.height }), q, q.size);
      return r && r.left >= 0 && r.right <= v.width && r.top >= (v.top || 0) && r.bottom <= v.height - (v.bottom || 0);
    });
    for (let i = 0; i < P.steps; i++) {
      const k = 1 - i / P.steps;
      const t = { x: pose.target.x + (mid.x - pose.target.x) * P.toward * k, y: pose.target.y, z: pose.target.z + (mid.z - pose.target.z) * P.toward * k };
      const dist = pose.dist * (1 - (1 - P.dist) * k);
      const p = Object.assign({}, pose, { target: t, dist, pos: posOf(t, dist, pose.elevation, pose.azimuth), k: 1 });
      if (fits(p)) return p;
    }
    return null;
  }

  return { FX, lens, rectOf, zoneRect, adapter, cues, placeNumbers, textWidth, sizeOf, colorOf, paperOf, pushPose, posOf };
});
