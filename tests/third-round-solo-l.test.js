// 第三轮排查 · 单机低级 L-1 ~ L-7（docs/bug-backlog.md）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");

function battle(enemies, seed, setupFn) {
  const c = H.load();
  vm.runInContext("Math", c).random = () => 0.5;
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: enemies || [{ id: "thug_knife", lv: 3, zone: 1 }], seed: seed || "L" });
  const S = c.S.state;
  const kolt = c.findKit("kolt", S.units), helu = c.findKit("helu", S.units);
  if (setupFn) setupFn(c, S, kolt, helu);
  c.startCombat();
  return { c, S, kolt, helu, foes: S.units.filter(u => !u.isPlayer && !u.dead) };
}

/** 单局：任务里站在第 0 站，节点换成指定类型 */
function rogue(seed, nodeType) {
  const c = H.load(), R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed });
  R.acceptTask(run, "main");
  delete run.task.hunt;
  run.task.index = 0;
  run.task.nodes[0] = { type: nodeType, done: false };
  return { c, R, run };
}

test("L-1 主持人全员复原：「每次短休 N 次」的专长次数也刷新", () => {
  const { c } = battle(null, "L1");
  c.LEDGER.shortOnce = { kolt: { "feat:standin": 1 }, helu: { "feat:standin": 1 } };
  c.ledgerRestoreAll([]);
  assert.deepEqual(JSON.parse(JSON.stringify(c.LEDGER.shortOnce)), {});
});

test("L-2 兼修后的勾索照原技能「拉拽」判断目标，首领也能拉；没兼修仍拉不动首领", () => {
  const { c, kolt, foes } = battle(null, "L2", (c, S, k) => { k.feats = ["grapple"]; });
  vm.runInContext('ENEMY_RANK.thug_knife = "boss"', c);
  const boss = foes[0];
  assert.match(c.featSkillTargetWhy(kolt, "feat_grapple", boss), /拉不动首领/);
  kolt.featFull = ["grapple"];
  assert.equal(c.featSkillTargetWhy(kolt, "feat_grapple", boss), null);
});

test("L-3 涉猎专长在技能栏的说明：次数按专长实际写，不带原技能的等级加强", () => {
  const { c, kolt } = battle(null, "L3", (c, S, k) => { k.feats = ["daunt", "prolong", "brace", "rouse"]; k.level = 15; });
  const hintOf = (id) => c.featSkills(kolt).find(x => x.id === "feat_" + id).hint;
  ["daunt", "prolong", "brace", "rouse"].forEach(id => {
    assert.doesNotMatch(hintOf(id), /每场[一二两三四\d]+次/, `${id} 不再沿用原技能的「每场 N 次」`);
  });
  assert.match(hintOf("daunt"), /本场剩 1 次/);
  assert.doesNotMatch(hintOf("brace"), /自选/, "加固涉猎版没有 15 级自选血量种类");
  assert.doesNotMatch(hintOf("rouse"), /15 ?级/, "鼓劲涉猎版没有 15 级加强");
  assert.match(hintOf("brace"), /本次长休剩 2 次/);
});

test("L-4 跑团「找工匠升级」：带巧手匠人默认打八折；主持人填的费用照填的收", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [], seed: "L4" });
  c.S.TRPG.active = true;
  const st = c.S.state, kolt = c.findKit("kolt", st.units);
  const kit = kolt.linkedKits[0];
  for (let i = 0; i < 3; i++) c.trpgUpgradeWeapon("kolt", kit, "gm");
  const owner = c.trpgHeroes().find(h => h.kit === "kolt");
  const info = () => c.trpgUpgradeInfo(owner, kit);
  const labor = info().labor;
  assert.ok(labor > 0);
  const stock = () => { c.bagAdd("mat_alloy", 9); c.bagAdd("mat_metal", 9); st.kuizhi = 100000; };
  stock();
  c.trpgUpgradeWeapon("kolt", kit, "smith");
  assert.equal(st.kuizhi, 100000 - labor, "没有巧手匠人：原价");
  kolt.feats = ["haggler"];
  const labor2 = info().labor;
  assert.equal(c.trpgSmithFee(info()), Math.round(labor2 * 0.8));
  const lv = c.trpgWeaponLevel(owner, kit);
  stock(); c.bagAdd("mat_polymer", 9);
  c.trpgUpgradeWeapon("kolt", kit, "smith");
  assert.equal(c.trpgWeaponLevel(owner, kit), lv + 1);
  assert.equal(st.kuizhi, 100000 - Math.round(labor2 * 0.8), "巧手匠人：八折");
});

