// 敌人图鉴（bestiary.js）：打完一场就记下遭遇过的敌人；没遭遇过的看不到能力；数值和战斗里一样现算
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");

test("每种敌人都有图鉴说明（以后加新敌人忘了写会在这里报出来）", () => {
  const c = H.load();
  const kits = vm.runInContext("enemyPresets().map(p => p.id).filter(k => !BESTIARY_SKIP.includes(k))", c);
  kits.forEach(k => {
    const t = c.S.BESTIARY_TEXT[k];
    assert.ok(t && t.move && t.abilities.length, "缺图鉴说明：" + k);
  });
});

test("新档：全部没遭遇过；打完一场（不管输赢），场上的敌人记为遭遇过", () => {
  const c = H.load();
  c.bestiaryReset();
  assert.equal(c.bestiaryProgress().seen, 0);
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 1 }, { id: "thug_knife", lv: 4, zone: 1 }, { id: "guard_gun", lv: 2, zone: 2 }], seed: "BX-1" });
  c.startCombat();
  const foes = c.S.state.units.filter(u => !u.isPlayer);
  foes.find(u => u.kit === "thug_knife").dead = true;   // 打倒一只匕首狂徒
  c.settleBattleRewards("retreat");
  const e = c.bestiaryEntries();
  const knife = e.find(x => x.kit === "thug_knife"), gun = e.find(x => x.kit === "guard_gun"), boss = e.find(x => x.kit === "outlaw_king");
  assert.equal(knife.seen, true);
  assert.equal(knife.rec.met, 1, "同一场里两只只算一次遭遇");
  assert.equal(knife.rec.kills, 1);
  assert.equal(knife.rec.minLv, 3);
  assert.equal(knife.rec.maxLv, 4);
  assert.equal(gun.seen, true);
  assert.equal(boss.seen, false, "没遇到的还是 ？？？");
  assert.equal(c.bestiaryProgress().seen, 2);
  assert.match(c.S.state.logPages.flatMap(p => p.lines).map(l => l.text).join("\n"), /敌人图鉴：新收录/);
  // 再打一场：次数累加，不重复提示「新收录」
  c.BattleSim.setup({ party: ["kolt"], enemies: [{ id: "thug_knife", lv: 6, zone: 1 }], seed: "BX-2" });
  c.startCombat();
  assert.deepEqual([...c.bestiaryRecordBattle("win")], []);
  const k2 = c.bestiaryEntries().find(x => x.kit === "thug_knife");
  assert.equal(k2.rec.met, 2);
  assert.equal(k2.rec.maxLv, 6);
});

test("飞碟触灵的机械足记在飞碟触灵名下；排序是 杂兵 → 精英 → 首领", () => {
  const c = H.load();
  c.bestiaryReset();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "ufo_boss", lv: 3, zone: 1 }], seed: "BX-UFO" });
  c.startCombat();
  c.settleBattleRewards("lose");
  const e = c.bestiaryEntries();
  assert.equal(e.find(x => x.kit === "ufo_boss").seen, true);
  assert.equal(e.some(x => x.kit === "ufo_leg"), false);
  const ranks = e.map(x => x.rank);
  assert.ok(ranks.indexOf("elite") > ranks.lastIndexOf("minion") && ranks.indexOf("boss") > ranks.lastIndexOf("elite"));
  assert.equal(e.find(x => x.kit === "ufo_boss").rank, "boss");
});

test("图鉴数值和战斗里一样（按等级、人数用同一个 build 算）", () => {
  const c = H.load();
  const st = c.bestiaryStats("thug_knife", 5, 4);
  const u = vm.runInContext("enemyPresets().find(p => p.id === 'thug_knife').build(5, 4)", c);
  assert.equal(st.atk, u.atk);
  assert.equal(st.def, u.defMax);
  assert.equal(st.layers[0].hp, u.layers[0].max);
  assert.equal(st.layers[0].name, "肉体");
  assert.equal(st.range, "melee");
  assert.ok(c.bestiaryStats("thug_knife", 10, 4).layers[0].hp > st.layers[0].hp, "等级越高血越多");
});
