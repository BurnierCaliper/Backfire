// 移动堡垒与通用载具配置物（docs/suppression-force.md 第 3 节，issue #162）：
// 数值、上下车、驾驶员递补、驾驶员与车合并的血量层、代挡 40% / 张开掩体 100%、殉爆、抢车、开局驾驶员、AI、显示
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const vm = require("vm");
const get = (c, expr) => vm.runInContext(expr, c);
/** 规则环境里的数组 / 对象和测试这边不是同一个原型：比较前先转成普通数据 */
const plain = x => JSON.parse(JSON.stringify(x));
const eq = (a, b, m) => assert.deepEqual(plain(a), plain(b), m);

function field(enemies, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: opt.party || ["kolt", "helu"], enemies, seed: opt.seed || "VEH", zoneMode: opt.zoneMode || 2 });
  c.startCombat();
  const S = c.S.state;
  S.units.forEach(u => { if (u.kit === "kolt") u.prideMaxHp = Infinity; });
  return {
    c, S,
    P: k => c.findKit(k, S.units),
    E: (k, n) => S.units.filter(u => !u.isPlayer && u.kit === k && !u.dead)[n || 0],
    logs: () => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n")
  };
}
const noBlock = { pickBlocker: () => null, pickAssister: l => l[0].id };
/** 一场有 n 个镇压队杂兵（警棍盾 / 步枪 / 投手 / 喷火兵 / 小队长循环）的战斗，全在 zone 区 */
function riotField(n, zone, opt) {
  const kits = ["riot_baton", "riot_rifle", "riot_molotov", "riot_flamer", "riot_captain"];
  const rows = [];
  for (let i = 0; i < n; i++) rows.push({ id: kits[i % kits.length], lv: (opt && opt.lv) || 5, zone: zone || 2 });
  return field(rows, opt);
}
/** 取第 i 个镇压队单位（按出场顺序） */
function riots(f) { return f.S.units.filter(u => !u.isPlayer && /^riot_/.test(u.kit) && !u.dead); }
function car(f, zone, lv) { return f.c.vehicleSpawn("fortress", zone || 2, lv || 5, 2); }
function use(f, a, id, t) {
  f.S.combatPhase = a.isPlayer ? "player" : "enemy"; a.ap = Math.max(a.ap || 0, 1); f.S.attackerId = a.id; f.S.targetId = t ? t.id : null;
  f.c.runSkill(id);
  f.c.BattleSim.resolveQueues(noBlock);
}
const fleshOnly = u => { u.layers = [{ type: "flesh", current: 9999, max: 9999, inner: true }]; };
const armorOf = (f, p) => f.c.vehicleArmor(p).cur;
/** 一击不带骰子的物理攻击（atk×mult），方便数伤害 */
function hit(f, attacker, target, opt) {
  return f.c.dealTo(attacker, target, Object.assign({ atk: 10, mult: 1, element: "physical", baseBreak: 0, flags: { action: true, anyRange: true, blockResolved: true } }, opt || {}));
}
const rnd = (f, v) => { f.c.Math.random = typeof v === "function" ? v : () => v; };

/* ---------- 数值 ---------- */
test("数值：纯装甲 42+11×(等级−1)+2×⌊等级/5⌋，架势 5 每 10 级 +1，ATK 7+(等级−1)，开炮骰 1d6 起每 5 级升一档（2 人队与文档表一致）", () => {
  const c = H.load();
  const want = { 1: [42, 5, 7, 6], 5: [88, 5, 11, 8], 10: [145, 6, 16, 10], 15: [202, 6, 21, 12], 20: [259, 7, 26, 20], 25: [316, 7, 31, 20] };
  Object.keys(want).forEach(lv => {
    const s = c.vehicleStats("fortress", Number(lv), 2);
    eq([s.armor, s.def, s.atk, s.dieSides], want[lv], `${lv} 级`);
  });
  assert.equal(c.vehicleStats("fortress", 5, 4).armor, Math.round(88 * 2.5), "装甲按队伍人数 scaleHp（4 人队 ×2.5）");
  assert.equal(c.vehicleStats("fortress", 5, 3).armor, Math.round(88 * 1.5));
});

test("登记：移动堡垒是配置物（props），不占代币、不进敌人表；座位 4、出现概率 30%、只有镇压队能上，数值写在 VEHICLES 里", () => {
  const c = H.load();
  const v = get(c, "VEHICLES").fortress;
  eq([v.seats, v.appear, v.faction, v.stunMarks], [4, 0.3, "镇压队", 2]);
  assert.equal(c.enemyInfo("fortress"), null, "不是敌人，没有代币");
  assert.equal(c.propKindName("fortress"), "移动堡垒");
  const p = c.makeProp("fortress", 2, 5);
  assert.ok(p.isVehicle && p.kind === "fortress" && p.hp === 88 && p.maxHp === 88);
  assert.ok(get(c, "CODEX_PROPS").some(x => x.id === "fortress"), "图鉴里有配置物条目");
});

/* ---------- 上车 / 下车 / 驾驶员递补 ---------- */
test("上车：第一个上车的是驾驶员，其余是炮手（藏在车里选不中）；座位 4 个，满了上不去；非镇压队的敌人上不去", () => {
  const f = riotField(6, 2);
  const [a, b, d, e, g, h] = riots(f);
  const p = car(f, 2);
  f.c.vehicleBoard(a, p); f.c.vehicleBoard(b, p); f.c.vehicleBoard(d, p); f.c.vehicleBoard(e, p);
  eq(p.veh.seats, [a.id, b.id, d.id, e.id]);
  assert.ok(a.vehMerged && !a.fused, "驾驶员和车合并，是场上一个看得见的单位");
  [b, d, e].forEach(u => assert.ok(u.fused && !u.vehMerged && u.vehId === p.id, "炮手藏在车里"));
  assert.match(f.c.vehicleBoardError(g, p), /座位满了/);
  assert.equal(f.c.vehicleSeatText(p), "乘员 4 / 4");
  // 炮手选不中、不在 AI 的敌对名单里
  assert.ok(!f.c.hostilesOf(f.P("kolt")).includes(b));
  // 别的阵营的敌人（安保）上不去
  const guard = f.c.enemyPresets().find(x => x.id === "guard_sword").build(3, 2);
  guard.zone = 2; f.S.units.push(guard);
  assert.match(f.c.vehicleBoardError(guard, p), /只有镇压队能上/);
});

