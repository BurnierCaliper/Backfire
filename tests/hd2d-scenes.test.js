// HD-2D 战场原型 · 主人试玩反馈 · 五（#242）：区域场景的美术——采矿场（矿外 / 矿内 / 矿底）和沙漠（沙丘 / 沙珊瑚台地）。
// 每个场景（#239 的 pv.scene）一套：地面、地台侧面、装饰、远景、光照 / 调色、环境动画。美术放在美术包里（hd2d-scenes-*.js），
// 经 hd2d-scene-art.js 登记，hd2d-world.js / hd2d-backdrop.js / hd2d-scene.js 里只有挂钩。
// 都是 Node 能跑的：配置和摆放是纯函数；地台、远景在 Node 里用 vendor 的真 three.js 建；画面（WebGL）截图由仓库主人跑。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("./headless");
const L = require("../prototypes/hd2d/hd2d-layout.js");
const C = require("../prototypes/hd2d/hd2d-camera.js");

const DIR = path.join(__dirname, "..", "prototypes", "hd2d");
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");   // 去掉注释，只看代码
// 缺这几个文件时只是这几条失败（每条测试里各自 require）
const art = () => require("../prototypes/hd2d/hd2d-scene-art.js");
const mine = () => require("../prototypes/hd2d/hd2d-scenes-mine.js");
const packs = () => { mine(); return art(); };

/** 做好了的场景（区域、场景 id），和每个场景远景里一定有的东西（userData.art） */
const DONE = [
  { region: "第一采矿场", scene: "rim", key: "mine1_rim", must: ["pitWall", "rimLip", "rail", "liftShaft", "lift", "pitLight", "farRim"] },
  { region: "第一采矿场", scene: "mid", key: "mine1_mid", must: ["pitWall", "berm", "cone", "rockWall", "foreRock", "liftShaft", "lift", "pitLight"] },
  { region: "第一采矿场", scene: "floor", key: "mine1_floor", must: ["pitFloorWall", "pipes", "vent", "lantern", "floorRock", "foreRock"] },
  // 第二采矿场：第一采矿场的变体，加喷火的管道、橙红发光的岩石
  { region: "第二采矿场", scene: "rim", key: "mine2_rim", must: ["pitWall", "rimLip", "rail", "liftShaft", "lift", "pitLight", "farRim", "firePipe", "fire", "glowRock"] },
  { region: "第二采矿场", scene: "mid", key: "mine2_mid", must: ["pitWall", "berm", "cone", "rockWall", "foreRock", "liftShaft", "lift", "pitLight", "firePipe", "fire", "glowRock"] },
  { region: "第二采矿场", scene: "floor", key: "mine2_floor", must: ["pitFloorWall", "pipes", "vent", "lantern", "floorRock", "foreRock", "firePipe", "fire", "glowRock"] },
  // 第三采矿场：浅坑（矿外看得到坑底）、紫色晶体、半埋的陨石、紫色电弧
  { region: "第三采矿场", scene: "rim", key: "mine3_rim", must: ["pitWall", "pitFloor", "rimLip", "meteor", "crystal", "arc"] },
  { region: "第三采矿场", scene: "floor", key: "mine3_floor", must: ["pitWall", "pitFloor", "rimLip", "meteor", "crystal", "arc", "foreRock"] }
];
const PARTY = ["kolt", "helu", "ruby", "yuito"];
const DESKTOP = { width: 1440, height: 900, top: 46, bottom: 160 };   // 桌面 1440×900：顶栏 + 展开的技能栏
const THEMES = { day: { sky: ["#f6e3b4", "#ecc98c", "#dcac6a", "#c29a66"], fog: 0xd6b985 }, dusk: { sky: ["#ffc47c", "#f28a5a", "#b9587a", "#4b3368"], fog: 0xc98a72 }, night: { sky: ["#2f4673", "#1d2d52", "#101b38", "#060b1a"], fog: 0x1b2742 } };
const gapOf = (type, hp, open) => ({ type, hp: hp || 0, maxHp: hp || 0, open: open !== false, lastFrom: null });

/** 三种棋盘（和 index.html 的三个演示一样的布置：直排三区 + 酸液 + 高地、2×2 + 流沙 + 沙珊瑚台地、十字五区 + 深渊 + 高地……），
 *  再加同一区挤满人的（装饰不能压到挤在边上的人） */
const BOARDS = {
  line3(S) {
    const st = S.setup({ party: PARTY, zoneMode: 3, seed: "hd2d-mine", enemies: [{ id: "guard_sword", lv: 2, zone: 3 }, { id: "guard_gun", lv: 2, zone: 3 }, { id: "thug_hammer", lv: 2, zone: 2 }, { id: "boomcar", lv: 2, zone: 2 }] });
    st.fields[2].acid = true; st.fields[3].highland = true; st.gaps["1-2"] = gapOf("bridge", 12); st.gaps["2-3"] = gapOf("wall", 20, false);
    return st;
  },
  square4(S) {
    const st = S.setup({ party: PARTY, board: "square4", seed: "hd2d-desert", enemies: [{ id: "sandfish_ambush", lv: 2, zone: 1 }, { id: "sandfish_lead", lv: 2, zone: 2 }, { id: "sand_beast", lv: 2, zone: 4 }, { id: "sand_human", lv: 2, zone: 4 }] });
    st.fields[1].quicksand = true; st.gaps["1-3"] = gapOf("void"); st.gaps["2-4"] = gapOf("bridge", 10);
    return st;
  },
  cross5(S) {
    const st = S.setup({ party: PARTY, board: "cross5", seed: "hd2d-cross", enemies: [{ id: "crow", lv: 2, zone: 1 }, { id: "buoy", lv: 2, zone: 1 }, { id: "thug_hammer", lv: 2, zone: 3 }, { id: "guard_gun", lv: 2, zone: 4 }] });
    st.fields[1].abyss = true; st.fields[2].highland = true; st.gaps["2-3"] = gapOf("door", 0, false); st.gaps["3-4"] = gapOf("bridge", 12);
    return st;
  }
};
const FOES = [{ id: "guard_sword", lv: 2 }, { id: "guard_gun", lv: 2 }, { id: "thug_hammer", lv: 2 }, { id: "boomcar", lv: 2 }, { id: "thug_knife", lv: 2 }];
/** 同一块棋盘，每个区轮流挤满：我方 4 人 + 敌人 n 个都站进这个区（站到边上的人最多） */
function crowdedOf(st, zone, n) {
  const c = JSON.parse(JSON.stringify(st));
  c.units.forEach(u => { u.zone = zone; });
  return c;
}
function boardsFor(S) {
  const out = [];
  Object.keys(BOARDS).forEach(id => {
    const st = JSON.parse(JSON.stringify(BOARDS[id](S)));   // BattleSim.setup 交回的是规则那份 state，下一次 setup 会改掉它：先拷一份
    out.push({ id, st });
    const zones = L.boardOf(st).zones.map(z => z.id);
    zones.forEach(z => out.push({ id: id + "·挤在" + z + "区", st: crowdedOf(st, z) }));
    // 再多塞几个敌人进同一区（一排放不下、前后好几排）
    const more = H.load().BattleSim.setup(Object.assign({ party: PARTY, seed: "hd2d-more-" + id, enemies: FOES.map(f => Object.assign({ zone: 1 }, f)) }, id === "line3" ? { zoneMode: 3 } : { board: id === "square4" ? "square4" : "cross5" }));
    out.push({ id: id + "·挤 9 人", st: crowdedOf(more, zones[0]) });
  });
  return out;
}
const layoutOf = (st, d, theme, view) => L.build(st, { view: view || DESKTOP, region: d.region, scene: d.scene, theme: theme || "dusk" });

