// Roguelike 奎支经济验算
//
//   node tools/economy.js            默认：2 / 3 / 4 人队各跑 20 局
//   node tools/economy.js 50         每种队伍跑 50 局
//   ECO_SET='{"smithPriceScale":0.25}' node tools/economy.js 40     不改文件，临时换 ROGUE_CONFIG 里的数值试
//
// 做法：用真实的单局规则（rogue.js + rogue-data.js）走完四幕。
//   · 战斗一律判胜：每个敌人都按规则击杀（掉落、经验照常结算），这样测的是「经济」而不是「打不打得过」
//   · 任务：先做不耽误主线的支线，天数不够就做主线
//   · 商店与休整：先把接下来三次长休要的水和最便宜的食物买够，再补一个维修工具包
//   · 诊所（休整时）：钱够就把改造率用满（一半装甲、一半护盾）；升级后上限变高，再补做一次。
//     诊所节点：血量低于六成的人治疗
//   · 工匠：留够一次长休的钱之后，钱够就升级等级最低的武器
//   · 休息点、休整：补给够就长休，不够就短休 / 硬撑
// 输出每幕的收入（任务报酬、掉落及其占比）、支出、长休能不能吃上、力竭、武器等级、改造花费。
"use strict";
const H = require("../tests/headless");

const RUNS = Number(process.argv[2]) || 20;
const STOCK_RESTS = 3;
const OVERRIDE = process.env.ECO_SET ? JSON.parse(process.env.ECO_SET) : null;
const PARTIES = {
  2: ["kolt", "helu"],
  3: ["kolt", "helu", "ras"],
  4: ["kolt", "helu", "ras", "chuan"]
};

function avg(list, f) { return list.length ? list.reduce((s, x) => s + f(x), 0) / list.length : 0; }
const r0 = (n) => Math.round(n);

function playRun(kits, seed) {
  const c = H.load();
  if (OVERRIDE) Object.assign(c.S.ROGUE_CONFIG, OVERRIDE);
  const R = c.Rogue, st = () => c.S.state;
  const run = R.newRun({ party: kits, seed });
  const shop = c.S.ROGUE_SHOP;
  const acts = {};
  const mods = [];            // 每一次义体改造花了多少
  const A = () => (acts[run.act] = acts[run.act] || {
    reward: 0, loot: 0, clientWaterMl: 0, clientFood: 0,
    spendWater: 0, spendFood: 0, spendUpgrade: 0, spendRepair: 0, spendCyber: 0, spendHeal: 0,
    longRests: 0, restNeeded: 0, maxHours: 0, battles: 0, tasks: 0,
    endKuizhi: 0, upgrades: 0, cyberMods: 0, shops: 0, smiths: 0
  });
  const money = () => Number(st().kuizhi) || 0;
  const priceOf = (key) => shop.find(r => r.key === key).price;
  const reserve = () => {
    const plan = R.restPlan(run);
    return plan.water + 300 * Object.values(plan.food).reduce((s, n) => s + n, 0);
  };

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
  /** 改造率用满：一半装甲、一半护盾 */
  function cyberShopping(a) {
    run.party.forEach(h => {
      const info = R.cyberInfo(run, h.kit);
      const plan = { armor: Math.ceil(info.limit / 2), shield: Math.floor(info.limit / 2) };
      const pv = R.cyberPreview(run, h.kit, plan);
      if (pv.error || !pv.cost || money() - pv.cost < reserve()) return;
      R.modifyHero(run, h.kit, plan);
      a.spendCyber += pv.cost; a.cyberMods++; mods.push(pv.cost);
    });
  }
  const weaponAvg = () => avg([].concat(...run.party.map(h => Object.values(h.weaponLevels))), x => x);

  for (let guard = 0; guard < 900 && run.stage !== "over"; guard++) {
    const a = A();
    a.maxHours = Math.max(a.maxHours, R.hoursAwake());
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
      const m0 = money();
      if (node.type === "rest") {
        a.restNeeded++;
        if (R.canLongRest(run)) { a.longRests++; R.restAtNode(run, "long"); }
        else R.restAtNode(run, "short");
      } else if (node.type === "shop") {
        a.shops++;
        shopping(a);
        const m1 = money();
        R.leaveNode(run);
        a.reward += money() - m1;
        continue;
      } else if (node.type === "clinic") {
        run.party.forEach(h => {
          const v = R.heroView(run, h);
          const cost = R.healCost(run, h.kit);
          if (cost && v.hp < v.hpMax * 0.6 && money() - cost >= reserve()) { R.healHero(run, h.kit); a.spendHeal += cost; }
        });
        const m1 = money();
        R.leaveNode(run);
        a.reward += money() - m1;
        continue;
      } else if (node.type === "smith") {
        a.smiths++;
        for (;;) {
          const o = R.smithOptions(run).filter(x => !x.max).sort((x, y) => x.level - y.level || x.cost - y.cost)[0];
          if (!o || money() - o.cost < reserve()) break;
          R.upgradeWeapon(run, o.kit);
          a.spendUpgrade += o.cost; a.upgrades++;
        }
        const m1 = money();
        R.leaveNode(run);
        a.reward += money() - m1;
        continue;
      } else {
        // 战斗：一律判胜，敌人按规则击杀（掉落照常）
        c.BattleSim.setup(R.battleSpec(run));
        c.startCombat();
        const before = money();
        c.S.state.units.filter(u => !u.isPlayer && !u.dead).forEach(u => {
          (u.layers || []).forEach(l => { l.current = 0; });
          c.settleEnemyKill(u, []);
        });
        a.loot += money() - before;
        a.battles++;
        const m1 = money();
        R.finishBattle(run, "win");
        a.reward += money() - m1;
        continue;
      }
      a.reward += money() - m0;
      continue;
    }
    if (run.stage === "camp") {
      if (R.canShop(run)) shopping(a);
      if (R.canClinic(run)) cyberShopping(a);
      a.restNeeded++;
      if (R.canLongRest(run)) a.longRests++;
      R.camp(run);
      continue;
    }
    if (run.stage === "interlude") { a.endKuizhi = money(); a.weapons = weaponAvg(); R.nextAct(run); continue; }
    if (run.stage === "victory") { a.endKuizhi = money(); a.weapons = weaponAvg(); R.afterVictory(run, false); continue; }
  }
  A().endKuizhi = money();
  if (A().weapons == null) A().weapons = weaponAvg();
  const weapons = [].concat(...run.party.map(h => Object.values(h.weaponLevels)));
  return { acts, result: run.result, weapons, mods };
}

