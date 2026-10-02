/* ===== 区域预警（通用部件）=====================================
 * 敌人先标定区域、之后的回合才结算的范围攻击，都登记在这里。
 * 计算器和游戏都读这一份，区域会显示红框和提示。
 *
 * 加新敌人只要往 ZONE_THREATS 加一行：
 *   kit: (u) => ({ zone, label, ready }) | [多条] | null
 *     zone  要打的区
 *     label 显示的短标签
 *     ready true 表示这回合就会落地（红框更醒目）
 * ============================================================== */
const ZONE_THREATS = {
  mecha_gl: (u) => {
    const r = u.resources || {};
    if (!r.glPending || !r.glZone) return null;
    return { zone: r.glZone, label: r.glReady ? "榴弹待发" : "榴弹标定", ready: !!r.glReady };
  },
  ufo_body: (u) => {
    const r = u.resources || {};
    if (!r.boomReady) return null;
    const n = Number(typeof state !== "undefined" ? state.zoneMode : 2) || 2;
    const out = [];
    for (let z = 1; z <= n; z++) out.push({ zone: z, label: "自爆待发", ready: true });
    return out;
  },
  sand_aggregate: (u) => {
    const r = u.resources || {};
    if (!r.forceCharge) return null;
    return { zone: u.zone, label: "电能炮蓄力", ready: false };
  },
  boomcar: (u) => {
    const r = u.resources || {};
    if (r.fuse == null || Number(r.fuse) > 0) return null;
    return { zone: u.zone, label: "引信已到", ready: true };
  },
  chixia: (u) => {
    const r = u.resources || {};
    if (!r.primed) return null;
    return { zone: u.zone, label: "霰弹预热", ready: false };
  }
};

/** 返回场上全部区域预警：[{ zone, label, from, ready }] */
function zoneThreats(units) {
  const list = units || (typeof state !== "undefined" ? state.units : []) || [];
  const out = [];
  list.forEach(u => {
    if (!u || u.isPlayer || u.dead || u.hidden || u.fused) return;
    const fn = ZONE_THREATS[u.kit];
    if (typeof fn !== "function") return;
    let res = null;
    try { res = fn(u); } catch (e) { res = null; }
    if (!res) return;
    (Array.isArray(res) ? res : [res]).forEach(o => {
      const z = Number(o && o.zone);
      if (!(z >= 1)) return;
      out.push({ zone: z, label: o.label || "范围攻击", from: u.name || "", ready: !!o.ready });
    });
  });
  return out;
}

/** 某一区的预警 */
function zoneThreatsIn(zone) {
  return zoneThreats().filter(t => Number(t.zone) === Number(zone));
}

function enemyAssistSkillId(u) {
  if (u && u.kit === "ufo_body") return "ufo_assist";
  const list = (typeof enemySkillList === "function" && enemySkillList(u)) || [];
  const hit = list.find(s => s.id && s.id.indexOf("_assist") >= 0);
  return hit ? hit.id : "en_aa";
}

function extraDiceByLevel(lv) {
  return 1;
}
function addedDiceByLevel(lv) {
  return 1 + (typeof milestone === "function" ? milestone(lv, 5) : Math.floor(Math.max(1, lv || 1) / 5));
}
/** 哗变时狂徒不敢贸然出手：只打 1d6 物理，每十级升一档骰 */
function mutinyDieSides(lv) {
  return upgradeDieSides(6, dieStep(lv || 1, 10));
}

function addedDiceByLevel10(lv) {
  return 1 + (typeof milestone === "function" ? milestone(lv, 10) : Math.floor(Math.max(1, lv || 1) / 10));
}

/** 亡命之王 · 哗变系统
 * 触发：强盗头子血量≤25%，且与亡命之王同区，且同区没有其他狂徒（thug_ 前缀）。
 * 效果：亡命之王被挟持（无法行动、受到伤害+25%、基础"攻击被同区狂徒承受"的保护失效），
 *       同区所有狂徒改为唯一可选"反水攻击强盗头子"。
 * 解除：挟持者（强盗头子）死亡则自动解除；亡命之王死亡则强盗头子继位，atk/def翻倍。
 */
function checkMutiny(state) {
  const king = findKit("outlaw_king", state.units);
  const boss = findKit("bandit_boss", state.units);
  if (!king || !boss || king.dead || boss.dead) return null;
  king.resources = king.resources || {};
  boss.resources = boss.resources || {};
  if (king.resources.hostage) return null;
  const hpPct = totalMaxHp(boss) > 0 ? totalHp(boss) / totalMaxHp(boss) : 1;
  if (hpPct > 0.25) return null;
  if (Number(boss.zone) !== Number(king.zone)) return null;
  const otherThugs = (state.units || []).filter(u =>
    !u.isPlayer && u !== boss && !u.dead && !u.hidden &&
    Number(u.zone) === Number(king.zone) && /^thug_/.test(u.kit || "")
  );
  if (otherThugs.length > 0) return null;
  king.resources.hostage = true;
  king.resources.focusId = null;
  boss.resources.mutinied = true;
  return `${boss.name} 哗变：抓住 ${king.name}！${king.name} 本回合起无法行动，受到伤害 +25%，直到 ${boss.name} 死亡或 ${king.name} 被击杀。`;
}

/** 狂徒（匕首 / 锤）与强盗头子 */
function isOutlawThug(u) {
  return !!u && !u.isPlayer && !u.dead && !u.hidden && /^(thug_|bandit_boss)/.test(u.kit || "");
}

/** 主持人手册：对亡命之王的攻击总被同区其他狂徒承受（被挟持时失效）。返回替他挨打的狂徒，没有则 null。
 *  同区有多个时挑剩余血量最多的那个（手下挡在最前面）。 */
function kingGuardFor(king) {
  if (!king || king.kit !== "outlaw_king" || king.dead) return null;
  if (king.resources && king.resources.hostage) return null;
  const guards = (state.units || []).filter(u => isOutlawThug(u) && Number(u.zone) === Number(king.zone));
  if (!guards.length) return null;
  return guards.sort((a, b) => totalHp(b) - totalHp(a))[0];
}

/** 攻击命令指定的目标：所有狂徒改打此人（目标倒下或王被挟持 / 死亡后失效） */
function kingFocusTarget() {
  const king = findKit("outlaw_king", state.units);
  if (!king || king.dead || !king.resources || king.resources.hostage || !king.resources.focusId) return null;
  const t = unitById(king.resources.focusId);
  if (!t || t.dead || t.dying || (t.hidden)) return null;
  return t;
}

/** 哗变的判定时机不止「强盗头子挨打」：同区最后一个狂徒倒下 / 走开也会让条件成立。
 *  回合开始、每个敌人行动前、敌人阵亡后都查一次。 */
function mutinyTick(notes) {
  if (typeof checkMutiny !== "function") return;
  const note = checkMutiny(state);
  if (!note) return;
  if (notes) notes.push(note); else appendLog(note);
}

