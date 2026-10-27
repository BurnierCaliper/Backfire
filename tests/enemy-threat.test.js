// 后期敌人实际威胁模拟工具（tools/enemy-threat.js，issue #401）的冒烟测试：每种情况跑一两场，保证以后能跑、计数对得上、结果可复现
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const H = require("./headless");
const E = require("../tools/enemy-threat");

const unit = (kit, level, size, index) => ({ group: "unit", kit, level, size, index });
const fakeProvenance = { commit: "test", dirty: false, sourceHash: "0".repeat(64), node: process.version, command: "test" };

test("引入工具不会开始跑模拟", () => {
  const out = cp.execFileSync(process.execPath, ["-e", "require('./tools/enemy-threat');console.log('inert')"], { cwd: H.ROOT, encoding: "utf8", timeout: 5000 });
  assert.equal(out.trim(), "inert");
});

test("抽样计划：随机遭遇抽得到的全部敌人 × 等级 × 人数 × 场数，首领另算；参数拼错报错", () => {
  const kits = E.unitKits();
  assert.ok(kits.length >= 40, "单局随机遭遇抽得到的敌人都在");
  ["thug_knife", "captain_ox", "swarm", "crow", "rat_tyrant", "sewer_keeper", "watchcrow"].forEach(k => assert.ok(kits.includes(k), k));
  ["outlaw_king", "sand_aggregate", "ufo_boss", "dust_bug", "tube_worm"].forEach(k => assert.ok(!kits.includes(k), `${k} 是首领 / 中立生物，不进单一兵种`));
  const jobs = E.plan({ samples: 2, levels: [10, 20], sizes: [2, 4] });
  assert.equal(jobs.length, (kits.length + E.BOSSES.length) * 2 * 2 * 2);
  assert.deepEqual(E.plan({ samples: 1, levels: [20], sizes: [3], groups: ["boss"] }).map(j => j.kit), E.BOSSES.map(b => b.kit));
  assert.deepEqual(E.CONFIG.levels, [5, 10, 15, 20], "issue 要的 10 / 15 / 20 级，加 5 级当前期参照");
  assert.throws(() => E.parseArgs(["--sampels", "3"]), /Unknown argument/);
  assert.throws(() => E.parseArgs(["--kits", "nope"]), /Unknown kit/);
  assert.throws(() => E.parseArgs(["--sizes", "5"]), /Sizes/);
  assert.throws(() => E.parseArgs(["--groups", "nope"]), /Unknown group/);
});

test("单局里出现：照各幕区域、幕间的采矿场、下水道算", () => {
  const c = H.load(), acts = k => E.appearance(c, k).map(x => x.act);
  assert.deepEqual(acts("thug_knife"), [1, 5], "外城区：第 1 幕和额外的第 5 幕");
  assert.deepEqual(acts("ant_guard"), [2], "第一采矿场：第 2 幕的幕间选择");
  assert.deepEqual(acts("rat_biter"), [2, 3, 4, 5, 6], "下水道：带地图的幕间都能去");
  assert.deepEqual(E.appearance(c, "thug_knife")[1].levels, [16, 20]);
});

test("单一兵种：只放要测的敌人凑满 4 枚代币、敌我等级照写、中性战场；同一个序号各种敌人的队伍和战场一样；计数和游戏自己记的承伤一致；重跑一样", () => {
  const a = E.runJob(unit("thug_knife", 15, 3, 3)), b = E.runJob(unit("captain_ox", 15, 3, 3)), s = E.runJob(unit("swarm", 15, 3, 3));
  [a, b, s].forEach(r => assert.notEqual(r.outcome, "error", r.error));
  assert.deepEqual(a.enemies, ["thug_knife", "thug_knife", "thug_knife", "thug_knife"]);
  assert.deepEqual(b.enemies, ["captain_ox", "captain_ox"], "精英 2 枚代币一只：2 只");
  assert.equal(s.units, 12, "空投蜂群 3 只一组记 1 枚代币：4 组 12 只");
  [a, b, s].forEach(r => {
    assert.deepEqual(r.foeLevels, [15], "敌人全部是要测的等级（精英不 +1）");
    assert.ok(r.heroLevels.length === 3 && r.heroLevels.every(L => L === 15), "我方等级 = 敌人等级");
    assert.equal(r.weather, "none");
    assert.equal(r.dmg, r.direct + r.dot);
    assert.equal(r.dmg + r.friendly, r.takenGame, "伤害计数和游戏自己记的承伤（battleStats.taken）一致");
    assert.ok(r.tokenRounds > 0 && r.enemyPhases > 0 && r.heroTurns > 0);
  });
  assert.deepEqual([b.party, b.zoneMode], [a.party, a.zoneMode], "同一个序号：队伍、区制一样，只换敌人");
  assert.deepEqual(E.runJob(unit("thug_knife", 15, 3, 3)), a, "固定种子：重跑一样");
  assert.deepEqual(E.runJob(unit("thug_knife", 10, 3, 3)).party, a.party, "换等级队伍也一样");
});

