// 主持人手册第十章 · 亡命之王：一回合一动、固定随从、狂徒替他挨打、攻击命令、哗变与继位
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], seed: "KING", enemies: [
    { id: "outlaw_king", lv: 1, zone: 1 }, { id: "bandit_boss", lv: 1, zone: 1 },
    { id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_hammer", lv: 1, zone: 1 }] });
  c.startCombat();
  const st = c.S.state;
  st.units.forEach(u => { u.zone = 1; });
  const k = id => c.findKit(id, st.units);
  const hit = (a, t, extra) => c.dealTo(a, t, Object.assign({ atk: 10, mult: 1, element: "physical", baseBreak: 0, atkRange: "any",
    flags: { action: true, blockResolved: true, block: "none" } }, extra || {}));
  const kill = u => { u.layers.forEach(l => { l.current = 0; }); c.settleEnemyKill(u, []); };
  return { c, st, king: k("outlaw_king"), boss: k("bandit_boss"), knife: k("thug_knife"), hammer: k("thug_hammer"), kolt: k("kolt"), helu: k("helu"), hit, kill };
}

test("亡命之王一回合一动（不是指挥官）；赤牙是指挥官，3 行动点", () => {
  const { c, king } = field();
  assert.equal(c.enemyActBudget(king).ap, 1);
  assert.equal(c.enemyActBudget({ kit: "chixia" }).ap, 3);
});

test("首领战固定带强盗头子、匕首狂徒、锤狂徒各一，与王同区", () => {
  const c = H.load();
  for (const tokens of [0, 1, 4]) {
    const enc = c.rollBossEncounter("outlaw_king", { region: "外城区", tokens });
    const ids = JSON.parse(JSON.stringify(enc.enemies.map(e => e.preset))).sort();
    assert.deepEqual(ids, ["bandit_boss", "outlaw_king", "thug_hammer", "thug_knife"]);
    assert.equal(new Set(enc.enemies.map(e => e.zone)).size, 1, "随从与王同区");
  }
});

test("对王的单体攻击由同区狂徒承受；同区没有狂徒时才打到王", () => {
  const { c, king, boss, knife, hammer, kolt, hit } = field();
  const kHp = c.totalHp(king);
  const others = c.totalHp(boss) + c.totalHp(knife) + c.totalHp(hammer);
  hit(kolt, king);
  assert.equal(c.totalHp(king), kHp);
  assert.ok(c.totalHp(boss) + c.totalHp(knife) + c.totalHp(hammer) < others);
  [boss, knife, hammer].forEach(u => { u.zone = 2; });
  hit(kolt, king);
  assert.ok(c.totalHp(king) < kHp);
});

test("攻击命令：所有狂徒目标切到被命令的人", () => {
  const { c, st, king, knife, helu } = field();
  st.attackerId = king.id; st.targetId = helu.id;
  c.runSkill("en_king_atk");
  assert.equal(c.S.EnemyAI.target(knife, { aim: "local" }, c.S.EnemyAI.players()).unit, helu);
});

test("哗变：强盗头子 ≤25% 且同区没有其他狂徒 → 挟持王；王不能行动、易伤；狂徒只能反水打 1d6", () => {
  const { c, st, king, boss, knife, hammer, kolt, hit, kill } = field();
  boss.layers.forEach(l => { l.current = Math.floor(l.max * 0.2); });
  c.mutinyTick([]);
  assert.ok(!king.resources.hostage, "同区还有狂徒，不哗变");
  kill(knife);
  hammer.zone = 2;                              // 锤狂徒走开：同区只剩头子和王
  const notes = [];
  c.beginRound(notes);
  assert.equal(king.resources.hostage, true);
  assert.equal(c.enemySkillList(king).length, 0);
  // 挟持时失去护卫，王直接挨打且易伤
  const kHp = c.totalHp(king);
  const r = hit(kolt, king);
  assert.ok(c.totalHp(king) < kHp);
  assert.ok((r.res.log || []).some(s => /挟持/.test(s)));
  // 狂徒反水：只有 1d6，不加 atk
  assert.deepEqual(JSON.parse(JSON.stringify(c.enemySkillList(hammer).map(s => s.id))), ["en_thug_mutiny"]);
  hammer.zone = 1;
  boss.layers.forEach(l => { l.current = l.type === "flesh" ? l.max : 0; });   // 只留肉体，免得装甲把小伤害减没
  const bHp = c.totalHp(boss);
  st.combatPhase = "enemy"; hammer.ap = 1;
  st.attackerId = hammer.id; st.targetId = boss.id;
  c.runSkill("en_thug_mutiny");
  const dealt = bHp - c.totalHp(boss);
  assert.ok(dealt >= 1 && dealt <= 6, "反水伤害 " + dealt);
});

test("王在被挟持时被杀：强盗头子继位，atk / def 翻倍，狂徒不再反水", () => {
  const { c, king, boss, knife, hammer, kill } = field();
  kill(knife); hammer.zone = 2;
  boss.layers.forEach(l => { l.current = 1; });
  c.mutinyTick([]);
  assert.equal(king.resources.hostage, true);
  const atk = boss.atk, def = boss.def;
  kill(king);
  assert.equal(boss.atk, atk * 2);
  assert.equal(boss.def, def * 2);
  assert.ok(!c.enemySkillList(hammer).some(s => s.id === "en_thug_mutiny"));
});

/* ---------- 回防命令：废铁墙（照川川的铁壁做） ---------- */
function holdField() {
  const f = field();
  const { st, king, knife, hammer, kolt, helu } = f;
  knife.zone = 2; hammer.zone = 2;          // 狂徒散在外面
  kolt.zone = 2; helu.zone = 2;             // 我方在另一区
  king.ap = 1;
  st.combatPhase = "enemy";
  st.attackerId = king.id; st.targetId = null;
  f.c.runSkill("en_king_hold");
  st.combatPhase = "player";
  return Object.assign(f, { wall: (st.props || []).find(p => p.kind === "scrapwall") });
}

test("回防命令：狂徒回到王所在区，在区里筑废铁墙（1d4 × 狂徒人数装甲），不再动区间", () => {
  const { st, king, boss, knife, hammer, wall } = holdField();
  assert.ok(wall, "应该有一堵废铁墙");
  assert.equal(wall.zone, king.zone);
  assert.equal(wall.faction, "enemy");
  [boss, knife, hammer].forEach(u => assert.equal(u.zone, king.zone));
  assert.ok(wall.hp >= 3 && wall.hp <= 12 && wall.hp % 3 === 0, "1d4 × 3 名狂徒：" + wall.hp);
  assert.ok(!st.gaps["1-2"] || st.gaps["1-2"].type !== "wall", "不再把 1-2 间隔变成危墙");
});

test("废铁墙：我方一次攻击行动打同区敌人，只有墙吃这一下（装甲克制照算），其余同区伤害被挡住", () => {
  const { c, st, king, knife, hammer, kolt, wall } = holdField();
  wall.hp = wall.maxHp = 40;
  const hpK = c.totalHp(knife), hpH = c.totalHp(hammer);
  c.beginActionAcc(kolt);
  const r1 = c.dealTo(kolt, knife, { atk: 10, mult: 1, element: "acid", baseBreak: 1, flags: { action: true, blockResolved: true, block: "none" } });
  assert.equal(c.totalHp(knife), hpK, "狂徒没挨打");
  assert.equal(wall.hp, 40 - 15, "酸打装甲 +50%：10 → 15");
  assert.equal(r1.res.total, 15, "返回的是打在墙上的这一下");
  // 同一个行动的第二下（AOE 的另一个目标）：被挡住，墙也不再扣
  c.dealTo(kolt, hammer, { atk: 10, mult: 1, element: "acid", baseBreak: 1, flags: { action: true, blockResolved: true, block: "none" } });
  assert.equal(c.totalHp(hammer), hpH);
  assert.equal(wall.hp, 25);
  // 下一个行动又打一次墙
  c.beginActionAcc(kolt);
  c.dealTo(kolt, king, { atk: 10, mult: 1, element: "physical", baseBreak: 1, flags: { action: true, blockResolved: true, block: "none" } });
  assert.equal(wall.hp, 25 - 7, "物理打装甲 −25%：10 → 7");
  // 不是攻击行动（状态、场地伤害）不挡
  c.applyTypedDot(knife, 3, "fire", [], "测试");
  assert.ok(c.totalHp(knife) < hpK);
});

test("废铁墙被打塌就移出战场，之后正常挨打；撑过玩家回合的在敌人回合开始时撤掉", () => {
  const { c, st, knife, kolt, wall } = holdField();
  wall.hp = wall.maxHp = 3;
  c.beginActionAcc(kolt);
  c.dealTo(kolt, knife, { atk: 10, mult: 1, element: "physical", baseBreak: 0, flags: { action: true, blockResolved: true, block: "none" } });
  assert.ok(!(st.props || []).some(p => p.kind === "scrapwall"), "打塌了");
  const hp = c.totalHp(knife);
  c.beginActionAcc(kolt);
  c.dealTo(kolt, knife, { atk: 10, mult: 1, element: "physical", baseBreak: 0, flags: { action: true, blockResolved: true, block: "none" } });
  assert.ok(c.totalHp(knife) < hp);
  // 再筑一堵，敌人回合开始时撤掉
  const f2 = holdField();
  assert.ok(f2.wall);
  f2.c.startEnemyPhase();
  assert.ok(!(f2.st.props || []).some(p => p.kind === "scrapwall"));
});

test("废铁墙不挡敌人打我方；铁壁照旧只挡敌人", () => {
  const { c, st, king, kolt, wall } = holdField();
  kolt.zone = king.zone;
  const hp = c.totalHp(kolt);
  c.beginActionAcc(king);
  c.dealTo(king, kolt, { atk: 5, mult: 1, element: "physical", baseBreak: 0, flags: { action: true, blockResolved: true, block: "none" } });
  assert.ok(c.totalHp(kolt) < hp);
  assert.equal(wall.hp, wall.maxHp);
});

test("行动顺序：亡命之王总是第一个行动（命令要用狂徒这一回合的行动点），其余照杂兵 → 精英 → 首领", () => {
  const { c, st } = field();
  const order = c.EnemyAI.actingOrder().map(id => st.units.find(u => u.id === id).kit);
  assert.equal(order[0], "outlaw_king");
  assert.ok(order.indexOf("thug_knife") < order.indexOf("bandit_boss"));
});

test("回防命令排在最前：狂徒还没行动，各花 1 行动点回到王身边筑废铁墙（以前王最后行动，狂徒行动点早用完了）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "yuito"], seed: "KH", zoneMode: 3,
    enemies: [{ id: "outlaw_king", lv: 5, zone: 3 }, { id: "thug_knife", lv: 5, zone: 1 }, { id: "thug_hammer", lv: 5, zone: 1 }] });
  c.startCombat();
  const S = c.S.state; S.zoneMode = 3;
  const king = c.findKit("outlaw_king", S.units);
  const thugs = S.units.filter(u => /^thug_/.test(u.kit));
  king.zone = 3; thugs.forEach(u => { u.zone = 1; });
  c.findKit("kolt", S.units).zone = 3;   // 有人冲进王所在的区，身边又没有狂徒：该回防
  c.findKit("yuito", S.units).zone = 1;
  c.endPlayerTurn();
  S.combatPhase = "enemy";
  const ap0 = thugs.map(u => u.ap);
  assert.ok(ap0.every(a => a > 0));
  const first = S.units.find(u => u.id === c.EnemyAI.actingOrder()[0]);
  assert.equal(first, king);
  const plan = c.EnemyAI.plan(king);
  assert.equal(plan.meta.skillName, "回防命令（筑废铁墙）");
  plan.thunk();
  assert.ok(thugs.every(u => Number(u.zone) === 3), "狂徒回到王身边");
  assert.ok(thugs.every((u, i) => u.ap === ap0[i] - 1), "各花掉 1 行动点");
  const wall = (S.props || []).find(p => p.kind === "scrapwall");
  assert.ok(wall && wall.hp > 0, "废铁墙筑起来了");
});
