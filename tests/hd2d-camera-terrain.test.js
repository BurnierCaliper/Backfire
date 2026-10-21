// HD-2D 战场原型 · 主人试玩反馈 · 一（#237）：镜头和地形。
// 近景镜头抬高、背景不要球面、区的外轮廓不规则、高地真的高、近景双击单位特写、伤害 / 击破数字放大。
// 都是 Node 能跑的（布局 / 镜头 / 数字是纯函数；地台、远景在 Node 里用 vendor 的真 three.js 建）；画面（WebGL）截图由仓库主人跑。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const H = require("./headless");
const L = require("../prototypes/hd2d/hd2d-layout.js");
const OV = require("../online-view.js");

// 缺这几个文件 / 函数时只是这几条失败（每条测试里各自 require）
const cams = () => require("../prototypes/hd2d/hd2d-camera.js");
const fxm = () => require("../prototypes/hd2d/hd2d-fx.js");

const DIR = path.join(__dirname, "..", "prototypes", "hd2d");
const PARTY = ["kolt", "helu", "ruby", "yuito"];
const DESKTOP = { width: 1440, height: 900, top: 46, bottom: 160 };   // 桌面 1440×900：顶栏 + 展开的技能栏
const gapOf = (type, hp, open) => ({ type, hp: hp || 0, maxHp: hp || 0, open: open !== false, lastFrom: null });

/** 三个演示战场（和 index.html 的 DEMOS 一样：区域、光影写进战斗状态） */
const DEMOS = {
  mine(S) {
    const st = S.setup({ party: PARTY, zoneMode: 3, seed: "hd2d-mine", region: "第一采矿场", light: "dusk", enemies: [{ id: "guard_sword", lv: 2, zone: 3 }, { id: "guard_gun", lv: 2, zone: 3 }, { id: "thug_hammer", lv: 2, zone: 2 }, { id: "boomcar", lv: 2, zone: 2 }] });
    st.fields[2].acid = true; st.fields[3].highland = true; st.gaps["1-2"] = gapOf("bridge", 12); st.gaps["2-3"] = gapOf("wall", 20, false);
    return st;
  },
  desert(S) {
    const st = S.setup({ party: PARTY, board: "square4", weather: "sand", seed: "hd2d-desert", region: "沙漠", light: "day", enemies: [{ id: "sandfish_ambush", lv: 2, zone: 1 }, { id: "sandfish_lead", lv: 2, zone: 2 }, { id: "sand_beast", lv: 2, zone: 4 }, { id: "sand_human", lv: 2, zone: 4 }] });
    st.fields[1].quicksand = true; st.fields[4].coral = true; st.gaps["1-3"] = gapOf("void"); st.gaps["2-4"] = gapOf("bridge", 10);
    const shark = st.units.find(u => u.kit === "sandfish_ambush"); if (shark) shark.submerged = true;
    return st;
  },
  cross(S) {
    const st = S.setup({ party: PARTY, board: "cross5", weather: "thunder", seed: "hd2d-cross", region: "外城区", light: "night", enemies: [{ id: "crow", lv: 2, zone: 1 }, { id: "buoy", lv: 2, zone: 1 }, { id: "thug_hammer", lv: 2, zone: 3 }, { id: "guard_gun", lv: 2, zone: 4 }] });
    st.fields[1].abyss = true; st.fields[2].highland = true; st.fields[3].electric = true; st.fields[4].acid = true;
    st.gaps["1-3"] = gapOf("void"); st.gaps["2-3"] = gapOf("door", 0, false); st.gaps["3-4"] = gapOf("bridge", 12);
    return st;
  }
};
/** 演示战场投影成联机玩家拿到的那一份，再排布局（和原型页一样：先投影，再交给布局） */
function demoLayout(id, opts) {
  const st = DEMOS[id](H.load().BattleSim), pv = OV.projectState(st, {});
  return { st, pv, layout: L.build(pv, Object.assign({ view: DESKTOP, region: pv.region, theme: pv.light }, opts || {})) };
}
/** 某一段镜头下的适配器（铭牌在哪、抬多高、是不是放大的那张；和场景一样） */
function rig(layout, pose) {
  const F = fxm(), cam = { pos: pose.pos, target: pose.target, fov: pose.fov, width: DESKTOP.width, height: DESKTOP.height };
  return F.adapter({
    lens: () => cam,
    plate: (id) => {
      const u = layout.units.find(x => x.id === id), q = pose.plates[id];
      return u && q && !q.hide ? { x: u.x, y: u.y, z: u.z, lift: q.lift, big: q.big, zoom: q.zoom } : null;
    },
    zone: (id) => layout.zones.find(z => z.id === Number(id)) || null,
    size: (big) => L.plateSize(layout.view, big)
  });
}
const apart = (a, b) => a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;

/* ---------- 1. 近景镜头抬高 ---------- */
test("近景镜头抬高（#237）：近景俯角在 22–28°（以前 14°，接近平视），中景跟着抬、仍是远 > 中 > 近；近景照样只框选中的区、整个区和放大的铭牌都在顶栏和技能栏之间", () => {
  const C = cams().CAMERA, far = L.CONFIG.camera.elevation;
  assert.ok(C.near.elevation >= 22 && C.near.elevation <= 28, `近景俯角 ${C.near.elevation}° 不在 22–28°`);
  assert.ok(C.mid.elevation > 22, `中景俯角 ${C.mid.elevation}° 跟着抬（以前 22°）`);
  assert.ok(far > C.mid.elevation && C.mid.elevation > C.near.elevation, "远 > 中 > 近");
  ["mid", "near"].forEach(t => assert.ok(C[t].tilt[0] <= C[t].elevation && C[t].elevation <= C[t].tilt[1], t + "：俯角在自己的拖动范围里"));
  for (const id of Object.keys(DEMOS)) {
    const { layout } = demoLayout(id);
    [...new Set(layout.units.map(u => u.zone))].forEach(zid => {
      const p = cams().pose(layout, "near", zid), z = layout.zones.find(q => q.id === zid), tag = `${id} 近景 ${zid} 区`;
      assert.equal(p.elevation, C.near.elevation, tag);
      [-1, 1].forEach(sx => [-1, 1].forEach(sz => [0, z.topY].forEach(y => {
        const s = L.project(p.cam, { x: z.cx + sx * z.w / 2, y, z: z.cz + sz * z.d / 2 });
        assert.ok(s.x >= 0 && s.x <= DESKTOP.width && s.y >= DESKTOP.top && s.y <= DESKTOP.height - DESKTOP.bottom, `${tag}：地台的角出了画面（${s.x.toFixed(0)}, ${s.y.toFixed(0)}）`);
      })));
      layout.units.filter(u => u.zone === zid).forEach(u => {
        const r = p.plates[u.id].rect;
        assert.ok(p.plates[u.id].big && r.x0 >= 0 && r.x1 <= DESKTOP.width && r.y0 >= DESKTOP.top && r.y1 <= DESKTOP.height - DESKTOP.bottom, `${tag}：${u.plate.name} 放大的铭牌出了画面`);
      });
    });
  }
});

