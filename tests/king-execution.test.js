// 亡命之王强化：公开处刑（死刑机制，手下各补一刀）、回防后的齐射、狂徒援军、攻击 / 处死命令的骰子随等级升档（engine.js · KING_CFG）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");

function field(lv) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], seed: "KINGX", enemies: [
    { id: "outlaw_king", lv: lv || 1, zone: 1 }, { id: "bandit_boss", lv: lv || 1, zone: 1 },
    { id: "thug_knife", lv: lv || 1, zone: 1 }, { id: "thug_hammer", lv: lv || 1, zone: 1 }] });
  c.startCombat();
  const st = c.S.state;
  st.units.forEach(u => { u.zone = 1; });
  const k = id => c.findKit(id, st.units);
  const kolt = k("kolt"), helu = k("helu");
  kolt.layers.forEach(l => { l.max = 3000; l.current = 3000; });   // 血量上限最高：处刑锁定他
  helu.layers.forEach(l => { l.max = 999; l.current = 999; });
  const kill = u => { u.layers.forEach(l => { l.current = 0; }); c.settleEnemyKill(u, []); };
  const logs = () => st.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
  return { c, st, king: k("outlaw_king"), boss: k("bandit_boss"), knife: k("thug_knife"), hammer: k("thug_hammer"), kolt, helu, kill, logs };
}
const CFG = c => vm.runInContext("KING_CFG", c);
const setTurn = (st, n) => { st.turnNo = n; st.logPages.push({ turn: n, lines: [{ text: "" }] }); };
const noBlock = { pickBlocker: () => null, pickAssister: l => l[0].id };
const exec = king => king.mechanics.find(m => m.kingExec);

test("开场挂上公开处刑：锁定血量上限最高的人，按配置的回合落下", () => {
  const { c, st, king, kolt } = field();
  const m = exec(king);
  c.bossMechSync([]);
  assert.ok(m, "挂上公开处刑");
  assert.equal(m.st.targetId, kolt.id);
  assert.equal(m.st.due, CFG(c).exec.firstTurn + CFG(c).exec.turns);
  assert.ok(st.combatStarted);
});

test("落下：王一刀 + 每个还站着的手下各补一刀；先清掉手下，处刑就少几刀", () => {
  {
    const { c, st, king, logs } = field();
    const m = exec(king); c.bossMechSync([]);
    setTurn(st, m.st.due); st.combatPhase = "enemy";
    c.bossMechPhaseStart("enemy", []); c.BattleSim.resolveQueues(noBlock);
    assert.match(logs(), /执行公开处刑！（4 段）/, "王 + 强盗头子 + 两个狂徒");
    assert.match(logs(), /【强盗头子】公开处刑 第 2\/4 段落下|【狂徒（[^）]+）】公开处刑 第 2\/4 段落下/, "手下那几刀由手下出手");
  }
  {
    const { c, st, king, knife, hammer, kill, logs } = field();
    kill(knife); kill(hammer);
    const m = exec(king); c.bossMechSync([]);
    setTurn(st, m.st.due); st.combatPhase = "enemy";
    c.bossMechPhaseStart("enemy", []); c.BattleSim.resolveQueues(noBlock);
    assert.match(logs(), /执行公开处刑！（2 段）/, "只剩王和强盗头子");
  }
});

test("王被挟持（哗变）时处刑推迟一回合", () => {
  const { c, st, king, logs } = field();
  const m = exec(king); c.bossMechSync([]);
  king.resources.hostage = true;
  const due = m.st.due;
  setTurn(st, due); st.combatPhase = "enemy";
  c.bossMechPhaseStart("enemy", []);
  assert.equal(m.st.due, due + 1);
  assert.doesNotMatch(logs(), /执行公开处刑/);
});

