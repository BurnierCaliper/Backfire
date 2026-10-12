// 破釜沉舟：玩家唤出的武器人跟着持有者（攻击双倍、受伤翻倍）；EDC 爆闪是电击伤害
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function field(party, ownerKit, summon) {
  const c = H.load();
  c.BattleSim.setup({ party, enemies: [{ id: "thug_hammer", lv: 1, zone: 1 }], seed: "GBW" });
  c.startCombat();
  const S = c.S.state;
  const o = S.units.find(u => u.kit === ownerKit), f = S.units.find(u => !u.isPlayer);
  o.zone = 1; f.zone = 1; o.ap = 3; o.bonus = 3;
  c.Commands.dispatch(plain({ type: "skill", actor: o.id, skill: summon }));
  const w = S.units.find(u => u.weaponOf === ownerKit && !u.hidden && !u.dead);
  assert.ok(w, "武器人唤出了");
  w.zone = 1;
  f.layers = [{ type: "flesh", current: 999, max: 999 }];
  return { c, S, o, w, f };
}
const poke = (c, a, t) => {
  const before = c.totalHp(t);
  c.dealTo(a, t, { atk: 10, mult: 1, flat: 0, diceValue: 0, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true } });
  return before - c.totalHp(t);
};

test("破釜沉舟：持有者攻击双倍的回合，唤出的武器人攻击也双倍", () => {
  const { c, o, w, f } = field(["kolt", "yuito"], "kolt", "kolt_summon");
  const base = poke(c, w, f);
  o.resources.gambitStrike = true;
  assert.equal(poke(c, w, f), base * 2);
});

test("破釜沉舟：持有者受伤翻倍期间，唤出的武器人受伤也翻倍", () => {
  const { c, o, w, f } = field(["kolt", "yuito"], "kolt", "kolt_summon");
  w.layers = [{ type: "flesh", current: 999, max: 999 }];
  const base = poke(c, f, w);
  o.resources.gambitWound = true;
  assert.equal(poke(c, f, w), base * 2);
});

test("技能说明：破釜沉舟写明武器人同样生效；爆闪写成电击伤害", () => {
  const c = H.load();
  assert.match(c.SkillText.skillText ? String(c.SkillText.skillText("role_gambit")) : JSON.stringify(c.SkillText), /武器人同样生效/);
  assert.match(JSON.stringify(c.SkillText), /「光能\/2」的电击伤害/);
});

test("EDC 爆闪：对同区敌人造成电击伤害", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ras", "kolt"], enemies: [{ id: "thug_hammer", lv: 1, zone: 1 }], seed: "EDCF" });
  c.startCombat();
  const S = c.S.state;
  const ras = S.units.find(u => u.kit === "ras"), f = S.units.find(u => !u.isPlayer);
  ras.zone = 1; f.zone = 1; ras.ap = 3; ras.bonus = 3;
  c.Commands.dispatch(plain({ type: "skill", actor: ras.id, skill: "ras_summon" }));
  const edc = S.units.find(u => u.weaponOf === "ras" && !u.hidden && !u.dead);
  edc.zone = 1; edc.ap = 3; edc.bonus = 3; edc.level = 10;
  ras.resources.light = 40;
  f.layers = [{ type: "flesh", current: 999, max: 999 }];
  const els = [];
  const orig = c.dealTo;
  c.dealTo = (a, t, opt) => { if (t && t.id === f.id) els.push(opt.element); return orig(a, t, opt); };
  S.attackerId = edc.id; S.targetId = f.id;
  c.runSkill("edc_flash");
  assert.ok(els.length > 0, "打到了敌人");
  assert.ok(els.every(e => e === "electric"), "电击：" + els.join(","));
  assert.equal(ras.resources.light, 0);
});
