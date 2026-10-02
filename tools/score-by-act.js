// 按幕统计战斗得分：走单局的真实流程（Rogue.battleSpec：同样的遭遇、敌人等级、战场配置、天气），
// 用无界面模拟器的朴素打法打完，记下胜利时的最终得分（含速杀 / 无伤奖励）。
//
//   node tools/score-by-act.js [每格场数，默认 24]
//
// 假设（都写在这里，验算时可以改）：
//   · 角色等级 = 这场敌人的等级；武器等级 = round(角色等级 × 0.6)，1–10
//   · 队伍从 10 名角色里随机抽 2 / 3 / 4 人，满血开打；「1人」是单人模式（2 行动点，朴素打法不会用支援）
//   · 普通战斗、精英战取本幕第 1–8 天里随机一天的敌人等级；首领战用本幕上限等级
//   · 朴素打法：每回合挑能打的技能打、会协助格挡 / 协助攻击，但不会换招（吃招式疲劳）、不用道具
"use strict";
const H = require("../tests/headless");
const N = Number(process.argv[2]) || 24;
// 朴素打法几乎打不过第 4 幕首领，没有分数可看：这一格角色比首领高 2 级（表里标「+2级」）
const BOOST = { "4:boss": 2 };
const HEROES = ["ruby", "yuito", "hiaki", "tou", "xia", "chuan", "nora", "kolt", "helu", "ras"];

function rng(seed) { let s = 0; for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0; return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296); }

function one(act, kind, size, i) {
  const r = rng(`${act}:${kind}:${size}:${i}`);
  const pool = HEROES.slice(); const party = [];
  while (party.length < size) party.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  const c = H.load(); const R = c.Rogue;
  const run = size === 1
    ? R.newRun({ party, solo: true, seed: `SC${act}${kind}${size}-${i}`,
        partners: pool.splice(0, 3), role2: R.role2Options(party[0])[0] })
    : R.newRun({ party, seed: `SC${act}${kind}${size}-${i}` });
  run.act = act;
  let spec;
  if (kind === "boss") { run.actDay = 8; run.stage = "boss"; spec = R.battleSpec(run); }
  else {
    // 先在第 0 天接下主线（之后天数不够就接不了），再把天数拨到随机的一天
    run.actDay = 0;
    R.makeBoard(run); R.acceptTask(run, "main");
    run.actDay = Math.floor(r() * 8);
    run.task.nodes[run.task.index] = { type: kind, done: false };
    spec = R.battleSpec(run);
  }
  const lv = spec.level + (BOOST[`${act}:${kind}`] || 0);
  run.party.forEach(h => {
    h.level = lv;
    Object.keys(h.weaponLevels || {}).forEach(k => { h.weaponLevels[k] = Math.max(1, Math.min(10, Math.round(lv * 0.6))); });
  });
  c.BattleSim.setup(spec);
  const st = c.S.state;
  const res = c.BattleSim.run({ maxRounds: 30 });
  const win = res.winner === "player";
  const before = st.battleScore.total;
  if (win) c.applyFinishBonus();
  const g = c.battleGrade();
  return { act, kind, size, lv, win, score: st.battleScore.total, raw: before, fatigue: st.battleScore.parts.fatigue || 0,
    turns: st.turnNo, par: g.par, ratio: g.ratio, grade: g.grade, flawless: !!st.battleScore.flawless };
}

