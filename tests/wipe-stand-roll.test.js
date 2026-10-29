// 全员倒地还能起身时先问再判负、起身可以免费翻滚到相邻的区（#470，作者 10/29 定的通用规则，所有模式都适用）。
// 规则在 app.js · heroStillFighting / wipeStandCandidates / queueWipeStand / answerWipeStand / settleWipeTeam（全员倒地），
// standRollBlocked / standRollZones / standRoll / standUp(u, dest)（起身翻滚）；接线见 battle-commands.js（standUp 的 dest、
// battle.standCheck、standAnswer）、sim.js（BattleSim.standCheck、policy.standAsk）、game.js（回合结束前 standCheck、起身按钮）、
// hotseat-validation.js、online-actions.js、online-ui.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const { Hotseat } = require("../hotseat");
const plain = v => JSON.parse(JSON.stringify(v));
const logText = c => c.S.state.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
const ids = list => plain(list.map(u => u.id));

/** 柯尔特、赫鲁米卡站在 1 区（三区直排），狂徒（匕首：会借机攻击离开它那一区的人）在 3 区，血厚、架势高（打不死、打不进失衡）。
 *  opt.party / enemies / before(c)：换队伍、敌人，布置完开战前调用 */
function field(opt = {}) {
  const c = H.load();
  const party = opt.party || ["kolt", "helu"];
  c.BattleSim.setup({ party, enemies: opt.enemies || [{ id: "thug_knife", lv: 1, zone: 3 }], zoneMode: 3, seed: opt.seed || "WIPE470",
    before: opt.before ? () => opt.before(c) : undefined });
  const S = c.S.state;
  const heroes = party.map(k => c.findKit(k, S.units));
  const foes = S.units.filter(u => !u.isPlayer);
  foes.forEach(f => { f.layers = [{ type: "flesh", current: 500, max: 500 }]; f.def = f.defMax = 30; });
  c.startCombat();
  return { c, S, heroes, foe: foes[0], foes };
}
/** 打到濒死：最内层归零，走倒地统一结算 */
function down(c, u) {
  (u.layers || []).forEach(l => { l.current = 0; });
  c.applyKnockdown(u, []);
  assert.equal(u.dying, true, u.name + " 倒地");
}
const decline = () => ({ standAsk: () => ({ stand: false }) });

/* ===== 第 1 条：全员倒地但还有人能起身时，不立刻失败 ===== */

test("全员倒地、还有人能起身：不立刻判负（多人模式以前立刻判负），回合结束前依次排上每个能起身的人", () => {
  const { c, S, heroes: [kolt, helu] } = field();
  down(c, kolt);
  assert.equal(c.BattleSim.outcome(), null, "还有人站着");
  down(c, helu);
  assert.ok(kolt.shp > 0 && helu.shp > 0, "坚毅生命没耗尽");
  assert.equal(c.heroStillFighting(helu), true, "倒地还能起身：先不算倒下");
  assert.equal(c.BattleSim.outcome(), null, "全员倒地但还有人能起身：不立刻判负");
  assert.deepEqual(plain(c.wipeStandCandidates()), [{ unitId: kolt.id, team: "" }, { unitId: helu.id, team: "" }]);
  // 回合结束前（battle.standCheck）排进 state.standQueue，写一句；已经在排的不重复排
  assert.equal(c.Commands.dispatch({ type: "battle.standCheck" }), 2);
  assert.deepEqual(plain(S.standQueue.map(j => j.unitId)), [kolt.id, helu.id]);
  assert.equal(c.Commands.dispatch({ type: "battle.standCheck" }), 2, "不重复排");
  assert.match(logText(c), /队伍全员倒地，但还有人能起身：回合结束前问 柯尔特、Helumica 要不要起身，都不起身才算输/);
  // 还有人站着时不问
  const g = field();
  down(g.c, g.heroes[0]);
  assert.equal(g.c.Commands.dispatch({ type: "battle.standCheck" }), 0);
  assert.deepEqual(plain(g.c.wipeStandCandidates()), []);
});

