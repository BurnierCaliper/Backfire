// #218（作者 10/21 定）：柯尔特「「非法」改装」废料达到上限时，可以消耗等于上限的废料让我方目标获得 1 行动点；
// 扭矩「拆卸模式」可以把转移量变成废料（单独计算、不受上限，废物利用 / 碎渣重炮 / 「非法」改装都能用）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const { Hotseat } = require("../hotseat");
const plain = x => JSON.parse(JSON.stringify(x));
const sum = o => Object.values(o || {}).reduce((s, v) => s + (Number(v) || 0), 0);
const armorOf = u => u.layers.filter(l => l.type === "armor").reduce((s, l) => s + l.current, 0);

/** 柯尔特（11 级，电钻）和 Helumica 在 1 区；1 区一个敌人（外层厚装甲），3 区一个敌人（距离 2，「非法」改装够不到） */
function setup() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 3 }], seed: "I218", zoneMode: 3 });
  c.startCombat();
  const S = c.S.state;
  const kolt = c.findKit("kolt", S.units), helu = c.findKit("helu", S.units);
  const [foe, far] = S.units.filter(u => !u.isPlayer);
  kolt.zone = helu.zone = foe.zone = 1; far.zone = 3;
  kolt.level = 11; kolt.ap = 3; kolt.bonus = 3; kolt.resources.bit = "drill";
  kolt.layers = [{ type: "flesh", current: 100, max: 100, inner: true }];   // 生命上限 100：废料上限 50
  helu.ap = helu.apMax = 1; helu.bonus = 1;
  [foe, far].forEach(f => { f.layers = [{ type: "armor", current: 500, max: 500 }, { type: "flesh", current: 500, max: 500, inner: true }]; });
  kolt.resources.scrapStore = {}; kolt.resources.rotStore = {}; kolt.resources.divertArmor = 0; kolt.resources.stripStore = {};
  const cap = Math.floor(c.baseMaxHp(kolt) * 0.5);
  assert.equal(cap, 50, "废料上限 = 柯尔特生命上限的一半");
  const use = (actor, skill, target, picks) => c.Commands.dispatch(plain({ type: "skill", actor: actor.id, skill, target: target ? target.id : null, picks: picks || {} }));
  const logs = () => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
  return { c, S, kolt, helu, foe, far, cap, use, logs };
}
/** 唤出扭矩（2 级，同在 1 区） */
function withTorque(f) {
  const torque = f.c.spawnWeapon(f.kolt, "torque");
  torque.zone = 1; torque.level = 2; torque.ap = 3; torque.bonus = 3;
  return torque;
}

test("配置表：废料上限是生命上限的 0.5、给 1 行动点、扣废料的顺序都放在 KOLT_SCRAP", () => {
  const { c, kolt, cap } = setup();
  const cfg = plain(vm.runInContext("KOLT_SCRAP", c));
  assert.equal(cfg.capPct, 0.5);
  assert.equal(cfg.modAp, 1);
  assert.deepEqual(cfg.spendOrder, ["layer", "rot", "divert", "strip"]);
  assert.equal(c.koltScrapCap(kolt), cap);
});

