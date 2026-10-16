// 长休结算画面（issue #52）：休息前后快照、每人的变化、守夜、补给；坚毅只给一句模糊的话，数值不给玩家
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function trpgField() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  c.S.TRPG.active = true;
  c.setLedgerWater(10000); c.bagAdd("food_can", 20);
  return c;
}

test("长休报告：血量、耐久前后，补给消耗，时间；守夜的人标出来且没恢复", () => {
  const c = trpgField();
  const k = c.findKit("kolt", c.S.state.units), h = c.findKit("helu", c.S.state.units);
  k.layers.forEach(l => { l.current = 1; });
  h.layers.forEach(l => { l.current = 1; });
  c.trpgLongRest({ hours: 8, watch: "helu" });
  const r = plain(vm.runInContext("TRPG.lastRest", c));
  assert.equal(r.ok, true);
  assert.equal(r.hours, 8);
  assert.ok(r.water > 0 && r.food > 0);
  const rk = r.heroes.find(x => x.kit === "kolt"), rh = r.heroes.find(x => x.kit === "helu");
  assert.ok(rk.hp[1] > rk.hp[0], "柯尔特回血");
  assert.equal(rh.watch, true);
  assert.equal(rh.hp[1], rh.hp[0], "守夜的人没恢复");
  assert.equal(r.watch, "Helumica");
  assert.ok(rk.mood.length > 0 && !/\d/.test(rk.mood), "坚毅只给一句话");
  assert.equal((r.to.clock - r.from.clock + 1440) % 1440, 8 * 60);
});

test("补给不够：报告写没能休息", () => {
  const c = trpgField();
  c.setLedgerWater(0);
  c.trpgLongRest({ hours: 8 });
  const r = plain(vm.runInContext("TRPG.lastRest", c));
  assert.equal(r.ok, false);
});

test("单局休息点长休：run.lastRest 记下报告；被偷袭打完再睡会写出来", () => {
  const c = H.load(), R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed: "RREST" });
  run.stage = "task"; run.task = { nodes: [{ type: "rest" }, { type: "battle" }], index: 0 }; run.taskNo = 1;
  run.ambushChance = 0;
  R.restAtNode(run, "long", {});
  assert.ok(run.lastRest && run.lastRest.ok);
  assert.ok(run.lastRest.heroes.every(h => typeof h.mood === "string"));
});

test("联机投影：跑团的 rest 包不带坚毅（数值、上限都不给），只带那一句", () => {
  const V = require("../online-view.js");
  const out = plain(V.projectRest({ id: "r1", ok: true, hours: 8, from: { day: 1, clock: 480 }, to: { day: 1, clock: 960 }, water: 2000, food: 4,
    exhaust: [1, 0], watch: "", heroes: [{ kit: "kolt", name: "柯尔特", hp: [1, 20], hpMax: 20, shp: [3, 8], shpMax: 8, mood: "睡得还行", secret: 9, weapons: [{ name: "扭矩", dur: [2, 6], max: 6 }] }] }));
  const s = JSON.stringify(out);
  assert.ok(!/shp|secret/.test(s), s);
  assert.equal(out.heroes[0].mood, "睡得还行");
  assert.deepEqual(out.heroes[0].hp, [1, 20]);
});

test("联机单局：rogue 里的 lastRest 经过 scrubHidden 去掉坚毅", () => {
  const V = require("../online-view.js");
  const out = plain(V.projectPacket({ type: "result", seq: 1, rogue: { lastRest: { id: "x", heroes: [{ name: "a", shp: [1, 2], shpMax: 9, mood: "m" }] } } }, { recipientId: "p1", gmId: "host" }));
  assert.ok(!/shp/i.test(JSON.stringify(out.rogue)), JSON.stringify(out.rogue));
  assert.equal(out.rogue.lastRest.heroes[0].mood, "m");
});

test("结算画面：玩家版不写坚毅数值，主持人版写", () => {
  require("../rest-report.js");
  const RR = globalThis.RestReport;
  const rep = { id: "a", ok: true, hours: 8, from: { day: 1, clock: 0 }, to: { day: 1, clock: 480 }, water: 1, food: 1, exhaust: [0, 0], watch: "",
    heroes: [{ name: "柯尔特", hp: [1, 2], hpMax: 2, shp: [3, 7], shpMax: 9, mood: "一夜无梦", weapons: [] }] };
  assert.ok(!/坚毅/.test(RR.html(rep, { gm: false })));
  assert.match(RR.html(rep, { gm: true }), /坚毅 3 → <b>7<\/b>\/9/);
  assert.match(RR.html(rep, { gm: false }), /一夜无梦/);
});

test("日月：白天 05:00–18:00 是太阳，其余是月亮；中午太阳在弧顶，日出在左、日落在右", () => {
  require("../rest-report.js");
  const RR = globalThis.RestReport;
  assert.equal(RR.skyPos(5 * 60).body, "sun");
  assert.equal(RR.skyPos(17 * 60 + 59).body, "sun");
  assert.equal(RR.skyPos(18 * 60).body, "moon");
  assert.equal(RR.skyPos(2 * 60).body, "moon");
  const dawn = RR.skyPos(5 * 60), noon = RR.skyPos(11 * 60 + 30), dusk = RR.skyPos(17 * 60 + 59);
  assert.ok(dawn.x < noon.x && noon.x < dusk.x);
  assert.ok(noon.y < dawn.y && noon.y < dusk.y, "中午最高");
  assert.notEqual(RR.skyColor(12 * 60), RR.skyColor(0), "天空颜色随时间变");
});

test("营地：全队状态和补给够不够；联机投影不带坚毅数值", () => {
  const c = trpgField();
  c.trpgCampOpen({ hours: 8 });
  const camp = plain(vm.runInContext("TRPG.camp", c));
  assert.ok(camp.status.heroes.length >= 2);
  assert.equal(camp.status.ok, true);
  assert.ok(camp.status.water.need > 0);
  assert.match(camp.status.heroes[0].mood, /^(精力充沛|还撑得住|疲惫|快撑不住了)$/);
  const V = require("../online-view.js");
  const out = plain(V.projectCamp(camp.status));
  assert.ok(!/shp/.test(JSON.stringify(out)));
  c.trpgLongRest(camp.plan);
  assert.equal(vm.runInContext("TRPG.camp", c), null, "长休完营地收起");
});
