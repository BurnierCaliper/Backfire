// 新画面的 3D 战场按需渲染（#321，hd2d/hd2d-pace.js + hd2d/hd2d-scene.js）：
//   · 画面静止（没有演出、镜头不动、没有天气粒子、没在打雷、刚才也没变）时不再每帧画，一秒只画 PACE.idle 帧；减少动态效果时一帧都不画
//   · 有演出、镜头在动、天气粒子在飞、打雷、刚变过时照常满帧画
//   · 满帧画时量帧时间：开场 grace 秒以后，一直卡就报一次（画质「自动」降一档，hd2d-field.js）
// 纯函数直接跑；场景要 WebGL，Node 里建不起来：接线查源码（WebGL 画面由仓库主人在浏览器里看）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const P = require("../hd2d/hd2d-pace.js");
const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");   // 去掉注释，只看代码

/** 照场景的样子跑 secs 秒 60 帧的 rAF：每一帧问 due，画了就记下时间；sig(t) = 这一刻的信号。返回画了几帧 */
function loop(secs, sig, hz) {
  const dt = 1 / (hz || 60);
  let last = null, drawn = 0;
  for (let t = 0; t < secs - 1e-9; t += dt) {
    if (P.due(last, t, sig(t))) { last = t; drawn++; }
  }
  return drawn;
}
const STILL = { fx: false, tween: false, moved: false, particles: false, motion: true, flash: 0, shake: false, storm: false, woke: false };

test("#321 配置都在 PACE 里：静止时一秒画几帧、变过以后满帧多久、闪光多少算还在闪、帧时间的门槛", () => {
  assert.deepEqual(Object.keys(P.PACE).sort(), ["flash", "idle", "jitter", "slow", "wake"]);
  assert.ok(P.PACE.idle >= 10 && P.PACE.idle < 60, "静止时降帧，但待机的小动画还在走（场景每帧的 dt 最多 0.1 秒）：" + P.PACE.idle);
  assert.ok(P.PACE.wake > 0 && P.PACE.wake <= 2);
  assert.deepEqual(Object.keys(P.PACE.slow).sort(), ["gap", "grace", "ms", "secs"]);
});

test("#321 要不要满帧画（busy）：有演出、镜头在过渡 / 被拖动、刚变过、镜头在抖、闪光、天气粒子（减少动态效果时粒子停住，不算）——都没有就是静止", () => {
  assert.equal(P.busy(STILL), false, "都没有：静止");
  assert.equal(P.busy({}), false);
  assert.equal(P.busy(null), false);
  for (const k of ["fx", "tween", "moved", "woke", "shake"]) assert.equal(P.busy(Object.assign({}, STILL, { [k]: true })), true, k);
  assert.equal(P.busy(Object.assign({}, STILL, { particles: true })), true, "天气粒子在飞");
  assert.equal(P.busy(Object.assign({}, STILL, { particles: true, motion: false })), false, "减少动态效果：粒子停住了");
  assert.equal(P.busy(Object.assign({}, STILL, { flash: 0.4 })), true, "打雷闪光");
  assert.equal(P.busy(Object.assign({}, STILL, { flash: P.PACE.flash / 2 })), false, "闪光退干净了");
});

