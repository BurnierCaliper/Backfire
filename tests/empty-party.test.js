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
function drawUntil(c, run, R, pred, before) {
  c.bagAdd("heart_fusion", 300);
  for (let i = 0; i < 300; i++) { if (before) before(); const r = R.drawHero(run); if (r.kit && pred(r.kit)) return r.kit; }
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
  // 别的新角色会先占掉空位：每抽之前把队伍压回 1 人，保证抽到他时有空位
  const kit = drawUntil(c, run, R, k => k === benched.kit, () => { run.party.splice(1); });
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

/* ---------- 抽取保底：可用角色（队伍 + 候补，不算永久死亡的）越少，出角色概率越高（rogue-data.js · ROGUE_GACHA.pity；rogue.js · drawRates） ---------- */
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
test("保底配置：<2 人 100%、<4 人 70%、≥4 人照常 30/40/30", () => {
  const { c } = fresh("EP8");
  const GA = c.ROGUE_GACHA || c.S.ROGUE_GACHA;
  assert.deepEqual(plain(GA.pity), [{ below: 2, hero: 1 }, { below: 4, hero: 0.7 }]);
});

test("drawRates 按当前人数返回保底后的概率，抽取面板（drawInfo.rates）读的是同一个", () => {
  const { c, run, R } = fresh("EP9");
  const check = (hero, weapon, craft) => {
    const r = R.drawRates(run);
    near(r.hero, hero); near(r.weapon, weapon); near(r.craft, craft);
    assert.deepEqual(plain(R.drawInfo(run).rates), plain(r));
  };
  check(0.7, 0.3 * 4 / 7, 0.3 * 3 / 7);           // 2 人
  const keep = run.party.splice(1);
  check(1, 0, 0);                                 // 1 人
  run.party.length = 0;
  check(1, 0, 0);                                 // 0 人
  run.party.push(...keep);
  c.bagAdd("heart_fusion", 400);
  for (let i = 0; i < 400 && run.party.length + run.reserve.length < 4; i++) R.drawHero(run);
  assert.equal(run.party.length + run.reserve.length, 4);
  check(0.3, 0.4, 0.3);                           // 4 人（含候补）
});

test("永久死亡的不算人数：全队死光后每一抽必出角色；十连每抽重新算人数", () => {
  const { c, run, R } = wipe("EP10");
  assert.equal(run.party.length, 0);
  assert.ok((run.deadKits || []).length >= 2);
  near(R.drawRates(run).hero, 1);
  c.bagAdd("heart_fusion", 10);
  const res = R.drawMany(run, 10).results;
  // 前两抽人数是 0、1 → 必出角色；之后人数变了，概率跟着变
  assert.equal(res[0].type, "hero");
  assert.equal(res[1].type, "hero");
  assert.ok(res.some(r => r.type !== "hero"), "人数到 2 以后不再是 100% 角色");
});

test("保底时多抽几次全是角色（人数少于 2）", () => {
  for (let s = 0; s < 20; s++) {
    const { c, run, R } = fresh("EP11-" + s);
    run.party.splice(1);
    c.bagAdd("heart_fusion", 1);
    assert.equal(R.drawHero(run).type, "hero");
  }
});

test("所有角色都满级：照旧只出材料", () => {
  const { c, run, R } = fresh("EP12");
  c.bagAdd("heart_fusion", 600);
  for (let i = 0; i < 600 && R.drawInfo(run).pool.some(p => !p.owned); i++) R.drawHero(run);
  run.party.concat(run.reserve).forEach(h => { h.level = 20; });
  near(R.drawRates(run).hero, 0);
  c.bagAdd("heart_fusion", 10);
  assert.ok(R.drawMany(run, 10).results.every(r => r.type !== "hero"));
});
