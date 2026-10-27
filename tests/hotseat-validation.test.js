"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const { Hotseat } = require("../hotseat");
const source = new vm.Script(fs.readFileSync(path.join(H.ROOT, "hotseat-validation.js"), "utf8"));
function fixture(kit = "ruby", other = "hiaki") {
  const c = H.load(); source.runInContext(c);
  const s = c.S.state; c.loadLiveParty([kit, other]);
  const a = s.units.find(u => u.kit === kit), b = s.units.find(u => u.kit === other);
  const enemy = c.enemyPresets().find(x => x.id === "thug_knife").build(1, 2);
  enemy.zone = 2; s.units.push(enemy); s.zoneMode = 3;
  c.startCombat(); a.ap = 4; a.bonus = 4; b.ap = 4; b.bonus = 4;
  const session = Hotseat.create({ operators: ["a", "b"], gmId: "a", getUnits: () => s.units,
    canStand: u => !c.standUpBlocked(u), assignments: { [a.id]: "a", [b.id]: "b" } });
  session.beginRound(1); session.pick("a", a.id, 0); session.pick("b", b.id, 1); session.forceStart("a");
  const validate = (command, sender = "a", game) => c.HotseatValidation.validateBattle(command, { session, sender, game });
  const skill = (id, target = null, picks = {}) => ({ type: "skill", actor: a.id, skill: id, target, picks });
  return { c, s, a, b, enemy, session, validate, skill };
}
function untouched(f, command, pattern, sender = "a") {
  const before = JSON.stringify(f.s), refs = Object.fromEntries(Object.keys(f.s).map(k => [k, f.s[k]]));
  assert.throws(() => f.validate(command, sender), pattern);
  assert.equal(JSON.stringify(f.s), before);
  for (const [key, value] of Object.entries(refs)) assert.equal(f.s[key], value, "preserve original " + key + " reference");
}

test("未知、其他角色和反应技能不能借零费用越过权威校验", () => {
  const f = fixture();
  for (const id of ["free_hack", "mint_mecha", "ruby_unmecha", "ruby_assist", "assist_block", "fx_combust", "__stand", "__move", "__item"])
    untouched(f, f.skill(id, f.enemy.id), /技能|语义/);
});

test("所有权、当前格、选序期、敌方回合和协助等待均由真实会话约束", () => {
  const f = fixture();
  untouched(f, f.skill("ruby_aa", f.enemy.id), /不是你的/, "b");
  untouched(f, { type: "move", actor: f.b.id, dest: 2 }, /轮到/, "b");
  f.session.openAsk({ kind: "assist", candidates: [f.b.id] });
  untouched(f, f.skill("ruby_aa", f.enemy.id), /等待/);
  f.session.answer("b", f.session.snapshot().ask.id, { unitId: null });
  f.session.finishUnit("a"); f.session.finishUnit("b");
  untouched(f, f.skill("ruby_aa", f.enemy.id), /不能操作/);
  f.session.beginRound(2);
  untouched(f, f.skill("ruby_aa", f.enemy.id), /行动顺序/);
});

test("普攻必须选择在场、正确阵营且射程内的目标，失败不改状态引用", () => {
  const f = fixture();
  for (const target of [null, "missing", f.b.id, f.a.id]) untouched(f, f.skill("ruby_aa", target), /目标/);
  f.enemy.zone = 3; untouched(f, f.skill("ruby_aa", f.enemy.id), /射程/);
  f.enemy.zone = 2; f.enemy.dead = true; untouched(f, f.skill("ruby_aa", f.enemy.id), /目标/);
  f.enemy.dead = false;
  const before = JSON.stringify(f.s); assert.equal(f.validate(f.skill("ruby_aa", f.enemy.id)), true); assert.equal(JSON.stringify(f.s), before);
  f.c.Commands.dispatch(f.skill("ruby_aa", f.enemy.id)); assert.equal(f.a.ap, 3);
});

test("技能分步只接受此刻真正提供的选项，不能夹带额外字段或另一目标", () => {
  const f = fixture();
  untouched(f, f.skill("ruby_trigger", f.enemy.id), /分步/);
  untouched(f, f.skill("ruby_trigger", f.enemy.id, { target: f.b.id }), /分步/);
  untouched(f, f.skill("ruby_trigger", f.b.id, { target: f.enemy.id }), /不一致/);
  untouched(f, f.skill("ruby_trigger", f.enemy.id, { target: f.enemy.id, free: true }), /未提供/);
  assert.equal(f.validate(f.skill("ruby_trigger", f.enemy.id, { target: f.enemy.id })), true);
});