/* ---------- 6. 伤害数字、击破数字放大 ---------- */
/** 以前的字号（#237 以前的 FX.num）：同一块铭牌上，按以前的配置算出来的字号 */
const OLD_NUM = { size: { dmg: 22, big: 32, brk: 15 }, scale: { min: 0.78, max: 1.6 } };
const oldSize = (kind, rect) => OLD_NUM.size[kind] * Math.max(OLD_NUM.scale.min, Math.min(OLD_NUM.scale.max, rect.w / L.CONFIG.plate.w));
const RUN = (id) => [
  { unitId: id, kind: "dmg", text: "6", el: "energy" }, { unitId: id, kind: "brk", text: "击破1", el: "energy" }, { unitId: id, kind: "big", text: "23!!", el: "fire" },
  { unitId: id, kind: "word", text: "灼烧", el: "fire" }, { unitId: id, kind: "dmg", text: "12", el: "physical" }, { unitId: id, kind: "block", text: "格挡", el: "physical" }
];
test("伤害数字、击破数字放大（#237）：远 / 中 / 近同一块铭牌上的字号是以前的 1.4–1.7 倍，远景普通伤害也有 28px 以上；放大以后三个演示 × 远 / 中 / 近每个人同时弹 6 个，一个不丢、两两不压住、不进顶栏和技能栏", () => {
  const F = fxm(), C = cams();
  for (const id of Object.keys(DEMOS)) {
    const { layout } = demoLayout(id);
    const zones = [...new Set(layout.units.map(u => u.zone))];
    for (const tier of ["far", "mid", "near"]) for (const zid of zones) {
      const pose = C.pose(layout, tier, zid), ad = rig(layout, pose), tag = `${id} · ${tier} · ${zid} 区`;
      const who = layout.units.filter(u => u.zone === pose.zone);
      who.forEach(u => {
        const r = ad.rectOf(u.id);
        ["dmg", "brk", "big"].forEach(kind => {
          const k = F.sizeOf(kind, r) / oldSize(kind, r);
          assert.ok(k >= 1.4 && k <= 1.7, `${tag}：${u.plate.name} 的 ${kind} 字号是以前的 ${k.toFixed(2)} 倍`);
        });
        if (tier === "far") assert.ok(F.sizeOf("dmg", r) >= 28, `${tag}：远景普通伤害只有 ${F.sizeOf("dmg", r).toFixed(1)}px`);
      });
      const list = who.flatMap(u => RUN(u.id));
      const placed = F.placeNumbers(list, ad.rectOf, DESKTOP);
      assert.equal(placed.length, list.length, tag + "：放大以后每个数字都弹得出来");
      placed.forEach((a, i) => {
        assert.ok(a.box.x0 >= 0 && a.box.x1 <= DESKTOP.width && a.box.y0 >= DESKTOP.top && a.box.y1 <= DESKTOP.height - DESKTOP.bottom, `${tag}：「${a.text}」出了画面 / 进了顶栏、技能栏`);
        placed.slice(i + 1).forEach(b => assert.ok(apart(a.box, b.box), `${tag}：「${a.text}」和「${b.text}」压住了`));
      });
    }
  }
  // 大伤害 > 普通伤害 > 击破，照旧
  const S = F.FX.num.size;
  assert.ok(S.big > S.dmg && S.dmg > S.brk);
});

/* ---------- 5. 近景双击单位特写 ---------- */
test("近景双击单位特写（#237）的状态机：近景里双击一个单位 → 特写它（再双击别人就换人）；远景 / 中景里双击不特写；拉远（滚轮往后、按 2 / 1、点远 / 中）退出特写回到正常镜头（往后滚一下回到正常的近景）；选了别的区、特写的单位不在了也退出", () => {
  const C = cams();
  assert.equal(typeof C.camStep, "function", "镜头的状态机（hd2d-camera.js · camStep）");
  const near = { tier: "near", zone: 2, close: null };
  // 双击：近景里特写，远景 / 中景里不特写
  const c1 = C.camStep(near, { type: "dblclick", unit: "u1", zone: 2 });
  assert.deepEqual(c1, { tier: "near", zone: 2, close: "u1" }, "近景里双击：特写");
  assert.deepEqual(near, { tier: "near", zone: 2, close: null }, "不改传进来的状态");
  assert.deepEqual(C.camStep(c1, { type: "dblclick", unit: "u2", zone: 2 }), { tier: "near", zone: 2, close: "u2" }, "特写时双击别人：换人");
  ["far", "mid"].forEach(t => assert.deepEqual(C.camStep({ tier: t, zone: 2, close: null }, { type: "dblclick", unit: "u1", zone: 2 }), { tier: t, zone: 2, close: null }, t + "：双击不特写"));
  // 拉远：滚轮往后 → 回到正常的近景（再往后才到中景）；往前滚不动
  assert.deepEqual(C.camStep(c1, { type: "wheel", step: -1 }), { tier: "near", zone: 2, close: null }, "滚轮往后：退出特写，回到正常的近景");
  assert.deepEqual(C.camStep(C.camStep(c1, { type: "wheel", step: -1 }), { type: "wheel", step: -1 }), { tier: "mid", zone: 2, close: null }, "再往后：中景");
  assert.deepEqual(C.camStep(c1, { type: "wheel", step: 1 }), c1, "特写时往前滚：不动");
  assert.deepEqual(C.camStep(near, { type: "wheel", step: -1 }), { tier: "mid", zone: 2, close: null }, "没在特写：照旧一段一段跳");
  // 按 2 / 1、点远 / 中：退出特写到那一段；按 3 / 点近：回到正常的近景
  assert.deepEqual(C.camStep(c1, { type: "tier", tier: "mid" }), { tier: "mid", zone: 2, close: null }, "按 2 / 点中");
  assert.deepEqual(C.camStep(c1, { type: "tier", tier: "far" }), { tier: "far", zone: 2, close: null }, "按 1 / 点远");
  assert.deepEqual(C.camStep(c1, { type: "tier", tier: "near" }), { tier: "near", zone: 2, close: null }, "按 3 / 点近：正常的近景");
  // 选了别的区（点地台、左右换区、当前行动单位到了别的区）退出；还是同一个区不动
  assert.deepEqual(C.camStep(c1, { type: "zone", zone: 3 }), { tier: "near", zone: 3, close: null }, "换到别的区：退出特写");
  assert.deepEqual(C.camStep(c1, { type: "zone", zone: 2 }), c1, "点同一个区（双击站位时先来的两下单击）：不动");
  // 重排以后特写的单位不在了（被打倒、藏起来）：退出
  assert.deepEqual(C.camStep(c1, { type: "units", ids: ["u2", "u3"] }), { tier: "near", zone: 2, close: null });
  assert.deepEqual(C.camStep(c1, { type: "units", ids: ["u1"] }), c1);
});

