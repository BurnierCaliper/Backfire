"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "kolt", "tou"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "REWARDS" });
  c.setXpRequirementScale(1000); // 只测试发奖时，避免升级消耗经验遮住结果。
  const st = c.S.state;
  st.turnNo = 4;
  st.battleScore.hurt = true;
  const heroes = st.units.filter(u => u.isPlayer && !c.isWeaponUnit(u));
  return { c, st, heroes };
}

for (const [score, grade, bonus] of [[749, "D", 0], [750, "C", 0], [1250, "B", 20], [1500, "A", 50], [1750, "S", 101]]) {
  test(`共享奖励：现有 ${grade} 评价与 101 点战斗经验的倍率、向下取整保持不变`, () => {
    const { c, st, heroes } = field();
    c.grantXpToPlayers(101);
    st.battleScore.total = score;
    const reward = c.settleBattleRewards("win");
    assert.equal(reward.grade.grade, grade);
    assert.equal(reward.grade.score, score);
    assert.equal(reward.xpBonus, bonus);
    assert.equal(st.battleGains.xp, 101 + bonus);
    assert.ok(heroes.every(u => u.xp === 101 + bonus));
  });
}

test("共享奖励：先叠加速杀、无伤、遭遇战分数，再评级发经验；重复结算只保留展示摘要", () => {
  const { c, st, heroes } = field();
  c.grantXpToPlayers(101);
  st.battleScore.total = 1000;
  st.battleScore.hurt = false;
  st.turnNo = 1;
  st.ambush = true;
  const first = c.settleBattleRewards("win");
  // (1000 + 100) × (1 + 速杀1 + 无伤0.5 + 遭遇1) = 3850。
  assert.equal(first.grade.score, 3850);
  assert.equal(first.finishBonus.mult, 3.5);
  assert.equal(first.grade.grade, "S");
  assert.equal(first.xpBonus, 101);
  const second = c.settleBattleRewards("win");
  assert.equal(second.alreadySettled, true);
  assert.equal(second.finishBonus, null);
  assert.equal(second.xpBonus, 0);
  assert.equal(second.totalXpBonus, 101);
  assert.deepEqual(plain(second.grade), plain(first.grade));
  assert.equal(st.battleScore.total, 3850);
  assert.equal(st.battleGains.xp, 202);
  assert.ok(heroes.every(u => u.xp === 202));
});

test("共享奖励：已调用旧加分接口时不重复加分，仍补发且只补一次评级经验", () => {
  const { c, st } = field();
  c.grantXpToPlayers(100);
  st.battleScore.total = 1600;
  st.turnNo = 2;
  c.applyFinishBonus();
  assert.equal(st.battleScore.total, 2400);
  const reward = c.settleBattleRewards("win");
  assert.equal(reward.finishBonus.extra, 0);
  assert.equal(reward.xpBonus, 100);
  assert.equal(st.battleScore.total, 2400);
  assert.equal(c.settleBattleRewards("win").xpBonus, 0);
});

for (const outcome of ["lose", "retreat"]) {
  test(`共享奖励：${outcome} 不发胜利加分或评级经验，不能重复改判来领取`, () => {
    const { c, st, heroes } = field();
    c.grantXpToPlayers(101);
    st.battleScore.total = 1750;
    st.battleScore.hurt = false;
    st.turnNo = 1;
    const reward = c.settleBattleRewards(outcome);
    assert.equal(reward.grade.grade, "S");
    assert.equal(reward.finishBonus, null);
    assert.equal(reward.xpBonus, 0);
    assert.equal(c.settleBattleRewards("win").outcome, outcome);
    assert.equal(st.battleScore.total, 1750);
    assert.equal(st.battleGains.xp, 101);
    assert.ok(heroes.every(u => u.xp === 101));
  });
}

test("共享奖励：只给未死亡英雄评级经验，倒地但未死者仍能获得，武器人不领取", () => {
  const { c, st, heroes } = field();
  c.grantXpToPlayers(100);
  c.spawnWeapon(heroes[0], heroes[0].linkedKits[0]);
  heroes[1].dead = true;
  heroes[2].dying = true;
  const weapons = st.units.filter(u => u.isPlayer && c.isWeaponUnit(u));
  assert.ok(weapons.length > 0);
  const weaponXp = weapons.map(u => u.xp || 0);
  st.battleScore.total = 1750;
  c.settleBattleRewards("win");
  assert.deepEqual(plain(heroes.map(u => u.xp)), [200, 100, 200]);
  assert.deepEqual(weapons.map(u => u.xp || 0), weaponXp);
});

