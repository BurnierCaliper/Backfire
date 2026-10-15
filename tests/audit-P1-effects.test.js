// 规则核查 P1：效果系统与持续伤害（玩家手册第四章、游戏规则精简版 7.1–7.6）的回归测试
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

/** 一场摆好的战斗：默认柯尔特 + Helumica 对狂徒（锤）+ 狂徒（匕首），已开战，全员在 1 区 */
function field(opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({
    party: opt.party || ["kolt", "helu"],
    enemies: opt.enemies || [{ id: "thug_hammer", lv: opt.lv || 1, zone: 1 }, { id: "thug_knife", lv: opt.lv || 1, zone: 1 }],
    seed: "P1FX"
  });
  c.startCombat();
  const st = c.S.state;
  st.units.forEach(u => { if (!u.hidden) u.zone = 1; });
  const [foe, foe2] = st.units.filter(u => !u.isPlayer);
  const hit = (a, t, el, extra) => c.dealTo(a, t, Object.assign({ atk: 10, mult: 1, element: el, baseBreak: 0, atkRange: "any",
    flags: { action: true, blockResolved: true, block: "none" } }, extra || {}));
  return { c, st, foe, foe2, hit, kit: k => c.findKit(k, st.units) };
}
const plain = x => JSON.parse(JSON.stringify(x));
const layers = (u, ls) => { u.layers = ls.map((l, i) => ({ type: l[0], current: l[1], max: l[2] != null ? l[2] : l[1], inner: i === ls.length - 1 })); };
const cur = (u, type) => u.layers.find(l => l.type === type).current;
const hp = u => u.layers.reduce((s, l) => s + Number(l.current || 0), 0);
const types = u => plain(u.layers.map(l => l.type));
const currents = u => plain(u.layers.map(l => l.current));
const round = c => { c.endPlayerTurn(); c.endEnemyTurn(); };
const away = (st, zone, pred) => st.units.filter(pred).forEach(u => { u.zone = zone; });

test("晕眩后所有自我效果结束（导体、蓄能、霜结、溅射、千钧、多普勒、自焚），蓄能累积的高能值不清零", () => {
  for (const kind of ["burn", "frost", "splash", "conductor", "anchor", "store", "doppler"]) {
    const { c, kit } = field({ party: ["chuan", "helu"] });
    const u = kit("chuan");
    layers(u, [["flesh", 200]]);
    u.self = kind;
    if (kind === "burn") u.selfBurnStacks = 1;
    if (kind === "store") u.highEnergy = 3;
    u.def = 1; u.stunned = false;
    c.dealBreak(u, 1, "physical", []);
    assert.equal(u.stunned, true, kind);
    assert.equal(u.self, "none", kind + " 被打进失衡就结束");
    if (kind === "store") assert.equal(u.highEnergy, 3, "蓄能的高能值不清零");
  }
  // 攻击打进失衡同样结束；回合开始时还在晕眩的也兜底结束
  const { c, foe, foe2, hit, kit } = field();
  layers(foe, [["flesh", 200]]);
  foe.self = "conductor"; foe.def = 1;
  hit(kit("kolt"), foe, "physical", { baseBreak: 1 });
  assert.equal(foe.self, "none");
  foe.self = "frost"; foe.stunned = true;
  c.beginRound([]);
  assert.equal(foe.self, "none");
  // 多普勒被这一下打进失衡：这一下的击破照样传给同区单位，然后多普勒结束
  foe.stunned = false; foe.def = 1; foe.self = "doppler";
  foe2.def = 5; foe2.defMax = 5; foe2.stunned = false;
  c.dealBreak(foe, 1, "physical", []);
  assert.equal(foe.self, "none");
  assert.equal(foe2.def, 4);
});

