// 目盲（通用状态，#405）：可以叠加，最多 3 层，每多一层效果翻倍——1 / 2 / 3 层：攻击 25% / 50% / 100% 落空，被格挡下来的概率 +25% / 50% / 100%；
// 落空一次或者被格挡下来一次卸一层，剩下的继续挂着。一次攻击只掷一次落空骰，范围攻击也会落空，落空就整次攻击作废。
// 数值在 engine.js · BLIND；规则在 effects.js（blindStacks / blindRollApplies / blindRoll / dropBlind / blindBlockBonus / blindOnBlocked / blindNewAttack / blindMissedThisAction），
// app.js · dealToInner 出手时做落空判定，finalBlockChance 加格挡率，performAssistBlock / tryOxAutoBlock / 以身作盾挡下以后卸一层，flushAoePulse 不算落空的范围攻击
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
/** 血和架势都厚：打不死、打不进失衡 */
const tank = u => { u.layers.forEach(l => { l.max = 999; l.current = 999; }); u.def = u.defMax = 99; };
const logs = st => st.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
/** 日志里掷了几次落空骰 */
const rolls = st => (logs(st).match(/目盲 \d 层：d100=/g) || []).length;
const plain = x => JSON.parse(JSON.stringify(x));
/** 让 d100（1 + floor(random × 100)）掷出这个点数 */
const r = d100 => (d100 - 1) / 100 + 0.001;
/** Math.random 依次返回这几颗 d100，用完以后一直是 rest */
function dice(c, list, rest) {
  const q = [].concat(list).map(r);
  c.Math.random = () => (q.length ? q.shift() : r(rest == null ? 50 : rest));
}
const attack = (c, a, t, flags, extra) => c.dealTo(a, t, Object.assign({ atk: 10, mult: 1, element: "physical", baseBreak: 2, atkRange: "any", flags: Object.assign({ action: true }, flags || {}) }, extra || {}));
const BLIND = c => vm.runInContext("BLIND", c);

test("数值放在 engine.js · BLIND：每层一个数——1 / 2 / 3 层落空率 25% / 50% / 100%，被格挡概率 +25% / 50% / 100%；最多 3 层", () => {
  const { c } = field();
  const B = BLIND(c);
  assert.deepEqual(plain(B.missPct), [25, 50, 100]);
  assert.deepEqual(plain(B.blockPct), [25, 50, 100]);
  assert.equal("aoe" in B, false, "范围攻击也会落空，不再有开关");
  assert.equal(c.blindMaxStacks(), 3);
});

test("层数：statuses.blind 记层数；填进来的数折成 0–3 的整数，旧数据里的 true 算 1 层", () => {
  const { c, kit } = field();
  [[true, 1], [false, 0], [0, 0], [1, 1], [2, 2], [3, 3], [5, 3], [-1, 0], [2.7, 2], ["2", 2], [null, 0], [undefined, 0]]
    .forEach(([v, n]) => assert.equal(c.blindStacksOf(v), n, String(v)));
  const kolt = kit("kolt");
  assert.equal(c.blindStacks(kolt), 0, "开场没有目盲");
  kolt.statuses.blind = 2;
  assert.equal(c.blindStacks(kolt), 2);
  assert.equal(c.isBlind(kolt), true);
  [[1, 25], [2, 50], [3, 100]].forEach(([n, pct]) => { kolt.statuses.blind = n; assert.equal(c.blindBlockBonus(kolt), pct, n + " 层"); });
});

test("1 层：d100 ≤ 25 落空——没有伤害、没有击破，目盲解除；日志写出层数和落空骰", () => {
  const { c, st, kit, foe } = field();
  const kolt = kit("kolt");
  kolt.statuses.blind = 1;
  tank(foe);
  const hp0 = c.totalHp(foe), def0 = foe.def;
  dice(c, 25);
  const out = attack(c, kolt, foe);
  assert.equal(out.res.ok, false);
  assert.equal(out.res.missed, true);
  assert.equal(c.totalHp(foe), hp0, "没有伤害");
  assert.equal(foe.def, def0, "没有击破");
  assert.equal(kolt.statuses.blind, 0, "1 层落空一次就解除");
  const text = logs(st);
  assert.match(text, /柯尔特 目盲 1 层：d100=25（落空率 25%）→ 对 .+ 的攻击落空/);
  assert.match(text, /柯尔特 攻击落空，目盲解除/);
});

