// 友伤开关（#428，作者 10/27）：每个玩家各自一个开关（默认关，战斗中途随时能改，只管自己操控的单位）。
// 开着时自己的攻击能选中除自己以外的队友（含武器人），范围攻击 / 溅射也打到范围里的队友（施放者除外）；
// 打队友和打敌人一样结算（格挡 / 协助格挡、被动、失衡），只是不计分数；敌人不受影响；联机只把开关状态发给玩家。
// 规则在 enemies.js · FRIENDLY_FIRE / attackFoe，接线见 app.js · visibleEnemies / fieldFoes / dealTo、game.js · candidateUnits、
// hotseat-validation.js · checkTarget、hotseat-game.js（按发指令的人记开关）、online-view.js · projectState（白名单）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const V = require("../online-view");
const plain = v => JSON.parse(JSON.stringify(v));
const run = (c, expr) => vm.runInContext(expr, c);

/** 三名队友 + 一个狂徒，全在 1 区（三区直排）。狂徒血厚、架势高：打不死也打不进失衡 */
function field(party = ["kolt", "helu", "tou"], seed = "FF428") {
  const c = H.load();
  c.BattleSim.setup({ party, enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], zoneMode: 3, seed });
  c.startCombat();
  const S = c.S.state;
  const heroes = party.map(k => c.findKit(k, S.units));
  const foe = S.units.find(u => !u.isPlayer);
  [...heroes, foe].forEach(u => { u.zone = 1; });
  foe.layers = [{ type: "flesh", current: 500, max: 500 }]; foe.def = foe.defMax = 30;
  heroes.forEach(h => { h.ap = h.apMax = 4; h.bonus = h.bonusMax = 4; h.level = Math.max(Number(h.level) || 1, 5); });
  return { c, S, heroes, foe };
}
const hp = (c, u) => c.totalHp(u);
/** 一下普通的单体攻击（不带格挡结果：可能排进格挡队列） */
const strike = (c, a, t, extra) => c.dealTo(a, t, Object.assign({ atk: 10, mult: 1, element: "physical", baseBreak: 1, atkRange: "any", flags: { action: true } }, extra || {}));
const ffOn = (c, owner) => c.Commands.dispatch(owner ? { type: "battle.friendlyFire", on: true, owner } : { type: "battle.friendlyFire", on: true });

test("配置表：默认关、本机一个开关；开新的一场战斗清空（回到关）", () => {
  const c = H.load();
  const F = run(c, "FRIENDLY_FIRE");
  assert.equal(F.defaultOn, false, "默认关");
  assert.equal(F.localOwner, "local", "本机（单局、单人、跑团）：一个开关管全队");
  const { c: f, S, heroes: [kolt] } = field();
  assert.deepEqual(plain(S.friendlyFire), {}, "开战时没有人开着");
  assert.equal(f.friendlyFireSetting(), false);
  assert.equal(f.friendlyFireOn(kolt), false);
  // 开了以后再开一场新的战斗：回到默认的关
  ffOn(f);
  assert.equal(f.friendlyFireSetting(), true);
  f.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "FF428-2" });
  assert.deepEqual(plain(f.S.state.friendlyFire), {}, "新的一场战斗：开关清空");
  assert.equal(f.friendlyFireSetting(), false);
});

test("开关关着时一切照旧：攻击只认敌人，范围攻击不打队友，分步名单没有队友", () => {
  const { c, S, heroes: [kolt, helu, tou], foe } = field(["kolt", "helu", "hiaki"]);
  const hiaki = c.findKit("hiaki", S.units);
  assert.equal(c.attackFoe(kolt, helu), false, "队友不是攻击对象");
  assert.equal(c.attackFoe(kolt, foe), true);
  assert.equal(c.attackFoe(kolt, kolt), false);
  assert.deepEqual(plain(c.visibleEnemies(1, kolt).map(u => u.id)), [foe.id], "这一区能打的只有敌人");
  assert.ok(!c.fieldFoes(kolt).some(u => u.isPlayer), "分步「选敌人」的名单没有队友");
  // 范围攻击（绯秋一闪：同区全体）：队友不挨打
  hiaki.resources.stance = "iai";
  const before = { helu: hp(c, helu), kolt: hp(c, kolt), foe: hp(c, foe) };
  c.Commands.dispatch({ type: "skill", actor: hiaki.id, skill: "hiaki_flash" });
  assert.equal(hp(c, helu), before.helu); assert.equal(hp(c, kolt), before.kolt);
  assert.ok(hp(c, foe) < before.foe, "敌人照样挨打");
  // 迫击炮（单体，要选敌人）：选队友在扣点之前就拦下
  kolt.resources.bit = "acid"; helu.zone = 2;
  assert.equal(c.skillTargetError(kolt, "kolt_cannon", helu), "先选迫击炮的目标");
  assert.ok(tou);
});

