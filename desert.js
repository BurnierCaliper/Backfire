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
}
/** 回合结束：夜晚的尘虫往没有沙鱼的区游，时间到了就钻走 */
function desertRoundEnd(notes) {
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
    (state.fields[z] && state.fields[z].quicksand ? 1 : 0);
  return zs.sort((a, b) => score(b) - score(a))[0];
}

/* ---------- 敌人技能（enemies.js · runEnemyActionInner 开头交给这里） ---------- */
function desertEnemyAction(id, a, t, hitOne, lines, needT) {
  if (!/^en_fish_/.test(String(id))) return false;
  if (!needT()) return true;
  const assist = /_assist$/.test(id);
  if (!assist && Number(a.zone) !== Number(t.zone) && typeof stepTowardZone === "function") stepTowardZone(a, t.zone);
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
  const prey = desertPrey().filter(p => p.detected);
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
