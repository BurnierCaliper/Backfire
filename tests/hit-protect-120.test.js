// issue #120：猛击反震要过屹立不倒 / 坚挺 / 决不后退 / 背水一战；决不后退发动后不算被击破
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function setup(party) {
  const c = H.load();
  c.BattleSim.setup({ party, enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "P120" });
  c.startCombat();
  const S = c.S.state;
  const foe = S.units.find(u => !u.isPlayer);
  S.units.filter(u => u.isPlayer).forEach(h => { h.zone = 1; h.level = 11; h.ap = 3; h.bonus = 2; });
  foe.zone = 1;
  return { c, S, foe, K: k => c.findKit(k, S.units) };
}

/** 造一个只带击破的结算结果，直接交给 applyResultToUnit */
function res(c, t, o) {
  return Object.assign({
    ok: true, layersAfter: JSON.parse(JSON.stringify(t.layers)), breakDealt: 0, total: 0, shpDealt: 0,
    broke: false, knockdownHp: 0, selfBreak: 0, element: "physical"
  }, o);
}

test("猛击反震：屹立不倒挡掉；坚挺保留 1 架势", () => {
  const { c, foe, K } = setup(["hiaki"]);
  const h = K("hiaki");
  h.def = h.defMax = 3;
  h.resources.standTurn = true;
  c.applyResultToUnit(foe, res(c, foe, { selfBreak: 2 }), h);
  assert.equal(h.def, 3, "屹立不倒：反震不掉架势");
  h.resources.standTurn = false;
  h.statuses = Object.assign({}, h.statuses, { sturdy: true });
  c.applyResultToUnit(foe, res(c, foe, { selfBreak: 5 }), h);
  assert.equal(h.def, 1, "坚挺：架势不低于 1");
  assert.equal(h.stunned, false);
});

test("猛击反震：决不后退把反震也挡下（附赠动作 +2 架势，不失衡）", () => {
  const { c, foe, K } = setup(["hiaki"]);
  const h = K("hiaki");
  h.feats = ["unbowed"];
  h.def = 1; h.defMax = 5;
  c.applyResultToUnit(foe, res(c, foe, { selfBreak: 1 }), h);
  assert.equal(h.stunned, false, "没有失衡");
  assert.ok(h.def >= 1);
  assert.equal(h.bonus, 1, "花了一个附赠动作");
});

test("猛击反震：背水一战起身期间夏不失去架势", () => {
  const { c, foe, K } = setup(["xia"]);
  const x = K("xia");
  x.def = x.defMax = 2;
  x.upOnShp = true;
  c.applyResultToUnit(foe, res(c, foe, { selfBreak: 2 }), x);
  assert.equal(x.def, 2);
  assert.equal(x.stunned, false);
});

test("决不后退发动后不算被击破：飞行目标不被击落、不吃击落真伤，机甲不解除", () => {
  const { c, S, K } = setup(["hiaki", "tou"]);
  const h = K("hiaki");
  h.feats = ["unbowed"];
  h.def = 1; h.defMax = 5;
  h.flying = true;
  const hp0 = h.layers.reduce((s, l) => s + l.current, 0);
  const r = res(c, h, { breakDealt: 1, broke: true, knockdownHp: 20 });
  c.applyResultToUnit(h, r, null);
  assert.equal(h.stunned, false);
  assert.equal(h.flying, true, "没有被击落");
  assert.equal(h.layers.reduce((s, l) => s + l.current, 0), hp0, "没有击落真伤");
  assert.equal(r.broke, false, "结果不再标记被击破");
  assert.equal(r.knockdownHp, 0);
});

test("没有决不后退时照旧：被击破的飞行目标击落、吃真伤", () => {
  const { c, K } = setup(["hiaki"]);
  const h = K("hiaki");
  h.def = h.defMax = 1;
  h.flying = true;
  const hp0 = h.layers.reduce((s, l) => s + l.current, 0);
  c.applyResultToUnit(h, res(c, h, { breakDealt: 1, broke: true, knockdownHp: 5 }), null);
  assert.equal(h.stunned, true);
  assert.equal(h.flying, false);
  assert.equal(h.layers.reduce((s, l) => s + l.current, 0), hp0 - 5);
});
