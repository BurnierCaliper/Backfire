// HD-2D 战场原型 · 第二阶段 · 二（#230）：攻击演出的适配器（3D 铭牌 / 地台 → 屏幕矩形）、「演示出招」（房主用规则结算一次 + 投影成联机玩家收到的包）、
// 纸片风伤害数字（两两不压住、近景大远景小、不出现坚毅生命）。
// 都是 Node 能跑的：适配器 / 数字排位置是纯函数（hd2d-fx.js），房主那边用 tests/headless.js 的规则环境；画面（WebGL）截图由仓库主人跑。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const H = require("./headless");
const L = require("../prototypes/hd2d/hd2d-layout.js");
const OV = require("../online-view.js");
const AF = require("../attack-fx.js");

// 缺这几个文件时只是这几条失败（每条测试里各自 require）
const fxm = () => require("../prototypes/hd2d/hd2d-fx.js");
const host = () => require("../prototypes/hd2d/hd2d-host.js");
const cams = () => require("../prototypes/hd2d/hd2d-camera.js");

const DIR = path.join(__dirname, "..", "prototypes", "hd2d");
const PARTY = ["kolt", "helu", "ruby", "yuito"];
const DESKTOP = { width: 1440, height: 900, top: 46, bottom: 160 };   // 桌面 1440×900：顶栏 + 展开的技能栏
const SHP = 7771, SHP_MAX = 7772;
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
    return st;
  },
  cross(S) {
    const st = S.setup({ party: PARTY, board: "cross5", weather: "thunder", seed: "hd2d-cross", region: "外城区", light: "night", enemies: [{ id: "crow", lv: 2, zone: 1 }, { id: "buoy", lv: 2, zone: 1 }, { id: "thug_hammer", lv: 2, zone: 3 }, { id: "guard_gun", lv: 2, zone: 4 }] });
    st.fields[1].abyss = true; st.fields[2].highland = true; st.fields[3].electric = true; st.fields[4].acid = true;
    st.gaps["1-3"] = gapOf("void"); st.gaps["2-3"] = gapOf("door", 0, false); st.gaps["3-4"] = gapOf("bridge", 12);
    return st;
  }
};
/** 规则环境里摆一个演示战场，每个单位塞上特殊的坚毅生命数（找得到就是漏了） */
function demo(id) {
  const ctx = H.load();
  const st = DEMOS[id](ctx.BattleSim);
  st.units.forEach(u => { u.shp = SHP; u.shpMax = SHP_MAX; });
  const env = { G: ctx, state: st, BattleSim: ctx.BattleSim, OnlineView: OV, AttackFx: AF, itemCatalog: ctx.ITEM_CATALOG || {} };
  return { ctx, st, env, pv: () => OV.projectState(st, { itemCatalog: env.itemCatalog }) };
}

/** 按投影过的状态排战场、摆这一段镜头，给出和场景一样的适配器（铭牌在哪、抬多高、是不是放大的那张；镜头可以换） */
function rig(pv, tier, zone, actorId) {
  const F = fxm(), C = cams();
  const layout = L.build(pv, { view: DESKTOP, region: pv.region, theme: pv.light });
  const pose = C.pose(layout, tier, zone, { actorId });
  let cam = { pos: pose.pos, target: pose.target, fov: pose.fov, width: DESKTOP.width, height: DESKTOP.height };
  const gone = new Set();
  const ad = F.adapter({
    lens: () => cam,
    plate: (id) => {
      const u = layout.units.find(x => x.id === id), q = pose.plates[id];
      return u && q && !gone.has(id) ? { x: u.x, y: u.y, z: u.z, lift: q.lift, big: q.big } : null;
    },
    zone: (id) => layout.zones.find(z => z.id === Number(id)) || null,
    size: (big) => L.plateSize(layout.view, big)
  });
  return { layout, pose, ad, setCam(c) { cam = c; }, remove(id) { gone.add(id); } };
}
const inside = (r, v) => r.left >= -1e-6 && r.right <= v.width + 1e-6 && r.top >= v.top - 1e-6 && r.bottom <= v.height - v.bottom + 1e-6;
const near = (a, b, tag) => assert.ok(Math.abs(a - b) < 1e-6, `${tag}：${a} ≠ ${b}`);

