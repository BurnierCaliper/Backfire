// 作者对 PR #23（第二批规则修复）逐条裁定后的调整：恶劣环境下的波谷、加倍计量翻倍震荡、猛扑越过空隙
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(party, enemies, opt) {
  const c = H.load();
  c.BattleSim.setup(Object.assign({ party: party || ["kolt", "helu"], enemies: enemies || [{ id: "thug_hammer", lv: 1, zone: 1 }], seed: "RUL" }, opt || {}));
  c.startCombat();
  const S = c.S.state;
  return { c, S, kit: k => c.findKit(k, S.units), foe: S.units.find(u => !u.isPlayer) };
}
const hit = (c, a, t, extra) => c.dealTo(a, t, Object.assign({ atk: 10, mult: 1, element: "physical", baseBreak: 0, atkRange: "any",
  flags: { action: true, blockResolved: true, block: "none" } }, extra || {}));

test("恶劣环境 / 末日：相位波谷的 −50% 伤害翻倍成 −100%（不是再乘一次 ×0.5）", () => {
  const { c, S, kit, foe } = field();
  const k = kit("kolt");
  k.zone = foe.zone = 1;
  foe.layers = [{ type: "flesh", current: 500, max: 500, inner: true }];
  S.weather = "phase"; S.phaseStep = 0;
  const normal = hit(c, k, foe).res.total;
  assert.ok(normal > 0);
  foe.harshEnv = true;
  assert.equal(hit(c, k, foe).res.total, 0, "波谷 −100%");
});

test("加倍计量：震荡扣的架势上限翻倍（−4），加倍计量结束后恢复成 −2，震荡解除后上限还原", () => {
  const { c, foe } = field();
  foe.def = foe.defMax = 10;
  foe.statuses.shockwave = true;
  c.syncShockwave(foe, []);
  assert.equal(foe.defMax, 8);
  foe.instant = foe.instant || {};
  foe.instant.doubleStatus = true;
  c.syncShockwave(foe, []);
  assert.equal(foe.defMax, 6, "加倍计量：−4");
  foe.instant.doubleStatus = false;
  c.syncShockwave(foe, []);
  assert.equal(foe.defMax, 8, "加倍计量结束：回到 −2");
  foe.statuses.shockwave = false;
  c.syncShockwave(foe, []);
  assert.equal(foe.defMax, 10);
});

test("猛扑是「跃」：带着同区目标越过空隙，目标不会掉下去", () => {
  const { c, S, kit, foe } = field(["tou", "kolt"]);
  const tou = kit("tou");
  const mochi = c.spawnWeapon(tou, "mochi");
  mochi.zone = foe.zone = 1; mochi.ap = 3; mochi.bonus = 3;
  foe.layers = [{ type: "flesh", current: 500, max: 500, inner: true }];
  S.gaps["1-2"] = { type: "void" };
  const steps = c.skillFlowSteps("mochi_pounce", mochi, { target: foe.id });
  assert.ok(steps[1].zones.includes(2), "空隙那边的区能选");
  S.attackerId = mochi.id; S.targetId = foe.id;
  S.skillFlow = { id: "mochi_pounce", actorId: mochi.id, picks: { target: foe.id, dest: 2 }, index: 99 };
  try { c.runSkill("mochi_pounce"); } finally { S.skillFlow = null; }
  assert.equal(mochi.zone, 2);
  assert.equal(foe.zone, 2, "目标一起过去了，没有掉进空隙");
});

test("过度自信：血量不低于进入战斗时的血量上限就减伤 25%、少受 1 击破；战斗中上限被抬高也照原来的上限算", () => {
  const { c, S, kit, foe } = field(["kolt", "helu"]);
  const k = kit("kolt");
  k.zone = foe.zone = 1;
  const base = c.baseMaxHp(k);
  assert.equal(k.prideMaxHp, base, "开战时记下");
  k.def = k.defMax = 10;
  // 上限被抬高（例如多了一层），现有血量超过原来的上限但没到新上限：照样触发
  k.layers.push({ type: "flesh", current: 0, max: 50 });
  k.layers[0].current = k.layers[0].max;
  for (const l of k.layers) if (l !== k.layers[0] && l.max !== 50) l.current = l.max;
  k.layers[k.layers.length - 1].current = 5;
  assert.ok(c.totalHp(k) >= base && c.totalHp(k) < c.baseMaxHp(k));
  const out = hit(c, foe, k, { atk: 20, baseBreak: 2 });
  assert.equal(out.res.total, 15, "20 × 75%");
  assert.equal(k.def, 9, "2 击破 − 1");
  assert.match(out.res.log.join("\n"), /过度自信/);
  // 血量低于原来的上限：不触发
  k.layers = [{ type: "flesh", current: base - 1, max: base + 100, inner: true }];
  k.def = 10;
  const out2 = hit(c, foe, k, { atk: 8, baseBreak: 2 });
  assert.equal(out2.res.total, 8, "不减伤");
  assert.equal(k.def, 8);
});