test("共享奖励：无战斗经验不凭空发奖，下一场重新允许结算，非法结局不修改状态", () => {
  const { c, st } = field();
  st.battleScore.total = 1750;
  assert.throws(() => c.settleBattleRewards("timeout"), /未知的战斗结局/);
  assert.equal(st.battleScore.rewardSettlement, undefined);
  assert.equal(c.settleBattleRewards("win").xpBonus, 0);
  c.BattleSim.setup({ party: ["ruby", "kolt"], enemies: [{ id: "thug_knife", lv: 1 }], seed: "REWARDS-NEXT" });
  st.turnNo = 4;
  st.battleScore.hurt = true;
  st.battleScore.total = 1750;
  c.grantXpToPlayers(10);
  const next = c.settleBattleRewards("win");
  assert.equal(next.alreadySettled, false);
  assert.equal(next.xpBonus, 10);
});

test("跑团评级经验沿用每人已平分的经验，不二次平分或重复乘主持人倍率", () => {
  const { c, st, heroes } = field();
  c.S.TRPG.active = true;
  st.xpMult = 3;
  // 1 级杂兵 5 经验，主持人 ×3 后 15，由 3 人平分，每人 5。
  const foe = st.units.find(u => !u.isPlayer);
  c.settleEnemyKill(foe, []);
  assert.equal(st.battleGains.xp, 5);
  st.battleScore.total = 1750;
  const reward = c.settleBattleRewards("win");
  assert.equal(reward.xpBonus, 5);
  assert.equal(st.battleGains.xp, 10);
  assert.ok(heroes.every(u => u.xp === 10));
});

function rogueBattle(solo, ambush) {
  const c = H.load();
  const R = c.Rogue;
  const run = R.newRun(solo
    ? { party: ["ruby"], solo: true, partners: ["kolt", "yuito", "tou"], role2: "生存", seed: "REWARD-RUN" }
    : { party: ["ruby", "kolt"], seed: "REWARD-RUN" });
  R.acceptTask(run, "main");
  run.task.nodes[run.task.index] = { type: ambush ? "rest" : "battle", done: false };
  if (ambush) run.ambush = { chance: 1 };
  const spec = R.battleSpec(run);
  c.BattleSim.setup(spec);
  const st = c.S.state;
  st.turnNo = 4;
  st.battleScore.hurt = true;
  st.battleScore.total = 1750;
  return { c, R, run, st, spec };
}

for (const solo of [false, true]) for (const ambush of [false, true]) {
  test(`单局奖励顺序：${solo ? "单人" : "多人"}、${ambush ? "遭遇战" : "普通战斗"}的固定额外经验不受评级倍率影响`, () => {
    const { c, R, run, spec } = rogueBattle(solo, ambush);
    c.setXpRequirementScale(1000);
    c.grantXpToPlayers(101);
    const reward = c.settleBattleRewards("win");
    assert.equal(reward.xpBonus, 101);
    R.finishBattle(run, "win");
    const expected = 202 + (solo ? 50 : 0) + (ambush ? 50 * spec.level : 0);
    assert.ok(run.party.every(h => h.xp === expected), JSON.stringify(run.party.map(h => h.xp)));
  });
}

test("单局先完成评级升级再恢复倒地，升级待选仍由单局捕获且不重复", () => {
  const { c, R, run, st } = rogueBattle(false, false);
  const hero = c.findKit("kolt", st.units);
  c.grantXpToPlayers(1000);
  hero.layers.forEach(l => { l.current = 0; });
  hero.dying = true;
  const reward = c.settleBattleRewards("win");
  assert.ok(hero.level >= 4);
  assert.equal(reward.ups.length, 2);
  assert.equal(hero.dying, true, "共享奖励不提前执行倒地恢复");
  assert.ok(run.party.every(h => h.level === 1), "单局尚未捕获场上升级");
  const repeated = c.settleBattleRewards("win");
  assert.equal(repeated.xpBonus, 0);
  assert.deepEqual(plain(repeated.ups), plain(reward.ups));
  R.finishBattle(run, "win");
  const saved = run.party.find(h => h.kit === "kolt");
  assert.equal(saved.level, hero.level);
  assert.equal(saved.hp.reduce((sum, l) => sum + l.current, 0), 1, "恢复的是升级后的 1 点生命");
  assert.equal(saved.pending.filter(p => p.type === "attr" && p.level === 4).length, 1);
});

test("撤退仍保留击杀基础经验的升级，不因没有评级奖励而跳过原来的升级流程", () => {
  const { c, st, heroes } = field();
  c.setXpRequirementScale(1);
  c.grantXpToPlayers(155);
  st.battleScore.total = 1750;
  const reward = c.settleBattleRewards("retreat");
  assert.equal(reward.xpBonus, 0);
  assert.equal(reward.ups.length, 3);
  assert.ok(heroes.every(u => u.level === 2 && u.xp === 0));
});
