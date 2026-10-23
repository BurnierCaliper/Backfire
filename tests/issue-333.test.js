// #333：过载 / 导体「复数次攻击额外再打一次」：一个技能分几下打好几个目标时，每个被打了 2 次以上的目标都补一次
// （年糕音爆再耗圣盾放两次，以前只补最后一个敌人；最后一个敌人被打死了就谁都不补）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

/** 灯 + 年糕，同区三个狂徒（血厚、架势 30，打不进失衡）；年糕带过载，灯 3 圣盾 */
function setup() {
  const c = H.load();
  c.BattleSim.setup({ party: ["tou"], enemies: [1, 2, 3].map(() => ({ id: "thug_knife", lv: 1, zone: 1 })), seed: "I333" });
  c.startCombat();
  const S = c.S.state;
  const foes = S.units.filter(u => !u.isPlayer);
  foes.forEach(f => { f.zone = 1; f.layers = [{ type: "flesh", current: 500, max: 500 }]; f.def = f.defMax = 30; });
  const tou = c.findKit("tou", S.units);
  tou.zone = 1; tou.level = 11; tou.ap = 3; tou.bonus = 2;
  c.Commands.dispatch({ type: "skill", actor: tou.id, skill: "tou_summon" });
  const mochi = c.findKit("mochi", S.units);
  mochi.zone = 1; mochi.level = 11; mochi.ap = 3; mochi.bonus = 2;
  mochi.instant = Object.assign({}, mochi.instant, { overload: true });
  tou.resources.shield = 3;
  // 只数技能本身打出的段（导体「每三段额外打一个随机敌人」那一下不数）
  const segs = [];
  const deal = c.dealTo;
  c.dealTo = (a, t, o) => { if (!(o && o.flags && o.flags.conductorExtra)) segs.push(t.id); return deal(a, t, o); };
  const boom = again => c.Commands.dispatch({ type: "skill", actor: mochi.id, skill: "mochi_boom", picks: { again } });
  const segsOn = f => segs.filter(id => id === f.id).length;
  const said = re => (S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n").match(re) || []).length;
  return { c, foes, tou, mochi, boom, segsOn, said };
}

test("年糕过载，音爆再耗圣盾放两次：同区每个敌人都补一段（以前只补最后一个）", () => {
  const { foes, tou, boom, segsOn, said } = setup();
  boom("twice");
  assert.equal(tou.resources.shield, 2, "第二次音爆耗了 1 圣盾");
  foes.forEach((f, i) => {
    assert.equal(segsOn(f), 3, `第 ${i + 1} 个敌人：两次音爆 + 过载补的一段`);
    assert.equal(f.def, 27, `第 ${i + 1} 个敌人：补的也是音爆那一段（1 击破）`);
  });
  assert.equal(said(/年糕 过载：复数次攻击额外再打一次/g), 1, "过载只多打一次（这一段打到每个敌人），日志写一行");
});

test("最后一个敌人被第二次音爆打死：其他敌人照样补（以前最后一个死了谁都不补）", () => {
  // 先量一次音爆打多少（没有骰子，每次一样）
  const pilot = setup();
  pilot.boom("once");
  const dmg = 500 - pilot.c.totalHp(pilot.foes[0]);
  assert.ok(dmg > 0);
  const { c, foes, boom, segsOn } = setup();
  foes[2].layers[0].current = dmg * 2;   // 第一次打剩一半，第二次打死
  boom("twice");
  assert.ok(c.totalHp(foes[2]) <= 0, "最后一个敌人被第二次音爆打死");
  assert.equal(segsOn(foes[2]), 2, "打死的不补");
  [foes[0], foes[1]].forEach((f, i) => assert.equal(segsOn(f), 3, `第 ${i + 1} 个敌人照样补一段`));
});

test("过载和导体都有：每个敌人各补两段（过载、导体各一次）", () => {
  const { foes, mochi, boom, segsOn, said } = setup();
  mochi.self = "conductor";
  boom("twice");
  foes.forEach((f, i) => assert.equal(segsOn(f), 4, `第 ${i + 1} 个敌人：两次音爆 + 过载 + 导体`));
  assert.equal(said(/年糕 过载：复数次攻击额外再打一次/g), 1);
  assert.equal(said(/年糕 导体：复数次攻击额外再打一次/g), 1);
});

test("照旧：只放一次音爆（每个敌人只挨一段）不补", () => {
  const { foes, tou, boom, segsOn, said } = setup();
  boom("once");
  assert.equal(tou.resources.shield, 3);
  foes.forEach(f => assert.equal(segsOn(f), 1));
  assert.equal(said(/过载：复数次攻击额外再打一次/g), 0);
});

test("照旧：单个目标分两下（瑞比普攻）过载补第三下，重复最后一段，没打到的敌人不补", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }, { id: "thug_knife", lv: 1, zone: 2 }], seed: "I333R" });
  c.startCombat();
  const S = c.S.state;
  const foes = S.units.filter(u => !u.isPlayer);
  foes.forEach(f => { f.zone = 2; f.layers = [{ type: "flesh", current: 500, max: 500 }]; f.def = f.defMax = 30; });
  const ruby = c.findKit("ruby", S.units);
  ruby.zone = 1; ruby.ap = 3;
  ruby.instant = Object.assign({}, ruby.instant, { overload: true });
  const pops = [];
  c.spawnPopup = (u, spec) => { if (spec.kind === "dmg") pops.push({ id: u.id, v: spec.value }); };
  c.Commands.dispatch({ type: "skill", actor: ruby.id, skill: "ruby_aa", target: foes[0].id });
  const main = pops.filter(p => p.id === foes[0].id);
  assert.equal(main.length, 3, "两下 + 过载补的一下");
  assert.equal(main[2].v, main[1].v, "重复的是最后一段");
  assert.equal(pops.filter(p => p.id === foes[1].id).length, 0, "没打到的不补");
});
