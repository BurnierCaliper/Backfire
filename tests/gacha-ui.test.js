// 抽取机界面（gacha-ui.js）：面板按钮 / 概率 / 十连置灰，结果卡片按光色，汇总写名字、光色、升级和奎支合计。
// 截图：GACHA_SHOT=路径 时用 Playwright 拍十连结果。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");
function load() {
  const c = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "gacha-ui.js"), "utf8"), c, { filename: "gacha-ui.js" });
  return c.GachaUI;
}
const D = (fusion, extra) => Object.assign({ fusion, cost: 1, canDraw: fusion >= 1, why: fusion >= 1 ? null : "赫心融合体不够（要 1，有 0）", allMaxed: false, rates: { hero: 0.3, weapon: 0.4, craft: 0.3 } }, extra);

test("面板：显示融合体数量和三种概率；不够 10 个时十连置灰并写原因", () => {
  const U = load();
  const h = U.panelHtml(D(3), "赫心融合体");
  assert.match(h, /g-fusion">3</);
  assert.match(h, /角色 30%/); assert.match(h, /武器升级材料 40%/); assert.match(h, /制作材料 30%/);
  assert.match(h, /id="r-draw" >抽一次/);
  assert.match(h, /id="r-draw10" disabled[^>]*>赫心融合体不够十连（要 10，有 3）/);
  const ok = U.panelHtml(D(12), "赫心融合体");
  assert.match(ok, /id="r-draw10" >十连抽（10）/);
  const none = U.panelHtml(D(0), "赫心融合体");
  assert.match(none, /id="r-draw" disabled>赫心融合体不够/);
  assert.match(U.panelHtml(D(5, { allMaxed: true, rates: { hero: 0, weapon: 4 / 7, craft: 3 / 7 } }), "赫心融合体"), /只出材料/);
});

test("结果：卡片按光色，十连是网格；汇总有升级信息和奎支合计", () => {
  const U = load();
  const results = [
    { kind: "character", light: "gold", name: "柯尔特", levelUp: true, level: 3, kuizhi: 1000 },
    { kind: "character", light: "gold", name: "赫鲁", levelUp: false, level: 1, kuizhi: 1000 },
    { kind: "weapon_material", light: "purple", name: "紫材", kuizhi: 500 },
    { kind: "craft_material", light: "blue", name: "蓝材", kuizhi: 150 },
    { kind: "weapon_material", light: "gray", name: "废铁", kuizhi: 100 }
  ];
  const h = U.resultHtml({ results, kuizhi: 2750 });
  assert.match(h, /g-cards g-grid/);
  for (const l of ["gold", "purple", "blue", "gray"]) assert.match(h, new RegExp(`g-card g-${l}`));
  assert.match(h, /data-g="skip">跳过/);
  assert.match(h, /柯尔特<\/b><small>金光 · 已有角色 · 升到 3 级/);
  assert.match(h, /赫鲁<\/b><small>金光 · 新角色加入 · 1 级/);
  assert.match(h, /共获得 <b>2750<\/b> 奎支/);
  assert.doesNotMatch(U.resultHtml({ results: results.slice(0, 1), kuizhi: 1000 }), /g-grid/);
});
