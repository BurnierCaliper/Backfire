// PvP 第一步：玩家阵营（#445，docs/pvp.md 第 1.1 节）。每个玩家角色（含武器人、护送对象）属于一个玩家阵营，
// 默认全部在「我方」——这时一切和以前一模一样。不同的玩家阵营默认互相敌对；玩家阵营和敌人阵营默认照旧（敌对，state.playerAllies 的同阵营友好），
// 都能用指令 battle.playerFaction 单独改。每个阵营定在我方回合或敌人回合行动（敌人回合里玩家角色比非玩家单位先动）；
// 协助攻击先问打出失衡那一方阵营的玩家角色，都不选才轮到同阵营的非玩家单位；某个阵营的敌对单位全部倒地 / 死亡时它获胜。
// 规则在 enemies.js · PVP_CFG / playerFactionOf / hostileTo / attackFoe / friendlyFireHit / setPlayerFaction，
// 接线见 app.js（canControlUnit、startEnemyPhase、eligibleAssisters、pvpSplit / pvpBattleOutcome）、battle-commands.js、sim.js、
// hotseat*.js、online-view.js · projectUnit（白名单）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const plain = v => JSON.parse(JSON.stringify(v));
const run = (c, expr) => vm.runInContext(expr, c);
const load = (c, files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file }));

/** 柯尔特、赫鲁米卡留在默认阵营「我方」，绯秋、灯分到「乙」；加一个狂徒，全在 1 区（三区直排）。狂徒血厚、架势高：打不死也打不进失衡。
 *  opt.factions(c, heroes)：开战前分阵营（不给就按上面分）；opt.enemies：换敌人 */
function field(opt = {}) {
  const party = opt.party || ["kolt", "helu", "hiaki", "tou"];
  const c = H.load();
  c.BattleSim.setup({ party, enemies: opt.enemies || [{ id: "thug_knife", lv: 1, zone: 1 }], zoneMode: 3, seed: opt.seed || "PVP445" });
  const S = c.S.state;
  const heroes = party.map(k => c.findKit(k, S.units));
  const foes = S.units.filter(u => !u.isPlayer);
  [...heroes, ...foes].forEach(u => { u.zone = 1; });
  foes.forEach(f => { f.layers = [{ type: "flesh", current: 500, max: 500 }]; f.def = f.defMax = 30; });
  if (opt.factions) opt.factions(c, heroes);
  else if (opt.factions !== null) heroes.slice(2).forEach(h => faction(c, { faction: "乙", unit: h.id }));
  c.startCombat();
  heroes.forEach(h => { if (c.unitTurnPhase(h) === "player") { h.ap = h.apMax = 4; h.bonus = h.bonusMax = 4; } h.level = Math.max(Number(h.level) || 1, 5); });
  return { c, S, heroes, foe: foes[0], foes };
}
const faction = (c, cmd) => c.Commands.dispatch(Object.assign({ type: "battle.playerFaction" }, cmd));
const hp = (c, u) => c.totalHp(u);
const ids = list => plain(list.map(u => u.id));
/** 一下普通的单体攻击（不带格挡结果：可能排进格挡队列） */
const strike = (c, a, t, extra) => c.dealTo(a, t, Object.assign({ atk: 10, mult: 1, element: "physical", baseBreak: 1, atkRange: "any", flags: { action: true } }, extra || {}));
const logText = c => c.S.state.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");

test("配置表：默认全部在「我方」、没有配置（state.playerFactions 是 null），玩家角色在我方回合行动；开新的一场战斗清空", () => {
  const c0 = H.load();
  const P = run(c0, "PVP_CFG");
  assert.equal(P.defaultFaction, "我方", "默认阵营");
  assert.equal(P.defaultName, "我方");
  assert.equal(P.playersHostile, true, "不同的玩家阵营默认互相敌对");
  assert.deepEqual(plain(P.phases), ["player", "enemy"]);
  const { c, S, heroes: [kolt, , hiaki], foe } = field({ factions: null });
  assert.equal(S.playerFactions, null, "默认没有配置");
  assert.equal(c.pvpOn(), false);
  assert.equal(c.playerFactionOf(kolt), "我方");
  assert.equal(c.playerFactionOf(hiaki), "我方");
  assert.equal(c.playerFactionOf(foe), null, "非玩家单位不在玩家阵营里");
  assert.equal(c.unitTurnPhase(kolt), "player");
  assert.equal(c.unitTurnPhase(foe), "enemy");
  assert.deepEqual(plain(c.playerFactionList()), [{ id: "我方", name: "我方", phase: "player" }]);
  assert.equal(c.attackFoe(kolt, hiaki), false, "队友照旧不是攻击对象");
  // 配了以后再开一场：回到默认
  faction(c, { faction: "乙", unit: hiaki.id });
  assert.equal(c.pvpOn(), true);
  assert.equal(c.playerFactionOf(hiaki), "乙");
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "PVP445-2" });
  assert.equal(c.S.state.playerFactions, null, "新的一场战斗：阵营清空");
  assert.equal(c.pvpOn(), false);
});

test("默认全在「我方」时和以前一样：同一种子整场自动对打，不配置 / 配置了但全部在「我方」/ 多一个没人的阵营，结果和整场记录都一模一样", () => {
  const cases = [
    // 多阵营混战（盗匪 ↔ 安保）：敌人打失衡敌人、由敌人接协助攻击
    { party: ["kolt", "helu", "tou"], enemies: [{ id: "thug_knife", lv: 6, zone: 2 }, { id: "guard_sword", lv: 6, zone: 2 }, { id: "thug_hammer", lv: 6, zone: 1 }, { id: "guard_gun", lv: 6, zone: 1 }], seed: "PVP445-MULTI", want: /可协助攻击的敌人/ },
    // 友军（跑团模板的「我方与安保同阵营」）
    { party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 7, zone: 2 }, { id: "thug_hammer", lv: 7, zone: 2 }, { id: "guard_sword", lv: 5, zone: 1 }, { id: "guard_gun", lv: 5, zone: 1 }], seed: "PVP445-ALLY", allies: ["安保"] },
    // 难打的：我方被打进失衡、倒地
    { party: ["tou", "hiaki", "kolt"], enemies: [{ id: "guard_sword", lv: 9, zone: 1 }, { id: "guard_gun", lv: 9, zone: 2 }, { id: "captain_wolf", lv: 9, zone: 1 }], seed: "PVP445-HARD", want: /失衡/ }
  ];
  for (const cs of cases) {
    const sim = mode => {
      const c = H.load();
      c.BattleSim.setup({ party: cs.party, enemies: cs.enemies, seed: cs.seed });
      if (cs.allies) c.S.state.playerAllies = cs.allies.slice();
      if (mode === "all") faction(c, { faction: "我方" });                     // 配置了，但全部在「我方」
      if (mode === "empty") faction(c, { faction: "乙", phase: "enemy" });     // 多一个没人的阵营（在敌人回合行动）
      if (mode) assert.equal(c.pvpOn(), true);
      const r = c.BattleSim.run({ maxRounds: 25 });
      return { r: plain(r), log: logText(c) };
    };
    const off = sim(null), all = sim("all"), empty = sim("empty");
    if (cs.want) assert.match(off.log, cs.want, cs.seed + "：这一场打得到要比的那一段");
    assert.notEqual(off.r.winner, "timeout", cs.seed + "：分出了胜负");
    assert.deepEqual(all.r, off.r, cs.seed + "：全部在「我方」——结果一样");
    assert.equal(all.log, off.log, cs.seed + "：整场记录一样");
    assert.deepEqual(empty.r, off.r, cs.seed + "：多一个没人的阵营——结果一样");
    assert.equal(empty.log, off.log, cs.seed + "：整场记录一样");
    assert.equal(off.r.pvpWinners, undefined, "只有一个玩家阵营：不按阵营判胜负");
  }
});