test("#321 画面静止时不再每帧画：60 帧的 rAF 里一秒只画 PACE.idle 帧；有演出 / 镜头在动 / 天气粒子 / 刚变过时每帧都画；减少动态效果又静止：第一帧以后一帧都不画（打雷时照样按时间数）", () => {
  const idle = loop(2, () => STILL);
  assert.ok(Math.abs(idle - 2 * P.PACE.idle) <= 2, `静止 2 秒画了 ${idle} 帧（≈ ${2 * P.PACE.idle}，以前 120）`);
  assert.equal(loop(2, () => Object.assign({}, STILL, { fx: true })), 120, "有演出：满帧");
  assert.equal(loop(2, () => Object.assign({}, STILL, { tween: true })), 120, "镜头在过渡：满帧");
  assert.equal(loop(2, () => Object.assign({}, STILL, { moved: true })), 120, "拖动 / 惯性：满帧");
  assert.equal(loop(2, () => Object.assign({}, STILL, { particles: true })), 120, "沙 / 雨 / 雪：满帧");
  // 演出播了 0.5 秒、播完以后静止：演出那一段满帧，之后降下来
  const mixed = loop(2, t => Object.assign({}, STILL, { fx: t < 0.5 }));
  assert.ok(mixed >= 30 && mixed <= 30 + 1.5 * P.PACE.idle + 2, "演出那半秒满帧（30 帧），之后一秒半按静止的来：" + mixed);
  // 减少动态效果：待机动画本来就停住，静止时只画第一帧
  const reduced = Object.assign({}, STILL, { motion: false });
  assert.equal(loop(2, () => reduced), 1, "减少动态效果、静止：只画第一帧");
  assert.equal(loop(2, () => Object.assign({}, reduced, { woke: true })), 120, "变了（铭牌、标记……）照样画");
  assert.ok(loop(2, () => Object.assign({}, reduced, { storm: true })) > 1, "雷鸣：雷要按时间数，照静止的降帧来画");
  // rAF 比 60 快（120 Hz 屏幕）：静止时还是一秒 PACE.idle 帧
  const fast = loop(2, () => STILL, 120);
  assert.ok(Math.abs(fast - 2 * P.PACE.idle) <= 2, "120 Hz：" + fast);
});

test("#321 帧时间：只量接连两帧都满帧画的；开场 grace 秒不算；之后每攒够 secs 秒算一次平均，一帧超过 ms 毫秒报一次卡；不卡、隔太久的那一下、降帧画的都不算", () => {
  const S = P.PACE.slow;
  const run = (secs, dt, full) => { let m = null, n = 0; for (let t = 0; t < secs; t += dt) { const r = P.meter(m, dt, full); m = r.m; if (r.slow) n++; } return n; };
  assert.equal(run(S.grace + S.secs * 3, 1 / 60, true), 0, "60 帧：不卡");
  assert.equal(run(S.grace + S.secs * 3, 1 / 30, true), 0, "30 帧：不卡");
  assert.ok(run(S.grace + S.secs * 3 + 0.5, 0.06, true) >= 3, "一帧 60 毫秒：每 secs 秒报一次");
  assert.equal(run(S.grace, 0.06, true), 0, "开场 grace 秒不算（编译着色器、传贴图）");
  assert.equal(run(S.grace + S.secs * 3, 0.06, false), 0, "降帧画的（静止时）不算");
  assert.equal(run(S.grace + S.secs * 3, S.gap + 0.05, true), 0, "两帧隔太久（切到后台、卡了一下）那一下不算");
  // 不改传进来的
  const m0 = { seen: 10, sum: 1, n: 3 }, r = P.meter(m0, 0.016, true);
  assert.deepEqual(m0, { seen: 10, sum: 1, n: 3 });
  assert.notEqual(r.m, m0);
});

