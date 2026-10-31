// 看情况用技能的打法（issue #538，sim.js · BattleSim.SKILL_POLICY，搜索在 sim-search.js · BattleSearch）：
// 1v1、4v4 决斗和遭遇战都能打完、不卡住；同一种子结果一样；会用技能、召唤武器人（统计里看得到）；固定的小场景里挑明显更好的动作；
// 试跑不动真实的局面和骰子。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const P = require("../tools/pvp-balance");
const plain = (x) => JSON.parse(JSON.stringify(x));

/** 决斗（照 PvP 平衡模拟布置）：两队都用 SKILL_POLICY，满状态不带道具 */
function duel(a, b, level, seed, variant) {
  const job = { kind: "random", variant: variant || "base", size: a.length, level, index: 0, a, b, seed, first: "a", aTeam: "1队" };
  const { c, S } = P.prepare(job);
  const policy = c.BattleSim.skillPolicy({ cfg: { items: false } });
  const res = c.BattleSim.run({ maxRounds: 40, policy });
  return { c, S, res, stats: policy.stats };
}

test("SKILL_POLICY：1v1、4v4 决斗和一场遭遇战都能打完（不卡住、不报错）", () => {
  const one = duel(["kolt"], ["ruby"], 3, "T538-ONE");
  assert.ok(one.res.duel && ["player", "draw"].includes(one.res.winner), "1v1 分出了结果：" + JSON.stringify(one.res.duel));
  assert.deepEqual(plain(one.c.__errors), []);
  const four = duel(["kolt", "helu", "ruby", "tou"], ["hiaki", "xia", "nora", "ras"], 3, "T538-FOUR", "rounds");
  assert.ok(four.res.duel && four.res.duel.winner !== undefined && four.res.winner !== "timeout", "4v4 分出了结果：" + JSON.stringify(four.res.duel));
  assert.ok(four.res.rounds <= P.CONFIG.roundsLimit, "回合上限 10 以内打完");
  assert.deepEqual(plain(four.c.__errors), []);
  assert.ok(four.stats.actions > 0 && four.stats.decisions >= four.stats.actions);
  // 遭遇战（PvE）：我方用 SKILL_POLICY，敌人照旧用 ai.js
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu", "ras"], enemies: ["thug_knife", "thug_hammer", "bandit_boss"].map(id => ({ id, lv: 1, zone: 2 })), seed: "T538-PVE" });
  const policy = c.BattleSim.skillPolicy();
  const r = c.BattleSim.run({ maxRounds: 40, policy });
  assert.ok(["player", "enemy"].includes(r.winner), "遭遇战分出了结果：" + r.winner);
  assert.deepEqual(plain(c.__errors), []);
  assert.ok(policy.stats.actions > 0);
});

test("SKILL_POLICY：同一种子整场结果一样（试跑不动真实的骰子）", () => {
  const a = duel(["hiaki"], ["helu"], 10, "T538-SAME"), b = duel(["hiaki"], ["helu"], 10, "T538-SAME");
  assert.deepEqual(plain(a.res), plain(b.res));
  assert.deepEqual(plain(a.stats), plain(b.stats));
  // 想一步（BattleSearch.plan）前后，真实的局面、骰子（种子随机数掷到第几个）、战斗记录都没变
  const { c, S } = P.prepare({ kind: "random", variant: "base", size: 2, level: 10, index: 0, a: ["kolt", "ruby"], b: ["hiaki", "nora"], seed: "T538-PURE", first: "a", aTeam: "1队" });
  c.startCombat();
  const kolt = S.units.find(u => u.kit === "kolt");
  const before = JSON.stringify(S.units), draws = c.S.RNG.draws(), seed = c.S.RNG.seed, pages = JSON.stringify(S.logPages), random = c.Math.random;
  const tok = c.BattleSearch.plan(kolt.id, c.BattleSim.SKILL_POLICY, c.S.SKILL_POLICY_CFG);
  assert.ok(tok, "第一回合有事做");
  assert.equal(JSON.stringify(S.units), before, "局面没变");
  assert.deepEqual([c.S.RNG.draws(), c.S.RNG.seed, c.Math.random === random], [draws, seed, true], "骰子没动");
  assert.equal(JSON.stringify(S.logPages), pages, "战斗记录没多出试跑的内容");
  assert.equal(c.BattleSearch.busy(), false);
});

