// 外城区镇压部队（docs/suppression-force.md 第 1、2 节）：五个兵种的数值、招式、协助、AI、阵营和遭遇
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const vm = require("vm");
const plain = x => JSON.parse(JSON.stringify(x));
/** 顶层 const（ENEMY_INFO 等）不挂在 window 上，用 vm 取 */
const get = (c, expr) => vm.runInContext(expr, c);

function field(enemies, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: opt.party || ["kolt", "helu"], enemies, seed: opt.seed || "RIOT", zoneMode: opt.zoneMode || 2 });
  c.startCombat();
  const S = c.S.state;
  S.units.forEach(u => { if (u.kit === "kolt") u.prideMaxHp = Infinity; });
  return {
    c, S,
    P: k => c.findKit(k, S.units),
    E: k => S.units.find(u => !u.isPlayer && u.kit === k && !u.dead),
    logs: () => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n")
  };
}
const tank = u => u.layers.forEach(l => { l.max = 9999; l.current = 9999; });
const noBlock = { pickBlocker: () => null, pickAssister: l => l[0].id };
const preset = (c, id) => c.enemyPresets().find(p => p.id === id);
const hpOf = (c, u) => c.totalHp(u);
/** 让敌人 a 对 t 用技能 id（我方不格挡） */
function use(f, a, id, t) {
  f.S.combatPhase = "enemy"; a.ap = Math.max(1, a.ap || 0); f.S.attackerId = a.id; f.S.targetId = t ? t.id : null;
  f.c.runSkill(id);
  f.c.BattleSim.resolveQueues(noBlock);
}
/** 把我方单位的血量层换成一层大肉体，方便看伤害（火打肉体 +50%：下面的伤害都按这个算） */
function fleshOnly(u) { u.layers = [{ type: "flesh", current: 9999, max: 9999, inner: true }]; }
function aiTurn(c, u, max) {
  const out = [];
  for (let n = 0; n < (max || 6); n++) {
    if (!u || u.dead || u.stunned || (u.ap || 0) <= 0) break;
    const plan = c.EnemyAI.plan(u);
    if (!plan) break;
    out.push(plan.meta.skillName);
    const before = `${u.ap}|${u.bonus}|${u.zone}`;
    plan.thunk();
    c.BattleSim.resolveQueues(noBlock);
    if (`${u.ap}|${u.bonus}|${u.zone}` === before) break;
  }
  return out;
}

/* ---------- 数值 ---------- */
// [兵种, 级别] → [护盾, 肉体, 架势, atk]（2 人队；精英 10 级起架势 ×60%，照现有规则）
const TABLE = {
  riot_baton:   { 1: [8, 12, 4, 3],   5: [16, 28, 4, 7],   10: [26, 48, 5, 12] },
  riot_rifle:   { 1: [6, 6, 3, 4],    5: [14, 14, 3, 8],   10: [24, 24, 4, 13] },
  riot_molotov: { 1: [5, 5, 3, 3],    5: [13, 13, 3, 7],   10: [23, 23, 4, 12] },
  riot_flamer:  { 1: [16, 26, 5, 5],  5: [40, 54, 6, 7],   10: [70, 89, 4, 9] },
  riot_captain: { 1: [15, 20, 4, 7],  5: [39, 40, 5, 11],  10: [69, 65, 4, 16] }
};
test("数值：五个兵种 1 / 5 / 10 级的血量层（外护盾内肉体）、架势、atk 与文档相符", () => {
  const c = H.load();
  Object.keys(TABLE).forEach(kit => {
    Object.keys(TABLE[kit]).forEach(lv => {
      const u = preset(c, kit).build(Number(lv), 2);
      const [sh, fl, def, atk] = TABLE[kit][lv];
      assert.deepEqual(plain(u.layers.map(l => [l.type, l.max])), [["shield", sh], ["flesh", fl]], `${kit} ${lv} 级血量层`);
      assert.deepEqual([u.defMax, u.atk], [def, atk], `${kit} ${lv} 级架势、atk`);
      assert.equal(u.suggest.element, "fire", "武器全是火");
    });
  });
});

