// 巨刃划空（#44，夕夏定）：瞄准躲在敌方屏障后的敌人改砍屏障；危墙 / 不稳桥梁固定 −10 耐久
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function setup() {
  const c = H.load();
  c.BattleSim.setup({ party: ["chuan", "nora"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "BLADE" });
  c.startCombat();
  const S = c.S.state;
  const ch = S.units.find(u => u.kit === "chuan" && !u.hidden), foe = S.units.find(u => !u.isPlayer);
  ch.level = 11; ch.zone = 1; ch.ap = 5; ch.bonus = 5; ch.resources.charge = 3;
  foe.layers = [{ type: "flesh", current: 300, max: 300, inner: true }];
  return { c, S, ch, foe };
}
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));

test("瞄准躲在废铁墙后面的敌人：改砍废铁墙，伤害翻倍（4×atk），敌人不掉血；砍塌返还 1 电能", () => {
  const { c, S, ch, foe } = setup();
  const wall = c.makeProp("scrapwall", 2, 1); wall.hp = wall.maxHp = 999; S.props.push(wall);
  const hp = c.totalHp(foe), atk = c.effectiveAtk(ch, S.units);
  cmd(c, { actor: ch.id, skill: "chuan_blade", target: foe.id, picks: { target: foe.id } });
  assert.equal(c.totalHp(foe), hp, "敌人没挨这一刀");
  assert.ok(999 - wall.hp >= Math.floor(atk * 4 * 0.5), "屏障吃到翻倍的伤害：" + (999 - wall.hp));
  assert.equal(ch.resources.charge, 0);
  // 薄的废铁墙：一刀砍塌，返还 1 电能
  const thin = c.makeProp("scrapwall", 2, 1); thin.hp = thin.maxHp = 1;
  S.props = S.props.filter(p => p.kind !== "scrapwall").concat([thin]);
  ch.ap = 5; ch.resources.charge = 3;
  cmd(c, { actor: ch.id, skill: "chuan_blade", target: foe.id, picks: { target: foe.id } });
  assert.ok(!S.props.includes(thin), "砍塌了");
  assert.equal(ch.resources.charge, 1, "摧毁配置物返还 1 电能");
  assert.equal(c.totalHp(foe), hp);
});

test("没有屏障时照常砍敌人", () => {
  const { c, ch, foe } = setup();
  const hp = c.totalHp(foe);
  cmd(c, { actor: ch.id, skill: "chuan_blade", target: foe.id, picks: { target: foe.id } });
  assert.ok(c.totalHp(foe) < hp);
});

test("危墙 / 不稳桥梁：固定扣 10 耐久（取代 2 击破）", () => {
  for (const type of ["wall", "bridge"]) {
    const { c, S, ch } = setup();
    S.gaps["1-2"] = Object.assign(c.emptyGap(), { type, hp: 25, maxHp: 25, level: 1 });
    cmd(c, { actor: ch.id, skill: "chuan_blade", target: "gap:1-2", picks: { target: "gap:1-2" } });
    assert.equal(S.gaps["1-2"].hp, 15, type);
    assert.equal(vm.runInContext("CHUAN_BLADE_GAP_DUR", c), 10);
  }
});