/* ---------- 适配器 ---------- */
test("适配器：三个演示战场 × 远 / 中 / 近，铭牌的屏幕矩形和镜头模块自己算的一样，看的那个区（远景是全部）的铭牌和地台都在顶栏和技能栏之间", () => {
  const F = fxm(), bob = L.CONFIG.plate.bob;
  Object.keys(DEMOS).forEach(id => {
    const d = demo(id), pv = d.pv();
    const zones = [...new Set(L.build(pv, { view: DESKTOP }).units.map(u => u.zone))];
    ["far", "mid", "near"].forEach(tier => zones.forEach(zone => {
      const R = rig(pv, tier, zone), tag = `${id} · ${tier} · ${zone} 区`;
      const shown = tier === "far" ? R.layout.units : R.layout.units.filter(u => u.zone === R.pose.zone);
      assert.ok(shown.length > 0, tag);
      shown.forEach(u => {
        const r = R.ad.rectOf(u.id), q = R.pose.plates[u.id].rect;
        assert.ok(r, tag + "：拿得到矩形");
        // 和 hd2d-camera.js · pose 给的铭牌矩形同一个（它的上下各让出了待机浮动的 bob）
        near(r.left, q.x0, tag + " left"); near(r.right, q.x1, tag + " right"); near(r.top, q.y0 + bob, tag + " top"); near(r.bottom, q.y1 - bob, tag + " bottom");
        // attack-fx 要的中心：x 在正中，y 在卡片高 42% 处（和 game.js / online-ui.js 的 rectOf 一样）
        near(r.x, (r.left + r.right) / 2, tag + " x"); near(r.y, r.top + r.h * F.FX.anchorY, tag + " y");
        assert.equal(r.width, r.w); assert.equal(r.height, r.h);
        assert.ok(inside(r, DESKTOP), `${tag}：${u.plate.name} 的矩形 ${JSON.stringify([r.left, r.top, r.right, r.bottom].map(Math.round))} 出了画面`);
      });
      // 区 → 地台顶面的外框：看的那个区（远景是每个区）整块在画面里
      (tier === "far" ? R.layout.zones.map(z => z.id) : [R.pose.zone]).forEach(z => {
        const r = R.ad.zoneRectOf(z);
        assert.ok(r && r.w > 0 && r.h > 0, tag + "：地台矩形");
        assert.ok(inside(r, DESKTOP), `${tag}：${z} 区的地台出了画面`);
      });
    }));
  });
});

test("适配器跟着镜头走：换段、玩家拖动转过去以后，矩形按这一刻的镜头重新投影（和测试里另写的透视投影一样）；track 每次拿当时的；拿掉的铭牌留在最后看到的地方", () => {
  const F = fxm(), P = L.CONFIG.plate;
  const d = demo("cross"), pv = d.pv();
  const far = rig(pv, "far", 5), closer = rig(pv, "near", 5);
  const u = far.layout.units.find(x => x.zone === 5);
  const a = far.ad.rectOf(u.id), b = closer.ad.rectOf(u.id);
  assert.ok(b.w > a.w * 1.3, "近景的铭牌（放大的那张）在屏幕上更大");
  assert.ok(Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 20, "换段以后矩形跟着变");
  // 玩家左键拖动：绕着看的那一点转 0.35 弧度、俯角抬高一点
  const t = far.pose.target, dist = far.pose.dist, az = 0.35, el = (far.pose.elevation + 6) * Math.PI / 180;
  const pos = { x: t.x + dist * Math.cos(el) * Math.sin(az), y: t.y + dist * Math.sin(el), z: t.z + dist * Math.cos(el) * Math.cos(az) };
  const track = far.ad.track(u.id);
  far.setCam({ pos, target: t, fov: far.pose.fov, width: DESKTOP.width, height: DESKTOP.height });
  const r = far.ad.rectOf(u.id);
  // 另写一个透视投影（lookAt：前方 = 看的那一点 − 镜头，右 = 前方 × 世界上方，上 = 右 × 前方）
  const sub = (p, q) => ({ x: p.x - q.x, y: p.y - q.y, z: p.z - q.z }), dot = (p, q) => p.x * q.x + p.y * q.y + p.z * q.z;
  const cross = (p, q) => ({ x: p.y * q.z - p.z * q.y, y: p.z * q.x - p.x * q.z, z: p.x * q.y - p.y * q.x });
  const unit = (p) => { const n = Math.hypot(p.x, p.y, p.z); return { x: p.x / n, y: p.y / n, z: p.z / n }; };
  const f = unit(sub(t, pos)), rt = unit(cross(f, { x: 0, y: 1, z: 0 })), up = cross(rt, f);
  const th = Math.tan(far.pose.fov * Math.PI / 360), asp = DESKTOP.width / DESKTOP.height;
  const anchor = { x: u.x, y: u.y, z: u.z }, v = sub(anchor, pos), zc = dot(v, f);
  const sx = (dot(v, rt) / (zc * th * asp) + 1) / 2 * DESKTOP.width, sy = (1 - dot(v, up) / (zc * th)) / 2 * DESKTOP.height;
  const k = Math.min(P.maxScale, Math.max(P.minScale, Math.pow(dist / Math.hypot(v.x, v.y, v.z), P.scaleExp)));
  const lift = far.pose.plates[u.id].lift, w = P.w * k, h = P.h * k;
  near(r.left, sx - w / 2, "拖动后 left"); near(r.right, sx + w / 2, "拖动后 right"); near(r.bottom, sy - lift, "拖动后 bottom"); near(r.top, sy - lift - h, "拖动后 top");
  assert.ok(Math.abs(r.x - a.x) > 5, "转过去以后矩形变了");
  assert.deepEqual(track(), r, "track 拿的是这一刻的");
  far.remove(u.id);
  assert.deepEqual(far.ad.rectOf(u.id), r, "铭牌拿掉了（被击倒）：留在最后看到的地方，红叉 / 数字不会跳走");
  assert.equal(F.adapter({ lens: () => null, plate: () => null, zone: () => null, size: () => null }).rectOf("nobody"), null, "从来没见过的单位：没有矩形");
});