test("近景双击单位特写（#237）：镜头平滑推到这个单位面前（比近景近、正对着它），它的放大铭牌再大一点、立在脚下、整块在顶栏和技能栏之间，别的铭牌变淡、压到它的藏起来；推过去的时长 / 距离 / 俯角在 CAMERA.close；减少动态效果时直接切过去；双击站位也认得是谁", () => {
  const C = cams(), T = C.CAMERA.close, F = fxm(), P = L.CONFIG.plate;
  assert.ok(T && Number.isFinite(T.dist) && Number.isFinite(T.elevation) && Number.isFinite(T.fov) && Number.isFinite(T.duration) && T.zoom > 1, "特写的距离、俯角、视野、时长、铭牌放大在 CAMERA.close");
  assert.ok(T.duration >= 0.3 && T.duration <= 1 && C.EASE[T.ease] && T.tilt[0] <= T.elevation && T.elevation <= T.tilt[1], "时长 0.3–1 秒、缓动认得、俯角在拖动范围里");
  for (const id of Object.keys(DEMOS)) {
    const { layout } = demoLayout(id);
    layout.units.forEach(u => {
      const p = C.closePose(layout, u.id), n = C.pose(layout, "near", u.zone), tag = `${id} 特写 ${u.plate.name}`;
      assert.ok(p && p.close === u.id && p.tier === "near" && p.zone === u.zone, tag + "：还算近景，选中的区是它所在的区");
      assert.ok(p.dist < n.dist * 0.75, `${tag}：比近景近（${p.dist.toFixed(1)} / ${n.dist.toFixed(1)}）`);
      assert.ok(p.elevation === T.elevation && p.fov === T.fov && p.azimuth === 0, tag + "：俯角、视野照 CAMERA.close，正对着");
      assert.ok(Math.abs(p.target.x - u.x) < 0.3 && Math.abs(p.target.z - u.z) < 3, tag + "：看的是这个单位");
      // 它的铭牌：放大的那张再乘 zoom，立在脚下，整块在顶栏和技能栏之间；比近景里大
      const q = p.plates[u.id], r = q.rect, big = L.plateSize(layout.view, true);
      assert.ok(q.close && q.big && !q.dim && !q.hide && q.lift === 0 && q.zoom === T.zoom, tag + "：铭牌放大、立在脚下");
      assert.ok(Math.abs((r.x1 - r.x0) - big.w * T.zoom * r.scale) < 0.5, tag + "：铭牌的宽 = 放大的那张 × zoom");
      assert.ok(r.x0 >= 0 && r.x1 <= DESKTOP.width && r.y0 >= DESKTOP.top && r.y1 <= DESKTOP.height - DESKTOP.bottom, `${tag}：铭牌出了画面 ${JSON.stringify([r.x0, r.y0, r.x1, r.y1].map(Math.round))}`);
      assert.ok(r.x1 - r.x0 > (n.plates[u.id].rect.x1 - n.plates[u.id].rect.x0) * 1.2, tag + "：比近景里的铭牌大");
      // 别的铭牌：变淡；露出来的（没藏起来的）不压它、彼此也不压
      const shown = layout.units.filter(x => !p.plates[x.id].hide);
      layout.units.filter(x => x.id !== u.id).forEach(x => assert.ok(p.plates[x.id].dim && !p.plates[x.id].close, tag + "：别的铭牌变淡"));
      for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
        assert.ok(apart(p.plates[shown[i].id].rect, p.plates[shown[j].id].rect), `${tag}：${shown[i].plate.name} 和 ${shown[j].plate.name} 的铭牌压住了`);
      }
      // 适配器（攻击演出、伤害数字）按特写放大以后的铭牌算矩形
      const ad = rig(layout, p), ar = ad.rectOf(u.id);
      assert.ok(Math.abs(ar.w - (r.x1 - r.x0)) < 0.5, tag + "：适配器的矩形跟着特写放大");
      // 推过去：从近景平滑出发、到了就是特写；时长照 CAMERA.close；减少动态效果直接切过去；拉回近景用平常的过渡
      const tw = C.tween(n, p, {});
      assert.equal(tw.duration, T.duration);
      const s0 = C.at(tw, 0), s1 = C.at(tw, tw.duration), mid = C.at(tw, tw.duration / 2);
      assert.ok(Math.hypot(s0.pos.x - n.pos.x, s0.pos.y - n.pos.y, s0.pos.z - n.pos.z) < 1e-9 && Math.hypot(s1.pos.x - p.pos.x, s1.pos.y - p.pos.y, s1.pos.z - p.pos.z) < 1e-9 && s1.close === u.id, tag + "：第 0 帧在近景、最后到特写");
      assert.ok(mid.dist < n.dist && mid.dist > p.dist, tag + "：中途在两头之间（平滑推过去）");
      assert.equal(C.tween(n, p, { reduced: true }).duration, 0, tag + "：减少动态效果直接切过去");
      assert.equal(C.tween(p, n, {}).duration, C.CAMERA.transition.duration, tag + "：拉回近景用平常的过渡");
      // 双击站位：脚下那一点认得是谁；脚下旁边一点点也算；别的区、空地不算
      assert.equal(C.unitAt(layout, u.zone, u.x, u.z), u.id, tag + "：双击站位");
      assert.equal(C.unitAt(layout, u.zone, u.x + 0.2, u.z - 0.15), layout.units.filter(x => x.zone === u.zone).sort((a, b) => Math.hypot(a.x - u.x - 0.2, a.z - u.z + 0.15) - Math.hypot(b.x - u.x - 0.2, b.z - u.z + 0.15))[0].id);
      const other = layout.zones.find(z => z.id !== u.zone);
      assert.equal(C.unitAt(layout, other.id, u.x, u.z), null, tag + "：别的区不算");
    });
    const z = layout.zones[0];
    assert.equal(C.unitAt(layout, z.id, z.cx + z.w / 2 - 0.05, z.cz + z.d / 2 - 0.05), null, id + "：地台角上的空地不算");
    assert.equal(C.closePose(layout, "nobody"), null, "没有这个单位：不特写");
  }
  // 场景、页面接上：双击铭牌 / 站位 → closeUp；换段、滚轮、换区都走状态机；特写时铭牌再放大、别的藏起来
  const scene = fs.readFileSync(path.join(DIR, "hd2d-scene.js"), "utf8"), css = fs.readFileSync(path.join(DIR, "hd2d.css"), "utf8");
  assert.ok(/addEventListener\("dblclick"[^\n]*closeUp\(p\.id\)/.test(scene), "双击铭牌：特写");
  assert.ok(/renderer\.domElement\.addEventListener\("dblclick"[\s\S]{0,200}C\.unitAt\(/.test(scene), "双击地台上的站位：认出是谁，特写");
  assert.ok(/C\.closePose\(/.test(scene) && /C\.camStep\(camState\(\), \{ type: "tier"/.test(scene) && /C\.camStep\(camState\(\), \{ type: "wheel"/.test(scene) && /type: "zone"/.test(scene) && /type: "units"/.test(scene), "换段 / 滚轮 / 换区 / 重排都走状态机");
  assert.ok(/C\.tween\(from, to, \{ reduced: !!opts\.snap \|\| !state\.motion \}\)/.test(scene), "减少动态效果时直接切过去（和换段一样）");
  assert.ok(/\* p\.zoom/.test(scene) && /classList\.toggle\("hide", p\.hide\)/.test(scene) && /\.hd2d-plate\.hide \.pl-in/.test(css), "特写的铭牌再放大，压到它的藏起来");
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
  assert.ok(/info\.close != null \? " · 特写 "/.test(html) && /sc\.setTier\(t\)/.test(html), "页面：镜头条写着特写谁；远 / 中按钮、1 / 2 键照旧 setTier（就退出特写）");
});

/* ---------- 3. 区的外轮廓不规则 ---------- */
const FOES = [{ id: "guard_sword", lv: 2 }, { id: "thug_knife", lv: 2 }, { id: "buoy", lv: 2 }, { id: "crow", lv: 2 }, { id: "thug_hammer", lv: 2 }];
const CASES = [
  { name: "两区直排", opt: { zoneMode: 2 } }, { name: "三区直排", opt: { zoneMode: 3 } }, { name: "四区直排", opt: { board: "line4" } },
  { name: "2×2", opt: { board: "square4" } }, { name: "十字五区", opt: { board: "cross5" } }
];
/** 各种棋盘：我方 4 人 + n 个敌人，敌人分到各个区（同区挤 / 每个区都有人） */
function boardState(c, nFoes, crowd) {
  const st = H.load().BattleSim.setup(Object.assign({ party: PARTY, seed: "HD2D", enemies: FOES.slice(0, nFoes).map(f => Object.assign({ zone: 0 }, f)) }, c.opt));
  const pz = st.units.find(u => u.isPlayer && !u.hidden).zone;
  st.units.filter(u => !u.isPlayer).forEach((u, i) => { u.zone = crowd ? pz : ((i + 1) % st.zoneMode) + 1; });
  return st;
}
/** 多边形有没有自己交叉（不相邻的两条边相交） */
function selfCrossing(P) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
  const n = P.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    const a = P[i], b = P[(i + 1) % n], c = P[j], d = P[(j + 1) % n];
    if (o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0) return [i, j];
  }
  return null;
}
/** 一条边上沿边的坐标 t（−len/2 … len/2，0 = 正中）、往外 off 的点（局部坐标） */
function sidePoint(z, side, t, off) {
  const hw = z.w / 2, hd = z.d / 2;
  if (side === "back") return { x: t, z: -hd - off };
  if (side === "front") return { x: t, z: hd + off };
  if (side === "left") return { x: -hw - off, z: t };
  return { x: hw + off, z: t };
}
const SIDES = ["back", "right", "front", "left"];

test("区的外轮廓不规则（#237）：各种棋盘、横竖屏、各区域，每块地台的外轮廓是不规则的多边形（有缺口、凸起、削掉的角，不自己交叉），只在外缘：站位区整个在里面、每个单位都站在多边形里；挨着别的区的那条边中间平直、整条边不往外凸，桥 / 墙 / 门接得上", () => {
  const O = L.CONFIG.outline, U = L.CONFIG;
  assert.ok(O && O.amount > 0 && O.cut > 0 && O.cut < U.pad && O.bump > 0 && O.chip[0] > O.cut && O.mouth > 0, "不规则程度在配置表里（CONFIG.outline），往里缺的比留给装饰的那一圈（pad）窄");
  for (const c of CASES) for (const portrait of [false, true]) for (const region of [undefined, "沙漠", "外城区"]) for (const crowd of [false, true]) {
    const st = boardState(c, crowd ? 4 : 5, crowd);
    st.fields[1].highland = true;
    const out = L.build(st, { view: DESKTOP, portrait, region }), tag0 = `${c.name}${portrait ? " 竖屏" : ""} ${region || "不给区域"}${crowd ? " 同区挤" : ""}`;
    const sigs = new Set();
    out.zones.forEach(z => {
      const P = z.outline && z.outline.pts, tag = `${tag0} ${z.id} 区`, hw = z.w / 2, hd = z.d / 2;
      assert.ok(Array.isArray(P) && P.length >= 12, tag + "：外轮廓不是方的（折点够多）");
      assert.equal(selfCrossing(P), null, tag + "：外轮廓自己交叉了");
      const offs = P.map(p => Math.max(Math.abs(p.x) - hw, Math.abs(p.z) - hd));   // 每个折点离方框多远（往外是正的）
      offs.forEach(v => assert.ok(v >= -O.cut - 1e-6 && v <= O.bump + 1e-6, `${tag}：折点离方框 ${v.toFixed(3)}，超出了 cut / bump`));
      assert.ok(offs.some(v => v < -0.1), tag + "：有往里缺的");
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sz]) => assert.ok(!L.insideOutline(P, sx * (hw - 0.02), sz * (hd - 0.02)), `${tag}：角上没削掉一块`));
      sigs.add(JSON.stringify(P));
      // 站位区（离边 pad 以内）整个在多边形里：四个角在里面，没有折点伸进站位区
      const ux = hw - U.pad, uz = hd - U.pad;
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sz]) => assert.ok(L.outlineDist(P, sx * ux, sz * uz) > 0, `${tag}：站位区的角 (${sx * ux}, ${sz * uz}) 在轮廓外面`));
      P.forEach(p => assert.ok(Math.abs(p.x) >= ux - 1e-9 || Math.abs(p.z) >= uz - 1e-9, `${tag}：折点 (${p.x}, ${p.z}) 伸进了站位区`));
      out.units.filter(u => u.zone === z.id).forEach(u => {
        const d = L.outlineDist(P, u.x - z.cx, u.z - z.cz);
        assert.ok(d >= 0.2, `${tag}：${u.plate.name} 离外轮廓只有 ${d.toFixed(2)}（要站在多边形里）`);
      });
      // 挨着别的区的边：中间 mouth 那么宽是平直的（往里一点在里面、往外一点在外面），整条边没有往外凸的折点；台子、碎块不往那边摆
      const sides = L.neighborSides(z, out.zones, U.zoneSize + U.zoneGap);
      assert.deepEqual(z.outline.sides, sides, tag);
      SIDES.filter(s => sides[s]).forEach(s => {
        const len = s === "left" || s === "right" ? z.d : z.w;
        for (let t = -O.mouth * len / 2; t <= O.mouth * len / 2 + 1e-9; t += len / 20) {
          const a = sidePoint(z, s, t, -0.03), b = sidePoint(z, s, t, 0.03);
          assert.ok(L.insideOutline(P, a.x, a.z) && !L.insideOutline(P, b.x, b.z), `${tag}：挨着别的区的 ${s} 边在 t=${t.toFixed(2)} 不平直`);
        }
        P.filter(p => (s === "back" && p.z < -hd + 1e-9) || (s === "front" && p.z > hd - 1e-9) || (s === "left" && p.x < -hw + 1e-9) || (s === "right" && p.x > hw - 1e-9))
          .forEach(p => assert.ok(Math.max(Math.abs(p.x) - hw, Math.abs(p.z) - hd) <= 1e-9, `${tag}：${s} 边挨着别的区，不该往外凸（伸进缝里）`));
        assert.ok(!z.outline.ledges.some(l => l.side === s), tag + "：台子摆进了缝里");
      });
      z.outline.chunks.forEach(k => {
        assert.ok(L.outlineDist(P, k.x, k.z) <= -k.size + 1e-6, `${tag}：碎块压在地台上了`);
        const side = Math.abs(k.x) - hw > Math.abs(k.z) - hd ? (k.x > 0 ? "right" : "left") : (k.z > 0 ? "front" : "back");
        assert.ok(!sides[side], `${tag}：碎块掉进了和 ${side} 边那个区之间的缝里`);
      });
      // 桥 / 墙 / 门：落在两头地台平直的那一段上（桥面和两边的护栏柱子都踩在地台上）
      out.gaps.filter(g => g.a === z.id || g.b === z.id).forEach(g => {
        const other = out.zones.find(q => q.id === (g.a === z.id ? g.b : g.a)), dx = other.cx - z.cx, dz = other.cz - z.cz;
        const s = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "right" : "left") : (dz > 0 ? "front" : "back");
        const bw = g.width * 0.34;
        [-1, 1].forEach(e => { const p = sidePoint(z, s, e * (bw / 2 + 0.1), -0.3); assert.ok(L.outlineDist(P, p.x, p.z) > 0.2, `${tag}：${g.key} 的桥在 ${s} 边落不到地台上`); });
      });
    });
    assert.equal(sigs.size, out.zones.length, tag0 + "：每块地台的形状都不一样");
  }
});