/* ---------- 真的 three.js（和 tests/hd2d-layout.test.js 的 protoEnv 一样：three 指到 vendor，临时放上假的 document / window）---------- */
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
/** 建一个场景的远景（和场景一样：远景的种类就是布局给的地面主题的 backdrop） */
function backdropOf(B, layout, theme) {
  const look = L.GROUNDS[layout.ground];
  return B.buildBackdrop(look.backdrop, layout.bounds, theme, layout.camera, THEMES[theme]);
}
/** 一个物体里打了 userData.art 的（美术包放的东西）：[{ obj, what }]（实例网格、组都算一个） */
function artOf(root) {
  const out = [];
  root.traverse(o => { if (o.userData && o.userData.art) out.push({ obj: o, what: o.userData.art }); });
  return out;
}

/* ---------- 屏幕上：装饰在单位前面的话，不能挡住他的脚下、他的铭牌 ---------- */
/** 一段镜头：远景用布局的默认镜头和抬高，中景 / 近景用 hd2d-camera.js · pose（和场景、攻击演出的适配器同一个） */
function lenses(layout) {
  const zones = [...new Set(layout.units.map(u => u.zone))];
  const out = [{ tag: "远景", cam: layout.camera, plates: Object.fromEntries(layout.units.map(u => [u.id, { rect: u.rect }])) }];
  zones.forEach(z => ["mid", "near"].forEach(tier => { const p = C.pose(layout, tier, z); out.push({ tag: (tier === "mid" ? "中景 " : "近景 ") + z + " 区", cam: p.cam, plates: p.plates }); }));
  return out;
}
/** 一串点投到屏幕上：外框、离镜头最近的深度、最靠前的 z（整个都在某人后面的东西，挡不到他：镜头在前上方，看他脚下的视线只经过他前面） */
function screenOf(cam, pts) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, near = Infinity, maxZ = -Infinity;
  pts.forEach(p => {
    const s = L.project(cam, p);
    near = Math.min(near, s.depth); maxZ = Math.max(maxZ, p.z);
    if (s.depth <= 0) return;
    x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
  });
  return { x0, x1, y0, y1, near, maxZ };
}
/** 一个装饰拆成一块块（屏幕上一块块地比）：普通网格按真的顶点（转过的石头、斜着的坑壁，外框比本身大一圈，不能拿外框算），
 *  实例网格每个实例按它自己的外框八个角。返回 [点的列表] */
function piecesOf(THREE, obj) {
  const out = [], v = new THREE.Vector3(), m = new THREE.Matrix4();
  obj.updateMatrixWorld(true);
  obj.traverse(o => {
    if (!o.isMesh) return;
    const geo = o.geometry, pos = geo.attributes.position;
    if (o.isInstancedMesh) {
      if (!geo.boundingBox) geo.computeBoundingBox();
      const b = geo.boundingBox;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m); m.premultiply(o.matrixWorld);
        const pts = [];
        [b.min.x, b.max.x].forEach(x => [b.min.y, b.max.y].forEach(y => [b.min.z, b.max.z].forEach(z => { v.set(x, y, z).applyMatrix4(m); pts.push({ x: v.x, y: v.y, z: v.z }); })));
        out.push(pts);
      }
    } else {
      const pts = [];
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); pts.push({ x: v.x, y: v.y, z: v.z }); }
      out.push(pts);
    }
  });
  return out;
}
/** 单位脚下那一小块（接触阴影的核心，半径 0.42）在屏幕上的外框 */
function footBox(cam, u) {
  const ps = [[-0.42, 0], [0.42, 0], [0, -0.42], [0, 0.42]].map(([dx, dz]) => L.project(cam, { x: u.x + dx, y: u.groundY, z: u.z + dz }));
  return { x0: Math.min(...ps.map(p => p.x)), x1: Math.max(...ps.map(p => p.x)), y0: Math.min(...ps.map(p => p.y)), y1: Math.max(...ps.map(p => p.y)) };
}
const hits = (a, b) => a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5;
/** 铭牌卡片停着时的矩形：布局给的矩形上下各多让出了浮动的幅度（CONFIG.plate.bob），这里去掉 */
const cardOf = (r) => ({ x0: r.x0, x1: r.x1, y0: r.y0 + L.CONFIG.plate.bob, y1: r.y1 - L.CONFIG.plate.bob });

/* ---------- 1. 每个场景选出自己的一套 ---------- */
test("每个场景选出自己的一套（#242）：区域 + 场景 id（world-data.js · BATTLE_SCENES）→ 这个场景自己的地面主题（顶面、侧面、贴花、地台外的地、远景、灯），每个场景各不相同；美术包里有它的装饰、远景、光照、环境动画；布局按它换默认地台，有场地效果的照旧；别的区域、认不得的场景不受影响", () => {
  const A = packs(), c = H.load(), T = vm.runInContext("BATTLE_SCENES", c);
  const keys = DONE.map(d => L.groundOf(d.region, d.scene));
  assert.equal(new Set(keys).size, DONE.length, "每个场景各是各的地面主题");
  DONE.forEach((d, i) => {
    const tag = d.region + " · " + d.scene;
    assert.ok(T[d.region].some(s => s.id === d.scene), tag + "：是正式场景表里的场景");
    assert.equal(keys[i], d.key, tag + "：选出这个场景自己的那一套");
    assert.notEqual(keys[i], L.REGIONS[d.region], tag + "：不再是区域以前的样子");
    const look = L.GROUNDS[d.key], a = A.of(d.key);
    assert.ok(a && a.region === d.region && a.scene === d.scene, tag + "：登记过");
    ["tex", "side"].forEach(k => assert.ok(A.texture(look[k], {}) || ["concrete", "gravel", "dune", "strata", "brick", "sheet", "steel"].includes(look[k]), `${tag}：${k} 贴图 ${look[k]} 画得出来`));
    assert.ok(look.decals && Object.keys(look.decals).length >= 2, tag + "：有贴花");
    assert.equal(look.backdrop, d.key, tag + "：远景是这个场景自己的");
    assert.ok(Number.isFinite(look.ground), tag + "：地台外大片地面的颜色");
    ["decor", "backdrop", "light", "ambient"].forEach(k => assert.ok(a.art[k], `${tag}：美术包里有 ${k}`));
    // 布局：给了区域 + 场景，默认地台（含只是垫高的高地）换成这一套；有场地效果的不换
    Object.keys(BOARDS).forEach(id => {
      const out = layoutOf(BOARDS[id](c.BattleSim), d);
      assert.deepEqual([out.region, out.scene, out.ground], [d.region, d.scene, d.key], `${tag} ${id}`);
      out.zones.forEach(z => assert.equal(z.ground, z.effects.every(e => e === "highland") ? d.key : null, `${tag} ${id} ${z.id} 区（${z.effects.join("+") || "默认"}）`));
    });
  });
  // 每两个场景的样子都看得出不同（顶面、侧面、远景、地面颜色至少有一样不一样）
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = L.GROUNDS[keys[i]], b = L.GROUNDS[keys[j]];
    assert.ok(a.tex !== b.tex || a.side !== b.side || a.ground !== b.ground || a.tint !== b.tint, `${keys[i]} 和 ${keys[j]} 看起来一样`);
  }
  // 别的区域照旧；认不得的场景 = 区域自己的；正式表里没有的场景 id 不会被美术包加进来
  ["外城区", "巨人城", "天网设施", "下水道"].forEach(r => Object.keys(L.SCENES[r]).forEach(s => assert.equal(L.groundOf(r, s), L.REGIONS[r], r + " · " + s)));
  assert.equal(L.groundOf("第一采矿场", "dune"), L.REGIONS["第一采矿场"]);
  assert.equal(L.groundOf("第一采矿场"), L.REGIONS["第一采矿场"], "没有场景 = 区域以前的样子");
  Object.keys(L.SCENES).forEach(r => assert.deepEqual(Object.keys(L.SCENES[r]).sort(), JSON.parse(JSON.stringify(T[r].map(s => s.id))).sort(), r + "：场景 id 还是正式表那几个"));
  assert.equal(L.sceneOf("第三采矿场", "mid"), null, "第三采矿场还是没有矿内");
  assert.deepEqual(c.__errors, []);
});