test("问了都不起身才判负；没人能起身（坚毅耗尽 / 力竭）照旧立刻判负、不问；能起身的才问", () => {
  const { c, S, heroes: [kolt, helu] } = field();
  down(c, kolt); down(c, helu);
  const asked = [];
  c.BattleSim.standCheck({ standAsk: u => { asked.push(u.id); return { stand: false }; } });
  assert.deepEqual(asked, [kolt.id, helu.id], "依次问每个能起身的人");
  assert.equal(c.BattleSim.outcome(), "enemy", "都不起身：判负");
  assert.equal(kolt.standGaveUp, true); assert.equal(helu.standGaveUp, true);
  assert.deepEqual(plain(S.standQueue), []);
  assert.match(logText(c), /柯尔特 没有起身。/);
  assert.match(logText(c), /队伍没有人起身：全员倒地，战斗失败。/);
  // 指令一个一个回答也一样
  {
    const f = field();
    f.heroes.forEach(h => down(f.c, h));
    f.c.Commands.dispatch({ type: "battle.standCheck" });
    f.c.Commands.dispatch({ type: "standAnswer", actor: f.heroes[0].id, stand: false });
    assert.equal(f.c.BattleSim.outcome(), null, "还有人没问");
    f.c.Commands.dispatch({ type: "standAnswer", actor: f.heroes[1].id, stand: false });
    assert.equal(f.c.BattleSim.outcome(), "enemy");
  }
  // 没人能起身：坚毅耗尽 / 力竭，立刻判负（和以前一样），不问
  for (const why of ["shp", "exhaust"]) {
    const f = field();
    if (why === "shp") f.heroes.forEach(h => { h.shp = 0; }); else f.S.exhaustTier = 1;
    f.heroes.forEach(h => down(f.c, h));
    assert.equal(f.c.BattleSim.outcome(), "enemy", why + "：没人能起身就判负");
    assert.deepEqual(plain(f.c.wipeStandCandidates()), [], why);
  }
  // 一个能起身、一个不能：只问能起身的那个
  const g = field();
  g.heroes[1].shp = 0;
  g.heroes.forEach(h => down(g.c, h));
  assert.equal(g.c.BattleSim.outcome(), null);
  assert.deepEqual(plain(g.c.wipeStandCandidates().map(j => j.unitId)), [g.heroes[0].id]);
});

test("起身一个战斗就继续：其他人不起身也不判负、不记「放弃」，之后自己的回合照样能点起身；整队再倒下还会再问", () => {
  const { c, S, heroes: [kolt, helu] } = field();
  down(c, kolt); down(c, helu);
  c.BattleSim.standCheck({ standAsk: u => ({ stand: u === helu }) });
  assert.equal(c.BattleSim.outcome(), null, "赫鲁米卡起身：战斗继续");
  assert.equal(helu.upOnShp, true); assert.equal(helu.dying, false);
  assert.equal(kolt.dying, true, "柯尔特没起身，还倒着");
  assert.ok(!kolt.standGaveUp && !helu.standGaveUp, "队伍里有人起身：不记「放弃」");
  assert.match(logText(c), /Helumica 起身继续战斗/);
  // 赫鲁米卡又倒下（起身后坚毅生命打光就死了，这里直接算倒地）：柯尔特还能起身，又是全员倒地，回合结束前再问他
  helu.upOnShp = false; helu.dying = true;
  assert.equal(c.BattleSim.outcome(), null);
  assert.ok(c.wipeStandCandidates().some(j => j.unitId === kolt.id), "再问柯尔特");
  // 自己的回合点「起身」照旧
  c.standUp(kolt);
  assert.equal(kolt.upOnShp, true);
  assert.equal(c.BattleSim.outcome(), null);
  assert.deepEqual(plain(S.standQueue), []);
});

