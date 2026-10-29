// PvP 第三步：决斗（#472，docs/pvp.md 第 1.2、2、3 节）。只有 1 队、2 队两队，就是两个互相敌对的玩家阵营（第一步的规则层，
// enemies.js · PVP_CFG / setPlayerFaction）；决斗自己的规则在 enemies.js · PVP_DUEL_CFG / pvpDuel*：
// 指令 battle.duel 布置（3 区制、1 队站 1 区 / 2 队站 3 区）、开战抛硬币定先手（先手在我方回合、后手在敌人回合行动）、
// 后手补偿 1 个附赠（先手的第一回合里就能用，没用掉的叠到后手自己的第一回合）、伤害不会致死（坚毅打到 1 保留 1，再起不能、移出战场）、
// 可以不许起身（倒地的人留在场上，能被专长救起来）、一队全倒另一队赢、回合上限按剩余血量百分比判（一样算平局）、
// 结束后血量 / 坚毅 / 耐久恢复成决斗前的样子（用掉的道具不恢复），没有掉落、经验、奎支。
// 接线见 app.js（startCombat、refreshEconomy、standUpBlocked、applyKnockdown、rasUnstableHit、turnEnd、settleBattleRewards）、
// engine.js · applyResultToUnit、ledger.js · ledgerAfterBattle、battle-commands.js、sim.js、game.js · checkEnd / finish
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");
const plain = v => JSON.parse(JSON.stringify(v));
const run = (c, expr) => vm.runInContext(expr, c);
const logText = c => c.S.state.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
/** 一下普通的单体攻击（不带格挡结果：同区有自己人能挡时排进格挡队列） */
const strike = (c, a, t, extra) => c.dealTo(a, t, Object.assign({ atk: 10, mult: 1, element: "physical", baseBreak: 1, atkRange: "any", flags: { action: true } }, extra || {}));
/** 一下重击，直接结算（不等协助格挡） */
const smash = (c, a, t, dmg) => c.dealTo(a, t, { atk: 0, mult: 0, flat: dmg, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });
/** 抛硬币：让 Math.random 先给一个数（< 0.5 是 1 队先手），抛完换回原来的随机数 */
function tossFor(c, first) {
  const keep = c.Math.random;
  c.Math.random = () => (first === "1队" ? 0.1 : 0.9);
  try { c.startCombat(); } finally { c.Math.random = keep; }
}
/** 布置一场决斗：柯尔特、赫鲁米卡在 1 队，绯秋、灯在 2 队（opt.teams(heroes) 换队伍）；opt.cmd 是指令里另外的字段（stand / rounds）；
 *  opt.first 定谁先手（不给 = 1 队）；opt.start === false 时不开战 */
function duel(opt = {}) {
  const party = opt.party || ["kolt", "helu", "hiaki", "tou"];
  const c = H.load();
  c.BattleSim.setup({ party, enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: opt.seed || "DUEL472" });
  const S = c.S.state;
  const heroes = party.map(k => c.findKit(k, S.units));
  heroes.forEach(h => { h.level = Math.max(Number(h.level) || 1, 5); });
  if (opt.before) opt.before(c, heroes);
  const teams = opt.teams ? opt.teams(heroes) : { "1队": [heroes[0].id, heroes[1].id], "2队": [heroes[2].id, heroes[3].id] };
  const out = c.Commands.dispatch(Object.assign({ type: "battle.duel", teams }, opt.cmd || {}));
  if (opt.start !== false) tossFor(c, opt.first || "1队");
  return { c, S, heroes, out };
}
/** 把一个人打到倒地（濒死，还没起身） */
function knockDown(u) { (u.layers || []).forEach(l => { l.current = 0; }); u.dying = true; u.upOnShp = false; }
/** 起身中（靠坚毅生命战斗）、坚毅生命剩 shp */
function upOn(u, shp) { (u.layers || []).forEach(l => { l.current = 0; }); u.dying = false; u.upOnShp = true; u.shp = shp; u.shpMax = Math.max(Number(u.shpMax) || 0, shp, 40); }

