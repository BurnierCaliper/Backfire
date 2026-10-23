// 新画面的铭牌改回旧画面的白色单位卡（#316）：
//   · 3D 铭牌就是 unit-card.js 的 UnitCard.create / update 画的那张白卡（名字、Lv、ATK、血量数字和血条、架势、行动点、状态……），和同一个快照下旧画面的卡一模一样；
//   · 卡片快照只带画卡要读的字段（hd2d-field.js · FIELD.cardKeys）：联机玩家的卡只用收到的包（online-battle.js · snapUnit / snapProp），没有坚毅生命、没有房主的私有内容；
//   · 卡的大小：中景和旧画面的卡差不多大、远景缩小但不小于配置的最小缩放、近景选中的区放大（hd2d-layout.js 的 CONFIG.card），各段镜头下所有卡互不重叠；
//   · 点卡 = 点单位卡（只算一次）、悬停弹单位说明（挂在卡上）、选目标的标记用旧画面的样式、攻击演出的位置按卡片的大小。
// 都在 Node 里跑：小 DOM（tests/mini-dom.js）里加载 unit-card.js / online-battle.js，场景（hd2d-scene.js）里画卡、标记、点击的那几段从源码抠出来跑；WebGL 画面由仓库主人看。
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
const C = require("../hd2d/hd2d-camera.js");
const FX = require("../hd2d/hd2d-fx.js");
const F = require("../hd2d/hd2d-field.js");

const read = (f) => fs.readFileSync(path.join(HP.ROOT, f), "utf8");
const PARTY = ["kolt", "helu", "ruby", "yuito"];
const DESKTOP = { width: 1100, height: 620, top: 0, bottom: 40 };
const SHP = 7771, SHP_MAX = 7772;
const SECRET = "房主私有笔记甲乙丙";

/** 从源码里抠出一个函数（按大括号配对） */
function fnSrc(src, name) {
  const at = src.indexOf("function " + name + "(");
  assert.ok(at >= 0, "找不到 " + name);
  let i = src.indexOf("{", src.indexOf(")", at)), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(at, i + 1);
}

/** 规则环境里一场战斗：zm 个区，敌人都挤在最后一个区；每个人塞上特殊的坚毅生命数、房主的私有笔记 */
function battle(zm) {
  const ctx = H.load();
  vm.runInContext(read("online-view.js"), ctx, { filename: "online-view.js" });
  const st = ctx.BattleSim.setup({
    party: PARTY, zoneMode: zm, seed: "hd2d-card",
    enemies: [{ id: "guard_sword", lv: 2, zone: zm }, { id: "thug_hammer", lv: 2, zone: zm }, { id: "thug_knife", lv: 1, zone: zm }, { id: "bandit_boss", lv: 1, zone: zm }]
  });
  st.units.forEach(u => { u.shp = SHP; u.shpMax = SHP_MAX; u.baseShp = SHP; u.shpBase = SHP; u.shpBonus = SHP_MAX; u.gmNote = SECRET; });
  st.units.find(u => u.kit === "kolt").statuses.burn = 2;
  st.props = (st.props || []).concat([{ id: "boom1", kind: "boom", name: "爆炸桶", zone: 1, level: 1, hp: 5, maxHp: 8, faction: "enemy", gmNote: SECRET }]);
  return { ctx, st, OV: ctx.OnlineView, unit: (kit) => st.units.find(u => u.kit === kit) };
}

/** 小 DOM 的页面：界面图标、旧画面的单位卡（unit-card.js）、联机玩家的战斗画面（online-battle.js 的 snapUnit / snapProp） */
function page() {
  const P = MD.create('<main id="g-field"></main>');
  const w = P.window;
  const ctx = vm.createContext(w);
  ["icons.js", "hud-icons.js", "unit-card.js", "online-battle.js"].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  return { w, ctx, doc: P.document, UC: w.UnitCard, OB: w.OnlineBattle };
}

