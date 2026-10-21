/* Antlerscale: Backfire · HD-2D 战场原型 · 区域场景的美术包：城市类（#241）
 *
 * 主人试玩反馈 · 四：外城区、巨人城、天网设施、下水道各一套美术（地面、地台侧面、装饰、远景、光照 / 调色）。数值都在下面的配置表里。
 * 怎么接进画面见 hd2d-scene-art.js（#242 的登记处）：这里不 import three.js，three.js 和画贴图 / 拼几何体的小工具由挂钩那边打包成 kit 传进来。
 *
 *   外城区 street：黄沙上的贫民窟。地面是黄沙（车辙、脚印、零碎的垃圾），地台侧面是一块块拼起来的瓦楞铁皮；
 *                  地台上零星的油桶、旧轮胎；战场后面、左右两边一圈矮房子和铁皮棚屋（不挡战场）
 *
 * 地台上的装饰只摆在左右两条边带和左右矮一截的台子上（站位区以外，见 hd2d-scene-art.js · zoneSpots），不压住站位、铭牌；
 * 战场周围的东西都在战场范围外面（后面先让开灯，hd2d-scene-art.js · around）。只读布局给的地台 / 战场范围，不碰单位数据（没有坚毅生命）。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./hd2d-layout.js"), require("./hd2d-scene-art.js"));
  else root.HD2DScenesCity = factory(root.HD2DLayout, root.HD2DSceneArt);
})(typeof self !== "undefined" ? self : this, function (L, A) {
  "use strict";

  /* ---------- 配置 ---------- */
  /** 各区域的色调：sheet 铁皮（锈褐、镀锌灰、红锈、褪色的青、土黄……轮着用）、wall 矮房子的土坯 / 砖墙、roof 屋顶、dark 门洞 / 窗洞、
   *  barrel 油桶的漆色、tire 轮胎 */
  const PALETTE = {
    street: {
      sheet: [0x8c6a4e, 0x7c7e7a, 0x9c5c3c, 0x6c8482, 0xa58e66, 0x84563e],
      wall: [0xbf9f74, 0xa88c6a, 0xcaa97c, 0x9e8566],
      roof: [0x6a5644, 0x7c7066, 0x5c4a3c, 0x8a6248],
      dark: 0x1e1712, barrel: [0x3f6a8a, 0x9a3a2a, 0xc8962e, 0x5a6a4a], tire: 0x24201c
    }
  };
  /** 战场周围的贫民窟（hd2d-scene-art.js · around 给的范围外面，margin 是再让开多少）：
   *   rows     后面几排：每排离「后面最近到哪」再往后 gap，横着每隔 step（± jitter 成）一间，往左右各伸出战场半宽 + reach
   *   side     左右两边各几列：每列离「左右最近到哪」再往外 gap，从后面一直排到战场前后的正中（不排到前面，不挡人）
   *   shack / house   铁皮棚屋 / 矮房子的宽、高、深的范围（世界单位）；house = 几成是矮房子（其余是铁皮棚屋） */
  const SLUM = {
    margin: { back: 0.5, side: 0.9 },
    rows: [{ gap: 0, step: 1.7, jitter: 0.25 }, { gap: 2.0, step: 2.0, jitter: 0.3 }, { gap: 4.2, step: 2.3, jitter: 0.3 }],
    reach: 8,
    side: [{ gap: 0, step: 1.8 }, { gap: 2.1, step: 2.1 }],
    shack: { w: [1.0, 1.5], h: [0.75, 1.05], d: [0.8, 1.1] },
    house: { w: [1.3, 2.0], h: [0.95, 1.4], d: [1.0, 1.4] },
    houses: 0.4
  };
  /** 一间棚屋 / 矮房子的样子（× 这一间的宽 / 进深 / 高）：roof 屋顶比墙宽多少、深多少，lean 屋顶往门那边挪多少，eave 中心离门前那条线至少多远
   *  （= 屋顶伸出去的那一截：roof.d / 2 + lean，再留一点），door / win 门洞、窗洞的宽高 */
  const HUT = { roof: { w: 1.14, d: 1.3 }, lean: 0.06, eave: 0.75, tilt: { shack: 0.16, house: 0.05 }, door: [0.26, 0.62], win: [0.18, 0.2] };
  /** 每个场景（键 = 地面主题）：
   *   palette   PALETTE 的哪一套
   *   decor     地台上的装饰：band 左右边带上几个、ledge 台子上几个、size 半径范围、kinds 摆什么（barrel 油桶、tire 旧轮胎），轮着挑
   *   backdrop  远景：slum 战场周围的贫民窟（SLUM）、band 天边画的远景用哪种（bandTexture 的 kind）
   *   light     光照 / 调色（写法见 hd2d-scene-art.js · lighting） */
  const ART = {
    outer_street: {
      palette: "street",
      decor: { band: 3, ledge: 2, size: [0.16, 0.22], kinds: ["barrel", "barrel", "tire"] },
      backdrop: { slum: true, band: "desert" },
      light: { all: { tint: { fog: [0xd8b47a, 0.25], hemiGround: [0xb08850, 0.35] } } }
    }
  };
  /** 地面主题（并进布局的 GROUNDS，写法同 hd2d-layout.js 的 GROUNDS）：顶面 / 侧面贴图是这里画的（art 开头），backdrop 指回这一套 */
  const GROUNDS = {
    outer_street: {   // 外城区：黄沙地（车辙、脚印、零碎的垃圾），侧面拼起来的瓦楞铁皮；地台外面是沙地；路灯
      tex: "artSlumSand", tint: 0xffffff, side: "artSlumSheet", decals: { ripple: 3, gravel: 2, oil: 1 },
      pebbles: 12, pebble: 0xa08058, rock: 0x8c7052, decor: "sand", ground: 0xc29a62, backdrop: "outer_street",
      lamps: { kind: "street", color: 0xffc98a, day: 1, dusk: 2, night: 2 }
    }
  };
  /** 区域 → 场景 id（world-data.js · BATTLE_SCENES）→ 地面主题 */
  const SCENES = {
    "外城区": { street: "outer_street" }
  };

  /* ---------- 小工具 ---------- */
  /** 字符串 → 种子（同一个场景每次一样） */
  const seedOf = (s) => { let h = 11; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 100003; };
  const named = (t, name) => { t.name = name; return t; };
  /** 战场范围（远景的 env 给的是中心和半宽） */
  const boundsOf = (env) => ({ minX: env.cx - env.hx, maxX: env.cx + env.hx, minZ: env.cz - env.hz, maxZ: env.cz + env.hz });
  /** 关掉阴影、打上标签（测试按 userData.art 认是什么） */
  function tag(o, what) {
    o.userData.art = what;
    o.traverse(m => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
    return o;
  }
  /** 远景用的 canvas 贴图（远景的小工具里没有 canvasTex：在这里画，交给 env.keep 一起清） */
  function farTex(kit, env, size, draw, seed) {
    const THREE = kit.THREE, c = document.createElement("canvas");
    c.width = c.height = size;
    draw(c.getContext("2d"), size, kit.rng(seed));
    const t = env.keep(new THREE.CanvasTexture(c));
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
    return t;
  }
  const hex = (n) => "#" + (n >>> 0).toString(16).padStart(6, "0");

  /* ---------- 贴图（canvas 程序贴图，没有图片文件）---------- */
  /** 一张美术包的贴图：kit.canvasTex 画（按名字缓存），贴图的 name 就是它在包里的名字（测试按它认） */
  const paint = (name, size, draw, opt) => (kit) => named(kit.canvasTex("art-" + name, size, (g, s, r) => draw(g, s, r, kit), opt), name);
  /** 瓦楞铁皮：竖着一块块（宽窄、颜色不一），一道道楞（亮暗相间），上沿往下流的锈迹，接缝的阴影和一排铆钉。顶面、侧面、远景的棚屋都用它 */
  function drawSheet(g, s, r, cols) {
    let x = 0;
    while (x < s) {
      let w = Math.round(s * (0.18 + r() * 0.2));
      if (s - x - w < s * 0.12) w = s - x;
      g.fillStyle = cols[Math.floor(r() * cols.length)]; g.fillRect(x, 0, w, s);
      const off = Math.round((r() - 0.5) * s * 0.3);   // 这块铁皮上下错开一点，横缝不齐
      for (let k = x + 2; k < x + w; k += 5) {
        g.fillStyle = "rgba(255,240,220,.16)"; g.fillRect(k, 0, 1.5, s);
        g.fillStyle = "rgba(20,12,6,.22)"; g.fillRect(k + 2.5, 0, 1.5, s);
      }
      for (let k = 0; k < 3; k++) {   // 锈迹：从上沿 / 钉眼往下流
        const rx = x + r() * w, len = s * (0.2 + r() * 0.5), grd = g.createLinearGradient(0, 0, 0, len);
        grd.addColorStop(0, "rgba(120,52,20,.55)"); grd.addColorStop(1, "rgba(120,52,20,0)");
        g.fillStyle = grd; g.fillRect(rx, 0, 2 + r() * 5, len);
      }
      g.fillStyle = "rgba(18,10,6,.5)"; g.fillRect(x, 0, 2, s);                     // 接缝
      g.fillStyle = "rgba(18,10,6,.35)"; g.fillRect(x, (s / 2 + off + s) % s, w, 2);   // 横缝
      g.fillStyle = "rgba(230,220,200,.6)";
      for (let y = 4; y < s; y += s / 4) g.fillRect(x + 3, y, 2, 2);                // 铆钉
      x += w;
    }
  }
  const TEXTURES = {
    /** 黄沙地（外城区）：黄沙底、深浅不一的几片，风吹的沙纹，一道车辙（左右首尾相接）、一串脚印，零碎的垃圾（锈铁片、瓶盖、压扁的纸箱）和碎石 */
    artSlumSand: paint("artSlumSand", 256, (g, s, r, kit) => {
      g.fillStyle = "#d2aa6a"; g.fillRect(0, 0, s, s);
      for (let k = 0; k < 14; k++) {
        const x = r() * s, y = r() * s, rad = 20 + r() * 50, grd = g.createRadialGradient(x, y, 0, x, y, rad);
        const c = r() < 0.5 ? "226,190,128" : "176,136,82";
        grd.addColorStop(0, `rgba(${c},.35)`); grd.addColorStop(1, `rgba(${c},0)`);
        [-s, 0, s].forEach(dx => [-s, 0, s].forEach(dy => { g.fillStyle = grd; g.save(); g.translate(dx, dy); g.fillRect(x - rad, y - rad, rad * 2, rad * 2); g.restore(); }));
      }
      kit.speckle(g, s, r, 2600, "rgba(255,236,196,.2)", "rgba(110,76,36,.2)");
      g.lineWidth = 1.2;
      for (let k = 0; k < 9; k++) {   // 沙纹：横着的波浪线（周期 = 贴图宽，左右接得上）
        const y0 = r() * s, a = 2 + r() * 3, ph = r() * 7;
        g.strokeStyle = k % 2 ? "rgba(140,100,52,.22)" : "rgba(255,236,190,.22)";
        g.beginPath();
        for (let x = 0; x <= s; x += 4) g.lineTo(x, y0 + Math.sin(x / s * Math.PI * 4 + ph) * a);
        g.stroke();
      }
      const ty = s * 0.68;   // 车辙：两道压实的深色带子 + 一格格胎纹
      [0, 22].forEach(dy => {
        for (let x = 0; x < s; x += 3) {
          const y = ty + dy + Math.sin(x / s * Math.PI * 2) * 10;
          g.fillStyle = "rgba(120,86,46,.32)"; g.fillRect(x, y, 3, 9);
          if (x % 9 === 0) { g.fillStyle = "rgba(90,60,30,.3)"; g.fillRect(x, y + 1, 2, 7); }
        }
      });
      for (let k = 0; k < 7; k++) {   // 一串脚印
        const x = s * 0.15 + k * 18, y = s * 0.28 + (k % 2) * 8 + k * 5;
        g.fillStyle = "rgba(120,84,44,.35)"; g.beginPath(); g.ellipse(x, y, 3, 5.5, 0.5, 0, 7); g.fill();
      }
      for (let k = 0; k < 5; k++) {   // 锈铁片
        g.save(); g.translate(r() * s, r() * s); g.rotate(r() * 3);
        g.fillStyle = ["#7a4a2a", "#8a6a4a", "#5a6a6a"][k % 3]; g.fillRect(-6, -3, 10 + r() * 8, 5 + r() * 4);
        g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(-6, 2, 12, 1.5);
        g.restore();
      }
      for (let k = 0; k < 10; k++) { g.fillStyle = r() < 0.5 ? "#b8b0a0" : "#a84a30"; g.beginPath(); g.arc(r() * s, r() * s, 1.6, 0, 7); g.fill(); }   // 瓶盖
      g.save(); g.translate(s * 0.78, s * 0.2); g.rotate(0.4);   // 压扁的纸箱
      g.fillStyle = "#b08e62"; g.fillRect(-14, -9, 28, 18); g.strokeStyle = "rgba(80,56,30,.5)"; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -9); g.lineTo(0, 9); g.stroke();
      g.restore();
      for (let k = 0; k < 4; k++) kit.gravel(g, r, r() * s, r() * s, 5 + r() * 6, 6 + Math.floor(r() * 6));
    }),
    /** 地台侧面（外城区）：拼起来的瓦楞铁皮 */
    artSlumSheet: paint("artSlumSheet", 128, (g, s, r) => drawSheet(g, s, r, ["#8c6a4e", "#7c7e7a", "#9c5c3c", "#6c8482", "#a58e66", "#84563e"]))
  };
  /** 贴花（写法同 hd2d-world.js 的 DECALS）：这一版都用 hd2d-world.js 里现成的（沙纹、碎石、油渍） */
  const DECALS = {};

  /* ---------- 地台上的装饰 ---------- */
  /**
   * 一块地台上摆什么、摆在哪（纯函数，测试用同一份）：左右边带上 decor.band 个、左右的台子上 decor.ledge 个（hd2d-scene-art.js · zoneSpots），
   * 两两隔开。返回 [{ kind, x, z, y（摆在多高的台面上）, size（半径）, on }]（局部坐标）
   */
  function zonePlan(z, key) {
    const art = ART[key];
    if (!art) return [];
    const D = art.decor, R = A.rand(z.id * 977 + seedOf(key)), spots = A.zoneSpots(z, D.size[0]);
    const band = A.pick(spots.filter(s => s.on === "band"), D.band, R, 1.2);
    const ledge = A.pick(spots.filter(s => s.on === "ledge"), D.ledge, R, 0.8);
    // 台子在外轮廓外面，但外轮廓往里凹的地方台子离站位区也近：装饰再小一点，横着离站位区至少 foot + 半径
    const room = (s) => Math.abs(s.x) - (z.w / 2 - L.CONFIG.pad) - A.SPOT.foot;
    return band.concat(ledge).map((s, i) => ({ kind: D.kinds[(i + z.id) % D.kinds.length], x: s.x, z: s.z, y: s.y, size: Math.min(A.span(R, D.size), s.r, room(s)), on: s.on }))
      .filter(d => d.size >= D.size[0] * 0.75);
  }
  /** 一个油桶（半径 rad）：桶身 + 两道箍 + 桶盖，漆色掉了一半 */
  function barrel(kit, rad, col) {
    const THREE = kit.THREE, g = new THREE.Group(), h = rad * 2.6;
    g.add(kit.mesh(new THREE.CylinderGeometry(rad, rad, h, 10), kit.mat("art-barrel-" + col, col, { roughness: 0.75, metalness: 0.3 }), 0, h / 2, 0));
    [0.3, 0.7].forEach(k => g.add(kit.mesh(new THREE.CylinderGeometry(rad * 1.04, rad * 1.04, h * 0.05, 10), kit.mat("art-barrel-ring", 0x3a2e26, { roughness: 0.6, metalness: 0.5 }), 0, h * k, 0)));
    g.add(kit.mesh(new THREE.CylinderGeometry(rad * 0.98, rad * 0.98, 0.012, 10), kit.mat("art-barrel-lid", 0x4a3c30, { roughness: 0.7, metalness: 0.4 }), 0, h + 0.006, 0));
    return g;
  }
  /** 一个平躺着的旧轮胎（外半径 rad） */
  function tire(kit, rad, col) {
    const THREE = kit.THREE, m = kit.mesh(new THREE.TorusGeometry(rad * 0.72, rad * 0.28, 6, 12), kit.mat("art-tire", col, { roughness: 0.95 }), 0, rad * 0.28, 0);
    m.rotation.x = Math.PI / 2;
    return m;
  }
  /** 挂钩：地台上的装饰（hd2d-world.js · buildZone 交过来；地台本体、贴花、小石子已经画好了） */
  function zone(kit, g, z, ctx, r, look, a) {
    const P = PALETTE[a.art.palette], R = A.rand(z.id * 131 + seedOf(a.key));
    zonePlan(z, a.key).forEach(d => {
      const o = d.kind === "tire" ? tire(kit, d.size, P.tire) : barrel(kit, d.size * 0.8, P.barrel[Math.floor(R() * P.barrel.length)]);
      o.position.set(d.x, d.y, d.z); o.rotation.y = R() * Math.PI * 2;
      o.userData.art = d.kind; o.userData.size = d.size;
      g.add(o);
    });
  }

  /* ---------- 远景：战场周围的贫民窟 ---------- */
  /**
   * 贫民窟里每一间摆在哪（纯函数，测试用同一份）：后面 SLUM.rows 几排、左右 SLUM.side 几列，都在战场范围外面（hd2d-scene-art.js · around）。
   * 每间的门朝着战场（后面的朝前、左右的朝里），屋顶往门那边多伸出一截（HUT.eave）：中心离边上再让开 HUT.eave × 进深。
   * 返回 [{ kind: "shack" / "house", x, z（中心）, w, h, d, rot }]
   */
  function slumPlan(b, seed) {
    const S = SLUM, R = A.rand(seed), at = A.around(b, S.margin), out = [];
    const one = (kind, x, z, rot, D) => out.push({ kind, x, z, w: D.w, h: D.h, d: D.d, rot });
    const size = () => { const kind = R() < S.houses ? "house" : "shack", D = S[kind]; return { kind, w: A.span(R, D.w), h: A.span(R, D.h), d: A.span(R, D.d) }; };
    S.rows.forEach((row, i) => {
      const from = at.cx - at.hx - S.reach, to = at.cx + at.hx + S.reach;
      for (let x = from + R() * row.step * 0.5; x < to; x += row.step * (1 + (R() - 0.5) * 2 * row.jitter)) {
        const D = size();
        one(D.kind, x, at.back - row.gap - HUT.eave * D.d - (i ? R() * 0.4 : 0), (R() - 0.5) * 0.25, D);
      }
    });
    [-1, 1].forEach(sx => S.side.forEach(col => {
      for (let z = at.back; z < at.cz;) {
        const D = size();
        z += D.w * 0.6;
        one(D.kind, at.cx + sx * (at.sideX + col.gap + HUT.eave * D.d), z, -sx * Math.PI / 2 + (R() - 0.5) * 0.2, D);
        z += D.w * 0.6 + col.step * 0.3 * R();
      }
    }));
    return out;
  }
  /** 远景的材质：铁皮（几种颜色各一个，贴瓦楞铁皮）、墙、屋顶、门洞 */
  function slumMats(kit, env, P, seed) {
    const THREE = kit.THREE, std = (color, map, opt) => env.keep(new THREE.MeshStandardMaterial(Object.assign({ color, map, roughness: 0.9, metalness: 0.15, flatShading: true }, opt || {})));
    const sheetTex = farTex(kit, env, 64, (g, s, r) => drawSheet(g, s, r, ["#d8d0c4", "#c4bcb0", "#e4dcd0"]), seed);
    const wallTex = farTex(kit, env, 64, (g, s, r) => {   // 土坯 / 砖墙：一行行错开的砖，抹的灰掉了几块
      g.fillStyle = "#e8e0d4"; g.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y += 8) for (let x = (y / 8) % 2 ? -6 : 0; x < s; x += 12) { g.fillStyle = r() < 0.5 ? "#ddd4c6" : "#f2eade"; g.fillRect(x + 1, y + 1, 10, 6); }
      for (let k = 0; k < 4; k++) { g.fillStyle = "rgba(255,250,240,.5)"; g.fillRect(r() * s, r() * s, 10 + r() * 14, 8 + r() * 10); }
    }, seed + 7);
    return {
      sheet: P.sheet.map(c => std(c, sheetTex)), wall: P.wall.map(c => std(c, wallTex, { metalness: 0 })),
      roof: P.roof.map(c => std(c, sheetTex)), dark: std(P.dark, null, { roughness: 1, metalness: 0 })
    };
  }
  /** 一间铁皮棚屋 / 矮房子：方盒子（铁皮的 / 砖墙的），单坡屋顶往前伸出一截，前面一个黑门洞、矮房子再开一两个窗洞；屋顶上压几块石头 */
  function hut(kit, M, h, R) {
    const THREE = kit.THREE, g = new THREE.Group(), pick = (list) => list[Math.floor(R() * list.length)];
    const body = new THREE.Mesh(new THREE.BoxGeometry(h.w, h.h, h.d), h.kind === "house" ? pick(M.wall) : pick(M.sheet));
    body.position.y = h.h / 2; g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(h.w * HUT.roof.w, 0.05, h.d * HUT.roof.d), pick(M.roof));
    roof.position.set(0, h.h + 0.05, h.d * HUT.lean); roof.rotation.x = HUT.tilt[h.kind]; g.add(roof);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(h.w * HUT.door[0], h.h * HUT.door[1]), M.dark);
    door.position.set((R() - 0.5) * h.w * 0.4, h.h * HUT.door[1] / 2, h.d / 2 + 0.006); g.add(door);
    if (h.kind === "house") {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(h.w * HUT.win[0], h.h * HUT.win[1]), M.dark);
      win.position.set(door.position.x > 0 ? -h.w * 0.25 : h.w * 0.25, h.h * 0.6, h.d / 2 + 0.006); g.add(win);
    }
    return g;
  }
  /** 外城区：战场周围一圈矮房子、铁皮棚屋 */
  function slumScene(kit, env, art, P, b, seed) {
    const M = slumMats(kit, env, P, seed), R = A.rand(seed + 3);
    slumPlan(b, seed).forEach(h => {
      const o = hut(kit, M, h, R);
      o.position.set(h.x, L.CONFIG.groundY, h.z); o.rotation.y = h.rot;
      env.group.add(tag(o, h.kind));
    });
  }

  /* ---------- 挂钩：远景 ---------- */
  /** 天边画的远景：先借现成的（沙漠的桌山：远处的沙岩悬崖） */
  function band(kit, colors, seed, a) {
    return a.art.backdrop.band ? kit.bandTexture(a.art.backdrop.band, colors, seed) : null;
  }
  /** 中景、战场周围的装饰、环境动画（hd2d-backdrop.js · buildBackdrop 交过来）：返回 { groundEdge }（地台外面那片地一直铺到天幕 = 不给） */
  function backdrop(kit, env, a) {
    const art = a.art, P = PALETTE[art.palette], b = boundsOf(env), seed = seedOf(a.key) + Math.round(env.hx * 10) + Math.round(env.hz * 7);
    if (art.backdrop.slum) slumScene(kit, env, art, P, b, seed);
    return {};
  }

  const pack = { name: "city", scenes: SCENES, grounds: GROUNDS, art: ART, textures: TEXTURES, decals: DECALS, zone, band, backdrop };
  A.add(pack);
  return Object.assign({ PALETTE, SLUM, zonePlan, slumPlan, seedOf }, pack);
});
