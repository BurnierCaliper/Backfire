// 专长框架（feats.js）：7 / 11 / 13 / 16 级各一项，不限职责和属性；被动 / 战斗动作 / 探索三类挂钩
// 这里换成测试用的几项专长测框架本身；正式专长的规则见 feat-content.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = (x) => JSON.parse(JSON.stringify(x));

/** 测试用的几项专长（先清掉正式内容，只测框架） */
function addSamples(c) {
  const F = c.S.FEATS;
  Object.keys(F).forEach(k => { delete F[k]; });
  F.t_tough = { id: "t_tough", name: "测试·强韧", kind: "passive", text: "架势上限 +1", repeatable: true,
    hooks: { apply: (u) => { u.defMax = (u.defMax || 0) + 1; u.def = Math.min(u.def, u.defMax); } } };
  F.t_jab = { id: "t_jab", name: "测试·刺拳", kind: "action", text: "附赠：同区一名敌人 0.5atk 物理",
    skill: { name: "刺拳", hint: "同区 · 0.5atk 物理", cost: { bonus: 1 }, uses: 1,
      targetWhy: (a, t) => !t || t.isPlayer ? "先选一名敌人" : null,
      run: (a, ctx) => { ctx.lines.push(`${a.name} 刺拳。`); ctx.hitOne(a, ctx.t, { element: "physical", mult: 0.5, hits: 1, baseBreak: 0 }); } } };
  F.t_lucky = { id: "t_lucky", name: "测试·好运", kind: "explore", text: "检定失败可以重掷一次",
    hooks: { check: (h, perks) => Object.assign(perks, { reroll: true, rerollName: "好运" }) } };
  F.t_start = { id: "t_start", name: "测试·先手", kind: "passive", text: "开战时 +1 附赠",
    hooks: { battleStart: (u, _, notes) => { notes.push(`${u.name} 先手。`); u._featStarted = true; } } };
}
function fresh(party, seed) {
  const c = H.load();
  const run = c.Rogue.newRun({ party, seed });
  return { c, run, R: c.Rogue };
}
function levelTo(run, R, h, xp) {
  h.xp = xp;
  R.acceptTask(run, 0);
  run.task.nodes = [{ type: "rest", done: false }];
  R.restAtNode(run, "short");
}

test("没有专长内容时：7 级只记下欠一项专长；写进内容后补成待选", () => {
  const { c, run, R } = fresh(["kolt", "helu"], "FT1");
  const F = c.S.FEATS;
  Object.keys(F).forEach(k => { delete F[k]; });
  const h = run.party[0];
  levelTo(run, R, h, 999999);
  assert.ok(h.level >= 7);
  const owed = h.notes.feat;
  assert.ok(owed >= 1);
  assert.ok(!R.pendingChoices(run).some(p => p.choice.type === "feat"));
  addSamples(c);
  const feats = R.pendingChoices(run).filter(p => p.kit === h.kit && p.choice.type === "feat");
  assert.equal(feats.length, owed);
  assert.equal(h.notes.feat, undefined);
});

test("升级选专长：谁都能选全部专长，不可重复的选过就不再出现，可重复的可以叠", () => {
  const { c, run, R } = fresh(["kolt", "helu"], "FT2");
  addSamples(c);
  const h = run.party[1];   // 赫鲁
  levelTo(run, R, h, 999999);
  const feat = () => R.pendingChoices(run).find(p => p.kit === h.kit && p.choice.type === "feat");
  const first = feat();
  assert.ok(first, "7 级应该有一项专长待选");
  const ids = plain(R.choiceOptions(run, h.kit, first.index).map(o => o.value)).sort();
  assert.deepEqual(ids, ["t_jab", "t_lucky", "t_start", "t_tough"]);
  R.choose(run, h.kit, first.index, "t_jab");
  const second = feat();
  if (second) {
    const opts = R.choiceOptions(run, h.kit, second.index).map(o => o.value);
    assert.ok(!opts.includes("t_jab"));
    assert.ok(opts.includes("t_tough"));
  }
  assert.throws(() => { h.pending.push({ type: "feat", level: 13 }); R.choose(run, h.kit, h.pending.length - 1, "t_jab"); }, /不可选/);
  assert.deepEqual(plain(R.heroView(run, h).feats), ["测试·刺拳"]);
});

