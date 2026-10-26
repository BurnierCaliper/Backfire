// 武器职责技能（issue #404）：武器「武器等级 + 羁绊」到 8 级解锁，和持有者的主职责一一对应，由武器人使用。
// 规则书：角色创建规则「武器升级」lv8：解锁武器职责技能；玩家手册（经验勘误）第 26 页的武器职责技能表、第 28 页的武器升级节奏。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));
const ids = (c, u) => plain(c.skillList(u).map(s => s.id));

function setup(party, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party, enemies: opt.enemies || [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }], seed: opt.seed || "WROLE", zoneMode: opt.zoneMode });
  c.startCombat();
  const S = c.S.state;
  S.units.filter(u => !u.isPlayer).forEach(f => { f.layers = [{ type: "flesh", current: 300, max: 300 }]; f.def = f.defMax = 20; f.zone = 1; });
  S.units.filter(u => u.isPlayer).forEach(u => { u.zone = 1; u.ap = 3; u.bonus = 3; });
  return { c, S, foes: S.units.filter(u => !u.isPlayer) };
}
/** 把 owner 的武器 kit 升到 lv 级、唤出来（武器人站在主人那一区，行动点 / 附赠动作给够） */
function weapon(c, owner, kit, lv) {
  owner.weaponLevels[kit] = lv == null ? 8 : lv;
  const w = c.spawnWeapon(owner, kit);
  w.zone = owner.zone; w.ap = 3; w.bonus = 3;
  return w;
}
const lastLog = (S, n) => S.logPages.flatMap(p => p.lines).map(l => l.text).slice(-(n || 1)).join("\n");

/* ---------- 发放：8 级、主职责、羁绊、挂在武器人身上 ---------- */
test("发放：武器 8 级才解锁；按持有者的主职责给对应的技能（瑞比直伤 → 明特「磨砺」……）；挂在武器人身上，角色自己没有", () => {
  const { c, S } = setup(["ruby", "yuito", "hiaki", "chuan", "nora", "helu", "longge", "kolt"]);
  const kit = k => c.findKit(k, S.units);
  const mint7 = weapon(c, kit("ruby"), "mint", 7);
  assert.ok(!ids(c, mint7).some(id => /^wr_/.test(id)), "7 级还没有");
  c.setOwnedWeaponLevel(kit("ruby"), "mint", 8);
  mint7.level = 8;
  assert.ok(ids(c, mint7).includes("wr_hone"), "8 级：直伤「磨砺」");
  const want = { yuito: ["latte", "wr_advantage"], hiaki: ["niu", "wr_weight"], chuan: ["bili", "wr_upright"], nora: ["vitas", "wr_recycle"],
    helu: ["ecmo", "wr_canopy"], longge: ["xiaoxiao", "wr_mist"] };
  Object.keys(want).forEach(h => {
    const [k, id] = want[h];
    const w = weapon(c, kit(h), k, 8);
    assert.equal(ids(c, w).filter(x => /^wr_/.test(x)).join(), id, `${h} 的 ${k}：${id}`);
  });
  // 绯秋的两把刀各有一份
  const naruto = weapon(c, kit("hiaki"), "naruto", 8);
  assert.ok(ids(c, naruto).includes("wr_weight"), "鳴門也有配重");
  // 坦克的「重组」还在确认：坦克主职责的武器 8 级也没有武器职责技能
  const torque = weapon(c, kit("kolt"), "torque", 10);
  assert.ok(!ids(c, torque).some(id => /^wr_/.test(id)), "坦克（重组待定）没有");
  // 角色本人（拿着武器、空手）都没有武器职责技能
  ["ruby", "yuito", "chuan", "nora"].forEach(h => assert.ok(!ids(c, kit(h)).some(id => /^wr_/.test(id)), h + " 本人没有"));
});

test("发放：按主职责，不看副职责；控场主职责的武器 8 级是「禁止通行」", () => {
  const { c, S } = setup(["tou", "chuan"]);
  const tou = c.findKit("tou", S.units), chuan = c.findKit("chuan", S.units);
  assert.equal(chuan.roles.primary, "护卫"); assert.equal(chuan.roles.secondary, "控场");
  assert.ok(ids(c, weapon(c, chuan, "bili", 8)).includes("wr_upright") && !ids(c, c.findKit("bili", S.units)).includes("wr_barricade"), "川川护卫 / 控场：只给护卫的");
  tou.roles = { primary: "控场", secondary: "坦克" };
  assert.ok(ids(c, weapon(c, tou, "mochi", 8)).includes("wr_barricade"));
});