/** 场景（hd2d-scene.js）里画白卡、量大小、标记的那几段，抠出来放进小 DOM 里跑。state / options 是假的场景状态 */
function sceneBits(pg, state, options) {
  const src = read("hd2d/hd2d-scene.js");
  const nm = /const NO_MARKS = \{[^;]*\};/.exec(src);
  assert.ok(nm, "场景有 NO_MARKS");
  const body = ["syncCard", "measureCards", "markPlates"].map(n => fnSrc(src, n)).join("\n");
  return vm.runInContext(`(function (state, options, L) { ${nm[0]}\n${body}\n return { syncCard, measureCards, markPlates }; })`, pg.ctx)(state, options, L);
}
/** 一块假的铭牌（场景 makePlate 做的那几样 DOM：.hd2d-plate > .pl-in > .pl-bob，加上细杆；光圈、标签换成假的） */
function fakePlate(doc, id) {
  const el = doc.createElement("div");
  el.className = "hd2d-plate";
  el.innerHTML = '<div class="pl-in"><div class="pl-bob"></div></div><div class="pl-post" aria-hidden="true"></div>';
  doc.body.appendChild(el);
  return { id, el, inner: el.querySelector(".pl-in"), bob: el.querySelector(".pl-bob"), post: el.querySelector(".pl-post"),
    ring: { visible: false }, pick: { visible: false, material: {} }, label: {}, key: "", hover: false, mechMemo: {} };
}
/** 一个元素里所有的字、属性、行内样式拼起来 */
const dump = (el) => MD.serialize ? MD.serialize(el) : el.outerHTML;
function noShp(text, tag) {
  assert.ok(!text.includes(String(SHP)) && !text.includes(String(SHP_MAX)), tag + "：出现了坚毅生命的数字");
  assert.doesNotMatch(text, /"shp(Max|Base|Bonus)?"|baseShp|坚毅生命/, tag + "：出现了坚毅生命的字段");
  assert.ok(!text.includes(SECRET), tag + "：出现了房主的私有内容");
}

/* ---------- 1. 白卡就是 UnitCard 画的，和旧画面的卡一样 ---------- */
test("3D 铭牌是 UnitCard 画的白卡：名字、Lv、ATK、血量数字（如 12/12）和血条、架势、耐久、行动点、状态、资源小字、首领机制图标都有，和同一个快照下旧画面的卡一模一样；坚毅生命不进 3D", () => {
  const R = battle(2), pg = page();
  const kolt = R.unit("kolt"), pv = R.OV.projectState(R.st, {});
  // 单机：game.js 的快照（画法同 game.js · snapUnit：血量层写 cur，带着坚毅生命——game.js 的快照里本来就有）；耐久、资源小字、首领点名都放上
  const snap = Object.assign(pg.OB.snapUnit(pv.units.find(u => u.id === kolt.id)), {
    shp: SHP, shpMax: SHP_MAX, dur: { cur: 3, max: 5, name: "破甲锤" }, res: "刀头 2",
    marks: [{ type: "execution", name: "死刑", by: "首领", left: 2, phase: "enemy" }]
  });
  const total = snap.layers.reduce((a, l) => a + l.max, 0), cur = snap.layers.reduce((a, l) => a + l.cur, 0);
  // 旧画面：game.js · createCard / updateCard
  const old = pg.UC.create(snap);
  pg.UC.update(old, snap, {});
  // 3D：hd2d-field.js · cardsOf（只带画卡要的字段）→ 场景 syncCard
  const cards = F.cardsOf([snap]);
  const card = cards.get(String(kolt.id));
  assert.ok(card && card.name === snap.name, "单位 id → 卡片快照");
  assert.ok(!("shp" in card) && !("shpMax" in card), "坚毅生命连字段都不带");
  const state = { plates: new Map(), marks: null, pose: null, actorId: null, selectedId: null };
  const S = sceneBits(pg, state, {});
  const p = fakePlate(pg.doc, kolt.id);
  S.syncCard(p, { id: kolt.id, card }, pg.UC);
  const wrap = p.bob.querySelector(":scope > .unit-wrap");
  assert.ok(wrap && p.card && p.card.wrap === wrap, "铭牌里就是 UnitCard 的那张卡");
  assert.ok(p.el.classList.contains("card"), "铭牌换成白卡");
  const u = wrap.querySelector(".unit");
  assert.ok(u.classList.contains("unit") && u.classList.contains("player"), "白卡（.unit，我方蓝边）");
  assert.equal(wrap.querySelector(".u-name").textContent, snap.name);
  assert.equal(wrap.querySelector(".u-lv").textContent, "Lv" + snap.level);
  assert.equal(wrap.querySelector(".u-atk").textContent, "ATK " + snap.atk);
  assert.equal(wrap.querySelector(".hpn").textContent, cur + "/" + total, "血量数字");
  assert.equal(wrap.querySelectorAll(".u-hp .seg").length, snap.layers.length, "分层血条");
  assert.equal(wrap.querySelectorAll(".u-def .pip").length, Math.max(snap.def, snap.defMax), "架势菱形");
  assert.equal(wrap.querySelector(".durn").textContent, "3/5", "耐久数字");
  assert.ok(wrap.querySelectorAll(".u-econ .econ-ap").length >= 1, "行动点");
  assert.equal(wrap.querySelector(".u-res").textContent, "刀头 2", "底下的小字");
  assert.ok(wrap.querySelector(".u-mechs .mech-ico") && wrap.classList.contains("has-mech"), "首领机制的图标在卡上");
  // 和旧画面的卡一模一样（卡里面的每一样）
  assert.equal(wrap.innerHTML, old.wrap.innerHTML, "和同一个快照下旧画面的卡一样");
  assert.equal(u.className, old.unit.className);
  noShp(dump(wrap), "3D 的白卡");
  // 同一个快照再画一遍：不重画；内容变了（挨了一刀）才更新
  const before = p.key;
  S.syncCard(p, { id: kolt.id, card }, pg.UC);
  assert.equal(p.key, before);
  const hurt = Object.assign({}, card, { layers: card.layers.map((l, i) => (i === 0 ? Object.assign({}, l, { cur: Math.max(0, l.cur - 3) }) : l)) });
  S.syncCard(p, { id: kolt.id, card: hurt }, pg.UC);
  assert.equal(wrap.querySelector(".hpn").textContent, (cur - Math.min(3, card.layers[0].cur)) + "/" + total, "血量跟着掉");
  assert.equal(p.measure, true, "内容变了：画出来以后量一下大小");
  // 场景源码：有卡片快照就画白卡（UnitCard），原型页没有才画以前的铭牌；画卡时不响（旧画面的卡已经响过）
  const scene = read("hd2d/hd2d-scene.js");
  assert.match(scene, /if \(u\.card && UC && UC\.create\) syncCard\(p, u, UC\);/);
  assert.match(fnSrc(scene, "syncCard"), /UC\.create\(u\.card\)/);
  assert.match(fnSrc(scene, "syncCard"), /UC\.update\(p\.card, u\.card, \{ quiet: true \}\)/);
});

