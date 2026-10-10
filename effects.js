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
 * 规则全部照手册原文，行内注释写了对应的句子。
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
    // 过载：护盾值此回合内翻倍，下回合开始时清零
    (u.layers || []).forEach(l => {
      if (l.type !== "shield") return;
      l._overloadMax = Number(l.max) || 0;
      l.max = l._overloadMax * 2;
      l.current = (Number(l.current) || 0) * 2;
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
    if (l._overloadMax != null) { l.max = l._overloadMax; delete l._overloadMax; }
    l.current = 0;
  });
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
  if (!u || !(dealt > 0)) return;
  ctx = ctx || {};
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
  if (ctx.action && ctx.melee && ctx.attacker && u.instant && u.instant.overload && ctx.startLayerType === "armor" && !ctx.attacker.dead) {
    const back = Math.floor(dealt * 0.5);
    if (back > 0) applyTypedDot(ctx.attacker, back, "electric", notes, `${u.name} 过载反伤 → ${ctx.attacker.name}`);
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
  // 导体：每三次攻击都会让第三次攻击额外击中一个随机敌对目标；雷鸣下变为每两次一次
  if (a.self === "conductor" && !flags.conductorExtra) {
    a._conductorHits = (Number(a._conductorHits) || 0) + 1;
    const every = currentWeatherFor(a) === "thunder" ? 2 : 3;
    if (a._conductorHits % every === 0) {
      const pool = enemiesOf(a).filter(x => x.id !== t.id);
      const extra = pool[Math.floor(Math.random() * pool.length)];
      if (extra) {
        notes.push(`${a.name} 导体：第 ${a._conductorHits} 次攻击额外击中 ${extra.name}。`);
        const out = dealTo(a, extra, Object.assign({}, opt, {
          flags: Object.assign({}, flags, { conductorExtra: true, blockResolved: true, block: "none" })
        }));
        if (out && out.extra) notes.push(...out.extra);
      }
    }
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
 *  返回 true = 结束了一种自我效果 */
function endSelfOnStun(u, notes) {
  if (!u || !u.stunned || !u.self || u.self === "none") return false;
  const was = u.self;
  u.self = "none";
  u.selfBurnStacks = 0;
  u._conductorHits = 0;
  if (u.resources && u.resources.frostShell) u.resources.frostShell = false;   // 再次霜结的完全免疫随霜结一起结束
  const name = typeof selfName === "function" ? selfName(was) : was;
  if (notes) notes.push(`${u.name} 晕眩，${name}结束${was === "store" ? `（累计的高能值 ${Number(u.highEnergy) || 0} 不清零）` : ""}。`);
  return true;
}

/** 自我效果对架势上限的限制（导体 3） */
/** 震荡（玩家手册第四章「物理 · 震荡」）：架势条上限减少 2。
 *  直接改 defMax（界面、回满架势、协助攻击回满都跟着变），记下扣了多少，状态消失时还回去。
 *  上限最少留 1，免得一挨震荡就永远处在失衡里。状态从哪里来都一样：施加时、回合交界时对一遍账。 */
function syncShockwave(u, notes) {
  if (!u || !u.statuses) return;
  const on = !!u.statuses.shockwave;
  if (on && !u._waveCut) {
    const cut = Math.min(2, Math.max(0, (Number(u.defMax) || 0) - 1));
    if (!cut) return;
    u._waveCut = cut;
    u.defMax -= cut;
    if ((Number(u.def) || 0) > u.defMax) u.def = u.defMax;
    if (notes) notes.push(`${u.name} 震荡：架势上限 −${cut} → ${u.defMax}。`);
  } else if (!on && u._waveCut) {
    u.defMax += u._waveCut;
    if (notes) notes.push(`${u.name} 震荡解除：架势上限恢复到 ${u.defMax}。`);
    u._waveCut = 0;
  }
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
  return notes;
}

/** 溅射：任意移动后失去 15% 最大生命 */
function afterMove(u, notes) {
  if (!u || u.self !== "splash" || u.dead) return;
  const loss = Math.max(1, Math.floor(totalMaxHp(u) * 0.15));
  applyTrueDamage(u.layers, loss);
  notes.push(`${u.name} 溅射：移动后失去 ${loss} 生命（15% 最大生命）。`);
}