test("动态流程先确认前步再生成后步，并复用真实资源限制", () => {
  const f = fixture("yuito"); f.a.resources.liquid = 1;
  untouched(f, f.skill("yuito_amer", f.b.id, { mode: "atk", target: "missing" }), /分步/);
  untouched(f, f.skill("yuito_amer", f.b.id, { mode: "free", target: f.b.id }), /分步/);
  assert.equal(f.validate(f.skill("yuito_amer", f.b.id, { mode: "heal", target: f.b.id })), true);
  f.a.resources.liquid = 0;
  untouched(f, f.skill("yuito_amer", f.b.id, { mode: "heal", target: f.b.id }), /咖啡液/);
});

test("助威持续模式用现有 AP 费用、普通模式用 bonus；不得用伪 cost 绕过", () => {
  const f = fixture("yuito"); f.a.level = 10; f.a.ap = 0; f.a.bonus = 1;
  const stay = f.skill("yuito_inspire", f.b.id, { mode: "stay", target: f.b.id });
  stay.cost = {};
  untouched(f, stay, /行动点不足/);
  assert.equal(f.validate(f.skill("yuito_inspire", f.b.id, { mode: "turn", target: f.b.id })), true);
  f.a.ap = 1; f.a.bonus = 0;
  assert.equal(f.validate(stay), true);
  untouched(f, f.skill("yuito_inspire", f.b.id, { mode: "turn", target: f.b.id }), /附赠行动不足/);
});

test("灯普通攻击按流程圣盾扩射程，零盾不能伪造 far", () => {
  const f = fixture("tou"); f.a.resources.shield = 1;
  assert.equal(f.validate(f.skill("tou_aa", f.enemy.id, { rangeMode: "far", target: f.enemy.id })), true);
  untouched(f, f.skill("tou_aa", f.enemy.id, { rangeMode: "near", target: f.enemy.id }), /分步|射程/);
  f.a.resources.shield = 0;
  untouched(f, f.skill("tou_aa", f.enemy.id, { rangeMode: "far", target: f.enemy.id }), /分步|未提供/);
});

test("多单位流程允许最终选项为友方，不能误套普通攻击敌我判断", () => {
  const f = fixture("kolt");
  const w = f.c.spawnWeapon(f.a, "torque"); w.level = 2; w.ap = 2; w.bonus = 2; f.enemy.zone = 1;
  f.session.reconcile();   // 召唤出的武器人插在本人前面，立刻轮到它
  assert.equal(f.session.snapshot().currentUnitId, w.id);
  const command = { type: "skill", actor: w.id, skill: "torque_strip", target: f.b.id, picks: { target: f.enemy.id, mode: "ally", ally: f.b.id } };
  assert.equal(f.validate(command), true);
});

test("合法召唤只读校验不生成武器、不消费 RNG、不锁格", () => {
  const f = fixture();
  const originalRandom = f.c.Math.random;
  f.c.Math.random = () => { throw new Error("validation consumed RNG"); };
  const before = JSON.stringify(f.s), sessionBefore = JSON.stringify(f.session.snapshot());
  assert.equal(f.validate(f.skill("ruby_summon")), true);
  assert.equal(JSON.stringify(f.s), before); assert.equal(JSON.stringify(f.session.snapshot()), sessionBefore);
  f.c.Math.random = originalRandom;
});

test("无效移动不扣点：区域、障碍、霜结、禁足及酸液离开费用", () => {
  const f = fixture();
  for (const dest of [1, 0, 3, 4, 1.5, "2"]) untouched(f, { type: "move", actor: f.a.id, dest }, /区域/);
  const command = { type: "move", actor: f.a.id, dest: 2 };
  f.s.gaps["1-2"].type = "wall"; untouched(f, command, /危墙/);
  // 空隙：地面单位花 1 行动点做运动检定才能越过——没有行动点时不能走
  f.s.gaps["1-2"].type = "void"; f.a.ap = 0; untouched(f, command, /空隙/); f.a.ap = 4;
  f.s.gaps["1-2"].type = "open"; f.a.self = "frost"; untouched(f, command, /霜结/);
  f.a.self = null; f.a.noMove = true; untouched(f, command, /移动/);
  f.a.noMove = false; f.s.fields[1].acid = true; f.a.ap = 0; untouched(f, command, /酸液/);
  f.a.ap = 1; assert.equal(f.validate(command), true);
});

test("可起身者保留零费用起身，不接受站立者", () => {
  const f = fixture(); const command = { type: "standUp", actor: f.a.id };
  untouched(f, command, /起身/);
  f.a.dying = true; f.a.layers.forEach(l => l.current = 0); f.a.ap = 0; f.a.bonus = 0; f.a.stunned = true;
  assert.equal(f.validate(command), true);
  f.c.Commands.dispatch(command); assert.equal(f.a.ap, 0); assert.equal(f.a.bonus, 0); assert.equal(f.a.upOnShp, true);
});