test("真的 three.js 里每个场景建出自己的一套（#242）：默认地台的顶面 / 侧面贴图是这个场景的，地台上的装饰是美术包摆的（没有以前的废铁、管道），远景里有这个场景该有的东西；有场地效果的地台照旧", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { THREE, W, B, A } = P;
  try {
    const S = H.load().BattleSim;
    for (const d of DONE) {
      const look = L.GROUNDS[d.key], layout = layoutOf(BOARDS.line3(S), d), ctx = { anim: [], lamps: [], fxLights: 0, theme: "dusk" };
      layout.zones.forEach(z => {
        const g = W.buildZone(z, ctx), body = g.children.find(o => o.userData.part === "body"), tag = `${d.key} ${z.id} 区（${z.kind}）`;
        if (z.ground) {
          if (A.texture(look.tex, null)) assert.equal(body.material[0].map.name, look.tex, tag + "：顶面是这个场景的贴图");
          if (A.texture(look.side, null)) assert.equal(body.material[1].map.name, look.side, tag + "：侧面是这个场景的贴图");
          assert.ok(artOf(g).length >= 1, tag + "：有美术包摆的装饰");
          assert.ok(!g.children.some(o => o.isMesh && o.geometry.type === "CylinderGeometry" && o.geometry.parameters.height > 3), tag + "：没有以前沿后沿的那根管道");
        } else assert.equal(artOf(g).length, 0, tag + "：有场地效果的地台照旧（不摆美术包的装饰）");
        W.disposeTree(g);
      });
      for (const theme of ["day", "dusk", "night"]) {
        const bd = backdropOf(B, layout, theme), got = new Set(artOf(bd.group).map(o => o.what));
        d.must.forEach(w => assert.ok(got.has(w), `${d.key} ${theme}：远景里有 ${w}`));
        bd.update(1, 0.016); bd.update(1, 0);
        bd.dispose();
      }
    }
  } finally { P.restore(); }
});

