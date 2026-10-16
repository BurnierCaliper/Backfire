// 效果道具（docs/workshop-design.md 第 1 步）：36 种、附赠动作、射程 1、晕眩规则、商店售卖
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");

function field(enemies) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], seed: "FX", zoneMode: 3, enemies: enemies || [{ id: "thug_knife", lv: 5, zone: 2 }] });
  c.startCombat();
  const st = c.S.state;
  const k = c.findKit("kolt", st.units), h = c.findKit("helu", st.units);
  k.zone = 1; h.zone = 1;
  st.units.filter(u => !u.isPlayer).forEach(u => { u.zone = 2; });
  const foe = st.units.find(u => !u.isPlayer);
  const use = (actor, item, target, dest) => {
    c.bagAdd(item, 1);
    actor.bonus = 1; st.combatPhase = "player";
    const run = c.BattleCommands || null;
    const notes = c.useItemOn(actor, item, target || null, dest == null ? null : dest);
    return notes;
  };
  return { c, st, k, h, foe, use, V: (e) => vm.runInContext(e, c) };
}

test("36 种效果道具：都在物品表里、能在战斗中用、说明写着附赠动作；自我效果没有商店价，有积分", () => {
  const { V } = field();
  const list = V("EFFECT_ITEMS");
  assert.equal(list.length, 36);
  list.forEach(it => {
    const spec = V(`ITEM_CATALOG["${it.id}"]`);
    assert.ok(spec && spec.combat, it.id);
    assert.match(spec.hint, /附赠动作/);
    if (it.kind === "self") { assert.ok(it.points >= 3 && !it.price, it.id); } else assert.ok(it.price > 0, it.id);
  });
  const profs = {}; list.forEach(it => { profs[it.prof] = (profs[it.prof] || 0) + 1; });
  assert.deepEqual(Object.values(profs), [6, 6, 6, 6, 6, 6], "6 个熟练项各 6 个");
});

test("投掷罐：距离 1 以内的一个区域里全部单位（不分敌我）挂上属性状态；距离 2 不能用、不扣道具", () => {
  const { c, st, k, h, foe, use } = field();
  use(k, "fx_corr", null, 2);
  assert.equal(foe.statuses.corr, true);
  use(k, "fx_burn", null, 1);
  assert.ok(k.statuses.burn >= 1 && h.statuses.burn >= 1, "自己这区的人也挨（不分敌我）");
  c.bagAdd("fx_shock", 1);
  const notes = c.useItemOn(k, "fx_shock", null, 3);
  assert.match(notes.join(), /距离 1 以内/);
  assert.equal(notes.unused, true);
  assert.equal(c.bagCount("fx_shock"), 1, "没用出去，道具还在");
});

test("弹针 / 减益：一个距离 1 以内的敌人；即时效果、不稳（两次转晕眩）、虚弱、紧追（施加者跟着走）", () => {
  const { c, k, foe, use } = field();
  use(k, "fx_melt", foe);
  assert.equal(foe.instant.melt, true);
  use(k, "fx_weak", foe);
  assert.equal(foe.statuses.weak, true);
  use(k, "fx_beacon", foe);
  assert.equal(foe.statuses.chase, true);
  assert.ok(foe.chasers.includes(k.id));
  use(k, "fx_trip", foe); use(k, "fx_trip", foe);
  assert.equal(foe.stunned, true, "两个不稳转为晕眩");
  foe.zone = 3;
  assert.match(c.itemUseError(k, "fx_melt", foe, null), /距离 1 以内/);
  assert.deepEqual(JSON.parse(JSON.stringify(c.itemTargetUnits(k, "fx_melt").map(u => u.id))), [], "射程外的敌人不列出来");
});

test("增益：自己或距离 1 以内的友方；烟雾弹只给一个区域里的友方躲藏", () => {
  const { k, h, foe, use } = field();
  use(k, "fx_rouse", h);
  assert.equal(h.statuses.inspire, true);
  use(k, "fx_calm", k);
  assert.equal(k.statuses.sturdy, true);
  foe.zone = 1;
  use(k, "fx_smoke", null, 1);
  assert.equal(k.statuses.hide, true);
  assert.ok(!foe.statuses.hide, "敌人不躲藏");
});

test("闪光震撼弹：普通敌人晕眩；首领无效（不扣道具）；要攒 2 个晕眩标记的精英只推进 1 个", () => {
  const f = field([{ id: "thug_knife", lv: 5, zone: 2 }, { id: "outlaw_king", lv: 5, zone: 2 }, { id: "captain_wolf", lv: 12, zone: 2 }]);
  const thug = f.st.units.find(u => u.kit === "thug_knife"), king = f.st.units.find(u => u.kit === "outlaw_king"), wolf = f.st.units.find(u => u.kit === "captain_wolf");
  f.use(f.k, "fx_flash", thug);
  assert.equal(thug.stunned, true);
  f.c.bagAdd("fx_flash", 1);
  const n = f.c.useItemOn(f.k, "fx_flash", king, null);
  assert.match(n.join(), /首领/);
  assert.equal(king.stunned, false);
  f.use(f.k, "fx_flash", wolf);
  assert.equal(wolf.stunMarks, 1, "精英只推进 1 个晕眩标记");
});

test("场地道具：把距离 1 以内的区域变成场地；固有场地改不了", () => {
  const { c, st, k, use } = field();
  use(k, "fx_f_electric", null, 2);
  assert.equal(st.fields[2].electric, true);
  st.fields[1].innate = true; st.fields[1].ice = true;
  assert.match(c.itemUseError(k, "fx_f_fire", null, 1) || "", /固有场地/);
});

test("自我效果道具：只能对自己用", () => {
  const { c, k, h, use } = field();
  use(k, "fx_s_conductor");
  assert.equal(k.self, "conductor");
  assert.match(c.itemUseError(k, "fx_s_frost", h, null), /只能对自己用/);
});

test("战斗命令：道具用出去扣 1 个附赠动作；没用出去（射程外）不扣", () => {
  const { c, st, k } = field();
  c.bagAdd("fx_corr", 2);
  k.bonus = 1; k.ap = 1; st.combatPhase = "player";
  c.dispatch({ type: "useItem", actor: k.id, item: "fx_corr", target: null, dest: 3 });
  assert.equal(k.bonus, 1, "射程外：附赠动作还在");
  assert.equal(c.bagCount("fx_corr"), 2);
  c.dispatch({ type: "useItem", actor: k.id, item: "fx_corr", target: null, dest: 2 });
  assert.equal(k.bonus, 0);
  assert.equal(c.bagCount("fx_corr"), 1);
});

test("商店：单局每家另外随机进 4 种效果道具（自我效果不卖），原来的 8 种进货不变；跑团物品表有 29 种效果道具", () => {
  const { c, V } = field();
  const R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed: "SHOPFX" });
  run.stage = "town";
  const keys = V("ROGUE_SHOP").filter(r => r.effect).map(r => r.key);
  assert.equal(keys.length, 29);
  assert.ok(!keys.some(k => /^fx_s_/.test(k)), "自我效果不卖");
  assert.equal(V("HANDBOOK_SHOP").filter(r => r.group === "效果道具").length, 29);
});
