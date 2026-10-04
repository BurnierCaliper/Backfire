// 酸液炮蓄力的爆发时机、紧追的方向、动作内被打死的敌人留到动作结束（溢出与加分）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(party, foes) {
  const c = H.load();
  c.BattleSim.setup({ party, enemies: foes, seed: "TCO" });
  c.startCombat();
  return { c, st: c.S.state };
}

test("扭矩酸液炮蓄力：敌人回合开始时不爆发，下回合开始在场地效果之后爆发", () => {
  const { c, st } = field(["kolt"], [{ id: "thug_hammer", lv: 1, zone: 2 }]);
  const foe = st.units.find(u => !u.isPlayer);
  foe.zone = 2; foe.layers.forEach(l => { l.current = l.max = 500; });
  const kolt = c.findKit("kolt", st.units);
  kolt.zone = 1; kolt.resources.bit = "acid";
  const tq = c.spawnWeapon(kolt, "torque");
  tq.zone = 1; tq.ap = 2;
  c.setZoneField(2, "fire", { stacks: 1 });
  c.dispatch({ type: "skill", actor: tq.id, skill: "torque_boost", target: null, picks: { dest: 2 } });
  const order = [];
  const app = c.appendLog;
  c.appendLog = (x, k) => { String(x).split("\n").forEach(l => { if (/火场|酸液炮蓄力/.test(l)) order.push(l); }); return app(x, k); };
  c.endPlayerTurn();   // 进入敌人回合
  assert.equal(tq.resources.acidCharge, 2, "敌人回合开始时还没爆发");
  c.endEnemyTurn();    // 下回合开始
  assert.equal(tq.resources.acidCharge, null, "下回合开始爆发");
  const fireAt = order.findIndex(l => /火场/.test(l)), acidAt = order.findIndex(l => /酸液炮蓄力/.test(l));
  assert.ok(fireAt >= 0 && acidAt > fireAt, "在场地效果之后：" + order.join(" | "));
});

test("紧追：被紧追的单位移动后，施加者自动跟到它的区域（而不是反过来）", () => {
  const { c, st } = field(["kolt"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const kolt = c.findKit("kolt", st.units);
  const foe = st.units.find(u => !u.isPlayer);
  kolt.zone = 1; foe.zone = 1; kolt.bonus = 1;
  c.dispatch({ type: "skill", actor: kolt.id, skill: "kolt_chase", target: foe.id, picks: {} });
  assert.equal(foe.statuses.chase, true);
  assert.equal(foe.chasers.join(","), kolt.id);
  // 柯尔特自己移动：敌人不会跟过来
  c.doMove(kolt, 2, { free: true });
  assert.equal(foe.zone, 1);
  c.doMove(kolt, 1, { free: true });
  // 敌人移动：柯尔特跟上
  st.attackerId = foe.id;
  c.doMove(foe, 2, { free: true });
  assert.equal(kolt.zone, 2);
  // 被推走也算移动
  c.displaceTo(foe, 1, [], "被推开");
  assert.equal(kolt.zone, 1);
});

test("动作内被打死的敌人留到动作结束：后面的攻击全部算溢出并加分，击杀只算一次", () => {
  const { c, st } = field(["chuan"], [{ id: "thug_hammer", lv: 1, zone: 1 }]);
  const ch = c.findKit("chuan", st.units);
  ch.zone = 1; ch.resources.charge = 1; ch.ap = 2;
  const foe = st.units.find(u => !u.isPlayer);
  foe.layers.forEach(l => { l.current = 1; });
  c.dispatch({ type: "skill", actor: ch.id, skill: "chuan_aa", target: foe.id, picks: {} });
  assert.equal(foe.dead, true);
  // 三段 atk/2+1d4：第一段打死（1 点血），后两段全部是溢出
  const per = Math.floor(c.effectiveAtk(ch, st.units) / 2) + 1;
  assert.ok(foe.overkill >= (per - 1) + 2 * per, "溢出要算上后两段：" + foe.overkill);
  assert.equal(st.battleStats[ch.id].kills, 1);
  assert.equal(st.battleStats[ch.id].dmg, 1, "造成伤害只算实际扣掉的血");
  assert.ok(st.battleScore.parts.overkill >= Math.floor(foe.overkill * 1.5) - 1);
});

test("同一次多段攻击（hits）里被打死：后面的段数也算溢出", () => {
  const { c, st } = field(["ruby"], [{ id: "thug_hammer", lv: 1, zone: 2 }]);
  const ruby = c.findKit("ruby", st.units);
  ruby.zone = 1;
  const foe = st.units.find(u => !u.isPlayer);
  foe.zone = 2;
  foe.layers.forEach(l => { l.current = 1; });
  const r = c.dealTo(ruby, foe, { atk: 20, mult: 0.5, hits: 3, element: "physical", baseBreak: 0, flags: { action: true } });
  assert.equal(foe.dead, true);
  assert.ok(r.res.intended >= 30, "三段都算进本来的伤害：" + r.res.intended);
  assert.ok(foe.overkill >= 29);
});

test("动作之前就死了的敌人：不能再打出溢出", () => {
  const { c, st } = field(["ruby"], [{ id: "thug_hammer", lv: 1, zone: 1 }]);
  const ruby = c.findKit("ruby", st.units);
  const foe = st.units.find(u => !u.isPlayer);
  foe.layers.forEach(l => { l.current = 0; });
  foe.dead = true;
  st.actionKills = [];
  const r = c.dealTo(ruby, foe, { atk: 20, mult: 1, element: "physical", baseBreak: 0, flags: { action: true } });
  assert.equal(r.res.intended || 0, 0);
});