test("没有出手方的伤害（燃烧瓶投手的灼烧）记在敌人名下；首领本体和随从分开记，赤牙带部队天气", () => {
  const rows = [0, 1, 2, 3].map(i => E.runJob(unit("riot_molotov", 20, 2, i)));
  rows.forEach(r => { assert.notEqual(r.outcome, "error", r.error); assert.equal(r.dmg + r.friendly, r.takenGame); });
  assert.ok(rows.some(r => r.dot > 0 && (r.status.burn || 0) > 0), "灼烧的伤害算进去，状态也数到了");
  const king = E.runJob({ group: "boss", kit: "outlaw_king", level: 15, size: 3, index: 4 });
  const chixia = E.runJob({ group: "boss", kit: "chixia", level: 15, size: 3, index: 4 });
  [king, chixia].forEach(r => { assert.notEqual(r.outcome, "error", r.error); assert.equal(r.dmg + r.friendly, r.takenGame); });
  ["bandit_boss", "thug_knife", "thug_hammer"].forEach(k => assert.ok(king.enemies.includes(k), `亡命之王带固定随从 ${k}`));
  assert.ok(king.kits.outlaw_king, "亡命之王自己的伤害单独一栏");
  assert.deepEqual(chixia.enemies, ["chixia"]);
  assert.equal(chixia.weather, "heat");
});

test("汇总、自动标记和报告", () => {
  const jobs = [unit("thug_knife", 5, 2, 0), unit("thug_knife", 20, 2, 0), unit("livesand", 5, 2, 0), unit("livesand", 20, 2, 0), { group: "boss", kit: "chixia", level: 20, size: 2, index: 0 }];
  const rows = jobs.map(E.runJob);
  rows.forEach(r => assert.notEqual(r.outcome, "error", r.error));
  const opt = { samples: 1, levels: [5, 20], sizes: [2], groups: E.GROUPS, kits: null };
  const report = E.buildReport(rows, opt, fakeProvenance);
  assert.deepEqual([...report.kits].sort(), ["livesand", "thug_knife"]);
  assert.deepEqual(report.bossKits, ["chixia"]);
  const s = report.summary["thug_knife|20|all"];
  assert.equal(s.n, 1);
  assert.ok(Math.abs(s.share - rows[1].dmg / rows[1].heroHp) < 1e-9, "整场伤害占比 = 伤害 ÷ 我方血量上限");
  assert.equal(report.paper.thug_knife[20].atk, 24, "纸面：狂徒（匕首）20 级 atk 5 + 19");
  const md = E.markdown(report);
  ["# 后期敌人实际威胁模拟（issue #401）", "总览：每个等级的中位数", "单局各幕", "20 级：各敌人的实际伤害", "20 级：击破与控场", "5 级（前期参照）", "等级变化", "首领", "自动标记"].forEach(t => assert.ok(md.includes(t), t));
  assert.match(md, /\|1\|外城区\|1–4\|/, "第 1 幕外城区：抽得到狂徒（匕首）");
  assert.doesNotMatch(md, /假设性对照/, "默认参数不写假设性对照");
  assert.doesNotMatch(md, /坚毅生命还剩|shpMax/, "报告里不写坚毅生命的剩余值");
});

test("假设性对照：--tokens 凑满几枚代币、--atk 乘敌人攻击力（只在模拟里）；默认参数和以前一样", () => {
  assert.deepEqual([E.parseArgs([]).tokens, E.parseArgs([]).atk], [4, 1]);
  assert.deepEqual([E.parseArgs(["--tokens", "6"]).tokens, E.parseArgs(["--atk", "1.5"]).atk], [6, 1.5]);
  assert.throws(() => E.parseArgs(["--tokens", "9"]), /Tokens/);
  assert.throws(() => E.parseArgs(["--atk", "0"]), /Atk/);
  assert.deepEqual(E.plan({ samples: 1, levels: [20], sizes: [2], kits: ["thug_knife"] })[0], unit("thug_knife", 20, 2, 0), "默认参数不写进每场，抽样计划和以前一样");
  assert.deepEqual(E.plan({ samples: 1, levels: [20], sizes: [2], kits: ["thug_knife"], tokens: 6, atk: 1.5 })[0], Object.assign(unit("thug_knife", 20, 2, 0), { tokens: 6, atk: 1.5 }));
  const six = E.runJob(Object.assign(unit("thug_knife", 20, 2, 1), { tokens: 6 }));
  assert.notEqual(six.outcome, "error", six.error);
  assert.equal(six.units, 6, "6 枚代币：杂兵 6 只");
  const ox = E.runJob(Object.assign(unit("captain_ox", 20, 2, 1), { tokens: 6 }));
  assert.equal(ox.units, 3, "精英 3 只");
  const base = E.runJob(unit("captain_ox", 20, 2, 1)), strong = E.runJob(Object.assign(unit("captain_ox", 20, 2, 1), { atk: 1.5 }));
  [base, strong].forEach(r => assert.notEqual(r.outcome, "error", r.error));
  assert.deepEqual(strong.party, base.party, "同一格：队伍一样");
  assert.ok(Math.abs(strong.foeAtk - base.foeAtk * 1.5) <= 0.5, `攻击力 ×1.5：${base.foeAtk} → ${strong.foeAtk}`);
  assert.equal(strong.dmg + strong.friendly, strong.takenGame, "乘了攻击力，计数照样和游戏自己记的承伤一致");
  const report = E.buildReport([strong], { samples: 1, levels: [20], sizes: [2], groups: ["unit"], kits: null, atk: 1.5 }, fakeProvenance);
  assert.match(E.markdown(report), /假设性对照：敌人攻击力 ×1\.5/);
});