test("开着友伤：能选队友（含武器人）、不能选自己；分步名单、迫击炮的目标检查都认队友", () => {
  const { c, S, heroes: [kolt, helu, tou], foe } = field();
  ffOn(c);
  assert.equal(c.friendlyFireOn(kolt), true);
  assert.equal(c.attackFoe(kolt, helu), true, "队友能打");
  assert.equal(c.attackFoe(kolt, kolt), false, "不能打自己");
  assert.equal(c.attackFoe(kolt, foe), true);
  // 武器人（灯的年糕）也是能打的队友；武器人打自己的持有者也算打队友
  c.Commands.dispatch({ type: "skill", actor: tou.id, skill: "tou_summon" });
  const mochi = c.findKit("mochi", S.units);
  assert.ok(mochi && !mochi.hidden, "年糕上场");
  assert.equal(c.attackFoe(kolt, mochi), true, "武器人也能选");
  assert.equal(c.attackFoe(mochi, tou), true, "武器人打持有者 = 打队友");
  const foes = c.fieldFoes(kolt).map(u => u.id);
  assert.ok(foes.includes(helu.id) && foes.includes(tou.id) && foes.includes(mochi.id) && foes.includes(foe.id));
  assert.ok(!foes.includes(kolt.id), "名单里没有自己");
  // 迫击炮（距离 1-2 的一名敌人）：队友也能选
  kolt.resources.bit = "acid"; helu.zone = 2;
  assert.equal(c.skillTargetError(kolt, "kolt_cannon", helu), null);
  const steps = c.skillFlowSteps("kolt_cannon", kolt, {});
  assert.ok(steps[0].units.some(u => u.id === helu.id), "迫击炮的分步名单列出距离 1 的队友");
  assert.ok(!steps[0].units.some(u => u.id === kolt.id));
});

test("范围攻击打到范围里的队友，施放者自己除外（绯秋一闪）；关掉以后立刻不打", () => {
  const { c, S, heroes: [kolt, helu], foe } = field(["kolt", "helu", "hiaki"]);
  const hiaki = c.findKit("hiaki", S.units);
  ffOn(c);
  hiaki.resources.stance = "iai";
  const before = { helu: hp(c, helu), kolt: hp(c, kolt), hiaki: hp(c, hiaki), foe: hp(c, foe) };
  c.Commands.dispatch({ type: "skill", actor: hiaki.id, skill: "hiaki_flash" });
  assert.ok(hp(c, helu) < before.helu, "同区的队友挨了一闪");
  assert.ok(hp(c, kolt) < before.kolt, "同区的另一个队友也挨了");
  assert.equal(hp(c, hiaki), before.hiaki, "施放者自己不挨");
  assert.ok(hp(c, foe) < before.foe, "敌人照样挨");
  // 战斗中途关掉：改了立刻生效
  c.Commands.dispatch({ type: "battle.friendlyFire", on: false });
  assert.equal(c.friendlyFireOn(hiaki), false);
  hiaki.resources.stance = "iai"; hiaki.ap = 4;
  const mid = { helu: hp(c, helu), foe: hp(c, foe) };
  c.Commands.dispatch({ type: "skill", actor: hiaki.id, skill: "hiaki_flash" });
  assert.equal(hp(c, helu), mid.helu, "关了以后队友不再挨");
  assert.ok(hp(c, foe) < mid.foe);
});

