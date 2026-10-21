const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless.js");

/** 一个带高能的敌人在拉斯缪尔的普攻里被打死：行动结束才自爆，同区还有一个队友挨余波 */
function boomSetup(he) {
  const c = H.load();
  c.BattleSim.setup({ party: ["ras", "kolt"], enemies: [{ id: "thug_hammer", lv: 1, zone: 2 }, { id: "thug_hammer", lv: 1, zone: 2 }], seed: "RHK" });
  c.startCombat();
  const st = c.S.state;
  const ras = c.findKit("ras", st.units);
  const [foe, mate] = st.units.filter(u => !u.isPlayer);
  ras.zone = 1; foe.zone = 2; mate.zone = 2; ras.ap = 3;
  foe.layers = [{ type: "flesh", current: 1, max: 20 }];
  foe.statuses = Object.assign({}, foe.statuses, { high: true });
  foe.highEnergy = he;
  mate.layers = [{ type: "flesh", current: 100, max: 100 }];
  st.attackerId = ras.id; st.targetId = foe.id;
  return { c, st, ras, foe, mate };
}

test("评分：行动结束才判的高能自爆，溢出分、余波分记给引发它的一方", () => {
  const { c, st, ras, foe, mate } = boomSetup(300);
  c.runSkill("ras_aa");
  assert.equal(foe.dead, true);
  assert.equal(mate.dead, true, "余波炸死了同区的队友");
  const parts = st.battleScore.parts;
  // 溢出：高能值 300 − 自爆时的生命，至少是一大笔（普攻本身的溢出只有个位数）
  assert.ok(parts.overkill >= 100, "高能自爆的溢出分有人拿：" + JSON.stringify(parts));
  // 余波打在队友身上的 100 点伤害算引发者的连带伤害
  assert.ok(st.battleStats[ras.id].dmg >= 100, "余波伤害记给拉斯缪尔：" + st.battleStats[ras.id].dmg);
  assert.equal(st.actionAcc, null, "行动结束后记账照样清掉");
});

test("评分：基准分里飞碟触灵本体不重复算腿的血量，只算击杀分", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "ufo_boss", lv: 1, zone: 2 }], seed: "UFO" });
  c.startCombat();
  const st = c.S.state;
  st.scoreSeen = {};
  const legs = st.units.filter(u => u.kit === "ufo_leg");
  const legHp = legs.reduce((a, u) => a + u.layers.reduce((s, l) => s + l.max, 0), 0);
  const expect = legHp * c.S.SCORE_RULES.dmg + legs.length * c.S.SCORE_RULES.kill.minion + c.S.SCORE_RULES.kill.boss;
  assert.equal(c.scorePar(), expect);
});

test("评分：基准分不算中立生物和「我方同阵营」的友军", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_hammer", lv: 1, zone: 2 }, { id: "dust_bug", lv: 1, zone: 2 }], seed: "PAR" });
  c.startCombat();
  const st = c.S.state;
  const [thug, bug] = st.units.filter(u => !u.isPlayer);
  assert.ok(c.isNeutralCreature(bug), "尘虫是中立生物");
  st.scoreSeen = {};
  const solo = c.scorePar();
  assert.equal(st.scoreSeen[bug.id], undefined, "中立生物不进基准分");
  assert.ok(st.scoreSeen[thug.id] > 0);
  // 友军：我方同阵营的敌人不算
  st.scoreSeen = {};
  st.playerAllies = [c.factionOf(thug)];
  assert.equal(c.scorePar(), 0, "同阵营友军不进基准分");
  st.playerAllies = [];
  st.scoreSeen = {};
  assert.equal(c.scorePar(), solo);
});
