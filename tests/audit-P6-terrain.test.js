// 审计跟进 P6（地形、间隔、配置物、移动）：每条修复至少一个回归测试，说明见 README「规则改动记录」
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");

function setup(party, enemies, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: party || ["kolt", "helu"], enemies: enemies || [{ id: "thug_knife", lv: 1, zone: 2 }], seed: opt.seed || "P6" });
  const S = c.S.state;
  if (opt.pre) opt.pre(c, S);
  c.startCombat();
  if (opt.zoneMode) S.zoneMode = opt.zoneMode;
  return { c, S };
}
const kit = (S, k) => S.units.find(u => u.kit === k);
const foeOf = (S) => S.units.find(u => !u.isPlayer);
const logText = (S) => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
const VOID = () => ({ type: "void", hp: 0, maxHp: 0, open: false });
const beef = (u, hp) => u.layers.forEach(l => { l.current = l.max = hp || 300; });

/* ---------- 1 空隙：1 行动点 + 简单运动检定 ---------- */
test("空隙：有运动熟练的玩家花 1 行动点（不花附赠）越过，简单检定默认通过；日志写实际消耗", () => {
  const { c, S } = setup();
  const kolt = kit(S, "kolt"); kolt.zone = 1; kolt.ap = 1; kolt.bonus = 1;
  S.gaps["1-2"] = VOID();
  S.attackerId = kolt.id;
  c.doMove(kolt, 2);
  assert.equal(kolt.zone, 2);
  assert.equal(kolt.ap, 0, "花 1 行动点");
  assert.equal(kolt.bonus, 1, "不花附赠");
  const log = logText(S);
  assert.match(log, /消耗 1 行动点/);
  assert.match(log, /越过空隙：简单「运动」检定（一级熟练，成功率 100%），成功/);
  assert.doesNotMatch(log, /允许强行通过/, "不再提示勾一个不存在的选项");
});

test("空隙：没熟练按 50% 掷，失败过不去、行动点照扣；没行动点、技能内移动都过不去", () => {
  const { c, S } = setup(["helu", "kolt"]);
  const helu = kit(S, "helu"); helu.zone = 1; helu.ap = 1; helu.bonus = 1;
  S.gaps["1-2"] = VOID();
  assert.equal(c.voidCrossOdds(helu).chance, 0.5);
  c.Math.random = () => 0.9;   // 检定失败
  S.attackerId = helu.id;
  c.doMove(helu, 2);
  assert.equal(helu.zone, 1, "失败：没过去");
  assert.equal(helu.ap, 0, "行动点照扣");
  assert.equal(helu.bonus, 1);
  assert.match(logText(S), /失败：没能过去，行动点照扣/);
  c.doMove(helu, 2);
  assert.equal(helu.zone, 1, "没有行动点不能越过");
  assert.equal(helu.bonus, 1);
  helu.ap = 1;
  c.doMove(helu, 2, { free: true });
  assert.equal(helu.zone, 1, "技能内移动不花行动点，过不了空隙");
  assert.equal(helu.ap, 1);
  c.Math.random = () => 0.1;   // 检定成功
  c.doMove(helu, 2);
  assert.equal(helu.zone, 2);
});

test("空隙：敌人没有熟练按 50%；人类失败后重掷 75%；飞行单位直接过，不掷检定", () => {
  const { c, S } = setup(["ruby", "kolt"], [{ id: "thug_knife", lv: 1, zone: 2 }, { id: "buoy", lv: 1, zone: 2 }]);
  assert.equal(c.voidCrossOdds(foeOf(S)).chance, 0.5);
  assert.equal(c.voidCrossOdds(kit(S, "ruby")).chance, 0.75);
  S.gaps["1-2"] = VOID();
  S.combatPhase = "enemy";
  const buoy = kit(S, "buoy"); buoy.zone = 2; buoy.ap = 2; buoy.bonus = 1;
  S.attackerId = buoy.id;
  c.Math.random = () => 0.99;   // 要是掷了检定就会失败
  c.doMove(buoy, 1);
  assert.equal(buoy.zone, 1);
  assert.equal(buoy.ap, 1, "杂兵照常 1 行动点移动");
  assert.doesNotMatch(logText(S), /越过空隙/);
});

