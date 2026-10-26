// 目盲（通用状态，#405）：攻击有 25% 概率落空；被格挡下来的概率 +25%；落空一次或者被格挡下来一次后解除。
// 数值在 engine.js · BLIND；规则在 effects.js（blindRollApplies / blindRoll / clearBlind / blindBlockBonus / blindOnBlocked），
// app.js · dealToInner 出手时掷落空骰，finalBlockChance 加格挡率，performAssistBlock / tryOxAutoBlock / 以身作盾挡下以后解除
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");

/** 一场摆好的战斗：默认柯尔特 + Helumica 对两个匕首狂徒，已开战，全员在 1 区 */
function field(party, enemies) {
  const c = H.load();
  c.BattleSim.setup({ party: party || ["kolt", "helu"], enemies: enemies || [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }], seed: "BLIND" });
  c.startCombat();
  const st = c.S.state;
  st.units.forEach(u => { u.zone = 1; if (u.kit === "kolt") u.prideMaxHp = Infinity; });   // 关掉柯尔特「过度自信」，免得它干扰伤害和击破
  const kit = k => st.units.find(u => u.kit === k && !u.dead);
  const foes = st.units.filter(u => !u.isPlayer);
  return { c, st, kit, foe: foes[0], foe2: foes[1] };
}
const tank = u => u.layers.forEach(l => { l.max = 999; l.current = 999; });
const logs = st => st.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
/** 让 d100（1 + floor(random × 100)）掷出这个点数 */
const r = d100 => (d100 - 1) / 100 + 0.001;
/** Math.random 依次返回这几颗 d100，用完以后一直是 rest */
function dice(c, list, rest) {
  const q = [].concat(list).map(r);
  c.Math.random = () => (q.length ? q.shift() : r(rest == null ? 50 : rest));
}
const attack = (c, a, t, flags, extra) => c.dealTo(a, t, Object.assign({ atk: 10, mult: 1, element: "physical", baseBreak: 2, atkRange: "any", flags: Object.assign({ action: true }, flags || {}) }, extra || {}));
const BLIND = c => vm.runInContext("BLIND", c);

test("数值放在 engine.js · BLIND：落空率 25%、被格挡概率 +25%、范围攻击不落空", () => {
  const { c } = field();
  const B = BLIND(c);
  assert.equal(B.missPct, 25);
  assert.equal(B.blockPct, 25);
  assert.equal(B.aoe, false);
});

test("目盲的攻击：d100 ≤ 25 落空——没有伤害、没有击破，目盲解除；日志写出落空骰", () => {
  const { c, st, kit, foe } = field();
  const kolt = kit("kolt");
  kolt.statuses.blind = true;
  tank(foe);
  const hp0 = c.totalHp(foe), def0 = foe.def;
  dice(c, 25);
  const out = attack(c, kolt, foe);
  assert.equal(out.res.ok, false);
  assert.equal(out.res.missed, true);
  assert.equal(c.totalHp(foe), hp0, "没有伤害");
  assert.equal(foe.def, def0, "没有击破");
  assert.equal(kolt.statuses.blind, false, "落空一次就解除");
  const text = logs(st);
  assert.match(text, /柯尔特 目盲：d100=25（落空率 25%）→ 对 .+ 的攻击落空/);
  assert.match(text, /柯尔特 攻击落空，目盲解除/);
});

test("目盲的攻击：d100 > 25 照常命中，目盲留着（没落空、也没被格挡）；没目盲不掷落空骰", () => {
  const { c, st, kit, foe, foe2 } = field();
  const kolt = kit("kolt");
  kolt.statuses.blind = true;
  tank(foe); tank(foe2);
  const hp0 = c.totalHp(foe);
  dice(c, 26);
  const out = attack(c, kolt, foe);
  assert.notEqual(out.res.ok, false);
  assert.ok(c.totalHp(foe) < hp0, "打中了");
  assert.equal(kolt.statuses.blind, true, "目盲还在");
  assert.match(logs(st), /柯尔特 目盲：d100=26（落空率 25%）→ 没有落空/);
  // 没有目盲：不掷落空骰，也不写目盲
  kolt.statuses.blind = false;
  const before = logs(st);
  const hp2 = c.totalHp(foe2);
  dice(c, 1);
  attack(c, kolt, foe2);
  assert.ok(c.totalHp(foe2) < hp2);
  assert.doesNotMatch(logs(st).slice(before.length), /目盲/);
});

