// 单局工匠：任务板上随机 3 位不同工匠；同一位升级满 5 次领图纸；图纸 5000 装到武器上并生效
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function atBoard(seed) {
  const c = H.load();
  const R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed });
  run.boardNo = 5;                 // 模拟「做完一个任务回到任务板」
  R.makeBoard(run);
  c.S.state.kuizhi = 999999;
  return { c, R, run };
}

test("开局第一块任务板不来工匠；之后每块任务板来 3 位不同的工匠", () => {
  const c = H.load();
  const run = c.Rogue.newRun({ party: ["kolt", "helu"], seed: "SM0" });
  assert.equal((run.smiths || []).length, 0);
  const seen = new Set();
  for (let i = 0; i < 5; i++) {
    c.Rogue.makeBoard(run);
    assert.equal(run.smiths.length, c.S.ROGUE_SMITH_RULES.onBoard);
    assert.equal(new Set(run.smiths).size, run.smiths.length, "同一块板上的工匠不重复");
    run.smiths.forEach(id => seen.add(id));
  }
  assert.ok(seen.size > 3, "不同的任务板会换人");
});

test("在任务板上找工匠升级；不在场的工匠不能用", () => {
  const { c, R, run } = atBoard("SM1");
  const id = run.smiths[0];
  if (R.smithInfo(run, id).needsIntro) R.introduceSmith(run, id);
  R.upgradeWeapon(run, "torque", id);
  assert.equal(run.party[0].weaponLevels.torque, 2);
  assert.equal(run.smithUses[id], 1);
  const absent = c.S.ROGUE_SMITHS.map(x => x.id).find(x => !run.smiths.includes(x));
  assert.throws(() => R.upgradeWeapon(run, "torque", absent));
});

test("同一位工匠升级满 5 次才能领图纸，只能领一次", () => {
  const { R, run } = atBoard("SM2");
  const id = run.smiths[0];
  if (R.smithInfo(run, id).needsIntro) R.introduceSmith(run, id);
  const info0 = R.smithInfo(run, id);
  for (let i = 0; i < 4; i++) R.upgradeWeapon(run, i % 2 ? "torque" : "ecmo", id);
  assert.throws(() => R.claimBlueprint(run, id, info0.blueprints[0].id));
  R.upgradeWeapon(run, "torque", id);
  assert.equal(R.smithInfo(run, id).canClaim, true);
  R.claimBlueprint(run, id, info0.blueprints[1].id);
  assert.deepEqual([...run.blueprints], [info0.blueprints[1].id]);
  assert.throws(() => R.claimBlueprint(run, id, info0.blueprints[0].id));
});

test("图纸花 5000 装到武器上：atk / 耐久上限 / 格挡加成在战斗里生效", () => {
  const { c, R, run } = atBoard("SM3");
  run.blueprints.push("bp_trevor_bigkill", "bp_teresa_light", "bp_zekahr_fool", "bp_tima_range");
  const k0 = c.S.state.kuizhi;
  const id = run.smiths.find(x => R.smithInfo(run, x).canInstall);
  // 基准
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [], before: () => R.applyPartyToField(run) });
  const kolt0 = c.findKit("kolt", c.S.state.units), helu0 = c.findKit("helu", c.S.state.units);
  const atk0 = c.effectiveAtk(kolt0, c.S.state.units), durMax0 = c.weaponDurMax("torque"), block0 = c.finalBlockChance(helu0, kolt0);
  R.installBlueprint(run, "bp_trevor_bigkill", "torque", id);
  R.installBlueprint(run, "bp_zekahr_fool", "ecmo", id);
  assert.equal(c.S.state.kuizhi, k0 - 2 * c.S.ROGUE_SMITH_RULES.installCost);
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [], before: () => R.applyPartyToField(run) });
  const kolt = c.findKit("kolt", c.S.state.units), helu = c.findKit("helu", c.S.state.units);
  // 大杀器：耐久减半，减去的 +2 加到 atk
  const cut = Math.floor(durMax0 / 2);
  assert.equal(c.weaponDurMax("torque"), durMax0 - cut);
  assert.equal(c.effectiveAtk(kolt, c.S.state.units), atk0 + cut + 2);
  // 蠢货：格挡 +10%
  assert.equal(c.finalBlockChance(helu, kolt), Math.min(100, block0 + 10));
  // 换装：新图纸替换旧的
  R.installBlueprint(run, "bp_teresa_light", "torque", id);
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [], before: () => R.applyPartyToField(run) });
  assert.equal(c.weaponDurMax("torque"), durMax0 - 2);
  assert.equal(c.effectiveAtk(c.findKit("kolt", c.S.state.units), c.S.state.units), Math.max(0, atk0 - 4));
  assert.equal(R.heroView(run, run.party[0]).weapons[0].durMax, durMax0 - 2);
});

test("任务里的工匠节点是随机的一位，也算进他的升级次数", () => {
  const { R, run } = atBoard("SM4");
  R.acceptTask(run, 0);
  run.task.nodes[run.task.index] = { type: "smith", done: false };
  const [id] = R.presentSmiths(run);
  assert.ok(id);
  if (R.smithInfo(run, id).needsIntro) R.introduceSmith(run, id);
  R.upgradeWeapon(run, "torque");
  assert.equal(run.smithUses[id], 1);
});
