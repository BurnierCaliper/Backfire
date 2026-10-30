// 巨型活沙吸收后出手：atk 与 personalAtk 同步，effectiveAtk / 实际伤害跟合并后的 atk 走
// （以前 absorbSandsInto 只加 unit.atk，出手用 party.js · effectiveAtk → personalAtk，卡面 50+、每下仍是底值 7）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function setup(enemies, seed) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies, seed: seed || "GLA" });
  c.startCombat();
  const S = c.S.state;
  // 关掉柯尔特「过度自信」−25% 受伤，免得测伤害时对不上 atk
  S.units.forEach(u => { if (u.kit === "kolt") u.prideMaxHp = Infinity; });
  return {
    c, S,
    K: kit => S.units.find(u => u.kit === kit && !u.hidden && !u.dead),
    logs: () => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n")
  };
}

function killLivesand(c, live) {
  live.layers.forEach(l => { l.current = 0; });
  return c.sweepDeadEnemies();
}

function fat(u) {
  u.def = 0; u.defMax = 0; u.bonus = 0;
  u.layers.forEach(l => { l.current = 999; l.max = 999; });
}

test("吸收后 personalAtk 与 atk 一起涨，effectiveAtk 等于合并后的 atk（以前只涨 atk，出手仍是底值）", () => {
  const { c, S, K } = setup([
    { id: "livesand", lv: 10, zone: 1 },
    { id: "sand_human", lv: 10, zone: 1 },
    { id: "sand_beast", lv: 10, zone: 2 }
  ], "GLA-atk");
  const live = K("livesand"), human = K("sand_human"), beast = K("sand_beast");
  const baseAtk = live.atk, basePersonal = live.personalAtk;
  assert.equal(baseAtk, basePersonal, "生成时 atk = personalAtk");
  const gain = human.atk + beast.atk;
  killLivesand(c, live);
  assert.equal(live.resources.giant, true);
  assert.equal(live.atk, baseAtk + gain, "atk 加上饲料的 atk");
  assert.equal(live.personalAtk, basePersonal + gain, "personalAtk 同步加上（出手用这个）");
  assert.equal(c.effectiveAtk(live, S.units), live.atk, "effectiveAtk 跟合并后的 atk 一致");
  assert.ok(c.effectiveAtk(live, S.units) > baseAtk + 5, "远高于吸收前的底值");
});

test("巨型活沙流沙漩涡：打出的伤害按合并后的 atk，不再是吸收前的 7", () => {
  const { c, S, K } = setup([
    { id: "livesand", lv: 10, zone: 1 },
    { id: "sand_human", lv: 10, zone: 1 }
  ], "GLA-dmg");
  const live = K("livesand"), human = K("sand_human");
  const baseAtk = live.atk;
  const feedAtk = human.atk;
  killLivesand(c, live);
  const merged = baseAtk + feedAtk;
  assert.equal(live.atk, merged);
  assert.equal(live.personalAtk, merged);

  const kolt = K("kolt"), helu = K("helu");
  // 漩涡打距离 1 的一区；活沙在 1 区 → 目标放 2 区。范围攻击不能格挡。
  fat(kolt); fat(helu);
  kolt.zone = 2; helu.zone = 2; live.zone = 1;
  const hp0 = c.totalHp(kolt) + c.totalHp(helu);
  S.combatPhase = "enemy";
  live.ap = 1;
  S.attackerId = live.id;
  S.targetId = kolt.id;
  const text = c.withLogSink(() => c.runSkill("en_giant_sand_vortex"));
  c.BattleSim.resolveQueues({ pickBlocker: () => null, pickAssister: () => null });
  const dealt = hp0 - (c.totalHp(kolt) + c.totalHp(helu));
  // 两人各吃 1×ATK（骰子 [0,0]），合计 2×merged
  assert.equal(dealt, merged * 2, `伤害应 = 2×${merged}，实际 ${dealt}（未修时约 2×${baseAtk}）`);
  assert.ok(dealt > baseAtk * 2 + 10, "明显高于吸收前底值能打出的伤害");
  assert.match(String(text), new RegExp(`ATK ${merged}`));
});

test("穿刺（近距）也按合并 atk 结算", () => {
  const { c, S, K } = setup([
    { id: "livesand", lv: 8, zone: 1 },
    { id: "dustbody", lv: 8, zone: 1 }
  ], "GLA-melee");
  const live = K("livesand"), dust = K("dustbody");
  const merged = live.atk + dust.atk;
  killLivesand(c, live);
  assert.equal(live.personalAtk, merged);

  const kolt = K("kolt"), helu = K("helu");
  fat(kolt); fat(helu);
  kolt.zone = 1; helu.zone = 1; live.zone = 1;
  S.combatPhase = "enemy";
  live.ap = 1;
  S.attackerId = live.id;
  S.targetId = kolt.id;
  S.skillFlow = { picks: { target1: kolt.id } };
  const hp0 = c.totalHp(kolt);
  const text = c.withLogSink(() => c.runSkill("en_giant_sand_melee"));
  c.BattleSim.resolveQueues({ pickBlocker: () => null, pickAssister: () => null });
  const dealt = hp0 - c.totalHp(kolt);
  assert.equal(dealt, merged, `穿刺伤害应 = ${merged}，实际 ${dealt}`);
  assert.match(String(text), new RegExp(`ATK ${merged}`));
});
