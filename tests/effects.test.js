// 玩家手册第四章：之前没实现或只实现了一部分的效果（effects.js）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

/** 一场摆好的战斗：柯尔特 + Helumica 对一个狂徒（锤），已开战，全员在 1 区 */
function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_hammer", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }], seed: "FX" });
  c.startCombat();
  const st = c.S.state;
  const kolt = c.findKit("kolt", st.units), helu = c.findKit("helu", st.units);
  const [foe, foe2] = st.units.filter(u => !u.isPlayer);
  st.units.forEach(u => { u.zone = 1; });
  const hit = (a, t, el, extra) => c.dealTo(a, t, Object.assign({ atk: 10, mult: 1, element: el, baseBreak: 0, atkRange: "any",
    flags: { action: true, blockResolved: true, block: "none" } }, extra || {}));
  return { c, st, kolt, helu, foe, foe2, hit };
}
const layers = (u, ls) => { u.layers = ls.map((l, i) => ({ type: l[0], current: l[1], max: l[2] != null ? l[2] : l[1], inner: i === ls.length - 1 })); };
const cur = (u, type) => u.layers.find(l => l.type === type).current;

test("刺骨：施加时立刻对肉体 / 星灵 / 沙尘层造成本层上限 10% 的冰伤（不打外层装甲）", () => {
  const { c, foe } = field();
  layers(foe, [["armor", 10], ["flesh", 40]]);
  c.applyInstantEffect(foe, "sting", []);
  assert.equal(cur(foe, "armor"), 10);
  assert.ok(cur(foe, "flesh") < 40, "肉体应当受伤");
});

test("刺骨：被击破时再造成一次", () => {
  const { c, foe } = field();
  layers(foe, [["flesh", 40]]);
  c.applyInstantEffect(foe, "sting", []);
  const after1 = cur(foe, "flesh");
  foe.def = 1; foe.stunned = false;
  c.dealBreak(foe, 1, "physical", []);
  assert.equal(foe.stunned, true);
  assert.ok(cur(foe, "flesh") < after1);
});

test("刺骨：受到火属性伤害后立刻解除，并对内层造成 10% 火伤", () => {
  const { c, foe, kolt, hit } = field();
  layers(foe, [["armor", 50], ["flesh", 40]]);
  c.applyInstantEffect(foe, "sting", []);
  const flesh = cur(foe, "flesh");
  foe.layers[0].current = 0;                    // 打穿装甲，让火伤落到肉体上
  hit(kolt, foe, "fire", { atk: 10 });
  assert.equal(foe.instant.sting, false);
  assert.ok(cur(foe, "flesh") < flesh, "内层应当吃到刺骨遇火的伤害");
});

test("过载：护盾本回合翻倍，下回合开始清零并结束，再下一回合按规则回满", () => {
  const { c, helu } = field();
  layers(helu, [["shield", 6], ["flesh", 16]]);
  c.applyInstantEffect(helu, "overload", []);
  assert.equal(cur(helu, "shield"), 12);
  c.endPlayerTurn(); c.endEnemyTurn();          // 进入下一回合
  assert.equal(helu.instant.overload, false);
  assert.equal(cur(helu, "shield"), 0);
  assert.equal(helu.layers[0].max, 6);
  c.endPlayerTurn(); c.endEnemyTurn();
  assert.equal(cur(helu, "shield"), 6);
});

test("过载：期间被击破会过载爆炸；装甲受近距离攻击反伤 50%", () => {
  const { c, foe, kolt, hit } = field();
  layers(foe, [["armor", 30], ["flesh", 40]]);
  c.applyInstantEffect(foe, "overload", []);
  const koltHp = c.totalCurHp(kolt);
  hit(kolt, foe, "physical", { atk: 10 });
  assert.ok(c.totalCurHp(kolt) < koltHp, "近距离打过载装甲应当被反伤");
  foe.level = 8;                                // 爆炸是 等级 × 1d4，等级高一点免得被装甲减到 0
  const hp = c.totalCurHp(foe);
  foe.def = 1; foe.stunned = false;
  c.dealBreak(foe, 1, "physical", []);
  assert.ok(c.totalCurHp(foe) < hp, "过载期间被击破应当爆炸");
});

test("熔融：护盾一回合内累计受到上限一半的伤害就失效，下回合以一半恢复", () => {
  const { c, foe, kolt, hit } = field();
  layers(foe, [["shield", 20], ["flesh", 40]]);
  c.applyInstantEffect(foe, "melt", []);
  hit(kolt, foe, "physical", { atk: 16 });      // 物理打护盾有减免，确保实际打掉一半以上
  assert.equal(cur(foe, "shield"), 0);
  c.endPlayerTurn(); c.endEnemyTurn();
  assert.equal(cur(foe, "shield"), 10);
});

