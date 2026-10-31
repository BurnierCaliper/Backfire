// PvP 平衡模拟工具（issue #491，tools/pvp-balance.js）：只测量、不改规则。
// 镜像对局（同一对阵容、同一个种子，只对调先后手）、「临时关掉」只改那一场自己的规则环境、同一场重跑结果一样、汇总的算法。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const vm = require("node:vm");
const H = require("./headless");
const P = require("../tools/pvp-balance");

test("引入工具不会开始模拟", () => {
  const out = cp.execFileSync(process.execPath, ["-e", "require('./tools/pvp-balance');console.log('inert')"], { cwd: H.ROOT, encoding: "utf8", timeout: 5000 });
  assert.equal(out.trim(), "inert");
});

test("抽样计划：每对阵容先后手各一场（同一个种子），两队角色不重复；同一个序号的阵容在各情况、各等级都一样", () => {
  const jobs = P.plan({ sizes: [1, 4], levels: [3, 18], pairs: 3, fixedPairs: 1, variants: ["base", "noLate"] });
  const random = jobs.filter(j => j.kind === "random");
  assert.equal(random.length, 2 * 2 * 2 * 3 * 2, "情况 × 人数 × 等级 × 对数 × 先后手");
  for (let i = 0; i < random.length; i += 2) {
    const [x, y] = [random[i], random[i + 1]];
    assert.deepEqual([x.first, y.first], ["a", "b"], "先后手对调");
    assert.equal(x.seed, y.seed, "同一个种子");
    assert.deepEqual([x.a, x.b, x.aTeam], [y.a, y.b, y.aTeam], "同一对阵容、同一边");
    assert.equal(new Set(x.a.concat(x.b)).size, x.size * 2, "两队角色不重复");
  }
  const same = (v, L) => random.filter(j => j.variant === v && j.level === L && j.size === 4).map(j => j.a.concat(j.b).join());
  assert.deepEqual(same("base", 3), same("noLate", 18), "阵容只看人数和序号");
  const fixed = jobs.filter(j => j.kind !== "random");
  assert.ok(fixed.length && fixed.every(j => j.variant === "base" && [1, 4].includes(j.size)), "固定阵容只跑现在的规则、只跑选中的人数");
});

test("临时关掉后手补偿只改那一场自己的规则环境；抛硬币由工具定先手", () => {
  const job = { kind: "random", variant: "noLate", size: 2, level: 10, index: 0, a: ["kolt", "helu"], b: ["hiaki", "tou"], seed: "T491", first: "b", aTeam: "1队" };
  const off = P.prepare(job);
  off.c.startCombat();
  assert.equal(off.S.pvpDuel.first, "2队", "B 队（2 队）先手");
  const bonus = x => Array.from(x.S.units.filter(u => u.isPlayer && ["kolt", "helu"].includes(u.kit)), u => u.bonus);
  assert.deepEqual(bonus(off), [0, 0], "关掉补偿：后手开局没有附赠");
  const on = P.prepare(Object.assign({}, job, { variant: "base" }));
  on.c.startCombat();
  assert.deepEqual(bonus(on), [1, 1], "现在的规则：后手开局 1 个附赠");
  assert.equal(vm.runInContext("PVP_DUEL_CFG.lateBonus", H.load()), 1, "别的规则环境（游戏本身）照旧是 1");
  const noStand = P.prepare(Object.assign({}, job, { variant: "noStand" })), rounds = P.prepare(Object.assign({}, job, { variant: "rounds" }));
  assert.equal(noStand.S.pvpDuel.stand, false, "不允许起身：决斗选项");
  assert.equal(rounds.S.pvpDuel.rounds, P.CONFIG.roundsLimit, "回合上限：决斗选项");
});

test("一场打完：同一场重跑结果一样，没有异常、自检通过；起身翻滚只挑相邻、能翻的区", () => {
  const job = { kind: "random", variant: "base", size: 1, level: 3, index: 0, a: ["kolt"], b: ["ruby"], seed: "T491-RUN", first: "a", aTeam: "1队" };
  const a = P.runJob(job), b = P.runJob(job);
  assert.deepEqual(a, b, "固定种子：结果一样");
  assert.ok(["F", "S", "D"].includes(a.w), "分出了结果：" + JSON.stringify(a));
  assert.ok(!a.err && !a.bugs, JSON.stringify(a));
  assert.ok(a.r >= 1, "打了至少一回合");
  const { c, S } = P.prepare(job);
  c.startCombat();
  const kolt = S.units.find(u => u.kit === "kolt"), ruby = S.units.find(u => u.kit === "ruby");
  kolt.zone = 2; ruby.zone = 2;
  const down = u => { (u.layers || []).forEach(l => { l.current = 0; }); u.dying = true; };
  down(ruby);
  const rz = c.standRollZones(ruby);
  assert.deepEqual(Array.from(rz).sort(), [1, 3]);
  assert.ok(rz.includes(P.rollPick(c, ruby, rz)), "远程（瑞比）和对手同区：翻到相邻区");
  ruby.dying = false;
  down(kolt);
  assert.equal(P.rollPick(c, kolt, c.standRollZones(kolt)), null, "近战（柯尔特）和对手同区：原地起身");
});

