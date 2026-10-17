/* =========================================================
 * 沙漠生物与中立生物（主持人手册「沙漠生态补完」）
 * ---------------------------------------------------------
 * 昼夜：白天 05:00–18:00，夜晚 18:00–05:00（看 LEDGER.clock）；沙暴天气（漠汛）不管几点都按夜晚。
 *
 * 沙鱼（沙漠生物阵营的主要敌人，敌对沙灵）：
 *   领潮沙鱼（精英）  白天「撞击」高击破，负责把猎物拍晕；夜晚「撕咬」重伤害。
 *                     每个敌人回合开始用声呐探测一次中立生物；它死了鱼群失去协调（母系）：
 *                     不再群起、不再探测，每回合每只沙鱼 30% 下潜逃走。
 *   赶潮沙鱼（杂兵）  白天「甩尾」把人推到相邻区（优先推向埋伏的伏咬沙鱼 / 领潮 / 流沙）；夜晚「乱咬」。
 *   伏咬沙鱼（杂兵）  白天下潜埋伏、不主动移动：有猎物走进 / 被推进它的区就破沙「腾咬」；夜晚主动出击「猛咬」。
 *   群起：沙鱼打出失衡时，场上每只还能出手的沙鱼都冲过去协助攻击（每只每回合一次）。
 *   夜晚放弃击破，全力打伤害（基础击破降为 0，领潮留 1）。
 *
 * 中立生物（不占代币、不算胜负、不给经验掉落；谁都不会主动打它们，玩家可以打，范围攻击照样波及）：
 *   尘虫  白天在沙面晒背，每回合第一次挨打后「摊平」（之后到下回合开始受伤 −50%，击破照常）；
 *         夜晚下潜迁徙，几回合后钻走离开战场。
 *   管虫  所在的区变成流沙；同区 2 只以上「沸腾」，相邻区也变流沙；一个区的管虫死光，那里的流沙每回合 50% 消退。
 *         一直在震动，声呐上一直算「已被发现」。
 *   吞噬：尘虫 / 管虫一旦失衡（谁打的都算），离它最近的沙鱼立刻冲过去吞掉它：猎物死亡，
 *         沙鱼回复「猎物剩余的生命」，并用掉行动点（敌人回合里吞的：这回合剩下的行动点；玩家回合里吞的：下个敌人回合没有行动点）。
 *   探测：领潮每个敌人回合开始探测一次，每只没被发现的尘虫白天 6%、夜晚 35% 被发现（没有领潮的鱼群减半；领潮死了不再探测）。
 *   捕食：被发现的猎物，白天只有血量低于一半的沙鱼会去咬；夜晚只要有就去吃。
 * 数字在 DESERT 里。
 * ========================================================= */

const DESERT = {
  detect: { day: 0.06, night: 0.35, leaderless: 0.5 },
  hungryBelow: 0.5,
  fleeChance: 0.3,
  flattenCut: 0.5,
  quicksandFade: 0.5,
  bugLeave: [2, 3],          // 夜晚的尘虫几回合后钻走
  coral: { platform: 0.15, branch: 0.25 },
  // 富集变种：体内矿物丰富。armorMult 装甲层倍率，kuizhiMult 奎支倍率，fleeFrom 第几回合起会逃，fleeChance 每回合逃走的概率
  enriched: { chance: 0.1, sandChance: 0.25, armorMult: 1.5, kuizhiMult: 5, fleeFrom: 3, fleeChance: 0.3 },   // 沙漠遭遇里出现沙珊瑚台地（一个区）/ 沙珊瑚枝的概率
  spawn: {                   // 有沙鱼的沙漠遭遇里配的中立生物（不占代币）
    bugsDay: { chance: 0.6, count: [3, 5] },
    bugsNight: { chance: 0.7, count: [4, 6] },
    worms: { chance: 0.3, count: [1, 2] }
  }
};
const NEUTRAL_FACTION = "中立生物";
const SAND_FISH_KITS = ["sandfish_lead", "sandfish_drive", "sandfish_ambush"];
const DESERT_PREY_KITS = ["dust_bug", "tube_worm"];
const FISH_MAIN_SKILL = { sandfish_lead: "en_fish_lead_hit", sandfish_drive: "en_fish_drive_tail", sandfish_ambush: "en_fish_ambush_bite" };

function isSandFish(u) { return !!u && SAND_FISH_KITS.indexOf(u.kit) >= 0; }
function isDesertPrey(u) { return !!u && DESERT_PREY_KITS.indexOf(u.kit) >= 0; }
/** 中立生物：不算要打的敌人，不行动，不给经验掉落 */
function isNeutralCreature(u) {
  if (!u || u.isPlayer) return false;
  const i = typeof enemyInfo === "function" ? enemyInfo(u.kit) : null;
  return !!(i && i.faction === NEUTRAL_FACTION);
}
const desertLive = (u) => !!u && !u.dead && !u.hidden && !u._removed && !u.fused;
const sandFishes = () => (state.units || []).filter(u => isSandFish(u) && desertLive(u));
const desertPrey = () => (state.units || []).filter(u => isDesertPrey(u) && desertLive(u));

