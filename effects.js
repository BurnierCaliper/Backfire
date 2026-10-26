/* 角鳞 · 效果补全（对照玩家手册第四章）
 *
 * 手册第四章里有些效果之前只实现了一部分，这里集中补齐。app.js 在对应的时机调用这些函数：
 *   applyInstantEffect   施加即时效果（刺骨、过载、熔融……）时的即刻结算
 *   afterDamageTaken     一次伤害结算之后（刺骨遇火、熔融护盾、躲藏解除、过载反伤……）
 *   afterAttackDealt     攻击者打完一次攻击行动之后（霜结回架势、溅射、导体额外目标、躲藏解除）
 *   onBreakTaken         受到击破之后（多普勒）
 *   onBroken             被打进失衡的那一刻（刺骨再触发、过载爆炸）
 *   endSelfOnStun        晕眩后自我效果结束（蓄能累积的高能值不清零）
 *   selfImmunities       自我效果带来的免疫（自焚免疫灼烧、霜结免疫冻伤……）
 *   blindRollApplies / blindRoll / blindBlockBonus / blindOnBlocked   目盲（#405）：出手时的落空骰、被格挡的概率、挡下以后解除
 * 规则全部照手册原文，行内注释写了对应的句子。
 * 下水道狂鼠的通用机制（docs/ratfolk.md 第 2 节）也放在这里：狂暴（自我效果，enterFrenzy / FRENZY）、阵营被动「狂潮」（frenzyTide）；
 * 出血是攻击效果，在 engine.js · resolveAttack 里结算（BLEED）。
 */

/* ---------- 小工具 ---------- */
const INNER_TYPES = ["flesh", "spirit", "sand"];
/** 刺骨作用的层：肉体 / 星灵 / 沙尘里最靠内的一层 */
function stingLayer(u) {
  const ls = (u && u.layers) || [];
  for (let i = ls.length - 1; i >= 0; i--) {
    if (INNER_TYPES.indexOf(ls[i].type) >= 0 && (Number(ls[i].max) || 0) > 0) return ls[i];
  }
  return null;
}
function enemiesOf(u) {
  return (state.units || []).filter(x => x && !x.dead && !x.hidden && !x._removed && x.kit !== "ironwall" &&
    !!x.isPlayer !== !!u.isPlayer && totalHp(x) > 0);
}

/* ---------- 即时效果：施加 ---------- */
/** 施加即时效果（替代直接写 u.instant.xxx = true）。返回记录 */
function applyInstantEffect(u, key, notes, source) {
  notes = notes || [];
  if (!u) return notes;
  u.instant = u.instant || {};
  const already = !!u.instant[key];
  u.instant[key] = true;
  if (typeof popStatus === "function") popStatus(u, key);
  if (key === "sting") {
    // 刺骨：立刻对单位的肉体 / 星灵 / 沙尘层造成 10% 本层血量上限的冰属性伤害
    stingPulse(u, "ice", notes, "刺骨");
  }
  if (key === "overload" && !already) {
    // 过载：护盾值此回合内翻倍（临时护盾也翻倍），下回合开始时清零
    if (typeof syncTempShield === "function") syncTempShield(u);
    (u.layers || []).forEach(l => {
      if (l.type !== "shield") return;
      l._overloadMax = Number(l.max) || 0;
      l._overloadTemp = Number(l.tempShield) || 0;
      l.max = l._overloadMax * 2;
      l.current = (Number(l.current) || 0) * 2;
      if (l._overloadTemp) l.tempShield = l._overloadTemp * 2;
      l._lastCur = l.current;
    });
    if ((u.layers || []).some(l => l.type === "shield")) notes.push(`${u.name} 过载：护盾本回合翻倍。`);
  }
  if (key === "melt") u._meltShieldTaken = 0;
  return notes;
}

/** 刺骨的那一下：本层上限 10% 的冰（或火）伤害，只打肉体 / 星灵 / 沙尘层 */
function stingPulse(u, element, notes, label) {
  const layer = stingLayer(u);
  if (!layer) return;
  const dmg = Math.max(1, Math.floor((Number(layer.max) || 0) * 0.1));
  applyTypedDot(u, dmg, element, notes, `${u.name} ${label}（${LAYER[layer.type]}上限 10%）`, { focusLayer: layer.type });
}

