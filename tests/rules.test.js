// 规则回归测试：每条对应一次已经修过的问题，防止以后改坏。
// 运行：npm test（或 node --test "tests/*.test.js"）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
// 规则环境里造出来的数组/对象属于另一个 realm，比较前先转成普通值
const plain = (x) => JSON.parse(JSON.stringify(x));

/** 布一个小战场：给定队伍 + 敌人，已开战 */
function field(party, enemies, opt) {
  const c = H.load();
  c.BattleSim.setup(Object.assign({ party, enemies, seed: "RULES" }, opt || {}));
  c.startCombat();
  const st = c.S.state;
  const act = (a, t, id) => { a.ap = 5; a.bonus = 5; st.attackerId = a.id; st.targetId = t ? t.id : null; c.runSkill(id); };
  const lines = () => st.logPages.flatMap(p => p.lines).map(l => l.text);
  return { c, st, act, lines, foes: st.units.filter(u => !u.isPlayer) };
}
const hit = (el) => ({ atk: 1, mult: 1, element: el, baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });

test("柯尔特普攻（电钻）三段合计 2 击破，不是每段 2", () => {
  const { c, st, act, foes } = field(["kolt", "helu"], [{ id: "bandit_boss", lv: 1, zone: 2 }]);
  const kolt = c.findKit("kolt", st.units), boss = foes[0];
  kolt.zone = boss.zone; kolt.resources.bit = "drill";
  boss.def = boss.defMax = 20;
  act(kolt, boss, "kolt_aa");
  assert.equal(20 - boss.def, 2);
});

test("过度自信：靠废物利用的临时层把血量堆回上限也触发减伤；战斗结束临时层消失", () => {
  const { c, st, act, foes } = field(["kolt", "helu"], [{ id: "thug_hammer", lv: 1, zone: 2 }]);
  const kolt = c.findKit("kolt", st.units), foe = foes[0];
  kolt.layers[0].current = 15;
  st.lastBrokenLayer = { type: "armor", lost: 5, dmg: 5 };
  act(kolt, null, "kolt_scrap");
  assert.equal(c.totalCurHp(kolt), 25);
  assert.equal(c.baseMaxHp(kolt), 20);
  foe.zone = kolt.zone;
  const out = c.dealTo(foe, kolt, Object.assign(hit("physical"), { atk: 10 }));
  assert.ok(out.res.flags.prideReduce);
  c.resetBattleFlags(kolt);
  assert.deepEqual(plain(kolt.layers.map(l => [l.type, l.max])), [["flesh", 20]]);
});

test("临时血量叠在已有的层上时，战斗结束只扣掉叠上去的部分", () => {
  const { c, st } = field(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const kolt = c.findKit("kolt", st.units);
  c.addTempLayer(kolt, "flesh", 7);
  assert.equal(kolt.layers.length, 1);
  assert.equal(kolt.layers[0].max, 27);
  assert.deepEqual(plain(c.persistentLayers(kolt)), [{ type: "flesh", current: 20 }]);
  c.resetBattleFlags(kolt);
  assert.equal(kolt.layers[0].max, 20);
});

test("聚焦：按序列打完就抹去该层；抹的是内层则直接击杀", () => {
  const { c, st, foes } = field(["kolt", "helu"], [{ id: "bandit_boss", lv: 1, zone: 2 }]);
  const helu = c.findKit("helu", st.units), boss = foes[0];
  helu.zone = 1;
  c.applyFocus(boss, c.innermostLayer(boss).type, []);
  boss.focuses[0].seq.forEach(el => c.dealTo(helu, boss, hit(el)));
  assert.equal(boss.dead, true);
  assert.equal(boss.focuses.length, 0);
});

test("聚焦外层：抹去后单位存活，内层不受影响", () => {
  const { c, st, foes } = field(["kolt", "helu"], [{ id: "bandit_boss", lv: 1, zone: 2 }]);
  const helu = c.findKit("helu", st.units), boss = foes[0];
  helu.zone = 1;
  boss.layers = [{ type: "shield", current: 10, max: 10 }, { type: "armor", current: 10, max: 10 }, { type: "flesh", current: 20, max: 20, inner: true }];
  c.applyFocus(boss, "armor", []);
  boss.focuses[0].seq = ["acid", "acid"];   // 酸打装甲有克制，保证每一下都有伤害
  boss.focuses[0].seq.forEach(el => c.dealTo(helu, boss, hit(el)));
  assert.deepEqual(plain(boss.layers.map(l => l.type)), ["shield", "flesh"]);
  assert.equal(boss.dead, false);
});

test("拉斯缪尔：能量到 100% 就进入不稳态", () => {
  const { c, st } = field(["ras", "helu"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const ras = c.findKit("ras", st.units);
  ras.resources.energyPct = 80;
  c.addRasEnergy(20, "测试");
  assert.equal(ras.resources.unstable, true);
});

test("开战时按实际人数平衡敌人：3 人建的敌人，2 人开战 → 换算成 2 人的数值", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu", "ras"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }, { id: "bandit_boss", lv: 1, zone: 2 }] });
  const st = c.S.state;
  const ras = c.findKit("ras", st.units);
  st.units = st.units.filter(u => u !== ras);
  c.startCombat();
  const two = H.load();
  two.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }, { id: "bandit_boss", lv: 1, zone: 2 }] });
  const want = two.S.state.units.filter(u => !u.isPlayer).map(u => [u.layers.map(l => l.max), u.defMax]);
  const got = st.units.filter(u => !u.isPlayer).map(u => [u.layers.map(l => l.max), u.defMax]);
  assert.deepEqual(plain(got), plain(want));
});

