// 审计跟进（P3-combat）：协助格挡 / 格挡率上限 / 协助攻击 / 武器人进出 / 射程 / 撤退 / 倒地的规则 bug 回归测试
// （README「规则改动记录」里有对应说明）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("vm");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function setup(party, enemies, opt) {
  const c = H.load();
  c.BattleSim.setup(Object.assign({ party, enemies: enemies || [{ id: "thug_hammer", lv: 1, zone: 1 }], seed: "P3" }, opt || {}));
  c.startCombat();
  return { c, S: c.S.state };
}
const kit = (S, k) => S.units.find(u => u.kit === k);
const foes = (S) => S.units.filter(u => !u.isPlayer);
function act(c, S, a, t, id, picks) {
  S.attackerId = a.id; S.targetId = t ? (t.id || t) : null;
  if (picks) S.skillFlow = { id, actorId: a.id, picks: Object.assign({}, picks), index: 99 };
  try { c.runSkill(id); } finally { S.skillFlow = null; }
}
const logText = (S) => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
/** 敌人打柯尔特，Helumica 协助格挡（forced 定结果）；返回柯尔特掉的血 */
function enemyHitsKolt(setupHelper, forced, baseBreak) {
  const { c, S } = setup(["kolt", "helu"]);
  const kolt = kit(S, "kolt"), helu = kit(S, "helu"), foe = foes(S)[0];
  kolt.zone = helu.zone = foe.zone = 1;
  kolt.prideMaxHp = Infinity;   // 不让「过度自信」少吃 1 击破干扰这里的击破计算
  c.endPlayerTurn();
  if (setupHelper) setupHelper(c, S, kolt, helu);
  helu.bonus = 1; kolt.bonus = 0;
  kolt.def = 2; helu.def = 4;
  const hp0 = c.totalHp(kolt);
  c.dealTo(foe, kolt, { atk: 10, mult: 1, element: "physical", baseBreak: baseBreak == null ? 3 : baseBreak, flags: { action: true } });
  c.finishBlock(helu.id, forced);
  return { c, S, kolt, helu, lost: hp0 - c.totalHp(kolt) };
}

/* ---------- 1. 协助格挡成功：目标免伤且不扣架势，击破由格挡者承担（作者定，最少留 1） ---------- */

test("协助格挡成功：目标免伤且不扣架势，击破由格挡者承担（最少留 1）；失败照常受伤、失衡", () => {
  const ok = enemyHitsKolt(null, { roll: 1, ok: true });
  assert.equal(ok.lost, 0, "免伤");
  assert.equal(ok.kolt.def, 2, "目标不扣架势");
  assert.equal(ok.kolt.stunned, false);
  assert.equal(ok.helu.def, 1, "格挡者承担 3 击破：4 → 1");
  assert.match(logText(ok.S), /格挡者承担|改由格挡者承担/);
  const small = enemyHitsKolt(null, { roll: 1, ok: true }, 1);
  assert.equal(small.kolt.def, 2);
  assert.equal(small.helu.def, 3, "4 − 1 = 3");
  const fail = enemyHitsKolt(null, { roll: 99, ok: false });
  assert.ok(fail.lost > 0);
  assert.equal(fail.kolt.stunned, true);
  // 空手格挡（Ecmo 分出去，Helumica 空手）：伤害减半
  const bare = enemyHitsKolt((c, S, kolt, helu) => { const w = c.spawnWeapon(helu, "ecmo"); w.zone = 2; }, { roll: 1, ok: true });
  assert.ok(bare.lost > 0 && bare.lost <= Math.ceil(fail.lost / 2), `空手格挡受一半伤害（${bare.lost} / ${fail.lost}）`);
  assert.equal(bare.helu.loseBonusNext, true);
});