test("武器人、护送对象不算：它们还站着也算全员倒地，也不问它们", () => {
  const { c, S, heroes: [tou, helu] } = field({ party: ["tou", "helu"], before: c => c.spawnEscort({ kind: "cart" }, 2, null) });
  c.Commands.dispatch({ type: "skill", actor: tou.id, skill: "tou_summon" });
  const mochi = c.findKit("mochi", S.units), cart = c.fieldEscort();
  assert.ok(mochi && !mochi.hidden && !mochi.dying, "年糕站在场上");
  assert.ok(cart && !cart.dead, "货车还在");
  down(c, tou); down(c, helu);
  assert.equal(c.BattleSim.outcome(), null, "还能起身：先不判负");
  assert.deepEqual(plain(c.wipeStandCandidates().map(j => j.unitId)), [tou.id, helu.id], "只问角色");
  c.BattleSim.standCheck(decline());
  assert.equal(c.BattleSim.outcome(), "enemy", "武器人、货车还站着也照样判负");
});

test("整场自动对打（BattleSim.run）：全员倒地时回合结束前问（policy.standAsk）——都不起身第 1 回合就输，起身就接着打", () => {
  for (const stand of [false, true]) {
    const { c, S, heroes } = field({ seed: "WIPE470-RUN" });
    heroes.forEach(h => down(c, h));
    const r = plain(c.BattleSim.run({ maxRounds: 1, policy: { act: () => null, standAsk: () => ({ stand }) } }));
    if (!stand) {
      assert.equal(r.winner, "enemy");
      assert.equal(r.rounds, 1, "第 1 回合结束前问完就判负，不进第 2 回合");
      assert.match(logText(c), /队伍没有人起身/);
    } else {
      assert.notEqual(r.winner, "enemy", "起身了：没输");
      assert.ok(heroes.every(h => h.upOnShp), "都起身了");
      assert.equal(S.turnNo, 2, "第 1 回合结束才问，问完进第 2 回合");
    }
  }
  // 默认打法：回合结束前问到就原地起身
  const { c, heroes } = field({ seed: "WIPE470-RUN2" });
  heroes.forEach(h => down(c, h));
  c.BattleSim.standCheck(c.BattleSim.BASIC_POLICY);
  assert.ok(heroes.every(h => h.upOnShp && Number(h.zone) === 1));
});

test("单人模式也一样：主角倒地还能起身不算输，回合结束前问；不起身就输（起不来才算死亡，照旧）", () => {
  // 和 tests/solo.test.js 一样开单人局、走 battleSpec 摆战斗
  const c = H.load();
  const run = c.Rogue.newRun({ party: ["ruby"], partners: ["kolt", "yuito", "tou"], role2: "生存", solo: true, seed: "WIPE470-SOLO" });
  c.Rogue.acceptTask(run, "main");
  run.task.nodes[run.task.index] = { type: "battle", done: false };
  const spec = c.Rogue.battleSpec(run);
  delete spec.encounter; spec.enemies = [{ id: "thug_knife", lv: 1, zone: 2 }];
  c.BattleSim.setup(spec); c.startCombat();
  const ruby = c.findKit("ruby", c.S.state.units);
  assert.ok(c.isSoloHero(ruby));
  down(c, ruby);
  assert.equal(c.BattleSim.outcome(), null, "还能起身：不算输");
  assert.deepEqual(plain(c.wipeStandCandidates().map(j => j.unitId)), [ruby.id]);
  c.BattleSim.standCheck(decline());
  assert.equal(c.BattleSim.outcome(), "enemy", "不起身：这场输了");
  assert.equal(ruby.dead, false, "不起身只是输了这场，不是死亡（起不来才算死亡）");
});

/* ===== PvP：按阵营分别看 ===== */