test("减员到只剩 1 人时，敌人不做特殊调整（按 2 人基准）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  const st = c.S.state;
  const before = st.units.filter(u => !u.isPlayer).map(u => u.layers.map(l => l.max));
  c.findKit("helu", st.units).dead = true;
  c.startCombat();
  assert.deepEqual(plain(st.units.filter(u => !u.isPlayer).map(u => u.layers.map(l => l.max))), plain(before));
});

test("本行动合计包含高压场地等连带伤害", () => {
  const { c, st, act, lines, foes } = field(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const kolt = c.findKit("kolt", st.units), t = foes[0];
  kolt.zone = t.zone; t.def = t.defMax = 30;
  c.setZoneField(t.zone, "electric");
  act(kolt, t, "kolt_aa");
  const sum = lines().filter(s => /本行动合计/.test(s)).pop();
  assert.match(sum, /连带 \d+：高压场地 \d+/);
});

test("开战后是第 1 回合，结束一轮后是第 2 回合", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  c.appendLog("布置阶段的一条记录");
  c.startCombat();
  assert.equal(c.S.state.turnNo, 1);
  c.endPlayerTurn();
  c.endEnemyTurn();
  assert.equal(c.S.state.turnNo, 2);
});

/* ---------- 手册规则：力竭、濒死恢复、武器人伤势、撤退、职责技能选择 ---------- */

test("力竭 1：不能用坚毅生命起身", () => {
  const { c, st } = field(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const kolt = c.findKit("kolt", st.units);
  st.exhaustTier = 1;
  kolt.layers[0].current = 0; kolt.dying = true;
  c.standUp(kolt);
  assert.equal(kolt.upOnShp, false);
  assert.match(c.standUpBlocked(kolt), /力竭/);
});

test("力竭 2：atk −3、def −1", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  const st = c.S.state, kolt = c.findKit("kolt", st.units);
  const atk = c.effectiveAtk(kolt, st.units), def = kolt.defMax;
  st.exhaustTier = 2;
  c.startCombat();
  assert.equal(c.effectiveAtk(kolt, st.units), atk - 3);
  assert.equal(kolt.defMax, def - 1);
});

