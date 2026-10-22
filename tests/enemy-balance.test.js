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
  assert.equal(jobs.length, 2 * 3 * (E.PAIRS.length * 2 + 2 * E.FORTRESS.length + 2 + E.CAPTAINS.length * 2 + 2 + E.KING_RACES.length + 2));
  assert.deepEqual(E.FORTRESS.map(v => v.id), ["with", "token", "without"], "移动堡垒三组：有车不占代币（旧规则）/ 有车占 1 枚代币（现在的规则）/ 没车");
  assert.deepEqual(E.FORTRESS.map(v => [v.appear, v.tokens]), [[1, 0], [1, 1], [0, 0]], "档位不变：出现概率、车占几枚代币都写死，不跟着游戏的默认值走");
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

test("移动堡垒：必定有车（不占代币 = 旧规则 / 占 1 枚代币 = 现在的规则）、必定没车三组同一个种子；旧规则和没车抽到同样的敌人；有车的那组开局就有驾驶员，代挡等计数记下来", () => {
  const jobs = E.plan({ samples: 1, sizes: [3], groups: ["fortress"] }).filter(j => j.cell === "battle");
  assert.deepEqual(jobs.map(j => j.variant), ["with", "token", "without"]);
  assert.equal(new Set(jobs.map(j => j.seed)).size, 1, "三组同一个种子（和 #232 的堡垒组也是同一批）");
  assert.equal(jobs[0].seed, "EB1021:fortress:battle:3:000");
  const [w, t, o] = jobs.map(E.runJob);
  [w, t, o].forEach(r => assert.notEqual(r.outcome, "error", r.error));
  assert.deepEqual(w.enemies.slice().sort(), o.enemies.slice().sort(), "掷骰次数不变：两组的遭遇一样");
  assert.equal(o.vehicle, false);
  assert.equal(w.vehicle, w.enemies.some(k => /^riot_/.test(k)), "有镇压队员就一定有车");
  assert.ok(Number.isFinite(w.cover) && Number.isFinite(w.blast) && Number.isFinite(w.steal));
  // 车占 1 枚代币（现在的规则，issue #243）：同一种子只差敌人，带车的遭遇少 1 枚代币的敌人
  assert.equal(w.vehicle, true, "这个种子带车");
  assert.deepEqual([t.party, t.level, t.zoneMode, t.weather, t.vehicle], [w.party, w.level, w.zoneMode, w.weather, true], "队伍、等级、区制、天气一样，也带车");
  // 游戏默认占 1 枚以后，旧规则那组照样按不占代币跑（重跑的数和 #235 的报告对得上）
  assert.deepEqual([w.tokens, t.tokens, o.tokens, w.vehicleTokens, t.vehicleTokens], [4, 3, 4, 0, 1], "旧规则（不占代币）4 枚 / 现在的规则（占 1 枚代币）3 枚 / 没车 4 枚");
  assert.ok(t.enemies.some(k => /^riot_/.test(k)), "镇压队至少留一个当驾驶员");
  // 汇总、配对、按出现率折算、报告
  const rows = [w, t, o], S = E.summarizeAll(rows);
  assert.deepEqual([S["fortress|battle|token|all"].tokens, S["fortress|battle|token|all"].vehicle.paid], [3, 1]);
  const F = E.fortressStats(rows, [3], 0.3), m = F.cells["battle|3"], win = r => (r.outcome === "win" ? 1 : 0);
  assert.equal(m.n, 1);
  assert.ok(Math.abs(m.now.mean - (0.3 * win(w) + 0.7 * win(o))) < 1e-9 && Math.abs(m.token.mean - (0.3 * win(t) + 0.7 * win(o))) < 1e-9, "旧规则 / 现在的规则都按 0.3 × 有车 + 0.7 × 没车 折算");
  assert.ok(Math.abs(m.gain.mean - 0.3 * (win(t) - win(w))) < 1e-9 && m.tokenVsWith.mean === win(t) - win(w));
  const md = E.markdown({ options: { samples: 1, sizes: [3], groups: ["fortress"], act: 1 }, provenance: { commit: "test", dirty: false, sourceHash: "0".repeat(64), node: process.version, command: "test" }, rows: 3, errors: 0, timeouts: 0, summary: S, fortress: F, flags: E.flags(S, [3]) });
  assert.match(md, /^# 移动堡垒占 1 枚代币的平衡补测/);
  assert.match(md, /\|3\|有车 · 不占代币（旧规则）\|/);
  assert.match(md, /\|3\|有车 · 占 1 枚代币（现在的规则）\|/);
  assert.match(md, /\|人数\|旧规则：车不占代币\|现在的规则：车占 1 枚代币\|差（百分点）\|/);
  assert.doesNotMatch(md, /游戏现在的规则|现状/, "不再把不占代币叫成游戏现在的规则");
  assert.match(md, /按 30% 出现率折算的镇压队遭遇平均胜率/);
  assert.match(md, /每场都退足了 1 枚/);
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