test("溅射（自我效果）：酸属性单体攻击溅到同区的队友——开着才溅，攻击者自己不溅", () => {
  const mk = on => {
    const { c, heroes: [kolt, helu, tou], foe } = field(["kolt", "helu", "tou"], "FF428-SPLASH");
    if (on) ffOn(c);
    kolt.self = "splash";
    const before = { helu: hp(c, helu), tou: hp(c, tou), kolt: hp(c, kolt) };
    c.dealTo(kolt, foe, { atk: 40, mult: 1, element: "acid", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true } });
    return { c, helu, tou, kolt, before };
  };
  const off = mk(false);
  assert.equal(hp(off.c, off.helu), off.before.helu, "关着：队友不被溅到");
  const on = mk(true);
  assert.ok(hp(on.c, on.helu) < on.before.helu, "开着：同区队友被溅射打到");
  assert.ok(hp(on.c, on.tou) < on.before.tou);
  assert.equal(hp(on.c, on.kolt), on.before.kolt, "攻击者自己不溅");
});

test("专长、义体也认同一个判断：打敌人的义体 / 专长（挑衅）开着友伤时能对队友用、不能对自己；关着在扣点之前拦下", () => {
  const { c, S, heroes: [kolt, helu] } = field(["kolt", "helu"], "FF428-CW");
  kolt.cyberware = [{ id: "strike_v1" }]; c.applyLevelStats(kolt);
  kolt.feats = ["provoke"];
  kolt.ap = 4; kolt.bonus = 4; kolt.shp = 10; kolt.zone = helu.zone = 1;
  assert.match(c.skillTargetError(kolt, "cw_strike_v1", helu) || "", /只能对敌人使用/, "关着：义体不能打队友");
  assert.match(c.skillTargetError(kolt, "feat_provoke", helu) || "", /只能对敌人使用/, "关着：挑衅不能对队友");
  ffOn(c);
  assert.equal(c.skillTargetError(kolt, "cw_strike_v1", helu), null, "开着：义体能打队友");
  assert.equal(c.skillTargetError(kolt, "feat_provoke", helu), null, "开着：挑衅能对队友");
  assert.match(c.skillTargetError(kolt, "feat_provoke", kolt) || "", /只能对敌人使用/, "不能对自己");
  S.attackerId = kolt.id; S.targetId = helu.id;
  const hp0 = c.totalHp(helu);
  c.runSkill("cw_strike_v1");
  assert.ok(c.totalHp(helu) < hp0, "义体的一击打到队友");
  S.attackerId = kolt.id; S.targetId = helu.id;
  helu.tauntTo = null;
  c.runSkill("feat_provoke");
  assert.equal(helu.tauntTo, kolt.id, "挑衅挂到队友身上");
});