test("警卫队队长·牛的自动格挡按它自己的条文：牛扣自己架势（最少留 1），被保护者不扣；反击 1 击破打空照样失衡", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "captain_ox", lv: 1, zone: 1 }, { id: "thug_hammer", lv: 1, zone: 1 }]);
  const kolt = kit(S, "kolt"), ox = kit(S, "captain_ox"), thug = kit(S, "thug_hammer");
  S.units.forEach(u => { u.zone = 1; });
  kolt.def = 1;
  const oxDef = ox.def, thugDef = thug.def, thugHp = c.totalHp(thug);
  vm.runInContext("Math", c).random = () => 0;   // 格挡骰必定成功
  c.dealTo(kolt, thug, { atk: 5, mult: 1, element: "physical", baseBreak: 2, flags: { action: true } });
  assert.equal(c.totalHp(thug), thugHp, "被保护者免伤");
  assert.equal(thug.def, thugDef, "被保护者不扣架势");
  assert.equal(ox.def, Math.max(1, oxDef - 2), "牛自己扣架势");
  assert.equal(kolt.def, 0);
  assert.equal(kolt.stunned, true, "反击 1 击破走 dealBreak：打空就失衡");
});

test("安保巡逻车的自动格挡按一般规则：目标免伤、不扣架势，击破由巡逻车承担（最少留 1）", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "patrol_car", lv: 1, zone: 1 }, { id: "thug_hammer", lv: 1, zone: 1 }]);
  const kolt = kit(S, "kolt"), car = kit(S, "patrol_car"), thug = kit(S, "thug_hammer");
  S.units.forEach(u => { u.zone = 1; });
  thug.def = 2;
  const carDef = car.def, thugHp = c.totalHp(thug);
  vm.runInContext("Math", c).random = () => 0;
  c.dealTo(kolt, thug, { atk: 5, mult: 1, element: "physical", baseBreak: 3, flags: { action: true } });
  assert.equal(c.totalHp(thug), thugHp);
  assert.equal(thug.def, 2);
  assert.equal(thug.stunned, false);
  assert.equal(car.def, Math.max(1, carDef - 3));
});

/* ---------- 2. 格挡率不封顶（作者定） ---------- */

test("格挡率不封顶：武器格挡加成（含改装件）照加，最终格挡率最多 100%；绯秋居合 100%", () => {
  const { c, S } = setup(["tou", "chuan"], [{ id: "thug_hammer", lv: 1, zone: 2 }]);
  const tou = kit(S, "tou"), chuan = kit(S, "chuan");
  tou.weaponLevels = Object.assign({}, tou.weaponLevels, { mochi: 7 });
  tou.weaponParts = Object.assign({}, tou.weaponParts, { mochi: ["s_block_dex", "s_block_str"] });   // 年糕 45 + 12 + 12
  assert.equal(c.weaponBlockBonusOf("mochi", tou), 69);
  tou.attrs.dex = 10;
  assert.equal(c.blockChance(tou), 100, "面板最多显示 100%");
  assert.equal(c.finalBlockChance(tou, foes(S)[0], chuan), 100);
  const h = setup(["hiaki", "tou"]);
  const hiaki = kit(h.S, "hiaki");
  hiaki.resources.stance = "iai";
  assert.equal(h.c.finalBlockChance(hiaki, foes(h.S)[0], kit(h.S, "tou")), 100);
});

test("图纸的「协助格挡 +N%」照加，不封顶（最终最多 100%）", () => {
  const { c, S } = setup(["tou", "chuan"], [{ id: "thug_hammer", lv: 1, zone: 2 }]);
  const tou = kit(S, "tou"), chuan = kit(S, "chuan");
  const touBase = c.finalBlockChance(tou, null, chuan), chuanBase = c.finalBlockChance(chuan, null, tou);
  S.weaponMods = { mochi: { block: 10 }, bili: { block: 10 } };
  tou.weaponLevels = Object.assign({}, tou.weaponLevels, { mochi: 4 });
  chuan.weaponLevels = Object.assign({}, chuan.weaponLevels, { bili: 4 });
  assert.equal(c.finalBlockChance(tou, null, chuan), Math.min(100, touBase + 10));
  assert.equal(c.finalBlockChance(chuan, null, tou), Math.min(100, chuanBase + 10));
  const row = c.bpEffectRows({ block: 10 }, { blockBase: 45 }).find(r => r.k === "协助格挡");
  assert.match(row.v, /45% → 55%/);
});

/* ---------- 3. 倒下的单位不能协助格挡 ---------- */