/* ---------- 2. 联机玩家：只用收到的包，没有坚毅生命 ---------- */
test("联机玩家的白卡只用收到的包：packetView 按 online-battle.js · snapUnit / snapProp 转好卡片快照（和他旧画面的单位卡同一份），只带 FIELD.cardKeys 里的字段，没有坚毅生命、没有房主的私有内容", () => {
  const R = battle(3), pg = page();
  const pv = R.OV.projectState(R.st, {});
  const v = F.packetView(pv, { OB: pg.OB, OV: R.OV });
  assert.ok(v.cards instanceof Map, "packetView 带上卡片快照");
  assert.ok(!F.FIELD.cardKeys.some(k => /shp/i.test(k) && k !== "upOnShp"), "白名单里没有坚毅生命");
  const allowed = new Set(F.FIELD.cardKeys);
  const ids = [...pv.units.filter(u => !u.hidden).map(u => String(u.id)), "prop:boom1"];
  assert.deepEqual([...v.cards.keys()].sort(), ids.sort(), "每个看得见的单位、配置物一张卡");
  v.cards.forEach((c, id) => {
    Object.keys(c).forEach(k => assert.ok(allowed.has(k), id + "." + k + " 不在白名单里"));
    noShp(JSON.stringify(c), "卡片快照 " + id);
  });
  // 就是他旧画面的单位卡用的那一份（online-battle.js · snapUnit），只是去掉了画卡用不到的字段
  pv.units.filter(u => !u.hidden).forEach(u => {
    const s = pg.OB.snapUnit(u), c = v.cards.get(String(u.id));
    F.FIELD.cardKeys.forEach(k => { if (k in s) assert.deepEqual(c[k], s[k], u.id + "." + k); });
  });
  // 画出来：卡上的字里没有坚毅生命
  const state = { plates: new Map(), marks: null, pose: null, actorId: null, selectedId: null };
  const S = sceneBits(pg, state, {});
  v.cards.forEach((c, id) => {
    const p = fakePlate(pg.doc, id);
    S.syncCard(p, { id, card: c }, pg.UC);
    noShp(dump(p.el), "联机玩家的白卡 " + id);
  });
  // 交给场景的布局里也没有（镜头、站位这些小数凑巧带出这几个数字不算：只查卡片快照、尺寸、铭牌数据）
  const lay = L.build(v, F.layoutOpts(v, DESKTOP, false, { cards: v.cards }));
  lay.units.forEach(u => noShp(JSON.stringify({ card: u.card, size: u.size, plate: u.plate }), "布局里的 " + u.id));
  // 页面：联机玩家的画面用 packetView 转好的那一份，单机用 game.js 的快照，都过 cardsOf
  const f = read("hd2d/hd2d-field.js");
  assert.match(f, /cards: \(v\) => \(v && v\.cards\) \|\| null/, "联机玩家：收到的包转好的");
  assert.match(f, /cards: \(\) => cardsOf\(S\.viewSnaps\)/, "单机：game.js 这一帧的快照");
});