test("两个玩家阵营默认互相敌对：互相能选为目标（单体、分步名单、自动挑目标的候选），自己阵营的队友照旧不能选；武器人跟着持有者", () => {
  const { c, S, heroes: [kolt, helu, hiaki, tou], foe } = field();
  assert.equal(c.playerFactionOf(hiaki), "乙");
  assert.equal(c.samePlayerFaction(hiaki, tou), true);
  assert.equal(c.hostileTo(kolt, hiaki), true, "我方 ↔ 乙：敌对");
  assert.equal(c.hostileTo(hiaki, kolt), true);
  assert.equal(c.hostileTo(kolt, helu), false, "同阵营不敌对");
  assert.equal(c.attackFoe(kolt, hiaki), true, "能打乙队的人");
  assert.equal(c.attackFoe(hiaki, kolt), true, "乙队也能打我方");
  assert.equal(c.attackFoe(kolt, helu), false, "自己阵营的队友照旧不能打（友伤关着）");
  assert.equal(c.attackFoe(hiaki, tou), false);
  assert.equal(c.attackFoe(kolt, foe), true);
  assert.deepEqual(ids(c.hostilesOf(kolt)).sort(), [hiaki.id, tou.id, foe.id].sort(), "敌对的单位：乙队 + 狂徒");
  assert.deepEqual(ids(c.enemiesOf(hiaki)).sort(), [kolt.id, helu.id, foe.id].sort(), "effects.js · enemiesOf 也按阵营");
  const fk = ids(c.fieldFoes(kolt));
  assert.ok(fk.includes(hiaki.id) && fk.includes(tou.id) && fk.includes(foe.id), "分步「选敌人」的名单：乙队和狂徒");
  assert.ok(!fk.includes(helu.id) && !fk.includes(kolt.id), "没有自己阵营的人");
  assert.deepEqual(ids(c.visibleEnemies(1, hiaki)).sort(), [kolt.id, helu.id, foe.id].sort(), "这一区看得见的敌人（范围攻击挑人）");
  assert.equal(c.skillTargetError(kolt, "kolt_aa", hiaki), null, "单体普攻能选乙队的人");
  assert.equal(c.autoFoe(kolt, hiaki), true, "自动挑目标（无人机、炮台……）的候选里有敌对阵营的人");
  assert.equal(c.autoFoe(kolt, helu), false);
  // 给友方用的（治疗、道具）：敌对阵营的人不算友方
  assert.equal(c.allyOf(kolt, helu), true);
  assert.equal(c.allyOf(kolt, hiaki), false);
  // 武器人跟着持有者：灯的年糕在乙
  c.Commands.dispatch({ type: "skill", actor: tou.id, skill: "tou_summon" });
  const mochi = c.findKit("mochi", S.units);
  assert.ok(mochi && !mochi.hidden, "年糕上场");
  assert.equal(c.playerFactionOf(mochi), "乙");
  assert.equal(c.attackFoe(kolt, mochi), true);
  assert.equal(c.attackFoe(hiaki, mochi), false);
  assert.equal(c.attackFoe(mochi, kolt), true, "武器人打对面");
  // 真的打出去：照常结算（没有同阵营的人能协助格挡时直接落下）
  helu.zone = 2; tou.zone = 2; mochi.zone = 2;
  const before = hp(c, hiaki);
  const out = strike(c, kolt, hiaki);
  assert.ok(!out.pending, "同区没有乙队的队友：不等协助格挡");
  assert.ok(hp(c, hiaki) < before, "打到了");
});

test("友伤开关照旧只管同阵营：开着时能打自己阵营的队友；单独设成友好的玩家阵营开着也打不到；敌对阵营的人关着也打得到", () => {
  const { c, heroes: [kolt, helu, hiaki] } = field();
  c.Commands.dispatch({ type: "battle.friendlyFire", on: true });
  assert.equal(c.attackFoe(kolt, helu), true, "开着友伤：同阵营的队友能打");
  assert.equal(c.attackFoe(kolt, hiaki), true);
  c.Commands.dispatch({ type: "battle.friendlyFire", on: false });
  assert.equal(c.attackFoe(kolt, helu), false);
  assert.equal(c.attackFoe(kolt, hiaki), true, "敌对阵营的人：开关关着也打得到");
  // 乙和我方设成友好：互相不是攻击对象，友伤开着也一样（友伤只管同阵营）
  faction(c, { faction: "乙", other: "我方", hostile: false });
  assert.equal(c.hostileTo(kolt, hiaki), false);
  c.Commands.dispatch({ type: "battle.friendlyFire", on: true });
  assert.equal(c.attackFoe(kolt, hiaki), false, "友好的玩家阵营：友伤开着也打不到");
  assert.equal(c.attackFoe(kolt, helu), true);
  assert.equal(c.allyOf(kolt, hiaki), true, "友好的玩家阵营算友方（能治疗）");
  // 回到默认（互相敌对）
  faction(c, { faction: "乙", other: "我方", hostile: null });
  assert.equal(c.hostileTo(kolt, hiaki), true);
});

