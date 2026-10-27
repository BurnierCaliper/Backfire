// issue #340 第 15 条：打进坚毅生命的伤害，玩家只看到「坚毅受创」，不写任何数字
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./headless");
const OV = require("../online-view");

function gameField() {
  const c = H.load();
  c.GAME_MODE = true;
  c.BattleSim.setup({ party: ["ruby"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "SHP-15" });
  const hero = c.S.state.units.find(u => u.isPlayer && !u.weaponOf);
  const foe = c.S.state.units.find(u => !u.isPlayer);
  hero.layers.forEach(l => { l.current = 0; });
  hero.dying = false;
  hero.upOnShp = true;
  hero.shp = 40;
  hero.shpMax = 53;
  hero.zone = 1;
  foe.zone = 1;
  return { c, hero, foe, st: c.S.state };
}

function floaterTexts(c) {
  return (c.S.state.floaters || []).map(f => String(f.text || ""));
}

test("第 15 条：起身中挨打，弹字和战斗日志只有「坚毅受创」、无伤害数字", () => {
  const { c, hero, foe } = gameField();
  assert.equal(c.shpHidden(), true);
  const before = hero.shp;
  const out = c.dealTo(foe, hero, {
    atk: 0, mult: 0, flat: 7, element: "physical", baseBreak: 0, atkRange: "any",
    flags: { action: true, blockResolved: true, block: "none" }
  });
  assert.ok((out.res.shpDealt || out.res.total) > 0, "确实扣了坚毅：" + JSON.stringify(out.res));
  assert.ok(hero.shp < before, "坚毅下降");
  const floats = floaterTexts(c);
  assert.ok(floats.some(t => t === "坚毅受创"), "弹字应有坚毅受创：" + JSON.stringify(floats));
  assert.ok(floats.every(t => !/\d/.test(t)), "弹字不能带数字：" + JSON.stringify(floats));
  const lines = c.formatHitLines(foe, hero, out, []).join("\n");
  assert.match(lines, /坚毅受创/);
  assert.doesNotMatch(lines, /\d+\s*伤害/, "日志不能写「N 伤害」：" + lines);
  assert.doesNotMatch(lines, /\d/, "打进坚毅的日志不能带任何数字：" + lines);
});

test("第 15 条：起身中灼烧只写「坚毅受创」，不写实伤数字", () => {
  const { c, hero } = gameField();
  const notes = [];
  c.S.state.floaters = [];
  c.applyTypedDot(hero, 5, "fire", notes, "灼烧");
  const text = notes.join("\n");
  assert.match(text, /灼烧 → 坚毅受创/);
  assert.doesNotMatch(text, /实伤\s*\d/);
  const floats = floaterTexts(c);
  assert.ok(floats.some(t => t === "坚毅受创"), "灼烧弹字：" + JSON.stringify(floats));
  assert.ok(floats.every(t => !/\d/.test(t)), "灼烧弹字无数字：" + JSON.stringify(floats));
});

test("第 15 条：起身中自焚只弹「坚毅受创」", () => {
  const { c, hero } = gameField();
  hero.self = "burn";
  hero.selfBurnStacks = 3;
  c.S.state.floaters = [];
  c.tickSelfBurn(hero, false);
  const floats = floaterTexts(c);
  assert.ok(floats.some(t => t === "坚毅受创"), "自焚弹字：" + JSON.stringify(floats));
  assert.ok(floats.every(t => !/\d/.test(t)), "自焚弹字无数字：" + JSON.stringify(floats));
});

test("第 15 条：联机投影把起身中的伤害标成 grit、不给数字，照旧是一下伤害（演打中）", () => {
  const { hero } = gameField();
  const snap = [{ id: hero.id, name: hero.name, upOnShp: true, dying: false, dead: false, isPlayer: true }];
  const tape = OV.projectTape([
    { type: "pop", unitId: hero.id, kind: "dmg", value: 7, element: "physical", main: true, snap }
  ], { state: { units: snap } });
  assert.equal(tape.length, 1);
  assert.equal(tape[0].kind, "dmg", "照旧是伤害（打中、受击、攻击演出都认 dmg）");
  assert.equal(tape[0].grit, true);
  assert.equal(tape[0].value, undefined, "投影不能带伤害数字");
  assert.equal(tape[0].main, true, "主攻击标记还在，演出要补打击形状");
  // 普通血量上的伤害照旧给数字
  const normal = OV.projectTape([
    { type: "pop", unitId: "e1", kind: "dmg", value: 4, element: "physical",
      snap: [{ id: "e1", upOnShp: false, dying: false, dead: false }] }
  ], { state: { units: [{ id: "e1", upOnShp: false }] } });
  assert.equal(normal[0].kind, "dmg");
  assert.equal(normal[0].value, 4);
  assert.equal(normal[0].grit, undefined);
});

test("第 15 条：计算器（非游戏版）起身中仍弹数字；README 有本条且 #52 旧句已作废", () => {
  const c = H.load();
  c.GAME_MODE = false;
  c.BattleSim.setup({ party: ["ruby"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "SHP-15b" });
  const hero = c.S.state.units.find(u => u.isPlayer && !u.weaponOf);
  const foe = c.S.state.units.find(u => !u.isPlayer);
  hero.layers.forEach(l => { l.current = 0; });
  hero.upOnShp = true;
  hero.shp = 40;
  hero.shpMax = 53;
  hero.zone = 1;
  foe.zone = 1;
  assert.equal(c.shpHidden(), false);
  c.dealTo(foe, hero, {
    atk: 0, mult: 0, flat: 7, element: "physical", baseBreak: 0, atkRange: "any",
    flags: { action: true, blockResolved: true, block: "none" }
  });
  const floats = floaterTexts(c);
  assert.ok(floats.some(t => /\d/.test(t)), "计算器仍弹数字：" + JSON.stringify(floats));
  assert.ok(!floats.includes("坚毅受创"), "计算器不弹坚毅受创字：" + JSON.stringify(floats));

  const readme = fs.readFileSync(path.join(H.ROOT, "README.md"), "utf8");
  // 整节「规则改动记录」里找（不按字数截：上面别的记录再长也不会让它失败）
  const idx = readme.indexOf("## 规则改动记录");
  assert.ok(idx >= 0);
  const end = readme.indexOf("\n## ", idx + 5);
  const section = end > idx ? readme.slice(idx, end) : readme.slice(idx);
  assert.match(section, /#340 第 15 条/);
  assert.match(section, /坚毅受创/);
  assert.match(readme, /已作废[\s\S]{0,80}受伤时伤害数字照常显示|受伤时伤害数字照常显示[\s\S]{0,40}已作废/);
});
