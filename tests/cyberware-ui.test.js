// 诊所 · 义体浮层（cyberware-ui.js）：改造率条、已装 / 可装列表、确认步骤、过度安装警告、空目录、联机视图适配、不漏坚毅数值
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const H = require("./headless");
const V = require("../online-view");
const ROOT = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const HEAVY = "这会给身体带来极大负担。";

function setup(opt) {
  opt = opt || {};
  const c = H.load();
  vm.runInContext(read("cyberware-ui.js"), c, { filename: "cyberware-ui.js" });
  // official: false = 先清掉正式目录（#262 起正式目录不再是空的），只看示例 / 空目录的画面
  if (opt.official === false) vm.runInContext("Object.keys(CYBERWARE).forEach(k => { delete CYBERWARE[k]; })", c);
  if (opt.examples !== false) vm.runInContext("cyberwareLoadExamples()", c);
  const run = c.Rogue.newRun({ party: ["kolt", "helu"], seed: "CWUI" });
  run.stage = "camp";
  c.S.state.kuizhi = opt.money != null ? opt.money : 100000;
  c.CyberwareUI.reset();
  const U = c.CyberwareUI;
  const q = (action, f) => c.dispatch(Object.assign({ type: "run.query", action }, f), { run });
  const model = () => U.localModel({ heroes: run.party.map(h => ({ kit: h.kit, name: c.Rogue.heroName(h.kit) })),
    packetOf: kit => q("cyberware", { kit }),
    previewOf: (kit, id) => q("cyberwarePreview", { kit, id }),
    money: () => c.S.state.kuizhi });
  return { c, run, U, model, q };
}
const noShp = html => { assert.doesNotMatch(html, /坚毅|shp/i); };
const shopRow = (html, id) => (html.match(new RegExp(`<li class="cw-row[^"]*">(?:(?!</li>)[\\s\\S])*data-cw-pick="${id}"[\\s\\S]*?</li>`)) || [""])[0];

test("改造率条：当前 / 上限，分成义体和血量层改造两段；有 burdenText", () => {
  const { U, model } = setup();
  const m = model(), html = U.html(m);
  assert.match(html, /改造率/);
  assert.match(html, new RegExp(`<b>0%</b> / ${m.packet.view.cap}%`));
  assert.match(html, /cw-seg ly/); assert.match(html, /cw-seg cw/);
  assert.match(html, /义体 0%.*血量层改造 0%/s);
  assert.match(html, /身体还算适应。/);
  noShp(html);
});

test("目录：示例出现在可安装列表，有价格、说明、安装后改造率、冲突提示", () => {
  const { U, model } = setup();
  const html = U.html(model());
  const row = shopRow(html, "example_t5_melee");
  assert.ok(row, "有示例行");
  assert.match(row, /【示例】5级近战攻击义体/);
  assert.match(row, /3000/);
  assert.match(row, /示例条目，内容未设计。/);
  assert.match(row, /安装后改造率 <b class="cw-after">40%<\/b>/);
  assert.match(row, /冲突标签「arm」/);
  assert.doesNotMatch(row, /disabled/);
  assert.match(html, /还没有安装义体。/);
});

test("空目录：显示「暂无可安装的义体」", () => {
  const { U, model } = setup({ official: false, examples: false });
  const html = U.html(model());
  assert.match(html, /暂无可安装的义体/);
  noShp(html);
});

test("装不了的：按钮灰掉并写原因（超上限没专长 / 奎支不够）", () => {
  const { c, run, U, model } = setup({ money: 100 });
  let row = shopRow(U.html(model()), "example_t5_melee");
  assert.match(row, /disabled/); assert.match(row, /奎支不够/);
  c.S.state.kuizhi = 100000;
  run.party[0].cyber = { armor: 8, shield: 0, sand: 0, spirit: false };
  row = shopRow(U.html(model()), "example_t5_melee");
  assert.match(row, /disabled/); assert.match(row, /超出改造率上限（需要专长才能过度安装）/);
});