/** 回合开始：过载结束 → 护盾清零，上限恢复（这一回合不按「没挨打回满」处理） */
function overloadRoundStart(u, notes) {
  if (!u || !u.instant || !u.instant.overload) return false;
  u.instant.overload = false;
  let had = false;
  (u.layers || []).forEach(l => {
    if (l.type !== "shield") return;
    had = true;
    if (typeof syncTempShield === "function") syncTempShield(u);
    // 清零：临时护盾也一起没了，上限回到自带的那部分
    if (l._overloadMax != null) { l.max = Math.max(0, l._overloadMax - (Number(l._overloadTemp) || 0)); delete l._overloadMax; delete l._overloadTemp; }
    else l.max = Math.max(0, (Number(l.max) || 0) - (Number(l.tempShield) || 0));
    l.tempShield = 0;
    l.current = 0;
    l._lastCur = 0;
  });
  if (typeof syncTempShield === "function") syncTempShield(u);   // 纯临时的护盾层去掉
  if (had && typeof dropMagnetShield === "function") dropMagnetShield(u);   // 川川给的护盾被过载清零：磁场护盾标记跟着作废
  notes.push(`${u.name} 过载结束${had ? "：护盾清零" : ""}。`);
  return had;
}

/* ---------- 伤害之后 ---------- */
/**
 * 一次伤害结算完（dealTo 与持续 / 环境伤害都会调用）。
 *   dealt      实际扣掉的血量
 *   shieldHit  这次打在护盾层上的量
 *   ctx        { attacker, action, melee, startLayerType }
 */
function afterDamageTaken(u, element, dealt, shieldHit, notes, ctx) {
  if (u && typeof syncTempShield === "function") syncTempShield(u);   // 临时护盾先扣（engine.js）
  if (!u || !(dealt > 0)) return;
  ctx = ctx || {};
  if (typeof dustBugAfterHit === "function") dustBugAfterHit(u, notes);   // 尘虫：挨打后摊平
  // 躲藏：受到伤害后解除
  if (u.statuses && u.statuses.hide) {
    u.statuses.hide = false;
    notes.push(`${u.name} 受到伤害，躲藏解除。`);
  }
  // 刺骨：受到火属性伤害后立刻解除，并且对内层血量造成 10% 本层血量上限的火属性伤害
  if (element === "fire" && u.instant && u.instant.sting) {
    u.instant.sting = false;
    notes.push(`${u.name} 刺骨遇火解除。`);
    stingPulse(u, "fire", notes, "刺骨遇火");
  }
  // 熔融（护盾）：一回合内累计受到护盾最大值一半的伤害则立刻失效，下回合以一半护盾值恢复
  if (u.instant && u.instant.melt && shieldHit > 0) {
    u._meltShieldTaken = (Number(u._meltShieldTaken) || 0) + shieldHit;
    const sh = (u.layers || []).find(l => l.type === "shield" && !l._meltBroken);
    if (sh && u._meltShieldTaken >= (Number(sh.max) || 0) / 2 && sh.current > 0) {
      sh.current = 0;
      sh._meltBroken = true;
      notes.push(`${u.name} 熔融：护盾累计受伤过半，立刻失效，下回合以一半恢复。`);
    }
  }
  // 过载：装甲血量受到近距离攻击时，反伤 50% 此次受到攻击伤害的闪电伤害
  // 过载者是玩家：反伤算过载者的伤害，打死算过载者的击杀（#203）；不是玩家照旧（不传 by，算行动中的人 / 不改最后一击）
  if (ctx.action && ctx.melee && ctx.attacker && u.instant && u.instant.overload && ctx.startLayerType === "armor" && !ctx.attacker.dead) {
    const back = Math.floor(dealt * 0.5);
    if (back > 0) applyTypedDot(ctx.attacker, back, "electric", notes, `${u.name} 过载反伤 → ${ctx.attacker.name}`, u.isPlayer ? { by: u.id } : undefined);
  }
}

/** 回合开始：熔融打坏的护盾以一半恢复 */
function meltShieldRoundStart(u, notes) {
  let restored = false;
  (u.layers || []).forEach(l => {
    if (!l._meltBroken) return;
    delete l._meltBroken;
    l.current = Math.floor((Number(l.max) || 0) / 2);
    restored = true;
  });
  u._meltShieldTaken = 0;
  if (restored) notes.push(`${u.name} 护盾以一半恢复。`);
  return restored;
}

/* ---------- 攻击之后 ---------- */
/* ---------- 下潜（u.submerged）：钻进沙层 / 地下。定位和飞行类似，任何单位都可以带 ----------
 *   下潜中不能被选为目标，范围攻击也打不到；自己发动攻击时解除（主动解除，没有代价）。
 *   例外：谐波攻击（单体、范围都算）照样打得到；塌陷区域的伤害也打得到。被这两种打到时下潜被迫解除，受到 1 击破。 */