test("PvP：一个阵营全员倒地但还有人能起身，不立刻判它出局；回合结束前只问这个阵营的人，都不起身才出局、对面获胜", () => {
  const setup = () => {
    const c = H.load();
    c.BattleSim.setup({ party: ["kolt", "helu", "hiaki", "tou"], enemies: [{ id: "thug_knife", lv: 1, zone: 3 }], zoneMode: 3, seed: "WIPE470-PVP" });
    const S = c.S.state;
    const heroes = ["kolt", "helu", "hiaki", "tou"].map(k => c.findKit(k, S.units));
    heroes.slice(2).forEach(h => c.Commands.dispatch({ type: "battle.playerFaction", faction: "乙", unit: h.id }));
    c.startCombat();
    S.units.filter(u => !u.isPlayer).forEach(u => { u.dead = true; });   // 只剩两个玩家阵营对打
    return { c, S, heroes };
  };
  {
    const { c, S, heroes: [kolt, helu, hiaki, tou] } = setup();
    assert.equal(c.pvpSplit(), true);
    down(c, kolt);   // 我方倒一个：赫鲁米卡还站着
    down(c, hiaki); down(c, tou);
    assert.deepEqual(plain(c.pvpBattleOutcome()), { winners: [], wiped: false, over: false }, "乙全员倒地但还能起身：不立刻判它出局（以前我方立刻获胜）");
    assert.equal(c.BattleSim.outcome(), null);
    assert.deepEqual(plain(c.wipeStandCandidates()), [{ unitId: hiaki.id, team: "乙" }, { unitId: tou.id, team: "乙" }], "只问乙的人（我方还有人站着，不问柯尔特）");
    const asked = [];
    c.BattleSim.standCheck({ standAsk: u => { asked.push(u.id); return { stand: false }; } });
    assert.deepEqual(asked, [hiaki.id, tou.id]);
    assert.deepEqual(plain(c.pvpBattleOutcome().winners), ["我方"], "乙都不起身：出局，我方获胜");
    assert.equal(c.BattleSim.outcome(), "player");
    assert.match(logText(c), /乙全员倒地，但还有人能起身：回合结束前问 绯秋、灯 要不要起身，都不起身才算这个阵营出局/);
    assert.match(logText(c), /乙没有人起身：这个阵营出局。/);
    assert.ok(!kolt.standGaveUp && !helu.standGaveUp, "我方的人没记");
    assert.deepEqual(plain(S.standQueue), []);
  }
  {
    // 乙有一个人起身：接着打
    const { c, heroes: [, , hiaki, tou] } = setup();
    down(c, hiaki); down(c, tou);
    c.BattleSim.standCheck({ standAsk: u => ({ stand: u === tou }) });
    assert.deepEqual(plain(c.pvpBattleOutcome()), { winners: [], wiped: false, over: false });
    assert.equal(tou.upOnShp, true);
  }
  {
    // 两个阵营同时全员倒地：两边都问；都不起身才算所有玩家阵营都倒下（敌人赢）
    const { c, heroes } = setup();
    heroes.forEach(h => down(c, h));
    assert.equal(c.BattleSim.outcome(), null);
    assert.deepEqual(plain(c.wipeStandCandidates().map(j => j.team)).sort(), ["乙", "乙", "我方", "我方"].sort(), "两个阵营的人都问");
    c.BattleSim.standCheck(decline());
    assert.equal(plain(c.pvpBattleOutcome()).wiped, true);
    assert.equal(c.BattleSim.outcome(), "enemy");
  }
});

/* ===== 第 2 条：起身时可以免费翻滚到相邻区域 ===== */

test("起身并翻滚：不花行动点 / 附赠，翻滚不触发借机攻击（照常走出去会被借机攻击）", () => {
  const { c, S, heroes: [kolt, helu], foe } = field();
  foe.zone = 1;   // 狂徒（匕首）在 1 区：离开 1 区的人挨借机攻击
  down(c, kolt);
  assert.deepEqual(plain(c.standRollZones(kolt)), [2]);
  const ap = kolt.ap, bonus = kolt.bonus, shp = kolt.shp;
  c.Commands.dispatch({ type: "standUp", actor: kolt.id, dest: 2 });
  assert.equal(kolt.upOnShp, true); assert.equal(kolt.dying, false);
  assert.equal(Number(kolt.zone), 2, "翻到 2 区");
  assert.equal(kolt.ap, ap); assert.equal(kolt.bonus, bonus, "不花行动点 / 附赠");
  assert.equal(kolt.shp, shp, "没挨借机攻击");
  assert.doesNotMatch(logText(c), /借机攻击/);
  assert.match(logText(c), /柯尔特 翻滚：1 区 → 2 区（免费，不触发反应，不受场地影响）。/);
  // 对照：起身以后照常走出 1 区，被借机攻击
  down(c, helu); c.standUp(helu);
  S.attackerId = helu.id;
  c.doMove(helu, 2);
  assert.match(logText(c), /对离开区域的 Helumica 发动借机攻击/);
});