test("「非法」改装：废料达到上限、目标是我方单位时多一步；选「过载 + 消耗废料」扣掉等于上限的废料，目标过载、行动点 +1", () => {
  const { c, kolt, helu, foe, far, cap, use, logs } = setup();
  kolt.resources.scrapStore = { armor: cap * 3 };   // 敌人血量层累积的废料：算进合计时封顶，正好等于上限
  assert.equal(c.koltScrapTotal(kolt), cap);
  const steps = c.skillFlowSteps("kolt_mod", kolt, {});
  assert.deepEqual(plain(steps.map(s => s.key)), ["target"], "先选目标");
  const ids = steps[0].units.map(u => u.id);
  for (const u of [kolt, helu, foe]) assert.ok(ids.includes(u.id), "1 距离以内任意单位（含自己）：" + u.name);
  assert.ok(!ids.includes(far.id), "距离 2 的够不到");
  const mode = c.skillFlowSteps("kolt_mod", kolt, { target: helu.id }).find(s => s.key === "mode");
  assert.ok(mode && mode.type === "choice" && !mode.optional, "目标是我方单位：选只过载还是再消耗废料");
  assert.deepEqual(plain(mode.options.map(o => o.value)), ["overload", "ap"]);

  use(kolt, "kolt_mod", helu, { target: helu.id, mode: "ap" });
  assert.ok(helu.instant && helu.instant.overload, "照样施加过载");
  assert.equal(helu.ap, 2, "行动点 +1");
  assert.deepEqual(plain(kolt.resources.scrapStore), { armor: cap * 2 }, "只扣掉等于上限的废料，累积的其余部分留着");
  assert.equal(c.koltScrapTotal(kolt), cap, "剩下的算进合计时照样封顶");
  assert.equal(kolt.ap, 2, "「非法」改装本身照常花 1 行动点");
  assert.equal(plain(helu.resources.apGifts)[0].from, kolt.id, "和意式浓缩一样记成队友给的行动点");
  assert.match(logs(), new RegExp(`消耗 ${cap} 废料`));
});

test("「非法」改装：废料达到上限也可以只施加过载，废料和行动点都不动", () => {
  const { c, kolt, helu, cap, use } = setup();
  kolt.resources.scrapStore = { armor: cap };
  assert.ok(c.skillFlowSteps("kolt_mod", kolt, { target: helu.id }).some(s => s.key === "mode"), "有得选");
  use(kolt, "kolt_mod", helu, { target: helu.id, mode: "overload" });
  assert.ok(helu.instant && helu.instant.overload);
  assert.equal(helu.ap, 1);
  assert.equal(c.koltScrapTotal(kolt), cap);
  assert.equal(kolt.ap, 2);
});

test("「非法」改装：废料没达到上限（差 1 点）没有这一步，硬要消耗也会被拦下、不花行动点；普通用法照旧", () => {
  const { c, kolt, helu, cap, use } = setup();
  kolt.resources.rotStore = { flesh: cap - 1 };
  assert.equal(c.koltScrapTotal(kolt), cap - 1);
  assert.deepEqual(plain(c.skillFlowSteps("kolt_mod", kolt, {})), [], "没到上限：照旧直接选目标");
  assert.ok(!c.skillFlowSteps("kolt_mod", kolt, { target: helu.id }).some(s => s.key === "mode"));
  use(kolt, "kolt_mod", helu, { target: helu.id, mode: "ap" });
  assert.equal(kolt.ap, 3, "被拦下：不花行动点");
  assert.equal(helu.ap, 1);
  assert.ok(!(helu.instant && helu.instant.overload), "整个技能没有结算");
  assert.equal(c.koltScrapTotal(kolt), cap - 1, "废料不动");
  use(kolt, "kolt_mod", helu);
  assert.ok(helu.instant && helu.instant.overload, "照旧施加过载");
  assert.equal(kolt.ap, 2);
  assert.equal(helu.ap, 1);
});

test("「非法」改装：所有来源合计达到上限就算（腐坏抛射 + 转移注意 + 拆卸模式，不用敌人血量层）", () => {
  const { c, kolt, helu, cap } = setup();
  kolt.resources.rotStore = { flesh: 5 };
  kolt.resources.divertArmor = 5;
  kolt.resources.stripStore = { armor: cap - 11 };
  assert.equal(c.koltScrapTotal(kolt), cap - 1);
  assert.ok(!c.skillFlowSteps("kolt_mod", kolt, { target: helu.id }).some(s => s.key === "mode"));
  kolt.resources.stripStore = { armor: cap - 10 };
  assert.equal(c.koltScrapTotal(kolt), cap);
  assert.ok(c.skillFlowSteps("kolt_mod", kolt, { target: helu.id }).some(s => s.key === "mode"));
});

