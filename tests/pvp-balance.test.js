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