function enemySkillList(u) {
  if (!u || u.isPlayer) return [];
  const common = [
    { id: "en_approach", label: "移向目标" },
    { id: "en_flee", label: "远离目标" },
    { id: "en_aa", label: "普通攻击" }
  ];
  const extra = {
    guard_sword: [
      { id: "en_guard_sword", label: "电击挥砍" },
      { id: "en_guard_sword_assist", label: "协助攻击" }
    ],
    guard_gun: [
      { id: "en_guard_gun_far", label: "远距射击" },
      { id: "en_guard_gun_near", label: "近距砸枪" },
      { id: "en_guard_gun_assist", label: "协助攻击" }
    ],
    thug_knife: [
      { id: "en_thug_knife", label: "匕首" },
      { id: "en_thug_opp", label: "借机攻击" },
      { id: "en_thug_knife_assist", label: "协助攻击" }
    ],
    thug_hammer: [
      { id: "en_thug_hammer", label: "砸锤" },
      { id: "en_thug_hammer_assist", label: "协助：冲近半伤" }
    ],
    boomcar: [
      { id: "en_boom_fuse", label: "引爆（范围能量）" }
    ],
    sand_beast: [
      { id: "en_sand_aa", label: "扑咬" },
      { id: "en_sand_assist", label: "协助攻击" }
    ],
    sand_human: [
      { id: "en_sand_aa", label: "沙弹" },
      { id: "en_sand_assist", label: "协助攻击" }
    ],
    buoy: [{ id: "en_buoy", label: "电击" }],
    patrol_car: [
      { id: "en_patrol_chase", label: "驶向ATK最高目标" },
      { id: "en_patrol_near", label: "近距谐波扫射（同区全体）" },
      { id: "en_patrol_far", label: "远距谐波射击（单体击破）" },
      { id: "en_patrol_assist", label: "协助攻击（无限距离谐波）" }
    ],
    dumpdrone: [{ id: "en_dump", label: "倾倒废液" }],
    swarm: [{ id: "en_swarm", label: "撞击（自身死亡）" }],
    crow: [{ id: "en_crow", label: "声波" }],
    mecha_mg: [
      { id: "en_mg_near", label: "枪管近战" },
      { id: "en_mg_far", label: "机枪点射" },
      { id: "en_mg_assist", label: "协助攻击（回满护盾）" }
    ],
    mecha_gl: [
      { id: "en_gl", label: "榴弹（选择区域）" },
      { id: "en_gl_assist", label: "喷火协助" }
    ],
    bandit_boss: [
      { id: "en_boss_near", label: "能量匕首" },
      { id: "en_boss_far", label: "自制火枪" },
      { id: "en_boss_assist", label: "协助：拔枪+狂徒连携" }
    ],
    captain_wolf: [
      { id: "en_wolf", label: "冰爪" },
      { id: "en_wolf_opp", label: "离场借机" },
      { id: "en_wolf_assist", label: "协助：冲近攻击" }
    ],
    captain_ox: [
      { id: "en_ox", label: "冲撞" }
    ],
    captain_lizard: [
      { id: "en_liz", label: "酸弹" },
      { id: "en_liz_assist", label: "协助：2×ATK 酸" }
    ],
    bigsand: [
      { id: "en_bigsand", label: "沙击" },
      { id: "en_bigsand_summon", label: "召唤沙灵 1d4" },
      { id: "en_bigsand_heal", label: "治疗最低沙灵" },
      { id: "en_bigsand_assist", label: "协助 1.5×ATK" }
    ],
    livesand: [],
    giant: [
      { id: "en_giant_near", label: "近距砸击" },
      { id: "en_giant_far", label: "远距能量" },
      { id: "en_giant_assist", label: "协助：捏碎倒地" }
    ],
    patrolboat: [
      { id: "en_boat_arc", label: "电弧扫射（距离1全体，并对一人施加感电）" }
    ],
    spreader: [{ id: "en_spread", label: "喷洒（区域酸+腐蚀）" }],
    watchcrow: [{ id: "en_watch", label: "能量射线（上高能）" }],
    dustbody: [
      { id: "en_dust_grind", label: "磨蚀" },
      { id: "en_dust_lift", label: "卷扬（推走）" }
    ],
    outlaw_king: [
      { id: "en_king_atk", label: "攻击命令" },
      { id: "en_king_kill", label: "处死命令" },
      { id: "en_king_hold", label: "回防命令（筑废铁墙）" }
    ],
    ufo_body: [],
    ufo_leg: [],
    chixia: [
      { id: "en_chi_knife", label: "匕首攻击（1点）" },
      { id: "en_chi_cover", label: "躲入掩体（2点，结束回合）" },
      { id: "en_chi_ignite", label: "引火（1点）" },
      { id: "en_chi_shot", label: "霰弹枪射击（2点，需预热）" },
      { id: "en_chi_hunt", label: "追猎（附赠）" },
      { id: "en_chi_exec", label: "剿灭（协助击晕）" }
    ]
  };
  if (u.kit === "outlaw_king" && u.resources && u.resources.hostage) {
    return []; // 被挟持：无法行动，连移动/远离/普通攻击的兜底选项都不给
  }
  let list = extra[u.kit] || [];
  if (/^thug_/.test(u.kit || "")) {
    const king = findKit("outlaw_king", state.units);
    if (king && !king.dead && king.resources && king.resources.hostage) {
      return [{ id: "en_thug_mutiny", label: `反水攻击强盗头子（只打 1d${mutinyDieSides(u.level)} 物理，强制目标强盗头子）` }];
    }
  }
  if (u.kit === "sand_aggregate") {
    const ph = (u.resources && u.resources.phase) || 1;
    const r = u.resources || {};
    if (ph === 1) {
      return [
        { id: "en_agg1_melee", label: "沙爪挥击（近）" },
        { id: "en_agg1_range", label: "砂岩块（远）" }
      ];
    }
    if (ph === 2) {
      if (r.forceOverheat) return [{ id: "en_agg2_overheat", label: "过热（跳过行动）" }];
      if (r.forceCharge) return [{ id: "en_agg2_charge", label: "蓄力电能炮" }];
      return [
        { id: "en_approach", label: "移向目标" },
        { id: "en_agg2_melee", label: "机械臂挥击（近）" }
      ];
    }
    const foes = (typeof allPlayers === "function" ? allPlayers() : []).filter(p => !p.dead && !p.dying && totalHp(p) > 0);
    const lowHp = foes.some(p => {
      const max = (typeof totalMaxHp === "function" ? totalMaxHp(p) : 0) || totalHp(p);
      return max > 0 && totalHp(p) / max < 0.5;
    });
    return [
      { id: "en_flee", label: "远离目标" },
      { id: "en_agg3_debris", label: "吸引碎片" },
      lowHp ? { id: "en_agg3_control", label: "肉体操控（血量<50%）" } : { id: "en_agg3_push", label: "推击（近）" }
    ];
  }
  if (u.kit === "ufo_leg") return [];
  if (u.kit === "ufo_body") {
    const n = typeof ufoLivingLegs === "function" ? ufoLivingLegs(u).length : 5;
    list = [];
    // 4 条腿与 5 条相同（踩踏）；2 条腿与 3 条相同（激光扫射）
    if (n >= 4) list.push({ id: "ufo_stomp", label: "踩踏（随机两名角色）" });
    else if (n >= 2) list.push({ id: "ufo_sweep", label: "激光扫射（距离1内一区全体）" });
    else if (n === 1) list.push({ id: "ufo_prime", label: "准备自爆" });
    if (u.resources && u.resources.boomReady) list.push({ id: "ufo_boom", label: "自爆（全区全员）" });
    if ((u.level || 1) >= 10 && n > 0) list.push({ id: "ufo_summon", label: "召唤机器人看守" });
    if (!list.length && n >= 1) list.push({ id: "ufo_laser", label: "能量射线" });
    return list;
  }
  if (u.kit === "mecha_gl") {
    const ready = u.resources && u.resources.glReady && u.resources.glZone;
    list = list.filter(s => s.id !== "en_gl" && s.id !== "en_gl_fire");
    if (ready) list.unshift({ id: "en_gl_fire", label: "发射榴弹（" + u.resources.glZone + "区）" });
    else list.unshift({ id: "en_gl", label: "榴弹（选择区域）" });
  }
  if (u.kit === "livesand") {
    if (u.resources && u.resources.giant) {
      list = [
        { id: "en_giant_sand_melee", label: "穿刺（最多两人）" },
        { id: "en_giant_sand_vortex", label: "流沙漩涡" }
      ];
      if ((u.resources.giantTurns || 0) >= 3) {
        list.push({ id: "en_giant_sand_pulse", label: "全域沙暴（三回合后）" });
      }
    } else {
      list = [{ id: "en_live", label: "活沙冲击" }];
    }
  }
  return common.concat(list);
}

