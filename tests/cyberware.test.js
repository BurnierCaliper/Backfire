// 义体框架（cyberware.js）：改造率、伤害骰、坚毅最少留 1、过度安装、拆除可逆、冲突、玩家视图不漏坚毅
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");
const V = require("../online-view");

const c = H.load();
const run = (src) => vm.runInContext(src, c);
const J = v => JSON.parse(JSON.stringify(v));
const hero = (lv, extra) => Object.assign({ kit: "t", name: "测试", attrs: { str: 5, con: 6, dex: 5, wil: 6, int: 6, sta: 5 }, level: lv, shp: 20, shpMax: 20, cyberware: [] }, extra || {});
// 测试用：档位模板（不进正式目录的公式检查用 cyberwareNormalize）
c.__h = null;
function withHero(h, src) { c.__h = h; return run(src); }

test("正式目录是单体伤害型模板（打击 / 射击义体 .vol1–.vol4，#262），没有示例；示例要显式加载", () => {
  assert.deepEqual(J(run("Object.keys(CYBERWARE)")), ["strike_v1", "strike_v2", "strike_v3", "strike_v4", "shot_v1", "shot_v2", "shot_v3", "shot_v4"]);
  assert.equal(run("Object.keys(CYBERWARE).some(k => CYBERWARE[k].example)"), false);
  assert.deepEqual(J(run("cyberwareLoadExamples()")), ["example_t5_melee"]);
  const d = J(run("cyberwareDef('example_t5_melee')"));
  assert.equal(d.example, true); assert.equal(d.tier, 5); assert.equal(d.hpCut, 5); assert.equal(d.occupancy, 0.15);
  assert.equal(d.break, 2); assert.equal(d.fireShp, 2); assert.equal(d.dailyShp, 2);
});

test("改造率：6体质6智力，攻击义体 5/10/15/20 级占用与剩余", () => {
  const want = { 5: [38, 28.2, 12], 10: [68, 29.7, 21], 15: [98, 30.3, 29], 20: [128, 30.6, 38] };
  for (const tier of [5, 10, 15, 20]) {
    const id = "tpl_" + tier;
    run(`cyberwareRegister({ id: "${id}", name: "模板${tier}", tier: ${tier}, kind: "attack" })`);
    const h = hero(tier, { cyberware: [{ id }] });
    const r = J(withHero(h, "cyberwareRate(__h)"));
    assert.equal(r.baseHp, want[tier][0]);
    assert.ok(Math.abs(r.cap - 0.6) < 1e-9);
    assert.ok(Math.abs(r.total * 100 - want[tier][1]) < 0.1, `${tier}: ${r.total}`);
    assert.equal(Math.round(r.remainingHp), want[tier][2]);
    const v = J(withHero(h, "cyberwareView(__h)"));
    assert.equal(v.remainingHp, Math.floor(r.remainingHp));
    run(`delete CYBERWARE["${id}"]`);
  }
});

test("和血量层改造共用改造率", () => {
  run("cyberwareLoadExamples()");
  const h = hero(5, { cyberPlan: { armor: 4, shield: 0, sand: 0, spirit: false }, cyberware: [{ id: "example_t5_melee" }] });
  const r = J(withHero(h, "cyberwareRate(__h)"));
  assert.ok(Math.abs(r.layers - 4 / 38) < 1e-9);
  assert.ok(Math.abs(r.total - (5 / 38 + 0.15 + 4 / 38)) < 1e-9);
  // 血量层改造可用额度扣掉义体占用：(0.6 − 5/38 − 0.15) × 38 ≈ 12.1 点
  const rate = withHero(h, "cyberwareLayerRateFor(__h, 33)");
  assert.equal(run(`cyberConvertLimit(33, ${rate})`), 12);
});

test("伤害：近战 n×10 + nd20，远程每颗 d20 换 d12+2；不吃 atk", () => {
  for (const t of [5, 10, 15, 20]) {
    const n = t / 5;
    const m = J(run(`cyberwareDamageSpec(${t}, "melee")`)), r = J(run(`cyberwareDamageSpec(${t}, "ranged")`));
    assert.equal(m.flat, n * 10); assert.equal(m.dice.length, n); assert.ok(m.dice.every(d => d.sides === 20 && d.plus === 0));
    assert.ok(r.dice.every(d => d.sides === 12 && d.plus === 2));
    assert.equal(m.avg, n * 10 + n * 10.5); assert.equal(r.avg, n * 10 + n * 8.5);
    const lo = J(run(`cyberwareRollDamage(${t}, "ranged", () => 0)`)), hi = J(run(`cyberwareRollDamage(${t}, "melee", () => 0.9999)`));
    assert.equal(lo.total, n * 10 + n * 3); assert.equal(hi.total, n * 10 + n * 20);
  }
  assert.throws(() => run(`cyberwareRegister({ id: "bad", tier: 7 })`));
});

test("开火：扣 2 坚毅，每次短休 1 次；坚毅最少留 1", () => {
  run("cyberwareLoadExamples()");
  const h = hero(5, { shp: 3, cyberware: [{ id: "example_t5_melee" }] });
  const f = J(withHero(h, "cyberwareFire(__h, 'example_t5_melee', () => 0)"));
  assert.equal(f.ok, true); assert.equal(f.damage.total, 11); assert.equal(f.break, 2);
  assert.equal(h.shp, 1);
  assert.equal(J(withHero(h, "cyberwareFire(__h, 'example_t5_melee')")).ok, false);
  withHero(h, "cyberwareShortRest(__h)");
  assert.equal(J(withHero(h, "cyberwareFire(__h, 'example_t5_melee')")).ok, true);
  assert.equal(h.shp, 1);
  withHero(h, "cyberwareDayTick(__h)"); assert.equal(h.shp, 1);
  const h2 = hero(5, { shp: 10, cyberware: [{ id: "example_t5_melee" }] });
  assert.equal(withHero(h2, "cyberwareDayTick(__h)"), 2); assert.equal(h2.shp, 8);
});