test("上车要同区、车上没有对方的人；上车花 1 行动点，下车不花行动点（落在车所在的区）", () => {
  const f = riotField(3, 2, { zoneMode: 3 });
  const [a, b, d] = riots(f);
  const p = car(f, 2);
  d.zone = 3;
  assert.match(f.c.vehicleBoardError(d, p), /同区/);
  // 走技能：上车花 1 行动点
  a.ap = 1; a.bonus = 0;
  use(f, a, `veh_board:${p.id}`);
  assert.equal(a.ap, 0, "上车花 1 行动点");
  assert.equal(a.vehId, p.id);
  // 下车不花行动点，落在车所在的区
  b.zone = 2; use(f, b, `veh_board:${p.id}`);
  b.ap = 1;
  const apBefore = b.ap, bonusBefore = b.bonus;
  use(f, b, "veh_leave");
  eq([b.ap, b.bonus], [apBefore, bonusBefore], "下车不花行动点也不花附赠");
  assert.ok(!b.vehId && !b.fused && b.zone === 2);
  assert.equal(f.c.vehicleSkillCost("veh_leave").ap || 0, 0);
  assert.equal(f.c.skillCost("veh_board:x").ap, 1);
});

test("驾驶员下车或倒下时按上车顺序递补：第二个上车的接任，再下一个依次接", () => {
  const f = riotField(4, 2);
  const [a, b, d, e] = riots(f);
  const p = car(f, 2);
  [a, b, d, e].forEach(u => f.c.vehicleBoard(u, p));
  assert.ok(a.vehMerged);
  // 驾驶员下车：b 接任
  f.c.vehicleLeave(a);
  assert.ok(b.vehMerged && !b.fused, "b 接任驾驶员");
  eq(p.veh.seats, [b.id, d.id, e.id]);
  // 驾驶员倒下（内层打空）：d 接任，装甲留着
  const armorBefore = armorOf(f, p);
  b.layers.filter(l => !l.veh).forEach(l => { l.current = 0; });
  f.c.sweepDeadEnemies();
  assert.ok(d.vehMerged && !d.fused, "d 接任");
  assert.ok(b.dead || b._removed, "倒下的驾驶员死了");
  assert.equal(armorOf(f, p), armorBefore, "车的装甲留着");
  eq(p.veh.seats, [d.id, e.id]);
});

test("车里没人了就变回空的配置物（装甲还在，仍在场上）", () => {
  const f = riotField(1, 2);
  const [a] = riots(f);
  const p = car(f, 2);
  f.c.vehicleBoard(a, p);
  a.layers[0].current = 60;
  f.c.vehicleLeave(a);
  eq(p.veh.seats, []);
  assert.equal(p.hp, 60, "剩下的装甲还给车");
  assert.ok(f.S.props.includes(p));
  assert.equal(f.c.vehiclePilot(p), null);
});

/* ---------- 合并后的血量层 ---------- */
test("合并：车的装甲在最外层，驾驶员自己的护盾、肉体在里面；架势、晕眩标记用车的；刺骨 / 穿刺这类打内层的能绕过装甲", () => {
  const f = riotField(1, 2);
  const [a] = riots(f);
  const ownDef = a.def;
  const own = a.layers.map(l => [l.type, l.max]);
  const p = car(f, 2, 5);
  f.c.vehicleBoard(a, p);
  eq(a.layers.map(l => l.type), ["armor", "shield", "flesh"], "装甲 → 护盾 → 肉体");
  assert.equal(a.layers[0].veh, p.id);
  assert.equal(a.layers[0].max, 88);
  eq(a.layers.slice(1).map(l => [l.type, l.max]), own, "驾驶员自己的层原样在里面");
  assert.ok(a.layers[2].inner && !a.layers[0].inner, "最内层还是肉体");
  eq([a.def, a.defMax], [5, 5], "架势用车的（5 级：5）");
  assert.notEqual(ownDef, undefined);
  assert.ok(f.c.isBossUnit(a), "晕眩标记用车的：要攒满 2 个才真正晕眩");
  // 穿刺：从第二层开始打，绕过装甲直接打到驾驶员自己的护盾
  const k = f.P("kolt");
  const shield0 = a.layers[1].current;
  hit(f, k, a, { atk: 10, flags: { action: true, anyRange: true, blockResolved: true, pierce: true } });
  assert.equal(a.layers[0].current, 88, "装甲没动");
  assert.ok(a.layers[1].current < shield0, "穿刺直接打到驾驶员的护盾");
  // 普通攻击先打装甲
  const before = a.layers[0].current;
  hit(f, k, a, { atk: 10 });
  assert.ok(a.layers[0].current < before, "普通攻击先打车的装甲");
});

test("分开：剩下的装甲、架势、晕眩标记还给车，驾驶员换回自己的架势和血量层", () => {
  const f = riotField(2, 2);
  const [a, b] = riots(f);
  const ownDef = a.def, ownMax = a.defMax;
  const p = car(f, 2, 5);
  f.c.vehicleBoard(a, p); f.c.vehicleBoard(b, p);
  a.layers[0].current = 30; a.def = 2; a.stunMarks = 1;
  f.c.vehicleLeave(a);
  assert.equal(p.hp, 30, "装甲还给车");
  assert.ok(b.vehMerged);
  assert.deepEqual([b.def, b.stunMarks], [2, 1], "接任的驾驶员用车现在的架势和晕眩标记");
  eq([a.def, a.defMax], [ownDef, ownMax], "驾驶员换回自己的架势");
  assert.ok(a.layers.every(l => !l.veh), "驾驶员身上不再有车的装甲层");
});

