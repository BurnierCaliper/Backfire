// 新画面的「沙下动静 ×N」（#358）：下潜中的中立生物（夜晚迁徙的尘虫）不画卡、不占站位，每个区合成一块标记——和旧画面 game.js · paintSandStir 对齐：
//   · 投影（online-view.js · projectUnit）：规则单位身上没有 neutral，主机按 isNeutralCreature 算好发过去，另带 leaveIn、neutralTags（失衡 / 摊平 / 已发现）；不带坚毅生命
//   · 布局（hd2d-layout.js · build / stirOf）：neutral && submerged 不进 units，每个区一份 stirs（每只的名字、血量百分比、已被发现、几回合后离开，地台前沿两个角的 3D 锚点）；
//     埋伏的沙鱼（白天下潜）不是中立生物，照旧画卡（旧画面也只折叠 neutral && submerged）
//   · 新画面（hd2d-field.js）：3D 战场这一层里一个区一块标记，每一帧按镜头投影摆位；点开是同样的列表，点一行 = 点那只的单位卡（单机 GAME.fieldInput.unit，
//     联机旧战场的回调），选目标时能选的那一行亮起来；浮上来一只 → 它变回一张卡（演出中亮个相，#330），标记 ×N 少一只；全部离开就拿掉
// 都在 Node 里跑：小 DOM（tests/mini-dom.js）+ 假的 3D 场景（照真场景摆白卡），规则用 tests/headless.js。WebGL 画面、截图由仓库主人看。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("./headless");
const HP = require("./hd2d-paths");
const MD = require("./mini-dom");
const L = require("../hd2d/hd2d-layout.js");
const F0 = require("../hd2d/hd2d-field.js");

const read = (f) => fs.readFileSync(path.join(HP.ROOT, f), "utf8");
const PARTY = ["kolt", "helu"];
const DESKTOP = { width: 1100, height: 620, top: 0, bottom: 40 };
const SHP = 7771, SHP_MAX = 7772;
const settle = async (n) => { for (let i = 0; i < (n || 6); i++) await new Promise(r => setImmediate(r)); };
const last = (a) => a[a.length - 1];
const plain = (v) => JSON.parse(JSON.stringify(v));

/** 规则环境里一场夜晚的沙漠战斗：1 区三只尘虫（夜晚下潜迁徙），2 区一条赶潮沙鱼 + 一条伏咬沙鱼（开场就在沙下，不是中立生物）。
 *  第一只尘虫被声呐发现了；每个人塞上特殊的坚毅生命数（新加的东西里不该出现） */
function battle() {
  const ctx = H.load();
  vm.runInContext(read("online-view.js"), ctx, { filename: "online-view.js" });
  const st = ctx.BattleSim.setup({
    party: PARTY, zoneMode: 2, seed: "hd2d-stir", region: "沙漠", light: "night",
    enemies: [{ id: "sandfish_drive", lv: 3, zone: 2 }, { id: "sandfish_ambush", lv: 3, zone: 2 },
      { id: "dust_bug", lv: 3, zone: 1 }, { id: "dust_bug", lv: 3, zone: 1 }, { id: "dust_bug", lv: 3, zone: 1 }]
  });
  ctx.LEDGER.clock = 22 * 60;   // 夜晚：尘虫下潜迁徙（desert.js · desertBattleStart）
  ctx.startCombat();
  st.units.forEach(u => { u.shp = SHP; u.shpMax = SHP_MAX; u.baseShp = SHP; u.shpBase = SHP; u.shpBonus = SHP_MAX; });
  const bugs = st.units.filter(u => u.kit === "dust_bug");
  bugs[0].detected = true;
  return { ctx, st, OV: ctx.OnlineView, bugs, unit: (kit) => st.units.find(u => u.kit === kit), pv: () => ctx.OnlineView.projectState(st, {}) };
}
function noShp(text, tag) {
  assert.ok(!text.includes(String(SHP)) && !text.includes(String(SHP_MAX)), tag + "：出现了坚毅生命的数字");
  assert.doesNotMatch(text, /坚毅生命|shpMax|shpBase|shpBonus|"shp"/, tag + "：出现了坚毅生命的字段");
}