test("数值：总血量同参照模板、atk 比参照低 1；精英的 atk 成长照队长、每级都少 1", () => {
  const c = H.load();
  const total = u => u.layers.reduce((s, l) => s + l.max, 0);
  [1, 5, 10].forEach(lv => {
    const hammer = preset(c, "thug_hammer").build(lv, 2), baton = preset(c, "riot_baton").build(lv, 2);
    assert.equal(total(baton), total(hammer)); assert.equal(baton.atk, hammer.atk - 1);
    const gun = preset(c, "guard_gun").build(lv, 2), rifle = preset(c, "riot_rifle").build(lv, 2);
    assert.equal(total(rifle), total(gun)); assert.equal(rifle.atk, gun.atk - 1);
    const ox = preset(c, "captain_ox").build(lv, 2), flamer = preset(c, "riot_flamer").build(lv, 2);
    assert.equal(flamer.atk, ox.atk - 1); assert.equal(flamer.layers[1].max, ox.layers[1].max, "牛队长的肉体 26 + 7/级");
    const wolf = preset(c, "captain_wolf").build(lv, 2), cap = preset(c, "riot_captain").build(lv, 2);
    assert.equal(cap.atk, wolf.atk - 1); assert.deepEqual(plain(cap.layers.map(l => l.max)), plain(wolf.layers.map(l => l.max)));
  });
});

test("数值：血量按队伍人数 scaleHp 缩放（4 人队 ×2.5）", () => {
  const c = H.load();
  const two = preset(c, "riot_flamer").build(5, 2), four = preset(c, "riot_flamer").build(5, 4);
  assert.equal(four.layers[0].max, Math.round(two.layers[0].max * 2.5));
});

test("登记：杂兵 / 精英、代币、阵营、区域和固定种族都写在配置表里", () => {
  const c = H.load();
  const want = { riot_baton: ["minion", 1, "兽人·牛"], riot_rifle: ["minion", 1, "兽人·熊"], riot_molotov: ["minion", 1, "兽人·蜥蜴"],
    riot_flamer: ["elite", 2, "兽人·熊"], riot_captain: ["elite", 2, "兽人·狼"] };
  Object.keys(want).forEach(k => {
    const i = get(c, "ENEMY_INFO")[k];
    assert.equal(get(c, "ENEMY_RANK")[k], want[k][0], k);
    assert.deepEqual([i.faction, i.regions.join(), i.tokens, i.race], ["镇压队", "外城区", want[k][1], want[k][2]], k);
    const bt = get(c, "BESTIARY_TEXT")[k];
    assert.ok(bt && bt.abilities.length, `${k} 图鉴`);
    assert.ok(bt.abilities[0].includes(want[k][2]), `${k} 图鉴写了种族`);
  });
});

/* ---------- 警棍盾 ---------- */
test("警棍盾：火焰警棍 atk + 1d4 火、2 击破、打中施加熔融；防暴盾之外没有别的减伤", () => {
  const f = field([{ id: "riot_baton", lv: 5, zone: 2 }]);
  const b = f.E("riot_baton"), k = f.P("kolt");
  k.zone = 2; fleshOnly(k); k.instant.melt = false;
  const d0 = k.def, h0 = hpOf(f.c, k);
  use(f, b, "en_riot_baton", k);
  assert.equal(d0 - k.def, 2, "2 击破");
  assert.ok(k.instant.melt, "熔融");
  const lost = h0 - hpOf(f.c, k);
  // 火打肉体 +50%：(atk 7 + 1d4) × 1.5 → 12 ~ 15（取整）
  assert.ok(lost >= 11 && lost <= 16, `伤害 ${lost}`);
});

test("警棍盾协助：冲到目标所在区，普通攻击一次（同样带熔融、2 击破）", () => {
  const f = field([{ id: "riot_baton", lv: 5, zone: 2 }]);
  const b = f.E("riot_baton"), k = f.P("kolt");
  k.zone = 1; fleshOnly(k); k.instant.melt = false;
  assert.equal(f.c.enemyAssistSkillId(b), "en_riot_baton_assist");
  assert.ok(f.c.enemyAssistReady(b, k), "隔一区也冲得过去");
  const d0 = k.def;
  use(f, b, "en_riot_baton_assist", k);
  assert.equal(b.zone, 1, "冲到目标那一区");
  assert.equal(d0 - k.def, 2);
  assert.ok(k.instant.melt);
});

