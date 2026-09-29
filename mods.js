/* 角鳞 · 武器客制化图纸的战斗效果（单局专用）
 *
 * 图纸的数据在 rogue-data.js · ROGUE_SMITHS（每张图纸的 mod 字段），装在哪把武器上记在单局里；
 * 开战前 rogue.js 把「武器 kit → mod」写进 state.weaponMods，这里的函数在规则里各个时机读取。
 * 战斗原型、主持人计算器里 state.weaponMods 为空，所有函数都不起作用。
 *
 * 谁吃到图纸效果：角色拿着装了图纸的武器时作用在角色身上；武器人上场时作用在武器人身上
 * （ledger.js · unitWeaponMod）。
 *
 * mod 字段一览（都可以不写）：
 *   atk / atkPct         atk 加值 / 按比例（−0.25 = 减少四分之一）
 *   dur / bigKill        耐久上限加值 / 大杀器：耐久减半，减去的数值 +2 加到 atk 上
 *   def                  架势上限加值
 *   block                协助格挡成功率加值（%，格挡的人拿着这把武器）
 *   protectedBlock       自己被队友协助格挡时，格挡成功率加值（%）
 *   bonusPerRound        每回合额外附赠动作（角色拿着时）
 *   weaponApPerRound     每回合额外行动点（武器人形态）
 *   apPerRound / noBonus 每回合额外行动点 / 失去附赠动作
 *   meleeDice / rangedDice [n, s]  打近距离 / 远距离敌人时伤害掷骰 +nds
 *   meleeFlat            打近距离敌人时伤害加减
 *   attackDice           [n, s, 符号]  攻击时伤害 ±nds
 *   takenDice            [n, s]  承受伤害总是 +nds
 *   noAssistBlock / noAssistAttack  不能为别人协助格挡 / 不能发动协助攻击
 *   assistAtkPct         协助攻击伤害加成
 *   aggro / stealth      敌人更倾向于 / 显著不倾向于把你当目标（武器人形态带 stealth 一定不会被选中）
 *   healOnBlock          [n, s]  成功协助格挡后恢复生命
 *   autoRetreat          有敌人走进你所在的区时，自动移动到另一个区
 *   noPassive            放弃角色自身的被动效果（见 passiveOn）
 *   oppAttack            借机攻击单元：敌人离开你所在区时自动攻击 atk+1d6（武器属性）
 *   suppress             近距离压制单元：同区敌人 atk −N
 *   blockCleanse         团队协作单元：成功协助格挡时，被保护的队友清除负面状态
 *   firstBreakGuard      坚守阵地单元：第一次被击破架势时不触发敌人的协助攻击，并恢复 2 架势
 *   weaknessCap          被属性克制时，克制加成最多只算这么多（0.25）
 *   healBonus            [n, s]  受到和施加的治疗量都 +nds
 *   resistBreak          攻击属性效果不好时额外 +N 击破
 *   greatStatus          攻击属性效果绝佳时，有这个概率施加该属性的状态效果
 */

function bpMod(u) {
  return typeof unitWeaponMod === "function" ? (unitWeaponMod(u) || {}) : {};
}
function bpActive() {
  return !!(typeof state !== "undefined" && state.weaponMods && Object.keys(state.weaponMods).length);
}

/** 角色的被动效果是否生效（摩尔玛的 WAM-56 / MR-2165 会放弃角色自身的被动）。
 *  只要角色名下任何一把武器装了这类图纸就放弃，武器人上场时也一样（被动属于角色本人）。
 *  按作者的角色卡，十名角色的两个被动都接上了（放弃时按被动原文整个失效）：
 *    夕夏  启动引擎（引擎启动不了）/ 背水一战          川川  发电站（不积攒电能）/ 磁场护盾
 *    诺拉  冷气注射（没有额外冰伤和刺入）/ 双相冲动    瑞比  纳米科技（不获得纳米）/ 银翼（进不了机甲）
 *    结人  研磨机（豆子转不成咖啡液）/ 思念（没有牵挂）  绯秋  佩刀（鳴門不再 +1 击破）/ 剑术（一直拔刀）
 *    灯    决一死战 / 圣盾荣耀（没有圣盾点）            柯尔特 更换刀头（换不了）/ 过度自信
 *    Helumica 聚焦（聚焦不了）/ 环境监测（只是信息，没有战斗效果）
 *    拉斯缪尔 能量流向（不回收光能）/ 事故幸存（不累积能量，也就不会进不稳态） */