test("发放：解锁看「武器等级 + 羁绊」（和改装槽、被动升级一样），羁绊不够 8 级就没有", () => {
  const { c, S } = setup(["chuan"]);
  const chuan = c.findKit("chuan", S.units);
  const bili = weapon(c, chuan, "bili", 6);
  assert.ok(!ids(c, bili).includes("wr_upright"));
  chuan.bonds = { bili: 1 };
  assert.ok(!ids(c, bili).includes("wr_upright"), "6 + 1 = 7 级还没有");
  chuan.bonds = { bili: 2 };
  assert.ok(ids(c, bili).includes("wr_upright"), "6 + 2 = 8 级");
});

test("消耗、说明：回收不花行动，创造优势花附赠动作，其余花行动点；每个都有完整说明，数值读配置表", () => {
  const c = H.load();
  const W = vm.runInContext("WEAPON_ROLE_SKILLS", c);
  assert.equal(vm.runInContext("WEAPON_ROLE_SKILL_LEVEL", c), 8);
  assert.deepEqual(plain(Object.keys(W).map(id => W[id].role)), ["直伤", "异常", "击破", "护卫", "生存", "环境手", "控场", "辅助"]);
  const cost = id => plain(c.skillCost(id));
  assert.deepEqual(cost("wr_recycle"), {});
  assert.deepEqual(cost("wr_advantage"), { bonus: 1 });
  ["wr_hone", "wr_weight", "wr_upright", "wr_mist", "wr_canopy", "wr_barricade"].forEach(id => assert.deepEqual(cost(id), { ap: 1 }, id));
  Object.keys(W).forEach(id => {
    const t = c.SkillText.skillText(id);
    assert.ok(t && t.startsWith(W[id].name + "（武器 8 级 · " + W[id].role + "）："), id + " 有说明");
  });
  assert.match(c.SkillText.skillText("wr_hone"), /atk \+20/);
  assert.match(c.SkillText.skillText("wr_advantage"), /每场两次/);
  assert.match(c.SkillText.skillText("wr_upright"), /耐久消耗合计不超过 2/);
  vm.runInContext("WEAPON_ROLE_SKILLS.wr_hone.atk = 30", c);
  assert.match(c.weaponRoleHint("wr_hone"), /atk \+30/, "提示跟着配置表");
});

/* ---------- 磨砺（直伤） ---------- */
function honeField(hone) {
  const { c, S, foes } = setup(["ruby"]);
  S.noChart = true;   // 不看克制表：伤害就是 atk × 倍率
  c.Math.random = () => 0;
  const ruby = c.findKit("ruby", S.units);
  const mint = weapon(c, ruby, "mint", 8);
  const pops = [];
  c.spawnPopup = (u, spec) => { if (spec.kind === "dmg") pops.push(spec.value); };
  if (hone) cmd(c, { actor: mint.id, skill: "wr_hone" });
  return { c, S, foes, mint, pops };
}
test("磨砺：花 1 行动点，atk +20 直到下一次攻击；这一次攻击行动的每一击都吃到，打完就没了；还没用掉时不能再磨砺", () => {
  const plainF = honeField(false), honed = honeField(true);
  const { c, mint } = honed;
  assert.equal(mint.ap, 2, "花了 1 行动点");
  assert.equal(c.effectiveAtk(mint, honed.S.units), c.effectiveAtk(plainF.mint, plainF.S.units) + 20);
  assert.match(c.statusLine(mint), /磨砺 atk\+20/);
  assert.match(c.skillRequirementError(mint, "wr_hone"), /已经磨砺过了/);
  // 驱逐：两次 0.5atk，两下都多 10
  cmd(plainF.c, { actor: plainF.mint.id, skill: "mint_banish", target: plainF.foes[0].id });
  cmd(c, { actor: mint.id, skill: "mint_banish", target: honed.foes[0].id });
  assert.equal(plainF.pops.length, 2); assert.equal(honed.pops.length, 2);
  assert.deepEqual(honed.pops.map((v, i) => v - plainF.pops[i]), [10, 10], "这一次攻击行动的两下都吃到 +20 atk");
  assert.equal(mint.resources.honeAtk, 0, "打完就没了");
  assert.equal(c.effectiveAtk(mint, honed.S.units), c.effectiveAtk(plainF.mint, plainF.S.units));
  assert.match(lastLog(honed.S, 6), /磨砺的 atk 加成用掉了/);
  assert.equal(c.skillRequirementError(mint, "wr_hone"), null, "用掉以后可以再磨砺");
});