test("过度安装：没专长不能装；有专长每超 5% 每天多扣 1；拆掉解除", () => {
  run("cyberwareLoadExamples()");
  run(`cyberwareRegister({ id: "tpl_b", name: "模板B", tier: 5, kind: "attack", range: "ranged" })`);
  run(`cyberwareRegister({ id: "tpl_c", name: "模板C", tier: 5, kind: "attack" })`);
  const h = hero(5, { shp: 30, cyberware: [{ id: "example_t5_melee" }, { id: "tpl_b" }] });  // 56.3%
  const pv = J(withHero(h, "cyberwareInstallPreview(__h, 'tpl_c')"));
  assert.equal(pv.ok, false); assert.equal(pv.overinstall, true);
  h.cyberOverinstall = true;
  const pv2 = J(withHero(h, "cyberwareInstallPreview(__h, 'tpl_c')"));
  assert.equal(pv2.ok, true); assert.equal(pv2.burden, "heavy"); assert.match(pv2.warning, /极大负担/);
  const purse = { kuizhi: 5000 };
  c.__p = purse; withHero(h, "cyberwareInstall(__h, 'tpl_c', __p)");
  assert.equal(purse.kuizhi, 2000);
  const r = J(withHero(h, "cyberwareRate(__h)"));     // 3×(5/38+0.15) = 84.5% → 超 24.5% → 5 档
  assert.equal(r.overSteps, 5);
  assert.equal(withHero(h, "cyberwareDailyCost(__h)"), 3 * 2 + 5);
  c.__p = { kuizhi: 9999 }; withHero(h, "cyberwareRemove(__h, 'tpl_c', __p)");
  assert.equal(J(withHero(h, "cyberwareRate(__h)")).overSteps, 0);
  ["tpl_b", "tpl_c"].forEach(id => run(`delete CYBERWARE["${id}"]`));
});

test("冲突标签：同类不能同时装", () => {
  run("cyberwareLoadExamples()");
  run(`cyberwareRegister({ id: "tpl_arm2", name: "另一只手", tier: 5, kind: "attack", conflict: "arm" })`);
  const h = hero(20, { cyberware: [{ id: "example_t5_melee" }] });
  const pv = J(withHero(h, "cyberwareInstallPreview(__h, 'tpl_arm2')"));
  assert.equal(pv.ok, false); assert.equal(pv.conflictWith, "example_t5_melee");
  run(`delete CYBERWARE["tpl_arm2"]`);
});

test("装上扣生命 / 坚毅上限，拆掉完全还原（growth.js 重算）；老存档没有义体不变", () => {
  run(`cyberwareRegister({ id: "tpl_20", name: "模板20", tier: 20, kind: "attack" })`);
  const u = Object.assign(hero(20), { isPlayer: true, layers: [{ type: "flesh", current: 128, max: 128, inner: true }], shp: 999, shpMax: 999 });
  c.__h = u; run("applyLevelStats(__h)");
  const hp0 = u.layers[0].max, shp0 = u.shpMax;
  assert.equal(hp0, 128);
  c.__p = { kuizhi: 1e6 }; run("cyberwareInstall(__h, 'tpl_20', __p)");
  assert.equal(u.layers[0].max, 108); assert.equal(u.shpMax, shp0 - 3);
  run("cyberwareRemove(__h, 'tpl_20', __p)");
  assert.equal(u.layers[0].max, hp0); assert.equal(u.shpMax, shp0); assert.equal(u.layers[0].current, 128);
  const old = Object.assign(hero(20), { isPlayer: true, layers: [{ type: "flesh", current: 128, max: 128, inner: true }] });
  delete old.cyberware; c.__h = old; run("applyLevelStats(__h)");
  assert.equal(old.layers[0].max, 128);
  assert.equal(J(run("cyberwareView(__h)")).installed.length, 0);
  run(`delete CYBERWARE["tpl_20"]`);
});

test("玩家视图 / 联机包不含坚毅数值", () => {
  run("cyberwareLoadExamples()");
  const h = hero(5, { shp: 17, shpMax: 23, cyberware: [{ id: "example_t5_melee" }] });
  const pkt = J(withHero(h, "cyberwarePacket(__h)"));
  pkt.view.shp = 17; pkt.shpMax = 23;   // 就算房主误塞，投影也要去掉
  const out = V.projectCyberware(pkt);
  const s = JSON.stringify(out);
  assert.doesNotMatch(s, /shp|Shp|坚毅/);
  assert.doesNotMatch(JSON.stringify(J(withHero(h, "cyberwareView(__h)"))), /shp|Shp|"17"|:17\b|:23\b/);
  assert.equal(out.view.installed[0].id, "example_t5_melee");
  assert.ok(["none", "strain", "heavy"].includes(out.view.burden));
  const pp = V.projectPacket({ type: "result", cyberware: pkt }, { recipientId: "p1", gmId: "host" });
  assert.ok(pp.cyberware); assert.doesNotMatch(JSON.stringify(pp.cyberware), /shp|Shp/);
});