test("落空率读配置：BLIND.missPct 改成 50，d100=50 也落空", () => {
  const { c, kit, foe } = field();
  const kolt = kit("kolt");
  vm.runInContext("BLIND.missPct = 50", c);
  kolt.statuses.blind = true;
  tank(foe);
  const hp0 = c.totalHp(foe);
  dice(c, 50);
  attack(c, kolt, foe);
  assert.equal(c.totalHp(foe), hp0);
  assert.equal(kolt.statuses.blind, false);
});

test("被格挡下来的概率 +25%：替我方挡目盲的敌人、敌人自动格挡目盲的我方都算；加完再按 5%–100% 封顶", () => {
  const { c, kit, foe } = field(["kolt", "helu", "chuan"]);
  const kolt = kit("kolt"), helu = kit("helu"), chuan = kit("chuan");
  const h0 = c.finalBlockChance(helu, foe, kolt), c0 = c.finalBlockChance(chuan, foe, kolt);
  assert.ok(h0 + 25 <= 100 && c0 + 25 > 100, "Helumica 加完不到上限，川川加完超过上限");
  foe.statuses.blind = true;
  assert.equal(c.finalBlockChance(helu, foe, kolt), h0 + 25);
  assert.equal(c.finalBlockChance(chuan, foe, kolt), 100, "封顶 100%");
  // 敌人（警卫队队长·牛）自动格挡目盲的柯尔特：也 +25%
  const g = field(["kolt", "helu"], [{ id: "captain_ox", lv: 1, zone: 1 }, { id: "guard_sword", lv: 1, zone: 1 }]);
  const ox = g.kit("captain_ox"), guard = g.kit("guard_sword"), k2 = g.kit("kolt");
  const o0 = g.c.finalBlockChance(ox, k2, guard);
  k2.statuses.blind = true;
  assert.equal(g.c.finalBlockChance(ox, k2, guard), Math.min(100, o0 + 25));
  // 读配置
  vm.runInContext("BLIND.blockPct = 10", g.c);
  assert.equal(g.c.finalBlockChance(ox, k2, guard), Math.min(100, o0 + 10));
});

/** 目盲的狂徒打柯尔特（Helumica 能协助格挡）；d100 是落空骰 */
function blindFoeHitsKolt(d100) {
  const f = field();
  const kolt = f.kit("kolt"), helu = f.kit("helu");
  f.st.combatPhase = "enemy";
  helu.bonus = 1;
  tank(kolt);
  f.foe.statuses.blind = true;
  dice(f.c, d100);
  const hp0 = f.c.totalHp(kolt);
  attack(f.c, f.foe, kolt, {}, { baseBreak: 1 });
  return Object.assign(f, { kolt, helu, hp0 });
}

test("落空的攻击不进协助格挡：不弹格挡、不花附赠动作，柯尔特不受伤；目盲解除", () => {
  const { c, st, kolt, helu, foe, hp0 } = blindFoeHitsKolt(10);
  assert.equal((st.blockQueue || []).length, 0, "没有等格挡的那一击");
  assert.equal(c.totalHp(kolt), hp0);
  assert.equal(helu.bonus, 1, "没人花附赠动作");
  assert.equal(foe.statuses.blind, false);
});