function isSubmerged(u) {
  return !!(u && u.submerged && !u.dead);
}
/** 选单位的名单（技能分步里选单位的那几步、最后单独选的目标、刀头切换的追击……）里能不能有它（#360）：
 *  下潜中的不能被选为目标，只有谐波攻击照样选得到（harmonic = 这一下是谐波攻击，见 engine.js · SKILL_HITS_SUBMERGED）。塌陷是区域伤害，不用选 */
function submergedPickOk(u, harmonic) {
  return !isSubmerged(u) || !!harmonic;
}
/** 进入下潜 */
function submergeUnit(u, notes) {
  if (!u || u.dead || u.submerged) return false;
  u.submerged = true;
  if (notes) notes.push(`${u.name} 下潜。`);
  return true;
}
/** 解除下潜。forced：被谐波 / 塌陷打出来，受到 1 击破（element 是这一击的属性） */
function surfaceUnit(u, notes, forced, why, element) {
  if (!u || !u.submerged) return false;
  u.submerged = false;
  notes = notes || [];
  notes.push(`${u.name} ${forced ? `被${why || "打"}出沙层，下潜被迫解除` : `${why || "发动攻击"}，下潜解除`}。`);
  if (forced && typeof dealBreak === "function") dealBreak(u, 1, element || "physical", notes, "下潜被迫解除");
  return true;
}

/* ---------- 目盲（通用状态 statuses.blind，#405；数值在 engine.js · BLIND）----------
 *   攻击有 missPct% 概率落空：app.js · dealToInner 等这一击确定打得出去（射程、躲藏、飞行、危墙都过了，代挡也换好了人）再掷 d100，
 *   落空就到此为止——不进协助格挡、碰不到屏障，没有伤害、击破和任何命中效果。等格挡结果的那一击落下时不再掷（flags.blindChecked）。
 *   被格挡下来的概率 +blockPct%（app.js · finalBlockChance）。落空一次、或者攻击被格挡下来一次（拿武器挡住、空手挡住、以身作盾、
 *   敌人的自动格挡都算）就解除。 */
function isBlind(u) {
  return !!(u && u.statuses && u.statuses.blind);
}
/** 目盲解除；why：「攻击落空」「的攻击被格挡下来」 */
function clearBlind(u, notes, why) {
  if (!isBlind(u)) return false;
  u.statuses.blind = false;
  if (notes) notes.push(`${u.name} ${why}，目盲解除。`);
  return true;
}
/** 这一击要不要掷落空骰（flags：dealTo 的 opt.flags）：攻击者目盲、是攻击行动。协助攻击、借机攻击这些反应照样掷。不掷的：
 *  出手时已经掷过（等格挡结果的那一击）；环境 / 持续伤害；首领机制（锁定的机制伤害，不算攻击行动）；导体随机跳到的那一下；
 *  维塔斯借刺入的针尖出手（针就在目标身上）；范围攻击（BLIND.aoe 打开才掷）；打濒死倒地的人（起身之前本来就不受伤害） */
function blindRollApplies(a, t, flags) {
  if (!isBlind(a) || !t || !flags) return false;
  if (flags.blindChecked || !flags.action || flags.environment) return false;
  if (flags.mechId || flags.locked || flags.conductorExtra || flags.viaPierce) return false;
  if (flags.aoe && !BLIND.aoe) return false;
  if (typeof isDownProtected === "function" && isDownProtected(t)) return false;
  return true;
}
/** 掷落空骰：d100 ≤ BLIND.missPct 就落空，目盲随即解除。返回 { miss, roll, notes } */
function blindRoll(a, t) {
  const pct = Number(BLIND.missPct) || 0;
  const roll = 1 + Math.floor(Math.random() * 100);
  const miss = roll <= pct;
  const notes = [`${a.name} 目盲：d100=${roll}（落空率 ${pct}%）→ ${miss ? `对 ${t.name} 的攻击落空` : "没有落空"}。`];
  if (miss) clearBlind(a, notes, "攻击落空");
  return { miss, roll, notes };
}
/** 攻击者目盲：被格挡下来的概率 +BLIND.blockPct（app.js · finalBlockChance 和其他加成加算，加完再封顶） */
function blindBlockBonus(a) {
  return isBlind(a) ? Number(BLIND.blockPct) || 0 : 0;
}
/** 攻击被格挡下来（协助格挡成功、空手格挡成功、以身作盾、敌人的自动格挡）：攻击者的目盲解除 */
function blindOnBlocked(a, notes) {
  return clearBlind(a, notes, "的攻击被格挡下来");
}