test("空隙：计算器勾「允许强行通过」= 主持人判定检定成功，照样扣 1 行动点（以前只扣附赠）", () => {
  const { c, S } = setup(["helu", "kolt"]);
  const helu = kit(S, "helu"); helu.zone = 1; helu.ap = 1; helu.bonus = 1;
  S.gaps["1-2"] = VOID();
  S.forceVoid["1-2"] = true;
  c.Math.random = () => 0.99;   // 不掷骰：这个值会让 50% 检定失败
  S.attackerId = helu.id;
  c.doMove(helu, 2);
  assert.equal(helu.zone, 2);
  assert.equal(helu.ap, 0);
  assert.equal(helu.bonus, 1);
  assert.match(logText(S), /主持人判定运动检定成功/);
});

test("空隙：敌人 AI 目标在空隙那边时去越过；玩家原地不动也会被打到（以前双方近战永远碰不到）", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "thug_hammer", lv: 2, zone: 2 }]);
  kit(S, "kolt").zone = 1; kit(S, "helu").zone = 1;
  S.gaps["1-2"] = VOID();
  const thug = foeOf(S);
  S.combatPhase = "enemy"; c.refreshEnemyEconomy(thug, []);
  const plan = c.EnemyAI.plan(thug);
  assert.match(plan.meta.skillName, /移动到 1 区/);
  c.Math.random = () => 0.1;
  plan.thunk();
  assert.equal(thug.zone, 1, "越过空隙");
  assert.equal(thug.ap, 0);
  // 整场：玩家一直不动，敌人隔着空隙也会过来
  const c2 = H.load();
  c2.BattleSim.setup({ party: ["kolt", "tou"], enemies: [{ id: "thug_hammer", lv: 1, zone: 2 }, { id: "thug_knife", lv: 1, zone: 2 }], seed: "P6-STALL" });
  const S2 = c2.S.state;
  S2.gaps["1-2"] = VOID();
  const r = c2.BattleSim.run({ maxRounds: 15, policy: { act: () => null } });
  assert.notEqual(r.winner, "timeout");
  assert.ok(S2.units.some(u => !u.isPlayer && Number(u.zone) === 1), "敌人越过了空隙");
});

test("空隙：两区制桥塌成空隙后，近战双方照样打得完（以前 41 回合超时）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "tou"], enemies: [{ id: "thug_hammer", lv: 1, zone: 2 }], seed: "P6-BRIDGE" });
  const S = c.S.state;
  S.gaps["1-2"] = { type: "bridge", hp: 1, maxHp: 10, open: true };
  const r = c.BattleSim.run({ maxRounds: 40 });
  assert.equal(S.gaps["1-2"].type, "void", "桥塌了");
  assert.notEqual(r.winner, "timeout");
});

test("空隙：远程敌人太近要后撤时，不花行动点越过空隙后撤，原地打", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "guard_gun", lv: 1, zone: 1 }]);
  kit(S, "kolt").zone = 1; kit(S, "helu").zone = 1;
  const g = foeOf(S); g.zone = 1;
  S.gaps["1-2"] = VOID();
  S.combatPhase = "enemy"; c.refreshEnemyEconomy(g, []);
  const plan = c.EnemyAI.plan(g);
  assert.doesNotMatch(plan.meta.skillName, /移动/);
});