test("L-5 精英战比同时期的普通战高，到幕末也不被本幕上限吞掉；超出多少看配置", () => {
  const { c, R, run } = rogue("L5", "battle");
  run.actDay = 99;
  const cap = R.battleSpec(run).level;
  run.task.nodes[0] = { type: "elite", done: false };
  const elite = R.battleSpec(run).level;
  const C = vm.runInContext("ROGUE_CONFIG", c);
  assert.equal(elite, cap + C.eliteLevelBonus);
  assert.ok(C.eliteOverCap >= 1, "超过本幕上限几级放在配置里");
});

test("L-6 finishBattle 要在战斗阶段：任务板上、非战斗节点都拒绝，不改状态", () => {
  const { R, run } = rogue("L6a", "rest");
  assert.throws(() => R.finishBattle(run, "win"), /不是战斗/);
  assert.equal(run.task.index, 0);
  assert.equal(run.task.nodes[0].done, false);
  run.stage = "board";
  assert.throws(() => R.finishBattle(run, "win"), /不在战斗/);
});

test("L-7 休息点短休：没人有次数时按钮灰掉写原因，点了也不白过一站", () => {
  const { c, R, run } = rogue("L7", "rest");
  assert.equal(R.canShortRestAtNode(run).ok, true);
  c.partyHeroes().forEach(h => { c.LEDGER.shortUsed[h.kit] = c.shortRestCap(h); });
  const can = R.canShortRestAtNode(run);
  assert.equal(can.ok, false);
  assert.match(can.why, /短休次数/);
  assert.throws(() => R.restAtNode(run, "short"), /短休次数/);
  assert.equal(run.task.index, 0, "没过站");
});

test("L-9 死亡角色不能制作，也不能给别人打下手；复活后照常", () => {
  const { c, helu } = battle(null, "L9");
  c.bagAdd("cm_scrap", 2); c.bagAdd("cm_cell", 1); c.bagAdd("cm_coil", 1);
  c.trpgTeachRecipe("fx_overload", true);
  helu.dead = true;
  assert.equal(c.trpgCraftOdds("kolt", "fx_overload", null, "helu").helped, false, "死人打下手不给优势");
  assert.match(c.trpgCraft({ kit: "kolt", item: "fx_overload", helper: "helu", result: "ok" })[0], /已死亡，不能打下手/);
  assert.equal(c.bagCount("fx_overload"), 0, "没做成，材料不扣");
  assert.equal(c.trpgCraftOdds("helu", "fx_overload"), null);
  assert.match(c.trpgCraft({ kit: "helu", item: "fx_overload", result: "ok" })[0], /已死亡，不能制作/);
  assert.equal(c.bagCount("fx_overload"), 0);
  helu.dead = false;
  assert.equal(c.trpgCraftOdds("kolt", "fx_overload", null, "helu").helped, true, "复活后可以打下手");
  c.trpgCraft({ kit: "kolt", item: "fx_overload", helper: "helu", result: "ok" });
  assert.equal(c.bagCount("fx_overload"), 1);
});

test("L-11 战后结算跳过死亡角色的武器耐久，活人的照扣", () => {
  const { c, kolt, helu } = battle(null, "L11");
  const kw = kolt.linkedKits[0], hw = helu.linkedKits[0];
  const k0 = c.weaponDur(kw), h0 = c.weaponDur(hw);
  helu.dead = true;
  c.ledgerAfterBattle([]);
  assert.equal(c.weaponDur(kw), k0 - 1);
  assert.equal(c.weaponDur(hw), h0, "死亡角色的武器不扣");
});
