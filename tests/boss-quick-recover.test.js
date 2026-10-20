// 首领 / 精英「标记没攒满立刻恢复架势」（63b90d7）的两个回归：H10 打进失衡时的效果不触发、H9 飞碟触灵本体的协助攻击打不到
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("vm");
const H = require("./headless");

function field(party, enemies) {
  const c = H.load();
  c.BattleSim.setup({ party, enemies, seed: "BQR" });
  c.startCombat();
  return { c, S: c.S.state };
}
const kit = (S, k) => S.units.find(u => u.kit === k);
/** 一击必中的击破（跳过命中 / 格挡随机性） */
function hit(c, a, t, baseBreak) {
  return c.dealTo(a, t, { mult: 1, baseBreak, element: "physical", atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });
}
const logText = (S) => S.logPages.flatMap(p => p.lines).map(l => l.text || l).join("\n");

test("H10 过载爆炸：首领打出第 1 个标记（立刻恢复）时照常触发", () => {
  const { c, S } = field(["ruby", "kolt"], [{ id: "outlaw_king", lv: 1, zone: 2 }]);
  const king = kit(S, "outlaw_king"), ruby = kit(S, "ruby");
  ruby.zone = 2;
  king.instant = Object.assign({}, king.instant, { overload: true });
  king.def = 1;
  const out = hit(c, ruby, king, 1);
  assert.equal(king.stunMarks, 1);
  assert.equal(king.stunned, false, "标记没攒满：立刻恢复");
  assert.match(out.extra.join("\n"), /过载爆炸/,"打进失衡，过载爆炸照常触发");
});

test("H10 失衡分加成：首领打出第 1 个标记时，克制的加成照常记上", () => {
  const { c, S } = field(["ruby", "kolt"], [{ id: "outlaw_king", lv: 1, zone: 2 }]);
  const king = kit(S, "outlaw_king"), ruby = kit(S, "ruby");
  ruby.zone = 2;
  king.def = 1;
  // 这一击的加分倍率挂在目标上（dealTo 里 attackScoreBonus），被打进失衡时 _staggerBonus 留给 trackHealBy 记分
  const seen = [];
  const orig = c.attackScoreBonus;
  c.attackScoreBonus = () => 25;
  try {
    c.trackHealBy(ruby, () => { hit(c, ruby, king, 1); seen.push(king._staggerBonus); });
  } finally { c.attackScoreBonus = orig; }
  assert.equal(king.stunMarks, 1);
  assert.equal(seen[0], 25, "失衡分加成照常挂上");
});

test("H10 专长乘势：打进首领第 1 个标记（立刻恢复）时，同区架势为 1 的敌人各受 1 击破", () => {
  const run = (feats) => {
    const c = H.load();
    vm.runInContext("Math", c).random = () => 0.5;   // 固定随机（feat-content.test.js 同款）
    c.BattleSim.setup({ party: ["kolt", "ruby"], enemies: [{ id: "captain_wolf", lv: 10, zone: 2 }, { id: "thug_knife", lv: 3, zone: 2 }], seed: "BQR" });
    const S = c.S.state;
    const kolt = kit(S, "kolt");
    kolt.feats = feats;
    c.startCombat();
    const king = kit(S, "captain_wolf"), thug = kit(S, "thug_knife");
    kolt.zone = 2;
    king.def = 1; thug.def = 1;
    hit(c, kolt, king, 1);
    assert.equal(king.stunMarks, 1);
    assert.equal(king.stunned, false);
    return thug.def;
  };
  assert.equal(run([]), 1, "对照：没有乘势，旁边的敌人不受影响");
  assert.equal(run(["momentum"]), 0, "乘势：旁边架势 1 的敌人被打了 1 击破");
});

test("H10 猫爪挥打：首领打出第 1 个标记时照常 +2 咖啡豆", () => {
  const { c, S } = field(["yuito", "kolt"], [{ id: "outlaw_king", lv: 1, zone: 1 }]);
  const king = kit(S, "outlaw_king"), y = kit(S, "yuito");
  y.zone = 1; king.zone = 1; king.def = 1;
  y.ap = 3; y.resources.bean = 0;
  S.assistQueue = [];
  S.attackerId = y.id; S.targetId = king.id;
  c.runSkill("latte_claw");
  assert.equal(king.stunMarks, 1, "打进失衡、记一个标记");
  assert.equal(y.resources.bean, 2, "打出失衡 +2");
});

test("H9 飞碟触灵本体：打进第 1 个标记（立刻恢复）后，排队的协助攻击打得到它", () => {
  const { c, S } = field(["kolt", "helu"], [{ id: "ufo_boss", lv: 1, zone: 2 }]);
  const body = kit(S, "ufo_body"), kolt = kit(S, "kolt");
  S.assistQueue = [];
  c.dealBreak(body, 99, "physical", [], "测试", { by: kolt });
  assert.equal(body.stunMarks, 1, "记一个标记");
  assert.equal(body.stunned, false, "没攒满：立刻恢复");
  assert.ok(S.assistQueue.some(j => j.targetId === body.id), "协助攻击排上队了");
  const hpBefore = body.layers.reduce((a, l) => a + (Number(l.current) || 0), 0);
  const defBefore = body.def;
  c.finishAssist(kit(S, "helu").id);   // 本体失衡时只有 Helumica 能协助
  const hpAfter = body.layers.reduce((a, l) => a + (Number(l.current) || 0), 0);
  assert.ok(hpAfter < hpBefore || body.def < defBefore, "协助攻击打到了本体");
  assert.doesNotMatch(logText(S), /无法被通常手段攻击/);
  assert.ok(!body._bossAssistWindow, "协助结算完，窗口关上");
  // 窗口关上以后，本体照旧不可直击
  const out = c.dealTo(kolt, body, { mult: 1, baseBreak: 1, element: "physical", atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });
  assert.equal(out.res.ok, false);
});
