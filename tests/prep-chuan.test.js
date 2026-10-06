// 准备只加在第一击；川川协助攻击重斩看发动时的电能；电站超频可选敌人；巨刃划空 1 距离以内
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(party, foeZone) {
  const c = H.load();
  c.BattleSim.setup({ party, enemies: [{ id: "bandit_boss", lv: 1, zone: foeZone || 1 }], seed: "PC" });
  c.startCombat();
  const st = c.S.state;
  const foe = st.units.find(u => !u.isPlayer);
  foe.layers = [{ type: "flesh", current: 999, max: 999, inner: true }];
  st.units.filter(u => u.isPlayer).forEach(u => { u.zone = 1; u.ap = 3; u.bonus = 3; });
  return { c, st, foe };
}

test("准备：骰子按等级升级（1d6 / 1d8 / 1d10 / 1d12）", () => {
  const c = H.load();
  assert.equal([1, 5, 10, 15].map(lv => c.prepDieSides({ level: lv })).join(","), "6,8,10,12");
});

test("准备：拉斯缪尔普攻一次结算打两段，准备只进第一段", () => {
  const { c, foe } = field(["ras", "kolt"], 2);
  const ras = c.findKit("ras", c.S.state.units);
  ras.zone = 1;
  ras.resources.preparedActive = true;
  const out = c.dealTo(ras, foe, { atk: 10, mult: 0.5, hits: 2, baseHits: 2, element: "energy", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true } });
  const hits = out.res.perHit.map(h => h.dealt);
  assert.equal(hits.length, 2);
  assert.ok(hits[0] > hits[1], `第一段多了准备：${hits.join(",")}`);
  assert.equal(ras.resources.preparedActive, false);
});

test("准备生效的文字写对骰子（不再是 Nd6）", () => {
  const src = require("fs").readFileSync(require("path").join(H.ROOT, "app.js"), "utf8");
  assert.doesNotMatch(src, /\+\$\{n\}d6/);
  assert.match(src, /1d\$\{prepDieSides\(/);
});

test("电站超频：可以选敌人（也能选自己和友方）", () => {
  const src = require("fs").readFileSync(require("path").join(H.ROOT, "engine.js"), "utf8");
  assert.match(src, /chuan_over: "anySelf"/);
  const { c: c2, st, foe } = field(["chuan", "kolt"]);
  const chuan = c2.findKit("chuan", st.units);
  st.attackerId = chuan.id; st.targetId = foe.id;
  c2.runSkill("chuan_over");
  assert.ok(foe.instant && foe.instant.overload, "敌人被施加过载");
});

test("巨刃划空：1 距离以内的敌人都能选", () => {
  const { c, st, foe } = field(["chuan", "kolt"], 2);
  const chuan = c.findKit("chuan", st.units);
  chuan.level = 11; chuan.resources.charge = 3;
  st.props = [c.makeProp("boom", 2, 1)];
  const steps = c.skillFlowSteps("chuan_blade", chuan, {});
  assert.ok(steps[0].units.some(u => u.id === foe.id), "隔一区的敌人可选");
  assert.equal(JSON.stringify(c.skillRangeFor(chuan, "chuan_blade")), JSON.stringify({ min: 0, max: 1 }));
});

test("评价：分数线下调 250，新增 SS / SSS（经验倍率同 S）", () => {
  const c = H.load();
  const lines = c.gradeLines(1).map(x => x[0] + x[1] + "x" + x[2]).join(" ");
  assert.equal(lines, "SSS2000x2 SS1750x2 S1500x2 A1250x1.5 B1000x1.2 C500x1 D0x1");
});

test("跑团：从战斗回到探索，先切画面再布置下一场（不弹开战大字）", () => {
  const src = require("fs").readFileSync(require("path").join(H.ROOT, "trpg-ui.js"), "utf8");
  const i = src.indexOf("function backFromBattle");
  const body = src.slice(i, src.indexOf("}", src.indexOf("render();", i)));
  assert.ok(body.indexOf('Screens.show("trpg")') < body.indexOf("rebuild()"));
});