test("只改 AI 的对照「先手第一回合原地等」：先手的人第 1 回合够不着就不走过去，够得着照常打；后手、第 2 回合起照常；不在默认清单里", () => {
  assert.ok(!P.DEFAULT_VARIANTS.includes("hold") && P.VARIANTS.hold.hold, "默认不跑，单独出报告");
  assert.deepEqual(P.plan({ sizes: [1], levels: [3], pairs: 1, fixedPairs: 0 }).map(j => j.variant).filter((v, i, a) => a.indexOf(v) === i), P.DEFAULT_VARIANTS);
  const job = { kind: "random", variant: "hold", size: 2, level: 10, index: 0, a: ["kolt", "ruby"], b: ["hiaki", "helu"], seed: "T491-HOLD", first: "a", aTeam: "1队" };
  const { c, S, V, firstTeam } = P.prepare(job);
  c.startCombat();
  const unit = k => S.units.find(u => u.kit === k);
  const hold = P.duelPolicy(c, V, firstTeam), basic = P.duelPolicy(c, P.VARIANTS.base, firstTeam);
  assert.equal(hold.act(unit("ruby")), null, "先手第 1 回合够不着：原地等");
  assert.equal(typeof basic.act(unit("ruby")), "function", "现在的打法：走过去");
  unit("hiaki").zone = 2;
  assert.equal(typeof hold.act(unit("ruby")), "function", "够得着（距离 1）：照常打");
  unit("helu").ap = 1;   // 轮到后手自己的回合（先手的回合里后手没有行动点）
  assert.equal(typeof hold.act(unit("helu")), "function", "后手照常走过去");
  S.turnNo = 2;
  unit("hiaki").zone = 3;
  assert.equal(typeof hold.act(unit("kolt")), "function", "第 2 回合起照常走过去");
});

test("技能版（#538，--policy skill）：抽样计划带上打法；一场打完记下用了哪些技能、同一场重跑一样；沙盒里试跑的事不记进失衡 / 倒地 / 再起不能", () => {
  const jobs = P.plan({ sizes: [1], levels: [3], pairs: 1, fixedPairs: 0, variants: ["base"], policy: "skill" });
  assert.ok(jobs.length === 2 && jobs.every(j => j.policy === "skill"));
  assert.ok(P.plan({ sizes: [1], levels: [3], pairs: 1, fixedPairs: 0, variants: ["base"] }).every(j => !("policy" in j)), "普攻版的计划和以前一样");
  const job = Object.assign({}, jobs[0], { seed: "T538-ROW" });
  const a = P.runJob(job), b = P.runJob(job);
  assert.deepEqual(a, b, "固定种子：结果一样");
  assert.ok(["F", "S", "D"].includes(a.w) && !a.err && !a.bugs, JSON.stringify(a));
  assert.equal(a.p, "skill");
  assert.ok(a.dec > 0 && a.tr > 0 && Object.keys(a.use).length > 0, "记下了技能版做了什么：" + JSON.stringify(a.use));
  assert.ok(Object.values(a.nm).every(n => n.name && n.unit), "技能名（汇总进 report.skillNames，不写进 rows）");
  const { nm, ...kept } = a;
  const noNull = o => Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(o))).filter(([, v]) => v != null));   // 解包本来就不留空的项
  assert.deepEqual(P.unpackRow(JSON.parse(JSON.stringify(P.packRow(kept)))), noNull(kept), "新加的几项照样能打包 / 解包");
  // 沙盒（BattleSearch.sandbox）里发生的再起不能不记；真的发生才记
  const { c, S, rec } = P.prepare(Object.assign({}, job, { a: ["kolt"], b: ["ruby"] }));
  c.startCombat();
  const ruby = S.units.find(u => u.kit === "ruby");
  c.BattleSearch.sandbox(() => { c.pvpDuelKnockOut(c.unitById(ruby.id)); });
  assert.equal(rec.outs.length, 0, "试跑的不记");
  assert.ok(!ruby.pvpOut, "试跑完局面还回去了");
  c.pvpDuelKnockOut(ruby);
  assert.equal(rec.outs.length, 1, "真的发生才记");
});

