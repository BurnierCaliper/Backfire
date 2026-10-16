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
  ant_guard: (u) => {
    const r = u.resources || {};
    if (!r.shellPending || !r.shellZone) return null;
    return { zone: r.shellZone, label: r.shellReady ? "大酸液弹待发" : "大酸液弹标定", ready: !!r.shellReady };
  },
  ufo_body: (u) => {
    const r = u.resources || {};
    if (!r.boomReady) return null;
    const n = Number(typeof state !== "undefined" ? state.zoneMode : 2) || 2;
    const out = [];
    for (let z = 1; z <= n; z++) out.push({ zone: z, label: "自爆待发", ready: true });
    return out;
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
  if (u && u.kit === "chixia") return "en_chi_exec";   // 赤牙的协助是「剿灭」（第九章）
  const list = (typeof enemySkillList === "function" && enemySkillList(u)) || [];
  const hit = list.find(s => s.id && s.id.indexOf("_assist") >= 0);
  return hit ? hit.id : "en_aa";
}

/** 敌人现在能不能对我方做协助攻击：被挟持的亡命之王无法行动；哗变中的狂徒只敢打强盗头子 */
function enemyMayAssist(u) {
  if (!u || u.isPlayer) return false;
  if (u.dormant) return false;   // 休眠：不协助
  if (u.kit === "outlaw_king" && u.resources && u.resources.hostage) return false;
  if (/^thug_/.test(u.kit || "")) {
    const king = findKit("outlaw_king", state.units);
    if (king && !king.dead && king.resources && king.resources.hostage) return false;
  }
  return true;
}

/* 协助攻击的射程。自带移动的（冲到目标那一区再打）先走一格；无限距离的总能打到；
 * 其余按技能射程（ENEMY_SKILL_RANGE，没登记的用单位卡上的 range），隔着危墙 / 关着的门打不到。 */
const ENEMY_ASSIST_RUSH = ["en_thug_hammer_assist", "en_wolf_assist", "en_chi_exec", "en_overseer_assist", "en_gas_assist",
  "en_fish_lead_assist", "en_fish_drive_assist", "en_fish_ambush_assist"];   // 沙鱼群起：冲到失衡的人那一区
