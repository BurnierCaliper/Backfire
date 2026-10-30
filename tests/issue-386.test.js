// #386：狂怒碾压没被算进夕夏的攻击里，引擎会熄火。
//   规则：夕夏一回合没攻击，下回合开始引擎关闭（app.js · beginRound）。抓住敌人以后每回合开始自动再碾一次，
//   抓着期间拿不到行动点和附赠动作，这一回合「攻击过」全靠这一下。
//   以前：回合开始先碾、再判上一回合有没有攻击、判完清零——自动碾压记到了上一回合，这一回合等于没攻击。
//   抓着的目标在这一回合里被队友打死、在回合结束被灼烧烧死（松手了，下回合开始不再碾），夕夏整回合没法出手，
//   下回合开始就被判「一回合未攻击」熄火。自动碾压被废铁墙挡下时，dealTo 在记攻击之前就返回了，也没算上。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

/** 夕夏（11 级，引擎开着）在 1 区用狂怒碾压抓住刀手；柯尔特也在 1 区。2 区再放一个刀手，打死一个战斗也不结束 */
function grabbed() {
  const c = H.load();
  c.BattleSim.setup({ party: ["xia", "kolt"], seed: "issue-386",
    enemies: [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 2 }] });
  c.startCombat();
  const S = c.S.state;
  const x = c.findKit("xia", S.units), k = c.findKit("kolt", S.units);
  const foe = S.units.find(u => !u.isPlayer && Number(u.zone) === 1);
  x.level = 11; x.zone = k.zone = 1; x.ap = 5; x.bonus = 5;
  x.resources.engine = true;
  foe.layers = [{ type: "flesh", current: 3000, max: 3000, inner: true }];   // 碾不死
  foe.def = foe.defMax = 300;                                                // 也碾不进失衡
  c.Commands.dispatch(plain({ type: "skill", actor: x.id, skill: "xia_crush", target: foe.id }));
  assert.equal(x.resources.crushId, foe.id, "抓住了");
  return { c, S, x, k, foe };
}
const round = c => { c.endPlayerTurn(); c.endEnemyTurn(); };
const logText = S => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
const engineOffs = S => (logText(S).match(/夕夏一回合未攻击，引擎关闭/g) || []).length;

test("抓着的目标被队友打死：回合开始那一下自动碾压算这一回合的攻击，下回合开始引擎不熄火（以前熄火）", () => {
  const { c, S, x, k, foe } = grabbed();
  round(c);                                    // 第 2 回合开始：自动碾压
  assert.equal(x.resources.crushId, foe.id, "还抓着");
  assert.ok(c.totalHp(foe) < 3000, "碾到了");
  assert.equal(x.ap, 0, "抓着期间没有行动点，这一回合没法再出手");
  assert.ok(x.resources.attackedThisTurn, "回合开始的自动碾压记在这一回合");
  foe.layers[0].current = 1;                   // 柯尔特把它打死：夕夏松手
  c.dealTo(k, foe, { atk: 0, mult: 0, flat: 50, element: "physical", baseBreak: 0, atkRange: "any",
    flags: { action: true, blockResolved: true, block: "none" } });
  assert.ok(foe.dead);
  round(c);                                    // 第 3 回合开始：没有可碾的了
  assert.ok(!x.resources.crushId);
  assert.ok(x.resources.engine, "第 2 回合自动碾压过，引擎不熄火");
  assert.equal(engineOffs(S), 0);
  assert.ok(x.ap > 0, "松了手，这一回合照常有行动点");
  // 规则照旧：这一回合真的没攻击，下回合开始照常熄火
  round(c);
  assert.ok(!x.resources.engine, "一回合没攻击，引擎关闭");
  assert.equal(engineOffs(S), 1);
});

test("抓着的目标在回合结束被灼烧烧死：下回合开始引擎照样开着（以前熄火）", () => {
  const { c, S, x, foe } = grabbed();
  round(c);                                    // 第 2 回合开始：自动碾压
  assert.equal(x.resources.crushId, foe.id);
  foe.layers[0].current = 1;                   // 剩 1 点血，身上 1 层灼烧
  foe.statuses.burn = 1;
  round(c);                                    // 第 2 回合结束灼烧烧死它，第 3 回合开始没有可碾的了
  assert.ok(foe.dead, "被灼烧烧死");
  assert.ok(!x.resources.crushId, "松手");
  assert.ok(x.resources.engine, "第 2 回合自动碾压过，引擎不熄火");
  assert.equal(engineOffs(S), 0);
});

test("抓着时被打进晕眩：那一回合不自动碾压也没法出手，下回合开始才熄火（以前晕眩的那个回合开始就熄火，上一回合的自动碾压没算）", () => {
  const { c, S, x, foe } = grabbed();
  round(c);                                    // 第 2 回合开始：自动碾压
  c.endPlayerTurn();
  x.stunned = true; x.def = 0;                 // 敌人回合里夕夏被打进晕眩
  const hp = c.totalHp(foe);
  c.endEnemyTurn();                            // 第 3 回合开始：晕眩，不自动碾压
  assert.equal(c.totalHp(foe), hp, "晕眩时不碾");
  assert.ok(x.resources.engine, "第 2 回合自动碾压过，引擎不熄火");
  assert.equal(engineOffs(S), 0);
  round(c);                                    // 第 4 回合开始：第 3 回合晕眩着，没攻击
  assert.ok(!x.resources.engine, "一回合没攻击，引擎关闭");
  assert.equal(engineOffs(S), 1);
});

test("自动碾压被废铁墙挡下也算攻击过：连着两回合都被挡，引擎照样开着（以前第二回合熄火）", () => {
  const { c, S, x, foe } = grabbed();
  const hp = c.totalHp(foe);
  for (let i = 0; i < 2; i++) {
    c.endPlayerTurn();
    // 敌人回合立起废铁墙（回防命令）：撑过我方回合，下个敌人回合开始撤掉
    const wall = c.makeProp("scrapwall", 1, 1);
    wall.hp = wall.maxHp = 999;
    S.props.push(wall);
    c.endEnemyTurn();                                   // 回合开始自动碾压：废铁墙替刀手挨这一下
    assert.equal(x.resources.crushId, foe.id, "还抓着");
    assert.equal(c.totalHp(foe), hp, "这一下被废铁墙挡下了");
    assert.ok(wall.hp < 999, "废铁墙挨了这一下");
    assert.ok(x.resources.engine, `第 ${S.turnNo} 回合开始引擎还开着`);
  }
  assert.equal(engineOffs(S), 0);
});
