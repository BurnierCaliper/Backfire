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

/* ---------- PR #80 评审修正 ---------- */
function onlineSetup() {
  const c = H.load(), R = c.Rogue, run = R.newRun({ party: ["kolt", "helu", "ruby"], seed: "WSON" });
  c.S.state.kuizhi = 100000;
  c.RunFlow = { current: () => run };
  c.OnlineGame = { isHost: () => true, players: () => [{ id: "host", online: true }, { id: "p2", online: true }] };
  ["online-rogue.js", "workshop-data-adapter.js", "workshop-ui.js", "backpack-ui.js"].forEach(f => vm.runInContext(read(f), c, { filename: f }));
  const O = c.OnlineRogue; O.enable(true, "host"); O.setOwners({ helu: "p2", ruby: "p2" });
  c.S.state.bag.items = [{ id: "cm_scrap", qty: 3 }, { id: "cm_coil", qty: 4 }, { id: "cm_chem", qty: 2 }, { id: "medkit", qty: 1 }];
  O.data(run).owned = { helu: { medkit: 1 } };
  c.WorkshopUI.reset();
  return { c, R, run, O, r: JSON.parse(JSON.stringify(O.viewFor("p2"))) };
}

test("评审 1：联机学配方 / 拆解用工坊里选中的角色出钱（一个玩家多名角色）", () => {
  const { c, r } = onlineSetup();
  const D = c.WorkshopData;
  assert.deepEqual(r.heroes.filter(h => h.mine).map(h => h.kit).sort(), ["helu", "ruby"]);
  assert.equal(D.payerKit(r, "ruby"), "ruby");
  assert.equal(D.payerKit(r, "helu"), "helu");
  assert.equal(D.payerKit(r, "kolt"), r.heroes.find(h => h.mine).kit, "别人的角色不能当出钱的人");
  assert.match(read("online-ui.js"), /WorkshopData\.payerKit\(view\.packet\?\.rogue, global\.WorkshopUI && global\.WorkshopUI\.state\.kit\)/);
});

test("评审 2：联机玩家在战斗里点背包，读房主发来的包，不读本机浏览器的背包", () => {
  const { c, r } = onlineSetup();
  c.S.state.bag.items = [{ id: "fx_burn", qty: 9 }];   // 玩家本机的背包（不该显示）
  c.OnlineGame = { getView: () => ({ active: true, isHost: false, packet: { rogue: r } }) };
  const m = c.BackpackUI.battleModel();
  assert.equal(m.readOnly, true);
  c.BackpackUI.state.tab = "consumable"; c.BackpackUI.state.sel = "";
  const html = c.BackpackUI.html(m);
  assert.match(html, /简易医疗包/);
  assert.doesNotMatch(html, /燃烧瓶/);
  assert.match(read("game.html"), /id="g-backpack"/);
});

test("评审 3：房主在 viewFor 里给每个打下手的选项都算好成功率，玩家端直接读、不再自己估", () => {
  const { c, R, run, r } = onlineSetup();
  const ruby = r.craft.find(x => x.kit === "ruby");
  const item = ruby.grouped.craftable[0].id;
  const helpers = ruby.previews.filter(p => p.id === item).map(p => p.helper);
  assert.deepEqual(helpers.slice().sort(), [null, "helu", "kolt"].sort());
  const m = c.WorkshopData.viewWorkshopModel(r);
  for (const h of ["kolt", "helu", null]) {
    const host = R.craftPreview(run, "ruby", item, h, {});
    assert.equal(m.preview("ruby", item, h).odds.chance, host.odds.chance, `helper ${h}`);
  }
  assert.doesNotMatch(read("workshop-ui.js"), /（估）|estimated/);
  assert.doesNotMatch(read("workshop-data-adapter.js"), /1 - \(1 - base\)/);
});

/* ---------- issue #366：工坊写道具效果 ---------- */
test("issue #366：配方列表（可做、缺材料）、选中配方的详情、学配方都写道具效果（ITEM_CATALOG 的 hint）", () => {
  const { c, run, W, D } = setup();
  const hint = id => c.ITEM_CATALOG[id].hint;
  c.bagAdd("cm_scrap", 1); c.bagAdd("cm_coil", 2);       // 电解液罐（fx_shock）能做，燃烧瓶（fx_burn）缺料
  run.smiths = ["tima"];                                   // 任务板前有季玛：能学巧手的配方（冰锥弹……）
  const m = D.hostWorkshopModel(run);
  let html = W.html(m);
  const g = m.grouped(W.state.kit);
  assert.ok(g.craftable.length && g.missing.length);
  g.craftable.concat(g.missing).forEach(r => {
    assert.ok(hint(r.id), `${r.id} 有说明`);
    assert.ok(recipeBlock(html, r.id).includes(hint(r.id)), `列表里的${r.name}写了效果`);
  });
  assert.match(recipeBlock(html, "fx_shock"), /施加感电/);
  // 详情：能做的、缺材料的都写
  const detailOf = h => h.slice(h.indexOf('class="ws-col ws-detail"'));
  W.state.sel = "fx_shock";
  html = W.html(m);
  assert.ok(detailOf(html).includes(`效果：${hint("fx_shock")}`));
  W.state.sel = "fx_burn";
  html = W.html(m);
  assert.ok(detailOf(html).includes(`效果：${hint("fx_burn")}`));
  // 学配方
  const learn = (html.match(/<summary>学配方[\s\S]*?<\/details>/) || [""])[0];
  assert.ok(m.learn.length && m.learn.some(x => x.item === "fx_sting"));
  m.learn.forEach(x => assert.ok(learn.includes(hint(x.item)), `学配方里的${x.name}写了效果`));
});

test("issue #366：联机玩家的工坊也写道具效果（读本机的道具表，联机发的数据不用多带）", () => {
  const { c, r } = onlineSetup();
  const W = c.WorkshopUI, m = c.WorkshopData.viewWorkshopModel(r);
  const hint = id => c.ITEM_CATALOG[id].hint;
  let html = W.html(m);
  const g = m.grouped(W.state.kit);
  const rows = g.craftable.concat(g.missing);
  assert.ok(rows.length);
  rows.forEach(x => assert.ok(recipeBlock(html, x.id).includes(hint(x.id)), `列表里的${x.name}写了效果`));
  W.state.sel = rows[0].id;
  html = W.html(m);
  assert.ok(html.slice(html.indexOf('class="ws-col ws-detail"')).includes(`效果：${hint(rows[0].id)}`));
});

test("评审 4：换画面时收起工坊和非战斗模式的背包（body[data-screen] 变化 / 联机进战斗）", () => {
  const ws = read("workshop-ui.js"), bp = read("backpack-ui.js"), ol = read("online-ui.js");
  assert.match(ws, /attributeFilter: \["data-screen"\]/);
  assert.match(bp, /if \(!inBattleMode\(\)\) close\(\)/);
  assert.match(ol, /view\.screen !== "exploration"\) \{ if \(global\.WorkshopUI\) global\.WorkshopUI\.close\(\)/);
});