test("范围攻击打到敌对玩家阵营的角色，自己阵营的队友、施放者自己照旧不挨（绯秋一闪）；打对面不计分数", () => {
  const { c, S, heroes: [kolt, helu, hiaki, tou], foe } = field();
  hiaki.resources.stance = "iai";
  const before = { kolt: hp(c, kolt), helu: hp(c, helu), hiaki: hp(c, hiaki), tou: hp(c, tou), foe: hp(c, foe) };
  c.Commands.dispatch({ type: "skill", actor: hiaki.id, skill: "hiaki_flash" });
  assert.ok(hp(c, kolt) < before.kolt, "我方的柯尔特挨了一闪");
  assert.ok(hp(c, helu) < before.helu, "我方的赫鲁米卡也挨了");
  assert.equal(hp(c, tou), before.tou, "同阵营的灯不挨");
  assert.equal(hp(c, hiaki), before.hiaki, "施放者自己不挨");
  assert.ok(hp(c, foe) < before.foe, "狂徒照样挨");
  assert.equal(c.battleStat(kolt).taken, 0, "PvP 每队单独计分是第三步：打对面先不计分数");
  assert.ok(!S.battleScore.hurt);
});

test("协助格挡只有同阵营的能挡：敌对阵营的人、敌人打过来都一样；以身作盾也只同阵营；没配置阵营时照旧全队都能挡", () => {
  const { c, S, heroes: [kolt, helu, hiaki, tou], foe } = field();
  // 我方的柯尔特打乙队的绯秋：同区的灯（乙）能挡，赫鲁米卡（我方）不能
  const out = strike(c, kolt, hiaki);
  assert.equal(out.pending, true, "等乙队的队友协助格挡");
  const job = S.blockQueue[0];
  assert.equal(job.attackerId, kolt.id);
  const b1 = ids(c.eligibleBlockers(hiaki, job));
  assert.ok(b1.includes(tou.id), "同阵营的灯能挡");
  assert.ok(!b1.includes(helu.id), "敌对阵营的赫鲁米卡不能挡");
  assert.ok(!b1.includes(kolt.id), "打的人自己不能挡");
  c.finishBlock(null);
  assert.equal(S.blockQueue.length, 0);
  // 狂徒打绯秋：还是只有灯能挡；狂徒打柯尔特：只有赫鲁米卡能挡
  const j2 = { attackerId: foe.id, targetId: hiaki.id, tried: [] };
  assert.deepEqual(ids(c.eligibleBlockers(hiaki, j2)), [tou.id]);
  const j3 = { attackerId: foe.id, targetId: kolt.id, tried: [] };
  assert.deepEqual(ids(c.eligibleBlockers(kolt, j3)), [helu.id]);
  // 以身作盾（专长）：也只有同阵营的能替他挡
  helu.feats = ["ironwall"]; tou.feats = ["ironwall"];
  assert.deepEqual(ids(c.featIronwallDeclarers(hiaki, foe)), [tou.id]);
  assert.deepEqual(ids(c.featIronwallDeclarers(kolt, foe)), [helu.id]);
  // 没配置阵营：照旧全队都能挡
  const d = field({ factions: null });
  const [dk, dh, dhi, dt] = d.heroes;
  const dj = { attackerId: d.foe.id, targetId: dhi.id, tried: [] };
  assert.deepEqual(ids(d.c.eligibleBlockers(dhi, dj)).sort(), [dk.id, dh.id, dt.id].sort());
});

/** 带上战斗画面（game.js）和出手前的校验（hotseat-validation.js）：选目标的名单、悬停预演走真的代码 */
function screenField() {
  const f = field();
  f.c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  load(f.c, ["game.js", "hotseat-validation.js", "online-view.js"]);
  return f;
}

test("选目标：本机的名单、悬停预演、联机出手前的校验都按阵营——乙队的人能选、能预演，自己阵营的不能；给友方用的技能反过来", () => {
  const { c, heroes: [kolt, helu, hiaki, tou], foe } = screenField();
  const aa = c.GAME.gameSkills(kolt).find(s => s.id === "kolt_aa");
  const cand = ids(c.GAME.candidateUnits(kolt, aa));
  assert.ok(cand.includes(hiaki.id) && cand.includes(tou.id) && cand.includes(foe.id), "普攻的名单：乙队和狂徒");
  assert.ok(!cand.includes(helu.id) && !cand.includes(kolt.id), "没有自己阵营的人");
  // 悬停预演（局面换成拷贝，阵营配置跟着走）：打乙队的绯秋看得到伤害
  const pv = c.GAME.previewOf(c.GAME.skillThunk(kolt.id, "kolt_aa", hiaki.id, {}));
  assert.equal(pv.meaningful, true, "预演有效");
  assert.ok(pv.units.get(hiaki.id).dmgHi > 0, "预演里看得到打到乙队的伤害");
  // 联机 / 热座出手前的校验（hotseat-validation.js）
  const session = { assertAction: () => true }, game = { depth: 0, tape: null };
  const check = (a, sk, t) => c.HotseatValidation.validateBattle({ type: "skill", actor: a.id, skill: sk, target: t.id, picks: {} }, { session, sender: "p1", game });
  assert.doesNotThrow(() => check(kolt, "kolt_aa", hiaki), "能打乙队的人");
  assert.throws(() => check(kolt, "kolt_aa", helu), /这一方的目标/, "不能打自己阵营的队友");
  // 给友方用的技能（托乌「急救」这类写着友方的）：敌对阵营的人不能选
  const allySkill = c.GAME.gameSkills(tou).find(s => /友方|队友/.test(s.hint || "") && !/敌/.test(s.hint || ""));
  if (allySkill) {
    const list = ids(c.GAME.candidateUnits(tou, allySkill));
    assert.ok(!list.includes(kolt.id) && !list.includes(helu.id), "给友方用的技能：名单里没有敌对阵营的人（" + allySkill.id + "）");
  }
});

