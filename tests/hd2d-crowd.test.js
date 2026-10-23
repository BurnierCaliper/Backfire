// 新画面：同一个区里单位很多时，卡片互相叠住、跑出画面上边（#341，近景最严重）：
//   · 9 人（我方 ruby / yuito / hiaki / kolt + 敌人 guard_sword / thug_hammer / thug_knife / bandit_boss / thug_knife，3 区另有一个 guard_sword）、
//     再加三个敌人的 12 人，都挤在 2 区：远 / 中 / 近三段镜头下卡片两两不相交；远景所有卡、中景 / 近景看的那个区的卡都在可视范围里
//     （顶栏下面、技能栏上面、两边的换区箭头之间），屏幕上的卡不小于 CONFIG.card.minScale；
//   · 放不下时这个区先整张缩小（CONFIG.card.crowd.fit），缩到最小还放不下才换紧凑卡；人少、放得下的区照旧；
//   · 远景为了装下卡最多退到只框地台时的 CONFIG.card.crowd.farBack 倍（以前不封顶，十字五区挤满一个区能退到一千多倍远）；
//   · 场景（hd2d-scene.js）：紧凑卡的铭牌加 .compact、量大小时量完整的卡、平移不再把看的那一点的高度夹在 2 以下；样式（hd2d.css）只留名字 + 血量数字、血条、架势 + 状态图标；
//   · 单机、联机玩家用同一套布局 / 镜头（这里用联机玩家那条路：投影 → packetView 的卡片快照），交给场景的数据里没有坚毅生命。
// 都是纯函数，Node 里跑（布局 hd2d-layout.js、镜头 hd2d-camera.js；场景里那几段从源码抠出来放进小 DOM 里跑）；WebGL 画面由仓库主人看。
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
const F = require("../hd2d/hd2d-field.js");

const read = (f) => fs.readFileSync(path.join(HP.ROOT, f), "utf8");
const K = L.CONFIG.card;
const SHP = 7771, SHP_MAX = 7772;
/** 画面：1920×1080 的窗口里战场那一格（右边日志、上面顶栏、下面技能栏让掉以后；下沿是镜头按钮那一条）、测试常用的桌面、默认桌面（上面一条首领横幅） */
const VIEWS = {
  "1920×1080 的战场那一格": { width: 1600, height: 873, top: 0, bottom: 50 },
  "桌面 1100×620": { width: 1100, height: 620, top: 0, bottom: 40 },
  "桌面 1440×900（上面有横幅）": { width: 1440, height: 900, top: 46, bottom: 160 }
};
const FOES9 = [{ id: "guard_sword", lv: 2 }, { id: "thug_hammer", lv: 2 }, { id: "thug_knife", lv: 1 }, { id: "bandit_boss", lv: 1 }, { id: "thug_knife", lv: 1 }];
const MORE = [{ id: "thug_hammer", lv: 1 }, { id: "thug_knife", lv: 1 }, { id: "guard_sword", lv: 1 }];