test("1 层：d100 > 25 照常命中，目盲留着（没落空、也没被格挡）；没目盲不掷落空骰", () => {
  const { c, st, kit, foe, foe2 } = field();
  const kolt = kit("kolt");
  kolt.statuses.blind = 1;
  tank(foe); tank(foe2);
  const hp0 = c.totalHp(foe);
  dice(c, 26);
  const out = attack(c, kolt, foe);
  assert.notEqual(out.res.ok, false);
  assert.ok(c.totalHp(foe) < hp0, "打中了");
  assert.equal(kolt.statuses.blind, 1, "目盲还在");
  assert.match(logs(st), /柯尔特 目盲 1 层：d100=26（落空率 25%）→ 没有落空/);
  // 没有目盲：不掷落空骰，也不写目盲
  kolt.statuses.blind = 0;
  const before = logs(st);
  const hp2 = c.totalHp(foe2);
  dice(c, 1);
  attack(c, kolt, foe2);
  assert.ok(c.totalHp(foe2) < hp2);
  assert.doesNotMatch(logs(st).slice(before.length), /目盲/);
});

test("叠加：2 层落空率 50%、3 层 100%；落空只卸一层，剩下的继续挂着、照剩下的层数算", () => {
  const { c, st, kit, foe } = field();
  const kolt = kit("kolt");
  tank(foe);
  // 2 层：d100=50 落空，卸一层还剩 1 层
  kolt.statuses.blind = 2;
  let hp0 = c.totalHp(foe);
  dice(c, 50);
  attack(c, kolt, foe);
  assert.equal(c.totalHp(foe), hp0, "2 层 d100=50 落空");
  assert.equal(kolt.statuses.blind, 1, "只卸一层");
  assert.match(logs(st), /柯尔特 目盲 2 层：d100=50（落空率 50%）→ 对 .+ 的攻击落空/);
  assert.match(logs(st), /柯尔特 攻击落空，目盲 −1 层（还剩 1 层）/);
  // 剩下的 1 层照 25% 算：d100=26 打中
  dice(c, 26);
  attack(c, kolt, foe);
  assert.ok(c.totalHp(foe) < hp0, "剩 1 层：d100=26 打中");
  assert.equal(kolt.statuses.blind, 1);
  // 2 层：d100=51 打中，层数不变
  kolt.statuses.blind = 2;
  hp0 = c.totalHp(foe);
  dice(c, 51);
  attack(c, kolt, foe);
  assert.ok(c.totalHp(foe) < hp0);
  assert.equal(kolt.statuses.blind, 2);
  // 3 层：落空率 100%，d100=100 也落空，还剩 2 层
  kolt.statuses.blind = 3;
  hp0 = c.totalHp(foe);
  dice(c, 100);
  attack(c, kolt, foe);
  assert.equal(c.totalHp(foe), hp0, "3 层必定落空");
  assert.equal(kolt.statuses.blind, 2);
  assert.match(logs(st), /柯尔特 目盲 3 层：d100=100（落空率 100%）→ 对 .+ 的攻击落空/);
  assert.match(logs(st), /柯尔特 攻击落空，目盲 −1 层（还剩 2 层）/);
});

test("落空率读配置：BLIND.missPct 改成 [50, 70, 90]，1 层 d100=50、2 层 d100=70 都落空", () => {
  const { c, kit, foe } = field();
  const kolt = kit("kolt");
  vm.runInContext("BLIND.missPct = [50, 70, 90]", c);
  tank(foe);
  const hp0 = c.totalHp(foe);
  kolt.statuses.blind = 1;
  dice(c, 50);
  attack(c, kolt, foe);
  assert.equal(kolt.statuses.blind, 0);
  kolt.statuses.blind = 2;
  dice(c, 70);
  attack(c, kolt, foe);
  assert.equal(kolt.statuses.blind, 1);
  assert.equal(c.totalHp(foe), hp0);
});

