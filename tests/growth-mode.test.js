// 长线养成（rogue.js · run.growth；rogue-data.js · ROGUE_GROWTH）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = (x) => JSON.parse(JSON.stringify(x));

/** today：把「今天」钉在这个时刻（长线养成的每日挑战按当天日期刷题，rogue.js · growthDailyKey；要战况固定的测试用） */
function fresh(seed, party, today) {
  const c = H.load();
  if (today) {
    const RealDate = Date, t = new RealDate(today).getTime();
    c.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [t])); } };
  }
  const run = c.Rogue.newRun({ party: party || ["kolt", "helu"], seed, growth: true });
  return { c, run, R: c.Rogue, G: c.ROGUE_GROWTH || c.S.ROGUE_GROWTH };
}
const fusion = (c) => c.bagCount("heart_fusion");
function finishQuickTask(run, R) {
  R.acceptTask(run, 0);
  run.task.nodes = [{ type: "rest", done: false }];
  run.task.index = 0;
  return R.restAtNode(run, "short");
}

test("开局只能选 2 人；没有主线和期限，任务板照常", () => {
  const c = H.load();
  assert.throws(() => c.Rogue.newRun({ party: ["kolt", "helu", "ras"], seed: "G0", growth: true }), /2 名/);
  const { run, R } = fresh("G1");
  assert.equal(run.growth, true);
  assert.equal(run.main, null);
  assert.equal(run.stage, "board");
  assert.ok(run.board.length > 0);
  run.actDay = 999;   // 天数再多也能接任务
  assert.equal(R.taskBlocked(run, run.board[0]), null);
});

test("经验照跑团模式：升级所需经验不打折，击杀经验全队平分", () => {
  const { c } = fresh("G2");
  assert.equal(c.Rogue.growthXp(), true);
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "G2b" });
  assert.equal(c.trpgXpRules(), true);
  const normal = H.load();
  normal.Rogue.newRun({ party: ["kolt", "helu"], seed: "G2c" });
  assert.equal(normal.trpgXpRules(), false);
  assert.ok(c.xpToNext(1) > normal.xpToNext(1), `养成 ${c.xpToNext(1)} 应比单局 ${normal.xpToNext(1)} 多`);
});

test("完成任务得到赫心融合体；回到任务板（不会进首领战）", () => {
  const { c, run, R, G } = fresh("G3");
  assert.equal(fusion(c), 0, "开局当天不发每日融合体");
  const day0 = run.day;
  finishQuickTask(run, R);
  // 任务报酬 fusionPerTask 个，另外任务花掉的每一天各发 1 个每日融合体（PR #73 的设计）
  assert.equal(fusion(c), G.fusionPerTask + (run.day - day0));
  assert.equal(run.stage, "camp");
  R.camp(run);
  assert.equal(run.stage, "board");
});

test("抽取机：新角色入队，满员进候补；抽到已有的 +1 级；可以换人", () => {
  const { c, run, R, G } = fresh("G4");
  assert.equal(R.drawInfo(run).canDraw, false);
  c.bagAdd("heart_fusion", 30);
  let ups = 0, joins = 0;
  for (let i = 0; i < 30; i++) {
    const before = run.party.length + run.reserve.length;
    const r = R.drawHero(run);
    const h = run.party.concat(run.reserve).find(x => x.kit === r.kit);
    if (r.levelUp) { ups++; assert.ok(h.level >= 2); }
    else { joins++; assert.equal(run.party.length + run.reserve.length, before + 1); assert.equal(h.level, G.recruitLevel); }
  }
  assert.equal(fusion(c), 0);
  assert.ok(ups > 0 && joins > 0, `${ups} ${joins}`);
  assert.ok(run.party.length <= G.partyMax);
  if (run.reserve.length) {
    const inn = run.reserve[0].kit, out = run.party[0].kit;
    R.swapHero(run, out, inn);
    assert.ok(run.party.some(h => h.kit === inn));
    assert.ok(run.reserve.some(h => h.kit === out));
    assert.throws(() => R.swapHero(run, null, run.reserve[0].kit), /满员/);
  }
  // 抽到重复角色升级也会排上升级选择
  const leveled = run.party.concat(run.reserve).find(h => h.level >= 4);
  if (leveled) assert.ok((leveled.pending || []).some(p => p.level === 4));
});