test("相位计数器：被其他天气覆盖期间照常走；再次释放驻波接入当前计数（不归零）", () => {
  const { c, st, kit } = field({ party: ["helu", "kolt"] });
  const helu = kit("helu");
  const wave = () => { st.attackerId = helu.id; helu.ap = 5; helu.bonus = 5; c.runSkill("helu_wave"); };
  wave();
  assert.equal(st.weather, "phase");
  assert.equal(st.phaseStep, 0);
  round(c);
  assert.equal(st.phaseStep, 1);
  c.setWeather("heat", { force: true });
  round(c);
  assert.equal(st.phaseStep, 2, "被酷暑覆盖也照走");
  wave();
  assert.equal(st.weather, "phase");
  assert.equal(st.phaseStep, 2, "再次释放接入当前计数");
  round(c);
  assert.equal(st.phaseStep, 3);
  // 没进入过相位的战斗，计数器不动
  const f2 = field();
  round(f2.c);
  assert.equal(f2.st.phaseStep, 0);
});

test("微光：蓄能状态下，高能值要连续两个回合结束都超过血量才自爆", () => {
  const { c, st, kit } = field({ party: ["chuan", "helu"] });
  const ch = kit("chuan");
  away(st, 2, u => !u.isPlayer);
  c.setWeather("glow", { force: true });
  layers(ch, [["flesh", 5, 100]]);
  ch.self = "store"; ch.highEnergy = 8;
  c.checkHighBoom(ch);
  assert.ok(!ch.dying, "平时不当场自爆");
  round(c);
  assert.ok(!ch.dying, "第一个回合结束只记一次");
  round(c);
  assert.equal(ch.dying, true, "连续第二个回合结束自爆");
  // 中间有一次没超过就重新数
  const f2 = field({ party: ["chuan", "helu"] });
  const ch2 = f2.kit("chuan");
  away(f2.st, 2, u => !u.isPlayer);
  f2.c.setWeather("glow", { force: true });
  layers(ch2, [["flesh", 5, 100]]);
  ch2.self = "store"; ch2.highEnergy = 8;
  round(f2.c);
  layers(ch2, [["flesh", 60, 100]]);
  round(f2.c);
  assert.ok(!ch2.dying);
  assert.equal(ch2._glowStoreOver, 0);
});

test("持续伤害 / 状态伤害不吃只属于攻击的修正：相位击破、错位、扩散改属性、熔融沙尘", () => {
  {
    const { c, st, foe } = field();
    layers(foe, [["flesh", 100]]);
    st.weather = "phase"; st.phaseStep = 2; foe.def = 5;
    c.applyTypedDot(foe, 3, "acid", [], "腐蚀测试");
    assert.equal(foe.def, 5, "波峰 +1 击破只给攻击");
    st.phaseStep = 0; foe.def = 5;
    const { res } = c.dealTo(c.findKit("kolt", st.units), foe, { atk: 10, mult: 1, element: "physical", baseBreak: 1, flags: { action: true, blockResolved: true, block: "none" } });
    assert.equal(res.breakDealt, 0, "攻击照常吃波谷 −1");
  }
  {
    const { c, foe } = field();
    layers(foe, [["flesh", 100]]);
    foe.def = 5; foe.instant = { shift: true };
    c.applyTypedDot(foe, 4, "fire", [], "灼烧1层");
    assert.equal(foe.def, 5, "错位：只有受克制的攻击才 +1 击破");
  }
  {
    const { c, foe } = field();
    layers(foe, [["flesh", 100]]);
    foe.instant = { spread: true }; foe.statuses.latestElement = "harmonic";
    c.applyTypedDot(foe, 10, "fire", [], "灼烧1层");
    assert.equal(100 - cur(foe, "flesh"), 15, "扩散只改攻击的属性，灼烧照火打肉体 +50%");
  }
  {
    const { c, foe } = field();
    layers(foe, [["sand", 50], ["flesh", 100]]);
    foe.def = 5; foe.instant = { melt: true };
    c.applyTypedDot(foe, 3, "acid", [], "腐蚀测试");
    assert.equal(foe.def, 5, "熔融沙尘 +1 击破只给攻击");
  }
});