test("被格挡下来的概率按层数加：+25% / 50% / 100%，加完再按 5%–100% 封顶；敌人自动格挡目盲的我方也算；读配置", () => {
  const { c, kit, foe } = field(["kolt", "helu", "chuan"]);
  const kolt = kit("kolt"), helu = kit("helu"), chuan = kit("chuan");
  const h0 = c.finalBlockChance(helu, foe, kolt), c0 = c.finalBlockChance(chuan, foe, kolt);
  assert.ok(h0 + 25 <= 100 && c0 + 25 > 100, "Helumica 加完不到上限，川川加完超过上限");
  foe.statuses.blind = 1;
  assert.equal(c.finalBlockChance(helu, foe, kolt), h0 + 25);
  assert.equal(c.finalBlockChance(chuan, foe, kolt), 100, "封顶 100%");
  foe.statuses.blind = 2;
  assert.equal(c.finalBlockChance(helu, foe, kolt), Math.min(100, h0 + 50));
  foe.statuses.blind = 3;
  assert.equal(c.finalBlockChance(helu, foe, kolt), 100, "3 层 +100%");
  // 敌人（警卫队队长·牛）自动格挡目盲的柯尔特：一样按层数加
  const g = field(["kolt", "helu"], [{ id: "captain_ox", lv: 1, zone: 1 }, { id: "guard_sword", lv: 1, zone: 1 }]);
  const ox = g.kit("captain_ox"), guard = g.kit("guard_sword"), k2 = g.kit("kolt");
  const o0 = g.c.finalBlockChance(ox, k2, guard);
  [[1, 25], [2, 50], [3, 100]].forEach(([n, pct]) => { k2.statuses.blind = n; assert.equal(g.c.finalBlockChance(ox, k2, guard), Math.min(100, o0 + pct), n + " 层"); });
  // 读配置
  vm.runInContext("BLIND.blockPct = [10, 20, 40]", g.c);
  k2.statuses.blind = 2;
  assert.equal(g.c.finalBlockChance(ox, k2, guard), Math.min(100, o0 + 20));
});

/** 目盲的狂徒打柯尔特（Helumica 能协助格挡）；d100 是落空骰，n 是层数 */
function blindFoeHitsKolt(d100, n) {
  const f = field();
  const kolt = f.kit("kolt"), helu = f.kit("helu");
  f.st.combatPhase = "enemy";
  helu.bonus = 1;
  tank(kolt);
  f.foe.statuses.blind = n == null ? 1 : n;
  dice(f.c, d100);
  const hp0 = f.c.totalHp(kolt);
  attack(f.c, f.foe, kolt, {}, { baseBreak: 1 });
  return Object.assign(f, { kolt, helu, hp0 });
}

test("落空的攻击不进协助格挡：不弹格挡、不花附赠动作，柯尔特不受伤；卸一层", () => {
  const { c, st, kolt, helu, foe, hp0 } = blindFoeHitsKolt(10, 2);
  assert.equal((st.blockQueue || []).length, 0, "没有等格挡的那一击");
  assert.equal(c.totalHp(kolt), hp0);
  assert.equal(helu.bonus, 1, "没人花附赠动作");
  assert.equal(foe.statuses.blind, 1, "2 层落空卸一层");
});

test("被协助格挡下来卸一层：拿武器挡住、空手挡住都算；没挡住层数不变", () => {
  // 2 层，拿武器挡住：柯尔特免伤，还剩 1 层
  let f = blindFoeHitsKolt(80, 2);
  assert.equal(f.st.blockQueue.length, 1, "没落空：等格挡");
  f.c.finishBlock(f.helu.id, { roll: 1, ok: true, chance: 99 });
  assert.equal(f.c.totalHp(f.kolt), f.hp0, "挡住了");
  assert.equal(f.foe.statuses.blind, 1, "被格挡下来：卸一层");
  assert.match(logs(f.st), /狂徒（匕首） 的攻击被格挡下来，目盲 −1 层（还剩 1 层）/);
  // 1 层：挡住就解除
  f = blindFoeHitsKolt(60, 1);
  f.c.finishBlock(f.helu.id, { roll: 1, ok: true, chance: 99 });
  assert.equal(f.foe.statuses.blind, 0);
  assert.match(logs(f.st), /狂徒（匕首） 的攻击被格挡下来，目盲解除/);
  // 空手挡住：柯尔特照样受一半伤害，也卸一层
  f = blindFoeHitsKolt(80, 2);
  f.helu.weaponHeld = false;
  f.c.finishBlock(f.helu.id, { roll: 1, ok: true, chance: 99 });
  assert.ok(f.c.totalHp(f.kolt) < f.hp0, "空手挡住只免一半");
  assert.equal(f.foe.statuses.blind, 1, "空手挡住也算被格挡下来");
  // 没挡住：照常受伤，层数不变
  f = blindFoeHitsKolt(80, 2);
  f.c.finishBlock(f.helu.id, { roll: 99, ok: false, chance: 1 });
  assert.equal(f.st.blockQueue.length, 0);
  assert.ok(f.c.totalHp(f.kolt) < f.hp0);
  assert.equal(f.foe.statuses.blind, 2, "没挡住：层数不变");
});

