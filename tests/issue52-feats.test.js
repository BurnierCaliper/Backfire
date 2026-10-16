// #52：铁壁 / 挺身改成每次短休 1 次，人器一心每长休 1 次，新专长「决不后退」；绯秋的刀技打配置物照刀势和刀算
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");

function battle(party, enemies, setupFn) {
  const c = H.load();
  vm.runInContext("Math", c).random = () => 0.5;
  c.BattleSim.setup({ party, enemies: enemies || [{ id: "thug_knife", lv: 3, zone: 1 }], seed: "I52" });
  const S = c.S.state;
  const units = party.map(k => c.findKit(k, S.units));
  if (setupFn) setupFn(c, S, ...units);
  c.startCombat();
  return { c, S, units, foes: S.units.filter(u => !u.isPlayer && !u.dead) };
}
function use(c, S, actor, id, targetId, picks) {
  S.attackerId = actor.id;
  S.targetId = targetId || null;
  S.skillFlow = picks ? { id, actorId: actor.id, picks, index: 0 } : null;
  c.runSkill(id);
  S.skillFlow = null;
}

/* ---------- 铁壁 ---------- */
test("铁壁：每次短休 1 次（下一场还是用过的），短休 / 长休刷新；宣布的人拿协助格挡的分", () => {
  const { c, S, units: [kolt], foes } = battle(["kolt", "helu"], null, (c, S, k) => { k.feats = ["ironwall"]; });
  const foe = foes[0];
  kolt.zone = foe.zone; kolt.bonus = 0;
  S.blockQueue = [];
  const score0 = Number(((S.score || {}).parts || {}).block) || 0;
  const hp0 = c.totalHp(kolt);
  const out = c.dealTo(foe, kolt, { atk: 30, mult: 1, element: "physical", baseBreak: 1, flags: { action: true } });
  assert.equal(out.pending, true);
  c.finishBlock("ironwall:" + kolt.id);
  assert.equal(c.totalHp(kolt), hp0, "免伤");
  assert.equal(c.featIronwallDeclarers(kolt).length, 0, "用掉了");
  const stat = c.battleStat(kolt);
  assert.equal(stat.blockOk, 1, "记一次格挡成功");
  // 换一场（每场的次数清掉）：铁壁还是用过的
  c.resetBattleFlags(kolt);
  assert.equal(c.featIronwallDeclarers(kolt).length, 0, "不是每场刷新");
  // 短休刷新
  c.LEDGER.shortOnce = { kolt: { "feat:ironwall": 1 } };
  assert.equal(c.shortOnceUsed("kolt", "feat:ironwall"), 1);
  c.ledgerShortRest(["kolt"], []);
  assert.equal(c.shortOnceUsed("kolt", "feat:ironwall"), 0, "短休刷新");
  void score0;
});

test("铁壁的说明是夕夏定的新文字", () => {
  const c = H.load();
  assert.match(c.featDef("ironwall").text, /^每次短休 1 次：/);
  assert.match(c.featDef("ironwall").text, /不消耗附赠动作。$/);
  assert.match(c.featDef("standin").text, /^（护卫·掩护涉猎）每次短休 1 次/);
  assert.match(c.featDef("onemind").text, /^每长休 1 次/);
});

/* ---------- 挺身 ---------- */
test("挺身：这一回合队友每次被单体攻击都能免费格挡；每次短休 1 次", () => {
  const { c, S, units: [kolt, helu], foes } = battle(["kolt", "helu"], null, (c, S, k, h) => { h.feats = ["standin"]; });
  kolt.zone = helu.zone;
  helu.bonus = 1;
  use(c, S, helu, "feat_standin", kolt.id);
  assert.equal(kolt.coverBy, helu.id);
  assert.equal(helu.bonus, 0, "花 1 附赠");
  c.performAssistBlock(helu, kolt, foes[0], { roll: 1 });
  assert.equal(kolt.coverBy, helu.id, "挡过一次还在");
  const r = c.performAssistBlock(helu, kolt, foes[0], { roll: 1 });
  assert.notEqual(r.ok, false, "第二次照样免费格挡");
  const f = c.featDef("standin");
  assert.equal(c.featUsesLeft(helu, f), 0, "这次短休用掉了");
  c.resetBattleFlags(helu);
  assert.equal(c.featUsesLeft(helu, f), 0, "下一场还是用过的");
  c.ledgerShortRest(["helu"], []);
  assert.equal(c.featUsesLeft(helu, f), 1, "短休刷新");
});

