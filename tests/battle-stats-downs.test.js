// 战场数据加上倒地次数（#398）：每个我方单位这场倒地（陷入濒死）了几次，记在 state.battleStats[单位 id].downs，
// 战场数据表（game.js · STAT_COLS）多一列「倒地次数」。
// 设 dying = true 的三个地方都记：applyKnockdown（攻击、坠落、高能自爆……）、拉斯缪尔不稳态（rasUnstableHit）、
// 巨人协助捏碎颅骨（enemies.js · crushSkullDown）。力竭 3 被击倒立刻死亡、起身中坚毅生命打光死亡、武器人倒下、
// 还魂救下来的都没有陷入濒死，不记。真的打开战场数据表看这一列的在 tests/battle-stats-downs-ui.test.js。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");

/** prep：开战前改队伍（带专长之类） */
function field(opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: opt.party || ["kolt", "helu"], enemies: opt.enemies || [{ id: "thug_hammer", lv: 1, zone: 1 }], seed: "DOWNS" });
  const st = c.S.state;
  if (opt.prep) opt.prep(c, st);
  c.startCombat();
  st.units.forEach(u => { u.zone = 1; });
  // 柯尔特「过度自信」满血时少吃 1 击破：关掉，免得打不出失衡（同 tests/audit-P5-enemies.test.js）
  st.units.forEach(u => { if (u.kit === "kolt") u.prideMaxHp = Infinity; });
  return { c, st, P: k => c.findKit(k, st.units), E: k => st.units.find(u => !u.isPlayer && u.kit === k && !u.dead) };
}
const hit = (c, a, t, extra) => c.dealTo(a, t, Object.assign({ atk: 0, mult: 0, flat: 30, element: "physical", baseBreak: 0, atkRange: "any",
  flags: { action: true, blockResolved: true, block: "none" } }, extra || {}));
/** 血量只剩最内层 1 点 */
const lastHp = (c, u) => { const k = c.innermostIndex(u.layers); u.layers.forEach((l, i) => { l.current = i === k ? 1 : 0; }); };
const downs = (st, u) => (st.battleStats[u.id] || {}).downs;

test("倒地次数：被打到最内层归零、陷入濒死记一次（applyKnockdown）；已经濒死的再挨打不重复记；没倒地的人是 0", () => {
  const { c, st, P, E } = field();
  const kolt = P("kolt"), helu = P("helu"), foe = E("thug_hammer");
  assert.equal(c.battleStat(kolt).downs, 0, "开战时是 0");
  lastHp(c, kolt);
  hit(c, foe, kolt);
  assert.equal(kolt.dying, true);
  assert.equal(downs(st, kolt), 1);
  hit(c, foe, kolt);
  assert.equal(c.applyKnockdown(kolt, []), "dying");
  assert.equal(downs(st, kolt), 1, "已经濒死：不重复记");
  assert.equal(c.battleStat(helu).downs, 0);
});

test("倒地次数：拉斯缪尔不稳态受伤倒地也记（rasUnstableHit）；起身后再受伤是直接死亡，不再记", () => {
  const { c, st, P, E } = field({ party: ["ras", "kolt"] });
  const ras = P("ras"), foe = E("thug_hammer");
  ras.resources.unstable = true; ras.resources.energyPct = 110;
  hit(c, foe, ras, { flat: 1 });
  assert.equal(ras.dying, true);
  assert.equal(downs(st, ras), 1);
  c.standUp(ras);
  assert.equal(ras.upOnShp, true);
  hit(c, foe, ras, { flat: 1 });
  assert.equal(ras.dead, true);
  assert.equal(downs(st, ras), 1);
});

test("倒地次数：巨人协助「捏碎颅骨」把人捏倒也记（crushSkullDown）；起身后再被捏倒，又记一次", () => {
  const { c, st, P, E } = field({ enemies: [{ id: "giant", lv: 3, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }] });
  const k = P("kolt"), g = E("giant"), kn = E("thug_knife");
  st.combatPhase = "enemy"; k.def = 1;
  hit(c, kn, k, { atk: 1, mult: 1, flat: 0, baseBreak: 1 });
  assert.equal(st.assistQueue[0].targetId, k.id, "打出失衡，等协助攻击");
  c.finishAssist(g.id, {});
  assert.equal(k.dying, true);
  assert.equal(downs(st, k), 1);
  c.standUp(k);
  assert.equal(k.upOnShp, true);
  c.crushSkullDown(k, []);
  assert.equal(k.dying, true, "起身中被捏碎颅骨：再次倒下");
  assert.equal(downs(st, k), 2);
});