test("空隙：热座 / 联机校验也放行有行动点的越过，没有行动点时拒绝", () => {
  const { Hotseat } = require("../hotseat");
  const src = new vm.Script(fs.readFileSync(path.join(H.ROOT, "hotseat-validation.js"), "utf8"));
  const c = H.load(); src.runInContext(c);
  const s = c.S.state; c.loadLiveParty(["ruby", "hiaki"]);
  const a = s.units.find(u => u.kit === "ruby"), b = s.units.find(u => u.kit === "hiaki");
  const enemy = c.enemyPresets().find(x => x.id === "thug_knife").build(1, 2);
  enemy.zone = 2; s.units.push(enemy); s.zoneMode = 3;
  c.startCombat(); a.ap = 1; a.bonus = 1; b.ap = 1; b.bonus = 1;
  const session = Hotseat.create({ operators: ["a", "b"], gmId: "a", getUnits: () => s.units,
    canStand: u => !c.standUpBlocked(u), assignments: { [a.id]: "a", [b.id]: "b" } });
  session.beginRound(1); session.pick("a", a.id, 0); session.pick("b", b.id, 1); session.forceStart("a");
  const validate = (cmd) => c.HotseatValidation.validateBattle(cmd, { session, sender: "a" });
  s.gaps["1-2"] = VOID();
  assert.equal(validate({ type: "move", actor: a.id, dest: 2 }), true);
  a.ap = 0;
  assert.throws(() => validate({ type: "move", actor: a.id, dest: 2 }), /空隙/);
});

test("空隙：主持人手动操控的敌人也能越过，花 1 行动点、不花附赠", () => {
  const src = new vm.Script(fs.readFileSync(path.join(H.ROOT, "gm-commands.js"), "utf8"), { filename: "gm-commands.js" });
  const c = H.load(); src.runInContext(c);
  c.BattleSim.setup({ party: ["ruby", "helu"], enemies: [{ id: "bandit_boss", lv: 3, zone: 2 }], seed: "P6-GM" });
  const authority = Object.freeze({});
  c.GMCommands.configure({ requireHost: ctx => ctx === authority });
  const send = cmd => c.Commands.dispatch(JSON.parse(JSON.stringify(cmd)), authority);
  const S = c.S.state, boss = foeOf(S);
  c.startCombat(); c.endPlayerTurn(); c.GMCommands.beginEnemyRound(S.turnNo);
  send({ type: "gm.setManual", actors: "all", enabled: true });
  send({ type: "gm.editGap", key: "1-2", patch: { type: "void" } });
  const ap = boss.ap, bonus = boss.bonus;
  assert.ok(ap >= 1);
  send({ type: "gm.enemyAct", actor: boss.id, action: "move", dest: 1 });
  assert.equal(boss.ap, ap - 1, "花 1 行动点");
  assert.equal(boss.bonus, bonus, "不花附赠");
});