/** 攻击者打完一次攻击行动（dealTo，action 且不是反应） */
function afterAttackDealt(a, t, element, res, opt, notes) {
  if (!a || !t || !res || res.ok === false) return;
  const flags = opt.flags || {};
  // 躲藏：发动攻击后解除
  if (a.statuses && a.statuses.hide) {
    a.statuses.hide = false;
    notes.push(`${a.name} 发动攻击，躲藏解除。`);
  }
  // 霜结：使用冰属性攻击时恢复 1 架势值
  if (a.self === "frost" && element === "ice" && (Number(a.def) || 0) < (Number(a.defMax) || 0)) {
    a.def = Math.min(Number(a.defMax) || 0, (Number(a.def) || 0) + 1);
    notes.push(`${a.name} 霜结：冰属性攻击恢复 1 架势 → ${a.def}。`);
  }
  // 溅射：使用酸属性单体攻击时会在同区域对敌人造成 25% 溅射伤害
  if (a.self === "splash" && element === "acid" && !flags.aoe && !res.blocked && (res.total || 0) > 0) {
    const share = Math.floor((res.total || 0) * 0.25);
    if (share > 0) {
      enemiesOf(a).filter(x => x.id !== t.id && Number(x.zone) === Number(t.zone)).forEach(x => {
        applyTypedDot(x, share, "acid", notes, `${a.name} 溅射 → ${x.name}`);
      });
    }
  }
  // 导体：按攻击段数计数，不是按一次攻击行动。每三段让这一段再打到一个随机敌对目标；
  // 雷鸣下变为每两段一次。额外那一下是触发的那一段对新目标「重新结算」：用这一段吃目标修正之前的基础包
  // （ATK × 这一段的倍率 + 骰子）和原始击破，再按新目标自己的情况算克制、飞行、减伤……
  // 不拿原目标结算后的数值（以前原目标飞行 / 咬牙坚持，额外目标也跟着减半）。额外那一下自己不再计数，避免连环触发。
  if (a.self === "conductor" && !flags.conductorExtra) {
    const segs = (res.perHit && res.perHit.length) ? res.perHit : [{ base: res.rawBase || 0 }];
    const ob = opt._origBaseBreak !== undefined ? opt._origBaseBreak : opt.baseBreak;
    const baseBr = ob != null ? Math.max(0, Number(ob) || 0) : 1;
    const every = currentWeatherFor(a) === "thunder" ? 2 : 3;
    segs.forEach((seg, i) => {
      a._conductorHits = (Number(a._conductorHits) || 0) + 1;
      if (a._conductorHits % every !== 0) return;
      const pool = enemiesOf(a).filter(x => x.id !== t.id);
      const extra = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
      if (!extra) return;
      const dmg = Math.max(0, Number(seg.base) || 0);
      // 「共 N 击破」的多段攻击，击破只记在第一段；其余照原技能每段的击破
      const br = opt.breakOnce ? (i === 0 ? baseBr : 0) : baseBr;
      notes.push(`${a.name} 导体：第 ${a._conductorHits} 段额外击中 ${extra.name}。`);
      if (dmg <= 0 && br <= 0) return;
      const out = dealTo(a, extra, {
        element: element,
        mult: 0,
        flat: dmg,
        hits: 1,
        baseBreak: br,
        atk: 0,
        usePrep: false,
        atkRange: opt.atkRange,
        bleed: opt.bleed,   // 出血是这一段攻击自己的效果，对新目标重新结算时照样带着
        flags: Object.assign({}, flags, { conductorExtra: true, blockResolved: true, block: "none", action: true })
      });
      if (out && out.extra) notes.push(...out.extra);
    });
  }
}

/* ---------- 击破 ---------- */
/** 受到击破之后（多普勒：自身受到击破时，施加同量击破给同区域所有单位，不分敌我）。
 *  wasDoppler：这一下击破落下时还是多普勒（被这一下打进失衡、多普勒随晕眩结束了，这一下照样传出去） */
function onBreakTaken(u, amount, element, notes, wasDoppler) {
  if (!u || !(amount > 0) || u._dopplerBusy) return;
  if (u.self !== "doppler" && !wasDoppler) return;
  u._dopplerBusy = true;
  (state.units || []).filter(x => x && x.id !== u.id && !x.dead && !x.hidden && !x._removed && Number(x.zone) === Number(u.zone)).forEach(x => {
    x._dopplerBusy = true;
    dealBreak(x, amount, element || "harmonic", notes, `${u.name} 多普勒`, { by: u });
    x._dopplerBusy = false;
  });
  u._dopplerBusy = false;
}