test("等格挡结果的那一击落下时不再掷落空骰（出手时已经掷过）", () => {
  const { c, st, kolt, foe, hp0 } = blindFoeHitsKolt(60);
  assert.equal(st.blockQueue.length, 1);
  dice(c, 1);                         // 这时候再掷就会落空
  c.finishBlock(null);                // 没人格挡
  assert.ok(c.totalHp(kolt) < hp0, "照常落下");
  assert.equal(foe.statuses.blind, 1, "没落空、也没被格挡：层数不变");
  assert.equal(rolls(st), 1, "只掷了一次");
});

test("敌人自动格挡（警卫队队长·牛）挡下目盲的柯尔特：卸一层；先掷落空骰，再掷格挡骰", () => {
  const { c, st, kit } = field(["kolt", "helu"], [{ id: "captain_ox", lv: 1, zone: 1 }, { id: "guard_sword", lv: 1, zone: 1 }]);
  const kolt = kit("kolt"), guard = kit("guard_sword");
  kolt.statuses.blind = 2;
  const hp0 = c.totalHp(guard);
  dice(c, [80, 1]);                   // 2 层的落空骰 80（没落空），格挡骰 1（挡住）
  attack(c, kolt, guard);
  assert.equal(c.totalHp(guard), hp0, "被牛挡下");
  assert.equal(kolt.statuses.blind, 1);
  const text = logs(st);
  assert.ok(text.indexOf("目盲 2 层：d100=80") >= 0 && text.indexOf("目盲 2 层：d100=80") < text.indexOf("自动协助格挡"), "落空骰在格挡骰前面");
  assert.match(text, /柯尔特 的攻击被格挡下来，目盲 −1 层（还剩 1 层）/);
  // 落空了就不用挡：牛不掷格挡骰
  const g = field(["kolt", "helu"], [{ id: "captain_ox", lv: 1, zone: 1 }, { id: "guard_sword", lv: 1, zone: 1 }]);
  g.kit("kolt").statuses.blind = 1;
  dice(g.c, [5, 1]);
  attack(g.c, g.kit("kolt"), g.kit("guard_sword"));
  assert.doesNotMatch(logs(g.st), /自动协助格挡/);
});

test("以身作盾（专长）宣布挡下目盲的敌人：算被格挡下来，卸一层", () => {
  const f = blindFoeHitsKolt(80, 2);
  assert.equal(f.st.blockQueue.length, 1);
  // 直接把 Helumica 当成能宣布以身作盾的人（专长的条件另有测试）
  vm.runInContext("featIronwallDeclarers = () => [unitById(" + JSON.stringify(f.helu.id) + ")]; featUseOnce = () => true;", f.c);
  f.c.finishBlock("ironwall:" + f.helu.id);
  assert.equal(f.c.totalHp(f.kolt), f.hp0);
  assert.equal(f.foe.statuses.blind, 1);
});

