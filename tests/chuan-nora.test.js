// 川川 / 哔哩哩 / 诺拉 / 维塔斯：按作者新版角色卡的调整
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(party, foeZone) {
  const c = H.load();
  c.BattleSim.setup({ party: party || ["chuan", "nora"], enemies: [{ id: "thug_hammer", lv: 1, zone: foeZone || 1 }], seed: "CN" });
  c.startCombat();
  const st = c.S.state;
  const foe = st.units.find(u => !u.isPlayer);
  st.units.filter(u => u.isPlayer).forEach(u => { u.zone = 1; u.ap = 3; u.bonus = 3; u.level = 6; });
  return { c, st, foe };
}
const skill = (c, actor, id, target, picks) =>
  c.dispatch({ type: "skill", actor: actor.id, skill: id, target: target ? target.id : null, picks: picks || {} });
/** 记下每一次 dealTo 的属性和写进战斗记录的文字 */
function spy(c) {
  const els = [], text = [];
  const deal = c.dealTo, app = c.appendLog;
  c.dealTo = (a, t, o) => { els.push(o && o.element); return deal(a, t, o); };
  c.appendLog = (x, k) => { text.push(String(x)); return app(x, k); };
  return { els, text: () => text.join("\n") };
}

test("川川普通攻击改成电击伤害", () => {
  const { c, st, foe } = field();
  const chuan = c.findKit("chuan", st.units);
  const sp = spy(c);
  skill(c, chuan, "chuan_aa", foe);
  assert.ok(sp.els.length >= 2 && sp.els.every(e => e === "electric"), sp.els.join(","));
});

test("电击鞭：能量伤害；有电能时可以选择消耗 1 电能把自己拉到敌人那一区", () => {
  const { c, st, foe } = field(null, 2);
  const chuan = c.findKit("chuan", st.units);
  chuan.resources.charge = 2;
  assert.equal(c.skillFlowSteps("chuan_whip", chuan, {})[0].key, "pull");
  const sp = spy(c);
  skill(c, chuan, "chuan_whip", foe, { pull: "pull" });
  assert.equal(sp.els[0], "energy");
  assert.equal(chuan.zone, 2);
  assert.equal(chuan.resources.charge, 2);   // −1 拉过去，+1 抽击积攒
  // 不选就不拉
  const f2 = field(null, 2);
  const ch2 = f2.c.findKit("chuan", f2.st.units);
  ch2.resources.charge = 2;
  skill(f2.c, ch2, "chuan_whip", f2.foe, {});
  assert.equal(ch2.zone, 1);
  assert.equal(ch2.resources.charge, 3);
  // 没电能时没有这一步
  ch2.resources.charge = 0;
  assert.equal(f2.c.skillFlowSteps("chuan_whip", ch2, {}).length, 0);
});

test("高能脉冲：对自身施加蓄能，不用选目标", () => {
  const { c, st } = field();
  const chuan = c.findKit("chuan", st.units);
  skill(c, chuan, "chuan_pulse", null);
  assert.equal(chuan.self, "store");
  assert.equal(chuan.ap, 2);
});

test("协助攻击：积攒后电能 ≥ 3 时补一记重斩，消耗 2 电能", () => {
  const { c, st, foe } = field();
  const chuan = c.findKit("chuan", st.units);
  foe.layers.forEach(l => { l.current = l.max = 999; });
  chuan.resources.charge = 1;
  st.attackerId = chuan.id; st.targetId = foe.id;
  const sp = spy(c);
  c.runSkill("chuan_assist", { ignorePhase: true, free: true });
  assert.equal(chuan.resources.charge, 1);    // 1 + 2 = 3 → 重斩 −2
  assert.match(sp.text(), /重斩/);
  assert.equal(sp.els.length, 3);
  chuan.resources.charge = 0;
  c.runSkill("chuan_assist", { ignorePhase: true, free: true });
  assert.equal(chuan.resources.charge, 2);    // 不到 3，不重斩
});