/** 小 DOM 的页面：旧画面的单位卡（unit-card.js）、联机玩家的战斗画面（online-battle.js 的 snapUnit / snapProp） */
function page() {
  const P = MD.create('<main id="g-field"></main>');
  const ctx = vm.createContext(P.window);
  ["icons.js", "hud-icons.js", "unit-card.js", "online-battle.js"].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  return { ctx, doc: P.document, UC: P.window.UnitCard, OB: P.window.OnlineBattle };
}
/** 规则环境里一场战斗：n = 9 / 12 人挤在 crowd 区（我方 4 人也挪过去），3 区另放一个 guard_sword；opt 给棋盘（zoneMode / board）。每个人塞上特殊的坚毅生命数 */
function battle(n, opt) {
  const ctx = H.load();
  vm.runInContext(read("online-view.js"), ctx, { filename: "online-view.js" });
  const at = 2, foes = FOES9.concat(n >= 12 ? MORE : []).map(f => Object.assign({ zone: at }, f)).concat([{ id: "guard_sword", lv: 2, zone: 3 }]);
  const st = ctx.BattleSim.setup(Object.assign({ party: ["ruby", "yuito", "hiaki", "kolt"], seed: "crowd-341", enemies: foes }, opt || { zoneMode: 3 }));
  st.units.filter(u => u.isPlayer).forEach(u => { u.zone = at; });
  st.units.forEach(u => { u.shp = SHP; u.shpMax = SHP_MAX; u.shpBase = SHP; u.shpBonus = SHP_MAX; });
  return { st, OV: ctx.OnlineView, at };
}
/** 联机玩家那条路排出来的布局（白卡）：投影 → packetView 转好卡片快照 → HD2DLayout.build；plain = 不给卡片快照（只框地台的镜头拿来比） */
function layoutOf(B, view, pg) {
  const v = F.packetView(B.OV.projectState(B.st, {}), { OB: pg.OB, OV: B.OV });
  return { lay: L.build(v, F.layoutOpts(v, view, false, { cards: v.cards })), plain: L.build(v, F.layoutOpts(v, view, false, null)), v };
}
const overlaps = (rs) => {
  const out = [];
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i], b = rs[j];
    if (a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5) out.push(a.name + "（" + a.zone + " 区）× " + b.name + "（" + b.zone + " 区）");
  }
  return out;
};
const sideOf = (lay, tier) => (typeof C.navSide === "function" ? C.navSide(lay, tier) : 0);
/** 一段镜头下：卡两两不相交；远景全部、中景 / 近景看的那个区的卡都在可视范围里；屏幕上的卡不小于 minScale */
function check(lay, tier, zone, view, tag) {
  const p = C.pose(lay, tier, zone, {}), side = sideOf(lay, tier);
  const rs = lay.units.map(u => Object.assign({ id: u.id, zone: u.zone, name: u.plate.name }, p.plates[u.id].rect));
  assert.deepEqual(overlaps(rs), [], tag + "：卡互相压住");
  const mine = tier === "far" ? rs : rs.filter(r => r.zone === p.zone);
  const out = mine.filter(r => r.y0 < view.top - 0.5 || r.y1 > view.height - view.bottom + 0.5 || r.x0 < side - 0.5 || r.x1 > view.width - side + 0.5);
  assert.deepEqual(out.map(r => r.name + " y0=" + r.y0.toFixed(0) + " x=" + r.x0.toFixed(0) + "…" + r.x1.toFixed(0)), [], tag + "：有卡跑出可视范围（上 " + view.top + "、下 " + (view.height - view.bottom) + "、左右各让 " + side + "）");
  rs.forEach(r => assert.ok(r.scale >= K.minScale - 1e-9, tag + "：" + r.name + " 缩得太小（" + r.scale.toFixed(3) + "）"));
  return p;
}

/* ---------- 1. 9 人 / 12 人挤在一个区：三段镜头 ---------- */
for (const n of [9, 12]) {
  test(`${n} 人挤在 2 区（${Object.keys(VIEWS).join(" / ")}）：远 / 中 / 近三段镜头下卡片两两不相交；远景所有卡、中景 / 近景看的那个区的卡都在顶栏下面、技能栏上面、两边的换区箭头之间`, () => {
    const pg = page();
    for (const [name, view] of Object.entries(VIEWS)) {
      const B = battle(n), { lay } = layoutOf(B, view, pg);
      assert.equal(lay.units.filter(u => u.zone === B.at).length, n, "2 区一共 " + n + " 个单位");
      check(lay, "far", B.at, view, `${n} 人 · ${name} far`);
      // 中景 / 近景：挤的 2 区，还有旁边的 1 区（空的）、3 区（一个人）当看的区时也一样
      lay.zones.forEach(z => ["mid", "near"].forEach(tier => check(lay, tier, z.id, view, `${n} 人 · ${name} ${tier}（看 ${z.id} 区）`)));
    }
  });
}

