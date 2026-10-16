// 专长内容（feats.js · FEATS）：PR #43 的专长表（7 / 11 / 13 / 16 级），按夕夏的裁定调整过
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");
const plain = (x) => JSON.parse(JSON.stringify(x));

function battle(enemies, seed, setupFn) {
  const c = H.load();
  vm.runInContext("Math", c).random = () => 0.5;
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: enemies || [{ id: "thug_knife", lv: 3, zone: 1 }], seed: seed || "FC" });
  const S = c.S.state;
  const kolt = c.findKit("kolt", S.units), helu = c.findKit("helu", S.units);
  if (setupFn) setupFn(c, S, kolt, helu);
  c.startCombat();
  const foes = S.units.filter(u => !u.isPlayer && !u.dead);
  return { c, S, kolt, helu, foes };
}
function use(c, S, actor, id, targetId, picks) {
  S.attackerId = actor.id;
  S.targetId = targetId || null;
  S.skillFlow = picks ? { id, actorId: actor.id, picks, index: 0 } : null;
  c.runSkill(id);
  S.skillFlow = null;
}
const hit = (c, a, t, opt) => c.dealTo(a, t, Object.assign({ atk: 20, mult: 1, element: "physical", baseBreak: 0, atkRange: "any" }, opt || {},
  { flags: Object.assign({ action: true, blockResolved: true, block: "none" }, (opt && opt.flags) || {}) }));

/* ---------- 选专长 ---------- */
test("专长分四层：7 级只能选①，16 级四层都能选；已经会的职责技能不能选它的涉猎；探索专长只在跑团规则下出现", () => {
  const c = H.load();
  const run = c.Rogue.newRun({ party: ["kolt", "helu"], seed: "FC0" });
  const kolt = run.party[0], helu = run.party[1];
  kolt.level = 7; helu.level = 7;
  const at7 = plain(c.featChoicesFor(kolt, 7));
  assert.ok(at7.includes("wanderer") && at7.includes("whet"));
  assert.ok(!at7.includes("charge"), "11 级的专长 7 级不能选");
  assert.ok(!at7.includes("provoke"), "柯尔特已经会嘲讽（坦克一），不能选挑衅");
  assert.ok(!plain(c.featChoicesFor(helu, 7)).includes("skywatch"), "Helumica 已经会保释（环境手二），不能选看天");
  assert.ok(!at7.includes("versatile"), "普通单局没有探索专长");
  const at16 = plain(c.featChoicesFor(kolt, 16));
  assert.ok(at16.includes("revive") && at16.includes("charge") && at16.includes("ironwall"));
  assert.ok(!at16.includes("dualclass"), "没有①–③的涉猎专长时兼修不能选");
  const g = c.Rogue.newRun({ party: ["kolt", "helu"], seed: "FC0g", growth: true });
  assert.ok(plain(c.featChoicesFor(g.party[0], 7)).includes("versatile"), "长线养成（跑团规则）有探索专长");
  assert.ok(!plain(c.featChoicesFor(g.party[0], 7)).includes("learned"), "博闻要主持人，只在跑团模式");
});

test("多面手：选了以后再追加三项熟练项待选；兼修：选一张涉猎专长升成完整版", () => {
  const c = H.load();
  const run = c.Rogue.newRun({ party: ["kolt", "helu"], seed: "FC0b", growth: true });
  const h = run.party[0];
  h.level = 16; h.feats = ["whet"]; h.pending = [{ type: "feat", level: 7 }];
  c.Rogue.choose(run, h.kit, 0, "versatile");
  assert.equal(h.pending.filter(p => p.type === "prof").length, 3);
  h.pending = [{ type: "feat", level: 16 }];
  c.Rogue.choose(run, h.kit, 0, "dualclass");
  const p = c.Rogue.pendingChoices(run).find(x => x.kit === h.kit && x.choice.type === "featFull");
  assert.ok(p);
  assert.deepEqual(plain(c.Rogue.choiceOptions(run, h.kit, p.index).map(o => o.value)), ["whet"]);
  c.Rogue.choose(run, h.kit, p.index, "whet");
  assert.deepEqual(plain(h.featFull), ["whet"]);
});

