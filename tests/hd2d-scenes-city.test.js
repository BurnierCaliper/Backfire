// HD-2D 战场原型 · 主人试玩反馈 · 四（#241）：区域场景的美术——城市类（外城区 / 巨人城 / 天网设施 / 下水道）。
// 美术放在美术包 hd2d-scenes-city.js 里，经 #242 的登记处 hd2d-scene-art.js 挂上（共用文件里只有 #242 的挂钩）。
// 都是 Node 能跑的：配置和摆放是纯函数；地台、远景在 Node 里用 vendor 的真 three.js 建；画面（WebGL）截图由仓库主人跑。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const H = require("./headless");
const L = require("../prototypes/hd2d/hd2d-layout.js");
const C = require("../prototypes/hd2d/hd2d-camera.js");

const DIR = path.join(__dirname, "..", "prototypes", "hd2d");
// 缺这个文件时只是这几条失败（每条测试里各自 require）
const art = () => require("../prototypes/hd2d/hd2d-scene-art.js");
const city = () => require("../prototypes/hd2d/hd2d-scenes-city.js");
const packs = () => { city(); return art(); };

/** 做好了的场景（区域、场景 id、地面主题），远景里一定有的东西（userData.art） */
const DONE = [
  { region: "外城区", scene: "street", key: "outer_street", must: ["shack", "house", "pipe", "cliff"] },
  { region: "下水道", scene: "tunnel", key: "sewer_tunnel", must: ["tunnelWall", "tunnelRib", "lampPool", "wallLamp", "wallPipe"] }
];
const PARTY = ["kolt", "helu", "ruby", "yuito"];
const DESKTOP = { width: 1440, height: 900, top: 46, bottom: 160 };
const THEMES = { day: { sky: ["#f6e3b4", "#ecc98c", "#dcac6a", "#c29a66"], fog: 0xd6b985 }, dusk: { sky: ["#ffc47c", "#f28a5a", "#b9587a", "#4b3368"], fog: 0xc98a72 }, night: { sky: ["#2f4673", "#1d2d52", "#101b38", "#060b1a"], fog: 0x1b2742 } };
const gapOf = (type, hp, open) => ({ type, hp: hp || 0, maxHp: hp || 0, open: open !== false, lastFrom: null });

/** 三种棋盘（直排三区 + 酸液 + 高地、2×2、十字五区 + 深渊 + 高地），再加每个区轮流挤满人的 */
const BOARDS = {
  line3(S) {
    const st = S.setup({ party: PARTY, zoneMode: 3, seed: "hd2d-street", enemies: [{ id: "guard_sword", lv: 2, zone: 3 }, { id: "guard_gun", lv: 2, zone: 3 }, { id: "thug_hammer", lv: 2, zone: 2 }, { id: "boomcar", lv: 2, zone: 2 }] });
    st.fields[2].acid = true; st.fields[3].highland = true; st.gaps["1-2"] = gapOf("bridge", 12); st.gaps["2-3"] = gapOf("wall", 20, false);
    return st;
  },
  square4(S) {
    const st = S.setup({ party: PARTY, board: "square4", seed: "hd2d-street4", enemies: [{ id: "thug_knife", lv: 2, zone: 2 }, { id: "guard_gun", lv: 2, zone: 4 }, { id: "thug_hammer", lv: 2, zone: 4 }] });
    st.gaps["2-4"] = gapOf("bridge", 10);
    return st;
  },
  cross5(S) {
    const st = S.setup({ party: PARTY, board: "cross5", seed: "hd2d-street5", enemies: [{ id: "crow", lv: 2, zone: 1 }, { id: "thug_hammer", lv: 2, zone: 3 }, { id: "guard_gun", lv: 2, zone: 4 }] });
    st.fields[1].abyss = true; st.fields[2].highland = true; st.gaps["2-3"] = gapOf("door", 0, false); st.gaps["3-4"] = gapOf("bridge", 12);
    return st;
  }
};
function boardsFor(S) {
  const out = [];
  Object.keys(BOARDS).forEach(id => {
    const st = JSON.parse(JSON.stringify(BOARDS[id](S)));
    out.push({ id, st });
    L.boardOf(st).zones.forEach(z => {
      const c = JSON.parse(JSON.stringify(st));
      c.units.forEach(u => { u.zone = z.id; });
      out.push({ id: id + "·挤在" + z.id + "区", st: c });
    });
  });
  return out;
}
const layoutOf = (st, d, theme) => L.build(st, { view: DESKTOP, region: d.region, scene: d.scene, theme: theme || "dusk" });

