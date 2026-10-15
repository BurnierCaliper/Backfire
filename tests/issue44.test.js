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

/* ---------- 2. 磁场护盾：走 displaceTo，优先推进危险区域，不穿危墙 / 关着的机关门 ---------- */
function magnetField() {
  const r = field(["chuan", "kolt"], [{ id: "thug_hammer", lv: 1, zone: 2 }]);
  const { c, st, K, foe } = r;
  [K("chuan"), K("kolt"), foe].forEach(big);
  st.zoneMode = 3;   // 1-2-3 直排，2 区两边都有相邻区
  st.units.forEach(u => { u.zone = 2; });
  const kolt = K("kolt");
  r.fire = () => { kolt.shieldFromChuan = true; return c.triggerMagnetShield(kolt); };
  return r;
}
test("#44 磁场护盾：1-2 是危墙时不穿墙，推向 3 区", () => {
  const { c, st, foe, fire } = magnetField();
  assert.equal(JSON.stringify(c.zoneNeighbors(2).map(Number).sort()), "[1,3]");
  st.gaps["1-2"] = { type: "wall", hp: 10, maxHp: 10 };
  fire();
  assert.equal(Number(foe.zone), 3);
});
test("#44 磁场护盾：两边都被墙 / 关着的门挡住时不推，但 1 击破照给", () => {
  const { st, foe, fire } = magnetField();
  st.gaps["1-2"] = { type: "wall", hp: 10, maxHp: 10 };
  st.gaps["2-3"] = { type: "door", open: false };
  const p0 = foe.posture;
  const notes = fire();
  assert.equal(Number(foe.zone), 2);
  assert.ok(notes.some(t => /击破/.test(t)), notes.join("\n"));
  if (typeof p0 === "number") assert.ok(foe.posture < p0 || foe.stunned);
});
test("#44 磁场护盾：优先推进危险区域（3 区酸液，1 区普通）", () => {
  const { st, foe, fire } = magnetField();
  st.fields[3].acid = true;
  fire();
  assert.equal(Number(foe.zone), 3);
});
test("#44 磁场护盾：隔着空隙的相邻区算危险区域，推过去由 displaceTo 结算坠落", () => {
  const { c, st, foe, fire } = magnetField();
  st.gaps["2-3"] = { type: "void" };
  const hp0 = c.totalHp(foe);
  const notes = fire();
  assert.ok(notes.some(t => /空隙/.test(t)), notes.join("\n"));
  assert.ok(c.totalHp(foe) < hp0, "坠落掉血");
});
test("#44 磁场护盾：免位移（noMove）的敌人推不动", () => {
  const { foe, fire } = magnetField();
  foe.noMove = true;
  fire();
  assert.equal(Number(foe.zone), 2);
});

/* ---------- 3. 协助攻击不能穿墙 ---------- */
function assistField() {
  const r = field(["ruby", "hiaki", "kolt"], [{ id: "thug_hammer", lv: 1, zone: 2 }]);
  const { st, K, foe } = r;
  st.zoneMode = 3;
  [K("ruby"), K("hiaki"), K("kolt"), foe].forEach(big);
  K("kolt").zone = 2; K("ruby").zone = 1; K("hiaki").zone = 3; foe.zone = 2;
  return r;
}
test("#44 协助攻击：被危墙隔开的远程 / 近战角色都不能选为协助者", () => {
  const { c, st, K, foe } = assistField();
  const ids = () => c.eligibleAssisters(K("kolt"), foe).map(u => u.kit).sort().join(",");
  assert.equal(ids(), "hiaki,ruby", "没有墙时都能协助");
  st.gaps["1-2"] = { type: "wall", hp: 10, maxHp: 10 };
  st.gaps["2-3"] = { type: "door", open: false };
  assert.equal(ids(), "", "危墙 / 关着的机关门隔开：都不能协助");
  st.gaps["2-3"].open = true;
  assert.equal(ids(), "hiaki", "门打开后恢复");
});
test("#44 协助攻击：敌人协助同样受墙限制", () => {
  const c0 = field(["ruby", "kolt"], [{ id: "thug_hammer", lv: 1, zone: 2 }, { id: "thug_knife", lv: 1, zone: 1 }]);
  const { c, st, K } = c0;
  st.zoneMode = 3;
  const [a, b] = st.units.filter(u => !u.isPlayer);
  a.zone = 2; b.zone = 1; K("ruby").zone = 2;
  assert.ok(c.eligibleAssisters(a, K("ruby")).some(u => u.id === b.id));
  st.gaps["1-2"] = { type: "wall", hp: 10, maxHp: 10 };
  assert.ok(!c.eligibleAssisters(a, K("ruby")).some(u => u.id === b.id));
});

/* ---------- 4. 电站超频：电能 <3 时 +2，≥3 时照旧给 atk/2 护盾 ---------- */
for (const [ch, want, shield] of [[0, 2, false], [2, 4, false], [3, 3, true]]) {
  test(`#44 电站超频：电能 ${ch} → ${want}${shield ? "，并给护盾" : ""}`, () => {
    const { c, st, K } = field(["chuan", "kolt"]);
    const chuan = K("chuan"), kolt = K("kolt");
    chuan.resources.charge = ch;
    const sh0 = kolt.layers.filter(l => l.type === "shield").length;
    st.attackerId = chuan.id; st.targetId = kolt.id;
    c.runSkill("chuan_over");
    assert.equal(chuan.resources.charge, want);
    assert.equal(kolt.layers.filter(l => l.type === "shield").length > sh0, shield);
  });
}
test("#44 电站超频：技能文案写 2 电能", () => {
  const { c } = field(["chuan"]);
  const src = require("fs").readFileSync(require("path").join(H.ROOT, "skill-text.js"), "utf8");
  assert.match(src, /chuan_over: "电站超频：[^"]*获得 2 电能/);
  assert.ok(c);
});
