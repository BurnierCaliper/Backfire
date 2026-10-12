// 战斗评分：给其他友方的治疗 / 护盾每点 1.5 分（比伤害高 50%，让治疗者的贡献显得出来）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

test("治疗计分：每点 1.5 分（向下取整），记在治疗者身上", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["yuito", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "HEALSCORE" });
  c.startCombat();
  const S = c.S.state;
  const y = c.findKit("yuito", S.units), kolt = c.findKit("kolt", S.units);
  y.zone = 1; kolt.zone = 1; y.ap = 3; y.bonus = 3;
  y.resources.liquid = 3;
  kolt.layers.forEach(l => { l.current = 1; });
  const hp0 = c.totalHp(kolt), heal0 = (S.battleScore.parts.heal || 0);
  c.Commands.dispatch(plain({ type: "skill", actor: y.id, skill: "yuito_amer", target: kolt.id, picks: { mode: "heal", target: kolt.id } }));
  const gain = c.totalHp(kolt) - hp0;
  assert.ok(gain > 0, "治疗到了");
  assert.equal((S.battleScore.parts.heal || 0) - heal0, Math.floor(gain * 1.5));
});