test("被协助格挡下来以后目盲解除：拿武器挡住、空手挡住都算；没挡住目盲留着", () => {
  // 拿武器挡住：柯尔特免伤，目盲解除
  let f = blindFoeHitsKolt(60);
  assert.equal(f.st.blockQueue.length, 1, "没落空：等格挡");
  assert.match(f.c.eligibleBlockers(f.kolt).map(h => h.name + " " + f.c.finalBlockChance(h, f.foe, f.kolt) + "%").join(), /Helumica/);
  f.c.finishBlock(f.helu.id, { roll: 1, ok: true, chance: 99 });
  assert.equal(f.c.totalHp(f.kolt), f.hp0, "挡住了");
  assert.equal(f.foe.statuses.blind, false, "被格挡下来：目盲解除");
  assert.match(logs(f.st), /狂徒（匕首） 的攻击被格挡下来，目盲解除/);
  // 空手挡住：柯尔特照样受一半伤害，目盲也解除
  f = blindFoeHitsKolt(60);
  f.helu.weaponHeld = false;
  f.c.finishBlock(f.helu.id, { roll: 1, ok: true, chance: 99 });
  assert.ok(f.c.totalHp(f.kolt) < f.hp0, "空手挡住只免一半");
  assert.equal(f.foe.statuses.blind, false, "空手挡住也算被格挡下来");
  // 没挡住：照常受伤，目盲留着
  f = blindFoeHitsKolt(60);
  f.c.finishBlock(f.helu.id, { roll: 99, ok: false, chance: 1 });
  assert.equal(f.st.blockQueue.length, 0);
  assert.ok(f.c.totalHp(f.kolt) < f.hp0);
  assert.equal(f.foe.statuses.blind, true, "没挡住：目盲还在");
});

test("等格挡结果的那一击落下时不再掷落空骰（出手时已经掷过）", () => {
  const { c, st, kolt, foe, hp0 } = blindFoeHitsKolt(60);
  assert.equal(st.blockQueue.length, 1);
  dice(c, 1);                         // 这时候再掷就会落空
  c.finishBlock(null);                // 没人格挡
  assert.ok(c.totalHp(kolt) < hp0, "照常落下");
  assert.equal(foe.statuses.blind, true, "没落空、也没被格挡：目盲留着");
  assert.equal((logs(st).match(/目盲：d100=/g) || []).length, 1, "只掷了一次");
});

test("敌人自动格挡（警卫队队长·牛）挡下目盲的柯尔特：目盲解除；先掷落空骰，再掷格挡骰", () => {
  const { c, st, kit } = field(["kolt", "helu"], [{ id: "captain_ox", lv: 1, zone: 1 }, { id: "guard_sword", lv: 1, zone: 1 }]);
  const kolt = kit("kolt"), guard = kit("guard_sword");
  kolt.statuses.blind = true;
  const hp0 = c.totalHp(guard);
  dice(c, [60, 1]);                   // 落空骰 60（没落空），格挡骰 1（挡住）
  attack(c, kolt, guard);
  assert.equal(c.totalHp(guard), hp0, "被牛挡下");
  assert.equal(kolt.statuses.blind, false);
  const text = logs(st);
  assert.ok(text.indexOf("目盲：d100=60") >= 0 && text.indexOf("目盲：d100=60") < text.indexOf("自动协助格挡"), "落空骰在格挡骰前面");
  assert.match(text, /柯尔特 的攻击被格挡下来，目盲解除/);
  // 落空了就不用挡：牛不掷格挡骰
  const g = field(["kolt", "helu"], [{ id: "captain_ox", lv: 1, zone: 1 }, { id: "guard_sword", lv: 1, zone: 1 }]);
  g.kit("kolt").statuses.blind = true;
  dice(g.c, [5, 1]);
  attack(g.c, g.kit("kolt"), g.kit("guard_sword"));
  assert.doesNotMatch(logs(g.st), /自动协助格挡/);
});

test("以身作盾（专长）宣布挡下目盲的敌人：算被格挡下来，目盲解除", () => {
  const f = blindFoeHitsKolt(60);
  assert.equal(f.st.blockQueue.length, 1);
  // 直接把 Helumica 当成能宣布以身作盾的人（专长的条件另有测试）
  vm.runInContext("featIronwallDeclarers = () => [unitById(" + JSON.stringify(f.helu.id) + ")]; featUseOnce = () => true;", f.c);
  f.c.finishBlock("ironwall:" + f.helu.id);
  assert.equal(f.c.totalHp(f.kolt), f.hp0);
  assert.equal(f.foe.statuses.blind, false);
});