test("「非法」改装：目标是敌人时没有这个选项（施加过载照旧，不扣废料）；硬塞也会被拦下", () => {
  const { c, kolt, helu, foe, cap, use } = setup();
  kolt.resources.scrapStore = { armor: cap };
  assert.deepEqual(plain(c.skillFlowSteps("kolt_mod", kolt, { target: foe.id }).map(s => s.key)), ["target"], "敌人：没有消耗废料这一步");
  assert.ok(c.skillFlowSteps("kolt_mod", kolt, { target: helu.id }).some(s => s.key === "mode"), "同样的废料，我方单位就有");
  const fap = foe.ap;
  use(kolt, "kolt_mod", foe, { target: foe.id, mode: "ap" });
  assert.equal(kolt.ap, 3, "被拦下：不花行动点");
  assert.equal(c.koltScrapTotal(kolt), cap);
  use(kolt, "kolt_mod", foe, { target: foe.id });
  assert.ok(foe.instant && foe.instant.overload, "照旧施加过载");
  assert.equal(c.koltScrapTotal(kolt), cap, "不扣废料");
  assert.equal(foe.ap, fap, "敌人行动点不变");
  assert.equal(kolt.ap, 2);
});

test("「非法」改装扣废料：敌人血量层按封顶后的数算，先扣它；只扣上限那么多，后面的来源原样留着", () => {
  const { c, kolt, helu, cap, use } = setup();
  kolt.resources.scrapStore = { armor: cap * 2 };   // 算进合计时封顶为上限：它就够扣
  kolt.resources.rotStore = { flesh: 4 };
  kolt.resources.divertArmor = 3;
  kolt.resources.stripStore = { armor: 2 };
  assert.equal(c.koltScrapTotal(kolt), cap + 9);
  use(kolt, "kolt_mod", helu, { target: helu.id, mode: "ap" });
  assert.deepEqual(plain(kolt.resources.scrapStore), { armor: cap }, "敌人血量层只扣上限那么多，累积的其余部分留着");
  assert.deepEqual(plain(kolt.resources.rotStore), { flesh: 4 });
  assert.equal(kolt.resources.divertArmor, 3);
  assert.deepEqual(plain(kolt.resources.stripStore), { armor: 2 });
  assert.equal(c.koltScrapTotal(kolt), cap + 9);
  assert.equal(helu.ap, 2);
});

test("「非法」改装扣废料：敌人血量层 → 腐坏抛射 → 转移注意 → 拆卸模式，扣完的清零，没扣完的留着", () => {
  const { c, kolt, helu, cap, use } = setup();
  kolt.resources.scrapStore = { flesh: 5 };
  kolt.resources.rotStore = { flesh: 3, armor: 4 };
  kolt.resources.divertArmor = cap - 10;   // 前两种一共 12：转移注意扣 cap − 12，剩 2
  kolt.resources.stripStore = { shield: 6 };
  assert.equal(c.koltScrapTotal(kolt), cap + 8);
  use(kolt, "kolt_mod", helu, { target: helu.id, mode: "ap" });
  assert.equal(sum(kolt.resources.scrapStore), 0, "敌人血量层清零");
  assert.equal(sum(kolt.resources.rotStore), 0, "腐坏抛射清零");
  assert.equal(kolt.resources.divertArmor, 2, "转移注意没扣完的留着");
  assert.deepEqual(plain(kolt.resources.stripStore), { shield: 6 }, "拆卸模式的废料最后扣：这次没动");
  assert.equal(c.koltScrapTotal(kolt), 8);
  // 只剩拆卸模式的废料、够上限：从它里面扣
  helu.ap = 1; kolt.ap = 3;
  kolt.resources.scrapStore = {}; kolt.resources.rotStore = {}; kolt.resources.divertArmor = 0;
  kolt.resources.stripStore = { armor: cap + 5 };
  use(kolt, "kolt_mod", helu, { target: helu.id, mode: "ap" });
  assert.deepEqual(plain(kolt.resources.stripStore), { armor: 5 });
  assert.equal(helu.ap, 2);
});