test("干涉场：叠层只在站在干涉场里时生效，离开就清掉；多段攻击每一段按当前叠层判断反向", () => {
  const { c, st, foe, kit, hit } = field();
  const kolt = kit("kolt");
  layers(foe, [["flesh", 1000]]);
  st.fields[1].harmonic = true;
  for (let i = 0; i < 3; i++) hit(kolt, foe, "fire");
  assert.equal(foe.interfere, 0.75);
  foe.zone = 2; kolt.zone = 2;
  const b = hp(foe);
  hit(kolt, foe, "ice");
  assert.equal(b - hp(foe), 10, "不在干涉场：叠层不生效");
  assert.equal(foe.interfere, 0, "并且清掉");
  // 回合开始：离开干涉场的叠层清掉
  foe.zone = 1; hit(kolt, foe, "fire");
  foe.zone = 2; c.beginRound([]);
  assert.equal(foe.interfere, 0);
  // 多段：−50% 时挨 3 段克制：第 1 段反向清空从 +25% 重计，之后按当前叠层继续叠
  foe.zone = 1; kolt.zone = 1;
  foe.interfere = -0.5; foe.interfereZone = 1;
  const out = hit(kolt, foe, "fire", { hits: 3 });
  assert.deepEqual(plain(out.res.perHit.map(h => h.dealt)), [10, 17, 20]);
  assert.equal(foe.interfere, 0.75);
});

test("干涉场叠层封顶 ±100%：到顶后不再叠加（以前会叠到 −2425% 把伤害变成 0）", () => {
  const { st, foe, kit, hit } = field();
  const kolt = kit("kolt");
  layers(foe, [["flesh", 100000]]);
  st.fields[1].harmonic = true;
  for (let i = 0; i < 8; i++) hit(kolt, foe, "fire");
  assert.equal(foe.interfere, 1, "克制叠到 +100% 为止");
  layers(foe, [["armor", 100000]]);
  for (let i = 0; i < 9; i++) hit(kolt, foe, "fire");
  assert.equal(foe.interfere, -1, "反向清空后劣势也只叠到 −100%");
  foe.interfere = -24; foe.interfereZone = 1;
  const b = hp(foe);
  hit(kolt, foe, "fire");
  assert.ok(b - hp(foe) >= 0 && foe.interfere >= -1, "旧存档里超上限的叠层按上限算");
});

test("冻土的冰 25% 易伤对飞行单位无效", () => {
  const { c, st, foe, kit, hit } = field();
  st.fields[1].ice = true;
  const env = { atk: 20, flags: { action: false, blockResolved: true, block: "none" } };
  layers(foe, [["spirit", 1000]]); foe.flying = false;
  assert.equal(hit(kit("kolt"), foe, "ice", env).res.total, 25, "地面单位：冰强制 +25%");
  layers(foe, [["spirit", 1000]]); foe.flying = true;
  assert.equal(hit(kit("kolt"), foe, "ice", env).res.total, 15, "飞行单位：照原克制（冰打星灵 −25%）");
});

test("熔融：冰属性攻击每一段都 ×2 伤害、+1 击破（作者定），攻击结算完熔融结束；冰持续伤害不触发", () => {
  const { c, foe, kit, hit } = field();
  layers(foe, [["flesh", 1000]]);
  foe.def = 20; foe.defMax = 20;
  c.applyInstantEffect(foe, "melt", []);
  const out = hit(kit("kolt"), foe, "ice", { hits: 3 });
  assert.equal(out.res.total, 60);
  assert.equal(out.res.breakDealt, 3);
  assert.equal(foe.instant.melt, false);
  c.applyInstantEffect(foe, "melt", []);
  c.applyTypedDot(foe, 10, "ice", [], "测试冰");
  assert.equal(foe.instant.melt, true, "状态冰伤不是冰属性攻击");
});

