// #342：高能自爆的余波是能量伤害——打到带高能状态的单位，照打中时的口径（gainHighFromHits）累积高能值，
// 先累积、再判它会不会连锁自爆；没有高能状态的（蓄能、什么都没有）不累积。
// #348：去掉「本回合刚被施加高能不累积」——从施加高能的那一刻起挨余波就累积
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

/** 同一区的狂徒 A、B（1 级，高能骰 1d4+1，血量 100 肉体）：A 带高能值 20，余波 10 点能量。骰子都掷最大（1d4 → 4） */
function field(opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: opt.party || ["kolt", "helu"], seed: "H342",
    enemies: [1, 2, 3].slice(0, opt.foes || 2).map(() => ({ id: "thug_knife", lv: 1, zone: 1 })) });
  c.startCombat();
  const st = c.S.state;
  const [a, b, d] = st.units.filter(u => !u.isPlayer);
  [a, b, d].forEach(u => { if (u) { u.zone = 1; u.layers = [{ type: "flesh", current: 100, max: 100 }]; } });
  a.statuses.high = true; a.highEnergy = 20;
  c.Math.random = () => 0.99;
  return { c, st, a, b, d };
}
const lines = st => st.logPages.flatMap(p => p.lines).map(l => l.text);
const has = (st, text) => lines(st).some(s => s.includes(text));

test("余波打到另一个带高能的敌人：照打中的口径累积一次高能值（1d4+1）", () => {
  const { c, st, a, b } = field();
  b.statuses.high = true; b.highEnergy = 3;
  c.explodeHigh(a, 20);
  assert.equal(c.totalHp(b), 90, "余波 10 点能量打到 B");
  assert.equal(b.highEnergy, 8, "3 + 1d4+1〔4+1〕= 8");
  assert.ok(!b.dead && b.statuses.high, "血量 90 还高于高能值 8：不自爆");
  assert.ok(has(st, `${b.name} 余波能量伤害 1d4+1〔4+1〕=5 → 高能值 8`), lines(st).join("\n"));
});

test("累积后高能值超过血量：连锁自爆，炸的是累积之后的高能值（先累积再判定）", () => {
  {
    // 挨余波剩 15：原来的高能值 12 不够炸，累积 +5 = 17 就炸
    const { c, st, a, b } = field();
    b.layers = [{ type: "flesh", current: 25, max: 100 }];
    b.statuses.high = true; b.highEnergy = 12;
    c.explodeHigh(a, 20);
    assert.ok(has(st, `【高能自爆】${b.name} 高能值 17 ≥ 当前生命 15`), lines(st).join("\n"));
    assert.equal(c.totalHp(b), 0);
    assert.equal(b.highEnergy, 0, "自爆后高能值清零");
    assert.equal(b.statuses.high, false);
  }
  {
    // 余波本身就把血量打到原来的高能值以下：也是先累积再炸（炸 17，不是 12）
    const { c, st, a, b } = field();
    b.layers = [{ type: "flesh", current: 15, max: 100 }];
    b.statuses.high = true; b.highEnergy = 12;
    c.explodeHigh(a, 20);
    assert.ok(has(st, `【高能自爆】${b.name} 高能值 17 ≥ 当前生命 5`), lines(st).join("\n"));
    assert.ok(!has(st, `【高能自爆】${b.name} 高能值 12`), "没有先拿旧的高能值炸");
  }
  {
    // 余波直接把 B 打死（清了场）：照样带着累积之后的高能值自爆，击杀只结算一次
    const { c, st, a, b } = field();
    b.layers = [{ type: "flesh", current: 8, max: 100 }];
    b.statuses.high = true; b.highEnergy = 12;
    c.explodeHigh(a, 20);
    assert.ok(has(st, `【高能自爆】${b.name} 高能值 17 ≥ 当前生命 0`), lines(st).join("\n"));
    assert.equal(b.highEnergy, 0);
    assert.equal(b._xpGiven, true);
    assert.equal(lines(st).filter(s => /获得 \d+ 奎支（/.test(s)).length, 2, "A、B 各结算一次击杀");
  }
});

