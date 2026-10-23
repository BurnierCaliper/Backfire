// 诊所能换的肉体：(改造率上限 − 义体占用) × 原生命上限恰好是整数时，浮点误差不再少给 1 点（PR #275 审查发现）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");

const c = H.load();
const run = (src) => vm.runInContext(src, c);
const hero = (con, int, lv, ids) => ({ kit: "t", name: "测试", attrs: { str: 5, con, dex: 5, wil: 5, int, sta: 5 }, level: lv, shp: 20, shpMax: 20, cyberware: ids.map(id => ({ id })) });
// 和诊所（rogue.js · cyberInfo、trpg.js · trpgCyberInfo）一样用现上限 fleshMax = 原生命 − 义体扣掉的生命
const limitOf = (h) => { c.__h = h; return run("(() => { const b = cyberwareBaseHp(__h), fm = b - cyberwareHpCut(__h); return { base: b, fleshMax: fm, cap: cyberwareCap(__h), occ: cyberwareOccupancy(__h), limit: cyberConvertLimit(fm, (__h.cyberware || []).length ? cyberwareLayerRateFor(__h, fm) : cyberRateOf(__h.attrs, __h.level)) }; })()"); };
// 期望值：先四舍五入到 1e-6 消掉浮点噪声再向下取整
const want = (r) => Math.floor(Math.round(Math.max(0, r.cap - r.occ) * r.base * 1e6) / 1e6);

test("审查里的例子：体质 3、智力 5、5 级、装打击义体.vol1，能换 2 点", () => {
  const r = limitOf(hero(3, 5, 5, ["strike_v1"]));
  assert.equal(want(r), 2);
  assert.equal(r.limit, 2);
});

test("逐项比对：各种体质 / 智力 / 等级 / 义体组合，诊所上限都等于向下取整的真实值", () => {
  const ids = run("Object.keys(CYBERWARE)");
  let n = 0;
  for (const id of [null, ...ids]) for (let con = 1; con <= 10; con++) for (let int = 1; int <= 10; int++) for (const lv of [1, 5, 10, 15, 20]) {
    const r = limitOf(hero(con, int, lv, id ? [id] : []));
    if (r.fleshMax <= 0) continue;
    const w = id ? want(r) : Math.floor(Math.round(r.cap * r.fleshMax * 1e6) / 1e6);
    assert.equal(r.limit, w, `con${con} int${int} lv${lv} ${id}`);
    n++;
  }
  assert.ok(n > 1000);   // 现上限 ≤ 0 的组合跳过
});

test("cyberConvertLimit 本身：恰好整数的乘积不再少 1（没装义体也一样）", () => {
  // 修之前这两个都少 1（2 → 1、63 → 62）
  assert.equal(run("cyberConvertLimit(20, 0.5 - 0.4)"), 2);
  assert.equal(run("cyberConvertLimit(90, 0.7)"), 63);
  assert.equal(run("cyberConvertLimit(10, 0.79)"), 7);
});

test("顺带的文字：空手格挡日志、相位图鉴、猫类人特长", () => {
  const fs = require("node:fs"), path = require("node:path");
  const rd = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  assert.ok(!rd("app.js").includes("架势照扣（最少留 1）"));
  assert.ok(!rd("codex.js").includes("全场所有伤害减半"));
  assert.equal(run('RACE_CHECK_PERKS["猫类人-猫"].text'), "夜视：侦察 / 躲藏类检定优势");
});