test("#321 场景（hd2d-scene.js）每一帧先问 HD2DPace.due 再画：信号是演出（options.busy）、过渡、镜头动了没有（和上一次画的时候比）、天气粒子、减少动态效果、闪光、抖动、雷鸣、刚变过；满帧画时量帧时间，一直卡叫 options.onSlow；没加载 hd2d-pace.js 就照旧每帧画", () => {
  const src = code(read("hd2d/hd2d-scene.js"));
  assert.match(src, /const P = window\.HD2DPace \|\| null;/, "从普通脚本拿（没加载就是 null）");
  const frame = src.slice(src.indexOf("function frame() {"), src.indexOf("const ro = new ResizeObserver(resize);"));
  assert.ok(frame.length > 500, "找到 frame()");
  const at = (s) => { const i = frame.indexOf(s); assert.ok(i >= 0, "frame() 里有：" + s); return i; };
  // 镜头每一帧都走（便宜），然后问画不画，画的部分（动画、天气、composer.render、铭牌）都在后面
  assert.ok(at("controls.update();") < at("P.due(lastDraw, t, sig)"));
  assert.ok(at("if (P && !P.due(lastDraw, t, sig)) return;") < at("const dt = Math.min(0.1, clock.getDelta());"), "不画的帧不取 dt：动画时间攒到下一次画的时候");
  assert.ok(at("const dt = Math.min(0.1, clock.getDelta());") < at("weather.update(") && at("weather.update(") < at("composer.render(dt);") && at("composer.render(dt);") < at("labels.render(scene, camera);"));
  const sig = /const sig = \{([^}]*)\};/.exec(frame);
  assert.ok(sig, "这一刻的信号");
  assert.deepEqual(sig[1].split(",").map(s => s.split(":")[0].trim()).sort(), ["flash", "fx", "motion", "moved", "particles", "shake", "storm", "tween", "woke"]);
  assert.match(sig[1], /fx: sliding \|\| !!\(options\.busy && options\.busy\(\)\)/, "演出在播：外面告诉，或者铭牌在换区滑动、地台在闪（#330）");
  assert.match(frame, /let sliding = zoneFlashes\.length > 0;\s*if \(!sliding\) state\.plates\.forEach\(p => \{ if \(p\.slide\) sliding = true; \}\);/, "滑动中的铭牌、在闪的地台都算");
  assert.match(sig[1], /moved: camMoved\(\)/, "镜头和上一次画的时候比动了没有");
  assert.match(sig[1], /particles: !!state\.particles/);
  assert.match(sig[1], /woke: t < wakeUntil/);
  assert.match(frame, /const full = !P \|\| P\.busy\(sig\);/);
  assert.match(frame, /if \(P && options\.onSlow\) \{\s*const r = P\.meter\(meter, lastDraw == null \? 0 : t - lastDraw, full && lastFull\);\s*meter = r\.m;\s*if \(r\.slow\) options\.onSlow\(\);/, "满帧画时量帧时间，一直卡告诉外面");
  assert.match(frame, /camWas\.pos\.copy\(camera\.position\); camWas\.target\.copy\(controls\.target\); camWas\.fov = camera\.fov;\s*\}\s*$/, "画完记下镜头在哪（抖完挪回去以后）");
  assert.match(src, /state\.particles = !!\(plan\.main \|\| plan\.streak \|\| plan\.ribbon\);/, "天气粒子：沙 / 雨 / 雪……（飘浮物不算）");
  // 刚变过（之后 PACE.wake 秒满帧画）：铭牌、标记、选中框、镜头摆位、战场、窗口 / 像素、风、按下
  assert.match(src, /function wake\(\) \{ if \(P\) wakeUntil = performance\.now\(\) \/ 1000 \+ P\.PACE\.wake; \}/);
  const body = (name) => src.slice(src.indexOf(name), src.indexOf("\n  }", src.indexOf(name)));
  ["function markPlates() {", "function setBattle(layout, meta) {", "function applyPose(p) {", "function placeFocus() {", "function placeMarks() {", "function applyPixels() {"]
    .forEach(f => assert.match(body(f), /\bwake\(\);/, f + " 叫 wake"));
  assert.match(src, /setWind\(w\) \{ weather\.setWind\(w\); wake\(\); \}/);
  assert.match(src, /renderer\.domElement\.addEventListener\("pointerdown", \(e\) => \{ downAt = \{ x: e\.clientX, y: e\.clientY \}; wake\(\); \}\);/, "按下就满帧（拖动马上跟手）");
  // 画面在后台：照旧不画，下一次也不算接连满帧
  assert.match(frame, /if \(document\.hidden \|\| !container\.clientWidth\) \{ clock\.getDelta\(\); lastFull = false; return; \}/);
});

test("#321 hd2d-pace.js 在场景包前面加载：正式画面开新画面时（FIELD.scripts，场景包最后加载）、原型页（场景模块前面）都有；game.html 照旧不预先加载", () => {
  const F = require("../hd2d/hd2d-field.js");
  assert.ok(F.FIELD.scripts.includes("hd2d-pace.js"), "开了才加载的普通脚本里有它（都在场景包前面）");
  assert.ok(fs.existsSync(path.join(ROOT, "hd2d", "hd2d-pace.js")));
  const proto = read("prototypes/hd2d/index.html");
  assert.ok(proto.indexOf('<script src="../../hd2d/hd2d-pace.js"></script>') > 0 && proto.indexOf('<script src="../../hd2d/hd2d-pace.js"></script>') < proto.indexOf('<script type="module">'), "原型页：场景模块前面");
  assert.match(proto, /busy: \(\) => !!HD2DPlay\.busy/, "原型页：演出在播时满帧");
  assert.ok(!/hd2d-pace\.js/.test(read("game.html")), "game.html 不预先加载（开了才载）");
});
