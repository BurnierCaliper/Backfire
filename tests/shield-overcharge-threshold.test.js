// 起身中高能阈值必须按坚毅，不能被临时护盾压低（fix/shield-overcharge-threshold）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./headless");

function gameField() {
  const c = H.load();
  c.GAME_MODE = true;
  c.BattleSim.setup({ party: ["ruby"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "SHIELD-OC" });
  const hero = c.S.state.units.find(u => u.isPlayer && !u.weaponOf);
  return { c, hero };
}

test("起身中带护盾：高能阈值按坚毅，高能 20 不自爆致死", () => {
  const { c, hero } = gameField();
  hero.layers.forEach(l => { l.current = 0; });
  hero.dying = false;
  hero.upOnShp = true;
  hero.shp = 37;
  hero.shpMax = 53;
  assert.equal(typeof c.addTempShield, "function");
  c.addTempShield(hero, 6);
  assert.equal(c.currentLifeForHigh(hero), 37, "必须比坚毅 37，不能比护盾 6");

  // 走 checkHighBoom（阈值判断）；直接 explodeHigh 会无条件秒杀，测不到阈值
  hero.highEnergy = 20;
  const before = hero.shp;
  c.checkHighBoom(hero);
  assert.equal(hero.dead, false, "坚毅 37、高能 20：阈值按坚毅则不爆；按护盾 6 则会爆致死");
  assert.equal(hero.upOnShp, true);
  assert.equal(hero.shp, before, "没爆就不要扣坚毅");
  assert.equal(hero.highEnergy, 20, "没爆就不要清高能");
});

test("起身中带护盾：高能超过坚毅时仍会自爆（阈值没被护盾抬高成免死）", () => {
  const { c, hero } = gameField();
  hero.layers.forEach(l => { l.current = 0; });
  hero.dying = false;
  hero.upOnShp = true;
  hero.shp = 37;
  hero.shpMax = 53;
  c.addTempShield(hero, 6);
  hero.highEnergy = 40; // 40 > 37
  c.checkHighBoom(hero);
  assert.equal(hero.dead, true, "高能超过坚毅仍应自爆致死");
});

test("README 规则改动记录写了起身中高能阈值按坚毅", () => {
  const md = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
  const sec = md.slice(md.indexOf("## 规则改动记录"));
  const end = sec.indexOf("\n## ", 5);
  const body = end > 0 ? sec.slice(0, end) : sec;
  assert.match(body, /起身中高能自爆阈值按坚毅/);
  assert.match(body, /临时护盾/);
});