test("力竭 3：被击倒立刻死亡", () => {
  const { c, st, foes } = field(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const kolt = c.findKit("kolt", st.units);
  st.exhaustTier = 3;
  kolt.layers[0].current = 1;
  foes[0].zone = kolt.zone;
  c.dealTo(foes[0], kolt, Object.assign(hit("physical"), { atk: 30 }));
  assert.equal(kolt.dead, true);
});

test("战斗结束：濒死的角色恢复到 1 点生命", () => {
  const { c, st } = field(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const kolt = c.findKit("kolt", st.units);
  kolt.layers[0].current = 0; kolt.dying = true;
  c.recoverDownedAfterBattle([]);
  assert.equal(kolt.dying, false);
  assert.equal(c.totalCurHp(kolt), 1);
});

test("武器人伤势跨战斗保留；上一场倒下的武器人长休前唤不出来", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  let st = c.S.state;
  const kolt = c.findKit("kolt", st.units);
  const torque = c.spawnWeapon(kolt, "torque");
  torque.layers[0].current = 3;
  c.ledgerCapture();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  st = c.S.state;
  const t2 = c.spawnWeapon(c.findKit("kolt", st.units), "torque");
  assert.equal(t2.layers[0].current, 3);
  t2.layers[0].current = 0; t2.dead = true;
  c.ledgerCapture();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  assert.equal(c.weaponSummonWhy(c.findKit("kolt", c.S.state.units), "torque").includes("长休"), true);
});

test("撤退：全员完好 → 每人坚毅 −3 且不致死、耗时 2 小时", () => {
  const { c, st } = field(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const kolt = c.findKit("kolt", st.units);
  kolt.shp = 2;
  const r = c.performRetreat();
  assert.equal(r.key, "intact");
  assert.equal(kolt.shp, 1);
  assert.equal(kolt.dead, false);
});

test("撤退：半数倒地 → 断后挨打、丢战斗道具和部分奎支、倒地者坚毅 −7", () => {
  const { c, st } = field(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const kolt = c.findKit("kolt", st.units), helu = c.findKit("helu", st.units);
  helu.layers[0].current = 0; helu.dying = true; helu.shp = 12;
  st.kuizhi = 1000;
  c.ensureBag(); st.bag.items.push({ id: Object.keys(c.ITEM_CATALOG).find(k => c.ITEM_CATALOG[k].combat), qty: 2 });
  const hpBefore = c.totalCurHp(kolt);
  const r = c.performRetreat(kolt.id);
  assert.equal(r.key, "routed");
  assert.equal(helu.shp, 5);
  assert.equal(st.kuizhi, 750);
  assert.ok(st.bag.items.every(x => !c.ITEM_CATALOG[x.id].combat || x.qty === 0));
  assert.ok(c.totalCurHp(kolt) < hpBefore, "断后的人应该挨了一下");
});

test.skip("职责技能：5 级在副职责一与主职责二之间选（ROLE_PATH_CHOICE 关着，先不测）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["hiaki", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  const h = c.findKit("hiaki", c.S.state.units);
  h.level = 5;
  const opts = plain(c.roleChoicesAt(h, 5));
  assert.equal(opts.length, 2);
  h.rolePicks = { 5: opts[1] };
  const got = plain(c.roleSkillsUnlocked(h));
  assert.deepEqual(got, [{ role: h.roles.primary, n: 1 }, opts[1]]);
  // 10 级：已经拿了主职责二的话，只剩主职责三
  h.level = 10;
  if (opts[1].role === h.roles.primary && opts[1].n === 2) {
    assert.deepEqual(plain(c.roleChoicesAt(h, 10)), [{ role: h.roles.primary, n: 3 }]);
  }
});

test("游戏版（GAME_MODE）不向玩家透露坚毅生命数值；计算器照常显示", () => {
  for (const game of [false, true]) {
    const c = H.load();
    if (game) c.GAME_MODE = true;
    c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
    const kolt = c.findKit("kolt", c.S.state.units);
    kolt.shp = 3;
    c.ledgerCapture();
    const r = c.ledgerLongRest({ force: true }, []);
    const line = r.notes.find(t => t.startsWith(kolt.name) && t.includes("坚毅"));
    assert.ok(line, "应当有一句坚毅相关的说明");
    assert.equal(/坚毅 \d/.test(line), !game, line);
  }
});

test("敌人被致命一击同时打到失衡：不能再发动协助攻击", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], seed: "ASSIST", enemies: [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_hammer", lv: 1, zone: 1 }] });
  c.startCombat();
  const st = c.S.state;
  st.units.forEach(u => { u.zone = 1; });
  const kolt = c.findKit("kolt", st.units);
  const [foe, foe2] = st.units.filter(u => !u.isPlayer);
  // 1) 同一击先失衡、再被打死
  foe.def = 1; foe.stunned = false;
  c.dealTo(kolt, foe, { atk: 999, mult: 1, element: "physical", baseBreak: 1, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });
  c.pruneAssistQueue();
  assert.equal((st.assistQueue || []).filter(j => j.targetId === foe.id).length, 0);
  assert.equal(c.eligibleAssisters(kolt, foe).length, 0);
  // 2) 失衡排上队之后，被别的伤害打死：发动时取消
  foe2.def = 1; foe2.stunned = false;
  c.dealBreak(foe2, 1, "physical", []);
  assert.ok((st.assistQueue || []).some(j => j.targetId === foe2.id), "应当先排上协助攻击");
  foe2.layers.forEach(l => { l.current = 0; });
  const hp = c.totalHp(foe2);
  const helu = c.findKit("helu", st.units);
  c.finishAssist(helu.id);
  assert.equal(c.totalHp(foe2), hp);
  assert.equal((st.assistQueue || []).length, 0);
});

test("职责技能按角色卡的专精规则：非专精 5 级副一 → 10 级主二 → 15 级主三，拿不到技能四；专精一路到主四", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["hiaki", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  const h = c.findKit("hiaki", c.S.state.units);   // 击破 / 护卫：不是专精
  const k = c.findKit("kolt", c.S.state.units);    // 专精坦克
  const P = h.roles.primary, S = h.roles.secondary;
  assert.deepEqual(plain(c.roleChoicesAt(h, 5)), [{ role: S, n: 1 }], "目前没有选择");
  h.rolePicks = {}; h.level = 15;
  assert.deepEqual(plain(c.roleSkillsUnlocked(h)), [{ role: P, n: 1 }, { role: S, n: 1 }, { role: P, n: 2 }, { role: P, n: 3 }]);
  // 旧存档里按旧规则记了主四：不认
  h.rolePicks = { 5: { role: P, n: 2 }, 10: { role: P, n: 3 }, 15: { role: P, n: 4 } };
  assert.ok(!plain(c.roleSkillsUnlocked(h)).some(x => x.n === 4));
  k.rolePicks = {}; k.level = 15;
  const KP = k.roles.primary;
  assert.deepEqual(plain(c.roleSkillsUnlocked(k)), [{ role: KP, n: 1 }, { role: KP, n: 2 }, { role: KP, n: 3 }, { role: KP, n: 4 }]);
});