test("外轮廓用种子固定（#237）：同一场战斗再排一遍、换窗口大小、联机投影过的，形状一模一样；不规则程度在配置里一个数（amount = 0 就是以前的方块）；外轮廓只动外缘，站位、后排抬高、铭牌的屏幕矩形和方块时完全一样", () => {
  const O = L.CONFIG.outline;
  // 按数据比（JSON 一遍）：规则环境是另一个 vm，数组的原型不是同一个，严格比较会把一模一样的数据也判成不一样（tests/hd2d-layout.test.js 的 plain 一样）
  const plain = (v) => JSON.parse(JSON.stringify(v)), shapes = (l) => plain(l.zones.map(z => z.outline));
  for (const id of Object.keys(DEMOS)) {
    const { st, pv, layout } = demoLayout(id);
    const again = L.build(pv, { view: DESKTOP, region: pv.region, theme: pv.light });
    assert.deepEqual(shapes(again), shapes(layout), id + "：再排一遍形状变了");
    const raw = L.build(st, { view: DESKTOP, region: pv.region, theme: pv.light });
    assert.deepEqual(shapes(raw), shapes(layout), id + "：房主完整的 state 和联机投影排出来的形状不一样");
    const small = L.build(pv, { view: { width: 1280, height: 720, top: 46, bottom: 120 }, region: pv.region, theme: pv.light });
    assert.deepEqual(shapes(small), shapes(layout), id + "：换了窗口大小形状变了");
    // 打坏了桥、开了门：形状不变（只看哪几条边挨着别的区，不看缝里现在是什么）
    const broken = JSON.parse(JSON.stringify(pv));
    Object.values(broken.gaps || {}).forEach(g => { g.type = "void"; g.open = !g.open; });
    assert.deepEqual(shapes(L.build(broken, { view: DESKTOP, region: pv.region })), shapes(layout), id + "：间隔变了地台的形状跟着变");
    // 程度：amount = 0 就是以前的正方形，没有台子、碎块；站位 / 抬高 / 铭牌矩形和不规则时一样
    const keep = O.amount;
    try {
      O.amount = 0;
      const square = L.build(pv, { view: DESKTOP, region: pv.region, theme: pv.light });
      square.zones.forEach(z => {
        assert.equal(z.outline.pts.length, 4, id + "：amount = 0 应该是正方形");
        z.outline.pts.forEach(p => assert.ok(Math.abs(Math.abs(p.x) - z.w / 2) < 1e-9 && Math.abs(Math.abs(p.z) - z.d / 2) < 1e-9));
        assert.ok(!z.outline.ledges.length && !z.outline.chunks.length);
      });
      assert.deepEqual(plain(square.units), plain(layout.units), id + "：外轮廓不规则了，站位 / 铭牌跟着变了");
      assert.deepEqual(plain(square.camera), plain(layout.camera), id + "：镜头跟着外轮廓变了");
      O.amount = 0.5;
      const half = L.build(pv, { view: DESKTOP, region: pv.region, theme: pv.light });
      const depth = (l) => Math.min(...l.zones.flatMap(z => z.outline.pts.map(p => Math.max(Math.abs(p.x) - z.w / 2, Math.abs(p.z) - z.d / 2))));
      assert.ok(depth(half) > depth(layout) + 0.05, id + "：amount 调小，缺口跟着变浅");
    } finally { O.amount = keep; }
  }
});