/* ---------- 2 强制位移过间隔 ---------- */
function roar(gap, pre) {
  const { c, S } = setup(["tou", "helu"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const tou = kit(S, "tou"); tou.zone = 1;
  const mochi = c.spawnWeapon(tou, "mochi"); mochi.zone = 1; mochi.ap = 2; mochi.bonus = 2;
  const thug = foeOf(S); thug.zone = 1; beef(thug);
  S.gaps["1-2"] = gap;
  if (pre) pre(c, S, thug);
  const h0 = c.totalHp(thug);
  S.attackerId = mochi.id; S.targetId = thug.id;
  c.Math.random = () => 0.5;
  c.runSkill("mochi_roar");
  if (S.blockQueue && S.blockQueue.length) c.finishBlock(null);
  return { c, S, thug, h0 };
}

test("强制位移：危墙、关着的门挡住时推不过去", () => {
  assert.equal(roar({ type: "door", hp: 0, maxHp: 0, open: false }).thug.zone, 1, "关着的门");
  assert.equal(roar({ type: "wall", hp: 10, maxHp: 10, open: false }).thug.zone, 1, "危墙");
  assert.equal(roar({ type: "door", hp: 0, maxHp: 0, open: true }).thug.zone, 2, "开着的门照常推过去");
});

test("强制位移：推进空隙的地面单位坠落（失去 10% 最大生命），移动不生效；配置物掉下去；飞行单位照过", () => {
  const { c, S, thug, h0 } = roar(VOID());
  assert.equal(thug.zone, 1);
  assert.ok(h0 - c.totalHp(thug) >= 30, "吼叫本身的伤害 + 坠落 30（最大生命 300 的 10%）");
  assert.match(logText(S), /坠落，失去最大生命 10%（30）/);
  const notes = [];
  const boom = c.makeProp("boom", 1, 1); S.props = [boom];
  assert.equal(c.displaceTo(boom, 2, notes, "被吼走"), false);
  assert.ok(!S.props.includes(boom), "爆炸桶掉进空隙");
  const buoy = c.enemyPresets().find(x => x.id === "buoy").build(1, 2); buoy.zone = 1; S.units.push(buoy);
  assert.equal(c.displaceTo(buoy, 2, [], "被吼走"), true);
  assert.equal(buoy.zone, 2);
});

test("强制位移：过不稳桥梁 −1d6；拉过两座桥各扣一次；桥塌了就坠落、移动不生效", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 2 }], { zoneMode: 3 });
  const foe = foeOf(S); foe.zone = 3; beef(foe);
  S.gaps["1-2"] = { type: "bridge", hp: 30, maxHp: 30, open: true };
  S.gaps["2-3"] = { type: "bridge", hp: 30, maxHp: 30, open: true };
  c.Math.random = () => 0.5;   // 1d6 → 4
  assert.equal(c.displaceTo(foe, 1, [], "被拉拽"), true);
  assert.equal(foe.zone, 1);
  assert.equal(S.gaps["1-2"].hp, 26);
  assert.equal(S.gaps["2-3"].hp, 26);
  S.gaps["1-2"].hp = 1;
  const h0 = c.totalHp(foe);
  assert.equal(c.displaceTo(foe, 2, [], "被推开"), false);
  assert.equal(foe.zone, 1);
  assert.equal(S.gaps["1-2"].type, "void");
  assert.equal(h0 - c.totalHp(foe), 30);
  // 隔着危墙拉不过来
  S.gaps["2-3"] = { type: "wall", hp: 5, maxHp: 5, open: false };
  foe.zone = 3;
  S.gaps["1-2"] = c.emptyGap();
  assert.equal(c.displaceTo(foe, 1, [], "被拉拽"), false);
  assert.equal(foe.zone, 3);
});

test("全速撞击开过不稳桥梁也扣桥的耐久", () => {
  const { c, S } = setup(["xia", "helu"]);
  const xia = kit(S, "xia"); xia.zone = 1; xia.ap = 2; xia.bonus = 2; xia.resources.engine = true;
  const thug = foeOf(S); thug.zone = 2; beef(thug);
  S.gaps["1-2"] = { type: "bridge", hp: 12, maxHp: 12, open: true };
  c.Math.random = () => 0.5;
  S.attackerId = xia.id;
  S.skillFlow = { id: "xia_ram", actorId: xia.id, picks: { dest: 2, target: thug.id }, index: 99 };
  try { c.runSkill("xia_ram"); } finally { S.skillFlow = null; }
  if (S.blockQueue && S.blockQueue.length) c.finishBlock(null);
  assert.equal(xia.zone, 2);
  assert.equal(S.gaps["1-2"].hp, 8);
});