/* ---------- 2. 先缩小、再换紧凑卡；放得下的区照旧 ---------- */
test("放不下时先整张缩小（CONFIG.card.crowd.fit 一档一档，屏幕上不小于 minScale），缩到最小还放不下才换紧凑卡；放得下的区、人少的区一点不变", () => {
  const F9 = K.crowd.fit;
  ["w", "narrowW", "phoneW", "h"].forEach(k => assert.ok(K.crowd.compact[k] > 0, "CONFIG.card.crowd.compact." + k));
  assert.ok(F9[0] === 1 && F9.every((k, i) => i === 0 || k < F9[i - 1]), "fit 从 1 往下一档一档缩");
  assert.ok(K.crowd.farBack > 1 && K.crowd.passes > 0);
  assert.ok(C.CAMERA.nav.w > 0 && C.CAMERA.nav.phone > 0, "换区箭头那一条留多宽在 CAMERA.nav");
  const pg = page(), view = VIEWS["1920×1080 的战场那一格"];
  const B = battle(9), { lay } = layoutOf(B, view, pg);
  // 挤的 2 区一档一档往下降（近景、远景各走一遍）：缩小的几档都在换紧凑卡之前；这个区最大的卡缩到 minScale 就不再缩（缩了也一样大），
  // 换紧凑卡再从原来的大小一档一档缩；降到底了返回 false
  const mine = lay.units.filter(u => u.zone === B.at);
  [["near", C.pose(lay, "near", B.at, {}).cam, K.tier.near], ["far", lay.camera, K.tier.far]].forEach(([tier, cam, b]) => {
    const fits = {}, seen = [], top = Math.max(...mine.map(u => L.cardScale(cam, u, b)));
    while (L.crowdStep(fits, new Set([B.at]), lay.units, cam, () => b) && seen.length < 40) seen.push(Object.assign({}, fits[B.at]));
    const full = [{ i: 0, k: 1 }].concat(seen.filter(f => !f.compact)), small = seen.filter(f => f.compact);
    assert.ok(small.length >= 1, tier + "：缩到底了换紧凑卡：" + JSON.stringify(seen));
    assert.equal(seen.findIndex(f => f.compact), full.length - 1, tier + "：缩小的几档都在换紧凑卡之前");
    [full, small].forEach(list => list.forEach((f, i) => { assert.equal(f.k, F9[f.i]); if (i) { assert.ok(f.k < list[i - 1].k); assert.ok(top * list[i - 1].k > K.minScale, tier + "：上一档还没缩到 minScale 才往下缩"); } }));
    const last = full[full.length - 1];
    assert.ok(last.i === F9.length - 1 || top * last.k <= K.minScale + 1e-3, tier + "：最大的卡缩到 minScale 才换紧凑卡");
    assert.equal(small[0].k, 1, tier + "：换紧凑卡时从原来的大小开始");
    assert.equal(L.crowdStep(fits, new Set([B.at]), lay.units, cam, () => b), false, tier + "：降到底了不再动");
  });
  assert.ok(Math.max(...mine.map(u => L.cardScale(C.pose(lay, "near", B.at, {}).cam, u, K.tier.near))) * F9[1] > K.minScale, "近景的卡大：先缩几档");
  // 实际排出来：挤的 2 区在近景缩了（这个画面中景放得下，不缩），1 区（空）、3 区（一个人）照旧
  ["mid", "near"].forEach(tier => {
    const p = C.pose(lay, tier, B.at, {});
    if (tier === "near") assert.ok(p.crowd[B.at], tier + "：2 区挤，降了档：" + JSON.stringify(p.crowd));
    assert.ok(!p.crowd[3] && !p.crowd[1], tier + "：别的区没动");
    lay.units.forEach(u => {
      const q = p.plates[u.id], f = p.crowd[u.zone], want = (tier === "near" && u.zone === B.at ? K.tier.near : K.tier.mid) * (f ? f.k : 1);
      assert.ok(Math.abs(q.scale - want) < 1e-9, tier + "：基础缩放 = 这一段的 × 这一档的 k");
      assert.equal(q.compact, !!(f && f.compact && u.compact), tier + "：紧凑卡跟着这个区的档");
    });
  });
  // 布局交给场景的：紧凑卡的尺寸（宽和普通卡一样分三种）；配置物、中立生物不换
  assert.deepEqual(lay.compact, { w: K.crowd.compact.narrowW, h: K.crowd.compact.h }, "一排三区：用 narrowW");
  lay.units.forEach(u => assert.deepEqual(u.compact, u.card && (u.card.isProp || u.card.neutral) ? null : lay.compact));
  // 放得下的（两区，4 个敌人一区、我方一区，1920×1080 的战场那一格）：哪一段、看哪个区都不缩，卡和以前一样大
  const ctx = H.load();
  vm.runInContext(read("online-view.js"), ctx, { filename: "online-view.js" });
  const st = ctx.BattleSim.setup({ party: ["kolt", "helu", "ruby", "yuito"], zoneMode: 2, seed: "hd2d-card",
    enemies: [{ id: "guard_sword", lv: 2, zone: 2 }, { id: "thug_hammer", lv: 2, zone: 2 }, { id: "thug_knife", lv: 1, zone: 2 }, { id: "bandit_boss", lv: 1, zone: 2 }] });
  const ok = layoutOf({ st, OV: ctx.OnlineView }, view, pg);
  assert.deepEqual(ok.lay.crowd, {}, "远景不缩");
  assert.ok(Math.abs(ok.lay.camera.dist - ok.plain.camera.dist) < 1e-6, "远景镜头和只框地台的一样");
  ["far", "mid", "near"].forEach(tier => ok.lay.zones.forEach(z => {
    const p = check(ok.lay, tier, z.id, view, "放得下的 " + tier + "（看 " + z.id + " 区）");
    assert.deepEqual(p.crowd, {}, tier + "（看 " + z.id + " 区）：不缩");
    ok.lay.units.forEach(u => assert.equal(p.plates[u.id].compact, false));
  }));
});