test("武器不能起身，坚毅耗尽或力竭的倒地英雄不能行动", () => {
  const f = fixture(); const w = f.c.spawnWeapon(f.a, "mint"); w.shp = 10;
  f.session.reconcile();   // 召唤出的武器人立刻轮到它
  assert.equal(f.session.snapshot().currentUnitId, w.id);
  untouched(f, { type: "standUp", actor: w.id }, /起身/);
  for (const exhausted of [false, true]) {
    const d = fixture(); d.a.dying = true; d.a.layers.forEach(l => l.current = 0);
    if (exhausted) d.s.exhaustTier = 1; else d.a.shp = 0;
    untouched(d, { type: "standUp", actor: d.a.id }, /队伍/);
  }
});

test("不存在、缺货和非法目标的道具在副作用前拒绝，读取不规范化真实背包", () => {
  const f = fixture(); const command = { type: "useItem", actor: f.a.id, item: "medkit", target: f.b.id, dest: null };
  delete f.s.bag; f.s.kuizhi = "12";
  untouched(f, command, /道具/); assert.equal(f.s.kuizhi, "12"); assert.equal(Object.hasOwn(f.s, "bag"), false);
  f.c.bagAdd("medkit", 1); f.c.bagAdd("bomb_e", 1); f.c.bagAdd("stim", 1);
  untouched(f, { ...command, item: "free_item" }, /道具/);
  untouched(f, { ...command, target: f.enemy.id }, /友方/);
  untouched(f, { ...command, target: "missing" }, /友方/);
  untouched(f, { ...command, item: "bomb_e", target: null, dest: 4 }, /区域/);
  untouched(f, { ...command, item: "stim" }, /自己/);
  assert.equal(f.validate(command), true);
  assert.equal(f.validate({ ...command, item: "bomb_e", target: null, dest: 3 }), true);
  f.c.Commands.dispatch(command); assert.equal(f.a.bonus, 3); assert.equal(f.c.bagCount("medkit"), 0);
});

test("基础 blockReason 接口无递归且其读取副作用仅发生在副本", () => {
  const f = fixture(); let called = 0;
  const game = { baseBlockReason(actor, sk) { called++; actor.ap = 999; f.s.kuizhi = 99; assert.equal(sk.id, "ruby_aa"); return "测试规则阻止"; },
    blockReason() { throw new Error("recursive UI gate"); } };
  const before = JSON.stringify(f.s);
  assert.throws(() => f.validate(f.skill("ruby_aa", f.enemy.id), "a", game), /测试规则阻止/);
  assert.equal(called, 1); assert.equal(JSON.stringify(f.s), before);
  const units = f.s.units;
  assert.throws(() => f.validate(f.skill("ruby_aa", f.enemy.id), "a", { baseBlockReason(actor) {
    actor.ap = 200; f.s.newTransient = {}; throw new Error("helper failed");
  } }), /helper failed/);
  assert.equal(JSON.stringify(f.s), before); assert.equal(f.s.units, units);
});

test("操作装置只能用在同区真实按钮/拉杆，未知或其他配置物不能假借技能入口", () => {
  const f = fixture();
  f.s.props = [{ id: "switch", name: "按钮", kind: "button", zone: 1 }, { id: "bomb", name: "爆桶", kind: "boom", zone: 1 }];
  assert.equal(f.validate(f.skill("use_device:switch")), true);
  untouched(f, f.skill("use_device:missing"), /技能/);
  untouched(f, f.skill("use_device:bomb"), /技能/);
  f.s.props[0].zone = 2; untouched(f, f.skill("use_device:switch"), /技能/);
});

test("按钮级 reason 只做当前单位/资源 gate，不要求尚未选择的目标", () => {
  const f = fixture(); const r = f.c.HotseatValidation.reason;
  assert.equal(r(f.a, { id: "ruby_aa", cost: {} }, f.session, "a", {}), null);
  f.a.ap = 0; assert.match(r(f.a, "ruby_aa", f.session, "a", {}), /行动点/);
  assert.match(r(f.b, "hiaki_aa", f.session, "b", {}), /轮到/);
});

