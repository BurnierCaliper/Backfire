// 附赠动作惩罚（作者裁定）：不稳、空手格挡各 −1（不再清零），所有加成算完再扣，两个都有 −2，最少 0；我方和敌人同一个顺序
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function setup() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "BP" });
  const S = c.S.state;
  c.startCombat();
  return { c, S, hero: S.units.find(u => u.kit === "kolt"), foe: S.units.find(u => !u.isPlayer) };
}
function tail(c, S, on) { if (on) { S.weather = "sand"; c.sandWind = () => 1; } else S.weather = null; }
function player(opt) {
  const { c, S, hero } = setup();
  tail(c, S, opt.tail);
  hero.statuses = hero.statuses || {};
  hero.statuses.unstable = !!opt.unstable;
  hero.loseBonusNext = !!opt.bare;
  c.refreshEconomy(hero);
  return { bonus: hero.bonus, hero };
}
function enemy(opt) {
  const { c, S, foe } = setup();
  tail(c, S, opt.tail);
  foe.flying = false;
  foe.statuses = foe.statuses || {};
  foe.statuses.unstable = !!opt.unstable;
  foe.loseBonusNext = !!opt.bare;
  S.combatPhase = "enemy";
  const notes = [];
  c.refreshEnemyEconomy(foe, notes);
  return { bonus: foe.bonus, foe, notes };
}

test("我方：基准 1；不稳 −1、空手格挡 −1，触发后标记清掉", () => {
  assert.equal(player({}).bonus, 1);
  const a = player({ unstable: true });
  assert.equal(a.bonus, 0); assert.equal(a.hero.statuses.unstable, false);
  const b = player({ bare: true });
  assert.equal(b.bonus, 0); assert.equal(b.hero.loseBonusNext, false);
});

test("我方：沙暴顺风 +1 能抵掉一个惩罚；两个都有 −2，最少 0", () => {
  assert.equal(player({ tail: true }).bonus, 2);
  assert.equal(player({ tail: true, unstable: true }).bonus, 1);
  assert.equal(player({ tail: true, bare: true }).bonus, 1);
  assert.equal(player({ tail: true, unstable: true, bare: true }).bonus, 0);
  assert.equal(player({ unstable: true, bare: true }).bonus, 0, "1 − 2 最少 0");
});

test("敌人：同一个顺序，顺风抵得掉、两个 −2、最少 0，日志写 −1", () => {
  const base = enemy({}).bonus, tw = enemy({ tail: true }).bonus;
  assert.equal(tw, base + 1);
  const u = enemy({ tail: true, unstable: true });
  assert.equal(u.bonus, base);
  assert.ok(u.notes.some(n => /不稳：这回合附赠动作 −1/.test(n)));
  assert.equal(u.foe.statuses.unstable, false);
  assert.equal(enemy({ tail: true, bare: true }).bonus, base);
  assert.equal(enemy({ tail: true, unstable: true, bare: true }).bonus, Math.max(0, base - 1));
  assert.equal(enemy({ unstable: true, bare: true }).bonus, Math.max(0, base - 2));
  assert.ok(enemy({ unstable: true, bare: true }).bonus >= 0);
});
