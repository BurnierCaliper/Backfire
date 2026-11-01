// 下水道回声（作者 11/01）：在下水道打出的谐波攻击，打出它的那个技能在下一个整回合结束时对同一个目标自动、免费地整个再放一次。
// 敌我都算；回声不能格挡、不触发协助格挡，不受技能射程限制；目标到时候不在场就落空，出手的人死了照样打出；回声不再产生回声。
// 规则在 app.js · SEWER_ECHO / sewerEchoOpen / sewerEchoMark / sewerEchoClose / sewerEchoTurnEnd，接线见 runSkill / runSkillInner / dealToInner / spendAp / spendBonus / turnEnd
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");

/** 海露米卡（普通攻击：远距离 1atk 谐波）+ 柯尔特 对一个血厚、架势高的狂徒（打不死也打不进失衡）。两区，海露米卡 1 区、狂徒 2 区 */
function field(region, seed) {
  const c = H.load();
  c.BattleSim.setup({ party: ["helu", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], zoneMode: 2, seed: seed || "ECHO-1101", region });
  c.startCombat();
  const S = c.S.state;
  const helu = c.findKit("helu", S.units), kolt = c.findKit("kolt", S.units);
  const foe = S.units.find(u => !u.isPlayer);
  helu.zone = 1; kolt.zone = 2; foe.zone = 2;
  foe.layers = [{ type: "flesh", current: 500, max: 500 }]; foe.def = foe.defMax = 50;
  [helu, kolt].forEach(h => { h.ap = h.apMax = 4; h.bonus = h.bonusMax = 4; });
  return { c, S, helu, kolt, foe };
}
const hp = (c, u) => c.totalHp(u);
function use(c, S, a, t, skill) {
  S.attackerId = a.id; S.targetId = t ? t.id : null;
  c.runSkill(skill);
}
const logText = S => S.logPages.flatMap(p => p.lines).map(l => (typeof l === "string" ? l : l.text)).join("\n");

test("配置表：只在下水道、只算谐波、隔一个整回合", () => {
  const c = H.load();
  const cfg = vm.runInContext("SEWER_ECHO", c);
  assert.equal(cfg.region, "下水道");
  assert.equal(cfg.element, "harmonic");
  assert.equal(cfg.delayRounds, 1);
});

test("下水道里的谐波攻击：下一个整回合结束时整个技能再放一次，免费、不受射程限制，只回声一次", () => {
  const { c, S, helu, foe } = field("下水道");
  assert.equal(S.region, "下水道");
  const h0 = hp(c, foe);
  use(c, S, helu, foe, "helu_aa");
  const h1 = hp(c, foe);
  assert.ok(h1 < h0, "第 1 回合：普通攻击打中");
  assert.equal(S.sewerEchoes.length, 1, "排上了一次回声");
  c.turnEnd();   // 第 1 回合结束：还不回声
  assert.equal(hp(c, foe), h1, "第 1 回合结束：不回声");
  // 目标走到海露米卡同区：远距离的普通攻击本来打不到，回声不受射程限制
  foe.zone = 1;
  const ap = helu.ap, bonus = helu.bonus;
  c.turnEnd();   // 第 2 回合结束：回声
  const h2 = hp(c, foe);
  assert.ok(h2 < h1, "第 2 回合结束：回声又打了一次");
  assert.equal(helu.ap, ap, "回声不花行动点");
  assert.equal(helu.bonus, bonus, "回声不花附赠行动");
  assert.match(logText(S), /下水道回声：Helumica 的「普通攻击」在管道里回荡/);
  assert.equal(S.sewerEchoes.length, 0);
  c.turnEnd();   // 第 3 回合结束：回声本身不再回声
  assert.equal(hp(c, foe), h2, "回声不再产生回声");
});

test("不在下水道：谐波攻击不回声", () => {
  const { c, S, helu, foe } = field("外城区");
  use(c, S, helu, foe, "helu_aa");
  const h1 = hp(c, foe);
  assert.ok(h1 < 500);
  assert.equal((S.sewerEchoes || []).length, 0);
  c.turnEnd(); c.turnEnd();
  assert.equal(hp(c, foe), h1);
});

test("下水道里不是谐波的攻击不回声（柯尔特的电普攻）", () => {
  const { c, S, kolt, foe } = field("下水道");
  use(c, S, kolt, foe, "kolt_aa");
  const h1 = hp(c, foe);
  assert.ok(h1 < 500, "电普攻打中了");
  assert.equal(S.sewerEchoes.length, 0);
  c.turnEnd(); c.turnEnd();
  assert.equal(hp(c, foe), h1);
});

test("目标到时候已经不在场：回声落空；出手的人死了：照样打出", () => {
  const a = field("下水道");
  use(a.c, a.S, a.helu, a.foe, "helu_aa");
  a.c.turnEnd();
  a.foe.dead = true;
  assert.doesNotThrow(() => a.c.turnEnd());
  assert.match(logText(a.S), /下水道回声：Helumica 的「普通攻击」落空（目标已经不在场）/);
  assert.equal(a.S.sewerEchoes.length, 0);

  const b = field("下水道", "ECHO-1101-B");
  use(b.c, b.S, b.helu, b.foe, "helu_aa");
  const h1 = hp(b.c, b.foe);
  b.c.turnEnd();
  b.helu.dead = true;
  b.c.turnEnd();
  assert.ok(hp(b.c, b.foe) < h1, "海露米卡死了，回声照样打出");
});

test("敌人的谐波攻击也回声，回声不能格挡（第一下排进格挡队列，回声直接落下）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "sewer_sweeper", lv: 1, zone: 2 }], zoneMode: 2, seed: "ECHO-1101-E", region: "下水道" });
  c.startCombat();
  const S = c.S.state;
  const kolt = c.findKit("kolt", S.units), helu = c.findKit("helu", S.units);
  const sw = S.units.find(u => !u.isPlayer);
  kolt.zone = 1; helu.zone = 1; sw.zone = 2;
  kolt.layers = [{ type: "flesh", current: 300, max: 300 }];
  S.combatPhase = "enemy";
  use(c, S, sw, kolt, "en_sweeper_shot");
  assert.equal((S.blockQueue || []).length, 1, "第一下：同区的海露米卡能协助格挡，排进格挡队列");
  assert.equal(S.sewerEchoes.length, 1, "排进格挡队列的也算打出过");
  S.blockQueue = [];
  S.combatPhase = "player";
  c.turnEnd();
  const h1 = hp(c, kolt);
  c.turnEnd();
  assert.ok(hp(c, kolt) < h1, "回声打中柯尔特");
  assert.equal((S.blockQueue || []).length, 0, "回声不进格挡队列");
});

test("开新的一场：等着的回声清空", () => {
  const { c, S, helu, foe } = field("下水道");
  use(c, S, helu, foe, "helu_aa");
  assert.equal(S.sewerEchoes.length, 1);
  c.BattleSim.setup({ party: ["helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], zoneMode: 2, seed: "ECHO-1101-N", region: "下水道" });
  c.startCombat();
  assert.equal(c.S.state.sewerEchoes.length, 0);
});
