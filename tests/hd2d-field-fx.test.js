// 新画面接入（二）（#283）：正式战斗画面（game.html）的新画面开着时——
//   · 伤害 / 击破 / 治疗 / 格挡 / 状态字换成原型的纸片风数字（hd2d-fx.js 的 FX：字号、摆位、颜色），打中那一下的纸片感、出手时推一下镜头，
//     都跟着正式游戏的「演出 1× / 2×」和跳过走（G.fxClock），减少动态效果时不推镜头；关着时还是旧的 .pop，一点不变；
//   · 首领机制在 3D 战场上都有：铭牌上方的图标和倒计时、地台上的踩塔、战场上方的横幅和援军倒计时（压在 3D 层上面）、悬停说明，
//     内容和旧画面一致（unit-card.js 同一套）；数据走联机投影（OnlineView），不新读房主的原始 state；
//   · 新加的 DOM 里没有坚毅生命的数字（打在坚毅生命上、濒死的那几下不给数）。
// 都在 Node 里跑：hd2d-field.js / hd2d-play.js 放进原型页的假网页（tests/hd2d-fake-page.js）里真的跑，3D 场景换成假的；
// game.js 的弹字（popup / paperPop）、场景的铭牌 HTML（plateHtml）从源码里抠出来跑，接线查源码。WebGL 画面由仓库主人看。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const HP = require("./hd2d-paths");