test("防暴盾：自己的护盾层还有血时，同区友军受到的远程攻击 −25%（和其他百分比加算）；近战、护盾打空、不同区都不减", () => {
  const f = field([{ id: "riot_baton", lv: 5, zone: 1 }, { id: "riot_rifle", lv: 5, zone: 1 }, { id: "riot_rifle", lv: 5, zone: 3 }], { zoneMode: 3 });
  f.S.zoneMode = 3;
  const b = f.E("riot_baton"), k = f.P("kolt");
  const [r1, r3] = f.S.units.filter(u => u.kit === "riot_rifle");
  b.zone = 1; r1.zone = 1; r3.zone = 3; k.zone = 2; tank(k);
  const shoot = (target, flags, range) => {
    target.layers.forEach(l => { l.current = l.max = 9999; });
    f.c.Math.random = () => 0.5;
    const t0 = hpOf(f.c, target);
    f.S.combatPhase = "player"; f.S.attackerId = k.id; f.S.targetId = target.id;
    f.c.dealTo(k, target, { atk: 100, mult: 1, element: "physical", baseBreak: 0, atkRange: range || "ranged", flags: Object.assign({ action: true, blockResolved: true, block: "none" }, flags || {}) });
    return t0 - hpOf(f.c, target);
  };
  // 物理打护盾本来就有克制表的 −25%（基础包 100 → 75）；防暴盾的 −25% 和它加算 → 50（不是连乘的 56）
  const plainLoss = shoot(r3);                     // 另一区没有盾：不减
  assert.equal(plainLoss, 75);
  assert.equal(shoot(r1), 50, "盾墙那一区：再 −25%，和克制表加算");
  assert.equal(shoot(b), 50, "警棍盾自己也在盾墙里");
  assert.equal(shoot(r1, { dr25: true }), 25, "再叠一个自保 −25%：全部加在一起 −75%");
  // 护盾层打空：没有防暴盾
  const shield = b.layers.find(l => l.type === "shield");
  const loss0 = (() => { r1.layers.forEach(l => { l.current = l.max = 9999; }); shield.current = 0; const t0 = hpOf(f.c, r1); f.S.combatPhase = "player";
    f.c.dealTo(k, r1, { atk: 100, mult: 1, element: "physical", baseBreak: 0, atkRange: "ranged", flags: { action: true, blockResolved: true, block: "none" } }); return t0 - hpOf(f.c, r1); })();
  assert.equal(loss0, plainLoss, "护盾打空：不减");
  // 近战（同区、不是远程）不减
  shield.current = shield.max;
  k.zone = 1;
  assert.equal(shoot(r1, null, "melee"), plainLoss, "近战不减");
  // 两面盾不叠加
  const b2 = f.c.enemyPresets().find(p => p.id === "riot_baton").build(5, 2); b2.zone = 1; f.S.units.push(b2);
  k.zone = 2;
  assert.equal(shoot(r1), 50, "多面盾不叠加");
});

/* ---------- 燃烧步枪 ---------- */
test("燃烧步枪：远距 atk + 1d4 火、1 击破；打中后激活灼烧（立刻结算一次并叠层）；没有灼烧就不触发", () => {
  const f = field([{ id: "riot_rifle", lv: 5, zone: 2 }]);
  const r = f.E("riot_rifle"), k = f.P("kolt");
  k.zone = 1; fleshOnly(k);
  // 没有灼烧：只有枪的伤害，不触发任何状态
  k.statuses.burn = 0; k.statuses.shock = true;
  let d0 = k.def, h0 = hpOf(f.c, k);
  use(f, r, "en_riot_rifle", k);
  assert.equal(d0 - k.def, 1, "1 击破");
  assert.equal(k.statuses.burn, 0, "没有灼烧：不叠层");
  assert.ok(k.statuses.shock, "也没有顺手激活别的状态");
  const shot = h0 - hpOf(f.c, k);
  assert.ok(shot >= 12 && shot <= 18, `伤害 ${shot}`);   // (8 + 1d4) × 1.5
  // 有 2 层灼烧：枪伤 + 激活（2 次灼烧骰），层数 +1
  k.statuses.shock = false; k.statuses.burn = 2; k.layers[0].current = 9999;
  h0 = hpOf(f.c, k);
  use(f, r, "en_riot_rifle", k);
  assert.equal(k.statuses.burn, 3, "激活后叠层 +1");
  assert.ok(h0 - hpOf(f.c, k) > shot + 1, "多挨了灼烧");
  assert.match(f.logs(), /激活灼烧 2 层/);
});

