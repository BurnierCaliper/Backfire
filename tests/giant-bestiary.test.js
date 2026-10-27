// #340 第 19 条：巨人招式图鉴文字按等级颗 d8（和实际 diceN: a.level 一致）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

test("巨人图鉴：近距砸击 / 远距能量写「等级颗 d8」，不再写「1d8」", () => {
  const c = H.load();
  const abs = c.S.BESTIARY_TEXT.giant.abilities;
  const near = abs.find(s => s.includes("近距砸击"));
  const far = abs.find(s => s.includes("远距能量"));
  assert.ok(near && near.includes("等级颗 d8"), "近距砸击应写等级颗 d8，实际：" + near);
  assert.ok(far && far.includes("等级颗 d8"), "远距能量应写等级颗 d8，实际：" + far);
  assert.ok(!near.includes("1d8"), "近距砸击不应再写 1d8");
  assert.ok(!far.includes("1d8"), "远距能量不应再写 1d8");
});

/** 4 级巨人在 2 区，对柯尔特打一次 skill（柯尔特站 zone 区）；每颗 d8 都掷 8，返回这次的战斗记录 */
function giantHit(skill, zone) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "giant", lv: 4, zone: 2 }], seed: "GIANT-D8", zoneMode: 2 });
  c.startCombat();
  const S = c.S.state;
  const k = c.findKit("kolt", S.units), g = S.units.find(u => u.kit === "giant");
  k.zone = zone; k.bonus = 1; k.layers.forEach(l => { l.max = 999; l.current = 999; });
  S.combatPhase = "enemy"; g.ap = 1; S.attackerId = g.id; S.targetId = k.id;
  const lines0 = S.logPages.flatMap(p => p.lines).length;
  c.Math.random = () => 0.999;   // 每颗 d8 都掷出 8
  c.runSkill(skill);
  c.BattleSim.resolveQueues({ pickBlocker: () => null, pickAssister: l => l[0].id });
  return S.logPages.flatMap(p => p.lines).slice(lines0).map(l => l.text).join("\n");
}

test("巨人实际掷骰：4 级的近距砸击（同区）、远距能量（隔一区）都掷 4 颗 d8，合计 32（和图鉴文字对得上）", () => {
  for (const [skill, zone] of [["en_giant_near", 2], ["en_giant_far", 1]]) {
    const log = giantHit(skill, zone);
    assert.match(log, /掷骰 4d8（8\+8\+8\+8） → 32/, skill + "\n" + log);
    assert.match(log, /基础伤害：ATK 6 \+ 骰子 32 =/, skill + "\n" + log);
  }
});