function livingSandAllies(exceptId) {
  return (state.units || []).filter(u =>
    !u.hidden && !u.dead && u.id !== exceptId &&
    (u.kit === "sand_beast" || u.kit === "sand_human" || u.kit === "bigsand")
  );
}

function absorbSandsInto(livesand) {
  const notes = [];
  if (!livesand || livesand._sandAbsorbed) return notes;
  const sands = livingSandAllies(livesand.id);
  if (!sands.length) {
    notes.push(`${livesand.name} 死亡，场上没有可吸收的沙灵。`);
    return notes;
  }
  livesand._sandAbsorbed = true;
  sands.forEach(u => {
    const hp = Math.max(0, Math.floor(totalHp(u)));
    const layer = (livesand.layers || []).find(l => l.type === "sand") || (livesand.layers || [])[0];
    if (layer) {
      layer.current = Math.max(0, Number(layer.current) || 0) + hp;
      layer.max = Math.max(layer.current, (Number(layer.max) || 0) + hp);
    }
    livesand.atk = (livesand.atk || 0) + (u.atk || 0);
    livesand.def = (livesand.def || 0) + 1;
    livesand.defMax = (livesand.defMax || 0) + 1;
    (u.layers || []).forEach(l => { l.current = 0; });
    u.dead = true;
    notes.push(`吸收 ${u.name}：+${hp} 沙尘，+${u.atk || 0} ATK，DEF+1`);
  });
  livesand.resources = livesand.resources || {};
  livesand.resources.giant = true;
  livesand.resources.giantTurns = 0;
  livesand.name = "巨型活沙";
  livesand.dead = false;
  livesand._xpGiven = false;
  notes.push(`${livesand.name} 吸收后复活并变为巨型。生命 ${totalHp(livesand)}，ATK ${livesand.atk}，架势 ${livesand.def}/${livesand.defMax}`);
  return notes;
}

function stepTowardZone(unit, destZone, opt) {
  destZone = Number(destZone);
  const from = Number(unit.zone);
  if (from === destZone) return false;
  const dest = from < destZone ? from + 1 : from - 1;
  doMove(unit, dest, opt || {});
  return true;
}

function otherZone(zone) {
  const n = Number(state.zoneMode);
  const z = Number(zone);
  if (n === 2) return z === 1 ? 2 : 1;
  if (z === 1) return 2;
  if (z === 3) return 2;
  return 1;
}

function playersInZone(z) {
  return state.units.filter(u => u.isPlayer && !u.hidden && Number(u.zone) === Number(z));
}

function allPlayers() {
  return state.units.filter(u => u.isPlayer && !u.hidden);
}

/* 敌人每个技能各自的射程。写明的优先于单位卡上的 range，
 * 因为不少远距离敌人另有近战手段（机器人看守的近距砸枪、机甲触灵的枪管等）。
 *   melee 仅距离 0 / ranged 仅距离 1 / any 距离 0–1
 * 没列出来的按单位卡上的 range 判定。 */
const ENEMY_SKILL_RANGE = {
  en_guard_sword: "melee",
  en_guard_gun_near: "melee",
  en_guard_gun_far: "ranged",
  en_patrol_near: "melee",
  en_patrol_far: "ranged",
  en_boom_fuse: "melee",
  en_buoy: "melee",
  en_dump: "ranged",
  en_thug_knife: "melee",
  en_thug_hammer: "melee",
  en_crow: "melee",
  en_swarm: "melee",
  en_mg_near: "melee",
  en_mg_far: "ranged",
  en_boss_near: "melee",
  en_boss_far: "ranged",
  en_wolf: "melee",
  en_ox: "any",
  en_liz: "ranged",
  en_bigsand: "melee",
  en_live: "any",
  en_giant_near: "melee",
  en_giant_far: "ranged",
  en_giant_sand_melee: "melee",
  en_giant_sand_vortex: "ranged",
  en_watch: "ranged",
  en_dust_grind: "melee",
  en_dust_lift: "ranged",
  en_king_atk: "ranged",
  en_king_kill: "melee",
  en_thug_mutiny: "melee",
  en_agg1_melee: "melee",
  en_agg1_range: "ranged",
  en_agg2_melee: "melee",
  en_agg2_charge: "ranged",
  en_agg3_control: "melee",
  en_agg3_push: "melee",
  en_chi_shot: "ranged",
  en_chi_melee: "melee"
};