test("燃烧步枪协助：远距 0.5×atk 火，同样激活灼烧；射程只有远距", () => {
  const f = field([{ id: "riot_rifle", lv: 5, zone: 2 }]);
  const r = f.E("riot_rifle"), k = f.P("kolt");
  k.zone = 1; fleshOnly(k); k.statuses.burn = 1;
  assert.equal(f.c.enemyAssistSkillId(r), "en_riot_rifle_assist");
  assert.ok(f.c.enemyAssistReady(r, k));
  k.zone = 2; assert.ok(!f.c.enemyAssistReady(r, k), "同区打不到");
  k.zone = 1;
  const h0 = hpOf(f.c, k);
  use(f, r, "en_riot_rifle_assist", k);
  assert.equal(k.statuses.burn, 2, "激活：叠层 +1");
  const lost = h0 - hpOf(f.c, k);
  assert.ok(lost >= 6, `0.5×8 ×1.5 + 灼烧，实际 ${lost}`);
});

/* ---------- 燃烧瓶投手 ---------- */
test("燃烧瓶投手：标定一个区（有区域预警），下个敌人回合才落地；落地前的玩家回合可以离开", () => {
  const f = field([{ id: "riot_molotov", lv: 5, zone: 2 }], { zoneMode: 3 });
  const m = f.E("riot_molotov"), k = f.P("kolt"), h = f.P("helu");
  f.S.zoneMode = 3; k.zone = 3; h.zone = 3; tank(k); tank(h);
  f.S.combatPhase = "enemy"; f.c.refreshEnemyEconomy(m);
  const hp0 = hpOf(f.c, k);
  const plan = f.c.EnemyAI.plan(m);
  assert.equal(plan.meta.skillId, "en_riot_bottle");
  plan.thunk();
  assert.deepEqual([m.resources.bottleZone, m.resources.bottlePending, !!m.resources.bottleReady], [3, true, false]);
  assert.equal(hpOf(f.c, k), hp0, "标定时不伤人");
  assert.deepEqual(plain(f.c.zoneThreatsIn(3).map(t => [t.label, t.ready, t.from])), [["燃烧瓶标定", false, m.name]]);
  assert.ok(!f.c.zoneOnFire(3));
  // 下个敌人回合开始：就绪（预警变成「待发」）
  f.c.startEnemyPhase();
  assert.equal(m.resources.bottleReady, true);
  assert.equal(f.c.zoneThreatsIn(3)[0].label, "燃烧瓶待发");
  assert.equal(f.c.zoneThreatsIn(3)[0].ready, true);
});

test("燃烧瓶落地：那一区的我方单位各 0.5×atk 火、灼烧 1，然后变成火场；已经是火场则灼烧 2；越过危墙", () => {
  const f = field([{ id: "riot_molotov", lv: 5, zone: 2 }], { zoneMode: 3 });
  const m = f.E("riot_molotov"), k = f.P("kolt"), h = f.P("helu");
  f.S.zoneMode = 3; m.zone = 1; k.zone = 3; h.zone = 3; fleshOnly(k); fleshOnly(h); k.statuses.burn = 0; h.statuses.burn = 0;
  f.S.gaps["2-3"] = Object.assign(f.S.gaps["2-3"] || {}, { type: "wall" });   // 抛射越过危墙
  Object.assign(m.resources, { bottleZone: 3, bottlePending: true, bottleReady: true });
  m.zone = 1;
  f.S.combatPhase = "enemy"; f.c.refreshEnemyEconomy(m);
  const hk = hpOf(f.c, k);
  use(f, m, "en_riot_bottle_fire", k);
  const lost = hk - hpOf(f.c, k);
  assert.ok(lost >= 5 && lost <= 8, `0.5×7=3.5 ×1.5 ≈ 5，实际 ${lost}`);
  assert.equal(k.statuses.burn, 1); assert.equal(h.statuses.burn, 1);
  assert.ok(f.c.zoneOnFire(3), "那一区变成火场");
  assert.deepEqual([m.resources.bottleZone, m.resources.bottlePending, m.resources.bottleReady], [0, false, false]);
  assert.equal(f.c.zoneThreatsIn(3).length, 0, "预警消失");
  // 再扔一次到已经是火场的区：灼烧 +2
  Object.assign(m.resources, { bottleZone: 3, bottlePending: true, bottleReady: true });
  f.S.combatPhase = "enemy"; m.ap = 1;
  use(f, m, "en_riot_bottle_fire", k);
  assert.equal(k.statuses.burn, 3, "原有 1 层 + 火场 2 层");
});

