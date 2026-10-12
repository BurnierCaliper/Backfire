/* Roguelike command adapters. Rules remain in rogue.js; commands contain only data.
 * The authoritative run/session and local presentation callbacks live in context.
 * Queries listed here intentionally preserve legacy lazy writes and RNG consumption.
 */
const RogueCommands = (function () {
  "use strict";
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const needRun = (context) => {
    const run = context.run || (context.session && context.session.run);
    if (!run) throw new Error("没有进行中的单局");
    return run;
  };
  const needSession = (context) => {
    if (!context.session) throw new Error("缺少单局会话");
    return context.session;
  };
  const hero = (run, kit) => {
    const h = run.party.find(x => x.kit === kit);
    if (!h) throw new Error("队伍里没有这个角色");
    return h;
  };

  const actions = {
    acceptTask: (c, run) => Rogue.acceptTask(run, c.which),
    chooseNode: (c, run) => Rogue.chooseNode(run, c.index),
    restAtNode: (c, run) => c.mode === "long" ? Rogue.restAtNode(run, c.mode, { watch: c.watch || null, food: c.food, sleep: c.sleep, spit: c.spit, ammo: c.ammo }) : Rogue.restAtNode(run, c.mode),
    shortRestBeforeNode: (_c, run) => Rogue.shortRestBeforeNode(run),
    camp: (c, run) => Rogue.camp(run, { food: c.food, sleep: c.sleep, spit: c.spit, ammo: c.ammo }),
    buy: (c, run) => Rogue.buy(run, c.key, c.qty),
    introduceSmith: (c, run) => Rogue.introduceSmith(run, c.smith),
    upgradeWeapon: (c, run) => Rogue.upgradeWeapon(run, c.kit, c.smith),
    claimBlueprint: (c, run) => Rogue.claimBlueprint(run, c.smith, c.blueprint),
    installBlueprint: (c, run) => Rogue.installBlueprint(run, c.blueprint, c.kit, c.smith),
    buyPart: (c, run) => Rogue.buyPart(run, c.smith, c.index),
    sellPart: (c, run) => Rogue.sellPart(run, c.part),
    installPart: (c, run) => Rogue.installPart(run, c.kit, c.slot, c.part, c.smith),
    removePart: (c, run) => Rogue.removePart(run, c.kit, c.slot, c.smith),
    repairWeapon: (c, run) => Rogue.repairWeapon(run, c.kit),
    healHero: (c, run) => Rogue.healHero(run, c.kit),
    modifyHero: (c, run) => Rogue.modifyHero(run, c.kit, c.plan),
    attemptCheck: (c, run) => {
      const notes = Rogue.attemptCheck(run, c.kit, c.opt);
      const check = run.lastCheck;
      run.lastCheck = null;  // Same consumption as the old UI, before the animation.
      return { notes, check: check || null };
    },
    skipCheck: (_c, run) => Rogue.skipCheck(run),
    choose: (c, run) => Rogue.choose(run, c.kit, c.index, c.value),
    leaveNode: (_c, run) => Rogue.leaveNode(run),
    nextAct: (_c, run) => Rogue.nextAct(run),
    afterVictory: (c, run) => Rogue.afterVictory(run, c.goOn),
    finishBattle: (c, run) => Rogue.finishBattle(run, c.outcome)
  };
  const queries = {
    heroView: (c, run) => Rogue.heroView(run, hero(run, c.kit)),
    choiceOptions: (c, run) => Rogue.choiceOptions(run, c.kit, c.index),
    checkInfo: (c, run) => Rogue.checkInfo(run, c.opt),
    checkOdds: (c, run) => Rogue.checkOdds(run, c.kit, c.opt),
    cyberInfo: (c, run) => Rogue.cyberInfo(run, c.kit),
    cyberPreview: (c, run) => Rogue.cyberPreview(run, c.kit, c.plan),
    healCost: (c, run) => Rogue.healCost(run, c.kit),
    presentSmiths: (_c, run) => Rogue.presentSmiths(run),
    smithInfo: (c, run) => Rogue.smithInfo(run, c.smith),
    restPlan: (c, run) => Rogue.restPlan(run, { food: c.food, sleep: c.sleep, spit: c.spit, ammo: c.ammo }),
    restOptions: (c, run) => Rogue.restOptions(run, { food: c.food, sleep: c.sleep, spit: c.spit, ammo: c.ammo }),
    sheetData: (_c, run) => Rogue.sheetData(run),
    armoryData: (_c, run) => Rogue.armoryData(run),
    shopStock: (_c, run) => Rogue.shopStock(run),
    lowHpWarning: (_c, run) => Rogue.lowHpWarning(run),
    escortInfo: (_c, run) => Rogue.escortInfo(run, run.task),
    partOffers: (c, run) => Rogue.partOffers(run, c.smith),
    partStock: () => Rogue.partStock(),
    canSellParts: (_c, run) => Rogue.canSellParts(run),
    canShortRestBefore: (_c, run) => Rogue.canShortRestBefore(run),
    watchOptions: (_c, run) => Rogue.watchOptions(run)
  };
  const sessions = {
    readSaved() { return SaveStore.loadRun(); },
    // 存档的情况：none / ok / newer（更新版本的游戏存的，这一版读不了）/ broken。开新局前提醒会覆盖
    savedStatus() { return SaveStore.status("run"); },
    prepareParty(c, context) {
      const s = needSession(context);
      s.picked.length = 0;
      s.solo.on = !!c.solo; s.solo.hero = null; s.solo.partners = []; s.solo.role2 = null;
      return { solo: s.solo.on };
    },
    toggleHero(c, context) {
      const { picked, solo } = needSession(context), k = c.kit;
      if (!Rogue.heroPool().some(h => h.kit === k)) throw new Error("没有这个角色");
      if (solo.on) {
        if (solo.hero === k) { solo.hero = null; solo.role2 = null; }
        else if (solo.partners.indexOf(k) >= 0) solo.partners.splice(solo.partners.indexOf(k), 1);
        else if (!solo.hero) { solo.hero = k; solo.role2 = null; }
        else if (solo.partners.length < ROGUE_SOLO.partners) solo.partners.push(k);
      } else {
        const i = picked.indexOf(k);
        if (i >= 0) picked.splice(i, 1);
        else if (picked.length < SaveStore.PARTY_MAX) picked.push(k);
      }
      return { picked: picked.slice(), solo: { on: solo.on, hero: solo.hero, partners: solo.partners.slice(), role2: solo.role2 } };
    },
    chooseRole2(c, context) {
      const s = needSession(context);
      if (!s.solo.hero || !Rogue.role2Options(s.solo.hero).includes(c.role)) throw new Error("第二副职责不可选");
      s.solo.role2 = c.role;
      return { role: c.role };
    },
    newRun(c, context) {
      const s = needSession(context);
      const options = { party: c.party.slice(), seed: c.seed };
      if (c.solo) { options.solo = true; options.partners = c.partners.slice(); options.role2 = c.role2; }
      s.run = Rogue.newRun(options);
      return { seed: s.run.seed, solo: s.run.solo };
    },
    resume(_c, context) {
      const s = needSession(context), saved = SaveStore.loadRun();
      if (!saved) return { resumed: false };
      s.run = saved;
      Rogue.enterRunMode(s.run);
      return { resumed: true };
    },
    /** 联机单局：房主刷新页面后，从联机存档接回这一局 */
    adopt(c, context) {
      const s = needSession(context);
      if (!c.run || typeof c.run !== "object" || !Array.isArray(c.run.party)) throw new Error("没有可接回的单局");
      s.run = c.run;
      Rogue.enterRunMode(s.run);
      return { adopted: true };
    },
    save(_c, context) {
      const run = needRun(context);
      return { saved: run.stage !== "over" ? !!Rogue.save(run) : false };
    },
    leave(c, context) {
      const s = needSession(context);
      if (c.save && s.run) { if (s.run.stage !== "over") Rogue.save(s.run); Rogue.leaveRunMode(s.run); }
      else if (!c.save) Rogue.leaveRunMode(null);
      s.run = null;
      return { left: true };
    },
    finishRun(_c, context) {
      const run = needRun(context);
      if (run._counted) return { counted: false };
      run._counted = true;
      const meta = SaveStore.loadMeta();
      meta.stats.runs += 1;
      if (run.result && run.result.win) meta.stats.wins += 1;
      meta.stats.deaths += (run.fallen || []).length;
      SaveStore.saveMeta(meta);
      SaveStore.clearRun();
      return { counted: true };
    },
    startBattle(_c, context) {
      const run = needRun(context), spec = Rogue.battleSpec(run);
      if (!spec) return { started: false };
      if (typeof context.startBattle !== "function") throw new Error("缺少本地战斗入口");
      if (run.stage !== "over") Rogue.save(run);
      // spec.before and the local completion callback never enter a JSON command/result.
      context.startBattle(spec);
      return { started: true };
    },
    sandbox(_c, context) {
      Rogue.leaveRunMode();
      if (typeof context.setupBattle === "function") context.setupBattle();
      return { leftRunMode: true };
    }
  };
  function validate(table, c) {
    if (typeof c.action !== "string" || !own(table, c.action)) throw new Error("未知单局指令：" + c.action);
    if (c.index != null && (!Number.isInteger(c.index) || c.index < 0)) throw new Error("单局索引必须是非负整数");
    if (c.opt != null && (!Number.isInteger(c.opt) || c.opt < 0 || c.opt > 2)) throw new Error("检定选项必须是 0–2");
    if (c.action === "restAtNode" && !["long", "short", "leave"].includes(c.mode)) throw new Error("未知休息方式");
    const restMap = (m) => m == null || (typeof m === "object" && !Array.isArray(m) && Object.keys(m).every(k => typeof m[k] === "string"));
    if (!restMap(c.food) || !restMap(c.sleep) || !restMap(c.spit) || !restMap(c.ammo)) throw new Error("长休的食物 / 睡眠道具 / 吐酸属性 / 弹序选择格式不对");
    if (c.action === "finishBattle" && !["win", "lose", "retreat"].includes(c.outcome)) throw new Error("未知战斗结局");
    if (c.action === "afterVictory" && typeof c.goOn !== "boolean") throw new Error("必须明确是否继续额外幕");
    if (c.action === "newRun" && (!Array.isArray(c.party) || !c.party.every(k => typeof k === "string") || typeof c.seed !== "string" || !c.seed || (c.solo && !Array.isArray(c.partners)))) throw new Error("新局必须包含队伍和明确种子");
    return true;
  }
  Commands.register("run", (c, context) => actions[c.action](c, needRun(context)), { domain: "rogue", validate: c => validate(actions, c) });
  Commands.register("run.query", (c, context) => queries[c.action](c, needRun(context)), { domain: "rogue", validate: c => validate(queries, c) });
  Commands.register("run.session", (c, context) => sessions[c.action](c, context), { domain: "rogue", validate: c => validate(sessions, c) });
  return { actions: Object.keys(actions), queries: Object.keys(queries), sessionActions: Object.keys(sessions) };
})();
