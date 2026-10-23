// Helumica 新技能（issue #345，作者 10/23 定）：6 级「规则干涉」、9 级「频域造物」（驻波墙）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(zoneMode) {
  const c = H.load();
  c.BattleSim.setup({ party: ["helu", "kolt"], enemies: [{ id: "thug_hammer", lv: 1, zone: 2 }], seed: "HRF" });
  c.startCombat();
  const st = c.S.state;
  if (zoneMode) st.zoneMode = zoneMode;
  const helu = c.findKit("helu", st.units);
  helu.level = 9; helu.zone = 1; helu.ap = 5; helu.bonus = 2;
  helu.resources = helu.resources || {};
  const kolt = c.findKit("kolt", st.units);
  kolt.zone = 1; kolt.ap = 1; kolt.bonus = 1; kolt.bonusMax = 1;
  const foe = st.units.find(u => !u.isPlayer);
  foe.zone = 2; foe.bonus = 0;
  foe.layers.forEach(l => { l.current = l.max = 500; });
  foe.def = foe.defMax = 99;
  // 场地：开战后才设的不是固有场地
  [1, 2, 3].forEach(z => { if (st.fields[z]) st.fields[z] = c.emptyField(); });
  return { c, st, helu, kolt, foe };
}
const cast = (c, helu, skill, picks, target) => {
  c.S.state.combatPhase = "player";
  return c.dispatch({ type: "skill", actor: helu.id, skill, target: target || null, picks });
};
const plain = (v) => JSON.parse(JSON.stringify(v));
const keysOf = (c, helu, id, picks) => plain(c.skillFlowSteps(id, helu, picks || {}).map(s => s.key));
/** 不经过技能，直接打一下（固定 atk、不掷骰），返回 { dmg, br }；flags 默认是一次攻击行动、无视射程 */
function hit(c, a, t, element, extra) {
  const before = t.layers.reduce((s, l) => s + l.current, 0), def0 = t.def;
  const out = c.dealTo(a, t, Object.assign({ atk: 40, mult: 1, element, baseBreak: 2, atkRange: "any", usePrep: false,
    flags: { action: true, anyRange: true, blockResolved: true } }, extra || {}));
  const after = t.layers.reduce((s, l) => s + l.current, 0);
  return { dmg: before - after, br: def0 - t.def, res: out && out.res };
}
const wall = (c, key, el, mode, by) => { const err = c.placeWaveWall(key, el, mode, by || null, []); assert.equal(err, null); };
const endRound = (c) => { c.endPlayerTurn(); c.endEnemyTurn(); };

/* ================= 规则干涉 ================= */

test("规则干涉：6 级解锁、花 1 行动点；把 1 距离以内的一区变成干涉场（取代原来的场地）", () => {
  const { c, st, helu } = field();
  const ids = (lv) => { helu.level = lv; return plain(c.skillList(helu).map(s => s.id)); };
  assert.ok(!ids(5).includes("helu_rule"));
  assert.ok(ids(6).includes("helu_rule"));
  assert.deepEqual(plain(c.skillCost("helu_rule")), { ap: 1 });
  c.setZoneField(2, "fire");
  const ap0 = helu.ap = 5;
  cast(c, helu, "helu_rule", { dest: 2 });
  assert.equal(st.fields[2].harmonic, true);
  assert.equal(c.fieldFireOn(st.fields[2]), false, "火场被干涉场取代");
  assert.equal(helu.ap, ap0 - 1);
  // 只能选 1 距离以内的区
  st.zoneMode = 3;
  assert.deepEqual(plain(c.skillFlowSteps("helu_rule", helu, {})[0].zones), [1, 2]);
});

test("规则干涉：分析过战场、取代了别的场地 → 同区自选的单位 +1 附赠动作；没分析过不给", () => {
  const { c, st, helu, kolt } = field();
  c.setZoneField(1, "acid");
  assert.deepEqual(keysOf(c, helu, "helu_rule", { dest: 1 }), ["dest"], "没分析过：没有选单位这一步");
  cast(c, helu, "helu_rule", { dest: 1 });
  assert.equal(st.fields[1].harmonic, true);
  assert.equal(kolt.bonus, 1, "没分析过战场不给附赠");

  helu.resources.scanned = true;
  c.setZoneField(1, "acid");
  assert.deepEqual(keysOf(c, helu, "helu_rule", { dest: 1 }), ["dest", "target"]);
  const step = c.skillFlowSteps("helu_rule", helu, { dest: 1 }).find(s => s.key === "target");
  assert.ok(step.units.some(u => u.id === kolt.id) && step.units.some(u => u.id === helu.id), "同区的单位都能选（Helumica 自己也行）");
  cast(c, helu, "helu_rule", { dest: 1, target: kolt.id }, kolt.id);
  assert.equal(st.fields[1].harmonic, true);
  assert.equal(kolt.bonus, 2);
});