/* ---------- 3. 远景最多退 farBack 倍 ---------- */
test("远景为了装下卡最多退到只框地台时的 CONFIG.card.crowd.farBack 倍（直排三区 / 直排四区 / 2×2 / 十字五区，9 人、12 人挤一个区）；退不下的区换紧凑卡，照样不压住、不出画", () => {
  const pg = page();
  for (const [bname, opt] of [["直排三区", { zoneMode: 3 }], ["直排四区", { board: "line4" }], ["2×2", { board: "square4" }], ["十字五区", { board: "cross5" }]]) {
    for (const [vname, view] of Object.entries(VIEWS)) {
      // 2×2 后排一个区挤 12 人、画面又只有 1100×620：远景封顶 1.3 倍、紧凑卡也到最小了，最上面一两张还会伸出顶边几像素（PR 里写明，没算进来）
      for (const n of bname === "2×2" && view.width < 1200 ? [9] : [9, 12]) {
        const B = battle(n, opt), { lay, plain } = layoutOf(B, view, pg), tag = `${bname} ${n} 人 · ${vname}`;
        const k = lay.camera.dist / plain.camera.dist;
        assert.ok(k <= K.crowd.farBack + 1e-6, tag + "：远景退了 " + k.toFixed(1) + " 倍");
        check(lay, "far", B.at, view, tag + " far");
        ["mid", "near"].forEach(tier => check(lay, tier, B.at, view, tag + " " + tier));
      }
    }
  }
});

