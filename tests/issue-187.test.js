// #187（主人定 10/21）：打中立生物的得分降到 1/4；格挡反伤打死的敌人算格挡者的击杀
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function setup(party, enemies, seed) {
  const c = H.load();
  c.BattleSim.setup({ party, enemies, seed: seed || "I187", zoneMode: 3 });
  c.startCombat();
  return { c, S: c.S.state };
}
const kit = (S, k) => S.units.find(u => u.kit === k && !u.hidden);
const kills = (c, u) => (c.battleStat(u) || {}).kills || 0;
const hit = (c, a, t, opt) => c.dealTo(a, t, Object.assign({ atk: 0, mult: 0, element: "physical", baseBreak: 0, atkRange: "any",
  flags: { action: true, blockResolved: true, block: "none" } }, opt));
const actAs = (S, u) => { S.actionAcc = { dmg: 0, brk: 0, hits: 0, calls: 0, targets: [], side: 0, sideBy: {}, actorIsPlayer: true, actorId: u.id }; };

/* ---------- 1. 打中立生物的得分 ×1/4 ---------- */

test("倍率放在 SCORE_RULES.neutralMul", () => {
  const { c } = setup(["kolt", "helu"], [{ id: "dust_bug", lv: 1, zone: 1 }]);
  assert.equal(c.S.SCORE_RULES.neutralMul, 0.25);
});

/** 同样的一击打在尘虫和狂徒身上，伤害分 / 击破分的比例 */
function scoreOf(enemyId, flat, brk) {
  const { c, S } = setup(["kolt", "helu"], [{ id: enemyId, lv: 1, zone: 1 }]);
  const kolt = kit(S, "kolt"), foe = S.units.find(u => !u.isPlayer);
  foe.layers = [{ type: "flesh", current: 400, max: 400, inner: true }];
  actAs(S, kolt);
  hit(c, kolt, foe, { flat, baseBreak: brk });
  return { c, S, parts: Object.assign({}, S.battleScore.parts), foe };
}

test("打中立生物：伤害分、击破分只拿 1/4", () => {
  const bug = scoreOf("dust_bug", 40, 2);
  assert.ok(bug.c.isNeutralCreature(bug.foe));
  const thug = scoreOf("thug_knife", 40, 2);
  assert.ok(thug.parts.dmg >= 40, "对照：打狂徒伤害分是满额 " + JSON.stringify(thug.parts));
  assert.equal(bug.parts.dmg, Math.floor(thug.parts.dmg * 0.25), "伤害分 1/4：" + JSON.stringify(bug.parts));
  assert.ok(thug.parts.brk > 0);
  assert.equal(bug.parts.brk || 0, Math.floor(thug.parts.brk * 0.25), "击破分 1/4：" + JSON.stringify(bug.parts));
});

test("打中立生物：溢出分 1/4", () => {
  const run = (id) => {
    const { c, S } = setup(["kolt", "helu"], [{ id, lv: 1, zone: 1 }]);
    const kolt = kit(S, "kolt"), foe = S.units.find(u => !u.isPlayer);
    foe.layers = [{ type: "flesh", current: 10, max: 10, inner: true }];
    actAs(S, kolt);
    hit(c, kolt, foe, { flat: 410 });
    return S.battleScore.parts.overkill || 0;
  };
  const full = run("thug_knife"), quarter = run("dust_bug");
  assert.ok(full > 100, "对照：满额溢出分 " + full);
  assert.equal(quarter, Math.floor(full * 0.25));
});

test("打中立生物：失衡分 1/4（trackHealBy）", () => {
  const run = (id) => {
    const { c, S } = setup(["kolt", "helu"], [{ id, lv: 1, zone: 1 }]);
    const kolt = kit(S, "kolt"), foe = S.units.find(u => !u.isPlayer);
    foe.layers = [{ type: "flesh", current: 400, max: 400, inner: true }];
    c.trackHealBy(kolt, () => { foe.stunned = true; });
    return S.battleScore.parts.stagger || 0;
  };
  assert.equal(run("thug_knife"), c0().S.SCORE_RULES.stagger);
  assert.equal(run("dust_bug"), Math.floor(c0().S.SCORE_RULES.stagger * 0.25));
});
function c0() { return H.load(); }

