// 新旧画面之间的云雾转场（#261 追加，主人：「在远景情况下如果还继续缩小，就会变回之前的战斗画面，具体是镜头上升到正上方然后一阵白色云雾后切换成之前的战斗画面」）。
// 新 → 旧：新画面远景再往外拉（滚轮 / 双指捏小）→ 镜头升到正上方 → 白色云雾从四边涌进来盖满 → 切到旧画面（开关拨到关）→ 云雾散开；
// 旧 → 新反过来：旧战场上往前滚 → 云雾涌进来 → 切到新画面（镜头在正上方）→ 云雾散开、镜头降回远景。顶栏开关走同一段；转场中滚轮、开关都不理；
// 减少动态效果时直接切。都是 Node 能跑的：转场的几段、滚轮、镜头是纯函数，页面用假网页 + 假场景 + 假计时器走一遍；WebGL 画面和截图由仓库主人跑。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const HP = require("./hd2d-paths");
const L = require("../hd2d/hd2d-layout.js");
const C = require("../hd2d/hd2d-camera.js");

const field = () => require("../hd2d/hd2d-field.js");
const read = (f) => fs.readFileSync(path.join(HP.ROOT, f), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");   // 去掉注释，只看代码
const DESKTOP = { width: 1100, height: 620, top: 0, bottom: 40 };

/* ---------- 1. 配置表 ---------- */
test("转场的数值都在配置表里（hd2d-field.js 顶部的 MIST）：镜头升起的俯角 / 距离 / 时长、降回去的时长、云雾涌进来 / 停 / 散开的时长、颜色、透明度、几团、旧画面滚轮的门槛", () => {
  const F = field(), M = F.MIST;
  assert.ok(M, "有 MIST");
  assert.ok(M.rise.elevation >= 80 && M.rise.elevation < 90, "升到接近正上方（正 90 度镜头朝向算不出来）");
  assert.ok(M.rise.dist > 0 && M.rise.secs > 0 && C.EASE[M.rise.ease], "升多远、多久、缓动");
  assert.ok(M.descend.secs > 0 && C.EASE[M.descend.ease], "降回远景多久、缓动");
  ["cover", "hold", "clear", "overlap"].forEach(k => assert.ok(Number.isFinite(M[k]) && M[k] >= 0, k));
  assert.ok(M.overlap < M.rise.secs, "云雾在镜头升到顶之前就开始涌");
  assert.ok(Array.isArray(M.color) && M.color.length === 3 && M.color.every(v => v >= 0 && v <= 255), "云雾的颜色（白）");
  assert.deepEqual(M.color, [255, 255, 255], "白色云雾");
  assert.ok(M.opacity > 0.8 && M.opacity <= 1, "最浓时差不多盖满");
  assert.ok(M.puffs >= 4 && M.size > 0 && M.spread >= 0 && M.push > 0 && M.stagger >= 0, "几团、多大、离中心多远、从外面多远涌进来");
  assert.ok(M.wheel.step > 0 && M.wheel.idle > 0 && M.wheel.line > 0 && M.wheel.page > 0, "旧画面滚轮的门槛");
  const src = read("hd2d/hd2d-field.js");
  assert.ok(src.indexOf("const MIST = {") > 0 && src.indexOf("const MIST = {") < src.indexOf("function enabled("), "MIST 在文件顶部（配置区）");
});

/* ---------- 2. 转场的几段（纯函数）---------- */
test("转场的几段：新 → 旧 = 升镜头 → 云雾涌进来 → 切 → 散开；旧 → 新 = 云雾涌进来 → 切 → 散开（镜头同时降回远景）；时长都按 MIST；减少动态效果 / 新画面还没建好时只有 0 秒的切换", () => {
  const F = field(), M = F.MIST;
  const steps = (p) => p.map(s => s.step);
  const out = F.mistPlan("old", { live: true });
  assert.deepEqual(steps(out), ["rise", "cover", "swap", "clear"]);
  assert.equal(out[0].secs, M.rise.secs - M.overlap, "升到最后 overlap 秒时云雾就开始涌");
  assert.equal(out[1].secs, M.cover);
  assert.equal(out[2].secs, M.hold);
  assert.equal(out[3].secs, M.clear);
  const back = F.mistPlan("new", {});
  assert.deepEqual(steps(back), ["cover", "swap", "clear"], "旧 → 新：没有升镜头（旧画面没有镜头），云雾直接涌进来");
  assert.equal(back[2].secs, Math.max(M.clear, M.descend.secs), "散开和镜头降回远景一起走完");
  assert.deepEqual(F.mistPlan("old", { live: true, reduced: true }), [{ step: "swap", secs: 0 }], "减少动态效果：直接切");
  assert.deepEqual(F.mistPlan("new", { reduced: true }), [{ step: "swap", secs: 0 }], "减少动态效果：直接切");
  assert.deepEqual(F.mistPlan("old", { live: false }), [{ step: "swap", secs: 0 }], "3D 还没建好（加载中 / 打不开）：没有镜头能升，直接切");
});

/* ---------- 3. 滚轮 ---------- */
test("战场上的滚轮：一次滚动只算一下（攒够门槛才算）；停顿一下才是新的一次；ate（这一次已经换过画面）到新的一次滚动才清掉", () => {
  const F = field(), W = F.MIST.wheel;
  let r = F.wheelGate(null, -(W.step - 1), 10);
  assert.equal(r.step, 0, "滚得太少不算");
  r = F.wheelGate(r.state, -2, 10.05);
  assert.equal(r.step, 1, "攒够了：往前 = 拉近");
  r = F.wheelGate(r.state, -400, 10.1);
  assert.equal(r.step, 0, "同一次滚动里后面的都不算");
  r.state.ate = true;
  r = F.wheelGate(r.state, -100, 10.1 + W.idle * 0.9);
  assert.equal(r.state.ate, true, "还是同一次滚动（触控板的惯性）：ate 留着");
  r = F.wheelGate(r.state, 100, 10.1 + W.idle * 0.9 + W.idle + 0.01);
  assert.equal(r.step, -1, "停顿一下再往后滚：新的一次，拉远");
  assert.equal(r.state.ate, false, "新的一次：ate 清掉");
  assert.equal(F.wheelPixels({ deltaY: 3, deltaMode: 1 }), 3 * W.line, "按行");
  assert.equal(F.wheelPixels({ deltaY: 1, deltaMode: 2 }), W.page, "按页");
  assert.equal(F.wheelPixels({ deltaY: -53 }), -53);
});

/* ---------- 4. 镜头（纯函数）---------- */
test("镜头：远景到头了还往外拉才算转回旧画面（pastFar），中景 / 近景往外拉只换段；正上方的镜头看的还是战场中间、俯角接近 90 度；双指张开 / 捏小一下算一段", () => {
  assert.equal(C.pastFar({ tier: "far" }, -1), true, "远景往外拉：转回旧画面");
  assert.equal(C.pastFar({ tier: "mid" }, -1), false, "中景往外拉：只换到远景");
  assert.equal(C.pastFar({ tier: "near" }, -1), false);
  assert.equal(C.pastFar({ tier: "near", close: "u1" }, -1), false, "特写往外拉：回到正常的近景");
  assert.equal(C.pastFar({ tier: "far" }, 1), false, "远景往里推：拉近到中景");
  assert.equal(C.pastFar({ tier: "far" }, 0), false);
  assert.deepEqual(C.camStep({ tier: "mid", zone: 2, close: null }, { type: "wheel", step: -1 }), { tier: "far", zone: 2, close: null }, "中景往外拉：换到远景");
  // 正上方
  const out = L.build({ zoneMode: 3, units: [], fields: {}, gaps: {} }, { view: DESKTOP });
  const far = C.pose(out, "far", 1);
  const top = C.overheadPose(far, { elevation: 88, dist: 1.2 });
  assert.deepEqual(top.target, far.target, "看的还是远景看的那一点（战场中间）");
  assert.equal(top.elevation, 88);
  assert.ok(Math.abs(top.dist - far.dist * 1.2) < 1e-9, "离远一点");
  assert.ok(Math.abs(top.pos.y - top.target.y - top.dist * Math.sin(88 * Math.PI / 180)) < 1e-9, "在正上方");
  assert.ok(Math.hypot(top.pos.x - top.target.x, top.pos.z - top.target.z) < top.dist * 0.05, "几乎没有水平偏移");
  assert.equal(top.azimuth, 0);
  assert.equal(top.fov, far.fov);
  assert.equal(C.overheadPose(far, { elevation: 95 }).elevation, 89.5, "正 90 度以上夹住（镜头朝向算不出来）");
  assert.equal(JSON.stringify(far), JSON.stringify(C.pose(out, "far", 1)), "不改传进来的");
  // 双指
  const P = C.CAMERA.pinch.ratio;
  assert.equal(C.pinchStep(1 + P), 1, "张开：拉近");
  assert.equal(C.pinchStep(1 / (1 + P)), -1, "捏小：拉远");
  assert.equal(C.pinchStep(1.05), 0);
  assert.equal(C.pinchStep(0.95), 0);
  assert.equal(C.pinchStep(NaN), 0);
});
