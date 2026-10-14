// 瑞比 无人机激光（银翼·收发代理）：每一发的伤害写进战斗日志，并且排在「激光射向」之后、回合结束总结之内
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));
const allLines = S => S.logPages.flatMap(p => p.lines.map(l => l.text));

function field(overdrive) {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "DRONELOG" });
  c.startCombat();
  const S = c.S.state;
  const r = c.findKit("ruby", S.units), foe = S.units.find(u => !u.isPlayer);
  r.zone = foe.zone = 1; r.level = 11; r.ap = 3; r.bonus = 2;
  foe.layers = [{ type: "flesh", current: 500, max: 500 }];
  r.resources.nano = 100;
  const m = c.spawnWeapon(r, "mint"); m.zone = 1; m.ap = 3; m.bonus = 2; m.level = 11;
  c.enterMecha();
  if (overdrive) r.resources.overdrive = true;
  r.resources.drone = true; r.resources.nano = 100;
  return { c, S, r, foe };
}

for (const od of [false, true]) test(`无人机激光的每一发伤害都写进战斗日志（${od ? "机体强化 3 发" : "2 发"}）`, () => {
  const { c, S, foe } = field(od);
  const hp0 = foe.layers[0].current;
  const from = allLines(S).length;
  c.turnEnd();
  const L = allLines(S).slice(from);
  const dealt = hp0 - foe.layers[0].current;
  assert.ok(dealt > 0, "激光打中了");
  const fire = L.findIndex(s => /无人机激光射向/.test(s));
  const hits = L.map((s, i) => [s, i]).filter(([s]) => /→ 狂徒（匕首）：\d+ 伤害/.test(s));
  assert.ok(fire >= 0, L.join("\n"));
  assert.equal(hits.length, od ? 3 : 2, "每一发一行：\n" + L.join("\n"));
  assert.ok(hits.every(([, i]) => i > fire), "伤害行在「射向」之后");
  const sum = hits.reduce((a, [s]) => a + Number(s.match(/：(\d+) 伤害/)[1]), 0);
  assert.equal(sum, dealt, "日志里的伤害加起来等于实际掉血");
});