test("规则干涉：附赠动作可以给敌人，可以超过上限", () => {
  const { c, st, helu, kolt, foe } = field();
  helu.resources.scanned = true;
  c.setZoneField(2, "electric");
  const units = c.skillFlowSteps("helu_rule", helu, { dest: 2 }).find(s => s.key === "target").units.map(u => u.id);
  assert.ok(units.includes(foe.id), "敌人也可以选");
  foe.bonus = 1; foe.bonusMax = 1;
  cast(c, helu, "helu_rule", { dest: 2, target: foe.id }, foe.id);
  assert.equal(st.fields[2].harmonic, true);
  assert.equal(foe.bonus, 2, "敌人 +1 附赠，超过上限");
  // 我方也超过上限
  kolt.bonus = 1; kolt.bonusMax = 1;
  c.setZoneField(1, "ice");
  cast(c, helu, "helu_rule", { dest: 1, target: kolt.id }, kolt.id);
  assert.equal(kolt.bonus, 2);
  assert.ok(kolt.bonus > kolt.bonusMax);
});

test("规则干涉：原本没有场地、原本就是干涉场都不给附赠", () => {
  const { c, st, helu, kolt } = field();
  helu.resources.scanned = true;
  assert.deepEqual(keysOf(c, helu, "helu_rule", { dest: 1 }), ["dest"], "没有场地：不问给谁");
  cast(c, helu, "helu_rule", { dest: 1 });
  assert.equal(st.fields[1].harmonic, true);
  assert.equal(kolt.bonus, 1);
  assert.deepEqual(keysOf(c, helu, "helu_rule", { dest: 1 }), ["dest"], "本来就是干涉场：不问给谁");
  cast(c, helu, "helu_rule", { dest: 1, target: kolt.id }, kolt.id);
  assert.equal(st.fields[1].harmonic, true);
  assert.equal(kolt.bonus, 1, "本来就是干涉场：不给");
  // 高地和场地共存，不算「别的场地」
  st.fields[1] = c.emptyField(); st.fields[1].highland = true;
  cast(c, helu, "helu_rule", { dest: 1 });
  assert.equal(kolt.bonus, 1);
  assert.equal(st.fields[1].highland, true);
});

test("规则干涉：深渊、损毁地面、固有场地、被锁定的场地照旧改不了（不扣行动点）", () => {
  const { c, st, helu } = field();
  helu.resources.scanned = true;
  const cases = [
    ["深渊", f => { f.abyss = true; }],
    ["损毁地面", f => { f.ruinOn = true; f.ruinHp = 30; }],
    ["固有场地", f => { f.fire = 1; f.fireOn = true; f.innate = true; }],
    ["锁定", f => { f.acid = true; f.fieldLock = "测试"; }]
  ];
  for (const [name, set] of cases) {
    st.fields[2] = c.emptyField(); set(st.fields[2]);
    assert.ok(!c.skillFlowSteps("helu_rule", helu, {})[0].zones.includes(2), name + "：不能选");
    helu.ap = 5;
    cast(c, helu, "helu_rule", { dest: 2 });
    assert.equal(st.fields[2].harmonic, false, name + "：没有变成干涉场");
    assert.equal(helu.ap, 5, name + "：不扣行动点");
  }
  // 1 距离以内都改不了：技能用不了，写原因
  st.fields[1] = c.emptyField(); st.fields[1].abyss = true;
  assert.match(String(c.skillRequirementError(helu, "helu_rule")), /干涉场/);
});

/* ================= 频域造物 ================= */

