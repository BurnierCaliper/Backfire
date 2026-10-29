// PvP 每队单独计分（#472，docs/pvp.md 第 4 节）：场上有两个以上玩家阵营（主持人分阵营、决斗）时，每个玩家阵营另外记一份分数 state.pvpScore。
// 打敌对玩家阵营的人（#453 起当友伤、不计分）改成照常计分，记进打的人那一队；只算原本的分数（伤害、治疗 / 护盾、击破、打出失衡、协助格挡、
// 减伤、格挡减免、击杀、行动），额外加成（速杀、无伤、遭遇战、克制大师、克制 / 大伤害加成）不算；分数只是显示——不进队伍评分、战场数据、
// 最近 10 场，不给奖励；战斗结束后两队的分数给所有人看。同阵营之间的友伤照旧不计；只有一个玩家阵营（普通 PvE）时一切照旧。
// 规则在 app.js · PVP_TEAM_SCORE / pvpTeamAdd / pvpTeamHit / notePvpHurt / pvpHurtFill / pvpTeamScores，接线见 addScore、trackHealBy、
// dealToInner、applyTypedDotIn、finishBlockInner、scoreEnvHit、settleBattleRewards；画面见 game.js · finish、trpg-ui.js · recordBattle
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");
const plain = v => JSON.parse(JSON.stringify(v));
const faction = (c, cmd) => c.Commands.dispatch(Object.assign({ type: "battle.playerFaction" }, cmd));
/** 一下直接结算的攻击（不等协助格挡） */
const hit = (c, a, t, flat, extra) => c.dealTo(a, t, { atk: 0, mult: 0, flat, element: (extra && extra.element) || "physical", baseBreak: (extra && extra.brk) || 0, atkRange: "any",
  flags: Object.assign({ action: true, blockResolved: true, block: "none" }, (extra && extra.flags) || {}) });

/** 主持人分阵营：柯尔特、赫鲁米卡在「我方」，绯秋、灯在「乙」；一个狂徒（打不死）。都在 1 区，血量、架势都很厚 */
function field(opt = {}) {
  const party = ["kolt", "helu", "hiaki", "tou"];
  const c = H.load();
  c.BattleSim.setup({ party, enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], zoneMode: 3, seed: opt.seed || "PVP472-SCORE" });
  const S = c.S.state;
  const heroes = party.map(k => c.findKit(k, S.units));
  const foe = S.units.find(u => !u.isPlayer);
  [...heroes, foe].forEach(u => { u.zone = 1; u.layers = [{ type: "flesh", current: 300, max: 300, inner: true }]; u.def = u.defMax = 20; });
  if (opt.split !== false) heroes.slice(2).forEach(h => faction(c, { faction: "乙", unit: h.id }));
  c.startCombat();
  heroes.forEach(h => { h.ap = h.apMax = 4; h.bonus = h.bonusMax = 0; h.level = Math.max(Number(h.level) || 1, 5); });
  c.resetBattleRecords();
  if (opt.split !== false) heroes.slice(2).forEach(h => faction(c, { faction: "乙", unit: h.id }));   // resetBattleRecords 清了阵营：再分一次
  return { c, S, heroes, foe };
}
const team = (S, id) => (S.pvpScore && S.pvpScore[id]) || { total: 0, parts: {} };

test("配置表：只算原本的分数（伤害、治疗 / 护盾、击破、打出失衡、协助格挡、减伤、格挡减免、击杀、行动）；打倒一名角色照精英的击杀分", () => {
  const c = H.load();
  const P = plain(vm.runInContext("PVP_TEAM_SCORE", c));
  assert.deepEqual(P.parts, ["dmg", "heal", "brk", "stagger", "block", "reduce", "blockSave", "kill", "action"]);
  const names = plain(vm.runInContext("SCORE_PART_NAMES", c));
  assert.deepEqual(P.parts.map(k => names[k]), ["伤害", "治疗 / 护盾", "击破", "打出失衡", "协助格挡成功", "减伤", "格挡减免", "击杀", "行动"]);
  for (const k of ["speed", "flawless", "ambush", "counterMaster", "bonus"]) assert.ok(!P.parts.includes(k), names[k] + " 不算");
  assert.equal(P.killHero, c.S.SCORE_RULES.kill.elite);
});

