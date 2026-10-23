// HD-2D 战场接进单机正式战斗画面（#261，路线的第一步）：战斗顶栏的「新画面（HD-2D）」开关。
// 开关默认关（记在本机 localStorage，读写都包 try/catch），关着时 game.html 的战场照旧；开着时战场那一格（#g-field）换成 3D 战场：
// 画面数据走联机玩家的那条路（OnlineView.projectState / projectUnit 投影后再交给布局），没有坚毅生命；
// 点铭牌 / 地台、悬停铭牌调 game.js 交出来的同一套入口（GAME.fieldInput），不复制规则判断；选目标 / 选区的标记、2D 攻击演出的位置也接上。
// 都是 Node 能跑的：开关、投影、标记、接线是纯函数（hd2d/hd2d-field.js），game.js / game.html / 场景查源码；WebGL 画面和截图由仓库主人跑。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("./headless");
const HP = require("./hd2d-paths");
const L = require("../hd2d/hd2d-layout.js");

// 缺这个文件时只是用到它的那几条失败（每条测试里各自 require）
const field = () => require("../hd2d/hd2d-field.js");

const read = (f) => fs.readFileSync(path.join(HP.ROOT, f), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");   // 去掉注释，只看代码
const PARTY = ["kolt", "helu", "ruby", "yuito"];
const DESKTOP = { width: 1100, height: 620, top: 0, bottom: 40 };      // 正式画面里战场那一格（1440×900 去掉顶栏、右边的记录栏、下面的技能栏）
const SHP = 7771, SHP_MAX = 7772;

/** 投影后的东西里不能有坚毅生命（upOnShp 是给玩家看的「起身」开关，只有 true / false，不是数值） */
function noShp(x, tag) {
  const s = JSON.stringify(x).replace(/"upOnShp":(true|false)/g, "");
  assert.ok(!/shp|坚毅生命/i.test(s), tag + "：出现了坚毅生命");
  assert.ok(!s.includes(String(SHP)) && !s.includes(String(SHP_MAX)), tag + "：出现了坚毅生命的数值");
}

/** 规则环境里摆一场三区的战斗：区域 / 光影写进战斗状态（和开战时一样），每个单位塞上特殊的坚毅生命数，放一个爆炸桶 */
function battle() {
  const ctx = H.load();
  const st = ctx.BattleSim.setup({
    party: PARTY, zoneMode: 3, seed: "hd2d-field", region: "第一采矿场", light: "dusk",
    enemies: [{ id: "guard_sword", lv: 2, zone: 3 }, { id: "thug_hammer", lv: 2, zone: 2 }]
  });
  st.fields[2].acid = true;
  st.gaps["2-3"] = { type: "wall", hp: 20, maxHp: 20, open: false, lastFrom: null };
  st.units.forEach(u => { u.shp = SHP; u.shpMax = SHP_MAX; u.baseShp = SHP; });
  st.units.find(u => u.kit === "kolt").statuses.burn = 2;
  st.props = (st.props || []).concat([{ id: "boom1", kind: "boom", name: "爆炸桶", zone: 2, level: 1, hp: 5, maxHp: 8, faction: "enemy" }]);
  vm.runInContext(read("online-view.js"), ctx, { filename: "online-view.js" });
  return { ctx, st };
}
/** 演出途中某一下的画面快照（照 game.js · snapUnit / snapProp 的样子：血量层写 cur，带着坚毅生命——game.js 的快照里本来就有） */
function snapOf(u) {
  return {
    id: u.id, name: u.name, level: u.level || 1, isPlayer: !!u.isPlayer, kit: u.kit, zone: Number(u.zone) || 1,
    hidden: !!u.hidden, dead: !!u.dead, dying: !!u.dying, stunned: !!u.stunned, flying: !!u.flying, submerged: !!u.submerged,
    def: u.def || 0, defMax: u.defMax || 0, ap: u.ap || 0, apMax: u.apMax || 0, bonus: u.bonus || 0, bonusMax: u.bonusMax || 0,
    layers: u.layers.map(l => ({ type: l.type, cur: l.current, max: l.max })), shp: SHP, shpMax: SHP_MAX, status: "灼烧×2"
  };
}
function propSnap(p) {
  return { id: "prop:" + p.id, name: p.name, isPlayer: p.faction !== "enemy", isProp: true, isDevice: false, zone: p.zone, level: p.level,
    layers: [{ type: "armor", cur: p.hp, max: p.maxHp }], dead: false, hidden: false, shp: 0 };
}

/* ---------- 1. 开关 ---------- */
test("开关「新画面（HD-2D）」：默认开（#316）；记在本机 localStorage，明确选过关（存着 off）的照旧关（读写都包 try/catch：读不了按默认开、存不了也不报错）", () => {
  const F = field();
  const mem = () => { const m = new Map(); return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; };
  assert.equal(F.FIELD.defaultOn, true, "默认开（#316：主人要新画面当默认）");
  const s = mem();
  assert.equal(F.enabled(s), true, "没存过 = 开");
  assert.equal(F.setEnabled(false, s), true);
  assert.equal(s.m.get(F.FIELD.storageKey), "off");
  assert.equal(F.enabled(s), false, "选过关：照旧关");
  F.setEnabled(true, s);
  assert.equal(F.enabled(s), true, "开了也记住");
  s.m.set(F.FIELD.storageKey, "乱写的");
  assert.equal(F.enabled(s), true, "认不得的值：按默认开");
  const broken = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("QuotaExceededError"); } };
  assert.doesNotThrow(() => F.enabled(broken));
  assert.equal(F.enabled(broken), true, "读不了：按默认开");
  assert.doesNotThrow(() => F.setEnabled(true, broken));
  assert.equal(F.setEnabled(true, broken), false, "存不了：不报错，告诉外面没存上");
  assert.equal(F.enabled(null), true, "没有 localStorage：按默认开");
  const src = code(read("hd2d/hd2d-field.js"));
  const get = src.slice(src.indexOf("function enabled("), src.indexOf("function setEnabled("));
  const set = src.slice(src.indexOf("function setEnabled("), src.indexOf("}", src.indexOf("catch", src.indexOf("function setEnabled("))) + 1);
  assert.ok(/try \{[\s\S]*getItem\(FIELD\.storageKey\)[\s\S]*\} catch/.test(get), "读在 try 里");
  assert.ok(/try \{[\s\S]*setItem\(FIELD\.storageKey/.test(set) && /catch/.test(set), "写在 try 里");
});

/** 最小的假网页：开关按钮、#g-app、#g-field（只模拟 boot 碰到的那几样） */
function fakePage() {
  const els = {};
  const make = (id, tag) => {
    const set = new Set();
    const e = {
      id, tagName: String(tag || "div").toUpperCase(), textContent: "", title: "", hidden: false, attrs: {}, listeners: {}, children: [],
      classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c), toggle: (c, on) => { const v = on === undefined ? !set.has(c) : !!on; if (v) set.add(c); else set.delete(c); return v; } },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, removeEventListener() {},
      appendChild(c) { this.children.push(c); return c; }, append(...cs) { cs.forEach(c => this.children.push(c)); }, remove() {}
    };
    if (id) els[id] = e;
    return e;
  };
  make("g-hd2d-toggle", "button"); make("g-app"); make("g-field");
  const doc = { readyState: "complete", getElementById: (id) => els[id] || null, createElement: (t) => make("", t), addEventListener() {} };
  return { els, doc };
}
const settle = () => new Promise(r => setImmediate(r));

