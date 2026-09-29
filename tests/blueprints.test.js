// 武器工匠的收费规则与十二种客制化图纸（mods.js）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

/** 摆一场战斗：柯尔特（扭矩）+ Helumica（Ecmo）对狂徒，全员 1 区。mods：武器 kit → 图纸 mod */
function field(mods, enemies) {
  const c = H.load();
  c.BattleSim.setup({
    party: ["kolt", "helu"], seed: "BP",
    enemies: enemies || [{ id: "thug_hammer", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }],
    before: (st) => { st.weaponMods = mods || {}; }
  });
  c.startCombat();
  const st = c.S.state;
  st.units.forEach(u => { u.zone = 1; });
  const k = id => c.findKit(id, st.units);
  const foes = st.units.filter(u => !u.isPlayer);
  const hit = (a, t, extra) => c.dealTo(a, t, Object.assign({ atk: 10, mult: 1, element: "physical", baseBreak: 0, atkRange: "any",
    flags: { action: true, blockResolved: true, block: "none" } }, extra || {}));
  const log = (r) => (r.res.log || []).concat(r.extra || []).join("\n");
  return { c, st, kolt: k("kolt"), helu: k("helu"), foe: foes[0], foe2: foes[1], hit, log };
}
const modOf = (c, id) => {
  for (const s of c.S.ROGUE_SMITHS) for (const b of s.blueprints) if (b.id === id) return b.mod;
  throw new Error(id);
};

/* ---------- 收费 ---------- */
function board(seed) {
  const c = H.load();
  const R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed });
  c.S.state.kuizhi = 999999;
  return { c, R, run };
}
const onBoard = (run, R, id) => { run.stage = "board"; run.smiths = [id]; };

test("崔佛不帮陌生人：先给他看武器才接活；升级满 3 次后关系变好打折", () => {
  const { c, R, run } = board("P1");
  onBoard(run, R, "trevor");
  assert.throws(() => R.upgradeWeapon(run, "torque", "trevor"), /陌生人/);
  R.introduceSmith(run, "trevor");
  const full = R.smithQuote(run, "trevor", 2).cost;
  for (let i = 0; i < 3; i++) R.upgradeWeapon(run, i % 2 ? "ecmo" : "torque", "trevor");
  assert.ok(R.smithQuote(run, "trevor", 2).cost < full);
});

test("努尔&哈米德：加工费 8 折但多耗 2 个材料；装不了图纸", () => {
  const { R, run } = board("P2");
  assert.equal(R.smithQuote(run, "nurhamid", 2).cost, 800);   // 5 金属 = 5000 × 1/6
  assert.equal(R.smithQuote(run, "nurhamid", 5).cost, 3400);  // (2 合金 + 4 金属 = 14000) + 8000×0.8 = 20400 × 1/6
  onBoard(run, R, "nurhamid");
  run.blueprints.push("bp_nur_safe");
  assert.throws(() => R.installBlueprint(run, "bp_nur_safe", "torque", "nurhamid"), /装不了/);
});

test("季玛不收加工费，5 级起改为帮他建庇护所（花时间）", () => {
  const { c, R, run } = board("P3");
  assert.equal(R.smithQuote(run, "tima", 5).cost, 2000);   // 只收材料 12000 × 1/6
  assert.equal(R.smithQuote(run, "tima", 5).hours, 4);
  assert.equal(R.smithQuote(run, "tima", 2).hours, 0);
  onBoard(run, R, "tima");
  run.party[0].weaponLevels.torque = 4;
  const h0 = c.S.LEDGER.hours;
  R.upgradeWeapon(run, "torque", "tima");
  assert.equal(c.S.LEDGER.hours, h0 + 4);
});

test("出现权重：设定里的所在地是本幕区域时更常见，摩尔玛很少见", () => {
  const c = H.load();
  const run = c.Rogue.newRun({ party: ["kolt", "helu"], seed: "P4" });
  const seen = {};
  for (let i = 0; i < 200; i++) { c.Rogue.makeBoard(run); run.smiths.forEach(id => { seen[id] = (seen[id] || 0) + 1; }); }
  assert.ok(seen.trevor > seen.zekahr, "第一幕在外城区，崔佛比泽卡尔常见");
  assert.ok(seen.morma < seen.teresa, "摩尔玛很少见");
});