/* ---------- 次数：每场 / 每长休 ---------- */
test("每长休 2 次的涉猎（恶化）：同一场最多 1 次；两场用完后要长休才刷新；照原技能结算（敌人也能选）", () => {
  const { c, S, helu, kolt, foes } = battle(null, "FC1", (c, S, k) => { k.feats = ["worsen"]; });
  const foe = foes[0];
  kolt.bonus = 2;
  use(c, S, kolt, "feat_worsen", foe.id);
  assert.equal(foe.harshEnv, true, "照恶劣环境结算：对敌人生效");
  assert.equal(kolt.bonus, 1);
  assert.equal(c.skillRequirementError(kolt, "feat_worsen"), "这一场已经用过");
  // 下一场
  c.resetBattleFlags(kolt);
  assert.equal(c.skillRequirementError(kolt, "feat_worsen"), null);
  kolt.bonus = 1;
  use(c, S, kolt, "feat_worsen", foe.id);
  c.resetBattleFlags(kolt);
  assert.equal(c.skillRequirementError(kolt, "feat_worsen"), "这次长休的次数已用完");
  c.S.LEDGER.restOnce = {};   // 长休刷新
  assert.equal(c.skillRequirementError(kolt, "feat_worsen"), null);
  assert.ok(!c.skillList(helu).some(s => s.id === "feat_worsen"));
});

test("涉猎削弱版不吃原技能 15 级的加强（加固不能选血量种类）；兼修完整版照原技能", () => {
  const { c, S, kolt, helu } = battle(null, "FC2", (c, S, k) => { k.feats = ["brace"]; });
  kolt.level = 15;
  assert.deepEqual(plain(c.skillFlowSteps("feat_brace", kolt, {})), [], "削弱版没有选血量种类这一步");
  kolt.bonus = 1;
  const before = c.shieldSum(helu);
  use(c, S, kolt, "feat_brace", helu.id);
  assert.ok(c.shieldSum(helu) > before, "给了护盾");
  kolt.featFull = ["brace"];
  assert.equal(c.skillFlowSteps("feat_brace", kolt, {}).length, 1, "完整版 15 级可以选血量种类");
});

test("打气每场 2 次（例外）；挑衅、战地包扎每场 1 次", () => {
  const { c, S, kolt, helu, foes } = battle(null, "FC3", (c, S, k, h) => { h.feats = ["cheer", "bandage"]; });
  helu.bonus = 3; helu.ap = 2;
  use(c, S, helu, "feat_cheer", kolt.id);
  assert.equal(kolt.statuses.inspire, true);
  assert.equal(c.skillRequirementError(helu, "feat_cheer"), null);
  use(c, S, helu, "feat_cheer", kolt.id);
  assert.equal(c.skillRequirementError(helu, "feat_cheer"), "本场次数已用完");
  kolt.zone = helu.zone;
  kolt.layers.forEach(l => { l.current = Math.max(1, Math.floor(l.max / 3)); });
  const hp0 = c.totalHp(kolt);
  use(c, S, helu, "feat_bandage", kolt.id);
  assert.ok(c.totalHp(kolt) > hp0);
  assert.equal(c.skillRequirementError(helu, "feat_bandage"), "本场次数已用完");
});

test("磨刀：下回合第一击 +(2+等级÷5)d6；每场 1 次", () => {
  const { c, S, kolt } = battle(null, "FC4", (c, S, k) => { k.feats = ["whet"]; });
  kolt.level = 10; kolt.bonus = 1;
  use(c, S, kolt, "feat_whet");
  assert.equal(kolt.resources.whetDice, 4);
  assert.equal(kolt.resources.preparedPending, true);
  assert.equal(c.skillRequirementError(kolt, "feat_whet"), "本场次数已用完");
});