test("驾驶员的内层被打空：驾驶员倒下 / 死亡，车的装甲留着；玩家驾驶员倒下同样让位", () => {
  const f = riotField(2, 2);
  const [a, b] = riots(f);
  const p = car(f, 2);
  f.c.vehicleBoard(a, p); f.c.vehicleBoard(b, p);
  a.layers.filter(l => !l.veh).forEach(l => { l.current = 0; });
  f.c.sweepDeadEnemies();
  assert.ok(a.dead || a._removed);
  assert.ok(b.vehMerged);
  assert.equal(armorOf(f, p), 88);
  // 玩家驾驶员
  const g = field([{ id: "riot_baton", lv: 5, zone: 2 }]);
  const kk = g.P("kolt"), hh = g.P("helu");
  const q = car(g, 1);
  kk.zone = 1; hh.zone = 1;
  g.c.vehicleBoard(kk, q); g.c.vehicleBoard(hh, q);
  assert.ok(kk.vehMerged);
  kk.layers.filter(l => !l.veh).forEach(l => { l.current = 0; });
  g.c.applyKnockdown(kk, []);
  assert.ok(hh.vehMerged && !hh.fused, "玩家驾驶员倒下，下一个人接任");
  assert.ok(!kk.vehId);
});

/* ---------- 代挡 ---------- */
test("代挡：堡垒在场时，同区同阵营的单位每次挨打各掷 40%，成功由堡垒承受伤害（打在车的装甲上），失败打本人", () => {
  const f = riotField(3, 2);
  const [pilot, x] = riots(f);
  const p = car(f, 2); f.c.vehicleBoard(pilot, p);
  const k = f.P("kolt"); k.zone = 2; fleshOnly(k);
  const xHp = f.c.totalHp(x);
  rnd(f, 0.39);   // < 0.4：代挡成功
  hit(f, k, x, { atk: 10 });
  assert.equal(f.c.totalHp(x), xHp, "被代挡的人没受伤");
  assert.ok(armorOf(f, p) < 88, "车的装甲吃了这一击");
  const a1 = armorOf(f, p);
  rnd(f, 0.41);   // ≥ 0.4：没挡
  hit(f, k, x, { atk: 10 });
  assert.ok(f.c.totalHp(x) < xHp, "没挡住就打在本人身上");
  assert.equal(armorOf(f, p), a1);
  assert.equal(get(f.c, "VEHICLES").fortress.cover.chance, 0.4);
});

test("代挡：大量掷骰比例约 40%；击破也打在车上", () => {
  const f = riotField(2, 2);
  const [pilot, x] = riots(f);
  const p = car(f, 2); f.c.vehicleBoard(pilot, p);
  const k = f.P("kolt"); k.zone = 2; fleshOnly(k);
  f.c.Math.random = f.c.makeRng("COVER-RATE");
  let blocked = 0; const N = 600;
  x.layers.forEach(l => { l.max = 99999; l.current = 99999; });
  pilot.layers[0].max = 99999999; pilot.layers[0].current = 99999999;
  for (let i = 0; i < N; i++) {
    const a0 = pilot.layers[0].current;
    x.def = x.defMax; pilot.def = pilot.defMax;
    hit(f, k, x, { atk: 10, baseBreak: 1 });
    if (pilot.layers[0].current < a0) blocked++;
  }
  assert.ok(Math.abs(blocked / N - 0.4) < 0.06, `代挡比例 ${(blocked / N * 100).toFixed(1)}%`);
  // 击破同样由车承受：和直接打车的击破一样多
  rnd(f, 0.99);
  pilot.def = pilot.defMax;
  hit(f, k, pilot, { atk: 1, baseBreak: 2 });
  const direct = pilot.defMax - pilot.def;
  assert.ok(direct >= 2);
  rnd(f, 0.1);
  x.def = x.defMax; pilot.def = pilot.defMax;
  hit(f, k, x, { atk: 1, baseBreak: 2 });
  assert.equal(x.def, x.defMax, "被代挡的人架势不变");
  assert.equal(pilot.defMax - pilot.def, direct, "击破由车（架势用车的）承受");
});

test("代挡：范围攻击也算——一次范围攻击打到同区几个人，每人各掷一次，堡垒可以一次代挡很多次", () => {
  const f = riotField(5, 2);
  const list = riots(f);
  const pilot = list[0], others = list.slice(1);
  const p = car(f, 2); f.c.vehicleBoard(pilot, p);
  const k = f.P("kolt"); k.zone = 2; fleshOnly(k);
  const hp0 = others.map(u => f.c.totalHp(u));
  // 每个人各掷一次：只在代挡判定（vehicleGuard）里按 成功、失败、成功、成功 给点数，别处的随机数不动
  let n = 0, inGuard = false;
  const seq = [0.1, 0.9, 0.2, 0.3];
  const orig = f.c.vehicleGuard;
  f.c.vehicleGuard = (...args) => { inGuard = true; try { return orig(...args); } finally { inGuard = false; } };
  rnd(f, () => (inGuard ? seq[n++] : 0.5));
  const a0 = armorOf(f, p);
  others.forEach(u => hit(f, k, u, { atk: 10, flags: { action: true, aoe: true, blockResolved: true } }));
  const lost = others.map((u, i) => hp0[i] - f.c.totalHp(u));
  assert.equal(n, 4, "四个人各掷一次");
  eq(lost.map(x => x > 0), [false, true, false, false], "三次代挡成功、一人自己挨打");
  assert.ok(armorOf(f, p) < a0, "车承受了三次");
  const one = (() => { const y = armorOf(f, p); return y; })();
  assert.ok(one < a0);
});

test("张开掩体：代挡变 100%，堡垒受伤 −25%；驾驶员下次行动前一直有效，行动后收起", () => {
  const f = riotField(2, 2);
  const [pilot, x] = riots(f);
  const p = car(f, 2); f.c.vehicleBoard(pilot, p);
  const k = f.P("kolt"); k.zone = 2; fleshOnly(k);
  x.layers.forEach(l => { l.max = 9999; l.current = 9999; });
  rnd(f, 0.99);   // 平时 40% 掷不中
  const a0 = armorOf(f, p);
  hit(f, k, x, { atk: 40 });
  assert.equal(armorOf(f, p), a0, "不开掩体时 0.99 掷不中");
  const plain = (() => { const a1 = armorOf(f, p); hit(f, k, pilot, { atk: 40 }); return a1 - armorOf(f, p); })();
  // 张开掩体
  pilot.layers[0].current = 88;
  use(f, pilot, "veh_cover");
  assert.ok(p.veh.cover);
  const a2 = armorOf(f, p), xHp = f.c.totalHp(x);
  hit(f, k, x, { atk: 40 });
  assert.equal(f.c.totalHp(x), xHp, "掩体下 100% 代挡");
  const covered = a2 - armorOf(f, p);
  // 「受伤 −25%」和克制表的百分比加算：物理打装甲 −25%，再减 25%（40×0.25 = 10）
  assert.equal(plain - covered, 10, `受伤 −25%（加算）：${plain} → ${covered}`);
  // 驾驶员再行动（开炮）：掩体收起
  const t = f.P("kolt");
  use(f, pilot, "veh_fire", t);
  assert.ok(!p.veh.cover, "行动后掩体收起");
});