test("每人各自一个开关：A 开、B 没开——只有 A 的角色（含武器人）的攻击打得到队友；不能改别人的开关", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "FF428-HOTSEAT" });
  c.location = { search: "?hotseat=1" }; c.URLSearchParams = URLSearchParams;
  c.document = { getElementById() { return null; } };
  c.setInterval = () => 1;
  c.setTimeout = () => 1;
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, undo: [], disarm() {}, refresh() {} };
  for (const file of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "hotseat-game.js"]) {
    vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file });
  }
  const S = c.S.state, kolt = c.findKit("kolt", S.units), helu = c.findKit("helu", S.units);
  const players = [{ id: "p1", name: "主持人", gm: true }, { id: "p2", name: "玩家 2" }];
  assert.deepEqual(plain(c.HotseatGame.configure({ mode: "trpg", players, assignments: { [kolt.id]: "p1", [helu.id]: "p2" } })), { ok: true });
  const send = (id, command) => { c.HotseatGame.switchPlayer(id); return c.HotseatGame.submit(command); };
  assert.equal(send("p1", { type: "startCombat" }).ok, true);
  c.HotseatGame.beginRound();
  assert.equal(send("p1", { type: "orderPick", actor: kolt.id, index: 0 }).ok, true);
  assert.equal(send("p2", { type: "orderPick", actor: helu.id, index: 1 }).ok, true);
  assert.equal(send("p1", { type: "orderConfirm" }).ok, true);
  assert.equal(send("p2", { type: "orderConfirm" }).ok, true);
  // B（p2）开自己的；想改 A（p1）的被拒
  const bad = send("p2", { type: "battle.friendlyFire", on: true, owner: "p1" });
  assert.equal(bad.ok, false); assert.match(bad.error, /只能改自己的友伤开关/);
  assert.equal(send("p2", { type: "battle.friendlyFire", on: true }).ok, true);
  assert.deepEqual(plain(S.friendlyFire), { p2: true }, "记在发指令的人名下");
  assert.equal(c.friendlyFireOn(helu), true, "p2 的赫鲁米卡开着");
  assert.equal(c.friendlyFireOn(kolt), false, "p1 的柯尔特没开");
  assert.equal(c.attackFoe(helu, kolt), true);
  assert.equal(c.attackFoe(kolt, helu), false);
  // 校验（联机 / 热座出手前）：p1 的柯尔特打赫鲁米卡被拒；p2 的赫鲁米卡打柯尔特可以
  kolt.zone = 1; helu.zone = 2;
  const game = { depth: 0, tape: null };
  const session = { assertAction: () => true };
  assert.throws(() => c.HotseatValidation.validateBattle({ type: "skill", actor: kolt.id, skill: "kolt_aa", target: helu.id, picks: {} }, { session, sender: "p1", game }), /这一方的目标|射程/);
  kolt.resources.bit = "acid";   // 酸液炮：距离 1
  assert.throws(() => c.HotseatValidation.validateBattle({ type: "skill", actor: kolt.id, skill: "kolt_aa", target: helu.id, picks: {} }, { session, sender: "p1", game }), /这一方的目标/);
  assert.doesNotThrow(() => c.HotseatValidation.validateBattle({ type: "skill", actor: helu.id, skill: "helu_aa", target: kolt.id, picks: {} }, { session, sender: "p2", game }));
  assert.throws(() => c.HotseatValidation.validateBattle({ type: "skill", actor: helu.id, skill: "helu_aa", target: helu.id, picks: {} }, { session, sender: "p2", game }), /这一方的目标|射程/, "不能选自己");
  // 武器人跟着持有者：赫鲁米卡的 Ecmo 归 p2，开着
  const ecmo = c.spawnWeapon(helu, "ecmo");
  assert.ok(ecmo, "Ecmo 上场");
  assert.equal(c.friendlyFireOn(ecmo), true, "武器人跟着持有者的开关");
  assert.equal(c.attackFoe(ecmo, kolt), true);
  // 角色转交给 p1（开关跟着人走，不跟着角色）：赫鲁米卡归 p1 之后就打不到队友了
  c.HotseatGame.transferHero(helu.id, "p1");
  assert.equal(c.friendlyFireOn(helu), false);
  // A 也开：两边都能打
  assert.equal(send("p1", { type: "battle.friendlyFire", on: true }).ok, true);
  assert.deepEqual(plain(S.friendlyFire), { p1: true, p2: true });
  assert.equal(c.attackFoe(kolt, helu), true);
});

test("队友能协助格挡开着友伤的那一击（打的人自己不算能格挡的人）；格挡成功不扣血，格挡不计分数", () => {
  const { c, S, heroes: [kolt, helu, tou] } = field(["kolt", "helu", "tou"], "FF428-BLOCK");
  ffOn(c);
  const before = hp(c, helu);
  const out = strike(c, kolt, helu);
  assert.equal(out.pending, true, "这一击等队友协助格挡");
  const job = S.blockQueue[0];
  assert.equal(job.attackerId, kolt.id); assert.equal(job.targetId, helu.id);
  assert.equal(job.opt.flags.friendlyFire, true, "这一击记着是友伤");
  const helpers = c.eligibleBlockers(helu, job).map(u => u.id);
  assert.ok(helpers.includes(tou.id), "同区的另一个队友能协助格挡");
  assert.ok(!helpers.includes(kolt.id), "打的人自己不能格挡自己的攻击");
  assert.ok(!helpers.includes(helu.id), "被打的人照旧不能给自己格挡（和敌人打过来一样）");
  const parts0 = plain(S.battleScore.parts);
  c.finishBlock(tou.id, { roll: 1, ok: true });
  assert.equal(S.blockQueue.length, 0);
  assert.equal(hp(c, helu), before, "协助格挡成功：被打的队友不扣血");
  assert.equal(tou.bonus, 3, "格挡照常花掉 1 附赠行动");
  const parts1 = plain(S.battleScore.parts);
  assert.equal(parts1.block || 0, parts0.block || 0, "挡下友伤不加格挡分");
  assert.equal(parts1.blockSave || 0, parts0.blockSave || 0, "也不加格挡减免分");
  const st = c.battleStat(tou);
  assert.equal(st.blocks || 0, 0, "也不记格挡次数");
  assert.equal(st.avoided || 0, 0);
  // 没人挡：照常落下
  const out2 = strike(c, kolt, helu);
  assert.equal(out2.pending, true);
  c.finishBlock(null);
  assert.ok(hp(c, helu) < before, "不挡就照常受伤");
  // 关着友伤：队友之间的这一下照旧直接结算（不进格挡队列，以前就是这样）
  const g = field(["kolt", "helu", "tou"], "FF428-BLOCK-OFF");
  const r = strike(g.c, g.heroes[0], g.heroes[1]);
  assert.ok(!r.pending); assert.equal((g.S.blockQueue || []).length, 0);
});

