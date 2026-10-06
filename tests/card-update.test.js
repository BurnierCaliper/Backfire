// 测试服角色卡：柯尔特 / 扭矩 / Helumica / 拉斯缪尔 新技能与改动
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(party, foeZone) {
  const c = H.load();
  c.BattleSim.setup({ party, enemies: [{ id: "bandit_boss", lv: 1, zone: foeZone || 2 }], seed: "CU" });
  c.startCombat();
  const st = c.S.state;
  const foe = st.units.find(u => !u.isPlayer);
  foe.layers = [{ type: "armor", current: 60, max: 60 }, { type: "flesh", current: 200, max: 200, inner: true }];
  st.units.filter(u => u.isPlayer).forEach(u => { u.zone = 1; u.ap = 3; u.bonus = 3; u.level = 6; });
  st.weather = "none";
  return { c, st, foe };
}
const skill = (c, actor, id, target, picks) => { actor.ap = 3; return c.dispatch({ type: "skill", actor: actor.id, skill: id, target: target ? target.id : null, picks: picks || {} }); };

test("新技能出现在技能栏（按等级解锁）", () => {
  const { c, st } = field(["kolt", "helu", "ras"]);
  const ids = (k) => c.skillList(c.findKit(k, st.units)).map(s => s.id);
  assert.ok(ids("kolt").includes("kolt_rot") && ids("kolt").includes("kolt_mod"));
  assert.ok(ids("helu").includes("helu_storm"));
  assert.ok(ids("ras").includes("ras_super"));
  c.findKit("kolt", st.units).level = 2;
  assert.ok(!ids("kolt").includes("kolt_rot"), "3 级才有腐坏抛射");
});

test("腐坏抛射：酸液炮打距离 1 的敌人并腐蚀；腐蚀伤害记下来，下一次废物利用领取", () => {
  const { c, st, foe } = field(["kolt", "helu"]);
  const kolt = c.findKit("kolt", st.units);
  kolt.resources.bit = "acid";
  kolt.layers = [{ type: "flesh", current: 5, max: 20 }];
  const h0 = c.totalHp(foe);
  skill(c, kolt, "kolt_rot", foe);
  assert.ok(c.totalHp(foe) < h0);
  assert.equal(foe.statuses.corr, true);
  // 回合结束的腐蚀结算
  const notes = [];
  c.applyTypedDot(foe, 6, "acid", notes, `${foe.name} 腐蚀 1d6`);
  const store = kolt.resources.rotStore;
  assert.ok(store && store.armor > 0, JSON.stringify(store));
  const recorded = store.armor;
  st.lastBrokenLayer = null;
  const layers0 = kolt.layers.filter(l => l.type === "armor").reduce((s, l) => s + l.current, 0);
  skill(c, kolt, "kolt_scrap", null);
  const layers1 = kolt.layers.filter(l => l.type === "armor").reduce((s, l) => s + l.current, 0);
  assert.equal(layers1 - layers0, recorded, "领到等量装甲");
  assert.equal(JSON.stringify(kolt.resources.rotStore), "{}");
});

test("腐坏抛射需要酸液炮；「非法」改装需要电钻，可以对 1 距离内任意单位（含友方）施加过载", () => {
  const { c, st, foe } = field(["kolt", "helu"]);
  const kolt = c.findKit("kolt", st.units), helu = c.findKit("helu", st.units);
  kolt.resources.bit = "drill";
  assert.match(c.skillRequirementError(kolt, "kolt_rot") || "", /酸液炮/);
  skill(c, kolt, "kolt_mod", foe);
  assert.ok(foe.instant && foe.instant.overload);
  skill(c, kolt, "kolt_mod", helu);
  assert.ok(helu.instant && helu.instant.overload);
  kolt.resources.bit = "acid";
  assert.match(c.skillRequirementError(kolt, "kolt_mod") || "", /电钻/);
});

test("扭矩酸液炮蓄力爆发：被打到的敌人下一击必须攻击柯尔特", () => {
  const { c, st, foe } = field(["kolt", "helu"]);
  const kolt = c.findKit("kolt", st.units);
  const torque = c.spawnWeapon(kolt, "torque");
  torque.resources.acidCharge = 2;
  foe.tauntTo = null;
  c.releaseAcidCharges([]);
  assert.equal(foe.tauntTo, kolt.id);
});

test("大气干扰：进入沙暴；扫描过战场后再用可以调转风向", () => {
  const { c, st } = field(["helu", "kolt"]);
  const helu = c.findKit("helu", st.units);
  skill(c, helu, "helu_storm", null);
  assert.equal(st.weather, "sand");
  const d0 = st.sandDir;
  skill(c, helu, "helu_storm", null);
  assert.equal(st.sandDir, d0, "没扫描过不能调转");
  helu.resources.scanned = true;
  skill(c, helu, "helu_storm", null);
  assert.notEqual(st.sandDir, d0);
});

test("不稳超导：20% 能量转光能 + 自身导体；不稳态下免费", () => {
  const { c, st } = field(["ras", "kolt"]);
  const ras = c.findKit("ras", st.units);
  ras.resources.energyPct = 40; ras.resources.light = 0;
  skill(c, ras, "ras_super", null);
  assert.equal(ras.resources.energyPct, 20);
  assert.ok(ras.resources.light > 0);
  assert.equal(ras.self, "conductor");
  assert.equal(ras.ap, 2);
  ras.resources.unstable = true; ras.resources.energyPct = 120;
  assert.equal(JSON.stringify(c.skillCost("ras_super")), "{}");
  skill(c, ras, "ras_super", null);
  assert.equal(ras.ap, 3, "不稳态免费");
});

test("拉斯缪尔协助格挡：成功也只是累积 20% 能量（不再把能量全转光能）", () => {
  const src = require("fs").readFileSync(require("path").join(H.ROOT, "app.js"), "utf8");
  assert.match(src, /if \(helper\.kit === "ras"\) addRasEnergy\(20, "协助格挡"\)/);
  const c = H.load();
  assert.match(c.SkillText.kitInfo("ras").assistBlock, /无论成功与否都累积 20% 能量/);
});