test("霜结：冰属性攻击恢复 1 架势；免疫冻伤；再次霜结到下回合前完全免疫", () => {
  const { c, helu, foe, hit } = field();
  helu.self = "frost"; helu.def = 2;
  hit(helu, foe, "ice", { atk: 1 });
  assert.equal(helu.def, 3);
  helu.statuses.frostbite = true;
  c.endPlayerTurn(); c.endEnemyTurn();
  assert.equal(helu.statuses.frostbite, false);
  c.castSelfEffect(helu, "frost", []);
  const hp = c.totalCurHp(helu);
  hit(foe, helu, "physical", { atk: 20 });
  assert.equal(c.totalCurHp(helu), hp);
});

test("溅射：酸属性单体攻击对同区其他敌人 25% 溅射；移动掉 15% 最大生命；免疫腐蚀", () => {
  const { c, st, kolt, foe, foe2, hit } = field();
  kolt.self = "splash";
  const hp2 = c.totalCurHp(foe2);
  hit(kolt, foe, "acid", { atk: 20 });
  assert.ok(c.totalCurHp(foe2) < hp2, "同区另一个敌人应当吃到溅射");
  const hp = c.totalCurHp(kolt);
  foe.zone = 2; foe2.zone = 2;                  // 离开的区没有敌人，免得触发借机攻击
  kolt.bonus = 2; st.combatPhase = "player";
  c.doMove(kolt, 2);
  assert.equal(c.totalCurHp(kolt), hp - Math.max(1, Math.floor(c.totalMaxHp(kolt) * 0.15)));
  kolt.statuses.corr = true;
  c.endPlayerTurn(); c.endEnemyTurn();
  assert.equal(kolt.statuses.corr, false);
});

test("导体：每三次攻击第三次额外打一个随机敌人；免疫感电；移动不耗附赠；架势上限 3", () => {
  const { c, st, kolt, foe, foe2, hit } = field();
  kolt.self = "conductor";
  const hp2 = c.totalCurHp(foe2);
  hit(kolt, foe, "physical", { atk: 1 }); hit(kolt, foe, "physical", { atk: 1 });
  assert.equal(c.totalCurHp(foe2), hp2);
  hit(kolt, foe, "physical", { atk: 1 });
  assert.ok(c.totalCurHp(foe2) < hp2, "第三次攻击应当额外击中另一个敌人");
  kolt.statuses.shock = true;
  c.shockPulse(kolt);
  assert.equal(kolt.statuses.shock, false);
  kolt.bonus = 1; st.combatPhase = "player";
  c.doMove(kolt, 2);
  assert.equal(kolt.bonus, 1);
  kolt.def = 6;
  c.endPlayerTurn(); c.endEnemyTurn();
  assert.ok(kolt.def <= 3);
});

test("千钧：格挡 +10%；免受位移；无法恢复架势", () => {
  const { c, kolt, foe } = field();
  const base = c.finalBlockChance(kolt, foe);
  kolt.self = "anchor";
  assert.equal(c.finalBlockChance(kolt, foe), Math.min(100, base + 10));
  assert.equal(c.canDisplace(kolt), false);
  kolt.def = 0; kolt.stunned = true;
  c.recoverFromStun(kolt, []);
  assert.equal(kolt.def, 0);
});

test("蓄能只加能量和谐波，不加电", () => {
  const { c, helu, foe } = field();
  helu.self = "store"; helu.highEnergy = 8;
  const res = c.dealTo(helu, foe, { atk: 10, mult: 1, element: "electric", baseBreak: 0, flags: { action: true, blockResolved: true, block: "none" } });
  assert.ok(!(res.res.log || []).some(s => /蓄能/.test(s)));
});

test("多普勒：自身受到击破时，同区所有单位受同量击破（不分敌我）", () => {
  const { c, kolt, helu, foe } = field();
  kolt.self = "doppler";
  const d1 = helu.def, d2 = foe.def;
  c.dealBreak(kolt, 1, "harmonic", []);
  assert.equal(helu.def, d1 - 1);
  assert.equal(foe.def, d2 - 1);
});

test("躲藏：不能被选作攻击目标；受到伤害或发动攻击后解除", () => {
  const { c, kolt, foe, hit } = field();
  foe.statuses.hide = true;
  const r = hit(kolt, foe, "physical");
  assert.equal(r.res.ok, false);
  c.applyTypedDot(foe, 3, "fire", [], "范围伤害");
  assert.equal(foe.statuses.hide, false);
  kolt.statuses.hide = true;
  hit(kolt, foe, "physical", { atk: 1 });
  assert.equal(kolt.statuses.hide, false);
});

test("雷鸣：成功的协助格挡反伤 等级 × 1d4 闪电", () => {
  const { c, st, kolt, helu, foe } = field();
  st.weather = "thunder";
  const hp = c.totalCurHp(foe);
  c.performAssistBlock(helu, kolt, foe, { ok: true, roll: 1 });
  assert.ok(c.totalCurHp(foe) < hp);
});
