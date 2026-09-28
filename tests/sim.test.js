// 整场战斗测试：各种队伍 × 各种遭遇都要能打完、不报错，而且同一个种子结果完全一致。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
// 规则环境里造出来的数组/对象属于另一个 realm，比较前先转成普通值
const plain = (x) => JSON.parse(JSON.stringify(x));

const PARTIES = [
  ["ruby", "yuito", "hiaki", "tou"],
  ["kolt", "helu"],
  ["ras", "nora", "xia"],
  ["chuan", "kolt", "helu", "ras"]
];
const ENCOUNTERS = {
  "盗匪": ["thug_knife", "thug_hammer", "bandit_boss"],
  "安保": ["guard_sword", "guard_gun", "patrol_car"],
  "沙灵": ["sand_beast", "sand_human", "bigsand"],
  "亡命之王": ["outlaw_king"],
  "飞碟触灵": ["ufo_boss"],
  "沙灵聚合体": ["sand_aggregate"]
};

function fight(party, ids, seed, zoneMode) {
  const c = H.load();
  c.BattleSim.setup({ party, enemies: ids.map(id => ({ id, lv: 1, zone: 2 })), seed, zoneMode });
  const r = c.BattleSim.run({ maxRounds: 40 });
  return { r, errors: c.__errors };
}

for (const party of PARTIES) {
  for (const [name, ids] of Object.entries(ENCOUNTERS)) {
    test(`${party.join("+")} 对 ${name}：打得完`, () => {
      const { r, errors } = fight(party, ids, "SIM-" + name);
      assert.deepEqual(plain(errors), []);
      assert.ok(["player", "enemy"].includes(r.winner), `结果是 ${r.winner}`);
      assert.ok(r.actions > 0);
    });
  }
}

test("三区制也能打完", () => {
  const { r, errors } = fight(["kolt", "helu", "ras"], ["guard_gun", "sand_human", "thug_knife"], "ZONE3", 3);
  assert.deepEqual(plain(errors), []);
  assert.ok(["player", "enemy"].includes(r.winner));
});

test("同一个种子，整场结果完全一致", () => {
  const a = fight(["chuan", "kolt", "helu", "ras"], ENCOUNTERS["盗匪"], "SAME").r;
  const b = fight(["chuan", "kolt", "helu", "ras"], ENCOUNTERS["盗匪"], "SAME").r;
  assert.deepEqual(plain(a), plain(b));
});

test("不同种子会打出不同的过程", () => {
  const seen = new Set();
  for (let i = 0; i < 6; i++) seen.add(JSON.stringify(fight(["kolt", "helu"], ENCOUNTERS["盗匪"], "S" + i).r));
  assert.ok(seen.size > 1);
});