const read = (f) => fs.readFileSync(path.join(HP.ROOT, f), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");   // 去掉注释，只看代码
const PARTY = ["kolt", "helu", "ruby", "yuito"];
const DESKTOP = { width: 1100, height: 620, top: 40, bottom: 40 };   // 正式画面里战场那一格（上面让开首领横幅，下面让开镜头按钮）
const STAGE = { left: 100, top: 50 };                                   // 战场那一格在视口里的位置
const SHP = 7771, SHP_MAX = 7772;
const unent = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** 从源码里抠出一个函数（按大括号配对；这几个函数的字符串里没有大括号） */
function fnSrc(src, name) {
  const at = src.indexOf("function " + name + "(");
  assert.ok(at >= 0, "找不到 " + name);
  let i = src.indexOf("{", at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(at, i + 1);
}

/** 假的 3D 场景：记下 hd2d-field.js 交给它的东西；镜头 = 布局的默认镜头（远景），推 / 拉镜头记下来 */
function fakeScene(log) {
  return (stage, options) => {
    log.stage = stage; log.options = options;
    const C = log.ctx.HD2DCamera;
    const sc = {
      portrait: false, motion: true, tier: "far", zone: null, flash: 0, layout: null,
      view: () => DESKTOP,
      setInsets: () => {}, refit: () => {}, setMarks: () => {}, setActor: () => {}, setWind: () => {}, setTier: () => {}, stepZone: () => {},
      setBattle: (layout) => { log.layouts.push(layout); sc.layout = layout; },
      lensNow: () => ({ pos: sc.layout.camera.pos, target: sc.layout.camera.target, fov: sc.layout.camera.fov, width: DESKTOP.width, height: DESKTOP.height }),
      plateOf: (id) => { const u = sc.layout.units.find(x => x.id === id); return u ? { x: u.x, y: u.y, z: u.z, lift: u.lift, big: false, zoom: 1 } : null; },
      zoneOf: (id) => sc.layout.zones.find(z => z.id === Number(id)) || null,
      poseNow: () => Object.assign(C.pose(sc.layout, "far", null, {}), { tier: "far" }),
      posePush: (p, secs) => log.pushes.push(secs),
      poseRelease: (secs) => log.releases.push(secs),
      dispose: () => { log.disposed = true; }
    };
    return sc;
  };
}

/**
 * 原型页的假网页（规则、online-view、attack-fx、hd2d-layout / camera / fx / play / ui 都加载好了），再放进 unit-card.js 和正式画面的 hd2d-field.js，
 * 摆一场三区的战斗（每个人的坚毅生命都塞特殊的数），页面上建 #g-app / #g-field / 开关；opts.boss = 再挂一个带四种机制的首领
 */
function fieldPage(opts) {
  opts = opts || {};
  const page = require("./hd2d-fake-page").load();
  assert.deepEqual(page.errors, []);
  const ctx = page.ctx, doc = page.document;
  // 3D 战场那一层量得到大小、在视口里的位置（假网页的元素默认都是 0）
  const proto = ctx.HTMLElement.prototype, rect0 = proto.getBoundingClientRect;
  Object.defineProperty(proto, "clientWidth", { configurable: true, get() { return this.classList.contains("hd2d-field") ? DESKTOP.width : 0; } });
  proto.getBoundingClientRect = function () {
    return this.classList.contains("hd2d-field") ? { left: STAGE.left, top: STAGE.top, width: DESKTOP.width, height: DESKTOP.height, right: STAGE.left + DESKTOP.width, bottom: STAGE.top + DESKTOP.height } : rect0.call(this);
  };
  ["unit-card.js", "hd2d/hd2d-field.js"].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  ctx.HD2DWfx = { windOf: () => ({ x: 1, z: 0 }), create: () => ({ sync() {}, dispose() {} }) };   // 天气的 2D 层要真的网页
  const st = ctx.BattleSim.setup({
    party: PARTY, zoneMode: 3, seed: "hd2d-field-fx", region: "第一采矿场", light: "dusk",
    enemies: [{ id: "guard_sword", lv: 2, zone: 3 }, { id: "thug_hammer", lv: 2, zone: 2 }].concat(opts.boss ? [{ id: "thug_knife", lv: 5, zone: 2 }] : [])
  });
  st.units.forEach(u => { u.shp = SHP; u.shpMax = SHP_MAX; u.baseShp = SHP; });
  let boss = null;
  if (opts.boss) {
    boss = st.units.find(u => u.kit === "thug_knife");
    boss.layers.forEach(l => { l.current = l.max = 999; });
    [{ type: "execution", turns: 3, hits: [{ flat: 1 }] }, { type: "share", turns: 2, pool: { flat: 2 } }, { type: "tower", turns: 2, soak: { flat: 1 }, fail: { kind: "raid", flat: 1 } }, { type: "spread", turns: 4, blast: { flat: 1 } }]
      .forEach(m => ctx.addBossMechanic(boss, m));
    ctx.startCombat();
  }
  const app = doc.createElement("div"); app.id = "g-app"; doc.body.appendChild(app);
  const field = doc.createElement("main"); field.id = "g-field"; app.appendChild(field);
  const btn = doc.createElement("button"); btn.id = "g-hd2d-toggle"; doc.body.appendChild(btn);
  const canvas = doc.createElement("canvas"); canvas.className = "atkfx"; doc.body.appendChild(canvas);   // attack-fx 的画布（纸片感压扁它）
  const qs = doc.querySelector;
  doc.querySelector = (sel) => (sel === "canvas.atkfx" ? canvas : qs.call(doc, sel));
  const clock = { v: 1 };
  ctx.GAME = { depth: 0, fxClock: () => clock.v, snapAll: () => st.units.map(snapOf), refresh() {}, fieldInput: { unit() {}, hover() {}, zone() {}, zoneHover() {} } };
  const log = { ctx, layouts: [], pushes: [], releases: [] };
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); } };
  /** 打开新画面（记着开 → boot 就建好），reduced = 减少动态效果（这里只用来让转场直接切） */
  const open = async () => {
    mem.set(ctx.HD2DField.FIELD.storageKey, "on");
    ctx.HD2DField.boot({ doc, storage, load: () => Promise.resolve(fakeScene(log)), hint: () => {}, reduced: () => true });
    for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
    assert.equal(ctx.HD2DField.on(), true, "新画面建好了");
  };
  const numbers = () => doc.body.childNodes.filter(n => n.id === "hd2d-pop").flatMap(n => n.childNodes);
  return { page, ctx, doc, st, boss, app, field, canvas, clock, log, open, numbers };
}
/** 演出途中某一下的画面快照（照 game.js · snapUnit 的样子：带着坚毅生命——game.js 的快照里本来就有） */
function snapOf(u) {
  return {
    id: u.id, name: u.name, level: u.level || 1, isPlayer: !!u.isPlayer, kit: u.kit, zone: Number(u.zone) || 1,
    hidden: !!u.hidden, dead: !!u.dead, dying: !!u.dying, upOnShp: !!u.upOnShp, stunned: !!u.stunned, flying: !!u.flying, submerged: !!u.submerged,
    def: u.def || 0, defMax: u.defMax || 0, ap: u.ap || 0, apMax: u.apMax || 0, bonus: u.bonus || 0, bonusMax: u.bonusMax || 0,
    layers: u.layers.map(l => ({ type: l.type, cur: l.current, max: l.max })), shp: SHP, shpMax: SHP_MAX
  };
}
/** game.js 的弹字（popup）和新画面的纸片风数字（paperPop）抠出来，放进假网页里跑；旁边的小工具给假的 */
function gamePops(P) {
  const g = read("game.js");
  const fxLayer = P.doc.createElement("div"); fxLayer.id = "g-fx"; P.doc.body.appendChild(fxLayer);
  const G = { view: new Map(), sim: false };
  const make = vm.runInContext(`(function (G, centerOf, popCount, realTimeout, el, fx) {
    const field3d = () => !!(window.HD2DField && HD2DField.on());
    ${fnSrc(g, "popup")}
    ${fnSrc(g, "paperPop")}
    return { popup, paperPop };
  })`, P.ctx, { filename: "game.js（popup / paperPop）" });
  const el = (tag, cls) => { const e = P.doc.createElement(tag); if (cls) e.className = cls; e.style.setProperty = (k, v) => { e.style[k] = v; }; return e; };
  const f = make(G, () => ({ x: 500, y: 300, r: { left: 440, top: 283, width: 120, height: 40 } }), new Map(), () => 0, el, () => fxLayer);
  /** 照 game.js 的写法弹一下伤害：新画面开着 → 纸片风；关着 → 旧的 .pop */
  f.hit = (u, value, element) => {
    const s = snapOf(u);
    G.view.set(u.id, s);
    const e = { type: "pop", unitId: u.id, kind: "dmg", value, element: element || "physical", main: true, snap: P.st.units.map(x => (x === u ? s : snapOf(x))) };
    if (!f.paperPop(u.id, e)) f.popup(u.id, String(value), "e-" + e.element, { icon: e.element, size: 30, dur: 1.05 });
  };
  f.G = G; f.fxLayer = fxLayer;
  return f;
}

