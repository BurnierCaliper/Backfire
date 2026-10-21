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
  { region: "第一采矿场", scene: "rim", key: "mine1_rim", must: ["pitWall", "rimLip", "rail", "gantry", "cage", "skipTrack", "skip", "pitLight", "farRim"] }
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
/** 一串点投到屏幕上：外框和离镜头最近的深度 */
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
/** 一个装饰在世界里的点：小的网格按真的顶点（转过的石头的外框比石头本身大一圈，不能拿它算），大的 / 实例网格按外框的八个角 */
function pointsOf(THREE, obj) {
  const out = [], v = new THREE.Vector3();
  obj.updateMatrixWorld(true);
  obj.traverse(o => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    if (o.isInstancedMesh || pos.count > 600) {
      const b = new THREE.Box3().setFromObject(o);
      [b.min.x, b.max.x].forEach(x => [b.min.y, b.max.y].forEach(y => [b.min.z, b.max.z].forEach(z => out.push({ x, y, z }))));
    } else for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); out.push({ x: v.x, y: v.y, z: v.z }); }
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
        const things = artOf(root).filter(o => !o.obj.parent || !o.obj.parent.userData.art).map(o => ({ what: o.what, pts: pointsOf(THREE, o.obj) }));
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
              if (!q || !q.rect || s.near >= ud - 0.05) return;   // 在他后面（铭牌是 DOM，盖在后面的东西上面）
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
test("环境动画（#242）：矿外的矿车、罐笼时不时上下（停多久、走多快按 AMBIENT 的配置），坑壁上的灯偶尔暗一下（间隔按配置）；减少动态效果时都停住（矿车、罐笼不动，灯一直亮着）", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { B } = P, M = mine();
  try {
    const S = H.load().BattleSim;
    for (const d of DONE.filter(x => x.scene === "rim")) {
      const layout = layoutOf(BOARDS.line3(S), d), bd = backdropOf(B, layout, "dusk");
      const amb = [];
      bd.group.traverse(o => { if (o.userData.ambient) amb.push(o); });
      const movers = amb.filter(o => o.userData.ambient.mover), blinks = amb.filter(o => o.userData.ambient.kind === "blink");
      assert.ok(movers.some(o => o.userData.ambient.kind === "skip") && movers.some(o => o.userData.ambient.kind === "cage"), d.key + "：有矿车、罐笼");
      assert.ok(blinks.length >= 3, d.key + "：有会闪的灯");
      // 减少动态效果：跑 30 秒什么都不动，灯都亮着
      const where = () => movers.map(o => o.position.toArray().join(","));
      const p0 = where();
      run(bd, 30, true, 5);
      assert.deepEqual(where(), p0, d.key + "：减少动态效果时矿车、罐笼停在原地");
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
      assert.ok(off > 0, d.key + "：灯真的暗过");
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