test("玩家阵营设成和某个敌人阵营友好：敌人 AI 不打它、不把它当目标，它也不能选那些敌人（单体、范围、出手前的校验）；改回默认又照旧", () => {
  const mk = friendly => {
    const f = field({
      party: ["kolt", "helu", "hiaki"],
      enemies: [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "guard_sword", lv: 1, zone: 3 }],
      factions: (c, [, , hiaki]) => {
        faction(c, { faction: "乙", unit: hiaki.id });
        if (friendly) faction(c, { faction: "乙", enemy: "盗匪", hostile: false });
      }
    });
    const [kolt, helu, hiaki] = f.heroes;
    const thug = f.c.findKit("thug_knife", f.S.units), guard = f.c.findKit("guard_sword", f.S.units);
    // 绯秋和狂徒在 1 区，我方两人在 2 区，安保在 3 区。绯秋血最厚：狂徒「同区挑血最多的」会先挑她
    kolt.zone = helu.zone = 2; guard.zone = 3;
    hiaki.layers = [{ type: "flesh", current: 400, max: 400 }];
    return { ...f, kolt, helu, hiaki, thug, guard };
  };
  const { c, S, kolt, helu, hiaki, thug, guard } = mk(true);
  assert.equal(c.hostileTo(thug, hiaki), false, "狂徒（盗匪）不当乙队是敌人");
  assert.equal(c.hostileTo(thug, kolt), true, "我方照旧敌对");
  assert.ok(!c.hostilesOf(thug).includes(hiaki), "敌人 AI 的名单里没有乙队的人");
  assert.ok(c.hostilesOf(thug).includes(kolt) && c.hostilesOf(thug).includes(guard), "我方、安保（和盗匪敌对）照旧在");
  assert.equal(c.hostileTo(guard, hiaki), true, "安保照旧和乙敌对（只改了盗匪）");
  // 乙队不能选这些敌人
  assert.equal(c.attackFoe(hiaki, thug), false);
  assert.ok(!c.fieldFoes(hiaki).includes(thug), "分步名单里没有狂徒");
  assert.ok(!c.visibleEnemies(1, hiaki).includes(thug), "范围攻击不挑狂徒");
  assert.equal(c.autoFoe(hiaki, thug), false, "自动挑目标也不挑");
  assert.match(c.skillTargetError(hiaki, "hiaki_aa", thug) || "", /友军/, "单体普攻选狂徒：扣点之前就拦下");
  assert.equal(c.skillTargetError(kolt, "kolt_aa", thug), null, "我方照旧能选狂徒");
  const hp0 = hp(c, thug);
  const r = strike(c, hiaki, thug);
  assert.equal(r.res.ok, false, "硬打也打不出去（友军）");
  assert.equal(hp(c, thug), hp0);
  hiaki.resources.stance = "iai";
  c.Commands.dispatch({ type: "skill", actor: hiaki.id, skill: "hiaki_flash" });
  assert.equal(hp(c, thug), hp0, "一闪不打狂徒");
  // 我方照旧能打狂徒
  assert.equal(c.attackFoe(kolt, thug), true);
  // 敌人回合：狂徒不打同区的绯秋，去找我方
  c.Commands.dispatch({ type: "battle.endPlayerTurn" });
  const hpHiaki = hp(c, hiaki), targets = [];
  for (let n = 0; n < 4; n++) {
    const out = c.Commands.dispatch({ type: "battle.enemyAction", actor: thug.id, step: n });
    if (!out.executed) break;
    targets.push(out.meta && out.meta.targetId);
    c.BattleSim.resolveQueues({ pickBlocker: () => null, pickAssister: () => null });
  }
  assert.ok(targets.length > 0, "狂徒行动了");
  assert.ok(!targets.includes(hiaki.id), "敌人 AI 不打乙队的人");
  assert.equal(hp(c, hiaki), hpHiaki, "绯秋没挨打");
  assert.ok(S.units.includes(helu));
  // 对照：没设友好时，同一个局面狂徒先打同区血最多的绯秋
  const g = mk(false);
  g.c.Commands.dispatch({ type: "battle.endPlayerTurn" });
  const first = g.c.Commands.dispatch({ type: "battle.enemyAction", actor: g.thug.id, step: 0 });
  assert.equal(first.meta.targetId, g.hiaki.id, "对照：乙和盗匪敌对时，狂徒打绯秋");
  // 改回默认（hostile: null）：照旧敌对
  faction(c, { faction: "乙", enemy: "盗匪", hostile: null });
  assert.equal(c.hostileTo(thug, hiaki), true);
  assert.equal(c.attackFoe(hiaki, thug), true);
});

test("跑团模板的友军（state.playerAllies）对每个玩家阵营照旧友好；某个阵营单独设成和它敌对就照设的——互相敌对，敌人 AI 打它，瑞比的无人机也挑它", () => {
  const mk = hostile => {
    const f = field({
      party: ["ruby", "kolt", "helu"],
      enemies: [{ id: "guard_sword", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 3 }],
      factions: (c, [ruby]) => {
        c.S.state.playerAllies = ["安保"];   // 跑团战斗模板的「我方与安保同阵营」
        faction(c, { faction: "乙", unit: ruby.id });
        if (hostile) faction(c, { faction: "乙", enemy: "安保", hostile: true });
      }
    });
    const [ruby, kolt, helu] = f.heroes;
    const guard = f.c.findKit("guard_sword", f.S.units), thug = f.c.findKit("thug_knife", f.S.units);
    // 瑞比和安保在 1 区；我方两人、狂徒在 3 区（无人机够不着）
    kolt.zone = helu.zone = 3; thug.zone = 3;
    return { ...f, ruby, kolt, helu, guard, thug };
  };
  const drone = f => {
    Object.assign(f.ruby.resources, { drone: true, mecha: true, nano: 200 });
    f.c.turnEnd();
    return logText(f.c);
  };
  // 没单独设：安保对乙也是友军（和以前对我方一样）
  const a = mk(false);
  assert.equal(a.c.hostileTo(a.guard, a.ruby), false, "安保照旧是友军（对乙也是）");
  assert.equal(a.c.playerAllied(a.guard, a.ruby), true);
  assert.notEqual(a.c.EnemyAI.plan(a.guard).meta.targetId, a.ruby.id, "友军不打瑞比");
  assert.match(drone(a), /没有打得到的敌人，无人机这回合什么都不干/, "无人机不挑友军");
  // 乙单独设成和安保敌对：只改乙，我方照旧友好
  const b = mk(true);
  assert.equal(b.c.hostileTo(b.guard, b.ruby), true, "乙和安保敌对");
  assert.equal(b.c.hostileTo(b.guard, b.kolt), false, "我方照旧和安保友好");
  assert.equal(b.c.playerAllied(b.guard, b.ruby), false);
  assert.equal(b.c.playerAllied(b.guard, b.kolt), true);
  assert.equal(b.c.EnemyAI.plan(b.guard).meta.targetId, b.ruby.id, "安保的 AI 打同区的瑞比");
  assert.equal(b.c.skillTargetError(b.ruby, "ruby_aa", b.guard), null, "瑞比能选安保");
  assert.match(b.c.skillTargetError(b.kolt, "kolt_aa", b.guard) || "", /友军/, "我方选安保照旧被拦下");
  assert.match(drone(b), new RegExp("无人机激光射向 " + b.guard.name), "无人机按瑞比的阵营挑：安保是敌人");
});