test("燃烧瓶投手不能协助", () => {
  const f = field([{ id: "riot_molotov", lv: 5, zone: 2 }]);
  const m = f.E("riot_molotov"), k = f.P("kolt");
  k.zone = 1;
  assert.equal(f.c.enemyMayAssist(m), false);
  assert.equal(f.c.enemyAssistReady(m, k), false);
  f.S.combatPhase = "player";
  assert.ok(!f.c.eligibleAssisters(f.P("helu"), k).concat(f.c.eligibleAssisters(m, k)).some(u => u.id === m.id), "不在协助名单里");
});

test("燃烧瓶投手自己能跑完一轮：回合一标定（远离），回合二落地（AI 全程自己决定）", () => {
  const f = field([{ id: "riot_molotov", lv: 3, zone: 2 }], { zoneMode: 3 });
  const m = f.E("riot_molotov"), k = f.P("kolt"), h = f.P("helu");
  f.S.zoneMode = 3; k.zone = 3; h.zone = 3; tank(k); tank(h); k.statuses.burn = 0; h.statuses.burn = 0;
  f.S.combatPhase = "enemy"; f.c.refreshEnemyEconomy(m);
  const t1 = aiTurn(f.c, m);
  assert.ok(t1.some(n => /燃烧瓶（选择区域）/.test(n)), `第一轮：${t1}`);
  assert.equal(m.resources.bottleZone, 3);
  f.c.startEnemyPhase();
  const t2 = aiTurn(f.c, m);
  assert.ok(t2.some(n => /投出燃烧瓶（3区）/.test(n)), `第二轮：${t2}`);
  assert.equal(k.statuses.burn >= 1 && h.statuses.burn >= 1, true);
  assert.ok(f.c.zoneOnFire(3));
  assert.equal(m.resources.bottlePending, false);
});

/* ---------- 火焰喷射兵 ---------- */
test("火焰喷射兵：3 段 0.3×atk 火；目标有灼烧时每段各 1 击破（共 3），没有时 3 段共 1 击破", () => {
  const f = field([{ id: "riot_flamer", lv: 5, zone: 2 }]);
  const e = f.E("riot_flamer"), k = f.P("kolt");
  k.zone = 2; fleshOnly(k); k.def = k.defMax = 20;
  f.c.Math.random = () => 0.99;   // 不掷出灼烧
  k.statuses.burn = 0;
  let h0 = hpOf(f.c, k);
  use(f, e, "en_riot_spray", k);
  assert.equal(20 - k.def, 1, "没有灼烧：3 段共 1 击破");
  assert.equal(k.statuses.burn, 0);
  const lost = h0 - hpOf(f.c, k);
  assert.ok(lost >= 3 && lost <= 9, `3 段 × 0.3×7 火打肉体，实际 ${lost}`);
  k.def = 20; k.statuses.burn = 1;
  use(f, e, "en_riot_spray", k);
  assert.equal(20 - k.def, 3, "有灼烧：每段各 1 击破");
  assert.equal(k.statuses.burn, 1, "喷火本身不激活灼烧");
});

test("火焰喷射兵：每一段命中各掷一次 15% 灼烧 1（种子随机数，大量重复的比例约 15%）", () => {
  const f = field([{ id: "riot_flamer", lv: 5, zone: 2 }]);
  const e = f.E("riot_flamer"), k = f.P("kolt");
  k.zone = 2; tank(k); fleshOnly(k);
  k.statuses.burn = 0;
  // 固定每次 Math.random 的返回值，数「掷出了几次灼烧」：恒为 0.1（< 15%）→ 三段都成功 → 灼烧 3
  f.c.Math.random = () => 0.1;
  use(f, e, "en_riot_spray", k);
  assert.equal(k.statuses.burn, 3, "三段各掷中一次");
  k.statuses.burn = 0;
  f.c.Math.random = () => 0.16;   // 差一点：都不中
  use(f, e, "en_riot_spray", k);
  assert.equal(k.statuses.burn, 0);
  // 统计：用种子随机数跑 600 段
  f.c.Math.random = f.c.makeRng("RIOT-BURN");
  let got = 0;
  const N = 200;
  for (let i = 0; i < N; i++) {
    k.statuses.burn = 0; k.layers[0].current = k.layers[0].max; k.def = k.defMax;
    use(f, e, "en_riot_spray", k);
    got += k.statuses.burn;
  }
  const rate = got / (N * 3);
  assert.ok(rate > 0.09 && rate < 0.21, `每段灼烧概率 ≈ 15%，实际 ${(rate * 100).toFixed(1)}%`);
});