const q = (a, p) => { if (!a.length) return "-"; const s = a.slice().sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };
const mean = (a) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : "-";
const rows = [];
for (const act of [1, 2, 3, 4]) for (const kind of ["battle", "elite", "boss"]) for (const size of [1, 2, 3, 4]) {
  for (let i = 0; i < N; i++) { try { rows.push(one(act, kind, size, i)); } catch (e) { rows.push({ act, kind, size, err: e.message }); } }
}
const errs = rows.filter(r => r.err);
if (errs.length) console.log("出错", errs.length, errs[0].err);
const ok = rows.filter(r => !r.err);
const KIND = { battle: "普通", elite: "精英", boss: "首领" };
console.log(`每格 ${N} 场；分数只看胜利的场次（含速杀 / 无伤奖励）。p25 / 中位 / p75 / p90 是分位数。\n`);
console.log("幕 类型 人数 | 敌人等级 | 胜率 | 平均 | p25 | 中位 | p75 | p90 | 每人中位 | 回合中位 | 现基准中位 | 现评价分布");
for (const act of [1, 2, 3, 4]) {
  for (const kind of ["battle", "elite", "boss"]) for (const size of [1, 2, 3, 4]) {
    const g = ok.filter(r => r.act === act && r.kind === kind && r.size === size);
    const w = g.filter(r => r.win);
    const sc = w.map(r => r.score);
    const grades = ["S", "A", "B", "C"].map(x => x + w.filter(r => r.grade === x).length).join(" ");
    console.log(`${act} ${KIND[kind]}${BOOST[act + ":" + kind] ? "(+" + BOOST[act + ":" + kind] + "级)" : ""} ${size === 1 ? "单人" : size + "人"} | Lv${q(g.map(r => r.lv), 0)}–${q(g.map(r => r.lv), 0.99)} | ${w.length}/${g.length} | ${mean(sc)} | ${q(sc, .25)} | ${q(sc, .5)} | ${q(sc, .75)} | ${q(sc, .9)} | ${q(w.map(r => r.score / r.size), .5)} | ${q(w.map(r => r.turns), .5)} | ${q(w.map(r => r.par), .5)} | ${grades}`);
  }
  const all = ok.filter(r => r.act === act && r.win && r.size > 1);
  console.log(`${act} 全部（不含单人）          | 胜 ${all.length} | 平均 ${mean(all.map(r => r.score))} | 中位 ${q(all.map(r => r.score), .5)} | p75 ${q(all.map(r => r.score), .75)} | p90 ${q(all.map(r => r.score), .9)}\n`);
}
// 按类型汇总（不分人数）
console.log("按幕 × 类型汇总（2–4 人，不含单人）：平均 / 中位 / p75 / p90；括号里是不扣招式疲劳时的中位");
for (const act of [1, 2, 3, 4]) {
  console.log(`第 ${act} 幕：` + ["battle", "elite", "boss"].map(kind => {
    const w = ok.filter(r => r.act === act && r.kind === kind && r.win && r.size > 1);
    const sc = w.map(r => r.score);
    return `${KIND[kind]} ${mean(sc)} / ${q(sc, .5)} / ${q(sc, .75)} / ${q(sc, .9)}（${q(w.map(r => r.score + r.fatigue), .5)}）`;
  }).join("　"));
}
// 每人分（得分 ÷ 人数）：2–4 人基本成正比，适合当「每人基准 × 人数」
console.log("\n每人分（得分 ÷ 人数，2–4 人合在一起）：p25 / 中位 / p75 / p90");
for (const act of [1, 2, 3, 4]) {
  console.log(`第 ${act} 幕：` + ["battle", "elite", "boss"].map(kind => {
    const ph = ok.filter(r => r.act === act && r.kind === kind && r.win && r.size > 1).map(r => r.score / r.size);
    return `${KIND[kind]} ${q(ph, .25)} / ${q(ph, .5)} / ${q(ph, .75)} / ${q(ph, .9)}`;
  }).join("　"));
}
// 现在的评价为什么不稳：同一幕里「得分 / 基准」的离散程度
console.log("\n现在的评价（得分 ÷ 敌人基准）在每幕胜利场次里的分布：p10 / 中位 / p90 倍");
for (const act of [1, 2, 3, 4]) {
  const w = ok.filter(r => r.act === act && r.win && r.size > 1);
  const rs = w.map(r => r.ratio * 100);
  console.log(`第 ${act} 幕：${(q(rs, .1) / 100).toFixed(2)} / ${(q(rs, .5) / 100).toFixed(2)} / ${(q(rs, .9) / 100).toFixed(2)}　评价 ` + ["S", "A", "B", "C"].map(x => x + " " + w.filter(r => r.grade === x).length).join("，"));
}