/* ---------- 3 危墙 / 关门阻挡 ---------- */
test("危墙：冲击炸弹、电手榴弹隔墙无效，道具不用掉，对面的按钮、爆炸桶都不受影响", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "thug_hammer", lv: 1, zone: 2 }], { zoneMode: 3 });
  const kolt = kit(S, "kolt"); kolt.zone = 1;
  const thug = foeOf(S); thug.zone = 2; thug.def = thug.defMax = 10; beef(thug);
  S.gaps["1-2"] = { type: "wall", hp: 10, maxHp: 10, open: false };
  S.gaps["2-3"] = { type: "door", hp: 0, maxHp: 0, open: false };
  const btn = c.makeProp("button", 2, 1); btn.link = "2-3";
  const boom = c.makeProp("boom", 2, 1);
  S.props = [btn, boom];
  c.bagAdd("shockbomb", 1); c.bagAdd("bomb_e", 1);
  const n1 = c.useItemOn(kolt, "shockbomb", null, 2);
  assert.equal(thug.def, 10, "隔墙没有 2 击破");
  assert.equal(c.bagCount("shockbomb"), 1, "没用掉");
  assert.match(n1.join(""), /危墙/);
  const h0 = c.totalHp(thug);
  c.useItemOn(kolt, "bomb_e", null, 2);
  assert.equal(c.totalHp(thug), h0);
  assert.equal(S.gaps["2-3"].open, false, "对面的按钮没被触发");
  assert.equal(boom.hp, 3, "对面的爆炸桶没挨打");
  assert.equal(c.bagCount("bomb_e"), 1);
  // 墙这边照常能用
  S.gaps["1-2"] = c.emptyGap();
  c.useItemOn(kolt, "shockbomb", null, 2);
  assert.equal(thug.def, 8);
});

test("危墙：范围攻击波及配置物（flushAoePulse）不越过危墙 / 关着的门", () => {
  const { c, S } = setup(["kolt", "helu"]);
  const kolt = kit(S, "kolt"); kolt.zone = 1;
  S.gaps["1-2"] = { type: "door", hp: 0, maxHp: 0, open: false };
  const btn = c.makeProp("button", 2, 1); btn.link = "1-2";
  const boom = c.makeProp("boom", 2, 1);
  S.props = [btn, boom];
  S.aoePulse = {};
  c.markAoeZone(2, { element: "fire", dmg: 10, attacker: kolt });   // 从 1 区打过来
  c.flushAoePulse();
  assert.equal(boom.hp, 3);
  assert.equal(btn.held, undefined, "按钮没被触发");
  assert.equal(S.gaps["1-2"].open, false);
  // 同区打过来的照常结算
  c.markAoeZone(2, { element: "fire", dmg: 10, attacker: kolt, from: 2 });
  c.flushAoePulse();
  assert.ok(!S.props.includes(boom), "同区的范围攻击照样点爆");
});

test("危墙：隔墙的配置物不在可打目标里、直接打也打不到（不花行动点）；墙本身从这一侧照样能打", () => {
  const { c, S } = setup(["ruby", "helu"], [{ id: "thug_hammer", lv: 1, zone: 2 }]);
  const ruby = kit(S, "ruby"); ruby.zone = 1;
  S.gaps["1-2"] = { type: "wall", hp: 10, maxHp: 10, open: false };
  const acid = c.makeProp("acid", 2, 1); S.props = [acid];
  const ids = c.structureTargets(ruby, 1, 1).map(x => x.id);
  assert.ok(!ids.includes("prop:" + acid.id), "隔墙的酸液桶不在名单里");
  assert.ok(ids.includes("gap:1-2"), "远程照样能打这堵墙");
  assert.ok(c.structureTargets(ruby, 0, 0).some(x => x.id === "gap:1-2"), "近战也能打");
  ruby.ap = 3;
  S.attackerId = ruby.id; S.targetId = "prop:" + acid.id;
  c.runSkill("ruby_aa");
  assert.equal(acid.hp, 3);
  assert.equal(ruby.ap, 3, "不花行动点");
  // 三区制：1-2 之间有墙时，2-3 之间的危墙也打不到
  S.zoneMode = 3;
  S.gaps["2-3"] = { type: "wall", hp: 10, maxHp: 10, open: false };
  assert.ok(!c.structureTargets(ruby, 0, 1).some(x => x.id === "gap:2-3"));
  S.gaps["1-2"] = c.emptyGap();
  assert.ok(c.structureTargets(ruby, 0, 1).some(x => x.id === "gap:2-3"));
});