/* ---------- 战斗专长 ---------- */
test("硬骨头：生命上限 + 等级；空手攻击 +1 击破", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 1 }], seed: "FC5" });
  const u = c.findKit("kolt", c.S.state.units);
  const max0 = c.totalMaxHp(u);
  u.feats = ["tough"];
  c.applyLevelStats(u);
  assert.equal(c.totalMaxHp(u), max0 + u.level);
  c.applyLevelStats(u);
  assert.equal(c.totalMaxHp(u), max0 + u.level, "重算不叠加");
});

test("抵近射击：远距离攻击能打同区；低地打高地不吃 −25%", () => {
  const { c, S, helu, foes } = battle([{ id: "thug_knife", lv: 3, zone: 1 }], "FC6");
  const foe = foes[0];
  helu.zone = foe.zone;
  const miss = hit(c, helu, foe, { atkRange: "ranged" });
  assert.equal(miss.res.ok, false, "没有专长：远距离打不到同区");
  helu.feats = ["pointblank"];
  const ok = hit(c, helu, foe, { atkRange: "ranged" });
  assert.notEqual(ok.res.ok, false);
  // 低地打高地
  const dmg = (feat) => {
    const b = battle([{ id: "thug_knife", lv: 3, zone: 2 }], "FC6b");
    b.helu.zone = 1; b.foes[0].zone = 2;
    b.S.fields[2].highland = true;
    if (feat) b.helu.feats = ["pointblank"];
    const hp0 = b.c.totalHp(b.foes[0]);
    hit(b.c, b.helu, b.foes[0], { atkRange: "ranged", atk: 8 });
    return hp0 - b.c.totalHp(b.foes[0]);
  };
  assert.ok(dmg(true) > dmg(false));
});

test("抵近射击：远距离攻击打同区时倍率只有 60%；打距离 1 照常", () => {
  const dmg = (feat, zoneT) => {
    const b = battle([{ id: "captain_ox", lv: 3, zone: 1 }], "FC6c");
    const foe = b.foes[0];
    foe.layers = [{ type: "flesh", current: 900, max: 900 }];
    b.helu.zone = 1; foe.zone = zoneT;
    if (feat) b.helu.feats = ["pointblank"];
    const hp0 = b.c.totalHp(foe);
    hit(b.c, b.helu, foe, { atkRange: "ranged", atk: 50 });
    return hp0 - b.c.totalHp(foe);
  };
  const far = dmg(true, 2), near = dmg(true, 1);
  assert.ok(far > 0 && near > 0);
  assert.ok(Math.abs(near - Math.round(far * 0.6)) <= 1, `同区 ${near} ≈ 距离 1 的 ${far} × 60%`);
  assert.equal(dmg(false, 2), far, "距离 1 有没有专长都一样");
});

test("抵近射击：写着距离 1 的技能（Helumica 普攻）靠它打同区，也只有 60%", () => {
  const run = (zoneT) => {
    const b = battle([{ id: "captain_ox", lv: 3, zone: 1 }], "FC6d", (c, S, k, h) => { h.feats = ["pointblank"]; });
    const foe = b.foes[0];
    foe.layers = [{ type: "flesh", current: 900, max: 900 }];
    b.helu.zone = 1; foe.zone = zoneT; b.helu.ap = 2;
    const hp0 = b.c.totalHp(foe);
    use(b.c, b.S, b.helu, "helu_aa", foe.id);
    return hp0 - b.c.totalHp(foe);
  };
  const far = run(2), near = run(1);
  assert.ok(near > 0, "同区打得到");
  assert.ok(near < far, `同区 ${near} < 距离 1 的 ${far}`);
});

test("荒原行者：空隙花附赠不检定；进冻土不受击破；近程打飞行不额外花附赠", () => {
  const { c, S, kolt } = battle([{ id: "thug_knife", lv: 3, zone: 2 }], "FC7", (c, S, k) => { k.feats = ["wanderer"]; });
  kolt.zone = 1;
  S.gaps = S.gaps || {};
  S.gaps["1-2"] = { type: "void" };
  S.fields[2].ice = true;
  kolt.ap = 2; kolt.bonus = 2;
  const def0 = kolt.def;
  S.attackerId = kolt.id;
  c.doMove(kolt, 2);
  assert.equal(kolt.zone, 2, "越过了空隙");
  assert.equal(kolt.ap, 2, "没花行动点");
  assert.equal(kolt.bonus, 1, "花了附赠");
  assert.equal(kolt.def, def0, "进冻土没受击破");
});

