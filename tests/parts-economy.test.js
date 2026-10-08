// C / B 级改装件（程序生成）：单局任务奖励、工匠货架、买卖、装卸；跑团的客制化图纸
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

test("C / B 级改装件：三种主补正 × 五种负补正，C ±0.1 后缀 beta，B ±0.15 后缀 alpha", () => {
  const c = H.load();
  const ids = c.weaponPartIds().filter(id => c.weaponPartSpec(id).kind === "coef");   // 补正件（功能件见 weapon-parts.test.js）
  assert.equal(ids.length, 30);
  ids.forEach(id => {
    const p = c.weaponPartSpec(id);
    const step = p.grade === "C" ? 0.1 : 0.15;
    assert.ok(["str", "dex", "int"].includes(p.main));
    assert.notEqual(p.main, p.neg);
    assert.deepEqual(plain(p.coef), { [p.main]: step, [p.neg]: -step });
    assert.match(p.name, p.grade === "C" ? /-beta$/ : /-alpha$/);
  });
  assert.equal(new Set(["str", "dex", "int"].map(a => c.weaponPartSpec(`c_${a}_con`).name.split("-")[0])).size, 3, "三个主补正三个名字");
  let seed = 0; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 50; i++) assert.match(c.rollWeaponPart({ B: 1 }, rnd), /^b_/);
  assert.ok(c.ITEM_CATALOG.part_c_str_dex.name.includes("敏捷−"), "背包里看得出负补正");
});

function run0(seed) {
  const c = H.load();
  const R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed });
  run.smiths = c.S.ROGUE_SMITHS.map(x => x.id);   // 开局第一块任务板不来工匠：测试里摆上
  return { c, R, run };
}

test("单局：部分任务有改装件奖励（固定随机），主线一定有；完成任务时放进背包", () => {
  const { c, R, run } = run0("PART-T");
  assert.ok(run.main.part && c.weaponPartSpec(run.main.part), "主线一定给");
  run.board.forEach(t => { if (t.kind === "clear") assert.equal(t.part, null); });
  const again = run0("PART-T");
  assert.deepEqual(plain(again.run.board.map(t => t.part)), plain(run.board.map(t => t.part)), "读档看到的一样");
  const part = run.main.part;
  R.acceptTask(run, "main");
  const last = run.task.cols.length - 1;
  run.task.index = last;
  run.task.nodes[last] = run.task.nodes[last] || { type: run.task.cols[last][0], done: false };
  const notes = R.finishBattle(run, "win");
  assert.ok(notes.some(t => t.includes("改装件")), notes.join("\n"));
  assert.equal(c.bagCount(c.weaponPartItemId(part)), 1);
});

test("单局工匠：随机摆 3 件，C 400 / B 650，打折的是八折；买下进背包", () => {
  const { c, R, run } = run0("PART-S");
  const sid = run.smiths[0];
  const offers = R.partOffers(run, sid);
  assert.equal(offers.length, 3);
  offers.forEach(o => {
    const base = c.weaponPartSpec(o.id).grade === "C" ? 400 : 650;
    assert.equal(o.base, base);
    assert.equal(o.price, o.discount ? Math.round(base * 0.8) : base);
  });
  assert.deepEqual(plain(R.partOffers(run, sid)), plain(offers), "再看一次还是这 3 件");
  c.S.state.kuizhi = 5000;
  R.buyPart(run, sid, 0);
  assert.equal(c.S.state.kuizhi, 5000 - offers[0].price);
  assert.equal(c.bagCount(c.weaponPartItemId(offers[0].id)), 1);
  assert.throws(() => R.buyPart(run, sid, 0), /卖掉了/);
});

test("打折出现的概率大约 25%", () => {
  let disc = 0, n = 0;
  for (let i = 0; i < 60; i++) {
    const { R, run } = run0("PART-D" + i);
    run.smiths.forEach(s => R.partOffers(run, s).forEach(o => { n++; if (o.discount) disc++; }));
  }
  assert.ok(disc / n > 0.15 && disc / n < 0.35, `${disc}/${n}`);
});

test("卖出：原价 40%（C 160 / B 260），商店或工匠处才能卖", () => {
  const { c, R, run } = run0("PART-SELL");
  c.bagAdd("part_c_str_dex", 1); c.bagAdd("part_b_int_con", 1);
  assert.equal(R.partSellPrice("c_str_dex"), 160);
  assert.equal(R.partSellPrice("b_int_con"), 260);
  const k = c.S.state.kuizhi;
  R.sellPart(run, "b_int_con");     // 任务板上有工匠
  assert.equal(c.S.state.kuizhi, k + 260);
  assert.equal(c.bagCount("part_b_int_con"), 0);
  run.smiths = []; run.stage = "task"; run.task = { index: 0, nodes: [{ type: "battle" }] };
  assert.equal(R.canSellParts(run), false);
  assert.throws(() => R.sellPart(run, "c_str_dex"), /没人收/);
});

