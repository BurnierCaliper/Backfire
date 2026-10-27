// issue #340 第 12–14 条：玩家不能看到某人「当前剩余」坚毅生命
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");

function gameField() {
  const c = H.load();
  c.GAME_MODE = true;
  c.BattleSim.setup({ party: ["ruby"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "SHP-340" });
  const hero = c.S.state.units.find(u => u.isPlayer && !u.weaponOf);
  return { c, hero };
}

function allLogText(c) {
  return (c.S.state.logPages || []).flatMap(p => p.lines || []).map(l => (typeof l === "string" ? l : (l && l.text) || "")).join("\n");
}

test("第 12 条：起身中高能自爆 / 微光蓄能日志不写坚毅剩余数字", () => {
  const { c, hero } = gameField();
  assert.equal(c.shpHidden(), true);
  hero.layers.forEach(l => { l.current = 0; });
  hero.dying = false;
  hero.upOnShp = true;
  hero.shp = 37;
  hero.shpMax = 53;
  hero.highEnergy = 50;
  hero.self = "store";
  c.S.state.weather = "glow";
  c.explodeHigh(hero, 50);
  const boomLog = allLogText(c);
  assert.match(boomLog, /高能自爆/);
  assert.doesNotMatch(boomLog, /\b37\b/, "自爆日志不能写坚毅剩余 37：" + boomLog);
  assert.match(boomLog, /当前坚毅生命/);

  const { c: c2, hero: h2 } = gameField();
  h2.layers.forEach(l => { l.current = 0; });
  h2.upOnShp = true;
  h2.shp = 37;
  h2.shpMax = 53;
  h2.highEnergy = 50;
  h2.self = "store";
  h2._glowStoreOver = 0;
  c2.S.state.weather = "glow";
  const notes = [];
  c2.glowStoreTurnEnd(notes);
  const text = notes.join("\n");
  assert.match(text, /微光 · 蓄能/);
  assert.doesNotMatch(text, /\b37\b/, "蓄能日志不能写坚毅剩余：" + text);
  assert.match(text, /当前坚毅生命/);
});

test("第 13 条：自焚扣坚毅向下取整，游戏版起身中不弹伤害数字", () => {
  const { c, hero } = gameField();
  hero.layers.forEach(l => { l.current = 0; });
  hero.upOnShp = true;
  hero.shp = 37;
  hero.shpMax = 53;
  hero.self = "burn";
  hero.selfBurnStacks = 5;
  vm.runInContext("globalThis.__floats = []; const _sf = spawnFloater; spawnFloater = function(u, loss, ele){ __floats.push({loss, ele}); if (_sf) _sf(u, loss, ele); };", c);
  const notes = c.tickSelfBurn(hero, false);
  const lost = 37 - hero.shp;
  assert.equal(Number.isInteger(hero.shp), true, "坚毅必须是整数，现在是 " + hero.shp);
  assert.equal(Number.isInteger(lost), true);
  // 53 * 0.1 * 5 = 26.5 → floor 26，且不超过 37-1=36
  assert.equal(lost, 26);
  assert.match(notes.join("\n"), /灼烧着坚毅生命/);
  const floats2 = vm.runInContext("__floats", c);
  assert.equal(floats2.length, 0, "游戏版起身中自焚不弹数字：" + JSON.stringify(floats2));
});

test("第 13 条：自焚扣血量层，日志写的扣量和实际扣的一致（整数）", () => {
  // 血量层实际扣的本来就是整数（applyTrueDamage 会取整），以前只是日志写成「失去 3.6」这类小数
  const { c, hero } = gameField();
  hero.upOnShp = false;
  hero.self = "burn";
  hero.selfBurnStacks = 3;
  const before = c.totalHp(hero);
  const raw = Math.min(c.totalMaxHp(hero) * 0.1 * 3, before - 1);
  assert.equal(Number.isInteger(raw), false, "这条要拿会算出小数的情况测：" + raw);
  const notes = c.tickSelfBurn(hero, false).join("\n");
  const lost = before - c.totalHp(hero);
  assert.equal(lost, Math.floor(raw));
  assert.match(notes, new RegExp("失去 " + lost + "（"), "日志写实际扣的整数：" + notes);
  assert.doesNotMatch(notes, /失去 \d+\.\d/, "日志不能写小数：" + notes);
});

test("第 12 条：起身中带临时护盾时，自爆 / 蓄能比的是护盾，日志照写护盾数字、不写「坚毅」", () => {
  const { c, hero } = gameField();
  hero.layers.forEach(l => { l.current = 0; });
  hero.upOnShp = true;
  hero.shp = 37;
  hero.shpMax = 53;
  c.addTempShield(hero, 6);
  assert.equal(c.currentLifeForHigh(hero), 6, "判定拿护盾 6 比（规则没动）");
  hero.highEnergy = 20;
  hero.self = "store";
  hero._glowStoreOver = 0;
  c.S.state.weather = "glow";
  const notes = [];
  c.glowStoreTurnEnd(notes);
  const text = notes.join("\n");
  assert.match(text, /超过血量 6/, "蓄能日志写的是实际比的护盾：" + text);
  assert.doesNotMatch(text, /坚毅/);
  assert.doesNotMatch(text, /\b37\b/);

  const { c: c2, hero: h2 } = gameField();
  h2.layers.forEach(l => { l.current = 0; });
  h2.upOnShp = true;
  h2.shp = 37;
  h2.shpMax = 53;
  c2.addTempShield(h2, 6);
  h2.highEnergy = 20;
  c2.explodeHigh(h2, 20);
  const boomLog = allLogText(c2);
  assert.match(boomLog, /当前生命 6/, "自爆日志写的是实际比的护盾：" + boomLog);
  assert.doesNotMatch(boomLog, /当前坚毅生命/);
  assert.doesNotMatch(boomLog, /\b37\b/);
});

// 真正进训练场看后台按钮藏没藏的浏览器测试在 tests/ui.test.js（需要 Playwright）；这里只做不开浏览器也能跑的源码守卫
test("第 14 条（源码守卫）：训练场挂 training-battle、openBackstage 直接返回、CSS 藏 #g-bs / #g-party-backstage", () => {
  const gameJs = fs.readFileSync(path.join(__dirname, "..", "game.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "game.css"), "utf8");
  assert.match(gameJs, /training-battle/);
  assert.match(gameJs, /if \(trainingActive\(\)\) return;/);
  assert.match(css, /body\.training-battle :is\([^)]*#g-bs[^)]*\)\s*\{\s*display:\s*none/);
  assert.match(css, /body\.training-battle :is\([^)]*#g-party-backstage[^)]*\)\s*\{\s*display:\s*none/);
});

test("README 规则改动记录写了 #340 第 12–14 条", () => {
  const md = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
  const sec = md.slice(md.indexOf("## 规则改动记录"));
  const end = sec.indexOf("\n## ", 5);
  const body = end > 0 ? sec.slice(0, end) : sec;
  assert.match(body, /#340 第 12/);
  assert.match(body, /第 12[、,，–\-].*14|第 12[–\-、]14/);
  assert.match(body, /自焚|向下取整/);
  assert.match(body, /训练场|后台/);
});