test("冲阵：用附赠移动后第一次近距离攻击 +1 击破，只有一次", () => {
  const brk = (moved) => {
    const { c, S, kolt, foes } = battle([{ id: "thug_knife", lv: 3, zone: 1 }], "FC8", (c, S, k) => { k.feats = ["charge"]; });
    const foe = foes[0];
    kolt.zone = foe.zone;
    if (moved) kolt.resources.chargeTurn = S.turnNo;
    const out = hit(c, kolt, foe, { baseBreak: 1, atkRange: "melee" });
    const second = hit(c, kolt, foe, { baseBreak: 1, atkRange: "melee" });
    return [out.res.breakDealt, second.res.breakDealt];
  };
  const [a, a2] = brk(true), [b] = brk(false);
  assert.equal(a, b + 1);
  assert.equal(a2, b, "第二次不加");
});

test("还魂：被打到 0 留 1 点、到自己下回合前免伤；每场一次", () => {
  const { c, S, kolt, foes } = battle(null, "FC9", (c, S, k) => { k.feats = ["revive"]; });
  const n = [];
  kolt.layers.forEach(l => { l.current = 0; });
  assert.equal(c.applyKnockdown(kolt, n), null);
  assert.equal(c.totalHp(kolt), 1);
  assert.equal(kolt.dying, false);
  assert.equal(kolt.resources.standTurn, true);
  kolt.highEnergy = 50;
  c.checkHighBoom(kolt);
  assert.equal(kolt.dead, false, "还魂期间不高能自爆");
  kolt.resources.standTurn = false; kolt.resources.reviveGuard = false; kolt.highEnergy = 0;
  kolt.layers.forEach(l => { l.current = 0; });
  assert.equal(c.applyKnockdown(kolt, n), "dying", "第二次就倒地了");
});

test("铁壁：宣布后这一击视为协助格挡成功（免伤），每次短休一次；没有能格挡的人也会停下来问", () => {
  const { c, S, kolt, helu, foes } = battle([{ id: "thug_knife", lv: 3, zone: 1 }], "FC10", (c, S, k) => { k.feats = ["ironwall"]; });
  const foe = foes[0];
  kolt.zone = foe.zone; helu.zone = 2;
  kolt.bonus = 0;
  assert.deepEqual(plain(c.featIronwallDeclarers(kolt).map(u => u.id)), [kolt.id]);
  S.blockQueue = [];
  const hp0 = c.totalHp(kolt);
  const out = c.dealTo(foe, kolt, { atk: 30, mult: 1, element: "physical", baseBreak: 1, flags: { action: true } });
  assert.equal(out.pending, true, "等着宣布铁壁");
  c.finishBlock("ironwall:" + kolt.id);
  assert.equal(c.totalHp(kolt), hp0, "免伤");
  assert.equal(c.featIronwallDeclarers(kolt).length, 0, "用掉了");
});

test("无可阻挡：下一击无视目标减伤、击破 +2", () => {
  const { c, S, kolt, foes } = battle([{ id: "thug_knife", lv: 3, zone: 1 }], "FC11", (c, S, k) => { k.feats = ["unstoppable"]; });
  const foe = foes[0];
  kolt.zone = foe.zone;
  foe.resources = foe.resources || {};
  foe.resources.gritTurn = true;   // 目标减伤 50%
  const plainHit = hit(c, kolt, foe, { baseBreak: 1 });
  kolt.resources.unstoppableNext = true;
  const big = hit(c, kolt, foe, { baseBreak: 1 });
  assert.ok(big.res.total > plainHit.res.total, `${big.res.total} > ${plainHit.res.total}`);
  assert.ok(big.res.breakDealt >= plainHit.res.breakDealt + 2 || foe.stunned);
  assert.equal(kolt.resources.unstoppableNext, false);
});

