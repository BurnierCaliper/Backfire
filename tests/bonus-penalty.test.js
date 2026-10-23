// 附赠动作惩罚（作者裁定）：不稳、空手格挡各 −1（不再清零），所有加成算完再扣，两个都有 −2，最少 0；我方和敌人同一个顺序
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function setup(foeId) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: foeId || "mecha_mg", lv: 1, zone: 2 }], seed: "BP" });
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
  if (opt.carry) { hero.resources = hero.resources || {}; hero.resources.stanceCarry = { turn: Number(S.turnNo), n: opt.carry }; }
  c.refreshEconomy(hero);
  return { bonus: hero.bonus, hero };
}
function enemy(opt) {
  const { c, S, foe } = setup(opt.id);
  if (opt.driver) foe.vehMerged = true;
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

test("敌人（精英，基础 1 附赠）：同一个顺序，顺风抵得掉、两个 −2、最少 0，日志写 −1", () => {
  const base = enemy({}).bonus, tw = enemy({ tail: true }).bonus;
  assert.equal(base, 1, "机甲触灵（机枪）基础 1 附赠");
  assert.equal(tw, 2);
  const u = enemy({ tail: true, unstable: true });
  assert.equal(u.bonus, 1, "顺风 + 不稳：先加再扣（main 上是 0）");
  assert.ok(u.notes.some(n => /不稳：这回合附赠动作 −1/.test(n)));
  assert.equal(u.foe.statuses.unstable, false);
  const b = enemy({ tail: true, bare: true });
  assert.equal(b.bonus, 1, "顺风 + 空手：先加再扣（main 上是 2）");
  assert.ok(b.notes.some(n => /空手格挡：这回合附赠动作 −1/.test(n)));
  assert.equal(enemy({ tail: true, unstable: true, bare: true }).bonus, 0);
  assert.equal(enemy({ unstable: true, bare: true }).bonus, 0, "1 − 2 最少 0");
});

test("剑术+ 留到这回合的附赠也是加成：先加再扣", () => {
  assert.equal(player({ carry: 1 }).bonus, 2);
  assert.equal(player({ carry: 1, unstable: true }).bonus, 1);
  const r = player({ carry: 1, unstable: true, bare: true });
  assert.equal(r.bonus, 0, "1 + 1 − 2 = 0（以前扣完再加是 1）");
  assert.equal(r.hero.bonusMax, 0);
  assert.equal(r.hero.resources.stanceCarry, null);
});

test("载具驾驶员最少 1 个附赠也是加成：先托底再扣，日志的数和实际扣掉的一样", () => {
  const a = enemy({ id: "thug_knife", driver: true });
  assert.equal(a.bonus, 1, "驾驶员托底到 1");
  const b = enemy({ id: "thug_knife", driver: true, unstable: true });
  assert.equal(b.bonus, 0, "托底 1 再扣不稳 → 0（以前扣完再托底，照样 1）");
  assert.ok(b.notes.some(n => /不稳：这回合附赠动作 −1/.test(n)));
  const d = enemy({ id: "thug_knife", driver: true, unstable: true, bare: true });
  assert.equal(d.bonus, 0);
  assert.ok(d.notes.some(n => /不稳：这回合附赠动作 −1/.test(n)));
  assert.ok(d.notes.some(n => /空手格挡：本来就没有附赠动作，没有可扣的/.test(n)), "第二个惩罚没东西可扣时不写 −1");
});

test("杂兵本来没有附赠：日志不写 −1，写没有可扣的", () => {
  const r = enemy({ id: "thug_knife", unstable: true });
  assert.equal(r.bonus, 0);
  assert.ok(!r.notes.some(n => /附赠动作 −1/.test(n)));
  assert.ok(r.notes.some(n => /不稳：本来就没有附赠动作，没有可扣的/.test(n)));
});

test("新文字的正面断言：图鉴「不稳」、规则页、空手格挡日志都写 −1", () => {
  const fs = require("node:fs"), path = require("node:path");
  const rd = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  assert.ok(rd("codex.js").includes("附赠动作 −1"));
  assert.ok(rd("rulebook.js").includes("附赠动作 −1"));
  assert.ok(rd("app.js").includes("：这回合附赠动作 −${n}。"));
});