test("打敌对玩家阵营的人：伤害、击破、打出失衡、打倒角色的击杀记进打的人那一队；不进队伍评分、战场数据（承伤、倒地也不记）；同阵营开着友伤打的照旧不计", () => {
  const { c, S, heroes: [kolt, helu, hiaki, tou] } = field();
  const R = c.S.SCORE_RULES;
  const total0 = S.battleScore.total;
  const out = hit(c, kolt, hiaki, 12, { brk: 2 });
  assert.equal(out.res.total, 12);
  assert.equal(team(S, "我方").parts.dmg, 12 * R.dmg, "伤害记进我方");
  assert.equal(team(S, "我方").parts.brk, 2 * R.brk, "击破记进我方");
  assert.equal(team(S, "我方").total, 12 * R.dmg + 2 * R.brk);
  assert.equal(team(S, "乙").total, 0, "挨打的乙队不加分");
  assert.equal(S.battleScore.total, total0, "队伍评分不变");
  assert.equal(c.battleStat(kolt).dmg, 0, "战场数据（伤害）不记");
  assert.equal(c.battleStat(hiaki).taken, 0, "战场数据（承伤）不记");
  // 打出失衡：架势打空
  hiaki.def = 1;
  hit(c, kolt, hiaki, 1, { brk: 3 });
  assert.equal(hiaki.stunned, true);
  assert.equal(team(S, "我方").parts.stagger, R.stagger, "打出失衡记进我方");
  assert.equal(c.battleStat(kolt).staggers || 0, 0, "战场数据（打出失衡）不记");
  // 打倒一名角色（主持人分阵营：起身中坚毅打光，死亡）：击杀分；倒地次数不记
  (tou.layers || []).forEach(l => { l.current = 0; }); tou.upOnShp = true; tou.shp = 2;
  hit(c, helu, tou, 30);
  assert.equal(tou.dead, true);
  assert.equal(team(S, "我方").parts.kill, c.S.SCORE_RULES.kill.elite, "打倒灯：击杀分记进我方");
  assert.equal(c.battleStat(helu).kills || 0, 0, "战场数据（击杀）不记");
  assert.equal(c.battleStat(tou).downs || 0, 0, "倒地次数不记");
  // 同阵营开着友伤打队友：照旧不计
  const before = plain(S.pvpScore);
  c.Commands.dispatch({ type: "battle.friendlyFire", on: true });
  hit(c, kolt, helu, 10, { brk: 1 });
  assert.deepEqual(plain(S.pvpScore), before, "同阵营的友伤：哪一队都不加");
  assert.equal(S.battleScore.total, total0, "队伍评分照旧不变");
});

test("只算原本的分数：打非玩家单位、行动这些照旧进队伍评分，也记一份进那个人的阵营——克制 / 大伤害加成、速杀、无伤、遭遇战、克制大师都不算", () => {
  const { c, S, heroes: [kolt, , hiaki], foe } = field();
  // 克制打狂徒：队伍评分有加成（parts.bonus），我方那一份只有原本的伤害
  const out = c.dealTo(kolt, foe, { atk: 40, mult: 1, element: "fire", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });
  const dmg = Math.floor(out.res.total);
  assert.ok(dmg > 0);
  assert.equal(S.battleScore.parts.dmg, dmg);
  assert.equal(team(S, "我方").parts.dmg, dmg, "打狂徒的伤害也记进我方");
  if (out.res.advantage) assert.ok(S.battleScore.parts.bonus > 0, "队伍评分有克制加成");
  assert.ok(!("bonus" in team(S, "我方").parts), "加成不算");
  // 行动：花行动点 / 附赠
  c.spendAp(hiaki, 2, "测试");
  hiaki.bonus = 1; c.spendBonus(hiaki, 1, "测试");
  assert.equal(team(S, "乙").parts.action, 2 * c.S.SCORE_RULES.ap + c.S.SCORE_RULES.bonusAction, "乙队的行动分");
  // 结算：速杀、无伤、克制大师进队伍评分，阵营的分数不变
  const teamsBefore = plain(S.pvpScore);
  const res = plain(c.settleBattleRewards("win"));
  assert.ok(res.finishBonus && res.finishBonus.extra > 0, "队伍评分有速杀 / 无伤加成");
  assert.deepEqual(plain(S.pvpScore), teamsBefore, "阵营的分数不吃这些加成");
  // 结算结果带着各阵营的分数（给所有人看），照阵营的顺序
  assert.deepEqual(res.teams.map(t => t.id), ["我方", "乙"]);
  assert.equal(res.teams[0].name, "我方");
  assert.equal(res.teams[0].total, teamsBefore["我方"].total);
  assert.deepEqual(res.teams[1].parts, teamsBefore["乙"].parts);
  assert.match(c.pvpTeamScoreText(res.teams), /^我方 \d+ 分（伤害 \d+.*）；乙 \d+ 分（行动 \d+）$/);
});