test("磨砺：没攻击就一直留着（跨回合）；收回再唤出、开新的一场都清掉", () => {
  const { c, S, mint } = honeField(true);
  c.endPlayerTurn(); c.endEnemyTurn();
  assert.equal(mint.resources.honeAtk, 20, "到下一次攻击才用掉");
  c.resetBattleFlags(mint);
  assert.equal(mint.resources.honeAtk, undefined, "开新的一场：清掉");
  const two = honeField(true);
  two.c.returnWeapon(two.mint);
  const again = weapon(two.c, two.c.findKit("ruby", two.S.units), "mint", 8);
  assert.notEqual(again, two.mint);
  assert.ok(!again.resources.honeAtk, "收回再唤出：新的武器人身上没有");
  void S;
});

/* ---------- 回收（异常） ---------- */
test("回收：不花行动，清除任意一个单位的一种状态效果（震荡解除时架势上限还回来），自己 +1 行动点；每场一次，收回再唤出也不重置", () => {
  const { c, S, foes } = setup(["nora", "ruby"]);
  const nora = c.findKit("nora", S.units), ruby = c.findKit("ruby", S.units);
  const vitas = weapon(c, nora, "vitas", 8);
  vitas.ap = 1;
  const foe = foes[0];
  foe.statuses.shockwave = true; c.syncShockwave(foe, null);
  foe.statuses.burn = 2;
  assert.equal(foe.defMax, 18, "震荡压了 2 点上限");
  const steps = c.skillFlowSteps("wr_recycle", vitas, {});
  assert.deepEqual(plain(steps.map(s => s.key)), ["target"]);
  assert.ok(steps[0].units.some(u => u.id === foe.id) && !steps[0].units.some(u => u.id === ruby.id), "只列身上有状态效果的单位");
  const two = c.skillFlowSteps("wr_recycle", vitas, { target: foe.id });
  assert.deepEqual(plain(two[1].options.map(o => o.value)), ["burn", "shockwave"], "状态不止一种时再选");
  cmd(c, { actor: vitas.id, skill: "wr_recycle", target: foe.id, picks: { target: foe.id, status: "shockwave" } });
  assert.equal(foe.statuses.shockwave, false);
  assert.equal(foe.defMax, 20, "架势上限还回来");
  assert.equal(foe.statuses.burn, 2, "只清选中的那一种");
  assert.equal(vitas.ap, 2, "不花行动，还 +1 行动点");
  assert.match(c.skillRequirementError(vitas, "wr_recycle"), /本场回收已用完/);
  // 次数记在诺拉身上：收回再唤出（新的武器人）照样用完了
  c.returnWeapon(vitas);
  const again = weapon(c, nora, "vitas", 8);
  assert.notEqual(again, vitas);
  assert.match(c.skillRequirementError(again, "wr_recycle"), /本场回收已用完/);
  assert.equal(nora.resources.roleOnce["wr:vitas:wr_recycle"], 1);
  c.resetBattleFlags(nora);
  assert.equal(c.skillRequirementError(again, "wr_recycle"), null, "开新的一场清零");
});

test("回收：敌我都行；高能清掉高能值，紧追清掉施加者；没人身上有状态时按钮变灰；选了没有的状态在扣点前拦下", () => {
  const { c, S, foes } = setup(["nora", "ruby"]);
  const nora = c.findKit("nora", S.units), ruby = c.findKit("ruby", S.units);
  const vitas = weapon(c, nora, "vitas", 8);
  assert.match(c.skillRequirementError(vitas, "wr_recycle"), /没有带状态效果的单位/);
  ruby.statuses.weak = true;
  foes[0].statuses.high = true; foes[0].highEnergy = 9;
  foes[1].statuses.chase = true; foes[1].chasers = [ruby.id];
  assert.equal(c.skillRequirementError(vitas, "wr_recycle"), null);
  cmd(c, { actor: vitas.id, skill: "wr_recycle", target: foes[1].id, picks: { target: foes[1].id, status: "weak" } });
  assert.equal(vitas.ap, 3, "选了没有的状态：拦下，什么都没发生");
  assert.equal(foes[1].statuses.chase, true);
  cmd(c, { actor: vitas.id, skill: "wr_recycle", target: ruby.id, picks: { target: ruby.id } });
  assert.equal(ruby.statuses.weak, false, "队友身上的虚弱也能清");
  // 只有这一种状态时不用再选，连带的东西一起清掉
  for (const [key, check] of [["high", f => f.highEnergy === 0], ["chase", f => !(f.chasers || []).length]]) {
    const one = setup(["nora"]);
    const v = weapon(one.c, one.c.findKit("nora", one.S.units), "vitas", 8), f = one.foes[0];
    f.statuses[key] = true; f.highEnergy = 9; f.chasers = ["x"];
    cmd(one.c, { actor: v.id, skill: "wr_recycle", target: f.id, picks: { target: f.id } });
    assert.equal(f.statuses[key], false, key);
    assert.ok(check(f), key + " 连带的东西也清掉");
  }
});