test("矿外是往下陷的大矿坑（#242 截图验收 · 第二次：对面坑壁太近、太高、太亮）：对面坑壁推得很远（离坑边 ≥ 镜头到坑边的九成），对面坑沿就在顶栏下面一点；从默认镜头看，顶栏到这边坑沿之间一大半是漆黑的坑，上沿亮；坑壁上零星的灯、一两部运载电梯在黑处看得见（够大），沿竖直的轨道上下、一直看得见；天幕在坑后面", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { THREE, B } = P, M = mine();
  try {
    const S = H.load().BattleSim, Q = M.PIT.rim, lumaOf = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    for (const d of DONE.filter(x => x.scene === "rim" && x.region !== "第三采矿场")) for (const bdx of boardsFor(S).filter(x => !x.id.includes("挤"))) {
      const layout = layoutOf(bdx.st, d), cam = layout.camera, b = layout.bounds, tag = `${d.key} ${bdx.id}`;
      const dims = M.pitDims(Q, b, cam), usable = DESKTOP.height - DESKTOP.top - DESKTOP.bottom;
      assert.ok(dims.D >= (cam.pos.z - dims.rimZ) * 0.9 && dims.D >= 36, `${tag}：对面坑壁离坑边只有 ${dims.D.toFixed(1)}（镜头到坑边 ${(cam.pos.z - dims.rimZ).toFixed(1)}）`);
      const farY = L.project(cam, { x: dims.cx, y: dims.top, z: dims.zFar }).y, nearY = L.project(cam, { x: dims.cx, y: L.CONFIG.groundY, z: dims.rimZ }).y;
      assert.ok(farY > DESKTOP.top + 10 && farY < DESKTOP.top + usable * 0.12, `${tag}：对面坑沿在顶栏下面一点（屏幕 y ${farY.toFixed(0)}）`);
      const bd = backdropOf(B, layout, "dusk");
      bd.group.updateMatrixWorld(true);
      const sky = bd.group.children.find(o => o.userData.layer === "sky");
      sky.geometry.computeBoundingBox();
      assert.ok(sky.geometry.boundingBox.max.z < dims.zFar - 4, `${tag}：天幕（z ${sky.geometry.boundingBox.max.z.toFixed(1)}）在对面坑沿（${dims.zFar.toFixed(1)}）后面`);
      assert.equal(bd.groundEdge, dims.rimZ, `${tag}：地台外面那片地铺到坑边为止`);
      // 从默认镜头往顶栏到坑边之间打一排排射线：碰到的坑壁那一面有多亮。上沿亮；顶栏到坑边之间一大半是漆黑的
      const wall = artOf(bd.group).find(o => o.what === "pitWall").obj, col = wall.geometry.attributes.color, c = new THREE.Color();
      const shade = (h) => { c.setRGB(col.getX(h.face.a), col.getY(h.face.a), col.getZ(h.face.a)); return lumaOf(c); };
      const rayAt = (px, py) => {
        const cm = new THREE.PerspectiveCamera(cam.fov, cam.aspect, 0.5, 400);
        cm.position.set(cam.pos.x, cam.pos.y, cam.pos.z); cm.lookAt(cam.target.x, cam.target.y, cam.target.z); cm.updateMatrixWorld(true);
        const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(px / cam.width * 2 - 1, 1 - py / cam.height * 2), cm);
        return ray.intersectObject(wall, false)[0] || null;
      };
      const rim = rayAt(cam.width / 2, farY + 3);
      assert.ok(rim && shade(rim) > 0.06,`${tag}：对面坑沿那一级不该是黑的（${rim && shade(rim).toFixed(3)}）`);
      let dark = 0, all = 0;
      for (let py = DESKTOP.top + 2; py < nearY - 2; py += 4) [0.3, 0.5, 0.7].forEach(u => { const h = rayAt(cam.width * u, py); all++; if (h && h.point.y < dims.top && shade(h) < 0.015) dark++; });
      assert.ok(dark / all >= 0.55, `${tag}：顶栏到坑边之间只有 ${(dark / all * 100).toFixed(0)}% 是漆黑的坑`);
      // 坑壁上零星的灯：在黑处、在画面里、够大（屏幕上至少 3 像素宽）
      const lights = artOf(bd.group).filter(o => o.what === "pitLight");
      assert.ok(lights.length >= 6, `${tag}：坑壁上只有 ${lights.length} 盏灯`);
      lights.forEach(({ obj }) => {
        const p = obj.getWorldPosition(new THREE.Vector3()), s = L.project(cam, p), r = obj.geometry.parameters.radius;
        assert.ok(s.y > farY && s.y < nearY && s.x > 0 && s.x < cam.width, `${tag}：灯在画面里的坑壁上（${s.x.toFixed(0)}, ${s.y.toFixed(0)}）`);
        assert.ok(L.project(cam, { x: p.x + r, y: p.y, z: p.z }).x - s.x >= 1.5, `${tag}：灯太小，远景里看不见`);
      });
      // 运载电梯：一两部，罐笼在屏幕上至少 12 像素高；从对面坑沿开到黑处，最低也还在坑边上面（一直看得见）；沿竖直的轨道走；轨道边上一串小信号灯
      const lifts = artOf(bd.group).filter(o => o.what === "lift");
      assert.ok(lifts.length >= 1 && lifts.length <= 2, `${tag}：一两部运载电梯`);
      lifts.forEach(({ obj }) => {
        const a = obj.userData.ambient, x0 = obj.position.x, box = obj.children[0].geometry.parameters, z = obj.position.z;
        const hpx = L.project(cam, { x: x0, y: a.y1, z }).y - L.project(cam, { x: x0, y: a.y1 + box.height, z }).y;
        assert.ok(hpx >= 12, `${tag}：罐笼在远景里只有 ${hpx.toFixed(1)} 像素高`);
        assert.ok(a.y0 > dims.top - 1 && a.y1 > dims.yOcc && L.project(cam, { x: x0, y: a.y1 - box.height / 2, z }).y < nearY - 4, `${tag}：电梯从坑沿（${a.y0.toFixed(1)}）开到看得见的黑处（${a.y1.toFixed(1)}，挡住的地方 ${dims.yOcc.toFixed(1)}）`);
        for (let s = 0; s < 60; s++) bd.update(s, 1);
        assert.equal(obj.position.x, x0, `${tag}：电梯沿竖直的轨道走`);
        const dots = obj.parent.children.find(o => o.isInstancedMesh && o.geometry.type === "SphereGeometry");
        assert.ok(dots && dots.count >= 3, `${tag}：轨道边上一串小信号灯`);
      });
      bd.dispose();
    }
    // 接线：天幕挪多远问美术包（hd2d-backdrop.js 一行挂钩）
    assert.match(code(read("hd2d-backdrop.js")), /const rz = hz \+ \(\(ART\.skyGap && ART\.skyGap\(kind, bounds, cam\)\) \|\| BACKDROP\.skyGap\)/);
  } finally { P.restore(); }
});

/** 从布局的默认镜头往屏幕上的一点（像素）打一条线，先碰到远景里的什么（userData.art；碰不到 = null）。
 *  solid = 只算挡得住视线的：藏着的、加色发光的（光晕、电弧、亮的坑底）、Sprite 不算 */
function hitAt(THREE, layout, root, px, py, solid) {
  const c = layout.camera, cam = new THREE.PerspectiveCamera(c.fov, c.aspect, 0.5, 400);
  cam.position.set(c.pos.x, c.pos.y, c.pos.z); cam.lookAt(c.target.x, c.target.y, c.target.z); cam.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(px / c.width * 2 - 1, 1 - py / c.height * 2), cam);
  const shown = (o) => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
  for (const h of ray.intersectObject(root, true)) {
    if (solid && (h.object.isSprite || !shown(h.object) || (h.object.material && h.object.material.blending === THREE.AdditiveBlending))) continue;
    for (let o = h.object; o; o = o.parent) if (o.userData && o.userData.art) return { what: o.userData.art, point: h.point };
  }
  return null;
}
test("矿内（#242 截图验收）：近处一面不规则的岩壁，中间一个大开口——从默认镜头看，画面左右两边是近处的岩壁，开口里看到的是很远的对面坑壁（离运输道的边至少 14），坑底漆黑；岩壁在灯后面、伸出画面上沿", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { THREE, B } = P, M = mine();
  try {
    const S = H.load().BattleSim, d = DONE.find(x => x.scene === "mid");
    for (const bdx of boardsFor(S).filter(x => !x.id.includes("挤"))) {
      const layout = layoutOf(bdx.st, d), b = layout.bounds, tag = bdx.id, bd = backdropOf(B, layout, "dusk");
      bd.group.updateMatrixWorld(true);
      const dims = M.pitDims(M.PIT.mid, b, layout.camera);
      assert.ok(dims.D >= 14 - 1e-9, `${tag}：对面坑壁离运输道的边只有 ${dims.D.toFixed(1)}`);
      // 运输道的边在屏幕上的高度（地台后沿那条线）；往上到顶栏下面是远景
      const edgeY = L.project(layout.camera, { x: dims.cx, y: L.CONFIG.groundY, z: dims.rimZ }).y, topY = DESKTOP.top + 8;
      const ys = [0.15, 0.5, 0.85].map(k => edgeY - 6 - (edgeY - 6 - topY) * k);
      ys.forEach(py => {
        const mid = hitAt(THREE, layout, bd.group, layout.camera.width / 2, py);
        assert.ok(mid && ["pitWall", "lift", "liftShaft", "pitLight"].includes(mid.what), `${tag}：开口正中（屏幕 y ${py.toFixed(0)}）看到的是 ${mid && mid.what}，不是对面的坑壁`);
        assert.ok(mid.point.z < dims.rimZ - 12, `${tag}：开口里看到的东西很远（z ${mid.point.z.toFixed(1)}，运输道的边 ${dims.rimZ.toFixed(1)}）`);
        [12, layout.camera.width - 12].forEach(px => {
          const side = hitAt(THREE, layout, bd.group, px, py);
          assert.ok(side && side.what === "rockWall", `${tag}：画面边上（x ${px}, y ${py.toFixed(0)}）是 ${side && side.what}，不是近处的岩壁`);
        });
      });
      // 开口里最下面（运输道的边、挡车土埂再往上一点）是漆黑的坑底：碰到的那一面颜色很暗
      const low = hitAt(THREE, layout, bd.group, layout.camera.width / 2 + 3, edgeY - 22);
      assert.ok(low && low.what === "pitWall", `${tag}：开口最下面看到的是 ${low && low.what}，不是坑壁`);
      const wall = artOf(bd.group).find(o => o.what === "pitWall").obj, pos = wall.geometry.attributes.position, cl = wall.geometry.attributes.color;
      let s = 0, n = 0;
      for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getY(i) - low.point.y) < 0.6 && Math.abs(pos.getX(i) - low.point.x) < 2) { s += 0.2126 * cl.getX(i) + 0.7152 * cl.getY(i) + 0.0722 * cl.getZ(i); n++; }
      assert.ok(n > 0 && s / n < 0.02, `${tag}：坑底不够黑（${(s / Math.max(1, n)).toFixed(3)}）`);
      bd.dispose();
    }
  } finally { P.restore(); }
});

