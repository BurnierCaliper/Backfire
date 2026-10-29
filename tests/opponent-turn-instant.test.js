// 即时效果：施加时是谁的回合，就持续到那一方下一个回合开始之前（#482，作者 10/29，docs/pvp.md 第 2.1 节）。
// #476 按施加者那一队算，在对手的回合里用反应（协助攻击、借机攻击这类）施加的只经过一个回合就失效；现在不看是谁施加的：
//   我方回合里施加的 → 到下一个我方回合开始之前（整轮开始，beginRound）；敌人回合里施加的 → 到下一个敌人回合开始之前（lateRoundStart）。
// 这样从施加起一定经过一个我方回合和一个敌人回合（含施加时所在的那个）。黄金时间照旧再多保留一回合。
// 沙灵聚合体开炮后的自身熔融也照这个原则（去掉 meltHoldTurn）：在敌人回合开炮，正好持续到下一个我方回合结束。
// 规则在 app.js · instantLateNow / markTurnFx，enemies.js · aggOverheat / aggOverheated
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

const faction = (c, cmd) => c.Commands.dispatch(Object.assign({ type: "battle.playerFaction" }, cmd));
const logText = c => c.S.state.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
/** 从现在起新写的日志（fn 执行期间） */
const logOf = (c, fn) => { const before = logText(c).length; fn(); return logText(c).slice(before); };
/** 我方回合结束 → 敌人回合开始 */
const toEnemy = c => c.endPlayerTurn();
/** 敌人回合结束 → 整轮结束 → 下一回合的整轮开始、我方回合开始 */
const toPlayer = c => c.endEnemyTurn();
const noBlock = { pickBlocker: () => null, pickAssister: l => l[0].id };

/** 布置战场（和 tests/pvp-turn-effects.test.js 差不多）：party 全在 1 区（三区直排），角色一层 300 的肉体（刺骨的那一下打不死），
 *  敌人血厚、架势高（打不死也打不进失衡）。late：分到「乙」（在敌人回合行动）的角色；null = 不配置阵营（普通 PvE） */
function field(opt) {
  const party = opt.party;
  const c = H.load();
  c.BattleSim.setup({ party, enemies: opt.enemies || [{ id: "thug_knife", lv: 1, zone: 1 }], zoneMode: 3, seed: opt.seed || "OPP482" });
  const S = c.S.state;
  const heroes = party.map(k => c.findKit(k, S.units));
  heroes.forEach(h => { h.level = 15; h.layers = [{ type: "flesh", current: 300, max: 300, inner: true }]; });
  const foes = S.units.filter(u => !u.isPlayer);
  [...heroes, ...foes].forEach(u => { u.zone = 1; });
  foes.forEach(f => { f.layers = [{ type: "flesh", current: 500, max: 500 }]; f.def = f.defMax = 30; });
  if (opt.late) opt.late.forEach(k => faction(c, { faction: "乙", phase: "enemy", unit: c.findKit(k, S.units).id }));
  c.startCombat();
  return { c, S, foes, k: kit => c.findKit(kit, S.units) };
}
/** u 的反应（协助攻击等）：结算时 combatPhase 临时是 u 自己的回合（和 sim.js / game.js · withPhaseOf、battle-commands.js「assistAnswer」一样） */
function react(f, u, fn) {
  const prev = f.S.combatPhase;
  f.S.combatPhase = f.c.unitTurnPhase(u);
  try { fn(); } finally { f.S.combatPhase = prev; }
}

test("PvE：敌人在我方回合里用反应（警棍盾的协助攻击）施加的熔融——到下一个我方回合开始之前：撑过紧接着的敌人回合（以前在这个敌人回合开始就没了），整轮开始失效", () => {
  const f = field({ party: ["kolt", "helu"], late: null, enemies: [{ id: "riot_baton", lv: 5, zone: 1 }, { id: "riot_rifle", lv: 5, zone: 1 }] });
  const kolt = f.k("kolt");
  const baton = f.foes.find(u => u.kit === "riot_baton"), rifle = f.foes.find(u => u.kit === "riot_rifle");
  assert.equal(f.S.combatPhase, "player");
  // 我方回合里柯尔特被燃烧步枪（例：反应）打进失衡：敌人那边的协助攻击（AI 选警棍盾，结算时 combatPhase 临时是敌人回合）
  kolt.def = 0; kolt.stunned = true;
  f.c.queueAssistAttack(rifle, kolt);
  assert.equal(f.S.assistQueue.length, 1);
  const log0 = logOf(f.c, () => f.c.BattleSim.resolveQueues(noBlock));
  assert.ok(log0.includes(baton.name) && log0.includes(`${kolt.name} 被施加熔融`), log0);
  assert.equal(kolt.instant.melt, true, "警棍盾的协助攻击打中：熔融");
  assert.equal(f.S.combatPhase, "player", "还在我方回合");
  const mid = logOf(f.c, () => toEnemy(f.c));
  assert.equal(kolt.instant.melt, true, "紧接着的敌人回合开始：还在（以前按施加者那一队算，在这里就失效了，只经过了半个我方回合）");
  assert.ok(!mid.includes(`${kolt.name} 熔融结束`), mid);
  const log = logOf(f.c, () => toPlayer(f.c));
  assert.equal(kolt.instant.melt, false, "下一个我方回合开始之前（整轮开始）失效");
  assert.ok(log.includes(`${kolt.name} 熔融结束`), log);
  // 对照：敌人在敌人回合里施加的照旧（#476）撑过下一个我方回合，到下一个敌人回合开始之前
  toEnemy(f.c);
  f.c.applyInstantEffect(kolt, "melt", [], baton);
  toPlayer(f.c);
  assert.equal(kolt.instant.melt, true, "整轮开始：还在");
  toEnemy(f.c);
  assert.equal(kolt.instant.melt, false, "下一个敌人回合开始之前失效");
});