test("被打的那一队：减伤、协助格挡、格挡减免记进格挡 / 挨打的那一队；治回敌对阵营打掉的血算治疗者那一队的治疗（队伍评分照旧不算）", () => {
  const { c, S, heroes: [kolt, helu, hiaki, tou] } = field();
  const R = c.S.SCORE_RULES;
  // 减伤：目标减伤 50%
  hit(c, kolt, hiaki, 20, { flags: { dr50: true } });
  assert.equal(team(S, "乙").parts.reduce, Math.floor(10 * R.reduce), "减免的 10 点 × 1.5 记进乙队");
  assert.equal(S.battleScore.parts.reduce || 0, 0, "队伍评分不记");
  assert.equal(c.battleStat(hiaki).reduced || 0, 0, "战场数据不记");
  // 协助格挡：灯替绯秋挡柯尔特的一下
  tou.bonus = 1;
  const pend = c.dealTo(kolt, hiaki, { atk: 0, mult: 0, flat: 8, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true } });
  assert.ok(pend.pending, "排进协助格挡");
  c.finishBlock(tou.id, { roll: 1, ok: true, chance: 100 });
  assert.equal(team(S, "乙").parts.block, R.block, "协助格挡成功记进乙队");
  assert.equal(team(S, "乙").parts.blockSave, Math.floor(8 * R.blockSave), "格挡减免 8 × 1.2");
  assert.equal(S.battleScore.parts.block || 0, 0);
  assert.equal(c.battleStat(tou).blocks || 0, 0, "战场数据（格挡次数）不记");
  // 治疗：柯尔特打掉绯秋 10 点，灯治回 6 点 → 乙队治疗 6 × 1.5；队伍评分照旧不算（友伤的账）
  const h0 = c.totalHp(hiaki);
  hit(c, kolt, hiaki, 10);
  assert.equal(c.totalHp(hiaki), h0 - 10);
  c.trackHealBy(tou, () => c.healUnit(hiaki, 6));
  assert.equal(team(S, "乙").parts.heal, Math.floor(6 * R.heal), "治回敌对阵营打掉的血：乙队的治疗分");
  assert.equal(S.battleScore.parts.heal || 0, 0, "队伍评分照旧不算");
  // 再治 6 点：前面还剩 4 点是敌对阵营打掉的、2 点是平常的治疗（队伍评分算这 2 点），乙队都算
  hit(c, kolt, hiaki, 0);
  c.trackHealBy(tou, () => c.healUnit(hiaki, 6));
  assert.equal(team(S, "乙").parts.heal, Math.floor(6 * R.heal) + Math.floor(4 * R.heal) + Math.floor(2 * R.heal));
  // 「治疗」敌对阵营的人（没有这种技能，硬改血量模拟）：不算进治疗者那一队
  const heal0 = team(S, "乙").parts.heal;
  c.trackHealBy(tou, () => { kolt.layers[0].current -= 20; });
  c.trackHealBy(tou, () => { kolt.layers[0].current += 5; });
  assert.equal(team(S, "乙").parts.heal, heal0, "敌对阵营的人多了血不算乙队的治疗");
  assert.ok(helu);
});