test("死亡的单位不能协助格挡：倒下的武器人、坚毅耗尽的角色剩着附赠也不行，不扣附赠和耐久", () => {
  const { c, S } = setup(["kolt", "helu"]);
  const kolt = kit(S, "kolt"), helu = kit(S, "helu"), foe = foes(S)[0];
  S.units.forEach(u => { u.zone = 1; });
  const torque = c.spawnWeapon(kolt, "torque");
  torque.zone = 1;
  c.endPlayerTurn();
  torque.layers.forEach(l => { l.current = 0; });
  torque.dead = true; torque.bonus = 1;
  assert.ok(!c.eligibleBlockers(helu).some(u => u.id === torque.id), "倒下的武器人不在名单里");
  const dur0 = c.weaponDur("torque");
  const r = c.performAssistBlock(torque, helu, foe, { roll: 1, ok: true });
  assert.equal(r.ok, false);
  assert.equal(torque.bonus, 1, "不扣附赠");
  assert.equal(c.weaponDur("torque"), dur0, "不扣耐久");
  // 坚毅耗尽死亡的角色
  helu.layers.forEach(l => { l.current = 0; });
  helu.dead = true; helu.bonus = 1;
  assert.ok(!c.eligibleBlockers(kolt).some(u => u.id === helu.id));
  assert.equal(c.performAssistBlock(helu, kolt, foe, { roll: 1, ok: true }).ok, false);
});

test("起不来的濒死者（力竭、坚毅耗尽）不出现在「起身并格挡」里；能起身的照常在", () => {
  for (const [label, prep, want] of [
    ["力竭 1", (S, h) => { S.exhaustTier = 1; }, false],
    ["坚毅耗尽", (S, h) => { h.shp = 0; }, false],
    ["能起身", () => {}, true]
  ]) {
    const { c, S } = setup(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
    const kolt = kit(S, "kolt"), helu = kit(S, "helu");
    helu.zone = kolt.zone; helu.bonus = 1;
    helu.layers.forEach(l => { l.current = 0; });
    helu.dying = true;
    prep(S, helu);
    assert.equal(c.eligibleBlockers(kolt).some(u => u.id === helu.id), want, label);
    if (!want) {
      const r = c.performAssistBlock(helu, kolt, foes(S)[0], { roll: 1, ok: true });
      assert.equal(r.ok, false, label);
      assert.equal(helu.dying, true, label);
      assert.equal(helu.bonus, 1, label + "：不扣附赠");
      assert.doesNotMatch(r.notes.join(" "), /起身以进行协助格挡/, label);
    }
  }
});

/* ---------- 4. 格挡反击走 dealBreak ---------- */

test("夕夏格挡反打、绯秋胁构反伤把敌人架势打空：照样失衡，并触发协助攻击", () => {
  for (const [k, prep] of [["xia", null], ["hiaki", h => { h.resources.stance = "waki"; }]]) {
    const { c, S } = setup([k, "helu"], [{ id: "thug_hammer", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 2 }]);
    const helper = kit(S, k), victim = kit(S, "helu"), foe = kit(S, "thug_hammer");
    helper.zone = victim.zone = foe.zone = 1;
    c.endPlayerTurn();
    helper.bonus = 1;
    if (prep) prep(helper);
    foe.def = 1;
    c.dealTo(foe, victim, { atk: 5, mult: 1, element: "physical", baseBreak: 1, flags: { action: true } });
    c.finishBlock(helper.id, { roll: 1, ok: true });
    assert.equal(foe.def, 0, k);
    assert.equal(foe.stunned, true, k + "：架势打空就失衡（以前夕夏直接改架势，敌人 0 架势照常行动）");
    assert.ok((S.assistQueue || []).some(j => j.targetId === foe.id), k + "：触发协助攻击");
  }
});

/* ---------- 5. 协助攻击名单 ---------- */

test("协助攻击名单：武器人已倒的空手角色不在里面；选了也不会白回架势", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "thug_hammer", lv: 1, zone: 2 }]);
  const kolt = kit(S, "kolt"), helu = kit(S, "helu"), foe = foes(S)[0];
  const torque = c.spawnWeapon(kolt, "torque");
  // 武器人在场、活着：空手的主人照样能接（发动前先召回武器）
  foe.def = 0; foe.stunned = true;
  assert.ok(c.eligibleAssisters(helu, foe).some(u => u.id === kolt.id));
  // 武器人倒下：召回不了，不能出手
  torque.layers.forEach(l => { l.current = 0; });
  torque.dead = true;
  assert.equal(c.isUnarmed(kolt), true);
  assert.ok(!c.eligibleAssisters(helu, foe).some(u => u.id === kolt.id));
  kolt.def = 2;
  S.assistQueue = [{ breakerId: helu.id, targetId: foe.id, vsPlayer: false }];
  c.finishAssist(kolt.id);
  assert.equal(kolt.def, 2, "先确认能出手，再回满架势");
});