test("频域造物：9 级解锁、花 1 行动点；没扫描过战场不能用", () => {
  const { c, st, helu } = field();
  const ids = (lv) => { helu.level = lv; return plain(c.skillList(helu).map(s => s.id)); };
  assert.ok(!ids(8).includes("helu_forge"));
  assert.ok(ids(9).includes("helu_forge"));
  assert.deepEqual(plain(c.skillCost("helu_forge")), { ap: 1 });
  assert.match(String(c.skillRequirementError(helu, "helu_forge")), /扫描/);
  cast(c, helu, "helu_forge", { gap: "1-2", element: "fire", mode: "dampen" });
  assert.equal(st.gaps["1-2"].type, "open", "没扫描：没放出墙");
  assert.equal(helu.ap, 5, "没扫描：不扣行动点");
  helu.resources.scanned = true;
  assert.equal(c.skillRequirementError(helu, "helu_forge"), null);
  assert.deepEqual(keysOf(c, helu, "helu_forge", {}), ["gap"]);
  assert.deepEqual(keysOf(c, helu, "helu_forge", { gap: "1-2" }), ["gap", "element"]);
  assert.deepEqual(keysOf(c, helu, "helu_forge", { gap: "1-2", element: "fire" }), ["gap", "element", "mode"]);
  cast(c, helu, "helu_forge", { gap: "1-2", element: "fire", mode: "dampen" });
  assert.equal(st.gaps["1-2"].type, "wave");
  assert.deepEqual(plain({ el: st.gaps["1-2"].wave.el, mode: st.gaps["1-2"].wave.mode }), { el: "fire", mode: "dampen" });
  assert.equal(helu.ap, 4);
});

test("频域造物：能放多道（行动点够就行），任意间隙不限距离", () => {
  const { c, st, helu } = field(3);
  helu.resources.scanned = true;
  const opts = c.skillFlowSteps("helu_forge", helu, {})[0].options.map(o => o.value);
  assert.deepEqual(plain(opts), ["1-2", "2-3"], "离得远的 2–3 也能选");
  cast(c, helu, "helu_forge", { gap: "1-2", element: "ice", mode: "dampen" });
  cast(c, helu, "helu_forge", { gap: "2-3", element: "fire", mode: "amplify" });
  assert.equal(st.gaps["1-2"].type, "wave");
  assert.equal(st.gaps["2-3"].type, "wave");
  assert.equal(helu.ap, 3);
});

test("驻波墙·降幅：穿过的选定属性伤害减半、不造成击破；其他属性照常", () => {
  const { c, helu, foe } = field();
  const base = hit(c, helu, foe, "fire");
  const baseIce = hit(c, helu, foe, "ice");
  assert.ok(base.dmg > 0 && base.br > 0);
  wall(c, "1-2", "fire", "dampen", helu.id);
  const w = hit(c, helu, foe, "fire");
  assert.equal(w.dmg, Math.floor(base.dmg * 0.5));
  assert.equal(w.br, 0, "降幅：不造成任何击破");
  const other = hit(c, helu, foe, "ice");
  assert.equal(other.dmg, baseIce.dmg, "别的属性不受影响");
  assert.equal(other.br, baseIce.br);
  // 同区不穿墙
  const same = { ...foe };
  void same;
  foe.zone = 1;
  const near = hit(c, helu, foe, "fire");
  assert.equal(near.dmg, base.dmg, "同区：连线不经过间隙");
});

test("驻波墙·增幅：穿过的选定属性伤害 +25%（和其他百分比加算），击破照常；敌人打过来也一样", () => {
  const { c, helu, kolt, foe } = field();
  kolt.layers.forEach(l => { l.current = l.max = 500; });
  kolt.def = kolt.defMax = 99;
  const base = hit(c, helu, foe, "electric");
  const kBase = hit(c, foe, kolt, "electric");
  wall(c, "1-2", "electric", "amplify", helu.id);
  const w = hit(c, helu, foe, "electric");
  const pct = base.dmg / 40 - 1;   // 原来的百分比合计（克制 / 天气……），和 +25% 加在一起
  assert.equal(w.dmg, Math.floor(40 * (1 + pct + 0.25) + 1e-9));
  assert.equal(w.br, base.br, "增幅：击破照常");
  const k = hit(c, foe, kolt, "electric");
  assert.equal(k.dmg, Math.floor(40 * (kBase.dmg / 40 + 0.25) + 1e-9), "敌人隔着增幅墙打我方：同样 +25%");
  assert.equal(k.br, kBase.br);
});