/* ---------- 1. 投影、布局（纯函数）---------- */
test("投影：下潜的尘虫带上 neutral、leaveIn、neutralTags（已发现）——规则单位身上没有 neutral，主机按 isNeutralCreature 算；不是中立生物的不带；没有坚毅生命", () => {
  const R = battle(), pv = R.pv();
  assert.ok(R.bugs.every(b => b.submerged && b.leaveIn >= 2) && !("neutral" in R.bugs[0]), "规则：夜晚的尘虫在沙下、几回合后离开，身上没有 neutral 字段");
  const bugs = pv.units.filter(u => u.kit === "dust_bug");
  assert.equal(bugs.length, 3);
  bugs.forEach((u, i) => {
    assert.equal(u.neutral, true, "主机算好的：是中立生物");
    assert.equal(u.submerged, true);
    assert.equal(u.leaveIn, R.bugs[i].leaveIn, "几回合后离开");
    assert.deepEqual(plain(u.neutralTags), i === 0 ? [{ key: "seen", text: "已发现" }] : [], "小标签：被声呐发现的那只写「已发现」");
  });
  const amb = pv.units.find(u => u.kit === "sandfish_ambush");
  assert.equal(amb.submerged, true, "伏咬沙鱼开场就在沙下");
  assert.ok(!amb.neutral && !("leaveIn" in amb) && !("neutralTags" in amb), "沙鱼不是中立生物：不带这几样");
  // 失衡 / 摊平也照旧画面的字；演出快照（game.js · snapUnit）带来的 neutralTags 只认表里的键，字用投影自己的
  R.bugs[1].stunned = true; R.bugs[1].resources = Object.assign({}, R.bugs[1].resources, { flattened: true });
  assert.deepEqual(plain(R.OV.projectUnit(R.bugs[1]).neutralTags), [{ key: "stun", text: "失衡" }, { key: "flat", text: "摊平" }]);
  const snap = { id: "s1", name: "尘虫", neutral: true, submerged: true, leaveIn: 2, neutralTags: [{ key: "seen", text: "<b>坚毅生命 7771</b>" }, { key: "evil", text: "x" }] };
  assert.deepEqual(plain(R.OV.projectUnit(snap).neutralTags), [{ key: "seen", text: "已发现" }], "快照的字不照抄");
  assert.equal(R.OV.projectUnit(Object.assign({}, snap, { neutral: false })).neutralTags, undefined, "快照说不是中立生物就不算");
  noShp(JSON.stringify(pv), "投影");
});

test("布局：下潜的中立生物不进站位，一个区一份 stirs（×3：名字、血量百分比、已被发现、几回合后离开，地台前沿两个角）；伏咬沙鱼照旧画卡；浮上来一只 → 1 张卡 + ×2；旧画面也只折叠 neutral && submerged", () => {
  const R = battle(), ids = R.bugs.map(b => b.id);
  const out = L.build(R.pv(), { view: DESKTOP });
  assert.ok(!out.units.some(u => ids.includes(u.id)), "尘虫不画卡、不占站位");
  const amb = out.units.find(u => u.id === R.unit("sandfish_ambush").id);
  assert.ok(amb && amb.submerged && amb.y < amb.groundY, "伏咬沙鱼（不是中立生物）照旧是一张沉下去的卡");
  assert.equal(out.stirs.length, 1, "一个区一块");
  const s = out.stirs[0], z1 = out.zones.find(z => z.id === 1);
  assert.equal(s.zone, 1);
  assert.equal(s.count, 3);
  assert.equal(s.names, "尘虫");
  assert.deepEqual(s.units.map(u => u.id), ids, "照场上的顺序");
  assert.deepEqual(s.units.map(u => [u.name, u.seen, u.leaveIn]), R.bugs.map((b, i) => ["尘虫", i === 0, b.leaveIn]));
  assert.ok(s.units.every(u => u.pct === 100), "满血");
  // 锚点：地台前沿（朝镜头那条边）的顶面上，左角、右角各往里让一点（地台的角削掉了一块）
  assert.deepEqual(s.anchors.map(a => a.side), ["left", "right"]);
  s.anchors.forEach(a => { assert.equal(a.y, z1.topY); assert.equal(a.z, z1.cz + z1.d / 2); });
  assert.equal(s.anchors[0].x, z1.cx - z1.w / 2 + L.CONFIG.stir.inset);
  assert.equal(s.anchors[1].x, z1.cx + z1.w / 2 - L.CONFIG.stir.inset);
  noShp(JSON.stringify(out.stirs), "stirs");
  // 掉了血：血条按投影里的血量层（看得见的血），不是坚毅生命
  R.bugs[2].layers.forEach(l => { l.current = Math.floor(l.max / 2); });
  const half = L.build(R.pv(), { view: DESKTOP }).stirs[0].units[2];
  const want = Math.round(R.bugs[2].layers.reduce((a, l) => a + l.current, 0) / R.bugs[2].layers.reduce((a, l) => a + l.max, 0) * 100);
  assert.equal(half.pct, want);
  // 浮上来一只（被谐波打出来）：变回一张卡（中立生物用迷你名牌的尺寸），标记 ×2；全部离开 / 死掉：没有标记
  R.bugs[1].submerged = false;
  const up = L.build(R.pv(), { view: DESKTOP, cards: new Map([[R.bugs[1].id, { id: R.bugs[1].id, neutral: true }]]) });
  assert.equal(up.units.filter(u => ids.includes(u.id)).length, 1, "浮上来的那只有卡");
  assert.deepEqual(up.units.find(u => u.id === R.bugs[1].id).size, { w: L.CONFIG.card.mini.w, h: L.CONFIG.card.mini.h });
  assert.equal(up.stirs[0].count, 2);
  R.bugs[0]._removed = true; R.bugs[0].submerged = false; R.bugs[2].dead = true;
  assert.deepEqual(L.build(R.pv(), { view: DESKTOP }).stirs, [], "离开的、死掉的不算");
  // 布局读的单位字段都在 projectUnit 的白名单里（同 tests/hd2d-ui.test.js 的查法）
  const src = read("online-view.js"), body = src.slice(src.indexOf("function projectUnit("), src.indexOf("function projectHud("));
  const allowed = new Set();
  const first = /identifiers\(unit, \{\}, \[([^\]]*)\]\)/.exec(body), copy = /copyFields\(unit, out, \[([^\]]*)\], \[([^\]]*)\], \[([^\]]*)\]\)/.exec(body);
  [first[1], copy[1], copy[2], copy[3]].forEach(list => [...list.matchAll(/"(\w+)"/g)].forEach(m => allowed.add(m[1])));
  [...body.matchAll(/\bout\.(\w+)\s*=/g)].forEach(m => allowed.add(m[1]));
  const lay = read("hd2d/hd2d-layout.js"), fn = lay.slice(lay.indexOf("function stirOf("), lay.indexOf("\n  }\n", lay.indexOf("function stirOf(")));
  const used = new Set([...fn.matchAll(/\bu\.(\w+)/g)].map(m => m[1]).concat(["neutral", "submerged"]));
  used.forEach(f => assert.ok(allowed.has(f), `stirOf 读了白名单里没有的字段 u.${f}`));
  // 旧画面：只折叠 neutral && submerged（埋伏的沙鱼这些照旧画卡）
  const g = read("game.js");
  assert.match(g, /if \(s\.hidden \|\| \(s\.neutral && s\.submerged && !s\.dead\)\) \{   \/\/ 下潜的中立生物：不画名牌/);
  assert.match(g, /const list = snaps\.filter\(s => s\.neutral && s\.submerged && !s\.dead && !s\.hidden && Number\(s\.zone\) === zone\);/);
});