/* ---------- 真的 three.js（和 tests/hd2d-scenes.test.js 的 protoEnv 一样：three 指到 vendor，临时放上假的 document / window）---------- */
let protoHooked = false;
async function protoEnv(t) {
  const mod = require("node:module"), { pathToFileURL } = require("url");
  if (typeof mod.register !== "function") { t.skip("这个 Node 版本没有 module.register"); return null; }
  const threeUrl = pathToFileURL(path.join(__dirname, "..", "vendor", "three", "three.module.min.js")).href;
  if (!protoHooked) {
    protoHooked = true;
    mod.register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
      if (s === "three") return { url: ${JSON.stringify(threeUrl)}, format: "module", shortCircuit: true };
      const r = await n(s, c);
      return /\\/(prototypes\\/hd2d|vendor\\/three)\\//.test(r.url) ? Object.assign({}, r, { format: "module" }) : r;
    }`));
  }
  const A = packs();
  const any = () => new Proxy(function () {}, { get: (o, k) => (k === Symbol.toPrimitive ? () => 0 : any()), set: () => true, apply: () => any() });
  const keep = { document: globalThis.document, window: globalThis.window };
  const restore = () => {
    globalThis.document = keep.document; globalThis.window = keep.window;
    if (keep.document === undefined) delete globalThis.document;
    if (keep.window === undefined) delete globalThis.window;
  };
  globalThis.document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => any() }) };
  globalThis.window = { HD2DLayout: L, HD2DSceneArt: A };
  try {
    const url = (f) => pathToFileURL(path.join(DIR, f)).href;
    const THREE = await import(threeUrl);
    const W = await import(url("hd2d-world.js")), B = await import(url("hd2d-backdrop.js"));
    return { THREE, W, B, A, restore };
  } catch (e) { restore(); throw e; }
}
const backdropOf = (B, layout, theme) => B.buildBackdrop(L.GROUNDS[layout.ground].backdrop, layout.bounds, theme, layout.camera, THEMES[theme]);
/** 一个物体里打了 userData.art 的（美术包放的东西） */
function artOf(root) {
  const out = [];
  root.traverse(o => { if (o.userData && o.userData.art) out.push({ obj: o, what: o.userData.art }); });
  return out;
}

/* ---------- 屏幕上：装饰在单位前面的话，不能挡住他的脚下、他的铭牌（和 tests/hd2d-scenes.test.js 同一套算法）---------- */
function lenses(layout) {
  const zones = [...new Set(layout.units.map(u => u.zone))];
  const out = [{ tag: "远景", cam: layout.camera, plates: Object.fromEntries(layout.units.map(u => [u.id, { rect: u.rect }])) }];
  zones.forEach(z => ["mid", "near"].forEach(tier => { const p = C.pose(layout, tier, z); out.push({ tag: (tier === "mid" ? "中景 " : "近景 ") + z + " 区", cam: p.cam, plates: p.plates }); }));
  return out;
}
function screenOf(cam, pts) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, near = Infinity;
  pts.forEach(p => {
    const s = L.project(cam, p);
    near = Math.min(near, s.depth);
    if (s.depth <= 0) return;
    x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
  });
  return { x0, x1, y0, y1, near };
}
/** 一个装饰在世界里的点：网格按真的顶点（下水道的管壁是一大片弯的网格，外框的角根本不在管壁上，不能拿外框算），实例网格按外框的八个角 */
function pointsOf(THREE, obj) {
  const out = [], v = new THREE.Vector3();
  obj.updateMatrixWorld(true);
  obj.traverse(o => {
    if (!o.isMesh && !o.isSprite) return;
    const pos = o.geometry.attributes.position;
    if (o.isInstancedMesh || o.isSprite) {
      const b = new THREE.Box3().setFromObject(o);
      [b.min.x, b.max.x].forEach(x => [b.min.y, b.max.y].forEach(y => [b.min.z, b.max.z].forEach(z => out.push({ x, y, z }))));
    } else for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); out.push({ x: v.x, y: v.y, z: v.z }); }
  });
  return out;
}
function footBox(cam, u) {
  const ps = [[-0.42, 0], [0.42, 0], [0, -0.42], [0, 0.42]].map(([dx, dz]) => L.project(cam, { x: u.x + dx, y: u.groundY, z: u.z + dz }));
  return { x0: Math.min(...ps.map(p => p.x)), x1: Math.max(...ps.map(p => p.x)), y0: Math.min(...ps.map(p => p.y)), y1: Math.max(...ps.map(p => p.y)) };
}
const hits = (a, b) => a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5;
const cardOf = (r) => ({ x0: r.x0, x1: r.x1, y0: r.y0 + L.CONFIG.plate.bob, y1: r.y1 - L.CONFIG.plate.bob });

/* ---------- 1. 每个区域选出自己的一套 ---------- */
test("城市类每个区域选出自己的一套（#241）：区域 + 场景 id → 美术包里这个场景的地面主题（顶面 / 侧面贴图是美术包画的、远景指回自己）；布局按它换默认地台，有场地效果的照旧；没给场景 = 区域以前的样子", () => {
  const A = packs(), c = H.load(), T = require("vm").runInContext("BATTLE_SCENES", c);
  DONE.forEach(d => {
    const tag = d.region + " · " + d.scene, key = L.groundOf(d.region, d.scene), look = L.GROUNDS[key], a = A.of(key);
    assert.ok(T[d.region].some(s => s.id === d.scene), tag + "：是正式场景表里的场景");
    assert.equal(key, d.key, tag + "：选出这个场景自己的那一套");
    assert.ok(a && a.region === d.region && a.scene === d.scene && a.pack.name === "city", tag + "：登记在城市类的美术包里");
    ["tex", "side"].forEach(k => assert.ok(A.texture(look[k], {}), `${tag}：${k} 贴图 ${look[k]} 是美术包画的`));
    assert.equal(look.backdrop, d.key, tag + "：远景是这个场景自己的");
    ["decor", "backdrop", "light"].forEach(k => assert.ok(a.art[k], `${tag}：美术包里有 ${k}`));
    assert.equal(L.groundOf(d.region), L.REGIONS[d.region], tag + "：没给场景 = 区域以前的样子");
    Object.keys(BOARDS).forEach(id => {
      const out = layoutOf(BOARDS[id](c.BattleSim), d);
      assert.equal(out.ground, d.key, `${tag} ${id}`);
      out.zones.forEach(z => assert.equal(z.ground, z.effects.every(e => e === "highland") ? d.key : null, `${tag} ${id} ${z.id} 区（${z.effects.join("+") || "默认"}）`));
    });
  });
  assert.deepEqual(c.__errors, []);
});

test("真的 three.js 里建出这个场景的一套（#241）：默认地台的顶面 / 侧面是美术包的贴图、地台上有美术包的装饰；远景里有这个场景该有的东西，白天 / 傍晚 / 夜晚都建得出来", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { W, B, A } = P;
  try {
    const S = H.load().BattleSim;
    for (const d of DONE) {
      const look = L.GROUNDS[d.key], layout = layoutOf(BOARDS.line3(S), d), ctx = { anim: [], lamps: [], fxLights: 0, theme: "dusk" };
      layout.zones.forEach(z => {
        const g = W.buildZone(z, ctx), body = g.children.find(o => o.userData.part === "body"), tag = `${d.key} ${z.id} 区（${z.kind}）`;
        if (z.ground) {
          assert.equal(body.material[0].map.name, look.tex, tag + "：顶面是这个场景的贴图");
          assert.equal(body.material[1].map.name, look.side, tag + "：侧面是这个场景的贴图");
          assert.ok(artOf(g).length >= 1, tag + "：有美术包摆的装饰");
        } else assert.equal(artOf(g).length, 0, tag + "：有场地效果的地台照旧");
        W.disposeTree(g);
      });
      for (const theme of ["day", "dusk", "night"]) {
        const bd = backdropOf(B, layout, theme), got = new Set(artOf(bd.group).map(o => o.what));
        d.must.forEach(w => assert.ok(got.has(w), `${d.key} ${theme}：远景里有 ${w}`));
        bd.update(1, 0.016); bd.update(1, 0);
        bd.dispose();
      }
      assert.ok(A.lighting({ day: { fog: 0x888888, hemiGround: 0x666666, sky: ["#ffffff"] } }, "day", d.key), d.key + "：有自己的光照");
    }
  } finally { P.restore(); }
});

/* ---------- 2. 装饰不压住站位 / 铭牌 ---------- */
test("装饰不压住站位（#241）：地台上的装饰只摆在站位区外面的边带 / 台子上；各种棋盘、每个区挤满人时，装饰的底面都碰不到任何人脚下那一圈", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { THREE, W, A } = P;
  const K = city();
  try {
    const S = H.load().BattleSim, stand = L.CONFIG.zoneSize / 2 - L.CONFIG.pad, FOOT = A.SPOT.foot;
    for (const d of DONE) {
      for (const bdx of boardsFor(S)) {
        const layout = layoutOf(bdx.st, d), ctx = { anim: [], lamps: [], fxLights: 0, theme: "dusk" };
        const zones = layout.zones.filter(z => z.ground);
        assert.ok(zones.reduce((n, z) => n + K.zonePlan(z, d.key).length, 0) >= zones.length, `${d.key} ${bdx.id}：地台上摆了装饰`);
        zones.forEach(z => {
          const tag = `${d.key} ${bdx.id} ${z.id} 区`;
          K.zonePlan(z, d.key).forEach(p => assert.ok(Math.abs(p.x) >= stand + FOOT + p.size - 1e-9, `${tag}：装饰 (${p.x}, ${p.z}) 离站位区太近`));
          const g = W.buildZone(z, ctx);
          g.updateMatrixWorld(true);
          const here = layout.units.filter(u => u.zone === z.id);
          artOf(g).forEach(({ obj }) => {
            const b = new THREE.Box3().setFromObject(obj);
            here.forEach(u => {
              const apart = b.max.x <= u.x - FOOT || b.min.x >= u.x + FOOT || b.max.z <= u.z - FOOT || b.min.z >= u.z + FOOT;
              assert.ok(apart, `${tag}：${obj.userData.art} 压到了 ${u.plate.name} 的脚下`);
            });
          });
          W.disposeTree(g);
        });
      }
    }
  } finally { P.restore(); }
});

test("装饰不压住铭牌（#241）：远景、中景、近景里，地台上和战场周围的装饰只要在某个人前面，在屏幕上就不挡他的脚下、不压他的铭牌；战场周围的东西都在战场范围外面（后面先让开灯）", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { THREE, W, B } = P;
  let checked = 0;
  try {
    const S = H.load().BattleSim;
    for (const d of DONE) {
      for (const bdx of boardsFor(S)) {
        const layout = layoutOf(bdx.st, d), ctx = { anim: [], lamps: [], fxLights: 0, theme: "dusk" }, root = new THREE.Group();
        layout.zones.forEach(z => root.add(W.buildZone(z, ctx)));
        const bd = backdropOf(B, layout, "dusk");
        root.add(bd.group);
        root.updateMatrixWorld(true);
        const things = artOf(root).filter(o => !o.obj.parent || !o.obj.parent.userData.art).map(o => ({ what: o.what, pts: pointsOf(THREE, o.obj) }));
        const b = layout.bounds, lampZ = b.minZ - L.CONFIG.lamps.back;
        artOf(bd.group).forEach(({ obj, what }) => {
          const box = new THREE.Box3().setFromObject(obj);
          layout.zones.forEach(z => {
            const inside = box.max.x > z.cx - z.w / 2 && box.min.x < z.cx + z.w / 2 && box.max.z > z.cz - z.d / 2 && box.min.z < z.cz + z.d / 2;
            assert.ok(!inside, `${d.key} ${bdx.id}：远景里的 ${what} 伸进了 ${z.id} 区的地台`);
          });
          const behind = box.max.z < lampZ - 0.25, aside = box.min.x > b.maxX + 0.5 || box.max.x < b.minX - 0.5, before = box.min.z > b.maxZ + 0.5;
          assert.ok(behind || aside || before, `${d.key} ${bdx.id}：远景里的 ${what} 没让开灯 / 战场（z ${box.min.z.toFixed(2)}…${box.max.z.toFixed(2)}，灯在 ${lampZ.toFixed(2)}）`);
        });
        for (const lens of lenses(layout)) {
          things.forEach(th => {
            const s = screenOf(lens.cam, th.pts);
            layout.units.forEach(u => {
              const ud = L.project(lens.cam, { x: u.x, y: u.groundY, z: u.z }).depth, q = lens.plates[u.id];
              if (!q || !q.rect || s.near >= ud - 0.05) return;
              checked++;
              assert.ok(!hits(s, footBox(lens.cam, u)), `${d.key} ${bdx.id} ${lens.tag}：${th.what} 挡住了 ${u.plate.name} 的脚下`);
              assert.ok(!hits(s, cardOf(q.rect)), `${d.key} ${bdx.id} ${lens.tag}：${th.what} 压住了 ${u.plate.name} 的铭牌`);
            });
          });
        }
        bd.dispose(); W.disposeTree(root);
      }
    }
    assert.ok(checked > 50, `比过的「装饰在某人前面」只有 ${checked} 次`);
  } finally { P.restore(); }
});

/* ---------- 3. 下水道 ---------- */
test("下水道（#241）：在巨大圆管的里面——管壁从灯后面往后往上弯，最高处比默认镜头的画面上沿高、在天幕前面（看不到天）；地上铺满污水，贴图在流，减少动态效果时不流；光照不分白天黑夜，比外城区暗", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { B, A } = P;
  const K = city();
  try {
    const S = H.load().BattleSim, d = DONE.find(x => x.scene === "tunnel");
    for (const id of Object.keys(BOARDS)) {
      const layout = layoutOf(BOARDS[id](S), d, "day"), b = layout.bounds, cz = (b.minZ + b.maxZ) / 2, hz = (b.maxZ - b.minZ) / 2;
      const env = { cx: (b.minX + b.maxX) / 2, cz, hx: (b.maxX - b.minX) / 2, hz, skyZ: cz - hz - 11 };   // 和 hd2d-backdrop.js 一样（BACKDROP.skyGap = 11）
      const sh = K.tunnelShape(env), top = sh.point(Math.PI / 2);
      assert.ok(sh.zw < b.minZ - L.CONFIG.lamps.back, `${id}：管壁在灯后面`);
      assert.ok(top.z > env.skyZ + 0.7, `${id}：管壁弯到竖直的地方还在天边那条远景前面`);
      assert.ok(top.y > L.frameTop(layout.camera, top.z) + 1, `${id}：管壁比默认镜头的画面上沿高（看不到天）`);
      const bd = backdropOf(B, layout, "night");
      let water = null;
      bd.group.traverse(o => { if (o.userData.flow === "sewage") water = o; });
      assert.ok(water, `${id}：地上有污水`);
      water.updateMatrixWorld(true);
      assert.ok(water.position.y < 0 && water.position.y > L.CONFIG.groundY, `${id}：污水在地面上、比地台低`);
      const tex = water.material.map, x0 = tex.offset.x;
      bd.update(1, 0);
      assert.equal(tex.offset.x, x0, `${id}：减少动态效果时污水不流`);
      bd.update(1.5, 0.5);
      assert.notEqual(tex.offset.x, x0, `${id}：污水在流`);
      bd.dispose();
    }
    const TH = { day: { hemi: 0.9, sunI: 2.7, rimI: 0.55, exposure: 1, lamp: 0.25, fog: 0xd6b985, ground: 0x6e5b42, hemiSky: 0xfff1d8, hemiGround: 0x735c40, sun: 0xfff0d2, rim: 0xfff0c8, sky: ["#f6e3b4", "#ecc98c", "#dcac6a", "#c29a66"], grade: {} } };
    TH.dusk = Object.assign({}, TH.day, { hemi: 0.8, sunI: 3.0 }); TH.night = Object.assign({}, TH.day, { hemi: 0.6, sunI: 1.25, lamp: 1.5 });
    const lit = ["day", "dusk", "night"].map(n => A.lighting(TH, n, "sewer_tunnel"));
    lit.forEach(l => assert.deepEqual(l.T, lit[0].T, "下水道不分白天黑夜"));
    const street = A.lighting(TH, "day", "outer_street").T;
    assert.ok(lit[0].T.hemi < street.hemi && lit[0].T.sunI < street.sunI, "下水道比外城区（白天）暗");
    assert.ok(A.luma(lit[0].T.fog) < 0.15 && A.luma(lit[0].T.sky[0]) < 0.15, "管子里的雾、天都是暗的");
  } finally { P.restore(); }
});

test("接线（#241）：页面在 #242 的登记处和采矿场的美术包后面加载城市类的美术包；没有坚毅生命（美术代码里不碰 shp / units / plate）", () => {
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
  const at = (f) => html.indexOf(`<script src="${f}"></script>`);
  assert.ok(at("hd2d-scenes-city.js") > at("hd2d-scene-art.js") && at("hd2d-scene-art.js") > at("hd2d-layout.js"), "加载顺序：布局 → 登记处 → 美术包");
  const src = fs.readFileSync(path.join(DIR, "hd2d-scenes-city.js"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.ok(!/\bshp\b|\.units\b|\.plate\b/.test(src), "美术包不碰单位数据");
});