/* ---------- 伤害数字 ---------- */
const DAMAGE_RUN = (id) => [
  { unitId: id, kind: "dmg", text: "6", el: "energy" }, { unitId: id, kind: "brk", text: "击破1", el: "energy" }, { unitId: id, kind: "big", text: "23!!", el: "fire" },
  { unitId: id, kind: "word", text: "灼烧", el: "fire" }, { unitId: id, kind: "dmg", text: "12", el: "physical" }, { unitId: id, kind: "block", text: "格挡", el: "physical" }
];
const apart = (a, b) => a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;
test("伤害数字不重叠：三个演示战场 × 远 / 中 / 近，看的那个区里每个人同时弹 6 个（多段伤害、击破、大伤害、状态字、格挡），两两不压住（连往上飘的那一截），都在画面里、不顶进顶栏", () => {
  const F = fxm();
  Object.keys(DEMOS).forEach(id => {
    const d = demo(id), pv = d.pv();
    const zones = [...new Set(L.build(pv, { view: DESKTOP }).units.map(u => u.zone))];
    ["far", "mid", "near"].forEach(tier => zones.forEach(zone => {
      const R = rig(pv, tier, zone), tag = `${id} · ${tier} · ${zone} 区`;
      const who = R.layout.units.filter(u => u.zone === R.pose.zone);
      const list = who.flatMap(u => DAMAGE_RUN(u.id));
      const placed = F.placeNumbers(list, R.ad.rectOf, DESKTOP);
      assert.equal(placed.length, list.length, tag + "：每个数字都弹得出来");
      placed.forEach((a, i) => {
        assert.ok(a.box.x0 >= 0 && a.box.x1 <= DESKTOP.width && a.box.y0 >= DESKTOP.top, `${tag}：「${a.text}」出了画面 / 顶进顶栏`);
        assert.ok(a.box.y1 - a.box.y0 >= a.h + F.FX.num.rise - 1e-9, tag + "：占的范围算上了往上飘的那一截");
        placed.slice(i + 1).forEach(b => assert.ok(apart(a.box, b.box), `${tag}：「${a.text}」和「${b.text}」压住了`));
      });
    }));
  });
});

