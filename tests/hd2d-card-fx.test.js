// 新画面动画对齐旧画面（#330）：旧画面（game.js）单位卡上有的动画，新画面（HD-2D）的 3D 白卡 / 地台也要有——
//   1. 冲撞 dashTo / lunge：往后一收再朝目标那张卡扑上去（按屏幕投影的方向），heavy 冲得远、keep 冲过去停住；冲一下（lunge）
//   2. 受击 hit 闪一下属性色 + knock 顺着挨打的方向被打退
//   3. 击倒 ko-held（这一段演完之前留着）→ 淡出 → 已经不在画面数据里的 gone，淡完才从 3D 战场上拿掉
//   4. 换区移动：铭牌的 3D 锚点在两个地台之间滑过去（场景插值，时长跟着演出倍率，镜头不动）+ 借机攻击的 slow-move
//   5. 登场 enter（伙伴登场、召唤 / 援军刚出现）
//   6. 格挡 parry（协助格挡冲上去挡、火花在两人中间）
//   7. 顿帧 hitstop / 震屏 quake：3D 那一层（画布 + 铭牌）在 #g-field 里，跟着一起震、一起变色
//   8. 区域预警 threat（地台红框 + 预警字，下一回合就落地的一明一暗）、高能自爆预警 high-warn（白卡 + 脚下的地台一起闪）
// 单机（game.js → hd2d-field.js → hd2d-play.js · HD2DPlay.cards）和联机玩家（hd2d-play.js 播收到的包）都演；跳过 / 演出倍率 0 / 减少动态效果时不演。
// 都在 Node 里跑：小 DOM（tests/mini-dom.js）里加载 unit-card.js / online-battle.js / hd2d 的几个普通脚本，3D 场景换成假的（照真场景摆白卡的 DOM：
// .hd2d-labels > .hd2d-plate > .pl-in > .pl-bob > 白卡）；场景里新加的几段（锚点滑动、区域预警、地台闪）从 hd2d-scene.js 的源码抠出来跑，
// game.js 的接线抠函数出来跑 / 查源码。WebGL 画面由仓库主人看。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("./headless");
const HP = require("./hd2d-paths");
const MD = require("./mini-dom");
const FXM = require("../hd2d/hd2d-fx.js");
const L = require("../hd2d/hd2d-layout.js");

const read = (f) => fs.readFileSync(path.join(HP.ROOT, f), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");   // 去掉注释，只看代码
const PARTY = ["kolt", "helu", "ruby", "yuito"];
const DESKTOP = { width: 1100, height: 620, top: 0, bottom: 40 };
const SHP = 7771, SHP_MAX = 7772;
const K = FXM.FX.card;
const settle = async (n) => { for (let i = 0; i < (n || 6); i++) await new Promise(r => setImmediate(r)); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const last = (a) => a[a.length - 1];
const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= (eps == null ? 0.05 : eps), `${what || ""}：${a} ≈ ${b}`);
/** 白卡上 transform 的位移（卡片自己的像素）和歪几度；没有 = null */
const tr = (w) => {
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)(?: rotate\((-?[\d.]+)deg\))?/.exec((w && w.style.transform) || "");
  return m ? { x: Number(m[1]), y: Number(m[2]), rot: m[3] ? Number(m[3]) : 0 } : null;
};

/** 从源码里抠出一个函数（连着前面的 async；按大括号配对） */
function fnSrc(src, name) {
  let at = src.indexOf("function " + name + "(");
  assert.ok(at >= 0, "找不到 " + name);
  if (src.slice(at - 6, at) === "async ") at -= 6;
  let i = src.indexOf("{", src.indexOf(")", at)), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(at, i + 1);
}

/* ---------- 共用：规则里摆一场战斗、小 DOM 的页面、假的 3D 场景 ---------- */
/** 规则环境里一场三区的战斗（敌人在 2 / 3 区）；每个人塞上特殊的坚毅生命数（新加的 DOM 里不该出现） */
function battle() {
  const ctx = H.load();
  vm.runInContext(read("online-view.js"), ctx, { filename: "online-view.js" });
  const st = ctx.BattleSim.setup({
    party: PARTY, zoneMode: 3, seed: "hd2d-card-fx",
    enemies: [{ id: "thug_hammer", lv: 2, zone: 2 }, { id: "guard_sword", lv: 2, zone: 3 }, { id: "thug_knife", lv: 1, zone: 3 }]
  });
  st.units.forEach(u => { u.shp = SHP; u.shpMax = SHP_MAX; u.baseShp = SHP; });
  return { ctx, st, OV: ctx.OnlineView, unit: (kit) => st.units.find(u => u.kit === kit) };
}

/** 假的 3D 场景：照真场景（hd2d-scene.js · syncPlates / syncCard）在 .hd2d-labels 里摆铭牌和白卡（UnitCard 画），记下交给它的布局 / meta / 地台闪 */
function fakeScene(P, o) {
  o = o || {};
  return (stage) => {
    const doc = P.doc, UC = P.UC;
    const labels = doc.createElement("div");
    labels.className = "hd2d-labels";
    stage.appendChild(labels);
    const plates = new Map();
    const sc = {
      portrait: false, motion: !o.still, tier: "far", zone: null, flash: 0, layout: null, metas: [], flashes: [], refits: 0, actors: [],
      view: () => DESKTOP,
      setInsets() {}, refit() { sc.refits++; }, setMarks() {}, setActor(id) { sc.actors.push(id); }, setWind() {}, setTier() {}, stepZone() {},
      setBattle(layout, meta) {
        sc.layout = layout; sc.metas.push(meta);
        const live = new Set();
        layout.units.forEach(u => {
          live.add(u.id);
          let p = plates.get(u.id);
          if (!p) {
            const el = doc.createElement("div");
            el.className = "hd2d-plate";
            el.innerHTML = '<div class="pl-in"><div class="pl-bob"></div></div>';
            labels.appendChild(el);
            p = { el };
            plates.set(u.id, p);
          }
          if (u.card && !p.card) { p.card = UC.create(u.card); p.el.classList.add("card"); p.el.querySelector(".pl-bob").appendChild(p.card.wrap); }
          if (u.card) UC.update(p.card, u.card, { quiet: true });
          p.u = u;
        });
        plates.forEach((p, id) => { if (!live.has(id)) { p.el.remove(); plates.delete(id); } });
      },
      lensNow: () => ({ pos: sc.layout.camera.pos, target: sc.layout.camera.target, fov: sc.layout.camera.fov, width: DESKTOP.width, height: DESKTOP.height }),
      plateOf: (id) => {
        const p = plates.get(id), u = p && p.u;
        return u ? Object.assign({ x: u.x, y: u.y, z: u.z, lift: u.lift, big: false, zoom: 1 }, u.size ? { w: u.size.w, h: u.size.h, s: L.CONFIG.card.tier.far } : {}) : null;
      },
      zoneOf: (id) => (sc.layout ? sc.layout.zones.find(z => z.id === Number(id)) || null : null),
      zoneFx: (zone, kind, opt) => { if (!sc.motion) return false; sc.flashes.push({ zone, kind, secs: opt && opt.secs }); return true; },
      poseNow: () => Object.assign(P.w.HD2DCamera.pose(sc.layout, "far", null, {}), { tier: "far" }),
      posePush() {}, poseRelease() {},
      dispose() { sc.disposed = true; }
    };
    P.log.scenes.push(sc);
    return sc;
  };
}