function runEnemyAction(id, a, t, hitOne, lines, needT) {
  const atk = effectiveAtk(a, state.units);
  const sg = a.suggest || {};
  const diceN = extraDiceByLevel(a.level);
  const baseDice = sg.dice || [1, 4];

  const skillRange = ENEMY_SKILL_RANGE[id] || a.range || "any";
  const aa = (target, opt) => hitOne(a, target, Object.assign({ atk, atkRange: skillRange }, opt));

  if (id === "en_approach") {
    if (!needT()) return true;
    if (Number(a.zone) === Number(t.zone)) lines.push("已在同一区。");
    else stepTowardZone(a, t.zone);
    return true;
  }
  if (id === "en_flee") {
    if (!needT()) return true;
    if (Number(a.zone) !== Number(t.zone)) lines.push("已经不在同一区。");
    else stepTowardZone(a, otherZone(a.zone));
    return true;
  }
  if (id === "en_aa") {
    if (!needT()) return true;
    aa(t, {
      element: sg.element || "physical",
      mult: 1,
      diceN: baseDice[0] || 0,
      diceS: baseDice[1] || 0,
      diceB: sg.flat || 0,
      baseBreak: sg.baseBreak || 1
    });
    return true;
  }

  if (id === "en_guard_sword" || id === "en_guard_sword_assist") {
    if (!needT()) return true;
    if (id === "en_guard_sword") stepTowardZone(a, t.zone);
    aa(t, {
      element: "electric",
      mult: id === "en_guard_sword_assist" ? 0 : 1,
      flat: id === "en_guard_sword_assist" ? 3 : (sg.flat || 0),
      diceN: baseDice[0] || 1,
      diceS: baseDice[1] || 4,
      baseBreak: 1
    });
    return true;
  }
  if (id === "en_guard_gun_far") {
    if (!needT()) return true;
    aa(t, { element: "energy", mult: 1, diceN: 1, diceS: 4, baseBreak: 1 });
    return true;
  }
  if (id === "en_guard_gun_near") {
    if (!needT()) return true;
    aa(t, { element: "physical", mult: 0.5, diceN: 1, diceS: 4, baseBreak: 1 });
    return true;
  }
  if (id === "en_guard_gun_assist") {
    if (!needT()) return true;
    aa(t, { element: "energy", mult: 0.5, baseBreak: 1 });
    return true;
  }
  if (id === "en_thug_knife" || id === "en_thug_opp" || id === "en_thug_knife_assist") {
    if (!needT()) return true;
    if (id === "en_thug_knife") stepTowardZone(a, t.zone);
    const react = id !== "en_thug_knife";   // 借机 / 协助不受射程与飞行附加代价限制
    aa(t, { element: "physical", mult: 1, diceN: id === "en_thug_knife" ? 1 : 0, diceS: 8, baseBreak: 1,
            flags: react ? { action: true, opportunity: true } : undefined });
    return true;
  }
  if (id === "en_thug_hammer") {
    if (!needT()) return true;
    stepTowardZone(a, t.zone);
    aa(t, { element: "physical", mult: 1, diceN: 1, diceS: 6, baseBreak: 2 });
    return true;
  }
  if (id === "en_thug_hammer_assist") {
    if (!needT()) return true;
    stepTowardZone(a, t.zone, { free: true });
    aa(t, { element: "physical", mult: 0.5, baseBreak: 1 });
    return true;
  }
  if (id === "en_boom_fuse") {
    // 手册：atk+1d6 范围能量 +2 击破，同区不分敌我。范围攻击不能协助格挡；自爆本身就是它的毁灭，不再触发死亡引爆
    const dmgOpt = { element: "energy", mult: 1, diceN: 1, diceS: 6, baseBreak: 2, flags: { action: true, aoe: true } };
    a._exploded = true;
    state.units.filter(u => !u.hidden && !u.dead && Number(u.zone) === Number(a.zone) && u.id !== a.id).forEach(u => aa(u, dmgOpt));
    if (typeof markAoeZone === "function") markAoeZone(a.zone);
    a.layers.forEach(l => { l.current = 0; });
    lines.push(`${a.name} 自爆后损毁。`);
    return true;
  }
  if (id === "en_sand_aa") {
    if (!needT()) return true;
    if (a.kit === "sand_beast") stepTowardZone(a, t.zone);
    aa(t, { element: "physical", mult: 1, diceN: 1, diceS: 4, baseBreak: 1 });
    return true;
  }
  if (id === "en_sand_assist") {
    if (!needT()) return true;
    aa(t, { element: "physical", mult: 1, diceN: 1, diceS: 8, baseBreak: 1 });
    return true;
  }
  if (id === "en_patrol_chase") {
    const foes = allPlayers().filter(u => !u.dead && !u.dying && !u.hidden);
    if (!foes.length) { lines.push("场上没有可追随的目标。"); return true; }
    foes.sort((a, b) => (effectiveAtk(b, state.units) - effectiveAtk(a, state.units)) || ((b.atk || 0) - (a.atk || 0)));
    const top = foes[0];
    if (Number(a.zone) === Number(top.zone)) lines.push(`${a.name} 已与 ATK 最高的 ${top.name} 同区。`);
    else {
      stepTowardZone(a, top.zone);
      lines.push(`${a.name} 驶向 ATK 最高的 ${top.name}（${top.zone} 区）。`);
    }
    return true;
  }
  if (id === "en_patrol_near") {
    const list = fieldUnits().filter(u => u.id !== a.id && Number(u.zone) === Number(a.zone) && !u.dead && !u.hidden);
    if (!list.length) { lines.push("同区没有其他单位。"); return true; }
    list.forEach(u => aa(u, { element: "harmonic", mult: 1, baseBreak: 0, flags: { action: true, aoe: true } }));
    if (typeof markAoeZone === "function") markAoeZone(a.zone);
    lines.push(`安保巡逻车近距扫射 ${a.zone} 区：${list.map(u => u.name).join("、")}`);
    return true;
  }
  if (id === "en_patrol_far") {
    if (!needT()) return true;
    aa(t, { element: "harmonic", mult: 1, baseBreak: 1 });
    return true;
  }
  if (id === "en_patrol_assist") {
    if (!needT()) return true;
    aa(t, { element: "harmonic", mult: 1, baseBreak: 0, flags: { action: true, assist: true } });
    return true;
  }
  if (id === "en_buoy") {
    if (!needT()) return true;
    stepTowardZone(a, t.zone);
    aa(t, { element: "electric", mult: 1, diceN: 1, diceS: (typeof leveledSides === "function" ? leveledSides(a.level, 4) : 4), baseBreak: 1 });
    return true;
  }
  if (id === "en_dump") {
    if (!needT()) return true;
    aa(t, { element: "acid", mult: 1, diceN: 1, diceS: (typeof leveledSides === "function" ? leveledSides(a.level, 4) : 4), baseBreak: 0 });
    t.statuses.corr = true;
    if (typeof popStatus === "function") popStatus(t, "corr");
    lines.push(`${t.name} 被施加腐蚀。`);
    return true;
  }
  if (id === "en_swarm") {
    if (!needT()) return true;
    stepTowardZone(a, t.zone);
    aa(t, { element: "physical", mult: 1, diceN: 2, diceS: 4, baseBreak: 1 });
    a.layers.forEach(l => { l.current = 0; });
    a.dead = true;
    lines.push(`${a.name} 撞击后损毁。`);
    if (typeof sweepDeadEnemies === "function") lines.push(...sweepDeadEnemies());
    return true;
  }
  if (id === "en_crow") {
    if (!needT()) return true;
    stepTowardZone(a, t.zone);
    aa(t, { element: "harmonic", mult: 1, diceN: 1, diceS: (typeof leveledSides === "function" ? leveledSides(a.level, 4) : 4), baseBreak: 1 });
    return true;
  }
  if (id === "en_mg_near") {
    if (!needT()) return true;
    aa(t, { element: "physical", mult: 1, diceN: 1, diceS: 6, baseBreak: 2 });
    return true;
  }
  if (id === "en_mg_far") {
    if (!needT()) return true;
    const n = 1 + Math.floor(Math.random() * 4);
    aa(t, { element: "physical", mult: 1, hits: n, baseBreak: 1 });
    return true;
  }
  if (id === "en_mg_assist") {
    if (!needT()) return true;
    aa(t, { element: "physical", mult: 2, baseBreak: 1 });
    (a.layers || []).forEach(l => { if (l.type === "shield") l.current = l.max; });
    lines.push("护盾回满。");
    return true;
  }
  if (id === "en_gl") {
    const fl = state.skillFlow;
    const zone = Number((fl && fl.picks && fl.picks.dest) || t && t.zone);
    if (!(zone >= 1)) {
      lines.push("榴弹需要先选择落点区域。");
      return true;
    }
    a.resources = a.resources || {};
    a.resources.glZone = zone;
    a.resources.glPending = true;
    a.resources.glReady = false;
    lines.push(`${a.name} 将榴弹标定在 ${zone} 区。下个敌人回合可发射。`);
    return true;
  }
  if (id === "en_gl_fire") {
    const zone = Number(a.resources && a.resources.glZone);
    if (!(zone >= 1) || !(a.resources && a.resources.glReady)) {
      lines.push("榴弹尚未就绪。先标定区域，等到下一个敌人回合再发射。");
      return true;
    }
    const victims = fieldUnits().filter(u => !u.dead && !u.hidden && Number(u.zone) === zone && u.id !== a.id && !!u.isPlayer);
    if (!victims.length) lines.push(`${zone} 区没有玩家单位。`);
    victims.forEach(u => {
      aa(u, { element: "fire", mult: 1, diceN: 1, diceS: 4, baseBreak: 2, flags: { action: true, aoe: true } });
    });
    a.resources.glZone = 0;
    a.resources.glPending = false;
    a.resources.glReady = false;
    lines.push(`${a.name} 榴弹在 ${zone} 区引爆。`);
    return true;
  }
  if (id === "en_gl_assist") {
    if (!needT()) return true;
    allPlayers().filter(u => Number(u.zone) === Number(t.zone)).forEach(u => {
      aa(u, { element: "fire", mult: 0.5, baseBreak: 1 });
    });
    return true;
  }
  if (id === "en_boss_near") {
    if (!needT()) return true;
    aa(t, { element: "energy", mult: 1, diceN: 1, diceS: 6, baseBreak: 1 });
    return true;
  }
  if (id === "en_boss_far") {
    if (!needT()) return true;
    aa(t, { element: "fire", mult: 1, diceN: 1, diceS: 8, baseBreak: 2 });
    return true;
  }
  if (id === "en_boss_assist") {
    if (!needT()) return true;
    stepTowardZone(a, otherZone(t.zone), { free: true });
    aa(t, { element: "fire", mult: 1, diceN: 1, diceS: 8, baseBreak: 2 });
    state.units.filter(u => !u.isPlayer && String(u.kit || "").indexOf("thug") === 0 && !u.hidden).forEach(th => {
      lines.push(`${th.name} 因强盗头子连携发动协助。`);
      hitOne(th, t, { atk: effectiveAtk(th, state.units), element: "physical", mult: 1, baseBreak: 1 });
    });
    return true;
  }
  if (id === "en_wolf" || id === "en_wolf_assist") {
    if (!needT()) return true;
    stepTowardZone(a, t.zone, id === "en_wolf_assist" ? { free: true } : {});
    aa(t, { element: "ice", mult: 1, diceN: 1, diceS: 4, baseBreak: 1 });
    return true;
  }
  if (id === "en_wolf_opp") {
    if (!needT()) return true;
    const n = addedDiceByLevel(a.level);
    aa(t, { element: "ice", mult: 0, diceN: n, diceS: 6, baseBreak: 1, flags: { action: true, opportunity: true } });
    return true;
  }
  if (id === "en_ox") {
    if (!needT()) return true;
    stepTowardZone(a, t.zone);
    aa(t, { element: "ice", mult: 1, diceN: addedDiceByLevel(a.level), diceS: 4, baseBreak: 2 });
    return true;
  }
  if (id === "en_ox_block") {
    const ok = Math.random() < 0.4;
    lines.push(`牛协助格挡 ${ok ? "成功" : "失败"}（40%）。`);
    if (ok && t) {
      a.def = Math.max(1, (a.def || 0) - 1);
      t.def = Math.max(0, (t.def || 0) - 1);
      if (t.def <= 0) { t.stunned = true; lines.push(imbalanceLine(t)); }
      lines.push(`成功：自身架势至少留 1，反击 1 击破 → ${t.name} 架势 ${t.def}`);
    }
    return true;
  }
  if (id === "en_liz") {
    if (!needT()) return true;
    aa(t, { element: "acid", mult: 1, diceN: 1, diceS: 6, baseBreak: 2 });
    return true;
  }
  if (id === "en_liz_assist") {
    if (!needT()) return true;
    aa(t, { element: "acid", mult: 2, baseBreak: 1 });
    return true;
  }
  if (id === "en_bigsand") {
    if (!needT()) return true;
    aa(t, { element: "physical", mult: 1, diceN: 1, diceS: 4, baseBreak: 1 });
    return true;
  }
  if (id === "en_bigsand_summon") {
    const n = 1 + Math.floor(Math.random() * 4);
    const kinds = ["sand_beast", "sand_human"];
    for (let i = 0; i < n; i++) {
      const kind = kinds[i % 2];
      const p = enemyPresets().find(x => x.id === kind);
      const u = p.build(a.level, state.partySize);
      u.zone = a.zone;
      state.units.push(u);
    }
    lines.push(`召唤了 ${n} 只沙灵到 ${a.zone} 区。`);
    return true;
  }
  if (id === "en_bigsand_heal") {
    const sands = state.units.filter(u => !u.hidden && (u.kit === "sand_beast" || u.kit === "sand_human" || u.kit === "bigsand") && u.id !== a.id);
    if (!sands.length) { lines.push("场上没有其他沙灵。"); return true; }
    sands.sort((x, y) => totalHp(x) - totalHp(y));
    const u = sands[0];
    const heal = Math.floor(diceExpect(2, 4, 0));
    const sand = (u.layers || []).find(l => l.type === "sand");
    if (sand) sand.current = Math.min(sand.max, sand.current + heal);
    lines.push(`治疗 ${u.name} 沙尘 ${heal}。`);
    return true;
  }
  if (id === "en_bigsand_assist") {
    if (!needT()) return true;
    aa(t, { element: "physical", mult: 1.5, baseBreak: 1 });
    return true;
  }
  if (id === "en_live") {
    if (!needT()) return true;
    aa(t, { element: "physical", mult: 1, baseBreak: 1 });
    return true;
  }
  if (id === "en_live_absorb") {
    lines.push(...absorbSandsInto(a));
    return true;
  }
  if (id === "en_giant_sand_melee") {
    const fl = state.skillFlow;
    const ids = [];
    if (fl && fl.picks) {
      if (fl.picks.target1) ids.push(fl.picks.target1);
      if (fl.picks.target2) ids.push(fl.picks.target2);
    }
    const pool = ids.map(id0 => unitById(id0)).filter(Boolean);
    if (!pool.length) {
      if (!needT()) return true;
      pool.push(t);
    }
    pool.forEach(u => aa(u, { element: "physical", mult: 1, baseBreak: 1 }));
    return true;
  }
  if (id === "en_giant_sand_pulse") {
    fieldUnits().forEach(u => {
      if (u.id === a.id) return;
      aa(u, { element: "physical", mult: 1, baseBreak: 0 });
    });
    lines.push("全域沙暴：对所有区域所有单位造成 1×ATK 物理。");
    return true;
  }
  if (id === "en_giant_sand_vortex") {
    if (!needT()) return true;
    allPlayers().filter(u => Number(u.zone) === Number(t.zone)).forEach(u => {
      aa(u, { element: "physical", mult: 1, baseBreak: 2 });
      u.stunned = true;
      lines.push(`${u.name} 被流沙困住，无法行动。`);
    });
    return true;
  }
  if (id === "en_giant_near") {
    if (!needT()) return true;
    aa(t, { element: "physical", mult: 1, diceN: a.level, diceS: 8, baseBreak: 2 });
    return true;
  }
  if (id === "en_giant_far") {
    if (!needT()) return true;
    aa(t, { element: "energy", mult: 1, diceN: a.level, diceS: 8, baseBreak: 1 });
    return true;
  }
  if (id === "en_giant_assist") {
    if (!needT()) return true;
    t.self = "down";
    lines.push(`${t.name} 被捏碎颅骨，倒地。`);
    return true;
  }
  if (id === "en_boat_arc") {
    const hit = allPlayers().filter(u => zoneDist(a.zone, u.zone, state.zoneMode) === 1);
    hit.forEach(u => {
      aa(u, { element: "electric", mult: 1, diceN: 1, diceS: (typeof leveledSides === "function" ? leveledSides(a.level, 6) : 6), baseBreak: 1, flags: { action: true, aoe: true } });
    });
    // 手册：可对一人施加感电。挑一个还没有感电的目标。
    const pick = hit.find(u => !(u.statuses && u.statuses.shock)) || hit[0];
    if (pick) {
      pick.statuses = pick.statuses || {};
      pick.statuses.shock = true;
      if (typeof popStatus === "function") popStatus(pick, "shock");
      lines.push(`${pick.name} 被施加感电。`);
    }
    return true;
  }
  if (id === "en_spread") {
    if (!needT()) return true;
    allPlayers().filter(u => Number(u.zone) === Number(t.zone)).forEach(u => {
      aa(u, { element: "acid", mult: 1, diceN: 1, diceS: (typeof leveledSides === "function" ? leveledSides(a.level, 6) : 6), baseBreak: 0 });
      u.statuses.corr = true;
      if (typeof popStatus === "function") popStatus(u, "corr");
    });
    return true;
  }
  if (id === "en_watch") {
    if (!needT()) return true;
    aa(t, { element: "energy", mult: 1, diceN: 1, diceS: (typeof leveledSides === "function" ? leveledSides(a.level, 8) : 8), baseBreak: 1 });
    t.statuses.high = true;
    if (typeof popStatus === "function") popStatus(t, "high");
    lines.push(`${t.name} 被施加高能。`);
    return true;
  }
  if (id === "en_dust_grind") {
    if (!needT()) return true;
    stepTowardZone(a, t.zone);
    aa(t, { element: "physical", mult: 1, diceN: 1, diceS: (typeof leveledSides === "function" ? leveledSides(a.level, 6) : 6), baseBreak: 1 });
    return true;
  }
  if (id === "en_dust_lift") {
    if (!needT()) return true;
    const canPush = Number(t.zone) === Number(a.zone) || zoneDist(a.zone, t.zone, state.zoneMode) === 1;
    if (!t.kind) aa(t, { element: "harmonic", mult: 1, diceN: 1, diceS: (typeof leveledSides === "function" ? leveledSides(a.level, 6) : 6), baseBreak: 1, onConnect: canPush ? { dest: otherZone(t.zone), reason: "被卷走" } : null });
    return true;
  }
  if (id === "en_king_atk") {
    if (!needT()) return true;
    aa(t, { element: "fire", mult: 1, diceN: 1, diceS: 4, baseBreak: 1 });
    a.resources = a.resources || {};
    a.resources.focusId = t.id;
    lines.push(`所有狂徒目标切换为 ${t.name}。`);
    return true;
  }
  if (id === "en_king_kill") {
    if (!needT()) return true;
    aa(t, { element: "acid", mult: 1, diceN: 1, diceS: 6, baseBreak: 1 });
    const boss = state.units.find(u => u.kit === "bandit_boss" && !u.hidden && !u.dead);
    if (boss && Math.random() < 0.5) {
      t.stunned = true;
      lines.push("强盗头子擒拿成功，目标失去下回合行动。");
    } else if (boss) lines.push("强盗头子擒拿失败。");
    return true;
  }
  if (id === "en_king_hold") {
    // 主持人手册：所有人回到他所在区，消耗行动点筑废铁墙（1d4×狂徒人数装甲，每五级升骰）；
    // 他用电击霰弹对另一区全员 atk+1d8/2 电击。
    // 废铁墙照川川的铁壁做：放在王所在区，同区敌方单位挨我方攻击行动时只有墙吃这一下，撑到下一个敌人回合开始。
    const crew = state.units.filter(u => isOutlawThug(u));
    let spent = 0;
    crew.forEach(u => {
      u.zone = a.zone;
      if ((Number(u.ap) || 0) > 0) { u.ap -= 1; spent += 1; }   // 还没行动的狂徒筑墙花掉 1 行动点
    });
    const n = crew.length;
    if (n) {
      const s = typeof leveledSides === "function" ? leveledSides(a.level, 4) : 4;
      const r = takeDice(1, s, 0);
      const hp = Math.max(1, Math.floor(r.total * n));
      state.props = (state.props || []).filter(p => !(p.kind === "scrapwall" && Number(p.zone) === Number(a.zone)));
      const wall = makeProp("scrapwall", a.zone, a.level);
      wall.hp = wall.maxHp = hp;
      state.props.push(wall);
      lines.push(`${n} 名狂徒回防到 ${a.zone} 区${spent ? `（${spent} 名还没行动的各花掉 1 行动点）` : ""}，筑起废铁墙：装甲 ${hp}（${r.text} × ${n}）。` +
        `同区敌人挨我方攻击行动时只打墙一次，撑到下一个敌人回合开始。`);
    } else {
      lines.push("身边已经没有狂徒可以回防，废铁墙没能筑起来。");
    }
    allPlayers().filter(u => Number(u.zone) !== Number(a.zone)).forEach(u => {
      aa(u, { element: "electric", mult: 0.5, diceN: 1, diceS: 8, baseBreak: 1 });
    });
    return true;
  }
  if (id === "en_thug_mutiny") {
    const boss = findKit("bandit_boss", state.units);
    if (!boss || boss.dead) { lines.push("强盗头子已不在场。"); return true; }
    const sides = mutinyDieSides(a.level);
    hitOne(a, boss, { element: "physical", mult: 0, diceN: 1, diceS: sides, baseBreak: 1, atk: 0, atkRange: "melee", flags: { action: true } });
    lines.push(`${a.name} 反水：只敢打 1d${sides} 物理。`);
    return true;
  }
  if (id === "en_chi_knife") {
    if (!needT()) return true;
    aa(t, { element: "fire", mult: 0.75, baseBreak: 1 });
    return true;
  }
  if (id === "en_chi_cover") {
    a.resources = a.resources || {};
    a.resources.cover = true;
    a.resources.primed = true;
    lines.push("赤牙躲入掩体：本回合受击伤害 −50%、击破 0，并为下回合预热霰弹枪。此技能结束其回合。");
    return true;
  }
  if (id === "en_chi_ignite") {
    if (!needT()) return true;
    const primed = a.resources && a.resources.primed;
    const list = primed ? allPlayers().filter(u => Number(u.zone) === Number(t.zone)) : [t];
    list.forEach(u => {
      u.statuses.burn = Math.max(1, u.statuses.burn || 0);
      if (typeof popStatus === "function") popStatus(u, "burn");
      lines.push(`${u.name} 灼烧。`);
    });
    return true;
  }
  if (id === "en_chi_shot") {
    if (!needT()) return true;
    if (!(a.resources && a.resources.primed)) { lines.push("需要先预热（躲入掩体 / 剿灭）。"); return true; }
    const near = Number(a.zone) === Number(t.zone);
    aa(t, { element: "fire", mult: near ? 2 : 1.5, baseBreak: near ? 2 : 1 });
    a.resources.primed = false;
    lines.push("霰弹射出，解除预热。协助格挡成功率 −40%（手记）。");
    return true;
  }
  if (id === "en_chi_hunt") {
    if (!needT()) return true;
    t.statuses.chase = true;
    lines.push(`追猎：${t.name} 移动时赤牙会跟过去。`);
    return true;
  }
  if (id === "en_chi_exec") {
    if (!needT()) return true;
    a.zone = t.zone;
    a.resources = a.resources || {};
    a.resources.primed = true;
    aa(t, { element: "fire", mult: 2.5, baseBreak: 2 });
    a.resources.primed = false;
    lines.push("剿灭完成，解除预热。可立刻免费移动一次。");
    return true;
  }
  if (id === "ufo_laser") {
    if (!needT()) return true;
    aa(t, { element: "energy", mult: 1, baseBreak: 1 });
    return true;
  }
  if (id === "ufo_assist") {
    if (!needT()) return true;
    aa(t, { element: "energy", mult: 0.5, baseBreak: 1, flags: { action: true, assist: true } });
    return true;
  }
  if (id === "ufo_stomp") {
    if (ufoLivingLegs(a).length < 4) { lines.push("踩踏需要剩余至少 4 条机械足。"); return true; }
    const foes = allPlayers().filter(u => !u.dead && !u.dying);
    // 嘲讽：随机攻击也会被吸到，但一个单位的嘲讽只能吸其中一击
    const taunter = a.tauntTo ? foes.find(u => u.id === a.tauntTo) : null;
    let picks;
    if (taunter) {
      const rest = foes.filter(u => u.id !== taunter.id).sort(() => Math.random() - 0.5);
      picks = [taunter].concat(rest.slice(0, 1));
      a.tauntTo = null;
      lines.push(`${taunter.name} 的嘲讽吸走其中一击。`);
    } else {
      picks = foes.slice().sort(() => Math.random() - 0.5).slice(0, 2);
    }
    if (!picks.length) { lines.push("场上没有可踩踏的角色。"); return true; }
    picks.forEach(u => aa(u, { element: "physical", mult: 1, diceN: 1, diceS: (typeof leveledSides === "function" ? leveledSides(a.level, 4) : 4), baseBreak: 2 }));
    lines.push("踩踏：" + picks.map(u => u.name).join("、"));
    return true;
  }
  if (id === "ufo_sweep") {
    const n = ufoLivingLegs(a).length;
    if (n < 2 || n > 3) { lines.push("激光扫射只有剩余 2 或 3 条机械足时才能使用。"); return true; }
    const fl = state.skillFlow;
    const z = fl && fl.picks.dest != null ? Number(fl.picks.dest) : null;
    if (z == null) { lines.push("先选一个距离 1 以内的区域。"); return true; }
    if (zoneDist(a.zone, z, state.zoneMode) > 1) { lines.push("只能打距离 1 以内的区域。"); return true; }
    const foes = allPlayers().filter(u => !u.dead && !u.hidden && Number(u.zone) === z);
    foes.forEach(u => aa(u, { element: "energy", mult: 1, baseBreak: 1, flags: { action: true, aoe: true } }));
    (state.props || []).filter(p => Number(p.zone) === z).forEach(p => {
      if (typeof damageProp === "function") {
        const pn = damageProp(p, { element: "energy", dmg: Math.floor(atk) }, a);
        (pn || []).forEach(s => lines.push(s));
      }
    });
    if (typeof markAoeZone === "function") markAoeZone(z);
    lines.push(`激光扫射 ${z} 区：敌方单位 ${foes.map(u => u.name).join("、") || "无"}，并波及该区配置物。`);
    return true;
  }
  if (id === "ufo_prime") {
    a.resources = a.resources || {};
    a.resources.boomReady = true;
    lines.push("飞碟触灵开始准备自爆，下回合可引爆。");
    return true;
  }
  if (id === "ufo_boom") {
    if (!(a.resources && a.resources.boomReady)) {
      lines.push("必须先用一回合「准备自爆」，下回合才能引爆。");
      return true;
    }
    if (typeof detonateUfo === "function") lines.push(...detonateUfo(a));
    return true;
  }
  if (id === "en_agg1_melee") {
    if (!needT()) return true;
    aa(t, { element: "physical", mult: 1, diceN: 1, diceS: 8, baseBreak: 3 });
    return true;
  }
  if (id === "en_agg1_range") {
    if (!needT()) return true;
    aa(t, { element: "physical", mult: 1, diceN: 1, diceS: 8, baseBreak: 3 });
    return true;
  }
  if (id === "en_agg2_melee") {
    if (!needT()) return true;
    aa(t, { element: "electric", mult: 1, diceN: 1, diceS: 10, baseBreak: 2 });
    a.resources = a.resources || {};
    a.resources.forceCharge = true;
    a.resources.forceOverheat = false;
    lines.push("机械臂挥击后开始蓄力电能炮，下次行动必须使用电能炮。");
    return true;
  }
  if (id === "en_agg2_charge") {
    if (!needT()) return true;
    const near = Number(a.zone) === Number(t.zone);
    aa(t, { element: "electric", mult: 1, diceN: 1, diceS: near ? 20 : 10, baseBreak: 2 });
    a.resources = a.resources || {};
    a.resources.forceCharge = false;
    a.resources.forceOverheat = true;
    lines.push("电能炮释放完毕，下次行动强制过热。");
    return true;
  }
  if (id === "en_agg2_overheat") {
    a.resources = a.resources || {};
    a.resources.forceOverheat = false;
    lines.push("过热：跳过本次行动。");
    return true;
  }
  if (id === "en_agg3_debris") {
    a.resources = a.resources || {};
    a.resources.debrisCount = (a.resources.debrisCount || 0) + 1;
    lines.push(`吸引碎片 ${a.resources.debrisCount}/2。`);
    if (a.resources.debrisCount >= 2) {
      a.resources.debrisCount = 0;
      const restore = (a.level || 1) * 2;
      let armorLayer = (a.layers || []).find(l => l.type === "armor");
      if (armorLayer) {
        armorLayer.max = Math.max(Number(armorLayer.max) || 0, restore);
        armorLayer.current = restore;
      } else {
        a.layers.splice(1, 0, { type: "armor", current: restore, max: restore });
      }
      a.resources.phase = 2;
      a.resources.forceCharge = false;
      a.resources.forceOverheat = false;
      a.name = "沙灵聚合体·机械躯";
      a.dead = false;
      lines.push(`碎片吸收完成，恢复装甲 ${restore}，回到二阶段。`);
    }
    return true;
  }
  if (id === "en_agg3_push") {
    if (!needT()) return true;
    aa(t, { element: "physical", mult: 1, baseBreak: 0, onConnect: { dest: otherZone(t.zone), reason: "被推击击退" } });
    return true;
  }
  if (id === "en_agg3_control") {
    if (!needT()) return true;
    if (typeof displaceTo === "function") displaceTo(a, t.zone, lines, "接近肉体操控目标");
    else a.zone = t.zone;
    aa(t, { element: "physical", mult: 1, baseBreak: 0, flags: { action: true, blockResolved: true }, onConnect: { controlAlly: true, spendAp: 1 } });
    return true;
  }
  if (id === "ufo_summon") {
    const kinds = ["guard_sword", "guard_gun"];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const p = enemyPresets().find(x => x.id === kind);
    if (p) {
      const u = p.build(a.level, state.partySize);
      u.zone = a.zone;
      state.units.push(u);
      lines.push(`召唤 ${u.name} 到 ${u.zone} 区。`);
    }
    return true;
  }
  return false;
}