test("驻波墙：一次攻击穿过两道墙，效果叠加两次（降幅 ×0.25、增幅 +50%）", () => {
  const { c, helu, foe } = field(3);
  foe.zone = 3;
  const base = hit(c, helu, foe, "acid");
  wall(c, "1-2", "acid", "dampen", helu.id);
  wall(c, "2-3", "acid", "dampen", helu.id);
  const two = hit(c, helu, foe, "acid");
  assert.equal(two.dmg, Math.floor(base.dmg * 0.25), "×0.5 再 ×0.5，不是 −100%");
  assert.equal(two.br, 0);
  wall(c, "1-2", "acid", "amplify", helu.id);
  wall(c, "2-3", "acid", "amplify", helu.id);
  const amp = hit(c, helu, foe, "acid");
  const pct = base.dmg / 40 - 1;
  assert.equal(amp.dmg, Math.floor(40 * (1 + pct + 0.5) + 1e-9), "+25% 两次 = +50%");
  assert.equal(amp.br, base.br);
});

test("驻波墙：范围攻击按每个目标各自判断", () => {
  const { c, st, helu, kolt, foe } = field(3);
  // 2 区、3 区各一个敌人：2–3 之间有降幅墙，从 2 区打范围攻击，只有隔着墙的那个减半
  const foe2 = foe;
  foe2.zone = 2;
  helu.zone = 2;
  wall(c, "2-3", "energy", "dampen", helu.id);
  const far = JSON.parse(JSON.stringify(foe2));
  far.id = "far-foe"; far.zone = 3;
  st.units.push(far);
  const near = hit(c, helu, foe2, "energy", { flags: { action: true, aoe: true, blockResolved: true } });
  const away = hit(c, helu, far, "energy", { flags: { action: true, aoe: true, blockResolved: true } });
  assert.equal(away.dmg, Math.floor(near.dmg * 0.5));
  void kolt;
});

test("单位穿过驻波墙：降幅墙不稳 + 虚弱，增幅墙坚挺 + 振奋（敌我都算）", () => {
  const { c, st, helu, kolt, foe } = field();
  wall(c, "1-2", "fire", "dampen", helu.id);
  c.doMove(kolt, 2);
  assert.equal(kolt.zone, 2, "驻波墙不挡移动");
  assert.equal(kolt.statuses.unstable, true);
  assert.equal(kolt.statuses.weak, true);
  wall(c, "1-2", "fire", "amplify", helu.id);
  helu.bonus = 1;
  c.doMove(helu, 2);
  assert.equal(helu.statuses.sturdy, true);
  assert.equal(helu.statuses.inspire, true);
  assert.ok(!helu.statuses.unstable && !helu.statuses.weak);
  // 敌人走过去也算（敌人回合）
  st.combatPhase = "enemy";
  foe.zone = 2; foe.bonus = 1; foe.ap = 1;
  c.doMove(foe, 1);
  assert.equal(foe.zone, 1);
  assert.equal(foe.statuses.sturdy, true);
  assert.equal(foe.statuses.inspire, true);
});

test("单位穿过驻波墙：被推 / 拉 / 击退这类被动位移也算", () => {
  const { c, helu, foe } = field();
  wall(c, "1-2", "ice", "dampen", helu.id);
  const notes = [];
  assert.equal(c.displaceTo(foe, 1, notes, "被推开"), true);
  assert.equal(foe.zone, 1);
  assert.equal(foe.statuses.unstable, true);
  assert.equal(foe.statuses.weak, true);
  assert.ok(notes.some(s => /驻波墙/.test(s)));
});

