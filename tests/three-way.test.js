// 三方混战：互相敌对的两个敌人阵营 + 我方（enemies.js · hostileTo；run.js · THREE_WAY / rollThreeWay）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

test("敌对：盗匪和安保、警卫队互相敌对；盗匪和其他阵营照旧", () => {
  const c = H.load();
  const thug = { kit: "thug_knife" }, boss = { kit: "bandit_boss" }, sec = { kit: "guard_sword" }, wolf = { kit: "captain_wolf" }, sand = { kit: "sand_beast" }, ali = { kit: "meteor_spider" };
  assert.equal(c.hostileTo(thug, sec), true);
  assert.equal(c.hostileTo(wolf, boss), true);
  assert.equal(c.hostileTo(sec, wolf), false, "安保和警卫队照旧一伙");
  assert.equal(c.hostileTo(thug, boss), false);
  assert.equal(c.hostileTo(thug, sand), false, "盗匪和沙灵没有敌对");
  assert.equal(c.hostileTo(thug, ali), true, "异星生物和谁都敌对");
});

test("外城区的三方混战：玩家在 2 区，安保 / 警卫队一边、盗匪一边，各 3 枚代币", () => {
  const c = H.load();
  const side = k => ["安保", "警卫队"].includes(c.enemyInfo(k).faction) ? "官方" : c.enemyInfo(k).faction;
  for (let i = 0; i < 40; i++) {
    const spec = c.rollEncounter({ region: "外城区", threeWay: true, zoneMode: 3 });
    assert.equal(spec.layout, "threeway"); assert.equal(spec.playerZone, 2); assert.equal(spec.zoneMode, 3);
    const by = {};
    spec.enemies.forEach(e => {
      const s = side(e.preset);
      by[s] = by[s] || { zones: new Set(), tokens: 0 };
      by[s].zones.add(e.zone);
      const info = c.enemyInfo(e.preset);
      by[s].tokens += (info.tokens || 1) / (Number(info.group) || 1);   // 成组的（空投蜂群）整组记 1 枚
    });
    assert.deepEqual(Object.keys(by).sort(), ["官方", "盗匪"]);
    assert.notEqual([...by["官方"].zones][0], [...by["盗匪"].zones][0]);
    assert.equal(by["官方"].zones.size, 1); assert.equal(by["盗匪"].zones.size, 1);
    assert.equal(Math.round(by["官方"].tokens), 3); assert.equal(Math.round(by["盗匪"].tokens), 3);
  }
});

test("三方混战的概率：三区制时一半；两区制、指定阵营、混战都不会变", () => {
  const c = H.load();
  let n = 0;
  for (let i = 0; i < 400; i++) if (c.rollEncounter({ region: "外城区", zoneMode: 3 }).layout === "threeway") n++;
  assert.ok(n > 140 && n < 260, "约一半：" + n);
  for (let i = 0; i < 20; i++) {
    assert.notEqual(c.rollEncounter({ region: "外城区", zoneMode: 2 }).layout, "threeway");
    assert.notEqual(c.rollEncounter({ region: "外城区", zoneMode: 3, faction: "盗匪" }).layout, "threeway");
    assert.notEqual(c.rollEncounter({ region: "外城区", zoneMode: 3, mixed: true }).layout, "threeway");
    assert.notEqual(c.rollEncounter({ region: "沙漠", zoneMode: 3 }).layout, "threeway", "其他区域没有");
  }
});

test("外城区三方混战整场自动对打：狂徒会去打安保 / 警卫队，能打完、没有报错", () => {
  let fights = 0;
  for (let i = 0; i < 6; i++) {
    const c = H.load();
    const spec = c.rollEncounter({ region: "外城区", threeWay: true, zoneMode: 3, level: 4 });
    c.BattleSim.setup({ party: ["kolt", "helu", "tou"], encounter: spec, level: 4, seed: "OC" + i });
    // 数一数敌人打敌人的次数：把全局的 dealTo 包一层
    const orig = c.dealTo;
    c.dealTo = function (a, t, opt) { if (a && t && !a.isPlayer && !t.isPlayer && c.hostileTo(a, t)) fights++; return orig.apply(this, arguments); };
    const r = c.BattleSim.run({ maxRounds: 25 });
    assert.ok(r.winner && r.actions > 0);
  }
  assert.ok(fights > 0, "敌人之间打起来了");
});
