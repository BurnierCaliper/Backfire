// Roguelike 奎支经济验算
//
//   node tools/economy.js            默认：2 / 3 / 4 人队各跑 20 局
//   node tools/economy.js 50         每种队伍跑 50 局
//   ECO_SET='{"smithPriceScale":0.25}' node tools/economy.js 40     不改文件，临时换 ROGUE_CONFIG 里的数值试
//
// 做法：用真实的单局规则（rogue.js + rogue-data.js）走完四幕。
//   · 战斗一律判胜：每个敌人都按规则击杀（掉落、经验照常结算），这样测的是「经济」而不是「打不打得过」
//     不模拟攻击、受伤或回合数；评价经验固定 ×1，不发放虚构的速杀、无伤或评价额外经验。
//   · 任务：先做不耽误主线的支线，天数不够就做主线
//   · 分岔取第一条合法路线；检定由成功率最高的英雄尝试，无资格则绕过
//   · 偷袭概率达到 30% 时，生命比例最高的英雄守夜；遭遇战按同样的强制胜利模型结算
//   · 商店与休整：先把接下来三次长休要的水和最便宜的食物买够，再补一个维修工具包
//   · 诊所（休整时）：钱够就把改造率用满（一半装甲、一半护盾）；升级后上限变高，再补做一次。
//     诊所节点：血量低于六成的人治疗
//   · 工匠：留够一次长休的钱之后，钱够就升级等级最低的武器
//   · 休息点、休整：补给够就长休，不够就短休 / 硬撑
// 输出每幕的收入（任务报酬、掉落及其占比）、支出、长休能不能吃上、力竭、武器等级、改造花费。
"use strict";
const H = require("../tests/headless");

const STOCK_RESTS = 3;
const POLICY_VERSION = "economy-v2";
const WATCH_THRESHOLD = 0.3;
const PARTIES = {
  2: ["kolt", "helu"],
  3: ["kolt", "helu", "ras"],
  4: ["kolt", "helu", "ras", "chuan"]
};

function avg(list, f) { return list.length ? list.reduce((s, x) => s + f(x), 0) / list.length : 0; }
const r0 = (n) => Math.round(n);

function validateOverride(override, config) {
  if (override == null) return;
  function check(value, original, key) {
    if (typeof value === "number") {
      if (typeof original !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`ECO_SET.${key} 必须是有效非负数`);
    } else if (Array.isArray(value)) {
      if (!Array.isArray(original) || !value.length) throw new Error(`ECO_SET.${key} 必须是非空数组`);
      value.forEach((x, i) => check(x, original[Math.min(i, original.length - 1)], `${key}[${i}]`));
    } else if (value && typeof value === "object") {
      if (!original || typeof original !== "object" || Array.isArray(original)) throw new Error(`ECO_SET.${key} 格式不匹配`);
      for (const [k, v] of Object.entries(value)) {
        if (!Object.hasOwn(original, k)) throw new Error(`未知配置 ECO_SET.${key ? key + "." : ""}${k}`);
        check(v, original[k], key ? `${key}.${k}` : k);
      }
    } else if (typeof value !== typeof original || value === null) throw new Error(`ECO_SET.${key} 格式不匹配`);
  }
  if (!override || typeof override !== "object" || Array.isArray(override)) throw new Error("ECO_SET 必须是配置对象");
  check(override, config, "");
}

function applyOverride(config, override) {
  validateOverride(override, config);
  if (!override) return;
  // 保留旧版 ECO_SET 的顶层替换语义；嵌套对象必须完整，避免丢掉必要规则。
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const child of Object.keys(config[key])) {
        if (!Object.hasOwn(value, child)) throw new Error(`ECO_SET.${key} 缺少 ${child}（嵌套对象需要完整提供）`);
      }
    }
  }
  Object.assign(config, JSON.parse(JSON.stringify(override)));
}

function playRun(kits, seed, opt = {}) {
  const c = H.load();
  applyOverride(c.S.ROGUE_CONFIG, opt.override);
  const run = c.Rogue.newRun({ party: kits, seed });
  return simulateRun(c, run, opt);
}