/* ---------- 4. 高地真的高 ---------- */
/** 高地上的人在屏幕上至少高出多少像素（和同一场战斗拿掉高地比，同一个镜头）、高地的侧面在屏幕上至少多高。
 *  以前只高 1 倍地台厚度时（mine 3 区）：高出 33 / 63 / 100px，侧面中景 136px、近景 239px；现在 1.5 倍：49 / 96 / 152px，侧面 170 / 297px */
const GAIN = { far: 42, mid: 80, near: 130 }, FACE = { mid: 150, near: 260 };
test("高地真的高（#237）：高地 / 沙珊瑚台地比普通区高出地台厚度的 1.25–1.5 倍（以前只高 1 倍，看不出来），高度在配置里；高地上的单位、铭牌跟着抬高；中景、近景里高地的侧面明显比普通区高，和相邻区之间有落差（桥斜着搭上去）", () => {
  const C = cams(), U = L.CONFIG;
  for (const [id, hz] of [["mine", 3], ["cross", 2]]) {
    const { st, pv, layout } = demoLayout(id);
    const high = layout.zones.find(z => z.id === hz), flat = layout.zones.find(z => !z.highland);
    const rise = high.topY - flat.topY;
    assert.ok(high.highland && rise >= U.baseH * 1.25 - 1e-9 && rise <= U.baseH * 1.5 + 1e-9, `${id}：高地比普通区高出 ${rise.toFixed(2)}（地台厚 ${U.baseH}）`);
    assert.ok(Number.isFinite(U.highRise) && Math.abs(rise - U.baseH * U.highRise) < 1e-9, "高出多少在配置里（CONFIG.highRise）");
    layout.units.filter(u => u.zone === hz && !u.flying && !u.submerged).forEach(u => assert.equal(u.y, high.topY, "高地上的人站在高地的顶面上"));
    // 同一场战斗把高地拿掉再排一遍：高地上的人（脚下的点、铭牌）在屏幕上高出一截——远 / 中 / 近都看得出
    const flatPv = JSON.parse(JSON.stringify(pv));
    flatPv.fields[hz].highland = false;
    const ref = L.build(flatPv, { view: DESKTOP, region: pv.region, theme: pv.light });
    for (const tier of ["far", "mid", "near"]) {
      const p = C.pose(layout, tier, hz), q = C.pose(ref, tier, hz), tag = `${id} ${tier}`;
      // 同一个镜头（用拿掉高地以后的）看两边的脚下：高地上的人高出多少像素
      const gain = layout.units.filter(u => u.zone === hz).map(u => {
        const r = ref.units.find(x => x.id === u.id);
        return L.project(q.cam, r).y - L.project(q.cam, u).y;
      });
      const want = GAIN[tier];
      gain.forEach(g => assert.ok(g >= want, `${tag}：高地上的人只高出 ${g.toFixed(1)}px`));
      // 这一段自己的镜头：铭牌立在高地的顶面上（矩形的底挂在抬高了的脚下）
      layout.units.filter(u => u.zone === hz).forEach(u => assert.ok(Math.abs(p.plates[u.id].rect.foot - L.project(p.cam, u).y) < 0.5, `${tag}：${u.plate.name} 的铭牌没跟着抬高`));
      // 侧面：高地前沿正中从地上到顶面的那一截，在屏幕上比普通区的高 2.2 倍以上
      if (tier !== "far") {
        const face = (z) => L.project(p.cam, { x: z.cx, y: 0, z: z.cz + z.d / 2 }).y - L.project(p.cam, { x: z.cx, y: z.topY, z: z.cz + z.d / 2 }).y;
        const k = face(high) / face(flat);
        assert.ok(k >= 2.2, `${tag}：高地的侧面只有普通区的 ${k.toFixed(2)} 倍高`);
        assert.ok(face(high) >= FACE[tier], `${tag}：高地的侧面只有 ${face(high).toFixed(0)}px 高`);
      }
    }
    // 和相邻区之间的间隔：两头一高一低（桥斜着搭上高地）
    layout.gaps.filter(g => g.a === hz || g.b === hz).forEach(g => {
      const other = layout.zones.find(z => z.id === (g.a === hz ? g.b : g.a));
      assert.deepEqual([g.y0, g.y1].sort(), [other.topY, high.topY].sort(), `${id} ${g.key}：间隔两头的高度`);
      if (!other.highland) assert.ok(Math.abs(g.y0 - g.y1) >= rise - 1e-9, `${id} ${g.key}：和相邻区之间有落差`);
    });
  }
  // 沙珊瑚台地也算高地
  const { layout } = demoLayout("desert"), coral = layout.zones.find(z => z.id === 4);
  assert.ok(coral.highland && coral.topY - L.CONFIG.baseH >= L.CONFIG.baseH * 1.25 - 1e-9, "沙珊瑚台地一样高");
});