test("火焰喷射兵协助：冲进目标所在区，喷火一次（规则同上）", () => {
  const f = field([{ id: "riot_flamer", lv: 5, zone: 2 }]);
  const e = f.E("riot_flamer"), k = f.P("kolt");
  k.zone = 1; fleshOnly(k); k.def = k.defMax = 20; k.statuses.burn = 2;
  f.c.Math.random = () => 0.99;
  assert.equal(f.c.enemyAssistSkillId(e), "en_riot_spray_assist");
  assert.ok(f.c.enemyAssistReady(e, k));
  use(f, e, "en_riot_spray_assist", k);
  assert.equal(e.zone, 1);
  assert.equal(20 - k.def, 3, "目标有灼烧：每段 1 击破");
});

test("燃料罐：火焰喷射兵被打进失衡时罐子破裂——同区所有单位（不分敌我）0.5×atk 火，那一区变成火场", () => {
  const f = field([{ id: "riot_flamer", lv: 5, zone: 2 }, { id: "riot_rifle", lv: 5, zone: 2 }]);
  const e = f.E("riot_flamer"), ally = f.E("riot_rifle"), k = f.P("kolt"), h = f.P("helu");
  k.zone = 2; h.zone = 1; fleshOnly(k); tank(ally);
  e.def = 1;
  const hk = hpOf(f.c, k), ha = hpOf(f.c, ally), hh = hpOf(f.c, h);
  f.S.combatPhase = "player";
  const out = f.c.dealTo(k, e, { atk: 5, mult: 1, element: "physical", baseBreak: 1, flags: { action: true, blockResolved: true, block: "none" } });
  assert.ok(e.stunned, "失衡");
  assert.match(out.extra.join("\n"), /燃料罐破裂/);
  assert.ok(hpOf(f.c, k) < hk, "同区的玩家挨火");
  assert.ok(hpOf(f.c, ally) < ha, "同区的友军也挨火（不分敌我）");
  assert.equal(hpOf(f.c, h), hh, "别的区不受影响");
  assert.ok(f.c.zoneOnFire(2), "变成火场");
});

test("燃料罐：没被打进失衡不会破裂", () => {
  const f = field([{ id: "riot_flamer", lv: 5, zone: 2 }]);
  const e = f.E("riot_flamer"), k = f.P("kolt");
  k.zone = 2; fleshOnly(k);
  f.S.combatPhase = "player";
  f.c.dealTo(k, e, { atk: 5, mult: 1, element: "physical", baseBreak: 1, flags: { action: true, blockResolved: true, block: "none" } });
  assert.ok(!e.stunned);
  assert.ok(!f.c.zoneOnFire(2));
});

/* ---------- 镇压小队长 ---------- */
test("镇压小队长：火焰手枪 atk + 1d6 火、1 击破、打中施加灼烧 1；协助远距 1×atk 火、同样灼烧 1", () => {
  const f = field([{ id: "riot_captain", lv: 5, zone: 2 }]);
  const cap = f.E("riot_captain"), k = f.P("kolt");
  k.zone = 2; fleshOnly(k); k.statuses.burn = 0; k.def = k.defMax = 20;
  let h0 = hpOf(f.c, k);
  use(f, cap, "en_riot_pistol", k);
  assert.equal(20 - k.def, 1);
  assert.equal(k.statuses.burn, 1);
  let lost = h0 - hpOf(f.c, k);
  assert.ok(lost >= 18 && lost <= 26, `(11 + 1d6) × 1.5，实际 ${lost}`);
  // 协助：远距
  assert.equal(f.c.enemyAssistSkillId(cap), "en_riot_pistol_assist");
  k.zone = 1; k.statuses.burn = 0; k.layers[0].current = k.layers[0].max;
  assert.ok(f.c.enemyAssistReady(cap, k)); k.zone = 2; assert.ok(!f.c.enemyAssistReady(cap, k), "协助只有远距");
  k.zone = 1; h0 = hpOf(f.c, k);
  use(f, cap, "en_riot_pistol_assist", k);
  assert.equal(k.statuses.burn, 1);
  lost = h0 - hpOf(f.c, k);
  assert.ok(lost >= 15 && lost <= 18, `1×11 ×1.5 = 16，实际 ${lost}`);
});