test("伤害数字近景大、远景小（按铭牌在屏幕上的宽缩放）；大伤害 > 普通伤害 > 击破；颜色：伤害按属性（和 attack-fx.js 的 COL 一样），击破 / 治疗 / 格挡各一种；不在画面里的铭牌不弹", () => {
  const F = fxm();
  const d = demo("mine"), pv = d.pv();
  const far = rig(pv, "far", 3), mid = rig(pv, "mid", 3), close = rig(pv, "near", 3);
  const u = far.layout.units.find(x => x.zone === 3);
  const one = [{ unitId: u.id, kind: "dmg", text: "6", el: "energy" }];
  const size = (R) => F.placeNumbers(one, R.ad.rectOf, DESKTOP)[0].size;
  assert.ok(size(close) > size(mid) * 1.2 && size(close) > size(far) * 1.3, `近景 ${size(close)} 比中景 ${size(mid)}、远景 ${size(far)} 大`);
  const S = F.FX.num.size;
  assert.ok(S.big > S.dmg && S.dmg > S.brk, "大伤害 > 普通伤害 > 击破");
  const r = far.ad.rectOf(u.id);
  ["dmg", "big", "brk", "word"].forEach(k => assert.ok(F.sizeOf(k, r) >= S[k] * F.FX.num.scale.min - 1e-9 && F.sizeOf(k, r) <= S[k] * F.FX.num.scale.max + 1e-9, k + " 的字号夹在缩放范围里"));
  Object.keys(AF.COL).forEach(el => assert.equal(F.FX.num.colors[el], AF.COL[el], el + " 的颜色和 attack-fx.js 一样"));
  assert.equal(F.colorOf({ kind: "dmg", el: "fire" }), AF.COL.fire);
  assert.equal(F.colorOf({ kind: "big", el: "ice" }), AF.COL.ice);
  assert.equal(new Set(["brk", "heal", "block"].map(k => F.colorOf({ kind: k, el: "fire" }))).size, 3, "击破 / 治疗 / 格挡各一种颜色");
  // 近景看 1 区：3 区的铭牌在画面外，不弹
  const other = rig(pv, "near", 1);
  assert.equal(F.placeNumbers(one, other.ad.rectOf, DESKTOP).length, 0, "铭牌不在画面里：不弹");
});

/* ---------- 演示出招：房主结算 + 投影，演出只读包 ---------- */
const deep = (o, seen = new Set()) => { if (o && typeof o === "object" && !seen.has(o)) { seen.add(o); Object.values(o).forEach(v => deep(v, seen)); } return seen; };
test("演示出招：房主用规则真的结算一次普通攻击，生成和联机玩家收到的一样的包（OnlineView.projectPacket 投影过：state / tape / fx / 公开日志），包里没有坚毅生命，也不和房主的 state 共用对象", () => {
  const Ho = host();
  Object.keys(DEMOS).forEach(id => {
    const d = demo(id), before = d.pv();
    const me = d.st.units.find(u => u.isPlayer);
    const hp0 = new Map(d.st.units.map(u => [u.id, Ho.hpOf(u)]));
    const packet = Ho.strike(d.env, { actorId: me.id });
    assert.ok(packet, id + "：打得出来");
    assert.equal(packet.displayOnly, true, id + "：是投影过的包（玩家那一份）");
    // 坚毅生命的数值（shp / shpMax）不在包里；白名单只放行「是不是站在坚毅生命上」这个开关（upOnShp，联机单位卡本来就有）
    const json = JSON.stringify(packet);
    assert.ok(!/"shp(?:Max)?"\s*:/i.test(json) && !json.includes(String(SHP)) && !json.includes(String(SHP_MAX)), id + "：包里没有坚毅生命的数值");
    assert.ok(packet.fx && packet.fx.move && packet.fx.actor && packet.fx.target, id + "：有攻击演出（谁打谁、招式）");
    assert.ok(packet.state.units.some(u => u.id === packet.fx.actor) && packet.state.units.some(u => u.id === packet.fx.target), id + "：出手的人和目标都在包里");
    const dmg = packet.tape.filter(e => e.kind === "dmg");
    assert.ok(dmg.length >= 1 && dmg.every(e => e.type === "pop" && e.unitId), id + "：演出带里有伤害");
    // 规则真的结算了：目标掉血（房主这边），包里的目标也比出招前少
    const t = packet.fx.target, raw = d.st.units.find(u => u.id === t);
    assert.ok(Ho.hpOf(raw) < hp0.get(t), id + "：目标真的掉血了");
    const hpOf = (view) => { const u = view.units.find(x => x.id === t); return u ? u.layers.reduce((s, l) => s + l.current, 0) : 0; };
    assert.ok(hpOf(packet.state) < hpOf(before), id + "：包里的目标血量比出招前少");
    assert.ok(packet.publicLogs.length === 1 && packet.publicLogs[0].kind === "action" && /·/.test(packet.publicLogs[0].text), id + "：公开日志走白名单（谁 · 用了什么）");
    // 不共用对象：房主再改自己的 state，包不跟着变
    const rawObjs = deep(d.st);
    assert.ok([...deep(packet)].every(o => !rawObjs.has(o)), id + "：包和房主的 state 没有共用的对象");
  });
  // 谁都够不着 / 敌人都倒下：null
  const d = demo("mine");
  d.st.units.filter(u => !u.isPlayer).forEach(u => { u.dead = true; });
  assert.equal(Ho.strike(d.env, {}), null);
});