test("代挡：空车也会代挡，替最后坐在车上的一方（开战时的空车属于镇压队）；车被我方占着就替我方挡", () => {
  const f = riotField(2, 2);
  const [x, y] = riots(f);
  const k = f.P("kolt"), hl = f.P("helu");
  k.zone = 2; hl.zone = 2; fleshOnly(k); fleshOnly(hl);
  const p = car(f, 2);   // 空车，默认属于镇压队
  assert.equal(f.c.vehicleSide(p), "enemy");
  const xHp = f.c.totalHp(x);
  rnd(f, 0.1);
  hit(f, k, x, { atk: 10 });
  assert.equal(f.c.totalHp(x), xHp, "空车替镇压队代挡");
  assert.ok(p.hp < 88, "伤害打在空车的装甲上");
  // 我方单位挨打：空车不替他挡
  const hh = f.c.totalHp(hl);
  hit(f, x, hl, { atk: 10 });
  assert.ok(f.c.totalHp(hl) < hh, "空车是镇压队的，不替我方挡");
  // 我方占车后：替我方挡，不替镇压队挡
  f.c.vehicleBoard(k, p);
  f.c.vehicleLeave(k);   // 我方最后离开：空车属于我方
  assert.equal(f.c.vehicleSide(p), "player");
  const xHp2 = f.c.totalHp(x), hh2 = f.c.totalHp(hl);
  rnd(f, 0.1);
  hit(f, y, hl, { atk: 10 });
  assert.equal(f.c.totalHp(hl), hh2, "空车替我方挡");
  const k2 = f.S.units.find(u => u.kit === "kolt");
  hit(f, k2, x, { atk: 10 });
  assert.ok(f.c.totalHp(x) < xHp2, "不再替镇压队挡");
});

test("代挡：不同区的单位不挡；自己人打的不挡", () => {
  const f = riotField(2, 2, { zoneMode: 3 });
  const [pilot, x] = riots(f);
  const p = car(f, 2); f.c.vehicleBoard(pilot, p);
  const k = f.P("kolt"); k.zone = 2; fleshOnly(k);
  x.zone = 3;
  const xHp = f.c.totalHp(x);
  rnd(f, 0.1);
  hit(f, k, x, { atk: 10 });
  assert.ok(f.c.totalHp(x) < xHp, "x 在 3 区，车在 2 区：不代挡");
  x.zone = 2;
  const xHp2 = f.c.totalHp(x), a0 = armorOf(f, p);
  hit(f, pilot, x, { atk: 10 });   // 镇压队自己人打的
  assert.ok(f.c.totalHp(x) < xHp2 && armorOf(f, p) === a0, "自己人打的不代挡");
});

/* ---------- 殉爆 ---------- */
test("殉爆：车被摧毁，同区所有单位（不分敌我）1×atk 火并灼烧；车里的人被甩出来立刻失衡，再吃 2×atk 火和灼烧", () => {
  const f = riotField(4, 2, { lv: 3 });
  const [a, b, bystander] = riots(f);
  const p = car(f, 2, 5);   // atk 11
  f.c.vehicleBoard(a, p); f.c.vehicleBoard(b, p);
  const k = f.P("kolt"), hl = f.P("helu");
  k.zone = 2; hl.zone = 1;
  fleshOnly(k); fleshOnly(bystander);
  const kHp = f.c.totalHp(k), bHp = f.c.totalHp(bystander);
  [a, b].forEach(u => { u.layers.filter(l => !l.veh).forEach(l => { l.max = 9999; l.current = 9999; }); });
  const aHp = f.c.totalHp(a) - a.layers[0].current;   // 驾驶员自己的层
  rnd(f, 0.99);
  a.layers[0].current = 1;
  hit(f, k, a, { atk: 50 });   // 打爆装甲
  assert.ok(!f.S.props.includes(p), "车被移出战场");
  eq([a.vehId, b.vehId, a.fused, b.fused], [null, null, false, false], "车里的人都被甩出来");
  // 同区的玩家和同伙都挨了 1×atk(11) 火：火打肉体 +50%
  const dk = kHp - f.c.totalHp(k), db = bHp - f.c.totalHp(bystander);
  assert.ok(dk >= 16 && dk <= 17, `玩家 ${dk}`);   // 11 × 1.5 = 16.5
  assert.ok(db >= 16 && db <= 17 || db > 0, `同伙 ${db}`);
  assert.ok((k.statuses.burn || 0) >= 1 && (bystander.statuses.burn || 0) >= 1, "灼烧 1");
  assert.equal(hl.statuses.burn || 0, 0, "别的区不受影响");
  // 乘员：失衡 + 额外 2×atk 火 + 灼烧
  [a, b].forEach(u => {
    assert.ok(u.stunned, `${u.name} 立刻失衡`);
    assert.ok((u.statuses.burn || 0) >= 1, "灼烧");
  });
  const bLost = (9999 + 9999) - f.c.totalHp(b);   // 两层 9999
  assert.ok(bLost > 0, "乘员受了 1×atk + 2×atk");
});

test("殉爆：车里的精英也直接晕眩，不看晕眩标记", () => {
  const f = field([{ id: "riot_flamer", lv: 12, zone: 2 }, { id: "riot_baton", lv: 5, zone: 2 }]);
  const fl = f.E("riot_flamer"), bt = f.E("riot_baton");
  assert.ok(f.c.isBossUnit(fl), "12 级精英用晕眩标记");
  const p = car(f, 2, 5);
  f.c.vehicleBoard(bt, p); f.c.vehicleBoard(fl, p);
  f.c.vehicleDestroy(p, []);
  assert.ok(fl.stunned, "精英直接晕眩");
  assert.equal(fl.stunMarks, 2, "晕眩标记直接攒满");
});

