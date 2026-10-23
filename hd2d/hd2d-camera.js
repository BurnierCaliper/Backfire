/* Antlerscale: Backfire · HD-2D 战场原型 · 三段镜头（纯函数）
 *
 * 远景 / 中景 / 近景看单个区域，玩家自己切（屏幕上的三段按钮、滚轮、键盘 1 / 2 / 3）：
 *   远景 far   就是布局的默认镜头（hd2d-layout.js 的 fitView）：整个战场的沙盘全貌，一个数都不改
 *   中景 mid   镜头拉近、俯角放低一点：框住选中的区，再把每个相连的区各框进来一截（share），跟着当前行动单位 / 选中的区
 *   近景 near  只框选中的那一个区（连同放大的铭牌），俯角再低一点（24°，看得清整个区和放大的铭牌；#237 以前是 14°，接近平视、主人嫌低）；
 *              景深焦点落在这个区，别的区糊掉（左右两边的另按横向距离糊）
 * 这里算每一段的镜头摆在哪、朝哪、视野多大、景深焦点和糊的程度、雾跟着挪多少，以及这一段里每块铭牌抬多高（近景放大的铭牌也两两不压住）；
 * 还有段与段之间的过渡（位置、朝向、视野、焦点、景深参数一起插值，缓动）、近景里左右换相邻的区、滚轮一次跳一段。数值都在 CAMERA 里。
 * 不碰 three.js 和 DOM：Node 里 require 来测（tests/hd2d-layout.test.js），浏览器里是全局的 HD2DCamera（在 hd2d-layout.js 之后加载）。
 * 镜头是每个玩家自己的视角：这里只读布局（原型页用联机投影过的战斗状态排的），不写回战斗状态，也不同步给别人。
 *
 *   const to = HD2DCamera.pose(layout, "near", zoneId, { actorId });   // 这一段的镜头：{ tier, zone, zones, target, dist, elevation, fov, pos, dof, fogShift, clip, tilt, plates… }
 *   const tw = HD2DCamera.tween(from, to, { reduced });                // 过渡；reduced = 减少动态效果：不插值，直接切过去
 *   HD2DCamera.at(tw, 秒)                                               // 这一刻的镜头（k = 缓动后的进度 0–1，铭牌的抬高也按它插值）
 *   HD2DCamera.pastFar(s, ±1) / overheadPose(far, { elevation, dist })  // 正式画面（#261）：远景再往外拉转回旧画面；转场时镜头升到 / 降自战场正上方
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./hd2d-layout.js"));
  else root.HD2DCamera = factory(root.HD2DLayout);
})(typeof self !== "undefined" ? self : this, function (L) {
  "use strict";

  /* ---------- 配置（三段镜头的数值都在这里，逻辑里不写死）----------
   * 每一段：
   *   elevation / fov / margin   俯角、视野（度）、取景边距（框住的东西占可用画面的比例）；远景用布局的默认镜头（L.CONFIG.camera），这里不写
   *   share（中景）              每个相连的区框进来多少（× 区的边长：0.5 = 半个区）
   *   dist（中景）               镜头离多远的范围：至少是近景的 near 倍、至多是远景的 far 倍（十字的一条臂只连着一个区，光按框住的范围算会推得和近景差不多近）
   *   pad（近景）                选中的区四周多框进来多少（世界单位）
   *   tilt                       到了这一段以后，玩家左键拖动能转到的俯角范围（度）
   *   clip                       镜头的近裁剪面（近景镜头贴得近，飘到镜头跟前的天气粒子会大得像一团，裁掉）
   *   dof                        景深：aperture 离焦点差 1 个单位糊多少、maxblur 比焦点近的最多糊多少、far 比焦点远的最多糊多少（× 光影主题的 dofFar）；
   *                              lateral：焦点区左右两边（和它差不多远、光按深度糊不掉的相邻区）每横着离开 1 个单位，再当作多差 lateral 个单位的深度去糊，
   *                              pad = 焦点区左右再宽多少以内不算离开（0 = 只按深度糊，远景 / 中景就是这样）
   *   maxLift                    后排铭牌最多抬多高（像素；不写 = 布局的 CONFIG.plate.maxLift）
   *   big                        选中的区的铭牌放大（名字、血条、架势、状态、ATK 都看得清；尺寸在布局的 CONFIG.plate.big）
   *   dim                        别的区的铭牌变淡、糊掉（铭牌是 DOM，后期的景深糊不到它）
   */
  const CAMERA = {
    order: ["far", "mid", "near"],
    far: {
      label: "远", name: "远景",
      tilt: [22, 46], clip: 1,                                  // 以前 hd2d-scene.js 的 CAM.minElev / maxElev
      dof: { aperture: 0.0018, maxblur: 0.014, far: 1, lateral: 0, pad: 0 }   // 以前 hd2d-scene.js 的 DOF
    },
    /* 俯角：远（布局的 30°）> 中 > 近。#237 主人试玩：近景 14° 太低，抬到 24°；中景跟着从 22° 抬到 27° */
    mid: {
      label: "中", name: "中景",
      elevation: 27, fov: 24, margin: 0.92, share: 0.5, dist: { near: 1.6, far: 0.8 },
      tilt: [18, 38], clip: 1.5, maxLift: 160,
      dof: { aperture: 0.0016, maxblur: 0.014, far: 1.2, lateral: 0, pad: 0 }
    },
    near: {
      label: "近", name: "近景",
      elevation: 24, fov: 28, margin: 0.94, pad: 0.25,
      tilt: [16, 34], clip: 2.5, maxLift: 240, big: true, dim: true,
      dof: { aperture: 0.0009, maxblur: 0.016, far: 1.5, lateral: 3, pad: 0.4 }
    },
    /* 特写（#237）：近景里双击一个单位（铭牌或者脚下的站位），镜头推到这个单位面前（看不到别的单位也没关系）；拉远（滚轮往后、按 2 / 1、点远 / 中）就退出，
     * 回到正常的镜头。还算近景这一段（按钮、网址照旧是「近」），只是镜头换成特写的：
     *   dist / elevation / fov   镜头离看的那一点多远、俯角、视野（看的那一点在这个单位脚下往上 lookY，再按铭牌整块居中挪一下）
     *   zoom       这个单位的铭牌在近景放大的那张上再放大多少；别的铭牌变淡，压到它的藏起来
     *   duration / ease   推过去的时长、缓动（减少动态效果时直接切过去）
     *   pick       双击地台上的一点：离它多近的站位算点到了这个单位（世界单位）
     *   tilt / clip / maxLift / dof   到了以后拖动的俯角范围、近裁剪面、别的铭牌最多抬多高、景深（焦点在这个单位，前后都糊得厉害一点） */
    close: {
      label: "特", name: "特写",
      dist: 6, elevation: 20, fov: 26, lookY: 0.9, zoom: 1.4,
      duration: 0.6, ease: "inOutCubic", pick: 0.9,
      tilt: [12, 32], clip: 1, maxLift: 200,
      dof: { aperture: 0.0024, maxblur: 0.018, far: 1.6, lateral: 0, pad: 0 }
    },
    /* 段与段之间的过渡：时长（秒，0.4–0.6）、缓动（EASE 里的名字）。减少动态效果时不插值，直接切过去 */
    transition: { duration: 0.5, ease: "inOutCubic" },
    /* 滚轮：一次滚动（两下之间停顿不到 idle 秒算同一次）只跳一段；攒够 step 像素才跳（触控板一下只给一点点）。
     * 往前滚拉近（远 → 中 → 近）；按行 / 按页给的 deltaY 换成像素：× line / × page */
    wheel: { step: 40, idle: 0.22, line: 40, page: 800 },
    /* 触屏双指：两根手指的距离比按下时变了 ratio 那么多（张开到 1 + ratio 倍 / 捏到 1 / (1 + ratio)）算一下，和滚轮一样一次手势只跳一段：
     * 张开拉近、捏小拉远（#261：正式画面里远景再捏小 = 转回旧画面） */
    pinch: { ratio: 0.2 },
    /* 键盘：1 / 2 / 3 切远 / 中 / 近；中景 / 近景里左右键换相邻的区 */
    keys: { far: "1", mid: "2", near: "3", prev: "ArrowLeft", next: "ArrowRight" }
  };
  /** 缓动：进出都慢（起步和停下都没有突变，不晃） */
  const EASE = {
    linear: t => t,
    inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2
  };
  /** 区上的场地 → 镜头条上写的字（和规则 app.js · fieldTags 的叫法一样） */
  const ZONE_TAGS = { abyss: "深渊", acid: "酸液", quicksand: "流沙", coral: "沙珊瑚台地", highland: "高地", fire: "火场", ice: "冻土", electric: "高压", energy: "能量场", harmonic: "干涉", heal: "治愈" };

  const D2R = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;

  /* ---------- 段 ---------- */
  function tierName(t) { return CAMERA.order.includes(t) ? t : "far"; }
  /** 往近（dir > 0）/ 往远（dir < 0）跳一段；到头就停在那一段 */
  function stepTier(t, dir) {
    const i = CAMERA.order.indexOf(tierName(t));
    return CAMERA.order[clamp(i + Math.sign(Number(dir) || 0), 0, CAMERA.order.length - 1)];
  }

  /* ---------- 区 ---------- */
  const zoneOf = (layout, id) => layout.zones.find(z => z.id === Number(id)) || null;
  /** 左右换区的顺序：从后排（画面上方）到前排，同一排从左到右（直排就是 1、2、3……；2×2 是 1 → 2 → 3 → 4；十字 1 → 2 → 3 → 4 → 5） */
  function zoneOrder(layout) {
    const half = (L.CONFIG.zoneSize + L.CONFIG.zoneGap) / 2;
    return layout.zones.map(z => ({ id: z.id, row: Math.round(z.cz / half), x: z.cx }))
      .sort((a, b) => a.row - b.row || a.x - b.x).map(z => z.id);
  }
  /** 换到相邻的区：dir < 0 前一个（左键），dir > 0 后一个（右键）；到头了是 null */
  function neighborZone(layout, id, dir) {
    const o = zoneOrder(layout), i = o.indexOf(Number(id));
    if (i < 0) return null;
    const j = i + (dir < 0 ? -1 : 1);
    return j >= 0 && j < o.length ? o[j] : null;
  }
  /** 选中的区：给的认得就用它；不然是当前行动单位所在的区，再不然是我方第一个人的区 */
  function focusZone(layout, want, actorId) {
    if (want != null && zoneOf(layout, want)) return Number(want);
    const a = actorId != null ? layout.units.find(u => u.id === actorId) : null;
    if (a) return a.zone;
    const p = layout.units.find(u => u.side === "player");
    return p ? p.zone : (layout.zones[0] ? layout.zones[0].id : null);
  }
  /** 和这个区相连的区（棋盘的连接，就是布局的间隔） */
  function linkedZones(layout, id) {
    return layout.gaps.filter(g => g.a === id || g.b === id).map(g => (g.a === id ? g.b : g.a));
  }
  /** 镜头条上写的：「2 区 · 酸液」 */
  function zoneTag(layout, id) {
    const z = zoneOf(layout, id);
    if (!z) return "";
    const tags = z.effects.map(e => ZONE_TAGS[e]).filter(Boolean);
    return z.id + " 区" + (tags.length ? " · " + tags.join(" · ") : "");
  }

  /* ---------- 取景 ---------- */
  /** 这一段要框住的范围：远景 = 整个战场；近景 = 选中的区（四周多 pad）；中景 = 选中的区 + 每个相连的区各框进来 share 那么多（从挨着的那条边量） */
  function windowOf(layout, tier, id) {
    tier = tierName(tier);
    const z = zoneOf(layout, id);
    if (tier === "far" || !z) return { box: Object.assign({}, layout.bounds), zones: layout.zones.map(q => q.id) };
    const T = CAMERA[tier], pad = tier === "near" ? T.pad : 0;
    const box = { minX: z.cx - z.w / 2 - pad, maxX: z.cx + z.w / 2 + pad, minZ: z.cz - z.d / 2 - pad, maxZ: z.cz + z.d / 2 + pad };
    const zones = [z.id];
    if (tier === "mid") linkedZones(layout, z.id).forEach(nid => {
      const n = zoneOf(layout, nid);
      if (!n) return;
      zones.push(n.id);
      const dx = n.cx - z.cx, dz = n.cz - z.cz;
      if (Math.abs(dx) >= Math.abs(dz)) {
        if (dx > 0) box.maxX = Math.max(box.maxX, n.cx - n.w / 2 + T.share * n.w);
        else box.minX = Math.min(box.minX, n.cx + n.w / 2 - T.share * n.w);
      } else if (dz > 0) box.maxZ = Math.max(box.maxZ, n.cz - n.d / 2 + T.share * n.d);
      else box.minZ = Math.min(box.minZ, n.cz + n.d / 2 - T.share * n.d);
    });
    box.maxY = Math.max(...zones.map(i => zoneOf(layout, i).topY));
    return { box, zones };
  }
  /** 中景 / 近景的镜头：让框住的范围和选中那个区的铭牌（按这一段的大小、抬高）刚好装进四边被界面盖住之后剩下的那一块（左右没盖住时和以前一样）。
   *  和布局的 fitView 同一个迭代（先居中，再按超出 / 留空的比例推拉），只是把铭牌也算进去：铭牌是固定像素大小的，镜头推近它不跟着变大。
   *  range = [最近, 最远]（镜头到看的那一点的距离） */
  function frame(layout, win, T, focus, sizeOf, range) {
    const view = layout.view, W = view.width, H = view.height, aspect = W / H;
    const lo = -1 + 2 * view.bottom / H, hi = 1 - 2 * view.top / H;
    const lx = -1 + 2 * (view.left || 0) / W, hx = 1 - 2 * (view.right || 0) / W;
    const b = win.box, pts = [];
    [b.minX, b.maxX].forEach(x => [0, b.maxY].forEach(y => [b.minZ, b.maxZ].forEach(z => pts.push({ x, y, z }))));
    const mine = layout.units.filter(u => u.zone === focus);
    const t = { x: (b.minX + b.maxX) / 2, y: L.CONFIG.camera.targetY, z: (b.minZ + b.maxZ) / 2 };
    let dist = clamp(layout.camera.dist * 0.5, range[0], range[1]);
    const camOf = () => Object.assign(L.camAt(t, dist, aspect, T), { width: W, height: H, view: { top: view.top, bottom: view.bottom, left: view.left || 0, right: view.right || 0 } });
    for (let it = 0; it < 30; it++) {
      const cam = camOf();
      let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      const add = (nx, ny) => { x0 = Math.min(x0, nx); x1 = Math.max(x1, nx); y0 = Math.min(y0, ny); y1 = Math.max(y1, ny); };
      pts.forEach(p => { const n = L.toNdc(cam, p); add(n.x, n.y); });
      if (mine.length) {
        const lifts = L.liftPlates(layout.units, cam, sizeOf, T.maxLift);
        mine.forEach(u => { const r = lifts.get(u.id).rect; add(r.x0 / W * 2 - 1, 1 - r.y1 / H * 2); add(r.x1 / W * 2 - 1, 1 - r.y0 / H * 2); });
      }
      const dy = (lo + hi) / 2 - (y0 + y1) / 2, dx = (lx + hx) / 2 - (x0 + x1) / 2;
      const half = cam.tanHalf * dist, mu = -dy * half, mr = -dx * half * aspect;
      t.x += cam.up.x * mu + cam.right.x * mr; t.y += cam.up.y * mu + cam.right.y * mr; t.z += cam.up.z * mu + cam.right.z * mr;
      const k = Math.max((x1 - x0) / ((hx - lx) * T.margin), (y1 - y0) / ((hi - lo) * T.margin));
      dist = clamp(dist * clamp(k, 0.6, 1.6), range[0], range[1]);
    }
    return camOf();
  }
  /** 白卡（#316，布局给了卡片快照）这一段里每张卡的基础缩放（L.CONFIG.card.tier）：远景 far；中景 mid；近景选中的区放大（near），别的区照中景 */
  function cardBase(tier, u, zone) {
    const K = L.CONFIG.card.tier;
    return tier === "far" ? K.far : CAMERA[tier].big && u.zone === zone ? K.near : K.mid;
  }
  /** 这一段的镜头摆法（远景就是布局的默认镜头）和铭牌的抬高 */
  function lensOf(layout, tier, zone) {
    const T = CAMERA[tier], far = layout.camera.dist;
    const small = layout.plateSize || L.plateSize(layout.view), big = L.plateSize(layout.view, true);
    // 白卡：每个单位按自己的卡片尺寸 × 这一段的基础缩放，抬高的上限也按白卡的（卡高得多）
    const sizeOf = layout.cards ? (u) => L.cardAt(u, cardBase(tier, u, zone)) : (u) => (T.big && u.zone === zone ? big : small);
    const cap = layout.cards ? L.CONFIG.card.maxLift[tier] : T.maxLift;
    let range = [2, far];
    if (tier === "mid") {
      const near = lensOf(layout, "near", zone).cam.dist, top = far * T.dist.far;
      range = [Math.min(near * T.dist.near, top), top];
    }
    const cam = frame(layout, windowOf(layout, tier, zone), Object.assign({}, T, { maxLift: cap }), zone, sizeOf, range);
    return { cam, lifts: L.liftPlates(layout.units, cam, sizeOf, cap) };
  }

  /**
   * 一段镜头。tier = far / mid / near；want = 想看的区（认不得就看当前行动单位所在的区，opts.actorId）。
   * 返回 { tier, zone 选中的区, zones 这一段框住的区, target, dist, elevation, azimuth, fov, pos, cam（投影用，和布局的镜头同一种）,
   *        clip 近裁剪面, tilt 拖动的俯角范围, dof { shift 焦点比镜头到 target 远多少, aperture, maxblur, far, lateral, half, cx / cy / cz 焦点区中心 },
   *        fogShift 起雾的地方挪近多少,
   *        plates { 单位 id: { lift 抬高的像素, rect 屏幕矩形, big 放大, dim 变淡糊掉 } }, k: 1 }
   * 远景就是布局的默认镜头和布局排好的抬高，景深 / 雾和以前一样（shift、fogShift 都是 0）
   */
  function pose(layout, tier, want, opts) {
    tier = tierName(tier); opts = opts || {};
    const T = CAMERA[tier], zone = focusZone(layout, want, opts.actorId), z = zoneOf(layout, zone);
    const win = windowOf(layout, tier, zone);
    const scripted = tier !== "far" && !!z;
    const lens = scripted ? lensOf(layout, tier, zone) : { cam: layout.camera, lifts: new Map(layout.units.map(u => [u.id, { lift: u.lift, rect: u.rect }])) };
    const cam = lens.cam, plates = {};
    layout.units.forEach(u => {
      const r = lens.lifts.get(u.id);
      plates[u.id] = { lift: r.lift, rect: r.rect, big: !!T.big && u.zone === zone, dim: !!T.dim && u.zone !== zone };
      if (layout.cards) plates[u.id].scale = cardBase(tier, u, zone);   // 白卡：这一段的基础缩放（场景每帧按 L.cardScale 再乘远近）
    });
    // 沿视线离镜头多远（景深、雾都按这个量）
    const depth = (c, p) => (c.pos.x - p.x) * c.back.x + (c.pos.y - p.y) * c.back.y + (c.pos.z - p.z) * c.back.z;
    // 景深焦点：远景照旧是镜头看的那一点（战场中间）；中景 / 近景对准选中的区的中心（近景再按横着离开它多远糊左右两边）
    const center = scripted ? { x: z.cx, y: z.topY, z: z.cz } : cam.target;
    const focusAt = scripted ? depth(cam, center) : cam.dist;
    // 雾：以前按默认镜头到战场后沿的距离起雾；镜头推近了，起雾的地方跟着挪近同样多（远景挪 0，和以前一样）
    const back = (c) => depth(c, { x: c.target.x, y: 0, z: layout.bounds.minZ });
    const fogShift = scripted ? back(cam) - back(layout.camera) : 0;
    return {
      tier, zone, zones: win.zones,
      target: { x: cam.target.x, y: cam.target.y, z: cam.target.z }, dist: cam.dist, elevation: cam.elevation, azimuth: 0, fov: cam.fov,
      pos: { x: cam.pos.x, y: cam.pos.y, z: cam.pos.z }, cam,
      clip: T.clip, tilt: T.tilt.slice(),
      dof: {
        shift: focusAt - cam.dist, aperture: T.dof.aperture, maxblur: T.dof.maxblur, far: T.dof.far,
        lateral: scripted ? T.dof.lateral : 0, half: (z ? z.w / 2 : 0) + T.dof.pad, cx: center.x, cy: center.y, cz: center.z
      },
      fogShift, plates, k: 1
    };
  }
  /** 一个点在这一段镜头里糊多少（和场景后期的景深同一个算法，hd2d-scene.js 里改过的 BokehShader：离焦点差多少 × aperture，
   *  焦点区左右两边再按横着离开多远加一截（lateral），近的最多 maxblur、远的最多 dofFar × far；单位是画面的比例）。
   *  dofFar = 光影主题的远处上限（hd2d-scene.js 的 THEMES[].dofFar） */
  function blurAt(p, point, dofFar) {
    const c = p.cam, D = p.dof;
    const depth = (q) => (c.pos.x - q.x) * c.back.x + (c.pos.y - q.y) * c.back.y + (c.pos.z - q.z) * c.back.z;
    const side = (q) => (q.x - c.pos.x) * c.right.x + (q.y - c.pos.y) * c.right.y + (q.z - c.pos.z) * c.right.z;   // 镜头空间的横坐标
    let f = (p.dist + D.shift) - depth(point);   // > 0：比焦点近
    const lat = Math.max(0, Math.abs(side(point) - side({ x: D.cx, y: D.cy, z: D.cz })) - D.half) * D.lateral;
    f += f >= 0 ? lat : -lat;
    return f >= 0 ? Math.min(f * D.aperture, D.maxblur) : Math.min(-f * D.aperture, dofFar * D.far);
  }

  /* ---------- 特写（#237：近景里双击一个单位）---------- */
  /** 特写的镜头：距离固定（CAMERA.close.dist），看的那一点从脚下往上 lookY 出发，再挪到「脚下 + 放大的铭牌」整块在四边的界面之间居中
   *  （上下：顶栏和技能栏之间；左右：#339 纸片画面左上角的队伍、右边的抽屉之间，没盖住时左右不挪，和以前一样） */
  function closeLens(layout, u, size) {
    const T = CAMERA.close, view = layout.view, W = view.width, H = view.height, aspect = W / H;
    const lo = -1 + 2 * view.bottom / H, hi = 1 - 2 * view.top / H;
    const lx = -1 + 2 * (view.left || 0) / W, hx = 1 - 2 * (view.right || 0) / W;
    const t = { x: u.x, y: u.y + T.lookY, z: u.z };
    const camOf = () => Object.assign(L.camAt(t, T.dist, aspect, T), { width: W, height: H, view: { top: view.top, bottom: view.bottom, left: view.left || 0, right: view.right || 0 } });
    for (let it = 0; it < 12; it++) {
      const cam = camOf(), r = L.plateRect(cam, size, u, 0);
      const top = 1 - 2 * r.y0 / H, bottom = 1 - 2 * r.y1 / H;          // 铭牌的上沿、脚下（NDC，y 向上）
      const left = r.x0 / W * 2 - 1, right = r.x1 / W * 2 - 1;          // 铭牌的左右（NDC）
      const dy = (lo + hi) / 2 - (top + bottom) / 2, mu = -dy * cam.tanHalf * T.dist;
      const dx = (view.left || view.right) ? (lx + hx) / 2 - (left + right) / 2 : 0, mr = -dx * cam.tanHalf * T.dist * aspect;
      if (Math.abs(dy) < 1e-5 && Math.abs(dx) < 1e-5) break;
      t.x += cam.up.x * mu + cam.right.x * mr; t.y += cam.up.y * mu + cam.right.y * mr; t.z += cam.up.z * mu + cam.right.z * mr;
    }
    return camOf();
  }
  /**
   * 特写一个单位的镜头（id = 布局里的单位；没有这个单位 = null）。和 pose 返回的一样（还算近景：tier = "near"），多一个 close = 这个单位的 id。
   * 铭牌：这个单位的放大铭牌再乘 zoom、不抬高（立在脚下）、在最上面；别的铭牌变淡（dim），压到它的藏起来（hide），别的铭牌之间照常抬高不互相压住
   */
  function closePose(layout, id, opts) {
    const u = layout.units.find(x => x.id === id);
    if (!u) return null;
    const T = CAMERA.close, card = !!layout.cards, P = card ? L.CONFIG.card : L.CONFIG.plate, zone = u.zone, z = zoneOf(layout, zone);
    const small = layout.plateSize || L.plateSize(layout.view), big = L.plateSize(layout.view, true);
    // 白卡（#316）：这个单位的卡按近景放大的再乘 zoom，别的卡按近景（选中的区放大、别的区照中景）
    const K = L.CONFIG.card.tier, base = (x) => (x.zone === zone ? K.near : K.mid);
    const mine = card ? L.cardAt(u, K.near * T.zoom) : { w: big.w * T.zoom, h: big.h * T.zoom };
    const cam = closeLens(layout, u, mine);
    const others = layout.units.filter(x => x.id !== id);
    const lifts = card ? L.liftPlates(others, cam, (x) => L.cardAt(x, base(x)), L.CONFIG.card.maxLift.close) : L.liftPlates(others, cam, (x) => (x.zone === zone ? big : small), T.maxLift);
    const self = L.plateRect(cam, mine, u, 0), plates = {};
    others.forEach(x => {
      const r = lifts.get(x.id).rect;
      const hide = r.x0 < self.x1 + P.gapX && self.x0 < r.x1 + P.gapX && r.y0 < self.y1 + P.gapY && self.y0 < r.y1 + P.gapY;
      plates[x.id] = { lift: lifts.get(x.id).lift, rect: r, big: x.zone === zone, dim: true, hide, close: false, zoom: 1 };
      if (card) plates[x.id].scale = base(x);
    });
    plates[id] = { lift: 0, rect: self, big: true, dim: false, hide: false, close: true, zoom: T.zoom };
    if (card) plates[id].scale = K.near * T.zoom;   // 白卡：放大已经算进这一段的基础缩放里（场景不再另乘 zoom）
    const depth = (c, p) => (c.pos.x - p.x) * c.back.x + (c.pos.y - p.y) * c.back.y + (c.pos.z - p.z) * c.back.z;
    const back = (c) => depth(c, { x: c.target.x, y: 0, z: layout.bounds.minZ });
    const center = { x: u.x, y: u.y, z: u.z };
    return {
      tier: "near", close: id, zone, zones: [zone],
      target: { x: cam.target.x, y: cam.target.y, z: cam.target.z }, dist: cam.dist, elevation: cam.elevation, azimuth: 0, fov: cam.fov,
      pos: { x: cam.pos.x, y: cam.pos.y, z: cam.pos.z }, cam, clip: T.clip, tilt: T.tilt.slice(),
      dof: { shift: depth(cam, center) - cam.dist, aperture: T.dof.aperture, maxblur: T.dof.maxblur, far: T.dof.far, lateral: 0, half: (z ? z.w / 2 : 0) + T.dof.pad, cx: center.x, cy: center.y, cz: center.z },
      fogShift: back(cam) - back(layout.camera), plates, k: 1
    };
  }
  /** 双击地台顶面上的一点（世界坐标 x / z，zone 区的地台上）：离它最近、在 CAMERA.close.pick 以内的那个单位的 id（脚下的站位）；没有 = null */
  function unitAt(layout, zone, x, z) {
    let best = null, bd = CAMERA.close.pick;
    layout.units.forEach(u => {
      if (u.zone !== Number(zone)) return;
      const d = Math.hypot(u.x - x, u.z - z);
      if (d <= bd) { bd = d; best = u.id; }
    });
    return best;
  }
  /**
   * 镜头的状态机（纯函数，不改传进来的）：s = { tier: far / mid / near, zone, close（特写的单位 id，null = 没在特写）}，ev = 发生了什么：
   *   { type: "dblclick", unit, zone }  双击一个单位（铭牌或者脚下的站位）：近景里（包括已经在特写）→ 特写它；远景 / 中景里不特写
   *   { type: "tier", tier }            按钮 / 键盘 1·2·3 换段：退出特写（按 3、点「近」= 回到正常的近景）
   *   { type: "wheel", step }           滚轮：往后（step < 0）——特写时回到正常的近景，没在特写就往远跳一段；往前（step > 0）——特写时不动，没在特写就往近跳一段
   *   { type: "zone", zone }            选了别的区（点地台、左右换区、当前行动单位到了别的区）：退出特写；还是同一个区就不动
   *   { type: "units", ids }            重排了（ids = 画面上还有的单位）：特写的单位不在了（被打倒、藏起来）就退出特写
   * 返回新的状态
   */
  function camStep(s, ev) {
    s = { tier: tierName(s && s.tier), zone: s && s.zone != null ? s.zone : null, close: s && s.close != null ? s.close : null };
    if (!ev) return s;
    if (ev.type === "dblclick") return s.tier === "near" && ev.unit != null ? { tier: "near", zone: ev.zone != null ? Number(ev.zone) : s.zone, close: ev.unit } : s;
    if (ev.type === "tier") return { tier: tierName(ev.tier), zone: s.zone, close: null };
    if (ev.type === "wheel") {
      if (!ev.step) return s;
      if (s.close != null) return ev.step < 0 ? { tier: "near", zone: s.zone, close: null } : s;
      return { tier: stepTier(s.tier, ev.step), zone: s.zone, close: null };
    }
    if (ev.type === "zone") return ev.zone == null || Number(ev.zone) === s.zone ? s : { tier: s.tier, zone: Number(ev.zone), close: null };
    if (ev.type === "units") return s.close != null && !(ev.ids || []).includes(s.close) ? { tier: s.tier, zone: s.zone, close: null } : s;
    return s;
  }
  /** 远景到头了还往外拉（滚轮往后 / 双指捏小，step < 0，一次手势一下；没在特写）：camStep 拉不动了，正式画面拿它转回旧画面（hd2d-field.js，#261）。
   *  中景 / 近景往外拉照旧只换段，不算 */
  function pastFar(s, step) {
    return Number(step) < 0 && tierName(s && s.tier) === "far" && !(s && s.close != null);
  }

  /* ---------- 过渡 ---------- */
  /** 镜头的位置：在 target 后上方 dist 远，俯角 elevation（度）、方位 azimuth（弧度，0 = 正对 −z 看，和 OrbitControls 的 theta 一样） */
  function posOf(t, dist, elevation, azimuth) {
    const e = elevation * D2R, a = azimuth || 0, ce = Math.cos(e);
    return { x: t.x + dist * ce * Math.sin(a), y: t.y + dist * Math.sin(e), z: t.z + dist * ce * Math.cos(a) };
  }
  /** 镜头现在实际在哪（玩家可能拖动过）→ 过渡的起点：位置、朝向按镜头和它看的那一点算，景深 / 雾 / 裁剪面接着上一次的（base） */
  function poseFrom(pos, target, fov, base) {
    const dx = pos.x - target.x, dy = pos.y - target.y, dz = pos.z - target.z, dist = Math.hypot(dx, dy, dz) || 1e-6;
    return Object.assign({}, base, {
      target: { x: target.x, y: target.y, z: target.z }, dist,
      elevation: Math.asin(clamp(dy / dist, -1, 1)) / D2R, azimuth: Math.atan2(dx, dz), fov,
      pos: { x: pos.x, y: pos.y, z: pos.z }, k: 0
    });
  }
  /** 两个镜头之间插值（k = 0 是 a，1 是 b）：看的那一点直线走，距离按比例走（推拉的速度看起来均匀），俯角 / 方位 / 视野 / 景深 / 雾 / 裁剪面线性。
   *  段、选中的区、铭牌这些照终点的 */
  function lerpPose(a, b, k) {
    const target = { x: lerp(a.target.x, b.target.x, k), y: lerp(a.target.y, b.target.y, k), z: lerp(a.target.z, b.target.z, k) };
    const dist = a.dist > 0 && b.dist > 0 ? a.dist * Math.pow(b.dist / a.dist, k) : lerp(a.dist, b.dist, k);
    const elevation = lerp(a.elevation, b.elevation, k), azimuth = lerp(a.azimuth || 0, b.azimuth || 0, k), fov = lerp(a.fov, b.fov, k);
    const from = a.dof || b.dof, dof = {};
    Object.keys(b.dof).forEach(key => { dof[key] = lerp(Number.isFinite(from[key]) ? from[key] : b.dof[key], b.dof[key], k); });
    return Object.assign({}, b, {
      target, dist, elevation, azimuth, fov, pos: posOf(target, dist, elevation, azimuth), dof, k,
      clip: lerp(Number.isFinite(a.clip) ? a.clip : b.clip, b.clip, k), fogShift: lerp(a.fogShift || 0, b.fogShift || 0, k)
    });
  }
  /** 从 from 过渡到 to：duration 秒，按 CAMERA.transition 的缓动（推到特写用 CAMERA.close 的）；reduced（减少动态效果）时 duration = 0，不插值，直接切过去 */
  function tween(from, to, opts) {
    const T = to && to.close != null ? CAMERA.close : CAMERA.transition;
    return { from, to, duration: opts && opts.reduced ? 0 : T.duration, ease: T.ease };
  }
  /** 过渡开始后 t 秒的镜头 */
  function at(tw, t) {
    if (!(tw.duration > 0) || t >= tw.duration) return Object.assign({}, tw.to, { k: 1 });
    const k = (EASE[tw.ease] || EASE.linear)(clamp(t / tw.duration, 0, 1));
    return lerpPose(tw.from, tw.to, k);
  }
  /** 战场正上方往下看的镜头（新旧画面之间的转场，#261：新 → 旧时镜头升到这里，旧 → 新时从这里降回远景）：
   *  看的那一点、视野、景深照远景的（far = pose(layout, "far")），俯角抬到 o.elevation（度；正 90 度时朝向算不出来，最多 89.5）、离远 o.dist 倍；
   *  起雾的地方跟着往后挪多出来的那一截（不然离远了战场会蒙上雾）。数值在 hd2d-field.js 的 MIST.rise */
  function overheadPose(far, o) {
    o = o || {};
    const elevation = clamp(Number(o.elevation) || 0, 0, 89.5), dist = far.dist * (o.dist > 0 ? o.dist : 1);
    const target = { x: far.target.x, y: far.target.y, z: far.target.z };
    return Object.assign({}, far, { target, dist, elevation, azimuth: 0, pos: posOf(target, dist, elevation, 0), fogShift: (far.fogShift || 0) + dist - far.dist, k: 1 });
  }

  /* ---------- 滚轮 ---------- */
  /** 滚轮在三段之间跳：一次滚动只跳一段。s = 上一次返回的 state（第一次给 null），deltaY 像素（往前滚是负的），now 秒。
   *  返回 { step: 1 拉近 / −1 拉远 / 0 不跳, state } */
  function wheelStep(s, deltaY, now) {
    const W = CAMERA.wheel, fresh = !s || now - s.last > W.idle;
    const st = { acc: (fresh ? 0 : s.acc) + (Number(deltaY) || 0), last: now, done: fresh ? false : s.done };
    let step = 0;
    if (!st.done && Math.abs(st.acc) >= W.step) { step = st.acc < 0 ? 1 : -1; st.done = true; }
    return { step, state: st };
  }
  /** 滚轮事件的 deltaY 换成像素（有的浏览器按行、按页给） */
  function wheelPixels(e) {
    const W = CAMERA.wheel;
    return (Number(e.deltaY) || 0) * (e.deltaMode === 1 ? W.line : e.deltaMode === 2 ? W.page : 1);
  }
  /** 触屏双指：ratio = 两根手指现在的距离 ÷ 按下时的距离。张开够了 1 拉近、捏小够了 −1 拉远、不够 0（一次手势只算一下由场景管） */
  function pinchStep(ratio) {
    const r = Number(ratio), P = CAMERA.pinch.ratio;
    if (!(r > 0)) return 0;
    return r >= 1 + P ? 1 : r <= 1 / (1 + P) ? -1 : 0;
  }

  return {
    CAMERA, EASE, ZONE_TAGS, tierName, stepTier, zoneOrder, neighborZone, focusZone, linkedZones, zoneTag, windowOf, pose, blurAt,
    closePose, unitAt, camStep, pastFar, posOf, poseFrom, lerpPose, tween, at, overheadPose, wheelStep, wheelPixels, pinchStep
  };
});