function ufoPackId(u) {
  return u && (u.bossPack || (u.resources && u.resources.bossPack));
}

function ufoBodyOf(u) {
  if (!u) return (state.units || []).find(x => x.kit === "ufo_body" && !x.dead);
  if (u.kit === "ufo_body") return u;
  if (u.resources && u.resources.bodyId) {
    const by = (typeof unitById === "function" ? unitById(u.resources.bodyId) : null) || (state.units || []).find(x => x.id === u.resources.bodyId);
    if (by) return by;
  }
  const pack = ufoPackId(u);
  if (pack) {
    const hit = (state.units || []).find(x => x.kit === "ufo_body" && ufoPackId(x) === pack);
    if (hit) return hit;
  }
  return (state.units || []).find(x => x.kit === "ufo_body" && !x.hidden && !x.dead);
}

function ufoAllLegs(body) {
  if (!body) return (state.units || []).filter(u => u.kit === "ufo_leg");
  const ids = (body.resources && body.resources.legIds) || [];
  const byId = ids.map(id => (typeof unitById === "function" ? unitById(id) : null) || (state.units || []).find(u => u.id === id)).filter(Boolean);
  if (byId.length) return byId;
  const pack = ufoPackId(body);
  return (state.units || []).filter(u => u.kit === "ufo_leg" && (!pack || ufoPackId(u) === pack || !ufoPackId(u)));
}

