// 长线养成：全队永久死亡后队伍空了（#340）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = (x) => JSON.parse(JSON.stringify(x));

function fresh(seed) {
  const c = H.load();
  const run = c.Rogue.newRun({ party: ["kolt", "helu"], seed, growth: true });
  return { c, run, R: c.Rogue, G: c.ROGUE_GROWTH || c.S.ROGUE_GROWTH };
}
const fusion = (c) => c.bagCount("heart_fusion");
/** 进到第一场战斗，把 kits 里的人坚毅耗尽打死，按 outcome 结算 */
function killInBattle(c, run, R, kits, outcome) {
  R.acceptTask(run, 0);
  run.task.nodes = [{ type: "battle", done: false }, { type: "battle", done: false }];
  run.task.cols = [["battle"], ["battle"]]; run.task.pick = [0, 0];
  run.task.index = 0;
  c.BattleSim.setup(R.battleSpec(run));
  c.S.state.units.filter(u => u.isPlayer && kits.includes(u.kit)).forEach(u => {
    u.dead = true; u.shp = 0; (u.layers || []).forEach(l => { l.current = 0; });
  });
  return R.finishBattle(run, outcome);
}
function wipe(seed) {
  const f = fresh(seed);
  killInBattle(f.c, f.run, f.R, f.run.party.map(h => h.kit), "win");
  if (f.run.stage === "camp") f.R.camp(f.run);
  return f;
}

test("规则 5：打赢但全队永久死亡，不结束本局，回到休整/任务板", () => {
  const { run } = wipe("EP1");
  assert.equal(run.party.length, 0);
  assert.notEqual(run.stage, "over");
  assert.equal(run.result == null, true);
  assert.equal(run.stage, "board");
});

test("规则 5：打输且全队坚毅耗尽，也只算任务失败", () => {
  const { c, run, R } = fresh("EP1b");
  killInBattle(c, run, R, run.party.map(h => h.kit), "lose");
  assert.equal(run.party.length, 0);
  assert.equal(run.stage, "camp");
});

test("规则 1：队伍空时不能接任务，中文报错，状态不变", () => {
  const { run, R } = wipe("EP2");
  const before = JSON.stringify(plain(run));
  assert.throws(() => R.acceptTask(run, 0), /队伍里没有角色/);
  assert.equal(JSON.stringify(plain(run)), before);
});

test("规则 2：空队伍可以在任务板前休整，每次过 1 天、拿 1 个融合体", () => {
  const { c, run, R } = wipe("EP3");
  for (let i = 0; i < 3; i++) {
    const d = run.day, f = fusion(c);
    R.camp(run);
    assert.equal(run.day, d + 1);
    assert.equal(fusion(c), f + 1);
    assert.equal(run.stage, "board");
    assert.equal(run.party.length, 0);
  }
});

test("规则 3：有人永久死亡时候补自动补进队伍", () => {
  const { c, run, R } = fresh("EP4");
  c.bagAdd("heart_fusion", 60);
  for (let i = 0; i < 60 && run.reserve.length < 2; i++) R.drawHero(run);
  assert.ok(run.reserve.length >= 1, "要有候补");
  const n = run.party.length, r0 = run.reserve.length;
  const dead = run.party.map(h => h.kit);
  killInBattle(c, run, R, dead, "win");
  assert.ok(run.party.length >= 1);
  assert.equal(run.party.length, Math.min(n, r0));
  assert.ok(run.party.every(h => !dead.includes(h.kit)));
  assert.notEqual(run.stage, "over");
});

/** 一直抽直到抽到 kit（兼容只抽角色的旧抽取机和 #332 的混合抽取机） */
function drawUntil(c, run, R, pred) {
  c.bagAdd("heart_fusion", 300);
  for (let i = 0; i < 300; i++) { const r = R.drawHero(run); if (r.kit && pred(r.kit)) return r.kit; }
  return null;
}

test("规则 4：空队伍抽到新角色直接上场", () => {
  const { c, run, R } = wipe("EP5");
  const kit = drawUntil(c, run, R, () => true);
  assert.ok(kit);
  assert.ok(run.party.some(h => h.kit === kit));
  assert.equal(run.reserve.length, 0);
  assert.doesNotThrow(() => R.acceptTask(run, 0));
});

test("规则 4：抽到候补里已有的人、队伍有空位：+1 级并直接上场", () => {
  const { c, run, R } = fresh("EP6");
  c.bagAdd("heart_fusion", 300);
  for (let i = 0; i < 300 && !run.reserve.length; i++) R.drawHero(run);
  assert.ok(run.reserve.length);
  const benched = run.reserve[0];
  run.party.splice(1);   // 腾出空位
  const lv = benched.level || 1;
  const kit = drawUntil(c, run, R, k => k === benched.kit);
  assert.equal(kit, benched.kit);
  assert.ok(run.party.some(h => h.kit === kit), "要上场");
  assert.ok(!run.reserve.some(h => h.kit === kit));
  assert.ok(run.party.find(h => h.kit === kit).level >= lv + 1);
});

test("存读档往返：空队伍的长线存档保留，读回后照样能休整、不能接任务", () => {
  const { c, run, R } = wipe("EP7");
  R.save(run);
  const loaded = c.SaveStore.loadGrowth();
  assert.ok(loaded && loaded.growth);
  assert.equal(loaded.party.length, 0);
  assert.equal(loaded.stage, "board");
  R.enterRunMode(loaded);
  assert.throws(() => R.acceptTask(loaded, 0), /队伍里没有角色/);
  const d = loaded.day;
  R.camp(loaded);
  assert.equal(loaded.day, d + 1);
});
