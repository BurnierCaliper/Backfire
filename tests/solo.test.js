// 单人模式：一名主角 + 三名伙伴；2 行动点、自己给自己协助格挡 / 协助攻击、支援技能、第二副职责、额外成长
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = (x) => JSON.parse(JSON.stringify(x));

function soloRun(seed, opt) {
  const c = H.load();
  const run = c.Rogue.newRun(Object.assign({ party: ["ruby"], partners: ["kolt", "yuito", "tou"], role2: "生存", solo: true, seed: seed || "SOLO" }, opt || {}));
  return { c, run, R: c.Rogue, st: c.S.state };
}
/** 摆一场单人战斗（和单局一样走 battleSpec），返回主角 */
function soloBattle(c, run, enemies) {
  const R = c.Rogue;
  R.acceptTask(run, "main");
  run.task.nodes[run.task.index] = { type: "battle", done: false };
  const spec = R.battleSpec(run);
  if (enemies) { delete spec.encounter; spec.enemies = enemies; }
  c.BattleSim.setup(spec);
  c.startCombat();
  const st = c.S.state;
  return { st, hero: c.findKit(run.party[0].kit, st.units) };
}

test("开单人局：只带 1 名角色、3 名不重复的伙伴、一个角色卡上没有的第二副职责", () => {
  const { run } = soloRun();
  assert.equal(run.solo, true);
  assert.equal(run.party.length, 1);
  assert.deepEqual(plain(run.partners), ["kolt", "yuito", "tou"]);
  assert.equal(run.party[0].role2, "生存");
  const c = H.load();
  const bad = (o) => assert.throws(() => c.Rogue.newRun(Object.assign({ party: ["ruby"], partners: ["kolt", "yuito", "tou"], role2: "生存", solo: true }, o)));
  bad({ partners: ["kolt", "yuito"] });
  bad({ partners: ["kolt", "kolt", "tou"] });
  bad({ partners: ["ruby", "yuito", "tou"] });
  bad({ role2: "直伤" });          // 瑞比本来就是直伤专精
  bad({ party: ["ruby", "kolt"] });
  // 普通单局不受影响
  assert.equal(c.Rogue.newRun({ party: ["ruby", "kolt"] }).solo, false);
});

test("单人战斗：主角每回合 2 行动点；普通单局还是 1", () => {
  const { c, run } = soloRun();
  const { hero } = soloBattle(c, run, [{ id: "thug_knife", lv: 1, zone: 2 }]);
  assert.equal(hero.ap, 2);
  c.endPlayerTurn(); c.endEnemyTurn();
  assert.equal(hero.ap, 2, "下一回合也是 2");
  const c2 = H.load();
  const r2 = c2.Rogue.newRun({ party: ["ruby", "kolt"] });
  const b2 = soloBattle(c2, r2, [{ id: "thug_knife", lv: 1, zone: 2 }]);
  assert.equal(b2.hero.ap, 1);
});

