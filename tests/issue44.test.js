// issue #44 已定未实现的修正：格挡燃油、磁场护盾推人、协助攻击不能穿墙、电站超频、嘲讽下的选区攻击
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(party, enemies, wlv) {
  const c = H.load();
  c.BattleSim.setup({ party, enemies: enemies || [{ id: "thug_hammer", lv: 1, zone: 1 }], seed: "I44" });
  const st = c.S.state;
  st.units.filter(u => u.isPlayer && u.linkedKits).forEach(u => u.linkedKits.forEach(k => { u.weaponLevels[k] = wlv == null ? 10 : wlv; }));
  c.startCombat();
  return { c, st, K: k => c.findKit(k, st.units), foe: st.units.find(u => !u.isPlayer) };
}
const big = u => { u.layers.forEach(l => { l.current = l.max = 500; }); };
const hit = flat => ({ atk: 0, mult: 0, flat, element: "physical", baseBreak: 0, flags: { action: true, blockResolved: false } });

/* ---------- 1. 夕夏 / 柏妮尔：协助格挡燃油 ---------- */
for (const engine of [true, false]) {
  test(`#44 夕夏协助格挡成功 +1 燃油，引擎${engine ? "开着时格挡反打的火焰不耗燃油" : "没开也给"}`, () => {
    const { c, st, K, foe } = field(["xia", "kolt"]);
    const xia = K("xia"), kolt = K("kolt");
    [xia, kolt, foe].forEach(big);
    st.units.forEach(u => { u.zone = 1; });
    xia.resources.engine = engine; xia.resources.fuel = 3; xia.bonus = 1;
    st.combatPhase = "enemy";
    c.dealTo(foe, kolt, hit(8));
    c.finishBlock(xia.id, { roll: 1, ok: true, chance: 60 });
    assert.equal(xia.resources.fuel, 4);
  });
}

test("#44 柏妮尔协助格挡成功 +1 燃油（引擎没开也给）", () => {
  const { c, st, K, foe } = field(["xia", "kolt"]);
  const xia = K("xia"), kolt = K("kolt");
  xia.ap = 3; xia.bonus = 3;
  c.dispatch({ type: "skill", actor: xia.id, skill: "xia_summon", target: null, picks: {} });
  const ber = st.units.find(u => u.kit === "berniel" && !u.hidden);
  assert.ok(ber, "柏妮尔在场");
  [xia, kolt, ber, foe].forEach(big);
  st.units.forEach(u => { u.zone = 1; });
  xia.resources.engine = false; xia.resources.fuel = 0; ber.bonus = 1;
  st.combatPhase = "enemy";
  c.dealTo(foe, kolt, hit(8));
  c.finishBlock(ber.id, { roll: 1, ok: true, chance: 60 });
  assert.equal(xia.resources.fuel, 1);
});

test("#44 没解锁燃油槽：协助格挡不给燃油", () => {
  const { c, st, K, foe } = field(["xia", "kolt"], null, 1);
  const xia = K("xia"), kolt = K("kolt");
  [xia, kolt, foe].forEach(big);
  st.units.forEach(u => { u.zone = 1; });
  xia.bonus = 1; st.combatPhase = "enemy";
  c.dealTo(foe, kolt, hit(8));
  c.finishBlock(xia.id, { roll: 1, ok: true, chance: 60 });
  assert.ok(!(xia.resources.fuel > 0));
});
