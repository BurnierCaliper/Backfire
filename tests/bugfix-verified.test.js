// 协作者核实过的一批规则 bug 的回归测试（README「规则改动记录」里每条都有说明）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function setup(party, enemies, seed) {
  const c = H.load();
  c.BattleSim.setup({ party: party || ["xia", "chuan"], enemies: enemies || [{ id: "thug_knife", lv: 1, zone: 1 }], seed: seed || "BF" });
  c.startCombat();
  return { c, S: c.S.state };
}
const kit = (S, k) => S.units.find(u => u.kit === k);

test("夕夏 / 川川 / 诺拉按属性公式成长：加体质 / 意志 / 耐力有效，10 级起架势 +1", () => {
  const { c, S } = setup(["xia", "chuan", "nora"]);
  for (const k of ["xia", "chuan", "nora"]) {
    const u = kit(S, k);
    u.level = 20;
    c.applyLevelStats(u);
    const d = c.derivedFromAttrs(u.attrs, 20);
    assert.equal(u.layers.find(l => l.type === "flesh").max, d.hp, k + " 生命");
    assert.equal(u.shpMax, d.shp, k + " 坚毅");
    assert.equal(u.defMax, d.def, k + " 架势");
    const before = { hp: d.hp, shp: d.shp, def: d.def };
    u.attrs.con += 1; u.attrs.wil += 1; u.attrs.sta += 2;
    c.applyLevelStats(u);
    assert.ok(u.layers.find(l => l.type === "flesh").max > before.hp, k + " 体质加点有效");
    assert.ok(u.shpMax > before.shp, k + " 意志加点有效");
    assert.ok(u.defMax > before.def, k + " 耐力加点有效");
  }
  const xia = kit(S, "xia");
  xia.attrs = { str: 7, con: 6, dex: 4, wil: 9, int: 5, sta: 7 };
  xia.level = 20; c.applyLevelStats(xia);
  assert.equal(xia.shpMax, 185, "夕夏 20 级坚毅按公式是 185");
  xia.level = 9; c.applyLevelStats(xia); const d9 = xia.defMax;
  xia.level = 10; c.applyLevelStats(xia);
  assert.equal(xia.defMax, d9 + 1, "10 级架势 +1");
});

test("种族：柯尔特（兽人-狼）长休按兽人 1250ml · 3 食物；灯和川川（犬类人-犬）短休 +25%", () => {
  const { c, S } = setup(["kolt", "tou", "chuan", "hiaki"]);
  assert.equal(c.heroRace(kit(S, "kolt")), "beast");
  assert.deepEqual(plain(c.heroRestCost(kit(S, "kolt"))), { water: 1250, food: 3 });
  assert.equal(c.heroRace(kit(S, "tou")), "canine");
  assert.equal(c.shortRestBonus(kit(S, "tou")), 0.25);
  assert.equal(c.shortRestBonus(kit(S, "chuan")), 0.25);
  assert.equal(c.shortRestBonus(kit(S, "hiaki")), 0, "狐没有活力源泉");
  assert.equal(c.shortRestBonus(kit(S, "kolt")), 0);
});

const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));

test("自焚吸血只算一次；吸来的坚毅生命战后不保留", () => {
  const { c, S } = setup(["xia", "chuan"]);
  const xia = kit(S, "xia"), foe = S.units.find(u => !u.isPlayer);
  foe.layers = [{ type: "flesh", current: 999, max: 999 }];
  xia.self = "burn"; xia.selfBurnStacks = 1;
  xia.layers.forEach(l => { l.current = 1; });
  const hp0 = c.totalHp(xia);
  c.dealTo(xia, foe, { element: "fire", mult: 0, flat: 50, baseBreak: 0, atk: 0, flags: { action: true, block: "none" } });
  const dealt = 999 - c.totalHp(foe);
  assert.ok(dealt > 0);
  assert.ok(c.totalHp(xia) - hp0 <= Math.floor(dealt * 0.2), "只吸一次（不超过 20%）");
  // 起身中：吸血回坚毅生命，但存档时不超过吸血前
  xia.layers.forEach(l => { l.current = 0; });
  xia.dying = false; xia.upOnShp = true; xia.shp = 6; xia.shpMax = 60;
  c.dealTo(xia, foe, { element: "fire", mult: 0, flat: 100, baseBreak: 0, atk: 0, flags: { action: true, block: "none" } });
  assert.ok(xia.shp > 6, "战斗里能用吸来的坚毅");
  c.ledgerCapture();
  assert.equal(c.LEDGER.heroes.xia.shp, 6);
});