/* ---------- 配重（击破） ---------- */
test("配重：花 1 行动点，架势只留 1 点；下一次造成击破的攻击击破加上失去的架势（用掉）；架势 1 点时不能用，还没用掉时不能再用", () => {
  const { c, S, foes } = setup(["hiaki"]);
  const hiaki = c.findKit("hiaki", S.units);
  const niu = weapon(c, hiaki, "niu", 8);
  assert.equal(niu.def, 4);
  cmd(c, { actor: niu.id, skill: "wr_weight" });
  assert.equal(niu.def, 1);
  assert.equal(niu.resources.weightBreak, 3);
  assert.equal(niu.ap, 2);
  assert.match(c.statusLine(niu), /配重 击破\+3/);
  assert.match(c.skillRequirementError(niu, "wr_weight"), /配重还没用掉/);
  // 不造成击破的攻击不用掉
  c.dealTo(niu, foes[1], { atk: 1, mult: 1, element: "physical", baseBreak: 0, flags: { action: true } });
  assert.equal(niu.resources.weightBreak, 3, "没造成击破：留着");
  assert.equal(foes[1].def, 20);
  const def0 = foes[0].def;
  cmd(c, { actor: niu.id, skill: "niu_slash", target: foes[0].id });
  assert.equal(def0 - foes[0].def, 1 + 3, "斩炎 1 击破 + 配重 3");
  assert.equal(niu.resources.weightBreak, 0, "用掉");
  // 架势只剩 1 点：用了也没有可以失去的
  const again = weapon(c, hiaki, "naruto", 8);
  again.def = 1;
  assert.match(c.skillRequirementError(again, "wr_weight"), /架势只有 1 点/);
});

/* ---------- 矗立（护卫） ---------- */
function uprightField(roll) {
  const { c, S, foes } = setup(["chuan", "ruby", "kolt"]);
  c.Math.random = () => roll;
  const chuan = c.findKit("chuan", S.units), ruby = c.findKit("ruby", S.units);
  const bili = weapon(c, chuan, "bili", 8);
  S.units.filter(u => u.isPlayer).forEach(u => { u.bonus = 1; });
  cmd(c, { actor: bili.id, skill: "wr_upright" });
  S.combatPhase = "enemy";
  const hit = (t) => c.dealTo(foes[0], t, { atk: 0, mult: 0, flat: 6, element: "physical", baseBreak: 1, flags: { action: true } });
  return { c, S, foes, chuan, ruby, bili, hit };
}
test("矗立：花 1 行动点；到回合结束，同区友方挨打时武器人自动协助格挡（不花附赠、不用问，挡住就没有格挡弹窗）；期间格挡的耐久消耗合计最多 2", () => {
  const { c, S, ruby, chuan, bili, hit } = uprightField(0);
  assert.equal(bili.ap, 2);
  assert.match(c.statusLine(bili), /矗立/);
  const dur0 = c.weaponDur("bili"), hp0 = c.totalHp(ruby);
  hit(ruby);
  assert.equal((S.blockQueue || []).length, 0, "自动挡住：不进格挡弹窗");
  assert.equal(c.totalHp(ruby), hp0, "挡住了：瑞比不掉血");
  assert.equal(bili.bonus, 1, "不花附赠动作");
  assert.equal(c.weaponDur("bili"), dur0 - 1, "第一下照常 −1 耐久");
  assert.match(lastLog(S, 12), /矗立：哔哩哩&滋啦啦 自动协助格挡 瑞比/);
  hit(chuan);
  assert.equal(c.weaponDur("bili"), dur0 - 2, "第二下 −1");
  hit(ruby);
  assert.equal(c.weaponDur("bili"), dur0 - 2, "第三下：耐久消耗合计已到 2，不再扣");
  assert.match(lastLog(S, 12), /耐久消耗已经到 2/);
  const st = c.battleStat(bili);
  assert.equal(st.blocks, 3); assert.equal(st.blockOk, 3);
  // 武器人自己挨打：不能为自己格挡，照常进格挡弹窗问别人
  hit(bili);
  assert.equal(S.blockQueue.length, 1, "武器人自己挨打：问别人");
  c.finishBlock(null);
  c.turnEnd();
  assert.equal(bili.resources.uprightTurn, false, "回合结束：矗立结束");
  assert.equal(c.skillRequirementError(bili, "wr_upright"), null);
});