/* ---------- 图纸效果 ---------- */
test("狂徒浪漫：打近距离敌人 +1d8；承受伤害 +1d10；架势 −2", () => {
  const plainDef = field().kolt.defMax;
  const { c, kolt, foe, hit, log } = field({ torque: modOf(H.load(), "bp_trevor_romance") });
  assert.equal(kolt.defMax, plainDef - 2);
  assert.match(log(hit(kolt, foe)), /狂徒浪漫/);
  assert.match(log(hit(foe, kolt)), /狂徒浪漫（承受）/);
});

test("轻量化处理：持有者每回合多 1 附赠；实验性选项：行动点 +1、没有附赠、atk 少四分之一", () => {
  const c0 = H.load();
  const a = field({ ecmo: modOf(c0, "bp_teresa_light") });
  a.c.refreshEconomy(a.helu);
  assert.equal(a.helu.bonus, 2);
  const w = a.c.spawnWeapon(a.helu, "ecmo");
  a.c.refreshEconomy(w);
  assert.equal(w.ap, 2, "武器人形态多 1 行动点");
  const base = field();
  const atk0 = base.c.effectiveAtk(base.helu, base.st.units);
  const b = field({ ecmo: modOf(c0, "bp_teresa_exp") });
  b.c.refreshEconomy(b.helu);
  assert.equal(b.helu.ap, 2);
  assert.equal(b.helu.bonus, 0);
  assert.equal(b.c.effectiveAtk(b.helu, b.st.units), Math.floor(atk0 * 0.75));
});

test("恶眼：不能为别人协助格挡，协助攻击伤害 +50%", () => {
  const { c, kolt, helu } = field({ ecmo: modOf(H.load(), "bp_zekahr_evil") });
  helu.bonus = 1;
  assert.ok(!c.eligibleBlockers(kolt).includes(helu));
  assert.equal(c.bpAssistMult(helu, 1), 1.5);
});

test("蠢货：不能协助攻击；敌人更倾向于打你；格挡成功回血", () => {
  const { c, st, kolt, helu, foe } = field({ ecmo: modOf(H.load(), "bp_zekahr_fool") });
  foe.def = 0; foe.stunned = true;
  assert.ok(!c.eligibleAssisters(kolt, foe).includes(helu));
  let n = 0;
  for (let i = 0; i < 60; i++) {
    const p = c.S.EnemyAI.target(foe, { aim: "topAtk" }, c.S.EnemyAI.players());
    if (p.unit === helu) n++;
  }
  assert.ok(n >= 20, "Helumica 被选中 " + n + "/60");
  helu.layers.forEach(l => { l.current = Math.max(1, l.max - 8); });
  const hp = c.totalHp(helu);
  helu.bonus = 1;
  c.performAssistBlock(helu, kolt, foe, { ok: true, roll: 1 });
  assert.ok(c.totalHp(helu) > hp);
});

test("安全的迷彩：武器人形态一定不会被选作目标；角色本人很少被选", () => {
  const { c, helu, foe } = field({ ecmo: modOf(H.load(), "bp_tima_camo") });
  const w = c.spawnWeapon(helu, "ecmo");
  assert.equal(c.bpUntargetable(w), true);
  assert.ok(!c.S.EnemyAI.players().filter(u => !c.bpUntargetable(u)).includes(w));
});

test("稳妥的距离：远距离 +1d4、近距离 −3；敌人走进来时自动退到另一个区", () => {
  const { c, st, kolt, foe, foe2, hit, log } = field({ torque: modOf(H.load(), "bp_tima_range") });
  assert.match(log(hit(kolt, foe, { atk: 1 })), /稳妥的距离 -3/);
  foe.zone = 2;
  assert.match(log(hit(kolt, foe, { atk: 1 })), /稳妥的距离 \+1d4/);
  st.units.filter(u => !u.isPlayer).forEach(u => { u.zone = 2; });
  st.combatPhase = "enemy"; foe2.bonus = 1; foe2.ap = 1;
  c.doMove(foe2, 1);
  assert.notEqual(Number(kolt.zone), 1);
});