/* ---------- 1. 数字：开着走纸片风，关着照旧 ---------- */
test("新画面开着：伤害 / 击破 / 治疗 / 格挡 / 状态字都弹成纸片风数字（hd2d-play.js 的 .hd2d-num，字号 / 颜色 / 摆位照 hd2d-fx.js 的 FX），不弹旧的 .pop；关着时还是旧的 .pop，纸片风一个都没有", async () => {
  const P = fieldPage(), F = P.ctx.HD2DField, FX = P.ctx.HD2DFx.FX;
  const pops = gamePops(P);
  const foe = P.st.units.find(u => u.kit === "thug_hammer"), kolt = P.st.units.find(u => u.kit === "kolt");
  // 关着：旧的 .pop（和以前一模一样），纸片风的数字一个都没有
  pops.hit(foe, 5, "fire");
  assert.equal(pops.fxLayer.childNodes.length, 1, "关着：弹旧的 .pop");
  assert.ok(pops.fxLayer.childNodes[0].className.split(" ").includes("pop"));
  assert.equal(P.numbers().length, 0, "关着：没有纸片风数字");
  assert.equal(F.numbers([{ unitId: foe.id, kind: "dmg", text: "1", el: "fire" }]).length, 0, "关着：新画面不弹");
  // 开着：纸片风
  await P.open();
  pops.fxLayer.childNodes.length = 0;
  pops.hit(foe, 5, "fire");
  assert.equal(pops.fxLayer.childNodes.length, 0, "开着：不弹旧的 .pop");
  const nums = P.numbers();
  assert.equal(nums.length, 1, "开着：一个纸片风数字");
  const n = nums[0], css = n.style.cssText;
  assert.equal(n.className, "hd2d-num k-dmg");
  assert.equal(n.textContent, "5");
  assert.ok(css.includes("--c:" + FX.num.colors.fire + ";"), "伤害按属性上色（和原型一样）");
  // 字号 = 基准 × 铭牌在屏幕上的宽（夹在范围里），位置在铭牌头顶，都在战场那一格里（视口坐标）
  const r = F.rectOf(foe.id), size = Number(/font-size:([\d.]+)px/.exec(css)[1]), left = Number(/left:([\d.]+)px/.exec(css)[1]), top = Number(/top:([\d.]+)px/.exec(css)[1]);
  const k = Math.max(FX.num.scale.min, Math.min(FX.num.scale.max, r.w / P.ctx.HD2DLayout.CONFIG.plate.w));
  assert.ok(Math.abs(size - FX.num.size.dmg * k) < 0.06, `字号 ${size} = ${FX.num.size.dmg} × ${k.toFixed(3)}`);
  assert.ok(Math.abs(left - r.x) < 0.06 && top < r.top, "摆在铭牌头顶正中");
  assert.ok(left > STAGE.left && left < STAGE.left + DESKTOP.width && top > STAGE.top + DESKTOP.top, "在战场那一格里、不顶进上沿的首领横幅");
  // 第二个数字（还没消失）：两个不压住；大伤害（规则的 bigHitInfo：等级 × 2 + 8 起）加 !! 放大
  pops.hit(foe, 12, "physical");
  const two = P.numbers();
  assert.equal(two.length, 2);
  const box = (e) => { const s = Number(/font-size:([\d.]+)px/.exec(e.style.cssText)[1]); return { x: Number(/left:([\d.]+)px/.exec(e.style.cssText)[1]), y: Number(/top:([\d.]+)px/.exec(e.style.cssText)[1]), s }; };
  const [a, b] = two.map(box);
  assert.deepEqual([two[1].className, two[1].textContent], ["hd2d-num k-big", "12!!"], "大伤害");
  assert.ok(Math.abs(a.y - b.y) > Math.min(a.s, b.s) * 0.9 || Math.abs(a.x - b.x) > Math.min(a.s, b.s), "新弹的让开还没消失的");
  // 击破、治疗、格挡、状态字（「无效」算格挡）、高能自爆：各是原型的那一种
  const G = pops.G;
  G.view.set(kolt.id, snapOf(kolt));
  const ev = (kind, extra) => Object.assign({ type: "pop", unitId: foe.id, kind, element: "ice", snap: [snapOf(foe)] }, extra);
  pops.paperPop(foe.id, ev("break", { value: 2 }));
  pops.paperPop(kolt.id, { type: "pop", kind: "heal", unitId: kolt.id, value: 5, element: "physical", snap: [snapOf(kolt)] });
  pops.paperPop(foe.id, null, P.ctx.HD2DFx.parryOf(foe.id));
  pops.paperPop(foe.id, ev("status", { text: "无效" }));
  pops.paperPop(foe.id, ev("fxword", { text: "冻伤" }));
  pops.paperPop(foe.id, ev("highboom", { value: 6, text: "9" }));
  const all = P.numbers().slice(2).map(e => [e.className, e.textContent]);
  assert.deepEqual(all, [["hd2d-num k-brk", "击破2"], ["hd2d-num k-heal", "+5"], ["hd2d-num k-block", "格挡"], ["hd2d-num k-block", "无效"], ["hd2d-num k-word", "冻伤"], ["hd2d-num k-big", "高能自爆"]]);
  assert.equal(pops.fxLayer.childNodes.length, 0, "开着：旧的 .pop 一个都没弹");
  // 关回旧画面：数字拿掉，又是旧的 .pop
  F.switchTo("old");
  assert.equal(F.on(), false);
  assert.equal(P.numbers().length, 0, "关掉：纸片风数字拿掉");
  pops.hit(foe, 3, "fire");
  assert.equal(pops.fxLayer.childNodes.length, 1, "关回去：照旧弹 .pop");
  assert.deepEqual(P.page.errors, []);
});