test("矗立：自动格挡没挡住，同区其他能挡的人还能接着挡（武器人不再列出）；没人能挡就照常落下", () => {
  const { c, S, ruby, hit } = uprightField(0.999);
  const hp0 = c.totalHp(ruby);
  hit(ruby);
  assert.equal(S.blockQueue.length, 1, "自动格挡没挡住：轮到别人");
  const left = c.eligibleBlockers(ruby, S.blockQueue[0]).map(u => u.kit);
  assert.ok(!left.includes("bili") && left.includes("chuan") && left.includes("kolt"), JSON.stringify(left));
  assert.equal(c.totalHp(ruby), hp0, "伤害还没落下");
  c.finishBlock(null);
  assert.ok(c.totalHp(ruby) < hp0, "其他人不挡：照常受伤");
});

/* ---------- 治愈雾气（生存）、遮风挡雨（环境手） ---------- */
test("治愈雾气：花 1 行动点，所在区域变成治愈场地；每场一次；固有场地改不了，按钮变灰", () => {
  const { c, S } = setup(["longge"]);
  const lg = c.findKit("longge", S.units);
  const xx = weapon(c, lg, "xiaoxiao", 8);
  assert.equal(c.skillRequirementError(xx, "wr_mist"), null);
  cmd(c, { actor: xx.id, skill: "wr_mist" });
  assert.equal(S.fields[1].heal, true);
  assert.equal(xx.ap, 2);
  assert.match(c.skillRequirementError(xx, "wr_mist"), /本场治愈雾气已用完/);
  const two = setup(["longge"]);
  const x2 = weapon(two.c, two.c.findKit("longge", two.S.units), "xiaoxiao", 8);
  two.c.setZoneField(1, "acid", { force: true });
  two.S.fields[1].innate = true;
  assert.match(two.c.skillRequirementError(x2, "wr_mist"), /固有场地/);
  cmd(two.c, { actor: x2.id, skill: "wr_mist" });
  assert.equal(x2.ap, 3, "改不了：没扣点");
  assert.equal(two.S.fields[1].heal, false);
});

test("遮风挡雨：花 1 行动点，所在区域变成隔离区（不受天气影响，原来的场地照旧）；每场一次", () => {
  const { c, S } = setup(["helu", "ruby"]);
  const helu = c.findKit("helu", S.units), ruby = c.findKit("ruby", S.units);
  const ecmo = weapon(c, helu, "ecmo", 8);
  c.setZoneField(1, "fire", { force: true });
  c.setWeather("heat", { force: true });
  assert.equal(c.currentWeatherFor(ruby), "heat");
  cmd(c, { actor: ecmo.id, skill: "wr_canopy" });
  assert.equal(S.fields[1].isolate, true);
  assert.equal(c.fieldFireOn(S.fields[1]), true, "火场照旧");
  assert.equal(c.currentWeatherFor(ruby), "none", "隔离区里不受天气影响");
  assert.equal(ecmo.ap, 2);
  assert.match(c.skillRequirementError(ecmo, "wr_canopy"), /本场遮风挡雨已用完/);
  const two = setup(["helu"]);
  const e2 = weapon(two.c, two.c.findKit("helu", two.S.units), "ecmo", 8);
  two.S.fields[1].isolate = true;
  assert.match(two.c.skillRequirementError(e2, "wr_canopy"), /已经是隔离区/);
});