test("范围攻击不会落空（BLIND.aoe 打开才会）；环境伤害、首领机制、导体跳到的那一下、借刺入的针出手都不掷", () => {
  const { c, kit, foe } = field();
  const kolt = kit("kolt");
  tank(foe);
  kolt.statuses.blind = true;
  const cases = [{ aoe: true }, { environment: true }, { locked: true, mechId: "m1" }, { conductorExtra: true, blockResolved: true }, { viaPierce: true }];
  cases.forEach(fl => {
    const hp0 = c.totalHp(foe);
    dice(c, 1);
    attack(c, kolt, foe, fl);
    assert.ok(c.totalHp(foe) < hp0, JSON.stringify(fl) + " 照常打中");
    assert.equal(kolt.statuses.blind, true, JSON.stringify(fl) + " 不掷落空骰");
  });
  vm.runInContext("BLIND.aoe = true", c);
  const hp1 = c.totalHp(foe);
  dice(c, 1);
  attack(c, kolt, foe, { aoe: true });
  assert.equal(c.totalHp(foe), hp1, "打开以后范围攻击也会落空");
  assert.equal(kolt.statuses.blind, false);
});

test("协助攻击、借机攻击也是攻击：一样会落空", () => {
  ["assist", "opportunity"].forEach(k => {
    const { c, kit, foe } = field();
    const kolt = kit("kolt");
    tank(foe);
    kolt.statuses.blind = true;
    const hp0 = c.totalHp(foe);
    dice(c, 1);
    attack(c, kolt, foe, { [k]: true });
    assert.equal(c.totalHp(foe), hp0, k);
    assert.equal(kolt.statuses.blind, false, k);
  });
});

test("打不出去的攻击不掷落空骰：目标躲藏、射程不够、隔着危墙，目盲都留着", () => {
  const { c, st, kit, foe } = field();
  const kolt = kit("kolt");
  kolt.statuses.blind = true;
  dice(c, 1);
  foe.statuses.hide = true;
  attack(c, kolt, foe);
  assert.equal(kolt.statuses.blind, true, "躲藏");
  foe.statuses.hide = false;
  attack(c, kolt, foe, {}, { atkRange: "ranged" });
  assert.equal(kolt.statuses.blind, true, "远距离打不到同区");
  st.gaps["1-2"] = { type: "wall", hp: 10, maxHp: 10, open: false };
  foe.zone = 2;
  attack(c, kolt, foe);
  assert.equal(kolt.statuses.blind, true, "隔着危墙");
  assert.doesNotMatch(logs(st), /目盲：d100=/);
});

test("下潜的目标：谐波攻击落空就没打到——不会被打出沙层、不吃 1 击破；没落空照常打出来", () => {
  let f = field();
  let kolt = f.kit("kolt");
  kolt.statuses.blind = true;
  tank(f.foe);
  f.foe.submerged = true;
  const def0 = f.foe.def;
  dice(f.c, 1);
  attack(f.c, kolt, f.foe, {}, { element: "harmonic", baseBreak: 0 });
  assert.equal(f.foe.submerged, true, "还在沙下");
  assert.equal(f.foe.def, def0, "没有被迫解除的 1 击破");
  assert.equal(kolt.statuses.blind, false);
  f = field();
  kolt = f.kit("kolt");
  kolt.statuses.blind = true;
  tank(f.foe);
  f.foe.submerged = true;
  dice(f.c, 60);
  attack(f.c, kolt, f.foe, {}, { element: "harmonic", baseBreak: 0 });
  assert.equal(f.foe.submerged, false, "没落空：被打出沙层");
  assert.match(logs(f.st), /被谐波震出沙层/);
});