test("「非法」改装：行动点可以超过上限（满了也 +1）；对自己用也行", () => {
  const { c, kolt, helu, cap, use } = setup();
  helu.ap = helu.apMax = 1;
  kolt.resources.scrapStore = { armor: cap };
  use(kolt, "kolt_mod", helu, { target: helu.id, mode: "ap" });
  assert.equal(helu.ap, 2, "原本行动点是满的，照样 +1");
  // 对自己：花 1 行动点，再拿回 1 行动点
  kolt.ap = kolt.apMax = 1;
  kolt.resources.rotStore = { flesh: cap };
  assert.ok(c.skillFlowSteps("kolt_mod", kolt, { target: kolt.id }).some(s => s.key === "mode"));
  use(kolt, "kolt_mod", kolt, { target: kolt.id, mode: "ap" });
  assert.equal(kolt.ap, 1);
  assert.ok(kolt.instant && kolt.instant.overload);
  assert.equal(c.koltScrapTotal(kolt), 0);
});

test("拆卸模式：多一个选择——转移量给同区友方，或者变成废料；选废料就不用选接收的友方", () => {
  const f = setup();
  const { c, kolt, helu, foe, use } = f;
  const torque = withTorque(f);
  const keys = p => plain(c.skillFlowSteps("torque_strip", torque, p).map(s => s.key));
  assert.deepEqual(keys({}), ["target", "mode", "ally"]);
  const mode = c.skillFlowSteps("torque_strip", torque, { target: foe.id }).find(s => s.key === "mode");
  assert.deepEqual(plain(mode.options.map(o => o.value)), ["ally", "scrap"]);
  assert.deepEqual(keys({ target: foe.id, mode: "ally" }), ["target", "mode", "ally"]);
  assert.deepEqual(keys({ target: foe.id, mode: "scrap" }), ["target", "mode"], "选废料：没有选友方这一步");
  // 给友方：和以前一样
  const a0 = armorOf(helu);
  use(torque, "torque_strip", helu, { target: foe.id, mode: "ally", ally: helu.id });
  const got = 500 - foe.layers[0].current;
  assert.ok(got > 0);
  assert.equal(armorOf(helu) - a0, got, "转给了 Helumica");
  assert.equal(sum(kolt.resources.stripStore), 0, "没有变成废料");
});

test("拆卸模式选废料：单独计算、不受上限，算进废料合计，碎渣重炮装填时一起打出去", () => {
  const f = setup();
  const { c, kolt, helu, foe, cap, use, logs } = f;
  const torque = withTorque(f);
  kolt.resources.scrapStore = { armor: cap * 3 };   // 敌人血量层的废料已经在上限
  const h0 = armorOf(helu), k0 = armorOf(kolt);
  use(torque, "torque_strip", foe, { target: foe.id, mode: "scrap" });
  const got = 500 - foe.layers[0].current;
  assert.ok(got > 0, "照样拆下外层血量");
  assert.deepEqual(plain(kolt.resources.stripStore), { armor: got }, "按那一层的种类记成柯尔特的废料");
  assert.equal(c.koltScrapTotal(kolt), cap + got, "不受上限");
  assert.equal(armorOf(helu), h0, "没有转给友方");
  assert.equal(armorOf(kolt), k0, "也没有直接加到柯尔特身上");
  assert.equal(torque.ap, 2);
  // 碎渣重炮：扭矩收回柯尔特手里，再把全部废料装填打出去
  c.returnWeapon(torque);
  kolt.ap = 3;
  use(kolt, "kolt_cannon", null, { dest: 1 });
  assert.match(logs(), new RegExp(`装填 ${cap + got} 点废料`));
  assert.equal(c.koltScrapTotal(kolt), 0);
  assert.equal(sum(kolt.resources.stripStore), 0, "koltScrapClear 一起清掉");
});