for (const [size, kits] of Object.entries(PARTIES)) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(playRun(kits, `ECO-${size}-${i}`));
  const finished = runs.filter(r => r.result && r.result.win).length;
  console.log(`\n=== ${size} 人队（${kits.join("、")}）· ${RUNS} 局 · 通关 ${finished} 局 ===`);
  console.log("幕 | 任务报酬 掉落（占收入） | 补给：水 食物 | 诊所：改造(次) 治疗 | 工匠：升级(次) | 长休 吃上/需要 | 最长清醒h | 幕末余额 | 武器平均等级");
  for (let act = 1; act <= 4; act++) {
    const rs = runs.map(r => r.acts[act]).filter(Boolean);
    if (!rs.length) continue;
    const f = (k) => r0(avg(rs, x => x[k]));
    const share = avg(rs, x => (x.reward + x.loot) ? x.loot / (x.reward + x.loot) : 0);
    console.log(`${act} | ${f("reward")} ${f("loot")}（${Math.round(share * 100)}%） | ${f("spendWater")} ${f("spendFood")} | ` +
      `${f("spendCyber")}(${avg(rs, x => x.cyberMods).toFixed(1)}) ${f("spendHeal")} | ${f("spendUpgrade")}(${avg(rs, x => x.upgrades).toFixed(1)}) | ` +
      `${avg(rs, x => x.longRests).toFixed(1)}/${avg(rs, x => x.restNeeded).toFixed(1)} | ${f("maxHours")} | ${f("endKuizhi")} | ${avg(rs, x => x.weapons || 0).toFixed(1)}`);
  }
  const allMods = [].concat(...runs.map(r => r.mods));
  console.log(`每次义体改造平均花费 ${r0(avg(allMods, x => x))}（${allMods.length} 次，最少 ${Math.min(...allMods)}，最多 ${Math.max(...allMods)}）；` +
    `通关时武器平均等级 ${avg(runs, r => avg(r.weapons, x => x)).toFixed(1)}；结局：` +
    Object.entries(runs.reduce((m, r) => { const k = r.result ? r.result.text : "未结束"; m[k] = (m[k] || 0) + 1; return m; }, {})).map(([k, n]) => `${k} ×${n}`).join("；"));
}
