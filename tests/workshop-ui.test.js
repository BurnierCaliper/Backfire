// 工坊 / 背包浮层（workshop-ui.js、backpack-ui.js、workshop-data-adapter.js）：分组、缺料不给成功率、背包分页、入口位置
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const H = require("./headless");
const ROOT = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

function setup() {
  const c = H.load();
  ["workshop-data-adapter.js", "workshop-ui.js", "backpack-ui.js"].forEach(f => vm.runInContext(read(f), c, { filename: f }));
  const run = c.Rogue.newRun({ party: ["kolt", "helu"], seed: "WSUI" });
  c.S.state.kuizhi = 100000;
  c.WorkshopUI.reset();
  return { c, run, W: c.WorkshopUI, D: c.WorkshopData, B: c.BackpackUI };
}
const recipeBlock = (html, id) => (html.match(new RegExp(`<li class="ws-recipe[^"]*" data-ws-pick="${id}"[\\s\\S]*?</li>`)) || [""])[0];

test("适配层直接用 PR #79 的接口（有就转发）", () => {
  const { c, run, D } = setup();
  assert.equal(D.workshopAvailable(run), c.Rogue.workshopAvailable(run));
  assert.deepEqual(JSON.parse(JSON.stringify(D.materialBar(run))), JSON.parse(JSON.stringify(c.Rogue.materialBar(run))));
  assert.equal(D.itemCategory("cm_scrap"), "material");
  assert.ok(D.recipesUsingMaterial("cm_coil").some(r => r.id === "fx_shock"));
});

test("配方分两组：材料够的进「可做」，缺的进「缺材料」，只写还差几份、不写成功率", () => {
  const { c, run, W, D } = setup();
  c.bagAdd("cm_scrap", 1); c.bagAdd("cm_coil", 2);       // 刚好够电解液罐（fx_shock）
  const m = D.hostWorkshopModel(run);
  const html = W.html(m);
  assert.match(recipeBlock(html, "fx_shock"), /ws-recipe ok/);
  const miss = recipeBlock(html, "fx_burn");
  assert.match(miss, /ws-recipe miss/);
  assert.match(miss, /还差 /);
  assert.doesNotMatch(miss, /%|成功率/);
  // 缺材料那组默认折叠
  assert.match(html, /<details class="ws-group ws-miss" >/);
});

test("选中缺材料的配方：详情有 ✗ 标记，没有成功率，按钮灰掉", () => {
  const { c, run, W, D } = setup();
  c.bagAdd("cm_scrap", 1);
  W.state.sel = "fx_burn";
  const html = W.html(D.hostWorkshopModel(run));
  const det = html.slice(html.indexOf('class="ws-col ws-detail"'));
  assert.match(det, /ws-no/);
  assert.match(det, /ws-yes/);
  assert.doesNotMatch(det.slice(0, det.indexOf("</div>")), /成功率/);
  assert.match(det, /<button type="button" class="g-btn r-main" disabled>材料不够<\/button>/);
});

test("选中能做的配方：每人成功率 + 打下手 + 制作指令", () => {
  const { c, run, W, D } = setup();
  c.bagAdd("cm_scrap", 1); c.bagAdd("cm_coil", 2);
  W.state.sel = "fx_shock";
  const html = W.html(D.hostWorkshopModel(run));
  assert.match(html, /成功率 <b>\d+(\.\d)?%<\/b>/);
  assert.match(html, /data-ws-helper=/);
  const cmd = html.match(/data-ws-cmd="([^"]+)"[^>]*>制作/);
  assert.ok(cmd, "有制作按钮");
  const parsed = JSON.parse(cmd[1].replace(/&quot;/g, '"'));
  assert.equal(parsed.action, "craft");
  assert.equal(parsed.jobs[0].item, "fx_shock");
  // 照这个指令真的能做
  const notes = c.Rogue.craft(run, parsed.jobs);
  assert.ok(notes.some(n => /电解液罐/.test(n)));
  assert.equal(c.bagCount("cm_coil") < 2, true, "材料扣掉了（成功全扣，失败扣一半）");
});