test("配置表：两队 1 队 / 2 队（开局站 1 区 / 3 区）、3 区制、每队最多 4 人至少 1 人、后手补偿 1 个附赠、默认允许起身、回合上限默认 10、坚毅保留 1", () => {
  const c = H.load();
  const C = plain(run(c, "PVP_DUEL_CFG"));
  assert.deepEqual(C.teams.map(t => [t.id, t.name, t.zone]), [["1队", "1 队", 1], ["2队", "2 队", 3]]);
  assert.equal(C.zoneMode, 3);
  assert.equal(C.teamMax, 4);
  assert.equal(C.teamMin, 1);
  assert.equal(C.lateBonus, 1);
  assert.equal(C.standDefault, true);
  assert.equal(C.roundsDefault, 10);
  assert.equal(C.outShp, 1);
  assert.equal(c.pvpDuelOn(), false, "默认不是决斗");
  assert.equal(c.S.state.pvpDuel, null);
});

test("布置决斗（指令 battle.duel）：3 区制，1 队全站 1 区、2 队全站 3 区；两队是两个互相敌对的玩家阵营；不参加的角色、敌人都离场；两队人数可以不一样", () => {
  const { c, S, heroes: [kolt, helu, hiaki, tou], out } = duel({ start: false, teams: h => ({ "1队": [h[0].id, h[1].id], "2队": [h[2].id] }) });
  assert.equal(S.zoneMode, 3, "3 区制");
  assert.ok(!S.units.some(u => !u.isPlayer), "敌人离场");
  assert.ok(!S.units.includes(tou), "不参加的灯离场");
  assert.deepEqual([kolt.zone, helu.zone, hiaki.zone], [1, 1, 3], "1 队在 1 区、2 队在 3 区");
  assert.equal(c.playerFactionOf(kolt), "1队");
  assert.equal(c.playerFactionOf(helu), "1队");
  assert.equal(c.playerFactionOf(hiaki), "2队");
  assert.equal(c.playerFactionInfo("1队").name, "1 队");
  assert.equal(c.playerFactionInfo("2队").name, "2 队");
  assert.equal(c.hostileTo(kolt, hiaki), true, "两队互相敌对");
  assert.equal(c.attackFoe(hiaki, helu), true);
  assert.equal(c.hostileTo(kolt, helu), false, "同队不敌对");
  assert.equal(c.pvpSplit(), true, "场上两个玩家阵营：照玩家阵营的规则层走");
  assert.equal(c.pvpDuelTeamOf(kolt), "1队");
  assert.equal(c.pvpDuelTeamOf(hiaki), "2队");
  // 指令返回的是公开部分：两队、选项，不带决斗前的坚毅这些
  assert.deepEqual(plain(out.duel), { teams: { "1队": [kolt.id, helu.id], "2队": [hiaki.id] }, stand: true, rounds: null, first: null, out: [], result: null });
  assert.ok(!JSON.stringify(out).includes("restore"), "公开部分不带决斗前的样子");
  assert.match(logText(c), /决斗：1 队（柯尔特、Helumica） 对 2 队（绯秋），允许起身，不限回合/);
  // 武器人跟着持有者站
  c.startCombat();
  c.Commands.dispatch({ type: "skill", actor: hiaki.id, skill: "hiaki_aa", target: kolt.id });   // 先手是谁不要紧：只是确认能打
});