test("打队友和打敌人一样触发被动：柯尔特「过度自信」的嘲讽照样挂上；打进失衡照常失衡（由敌人接协助攻击）", () => {
  const { c, S, heroes: [kolt, helu] } = field(["kolt", "helu"], "FF428-PASSIVE");
  ffOn(c);
  // 只剩两个人：没有别人能协助格挡，这一击直接结算
  const out = strike(c, kolt, helu);
  assert.ok(!out.pending);
  assert.equal(helu.tauntTo, kolt.id, "被柯尔特打到的队友被嘲讽（过度自信，命中时触发）");
  helu.def = 1;
  strike(c, kolt, helu, { atk: 1, baseBreak: 2 });
  assert.equal(helu.stunned, true, "打进失衡");
  const job = (S.assistQueue || []).find(j => j.targetId === helu.id);
  assert.ok(job && job.vsPlayer, "失衡以后和平时我方失衡一样：由敌人接协助攻击");
});

test("不计分数：打队友的伤害、击破、打倒都不进评分和战场数据；打敌人照常记", () => {
  const { c, S, heroes: [kolt, helu], foe } = field(["kolt", "helu"], "FF428-SCORE");
  ffOn(c);
  const parts0 = plain(S.battleScore.parts);
  strike(c, kolt, helu, { atk: 5, baseBreak: 1 });
  assert.deepEqual(plain(S.battleScore.parts).dmg || 0, parts0.dmg || 0, "伤害分不变");
  assert.deepEqual(plain(S.battleScore.parts).brk || 0, parts0.brk || 0, "击破分不变");
  const sk = c.battleStat(kolt), sh = c.battleStat(helu);
  assert.equal(sk.dmg, 0); assert.equal(sk.brk, 0);
  assert.equal(sh.taken, 0, "被打的队友：承受伤害不记");
  assert.ok(!S.battleScore.hurt, "不丢「无伤」奖励");
  // 打倒队友：照常濒死，不记倒地次数、不算击杀
  helu.layers.forEach(l => { l.current = 1; });
  strike(c, kolt, helu, { atk: 999 });
  assert.equal(helu.dying, true, "照常进濒死");
  assert.equal(sh.downs || 0, 0, "倒地次数不记");
  assert.equal(sk.kills || 0, 0, "不算击杀");
  assert.ok(!S.battleScore.hurt);
  // 打敌人照常记分
  strike(c, kolt, foe, { atk: 20 });
  assert.ok(sk.dmg > 0, "打敌人照常记伤害");
  assert.ok((S.battleScore.parts.dmg || 0) > (parts0.dmg || 0));
});

