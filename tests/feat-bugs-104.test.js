// #104：专长（一）——荒原行者击落、联机移动校验认荒原行者、以身作盾失衡中不能宣布且击破由宣布者承担、兼修·鼓劲选全部友方扣行动点
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const H = require("./headless");
const { Hotseat } = require("../hotseat");
const plain = (x) => JSON.parse(JSON.stringify(x));

function battle(party, enemies, setupFn, seed) {
  const c = H.load();
  vm.runInContext("Math", c).random = () => 0.5;
  c.BattleSim.setup({ party, enemies: enemies || [{ id: "thug_knife", lv: 3, zone: 1 }], seed: seed || "F104" });
  const S = c.S.state;
  const units = party.map(k => c.findKit(k, S.units));
  if (setupFn) setupFn(c, S, ...units);
  c.startCombat();
  return { c, S, units, foes: S.units.filter(u => !u.isPlayer && !u.dead) };
}
const hit = (c, a, t, opt) => c.dealTo(a, t, Object.assign({ atk: 20, mult: 1, element: "physical", baseBreak: 0, atkRange: "any" }, opt || {},
  { flags: Object.assign({ action: true, blockResolved: true, block: "none" }, (opt && opt.flags) || {}) }));

/* ---------- 1 荒原行者：击落到你所在区域 ---------- */
test("荒原行者：把飞行单位打进失衡，把它击落到攻击者所在区域（没有这项专长只是击落、不挪区）", () => {
  const run = (feat) => {
    const { c, S, units: [kolt], foes } = battle(["kolt", "helu"], [{ id: "thug_knife", lv: 3, zone: 2 }], (c, S, k) => { if (feat) k.feats = ["wanderer"]; });
    const foe = foes[0];
    kolt.zone = 1; foe.zone = 2; foe.flying = true; foe.def = 1;
    const out = hit(c, kolt, foe, { baseBreak: 3 });
    assert.equal(foe.stunned, true, "打进了失衡");
    assert.equal(foe.flying, false, "被击落");
    return { zone: foe.zone, extra: plain(out.extra || []) };
  };
  const w = run(true), n = run(false);
  assert.equal(w.zone, 1, "荒原行者：被击落到攻击者所在的 1 区");
  assert.ok(w.extra.some(s => /荒原行者/.test(s)), "日志里写了荒原行者击落");
  assert.equal(n.zone, 2, "没有专长：留在原区");
});

/* ---------- 2 热座 / 联机移动校验认荒原行者 ---------- */
function moveFixture(feat) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], zoneMode: 3, seed: "F104-MOVE" });
  c.startCombat();
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  for (const file of ["game.js", "hotseat-validation.js", "online-view.js", "online-actions.js"]) vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file });
  const state = c.S.state, actor = state.units.find(u => u.kit === "kolt"), ally = state.units.find(u => u.kit === "helu");
  if (feat) actor.feats = ["wanderer"];
  actor.zone = 1; actor.ap = 0; actor.bonus = 2;
  const session = Hotseat.create({ operators: ["p1", "p2"], gmId: "p1", assignments: { [actor.id]: "p1", [ally.id]: "p2" }, getUnits: () => state.units, canStand: u => !c.standUpBlocked(u) });
  session.beginRound(1); session.pick("p1", actor.id, 0); session.pick("p2", ally.id, 1); session.forceStart("p1");
  const service = c.OnlineActions.create({ game: c.GAME, validation: c.HotseatValidation, inspect: c.HotseatValidation.inspect,
    assertAction: (sender, id) => session.assertAction(sender, id), getState: () => state });
  const zones = () => plain(service.menu({ requestId: 1, actor: actor.id, skill: "__move" }, "p1")).choices.options.map(o => o.value);
  return { c, state, actor, zones };
}
test("联机移动校验：荒原行者没有行动点也能离开酸液地面（只要附赠动作）", () => {
  for (const [feat, want] of [[false, []], [true, [2]]]) {
    const f = moveFixture(feat);
    f.state.fields[1].acid = true;
    assert.deepEqual(f.zones(), want, feat ? "荒原行者可以走" : "没有专长：缺行动点走不了");
  }
});
test("联机移动校验：荒原行者没有行动点也能越过空隙（不用检定）", () => {
  for (const [feat, want] of [[false, []], [true, [2]]]) {
    const f = moveFixture(feat);
    f.state.gaps = f.state.gaps || {};
    f.state.gaps[f.c.gapKey(1, 2)] = { type: "void" };
    assert.deepEqual(f.zones(), want, feat ? "荒原行者可以走" : "没有专长：缺行动点走不了");
  }
});

/* ---------- 3 以身作盾 ---------- */
test("以身作盾：自己在失衡中不能宣布", () => {
  const { c, units: [kolt, helu] } = battle(["kolt", "helu"], null, (c, S, k, h) => { h.feats = ["ironwall"]; });
  kolt.zone = 1; helu.zone = 1;
  assert.deepEqual(plain(c.featIronwallDeclarers(kolt).map(u => u.id)), [helu.id]);
  helu.stunned = true;
  assert.deepEqual(plain(c.featIronwallDeclarers(kolt)), [], "失衡中的人不在可宣布名单里");
});
test("以身作盾：这一击的击破由宣布者承担（架势至少留 1），被保护的人不掉架势", () => {
  const { c, S, units: [kolt, helu], foes } = battle(["kolt", "helu"], null, (c, S, k, h) => { h.feats = ["ironwall"]; });
  const foe = foes[0];
  kolt.zone = foe.zone; helu.zone = foe.zone; kolt.bonus = 0; helu.bonus = 0;
  kolt.def = 4; helu.def = 4;
  S.blockQueue = [];
  const out = c.dealTo(foe, kolt, { atk: 30, mult: 1, element: "physical", baseBreak: 2, flags: { action: true } });
  assert.equal(out.pending, true);
  c.finishBlock("ironwall:" + helu.id);
  assert.equal(kolt.def, 4, "被保护的人不掉架势");
  assert.ok(helu.def < 4, `宣布者承担击破：${helu.def} < 4`);
  assert.ok(helu.def >= 1 && !helu.stunned, "至少留 1、不会失衡");
});

/* ---------- 4 兼修·鼓劲 ---------- */
test("兼修·鼓劲：选全部友方改花行动点，选一名友方照旧花附赠", () => {
  const { c, S, units: [kolt, helu] } = battle(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 2 }], (c, S, k) => { k.feats = ["rouse"]; k.featFull = ["rouse"]; k.level = 15; });
  const cmd = (o) => c.Commands.dispatch(plain(Object.assign({ type: "skill", actor: kolt.id }, o)));
  kolt.zone = 1; helu.zone = 1; kolt.ap = 3; kolt.bonus = 3;
  assert.deepEqual(plain(c.skillCost("feat_rouse") || {}), { bonus: 1 }, "没选分步时附赠");
  cmd({ skill: "feat_rouse", picks: { mode: "all" } });
  assert.equal(kolt.ap, 2, "全部友方：花 1 行动点");
  assert.equal(kolt.bonus, 3, "不再扣附赠");
  assert.equal(helu.statuses.sturdy, true);
  kolt.ap = 3; kolt.bonus = 3; helu.statuses.sturdy = false;
  S.attackerId = kolt.id;
  c.LEDGER.restOnce = {};
  kolt.resources.featUsed = {};
  cmd({ skill: "feat_rouse", target: helu.id, picks: { mode: "one" } });
  assert.equal(kolt.ap, 3, "一名友方：不扣行动点");
  assert.equal(kolt.bonus, 2, "一名友方：花附赠");
});
