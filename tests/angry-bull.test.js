// 易怒蛮牛（兽人·牛）修正：每回合最多一次、晕眩 / 失衡不冲撞、一次发作不会来回冲（高压场地连带伤害曾二次触发）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function setup(opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "captain_ox", lv: opt.lv || 10, zone: 1, race: "兽人·牛" }], seed: opt.seed || "BULL" });
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

test("失衡（架势 0）时不冲撞（只测 def <= 0 这条分支：游戏里除了千钧，失衡一般同时是晕眩）", () => {
  const { c, foe, kolt } = setup();
  foe.def = 0;
  const r = hit(c, kolt, foe);
  assert.equal(rages(r), 0);
  assert.equal(charges(r), 0);
  assert.ok(!foe.raceRageUsed);
});

test("这一击本身把普通规则的牛（lv 5）打进晕眩：结算后晕眩，不冲撞、不占次数", () => {
  const { c, foe, kolt } = setup({ lv: 5 });
  const z = foe.zone;
  const r = hit(c, kolt, foe, { baseBreak: 99 });
  assert.equal(foe.stunned, true, "这一击后晕眩");
  assert.equal(rages(r), 0);
  assert.equal(foe.zone, z);
  assert.ok(!foe.raceRageUsed);
});

test("这一击把首领规则的精英牛（lv 10）打进失衡、立刻恢复架势：靠 result.broke 判，不冲撞、不占次数", () => {
  const { c, foe, kolt } = setup({ lv: 10 });
  const z = foe.zone;
  const r = hit(c, kolt, foe, { baseBreak: 99 });
  assert.equal(r.res.broke, true);
  assert.equal(foe.stunned, false, "首领规则：失衡立刻结束");
  assert.equal(foe.def, foe.defMax, "架势回满");
  assert.equal(rages(r), 0);
  assert.equal(foe.zone, z);
  assert.ok(!foe.raceRageUsed);
});

for (const lv of [10, 5]) {
  test(`高压场地 + 本击打出失衡（lv ${lv}）：同一击的场地连带伤害也不触发，整击不发作、不占次数`, () => {
    const { c, S, foe, kolt } = setup({ lv });
    S.fields[1] = Object.assign(S.fields[1] || {}, { electric: true });
    S.fields[2] = Object.assign(S.fields[2] || {}, { electric: true });
    const z = foe.zone;
    const r = hit(c, kolt, foe, { baseBreak: 99 });
    assert.equal(r.res.broke, true);
    assert.match(r.extra.join("\n"), /高压场地/, "场地连带伤害确实结算了");
    assert.equal(rages(r), 0);
    assert.equal(foe.zone, z);
    assert.ok(!foe.raceRageUsed);
    assert.ok(!foe.raceNoBonus);
  });
}

test("一击结算完才冲：只有原区是高压场地时，连带伤害按原区照吃，之后再冲走", () => {
  const { c, S, foe, kolt } = setup();
  S.fields[1] = Object.assign(S.fields[1] || {}, { electric: true });
  S.fields[2] = Object.assign(S.fields[2] || {}, { electric: false });
  const r = hit(c, kolt, foe);
  const txt = r.extra.join("\n");
  assert.match(txt, /高压场地/, "原区的场地伤害吃到了");
  assert.equal(rages(r), 1);
  assert.ok(txt.indexOf("高压场地") < txt.indexOf("受伤后失控"), "日志里先写触发的伤害，再写发作");
  assert.equal(foe.zone, 2);
});

test("dealTo 外的伤害（状态 / 场地单独结算）照旧立刻判", () => {
  const { c, foe } = setup();
  const notes = [];
  c.applyTypedDot(foe, 3, "fire", notes, "测试灼烧");
  assert.match(notes.join("\n"), /受伤后失控/);
  assert.equal(foe.raceRageUsed, true);
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

test("技能打危墙：倒塌砸到牛引起的发作照样写进这一击的日志（替身 out.lines）", () => {
  const { c, S, foe, kolt, helu } = setup({ lv: 5 });
  foe.zone = 2; kolt.zone = 1; helu.zone = 1;
  S.gaps["1-2"] = Object.assign(c.emptyGap(), { type: "wall", hp: 1, maxHp: 1, level: 1 });
  const proxy = c.makeStructProxy("gap:1-2", [1, 2], kolt);
  const out = c.dealTo(kolt, proxy, { mult: 0, flat: 0, atk: 0, baseBreak: 5, flags: { action: true, blockResolved: true } });
  assert.equal(out.structure, true);
  const txt = c.formatHitLines(kolt, proxy, out).join("\n");
  assert.equal(foe.raceRageUsed, true, "牛确实发作了");
  assert.match(txt, /受伤后失控/);
  assert.match(txt, /不受控地冲撞/);
});

for (const lv of [10, 5]) {
  test(`同一击里只有击破的一段（惯性 + 震荡）打进失衡（lv ${lv}）：整击不发作、不占次数`, () => {
    const { c, foe, kolt } = setup({ lv });
    foe.def = 2; foe.statuses.shockwave = 1;
    const r = c.dealTo(kolt, foe, { mult: 0, flat: 5, atk: 0, baseBreak: 0, flags: { action: true, blockResolved: true, atkFx: ["inertia"] } });
    const txt = r.extra.join("\n");
    assert.match(txt, /惯性 \+ 震荡/, "纯击破那一段确实结算了");
    assert.doesNotMatch(txt, /受伤后失控/);
    assert.ok(!foe.raceRageUsed);
  });
}

test("dealTo 中途出错：暂存清掉，不会挂到下一次不相干的攻击上发作", () => {
  const { c, S, foe, kolt, helu } = setup();
  const orig = c.noteActionHit;
  let once = true;
  c.noteActionHit = function () { if (once) { once = false; throw new Error("测试：中途出错"); } return orig.apply(this, arguments); };
  assert.throws(() => hit(c, kolt, foe), /中途出错/);
  c.noteActionHit = orig;
  assert.ok(!foe.raceRageUsed, "出错的那一击没发作");
  // 下一次打别人（打自己人当靶子，只要是一次完整的 dealTo）
  hit(c, kolt, helu);
  assert.ok(!foe.raceRageUsed, "不相干的攻击不会让牛发作");
  void S;
});

for (const lv of [10, 5]) {
  test(`打进失衡后接着来的协助攻击（lv ${lv}）：算这次失衡的一部分，不发作、不占次数`, () => {
    const { c, S, foe, kolt, helu } = setup({ lv });
    helu.zone = 1;
    const r = hit(c, kolt, foe, { baseBreak: 99 });
    assert.equal(rages(r), 0);
    const before = S.logPages.flatMap(p => p.lines).length;
    c.finishAssist(helu.id);
    const txt = S.logPages.flatMap(p => p.lines).slice(before).map(l => l.text).join("\n");
    assert.match(txt, /协助攻击/, "协助攻击确实打了");
    assert.doesNotMatch(txt, /受伤后失控/);
    assert.ok(!foe.raceRageUsed);
  });
}
