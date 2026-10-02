// 穴鸦（作者给的新数据）与首领的架势 / 晕眩标记
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(party, enemies) {
  const c = H.load();
  c.BattleSim.setup({ party: party || ["ruby", "kolt"], enemies });
  c.startCombat();
  return { c, st: c.S.state };
}

test("穴鸦：10 肉体 + 每级 3；def 2 每五级 +1；atk 5 每级 +2；飞行；声波近距离 1d4+atk 谐波 1 击破，每五级升骰", () => {
  const c = H.load();
  const build = (lv) => c.enemyPresets().find(p => p.id === "crow").build(lv, 2);
  const u1 = build(1), u5 = build(5), u10 = build(10), u4 = build(4);
  assert.equal(u1.layers[0].type, "flesh");
  assert.equal(u1.layers[0].max, 10);
  assert.equal(u5.layers[0].max, 22);
  assert.deepEqual([u1.defMax, u4.defMax, u5.defMax, u10.defMax], [2, 2, 3, 4]);
  assert.deepEqual([u1.atk, u5.atk], [5, 13]);
  assert.equal(u1.flying, true);
  assert.equal(c.leveledSides(1, 4), 4);
  assert.equal(c.leveledSides(5, 4), 6);
  assert.equal(c.S.EnemyAI.SPEC.crow.aim, "lowest", "主动接近血量最低的敌人");
});

test("穴鸦成群出现：一群 4–6 只，占满一场的代币，算普通战斗", () => {
  const c = H.load();
  const counts = new Set();
  for (let i = 0; i < 40; i++) {
    const enc = c.rollEncounter({ region: "外城区", faction: "野生", mixed: false });
    const crows = enc.enemies.filter(e => e.preset === "crow").reduce((a, e) => a + (e.count || 1), 0);
    assert.ok(crows >= 4 && crows <= 6, "穴鸦 " + crows + " 只");
    assert.equal(enc.tier, "normal");
    counts.add(crows);
  }
  assert.ok(counts.size >= 2, "数量应该有变化：" + [...counts].join(","));
});

test("穴鸦击杀奖励 15 奎支：手册和单局都是", () => {
  const c = H.load();
  assert.equal(c.rollEnemyLoot({ kit: "crow" }), 15);
  c.S.state.lootByRank = { minion: 80, elite: 460, boss: 920 };
  c.S.state.lootByKit = c.S.ROGUE_CONFIG.lootByKit;
  assert.equal(c.rollEnemyLoot({ kit: "crow" }), 15);
  assert.equal(c.rollEnemyLoot({ kit: "thug_knife" }), 80, "其他杂兵照旧按三档");
});

test("首领架势是原来的 60%（向下取整），人数加成也打六折；非首领不变", () => {
  const c = H.load();
  const preset = (id) => c.enemyPresets().find(p => p.id === id);
  // 亡命之王 lv1 原本 7，lv5 原本 8
  assert.equal(preset("outlaw_king").build(1, 2).defMax, 4);
  assert.equal(preset("outlaw_king").build(5, 2).defMax, 4);
  // 人数加成在开战时补上（rebalanceEnemiesForParty）
  const k4 = preset("outlaw_king").build(1, 2); c.rebalanceEnemiesForParty(4, [k4]);
  assert.equal(k4.defMax, 4 + 3, "4 人队加成 6 → 3");
  const k3 = preset("outlaw_king").build(1, 2); c.rebalanceEnemiesForParty(3, [k3]);
  assert.equal(k3.defMax, 4 + 1, "3 人队加成 3 → 1");
  const e4 = preset("bandit_boss").build(1, 2); const e4d = e4.defMax; c.rebalanceEnemiesForParty(4, [e4]);
  assert.equal(e4.defMax, e4d + 4, "精英的人数加成不变");
  // 沙灵聚合体 lv1 原本 11
  assert.equal(preset("sand_aggregate").build(1, 2).defMax, 6);
  // 精英不受影响（强盗头子 lv1）
  const boss = preset("bandit_boss").build(1, 2);
  assert.ok(boss.defMax >= 6);
});

test("首领要攒满 2 个晕眩标记才晕：第一次只记标记、架势回满、不给协助攻击；第二次才晕", () => {
  const { c, st } = field(["ruby", "kolt"], [{ id: "outlaw_king", lv: 1, zone: 1 }]);
  const king = st.units.find(u => u.kit === "outlaw_king");
  const ruby = c.findKit("ruby", st.units);
  st.assistQueue = [];
  const notes = [];
  c.dealBreak(king, 99, "physical", notes, "测试");
  assert.equal(king.stunned, false, "第一次不晕");
  assert.equal(king.stunMarks, 1);
  assert.equal(king.def, king.defMax, "架势回满");
  assert.equal(st.assistQueue.length, 0, "不给协助攻击");
  assert.match(notes.join("\n"), /【晕眩标记】.*标记 1\/2/);
  c.dealBreak(king, 99, "physical", notes, "测试");
  assert.equal(king.stunned, true, "第二次晕了");
  assert.equal(king.stunMarks, 0, "晕了以后标记清零");
  assert.ok(st.assistQueue.some(j => j.targetId === king.id), "这次给协助攻击");
  // 晕眩结束后重新攒
  c.recoverFromStun(king, []);
  c.dealBreak(king, 99, "physical", [], "测试");
  assert.equal(king.stunned, false);
  assert.equal(king.stunMarks, 1);
  // 其他来源的晕眩（直接被设成晕眩，例如不稳 / 高压场地）也只记标记：行动结束时兜底
  king.stunned = true;
  st.attackerId = ruby.id; st.targetId = null;
  c.runSkill("ruby_prep");
  assert.equal(king.stunned, true, "第二个标记：晕了");
  // 普通敌人一次就晕
  const f2 = field(["ruby"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const thug = f2.st.units.find(u => !u.isPlayer);
  f2.c.dealBreak(thug, 99, "physical", [], "测试");
  assert.equal(thug.stunned, true);
});
