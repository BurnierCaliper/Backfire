// 无界面战斗（sim.js · BattleSim）里新唤出的武器人当回合就能行动（issue #547，主人 11/01：「武器人一上场就可以立刻行动才合理」——
// 游戏里唤出的武器人出场就带着行动点和附赠，单机画面当回合就能操作，联机的行动顺序 hotseat.js · reconcile 也是立刻轮到它）。
// 以前 playerPhase 一开始就把这一阶段要行动的名单定死，中途唤出的武器人要等下一个阶段才第一次行动（SKILL_POLICY 唤出武器人等于白花一回合）。
// 现在每轮完一个人再看一遍场上：新进场、还没轮到过的接着轮到（排在剩下的人前面）；同一个单位一个阶段最多轮到一次
// （武器人按「持有者 + 哪把武器」认：收回再唤出编号会变，还算同一个）。只改模拟，规则一条没动。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../tools/pvp-balance");

/** 决斗（照 PvP 平衡模拟布置，10 级：武器人的技能都有了）。first "a"：a 队先手（我方回合行动），b 队后手（在敌人回合行动） */
function duel(a, b, seed) {
  const job = { kind: "random", variant: "base", size: a.length, level: 10, index: 0, a, b, seed, first: "a", aTeam: "1队" };
  return P.prepare(job);
}

/** 照剧本行动的打法：第 1 回合 script[kit](u) 给出这一下的战斗指令（null = 这个人这回合不再动；也可以直接给一个函数），别的回合谁都不动。
 *  calls：每一次轮到谁（第几回合、哪个阶段、单位、当时的行动点）；done：真的做了的动作（行动点前后）；
 *  ends：每个阶段结束时（endPlayerTurn / endEnemyTurn 之前）场上每个单位的行动点 */
function scripted(c, script) {
  const S = c.S.state, calls = [], done = [], ends = [];
  const policy = {
    act(u) {
      calls.push({ turn: S.turnNo, phase: S.combatPhase, kit: u.kit, id: u.id, ap: u.ap });
      const make = S.turnNo === 1 && script[u.kit];
      const cmd = make ? make(u) : null;
      if (!cmd) return null;
      return () => {
        const ap0 = u.ap;
        if (typeof cmd === "function") cmd();
        else assert.ok(c.BattleSearch.execute(Object.assign({ actor: u.id, target: null, picks: {} }, cmd)), "指令执行成功：" + JSON.stringify(cmd));
        const me = c.unitById(u.id) || u;
        done.push({ turn: S.turnNo, phase: S.combatPhase, kit: u.kit, id: u.id, skill: typeof cmd === "function" ? "script" : cmd.skill || cmd.type, ap0, ap1: me.ap });
      };
    }
  };
  const snap = (phase) => ends.push({ turn: S.turnNo, phase, units: S.units.filter(u => !u.hidden).map(u => ({ kit: u.kit, id: u.id, ap: u.ap })) });
  for (const [name, phase] of [["endPlayerTurn", "player"], ["endEnemyTurn", "enemy"]]) {
    const orig = c[name];
    c[name] = function () { snap(phase); return orig.apply(this, arguments); };
  }
  return { policy, calls, done, ends };
}
const onField = (c, kit) => c.S.state.units.find(u => u.kit === kit && !u.hidden && !u.dead);
/** 唤出武器人（只唤一次：武器人已经在场就不唤） */
const summon = (c, skill, kit) => (u) => (!onField(c, kit) && u.ap >= 1 && u.bonus >= 1 ? { type: "skill", skill } : null);
/** 柏妮尔：点火突进飞到另一区（分步里能选的第一个区） */
const dash = (c) => (u) => {
  if (u.ap < 1) return null;
  const dest = c.skillFlowSteps("berniel_dash", u, {}).find(s => s.key === "dest").zones[0];
  return { type: "skill", skill: "berniel_dash", picks: { carry: null, dest } };
};
/** 扭矩：强化输出（电钻：突进到距离 1 的区，那一区有对手就打它） */
const boost = (c) => (u) => {
  if (u.ap < 1) return null;
  const dest = c.skillFlowSteps("torque_boost", u, {}).find(s => s.key === "dest").zones[0];
  const pick = (c.skillFlowSteps("torque_boost", u, { dest }).find(s => s.key === "target") || { units: [] }).units[0];
  return pick ? { type: "skill", skill: "torque_boost", target: pick.id, picks: { dest, target: pick.id } } : { type: "skill", skill: "torque_boost", picks: { dest } };
};
/** 同一个阶段里每个单位只轮到一次：按顺序把 calls 里连着的同一个单位并成一段，每个单位在一个阶段里只有一段 */
function assertOneTurnEach(calls) {
  const seen = new Set();
  let last = null;
  for (const x of calls) {
    const key = `${x.turn}|${x.phase}|${x.id}`;
    if (key === last) continue;
    assert.ok(!seen.has(key), `第 ${x.turn} 回合（${x.phase}）${x.kit}（${x.id}）被轮到了两次：` + JSON.stringify(calls.map(y => `${y.turn}${y.phase[0]}:${y.kit}`)));
    seen.add(key); last = key;
  }
}
/** 这个阶段轮到的先后（连着的同一个单位并成一个）。场上的顺序是角色卡的顺序（瑞比、结人、绯秋、灯、夕夏、川川、诺拉、柯尔特、Helumica……），武器人唤出时排到最后 */
const order = (calls, turn, phase) => calls.filter(x => x.turn === turn && x.phase === phase).map(x => x.kit).filter((k, i, a) => a[i - 1] !== k);
const endAp = (ends, turn, phase, id) => ((ends.find(e => e.turn === turn && e.phase === phase) || { units: [] }).units.find(u => u.id === id) || {}).ap;