test("聚焦不看来源：状态、场地等非攻击伤害只要属性对也推进序列", () => {
  const { c, foe } = field();
  foe.layers = [{ type: "armor", current: 100, max: 100 }, { type: "flesh", current: 100, max: 100, inner: true }];
  foe.focuses = [{ layerType: "armor", seq: ["fire", "acid"], step: 0 }];
  const notes = [];
  c.applyTypedDot(foe, 5, "ice", notes, "测试冰伤");
  assert.equal(foe.focuses[0].step, 0, "属性不对不推进");
  c.applyTypedDot(foe, 5, "fire", notes, "灼烧");
  assert.equal(foe.focuses[0].step, 1, "灼烧（状态伤害）推进了一步");
  c.applyTypedDot(foe, 5, "acid", notes, "酸液地面");
  assert.ok(!foe.layers.some(l => l.type === "armor" && l.current > 0), "场地伤害走完序列，装甲被抹去");
});

test("哔哩哩协助格挡成功：自身不掉架势，把这一击原本伤害的 50% 以闪电反伤给进攻者", () => {
  const { c, S, kit, foe } = field(["chuan", "kolt"]);
  const ch = kit("chuan"), k = kit("kolt");
  const bili = c.spawnWeapon(ch, "bili");
  bili.zone = k.zone = foe.zone = 1; bili.bonus = 1; bili.def = bili.defMax = 3;
  k.prideMaxHp = Infinity;
  foe.layers = [{ type: "flesh", current: 500, max: 500, inner: true }];
  c.endPlayerTurn();
  bili.bonus = 1;
  const hp0 = c.totalHp(k), foeHp = c.totalHp(foe);
  c.dealTo(foe, k, { atk: 20, mult: 1, element: "physical", baseBreak: 2, flags: { action: true } });
  c.finishBlock(bili.id, { roll: 1, ok: true });
  assert.equal(c.totalHp(k), hp0, "柯尔特免伤");
  assert.equal(bili.def, 3, "哔哩哩不掉架势");
  assert.ok(foeHp - c.totalHp(foe) > 0, "进攻者挨了反伤");
  assert.match(S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n"), /格挡反伤/);
});

test("临时护盾：施加的护盾并进护盾层、先挨打、不会在没挨打的回合回满；自带护盾照常回满", () => {
  const { c, S, kit } = field(["chuan", "kolt"]);
  const ch = kit("chuan");
  const bili = c.spawnWeapon(ch, "bili");
  bili.layers = [{ type: "shield", current: 10, max: 10 }, { type: "flesh", current: 50, max: 50, inner: true }];
  c.addShieldLayer(bili, 5, false);
  assert.equal(bili.layers.filter(l => l.type === "shield").length, 1, "并在同一个护盾层里，不算额外一层");
  assert.equal(bili.layers[0].current, 15); assert.equal(bili.layers[0].max, 15);
  c.applyTypedDot(bili, 8, "physical", [], "测试");
  const sh = bili.layers[0];
  assert.equal(sh.tempShield, 0, "临时护盾先扣");
  assert.equal(sh.max, 10, "上限回到自带的 10");
  // 下一回合没挨打：自带护盾回满到 10，临时护盾不回来（直接走回合开始的结算，不让敌人插手）
  const nextRound = () => { S.units.forEach(u => { u.gotHitThisTurn = false; }); c.beginRound([]); };
  nextRound();
  assert.equal(bili.layers[0].current, 10);
  assert.equal(bili.layers[0].max, 10);
  // 本来没有护盾的单位：施加的护盾整层都是临时的，扣掉的不回，扣光就没了
  const k = kit("kolt");
  k.layers = [{ type: "flesh", current: 50, max: 50, inner: true }];
  c.addShieldLayer(k, 6, false);
  assert.equal(k.layers[0].type, "shield"); assert.equal(k.layers[0].max, 6);
  c.applyTypedDot(k, 2, "physical", [], "测试");
  const left = k.layers[0].current;
  assert.ok(left < 6);
  nextRound();
  assert.equal(k.layers[0].current, left, "没挨打的回合也不回满");
  c.applyTypedDot(k, 20, "physical", [], "测试");
  nextRound();
  assert.ok(!k.layers.some(l => l.type === "shield"), "临时护盾用完，护盾层去掉");
});