/* ---------- 4. 场景、样式 ---------- */
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
test("场景：镜头给了 compact 的铭牌加 .compact（基础缩放已经乘了这一档的 k）；量卡片大小时量完整的卡；攻击演出按紧凑卡的大小；平移不再把看的那一点的高度夹在 2 以下", () => {
  const src = read("hd2d/hd2d-scene.js"), pg = page();
  const B = battle(9), view = VIEWS["1920×1080 的战场那一格"], { lay } = layoutOf(B, view, pg);
  const pose = C.pose(lay, "near", B.at, {});
  // markPlates / measureCards 从源码抠出来，放进小 DOM 里跑
  const nm = /const NO_MARKS = \{[^;]*\};/.exec(src);
  assert.ok(nm, "场景有 NO_MARKS");
  const state = { plates: new Map(), marks: null, pose, actorId: null, selectedId: null };
  const sizes = [];
  const S = vm.runInContext(`(function (state, options, L) { ${nm[0]}\n${fnSrc(src, "syncCard")}\n${fnSrc(src, "measureCards")}\n${fnSrc(src, "markPlates")}\n return { syncCard, measureCards, markPlates }; })`, pg.ctx)(state, { onCardSize: (m) => sizes.push(m) }, L);
  lay.units.forEach(u => {
    const el = pg.doc.createElement("div");
    el.className = "hd2d-plate";
    el.innerHTML = '<div class="pl-in"><div class="pl-bob"></div></div><div class="pl-post"></div>';
    pg.doc.body.appendChild(el);
    const p = { id: u.id, el, inner: el.firstChild, bob: el.firstChild.firstChild, post: el.lastChild, ring: { visible: false }, pick: { visible: false, material: {} }, label: {}, key: "", hover: false, mechMemo: {}, u };
    S.syncCard(p, u, pg.UC);
    state.plates.set(u.id, p);
  });
  S.markPlates();
  let compact = 0;
  lay.units.forEach(u => {
    const p = state.plates.get(u.id), q = pose.plates[u.id];
    assert.equal(p.el.classList.contains("compact"), q.compact, u.plate.name + "：.compact 跟着镜头");
    assert.equal(p.base, q.scale, "基础缩放（乘过这一档的 k）记在铭牌上，每帧按 L.cardScale 再乘远近");
    if (q.compact) compact++;
  });
  // 换个镜头（远景，这个画面放得下）：.compact 拿掉
  state.pose = C.pose(lay, "far", B.at, {});
  S.markPlates();
  lay.units.forEach(u => assert.equal(state.plates.get(u.id).el.classList.contains("compact"), state.pose.plates[u.id].compact));
  // 量大小：紧凑卡的铭牌先拿掉 .compact 量完整的卡，量完换回去
  const one = [...state.plates.values()][0];
  one.el.classList.add("compact");
  Object.defineProperty(one.card.wrap, "offsetWidth", { get: () => (one.el.classList.contains("compact") ? lay.compact.w : 196) });
  Object.defineProperty(one.card.wrap, "offsetHeight", { get: () => (one.el.classList.contains("compact") ? lay.compact.h : one.u.size.h + 30) });
  one.measure = true;
  S.measureCards();
  assert.equal(sizes.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(sizes[0].get(one.id))), { w: 196, h: one.u.size.h + 30 }, "量到的是完整的卡");
  assert.ok(one.el.classList.contains("compact"), "量完换回紧凑卡");
  // 源码：紧凑卡的宽高交给样式（--kw / --kh），攻击演出按紧凑卡的大小（hd2d-fx.js · adapter 要 w / h / s）
  assert.match(fnSrc(src, "syncPlates"), /setProperty\("--kw", state\.layout\.compact\.w \+ "px"\)/);
  assert.match(fnSrc(src, "syncPlates"), /setProperty\("--kh", state\.layout\.compact\.h \+ "px"\)/);
  assert.match(src, /const sz = p\.compact && !p\.hover && p\.u\.compact \? p\.u\.compact : p\.size \|\| p\.u\.size;/);
  // 平移：看的那一点的高度以前夹在 [-1, 2]，摞得高时取景把它往上挪，每帧被拽下来、最上面的卡顶出画面；现在这一段本来看的那一点总在范围里
  const THREE = { MathUtils: { clamp: (v, a, b) => Math.max(a, Math.min(b, v)) }, Vector3: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; } } };
  const vec = (x, y, z) => ({ x, y, z, add(d) { this.x += d.x; this.y += d.y; this.z += d.z; return this; } });
  const clampPan = (st, target, pos) => vm.runInNewContext(`(function () { ${fnSrc(src, "clampPan")}\n clampPan(); })()`, { THREE, CAM: { panPad: 3 }, state: st, controls: { target }, camera: { position: pos } });
  const bounds = { minX: -13, maxX: 13, minZ: -3.6, maxZ: 3.6 };
  const t1 = vec(0, 5.5, -2), c1 = vec(0, 20, 30);
  clampPan({ bounds, pose: { target: { x: 0, y: 5.5, z: -2 } } }, t1, c1);
  assert.equal(t1.y, 5.5, "这一段本来就看这么高：不往下拽");
  assert.equal(c1.y, 20, "镜头也不动");
  const t2 = vec(40, 9, -20), c2 = vec(40, 20, 0);
  clampPan({ bounds, pose: { target: { x: 0, y: 5.5, z: -2 } } }, t2, c2);
  assert.deepEqual([t2.x, t2.y, t2.z], [16, 5.5, -6.6], "拖出战场太远的照旧夹回来（高度夹到这一段看的那一点）");
  assert.deepEqual([c2.x, c2.y, c2.z], [16, 16.5, 13.4], "镜头跟着一起挪");
  const t3 = vec(0, 3, 0), c3 = vec(0, 10, 10);
  clampPan({ bounds, pose: null }, t3, c3);
  assert.equal(t3.y, 2, "没有这一段的镜头：照旧夹在 2 以下");
});

