// Flux Hold'em（#488）平分底池有多常见：AI 自对局统计（主人 10/30：试玩时统计一下 AI 自对局里平分的局占多少）。
// CLI：node tools/flux-holdem-stats.js [每种人数打几局，默认 200]
//   每种人数（2 / 3 / 4 人）各打 N 局，座位上的难度轮流换（简单 / 普通 / 困难），种子固定（同样的参数结果一样）。
//   报：打到亮牌的轮数、主池平分的轮数（占亮牌的、占全部轮数的）、有边池也算的平分轮数、至少平分过一次的局数；
//   相位全押的轮数、其中全押后同分滚到下一轮的轮数（主人 10/30：相位 = 全押；滚存的不算平分）。
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("../tests/headless");

const ROOT = path.resolve(__dirname, "..");
const LEVELS = ["easy", "normal", "hard"];

/** 加载规则（不带网页）：counter-cards.js + flux-holdem.js + flux-holdem-ai.js */
function load() {
  const c = H.load();
  for (const f of ["counter-cards.js", "flux-holdem.js", "flux-holdem-ai.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), c, { filename: f });
  return c;
}
/** 打 games 局 players 人的 AI 自对局，返回统计。opt.levels：固定每个座位的难度（不写就轮流换） */
function run(players, games, opt) {
  opt = opt || {};
  const c = opt.ctx || load(), X = c.FluxHoldem, AI = c.FluxHoldemAI;
  const t = { players, games: 0, rounds: 0, showdowns: 0, mainSplit: 0, anySplit: 0, foldWins: 0, gamesWithSplit: 0, splitWays: {}, allIns: 0, carried: 0 };
  for (let n = 0; n < games; n++) {
    const seats = Array.from({ length: players }, (_, i) => ({ id: "p" + (i + 1) }));
    const g = X.newGame({ seed: `${opt.seed || "split"}|${players}|${n}`, players: seats });
    const levels = {};
    seats.forEach((p, i) => { levels[p.id] = opt.levels ? opt.levels[i % opt.levels.length] : LEVELS[(n + i) % LEVELS.length]; });
    AI.playOut(g, levels);
    const s = X.splitStats(g);
    t.games += 1; t.rounds += s.rounds; t.showdowns += s.showdowns; t.mainSplit += s.mainSplit; t.anySplit += s.anySplit;
    t.foldWins += s.rounds - s.showdowns; t.allIns += s.allIns; t.carried += s.carried;
    if (s.mainSplit) t.gamesWithSplit += 1;
    g.results.filter(r => r.split).forEach(r => { const k = r.winners.length; t.splitWays[k] = (t.splitWays[k] || 0) + 1; });
  }
  const pct = (a, b) => (b ? Math.round(a / b * 1000) / 10 : 0);
  t.splitPerShowdown = pct(t.mainSplit, t.showdowns);
  t.splitPerRound = pct(t.mainSplit, t.rounds);
  t.gamesWithSplitPct = pct(t.gamesWithSplit, t.games);
  t.carriedPerAllIn = pct(t.carried, t.allIns);
  return t;
}
function main(argv = process.argv.slice(2)) {
  const n = Math.max(1, Math.floor(Number(argv[0]) || 200));
  const c = load();
  console.log(`Flux Hold'em 平分底池统计：每种人数 ${n} 局 AI 自对局（座位上的难度轮流换）`);
  for (const p of [2, 3, 4]) {
    const t = run(p, n, { ctx: c });
    console.log(`${p} 人：${t.rounds} 轮，打到亮牌 ${t.showdowns} 轮（其余 ${t.foldWins} 轮别人都弃牌）；主池平分 ${t.mainSplit} 轮 = 亮牌的 ${t.splitPerShowdown}%、全部轮数的 ${t.splitPerRound}%`
      + `（几人平分：${Object.keys(t.splitWays).map(k => `${k} 人 ${t.splitWays[k]} 轮`).join("、")}）；算上边池 ${t.anySplit} 轮；至少平分过一次的局 ${t.gamesWithSplit} / ${t.games}（${t.gamesWithSplitPct}%）；`
      + `相位全押 ${t.allIns} 轮，其中同分滚到下一轮 ${t.carried} 轮（${t.carriedPerAllIn}%）`);
  }
  return 0;
}
if (require.main === module) { try { process.exitCode = main(); } catch (e) { console.error(e.stack || e.message); process.exitCode = 1; } }
module.exports = { run, main, load };