test("拆卸模式选废料：废物利用按那一层的种类领取（不受 50% 限制），用过就清空", () => {
  const f = setup();
  const { c, kolt, foe, cap, use } = f;
  const torque = withTorque(f);
  use(torque, "torque_strip", foe, { target: foe.id, mode: "scrap" });
  const got = 500 - foe.layers[0].current;
  assert.ok(got > 0);
  c.returnWeapon(torque);   // 扭矩收回柯尔特手里（唤出时柯尔特空手，用不了废物利用）
  assert.equal(sum(kolt.resources.scrapStore), 0, "没有敌人血量层的废料");
  assert.equal(c.skillRequirementError(kolt, "kolt_scrap"), null, "只有拆卸模式的废料也能用废物利用");
  const a0 = armorOf(kolt);
  use(kolt, "kolt_scrap");
  assert.equal(armorOf(kolt) - a0, got, "领到等量的装甲");
  assert.equal(sum(kolt.resources.stripStore), 0);
  assert.ok(c.skillRequirementError(kolt, "kolt_scrap"), "领完就没有了");
  // 超过生命上限一半也照领
  kolt.ap = 3;
  kolt.resources.stripStore = { armor: cap * 2 };
  const a1 = armorOf(kolt);
  use(kolt, "kolt_scrap");
  assert.equal(armorOf(kolt) - a1, cap * 2);
});

test("拆卸模式的废料每场重新记；koltScrapClear 清掉", () => {
  const { c, kolt } = setup();
  kolt.resources.stripStore = { armor: 7 };
  c.koltScrapClear(kolt);
  assert.equal(sum(kolt.resources.stripStore), 0);
  kolt.resources.stripStore = { armor: 7 };
  c.resetBattleFlags(kolt);
  assert.equal(sum(kolt.resources.stripStore), 0);
});

/* ---------- 联机：新的分步选择玩家端也能选（房主的动作菜单 / 权威校验） ---------- */
function online() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], zoneMode: 3, seed: "I218-ONLINE" });
  c.startCombat();
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  for (const file of ["game.js", "hotseat-validation.js", "online-view.js", "online-actions.js", "hud-icons.js"]) vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file });
  const state = c.S.state, kolt = state.units.find(u => u.kit === "kolt"), helu = state.units.find(u => u.kit === "helu"), enemy = state.units.find(u => !u.isPlayer);
  kolt.zone = helu.zone = 1; enemy.zone = 1;
  kolt.level = 11; kolt.resources.bit = "drill";
  kolt.ap = kolt.apMax = 4; kolt.bonus = kolt.bonusMax = 4; helu.ap = helu.apMax = 1;
  enemy.layers = [{ type: "armor", current: 500, max: 500 }, { type: "flesh", current: 500, max: 500, inner: true }];
  const session = Hotseat.create({ operators: ["p1", "p2"], gmId: "p1", assignments: { [kolt.id]: "p1", [helu.id]: "p2" }, getUnits: () => state.units, canStand: u => !c.standUpBlocked(u) });
  session.beginRound(1); session.pick("p1", kolt.id, 0); session.pick("p2", helu.id, 1); session.forceStart("p1");
  const service = c.OnlineActions.create({ game: c.GAME, validation: c.HotseatValidation, inspect: c.HotseatValidation.inspect,
    assertAction: (sender, id) => session.assertAction(sender, id), getState: () => state });
  const menu = (actor, request) => plain(service.menu(Object.assign({ requestId: 1, actor: actor.id }, request), "p1"));
  const validate = command => c.HotseatValidation.validateBattle(command, { session, sender: "p1" });
  return { c, state, kolt, helu, enemy, session, menu, validate };
}