test("只看可做：缺材料那组不出现；分类标签按 kind 过滤", () => {
  const { c, run, W, D } = setup();
  c.bagAdd("cm_scrap", 1); c.bagAdd("cm_coil", 2);
  W.state.only = true;
  let html = W.html(D.hostWorkshopModel(run));
  assert.doesNotMatch(html, /ws-miss/);
  W.state.only = false; W.state.kind = "instant";
  html = W.html(D.hostWorkshopModel(run));
  assert.equal(recipeBlock(html, "fx_shock"), "", "电解液罐是投掷罐，不在弹针页");
  assert.notEqual(recipeBlock(html, "fx_melt"), "");
});

test("联机玩家模型：只用 viewFor 发来的 craft，缺料的没有成功率；排活而不是直接做", () => {
  const { c, run, W, D } = setup();
  c.bagAdd("cm_scrap", 1); c.bagAdd("cm_coil", 2);
  const grouped = c.Rogue.craftListGrouped(run, {});
  const r = JSON.parse(JSON.stringify({
    workshopAvailable: "bench", materialBar: c.Rogue.materialBar(run), heroes: [{ kit: "kolt", name: "科尔特", mine: true, purse: 500 }],
    craft: [{ kit: "kolt", name: "科尔特", grouped, previews: grouped.craftable.map(x => c.Rogue.craftPreview(run, "kolt", x.id, null, {})) }],
    workshop: { queue: [], learn: [], salvage: [], helpers: [{ kit: "kolt", name: "科尔特" }, { kit: "helu", name: "赫露" }] }
  }));
  const m = D.viewWorkshopModel(r);
  W.state.sel = "fx_shock";
  const html = W.html(m);
  assert.match(html, /排上/);
  assert.match(html, /setCraftJob/);
  assert.doesNotMatch(html, /craftQueued/, "开工只有房主能按");
  assert.doesNotMatch(recipeBlock(html, "fx_burn"), /%/);
});

test("背包：五个分页；点材料列出用到它的配方，能开工坊时有「去工坊」，战斗里只读", () => {
  const { c, run, B, D } = setup();
  c.bagAdd("cm_coil", 3); c.bagAdd("fx_burn", 1);
  B.state.tab = "material"; B.state.sel = "cm_coil";
  let html = B.html(D.hostBackpackModel(run));
  ["材料", "消耗品", "改装件", "义体", "关键道具"].forEach(t => assert.match(html, new RegExp(`data-bp-tab="[a-z]+" aria-pressed="(true|false)">${t}`)));
  assert.match(html, /废线圈/);
  assert.match(html, /电解液罐/);
  assert.match(html, /data-bp-workshop="cm_coil"/);
  html = B.html(D.hostBackpackModel(run, { battle: true }));
  assert.match(html, /只读/);
  assert.doesNotMatch(html, /data-bp-workshop/);
  B.state.tab = "consumable"; B.state.sel = "";
  assert.match(B.html(D.hostBackpackModel(run)), /燃烧瓶/);
});

test("适配层：modInstallPreview 转发 PR #79 的接口，没有改装槽时返回 null 不抛错", () => {
  const { run, D } = setup();
  const h = run.party[0];
  assert.equal(D.modInstallPreview(run, h.kit, h.weapons[0], "c_str_con", 0), null);
  assert.equal(D.modInstallPreview(null, "x", "y", "z"), null);
});

test("入口：工坊不再拼在页面底部；浮层在升级弹窗之下；悬停单位浮在天气之上的规则没动", () => {
  const ui = read("rogue-ui.js"), html = read("game.html"), css = read("workshop.css"), wfx = read("weather-fx.css");
  assert.doesNotMatch(ui, /craftPanel\(\)/);
  assert.match(ui, /WorkshopUI\.button\(WorkshopData\.workshopAvailable\(run\)\)/);
  ["workshop-data-adapter.js", "workshop-ui.js", "backpack-ui.js", "workshop.css", "backpack.css"].forEach(f => assert.ok(html.includes(f), f));
  assert.ok(html.indexOf("workshop-ui.js") < html.indexOf("rogue-ui.js"));
  assert.match(css, /\.ovl \{[^}]*z-index: 8500/);
  assert.match(wfx, /\.g-field \.unit-wrap:hover, \.g-field \.unit-wrap:focus-within, \.g-field \.unit-wrap\.is-hover \{ z-index: 7; \}/);
  assert.match(css, /\[data-weather\] \.ovl-card::before \{[^}]*z-index: -1; pointer-events: none/);
});
