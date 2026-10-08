// 属性克制的正反馈：玩家克制的一击，伤害弹字带 adv（预览写「克制」、要打掉的血条变浅金；演出时战场震一下）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./headless");

function hiakiHits(layerType) {
  const c = H.load();
  c.BattleSim.setup({ party: ["hiaki"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "ADV-FB" });
  c.startCombat();
  const k = c.findKit("hiaki", c.S.state.units); k.zone = 1;
  const f = c.S.state.units.find(u => !u.isPlayer);
  f.layers = [{ type: layerType, current: 300, max: 300 }];
  const pops = [];
  c.spawnPopup = (u, spec) => { if (spec.kind === "dmg") pops.push(spec); };
  c.Commands.dispatch({ type: "skill", actor: k.id, skill: c.skillList(k)[0].id, target: f.id });
  return pops.filter(p => p.main);
}

test("火打血肉层（克制 +50%）：弹字标 adv；火打装甲层（−25%）不标", () => {
  const adv = hiakiHits("flesh");
  assert.ok(adv.length >= 1);
  assert.equal(adv[0].element, "fire");
  assert.equal(adv[0].adv, true);
  const dis = hiakiHits("armor");
  assert.ok(dis.length >= 1);
  assert.equal(dis[0].adv, false);
  assert.equal(hiakiHits("shield")[0].adv, false, "0% 不算克制");
});

test("敌人打玩家触发克制不算（只给玩家的正反馈）", () => {
  const c = H.load();
  const src = fs.readFileSync(path.join(H.ROOT, "app.js"), "utf8");
  assert.match(src, /const advHit = !!\(res\.advantage && attacker && attacker\.isPlayer && mainHit\)/);
  assert.ok(c);
});

test("画面：预览读 adv 写「克制」、加 pv-adv（浅金血条）；演出时 advShake 震战场", () => {
  const g = fs.readFileSync(path.join(H.ROOT, "game.js"), "utf8");
  const css = fs.readFileSync(path.join(H.ROOT, "game.css"), "utf8");
  assert.match(g, /p\.adv = dmgPops\.some\(e => e\.adv\)/);
  assert.match(g, /<span class="adv">克制<\/span>/);
  assert.match(g, /classList\.add\("pv-adv"\)/);
  assert.match(g, /if \(e\.adv && !advShook\) \{ advShook = true; advShake\(\); \}/);
  assert.match(css, /\.unit-wrap\.pv-adv \.seg \.pv\.sure \{ background: #ffe39a/);
  assert.match(css, /\.g-field\.adv-shake \{ animation: advShake/);
});