test("翻滚不触发警戒、紧追（照常走进去 / 走开会触发）", () => {
  // 警戒：柯尔特开着友伤、带警戒站在 2 区，队友走进来挨一下；翻滚进来不触发
  const alert = roll => {
    const { c, S, heroes: [kolt, helu] } = field({ seed: "WIPE470-ALERT" });
    c.Commands.dispatch({ type: "battle.friendlyFire", on: true });
    kolt.feats = ["alert"]; kolt.zone = 2; kolt.bonus = 1;
    if (roll) { down(c, helu); c.standUp(helu, 2); } else { S.attackerId = helu.id; c.doMove(helu, 2); }
    assert.equal(Number(helu.zone), 2);
    return kolt.bonus;
  };
  assert.equal(alert(false), 0, "对照：走进来触发警戒");
  assert.equal(alert(true), 1, "翻滚进来：不触发警戒");
  // 紧追：被紧追的人移动后，施加紧追的一方跟过去；翻滚不跟
  const chase = roll => {
    const { c, S, heroes: [kolt], foe } = field({ seed: "WIPE470-CHASE" });
    kolt.statuses.chase = true; kolt.chasers = [foe.id];
    if (roll) { down(c, kolt); kolt.statuses.chase = true; c.standUp(kolt, 2); } else { S.attackerId = kolt.id; c.doMove(kolt, 2); }
    assert.equal(Number(kolt.zone), 2);
    return Number(foe.zone);
  };
  assert.equal(chase(false), 2, "对照：狂徒紧追跟到 2 区");
  assert.equal(chase(true), 3, "翻滚：不跟");
});

test("翻滚无视场地：离开酸液地面不扣行动点；离开 / 进入冻土不检定、不受击破；进流沙不下陷，陷 2 层也翻得出去；落地后照常在那一区", () => {
  {
    const { c, S, heroes: [kolt] } = field();
    S.fields[1].acid = true;
    down(c, kolt); kolt.ap = 0; kolt.bonus = 0;
    c.standUp(kolt, 2);
    assert.equal(Number(kolt.zone), 2, "没有行动点也翻得出酸液地面");
    assert.equal(kolt.ap, 0);
    assert.doesNotMatch(logText(c), /离开酸液地面/);
  }
  {
    const { c, S, heroes: [kolt, helu] } = field();
    S.fields[1].ice = true; S.fields[2].ice = true;
    c.Math.random = () => 0.999;   // 要检定的话会失败
    down(c, kolt); kolt.def = 3;
    c.standUp(kolt, 2);
    assert.equal(Number(kolt.zone), 2, "离开冻土不检定");
    assert.equal(kolt.def, 3, "进入冻土不受冰击破");
    assert.doesNotMatch(logText(c), /冻土/);
    // 对照：照常走进冻土受冰击破（1 区不是冻土，不用检定）
    S.fields[1].ice = false; helu.def = 3; S.attackerId = helu.id;
    c.doMove(helu, 2);
    assert.equal(Number(helu.zone), 2);
    assert.equal(helu.def, 2, "对照：走进冻土受 1 冰击破");
  }
  {
    const { c, S, heroes: [kolt, helu] } = field();
    S.fields[2].quicksand = true;
    down(c, kolt);
    c.standUp(kolt, 2);
    assert.equal(c.sinkOf(kolt), 0, "落进流沙不下陷");
    assert.equal(c.inQuicksand(kolt), true, "落地后照常在流沙那一区");
    S.attackerId = helu.id; c.doMove(helu, 2);
    assert.equal(c.sinkOf(helu), 1, "对照：走进流沙下陷 1");
  }
  {
    const { c, S, heroes: [kolt] } = field();
    S.fields[1].quicksand = true;
    down(c, kolt); kolt.sink = 2;
    assert.equal(c.sinkStuck(kolt), true, "陷 2 层：自己走不出去");
    assert.deepEqual(plain(c.standRollZones(kolt)), [2], "翻滚无视场地：翻得出去");
    c.standUp(kolt, 2);
    assert.equal(Number(kolt.zone), 2);
    assert.equal(c.sinkOf(kolt), 0, "离开流沙：下陷清零");
  }
});

