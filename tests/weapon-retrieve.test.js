// 武器人倒下后：主人在同区花 1 行动点取回；本场不能再唤出，武器 atk / 格挡加成减半；碎渣重炮子弹数照旧、伤害减半
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function setup(party, weapon) {
  const c = H.load();
  c.BattleSim.setup({ party, enemies: [{ id: "thug_hammer", lv: 1, zone: 2 }], seed: "WR" });
  c.startCombat();
  const S = c.S.state;
  const owner = S.units.find(u => u.kit === party[0]);
  owner.zone = 1; owner.ap = 3; owner.bonus = 2;
  const w = c.spawnWeapon(owner, weapon) || S.units.find(u => u.kit === weapon);
  w.zone = 2;
  const foe = S.units.find(u => !u.isPlayer);
  foe.layers.forEach(l => { l.current = l.max = 500; });
  return { c, S, owner, w, foe };
}
const kill = (c, w) => { w.layers.forEach(l => { l.current = 0; }); return c.applyKnockdown(w, [], {}); };
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));

test("武器人倒下：立刻扣 2 耐久，主人空手；要走到倒下的区花 1 行动点取回", () => {
  const { c, S, owner, w } = setup(["kolt"], "torque");
  const dur0 = c.weaponDur("torque");
  const atkFull = (owner.personalAtk || 0) + (owner.weaponAtk || 0);   // 拿在手里时的 atk
  kill(c, w);
  assert.equal(w.dead, true);
  assert.equal(c.weaponDur("torque"), dur0 - 2, "倒下立刻扣 2");
  assert.ok(c.isUnarmed(owner), "取回前空手");
  const ids = () => c.skillList(owner).map(s => s.id);
  assert.ok(ids().includes("weapon_retrieve"));
  assert.match(c.skillRequirementError(owner, "weapon_retrieve"), /2 区/, "不在同区不能取回");
  owner.zone = 2;
  assert.equal(c.skillRequirementError(owner, "weapon_retrieve"), null);
  cmd(c, { actor: owner.id, skill: "weapon_retrieve" });
  assert.equal(owner.ap, 2, "花 1 行动点");
  assert.ok(!c.isUnarmed(owner), "拿回手里");
  assert.equal(w.hidden, true);
  assert.ok(!ids().includes("weapon_retrieve"));
  // atk：武器提供的部分减半
  const half = (owner.personalAtk || 0) + Math.floor((owner.weaponAtk || 0) / 2);
  assert.equal(c.effectiveAtk(owner, S.units), half);
  assert.ok(half < atkFull);
  // 本场不能再唤出
  assert.ok(c.skillRequirementError(owner, "kolt_summon"), "不能再唤出");
  // 战斗结束不再重复扣
  const d1 = c.weaponDur("torque");
  c.ledgerAfterBattle([]);
  assert.equal(c.weaponDur("torque"), d1 - 1, "战斗结束只扣每场固定的 1");
});

test("取回的武器：协助格挡加成减半；战斗中修好耐久仍然减半；下一场恢复", () => {
  const { c, S, owner, w } = setup(["tou"], "mochi");
  const held0 = owner.weaponHeld; w.hidden = true; owner.weaponHeld = true;
  const full = c.heldWeaponBlockBonus(owner);   // 拿在手里时的格挡加成
  w.hidden = false; owner.weaponHeld = held0;
  assert.ok(full > 0);
  kill(c, w);
  owner.zone = w.zone;
  cmd(c, { actor: owner.id, skill: "weapon_retrieve" });
  assert.equal(c.heldWeaponBlockBonus(owner), Math.floor(full / 2));
  c.restoreDurability("mochi", 5);
  assert.equal(c.heldWeaponBlockBonus(owner), Math.floor(full / 2), "修好耐久也照样减半");
  c.resetBattleRecords();
  assert.equal(c.heldWeaponBlockBonus(owner), full, "下一场恢复");
  void S;
});

test("绯秋：倒下的那把刀取回后只减那一把", () => {
  const { c, S, owner, w } = setup(["hiaki"], "niu");
  kill(c, w);
  owner.zone = w.zone;
  cmd(c, { actor: owner.id, skill: "weapon_retrieve" });
  assert.equal(owner.resources.niuOut, false);
  owner.resources.blade = "niu";
  const niuAtk = c.effectiveAtk(owner, S.units);
  owner.resources.blade = "naruto";
  const narAtk = c.effectiveAtk(owner, S.units);
  const lv = b => (owner.weaponLevels && owner.weaponLevels[b]) || 1;
  const raw = b => c.computeWeaponAtk(b, owner.attrs, lv(b), c.weaponPartsOf(owner, b));
  assert.equal(niuAtk, (owner.personalAtk || 0) + Math.floor(raw("niu") / 2));
  assert.equal(narAtk, (owner.personalAtk || 0) + raw("naruto"));
});