test("夕夏第 1 回合唤出柏妮尔：柏妮尔同一回合就轮到，点火突进用掉行动点（接在夕夏后面、诺拉前面）", () => {
  const { c } = duel(["xia", "nora"], ["helu", "tou"], "T547-XIA");
  const { policy, calls, done, ends } = scripted(c, { xia: summon(c, "xia_summon", "berniel"), berniel: dash(c) });
  c.BattleSim.run({ maxRounds: 1, policy });
  const bern = c.S.state.units.find(u => u.kit === "berniel");
  assert.ok(bern, "柏妮尔唤出来了");
  assert.deepEqual(done.filter(x => x.kit === "xia").map(x => [x.turn, x.phase, x.skill]), [[1, "player", "xia_summon"]]);
  const act = done.find(x => x.kit === "berniel");
  assert.ok(act, "柏妮尔第 1 回合行动了：" + JSON.stringify(order(calls, 1, "player")));
  assert.deepEqual([act.turn, act.phase, act.skill, act.ap0, act.ap1], [1, "player", "berniel_dash", 1, 0], "同一回合：点火突进用掉了出场带的 1 行动点");
  assert.equal(endAp(ends, 1, "player", bern.id), 0, "我方回合结束时柏妮尔的行动点已经用掉");
  assert.deepEqual(order(calls, 1, "player"), ["xia", "berniel", "nora"], "新进场的接在刚轮完的人后面，原来就在场的人顺序不变");
  assertOneTurnEach(calls);
  assert.deepEqual(JSON.parse(JSON.stringify(c.__errors)), []);
});

test("柯尔特第 1 回合唤出扭矩：扭矩同一回合就用强化输出（行动点用掉）", () => {
  const { c } = duel(["kolt", "helu"], ["ruby", "tou"], "T547-KOLT");
  const { policy, calls, done, ends } = scripted(c, { kolt: summon(c, "kolt_summon", "torque"), torque: boost(c) });
  c.BattleSim.run({ maxRounds: 1, policy });
  const torque = c.S.state.units.find(u => u.kit === "torque");
  assert.ok(torque, "扭矩唤出来了");
  const act = done.find(x => x.kit === "torque");
  assert.ok(act, "扭矩第 1 回合行动了：" + JSON.stringify(order(calls, 1, "player")));
  assert.deepEqual([act.turn, act.phase, act.skill, act.ap0, act.ap1], [1, "player", "torque_boost", 1, 0]);
  assert.equal(endAp(ends, 1, "player", torque.id), 0);
  assert.deepEqual(order(calls, 1, "player"), ["kolt", "torque", "helu"]);
  assertOneTurnEach(calls);
  assert.deepEqual(JSON.parse(JSON.stringify(c.__errors)), []);
});

test("决斗后手（在敌人回合行动的玩家阵营）：第 1 个敌人回合唤出的柏妮尔、扭矩同一个敌人回合就行动", () => {
  const { c } = duel(["ruby", "tou"], ["xia", "kolt"], "T547-LATE");
  const { policy, calls, done, ends } = scripted(c, {
    xia: summon(c, "xia_summon", "berniel"), berniel: dash(c),
    kolt: summon(c, "kolt_summon", "torque"), torque: boost(c)
  });
  c.BattleSim.run({ maxRounds: 1, policy });
  const S = c.S.state;
  const bern = S.units.find(u => u.kit === "berniel"), torque = S.units.find(u => u.kit === "torque");
  assert.ok(bern && torque, "两个武器人都唤出来了");
  assert.deepEqual([c.unitTurnPhase(bern), c.unitTurnPhase(torque)], ["enemy", "enemy"], "武器人跟着持有者在敌人回合行动");
  assert.deepEqual(done.filter(x => x.kit === "xia" || x.kit === "kolt").map(x => [x.turn, x.phase, x.skill]), [[1, "enemy", "xia_summon"], [1, "enemy", "kolt_summon"]]);
  const b = done.find(x => x.kit === "berniel"), t = done.find(x => x.kit === "torque");
  assert.ok(b && t, "两个武器人第 1 个敌人回合都行动了：" + JSON.stringify(order(calls, 1, "enemy")));
  assert.deepEqual([b.turn, b.phase, b.skill, b.ap0, b.ap1], [1, "enemy", "berniel_dash", 1, 0]);
  assert.deepEqual([t.turn, t.phase, t.skill, t.ap0, t.ap1], [1, "enemy", "torque_boost", 1, 0]);
  assert.deepEqual([endAp(ends, 1, "enemy", bern.id), endAp(ends, 1, "enemy", torque.id)], [0, 0], "敌人回合结束时两个武器人的行动点都用掉了");
  assert.deepEqual(order(calls, 1, "enemy"), ["xia", "berniel", "kolt", "torque"]);
  assert.deepEqual(order(calls, 1, "player"), ["ruby", "tou"], "先手的回合里后手的人不动");
  assertOneTurnEach(calls);
  assert.deepEqual(JSON.parse(JSON.stringify(c.__errors)), []);
});