test("PvE：我方回合里施加的不管是谁施加的都到下一个整轮开始，敌人回合里施加的不管是谁都到下一个敌人回合开始；黄金时间照旧在这个基础上再多一回合", () => {
  const f = field({ party: ["kolt", "helu"], late: null });
  const kolt = f.k("kolt"), helu = f.k("helu"), thug = f.foes[0];
  // 敌人回合里我方的反应施加的：到下一个敌人回合开始之前（现在角色的反应都不带即时效果，这里在反应里直接施加）
  toEnemy(f.c);
  react(f, helu, () => f.c.applyInstantEffect(thug, "sting", [], helu));
  assert.equal(thug.instant.sting, true);
  toPlayer(f.c);
  assert.equal(thug.instant.sting, true, "整轮开始：还在（以前按施加者那一队算，在这里就失效了，只经过了半个敌人回合）");
  const log = logOf(f.c, () => toEnemy(f.c));
  assert.equal(thug.instant.sting, false, "下一个敌人回合开始之前失效");
  assert.ok(log.includes(`${thug.name} 刺骨结束`), log);
  // 黄金时间：我方回合里敌人的反应施加的刺骨，再多保留一回合（到再下一个整轮开始）
  toPlayer(f.c);
  react(f, thug, () => f.c.applyInstantEffect(kolt, "sting", [], thug));
  kolt.instant.goldHold = "sting";
  toEnemy(f.c);
  assert.equal(kolt.instant.sting, true, "敌人回合开始：还在");
  assert.equal(kolt.instant.goldHold, "sting", "敌人回合开始不用掉黄金时间");
  const gold = logOf(f.c, () => toPlayer(f.c));
  assert.equal(kolt.instant.sting, true, "整轮开始：黄金时间再保留一回合");
  assert.match(gold, /黄金时间：刺骨再保留一回合/);
  assert.ok(!kolt.instant.goldHold, "只延长一回合");
  toEnemy(f.c);
  assert.equal(kolt.instant.sting, true);
  toPlayer(f.c);
  assert.equal(kolt.instant.sting, false, "再下一个整轮开始：失效");
});

test("PvP：乙（在敌人回合行动）在我方回合里用反应施加的刺骨——到下一个我方回合开始之前：撑过紧接着的敌人回合（乙自己的回合），整轮开始失效；我方的人在敌人回合里用反应施加的到下一个敌人回合开始之前", () => {
  const f = field({ party: ["nora", "helu", "kolt"], late: ["nora"] });
  const nora = f.k("nora"), helu = f.k("helu"), kolt = f.k("kolt");
  assert.equal(f.c.lateTurn(nora), true, "诺拉在敌人回合行动");
  // 第 1 回合我方回合：乙的诺拉的反应（issue 的例子：协助攻击；现在角色的反应都不带即时效果，这里在反应里直接施加）把刺骨施加在我方的赫鲁米卡身上
  react(f, nora, () => f.c.applyInstantEffect(helu, "sting", [], nora));
  assert.equal(helu.instant.sting, true);
  toEnemy(f.c);
  assert.equal(helu.instant.sting, true, "紧接着的敌人回合（乙自己的回合）开始：还在（以前在这里就失效了，只经过了半个我方回合）");
  const log = logOf(f.c, () => toPlayer(f.c));
  assert.equal(helu.instant.sting, false, "下一个我方回合开始之前（整轮开始）失效");
  assert.ok(log.includes(`${helu.name} 刺骨结束`), log);
  // 第 2 回合敌人回合（乙自己的回合）：我方的柯尔特的反应把刺骨施加在乙的诺拉身上
  toEnemy(f.c);
  react(f, kolt, () => f.c.applyInstantEffect(nora, "sting", [], kolt));
  assert.equal(nora.instant.sting, true);
  toPlayer(f.c);
  assert.equal(nora.instant.sting, true, "整轮开始：还在（以前在这里就失效了，只经过了半个敌人回合）");
  const log2 = logOf(f.c, () => toEnemy(f.c));
  assert.equal(nora.instant.sting, false, "下一个敌人回合（乙下一个回合）开始之前失效");
  assert.ok(log2.includes(`${nora.name} 刺骨结束`), log2);
  assert.ok(!nora.lateFx, "记号也清掉");
  // 在自己的回合里施加的照旧（#476）：乙在敌人回合施加的到下一个敌人回合开始，我方在我方回合施加的到下一个整轮开始
  f.c.applyInstantEffect(helu, "spread", [], nora);
  toPlayer(f.c);
  assert.equal(helu.instant.spread, true);
  f.c.applyInstantEffect(nora, "spread", [], helu);
  toEnemy(f.c);
  assert.equal(helu.instant.spread, false, "乙在自己的回合施加的：下一个敌人回合开始之前失效（照旧）");
  assert.equal(nora.instant.spread, true, "我方在我方回合施加的：敌人回合里还在（照旧）");
  toPlayer(f.c);
  assert.equal(nora.instant.spread, false, "整轮开始失效（照旧）");
});

