// #385：开局就存在的火场不会一上来就变成两层
// （以前开战时结算第 1 回合的回合开始效果，火场烧完照常 +1：开战前布置的 1 层火场，我方第一次行动时已经是 2 层）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function setup(opt) {
  const c = H.load();
  c.BattleSim.setup(Object.assign({ party: ["kolt", "helu"], enemies: [{ id: "thug_hammer", lv: 1, zone: 2, race: "人类" }], seed: "I385" }, opt || {}));
  const st = c.S.state;
  return { c, st, foe: st.units.find(u => !u.isPlayer), log: () => st.logPages.flatMap(p => p.lines.map(l => l.text)).join("\n") };
}
/** 打完一整回合（我方回合 → 敌人回合 → 回合结束 → 下一回合开始） */
const round = c => { c.endPlayerTurn(); c.endEnemyTurn(); };

test("开局就存在的 1 层火场：整个第 1 回合都是 1 层（以前开战这一下就变 2 层），第 2 回合开始烧完才 +1", () => {
  const { c, st, foe, log } = setup();
  c.setZoneField(2, "fire");
  const h0 = c.totalHp(foe);
  c.startCombat();
  assert.equal(st.fields[2].fire, 1, "开战后还是 1 层");
  assert.equal(st.fields[2].fireOn, true);
  assert.ok(c.totalHp(foe) < h0, "开战时的回合开始效果照旧结算：站在火场里的照常按 1 层挨一次火");
  assert.match(log(), new RegExp(`${foe.name} 火场1层 `));
  assert.match(log(), /2 区火场先结算伤害；开局就存在的火场，开战这一下层数不涨 → 1/);
  assert.doesNotMatch(log(), /然后层数 \+/, "开战这一下没有 +1");
  round(c);
  assert.equal(st.fields[2].fire, 2, "第 2 回合开始按 1 层烧完 +1");
  assert.match(log(), /2 区火场先结算伤害，然后层数 \+1 → 2/);
  round(c);
  assert.equal(st.fields[2].fire, 3, "之后照常每回合 +1");
});

test("固有天气酷暑里的开局火场：开战后还是 1 层（以前一上来就 3 层），第 2 回合开始照常 +2", () => {
  const { c, st } = setup({ weather: "heat" });
  c.setZoneField(2, "fire");
  c.startCombat();
  assert.equal(st.weatherInnate, "heat");
  assert.equal(st.fields[2].fire, 1, "酷暑那 +1 也不在开战这一下加");
  round(c);
  assert.equal(st.fields[2].fire, 3, "第 2 回合开始 +1，酷暑再 +1");
});

test("主持人开战前布置成 3 层：第 1 回合还是 3 层、按 3 层烧；第 2 回合开始才变 4 层", () => {
  const { c, st, foe, log } = setup();
  c.setZoneField(2, "fire", { stacks: 3 });
  c.startCombat();
  assert.equal(st.fields[2].fire, 3);
  assert.match(log(), new RegExp(`${foe.name} 火场3层 `), "开战这一下照常按 3 层烧");
  round(c);
  assert.equal(st.fields[2].fire, 4);
});

test("单局的战场随机火场（遭遇的 features，第二采矿场的酷暑）：开战后还是 1 层", () => {
  const { c, st } = setup({ enemies: undefined, encounter: { zoneMode: 2, weather: "heat",
    enemies: [{ preset: "thug_hammer", zone: 2, race: "人类" }], features: [{ type: "field", what: "fire", zone: 2 }] } });
  const z = Object.keys(st.fields).find(k => c.fieldFireOn(st.fields[k]));
  assert.ok(z, "遭遇里带的火场摆上场了");
  assert.equal(st.fields[z].fire, 1);
  c.startCombat();
  assert.equal(st.fields[z].innate, true, "开战前就有的是固有场地");
  assert.equal(st.fields[z].fire, 1, "开战后还是 1 层（以前酷暑里一上来就 3 层）");
});

test("热座 / 联机走指令开战（startCombat 指令）：开局火场一样不涨层", () => {
  const { c, st } = setup();
  c.setZoneField(2, "fire");
  c.dispatch({ type: "startCombat" });
  assert.equal(st.combatStarted, true);
  assert.equal(st.fields[2].fire, 1);
});

test("图鉴（悬停说明也用这一份）的火场写明开局的火场开战时层数不涨", () => {
  const { c } = setup();
  const fire = c.codexEffectEntries().find(e => e.group === "field" && e.name === "火场");
  assert.match(fire.lines.join("\n"), /开局就存在的火场：开战时照常按层数结算伤害，但层数不涨，第 2 回合开始才 \+1/);
});

test("照旧：开战后才铺的火场，下一回合开始先按 1 层烧、再 +1；环境扫描激发也照常 +1", () => {
  const { c, st, foe } = setup();
  c.startCombat();
  assert.equal(c.setZoneField(2, "fire"), null);
  assert.equal(st.fields[2].fire, 1);
  const h0 = c.totalHp(foe);
  round(c);
  assert.ok(c.totalHp(foe) < h0, "回合开始照常烧");
  assert.equal(st.fields[2].fire, 2, "烧完 +1");
  c.tickFireField(2, []);
  assert.equal(st.fields[2].fire, 3, "不经过开战的结算（环境扫描激发火场）照常 +1");
});