test("屹立不倒：状态伤害、场地伤害、dealBreak 来源都挡住", () => {
  const { c, st, foe, kit } = field();
  const helu = kit("helu");
  layers(helu, [["flesh", 100]]);
  helu.def = 5; helu.resources.standTurn = true;
  c.applyTypedDot(helu, 10, "fire", [], "灼烧测试");
  assert.equal(hp(helu), 100);
  c.dealBreak(helu, 2, "ice", [], "冻伤");
  assert.equal(helu.def, 5);
  st.fields[1].electric = true;
  c.dealTo(foe, helu, { atk: 10, mult: 1, element: "physical", baseBreak: 1, flags: { action: true, blockResolved: true, block: "none" } });
  assert.equal(hp(helu), 100, "攻击免疫，高压场地也不触发");
  assert.equal(helu.def, 5);
});

test("加倍计量：目标此回合的状态结算翻倍（灼烧、感电、冻伤、高能累积、激活、中和）", () => {
  {
    const { c, foe } = field();
    layers(foe, [["flesh", 1000]]);
    foe.statuses.burn = 2; foe.instant.doubleStatus = true;
    c.Math.random = () => 0.99;   // d4 都掷 4
    round(c);
    assert.equal(1000 - hp(foe), 24, "灼烧 2 层 8 点 ×2，火打肉体 +50%");
    assert.equal(foe.instant.doubleStatus, false, "回合结束失效");
  }
  {
    const { c, foe, foe2, kit, hit } = field();
    layers(foe, [["flesh", 1000]]); layers(foe2, [["flesh", 1000]]);
    foe.statuses.shock = true; foe.instant.doubleStatus = true;
    c.Math.random = () => 0.99;   // 1d4−1 → 3
    hit(kit("kolt"), foe, "physical", { atk: 1 });
    assert.equal(1000 - hp(foe2), 6, "感电波及同区同阵营 ×2");
  }
  {
    const { c, foe } = field();
    layers(foe, [["flesh", 1000]]); foe.def = 10; foe.defMax = 10;
    foe.statuses.frostbite = true; foe.instant.doubleStatus = true;
    round(c);
    assert.equal(foe.def, 8, "冻伤 1 击破 ×2");
  }
  {
    const { c, foe, kit } = field();
    layers(foe, [["flesh", 1000]]);
    c.Math.random = () => 0;   // 1d4+1 → 2
    foe.instant.doubleStatus = true;
    c.addHighEnergy(foe, "测试");
    assert.equal(foe.highEnergy, 4, "高能累积 ×2");
    foe.statuses.corr = true;
    c.Math.random = () => 0.99;
    c.triggerOneStatus(foe, kit("kolt"), "corr");
    assert.equal(1000 - hp(foe), 16, "激活腐蚀 2d4=8 ×2");
  }
});

test("黄金时间：被延长的即时效果在回合开始时多保留一回合，之后照常结束", () => {
  const { c, foe } = field();
  c.applyInstantEffect(foe, "melt", []);
  foe.instant.refract = true;
  foe.instant.goldHold = true;
  round(c);
  assert.equal(foe.instant.melt, true);
  assert.equal(foe.instant.refract, true);
  assert.ok(!foe.instant.goldHold, "只延长一回合");
  round(c);
  assert.equal(foe.instant.melt, false);
  assert.equal(foe.instant.refract, false);
  // 写成效果名时只延长那一种；错位延长期间血层保持错位
  const f2 = field();
  layers(f2.foe, [["shield", 10], ["armor", 10], ["flesh", 30]]);
  f2.c.applyShift(f2.foe);
  f2.c.applyInstantEffect(f2.foe, "melt", []);
  f2.foe.instant.goldHold = "shift";
  round(f2.c);
  assert.equal(f2.foe.instant.shift, true);
  assert.equal(f2.foe.instant.melt, false);
  assert.deepEqual(types(f2.foe), ["armor", "shield", "flesh"]);
  round(f2.c);
  assert.deepEqual(types(f2.foe), ["shield", "armor", "flesh"]);
});

