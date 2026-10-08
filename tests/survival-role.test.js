// 生存职责：缓冲的护盾不是磁场护盾；防护罩是盾牌类配置物；续命把濒死的人救回濒死前的状态
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["yuito", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "SURV" });
  c.startCombat();
  const S = c.S.state;
  const y = c.findKit("yuito", S.units);
  y.zone = 1; y.level = 15; y.roles = { primary: "生存", secondary: "生存" }; y.ap = 3; y.bonus = 2;
  const k = c.findKit("kolt", S.units); k.zone = 1;
  return { c, S, y, k };
}
const cmd = (c, o) => c.Commands.dispatch(JSON.parse(JSON.stringify(Object.assign({ type: "skill" }, o))));

test("缓冲：给的护盾不带磁场护盾（那是川川的）；川川给的照样带", () => {
  const { c, y, k } = field();
  cmd(c, { actor: y.id, skill: "role_buffer", target: k.id });
  assert.ok(k.layers.some(l => l.type === "shield" && l.current > 0));
  assert.ok(!k.shieldFromChuan);
  assert.doesNotMatch(c.statusLine(k), /磁场护盾/);
  c.addShieldLayer(k, 5);
  assert.ok(k.shieldFromChuan, "默认（川川 / 哔哩哩）照样带");
});

test("防护罩：盾牌类配置物，同区我方挨的攻击由罩承受", () => {
  const { c, S, y, k } = field();
  cmd(c, { actor: y.id, skill: "role_dome" });
  const d = S.props.find(p => p.kind === "dome");
  assert.ok(d && d.faction === "player" && d.layerType === "shield");
  const f = S.units.find(u => !u.isPlayer);
  const hp0 = c.totalHp(k), d0 = d.hp;
  c.dealTo(f, k, { element: "physical", mult: 1, baseBreak: 1, atk: 5, flags: { action: true } });
  assert.equal(c.totalHp(k), hp0);
  assert.ok(d.hp < d0);
});

test("续命：濒死的人救回濒死前的状态（不靠坚毅生命、力竭也行），恢复 25%；之后受伤照常打血量", () => {
  const { c, S, y, k } = field();
  k.layers.forEach(l => { l.current = 0; });
  k.dying = true;
  S.exhaustTier = 1;   // 力竭：不能用坚毅生命起身，续命照样救
  const shp0 = k.shp;
  cmd(c, { actor: y.id, skill: "role_renew", target: k.id });
  assert.equal(k.dying, false);
  assert.equal(k.upOnShp, false, "不是靠坚毅生命起身");
  assert.equal(c.totalHp(k), Math.floor(c.baseMaxHp(k) * 0.25));
  assert.equal(k.shp, shp0);
  const f = S.units.find(u => !u.isPlayer);
  const hp1 = c.totalHp(k);
  c.dealTo(f, k, { element: "physical", mult: 0, flat: 2, baseBreak: 0, atk: 0, flags: { action: true, blockResolved: true } });
  assert.ok(c.totalHp(k) < hp1, "受伤打血量层");
  assert.equal(k.shp, shp0, "不扣坚毅生命");
});