/** 现在是不是夜晚（沙暴天气按夜晚） */
function desertNight() {
  if (state.weather === "sand") return true;
  return isNightClock(clockNow());
}

/* ---------- 开战：中立生物就位 ---------- */
function desertBattleStart(notes) {
  const night = desertNight();
  state.fishLeaderSeen = sandFishes().some(u => u.kit === "sandfish_lead");
  state.fishLeaderLost = false;
  (state.units || []).forEach(u => {
    if (!desertLive(u)) return;
    if (u.kit === "tube_worm") u.detected = true;   // 一直在震动，声呐上一直显眼
    if (u.kit === "dust_bug" && night) {
      u.submerged = true;
      u.leaveIn = DESERT.bugLeave[0] + Math.floor(Math.random() * (DESERT.bugLeave[1] - DESERT.bugLeave[0] + 1));
    }
    if (u.kit === "sandfish_ambush") u.submerged = true;   // 伏咬沙鱼开场就在沙下
    // 富集变种：每只沙漠生物 10%（沙暴 25%）；主持人定过富集与否的（enrichSet）不再随机
    if (isSandFish(u) && !u.enriched && !u.enrichSet && Math.random() < (state.weather === "sand" ? DESERT.enriched.sandChance : DESERT.enriched.chance)) makeEnriched(u);
  });
  if (sandFishes().length || desertPrey().length) {
    notes.push(night ? (state.weather === "sand" ? "漠汛的沙暴遮住了光：沙漠生物按夜晚行动。" : "夜晚：沙漠生物活跃起来。")
      : "白天：沙漠生物按白天的习性行动。");
  }
  wormQuicksandTick(notes, true);
}

/* ---------- 管虫与流沙 ---------- */
function wormQuicksandTick(notes, opening) {
  const zm = Number(state.zoneMode) || 2;
  const want = {};
  for (let z = 1; z <= zm; z++) {
    const n = desertPrey().filter(u => u.kit === "tube_worm" && Number(u.zone) === z).length;
    if (!n) continue;
    want[z] = true;
    if (n >= 2) (typeof zoneNeighbors === "function" ? zoneNeighbors(z) : []).forEach(x => { want[Number(x)] = true; });   // 沸腾
  }
  for (let z = 1; z <= zm; z++) {
    const f = state.fields[z];
    if (!f) continue;
    if (want[z]) {
      if (f.quicksand) { f.wormSand = true; continue; }
      if (setZoneField(z, "quicksand", { innateOk: true }) == null) {
        f.wormSand = true;
        notes.push(`${z} 区的管虫震动起来，沙子流态化：变成流沙。`);
      }
    } else if (f.quicksand && f.wormSand && !opening) {
      if (Math.random() < DESERT.quicksandFade) {
        setZoneField(z, "", { innateOk: true, force: true });
        f.wormSand = false;
        notes.push(`${z} 区没有管虫了，流沙慢慢沉降，变回普通地面。`);
      }
    }
  }
}

/* ---------- 尘虫：摊平、夜晚迁徙 ---------- */
/** 挨打之后（effects.js · afterDamageTaken）：白天的尘虫每回合第一次挨打后摊平 */
function dustBugAfterHit(u, notes) {
  if (!u || u.kit !== "dust_bug" || u.dead || u.submerged || desertNight()) return;
  u.resources = u.resources || {};
  if (u.resources.flattened || u.resources.flatTurn === state.turnNo) return;
  u.resources.flattened = true;
  u.resources.flatTurn = state.turnNo;
  notes.push(`${u.name} 受到刺激，反射性地摊平贴地：受到的伤害 −50%（击破照常）。`);
}
/** 回合开始：摊平结束 */
function desertRoundStart(notes) {
  (state.units || []).forEach(u => {
    if (u.kit === "dust_bug" && u.resources && u.resources.flattened && u.resources.flatTurn !== state.turnNo) u.resources.flattened = false;
  });
  wormQuicksandTick(notes, false);
  coralRoundStart(notes);
}
/** 回合结束：夜晚的尘虫往没有沙鱼的区游，时间到了就钻走 */
function desertRoundEnd(notes) {
  coralRoundEnd(notes);
  desertPrey().filter(u => u.kit === "dust_bug" && u.submerged && u.leaveIn != null).forEach(u => {
    u.leaveIn -= 1;
    if (u.leaveIn <= 0) {
      u._removed = true;
      u.submerged = false;
      notes.push(`${u.name} 下潜迁徙，钻进沙漠深处，离开了战场。`);
      return;
    }
    const zs = [Number(u.zone)].concat((typeof zoneNeighbors === "function" ? zoneNeighbors(u.zone) : []).map(Number));
    const fish = (z) => sandFishes().filter(f => Number(f.zone) === z).length;
    const best = zs.sort((a, b) => fish(a) - fish(b))[0];
    if (best !== Number(u.zone)) u.zone = best;
  });
}

