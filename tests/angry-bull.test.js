// 易怒蛮牛（兽人·牛）修正：每回合最多一次、晕眩 / 失衡不冲撞、一次发作不会来回冲（高压场地连带伤害曾二次触发）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function setup(opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "captain_ox", lv: 10, zone: 1, race: "兽人·牛" }], seed: opt.seed || "BULL" });
  c.startCombat();
  const S = c.S.state;
  S.zoneMode = 2;
  const foe = S.units.find(u => !u.isPlayer);
  foe.layers.forEach(l => { l.max = 100; l.current = 40; });   // 已经低于 50%
  foe.def = foe.defMax = 9; foe.stunned = false;
  const [kolt, helu] = S.units.filter(u => u.isPlayer);
  kolt.zone = 1; helu.zone = 2;
  [kolt, helu].forEach(u => { u.layers.forEach(l => { l.current = l.max = 500; }); u.def = u.defMax = 9; });
  return { c, S, foe, kolt, helu };
}
const hit = (c, a, t, o) => c.dealTo(a, t, Object.assign({ mult: 0, flat: 5, atk: 0, baseBreak: 0, flags: { action: true, blockResolved: true } }, o || {}));
const rages = (r) => (r.extra.join("\n").match(/受伤后失控/g) || []).length;
const charges = (r) => (r.extra.join("\n").match(/不受控地冲撞/g) || []).length;
const moveLines = (S) => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n").match(/\d+ 区 → \d+ 区（技能内移动/g) || [];

test("每回合最多一次：同一回合连挨两下只发作一次，新回合（beginRound）重新可以发作", () => {
  const { c, S, foe, kolt, helu } = setup();
  const r1 = hit(c, kolt, foe);
  assert.equal(rages(r1), 1);
  const z = foe.zone;
  foe.bonus = 1;
  const r2 = hit(c, helu, foe);
  assert.equal(rages(r2), 0, "同一回合第二次受伤不再发作");
  assert.equal(foe.zone, z, "没有再移动");
  assert.equal(foe.bonus, 1, "附赠没再被清");
  c.beginRound([]);
  assert.ok(!foe.raceRageUsed, "回合开始重置");
  foe.stunned = false; foe.def = foe.defMax;
  const r3 = hit(c, kolt, foe);
  assert.equal(rages(r3), 1, "新回合可以再发作");
  void S;
});

test("晕眩时不冲撞；不占用这回合的次数", () => {
  const { c, foe, kolt } = setup();
  foe.stunned = true;
  const z = foe.zone;
  const r = hit(c, kolt, foe);
  assert.equal(rages(r), 0);
  assert.equal(foe.zone, z);
  assert.ok(!foe.raceRageUsed);
  assert.ok(!foe.raceNoBonus);
});

test("失衡（架势 0）时不冲撞", () => {
  const { c, foe, kolt } = setup();
  foe.def = 0;
  const r = hit(c, kolt, foe);
  assert.equal(rages(r), 0);
  assert.equal(charges(r), 0);
});

test("这一击本身把它打进失衡 / 晕眩：按结算后的状态判，不冲撞", () => {
  const { c, foe, kolt } = setup();
  const z = foe.zone;
  const r = hit(c, kolt, foe, { flat: 5, baseBreak: 99 });
  assert.ok(r.res.broke || foe.stunned || foe.def <= 0, "这一击打出了失衡");
  assert.equal(rages(r), 0);
  assert.equal(foe.zone, z);
});

test("高压场地：主伤害 + 场地连带伤害只发作一次，只移动一次、只撞一个人（以前 1 区 → 2 区 → 1 区来回冲）", () => {
  const { c, S, foe, kolt } = setup();
  S.fields[1] = Object.assign(S.fields[1] || {}, { electric: true });
  S.fields[2] = Object.assign(S.fields[2] || {}, { electric: true });
  const r = hit(c, kolt, foe, { flat: 5 });
  assert.match(r.extra.join("\n"), /高压场地/, "场地连带伤害确实结算了");
  assert.equal(rages(r), 1);
  assert.equal(charges(r), 1);
  assert.equal(moveLines(S).length, 1, "只移动一次");
  assert.equal(foe.zone, 2);
});