test("协助攻击名单：耐久归零的武器人召回来也用不了，不列进名单", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "thug_hammer", lv: 1, zone: 2 }]);
  const kolt = kit(S, "kolt"), helu = kit(S, "helu"), foe = foes(S)[0];
  c.spawnWeapon(kolt, "torque");
  c.LEDGER.dur.torque = 0;
  foe.def = 0; foe.stunned = true;
  assert.ok(!c.eligibleAssisters(helu, foe).some(u => u.id === kolt.id));
});

test("飞碟触灵本体失衡：我方名单里没有本体自己，也没有濒死、失衡的角色；选本体不会给它回满架势", () => {
  const { c, S } = setup(["kolt", "helu", "ras"], [{ id: "ufo_boss", lv: 1, zone: 2 }]);
  const body = S.units.find(u => u.kit === "ufo_body");
  const kolt = kit(S, "kolt"), helu = kit(S, "helu"), ras = kit(S, "ras");
  helu.layers.forEach(l => { l.current = 0; });
  helu.dying = true;
  ras.stunned = true; ras.def = 0;
  body.def = 0; body.stunned = true;
  const list = c.eligibleAssisters(kolt, body).map(u => u.id);
  assert.ok(!list.includes(body.id), "敌方单位不进我方名单");
  assert.ok(!list.includes(helu.id), "濒死没起身的不行");
  assert.ok(!list.includes(ras.id), "失衡的不行");
  S.assistQueue = [{ breakerId: kolt.id, targetId: body.id, vsPlayer: false }];
  c.finishAssist(body.id);
  assert.equal(body.def, 0, "没给本体回满架势");
  helu.def = 1;
  S.assistQueue = [{ breakerId: kolt.id, targetId: body.id, vsPlayer: false }];
  c.finishAssist(helu.id);
  assert.equal(helu.def, 1, "濒死的人选上了也不白回架势");
});

/* ---------- 6. 收回为武器要和持有者同区 ---------- */

test("武器人主动收回为武器要和持有者同区（不扣行动点）；协助攻击前的强制召回不受影响", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "thug_hammer", lv: 1, zone: 2 }], { zoneMode: 3 });
  const kolt = kit(S, "kolt"), helu = kit(S, "helu"), foe = foes(S)[0];
  kolt.zone = 1;
  const torque = c.spawnWeapon(kolt, "torque");
  torque.zone = 3; torque.ap = 1;
  act(c, S, torque, null, "torque_return");
  assert.equal(torque.hidden, false, "不同区收不回");
  assert.equal(torque.ap, 1, "不扣行动点");
  assert.equal(c.isUnarmed(kolt), true);
  // 协助攻击：先召回武器（不看区域）
  foe.def = 0; foe.stunned = true;
  S.assistQueue = [{ breakerId: helu.id, targetId: foe.id, vsPlayer: false }];
  c.finishAssist(kolt.id);
  assert.equal(torque.hidden, true, "强制召回");
  assert.equal(c.isUnarmed(kolt), false);
  // 同区照常收回
  const t2 = setup(["kolt", "helu"]);
  const k2 = kit(t2.S, "kolt");
  const w2 = t2.c.spawnWeapon(k2, "torque");
  w2.zone = k2.zone; w2.ap = 1;
  act(t2.c, t2.S, w2, null, "torque_return");
  assert.equal(w2.hidden, true);
  assert.equal(k2.weaponHeld, true);
});

/* ---------- 7. 耐久 0 的武器 ---------- */

