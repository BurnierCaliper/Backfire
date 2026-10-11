// 瑞比 / 明特 / 结人 / 拿铁 / 绯秋 / 丹生谷 / 鳴門 / 灯 / 年糕 的新技能
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));

function setup(party, lv) {
  const c = H.load();
  c.BattleSim.setup({ party, enemies: [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 2 }], seed: "RYHT" });
  c.startCombat();
  const S = c.S.state;
  const foes = S.units.filter(u => !u.isPlayer);
  foes.forEach(f => { f.layers = [{ type: "flesh", current: 200, max: 200 }]; f.def = f.defMax = 10; f.zone = 1; });
  foes[2].zone = 2;
  S.units.filter(u => u.isPlayer).forEach(h => { h.zone = 1; h.level = lv || 11; h.ap = 3; h.bonus = 2; });
  const K = k => c.findKit(k, S.units);
  return { c, S, foes, K };
}
const summon = (c, S, owner, sid, kit) => { cmd(c, { actor: owner.id, skill: sid }); const w = c.findKit(kit, S.units); w.zone = owner.zone; w.ap = 3; w.bonus = 2; w.level = owner.level; return w; };

test("新技能解锁等级", () => {
  const { c, K } = setup(["ruby", "yuito", "hiaki", "tou"], 1);
  const ids = u => c.skillList(u).map(s => s.id);
  const r = K("ruby"), y = K("yuito"), h = K("hiaki"), t = K("tou");
  assert.ok(!ids(r).includes("ruby_algo") && !ids(y).includes("yuito_cold") && !ids(h).includes("hiaki_barrage") && !ids(t).includes("tou_bash"));
  [r, y, h, t].forEach(u => { u.level = 11; });
  ["ruby_algo", "ruby_relay"].forEach(id => assert.ok(ids(r).includes(id), id));
  ["yuito_cold", "yuito_duet"].forEach(id => assert.ok(ids(y).includes(id), id));
  ["hiaki_barrage", "hiaki_powder"].forEach(id => assert.ok(ids(h).includes(id), id));
  ["tou_bash", "tou_accuse"].forEach(id => assert.ok(ids(t).includes(id), id));
});

test("瑞比 算法改变：扩散 + 这一回合它受伤一次瑞比 +5 纳米", () => {
  const { c, S, foes, K } = setup(["ruby", "kolt"]);
  const r = K("ruby"), k = K("kolt");
  r.resources.nano = 30;
  cmd(c, { actor: r.id, skill: "ruby_algo", target: foes[2].id });
  assert.ok(foes[2].instant && foes[2].instant.spread);
  const n0 = r.resources.nano;
  foes[2].zone = 1;
  cmd(c, { actor: k.id, skill: "kolt_aa", target: foes[2].id });
  assert.ok(r.resources.nano > n0, "受伤加纳米");
  assert.equal((r.resources.nano - n0) % 5, 0);
  assert.ok(S);
});

test("瑞比 收发代理：每回合 +10 纳米；机甲里改为打高能敌人两次激光、耗 10 纳米", () => {
  const { c, S, foes, K } = setup(["ruby"]);
  const r = K("ruby");
  r.resources.nano = 30;
  cmd(c, { actor: r.id, skill: "ruby_relay" });
  assert.ok(r.resources.drone);
  c.turnEnd();
  assert.equal(r.resources.nano, 40);
  // 进机甲：无人机改为激光
  const m = summon(c, S, r, "ruby_summon", "mint");
  r.resources.nano = 100;
  cmd(c, { actor: m.id, skill: "mint_mecha" });
  assert.ok(r.resources.mecha);
  foes[2].statuses = { high: true };
  const hp = foes[2].layers[0].current;
  c.turnEnd();
  assert.ok(foes[2].layers[0].current < hp, "激光打高能的那个");
  assert.equal(r.resources.nano, 100 - 10 - 20, "激光 10 + 机甲维持 20");
  // 激光不能穿墙；没有可选目标就什么都不干、不耗纳米
  S.units.filter(u => !u.isPlayer).forEach(f => { f.zone = 2; });
  r.zone = 1;
  S.gaps["1-2"] = Object.assign(c.emptyGap(), { type: "wall", hp: 50, maxHp: 50, level: 1 });
  r.resources.nano = 100;
  const hp2 = foes[2].layers[0].current;
  c.turnEnd();
  assert.equal(foes[2].layers[0].current, hp2, "隔墙打不到");
  assert.equal(r.resources.nano, 80, "只扣机甲维持 20，无人机不耗纳米");
});

test("明特 机体修复：耗 20 纳米，回 50% 上限、+1 架势", () => {
  const { c, S, K } = setup(["ruby"]);
  const r = K("ruby");
  const m = summon(c, S, r, "ruby_summon", "mint");
  r.resources.nano = 30;
  m.layers.forEach(l => { l.current = 1; });
  m.def = 1;
  cmd(c, { actor: m.id, skill: "mint_repair" });
  assert.equal(r.resources.nano, 10);
  assert.ok(c.totalHp(m) >= Math.floor(c.totalMaxHp(m) * 0.5));
  assert.equal(m.def, 2);
});