/* ---------- 2. 背景不要球面（在真的 three.js 里建远景量）---------- */
test("背景不要球面（#237）：天幕、天边画的远景、雷鸣的低云都是平的（以前绕着战场的半个椭圆筒，地平线弯下去像小星球），远 / 中 / 近镜头里地平线是一条直线，左右转到头也看不到天幕的边；中景剪影一层层排在战场后面（不绕到两侧）；地台外面的地是一块平的方地；远处靠雾收住", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { THREE, B } = P, C = cams(), F = fxm();
  try {
    const colors = { sky: ["#ffc47c", "#f28a5a", "#b9587a", "#4b3368"], fog: 0xc98a72 };
    const scene = fs.readFileSync(path.join(DIR, "hd2d-scene.js"), "utf8");
    assert.ok(Number.isFinite(B.BACKDROP.haze) && B.BACKDROP.haze > 0.1 && /hazeH/.test(fs.readFileSync(path.join(DIR, "hd2d-backdrop.js"), "utf8")), "天幕贴地的一截融进雾里（高度在配置里）");
    assert.ok(/const FOG = \{ depth: (\d+)/.test(scene) && Number(/const FOG = \{ depth: (\d+)/.exec(scene)[1]) < 30, "远处的雾收得比以前（30）近");
    for (const id of Object.keys(DEMOS)) {
      const { layout } = demoLayout(id), b = layout.bounds;
      for (const [kind, theme, storm] of [["mine", "dusk"], ["desert", "day"], ["city", "night"], ["skynet", "day"], ["wasteland", "day"], ["city", "night", true]]) {
        const bd = B.buildBackdrop(kind, b, theme, layout.camera, Object.assign({ storm }, colors)), tag = `${id} ${kind} ${theme}${storm ? " 雷鸣" : ""}`;
        bd.update(1, 0.016, { flash: 0.5, x: 0 });
        const flats = bd.group.children.filter(o => o.isMesh && o.geometry.type === "BufferGeometry");   // 天幕、天边的远景、低云
        assert.ok(flats.length >= (storm ? 3 : 2), tag + "：有天幕、远景带子" + (storm ? "、低云" : ""));
        flats.forEach(o => {
          const pos = o.geometry.attributes.position, zs = new Set();
          for (let i = 0; i < pos.count; i++) zs.add(Math.round(pos.getZ(i) * 1000));
          assert.equal(zs.size, 1, `${tag}：${o.userData.layer || (o.userData.cloud ? "低云" : "?")} 不是平的（进深有 ${zs.size} 种）`);
          assert.ok(pos.getZ(0) < b.minZ, tag + "：在战场后面");
        });
        // 地平线（天幕的下沿）在远 / 中 / 近镜头里是一条直线；左右转到头（0.5 弧度）也看不到天幕的边
        const sky = flats.find(o => o.userData.layer === "sky") || flats[0], pos = sky.geometry.attributes.position;
        const bottom = [];
        for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 0) bottom.push({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) });
        const ends = [bottom[0], bottom[bottom.length - 1]];
        for (const tier of ["far", "mid", "near"]) for (const zid of [layout.zones[0].id, layout.zones[layout.zones.length - 1].id]) for (const az of [-0.5, 0, 0.5]) {
          const p = C.pose(layout, tier, zid), ln = F.lens({ pos: C.posOf(p.target, p.dist, p.elevation, az), target: p.target, fov: p.fov, width: DESKTOP.width, height: DESKTOP.height });
          const s = bottom.map(q => L.project(ln, q)).filter(q => q.depth > 0 && q.x > -50 && q.x < DESKTOP.width + 50);
          assert.ok(s.length >= 3, `${tag} ${tier} ${zid} 区 ${az}：看得到地平线`);
          const a = s[0], c = s[s.length - 1];
          const off = Math.max(...s.map(q => Math.abs((q.y - a.y) - (c.y - a.y) * (q.x - a.x) / ((c.x - a.x) || 1))));
          assert.ok(off < 1, `${tag} ${tier} ${zid} 区 方位 ${az}：地平线弯了 ${off.toFixed(1)}px`);
          const e0 = L.project(ln, ends[0]), e1 = L.project(ln, ends[1]);   // 天幕左右两头的下角：在画面外（或者在镜头后面）
          assert.ok((e0.depth <= 0 || e0.x < 0) && (e1.depth <= 0 || e1.x > DESKTOP.width), `${tag} ${tier} ${zid} 区 方位 ${az}：看得到天幕的边（${e0.x.toFixed(0)} … ${e1.x.toFixed(0)}）`);
        }
        // 中景剪影：都在战场后沿后面，排成几层（进深只有 BACKDROP.mid.layers 那几种）
        const props = bd.group.children.filter(o => !flats.includes(o) && (o.isGroup || (o.isMesh && o.geometry.type !== "SphereGeometry")));
        assert.ok(props.length >= 6, tag + "：中景剪影有好几个");
        const depths = new Set();
        props.forEach(o => {
          const box = new THREE.Box3().setFromObject(o);
          assert.ok(o.position.z < b.minZ - 1 && box.max.z < b.minZ + 1.5, `${tag}：剪影 ${o.userData.kind || o.geometry && o.geometry.type} 绕到了战场旁边（z=${o.position.z.toFixed(1)}）`);
          depths.add(Math.round(o.position.z * 100));
        });
        assert.ok(depths.size <= B.BACKDROP.mid.layers.length, `${tag}：剪影的进深有 ${depths.size} 种，不是一层层的`);
        bd.dispose();
      }
    }
    // 地台外面的地：一块平的方地（以前是圆盘）
    const g = B.buildGround(), gb = new THREE.Box3().setFromObject(g);
    assert.equal(g.geometry.type, "PlaneGeometry", "地面是平的方地");
    assert.ok(gb.max.y - gb.min.y < 1e-6 && Math.abs(gb.max.y - L.CONFIG.groundY) < 1e-6, "地面基本是平的，高度是 CONFIG.groundY");
    g.geometry.dispose(); g.material.dispose();
  } finally { P.restore(); }
});