test("标记里写什么、摆在哪（纯函数）：同旧画面的字（沙纹图标、×N、名字迁徙中 · 点开看看；每只一行、底下一句说明）；挂在左角下面、压到卡换右角、左角不在画面里换右角、都不在画面里藏起来、收在界面里面", () => {
  const R = battle(), out = L.build(R.pv(), { view: DESKTOP }), s = out.stirs[0];
  const html = F0.stirHtml(s);
  assert.ok(html.includes(F0.FIELD.stir.icon), "沙纹图标");
  const g = read("game.js"), icon = /const STIR_ICON = `([^`]*)`;/.exec(g);
  assert.ok(icon && icon[1] === F0.FIELD.stir.icon, "和旧画面 game.js 的 STIR_ICON 同一个");
  assert.match(html, /沙下动静 ×3<small>尘虫迁徙中 · 点开看看<\/small>/);
  assert.match(html, /<h4>沙下动静 · 1 区（3 只尘虫）<\/h4>/);
  assert.equal((html.match(/data-stir-id="/g) || []).length, 3, "每只一行");
  assert.equal((html.match(/<em>已被发现<\/em>/g) || []).length, 1, "被发现的那只");
  R.bugs.forEach(b => assert.ok(html.includes(`data-stir-id="${b.id}"`)));
  assert.ok(html.includes(`<small>${R.bugs[1].leaveIn} 回合后离开</small>`));
  assert.match(F0.stirHtml(Object.assign({}, s, { units: [Object.assign({}, s.units[0], { leaveIn: null })] })), /<small>在沙下<\/small>/, "没有离开的回合数：在沙下");
  assert.match(html, /<footer>下潜中：只有谐波攻击和塌陷打得到。沙鱼发现后会去吃。<\/footer>/);
  assert.match(F0.stirHtml(Object.assign({}, s, { names: "<img src=x onerror=1>" })), /&lt;img src=x onerror=1&gt;/, "字都转义");
  noShp(html, "标记");
  // 摆位
  const lens = Object.assign({}, out.camera), box = { x0: 0, x1: DESKTOP.width, y0: DESKTOP.top, y1: DESKTOP.height - DESKTOP.bottom }, size = { w: 176, h: 42 }, K = F0.FIELD.stir;
  const pl = L.project(lens, s.anchors[0]), pr = L.project(lens, s.anchors[1]);
  const a = F0.stirSpot(s, lens, box, size, []);
  assert.deepEqual(a, { x: Math.round(Math.max(K.edge, pl.x)), y: Math.round(Math.min(pl.y + K.drop, box.y1 - K.edge - size.h)), side: "left" }, "挂在左角下面（往右伸）");
  // 同一个区的卡都站在地台上面：卡的下沿在标记上沿的上面（压不到）
  out.units.filter(u => u.zone === 1).forEach(u => assert.ok(u.rect.y1 <= pl.y + K.drop, "卡在标记上面"));
  const block = { x0: a.x - 5, x1: a.x + 20, y0: a.y - 5, y1: a.y + 20 };
  assert.equal(F0.stirSpot(s, lens, box, size, [block]).side, "right", "左角压到卡：换右角（往左伸）");
  assert.equal(F0.stirSpot(s, lens, box, size, [block]).x, Math.round(pr.x - size.w));
  assert.equal(F0.stirSpot(s, lens, box, size, [{ x0: -1e4, x1: 1e4, y0: -1e4, y1: 1e4 }]).side, "left", "都压卡：照旧用左角（标记在铭牌下面，不挡卡）");
  const shifted = Object.assign({}, s, { anchors: [Object.assign({}, s.anchors[0], { x: s.anchors[0].x - 60 }), s.anchors[1]] });
  assert.equal(F0.stirSpot(shifted, lens, box, size, []).side, "right", "左角不在画面里：换右角");
  const gone = Object.assign({}, s, { anchors: s.anchors.map(q => Object.assign({}, q, { x: q.x + 500 })) });
  assert.equal(F0.stirSpot(gone, lens, box, size, []), null, "两个角都不在画面里：藏起来");
  const tight = F0.stirSpot(s, lens, { x0: 300, x1: 900, y0: 0, y1: pl.y + 10 }, size, []);
  assert.deepEqual([tight.x, tight.y], [300 + K.edge, Math.round(pl.y + 10 - K.edge - size.h)], "收在让开界面以后的那一块里，不出画");
});

/* ---------- 2. 单机：game.js → hd2d-field.js ---------- */
/** 假的 3D 场景：照真场景（hd2d-scene.js · syncPlates / syncCard）在 .hd2d-labels 里摆铭牌和白卡（UnitCard 画），记下交给它的布局 */
function fakeScene(P) {
  return (stage, options) => {
    const doc = P.doc, UC = P.UC;
    const labels = doc.createElement("div");
    labels.className = "hd2d-labels";
    stage.appendChild(labels);
    const plates = new Map();
    const sc = {
      portrait: false, motion: true, tier: "far", zone: null, flash: 0, layout: null, options, marks: [],
      view: () => DESKTOP,
      setInsets() {}, refit() {}, setMarks(m) { sc.marks.push(m); }, setActor() {}, setWind() {}, setTier() {}, stepZone() {},
      setBattle(layout) {
        sc.layout = layout;
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
      zoneFx: () => true,
      poseNow: () => Object.assign(P.w.HD2DCamera.pose(sc.layout, "far", null, {}), { tier: "far" }),
      posePush() {}, poseRelease() {},
      dispose() { sc.disposed = true; }
    };
    P.scenes.push(sc);
    return sc;
  };
}
/** 小 DOM 的页面（单机 #g-app > #g-field；联机玩家另有 .ol-battle 的战场）+ 那一场战斗；hd2d 的几个普通脚本、单位卡、联机的单位卡快照都加载好，hd2d-field.js 等测试自己 boot */
function page() {
  const R = battle();
  const MDP = MD.create('<div id="g-app" class="g-app"><main id="g-field" class="g-field"></main></div><div class="ol-battle"><main class="g-field ol-field"></main></div>');
  const w = MDP.window, doc = MDP.document, ctx = vm.createContext(w);
  ["icons.js", "hud-icons.js", "unit-card.js", "online-battle.js", "hd2d/hd2d-layout.js", "hd2d/hd2d-camera.js", "hd2d/hd2d-fx.js", "hd2d/hd2d-play.js"]
    .forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  doc.readyState = "loading";   // hd2d-field.js 别自己 boot（下面换上假的场景再 boot）
  vm.runInContext(read("hd2d/hd2d-field.js"), ctx, { filename: "hd2d/hd2d-field.js" });
  Object.defineProperty(w.Element.prototype, "clientWidth", { configurable: true, get() { return this.classList && this.classList.contains("hd2d-field") ? DESKTOP.width : 0; } });
  // 标记在屏幕上的矩形（攻击演出落在它上面）：按摆好的位置和估的大小；别的元素照旧是 0
  const rect0 = w.Element.prototype.getBoundingClientRect;
  w.Element.prototype.getBoundingClientRect = function () {
    if (!this.classList.contains("hd2d-stir")) return rect0.call(this);
    const x = parseFloat(this.style.left) || 0, y = parseFloat(this.style.top) || 0, S = 1;
    return { left: x, top: y, width: 176 * S, height: 42 * S, right: x + 176, bottom: y + 42, x, y };
  };
  w.HD2DWfx = { windOf: () => ({ x: 1, z: 0 }), create: () => ({ sync() {}, dispose() {} }) };
  w.AttackFx = { after: () => Promise.resolve(), impact() {}, area() {}, clash() {}, sparks() {}, link: () => Promise.resolve(), ko() {}, setClock() {}, skip() {} };
  w.state = R.st;
  w.OnlineView = R.OV;
  const log = { units: [], hovers: [] }, timers = [], scenes = [];
  /** game.js · setView 给新画面的快照（照 game.js · snapUnit：单位卡那一份 + 中立生物的 neutral / submerged / leaveIn / neutralTags） */
  const snaps = () => R.pv().units.map(pu => {
    const u = R.st.units.find(x => x.id === pu.id), neutral = R.ctx.isNeutralCreature(u);
    return Object.assign(w.OnlineBattle.snapUnit(pu), { neutral, submerged: !!u.submerged, leaveIn: u.leaveIn != null ? Number(u.leaveIn) : null,
      neutralTags: neutral ? [u.stunned ? { key: "stun", text: "失衡" } : null, u.detected ? { key: "seen", text: "已发现" } : null].filter(Boolean) : [] });
  });
  w.GAME = { depth: 0, koHold: 0, fxClock: () => 1, snapAll: () => snaps(), refresh() {},
    fieldInput: { unit: (id) => log.units.push(id), hover: (id, on, el) => log.hovers.push([id, on, el]), zone() {}, zoneHover() {} } };
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  const P = { R, w, doc, ctx, F: w.HD2DField, UC: w.UnitCard, OB: w.OnlineBattle, log, timers, scenes, snaps, mem, storage, Event: MD.Event };
  P.boot = (on) => { mem.set(P.F.FIELD.storageKey, on ? "on" : "off"); P.F.boot({ doc, storage, load: () => Promise.resolve(fakeScene(P)), hint() {}, reduced: () => true, wait: (s, fn) => timers.push({ s, fn }) }); };
  P.scene = () => last(scenes);
  P.card = (id) => [...doc.querySelectorAll(".hd2d-labels .unit-wrap")].find(x => String(x.dataset.id) === String(id)) || null;
  P.stirs = (root) => [...(root || doc).querySelectorAll(".hd2d-stir")];
  P.rows = (n) => [...n.querySelectorAll("[data-stir-id]")];
  return P;
}

test("单机：一个区里 3 只下潜的尘虫 → 新画面没有它们的卡，地台的一角一块「沙下动静 ×3」；点开列表三行；点一行 = 点单位卡（GAME.fieldInput.unit）；选目标时那一行亮起来；浮上来一只 → 1 张卡（亮个相）+ ×2；全部离开就拿掉", async () => {
  const P = page(), ids = [...P.R.bugs].map(b => b.id);   // 规则环境里的数组换成这边的（deepEqual 比原型）
  P.boot(true);
  await settle();
  assert.equal(P.F.on(), true, "新画面建好了");
  P.F.view(P.snaps(), { animate: false });
  const sc = P.scene();
  assert.ok(!sc.layout.units.some(u => ids.includes(u.id)), "交给场景的布局里没有它们");
  ids.forEach(id => assert.equal(P.card(id), null, "没有它们的白卡"));
  assert.ok(P.card(P.R.unit("sandfish_ambush").id), "伏咬沙鱼（下潜，但不是中立生物）照旧有卡");
  // 一个区一块标记，在 3D 战场这一层里、摆好了位置
  const stage = P.doc.querySelector(".hd2d-field");
  assert.equal(P.stirs().length, 1);
  const n = P.stirs()[0];
  assert.equal(n.parentNode.parentNode, stage, "挂在 3D 战场那一层里（.hd2d-stirs）");
  assert.equal(n.dataset.zone, "1");
  assert.match(n.textContent, /沙下动静 ×3尘虫迁徙中 · 点开看看/);
  assert.equal(n.hidden, false);
  const s = sc.layout.stirs[0], spot = P.F.stirSpot(s, P.w.HD2DFx.lens(sc.lensNow()), { x0: 0, x1: DESKTOP.width, y0: 0, y1: DESKTOP.height - 12 }, P.F.FIELD.stir.size, []);
  assert.deepEqual([n.style.left, n.style.top], [spot.x + "px", spot.y + "px"], "按这一刻的镜头摆到地台前沿的左角下面");
  const W = P.F.FIELD.stir.size;
  assert.ok(spot.x >= 0 && spot.x + W.w <= DESKTOP.width && spot.y >= 0 && spot.y + W.h <= DESKTOP.height, "不出画");
  sc.layout.units.forEach(u => assert.ok(u.rect.y1 <= spot.y || u.rect.x1 <= spot.x || u.rect.x0 >= spot.x + W.w, `白卡（${u.id}）不压在标记上`));
  noShp(n.outerHTML, "标记的 DOM");
  // 点开：列表三行（名字、血条、已被发现、几回合后离开）
  const b = n.querySelector(".hd2d-stir-b");
  assert.equal(n.classList.contains("open"), false);
  b.click();
  assert.equal(n.classList.contains("open"), true, "点开");
  assert.equal(b.getAttribute("aria-expanded"), "true");
  const rows = P.rows(n);
  assert.deepEqual(rows.map(r => r.dataset.stirId), ids, "每只一行");
  assert.ok(rows[0].textContent.includes("已被发现") && !rows[1].textContent.includes("已被发现"));
  assert.ok(rows[1].textContent.includes(P.R.bugs[1].leaveIn + " 回合后离开"));
  // 点一行 = 点那只的单位卡；悬停一行 = 悬停单位卡（说明挂在这一行上）
  rows[1].click();
  assert.deepEqual(P.log.units, [ids[1]], "走 GAME.fieldInput.unit（和点卡片同一个入口）");
  assert.equal(n.classList.contains("open"), true, "点完列表照旧开着（同旧画面）");
  rows[2].dispatchEvent(new P.Event("pointerover", { bubbles: true }));
  assert.deepEqual(P.log.hovers.map(h => [h[0], h[1]]), [[ids[2], true]]);
  assert.equal(last(P.log.hovers)[2], rows[2], "悬停说明挂在这一行上");
  rows[2].dispatchEvent(new P.Event("pointerout", { bubbles: true, relatedTarget: null }));
  assert.deepEqual(last(P.log.hovers).slice(0, 2), [ids[2], false]);
  // 选目标（谐波攻击能打沙下的）：能选的那一行亮起来、写「可选」，标记也亮；鼠标停着的那一行更亮
  const foe = P.R.unit("sandfish_drive").id;
  P.F.marks({ pick: true, targets: [ids[0], ids[2], foe] });
  assert.deepEqual(P.rows(n).map(r => r.classList.contains("is-targetable")), [true, false, true]);
  assert.ok(n.classList.contains("pick"), "标记本身也亮");
  assert.ok(!last(sc.marks).targets.has(ids[0]), "场景的标记里没有它们（没有卡）");
  P.F.marks({ pick: true, targets: [ids[0], ids[2], foe], hover: ids[2] });
  assert.deepEqual(P.rows(n).map(r => r.classList.contains("is-hover")), [false, false, true]);
  P.F.marks({ pick: false, targets: [] });
  assert.ok(!n.classList.contains("pick") && !P.rows(n).some(r => r.classList.contains("is-targetable")), "选完了：都暗回去");
  // 攻击演出、伤害数字落在标记上（这只没有卡）
  const r = P.F.rectOf(ids[0]);
  assert.ok(r && r.x === parseFloat(n.style.left) + 88 && r.width === 176, "rectOf：标记在屏幕上的位置");
  // 浮上来一只（被谐波打出来）：演出中这一下它变回一张卡、亮个相（#330），标记 ×2；开着的列表还开着
  P.R.bugs[1].submerged = false;
  P.F.view(P.snaps(), { animate: true });
  assert.equal(P.stirs().length, 1);
  assert.equal(P.stirs()[0], n, "还是那一块（开着的列表不收起）");
  assert.match(n.textContent, /沙下动静 ×2/);
  assert.deepEqual(P.rows(n).map(x => x.dataset.stirId), [ids[0], ids[2]]);
  assert.equal(P.scene().layout.units.filter(u => ids.includes(u.id)).length, 1, "1 张卡");
  const up = P.card(ids[1]);
  assert.ok(up, "浮上来的那只有卡");
  assert.ok(up.classList.contains("enter"), "亮个相（#330）");
  assert.ok(up.querySelector(".unit.mini"), "中立生物的迷你名牌");
  assert.notEqual(P.F.rectOf(ids[1]), null, "浮上来的那只：位置问它的卡");
  // 在沙下被沙鱼吃掉的（不浮上来）：没有卡、不留着淡出，标记少一只
  P.F.ko(ids[2], { hold: true });
  P.R.bugs[2].dead = true;
  P.F.view(P.snaps(), { animate: true });
  assert.equal(P.card(ids[2]), null, "没有卡");
  assert.match(n.textContent, /沙下动静 ×1/);
  // 全部离开（钻进沙漠深处）：拿掉标记
  P.R.bugs[0]._removed = true; P.R.bugs[0].submerged = false;
  P.F.view(P.snaps(), { animate: true });
  assert.equal(P.stirs().length, 0, "全部离开 / 死掉：拿掉");
  assert.equal(P.doc.querySelector(".hd2d-stirs"), null);
});

test("单机：中景 / 近景跟着镜头走（锚点换成这一刻的镜头投影；近景里别的区淡一截）；关掉新画面拆干净；hd2d-field.js 只读画面那一份，没碰 3D 场景包", async () => {
  const P = page();
  P.boot(true);
  await settle();
  P.F.view(P.snaps(), { animate: false });
  const sc = P.scene(), n = P.stirs()[0], far = [n.style.left, n.style.top];
  // 点开的弹层：上面放不下就往下开，往右伸出画面就右对齐（弹层的大小开的时候量一次）
  const pop = { w: 230, h: 120 }, EP = P.w.Element.prototype, keep = ["offsetWidth", "offsetHeight"].map(k => [k, Object.getOwnPropertyDescriptor(EP, k)]);
  keep.forEach(([k]) => Object.defineProperty(EP, k, { configurable: true,
    get() { return this.classList && this.classList.contains("hd2d-stir-pop") ? (k === "offsetWidth" ? pop.w : pop.h) : 0; } }));
  try {
    const b = n.querySelector(".hd2d-stir-b");
    b.click();
    assert.ok(n.classList.contains("open") && !n.classList.contains("down") && !n.classList.contains("right"), "地方够：往上开、左对齐（同旧画面）");
    b.click(); pop.h = 2000; pop.w = 3000; b.click();
    assert.ok(n.classList.contains("down"), "上面放不下：往下开");
    assert.ok(n.classList.contains("right"), "往右伸出画面：右对齐");
    b.click();
    assert.ok(!n.classList.contains("open") && !n.classList.contains("down") && !n.classList.contains("right"), "收起来");
  } finally { keep.forEach(([k, d]) => Object.defineProperty(EP, k, d)); }   // 小 DOM 的元素类是几个页面共用的：用完换回去
  // 近景看 1 区：镜头换了，标记跟着换位置（每一帧按 lensNow 摆；这里直接换一次镜头再排一遍）
  const near = P.w.HD2DCamera.pose(sc.layout, "near", 1, {});
  sc.lensNow = () => ({ pos: near.pos, target: near.target, fov: near.fov, width: DESKTOP.width, height: DESKTOP.height });
  sc.tier = "near"; sc.zone = 1;
  P.F.view(P.snaps(), { animate: false });
  assert.notDeepEqual([n.style.left, n.style.top], far, "跟着镜头走");
  assert.equal(n.hidden, false, "近景看的就是这个区：看得到");
  assert.equal(n.classList.contains("dim"), false);
  // 近景看 2 区：1 区的标记不在画面里就藏起来；在画面里就淡一截
  const n2 = P.w.HD2DCamera.pose(sc.layout, "near", 2, {});
  sc.lensNow = () => ({ pos: n2.pos, target: n2.target, fov: n2.fov, width: DESKTOP.width, height: DESKTOP.height });
  sc.zone = 2;
  P.F.view(P.snaps(), { animate: false });
  assert.ok(n.hidden || n.classList.contains("dim"), "别的区：藏起来或者淡一截");
  // 关掉新画面：3D 战场那一层（连同标记）拆掉
  P.F.switchTo("old");
  await settle();
  assert.equal(P.F.on(), false);
  assert.equal(P.doc.querySelector(".hd2d-stir"), null, "拆干净");
  // 源码：标记在 hd2d-field.js（不改 3D 场景包）；排完战场同步一次；选目标的标记跟着换
  const f = read("hd2d/hd2d-field.js");
  assert.match(f, /syncWaveTags\(\);   \/\/ 驻波墙的字牌（#345）\s*syncStirs\(\);/, "每次排完战场都同步");
  assert.match(f, /S\.sc\.setMarks\(marksOf\(S\.marks, S\.layout, S\.actorId\)\);\s*markStirs\(\);/, "选目标的标记跟着换");
  assert.doesNotMatch(read("hd2d/hd2d-scene.js"), /stir/i, "3D 场景包不用重打");
});

/* ---------- 3. 联机玩家：只用收到的包 ---------- */
test("联机玩家：收到的包（投影过的 state）里 3 只下潜的尘虫 → 新画面没有它们的卡、地台一角「沙下动静 ×3」；点一行走联机旧战场的回调；选目标时那一行亮起来；浮上来一只 → 1 张卡 + ×2；没有坚毅生命", async () => {
  const P = page(), ids = [...P.R.bugs].map(b => b.id);
  const ol = P.doc.querySelector(".ol-battle"), olField = ol.querySelector(".g-field");
  // 房主那边投影好的包（online-view.js · projectState）；玩家这边只拿它，不碰房主的 state
  let pv = P.R.pv();
  P.w.GAME.snapAll = () => { throw new Error("联机玩家的新画面读了单机的快照"); };
  const calls = [];
  const spec = {
    field: () => olField, app: () => ol,
    view: () => P.F.packetView(pv, { OB: P.OB, OV: P.R.OV }),
    input: { unit: (id) => calls.push(["unit", id]), hover: (id, on) => calls.push(["hover", id, on]), zone() {}, zoneHover() {} },
    clock: () => 1, refresh() {}, hint() {}, slot: () => null
  };
  P.boot(false);
  await settle();
  const h = P.F.attach(spec);
  assert.ok(h, "挂上联机玩家的战斗画面");
  P.F.switchTo("new");
  await settle();
  assert.equal(h.on(), true, "联机玩家的新画面建好了");
  h.view({ animate: false });
  const sc = P.scene();
  assert.equal(sc.layout.region, "沙漠");
  assert.ok(!sc.layout.units.some(u => ids.includes(u.id)), "没有它们的卡");
  assert.ok(sc.layout.units.some(u => u.id === P.R.unit("sandfish_ambush").id), "伏咬沙鱼照旧有卡");
  const n = P.stirs(olField)[0];
  assert.ok(n && P.stirs().length === 1, "标记挂在联机玩家的战场上");
  assert.match(n.textContent, /沙下动静 ×3/);
  noShp(olField.outerHTML, "联机战场里新画面的 DOM");
  n.querySelector(".hd2d-stir-b").click();
  const rows = P.rows(n);
  assert.equal(rows.length, 3, "列表三行");
  assert.ok(rows[0].textContent.includes("已被发现"), "已被发现（包里的 neutralTags）");
  rows[0].click();
  assert.deepEqual(calls, [["unit", ids[0]]], "点一行 = 点单位卡（联机旧战场的回调）");
  h.marks({ pick: true, targets: [ids[1]] });
  assert.deepEqual(P.rows(n).map(r => r.classList.contains("is-targetable")), [false, true, false], "能选的那一行亮起来");
  const r = P.F.rectOf(ids[1]);
  assert.ok(r && r.left === parseFloat(n.style.left), "播包时的攻击演出 / 数字落在标记上（适配器认得「沙下动静」，hd2d-play.js 用的是同一个）");
  // 下一包：浮上来一只
  P.R.bugs[0].submerged = false;
  pv = P.R.pv();
  h.view({ animate: true });
  assert.equal(P.scene().layout.units.filter(u => ids.includes(u.id)).length, 1, "1 张卡");
  assert.ok(P.card(ids[0]) && P.card(ids[0]).classList.contains("enter"), "浮上来的亮个相");
  assert.match(n.textContent, /沙下动静 ×2/);
  // 收到的包里的单位原样用（不加字段），新加的 stirs 只在布局里
  const v = P.F.packetView(pv, { OB: P.OB, OV: P.R.OV });
  assert.deepEqual(plain(v.units), plain(pv.units));
  noShp(JSON.stringify(P.scene().layout.stirs), "交给新画面的 stirs");
  P.F.detach(spec);
  assert.equal(P.doc.querySelector(".hd2d-stir"), null, "离开战斗拆干净");
});

/* ---------- 4. 样式 ---------- */
test("样式：标记在铭牌下面（不挡卡）、点开的在铭牌上面；照旧画面的样子（深色底、沙黄描边、斜切的角）；纸片画面开着时换纸片的配色；减少动态效果不闪", () => {
  const css = read("hd2d/hd2d.css"), paper = read("online-paper.css");
  assert.match(css, /\.hd2d-stirs \{ position: absolute; inset: 0; overflow: hidden; pointer-events: none; \}/, "整层不挡鼠标、不设 z-index");
  assert.match(css, /\.hd2d-stir \{ position: absolute; left: 0; top: 0; z-index: 0;/, "标记在铭牌（z 1）下面");
  assert.match(css, /\.hd2d-stir\.open \{ z-index: 2; \}/, "点开的在铭牌上面");
  assert.match(css, /\.hd2d-labels \{[^}]*z-index: 1;/);
  assert.match(css, /\.hd2d-stir-b \{[^}]*background: #15110d; color: #f0cf9a; border: 2px solid #d9a35f;[^}]*clip-path: polygon\(0 0, calc\(100% - 8px\) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc\(100% - 8px\)\);/, "同旧画面的 .sandstir");
  assert.match(css, /\.hd2d-stir-pop \.r:not\(\.is-targetable\) \.ok \{ display: none; \}/, "「可选」只在能选的那一行");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.hd2d-stir \.hd2d-stir-b \{ animation: none; \} \}/);
  assert.match(paper, /body\.ol-paper \.hd2d-field \.hd2d-stir-b \{\s*color: var\(--olp-kraft-ink\); background: var\(--olp-kraft\);/, "纸片画面：牛皮纸");
  assert.match(paper, /body\.ol-paper \.hd2d-field \.hd2d-stir-pop \{ color: var\(--olp-paper-ink\); background: var\(--olp-card\);/, "纸片画面：米白卡片的弹层");
  assert.match(paper, /body\.ol-paper \.hd2d-field \.hd2d-stir-pop \.r\.is-targetable \{ box-shadow: inset 0 0 0 2px var\(--olp-ring\); \}/);
});
