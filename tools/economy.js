// Roguelike 奎支经济验算
//
//   node tools/economy.js            默认：2 / 3 / 4 人队各跑 20 局
//   node tools/economy.js 50         每种队伍跑 50 局
//
// 做法：用真实的单局规则（rogue.js + rogue-data.js）走完四幕。
//   · 战斗一律判胜：每个敌人都按规则击杀（掉落、经验照常结算），这样测的是「经济」而不是「打不打得过」
//   · 任务：先做不耽误主线的支线，天数不够就做主线
//   · 商店与休整：先把接下来三次长休要的水和最便宜的食物买够，再补一个维修工具包
//   · 工匠：留够一次长休的钱之后，钱够就升级等级最低的武器
//   · 休息点、休整：补给够就长休，不够就短休 / 硬撑
// 输出每幕的收入、支出、长休能不能吃上、力竭、武器等级。
// 试别的数值：ECO_SET='{"smithPriceScale":0.25}' node tools/economy.js 40
"use strict";
const H = require("../tests/headless");

const RUNS = Number(process.argv[2]) || 20;
const STOCK_RESTS = 3;
// 试别的数值不用改文件：ECO_SET='{"lootByRank":{"minion":50,"elite":300,"boss":600}}' node tools/economy.js
const OVERRIDE = process.env.ECO_SET ? JSON.parse(process.env.ECO_SET) : null;
const PARTIES = {
  2: ["kolt", "helu"],
  3: ["kolt", "helu", "ras"],
  4: ["kolt", "helu", "ras", "chuan"]
};

function playRun(kits, seed) {
  const c = H.load();
  if (OVERRIDE) Object.assign(c.S.ROGUE_CONFIG, OVERRIDE);
  const R = c.Rogue, st = () => c.S.state;
  const run = R.newRun({ party: kits, seed });
  const shop = c.S.ROGUE_SHOP;
  const acts = {};
  const A = () => (acts[run.act] = acts[run.act] || {
    reward: 0, loot: 0, clientWaterMl: 0, clientFood: 0,
    spendWater: 0, spendFood: 0, spendUpgrade: 0, spendRepair: 0,
    longRests: 0, restNeeded: 0, restMissed: 0, maxHours: 0, battles: 0, tasks: 0,
    startKuizhi: Number(st().kuizhi) || 0, endKuizhi: 0, upgrades: 0, shops: 0, smiths: 0, campNoSupply: 0
  });
  const money = () => Number(st().kuizhi) || 0;
  const priceOf = (key) => shop.find(r => r.key === key).price;
  const hoursNow = () => c.Rogue.hoursAwake();

  /** 买够接下来三次长休的水和最便宜的食物，再补一个维修工具包 */
  function shopping(a) {
    const plan = R.restPlan(run);
    const needWater = Math.max(0, plan.water * STOCK_RESTS - c.ledgerWater());
    const needFood = Math.max(0, Object.values(plan.food).reduce((s, n) => s + n, 0) * STOCK_RESTS - R.supplies().foodTotal);
    const buy = (key) => { if (money() < priceOf(key)) return false; R.buy(run, key, 1); return true; };
    let w = needWater;
    while (w > 0) {
      const key = w >= 5000 ? "water_5000" : w > 500 ? "water_1000" : "water_500";
      const before = money();
      if (!buy(key)) break;
      a.spendWater += before - money();
      w -= key === "water_5000" ? 5000 : key === "water_1000" ? 1000 : 500;
    }
    for (let i = 0; i < needFood; i++) { const b = money(); if (!buy("food_liquid")) break; a.spendFood += b - money(); }
    if (c.bagCount("repair_kit") < 1) { const b = money(); if (buy("repair_kit")) a.spendRepair += b - money(); }
  }
  const weaponAvg = () => avg([].concat(...run.party.map(h => Object.values(h.weaponLevels))), x => x);

  for (let guard = 0; guard < 800 && run.stage !== "over"; guard++) {
    const a = A();
    a.maxHours = Math.max(a.maxHours, hoursNow());
    const pend = R.pendingChoices(run);
    if (pend.length) { const p = pend[0]; R.choose(run, p.kit, p.index, R.choiceOptions(run, p.kit, p.index)[0].value); continue; }
    if (run.stage === "board") {
      const side = run.board.findIndex(t => !R.taskBlocked(run, t) && !R.taskWarning(run, t));
      const task = side >= 0 ? run.board[side] : run.main;
      const pay = R.taskPay(run, task);
      a.clientWaterMl += pay.water;
      a.clientFood += Object.values(pay.items).reduce((s, n) => s + n, 0);
      R.acceptTask(run, side >= 0 ? side : "main");
      a.tasks++;
      continue;
    }
    if (run.stage === "task" || run.stage === "boss") {
      const node = run.stage === "task" ? R.currentNode(run) : { type: "boss" };
      const lastNode = run.stage === "task" && run.task.index === run.task.nodes.length - 1;
      const reward = lastNode ? run.task.reward.kuizhi : 0;
      if (node.type === "rest") {
        a.restNeeded++;
        if (R.canLongRest(run)) { a.longRests++; R.restAtNode(run, "long"); }
        else { a.restMissed++; R.restAtNode(run, "short"); }
        a.reward += reward;
        continue;
      }
      if (node.type === "shop") {
        a.shops++;
        shopping(a);
        R.leaveNode(run);
        a.reward += reward;
        continue;
      }
      if (node.type === "smith") {
        a.smiths++;
        const plan = R.restPlan(run);
        const reserve = plan.water * 1 + 300 * Object.values(plan.food).reduce((s, n) => s + n, 0);
        for (;;) {
          const opts = R.smithOptions(run).filter(o => !o.max).sort((x, y) => x.level - y.level || x.cost - y.cost);
          const o = opts[0];
          if (!o || money() - o.cost < reserve) break;
          R.upgradeWeapon(run, o.kit);
          a.spendUpgrade += o.cost; a.upgrades++;
        }
        R.leaveNode(run);
        a.reward += reward;
        continue;
      }
      // 战斗：一律判胜，敌人按规则击杀（掉落照常）
      const spec = R.battleSpec(run);
      c.BattleSim.setup(spec);
      c.startCombat();
      const before = money();
      c.S.state.units.filter(u => !u.isPlayer && !u.dead).forEach(u => {
        (u.layers || []).forEach(l => { l.current = 0; });
        c.settleEnemyKill(u, []);
      });
      a.loot += money() - before;
      a.battles++;
      const m0 = money();
      R.finishBattle(run, "win");
      a.reward += money() - m0;
      continue;
    }
    if (run.stage === "camp") {
      if (R.canShop(run)) shopping(a);
      a.restNeeded++;
      if (R.canLongRest(run)) a.longRests++; else { a.restMissed++; a.campNoSupply++; }
      R.camp(run);
      continue;
    }
    if (run.stage === "interlude") { a.endKuizhi = money(); a.weapons = weaponAvg(); R.nextAct(run); continue; }
    if (run.stage === "victory") { a.endKuizhi = money(); a.weapons = weaponAvg(); R.afterVictory(run, false); continue; }
  }
  A().endKuizhi = money();
  if (A().weapons == null) A().weapons = weaponAvg();
  const weapons = [].concat(...run.party.map(h => Object.values(h.weaponLevels)));
  return { acts, result: run.result, weapons, fallen: run.fallen.length };
}