test("保释：此回合也豁免场地（火场、酸液、治愈、能量场、高压、塌陷、冻土、干涉）", () => {
  const { c, st, foe, kit, hit } = field();
  const helu = kit("helu");
  helu.shelterTurn = true; helu.isolate = true;
  layers(helu, [["flesh", 100]]);
  st.fields[1].fireOn = true; st.fields[1].fire = 2;
  c.tickFireField(1, []);
  assert.equal(hp(helu), 100, "火场");
  st.fields[1].fireOn = false; st.fields[1].fire = 0;
  c.tickAcidFieldFor(helu, "none", []);
  assert.equal(hp(helu), 100, "酸液地面");
  st.fields[1].energy = true; st.fields[1].energyVal = 0;
  c.tickEnergyFieldFor(helu, st.fields[1], []);
  assert.equal(st.fields[1].energyVal, 0, "不算进能量场");
  st.fields[1].energy = false; st.fields[1].electric = true;
  hit(foe, helu, "physical");
  assert.equal(hp(helu), 90, "高压场地不追加电击");
  st.fields[1].electric = false; st.fields[1].collapseOn = true; st.fields[1].collapse = 4; helu.def = 5;
  c.registerZoneBreak(1, 1);
  assert.equal(helu.def, 5, "塌陷");
  st.fields[1].collapseOn = false; st.fields[1].ice = true;
  layers(helu, [["spirit", 1000]]);
  assert.equal(hit(foe, helu, "ice", { atk: 20, flags: { action: false, blockResolved: true, block: "none" } }).res.total, 15, "冻土易伤");
  st.fields[1].ice = false; st.fields[1].harmonic = true;
  layers(helu, [["flesh", 1000]]);
  hit(foe, helu, "fire", { flags: { action: false, blockResolved: true, block: "none" } });
  assert.equal(helu.interfere, 0, "干涉不叠层（火打肉体是克制）");
});

test("恶劣环境 / 末日：天气与场地效果对目标翻倍；末日不带到下一场", () => {
  {
    const { c, st, kit } = field();
    const helu = kit("helu");
    layers(helu, [["flesh", 100]]);
    helu.harshEnv = true;
    c.setWeather("heat", { force: true });
    c.applyTypedDot(helu, 10, "fire", [], "测试火");
    assert.equal(100 - hp(helu), 20, "酷暑火 +25% → +50%（火打肉体 +50%）");
  }
  {
    const { c, st, foe, kit, hit } = field();
    foe.harshEnv = true;
    st.weather = "phase"; st.phaseStep = 2;
    layers(foe, [["flesh", 1000]]); foe.def = 20; foe.defMax = 20;
    const out = hit(kit("kolt"), foe, "physical", { baseBreak: 1 });
    assert.equal(out.res.total, 20, "波峰 +50% → +100%");
    assert.equal(out.res.breakDealt, 3, "波峰 +1 → +2 击破");
    st.fields[1].ice = true; st.weather = "none";
    layers(foe, [["spirit", 1000]]);
    assert.equal(hit(kit("kolt"), foe, "ice", { atk: 20 }).res.total, 30, "冻土冰易伤 25% → 50%");
  }
  {
    const { c, st, kit } = field();
    const helu = kit("helu");
    st.apocalypse = true;
    layers(helu, [["flesh", 100]]);
    st.fields[1].fireOn = true; st.fields[1].fire = 1;
    c.Math.random = () => 0.99;
    c.tickFireField(1, []);
    assert.equal(100 - hp(helu), 12, "火场 4 点 ×2，火打肉体 +50%");
    // 下一场战斗重新开始
    c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "P1FX2" });
    c.startCombat();
    assert.equal(c.S.state.apocalypse, false);
  }
});