/** 小 DOM 的游戏页面（#g-app > #g-field）+ 一场战斗；hd2d 的几个普通脚本、单位卡、联机的单位卡快照都加载好，hd2d-field.js 等测试自己 boot */
function setup() {
  const R = battle();
  const MDP = MD.create('<div id="g-app" class="g-app"><main id="g-field" class="g-field"></main></div>');
  const w = MDP.window, doc = MDP.document, ctx = vm.createContext(w);
  ["icons.js", "hud-icons.js", "unit-card.js", "online-battle.js", "hd2d/hd2d-layout.js", "hd2d/hd2d-camera.js", "hd2d/hd2d-fx.js", "hd2d/hd2d-play.js"]
    .forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  doc.readyState = "loading";   // hd2d-field.js 别自己 boot（下面换上假的场景再 boot）
  vm.runInContext(read("hd2d/hd2d-field.js"), ctx, { filename: "hd2d/hd2d-field.js" });
  // 3D 战场那一层量得到宽（小 DOM 的元素宽都是 0：战场藏着时新画面不排）
  Object.defineProperty(w.Element.prototype, "clientWidth", { configurable: true, get() { return this.classList && this.classList.contains("hd2d-field") ? DESKTOP.width : 0; } });
  const clock = { v: 1 }, timers = [], log = { scenes: [], clash: [], sparks: [], links: [], areas: [] };
  w.HD2DWfx = { windOf: () => ({ x: 1, z: 0 }), create: () => ({ sync() {}, dispose() {} }) };   // 天气的 2D 层要真的网页
  // attack-fx 要真的画布：换成只记一笔的（弹道、刀光这些 #283 已经有了，这里不测）
  w.AttackFx = {
    after: () => Promise.resolve(), windup: () => Promise.resolve(), travel: () => Promise.resolve(),
    link: (a, b) => { log.links.push([a, b]); return Promise.resolve(); },
    impact() {}, area: (r) => log.areas.push(r), clash: (r) => log.clash.push(r), sparks: (p) => log.sparks.push(p), ko() {}, setClock() {}, skip() {}
  };
  w.state = R.st;
  w.OnlineView = R.OV;
  let over = {};
  /** 这一刻的投影（联机玩家收到的那一份）/ 画面快照（game.js · setView 给新画面的那一份，照单位卡的样子；over = { 单位 id: 改哪几个字段 }） */
  const pv = () => R.OV.projectState(R.st, {});
  const snaps = () => pv().units.map(u => Object.assign(w.OnlineBattle.snapUnit(u), over[u.id] || {}));
  w.GAME = { depth: 0, koHold: 0, fxClock: () => clock.v, snapAll: () => snaps(), refresh() {}, fieldInput: { unit() {}, hover() {}, zone() {}, zoneHover() {} } };
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  const P = { R, w, doc, ctx, F: w.HD2DField, UC: w.UnitCard, OB: w.OnlineBattle, clock, timers, log, pv, snaps, set: (o) => { over = o || {}; } };
  /** 打开新画面（本机记着开 → boot 就建好）；o.still = 系统开了「减少动态效果」（场景的 motion 关着） */
  P.open = async (o) => {
    mem.set(P.F.FIELD.storageKey, "on");
    P.F.boot({ doc, storage, load: () => Promise.resolve(fakeScene(P, o)), hint() {}, reduced: () => true, wait: (s, fn) => timers.push({ s, fn }) });
    await settle();
    assert.equal(P.F.on(), true, "新画面建好了");
    return P.scene();
  };
  P.scene = () => last(log.scenes);
  /** 3D 白卡（.hd2d-labels 里的 .unit-wrap，data-id = 单位 id）；它所在的铭牌 */
  P.card = (id) => [...doc.querySelectorAll(".hd2d-labels .unit-wrap")].find(x => String(x.dataset.id) === String(id)) || null;
  P.plateEl = (id) => { const c = P.card(id); return c ? c.closest(".hd2d-plate") : null; };
  P.ids = () => P.scene().layout.units.map(u => String(u.id));
  /** 跑排着的计时器（hd2d-field.js 的 env.wait：淡出、震屏摘掉），返回各自要等的秒数 */
  P.run = () => { const q = timers.splice(0); q.forEach(t => t.fn()); return q.map(t => t.s); };
  return P;
}

/** game.js 里旧卡动画的那几个函数抠出来（dashTo / lunge / recoil / nudgeCard / flashClass / hit / shakeField / releaseKOs），放进页面里跑：
 *  旧卡（看不见的旧画面）照旧动，新画面开着时 3D 白卡也跟着动 */
function gameFns(P, G) {
  const g = read("game.js");
  const one = (re, what) => { const m = re.exec(g); assert.ok(m, "game.js 里有 " + what); return m[0]; };
  const consts = [
    one(/^  const field3d = .*;$/m, "field3d"), one(/^  const cards3d = .*;$/m, "cards3d（#330：新画面的卡片动画）"),
    one(/^  const noQuake3d = .*;$/m, "noQuake3d（#330：新画面开着时跳过 / 减少动态效果不震屏）"), one(/^  const ELE_VAR = .*;$/m, "ELE_VAR")
  ].join("\n");
  const fns = ["dashTo", "settleBack", "nudgeCard", "shakeField", "flashClass", "recoil", "lunge", "hit", "releaseKOs"].map(n => fnSrc(g, n)).join("\n");
  const make = vm.runInContext(`(function (G, cards, rectOf, centerOf, $, realTimeout, fxRandom, sp, wait, gapNode, boxOf) {
    ${consts}
    ${fns}
    return { dashTo, nudgeCard, shakeField, flashClass, recoil, lunge, hit, releaseKOs };
  })`, P.ctx, { filename: "game.js（抠出来的卡片动画）" });
  // 旧画面的单位卡（新画面开着时照旧排在看不见的旧战场上）
  const hidden = P.doc.createElement("div");
  P.doc.body.appendChild(hidden);
  const old = new Map();
  P.pv().units.forEach(u => { const c = P.UC.create(P.OB.snapUnit(u)); hidden.appendChild(c.wrap); old.set(u.id, c); });
  // game.js · rectOf / centerOf：新画面开着时问 3D（hd2d-field.js · rectOf）
  const rectOf = (id) => { const r = P.F.rectOf(id); return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null; };
  const centerOf = (id) => { const r = P.F.rectOf(id); return r ? { x: r.x, y: r.y, r: { left: r.left, top: r.top, width: r.w, height: r.h } } : null; };
  const f = make(G, old, rectOf, centerOf, (id) => P.doc.getElementById(id), (fn, ms) => setTimeout(fn, ms), () => 0.5,
    (ms) => (G.skip ? 0 : ms * (G.slow || 1)), () => Promise.resolve(), () => null, () => null);
  return Object.assign(f, { old });
}
const G0 = () => ({ sim: false, skip: false, fast: false, slow: 1, koHold: 0, koHandles: [] });
/** 新加的 DOM 里不该有坚毅生命 */
function noShp(text, tag) {
  assert.ok(!text.includes(String(SHP)) && !text.includes(String(SHP_MAX)), tag + "：出现了坚毅生命的数字");
  assert.doesNotMatch(text, /坚毅生命|shpMax|shpBase|shpBonus/, tag + "：出现了坚毅生命的字段");
}