test("移动校验和单机 moveBaseCost 一致：导体不要附赠，酸液地面离开只要 1 行动点（#176）", () => {
  const f = fixture();
  f.a.bonus = 0; f.a.self = "conductor";
  assert.equal(f.validate({ type: "move", actor: f.a.id, dest: 2 }), true);
  f.a.self = null;
  untouched(f, { type: "move", actor: f.a.id, dest: 2 }, /附赠/);
  f.s.fields[1] = Object.assign({}, f.s.fields[1], { acid: true }); f.a.ap = 2;
  assert.equal(f.validate({ type: "move", actor: f.a.id, dest: 2 }), true);
  f.a.ap = 0; f.a.bonus = 1;
  untouched(f, { type: "move", actor: f.a.id, dest: 2 }, /行动点/);
});

test("越过空隙只要 1 行动点、不要附赠，和单机一致（#176）", () => {
  const f = fixture();
  f.s.gaps = Object.assign({}, f.s.gaps, { [f.c.gapKey(1, 2)]: { type: "void" } });
  f.a.zone = 1; f.a.bonus = 0; f.a.ap = 1;
  assert.equal(f.validate({ type: "move", actor: f.a.id, dest: 2 }), true);
  f.a.ap = 0; f.a.bonus = 1;
  untouched(f, { type: "move", actor: f.a.id, dest: 2 }, /行动点/);
});

test("深渊按目的区判断：不能走进去，站在里面可以走出来（#176）", () => {
  const f = fixture();
  f.a.zone = 1; f.s.fields[2] = Object.assign({}, f.s.fields[2], { abyss: true });
  untouched(f, { type: "move", actor: f.a.id, dest: 2 }, /深渊/);
  f.a.zone = 2; f.s.fields[1] = Object.assign({}, f.s.fields[1], { abyss: false });
  assert.equal(f.validate({ type: "move", actor: f.a.id, dest: 1 }), true);
});

test("被沙珊瑚缠住、流沙下陷 2 层以上：校验就拒绝并写出原因（#176）", () => {
  const f = fixture();
  f.a.zone = 1; f.a.entangled = { name: "沙珊瑚" };
  untouched(f, { type: "move", actor: f.a.id, dest: 2 }, /缠住了/);
  f.a.entangled = null;
  f.a.sink = 2; f.s.fields[1] = Object.assign({}, f.s.fields[1], { quicksand: true });
  assert.ok(f.c.sinkStuck(f.a), "测试没造出流沙下陷");
  untouched(f, { type: "move", actor: f.a.id, dest: 2 }, /下陷 2 层/);
});

test("#340 第 10 条：特殊棋盘上的移动按真实相邻校验，不再看区编号差 1", () => {
  const f = fixture();
  const at = (board, from) => { f.c.applyBoard(board); f.a.zone = from; };
  const ok = (board, from, dest) => { at(board, from); assert.doesNotThrow(() => f.validate({ type: "move", actor: f.a.id, dest }), board + " " + from + "→" + dest); };
  const no = (board, from, dest) => { at(board, from); untouched(f, { type: "move", actor: f.a.id, dest }, /相邻/); };
  // 四区方形：1-2、1-3、2-4、3-4 相邻；3→2 编号差 1 却是对角
  ok("square4", 3, 1);
  ok("square4", 3, 4);
  no("square4", 3, 2);
  no("square4", 1, 4);
  // 五区十字：3 在中心，5→3、3→1 相邻（编号差 2），4→5 不相邻（编号差 1）
  ok("cross5", 5, 3);
  ok("cross5", 3, 1);
  no("cross5", 4, 5);
  no("cross5", 3, 9);
});

test("#340 第 10 条：2×2 方形上直连被危墙 / 关着的机关门挡住，不能绕另一边放行（新）", () => {
  const f = fixture();
  f.c.applyBoard("square4"); f.a.zone = 3;
  const key = f.c.gapKey(1, 3);
  f.s.gaps[key] = Object.assign({}, f.s.gaps[key], { type: "wall", hp: 10 });
  untouched(f, { type: "move", actor: f.a.id, dest: 1 }, /危墙/);
  f.s.gaps[key] = Object.assign({}, f.s.gaps[key], { type: "door", open: false });
  untouched(f, { type: "move", actor: f.a.id, dest: 1 }, /机关门/);
  // 3-4 是危墙时走 4 区也一样（以前绕 3→1→2→4 放行，执行时单位不动）
  f.s.gaps[key] = Object.assign({}, f.s.gaps[key], { type: "open" });
  const k34 = f.c.gapKey(3, 4);
  f.s.gaps[k34] = Object.assign({}, f.s.gaps[k34], { type: "wall", hp: 10 });
  untouched(f, { type: "move", actor: f.a.id, dest: 4 }, /危墙/);
  // 门开着就能走
  f.s.gaps[k34] = Object.assign({}, f.s.gaps[k34], { type: "door", open: true });
  assert.doesNotThrow(() => f.validate({ type: "move", actor: f.a.id, dest: 4 }));
});