test("在场武器人耐久被格挡扣到 0：这一场才坏的，收回后照常能用（atk 减半），本场唤不出来", () => {
  const { c, S } = setup(["kolt", "helu"]);
  const kolt = kit(S, "kolt"), helu = kit(S, "helu"), foe = foes(S)[0];
  S.units.forEach(u => { u.zone = 1; });
  const torque = c.spawnWeapon(kolt, "torque");
  torque.zone = 1;
  c.LEDGER.dur.torque = 1;
  c.endPlayerTurn();
  torque.bonus = 1;
  c.dealTo(foe, helu, { atk: 5, mult: 1, element: "physical", baseBreak: 1, flags: { action: true } });
  c.finishBlock(torque.id, { roll: 1, ok: true });
  assert.equal(c.weaponDur("torque"), 0);
  c.endEnemyTurn();
  torque.ap = 1;
  act(c, S, torque, null, "torque_return");
  assert.equal(torque.hidden, true);
  assert.equal(c.isUnarmed(kolt), false, "这一场才坏的：照常拿着");
  assert.equal(c.effectiveAtk(kolt, S.units), kolt.personalAtk + Math.floor(kolt.weaponAtk / 2), "武器 atk 减半");
  assert.equal(c.spawnWeapon(kolt, "torque"), null, "本场唤不出来");
  assert.match(c.weaponSummonWhy(kolt, "torque"), /耐久为 0/);
});

test("战斗中修在场的武器人：耐久回来，但主人不会跟着变成持械（维修包、ledgerRepair 都一样）", () => {
  for (const how of ["item", "ledger"]) {
    const { c, S } = setup(["kolt", "helu"]);
    const kolt = kit(S, "kolt"), helu = kit(S, "helu");
    const torque = c.spawnWeapon(kolt, "torque");
    assert.ok(torque && !torque.hidden);
    c.LEDGER.dur.torque = 0;
    c.bagAdd("repair_kit", 1);
    if (how === "item") c.useItemOn(helu, "repair_kit", null, "torque");
    else c.ledgerRepair("torque", []);
    assert.ok(c.weaponDur("torque") > 0, how);
    assert.equal(c.isUnarmed(kolt), true, how + "：扭矩还在场上，柯尔特手里没有武器");
    // 收回之后才回到手里
    torque.ap = 1;
    act(c, S, torque, null, "torque_return");
    assert.equal(c.isUnarmed(kolt), false, how);
  }
});

/* ---------- 8. 任意距离不限距离（作者定：不改） ---------- */

test("任意距离照旧不限距离：电光束、泄能打得到距离 2；磁力移动能吸距离 2 的目标", () => {
  const { c, S } = setup(["chuan", "ras"], [{ id: "thug_hammer", lv: 1, zone: 3 }], { zoneMode: 3 });
  assert.deepEqual(plain(c.parseSkillRange("任意距离 · 1atk 电击 · 感电")), { min: 0, max: 99 });
  assert.deepEqual(plain(c.skillRangeFor(null, "ras_dump")), { min: 0, max: 99 });
  const chuan = kit(S, "chuan"), foe = foes(S)[0];
  const bili = c.spawnWeapon(chuan, "bili");
  bili.zone = 1; foe.zone = 3; bili.ap = 1;
  act(c, S, bili, foe, "bili_beam");
  assert.equal(bili.ap, 0);
  assert.ok(foe.statuses.shock, "距离 2 照样挂感电");
  const steps = c.skillFlowSteps("bili_magnet", bili, {});
  assert.ok(steps[0].units.some(u => u.id === foe.id), "磁力移动名单里有距离 2 的目标");
});

/* ---------- 9. 危墙 / 关门先判，再进协助格挡 ---------- */

test("隔着危墙 / 关着的门的攻击：直接被挡下，不弹协助格挡、不花附赠和耐久", () => {
  for (const gap of [{ type: "wall", hp: 10, maxHp: 10 }, { type: "door", open: false }]) {
    const { c, S } = setup(["kolt", "helu"], [{ id: "guard_gun", lv: 1, zone: 2 }]);
    const kolt = kit(S, "kolt"), helu = kit(S, "helu"), gun = foes(S)[0];
    kolt.zone = helu.zone = 1; gun.zone = 2;
    S.gaps["1-2"] = Object.assign(c.emptyGap(), gap);
    c.endPlayerTurn();
    helu.bonus = 1;
    const dur0 = c.weaponDur("ecmo"), hp0 = c.totalHp(kolt);
    act(c, S, gun, kolt, "en_guard_gun_far");
    assert.equal((S.blockQueue || []).length, 0, gap.type);
    assert.equal(helu.bonus, 1, gap.type);
    assert.equal(c.weaponDur("ecmo"), dur0, gap.type);
    assert.equal(c.totalHp(kolt), hp0, gap.type);
  }
});