test("没开战时没有回合：施加的即时效果不记（上一场停在敌人回合、state.lateRound 和回合数一样也一样），开战的整轮开始失效", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], zoneMode: 3, seed: "OPP482-PRE" });
  const S = c.S.state;
  const kolt = c.findKit("kolt", S.units), thug = S.units.find(u => !u.isPlayer);
  kolt.layers = [{ type: "flesh", current: 300, max: 300, inner: true }];
  S.lateRound = S.turnNo;   // 上一场打到敌人回合结束时留下的
  assert.equal(S.combatStarted, false);
  c.applyInstantEffect(kolt, "sting", [], thug);
  assert.equal(kolt.instant.sting, true);
  assert.ok(!kolt.lateFx, "没开战：不记");
  c.startCombat();
  assert.equal(kolt.instant.sting, false, "开战的整轮开始失效");
});

test("沙灵聚合体：开炮后的自身熔融正好持续到下一个我方回合结束——下一个敌人回合开始时失效（以前另算 meltHoldTurn，撑到再下一个整轮开始）；状态栏的「过热」跟着", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "sand_aggregate", lv: 5, zone: 2 }], seed: "AGG482", zoneMode: 2 });
  c.startCombat();
  const S = c.S.state;
  const a = S.units.find(u => u.kit === "sand_aggregate");
  const k = c.findKit("kolt", S.units), h = c.findKit("helu", S.units);
  k.prideMaxHp = Infinity;
  k.layers.forEach(l => { l.max = 2000; l.current = 2000; });   // 血量上限最高：电能炮锁定他
  h.layers.forEach(l => { l.max = 999; l.current = 999; });
  k.zone = 2; h.zone = 2;
  // 打穿外层沙壳进入二阶段：挂上电能炮
  a.layers[0].current = 1;
  c.dealTo(k, a, { atk: 50, mult: 1, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });
  assert.equal(a.resources.phase, 2);
  const m = a.mechanics.find(x => x.aggCannon);
  // 照正常的回合推进，到开炮的那个敌人回合（敌人不行动）
  while (S.turnNo < m.st.due) { toEnemy(c); c.BattleSim.resolveQueues(noBlock); toPlayer(c); c.BattleSim.resolveQueues(noBlock); }
  assert.ok(!(a.instant && a.instant.melt));
  const fire = logOf(c, () => { toEnemy(c); c.BattleSim.resolveQueues(noBlock); });
  assert.match(fire, /开炮后机体过热/);
  assert.equal(a.instant.melt, true, "敌人回合开始开炮：过热，自身熔融");
  assert.match(c.statusLine(a), /过热/);
  toPlayer(c);
  c.BattleSim.resolveQueues(noBlock);
  assert.equal(a.instant.melt, true, "下一个我方回合里还熔融着（输出窗口）");
  assert.match(c.statusLine(a), /过热/);
  const end = logOf(c, () => toEnemy(c));   // 我方回合结束 → 下一个敌人回合开始
  assert.equal(a.instant.melt, false, "下一个我方回合结束（下一个敌人回合开始）时失效——以前撑过这个敌人回合，到再下一个整轮开始才结束");
  assert.ok(end.includes(`${a.name} 熔融结束`), end);
  assert.doesNotMatch(c.statusLine(a), /过热/);
  assert.ok(!a.lateFx, "记号也清掉");
});