test("在敌人回合行动的玩家阵营：开战时没有行动点 / 附赠，敌人回合开始时补；我方回合不能动、敌人回合能动；联机出手前的校验也按回合", () => {
  const { c, S, heroes: [kolt, helu, hiaki], foe } = field({
    factions: (c, [, , hiaki, tou]) => {
      faction(c, { faction: "乙", phase: "enemy", unit: hiaki.id });
      faction(c, { faction: "乙", unit: tou.id });
    }
  });
  load(c, ["hotseat-validation.js"]);
  const session = { assertAction: () => true }, game = { depth: 0, tape: null };
  const check = (a, t) => c.HotseatValidation.validateBattle({ type: "skill", actor: a.id, skill: a.kit + "_aa", target: t.id, picks: {} }, { session, sender: "p1", game });
  assert.equal(c.unitTurnPhase(hiaki), "enemy");
  assert.equal(c.unitTurnPhase(kolt), "player");
  assert.equal(S.combatPhase, "player");
  assert.equal(hiaki.ap, 0, "开战时还没轮到乙：没有行动点");
  assert.equal(hiaki.bonus, 0, "也没有附赠动作");
  assert.equal(c.canControlUnit(hiaki), false, "我方回合：乙动不了");
  assert.equal(c.canControlUnit(kolt), true);
  assert.deepEqual(ids(c.phasePlayers("enemy")).filter(id => !c.isWeaponUnit(c.unitById(id))).sort(), [hiaki.id, c.findKit("tou", S.units).id].sort());
  assert.throws(() => check(hiaki, kolt), /在敌人回合行动/, "我方回合：乙的出手被拦下");
  assert.doesNotThrow(() => check(kolt, hiaki));
  // 我方回合结束 → 敌人回合开始：乙补行动点 / 附赠，能动；我方不能动
  c.Commands.dispatch({ type: "battle.endPlayerTurn" });
  assert.equal(S.combatPhase, "enemy");
  assert.ok(hiaki.ap > 0 && hiaki.ap === hiaki.apMax, "敌人回合开始：乙补满行动点");
  assert.ok(hiaki.bonus > 0 && hiaki.bonus === hiaki.bonusMax, "附赠也补满");
  assert.equal(c.canControlUnit(hiaki), true, "敌人回合：乙能动");
  assert.equal(c.canControlUnit(kolt), false, "我方动不了");
  assert.equal(c.canControlUnit(foe), true, "敌人照旧在敌人回合动");
  assert.doesNotThrow(() => check(hiaki, kolt), "敌人回合：乙能出手");
  assert.throws(() => check(kolt, hiaki), /敌人回合/, "我方的出手被拦下");
  // 乙真的出手（打我方的柯尔特，同区的赫鲁米卡能替他挡：没人挡就落下）
  const before = hp(c, kolt), ap0 = hiaki.ap;
  c.Commands.dispatch({ type: "skill", actor: hiaki.id, skill: "hiaki_aa", target: kolt.id });
  c.BattleSim.resolveQueues({ pickBlocker: () => null, pickAssister: () => null });
  assert.ok(hiaki.ap < ap0, "花掉了行动点");
  assert.ok(hp(c, kolt) < before, "打到了我方");
  // 敌人回合结束 → 下一回合我方回合：我方补满，乙不补（留到敌人回合）
  kolt.ap = 0;
  const left = hiaki.ap;
  c.Commands.dispatch({ type: "battle.endEnemyTurn" });
  assert.equal(S.combatPhase, "player");
  assert.equal(S.turnNo, 2);
  assert.equal(kolt.ap, kolt.apMax, "我方回合开始：我方补满");
  assert.equal(hiaki.ap, left, "乙不在我方回合补");
  assert.equal(c.canControlUnit(hiaki), false);
  assert.ok(helu);
});

test("自动对打：在敌人回合行动的玩家角色比非玩家单位先动（先等它们行动完，再跑敌人的 AI）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu", "hiaki", "tou"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }, { id: "thug_hammer", lv: 3, zone: 2 }], seed: "PVP445-ORDER" });
  const S = c.S.state;
  const hiaki = c.findKit("hiaki", S.units), tou = c.findKit("tou", S.units);
  faction(c, { faction: "乙", phase: "enemy", unit: hiaki.id });
  faction(c, { faction: "乙", unit: tou.id });
  // 记下谁在什么时候行动：玩家一方的打法（BASIC_POLICY.act）、敌人的 AI（EnemyAI.plan）
  const order = [];
  const plan = c.EnemyAI.plan;
  c.EnemyAI.plan = u => { const p = plan(u); if (p) order.push({ who: "npc", id: u.id, phase: S.combatPhase, turn: S.turnNo }); return p; };
  const act = c.BattleSim.BASIC_POLICY.act;
  const policy = { act(u) { const t = act(u); if (t) order.push({ who: "player", id: u.id, phase: S.combatPhase, turn: S.turnNo }); return t; } };
  c.BattleSim.run({ maxRounds: 2, policy });
  const r1 = order.filter(o => o.turn === 1);
  const pvp = r1.filter(o => o.who === "player" && (o.id === hiaki.id || o.id === tou.id));
  const npc = r1.filter(o => o.who === "npc");
  assert.ok(pvp.length > 0, "乙队在第 1 回合行动了");
  assert.ok(npc.length > 0, "敌人也行动了");
  assert.ok(pvp.every(o => o.phase === "enemy"), "乙队只在敌人回合行动");
  assert.ok(r1.filter(o => o.who === "player" && o.phase === "player").every(o => o.id !== hiaki.id && o.id !== tou.id), "我方回合里乙队不动");
  const lastPvp = r1.lastIndexOf(pvp[pvp.length - 1]), firstNpc = r1.indexOf(npc[0]);
  assert.ok(lastPvp < firstNpc, "同一个敌人回合里，乙队的玩家角色都动完了，敌人才动");
});

