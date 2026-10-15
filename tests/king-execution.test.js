// 亡命之王强化：公开处刑（死刑机制，手下各补一刀）、召集狂徒、攻击 / 处死命令的骰子随等级升档（engine.js · KING_CFG）
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

test("召集狂徒：手下不到 2 个时每 2 回合在王身边补一个，最多 3 个；被挟持时不召集", () => {
  const { c, st, king, boss, knife, hammer, kill } = field();
  kill(knife); kill(hammer); kill(boss);
  const crew = () => st.units.filter(u => !u.dead && !u.hidden && /^(thug_|bandit_boss)/.test(u.kit)).length;
  const notes = [];
  c.kingRally(king, notes);
  assert.equal(crew(), 1);
  assert.match(notes.join("\n"), /召集狂徒/);
  c.kingRally(king, notes);
  assert.equal(crew(), 1, "同一回合不再召集");
  st.turnNo += 1; c.kingRally(king, notes);
  assert.equal(crew(), 1, "隔一回合才召集");
  st.turnNo += 1; c.kingRally(king, notes);
  assert.equal(crew(), 2);
  st.turnNo += 2; c.kingRally(king, notes);
  assert.equal(crew(), 2, "手下够 2 个就不再召集");
  const added = st.units.filter(u => /^thug_/.test(u.kit) && !u.dead);
  assert.deepEqual(JSON.parse(JSON.stringify(added.map(u => u.kit))).sort(), ["thug_hammer", "thug_knife"], "匕首 / 锤轮流");
  assert.ok(added.every(u => u.zone === king.zone && u.level === king.level));
  kill(added[0]);
  king.resources.hostage = true;
  st.turnNo += 2; c.kingRally(king, notes);
  assert.equal(crew(), 1, "被挟持时不召集");
});

test("攻击命令 / 处死命令的骰子随等级升档（20 级：1d12 / 1d20）", () => {
  const { c } = field(20);
  assert.equal(c.leveledSides(20, 4), 12);
  assert.equal(c.leveledSides(20, 6), 20);
  const { king } = field(20);
  assert.deepEqual(JSON.parse(JSON.stringify(king.suggest.dice)), [1, 12]);
});