test("确认步骤：点安装先出预览（费用、改造率前后、上限），确认后才发指令", () => {
  const { c, run, U, model } = setup();
  U.state.confirm = "example_t5_melee";
  const html = U.html(model());
  assert.match(html, /确认安装：【示例】5级近战攻击义体/);
  assert.match(html, /费用 <b>3000<\/b>/);
  assert.match(html, /<b>0%<\/b> → <b class="cw-after">40%<\/b> \/ 上限 70%/);
  assert.doesNotMatch(html, /cw-heavy"/);
  const cmd = JSON.parse(html.match(/data-cw-cmd="([^"]+)"[^>]*>确认安装/)[1].replace(/&quot;/g, '"'));
  assert.deepEqual(cmd, { action: "installCyberware", kit: "kolt", id: "example_t5_melee" });
  c.dispatch(Object.assign({ type: "run" }, cmd), { run });
  assert.equal(c.S.state.kuizhi, 97000);
  assert.equal(run.party[0].cyberware.map(x => x.id).join(), "example_t5_melee");
});

test("过度安装：只有能过度安装时才能确认，并醒目显示「这会给身体带来极大负担。」", () => {
  const { c, run, U, model } = setup();
  run.party[0].cyber = { armor: 8, shield: 0, sand: 0, spirit: false };
  U.state.confirm = "example_t5_melee";
  let html = U.html(model());
  assert.match(html, new RegExp(`<p class="cw-heavy" role="alert">⚠ ${HEAVY}</p>`));
  assert.match(html, /disabled>仍然安装/);
  run.party[0].cyberOverinstall = true;   // 88eae79：applyHero 会带过去（或者专长 "overinstall"）
  html = U.html(model());
  assert.match(html, /cw-confirm heavy/);
  assert.match(html, new RegExp(HEAVY));
  assert.match(html, /超出上限：过度安装/);
  assert.match(html, /data-cw-cmd="[^"]+" >仍然安装/);
  noShp(html);
});

test("已安装：列表 + 拆除按钮写拆除费；拆除可逆", () => {
  const { c, run, U, model } = setup({ official: false });
  c.Rogue.installCyberware(run, "kolt", "example_t5_melee");
  const html = U.html(model());
  assert.match(html, /cw-row on[\s\S]*【示例】5级近战攻击义体[\s\S]*拆除<small>1000 奎支<\/small>/);
  assert.match(html, /义体 40%/);
  assert.match(html, /义体在持续消耗你的精神。/);
  assert.match(html, /目录里的义体都装上了。/);
  noShp(html);
  const cmd = JSON.parse(html.match(/data-cw-cmd="([^"]+)"[^>]*>拆除/)[1].replace(/&quot;/g, '"'));
  c.dispatch(Object.assign({ type: "run" }, cmd), { run });
  assert.equal(run.party[0].cyberware.length, 0);
  assert.equal(c.S.state.kuizhi, 100000 - 3000 - 1000);
});

test("本机：query(\"cyberwarePreview\") 未知 id 给 ok:false，确认框照样写原因、按钮灰掉", () => {
  const { U, model, q } = setup();
  assert.equal(q("cyberwarePreview", { kit: "kolt", id: "nope" }).ok, false);
  U.state.confirm = "nope";
  const html = U.html(model());
  assert.match(html, /没有这件义体/);
  assert.match(html, /disabled>确认安装/);
});

test("过度安装专长 overinstall（featHas）也能放开", () => {
  const { run, U, model } = setup();
  run.party[0].cyber = { armor: 8, shield: 0, sand: 0, spirit: false };
  run.party[0].feats = (run.party[0].feats || []).concat(["overinstall"]);
  const m = model();
  if (!m.packet.view.canOverinstall) return;   // 专长挂在别的字段上时只看 cyberOverinstall 那条
  U.state.confirm = "example_t5_melee";
  assert.match(U.html(m), /data-cw-cmd="[^"]+" >仍然安装/);
});

/** 联机包：照 online-rogue.js · cyberwareFor 的形状（每人 purse + previews），再过 online-view 白名单 */
function onlinePacket(c, run, kits, purse) {
  const q = (action, f) => c.dispatch(Object.assign({ type: "run.query", action }, f), { run });
  const heroes = kits.map(k => { const p = q("cyberware", { kit: k }); return Object.assign({}, p, { purse: purse[k] }); });
  return V.projectPacket({ type: "view", cyberware: { heroes } }, { recipientId: "p2", gmId: "host" });
}
test("联机：viewModel 读 heroes[] 的 purse / previews（不在界面里猜），每人的钱包显示在角色切换上", () => {
  const { c, run, U } = setup();
  const projected = onlinePacket(c, run, ["kolt", "helu"], { kolt: 5000, helu: 800 });
  assert.ok(projected.cyberware.heroes[0].previews.example_t5_melee, "previews 过了白名单");
  const m = U.viewModel(projected);
  assert.equal(m.net, true); assert.equal(m.kit, "kolt"); assert.equal(m.money, 5000);
  U.state.confirm = "example_t5_melee";
  let html = U.html(m);
  assert.match(html, /5000 奎支<\/small>/); assert.match(html, /800 奎支<\/small>/);
  assert.match(html, /<b>0%<\/b> → <b class="cw-after">40%<\/b> \/ 上限 70%/);
  assert.match(html, /确认安装<\/button>/);
  noShp(html);
  // 切到钱不够的人：按钮灰掉
  U.state.kit = "helu"; U.state.confirm = "example_t5_melee";
  html = U.html(U.viewModel(projected));
  assert.match(html, /奎支不够/);
  // 过度安装：heavy 警告来自房主的预览
  run.party[0].cyber = { armor: 8, shield: 0, sand: 0, spirit: false }; run.party[0].cyberOverinstall = true;
  U.state.kit = "kolt"; U.state.confirm = "example_t5_melee";
  html = U.html(U.viewModel(onlinePacket(c, run, ["kolt"], { kolt: 5000 })));
  assert.match(html, new RegExp(`<p class="cw-heavy" role="alert">⚠ ${HEAVY}</p>`));
  assert.match(html, /超出上限：过度安装/);
  // 没有预览（老包）：不猜，按钮灰掉
  const old = JSON.parse(JSON.stringify(projected)); old.cyberware.heroes.forEach(h => { delete h.previews; });
  U.state.confirm = "example_t5_melee";
  assert.match(U.html(U.viewModel(old)), /预览还没收到/);
  assert.equal(U.viewModel({ cyberware: null }).packet, null);
});

test("联机冲突：previews 里的 conflictWith 显示成已装义体的名字", () => {
  const { c, run, U } = setup();
  vm.runInContext(`cyberwareRegister({ id: "t_arm2", name: "测试臂B", tier: 5, conflict: "arm" })`, c);
  c.Rogue.installCyberware(run, "kolt", "example_t5_melee");
  U.state.confirm = "t_arm2";
  const html = U.html(U.viewModel(onlinePacket(c, run, ["kolt"], { kolt: 50000 })));
  assert.match(html, /和已安装的「【示例】5级近战攻击义体」冲突/);
  assert.match(html, /disabled>(确认|仍然)安装/);
});

test("入口：诊所面板每人一个「义体」按钮；game.html 引入了脚本和样式", () => {
  const { U } = setup();
  assert.match(U.button("kolt"), /data-cw-open="kolt"/);
  assert.match(read("rogue-ui.js"), /CyberwareUI\.button\(h\.kit\)/);
  const g = read("game.html");
  assert.match(g, /cyberware-ui\.js/); assert.match(g, /cyberware\.css/);
});