test("银翼 机体强化：不耗行动，atk ×1.2，维持多耗 20，普攻溅射 0.4，无人机攻击次数 +1", () => {
  const { c, S, foes, K } = setup(["ruby"]);
  const r = K("ruby");
  const m = summon(c, S, r, "ruby_summon", "mint");
  r.resources.nano = 100;
  cmd(c, { actor: m.id, skill: "mint_mecha" });
  r.ap = 2;
  const atk0 = c.effectiveAtk(r, S.units);
  cmd(c, { actor: r.id, skill: "wing_boost" });
  assert.equal(r.ap, 2, "不耗行动点");
  assert.ok(Math.abs(c.effectiveAtk(r, S.units) - atk0 * 1.2) < 1e-9);
  c.turnEnd();
  assert.equal(r.resources.nano, 60, "每回合 −40");
  // 无人机攻击次数 +1：两次 → 三次
  r.resources.drone = true; r.resources.nano = 100;
  foes[2].statuses = { high: true };
  const pops = [];
  c.spawnPopup = (u, spec) => { if (spec.kind === "dmg" && u === foes[2]) pops.push(spec.value); };
  c.turnEnd();
  assert.equal(pops.length, 3);
});

test("结人 冷萃：冻土，敌人 0.5atk 冰 +1 击破，友方 +1 架势", () => {
  const { c, S, foes, K } = setup(["yuito", "kolt"]);
  const y = K("yuito"), k = K("kolt");
  y.resources.liquid = 2; k.def = 1;
  const d0 = foes[0].def;
  cmd(c, { actor: y.id, skill: "yuito_cold", picks: { dest: 1 } });
  assert.ok(S.fields[1].ice, "冻土");
  assert.equal(foes[0].def, d0 - 1);
  assert.equal(k.def, 2);
  assert.equal(y.resources.liquid, 1);
});

test("结人 双重奏：2 咖啡液，等级×1d6；溢出变 atk，下回合开始失去", () => {
  const { c, S, K } = setup(["yuito", "kolt"]);
  const y = K("yuito"), k = K("kolt");
  y.resources.liquid = 2;
  const atk0 = c.effectiveAtk(k, S.units);
  cmd(c, { actor: y.id, skill: "yuito_duet", picks: { target: k.id } });
  assert.equal(y.resources.liquid, 0);
  assert.ok(k.duetAtk >= 11, "满血时全部溢出（11 级至少 11）");
  assert.equal(c.effectiveAtk(k, S.units), atk0 + k.duetAtk);
  c.beginRound([]);
  assert.equal(k.duetAtk, 0);
});

test("拿铁 猫爪挥打：1atk 酸 +1 击破，击退 1，+1 咖啡豆；爱意：已有牵挂时拿铁也恢复", () => {
  const { c, S, foes, K } = setup(["yuito", "kolt"]);
  const y = K("yuito"), k = K("kolt");
  const l = summon(c, S, y, "yuito_summon", "latte");
  const b0 = y.resources.bean || 0;
  cmd(c, { actor: l.id, skill: "latte_claw", target: foes[0].id });
  assert.equal(foes[0].zone, 2, "击退 1");
  assert.ok(y.resources.bean >= b0 + 1);
  // 爱意
  l.ap = 3; l.zone = 1; k.zone = 1;
  y.resources.bondId = k.id;
  l.layers.forEach(x => { x.current = 1; });
  const lhp = c.totalHp(l);
  cmd(c, { actor: l.id, skill: "latte_love", target: k.id });
  assert.ok(c.totalHp(l) > lhp, "目标已有牵挂：拿铁也恢复");
});

test("绯秋 特盛乱打：仅胁构，同区每个 1 击破 + 标记，进入拔刀；之后进入居合时被标记的各挨 0.5atk", () => {
  const { c, S, foes, K } = setup(["hiaki"]);
  const h = K("hiaki");
  h.resources.stance = "draw";
  assert.match(c.skillRequirementError(h, "hiaki_barrage") || "", /胁构/);
  h.resources.stance = "waki";
  const d0 = foes[0].def;
  cmd(c, { actor: h.id, skill: "hiaki_barrage" });
  assert.equal(foes[0].def, d0 - 1);
  assert.equal(foes[0].barrageBy, h.id);
  assert.equal(h.resources.stance, "draw");
  foes[0].zone = 2;   // 走远了也砍得到
  const hp = foes[0].layers[0].current;
  c.setHiakiStance(h, "iai");
  assert.ok(foes[0].layers[0].current < hp);
  assert.equal(foes[0].barrageBy, null);
});