test("殉爆：空车被打爆也一样（同区所有单位，不分敌我）", () => {
  const f = riotField(1, 2);
  const [x] = riots(f);
  const k = f.P("kolt"); k.zone = 2; fleshOnly(k);
  const p = car(f, 2, 5);
  const kHp = f.c.totalHp(k);
  p.hp = 1;
  f.c.damageProp(p, { element: "physical", dmg: 50 }, k);
  assert.ok(!f.S.props.includes(p), "空车被摧毁");
  assert.ok(f.c.totalHp(k) < kHp, "我方也挨了殉爆");
  assert.ok((x.statuses.burn || 0) >= 1, "同伙也挨了");
});

/* ---------- 抢车 ---------- */
test("敌我不能同车：车上还有对方的人时不能上车（两边都一样）", () => {
  const f = riotField(2, 2);
  const [a, b] = riots(f);
  const k = f.P("kolt"); k.zone = 2; k.profs = { "载具驾驶": 2, "运动": 2 };
  const p = car(f, 2);
  f.c.vehicleBoard(a, p);
  assert.match(f.c.vehicleBoardError(k, p), /还有敌人/, "我方：车上有敌人不能上");
  const q = car(f, 2); f.c.vehicleBoard(k, q);
  assert.match(f.c.vehicleBoardError(b, q), /还有对方的人/, "敌人：车上有我方的人不能上");
});

test("拉人下车（我方）：同区 1 行动点，困难「运动」检定；成功把对方一人拉下车，驾驶员被拉下按上车顺序换人；失败行动点照扣", () => {
  const f = riotField(3, 2);
  const [a, b, d] = riots(f);
  const p = car(f, 2); [a, b, d].forEach(u => f.c.vehicleBoard(u, p));
  const k = f.P("kolt"); k.zone = 2; k.profs = { "运动": 2 };   // 二级熟练：困难 50%
  const odds = f.c.vehicleCheckOdds(k, get(f.c, "VEHICLE_RULES").pullCheck);
  assert.equal(odds.base, 0.5, "困难检定二级熟练 50%");
  eq(get(f.c, "VEHICLE_RULES").pullCheck, { prof: "运动", diff: 2 });
  assert.equal(get(f.c, "VEHICLE_RULES").pullAp, 1);
  // 失败
  k.ap = 1; rnd(f, 0.9);
  use(f, k, `veh_pull:${p.id}:${a.id}`);
  assert.equal(k.ap, 0, "失败行动点照扣");
  assert.ok(a.vehMerged && a.vehId === p.id, "没拉下来");
  // 成功：拉驾驶员
  k.ap = 1; rnd(f, 0.1);
  use(f, k, `veh_pull:${p.id}:${a.id}`);
  assert.ok(!a.vehId && a.zone === 2, "驾驶员被拉下车，落在车所在的区");
  assert.ok(b.vehMerged, "按上车顺序换人接任");
  // 拉炮手
  k.ap = 1; rnd(f, 0.1);
  use(f, k, `veh_pull:${p.id}:${d.id}`);
  assert.ok(!d.vehId && !d.fused);
});

test("拉人下车：没有「运动」熟练做不了困难检定；拉人要同区；自己人不能拉；车里的人不能拉", () => {
  const f = riotField(1, 2, { zoneMode: 3 });
  const [a] = riots(f);
  const p = car(f, 2); f.c.vehicleBoard(a, p);
  const k = f.P("kolt"); k.zone = 2; k.profs = {};
  assert.match(f.c.vehiclePullError(k, p, a), /没有「运动」熟练/);
  k.profs = { "运动": 2 };
  k.zone = 3;
  assert.match(f.c.vehiclePullError(k, p, a), /同区/);
  k.zone = 2;
  assert.equal(f.c.vehiclePullError(k, p, a), null);
  // 可以改成「没有熟练也按 50%」：unskilledChance
  k.profs = {};
  get(f.c, "VEHICLE_RULES").unskilledChance = 0.5;
  assert.equal(f.c.vehiclePullError(k, p, a), null, "unskilledChance 填数后没有熟练也能尝试");
});

test("拉人下车（敌人）：成功率 25%；镇压队 AI 在我方占着车时会尝试把驾驶员拉下来", () => {
  const f = riotField(2, 2);
  const [a, b] = riots(f);
  const k = f.P("kolt"); k.zone = 2; k.profs = { "载具驾驶": 2 };
  const p = car(f, 2);
  // 我方占车
  k.ap = 1; rnd(f, 0.1);
  use(f, k, `veh_board:${p.id}`);
  assert.ok(k.vehMerged && f.c.vehicleSide(p) === "player");
  assert.equal(get(f.c, "VEHICLE_RULES").pullEnemyChance, 0.25);
  // AI：计划是拉人
  b.ap = 1; b.stunned = false; f.S.combatPhase = "enemy";
  const plan = f.c.EnemyAI.plan(b);
  assert.ok(plan && plan.meta.skillId === `veh_pull:${p.id}:${k.id}`, `AI 计划 ${plan && plan.meta.skillId}`);
  // 25%：掷 0.3 失败，0.2 成功
  rnd(f, 0.3); plan.thunk(); f.c.BattleSim.resolveQueues(noBlock);
  assert.ok(k.vehId, "0.3 ≥ 25%：失败");
  b.ap = 1; rnd(f, 0.2);
  f.c.EnemyAI.plan(b).thunk(); f.c.BattleSim.resolveQueues(noBlock);
  assert.ok(!k.vehId, "0.2 < 25%：成功，我方被拉下车");
  assert.equal(k.zone, 2);
});