test("铁壁：电能 ≥ 3 时可以多耗 1 电能加 atk 点外层护盾，护盾先挨打", () => {
  const { c, st, foe } = field();
  const chuan = c.findKit("chuan", st.units);
  chuan.resources.charge = 3;
  assert.equal(c.skillFlowSteps("chuan_wall", chuan, {})[0].key, "shield");
  skill(c, chuan, "chuan_wall", null, { shield: "shield" });
  assert.equal(chuan.resources.charge, 1);
  const wall = st.props.find(p => p.kind === "ironwall");
  const atk = c.effectiveAtk(chuan, st.units);
  assert.equal(wall.shield, atk);
  const hp0 = wall.hp;
  c.hitBarrier(wall, foe, { atk: 3, mult: 1, element: "physical" });
  assert.ok(wall.shield < atk && wall.hp === hp0, "先打护盾");
  // 电能不到 3：没有这一步，只耗 1
  chuan.resources.charge = 2;
  assert.equal(c.skillFlowSteps("chuan_wall", chuan, {}).length, 0);
});

test("磁场盾：atk+1d4 护盾；多耗 1 电能再加川川等级", () => {
  const { c, st } = field(["chuan", "nora"]);
  const chuan = c.findKit("chuan", st.units);
  const bili = c.spawnWeapon(chuan, "bili");
  bili.zone = 1; bili.ap = 3;
  chuan.resources.charge = 3;
  const nora = c.findKit("nora", st.units);
  const shieldOf = (u) => ((u.layers || []).find(l => l.type === "shield") || { current: 0 }).current;
  const s0 = shieldOf(nora);
  skill(c, bili, "bili_field", null, { boost: "boost" });
  const gained = shieldOf(nora) - s0;
  const batk = c.effectiveAtk(bili, st.units);
  assert.ok(gained >= batk + 1 + 6 && gained <= batk + 4 + 6, `护盾 ${gained}`);
  assert.equal(chuan.resources.charge, 1);
});

test("诺拉：温和对刺入目标治疗 1d6+等级；加压灌输 2d4+2；扯下不再要求残忍", () => {
  const { c, st, foe } = field(["nora", "chuan"]);
  const nora = c.findKit("nora", st.units);
  const chuan = c.findKit("chuan", st.units);
  nora.resources.mood = "gentle";
  c.setPierce(nora, chuan, []);
  chuan.layers.forEach(l => { l.current = 1; });
  const hp0 = c.totalHp(chuan);
  skill(c, nora, "nora_aa", chuan);
  const healed = c.totalHp(chuan) - hp0;
  assert.ok(healed >= 1 + 6 && healed <= 6 + 6, `治疗 ${healed}`);
  // 加压灌输：温和 2d4+2
  const vitas = c.spawnWeapon(nora, "vitas");
  vitas.zone = 1; vitas.ap = 3;
  chuan.layers.forEach(l => { l.current = 1; });
  const hp1 = c.totalHp(chuan);
  skill(c, vitas, "vitas_infuse", null);
  const h2 = c.totalHp(chuan) - hp1;
  assert.ok(h2 >= 4 && h2 <= 10, `灌输 ${h2}`);
  // 扯下：温和也能用
  c.setPierce(nora, foe, []);
  nora.resources.mood = "gentle"; vitas.resources.mood = "gentle";
  const fh = c.totalHp(foe);
  vitas.ap = 3;
  skill(c, vitas, "vitas_rip", null);
  assert.ok(c.totalHp(foe) < fh, "温和下也扯下了");
  assert.equal(c.piercedTarget(nora), null);
});

test("技能说明同步新版角色卡", () => {
  const c = H.load();
  const T = c.SkillText;
  assert.match(T.skillText("chuan_aa"), /电击伤害/);
  assert.match(T.skillText("chuan_whip"), /能量伤害.*拉至敌人同区域/);
  assert.match(T.skillText("chuan_pulse"), /自身施加蓄能/);
  assert.match(T.skillText("bili_field"), /atk\+1d4/);
  assert.match(T.kitInfo("chuan").assistAttack, /重斩/);
  assert.match(T.skillText("nora_aa"), /1d6\+等级/);
  assert.match(T.skillText("vitas_infuse"), /2d4\+2/);
  assert.doesNotMatch(T.skillText("vitas_rip"), /残忍/);
});