function ufoLivingLegs(body) {
  const pack = body ? ufoPackId(body) : null;
  const field = (state.units || []).filter(u =>
    u && (u.kit === "ufo_leg" || u.noPosture || (u.name && String(u.name).indexOf("机械足") === 0)) &&
    !u.hidden && !u.dead && !u._removed &&
    (typeof totalHp === "function" ? totalHp(u) > 0 : true) &&
    (!pack || !ufoPackId(u) || ufoPackId(u) === pack)
  );
  if (field.length) return field;
  return ufoAllLegs(body).filter(u => u && !u.hidden && !u.dead && !u._removed && totalHp(u) > 0);
}

function syncUfoBody(body) {
  if (!body || body.kit !== "ufo_body") body = ufoBodyOf(body);
  if (!body) return;
  const legs = ufoAllLegs(body);
  if (!legs.length) return;
  const live = legs.filter(u => !u.hidden && !u.dead && totalHp(u) > 0);
  const sumType = type => legs.reduce((s, u) => {
    const layer = (u.layers || []).find(l => l.type === type);
    return s + Math.max(0, Number(layer && layer.current) || 0);
  }, 0);
  const maxType = type => legs.reduce((s, u) => {
    const layer = (u.layers || []).find(l => l.type === type);
    return s + Math.max(0, Number(layer && layer.max) || 0);
  }, 0);
  ["shield", "armor", "spirit"].forEach(type => {
    let layer = (body.layers || []).find(l => l.type === type);
    if (!layer) {
      layer = { type, current: 0, max: 0 };
      body.layers = body.layers || [];
      body.layers.push(layer);
    }
    layer.current = sumType(type);
    layer.max = Math.max(layer.current, maxType(type));
  });
  if (!live.length) {
    body.dead = true;
    (body.layers || []).forEach(l => { l.current = 0; });
  } else {
    body.dead = false;
  }
}