/* ---------- 0. 数值、纯函数 ---------- */
test("数值都在配置表（hd2d-fx.js 的 FX.card，照 game.js / game.css 现有的数）；冲撞的两步、击退往哪退、换区滑多久、滑到哪都是纯函数", () => {
  // 照 game.js：dashTo 往后 12 像素 90 毫秒、扑上去 100 毫秒、冲 92（heavy 112）、停 130 回位 240；lunge 26 像素 130 / 90 毫秒；hit 的击退 11（大伤害 17）像素
  assert.deepEqual([K.dash.back, K.dash.backMs, K.dash.inMs, K.dash.reach, K.dash.heavyReach, K.dash.hold, K.dash.home, K.dash.keepHold], [12, 90, 100, 92, 112, 130, 240, 560]);
  assert.deepEqual([K.lunge.px, K.lunge.ms, K.lunge.back], [26, 130, 90]);
  assert.deepEqual([K.knock.px, K.knock.big], [11, 17]);
  // 照 game.css：被打倒的淡出 0.5 + 1.2 秒（重击 1.4 + 2.4）、.gone 0.45 秒；换区 0.75 秒（game.js · placeCard）
  assert.deepEqual([K.ko.fade, K.ko.slow, K.ko.gone, K.move.secs], [1700, 3800, 450, 0.75]);
  const css = read("game.css");
  assert.match(css, /\.unit-wrap\.dead \{ opacity: 0; transition: opacity 1\.2s ease-in \.5s;/);
  assert.match(css, /\.unit-wrap\.dead\.dead-slow \{ transition: opacity 2\.4s ease-in 1\.4s; \}/);
  assert.match(css, /\.unit-wrap\.dead\.gone, \.unit-wrap\.dead\.dead-slow\.gone \{ opacity: 0; transition: opacity \.45s ease-in; \}/);
  assert.match(read("game.js"), /c\.wrap\.style\.transition = `transform \$\{G\.fast \? 0\.4 : 0\.75\}s/);
  // 冲撞：先背着目标往后一收，再朝目标扑 reach；heavy 远一点；离得近的不超过两张卡中心距离减半张卡宽
  const a = { x: 100, y: 300, w: 160, h: 200 }, t = { x: 700, y: 140, w: 160, h: 200 };
  const d = FXM.dashOf(a, t, {}), hv = FXM.dashOf(a, t, { heavy: true }), u = FXM.dirOf(a, t);
  near(d.back.x, -u.ux * K.dash.back, 1e-9, "往后一收"); near(d.hit.x, u.ux * K.dash.reach, 1e-9, "扑上去");
  near(hv.reach, K.dash.heavyReach, 1e-9, "heavy 冲得远");
  assert.equal(FXM.dashOf(a, t, { reach: 999 }).reach, u.d, "reach 999 = 一直冲到目标");
  assert.equal(FXM.dashOf(a, { x: 180, y: 300, w: 160, h: 200 }, {}).reach, K.dash.min, "贴得很近：至少冲 min");
  // 击退：顺着挨打的方向（从出手的人指向挨打的人），竖直方向压一点，大伤害退得远、歪得多
  const kb = FXM.knockOf({ left: 600, top: 100, width: 160, height: 200, x: 680, y: 184 }, { x: 100, y: 200 }, false);
  assert.ok(kb.kx > 0 && kb.kr > 0, "从左边打过来：往右退、往右歪");
  near(Math.hypot(kb.kx, kb.ky / K.knock.flatY), K.knock.px, 1e-6, "退 px 像素");
  near(Math.hypot(...Object.values(FXM.knockOf({ x: 0, y: 0 }, { x: 100, y: 0 }, true)).slice(0, 2)), K.knock.big, 1e-6, "大伤害退得远");
  // 换区滑多久：要演、没跳过、没开减少动态效果；时长 × 演出倍率
  assert.equal(FXM.moveSecs(1, { animate: true }), K.move.secs);
  assert.equal(FXM.moveSecs(0.5, { animate: true }), K.move.secs * 0.5, "演出 2×：快一半");
  assert.equal(FXM.moveSecs(1.7, { animate: true }), K.move.secs * 1.7, "借机攻击的慢放：慢下来");
  assert.equal(FXM.moveSecs(0, { animate: true }), 0, "跳过（倍率 0）：直接摆过去");
  assert.equal(FXM.moveSecs(1, { animate: true, reduced: true }), 0, "减少动态效果：直接摆过去");
  assert.equal(FXM.moveSecs(1, {}), 0, "不是演出中的刷新：直接摆过去");
  // 滑到哪：缓出（一开始快、到了慢下来），到了 done
  const s = FXM.slide({ x: 0, y: 0, z: 0, g: 0 }, { x: 10, y: 2, z: -4, g: 1 }, 0.75, 100);
  assert.deepEqual(FXM.slideAt(s, 100), { x: 0, y: 0, z: 0, g: 0, k: 0, done: false });
  const mid = FXM.slideAt(s, 100.375);
  assert.ok(mid.k > 0.5 && mid.x > 5 && !mid.done, "一半时间走了一大半（缓出）");
  assert.deepEqual(FXM.slideAt(s, 101), { x: 10, y: 2, z: -4, g: 1, k: 1, done: true });
  assert.equal(FXM.slide({ x: 0, y: 0, z: 0, g: 0 }, { x: 1, y: 0, z: 0, g: 0 }, 0, 0), null, "0 秒不滑");
});

/* ---------- 1. 冲撞 ---------- */
test("1. 冲撞：3D 白卡照旧画面（game.js · dashTo）先背着目标往后一收、再朝目标那张卡扑上去（按屏幕投影的方向，位移按卡片这一刻的缩放换回卡片像素），停一下回位；heavy 冲得远、keep 冲过去停住；lunge 朝目标冲一下；冲撞中的铭牌压在最上面。跳过 / 倍率 0 / 减少动态效果不演", async () => {
  const P = setup();
  await P.open();
  const kolt = P.R.unit("kolt").id, foe = P.R.unit("guard_sword").id;
  const k = P.F.cards();
  assert.ok(k, "新画面开着：game.js 拿得到卡片动画（HD2DField.cards）");
  const a = P.F.rectOf(kolt), t = P.F.rectOf(foe), w = P.card(kolt), plate = P.plateEl(kolt);
  assert.ok(a && t && a.scale > 0 && w && plate, "白卡、它在屏幕上的矩形（带这一刻的缩放）");
  const u = FXM.dirOf(a, t), plan = FXM.dashOf(a, t, {});
  P.clock.v = 0.2;
  const go = k.dash(kolt, t, {});
  // 第一步：背着目标往后一收（旧画面的 .lunge），压在别的铭牌上面
  let m = tr(w);
  assert.ok(w.classList.contains("lunge") && plate.classList.contains(K.front), "冲撞中：.lunge、铭牌压在最上面");
  near(m.x * a.scale, plan.back.x, 0.1, "往后一收（屏幕像素）"); near(m.y * a.scale, plan.back.y, 0.1);
  assert.ok(Math.sign(m.x) === -Math.sign(u.ux), "背着目标");
  assert.match(w.style.transition, /^transform \d+ms /, "时长写在 transition 上（跟着演出倍率）");
  assert.equal(await go, true);
  // 第二步：扑到——朝目标那张卡（屏幕投影的方向）冲 reach 像素
  m = tr(w);
  near(m.x * a.scale, plan.hit.x, 0.1, "扑上去（屏幕像素）"); near(m.y * a.scale, plan.hit.y, 0.1);
  assert.ok(Math.sign(m.x) === Math.sign(u.ux) && Math.sign(m.y) === Math.sign(u.uy), "朝目标那张卡");
  near(Math.hypot(m.x, m.y) * a.scale, K.dash.reach, 0.2, "冲 92 像素");
  // 停一下再回位，回位以后 .lunge、压在最上面都撤掉
  await sleep((K.dash.hold + K.dash.home) * 0.2 + 60);
  assert.equal(w.style.transform, "", "回原位");
  assert.ok(!w.classList.contains("lunge") && !plate.classList.contains(K.front));
  // heavy 冲得远；keep 冲过去停住（伯妮尔变回武器），过了 keepHold 才悄悄回位
  await k.dash(kolt, t, { heavy: true });
  near(Math.hypot(tr(w).x, tr(w).y) * a.scale, K.dash.heavyReach, 0.2, "heavy 冲 112 像素");
  await sleep((K.dash.hold + K.dash.home) * 0.2 + 60);
  await k.dash(kolt, t, { keep: true });
  await sleep((K.dash.hold + K.dash.home) * 0.2 + 10);   // 普通的冲撞这时已经回位了
  assert.ok(tr(w), "keep：冲过去停在那里");
  await sleep(K.dash.keepHold * 0.2 + 40);
  assert.equal(w.style.transform, "", "过了 keepHold 悄悄回位");
  // lunge：朝目标冲 26 像素再回来
  const lg = k.lunge(kolt, foe);
  m = tr(w);
  near(Math.hypot(m.x, m.y) * a.scale, K.lunge.px, 0.2, "冲一下 26 像素"); assert.ok(Math.sign(m.x) === Math.sign(u.ux), "朝目标");
  await lg;
  assert.equal(w.style.transform, ""); assert.ok(!w.classList.contains("lunge"));
  // 远程后坐、专属演出挪一下、临时挂的样式（.fx-tremble……）
  k.recoil(kolt, t);
  assert.ok(Math.sign(tr(w).x) === -Math.sign(u.ux), "后坐：背着目标往后一顿");
  await sleep((K.recoil.hold + K.recoil.home) * 0.2 + 60);
  k.nudge(kolt, -20, 0, 240);
  near(tr(w).x * a.scale, -20, 0.1, "挪一下（屏幕像素）");
  k.cls(kolt, "fx-tremble", 600);
  assert.ok(w.classList.contains("fx-tremble"));
  await sleep(600 * 0.2 + 120);
  assert.ok(!w.classList.contains("fx-tremble"), "到时间摘掉");
  // 跳过 / 演出倍率 0：不演
  P.clock.v = 0;
  assert.equal(await k.dash(kolt, t, {}), false);
  assert.equal(await k.lunge(kolt, foe), false);
  assert.equal(k.recoil(kolt, t), false);
  assert.equal(w.style.transform, "", "跳过：白卡不动"); assert.ok(!w.classList.contains("lunge"));
  // 减少动态效果：不演
  P.clock.v = 1;
  const Q = setup();
  await Q.open({ still: true });
  const kq = Q.F.cards();
  assert.equal(await kq.dash(kolt, Q.F.rectOf(foe), {}), false, "减少动态效果：不冲");
  assert.equal(await kq.lunge(kolt, foe), false);
  assert.equal(Q.card(kolt).style.transform, "");
});

/* ---------- 2. 受击 ---------- */
test("2. 受击：3D 白卡照旧画面（game.js · hit）闪一下属性色（.hit，.flash 的 --flash）、有出手的人时顺着挨打的方向被打退一下（.knock：--kx / --ky / --kr，按屏幕投影、换回卡片像素），大伤害退得远。跳过 / 倍率 0 / 减少动态效果不演", async () => {
  const P = setup();
  await P.open();
  const kolt = P.R.unit("kolt").id, foe = P.R.unit("guard_sword").id;
  const k = P.F.cards(), w = P.card(foe), from = P.F.rectOf(kolt), r = P.F.rectOf(foe);
  assert.equal(k.hit(foe, "fire", false, from), true);
  assert.ok(w.classList.contains("hit") && w.classList.contains("knock"), "闪一下 + 被打退");
  assert.equal(w.querySelector(":scope > .flash").style.getPropertyValue("--flash"), "var(--fire)", "闪属性色（game.css 的颜色变量）");
  const kb = FXM.knockOf(r, from, false), kx = parseFloat(w.style.getPropertyValue("--kx")), ky = parseFloat(w.style.getPropertyValue("--ky"));
  near(kx * r.scale, kb.kx, 0.1, "往哪退（屏幕像素）"); near(ky * r.scale, kb.ky, 0.1);
  assert.ok(Math.sign(kx) === Math.sign(r.x - from.x), "顺着挨打的方向（离出手的人远一点）");
  assert.equal(w.style.getPropertyValue("--kr"), kb.kr.toFixed(1) + "deg");
  // 大伤害：退得远
  k.hit(foe, "ice", true, from);
  assert.ok(Math.abs(parseFloat(w.style.getPropertyValue("--kx"))) > Math.abs(kx), "大伤害退得远");
  assert.equal(w.querySelector(":scope > .flash").style.getPropertyValue("--flash"), "var(--icee)");
  // 没有出手的人（持续伤害、余波）：只闪不退
  k.hit(foe, "acid", false, null);
  assert.ok(w.classList.contains("hit") && !w.classList.contains("knock"), "只闪不退");
  // 跳过 / 倍率 0 / 减少动态效果：不演
  w.classList.remove("hit", "knock");
  P.clock.v = 0;
  assert.equal(k.hit(foe, "fire", true, from), false);
  assert.ok(!w.classList.contains("hit") && !w.classList.contains("knock"), "跳过：不闪不退");
  const Q = setup();
  await Q.open({ still: true });
  assert.equal(Q.F.cards().hit(foe, "fire", true, Q.F.rectOf(kolt)), false, "减少动态效果：不演");
  assert.ok(!Q.card(foe).classList.contains("hit"));
});

/* ---------- 3. 击倒 ---------- */
test("3. 击倒：被打倒的敌人在 3D 战场上先留着（白卡 .dead + .ko-held，这一段演完之前不淡），演完（releaseKOs）照 game.css 的 .unit-wrap.dead 淡出、淡完才拿掉；一记重击打死的淡得慢；已经不在画面数据里的快点淡掉（.gone）。跳过 / 倍率 0 / 减少动态效果：照以前马上拿掉", async () => {
  const P = setup();
  const sc = await P.open();
  const hammer = String(P.R.unit("thug_hammer").id), knife = String(P.R.unit("thug_knife").id), guard = String(P.R.unit("guard_sword").id);
  P.F.view(P.snaps(), { animate: true });
  assert.ok(P.ids().includes(hammer));
  // game.js · setView：这一下快照里他倒下了（G.koHold：这段演出还没完）→ 先说好留着，再交快照
  assert.equal(P.F.ko(hammer, { hold: true }), true);
  P.set({ [hammer]: { dead: true } });
  P.F.view(P.snaps(), { animate: true });
  assert.ok(P.ids().includes(hammer), "倒下了还留在 3D 战场上（布局本来不画倒下的）");
  const w = P.card(hammer);
  assert.ok(w.classList.contains("dead") && w.classList.contains("ko-held"), "白卡：倒下的样子（.dead），这一段演完之前不淡（.ko-held）");
  const lay = sc.layout.units.find(x => String(x.id) === hammer);
  assert.equal(lay.card.dead, true, "白卡的快照照旧是倒下的");
  P.F.view(P.snaps(), { animate: true });   // 这一段演出的下一下：照样留着
  assert.ok(P.ids().includes(hammer) && P.card(hammer).classList.contains("ko-held"));
  assert.equal(P.timers.length, 0, "演完之前不开始淡");
  // 演完：开始淡出（.ko-held 摘掉，game.css 的 .unit-wrap.dead 自己淡），淡完拿掉
  P.F.releaseKOs();
  assert.ok(!P.card(hammer).classList.contains("ko-held"), "开始淡出");
  assert.ok(P.ids().includes(hammer), "淡完之前还在");
  assert.deepEqual(P.run(), [K.ko.fade / 1000], "淡多久照 game.css（0.5 + 1.2 秒）");
  assert.ok(!P.ids().includes(hammer) && P.card(hammer) === null, "淡完：从 3D 战场上拿掉，白卡也拿掉");
  // 不在演出里打倒的（回合结束的持续伤害……）：马上开始淡；一记重击打死的（killBig）淡得慢
  assert.equal(P.F.ko(knife, { hold: false, slow: true }), true);
  P.set({ [hammer]: { dead: true }, [knife]: { dead: true, killBig: true } });
  P.F.view(P.snaps(), { animate: true });
  assert.ok(P.ids().includes(knife) && !P.card(knife).classList.contains("ko-held") && P.card(knife).classList.contains("dead-slow"), "马上开始淡（重击：.dead-slow）");
  assert.deepEqual(P.run(), [K.ko.slow / 1000], "重击打死的淡得慢（1.4 + 2.4 秒）");
  assert.ok(!P.ids().includes(knife));
  // 已经不在画面数据里了（拿掉了 / 藏起来了）：快点淡掉（.gone），淡完拿掉；不是演出中的刷新（开新一场、撤销）直接拿掉
  P.F.ko(guard, { hold: true });
  P.set({ [hammer]: { dead: true }, [knife]: { dead: true }, [guard]: { dead: true } });
  P.F.view(P.snaps(), { animate: true });
  P.set({ [hammer]: { dead: true }, [knife]: { dead: true }, [guard]: { dead: true, hidden: true } });
  P.F.view(P.snaps(), { animate: true });
  assert.ok(P.ids().includes(guard) && P.card(guard).classList.contains("gone") && !P.card(guard).classList.contains("ko-held"), "不在了：.gone 快点淡掉");
  assert.deepEqual(P.run(), [K.ko.gone / 1000], "淡 0.45 秒");
  assert.ok(!P.ids().includes(guard));
  P.F.ko(guard, { hold: true });
  P.set({ [guard]: { dead: true } });
  P.F.view(P.snaps(), { animate: true });
  P.set({ [guard]: { dead: true, hidden: true } });
  P.F.view(P.snaps(), { animate: false });
  assert.ok(!P.ids().includes(guard), "不是演出中的刷新：直接拿掉");
  // 撤销（又站起来了）：不再留，照常画
  P.set({});
  P.F.ko(hammer, { hold: true });
  P.F.view(P.snaps(), { animate: false });
  assert.ok(P.ids().includes(hammer) && !P.card(hammer).classList.contains("ko-held") && !P.card(hammer).classList.contains("dead"), "站起来了：照常画");
  // 倒下的白卡不接鼠标（旧画面 .unit-wrap.dead 的 pointer-events，被整张卡接鼠标的那一条盖掉了，hd2d.css 补回来）；影子拿掉（场景）
  assert.match(read("hd2d/hd2d.css"), /\.hd2d-plate\.card \.unit-wrap\.dead \{ pointer-events: none;/);
  assert.match(code(read("hd2d/hd2d-scene.js")), /p\.core\.visible = p\.soft\.visible = !\(u\.card && u\.card\.dead\);/);
  // 跳过 / 倍率 0：不留，照以前马上拿掉
  P.clock.v = 0;
  P.set({});
  P.F.view(P.snaps(), { animate: false });
  assert.equal(P.F.ko(hammer, { hold: true }), false, "跳过：不留");
  P.set({ [hammer]: { dead: true } });
  P.F.view(P.snaps(), { animate: true });
  assert.ok(!P.ids().includes(hammer), "跳过：马上拿掉");
  // 留着的时候跳过了：演完直接拿掉，不淡
  P.clock.v = 1;
  P.set({});
  P.F.view(P.snaps(), { animate: false });
  P.F.ko(hammer, { hold: true });
  P.set({ [hammer]: { dead: true } });
  P.F.view(P.snaps(), { animate: true });
  P.clock.v = 0;
  P.F.releaseKOs();
  assert.ok(!P.ids().includes(hammer) && P.timers.length === 0, "跳过：演完直接拿掉");
  // 减少动态效果：不留
  P.clock.v = 1;
  const Q = setup();
  await Q.open({ still: true });
  assert.equal(Q.F.ko(hammer, { hold: true }), false, "减少动态效果：不留");
  Q.set({ [hammer]: { dead: true } });
  Q.F.view(Q.snaps(), { animate: true });
  assert.ok(!Q.ids().includes(hammer));
});

/* ---------- 4. 换区移动 ---------- */
test("4. 换区移动：演出中换了区，场景拿到滑多久（FX.card.move.secs × 演出倍率：2× 快一半、借机攻击的慢放跟着慢），铭牌的 3D 锚点在两个地台之间滑过去（hd2d-scene.js · slideTo / slideStep），镜头不动；不是演出中的刷新、跳过 / 倍率 0、减少动态效果：直接摆过去", async () => {
  const P = setup();
  const sc = await P.open();
  const kolt = P.R.unit("kolt").id;
  const z0 = sc.layout.units.find(u => u.id === kolt).zone, z1 = z0 === 1 ? 2 : 1;
  const refits = sc.refits, actors = sc.actors.length;
  P.F.view(P.snaps(), { animate: true });
  P.set({ [kolt]: { zone: z1 } });
  P.F.view(P.snaps(), { animate: true });
  assert.equal(sc.layout.units.find(u => u.id === kolt).zone, z1, "换了区");
  assert.equal(last(sc.metas).move, K.move.secs, "滑 0.75 秒（game.js · placeCard 的换区移动）");
  P.clock.v = 0.5; P.F.view(P.snaps(), { animate: true });
  assert.equal(last(sc.metas).move, K.move.secs * 0.5, "演出 2×：快一半");
  P.clock.v = 1.7; P.F.view(P.snaps(), { animate: true });
  assert.equal(last(sc.metas).move, K.move.secs * 1.7, "借机攻击的慢放（G.slow 1.7）：慢动作移动");
  P.clock.v = 1; P.F.view(P.snaps(), { animate: false });
  assert.equal(last(sc.metas).move, 0, "不是演出中的刷新（开新一场、撤销、窗口变了）：直接摆过去");
  P.clock.v = 0; P.F.view(P.snaps(), { animate: true });
  assert.equal(last(sc.metas).move, 0, "跳过：直接摆过去");
  assert.equal(sc.refits, refits, "镜头不动（不重新取景）");
  assert.equal(sc.actors.length, actors, "镜头不跟着换区（不换行动的人）");
  const Q = setup();
  const sq = await Q.open({ still: true });
  Q.F.view(Q.snaps(), { animate: true });
  assert.equal(last(sq.metas).move, 0, "减少动态效果：直接摆过去");
  // 场景（hd2d-scene.js 抠出来跑）：锚点从原来的地方滑过去，后排抬高跟着慢慢变；滑到一半又重排：去的地方没变就接着滑
  const src = read("hd2d/hd2d-scene.js");
  const st = { meta: { move: 0 }, motion: true }, clk = { t: 10 };
  const S = vm.runInContext(`(function (state, now) { ${["placeAt", "slideTo", "slideStep", "setLift"].map(n => fnSrc(src, n)).join("\n")}\n return { placeAt, slideTo, slideStep }; })`, P.ctx)(st, () => clk.t);
  const v3 = () => { const o = { x: 0, y: 0, z: 0, set(x, y, z) { o.x = x; o.y = y; o.z = z; } }; return o; };
  const p = { el: P.doc.createElement("div"), post: P.doc.createElement("div"), lift: 0, liftSet: false, liftTo: 0,
    group: { position: v3() }, core: { position: v3() }, soft: { position: v3() }, ripple: { position: v3() }, ring: { position: v3() }, pick: { position: v3() } };
  const A = { x: -4, y: 0.8, z: 1, groundY: 0.8 }, B = { x: 6, y: 2, z: -2, groundY: 2 };
  const at = (o) => [o.x, o.y, o.z].map(n => +n.toFixed(4));
  S.slideTo(p, A, true);
  assert.equal(p.slide, null, "刚建好：直接摆");
  assert.deepEqual(at(p.group.position), [-4, 0.8, 1]);
  st.meta.move = 0.75; p.liftTo = 60;
  S.slideTo(p, B, false);
  assert.ok(p.slide, "换了地方：滑过去");
  assert.deepEqual(at(p.group.position), [-4, 0.8, 1], "从原来的地方开始");
  clk.t += 0.375;
  S.slideStep(p, clk.t);
  const mid = FXM.slideAt(FXM.slide({ x: -4, y: 0.8, z: 1, g: 0.8 }, { x: 6, y: 2, z: -2, g: 2 }, 0.75, 10), 10.375);
  near(p.group.position.x, mid.x, 1e-6, "滑到一半"); near(p.core.position.y, mid.g + 0.02, 1e-6, "脚下的影子跟着走");
  assert.ok(p.lift > 0 && p.lift < 60, "后排抬高跟着慢慢变：" + p.lift);
  const s0 = p.slide;
  S.slideTo(p, B, false);
  assert.equal(p.slide, s0, "滑到一半又重排、去的地方没变：接着滑，不从头来");
  clk.t += 0.5;
  S.slideStep(p, clk.t);
  assert.equal(p.slide, null, "到了");
  assert.deepEqual(at(p.group.position), [6, 2, -2]); assert.equal(p.lift, 60);
  st.meta.move = 0; S.slideTo(p, A, false);
  assert.ok(!p.slide && p.group.position.x === -4, "0 秒：直接摆过去");
  st.meta.move = 0.75; st.motion = false; S.slideTo(p, B, false);
  assert.ok(!p.slide && p.group.position.x === 6, "减少动态效果：直接摆过去");
  st.motion = true; S.slideTo(p, A, true);
  assert.ok(!p.slide && p.group.position.x === -4, "换了棋盘：直接摆过去");
  const sc2 = code(src);
  assert.match(sc2, /slideTo\(p, u, fresh \|\| made\);/, "每次排铭牌都看要不要滑");
  assert.match(sc2, /syncPlates\(newBoard\);/, "换了棋盘不滑");
  assert.match(sc2, /slideStep\(p, tNow\);/, "每帧摆到滑到的地方");
  // 借机攻击的慢动作（game.js 的 .slow-move）：白卡压暗；跳过时不加，撤掉照样撤
  const k = P.F.cards(), w = P.card(kolt);
  P.clock.v = 1;
  assert.equal(k.slow(kolt, true), true);
  assert.ok(w.classList.contains("slow-move"));
  P.clock.v = 0;
  k.slow(kolt, false);
  assert.ok(!w.classList.contains("slow-move"), "撤掉不看跳过");
  assert.equal(k.slow(kolt, true), false, "跳过：不加");
  assert.ok(!w.classList.contains("slow-move"));
});

/* ---------- 5. 登场 ---------- */
test("5. 登场：演出中新出现的单位（召唤 / 援军 / 伙伴登场）3D 白卡亮个相（game.css 的 .enter），伙伴登场那一下也亮（刚亮过的不再来一遍）；刚打开、不是演出中的刷新不算。跳过 / 倍率 0 / 减少动态效果不演", async () => {
  const P = setup();
  await P.open();
  P.F.view(P.snaps(), { animate: true });
  assert.ok(!P.doc.querySelector(".hd2d-labels .unit-wrap.enter"), "刚打开：谁都不亮相");
  // 援军：规则里多了一个单位
  const proto = P.R.unit("thug_knife");
  const add = (id) => { const u = JSON.parse(JSON.stringify(proto)); u.id = id; u.name = "援军" + id.slice(-1); P.R.st.units.push(u); return id; };
  const r1 = add("reinf_1");
  P.F.view(P.snaps(), { animate: true });
  assert.ok(P.ids().includes(r1), "援军排进来了");
  assert.ok(P.card(r1).classList.contains("enter"), "援军亮个相");
  assert.equal(P.doc.querySelectorAll(".hd2d-labels .unit-wrap.enter").length, 1, "只有新来的亮相");
  // 不是演出中的刷新（开新一场、撤销）：不算
  const r2 = add("reinf_2");
  P.F.view(P.snaps(), { animate: false });
  assert.ok(P.ids().includes(r2) && !P.card(r2).classList.contains("enter"), "不是演出中的：不亮相");
  // 伙伴登场（game.js · playTape 的 partner）：亮相；刚亮过的不再来一遍
  const k = P.F.cards(), kolt = P.R.unit("kolt").id, w = P.card(kolt);
  assert.equal(k.enter(kolt), true);
  assert.ok(w.classList.contains("enter"));
  const t0 = w.dataset.enterAt;
  await sleep(5);
  k.enter(kolt);
  assert.equal(w.dataset.enterAt, t0, "刚亮过：不再来一遍");
  // 跳过 / 倍率 0：不演
  P.clock.v = 0;
  const r3 = add("reinf_3");
  P.F.view(P.snaps(), { animate: true });
  assert.ok(!P.card(r3).classList.contains("enter"), "跳过：不亮相");
  assert.equal(k.enter(P.R.unit("helu").id), false);
  // 减少动态效果：不演
  P.clock.v = 1;
  const Q = setup();
  await Q.open({ still: true });
  Q.F.view(Q.snaps(), { animate: true });
  const q1 = "reinf_q";
  { const u = JSON.parse(JSON.stringify(Q.R.unit("thug_knife"))); u.id = q1; Q.R.st.units.push(u); }
  Q.F.view(Q.snaps(), { animate: true });
  assert.ok(Q.ids().includes(q1) && !Q.card(q1).classList.contains("enter"), "减少动态效果：不亮相");
});

/* ---------- 6. 格挡 ---------- */
test("6. 格挡：挡下来的那张 3D 白卡一闪（game.css 的 .parry，火花 / 「格挡」字 #283 已经有了）；跳过 / 倍率 0 / 减少动态效果不演", async () => {
  const P = setup();
  await P.open();
  const helu = P.R.unit("helu").id, k = P.F.cards(), w = P.card(helu);
  assert.equal(k.parry(helu), true);
  assert.ok(w.classList.contains("parry"), "挡下来的那张一闪");
  w.classList.remove("parry");
  P.clock.v = 0;
  assert.equal(k.parry(helu), false);
  assert.ok(!w.classList.contains("parry"), "跳过：不闪");
  P.clock.v = 1;
  const Q = setup();
  await Q.open({ still: true });
  assert.equal(Q.F.cards().parry(helu), false, "减少动态效果：不闪");
  assert.ok(!Q.card(helu).classList.contains("parry"));
});

/* ---------- 7. 顿帧 / 震屏 ---------- */
test("7. 顿帧 / 震屏：3D 战场（画布 + 铭牌）就在 #g-field 里——game.js · shakeField 给 #g-app 挂 .quake / .quake-s，game.css 震的是 .g-field，画布和铭牌一起震；顿帧（.hitstop）一起变色、3D 白卡的受击跟着放慢。新画面开着时跳过、减少动态效果不震", async () => {
  const P = setup();
  const sc = await P.open();
  const G = G0(), gf = gameFns(P, G);
  const app = P.doc.getElementById("g-app"), field = P.doc.getElementById("g-field");
  const stage = P.doc.querySelector(".hd2d-field"), labels = P.doc.querySelector(".hd2d-labels");
  assert.ok(stage && field.contains(stage) && stage.contains(labels), "3D 战场那一层（铭牌在里面）在 #g-field 里");
  assert.match(code(read("hd2d/hd2d-scene.js")), /container\.appendChild\(renderer\.domElement\);[\s\S]*container\.appendChild\(labels\.domElement\);/, "画布和铭牌都在 3D 战场那一层里");
  const css = read("game.css");
  assert.match(css, /\.g-app\.quake \.g-field, \.ol-battle\.quake \.g-field \{ animation: quake/, "大震：震 .g-field（单机、联机玩家）");
  assert.match(css, /\.g-app\.quake-s \.g-field, \.ol-battle\.quake-s \.g-field \{ animation: quakeS/);
  assert.match(css, /\.g-app\.hitstop \.g-field \{ filter:/, "顿帧：.g-field 变色");
  gf.shakeField(1);
  assert.ok(app.classList.contains("quake") && field.matches(".g-app.quake .g-field") && stage.matches(".g-app.quake .g-field .hd2d-field"), "大震：3D 那一层跟着 .g-field 一起震");
  gf.shakeField(0.5);
  assert.ok(app.classList.contains("quake-s") && !app.classList.contains("quake"), "小震");
  // 顿帧：3D 白卡受击（game.js · hit 也叫新画面），在 .g-app.hitstop 里——game.css 的 .g-app.hitstop .unit-wrap.hit .unit 放慢、.g-field 变色都套得上
  app.classList.add("hitstop");
  const foe = P.R.unit("guard_sword").id, kolt = P.R.unit("kolt").id;
  gf.hit(foe, "fire", true, null, gf.old.get(kolt) ? P.F.rectOf(kolt) : null);
  const w = P.card(foe);
  assert.ok(w.matches(".g-app.hitstop .unit-wrap.hit.knock"), "顿帧中的 3D 白卡受击（放慢那一条套得上）");
  assert.match(css, /\.g-app\.hitstop \.unit-wrap\.hit \.unit \{ animation-duration: \.48s; \}/);
  assert.ok(gf.old.get(foe).wrap.classList.contains("hit"), "旧卡照旧");
  // 跳过：不震；减少动态效果（新画面开着）：不震
  app.classList.remove("quake", "quake-s", "hitstop");
  G.skip = true; gf.shakeField(1); G.skip = false;
  assert.ok(!app.classList.contains("quake"), "跳过：不震");
  sc.motion = false;
  gf.shakeField(1);
  assert.ok(!app.classList.contains("quake") && !app.classList.contains("quake-s"), "减少动态效果：新画面开着时不震");
  assert.equal(P.F.still(), true);
  sc.motion = true;
  // 高能自爆的震屏：新画面开着时也看跳过 / 减少动态效果（旧画面照旧）
  assert.match(code(fnSrc(read("game.js"), "playTape")), /if \(!noQuake3d\(\)\) \{\s*app\.classList\.remove\("quake"\); void app\.offsetWidth; app\.classList\.add\("quake"\);/);
});

/* ---------- 8. 区域预警 / 高能自爆预警 ---------- */
test("8. 区域预警：布局把投影里的 zoneView.threats 带到地台上（只带 label / from / ready），场景在地台上画一圈红框（下一回合就落地的换亮红、一明一暗，减少动态效果不闪）+ 前沿一块预警字；高能自爆预警：3D 白卡闪（.high-warn）、脚下的地台跟着闪。跳过 / 倍率 0 / 减少动态效果不闪", async () => {
  // 布局：区带上预警（和旧画面区角上的 .zthreat 同一份数据），白名单外的字段不带
  const R = battle();
  const pv = R.OV.projectState(R.st, {});
  pv.zoneView = Object.assign({}, pv.zoneView, { 2: Object.assign({}, (pv.zoneView || {})[2], { threats: [{ label: "炮击", from: "狂徒", ready: true, secret: SHP }, { label: "落石" }] }) });
  const lay = L.build(pv, { view: DESKTOP });
  assert.deepEqual(JSON.parse(JSON.stringify(lay.zones.find(z => z.id === 2).threats)), [{ label: "炮击", from: "狂徒", ready: true }, { label: "落石", from: "", ready: false }]);
  assert.deepEqual(lay.zones.find(z => z.id === 1).threats, [], "没被标定的区：没有");
  // 单机：规则里标定了一个区（app.js · zoneThreatsIn），新画面的布局里就有（数据走联机投影）
  const P = setup();
  const sc = await P.open();
  P.R.ctx.zoneThreatsIn = (z) => (Number(z) === 3 ? [{ label: "轰炸", from: "首领", ready: false }] : []);
  P.F.view(P.snaps(), { animate: false });
  assert.deepEqual(JSON.parse(JSON.stringify(sc.layout.zones.find(z => z.id === 3).threats)), [{ label: "轰炸", from: "首领", ready: false }], "单机：新画面的地台上有预警");
  // 场景（hd2d-scene.js 抠出来跑）：红框 + 预警字；ready 一明一暗；没有了就拿掉
  const src = read("hd2d/hd2d-scene.js");
  const consts = ["THREAT", "ZONE_FX", "esc"].map(k => new RegExp(`^const ${k} = .*;$`, "m").exec(src)[0]).join("\n");
  const added = [], removed = [], v3 = () => { const o = { x: 0, y: 0, z: 0, set(x, y, z) { o.x = x; o.y = y; o.z = z; } }; return o; };
  const st = { layout: null, motion: true }, clk = { t: 5 };
  const T = vm.runInContext(`(function (state, scene, CSS2DObject, frameGeo, frameMesh, outlinePts, outlineSig, now) {
    ${consts}
    const threatMarks = new Map(), zoneFlashes = [];
    ${["syncThreats", "dropThreat", "pulseThreats", "zoneFx", "dropFlash", "stepFlashes"].map(n => fnSrc(src, n)).join("\n")}
    return { syncThreats, pulseThreats, zoneFx, stepFlashes, threatMarks, zoneFlashes, THREAT, ZONE_FX };
  })`, P.ctx)(st, { add: (...o) => added.push(...o), remove: (...o) => removed.push(...o) },
    function CSS2DObject(el) { this.element = el; this.position = v3(); this.center = { set() {} }; },
    () => ({ dispose() {} }), (geo, cfg) => ({ geometry: geo, material: { opacity: cfg.opacity, color: cfg.color, dispose() {} }, userData: {}, position: v3() }),
    () => [], () => "", () => clk.t);
  const zone = (threats) => ({ id: 2, cx: 10, cz: 0, w: 7.2, d: 7.2, topY: 0.8, threats });
  st.layout = { zones: [{ id: 1, cx: 0, cz: 0, w: 7.2, d: 7.2, topY: 0.8, threats: [] }, zone([{ label: "炮击", from: "狂徒", ready: false }])] };
  T.syncThreats();
  const m = T.threatMarks.get(2);
  assert.ok(m && !T.threatMarks.has(1), "被标定的区才画");
  assert.equal(m.mesh.userData.cfg.color, T.THREAT.color, "红框（旧画面 .g-zone.threat 的 #c44747）");
  assert.equal(m.el.className.split(" ")[0], "hd2d-threat");
  assert.equal(m.el.innerHTML, '<span class="">炮击<i>狂徒</i></span>', "预警字：什么攻击、谁标的（和旧画面的 .zthreat 一样）");
  near(m.label.position.x, 10 + 7.2 * T.THREAT.side, 1e-9); near(m.label.position.z, 7.2 * T.THREAT.front, 1e-9, "立在地台前沿");
  T.pulseThreats(0.5, true);
  assert.equal(m.mesh.material.opacity, T.THREAT.opacity, "还没到落地那回合：不闪");
  const mesh0 = m.mesh;
  st.layout.zones[1] = zone([{ label: "炮击", from: "狂徒", ready: true }]);
  T.syncThreats();
  const r = T.threatMarks.get(2);
  assert.ok(removed.includes(mesh0) && r.mesh !== mesh0, "换成下一回合就落地的样子：旧的框拿掉");
  assert.equal(r.mesh.userData.cfg.color, T.THREAT.ready.color, "下一回合就落地：亮红（.threat-ready 的 #e05a4f）");
  assert.match(r.el.innerHTML, /<span class="rd">/);
  T.pulseThreats(0.5, true);
  assert.ok(r.mesh.material.opacity < r.mesh.userData.cfg.opacity, "一明一暗");
  T.pulseThreats(0.5, false);
  assert.equal(r.mesh.material.opacity, r.mesh.userData.cfg.opacity, "减少动态效果：不闪");
  st.layout.zones[1] = zone([]);
  T.syncThreats();
  assert.equal(T.threatMarks.size, 0, "预警没了：拿掉");
  assert.ok(removed.includes(r.label) && removed.includes(r.mesh));
  const scode = code(src);
  assert.match(scode, /syncTowers\(\);\s*syncThreats\(\);/, "每次排战场都画");
  assert.match(scode, /pulseThreats\(animT, moving\);/, "每帧一明一暗（减少动态效果时 moving = false）");
  // 地台闪一下（高能自爆预警）：薄荷色框闪两下，闪完拿掉；减少动态效果不闪
  assert.equal(T.zoneFx(2, "warn", { secs: 0.6 }), true);
  const f = T.zoneFlashes[0];
  assert.equal(f.mesh.material.color, T.ZONE_FX.warn.color, "旧画面卡片闪的薄荷色");
  T.stepFlashes(5.15); near(f.mesh.material.opacity, T.ZONE_FX.warn.opacity, 1e-6, "第一下亮");
  T.stepFlashes(5.3); near(f.mesh.material.opacity, 0, 1e-6, "暗");
  T.stepFlashes(5.45); near(f.mesh.material.opacity, T.ZONE_FX.warn.opacity, 1e-6, "第二下亮");
  T.stepFlashes(5.61);
  assert.equal(T.zoneFlashes.length, 0, "闪完拿掉"); assert.ok(removed.includes(f.mesh));
  st.motion = false;
  assert.equal(T.zoneFx(2, "warn", {}), false, "减少动态效果：不闪");
  assert.equal(T.zoneFlashes.length, 0);
  assert.match(scode, /stepFlashes\(tNow\);/);
  // 页面：高能自爆预警（game.js 的 .high-warn）→ 3D 白卡闪 + 场景的 zoneFx 在他那个区闪，时长跟着演出倍率；撤掉
  const hammer = P.R.unit("thug_hammer").id, hz = sc.layout.units.find(u => u.id === hammer).zone;
  P.clock.v = 0.5;
  assert.equal(P.F.warn(hammer, true), true);
  assert.ok(P.card(hammer).classList.contains("high-warn"), "白卡闪两下");
  assert.deepEqual(last(sc.flashes), { zone: hz, kind: "warn", secs: 2 * K.warn.ms / 1000 * 0.5 }, "脚下的地台跟着闪");
  P.F.warn(hammer, false);
  assert.ok(!P.card(hammer).classList.contains("high-warn"), "撤掉");
  P.clock.v = 0;
  const n = sc.flashes.length;
  assert.equal(P.F.warn(hammer, true), false, "跳过：不闪");
  assert.ok(!P.card(hammer).classList.contains("high-warn") && sc.flashes.length === n);
  P.clock.v = 1;
  const Q = setup();
  const sq = await Q.open({ still: true });
  assert.equal(Q.F.warn(hammer, true), false, "减少动态效果：不闪");
  assert.equal(sq.flashes.length, 0);
});

/* ---------- game.js 的接线 ---------- */
test("game.js：旧卡的每一处动画旁边都叫新画面（dashTo / lunge / recoil / nudgeCard / flashClass / hit 跑起来 3D 白卡跟着动；setView 的击倒 / animate、releaseKOs、借机攻击的 slow-move、格挡、伙伴登场、高能自爆预警查源码）；新画面关着时只有旧卡动", async () => {
  const P = setup();
  await P.open();
  const G = G0(), gf = gameFns(P, G);
  const kolt = P.R.unit("kolt").id, foe = P.R.unit("guard_sword").id, w = P.card(kolt), wf = P.card(foe);
  P.clock.v = 0.2;
  await gf.dashTo(kolt, P.F.rectOf(foe), {});
  assert.ok(tr(w) && w.classList.contains("lunge"), "dashTo：3D 白卡冲过去");
  await sleep(150);
  await gf.lunge(kolt, foe);
  assert.ok(w.classList.contains("lunge") || tr(w), "lunge：3D 白卡冲一下");
  await sleep(150);
  gf.recoil(gf.old.get(kolt), P.F.rectOf(kolt), P.F.rectOf(foe), 5);
  assert.ok(tr(w), "recoil：3D 白卡后坐");
  await sleep(150);
  gf.nudgeCard(kolt, 0, -16, 240);
  assert.ok(tr(w), "nudgeCard：3D 白卡挪一下");
  gf.flashClass(foe, "fx-knockfly", 700);
  assert.ok(wf.classList.contains("fx-knockfly"), "flashClass：3D 白卡挂同一个样式");
  gf.hit(foe, "electric", false, null, P.F.rectOf(kolt));
  assert.ok(wf.classList.contains("hit") && wf.classList.contains("knock"), "hit：3D 白卡闪 + 被打退");
  assert.ok(gf.old.get(foe).wrap.classList.contains("hit"), "旧卡照旧");
  // releaseKOs：3D 战场上留着的也开始淡出
  const hammer = String(P.R.unit("thug_hammer").id);
  P.F.ko(hammer, { hold: true });
  P.set({ [hammer]: { dead: true } });
  P.F.view(P.snaps(), { animate: true });
  gf.releaseKOs();
  assert.ok(!P.card(hammer).classList.contains("ko-held") && P.timers.length === 1, "releaseKOs：3D 战场上留着的开始淡出");
  // 源码：setView、playTape 里的接线
  const g = code(read("game.js")), setView = code(fnSrc(read("game.js"), "setView")), play = code(fnSrc(read("game.js"), "playTape"));
  assert.match(setView, /if \(!s\.isPlayer && field3d\(\) && typeof HD2DField\.ko === "function"\) HD2DField\.ko\(id, \{ hold: !!G\.koHold, slow: !!s\.killBig \}\);/, "被打倒：3D 战场上先留着");
  assert.match(setView, /if \(window\.HD2DField\) HD2DField\.view\(snaps, \{ animate: !!animate \}\);/, "换区移动 / 登场跟着 animate");
  assert.match(play, /if \(k3\) k3\.slow\(o\.targetId, true\);[\s\S]*if \(k3\) k3\.slow\(o\.targetId, false\);/, "借机攻击：3D 白卡慢动作");
  assert.match(play, /if \(k3\) k3\.parry\(blockerId \|\| meta\.targetId\);/, "格挡");
  assert.match(play, /if \(k3\) k3\.enter\(e\.unitId\);/, "伙伴登场");
  assert.match(play, /if \(warn3d\) HD2DField\.warn\(e\.unitId, true\);[\s\S]*if \(warn3d\) HD2DField\.warn\(e\.unitId, false\);/, "高能自爆预警");
  assert.match(g, /if \(blockerId\) motions\.push\(lunge\(blockerId, meta\.actorId\)\);/, "协助格挡冲上去挡（lunge 里也叫新画面）");
  // 新画面关着：3D 白卡没有、cards3d 是 null，只有旧卡动
  P.F.switchTo("old");
  assert.equal(P.F.on(), false);
  assert.equal(P.F.cards(), null, "关着：没有 3D 的卡片动画");
  gf.hit(kolt, "fire", false, null, null);
  assert.ok(gf.old.get(kolt).wrap.classList.contains("hit"), "关着：旧卡照旧受击");
});

/* ---------- 联机玩家 ---------- */
test("联机玩家（hd2d-play.js 播收到的包）：近身冲过去、受击闪 + 击退、被打倒的留到这一段演完再淡出、协助格挡冲上去挡 + 火花在两人中间 + 挡下来的一闪、伙伴登场亮相、高能自爆预警（白卡 + 地台）再震屏；换区滑过去、新出现的亮相跟着 view({ animate })。只用收到的包、没有坚毅生命；跳过 / 倍率 0 时都不演", async () => {
  const P = setup();
  await P.open();
  // 联机玩家的战斗画面（online-battle.js 的 .ol-battle）：新画面挂过去（hd2d-field.js · attach，和 online-ui.js 的 hd2dSpec 同样的几样）
  const ol = P.doc.createElement("div"); ol.className = "ol-battle"; P.doc.body.appendChild(ol);
  const olField = P.doc.createElement("main"); olField.className = "g-field ol-field"; ol.appendChild(olField);
  let pvNow = P.pv();
  const spec = {
    field: () => olField, app: () => ol, view: () => P.F.packetView(pvNow, { OB: P.OB, OV: P.R.OV }),
    input: { unit() {}, hover() {}, zone() {}, zoneHover() {} }, clock: () => P.clock.v, refresh() {}, hint() {}, slot: () => null
  };
  const h = P.F.attach(spec);
  await settle();
  assert.ok(h && h.on(), "联机玩家的新画面建好了");
  const sc = P.scene();
  const kolt = P.R.unit("kolt").id, helu = P.R.unit("helu").id, ruby = P.R.unit("ruby").id;
  const hammer = P.R.unit("thug_hammer").id, guard = P.R.unit("guard_sword").id, knife = P.R.unit("thug_knife").id;
  const copy = (v) => JSON.parse(JSON.stringify(v));
  const dead = (pv, id) => { const o = copy(pv); o.units.find(u => u.id === id).dead = true; return o; };
  // 1) 柯尔特近身砍倒狂徒（锤）：冲过去，第一下打中时画面换成包里的 state——被打倒的先留着（.ko-held），演完再淡出
  const before = pvNow, after = dead(before, hammer);
  const pk = { fx: { actor: kolt, target: hammer, move: { kind: "slash", el: "physical", melee: true } }, tape: [{ type: "pop", unitId: hammer, kind: "dmg", value: 9, element: "fire", main: true }], state: after };
  const a = P.F.rectOf(kolt), t = P.F.rectOf(hammer);
  let seen = null;
  await h.play(pk, { before, onImpact: () => {
    seen = { dash: tr(P.card(kolt)), lunge: P.card(kolt).classList.contains("lunge") };
    pvNow = after; h.view({ animate: true });
    seen.kept = P.ids().includes(String(hammer)); seen.held = P.card(hammer) && P.card(hammer).classList.contains("ko-held");
  } });
  assert.ok(seen && seen.lunge && seen.dash, "近身：卡片冲过去（game.js · dashTo 那一套）");
  assert.ok(Math.sign(seen.dash.x) === Math.sign(t.x - a.x), "朝目标那张卡");
  assert.ok(seen.kept && seen.held, "被打倒的先留着（这一段演完之前不淡）");
  const wh = P.card(hammer);
  assert.ok(wh && wh.classList.contains("hit") && wh.classList.contains("knock"), "受击：闪 + 被打退");
  assert.ok(!wh.classList.contains("ko-held") && wh.classList.contains("dead"), "演完：开始淡出");
  assert.deepEqual(P.run(), [K.ko.fade / 1000]);
  assert.ok(!P.ids().includes(String(hammer)), "淡完拿掉");
  await sleep(450);   // 冲过去的回位走完
  // 2) 刀狂徒砍柯尔特，赫露协助格挡：赫露冲上去挡，火花在两人中间，赫露那张一闪
  const pk2 = { fx: { actor: knife, target: kolt, move: { kind: "slash", el: "physical", melee: true }, parried: true, blocker: helu }, tape: [{ type: "pop", unitId: kolt, kind: "dmg", value: 2, element: "physical", main: true }], state: pvNow };
  const done2 = h.play(pk2, { before: pvNow, onImpact() {} });
  await sleep(40);
  const bl = tr(P.card(helu)), rk = P.F.rectOf(knife), rh = P.F.rectOf(helu);
  assert.ok(P.card(helu).classList.contains("lunge") && bl, "协助格挡的人冲上去挡（game.js · playTape 的 lunge(blockerId, actorId)）");
  assert.ok(Math.sign(bl.x) === Math.sign(rk.x - rh.x), "朝出手的人冲");
  await done2;
  assert.equal(P.log.sparks.length, 1, "火花在两人连线的中点");
  const ra = P.F.rectOf(knife), rb = P.F.rectOf(helu);
  near(P.log.sparks[0].x, (ra.x + rb.x) / 2, 0.5); near(P.log.sparks[0].y, (ra.y + rb.y) / 2, 0.5);
  assert.ok(P.card(helu).classList.contains("parry"), "挡下来的那张一闪");
  // 3) 伙伴登场 + 高能自爆：伙伴亮相；自爆前白卡闪、脚下的地台闪，再震屏、受击
  const gz = sc.layout.units.find(u => u.id === guard).zone;
  const pk3 = { tape: [{ type: "pop", unitId: ruby, kind: "partner", text: "支援！" }, { type: "pop", unitId: guard, kind: "highboom", value: 6 }], state: pvNow };
  await h.play(pk3, { before: pvNow, onImpact() {} });
  assert.ok(P.card(ruby).classList.contains("enter"), "伙伴登场亮相");
  assert.ok(sc.flashes.some(f => f.zone === gz && f.kind === "warn"), "高能自爆预警：脚下的地台闪");
  assert.ok(!P.card(guard).classList.contains("high-warn"), "预警闪完撤掉");
  assert.ok(P.card(guard).classList.contains("hit"), "炸的那一下受击");
  assert.ok(ol.classList.contains("quake"), "震屏（.ol-battle.quake：3D 战场在 .g-field 里一起震）");
  P.run();
  assert.ok(!ol.classList.contains("quake"), "震完摘掉");
  // 4) 换区、新出现的：跟着 view({ animate })
  const moved = copy(pvNow);
  const ku = moved.units.find(u => u.id === kolt);
  ku.zone = ku.zone === 1 ? 2 : 1;
  pvNow = moved; h.view({ animate: true });
  assert.equal(last(sc.metas).move, K.move.secs, "播包时换区：滑过去");
  h.view();
  assert.equal(last(sc.metas).move, 0, "不是播包时：直接摆过去");
  const more = copy(pvNow), nu = copy(more.units.find(u => u.id === knife));
  nu.id = "reinf_ol"; more.units.push(nu);
  pvNow = more; h.view({ animate: true });
  assert.ok(P.card("reinf_ol") && P.card("reinf_ol").classList.contains("enter"), "播包时新出现的：亮相");
  // 只用收到的包：新加的 DOM 里没有坚毅生命
  noShp(MD.serialize(olField), "联机玩家的新画面");
  // 跳过 / 倍率 0：都不演
  P.clock.v = 0;
  const wk = P.card(kolt);
  wk.classList.remove("lunge", "hit", "knock"); P.card(knife).classList.remove("hit", "knock");
  const pk4 = { fx: { actor: kolt, target: knife, move: { kind: "slash", el: "physical", melee: true } }, tape: [{ type: "pop", unitId: knife, kind: "dmg", value: 9, element: "fire", main: true }, { type: "pop", unitId: knife, kind: "highboom", value: 5 }], state: dead(pvNow, knife) };
  ol.classList.remove("quake");
  await h.play(pk4, { before: pvNow, onImpact: () => { pvNow = pk4.state; h.view({ animate: true }); } });
  assert.ok(!wk.classList.contains("lunge") && !tr(wk), "跳过：不冲");
  assert.ok(!P.ids().includes(String(knife)), "跳过：被打倒的马上拿掉");
  assert.ok(!ol.classList.contains("quake"), "跳过：不震");
});
