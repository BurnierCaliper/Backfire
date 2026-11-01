// #548：夕夏「狂怒碾压」是投技，不能被协助格挡（主人 11/01 确认）；想让夕夏松手只能把她打倒或打晕，不能靠挡。
//   以前：碾压那一下（手动的第一下、每回合开始的自动碾压）和普通攻击一样，目标同区有人能协助格挡就先排进格挡队列，
//   crushOnce 拿回的是「等待协助格挡」，当成没碾到——抓不住（已经抓着的松手）；之后格挡结算，挡没挡住都和夕夏抓不抓无关了。
//   只要目标身边有一个手上有附赠、能协助格挡的人，狂怒碾压就永远抓不住。
//   PvE 里敌人的自动协助格挡（警卫队队长·牛、巡逻车；赤牙给自己挡）当场掷骰结算、不排队，不会被当成没碾到，但碾压会被它挡下。
//   现在：碾压带「不能格挡」的标记（flags.blockResolved，和首领机制这类写明不能格挡的一样，app.js · crushOnce），
//   不进格挡队列、不问协助格挡，敌人也不自动协助格挡，直接结算；打完以后目标没死、没失衡就抓住，死了或失衡就不抓（失衡可以接处决）。
//   夕夏濒死（倒地没起身）、晕眩、死了就不自动碾压，照旧（app.js · xiaAutoCrush）。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));
const lines = S => S.logPages.flatMap(p => p.lines).map(l => l.text);
const fatten = u => { u.layers = [{ type: "flesh", current: 3000, max: 3000, inner: true }]; };   // 碾不死
const crush = (c, x, t) => c.Commands.dispatch(plain({ type: "skill", actor: x.id, skill: "xia_crush", target: t.id }));

/** 决斗 2v2（Lv10、武器 5 级）：1 队夕夏 / 拉斯缪尔（先手，我方回合行动），2 队诺拉 / 绯秋（敌人回合行动）。
 *  夕夏、绯秋、诺拉都在 2 区，夕夏引擎开着；诺拉手上 1 个附赠，能替绯秋协助格挡 */
function duel() {
  const party = ["xia", "ras", "nora", "hiaki"];
  const c = H.load();
  c.BattleSim.setup({ party, enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "crush-probe" });
  const S = c.S.state;
  const [x, ras, nora, hiaki] = party.map(k => c.findKit(k, S.units));
  [x, ras, nora, hiaki].forEach(h => { h.level = 10; Object.keys(h.weaponLevels || {}).forEach(k => { h.weaponLevels[k] = 5; }); });
  c.Commands.dispatch({ type: "battle.duel", teams: { "1队": [x.id, ras.id], "2队": [nora.id, hiaki.id] } });
  const keep = c.Math.random;
  c.Math.random = () => 0.1;   // 抛硬币：1 队先手
  try { c.startCombat(); } finally { c.Math.random = keep; }
  x.zone = hiaki.zone = nora.zone = 2;
  x.ap = 5; x.bonus = 5; x.resources.engine = true;
  nora.bonus = 1;
  return { c, S, x, ras, nora, hiaki };
}
/** 诺拉能替绯秋协助格挡（前提：不改的话这一击会排进格挡队列） */
function canBlock(c, x, nora, hiaki) {
  assert.ok(c.eligibleBlockers(hiaki, { attackerId: x.id }).includes(nora), "前提：诺拉能替绯秋协助格挡");
}
/** 过到下一回合开始（1 队的回合开始时自动碾压）；中间 2 队的回合诺拉补满附赠、什么也不做 */
function nextRound(c, S, nora) {
  c.endPlayerTurn();
  assert.ok(nora.bonus >= 1, "诺拉手上有附赠");
  const from = lines(S).length;
  c.endEnemyTurn();
  return lines(S).slice(from).join("\n");
}