test("一次攻击只掷一次落空骰：同一次行动里后面几下照第一次的结果——落空就整次作废、只卸一层；没落空后面不再掷", () => {
  // 1 层：第一下落空卸掉最后一层，这次攻击后面的几下（同一个目标、范围攻击打到的别的目标）照样作废
  let f = field();
  let kolt = f.kit("kolt");
  tank(f.foe); tank(f.foe2);
  kolt.statuses.blind = 1;
  f.c.beginActionAcc(kolt, "kolt_aa");
  const hp1 = f.c.totalHp(f.foe), hp2 = f.c.totalHp(f.foe2);
  dice(f.c, [10], 99);
  attack(f.c, kolt, f.foe);
  const again = attack(f.c, kolt, f.foe);
  attack(f.c, kolt, f.foe2, { aoe: true });
  assert.equal(again.res.missed, true, "同一次攻击的第二下也作废");
  assert.equal(f.c.totalHp(f.foe), hp1);
  assert.equal(f.c.totalHp(f.foe2), hp2);
  assert.equal(f.foe.def, 99, "没击破");
  assert.equal(kolt.statuses.blind, 0, "只卸一层");
  assert.equal(rolls(f.st), 1, "只掷一次");
  // 下一次行动是另一次攻击：目盲已经卸完，照常打中
  f.c.beginActionAcc(kolt, "kolt_aa");
  attack(f.c, kolt, f.foe);
  assert.ok(f.c.totalHp(f.foe) < hp1);
  // 2 层，掷 80 没落空：这次攻击后面几下不再掷，都打中
  f = field();
  kolt = f.kit("kolt");
  tank(f.foe); tank(f.foe2);
  kolt.statuses.blind = 2;
  f.c.beginActionAcc(kolt, "kolt_aa");
  const h1 = f.c.totalHp(f.foe), h2 = f.c.totalHp(f.foe2);
  dice(f.c, [80], 1);                 // 再掷就会落空
  attack(f.c, kolt, f.foe);
  attack(f.c, kolt, f.foe2, { aoe: true });
  assert.ok(f.c.totalHp(f.foe) < h1 && f.c.totalHp(f.foe2) < h2, "都打中");
  assert.equal(kolt.statuses.blind, 2);
  assert.equal(rolls(f.st), 1);
});

/** 灯 + 年糕（音爆：同区每个敌人 0.5atk 谐波、1 击破），同区三个血厚的狂徒（架势 30） */
function sonic() {
  const c = H.load();
  c.BattleSim.setup({ party: ["tou"], enemies: [1, 2, 3].map(() => ({ id: "thug_knife", lv: 1, zone: 1 })), seed: "BLIND-AOE" });
  c.startCombat();
  const st = c.S.state;
  const foes = st.units.filter(u => !u.isPlayer);
  foes.forEach(f => { f.zone = 1; f.layers = [{ type: "flesh", current: 500, max: 500 }]; f.def = f.defMax = 30; });
  const tou = c.findKit("tou", st.units);
  tou.zone = 1; tou.level = 11; tou.ap = 3; tou.bonus = 2;
  c.Commands.dispatch({ type: "skill", actor: tou.id, skill: "tou_summon" });
  const mochi = c.findKit("mochi", st.units);
  mochi.zone = 1; mochi.ap = 3; mochi.bonus = 2;
  tou.resources.shield = 3;
  const boom = again => c.Commands.dispatch({ type: "skill", actor: mochi.id, skill: "mochi_boom", picks: { again } });
  return { c, st, foes, tou, mochi, boom };
}

test("范围攻击也会落空（年糕音爆）：一次范围攻击只掷一次，落空就整次作废——同区每个敌人都没伤害、没击破，只卸一层", () => {
  let f = sonic();
  f.mochi.statuses.blind = 2;
  const spent0 = f.mochi.ap + f.mochi.bonus;
  dice(f.c, [30], 99);                // 2 层落空率 50%：30 落空（再掷就是 99，不会落空）
  f.boom("once");
  f.foes.forEach((x, i) => {
    assert.equal(f.c.totalHp(x), 500, `第 ${i + 1} 个敌人没伤害`);
    assert.equal(x.def, 30, `第 ${i + 1} 个敌人没击破`);
  });
  assert.equal(f.mochi.statuses.blind, 1, "只卸一层");
  assert.equal(rolls(f.st), 1, "只掷一次");
  assert.match(logs(f.st), /年糕 目盲 2 层：d100=30（落空率 50%）→ 这次范围攻击落空/);
  assert.ok(f.mochi.ap + f.mochi.bonus < spent0, "落空也算用过这个技能");
  // 没落空：同区每个敌人都挨到，也只掷一次
  f = sonic();
  f.mochi.statuses.blind = 2;
  dice(f.c, [51], 1);                 // 51 没落空（再掷就是 1，会落空）
  f.boom("once");
  f.foes.forEach((x, i) => {
    assert.ok(f.c.totalHp(x) < 500, `第 ${i + 1} 个敌人挨到了`);
    assert.equal(x.def, 29, `第 ${i + 1} 个敌人 1 击破`);
  });
  assert.equal(f.mochi.statuses.blind, 2);
  assert.equal(rolls(f.st), 1);
});