/* ---------- 吞噬 ---------- */
/** 尘虫 / 管虫失衡（app.js · queueAssistAttack 开头）：最近的沙鱼吞掉它。返回 true 表示已经处理（不走协助攻击） */
function preyBroken(breaker, prey) {
  if (!isDesertPrey(prey)) return false;
  if (prey.dead || prey._removed) return true;
  const eaters = sandFishes().filter(f => !f.stunned && !(typeof sinkLocked === "function" && sinkLocked(f)));
  if (!eaters.length) { appendLog(`${prey.name} 失衡了，附近没有沙鱼。`); return true; }
  const d = (f) => zoneDist(Number(f.zone), Number(prey.zone), state.zoneMode);
  eaters.sort((a, b) => d(a) - d(b) || (breaker && b.id === breaker.id ? 1 : 0) - (breaker && a.id === breaker.id ? 1 : 0) ||
    (totalHp(a) / Math.max(1, totalMaxHp(a))) - (totalHp(b) / Math.max(1, totalMaxHp(b))));
  devour(eaters[0], prey);
  return true;
}
function devour(fish, prey) {
  const notes = [];
  const gain = Math.max(0, Math.floor(totalHp(prey)));
  if (Number(fish.zone) !== Number(prey.zone)) {
    notes.push(`${fish.name} 闻声扑向 ${prey.zone} 区。`);
    fish.zone = Number(prey.zone);
  }
  prey.layers.forEach(l => { l.current = 0; });
  prey.dead = true;
  prey._xpGiven = true;   // 中立生物：没有经验、掉落、击杀分
  prey._eaten = true;
  const healed = gain > 0 ? healUnit(fish, gain) : 0;
  notes.push(`${fish.name} 一口吞掉了失衡的 ${prey.name}，回复 ${healed} 点生命。`);
  if (state.combatPhase === "enemy") {
    fish.ap = 0;
    notes.push(`${fish.name} 进食中：这回合剩下的行动点用掉了。`);
  } else {
    fish.loseApNext = true;
    notes.push(`${fish.name} 进食中：下个敌人回合没有行动点。`);
  }
  appendLog(notes.join("\n"));
  if (typeof sweepDeadEnemies === "function") sweepDeadEnemies();
}

/* ---------- 声呐探测、母系 ---------- */
/** 敌人回合开始（app.js · startEnemyPhase） */
function desertEnemyPhaseStart(notes) {
  const fishes = sandFishes();
  if (!fishes.length) return;
  const night = desertNight();
  // 伏咬沙鱼：回合开始重新下潜
  fishes.filter(f => f.kit === "sandfish_ambush" && !f.submerged && !f.stunned).forEach(f => {
    f.submerged = true;
    notes.push(`${f.name} 重新潜入沙下。`);
  });
  // 富集个体胆小：第 3 回合起每回合 30% 下潜逃走（什么都不掉）
  fishes.filter(f => f.enriched && !f.stunned && Number(state.turnNo) >= DESERT.enriched.fleeFrom).forEach(f => {
    if (Math.random() >= DESERT.enriched.fleeChance) return;
    f._removed = true;
    f.submerged = false;
    notes.push(`${f.name} 带着一肚子矿物下潜逃走了！`);
  });
  // 母系：领潮死了，鱼群溃散
  if (fishLeaderGone()) {
    state.fishLeaderLost = true;
    fishes.forEach(f => {
      if (f.stunned || Math.random() >= DESERT.fleeChance) return;
      f._removed = true;
      f.submerged = false;
      notes.push(`${f.name} 失去领潮的指挥，下潜逃走了。`);
    });
    return;
  }
  const leader = fishes.find(f => f.kit === "sandfish_lead" && !f.stunned);
  if (!leader && state.fishLeaderSeen) return;
  let p = night ? DESERT.detect.night : DESERT.detect.day;
  if (!leader) p *= DESERT.detect.leaderless;
  const found = desertPrey().filter(u => !u.detected && Math.random() < p);
  found.forEach(u => { u.detected = true; });
  if (found.length) notes.push(`${leader ? leader.name : "沙鱼群"} 的声呐发现了 ${found.map(u => `${u.zone} 区的${u.name}`).join("、")}。`);
}
/** 领潮没了（来过、现在场上没有活着的）：鱼群失去协调 */
function fishLeaderGone() {
  return !!state.fishLeaderSeen && !sandFishes().some(f => f.kit === "sandfish_lead");
}
/** 敌人倒下（app.js · settleEnemyKill）：领潮死了 → 母系溃散 */
function desertOnDeath(u, notes) {
  if (u && u.kit === "sandfish_lead" && !state.fishLeaderLost && !sandFishes().some(f => f !== u && f.kit === "sandfish_lead")) {
    state.fishLeaderLost = true;
    if (sandFishes().some(f => f !== u) && notes) notes.push("领潮沙鱼倒下了：鱼群失去协调，不再群起，开始四散逃走。");
  }
}