function avg(list, f) { return list.length ? list.reduce((s, x) => s + f(x), 0) / list.length : 0; }
const r0 = (n) => Math.round(n);

for (const [size, kits] of Object.entries(PARTIES)) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(playRun(kits, `ECO-${size}-${i}`));
  const finished = runs.filter(r => r.result && r.result.win).length;
  console.log(`\n=== ${size} 人队（${kits.join("、")}）· ${RUNS} 局 · 通关 ${finished} 局 ===`);
  console.log("幕 | 商店 工匠 | 任务 战斗 | 收入：任务报酬 掉落 | 委托方给水ml 给食物 | 支出：水 食物 维修 升级(次) | 长休 吃上/需要 | 最高连续清醒h | 幕末余额 | 幕末武器平均等级");
  for (let act = 1; act <= 4; act++) {
    const rs = runs.map(r => r.acts[act]).filter(Boolean);
    if (!rs.length) continue;
    const f = (k) => r0(avg(rs, x => x[k]));
    console.log(`${act} | ${avg(rs, x => x.shops).toFixed(1)} ${avg(rs, x => x.smiths).toFixed(1)} | ${f("tasks")} ${f("battles")} | ${f("reward")} ${f("loot")} | ${f("clientWaterMl")} ${f("clientFood")} | ` +
      `${f("spendWater")} ${f("spendFood")} ${f("spendRepair")} ${f("spendUpgrade")}(${avg(rs, x => x.upgrades).toFixed(1)}) | ` +
      `${avg(rs, x => x.longRests).toFixed(1)}/${avg(rs, x => x.restNeeded).toFixed(1)} | ${f("maxHours")} | ${f("endKuizhi")} | ${avg(rs, x => x.weapons || 0).toFixed(1)}`);
  }
  console.log(`通关时武器平均等级 ${avg(runs, r => avg(r.weapons, x => x)).toFixed(1)}；结局：` +
    Object.entries(runs.reduce((m, r) => { const k = r.result ? r.result.text : "未结束"; m[k] = (m[k] || 0) + 1; return m; }, {})).map(([k, n]) => `${k} ×${n}`).join("；"));
}