test("坚毅生命的数值不进分数：打进坚毅生命的伤害、那一下的减伤都不算（分数里看不出坚毅扣了多少）；打倒照算击杀", () => {
  const { c, S, heroes: [kolt, , hiaki] } = field();
  (hiaki.layers || []).forEach(l => { l.current = 0; }); hiaki.upOnShp = true; hiaki.shp = 50; hiaki.shpMax = 60;
  hit(c, kolt, hiaki, 9, { flags: { dr50: true } });
  assert.ok(hiaki.shp < 50, "打进了坚毅");
  assert.equal(team(S, "我方").parts.dmg || 0, 0, "打进坚毅的伤害不算");
  assert.equal(team(S, "乙").parts.reduce || 0, 0, "那一下的减伤不算");
  hit(c, kolt, hiaki, 200);
  assert.equal(hiaki.dead, true);
  assert.equal(team(S, "我方").parts.kill, c.S.SCORE_RULES.kill.elite, "打倒照算击杀");
  assert.ok(!JSON.stringify(c.pvpTeamScores()).match(/shp|坚毅/), "分数里没有坚毅");
});

test("只有一个玩家阵营（普通 PvE）时一切照旧：一份都不记，结算结果不带各阵营的分数；配置了但全在「我方」/ 多一个没人的阵营也一样", () => {
  for (const mode of [null, "all", "empty"]) {
    const { c, S, heroes: [kolt, helu], foe } = field({ split: false });
    if (mode === "all") faction(c, { faction: "我方" });
    if (mode === "empty") faction(c, { faction: "乙", phase: "enemy" });
    hit(c, kolt, foe, 15, { brk: 2 });
    c.spendAp(kolt, 1, "测试");
    c.trackHealBy(helu, () => { kolt.layers[0].current -= 5; c.healUnit(kolt, 5); });
    assert.equal(c.pvpTeamScoring(), false, mode + "：不计");
    assert.deepEqual(plain(S.pvpScore), {}, mode + "：一份都不记");
    assert.deepEqual(plain(S.pvpHurt), {}, mode);
    const res = plain(c.settleBattleRewards("win"));
    assert.ok(!("teams" in res), mode + "：结算不带各阵营的分数");
    assert.ok(S.battleScore.parts.dmg > 0, "队伍评分照常");
  }
});

test("分数只是显示：不记进最近 10 场（战绩只有队伍评分）；决斗打完两队都有分数，结算带着两队的分数", () => {
  { // 主持人分阵营：最近 10 场只记队伍评分，打对面的伤害不在战场数据里
    const { c, S, heroes: [kolt, , hiaki], foe } = field();
    hit(c, kolt, hiaki, 20);
    hit(c, kolt, foe, 5);
    c.settleBattleRewards("win");
    const last = plain(c.careerData().battles.slice(-1)[0]);
    assert.ok(last, "照常记一场");
    assert.equal(last.score, S.battleScore.total, "最近 10 场记的是队伍评分");
    assert.equal(S.battleStats[kolt.id].dmg, 5, "战场数据只有打狂徒的 5 点（打对面的 20 点不记）");
  }
  { // 决斗整场自动对打：两队都有分数，结算带着；不进最近 10 场
    const c = H.load();
    c.BattleSim.setup({ party: ["kolt", "helu", "hiaki", "tou"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "DUEL472-SCORE" });
    const S = c.S.state;
    const [kolt, helu, hiaki, tou] = ["kolt", "helu", "hiaki", "tou"].map(k => c.findKit(k, S.units));
    c.Commands.dispatch({ type: "battle.duel", teams: { "1队": [kolt.id, helu.id], "2队": [hiaki.id, tou.id] }, rounds: 6 });
    const career0 = plain(c.careerData());
    const r = plain(c.BattleSim.run({ maxRounds: 30 }));
    assert.ok(r.duel);
    assert.ok(team(S, "1队").total > 0 && team(S, "2队").total > 0, "两队都有分数");
    assert.ok(team(S, "1队").parts.action > 0 && team(S, "2队").parts.action > 0, "各自的行动分");
    assert.ok(team(S, "1队").parts.dmg > 0 || team(S, "2队").parts.dmg > 0, "打对面的伤害");
    const res = plain(c.settleBattleRewards(r.duel.winner ? "win" : "draw"));
    assert.deepEqual(res.teams.map(t => [t.id, t.name]), [["1队", "1 队"], ["2队", "2 队"]]);
    assert.equal(res.grade, null);
    assert.deepEqual(plain(c.careerData()), career0, "决斗不记进最近 10 场");
    assert.equal(Object.values(S.battleStats).reduce((s, x) => s + (x.dmg || 0), 0), 0, "战场数据里没有打对面的伤害");
  }
});
