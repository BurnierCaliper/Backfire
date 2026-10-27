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

test("第 13 条：自焚扣坚毅向下取整，游戏版不起身弹字", () => {
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

test("第 13 条：自焚扣血量层也向下取整", () => {
  const { c, hero } = gameField();
  hero.upOnShp = false;
  hero.self = "burn";
  hero.selfBurnStacks = 3;
  const before = c.totalHp(hero);
  c.tickSelfBurn(hero, false);
  const after = c.totalHp(hero);
  assert.equal(Number.isInteger(after), true);
  assert.equal(before - after, Math.floor(Math.min(c.totalMaxHp(hero) * 0.1 * 3, before - 1)));
});

test("第 14 条：训练场挂 training-battle、openBackstage 直接返回；源码藏 #g-bs", () => {
  const gameJs = fs.readFileSync(path.join(__dirname, "..", "game.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "game.css"), "utf8");
  assert.match(gameJs, /training-battle/);
  assert.match(gameJs, /if \(trainingActive\(\)\) return;/);
  assert.match(css, /body\.training-battle[\s\S]*#g-bs/);
  assert.match(css, /#g-party-backstage/);
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