test("收回的武器人不吃回合结算：灼烧不叠层不掉血", () => {
  const { c, S } = setup(["kolt", "chuan"]);
  const w = c.spawnWeapon(kit(S, "kolt"), "torque");
  assert.ok(w, "有武器人");
  c.returnWeapon(w);
  assert.ok(w.hidden);
  w.statuses.burn = 2;
  const hp0 = c.totalHp(w);
  c.turnEnd();
  assert.equal(w.statuses.burn, 2);
  assert.equal(c.totalHp(w), hp0);
});

test("恐惧怒吼的虚弱只到本回合结束；GM 挂的虚弱不受影响", () => {
  const { c, S } = setup(["tou", "chuan"]);
  const tou = kit(S, "tou"), foe = S.units.find(u => !u.isPlayer);
  tou.roles = { primary: "护卫", secondary: "护卫" }; tou.level = 5; tou.ap = 3; tou.bonus = 2;
  tou.zone = foe.zone;
  cmd(c, { actor: tou.id, skill: "role_fear" });
  assert.equal(foe.statuses.weak, true);
  c.turnEnd();
  assert.equal(foe.statuses.weak, false, "回合结束清掉");
  foe.statuses.weak = true;
  c.turnEnd();
  assert.equal(foe.statuses.weak, true, "别的来源的虚弱照旧");
});

test("坚挺：任何击破都不会把架势打到 1 以下，回合结束失效", () => {
  const { c, S } = setup(["yuito", "chuan"]);
  const ch = kit(S, "chuan"), foe = S.units.find(u => !u.isPlayer);
  ch.statuses.sturdy = true; ch.def = 3;
  c.dealBreak(ch, 5, "physical", [], "测试");
  assert.equal(ch.def, 1);
  assert.ok(!ch.stunned);
  c.dealTo(foe, ch, { element: "physical", mult: 1, baseBreak: 4, atk: 3, flags: { action: true, block: "none", blockResolved: true } });
  assert.equal(ch.def, 1);
  assert.ok(!ch.stunned);
  c.turnEnd();
  assert.equal(ch.statuses.sturdy, false);
});

test("不稳：附赠动作 −1，触发一次后消失；叠两个变晕眩", () => {
  const { c, S } = setup(["chuan", "xia"]);
  const ch = kit(S, "chuan"), foe = S.units.find(u => !u.isPlayer);
  ch.statuses.unstable = true;
  c.refreshEconomy(ch);
  assert.equal(ch.bonus, 0);
  assert.equal(ch.statuses.unstable, false);
  c.refreshEconomy(ch);
  assert.ok(ch.bonus > 0, "下一回合恢复");
  foe.statuses.unstable = true;
  c.refreshEnemyEconomy(foe, []);
  assert.equal(foe.bonus, 0);
  assert.equal(foe.statuses.unstable, false);
  foe.def = 3; foe.stunned = false;
  assert.equal(c.applyUnstable(foe, []), true);
  assert.equal(c.applyUnstable(foe, []), false);
  assert.equal(foe.stunned, true, "两个不稳转晕眩");
});

test("起身中的人吃治疗不回坚毅生命（自焚吸血除外）；医疗包写实际恢复量", () => {
  const { c, S } = setup(["chuan", "xia"]);
  const ch = kit(S, "chuan"), xia = kit(S, "xia");
  ch.layers.forEach(l => { l.current = 0; });
  ch.upOnShp = true; ch.shp = 2; ch.shpMax = 20;
  assert.equal(c.healUnit(ch, 10), 0);
  assert.equal(ch.shp, 2);
  assert.equal(c.healUnit(ch, 10, { selfBurn: true }), 10);
  ch.shp = 2;
  c.bagAdd("medkit", 1, []);
  const notes = c.useItemOn(xia, "medkit", ch);
  assert.equal(ch.shp, 2);
  assert.match(notes.join(""), /实际恢复 0/);
});

test("倒地前失衡的人起身有 1 架势", () => {
  const { c, S } = setup(["chuan", "xia"]);
  const ch = kit(S, "chuan");
  ch.def = 0; ch.stunned = true;
  ch.layers.forEach(l => { l.current = 0; });
  ch.dying = true; c.clearStunOnDown(ch);
  assert.equal(ch.stunned, false);
  c.standUp(ch);
  assert.equal(ch.upOnShp, true);
  assert.equal(ch.def, 1);
});

test("强心 / 强化注射剂自己扣坚毅不致死：最少留 1", () => {
  const { c, S } = setup(["chuan", "xia"]);
  const ch = kit(S, "chuan");
  ch.shp = 4;
  c.bagAdd("stim", 1, []);
  c.useItemOn(ch, "stim", ch);
  assert.equal(ch.shp, 1);
  assert.ok(!ch.dead);
  c.bagAdd("steroid", 1, []);
  c.useItemOn(ch, "steroid", ch);
  assert.equal(ch.shp, 1);
  ch.shp = 20;
  c.bagAdd("stim", 1, []);
  c.useItemOn(ch, "stim", ch);
  assert.equal(ch.shp, 14);
});