test("第二采矿场是第一采矿场的变体（#242）：三个场景一一对上，色调更红（岩石、地面、雾都更偏红），地台上有几块带发光裂纹的石头，远景有喷火的管道和橙红发光的岩石", () => {
  const A = packs(), M = mine(), themes = sceneThemes();
  const red = (c) => { const n = A.hexOf(c); return ((n >> 16) & 255) / Math.max(1, (n >> 8) & 255); };   // 红 / 绿：越大越红
  const avg = (list) => list.reduce((s, c) => s + red(c), 0) / list.length;
  assert.ok(avg(M.PALETTE.mine2.rock) > avg(M.PALETTE.mine1.rock) + 0.15 && avg(M.PALETTE.mine2.wall) > avg(M.PALETTE.mine1.wall) + 0.1, "岩石更红");
  ["rim", "mid", "floor"].forEach(s => {
    const a = L.GROUNDS[L.groundOf("第一采矿场", s)], b = L.GROUNDS[L.groundOf("第二采矿场", s)], tag = s;
    assert.equal(b.tex, a.tex, tag + "：同一种地面，只是换了颜色");
    assert.ok(red(b.ground) > red(a.ground) && red(b.tint) > red(a.tint), tag + "：地面更红");
    assert.ok(Number.isFinite(b.glow) && b.decals.ember > 0, tag + "：矿渣里带余火");
    const k1 = A.of(L.groundOf("第一采矿场", s)), k2 = A.of(L.groundOf("第二采矿场", s));
    assert.ok(k2.art.decor.glow > 0 && k2.art.backdrop.fire && k2.art.backdrop.glow && k2.art.ambient.includes("fire"), tag + "：发光岩石、喷火管道");
    ["day", "dusk", "night"].forEach(name => assert.ok(red(A.lighting(themes, name, k2.key).T.fog) > red(A.lighting(themes, name, k1.key).T.fog), `${tag} ${name}：雾更红`));
  });
  // 地台上真的摆得出几块发光的石头（直排三区，每个场景合起来至少一块）
  const S = H.load().BattleSim;
  ["rim", "mid", "floor"].forEach(s => {
    const key = L.groundOf("第二采矿场", s), layout = layoutOf(BOARDS.line3(S), { region: "第二采矿场", scene: s });
    assert.ok(layout.zones.filter(z => z.ground).some(z => M.zonePlan(z, key).some(p => p.kind === "glow")), s + "：地台上有发光的石头");
  });
});

test("第三采矿场（#242）：浅坑——矿外从默认镜头看得到远处的坑底；深色的坑里到处是紫色晶体（地台上每块都有晶簇、远景里几十丛，发紫光）；背景里巨大的陨石：半截埋在地里（球心就在坑底那么高）、整个在顶栏下面、占画面宽的四分之一以上，月球色（灰）、有月球坑（表面凹凸）、发紫光（自发光、亮的坑底、光晕）；矿底的光照不随时间变；几处在跳紫色电弧", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { THREE, B, A } = P, M = mine();
  try {
    const S = H.load().BattleSim, hsl = (c) => { const h = {}; new THREE.Color(c).getHSL(h); return h; }, purple = (c) => { const h = hsl(c); return h.h > 0.66 && h.h < 0.88 && h.s > 0.4; };
    for (const d of DONE.filter(x => x.region === "第三采矿场")) {
      for (const bdx of boardsFor(S).filter(x => !x.id.includes("挤"))) {
        const layout = layoutOf(bdx.st, d), cam = layout.camera, tag = `${d.key} ${bdx.id}`, dims = M.mine3Dims(d.scene, layout.bounds, cam), m = dims.meteor;
        assert.equal(m.y, dims.floorY, tag + "：陨石的球心就在坑底那么高（半截埋在地里）");
        const top = L.project(cam, { x: m.x, y: m.y + m.r, z: m.z }), lf = L.project(cam, { x: m.x - m.r, y: m.y, z: m.z }), rt = L.project(cam, { x: m.x + m.r, y: m.y, z: m.z });
        assert.ok(top.y > DESKTOP.top + 4 && top.y < DESKTOP.top + 60, `${tag}：陨石的顶在顶栏下面一点（屏幕 y ${top.y.toFixed(0)}）`);
        assert.ok(rt.x - lf.x > cam.width * (d.scene === "rim" ? 0.24 : 0.28) && lf.x > 0 && rt.x < cam.width, `${tag}：陨石在画面里、够大（宽 ${(rt.x - lf.x).toFixed(0)} 像素）`);
        const bd = backdropOf(B, layout, "dusk");
        bd.group.updateMatrixWorld(true);
        const arts = artOf(bd.group), met = arts.find(o => o.what === "meteor").obj;
        assert.ok(met.position.z + m.r < layout.bounds.minZ - L.CONFIG.lamps.back - 1, `${tag}：陨石在灯后面`);
        // 月球色：顶点颜色是灰的（饱和度低）；月球坑：表面离球心有远有近
        const body = met.children.find(o => o.isMesh && !o.material.transparent), glow = met.children.find(o => o.isMesh && o.material.transparent);
        const cl = body.geometry.attributes.color, ps = body.geometry.attributes.position, c = new THREE.Color();
        let sat = 0, lo = Infinity, hi = 0;
        for (let i = 0; i < cl.count; i++) { c.setRGB(cl.getX(i), cl.getY(i), cl.getZ(i)); sat += hsl(c).s / cl.count; const k = Math.hypot(ps.getX(i), ps.getY(i), ps.getZ(i)) / m.r; lo = Math.min(lo, k); hi = Math.max(hi, k); }
        assert.ok(sat < 0.12, `${tag}：陨石不是月球的灰（饱和度 ${sat.toFixed(2)}）`);
        assert.ok(lo < 0.96 && hi > 1, `${tag}：陨石上要有月球坑（表面 ${lo.toFixed(2)}–${hi.toFixed(2)} × 半径）`);
        // 发紫光：整块淡淡的紫色自发光 + 一个个亮的坑底（加色）+ 背后的光晕 + 照亮附近的紫光
        assert.ok(purple(body.material.emissive) && body.material.emissiveIntensity > 0, tag + "：陨石自己发紫光");
        assert.ok(glow && glow.geometry.attributes.position.count / 3 >= 30 && glow.material.blending === THREE.AdditiveBlending, tag + "：陨石上亮的坑底");
        assert.ok(met.children.some(o => o.isSprite) && met.children.some(o => o.isPointLight && purple(o.color)), tag + "：陨石的紫色光晕和紫光");
        // 紫色晶体：远景里几十丛（实例网格），都发紫光
        const crystals = arts.filter(o => o.what === "crystal").map(o => o.obj);
        assert.ok(crystals.reduce((n, o) => n + o.count, 0) >= 100, `${tag}：远景里的紫色晶体太少`);
        crystals.forEach(o => assert.ok(purple(o.material.emissive) && o.material.emissiveIntensity > 1, `${tag}：晶体发紫光`));
        // 电弧：几处
        assert.equal(arts.filter(o => o.what === "arc").length, A.of(d.key).art.backdrop.arcs, tag + "：几处在跳电弧");
        // 矿外：浅坑，从默认镜头往陨石左边、对面坑壁脚下和这边坑沿之间打射线，碰到的是坑底（或者坑底上的晶体）
        if (d.scene === "rim") {
          const y0 = L.project(cam, { x: dims.cx, y: dims.floorY, z: dims.zBase }).y, y1 = L.project(cam, { x: dims.cx, y: L.CONFIG.groundY, z: dims.rimZ }).y;
          let floor = 0, all = 0;
          for (let py = y0 + 4; py < y1 - 4; py += 6) [0.12, 0.25, 0.38].forEach(u => { const h = hitAt(THREE, layout, bd.group, cam.width * u, py, true); all++; if (h && (h.what === "pitFloor" || h.what === "crystal") && Math.abs(h.point.y - dims.floorY) < 1.5) floor++; });
          assert.ok(all > 0 && floor / all > 0.8, `${tag}：矿外看得到远处的坑底（${floor}/${all}）`);
          assert.ok(dims.floorY > L.CONFIG.groundY - 10, tag + "：坑浅");
        }
        bd.dispose();
      }
      // 地台上：每块默认地台都有一丛紫色晶体
      const layout = layoutOf(BOARDS.line3(S), d);
      layout.zones.filter(z => z.ground).forEach(z => assert.ok(M.zonePlan(z, d.key).some(p => p.kind === "crystal"), `${d.key} ${z.id} 区：地台上有紫色晶体`));
    }
    // 矿底：白天黑夜几乎没区别（三个光影主题同一套），比矿外暗
    const themes = sceneThemes(), lit = ["day", "dusk", "night"].map(n => A.lighting(themes, n, "mine3_floor"));
    lit.forEach(l => assert.deepEqual(l.T, lit[0].T, "第三采矿场的矿底光照不随时间变"));
    ["day", "dusk", "night"].forEach(n => { const r = A.lighting(themes, n, "mine3_rim").T; assert.ok(lit[0].T.hemi < r.hemi && lit[0].T.sunI < r.sunI, n + "：矿底比矿外暗"); });
  } finally { P.restore(); }
});