test("音爆再耗圣盾炸第二次是另一次范围攻击：各掷一次落空骰", () => {
  const f = sonic();
  f.mochi.statuses.blind = 2;
  dice(f.c, [10], 80);                // 第一次 2 层 50%：10 落空（卸一层）；之后都是 80（弹字也要随机数），第二次 1 层 25%：80 没落空
  f.boom("twice");
  assert.equal(f.tou.resources.shield, 2, "第二次音爆耗了 1 圣盾");
  f.foes.forEach((x, i) => assert.equal(x.def, 29, `第 ${i + 1} 个敌人只挨了第二次音爆`));
  assert.equal(f.mochi.statuses.blind, 1);
  assert.equal(rolls(f.st), 2);
  assert.match(logs(f.st), /年糕 目盲 2 层：d100=10（落空率 50%）→ 这次范围攻击落空/);
  assert.match(logs(f.st), /年糕 目盲 1 层：d100=80（落空率 25%）→ 没有落空/);
});

test("范围攻击落空也不算波及区里的配置物：拉杆不扳；没落空照常扳", () => {
  const doorAfter = (n, d100) => {
    const f = sonic();
    f.st.gaps["1-2"] = { type: "door", hp: 0, open: false };
    f.st.props.push(f.c.makeProp("lever", 1, 1));
    f.mochi.statuses.blind = n;
    dice(f.c, [d100], 99);
    f.boom("once");
    return f.st.gaps["1-2"].open;
  };
  assert.equal(doorAfter(0, 50), true, "没目盲：音爆波及拉杆，门打开");
  assert.equal(doorAfter(1, 10), false, "落空：拉杆没被扳");
  assert.equal(doorAfter(1, 90), true, "没落空：照常扳");
});

test("一个技能里分几下打同一个目标（瑞比普攻两下）：只掷一次，落空两下都作废", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "BLIND-RUBY" });
  c.startCombat();
  const st = c.S.state;
  const foe = st.units.find(u => !u.isPlayer);
  foe.zone = 2; foe.layers = [{ type: "flesh", current: 500, max: 500 }]; foe.def = foe.defMax = 30;
  const ruby = c.findKit("ruby", st.units);
  ruby.zone = 1; ruby.ap = 3;
  ruby.statuses.blind = 1;
  dice(c, [10], 99);
  c.Commands.dispatch({ type: "skill", actor: ruby.id, skill: "ruby_aa", target: foe.id });
  assert.equal(c.totalHp(foe), 500, "两下都没打到（第一下卸掉了最后一层，第二下照样作废）");
  assert.equal(foe.def, 30);
  assert.equal(ruby.statuses.blind, 0);
  assert.equal(rolls(st), 1, "只掷一次");
});

test("范围攻击也掷落空骰；环境伤害、首领机制、导体跳到的那一下、借刺入的针出手不掷", () => {
  const { c, kit, foe } = field();
  const kolt = kit("kolt");
  tank(foe);
  kolt.statuses.blind = 1;
  const cases = [{ environment: true }, { locked: true, mechId: "m1" }, { conductorExtra: true, blockResolved: true }, { viaPierce: true }];
  cases.forEach(fl => {
    const hp0 = c.totalHp(foe);
    dice(c, 1);
    attack(c, kolt, foe, fl);
    assert.ok(c.totalHp(foe) < hp0, JSON.stringify(fl) + " 照常打中");
    assert.equal(kolt.statuses.blind, 1, JSON.stringify(fl) + " 不掷落空骰");
  });
  const hp1 = c.totalHp(foe);
  dice(c, 1);
  attack(c, kolt, foe, { aoe: true });
  assert.equal(c.totalHp(foe), hp1, "范围攻击也会落空");
  assert.equal(kolt.statuses.blind, 0);
});