/** 被打进失衡的那一刻 */
function onBroken(u, notes) {
  if (!u || u.dead) return;
  // 燃料罐（火焰喷射兵）：被打进失衡时罐子破裂（enemies.js · riotFuelBurst）
  if (u.kit === "riot_flamer" && typeof riotFuelBurst === "function") riotFuelBurst(u, notes);
  // 刺骨：目标被击破时再次造成一次此伤害
  if (u.instant && u.instant.sting) stingPulse(u, "ice", notes, "刺骨（被击破）");
  // 过载：若过载期间被击破，发生过载爆炸，单位受到 等级 × 1d4 点电属性伤害
  if (u.instant && u.instant.overload) {
    const n = Math.max(1, Number(u.level) || 1);
    const r = takeDice(n, 4, 0);
    applyTypedDot(u, r.total, "electric", notes, `${u.name} 过载爆炸 ${r.text}`);
  }
}

/* ---------- 自我效果 ---------- */
/** 自我效果带来的免疫与限制。回合开始、回合结束、感电触发前都会检查 */
function selfImmunities(u, notes) {
  if (!u || !u.statuses) return;
  // 自焚：免疫灼烧。共振、赤牙「点燃」这类直接写进灼烧的来源，在回合结束结算前就清掉，不会先烫一跳
  if (u.self === "burn" && Number(u.statuses.burn) > 0) { u.statuses.burn = 0; notes.push(`${u.name} 自焚：免疫灼烧，灼烧层清除。`); }
  // 霜结：免疫冻伤
  if (u.self === "frost" && u.statuses.frostbite) { u.statuses.frostbite = false; notes.push(`${u.name} 霜结：免疫冻伤。`); }
  // 溅射：免疫腐蚀
  if (u.self === "splash" && u.statuses.corr) { u.statuses.corr = false; notes.push(`${u.name} 溅射：免疫腐蚀。`); }
  // 导体：免疫感电；架势条上限仅为 3
  if (u.self === "conductor") {
    if (u.statuses.shock) { u.statuses.shock = false; notes.push(`${u.name} 导体：免疫感电。`); }
    if ((Number(u.def) || 0) > 3) u.def = 3;
  }
}
/** 晕眩后自我效果结束（精简版 7.6 每一种都写了「晕眩后效果结束」；玩家手册第四章：晕眩后多数自我效果随之结束）。
 *  蓄能累积的高能值不清零。被打进失衡的那一刻结算（攻击、击破、不稳、高压转晕眩……），回合开始再兜一次底。
 *  首领 / 10 级起的精英（攒晕眩标记的）：标记没攒满的那次失衡马上就恢复架势，不算真正晕眩，自我效果不结束（stunShrugged）；
 *  攒满标记、真正晕眩才结束。以前只有攻击的那条路先恢复再结算，直接击破（dealBreak）、高压转晕眩这几条路在第一个标记就结束了。
 *  返回 true = 结束了一种自我效果 */
function endSelfOnStun(u, notes) {
  if (!u || !u.stunned || !u.self || u.self === "none") return false;
  if (stunShrugged(u)) return false;
  const was = u.self;
  u.self = "none";
  u.selfBurnStacks = 0;
  u._conductorHits = 0;
  if (u.resources && u.resources.frostShell) u.resources.frostShell = false;   // 再次霜结的完全免疫随霜结一起结束
  const name = typeof selfName === "function" ? selfName(was) : was;
  if (notes) notes.push(`${u.name} 晕眩，${name}结束${was === "store" ? `（累计的高能值 ${Number(u.highEnergy) || 0} 不清零）` : ""}。`);
  if (was === "frenzy") syncFrenzyPosture(u, notes);   // 狂暴扣的架势上限还回去
  return true;
}
/** 这次失衡是不是「标记没攒满、马上恢复架势」的那种（app.js · isBossUnit / noteBossBreak / bossQuickRecover）：
 *  首领、10 级起的精英、和载具合并的驾驶员，算上这一次（还没记标记的先算上）标记不到 BOSS_STUN_MARKS 个 */
function stunShrugged(u) {
  if (!u || typeof isBossUnit !== "function" || !isBossUnit(u)) return false;
  const need = typeof BOSS_STUN_MARKS !== "undefined" ? BOSS_STUN_MARKS : 2;
  const marks = (Number(u.stunMarks) || 0) + (u._bossMarked ? 0 : 1);
  return marks < need;
}