test("上车（我方）：车上没有对方的人以后，过普通「载具驾驶」检定才上得去；没有熟练的做不了；上去第一个就是驾驶员", () => {
  const f = riotField(1, 2);
  const k = f.P("kolt"); k.zone = 2;
  const p = car(f, 2);
  k.profs = {};
  assert.match(f.c.vehicleBoardError(k, p), /没有「载具驾驶」熟练/);
  k.profs = { "载具驾驶": 1 };   // 一级熟练：普通 50%
  assert.equal(f.c.vehicleCheckOdds(k, get(f.c, "VEHICLE_RULES").boardCheck).base, 0.5);
  k.ap = 1; rnd(f, 0.9);
  use(f, k, `veh_board:${p.id}`);
  assert.ok(!k.vehId, "检定失败没上去");
  assert.equal(k.ap, 0, "行动点照扣");
  k.ap = 1; rnd(f, 0.1);
  use(f, k, `veh_board:${p.id}`);
  assert.ok(k.vehMerged, "第一个上车的是驾驶员");
  assert.equal(f.c.vehicleSide(p), "player");
  // 车被我方占着：同区的我方单位被代挡，镇压队不被代挡
  const hl = f.P("helu"); hl.zone = 2; fleshOnly(hl);
  const [x] = riots(f);
  rnd(f, 0.1);
  const h0 = f.c.totalHp(hl);
  hit(f, x, hl, { atk: 10 });
  assert.equal(f.c.totalHp(hl), h0, "车替车上那一方（我方）代挡");
});

test("敌人上车：直接上（不过检定），花 1 行动点；车上有我方的人时 AI 不会硬上", () => {
  const f = riotField(2, 2);
  const [a, b] = riots(f);
  const p = car(f, 2);
  a.ap = 1; f.S.combatPhase = "enemy";
  const plan = f.c.EnemyAI.plan(a);
  assert.equal(plan.meta.skillId, `veh_board:${p.id}`, "空车：AI 上去开");
  plan.thunk(); f.c.BattleSim.resolveQueues(noBlock);
  assert.ok(a.vehMerged && a.ap === 0);
});

/* ---------- 车上的招式 ---------- */
test("开炮：2 距离内一个目标，1×atk + 开炮骰 火，1 击破，50% 灼烧 1（炮手和驾驶员一样，用车的 atk）", () => {
  const f = riotField(2, 3, { zoneMode: 3, lv: 5 });
  const [a, b] = riots(f);
  const p = car(f, 3, 5);   // atk 11，开炮骰 1d8
  f.c.vehicleBoard(a, p); f.c.vehicleBoard(b, p);
  const k = f.P("kolt"); k.zone = 1; fleshOnly(k); k.statuses.burn = 0;
  const d0 = k.def, h0 = f.c.totalHp(k);
  // 距离 2：灼烧的 50% 先掷（0.3 掷中），之后的骰子最大 0.99 → 8；火打肉体 +50%：(11 + 8) × 1.5 = 28.5
  let n = 0;
  rnd(f, () => (n++ === 0 ? 0.3 : 0.99));
  use(f, b, "veh_fire", k);
  const lost = h0 - f.c.totalHp(k);
  assert.ok(lost >= 27 && lost <= 29, `炮手用车的 atk 11：(11+1d8)×1.5，实际 ${lost}`);
  assert.equal(d0 - k.def, 1, "1 击破");
  assert.equal(k.statuses.burn, 1, "50% 掷中：灼烧 1");
});

test("开炮：灼烧只有 50%（掷不中不灼烧）；距离 3 以外打不到", () => {
  const f = riotField(1, 3, { zoneMode: 3 });
  const [a] = riots(f);
  const p = car(f, 3, 5); f.c.vehicleBoard(a, p);
  const k = f.P("kolt"); k.zone = 1; fleshOnly(k); k.statuses.burn = 0;
  rnd(f, 0.6);
  use(f, a, "veh_fire", k);
  assert.equal(k.statuses.burn || 0, 0, "0.6 ≥ 50%：不灼烧");
  k.statuses.burn = 0; a.ap = 1;
  rnd(f, 0.3);
  use(f, a, "veh_fire", k);
  assert.equal(k.statuses.burn, 1, "0.3 < 50%：灼烧 1");
  assert.match(f.c.vehicleSkillWhy(a, "veh_fire", Object.assign({}, k, { zone: 1 })) || "", /^$/);
});

test("焚烧：同区所有敌对单位 0.5×atk 火、灼烧 1（不打同阵营）", () => {
  const f = riotField(2, 2, { lv: 5 });
  const [a, b] = riots(f);
  const p = car(f, 2, 5); f.c.vehicleBoard(a, p); f.c.vehicleBoard(b, p);
  const k = f.P("kolt"), hl = f.P("helu"); k.zone = 2; hl.zone = 2; fleshOnly(k); fleshOnly(hl);
  const kh = f.c.totalHp(k), hh = f.c.totalHp(hl), ah = f.c.totalHp(a);
  use(f, b, "veh_burn");
  // 0.5 × 11 = 5.5 → 火打肉体 ×1.5 ≈ 8
  [[k, kh], [hl, hh]].forEach(([u, h0]) => {
    const lost = h0 - f.c.totalHp(u);
    assert.ok(lost >= 7 && lost <= 9, `${u.name} ${lost}`);
    assert.equal(u.statuses.burn, 1, "灼烧 1");
  });
  assert.equal(f.c.totalHp(a), ah, "不打同阵营");
});

test("驾驶员：附赠冲撞——移动一个区带着整辆车，然后撞一个单位 0.75×atk 物理 + 2 击破；开车时炮手跟着走", () => {
  const f = riotField(2, 2, { zoneMode: 3, lv: 5 });
  const [a, b] = riots(f);
  const p = car(f, 2, 5); f.c.vehicleBoard(a, p); f.c.vehicleBoard(b, p);
  const k = f.P("kolt"); k.zone = 1; fleshOnly(k);
  a.bonus = 1; a.ap = 1;
  const d0 = k.def, h0 = f.c.totalHp(k);
  f.S.combatPhase = "enemy"; f.S.attackerId = a.id; f.S.targetId = k.id;
  rnd(f, 0.5);
  f.c.runSkill("veh_ram");
  f.c.BattleSim.resolveQueues(noBlock);
  assert.equal(a.zone, 1, "开到目标所在的区");
  assert.equal(p.zone, 1);
  assert.equal(b.zone, 1, "炮手跟着车走");
  assert.equal(a.bonus, 0, "附赠行动");
  assert.equal(a.ap, 1, "不花行动点");
  assert.equal(d0 - k.def, 2, "2 击破");
  assert.equal(h0 - f.c.totalHp(k), Math.floor(0.75 * 11), "0.75×atk(11) 物理 = 8（玩家肉体物理克制 ×1）");
  // 炮手不能自己移动
  assert.equal(f.c.skillList(b).some(s => s.id === "veh_ram" || s.id === "veh_cover"), false, "炮手没有冲撞 / 掩体");
});