test("布置决斗：每队最多 4 人、至少 1 人，一个人只能在一队，不认识的角色、乱给的字段、超出范围的回合数、开战以后都被拒", () => {
  const party = ["kolt", "helu", "hiaki", "tou", "ruby", "yuito"];
  const fresh = () => {
    const c = H.load();
    c.BattleSim.setup({ party, enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "DUEL472-CHK" });
    return { c, h: party.map(k => c.findKit(k, c.S.state.units)) };
  };
  const ids = list => list.map(u => u.id);
  const bad = (cmd, re, msg) => { const { c, h } = fresh(); assert.throws(() => c.Commands.dispatch(Object.assign({ type: "battle.duel" }, cmd(h))), re, msg); assert.equal(c.S.state.pvpDuel, null, msg + "：没布置"); };
  bad(h => ({ teams: { "1队": ids(h.slice(0, 5)), "2队": ids(h.slice(5)) } }), /最多 4 人/, "1 队 5 人");
  bad(h => ({ teams: { "1队": ids(h.slice(0, 2)), "2队": [] } }), /至少要 1 人/, "2 队没人");
  bad(h => ({ teams: { "1队": ids(h.slice(0, 2)), "2队": [h[1].id] } }), /只能选一队/, "同一个人两队都选");
  bad(h => ({ teams: { "1队": [h[0].id, h[0].id], "2队": [h[1].id] } }), /duplicates/, "一队里重复");
  bad(h => ({ teams: { "1队": [h[0].id], "2队": ["nobody"] } }), /没有这名角色/, "不认识的角色");
  bad(h => ({ teams: { "1队": [h[0].id], "2队": [h[1].id], "3队": [h[2].id] } }), /Unknown duel team/, "第三队");
  bad(h => ({ teams: { "1队": [h[0].id], "2队": [h[1].id] }, first: "1队" }), /Unknown duel field/, "不能自己定先手");
  bad(h => ({ teams: { "1队": [h[0].id], "2队": [h[1].id] }, rounds: 0 }), /rounds/, "回合上限 0");
  bad(h => ({ teams: { "1队": [h[0].id], "2队": [h[1].id] }, rounds: 100 }), /rounds/, "回合上限 100");
  bad(h => ({ teams: { "1队": [h[0].id], "2队": [h[1].id] }, stand: "no" }), /stand/, "起身不是布尔");
  { // 武器人不能单独进队
    const { c, h } = fresh();
    const w = c.spawnWeapon(h[3], "mochi");
    assert.ok(w, "年糕上场");
    assert.throws(() => c.Commands.dispatch({ type: "battle.duel", teams: { "1队": [h[0].id], "2队": [w.id] } }), /没有这名角色/);
  }
  { // 4 对 1 可以；开战以后不能再布置
    const { c, h } = fresh();
    c.Commands.dispatch({ type: "battle.duel", teams: { "1队": ids(h.slice(0, 4)), "2队": [h[4].id] }, rounds: 10 });
    assert.equal(c.S.state.pvpDuel.rounds, 10);
    c.startCombat();
    assert.throws(() => c.Commands.dispatch({ type: "battle.duel", teams: { "1队": [h[0].id], "2队": [h[4].id] } }), /战斗已经开始/);
  }
});

test("抛硬币：开战时抛，结果写进战斗记录；先手的队在我方回合行动、后手的队在敌人回合行动（照玩家阵营的回合）", () => {
  for (const first of ["1队", "2队"]) {
    const { c, S, heroes: [kolt, helu, hiaki, tou] } = duel({ first });
    const second = first === "1队" ? "2队" : "1队";
    assert.equal(S.pvpDuel.first, first);
    assert.equal(c.playerFactionInfo(first).phase, "player", first + " 先手：我方回合行动");
    assert.equal(c.playerFactionInfo(second).phase, "enemy", second + " 后手：敌人回合行动");
    const a = first === "1队" ? [kolt, helu] : [hiaki, tou], b = first === "1队" ? [hiaki, tou] : [kolt, helu];
    a.forEach(u => { assert.equal(c.unitTurnPhase(u), "player"); assert.equal(c.canControlUnit(u), true, u.name + " 先手：第一回合能动"); assert.ok(u.ap >= 1); });
    b.forEach(u => { assert.equal(c.unitTurnPhase(u), "enemy"); assert.equal(c.canControlUnit(u), false, u.name + " 后手：先手的回合动不了"); assert.equal(u.ap, 0); });
    assert.match(logText(c), new RegExp(`抛硬币：${c.playerFactionInfo(first).name}先手（我方回合行动），${c.playerFactionInfo(second).name}后手（敌人回合行动）`));
    assert.equal(c.pvpDuelPublic().first, first, "公开部分带着先手");
  }
  // 真的是随机的：同一个布置，随机数不同先手就不同；只抛一次（再开也不重抛）
  const { c, S } = duel({ first: "2队" });
  assert.equal(S.pvpDuel.first, "2队");
  c.Math.random = () => 0.1;
  c.pvpDuelToss();
  assert.equal(S.pvpDuel.first, "2队", "已经抛过：不再抛");
});