test("目标同区有能协助格挡的队友：手动碾压不问格挡、照常打中，没死没失衡就抓住（以前排进格挡队列、当成没碾到，永远抓不住）", () => {
  const { c, S, x, nora, hiaki } = duel();
  fatten(hiaki);
  canBlock(c, x, nora, hiaki);
  const hp = c.totalHp(hiaki), def = hiaki.def;
  const from = lines(S).length;
  crush(c, x, hiaki);
  const log = lines(S).slice(from).join("\n");
  assert.equal((S.blockQueue || []).length, 0, "不进格挡队列");
  assert.doesNotMatch(log, /等待协助格挡/, "不问协助格挡");
  assert.equal(nora.bonus, 1, "诺拉没花附赠去挡");
  assert.ok(c.totalHp(hiaki) < hp, "照常打中");
  assert.equal(hiaki.def, def - 2, "2 击破");
  assert.ok(!hiaki.stunned);
  assert.equal(x.resources.crushId, hiaki.id, "没死没失衡：抓住");
  assert.match(log, /夕夏 抓在 绯秋 身上/);
  assert.doesNotMatch(log, /没能碾到/);
});

test("回合开始的自动碾压：同区有人能格挡也不问格挡，照常打中、3 击破，没死没失衡继续抓着（以前排进格挡队列、当成没碾到而松手）", () => {
  const { c, S, x, nora, hiaki } = duel();
  fatten(hiaki);
  hiaki.def = hiaki.defMax = 30;   // 碾不进失衡
  nora.bonus = 0;                  // 第一下的时候诺拉手上没附赠：照常抓住
  crush(c, x, hiaki);
  assert.equal(x.resources.crushId, hiaki.id, "第一下抓住");
  const hp = c.totalHp(hiaki), def = hiaki.def;
  const log = nextRound(c, S, nora);   // 诺拉在 2 队的回合补到附赠
  assert.ok(x.resources.engine, "上一回合碾过，引擎开着");
  canBlock(c, x, nora, hiaki);
  assert.equal((S.blockQueue || []).length, 0, "不进格挡队列");
  assert.doesNotMatch(log, /等待协助格挡/, "不问协助格挡");
  assert.ok(c.totalHp(hiaki) < hp, "照常打中");
  assert.equal(hiaki.def, def - 3, "3 击破");
  assert.equal(x.resources.crushId, hiaki.id, "没死没失衡：继续抓着");
  assert.doesNotMatch(log, /没能碾到|松开了手/);
  assert.equal(x.ap, 0, "抓着期间照旧没有行动点");
});

test("自动碾压把目标打进失衡：松手，夕夏这一回合照常补到行动点，能接处决", () => {
  const { c, S, x, nora, hiaki } = duel();
  fatten(hiaki);
  hiaki.def = hiaki.defMax = 30;
  nora.bonus = 0;                  // 第一下的时候诺拉手上没附赠：照常抓住
  crush(c, x, hiaki);
  assert.equal(x.resources.crushId, hiaki.id, "第一下抓住");
  hiaki.def = 3;                   // 自动碾压的 3 击破正好打进失衡
  const log = nextRound(c, S, nora);   // 诺拉在 2 队的回合补到附赠
  canBlock(c, x, nora, hiaki);
  assert.equal((S.blockQueue || []).length, 0, "不进格挡队列");
  assert.doesNotMatch(log, /等待协助格挡/);
  assert.ok(hiaki.stunned, "被碾进失衡");
  assert.ok(!x.resources.crushId, "失衡：松手");
  assert.match(log, /绯秋 失衡，夕夏没能抓住/);
  assert.ok(x.ap >= 1, "松了手，这一回合照常补到行动点");
  assert.equal(c.skillTargetError(x, "xia_execute", hiaki) || null, null, "可以对失衡的绯秋用处决");
  const ap = x.ap;
  const from = lines(S).length;
  c.Commands.dispatch(plain({ type: "skill", actor: x.id, skill: "xia_execute", target: hiaki.id }));
  assert.equal(x.ap, ap - 1, "处决用掉 1 行动点");
  assert.match(lines(S).slice(from).join("\n"), /【夕夏】处决/);
});

test("守卫：抓着的时候夕夏被打晕，下回合开始不自动碾压（照旧）", () => {
  const { c, S, x, hiaki } = duel();
  fatten(hiaki);
  hiaki.def = hiaki.defMax = 30;
  x.resources.crushId = hiaki.id;
  c.endPlayerTurn();
  x.stunned = true; x.def = 0;     // 2 队的回合里夕夏被打晕
  const hp = c.totalHp(hiaki), def = hiaki.def;
  const from = lines(S).length;
  c.endEnemyTurn();
  const log = lines(S).slice(from).join("\n");
  assert.equal(c.totalHp(hiaki), hp, "晕眩时不碾");
  assert.equal(hiaki.def, def);
  assert.equal((S.blockQueue || []).length, 0);
  assert.doesNotMatch(log, /狂怒碾压|没能碾到|抓在/);
});