test("指挥：小队长在场时，镇压队全体的攻击 AI 优先挑还没有灼烧的敌人；全都有灼烧或他不在场就照旧", () => {
  const f = field([{ id: "riot_baton", lv: 5, zone: 1 }, { id: "riot_captain", lv: 5, zone: 1 }], { party: ["kolt", "helu"] });
  const b = f.E("riot_baton"), cap = f.E("riot_captain"), k = f.P("kolt"), h = f.P("helu");
  [k, h].forEach(u => { u.zone = 1; tank(u); u.statuses.burn = 0; });
  // 让 kolt 的血量更高（照旧倾向打血量最高的），并且已经在烧
  k.layers[0].max = k.layers[0].current = 20000; k.statuses.burn = 2;
  f.S.combatPhase = "enemy";
  const pick = (u) => f.c.EnemyAI.target(u, f.c.EnemyAI.SPEC[u.kit], f.c.EnemyAI.players()).unit;
  assert.equal(pick(b).id, h.id, "小队长在场：跳过已经在烧的 kolt，打还没灼烧的 helu");
  assert.equal(pick(cap).id, h.id, "小队长自己也一样");
  h.statuses.burn = 1;
  assert.equal(pick(b).id, k.id, "都有灼烧：照旧（同区血量最高）");
  h.statuses.burn = 0;
  cap.dead = true;
  assert.equal(pick(b).id, k.id, "小队长不在场：照旧");
  cap.dead = false;
  // 只改镇压队：别的阵营（警卫队）不受影响
  const g = f.c.enemyPresets().find(p => p.id === "captain_ox").build(5, 2);
  g.zone = 1; f.S.units.push(g);
  assert.equal(f.c.EnemyAI.target(g, f.c.EnemyAI.SPEC.captain_ox, f.c.EnemyAI.players()).unit.id, k.id, "警卫队不吃「指挥」");
});

test("AI 位置：警棍盾 / 喷火兵近战贴近；步枪、投手远程远离；小队长远近皆可", () => {
  const f = field([{ id: "riot_baton", lv: 5, zone: 2 }, { id: "riot_rifle", lv: 5, zone: 2 }, { id: "riot_flamer", lv: 5, zone: 2 }, { id: "riot_captain", lv: 5, zone: 2 }], { zoneMode: 3 });
  f.S.zoneMode = 3; f.S.combatPhase = "enemy";
  const k = f.P("kolt"), h = f.P("helu");
  const S = f.c.EnemyAI.SPEC;
  assert.deepEqual([S.riot_baton.dist, S.riot_flamer.dist, S.riot_rifle.dist, S.riot_molotov.dist, S.riot_captain.dist], [0, 0, 1, 1, null]);
  k.zone = 1; h.zone = 1;
  const go = (kit) => { const u = f.E(kit); u.zone = 3; f.c.refreshEnemyEconomy(u); const p = f.c.EnemyAI.plan(u); return p && p.meta.skillName; };
  assert.match(go("riot_baton"), /移动到 2 区/, "近战：主动贴近");
  assert.match(go("riot_flamer"), /移动到 2 区/);
  const r = f.E("riot_rifle"); r.zone = 1; f.c.refreshEnemyEconomy(r);
  assert.match(f.c.EnemyAI.plan(r).meta.skillName, /移动到 2 区/, "远程：同区就退开");
  const cap = f.E("riot_captain"); cap.zone = 1; f.c.refreshEnemyEconomy(cap);
  assert.match(f.c.EnemyAI.plan(cap).meta.skillName, /火焰手枪/, "远近皆可：同区直接开枪，不后撤");
});

/* ---------- 阵营、遭遇 ---------- */
test("阵营：镇压队和安保、警卫队是一伙，和盗匪互相敌对；其他阵营关系不变", () => {
  const c = H.load();
  const mk = (kit) => { const u = preset(c, kit).build(3, 2); u.zone = 2; return u; };
  const riot = mk("riot_rifle"), sec = mk("guard_sword"), cap = mk("captain_ox"), thug = mk("thug_knife");
  assert.equal(c.factionOf(riot), "镇压队");
  assert.equal(c.hostileTo(riot, sec), false); assert.equal(c.hostileTo(riot, cap), false);
  assert.equal(c.hostileTo(riot, thug), true); assert.equal(c.hostileTo(thug, riot), true);
  assert.equal(c.hostileTo(thug, sec), true, "原来的盗匪 / 安保敌对照旧");
  assert.deepEqual([...c.alliesOf("镇压队")].sort(), ["安保", "警卫队", "镇压队"].sort());
});