function drainUfoLegs(body, amount) {
  const notes = [];
  let left = Math.max(0, Math.floor(amount || 0));
  const legs = ufoLivingLegs(body);
  legs.forEach(leg => {
    if (left <= 0) return;
    const before = totalHp(leg);
    const took = typeof applyTrueDamage === "function" ? applyTrueDamage(leg.layers, left) : 0;
    left -= took;
    notes.push(`${leg.name} 血量池 −${took}（${before}→${totalHp(leg)}）`);
    if (totalHp(leg) <= 0) {
      leg.dead = true;
      notes.push(`${leg.name} 被抽干，摧毁击破 1。`);
      if (body) {
        const bd = Number(body.def) || 0;
        body.def = Math.max(0, bd - 1);
        if (body.def <= 0 && !body.stunned) {
          body.stunned = true;
          notes.push(typeof imbalanceLine === "function" ? imbalanceLine(body) : `${body.name} 失衡`);
        }
      }
    }
  });
  syncUfoBody(body);
  return notes;
}

function spawnEnemyGroup(id, lv, partyN, zone) {
  const z = zone != null ? Number(zone) : null;
  if (id === "ufo_boss" && typeof spawnUfoBoss === "function") {
    const pack = spawnUfoBoss(lv);
    pack.forEach(u => {
      if (z && u.kit === "ufo_body") u.zone = Math.min(z, Number(state.zoneMode) || z);
      if (typeof refreshEnemyEconomy === "function") refreshEnemyEconomy(u);
    });
    return pack;
  }
  const p = enemyPresets().find(x => x.id === id);
  if (!p || !p.build) return [];
  const u = p.build(lv, partyN);
  if (z) u.zone = Math.min(z, Number(state.zoneMode) || z);
  if (typeof refreshEnemyEconomy === "function") refreshEnemyEconomy(u);
  return [u];
}