test("乘势：把敌人打进失衡时，同区架势 = 1 的其他敌人各受 1 击破", () => {
  const { c, S, kolt, foes } = battle([{ id: "thug_knife", lv: 3, zone: 1 }, { id: "thug_knife", lv: 3, zone: 1 }], "FC12", (c, S, k) => { k.feats = ["momentum"]; });
  const [a, b] = foes;
  kolt.zone = a.zone; b.zone = a.zone;
  a.def = 1; b.def = 1;
  hit(c, kolt, a, { baseBreak: 1 });
  assert.equal(a.stunned, true);
  assert.ok(b.def === 0 || b.stunned, "旁边架势 1 的也被击破");
});

test("警戒：第一回合 +1 附赠；敌方回合敌人走进来时用留着的附赠打它", () => {
  const b0 = battle(null, "FC13a");
  const { c, S, kolt, foes } = battle([{ id: "thug_knife", lv: 3, zone: 2 }], "FC13", (c, S, k) => { k.feats = ["alert"]; });
  assert.equal(kolt.bonus, c.findKit("kolt", b0.S.units).bonus + 1);
  const foe = foes[0];
  kolt.zone = 1; foe.zone = 2;
  S.combatPhase = "enemy";
  kolt.bonus = 1;
  const hp0 = c.totalHp(foe);
  const n = [];
  foe.zone = 1;
  c.featAlertOnEnter(foe, n);
  assert.equal(kolt.bonus, 0);
  assert.ok(c.totalHp(foe) < hp0 || foe.dead);
});

test("跃迁：用行动点攻击后才能用，免费移动 1 格，每回合一次", () => {
  const { c, S, kolt, foes } = battle([{ id: "thug_knife", lv: 3, zone: 1 }], "FC14", (c, S, k) => { k.feats = ["blink"]; });
  assert.equal(c.skillRequirementError(kolt, "feat_blink"), "要先用行动点攻击");
  const foe = foes[0];
  kolt.zone = foe.zone; kolt.ap = 2;
  use(c, S, kolt, "kolt_aa", foe.id);
  assert.equal(c.skillRequirementError(kolt, "feat_blink"), null);
  const ap = kolt.ap;
  const dest = c.zoneNeighbors(kolt.zone)[0];
  use(c, S, kolt, "feat_blink", null, { dest });
  assert.equal(kolt.zone, dest);
  assert.equal(kolt.ap, ap, "不花行动点");
  assert.equal(c.skillRequirementError(kolt, "feat_blink"), "这回合已经跃迁过");
});

test("推搡：协助格挡成功后把攻击者推到相邻区域", () => {
  const { c, S, kolt, helu, foes } = battle([{ id: "thug_knife", lv: 3, zone: 1 }], "FC15", (c, S, k, h) => { h.feats = ["shove"]; });
  const foe = foes[0];
  kolt.zone = helu.zone = foe.zone = 1;
  hit(c, foe, kolt, { flags: { block: "assistOk", blockHelperId: helu.id } });
  assert.notEqual(foe.zone, 1);
});

test("人器一心：唤出武器人只花附赠（每长休一次）；号召：开战时同区我方获得护盾", () => {
  const { c, S, kolt, helu } = battle(null, "FC16", (c, S, k, h) => { k.feats = ["onemind", "rally"]; h.zone = k.zone; });
  S.attackerId = kolt.id;
  assert.deepEqual(plain(c.skillCost("kolt_summon")), { bonus: 1 });
  assert.ok(c.shieldSum(kolt) >= Math.ceil(kolt.level / 2));
  assert.ok(c.shieldSum(helu) >= Math.ceil(kolt.level / 2));
  c.featUseOnce(kolt, "onemind");
  assert.deepEqual(plain(c.skillCost("kolt_summon")), { ap: 1, bonus: 1 });
});