test("绯秋 粉落汤气：格挡成功不切刀势，用另一把刀反击；下回合开始结束", () => {
  const { c, S, foes, K } = setup(["hiaki", "kolt"]);
  const h = K("hiaki"), k = K("kolt");
  h.resources.stance = "iai"; h.resources.blade = "niu";
  cmd(c, { actor: h.id, skill: "hiaki_powder" });
  assert.ok(h.resources.powder);
  const def0 = foes[0].def, hp0 = foes[0].layers[0].current;
  // 直接走协助格挡结算（绯秋替柯尔特挡敌人 0 的攻击）
  const out = c.performAssistBlock(h, k, foes[0], {}, "melee");
  assert.ok(out && out.ok, (out && out.notes || []).join("\n"));
  assert.equal(h.resources.stance, "iai", "刀势不变");
  assert.ok(foes[0].layers[0].current < hp0, "鳴門反击");
  assert.equal(foes[0].def, def0 - 1, "鳴門反击 +1 击破");
  c.beginRound([]);
  assert.equal(h.resources.powder, false);
});

test("丹生谷 待命：下一次协助格挡必定成功；成功后变回武器，绯秋换丹生谷居合", () => {
  const { c, S, foes, K } = setup(["hiaki", "kolt"]);
  const h = K("hiaki"), k = K("kolt");
  h.resources.blade = "niu"; h.resources.stance = "draw";
  cmd(c, { actor: h.id, skill: "hiaki_summon", picks: { blade: "niu" } });
  const n = c.findKit("niu", S.units);
  n.zone = 1; n.ap = 3; n.level = 11;
  cmd(c, { actor: n.id, skill: "niu_standby" });
  assert.ok(n.resources.standby);
  assert.equal(c.finalBlockChance(n, foes[0], k), 100);
  const out = c.performAssistBlock(n, k, foes[0], { roll: 100 }, "melee");
  assert.ok(out.ok, "掷 100 也成功");
  assert.ok(n.hidden, "变回武器");
  assert.equal(h.resources.blade, "niu");
  assert.equal(h.resources.stance, "iai");
});

test("鳴門 霜取：3 冰击破；打出失衡就收回，绯秋换鳴門胁构", () => {
  const { c, S, foes, K } = setup(["hiaki"]);
  const h = K("hiaki");
  h.resources.blade = "niu";
  cmd(c, { actor: h.id, skill: "hiaki_summon", picks: { blade: "naruto" } });
  const w = c.findKit("naruto", S.units);
  w.zone = 1; w.ap = 3; w.level = 11;
  foes[0].def = 3;
  cmd(c, { actor: w.id, skill: "naruto_frost", target: foes[0].id });
  assert.ok(foes[0].stunned);
  assert.ok(w.hidden, "收回");
  assert.equal(h.resources.blade, "naruto");
  assert.equal(h.resources.stance, "waki");
});

test("灯 盾击突进：移动后 1atk 物理 + 震荡；耗圣盾再 1 击破 + 不稳", () => {
  const { c, S, foes, K } = setup(["tou"]);
  const t = K("tou");
  t.resources.shield = 2;
  const steps = c.skillFlowSteps("tou_bash", t, { dest: 2 });
  assert.ok(steps.find(s => s.key === "target").units.some(u => u.id === foes[2].id));
  const d0 = foes[2].def;
  cmd(c, { actor: t.id, skill: "tou_bash", picks: { dest: 2, target: foes[2].id, again: "yes" } });
  assert.equal(t.zone, 2);
  assert.ok(foes[2].statuses.shockwave, "震荡");
  assert.ok(foes[2].statuses.unstable, "不稳");
  assert.equal(t.resources.shield, 1);
  assert.ok(foes[2].def < d0);
});

test("灯 赤诚控诉：1atk 谐波，嘲讽，圣盾 +2（最多 3）；决一死战中的敌人再虚弱", () => {
  const { c, S, foes, K } = setup(["tou"]);
  const t = K("tou");
  t.resources.shield = 0;
  foes[1].zone = 2;   // 同区只剩一个敌人 → 决一死战
  cmd(c, { actor: t.id, skill: "tou_accuse", target: foes[0].id });
  assert.equal(foes[0].tauntTo, t.id);
  assert.equal(t.resources.shield, 2);
  assert.ok(foes[0].statuses.weak, "决一死战中的敌人虚弱");
});

test("年糕 紧咬不放：1atk 物理 +1 击破，嘲讽，无法移动", () => {
  const { c, S, foes, K } = setup(["tou"]);
  const t = K("tou");
  const m = summon(c, S, t, "tou_summon", "mochi");
  m.level = 4;
  const d0 = foes[0].def;
  cmd(c, { actor: m.id, skill: "mochi_bite", target: foes[0].id });
  assert.equal(foes[0].def, d0 - 1);
  assert.equal(foes[0].tauntTo, m.id);
  assert.ok(foes[0].noMove);
});