/** 同样可对已建立的单局状态继续验算；不修改玩法配置或跳过未知状态。 */
function simulateRun(c, run, opt = {}) {
  const R = c.Rogue, st = () => c.S.state;
  const maxSteps = opt.maxSteps == null ? 900 : opt.maxSteps;
  if (!Number.isSafeInteger(maxSteps) || maxSteps <= 0) throw new Error("maxSteps 必须是正整数");
  const shop = c.S.ROGUE_SHOP;
  const acts = {};
  const mods = [];            // 每一次义体改造花了多少
  const restRequests = new Set();
  const A = () => (acts[run.act] = acts[run.act] || {
    openingKuizhi: Number(st().kuizhi) || 0, reward: 0, loot: 0, checkIncome: 0, clientWaterMl: 0, clientFood: 0,
    spendWater: 0, spendFood: 0, spendUpgrade: 0, spendRepair: 0, spendCyber: 0, spendHeal: 0,
    longRests: 0, restNeeded: 0, maxHours: 0, battles: 0, tasks: 0,
    endKuizhi: 0, upgrades: 0, cyberMods: 0, shops: 0, smiths: 0,
    routes: 0, checks: 0, checkSkips: 0, ambushes: 0, watchedRests: 0, gradeXpExtra: 0
  });
  const money = () => Number(st().kuizhi) || 0;
  const countNodeRest = (a) => {
    const key = `${run.taskNo}:${run.task.index}`;
    if (!restRequests.has(key)) { a.restNeeded++; restRequests.add(key); }
  };
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
  /** 在某位工匠那里：钱够（留够一次长休）就升级等级最低的武器 */
  function smithing(a, sid) {
    if (!sid) return;
    if (R.smithInfo(run, sid).needsIntro) R.introduceSmith(run, sid);
    for (;;) {
      const o = R.smithOptions(run, sid).filter(x => !x.max).sort((x, y) => x.level - y.level || x.cost - y.cost)[0];
      if (!o || money() - o.cost < reserve()) break;
      R.upgradeWeapon(run, o.kit, sid);
      a.spendUpgrade += o.cost; a.upgrades++;
    }
  }

  let steps = 0;
  for (; steps < maxSteps && run.stage !== "over"; steps++) {
    const a = A();
    a.maxHours = Math.max(a.maxHours, R.hoursAwake());
    const pend = R.pendingChoices(run);
    if (pend.length) {
      const p = pend[0], choices = R.choiceOptions(run, p.kit, p.index);
      if (!choices.length) throw new Error(`升级选择没有合法选项：${p.kit}/${p.index}`);
      R.choose(run, p.kit, p.index, choices[0].value);
      continue;
    }
    if (run.stage === "board") {
      // 任务板上来的工匠：挑最便宜的那位
      const sids = (run.smiths || []).slice().sort((x, y) => (R.smithQuote(run, x, 2) || {}).cost - (R.smithQuote(run, y, 2) || {}).cost);
      if (sids.length) { a.smiths++; smithing(a, sids[0]); }
      const side = run.board.findIndex(t => !R.taskBlocked(run, t) && !R.taskWarning(run, t));
      const task = side >= 0 ? run.board[side] : run.main;
      const pay = R.taskPay(run, task);
      a.clientWaterMl += pay.water;
      a.clientFood += Object.values(pay.items).reduce((s, n) => s + n, 0);
      R.acceptTask(run, side >= 0 ? side : "main");
      a.tasks++;
      continue;
    }
    if (run.stage === "task" && !R.currentNode(run)) {
      const choices = R.nodeChoices(run);
      if (!choices.length) throw new Error(`任务节点缺失且没有合法路线：${run.task && run.task.index}`);
      R.chooseNode(run, choices[0].i);
      a.routes++;
      continue;
    }
    if (run.stage === "task" || run.stage === "boss") {
      const node = run.stage === "task" ? R.currentNode(run) : { type: "boss" };
      const m0 = money();
      if (node.type === "rest" && !run.ambush) {
        countNodeRest(a);
        if (R.canLongRest(run)) {
          const watch = R.ambushChance(run) >= WATCH_THRESHOLD
            ? run.party.slice().sort((x, y) => {
              const a = R.heroView(run, x), b = R.heroView(run, y);
              return b.hp / b.hpMax - a.hp / a.hpMax;
            })[0].kit : null;
          R.restAtNode(run, "long", { watch });
          if (!run.ambush) { a.longRests++; if (watch) a.watchedRests++; }
        }
        else R.restAtNode(run, "short");
      } else if (node.type === "check") {
        const best = run.party.map(h => R.checkOdds(run, h.kit)).filter(Boolean).sort((x, y) => y.chance - x.chance)[0];
        const completedBefore = run.tasksDone || 0;
        const pay = R.taskPay(run, run.task).kuizhi;
        if (best && best.chance > 0) { R.attemptCheck(run, best.kit); a.checks++; }
        else { R.skipCheck(run); a.checkSkips++; }
        // 检定可成为已有存档/定向场景的任务末站；任务报酬和检定收入分开。
        const reward = (run.tasksDone || 0) > completedBefore ? pay : 0;
        a.reward += reward;
        a.checkIncome += money() - m0 - reward;
        continue;
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
        smithing(a, R.presentSmiths(run)[0]);
        const m1 = money();
        R.leaveNode(run);
        a.reward += money() - m1;
        continue;
      } else if (["battle", "elite", "boss"].includes(node.type) || (node.type === "rest" && run.ambush)) {
        // 战斗：一律判胜，敌人按规则击杀（掉落照常）
        const spec = R.battleSpec(run);
        if (!spec) throw new Error(`无法建立战斗：${node.type}`);
        const ambush = !!run.ambush;
        if (ambush) countNodeRest(a);
        c.BattleSim.setup(spec);
        c.startCombat();
        const before = money();
        c.S.state.units.filter(u => !u.isPlayer && !u.dead).forEach(u => {
          (u.layers || []).forEach(l => { l.current = 0; });
          c.settleEnemyKill(u, []);
        });
        a.loot += money() - before;
        a.battles++;
        const m1 = money();
        // 没有实战过程，不能用零回合/零受伤去领取速杀、无伤或评价经验。
        R.finishBattle(run, "win");
        if (ambush) { a.ambushes++; a.longRests++; }
        a.reward += money() - m1;
        continue;
      } else throw new Error(`未知任务节点：${node.type}`);
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
    throw new Error(`未知单局阶段：${run.stage}`);
  }
  if (run.stage !== "over" || !run.result) throw new Error(`经济验算未正常结束：${run.seed}，${run.stage}，已走 ${steps} 步`);
  A().endKuizhi = money();
  if (A().weapons == null) A().weapons = weaponAvg();
  const weapons = [].concat(...run.party.map(h => Object.values(h.weaponLevels)));
  if (c.__errors.length) throw new Error(`规则环境报错：${c.__errors.join(" | ")}`);
  return { seed: run.seed, policy: POLICY_VERSION, assumptions: { forceWin: true, gradeXpMult: 1, watchThreshold: WATCH_THRESHOLD,
    route: "first-legal", check: "highest-positive-odds", battleDamageSimulated: false },
    acts, result: run.result, weapons, mods, steps, levels: run.party.map(h => ({ kit: h.kit, level: h.level, xp: h.xp })) };
}

function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.length > 1 || (argv[0] != null && !/^\d+$/.test(argv[0]))) throw new Error("用法：node tools/economy.js [每种队伍的正整数局数]");
  const runsCount = argv[0] == null ? 20 : Number(argv[0]);
  if (!Number.isSafeInteger(runsCount) || runsCount <= 0) throw new Error("局数必须是正整数");
  let override = null;
  if (env.ECO_SET) {
    try { override = JSON.parse(env.ECO_SET); } catch (e) { throw new Error(`ECO_SET 不是有效 JSON：${e.message}`); }
    if (!override || typeof override !== "object" || Array.isArray(override)) throw new Error("ECO_SET 必须是配置对象");
  }
  console.log(`经济模型 ${POLICY_VERSION}：战斗全部强制胜利，不统计真实战斗胜率；评价经验 ×1，不发速杀/无伤/评价额外奖励。`);
  console.log("固定策略：第一条合法分岔；最高成功率检定（无资格则绕过）；偷袭概率≥30%时由生命比例最高英雄守夜。战斗不模拟伤害、行动消耗、持续回合效果、召唤或首领阶段变化。");
  console.log("经验包含基础击杀、任务奖励及已有遭遇战固定奖励；结果只代表这些经济模型假设，不代表真人成长或通关率。");
  console.log(`配置覆盖 ECO_SET：${JSON.stringify(override || {})}`);
  for (const [size, kits] of Object.entries(PARTIES)) {
    const runs = [];
    for (let i = 0; i < runsCount; i++) runs.push(playRun(kits, `ECO-${size}-${i}`, { override }));
    const finished = runs.filter(r => r.result && r.result.win).length;
    console.log(`\n=== ${size} 人队（${kits.join("、")}）· ${runsCount} 局 · 强制胜利模型完成 ${finished} 局 · 种子 ECO-${size}-0 至 ECO-${size}-${runsCount - 1} ===`);
    console.log("幕 | 到达样本 | 任务报酬 检定 掉落（占收入） | 补给：水 食物 | 诊所：改造(次) 治疗 | 工匠：升级(次) | 长休 吃上/需要（守夜/遭遇） | 最长清醒h | 该幕结束或终止余额 | 武器平均等级");
    for (const act of [...new Set(runs.flatMap(r => Object.keys(r.acts)))].map(Number).sort((a, b) => a - b)) {
      const rs = runs.map(r => r.acts[act]).filter(Boolean);
      if (!rs.length) continue;
      const f = (k) => r0(avg(rs, x => x[k]));
      const share = avg(rs, x => (x.reward + x.checkIncome + x.loot) ? x.loot / (x.reward + x.checkIncome + x.loot) : 0);
      console.log(`${act} | ${rs.length} | ${f("reward")} ${f("checkIncome")} ${f("loot")}（${Math.round(share * 100)}%） | ${f("spendWater")} ${f("spendFood")} | ` +
        `${f("spendCyber")}(${avg(rs, x => x.cyberMods).toFixed(1)}) ${f("spendHeal")} | ${f("spendUpgrade")}(${avg(rs, x => x.upgrades).toFixed(1)}) | ` +
        `${avg(rs, x => x.longRests).toFixed(1)}/${avg(rs, x => x.restNeeded).toFixed(1)}（${avg(rs, x => x.watchedRests).toFixed(1)}/${avg(rs, x => x.ambushes).toFixed(1)}） | ${f("maxHours")} | ${f("endKuizhi")} | ${avg(rs, x => x.weapons || 0).toFixed(1)}`);
    }
    const allMods = [].concat(...runs.map(r => r.mods));
    console.log(`每次义体改造平均花费 ${allMods.length ? r0(avg(allMods, x => x)) + `（${allMods.length} 次，最少 ${Math.min(...allMods)}，最多 ${Math.max(...allMods)}）` : "无样本"}；` +
      `结束时武器平均等级 ${avg(runs, r => avg(r.weapons, x => x)).toFixed(1)}；结局：` +
      Object.entries(runs.reduce((m, r) => { const k = r.result ? r.result.text : "未结束"; m[k] = (m[k] || 0) + 1; return m; }, {})).map(([k, n]) => `${k} ×${n}`).join("；"));
  }
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(`经济验算失败：${e.stack || e.message}`); process.exitCode = 1; }
}
module.exports = { playRun, simulateRun, main, applyOverride, PARTIES, POLICY_VERSION };