/** 自我效果对架势上限的限制（导体 3） */
/** 震荡（玩家手册第四章「物理 · 震荡」）：架势条上限减少 2。
 *  直接改 defMax（界面、回满架势、协助攻击回满都跟着变），记下扣了多少，状态消失时还回去。
 *  上限最少留 1，免得一挨震荡就永远处在失衡里。状态从哪里来都一样：施加时、回合交界时对一遍账。 */
function syncShockwave(u, notes) {
  if (!u || !u.statuses) return;
  const on = !!u.statuses.shockwave;
  // 加倍计量：震荡扣的上限也翻倍（−4），加倍计量结束后照常只扣 2
  const mult = typeof statusMult === "function" ? statusMult(u) : 1;
  const had = Number(u._waveCut) || 0;
  const full = (Number(u.defMax) || 0) + had;   // 没被震荡扣过时的上限
  const want = on ? Math.min(2 * mult, Math.max(0, full - 1)) : 0;
  if (want === had) return;
  u.defMax = full - want;
  u._waveCut = want;
  const defWas = Number(u.def) || 0;
  if (defWas > u.defMax) u.def = u.defMax;
  // 没给 notes（popStatus 等处）：直接写进当前日志，按发生的时刻排
  if (!notes && typeof appendLog === "function" && typeof state !== "undefined" && state && state.combatStarted) notes = { push: t => appendLog(t) };
  if (notes) {
    if (defWas > u.defMax) notes.push(`${u.name} 震荡${mult > 1 ? "（加倍计量）" : ""}：架势上限 −${want} → ${u.defMax}，架势 ${defWas} → ${u.def}。`);
    else if (want > 0) notes.push(`${u.name} 震荡${mult > 1 ? "（加倍计量）" : ""}：架势上限 −${want} → ${u.defMax}。`);
    else notes.push(`${u.name} 震荡解除：架势上限恢复到 ${u.defMax}。`);
  }
  // 震荡少扣了（解除 / 加倍计量结束）：狂暴被「上限最少留 1」挡住没扣满的，按新的上限再对一次账
  if (want < had) syncFrenzyPosture(u, notes);
}
function syncShockwaveAll(notes) {
  ((typeof state !== "undefined" && state.units) || []).forEach(u => syncShockwave(u, notes));
}

function postureCap(u) {
  const cap = Number(u && u.defMax) || 0;
  return u && u.self === "conductor" ? Math.min(3, cap) : cap;
}
/** 千钧：无法通过任何方式恢复架势条 */
function canRestorePosture(u) {
  return !(u && u.self === "anchor");
}

/**
 * 施加自我效果（技能用）。同时只能存在一种。
 * 霜结状态下再次使用霜结：到下回合开始前完全免受伤害、击破和位移。
 */
function castSelfEffect(u, kind, notes) {
  notes = notes || [];
  if (!u) return notes;
  if (kind === "frost" && u.self === "frost") {
    u.resources = u.resources || {};
    u.resources.frostShell = true;
    notes.push(`${u.name} 再次霜结：下回合开始前完全免受伤害、击破和位移。`);
    return notes;
  }
  u.self = kind;
  if (kind === "burn") u.selfBurnStacks = Math.max(1, Number(u.selfBurnStacks) || 1);
  selfImmunities(u, notes);
  syncFrenzyPosture(u, notes);   // 进入狂暴扣架势上限；从狂暴换成别的自我效果，扣的还回去
  return notes;
}

/* ---------- 狂暴（自我效果；下水道狂鼠的核心机制，docs/ratfolk.md 2.1） ----------
 * 在各兵种写明的条件下进入，一律调 enterFrenzy；失衡 / 晕眩中进不去（任何来源都一样），恢复以后可以再进。
 * 照其他自我效果一样晕眩后结束（endSelfOnStun；首领 / 10 级起的精英要攒满晕眩标记、真正晕眩才结束），中和照常清掉。
 *   atkPerLevel  ATK + 等级 × 这个数（party.js · effectiveAtk → frenzyAtkBonus）
 *   breakBonus   造成的击破 +n：每一次攻击、多段攻击的每一段各加（engine.js · resolveAttack，和千钧同一处 → frenzyBreakBonus）
 *   takenCut     受到的所有伤害 −n，和其他百分比加算（engine.js · resolveAttack → frenzyTakenCut；无可阻挡照样无视）
 *   freeMoves    每回合可以免费移动几次：不花附赠 / 行动点（app.js · doMoveInner / moveBaseCost，ai.js · canPayMove，gm-commands.js · checkMove）
 *   postureCut   架势上限 −n：照震荡直接改 defMax，进入时扣、解除时还（syncFrenzyPosture），和震荡等其他减上限的效果叠加，上限最少留 1
 *   tideShare    阵营被动「狂潮」：存活的狂鼠里狂暴的占到这个比例（含）就全体狂暴（frenzyTide） */