function spawnUfoBoss(lv) {
  const pack = "ufo" + Math.random().toString(36).slice(2, 8);
  const p = state.partySize;
  const s = ufoLegStats(lv);
  const spirit = s.spirit, armor = s.armor, shield = s.shield, def = s.def, atk = s.atk;
  const body = unitOf("飞碟触灵·本体", lv, [
    { type: "shield", hp: scaleHp(shield * 5, p) },
    { type: "armor", hp: scaleHp(armor * 5, p) },
    { type: "spirit", hp: scaleHp(spirit * 5, p) }
  ], def, atk, { kit: "ufo_body", range: "any", flying: true, element: "energy", dice: [1, 4], baseBreak: 1, resources: { boomReady: false, bossPack: pack } });
  body.bossPack = pack;
  body.untargetable = true;
  body.zone = Number(state.zoneMode) === 3 ? 2 : 2;
  const names = ["机械足甲", "机械足乙", "机械足丙", "机械足丁", "机械足戊"];
  const zones = [2, 2, 2, 1, 1];
  const legs = names.map((name, i) => {
    const u = unitOf(name, lv, [
      { type: "shield", hp: scaleHp(shield, p) },
      { type: "armor", hp: scaleHp(armor, p) },
      { type: "spirit", hp: scaleHp(spirit, p) }
    ], 0, 0, { kit: "ufo_leg", range: "any", element: "physical", resources: { bossPack: pack } });
    u.bossPack = pack;
    u.noPosture = true;
    u.def = 0;
    u.defMax = 0;
    u.zone = zones[i];
    u._xpGiven = true;
    return u;
  });
  body.resources.legIds = legs.map(u => u.id);
  legs.forEach(u => { u.resources.bodyId = body.id; });
  syncUfoBody(body);
  return [body].concat(legs);
}

function detonateUfo(body) {
  const notes = [`飞碟触灵自爆：全区所有单位受到 ${3 * (body.atk || 0)} 火焰。`];
  const dmg = 3 * (body.atk || 0);
  (state.units || []).filter(u => !u.hidden && !u.dead && u.id !== body.id).forEach(u => {
    const fake = unitOf("飞碟自爆", body.level, [{ type: "armor", hp: 1 }], 0, 0);
    fake.zone = u.zone;
    if (typeof dealTo === "function") {
      dealTo(fake, u, { atk: 0, mult: 0, flat: dmg, element: "fire", baseBreak: 0, flags: { action: true, aoe: true } });
    }
  });
  ufoLivingLegs(body).forEach(u => { u.dead = true; (u.layers || []).forEach(l => { l.current = 0; }); });
  body.dead = true;
  (body.layers || []).forEach(l => { l.current = 0; });
  body.resources.boomReady = false;
  if (!body._xpGiven) {
    body._xpGiven = true;
    if (typeof grantXpToPlayers === "function") grantXpToPlayers(xpDrop("boss", body.level), "击破飞碟触灵");
  }
  notes.push("飞碟触灵在自爆中解体。");
  if (typeof sweepDeadEnemies === "function") notes.push(...sweepDeadEnemies());
  return notes;
}

function totalHp(u) {
  return (u.layers || []).reduce((s, l) => s + Math.max(0, Number(l.current) || 0), 0);
}