test("本机选过关（存着 off）：一切照旧——boot 不加载 three.js / 场景、不碰旧战场，按钮写「新画面 关」；点一下才加载，加载不了（没有 WebGL）就退回旧画面、开关记成关、给一句提示", async () => {
  const F = field();
  const mem = new Map([[F.FIELD.storageKey, "off"]]), storage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); } };
  let loads = 0;
  const hints = [];
  const P = fakePage();
  // reduced：减少动态效果，点开关直接切（云雾转场另在 tests/hd2d-mist.test.js）
  F.boot({ doc: P.doc, storage, load: () => { loads++; return Promise.reject(new Error("Failed to fetch dynamically imported module")); }, hint: (m) => hints.push(m), reduced: () => true });
  await settle();
  const btn = P.els["g-hd2d-toggle"];
  assert.equal(loads, 0, "关着：不加载");
  assert.equal(F.on(), false);
  assert.equal(btn.textContent, F.FIELD.label.off);
  assert.equal(btn.getAttribute("aria-pressed"), "false");
  assert.equal(P.els["g-field"].children.length, 0, "旧战场里什么都没放");
  assert.ok(!P.els["g-app"].classList.contains("hd2d-on"), "旧战场没被藏起来");
  // 点一下：记成开、开始加载；加载失败 → 退回旧画面，开关记成关，给提示
  assert.ok(btn.listeners.click && btn.listeners.click.length === 1, "按钮接上了");
  btn.listeners.click[0]({});
  assert.equal(loads, 1, "开了才加载");
  await settle(); await settle();
  assert.equal(F.on(), false, "加载不了：还是旧画面");
  assert.equal(mem.get(F.FIELD.storageKey), "off", "开关记成关");
  assert.equal(btn.textContent, F.FIELD.label.off);
  assert.equal(btn.getAttribute("aria-pressed"), "false");
  assert.ok(hints.length === 1 && /新画面/.test(hints[0]) && /WebGL/.test(hints[0]), "提示为什么打不开：" + hints[0]);
  assert.equal(P.els["g-field"].children.length, 0);
  // 本机记着开：一打开就加载
  mem.set(F.FIELD.storageKey, "on");
  const P2 = fakePage();
  let loads2 = 0;
  F.boot({ doc: P2.doc, storage, load: () => { loads2++; return new Promise(() => {}); }, hint: () => {} });
  assert.equal(loads2, 1, "记着开：打开页面就加载");
  assert.equal(P2.els["g-hd2d-toggle"].getAttribute("aria-pressed"), "true");
});

test("本机没选过（#316）：默认开——打开页面就加载新画面、开关按下；打不开（没有 WebGL）照旧退回旧画面、开关记成关、提示为什么；记成关以后再打开页面照旧关", async () => {
  const F = field();
  const mem = new Map(), storage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); } };
  // 没选过、能打开：一打开页面就加载（不用点开关、不用滚轮），开关写「新画面 …」按下
  const P = fakePage();
  let loads = 0;
  F.boot({ doc: P.doc, storage, load: () => { loads++; return new Promise(() => {}); }, hint: () => {}, reduced: () => true });
  assert.equal(loads, 1, "没选过：打开页面就加载新画面");
  assert.equal(P.els["g-hd2d-toggle"].getAttribute("aria-pressed"), "true", "开关按下");
  assert.equal(P.els["g-hd2d-toggle"].textContent, F.FIELD.label.loading, "正在加载");
  assert.equal(mem.has(F.FIELD.storageKey), false, "默认开不往本机写（玩家没选过）");
  // 没选过、打不开：退回旧画面，开关记成关，提示为什么
  const P2 = fakePage(), hints = [];
  let loads2 = 0;
  F.boot({ doc: P2.doc, storage, load: () => { loads2++; return Promise.reject(new Error("WebGL 不可用")); }, hint: (m) => hints.push(m), reduced: () => true });
  assert.equal(loads2, 1);
  await settle(); await settle();
  assert.equal(F.on(), false, "打不开：还是旧画面");
  assert.equal(mem.get(F.FIELD.storageKey), "off", "开关记成关");
  assert.equal(P2.els["g-hd2d-toggle"].textContent, F.FIELD.label.off);
  assert.equal(P2.els["g-hd2d-toggle"].getAttribute("aria-pressed"), "false");
  assert.ok(hints.length === 1 && /新画面/.test(hints[0]) && /WebGL/.test(hints[0]), "提示为什么打不开：" + hints[0]);
  assert.ok(!P2.els["g-app"].classList.contains("hd2d-on"), "旧战场露着");
  // 记成关以后再打开页面：照旧关，不再去加载
  const P3 = fakePage();
  let loads3 = 0;
  F.boot({ doc: P3.doc, storage, load: () => { loads3++; return new Promise(() => {}); }, hint: () => {}, reduced: () => true });
  assert.equal(loads3, 0, "记着关：不加载");
  assert.equal(P3.els["g-hd2d-toggle"].getAttribute("aria-pressed"), "false");
});