/* ---------- 群起 ---------- */
/** 这只沙鱼这回合还能不能群起（每只每回合一次） */
function fishFrenzyUsed(u) { return isSandFish(u) && u._frenzyTurn === state.turnNo; }
/** 协助攻击打完（app.js · finishAssist）：沙鱼打出的失衡，下一只还没出手的沙鱼接着上 */
function fishFrenzyContinue(job, helper, target) {
  if (!isSandFish(helper)) return false;
  helper._frenzyTurn = state.turnNo;
  if (fishLeaderGone()) return false;
  const breaker = unitById(job.breakerId);
  if (!isSandFish(breaker) && !job.frenzy) return false;
  if (!target || (typeof assistTargetGone === "function" && assistTargetGone(target))) return false;
  const more = eligibleAssisters(breaker, target).filter(u => isSandFish(u) && !fishFrenzyUsed(u));
  if (!more.length) return false;
  appendLog(`沙鱼群起：${more.map(u => u.name).join("、")} 也扑了上去。`);
  state.assistQueue.unshift(Object.assign({}, job, { frenzy: true }));
  return true;
}

/* ---------- 伏咬沙鱼：有猎物走进 / 被推进它的区就腾咬 ---------- */
function ambushOnEnter(unit, notes) {
  if (!unit || unit.kind || unit.dead || desertNight()) return;
  sandFishes().filter(f => f.kit === "sandfish_ambush" && f.submerged && !f.stunned && Number(f.zone) === Number(unit.zone) &&
    typeof hostileTo === "function" && hostileTo(f, unit) && f._ambushTurn !== state.turnNo).slice(0, 1).forEach(f => {
    f._ambushTurn = state.turnNo;
    notes.push(`${f.name} 从沙下破沙而出，腾咬 ${unit.name}！`);
    fishBite(f, unit, { dealDirect: true });
  });
}
/** 一口：按昼夜和种类结算。opt.dealDirect：反应式（埋伏）的一击，不经过行动 */
function fishBiteOpt(f, t) {
  const night = desertNight();
  const k = f.kit;
  if (k === "sandfish_lead") return night ? { element: "physical", mult: 1.5, diceN: 1, diceS: 8, baseBreak: 1 }
    : { element: "physical", mult: 1, diceN: 1, diceS: 6, baseBreak: (f.level || 1) >= 10 ? 3 : 2 };
  if (k === "sandfish_drive") return night ? { element: "physical", mult: 1, diceN: 1, diceS: 6, baseBreak: 0 }
    : { element: "physical", mult: 0.5, diceN: 1, diceS: 4, baseBreak: 1, push: true };
  // 伏咬：白天腾咬，目标下陷中 / 这回合被推过再 +1 击破
  if (night) return { element: "physical", mult: 1.75, diceN: 1, diceS: 6, baseBreak: 0 };
  const shaken = t && ((Number(t.sink) || 0) > 0 || t._pushedTurn === state.turnNo);
  return { element: "physical", mult: 1, diceN: 1, diceS: 6, baseBreak: shaken ? 2 : 1 };
}
function fishBite(f, t, opt) {
  opt = opt || {};
  let o = fishBiteOpt(f, t);
  const push = o.push;
  delete o.push;
  // 捕食：先把猎物拍晕再吃（不伤它，失衡就整只吞下，回复它剩下的生命）
  if (isDesertPrey(t)) o = { element: "physical", mult: 0, diceN: 0, diceS: 0, baseBreak: Math.max(1, Number(t.def) || 1) };
  // 甩尾：打中了才推（被格挡 / 闪避就不推；等协助格挡的那一击结算完再推）
  if (push && t && !isDesertPrey(t)) {
    const dest = driveDest(f, t);
    if (dest != null) o.onConnect = { dest, reason: `被 ${f.name} 甩尾扫开` };
  }
  const atk = typeof effectiveAtk === "function" ? effectiveAtk(f, state.units) : f.atk;
  const flags = opt.dealDirect ? { action: true, opportunity: true, blockResolved: true, block: "none" } : { action: true };
  return opt.hitOne ? opt.hitOne(f, t, Object.assign({ atk, atkRange: "melee" }, o, { flags }))
    : dealTo(f, t, Object.assign({ atk, atkRange: "melee" }, o, { flags }));
}
/** 甩尾往哪推：伏咬埋伏的区 > 领潮所在的区 > 流沙 > 随便一个相邻区 */
function driveDest(f, t) {
  const zs = (typeof zoneNeighbors === "function" ? zoneNeighbors(t.zone) : []).map(Number)
    .filter(z => !(state.fields[z] && state.fields[z].abyss) && !(typeof lineBlocked === "function" && lineBlocked(t.zone, z)));
  if (!zs.length) return null;
  const score = (z) => (sandFishes().some(x => x.kit === "sandfish_ambush" && x.submerged && Number(x.zone) === z) ? 4 : 0) +
    (sandFishes().some(x => x.kit === "sandfish_lead" && Number(x.zone) === z) ? 2 : 0) +
    (state.fields[z] && state.fields[z].quicksand ? 1 : 0) +
    (desertNight() && coralInZone(z) ? 3 : 0);   // 夜晚：把猎物甩进沙珊瑚
  return zs.sort((a, b) => score(b) - score(a))[0];
}

