// 协助格挡率（空手 + 武器）、连续协助格挡、角色资料 / 技能说明
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(party) {
  const c = H.load();
  c.BattleSim.setup({ party: party || ["ruby", "kolt", "hiaki", "tou"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }] });
  c.startCombat();
  return { c, st: c.S.state };
}

test("空手格挡率 = 30% +（敏捷 − 5）× 5%，最低 15%、最高 50%", () => {
  const { c } = field();
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12].map(c.bareBlockFromDex), [15, 15, 20, 25, 30, 35, 40, 45, 50, 50, 50]);
});

test("协助格挡率 = 空手（看敏捷）+ 手里武器的格挡加成；初始数值和角色卡一致", () => {
  const { c, st } = field(["ruby", "yuito", "hiaki", "tou", "xia", "chuan", "nora", "kolt", "helu", "ras"]);
  const want = { ruby: 50, yuito: 60, hiaki: 70, tou: 70, xia: 60, chuan: 80, nora: 50, kolt: 55, helu: 45, ras: 45 };
  Object.keys(want).forEach(k => assert.equal(c.blockChance(c.findKit(k, st.units)), want[k], k));
  const ruby = c.findKit("ruby", st.units);
  assert.equal(JSON.stringify(c.blockBreakdown(ruby)), JSON.stringify({ bare: 45, weapon: 5, extra: 0, total: 50, dex: 8 }));
});

test("敏捷升高，空手和协助格挡率跟着变（以前老角色写死总数，不随敏捷变）", () => {
  const { c, st } = field();
  const tou = c.findKit("tou", st.units);
  assert.equal(c.blockChance(tou), 70);        // 敏捷 4：25 + 年糕 45
  tou.attrs.dex = 6;
  assert.equal(c.blockChance(tou), 80);        // 35 + 45
  const kolt = c.findKit("kolt", st.units);
  kolt.attrs.dex = 9;
  assert.equal(c.blockChance(kolt), 85);       // 50 + 扭矩 35
});

test("武器人分出去后：主人只剩空手格挡率；武器人自己用自己的敏捷 + 自己的格挡加成", () => {
  const { c, st } = field();
  const kolt = c.findKit("kolt", st.units);
  const torque = c.spawnWeapon(kolt, "torque");
  assert.ok(torque);
  assert.equal(c.blockChance(kolt), 20);       // 敏捷 3 的空手
  assert.equal(c.blockChance(torque), 60);     // 扭矩：敏捷 4（25）+ 35
  const hiaki = c.findKit("hiaki", st.units);
  c.spawnWeapon(hiaki, "niu");                 // 分出丹生谷，手里换成鳴門
  assert.equal(c.blockChance(hiaki), 60);      // 30 + 鳴門 30
});

test("夕夏引擎启动：格挡成功率 +10%", () => {
  const { c, st } = field(["xia", "ruby"]);
  const xia = c.findKit("xia", st.units);
  assert.equal(c.blockChance(xia), 60);
  xia.resources.engine = true;
  assert.equal(c.blockChance(xia), 70);
});

test("14 级不再把空手格挡率提到 50%（只保留行动点转附赠动作）", () => {
  const src = require("fs").readFileSync(require("path").join(H.ROOT, "rogue-data.js"), "utf8");
  const line = src.split("\n").find(s => s.includes('key: "lv14"'));
  assert.ok(line && !line.includes("50%") && line.includes("附赠动作"));
});

function attackRuby(c, st) {
  const ruby = c.findKit("ruby", st.units);
  const foe = st.units.find(u => !u.isPlayer);
  st.units.filter(u => u.isPlayer).forEach(u => { u.zone = 1; u.bonus = 1; });
  foe.zone = 1;
  st.combatPhase = "enemy";
  c.dealTo(foe, ruby, { atk: 0, mult: 0, flat: 6, element: "physical", baseBreak: 1, flags: { action: true } });
  return { ruby, foe };
}

