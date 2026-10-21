/* Antlerscale: Backfire · HD-2D 战场原型 · 区域场景的美术包：三个采矿场（#242）
 *
 * 主人试玩反馈 · 五：第一采矿场分矿外 / 矿内 / 矿底三个场景；第二采矿场是它的变体（更红，时不时喷火的管道、橙红发光的岩石）；
 * 第三采矿场的矿坑浅（只有矿外 / 矿底：深色的坑里到处是紫色晶体、背景半截埋在地里发紫光的大陨石、时不时跳紫色电弧）。
 * 每个场景一套：地面（顶面贴图）、地台侧面、地台上的装饰、远景、光照 / 调色、环境动画；数值都在下面的配置表里。
 * 怎么接进画面见 hd2d-scene-art.js（登记处）：这里不 import three.js，three.js 和画贴图 / 拼几何体的小工具由挂钩那边打包成 kit 传进来。
 *
 *   矿外 rim：站在矿坑边上的砂岩地上。战场后面是一个往下的巨大矿坑——地台外面那片地铺到坑边为止（远景给 groundEdge），坑边一排碎石和栏杆；
 *            对面的坑壁一级级台阶往下，越往下越黑、雾越重，看不到底；坑壁上零星几盏灯（偶尔闪一下），两条斜井里的矿车时不时上下，
 *            坑边的吊架吊着一个罐笼上下；对面坑沿上远远的矿井架、筒仓、烟囱，再往后是天边的厂区
 *
 * 地台上的装饰只摆在左右两条边带和左右矮一截的台子上（站位区以外，见 hd2d-scene-art.js · zoneSpots），不压住站位、铭牌；
 * 战场周围的东西都在战场范围外面（后面先让开灯）。只读布局给的地台 / 战场范围，不碰单位数据（没有坚毅生命）。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./hd2d-layout.js"), require("./hd2d-scene-art.js"));
  else root.HD2DScenesMine = factory(root.HD2DLayout, root.HD2DSceneArt);
})(typeof self !== "undefined" ? self : this, function (L, A) {
  "use strict";

  /* ---------- 配置 ---------- */
  /** 各采矿场的色调：rock 坑壁 / 石头的几层颜色（一级级台阶轮着用）、dark 坑底的黑（带一点雾的颜色）、metal 钢架 / 栏杆、lamp 工作灯 */
  const PALETTE = {
    mine1: { rock: [0xc39363, 0xa9784c, 0xd2a571, 0x9b6c45, 0xb88654], dark: 0x0d0b0a, metal: 0x5d4636, lamp: 0xffc46e }
  };
  /** 矿坑（矿外）：
   *   rim       坑边在灯后面再往后多远（地台外面那片地铺到这里为止）
   *   far       对面坑沿（第一级台阶的边）离天幕多远；top 对面坑沿多高；back 坑沿上那片平地往后铺到天幕前多远
   *   step / run / benches   每一级台阶多高、往前伸多少、一共几级（看得到的大约是上面七八级，再往下被这边的坑沿挡住、也全黑了）
   *   road      哪几级是宽的运输道（台面宽 roadRun 倍）
   *   seg / jitter   横着分几段、每段的台阶边随机歪多少（斜井那一段不歪）
   *   dark      从第几级开始变黑、到第几级全黑（往 PALETTE.dark 靠）；haze 最上面那级往天边的雾色靠多少（越往下越少）
   *   bottom    最后一级一直往下到多深 */
  const PIT = {
    rim: { rim: 1.4, far: 1.6, top: 0.55, back: 0.9, step: 0.32, run: 0.17, benches: 28, road: [4, 9], roadRun: 2.6, seg: 48, jitter: 0.05, dark: [3, 12], haze: 0.35, bottom: -14 }
  };
  /** 环境动画的频率（秒）。减少动态效果时都停住：矿车、罐笼停在原地，灯不闪
   *   skip    斜井里的矿车：每次停多久、走多快（每秒走井道全长的几成）、停在哪几处（0 = 坑沿，1 = 井底，越往下越黑）
   *   cage    坑边吊架上的罐笼：同上（0 = 吊臂下面，1 = 坑里的黑里）
   *   blink   坑壁上的灯：隔多久暗一下、每次暗多久 */
  const AMBIENT = {
    skip: { wait: [2.5, 7], speed: [0.08, 0.16], stops: [0, 0.35, 0.7, 1] },
    cage: { wait: [3, 8], speed: [0.1, 0.2], stops: [0, 0.45, 1] },
    blink: { every: [1.2, 4.5], dur: [0.08, 0.3] }
  };
  /** 每个场景（键 = 地面主题）：
   *   palette / depth（rim 矿外）/ pit（PIT 的哪一套）
   *   decor     地台上的装饰：band 左右边带上几个、ledge 台子上几个、size 半径范围
   *   backdrop  远景：lights 坑壁上几盏灯（blink 几成会闪）、skips 斜井在哪（× 战场半宽 + 6，从中间往左右）、gantry 坑边吊架（−1 左 / 1 右 / 0 没有）、
   *             rail 坑边栏杆、farRim 对面坑沿上的矿井架 / 筒仓 / 烟囱
   *   ambient   有哪些环境动画（AMBIENT 的键）
   *   light     光照 / 调色（写法见 hd2d-scene-art.js · lighting） */
  const ART = {
    mine1_rim: {
      palette: "mine1", depth: "rim", pit: "rim",
      decor: { band: 3, ledge: 2, size: [0.1, 0.17] },
      backdrop: { lights: 14, blink: 0.45, skips: [-0.62, 0.38], gantry: -1, rail: true, farRim: true },
      ambient: ["skip", "cage", "blink"],
      light: { all: { tint: { fog: [0xc29466, 0.15], hemiGround: [0x8c6642, 0.3] } } }
    }
  };
  /** 地面主题（并进布局的 GROUNDS，写法同 hd2d-layout.js 的 GROUNDS）：顶面 / 侧面贴图是这里画的（art 开头），backdrop 指回这一套 */
  const GROUNDS = {
    mine1_rim: {   // 第一采矿场 · 矿外：砂岩地（一块块砂岩板、层理细纹），侧面砂岩层；地台外面是砂岩色的地；一盏矿灯
      tex: "artSandstone", tint: 0xffffff, side: "artSandstoneSide", decals: { crack: 2, gravel: 2, artSandDrift: 3 },
      pebbles: 14, pebble: 0xa98560, rock: 0x9c7752, decor: "art", ground: 0xa27c55, backdrop: "mine1_rim",
      lamps: { kind: "hanging", color: 0xffc46e, day: 1, dusk: 1, night: 1 }
    }
  };
  /** 区域 → 场景 id（world-data.js · BATTLE_SCENES）→ 地面主题 */
  const SCENES = {
    "第一采矿场": { rim: "mine1_rim" }
  };

  /* ---------- 小工具 ---------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  /** 字符串 → 种子（同一个场景每次一样） */
  const seedOf = (s) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 100003; };
  const named = (t, name) => { t.name = name; return t; };
  /** 一块低多边形的石头：二十面体的每个顶点沿半径随机往里收一点（同一个位置的顶点一起动，面不裂开；不超出 rad），再压扁一点 */
  function rockGeo(kit, rad, r, squash) {
    const geo = new kit.THREE.IcosahedronGeometry(rad, 0), p = geo.attributes.position, seen = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = p.getX(i).toFixed(3) + "," + p.getY(i).toFixed(3) + "," + p.getZ(i).toFixed(3);
      if (!seen.has(key)) seen.set(key, 0.68 + r() * 0.32);
      const k = seen.get(key);
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * (squash || 1), p.getZ(i) * k);
    }
    geo.computeVertexNormals();
    return geo;
  }
  /** 战场范围（远景的 env 给的是中心和半宽） */
  const boundsOf = (env) => ({ minX: env.cx - env.hx, maxX: env.cx + env.hx, minZ: env.cz - env.hz, maxZ: env.cz + env.hz });
  /** 关掉阴影、打上标签（测试按 userData.art 认是什么） */
  function tag(o, what) {
    o.userData.art = what;
    o.traverse(m => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
    return o;
  }

  /* ---------- 贴图（canvas 程序贴图，没有图片文件）---------- */
  /** 一张美术包的贴图：kit.canvasTex 画（按名字缓存），贴图的 name 就是它在包里的名字（测试按它认） */
  const paint = (name, size, draw, opt) => (kit) => named(kit.canvasTex("art-" + name, size, (g, s, r) => draw(g, s, r, kit), opt), name);
  const TEXTURES = {
    /** 砂岩地（矿外）：一行行砂岩板（高低、宽窄不一，接缝在贴图边上首尾相接），每块颜色略不同、带交错层理的细纹，接缝里积着沙，零星的裂缝和碎石 */
    artSandstone: paint("artSandstone", 256, (g, s, r, kit) => {
      const hues = ["#c39465", "#b88859", "#cfa173", "#ad7d50", "#c99a69", "#b48356", "#d6ab7c"];
      g.fillStyle = hues[0]; g.fillRect(0, 0, s, s);
      const joints = [];
      for (let y = 0; y < s;) {
        let h = 40 + Math.floor(r() * 42);
        if (s - y - h < 34) h = s - y;
        let x = Math.floor(r() * 60);
        const x0 = x;
        while (x < x0 + s) {
          let w = 52 + Math.floor(r() * 64);
          if (x0 + s - x - w < 36) w = x0 + s - x;
          const col = hues[Math.floor(r() * hues.length)], ang = (r() - 0.5) * 0.7, layers = 3 + Math.floor(r() * 5);
          [0, -s].forEach(dx => {   // 跨过右边的那一截绕回左边画
            g.save(); g.beginPath(); g.rect(x + dx, y, w, h); g.clip();
            g.fillStyle = col; g.fillRect(x + dx, y, w, h);
            g.strokeStyle = "rgba(110,70,36,.22)"; g.lineWidth = 1;
            for (let k = 0; k < layers; k++) {   // 交错层理：斜着的几道细纹
              const yy = y + (k + 0.5) * h / layers;
              g.beginPath(); g.moveTo(x + dx, yy); g.lineTo(x + dx + w, yy + Math.tan(ang) * w); g.stroke();
            }
            g.fillStyle = r() < 0.5 ? "rgba(255,236,200,.07)" : "rgba(60,34,16,.07)"; g.fillRect(x + dx, y, w, h);
            g.restore();
          });
          joints.push([x % s, y, h]);
          x += w;
        }
        joints.push([null, y, 0]);
        y += h;
      }
      kit.speckle(g, s, r, 2200, "rgba(255,240,214,.16)", "rgba(80,48,22,.18)");
      g.strokeStyle = "rgba(48,28,14,.55)"; g.lineWidth = 2.5;   // 接缝（横的一整行、竖的一块块）
      joints.forEach(([x, y, h]) => {
        g.beginPath();
        if (x == null) { g.moveTo(0, y + 1); g.lineTo(s, y + 1); } else { g.moveTo(x + 1, y); g.lineTo(x + 1, y + h); }
        g.stroke();
      });
      g.strokeStyle = "rgba(255,232,196,.14)"; g.lineWidth = 1;   // 接缝的亮边
      joints.forEach(([x, y, h]) => { g.beginPath(); if (x == null) { g.moveTo(0, y + 3); g.lineTo(s, y + 3); } else { g.moveTo(x + 3, y); g.lineTo(x + 3, y + h); } g.stroke(); });
      g.strokeStyle = "rgba(52,30,14,.5)";
      for (let k = 0; k < 4; k++) kit.crack(g, r, r() * s, r() * s, 5 + Math.floor(r() * 6), 1.2, 1);
      for (let k = 0; k < 3; k++) kit.gravel(g, r, r() * s, r() * s, 5 + r() * 7, 8 + Math.floor(r() * 8));
    }),
    /** 地台侧面（矿外）：砂岩层——一层层暖色的砂岩（厚薄不一、上沿被风化得坑坑洼洼），厚的几层里有斜的层理，竖着几道裂缝 */
    artSandstoneSide: paint("artSandstoneSide", 128, (g, s, r, kit) => {
      const cols = ["#c8925c", "#b07a4a", "#d8a874", "#9c6a40", "#c08654", "#e0b684", "#a8723f"];
      for (let y = 0; y < s;) {
        const h = 5 + r() * 15, col = cols[Math.floor(r() * cols.length)];
        g.fillStyle = col; g.beginPath(); g.moveTo(0, y);
        for (let x = 0; x <= s; x += 8) g.lineTo(x, y + Math.sin(x * 0.09 + y) * 1.4 + (r() - 0.5) * 1.2);
        g.lineTo(s, y + h); g.lineTo(0, y + h); g.fill();
        if (h > 12) { g.strokeStyle = "rgba(90,52,24,.25)"; g.lineWidth = 1; for (let k = 0; k < 5; k++) { const x = r() * s; g.beginPath(); g.moveTo(x, y + 2); g.lineTo(x + h * 0.9, y + h - 2); g.stroke(); } }
        g.fillStyle = "rgba(40,22,10,.28)"; g.fillRect(0, y + h - 1, s, 1.5);
        y += h;
      }
      kit.speckle(g, s, r, 800, "rgba(255,236,206,.14)", "rgba(40,22,10,.22)");
      g.strokeStyle = "rgba(40,22,10,.4)";
      for (let k = 0; k < 4; k++) { const x = r() * s; g.lineWidth = 1 + r(); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 10, s * (0.3 + r() * 0.7)); g.stroke(); }
    }),
    /** 贴花：一摊被风吹积的浮沙（浅色、软边，几道细沙纹） */
    artSandDrift: paint("artSandDrift", 128, (g, s, r, kit) => {
      const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.46);
      grd.addColorStop(0, "rgba(226,196,148,.75)"); grd.addColorStop(0.6, "rgba(220,188,140,.45)"); grd.addColorStop(1, "rgba(220,188,140,0)");
      g.fillStyle = grd; g.beginPath(); g.ellipse(s / 2, s / 2, s * 0.46, s * 0.3, 0, 0, 7); g.fill();
      g.strokeStyle = "rgba(150,108,62,.3)"; g.lineWidth = 1.5;
      for (let k = 0; k < 4; k++) { g.beginPath(); for (let x = s * 0.2; x <= s * 0.8; x += 5) g.lineTo(x, s * (0.38 + k * 0.08) + Math.sin(x * 0.12 + k) * 2.5); g.stroke(); }
      kit.speckle(g, s, r, 120, "rgba(255,240,210,.3)", "rgba(120,80,40,.2)");
    }, { clamp: true, smooth: true })
  };
  /** 贴花（写法同 hd2d-world.js 的 DECALS） */
  const DECALS = {
    artSandDrift: { tex: "artSandDrift", size: [1.2, 2.1] }
  };

  /* ---------- 地台上的装饰 ---------- */
  /**
   * 一块地台上摆什么、摆在哪（纯函数，测试用同一份）：左右边带上 decor.band 个、左右的台子上 decor.ledge 个（hd2d-scene-art.js · zoneSpots），
   * 两两隔开。返回 [{ kind, x, z, y（摆在多高的台面上）, size（半径）, on }]（局部坐标）
   */
  function zonePlan(z, key) {
    const art = ART[key];
    if (!art) return [];
    const D = art.decor, R = A.rand(z.id * 977 + seedOf(key)), spots = A.zoneSpots(z, D.size[0]);
    const band = A.pick(spots.filter(s => s.on === "band"), D.band, R, 1.4);
    const ledge = A.pick(spots.filter(s => s.on === "ledge"), D.ledge, R, 0.8);
    return band.concat(ledge).map(s => ({ kind: D.kind || "rock", x: s.x, z: s.z, y: s.y, size: Math.min(A.span(R, D.size), s.r), on: s.on }));
  }
  /** 挂钩：地台上的装饰（hd2d-world.js · buildZone 交过来；地台本体、贴花、小石子已经画好了） */
  function zone(kit, g, z, ctx, r, look, a) {
    const art = a.art, P = PALETTE[art.palette], R = A.rand(z.id * 131 + seedOf(a.key));
    zonePlan(z, a.key).forEach(d => {
      const col = P.rock[Math.floor(R() * P.rock.length)];
      const m = kit.mesh(rockGeo(kit, d.size, R, 0.62), kit.mat("art-rock-" + art.palette, col, { roughness: 1 }), d.x, d.y + d.size * 0.32, d.z);
      m.rotation.y = R() * Math.PI * 2;
      m.userData.art = d.kind; m.userData.size = d.size;
      g.add(m);
    });
  }

  /* ---------- 远景：矿坑 ---------- */
  /**
   * 对面的坑壁：一级级台阶往下（第 k 级的台面在 top − k × step，台阶边在 edge + k × run，越往下越靠近这边），横着分 seg 段，
   * 每段的台阶边随机歪一点（quiet 那几处不歪：斜井的铁轨沿着它走）。拼成一个几何体，颜色按顶点给：
   * 一层层砂岩的颜色，台面亮、立面暗；最上面几级往天边的雾色靠，往下越来越黑。不吃场景的雾（雾会把坑底也抹亮），自己按远近调颜色。
   * 返回 { mesh, edgeAt(k, x) → { y, z }（第 k 级台阶边在 x 处的位置）, Q }
   */
  function benchWall(kit, env, Q, P, R, o) {
    const THREE = kit.THREE, n = Q.benches, seg = Q.seg, xs = [], ys = [], zs = [];
    for (let i = 0; i <= seg; i++) xs.push(env.x0 + (env.x1 - env.x0) * i / seg);
    const calm = (x) => ((o.quiet || []).some(q => Math.abs(x - q) < (env.x1 - env.x0) / seg + 0.2) ? 0 : 1);
    let edge = o.edge;
    for (let k = 0; k < n; k++) {
      if (k) edge += Q.run * ((Q.road || []).includes(k) ? Q.roadRun : 1);
      ys.push(xs.map(x => Q.top - k * Q.step + (R() - 0.5) * 2 * Q.jitter * calm(x)));
      zs.push(xs.map(x => edge + (R() - 0.5) * 2 * Q.jitter * calm(x)));
    }
    const haze = env.hazeOf(1), mist = new THREE.Color(P.dark);
    const colorOf = (k, lit, v) => {
      const c = new THREE.Color(P.rock[k % P.rock.length]).multiplyScalar((lit ? 1.06 : 0.7) * v);
      c.lerp(haze, Q.haze * clamp(1 - k / Math.max(1, Q.dark[0] + 1), 0, 1));
      return c.lerp(mist, smooth(Q.dark[0], Q.dark[1], k));
    };
    const pos = [], col = [];
    const quad = (a, b, c, d, color) => [a, b, c, a, c, d].forEach(p => { pos.push(p[0], p[1], p[2]); col.push(color.r, color.g, color.b); });
    for (let i = 0; i < seg; i++) {
      const xa = xs[i], xb = xs[i + 1], v = 0.92 + R() * 0.16;
      // 最上面那级的台面：坑沿那片平地，往后铺到天幕前
      quad([xa, ys[0][i], o.back], [xa, ys[0][i], zs[0][i]], [xb, ys[0][i + 1], zs[0][i + 1]], [xb, ys[0][i + 1], o.back], colorOf(0, true, v));
      for (let k = 0; k < n; k++) {
        const yb = k + 1 < n ? ys[k + 1] : null, lo = (j) => (yb ? yb[j] : Q.bottom);
        quad([xa, ys[k][i], zs[k][i]], [xa, lo(i), zs[k][i]], [xb, lo(i + 1), zs[k][i + 1]], [xb, ys[k][i + 1], zs[k][i + 1]], colorOf(k, false, v));   // 立面
        if (yb) quad([xa, yb[i], zs[k][i]], [xa, yb[i], zs[k + 1][i]], [xb, yb[i + 1], zs[k + 1][i + 1]], [xb, yb[i + 1], zs[k][i + 1]], colorOf(k + 1, true, v));   // 下一级的台面
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mesh = tag(new THREE.Mesh(geo, env.keep(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0, fog: false }))), "pitWall");
    const edgeAt = (k, x) => {
      const kk = clamp(Math.round(k), 0, n - 1), t = clamp((x - env.x0) / (env.x1 - env.x0) * seg, 0, seg - 1e-6), i = Math.floor(t), f = t - i;
      return { y: ys[kk][i] + (ys[kk][i + 1] - ys[kk][i]) * f, z: zs[kk][i] + (zs[kk][i + 1] - zs[kk][i]) * f };
    };
    return { mesh, edgeAt, Q };
  }
  /** 这边的坑沿：地台外面那片地到这里为止，沿着断口一排半埋的碎石（盖住地面的直边），几个实例网格 */
  function rimLip(kit, env, P, R, rimZ) {
    const THREE = kit.THREE, x0 = env.x0 + 4, x1 = env.x1 - 4, groups = 3, list = [[], [], []];
    for (let x = x0; x < x1; x += 0.5 + R() * 0.45) list[Math.floor(R() * groups)].push(x);
    list.forEach((xs, gi) => {
      const geo = rockGeo(kit, 1, R, 0.7), m = new THREE.InstancedMesh(geo, env.keep(new THREE.MeshStandardMaterial({ color: P.rock[gi % P.rock.length], roughness: 1, flatShading: true })), xs.length);
      const o = new THREE.Object3D();
      xs.forEach((x, i) => {
        const s = 0.2 + R() * 0.2;
        o.position.set(x, L.CONFIG.groundY - s * 0.25, rimZ + (R() - 0.5) * 0.3); o.rotation.set((R() - 0.5) * 0.5, R() * 3, (R() - 0.5) * 0.5); o.scale.set(s * (1 + R() * 0.4), s * 0.75, s);
        o.updateMatrix(); m.setMatrixAt(i, o.matrix);
      });
      env.group.add(tag(m, "rimLip"));
    });
  }
  /** 坑边的栏杆：一根根柱子 + 上下两道横杆（锈铁），吊架那一段空出来 */
  function railing(kit, env, P, R, b, rimZ, skip) {
    const THREE = kit.THREE, mat = env.keep(new THREE.MeshStandardMaterial({ color: P.metal, roughness: 0.7, metalness: 0.4, flatShading: true }));
    const z = rimZ + 0.4, y0 = L.CONFIG.groundY, from = b.minX - 9, to = b.maxX + 9, posts = [];
    let run = null;
    const runs = [];
    for (let x = from; x <= to; x += 1.35) {
      if (skip && Math.abs(x - skip) < 1.6) { if (run) { runs.push(run); run = null; } continue; }
      posts.push(x);
      if (!run) run = [x, x]; else run[1] = x;
    }
    if (run) runs.push(run);
    const g = new THREE.Group(), pm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.6, 0.06), mat, posts.length), o = new THREE.Object3D();
    posts.forEach((x, i) => { o.position.set(x, y0 + 0.3, z + (R() - 0.5) * 0.06); o.rotation.set((R() - 0.5) * 0.12, 0, (R() - 0.5) * 0.12); o.updateMatrix(); pm.setMatrixAt(i, o.matrix); });
    g.add(pm);
    runs.forEach(([a, c]) => [0.55, 0.3].forEach(h => g.add(kit.put(new THREE.Mesh(new THREE.BoxGeometry(c - a, 0.035, 0.035), mat), (a + c) / 2, y0 + h, z))));
    env.group.add(tag(g, "rail"));
  }
  /** 坑壁上零星的灯：落在看得到的那几级台阶边上；一部分偶尔暗一下（AMBIENT.blink；减少动态效果时一直亮着） */
  function pitLights(kit, env, wall, art, P, R, b) {
    const THREE = kit.THREE, Q = wall.Q, BD = art.backdrop, mat = env.keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(P.lamp).multiplyScalar(2.6), toneMapped: false, fog: false }));
    const geo = new THREE.SphereGeometry(0.075, 6, 5), cfg = AMBIENT.blink;
    for (let i = 0; i < BD.lights; i++) {
      const k = 1 + Math.floor(R() * (Q.dark[1] - 1)), x = (b.minX - 14) + R() * (b.maxX - b.minX + 28), e = wall.edgeAt(k, x);
      const m = tag(kit.put(new THREE.Mesh(geo, mat), x, e.y + 0.07, e.z - 0.1), "pitLight");
      env.group.add(m);
      if (R() < BD.blink) {
        const beat = A.beat(A.rand(i * 59 + 3), cfg.every, cfg.dur);
        m.userData.ambient = { kind: "blink", beat };
        env.anims.push((t, dt) => { if (dt === 0) { m.visible = true; return; } m.visible = beat.step(dt) < 0; });
      }
    }
  }
  /** 斜井：沿着台阶边一路斜下去的两根铁轨，矿车时不时上下（AMBIENT.skip）；井口一座小矿井架。x = 斜井在哪（那一段的台阶边是直的） */
  function skipTrack(kit, env, wall, P, R, x, i) {
    const THREE = kit.THREE, Q = wall.Q, kEnd = Q.dark[1] + 3;
    const top = wall.edgeAt(0, x), bot = wall.edgeAt(kEnd, x);
    const dy = bot.y - top.y, dz = bot.z - top.z, len = Math.hypot(dy, dz), ang = Math.atan2(-dy, dz);
    const at = (s) => ({ y: top.y + dy * s + 0.06, z: top.z + dz * s + 0.04 });
    const mat = env.keep(new THREE.MeshStandardMaterial({ color: P.metal, roughness: 0.6, metalness: 0.5, flatShading: true, fog: false }));
    const g = new THREE.Group();
    [-0.11, 0.11].forEach(dx => { const m = kit.put(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, len), mat), x + dx, (top.y + bot.y) / 2 + 0.05, (top.z + bot.z) / 2 + 0.03); m.rotation.x = ang; g.add(m); });
    const car = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.15, 0.22), mat);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), env.keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(P.lamp).multiplyScalar(2.6), toneMapped: false, fog: false })));
    light.position.set(0, 0.05, 0.12); car.add(body, light); car.rotation.x = ang;
    const cfg = AMBIENT.skip, mv = A.mover(A.rand(i * 977 + 11), cfg, cfg.stops[Math.floor(R() * cfg.stops.length)]);
    const place = () => { const p = at(mv.s); car.position.set(x, p.y + 0.08, p.z); };
    place();
    car.userData.ambient = { kind: "skip", mover: mv, top, bot };
    g.add(tag(car, "skip"));
    env.group.add(tag(g, "skipTrack"));
    env.anims.push((t, dt) => { if (dt > 0) { mv.step(dt); place(); } });
  }
  /** 坑边的吊架：A 字架 + 伸到坑上面的吊臂，钢索吊着一个罐笼上下（AMBIENT.cage）；整个立在坑边和灯之间（灯后面），
   *  side = −1 偏左 / 1 偏右（离战场左 / 右边 2.2，和角上的灯错开） */
  function gantry(kit, env, P, R, b, rimZ, side) {
    const THREE = kit.THREE, y0 = L.CONFIG.groundY, H = 2.3, x = side < 0 ? b.minX + 2.2 : b.maxX - 2.2, z = rimZ + 0.35;
    const mat = env.keep(new THREE.MeshStandardMaterial({ color: P.metal, roughness: 0.65, metalness: 0.45, flatShading: true }));
    const g = new THREE.Group();
    [-1, 1].forEach(s => { const leg = kit.put(new THREE.Mesh(new THREE.BoxGeometry(0.1, H + 0.2, 0.1), mat), x + s * 0.42, y0 + H / 2, z); leg.rotation.z = -s * 0.17; g.add(leg); });
    const back = kit.put(new THREE.Mesh(new THREE.BoxGeometry(0.1, H + 0.1, 0.1), mat), x, y0 + H / 2, z + 0.3); back.rotation.x = -0.18; g.add(back);
    const tail = z + 0.5, tipZ = rimZ - 1.6, boomLen = tail - tipZ;
    g.add(kit.put(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, boomLen), mat), x, y0 + H, (tail + tipZ) / 2));
    g.add(kit.put(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.3), mat), x, y0 + H - 0.05, tail - 0.1));   // 配重
    const wheel = kit.put(new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 4, 10), mat), x, y0 + H - 0.05, tipZ); wheel.rotation.y = Math.PI / 2; g.add(wheel);
    const topY = y0 + H - 0.7, botY = -5.5;
    const cable = kit.put(new THREE.Mesh(new THREE.BoxGeometry(0.018, 1, 0.018), mat), x, 0, tipZ);
    const cage = new THREE.Group();
    cage.add(new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.46, 0.38), env.keep(new THREE.MeshStandardMaterial({ color: P.metal, roughness: 0.6, metalness: 0.4, flatShading: true, transparent: true, opacity: 0.92 }))));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), env.keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(P.lamp).multiplyScalar(2.6), toneMapped: false, fog: false })));
    lamp.position.set(0, 0.28, 0.2); cage.add(lamp);
    const cfg = AMBIENT.cage, mv = A.mover(A.rand(seedOf("cage") + Math.round(x * 10)), cfg, 0);
    const place = () => {
      const y = topY + (botY - topY) * mv.s;
      cage.position.set(x, y, tipZ);
      const hgt = y0 + H - 0.1 - (y + 0.23);
      cable.scale.y = Math.max(0.01, hgt); cable.position.y = y + 0.23 + hgt / 2;
    };
    place();
    cage.userData.ambient = { kind: "cage", mover: mv, topY, botY };
    g.add(cable, tag(cage, "cage"));
    env.group.add(tag(g, "gantry"));
    env.anims.push((t, dt) => { if (dt > 0) { mv.step(dt); place(); } });
    return x;
  }
  /** 对面坑沿上远远的东西：斜井口的矿井架、几座筒仓 / 小厂房、一根冒烟的烟囱（远景剪影的材质：远的偏向雾色） */
  function farRim(kit, env, wall, P, R, quiet) {
    const Q = wall.Q, M = env.mats(1), z = (o) => wall.edgeAt(0, o).z - 0.55, y = Q.top - 0.02;
    const add = (o, x, zz, what) => { o.position.set(x, y, zz); env.group.add(tag(o, what)); return o; };
    quiet.forEach(x => add(kit.headframe(M, 1.25), x + 0.35, z(x), "farHeadframe"));
    const span = env.hx + 14;
    [[-0.85, "silos"], [-0.3, "shed"], [0.1, "silos"], [0.7, "shed"]].forEach(([u, what]) => {
      const x = env.cx + u * span + (R() - 0.5) * 2;
      add(what === "silos" ? kit.silos(M, 0.9 + R() * 0.5, 2 + Math.floor(R() * 2)) : kit.shed(M, 1.1 + R() * 0.8, 0.5 + R() * 0.3), x, z(x) - 0.4 - R() * 0.4, "farRim");
    });
    const cxm = env.cx + 0.55 * span, ch = kit.chimney(M, 1.9, 0.16);
    add(ch.group, cxm, z(cxm) - 0.6, "farRim");
    env.smoke(cxm, y + ch.top, z(cxm) - 0.6, 0.35);
    env.blinker(cxm, y + ch.top + 0.12, z(cxm) - 0.6, 0.4);
  }
  /** 矿外：战场后面往下的大矿坑。返回 groundEdge（坑边：地台外面那片地铺到这里为止） */
  function rimScene(kit, env, art, P, R, b) {
    const Q = PIT[art.pit], BD = art.backdrop;
    const rimZ = b.minZ - L.CONFIG.lamps.back - Q.rim;
    const quiet = (BD.skips || []).map(u => env.cx + u * (env.hx + 6));
    const wall = benchWall(kit, env, Q, P, R, { back: env.skyZ + Q.back, edge: env.skyZ + Q.far, quiet });
    env.group.add(wall.mesh);
    rimLip(kit, env, P, R, rimZ);
    const gx = BD.gantry ? gantry(kit, env, P, R, b, rimZ, BD.gantry) : null;
    if (BD.rail) railing(kit, env, P, R, b, rimZ, gx);
    pitLights(kit, env, wall, art, P, R, b);
    quiet.forEach((x, i) => skipTrack(kit, env, wall, P, R, x, i));
    if (BD.farRim) farRim(kit, env, wall, P, R, quiet);
    return rimZ;
  }

  /* ---------- 挂钩：远景 ---------- */
  /** 天边画的远景：矿外用以前采矿场的那条（远处的厂区 + 坑壁），在对面坑沿后面露出来 */
  function band(kit, colors, seed, a) {
    return a.art.depth === "rim" ? kit.bandTexture("mine", colors, seed) : null;
  }
  /** 中景、矿坑、战场周围的装饰、环境动画（hd2d-backdrop.js · buildBackdrop 交过来）：返回 { groundEdge } */
  function backdrop(kit, env, a) {
    const art = a.art, P = PALETTE[art.palette], b = boundsOf(env), R = A.rand(seedOf(a.key) + Math.round(env.hx * 10) + Math.round(env.hz * 7));
    if (art.depth === "rim") return { groundEdge: rimScene(kit, env, art, P, R, b) };
    return {};
  }

  const pack = { name: "mine", scenes: SCENES, grounds: GROUNDS, art: ART, textures: TEXTURES, decals: DECALS, zone, band, backdrop };
  A.add(pack);
  return Object.assign({ PALETTE, PIT, AMBIENT, zonePlan, seedOf }, pack);
});