const FRENZY = { atkPerLevel: 1, breakBonus: 1, takenCut: 0.25, freeMoves: 1, postureCut: 2, tideShare: 0.5 };
function frenzyAtkBonus(u) {
  return u && u.self === "frenzy" ? Math.max(1, Number(u.level) || 1) * FRENZY.atkPerLevel : 0;
}
function frenzyBreakBonus(a) { return a && a.self === "frenzy" ? FRENZY.breakBonus : 0; }
function frenzyTakenCut(t) { return t && t.self === "frenzy" ? FRENZY.takenCut : 0; }
/** 狂暴的效果说明（悬停说明 unit-tip.js、徽章提示 hud-icons.js 用；数值都读 FRENZY）。给了 u 就写出这名单位实际加多少 ATK */
function frenzyEffectText(u) {
  const atk = u ? `ATK +${Math.max(1, Number(u.level) || 1) * FRENZY.atkPerLevel}` : FRENZY.atkPerLevel === 1 ? "ATK + 等级" : `ATK + 等级 × ${FRENZY.atkPerLevel}`;
  const moves = FRENZY.freeMoves === 1 ? "一次" : FRENZY.freeMoves + " 次";
  return `${atk}；造成的击破 +${FRENZY.breakBonus}（每一次攻击、每一段命中各加）；受到的所有伤害 −${Math.round(FRENZY.takenCut * 100)}%（和其他百分比加算）；` +
    `每回合可以免费移动${moves}（不花附赠 / 行动点）；架势上限 −${FRENZY.postureCut}（可以和震荡等叠加，最少留 1）。` +
    `晕眩后解除（首领 / 10 级起的精英要攒满晕眩标记、真正晕眩才解除），中和也能清掉；失衡 / 晕眩中不能进入。`;
}

/** 进入狂暴（下水道狂鼠的兵种、阵营被动「狂潮」都调这一个）。why：为什么进入（写进日志，例如「狂潮」「协助」）。
 *  失衡 / 晕眩中的进不去；已经在狂暴的不重复进入。返回 true = 这次进入了狂暴 */
function enterFrenzy(u, notes, why) {
  notes = notes || [];
  if (!u || u.dead || u._removed || u.self === "frenzy") return false;
  if (u.stunned || (typeof isEffectivelyStunned === "function" && isEffectivelyStunned(u))) {
    notes.push(`${u.name} 失衡中，不能进入狂暴。`);
    return false;
  }
  const moves = FRENZY.freeMoves === 1 ? "免费移动一次" : `免费移动 ${FRENZY.freeMoves} 次`;
  notes.push(`${u.name} 进入狂暴${why ? "（" + why + "）" : ""}：ATK +${Math.max(1, Number(u.level) || 1) * FRENZY.atkPerLevel}、击破 +${FRENZY.breakBonus}、` +
    `受到的伤害 −${Math.round(FRENZY.takenCut * 100)}%、每回合可以${moves}、架势上限 −${FRENZY.postureCut}。`);
  castSelfEffect(u, "frenzy", notes);   // 同时只能有一种自我效果；架势上限在这里扣（syncFrenzyPosture）
  if (typeof spawnPopup === "function") spawnPopup(u, { kind: "status", text: "狂暴", element: "physical" });
  return true;
}

/** 狂暴的架势上限 −postureCut（照震荡 syncShockwave 的做法）：直接改 defMax，记下扣了多少（_frenzyCut），不在狂暴了就还回去。
 *  上限最少留 1。和震荡叠加：两边都按扣过对方之后的上限算；一边还回去时，另一边被「最少留 1」挡住没扣满的再对一次账。
 *  进入 / 结束 / 被中和 / 换成别的自我效果时调，回合开始、回合结束再对一遍账（主持人直接改了自我效果也跟得上） */