test("守卫：目标同区没人能格挡时和以前一样——手动碾压抓住、自动碾压 3 击破继续抓着", () => {
  const { c, S, x, nora, hiaki } = duel();
  fatten(hiaki);
  hiaki.def = hiaki.defMax = 30;
  nora.zone = 3;                   // 诺拉不在同区
  assert.equal(c.eligibleBlockers(hiaki, { attackerId: x.id }).length, 0, "前提：没人能替绯秋格挡");
  const hp0 = c.totalHp(hiaki);
  crush(c, x, hiaki);
  assert.ok(c.totalHp(hiaki) < hp0);
  assert.equal(hiaki.def, 28, "2 击破");
  assert.equal(x.resources.crushId, hiaki.id, "抓住");
  c.endPlayerTurn();
  const hp = c.totalHp(hiaki);
  c.endEnemyTurn();
  assert.ok(c.totalHp(hiaki) < hp, "自动碾压照常打中");
  assert.equal(hiaki.def, 25, "3 击破");
  assert.equal(x.resources.crushId, hiaki.id, "继续抓着");
  assert.equal((S.blockQueue || []).length, 0);
});

test("PvE：敌人的自动协助格挡（警卫队队长·牛）也挡不了狂怒碾压——手动、自动都直接打在目标身上（以前会被队长牛挡下、还反击 1 击破）", () => {
  for (const auto of [false, true]) {
    const c = H.load();
    c.BattleSim.setup({ party: ["xia", "kolt"], seed: "issue-548",
      enemies: [{ id: "captain_wolf", lv: 1, zone: 1 }, { id: "captain_ox", lv: 1, zone: 1 }] });
    c.startCombat();
    const S = c.S.state;
    const x = c.findKit("xia", S.units);
    const foe = S.units.find(u => u.kit === "captain_wolf"), ox = S.units.find(u => u.kit === "captain_ox");
    x.level = 11; x.zone = foe.zone = ox.zone = 1; x.ap = 5; x.bonus = 5; x.resources.engine = true;
    fatten(foe); foe.def = foe.defMax = 300;
    assert.ok(c.autoEnemyBlockers(foe, x).includes(ox), "前提：队长牛会替队长狼自动协助格挡");
    const oxDef = ox.def, xDef = x.def;
    const from = lines(S).length;
    const keep = c.Math.random;
    c.Math.random = () => 0;       // 格挡骰 d100 = 1：掷了就一定挡住
    try {
      if (auto) { x.resources.crushId = foe.id; c.beginRound([]); }
      else crush(c, x, foe);
    } finally { c.Math.random = keep; }
    const log = lines(S).slice(from).join("\n");
    const tag = auto ? "自动碾压" : "手动碾压";
    assert.doesNotMatch(log, /自动协助格挡/, tag + "：队长牛不出手");
    assert.ok(c.totalHp(foe) < 3000, tag + "：打在队长狼身上");
    assert.equal(foe.def, 300 - (auto ? 3 : 2), tag + "：击破照常");
    assert.equal(ox.def, oxDef, tag + "：队长牛没替它承受击破");
    assert.equal(x.def, xDef, tag + "：没有队长牛的反击");
    assert.equal(x.resources.crushId, foe.id, tag + "：没死没失衡，抓着");
  }
});

test("卡面、规则页（协助格挡 ·「谁能挡」）写明狂怒碾压是投技、不能被协助格挡", () => {
  const c = H.load();
  const card = c.SkillText.skillText("xia_crush");
  assert.match(card, /投技/);
  assert.match(card, /不能被协助格挡/);
  // 规则页 rulebook.js 不在 headless 的规则文件里，单独加载（和 tests/rulebook.test.js 一样）
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, "rulebook.js"), "utf8"), c, { filename: "rulebook.js" });
  const block = c.rulebookEntries().find(e => e.chapter === "block");
  const who = block.sections.find(s => s.title === "谁能挡").lines.join("\n");
  assert.match(who, /狂怒碾压.*投技/);
});