test("工匠装改装件：C 300 / B 500，要有槽；换下的放回背包；拆下免费", () => {
  const { c, R, run } = run0("PART-I");
  const sid = run.smiths[0];
  const kolt = run.party.find(h => h.kit === "kolt");
  c.bagAdd("part_c_str_dex", 1); c.bagAdd("part_b_str_int", 1);
  c.S.state.kuizhi = 2000;
  assert.throws(() => R.installPart(run, "torque", 0, "c_str_dex", sid), /3 级才有改装槽/);
  kolt.weaponLevels.torque = 3;
  R.installPart(run, "torque", 0, "c_str_dex", sid);
  assert.equal(c.S.state.kuizhi, 1700);
  assert.deepEqual(plain(kolt.weaponParts.torque), ["c_str_dex"]);
  R.installPart(run, "torque", 0, "b_str_int", sid);
  assert.equal(c.S.state.kuizhi, 1200);
  assert.equal(c.bagCount("part_c_str_dex"), 1, "换下的放回背包");
  assert.throws(() => R.installPart(run, "torque", 1, "c_str_dex", sid), /只有 1 个改装槽/);
  R.removePart(run, "torque", 0, sid);
  assert.equal(c.S.state.kuizhi, 1200, "拆下不要钱");
  assert.equal(c.bagCount("part_b_str_int"), 1);
  // 装上的件进战斗算 atk
  R.installPart(run, "torque", 0, "b_str_int", sid);
  const w = R.armoryData(run).flatMap(h => h.weapons).find(x => x.kit === "torque");
  assert.deepEqual(plain(w.slots.map(s => s && s.id)), ["b_str_int"]);
  assert.equal(w.breakdown.rows.find(r => r.attr === "str").partCoef, 0.15);
  assert.deepEqual(plain(R.heroView(run, kolt).weapons[0].parts.map(p => p && p.id)), ["b_str_int"]);
});

test("单局命令：buyPart / sellPart / installPart / removePart 都走 dispatch", () => {
  const { c, run } = run0("PART-CMD");
  const sid = run.smiths[0];
  const offers = c.Commands.dispatch({ type: "run.query", action: "partOffers", smith: sid }, { run });
  c.S.state.kuizhi = 5000;
  c.Commands.dispatch({ type: "run", action: "buyPart", smith: sid, index: 1 }, { run });
  assert.equal(c.bagCount(c.weaponPartItemId(offers[1].id)), 1);
  c.Commands.dispatch({ type: "run", action: "sellPart", part: offers[1].id }, { run });
  assert.equal(c.bagCount(c.weaponPartItemId(offers[1].id)), 0);
});

/* ---------- 跑团：客制化图纸 ---------- */
function trpg() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [], seed: "TRPG-BP" });
  c.S.TRPG.active = true;
  c.S.state.bag = { items: [] };
  c.S.state.kuizhi = 3000;
  return c;
}
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "trpg" }, o)));

test("跑团：主持人把图纸放进背包，装上（付工钱）后战斗规则生效，换 / 拆放回背包", () => {
  const c = trpg();
  assert.ok(c.ITEM_CATALOG.bp_trevor_bigkill, "图纸登记成背包物品");
  cmd(c, { action: "adjustItem", item: "bp_trevor_bigkill", amount: 1 });
  const durBefore = c.weaponDurMax("torque");
  const lines = cmd(c, { action: "installBlueprint", owner: "kolt", kit: "torque", blueprint: "bp_trevor_bigkill", fee: 1000 });
  assert.ok(lines);
  assert.equal(c.bagCount("bp_trevor_bigkill"), 0);
  assert.equal(c.S.state.kuizhi, 2000);
  const kolt = c.findKit("kolt", c.S.state.units);
  assert.equal(kolt.weaponBlueprints.torque, "bp_trevor_bigkill");
  assert.ok(c.S.state.weaponMods.torque.bigKill);
  assert.ok(c.weaponDurMax("torque") < durBefore, "大杀器耐久减半");
  const w = c.SkillText.armoryData().flatMap(h => h.weapons).find(x => x.kit === "torque");
  assert.equal(w.blueprint.name, "大杀器");
  // 背包没有就装不了；主持人直接装不耗
  assert.match(c.trpgInstallBlueprint("kolt", "torque", "bp_trevor_romance", 0, false).join(""), /背包里没有/);
  cmd(c, { action: "installBlueprint", owner: "kolt", kit: "torque", blueprint: "bp_trevor_romance", free: true });
  assert.equal(c.bagCount("bp_trevor_bigkill"), 1, "换下的放回背包");
  assert.equal(c.S.state.kuizhi, 2000);
  cmd(c, { action: "removeBlueprint", owner: "kolt", kit: "torque" });
  assert.equal(c.bagCount("bp_trevor_romance"), 1);
  assert.equal(c.S.state.weaponMods, null);
});

test("跑团：主持人随机生成 C / B 改装件", () => {
  const c = trpg();
  cmd(c, { action: "randomPart", grade: "B" });
  const got = c.bagList().filter(x => x.part);
  assert.equal(got.length, 1);
  assert.equal(c.weaponPartSpec(got[0].part).grade, "B");
});

test("跑团存档带上图纸；摆队伍时按图纸重算", () => {
  const fs = require("node:fs"), path = require("node:path");
  const g = fs.readFileSync(path.join(H.ROOT, "game.js"), "utf8");
  assert.match(g, /weaponBlueprints: u\.weaponBlueprints \?/);
  assert.match(g, /if \(s\.weaponBlueprints\) u\.weaponBlueprints =/);
  assert.match(fs.readFileSync(path.join(H.ROOT, "battle-commands.js"), "utf8"), /trpgSyncWeaponMods\(\)/);
});