test("敌人不受影响：开着友伤时敌人的敌我判断、范围、AI 全部照旧；同一种子整场自动对打和关着时一模一样", () => {
  const { c, heroes: [kolt], foe } = field(["kolt", "helu"], "FF428-FOES");
  ffOn(c);
  const S = c.S.state;
  const foe2 = c.spawnEnemyGroup("thug_hammer", 1, 2, 1)[0];
  S.units.push(foe2);
  assert.equal(c.friendlyFireOn(foe), false, "敌人没有友伤");
  assert.equal(c.attackFoe(foe, foe2), false, "敌人打不到同伙");
  assert.equal(c.attackFoe(foe, kolt), true);
  assert.ok(!c.enemiesOf(foe).some(u => !u.isPlayer), "敌人的「敌人」名单里没有同伙");
  const sim = on => {
    const s = H.load();
    s.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 2, zone: 2 }, { id: "thug_hammer", lv: 2, zone: 2 }], seed: "FF428-SIM" });
    if (on) s.Commands.dispatch({ type: "battle.friendlyFire", on: true });
    const r = s.BattleSim.run({ maxRounds: 25 });
    const log = s.S.state.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
    return { r: plain(r), log };
  };
  const off = sim(false), on = sim(true);
  assert.deepEqual(on.r, off.r, "结果一样");
  assert.equal(on.log, off.log, "整场记录一样（敌人的行动没变）");
});

/** 带上战斗画面（game.js）和房主的动作菜单（online-actions.js）：选目标的名单、悬停预演、联机玩家拿到的名单都走真的代码 */
function menuField() {
  const { Hotseat } = require("../hotseat");
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "hiaki", "tou"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], zoneMode: 3, seed: "FF428-MENU" });
  c.startCombat();
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  for (const file of ["game.js", "hotseat-validation.js", "online-view.js", "online-actions.js"]) vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file });
  const S = c.S.state, ruby = c.findKit("ruby", S.units), hiaki = c.findKit("hiaki", S.units), tou = c.findKit("tou", S.units), foe = S.units.find(u => !u.isPlayer);
  // 瑞比在 1 区；绯秋、灯和狂徒在 2 区（普通攻击打距离 1）。灯有附赠：打绯秋那一下要等灯协助格挡（预演按没人挡落下）
  ruby.zone = 1; hiaki.zone = 2; tou.zone = 2; foe.zone = 2;
  [ruby, hiaki, tou].forEach(u => { u.ap = u.apMax = 4; u.bonus = u.bonusMax = 4; });
  const session = Hotseat.create({ operators: ["p1", "p2"], gmId: "p1", assignments: { [ruby.id]: "p1", [hiaki.id]: "p2", [tou.id]: "p2" }, getUnits: () => S.units, canStand: u => !c.standUpBlocked(u) });
  session.beginRound(1); session.pick("p1", ruby.id, 0); session.pick("p2", hiaki.id, 1); session.pick("p2", tou.id, 2); session.forceStart("p1");
  const service = c.OnlineActions.create({ game: c.GAME, validation: c.HotseatValidation, inspect: c.HotseatValidation.inspect,
    assertAction: (sender, id) => session.assertAction(sender, id), getState: () => S });
  const menu = (request = {}) => plain(service.menu({ requestId: 1, actor: ruby.id, ...request }, "p1"));
  return { c, S, ruby, hiaki, tou, foe, menu };
}