function syncFrenzyPosture(u, notes) {
  if (!u) return;
  const on = u.self === "frenzy";
  const had = Number(u._frenzyCut) || 0;
  const full = (Number(u.defMax) || 0) + had;   // 没被狂暴扣过时的上限
  const want = on ? Math.min(FRENZY.postureCut, Math.max(0, full - 1)) : 0;
  if (want === had) return;
  u.defMax = full - want;
  u._frenzyCut = want;
  const defWas = Number(u.def) || 0;
  if (defWas > u.defMax) u.def = u.defMax;
  // 没给 notes：直接写进当前日志，按发生的时刻排（和震荡一样）
  if (!notes && typeof appendLog === "function" && typeof state !== "undefined" && state && state.combatStarted) notes = { push: t => appendLog(t) };
  if (notes) {
    if (want > had) notes.push(`${u.name} 狂暴：架势上限 −${want} → ${u.defMax}${defWas > u.defMax ? `，架势 ${defWas} → ${u.def}` : ""}。`);
    else notes.push(`${u.name} ${on ? "狂暴" : "狂暴结束"}：架势上限恢复到 ${u.defMax}。`);
  }
  // 狂暴少扣了（结束 / 被清掉）：震荡被「最少留 1」挡住没扣满的，按新的上限再对一次账
  if (want < had && typeof syncShockwave === "function") syncShockwave(u, notes);
}

/** 这回合还有没有狂暴的免费移动（每回合 FRENZY.freeMoves 次，回合按 state.turnNo 算） */
function frenzyFreeMoveReady(u) {
  if (!u || u.self !== "frenzy") return false;
  const r = u.resources || {};
  const used = typeof state !== "undefined" && r.frenzyMoveTurn === state.turnNo ? Number(r.frenzyMoves) || 0 : 0;
  return used < FRENZY.freeMoves;
}
/** 用掉一次这回合的免费移动（app.js · doMoveInner） */
function useFrenzyFreeMove(u) {
  if (!u) return;
  const r = u.resources = u.resources || {};
  if (r.frenzyMoveTurn !== state.turnNo) { r.frenzyMoveTurn = state.turnNo; r.frenzyMoves = 0; }
  r.frenzyMoves = (Number(r.frenzyMoves) || 0) + 1;
}

/** 溅射：任意移动后失去 15% 最大生命 */
function afterMove(u, notes) {
  if (!u || u.self !== "splash" || u.dead) return;
  const loss = Math.max(1, Math.floor(totalMaxHp(u) * 0.15));
  applyTrueDamage(u.layers, loss);
  notes.push(`${u.name} 溅射：移动后失去 ${loss} 生命（15% 最大生命）。`);
}

/* ---------- 狂鼠的阵营共用被动：狂潮（docs/ratfolk.md 2.2） ---------- */
/** 狂鼠的阵营名（run.js · ENEMY_INFO 的 faction；四个兵种见 enemies.js · RAT_CFG，和所有阵营敌对：enemies.js · HOSTILE_FACTIONS） */
const RATFOLK_FACTION = "狂鼠";
function isRatfolk(u) {
  return !!u && !u.isPlayer && typeof factionOf === "function" && factionOf(u) === RATFOLK_FACTION;
}
/** 敌人回合开始时（app.js · startEnemyPhase，失衡的敌人恢复之前）：存活的狂鼠里，狂暴的数量 ≥ 存活数量 × FRENZY.tideShare（一半）
 *  → 所有狂鼠进入狂暴。失衡 / 晕眩中的不进入，但照样算进存活数量。返回 true = 触发了 */
function frenzyTide(notes) {
  notes = notes || [];
  const alive = ((typeof state !== "undefined" && state.units) || []).filter(u => isRatfolk(u) && !u.dead && !u._removed && !u.hidden && !u.fused);
  if (!alive.length) return false;
  const on = alive.filter(u => u.self === "frenzy").length;
  if (on < alive.length * FRENZY.tideShare) return false;
  const stunned = u => u.stunned || (typeof isEffectivelyStunned === "function" && isEffectivelyStunned(u));
  const join = alive.filter(u => u.self !== "frenzy" && !stunned(u));
  if (!join.length) return false;
  const out = alive.filter(u => u.self !== "frenzy" && stunned(u)).length;
  const share = FRENZY.tideShare === 0.5 ? "一半" : Math.round(FRENZY.tideShare * 100) + "%";
  notes.push(`狂潮：存活的狂鼠 ${alive.length} 只，狂暴的 ${on} 只（不少于${share}），所有狂鼠进入狂暴${out ? `（失衡中的 ${out} 只除外）` : ""}。`);
  join.forEach(u => enterFrenzy(u, notes, "狂潮"));
  return true;
}
