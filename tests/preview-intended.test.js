// 伤害预览的数字写「这一下打出去的伤害」（规则层 intended，含溢出），不按目标剩下的血量封顶
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./headless");

test("伤害弹字的数值是 intended（含溢出），预览把它们加起来当预览数字", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["hiaki"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "PV-INT" });
  c.startCombat();
  const k = c.findKit("hiaki", c.S.state.units); k.zone = 1;
  const f = c.S.state.units.find(u => !u.isPlayer);
  f.layers = [{ type: "flesh", current: 4, max: 17 }];
  const pops = [];
  c.spawnPopup = (u, spec) => { if (spec.kind === "dmg") pops.push(spec.value); };
  c.Commands.dispatch({ type: "skill", actor: k.id, skill: c.skillList(k)[0].id, target: f.id });
  assert.ok(pops[0] > 4, "弹字 " + pops[0] + " 不按剩下的 4 血封顶");
  const g = fs.readFileSync(path.join(H.ROOT, "game.js"), "utf8");
  assert.match(g, /const q1 = popDmg\(lo\.tape\), q2 = popDmg\(hi\.tape\);/);
  assert.match(g, /if \(q1 > 0 \|\| q2 > 0\) \{ p\.dmgLo = Math\.min\(q1, q2\); p\.dmgHi = Math\.max\(q1, q2\); \}/);
});