test("躲藏的单位发动攻击落空：落空也算发动过攻击，躲藏解除", () => {
  const { c, kit, foe } = field();
  const kolt = kit("kolt");
  kolt.statuses.blind = true;
  kolt.statuses.hide = true;
  dice(c, 1);
  attack(c, kolt, foe);
  assert.equal(kolt.statuses.hide, false);
  assert.equal(kolt.statuses.blind, false);
});

test("状态栏写「目盲」；新开一场清掉；图鉴通用状态里有这一条，数值跟着配置", () => {
  const { c, kit } = field();
  const kolt = kit("kolt");
  assert.doesNotMatch(c.statusLine(kolt), /目盲/);
  kolt.statuses.blind = true;
  assert.match(c.statusLine(kolt), /目盲/);
  c.resetBattleFlags(kolt);
  assert.equal(kolt.statuses.blind, false, "新开一场清掉");
  const e = c.codexEffectEntries().find(x => x.name === "目盲");
  assert.ok(e, "图鉴里有目盲");
  assert.equal(e.group, "common");
  const text = e.lines.join("\n");
  assert.match(text, /25% 概率落空/);
  assert.match(text, /\+25%/);
  assert.match(text, /落空一次.*被格挡下来一次.*解除/s);
  assert.match(text, /范围攻击不会落空/);
  // 悬停说明（unit-tip.js）按名字找图鉴条目：状态文字里的「目盲」有说明
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, "unit-tip.js"), "utf8"), c, { filename: "unit-tip.js" });
  const tip = c.UnitTip.effect("目盲");
  assert.equal(tip.name, "目盲");
  assert.match(tip.text, /25% 概率落空/);
});

test("图标：目盲是通用状态的红框方块，状态文字里的「目盲」不再重复写字", () => {
  const HI = require("../hud-icons.js");
  const keys = HI.unitBadges({ statuses: { blind: true, weak: true } }).map(b => b.key);
  assert.ok(keys.includes("blind"));
  assert.ok(HI.covered("目盲"));
  assert.equal(HI.keyOf("目盲"), "blind");
  assert.match(HI.badge("blind"), /hi-sq/);
  assert.match(HI.badge("blind"), /--glow:#ff6a5a/);
});

test("联机：目盲经白名单发给玩家（online-view.js），「落空」弹字也放行；主持人工具能改目盲", () => {
  const V = require("../online-view.js");
  const p = V.projectUnit({ id: "u1", name: "狂徒", statuses: { blind: true, weak: false } });
  assert.equal(p.statuses.blind, true);
  const tape = V.projectTape([{ type: "pop", kind: "status", unitId: "u1", text: "落空", element: "physical" }], { state: { units: [{ id: "u1" }] } });
  assert.equal(tape.length, 1);
  assert.equal(tape[0].text, "落空");
  // 主持人的单位补丁（gm-commands.js）收 blind
  const c = H.load();
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, "gm-commands.js"), "utf8"), c, { filename: "gm-commands.js" });
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "BLIND-GM" });
  const authority = Object.freeze({});
  c.GMCommands.configure({ requireHost: ctx => ctx === authority });
  c.startCombat();
  const foe = c.S.state.units.find(u => !u.isPlayer);
  c.Commands.dispatch({ type: "gm.editUnit", actor: foe.id, patch: { statuses: { blind: true } } }, authority);
  assert.equal(foe.statuses.blind, true);
  // 计算器 / 后台的状态勾选（trpg-commands.js · CalcCommands）
  c.Commands.dispatch({ type: "calc", action: "status", actor: foe.id, key: "blind", value: false });
  assert.equal(foe.statuses.blind, false);
});

test("整场自动对打：双方全员目盲也能打完，日志里有落空骰", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu", "ruby"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_hammer", lv: 1, zone: 1 }], seed: "BLIND-SIM" });
  c.startCombat();
  const st = c.S.state;
  st.units.forEach(u => { u.statuses = u.statuses || {}; u.statuses.blind = true; });
  const out = c.BattleSim.run({ maxRounds: 8 });
  assert.ok(out.winner);
  assert.match(logs(st), /目盲：d100=/);
  assert.deepEqual(c.__errors, []);
});