test("走不过去的照旧不能翻：危墙、关着的门、空隙、深渊、隔一个区；被禁足 / 在车里也不能翻；站着的人不能借「起身」白翻", () => {
  const { c, S, heroes: [kolt] } = field();
  down(c, kolt);
  const why = dest => c.standRollBlocked(kolt, dest);
  assert.equal(why(2), null);
  S.gaps["1-2"] = Object.assign(c.emptyGap(), { type: "wall", hp: 10, maxHp: 10 });
  assert.match(why(2), /危墙/);
  assert.deepEqual(plain(c.standRollZones(kolt)), [], "翻不过去的区不列");
  c.standUp(kolt, 2);
  assert.equal(kolt.dying, true, "翻不过去：这次起身不做（界面只给能翻的区）");
  assert.equal(Number(kolt.zone), 1);
  assert.match(logText(c), /柯尔特 不能翻滚到 2 区：危墙挡住去路。/);
  S.gaps["1-2"] = Object.assign(c.emptyGap(), { type: "door", open: false });
  assert.match(why(2), /机关门/);
  S.gaps["1-2"].open = true;
  assert.equal(why(2), null, "门开着可以翻");
  S.gaps["1-2"] = Object.assign(c.emptyGap(), { type: "void" });
  assert.match(why(2), /空隙/, "空隙：和技能里的移动一样，地面单位过不去");
  S.gaps["1-2"] = c.emptyGap();
  S.fields[2].abyss = true;
  assert.match(why(2), /深渊/);
  S.fields[2].abyss = false;
  assert.match(why(3), /相邻/, "隔一个区不能翻");
  kolt.noMove = true; assert.match(why(2), /禁足/); kolt.noMove = false;
  kolt.vehId = "p999"; assert.match(why(2), /车里/); kolt.vehId = null;
  // 翻滚不改指令格式以外的东西：dest 要是区号
  assert.throws(() => c.Commands.dispatch({ type: "standUp", actor: kolt.id, dest: "2" }), /zone number/);
  // 起身以后（站着）不能再借「起身」翻滚
  c.standUp(kolt);
  assert.equal(kolt.upOnShp, true);
  assert.match(why(2), /倒地/);
  c.standUp(kolt, 2);
  assert.equal(Number(kolt.zone), 1, "站着的人点起身不会翻滚");
});

test("回合结束前问要不要起身时也能选翻滚；翻不过去就原地起身（不当成不起身）", () => {
  const { c, S, heroes: [kolt, helu], foe } = field();
  foe.zone = 1;
  down(c, kolt); down(c, helu);
  c.Commands.dispatch({ type: "battle.standCheck" });
  c.Commands.dispatch({ type: "standAnswer", actor: kolt.id, stand: true, dest: 2 });
  assert.equal(kolt.upOnShp, true); assert.equal(Number(kolt.zone), 2);
  assert.doesNotMatch(logText(c), /借机攻击/);
  S.gaps["1-2"] = Object.assign(c.emptyGap(), { type: "wall", hp: 10, maxHp: 10 });
  c.Commands.dispatch({ type: "standAnswer", actor: helu.id, stand: true, dest: 2 });
  assert.equal(helu.upOnShp, true, "翻不过去：原地起身");
  assert.equal(Number(helu.zone), 1);
  assert.match(logText(c), /Helumica 不能翻滚到 2 区（危墙挡住去路），原地起身。/);
  assert.equal(c.BattleSim.outcome(), null);
});

/* ===== 热座 / 联机 ===== */

/** 热座校验（hotseat-validation.js）：瑞比、绯秋各归一个操作者，轮到瑞比 */
function hotseatFixture() {
  const c = H.load();
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, "hotseat-validation.js"), "utf8"), c, { filename: "hotseat-validation.js" });
  c.BattleSim.setup({ party: ["ruby", "hiaki"], enemies: [{ id: "thug_knife", lv: 1, zone: 3 }], zoneMode: 3, seed: "WIPE470-HS" });
  c.startCombat();
  const s = c.S.state, a = c.findKit("ruby", s.units), b = c.findKit("hiaki", s.units);
  const session = Hotseat.create({ operators: ["a", "b"], gmId: "a", getUnits: () => s.units,
    canStand: u => !c.standUpBlocked(u), assignments: { [a.id]: "a", [b.id]: "b" } });
  session.beginRound(1); session.pick("a", a.id, 0); session.pick("b", b.id, 1); session.forceStart("a");
  const validate = command => c.HotseatValidation.validateBattle(command, { session, sender: "a" });
  return { c, s, a, b, validate };
}