/* ---------- 禁止通行（控场） ---------- */
function barricadeField() {
  const r = setup(["tou", "ruby"], { zoneMode: 3, enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  const tou = r.c.findKit("tou", r.S.units);
  tou.roles = { primary: "控场", secondary: "坦克" };
  r.foes[0].zone = 2;
  r.mochi = weapon(r.c, tou, "mochi", 8);
  return r;
}
test("禁止通行：选一条畅通的间隔（不限距离），变成无限耐久的墙：挡移动、挡对面的行动、打不动、不当攻击目标", () => {
  const { c, S, foes, mochi } = barricadeField();
  S.gaps["2-3"] = Object.assign(c.emptyGap(), { type: "void" });
  const steps = c.skillFlowSteps("wr_barricade", mochi, {});
  assert.deepEqual(plain(steps.map(s => [s.key, s.type])), [["gap", "choice"]]);
  assert.deepEqual(plain(steps[0].options.map(o => o.value)), ["1-2"], "只列畅通的间隔");
  cmd(c, { actor: mochi.id, skill: "wr_barricade", picks: { gap: "1-2" } });
  const g = S.gaps["1-2"];
  assert.equal(g.type, "wall"); assert.equal(g.infinite, true);
  assert.equal(mochi.ap, 2);
  assert.match(c.lineBlocked(1, 2), /禁止通行的墙挡住/);
  assert.match(c.zoneReachable(foes[0], 1, true) || "", /禁止通行的墙挡住去路/);
  assert.ok(!c.structureTargets(mochi, 0, 1).some(t => t.id === "gap:1-2"), "不当攻击目标");
  const notes = c.hitStructureCore(foes[0], "gap:1-2", { dmg: 99, brk: 9 });
  assert.match(notes.join("\n"), /无限耐久，打不动/);
  assert.equal(S.gaps["1-2"].type, "wall", "打不倒");
  assert.equal(c.gapStateText(g), "禁止通行的墙（无限耐久）");
  assert.match(c.skillRequirementError(mochi, "wr_barricade"), /本场禁止通行已用完/);
});

test("禁止通行：下回合开始时墙消失、间隔恢复畅通；没有畅通的间隔时按钮变灰；分步选了不畅通的在扣点前拦下", () => {
  const { c, S, mochi } = barricadeField();
  cmd(c, { actor: mochi.id, skill: "wr_barricade", picks: { gap: "2-3" } });
  c.endPlayerTurn();
  assert.equal(S.gaps["2-3"].type, "wall", "敌人回合里还在");
  c.endEnemyTurn();
  assert.equal(S.gaps["2-3"].type, "open", "下回合开始：消失");
  assert.ok(!S.gaps["2-3"].infinite && !S.gaps["2-3"].barricade);
  assert.match(S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n"), /禁止通行的墙消失/);
  const two = barricadeField();
  two.S.gaps["1-2"] = Object.assign(two.c.emptyGap(), { type: "wall", hp: 5, maxHp: 5 });
  cmd(two.c, { actor: two.mochi.id, skill: "wr_barricade", picks: { gap: "1-2" } });
  assert.equal(two.mochi.ap, 3, "危墙那条不能封：没扣点");
  assert.equal(two.S.gaps["1-2"].hp, 5);
  two.S.gaps["2-3"] = Object.assign(two.c.emptyGap(), { type: "door", open: true });
  assert.match(two.c.skillRequirementError(two.mochi, "wr_barricade"), /没有畅通/);
});

test("禁止通行：敌人 AI 不去打这堵打不动的墙；主持人改掉这条间隔以主持人的为准", () => {
  const { c, S, foes, mochi } = barricadeField();
  cmd(c, { actor: mochi.id, skill: "wr_barricade", picks: { gap: "1-2" } });
  assert.ok(c.isBarricadeGap(S.gaps["1-2"]), "立起了禁止通行的墙");
  S.combatPhase = "enemy";
  foes[0].ap = 1; foes[0].bonus = 1;
  const plan = c.EnemyAI.plan(foes[0]);
  assert.ok(!plan || !/攻击危墙/.test((plan.meta || {}).skillName || ""), "不去打禁止通行的墙");
  c.Commands.dispatch({ type: "battle.panel", action: "setGap", key: "1-2", kind: "open" });
  assert.ok(!S.gaps["1-2"].infinite && !S.gaps["1-2"].barricade);
});

/* ---------- 创造优势（辅助） ---------- */
test("创造优势：花附赠动作，任意一个单位（敌我都行、不限距离）获得优势；每场两次；已经有优势的不列出", () => {
  const { c, S, foes } = setup(["yuito", "ruby"]);
  const yuito = c.findKit("yuito", S.units), ruby = c.findKit("ruby", S.units);
  const latte = weapon(c, yuito, "latte", 8);
  ruby.zone = 2;
  latte.bonus = 2;
  cmd(c, { actor: latte.id, skill: "wr_advantage", target: ruby.id, picks: { target: ruby.id } });
  assert.equal(ruby.statuses.advantage, true, "不限距离");
  assert.equal(latte.bonus, 1, "花附赠动作");
  assert.equal(latte.ap, 3);
  const units = c.skillFlowSteps("wr_advantage", latte, {})[0].units;
  assert.ok(!units.some(u => u.id === ruby.id) && units.some(u => u.id === foes[0].id), "已经有优势的不列出，敌人也能选");
  cmd(c, { actor: latte.id, skill: "wr_advantage", target: foes[0].id, picks: { target: foes[0].id } });
  assert.equal(foes[0].statuses.advantage, true);
  assert.match(c.skillRequirementError(latte, "wr_advantage"), /本场创造优势已用完（每场 2 次）/);
});

/* ---------- 战斗画面的出手预演：每个技能都算「有效果」（不会把目标 / 按钮变灰） ---------- */
function withGame(c) {
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, "game.js"), "utf8"), c, { filename: "game.js" });
  return c;
}
test("出手预演：八个武器职责技能都有效果；回收清掉目标身上唯一的状态也算（预演写「−震荡」）", () => {
  const { c, S, foes } = setup(["ruby", "nora", "hiaki", "chuan", "longge", "helu", "yuito", "tou"], { zoneMode: 3 });
  withGame(c);
  const kit = k => c.findKit(k, S.units);
  kit("tou").roles = { primary: "控场", secondary: "坦克" };
  const w = { mint: weapon(c, kit("ruby"), "mint"), vitas: weapon(c, kit("nora"), "vitas"), niu: weapon(c, kit("hiaki"), "niu"),
    bili: weapon(c, kit("chuan"), "bili"), xiaoxiao: weapon(c, kit("longge"), "xiaoxiao"), ecmo: weapon(c, kit("helu"), "ecmo"),
    latte: weapon(c, kit("yuito"), "latte"), mochi: weapon(c, kit("tou"), "mochi") };
  const foe = foes[0];
  foe.statuses.shockwave = true; c.syncShockwave(foe, null);
  const pv = (u, id, target, picks) => c.GAME.previewOf(c.GAME.skillThunk(u.id, id, target || null, picks || {}));
  const cases = [[w.mint, "wr_hone"], [w.niu, "wr_weight"], [w.bili, "wr_upright"], [w.xiaoxiao, "wr_mist"], [w.ecmo, "wr_canopy"],
    [w.mochi, "wr_barricade", null, { gap: "2-3" }], [w.latte, "wr_advantage", foe.id, { target: foe.id }], [w.vitas, "wr_recycle", foe.id, { target: foe.id }]];
  cases.forEach(([u, id, target, picks]) => {
    const p = pv(u, id, target, picks);
    assert.equal(p.meaningful, true, id + "：" + p.reason);
    assert.equal(p.needsTarget, false, id + " 不用再另选目标");
  });
  const rec = pv(w.vitas, "wr_recycle", foe.id, { target: foe.id });
  assert.deepEqual(plain(rec.units.get(foe.id).lostStatus), ["震荡"]);
  assert.equal(foe.statuses.shockwave, true, "预演不改任何东西");
});

