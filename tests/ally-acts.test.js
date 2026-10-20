// H8：跑团模板「我方同阵营」的友军在敌人回合按 AI 行动（ai.js · actors / actingOrder）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(extra) {
  const c = H.load();
  const enc = c.battleTemplateToEncounter(c.battleTemplateNormalize({ name: "友军行动", board: 2, playerZone: 1, allyFaction: "警卫队",
    enemies: [{ preset: "guard_sword", level: 3, zone: 2 }, { preset: "thug_knife", level: 3, zone: 2 }].concat(extra || []) }));
  c.BattleSim.setup({ party: ["kolt"], encounter: enc, level: 3, seed: "ALLYACT" });
  c.startCombat();
  const S = c.S.state;
  return { c, S, g: S.units.find(u => u.kit === "guard_sword"), t: S.units.find(u => u.kit === "thug_knife"), k: c.findKit("kolt", S.units) };
}
const react = c => c.BattleSim.resolveQueues({ pickBlocker: () => null, pickAssister: l => l[0].id });
/** 跑一遍敌人回合：和 sim.js · enemyPhase 一样按 actingOrder 轮流行动 */
function enemyRound(c, S) {
  c.startEnemyPhase();
  for (const id of c.EnemyAI.actingOrder()) {
    for (let n = 0; n < 5; n++) {
      const u = c.unitById(id);
      if (!u || !c.EnemyAI.unitAlive(u) || u.stunned || (u.ap || 0) <= 0) break;
      const plan = c.EnemyAI.plan(u);
      if (!plan) break;
      plan.thunk(); react(c);
    }
  }
}

test("友军在敌人回合行动：打同区敌对的盗匪，不打我方；foes() 照旧不含友军", () => {
  const { c, S, g, t, k } = field();
  assert.ok(c.playerAllied(g));
  assert.ok(c.EnemyAI.actingOrder().includes(g.id), "友军在敌人回合的行动名单里");
  assert.ok(!c.EnemyAI.foes().includes(g), "foes() 不含友军（胜负判定用）");
  const t0 = c.totalHp(t), k0 = c.totalHp(k);
  enemyRound(c, S);
  assert.ok(c.totalHp(t) < t0, "盗匪挨了友军的打");
  assert.equal(c.totalHp(k), k0, "友军不打我方");
});

test("友军打死的敌人：没有经验和击杀分；只剩友军时判我方胜利", () => {
  const { c, S, g, t, k } = field();
  t.layers.forEach(l => { l.current = 1; });
  const xp0 = k.xp || 0;
  const score0 = JSON.stringify(S.score || null);
  for (let i = 0; i < 4 && !t.dead; i++) { S.turnNo += 1; enemyRound(c, S); }
  assert.ok(t.dead, "盗匪被友军打倒");
  assert.equal(k.xp || 0, xp0, "没有经验");
  assert.equal(JSON.stringify(S.score || null), score0, "没有击杀分");
  assert.ok(!g.dead);
  assert.equal(c.BattleSim.outcome(), "player", "只剩友军：我方胜利");
});