test("后手补偿：开战时后手每个角色先有 1 个附赠（没有行动点），先手的第一回合里能拿来协助格挡；没用掉的叠到后手自己的第一回合（2 个），用掉的只剩平常的 1 个；第二回合起照常", () => {
  const { c, S, heroes: [kolt, helu, hiaki, tou] } = duel({ first: "1队" });
  assert.deepEqual([hiaki.ap, hiaki.bonus, tou.ap, tou.bonus], [0, 1, 0, 1], "后手：没有行动点、1 个附赠");
  assert.deepEqual([kolt.bonus, helu.bonus], [1, 1], "先手照常");
  assert.match(logText(c), /后手补偿：2 队每个角色先有 1 个附赠动作，先手的第一回合里就能用/);
  // 先手的第一回合：柯尔特打绯秋，同区的灯拿补偿的附赠协助格挡
  [kolt, hiaki, tou].forEach(u => { u.zone = 2; });
  kolt.ap = 4;
  const out = strike(c, kolt, hiaki);
  assert.ok(out.pending, "灯有附赠：排进协助格挡");
  assert.deepEqual(plain(c.eligibleBlockers(hiaki, S.blockQueue[0]).map(u => u.id)), [tou.id], "能挡的是同队的灯");
  c.finishBlock(tou.id, { roll: 1, ok: true, chance: 100 });
  assert.equal(tou.bonus, 0, "灯用掉了补偿");
  assert.equal(hiaki.bonus, 1, "绯秋没用");
  // 轮到后手：补满行动点，没用掉的补偿叠上去
  c.endPlayerTurn();
  assert.equal(S.combatPhase, "enemy");
  assert.equal(hiaki.ap, 1);
  assert.equal(hiaki.bonus, 2, "绯秋：这一回合 1 + 留下的 1 = 2 个附赠");
  assert.equal(tou.bonus, 1, "灯用掉了：只有平常的 1 个");
  assert.match(logText(c), /后手补偿：绯秋 开战时的附赠没用掉，叠到这一回合（\+1）/);
  assert.ok(!/后手补偿：灯 开战时/.test(logText(c)));
  assert.deepEqual(plain(S.pvpDuel.carry), {}, "补偿结算完了");
  // 第二回合起照常
  c.endEnemyTurn();
  c.endPlayerTurn();
  assert.equal(hiaki.bonus, 1, "第二回合：平常的 1 个");
  assert.equal(tou.bonus, 1);
  // 后手第一回合开始时晕眩（失衡）：这一回合没有行动，留下的补偿作废，之后也不再叠
  const d2 = duel({ first: "2队" });
  const [k2, h2] = d2.heroes;
  assert.equal(k2.bonus, 1, "1 队后手：先有 1 个");
  k2.stunned = true; k2.def = 0;
  d2.c.endPlayerTurn();
  assert.equal(k2.bonus, 0, "失衡：这一回合没有附赠");
  assert.equal(h2.bonus, 2, "赫鲁米卡照常叠上");
  d2.c.endEnemyTurn(); d2.c.endPlayerTurn();
  assert.equal(k2.bonus, 1, "下一回合：平常的 1 个（补偿不会留到第二回合）");
});

test("后手补偿只有决斗有：主持人分阵营（不是决斗）时在敌人回合行动的阵营开战照旧没有附赠，回合开始照常补", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu", "hiaki", "tou"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "DUEL472-GM" });
  const S = c.S.state;
  const [kolt, helu, hiaki, tou] = ["kolt", "helu", "hiaki", "tou"].map(k => c.findKit(k, S.units));
  c.Commands.dispatch({ type: "battle.playerFaction", faction: "乙", phase: "enemy" });
  [hiaki, tou].forEach(u => c.Commands.dispatch({ type: "battle.playerFaction", faction: "乙", unit: u.id }));
  c.startCombat();
  assert.deepEqual([hiaki.ap, hiaki.bonus], [0, 0], "照旧：开战时 0");
  c.endPlayerTurn();
  assert.equal(hiaki.bonus, 1, "照旧：敌人回合开始补 1 个");
  assert.ok(!/后手补偿|抛硬币/.test(logText(c)));
  assert.equal(S.pvpDuel, null);
  assert.equal(c.pvpDuelOutcome(), null, "不是决斗");
  assert.ok(kolt && helu);
});