test("车上的人只能用车的武器：技能表只有车上的招式；炮手不能自己移动", () => {
  const f = riotField(2, 2);
  const [a, b] = riots(f);
  const p = car(f, 2); f.c.vehicleBoard(a, p); f.c.vehicleBoard(b, p);
  eq(f.c.enemySkillList(a).map(s => s.id), ["veh_fire", "veh_burn", "veh_cover", "veh_ram", "veh_leave"]);
  eq(f.c.enemySkillList(b).map(s => s.id), ["veh_fire", "veh_burn", "veh_leave"]);
  const z = b.zone;
  f.S.combatPhase = "enemy"; b.bonus = 1;
  f.c.doMove(b, z === 1 ? 2 : 1);
  assert.equal(b.zone, z, "炮手不能自己移动");
});

/* ---------- 我方开车 ---------- */
test("我方：坐上车的玩家用车的武器（技能表只有车上的招式），开炮用车的 atk，行动点按 1 点算", () => {
  const f = riotField(1, 2, { lv: 5 });
  const k = f.P("kolt"), hl = f.P("helu"); k.zone = 2; hl.zone = 2; k.profs = { "载具驾驶": 3 };
  const [x] = riots(f); fleshOnly(x);
  const p = car(f, 2, 5);
  f.c.vehicleBoard(k, p);
  const ids = f.c.skillList(k).map(s => s.id);
  eq(ids, ["veh_fire", "veh_burn", "veh_cover", "veh_ram", "veh_leave"]);
  k.ap = 1;
  const h0 = f.c.totalHp(x);
  let n = 0;
  rnd(f, () => (n++ === 0 ? 0.3 : 0.99));
  use(f, k, "veh_fire", x);
  assert.equal(k.ap, 0, "开炮花 1 行动点");
  const lost = h0 - f.c.totalHp(x);
  assert.ok(lost >= 27 && lost <= 29, `用车的 atk 11：(11+1d8)×1.5，实际 ${lost}`);
  // 玩家界面：同区有空车时多出「上车」
  const g = riotField(1, 2);
  const kk = g.P("kolt"); kk.zone = 2; car(g, 2);
  assert.ok(g.c.vehicleGroundSkills(kk).some(s => /^veh_board:/.test(s.id)));
});

/* ---------- 开局 ---------- */
test("开局一定有一个镇压队敌人坐在车上当驾驶员，车停在驾驶员的区，一场最多一台", () => {
  const c = H.load();
  c.Math.random = c.makeRng("VEH-OPEN");
  for (let i = 0; i < 60; i++) {
    const spec = { zoneMode: 2, enemies: [{ preset: "riot_baton", zone: 2, count: 1 }, { preset: "riot_rifle", zone: 2, count: 2 }], vehicles: [{ kind: "fortress" }, { kind: "fortress" }] };
    c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [], seed: "o" + i });
    const S = c.S.state;
    S.units = S.units.filter(u => u.isPlayer); S.props = [];
    const made = c.buildEncounter(spec, 5, 2);
    const cars = S.props.filter(p => p.isVehicle);
    assert.equal(cars.length, 1, "一场最多一台");
    const pilot = c.vehiclePilot(cars[0]);
    assert.ok(pilot && made.includes(pilot) && /^riot_/.test(pilot.kit) && !pilot.isPlayer, "驾驶员是这场遭遇里的镇压队");
    assert.ok(pilot.vehMerged && cars[0].zone === pilot.zone);
    assert.equal(c.vehicleSide(cars[0]), "enemy");
  }
});

test("遭遇：镇压队的遭遇有 30% 带一台移动堡垒，别的阵营没有", () => {
  const c = H.load();
  const riotSpec = { enemies: [{ preset: "riot_baton" }, { preset: "riot_rifle" }] };
  c.Math.random = () => 0.29; eq(JSON.parse(JSON.stringify(c.vehicleRollEncounter(riotSpec))), [{ kind: "fortress" }]);
  c.Math.random = () => 0.31; eq(JSON.parse(JSON.stringify(c.vehicleRollEncounter(riotSpec))), []);
  c.Math.random = () => 0.1;
  eq(JSON.parse(JSON.stringify(c.vehicleRollEncounter({ enemies: [{ preset: "guard_sword" }] }))), [], "没有镇压队就没有车");
  // 抽遭遇：整体比例约 30%，且只出现在有镇压队的遭遇里
  c.Math.random = c.makeRng("VEH-ENC");
  let riotFights = 0, withCar = 0;
  for (let i = 0; i < 1500; i++) {
    const e = c.rollEncounter({ region: "外城区", zoneMode: 2, faction: "镇压队", mixed: false });
    assert.ok(Array.isArray(e.vehicles) && e.vehicles.length <= 1, "一场最多一台");
    riotFights++;
    if (e.vehicles.length) withCar++;
  }
  assert.ok(Math.abs(withCar / riotFights - 0.3) < 0.05, `约 30%，实际 ${(withCar / riotFights * 100).toFixed(1)}%`);
  for (let i = 0; i < 200; i++) {
    const e = c.rollEncounter({ region: "外城区", zoneMode: 2, faction: "盗匪", mixed: false });
    eq(JSON.parse(JSON.stringify(e.vehicles)), [], "盗匪的遭遇没有车");
  }
});

