// 新敌人批量平衡模拟工具（tools/enemy-balance.js，issue #232）的冒烟测试：每组跑一两场，保证以后能跑、结果可复现
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const H = require("./headless");
const E = require("../tools/enemy-balance");

const one = (group, cell, variant, size) => E.plan({ samples: 1, sizes: [size || 2], groups: [group] }).find(j => j.cell === cell && j.variant === variant);

test("引入工具不会开始跑模拟", () => {
  const out = cp.execFileSync(process.execPath, ["-e", "require('./tools/enemy-balance');console.log('inert')"], { cwd: H.ROOT, encoding: "utf8", timeout: 5000 });
  assert.equal(out.trim(), "inert");
});

test("抽样计划：每格每种人数一个种子，同一格的对照组共用种子；五组都在", () => {
  const jobs = E.plan({ samples: 2 });
  assert.equal(jobs.length, 2 * 3 * (E.PAIRS.length * 2 + 4 + 2 + E.CAPTAINS.length * 2 + 2 + E.KING_RACES.length + 2));
  assert.deepEqual([...new Set(jobs.map(j => j.group))].sort(), E.GROUPS.slice().sort());
  const pair = jobs.filter(j => j.group === "template" && j.cell === "baton" && j.size === 3 && j.index === 1);
  assert.deepEqual(pair.map(j => j.variant), ["riot", "ref"]);
  assert.equal(pair[0].seed, pair[1].seed, "同一格的两个对照组用同一个种子");
  assert.equal(new Set(jobs.filter(j => j.group === "king" && j.index === 0 && j.size === 2).map(j => j.seed)).size, 1, "亡命之王各种族共用种子");
  assert.throws(() => E.parseArgs(["--sampels", "3"]), /Unknown argument/);
  assert.throws(() => E.parseArgs(["--groups", "nope"]), /Unknown group/);
});

test("兵种对照：同一种子两边的队伍、等级、战场一样，只换敌人；重跑结果完全一样", () => {
  const a = E.runJob(one("template", "baton", "riot")), b = E.runJob(one("template", "baton", "ref"));
  [a, b].forEach(r => assert.notEqual(r.outcome, "error", r.error));
  assert.deepEqual(a.party, b.party); assert.equal(a.level, b.level); assert.equal(a.zoneMode, b.zoneMode); assert.equal(a.weather, b.weather);
  assert.deepEqual(a.enemies, ["riot_baton", "riot_baton", "riot_baton", "riot_baton"]);
  assert.deepEqual(b.enemies, ["thug_hammer", "thug_hammer", "thug_hammer", "thug_hammer"]);
  assert.equal(a.vehicle, false, "兵种对照不带移动堡垒");
  assert.deepEqual(E.runJob(one("template", "baton", "riot")), a, "固定种子：重跑一样");
});

test("移动堡垒：必定有 / 必定没有两组抽到同样的敌人；有车的那组开局就有驾驶员，代挡等计数记下来", () => {
  const w = E.runJob(one("fortress", "battle", "with", 3)), o = E.runJob(one("fortress", "battle", "without", 3));
  [w, o].forEach(r => assert.notEqual(r.outcome, "error", r.error));
  assert.deepEqual(w.enemies.slice().sort(), o.enemies.slice().sort(), "掷骰次数不变：两组的遭遇一样");
  assert.equal(o.vehicle, false);
  assert.equal(w.vehicle, w.enemies.some(k => /^riot_/.test(k)), "有镇压队员就一定有车");
  assert.ok(Number.isFinite(w.cover) && Number.isFinite(w.blast) && Number.isFinite(w.steal));
});

test("种族被动开 / 关、亡命之王写死种族、酷暑：都能跑完，汇总和报告能生成", () => {
  const jobs = [one("race", "captain_ox", "on"), one("race", "captain_ox", "off"), one("king", "outlaw_king", "红皮人"), one("heat", "riot", "heat")];
  const rows = jobs.map(E.runJob);
  rows.forEach(r => assert.notEqual(r.outcome, "error", r.error));
  assert.ok(rows[2].races.includes("outlaw_king:红皮人"), "亡命之王按写死的种族上场");
  assert.equal(rows[3].weather, "heat");
  const S = E.summarizeAll(rows);
  assert.equal(S["race|captain_ox|on|all"].n, 1);
  const md = E.markdown({ options: { samples: 1, sizes: [2], groups: E.GROUPS }, provenance: { commit: "test", dirty: false, sourceHash: "0".repeat(64), node: process.version, command: "test" }, rows: rows.length, errors: 0, timeouts: 0, summary: S, flags: E.flags(S, [2]) });
  assert.match(md, /种族被动：开 ↔ 关/);
  assert.match(md, /亡命之王抽到各种族时的胜率/);
  assert.match(md, /差距大的格子/);
});