test("演出只读投影数据：cues 只看包（fx / tape / state），数字都来自投影里的 value；打在坚毅生命上的（投影不给数）只演打中、不弹数字；击倒、格挡、大伤害照包里的数据演", () => {
  const F = fxm(), Ho = host();
  const d = demo("mine"), before = d.pv();
  const me = d.st.units.find(u => u.kit === "ruby");
  const packet = Ho.strike(d.env, { actorId: me.id });
  const frozen = JSON.parse(JSON.stringify(packet));
  (function freeze(o) { if (o && typeof o === "object") { Object.freeze(o); Object.values(o).forEach(freeze); } })(frozen);
  const cue = F.cues(frozen, { before, bigHit: d.ctx.bigHitInfo });
  assert.equal(cue.actor, packet.fx.actor); assert.equal(cue.target, packet.fx.target); assert.deepEqual(cue.move, packet.fx.move);
  const mains = packet.tape.filter(e => e.kind === "dmg" && e.main);
  assert.equal(cue.waves.length, mains.length, "每一段主攻击一下打中");
  const values = new Set(packet.tape.filter(e => typeof e.value === "number").map(e => String(e.value)));
  cue.numbers.forEach(n => {
    const v = n.text.replace(/^击破|^\+|!!$/g, "");
    assert.ok(values.has(v) || /^\D+$/.test(n.text), `数字「${n.text}」是包里的`);
    assert.ok(!n.text.includes(String(SHP)), "没有坚毅生命");
  });
  assert.ok(cue.numbers.some(n => n.kind === "brk"), "击破有自己的样子");
  // 打在坚毅生命上：主机的原始演出带有数（伤害 30），投影后 value 没了 → 只演打中、不弹数字
  const victim = d.st.units.find(u => u.isPlayer);
  victim.upOnShp = true; victim.dying = true;
  const raw = { type: "result", state: d.st, tape: [{ type: "pop", unitId: victim.id, kind: "dmg", value: 30, element: "fire", main: true }], fx: { actor: d.st.units.find(u => !u.isPlayer).id, target: victim.id, move: { kind: "slash", el: "fire", melee: true } } };
  const pk = OV.projectPacket(raw, { recipientId: Ho.HOST.recipient, gmId: Ho.HOST.gm });
  assert.equal(pk.tape[0].value, undefined, "白名单不给打在坚毅生命上的数");
  const c2 = F.cues(pk, {});
  assert.equal(c2.waves.length, 1, "照样演打中");
  assert.equal(c2.numbers.length, 0, "不弹数字");
  // 大伤害（规则的 bigHitInfo：等级 × 2 + 8 起）、格挡、击倒，都只看包
  const foe = before.units.find(u => !u.isPlayer);
  const pk3 = { fx: { actor: me.id, target: foe.id, move: { kind: "smash", el: "physical" }, parried: true },
    tape: [{ type: "pop", unitId: foe.id, kind: "dmg", value: 99, element: "physical", main: true }],
    state: { units: before.units.map(u => (u.id === foe.id ? Object.assign({}, u, { dead: true }) : u)) } };
  const c3 = F.cues(pk3, { before, bigHit: d.ctx.bigHitInfo });
  assert.ok(c3.numbers.some(n => n.kind === "big" && n.text === "99!!"), "大伤害：数字后面加 !!、放大");
  assert.ok(c3.numbers.some(n => n.kind === "block" && n.text === "格挡"), "格挡：弹「格挡」");
  assert.deepEqual(c3.ko, [foe.id], "出招前站着、包里倒下了：击倒");
  assert.deepEqual(F.cues({}, {}).waves, [], "空包不出错");
});