test("WAM-56：放弃被动；敌人离开同区时自动攻击；同区敌人 atk −4", () => {
  const base = field();
  const atk0 = base.c.effectiveAtk(base.foe, base.st.units);
  const { c, st, kolt, foe } = field({ torque: modOf(H.load(), "bp_morma_wam56") });
  assert.equal(c.passiveOn(kolt), false);
  assert.equal(c.effectiveAtk(foe, st.units), Math.max(0, atk0 - 4));
  const hp = c.totalHp(foe);
  st.combatPhase = "enemy"; foe.bonus = 1; foe.ap = 1;
  c.doMove(foe, 2);
  assert.ok(c.totalHp(foe) < hp, "借机攻击单元应当开火");
});

test("MR-2165：格挡成功清除被保护者的负面状态；第一次被击破不触发敌人的协助攻击并恢复 2 架势", () => {
  const { c, st, kolt, helu, foe } = field({ ecmo: modOf(H.load(), "bp_morma_mr2165"), torque: modOf(H.load(), "bp_morma_mr2165") });
  kolt.statuses.burn = 2; kolt.statuses.shock = true;
  helu.bonus = 1;
  c.performAssistBlock(helu, kolt, foe, { ok: true, roll: 1 });
  assert.equal(kolt.statuses.burn, 0);
  assert.equal(kolt.statuses.shock, false);
  kolt.def = 1; kolt.stunned = false;
  c.dealBreak(kolt, 1, "physical", []);
  assert.equal(kolt.stunned, false);
  assert.equal(kolt.def, 2);
  assert.equal((st.assistQueue || []).length, 0);
  // 只有第一次
  kolt.def = 1;
  c.dealBreak(kolt, 1, "physical", []);
  assert.equal(kolt.stunned, true);
});

test("愿你无恙：被克制的加成只算 25%；受到治疗 +2d4；攻击 −1d6；被协助格挡时成功率 +10%", () => {
  const plain = field();
  const block0 = plain.c.finalBlockChance(plain.helu, plain.foe, plain.kolt);
  const { c, kolt, helu, foe, hit, log } = field({ torque: modOf(H.load(), "bp_nur_safe") });
  assert.match(log(hit(foe, kolt, { element: "fire" })), /愿你无恙：属性克制加成 \+50% → \+25%/);
  kolt.layers.forEach(l => { l.current = 1; });
  assert.ok(c.healUnit(kolt, 1) >= 3);
  assert.match(log(hit(kolt, foe)), /愿你无恙 −1d6/);
  assert.equal(c.finalBlockChance(helu, foe, kolt), Math.min(100, block0 + 10));
});

test("愿你常胜：属性效果不好时 +1 击破；绝佳时 50% 施加状态", () => {
  const armored = (f) => { f.foe.layers = [{ type: "armor", current: 50, max: 50 }, { type: "flesh", current: 50, max: 50, inner: true }]; f.foe.def = 5; f.foe.defMax = 5; };
  const base = field(); armored(base);
  base.hit(base.kolt, base.foe, { element: "physical" });
  const { c, kolt, foe, hit } = field({ torque: modOf(H.load(), "bp_hamid_win") });
  // 物理打装甲：−25%，效果不好
  armored({ foe });
  hit(kolt, foe, { element: "physical" });
  assert.equal(foe.def, base.foe.def - 1);
  // 火打肉体：+50%，绝佳
  foe.layers = [{ type: "flesh", current: 50, max: 50, inner: true }];
  c.Math.random = () => 0;
  hit(kolt, foe, { element: "fire" });
  assert.ok(Number(foe.statuses.burn) >= 1);
});