test("SKILL_POLICY：会用技能、会召唤武器人（统计里看得到）", () => {
  const { res, stats } = duel(["kolt"], ["ruby"], 10, "T538-SKILL");
  assert.ok(res.duel && res.duel.winner, JSON.stringify(res.duel));
  assert.ok(stats.summons >= 1, "召唤了武器人：" + JSON.stringify(stats.skills));
  assert.ok(Object.keys(stats.skills).some(id => !/_aa$/.test(id) && !/_summon$/.test(id)), "用了普攻、召唤以外的技能：" + JSON.stringify(stats.skills));
  // 4v4 里两队一共用了好几种技能
  const four = duel(["kolt", "helu", "ruby", "tou"], ["hiaki", "xia", "nora", "ras"], 10, "T538-MIX", "rounds");
  assert.ok(Object.keys(four.stats.skills).filter(id => !/_aa$/.test(id)).length >= 3, JSON.stringify(four.stats.skills));
});

test("SKILL_POLICY：固定的小场景挑明显更好的动作（对面一个满血、一个残血 → 打残血的；满血不用医疗包）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }], seed: "T538-PICK" });
  c.startCombat();
  const S = c.S.state;
  const kolt = S.units.find(u => u.kit === "kolt");
  const [full, weak] = S.units.filter(u => !u.isPlayer);
  assert.equal(Number(kolt.zone), 1);
  weak.layers.forEach((l, i) => { l.current = i === 0 ? 1 : 0; });   // 残血：只剩 1 点
  const cfg = c.S.SKILL_POLICY_CFG, policy = c.BattleSim.skillPolicy();
  const tok = c.BattleSearch.plan(kolt.id, policy, cfg);
  const cmd = c.BattleSearch.resolve(tok);
  assert.equal(cmd.type, "skill");
  assert.equal(cmd.target, weak.id, "打残血的那个：" + JSON.stringify(cmd));
  assert.ok(c.BattleSearch.plan.last.best > 0);
  // 照这一步真的做：残血的倒下
  policy.act(kolt)();
  assert.ok(weak.dead || weak.hidden || weak._removed || c.totalHp(weak) <= 0, "残血的敌人倒下");
  assert.ok(c.totalHp(full) > 0);
  // 满血、背包里有医疗包、够不着敌人：不拿医疗包给满血的人用（也不乱走、不乱放技能就结束）
  const d = H.load();
  d.BattleSim.setup({ party: ["helu", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "T538-CALM" });
  d.startCombat();
  const helu = d.S.state.units.find(u => u.kit === "helu");
  d.dispatch({ type: "battle.panel", action: "bagAdd", item: "medkit", amount: 2 });
  assert.ok(d.bagCount("medkit") >= 2);
  const t2 = d.BattleSearch.plan(helu.id, d.BattleSim.skillPolicy(), d.S.SKILL_POLICY_CFG);
  const c2 = t2 && d.BattleSearch.resolve(t2);
  assert.ok(!c2 || c2.type !== "useItem", "满血不用医疗包：" + JSON.stringify(c2));
});

test("BattleSearch：列出的候选都是这个单位自己的；沙盒里试跑完局面原样还回去", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "tou"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "T538-CAND" });
  c.startCombat();
  const S = c.S.state, ruby = S.units.find(u => u.kit === "ruby");
  const list = c.BattleSearch.candidatesFor(ruby, c.S.SKILL_POLICY_CFG);
  assert.ok(list.length > 3);
  assert.ok(list.every(x => x.actor === ruby.id));
  assert.ok(list.some(x => x.type === "move") && list.some(x => x.type === "skill" && x.skill === "ruby_aa"));
  const before = JSON.stringify(S);
  const out = c.BattleSearch.sandbox(() => { list.forEach(cmd => { c.BattleSearch.execute(cmd); }); return 7; });
  assert.equal(out, 7);
  assert.equal(JSON.stringify(S), before);
});