test("dealBreak：opt.by 记下失衡制造者（不能接自己的协助攻击）；打空飞行单位照常击落扣 20%", () => {
  {
    const { c, st, foe, kit } = field();
    const kolt = kit("kolt");
    layers(foe, [["flesh", 100]]); foe.def = 2;
    st.assistQueue = [];
    c.dealBreak(foe, 2, "physical", [], "测试", { by: kolt });
    assert.equal(st.assistQueue[0].breakerId, kolt.id);
    assert.ok(!c.eligibleAssisters(kolt, foe).includes(kolt));
  }
  {
    const { c, foe } = field({ enemies: [{ id: "crow", lv: 1, zone: 1 }] });
    layers(foe, [["flesh", 100]]); foe.def = 2; foe.flying = true;
    c.dealBreak(foe, 2, "ice", [], "冻伤");
    assert.equal(foe.stunned, true);
    assert.equal(foe.flying, false);
    assert.equal(hp(foe), 80);
  }
});

test("千钧：每一段攻击都 +1 击破（作者定：每段都算）", () => {
  const { c, foe, kit, hit } = field();
  const kolt = kit("kolt");
  layers(foe, [["flesh", 1000]]);
  kolt.self = "anchor"; foe.def = 20; foe.defMax = 20;
  assert.equal(hit(kolt, foe, "ice", { atk: 1, hits: 3 }).res.breakDealt, 3);
  assert.equal(hit(kolt, foe, "ice", { atk: 1, hits: 3, baseBreak: 1 }).res.breakDealt, 6);
  // 川川普攻：两下（共 1 击破），千钧每段 +1
  const f2 = field({ party: ["chuan", "helu"] });
  const ch = f2.kit("chuan");
  layers(f2.foe, [["flesh", 1000]]); f2.foe.def = 20; f2.foe.defMax = 20;
  ch.self = "anchor"; ch.resources.charge = 0;
  f2.st.attackerId = ch.id; f2.st.targetId = f2.foe.id; ch.ap = 5; ch.bonus = 5;
  f2.c.runSkill("chuan_aa");
  assert.equal(f2.foe.def, 17);
});

test("蚀刻残留「视为被克制」：弱点特效按克制 +25%", () => {
  const { foe, kit, hit } = field();
  layers(foe, [["flesh", 1000]]);
  foe.etchMarks = [{ element: "ice", pct: 0.1 }];
  const out = hit(kit("kolt"), foe, "ice", { atk: 20, flags: { action: true, blockResolved: true, block: "none", weak: true } });
  assert.equal(out.res.total, 27, "冰打肉体一般：+10% 蚀刻 +25% 弱点特效");
});

test("谐波打晕眩：没有次外层不额外打；相位下每一层（含单层）各一次", () => {
  const run = (ls, phase) => {
    const { st, foe, kit, hit } = field();
    foe.def = 0; foe.stunned = true;
    layers(foe, ls);
    if (phase) { st.weather = "phase"; st.phaseStep = 1; }
    return { out: hit(kit("kolt"), foe, "harmonic"), foe };
  };
  let r = run([["flesh", 30]]);
  assert.equal(r.out.res.total, 7, "单层：谐波打肉体 −25%，只打一次");
  r = run([["shield", 10], ["flesh", 30]]);
  assert.deepEqual(currents(r.foe), [3, 23], "次外层再吃一次");
  r = run([["flesh", 30]], true);
  assert.equal(r.out.res.total, 7);
  assert.equal(r.out.res.extraHarmonic, 0);
  r = run([["shield", 10], ["armor", 10], ["flesh", 30]], true);
  assert.deepEqual(currents(r.foe), [3, 3, 23]);
});

test("错位：只交换最外面两层还有血的；回合开始按层对象还原，不会把内层换到最外层", () => {
  const { c, foe } = field();
  layers(foe, [["shield", 10], ["armor", 10], ["flesh", 30]]);
  c.applyShift(foe);
  assert.deepEqual(types(foe), ["armor", "shield", "flesh"]);
  c.stripFocusLayer(foe, "armor", []);
  c.clearShift(foe);
  assert.deepEqual(types(foe), ["shield", "flesh"], "装甲被抹掉：剩下的不乱换");
  layers(foe, [["armor", 10], ["flesh", 30]]);
  c.applyShift(foe);
  c.addShieldLayer(foe, 8, false);
  c.clearShift(foe);
  assert.deepEqual(types(foe), ["shield", "armor", "flesh"], "错位中加的护盾留在最外层");
  layers(foe, [["shield", 10], ["armor", 10], ["flesh", 30]]);
  foe.layers[0].current = 0;
  c.applyShift(foe);
  assert.deepEqual(types(foe), ["shield", "flesh", "armor"], "打空的护盾不算，换的是装甲和肉体");
});