test("热座：起身指令可以带 dest（起身并翻滚）；校验只放行翻得过去的相邻区，执行后在那一区、不花点", () => {
  const f = hotseatFixture();
  down(f.c, f.a);
  assert.equal(f.validate({ type: "standUp", actor: f.a.id }), true, "原地起身照旧");
  assert.equal(f.validate({ type: "standUp", actor: f.a.id, dest: 2 }), true);
  assert.throws(() => f.validate({ type: "standUp", actor: f.a.id, dest: 3 }), /相邻/);
  assert.throws(() => f.validate({ type: "standUp", actor: f.a.id, dest: 1.5 }), /翻滚区域/);
  f.s.gaps["1-2"] = Object.assign(f.c.emptyGap(), { type: "wall", hp: 10, maxHp: 10 });
  assert.throws(() => f.validate({ type: "standUp", actor: f.a.id, dest: 2 }), /危墙/);
  f.s.gaps["1-2"] = f.c.emptyGap();
  const ap = f.a.ap, bonus = f.a.bonus;
  f.c.Commands.dispatch({ type: "standUp", actor: f.a.id, dest: 2 });
  assert.equal(f.a.upOnShp, true); assert.equal(Number(f.a.zone), 2);
  assert.equal(f.a.ap, ap); assert.equal(f.a.bonus, bonus);
});

/** 联机房主的行动菜单（online-actions.js）：和 tests/online-actions.test.js 同一套布置 */
function onlineFixture() {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "hiaki"], enemies: [{ id: "thug_knife", lv: 1, zone: 3 }], zoneMode: 3, seed: "WIPE470-ONLINE" });
  c.startCombat();
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  for (const file of ["game.js", "hotseat-validation.js", "online-view.js", "online-actions.js"]) vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file });
  const state = c.S.state, actor = c.findKit("ruby", state.units), ally = c.findKit("hiaki", state.units);
  const session = Hotseat.create({ operators: ["p1", "p2"], gmId: "p1", assignments: { [actor.id]: "p1", [ally.id]: "p2" }, getUnits: () => state.units, canStand: u => !c.standUpBlocked(u) });
  session.beginRound(1); session.pick("p1", actor.id, 0); session.pick("p2", ally.id, 1); session.forceStart("p1");
  const service = c.OnlineActions.create({ game: c.GAME, validation: c.HotseatValidation, inspect: c.HotseatValidation.inspect,
    assertAction: (sender, id) => session.assertAction(sender, id), getState: () => state });
  const menu = (request = {}) => plain(c.OnlineView.projectActionMenu(service.menu({ requestId: 1, actor: actor.id, ...request }, "p1")));
  return { c, state, actor, ally, menu };
}

test("联机：起身菜单可以选「起身」或「起身并翻滚到 X 区」（只列翻得过去的区）；选了直接发起身指令，翻滚带 dest", () => {
  const f = onlineFixture();
  down(f.c, f.actor);
  const stand = f.menu({ skill: "__stand" });
  assert.equal(stand.choices.kind, "choice"); assert.equal(stand.choices.key, "dest");
  assert.deepEqual(stand.choices.options.map(o => [o.value, o.label]), [[0, "起身"], [2, "起身并翻滚到 2 区"]]);
  assert.deepEqual(f.menu({ skill: "__stand", dest: 0 }).choices.command, { type: "standUp", actor: f.actor.id }, "原地起身");
  assert.deepEqual(f.menu({ skill: "__stand", dest: 2 }).choices.command, { type: "standUp", actor: f.actor.id, dest: 2 });
  assert.throws(() => f.menu({ skill: "__stand", dest: 3 }), /相邻/);
  assert.equal(f.actor.dying, true, "菜单不改局面");
  // 翻不过去（危墙）：不用选，直接原地起身
  f.state.gaps["1-2"] = Object.assign(f.c.emptyGap(), { type: "wall", hp: 10, maxHp: 10 });
  assert.deepEqual(f.menu({ skill: "__stand" }).choices.command, { type: "standUp", actor: f.actor.id });
  assert.doesNotMatch(JSON.stringify(stand), /坚毅|shp/i);
});