/* ---------- 2. 装饰不压住站位 / 铭牌 ---------- */
test("装饰不压住站位（#242）：地台上的装饰只摆在左右两条边带（脚下最多站到站位区的边，再让开脚下那一圈）和左右矮一截的台子上，在外轮廓里面；各种棋盘、每个区挤满人时，装饰的底面都碰不到任何人脚下那一圈", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { THREE, W, A } = P;
  const M = mine();
  try {
    const S = H.load().BattleSim, stand = L.CONFIG.zoneSize / 2 - L.CONFIG.pad, FOOT = A.SPOT.foot;
    assert.ok(FOOT >= 0.42, "让开的不比接触阴影的核心（0.42）小");
    for (const d of DONE) {
      for (const bdx of boardsFor(S)) {
        const layout = layoutOf(bdx.st, d), ctx = { anim: [], lamps: [], fxLights: 0, theme: "dusk" };
        const zones = layout.zones.filter(z => z.ground);
        assert.ok(zones.reduce((n, z) => n + M.zonePlan(z, d.key).length, 0) >= zones.length, `${d.key} ${bdx.id}：地台上摆了装饰（平均每块至少一个）`);
        zones.forEach(z => {
          const tag = `${d.key} ${bdx.id} ${z.id} 区`, plan = M.zonePlan(z, d.key);
          plan.forEach(p => {
            assert.ok(Math.abs(p.x) >= stand + FOOT + p.size - 1e-9, `${tag}：装饰 (${p.x}, ${p.z}) 离站位区太近`);
            if (p.on === "band") assert.ok(L.outlineDist(z.outline.pts, p.x, p.z) >= p.size, `${tag}：装饰 (${p.x}, ${p.z}) 悬在外轮廓外面`);
            else assert.ok(z.outline.ledges.some(l => L.insideOutline(l.pts, p.x, p.z)), `${tag}：台子上的装饰不在台子上`);
          });
          // 建出来：每个装饰的底面（世界坐标的外框）碰不到任何人脚下那一圈；地台上的人脚下的点都在站位区里（装饰让开的就是这一块）
          const g = W.buildZone(z, ctx);
          g.updateMatrixWorld(true);
          const here = layout.units.filter(u => u.zone === z.id);
          here.forEach(u => assert.ok(Math.abs(u.x - z.cx) <= stand + 1e-6, `${tag}：${u.plate.name} 站到了站位区外面`));
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

test("装饰不压住铭牌（#242）：远景、中景、近景（每个有人的区）里，地台上和战场周围的装饰只要在某个人前面（离镜头更近），在屏幕上就不挡他的脚下、不压他的铭牌；战场周围的东西都在战场范围外面（后面先让开灯）", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { THREE, W, B } = P;
  let checked = 0;   // 比过的「装饰在某人前面」的次数（不能一次都没比）
  try {
    const S = H.load().BattleSim;
    for (const d of DONE) {
      for (const bdx of boardsFor(S)) {
        const layout = layoutOf(bdx.st, d), ctx = { anim: [], lamps: [], fxLights: 0, theme: "dusk" }, root = new THREE.Group();
        layout.zones.forEach(z => root.add(W.buildZone(z, ctx)));
        const bd = backdropOf(B, layout, "dusk");
        root.add(bd.group);
        root.updateMatrixWorld(true);
        const things = artOf(root).filter(o => !o.obj.parent || !o.obj.parent.userData.art).flatMap(o => piecesOf(THREE, o.obj).map(pts => ({ what: o.what, pts })));
        // 战场周围的东西：在战场范围外面（不进任何地台，后面的在灯后面）
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
              if (!q || !q.rect || s.near >= ud - 0.05 || s.maxZ < u.z - 0.1) return;   // 在他后面（铭牌是 DOM，盖在后面的东西上面）
              checked++;
              assert.ok(!hits(s, footBox(lens.cam, u)), `${d.key} ${bdx.id} ${lens.tag}：${th.what} 挡住了 ${u.plate.name} 的脚下`);
              assert.ok(!hits(s, cardOf(q.rect)), `${d.key} ${bdx.id} ${lens.tag}：${th.what} 压住了 ${u.plate.name} 的铭牌`);
            });
          });
        }
        bd.dispose(); W.disposeTree(root);
      }
    }
    assert.ok(checked > 100, `比过的「装饰在某人前面」只有 ${checked} 次`);
  } finally { P.restore(); }
});