test("单位穿过驻波墙：技能里直接换区的移动也算（逃离），出手之前就生效", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ras", "helu"], enemies: [{ id: "thug_hammer", lv: 1, zone: 1 }], seed: "HRF2" });
  c.startCombat();
  const st = c.S.state;
  const ras = c.findKit("ras", st.units), helu = c.findKit("helu", st.units);
  const foe = st.units.find(u => !u.isPlayer);
  ras.level = 2; ras.zone = 1; ras.ap = 2; ras.bonus = 1; helu.zone = 1;
  foe.zone = 1; foe.layers.forEach(l => { l.current = l.max = 500; }); foe.def = foe.defMax = 99;
  c.placeWaveWall("1-2", "physical", "dampen", helu.id, []);
  st.combatPhase = "player";
  c.dispatch({ type: "skill", actor: ras.id, skill: "ras_flee", target: foe.id, picks: { dest: 2, target: foe.id } });
  assert.equal(ras.zone, 2);
  assert.equal(ras.statuses.weak, true, "逃离穿过降幅墙：虚弱");
  assert.equal(ras.statuses.unstable, true);
  // 逃离是「移动 → 对原区的敌人出手」：穿墙的虚弱在出手之前就生效（这一下 ATK −25%）
  const log = st.logPages.flatMap(p => p.lines.map(l => l.text)).join("\n");
  assert.ok(log.indexOf("穿过 1-2 区之间的驻波墙") >= 0);
  assert.ok(log.indexOf("攻击者虚弱") > log.indexOf("穿过 1-2 区之间的驻波墙"), "先穿墙，再出手（出手时已经虚弱）");
});

test("聚焦的单位穿过驻波墙：立刻推进一步序列（降幅、增幅都算）", () => {
  const { c, helu, foe } = field();
  const layer = foe.layers[0].type;
  c.applyFocus(foe, layer, []);
  const f = foe.focuses[0];
  f.seq = ["fire", "ice", "acid"];   // 当成首领的长序列，免得一步就抹层
  assert.equal(f.step, 0);
  wall(c, "1-2", "harmonic", "amplify", helu.id);
  c.displaceTo(foe, 1, [], "被拉过来");
  assert.equal(f.step, 1, "增幅墙：推进一步");
  wall(c, "1-2", "harmonic", "dampen", helu.id);
  c.displaceTo(foe, 2, [], "被推开");
  assert.equal(f.step, 2, "降幅墙：再推进一步");
});

test("驻波墙取代危墙 / 机关门 / 不稳桥梁 / 空隙：取代期间都能通过，一整轮结束后原样恢复", () => {
  const kinds = [
    ["危墙", { type: "wall", hp: 12, maxHp: 12, open: false, level: 2, lastFrom: null }],
    ["机关门", { type: "door", hp: 0, maxHp: 0, open: false, lastFrom: null }],
    ["不稳桥梁", { type: "bridge", hp: 20, maxHp: 25, open: false, lastFrom: null }],
    ["空隙", { type: "void", hp: 0, maxHp: 0, open: true, lastFrom: null }]
  ];
  for (const [name, gap] of kinds) {
    const { c, st, helu, kolt } = field();
    st.gaps["1-2"] = JSON.parse(JSON.stringify(gap));
    helu.resources.scanned = true;
    cast(c, helu, "helu_forge", { gap: "1-2", element: "fire", mode: "amplify" });
    assert.equal(st.gaps["1-2"].type, "wave", name + "：被暂时取代");
    assert.equal(c.lineBlocked(1, 2), false, name + "：取代期间不挡攻击");
    kolt.ap = 1; kolt.bonus = 1;
    c.doMove(kolt, 2);
    assert.equal(kolt.zone, 2, name + "：取代期间可以走过去");
    if (gap.type === "void") assert.equal(kolt.ap, 1, "空隙被取代：不用花行动点检定");
    // 我方回合结束：墙还在（敌人回合也算这一轮）
    c.endPlayerTurn();
    assert.equal(st.gaps["1-2"].type, "wave", name + "：敌人回合还在");
    c.endEnemyTurn();
    assert.deepEqual(plain(st.gaps["1-2"]), gap, name + "：一整轮结束后原样恢复");
    assert.equal(kolt.zone, 2, name + "：走过去的人留在对面");
  }
});

test("驻波墙：被取代的机关门照样受按钮控制，墙消失后按按钮的结果恢复", () => {
  const { c, st, helu } = field();
  st.gaps["1-2"] = { type: "door", hp: 0, maxHp: 0, open: false, lastFrom: null };
  const lever = c.makeProp("lever", 1, 1);
  lever.link = "1-2";
  st.props = [lever];
  wall(c, "1-2", "fire", "dampen", helu.id);
  c.toggleDevice(lever, "测试");
  assert.equal(lever.link, "1-2", "按钮 / 拉杆不会改连到别的门");
  endRound(c);
  assert.equal(st.gaps["1-2"].type, "door");
  assert.equal(st.gaps["1-2"].open, true, "墙在的时候扳过拉杆：门恢复成开着");
});