/* ---------- 3 / 4 在真的 three.js 里建出来 ---------- */
/* 场景里的积木只建 three.js 的物体，不碰 WebGL：在 Node 里用 vendor 的真 three.js 建一遍（和 tests/hd2d-layout.test.js 的 protoEnv 一样）。
 * canvas 程序纹理用一个什么都接受的假 2D 画布代替 */
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
  const any = () => new Proxy(function () {}, { get: (o, k) => (k === Symbol.toPrimitive ? () => 0 : any()), set: () => true, apply: () => any() });
  const keep = { document: globalThis.document, window: globalThis.window };
  const restore = () => {
    globalThis.document = keep.document; globalThis.window = keep.window;
    if (keep.document === undefined) delete globalThis.document;
    if (keep.window === undefined) delete globalThis.window;
  };
  globalThis.document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => any() }) };
  globalThis.window = { HD2DLayout: L };
  try {
    const url = (f) => pathToFileURL(path.join(DIR, f)).href;
    const THREE = await import(threeUrl);
    const W = await import(url("hd2d-world.js")), B = await import(url("hd2d-backdrop.js"));
    return { THREE, W, B, restore };
  } catch (e) { restore(); throw e; }
}

test("真的 three.js 里（#237）：地台按不规则的外轮廓挤出来（顶面的折点就是轮廓），上沿的亮边、底座跟着轮廓；贴花、小石子、装饰都在轮廓里；有矮一截的台子和脚下的碎块；高地下面垫一块岩层底座、台阶爬到顶，桥从普通区斜着搭上高地", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { THREE, W } = P;
  try {
    for (const id of Object.keys(DEMOS)) {
      const { layout } = demoLayout(id), ctx = { anim: [], lamps: [], fxLights: 0, theme: "dusk" };
      layout.zones.forEach(z => {
        const g = W.buildZone(z, ctx), tag = `${id} ${z.id} 区（${z.kind}）`, P2 = z.outline.pts;
        const part = (name) => g.children.filter(o => o.userData && o.userData.part === name);
        const body = part("body")[0];
        assert.ok(body && Array.isArray(body.material) && body === g.children.find(o => o.isMesh && Array.isArray(o.material)), tag + "：地台本体（顶面 + 侧面两种材质）");
        // 顶面的折点：都在 y = 顶面高度上，横向就是外轮廓的折点（挤出来的，不是方块）
        const pos = body.geometry.attributes.position, tops = [];
        for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getY(i) - z.h) < 1e-5) tops.push({ x: pos.getX(i), z: pos.getZ(i) });
        P2.forEach(p => assert.ok(tops.some(q => Math.hypot(q.x - p.x, q.z - p.z) < 1e-4), `${tag}：外轮廓的折点 (${p.x}, ${p.z}) 不在顶面上`));
        tops.forEach(q => assert.ok(L.outlineDist(P2, q.x, q.z) > -1e-3 || (z.hole > 0 && Math.hypot(q.x, q.z) <= z.hole + 1e-3), `${tag}：顶面伸出了外轮廓`));
        // 上沿的亮边、底座跟着轮廓走
        const trim = part("trim")[0], skirt = part("skirt")[0];
        assert.ok(trim && skirt, tag + "：有亮边、底座");
        const tb = new THREE.Box3().setFromObject(trim);
        assert.ok(tb.min.y >= z.h - 0.02 && tb.max.y <= z.h + 0.1, tag + "：亮边在顶面上沿");
        const tp = trim.geometry.attributes.position;
        for (let i = 0; i < tp.count; i += 3) assert.ok(L.outlineDist(P2, tp.getX(i), tp.getZ(i)) > -1e-3, `${tag}：亮边伸出了外轮廓`);
        // 贴花、小石子、装饰（废铁、石块、管道、桶、晶簇、珊瑚……）都在轮廓里（不悬在缺口上）
        const top = z.h + 0.001;
        g.children.forEach(o => {
          const who = o.userData.part;
          if (who || !o.isMesh || o.isInstancedMesh || o.position.y < top) return;
          if (o.geometry.type === "PlaneGeometry" || o.geometry.type === "DodecahedronGeometry" || o.geometry.type === "BoxGeometry" || o.geometry.type === "CylinderGeometry" || o.geometry.type === "OctahedronGeometry") {
            assert.ok(L.outlineDist(P2, o.position.x, o.position.z) > 0.05, `${tag}：${o.geometry.type} 在 (${o.position.x.toFixed(2)}, ${o.position.z.toFixed(2)}) 悬在外轮廓外面`);
          }
        });
        const stones = g.children.find(o => o.isInstancedMesh);
        if (stones) {
          const m = new THREE.Matrix4(), v = new THREE.Vector3();
          for (let i = 0; i < stones.count; i++) { stones.getMatrixAt(i, m); v.setFromMatrixPosition(m); assert.ok(L.outlineDist(P2, v.x, v.z) > 0, `${tag}：小石子掉在外面`); }
        }
        // 矮一截的台子、碎块：在轮廓外沿 / 地上
        part("ledge").forEach(l => { const b = new THREE.Box3().setFromObject(l); assert.ok(b.max.y < z.h - 0.1 && b.min.y > -0.01, tag + "：台子比顶面矮一截"); });
        part("chunk").forEach(k => assert.ok(k.position.y < 0.3 && L.outlineDist(P2, k.position.x, k.position.z) < 0, tag + "：碎块在地台脚下"));
        assert.equal(part("ledge").length, z.outline.ledges.length);
        assert.equal(part("chunk").length, z.outline.chunks.length);
        // 高地：岩层底座 + 台阶
        const ped = part("pedestal")[0];
        if (z.highland) {
          assert.ok(ped, tag + "：高地下面垫着岩层底座");
          const pb = new THREE.Box3().setFromObject(ped), bb = new THREE.Box3().setFromObject(body);
          assert.ok(Math.abs(pb.min.y) < 1e-6 && Math.abs(pb.max.y - (z.h - L.CONFIG.baseH)) < 1e-6 && Math.abs(bb.min.y - (z.h - L.CONFIG.baseH)) < 1e-6 && Math.abs(bb.max.y - z.h) < 1e-6, tag + "：底座在下面（高出来的那一截），地台照常厚 baseH");
          assert.ok(pb.max.x > bb.max.x && pb.min.x < bb.min.x, tag + "：底座比地台往外多出一点（看得出一级落差）");
          const rock = ped.material[1];
          assert.ok(rock.map && rock !== body.material[1], tag + "：底座的侧面是岩层（和地台的侧面分得开）");
          if (z.outline.stairs) {
            const steps = part("stairs");
            assert.ok(steps.length >= 2, tag + "：有台阶");
            const tops2 = steps.map(s => new THREE.Box3().setFromObject(s).max.y).sort((a, b) => a - b);
            assert.ok(tops2[tops2.length - 1] < z.h && tops2[tops2.length - 1] > z.h * 0.6, tag + "：台阶一级级爬到快到顶面");
          }
        } else assert.ok(!ped && !part("stairs").length, tag + "：普通区没有底座、台阶");
        W.disposeTree(g);
      });
      // 桥：高地和普通区之间斜着搭上去，两头的木板落在两头的地台顶面上
      layout.gaps.filter(g => g.type === "bridge").forEach(gap => {
        const g = W.buildGap(gap, ctx), planks = [];
        g.updateMatrixWorld(true);
        g.traverse(o => { if (o.isMesh && o.geometry.type === "BoxGeometry" && o.geometry.parameters.depth > 1) planks.push(new THREE.Box3().setFromObject(o)); });
        assert.ok(planks.length >= 3, `${id} ${gap.key}：有桥板`);
        const lo = Math.min(...planks.map(b => b.max.y)), hi = Math.max(...planks.map(b => b.max.y));
        const tag = `${id} ${gap.key}（两头 ${gap.y0} / ${gap.y1}）`;
        assert.ok(Math.abs(lo - Math.min(gap.y0, gap.y1)) < 0.25 && Math.abs(hi - Math.max(gap.y0, gap.y1)) < 0.25, `${tag}：桥板从 ${lo.toFixed(2)} 到 ${hi.toFixed(2)}，接不上两头的地台`);
        W.disposeTree(g);
      });
    }
    // 高地 ↔ 普通区的桥（演示里没有，自己搭一座）：斜的
    const st = boardState(CASES[1], 2);
    st.fields[2].highland = true; st.gaps["1-2"] = gapOf("bridge", 10); st.gaps["2-3"] = gapOf("bridge", 10);
    const out = L.build(st, { view: DESKTOP }), ctx = { anim: [], lamps: [], fxLights: 0, theme: "day" };
    out.gaps.forEach(gap => {
      assert.ok(Math.abs(gap.y0 - gap.y1) > 1, gap.key + "：一头高一头低");
      const g = W.buildGap(gap, ctx), centers = [];
      g.updateMatrixWorld(true);
      g.traverse(o => { if (o.isMesh && o.geometry.type === "BoxGeometry" && o.geometry.parameters.depth > 1) centers.push(new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3())); });
      // 沿着间隔从 y0 那头走到 y1 那头（横的从左往右，竖的从前往后）：桥板一块比一块高 / 低
      centers.sort((a, b) => (gap.axis === "x" ? a.x - b.x : b.z - a.z));
      assert.ok(centers.length >= 3, gap.key + "：有桥板");
      for (let i = 1; i < centers.length; i++) assert.ok((centers[i].y - centers[i - 1].y) * Math.sign(gap.y1 - gap.y0) > 0, gap.key + "：桥板一块比一块高（斜着搭上高地）");
      W.disposeTree(g);
    });
  } finally { P.restore(); }
});