test("高压场地：伤害为 0 / 被免疫时不触发；空手格挡成功挨一半照样触发", () => {
  const { c, st, foe, kit } = field();
  const helu = kit("helu");
  st.fields[1].electric = true;
  layers(helu, [["flesh", 100]]);
  helu.resources.frostShell = true;
  let out = c.dealTo(foe, helu, { atk: 10, mult: 1, element: "physical", baseBreak: 0, flags: { action: true, blockResolved: true, block: "none" } });
  assert.equal(out.extra.filter(s => /高压场地/.test(s)).length, 0);
  assert.equal(hp(helu), 100);
  helu.resources.frostShell = false;
  out = c.dealTo(foe, helu, { atk: 10, mult: 1, element: "physical", baseBreak: 0, flags: { action: true, blockResolved: true, block: "bareOk" } });
  assert.equal(out.res.total, 5);
  assert.equal(out.extra.filter(s => /高压场地/.test(s)).length, 1);
});

test("塌陷：触发后计数清零（一次 10 击破只塌一次）；单局生成的塌陷区带战斗等级", () => {
  const { c, st } = field();
  away(st, 2, () => true);
  st.fields[1].collapseOn = true; st.fields[1].collapse = 3;
  c.registerZoneBreak(1, 4);
  assert.equal(st.fields[1].collapse, 0);
  const notes = c.registerZoneBreak(1, 10);
  assert.equal(notes.filter(s => /塌陷：/.test(s)).length, 1);
  assert.equal(st.fields[1].collapse, 0);
  require("vm").runInContext('applyBattlefieldFeatures([{ type: "field", what: "collapseOn", zone: 2 }], 12)', c);
  assert.equal(st.fields[2].collapseLv, 12);
});

test("能量场：自带高能的单位（不只最低血）阈值加场地高能；高能自爆和能量场都是血量「低于」才爆", () => {
  {
    const { c, st, foe, foe2 } = field();
    away(st, 2, () => true);
    foe.zone = 1; foe2.zone = 1;
    st.fields[1].energy = true; st.fields[1].energyVal = 10;
    layers(foe, [["flesh", 12, 100]]);
    layers(foe2, [["flesh", 15, 100]]);
    foe2.statuses.high = true; foe2.highEnergy = 8;
    c.checkEnergyFieldBoom(1, []);
    assert.ok(!foe.dead);
    assert.equal(foe2.dead, true);
    assert.equal(st.fields[1].energyVal, 0);
  }
  {
    const { c, st, foe, foe2 } = field();
    away(st, 2, () => true);
    foe.zone = 1;
    st.fields[1].energy = true; st.fields[1].energyVal = 10;
    layers(foe, [["flesh", 10, 100]]);
    c.checkEnergyFieldBoom(1, []);
    assert.ok(!foe.dead, "血量等于场地高能：不爆");
    layers(foe2, [["flesh", 6, 100]]);
    foe2.statuses.high = true; foe2.highEnergy = 6;
    c.checkHighBoom(foe2);
    assert.ok(!foe2.dead, "血量等于高能值：不爆");
  }
});