function passiveOn(u) {
  if (!u || !bpActive()) return true;
  let hero = u;
  if (u.weaponOf && typeof findKit === "function") hero = findKit(u.weaponOf, state.units) || u;
  const kits = [hero.kit].concat(hero.linkedKits || []);
  return !kits.some(k => state.weaponMods[k] && state.weaponMods[k].noPassive);
}
const passiveOnKit = (kit) => passiveOn(typeof findKit === "function" ? findKit(kit, state.units) : null);

/* ---------- 耐久与 atk ---------- */
/** 装了图纸后的耐久上限（base 是没装图纸时的上限） */
function bpDurMax(base, mod) {
  mod = mod || {};
  let d = Number(base) || 0;
  if (mod.bigKill) d -= Math.floor(d / 2);
  d += Number(mod.dur) || 0;
  return Math.max(1, d);
}
/** 大杀器：减去的耐久 +2 加在 atk 上 */
function bigKillAtk(kit) {
  if (typeof weaponDurBase !== "function") return 0;
  return Math.floor(weaponDurBase(kit) / 2) + 2;
}
/** effectiveAtk 用：在基础 atk 上套图纸（atk 加值、比例、大杀器）和同区敌人的「近距离压制」 */
function bpAtkAdjust(unit, base) {
  if (!bpActive() || !unit) return base;
  let atk = base;
  const mod = bpMod(unit);
  if (mod.atkPct) atk = Math.floor(atk * (1 + Number(mod.atkPct)));
  atk += Number(mod.atk) || 0;
  if (mod.bigKill) {
    const kit = unit.weaponOf ? unit.kit : (typeof heldWeaponKit === "function" ? heldWeaponKit(unit) : null);
    if (kit) atk += bigKillAtk(kit);
  }
  if (!unit.isPlayer) {
    const sup = (state.units || []).filter(u => u.isPlayer && !u.dead && !u.hidden && Number(u.zone) === Number(unit.zone))
      .reduce((m, u) => Math.max(m, Number(bpMod(u).suppress) || 0), 0);
    atk -= sup;
  }
  return Math.max(0, atk);
}

/* ---------- 架势上限（像震荡一样直接改 defMax，记下改了多少，换武器时对账） ---------- */
function syncBpDef(u) {
  if (!u) return;
  const want = Number(bpMod(u).def) || 0;
  const had = Number(u._bpDef) || 0;
  if (want === had) return;
  const before = Number(u.defMax) || 0;
  const after = Math.max(1, before + want - had);
  u._bpDef = had + (after - before);
  u.defMax = after;
  if ((Number(u.def) || 0) > u.defMax) u.def = u.defMax;
  if (after > before && !u.stunned) u.def = Math.min(u.defMax, (Number(u.def) || 0) + (after - before));
}
function syncBpAll() {
  if (typeof state === "undefined") return;
  (state.units || []).forEach(u => { if (u.isPlayer) syncBpDef(u); });
}

/* ---------- 行动点 / 附赠（refreshEconomy 里套上） ---------- */
function bpEconomy(u, eco) {
  const mod = bpMod(u);
  const weaponForm = typeof isWeaponUnit === "function" && isWeaponUnit(u);
  if (weaponForm) eco.ap += Number(mod.weaponApPerRound) || 0;
  else eco.bonus += Number(mod.bonusPerRound) || 0;
  eco.ap += Number(mod.apPerRound) || 0;
  if (mod.noBonus) eco.bonus = 0;
  return eco;
}

/* ---------- 伤害骰（dealTo 里套上） ---------- */
function bpDiceAdjust(attacker, target, flags) {
  const out = { value: 0, text: [] };
  if (!bpActive() || !flags || !flags.action) return out;
  const roll = (n, s, label, sign) => {
    const r = takeDice(n, s, 0);
    out.value += (sign || 1) * r.total;
    out.text.push(`${label} ${sign < 0 ? "−" : "+"}${n}d${s}〔${r.total}〕`);
  };
  const dist = attacker && target ? zoneDist(attacker.zone, target.zone, state.zoneMode) : 0;
  const am = attacker ? bpMod(attacker) : {};
  if (attacker && attacker.isPlayer) {
    if (am.meleeDice && dist === 0 && !target.isPlayer) roll(am.meleeDice[0], am.meleeDice[1], "狂徒浪漫");
    if (am.rangedDice && dist === 1 && !target.isPlayer) roll(am.rangedDice[0], am.rangedDice[1], "稳妥的距离");
    if (am.meleeFlat && dist === 0 && !target.isPlayer) { out.value += Number(am.meleeFlat); out.text.push(`稳妥的距离 ${am.meleeFlat}`); }
    if (am.attackDice) roll(am.attackDice[0], am.attackDice[1], "愿你无恙", am.attackDice[2] || -1);
  }
  const tm = target && target.isPlayer ? bpMod(target) : {};
  if (tm.takenDice) roll(tm.takenDice[0], tm.takenDice[1], "狂徒浪漫（承受）");
  return out;
}