test("守卫：已经轮到过的单位不会因为重新看一遍场上又轮到；武器人行动完被收回、再唤出（编号变了）也不再轮到", () => {
  // 先把扭矩放到场上、排到柯尔特前面（这一阶段扭矩先轮到）：扭矩收回为武器，柯尔特再唤出一个新的扭矩（新编号，出场带 1 行动点）
  const { c, S } = duel(["kolt", "helu"], ["ruby", "tou"], "T547-GUARD");
  c.startCombat();
  const kolt = S.units.find(u => u.kit === "kolt");
  const first = c.spawnWeapon(kolt, "torque");
  S.units.splice(S.units.indexOf(first), 1);
  S.units.unshift(first);
  const { policy, calls, done, ends } = scripted(c, {
    torque: (u) => (u.id === first.id && u.ap >= 1 ? { type: "skill", skill: "torque_return" } : boost(c)(u)),
    kolt: summon(c, "kolt_summon", "torque"),
    // Helumica 被问到时有附赠就走一格：要是重新看一遍场上又轮到 Helumica，calls 里就会多出一段
    helu: (u) => (u.bonus >= 1 ? { type: "move", dest: c.zoneNeighbors(u.zone)[0] } : null)
  });
  c.BattleSim.run({ maxRounds: 1, policy });
  const second = S.units.find(u => u.kit === "torque" && !u.hidden);
  assert.ok(second && second.id !== first.id, "再唤出的扭矩是新建的单位（编号变了）");
  assert.deepEqual(done.filter(x => x.turn === 1).map(x => [x.kit, x.skill]), [["torque", "torque_return"], ["kolt", "kolt_summon"], ["helu", "move"]]);
  assert.deepEqual(order(calls, 1, "player"), ["torque", "kolt", "helu"], "收回再唤出的扭矩算同一个，这一阶段不再轮到");
  assert.ok(!calls.some(x => x.turn === 1 && x.id === second.id), "新编号的扭矩第 1 回合没被问过");
  assert.equal(endAp(ends, 1, "player", second.id), 1, "新唤出的扭矩出场带的行动点留着没用（下一个阶段才轮到它）");
  assertOneTurnEach(calls);
  assert.deepEqual(JSON.parse(JSON.stringify(c.__errors)), []);
});

test("守卫：还没轮到就被收回的武器人不算轮到过——同一阶段再唤出（新编号）照样轮到一次", () => {
  // 扭矩开局就在场（排在最后，还没轮到）：柯尔特先把它收回（直接调规则函数，和协助攻击前的强制收回一样，app.js · forceRecallWeapons），再唤出新的
  const { c, S } = duel(["kolt", "helu"], ["ruby", "tou"], "T547-BACK");
  c.startCombat();
  const kolt = S.units.find(u => u.kit === "kolt");
  const first = c.spawnWeapon(kolt, "torque");
  const { policy, calls, done, ends } = scripted(c, {
    kolt: (u) => (onField(c, "torque") === first && u.ap >= 1 && u.bonus >= 1
      ? () => { c.returnWeapon(first); assert.ok(c.BattleSearch.execute({ type: "skill", actor: u.id, skill: "kolt_summon", target: null, picks: {} })); }
      : null),
    torque: boost(c)
  });
  c.BattleSim.run({ maxRounds: 1, policy });
  const second = S.units.find(u => u.kit === "torque" && !u.hidden);
  assert.ok(second && second.id !== first.id && !S.units.includes(first), "旧的扭矩换成了新唤出的");
  assert.ok(!calls.some(x => x.id === first.id), "旧编号的扭矩没轮到（被收回了）");
  const act = done.find(x => x.kit === "torque");
  assert.ok(act && act.id === second.id, "新唤出的扭矩轮到了：" + JSON.stringify(order(calls, 1, "player")));
  assert.deepEqual([act.turn, act.phase, act.skill, act.ap0, act.ap1], [1, "player", "torque_boost", 1, 0]);
  assert.equal(endAp(ends, 1, "player", second.id), 0);
  assert.deepEqual(order(calls, 1, "player"), ["kolt", "torque", "helu"], "新唤出的接在柯尔特后面；排在最后的旧编号被收回了，跳过");
  assertOneTurnEach(calls);
  assert.deepEqual(JSON.parse(JSON.stringify(c.__errors)), []);
});