/* ---------- 3. 大小、不重叠 ---------- */
test("卡的大小：远景缩小（不小于 CONFIG.card.minScale）、中景和旧画面的卡差不多大、近景选中的区放大；两区 196 宽、三区起 148 宽（和旧画面一样）；各段镜头下所有卡互不重叠，远景取景装得下抬高以后的卡", () => {
  const K = L.CONFIG.card;
  for (const zm of [2, 3]) {
    const R = battle(zm), pg = page();
    const v = F.packetView(R.OV.projectState(R.st, {}), { OB: pg.OB, OV: R.OV });
    const lay = L.build(v, F.layoutOpts(v, DESKTOP, false, { cards: v.cards }));
    assert.equal(lay.cards, true, zm + " 区：按白卡排");
    assert.equal(lay.cardW, zm >= K.narrowFrom ? K.narrowW : K.w, zm + " 区：卡片宽和旧画面一样");
    lay.units.forEach(u => {
      assert.ok(u.card && u.size && u.size.w > 0 && u.size.h > 0, u.id + "：有卡片快照和尺寸");
      if (!u.card.isProp) assert.equal(u.size.w, lay.cardW);
    });
    const foeZone = zm, rectsOf = (p) => lay.units.map(u => Object.assign({ id: u.id, zone: u.zone }, p.plates[u.id].rect, { base: p.plates[u.id].scale }));
    const overlaps = (rs) => {
      const out = [];
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j];
        if (a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5) out.push(a.id + " × " + b.id);
      }
      return out;
    };
    const tiers = {};
    ["far", "mid", "near"].forEach(tier => {
      const p = C.pose(lay, tier, foeZone, {});
      const rs = rectsOf(p);
      tiers[tier] = rs;
      assert.deepEqual(overlaps(rs), [], zm + " 区 " + tier + "：卡互不重叠（同一区、别的区都不压住）");
      rs.forEach(r => {
        const u = lay.units.find(x => x.id === r.id);
        const want = tier === "far" ? K.tier.far : tier === "near" && u.zone === foeZone ? K.tier.near : K.tier.mid;
        assert.equal(r.base, want, r.id + "：" + tier + " 的基础缩放");
        assert.ok(r.scale >= K.minScale - 1e-9 && r.scale <= K.maxScale + 1e-9, r.id + "：" + tier + " 的缩放在配置的范围里：" + r.scale);
        assert.ok(Math.abs((r.x1 - r.x0) - u.size.w * r.scale) < 0.01, "矩形 = 卡片大小 × 缩放");
      });
    });
    const avg = (rs, zone) => { const xs = rs.filter(r => r.zone === zone); return xs.reduce((a, r) => a + r.scale, 0) / xs.length; };
    assert.ok(avg(tiers.mid, foeZone) > 0.85 && avg(tiers.mid, foeZone) < 1.2, zm + " 区中景：和旧画面的卡差不多大（" + avg(tiers.mid, foeZone).toFixed(2) + "）");
    assert.ok(avg(tiers.far, foeZone) < avg(tiers.mid, foeZone), "远景比中景小");
    assert.ok(avg(tiers.near, foeZone) > avg(tiers.mid, foeZone), "近景选中的区放大");
    // 远景取景：抬高以后的卡也在画面里（不伸出上沿）
    tiers.far.forEach(r => assert.ok(r.y0 >= -1 && r.x0 >= -1 && r.x1 <= DESKTOP.width + 1, r.id + "：远景里整张卡在画面里"));
    // 特写：那张卡再放大，别的卡照样互不重叠（压到它的藏起来）
    const one = lay.units.find(u => u.zone === foeZone);
    const cp = C.closePose(lay, one.id, {});
    assert.equal(cp.plates[one.id].scale, K.tier.near * C.CAMERA.close.zoom);
    const others = lay.units.filter(u => u.id !== one.id && !cp.plates[u.id].hide).map(u => Object.assign({ id: u.id }, cp.plates[u.id].rect));
    assert.deepEqual(overlaps(others), [], "特写时别的卡互不重叠");
  }
  // 量到的大小（场景画出来以后）：按量到的重排，照样不重叠
  const R = battle(2), pg = page();
  const v = F.packetView(R.OV.projectState(R.st, {}), { OB: pg.OB, OV: R.OV });
  const tall = R.st.units.find(u => !u.isPlayer).id;
  const lay = L.build(v, F.layoutOpts(v, DESKTOP, false, { cards: v.cards, sizes: new Map([[String(tall), { w: 196, h: 230 }]]) }));
  assert.deepEqual(lay.units.find(u => u.id === tall).size, { w: 196, h: 230 }, "量到的优先");
  const p = C.pose(lay, "far", null, {});
  const rs = lay.units.map(u => Object.assign({ id: u.id }, p.plates[u.id].rect));
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i], b = rs[j];
    assert.ok(!(a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5), "量到的大卡也不压住：" + a.id + " × " + b.id);
  }
  // 数值都在配置表里；原型页（没给卡片快照）照旧按铭牌排
  ["w", "narrowW", "phoneW", "tier", "minScale", "maxScale", "gapX", "gapY", "maxLift", "rows"].forEach(k => assert.ok(k in L.CONFIG.card, "CONFIG.card." + k));
  const proto = L.build(R.OV.projectState(R.st, {}), { view: DESKTOP });
  assert.equal(proto.cards, false);
  assert.ok(proto.units.every(u => !u.card), "原型页：照旧是铭牌");
});