/* ---------- 页面接线 ---------- */
test("原型页：「演示出招」按钮、加载 attack-fx / hit-fx / hd2d-fx / hd2d-host / hd2d-play；房主结算出包，画面只拿包播（打中时铭牌换成包里的 state）；播放模块不碰房主的 state；假网页里也打得出来", () => {
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
  const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(html.includes('id="demo-strike"'), "页面上有「演示出招」按钮");
  const pos = (f) => html.indexOf(`<script src="${f}"></script>`);
  ["../../attack-fx.js", "../../hit-fx.js", "hd2d-fx.js", "hd2d-host.js", "hd2d-play.js"].forEach(f => assert.ok(pos(f) > 0, "加载 " + f));
  assert.ok(pos("../../online-view.js") < pos("../../attack-fx.js") && pos("hd2d-camera.js") < pos("hd2d-fx.js") && pos("hd2d-fx.js") < pos("hd2d-play.js"), "加载顺序");
  assert.ok(/HD2DHost\.strike\(env,/.test(mod), "房主那边用规则结算（HD2DHost.strike）");
  assert.ok(/HD2DPlay\.play\(packet, fxAdapter\(\),/.test(mod), "画面只把包交给 HD2DPlay.play");
  assert.ok(/function showPacket\(packet\) \{\s*pv = packet\.state;/.test(mod) && /onImpact: \(\) => showPacket\(packet\)/.test(mod), "打中的那一刻画面换成包里的 state");
  assert.ok(/HD2DFx\.adapter\(\{ lens: \(\) => sc\.lensNow\(\), plate: \(id\) => sc\.plateOf\(id\)/.test(mod), "适配器问场景这一刻的镜头和铭牌");
  assert.ok(!/publicLogs\.push/.test(mod), "不往房主的公开日志里写（日志用包里投影好的）");
  const play = fs.readFileSync(path.join(DIR, "hd2d-play.js"), "utf8");
  assert.ok(/F\.cues\(packet,/.test(play), "播放按包排演出");
  assert.ok(!/\bst\b|HD2D\.state|BattleSim|runSkill|\.shp\b/.test(play.replace(/\/\*[\s\S]*?\*\//g, "")), "播放模块不碰房主的 state / 规则");
  ["windup", "travel", "impact", "ko", "clash", "after"].forEach(k => assert.ok(new RegExp("AttackFx\\." + k + "\\(").test(play), "复用 attack-fx 的 " + k));
  assert.ok(/HitFx\.burst\(/.test(play), "复用 hit-fx 的受击粒子");
  const scene = fs.readFileSync(path.join(DIR, "hd2d-scene.js"), "utf8");
  assert.ok(/lensNow\(\) \{/.test(scene) && /plateOf\(id\) \{/.test(scene) && /zoneOf\(id\) \{/.test(scene), "场景给适配器的接口");
  const css = fs.readFileSync(path.join(DIR, "hd2d.css"), "utf8");
  assert.ok(/\.hd2d-num \{[^}]*-webkit-text-stroke: var\(--ink\)/.test(css) && /prefers-reduced-motion: reduce\) \{\s*\.hd2d-num/.test(css), "纸片风数字：墨线描边；减少动态效果时不弹不飘");
  // 假网页：照 index.html 的顺序加载普通脚本，不报错；页面环境里（G = window）打得出来，包里没有 shp
  const page = require("./hd2d-fake-page").load();
  assert.deepEqual(page.errors, [], "加载时报错");
  ["HD2DFx", "HD2DHost", "HD2DPlay", "AttackFx", "HitFx"].forEach(k => assert.ok(page.ctx[k], "页面里有 " + k));
  const st = DEMOS.cross(page.ctx.BattleSim);
  st.units.forEach(u => { u.shp = SHP; });
  const packet = page.ctx.HD2DHost.strike({ G: page.ctx, state: st, BattleSim: page.ctx.BattleSim, OnlineView: page.ctx.OnlineView, AttackFx: page.ctx.AttackFx }, { actorId: st.units.find(u => u.isPlayer).id });
  assert.ok(packet && packet.fx && packet.tape.length, "页面环境里打得出来");
  assert.ok(!/"shp(?:Max)?"\s*:|7771/.test(JSON.stringify(packet)), "没有坚毅生命的数值");
  assert.deepEqual(page.errors, [], "出招时报错");
});