test("基准分照旧不算中立生物", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "dust_bug", lv: 1, zone: 1 }]);
  S.scoreSeen = {};
  assert.equal(c.scorePar(), 0);
});

/* ---------- 2. 格挡反伤打死的敌人算格挡者 ---------- */

test("雷鸣：协助格挡成功的反伤打死敌人，击杀算格挡者（没人打过它也算）", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "thug_hammer", lv: 1, zone: 1 }]);
  const kolt = kit(S, "kolt"), helu = kit(S, "helu"), foe = S.units.find(u => !u.isPlayer);
  S.weather = "thunder";
  foe.layers = [{ type: "flesh", current: 1, max: 50, inner: true }];
  c.performAssistBlock(helu, kolt, foe, { ok: true, roll: 1 });
  c.sweepDeadEnemies();
  assert.equal(foe._xpGiven, true, "反伤打死了它");
  assert.equal(kills(c, helu), 1, "算格挡者 Helumica");
  assert.equal(kills(c, kolt), 0);
});

test("雷鸣：先被柯尔特打过，反伤补刀仍算格挡者", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "thug_hammer", lv: 1, zone: 1 }]);
  const kolt = kit(S, "kolt"), helu = kit(S, "helu"), foe = S.units.find(u => !u.isPlayer);
  S.weather = "thunder";
  foe.layers = [{ type: "flesh", current: 50, max: 50, inner: true }];
  hit(c, kolt, foe, { flat: 49 });
  c.performAssistBlock(helu, kolt, foe, { ok: true, roll: 1 });
  c.sweepDeadEnemies();
  assert.equal(foe._xpGiven, true);
  assert.equal(kills(c, helu), 1);
  assert.equal(kills(c, kolt), 0);
});

test("哔哩哩格挡反伤打死敌人：击杀算哔哩哩", () => {
  const { c, S } = setup(["chuan", "kolt"], [{ id: "thug_hammer", lv: 1, zone: 1 }]);
  const ch = kit(S, "chuan"), kolt = kit(S, "kolt"), foe = S.units.find(u => !u.isPlayer);
  const bili = c.spawnWeapon(ch, "bili");
  bili.zone = kolt.zone = foe.zone = 1; bili.bonus = 1; bili.def = bili.defMax = 3;
  kolt.prideMaxHp = Infinity;
  foe.layers = [{ type: "flesh", current: 500, max: 500, inner: true }];
  c.endPlayerTurn();
  bili.bonus = 1;
  c.dealTo(foe, kolt, { atk: 20, mult: 1, element: "physical", baseBreak: 2, flags: { action: true } });
  foe.layers = [{ type: "flesh", current: 1, max: 500, inner: true }];   // 反伤落下前把血压到 1
  c.finishBlock(bili.id, { roll: 1, ok: true });
  c.sweepDeadEnemies();
  assert.equal(foe._xpGiven, true, "反伤打死了它");
  assert.equal(kills(c, bili), 1, "算哔哩哩");
  assert.equal(kills(c, kolt), 0);
});

test("铁壁过载 / 雷鸣反伤打死敌人：击杀算川川", () => {
  for (const mode of ["overload", "thunder"]) {
    const { c, S } = setup(["chuan", "nora"], [{ id: "thug_knife", lv: 1, zone: 1 }], "I187W" + mode);
    const ch = kit(S, "chuan"), nora = kit(S, "nora"), foe = S.units.find(u => !u.isPlayer);
    ch.zone = 1; nora.zone = 1; ch.ap = 5; ch.bonus = 5; ch.resources.charge = 1;
    c.Commands.dispatch(plain({ type: "skill", actor: ch.id, skill: "chuan_wall" }));
    const wall = S.props.find(p => p.kind === "ironwall");
    wall.hp = wall.maxHp = 500;
    if (mode === "overload") c.applyInstantEffect(ch, "overload", []); else S.weather = "thunder";
    foe.layers = [{ type: "flesh", current: 1, max: 50, inner: true }];
    hit(c, foe, nora, { flat: 20 });
    c.sweepDeadEnemies();
    assert.equal(foe._xpGiven, true, mode + "：反伤打死了它");
    assert.equal(kills(c, ch), 1, mode + "：算川川");
    assert.equal(kills(c, nora), 0);
  }
});