test("危墙：碎渣机炮的目标不含隔墙的、躲藏的、倒地没起身的；隔墙开火不扣行动点和耐久；狂徒不白用", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "thug_hammer", lv: 1, zone: 2 }]);
  const kolt = kit(S, "kolt"), helu = kit(S, "helu"); kolt.zone = 1; kolt.ap = 2; helu.zone = 1;
  const thug = foeOf(S); thug.zone = 2; beef(thug);
  S.gaps["1-2"] = { type: "wall", hp: 10, maxHp: 10, open: false };
  const p = c.makeProp("scrap", 1, 1); S.props = [p];
  assert.equal(c.scrapTargets(p, kolt).length, 0);
  S.attackerId = kolt.id; S.targetId = thug.id;
  c.runSkill("use_scrap:" + p.id);
  assert.equal(kolt.ap, 2);
  assert.equal(p.hp, 5);
  assert.ok(c.scrapReady(p));
  // 狂徒在墙这边、玩家都在对面：去打墙，不去操控机炮
  thug.zone = 1; kolt.zone = 2; helu.zone = 2; thug.ap = 1;
  S.combatPhase = "enemy";
  const plan = c.EnemyAI.plan(thug);
  assert.doesNotMatch(plan.meta.skillName, /碎渣机炮/);
  // 没有墙：躲藏的、倒地没起身的不算
  S.gaps["1-2"] = c.emptyGap();
  kolt.statuses.hide = true;
  helu.dying = true; helu.layers.forEach(l => { l.current = 0; });
  assert.equal(c.scrapTargets(p, thug).length, 0);
  kolt.statuses.hide = false;
  assert.equal(c.scrapTargets(p, thug).map(u => u.id).join(","), kolt.id);
});

/* ---------- 4 防卫自律炮台 ---------- */
test("炮台：不打濒死倒地、躲藏的单位，改打下一个 atk 最高的", () => {
  const { c, S } = setup();
  const kolt = kit(S, "kolt"), helu = kit(S, "helu"); kolt.zone = 1; helu.zone = 1;
  const tur = c.makeProp("turret", 2, 3); tur.faction = "enemy"; S.props = [tur];
  kolt.atk = 999;
  kolt.layers.forEach(l => { l.current = 0; }); kolt.dying = true;
  let notes = [];
  c.turretShot(tur, true, notes);
  assert.equal(kolt.statuses.high, false);
  assert.equal(helu.statuses.high, true);
  assert.match(notes.join(""), /Helumica/);
  kolt.dying = false; kolt.layers.forEach(l => { l.current = l.max; });
  kolt.statuses.hide = true; helu.statuses.high = false;
  notes = [];
  c.turretShot(tur, true, notes);
  assert.equal(kolt.statuses.high, false, "躲藏的不打");
  assert.equal(helu.statuses.high, true);
});

test("炮台：被屏障整个挡下、伤害为 0 都不挂高能", () => {
  const { c, S } = setup();
  const kolt = kit(S, "kolt"), helu = kit(S, "helu"); kolt.zone = 1; helu.zone = 1;
  const tur = c.makeProp("turret", 2, 3); tur.faction = "enemy";
  const dome = c.makeProp("dome", 1, 1); dome.hp = dome.maxHp = 50;
  S.props = [tur, dome];
  const k0 = c.totalHp(kolt);
  const notes = [];
  c.turretShot(tur, true, notes);
  assert.equal(c.totalHp(kolt), k0);
  assert.ok(dome.hp < 50, "罩挨了这一炮");
  assert.equal(kolt.statuses.high, false);
  assert.equal(helu.statuses.high, false);
  assert.match(notes.join(""), /被屏障挡下，不施加高能/);
  S.props = [tur];
  kolt.resources = kolt.resources || {}; kolt.resources.frostShell = true;   // 再次霜结：完全免伤
  helu.atk = 0; kolt.atk = 999;
  c.turretShot(tur, true, []);
  assert.equal(kolt.statuses.high, false, "0 伤害不挂高能");
});