test("碎渣重炮：扭矩倒下过后，子弹数照原来的 atk 算，伤害减半", () => {
  const run = (down) => {
    const { c, S, owner, w, foe } = setup(["kolt"], "torque");
    owner.level = 11;
    if (down) { kill(c, w); owner.zone = w.zone; cmd(c, { actor: owner.id, skill: "weapon_retrieve" }); }
    else c.returnWeapon(w);
    owner.zone = 2; owner.ap = 3;
    S.lastBrokenLayer = null; owner.resources.rotStore = { flesh: 40 }; owner.resources.bit = "drill";
    const pops = [];
    c.spawnPopup = (u, spec) => { if (spec.kind === "dmg" && u.id === foe.id) pops.push(spec.value); };
    c.S.RNG.install("CANNON");
    cmd(c, { actor: owner.id, skill: "kolt_cannon", picks: { dest: 2 } });
    return pops;
  };
  const a = run(false), b = run(true);
  assert.ok(a.length >= 3);
  assert.equal(b.length, a.length, "子弹数一样");
  const sum = x => x.reduce((s, v) => s + v, 0);
  assert.ok(sum(b) <= Math.ceil(sum(a) / 2) + b.length, `总伤害约减半：${sum(a)} → ${sum(b)}`);
  assert.ok(sum(b) < sum(a));
});

test("战斗中耐久打光：武器照常能用（技能、协助攻击），只是 atk / 格挡减半、不能唤出；开战前就坏了的才完全用不了", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["tou"], enemies: [{ id: "thug_hammer", lv: 1, zone: 1 }], seed: "WR2" });
  c.startCombat();
  const S = c.S.state;
  const tou = c.findKit("tou", S.units);
  const fullAtk = c.effectiveAtk(tou, S.units), fullBlock = c.heldWeaponBlockBonus(tou);
  const notes = [];
  c.spendDurability("mochi", 99, "测试", notes);
  assert.equal(c.weaponDur("mochi"), 0);
  assert.ok(!c.isUnarmed(tou), "这一场还拿着");
  assert.ok(c.skillList(tou).some(s => s.id === "tou_bash" || s.id === "tou_aa"), "技能照常");
  assert.ok(c.effectiveAtk(tou, S.units) < fullAtk, "atk 减半");
  assert.equal(c.heldWeaponBlockBonus(tou), Math.floor(fullBlock / 2), "格挡加成减半");
  assert.ok(c.skillRequirementError(tou, "tou_summon"), "不能唤出");
  assert.match(notes.join("\n"), /这一场 atk 和格挡加成减半/);
  // 战斗中修好：仍然减半
  c.LEDGER.repair = 99; if (c.LEDGER.items) c.LEDGER.items.repair = 99;
  c.restoreDurability("mochi", 5);
  assert.ok(c.weaponDur("mochi") > 0);
  assert.equal(c.heldWeaponBlockBonus(tou), Math.floor(fullBlock / 2), "修好了也减半");
  assert.ok(c.skillRequirementError(tou, "tou_summon"), "修好了这一场也不能唤出");
});

test("开战前就耐久为 0 的武器：完全用不了（空手、不能唤出）；战斗中修好按受损算", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["tou"], enemies: [{ id: "thug_hammer", lv: 1, zone: 1 }], seed: "WR3" });
  c.LEDGER.dur = Object.assign({}, c.LEDGER.dur, { mochi: 0 });
  const tou0 = c.findKit("tou", c.S.state.units);
  c.disarmBrokenWeapon(tou0, []);
  c.startCombat();
  const S = c.S.state;
  const tou = c.findKit("tou", S.units);
  assert.ok(c.isUnarmed(tou), "开战前坏了：空手");
  assert.ok(c.weaponUnusable("mochi"));
  assert.ok(c.skillRequirementError(tou, "tou_summon"));
  c.repairPoints = () => 99; c.spendRepairPoints = n => n;
  c.ledgerRepair("mochi", []);
  assert.ok(!c.isUnarmed(tou), "修好拿回手里");
  assert.ok(c.weaponHalved("mochi"), "战斗中修理：这一场按受损算");
});