test("遭遇战对照（--pve）：两种打法同一个种子各打一场；汇总胜率、回合、剩余血量", () => {
  const jobs = P.plan({ sizes: [1], levels: [3], pairs: 1, fixedPairs: 0, variants: ["base"], pve: 1 }).filter(j => j.kind === "pve");
  assert.equal(jobs.length, P.PVE_SCENARIOS.length * 2);
  const [x, y] = jobs.filter(j => j.id === "P1");
  assert.deepEqual([x.policy, y.policy, x.seed === y.seed], ["basic", "skill", true]);
  const r = P.runJob(x);
  assert.ok(["W", "L", "T"].includes(r.w) && r.k === "pve" && r.r >= 1 && r.hp >= 0 && r.hp <= 1, JSON.stringify(r));
  const s = P.pveSummary([{ k: "pve", id: "P1", p: "skill", w: "W", r: 4, hp: 0.5 }, { k: "pve", id: "P1", p: "skill", w: "L", r: 6, hp: 0 }, { k: "pve", id: "P1", p: "basic", w: "E" }]);
  assert.deepEqual([s["P1|skill"].n, s["P1|skill"].won, s["P1|skill"].rate, s["P1|skill"].rounds, s["all|skill"].n], [2, 1, 0.5, 5, 2]);
  assert.equal(s["P1|basic"].err, 1);
  assert.ok(!Object.keys(P.summarizeAll([{ k: "pve", id: "P1", p: "skill", w: "W" }])).length, "决斗的汇总不算遭遇战");
});

test("技能版 vs 普攻版对打（--h2h）：同一对阵容 4 场（先后手 × 哪一队用技能版都对调）；汇总只算分出胜负的", () => {
  const jobs = P.plan({ sizes: [1], levels: [3], pairs: 1, fixedPairs: 0, variants: ["base"], h2h: 1 }).filter(j => j.kind === "h2h");
  assert.deepEqual(jobs.map(j => j.first + j.swap), ["a0", "a1", "b0", "b1"]);
  assert.ok(jobs.every(j => j.seed === jobs[0].seed && j.a.join() === jobs[0].a.join()), "同一对阵容、同一个种子");
  const r = P.runH2h(jobs[1]);
  assert.ok(["X", "Y", "D"].includes(r.w) && r.k === "h2h" && r.x === 1 && r.dec > 0, JSON.stringify(r));
  const s = P.h2hSummary([{ k: "h2h", s: 1, w: "X", r: 3 }, { k: "h2h", s: 1, w: "Y", r: 5 }, { k: "h2h", s: 2, w: "X", r: 4 }, { k: "h2h", s: 2, w: "D", r: 10 }]);
  assert.deepEqual([s.all.n, s.all.dec, s.all.won, s[2].draws], [4, 3, 2, 1]);
  assert.ok(!Object.keys(P.summarizeAll([{ k: "h2h", s: 1, w: "X" }])).length, "决斗的汇总不算对打");
});

test("汇总：先手胜率只算分出胜负的场次，平局、超时、异常另列；差值带区间", () => {
  const row = (w, extra) => Object.assign({ v: "base", k: "random", s: 2, L: 10, i: 0, f: "a", w, r: 5 }, extra || {});
  const rows = [row("F", { st: "F", stR: 1, dn: "F", dnR: 2 }), row("F", { st: "S", stR: 2 }), row("S", { st: "S", stR: 1 }), row("D"), row("T"), row("E")];
  const s = P.summarize(rows);
  assert.deepEqual([s.n, s.errors, s.F, s.S, s.D, s.T], [6, 1, 2, 1, 1, 1]);
  assert.equal(s.firstRate, 2 / 3);
  assert.equal(s.drawRate, 1 / 5);
  assert.deepEqual([s.stag.n, s.stag.won], [3, 2], "先打出失衡的一方：赢 2 / 3");
  assert.deepEqual([s.stag.byFirst.n, s.stag.bySecond.n], [1, 2]);
  assert.deepEqual([s.down.n, s.down.won], [1, 1]);
  const all = P.summarizeAll(rows);
  assert.ok(all["base|random|2|10"] && all["base|random|all|all"]);
  const d = P.diff({ F: 60, S: 40, firstRate: 0.6 }, { F: 50, S: 50, firstRate: 0.5 });
  assert.ok(Math.abs(d.d - 0.1) < 1e-12 && d.ci[0] < 0.1 && d.ci[1] > 0.1);
});