/* ---------- 升级提示、图鉴、规则说明、武器工坊、联机 ---------- */
test("升级提示：武器升到 8 级，提示里写着学会的武器职责技能（带完整说明）；坦克主职责的没有", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "kolt"], enemies: [], seed: "WRLV" });
  const ruby = c.findKit("ruby", c.S.state.units), kolt = c.findKit("kolt", c.S.state.units);
  c.setOwnedWeaponLevel(ruby, "mint", 7);
  const before = c.LevelUp.snapshot(ruby);
  c.setOwnedWeaponLevel(ruby, "mint", 8);
  const ev = plain(c.LevelUp.note("weapon", ruby, before, { weapon: "明特" }));
  const sk = ev.weapons[0].skills.find(s => s.name === "磨砺");
  assert.ok(sk, JSON.stringify(ev.weapons));
  assert.match(sk.text, /atk \+20/);
  assert.equal(sk.cost, "行动点");
  const kb = c.LevelUp.snapshot(kolt);
  c.setOwnedWeaponLevel(kolt, "torque", 8);
  const kev = plain(c.LevelUp.note("weapon", kolt, kb, { weapon: "扭矩" }));
  assert.ok(!kev.weapons[0].skills.some(s => /重组/.test(s.name)));
  // 角色不在战场上（单局在工匠那里升级、跑团的探索环节）：照这份角色的主职责、羁绊算
  const off = plain(ruby);
  c.S.state.units = [];
  assert.ok(Object.keys(c.LevelUp.snapshot(off).weapons.mint.skills).includes("wr_hone"));
  off.weaponLevels.mint = 6; off.bonds = { mint: 2 };
  assert.ok(Object.keys(c.LevelUp.snapshot(off).weapons.mint.skills).includes("wr_hone"), "6 级 + 羁绊 2");
  off.bonds = {};
  assert.ok(!Object.keys(c.LevelUp.snapshot(off).weapons.mint.skills).includes("wr_hone"));
});