/* ---------- 4. 点卡、悬停、标记、演出位置 ---------- */
test("交互照旧：整张卡就是铭牌能点的地方（点一下只算一次）、悬停把单位说明挂在卡上；选目标的标记用旧画面的 is-targetable / is-hover / is-dim / is-actor；量到的大小交给外面重排；攻击演出 / 纸片数字的位置按卡片大小", () => {
  const R = battle(2), pg = page();
  const v = F.packetView(R.OV.projectState(R.st, {}), { OB: pg.OB, OV: R.OV });
  const lay = L.build(v, F.layoutOpts(v, DESKTOP, false, { cards: v.cards }));
  const kolt = R.unit("kolt").id, foe = R.unit("thug_hammer").id, guard = R.unit("guard_sword").id;
  const calls = [];
  const options = {
    onUnitClick: (id) => calls.push(["click", id]), onUnitHover: (id, on, el) => calls.push(["hover", id, on, el]),
    onCardSize: (m) => calls.push(["size", [...m.keys()]])
  };
  const pose = C.pose(lay, "far", null, {});
  const state = { plates: new Map(), marks: null, pose, actorId: kolt, selectedId: null };
  const S = sceneBits(pg, state, options);
  lay.units.forEach(u => { const p = fakePlate(pg.doc, u.id); p.u = u; S.syncCard(p, u, pg.UC); state.plates.set(u.id, p); });
  // 点 / 悬停：场景 makePlate 接在铭牌上的那几行（从源码抠出来），卡本身（UnitCard.create）不接任何监听
  const src = read("hd2d/hd2d-scene.js"), mk = fnSrc(src, "makePlate");
  const a = mk.indexOf("const onCard = "), b = mk.indexOf("el.addEventListener(\"dblclick\"");
  assert.ok(a > 0 && b > a, "makePlate 里的点击 / 悬停");
  const wireUp = vm.runInContext(`(function (p, el, options, container) {
    const setHover = () => {}, hoverTo = () => {}, select = () => {};
    function pickPlate(id) { if (options.onUnitClick) options.onUnitClick(id); else select(id); }
    ${mk.slice(a, b)}
  })`, pg.ctx);
  const pf = state.plates.get(foe);
  wireUp(pf, pf.el, options, pg.doc.body);
  const wrap = pf.card.wrap;
  assert.ok(wrap.hasAttribute("data-hit"), "整张卡能点");
  assert.equal(wrap.getAttribute("role"), "button");
  assert.equal(wrap.getAttribute("tabindex"), "0", "键盘也能停上去");
  wrap.querySelector(".u-name").dispatchEvent(new MD.Event("click", { bubbles: true }));
  assert.deepEqual(calls.filter(c => c[0] === "click"), [["click", foe]], "点卡上任何地方：只算一次（= 点单位卡）");
  wrap.dispatchEvent(new MD.Event("pointerenter"));
  const hv = calls.filter(c => c[0] === "hover");
  assert.equal(hv.length, 1);
  assert.deepEqual(hv[0].slice(0, 3), ["hover", foe, true]);
  assert.equal(hv[0][3], wrap, "单位说明挂在这张卡上");
  // 选目标：能点的描边、鼠标停着的更亮、别的变暗、行动的人——旧画面单位卡的样式
  state.marks = { targets: new Set([foe]), dim: new Set([guard]), aim: foe, zones: new Set(), hoverZone: null, gaps: new Set() };
  S.markPlates();
  const w = (id) => state.plates.get(id).card.wrap;
  assert.ok(w(foe).classList.contains("is-targetable") && w(foe).classList.contains("is-hover"), "目标描边、鼠标停着的更亮");
  assert.ok(w(guard).classList.contains("is-dim") && !w(foe).classList.contains("is-dim"), "不是目标的变暗");
  assert.ok(w(kolt).classList.contains("is-actor"), "谁在行动");
  state.marks = null;
  S.markPlates();
  assert.ok(!w(foe).classList.contains("is-targetable") && !w(guard).classList.contains("is-dim"), "选完了标记拿掉");
  assert.equal(state.plates.get(foe).base, L.CONFIG.card.tier.far, "这一段的基础缩放记在铭牌上（每帧按 L.cardScale）");
  // 量大小：画出来以后（宽高不是 0）量到的和布局估的不一样，交给外面重排；一样的不再报
  const pk = state.plates.get(kolt);
  Object.defineProperty(pk.card.wrap, "offsetWidth", { get: () => 196 });
  Object.defineProperty(pk.card.wrap, "offsetHeight", { get: () => pk.u.size.h + 40 });
  S.measureCards();
  assert.deepEqual(calls.filter(c => c[0] === "size"), [["size", [kolt]]], "量到的大小交给外面（hd2d-field.js 按它重排）");
  S.measureCards();
  assert.equal(calls.filter(c => c[0] === "size").length, 1, "量过的不再量");
  // 攻击演出 / 纸片数字的位置：场景给卡片大小和基础缩放，适配器按 L.cardScale 算，和布局排的矩形一样
  const u = lay.units.find(x => x.id === foe);
  const ad = FX.adapter({
    lens: () => ({ pos: lay.camera.pos, target: lay.camera.target, fov: lay.camera.fov, width: DESKTOP.width, height: DESKTOP.height }),
    plate: (id) => (id === foe ? { x: u.x, y: u.y, z: u.z, lift: u.lift, big: false, zoom: 1, w: u.size.w, h: u.size.h, s: L.CONFIG.card.tier.far } : null),
    zone: () => null, size: () => L.plateSize(DESKTOP)
  });
  const r = ad.rectOf(foe);
  assert.ok(Math.abs(r.width - (u.rect.x1 - u.rect.x0)) < 0.5, "演出的矩形宽 = 卡在屏幕上的宽");
  assert.ok(Math.abs(r.left - u.rect.x0) < 0.5, "位置也对得上");
  assert.match(src, /if \(p\.card && sz && p\.base != null\) Object\.assign\(out, \{ w: sz\.w, h: sz\.h, s: p\.base \}\);/, "场景给适配器卡片大小和基础缩放");
  // 页面：量到的大小回来按它重排
  assert.match(read("hd2d/hd2d-field.js"), /onCardSize: \(m\) => \{ m\.forEach\(\(v, k\) => S\.sizes\.set\(String\(k\), \{ w: v\.w, h: v\.h \}\)\); if \(S\.sc\) paint\(false\); \}/);
});

/* ---------- 5. 样式 ---------- */
test("样式：白卡用旧画面的那一份（game.css 的 .unit-wrap / .unit），新战场只管宽（--cw）、换回旧画面的颜色和字体、整张卡接鼠标", () => {
  const css = read("hd2d/hd2d.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.hd2d-labels \.unit:not\(\.prop\):not\(\.mini\) \{ width: var\(--cw, 196px\); \}/);
  assert.match(css, /\.hd2d-plate\.card \.unit-wrap \{[^}]*pointer-events: auto;[^}]*--ink: #1b1f24;[^}]*--muted: #9d9081;/);
  const game = read("game.css");
  assert.match(game, /--ink: #1b1f24;/, "和 game.css 的 :root 一样");
  assert.match(game, /--muted: #9d9081;/);
  assert.ok(!/\.hd2d-[^{]*\.unit[^{]*\{[^}]*background/.test(css), "不改白卡的样子（底色、边框都是旧画面的）");
});