/** 协助攻击的倍率（恶眼 +50%） */
function bpAssistMult(attacker, mult) {
  const pct = Number(bpMod(attacker).assistAtkPct) || 0;
  return pct ? (Number(mult) || 1) * (1 + pct) : mult;
}

/* ---------- 属性克制（engine.js · resolveAttack 里调用） ---------- */
function bpChartCap(t, cMod) {
  const cap = bpMod(t).weaknessCap;
  if (cap != null && cMod > cap) return cap;
  return cMod;
}

const BP_ELEMENT_STATUS = {
  fire: "burn", acid: "corr", electric: "shock", ice: "frostbite",
  energy: "high", physical: "shockwave", harmonic: "reso"
};
/** 愿你常胜：攻击后按属性效果追加击破 / 状态 */
function bpAfterAttack(attacker, target, res, flags, notes) {
  if (!bpActive() || !attacker || !target || !res || !flags || !flags.action) return;
  if (!attacker.isPlayer || target.isPlayer || target.dead || !res.startLayerType) return;
  const mod = bpMod(attacker);
  if (!mod.resistBreak && !mod.greatStatus) return;
  const cMod = chartMod(res.element, res.startLayerType, state.weather, null, false);
  if (mod.resistBreak && cMod < -0.001) {
    notes.push(`愿你常胜：属性效果不好，额外 +${mod.resistBreak} 击破。`);
    dealBreak(target, Number(mod.resistBreak), res.element, notes, "愿你常胜");
  }
  if (mod.greatStatus && cMod >= 0.5 && Math.random() < Number(mod.greatStatus)) {
    const key = BP_ELEMENT_STATUS[res.element];
    if (key) {
      target.statuses = target.statuses || {};
      if (key === "burn") target.statuses.burn = (Number(target.statuses.burn) || 0) + 1;
      else target.statuses[key] = true;
      if (key === "high") target.highApplyTurn = state.turnNo;
      if (typeof popStatus === "function") popStatus(target, key);
      notes.push(`愿你常胜：属性效果绝佳，对 ${target.name} 施加了状态。`);
    }
  }
}

/* ---------- 协助格挡 / 协助攻击 ---------- */
function bpCanAssistBlock(u) { return !bpMod(u).noAssistBlock; }
function bpCanAssistAttack(u) { return !bpMod(u).noAssistAttack; }
/** 格挡成功率加值：格挡者拿着的图纸 + 被保护者的「愿你无恙」 */
function bpBlockBonus(helper, protectedUnit) {
  let c = Number(bpMod(helper).block) || 0;
  if (protectedUnit && protectedUnit !== helper) c += Number(bpMod(protectedUnit).protectedBlock) || 0;
  return c;
}
const BP_NEGATIVE = ["burn", "shock", "corr", "frostbite", "shockwave", "high", "reso", "unstable", "weak"];
/** 成功协助格挡之后：蠢货回血、团队协作单元清负面状态 */
function bpAfterBlock(helper, target, notes) {
  const mod = bpMod(helper);
  if (mod.healOnBlock && typeof healUnit === "function") {
    const r = takeDice(mod.healOnBlock[0], mod.healOnBlock[1], 0);
    const got = healUnit(helper, r.total);
    notes.push(`蠢货：${helper.name} 格挡成功，恢复 ${got} 生命（${r.text}）。`);
  }
  if (mod.blockCleanse && target && target.statuses) {
    const gone = BP_NEGATIVE.filter(k => target.statuses[k]);
    gone.forEach(k => { target.statuses[k] = k === "burn" ? 0 : false; });
    if (typeof syncShockwave === "function") syncShockwave(target, null);
    if (gone.length) notes.push(`团队协作单元：${target.name} 身上的负面状态被清除。`);
  }
}
/** 坚守阵地单元：第一次被击破架势时不触发敌人的协助攻击，并恢复 2 架势。返回 true 表示拦下了 */
function bpFirstBreakGuard(u) {
  if (!u || !u.isPlayer || u._bpGuardUsed || !bpMod(u).firstBreakGuard) return false;
  u._bpGuardUsed = true;
  u.stunned = false;
  u.def = Math.min(typeof postureCap === "function" ? postureCap(u) : u.defMax, 2);
  appendLog(`坚守阵地单元：${u.name} 第一次被击破，不触发敌人的协助攻击，架势恢复到 ${u.def}。`);
  return true;
}