/* ---------- 敌人技能（enemies.js · runEnemyActionInner 开头交给这里） ---------- */
function desertEnemyAction(id, a, t, hitOne, lines, needT) {
  if (!/^en_fish_/.test(String(id))) return false;
  if (!needT()) return true;
  const assist = /_assist$/.test(id);
  if (!assist && Number(a.zone) !== Number(t.zone) && typeof stepTowardZone === "function" && !coralAvoid(a, t.zone)) stepTowardZone(a, t.zone);
  if (assist && Number(a.zone) !== Number(t.zone) && coralAvoid(a, t.zone)) {
    lines.push(`${a.name} 不敢靠近 ${t.zone} 区的沙珊瑚，没有扑上去。`);
    return true;
  }
  if (assist && Number(a.zone) !== Number(t.zone)) {
    lines.push(`${a.name} 冲向 ${t.zone} 区。`);
    a.zone = Number(t.zone);
  }
  fishBite(a, t, { hitOne });
  return true;
}

/* ---------- AI：捕食与伏击（ai.js · aiPlan 开头） ---------- */
function sandFishPlan(u) {
  if (!isSandFish(u) || u.stunned) return null;
  const night = desertNight();
  const hungry = night || totalHp(u) < totalMaxHp(u) * DESERT.hungryBelow;
  const prey = desertPrey().filter(p => p.detected && !coralAvoid(u, p.zone));
  if (hungry && prey.length && (u.ap || 0) > 0) {
    const d = (p) => zoneDist(Number(u.zone), Number(p.zone), state.zoneMode);
    const p = prey.sort((x, y) => d(x) - d(y) || totalHp(x) - totalHp(y))[0];
    const sid = FISH_MAIN_SKILL[u.kit];
    if (sid) {
      return {
        thunk: () => { state.attackerId = u.id; state.targetId = p.id; runSkill(sid); },
        meta: { actorId: u.id, targetId: p.id, skillName: `${u.name} 捕食 ${p.name}` },
        ai: { kind: "hunt", target: p }
      };
    }
  }
  // 白天的伏咬沙鱼：不主动移动，只咬同区的猎物
  if (u.kit === "sandfish_ambush" && !night) {
    const here = (state.units || []).filter(x => desertLive(x) && typeof hostileTo === "function" && hostileTo(u, x) &&
      Number(x.zone) === Number(u.zone) && !x.submerged && !(x.dying && !x.upOnShp));
    if (!here.length) return "wait";   // 潜伏不动（ai.js 当成这一步不行动）
  }
  return null;
}

/* ---------- 遭遇：有沙鱼的沙漠遭遇配上中立生物（run.js · finishEncounter） ---------- */
function addDesertNeutrals(spec) {
  if (!spec || spec.region !== "沙漠" || !Array.isArray(spec.enemies)) return spec;
  const hasFish = spec.enemies.some(e => SAND_FISH_KITS.indexOf(e.preset) >= 0);
  if (!hasFish) return spec;
  const night = spec.weather === "sand" || isNightClock(clockNow());
  const zm = Number(spec.zoneMode) || 2;
  const between = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const zoneAway = () => {
    const zs = [];
    for (let z = 1; z <= zm; z++) if (z !== Number(spec.playerZone || 1)) zs.push(z);
    return zs.length ? zs[Math.floor(Math.random() * zs.length)] : 1 + Math.floor(Math.random() * zm);
  };
  const bugs = night ? DESERT.spawn.bugsNight : DESERT.spawn.bugsDay;
  if (Math.random() < bugs.chance) spec.enemies.push({ preset: "dust_bug", count: between(bugs.count[0], bugs.count[1]), zone: 1 + Math.floor(Math.random() * zm) });
  if (Math.random() < DESERT.spawn.worms.chance) spec.enemies.push({ preset: "tube_worm", count: between(DESERT.spawn.worms.count[0], DESERT.spawn.worms.count[1]), zone: zoneAway() });
  return spec;
}