test("回防命令：标记我方每个角色（武器人不算），下一个敌人回合开始时王各开一枪；每枪 atk + 1d8 物理 2 击破、可以格挡；用掉王那回合的行动点", () => {
  const { c, st, king, kolt, helu, logs } = field();
  helu.zone = 2;   // 分散站：回防命令只在手下分散时有意义，这里直接放技能
  st.combatPhase = "enemy"; king.ap = 1; st.attackerId = king.id; st.targetId = kolt.id;
  c.runSkill("en_king_hold");
  const v = king.mechanics.find(m => m.kingVolley);
  assert.ok(v, "挂上齐射");
  assert.deepEqual(JSON.parse(JSON.stringify(v.st.targetIds)).sort(), [kolt.id, helu.id].sort(), "我方每个角色都被瞄准");
  assert.equal(v.st.due, st.turnNo + 1, "下一个敌人回合开始时开枪");
  assert.ok(c.bossMarksOn(kolt).some(x => x.type === "volley"), "角色身上看得到齐射标记");
  const k0 = kolt.layers.reduce((n, l) => n + l.current, 0), h0 = helu.layers.reduce((n, l) => n + l.current, 0);
  setTurn(st, v.st.due); st.combatPhase = "enemy";
  c.bossMechPhaseStart("enemy", []); c.BattleSim.resolveQueues(noBlock);
  assert.match(logs(), /【齐射】亡命之王 朝 .* 各开一枪！（2 枪/);
  assert.ok(kolt.layers.reduce((n, l) => n + l.current, 0) < k0 && helu.layers.reduce((n, l) => n + l.current, 0) < h0, "每人一枪");
  assert.equal(v.st.done, true, "只放一次");
  c.refreshEnemyEconomy(king);
  assert.equal(king.ap, 0, "这回合的行动点用在了齐射上");
});

test("齐射和公开处刑撞在同一回合：处刑往后推一回合；上一轮没打出去不重复挂", () => {
  const { c, st, king, kolt } = field();
  const ex = exec(king); c.bossMechSync([]);
  setTurn(st, ex.st.due - 1); st.combatPhase = "enemy"; king.ap = 1; st.attackerId = king.id; st.targetId = kolt.id;
  const due = ex.st.due;
  c.runSkill("en_king_hold");
  assert.equal(ex.st.due, due + 1, "处刑让位给齐射");
  king.ap = 1; c.runSkill("en_king_hold");
  assert.equal(king.mechanics.filter(m => m.kingVolley).length, 1);
});

test("首领战开场就写着狂徒援军；援军到王身边集合；场上全灭就不来了", () => {
  const c = H.load();
  const enc = c.rollBossEncounter("outlaw_king", { region: "外城区", zoneMode: 3 });
  assert.equal(enc.waves.length, 2);
  assert.ok(enc.waves.every(w => w.enemies.every(e => /^thug_/.test(e.preset))), "援军都是杂兵狂徒");
  c.BattleSim.setup({ party: ["kolt", "helu"], encounter: enc, level: 5, seed: "KW" });
  c.startCombat();
  const st = c.S.state;
  assert.equal(c.Chain.status().waves.length, 2, "开场就有援军倒计时");
  assert.match(c.Chain.barHtml(c.Chain.status()), /援军 2 个/);
  const king = st.units.find(u => u.kit === "outlaw_king");
  king.zone = 1;
  st.waves[0].at = st.turnNo;
  c.Chain.roundStart([]);
  const fresh = st.units.filter(u => /^thug_/.test(u.kit) && u.zone === 1);
  assert.equal(fresh.length, 2, "援军到王所在的 1 区");
  // 全灭：剩下那波援军不来了，战斗结束
  st.units.filter(u => !u.isPlayer).forEach(u => { u.dead = true; u.layers.forEach(l => { l.current = 0; }); });
  const notes = [];
  assert.equal(c.Chain.onCleared(notes), false, "战斗结束");
  assert.match(notes.join("\n"), /不会再赶来/);
});

test("攻击命令 / 处死命令的骰子随等级升档（20 级：1d12 / 1d20）", () => {
  const { c } = field(20);
  assert.equal(c.leveledSides(20, 4), 12);
  assert.equal(c.leveledSides(20, 6), 20);
  const { king } = field(20);
  assert.deepEqual(JSON.parse(JSON.stringify(king.suggest.dice)), [1, 12]);
});