test("炮台：上一次行动留下的「已拦截本次行动」记录不会让回合结束的炮台这一炮被白挡", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const kolt = kit(S, "kolt"), helu = kit(S, "helu"); kolt.zone = 1; helu.zone = 1;
  const thug = foeOf(S); thug.zone = 1;
  const dome = c.makeProp("dome", 1, 1); dome.hp = dome.maxHp = 60;
  const tur = c.makeProp("turret", 2, 3); tur.faction = "enemy";
  S.props = [dome, tur];
  c.endPlayerTurn();
  thug.ap = 1; S.attackerId = thug.id; S.targetId = kolt.id;
  c.runSkill("en_thug_knife");
  if (S.blockQueue && S.blockQueue.length) c.finishBlock(null);
  const afterThug = dome.hp;
  assert.ok(afterThug < 60, "狂徒这一下打在罩上");
  c.endEnemyTurn();
  assert.ok(dome.hp < afterThug, "回合结束炮台那一炮也打在罩上，不是被白挡");
  assert.doesNotMatch(logText(S).split("回合结束").pop(), /已拦截本次行动/);
});

/* ---------- 5 桥塌坠落到 0 ---------- */
test("桥塌坠落把血打到 0：玩家角色进濒死，敌人死亡", () => {
  const { c, S } = setup();
  const helu = kit(S, "helu"); helu.zone = 1; helu.bonus = 1; helu.ap = 1;
  S.gaps["1-2"] = { type: "bridge", hp: 1, maxHp: 10, open: true };
  helu.layers.forEach(l => { l.current = 0; });
  helu.layers[helu.layers.length - 1].current = 1;
  S.attackerId = helu.id;
  c.doMove(helu, 2);
  assert.equal(helu.zone, 1);
  assert.equal(S.gaps["1-2"].type, "void");
  assert.equal(helu.dying, true);
  // 敌人
  const foe = foeOf(S); foe.zone = 2;
  foe.layers.forEach(l => { l.current = 0; }); foe.layers[foe.layers.length - 1].current = 1;
  S.gaps["1-2"] = { type: "bridge", hp: 1, maxHp: 10, open: true };
  c.displaceTo(foe, 1, [], "被拉拽");
  assert.equal(foe.dead, true);
  assert.equal(foe.zone, 2);
});

/* ---------- 6 碎渣机炮每发 2 击破（作者定） ---------- */
test("碎渣机炮：1d4 次伤害，每发 2 击破（作者定）", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "thug_hammer", lv: 1, zone: 2 }]);
  const kolt = kit(S, "kolt"); kolt.zone = 1; kolt.ap = 2;
  const thug = foeOf(S); thug.zone = 2; beef(thug); thug.def = thug.defMax = 20;
  const p = c.makeProp("scrap", 1, 1); S.props = [p];
  c.Math.random = () => 0.99;   // 1d4 → 4 次
  S.attackerId = kolt.id; S.targetId = thug.id;
  const h0 = c.totalHp(thug);
  c.runSkill("use_scrap:" + p.id);
  assert.equal(h0 - c.totalHp(thug), 28, "4 次 × 7");
  assert.equal(thug.def, 12, "4 发 × 2 击破");
  assert.match(logText(S), /1d4 次 → 4 次，每次 7 物理 \+2 击破/);
});