test("进过协助格挡队列的一击记着自己的射程：看守（枪）近距砸枪格挡失败后照常落下", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "guard_gun", lv: 1, zone: 1 }]);
  const kolt = kit(S, "kolt"), helu = kit(S, "helu"), gun = foes(S)[0];
  kolt.zone = helu.zone = gun.zone = 1;
  c.endPlayerTurn();
  helu.bonus = 1;
  const hp0 = c.totalHp(kolt);
  act(c, S, gun, kolt, "en_guard_gun_near");
  assert.equal((S.blockQueue || []).length, 1);
  c.finishBlock(helu.id, { roll: 99, ok: false });
  assert.ok(c.totalHp(kolt) < hp0, "以前重判射程按单位卡的「远距离」，同区打不到");
});

/* ---------- 10. 高地 ---------- */

test("高地格挡修正看这一击是不是隔区的远程攻击，不看单位卡上的 range；借机攻击是近战，不吃高地远程 +25%", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "captain_ox", lv: 1, zone: 2 }]);
  const kolt = kit(S, "kolt"), helu = kit(S, "helu"), ox = foes(S)[0];
  kolt.zone = helu.zone = 1; ox.zone = 2;
  const base = c.blockChance(helu);
  S.fields[2].highland = true;
  assert.equal(c.finalBlockChance(helu, ox, kolt), base - 10, "远近皆可的牛从高地隔区打下来：−10%");
  assert.equal(c.finalBlockChance(helu, ox, kolt, "melee"), base, "近战不算");
  S.fields[2].highland = false; S.fields[1].highland = true;
  assert.equal(c.finalBlockChance(helu, ox, kolt), base + 10);
  ox.zone = 1;
  assert.equal(c.finalBlockChance(helu, ox, kolt), base, "同区不算");
  // 借机攻击：匕首狂徒站在高地，柯尔特走到低地
  const lost = (high) => {
    const t = setup(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
    const k = kit(t.S, "kolt"), knife = foes(t.S)[0];
    k.zone = 1; knife.zone = 1; k.bonus = 1;
    t.S.fields[1].highland = high;
    vm.runInContext("Math", t.c).random = () => 0.5;
    const hp0 = t.c.totalHp(k);
    t.c.doMove(k, 2);
    assert.equal(k.zone, 2);
    return hp0 - t.c.totalHp(k);
  };
  const flat = lost(false);
  assert.ok(flat > 0);
  assert.equal(lost(true), flat, "借机是近战：高地不加伤害");
});

/* ---------- 11. 撤退 ---------- */

function hurtTo(c, u, ratio) {
  const max = c.baseMaxHp(u);
  let cut = max - Math.floor(max * ratio);
  u.layers.forEach(l => { const d = Math.min(cut, l.current); l.current -= d; cut -= d; });
}