/* ---------- AI ---------- */
test("AI：炮手 / 驾驶员在敌人回合开炮或焚烧；炮手也会行动（他们藏在车里、不在普通名单里）", () => {
  const f = riotField(3, 2);
  const [a, b] = riots(f);
  const p = car(f, 2, 5); f.c.vehicleBoard(a, p); f.c.vehicleBoard(b, p);
  const k = f.P("kolt"), hl = f.P("helu"); k.zone = 2; hl.zone = 2; fleshOnly(k); fleshOnly(hl);
  f.S.combatPhase = "enemy";
  [a, b].forEach(u => { u.ap = 1; u.stunned = false; });
  assert.ok(f.c.EnemyAI.actingOrder().includes(b.id), "炮手在行动名单里");
  const plan = f.c.EnemyAI.plan(b);
  assert.equal(plan.meta.skillId, "veh_burn", "同区两个敌人：焚烧");
  const h0 = f.c.totalHp(k);
  plan.thunk(); f.c.BattleSim.resolveQueues(noBlock);
  assert.ok(f.c.totalHp(k) < h0 && f.c.totalHp(hl) < f.c.totalHp(hl) + 1);
  // 同区只有一个敌人：开炮
  hl.zone = 1; a.ap = 1;
  const plan2 = f.c.EnemyAI.plan(a);
  assert.equal(plan2.meta.skillId, "veh_fire");
});

test("AI：驾驶员有附赠时同区没人就冲撞邻区的人；炮手不会自己移动；车快炸了跳车", () => {
  const f = riotField(2, 2, { zoneMode: 3 });
  const [a, b] = riots(f);
  const p = car(f, 2, 5); f.c.vehicleBoard(a, p); f.c.vehicleBoard(b, p);
  const k = f.P("kolt"), hl = f.P("helu"); k.zone = 1; hl.zone = 1;
  f.S.combatPhase = "enemy";
  a.ap = 1; a.bonus = 1; a.stunned = false;
  const plan = f.c.EnemyAI.plan(a);
  assert.equal(plan.meta.skillId, "veh_ram", "邻区有人：冲撞");
  // 车快炸了（装甲 ≤ 25%）：跳车
  a.layers[0].current = Math.floor(a.layers[0].max * 0.2);
  assert.equal(f.c.EnemyAI.plan(a).meta.skillId, "veh_leave");
  assert.equal(f.c.EnemyAI.plan(b).meta.skillId, "veh_leave");
});

test("AI：没上车的镇压队在车所在的区会上车；车快炸了不上；近战兵身边有敌人先打", () => {
  const f = riotField(3, 2);
  const [baton, rifle, molotov] = riots(f);
  const p = car(f, 2, 5);
  const k = f.P("kolt"); k.zone = 2;
  f.S.combatPhase = "enemy";
  rifle.ap = 1;
  assert.equal(f.c.EnemyAI.plan(rifle).meta.skillId, `veh_board:${p.id}`, "空车：谁都去开");
  f.c.vehicleBoard(rifle, p);
  baton.ap = 1;
  const planB = f.c.EnemyAI.plan(baton);
  assert.ok(!planB || planB.meta.skillId !== `veh_board:${p.id}`, "近战兵身边有敌人：先打");
  k.zone = 1;
  molotov.ap = 1;
  assert.equal(f.c.EnemyAI.plan(molotov).meta.skillId, `veh_board:${p.id}`, "远程兵有座位就上");
  // 快炸的车不上
  rifle.layers[0].current = 1; f.c.vehicleLeave(rifle);
  p.hp = 5;
  molotov.ap = 1;
  const planM = f.c.EnemyAI.plan(molotov);
  assert.ok(!planM || !/^veh_board/.test(planM.meta.skillId || ""), "快炸的车不上");
});

test("整场模拟：带车的镇压队打一场不报错，车能开炮 / 被打爆", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "riot_baton", lv: 3, zone: 2 }, { id: "riot_rifle", lv: 3, zone: 2 }, { id: "riot_molotov", lv: 3, zone: 2 }], seed: "VEH-SIM", zoneMode: 2 });
  const S = c.S.state;
  const crew = S.units.filter(u => !u.isPlayer);
  const p = c.vehicleSpawn("fortress", 2, 3, 2);
  c.vehicleBoard(crew[1], p); c.vehicleBoard(crew[0], p); c.vehicleBoard(crew[2], p);
  const res = c.BattleSim.run({ maxRounds: 12 });
  assert.ok(res, "跑完了");
  eq(c.__errors, [], "没有报错");
});

/* ---------- 显示、联机 ---------- */
test("显示：乘员 n / 4，悬停列出驾驶员和炮手（只有名字）；驾驶员身上有「驾驶员」标记", () => {
  const f = riotField(3, 2);
  const [a, b, d] = riots(f);
  const p = car(f, 2);
  assert.equal(f.c.vehicleSeatText(p), "乘员 0 / 4");
  eq(f.c.vehicleRosterLines(p), ["车上没有人"]);
  f.c.vehicleBoard(a, p); f.c.vehicleBoard(b, p);
  assert.equal(f.c.vehicleSeatText(p), "乘员 2 / 4");
  eq(f.c.vehicleRosterLines(p), [`驾驶员：${a.name}`, `炮手：${b.name}`]);
  assert.match(f.c.statusLine(a), /驾驶员 乘员 2 \/ 4/);
});

test("联机：配置物下发乘员 n / 4 和名单，不带坚毅等数值", () => {
  const f = riotField(2, 2);
  const [a, b] = riots(f);
  const p = car(f, 2); f.c.vehicleBoard(a, p); f.c.vehicleBoard(b, p);
  f.P("kolt").shp = 777001;
  Object.assign(globalThis, { state: f.S, vehicleSeatText: f.c.vehicleSeatText, vehicleRosterLines: f.c.vehicleRosterLines, vehicleOccupants: f.c.vehicleOccupants });
  try {
    delete require.cache[require.resolve("../online-view.js")];
    const OV = require("../online-view.js");
    const view = OV.projectState(f.S, {});
    assert.ok(view, "能生成联机视图");
    const prop = view.props.find(x => x.id === p.id);
    assert.equal(prop.kind, "fortress");
    assert.equal(prop.seatText, "乘员 2 / 4");
    eq(prop.roster.map(s => s.normalize("NFKC")), [`驾驶员:${a.name}`, `炮手:${b.name}`], "联机文字过滤会把全角冒号规范成半角");
    // 炮手藏在车里：联机视图里是隐藏的
    const bu = view.units.find(u => u.id === b.id);
    assert.ok(!bu || bu.hidden, "炮手不下发成可见单位");
    assert.doesNotMatch(JSON.stringify(view), /777001|"shp"/, "坚毅生命不进玩家数据");
  } finally { for (const k of ["state", "vehicleSeatText", "vehicleRosterLines", "vehicleOccupants"]) delete globalThis[k]; }
});