test("遭遇：只在外城区出现；外城区随机遭遇能抽到镇压队", () => {
  const c = H.load();
  assert.ok(c.regionFactions("外城区").includes("镇压队"));
  ["巨人城", "第一采矿场", "第二采矿场", "第三采矿场", "沙漠", "天网设施"].forEach(r => assert.ok(!c.regionFactions(r).includes("镇压队"), r));
  ["riot_baton", "riot_rifle", "riot_molotov", "riot_flamer", "riot_captain"].forEach(k => assert.ok(c.regionPool("外城区").includes(k)));
  c.Math.random = c.makeRng("RIOT-ENC");
  let hit = 0;
  for (let i = 0; i < 300; i++) {
    const e = c.rollEncounter({ region: "外城区", zoneMode: 2 });
    if (e.enemies.some(x => /^riot_/.test(x.preset))) hit++;
    assert.ok(e.enemies.length > 0);
  }
  assert.ok(hit > 20, `300 场里抽到镇压队 ${hit} 场`);
});

test("遭遇：抽到镇压队时只有 15% 混编安保 / 警卫队（混编概率写在 FACTION_MIX_CHANCE）；安保 + 警卫队原来的混编不受影响", () => {
  const c = H.load();
  assert.deepEqual(plain(get(c, "FACTION_MIX_CHANCE")), { "镇压队": 0.15 });
  c.Math.random = c.makeRng("RIOT-MIX");
  const N = 4000;
  let mixed = 0;
  for (let i = 0; i < N; i++) {
    const allow = c.encounterFactions("镇压队");
    assert.ok(allow.includes("镇压队"));
    if (allow.length > 1) { mixed++; assert.deepEqual([...allow].sort(), ["安保", "警卫队", "镇压队"].sort(), "混编是整个同伙一起来"); }
  }
  assert.ok(Math.abs(mixed / N - 0.15) < 0.03, `混编比例 ≈ 15%，实际 ${(mixed / N * 100).toFixed(1)}%`);
  // 抽到的是安保：警卫队照旧一定可以混；镇压队只有 15%
  let withRiot = 0;
  for (let i = 0; i < N; i++) {
    const allow = c.encounterFactions("安保");
    assert.ok(allow.includes("安保") && allow.includes("警卫队"), "安保 + 警卫队原来的混编不变");
    if (allow.includes("镇压队")) withRiot++;
  }
  assert.ok(Math.abs(withRiot / N - 0.15) < 0.03, `实际 ${(withRiot / N * 100).toFixed(1)}%`);
  assert.deepEqual([...c.encounterFactions("警卫队")].filter(f => f !== "镇压队").sort(), ["安保", "警卫队"]);
  // 没有混编概率的阵营：原样
  assert.deepEqual(plain(c.encounterFactions("盗匪")), ["盗匪"]);
});

test("遭遇：外城区抽到镇压队的那一场，实际抽出的敌人里混编比例约 15%；一场代币总数不变", () => {
  const c = H.load();
  c.Math.random = c.makeRng("RIOT-ENC2");
  let riotFights = 0, mixedFights = 0;
  for (let i = 0; i < 1500; i++) {
    const e = c.rollEncounter({ region: "外城区", zoneMode: 2, faction: "镇压队", mixed: false });
    assert.equal(e.faction, "镇压队");
    riotFights++;
    const fs = new Set(e.enemies.map(x => get(c, "ENEMY_INFO")[x.preset].faction));
    assert.ok(fs.has("镇压队") || fs.size > 0);
    if ([...fs].some(f => f !== "镇压队")) mixedFights++;
    const tokens = e.enemies.reduce((s, x) => s + c.enemyTokens(x.preset), 0);
    assert.ok(tokens <= e.tokens && tokens >= e.tokens - 1, `代币 ${tokens}/${e.tokens}`);
  }
  const rate = mixedFights / riotFights;
  // 混编掷中后池子里还有一半以上是安保 / 警卫队，所以出现别家兵的比例略低于 15%
  assert.ok(rate > 0.06 && rate < 0.2, `混编比例 ${(rate * 100).toFixed(1)}%`);
});

test("三方混战：外城区的两边保持原样，镇压队不进去", () => {
  const c = H.load();
  assert.deepEqual(plain(get(c, "THREE_WAY").regions["外城区"].sides), [["安保", "警卫队"], ["盗匪"]]);
  c.Math.random = c.makeRng("RIOT-3W");
  for (let i = 0; i < 200; i++) {
    const e = c.rollThreeWay("外城区", {});
    assert.ok(!e.enemies.some(x => /^riot_/.test(x.preset)));
  }
});
