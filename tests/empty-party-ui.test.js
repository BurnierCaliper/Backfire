// 长线养成队伍空了的界面（#346）：任务板「休整」入口、「接下任务」预先置灰；抽取面板概率 / 保底提示 / 奎支从配置读
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");
const CFG = { share: { hero: 0.3, weapon: 0.4, craft: 0.3 }, pity: [{ below: 2, hero: 1 }, { below: 4, hero: 0.7 }],
  kuizhiMode: "byLight", kuizhiByLight: { gray: 100, blue: 150, purple: 500, gold: 1000 }, kuizhiFlat: { base: 100, extra: { gray: 0, blue: 0, purple: 0, gold: 0 } } };
function gacha() {
  const c = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "gacha-ui.js"), "utf8"), c, { filename: "gacha-ui.js" });
  return c.GachaUI;
}
/** 从 rogue-ui.js 里切出两个纯函数在 vm 里跑（同 gacha-rates.test.js 的 dailyRewardText） */
function rogueFns() {
  const src = fs.readFileSync(path.join(ROOT, "rogue-ui.js"), "utf8");
  const cut = (name) => { const s = src.indexOf(`  function ${name}(`); assert.ok(s >= 0, name); return src.slice(s, src.indexOf("\n  }\n", s) + 4); };
  const ctx = vm.createContext({ esc: String });
  vm.runInContext(cut("emptyPartyWhy") + cut("emptyRestHtml") + "\nthis.why = emptyPartyWhy; this.rest = emptyRestHtml;", ctx);
  return { ctx, src };
}
const D = (hero, extra) => Object.assign({ fusion: 3, cost: 1, canDraw: true, why: null, allMaxed: false, rates: { hero, weapon: (1 - hero) * 4 / 7, craft: (1 - hero) * 3 / 7 } }, extra);

test("队伍空（候补也没人）：任务板有「休整」入口调 camp，「接下任务」置灰写原因", () => {
  const { ctx, src } = rogueFns();
  const empty = { growth: true, party: [], reserve: [] };
  assert.equal(ctx.why(empty), "队伍里没有人，不能接任务");
  const h = ctx.rest(empty, "赫心融合体");
  assert.match(h, /<b>休整<\/b>/);
  assert.match(h, /队伍里没有人，休整一天可领 1 个赫心融合体，用抽取机招募角色/);
  assert.match(h, /id="r-board-camp"/);
  assert.match(src, /on\("r-board-camp", \(\) => act\(\{ action: "camp" \}\)\)/);
  assert.match(src, /const why = emptyPartyWhy\(run\) \|\| Rogue\.taskBlocked\(run, t\)/);
  // 有人 / 有候补（接任务会自动补上）/ 普通单局：都没有入口、不置灰
  for (const r of [{ growth: true, party: [{ kit: "kolt" }], reserve: [] }, { growth: true, party: [], reserve: [{ kit: "helu" }] }, { growth: false, party: [] }]) {
    assert.equal(ctx.why(r), null); assert.equal(ctx.rest(r, "x"), "");
  }
});

test("抽取面板：概率用 d.rates；保底生效时写提示；不再写「没有保底」", () => {
  const U = gacha();
  const base = U.panelHtml(D(0.3), "赫心融合体", CFG);
  assert.match(base, /角色 30%/); assert.doesNotMatch(base, /g-pity/); assert.doesNotMatch(base, /没有保底/);
  assert.match(base, /少于 2 人必出角色，少于 4 人出角色 70%/);
  const one = U.panelHtml(D(1), "赫心融合体", CFG);
  assert.match(one, /角色 100%/); assert.match(one, /武器升级材料 0%/); assert.match(one, /人手不足：必出角色/);
  const three = U.panelHtml(D(0.7), "赫心融合体", CFG);
  assert.match(three, /角色 70%/); assert.match(three, /武器升级材料 17.1%/); assert.match(three, /制作材料 12.9%/);
  assert.match(three, /人手不足：角色概率提高到 70%/);
  assert.doesNotMatch(U.panelHtml(D(0, { allMaxed: true }), "x", CFG), /人手不足/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "gacha-ui.js"), "utf8"), /灰 100 · 蓝 150/);
});

test("抽取面板：奎支数字从配置读（byLight / flat）", () => {
  const U = gacha();
  assert.match(U.panelHtml(D(0.3), "x", CFG), /每抽按光色附赠奎支：灰 100 · 蓝 150 · 紫 500 · 金 1000/);
  const c2 = Object.assign({}, CFG, { kuizhiByLight: { gray: 7, blue: 8, purple: 9, gold: 10 } });
  assert.match(U.panelHtml(D(0.3), "x", c2), /灰 7 · 蓝 8 · 紫 9 · 金 10/);
  const flat = Object.assign({}, CFG, { kuizhiMode: "flat", kuizhiFlat: { base: 200, extra: { gold: 300 } } });
  assert.match(U.panelHtml(D(0.3), "x", flat), /每抽附赠 200 奎支（按光色另加：金 \+300）/);
});

test("README：#346 那条有「界面」小条", () => {
  const md = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const s = md.indexOf("长线养成：全队永久死亡后队伍空了的处理");
  const e = md.indexOf("\n- **", s + 1);
  assert.match(md.slice(s, e), /\*\*界面\*\*/);
});