const ENEMY_ASSIST_ANYWHERE = ["en_patrol_assist", "ufo_assist", "en_alarm_assist"];
function enemyAssistReach(u, t) {
  if (!u || !t) return false;
  const sid = enemyAssistSkillId(u);
  if (ENEMY_ASSIST_ANYWHERE.includes(sid)) return true;
  // 矿场警戒自动机：协助打所有高能的敌人，场上有人高能才出手
  if (sid === "en_alarm_assist") return alarmTargets(u).length > 0;
  // 蚁型特殊戒备兵种：大酸液弹蓄力中时，协助就是对标定的区发射，不看目标在哪
  if (sid === "en_ant_assist" && u.resources && u.resources.shellPending && Number(u.resources.shellZone) >= 1) return true;
  const from = Number(u.zone), to = Number(t.zone);
  const d = zoneDist(from, to, state.zoneMode);
  if (ENEMY_ASSIST_RUSH.includes(sid)) {
    if (d === 0) return true;
    if (d > 1 || u.noMove) return false;
    const g = typeof getGap === "function" ? getGap(from, to) : null;
    return !g || !(g.type === "wall" || (g.type === "door" && !g.open) || (g.type === "void" && !u.flying));
  }
  const rg = ENEMY_SKILL_RANGE[sid] || u.range || "any";
  const ok = rg === "melee" ? d === 0 : rg === "ranged" ? d === 1 : d <= 1;
  return ok && !(typeof lineBlocked === "function" && lineBlocked(from, to));
}
/** 选协助者用：能出手、而且打得到（以前打不到的也在名单里，选了先回满架势，再打空） */
function enemyAssistReady(u, t) {
  return enemyMayAssist(u) && enemyAssistReach(u, t);
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

/** 亡命之王 · 公开处刑（他回合用的技能）：标记血量上限最高的人，KING_CFG.exec.turns 回合后的敌人回合开始时落下（死刑机制）。
 *  分段在落下时按还站着的手下现算。返回日志行 */
function kingCastExecution(king, lines) {
  if (!king || typeof addBossMechanic !== "function") return;
  const E = KING_CFG.exec;
  if (king.mechanics) king.mechanics = king.mechanics.filter(m => !(m.kingExec && m.st && m.st.done));
  if ((king.mechanics || []).some(m => m.kingExec)) { lines.push("上一次公开处刑还没落下。"); return; }
  const turn = Number(state.turnNo) || 1;
  addBossMechanic(king, { type: "execution", kingExec: true, name: "公开处刑", phase: "enemy", pick: "maxHp",
    firstTurn: turn, turns: E.turns, then: "once", hitsHook: "kingExecution", hook: "kingGrab" });
  king.resources = king.resources || {};
  king.resources.execTurn = turn;
  if (typeof bossMechSync === "function") bossMechSync(lines);
  // 和已经挂着的齐射撞在同一回合：处刑往后推一回合
  const ex = king.mechanics.find(m => m.kingExec), vo = king.mechanics.find(m => m.kingVolley && m.st && !m.st.done);
  if (ex && vo && ex.st && ex.st.due === vo.st.due) { ex.st.due += 1; lines.push(`公开处刑让位给齐射，推迟到第 ${ex.st.due} 回合。`); }
}
/** 现在能不能用公开处刑：没有还没落下的，并且离上次标记过了 cooldown 回合 */
function kingExecutionReady(king) {
  if (!king || (king.mechanics || []).some(m => m.kingExec && !(m.st && m.st.done))) return false;
  const last = king.resources && king.resources.execTurn;
  return last == null || (Number(state.turnNo) || 1) - Number(last) >= KING_CFG.exec.cooldown;
}
function kingExecutionHits(king) {
  const E = KING_CFG.exec;
  const crew = (state.units || []).filter(u => isOutlawThug(u) && !u.dying && !(u.resources && u.resources.mutinied));
  return [{ mult: E.kingMult, diceS: leveledSides(king.level, E.kingDie), element: "acid", baseBreak: 1 }].concat(crew.map(u => ({
    byId: u.id, atk: typeof effectiveAtk === "function" ? effectiveAtk(u, state.units) : Number(u.atk) || 0,
    mult: E.crewMult, diceS: leveledSides(u.level, E.crewDie), element: "physical", baseBreak: 1
  })));
}
/** 处刑落下后：强盗头子还在就试着擒拿刚挨刀的人 */
function kingExecutionGrab(king, m, notes) {
  const t = m && m.st && m.st.lastTargetId ? unitById(m.st.lastTargetId) : null;
  const boss = (state.units || []).find(u => u.kit === "bandit_boss" && !u.hidden && !u.dead && !(u.resources && u.resources.mutinied));
  if (!t || t.dead || !boss) return;
  if (Math.random() < KING_CFG.exec.grab) { t.stunned = true; notes.push(`${boss.name} 擒拿 ${t.name} 成功：失去下回合行动。`); }
  else notes.push(`${boss.name} 擒拿 ${t.name} 失败。`);
}
/** 回防命令之后的齐射：标记我方每个角色，下一个敌人回合开始时王各开一枪（KING_CFG.volley） */
function kingArmVolley(king, lines) {
  if (!king || typeof addBossMechanic !== "function") return;
  if (king.mechanics) king.mechanics = king.mechanics.filter(m => !(m.kingVolley && m.st && m.st.done));
  if ((king.mechanics || []).some(m => m.kingVolley)) return;   // 上一轮还没打出去
  const turn = Number(state.turnNo) || 1;
  addBossMechanic(king, { type: "volley", kingVolley: true, name: "齐射", element: "physical", phase: "enemy",
    firstTurn: turn, turns: 1, then: "once", shot: Object.assign({}, KING_CFG.volley), hook: "kingVolleySpent" });
  if (typeof bossMechSync === "function") bossMechSync(lines);
  // 和公开处刑撞在同一回合：处刑往后推一回合（不然一回合开头连挨处刑和齐射）
  const ex = (king.mechanics || []).find(m => m.kingExec && m.st && !m.st.done && m.st.due === turn + 1);
  if (ex) { ex.st.due += 1; lines.push(`公开处刑让位给齐射，推迟到第 ${ex.st.due} 回合。`); }
}
/** 齐射打完：用掉王这一回合的行动点（敌人回合开始时结算，行动点在之后刷新，所以记成「这回合失去行动点」） */
function kingVolleySpent(king, m, notes) {
  if (!king || king.dead) return;
  king.loseApNext = true;
  notes.push(`${king.name} 这一回合的行动点用在了齐射上。`);
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

/** 敌人这一回合被强制攻击的对象：灯的决一死战、禁足怒吼、嘲讽（没有就是 null） */
function enemyForcedTarget(u) {
  if (!u || u.isPlayer) return null;
  const ok = (t) => t && !t.dead && !t.hidden && !(t.dying && !t.upOnShp) ? t : null;
  const duel = typeof touDuelVictim === "function" ? ok(touDuelVictim(u)) : null;
  if (duel) return duel;
  if (u.lockdownBy) { const t = ok(unitById(u.lockdownBy)); if (t) return t; }
  if (u.tauntTo) { const t = ok(unitById(u.tauntTo)); if (t) return t; }
  return null;
}
/** 有没有能打同区的攻击（近距离 / 任意距离；协助、借机这类反应不算） */
function enemyHasNearAttack(u) {
  return (enemySkillList(u) || []).some(s => {
    if (!s || !s.id || /_assist$|_opp$/.test(s.id) || s.id === "en_approach" || s.id === "en_flee") return false;
    const r = ENEMY_SKILL_RANGE[s.id] || (s.id === "en_aa" ? (u.range || "any") : null);
    return r === "melee" || r === "any";
  });
}
/** 作者定：被强制攻击的对象就在同区、自己又没有近身攻击时，远距离攻击可以抵近射击（倍率同专长「抵近射击」，60%） */
function enemyForcedPointBlank(a, t) {
  if (!a || a.isPlayer || !t || Number(a.zone) !== Number(t.zone)) return false;
  return enemyForcedTarget(a) === t && !enemyHasNearAttack(a);
}
/** 选区攻击（榴弹、大酸液弹）被强制攻击时：只能选强制对象所在的区。返回实际落点和要写的日志 */
function forcedZonePick(a, zone, lines) {
  const f = enemyForcedTarget(a);
  if (!f || Number(f.zone) === Number(zone)) return zone;
  lines.push(`${a.name} 被 ${f.name} 牵制：落点只能选 ${f.zone} 区。`);
  return Number(f.zone);
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
    mine_guard: [
      { id: "en_mine_guard", label: "酸液挥砍" },
      { id: "en_mine_guard_assist", label: "协助攻击" }
    ],
    ant_guard: [
      { id: "en_ant_spray", label: "酸液喷枪" },
      { id: "en_ant_assist", label: "协助攻击" }
    ],
    mine_overseer: [
      { id: "en_overseer", label: "火焰重锤（灼烧）" },
      { id: "en_overseer_assist", label: "协助：冲近半伤" }
    ],
    flint_sweeper: [
      { id: "en_flint", label: "发射火石（1d6 发）" },
      { id: "en_flint_assist", label: "协助：爆炸火石" }
    ],
    alarm_bot: [
      { id: "en_alarm_zap", label: "电涌（所有高能的敌人 3 段）" },
      { id: "en_alarm_assist", label: "协助：所有高能的敌人 1×atk" }
    ],
    meteor_miner: [
      { id: "en_miner_shot", label: "能量射线（倒流）" },
      { id: "en_miner_assist", label: "协助：能量射线（倒流）" }
    ],
    sandfish_lead: [
      { id: "en_fish_lead_hit", label: "撞击（白天 +2 击破）/ 撕咬（夜晚）" },
      { id: "en_fish_lead_assist", label: "群起：撞击 / 撕咬" }
    ],
    sandfish_drive: [
      { id: "en_fish_drive_tail", label: "甩尾（白天推开）/ 乱咬（夜晚）" },
      { id: "en_fish_drive_assist", label: "群起：甩尾 / 乱咬" }
    ],
    sandfish_ambush: [
      { id: "en_fish_ambush_bite", label: "腾咬（白天）/ 猛咬（夜晚）" },
      { id: "en_fish_ambush_assist", label: "群起：腾咬 / 猛咬" }
    ],
    dust_bug: [],
    tube_worm: [],
    meteor_spider: [
      { id: "en_spider_bite", label: "撕咬" },
      { id: "en_spider_assist", label: "协助：撕咬（施加高能）" }
    ],
    meteor_centipede: [
      { id: "en_centi_shot", label: "弦振射线（高能 + 衍蛛追打）" },
      { id: "en_centi_assist", label: "协助：弦振射线（衍蛛追打翻倍）" }
    ],
    gas_collector: [
      { id: "en_gas_ignite", label: "点燃燃气（同区火焰 + 变火场）" },
      { id: "en_gas_spray", label: "喷火（三段）" },
      { id: "en_gas_assist", label: "协助：冲近灼烧 + 喷火" }
    ],
    ant_hunter: [
      { id: "en_hunter_shot", label: "灼热子弹（穿刺）" },
      { id: "en_hunter_heat", label: "把天气变为酷暑" },
      { id: "en_hunter_assist", label: "协助：狙击（穿刺 + 爆燃）" }
    ],
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
      { id: "en_ox", label: "冲撞" },
      { id: "en_ox_assist", label: "协助：近距普通攻击" }
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
      { id: "en_king_hold", label: "回防命令（筑废铁墙）" },
      { id: "en_king_exec", label: "公开处刑（标记血量上限最高的人，两回合后落下）" }
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
      const list = [
        { id: "en_agg1_melee", label: "沙爪挥击（近）" },
        { id: "en_agg1_range", label: "砂岩块（远）" }
      ];
      if (aggRushArmed(u)) list.unshift({ id: "en_agg1_rush", label: "狂暴连打（冲到预告目标的区连打）" });
      else if (aggRushCanPrep(u)) list.push({ id: "en_agg1_rush_prep", label: "预备狂暴连打（下回合冲过去连打）" });
      return list;
    }
    if (ph === 2) {
      // 电能炮改成「死刑」首领机制（aggArmCannon），不再占行动、也不再空过一回合
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
  if (u.kit === "ant_guard") {
    // 站在酸液地面上：从地面汲取酸，改用大酸液弹（先标定区域，下个敌人回合发射）；已标定的照常发射
    const r = u.resources || {};
    if (r.shellReady && r.shellZone) list.unshift({ id: "en_ant_shell_fire", label: "发射大酸液弹（" + r.shellZone + "区）" });
    else if (!r.shellPending && onAcidGround(u)) list.unshift({ id: "en_ant_shell", label: "大酸液弹（选择区域）" });
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
  // 沿连接走最短路线的下一格（直排就是往那边挪一格）
  const path = typeof zonePath === "function" ? zonePath(from, destZone) : null;
  const dest = path && path.length > 1 ? path[1] : (from < destZone ? from + 1 : from - 1);
  doMove(unit, dest, opt || {});
  return true;
}

/* 第一采矿场：酸液地面 */
/** 站在酸液地面上（飞行单位不算） */
function onAcidGround(u) {
  const f = u && typeof state !== "undefined" && state.fields ? state.fields[u.zone] : null;
  return !!(f && f.acid) && !u.flying;
}
/** 酸液地面不影响移动：离开不改花行动点 */
const ACID_GROUND_WALKERS = { mine_guard: true, ant_guard: true };
function acidGroundWalker(u) { return !!(u && ACID_GROUND_WALKERS[u.kit]); }
/** 不吃酸液地面的伤害 */
const ACID_GROUND_IMMUNE = { ant_guard: true };
function acidGroundImmune(u) { return !!(u && ACID_GROUND_IMMUNE[u.kit]); }

/** 相邻的另一个区。awayFrom 给了就挑离那个区最远的相邻区（一样远取编号小的）；
 *  不给就取编号最小的相邻区（直排：两区互换；三区 1、3 → 2，2 → 1，和以前一样） */
function otherZone(zone, awayFrom) {
  const z = Number(zone);
  const ns = typeof zoneNeighbors === "function" ? zoneNeighbors(z) : [];
  if (!ns.length) {
    const n = Number(state.zoneMode);
    if (n === 2) return z === 1 ? 2 : 1;
    return z === 2 ? 1 : 2;
  }
  if (awayFrom == null) return ns[0];
  const far = Math.max(...ns.map(x => zoneDist(x, awayFrom)));
  return ns.find(x => zoneDist(x, awayFrom) === far);
}

/* 敌人出手时（runEnemyAction 期间）ENEMY_ACTOR 是出手的敌人：下面这几个「我方」名单就换成「和它敌对的单位」
 * （我方 + 敌对阵营的敌人，友军阵营不打我方）。这样所有敌人的技能（范围攻击、挑目标）都按阵营分敌我，不用一个个改 */
let ENEMY_ACTOR = null;
function actorFoes() {
  const a = ENEMY_ACTOR;
  if (!a || typeof hostileTo !== "function") return null;
  return (state.units || []).filter(u => u && hostileTo(a, u) && !u.hidden && !u._removed && !u.fused && u.kit !== "ironwall");
}
function playersInZone(z) {
  const f = actorFoes();
  return (f || state.units.filter(u => u.isPlayer && !u.hidden)).filter(u => Number(u.zone) === Number(z));
}

function allPlayers() {
  const f = actorFoes();
  if (f) return f;
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
  en_mine_guard: "melee",
  en_mine_guard_assist: "melee",
  en_ant_spray: "ranged",
  en_ant_assist: "ranged",
  en_overseer: "melee",
  en_flint: "ranged",
  en_flint_assist: "ranged",
  en_gas_spray: "melee",
  en_hunter_shot: "ranged",
  en_miner_shot: "ranged",
  en_spider_bite: "melee",
  en_fish_lead_hit: "melee", en_fish_drive_tail: "melee", en_fish_ambush_bite: "melee",
  en_spider_assist: "melee",
  en_centi_shot: "ranged",
  en_centi_assist: "ranged",
  en_miner_assist: "ranged",
  en_hunter_assist: "ranged",
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
  en_agg3_control: "melee",
  en_agg3_push: "melee",
  en_chi_shot: "any",             // 霰弹枪：近距 2×atk，远距 1.5×atk
  en_chi_knife: "melee",
  en_chi_exec: "melee",           // 剿灭：冲到目标那一区零距离射击
  // 协助攻击（手册写明的射程）
  en_bigsand_assist: "any",       // 大沙灵：任意距离 1.5×atk
  en_giant_assist: "melee",       // 巨人：协助近距
  en_thug_knife_assist: "melee",  // 匕首狂徒：协助近距
  en_ox_assist: "melee"           // 牛队长：协助仅近距
};

/* 敌人技能的花费：默认 1 行动点（协助、借机这类反应不花）。
 * 赤牙照第九章：霰弹枪射击、躲入掩体 2 行动点，追猎 1 附赠。 */
const ENEMY_SKILL_COST = {
  en_chi_shot: { ap: 2, bonus: 0 },
  en_chi_cover: { ap: 2, bonus: 0 },
  en_chi_hunt: { ap: 0, bonus: 1 }
};
function enemySkillCost(u, id) {
  return ENEMY_SKILL_COST[id] || { ap: 1, bonus: 0 };
}

/** 区域范围技能（喷洒、流沙漩涡……）能不能打到 zone：按技能射程，隔着危墙 / 关着的门打不到 */
function enemyZoneInRange(a, id, zone) {
  const d = zoneDist(a.zone, zone, state.zoneMode);
  const rg = ENEMY_SKILL_RANGE[id] || a.range || "any";
  const ok = rg === "melee" ? d === 0 : rg === "ranged" ? d === 1 : d <= 1;
  return ok && !(typeof lineBlocked === "function" && lineBlocked(a.zone, zone));
}
/** 某区还站着、能挨打的我方单位（倒地没起身的不算） */
function standingPlayersIn(zone) {
  return allPlayers().filter(u => !u.dead && Number(u.zone) === Number(zone) &&
    !(typeof isDownProtected === "function" && isDownProtected(u)));
}
/** 这一击真的打出去了：在等协助格挡、或者已经结算（射程外 / 被危墙挡住 / 目标不能打的不算） */
function enemyShotWentOut(out) {
  return !!out && (!!out.pending || !!(out.res && out.res.ok !== false));
}
/** 这一击打中了：结算了、没被协助格挡挡下（附带效果只在这时生效） */
function enemyHitLanded(out) {
  return !!out && !out.pending && !!out.res && out.res.ok !== false &&
    (typeof attackConnected !== "function" || attackConnected(out.res, out.res.flags));
}

/** 巨人协助「捏碎颅骨，造成倒地」：不是伤害，目标直接倒地——我方角色血量归零进入濒死，照倒地规则
 *  （力竭 3 被击倒立刻死亡；已经靠坚毅生命起身的再次倒下；武器人倒下）。屹立不倒 / 再次霜结这类本回合不受任何伤害的照样挡住。
 *  目标身上原有的自我效果不动（以前写成 self = "down"，既没倒地，又把千钧之类的自我效果冲掉了） */
function crushSkullDown(t, lines) {
  if (!t || t.dead) return;
  if (typeof isDownProtected === "function" && isDownProtected(t)) { lines.push(`${t.name} 已经倒地。`); return; }
  const r = t.resources || {};
  if (r.standTurn || r.frostShell) { lines.push(`${t.name} 本回合不受任何伤害，没有被捏倒。`); return; }
  if (r.mecha && typeof exitMecha === "function") lines.push(...exitMecha(t, "被捏碎颅骨，机甲解除").slice(1));
  const lost = totalHp(t);
  (t.layers || []).forEach(l => { l.current = 0; });
  if (typeof markPartyHurt === "function") markPartyHurt(t, { total: lost });
  if (typeof spawnPopup === "function") spawnPopup(t, { kind: "status", text: "倒地", element: "physical" });
  if (!t.isPlayer) {
    if (typeof settleEnemyKill === "function") settleEnemyKill(t, lines);
  } else if (typeof isWeaponUnit === "function" && isWeaponUnit(t)) {
    t.dead = true;
    lines.push(`${t.name} 被捏碎，武器人倒下。`);
  } else if (typeof exhaustTierOf === "function" && exhaustTierOf(t) >= 3) {
    t.dead = true;
    t.dying = false;
    t.upOnShp = false;
    lines.push(`${t.name} 被捏碎颅骨倒地。力竭 3：被击倒后立刻死亡。`);
  } else {
    t.dying = true;
    t.upOnShp = false;
    if (typeof clearStunOnDown === "function") clearStunOnDown(t);
    lines.push(`${t.name} 被捏碎颅骨，倒地陷入濒死。`);
  }
  if (typeof bossMechSync === "function") bossMechSync(lines);   // 死刑等标记：被标记的人倒下了就转标
}

/** 高压巡逻艇（手册第十章）：回合开始若在飞行，就给自己过载——护盾翻倍；过载期间被击破，坠机之外再吃过载爆炸。
 *  一直飞着就一直过载：回合开始不按「过载下回合开始时清零」清它的护盾（护盾照常一回合没挨打就回满，回满到翻倍后的上限）；
 *  被击落后不再续上，这层过载到下回合开始照常清零。回合开始（app.js · beginRound）调用 */
function boatKeepsOverload(u) {
  return !!u && u.kit === "patrolboat" && !!u.flying && !u.dead && !u.hidden && !!(u.instant && u.instant.overload);
}
function boatOverloadRoundStart(u, notes) {
  if (!u || u.kit !== "patrolboat" || !u.flying || u.dead || u.hidden) return;
  if (u.instant && u.instant.overload) notes.push(`${u.name} 仍在飞行：过载持续（护盾翻倍）。`);
  else if (typeof applyInstantEffect === "function") {
    notes.push(`${u.name} 回合开始在飞行：给自己过载。`);
    applyInstantEffect(u, "overload", notes);
  }
}

/* ===== 第二采矿场 ===== */
/** 这一区是火场 */
function zoneOnFire(z) {
  const f = state.fields && state.fields[z];
  return !!f && typeof fieldFireOn === "function" && fieldFireOn(f);
}
/** 燃气收集机能不能把这一区点成火场（不是火场、不是固有场地 / 深渊 / 被锁定） */
function gasCanIgnite(z) {
  if (zoneOnFire(z)) return false;
  return typeof fieldChangeWhy === "function" ? !fieldChangeWhy(z, "fire") : true;
}
/** 燃气收集机：目标有灼烧时每段攻击回血（3% 血量上限 × 灼烧层数） */
const GAS_LIFESTEAL = 0.03;
/** 燃气收集机的喷火：近距离一人 3 段 0.5×atk 火，共 1 击破 */
function gasSpray(a, t, aa) {
  return aa(t, { element: "fire", mult: 0.5, hits: 3, baseBreak: 1, breakOnce: true, onConnect: { lifesteal: GAS_LIFESTEAL } });
}
/** 火石清扫机：站在火场里时，每一击都造成灼烧 */
function flintOnConnect(a) {
  return zoneOnFire(a.zone) ? { burn: 1 } : undefined;
}
/** 火石清扫机：回合开始先掷好下一次发射几发（1d6），还没打出去就留着。2 发以上是连击，名牌上预警 */
function flintRollShots(u, notes) {
  if (!u || u.dead || u.hidden) return;
  u.resources = u.resources || {};
  if (Number(u.resources.flintShots) >= 1) return;
  u.resources.flintShots = 1 + Math.floor(Math.random() * 6);
  if (u.resources.flintShots >= 2 && notes) notes.push(`${u.name} 装填了 ${u.resources.flintShots} 发火石：下次发射是连击。`);
}
/** 敌人名牌上的行动提示（红底白字的长方形）：这个敌人的回合将要做的特别行动。现在有：连击 */
function enemyIntents(u) {
  if (u && !u.isPlayer && u._linger && !u._removed) return ["待复活"];   // 微光下倒在场上的陨体衍蛛
  if (!u || u.isPlayer || u.dead || u.hidden || u.stunned) return [];
  const out = [];
  if (u.kit === "flint_sweeper" && Number(u.resources && u.resources.flintShots) >= 2) out.push("连击");
  if (u.enriched) out.push("富集");   // 富集变种（desert.js）：打倒掉材料，会逃跑
  return out;
}
/** 蚁型特殊剿灭兵种：我方单位自己走进它所在的区时，用附赠行动退到相邻区（优先没有我方单位的区），并给走进来的人灼烧 1。
 *  照季玛的图纸「稳妥的距离」：被推、被拉进来的不算（app.js · doMoveInner 调用） */
function hunterAfterMove(mover, notes) {
  if (!mover || mover.kind) return;
  const z = Number(mover.zone);
  (state.units || []).forEach(u => {
    if (u.isPlayer || u.kit !== "ant_hunter" || u.dead || u.hidden || u.stunned || u.noMove || Number(u.zone) !== z || !hostileTo(u, mover)) return;
    if ((Number(u.bonus) || 0) < 1) return;
    const open = (zz) => {
      const g = typeof getGap === "function" ? getGap(z, zz) : { type: "open" };
      if (g.type === "wall" || (g.type === "door" && !g.open) || g.type === "void") return false;
      return !(state.fields && state.fields[zz] && state.fields[zz].abyss);
    };
    const adj = (typeof zoneNeighbors === "function" ? zoneNeighbors(z) : []).map(Number).filter(open);
    if (!adj.length) return;
    const foesIn = (zz) => (state.units || []).some(e => hostileTo(u, e) && !e.dead && !e.hidden && Number(e.zone) === zz);
    const dest = adj.find(x => !foesIn(x)) || adj[0];
    u.bonus -= 1;
    u.zone = dest;
    notes.push(`${mover.name} 走进来，${u.name} 用附赠行动退到 ${dest} 区。`);
    if (typeof grantBurn === "function") {
      const before = Number(mover.statuses && mover.statuses.burn) || 0;
      grantBurn(mover, 1, notes);
      const after = Number(mover.statuses && mover.statuses.burn) || 0;
      if (after > before) notes.push(`${mover.name} 灼烧 +1 → ${after} 层。`);
    }
  });
}
/** 蚁型特殊剿灭兵种：敌人回合开始时，天气不是酷暑而且能改，就花 1 行动点把天气变成酷暑（app.js · startEnemyPhase 调用） */
function hunterHeatAtTurnStart(u, notes) {
  if (!u || u.kit !== "ant_hunter" || u.dead || u.hidden || u.stunned) return;
  if (state.weather === "heat" || (Number(u.ap) || 0) < 1) return;
  if (typeof weatherChangeWhy === "function" && weatherChangeWhy("heat")) return;
  if (typeof setWeather === "function" && !setWeather("heat", { by: u.id })) {
    u.ap -= 1;
    notes.push(`${u.name} 回合开始：用 1 行动点把天气变为酷暑。`);
  }
}

/* ===== 阵营敌对 =====
 * 异星生物和其他所有阵营的敌人互相视为敌人；盗匪和安保、警卫队互相视为敌人（会互相攻击、不互相协助）。
 * 其余敌人阵营之间照旧是一伙的。 */
const HOSTILE_FACTION = "异星生物";
const HOSTILE_PAIRS = [["盗匪", "安保"], ["盗匪", "警卫队"], ["沙漠生物", "沙灵"]];
function factionOf(u) {
  if (!u) return null;
  if (u.isPlayer) return "我方";
  const i = typeof enemyInfo === "function" ? enemyInfo(u.kit) : null;
  return (i && i.faction) || null;
}
/** 这个敌人和我方是同阵营（跑团战斗模板可以设「我方与某阵营同阵营」，state.playerAllies） */
function playerAllied(u) {
  if (!u || u.isPlayer) return false;
  const g = (typeof state !== "undefined" && state.playerAllies) || [];
  return g.length > 0 && g.includes(factionOf(u));
}
/** a 和 b 是不是敌对的 */
function hostileTo(a, b) {
  if (!a || !b || a === b) return false;
  // 中立生物（尘虫、管虫）：谁都不当它是敌人；要打它得专门去打（玩家手动、沙鱼捕食）
  if (typeof isNeutralCreature === "function" && (isNeutralCreature(a) || isNeutralCreature(b))) return false;
  if (!!a.isPlayer !== !!b.isPlayer) return !playerAllied(a.isPlayer ? b : a);
  if (a.isPlayer) return false;
  const fa = factionOf(a), fb = factionOf(b);
  if (!fa || !fb || fa === fb) return false;
  if (fa === HOSTILE_FACTION || fb === HOSTILE_FACTION) return true;
  return HOSTILE_PAIRS.some(([x, y]) => (fa === x && fb === y) || (fa === y && fb === x));
}
/** 场上和 a 敌对、还活着的单位 */
function hostilesOf(a) {
  return (state.units || []).filter(u => u && hostileTo(a, u) && !u.dead && !u.hidden && !u._removed && !u.fused && u.kit !== "ironwall");
}

/* ===== 第三采矿场 ===== */
/** 身上有高能状态（#52：蓄能攒的高能值不算） */
function hasHigh(u) { return !!(u && u.statuses && u.statuses.high); }
/** 矿场警戒自动机施加高能：目标已经高能就改成 1 点能量伤害 */
function alarmApplyHigh(a, t, notes) {
  if (!t || t.dead) return;
  if (hasHigh(t)) {
    notes.push(`${t.name} 已经高能：改为受到 1 点能量伤害。`);
    const out = dealTo(a, t, { atk: 0, mult: 0, flat: 1, element: "energy", baseBreak: 0, flags: { action: false, blockResolved: true, block: "none", atkFx: [] } });
    if (out && out.extra) notes.push(...out.extra);
    return;
  }
  t.statuses = t.statuses || {};
  t.statuses.high = true;
  if (typeof popStatus === "function") popStatus(t, "high");
  notes.push(`${t.name} 被施加高能。`);
}
/** 矿场警戒自动机要打的：所有身上有高能、还站着的敌对单位（不限距离） */
function alarmTargets(a) {
  return hostilesOf(a).filter(u => hasHigh(u) && !(typeof isDownProtected === "function" && isDownProtected(u)));
}
/** 休眠（通用词条）：开场休眠的敌人不行动、不协助，直到被叫醒。叫醒时 culprit 是吵醒它的单位（可能没有） */
function wakeDormant(u, culprit, notes, why) {
  if (!u || !u.dormant || u.dead) return;
  u.dormant = false;
  notes.push(`${u.name} ${why || "被惊动"}，解除休眠。`);
  if (u.kit === "alarm_bot" && culprit && hostileTo(u, culprit)) alarmApplyHigh(u, culprit, notes);
}
/** 我方单位进入某区（自己走、被推都算）：叫醒那一区休眠的敌人（app.js · doMoveInner / displaceTo 调用） */
function dormantAfterMove(mover, notes) {
  if (!mover || mover.kind) return;
  (state.units || []).forEach(u => {
    if (u.dormant && !u.isPlayer && !u.dead && !u.hidden && hostileTo(u, mover) && Number(u.zone) === Number(mover.zone)) wakeDormant(u, mover, notes, `${mover.name} 进入它所在的区`);
  });
}
/** 敌人受到伤害：同阵营（含可混编的阵营，不含异星生物）休眠的单位都被叫醒，自己挨打也醒（app.js · dealTo 调用） */
function dormantOnAllyHurt(target, attacker) {
  const notes = [];
  if (!target || target.isPlayer) return notes;
  const info = (k) => (typeof enemyInfo === "function" ? enemyInfo(k) : null) || {};
  const tf = info(target.kit).faction;
  (state.units || []).forEach(u => {
    if (!u.dormant || u.isPlayer || u.dead || u.hidden) return;
    const f = info(u.kit).faction;
    const same = u === target || (tf && f && (typeof alliesOf === "function" ? alliesOf(f) : [f]).includes(tf));
    if (!same) return;
    wakeDormant(u, attacker && hostileTo(u, attacker) ? attacker : null, notes, u === target ? "受到攻击" : `${target.name} 受到攻击`);
  });
  return notes;
}
/** 陨石开采机被我方打死：给杀它的人施加高能，并把自己的高能值转过去（不再自己高能自爆）。app.js · settleEnemyKill 调用 */
function minerDeathTransfer(target, killer, notes) {
  if (!target || target.kit !== "meteor_miner" || !killer || !killer.isPlayer || killer.dead || target._minerDone) return;
  target._minerDone = true;
  const he = Math.max(0, Number(target.highEnergy) || 0);
  target.highEnergy = 0;
  if (target.statuses) target.statuses.high = false;
  killer.statuses = killer.statuses || {};
  const fresh = !killer.statuses.high;
  killer.statuses.high = true;
  if (fresh && typeof popStatus === "function") popStatus(killer, "high");
  killer.highEnergy = (Number(killer.highEnergy) || 0) + he;
  notes.push(`${target.name} 坠毁：${killer.name} 被施加高能${he ? `，接过 ${he} 点高能值 → ${killer.highEnergy}` : ""}。`);
  if (typeof checkHighBoom === "function") checkHighBoom(killer);
}

/* ===== 第三采矿场 · 异星生物 ===== */
const livingSpiders = () => (state.units || []).filter(u => u.kit === "meteor_spider" && !u.dead && !u.hidden && !u._removed);
/** 陨体弦蚣打中之后：场上每只活着的陨体衍蛛立刻免费对同一个人打 1 点能量（times 次） */
function spiderFollowUp(t, times, lines) {
  const spiders = livingSpiders();
  if (!t || t.dead || !spiders.length || times <= 0) return;
  lines.push(`${spiders.length} 只陨体衍蛛跟着扑向 ${t.name}（各 ${times} 次）。`);
  spiders.forEach(s => {
    for (let i = 0; i < times; i++) {
      const out = dealTo(s, t, { atk: 0, mult: 0, flat: 1, element: "energy", baseBreak: 0, flags: { action: true, anyRange: true, blockResolved: true, block: "none", atkFx: [] } });
      if (out && out.extra) lines.push(...out.extra);
    }
  });
}
/** 异星生物死亡（app.js · sweepDeadEnemies 在清场前调用）。返回 true = 不离场（陨体衍蛛留在场上等复活）
 *  陨体衍蛛：25% 把天气变成微光；微光下还有活着的衍蛛 → 留在场上，下回合结束时以 50% 血量、1 架势复活。
 *  陨体弦蚣：微光下死亡分裂成 1–3 只陨体衍蛛。 */
function alienOnDeath(u, notes) {
  if (!u) return false;
  if (u.kit === "meteor_centipede" && !u._splitDone) {
    u._splitDone = true;
    if (state.weather === "glow") {
      const n = 1 + Math.floor(Math.random() * 3);
      const p = enemyPresets().find(x => x.id === "meteor_spider");
      for (let i = 0; i < n; i++) {
        const s = typeof applyEnemyIV === "function" ? applyEnemyIV(p.build(u.level, state.partySize)) : p.build(u.level, state.partySize);
        s.zone = u.zone;
        state.units.push(s);
      }
      notes.push(`微光下，${u.name} 的尸体分裂成 ${n} 只陨体衍蛛。`);
    }
    return false;
  }
  if (u.kit !== "meteor_spider") return false;
  u.dead = true;
  if (!u._deathRolled) {
    u._deathRolled = true;
    if (Math.random() < 0.25 && state.weather !== "glow") {
      const err = typeof setWeather === "function" ? setWeather("glow", { by: u.id }) : "无法改变天气";
      notes.push(err ? `${u.name} 死去时想把天气变成微光：${err}` : `${u.name} 死去，碎裂的陨体让天气变成了微光。`);
    }
    if (state.weather === "glow" && livingSpiders().length) {
      u._linger = { reviveTurn: (Number(state.turnNo) || 0) + 1 };
      notes.push(`微光下，${u.name} 倒在场上没有离开：下回合结束时会复活（场上的陨体衍蛛全部死亡就不会再复活）。`);
    }
  }
  return !!u._linger;
}
/** 回合结束（app.js · turnEnd）：留在场上的陨体衍蛛到点复活；场上已经没有活着的衍蛛就全部离场 */
function spiderRoundEnd(notes) {
  const lingering = (state.units || []).filter(u => u.kit === "meteor_spider" && u._linger && !u._removed);
  if (!lingering.length) return;
  if (!livingSpiders().length) {
    notes.push("场上的陨体衍蛛已经全部死亡，倒下的衍蛛不会再复活。");
    lingering.forEach(u => { u._linger = null; if (typeof removeEnemyFromField === "function") removeEnemyFromField(u, notes); });
    return;
  }
  lingering.filter(u => (Number(state.turnNo) || 0) >= u._linger.reviveTurn).forEach(u => {
    u._linger = null;
    u._deathRolled = false;
    u._revived = true;   // 复活后再被打死：不再给经验、掉落和击杀分（app.js · settleEnemyKill）
    u._xpGiven = false;  // 让再次死亡照常判死
    u.dead = false;
    u.stunned = false;
    u.statuses = {};
    (u.layers || []).forEach(l => { l.current = Math.max(1, Math.round((Number(l.max) || 0) * 0.5)); });
    u.def = Math.min(1, Number(u.defMax) || 1);
    notes.push(`${u.name} 复活了（50% 血量，1 架势）。`);
  });
}

/** 蚁型特殊戒备兵种：对标定的区发射大酸液弹。区内随机一人 2×atk 酸 2 击破（单体），同区其他人 等级+1d6 酸（范围） */
function antFireShell(a, aa, lines) {
  const r = a.resources = a.resources || {};
  const zone = Number(r.shellZone);
  r.shellZone = 0; r.shellPending = false; r.shellReady = false;
  const victims = standingPlayersIn(zone);
  if (!victims.length) { lines.push(`大酸液弹落在 ${zone} 区，那里没有人。`); return; }
  // 决一死战：被决斗时只能打灯（正中的就是灯；其余人的范围波及在 dealTo 里拦下）
  const duel = typeof touDuelVictim === "function" ? touDuelVictim(a) : null;
  const main = duel && victims.includes(duel) ? duel : victims[Math.floor(Math.random() * victims.length)];
  lines.push(`${a.name} 的大酸液弹在 ${zone} 区炸开，正中 ${main.name}。`);
  aa(main, { element: "acid", mult: 2, baseBreak: 2 });
  victims.filter(u => u.id !== main.id).forEach(u => {
    aa(u, { element: "acid", mult: 0, flat: Number(a.level) || 1, diceN: 1, diceS: 6, baseBreak: 0, flags: { action: true, aoe: true } });
  });
}

function runEnemyAction(id, a, t, hitOne, lines, needT) {
  const prev = ENEMY_ACTOR;
  ENEMY_ACTOR = a && !a.isPlayer ? a : null;
  try { return runEnemyActionInner(id, a, t, hitOne, lines, needT); } finally { ENEMY_ACTOR = prev; }
}
function runEnemyActionInner(id, a, t, hitOne, lines, needT) {
  if (typeof desertEnemyAction === "function" && desertEnemyAction(id, a, t, hitOne, lines, needT)) return true;   // 沙鱼（desert.js）
  const atk = effectiveAtk(a, state.units);
  const sg = a.suggest || {};
  const diceN = extraDiceByLevel(a.level);
  const baseDice = sg.dice || [1, 4];

  const skillRange = ENEMY_SKILL_RANGE[id] || a.range || "any";
  const aa = (target, opt) => hitOne(a, target, Object.assign({ atk, atkRange: skillRange }, opt));

  // 赤牙：自己再出手就离开掩体（掩体撑过我方回合，到她下一次出手为止）；霰弹枪的 −40% 协助格挡只算那一枪
  if (a.kit === "chixia") {
    a.resources = a.resources || {};
    if (id !== "en_chi_cover" && a.resources.cover) {
      a.resources.cover = false;
      lines.push(`${a.name} 离开掩体。`);
    }
    if (id !== "en_chi_shot") a.blockMalus = 0;
  }

  if (id === "en_approach") {
    if (!needT()) return true;
    if (Number(a.zone) === Number(t.zone)) lines.push("已在同一区。");
    else stepTowardZone(a, t.zone);
    return true;
  }
  if (id === "en_flee") {
    if (!needT()) return true;
    if (Number(a.zone) !== Number(t.zone)) lines.push("已经不在同一区。");
    else stepTowardZone(a, otherZone(a.zone, t.zone));   // 往离目标最远的相邻区躲
    return true;
  }
  if (id === "en_aa" || id === "en_ox_assist") {   // 牛队长的协助就是一次普通攻击，只是仅限近距（射程表）
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
    // 借机攻击是反应，不受射程限制；协助攻击照手册「近距」（射程表），距离 1 打不到
    const opp = id === "en_thug_opp";
    aa(t, { element: "physical", mult: 1, diceN: id === "en_thug_knife" ? 1 : 0, diceS: 8, baseBreak: 1,
            flags: opp ? { action: true, opportunity: true } : undefined });
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
    if (typeof markAoeZone === "function") markAoeZone(a.zone, { element: "energy", dmg: (Number(a.atk) || 0) + 3, attacker: a });
    a.layers.forEach(l => { l.current = 0; });
    lines.push(`${a.name} 自爆后损毁。`);
    // 自爆就是死亡：当场判死、清场（敌人行动之后不会再扫一遍阵亡，只把血清空的话它还算活着、战斗也结束不了）
    a.dead = true;
    if (typeof removeEnemyFromField === "function") { const out = []; removeEnemyFromField(a, out); lines.push(...out); }
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
    if (typeof markAoeZone === "function") markAoeZone(a.zone, { element: "harmonic", dmg: Number(a.atk) || 0, attacker: a });
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
    // 腐蚀只在打中时施加：被协助格挡住、射程外打不到都不上（同观测鸦的高能）
    aa(t, { element: "acid", mult: 1, diceN: 1, diceS: (typeof leveledSides === "function" ? leveledSides(a.level, 4) : 4), baseBreak: 0, onConnect: { status: "corr" } });
    return true;
  }
  if (id === "en_mine_guard" || id === "en_mine_guard_assist") {
    if (!needT()) return true;
    // 目标身上有腐蚀、或自己站在酸液地面上：打中后同区其他敌对单位再吃 0.5×atk 酸（不打同阵营）
    const splash = !!(t.statuses && t.statuses.corr) || onAcidGround(a);
    if (id === "en_mine_guard") stepTowardZone(a, t.zone);
    aa(t, {
      element: "acid",
      mult: id === "en_mine_guard_assist" ? 0 : 1,
      flat: id === "en_mine_guard_assist" ? 3 : (sg.flat || 0),
      diceN: baseDice[0] || 1,
      diceS: baseDice[1] || 4,
      baseBreak: 1,
      onConnect: splash ? { splash: { mult: 0.5, element: "acid" } } : undefined
    });
    return true;
  }
  if (id === "en_ant_spray") {
    if (!needT()) return true;
    aa(t, { element: "acid", mult: 1, diceN: 1, diceS: 6, baseBreak: 1, onConnect: { status: "corr" } });
    return true;
  }
  if (id === "en_ant_assist") {
    // 大酸液弹已经标定（蓄力中，不管到没到发射回合）：协助时立刻对标定的区发射；否则远距 1×atk 酸
    const r = a.resources || {};
    if (r.shellPending && Number(r.shellZone) >= 1) { antFireShell(a, aa, lines); return true; }
    if (!needT()) return true;
    aa(t, { element: "acid", mult: 1, baseBreak: 1 });
    return true;
  }
  if (id === "en_ant_shell") {
    if (!onAcidGround(a)) { lines.push(`${a.name} 不在酸液地面上，汲取不到酸。`); return true; }
    const fl = state.skillFlow;
    let zone = Number((fl && fl.picks && fl.picks.dest) || t && t.zone);
    if (!(zone >= 1)) { lines.push("大酸液弹需要先选择落点区域。"); return true; }
    zone = forcedZonePick(a, zone, lines);
    a.resources = a.resources || {};
    a.resources.shellZone = zone;
    a.resources.shellPending = true;
    a.resources.shellReady = false;
    lines.push(`${a.name} 从酸液地面汲取酸，把大酸液弹标定在 ${zone} 区。下个敌人回合发射。`);
    return true;
  }
  if (id === "en_ant_shell_fire") {
    const r = a.resources || {};
    if (!(Number(r.shellZone) >= 1) || !r.shellReady) { lines.push("大酸液弹尚未就绪。先标定区域，等到下一个敌人回合再发射。"); return true; }
    // 被牵制：已经标定好的落点不在牵制者所在的区，必须重新标定（作者定）
    const fz = forcedZonePick(a, Number(r.shellZone), []);
    if (fz !== Number(r.shellZone)) {
      lines.push(`${a.name} 被牵制：放弃原来的 ${r.shellZone} 区，大酸液弹重新标定在 ${fz} 区，下个敌人回合发射。`);
      Object.assign(r, { shellZone: fz, shellPending: true, shellReady: false });
      return true;
    }
    antFireShell(a, aa, lines);
    return true;
  }

  if (id === "en_alarm_zap") {
    // 所有高能的敌人：3 段 0.3×atk + 1d4 能量，共 1 击破（不限距离）
    const list = alarmTargets(a);
    if (!list.length) { lines.push("场上没有高能的敌人。"); return true; }
    list.forEach(u => aa(u, { element: "energy", mult: 0.3, diceN: 1, diceS: 4, hits: 3, baseBreak: 1, breakOnce: true, flags: { action: true, anyRange: true } }));
    return true;
  }
  if (id === "en_alarm_assist") {
    const list = alarmTargets(a);
    if (!list.length) { lines.push("场上没有高能的敌人。"); return true; }
    list.forEach(u => aa(u, { element: "energy", mult: 1, baseBreak: 1, flags: { action: true, anyRange: true } }));
    return true;
  }
  if (id === "en_miner_shot" || id === "en_miner_assist") {
    if (!needT()) return true;
    aa(t, { element: "energy", mult: 1, baseBreak: 1, flags: { action: true, atkFx: ["backflow"] } });
    return true;
  }
  if (id === "en_spider_bite" || id === "en_spider_assist") {
    if (!needT()) return true;
    if (id === "en_spider_bite") stepTowardZone(a, t.zone);
    aa(t, { element: "energy", mult: 1, baseBreak: 1, onConnect: id === "en_spider_assist" ? { status: "high" } : undefined });
    return true;
  }
  if (id === "en_centi_shot" || id === "en_centi_assist") {
    if (!needT()) return true;
    const out = aa(t, { element: "energy", mult: 1, baseBreak: 1, onConnect: { status: "high" } });
    // 打出去了（没被射程 / 危墙挡下）才让衍蛛追打；被格挡的照样追打（追打是另外的攻击）
    if (enemyShotWentOut(out)) spiderFollowUp(t, id === "en_centi_assist" ? 2 : 1, lines);
    return true;
  }
  if (id === "en_overseer") {
    if (!needT()) return true;
    stepTowardZone(a, t.zone);
    aa(t, { element: "fire", mult: 1, diceN: 1, diceS: 6, baseBreak: 2, onConnect: { burn: 1 } });
    return true;
  }
  if (id === "en_overseer_assist") {
    // 同狂徒（锤）的协助：冲到目标那一区，atk/2，1 击破（改成火）
    if (!needT()) return true;
    stepTowardZone(a, t.zone, { free: true });
    aa(t, { element: "fire", mult: 0.5, baseBreak: 1 });
    return true;
  }
  if (id === "en_flint") {
    if (!needT()) return true;
    // 连击：1d6 发火石（回合开始时已经掷好，名牌上有「连击」预警），每发单独结算、单独格挡：0.5×atk + 1d4 火，只有第一发 1 击破。
    // 没被嘲讽就按顺序轮流分给远距离、打得到的不同的人（先打选定的目标）
    a.resources = a.resources || {};
    const shots = Number(a.resources.flintShots) >= 1 ? Number(a.resources.flintShots) : 1 + Math.floor(Math.random() * 6);
    a.resources.flintShots = null;
    const forced = !!(a.tauntTo || a.lockdownBy || (typeof touDuelVictim === "function" && touDuelVictim(a)));
    const others = forced ? [] : allPlayers().filter(u => u !== t && !u.dead && !(typeof isDownProtected === "function" && isDownProtected(u)) &&
      zoneDist(a.zone, u.zone, state.zoneMode) === 1 && !(typeof lineBlocked === "function" && lineBlocked(a.zone, u.zone)));
    const pool = [t].concat(others);
    lines.push(`${a.name} ${shots >= 2 ? "连击：" : ""}发射 ${shots} 发火石。`);
    for (let i = 0; i < shots; i++) {
      const u = pool[i % pool.length];
      aa(u, { element: "fire", mult: 0.5, diceN: 1, diceS: 4, baseBreak: i === 0 ? 1 : 0, onConnect: flintOnConnect(a) });
    }
    return true;
  }
  if (id === "en_flint_assist") {
    if (!needT()) return true;
    aa(t, { element: "fire", mult: 1.5, baseBreak: 1, flags: { action: true, atkFx: ["combust"] }, onConnect: flintOnConnect(a) });
    return true;
  }
  if (id === "en_gas_ignite") {
    const z = Number(a.zone);
    if (zoneOnFire(z)) { lines.push(`${z} 区已经是火场。`); return true; }
    if (!gasCanIgnite(z)) { lines.push(`${a.name} 点不着 ${z} 区：${fieldChangeWhy(z, "fire")}`); return true; }
    standingPlayersIn(z).forEach(u => {
      aa(u, { element: "fire", mult: 0.5, baseBreak: 0, flags: { action: true, aoe: true }, onConnect: { lifesteal: GAS_LIFESTEAL } });
    });
    const err = setZoneField(z, "fire", { by: a.id });
    lines.push(err || `${a.name} 点燃收集的燃气：${z} 区变为火场。`);
    return true;
  }
  if (id === "en_gas_spray") {
    if (!needT()) return true;
    gasSpray(a, t, aa);
    return true;
  }
  if (id === "en_gas_assist") {
    // 冲到目标那一区，先给目标灼烧 1，再喷火
    if (!needT()) return true;
    stepTowardZone(a, t.zone, { free: true });
    if (typeof grantBurn === "function") {
      grantBurn(t, 1, lines);
      lines.push(`${t.name} 灼烧 → ${(t.statuses && t.statuses.burn) || 0} 层。`);
    }
    gasSpray(a, t, aa);
    return true;
  }
  if (id === "en_hunter_shot") {
    if (!needT()) return true;
    aa(t, { element: "fire", mult: 1, diceN: 1, diceS: 8, baseBreak: 1, flags: { action: true, pierce: true } });
    return true;
  }
  if (id === "en_hunter_assist") {
    // 狙击：1×atk + 目标血量上限 10% 的火伤（同一击里，一起吃穿刺 / 爆燃 / 克制），打坦克更疼
    if (!needT()) return true;
    const maxHp = (t.layers || []).reduce((sum, l) => sum + (Number(l.max) || 0), 0);
    const pct = Math.round(maxHp * 0.1);
    aa(t, { element: "fire", mult: 1, flat: pct, baseBreak: 1, flags: { action: true, pierce: true, atkFx: ["combust"] } });
    return true;
  }
  if (id === "en_hunter_heat") {
    const why = state.weather === "heat" ? "天气已经是酷暑。" : (typeof weatherChangeWhy === "function" ? weatherChangeWhy("heat") : null);
    if (why) { lines.push(why); return true; }
    setWeather("heat", { by: a.id });
    lines.push(`${a.name} 把天气变为酷暑。`);
    return true;
  }
  if (id === "en_swarm") {
    if (!needT()) return true;
    stepTowardZone(a, t.zone);
    // 2d4 + atk，每五级伤害骰升一档（手册）
    aa(t, { element: "physical", mult: 1, diceN: 2, diceS: (typeof leveledSides === "function" ? leveledSides(a.level, 4) : 4), baseBreak: 1 });
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
    let zone = Number((fl && fl.picks && fl.picks.dest) || t && t.zone);
    if (!(zone >= 1)) {
      lines.push("榴弹需要先选择落点区域。");
      return true;
    }
    zone = forcedZonePick(a, zone, lines);
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
    // 被牵制：已经标定好的落点不在牵制者所在的区，必须重新标定（作者定）
    const fz = forcedZonePick(a, zone, []);
    if (fz !== zone) {
      Object.assign(a.resources, { glZone: fz, glPending: true, glReady: false });
      lines.push(`${a.name} 被牵制：放弃原来的 ${zone} 区，榴弹重新标定在 ${fz} 区，下个敌人回合发射。`);
      return true;
    }
    const victims = fieldUnits().filter(u => !u.dead && !u.hidden && Number(u.zone) === zone && u.id !== a.id && hostileTo(a, u));
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
    // 「远离并拔枪」：和目标同区就退到相邻区再远距开枪；已经隔着一区就原地开枪（以前三区里会朝目标走过去）
    if (Number(a.zone) === Number(t.zone)) stepTowardZone(a, otherZone(a.zone, t.zone), { free: true });
    aa(t, { element: "fire", mult: 1, diceN: 1, diceS: 8, baseBreak: 2 });
    // 「所有狂徒立刻各做一次协助」：还能出手、打得到的狂徒各用自己的协助（锤狂徒是冲近 atk/2）；
    // 死掉的（还没清出场的）、失衡的、哗变的不出手。协助攻击不能被格挡，所以出手期间记在 _assistBy 上
    state.units.filter(th => th.id !== a.id && /^thug_/.test(th.kit || "") && !th.dead && !th._removed && !th.hidden &&
      (typeof unitCanFight !== "function" || unitCanFight(th)) && enemyAssistReady(th, t)).forEach(th => {
      if (typeof assistTargetGone === "function" && assistTargetGone(t)) return;
      lines.push(`${th.name} 因强盗头子连携发动协助。`);
      const prevBy = state._assistBy;
      state._assistBy = th.id;
      try { runEnemyAction(enemyAssistSkillId(th), th, t, hitOne, lines, needT); } finally { state._assistBy = prevBy; }
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
      const u = applyEnemyIV(p.build(a.level, state.partySize));
      u.zone = a.zone;
      state.units.push(u);
    }
    lines.push(`召唤了 ${n} 只沙灵到 ${a.zone} 区。`);
    return true;
  }
  if (id === "en_bigsand_heal") {
    // 手册：治疗最低沙灵 2d4（掷骰）。只治还活着的沙灵（刚被打死、还没清出场的不算）
    const sands = state.units.filter(u => !u.hidden && !u.dead && !u._removed && totalHp(u) > 0 &&
      (u.kit === "sand_beast" || u.kit === "sand_human" || u.kit === "bigsand") && u.id !== a.id);
    if (!sands.length) { lines.push("场上没有其他活着的沙灵。"); return true; }
    sands.sort((x, y) => totalHp(x) - totalHp(y));
    const u = sands[0];
    const r = takeDice(2, 4, 0);
    const sand = (u.layers || []).find(l => l.type === "sand");
    const before = sand ? Number(sand.current) || 0 : 0;
    if (sand) sand.current = Math.min(sand.max, before + r.total);
    lines.push(`治疗 ${u.name} 沙尘 ${r.text}，恢复 ${sand ? sand.current - before : 0}。`);
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
    // 范围攻击：不能格挡，不看距离（三区也打得到距离 2）
    fieldUnits().forEach(u => {
      if (u.id === a.id || (typeof isDownProtected === "function" && isDownProtected(u))) return;
      aa(u, { element: "physical", mult: 1, baseBreak: 0, flags: { action: true, aoe: true } });
    });
    lines.push("全域沙暴：对所有区域所有单位造成 1×ATK 物理。");
    return true;
  }
  if (id === "en_giant_sand_vortex") {
    if (!needT()) return true;
    // 远距流沙漩涡：选距离 1 的一区，区内全员 atk 物理 2 击破（范围攻击，不能格挡），打中的人失去行动
    const z = Number(t.zone);
    if (!enemyZoneInRange(a, id, z)) {
      lines.push(`流沙漩涡是远距离，打不到距离 ${zoneDist(a.zone, z, state.zoneMode)} 的 ${z} 区。`);
      return true;
    }
    standingPlayersIn(z).forEach(u => {
      const out = aa(u, { element: "physical", mult: 1, baseBreak: 2, flags: { action: true, aoe: true } });
      if (!enemyHitLanded(out) || u.dead || u.dying) return;
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
    // 手册「协助近距捏碎颅骨，造成倒地」：只能打同区的目标
    if (Number(a.zone) !== Number(t.zone)) {
      lines.push(`${a.name} 的协助是近距离，够不到距离 ${zoneDist(a.zone, t.zone, state.zoneMode)} 的 ${t.name}。`);
      return true;
    }
    crushSkullDown(t, lines);
    return true;
  }
  if (id === "en_boat_arc") {
    // 被牵制（决一死战 / 嘲讽）而牵制者就在同区：电弧扫射抵近打自己所在的区，×0.6（作者定：没有近身攻击就抵近射击）
    const forced = enemyForcedTarget(a);
    const pb = !!(forced && Number(forced.zone) === Number(a.zone));
    const hit = pb ? standingPlayersIn(a.zone) : allPlayers().filter(u => zoneDist(a.zone, u.zone, state.zoneMode) === 1);
    if (pb) lines.push(`${a.name} 被 ${forced.name} 牵制：电弧扫射抵近打自己所在的 ${a.zone} 区（倍率 ×0.6）。`);
    hit.forEach(u => {
      aa(u, { element: "electric", mult: pb ? 0.6 : 1, diceN: 1, diceS: (typeof leveledSides === "function" ? leveledSides(a.level, 6) : 6), baseBreak: 1, flags: { action: true, aoe: true } });
    });
    // 手册：可对一人施加感电。挑一个还没有感电的目标（被牵制时先给牵制者）。
    const pick = (pb && hit.includes(forced) ? forced : null) || hit.find(u => !(u.statuses && u.statuses.shock)) || hit[0];
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
    // 喷洒：一区内全员 1d6+atk 酸（范围攻击，不能格挡），腐蚀只给打中的人。射程照单位卡（远距离：距离 1 的一区）
    const z = Number(t.zone);
    if (!enemyZoneInRange(a, id, z)) {
      lines.push(`${a.name} 的喷洒打不到距离 ${zoneDist(a.zone, z, state.zoneMode)} 的 ${z} 区。`);
      return true;
    }
    standingPlayersIn(z).forEach(u => {
      aa(u, { element: "acid", mult: 1, diceN: 1, diceS: (typeof leveledSides === "function" ? leveledSides(a.level, 6) : 6), baseBreak: 0,
        flags: { action: true, aoe: true }, onConnect: { status: "corr" } });
    });
    return true;
  }
  if (id === "en_watch") {
    if (!needT()) return true;
    // 高能只在打中时施加：被协助格挡住、被墙挡住都不上
    aa(t, { element: "energy", mult: 1, diceN: 1, diceS: (typeof leveledSides === "function" ? leveledSides(a.level, 8) : 8), baseBreak: 1, onConnect: { status: "high" } });
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
    if (!t.kind) aa(t, { element: "harmonic", mult: 1, diceN: 1, diceS: (typeof leveledSides === "function" ? leveledSides(a.level, 6) : 6), baseBreak: 1, onConnect: canPush ? { dest: otherZone(t.zone, a.zone), reason: "被卷走" } : null });   // 推到离自己最远的相邻区
    return true;
  }
  if (id === "en_king_atk") {
    if (!needT()) return true;
    aa(t, { element: "fire", mult: 1, diceN: 1, diceS: leveledSides(a.level, 4), baseBreak: 1 });
    a.resources = a.resources || {};
    a.resources.focusId = t.id;
    lines.push(`所有狂徒目标切换为 ${t.name}。`);
    return true;
  }
  if (id === "en_king_kill") {
    if (!needT()) return true;
    aa(t, { element: "acid", mult: 1, diceN: 1, diceS: leveledSides(a.level, 6), baseBreak: 1 });
    const boss = state.units.find(u => u.kit === "bandit_boss" && !u.hidden && !u.dead);
    if (boss && Math.random() < 0.5) {
      t.stunned = true;
      lines.push("强盗头子擒拿成功，目标失去下回合行动。");
    } else if (boss) lines.push("强盗头子擒拿失败。");
    return true;
  }
  if (id === "en_king_exec") {
    kingCastExecution(a, lines);
    return true;
  }
  if (id === "en_king_hold") {
    // 记下这次回防（冷却从这回合算），「手下被打倒过」的标记用掉
    a.resources = a.resources || {};
    a.resources.holdTurn = Number(state.turnNo) || 1;
    a.resources.crewDown = false;
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
    // 回防之后：狂徒们拔枪，下一个敌人回合开始时王朝我方每人各开一枪（齐射，KING_CFG.volley）
    kingArmVolley(a, lines);
    // 电击霰弹：另一区全员 (atk + 1d8) ÷ 2 电击（README 的写法）。范围攻击，不能格挡；
    // 打离他距离 1 的一区（三区里有两个时打人多的那个），不会隔着两区打
    const shotZone = zoneNeighbors(a.zone).map(Number)
      .filter(z => standingPlayersIn(z).length && !(typeof lineBlocked === "function" && lineBlocked(a.zone, z)))
      .sort((x, y) => standingPlayersIn(y).length - standingPlayersIn(x).length || x - y)[0];
    if (shotZone == null) lines.push("另一区没有能打到的人，电击霰弹落空。");
    else standingPlayersIn(shotZone).forEach(u => {
      const r = takeDice(1, 8, 0);
      lines.push(`电击霰弹 → ${u.name}：(atk + ${r.text}) ÷ 2`);
      aa(u, { element: "electric", mult: 0.5, diceValue: r.total / 2, baseBreak: 1, flags: { action: true, aoe: true } });
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
    a.resources.coverTurn = Number(state.turnNo) || 0;
    a.resources.primed = true;
    a.ap = 0;   // 使用后结束回合（2 行动点已经扣过，剩下的行动点 / 附赠也不再用）
    a.bonus = 0;
    lines.push("赤牙躲入掩体：受击伤害 −50%、击破 0，撑过我方回合，到她下次出手为止；并为下回合预热霰弹枪。此技能结束她的回合。");
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
    a.blockMalus = 40;   // 对这一枪的协助格挡成功率 −40%（finalBlockChance 读）
    const out = aa(t, { element: "fire", mult: near ? 2 : 1.5, baseBreak: near ? 2 : 1 });
    if (!enemyShotWentOut(out)) { lines.push("霰弹没有打出去，预热保留。"); return true; }
    a.resources.primed = false;
    lines.push(`霰弹射出（${near ? "近距 2×atk、2 击破" : "远距 1.5×atk、1 击破"}），解除预热。对这一枪的协助格挡成功率 −40%。`);
    return true;
  }
  if (id === "en_chi_hunt") {
    if (!needT()) return true;
    t.statuses = t.statuses || {};
    t.statuses.chase = true;
    // 记下施加者：目标移动时跟过去的是赤牙（chaseFollow 读 chasers；以前没记，兜底成了柯尔特去跟）
    t.chasers = (t.chasers || []).filter(x => x !== a.id).concat(a.id);
    if (typeof popStatus === "function") popStatus(t, "chase");
    lines.push(`追猎：${t.name} 移动时赤牙会跟过去。`);
    return true;
  }
  if (id === "en_chi_exec") {
    if (!needT()) return true;
    a.resources = a.resources || {};
    // 剿灭（协助）：冲向目标（走一格，过不去就打不到）并预热，零距离射击 2.5×atk 火焰，然后免费移动一次，解除预热
    if (Number(a.zone) !== Number(t.zone)) stepTowardZone(a, t.zone, { free: true });
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
    picks.forEach(u => aa(u, { element: "physical", mult: 1, diceN: 1, diceS: 4, baseBreak: 2 }));   // 手册 atk+1d4，没写升档
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
    if (typeof markAoeZone === "function") markAoeZone(z, "handled");   // 配置物上面已经打过
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
  if (id === "en_agg1_rush_prep") { lines.push(...aggRushPrep(a)); return true; }
  if (id === "en_agg1_rush") { aggRushRelease(a, aa, lines); return true; }
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
    return true;
  }
  if (id === "en_agg3_debris") {
    a.resources = a.resources || {};
    a.resources.debrisCount = (a.resources.debrisCount || 0) + 1;
    lines.push(`吸引碎片 ${a.resources.debrisCount}/2。`);
    if (a.resources.debrisCount >= 2) {
      a.resources.debrisCount = 0;
      // 装甲回满：按这只聚合体的等级、人数算回原本的装甲上限（进三阶段时装甲层的上限被清成 0；以前只回 等级×2）
      const restore = typeof aggregateLayerHp === "function"
        ? scaleByParty(aggregateLayerHp(a.level).armor, a.hpParty)
        : (a.level || 1) * 2;
      let armorLayer = (a.layers || []).find(l => l.type === "armor");
      if (armorLayer) {
        armorLayer.max = Math.max(Number(armorLayer.max) || 0, restore);
        armorLayer.current = armorLayer.max;
      } else {
        a.layers.splice(1, 0, { type: "armor", current: restore, max: restore });
      }
      a.resources.phase = 2;
      a.name = "沙灵聚合体·机械躯";
      a.dead = false;
      lines.push(`碎片吸收完成，恢复装甲 ${restore}，回到二阶段。`);
      aggArmCannon(a, lines);
    }
    return true;
  }
  if (id === "en_agg3_push") {
    if (!needT()) return true;
    aa(t, { element: "physical", mult: 1, baseBreak: 0, onConnect: { dest: otherZone(t.zone, a.zone), reason: "被推击击退" } });   // 推到离自己最远的相邻区
    return true;
  }
  if (id === "en_agg3_control") {
    if (!needT()) return true;
    if (typeof displaceTo === "function") displaceTo(a, t.zone, lines, "接近肉体操控目标");
    else a.zone = t.zone;
    const out = aa(t, { element: "physical", mult: 1, baseBreak: 0, flags: { action: true, blockResolved: true }, onConnect: { controlAlly: true } });
    // 「并使其下回合失去行动点」：记个标记，我方回合开始算行动点时读（以前在敌人回合里扣，回合开始又被回满）
    if (enemyHitLanded(out) && t.isPlayer && !t.dead) {
      t.loseApNext = true;
      lines.push(`${t.name} 被肉体操控：下回合失去行动点。`);
    }
    return true;
  }
  if (id === "ufo_summon") {
    const kinds = ["guard_sword", "guard_gun"];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const p = enemyPresets().find(x => x.id === kind);
    if (p) {
      const u = applyEnemyIV(p.build(a.level, state.partySize));
      u.zone = a.zone;
      u.summonedBy = a.id;   // 飞碟自爆时连自己召唤的看守一起炸（detonateUfo）
      state.units.push(u);
      lines.push(`召唤 ${u.name} 到 ${u.zone} 区。`);
    }
    return true;
  }
  return false;
}

/** 沙灵聚合体二阶段：挂上电能炮（死刑机制，数值见 engine.js · AGG_CANNON）。已经挂着就不重复挂 */
/* ---------- 沙灵聚合体一阶段 · 狂暴连打（engine.js · AGG_RUSH）---------- */
const aggRushStanding = t => t && !t.dead && !t.hidden && !(t.dying && !t.upOnShp);
function aggRushFoes(a) {
  return (state.units || []).filter(u => u.isPlayer && aggRushStanding(u) && (typeof hostileTo !== "function" || hostileTo(a, u)));
}
/** 预备好了、这回合可以出手（预备是上一回合或更早） */
function aggRushArmed(u) {
  const r = (u && u.resources) || {};
  return !!(r.rush && Number(r.rush.turn) < Number(state.turnNo) && ((r.phase || 1) === 1));
}
function aggRushCanPrep(u) {
  const r = (u && u.resources) || {};
  if ((r.phase || 1) !== 1 || r.rush) return false;
  const t = Number(state.turnNo) || 1;
  return t >= AGG_RUSH.firstTurn && t >= (Number(r.rushNext) || 0);
}
/** 预备：被牵制就锁牵制者，否则随机一名敌人 */
function aggRushPrep(a) {
  const r = a.resources = a.resources || {};
  const forced = typeof enemyForcedTarget === "function" ? enemyForcedTarget(a) : null;
  const foes = aggRushFoes(a);
  const t = forced || (foes.length ? foes[Math.floor(Math.random() * foes.length)] : null);
  if (!t) return [`${a.name} 找不到可以连打的目标。`];
  r.rush = { targetId: t.id, turn: Number(state.turnNo) || 1 };
  return [`${a.name} 沙壳鼓胀，盯上了 ${t.name}：下个敌人回合冲过去狂暴连打 ${AGG_RUSH.hits} 击（每击 ${AGG_RUSH.mult}×atk+1d${AGG_RUSH.diceS} 物理、${AGG_RUSH.baseBreak} 击破，协助格挡 +${AGG_RUSH.blockBonus}%；全部挡下它自己受 ${AGG_RUSH.selfBreak} 击破）。`];
}
/** 出手时打谁：被嘲讽转火牵制者；原目标倒下就随机换一个 */
function aggRushTarget(a) {
  const r = a.resources || {};
  const forced = typeof enemyForcedTarget === "function" ? enemyForcedTarget(a) : null;
  if (forced) return forced;
  const marked = r.rush && (state.units || []).find(u => u.id === r.rush.targetId);
  if (aggRushStanding(marked)) return marked;
  const foes = aggRushFoes(a);
  return foes.length ? foes[Math.floor(Math.random() * foes.length)] : null;
}
function aggRushRelease(a, aa, lines) {
  const r = a.resources = a.resources || {};
  const t = aggRushTarget(a);
  const markedId = r.rush && r.rush.targetId;
  r.rush = null;
  r.rushNext = (Number(state.turnNo) || 1) + AGG_RUSH.cooldown;
  if (!t) { lines.push(`${a.name} 的狂暴连打没有目标，散了劲。`); return; }
  if (markedId && t.id !== markedId) lines.push(`${a.name} 被牵制，狂暴连打转向 ${t.name}！`);
  if (Number(a.zone) !== Number(t.zone)) {
    const stuck = a.noMove || (typeof touDuelVictim === "function" && touDuelVictim(a)) || a.self === "anchor";
    if (stuck) { lines.push(`${a.name} 动不了，冲不到 ${t.name} 身边，狂暴连打落空。`); return; }
    if (typeof lineBlocked === "function" && lineBlocked(a.zone, t.zone)) { lines.push(`${a.name} 想冲向 ${t.name}，被墙挡住，狂暴连打落空。`); return; }
    a.zone = Number(t.zone);
    lines.push(`${a.name} 冲到 ${t.zone} 区！`);
  }
  lines.push(`【狂暴连打】${a.name} 对 ${t.name} 连打 ${AGG_RUSH.hits} 击！（每击都能协助格挡，成功率 +${AGG_RUSH.blockBonus}%）`);
  r.rushHit = { done: 0, blocked: 0, issuing: true, open: true };
  a.rushBlock = AGG_RUSH.blockBonus;   // finalBlockChance 读：这几击的协助格挡 +10%
  for (let i = 0; i < AGG_RUSH.hits; i++) {
    if (!aggRushStanding(t)) break;
    aa(t, { element: "physical", mult: AGG_RUSH.mult, diceN: 1, diceS: AGG_RUSH.diceS, baseBreak: AGG_RUSH.baseBreak, atkRange: "melee",
      flags: { action: true, aggRush: true } });
  }
  r.rushHit.issuing = false;
  lines.push(...aggRushSettle(a));
}
/** dealTo 每一击结算完（立刻结算的、等协助格挡结果的都算）调这里：记下是不是被挡下 */
function aggRushHitDone(a, blocked) {
  const h = a && a.resources && a.resources.rushHit;
  if (!h || !h.open) return [];
  h.done += 1;
  if (blocked) h.blocked += 1;
  return h.issuing ? [] : aggRushSettle(a);
}
/** 所有连打都落下了（队列里没有等格挡的）：全部被挡下就自己吃击破 */
function aggRushSettle(a) {
  const h = a && a.resources && a.resources.rushHit;
  if (!h || !h.open) return [];
  if ((state.blockQueue || []).some(j => j.attackerId === a.id && j.opt && j.opt.flags && j.opt.flags.aggRush)) return [];
  h.open = false;
  a.rushBlock = 0;
  const notes = [];
  if (h.done >= AGG_RUSH.hits && h.blocked >= AGG_RUSH.hits) {
    notes.push(`${a.name} 的狂暴连打全部被挡下，反震得沙壳崩裂！`);
    if (typeof dealBreak === "function") dealBreak(a, AGG_RUSH.selfBreak, "physical", notes, "狂暴连打全被挡下");
  }
  return notes;
}

function aggArmCannon(u, notes) {
  if (u && u.resources) u.resources.rush = null;   // 狂暴连打是一阶段的：预备好还没出手的，进二阶段作废
  if (!u || typeof addBossMechanic !== "function") return;
  if (bossMechList(u, "execution").some(m => m.aggCannon)) return;
  addBossMechanic(u, {
    type: "execution", aggCannon: true, name: "电能炮", element: "electric", phase: "enemy", pick: "maxHp",
    turns: AGG_CANNON.turns, interval: AGG_CANNON.interval, then: "repeat",
    firstTurn: Number(state.turnNo) || 1,
    hits: AGG_CANNON.hits.map(h => Object.assign({ element: "electric" }, h)),
    far: Object.assign({}, AGG_CANNON.far), splash: AGG_CANNON.splash, chargeDr: AGG_CANNON.chargeDr,
    hook: "aggOverheat"
  });
  if (typeof bossMechSync === "function") bossMechSync(notes);
}
/** 沙灵聚合体一阶段：挂上沙尘爆裂（远离机制，AGG_SPREAD）；外层沙壳打穿时卸下 */
function aggArmSpread(u) {
  if (!u || typeof addBossMechanic !== "function" || (u.mechanics || []).some(m => m.aggSpread)) return;
  addBossMechanic(u, { type: "spread", aggSpread: true, name: "沙尘爆裂", element: "physical", phase: "enemy",
    firstTurn: AGG_SPREAD.firstTurn, turns: AGG_SPREAD.turns, interval: AGG_SPREAD.interval, then: "repeat",
    blast: { mult: AGG_SPREAD.blast } });
}
function aggDisarmSpread(u, notes) {
  if (!u || !u.mechanics || !u.mechanics.some(m => m.aggSpread)) return;
  u.mechanics = u.mechanics.filter(m => !m.aggSpread);
  if (!u.mechanics.length) delete u.mechanics;
  if (notes) notes.push("沙壳碎了，沙尘爆裂的标记散去。");
}
/** 进三阶段：机械躯散架，电能炮卸下（回到二阶段时重新挂上、重新倒数） */
function aggDisarmCannon(u, notes) {
  if (!u || !u.mechanics) return;
  const had = u.mechanics.some(m => m.aggCannon);
  u.mechanics = u.mechanics.filter(m => !m.aggCannon);
  if (!u.mechanics.length) delete u.mechanics;
  if (had && notes) notes.push("机械躯散架，电能炮停止蓄力。");
}
/** 电能炮开完：机体过热，给自己上熔融（留到下一个我方回合结束，engine.js · beginRound 那边看 meltHoldTurn） */
function aggOverheat(boss, m, notes) {
  if (!boss || boss.dead) return;
  boss.instant = boss.instant || {};
  boss.instant.melt = true;
  boss.resources = boss.resources || {};
  boss.resources.meltHoldTurn = (Number(state.turnNo) || 1) + 1;
  notes.push(`${boss.name} 开炮后机体过热：自身熔融（冰伤害 ×2、物理打装甲 +50%），持续到下一个我方回合结束。`);
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

/* ===== 个体值（杂兵、精英） =====
 * 每个杂兵 / 精英生成时，血量和 atk 各自在 ±10% 内随机波动（整数百分比），记在 u.iv = { hp, atk }。
 * 首领不波动。跑团模式里主持人可以写死具体的水平（战斗模板的敌人行、战斗中改单位），空着就随机。
 * u.ivBase 记着波动之前的数值，改水平时按它重算（不会越改越偏）。
 * ENEMY_IV.off > 0 时不波动（BattleSim.setup 默认关：测试、数值模拟要确定的数字；单局的战斗显式打开） */
const ENEMY_IV = { range: 10, off: 0 };
function ivEligible(u) {
  if (!u || u.isPlayer || u.kit === "ufo_leg" || u.kit === "ufo_body" || u.kit === "ironwall") return false;
  const r = typeof enemyRankOf === "function" ? enemyRankOf(u) : "minion";
  return r === "minion" || r === "elite";
}
/** 水平（百分比）夹到 ±range 的整数；不是数字返回 null（= 随机） */
function ivClamp(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(-ENEMY_IV.range, Math.min(ENEMY_IV.range, Math.round(n)));
}
function ivRoll() {
  return Math.round((Math.random() * 2 - 1) * ENEMY_IV.range) || 0;
}
/** 按水平重算血量和 atk：血量层上限 × (1 + hp%)，已经受的伤保持比例；atk / personalAtk × (1 + atk%)（保留一位小数） */
function setEnemyIV(u, iv) {
  if (!u || !Array.isArray(u.layers)) return u;
  // 敌人出手用的是 personalAtk（面板显示 atk）：两个一起按水平算
  if (!u.ivBase) u.ivBase = { atk: Number(u.atk) || 0, personalAtk: u.personalAtk != null ? Number(u.personalAtk) || 0 : null, max: u.layers.map(l => Number(l.max) || 0) };
  const hp = ivClamp(iv && iv.hp) ?? 0, atk = ivClamp(iv && iv.atk) ?? 0;
  const mh = 1 + hp / 100, ma = 1 + atk / 100;
  u.layers.forEach((l, i) => {
    const base = u.ivBase.max[i] != null ? u.ivBase.max[i] : Number(l.max) || 0;
    if (!(base > 0)) return;
    const oldMax = Number(l.max) || base, cur = Number(l.current) || 0;
    const max = Math.max(1, Math.round(base * mh));
    l.max = max;
    l.current = cur >= oldMax ? max : Math.max(0, Math.min(max, Math.round(cur * max / oldMax)));
  });
  u.atk = Math.round(u.ivBase.atk * ma * 10) / 10;
  if (u.ivBase.personalAtk != null) u.personalAtk = Math.round(u.ivBase.personalAtk * ma * 10) / 10;
  u.iv = { hp, atk };
  return u;
}
/** 生成时调用：iv 里写了的项照写，没写的随机（off 时整体不动、也不记 iv）。首领不波动 */
function applyEnemyIV(u, iv) {
  if (!ivEligible(u) || u.iv) return u;
  const fixed = iv && (ivClamp(iv.hp) != null || ivClamp(iv.atk) != null);
  if (ENEMY_IV.off > 0 && !fixed) return u;
  const hp = ivClamp(iv && iv.hp), atk = ivClamp(iv && iv.atk);
  return setEnemyIV(u, { hp: hp != null ? hp : (ENEMY_IV.off > 0 ? 0 : ivRoll()), atk: atk != null ? atk : (ENEMY_IV.off > 0 ? 0 : ivRoll()) });
}
/** 画面用：「血量 +7% · ATK −3%」 */
function ivText(u) {
  if (!u || !u.iv) return "";
  const f = (n) => (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n) + "%";
  return `血量 ${f(u.iv.hp)} · ATK ${f(u.iv.atk)}`;
}

function spawnEnemyGroup(id, lv, partyN, zone, iv) {
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
  const u = applyEnemyIV(p.build(lv, partyN), iv);
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
  const notes = [`飞碟触灵自爆：所有角色和它召唤的机器人看守受到 ${3 * (body.atk || 0)} 火焰。`];
  const dmg = 3 * (body.atk || 0);
  // 手册「对所有角色」，作者定：它自己召唤的机器人看守也一起炸
  const legIds = ufoLivingLegs(body).map(u => u.id);
  (state.units || []).filter(u => !u.hidden && !u.dead && u.id !== body.id &&
    (u.isPlayer || (u.summonedBy && (u.summonedBy === body.id || legIds.includes(u.summonedBy))))).forEach(u => {
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
  // 击杀照常结算（首领击杀分、跑团经验倍率、掉落），和别的首领一样走 settleEnemyKill
  if (typeof settleEnemyKill === "function") settleEnemyKill(body, notes);
  notes.push("飞碟触灵在自爆中解体。");
  if (typeof sweepDeadEnemies === "function") notes.push(...sweepDeadEnemies());
  return notes;
}

function totalHp(u) {
  return (u.layers || []).reduce((s, l) => s + Math.max(0, Number(l.current) || 0), 0);
}
