// 补查修复（#175）：战-M1 ~ M5、战-L1、战-L2
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const D = require("../tools/dpt.js");

function field(party, enemies, extra) {
  const c = H.load();
  c.BattleSim.setup(Object.assign({ party, seed: "R175", zoneMode: 3, enemies }, extra || {}));
  c.startCombat();
  const st = c.S.state;
  return { c, st, kit: k => c.findKit(k, st.units), foe: () => st.units.find(u => !u.isPlayer) };
}
const kills = (c, u) => (c.battleStat(u) || {}).kills || 0;
const act = (st, a, t) => { st.attackerId = a.id; st.targetId = t.id; st.skillFlow = null; st.combatPhase = "player"; };
const plain = o => JSON.parse(JSON.stringify(o));

test("战-M1：电钻普攻打不到距离 1，不扣行动点、不记行动分；酸液炮模式反过来只打距离 1", () => {
  const f = field(["kolt"], [{ id: "thug_hammer", lv: 3, zone: 2 }]);
  const k = f.kit("kolt"), foe = f.foe();
  k.zone = 1; k.ap = 1; k.resources.bit = "drill";
  assert.deepEqual(plain(f.c.skillRangeFor(k, "kolt_aa")), { min: 0, max: 0 });
  const before = f.st.battleScore.total;
  act(f.st, k, foe);
  f.c.runSkill("kolt_aa");
  assert.equal(k.ap, 1, "行动点没扣");
  assert.equal(f.st.battleScore.total, before, "没记分");
  k.resources.bit = "acid";
  assert.deepEqual(plain(f.c.skillRangeFor(k, "kolt_aa")), { min: 1, max: 1 });
  foe.zone = 1;
  act(f.st, k, foe);
  f.c.runSkill("kolt_aa");
  assert.equal(k.ap, 1, "酸液炮打同区也不扣点");
});

test("战-M2：燃烧瓶挂的灼烧记所有者，灼烧烧死的敌人击杀算使用者", () => {
  const f = field(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const a = f.kit("kolt"), b = f.kit("helu"), foe = f.foe();
  a.zone = 1; b.zone = 1;
  foe._lastHitBy = b.id;
  f.c.bagAdd("fx_burn", 1); a.bonus = 1; f.st.combatPhase = "player";
  f.c.useItemOn(a, "fx_burn", null, 2);
  assert.ok(foe.statuses.burn, "挂上灼烧");
  assert.equal(f.c.statusOwnerId(foe, "burn"), a.id);
  foe.layers.forEach(l => { l.current = Math.min(l.current, 1); });
  f.st.actionAcc = null;
  f.c.turnEnd();
  f.c.sweepDeadEnemies();
  assert.equal(foe._xpGiven, true);
  assert.equal(kills(f.c, a), 1);
  assert.equal(kills(f.c, b), 0);
});

test("战-M3：冰锥弹的刺骨伤害打死敌人，击杀算使用者", () => {
  const f = field(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const a = f.kit("kolt"), b = f.kit("helu"), foe = f.foe();
  a.zone = 1; b.zone = 1;
  foe._lastHitBy = b.id;
  foe.layers.forEach(l => { l.current = 0; });
  foe.layers[0].current = 1;
  f.c.bagAdd("fx_sting", 1); a.bonus = 1; f.st.combatPhase = "player";
  f.c.useItemOn(a, "fx_sting", foe, null);
  f.c.sweepDeadEnemies();
  assert.equal(foe._xpGiven, true, "刺骨应当打死它");
  assert.equal(kills(f.c, a), 1);
  assert.equal(kills(f.c, b), 0);
  assert.equal(f.st._itemUserId == null, true, "用完清掉");
});

test("战-M4：训练场假人不带个体值，同等级各角色假人血量一样", () => {
  const hp = kit => {
    const { dummy } = D.setupField(kit, 10, 0);
    return dummy.layers.reduce((s, l) => s + l.max, 0);
  };
  const set = new Set(["ruby", "chuan", "nora", "kolt", "ras", "longge"].map(hp));
  assert.equal(set.size, 1, [...set].join(","));
});

test("战-M5：打训练假人、打已失衡的敌人不加击破分 / 击破数；正常击破照算", () => {
  const f = field(["kolt"], [{ id: "thug_knife", lv: 3, zone: 1 }]);
  const k = f.kit("kolt"), foe = f.foe();
  k.zone = 1; k.resources.bit = "drill"; k.ap = 9;
  const brk = () => [(f.c.battleStat(k) || {}).brk || 0, (f.st.battleScore.parts || {}).brk || 0];
  foe.trainingDummy = true;
  act(f.st, k, foe); f.c.runSkill("kolt_aa");
  assert.deepEqual(brk(), [0, 0], "假人");
  foe.trainingDummy = false; foe.def = 0; foe.stunned = true;
  act(f.st, k, foe); f.c.runSkill("kolt_aa");
  assert.deepEqual(brk(), [0, 0], "已失衡");
  foe.def = foe.defMax = 3; foe.stunned = false;
  act(f.st, k, foe); f.c.runSkill("kolt_aa");
  const [n, s] = brk();
  assert.ok(n > 0 && n <= 3 && s > 0, `正常击破 ${n}/${s}`);
});

test("战-L1：攻击友军 / 近战打飞行目标附赠不够，不扣行动点、不记行动分", () => {
  const f = field(["xia"], [{ id: "thug_knife", lv: 3, zone: 1 }]);
  const x = f.kit("xia"), foe = f.foe();
  x.zone = 1; x.ap = 2; x.bonus = 0;
  const before = f.st.battleScore.total;
  f.st.playerAllies = [f.c.factionOf(foe)];
  act(f.st, x, foe); f.c.runSkill("xia_aa");
  assert.equal(x.ap, 2, "友军：行动点没扣");
  assert.equal(f.st.battleScore.total, before);
  f.st.playerAllies = [];
  foe.flying = true;
  act(f.st, x, foe); f.c.runSkill("xia_aa");
  assert.equal(x.ap, 2, "飞行：行动点没扣");
  assert.equal(f.st.battleScore.total, before);
});

test("战-L2：评分的幕数记住见过的最高等级，高等级敌人被移出后分数线不变低", () => {
  const f = field(["kolt"], [{ id: "thug_knife", lv: 12, zone: 1 }, { id: "thug_knife", lv: 3, zone: 1 }]);
  f.st.scoreAct = 0;
  assert.equal(f.c.scoreAct(), 3);
  const hi = f.st.units.find(u => !u.isPlayer && u.level === 12);
  f.st.units.splice(f.st.units.indexOf(hi), 1);
  assert.equal(f.c.scoreAct(), 3);
});