/* ---------- 7 召唤的机械单位拿电池护盾 ---------- */
test("战斗中召唤的机械类同阵营单位也拿到超充能电池的护盾", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "guard_sword", lv: 2, zone: 2 }]);
  const bat = c.makeProp("battery", 2, 2); bat.faction = "enemy"; S.props = [bat];
  c.syncBatteryShields();
  const preset = c.enemyPresets().find(x => x.id === "guard_gun");
  const u = preset.build(2, S.partySize); u.zone = 2; S.units.push(u);
  // 一次行动结算完就补上
  const kolt = kit(S, "kolt"); kolt.zone = 1; kolt.ap = 1;
  S.attackerId = kolt.id; S.targetId = null;
  c.runSkill(c.skillList(kolt).find(s => s.name === "普通攻击").id);
  const shield = u.layers.find(l => l.batteryShield);
  assert.ok(shield, "召唤出来的看守有电池护盾");
  assert.equal(shield.max, 5 + 2 * 2);
  assert.equal(u.layers[0], shield, "在最外层");
  // 回合结束时也会补（没有行动的情况）
  const u2 = preset.build(2, S.partySize); u2.zone = 2; S.units.push(u2);
  c.endPlayerTurn(); c.endEnemyTurn();
  assert.ok(u2.layers.some(l => l.batteryShield));
  assert.equal(c.findKit("guard_sword", S.units).layers.filter(l => l.batteryShield).length, 1, "原有的不重复加");
});

/* ---------- 9 紧追跟进冻土 ---------- */
test("紧追跟进冻土也受「进入冻土 1 冰击破」；被推进冻土同样", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const kolt = kit(S, "kolt"); kolt.zone = 1;
  const foe = foeOf(S); foe.zone = 1;
  foe.statuses.chase = true; foe.chasers = [kolt.id];
  S.fields[2].ice = true;
  const k0 = kolt.def, f0 = foe.def;
  const notes = [];
  c.displaceTo(foe, 2, notes, "被推开");
  assert.equal(kolt.zone, 2);
  assert.equal(kolt.def, k0 - 1, "紧追跟进冻土");
  assert.equal(foe.def, f0 - 1, "被推进冻土");
  assert.match(notes.join("\n"), /柯尔特 进入冻土：冰击破 1/);
});

/* ---------- 10 深渊上空被击落 ---------- */
test("飞行单位在深渊上空被击落：共失去 30% 最大生命（击落 20% + 坠落 10%），并离开深渊", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "buoy", lv: 3, zone: 2 }]);
  S.fields[2].abyss = true;
  const b = kit(S, "buoy"); b.zone = 2;
  b.layers.forEach(l => { l.current = l.max = 100; });
  const max = c.totalMaxHp(b);
  b.def = 1;
  const kolt = kit(S, "kolt"); kolt.zone = 1;
  c.dealTo(kolt, b, { atk: 0, mult: 0, flat: 0, element: "physical", baseBreak: 3, atkRange: "any",
    flags: { action: true, blockResolved: true, block: "none", environment: true } });
  assert.equal(b.flying, false);
  assert.equal(max - c.totalHp(b), Math.floor(max * 0.2) + Math.floor(max * 0.1));
  assert.notEqual(Number(b.zone), 2, "离开深渊");
});

/* ---------- 11 电池 / 炮台的装甲倍率吃天气 ---------- */
test("电池 / 炮台是装甲生命：倍率和单位的装甲层一样吃天气（隔离区不吃）", () => {
  const { c, S } = setup();
  const kolt = kit(S, "kolt");
  const tur = c.makeProp("turret", 2, 3); tur.faction = "enemy";
  const bat = c.makeProp("battery", 1, 3);
  tur.hp = tur.maxHp = 100; bat.hp = bat.maxHp = 100;
  S.props = [tur, bat];
  S.weather = "heat";   // 酷暑：火 +25%
  let h = tur.hp;
  c.damageProp(tur, { element: "fire", dmg: 20 }, kolt);
  assert.equal(h - tur.hp, 20, "火打装甲 ×0.75，酷暑 +25% → ×1");
  S.weather = "thunder";   // 雷鸣：电 +25%
  h = bat.hp;
  c.damageProp(bat, { element: "electric", dmg: 20 }, kolt);
  assert.equal(h - bat.hp, 20);
  S.fields[1].isolate = true;   // 隔离区：不受天气影响
  h = bat.hp;
  c.damageProp(bat, { element: "electric", dmg: 20 }, kolt);
  assert.equal(h - bat.hp, 15);
});