test("撤退「有损伤」：全员血量 ≤ 50%，或有人 ≤ 25% / 倒地 / 靠坚毅起身；掉一点血不算", () => {
  const cases = [
    ["掉 1 点血", (c, k, h) => { k.layers[k.layers.length - 1].current -= 1; }, "intact"],
    ["一人 60%", (c, k, h) => hurtTo(c, k, 0.6), "intact"],
    ["一人 50%、一人满血", (c, k, h) => hurtTo(c, k, 0.5), "intact"],
    ["全员 50%", (c, k, h) => { hurtTo(c, k, 0.5); hurtTo(c, h, 0.5); }, "hurt"],
    ["一人 25%", (c, k, h) => hurtTo(c, k, 0.25), "hurt"],
    ["一人靠坚毅起身（不算倒地）", (c, k, h) => { k.layers.forEach(l => { l.current = 0; }); k.dying = true; c.standUp(k); }, "hurt"],
    ["一人倒地（两人队 = 半数倒地）", (c, k, h) => { k.layers.forEach(l => { l.current = 0; }); k.dying = true; }, "routed"]
  ];
  for (const [label, prep, want] of cases) {
    const { c, S } = setup(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
    prep(c, kit(S, "kolt"), kit(S, "helu"));
    assert.equal(c.retreatStatus(), want, label);
  }
  // 三人队一人倒地：有损伤
  const { c, S } = setup(["kolt", "helu", "ras"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const kolt = kit(S, "kolt");
  kolt.layers.forEach(l => { l.current = 0; }); kolt.dying = true;
  assert.equal(c.retreatStatus(), "hurt");
});

test("撤退：靠坚毅生命站着的人不算倒地，可以断后，扣坚毅按站着的人算", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const kolt = kit(S, "kolt"), helu = kit(S, "helu");
  kolt.layers.forEach(l => { l.current = 0; }); kolt.dying = true;
  helu.layers.forEach(l => { l.current = 0; }); helu.dying = true; c.standUp(helu);
  assert.equal(c.retreatStatus(), "routed", "两人一倒地 = 半数倒地");
  assert.deepEqual(plain(c.retreatRearguards().map(u => u.id)), [helu.id]);
  helu.shp = 30; kolt.shp = 30;
  const r = c.performRetreat(helu.id);
  assert.match(r.notes.join("\n"), /Helumica 断后/);
  assert.equal(kolt.shp, 23, "倒地者 −7");
  assert.ok(helu.shp <= 25, "断后挨打 + 站着的人 −5");
});

test("撤退：断后的一击被防护罩挡下时，记录写挡下了，不写挨了多少伤害", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const kolt = kit(S, "kolt"), helu = kit(S, "helu");
  hurtTo(c, kolt, 0.5); hurtTo(c, helu, 0.5);
  const dome = c.makeProp("dome", kolt.zone, 1);
  dome.hp = dome.maxHp = 50;
  S.props = (S.props || []).concat([dome]);
  const hp0 = c.totalCurHp(kolt);
  const r = c.performRetreat(kolt.id);
  assert.equal(r.key, "hurt");
  assert.equal(c.totalCurHp(kolt), hp0);
  assert.ok(dome.hp < 50);
  const line = r.notes.find(s => /断后/.test(s));
  assert.match(line, /挡下/);
  assert.doesNotMatch(line, /挨了/);
});

test("撤退确认：游戏版不写坚毅生命的数字，主持人计算器照写", () => {
  for (const game of [false, true]) {
    const c = H.load();
    if (game) c.GAME_MODE = true;
    c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
    c.startCombat();
    const text = c.retreatPreview().lines.join("；");
    assert.equal(/坚毅 −\d/.test(text), !game, text);
    assert.match(text, /坚毅/);
  }
});

/* ---------- 12. 倒地统一结算（applyKnockdown） ---------- */

test("高能自爆：起身中的人坚毅扣光死亡（不会回到濒死再起身）；力竭 3 被炸倒立刻死亡", () => {
  {
    const { c, S } = setup(["kolt", "helu"], [{ id: "thug_hammer", lv: 1, zone: 2 }]);
    const kolt = kit(S, "kolt");
    kolt.layers.forEach(l => { l.current = 0; }); kolt.dying = true; c.standUp(kolt);
    kolt.shp = 6;
    kolt.statuses.high = true; kolt.highEnergy = 7;
    c.checkHighBoom(kolt);
    assert.equal(kolt.dead, true);
    assert.equal(kolt.dying, false);
    assert.equal(kolt.shp, 0);
  }
  {
    const { c, S } = setup(["kolt", "helu"], [{ id: "thug_hammer", lv: 1, zone: 2 }]);
    const kolt = kit(S, "kolt");
    S.exhaustTier = 3;
    kolt.statuses.high = true; kolt.highEnergy = 999;
    c.checkHighBoom(kolt);
    assert.equal(kolt.dead, true);
    assert.equal(kolt.dying, false);
  }
  {
    const { c, S } = setup(["kolt", "helu"], [{ id: "thug_hammer", lv: 1, zone: 2 }]);
    const kolt = kit(S, "kolt");
    kolt.statuses.high = true; kolt.highEnergy = 999;
    c.checkHighBoom(kolt);
    assert.equal(kolt.dying, true, "平时被炸倒照常濒死");
    assert.equal(kolt.dead, false);
  }
});

test("坠入深渊：力竭 3 摔倒立刻死亡；起身中的人那 10% 改扣坚毅生命", () => {
  {
    const { c, S } = setup(["kolt", "helu"], [{ id: "thug_hammer", lv: 1, zone: 2 }]);
    const kolt = kit(S, "kolt");
    S.exhaustTier = 3;
    kolt.layers.forEach(l => { l.current = 0; }); kolt.layers[kolt.layers.length - 1].current = 1;
    S.fields[1].abyss = true; kolt.zone = 1;
    c.applyAbyssFall(kolt, 2, []);
    assert.equal(kolt.dead, true);
  }
  {
    const { c, S } = setup(["kolt", "helu"], [{ id: "thug_hammer", lv: 1, zone: 2 }]);
    const kolt = kit(S, "kolt");
    kolt.layers.forEach(l => { l.current = 0; }); kolt.dying = true; c.standUp(kolt);
    kolt.shp = 6;
    const loss = Math.floor(c.totalMaxHp(kolt) * 0.1);
    S.fields[1].abyss = true; kolt.zone = 1;
    c.applyAbyssFall(kolt, 2, []);
    assert.equal(kolt.shp, 6 - loss);
    assert.equal(kolt.upOnShp, true, "还站着");
    assert.equal(kolt.dying, false);
    kolt.shp = 1;
    S.fields[2].abyss = true; S.fields[1].abyss = false; kolt.zone = 2;
    c.applyAbyssFall(kolt, 1, []);
    assert.equal(kolt.dead, true, "坚毅扣光死亡");
  }
});

test("applyKnockdown：公用的倒地结算（返回 dead / dying / shp / null）", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "thug_hammer", lv: 1, zone: 2 }]);
  const kolt = kit(S, "kolt"), helu = kit(S, "helu");
  assert.equal(c.applyKnockdown(kolt, []), null, "还有血不处理");
  kolt.layers.forEach(l => { l.current = 0; });
  const notes = [];
  assert.equal(c.applyKnockdown(kolt, notes, { cause: "坠落" }), "dying");
  assert.equal(kolt.dying, true);
  assert.match(notes.join(""), /坠落导致最内层归零，陷入濒死/);
  assert.equal(c.applyKnockdown(kolt, []), "dying", "已经濒死的不重复结算");
  helu.layers.forEach(l => { l.current = 0; }); helu.dying = true; c.standUp(helu);
  helu.shp = 5;
  assert.equal(c.applyKnockdown(helu, [], { shpLoss: 2 }), "shp");
  assert.equal(helu.shp, 3);
  assert.equal(c.applyKnockdown(helu, []), "shp", "攻击已经扣过坚毅：不传 shpLoss 不再扣");
  assert.equal(helu.shp, 3);
  const torque = c.spawnWeapon(kolt, "torque");
  torque.layers.forEach(l => { l.current = 0; });
  assert.equal(c.applyKnockdown(torque, []), "dead", "武器人倒下");
});