test("伤害不会致死：起身中的人坚毅生命打到 1（或打穿）就保留 1，弹「再起不能」、移出战场（武器人跟着离场、指向他的嘲讽失效）；没打到 1 照常；不是决斗时同一下照旧死亡", () => {
  { // 一下打穿：保留 1，再起不能
    const { c, S, heroes: [kolt, helu, hiaki] } = duel();
    upOn(hiaki, 3);
    hiaki.zone = kolt.zone = 2;
    helu.tauntTo = hiaki.id;
    const out = smash(c, kolt, hiaki, 30);
    const said = (out.extra || []).join("\n");
    assert.equal(hiaki.shp, 1, "坚毅生命保留 1");
    assert.equal(hiaki.pvpOut, true, "再起不能");
    assert.equal(hiaki._removed, true, "移出战场");
    assert.ok(!c.fieldUnits().includes(hiaki), "不在场上");
    assert.deepEqual(plain(S.pvpDuel.out), [hiaki.id]);
    assert.equal(helu.tauntTo, null, "指向他的嘲讽失效");
    assert.match(said, /绯秋 再起不能（决斗中伤害不会致死），移出战场。/);
    assert.ok(!/死亡/.test(said), "不写死亡");
    assert.ok((S.floaters || []).some(f => f && f.unitId === hiaki.id && f.text === "再起不能"), "画面上弹「再起不能」");
    assert.equal(c.canControlUnit(hiaki), false, "不再行动");
    assert.equal(c.pvpDuelPublic().out[0], hiaki.id);
  }
  { // 刚好打到 1 也算；没打到 1 照常扣
    const { c, heroes: [kolt, , hiaki] } = duel();
    upOn(hiaki, 10);
    hiaki.zone = kolt.zone = 2;
    smash(c, kolt, hiaki, 3);
    assert.equal(hiaki.shp, 7, "10 − 3 = 7：照常");
    assert.ok(!hiaki.pvpOut && !hiaki.dead);
    smash(c, kolt, hiaki, 6);
    assert.equal(hiaki.shp, 1, "7 − 6 = 1：打到 1");
    assert.equal(hiaki.pvpOut, true, "打到 1 就再起不能");
  }
  { // 武器人跟着离场
    const { c, S, heroes: [kolt, , , tou] } = duel({ first: "2队" });
    tou.ap = 2;
    c.Commands.dispatch({ type: "skill", actor: tou.id, skill: "tou_summon" });
    const mochi = c.findKit("mochi", S.units);
    assert.ok(mochi && !mochi.hidden, "年糕上场");
    upOn(tou, 2);
    tou.zone = kolt.zone = 2;
    smash(c, kolt, tou, 20);
    assert.equal(tou.pvpOut, true);
    assert.equal(mochi._removed, true, "年糕跟着离场");
    assert.ok(!c.fieldUnits().includes(mochi));
    assert.ok(!c.eligibleBlockers(kolt, null).includes(mochi));
  }
  { // 坠落（applyKnockdown 的坚毅扣法）、力竭 3 被击倒、拉斯缪尔不稳态起身后再挨打：都只是再起不能
    const { c, S, heroes: [kolt, helu, hiaki, tou] } = duel();
    upOn(hiaki, 3);
    assert.equal(c.applyKnockdown(hiaki, [], { shpLoss: 5, cause: "坠落" }), "dead");
    assert.equal(hiaki.shp, 1);
    assert.equal(hiaki.pvpOut, true, "坠落打穿：再起不能");
    S.exhaustTier = 3;
    (tou.layers || []).forEach(l => { l.current = 0; });
    c.applyKnockdown(tou, []);
    assert.equal(tou.pvpOut, true, "力竭 3 被击倒：再起不能（不是死亡）");
    S.exhaustTier = 0;
    assert.ok(kolt && helu);
  }
  { // 对照：不是决斗时同样一下照旧死亡
    const c = H.load();
    c.BattleSim.setup({ party: ["kolt", "hiaki"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "DUEL472-CTRL" });
    const S = c.S.state;
    const [kolt, hiaki] = ["kolt", "hiaki"].map(k => c.findKit(k, S.units));
    c.Commands.dispatch({ type: "battle.playerFaction", faction: "乙", unit: hiaki.id });
    c.startCombat();
    upOn(hiaki, 3);
    hiaki.zone = kolt.zone = 2;
    smash(c, kolt, hiaki, 30);
    assert.equal(hiaki.dead, true, "主持人分阵营：照旧死亡");
    assert.equal(hiaki.shp, 0);
    assert.ok(!hiaki.pvpOut && !hiaki._removed);
  }
});

test("不允许起身：倒地的人留在场上（不移出），自己起不来（起身指令、起身并协助格挡、自动对打都不起），专长「拉一把」能把他救起来；允许起身时照常起身", () => {
  const { c, S, heroes: [kolt, helu, hiaki, tou] } = duel({ cmd: { stand: false }, first: "2队" });
  assert.equal(S.pvpDuel.stand, false);
  assert.match(logText(c), /不允许起身/);
  knockDown(hiaki);
  hiaki.shp = 30;
  assert.equal(c.standUpBlocked(hiaki), "决斗不允许起身");
  assert.equal(c.standUpBlocked(kolt), "决斗不允许起身", "两队都一样");
  c.Commands.dispatch({ type: "standUp", actor: hiaki.id });
  assert.equal(hiaki.dying, true, "起身指令：起不来");
  assert.equal(hiaki.upOnShp, false);
  assert.ok(c.fieldUnits().includes(hiaki), "倒地的人留在场上");
  assert.ok(!hiaki._removed && !hiaki.pvpOut);
  assert.match(logText(c), /绯秋 决斗不允许起身/);
  // 起身并协助格挡也不行
  [kolt, hiaki, tou].forEach(u => { u.zone = 2; });
  hiaki.bonus = 1;
  assert.ok(!c.eligibleBlockers(tou, null).includes(hiaki), "倒地起不来：不能起身并格挡");
  // 自动对打的打法不起身
  assert.equal(c.BattleSim.BASIC_POLICY.act(hiaki), null);
  // 专长「拉一把」：同队的灯用医疗包把他拉起来
  tou.feats = ["pickup"];
  tou.ap = 2;
  c.bagAdd("medkit", 1);
  c.Commands.dispatch({ type: "skill", actor: tou.id, skill: "feat_pickup", picks: { target: hiaki.id, item: "medkit" } });
  assert.equal(hiaki.dying, false, "拉一把：起来了");
  assert.ok(c.totalHp(hiaki) > 0);
  assert.equal(c.bagCount("medkit"), 0);
  // 允许起身（默认）：照常起身
  const d2 = duel({ first: "2队" });
  const [, , h2] = d2.heroes;
  knockDown(h2); h2.shp = 30;
  assert.equal(d2.c.standUpBlocked(h2), null);
  d2.c.Commands.dispatch({ type: "standUp", actor: h2.id });
  assert.equal(h2.upOnShp, true, "允许起身：起来了");
  assert.ok(helu);
});

test("胜负：一队全部倒地（含再起不能移出的）另一队获胜；两队同时全倒算平局；不许起身时倒在场上的也算倒地；还有人站着就接着打", () => {
  const outcome = d => plain(d.c.pvpDuelOutcome());
  {
    const d = duel();
    const [kolt, helu, hiaki, tou] = d.heroes;
    assert.deepEqual(outcome(d), { over: false }, "都站着：接着打");
    knockDown(hiaki);
    assert.deepEqual(outcome(d), { over: false }, "2 队还有灯");
    upOn(tou, 1); tou.zone = kolt.zone; smash(d.c, kolt, tou, 10);
    assert.equal(tou.pvpOut, true);
    const r = outcome(d);
    assert.equal(r.over, true);
    assert.equal(r.winner, "1队", "2 队全倒（倒地 + 再起不能）：1 队获胜");
    assert.equal(r.draw, false);
    assert.equal(r.why, "wipe");
    assert.equal(r.text, "1 队获胜：2 队全部倒地。");
    assert.equal(d.c.BattleSim.outcome(), "player", "自动对打：有人赢");
    assert.ok(helu);
  }
  {
    const d = duel();
    d.heroes.forEach(knockDown);
    const r = outcome(d);
    assert.equal(r.winner, null);
    assert.equal(r.draw, true, "两队同时全倒：平局");
    assert.equal(r.text, "平局：两队同时全部倒地。");
    assert.equal(d.c.BattleSim.outcome(), "draw");
  }
  { // 不许起身：倒在场上的也算倒地
    const d = duel({ cmd: { stand: false } });
    const [kolt, helu] = d.heroes;
    knockDown(kolt); knockDown(helu);
    assert.ok(d.c.fieldUnits().includes(kolt), "还在场上");
    assert.equal(outcome(d).winner, "2队");
  }
  { // 整场自动对打：打到一队全倒，结果写在 duel 里
    const d = duel({ seed: "DUEL472-SIM" });
    const r = plain(d.c.BattleSim.run({ maxRounds: 30 }));
    assert.notEqual(r.winner, "timeout", "分出了胜负");
    assert.ok(r.duel, "结果里带着决斗");
    assert.equal(r.duel.why, "wipe");
    if (r.duel.winner) assert.deepEqual(r.pvpWinners, [r.duel.winner]);
    assert.ok(!d.heroes.some(h => h.dead && !h.pvpOut), "没有人真的死亡");
    assert.ok(r.heroes.every(h => !h.dead || d.heroes.find(x => x.name === h.name).pvpOut));
  }
});

test("回合上限：打满限定的回合还没分出胜负，剩余血量百分比多的一队获胜（各层血量合计 ÷ 上限合计，不算坚毅生命，倒地的按 0）；一样算平局；没开就不限", () => {
  { // 限定 2 回合：1 队 50%、2 队 75% → 2 队获胜
    const d = duel({ cmd: { rounds: 2 } });
    const { c, S } = d;
    const [kolt, helu, hiaki, tou] = d.heroes;
    [kolt, helu, hiaki, tou].forEach(u => { u.layers = [{ type: "flesh", current: 40, max: 40, inner: true }]; });
    kolt.layers[0].current = 0; kolt.dying = true;   // 倒地：按 0 算
    hiaki.layers[0].current = 20;                     // 2 队：20 + 40 = 60 / 80 = 75%；1 队：0 + 40 = 40 / 80 = 50%
    kolt.shp = 999; helu.shp = 999; hiaki.shp = 1; tou.shp = 1;   // 坚毅不算
    c.endPlayerTurn(); c.endEnemyTurn();
    assert.equal(S.turnNo, 2, "第 1 回合打完：还没到");
    assert.deepEqual(plain(c.pvpDuelOutcome()), { over: false });
    c.endPlayerTurn(); c.endEnemyTurn();
    assert.equal(S.turnNo, 2, "打满 2 回合：不再开第 3 回合");
    const r = plain(c.pvpDuelOutcome());
    assert.equal(r.over, true);
    assert.equal(r.why, "rounds");
    assert.equal(r.winner, "2队", "75% > 50%：2 队获胜");
    assert.deepEqual(r.pct, { "1队": 0.5, "2队": 0.75 });
    assert.match(logText(c), /回合上限：打满 2 回合还没分出胜负，按剩余血量百分比（1 队 50%、2 队 75%）——2 队获胜。/);
    assert.equal(c.BattleSim.outcome(), "player");
  }
  { // 一样：平局（坚毅不同也一样）
    const d = duel({ cmd: { rounds: 1 } });
    const { c } = d;
    d.heroes.forEach((u, i) => { u.layers = [{ type: "flesh", current: 30, max: 60, inner: true }]; u.shp = i * 100; });
    c.endPlayerTurn(); c.endEnemyTurn();
    const r = plain(c.pvpDuelOutcome());
    assert.equal(r.draw, true, "50% 对 50%：平局");
    assert.equal(r.winner, null);
    assert.match(logText(c), /两队一样，平局/);
    assert.equal(c.BattleSim.outcome(), "draw");
  }
  { // 交叉相乘比：1/3 对 2/6 一样（不会因为小数算成不一样）
    const d = duel({ cmd: { rounds: 1 }, teams: h => ({ "1队": [h[0].id], "2队": [h[2].id, h[3].id] }) });
    const [kolt, , hiaki, tou] = d.heroes;
    kolt.layers = [{ type: "flesh", current: 10, max: 30, inner: true }];
    hiaki.layers = [{ type: "flesh", current: 20, max: 30, inner: true }];
    tou.layers = [{ type: "flesh", current: 0, max: 30, inner: true }]; tou.dying = true;
    d.c.endPlayerTurn(); d.c.endEnemyTurn();
    assert.equal(plain(d.c.pvpDuelOutcome()).draw, true, "10/30 对 20/60：平局");
  }
  { // 没开回合上限：打几回合都不判
    const d = duel();
    for (let i = 0; i < 4; i++) { d.c.endPlayerTurn(); d.c.endEnemyTurn(); }
    assert.equal(d.S.turnNo, 5);
    assert.deepEqual(plain(d.c.pvpDuelOutcome()), { over: false });
  }
  { // 整场自动对打打满上限：结果带剩余血量百分比
    const d = duel({ cmd: { rounds: 1 }, seed: "DUEL472-R1" });
    const r = plain(d.c.BattleSim.run({ maxRounds: 30 }));
    assert.equal(r.rounds, 1);
    assert.equal(r.duel.why, "rounds");
    assert.ok(r.duel.pct && typeof r.duel.pct["1队"] === "number");
  }
});

test("结束后恢复：队伍档案里参加的人的血量、坚毅生命、武器耐久恢复成决斗前的样子；用掉的道具不恢复；没有掉落、经验、奎支，不评级、不记进最近 10 场", () => {
  const d = duel({
    before(c, heroes) {
      const [kolt, , hiaki] = heroes;
      c.LEDGER.heroes = { kolt: { layers: [5, 9], shp: 22, dying: false, dead: false, upOnShp: false } };
      c.LEDGER.dur = {};
      (kolt.linkedKits || []).forEach(k => { c.LEDGER.dur[k] = 3; });
      assert.ok((hiaki.linkedKits || []).length, "绯秋有武器");
    }
  });
  const { c, S } = d;
  const [kolt, helu, hiaki, tou] = d.heroes;
  const kKit = (kolt.linkedKits || [])[0], hKit = (hiaki.linkedKits || [])[0];
  assert.ok(kKit && hKit);
  const ledgerBefore = plain(c.LEDGER.heroes), durBefore = plain(c.LEDGER.dur);
  const xpBefore = d.heroes.map(h => h.xp || 0), kuizhiBefore = Number(S.kuizhi) || 0;
  const careerBefore = plain(c.careerData());
  c.bagAdd("medkit", 2);
  S.battleDrops = { kuizhi: 500, items: [{ id: "medkit", qty: 3 }] };   // 就算主持人配过掉落也不给
  // 决斗中：受伤、倒地、再起不能、扣耐久、用道具
  upOn(hiaki, 2); hiaki.zone = kolt.zone = 2;
  smash(c, kolt, hiaki, 30);
  assert.equal(hiaki.pvpOut, true);
  c.spendDurability(kKit, 2, "测试", []);
  c.spendDurability(hKit, 1, "测试", []);
  assert.equal(c.LEDGER.dur[kKit], 1);
  kolt.ap = 2;
  c.Commands.dispatch({ type: "useItem", actor: kolt.id, item: "medkit", target: helu.id });
  assert.equal(c.bagCount("medkit"), 1, "用掉了一个医疗包");
  // 结算：没有奖励
  const res = plain(c.settleBattleRewards("win"));
  assert.equal(res.grade, null, "不评级");
  assert.equal(res.xpBonus, 0);
  assert.deepEqual(res.trpgXp, [], "没有经验");
  assert.equal(res.drops, null, "没有掉落");
  assert.deepEqual(res.ups, []);
  assert.ok(res.duel, "带着决斗的公开部分");
  assert.ok(!JSON.stringify(res).includes("restore"), "不带决斗前的坚毅");
  assert.equal(Number(S.kuizhi) || 0, kuizhiBefore, "没有奎支");
  assert.deepEqual(d.heroes.map(h => h.xp || 0), xpBefore, "经验不变");
  assert.deepEqual(plain(c.careerData()), careerBefore, "不记进最近 10 场");
  assert.equal(c.bagCount("medkit"), 1, "掉落的医疗包没给");
  // 平局也认（只有决斗有）
  assert.equal(plain(c.settleBattleRewards("draw")).alreadySettled, true);
  // 战后：恢复成决斗前的样子
  const notes = c.ledgerAfterBattle([]);
  assert.deepEqual(plain(c.LEDGER.heroes), ledgerBefore, "血量 / 坚毅照决斗前（没记过的照旧没记）");
  assert.equal(c.LEDGER.heroes.hiaki, undefined, "绯秋决斗前没有记录：还是没有（下一场按满的）");
  assert.deepEqual(plain(c.LEDGER.dur), durBefore, "耐久照决斗前（战斗结束也不扣）");
  assert.match(notes.join("\n"), /决斗结束：血量、坚毅生命、武器耐久恢复成决斗前的样子（用掉的道具不恢复）/);
  assert.equal(c.bagCount("medkit"), 1, "用掉的道具不恢复");
  assert.ok(tou);
});

test("只有决斗认「平局」；决斗不能撤退", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "DUEL472-DRAW" });
  c.startCombat();
  assert.throws(() => c.settleBattleRewards("draw"), /未知的战斗结局/, "不是决斗：没有平局");
  const d = duel();
  assert.throws(() => d.c.Commands.dispatch({ type: "retreat" }), /决斗不能撤退/);
});