test("联机 / 热座：回合结束前的询问（game.js · standAskOptions）有「起身」「起身并翻滚到 X 区」「不起身」，说明能原样发给玩家（不带坚毅字样）", () => {
  const f = onlineFixture();
  down(f.c, f.actor);
  const opts = plain(f.c.GAME.standAskOptions(f.actor, ""));
  assert.deepEqual(opts.map(o => o.label), ["起身", "起身并翻滚到 2 区", "不起身"]);
  assert.deepEqual(opts.map(o => o.value), [{ stand: true }, { stand: true, dest: 2 }, { stand: false }]);
  assert.equal(opts[0].label, "起身", "第一项是起身：联机玩家掉线 60 秒自动选第一项时不会把队伍判负");
  for (const o of opts) for (const text of [o.label, o.sub]) assert.equal(f.c.OnlineView.safeText(text), text, "能原样发给玩家：" + text);
  assert.match(plain(f.c.GAME.standAskOptions(f.actor, "乙")).pop().sub, /阵营/);
});

test("热座 / 联机：回合结束前问的是操控那个角色的玩家（分给玩家的问玩家），回答以后按选的起身 / 翻滚", async () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 3 }], zoneMode: 3, seed: "WIPE470-BRIDGE" });
  c.location = { search: "?hotseat=1" }; c.URLSearchParams = URLSearchParams;
  c.document = { getElementById() { return null; } };
  c.setInterval = () => 1; c.setTimeout = () => 1;
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, undo: [], disarm() {}, refresh() {} };
  for (const file of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "hotseat-game.js"]) vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file });
  const S = c.S.state, kolt = c.findKit("kolt", S.units), helu = c.findKit("helu", S.units);
  const players = [{ id: "p1", name: "主持人", gm: true }, { id: "p2", name: "玩家 2" }];
  assert.deepEqual(plain(c.HotseatGame.configure({ mode: "trpg", players, assignments: { [kolt.id]: "p1", [helu.id]: "p2" } })), { ok: true });
  c.HotseatGame.switchPlayer("p1");
  assert.equal(c.HotseatGame.submit({ type: "startCombat" }).ok, true);
  down(c, kolt); down(c, helu);
  assert.equal(c.HotseatGame.system({ type: "battle.standCheck" }), 2);
  // 和 game.js · resolveQueues 一样：问 helu 的操控者（玩家 2）
  const opts = [{ label: "起身", value: { stand: true } }, { label: "起身并翻滚到 2 区", value: { stand: true, dest: 2 } }, { label: "不起身", value: { stand: false } }];
  const pending = c.HotseatGame.ownedChoice(helu, "Helumica · 要不要起身", opts);
  const view = id => plain(c.HotseatGame.getViewFor(id));
  assert.equal(view("p2").ask.eligible, true, "问玩家 2");
  assert.deepEqual(view("p2").ask.options.map(o => o.label), ["起身", "起身并翻滚到 2 区", "不起身"]);
  assert.equal(view("p1").ask.eligible, false, "主持人只看到在等");
  assert.deepEqual(view("p1").ask.options, []);
  c.HotseatGame.switchPlayer("p2");
  const option = view("p2").ask.options[1];
  assert.equal(c.HotseatGame.submit({ type: "answer", askId: view("p2").ask.id, helper: option.helper, extra: option.extra }).ok, true);
  const pick = await pending;
  assert.deepEqual(plain(pick), { stand: true, dest: 2 });
  c.HotseatGame.system({ type: "standAnswer", actor: helu.id, stand: pick.stand, dest: pick.dest });
  assert.equal(helu.upOnShp, true); assert.equal(Number(helu.zone), 2);
  assert.equal(c.BattleSim.outcome(), null);
});