/* ---------- 13. 濒死没起身的人什么都不能做 ---------- */

test("濒死没起身：不能扳拉杆、操控机炮、改写炮台、移动、用道具（规则层也拦）", () => {
  const { c, S } = setup(["kolt", "helu"], [{ id: "thug_hammer", lv: 1, zone: 2 }]);
  const kolt = kit(S, "kolt"), foe = foes(S)[0];
  kolt.layers.forEach(l => { l.current = 0; });
  kolt.dying = true;
  kolt.ap = 1; kolt.bonus = 1;
  S.gaps["1-2"] = Object.assign(c.emptyGap(), { type: "door", open: false });
  const lever = c.makeProp("lever", kolt.zone, 1); lever.link = "1-2";
  const scrap = c.makeProp("scrap", kolt.zone, 1);
  const turret = c.makeProp("turret", kolt.zone, 1); turret.faction = "enemy";
  S.props = (S.props || []).concat([lever, scrap, turret]);
  const foeHp = c.totalHp(foe);
  act(c, S, kolt, null, "use_device:" + lever.id);
  act(c, S, kolt, foe, "use_scrap:" + scrap.id);
  act(c, S, kolt, null, "hack_turret:" + turret.id);
  assert.equal(kolt.ap, 1);
  assert.equal(S.gaps["1-2"].open, false, "拉杆没动");
  assert.equal(c.totalHp(foe), foeHp, "机炮没开火");
  assert.equal(turret.faction, "enemy", "炮台没被改写");
  const z0 = kolt.zone;
  c.doMove(kolt, z0 === 1 ? 2 : 1);
  assert.equal(kolt.zone, z0, "不能移动");
  assert.equal(kolt.bonus, 1);
  c.bagAdd("medkit", 1);
  const notes = c.useItemOn(kolt, "medkit", kit(S, "helu"));
  assert.match(notes.join(""), /濒死/);
  assert.equal(c.bagCount("medkit"), 1, "道具没用掉");
});