test("连续协助格挡：第一个人没挡住，这一击先不落下，剩下能挡的人接着选；已经试过的人不再出现", () => {
  const { c, st } = field();
  const { ruby } = attackRuby(c, st);
  const kolt = c.findKit("kolt", st.units), tou = c.findKit("tou", st.units);
  assert.equal(st.blockQueue.length, 1);
  const hp0 = c.totalHp(ruby);
  c.finishBlock(kolt.id, { roll: 99, ok: false, chance: 55 });
  assert.equal(st.blockQueue.length, 1, "还在等下一个人");
  assert.equal(c.totalHp(ruby), hp0, "伤害还没落下");
  const left = c.eligibleBlockers(ruby, st.blockQueue[0]).map(u => u.kit);
  assert.ok(!left.includes("kolt") && left.includes("tou"));
  c.finishBlock(tou.id, { roll: 1, ok: true, chance: 70 });
  assert.equal(st.blockQueue.length, 0);
  assert.equal(c.totalHp(ruby), hp0, "第二个人挡住了：不受伤");
});

test("连续协助格挡：所有人都失败（或剩下的人选择不挡），伤害才落下", () => {
  const { c, st } = field();
  const { ruby } = attackRuby(c, st);
  const hp0 = c.totalHp(ruby);
  const kolt = c.findKit("kolt", st.units);
  c.finishBlock(kolt.id, { roll: 99, ok: false, chance: 55 });
  assert.equal(st.blockQueue.length, 1);
  c.finishBlock(null);                           // 剩下的人不挡
  assert.equal(st.blockQueue.length, 0);
  assert.ok(c.totalHp(ruby) < hp0, "照常受伤");
});

test("连续协助格挡：没人能接着挡时，失败就直接落下", () => {
  const { c, st } = field(["ruby", "kolt"]);
  const { ruby } = attackRuby(c, st);
  const hp0 = c.totalHp(ruby);
  c.finishBlock(c.findKit("kolt", st.units).id, { roll: 99, ok: false, chance: 55 });
  assert.equal(st.blockQueue.length, 0);
  assert.ok(c.totalHp(ruby) < hp0);
});

test("技能说明：每个角色、武器人能学到的技能都有完整说明（照角色卡）", () => {
  const { c, st } = field(["ruby", "yuito", "hiaki", "tou", "xia", "chuan", "nora", "kolt", "helu", "ras"]);
  const data = c.SkillText.sheetData();
  assert.equal(data.length, 10);
  const missing = [];
  // 资料只展示当前等级的技能；说明完整性仍用 99 级副本核对，不写进资料
  st.units.filter(u => u.isPlayer).forEach(u => {
    const probe = Object.assign({}, u, { level: 99, resources: Object.assign({}, u.resources || {}) });
    (c.skillList(probe) || []).forEach(s => { if (s && s.id && !c.SkillText.skillText(s.id)) missing.push(s.id); });
  });
  data.forEach(h => [h].concat(h.weapons).forEach(x => x.skills.now.forEach(s => {
    if (!c.SkillText.skillText(s.id)) missing.push(s.id);
  })));
  assert.deepEqual(missing, []);
  data.forEach(h => {
    assert.ok(h.passives.length >= 2, h.kit + " 被动");
    assert.ok(h.assistAttack, h.kit + " 协助攻击");
    assert.ok(h.rest && h.rest.food > 0, h.kit + " 长休食物");
    assert.ok(h.weapons.length >= 1, h.kit + " 武器人");
  });
  void st;
});

test("角色资料：只读，不改动战场；数值和单位一致", () => {
  const { c, st } = field(["hiaki", "kolt"]);
  const before = JSON.stringify(st.units);
  const data = c.SkillText.sheetData();
  assert.equal(JSON.stringify(st.units), before);
  const h = data.find(x => x.kit === "hiaki");
  assert.equal(h.block.total, 70);
  assert.equal(JSON.stringify(h.weapons.map(w => [w.kit, w.blockBonus, w.blockAlone])), JSON.stringify([["niu", 40, 55], ["naruto", 30, 45]]));
  assert.equal(h.atk, c.effectiveAtk(c.findKit("hiaki", st.units), st.units));
  assert.ok(!h.skills.now.some(s => s.id === "hiaki_flash"), "当前等级没有的技能不展示");
  assert.equal(h.skills.later.length, 0);
});

test("单局：Rogue.sheetData 给出整队资料，不改动本局", () => {
  const c = H.load();
  const run = c.Rogue.newRun({ party: ["xia", "nora"], seed: "SHEET" });
  c.Rogue.restPlan(run);   // 和界面一样：先按队伍摆一次（新局的空血量会补成满血）
  const before = JSON.stringify(run);
  const data = c.Rogue.sheetData(run);
  assert.equal(data.map(h => h.kit).join(","), "xia,nora");
  assert.equal(JSON.stringify(run), before);
});