test("关着时 game.html 的战场照旧：顶栏多一个「新画面」开关（默认写关）；旧战场 #g-field 的结构一点没变；页面不预先加载 three.js、布局、场景（开了才载）；game.js 接新画面的地方都先看开关", () => {
  const html = read("game.html");
  const btn = /<button class="g-btn" id="g-hd2d-toggle"[^>]*>([^<]*)<\/button>/.exec(html);
  assert.ok(btn, "战斗顶栏有开关按钮");
  assert.match(btn[0], /aria-pressed="false"/);
  assert.equal(btn[1], "新画面 关");
  assert.match(btn[0], /title="新画面（HD-2D）：/);
  const top = html.slice(html.indexOf('<header class="g-top">'), html.indexOf("</header>", html.indexOf('<header class="g-top">')));
  assert.ok(top.includes('id="g-hd2d-toggle"'), "开关在战斗顶栏里");
  // 旧战场：和以前一模一样（两个区 + 中间的间隔）
  assert.ok(html.includes('<main class="g-field" id="g-field">\n    <section class="g-zone" data-num="1"><span class="zlabel">1 区</span><div class="grp enemy"></div><div class="grp player"></div></section>\n    <div class="g-gap"></div>\n    <section class="g-zone" data-num="2"><span class="zlabel">2 区</span><div class="grp enemy"></div><div class="grp player"></div></section>\n  </main>'), "#g-field 原样");
  // 脚本：新画面的接线在 game.js 后面；不直接加载 ES 模块 / three.js / 布局（开了由 hd2d-field.js 按需加载）
  const pos = (f) => html.indexOf(`<script src="${f}"></script>`);
  assert.ok(pos("game.js") > 0 && pos("hd2d/hd2d-field.js") > pos("game.js"), "hd2d-field.js 在 game.js 后面");
  assert.ok(!/<script[^>]*type="module"/.test(html), "不直接加载 ES 模块");
  assert.ok(!/<script src="(?:hd2d\/hd2d-(?!field\.js)[^"]*|vendor\/three\/[^"]*)"><\/script>/.test(html), "布局、场景、three.js 开了才加载");
  // 场景和 three.js 打成了普通脚本 hd2d/hd2d-scene.bundle.js（tools/build-hd2d.js），game.html 不再要 importmap（tests/hd2d-bundle.test.js）
  assert.ok(!/<script type="importmap">/.test(html), "不要 importmap：直接双击打开（file://）也能开新画面");
  assert.ok(html.includes('<link rel="stylesheet" href="hd2d/hd2d.css" />'), "战场的样式（类名都是 hd2d- / pl- 开头，关着时一条都套不上）");
  // hd2d-field.js 开了才加载的东西都在 hd2d/ 里
  const F = field();
  F.FIELD.scripts.forEach(f => assert.ok(fs.existsSync(HP.mod(f)), f));
  assert.ok(fs.existsSync(HP.mod(F.FIELD.scene)), "场景包在 hd2d/ 里");
  // game.js：接新画面的地方都先看开关（关着 = 原来的样子）
  const g = read("game.js");
  assert.match(g, /const field3d = \(\) => !!\(window\.HD2DField && HD2DField\.on\(\)\);/);
  assert.match(g, /function centerOf\(id\) \{\s*if \(field3d\(\)\) return field3dRect\(id\);/, "演出位置：开着问 3D，关着照旧量单位卡");
  assert.match(g, /function zoneRectOf\(zone\) \{\s*if \(field3d\(\)\) return HD2DField\.zoneRectOf\(zone\);/);
  assert.match(g, /if \(window\.HD2DField\) HD2DField\.view\(snaps\);/, "setView 每次都告诉新画面（新画面自己看开没开）");
  assert.match(g, /const wfxField = field3d\(\) \? null : fieldEl;/, "天气叠加层：开着时画在新画面上，旧战场不放（关着照旧）");
  // 页面的 CSS：只有 .g-app.hd2d-on（开着）时才藏旧战场
  const css = read("hd2d/hd2d.css");
  assert.match(css, /\.g-app\.hd2d-on > \.g-field \{ visibility: hidden; \}/);
  assert.ok(!/(^|\})\s*\.g-field\s*\{/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")), "不改旧战场本身的样子");
});

/* ---------- 2. 投影 ---------- */
test("开着时布局拿到的是投影后的数据：战斗状态过 OnlineView.projectState、演出每一下的快照过 OnlineView.projectUnit（联机演出带也是这样投影快照的）；区域 / 场景 / 光影读投影；没有坚毅生命", () => {
  const F = field();
  const { ctx, st } = battle();
  const OV = ctx.OnlineView;
  const pv = OV.projectState(st, { itemCatalog: ctx.ITEM_CATALOG || {} });
  // 演出途中的一下：敌人挨了一刀（快照里的血比现在的战斗状态多）、柯尔特还在 1 区（战斗状态里已经走到 2 区）
  const kolt = st.units.find(u => u.kit === "kolt"), foe = st.units.find(u => u.kit === "thug_hammer");
  const snaps = st.units.map(snapOf).concat(st.props.map(propSnap));
  const sk = snaps.find(s => s.id === kolt.id), sf = snaps.find(s => s.id === foe.id);
  sk.zone = 1; kolt.zone = 2;
  sf.layers[0].cur = Math.max(1, sf.layers[0].cur - 3);
  const v = F.viewState(st, snaps, { OV, itemCatalog: ctx.ITEM_CATALOG || {} });
  noShp(v, "画面用的那一份");
  noShp(OV.projectState(st, {}), "（对照）投影本来就没有");
  // 棋盘、场地、间隔、天气、区域、场景、光影：就是投影里的
  ["displayOnly", "board", "zoneMode", "fields", "gaps", "weather", "sandDir", "phaseStep", "turnNo", "region", "scene", "light"].forEach(k =>
    assert.deepEqual(v[k], pv[k], k + " 是投影里的"));
  assert.equal(v.region, "第一采矿场");
  assert.equal(v.light, "dusk");
  // 单位：名字、状态、实际 ATK（display.atk）这些是投影的；血量、站位这些会变的是那一下快照投影出来的
  const vk = v.units.find(u => u.id === kolt.id), vf = v.units.find(u => u.id === foe.id), pk = pv.units.find(u => u.id === kolt.id);
  assert.equal(vk.zone, 1, "站位是那一下的");
  assert.equal(vk.statuses.burn, 2, "状态是投影的");
  assert.deepEqual(vk.display, pk.display, "实际 ATK / 状态文字是投影的");
  assert.equal(vf.layers[0].current, sf.layers[0].cur, "血量是那一下的（快照的 cur 换成投影的 current）");
  // 配置物（爆炸桶）也当成铭牌画：id 和单位卡一样是 prop:…，过同一个白名单
  const vb = v.units.find(u => u.id === "prop:boom1");
  assert.ok(vb && vb.isProp && vb.zone === 2 && vb.layers[0].current === 5 && vb.layers[0].max === 8, "爆炸桶");
  // 每个字段都是投影出来的（不是从快照 / 房主的单位整个拷过来的）：只有 projectState / projectUnit 给得出的键
  const allowed = new Set();
  snaps.forEach(s => Object.keys(OV.projectUnit(s) || {}).forEach(k => allowed.add(k)));
  pv.units.forEach(u => Object.keys(u).forEach(k => allowed.add(k)));
  v.units.forEach(u => Object.keys(u).forEach(k => assert.ok(allowed.has(k), `${u.id}.${k} 不是投影给的`)));
  assert.ok(!allowed.has("shp") && !allowed.has("shpMax"));
  // 快照里没有的单位（还没登场 / 已经拿掉）不画
  const lone = F.viewState(st, snaps.filter(s => s.id !== foe.id), { OV, itemCatalog: {} });
  assert.ok(!lone.units.some(u => u.id === foe.id));
  // 没给快照（刚打开新画面）：就是投影本身
  assert.deepEqual(F.viewState(st, null, { OV, itemCatalog: {} }), OV.projectState(st, { itemCatalog: {} }));
  // 交给布局：区域 / 场景 / 光影读投影里的；布局里也没有坚毅生命
  const opts = F.layoutOpts(v, DESKTOP, false);
  assert.deepEqual(opts, { portrait: false, view: DESKTOP, region: "第一采矿场", scene: v.scene, theme: "dusk" });
  const lay = L.build(v, opts);
  assert.equal(lay.region, "第一采矿场");
  assert.equal(lay.scene, v.scene);
  noShp(lay, "布局");
  assert.ok(lay.units.some(u => u.id === "prop:boom1"), "爆炸桶有铭牌");
  assert.equal(lay.units.find(u => u.id === kolt.id).zone, 1);
  // 页面：画之前照联机发包前一样先 battleLookSync（光影跟着时钟、场景跟着场地），然后 viewState → layoutOpts → HD2DLayout.build；不直接读 state.units 画
  const src = code(read("hd2d/hd2d-field.js"));
  const paint = src.slice(src.indexOf("function paint("), src.indexOf("function syncWeather("));
  assert.match(paint, /battleLookSync\(\)/);
  assert.match(paint, /viewState\(st, snaps, \{ OV: root\.OnlineView, itemCatalog: catalog\(\) \}\)/);
  // #316：白卡的卡片快照、量到的卡片大小也一起交给布局
  assert.match(paint, /L\.build\(v, layoutOpts\(v, S\.sc\.view\(\), S\.sc\.portrait, cards \? \{ cards, sizes: S\.sizes \} : null\)\)/);
  assert.doesNotMatch(src, /\.shp\b|shpMax|baseShp/, "新画面的代码不碰坚毅生命");
  assert.doesNotMatch(src, /\bst\.units\b|state\.units/, "不绕开白名单直接读单位");
});

/* ---------- 3. 点得动 ---------- */
test("点铭牌 / 地台、悬停铭牌：和旧画面的单位卡、区调同一个入口（GAME.fieldInput），新画面不复制一份规则判断", () => {
  const F = field();
  const calls = [];
  const input = {
    unit: (id) => calls.push(["unit", id]),
    hover: (id, on, el) => calls.push(["hover", id, on, el]),
    zone: (z, on) => calls.push(["zone", z, on]),
    zoneHover: (z, on) => calls.push(["zoneHover", z, on])
  };
  const o = F.wire(input);
  o.onUnitClick("u1"); o.onGapClick("1-2"); o.onZoneClick(3); o.onEmptyClick(); o.onUnitHover("u2", true, "铭牌"); o.onZoneHover(2, true); o.onZoneHover(2, false);
  assert.deepEqual(calls, [["unit", "u1"], ["unit", "gap:1-2"], ["zone", 3, {}], ["zone", null, {}], ["hover", "u2", true, "铭牌"], ["zoneHover", 2, true], ["zoneHover", 2, false]]);
  // game.js：这几个入口交出去；旧画面的单位卡、危墙 / 桥梁、战场的点击、区的悬停也都走它们
  const g = read("game.js");
  assert.match(g, /G\.fieldInput = \{ unit: onCardClick, hover: onCardHover, zone: clickField, zoneHover: hoverZone \};/);
  assert.match(g, /c\.wrap\.addEventListener\("click", \(e\) => \{ e\.stopPropagation\(\); onCardClick\(c\.id\); \}\);/, "单位卡");
  assert.match(g, /node\.addEventListener\("click", \(e\) => \{ e\.stopPropagation\(\); onCardClick\(id\); \}\);/, "危墙 / 桥梁");
  const fc = g.slice(g.indexOf('$("g-field").addEventListener("click"'), g.indexOf("\n    });", g.indexOf('$("g-field").addEventListener("click"')));
  assert.match(fc, /clickField\(zone \? Number\(zone\.dataset\.num\) : null, \{ unit: !!e\.target\.closest\("\.unit-wrap"\), gap: !!e\.target\.closest\("\.g-gap"\) \}\)/, "战场的点击");
  assert.equal((g.match(/addEventListener\("mouseenter", \(\) => hoverZone\(Number\((?:sec|z)\.dataset\.num\), true\)\)/g) || []).length, 2, "区的悬停（建区的时候、开局时的两个区）");
  assert.equal((g.match(/addEventListener\("mouseleave", \(\) => hoverZone\(Number\((?:sec|z)\.dataset\.num\), false\)\)/g) || []).length, 2);
  // 「这个区能不能去」只在 game.js 里判断一次（点 = pickZoneByClick，悬停 = hoverZone）
  assert.equal((g.match(/G\.arm\.zones\.has\(/g) || []).length, 2, "选区的判断只有点、悬停这两处");
  const click = g.slice(g.indexOf("function clickField("), g.indexOf("\n  }\n", g.indexOf("function clickField(")));
  assert.match(click, /if \(G\.depth > 0\) \{ G\.skip = true; return; \}/, "演出中点战场 = 跳过（和以前一样）");
  assert.match(click, /pickZoneByClick\(zoneSection\(zone\)\)/);
  // 悬停说明挂在给的元素上（新画面给铭牌，旧画面不给 = 单位卡）
  assert.match(g, /function onCardHover\(id, on, at\) \{/);
  assert.match(g, /const anchor = at \|\| \(cards\.get\(id\) \? cards\.get\(id\)\.wrap :/);
  // hd2d-field.js：只把场景的点击转给 GAME.fieldInput，自己不判断规则
  const fsrc = code(read("hd2d/hd2d-field.js"));
  assert.match(fsrc, /wire\(G\.fieldInput\)/);
  assert.doesNotMatch(fsrc, /onCardClick|pickZoneByClick|G\.arm|candidateUnits|runSkill|BattleCommands|dispatch\(/, "新画面不自己判断规则");
  // 场景：给了这几个回调就调它们（原型没给，照旧是画面自己的选中 / 选区）
  const scene = code(read("hd2d/hd2d-scene.js"));
  assert.match(scene, /function pickPlate\(id\) \{\s*if \(options\.onUnitClick\) options\.onUnitClick\(id\);\s*else select\(state\.selectedId === id \? null : id\);/);
  assert.match(scene, /if \(options\.onUnitHover\) options\.onUnitHover\(p\.id, true, e\.target\);/);
  assert.match(scene, /if \(options\.onUnitHover\) options\.onUnitHover\(p\.id, false, e\.target\);/);
  assert.match(scene, /if \(hit && hit\.gap != null && options\.onGapClick\) \{ options\.onGapClick\(hit\.gap\); return; \}/);
  assert.match(scene, /if \(options\.onZoneClick\) options\.onZoneClick\(zid\);/);
  assert.match(scene, /if \(e\.button === 0 && options\.onEmptyClick\) options\.onEmptyClick\(\);/);
  assert.match(scene, /options\.onZoneHover\(/);
  assert.match(scene, /g\.userData\.gapKey = gp\.key;/, "间隔认得出是哪一条（点危墙 / 桥梁）");
});

test("选目标时的高亮、可移动区的提示：game.js 把标记记下来交给新画面（GAME 的 fieldMarks）；能点的目标铭牌描边、别的变暗、悬停的目标更亮；能去的区地台亮框、悬停的更亮；能打的危墙 / 桥梁也亮一圈", () => {
  const F = field();
  const lay = { units: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "prop:x" }], zones: [{ id: 1 }, { id: 2 }, { id: 3 }], gaps: [{ key: "1-2" }] };
  const m = F.marksOf({ pick: true, targets: ["b", "prop:x", "gap:1-2", "不在场上"], hover: "b", zones: [], hoverZone: null }, lay, "a");
  assert.deepEqual([...m.targets].sort(), ["b", "prop:x"]);
  assert.deepEqual([...m.dim], ["c"], "不是目标、也不是行动的人：变暗（和旧画面的 is-dim 一样）");
  assert.equal(m.aim, "b");
  assert.deepEqual([...m.gaps], ["1-2"]);
  assert.deepEqual([...m.zones], []);
  const none = F.marksOf({ pick: true, targets: [], hover: null }, lay, "a");
  assert.deepEqual([...none.dim].sort(), ["b", "c", "prop:x"], "一个能点的都没有：照样变暗");
  const z = F.marksOf({ pick: false, targets: [], zones: [2, "3"], hoverZone: 3 }, lay, "a");
  assert.deepEqual([...z.zones], [2, 3]);
  assert.equal(z.hoverZone, 3);
  assert.deepEqual([...z.dim], [], "选区时不变暗");
  assert.equal(F.marksOf({ pick: true, targets: ["c"], hover: "b" }, lay, "a").aim, null, "悬停的不是目标：不算瞄准");
  assert.deepEqual(F.marksOf(null, lay, "a"), F.marksOf({}, lay, "a"));
  // game.js：标记变的地方都更新 fieldMarks 并交给新画面
  const g = read("game.js");
  assert.match(g, /const fieldMarks = \{ pick: false, targets: \[\], hover: null, zones: \[\], hoverZone: null \};/);
  assert.match(g, /function paintMarks\(patch\) \{\s*Object\.assign\(fieldMarks, patch\);\s*if \(window\.HD2DField\) HD2DField\.marks\(fieldMarks\);/);
  const body = (name) => g.slice(g.indexOf("function " + name + "("), g.indexOf("\n  }\n", g.indexOf("function " + name + "(")));
  assert.match(body("markTargets"), /paintMarks\(\{ pick: true, targets: \[\.\.\.ids\] \}\)/);
  assert.match(body("unmarkTargets"), /paintMarks\(\{ pick: false, targets: \[\], hover: null, zones: \[\], hoverZone: null \}\)/);
  assert.match(body("pickZone"), /paintMarks\(\{ zones: zones\.map\(Number\), hoverZone: null \}\)/);
  assert.match(body("hoverZone"), /paintMarks\(\{ hoverZone: /);
  assert.match(body("onCardHover"), /paintMarks\(\{ hover: /);
  // 场景：铭牌描边 / 变暗 / 瞄准的 class，地台亮框，危墙 / 桥梁的框
  const scene = code(read("hd2d/hd2d-scene.js"));
  assert.match(scene, /p\.el\.classList\.toggle\("target", mk\.targets\.has\(p\.id\)\)/);
  assert.match(scene, /p\.el\.classList\.toggle\("aim", mk\.aim === p\.id\)/);
  assert.match(scene, /p\.el\.classList\.toggle\("dimmed", mk\.dim\.has\(p\.id\)\)/);
  assert.match(scene, /setMarks\(m\) \{/);
  assert.match(scene, /function placeMarks\(\) \{/);
  const css = read("hd2d/hd2d.css");
  assert.match(css, /\.hd2d-plate\.target \.pl-card/);
  assert.match(css, /\.hd2d-plate\.aim \.pl-card/);
  assert.match(css, /\.hd2d-plate\.dimmed \.pl-in \{/);
  const scfg = /const MARK = \{([^}]*\{[^}]*\}[^}]*)*[^}]*\};/.exec(read("hd2d/hd2d-scene.js"));
  assert.ok(scfg, "地台亮框的颜色 / 粗细 / 明暗在配置表 MARK 里");
});

/* ---------- 4. 攻击演出 ---------- */
test("攻击演出先简单接上：开着新画面时 2D 演出（attack-fx 的刀光 / 弹道、hit-fx 的受击粒子、伤害数字）的位置问 3D 投影的矩形（hd2d-fx.js 的适配器 rectOf），危墙 / 桥梁按间隔投影", () => {
  const F = field();
  const FXM = require("../hd2d/hd2d-fx.js");
  const out = L.build({ zoneMode: 2, units: [], fields: {}, gaps: { "1-2": { type: "wall", hp: 5, maxHp: 10, open: false } } }, { view: DESKTOP });
  const lens = FXM.lens({ pos: out.camera.pos, target: out.camera.target, fov: out.camera.fov, width: DESKTOP.width, height: DESKTOP.height });
  const g = out.gaps[0], r = F.gapRect(lens, g, { left: 30, top: 50 });
  assert.ok(r && r.w > 0 && r.h > 0, "危墙投到屏幕上");
  const mid = L.project(lens, { x: g.x, y: g.topY, z: g.z });
  assert.ok(Math.abs(r.x - (mid.x + 30)) < 1 && r.top <= mid.y + 50 && r.top + r.h >= mid.y + 50, "矩形围着间隔的中点（加上战场在页面里的偏移）");
  assert.ok(Math.abs(r.left - (r.x - r.w / 2)) < 1e-9 && r.width === r.w && r.height === r.h, "两种写法都给（attack-fx 要中心 + 宽高，HitFx.burst 要 left / top / width / height）");
  // game.js：开着新画面时，演出的位置都问新画面（关着照旧量单位卡）
  const gs = read("game.js");
  assert.match(gs, /function field3dRect\(id\) \{\s*const b = HD2DField\.rectOf\(id\);/);
  assert.match(gs, /function boxOf\(id\) \{/);
  const hit = gs.slice(gs.indexOf("function hit(id, element, big, pop, from)"), gs.indexOf("/* ---------- 攻击演出（attack-fx.js）"));
  assert.equal((hit.match(/= boxOf\(id\) \|\| \(field3d\(\) \? null : (?:gn|c\.wrap)\.getBoundingClientRect\(\)\);/g) || []).length, 2, "受击粒子（单位、危墙）按 3D 的矩形；开着时找不到就不放，不落到看不见的旧卡片上");
  assert.equal((hit.match(/HitFx\.burst\(element \|\| "physical", (?:gbox|box), \{ big: !!big \}\)/g) || []).length, 2);
  // hd2d-field.js：适配器按这一刻的镜头投影铭牌 / 地台，偏移 = 战场在页面里的位置
  const fsrc = code(read("hd2d/hd2d-field.js"));
  assert.match(fsrc, /HD2DFx\.adapter\(\{ lens: \(\) => S\.sc\.lensNow\(\), plate: \(id\) => S\.sc\.plateOf\(id\), zone: \(id\) => S\.sc\.zoneOf\(id\), size: \(big\) => L\.plateSize\(S\.sc\.view\(\), big\), offset: \(\) => stage\.getBoundingClientRect\(\) \}\)/);
});

/* ---------- 5. 页面里走一遍（场景换成假的：WebGL 在 Node 里跑不了） ---------- */
/** 假网页：#g-app、#g-field、开关按钮，createElement 出来的元素能挂、能拆、量得到大小（战场那一格在页面里的 (100, 50)） */
function fakeDocFull() {
  const els = {};
  const make = (tag, id) => {
    const cls = new Set();
    const e = {
      tagName: String(tag).toUpperCase(), children: [], parentNode: null, attrs: {}, listeners: {}, hidden: false, textContent: "", title: "", type: "",
      style: { setProperty() {} }, offsetHeight: 30, clientWidth: 1100, clientHeight: 620,
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; if (v) cls.add(c); else cls.delete(c); return v; } },
      get className() { return [...cls].join(" "); },
      set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => cls.add(c)); },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, removeEventListener() {},
      appendChild(c) { if (c.parentNode) c.remove(); c.parentNode = this; this.children.push(c); return c; },
      append(...cs) { cs.forEach(c => this.appendChild(c)); },
      remove() { if (this.parentNode) { const k = this.parentNode.children; k.splice(k.indexOf(this), 1); this.parentNode = null; } },
      querySelector() { return null; },
      getBoundingClientRect() { return { left: 100, top: 50, width: 1100, height: 620 }; }
    };
    if (id) els[id] = e;
    return e;
  };
  make("button", "g-hd2d-toggle"); make("div", "g-app"); make("main", "g-field");
  return { els, doc: { getElementById: (id) => els[id] || null, createElement: (t) => make(t), head: make("head") } };
}
/** 假的场景：记下 hd2d-field.js 交给它的东西（布局、标记、行动的人、回调），镜头就用布局的默认镜头 */
function fakeScene(log) {
  return (stage, options) => {
    log.stage = stage; log.options = options;
    const sc = {
      portrait: false, motion: true, tier: "far", zone: null, flash: 0, layout: null,
      view: () => DESKTOP,
      setInsets: (i) => { log.insets = i; },
      setBattle: (layout, meta) => { log.layouts.push(layout); log.meta = meta; sc.layout = layout; },
      refit: () => { log.refits++; },
      setMarks: (m) => { log.marks = m; },
      setActor: (id) => { log.actor = id; },
      setWind: () => {}, setTier: () => {}, stepZone: () => {},
      lensNow: () => ({ pos: sc.layout.camera.pos, target: sc.layout.camera.target, fov: sc.layout.camera.fov, width: DESKTOP.width, height: DESKTOP.height }),
      plateOf: (id) => { const u = sc.layout.units.find(x => x.id === id); return u ? { x: u.x, y: u.y, z: u.z, lift: u.lift, big: false, zoom: 1 } : null; },
      zoneOf: (id) => sc.layout.zones.find(z => z.id === Number(id)) || null,
      dispose: () => { log.disposed = true; }
    };
    return sc;
  };
}

test("页面里走一遍（场景是假的）：记着开 → 3D 战场铺在 #g-field 里、旧战场藏起来；setView 的快照投影后排布局交给场景（没有坚毅生命）；谁在行动、选目标的标记、点铭牌 / 地台 / 危墙 / 空地、悬停铭牌都接到 GAME；演出的矩形按 3D 投影；关掉 → 拆干净、旧画面回来", async () => {
  const { ctx, st } = battle();
  ["hd2d/hd2d-layout.js", "hd2d/hd2d-camera.js", "hd2d/hd2d-fx.js", "hd2d/hd2d-field.js"].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const wx = [];
  ctx.HD2DWfx = { windOf: () => ({ x: 1, z: 0 }), create: () => ({ sync: (s) => wx.push(s), dispose() {} }) };   // 天气的 2D 层要真的网页，这里只看交给它什么
  const kolt = st.units.find(u => u.kit === "kolt"), foe = st.units.find(u => u.kit === "thug_hammer");
  const snaps = st.units.map(snapOf).concat(st.props.map(propSnap));
  const calls = [];
  ctx.GAME = {
    depth: 0, snapAll: () => snaps, refresh: () => calls.push(["refresh"]),
    fieldInput: { unit: (id) => calls.push(["unit", id]), hover: (id, on, el) => calls.push(["hover", id, on, el]), zone: (z) => calls.push(["zone", z]), zoneHover: (z, on) => calls.push(["zoneHover", z, on]) }
  };
  const F = ctx.HD2DField;
  F.actor(kolt.id);                                    // game.js 的 refreshHud 先告诉过它谁在行动
  const P = fakeDocFull(), mem = new Map([[F.FIELD.storageKey, "on"]]);
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); } };
  const log = { layouts: [], refits: 0 };
  F.boot({ doc: P.doc, storage, load: () => Promise.resolve(fakeScene(log)), hint: (m) => calls.push(["hint", m]), reduced: () => true });   // 关掉时直接切（云雾转场另在 tests/hd2d-mist.test.js）
  await settle(); await settle();
  const field = P.els["g-field"], app = P.els["g-app"];
  assert.equal(F.on(), true, "建好了");
  assert.equal(log.stage.parentNode, field, "3D 战场铺在 #g-field 里");
  assert.ok(log.stage.classList.contains("hd2d-field") && log.stage.classList.contains("hd2d-theme"));
  assert.ok(app.classList.contains("hd2d-on"), "#g-app 加 hd2d-on：旧战场藏起来");
  assert.equal(P.els["g-hd2d-toggle"].textContent, "新画面 开");
  assert.ok(log.layouts.length >= 1 && log.refits >= 1, "打开时排一次、镜头回到默认");
  assert.ok(calls.some(c => c[0] === "refresh"), "让 game.js 再画一遍（旧战场的天气叠加层拿掉、标记再走一遍）");
  const first = log.layouts[log.layouts.length - 1];
  noShp(first, "交给场景的布局");
  assert.equal(first.region, "第一采矿场");
  assert.equal(log.meta.theme, "dusk", "光影读投影");
  assert.equal(log.meta.actorId, kolt.id);
  assert.ok(first.units.some(u => u.id === "prop:boom1"), "配置物也有铭牌");
  assert.ok(log.insets && log.insets.bottom > 0, "取景让开右下角的镜头按钮");
  assert.ok(wx.length && wx[wx.length - 1].theme === "dusk", "天气的 2D 层读投影里的天气 / 光影");
  // setView 的一下：柯尔特还站在 1 区、敌人少了 3 点血（快照里的）——新画面跟着这一下排
  const mid = snaps.map(s => Object.assign({}, s, { layers: s.layers.map(l => Object.assign({}, l)) }));
  mid.find(s => s.id === kolt.id).zone = 1;
  const mf = mid.find(s => s.id === foe.id); mf.layers[0].cur -= 3;
  F.view(mid);
  const now = log.layouts[log.layouts.length - 1];
  assert.equal(now.units.find(u => u.id === kolt.id).zone, 1, "站位跟着那一下");
  assert.equal(now.units.find(u => u.id === foe.id).plate.hp.cur, mf.layers.reduce((a, l) => a + l.cur, 0), "血量跟着那一下");
  noShp(now, "演出途中的布局");
  // 谁在行动（敌人回合是 null）；同一个人再告诉一遍（refreshHud 叫得很勤）不再动镜头
  F.actor(null);
  assert.equal(log.actor, null);
  log.actor = "没再叫";
  F.actor(null);
  assert.equal(log.actor, "没再叫", "同一个人：不再叫场景（玩家挪去看别的区的镜头不会被拽回来）");
  // 选目标：能点的描边、别的变暗、停着的那个、能打的危墙
  F.marks({ pick: true, targets: [foe.id, "gap:2-3"], hover: foe.id, zones: [], hoverZone: null });
  assert.deepEqual([...log.marks.targets], [foe.id]);
  assert.ok(log.marks.dim.has(kolt.id) && !log.marks.dim.has(foe.id));
  assert.equal(log.marks.aim, foe.id);
  assert.deepEqual([...log.marks.gaps], ["2-3"]);
  F.marks({ pick: false, targets: [], zones: [2, 3], hoverZone: 2 });
  assert.deepEqual([...log.marks.zones], [2, 3]);
  assert.equal(log.marks.hoverZone, 2);
  // 点 / 悬停：交给 GAME.fieldInput（和旧画面同一套）
  calls.length = 0;
  log.options.onUnitClick(foe.id); log.options.onZoneClick(2); log.options.onGapClick("2-3"); log.options.onEmptyClick();
  log.options.onUnitHover(foe.id, true, "铭牌"); log.options.onZoneHover(3, true);
  assert.deepEqual(calls, [["unit", foe.id], ["zone", 2], ["unit", "gap:2-3"], ["zone", null], ["hover", foe.id, true, "铭牌"], ["zoneHover", 3, true]]);
  // 演出的矩形：铭牌按这一刻的镜头投影，加上战场在页面里的位置
  const FXM = ctx.HD2DFx, lens = FXM.lens({ pos: now.camera.pos, target: now.camera.target, fov: now.camera.fov, width: DESKTOP.width, height: DESKTOP.height });
  const fu = now.units.find(u => u.id === foe.id), want = FXM.rectOf(lens, { x: fu.x, y: fu.y, z: fu.z, lift: fu.lift }, ctx.HD2DLayout.plateSize(DESKTOP, false));
  const got = F.rectOf(foe.id);
  assert.ok(got && Math.abs(got.x - (want.x + 100)) < 1e-6 && Math.abs(got.y - (want.y + 50)) < 1e-6, "铭牌的矩形");
  const gr = F.rectOf("gap:2-3");
  assert.ok(gr && gr.w > 0 && gr.left >= 100, "危墙的矩形");
  assert.ok(F.zoneRectOf(2), "地台的外框");
  // 关掉：拆干净，旧画面回来，记成关
  calls.length = 0;
  P.els["g-hd2d-toggle"].listeners.click[0]({});
  assert.equal(F.on(), false);
  assert.ok(log.disposed, "场景释放掉（WebGL）");
  assert.equal(log.stage.parentNode, null, "3D 战场从 #g-field 里拿掉");
  assert.ok(!app.classList.contains("hd2d-on"), "旧战场露出来");
  assert.equal(mem.get(F.FIELD.storageKey), "off");
  assert.ok(calls.some(c => c[0] === "refresh"), "game.js 再画一遍旧战场（天气叠加层放回去）");
  assert.equal(F.rectOf(foe.id), null, "关着：演出照旧量单位卡");
  assert.equal(P.els["g-hd2d-toggle"].textContent, "新画面 关");
});

/* ---------- 6. 每次刷新都会排一次：重的东西不跟着重建 ---------- */
let threeHooked = false;
/** 在 Node 里用 vendor 的真 three.js import 天气模块（和 tests/hd2d-layout.test.js 的 protoEnv 一样的做法）；canvas 用什么都接受的假的 */
async function weatherEnv(t) {
  const mod = require("node:module"), { pathToFileURL } = require("url");
  if (typeof mod.register !== "function") { t.skip("这个 Node 版本没有 module.register"); return null; }
  const threeUrl = pathToFileURL(path.join(HP.ROOT, "vendor", "three", "three.module.min.js")).href;
  if (!threeHooked) {
    threeHooked = true;
    mod.register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
      if (s === "three") return { url: ${JSON.stringify(threeUrl)}, format: "module", shortCircuit: true };
      const r = await n(s, c);
      return /\\/(hd2d|vendor\\/three)\\//.test(r.url) ? Object.assign({}, r, { format: "module" }) : r;
    }`));
  }
  const any = () => new Proxy(function () {}, { get: (o, k) => (k === Symbol.toPrimitive ? () => 0 : any()), set: () => true, apply: () => any() });
  const keep = { document: globalThis.document, window: globalThis.window };
  globalThis.document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => any() }) };
  globalThis.window = { HD2DLayout: L };
  const restore = () => {
    globalThis.document = keep.document; globalThis.window = keep.window;
    if (keep.document === undefined) delete globalThis.document;
    if (keep.window === undefined) delete globalThis.window;
  };
  try {
    const THREE = await import(threeUrl), WX = await import(pathToFileURL(HP.mod("hd2d-weather.js")).href);
    return { THREE, WX, restore };
  } catch (e) { restore(); throw e; }
}

test("正式画面每刷新一次（演出的每一下）都会交一次布局给场景：天气粒子、天空贴图不跟着重建（setBounds 会把粒子整个重新撒，所以场景先比一比范围 / 镜头 / 远景）", async (t) => {
  const P = await weatherEnv(t);
  if (!P) return;
  const { THREE, WX } = P;
  try {
    const scene = new THREE.Scene(), out = L.build({ zoneMode: 3, units: [], fields: {}, gaps: {} }, { view: DESKTOP });
    const fx = WX.createWeather(scene, { bounds: out.bounds });
    fx.set("sand", "day");
    const before = new Set(scene.children);
    fx.set("sand", "day");
    assert.ok(scene.children.every(o => before.has(o)), "同一种天气再设一次：不重建（天气模块自己就比过）");
    fx.setBounds(out.bounds, { camera: out.camera });
    assert.ok(scene.children.some(o => !before.has(o)), "setBounds：粒子整个重建");
  } finally { P.restore(); }
  // 所以场景：范围 / 默认镜头 / 远景都没变就不叫 setBounds；光影主题、场景的光照、天气、地面都没变就不重画天空、不重设灯光调色
  const set = code(read("hd2d/hd2d-scene.js"));
  const body = set.slice(set.indexOf("function setBattle("), set.indexOf("const backdropOf"));
  assert.match(body, /if \(wsig !== state\.weatherSig\) \{ state\.weatherSig = wsig; weather\.setBounds\(layout\.bounds, \{ camera: layout\.camera, farPoint: state\.backdrop\.farPoint \}\); \}/);
  assert.match(body, /wsig = \[Object\.values\(layout\.bounds\)[^\n]*c\.dist, c\.pos\.x, c\.pos\.y, c\.pos\.z[^\n]*state\.backdropSig\]\.join\("\|"\);/, "签名里有范围、默认镜头、远景");
  assert.match(body, /if \(tsig !== state\.themeSig\) \{ state\.themeSig = tsig; applyTheme\(\); \}/);
  assert.match(body, /const tsig = \[state\.meta\.theme, state\.lit \? "lit" : "", fx, layout\.ground \|\| ""\]\.join\("\|"\);/);
  assert.equal((body.match(/weather\.setBounds\(/g) || []).length, 1);
  assert.equal((body.match(/applyTheme\(\)/g) || []).length, 1);
});

/* ---------- 7. 原型页 ---------- */
test("原型页的模块路径改了以后照样能加载：页面引用的文件都在、模块只有 hd2d/ 那一份；场景模块里的相对 import 在 hd2d/ 里找得到；假网页照页面顺序加载 0 个报错", () => {
  const html = HP.readPage("index.html");
  const refs = [...html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)].map(m => m[1]).filter(f => !/^(https?:|data:)/.test(f));
  assert.ok(refs.length > 50);
  refs.forEach(f => assert.ok(fs.existsSync(path.resolve(HP.PAGE, f)), "原型页引用的文件不存在：" + f));
  const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];
  [...mod.matchAll(/from "([^"]+)"/g)].forEach(m => assert.ok(fs.existsSync(path.resolve(HP.PAGE, m[1])), "页面主脚本 import 的不存在：" + m[1]));
  const imap = JSON.parse(/<script type="importmap">([^<]*)<\/script>/.exec(html)[1]).imports;
  Object.values(imap).forEach(f => assert.ok(fs.existsSync(path.resolve(HP.PAGE, f)), f));
  fs.readdirSync(HP.MOD).filter(f => /^hd2d-.*\.js$|^hd2d\.css$/.test(f)).forEach(f => assert.ok(!fs.existsSync(path.join(HP.PAGE, f)), "原型目录里又有一份 " + f));
  ["hd2d-scene.js", "hd2d-world.js", "hd2d-backdrop.js", "hd2d-weather.js"].forEach(f => {
    [...HP.readMod(f).matchAll(/^import [^;]*? from "(\.[^"]+)";/gm)].forEach(m => assert.ok(fs.existsSync(path.resolve(HP.MOD, m[1])), f + " import 的 " + m[1]));
  });
  const page = require("./hd2d-fake-page").load();
  assert.deepEqual(page.errors, []);
  ["HD2DLayout", "HD2DCamera", "HD2DUI", "HD2DSceneArt", "HD2DWfx", "HD2DFx", "HD2DPlay", "HD2DHost", "OnlineView", "WeatherFx"].forEach(k => assert.ok(page.ctx[k], k + " 加载了"));
});
