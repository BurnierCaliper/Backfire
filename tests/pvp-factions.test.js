// PvP 第一步：玩家阵营（#445，docs/pvp.md 第 1.1 节）。每个玩家角色（含武器人、护送对象）属于一个玩家阵营，
// 默认全部在「我方」——这时一切和以前一模一样。不同的玩家阵营默认互相敌对；玩家阵营和敌人阵营默认照旧（敌对，state.playerAllies 的同阵营友好），
// 都能用指令 battle.playerFaction 单独改。每个阵营定在我方回合或敌人回合行动（敌人回合里玩家角色比非玩家单位先动）；
// 协助攻击先问打出失衡那一方阵营的玩家角色，都不选才轮到同阵营的非玩家单位；某个阵营的敌对单位全部倒地 / 死亡时它获胜。
// 规则在 enemies.js · PVP_CFG / playerFactionOf / hostileTo / attackFoe / friendlyFireHit / setPlayerFaction，
// 接线见 app.js（canControlUnit、startEnemyPhase、eligibleAssisters、pvpSplit / pvpBattleOutcome）、battle-commands.js、sim.js、
// hotseat*.js、online-view.js · projectUnit（白名单）
// 给友方的范围效果（群体治疗、护盾、全队集结……）只给施放者的自己人（#456：同一个玩家阵营；#460：单独设成友好的玩家阵营也算）：
// enemies.js · teammateOf（单体选友方的 allyOf 是同一个判断），接线见文件最后几条；
// 单体选友方的技能（分步名单、出手前的校验、结算）和连锁伤害（高能自爆的余波、感电 / 中和感电的波及：enemies.js · chainSideOf）也按阵营（#460），在最后
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