test("行动中打死带高能的敌人、行动结束才自爆：余波照样给同区带高能的敌人累积", () => {
  const { c, st, a, b } = field({ party: ["ras", "kolt"] });
  const ras = c.findKit("ras", st.units);
  ras.zone = 2; ras.ap = 3;
  a.layers = [{ type: "flesh", current: 1, max: 20 }];
  b.statuses.high = true; b.highEnergy = 3;
  st.attackerId = ras.id; st.targetId = a.id;
  c.runSkill("ras_aa");   // 普攻是能量：打死 A 的那一下 A 先涨 5（20 → 25），行动结束才炸，余波 12
  assert.ok(has(st, `【高能自爆】${a.name} 高能值 25`), lines(st).join("\n"));
  assert.equal(c.totalHp(b), 88);
  assert.equal(b.highEnergy, 8, "3 + 1d4+1〔4+1〕");
});

test("能量场自爆的余波（同一个 explodeHigh）一样累积", () => {
  const { c, st, a, b } = field();
  a.statuses.high = false; a.highEnergy = 0;
  a.layers = [{ type: "flesh", current: 5, max: 100 }];   // 最低血 5 < 场地高能 10：自爆，余波 5
  st.fields[1].energy = true; st.fields[1].energyVal = 10;
  b.statuses.high = true; b.highEnergy = 3;
  c.checkEnergyFieldBoom(1, []);
  assert.equal(c.totalHp(a), 0);
  assert.equal(c.totalHp(b), 95);
  assert.equal(b.highEnergy, 8);
});

test("刚被施加高能的（瑞比扳机）：同一回合挨余波马上累积，和早就带着高能的一样（#348）", () => {
  const { c, st, a, b, d } = field({ party: ["ruby", "kolt"], foes: 3 });
  const ruby = c.findKit("ruby", st.units);
  ruby.zone = 1; ruby.ap = 5;
  st.attackerId = ruby.id; st.targetId = b.id;
  c.runSkill("ruby_trigger");
  assert.equal(b.statuses.high, true, "扳机挂上高能");
  d.statuses.high = true; d.highEnergy = 20;
  c.explodeHigh(a, 20);
  assert.equal(c.totalHp(b), 90, "余波照样打到 B");
  assert.equal(b.highEnergy, 5, "刚被施加高能的这一回合就累积 1d4+1〔4+1〕");
  assert.equal(d.highEnergy, 25, "早就带着高能的 D 一样累积");
  // 下一回合：D 自爆，余波打到 B，再累积一次
  st.turnNo += 1;
  c.explodeHigh(d, 25);
  assert.equal(b.highEnergy, 10);
});

test("没有高能状态的（蓄能、什么都没有）挨余波：不涨高能值，也不会被挂上高能", () => {
  {
    const { c, a, b } = field();
    b.self = "store"; b.statuses.high = false; b.highEnergy = 5;   // 蓄能攒着的高能值，不算高能状态
    c.explodeHigh(a, 20);
    assert.equal(c.totalHp(b), 90);
    assert.equal(b.highEnergy, 5);
    assert.equal(b.statuses.high, false);
  }
  {
    const { c, a, b } = field();
    b.statuses.high = false; b.highEnergy = 0;
    c.explodeHigh(a, 20);
    assert.equal(c.totalHp(b), 90);
    assert.equal(b.highEnergy, 0);
    assert.equal(b.statuses.high, false);
  }
});

test("没受到伤害（再次霜结完全免伤）不累积；加倍计量 ×2、微光 +1 照旧", () => {
  {
    const { c, a, b } = field();
    b.statuses.high = true; b.highEnergy = 3; b.resources.frostShell = true;
    c.explodeHigh(a, 20);
    assert.equal(c.totalHp(b), 100);
    assert.equal(b.highEnergy, 3, "没扣到血：不累积");
  }
  {
    const { c, st, a, b } = field();
    b.statuses.high = true; b.highEnergy = 0; b.instant.doubleStatus = true;
    c.explodeHigh(a, 20);
    assert.equal(b.highEnergy, 10, "加倍计量：(4+1) ×2");
    assert.ok(has(st, `${b.name} 余波能量伤害 1d4+1〔4+1〕=5 ×2（加倍计量） → 高能值 10`), lines(st).join("\n"));
  }
  {
    const { c, a, b } = field();
    c.setWeather("glow", { force: true });
    b.statuses.high = true; b.highEnergy = 0;
    c.explodeHigh(a, 20);
    assert.equal(b.highEnergy, 6, "微光：累积时 +1 → 4+1+1");
  }
});