test("离开冻土：简单运动检定（有熟练默认通过，没熟练 50%）；雪天失败的冰击破翻倍", () => {
  {
    const { c, st, kit } = field();
    const kolt = kit("kolt");   // 运动 1
    away(st, 2, u => !u.isPlayer);
    st.fields[1].ice = true; kolt.def = 5; kolt.bonus = 2; kolt.ap = 2; st.combatPhase = "player";
    c.Math.random = () => 0;
    c.doMove(kolt, 2);
    assert.equal(kolt.zone, 2);
    assert.equal(kolt.def, 5);
  }
  {
    const { c, st, kit } = field({ party: ["helu", "kolt"] });
    const helu = kit("helu");   // 没有运动
    away(st, 2, u => !u.isPlayer);
    c.setWeather("snow", { force: true });
    st.fields[1].ice = true; helu.def = 5; helu.bonus = 2; helu.ap = 2; st.combatPhase = "player";
    c.Math.random = () => 0.6;
    c.doMove(helu, 2);
    assert.equal(helu.zone, 1, "50% 没过");
    assert.equal(helu.def, 3, "雪天：冰击破 2");
    c.Math.random = () => 0.4;
    helu.bonus = 2;
    c.doMove(helu, 2);
    assert.equal(helu.zone, 2);
  }
});

test("自焚免疫灼烧：直接写进来的灼烧在回合结束结算前清掉；共振也分不过来", () => {
  const { c, st, kit } = field({ party: ["xia", "helu"] });
  const xia = kit("xia");
  layers(xia, [["flesh", 100, 100]]);
  xia.self = "burn"; xia.selfBurnStacks = 1;
  xia.statuses.burn = 1;   // 赤牙「点燃」的写法
  round(c);
  const lines = st.logPages.flatMap(p => p.lines).map(l => l.text);
  assert.ok(!lines.some(s => /灼烧\d+层分别掷骰/.test(s)), "没有先烫一跳");
  assert.ok(lines.some(s => /自焚：免疫灼烧/.test(s)));
  assert.equal(xia.statuses.burn, 0);
  // 共振分过来的灼烧也不吃
  const helu = kit("helu");
  helu.statuses.reso = true; xia.statuses.reso = true;
  c.grantBurn(helu, 1, []);
  assert.equal(helu.statuses.burn, 1);
  assert.ok(!(xia.statuses.burn > 0));
});

test("中和不把没有高能状态的蓄能单位当高能引爆；雪天霜结的回合开始击破不翻倍", () => {
  {
    const { c, kit } = field({ party: ["chuan", "helu"] });
    const ch = kit("chuan");
    layers(ch, [["flesh", 100, 100]]);
    ch.self = "store"; ch.highEnergy = 5; ch.statuses.high = false;
    c.applyNeutralize(ch);
    assert.ok(!ch.dying);
    assert.equal(hp(ch), 100);
  }
  {
    const { c, kit } = field();
    const helu = kit("helu");
    c.setWeather("snow", { force: true });
    helu.self = "frost"; helu.def = 5; helu.defMax = 5; helu.stunned = false;
    c.beginRound([]);
    assert.equal(helu.def, 4);
  }
});

test("隔离区里的火场不吃酷暑 +1 层", () => {
  const { c, st } = field();
  c.setWeather("heat", { force: true });
  st.fields[1].fireOn = true; st.fields[1].fire = 1; st.fields[1].isolate = true;
  c.tickFireField(1, []);
  assert.equal(st.fields[1].fire, 2);
  st.fields[1].isolate = false;
  c.tickFireField(1, []);
  assert.equal(st.fields[1].fire, 4, "不在隔离区照常 +2");
});

test("沙灵聚合体二阶段后（外层沙壳打穿）内层沙尘照常每回合回复，打穿的外层不复活", () => {
  const { c, st } = field({ enemies: [{ id: "sand_aggregate", lv: 3, zone: 1 }] });
  const agg = st.units.find(u => u.kit === "sand_aggregate");
  agg.layers[0].current = 0; agg.layers[0].max = 0; agg.resources.phase = 2;
  const inner = agg.layers[agg.layers.length - 1];
  assert.equal(inner.type, "sand");
  inner.current -= 10;
  const before = inner.current;
  c.beginRound([]);
  assert.equal(inner.current, before + 3);
  assert.equal(agg.layers[0].current, 0);
  assert.equal(agg.resources.phase, 2);
});