/* =========================================================
 * 沙珊瑚（主持人手册：从地底向上延伸，台地接受阳光；光线变暗就伸出触须抓取矿物和活物，同化进自身结构）
 *   场地「沙珊瑚台地」（state.fields[z].coral）：战斗在珊瑚上面进行，自带高地效果（app.js · isHighGround）。
 *     夜晚 / 沙暴：每回合开始从缝隙里伸出一根「沙珊瑚触须」（配置物，同区最多 2 根），抓住台地上随机一个能抓的单位。
 *   配置物「沙珊瑚枝」：单独伸出来的一根分支，可以被摧毁。白天没有动作；夜晚 / 沙暴每回合结束抓住同区一个能抓的单位（最多同时抓 2 个）。
 *   缠绕（u.entangled）：不能移动，位移也带不走；每回合开始受到「等级 + 1d6」物理伤害（同化）。
 *     碳基生物「没有松开这个分支」：只有砍断才能脱困——触须被摧毁；或珊瑚枝被摧毁 / 一回合内被打掉 25% 耐久（砍断触须）。
 *   不按阵营豁免：谁都会被抓（飞行的抓不到）。沙漠生物有避开珊瑚的习性（AI 夜晚不走进去、群起也不扑过去），
 *   赶潮沙鱼反而会把猎物往珊瑚那边甩；沙灵不躲（它们不是原生生物）。
 * ========================================================= */
const CORAL = { tentacleHp: [8, 3], branchHp: [30, 4], maxTentacles: 2, maxGrabs: 2, cutPct: 0.25, dmgDie: 6 };
const coralProps = (z) => (state.props || []).filter(p => (p.kind === "coral_branch" || p.kind === "coral_tentacle") && (z == null || Number(p.zone) === Number(z)));
/** 这一区有没有会抓人的沙珊瑚（台地或珊瑚枝） */
function coralInZone(z) {
  const f = state.fields && state.fields[z];
  return !!(f && f.coral) || coralProps(z).some(p => p.kind === "coral_branch");
}
/** 沙漠生物的习性：夜晚 / 沙暴不靠近会抓人的沙珊瑚 */
function coralAvoid(u, z) {
  if (!u || z == null || !desertNight()) return false;
  const fac = typeof factionOf === "function" ? factionOf(u) : null;
  return fac === "沙漠生物" && coralInZone(Number(z));
}
function canEntangle(u) {
  return !!u && !u.dead && !u.hidden && !u._removed && !u.fused && !u.flying && Array.isArray(u.layers) && !u.entangled &&
    !(state.props || []).includes(u);
}
function entangle(u, src, notes) {
  u.entangled = { src: src.id, name: src.name, level: Number(src.level) || 1 };
  notes.push(`${src.name} 伸出触须缠住了 ${u.name}：动不了，每回合被同化（受到伤害），只有砍断触须才能脱困。`);
}
function releaseEntangled(srcId, notes, why) {
  (state.units || []).filter(u => u.entangled && u.entangled.src === srcId).forEach(u => {
    u.entangled = null;
    notes.push(`${u.name} ${why || "挣脱了沙珊瑚"}。`);
  });
}
const grabsOf = (srcId) => (state.units || []).filter(u => u.entangled && u.entangled.src === srcId && !u.dead).length;
/** 回合开始：同化伤害；夜晚台地伸出触须 */
function coralRoundStart(notes) {
  // 抓着人的源头没了（被摧毁、被移走）：松开
  (state.units || []).forEach(u => {
    if (u.entangled && !(state.props || []).some(p => p.id === u.entangled.src)) { u.entangled = null; notes.push(`${u.name} 身上的触须断了，脱困。`); }
  });
  (state.units || []).filter(u => u.entangled && !u.dead && !u.hidden).forEach(u => {
    const r = takeDice(1, CORAL.dmgDie, Number(u.entangled.level) || 1);
    applyTypedDot(u, r.total, "physical", notes, `${u.name} 被${u.entangled.name}同化 ${r.text}`);
  });
  coralProps().forEach(p => { p._roundDmg = 0; });
  if (!desertNight()) return;
  const zm = Number(state.zoneMode) || 2;
  for (let z = 1; z <= zm; z++) {
    const f = state.fields[z];
    if (!f || !f.coral) continue;
    if (coralProps(z).filter(p => p.kind === "coral_tentacle").length >= CORAL.maxTentacles) continue;
    const cand = (state.units || []).filter(u => Number(u.zone) === z && canEntangle(u));
    if (!cand.length) continue;
    const lv = Math.max(1, ...(state.units || []).filter(u => !u.isPlayer).map(u => Number(u.level) || 1), 1);
    const t = makeProp("coral_tentacle", z, lv);
    state.props.push(t);
    entangle(cand[Math.floor(Math.random() * cand.length)], t, notes);
  }
}
/** 回合结束：夜晚的珊瑚枝抓人 */
function coralRoundEnd(notes) {
  if (!desertNight()) return;
  coralProps().filter(p => p.kind === "coral_branch" && p.hp > 0 && grabsOf(p.id) < CORAL.maxGrabs).forEach(p => {
    const cand = (state.units || []).filter(u => Number(u.zone) === Number(p.zone) && canEntangle(u));
    if (cand.length) entangle(cand[Math.floor(Math.random() * cand.length)], p, notes);
  });
}
/** 珊瑚挨打（app.js · damageProp）：珊瑚枝一回合内被打掉 25% 耐久，触须被砍断 */
function coralPropDamaged(p, lose, notes) {
  if (p.kind !== "coral_branch") return;
  p._roundDmg = (Number(p._roundDmg) || 0) + lose;
  if (grabsOf(p.id) && p._roundDmg >= Math.ceil(p.maxHp * CORAL.cutPct)) {
    releaseEntangled(p.id, notes, "身上的触须被砍断，脱困");
    p._roundDmg = 0;
  }
}
/** 珊瑚被摧毁（app.js · destroyProp） */
function coralPropDestroyed(p, notes) {
  if (!isCoralProp(p) && p.kind !== "death_statue") return;
  if (p.kind === "coral_branch" || p.kind === "coral_tentacle") releaseEntangled(p.id, notes, "脱困（缠住他的珊瑚断了）");
  // 打碎珊瑚枝：金属骨骼散落一地（低级材料）
  if (p.kind === "coral_branch") grantDesertMaterials([{ id: "mat_metal", qty: (Number(p.level) || 1) >= 10 ? 2 : 1 }], notes, `${p.name} 碎掉的金属骨骼`);
  if (p.kind === "death_statue") grantDesertMaterials([{ id: "mat_metal", qty: 1 }], notes, `${p.name} 碎掉的金属骨骼`);
}
/** 沙漠的战场特征（run.js · regionFeatures）：沙珊瑚台地 / 沙珊瑚枝 */
function desertFeatures(zoneMode) {
  const out = [];
  const zm = Number(zoneMode) || 2;
  const zone = () => 1 + Math.floor(Math.random() * zm);
  if (Math.random() < DESERT.coral.platform) out.push({ type: "field", what: "coral", zone: zone() });
  if (Math.random() < DESERT.coral.branch) out.push({ type: "prop", what: "coral_branch", zone: zone() });
  return out;
}