test("单人战斗：可以给自己协助格挡、接自己打出的失衡做协助攻击；普通单局不行", () => {
  const { c, run } = soloRun();
  const { st, hero } = soloBattle(c, run, [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const foe = st.units.find(u => !u.isPlayer);
  hero.zone = 1; hero.bonus = 1;
  assert.ok(c.eligibleBlockers(hero).some(u => u.id === hero.id), "自己能格挡自己");
  assert.ok(c.eligibleAssisters(hero, foe).some(u => u.id === hero.id), "自己打出的失衡自己接");
  const c2 = H.load();
  const r2 = c2.Rogue.newRun({ party: ["ruby", "kolt"] });
  const b2 = soloBattle(c2, r2, [{ id: "thug_knife", lv: 1, zone: 1 }]);
  b2.hero.zone = 1; b2.hero.bonus = 1;
  assert.ok(!c2.eligibleBlockers(b2.hero).some(u => u.id === b2.hero.id));
  assert.ok(!c2.eligibleAssisters(b2.hero, b2.st.units.find(u => !u.isPlayer)).some(u => u.id === b2.hero.id));
});

test("支援：每 500 分一次，花 1 行动点；伙伴登场打一次协助攻击 +3 击破，然后退场，一场只能叫一次", () => {
  const { c, run } = soloRun();
  const { st, hero } = soloBattle(c, run, [{ id: "thug_hammer", lv: 3, zone: 2 }, { id: "thug_hammer", lv: 3, zone: 2 }]);
  const sk = c.skillList(hero).find(s => s.id === "solo_support");
  assert.ok(sk, "主角有支援技能");
  assert.match(c.skillRequirementError(hero, "solo_support"), /支援机会不足/);
  const [f1, f2] = st.units.filter(u => !u.isPlayer);
  const use = (kit, t) => {
    st.attackerId = hero.id; st.targetId = t.id;
    st.skillFlow = { id: "solo_support", actorId: hero.id, picks: { partner: kit, target: t.id }, index: 99 };
    try { c.runSkill("solo_support"); } finally { st.skillFlow = null; }
  };
  st.battleScore.total = 520;
  assert.equal(c.skillRequirementError(hero, "solo_support"), null);
  const n0 = st.units.length, hp0 = c.totalHp(f1), def0 = f1.def;
  use("tou", f1);
  assert.equal(hero.ap, 1, "花 1 行动点");
  assert.ok(c.totalHp(f1) < hp0, "伙伴打出了伤害");
  assert.equal(f1.def, def0 - 3, "追加 3 击破");
  assert.equal(st.units.length, n0, "伙伴退场");
  assert.ok(!st.units.some(u => u.isPartner));
  assert.deepEqual(plain(st.solo.used), ["tou"]);
  // 分数没再满 500：不能再用
  assert.match(c.skillRequirementError(hero, "solo_support"), /支援机会不足/);
  st.battleScore.total = 1100;
  // 用过的伙伴不能再叫
  const flowOpts = c.skillFlowSteps("solo_support", hero, {})[0].options.map(o => o.value);
  assert.deepEqual(plain(flowOpts), ["kolt", "yuito"]);
  const ap = hero.ap;
  use("tou", f2);
  assert.equal(hero.ap, ap, "选了用过的伙伴：不扣行动点");
  use("yuito", f2);
  assert.equal(hero.ap, ap - 1);
  assert.deepEqual(plain(st.solo.used), ["tou", "yuito"]);
});

test("支援的伙伴：等级、武器等级和主角一样；打完的嘲讽不留在场上", () => {
  const { c, run } = soloRun("SOLO2", { partners: ["kolt", "hiaki", "xia"] });
  run.party[0].level = 6;
  run.party[0].weaponLevels = { mint: 4 };
  const { st, hero } = soloBattle(c, run, [{ id: "thug_hammer", lv: 5, zone: 2 }]);
  assert.equal(st.solo.level, 6);
  assert.equal(st.solo.weaponLevel, 4);
  const p = c.soloSpawnPartner("kolt", 2);
  assert.equal(p.level, 6);
  assert.equal(p.weaponLevels.torque, 4);
  // 柯尔特的「过度自信」会嘲讽敌人；伙伴退场后嘲讽清掉
  st.battleScore.total = 600;
  const foe = st.units.find(u => !u.isPlayer);
  st.attackerId = hero.id; st.targetId = foe.id;
  st.skillFlow = { id: "solo_support", actorId: hero.id, picks: { partner: "kolt", target: foe.id }, index: 99 };
  try { c.runSkill("solo_support"); } finally { st.skillFlow = null; }
  assert.ok(!foe.tauntTo || st.units.some(u => u.id === foe.tauntTo), "嘲讽不能指向已经退场的伙伴");
});

test("单人成长：每场胜利额外 +50 经验；每 4 级多一次六维，每 5 级从第二副职责多学一个技能", () => {
  const { c, run, R } = soloRun();
  soloBattle(c, run, [{ id: "thug_knife", lv: 1, zone: 2 }]);
  R.finishBattle(run, "win");
  const h = run.party[0];
  assert.equal(h.xp, 50, "没击杀，只有固定的 50");
  // 一口气升到 10 级
  run.stage = "task";
  run.task.nodes[run.task.index] = { type: "battle", done: false };
  const spec = R.battleSpec(run);
  c.BattleSim.setup(spec);
  const u = c.findKit("ruby", c.S.state.units);
  u.xp = 99999;
  R.finishBattle(run, "win");
  assert.ok(h.level >= 10, "升到了 " + h.level);
  const pend = h.pending.map(p => p.type + "@" + p.level + (p.solo ? "s" : ""));
  ["attr@4s", "attr@8s", "role2@5", "role2@10", "attr@4", "attr@8"].forEach(k => assert.ok(pend.includes(k), k + " 不在 " + pend.join(",")));
  // 第二副职责：选技能一，之后的选项里就没有一了；学到的出现在技能栏
  const i = h.pending.findIndex(p => p.type === "role2");
  const opts = R.choiceOptions(run, "ruby", i);
  assert.deepEqual(plain(opts.map(o => o.value)), [1, 2, 3]);
  R.choose(run, "ruby", i, 1);
  assert.deepEqual(plain(h.role2Picks), [1]);
  const j = h.pending.findIndex(p => p.type === "role2");
  assert.deepEqual(plain(R.choiceOptions(run, "ruby", j).map(o => o.value)), [2, 3]);
  run.stage = "task";
  run.task.nodes[run.task.index] = { type: "battle", done: false };
  c.BattleSim.setup(R.battleSpec(run));
  const hero = c.findKit("ruby", c.S.state.units);
  assert.ok(c.skillList(hero).some(s => s.id === "role_firstaid"), "学到了生存一「应急处理」");
});

test("单人模式自动打一段：不报错，支援、成长都能走通", () => {
  const { c, run, R } = soloRun("SOLOAUTO", { party: ["kolt"], partners: ["ruby", "yuito", "tou"], role2: "生存" });
  for (let i = 0; i < 120 && run.stage !== "over"; i++) {
    const pend = R.pendingChoices(run);
    if (pend.length) { const p = pend[0]; R.choose(run, p.kit, p.index, R.choiceOptions(run, p.kit, p.index)[0].value); continue; }
    if (run.stage === "board") { R.acceptTask(run, "main"); continue; }
    if (run.stage === "camp") { R.camp(run); continue; }
    if (run.stage !== "task") break;
    const node = R.currentNode(run);
    if (node.type === "rest") R.restAtNode(run, "short");
    else if (["shop", "smith", "clinic"].includes(node.type)) R.leaveNode(run);
    else if (node.type === "check") R.skipCheck(run);
    else {
      c.BattleSim.setup(R.battleSpec(run));
      const r = c.BattleSim.run({ maxRounds: 30 });
      R.finishBattle(run, r.winner === "player" ? "win" : "lose");
    }
  }
  assert.deepEqual(c.__errors, []);
  assert.ok(run.party.length <= 1);
});