test("协助攻击先问打出失衡那一方阵营的玩家角色，都不选才轮到同阵营的非玩家单位；玩家接了就不再问非玩家单位", () => {
  const mk = () => field({
    enemies: [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_hammer", lv: 1, zone: 1 }],
    factions: (c, [, , hiaki, tou]) => {
      faction(c, { faction: "乙", unit: hiaki.id });
      faction(c, { faction: "乙", unit: tou.id });
      faction(c, { faction: "乙", enemy: "盗匪", hostile: false });   // 乙和盗匪一伙：狂徒打出的失衡算乙这一方
    }
  });
  const breakOn = (c, by, t) => { t.def = 1; return c.dealTo(by, t, { atk: 1, mult: 1, element: "physical", baseBreak: 3, atkRange: "any", flags: { action: true, blockResolved: true } }); };
  {
    const { c, S, heroes: [kolt, helu, hiaki, tou] } = mk();
    const knife = c.findKit("thug_knife", S.units), hammer = c.findKit("thug_hammer", S.units);
    // 狂徒（盗匪，和乙一伙）把我方的柯尔特打进失衡：先问乙队的玩家角色
    breakOn(c, knife, kolt);
    assert.equal(kolt.stunned, true);
    const job = S.assistQueue[0];
    assert.ok(job && job.targetId === kolt.id);
    assert.equal(job.pvpStage, "players", "第一轮：问玩家角色");
    assert.equal(job.vsPlayer, false, "玩家来选（不是 AI 选人）");
    assert.deepEqual(ids(c.eligibleAssisters(knife, kolt, job)).sort(), [hiaki.id, tou.id].sort(), "乙队的玩家角色能接；我方的赫鲁米卡不能，狂徒这一轮不在");
    assert.match(logText(c), /可协助攻击的玩家角色/);
    // 玩家都不选：轮到同阵营（和乙一伙）的非玩家单位——打出失衡的狂徒（匕首）自己不接，狂徒（锤）接
    c.Commands.dispatch({ type: "assistAnswer", helper: null });
    const job2 = S.assistQueue[0];
    assert.ok(job2 && job2.targetId === kolt.id, "还没结束：轮到非玩家单位");
    assert.equal(job2.pvpStage, "npc");
    assert.equal(job2.vsPlayer, true, "AI 选人");
    assert.deepEqual(ids(c.eligibleAssisters(knife, kolt, job2)), [hammer.id]);
    assert.match(logText(c), /没有玩家角色发动协助攻击。可协助攻击的非玩家单位：/);
    const before = hp(c, kolt);
    c.Commands.dispatch({ type: "assistAnswer", helper: hammer.id });
    assert.equal(S.assistQueue.length, 0);
    assert.ok(hp(c, kolt) < before, "狂徒（锤）协助攻击打到柯尔特");
    assert.ok(helu);
  }
  {
    // 乙队的人接了：不再问非玩家单位
    const { c, S, heroes: [kolt, , hiaki] } = mk();
    const knife = c.findKit("thug_knife", S.units);
    breakOn(c, knife, kolt);
    assert.equal(S.assistQueue[0].pvpStage, "players");
    const before = hp(c, kolt);
    c.Commands.dispatch({ type: "assistAnswer", helper: hiaki.id, extra: { blade: "niu" } });
    assert.equal(S.assistQueue.length, 0, "玩家角色接了：不再问非玩家单位");
    assert.ok(hp(c, kolt) < before, "绯秋协助攻击打到柯尔特");
    assert.doesNotMatch(logText(c), /可协助攻击的非玩家单位/);
  }
  {
    // 乙队的绯秋自己打出失衡：先问乙队的其他人（灯），再轮到和乙一伙的狂徒
    const { c, S, heroes: [kolt, , hiaki, tou] } = mk();
    const knife = c.findKit("thug_knife", S.units), hammer = c.findKit("thug_hammer", S.units);
    breakOn(c, hiaki, kolt);
    assert.deepEqual(ids(c.eligibleAssisters(hiaki, kolt, S.assistQueue[0])), [tou.id], "第一轮：乙队的灯（打出失衡的绯秋自己不接）");
    c.Commands.dispatch({ type: "assistAnswer", helper: null });
    assert.deepEqual(ids(c.eligibleAssisters(hiaki, kolt, S.assistQueue[0])).sort(), [knife.id, hammer.id].sort(), "第二轮：和乙一伙的狂徒");
  }
  {
    // 没配置阵营：照旧——敌人打出的失衡只由敌人接（AI 选人）
    const { c, S, heroes: [kolt] } = field({ factions: null, enemies: [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_hammer", lv: 1, zone: 1 }] });
    const knife = c.findKit("thug_knife", S.units), hammer = c.findKit("thug_hammer", S.units);
    breakOn(c, knife, kolt);
    const job = S.assistQueue[0];
    assert.equal(job.vsPlayer, true);
    assert.equal(job.pvpStage, undefined, "不分两轮");
    assert.deepEqual(ids(c.eligibleAssisters(knife, kolt, job)), [hammer.id]);
  }
});

test("胜负：某阵营的敌对单位全部倒地 / 死亡时它获胜；互相友好的阵营一起赢；所有玩家阵营都倒下算敌人赢；只有一个玩家阵营时照旧", () => {
  {
    const { c, heroes: [kolt, helu, hiaki, tou], foe } = field();
    const out = () => plain(c.pvpBattleOutcome());
    assert.deepEqual(out(), { winners: [], wiped: false, over: false }, "都还站着：没分出来");
    assert.equal(c.BattleSim.outcome(), null);
    // 乙全部倒地（濒死），狂徒还在：我方还有敌对单位站着，没赢
    hiaki.dying = true; tou.dying = true;
    assert.deepEqual(out(), { winners: [], wiped: false, over: false }, "狂徒还在：我方还没赢");
    assert.equal(c.BattleSim.outcome(), null);
    // 狂徒死了：我方的敌对单位全部倒地 / 死亡 → 我方获胜
    foe.dead = true;
    assert.deepEqual(out(), { winners: ["我方"], wiped: false, over: true });
    assert.equal(c.BattleSim.outcome(), "player");
    // 非玩家单位移出战场也算
    foe.dead = false; foe._removed = true;
    assert.deepEqual(out().winners, ["我方"], "狂徒移出战场也算");
    // 敌人都没了、乙还站着：两边互相敌对，还没分出来（以前「没有敌人」就算赢）
    hiaki.dying = false;
    assert.deepEqual(out(), { winners: [], wiped: false, over: false });
    assert.equal(c.BattleSim.outcome(), null, "乙还有人站着：继续打");
    // 所有玩家阵营都倒下：敌人赢
    foe._removed = false;
    [kolt, helu, hiaki, tou].forEach(h => { h.dying = true; });
    assert.equal(out().wiped, true);
    assert.equal(c.BattleSim.outcome(), "enemy");
  }
  {
    // 乙和我方友好：一起打狂徒，狂徒死了两个阵营一起赢
    const { c, foe } = field();
    faction(c, { faction: "乙", other: "我方", hostile: false });
    assert.deepEqual(plain(c.pvpBattleOutcome()).winners, []);
    foe.dead = true;
    assert.deepEqual(plain(c.pvpBattleOutcome()).winners.sort(), ["乙", "我方"].sort(), "友好的阵营一起赢");
  }
  {
    // 配置了阵营、但场上只有「我方」一个玩家阵营（乙没人）：不按阵营判，胜负照旧
    const { c, heroes, foe } = field({ factions: c => faction(c, { faction: "乙" }) });
    assert.equal(c.pvpOn(), true);
    assert.equal(c.pvpBattleOutcome(), null, "只有一个玩家阵营：不按阵营判");
    foe.dead = true;
    assert.equal(c.BattleSim.outcome(), "player", "敌人全灭就赢（和以前一样）");
    foe.dead = false;
    heroes.forEach(h => { h.dying = true; });
    assert.equal(c.BattleSim.outcome(), "enemy", "全员倒地就输");
  }
});

test("胜负（整场自动对打）：两个玩家阵营对打到一方全部倒地，赢的阵营写在结果里", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu", "hiaki", "tou"], enemies: [], seed: "PVP445-DUEL" });
  const S = c.S.state;
  const hiaki = c.findKit("hiaki", S.units), tou = c.findKit("tou", S.units);
  faction(c, { faction: "乙", unit: hiaki.id });
  faction(c, { faction: "乙", unit: tou.id });
  const r = plain(c.BattleSim.run({ maxRounds: 30 }));
  assert.equal(r.winner, "player", "分出了胜负（一个玩家阵营赢了）");
  assert.equal(r.pvpWinners.length, 1);
  const win = r.pvpWinners[0];
  const heroes = S.units.filter(u => u.isPlayer && !c.isWeaponUnit(u));
  const standing = u => !u.dead && !u.dying;
  assert.ok(heroes.some(u => c.playerFactionOf(u) === win && standing(u)), "赢的阵营还有人站着");
  assert.ok(heroes.filter(u => c.playerFactionOf(u) !== win).every(u => !standing(u)), "输的阵营全部倒地");
});

test("联机：单位带阵营 id / 名字（玩家这一边）或敌人阵营（非玩家单位），经 online-view.js 白名单；敌友关系、坚毅数值都不发；没配置时一个字段都不加", () => {
  const { c, S, heroes: [kolt, helu, hiaki, tou], foe } = field({ factions: null });
  load(c, ["online-view.js"]);
  [kolt, helu, hiaki, tou].forEach((h, i) => { h.shp = 732911 + i; h.shpMax = 827319 + i; h.shpBase = 613577; h.shpBonus = 41911; });
  const view = () => c.OnlineView.projectState(S, { recipientId: "p2", gmId: "host" });
  const unit = (out, u) => out.units.find(x => x.id === u.id);
  // 没配置：一个字段都不加（和以前一样）
  const off = view();
  assert.ok(off.units.every(u => !("faction" in u) && !("factionName" in u) && !("enemyFaction" in u)), "没配置阵营：不加字段");
  // 分阵营：乙叫「乙队」、在敌人回合行动、和盗匪友好（灯先在我方回合叫出年糕：分到乙以后要等敌人回合才能动）
  c.Commands.dispatch({ type: "skill", actor: tou.id, skill: "tou_summon" });
  const mochi = c.findKit("mochi", S.units);
  assert.ok(mochi && !mochi.hidden, "年糕上场");
  faction(c, { faction: "乙", name: "乙队", phase: "enemy", unit: hiaki.id });
  faction(c, { faction: "乙", unit: tou.id });
  faction(c, { faction: "乙", enemy: "盗匪", hostile: false });
  const out = view();
  assert.deepEqual([unit(out, kolt).faction, unit(out, kolt).factionName], ["我方", "我方"]);
  assert.deepEqual([unit(out, hiaki).faction, unit(out, hiaki).factionName], ["乙", "乙队"]);
  assert.equal(unit(out, mochi).faction, "乙", "武器人跟着持有者");
  assert.equal(unit(out, foe).enemyFaction, "盗匪", "非玩家单位：图鉴里的敌人阵营名");
  assert.ok(!("faction" in unit(out, foe)), "非玩家单位不带玩家阵营");
  assert.ok(!("enemyFaction" in unit(out, kolt)));
  const wire = JSON.stringify(out);
  assert.ok(!("playerFactions" in out), "阵营配置（谁和谁敌对、谁在哪个回合）不发");
  assert.doesNotMatch(wire, /"members"|"players"|"enemies"|"phase"/, "敌友关系、回合不发");
  assert.doesNotMatch(wire.replace(/"upOnShp":(true|false)/g, ""), /732911|827319|613577|41911|shp/i, "坚毅数值照旧不发");
  // 整包投影也一样
  const packet = c.OnlineView.projectPacket({ type: "result", protocol: 1, build: "x", seq: 1, screen: "battle", state: S, view: { players: [] } }, { recipientId: "p2", gmId: "host" });
  assert.equal(packet.state.units.find(x => x.id === hiaki.id).factionName, "乙队");
  assert.doesNotMatch(JSON.stringify(packet).replace(/"upOnShp":(true|false)/g, ""), /732911|827319|shp/i);
  // 给玩家看不了的名字（带「坚毅」）：指令直接拒绝，不会存进去
  assert.throws(() => faction(c, { faction: "丙", name: "坚毅组" }), /can't be shown to players/);
  assert.equal(c.playerFactionInfo("丙"), null);
});

test("指令 battle.playerFaction：建阵营、分人、定回合、设敌友、删阵营、清空；乱给的字段被拒；返回改完的配置", () => {
  const { c, S, heroes: [kolt, helu, hiaki, tou] } = field({ factions: null });
  const bad = (cmd, re) => assert.throws(() => faction(c, cmd), re);
  bad({ faction: "乙", color: "red" }, /Unknown player faction field/);
  bad({ reset: true, faction: "乙" }, /reset takes no other fields/);
  bad({ faction: "" }, /nonempty trimmed string/);
  bad({ faction: " 乙" }, /nonempty trimmed string/);
  bad({ faction: "甲|乙" }, /without \|/);
  bad({ faction: "乙", phase: "night" }, /Unknown player faction phase/);
  bad({ faction: "乙", other: "乙", hostile: true }, /different faction/);
  bad({ faction: "乙", enemy: "火星人", hostile: false }, /Unknown enemy faction/);
  bad({ faction: "乙", enemy: "盗匪", hostile: "yes" }, /true, false or null/);
  bad({ faction: "乙", hostile: true }, /needs other or enemy/);
  bad({ faction: "乙", other: "丙", enemy: "盗匪", hostile: true }, /not both/);
  bad({ faction: "乙", remove: true, name: "x" }, /remove takes no other fields/);
  c.Commands.dispatch({ type: "skill", actor: tou.id, skill: "tou_summon" });
  bad({ faction: "乙", unit: c.findKit("mochi", S.units).id }, /weapon units follow their holder/);
  assert.equal(S.playerFactions, null, "被拒的指令不留下配置");
  // 建阵营 + 分人（一次给）
  const r = faction(c, { faction: "乙", name: "乙队", unit: hiaki.id });
  assert.deepEqual(plain(r.factions.list), [{ id: "我方", name: "我方", phase: "player" }, { id: "乙", name: "乙队", phase: "player" }], "默认阵营总在第一个；新阵营默认在我方回合");
  assert.deepEqual(plain(r.factions.members), { [hiaki.id]: "乙" });
  faction(c, { faction: "乙", phase: "enemy" });
  assert.equal(c.playerFactionInfo("乙").phase, "enemy");
  // 两个玩家阵营之间：设友好 / 回到默认
  faction(c, { faction: "丙", unit: tou.id });
  faction(c, { faction: "丙", other: "乙", hostile: false });
  assert.equal(c.playerFactionsHostile("乙", "丙"), false);
  assert.equal(c.playerFactionsHostile("我方", "丙"), true, "没设的照默认（敌对）");
  bad({ faction: "乙", other: "丁", hostile: true }, /没有这个玩家阵营/);
  // 和敌人阵营：设敌对 / 友好
  faction(c, { faction: "我方", enemy: "安保", hostile: false });
  assert.deepEqual(plain(S.playerFactions.enemies), { "我方|安保": false });
  // 分回默认阵营 = 去掉记录
  faction(c, { faction: "我方", unit: tou.id });
  assert.equal(c.playerFactionOf(tou), "我方");
  assert.ok(!(tou.id in S.playerFactions.members));
  // 删阵营：里面的人回到默认，和它有关的敌友设置一起去掉；默认阵营删不掉
  faction(c, { faction: "丙", unit: helu.id });
  faction(c, { faction: "丙", remove: true });
  assert.equal(c.playerFactionOf(helu), "我方");
  assert.equal(c.playerFactionInfo("丙"), null);
  assert.deepEqual(plain(S.playerFactions.players), {}, "和丙有关的敌友设置去掉了");
  bad({ faction: "我方", remove: true }, /不能删/);
  bad({ faction: "丙", remove: true }, /没有这个玩家阵营/);
  // 最多 PVP_CFG.maxFactions 个
  const max = run(c, "PVP_CFG.maxFactions");
  for (let i = S.playerFactions.list.length; i < max; i++) faction(c, { faction: "队" + i });
  bad({ faction: "多一个" }, /最多/);
  // 每次换一份新的对象（联机按差量发、预演的拷贝都看得出变了）；清空回到 null
  const prev = S.playerFactions;
  faction(c, { faction: "乙", name: "新名字" });
  assert.notEqual(S.playerFactions, prev);
  assert.deepEqual(plain(faction(c, { reset: true })), { factions: null });
  assert.equal(S.playerFactions, null);
  assert.equal(c.playerFactionOf(hiaki), "我方");
  assert.ok(kolt);
});

test("热座 / 联机：只有房主能改阵营；在敌人回合行动的玩家阵营不排进我方回合的行动顺序，敌人回合里只有房主能操控它们", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "PVP445-HOTSEAT" });
  c.location = { search: "?hotseat=1" }; c.URLSearchParams = URLSearchParams;
  c.document = { getElementById() { return null; } };
  c.setInterval = () => 1;
  c.setTimeout = () => 1;
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, undo: [], disarm() {}, refresh() {} };
  load(c, ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "hotseat-game.js"]);
  const S = c.S.state, kolt = c.findKit("kolt", S.units), helu = c.findKit("helu", S.units);
  const players = [{ id: "p1", name: "主持人", gm: true }, { id: "p2", name: "玩家 2" }];
  assert.deepEqual(plain(c.HotseatGame.configure({ mode: "trpg", players, assignments: { [kolt.id]: "p1", [helu.id]: "p2" } })), { ok: true });
  const send = (id, command) => { c.HotseatGame.switchPlayer(id); return c.HotseatGame.submit(command); };
  const no = send("p2", { type: "battle.playerFaction", faction: "乙", phase: "enemy", unit: helu.id });
  assert.equal(no.ok, false, "玩家不能改阵营");
  assert.match(no.error, /只有房主/);
  assert.equal(S.playerFactions, null);
  assert.equal(send("p1", { type: "battle.playerFaction", faction: "乙", phase: "enemy", unit: helu.id }).ok, true, "房主（主持人）可以");
  assert.equal(c.playerFactionOf(helu), "乙");
  assert.equal(send("p1", { type: "startCombat" }).ok, true);
  c.HotseatGame.beginRound();
  const units = plain(c.HotseatGame.getView().units.map(u => u.id));
  assert.ok(units.includes(kolt.id), "我方的柯尔特排进行动顺序");
  assert.ok(!units.includes(helu.id), "在敌人回合行动的赫鲁米卡不排进我方回合的行动顺序");
  // 敌人回合：赫鲁米卡由房主操控（分配给玩家、让玩家自己操控是第二步）。回合推进走房主的规则流程（game.js · systemCommand）
  c.HotseatGame.system({ type: "battle.endPlayerTurn" });
  assert.equal(S.combatPhase, "enemy");
  assert.ok(helu.ap > 0, "敌人回合开始补了行动点");
  kolt.zone = 1; helu.zone = 2;
  const hit = { type: "skill", actor: helu.id, skill: "helu_aa", target: kolt.id, picks: {} };
  const p2 = send("p2", hit);
  assert.equal(p2.ok, false, "分到的玩家在这一步不能操控");
  assert.match(p2.error, /只有房主/);
  const p1 = send("p1", hit);
  assert.equal(p1.ok, true, "房主能操控：" + (p1.error || ""));
});