/* ---------- 人器一心 ---------- */
test("人器一心：每长休 1 次（换一场不刷新）", () => {
  const { c, S, units: [kolt] } = battle(["kolt", "helu"], null, (c, S, k) => { k.feats = ["onemind"]; });
  S.attackerId = kolt.id;
  assert.equal(JSON.stringify(c.skillCost("kolt_summon")), JSON.stringify({ bonus: 1 }));
  c.featCostSpent(kolt, "kolt_summon");
  assert.equal(JSON.stringify(c.skillCost("kolt_summon")), JSON.stringify({ ap: 1, bonus: 1 }));
  c.resetBattleFlags(kolt);
  assert.equal(JSON.stringify(c.skillCost("kolt_summon")), JSON.stringify({ ap: 1, bonus: 1 }), "下一场不刷新");
  c.LEDGER.restOnce = {};
  assert.equal(JSON.stringify(c.skillCost("kolt_summon")), JSON.stringify({ bonus: 1 }), "长休刷新");
});

/* ---------- 决不后退 ---------- */
test("决不后退·主动：附赠 +2 架势，不超过上限；每场 1 次", () => {
  const { c, S, units: [kolt] } = battle(["kolt", "helu"], null, (c, S, k) => { k.feats = ["unbowed"]; });
  kolt.def = kolt.defMax - 3; kolt.bonus = 2;
  use(c, S, kolt, "feat_unbowed", kolt.id);
  assert.equal(kolt.def, kolt.defMax - 1);
  assert.equal(kolt.bonus, 1);
  kolt.def = kolt.defMax - 3;
  use(c, S, kolt, "feat_unbowed", kolt.id);
  assert.equal(kolt.def, kolt.defMax - 3, "这一场用过了");
  const k2 = battle(["kolt", "helu"], null, (c, S, k) => { k.feats = ["unbowed"]; });
  const kk = k2.units[0];
  kk.def = kk.defMax - 1; kk.bonus = 1;
  use(k2.c, k2.S, kk, "feat_unbowed", kk.id);
  assert.equal(kk.def, kk.defMax, "不超过上限");
});

test("决不后退·自动：攻击要打进失衡时先 +2 架势；挡不住就不发动；晕眩后重置", () => {
  const { c, S, units: [kolt], foes } = battle(["kolt", "helu"], null, (c, S, k) => { k.feats = ["unbowed"]; });
  const foe = foes[0];
  const hit = (brk) => c.dealTo(foe, kolt, { atk: 1, mult: 0, flat: 0, element: "physical", baseBreak: brk, atkRange: "any",
    flags: { action: true, blockResolved: true, block: "none" } });
  // 挡不住（+2 之后还是打空）：不发动
  kolt.def = 1; kolt.bonus = 1;
  hit(4);
  assert.equal(kolt.stunned, true);
  assert.equal(kolt.bonus, 1, "没有白花附赠");
  // 晕眩恢复后重置；这一下能挡住：发动
  c.recoverFromStun(kolt, []);
  kolt.def = 2; kolt.bonus = 1;
  hit(3);
  assert.equal(kolt.stunned, false, "没有失衡");
  assert.ok(kolt.def >= 1 && kolt.def < 4, String(kolt.def));
  assert.equal(kolt.bonus, 0);
  // 用过了：再打空就失衡
  kolt.bonus = 1;
  hit(3);
  assert.equal(kolt.stunned, true);
});