/* ---------- 3. 光照 ---------- */
test("光照 / 调色（#242）：每个场景有自己的一套（hd2d-scene-art.js · lighting），按场景改光影主题；场景（hd2d-scene.js）开战时换上它，所有用到光影主题的地方都读改过的那一套", () => {
  const A = packs(), themes = sceneThemes();
  DONE.forEach(d => ["day", "dusk", "night"].forEach(name => {
    const lit = A.lighting(themes, name, d.key);
    assert.ok(lit && lit.T && typeof lit.name === "string", `${d.key} ${name}：有自己的光照`);
    ["sky", "fog", "hemi", "sunI", "exposure", "grade", "lamp", "sunPos", "rimPos"].forEach(k => assert.ok(lit.T[k] != null, `${d.key} ${name}：${k}`));
  }));
  assert.equal(A.lighting(themes, "dusk", "outer"), null, "没登记的地面主题：照旧用光影主题");
  // 矿内压暗：同一个采矿场、同一个光影主题，矿内的环境光 / 主光 / 曝光都比矿外低，雾更暗；灯更显眼（灯的倍数不比矿外小）
  const done = (r, s) => DONE.find(d => d.region === r && d.scene === s);
  ["第一采矿场", "第二采矿场"].forEach(r => {
    const rim = done(r, "rim"), mid = done(r, "mid");
    if (!rim || !mid) return;
    ["day", "dusk", "night"].forEach(name => {
      const a = A.lighting(themes, name, rim.key).T, b = A.lighting(themes, name, mid.key).T, tag = `${r} ${name}`;
      ["hemi", "sunI", "exposure"].forEach(k => assert.ok(b[k] < a[k] * 0.95, `${tag}：矿内的 ${k} ${b[k]} 没比矿外 ${a[k]} 暗`));
      assert.ok(A.luma(b.fog) < A.luma(a.fog) * 0.8, `${tag}：矿内的雾没比矿外暗`);
      assert.ok(b.lamp >= a.lamp, `${tag}：矿内的灯不比矿外弱`);
    });
  });
  // 矿底：白天黑夜几乎没区别（三个光影主题出来的是同一套），比矿内还暗，全靠提灯（灯的倍数最大）；提灯克制：战场上最多两盏，坑壁上最多两盏
  ["第一采矿场", "第二采矿场"].forEach(r => {
    const fl = done(r, "floor"), mid = done(r, "mid");
    if (!fl) return;
    const lit = ["day", "dusk", "night"].map(name => A.lighting(themes, name, fl.key));
    assert.ok(lit.every(l => l.fixed && l.name === lit[0].name), r + "：矿底不分白天黑夜");
    lit.forEach(l => assert.deepEqual(l.T, lit[0].T, r + "：矿底的光照不随时间变"));
    if (mid) ["day", "dusk", "night"].forEach(name => {
      const m = A.lighting(themes, name, mid.key).T, f = lit[0].T;
      ["hemi", "sunI"].forEach(k => assert.ok(f[k] < m[k], `${r} ${name}：矿底的 ${k} ${f[k]} 不比矿内 ${m[k]} 暗`));
      assert.ok(f.lamp >= m.lamp, `${r} ${name}：矿底的灯不比矿内弱`);
    });
    ["day", "dusk", "night"].forEach(name => assert.ok(L.lampPlan(fl.key, name).count <= 2, r + "：战场上的提灯最多两盏"));
    const F = mine().FLOOR[A.of(fl.key).art.backdrop.floor];
    assert.ok(F.lanterns.n <= 2, r + "：坑壁上的提灯最多两盏");
  });
  // 改的是一份拷贝，光影主题本身不变
  const before = JSON.stringify(themes);
  DONE.forEach(d => A.lighting(themes, "night", d.key));
  assert.equal(JSON.stringify(themes), before);
  // 场景：开战时换上场景的光照，主题的每一处读法都换成 themeNow()（只剩算地面颜色比例的 THEMES.day）
  const src = code(read("hd2d-scene.js"));
  assert.match(src, /const lit = ART\.lighting\(THEMES, state\.meta\.theme, layout\.ground\);/);
  assert.match(src, /state\.lit = lit \? lit\.T : null;\s*if \(lit\) state\.meta\.theme = lit\.name;/);
  assert.deepEqual([...src.matchAll(/THEMES\[[^\]]+\]/g)].map(m => m[0]).sort(), ["THEMES[state.meta.theme]"], "只剩 themeNow() 里那一处");
  assert.equal((src.match(/themeNow\(\)/g) || []).length >= 5, true, "applyTheme / applyFog / syncBackdrop / fitShadow / 每一帧都读 themeNow()");
});
/** hd2d-scene.js 里的光影主题表（THEMES）：从源码里取出来（场景模块要 WebGL，Node 里建不起来） */
function sceneThemes() {
  const src = read("hd2d-scene.js"), at = src.indexOf("const THEMES = {"), end = src.indexOf("\n};", at);
  return vm.runInNewContext("(" + src.slice(at + "const THEMES = ".length, end + 2) + ")");
}