test("协助攻击、借机攻击也是攻击：一样会落空；借机攻击每次单独算一次攻击（同一次行动里也各掷各的）", () => {
  ["assist", "opportunity"].forEach(k => {
    const { c, kit, foe } = field();
    const kolt = kit("kolt");
    tank(foe);
    kolt.statuses.blind = 1;
    const hp0 = c.totalHp(foe);
    dice(c, 1);
    attack(c, kolt, foe, { [k]: true });
    assert.equal(c.totalHp(foe), hp0, k);
    assert.equal(kolt.statuses.blind, 0, k);
  });
  // 狂徒的行动里柯尔特借机攻击两次：各掷一次（第一次 80 没落空，第二次 10 落空）
  const { c, st, kit, foe } = field();
  const kolt = kit("kolt");
  tank(foe);
  kolt.statuses.blind = 2;
  c.beginActionAcc(foe, "en_approach");
  dice(c, [80, 10]);
  const hp0 = c.totalHp(foe);
  attack(c, kolt, foe, { opportunity: true });
  const hp1 = c.totalHp(foe);
  assert.ok(hp1 < hp0, "第一次没落空");
  attack(c, kolt, foe, { opportunity: true });
  assert.equal(c.totalHp(foe), hp1, "第二次单独掷，落空");
  assert.equal(kolt.statuses.blind, 1);
  assert.equal(rolls(st), 2);
});

test("打不出去的攻击不掷落空骰：目标躲藏、射程不够、隔着危墙，目盲都留着", () => {
  const { c, st, kit, foe } = field();
  const kolt = kit("kolt");
  kolt.statuses.blind = 1;
  dice(c, 1);
  foe.statuses.hide = true;
  attack(c, kolt, foe);
  assert.equal(kolt.statuses.blind, 1, "躲藏");
  foe.statuses.hide = false;
  attack(c, kolt, foe, {}, { atkRange: "ranged" });
  assert.equal(kolt.statuses.blind, 1, "远距离打不到同区");
  st.gaps["1-2"] = { type: "wall", hp: 10, maxHp: 10, open: false };
  foe.zone = 2;
  attack(c, kolt, foe);
  assert.equal(kolt.statuses.blind, 1, "隔着危墙");
  assert.equal(rolls(st), 0);
});

test("下潜的目标：谐波攻击落空就没打到——不会被打出沙层、不吃 1 击破；没落空照常打出来", () => {
  let f = field();
  let kolt = f.kit("kolt");
  kolt.statuses.blind = 1;
  tank(f.foe);
  f.foe.submerged = true;
  const def0 = f.foe.def;
  dice(f.c, 1);
  attack(f.c, kolt, f.foe, {}, { element: "harmonic", baseBreak: 0 });
  assert.equal(f.foe.submerged, true, "还在沙下");
  assert.equal(f.foe.def, def0, "没有被迫解除的 1 击破");
  assert.equal(kolt.statuses.blind, 0);
  f = field();
  kolt = f.kit("kolt");
  kolt.statuses.blind = 1;
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
  kolt.statuses.blind = 2;
  kolt.statuses.hide = true;
  dice(c, 1);
  attack(c, kolt, foe);
  assert.equal(kolt.statuses.hide, false);
  assert.equal(kolt.statuses.blind, 1);
});

test("状态栏写「目盲×层数」；新开一场清掉；图鉴通用状态写明叠加、每层的数值和卸一层", () => {
  const { c, kit } = field();
  const kolt = kit("kolt");
  assert.doesNotMatch(c.statusLine(kolt), /目盲/);
  kolt.statuses.blind = 2;
  assert.match(c.statusLine(kolt), /目盲×2/);
  kolt.statuses.blind = true;            // 旧数据
  assert.match(c.statusLine(kolt), /目盲×1/);
  kolt.statuses.blind = 3;
  c.resetBattleFlags(kolt);
  assert.equal(kolt.statuses.blind, 0, "新开一场清掉");
  const e = c.codexEffectEntries().find(x => x.name === "目盲");
  assert.ok(e, "图鉴里有目盲");
  assert.equal(e.group, "common");
  const text = e.lines.join("\n");
  assert.match(text, /可以叠加，最多 3 层/);
  assert.match(text, /1 层 25%、2 层 50%、3 层 100%/);
  assert.match(text, /1 层 \+25%、2 层 \+50%、3 层 \+100%/);
  assert.match(text, /一次攻击只掷一次，范围攻击也会落空/);
  assert.match(text, /卸掉一层，剩下的继续挂着/);
  // 悬停说明（unit-tip.js）按名字找图鉴条目：状态文字里的「目盲×2」有说明
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, "unit-tip.js"), "utf8"), c, { filename: "unit-tip.js" });
  const tip = c.UnitTip.effect("目盲×2");
  assert.equal(tip.name, "目盲×2");
  assert.match(tip.text, /可以叠加，最多 3 层/);
});