test("武器升级照跑团模式：要实物材料 + 加工费；商店常备材料", () => {
  const { c, run, R } = fresh("G5");
  run.smiths = ["trevor"];
  const sid = R.presentSmiths(run)[0];
  assert.ok(sid, "任务板前要有工匠");
  if (R.smithInfo(run, sid).needsIntro) R.introduceSmith(run, sid);
  const opt = R.smithOptions(run, sid).find(o => o.kit === "torque");
  assert.ok(opt.mats && opt.mats.length, "要列出材料");
  assert.equal(opt.enough, false);
  c.S.state.kuizhi = 1e6;
  assert.throws(() => R.upgradeWeapon(run, "torque", sid), /材料不够/);
  opt.mats.forEach(m => c.bagAdd(m.id, m.need));
  const k0 = c.S.state.kuizhi;
  R.upgradeWeapon(run, "torque", sid);
  assert.equal(run.party[0].weaponLevels.torque, 2);
  assert.equal(c.S.state.kuizhi, k0 - opt.cost);
  opt.mats.forEach(m => assert.equal(c.bagCount(m.id), 0));
  // 商店（休整时）常备材料
  run.stage = "camp";
  if (R.canShop(run)) assert.ok(R.shopStock(run).some(r => r.key === "mat_metal"));
});

test("团灭只算任务失败，角色不会永久死亡", () => {
  const { c, run, R } = fresh("G6");
  R.acceptTask(run, 0);
  while (!R.battleSpec(run)) run.task.index++;
  c.BattleSim.setup(R.battleSpec(run));
  c.S.state.units.filter(u => u.isPlayer).forEach(u => { u.dead = true; (u.layers || []).forEach(l => { l.current = 0; }); });
  R.finishBattle(run, "lose");
  assert.equal(run.party.length, 2);
  assert.equal((run.fallen || []).length, 0);
  assert.notEqual(run.stage, "over");
  assert.equal(run.stage, "camp");
});

test("自动打 40 步：不会结束、不会进首领战，队伍平均等级决定敌人等级", () => {
  // 种子换过：决一死战拦下所有攻击后，带灯的队伍战况变了，原种子刚好全灭。
  // 日期也固定：每日挑战完成了给材料、奎支、融合体（多抽一次人），战况跟着日期变，以前没固定，2026-10-23 这样的日子就会全灭
  const { c, run, R } = fresh("G7b", null, "2026-10-22T12:00:00");
  const { BattleSim } = c;
  const seen = new Set();
  for (let i = 0; i < 400 && run.tasksDone < 6; i++) {
    const pend = R.pendingChoices(run);
    if (pend.length) { const p = pend[0]; R.choose(run, p.kit, p.index, R.choiceOptions(run, p.kit, p.index)[0].value); continue; }
    seen.add(run.stage);
    if (run.stage === "board") {
      if (R.drawInfo(run).canDraw) { R.drawHero(run); continue; }
      R.acceptTask(run, 0);
    } else if (run.stage === "task" && !R.currentNode(run)) R.chooseNode(run, R.nodeChoices(run)[0].i);
    else if (run.stage === "task") {
      const node = R.currentNode(run);
      if (node.type === "rest" && !run.ambush) R.restAtNode(run, R.canLongRest(run) ? "long" : "short");
      else if (node.type === "check") R.skipCheck(run);
      else if (["shop", "smith", "clinic"].includes(node.type)) R.leaveNode(run);
      else {
        const spec = R.battleSpec(run);
        if (spec.level != null) assert.ok(spec.level >= R.partyLevel(run), `敌人 ${spec.level} 级，队伍平均 ${R.partyLevel(run)} 级`);
        BattleSim.setup(spec);
        const r = BattleSim.run({ maxRounds: 40 });
        R.finishBattle(run, r.winner === "player" ? "win" : "lose");
      }
    } else if (run.stage === "camp") R.camp(run);
    else assert.fail("不该出现的阶段：" + run.stage);
  }
  assert.notEqual(run.stage, "over");
  assert.ok(!seen.has("boss"));
  assert.ok(run.tasksDone >= 1, `完成任务 ${run.tasksDone}`);
  assert.ok(run.party.length >= 2);
});

test("坚毅生命耗尽才真正死亡：移出队伍，再抽到从 1 级重新培养", () => {
  const { c, run, R } = fresh("G8");
  run.party[0].level = 5;
  const kit = run.party[0].kit;
  R.acceptTask(run, 0);
  while (!R.battleSpec(run)) run.task.index++;
  c.BattleSim.setup(R.battleSpec(run));
  const u = c.S.state.units.find(x => x.isPlayer && x.kit === kit);
  u.dead = true; u.shp = 0; (u.layers || []).forEach(l => { l.current = 0; });
  R.finishBattle(run, "win");
  assert.ok(!run.party.some(h => h.kit === kit));
  assert.ok((run.deadKits || []).includes(kit));
  assert.notEqual(run.stage, "over");
});