test("驻波墙：联机下发间隔时带上属性、降幅 / 增幅和暂时取代的东西（走白名单，不带放墙的人、到期回合）", () => {
  const { c, st, helu } = field();
  st.gaps["1-2"] = { type: "wall", hp: 9, maxHp: 12, open: false, lastFrom: null };
  wall(c, "1-2", "harmonic", "amplify", helu.id);
  const OV = require("../online-view.js");
  assert.ok(OV.pickKeys.has("gap") && OV.pickKeys.has("element") && OV.pickKeys.has("mode"), "分步的 key 联机玩家答得了");
  const out = OV.projectState(JSON.parse(JSON.stringify(st)));
  assert.deepEqual(JSON.parse(JSON.stringify(out.gaps["1-2"])),
    { hp: 0, maxHp: 0, open: true, type: "wave", wave: { el: "harmonic", mode: "amplify", saved: { hp: 9, maxHp: 12, open: false, type: "wall" } } });
  assert.doesNotMatch(JSON.stringify(out.gaps), /shp|until|"by"/);
});

test("联机 / 热座的权威校验：两个技能的分步照规则层的 skillFlowSteps 验，选错了在执行前拦下", () => {
  const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
  const { Hotseat } = require("../hotseat");
  const c = H.load();
  new vm.Script(fs.readFileSync(path.join(H.ROOT, "hotseat-validation.js"), "utf8")).runInContext(c);
  const s = c.S.state; c.loadLiveParty(["helu", "kolt"]);
  const a = s.units.find(u => u.kit === "helu"), b = s.units.find(u => u.kit === "kolt");
  const enemy = c.enemyPresets().find(x => x.id === "thug_knife").build(1, 2);
  enemy.zone = 2; s.units.push(enemy);
  c.startCombat(); a.level = 9; a.zone = 1; a.ap = 4; a.bonus = 4; b.ap = 4; b.bonus = 4;
  const session = Hotseat.create({ operators: ["a", "b"], gmId: "a", getUnits: () => s.units,
    canStand: u => !c.standUpBlocked(u), assignments: { [a.id]: "a", [b.id]: "b" } });
  session.beginRound(1); session.pick("a", a.id, 0); session.pick("b", b.id, 1); session.forceStart("a");
  const validate = (cmd) => c.HotseatValidation.validateBattle(cmd, { session, sender: "a" });
  const skill = (id, target, picks) => ({ type: "skill", actor: a.id, skill: id, target: target || null, picks: picks || {} });
  // 频域造物：没扫描不能用；扫描后三步都要选、都要合法
  assert.throws(() => validate(skill("helu_forge", null, { gap: "1-2", element: "fire", mode: "dampen" })), /扫描/);
  a.resources = a.resources || {}; a.resources.scanned = true;
  assert.equal(validate(skill("helu_forge", null, { gap: "1-2", element: "fire", mode: "dampen" })), true);
  assert.throws(() => validate(skill("helu_forge", null, { gap: "1-2", element: "fire" })), /分步/);
  assert.throws(() => validate(skill("helu_forge", null, { gap: "1-2", element: "plasma", mode: "dampen" })), /分步/);
  assert.throws(() => validate(skill("helu_forge", null, { gap: "1-9", element: "fire", mode: "dampen" })), /分步/);
  // 规则干涉：取代了别的场地时要选那一区的单位（敌人也行），技能目标要和分步一致
  s.fields[2] = c.emptyField(); c.setZoneField(2, "fire");
  assert.equal(validate(skill("helu_rule", enemy.id, { dest: 2, target: enemy.id })), true, "敌人也能选");
  assert.throws(() => validate(skill("helu_rule", null, { dest: 2 })), /分步/, "要给附赠时必须选单位");
  assert.throws(() => validate(skill("helu_rule", b.id, { dest: 2, target: b.id })), /分步/, "不在那一区的不能选");
  s.fields[1] = c.emptyField();
  assert.equal(validate(skill("helu_rule", null, { dest: 1 })), true, "没有场地可取代：只选区");
});

