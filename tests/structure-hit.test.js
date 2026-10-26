// #52：玩家技能打配置物 / 危墙算命中——走技能自己的分支（属性、消耗、命中后资源），dealTo 把替身交给 hitStructureCore
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");

function field(kit, prep) {
  const c = H.load();
  vm.runInContext("Math", c).random = () => 0.5;
  c.BattleSim.setup({ party: [kit], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "SH" });
  c.startCombat();
  const S = c.S.state;
  const a = c.findKit(kit, S.units);
  a.zone = 1; a.level = 20; a.ap = 5; a.bonus = 5;
  const p = c.makeProp("battery", 1, 1);
  S.props.push(p);
  if (prep) prep(c, S, a, p);
  return { c, S, a, p };
}
function use(c, S, a, id, target, picks) {
  S.attackerId = a.id; S.targetId = target;
  S.skillFlow = picks ? { id, actorId: a.id, picks: Object.assign({ target }, picks), index: 0 } : null;
  const log = vm.runInContext("withLogSink", c)(() => c.runSkill(id));
  S.skillFlow = null;
  return log.join("\n");
}

test("意式浓缩打配置物：照扣咖啡液，按酸属性打", () => {
  const { c, S, a, p } = field("yuito", (c, S, a) => { a.resources.liquid = 3; });
  const hp0 = p.hp;
  const log = use(c, S, a, "yuito_espresso", "prop:" + p.id, { mode: "atk" });
  assert.equal(a.resources.liquid, 2, "咖啡液照扣");
  assert.ok(p.hp < hp0);
  assert.match(log, /酸属性/);
});

test("结人普攻打配置物：命中后咖啡豆照样转成咖啡液", () => {
  const { c, S, a, p } = field("yuito", (c, S, a, p) => { a.resources.bean = 2; a.resources.liquid = 0; p.zone = 2; S.gaps["1-2"] = c.emptyGap(); });
  const hp0 = p.hp;
  use(c, S, a, "yuito_aa", "prop:" + p.id);
  assert.ok(p.hp < hp0);
  assert.equal(a.resources.liquid, 1);
  assert.equal(a.resources.bean, 1);
});

test("只上状态的技能打配置物：不掉耐久，状态写不到配置物上，提示无效", () => {
  const { c, S, a, p } = field("ruby");
  const hp0 = p.hp;
  const log = use(c, S, a, "ruby_trigger", "prop:" + p.id);
  assert.equal(p.hp, hp0);
  assert.ok(!(p.statuses && p.statuses.high));
  assert.match(log, /是物体：状态和减益对它无效/);
  assert.equal(S._structProxy, null, "替身用完就清掉");
});

test("危墙：技能的击破照算（夏的普攻 2 击破）", () => {
  const { c, S, a } = field("xia", (c, S) => { S.gaps["1-2"] = { type: "wall", hp: 20, maxHp: 20, open: false }; });
  use(c, S, a, "xia_aa", "gap:1-2");
  assert.equal(S.gaps["1-2"].hp, 18);
  assert.equal(a.ap, 4, "照常花行动点，只花一次");
});

test("挂着的下一击效果打配置物也用掉（准备的骰子加进伤害）", () => {
  const { c, S, a, p } = field("xia", (c, S, a) => { a.resources.preparedActive = true; a.resources.prepared = true; a.resources.pierceNext = true; });
  use(c, S, a, "xia_aa", "prop:" + p.id);
  assert.equal(a.resources.preparedActive, false);
  assert.equal(a.resources.pierceNext, false);
});
