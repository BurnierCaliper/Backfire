// 移动堡垒「焚烧」：每个被打的单位各掷一次 35% 灼烧 1（以前必定灼烧），伤害不变；用游戏装好的种子随机数，同种子结果一样
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

const noBlock = { pickBlocker: () => null, pickAssister: l => l[0].id };
/** 两个镇压队员坐进同区的堡垒，我方 kolt / helu 也在同区（只留一层超厚肉体，方便数伤害） */
function setup(seed) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "riot_baton", lv: 5, zone: 2 }, { id: "riot_rifle", lv: 5, zone: 2 }], seed: seed || "FB", zoneMode: 2 });
  c.startCombat();
  const S = c.S.state;
  const [a, b] = S.units.filter(u => !u.isPlayer && /^riot_/.test(u.kit));
  const p = c.vehicleSpawn("fortress", 2, 5, 2); c.vehicleBoard(a, p); c.vehicleBoard(b, p);
  const foes = S.units.filter(u => u.isPlayer);
  foes.forEach(u => { u.zone = 2; u.prideMaxHp = Infinity; u.layers = [{ type: "flesh", current: 9999, max: 9999, inner: true }]; });
  return { c, S, b, foes };
}
function burn(f) {
  const { c, S, b } = f;
  f.foes.forEach(u => { u.statuses.burn = 0; });
  S.combatPhase = "enemy"; b.ap = Math.max(b.ap || 0, 1); S.attackerId = b.id; S.targetId = null;
  const h0 = f.foes.map(u => c.totalHp(u));
  c.runSkill("veh_burn");
  c.BattleSim.resolveQueues(noBlock);
  return JSON.parse(JSON.stringify(f.foes.map((u, i) => ({ lost: h0[i] - c.totalHp(u), burn: Number(u.statuses.burn) || 0 }))));
}

test("概率：很多个种子下，每个被打的单位约 35% 灼烧", () => {
  let n = 0, hit = 0;
  for (let i = 0; i < 300; i++) { const r = burn(setup("FB-RATE-" + i)); r.forEach(x => { n++; if (x.burn > 0) hit++; }); }
  const rate = hit / n;
  assert.ok(rate > 0.29 && rate < 0.41, `灼烧率 ${rate}`);
});

test("伤害不变：掷中和没掷中都是 0.5×atk 火（≈8）", () => {
  const f1 = setup("FB-D"); f1.c.Math.random = () => 0.1;
  const f2 = setup("FB-D"); f2.c.Math.random = () => 0.9;
  const r1 = burn(f1), r2 = burn(f2);
  r1.forEach(x => { assert.equal(x.burn, 1); assert.ok(x.lost >= 7 && x.lost <= 9, String(x.lost)); });
  r2.forEach(x => assert.equal(x.burn, 0));
  assert.deepEqual(r1.map(x => x.lost), r2.map(x => x.lost), "伤害和灼烧无关");
});

test("每个单位各掷一次：一个中、一个不中", () => {
  // 只让第 k 次掷骰小于 35%：有的 k 只让第一个人中，有的 k 只让第二个人中 → 两人是各自掷的
  const seen = new Set();
  for (let k = 0; k < 12; k++) {
    const f = setup("FB-IND"); let n = 0;
    f.c.Math.random = () => (n++ === k ? 0.1 : 0.9);
    seen.add(burn(f).map(x => x.burn).join(","));
  }
  assert.ok(seen.has("1,0") && seen.has("0,1"), [...seen].join(" / "));
  // 很多种子里两人结果不总是相同
  let differ = 0;
  for (let i = 0; i < 100; i++) { const q = burn(setup("FB-IND-" + i)); if (q[0].burn !== q[1].burn) differ++; }
  assert.ok(differ > 20, `两人结果不同 ${differ} / 100`);
});

test("确定性：同一个种子重放结果完全一样", () => {
  for (let i = 0; i < 20; i++) {
    const a = burn(setup("FB-DET-" + i)), b = burn(setup("FB-DET-" + i));
    assert.deepEqual(a, b);
  }
});

test("README：规则改动记录里有这次改动（在整节里找，不要求是最上面一条），写了以前、现在", () => {
  const readme = require("fs").readFileSync(require("path").join(H.ROOT, "README.md"), "utf8");
  const start = readme.indexOf("## 规则改动记录");
  assert.ok(start >= 0);
  const next = readme.indexOf("\n## ", start + 1);
  const entry = readme.slice(start, next < 0 ? readme.length : next).split(/\n(?=- \*\*)/)
    .find((e) => /^- \*\*移动堡垒的「焚烧」/.test(e)) || "";
  assert.match(entry, /35%/); assert.match(entry, /以前/); assert.match(entry, /现在/);
});
