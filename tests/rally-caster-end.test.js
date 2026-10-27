// 全队集结：施放者晕眩 / 濒死时全体增益结束（主人确认：看施放者）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

const plain = x => JSON.parse(JSON.stringify(x));
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));
const kit = (S, k) => S.units.find(u => u.kit === k);

function field() {
  const c = H.load();
  // 结人（辅助·全队集结）+ Helumica（改成直伤拿 +15）
  c.BattleSim.setup({ party: ["yuito", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 1 }], seed: "RALLY-END" });
  c.startCombat();
  const S = c.S.state;
  const y = kit(S, "yuito");
  const h = kit(S, "helu");
  y.zone = 1; h.zone = 1;
  y.roles = { primary: "辅助", secondary: "辅助" };
  y.level = 15;
  c.resetBattleFlags(y);
  y.ap = 3; y.bonus = 3;
  h.roles = Object.assign({}, h.roles, { primary: "直伤" });
  return { c, S, y, h };
}

function castRally(c, y) {
  cmd(c, { actor: y.id, skill: "role_rally" });
  assert.ok(y.resources && y.resources.rallyOn, "施放者挂了 rallyOn");
}

test("全队集结：施放者晕眩 → 全体直伤 +15 结束（队员自己没晕）", () => {
  const { c, y, h } = field();
  const before = c.effectiveAtk(h, c.S.state.units);
  castRally(c, y);
  assert.equal(c.effectiveAtk(h, c.S.state.units), before + 15);
  assert.equal(h.rallyAtk, 15);
  // 施放者被打进失衡（真实 dealBreak）
  const notes = [];
  c.dealBreak(y, 99, "physical", notes, "测试");
  assert.equal(!!y.stunned, true);
  assert.equal(!!y.resources.rallyOn, false);
  assert.equal(h.rallyAtk || 0, 0);
  assert.equal(c.effectiveAtk(h, c.S.state.units), before);
  assert.ok(notes.some(s => /全队集结结束：施放者晕眩/.test(s)), notes.join("\n"));
});

test("全队集结：队员自己晕眩 → 加成还在（不是看每个拿到的人）", () => {
  const { c, y, h } = field();
  const before = c.effectiveAtk(h, c.S.state.units);
  castRally(c, y);
  assert.equal(c.effectiveAtk(h, c.S.state.units), before + 15);
  const notes = [];
  c.dealBreak(h, 99, "physical", notes, "测试");
  assert.equal(!!h.stunned, true);
  assert.ok(y.resources.rallyOn, "施放者还在场上，rallyOn 还在");
  assert.equal(h.rallyAtk, 15, "队员自己晕眩不丢集结");
  assert.equal(c.effectiveAtk(h, c.S.state.units), before + 15);
  assert.ok(!notes.some(s => /全队集结结束/.test(s)), notes.join("\n"));
});

test("全队集结：施放者濒死 → 全体加成结束", () => {
  const { c, y, h } = field();
  const before = c.effectiveAtk(h, c.S.state.units);
  castRally(c, y);
  assert.equal(c.effectiveAtk(h, c.S.state.units), before + 15);
  // 打空最内层 → applyKnockdown → dying
  (y.layers || []).forEach(l => { l.current = 0; });
  const notes = [];
  const out = c.applyKnockdown(y, notes);
  assert.equal(out, "dying");
  assert.equal(!!y.dying, true);
  assert.equal(!!y.resources.rallyOn, false);
  assert.equal(h.rallyAtk || 0, 0);
  assert.equal(c.effectiveAtk(h, c.S.state.units), before);
  assert.ok(notes.some(s => /全队集结结束：施放者濒死/.test(s)), notes.join("\n"));
});