test("紧凑卡的样式（hd2d.css）：只留名字 + 血量数字一行、分层血条、架势 + 状态图标一行，宽高用 --kw / --kh；鼠标 / 键盘停上去是完整的卡、叠在最上面；配置物和迷你名牌不换；不碰坚毅生命", () => {
  const css = read("hd2d/hd2d.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const scope = ".hd2d-plate.card.compact:not(.hover):not(:focus-within) .unit:not(.prop):not(.mini)";
  const rules = css.split("}").map(s => s.trim()).filter(s => s.startsWith(scope)).map(s => s + "}");
  assert.ok(rules.length > 5, "有紧凑卡的样式");
  const all = rules.join("\n");
  assert.match(all, /width: var\(--kw, \d+px\); height: var\(--kh, \d+px\);/, "宽高固定（布局按同一个尺寸排）");
  const hidden = rules.find(r => /display: none/.test(r));
  ["u-lv", "u-atk", "u-dur", "u-econ", "u-res"].forEach(c => assert.ok(hidden && hidden.includes("." + c), "收起 ." + c));
  ["u-name", "u-hpline", "u-hp", "u-def", "u-foot"].forEach(c => assert.ok(!hidden.includes("." + c + ",") && !hidden.includes("." + c + ")"), "留着 ." + c));
  assert.match(all, /\.u-hpline \{ grid-area: 1 \/ 3;/, "血量数字和名字一行");
  assert.match(all, /\.u-def \{ grid-area: 3 \/ 1;/, "架势在第三行");
  assert.match(all, /\.u-foot \{ grid-area: 3 \/ 2 \/ 4 \/ 4;/, "状态图标和架势一行");
  assert.match(css, /\.hd2d-plate\.card\.compact\.hover, \.hd2d-plate\.card\.compact:focus-within \{ z-index: 2147482000 !important; \}/, "停上去的完整的卡叠在最上面");
  assert.ok(!/\bshp(Max|Base|Bonus)?\b|--shp/i.test(all), "不碰坚毅生命（.shpn 是「起身」那几个字，收起来了）");
  // 和 CONFIG.card.crowd.compact 对得上（样式里的默认值就是两区的尺寸）
  assert.ok(all.includes("var(--kw, " + K.crowd.compact.w + "px)") && all.includes("var(--kh, " + K.crowd.compact.h + "px)"));
});

/* ---------- 5. 交给场景的数据里没有坚毅生命 ---------- */
test("挤的区换紧凑卡、缩小以后，交给场景的数据（卡片快照、尺寸、紧凑卡的尺寸、每一段的挤法、铭牌）里照旧没有坚毅生命", () => {
  const pg = page(), B = battle(12), view = VIEWS["桌面 1100×620"], { lay } = layoutOf(B, view, pg);
  const no = (x, tag) => {
    const s = JSON.stringify(x);
    assert.ok(!s.includes(String(SHP)) && !s.includes(String(SHP_MAX)), tag + "：出现了坚毅生命的数字");
    assert.doesNotMatch(s, /"shp(Max|Base|Bonus)?"|baseShp/, tag + "：出现了坚毅生命的字段");
  };
  lay.units.forEach(u => no({ card: u.card, size: u.size, compact: u.compact, plate: u.plate }, u.id));
  no({ crowd: lay.crowd, compact: lay.compact }, "布局的挤法");
  ["far", "mid", "near"].forEach(tier => {
    const p = C.pose(lay, tier, B.at, {});
    no(p.crowd, tier + " 的挤法");
    lay.units.forEach(u => no({ compact: p.plates[u.id].compact, scale: p.plates[u.id].scale, big: p.plates[u.id].big }, tier + " " + u.id));
  });
});
