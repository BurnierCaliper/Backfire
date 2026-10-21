// 击杀归属统一（#114）：敌人的死亡算最后一个伤害过它的玩家；持续伤害算状态所有者；高能余波算高能状态所有者
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(enemies) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], seed: "K114", zoneMode: 3, enemies });
  c.startCombat();
  const st = c.S.state;
  return { c, st, kolt: c.findKit("kolt", st.units), helu: c.findKit("helu", st.units) };
}
const kills = (c, u) => (c.battleStat(u) || {}).kills || 0;
const emptyOut = u => u.layers.forEach(l => { l.current = 0; });
const actAs = (st, u) => { st.actionAcc = { dmg: 0, brk: 0, hits: 0, calls: 0, targets: [], side: 0, sideBy: {}, actorIsPlayer: true, actorId: u.id }; };
const hit = (c, a, t, flat) => c.dealTo(a, t, { atk: 0, mult: 0, flat, element: "physical", baseBreak: 0, atkRange: "any",
  flags: { action: false, blockResolved: true, block: "none", atkFx: [] } });

test("A 打过、B 后打，敌人被 B 打死：击杀算 B", () => {
  const { c, kolt, helu } = field([{ id: "thug_knife", lv: 1, zone: 1 }]);
  const thug = c.findKit("thug_knife", c.S.state.units);
  hit(c, kolt, thug, 1);
  hit(c, helu, thug, 99999);
  c.sweepDeadEnemies();
  assert.equal(thug._xpGiven, true);
  assert.equal(kills(c, helu), 1);
  assert.equal(kills(c, kolt), 0);
});

test("A 挂的灼烧在回合结束打死敌人：算 A，即使 B 正在行动 / 没人行动", () => {
  [true, false].forEach(bActing => {
    const { c, st, kolt, helu } = field([{ id: "thug_knife", lv: 1, zone: 1 }]);
    const thug = c.findKit("thug_knife", st.units);
    actAs(st, kolt);
    c.grantBurn(thug, 3, []);
    c.popStatus(thug, "burn");   // 玩家行动中挂上：记下所有者
    st.actionAcc = null;
    hit(c, helu, thug, 1);      // B 后来也打过它
    thug.layers.forEach(l => { l.current = Math.min(l.current, 1); });
    if (bActing) actAs(st, helu);
    c.turnEnd();
    c.sweepDeadEnemies();
    assert.equal(thug._xpGiven, true, "灼烧应当打死它");
    assert.equal(kills(c, kolt), 1, `bActing=${bActing}`);
    assert.equal(kills(c, helu), 0);
  });
});

test("敌人只被 A 打过，之后掉进流沙窒息死：算 A（B 在行动也不改）", () => {
  const { c, st, kolt, helu } = field([{ id: "thug_knife", lv: 1, zone: 1 }]);
  const thug = c.findKit("thug_knife", st.units);
  hit(c, kolt, thug, 1);
  st.fields[1].quicksand = true;
  thug.zone = 1;
  emptyOut(thug);
  c.addSink(thug, 5, [], "测试");
  actAs(st, helu);
  c.tickQuicksandFor(thug, []);
  assert.equal(thug._xpGiven, true);
  assert.equal(kills(c, kolt), 1);
  assert.equal(kills(c, helu), 0);
});

test("坠入无主深渊：算之前最后打过它的玩家，不算正在行动的人", () => {
  const { c, st, kolt, helu } = field([{ id: "thug_knife", lv: 1, zone: 1 }]);
  const thug = c.findKit("thug_knife", st.units);
  hit(c, kolt, thug, 1);
  st.fields[2].abyss = true;
  thug.zone = 2;
  emptyOut(thug);
  actAs(st, helu);
  c.applyAbyssFall(thug, 1, []);
  assert.equal(kills(c, kolt), 1);
  assert.equal(kills(c, helu), 0);
});

test("A 给敌人挂高能、B 引爆，余波打死另一个敌人 C：C 算 A 的击杀", () => {
  const { c, st, kolt, helu } = field([{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }]);
  const [x, cc] = st.units.filter(u => !u.isPlayer);
  actAs(st, kolt);
  x.statuses.high = true;
  c.popStatus(x, "high");   // A 给 X 挂高能
  st.actionAcc = null;
  emptyOut(cc); cc.layers.forEach(l => { l.current = 0; });
  cc.layers[0].current = 1; cc.layers[0].max = Math.max(1, cc.layers[0].max);
  actAs(st, helu);
  x.highEnergy = 9999;
  c.explodeHigh(x, 9999);   // B 引爆
  c.sweepDeadEnemies();
  assert.equal(cc._xpGiven, true, "余波应当打死 C");
  assert.equal(kills(c, kolt), 1, "C 的击杀算挂高能的 A");
  assert.equal(kills(c, helu), 0, "引爆的 B 不算");
});

test("只被友军 / 敌人伤害过的敌人死了：不算任何玩家的击杀", () => {
  const { c, st, kolt, helu } = field([{ id: "thug_knife", lv: 1, zone: 1 }]);
  const thug = c.findKit("thug_knife", st.units);
  actAs(st, kolt);   // 碰巧有人在行动，也不能记给他
  st.fields[1].quicksand = true;
  thug.zone = 1;
  emptyOut(thug);
  c.addSink(thug, 5, [], "测试");
  c.tickQuicksandFor(thug, []);
  assert.equal(thug._xpGiven, true);
  assert.equal(kills(c, kolt), 0);
  assert.equal(kills(c, helu), 0);
});