/* ---------- 富集变种（「富集 + 名字」，参照《深岩银河》的战利品虫） ---------- */
/** 变成富集个体：装甲层 ×1.5（满血），名字前加「富集」 */
function makeEnriched(u) {
  if (!u || u.enriched) return u;
  u.enriched = true;
  if (!/^富集/.test(u.name)) u.name = "富集" + u.name;
  (u.layers || []).forEach(l => {
    if (l.type !== "armor") return;
    l.max = Math.round(Number(l.max) * DESERT.enriched.armorMult);
    l.current = l.max;
  });
  return u;
}
/** 变回普通个体（makeEnriched 的反向）：装甲层上限除回去、已受的伤按比例保留，去掉名字前的「富集」 */
function unmakeEnriched(u) {
  if (!u || !u.enriched) return u;
  u.enriched = false;
  u.name = String(u.name).replace(/^富集/, "");
  (u.layers || []).forEach(l => {
    if (l.type !== "armor") return;
    const max = Math.max(1, Math.round(Number(l.max) / DESERT.enriched.armorMult));
    l.current = Math.min(max, Math.round(Number(l.current) * max / Math.max(1, Number(l.max))));
    l.max = max;
  });
  return u;
}
/** 主持人定富集与否（战斗模板、任务节点、联机主持人工具生成 / 修改单位）。
 *  mode：true 富集、false 不富集、null / undefined 随机（开战时照常 10% / 沙暴 25%）。只对沙鱼有效，别的单位不动 */
function desertSetEnriched(u, mode) {
  if (!isSandFish(u)) return u;
  if (mode === true) { makeEnriched(u); u.enrichSet = true; }
  else if (mode === false) { unmakeEnriched(u); u.enriched = false; u.enrichSet = true; }
  else delete u.enrichSet;
  return u;
}
/** 掉落的奎支倍率（app.js · settleEnemyKill） */
function desertLootMult(u) { return u && u.enriched ? DESERT.enriched.kuizhiMult : 1; }
/** 沙漠生物掉的武器升级材料：低级材料为主，不掉高级材料（稀有晶体、赫心结晶）。按等级 [{ id, qty }]
 *  作者定：这些敌人不会掉很高级的材料，低级材料更常见 */