test("续命：只能对友方用（以前被推断成敌方）", () => {
  const { c, S } = setup(["yuito", "chuan"]);
  const y = kit(S, "yuito"), foe = S.units.find(u => !u.isPlayer);
  assert.equal(c.skillTargetError(y, "role_renew", foe), "续命只能对友方使用");
  assert.equal(c.skillTargetError(y, "role_renew", kit(S, "chuan")) || null, null);
});

test("破釜沉舟：受伤翻倍从施放到自己下一个回合开始，之后不再翻倍", () => {
  const { c, S } = setup(["xia", "chuan"]);
  const x = kit(S, "xia");
  x.roles = { primary: "直伤", secondary: "直伤" }; x.level = 15; x.ap = 3; x.bonus = 2;
  cmd(c, { actor: x.id, skill: "role_gambit" });
  assert.equal(x.resources.gambitWound, true, "紧接的敌人回合受伤翻倍");
  c.startPlayerPhase();
  assert.equal(x.resources.gambitWound, false, "自己下次行动前结束");
  assert.equal(x.resources.gambitStrike, true);
});

test("锁定：每场次数按等级（1 / 5 级 2 / 10 级 3），锁到回合结束", () => {
  const { c, S } = setup(["helu", "chuan"]);
  const h = kit(S, "helu");
  h.roles = { primary: "环境手", secondary: "环境手" }; h.level = 1; h.ap = 3; h.bonus = 3;
  S.weather = "snow";
  cmd(c, { actor: h.id, skill: "role_lock" });
  assert.ok(S.weatherLock, "锁上了");
  c.turnEnd();
  assert.equal(S.weatherLock, null, "回合结束解开");
  h.bonus = 3;
  cmd(c, { actor: h.id, skill: "role_lock" });
  assert.equal(S.weatherLock, null, "1 级每场一次");
  assert.equal(c.roleLockCap({ level: 5 }), 2);
  assert.equal(c.roleLockCap({ level: 10 }), 3);
});

test("拆卸模式把最内层抽空：敌人照常死亡", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "chuan"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 2 }], seed: "TQ" });
  c.startCombat();
  const S = c.S.state;
  const kolt = kit(S, "kolt"); kolt.zone = 1; kolt.resources.bit = "drill";
  const torque = c.spawnWeapon(kolt, "torque"); torque.zone = 1; torque.ap = 2; torque.level = 2;
  const ch = kit(S, "chuan"); ch.zone = 1;
  const foe = S.units.find(u => !u.isPlayer && Number(u.zone) === 1);
  foe.layers = [{ type: "flesh", current: 1, max: 20, inner: true }];
  c.dispatch({ type: "skill", actor: torque.id, skill: "torque_strip", target: foe.id, picks: { target: foe.id, ally: ch.id } });
  assert.equal(c.totalHp(foe), 0);
  assert.equal(foe.dead, true);
});

test("武器人收回再唤出：按类型对应血量层，前面插过护盾层也不会回满", () => {
  const { c, S } = setup(["kolt", "chuan"]);
  const kolt = kit(S, "kolt");
  const t1 = c.spawnWeapon(kolt, "torque");
  const armor = t1.layers.find(l => l.type === "armor");
  armor.current = 3;
  t1.layers.unshift({ type: "shield", current: 5, max: 5 });
  c.returnWeapon(t1);
  const t2 = c.spawnWeapon(kolt, "torque");
  assert.equal(t2.layers.find(l => l.type === "armor").current, 3);
});

test("瑞比机甲：明特装甲打空不会把瑞比判成濒死；战后瑞比只记自己的伤势", () => {
  const { c, S } = setup(["ruby", "chuan"]);
  const r = kit(S, "ruby");
  r.resources.nano = 60;
  const notes = c.enterMecha();
  assert.ok(r.resources.mecha, notes.join(""));
  const own = r.layers.filter(l => !l.mecha);
  const mint = r.layers.filter(l => l.mecha);
  assert.ok(mint.length && own.length);
  assert.ok(!mint.some(l => l.inner), "明特的层不是内层");
  mint.forEach(l => { l.current = 0; });
  own[own.length - 1].current = 9;
  assert.equal(c.isInnerDepleted(r), false, "瑞比还有血");
  assert.equal(c.isUnitDown(r), false);
  c.ledgerCapture();
  assert.equal(c.LEDGER.heroes.ruby.layers.length, own.length, "瑞比只记自己的层");
  assert.equal(c.LEDGER.heroes.ruby.layers[own.length - 1], 9);
});

