// 自我效果（导体等）写进状态条；多段攻击每一段各跳一个伤害数字
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

test("拉斯缪尔不稳超导：自身导体，状态条写出「导体」", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ras", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "SELF" });
  c.startCombat();
  const r = c.findKit("ras", c.S.state.units);
  r.level = 3; r.ap = 3;
  c.Commands.dispatch({ type: "skill", actor: r.id, skill: "ras_super" });
  assert.equal(r.self, "conductor");
  assert.match(c.statusLine(r), /导体/);
  r.self = "burn"; r.selfBurnStacks = 3;
  assert.match(c.statusLine(r), /自焚×3/);
});

test("多段攻击：拉斯缪尔普攻两段各跳一个数字，加起来等于这一击的伤害", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ras", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "MULTI" });
  c.startCombat();
  const S = c.S.state;
  const r = c.findKit("ras", S.units); r.zone = 1;
  const f = S.units.find(u => !u.isPlayer); f.zone = 2; f.layers = [{ type: "flesh", current: 300, max: 300 }];
  const pops = [];
  c.spawnPopup = (u, spec) => { if (spec.kind === "dmg") pops.push(spec.value); };
  c.Commands.dispatch({ type: "skill", actor: r.id, skill: "ras_aa", target: f.id });
  assert.equal(pops.length, 2);
  assert.equal(pops[0] + pops[1], 300 - f.layers[0].current);
  r.resources.unstable = true; r.ap = 3; pops.length = 0;
  c.Commands.dispatch({ type: "skill", actor: r.id, skill: "ras_aa", target: f.id });
  assert.equal(pops.length, 4, "不稳态四段");
});

test("导体：只对本来就是复数次的攻击 +1 次，重复最后一段；单次攻击不加；分几下打同一个目标也算（和过载一样）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ras", "ruby"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "COND" });
  c.startCombat();
  const S = c.S.state;
  const r = c.findKit("ras", S.units); r.zone = 1; r.self = "conductor";
  const f = S.units.find(u => !u.isPlayer); f.zone = 2; f.layers = [{ type: "flesh", current: 500, max: 500 }];
  const pops = [];
  c.spawnPopup = (u, spec) => { if (spec.kind === "dmg") pops.push(spec.value); };
  // 拉斯缪尔普攻：两次 0.5atk → 导体三次
  c.Commands.dispatch({ type: "skill", actor: r.id, skill: "ras_aa", target: f.id });
  assert.equal(pops.length, 3, "两段 +1");
  // 单次攻击（逃离那一下 1atk 电）：不加
  pops.length = 0; r.ap = 3; r.level = 3;
  f.zone = 1;
  c.Commands.dispatch({ type: "skill", actor: r.id, skill: "ras_flee", target: f.id, picks: { dest: 2, target: f.id } });
  assert.equal(pops.length, 1, "单次攻击不加次数");
  // 瑞比普攻：分两下各 1 次打同一个目标 → 结尾重复最后一段
  const ruby = c.findKit("ruby", S.units); ruby.self = "conductor"; ruby.zone = 1; ruby.ap = 3;
  f.zone = 2; pops.length = 0;
  c.Commands.dispatch({ type: "skill", actor: ruby.id, skill: "ruby_aa", target: f.id });
  assert.equal(pops.length, 3);
  assert.equal(pops[2], pops[1], "重复的是最后一段");
});

test("导体：按段计数，额外目标只吃触发的那一段，不重放整次攻击", () => {
  const c = H.load();
  c.BattleSim.setup({
    party: ["ras"],
    enemies: [{ id: "thug_knife", lv: 1, zone: 2 }, { id: "thug_knife", lv: 1, zone: 2 }],
    seed: "CONDSEG"
  });
  c.startCombat();
  const S = c.S.state;
  const r = c.findKit("ras", S.units); r.zone = 1; r.self = "conductor";
  const foes = S.units.filter(u => !u.isPlayer);
  foes.forEach(f => { f.zone = 2; f.layers = [{ type: "flesh", current: 500, max: 500 }]; });
  const pops = [];
  c.spawnPopup = (u, spec) => { if (spec.kind === "dmg") pops.push({ id: u.id, value: spec.value }); };
  c.Commands.dispatch({ type: "skill", actor: r.id, skill: "ras_aa", target: foes[0].id });
  assert.equal(r._conductorHits, 3, "两段加导体那一段，共记 3 段");
  const extra = pops.filter(p => p.id === foes[1].id);
  assert.equal(extra.length, 1, "额外目标只吃一段");
  const main = pops.filter(p => p.id === foes[0].id);
  assert.equal(main.length, 3, "主目标仍是三段");
  assert.equal(extra[0].value, main[2].value, "额外的是触发的那一段，不是整次攻击");
});

test("导体额外一段按新目标重新结算：不继承原目标的飞行 / 减伤，按这一段自己的倍率", () => {
  const go = (kit, skill, prep) => {
    const c = H.load();
    c.BattleSim.setup({ party: [kit], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }], seed: "CONDRE" });
    c.startCombat();
    const S = c.S.state;
    const a = c.findKit(kit, S.units); a.zone = kit === "ras" ? 2 : 1; a.self = "conductor"; a._conductorHits = 0;
    const foes = S.units.filter(u => !u.isPlayer);
    foes.forEach(f => { f.zone = 1; f.layers = [{ type: "flesh", current: 500, max: 500 }]; f.def = f.defMax = 30; });
    prep(foes[0], a);
    const pops = [];
    c.spawnPopup = (u, spec) => { if (spec.kind === "dmg") pops.push({ who: u === foes[0] ? "main" : "extra", v: spec.value }); };
    c.Commands.dispatch({ type: "skill", actor: a.id, skill, target: foes[0].id });
    return { c, a, pops };
  };
  // 原目标飞行（伤害减半）：额外目标不会飞，拿完整的一段
  const fly = go("ras", "ras_aa", (m) => { m.flying = true; });
  const main = fly.pops.filter(p => p.who === "main"), extra = fly.pops.filter(p => p.who === "extra");
  assert.equal(extra.length, 1);
  assert.equal(extra[0].v, main[0].v * 2, "不继承原目标的飞行减半");
  // 原目标咬牙坚持（减伤 50%）
  const grit = go("ras", "ras_aa", (m) => { m.resources = Object.assign({}, m.resources, { gritTurn: true }); });
  assert.equal(grit.pops.find(p => p.who === "extra").v, grit.pops.find(p => p.who === "main").v * 2, "不继承原目标的减伤");
  // 柯尔特电钻普攻 0.3 / 0.3 / 0.4：第 3 段触发，额外那一下是 0.4 那一段
  const k = go("kolt", "kolt_aa", (m, a) => { a.resources.bit = "drill"; });
  const atk = k.c.effectiveAtk(k.a, k.c.S.state.units);
  assert.equal(k.pops.find(p => p.who === "extra").v, Math.floor(atk * 0.4));
});