test("倒地次数：力竭 3 被击倒立刻死亡、起身中坚毅生命打光死亡、武器人倒下、还魂救下来的都没有陷入濒死，不记", () => {
  let f = field();
  f.st.exhaustTier = 3;
  const k3 = f.P("kolt");
  k3.layers.forEach(l => { l.current = 0; });
  assert.equal(f.c.applyKnockdown(k3, []), "dead");
  assert.equal(f.c.battleStat(k3).downs, 0, "力竭 3");

  f = field();
  const h = f.P("helu");
  h.layers.forEach(l => { l.current = 0; });
  assert.equal(f.c.applyKnockdown(h, []), "dying");
  f.c.standUp(h);
  h.shp = 1;
  assert.equal(f.c.applyKnockdown(h, [], { shpLoss: 5 }), "dead");
  assert.equal(downs(f.st, h), 1, "起身中坚毅生命打光是死亡，不是又倒地一次");
  const torque = f.c.spawnWeapon(f.P("kolt"), "torque");
  torque.layers.forEach(l => { l.current = 0; });
  assert.equal(f.c.applyKnockdown(torque, []), "dead");
  assert.equal(f.c.battleStat(torque).downs, 0, "武器人倒下");

  f = field({ prep: (c, st) => { c.findKit("kolt", st.units).feats = ["revive"]; } });
  const kr = f.P("kolt");
  kr.layers.forEach(l => { l.current = 0; });
  assert.equal(f.c.applyKnockdown(kr, []), null);
  assert.equal(f.c.battleStat(kr).downs, 0, "还魂：留 1 点生命，没有倒地");
  kr.resources.standTurn = false; kr.resources.reviveGuard = false;
  kr.layers.forEach(l => { l.current = 0; });
  assert.equal(f.c.applyKnockdown(kr, []), "dying");
  assert.equal(downs(f.st, kr), 1, "第二次就倒地了");
});

/** 再加上战斗画面（game.js；没有网页，只用它导出的 statRows / mergeStatRows / statsText） */
function withGame(f) {
  f.c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, "game.js"), "utf8"), f.c, { filename: "game.js" });
  return f.c.GAME;
}

test("战场数据表多一列「倒地次数」：每行是这场倒地了几次（还没有数据的人是 0），复制出来的文字也有；合并武器人时加在一起", () => {
  const f = field();
  const G = withGame(f);
  const kolt = f.P("kolt"), helu = f.P("helu");
  kolt.layers.forEach(l => { l.current = 0; });
  f.c.applyKnockdown(kolt, []);
  const rows = G.statRows();
  assert.equal(rows.find(r => r.id === kolt.id).downs, 1);
  assert.ok(!f.st.battleStats[helu.id], "Helumica 这场还没有数据");
  assert.equal(rows.find(r => r.id === helu.id).downs, 0, "没有数据的人也是 0");
  // 复制出来的文字：第 2 行是表头，下面每行一个人（和面板上的表同一份列）
  const lines = G.statsText().split("\n"), head = lines[1].split("\t");
  const col = head.indexOf("倒地次数");
  assert.ok(col > 0, "表头有「倒地次数」：" + lines[1]);
  assert.equal(head[col - 1], "承受伤害", "排在承受伤害后面");
  const cells = name => lines.find(l => l.split("\t")[0] === name).split("\t");
  assert.equal(cells(kolt.name)[col], "1");
  assert.equal(cells(helu.name)[col], "0");
  // 合并武器人：倒地次数加在一起（武器人倒下不算倒地，这里只验证合并时不丢）
  const m = G.mergeStatRows([{ id: "a", name: "龙哥", sub: false, dmg: 1, downs: 2 }, { id: "w", name: "小朋友", sub: true, dmg: 1, downs: 1 }]);
  assert.equal(m[0].downs, 3);
});