/* ---------- 4. 环境动画 ---------- */
/** 跑 secs 秒远景的动画（每帧 1/30 秒；reduced = 减少动态效果：dt = 0、时间停住） */
function run(bd, secs, reduced, t0) {
  let t = t0 || 0;
  for (let f = 0; f < secs * 30; f++) { if (!reduced) t += 1 / 30; bd.update(t, reduced ? 0 : 1 / 30); }
}
test("环境动画（#242）：每个场景配置里列的环境动画都在（运载电梯时不时上下，停多久、走多快按 AMBIENT 的配置；坑壁上的灯偶尔暗一下、矿底排气口喷气、第二采矿场的管道喷火，间隔按配置）；减少动态效果时都停住（电梯不动，灯一直亮着，不喷气不喷火）", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { B, A } = P, M = mine();
  try {
    const S = H.load().BattleSim;
    for (const d of DONE) {
      const layout = layoutOf(BOARDS.line3(S), d), bd = backdropOf(B, layout, "dusk"), want = A.of(d.key).art.ambient;
      const amb = [];
      bd.group.traverse(o => { if (o.userData.ambient) amb.push(o); });
      want.forEach(k => assert.ok(amb.some(o => o.userData.ambient.kind === k), `${d.key}：配置里有 ${k}，远景里却没有`));
      amb.forEach(o => assert.ok(want.includes(o.userData.ambient.kind), `${d.key}：远景里的 ${o.userData.ambient.kind} 不在配置里`));
      const movers = amb.filter(o => o.userData.ambient.mover), blinks = amb.filter(o => o.userData.ambient.kind === "blink");
      if (want.includes("blink")) assert.ok(blinks.length >= 3, d.key + "：有好几盏会闪的灯");
      // 减少动态效果：跑 30 秒什么都不动，灯都亮着
      const where = () => movers.map(o => o.position.toArray().join(","));
      const p0 = where();
      run(bd, 30, true, 5);
      assert.deepEqual(where(), p0, d.key + "：减少动态效果时运载电梯停在原地");
      blinks.forEach(o => assert.equal(o.visible, true, d.key + "：减少动态效果时灯一直亮着"));
      // 正常：跑 3 分钟
      const seen = new Map(movers.map(o => [o, new Set()]));
      let off = 0;
      for (let s = 0; s < 180; s++) { run(bd, 1, false, s); movers.forEach(o => seen.get(o).add(o.position.y.toFixed(2))); off += blinks.filter(o => !o.visible).length; }
      movers.forEach(o => {
        const a = o.userData.ambient, cfg = M.AMBIENT[a.kind], mv = a.mover;
        assert.ok(mv.trips >= 3, `${d.key}：${a.kind} 3 分钟只走了 ${mv.trips} 趟`);
        assert.ok(seen.get(o).size >= 5, `${d.key}：${a.kind} 真的上下动了`);
        mv.waits.forEach(w => assert.ok(w >= cfg.wait[0] - 0.05 && w <= cfg.wait[1] + 0.05, `${d.key}：${a.kind} 停了 ${w.toFixed(2)} 秒，不在配置的 ${cfg.wait} 里`));
      });
      blinks.forEach(o => {
        const bt = o.userData.ambient.beat, cfg = M.AMBIENT.blink;
        assert.ok(bt.n >= 30, `${d.key}：灯 3 分钟只闪了 ${bt.n} 下`);
        bt.gaps.forEach(gap => assert.ok(gap >= cfg.every[0] - 0.05 && gap <= cfg.every[1] + 0.05, `${d.key}：灯隔了 ${gap.toFixed(2)} 秒才闪，不在配置的 ${cfg.every} 里`));
      });
      if (blinks.length) assert.ok(off > 0, d.key + "：灯真的暗过");
      // 一阵一阵的（矿底管道喷气）：3 分钟喷了好多阵，间隔、每阵多久按配置；喷的时候看得到气，减少动态效果时一团都看不到
      amb.filter(o => o.userData.ambient.puffs).forEach(o => {
        const a = o.userData.ambient, cfg = M.AMBIENT[a.kind];
        assert.ok(a.beat.n >= 15, `${d.key}：${a.kind} 3 分钟只来了 ${a.beat.n} 阵`);
        a.beat.gaps.forEach(gap => assert.ok(gap >= cfg.every[0] - 0.05 && gap <= cfg.every[1] + 0.05, `${d.key}：${a.kind} 隔了 ${gap.toFixed(2)} 秒，不在配置的 ${cfg.every} 里`));
        let seen = 0;
        for (let f = 0; f < 30 * 20; f++) { bd.update(200 + f / 30, 1 / 30); seen += a.puffs.filter(p => p.visible).length; }
        assert.ok(seen > 0, `${d.key}：${a.kind} 喷的时候看得到`);
        run(bd, 10, true, 300);
        assert.equal(a.puffs.filter(p => p.visible).length, 0, `${d.key}：减少动态效果时 ${a.kind} 不喷`);
      });
      bd.dispose();
    }
  } finally { P.restore(); }
});

/* ---------- 5. 接线 ---------- */
test("接线（#242）：页面在布局后面加载登记处和美术包；hd2d-world.js / hd2d-backdrop.js 只有挂钩；布局文件一行没动（美术包登记时把自己的地面主题并进 GROUNDS / SCENES）；假网页加载不报错，页面环境里的布局就用场景自己的那一套", () => {
  const html = read("index.html");
  const at = (f) => html.indexOf(`<script src="${f}"></script>`);
  assert.ok(at("hd2d-layout.js") > 0 && at("hd2d-layout.js") < at("hd2d-scene-art.js") && at("hd2d-scene-art.js") < at("hd2d-scenes-mine.js") && at("hd2d-scenes-mine.js") < html.indexOf('<script type="module">'), "布局 → 登记处 → 美术包 → 页面主脚本");
  const world = code(read("hd2d-world.js")), backdrop = code(read("hd2d-backdrop.js"));
  assert.match(world, /const ART = window\.HD2DSceneArt \|\|/);
  assert.match(world, /\(TEX\[name\] \|\| ART\.texture\(name, KIT\)\)\(\)/, "贴图");
  assert.match(world, /DECALS\[kind\] \|\| ART\.decal\(kind\)/, "贴花");
  assert.match(world, /if \(!ART\.zone\(KIT, g, z, ctx, r, look\)\) decorate\(g, z, r, look\);/, "地台上的装饰");
  assert.match(backdrop, /ART\.band\(KIT, kind, bandColors, seed \* 97 \+ 11\) \|\| bandTexture\(/, "天边的远景");
  assert.match(backdrop, /const art = ART\.backdrop\(KIT, kind, \{/, "中景、矿坑");
  assert.match(backdrop, /groundEdge: art && Number\.isFinite\(art\.groundEdge\)/, "地台外的地到坑边为止");
  assert.match(code(read("hd2d-scene.js")), /ground\.position\.z = edge != null \? edge \+ BACKDROP\.ground\.size \/ 2 : cz;/, "场景把地挪到坑边");
  assert.doesNotMatch(read("hd2d-layout.js"), /HD2DSceneArt|hd2d-scenes|mine1_rim/, "布局文件不认识美术包");
  // 假网页：照 index.html 的顺序加载（垫片 → 规则 → 布局 → 登记处 → 美术包 ……）不报错
  const page = require("./hd2d-fake-page").load();
  assert.deepEqual(page.errors, []);
  const PL = page.ctx.HD2DLayout, PA = page.ctx.HD2DSceneArt;
  assert.ok(PA && page.ctx.HD2DScenesMine, "页面里有登记处和采矿场的美术包");
  DONE.forEach(d => {
    assert.equal(PL.groundOf(d.region, d.scene), d.key, d.key + "：页面环境里选得出来");
    const st = page.ctx.BattleSim.setup({ party: PARTY, enemies: [], region: d.region, scene: d.scene, light: "dusk", seed: "SCN-ART" });
    const pv = page.ctx.OnlineView.projectState(st, {});
    assert.deepEqual([pv.region, pv.scene], [d.region, d.scene]);
    assert.equal(PL.build(pv, { view: DESKTOP, region: pv.region, scene: pv.scene, theme: pv.light }).ground, d.key, d.key + "：画面读投影里的场景，排出来就是这一套");
  });
  assert.deepEqual(page.errors, []);
});

test("没有坚毅生命（#242）：美术只读布局给的地台 / 战场范围，代码里不碰单位数据（shp、units、plate）", () => {
  ["hd2d-scene-art.js", "hd2d-scenes-mine.js"].forEach(f => {
    const src = code(read(f));
    assert.doesNotMatch(src, /shp|坚毅|\.units\b|\.plate\b/i, f);
  });
});