test("协助格挡：敌对阵营的人不能挡（敌对阵营的人、敌人打过来都一样）；以身作盾也一样；没配置阵营时照旧全队都能挡（友好的阵营能挡，见 #463 那几条）", () => {
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
  // 以身作盾（专长）：敌对阵营的人也不能替他挡
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

/* ===== 给友方的范围效果按玩家阵营分（#456 / #460）=====
 * 「同区友方 / 全部友方 / 全队」的效果只给施放者的自己人（enemies.js · teammateOf：同一个玩家阵营，#460 起单独设成友好的玩家阵营也算）。
 * 下面每条先看两个敌对玩家阵营同区时只给施放者的阵营，再拿不配置阵营的同一个局面对照：照旧给同区全部玩家角色（和以前一样）。 */
const shieldOf = u => (u.layers || []).filter(l => l.type === "shield").reduce((s, l) => s + (Number(l.current) || 0), 0);
/** 血量打到三分之一（留着治疗的空间，不会倒地） */
const wound = (...us) => us.forEach(u => (u.layers || []).forEach(l => { if (l.type !== "shield") l.current = Math.max(1, Math.floor((Number(l.max) || 0) / 3)); }));
const skill = (c, a, id, t, picks) => c.Commands.dispatch({ type: "skill", actor: a.id, skill: id, target: t ? t.id : null, picks: picks || {} });
/** 一组单位在 fn 前后各自变了没有：按顺序返回 changed(之前, 之后) */
const diffOf = (us, read, fn, changed) => { const before = us.map(read); fn(); return us.map((u, i) => changed(before[i], read(u))); };

test("teammateOf：同一个玩家阵营算（武器人跟着持有者、护送对象按自己记的阵营），单独设成友好的玩家阵营也算（#460）；没配置阵营时就是「是不是玩家角色」", () => {
  const { c, S, heroes: [kolt, helu, hiaki, tou], foe } = field({ factions: null });
  assert.equal(c.teammateOf(kolt, hiaki), true, "没配置阵营：玩家角色都算");
  assert.equal(c.teammateOf(kolt, foe), false, "非玩家单位不算");
  assert.equal(c.teammateOf(null, helu), true, "没有施放者：照旧只看是不是玩家角色");
  // 分阵营：柯尔特、赫鲁米卡在「我方」，绯秋、灯在「乙」
  faction(c, { faction: "乙", unit: hiaki.id });
  faction(c, { faction: "乙", unit: tou.id });
  assert.equal(c.teammateOf(kolt, helu), true);
  assert.equal(c.teammateOf(kolt, kolt), true, "施放者自己算");
  assert.equal(c.teammateOf(kolt, hiaki), false, "敌对阵营的不算");
  assert.equal(c.teammateOf(hiaki, tou), true);
  assert.equal(c.teammateOf(null, hiaki), true);
  // 武器人跟着持有者：灯的年糕在乙
  skill(c, tou, "tou_summon");
  const mochi = c.findKit("mochi", S.units);
  assert.ok(mochi && !mochi.hidden);
  assert.equal(c.teammateOf(tou, mochi), true);
  assert.equal(c.teammateOf(mochi, hiaki), true, "武器人放的也按持有者的阵营");
  assert.equal(c.teammateOf(kolt, mochi), false);
  // 护送对象：自己记阵营（没记的在「我方」）
  const vip = c.spawnEscort({ kind: "vip" }, 5, null, 1);
  assert.equal(c.teammateOf(kolt, vip), true);
  assert.equal(c.teammateOf(hiaki, vip), false);
  faction(c, { faction: "乙", unit: vip.id });
  assert.equal(c.teammateOf(hiaki, vip), true);
  assert.equal(c.teammateOf(kolt, vip), false);
  // 单独设成友好的玩家阵营：也算自己人（#460）——给友方的范围效果（teammateOf）和单体选友方（allyOf）是同一个判断
  faction(c, { faction: "乙", other: "我方", hostile: false });
  assert.equal(c.teammateOf(kolt, hiaki), true, "友好的玩家阵营也算");
  assert.equal(c.teammateOf(hiaki, kolt), true);
  assert.equal(c.teammateOf(kolt, mochi), true, "武器人跟着持有者");
  assert.equal(c.allyOf(kolt, hiaki), true);
});

test("teammateOf：友好不传递——甲和乙、乙和丙友好，甲和丙照旧按它俩之间的设置（默认敌对）；改回默认又不算（#460）", () => {
  // 柯尔特、赫鲁米卡在「我方」，绯秋在「乙」，灯在「丙」
  const { c, heroes: [kolt, helu, hiaki, tou] } = field({ factions: (c, [, , hiaki, tou]) => {
    faction(c, { faction: "乙", unit: hiaki.id });
    faction(c, { faction: "丙", unit: tou.id });
  } });
  assert.deepEqual([c.teammateOf(kolt, hiaki), c.teammateOf(kolt, tou), c.teammateOf(hiaki, tou)], [false, false, false], "默认互相敌对");
  faction(c, { faction: "乙", other: "我方", hostile: false });
  faction(c, { faction: "乙", other: "丙", hostile: false });
  assert.equal(c.teammateOf(kolt, hiaki), true, "我方 ↔ 乙：友好");
  assert.equal(c.teammateOf(tou, hiaki), true, "丙 ↔ 乙：友好");
  assert.equal(c.teammateOf(kolt, tou), false, "我方 ↔ 丙：没设过，照旧敌对（友好不传递）");
  assert.equal(c.teammateOf(tou, helu), false);
  assert.equal(c.allyOf(kolt, tou), false, "单体选友方也一样");
  faction(c, { faction: "乙", other: "我方", hostile: null });
  assert.equal(c.teammateOf(kolt, hiaki), false, "改回默认：又是敌对");
  assert.equal(c.teammateOf(kolt, helu), true, "同阵营照旧");
});

/** 川川（哔哩哩）、诺拉（维塔斯，温和）、柯尔特、赫鲁米卡和狂徒同在 1 区。split：诺拉、赫鲁米卡分到「乙」（和我方敌对）；否则不配置阵营 */
function supportField(split) {
  const f = field({ party: ["chuan", "nora", "kolt", "helu"], seed: "PVP456-FIELD",
    factions: split ? (c, [, nora, , helu]) => [nora, helu].forEach(u => faction(c, { faction: "乙", unit: u.id })) : null });
  const [chuan, nora, kolt, helu] = f.heroes;
  const bili = f.c.spawnWeapon(chuan, "bili"), vitas = f.c.spawnWeapon(nora, "vitas");
  [bili, vitas].forEach(w => { w.zone = 1; w.level = 6; w.ap = w.apMax = 4; w.bonus = w.bonusMax = 4; });   // 磁场盾 2 级、寒气剑舞 4 级
  chuan.resources.charge = 3;
  nora.resources.mood = "gentle";
  return Object.assign(f, { chuan, nora, kolt, helu, bili, vitas, mine: [chuan, bili, kolt], theirs: [nora, vitas, helu] });
}

test("磁场盾、寒气剑舞（温和）：同区友方只算施放者的玩家阵营（武器人跟着持有者）；开着友伤也照旧给自己阵营；只有一个阵营时照旧给同区全部玩家角色", () => {
  const p = supportField(true);
  const six = [...p.mine, ...p.theirs];
  const more = (a, b) => b > a;
  assert.deepEqual(diffOf(six, shieldOf, () => skill(p.c, p.bili, "bili_field"), more), [true, true, true, false, false, false],
    "磁场盾（哔哩哩在我方）：川川、哔哩哩、柯尔特有护盾，乙的诺拉、维塔斯、赫鲁米卡没有");
  assert.equal(shieldOf(p.foe), 0);
  wound(...six);
  assert.deepEqual(diffOf(six, u => hp(p.c, u), () => skill(p.c, p.vitas, "vitas_dance", p.foe), more), [false, false, false, true, true, true],
    "寒气剑舞（维塔斯在乙，温和）：乙的诺拉、维塔斯、赫鲁米卡恢复，我方的不恢复");
  // 友伤开关不管这些：开着友伤时自己阵营的队友照旧吃增益
  p.c.Commands.dispatch({ type: "battle.friendlyFire", on: true });
  p.chuan.resources.charge = 3;
  assert.deepEqual(diffOf([p.kolt, p.helu], shieldOf, () => skill(p.c, p.bili, "bili_field"), more), [true, false], "开着友伤：柯尔特照旧有护盾，乙的照旧没有");
  // 对照：没配置阵营（全在「我方」）——同区六人都有护盾、能治疗的都恢复，和以前一样
  const q = supportField(false);
  const all = [...q.mine, ...q.theirs];
  assert.ok(diffOf(all, shieldOf, () => skill(q.c, q.bili, "bili_field"), more).every(Boolean), "没配置阵营：同区六人都有护盾");
  const healable = all.filter(u => u !== q.bili);   // 哔哩哩只有护盾层（刚满），没有可以治疗的血量
  wound(...healable);
  assert.ok(diffOf(healable, u => hp(q.c, u), () => skill(q.c, q.vitas, "vitas_dance", q.foe), more).every(Boolean), "没配置阵营：同区其他五人都恢复");
});

test("全队集结、不倒战意（15 级·全部友方）：只给施放者的玩家阵营；只有一个阵营时照旧给全部队员", () => {
  // 结人（辅助 15 级）、赫鲁米卡在「我方」，柯尔特、绯秋在「乙」（field 默认的分法）；三人都改成直伤，集结给 atk +15
  const mk = split => {
    const f = field({ party: ["yuito", "helu", "kolt", "hiaki"], seed: "PVP456-RALLY", factions: split ? undefined : null });
    const [yuito, helu, kolt, hiaki] = f.heroes;
    yuito.roles = { primary: "辅助", secondary: "辅助" }; yuito.level = 15; f.c.resetBattleFlags(yuito); yuito.ap = 4; yuito.bonus = 4;
    [helu, kolt, hiaki].forEach(u => { u.roles = Object.assign({}, u.roles, { primary: "直伤" }); });
    return Object.assign(f, { yuito, helu, kolt, hiaki });
  };
  const p = mk(true);
  skill(p.c, p.yuito, "role_rally");
  assert.ok(p.yuito.resources.rallyOn);
  assert.deepEqual([p.helu, p.kolt, p.hiaki].map(u => u.rallyAtk || 0), [15, 0, 0], "全队集结：我方的赫鲁米卡拿到，乙的柯尔特、绯秋同区也不拿");
  assert.ok(!p.kolt.rallyBy && !p.hiaki.rallyBy);
  skill(p.c, p.yuito, "role_sturdy", null, { mode: "all" });
  assert.deepEqual([p.yuito, p.helu, p.kolt, p.hiaki].map(u => !!u.statuses.sturdy), [true, true, false, false], "不倒战意·全部友方：只有我方坚挺");
  // 对照：没配置阵营
  const q = mk(false);
  skill(q.c, q.yuito, "role_rally");
  assert.deepEqual([q.helu, q.kolt, q.hiaki].map(u => u.rallyAtk || 0), [15, 15, 15], "没配置阵营：同区队员都拿到");
  skill(q.c, q.yuito, "role_sturdy", null, { mode: "all" });
  assert.ok([q.yuito, q.helu, q.kolt, q.hiaki].every(u => u.statuses.sturdy), "没配置阵营：全部坚挺");
});

test("全反击、防守反击（全队）：只算和格挡者同一个玩家阵营的人放的；只有一个阵营时照旧", () => {
  const mk = split => {
    const f = field({ seed: "PVP456-REFLECT", factions: split ? undefined : null });
    const [kolt] = f.heroes;
    kolt.resources.allReflect = true; kolt.resources.guardStrike = true;   // 柯尔特（我方）这一回合放了全反击、防守反击
    return f;
  };
  const p = mk(true);
  const [kolt, helu, hiaki, tou] = p.heroes;
  // 乙的灯替乙的绯秋挡住狂徒：柯尔特的全反击 / 防守反击不管
  const theirs = p.c.performAssistBlock(tou, hiaki, p.foe, { ok: true, roll: 1 });
  assert.equal(theirs.ok, true);
  assert.doesNotMatch(theirs.notes.join("\n"), /全反击|防守反击/, "敌对阵营的人挡住：不反伤、不追加协助攻击");
  assert.ok(!kolt.resources.guardStrikeUsed);
  // 我方的赫鲁米卡打乙的绯秋、乙的灯挡住：柯尔特的防守反击不会反过来打自己阵营的赫鲁米卡（以前会）
  const hpHelu = hp(p.c, helu);
  const back = p.c.performAssistBlock(tou, hiaki, helu, { ok: true, roll: 1 });
  assert.doesNotMatch(back.notes.join("\n"), /防守反击|全反击/);
  assert.equal(hp(p.c, helu), hpHelu, "赫鲁米卡没挨自己人的协助攻击");
  // 我方的赫鲁米卡替柯尔特挡住：照常
  const mine = p.c.performAssistBlock(helu, kolt, p.foe, { ok: true, roll: 1 });
  assert.match(mine.notes.join("\n"), /全反击：把伤害与击破反打给/);
  assert.match(mine.notes.join("\n"), /防守反击：.+ 立刻对 .+ 发动协助攻击/);
  // 对照：没配置阵营，灯挡住也照旧触发
  const q = mk(false);
  const [, , qh, qt] = q.heroes;
  const out = q.c.performAssistBlock(qt, qh, q.foe, { ok: true, roll: 1 });
  assert.match(out.notes.join("\n"), /全反击：把伤害与击破反打给/);
  assert.match(out.notes.join("\n"), /防守反击：.+ 立刻对 .+ 发动协助攻击/);
});

test("龙哥的子弹治疗（热能轰击红弹 / 蓝弹、冷气穿刺蓝弹、洗牌连续蓝弹、手杖协助攻击）：只给龙哥的玩家阵营；只有一个阵营时照旧", () => {
  // 龙哥、柯尔特在「我方」，赫鲁米卡、绯秋在「乙」（field 默认的分法）；两个狂徒
  const mk = split => {
    const f = field({ party: ["longge", "kolt", "helu", "hiaki"], seed: "PVP456-LG", factions: split ? undefined : null,
      enemies: [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }] });
    const [lg, kolt, helu, hiaki] = f.heroes;
    lg.level = 11; lg.resources.trigger = true;
    f.heroes.forEach(u => { u.def = u.defMax = 6; });
    return Object.assign(f, { lg, kolt, helu, hiaki, four: [lg, kolt, helu, hiaki] });
  };
  // 装弹（子弹打光会锁上扳机：重新解锁）
  const load = (lg, ammo) => { Object.assign(lg.resources, { ammo: ammo.slice(), seen: ammo.map(() => true), known: ammo.length, shuffleLock: false, trigger: true }); lg.ap = 4; };
  const full = u => u.layers.forEach(l => { l.current = l.max; });
  const low = u => u.layers.forEach(l => { if (l.type !== "shield") l.current = 1; });
  const more = (a, b) => b > a;
  const p = mk(true);
  const { c, lg, kolt, helu, hiaki, four } = p;
  const [f1, f2] = p.foes;
  // 热能轰击（霰弹枪）：红弹治疗同区友方，蓝弹给同区友方各 1 冰击破
  wound(...four);
  load(lg, ["red", "blue"]);
  assert.deepEqual(diffOf(four, u => hp(c, u), () => skill(c, lg, "longge_heat", f1, { mode: "gun", target: f1.id }), more), [true, true, false, false],
    "红弹：龙哥、柯尔特（我方）恢复，乙的赫鲁米卡、绯秋不恢复");
  assert.deepEqual(diffOf(four, u => u.def, () => skill(c, lg, "longge_heat", f1, { mode: "gun", target: f1.id }), (a, b) => a - b), [1, 1, 0, 0],
    "蓝弹气化：只有我方的人各 1 冰击破");
  // 冷气穿刺（霰弹枪 · 蓝弹）：治疗目标那一区的友方
  f2.zone = 2; kolt.zone = 2; helu.zone = 2;
  wound(kolt, helu);
  load(lg, ["blue"]);
  assert.deepEqual(diffOf([kolt, helu], u => hp(c, u), () => skill(c, lg, "longge_chill", f2, { mode: "gun", target: f2.id }), more), [true, false],
    "冷气穿刺蓝弹：那一区我方的柯尔特恢复，乙的赫鲁米卡不恢复");
  // 洗牌连续蓝弹：治疗血量比例最低的队友——乙的赫鲁米卡更低也不算
  kolt.zone = helu.zone = 1;
  full(lg); wound(kolt); low(helu);
  load(lg, ["blue", "blue", "blue"]);
  assert.deepEqual(diffOf([kolt, helu], u => hp(c, u), () => skill(c, lg, "longge_shuffle"), more), [true, false], "洗牌：治疗我方的柯尔特，不治疗乙的赫鲁米卡");
  // 手杖协助攻击：自动挑的、玩家挑的都只能是龙哥阵营的人（挑了乙的人就改给自己阵营血量比例最低的）
  full(lg); wound(kolt); low(helu);
  assert.equal(c.longgeHealPick(lg), kolt, "自动挑：乙的赫鲁米卡血量比例最低也不挑");
  load(lg, ["blue", "blue"]);
  Object.assign(lg.resources, { assistMode: "cane", assistHeal: helu.id });
  p.S.attackerId = lg.id; p.S.targetId = f1.id;
  assert.deepEqual(diffOf([kolt, helu], u => hp(c, u), () => c.runSkill("longge_assist", { ignorePhase: true, free: true }), more), [true, false],
    "手杖协助攻击：挑了乙的赫鲁米卡也不给，改给柯尔特");
  // 对照：没配置阵营——同区的人都算
  const q = mk(false);
  wound(...q.four);
  load(q.lg, ["red"]);
  assert.ok(diffOf(q.four, u => hp(q.c, u), () => skill(q.c, q.lg, "longge_heat", q.foes[0], { mode: "gun", target: q.foes[0].id }), more).every(Boolean), "没配置阵营：红弹四人都恢复");
  full(q.lg); wound(q.kolt); low(q.helu); full(q.hiaki);
  load(q.lg, ["blue", "blue"]);
  assert.deepEqual(diffOf([q.kolt, q.helu], u => hp(q.c, u), () => skill(q.c, q.lg, "longge_shuffle"), more), [false, true], "没配置阵营：洗牌治疗血量比例最低的赫鲁米卡");
  low(q.helu);
  assert.equal(q.c.longgeHealPick(q.lg), q.helu);
  load(q.lg, ["blue", "blue"]);
  Object.assign(q.lg.resources, { assistMode: "cane", assistHeal: q.helu.id });
  q.S.attackerId = q.lg.id; q.S.targetId = q.foes[0].id;
  assert.ok(diffOf([q.helu], u => hp(q.c, u), () => q.c.runSkill("longge_assist", { ignorePhase: true, free: true }), more)[0], "没配置阵营：手杖治疗挑的赫鲁米卡");
});

test("专长「号召」（开战时同区我方护盾）、道具烟雾弹（区域内全部友方躲藏）：只给自己的玩家阵营；只有一个阵营时照旧", () => {
  // 柯尔特有号召；split：绯秋、灯分到「乙」
  const mk = split => field({ seed: "PVP456-FEAT", factions: (c, heroes) => {
    heroes[0].feats = ["rally"];
    if (split) heroes.slice(2).forEach(h => faction(c, { faction: "乙", unit: h.id }));
  } });
  const rallied = c => { const m = logText(c).match(/号召：(.+) 获得 \d+ 点护盾/); return m ? m[1].split("、").sort() : []; };
  const smoke = f => { f.c.bagAdd("fx_smoke", 1); f.heroes[0].bonus = 1; f.c.useItemOn(f.heroes[0], "fx_smoke", null, 1); return f.heroes.map(u => !!u.statuses.hide); };
  const p = mk(true);
  const [kolt, helu] = p.heroes;
  assert.deepEqual(rallied(p.c), [kolt.name, helu.name].sort(), "号召：只有我方的柯尔特、赫鲁米卡拿到护盾");
  assert.deepEqual(smoke(p), [true, true, false, false], "烟雾弹：我方的柯尔特、赫鲁米卡躲藏，乙的绯秋、灯不躲");
  assert.ok(!(p.foe.statuses && p.foe.statuses.hide), "敌人照旧不躲");
  // 对照：没配置阵营
  const q = mk(false);
  assert.deepEqual(rallied(q.c), q.heroes.map(u => u.name).sort(), "没配置阵营：同区四人都拿到");
  assert.deepEqual(smoke(q), [true, true, true, true]);
});

test("结人酸萃 / 冷萃：给友方的那一份只给结人的自己人（同阵营、单独设成友好的阵营，#460）；敌对阵营的人照旧挨打；只有一个阵营时照旧", () => {
  // 结人、赫鲁米卡在「我方」，柯尔特、绯秋在「乙」（field 默认的分法）
  const mk = mode => {
    const f = field({ party: ["yuito", "helu", "kolt", "hiaki"], seed: "PVP456-YUITO", factions: mode ? undefined : null });
    if (mode === "friendly") faction(f.c, { faction: "乙", other: "我方", hostile: false });
    const [yuito] = f.heroes;
    yuito.level = Math.max(Number(yuito.level) || 1, 6); yuito.resources.liquid = 4; yuito.ap = 4;
    f.heroes.forEach(u => { u.defMax = 6; u.def = 3; });
    return f;
  };
  const brew = (f, id) => skill(f.c, f.heroes[0], id, null, { dest: 1 });
  const hpOf = f => u => hp(f.c, u), def = u => u.def;
  const sign = (a, b) => Math.sign(b - a);
  {
    // 乙设成和我方友好：不挨打，也吃结人的治疗 / 架势（#460：互相友好的阵营也是自己人）
    const f = mk("friendly");
    wound(...f.heroes);
    assert.deepEqual(diffOf(f.heroes, hpOf(f), () => brew(f, "yuito_extract"), sign), [1, 1, 1, 1], "酸萃：结人、赫鲁米卡恢复；友好的乙也恢复、不挨打");
    assert.deepEqual(diffOf(f.heroes, def, () => brew(f, "yuito_cold"), sign), [1, 1, 1, 1], "冷萃：结人、赫鲁米卡 +1 架势；友好的乙也 +1");
  }
  {
    // 乙和我方敌对：照旧挨打（#445），不吃治疗 / 架势（乙的两人满血：挨了酸液也不会倒地，冷萃照样打得到）
    const f = mk("hostile");
    wound(...f.heroes.slice(0, 2));
    assert.deepEqual(diffOf(f.heroes, hpOf(f), () => brew(f, "yuito_extract"), sign), [1, 1, -1, -1], "酸萃：敌对的乙挨酸液");
    assert.deepEqual(diffOf(f.heroes, def, () => brew(f, "yuito_cold"), sign), [1, 1, -1, -1], "冷萃：敌对的乙挨 1 击破");
  }
  {
    // 对照：没配置阵营——四人都恢复、都 +1 架势
    const f = mk(null);
    wound(...f.heroes);
    assert.deepEqual(diffOf(f.heroes, hpOf(f), () => brew(f, "yuito_extract"), sign), [1, 1, 1, 1]);
    assert.deepEqual(diffOf(f.heroes, def, () => brew(f, "yuito_cold"), sign), [1, 1, 1, 1]);
  }
});

test("互相友好的玩家阵营也吃给友方的范围效果（磁场盾、寒气剑舞、全队集结、不倒战意、号召、烟雾弹）；友好不传递，敌对的阵营照旧不吃（#460）", () => {
  const more = (a, b) => b > a;
  {
    // 川川（哔哩哩）、赫鲁米卡在「我方」，诺拉（维塔斯）在「乙」（和我方友好），柯尔特在「丙」（和两边都敌对）
    const f = field({ party: ["chuan", "nora", "kolt", "helu"], seed: "PVP460-FRIEND", factions: (c, [, nora, kolt]) => {
      faction(c, { faction: "乙", unit: nora.id });
      faction(c, { faction: "丙", unit: kolt.id });
      faction(c, { faction: "乙", other: "我方", hostile: false });
    } });
    const { c } = f;
    const [chuan, nora, kolt, helu] = f.heroes;
    const bili = c.spawnWeapon(chuan, "bili"), vitas = c.spawnWeapon(nora, "vitas");
    [bili, vitas].forEach(w => { w.zone = 1; w.level = 6; w.ap = w.apMax = 4; w.bonus = w.bonusMax = 4; });
    nora.resources.mood = "gentle";
    const six = [chuan, bili, helu, nora, vitas, kolt];
    const healable = six.filter(u => u !== bili);   // 哔哩哩只有护盾层，没有可以治疗的血量
    chuan.resources.charge = 3;
    assert.deepEqual(diffOf(six, shieldOf, () => skill(c, bili, "bili_field"), more), [true, true, true, true, true, false],
      "磁场盾（哔哩哩在我方）：我方和友好的乙都有护盾，敌对的丙（柯尔特）没有");
    wound(...healable);
    assert.deepEqual(diffOf(healable, u => hp(c, u), () => skill(c, vitas, "vitas_dance", f.foe), more), [true, true, true, true, false],
      "寒气剑舞（维塔斯在乙，温和）：乙和友好的我方都恢复，丙不恢复");
    // 乙和丙也设成友好（我方和丙之间没设：照旧敌对）——乙的剑舞给丙，我方的磁场盾照旧不给丙
    faction(c, { faction: "乙", other: "丙", hostile: false });
    chuan.resources.charge = 3;
    assert.deepEqual(diffOf([nora, kolt], shieldOf, () => skill(c, bili, "bili_field"), more), [true, false], "磁场盾（我方）：丙照旧没有（友好不传递）");
    wound(...healable);
    assert.deepEqual(diffOf([chuan, kolt], u => hp(c, u), () => skill(c, vitas, "vitas_dance", f.foe), more), [true, true], "寒气剑舞（乙）：丙也恢复了");
  }
  {
    // 结人（辅助 15 级）、赫鲁米卡在「我方」，柯尔特在「乙」（友好），绯秋在「丙」（敌对）；三人都改成直伤，集结给 atk +15
    const f = field({ party: ["yuito", "helu", "kolt", "hiaki"], seed: "PVP460-RALLY", factions: (c, [, , kolt, hiaki]) => {
      faction(c, { faction: "乙", unit: kolt.id });
      faction(c, { faction: "丙", unit: hiaki.id });
      faction(c, { faction: "乙", other: "我方", hostile: false });
    } });
    const [yuito, helu, kolt, hiaki] = f.heroes;
    yuito.roles = { primary: "辅助", secondary: "辅助" }; yuito.level = 15; f.c.resetBattleFlags(yuito); yuito.ap = 4; yuito.bonus = 4;
    [helu, kolt, hiaki].forEach(u => { u.roles = Object.assign({}, u.roles, { primary: "直伤" }); });
    skill(f.c, yuito, "role_rally");
    assert.deepEqual([helu, kolt, hiaki].map(u => u.rallyAtk || 0), [15, 15, 0], "全队集结：友好的乙（柯尔特）也拿到，丙（绯秋）不拿");
    skill(f.c, yuito, "role_sturdy", null, { mode: "all" });
    assert.deepEqual([yuito, helu, kolt, hiaki].map(u => !!u.statuses.sturdy), [true, true, true, false], "不倒战意·全部友方：友好的乙也坚挺");
  }
  {
    // 柯尔特有号召；柯尔特、赫鲁米卡在「我方」，绯秋在「乙」（友好），灯在「丙」（敌对）
    const f = field({ seed: "PVP460-FEAT", factions: (c, [kolt, , hiaki, tou]) => {
      kolt.feats = ["rally"];
      faction(c, { faction: "乙", unit: hiaki.id });
      faction(c, { faction: "丙", unit: tou.id });
      faction(c, { faction: "乙", other: "我方", hostile: false });
    } });
    const [kolt, helu, hiaki, tou] = f.heroes;
    const m = logText(f.c).match(/号召：(.+) 获得 \d+ 点护盾/);
    assert.deepEqual(m ? m[1].split("、").sort() : [], [kolt.name, helu.name, hiaki.name].sort(), "号召：友好的乙（绯秋）也拿到护盾，丙（灯）不拿");
    f.c.bagAdd("fx_smoke", 1); kolt.bonus = 1;
    f.c.useItemOn(kolt, "fx_smoke", null, 1);
    assert.deepEqual([kolt, helu, hiaki, tou].map(u => !!u.statuses.hide), [true, true, true, false], "烟雾弹：友好的乙也躲藏，丙不躲");
  }
});

test("全反击 / 防守反击：友好的阵营的格挡也触发；友好不传递时防守反击不去打自己人（放的人和进攻者也友好），进攻者和放的人敌对时照常（#460）", () => {
  // 柯尔特在「我方」（放了全反击、防守反击），绯秋、灯在「乙」（和我方友好），赫鲁米卡在「丙」（和乙敌对；friendly 时和我方友好）
  const mk = friendly => field({ seed: "PVP460-GUARD", factions: (c, [, helu, hiaki, tou]) => {
    faction(c, { faction: "乙", unit: hiaki.id });
    faction(c, { faction: "乙", unit: tou.id });
    faction(c, { faction: "丙", unit: helu.id });
    faction(c, { faction: "乙", other: "我方", hostile: false });
    if (friendly) faction(c, { faction: "丙", other: "我方", hostile: false });
  } });
  {
    // 丙和我方敌对：赫鲁米卡（丙）打绯秋（乙）、灯（乙）挡住——柯尔特的全反击、防守反击都照常（友好的乙的格挡也算全队）
    const { c, heroes: [kolt, helu, hiaki, tou] } = mk(false);
    Object.assign(kolt.resources, { allReflect: true, guardStrike: true });
    const out = c.performAssistBlock(tou, hiaki, helu, { ok: true, roll: 1 });
    assert.equal(out.ok, true);
    assert.match(out.notes.join("\n"), /全反击：把伤害与击破反打给/);
    assert.match(out.notes.join("\n"), new RegExp(`防守反击：${kolt.name} 立刻对 ${helu.name} 发动协助攻击`));
  }
  {
    // 丙也和我方友好：全反击照常（反打的是挡住的灯，灯和丙敌对），防守反击不追加——柯尔特不去打和自己友好的赫鲁米卡
    const { c, heroes: [kolt, helu, hiaki, tou] } = mk(true);
    Object.assign(kolt.resources, { guardStrike: true });
    const h0 = hp(c, helu);
    const out = c.performAssistBlock(tou, hiaki, helu, { ok: true, roll: 1 });
    assert.equal(out.ok, true);
    assert.doesNotMatch(out.notes.join("\n"), /防守反击/, "不打自己人");
    assert.equal(hp(c, helu), h0, "赫鲁米卡没挨柯尔特的协助攻击");
    assert.ok(!kolt.resources.guardStrikeUsed, "这次没用掉，留给下一次");
  }
});

/** 会放给友方的范围技能的打法（自动对打用）：每人每回合每招最多一次——唤出武器人、磁场盾、寒气剑舞（先安抚成温和）、酸萃 / 冷萃、
 *  全队集结、不倒战意（全部友方）、全反击、防守反击、龙哥的热能轰击 / 冷气穿刺（霰弹枪）/ 洗牌、烟雾弹（每人一次）；都用不了就照默认打法 */
function supportPolicy(c) {
  const S = c.S.state;
  const used = new Set();
  const go = (u, id, target, picks) => {
    const key = [u.id, id, S.turnNo, S.combatPhase].join(":");
    if (used.has(key) || !(c.skillList(u) || []).some(s => s.id === id)) return null;
    S.skillFlow = picks ? { id, picks } : null;   // 不倒战意·全部友方按分步收行动点
    let cost;
    try { cost = c.skillCost(id) || {}; } finally { S.skillFlow = null; }
    if ((cost.ap || 0) > (u.ap || 0) || (cost.bonus || 0) > (u.bonus || 0) || c.skillRequirementError(u, id)) return null;
    used.add(key);
    return () => skill(c, u, id, target, picks);
  };
  // 范围技能里的攻击只打非玩家单位（两个阵营对打时也一样），普攻照默认打法
  const near = (u, d) => c.hostilesOf(u).filter(f => !f.isPlayer && c.zoneDist(u.zone, f.zone, S.zoneMode) === d && !f.untargetable && !c.lineBlocked(u.zone, f.zone));
  return {
    act(u) {
      const kit = k => c.findKit(k, S.units), r = u.resources || {};
      const tries = u.dying || u.stunned ? [] : [
        () => u.kit === "chuan" && go(u, "chuan_summon"),
        () => u.kit === "nora" && go(u, "nora_summon"),
        () => u.kit === "nora" && c.noraMood(u) !== "gentle" && go(u, "nora_soothe"),
        () => u.kit === "bili" && (Number(kit("chuan").resources.charge) || 0) >= 1 && go(u, "bili_field"),
        () => u.kit === "vitas" && c.noraMood(kit("nora")) === "gentle" && near(u, 0).length && go(u, "vitas_dance", near(u, 0)[0]),
        () => go(u, "role_rally"),
        // 结人一回合只有一个行动点：按回合轮着放不倒战意（全部友方）、酸萃、冷萃
        () => S.turnNo % 3 === 2 && go(u, "role_sturdy", null, { mode: "all" }),
        () => u.kit === "yuito" && S.turnNo % 3 !== 2 && (Number(r.liquid) || 0) >= 1 && !c.fieldChangeWhy(Number(u.zone), S.turnNo % 3 ? "acid" : "ice") &&
          go(u, S.turnNo % 3 ? "yuito_extract" : "yuito_cold", null, { dest: Number(u.zone) }),
        () => go(u, "role_all_reflect"),
        () => go(u, "role_guard_strike"),
        () => u.kit === "longge" && S.turnNo % 2 === 0 && !r.shuffleLock && (r.ammo || []).length >= 2 && go(u, "longge_shuffle"),
        () => u.kit === "longge" && !r.trigger && (r.ammo || []).length && go(u, "longge_safety"),
        () => u.kit === "longge" && r.trigger && near(u, 0).length && go(u, "longge_heat", near(u, 0)[0], { mode: "gun", target: near(u, 0)[0].id }),
        () => u.kit === "longge" && r.trigger && near(u, 1).length && go(u, "longge_chill", near(u, 1)[0], { mode: "gun", target: near(u, 1)[0].id }),
        () => !u.weaponOf && (u.bonus || 0) >= 1 && c.bagCount("fx_smoke") > 0 && !used.has(u.id + ":smoke") && (used.add(u.id + ":smoke"),
          () => c.Commands.dispatch({ type: "useItem", actor: u.id, item: "fx_smoke", target: null, dest: Number(u.zone) }))
      ];
      for (const t of tries) { const thunk = t(); if (thunk) return thunk; }
      return c.BattleSim.BASIC_POLICY.act(u);
    },
    longgeSafety() { return false; }
  };
}

test("只有一个玩家阵营时一切照旧：同一种子整场自动对打（放磁场盾、寒气剑舞、全队集结……的打法），不配置 / 全在「我方」/ 多一个没人的阵营结果和整场记录一模一样；两个敌对阵营对打时这些效果从不给到对面", () => {
  const MARKS = { 磁场盾: /磁场盾：同区友方各获得/, 寒气剑舞: /温和：同区友方各恢复/, 全队集结: /全队集结：同区队员获得/, 不倒战意: /不倒战意：全部友方/,
    号召: /号召：/, 烟雾弹: /使用烟雾弹/, 酸萃: /酸萃掷骰/, 冷萃: /区变为冻土/, 热能轰击: /热能轰击（霰弹枪/ };
  const AOE = ["bili_field", "vitas_dance", "role_rally", "role_sturdy", "longge_heat", "longge_chill", "longge_shuffle", "longge_assist", "yuito_extract", "yuito_cold", "feat:battleStart", "item"];
  const cases = [
    { party: ["chuan", "nora", "yuito", "longge"], roles: { yuito: "辅助", chuan: "护卫" }, feats: { nora: ["rally"] }, seed: "PVP456-AUTO-A",
      marks: ["磁场盾", "寒气剑舞", "全队集结", "不倒战意", "号召", "烟雾弹", "酸萃", "冷萃", "热能轰击"] },
    { party: ["yuito", "chuan", "kolt", "nora"], roles: { yuito: "辅助", kolt: "护卫" }, feats: { kolt: ["rally"] }, seed: "PVP456-AUTO-B",
      marks: ["磁场盾", "寒气剑舞", "全队集结", "不倒战意", "号召", "烟雾弹", "酸萃", "冷萃"] }
  ];
  for (const cs of cases) {
    const sim = mode => {
      const c = H.load();
      c.BattleSim.setup({ party: cs.party, seed: cs.seed, zoneMode: 3,
        enemies: [{ id: "thug_knife", lv: 8, zone: 1 }, { id: "thug_hammer", lv: 8, zone: 2 }, { id: "guard_sword", lv: 8, zone: 2 }],
        before(S) {
          S.units.filter(u => u.isPlayer).forEach(u => {
            u.level = 15;
            Object.keys(u.weaponLevels || {}).forEach(k => { u.weaponLevels[k] = 6; });   // 武器人的技能按武器等级解锁
            if (cs.roles[u.kit]) u.roles = { primary: cs.roles[u.kit], secondary: cs.roles[u.kit] };
            if (cs.feats[u.kit]) u.feats = cs.feats[u.kit].slice();
            c.resetBattleFlags(u);
          });
        } });
      const S = c.S.state;
      S.units.forEach(u => { if (!u.hidden) u.zone = 1; });   // 全在 1 区：范围效果一开打就同区
      c.findKit("chuan", S.units).resources.charge = 4;
      c.findKit("yuito", S.units).resources.liquid = 4;
      c.bagAdd("fx_smoke", 2);
      if (mode === "all") faction(c, { faction: "我方" });                    // 配置了，但全部在「我方」
      if (mode === "empty") faction(c, { faction: "乙", phase: "enemy" });    // 多一个没人的阵营
      const cross = [];
      if (mode === "pvp") {
        // 后两名角色分到「乙」（和我方敌对）；记下给友方的范围效果给到了哪个阵营的人
        cs.party.slice(2).forEach(k => faction(c, { faction: "乙", unit: c.findKit(k, S.units).id }));
        const stack = [];
        const wrap = (name, top) => { const f = c[name]; c[name] = function () { stack.push(top(arguments)); try { return f.apply(this, arguments); } finally { stack.pop(); } }; };
        wrap("runSkillInner", a => ({ id: a[0], by: c.unitById(S.attackerId) }));
        wrap("featHook", a => ({ id: "feat:" + a[1], by: a[0] }));
        wrap("useItemOn", a => ({ id: "item", by: a[0] }));
        const watch = (name, who) => { const f = c[name]; c[name] = function () {
          const top = stack[stack.length - 1], u = who(arguments);
          if (top && AOE.includes(top.id) && top.by && top.by.isPlayer && u && u.isPlayer && !c.samePlayerFaction(top.by, u)) cross.push(`${top.id}：${top.by.name} → ${u.name}（${name}）`);
          return f.apply(this, arguments);
        }; };
        watch("healUnit", a => a[0]); watch("addShieldLayer", a => a[0]); watch("applyRallyBuff", a => a[0]); watch("itemApplyStatus", a => a[1]); watch("smashableBreak", a => a[1]);
      }
      const r = plain(c.BattleSim.run({ maxRounds: 12, policy: supportPolicy(c) }));
      return { r, log: logText(c), cross, pvp: c.pvpOn() };
    };
    const off = sim(null), all = sim("all"), empty = sim("empty");
    cs.marks.forEach(k => assert.match(off.log, MARKS[k], `${cs.seed}：这一场放了${k}`));
    assert.deepEqual(all.r, off.r, cs.seed + "：全部在「我方」——结果一样");
    assert.equal(all.log, off.log, cs.seed + "：整场记录一样");
    assert.deepEqual(empty.r, off.r, cs.seed + "：多一个没人的阵营——结果一样");
    assert.equal(empty.log, off.log, cs.seed + "：整场记录一样");
    // 两个敌对的玩家阵营：照样放了这些技能，但从不给到对面
    const pvp = sim("pvp");
    ["磁场盾", "寒气剑舞", "全队集结", "号召", "烟雾弹"].forEach(k => assert.match(pvp.log, MARKS[k], `${cs.seed}（两个阵营）：这一场放了${k}`));
    assert.deepEqual(pvp.cross, [], cs.seed + "：给友方的范围效果没有给到敌对阵营的人");
  }
});

/* ===== 单体选友方的技能按阵营（#460）=====
 * 分步名单、扣点之前的检查（app.js · skillTargetError，专长 / 义体各自的那一份）、结算里的检查、联机出手前的校验都只认自己人
 * （enemies.js · teammateOf：同阵营或友好的阵营）。下面的局面：前两人在「我方」，第三人在「乙」（和我方友好），
 * 第四人在「丙」（和两边都敌对）；每条都再拿不配置阵营的同一个局面对照（照旧是全部玩家角色）。 */
function trio(party, split, enemies) {
  return field({ party, enemies, seed: "PVP460-ALLY", factions: split ? (c, h) => {
    faction(c, { faction: "乙", unit: h[2].id });
    faction(c, { faction: "丙", unit: h[3].id });
    faction(c, { faction: "乙", other: "我方", hostile: false });
  } : null });
}
/** 分步里某一步（key）列出的单位 id（排好序）；没有这一步返回 null */
const stepUnits = (c, id, actor, picks, key) => {
  const st = (c.skillFlowSteps(id, actor, picks || {}) || []).find(s => s.key === key);
  return st ? ids(st.units).sort() : null;
};
const idsOf = us => ids(us).sort();

test("单体选友方的技能·分步名单：只列自己人（同阵营、友好的阵营），敌对阵营的人不列；没配置阵营时照旧是全部玩家角色（#460）", () => {
  for (const split of [true, false]) {
    const tag = split ? "" : "（没配置阵营）";
    {
      // 结人：助威（10 级起走分步）、双重奏、冰美式（治疗）、意式浓缩（行动点）；保释、借力的名单
      const { c, heroes: [yuito, helu, kolt, hiaki] } = trio(["yuito", "helu", "kolt", "hiaki"], split);
      yuito.level = 10;
      const mine = split ? [yuito, helu, kolt] : [yuito, helu, kolt, hiaki];   // 含结人自己
      const others = mine.filter(u => u !== yuito);
      assert.deepEqual(stepUnits(c, "yuito_inspire", yuito, {}, "target"), idsOf(others), "助威" + tag);
      assert.deepEqual(stepUnits(c, "yuito_duet", yuito, {}, "target"), idsOf(mine), "双重奏" + tag);
      assert.deepEqual(stepUnits(c, "yuito_amer", yuito, { mode: "heal" }, "target"), idsOf(mine), "冰美式（治疗）" + tag);
      assert.deepEqual(stepUnits(c, "yuito_espresso", yuito, { mode: "ap" }, "target"), idsOf(mine), "意式浓缩（行动点）" + tag);
      assert.deepEqual(idsOf(c.shelterAllies(yuito)), idsOf(others), "保释" + tag);
      assert.deepEqual(idsOf(c.boostAllies(yuito)), idsOf(others), "借力" + tag);
    }
    {
      // 扭矩（柯尔特的武器人，跟着柯尔特的阵营）：拆卸模式的接收者；「非法」改装（废料满了）给行动点那一项只对自己人有
      const { c, heroes: [kolt, helu, hiaki, tou], foe } = trio(["kolt", "helu", "hiaki", "tou"], split);
      const torque = c.spawnWeapon(kolt, "torque");
      assert.ok(torque, "扭矩上场");
      const mine = split ? [kolt, helu, hiaki, torque] : [kolt, helu, hiaki, tou, torque];
      assert.deepEqual(stepUnits(c, "torque_strip", torque, { target: foe.id, mode: "ally" }, "ally"), idsOf(mine), "拆卸模式的接收者" + tag);
      kolt.resources.stripStore = { flesh: 999 };   // 废料达到上限
      assert.ok(c.koltScrapFull(kolt));
      const apStep = t => (c.skillFlowSteps("kolt_mod", kolt, { target: t.id }) || []).some(s => s.key === "mode");
      assert.equal(apStep(hiaki), true, "「非法」改装：友好的乙能给行动点" + tag);
      assert.equal(apStep(tou), !split, split ? "「非法」改装：敌对的丙只能过载，没有给行动点那一项" : "没配置阵营：照旧有");
      assert.equal(apStep(foe), false, "敌人照旧没有");
    }
    {
      // Helumica：环境扫描（超充能电池的护盾给谁）、拉出流沙
      const { c, S, heroes: [helu, kolt, hiaki, tou] } = trio(["helu", "kolt", "hiaki", "tou"], split);
      const p = c.makeProp("battery", 1, 3);
      S.props = [p];
      const mine = split ? [helu, kolt, hiaki] : [helu, kolt, hiaki, tou];
      assert.deepEqual(stepUnits(c, "helu_scan", helu, { dest: 1, act: "prop:" + p.id, mode: "shield" }, "ally"), idsOf(mine), "环境扫描的电池护盾" + tag);
      S.fields[1].quicksand = true;
      [kolt, hiaki, tou].forEach(u => { u.sink = 1; });
      assert.deepEqual(stepUnits(c, "sand_pull", helu, {}, "target"), idsOf(mine.filter(u => u !== helu)), "拉出流沙" + tag);
    }
    {
      // 小朋友（龙哥的武器人）：爆发治疗；专长「拉一把」：同区濒死的友方
      const { c, heroes: [lg, kolt, hiaki, tou] } = trio(["longge", "kolt", "hiaki", "tou"], split);
      const w = c.spawnWeapon(lg, "xiaoxiao");
      assert.ok(w, "小朋友上场");
      const mine = split ? [lg, kolt, hiaki, w] : [lg, kolt, hiaki, tou, w];
      assert.deepEqual(stepUnits(c, "xiaoxiao_burst", w, {}, "target"), idsOf(mine), "爆发治疗" + tag);
      kolt.feats = ["pickup"];
      [lg, hiaki, tou].forEach(u => { u.dying = true; });
      assert.deepEqual(stepUnits(c, "feat_pickup", kolt, {}, "target"), idsOf(split ? [lg, hiaki] : [lg, hiaki, tou]), "拉一把" + tag);
    }
  }
});

test("单体选友方的技能·出手前的校验：敌对阵营的人在扣点之前就拦下（职责 / 角色技能、分步里选的人、专长），友好的阵营照常；联机出手前的校验也一样（#460）", () => {
  const flow = (c, a, id, picks) => { c.S.state.attackerId = a.id; c.S.state.skillFlow = { id, actorId: a.id, picks, index: 99 }; };
  const why = (c, a, id, t, picks) => { flow(c, a, id, picks || {}); try { return c.skillTargetError(a, id, t); } finally { c.S.state.skillFlow = null; } };
  for (const split of [true, false]) {
    const tag = split ? "" : "（没配置阵营：照旧能选）";
    const blocked = (v, msg) => split ? assert.ok(v, msg) : assert.equal(v, null, msg + tag);
    {
      // 柯尔特（生存 15 级：应急处理、续命）、赫鲁米卡在「我方」，绯秋在「乙」（友好），灯在「丙」（敌对）
      const { c, heroes: [kolt, helu, hiaki, tou], foe } = trio(["kolt", "helu", "hiaki", "tou"], split);
      kolt.roles = { primary: "生存", secondary: "生存" }; kolt.level = 15; c.resetBattleFlags(kolt);
      kolt.feats = ["bandage", "skywatch", "cheer", "standin"];
      for (const id of ["role_firstaid", "role_renew", "feat_bandage", "feat_skywatch", "feat_cheer", "feat_standin"]) {
        blocked(why(c, kolt, id, tou), `${id}：敌对阵营的灯`);
        assert.equal(why(c, kolt, id, hiaki), null, `${id}：友好的乙（绯秋）能选`);
        assert.equal(why(c, kolt, id, helu), null, `${id}：同阵营能选`);
      }
      assert.match(why(c, kolt, "role_renew", foe) || "", /只能对友方使用/, "续命对敌人照旧不行");
      // 「非法」改装（废料满了）选给行动点：只有自己人
      kolt.resources.stripStore = { flesh: 999 };
      blocked(why(c, kolt, "kolt_mod", tou, { target: tou.id, mode: "ap" }), "「非法」改装给敌对阵营的人行动点");
      assert.equal(why(c, kolt, "kolt_mod", hiaki, { target: hiaki.id, mode: "ap" }), null, "给友好的乙行动点");
      assert.equal(why(c, kolt, "kolt_mod", tou, { target: tou.id, mode: "overload" }), null, "只过载：敌对阵营的人也行（敌我都能过载）");
      // 拆卸模式的接收者（扭矩 2 级起才有拆卸模式）
      const torque = c.spawnWeapon(kolt, "torque");
      torque.level = 6;
      assert.match((c.skillList(torque).find(s => s.id === "torque_strip") || {}).hint || "", /友方/, "拆卸模式：说明里写着友方");
      blocked(why(c, torque, "torque_strip", foe, { target: foe.id, mode: "ally", ally: tou.id }), "拆卸模式的接收者是敌对阵营的人");
      assert.equal(why(c, torque, "torque_strip", foe, { target: foe.id, mode: "ally", ally: hiaki.id }), null, "接收者是友好的乙");
      // 说明里写着「友方」、分步里选的目标却是敌人：照样能打敌对阵营的人（不按「给友方用的技能」拦）
      assert.equal(why(c, torque, "torque_strip", tou, { target: tou.id, mode: "scrap" }), null, "拆卸模式拆敌对阵营的人" + tag);
    }
    {
      // 结人：冰美式（治疗）、意式浓缩（行动点）、双重奏、助威（10 级起走分步）；川川：回收护盾
      const { c, heroes: [yuito, chuan, kolt, hiaki] } = trio(["yuito", "chuan", "kolt", "hiaki"], split);
      yuito.level = 10;
      blocked(why(c, yuito, "yuito_amer", hiaki, { mode: "heal", target: hiaki.id }), "冰美式治疗敌对阵营的人");
      assert.equal(why(c, yuito, "yuito_amer", kolt, { mode: "heal", target: kolt.id }), null, "冰美式治疗友好的乙");
      blocked(why(c, yuito, "yuito_espresso", hiaki, { mode: "ap", target: hiaki.id }), "意式浓缩给敌对阵营的人行动点");
      assert.equal(why(c, yuito, "yuito_espresso", hiaki, { mode: "atk", target: hiaki.id }), null, "意式浓缩的酸液攻击：敌对阵营的人照样能打");
      blocked(why(c, yuito, "yuito_duet", hiaki, { target: hiaki.id }), "双重奏治疗敌对阵营的人");
      blocked(why(c, yuito, "yuito_inspire", hiaki, { mode: "turn", target: hiaki.id }), "助威振奋敌对阵营的人");
      assert.equal(why(c, yuito, "yuito_inspire", kolt, { mode: "turn", target: kolt.id }), null, "助威友好的乙");
      c.addShieldLayer(hiaki, 5, false);   // 身上有能回收的护盾：以前只看这个
      blocked(why(c, chuan, "chuan_reclaim", hiaki), "回收敌对阵营的人的护盾");
      c.addShieldLayer(kolt, 5, false);
      assert.equal(why(c, chuan, "chuan_reclaim", kolt), null, "回收友好的乙的护盾");
    }
    {
      // 龙哥：冷气穿刺、热能轰击（扳机解锁、有子弹时说明里写着「治疗该区友方」，目标是敌人）照样能打敌对阵营的人（不按给友方的技能拦）
      const { c, heroes: [lg, kolt, hiaki, tou] } = trio(["longge", "kolt", "hiaki", "tou"], split);
      Object.assign(lg.resources, { trigger: true, ammo: ["red", "blue"], seen: [true, true], known: 2 });
      for (const id of ["longge_chill", "longge_heat"]) {
        assert.match((c.skillList(lg).find(s => s.id === id) || {}).hint || "", /友方/, id + "：说明里写着友方");
        assert.equal(why(c, lg, id, tou, { mode: "cane", target: tou.id }), null, id + "：打敌对阵营的人" + tag);
      }
      // 小朋友（龙哥的武器人）：爆发治疗、治疗支援
      const w = c.spawnWeapon(lg, "xiaoxiao");
      blocked(why(c, w, "xiaoxiao_burst", tou, { target: tou.id }), "爆发治疗敌对阵营的人");
      assert.equal(why(c, w, "xiaoxiao_burst", hiaki, { target: hiaki.id }), null, "爆发治疗友好的乙");
      blocked(why(c, w, "xiaoxiao_heal", tou), "治疗支援敌对阵营的人");
      assert.equal(why(c, w, "xiaoxiao_heal", hiaki), null, "治疗支援友好的乙");
      assert.ok(kolt);
    }
  }
  // 联机出手前的校验（hotseat-validation.js）：分步名单里没有的人选不上；单选目标的给友方技能也按阵营
  const f = trio(["yuito", "helu", "kolt", "hiaki"], true);
  const { c, heroes: [yuito, , kolt, hiaki] } = f;
  yuito.level = 10; yuito.resources.liquid = 4;   // 双重奏 9 级起、要 2 咖啡液
  load(c, ["hotseat-validation.js"]);
  const session = { assertAction: () => true }, game = { depth: 0, tape: null };
  const check = (a, sk, t, picks) => c.HotseatValidation.validateBattle({ type: "skill", actor: a.id, skill: sk, target: t.id, picks }, { session, sender: "p1", game });
  assert.throws(() => check(yuito, "yuito_amer", hiaki, { mode: "heal", target: hiaki.id }), /不合法的分步选择/, "冰美式治疗敌对阵营的人：分步名单里没有");
  assert.doesNotThrow(() => check(yuito, "yuito_amer", kolt, { mode: "heal", target: kolt.id }), "冰美式治疗友好的乙");
  assert.throws(() => check(yuito, "yuito_duet", hiaki, { target: hiaki.id }), /不合法的分步选择/, "双重奏");
});

test("单体选友方的技能·结算：直接发指令也给不到敌对阵营的人（不扣行动点、不掉咖啡液），友好的阵营照常给；没配置阵营时照旧（#460）", () => {
  for (const split of [true, false]) {
    const tag = split ? "" : "（没配置阵营）";
    // 结人、赫鲁米卡在「我方」，柯尔特在「乙」（友好），绯秋在「丙」（敌对）
    const { c, heroes: [yuito, helu, kolt, hiaki] } = trio(["yuito", "helu", "kolt", "hiaki"], split);
    yuito.level = 10; yuito.resources.liquid = 9;
    wound(kolt, hiaki);
    const hp0 = { kolt: hp(c, kolt), hiaki: hp(c, hiaki) };
    // 双重奏（2 咖啡液）：敌对的丙治不到
    const ap0 = yuito.ap, liq0 = yuito.resources.liquid;
    skill(c, yuito, "yuito_duet", hiaki, { target: hiaki.id });
    if (split) {
      assert.equal(hp(c, hiaki), hp0.hiaki, "双重奏：敌对阵营的绯秋没恢复");
      assert.deepEqual([yuito.ap, yuito.resources.liquid], [ap0, liq0], "扣点之前就拦下：行动点、咖啡液都没花");
    } else assert.ok(hp(c, hiaki) > hp0.hiaki, "双重奏" + tag);
    skill(c, yuito, "yuito_duet", kolt, { target: kolt.id });
    assert.ok(hp(c, kolt) > hp0.kolt, "双重奏：友好的乙恢复" + tag);
    // 意式浓缩（行动点）：给友好的乙 +1，敌对的丙不给
    yuito.ap = 4;
    const kap = kolt.ap, hap = hiaki.ap;
    skill(c, yuito, "yuito_espresso", kolt, { mode: "ap", target: kolt.id });
    assert.equal(kolt.ap, kap + 1, "意式浓缩：友好的乙行动点 +1" + tag);
    skill(c, yuito, "yuito_espresso", hiaki, { mode: "ap", target: hiaki.id });
    assert.equal(hiaki.ap, split ? hap : hap + 1, split ? "意式浓缩：敌对的丙没加" : "意式浓缩" + tag);
    // 助威（10 级 · 附赠）：振奋
    yuito.bonus = 4;
    skill(c, yuito, "yuito_inspire", hiaki, { mode: "turn", target: hiaki.id });
    assert.equal(!!(hiaki.statuses && hiaki.statuses.inspire), !split, split ? "助威：敌对的丙没振奋" : "助威" + tag);
    skill(c, yuito, "yuito_inspire", kolt, { mode: "turn", target: kolt.id });
    assert.equal(!!kolt.statuses.inspire, true, "助威：友好的乙振奋" + tag);
    assert.ok(helu);
  }
});

/* ===== 连锁伤害按阵营（#460）=====
 * 高能自爆的余波、感电 / 中和感电的波及打「同阵营」：炸的 / 感电的人在玩家这一边时是它的自己人（enemies.js · chainSideOf：
 * 同阵营或友好的阵营），敌对阵营的人不挨；敌人那边照旧是所有非玩家单位。局面同上（我方两人、友好的乙、敌对的丙），两个狂徒同区 */
const TWO_THUGS = [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_hammer", lv: 1, zone: 1 }];
/** fn 里 applyTypedDot 打到的单位（日志标签对得上 re 的那几下），id 排好序 */
function dotTargets(c, re, fn) {
  const out = [], f = c.applyTypedDot;
  c.applyTypedDot = function (u, dmg, el, notes, label) { if (re.test(String(label || ""))) out.push(u.id); return f.apply(this, arguments); };
  try { fn(); } finally { c.applyTypedDot = f; }
  return out.sort();
}

test("高能自爆的余波：玩家这一边炸的只打它的自己人（同阵营、友好的阵营），敌对阵营的人不挨；敌人炸的照旧打同区的敌人；没配置阵营时照旧打同区全部玩家角色（#460）", () => {
  for (const split of [true, false]) {
    const tag = split ? "" : "（没配置阵营）";
    // 柯尔特、赫鲁米卡在「我方」，绯秋在「乙」（友好），灯在「丙」（敌对）
    const { c, heroes: [kolt, helu, hiaki, tou], foes: [f1, f2] } = trio(["kolt", "helu", "hiaki", "tou"], split, TWO_THUGS);
    const hp0 = { tou: hp(c, tou), kolt: hp(c, kolt) };
    helu.statuses.high = true; helu.highEnergy = 40;
    const hitByHelu = dotTargets(c, /被高能余波击中/, () => c.explodeHigh(helu, 40));
    assert.ok(logText(c).includes("【高能自爆】" + helu.name), "赫鲁米卡高能自爆");
    assert.deepEqual(hitByHelu, idsOf(split ? [kolt, hiaki] : [kolt, hiaki, tou]), "赫鲁米卡（我方）炸：余波打我方和友好的乙" + (split ? "，不打敌对的丙" : tag));
    assert.ok(hp(c, kolt) < hp0.kolt, "柯尔特挨了余波");
    assert.equal(hp(c, tou) < hp0.tou, !split, split ? "灯（丙）没挨" : "灯也挨了" + tag);
    // 敌人炸的：照旧打同区的其他非玩家单位，不打玩家角色
    f1.statuses = f1.statuses || {}; f1.statuses.high = true;
    assert.deepEqual(dotTargets(c, /被高能余波击中/, () => c.explodeHigh(f1, 40)), [f2.id], "狂徒炸：只打另一个狂徒" + tag);
    // 判断本身（enemies.js · chainSideOf）
    assert.equal(c.chainSideOf(kolt, tou), !split, "chainSideOf：敌对阵营的人" + tag);
    assert.equal(c.chainSideOf(kolt, hiaki), true, "友好的阵营算同阵营");
    assert.equal(c.chainSideOf(kolt, f2), false, "敌人不算");
    assert.equal(c.chainSideOf(f1, f2), true, "敌人那边照旧：所有非玩家单位");
    assert.equal(c.chainSideOf(f1, kolt), false);
  }
});

test("感电 / 中和感电的波及：玩家这一边的只打同区的自己人（含自己；同阵营、友好的阵营），敌对阵营的人不挨；敌人的照旧；没配置阵营时照旧（#460）", () => {
  for (const split of [true, false]) {
    const tag = split ? "" : "（没配置阵营）";
    const { c, heroes: [kolt, helu, hiaki, tou], foes: [f1, f2] } = trio(["kolt", "helu", "hiaki", "tou"], split, TWO_THUGS);
    const mine = idsOf(split ? [kolt, helu, hiaki] : [kolt, helu, hiaki, tou]);
    // 感电触发（回合结束的那一下）：赫鲁米卡（我方）
    helu.statuses.shock = true;
    let notes = [];
    assert.deepEqual(dotTargets(c, /被感电波及/, () => { notes = c.shockPulse(helu); }), mine, "感电：我方和友好的乙（含自己）" + (split ? "，不打敌对的丙" : tag));
    const listed = ((notes[0] || "").match(/同区同阵营：([^）]*)）/) || [])[1] || "";
    assert.deepEqual(listed.split("、").sort(), (split ? [kolt, helu, hiaki] : [kolt, helu, hiaki, tou]).map(u => u.name).sort(), "记录里的同阵营名单也一样" + tag);
    // 敌对的丙（灯）自己感电：只打丙自己（我方、乙都和丙敌对）
    tou.statuses.shock = true;
    assert.deepEqual(dotTargets(c, /被感电波及/, () => c.shockPulse(tou)), split ? [tou.id] : mine, "灯（丙）感电" + tag);
    // 中和感电：一样打同区的自己人
    helu.statuses.shock = true;
    assert.deepEqual(dotTargets(c, /被中和感电波及/, () => c.applyNeutralize(helu)), mine, "中和感电" + tag);
    assert.equal(helu.statuses.shock, false, "中和后感电清掉");
    // 敌人的感电：照旧打同区的非玩家单位（含自己）
    f1.statuses = f1.statuses || {}; f1.statuses.shock = true;
    assert.deepEqual(dotTargets(c, /被感电波及/, () => c.shockPulse(f1)), idsOf([f1, f2]), "狂徒感电：两个狂徒" + tag);
  }
});

/** 会放单体给友方技能的打法（自动对打用）：每人每回合每招最多一次，每回合从不同的那一招开始试；挑人只看「是不是玩家角色」
 *  （敌对阵营的人交给规则自己拦），分步技能每一步挑名单里血量比例最低的（选项挑写好的那一项）；都用不了就照默认打法 */
function friendlyPolicy(c) {
  const S = c.S.state;
  const used = new Set();
  const ratio = u => c.totalHp(u) / Math.max(1, c.totalMaxHp(u));
  const byHp = (a, b) => ratio(a) - ratio(b) || String(a.id).localeCompare(String(b.id));
  const pals = (u, self) => S.units.filter(x => x.isPlayer && !x.dead && !x.hidden && !x.fused && (self || x.id !== u.id)).sort(byHp);
  const go = (u, id, target, picks) => {
    const key = [u.id, id, S.turnNo, S.combatPhase].join(":");
    if (used.has(key) || !(c.skillList(u) || []).some(s => s.id === id)) return null;
    S.skillFlow = picks ? { id, picks } : null;
    let cost;
    try { cost = c.skillCost(id) || {}; } finally { S.skillFlow = null; }
    if ((cost.ap || 0) > (u.ap || 0) || (cost.bonus || 0) > (u.bonus || 0) || c.skillRequirementError(u, id)) return null;
    used.add(key);
    return () => skill(c, u, id, target, picks);
  };
  const one = (u, id, t) => (t ? go(u, id, t) : null);
  const flow = (u, id, prefer) => {
    if (!(c.skillList(u) || []).some(s => s.id === id)) return null;
    const picks = {};
    let last = null;
    for (let g = 0; g < 8; g++) {
      const st = (c.skillFlowSteps(id, u, picks) || []).find(s => picks[s.key] === undefined);
      if (!st) break;
      if (st.type === "unit") {
        const list = (st.units || []).filter(x => x && c.unitById(x.id)).sort(byHp);
        if (!list.length) return null;
        picks[st.key] = list[0].id; last = list[0];
      } else if (st.type === "zone") {
        if (!(st.zones || []).length) return null;
        picks[st.key] = st.zones[0];
      } else {
        const o = (st.options || []).find(x => prefer && x.value === prefer[st.key]) || (st.options || [])[0];
        if (!o) return null;
        picks[st.key] = o.value;
      }
    }
    return go(u, id, last, picks);
  };
  return {
    act(u) {
      if (u.dying || u.stunned) return c.BattleSim.BASIC_POLICY.act(u);
      const near1 = x => c.zoneDist(u.zone, x.zone, S.zoneMode) <= 1;
      const tries = [
        () => flow(u, "yuito_duet"),
        () => flow(u, "yuito_amer", { mode: "heal" }),
        () => flow(u, "yuito_espresso", { mode: "ap" }),
        () => flow(u, "yuito_inspire", { mode: "turn" }),
        () => one(u, "role_firstaid", pals(u).find(near1)),
        () => one(u, "role_buffer", pals(u).find(near1)),
        () => one(u, "role_cover", pals(u)[0]),
        () => flow(u, "role_shelter"),
        () => flow(u, "sand_pull"),
        () => one(u, "feat_bandage", pals(u, true).find(x => near1(x) && !x.dying)),
        () => one(u, "feat_cheer", pals(u)[0]),
        () => flow(u, "kolt_mod", { mode: "ap" })
      ];
      const start = (Number(S.turnNo) * 7 + S.units.indexOf(u) * 3) % tries.length;
      for (let i = 0; i < tries.length; i++) { const thunk = tries[(start + i) % tries.length](); if (thunk) return thunk; }
      return c.BattleSim.BASIC_POLICY.act(u);
    },
    longgeSafety() { return false; }
  };
}

test("单体选友方 / 连锁伤害：同一种子整场自动对打，不配置 / 全在「我方」/ 多一个没人的阵营结果和整场记录一模一样；两个敌对阵营对打时治疗、护盾、行动点…从不给到对面，余波、感电也从不打到对面（#460）", () => {
  const MARKS = { 应急处理: /应急处理：/, 缓冲: /缓冲：/, 掩护: /掩护：/, 保释: /本回合豁免天气与场地/, 拉出流沙: /拉出流沙|拽了上来/, 双重奏: /双重奏：/,
    助威: /振奋（助威/, 战地包扎: /战地包扎：/, 打气: /打气：/, 高能自爆: /【高能自爆】/, 余波: /被高能余波击中/, 感电波及: /被感电波及/ };
  const cases = [
    { party: ["yuito", "kolt", "helu", "tou"], roles: { kolt: "生存", helu: "环境手", tou: "护卫" }, feats: { kolt: ["cheer"], helu: ["bandage"], tou: ["bandage"] }, seed: "PVP460-AUTO-A",
      enemies: [{ id: "watchcrow", lv: 9, zone: 1 }, { id: "patrolboat", lv: 9, zone: 2 }, { id: "alarm_bot", lv: 9, zone: 2 }],
      marks: ["应急处理", "缓冲", "掩护", "保释", "拉出流沙", "双重奏", "战地包扎", "高能自爆", "余波", "感电波及"] },
    { party: ["helu", "yuito", "hiaki", "kolt"], roles: { hiaki: "生存", helu: "辅助", kolt: "环境手" }, feats: { helu: ["bandage"], hiaki: ["cheer"] }, seed: "PVP460-AUTO-B",
      enemies: [{ id: "thug_knife", lv: 9, zone: 1 }, { id: "watchcrow", lv: 9, zone: 2 }, { id: "guard_sword", lv: 9, zone: 2 }],
      marks: ["应急处理", "缓冲", "保释", "拉出流沙", "双重奏", "助威", "战地包扎", "打气", "高能自爆", "余波", "感电波及"] }
  ];
  for (const cs of cases) {
    const sim = mode => {
      const c = H.load();
      c.BattleSim.setup({ party: cs.party, seed: cs.seed, zoneMode: 3, enemies: cs.enemies, before(S) {
        S.units.filter(u => u.isPlayer).forEach(u => {
          u.level = 15;
          if (cs.roles[u.kit]) u.roles = { primary: cs.roles[u.kit], secondary: cs.roles[u.kit] };
          if (cs.feats[u.kit]) u.feats = cs.feats[u.kit].slice();
          c.resetBattleFlags(u);
        });
      } });
      const S = c.S.state;
      const heroes = S.units.filter(u => u.isPlayer && !u.hidden), foes = S.units.filter(u => !u.isPlayer && !u.hidden);
      heroes.forEach(u => { u.zone = 1; });
      c.findKit("yuito", S.units).resources.liquid = 12;
      c.findKit("kolt", S.units).resources.stripStore = { flesh: 999 };   // 「非法」改装的废料满了
      // 流沙：一半的人陷进去；连锁伤害：两名玩家角色感电、一名高能（高能值接近血量），敌人也各上一种
      S.fields[1].quicksand = true;
      heroes.forEach((u, i) => { if (i % 2) u.sink = 1; });
      [heroes[0], heroes[2]].forEach(u => { u.statuses = u.statuses || {}; u.statuses.shock = true; });
      Object.assign(heroes[1].statuses = heroes[1].statuses || {}, { high: true });
      heroes[1].highEnergy = Math.floor(c.totalHp(heroes[1]) * 0.7);
      foes[0].statuses = Object.assign(foes[0].statuses || {}, { shock: true });
      foes[1].statuses = Object.assign(foes[1].statuses || {}, { high: true });
      foes[1].highEnergy = Math.floor(c.totalHp(foes[1]) * 0.6);
      if (mode === "all") faction(c, { faction: "我方" });
      if (mode === "empty") faction(c, { faction: "乙", phase: "enemy" });
      const cross = [];
      if (mode === "pvp") {
        // 后两名角色分到「乙」（和我方敌对）；记下给友方的效果、连锁伤害落到敌对阵营的人身上的次数
        heroes.slice(2).forEach(h => faction(c, { faction: "乙", unit: h.id }));
        const stack = [];
        const wrap = (name, top) => { const f = c[name]; c[name] = function () { stack.push(top(arguments)); try { return f.apply(this, arguments); } finally { stack.pop(); } }; };
        wrap("runSkillInner", () => ({ kind: "skill", by: c.unitById(S.attackerId) }));
        wrap("explodeHigh", a => ({ kind: "chain", by: a[0] }));
        wrap("shockPulse", a => ({ kind: "chain", by: a[0] }));
        const watch = (name, who, kind) => { const f = c[name]; c[name] = function () {
          const top = stack[stack.length - 1], u = who(arguments);
          if (top && top.kind === kind && top.by && top.by.isPlayer && u && u.isPlayer && c.pvpFoe(top.by, u)) cross.push(`${name}：${top.by.name} → ${u.name}`);
          return f.apply(this, arguments);
        }; };
        ["healUnit", "addShieldLayer", "addTempLayer", "clearSink"].forEach(n => watch(n, a => a[0], "skill"));
        watch("grantAllyAp", a => a[1], "skill");
        watch("applyTypedDot", a => (/被高能余波击中|被感电波及/.test(String(a[4] || "")) ? a[0] : null), "chain");
      }
      const r = plain(c.BattleSim.run({ maxRounds: 12, policy: friendlyPolicy(c) }));
      return { r, log: logText(c), cross };
    };
    const off = sim(null), all = sim("all"), empty = sim("empty");
    cs.marks.forEach(k => assert.match(off.log, MARKS[k], `${cs.seed}：这一场放了${k}`));
    assert.deepEqual(all.r, off.r, cs.seed + "：全部在「我方」——结果一样");
    assert.equal(all.log, off.log, cs.seed + "：整场记录一样");
    assert.deepEqual(empty.r, off.r, cs.seed + "：多一个没人的阵营——结果一样");
    assert.equal(empty.log, off.log, cs.seed + "：整场记录一样");
    const pvp = sim("pvp");
    ["保释", "拉出流沙", "双重奏", "高能自爆", "余波", "感电波及"].forEach(k => assert.match(pvp.log, MARKS[k], `${cs.seed}（两个阵营）：这一场有${k}`));
    assert.deepEqual(pvp.cross, [], cs.seed + "：给友方的效果、连锁伤害没有落到敌对阵营的人身上");
  }
});

/* ===== 协助格挡、载具代挡按阵营（#463）=====
 * 协助格挡（含掩护 / 挺身的免费格挡、以身作盾）：被打的人的自己人（enemies.js · teammateOf：同阵营或友好的阵营）都能挡，敌对阵营的人照旧不能；
 * 友好不传递时不在两个自己人之间出手（enemies.js · otherFactionFriend，和 #460 的防守反击同一个判断）。
 * 载具代挡（vehicle.js · vehicleGuards / vehicleGuard）：有人驾驶的车按驾驶员的阵营——只替驾驶员的自己人挡，自己人打的不挡；
 * 空车在场上有两个以上玩家阵营（app.js · pvpSplit）时谁都不替挡，只有一个玩家阵营时照旧替最后坐在车上的一方。
 * 局面同上（trio：前两人在「我方」，第三人在「乙」（和我方友好），第四人在「丙」（和两边都敌对）），每条都拿不配置阵营的同一个局面对照。 */
const blockersOf = (c, target, attacker) => idsOf(c.eligibleBlockers(target, { attackerId: attacker.id, targetId: target.id, tried: [] }));

test("协助格挡：互相友好的玩家阵营也能替被打的人挡（连续协助格挡、以身作盾同一个判断），敌对阵营的人照旧不能；没配置阵营时照旧全队都能挡（#463）", () => {
  // 狂徒真的打出去的那几下不带灯（灯的决一死战：同区只有一个敌人时它只打得到灯）
  {
    // 柯尔特、赫鲁米卡在「我方」，绯秋在「乙」（友好），川川在「丙」（敌对）
    const { c, S, heroes: [kolt, helu, hiaki, chuan], foe } = trio(["kolt", "helu", "hiaki", "chuan"], true);
    // 狂徒打乙的绯秋：友好的我方两人都能挡，敌对的丙不能（以前只有乙自己的人能挡：同区没有，直接落下）
    const h0 = hp(c, hiaki);
    const out = strike(c, foe, hiaki);
    assert.equal(out.pending, true, "等友好阵营的人协助格挡");
    assert.deepEqual(idsOf(c.eligibleBlockers(hiaki, S.blockQueue[0])), idsOf([kolt, helu]), "友好的我方两人能挡，丙的川川不能");
    // 连续协助格挡：柯尔特没挡住，赫鲁米卡接着挡住
    c.finishBlock(kolt.id, { roll: 100, ok: false });
    assert.equal(S.blockQueue.length, 1, "柯尔特没挡住：这一击还没落下");
    assert.deepEqual(ids(c.eligibleBlockers(hiaki, S.blockQueue[0])), [helu.id], "剩下赫鲁米卡能接着挡");
    c.finishBlock(helu.id, { roll: 1, ok: true });
    assert.equal(S.blockQueue.length, 0);
    assert.match(logText(c), new RegExp(`${helu.name} 协助格挡 ${hiaki.name}：d100=1 .*→ 成功`));
    assert.equal(hp(c, hiaki), h0, "赫鲁米卡挡住：绯秋没受伤");
    // 丙的川川打我方的柯尔特：同阵营的赫鲁米卡、友好的乙的绯秋都能挡
    assert.deepEqual(blockersOf(c, kolt, chuan), idsOf([helu, hiaki]));
    assert.deepEqual(blockersOf(c, kolt, foe), idsOf([helu, hiaki]), "狂徒打过来也一样");
    // 狂徒打丙的川川：我方、乙都和丙敌对，谁都不能挡
    assert.deepEqual(blockersOf(c, chuan, foe), [], "敌对阵营的人照旧不能帮忙挡");
    // 以身作盾（专长）：同一个判断（宣布的人自己挨打也能宣布）
    [helu, hiaki, chuan].forEach(u => { u.feats = ["ironwall"]; });
    assert.deepEqual(idsOf(c.featIronwallDeclarers(kolt, foe)), idsOf([helu, hiaki]), "以身作盾：同阵营、友好的乙能替柯尔特挡，丙不能");
    assert.deepEqual(idsOf(c.featIronwallDeclarers(hiaki, foe)), idsOf([helu, hiaki]), "替友好的乙挡");
    assert.deepEqual(idsOf(c.featIronwallDeclarers(chuan, foe)), [chuan.id], "丙：只有自己");
  }
  {
    // 对照：没配置阵营——同区的人都能挡
    const { c, heroes: [kolt, helu, hiaki, chuan], foe } = trio(["kolt", "helu", "hiaki", "chuan"], false);
    assert.deepEqual(blockersOf(c, hiaki, foe), idsOf([kolt, helu, chuan]));
    assert.deepEqual(blockersOf(c, chuan, foe), idsOf([kolt, helu, hiaki]));
    [helu, hiaki, chuan].forEach(u => { u.feats = ["ironwall"]; });
    assert.deepEqual(idsOf(c.featIronwallDeclarers(kolt, foe)), idsOf([helu, hiaki, chuan]));
  }
});

test("掩护、挺身：给友好阵营的人掩护 / 挺身以后能免费替他挡（不花附赠）；敌对阵营的人照旧挡不了（#463）", () => {
  // 柯尔特（护卫：掩护）、赫鲁米卡（专长挺身）在「我方」，绯秋在「乙」（友好），川川在「丙」（敌对）
  const { c, S, heroes: [kolt, helu, hiaki, chuan], foe } = trio(["kolt", "helu", "hiaki", "chuan"], true);
  kolt.roles = { primary: "护卫", secondary: "护卫" }; c.resetBattleFlags(kolt); kolt.ap = 4; kolt.bonus = 4;
  helu.feats = ["standin"];
  skill(c, kolt, "role_cover", hiaki);
  assert.equal(hiaki.coverBy, kolt.id, "掩护友好的乙（#460 起就选得上）");
  kolt.bonus = 0; helu.bonus = 0;   // 都没有附赠了：只有掩护的人能免费挡
  const h0 = hp(c, hiaki);
  assert.equal(strike(c, foe, hiaki).pending, true, "等掩护的人格挡（以前给友好阵营的人掩护了也挡不了，直接落下）");
  assert.deepEqual(ids(c.eligibleBlockers(hiaki, S.blockQueue[0])), [kolt.id], "掩护的柯尔特没附赠也能挡");
  c.finishBlock(kolt.id, { roll: 1, ok: true });
  assert.match(logText(c), new RegExp(`${kolt.name} 因掩护免费格挡`));
  assert.equal(kolt.bonus, 0, "不花附赠");
  assert.equal(hp(c, hiaki), h0, "绯秋没受伤");
  // 挺身（专长）：一样
  helu.bonus = 4;
  skill(c, helu, "feat_standin", hiaki);
  assert.equal(hiaki.coverBy, helu.id, "挺身：友好的乙");
  helu.bonus = 0;
  assert.equal(strike(c, foe, hiaki).pending, true);
  assert.deepEqual(ids(c.eligibleBlockers(hiaki, S.blockQueue[0])), [helu.id], "挺身的赫鲁米卡没附赠也能挡");
  c.finishBlock(helu.id, { roll: 1, ok: true });
  assert.match(logText(c), new RegExp(`${helu.name} 因掩护免费格挡`));
  // 敌对阵营的人：掩护选不上（#460），硬记上也挡不了
  assert.ok(c.skillTargetError(kolt, "role_cover", chuan), "掩护敌对阵营的人：扣点之前就拦下");
  chuan.coverBy = kolt.id;
  assert.deepEqual(blockersOf(c, chuan, foe), [], "丙的川川：柯尔特挡不了");
  assert.ok(!strike(c, foe, chuan).pending, "没人能挡：直接落下");
});

test("友好不传递：我方和乙、乙和丙友好（我方和丙敌对）——丙打我方时乙的人不出手（不替一个自己人去挡另一个自己人），敌人打过来照常能挡；同阵营开着友伤打队友时照旧只有同阵营的能挡（#463）", () => {
  // 柯尔特、赫鲁米卡、川川在「我方」，绯秋在「乙」，灯在「丙」
  const { c, heroes: [kolt, helu, chuan, hiaki, tou], foe } = field({ party: ["kolt", "helu", "chuan", "hiaki", "tou"], seed: "PVP463-CHAIN", factions: (c, h) => {
    faction(c, { faction: "乙", unit: h[3].id });
    faction(c, { faction: "丙", unit: h[4].id });
    faction(c, { faction: "乙", other: "我方", hostile: false });
    faction(c, { faction: "乙", other: "丙", hostile: false });
  } });
  assert.deepEqual([c.hostileTo(tou, kolt), c.hostileTo(tou, hiaki), c.hostileTo(kolt, hiaki)], [true, false, false]);
  assert.deepEqual(blockersOf(c, kolt, tou), idsOf([helu, chuan]), "丙的灯打柯尔特：乙的绯秋和灯也友好，不出手；我方的照常");
  assert.deepEqual(blockersOf(c, tou, kolt), [], "柯尔特打丙的灯：乙的绯秋也不出手");
  assert.deepEqual(blockersOf(c, kolt, foe), idsOf([helu, chuan, hiaki]), "狂徒打柯尔特：友好的乙照常能挡");
  assert.deepEqual(blockersOf(c, tou, foe), [hiaki.id], "狂徒打丙的灯：友好的乙能挡，我方（和丙敌对）不能");
  hiaki.feats = ["ironwall"];
  assert.deepEqual(ids(c.featIronwallDeclarers(kolt, tou)), [], "以身作盾也一样：乙不替柯尔特挡丙");
  assert.deepEqual(ids(c.featIronwallDeclarers(kolt, foe)), [hiaki.id], "狂徒打过来照常");
  hiaki.coverBy = null; kolt.coverBy = hiaki.id;   // 乙的绯秋掩护柯尔特：丙打过来照样不出手
  hiaki.bonus = 0;
  assert.deepEqual(blockersOf(c, kolt, tou), idsOf([helu, chuan]));
  assert.deepEqual(blockersOf(c, kolt, foe), idsOf([helu, chuan, hiaki]), "狂徒打过来：掩护照常免费挡");
  // 我方的赫鲁米卡开着友伤打柯尔特：同阵营的川川照旧能挡（#428），友好的乙不插手
  hiaki.bonus = 4; kolt.coverBy = null;
  c.Commands.dispatch({ type: "battle.friendlyFire", on: true });
  assert.deepEqual(blockersOf(c, kolt, helu), [chuan.id]);
});

/** 一台移动堡垒停在 1 区：pilot 开车（不给 = 空车，开战时属于镇压队）；Math.random 固定 0.1（< 40%：代挡掷得中），车的装甲加厚打不爆 */
function carOf(f, pilot) {
  const p = f.c.vehicleSpawn("fortress", 1, 5, 2);
  if (pilot) {
    f.c.vehicleBoard(pilot, p);
    const l = pilot.layers.find(x => x.veh === p.id);
    l.max = l.current = 99999;
  }
  f.c.Math.random = () => 0.1;
  return p;
}
/** a 打 t 的这一下，车（有的话）替 t 代挡没有 */
const guarded = (c, a, t) => !!c.vehicleGuard(a, t, { flags: { action: true } });

test("载具代挡：有人驾驶的车按驾驶员的阵营——只替驾驶员的自己人（同阵营、友好的阵营）挡；敌对阵营的人打过来照挡，自己人打的不挡；没配置阵营时照旧（#463）", () => {
  {
    // 我方的柯尔特开车：替我方的赫鲁米卡、友好的乙（绯秋）挡，不替敌对的丙（灯）挡
    const f = trio(["kolt", "helu", "hiaki", "tou"], true);
    const { c, heroes: [kolt, helu, hiaki, tou], foe } = f;
    const p = carOf(f, kolt);
    assert.equal(guarded(c, foe, helu), true, "狂徒打赫鲁米卡（同阵营）：挡");
    assert.equal(guarded(c, foe, hiaki), true, "狂徒打绯秋（友好的乙）：挡");
    assert.equal(guarded(c, foe, tou), false, "狂徒打灯（敌对的丙）：不挡（以前玩家开的车替所有玩家角色挡）");
    assert.equal(guarded(c, tou, helu), true, "丙的灯打赫鲁米卡：敌对阵营的人打过来照挡（以前玩家打的都算自己人打的）");
    assert.equal(guarded(c, tou, hiaki), true, "丙的灯打友好的乙：照挡");
    assert.equal(guarded(c, hiaki, tou), false, "乙打丙：丙不是驾驶员的自己人，不挡");
    // 真的打一下：车（驾驶员）替赫鲁米卡挨了丙的这一击
    const h0 = hp(c, helu), a0 = c.vehicleArmor(p).cur;
    c.dealTo(tou, helu, { atk: 10, mult: 1, element: "physical", baseBreak: 0, flags: { action: true, anyRange: true, blockResolved: true } });
    assert.equal(hp(c, helu), h0, "赫鲁米卡没受伤");
    assert.ok(c.vehicleArmor(p).cur < a0, "车的装甲吃了这一击");
    assert.match(logText(c), new RegExp(`${p.name}替 ${helu.name} 代挡了这次攻击`));
  }
  {
    // 丙的灯开车（和我方、乙都敌对）：我方、乙的人都不替
    const f = trio(["kolt", "helu", "hiaki", "tou"], true);
    const { c, heroes: [kolt, helu, hiaki, tou], foe } = f;
    carOf(f, tou);
    assert.deepEqual([kolt, helu, hiaki].map(u => guarded(c, foe, u)), [false, false, false], "丙的车不替我方、乙挡（以前替）");
    assert.equal(c.vehicleSide(c.vehicleOf(tou)), "player");
  }
  {
    // 乙的绯秋开车，乙和丙也设成友好（我方和丙之间照旧敌对）：我方、丙的人都是驾驶员的自己人，都替；
    // 丙的灯打我方的柯尔特、柯尔特打灯：打的人也是驾驶员的自己人，不挡（友好不传递时不在两个自己人之间出手）
    const f = trio(["kolt", "helu", "hiaki", "tou"], true);
    const { c, heroes: [kolt, helu, hiaki, tou], foe } = f;
    faction(c, { faction: "乙", other: "丙", hostile: false });
    carOf(f, hiaki);
    assert.equal(guarded(c, foe, kolt), true, "狂徒打我方的柯尔特：挡");
    assert.equal(guarded(c, foe, tou), true, "狂徒打丙的灯：挡（按驾驶员乙的阵营看，不是按「我方」）");
    assert.equal(guarded(c, tou, kolt), false, "丙打我方：不挡");
    assert.equal(guarded(c, kolt, tou), false, "我方打丙：不挡");
    assert.ok(helu);
  }
  {
    // 对照：没配置阵营——玩家开的车替同区所有玩家角色挡，玩家打的都不挡（和以前一样）
    const f = trio(["kolt", "helu", "hiaki", "tou"], false);
    const { c, heroes: [kolt, helu, hiaki, tou], foe } = f;
    carOf(f, kolt);
    assert.deepEqual([helu, hiaki, tou].map(u => guarded(c, foe, u)), [true, true, true]);
    assert.equal(guarded(c, tou, helu), false, "玩家打的：不挡");
    // 镇压队开的车照旧只替镇压队（这里同区没有）
    assert.equal(guarded(c, kolt, foe), false);
  }
});

test("载具代挡：空车在场上有两个以上玩家阵营时谁都不替挡（最后下车的是玩家、镇压队都一样）；只有一个玩家阵营（不配置 / 全在「我方」/ 多一个没人的阵营）时照旧替最后坐在车上的一方（#463）", () => {
  const RIOTS = [{ id: "riot_baton", lv: 1, zone: 1 }, { id: "riot_rifle", lv: 1, zone: 1 }];
  for (const mode of [null, "all", "empty", "split"]) {
    const split = mode === "split", tag = `（${mode || "不配置"}）`;
    const f = field({ enemies: RIOTS, seed: "PVP463-EMPTY", factions: (c, heroes) => {
      if (mode === "all") faction(c, { faction: "我方" });                       // 配置了，但全部在「我方」
      if (mode === "empty") faction(c, { faction: "乙", phase: "enemy" });       // 多一个没人的阵营
      if (split) heroes.slice(2).forEach(h => faction(c, { faction: "乙", unit: h.id }));   // 绯秋、灯在「乙」（和我方敌对）
    } });
    const { c, heroes: [kolt, helu, hiaki], foes: [baton, rifle] } = f;
    assert.equal(c.pvpSplit(), split, "场上有几个玩家阵营" + tag);
    const p = carOf(f, null);
    assert.equal(c.vehicleSide(p), "enemy", "开战时的空车属于镇压队");
    assert.equal(guarded(c, kolt, baton), !split, (split ? "空车不替镇压队挡" : "空车替镇压队挡") + tag);
    // 柯尔特上车再下车：空车属于最后坐在车上的我方
    c.vehicleBoard(kolt, p);
    c.vehicleLeave(kolt);
    assert.equal(c.vehicleSide(p), "player");
    assert.equal(guarded(c, baton, helu), !split, (split ? "空车不替我方挡" : "空车替我方挡") + tag);
    assert.equal(guarded(c, kolt, rifle), false, "不再替镇压队挡" + tag);
    if (split) assert.equal(guarded(c, kolt, hiaki), false, "也不替乙挡");
    // 有人开车：照常按驾驶员（柯尔特）的阵营
    c.vehicleBoard(kolt, p);
    assert.equal(guarded(c, baton, helu), true, "柯尔特开车：替同阵营的赫鲁米卡挡" + tag);
    assert.equal(guarded(c, baton, hiaki), !split, (split ? "不替敌对的乙挡" : "替绯秋挡") + tag);
  }
});


/** 会掩护 / 挺身 / 以身作盾的打法（自动对打用）：每人每回合先掩护或挺身另一名玩家角色（血量比例最低、这回合还没人掩护的；挑人只看「是不是玩家角色」，
 *  敌对阵营的人交给规则自己拦）；协助格挡先用以身作盾，再让掩护的人免费挡，其余挑成功率最高的人（默认打法）；开车的人不动 */
function blockPolicy(c) {
  const S = c.S.state;
  const used = new Set();
  const ratio = u => c.totalHp(u) / Math.max(1, c.totalMaxHp(u));
  const pals = u => S.units.filter(x => x.isPlayer && x.id !== u.id && !x.dead && !x.hidden && !x.fused && !x.vehId)
    .sort((a, b) => ratio(a) - ratio(b) || String(a.id).localeCompare(String(b.id)));
  const go = (u, id, target) => {
    const key = [u.id, id, S.turnNo, S.combatPhase].join(":");
    if (!target || used.has(key) || !(c.skillList(u) || []).some(s => s.id === id)) return null;
    const cost = c.skillCost(id) || {};
    if ((cost.ap || 0) > (u.ap || 0) || (cost.bonus || 0) > (u.bonus || 0) || c.skillRequirementError(u, id)) return null;
    used.add(key);
    return () => skill(c, u, id, target);
  };
  return {
    act(u) {
      if (u.vehId) return null;
      if (u.dying || u.stunned) return c.BattleSim.BASIC_POLICY.act(u);
      const ps = pals(u), t = ps.find(x => !x.coverBy) || ps[0];
      return go(u, "role_cover", t) || go(u, "feat_standin", t) || c.BattleSim.BASIC_POLICY.act(u);
    },
    pickBlocker(helpers, attacker, target) {
      const walls = c.featIronwallDeclarers(target, attacker);
      if (walls.length) return "ironwall:" + walls[0].id;
      const cover = helpers.find(h => h.id === target.coverBy);
      return cover ? cover.id : c.BattleSim.BASIC_POLICY.pickBlocker(helpers, attacker, target);
    },
    longgeSafety() { return false; }
  };
}

test("协助格挡 / 载具代挡：同一种子整场自动对打（掩护、挺身、以身作盾，玩家开的车、镇压队开的车、空车），不配置 / 全在「我方」/ 多一个没人的阵营结果和整场记录一模一样；两个敌对阵营对打时没替敌对阵营的人挡过、车只替驾驶员的自己人挡、空车不挡；两个友好阵营互相挡过（#463）", () => {
  const MARKS = { 协助格挡: /协助格挡 .+：d100=/, 掩护: /因掩护免费格挡/, 以身作盾: /以身作盾：这一击视为协助格挡成功/, 代挡: /代挡了这次攻击/ };
  const cases = [
    { party: ["tou", "kolt", "helu", "hiaki"], roles: { tou: "护卫", hiaki: "护卫" }, feats: { helu: ["standin", "ironwall"], kolt: ["ironwall"] }, seed: "PVP463-AUTO-A2" },
    { party: ["helu", "chuan", "tou", "kolt"], roles: { helu: "护卫", kolt: "护卫" }, feats: { tou: ["standin", "ironwall"], chuan: ["ironwall"] }, seed: "PVP463-AUTO-B6" }
  ];
  // 两场合起来要真的走到的：每一样格挡、三种车（玩家开的、镇压队开的、空车）都代挡过；友好的阵营之间互相挡过
  const seen = { marks: new Set(), car: new Set(), crossBlock: 0, crossGuard: 0 };
  for (const cs of cases) {
    const sim = mode => {
      const c = H.load();
      c.BattleSim.setup({ party: cs.party, seed: cs.seed, zoneMode: 3,
        enemies: [{ id: "thug_knife", lv: 4, zone: 1 }, { id: "thug_hammer", lv: 4, zone: 1 }, { id: "thug_knife", lv: 4, zone: 2 }, { id: "riot_baton", lv: 4, zone: 2 }, { id: "riot_captain", lv: 4, zone: 2 }],
        before(S) {
          S.units.filter(u => u.isPlayer).forEach(u => {
            u.level = 10;
            if (cs.roles[u.kit]) u.roles = { primary: cs.roles[u.kit], secondary: cs.roles[u.kit] };
            if (cs.feats[u.kit]) u.feats = cs.feats[u.kit].slice();
            c.resetBattleFlags(u);
          });
        } });
      const S = c.S.state;
      const heroes = S.units.filter(u => u.isPlayer && !u.hidden);
      heroes.forEach(u => { u.zone = 1; });
      // 车：第二名角色开的停在 1 区；镇压小队长开的停在 2 区；空车（属于镇压队）停在 1 区
      c.vehicleBoard(heroes[1], c.vehicleSpawn("fortress", 1, 4, 4));
      c.vehicleBoard(c.findKit("riot_captain", S.units), c.vehicleSpawn("fortress", 2, 4, 4));
      c.vehicleSpawn("fortress", 1, 4, 4);
      if (mode === "all") faction(c, { faction: "我方" });
      if (mode === "empty") faction(c, { faction: "乙", phase: "enemy" });
      if (mode === "pvp" || mode === "friendly") heroes.slice(2).forEach(h => faction(c, { faction: "乙", unit: h.id }));
      if (mode === "friendly") faction(c, { faction: "乙", other: "我方", hostile: false });
      // 记下每一次协助格挡（含以身作盾）谁替谁挡、每一次代挡是哪台车（驾驶员）替谁挡了谁的攻击
      const blocks = [], guards = [];
      const fb = c.finishBlock;
      c.finishBlock = function (helperId) {
        const job = (S.blockQueue || [])[0];
        const h = helperId ? c.unitById(String(helperId).replace(/^ironwall:/, "")) : null, t = job ? c.unitById(job.targetId) : null;
        if (h && t) blocks.push({ h, t });
        return fb.apply(this, arguments);
      };
      const vg = c.vehicleGuard;
      c.vehicleGuard = function (attacker, target) {
        const out = vg.apply(this, arguments);
        if (out) guards.push({ pilot: c.vehiclePilot(out.vehicle), attacker, target });
        return out;
      };
      const r = plain(c.BattleSim.run({ maxRounds: 12, policy: blockPolicy(c) }));
      return { c, r, log: logText(c), blocks, guards };
    };
    const off = sim(null), all = sim("all"), empty = sim("empty");
    Object.keys(MARKS).forEach(k => { if (MARKS[k].test(off.log)) seen.marks.add(k); });
    off.guards.forEach(g => seen.car.add(!g.pilot ? "空车" : g.pilot.isPlayer ? "玩家开的车" : "镇压队开的车"));
    assert.deepEqual(all.r, off.r, cs.seed + "：全部在「我方」——结果一样");
    assert.equal(all.log, off.log, cs.seed + "：整场记录一样");
    assert.deepEqual(empty.r, off.r, cs.seed + "：多一个没人的阵营——结果一样");
    assert.equal(empty.log, off.log, cs.seed + "：整场记录一样");
    // 两个敌对的玩家阵营：照样有协助格挡、代挡，但没替敌对阵营的人挡过；车只替驾驶员的自己人挡、自己人打的不挡；空车不挡
    const pvp = sim("pvp"), pc = pvp.c;
    assert.ok(pvp.blocks.length && pvp.guards.length, cs.seed + "（两个敌对阵营）：有协助格挡、有代挡");
    assert.deepEqual(pvp.blocks.filter(b => !pc.teammateOf(b.t, b.h)).map(b => `${b.h.name} → ${b.t.name}`), [], cs.seed + "：没替敌对阵营的人挡过");
    const bad = pvp.guards.filter(g => !g.pilot || (g.pilot.isPlayer ? !pc.teammateOf(g.pilot, g.target) || (g.attacker.isPlayer && pc.teammateOf(g.pilot, g.attacker)) : g.target.isPlayer));
    assert.deepEqual(bad.map(g => `${g.pilot ? g.pilot.name : "空车"}：${g.attacker.name} → ${g.target.name}`), [], cs.seed + "：车只替驾驶员的自己人挡、空车不挡");
    // 两个友好的玩家阵营：互相协助格挡、玩家开的车替友好阵营的人代挡（以前协助格挡只有同阵营的能挡）
    const fr = sim("friendly"), fc = fr.c;
    seen.crossBlock += fr.blocks.filter(b => !fc.samePlayerFaction(b.h, b.t)).length;
    seen.crossGuard += fr.guards.filter(g => g.pilot && g.pilot.isPlayer && !fc.samePlayerFaction(g.pilot, g.target)).length;
    assert.ok(fr.guards.every(g => g.pilot), cs.seed + "（两个友好阵营）：场上有两个玩家阵营，空车不挡");
  }
  assert.deepEqual([...seen.marks].sort(), Object.keys(MARKS).sort(), "两场合起来：协助格挡、掩护的免费格挡、以身作盾、代挡都出现过");
  assert.deepEqual([...seen.car].sort(), ["玩家开的车", "空车", "镇压队开的车"].sort(), "三种车都代挡过");
  assert.ok(seen.crossBlock > 0, "两个友好阵营：替友好阵营的人协助格挡过");
  assert.ok(seen.crossGuard > 0, "两个友好阵营：玩家开的车替友好阵营的人代挡过");
});
