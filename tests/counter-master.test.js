"use strict";
// 克制大师：我方主动发起的攻击里克制或吃到天气增益的占一半及以上 → 胜利时整场 ×1.5；B 及以上分数线 ×1.15
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "kolt", "tou"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "CMASTER" });
  const st = c.S.state;
  st.turnNo = 4;
  st.battleScore.hurt = true;
  st.combatPhase = "player";
  const hero = st.units.find(u => u.isPlayer && !c.isWeaponUnit(u));
  const foe = st.units.find(u => !u.isPlayer);
  /** 我方 hero 发起一次行动，打 hits 下（每下的 res） */
  const act = (...ress) => { c.beginActionAcc(hero, "x"); ress.forEach(r => c.noteCounterAttack(hero, foe, r, { action: true })); };
  return { c, st, hero, foe, act };
}
const ADV = { advantage: true }, WEA = { weatherUp: 3 }, NONE = { advantage: false, weatherUp: 0 };

test("克制大师：克制、天气增益任一即算数；一次行动打几下只算一次攻击", () => {
  const { c, act } = field();
  act(ADV); act(WEA); act(NONE, NONE, ADV); act(NONE, NONE);
  assert.deepEqual({ ...c.counterMasterInfo() }, { attacks: 4, qual: 3, ok: true });
});

test("克制大师：协助攻击、借机 / 反击、持续伤害、环境、敌方回合、别人的行动都不算", () => {
  const { c, st, hero, foe } = field();
  c.beginActionAcc(hero, "x");
  for (const f of [{ action: true, assist: true }, { action: true, opp: true }, { action: true, opportunity: true }, { action: false }, { action: true, environment: true }])
    c.noteCounterAttack(hero, foe, ADV, f);
  st._assistBy = "someone"; c.noteCounterAttack(hero, foe, ADV, { action: true }); st._assistBy = null;
  c.beginActionAcc(foe, "y"); c.noteCounterAttack(hero, foe, ADV, { action: true });           // 敌人的行动里我方反打
  c.beginActionAcc(hero, "x"); st.combatPhase = "enemy"; c.noteCounterAttack(hero, foe, ADV, { action: true });
  c.noteCounterAttack(foe, hero, ADV, { action: true });                                        // 敌人打我方
  assert.equal(c.counterMasterInfo().attacks, 0);
});

test("克制大师：正好 50% 达成，低于 50% 不达成", () => {
  let f = field(); f.act(ADV); f.act(NONE);
  assert.equal(f.c.counterMasterInfo().ok, true);
  f = field(); f.act(ADV); f.act(NONE); f.act(NONE);
  assert.equal(f.c.counterMasterInfo().ok, false);
});

test("克制大师：0 次攻击不达成；达成时胜利结算整场 ×1.5，结算摘要带上它", () => {
  let f = field();
  f.st.battleScore.total = 1000;
  let r = f.c.settleBattleRewards("win");
  assert.equal(r.finishBonus.counterMaster, false);
  assert.equal(r.grade.score, 1000);
  f = field(); f.act(ADV);
  f.st.battleScore.total = 1000;
  r = f.c.settleBattleRewards("win");
  assert.equal(r.finishBonus.counterMaster, true);
  assert.equal(r.grade.score, 1500);
  assert.equal(f.st.battleScore.parts.counterMaster, 500);
  assert.match(require("fs").readFileSync(require("path").join(__dirname, "..", "app.js"), "utf8"), /counterMaster: "克制大师"/);
});

test("克制大师：输了不乘", () => {
  const f = field(); f.act(ADV);
  f.st.battleScore.total = 1000;
  f.c.settleBattleRewards("lose");
  assert.equal(f.st.battleScore.total, 1000);
});

test("真实攻击：dealTo 打中敌人会记一次我方主动攻击", () => {
  const { c, hero, foe } = field();
  c.beginActionAcc(hero, "x");
  c.dealTo(hero, foe, { atk: 1, mult: 0.1, element: "physical", baseBreak: 0, flags: { action: true } });
  assert.equal(c.counterMasterInfo().attacks, 1);
});

test("分数线：B 及以上 ×1.15（向上取整到 10），C、D 不变；不看有没有克制大师", () => {
  const { c } = field();
  for (const act of [1, 3]) {
    const L = c.gradeLines(act, null), byG = Object.fromEntries(L.map(x => [x[0], x[1]]));
    const BASE = { C: 500, B: 1000, A: 1250, S: 1500, SS: 1750, SSS: 2000 }, fixed = g => BASE[g] + (act - 1) * 150;
    for (const g of ["B", "A", "S", "SS", "SSS"]) assert.equal(byG[g], Math.ceil(fixed(g) * 1.15 / 10 - 1e-9) * 10, `${act} 幕 ${g}`);
    assert.equal(byG.C, fixed("C"));
    assert.equal(byG.D, 0);
  }
  assert.equal(c.gradeLines(1, null).find(x => x[0] === "S")[1], 1730);
  const par = 800, mixed = c.gradeLines(1, par).find(x => x[0] === "B");
  assert.equal(mixed[1], Math.ceil((1000 * 0.65 + par * mixed[4] * 0.35) * 1.15 / 10 - 1e-9) * 10);
});
