// 牵挂（#44 bug）：结人、拿铁给被牵挂的人治疗时，所有治疗骰都取最大值（以前只有冰美式）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));

function setup() {
  const c = H.load();
  c.BattleSim.setup({ party: ["yuito", "ruby"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "BOND" });
  c.startCombat();
  const S = c.S.state;
  S.units.filter(u => u.isPlayer).forEach(h => { h.zone = 1; h.level = 11; h.ap = 5; h.bonus = 3; });
  const y = c.findKit("yuito", S.units), r = c.findKit("ruby", S.units);
  r.layers = [{ type: "flesh", current: 1, max: 999, inner: true }];   // 缺很多血：治疗量全部看得到
  y.resources.liquid = 9;
  return { c, S, y, r, hp: u => c.totalHp(u) };
}

test("双重奏：被牵挂的人治疗 等级×6（取最大值）", () => {
  const { c, y, r, hp } = setup();
  y.resources.bondId = r.id;
  const h0 = hp(r);
  cmd(c, { actor: y.id, skill: "yuito_duet", picks: { target: r.id } });
  assert.equal(hp(r) - h0, 11 * 6);
});

test("酸萃：区里被牵挂的人治疗骰取最大值", () => {
  const { c, y, r, hp } = setup();
  y.resources.bondId = r.id;
  const nd = c.addedDiceByLevel(11);
  const h0 = hp(r);
  cmd(c, { actor: y.id, skill: "yuito_extract", picks: { dest: 1 } });
  assert.equal(hp(r) - h0, nd * 4);
});

test("爱意（拿铁）：施加之前就被牵挂的人，治疗骰取最大值", () => {
  const { c, S, y, r, hp } = setup();
  cmd(c, { actor: y.id, skill: "yuito_summon" });
  const l = c.findKit("latte", S.units);
  l.zone = 1; l.ap = 3; l.bonus = 2; l.level = 11;
  y.resources.bondId = r.id;
  const sides = c.leveledSides(l.level, 4);
  const h0 = hp(r);
  cmd(c, { actor: l.id, skill: "latte_love", target: r.id });
  assert.equal(hp(r) - h0, 2 * sides);
});

test("没被牵挂的人照常掷骰（不会每次都是最大值）", () => {
  let maxed = 0;
  for (let i = 0; i < 12; i++) {
    const { c, y, r, hp } = setup();
    const h0 = hp(r);
    cmd(c, { actor: y.id, skill: "yuito_duet", picks: { target: r.id } });
    const got = hp(r) - h0;
    assert.ok(got >= 11 && got <= 66);
    if (got === 66) maxed++;
  }
  assert.ok(maxed < 12);
});