/* ---------- 治疗（engine.js · healUnit） ---------- */
function bpHealBonus(receiver) {
  let n = 0;
  const parts = [];
  const add = (u) => {
    const hb = bpMod(u).healBonus;
    if (!hb) return;
    const r = takeDice(hb[0], hb[1], 0);
    n += r.total;
    parts.push(r.total);
  };
  add(receiver);
  const healer = typeof unitById === "function" && state.attackerId ? unitById(state.attackerId) : null;
  if (healer && healer !== receiver && healer.isPlayer) add(healer);
  return n;
}

/* ---------- 敌人选目标（ai.js） ---------- */
/** 武器人形态带「安全的迷彩」：一定不会被敌人选作目标 */
function bpUntargetable(u) {
  return !!(u && bpMod(u).stealth && typeof isWeaponUnit === "function" && isWeaponUnit(u));
}
/** 在 AI 选出的目标上套「蠢货」「安全的迷彩」的倾向。forced（嘲讽等）时不改 */
function bpRetarget(pick, prey) {
  if (!bpActive() || !pick || !pick.unit || pick.forced) return pick;
  const loud = prey.filter(p => bpMod(p).aggro);
  if (loud.length && loud.indexOf(pick.unit) < 0 && Math.random() < 0.5) return { unit: loud[0] };
  if (bpMod(pick.unit).stealth) {
    const others = prey.filter(p => p !== pick.unit && !bpMod(p).stealth);
    if (others.length && Math.random() < 0.75) return { unit: others[Math.floor(Math.random() * others.length)] };
  }
  return pick;
}

/* ---------- 移动（app.js · doMove） ---------- */
/** 稳妥的距离：敌人走进你所在的区时，自动移动到另一个区（优先没有敌人的相邻区） */
function bpAfterEnemyMove(mover, notes) {
  if (!bpActive() || !mover || mover.isPlayer) return;
  const z = Number(mover.zone), n = Number(state.zoneMode) || 2;
  (state.units || []).forEach(u => {
    if (!u.isPlayer || u.dead || u.hidden || u.stunned || u.dying || Number(u.zone) !== z) return;
    if (!bpMod(u).autoRetreat) return;
    const adj = [z - 1, z + 1].filter(x => x >= 1 && x <= n);
    const foesIn = (zz) => (state.units || []).some(e => !e.isPlayer && !e.dead && !e.hidden && Number(e.zone) === zz);
    const dest = adj.find(x => !foesIn(x)) || adj[0];
    if (dest == null) return;
    u.zone = dest;
    notes.push(`稳妥的距离：${mover.name} 走进来，${u.name} 自动退到 ${dest} 区。`);
  });
}
/** 借机攻击单元：敌人离开你所在的区时，自动攻击 atk+1d6（武器属性） */
function bpLeaveOpportunity(u, mover, notes) {
  if (!u || !u.isPlayer || !mover || mover.isPlayer || !bpMod(u).oppAttack) return;
  const kit = u.weaponOf ? u.kit : (typeof heldWeaponKit === "function" ? heldWeaponKit(u) : null);
  const card = kit && typeof livePartyCards === "function" ? livePartyCards().find(c => c.kit === kit) : null;
  const element = (card && card.suggest && card.suggest.element) || (u.suggest && u.suggest.element) || "physical";
  notes.push(`借机攻击单元：${u.name} 对离开区域的 ${mover.name} 自动开火。`);
  dealTo(u, mover, { atk: effectiveAtk(u, state.units), mult: 1, diceN: 1, diceS: 6, element, baseBreak: 1,
    flags: { action: true, opportunity: true, blockResolved: true } });
}