test("新画面（HD-2D）：间隔上贴驻波墙的字牌（属性、降幅 / 增幅），悬停走同一份说明", () => {
  const F = require("../hd2d/hd2d-field.js");
  assert.deepEqual(plain(F.waveTagsOf({ gaps: {
    "2-3": { type: "wave", wave: { el: "electric", mode: "amplify" } },
    "1-2": { type: "wave", wave: { el: "fire", mode: "dampen" } },
    "3-4": { type: "wall", hp: 3 }
  } })), [
    { key: "1-2", el: "fire", mode: "dampen", label: "火·降幅" },
    { key: "2-3", el: "electric", mode: "amplify", label: "电·增幅" }
  ]);
  assert.deepEqual(plain(F.waveTagsOf({ gaps: { "1-2": { type: "open" } } })), []);
  const fs = require("node:fs"), path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "hd2d", "hd2d-field.js"), "utf8");
  assert.match(src, /arrivals\(!!animate\);\s*syncWaveTags\(\);/, "每次排完战场都同步字牌");
  assert.match(src, /onUnitHover\("gap:" \+ t\.key, on, n\)/, "悬停字牌 = 悬停那条间隔");
  const ui = fs.readFileSync(path.join(__dirname, "..", "online-ui.js"), "utf8");
  assert.match(ui, /key\.indexOf\("gap:"\) === 0 \? \{ classList/, "联机玩家的新画面悬停字牌也有说明");
});

test("驻波墙：战场上看得出来（属性、增幅 / 降幅），悬停有说明；战斗模板只记原来的间隔", () => {
  const { c, st, helu } = field();
  st.gaps["1-2"] = { type: "bridge", hp: 14, maxHp: 20, open: false, lastFrom: null };
  wall(c, "1-2", "ice", "dampen", helu.id);
  const g = st.gaps["1-2"];
  assert.equal(c.waveWallName(g.wave), "驻波墙·冰·降幅");
  assert.match(c.waveWallText(g.wave), /冰属性伤害 ×0\.5，并且不造成任何击破/);
  assert.match(c.waveWallText(g.wave), /不稳和虚弱/);
  assert.match(c.waveWallText(g.wave), /不稳桥梁恢复/);
  assert.equal(c.gapLabel("wave"), "驻波墙");
  const codex = c.S.CODEX_PROPS.find(x => x.id === "wave");
  assert.ok(codex && codex.lines.some(l => /×0\.5/.test(l)) && codex.lines.some(l => /\+25%/.test(l)));
  const tpl = c.battleTemplateCapture("t");
  assert.equal(tpl.gaps["1-2"].type, "bridge", "战斗模板记的是被暂时取代的桥");
  // 画面：本机战场和联机玩家战场都按类型画（game.js · paintGaps、online-battle.js）
  const fs = require("node:fs"), path = require("node:path");
  const game = fs.readFileSync(path.join(__dirname, "..", "game.js"), "utf8");
  assert.match(game, /wave-\$\{wave\.mode === "amplify" \? "amplify" : "dampen"\} el-\$\{wave\.el\}/);
  assert.match(game, /waveWallText\(g\.wave\)/);
  const ob = fs.readFileSync(path.join(__dirname, "..", "online-battle.js"), "utf8");
  assert.match(ob, /gp\.type === "wave" && gp\.wave/);
  // 主持人工具：这条间隔是驻波墙时提醒一句（改类型会取消驻波墙，以主持人改的为准）
  const gm = fs.readFileSync(path.join(__dirname, "..", "online-gm-ui.js"), "utf8");
  assert.match(gm, /g\.type === "wave" && g\.wave \?[^:]*驻波墙/);
});

test("驻波墙：主持人中途改了这条间隔的类型 → 以主持人改的为准，回合结束不再恢复", () => {
  const { c, st, helu } = field();
  st.gaps["1-2"] = { type: "wall", hp: 9, maxHp: 12, open: false, lastFrom: null };
  wall(c, "1-2", "fire", "dampen", helu.id);
  Object.assign(st.gaps["1-2"], { type: "bridge", hp: 20, maxHp: 20 });   // gm-commands.js · editGap 的写法
  assert.equal(c.lineBlocked(1, 2), false);
  endRound(c);
  assert.equal(st.gaps["1-2"].type, "bridge");
  assert.equal(st.gaps["1-2"].wave, undefined, "留下的驻波墙记录清掉");
});
