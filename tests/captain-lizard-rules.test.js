// 警卫队队长（蜥蜴）：ATK 每级 +1；酸弹骰数每 5 级 +1；AI 优先后排（远程角色）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

const plain = x => JSON.parse(JSON.stringify(x));

function buildLiz(c, lv, p) {
  return c.enemyPresets().find(x => x.id === "captain_lizard").build(lv, p || 2);
}

test("ATK：7 + (等级−1)，若干等级", () => {
  const c = H.load();
  for (const [lv, want] of [[1, 7], [2, 8], [5, 11], [10, 16], [15, 21], [20, 26]]) {
    assert.equal(buildLiz(c, lv).atk, want, lv + " 级 ATK");
  }
});

test("单位 dice：与酸弹一致，1 + ⌊等级/5⌋ 颗 d6", () => {
  const c = H.load();
  for (const [lv, n] of [[1, 1], [4, 1], [5, 2], [9, 2], [10, 3], [20, 5]]) {
    assert.deepEqual(plain(buildLiz(c, lv).suggest.dice), [n, 6], lv + " 级 suggest.dice");
    assert.equal(c.addedDiceByLevel(lv), n, lv + " 级 addedDiceByLevel");
  }
});

test("酸弹 en_liz：真实 runSkill 掷 (1+⌊lv/5⌋)d6；协助不加骰", () => {
  function hit(lv, skill) {
    const c = H.load();
    c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "captain_lizard", lv, zone: 2 }], seed: "LIZ-DICE-" + lv + "-" + skill, zoneMode: 3 });
    c.startCombat();
    const S = c.S.state;
    const k = c.findKit("kolt", S.units), liz = S.units.find(u => u.kit === "captain_lizard");
    k.zone = 1; k.layers.forEach(l => { l.max = 9999; l.current = 9999; });
    S.combatPhase = "enemy"; liz.ap = 1; S.attackerId = liz.id; S.targetId = k.id;
    const n0 = S.logPages.flatMap(p => p.lines).length;
    c.Math.random = () => 0.999;   // 每颗 d6 都掷 6
    c.runSkill(skill);
    c.BattleSim.resolveQueues({ pickBlocker: () => null, pickAssister: l => l[0].id });
    return S.logPages.flatMap(p => p.lines).slice(n0).map(l => l.text).join("\n");
  }
  for (const [lv, n] of [[1, 1], [5, 2], [10, 3], [20, 5]]) {
    const log = hit(lv, "en_liz");
    const sum = n * 6;
    if (n === 1) assert.match(log, /掷骰 1d6 → 6/, lv + " 级酸弹\n" + log);
    else {
      const parts = Array(n).fill("6").join("+");
      assert.match(log, new RegExp(`掷骰 ${n}d6（${parts.replace(/\+/g, "\\+")}） → ${sum}`), lv + " 级酸弹\n" + log);
    }
  }
  const assist = hit(5, "en_liz_assist");
  assert.doesNotMatch(assist, /掷骰/, "协助不加骰\n" + assist);
  assert.match(assist, /酸/, "协助仍是酸\n" + assist);
});

test("AI aim back：隔一区同时有高血前排（非远程）和低血远程时，优先远程；保持距离 1", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "captain_lizard", lv: 5, zone: 2 }], seed: "LIZ-BACK", zoneMode: 3 });
  c.startCombat();
  const S = c.S.state;
  S.zoneMode = 3; S.combatPhase = "enemy";
  const liz = S.units.find(u => u.kit === "captain_lizard");
  const kolt = c.findKit("kolt", S.units), helu = c.findKit("helu", S.units);
  liz.zone = 2; liz.ap = 1; liz.bonus = 1; liz.stunned = false; liz.race = null;
  // 同在 1 区（对蜥蜴距离 1）：柯尔特 range any、血量拉满；夕夏 range ranged、血量很少
  kolt.zone = 1; helu.zone = 1;
  kolt.layers.forEach(l => { l.max = 500; l.current = 500; });
  helu.layers.forEach(l => { l.max = 20; l.current = 20; });
  assert.notEqual(kolt.range, "ranged", "柯尔特不算后排远程");
  assert.equal(helu.range, "ranged", "夕夏是远程后排");
  assert.ok(c.EnemyAI.SPEC.captain_lizard.dist === 1 && c.EnemyAI.SPEC.captain_lizard.aim === "back");
  const preyOf = () => S.units.filter(u => u.isPlayer && !u.dead && !u.hidden && !(u.dying && !u.upOnShp));
  const pick = c.EnemyAI.target(liz, c.EnemyAI.SPEC.captain_lizard, preyOf()).unit;
  assert.equal(pick.id, helu.id, "优先低血远程，不挑高血前排");
  // 没有远程时：同档距离里挑血量最低的（仍保持 dist 1）
  helu.dead = true;
  const only = c.EnemyAI.target(liz, c.EnemyAI.SPEC.captain_lizard, preyOf()).unit;
  assert.equal(only.id, kolt.id, "没有远程时打得到的前排");
  // 两边都是远程：挑血量更低的
  helu.dead = false;
  kolt.range = "ranged";
  const both = c.EnemyAI.target(liz, c.EnemyAI.SPEC.captain_lizard, preyOf()).unit;
  assert.equal(both.id, helu.id, "两个远程时同档血量最低");
});

test("图鉴：移动写优先后排；酸弹注明骰数每 5 级 +1；diceScale 有蜥蜴", () => {
  const c = H.load();
  const t = c.S.BESTIARY_TEXT.captain_lizard;
  assert.match(t.move, /优先后排/);
  assert.ok(t.abilities.some(a => /酸弹/.test(a) && /骰数每 5 级/.test(a)), JSON.stringify(t.abilities));
  assert.ok(c.bestiaryStats("captain_lizard", 15, 2).diceScale, "图鉴伤害骰栏");
});

test("游戏版：蜥蜴打在起身中的角色上，日志不出现剩余坚毅生命数字", () => {
  const c = H.load();
  c.GAME_MODE = true;
  assert.equal(c.shpHidden(), true);
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "captain_lizard", lv: 5, zone: 2 }], seed: "LIZ-SHP", zoneMode: 3 });
  c.startCombat();
  const S = c.S.state;
  const k = c.findKit("kolt", S.units), liz = S.units.find(u => u.kit === "captain_lizard");
  k.zone = 1; k.layers.forEach(l => { l.max = 1; l.current = 0; });
  k.dying = false; k.upOnShp = true; k.shp = 40; k.shpMax = 40;
  S.combatPhase = "enemy"; liz.zone = 2; liz.ap = 1; S.attackerId = liz.id; S.targetId = k.id;
  const n0 = S.logPages.flatMap(p => p.lines).length;
  c.Math.random = () => 0.5;
  c.runSkill("en_liz");
  c.BattleSim.resolveQueues({ pickBlocker: () => null, pickAssister: l => l[0].id });
  const log = S.logPages.flatMap(p => p.lines).slice(n0).map(l => l.text).join("\n");
  assert.doesNotMatch(log, /坚毅\s*\d+\s*[→\-−]/, "不得写出剩余坚毅\n" + log);
  assert.doesNotMatch(log, /坚毅生命\s*[（(]?\s*\d+\s*[→\-−]/, "不得写出剩余坚毅生命\n" + log);
});