test("被动专长：上场时改数值，重算不叠加；可重复的选两次就叠两次", () => {
  const c = H.load();
  addSamples(c);
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "FT3b" });
  const u = c.findKit("kolt", c.S.state.units);
  const base = u.defMax;
  u.feats = ["t_tough", "t_tough"];
  c.applyLevelStats(u);
  assert.equal(u.defMax, base + 2);
  c.applyLevelStats(u);
  assert.equal(u.defMax, base + 2);
});

test("战斗动作专长：出现在技能列表、按专长的消耗扣附赠、每场次数用完就不能再用；开战钩子会触发", () => {
  const c = H.load();
  addSamples(c);
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "FT4" });
  const S = c.S.state;
  const u = c.findKit("kolt", S.units);
  u.feats = ["t_jab", "t_start"];
  c.startCombat();
  assert.equal(u._featStarted, true);
  const sk = c.skillList(u).find(s => s.id === "feat_t_jab");
  assert.ok(sk, "技能列表里要有专长动作");
  assert.match(sk.hint, /专长/);
  assert.deepEqual(plain(c.skillCost("feat_t_jab")), { bonus: 1 });
  const foe = S.units.find(x => !x.isPlayer && !x.dead);
  u.zone = foe.zone;
  S.attackerId = u.id; S.targetId = foe.id;
  u.ap = 1; u.bonus = 2;
  const hp0 = c.totalHp(foe);
  c.runSkill("feat_t_jab");
  assert.equal(u.bonus, 1, "扣 1 附赠");
  assert.equal(u.ap, 1, "不扣行动点");
  assert.ok(c.totalHp(foe) < hp0 || foe.dead || /刺拳/.test(JSON.stringify(S.logPages.slice(-1))));
  assert.equal(c.skillRequirementError(u, "feat_t_jab"), "本场次数已用完");
  c.runSkill("feat_t_jab");
  assert.equal(u.bonus, 1, "用完了不再扣");
  // 没有这项专长的人不能用
  const helu = c.findKit("helu", S.units);
  assert.ok(!c.skillList(helu).some(s => s.id === "feat_t_jab"));
});

test("探索专长：检定失败可以重掷，名字写进记录", () => {
  const { c, run, R } = fresh(["kolt", "helu"], "FT5");
  addSamples(c);
  R.acceptTask(run, "main");
  run.task.nodes[run.task.index] = { type: "check", done: false, check: { prof: "历史", diff: "easy", injure: false, reward: 600 } };
  const before = R.checkOdds(run, "kolt");
  run.party[0].feats = ["t_lucky"];
  const after = R.checkOdds(run, "kolt");
  assert.ok(after.reroll && after.rerollName === "好运");
  assert.ok(after.chance > before.chance);
  R.attemptCheck(run, "kolt");
  const rolls = run.lastCheck.rolls;
  if (!rolls[0].ok) assert.match(rolls[1].label, /好运重掷/);
});

test("升级表改过：旧存档按旧表（9 / 13 / 16 / 19）拿的专长不够时，按新表（7 / 11 / 13 / 16）补成待选", () => {
  const { c, run, R } = fresh(["kolt", "helu"], "FT6");
  const h = run.party[0];
  h.level = 14; h.feats = ["wanderer"]; h.pending = []; h.notes = {};   // 旧表 14 级只有 9、13 级两项，这里只记了一项
  const owed = R.pendingChoices(run).filter(p => p.kit === h.kit && p.choice.type === "feat").length;
  assert.equal(owed, 2, "新表 14 级该有 3 项（7 / 11 / 13），已有 1 项，补 2 项");
  assert.equal(R.pendingChoices(run).filter(p => p.kit === h.kit && p.choice.type === "feat").length, 2, "再看一次不会重复补");
});