test("game.js：每一处弹字都先问 paperPop（开着走纸片风、关着返回 false 照旧弹）；攻击效果大字、高能自爆、格挡、打中那一下、出手前、演完都接上了新画面；旧画面的写法一点没变", () => {
  const g = read("game.js"), src = code(g);
  // popup 只在 paperPop 关着时才弹：每一处调用要么同一行先问 paperPop，要么在「if (!paperPop(...)) {」那一块里
  const lines = src.split("\n");
  const calls = lines.map((t, i) => [t, i]).filter(([t]) => /\bpopup\(/.test(t) && !/function popup\(/.test(t));
  assert.ok(calls.length >= 7, "弹字的地方：伤害、击破、治疗、状态字、登场支援、红弹 / 蓝弹、高能自爆");
  calls.forEach(([t, i]) => assert.ok(/!paperPop\(/.test(t) || /if \(!paperPop\([^)]*\)\) \{\s*$/.test(lines[i - 2] || "") || /if \(!paperPop\([^)]*\)\) \{\s*$/.test(lines[i - 1] || ""), "这一处没先问 paperPop：" + t.trim()));
  assert.match(src, /if \(!paperPop\(e\.unitId, e\)\) fxWord\(/, "攻击效果大字");
  assert.match(fnSrc(g, "paperPop"), /if \(!field3d\(\) \|\| typeof HD2DField\.numbers !== "function" \|\| !window\.HD2DFx\) return false;/, "关着：返回 false，照旧弹");
  assert.match(fnSrc(g, "paperPop"), /OnlineView\.projectTape\(\[one\], \{ state \}\)/, "先过联机演出带的白名单");
  assert.match(fnSrc(g, "paperPop"), /HD2DFx\.numberOf\(p,/, "按 hd2d-fx.js · numberOf 挑数字（和原型同一份）");
  // 演出倍率 / 跳过：同一个钟交给 attack-fx 和新画面
  assert.match(src, /G\.fxClock = \(\) => \(G\.skip \|\| G\.instant \? 0 : \(G\.fast \? 0\.5 : 1\) \* \(G\.slow \|\| 1\)\);\s*if \(window\.AttackFx\) AttackFx\.setClock\(G\.fxClock\);/);
  // 打中那一下的纸片感、出手前推镜头、演完拉回、红叉前画布复原
  assert.match(fnSrc(g, "strikeImpact"), /if \(!window\.AttackFx \|\| G\.sim \|\| G\.skip\) return;\s*if \(field3d\(\)\) HD2DField\.paper\(e\.unitId\);/);
  const play = fnSrc(g, "playTape");
  assert.match(play, /const pushMs = strike && field3d\(\) && !G\.sim \? HD2DField\.push\(strike\.actorId, strike\.targetId\) : 0;\s*if \(pushMs\) \{ await wait\(pushMs\); strikeFrom = rectOf\(strike\.actorId\); \}\s*const motions = \[\];\s*if \(strike\) motions\.push\(strikeIn\(strike\)\);/, "推到位再出手");
  assert.match(play, /finally \{[\s\S]*if \(pushMs && window\.HD2DField\) HD2DField\.release\(\);/, "演完拉回（跳过也拉回）");
  assert.match(play, /if \(window\.HD2DFx\) paperPop\(blockerId \|\| meta\.targetId, null, HD2DFx\.parryOf\(blockerId \|\| meta\.targetId\)\);/, "格挡");
  assert.match(fnSrc(g, "playBeats"), /if \(field3d\(\)\) HD2DField\.unpaper\(\);/, "红叉不画在压扁的画布上");
  // 旧画面：高能自爆的盖章、大号数字照旧（只是包在「新画面没接」的分支里）
  assert.match(play, /if \(!paperPop\(e\.unitId, e\)\) \{\s*stamp\(e\.unitId, "高能自爆", "boom"\);\s*popup\(e\.unitId, \(Math\.floor\(Number\(e\.value\) \|\| 0\)\) \+ "!", "e-energy big boom", \{ icon: "energy", size: BIG_POP_SIZE \+ 12, dur: 2\.8 \}\);\s*\}/);
  // 新画面加载 hd2d-play.js（开了才加载，和原型页同一份）
  const F = require("../hd2d/hd2d-field.js");
  const s = F.FIELD.scripts;
  assert.ok(s.indexOf("hd2d-fx.js") >= 0 && s.indexOf("hd2d-play.js") === s.indexOf("hd2d-fx.js") + 1, "hd2d-play.js 紧跟在 hd2d-fx.js 后面加载");
  assert.ok(!/hd2d-play\.js/.test(read("game.html")), "game.html 不预先加载（开了才载）");
});

/* ---------- 2. 演出倍率、跳过、减少动态效果 ---------- */
test("演出倍率和跳过对新数字也有效：「演出 2×」数字停留减半；跳过时不弹（也不弹旧的）；推镜头、拉回的快慢跟着倍率，跳过 / 减少动态效果时不推；纸片感按俯角压扁、影子挂在 3D 战场那一层里", async () => {
  const P = fieldPage(), F = P.ctx.HD2DField, FX = P.ctx.HD2DFx.FX, PL = P.ctx.HD2DPlay;
  const pops = gamePops(P);
  await P.open();
  const foe = P.st.units.find(u => u.kit === "thug_hammer"), kolt = P.st.units.find(u => u.kit === "kolt");
  const life = (n) => Number(/--life:([\d.]+)ms/.exec(n.style.cssText)[1]);
  const full = FX.num.dur.pop + FX.num.dur.hold + FX.num.dur.out;
  // 1×
  P.clock.v = 1;
  assert.equal(PL.clock, 1, "新画面的钟就是 game.js 的 G.fxClock");
  pops.hit(foe, 12, "fire");
  assert.equal(life(P.numbers().pop()), full, "1×：照 FX.num.dur");
  // 2×（倍率 0.5）
  P.clock.v = 0.5;
  pops.hit(foe, 8, "fire");
  assert.equal(life(P.numbers().pop()), full * 0.5, "2×：停留减半");
  // 跳过（倍率 0）：纸片风不弹，旧的 .pop 也不弹
  P.clock.v = 0;
  const before = P.numbers().length;
  pops.hit(foe, 99, "fire");
  assert.equal(P.numbers().length, before, "跳过：不弹");
  assert.equal(pops.fxLayer.childNodes.length, 0, "跳过：旧的 .pop 也不弹");
  assert.equal(F.push(kolt.id, foe.id), 0, "跳过：不推镜头");
  assert.equal(F.paper(foe.id), false, "跳过：不压扁");
  // 推镜头：远景推得动，推过去要 FX.push.in 秒（× 倍率），game.js 等这么多毫秒再出手；拉回 FX.push.out 秒（× 倍率）
  P.clock.v = 0.5;
  const ms = F.push(kolt.id, foe.id);
  assert.equal(ms, FX.push.in * 1000, "推了：等 FX.push.in 秒再出手（game.js 的 wait 自己乘倍率）");
  assert.deepEqual(P.log.pushes, [FX.push.in * 0.5], "推过去的快慢跟着倍率");
  F.release();
  assert.deepEqual(P.log.releases, [FX.push.out * 0.5], "拉回的快慢跟着倍率");
  F.release();
  assert.equal(P.log.releases.length, 1, "没推过就不拉");
  P.clock.v = 1;
  // 纸片感：attack-fx 的画布按俯角压扁（以打中的那一点为中心），影子挂在 3D 战场那一层里（压在 3D 画面上、铭牌下面）
  assert.equal(F.paper(foe.id), true);
  assert.match(P.canvas.style.transform, /^scaleY\(0\.\d+\)$/, "画布压扁");
  const sq = Number(/scaleY\(([\d.]+)\)/.exec(P.canvas.style.transform)[1]);
  assert.ok(sq >= FX.paper.squash.min && sq < 1, "压扁 = cos(俯角)，不小于下限");
  const shade = P.log.stage.childNodes.find(n => n.id === "hd2d-shade");
  assert.ok(shade && shade.childNodes.length === 1 && shade.childNodes[0].className === "hd2d-shadow", "影子在 3D 战场那一层里");
  F.unpaper();
  assert.equal(P.canvas.style.transform, "", "红叉之前画布复原");
  // 关掉新画面：数字、影子拿掉，画布复原
  F.paper(foe.id);
  F.switchTo("old");
  assert.equal(P.canvas.style.transform, "");
  assert.equal(P.numbers().length, 0);
  assert.deepEqual(P.page.errors, []);
});

test("减少动态效果时不推镜头（场景的 motion 关着，hd2d-play.js · HD2DPlay.camera → pushPose 的 reduced）", async () => {
  const P = fieldPage(), F = P.ctx.HD2DField;
  await P.open();
  const foe = P.st.units.find(u => u.kit === "thug_hammer"), kolt = P.st.units.find(u => u.kit === "kolt");
  assert.ok(F.push(kolt.id, foe.id) > 0, "动态效果开着：推");
  F.release();
  // 把场景换成 motion 关着的（系统开了「减少动态效果」），重新打开
  F.switchTo("old");
  const make = fakeScene(P.log);
  P.ctx.HD2DField.boot({ doc: P.doc, storage: { getItem: () => "on", setItem() {} }, load: () => Promise.resolve((stage, o) => { const sc = make(stage, o); sc.motion = false; return sc; }), hint() {}, reduced: () => true });
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
  assert.equal(F.on(), true);
  const n = P.log.pushes.length;
  assert.equal(F.push(kolt.id, foe.id), 0, "减少动态效果：不推");
  assert.equal(P.log.pushes.length, n);
  const play = code(read("hd2d/hd2d-play.js"));
  assert.match(play, /F\.pushPose\(sc\.poseNow\(\), a, b, \{ enabled: o\.enabled \? !!o\.enabled\(\) : true, reduced: !sc\.motion, view: v, plates \}\)/);
});

/* ---------- 3. 坚毅生命 ---------- */
test("坚毅生命绝不显示：打在坚毅生命上、濒死、给濒死的人治疗的那几下不弹数字（和原型一样，过联机演出带的白名单）；新加的 DOM（数字、影子、铭牌、踩塔）里没有坚毅生命的数字", async () => {
  const P = fieldPage({ boss: true });
  const pops = gamePops(P);
  await P.open();
  const foe = P.st.units.find(u => u.kit === "thug_hammer");
  const [a, b, c] = P.st.units.filter(u => u.isPlayer);
  a.upOnShp = true;                 // 起身：之后受伤打进坚毅生命
  b.dying = true;                   // 濒死
  pops.hit(foe, 5, "fire");
  pops.hit(a, 3, "fire");
  pops.hit(b, 4, "physical");
  pops.paperPop(b.id, { type: "pop", kind: "heal", unitId: b.id, value: 6, element: "physical", snap: [snapOf(b)] });
  pops.hit(c, 2, "ice");
  const texts = P.numbers().map(n => n.textContent);
  assert.deepEqual(texts, ["5", "2"], "打在看得见的血上：照弹；打在坚毅生命上（3）、濒死（4）、给濒死的人治疗（+6）：不弹");
  assert.equal(pops.fxLayer.childNodes.length, 0, "也不退回去弹旧的 .pop");
  // 新加的 DOM：数字、影子、铭牌数据、踩塔里都没有坚毅生命（数值、字样）
  P.ctx.HD2DField.paper(foe.id);
  const layout = P.log.layouts[P.log.layouts.length - 1];
  const UIX = P.ctx.HD2DUI, UC = P.ctx.UnitCard;
  const added = JSON.stringify(layout) + layout.units.map(u => UIX.mechsHtml(u.plate.mechs, UC)).join("") + layout.zones.map(z => UIX.towersHtml(z.towers, UC)).join("") +
    P.numbers().map(n => n.textContent + n.style.cssText).join("") +
    P.log.stage.childNodes.filter(n => n.id === "hd2d-shade").flatMap(n => n.childNodes).map(n => n.style.cssText).join("");
  assert.ok(layout.units.some(u => u.plate.mechs), "铭牌上有首领机制");
  assert.ok(!added.includes(String(SHP_MAX)) && !/shp|坚毅/i.test(added.replace(/"upOnShp":(true|false)/g, "")), "新加的 DOM / 数据里出现了坚毅生命");
  assert.ok(!added.replace(/"upOnShp":(true|false)/g, "").includes(String(SHP)), "新加的 DOM / 数据里出现了坚毅生命的数值");
});

/* ---------- 4. 首领机制 ---------- */
/** 一串机制图标：[{ kind, type, n（角上的数字）, last, tip }] */
function icons(html) {
  const out = [];
  const re = /<span class="mech-ico k-(\w+) t-(\w+)( last)?"[^>]*?data-left="(\d+)"([^>]*)>[\s\S]*?<b class="mi-n" aria-hidden="true">([^<]*)<\/b><\/span>/g;
  let m;
  while ((m = re.exec(html))) {
    const tip = /data-mtip="([^"]*)"/.exec(m[5]);
    out.push({ kind: m[1], type: m[2], last: !!m[3], n: m[6], tip: tip ? JSON.parse(unent(tip[1])) : null });
  }
  return out;
}
/** 投影把全角括号这类字符规范成了半角（联机玩家的旧画面也是这样），比内容时两边一样规范 */
const norm = (s) => String(s).normalize("NFKC");

test("首领机制在新画面下都有，内容和旧画面一致：铭牌上方的图标和倒计时（unit-card.js · mechIconsHtml 同一份 HTML）、地台上的踩塔（towerMarkHtml 同一份）；数据走联机投影（display.marks / casts、zoneView.towers）", async () => {
  const P = fieldPage({ boss: true }), ctx = P.ctx, UC = ctx.UnitCard, UIX = ctx.HD2DUI;
  await P.open();
  const layout = P.log.layouts[P.log.layouts.length - 1];
  const boss = P.boss;
  // 旧画面：game.js · snapUnit 的 marks / casts（bossMarksOn / bossCastsBy），单位卡上方的 .u-mechs
  const old = (u) => UC.mechIconsHtml({ id: u.id, marks: ctx.bossMarksOn(u), casts: ctx.bossCastsBy(u) });
  let shown = 0;
  P.st.units.filter(u => !u.dead && !u.hidden).forEach(u => {
    const lu = layout.units.find(x => x.id === u.id);
    assert.ok(lu, u.name + " 有铭牌");
    const html = UIX.mechsHtml(lu.plate.mechs, UC), want = old(u);
    if (!want) { assert.equal(html, "", u.name + "：旧画面没有图标，新画面也没有"); return; }
    shown++;
    assert.equal(norm(html), norm(`<div class="pl-mechs">${want}</div>`), u.name + "：铭牌上方的图标和旧画面的单位卡同一份");
  });
  assert.ok(shown >= 3, "首领、被点名的人头上都有图标");
  // 首领头上：正在读条的四个机制，角上的数字 = 还有几回合（和旧画面一样）
  const onBoss = icons(UIX.mechsHtml(layout.units.find(x => x.id === boss.id).plate.mechs, UC));
  assert.deepEqual(onBoss.map(i => [i.kind, i.type, i.n]), [["cast", "execution", "3"], ["cast", "share", "2"], ["cast", "tower", "2"], ["cast", "spread", "4"]]);
  assert.ok(onBoss.every(i => i.tip && i.tip.what && i.tip.how), "悬停说明（会发生什么、怎么应对）是 unit-card.js 的");
  // 地台上的踩塔：被标记的区，图标 + 几人 / 要几人，和旧画面区名旁边的同一份
  const tz = boss.mechanics.find(m => m.type === "tower").st.zones[0];
  const zone = layout.zones.find(z => z.id === Number(tz));
  assert.ok(zone.towers.length === 1, "被标记的区有塔");
  assert.equal(norm(UIX.towersHtml(zone.towers, UC)), norm(UC.towerMarkHtml(ctx.bossZoneMarks(Number(tz)))), "踩塔和旧画面同一份");
  assert.deepEqual(icons(UIX.towersHtml(zone.towers, UC)).map(i => [i.kind, i.type, i.n]), [["zone", "tower", "2"]]);
  layout.zones.filter(z => z.id !== Number(tz)).forEach(z => assert.equal(UIX.towersHtml(z.towers, UC), "", z.id + " 区没有塔"));
  // 场景的铭牌 HTML（hd2d-scene.js · plateHtml，从源码抠出来跑）：铭牌上方就是这一排；原型页没有 UnitCard 就不画
  const scene = read("hd2d/hd2d-scene.js");
  const consts = ["PLATE", "LAYER_COLOR", "STATUS_COLOR", "esc"].map(k => new RegExp(`^const ${k} = .*;$`, "m").exec(scene)[0]).join("\n");
  const plateHtml = vm.runInContext(`(function (window) { ${consts}\n${fnSrc(scene, "plateHtml")}\n return plateHtml; })`, ctx)(ctx);
  const bp = layout.units.find(x => x.id === boss.id).plate;
  assert.ok(bp.mechs && plateHtml(bp).startsWith(UIX.mechsHtml(bp.mechs, UC)), "铭牌最前面是首领机制那一排");
  const noUC = vm.runInContext(`(function (window) { ${consts}\n${fnSrc(scene, "plateHtml")}\n return plateHtml; })`, ctx)({ HD2DUI: UIX });
  assert.ok(!noUC(bp).includes("pl-mechs"), "原型页（没有 unit-card.js）：不画");
  // 场景：每次排铭牌照旧画面弹一下新点名（只弹不响：提示音旧画面的单位卡已经响过）；踩塔用 towersHtml，地台上一圈环（数值在 TOWER）
  const sc = code(scene);
  assert.match(sc, /UC\.alertNew\(p\.bob\.querySelector\(":scope > \.pl-mechs"\), u\.plate\.mechs \? u\.plate\.mechs\.marks : \[\], "mark", \{ quiet: true \}, p\.mechMemo\)/);
  assert.match(sc, /const html = UIX && UIX\.towersHtml \? UIX\.towersHtml\(list, UC\) : "";/);
  assert.match(sc, /UC\.alertNew\(t\.el, list, "zone", \{ quiet: true \}, t\.memo\)/);
  assert.match(sc, /syncPlates\(newBoard\);\s*syncTowers\(\);/, "每次排战场都画踩塔");
  assert.match(scene, /^const MECH = \{[^}]*\};$/m, "图标的大小、离卡片多高在配置表 MECH");
  assert.match(scene, /^const TOWER = \{[^}]*\};$/m, "踩塔的环 / 图标的数值在配置表 TOWER");
  // 只弹不响：unit-card.js 的 alertNew 认 quiet（旧画面不传，照旧响）
  assert.match(read("unit-card.js"), /if \(fresh\.length && !\(opts && opts\.quiet\)\) ping\(\);/);
});

test("首领机制横幅和援军倒计时：新画面下照旧是 game.js 每一帧画的那一摞（unit-card.js · paintBanner / topStack，内容就是旧画面的），压在 3D 战场上面不被挡住，取景让开它；悬停铭牌的说明有「首领机制」那几行（mechLines），鼠标停在图标上弹旧画面的机制说明", async () => {
  const P = fieldPage({ boss: true }), ctx = P.ctx, UC = ctx.UnitCard;
  await P.open();
  // game.js：setView 每一帧都画横幅（不看新画面开没开）；援军倒计时也放进同一摞
  const g = read("game.js");
  assert.match(fnSrc(g, "paintMechBar"), /UnitCard\.paintBanner\(\$\("g-field"\), snaps\)/);
  assert.match(fnSrc(g, "setView"), /paintMechBar\(snaps\);[\s\S]*if \(window\.HD2DField\) HD2DField\.view\(snaps, \{ animate: !!animate \}\);/);
  assert.match(g, /const top = field && window\.UnitCard && UnitCard\.topStack \? UnitCard\.topStack\(field\) : field;/, "援军倒计时在同一摞里");
  // 新画面开着：横幅那一摞是 #g-field 的孩子，和 3D 战场并排；内容就是旧画面那一份
  const snaps = P.st.units.map(u => Object.assign(snapOf(u), { casts: ctx.bossCastsBy(u), marks: ctx.bossMarksOn(u) }));
  const items = UC.paintBanner(P.field, snaps);
  assert.ok(items.length >= 4, "首领读条的机制都在横幅上");
  const stack = P.field.childNodes.find(n => n.className === "g-topstack");
  assert.ok(stack && P.field.childNodes.includes(P.log.stage), "横幅那一摞和 3D 战场都在 #g-field 里");
  const bar = stack.childNodes.find(n => n.className === "mech-bar");
  items.forEach(x => assert.ok(unent(bar.innerHTML.replace(/<[^>]*>/g, "")).includes(UC.bannerText(x).replace(/ · (\d+) 回合$/, " · $1 回合")), "横幅上有：" + UC.bannerText(x)));
  // 样式：新画面开着时横幅那一摞露出来、压在 3D 战场（z-index 5）上面
  const css = read("hd2d/hd2d.css");
  assert.match(css, /\.g-app\.hd2d-on > \.g-field > \.hd2d-field, \.g-app\.hd2d-on > \.g-field > \.g-topstack \{ visibility: visible; \}/);
  const zTop = /\.g-app\.hd2d-on > \.g-field > \.g-topstack \{ z-index: (\d+); \}/.exec(css), z3d = /\n\.hd2d-field \{ position: absolute; inset: 0; z-index: (\d+);/.exec(css);
  assert.ok(zTop && z3d && Number(zTop[1]) > Number(z3d[1]), "横幅压在 3D 战场上面");
  // 取景让开横幅（数字也不顶进去：numbers 的画面上沿 = 场景的 insets.top）
  const fsrc = code(read("hd2d/hd2d-field.js"));
  assert.match(fsrc, /const top = field && field\.querySelector \? field\.querySelector\(":scope > \.g-topstack"\) : null;/);
  assert.match(fnSrc(read("hd2d/hd2d-field.js"), "fxView"), /top: v\.top \|\| 0, bottom: v\.bottom \|\| 0/);
  // 悬停铭牌：GAME.fieldInput.hover → game.js · onCardHover（说明挂在铭牌上），内容 unitTipHtml 带着首领机制那几行（unit-card.js · mechLines）
  assert.match(fnSrc(g, "unitTipHtml"), /mechs: window\.UnitCard && UnitCard\.mechLines \? UnitCard\.mechLines\(s\) : \[\]/);
  assert.match(fnSrc(g, "onCardHover"), /const anchor = at \|\|/);
  const marked = P.st.units.find(u => u.isPlayer && ctx.bossMarksOn(u).length);
  const lines = UC.mechLines({ marks: ctx.bossMarksOn(marked), casts: [] });
  vm.runInContext(read("unit-tip.js"), ctx, { filename: "unit-tip.js" });
  const tip = ctx.UnitTip.html({ kind: "hero", kit: marked.kit }, [], { name: marked.name, mechs: lines });
  assert.ok(tip.includes("首领机制 · 倒计时") && lines.every(l => unent(tip).includes(l.slice(l.indexOf("：")))), "悬停说明里有首领机制的倒计时");
  // 铭牌上方的图标接鼠标（铭牌层本身不拦鼠标）：停在图标上弹 unit-card.js 的机制说明
  assert.match(css, /\.pl-mechs \.mech-ico \{ pointer-events: auto; \}/);
  assert.match(css, /\.hd2d-tower \.mech-ico \{ pointer-events: auto; \}/);
  assert.match(read("hd2d/hd2d-scene.js"), /if \(options\.onUnitHover\) options\.onUnitHover\(p\.id, true, e\.target\);/);
});