test("选目标：本机的名单、悬停预演、联机房主给玩家的名单都能选中 / 预演队友，不能选自己；关着照旧", () => {
  const { c, S, ruby, hiaki, tou, foe, menu } = menuField();
  const aa = c.GAME.gameSkills(ruby).find(s => s.id === "ruby_aa");
  const ids = () => plain(c.GAME.candidateUnits(ruby, aa).map(u => u.id));
  // 关着：只有敌人
  assert.deepEqual(ids().filter(id => id !== foe.id), [], "关着：普通攻击只能选敌人");
  assert.ok(!menu({ skill: "ruby_aa" }).choices.options.some(o => o.value === hiaki.id), "关着：联机名单里没有队友");
  // 开着：距离 1 的队友也能选，自己不能
  c.Commands.dispatch({ type: "battle.friendlyFire", on: true });
  assert.ok(ids().includes(hiaki.id) && ids().includes(tou.id), "开着：距离 1 的队友能选");
  assert.ok(!ids().includes(ruby.id), "不能选自己");
  // 悬停预演：打队友那一下要等灯协助格挡，预演按没人挡落下——看得到伤害，是有效的目标
  const blocked0 = (S.blockQueue || []).length;
  const pv = c.GAME.previewOf(c.GAME.skillThunk(ruby.id, "ruby_aa", hiaki.id, {}));
  assert.equal(pv.meaningful, true, "预演有效");
  assert.ok(pv.units.get(hiaki.id).dmgHi > 0, "预演里看得到打到队友的伤害");
  assert.equal((S.blockQueue || []).length, blocked0, "预演不留下格挡队列");
  // 联机：房主给玩家的名单里有队友（按瑞比的操控者开没开），可以直接出手
  const opts = menu({ skill: "ruby_aa" }).choices.options.map(o => o.value);
  assert.ok(opts.includes(hiaki.id) && opts.includes(foe.id), "联机名单列出队友和敌人");
  assert.ok(!opts.includes(ruby.id));
  const ready = menu({ skill: "ruby_aa", target: hiaki.id });
  assert.equal(ready.choices.kind, "ready");
  assert.equal(ready.choices.command.target, hiaki.id);
  // 真的打出去：等灯协助格挡（格挡队列），没人挡就落下。预演会把局面换成拷贝，单位按 id 重新取
  const live = u => c.unitById(u.id);
  const before = c.totalHp(live(hiaki));
  c.Commands.dispatch(ready.choices.command);
  assert.ok((S.blockQueue || []).length > 0, "打队友：同区的灯可以协助格挡");
  c.BattleSim.resolveQueues({ pickBlocker: () => null, pickAssister: () => null });
  assert.ok(c.totalHp(live(hiaki)) < before, "没人挡：照常受伤");
  // 范围技能的悬停预演（不用选目标）：同区的队友也标出来
  live(hiaki).resources.stance = "iai";
  const flash = c.GAME.previewOf(c.GAME.skillThunk(hiaki.id, "hiaki_flash", null, {}));
  assert.ok(flash.units.get(tou.id).dmgHi > 0, "一闪的预演：同区的灯也挨");
  assert.ok(!(flash.units.get(hiaki.id).dmgHi > 0), "施放者自己不挨");
});

test("联机：开关状态经 online-view.js 白名单发给玩家（只有开关）；坚毅数值照旧不发", () => {
  const unit = { id: "u1", kit: "ruby", name: "瑞比", isPlayer: true, zone: 1, layers: [{ type: "flesh", current: 9, max: 30 }], shp: 732911, shpMax: 827319 };
  const state = { units: [unit], combatStarted: true, combatPhase: "player", turnNo: 2, zoneMode: 2,
    friendlyFire: { p1: true, p2: false, host: false, "bad key!": true, p3: "yes", shp: true } };
  const out = V.projectState(state, { recipientId: "p2", gmId: "host" });
  assert.deepEqual(plain(out.friendlyFire), { p1: true, p2: false, host: false }, "每个人开没开都看得到；乱写的键 / 值不发");
  const wire = JSON.stringify(out).replace(/"upOnShp":(true|false)/g, "");
  assert.doesNotMatch(wire, /732911|827319|shp/i, "坚毅数值不发");
  const packet = V.projectPacket({ type: "result", protocol: 1, build: "x", seq: 1, screen: "battle", state, view: { players: [] } }, { recipientId: "p2", gmId: "host" });
  assert.deepEqual(plain(packet.state.friendlyFire), { p1: true, p2: false, host: false }, "整包投影也带着");
  // 主持人（房主）收到的是整份（自己的数据），照旧
  assert.equal(V.projectPacket({ type: "result", state, view: {} }, { recipientId: "host", gmId: "host" }).state.friendlyFire.p1, true);
});

test("指令：battle.friendlyFire 只收 true / false，owner 只收非空字符串；本机不填 owner 就是本机那一个", () => {
  const { c, S } = field(["kolt", "helu"], "FF428-CMD");
  assert.throws(() => c.Commands.dispatch({ type: "battle.friendlyFire", on: "yes" }), /boolean/);
  assert.throws(() => c.Commands.dispatch({ type: "battle.friendlyFire", on: true, owner: "" }), /owner/);
  const r = c.Commands.dispatch({ type: "battle.friendlyFire", on: true });
  assert.deepEqual(plain(r), { owner: "local", on: true });
  assert.deepEqual(plain(S.friendlyFire), { local: true });
  c.Commands.dispatch({ type: "battle.friendlyFire", on: false });
  assert.deepEqual(plain(S.friendlyFire), { local: false });
  assert.equal(c.friendlyFireSetting(), false);
});
