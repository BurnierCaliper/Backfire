// 配置物与危墙：能被技能选中，打一下照常消耗行动点，按技能的元素和倍率算
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(zoneMode) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "ruby"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  c.startCombat();
  const st = c.S.state;
  if (zoneMode) st.zoneMode = zoneMode;
  const kolt = c.findKit("kolt", st.units);
  kolt.zone = 1;
  return { c, st, kolt, aa: c.skillList(kolt).find(s => s.name === "普通攻击").id };
}

test("危墙可以被普通攻击打；打一下消耗行动点，打塌后变成畅通", () => {
  const { c, st, kolt, aa } = field();
  st.gaps["1-2"] = { type: "wall", hp: 8, maxHp: 8, open: false };
  kolt.ap = 1;
  st.attackerId = kolt.id; st.targetId = "gap:1-2";
  c.runSkill(aa);
  assert.equal(kolt.ap, 0);
  assert.ok(st.gaps["1-2"].hp < 8);
  // 行动点用完就不能再白打
  const hp = st.gaps["1-2"].hp;
  c.runSkill(aa);
  assert.equal(st.gaps["1-2"].hp, hp);
  st.gaps["1-2"].hp = 1; kolt.ap = 1;
  c.runSkill(aa);
  assert.equal(st.gaps["1-2"].type, "open");
});

test("配置物（炮台、爆炸桶）被打也消耗行动点", () => {
  const { c, st, kolt, aa } = field();
  const tur = c.makeProp("turret", 1, 1); tur.faction = "enemy";
  st.props = [tur];
  kolt.ap = 1;
  st.attackerId = kolt.id; st.targetId = "prop:" + tur.id;
  c.runSkill(aa);
  assert.equal(kolt.ap, 0);
  assert.ok(tur.hp < tur.maxHp);
});

test("近战够不到隔一个区的危墙", () => {
  const { c, st, kolt, aa } = field(3);
  st.gaps["2-3"] = { type: "wall", hp: 8, maxHp: 8, open: false };
  kolt.ap = 1;
  st.attackerId = kolt.id; st.targetId = "gap:2-3";
  const ov = c.skillRangeFor(kolt, aa);
  c.runSkill(aa);
  if (!ov || ov.max < 1) {
    assert.equal(st.gaps["2-3"].hp, 8);
    assert.equal(kolt.ap, 1);
  }
});

test("打配置物按技能写的元素：电流激荡是电，普通攻击没写就是物理", () => {
  const { c, st } = field();
  const ruby = c.findKit("ruby", st.units);
  ruby.level = 2;
  assert.equal(c.structureHitOpt(ruby, "ruby_surge").element, "electric");
  const kolt = c.findKit("kolt", st.units);
  const o = c.structureHitOpt(kolt, "__none__");
  assert.equal(o.element, "physical");
  assert.ok(o.dmg >= 1);
});

/* ---------- 按钮 / 拉杆 ---------- */
function deviceField() {
  const f = field();
  const { c, st } = f;
  st.gaps["1-2"] = { type: "door", hp: 0, maxHp: 0, open: false };
  const btn = c.makeProp("button", 1, 1); btn.link = "1-2";
  st.props = [btn];
  return Object.assign(f, { btn, door: () => st.gaps["1-2"].open });
}

test("按钮可以直接打：触发一次（门打开），也消耗行动点", () => {
  const { c, st, kolt, aa, btn, door } = deviceField();
  kolt.ap = 1;
  st.attackerId = kolt.id; st.targetId = "prop:" + btn.id;
  c.runSkill(aa);
  assert.equal(door(), true);
  assert.equal(kolt.ap, 0);
});

test("范围攻击波及按钮所在区：触发一次（多个目标也只触发一次）", () => {
  const { c, st, btn, door } = deviceField();
  const ruby = c.findKit("ruby", st.units);
  ruby.zone = 1;
  // 同区放两个敌人，用范围手榴弹炸 1 区
  st.units.filter(u => !u.isPlayer).forEach(u => { u.zone = 1; });
  c.bagAdd("bomb_e", 2);
  c.useItemOn(ruby, "bomb_e", null, 1);
  assert.equal(door(), true);
  // 没人的区也会炸到按钮
  st.units.filter(u => !u.isPlayer).forEach(u => { u.zone = 2; });
  c.useItemOn(ruby, "bomb_e", null, 1);
  assert.equal(door(), false);
});

test("场地效果、状态伤害不会触发按钮", () => {
  const { c, st, door } = deviceField();
  const foe = st.units.find(u => !u.isPlayer);
  foe.zone = 1;
  c.dealTo(foe, c.findKit("ruby", st.units), { atk: 0, mult: 0, flat: 3, element: "fire", baseBreak: 0,
    flags: { action: false, environment: true, aoe: true, blockResolved: true } });
  // 下一次普通的单体行动结算时也不能把它带出来
  const kolt = c.findKit("kolt", st.units);
  kolt.ap = 1; st.attackerId = kolt.id; st.targetId = foe.id;
  c.runSkill(c.skillList(kolt).find(s => s.name === "普通攻击").id);
  assert.equal(door(), false);
});