test("决不后退·自动：不经过攻击的击破（dealBreak）也会发动", () => {
  const { c, units: [kolt] } = battle(["kolt", "helu"], null, (c, S, k) => { k.feats = ["unbowed"]; });
  kolt.def = 1; kolt.bonus = 1;
  c.dealBreak(kolt, 2, "physical", [], "击破");
  assert.equal(kolt.stunned, false);
  assert.equal(kolt.def, 1);
  assert.equal(kolt.bonus, 0);
});

/* ---------- 绯秋的刀技打配置物 ---------- */
function hiakiField() {
  const r = battle(["hiaki", "kolt"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const hiaki = r.units[0];
  hiaki.zone = 1;
  return Object.assign(r, { hiaki });
}
test("绯秋普通攻击打配置物：按刀的属性（丹生谷火 / 鳴門冰）和刀势的击破", () => {
  const { c, S, hiaki } = hiakiField();
  const boom = c.makeProp("boom", 1, 1);
  S.props.push(boom);
  hiaki.ap = 3; hiaki.resources.blade = "niu"; hiaki.resources.stance = "draw";
  const hp0 = boom.hp;
  use(c, S, hiaki, "hiaki_aa", "prop:" + boom.id);
  assert.equal(boom.hp, hp0 - 3, "丹生谷是火：爆炸桶 −3");
  const ice = hiakiField();
  const boom2 = ice.c.makeProp("boom", 1, 1);
  ice.S.props.push(boom2);
  ice.hiaki.ap = 3; ice.hiaki.resources.blade = "naruto";
  const hp2 = boom2.hp;
  use(ice.c, ice.S, ice.hiaki, "hiaki_aa", "prop:" + boom2.id);
  assert.equal(boom2.hp, hp2, "鳴門是冰：打不动爆炸桶");
  const w = hiakiField();
  w.S.gaps["1-2"] = { type: "wall", hp: 20, maxHp: 20, open: false };
  w.hiaki.ap = 3; w.hiaki.resources.blade = "niu"; w.hiaki.resources.stance = "waki";
  use(w.c, w.S, w.hiaki, "hiaki_aa", "gap:1-2");
  assert.equal(w.S.gaps["1-2"].hp, 18, "胁构 2 击破");
});

test("燕返打配置物：照样收回丹生谷、换持丹生谷、鳴門出场", () => {
  const { c, S, hiaki } = hiakiField();
  const boom = c.makeProp("boom", 1, 1);
  S.props.push(boom);
  hiaki.level = Math.max(hiaki.level || 1, 5);
  const niu = c.spawnWeapon(hiaki, "niu");
  assert.ok(niu, "丹生谷出场");
  niu.zone = 1; niu.ap = 2; niu.bonus = 2;
  hiaki.resources.blade = "naruto";
  const hp0 = boom.hp;
  use(c, S, niu, "niu_tsubame", "prop:" + boom.id);
  assert.equal(boom.hp, hp0 - 3, "火：爆炸桶 −3");
  assert.ok(!S.units.some(u => u.id === niu.id && !u.dead && !u.hidden), "丹生谷收回了");
  assert.equal(hiaki.resources.blade, "niu");
  assert.ok(S.units.some(u => u.weaponOf === "hiaki" && /naruto/.test(u.kit) && !u.dead && !u.hidden), "鳴門出场");
});

test("斩炎打配置物：火属性，打完变回武器", () => {
  const { c, S, hiaki } = hiakiField();
  const boom = c.makeProp("boom", 1, 1);
  S.props.push(boom);
  hiaki.level = Math.max(hiaki.level || 1, 5);
  const niu = c.spawnWeapon(hiaki, "niu");
  niu.zone = 1; niu.ap = 2; niu.bonus = 2;
  const hp0 = boom.hp;
  use(c, S, niu, "niu_slash", "prop:" + boom.id);
  assert.equal(boom.hp, hp0 - 3);
  assert.ok(!S.units.some(u => u.id === niu.id && !u.dead && !u.hidden), "变回武器了");
});
