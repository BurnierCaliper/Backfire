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
