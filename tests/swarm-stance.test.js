// 空投蜂群 / 下水道清扫机的架势：1–10 级 1、11–20 级 2、21 级起 3（不随人数加）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("vm");
const H = require("./headless");

const EXPECT = { 1: 1, 10: 1, 11: 2, 20: 2, 21: 3 };

for (const id of ["swarm", "sewer_sweeper"]) {
  test(`${id}：架势 1–10 级 1、11–20 级 2、21 级起 3，2 / 3 / 4 人队一样，图鉴一样`, () => {
    const c = H.load();
    vm.runInContext("ENEMY_IV.off++", c);   // 个体值不波动
    const preset = c.enemyPresets().find(x => x.id === id);
    for (const [lvs, def] of Object.entries(EXPECT)) {
      const lv = Number(lvs);
      for (const p of [2, 3, 4]) {
        const u = preset.build(lv, p);
        assert.deepEqual([u.def, u.defMax], [def, def], `${id} ${lv} 级 ${p} 人队`);
        assert.equal(c.spawnEnemyGroup(id, lv, p, p)[0].defMax, def, `${id} ${lv} 级 ${p} 人队（生成）`);
        assert.equal(c.bestiaryStats(id, lv, p).def, def, `${id} ${lv} 级 ${p} 人队（图鉴）`);
      }
    }
  });
}