test("联机：「非法」改装废料达到上限时，玩家端按「目标 → 过载 / 过载 + 消耗废料」一步步选；没到上限不能夹带", () => {
  const f = online();
  const { c, state, kolt, helu, enemy, menu, validate } = f;
  const cap = c.koltScrapCap(kolt);
  // 敌人血量层累积的废料正好到上限。用规则自己的函数记（废料对象建在规则环境里）：房主菜单会先预演一遍技能，
  // 预演的快照（game.js · deepClone）只复制规则环境里的普通对象，测试这边直接写的对象会被预演里扣废料改掉
  c.koltScrapAdd("armor", cap);
  const first = menu(kolt, { skill: "kolt_mod" });
  assert.equal(first.choices.kind, "unit"); assert.equal(first.choices.key, "target");
  assert.ok(first.choices.options.some(o => o.value === helu.id) && first.choices.options.some(o => o.value === enemy.id));
  const mode = menu(kolt, { skill: "kolt_mod", picks: { target: helu.id } });
  assert.equal(mode.choices.kind, "choice"); assert.equal(mode.choices.key, "mode");
  assert.deepEqual(mode.choices.options.map(o => o.value), ["overload", "ap"]);
  const ready = menu(kolt, { skill: "kolt_mod", picks: { target: helu.id, mode: "ap" } });
  assert.equal(ready.choices.kind, "ready");
  assert.deepEqual(ready.choices.command, { type: "skill", actor: kolt.id, skill: "kolt_mod", target: helu.id, picks: { target: helu.id, mode: "ap" } });
  const foeReady = menu(kolt, { skill: "kolt_mod", picks: { target: enemy.id } });
  assert.equal(foeReady.choices.kind, "ready", "敌人：选完目标就能执行，没有消耗废料这一步");
  assert.throws(() => menu(kolt, { skill: "kolt_mod", picks: { target: enemy.id, mode: "ap" } }), /未提供|分步/);
  // 执行房主确认过的命令
  c.Commands.dispatch(ready.choices.command);
  assert.equal(helu.ap, 2);
  assert.equal(c.koltScrapTotal(kolt), 0);
  // 没到上限：消耗废料这一步不存在，夹带进来也过不了校验
  kolt.ap = 4;
  assert.throws(() => validate({ type: "skill", actor: kolt.id, skill: "kolt_mod", target: helu.id, picks: { target: helu.id, mode: "ap" } }), /未提供|分步/);
});

test("联机：拆卸模式玩家端可以选「变成废料」（不用选友方），选友方照旧；废料合计按白名单显示在柯尔特的仪表上", () => {
  const f = online();
  const { c, state, kolt, helu, enemy, session, menu, validate } = f;
  const torque = c.spawnWeapon(kolt, "torque"); torque.zone = 1; torque.level = 2; torque.ap = 2; torque.bonus = 2;
  session.reconcile();   // 召唤出的武器人插在本人前面，立刻轮到它
  assert.equal(session.snapshot().currentUnitId, torque.id);
  const mode = menu(torque, { skill: "torque_strip", picks: { target: enemy.id } });
  assert.equal(mode.choices.kind, "choice"); assert.equal(mode.choices.key, "mode");
  assert.deepEqual(mode.choices.options.map(o => o.value), ["ally", "scrap"]);
  const ally = menu(torque, { skill: "torque_strip", picks: { target: enemy.id, mode: "ally" } });
  assert.equal(ally.choices.kind, "unit"); assert.equal(ally.choices.key, "ally");
  assert.ok(ally.choices.options.some(o => o.value === helu.id));
  assert.equal(validate({ type: "skill", actor: torque.id, skill: "torque_strip", target: helu.id, picks: { target: enemy.id, mode: "ally", ally: helu.id } }), true);
  const ready = menu(torque, { skill: "torque_strip", picks: { target: enemy.id, mode: "scrap" } });
  assert.equal(ready.choices.kind, "ready");
  assert.deepEqual(ready.choices.command, { type: "skill", actor: torque.id, skill: "torque_strip", target: enemy.id, picks: { target: enemy.id, mode: "scrap" } });
  c.Commands.dispatch(ready.choices.command);
  const got = 500 - enemy.layers[0].current;
  assert.ok(got > 0);
  assert.equal(c.koltScrapTotal(kolt), got);
  const view = plain(c.OnlineView.projectState(state, {}));
  const k = view.units.find(u => u.id === kolt.id);
  assert.equal(k.hud.scrap, got, "仪表上的废料合计算上拆卸模式的废料");
  assert.match(k.display.res, new RegExp(`废料 ${got}`));
  assert.equal(k.resources.stripStore, undefined, "各来源的明细不下发");
  assert.doesNotMatch(JSON.stringify(view).replace(/"upOnShp":(true|false),?/g, ""), /坚毅|shp/i);
});