function enrichedMaterials(level) {
  const lv = Number(level) || 1;
  const out = [];
  const chance = (p) => Math.random() < p;
  const between = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  if (lv <= 5) out.push({ id: "mat_metal", qty: between(1, 2) });
  else if (lv <= 10) { out.push({ id: "mat_metal", qty: 2 }); if (chance(0.2)) out.push({ id: "mat_alloy", qty: 1 }); }
  else if (lv <= 15) { out.push({ id: "mat_metal", qty: between(2, 3) }); if (chance(0.35)) out.push({ id: "mat_alloy", qty: 1 }); }
  else { out.push({ id: "mat_metal", qty: 3 }, { id: "mat_alloy", qty: 1 }); if (chance(0.1)) out.push({ id: "mat_polymer", qty: 1 }); }
  return out;
}
/** 给材料：跑团模式、长线养成、沙盒给实物；普通单局里武器升级不收实物材料，按物品表折成奎支 */
function grantDesertMaterials(mats, notes, source) {
  if (!mats.length) return;
  const real = (typeof TRPG !== "undefined" && TRPG.active) || (typeof Rogue !== "undefined" && Rogue.growthXp && Rogue.growthXp()) ||
    !(typeof Rogue !== "undefined" && Rogue.inRunMode && Rogue.inRunMode());
  const name = (id) => (ITEM_CATALOG[id] || {}).name || id;
  const list = mats.map(m => `${name(m.id)}×${m.qty}`).join("、");
  if (real) {
    mats.forEach(m => bagAdd(m.id, m.qty));
    if (state.battleGains) (state.battleGains.items = state.battleGains.items || []).push(...mats);
    notes.push(`${source}：${list}。`);
  } else {
    const price = (id) => ((typeof HANDBOOK_MATERIALS !== "undefined" && HANDBOOK_MATERIALS[id.replace(/^mat_/, "")]) || {}).price || 0;
    const k = mats.reduce((s, m) => s + price(m.id) * m.qty, 0);
    if (k > 0 && typeof addKuizhi === "function") addKuizhi(k, notes, `${source}（${list}，折价）`);
  }
}
/** 富集个体被打倒：掉材料 */
function desertEnrichedDrops(u, notes) {
  if (!u || !u.enriched) return;
  grantDesertMaterials(enrichedMaterials(u.level), notes, `${u.name} 体内的矿物`);
}

/* ---------- 可燃气通道：白天吸热，夜晚被火打中爆燃 ---------- */
const isCoralProp = (p) => !!p && (p.kind === "coral_branch" || p.kind === "coral_tentacle");
/** 白天：火焰打沙珊瑚不掉耐久，反而回复同样多（app.js · damageProp）。返回 true 表示已经处理 */
function coralAbsorbsFire(p, element, amount, notes) {
  if (!isCoralProp(p) || element !== "fire" || desertNight() || !(amount > 0)) return false;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + amount);
  notes.push(`${p.name} 白天在吸热：火焰没有伤到它，反而回复 ${p.hp - before} 点耐久 → ${p.hp}。`);
  return true;
}
/** 夜晚 / 沙暴：火焰点着了珊瑚里的可燃气，整区爆燃（不分敌我，包括被它缠住的人）；每根珊瑚每回合最多一次 */
function coralGasBurst(p, element, attacker, notes) {
  if (!isCoralProp(p) || element !== "fire" || !desertNight() || p._burstTurn === state.turnNo) return;
  p._burstTurn = state.turnNo;
  const lv = Number(p.level) || 1;
  const r = takeDice(2, 6, lv);
  notes.push(`${p.name} 里的可燃气被点着了：${p.zone} 区爆燃，所有单位 ${r.text} 火焰 + 1 击破！`);
  if (typeof markAoeZone === "function") markAoeZone(p.zone, { element: "fire", dmg: r.total, attacker, from: p.zone });
  (state.units || []).filter(u => !u.hidden && !u.dead && !u._removed && Number(u.zone) === Number(p.zone)).forEach(u => {
    const fake = unitOf("可燃气爆燃", lv, [{ type: "armor", hp: 1 }], 0, 0);
    fake.zone = p.zone;
    fake.envSrc = true; fake.envBy = typeof envCreditId === "function" ? envCreditId(attacker) : null;
    dealTo(fake, u, { atk: 0, mult: 0, flat: r.total, element: "fire", baseBreak: 1, flags: { action: true, aoe: true, blockResolved: true } });
  });
  // 珊瑚自己也挨这一下（通常会砍断触须）
  if ((state.props || []).includes(p) && p.hp > 0) {
    p.hp = Math.max(0, p.hp - r.total);
    notes.push(`${p.name} 自己也被炸到：耐久 −${r.total} → ${p.hp}`);
    coralPropDamaged(p, r.total, notes);
    if (p.hp <= 0 && typeof destroyProp === "function") notes.push(...destroyProp(p, attacker));
  }
}

/* ---------- 死亡雕像：被缠住时死掉的，被珊瑚的金属骨骼覆盖（掩体） ---------- */
/** 清理死亡单位时（app.js · sweepDeadEnemies）：被缠住时死掉的留下一座雕像。我方只有真正死亡才算（濒死不算） */
function deathStatueSweep(notes) {
  (state.units || []).forEach(u => {
    if (!u || !u.entangled || u._statued || !u.dead || u.hidden) return;
    u._statued = true;
    const lv = Number(u.entangled.level) || Number(u.level) || 1;
    const st = makeProp("death_statue", u.zone, lv);
    st.name = `死亡雕像（${String(u.name).replace(/^富集/, "")}）`;
    state.props.push(st);
    u.entangled = null;
    notes.push(`${u.name} 至死都没被放开：沙珊瑚分泌的金属骨骼把它覆盖了，留下一座${st.name}（掩体）。`);
  });
}
/** 这一区有没有死亡雕像（掩体：挨隔区的远程攻击时协助格挡 +10%） */
function statueCoverIn(z) {
  return (state.props || []).some(p => p.kind === "death_statue" && p.hp > 0 && Number(p.zone) === Number(z));
}