test("角色图鉴、武器工坊：武器人的技能按等级列出武器职责技能（8 级），工坊的等级刻度上也有", () => {
  const c = H.load();
  const ruby = c.codexHeroEntries().find(h => h.kit === "ruby");
  assert.ok(ruby.sheet.weapons[0].skills.all.some(k => k.id === "wr_hone" && k.minLv === 8), "图鉴：明特 8 级磨砺");
  assert.ok(!ruby.sheet.weapons[0].skills.now.some(k => k.id === "wr_hone"), "1 级不展示");
  c.BattleSim.setup({ party: ["ruby", "kolt"], enemies: [], seed: "WRAR" });
  const w = c.SkillText.armoryData().flatMap(h => h.weapons);
  const mint = w.find(x => x.kit === "mint"), torque = w.find(x => x.kit === "torque");
  assert.deepEqual(plain(mint.track.find(t => t.lv === 8)), { lv: 8, text: "武器职责技能「磨砺」", done: false });
  assert.ok(!torque.track.some(t => /武器职责技能/.test(t.text)), "坦克（重组待定）不列");
  // 资料卡（只读）：武器人不在场也照持有者的主职责算
  const r = c.findKit("ruby", c.S.state.units);
  r.weaponLevels.mint = 8;
  const sheet = c.SkillText.heroSheet(r, c.S.state.units);
  assert.ok(sheet.weapons[0].skills.now.some(k => k.id === "wr_hone"));
});

test("规则说明「改装件、羁绊与图纸」：写明 8 级解锁、按主职责、武器人使用，列出每个技能；还没有的职责写在备注里", () => {
  const c = H.load();
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, "rulebook.js"), "utf8"), c, { filename: "rulebook.js" });
  const e = c.rulebookEntries().find(x => x.chapter === "parts");
  const s = e.sections.find(x => x.title === "武器职责技能");
  assert.ok(s, "有这一节");
  assert.match(s.lines.join(""), /武器等级 \+ 羁绊到 8 级解锁一项武器职责技能，和持有者的主职责对应/);
  assert.equal(s.table.rows.length, 8);
  assert.deepEqual(plain(s.table.rows.find(r => r[0] === "辅助").slice(0, 3)), ["辅助", "创造优势", "1 附赠动作"]);
  assert.deepEqual(plain(s.table.rows.find(r => r[0] === "异常").slice(0, 3)), ["异常", "回收", "不花行动"]);
  assert.match(s.note, /坦克的武器职责技能还在确认/);
  assert.ok(e.lines.includes("武器职责技能"), "搜索关键词");
  assert.match(e.blurb, /武器职责技能/);
});

test("联机：玩家收到的间隔带 infinite（禁止通行的墙）；分步名都在白名单里；热座校验分步", () => {
  const { c, S, mochi } = barricadeField();
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, "online-view.js"), "utf8"), c, { filename: "online-view.js" });
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, "hotseat-validation.js"), "utf8"), c, { filename: "hotseat-validation.js" });
  const hotseat = { session: { assertAction() { return true; } }, sender: "p1" };
  const validate = o => c.HotseatValidation.validateBattle(plain(Object.assign({ type: "skill", target: null, picks: {} }, o)), hotseat);
  assert.equal(validate({ actor: mochi.id, skill: "wr_barricade", picks: { gap: "1-2" } }), true);
  assert.throws(() => validate({ actor: mochi.id, skill: "wr_barricade", picks: { gap: "9-9" } }), /分步/);
  assert.throws(() => validate({ actor: mochi.id, skill: "wr_barricade" }), /分步/);
  cmd(c, { actor: mochi.id, skill: "wr_barricade", picks: { gap: "1-2" } });
  const view = plain(c.OnlineView.projectState(S, {}));
  assert.equal(view.gaps["1-2"].type, "wall");
  assert.equal(view.gaps["1-2"].infinite, true);
  ["target", "status", "gap"].forEach(k => assert.ok(c.OnlineView.pickKeys.has(k), k));
  const menu = plain(c.OnlineView.projectActionMenu({ type: "actionOptions", actor: "u0", choices: { kind: "ready", title: "确认执行", options: [],
    command: { type: "skill", actor: "u0", skill: "wr_recycle", target: "u2", picks: { target: "u2", status: "burn" } } } }));
  assert.deepEqual(menu.choices.command.picks, { target: "u2", status: "burn" });
});