test("图标：目盲是通用状态的红框方块，角标写层数；HD-2D 铭牌 2 层起写层数", () => {
  const HI = require("../hud-icons.js");
  const b = HI.unitBadges({ statuses: { blind: 2, weak: true } }).find(x => x.key === "blind");
  assert.ok(b);
  assert.equal(b.stack, 2, "角标写层数");
  assert.equal(HI.unitBadges({ statuses: { blind: 0 } }).length, 0, "0 层不挂");
  assert.ok(HI.covered("目盲×2"));
  assert.equal(HI.keyOf("目盲"), "blind");
  assert.match(HI.badge("blind", 2), /hi-sq/);
  assert.match(HI.badge("blind", 2), /--glow:#ff6a5a/);
  assert.match(HI.badge("blind", 2), /hi-stack">2</);
  const L = require("../hd2d/hd2d-layout.js");
  const label = n => (L.plateData({ id: "x", name: "x", statuses: { blind: n } }).statuses.find(s => s.key === "blind") || {}).label;
  assert.equal(label(1), "目盲");
  assert.equal(label(3), "目盲3");
});

test("联机：目盲层数经白名单发给玩家（online-view.js），「落空」弹字也放行；主持人工具按层数改目盲（0–3）", () => {
  const V = require("../online-view.js");
  const p = V.projectUnit({ id: "u1", name: "狂徒", statuses: { blind: 2, weak: false } });
  assert.equal(p.statuses.blind, 2);
  const tape = V.projectTape([{ type: "pop", kind: "status", unitId: "u1", text: "落空", element: "physical" }], { state: { units: [{ id: "u1" }] } });
  assert.equal(tape.length, 1);
  assert.equal(tape[0].text, "落空");
  // 主持人的单位补丁（gm-commands.js）收 0–3 的整数层数，别的拒绝
  const c = H.load();
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, "gm-commands.js"), "utf8"), c, { filename: "gm-commands.js" });
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "BLIND-GM" });
  const authority = Object.freeze({});
  c.GMCommands.configure({ requireHost: ctx => ctx === authority });
  c.startCombat();
  const foe = c.S.state.units.find(u => !u.isPlayer);
  const edit = blind => c.Commands.dispatch({ type: "gm.editUnit", actor: foe.id, patch: { statuses: { blind } } }, authority);
  edit(2);
  assert.equal(foe.statuses.blind, 2);
  [4, -1, 1.5, true].forEach(v => assert.throws(() => edit(v), undefined, String(v)));
  assert.equal(foe.statuses.blind, 2, "被拒绝的不改");
  edit(0);
  assert.equal(foe.statuses.blind, 0);
  // 计算器 / 后台的目盲层数（trpg-commands.js · CalcCommands）：折成 0–3 层
  c.Commands.dispatch({ type: "calc", action: "status", actor: foe.id, key: "blind", value: 5 });
  assert.equal(foe.statuses.blind, 3);
  c.Commands.dispatch({ type: "calc", action: "status", actor: foe.id, key: "blind", value: 1 });
  assert.equal(foe.statuses.blind, 1);
  c.Commands.dispatch({ type: "calc", action: "status", actor: foe.id, key: "blind", value: 0 });
  assert.equal(foe.statuses.blind, 0);
});

test("整场自动对打：双方全员挂 1–3 层目盲也能打完，日志里有落空骰", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu", "ruby"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_hammer", lv: 1, zone: 1 }], seed: "BLIND-SIM" });
  c.startCombat();
  const st = c.S.state;
  st.units.forEach((u, i) => { u.statuses = u.statuses || {}; u.statuses.blind = 1 + (i % 3); });
  const out = c.BattleSim.run({ maxRounds: 8 });
  assert.ok(out.winner);
  assert.ok(rolls(st) > 0);
  assert.deepEqual(c.__errors, []);
});