test("挺身：这一回合每次都免费格挡（#52：以前只挡一次）", () => {
  const { c, S, kolt, helu, foes } = battle(null, "FC17", (c, S, k, h) => { h.feats = ["standin"]; });
  kolt.zone = helu.zone;
  helu.bonus = 1;
  use(c, S, helu, "feat_standin", kolt.id);
  assert.equal(kolt.coverBy, helu.id);
  helu.bonus = 0;
  c.performAssistBlock(helu, kolt, foes[0], { roll: 1 });
  assert.equal(kolt.coverBy, helu.id, "挡过一次还在，回合结束才清掉");
});

/* ---------- 探索专长（跑团规则） ---------- */
function growthRun(seed) {
  const c = H.load();
  const run = c.Rogue.newRun({ party: ["kolt", "helu"], seed, growth: true });
  return { c, run, R: c.Rogue };
}
test("眼尖：调查类检定有优势、失败不受伤；万事通：没有的熟练项算一级；赌徒的运气：失败改成功（每长休一次）", () => {
  const { c, run, R } = growthRun("FC20");
  R.acceptTask(run, 0);
  run.task.nodes[run.task.index] = { type: "check", done: false, check: { prof: "侦察", diff: "hard", injure: true, reward: 600 } };
  const h = run.party[0];
  const base = R.checkOdds(run, h.kit);
  h.feats = ["sharpeye", "polymath"];
  const eye = R.checkOdds(run, h.kit);
  assert.equal(eye.adv, true);
  assert.equal(eye.noHurt, true);
  if (!base.level) assert.equal(eye.level, 1, "万事通：没有的熟练项算一级");
  h.feats.push("gambler");
  vm.runInContext("Math", c).random = () => 0.999;   // 必定失败
  const hp = R.heroView(run, h).hp;
  R.attemptCheck(run, h.kit);
  assert.equal(run.lastCheck.ok, true, "赌徒的运气改成成功");
});

test("巧手匠人：商店八折；荒野向导：行军时间 −1/3；拾荒者多掷一次战利品", () => {
  const { c, run, R } = growthRun("FC21");
  const h = run.party[0];
  h.feats = ["haggler", "ranger"];
  assert.equal(c.featHaggleMul(run.party, 1), 0.8);
  assert.equal(c.featHaggleMul(run.party, 0.7), 0.7, "已经更便宜的不叠加");
  assert.ok(Math.abs(c.featHaggleMul(run.party, 1.5) - 1.2) < 1e-9);
  assert.ok(Math.abs(c.featTravelMul(run.party) - 2 / 3) < 1e-9);
});

test("舌灿莲花：每个任务一次谈掉一场普通战斗", () => {
  const { c, run, R } = growthRun("FC22");
  R.acceptTask(run, 0);
  run.task.nodes[run.task.index] = { type: "battle", done: false };
  assert.equal(R.parleyOptions(run).length, 0);
  run.party[0].feats = ["silver"];
  assert.equal(R.parleyOptions(run).length, 0, "没有交涉类熟练项不能尝试");
  R.heroProfs(run.party[0])["说服"] = 2;   // 普通难度二级熟练必定成功
  const o = R.parleyOptions(run)[0];
  assert.ok(o && o.chance === 1);
  const idx = run.task.index;
  R.parley(run, o.kit);
  assert.ok(run.task.index > idx || run.task.nodes[idx].done, "这一站过去了");
  assert.equal(R.parleyOptions(run).length, 0, "一个任务只能用一次");
});

test("跑团模式：7 级给专长点，主持人分配", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [], seed: "FC23" });
  c.S.TRPG.active = true;
  const u = c.findKit("kolt", c.S.state.units);
  u.level = 6; u.xp = c.xpToNext(6);
  c.tryLevelUp(u);
  assert.equal(u.level, 7);
  assert.equal(u.featPoints, 1);
  const lines = c.trpgPickFeat("kolt", "wanderer");
  assert.match(lines[0], /荒原行者/);
  assert.equal(u.featPoints, 0);
  assert.deepEqual(plain(u.feats), ["wanderer"]);
});