test("结人死后牵挂不再代扛击破", () => {
  const { c, S } = setup(["yuito", "chuan"]);
  const y = kit(S, "yuito"), ch = kit(S, "chuan"), foe = S.units.find(u => !u.isPlayer);
  y.resources.bondId = ch.id;
  y.dead = true;
  ch.def = 2;
  c.dealTo(foe, ch, { element: "physical", mult: 1, baseBreak: 3, atk: 1, flags: { action: true, block: "none", blockResolved: true } });
  assert.ok(ch.def < 2, "自己扣架势");
});

test("敌人的协助攻击（拿普攻当协助）不能被我方格挡", () => {
  const { c, S } = setup(["chuan", "xia"]);
  const ch = kit(S, "chuan"), foe = S.units.find(u => !u.isPlayer);
  foe.zone = ch.zone = 1; kit(S, "xia").zone = 1;
  S._assistBy = foe.id;
  const out = c.dealTo(foe, ch, { element: "physical", mult: 1, baseBreak: 1, atk: 3, flags: { action: true } });
  S._assistBy = null;
  assert.ok(!out.pending, "没有进协助格挡队列");
  const out2 = c.dealTo(foe, ch, { element: "physical", mult: 1, baseBreak: 1, atk: 3, flags: { action: true } });
  assert.ok(out2.pending, "普通攻击照样可以协助格挡");
});

test("把配置物推进深渊：直接消失，不报错", () => {
  const { c, S } = setup(["chuan", "xia"]);
  const barrel = c.makeProp("boom", 1, 1);
  S.props.push(barrel);
  S.fields[2].abyss = true;
  const notes = [];
  assert.doesNotThrow(() => c.displaceTo(barrel, 2, notes, "测试"));
  assert.ok(!S.props.includes(barrel));
  assert.match(notes.join(""), /深渊/);
});

test("开战时站在深渊里的人挪出来；地面单位不会主动走进深渊", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["chuan", "xia"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "ABY" });
  const S = c.S.state;
  S.fields[1].abyss = true;
  S.units.forEach(u => { if (u.isPlayer) u.zone = 1; });
  c.startCombat();
  assert.ok(S.units.filter(u => u.isPlayer && !u.hidden).every(u => Number(u.zone) === 2), "挪到 2 区");
  const foe = S.units.find(u => !u.isPlayer);
  foe.zone = 2;
  c.doMove(foe, 1);
  assert.equal(Number(foe.zone), 2, "不走进深渊");
});

test("方形棋盘：敌人沿相连的区靠近（以前写死区号 ±1，3 区到不了 2 区）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["chuan"], board: "square4", enemies: [{ id: "thug_knife", lv: 1, zone: 3 }], seed: "SQ" });
  c.startCombat();
  const S = c.S.state;
  const ch = kit(S, "chuan"), foe = S.units.find(u => !u.isPlayer);
  ch.zone = 2; foe.zone = 3;
  const plan = c.EnemyAI.planFor(foe, 0);
  assert.ok(plan, "有行动");
  const m = String(plan.meta.skillName).match(/移动到 (\d) 区/);
  assert.ok(m, plan.meta.skillName);
  assert.ok(c.zonesAdjacent(3, Number(m[1])), "走到相连的区");
  assert.equal(c.zoneDist(Number(m[1]), 2), 1, "离目标更近");
});

test("单局：任务最后一站撤退 = 任务失败，没有报酬；中途撤退照旧算跳过", () => {
  const c = H.load();
  const R = c.Rogue, run = R.newRun({ party: ["kolt", "helu"], seed: "RT1" });
  R.acceptTask(run, "main");
  run.task.index = run.task.nodes.length - 1;
  run.task.nodes[run.task.index] = { type: "elite", done: false };
  const kz = c.S.state.kuizhi;
  c.BattleSim.setup(R.battleSpec(run));
  c.startCombat();
  c.performRetreat();
  const notes = R.finishBattle(run, "retreat");
  assert.equal(c.S.state.kuizhi, kz, "没有报酬");
  assert.equal(run.task, null);
  assert.ok(!run.main.done, "主线没完成");
  assert.match(plain(notes).join(""), /任务失败/);
});

test("单局诊所：义体改造不再顺便回满血，伤势照旧带着", () => {
  const c = H.load();
  const R = c.Rogue, run = R.newRun({ party: ["kolt", "helu"], seed: "CY9" });
  run.stage = "camp"; c.S.state.kuizhi = 50000;
  const h = run.party.find(x => x.kit === "kolt");
  h.hp = [{ type: "flesh", current: 1 }];
  const v0 = R.heroView(run, h);
  R.modifyHero(run, "kolt", { armor: 2 });
  const v1 = R.heroView(run, h);
  assert.equal(v1.hp, v0.hp, "血量没有回满（只剩 1 的还是 1）");
  assert.ok(v1.hp < v1.hpMax);
  assert.ok(R.healCost(run, "kolt") > 0, "还得花钱治疗");
});
