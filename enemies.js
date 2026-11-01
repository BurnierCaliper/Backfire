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
  riot_molotov: (u) => {
    const r = u.resources || {};
    if (!r.bottlePending || !r.bottleZone) return null;
    return { zone: r.bottleZone, label: r.bottleReady ? "燃烧瓶待发" : "燃烧瓶标定", ready: !!r.bottleReady };
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
  if (u.kit === "riot_molotov") return false;   // 燃烧瓶投手不能协助（docs/suppression-force.md）
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
  "en_fish_lead_assist", "en_fish_drive_assist", "en_fish_ambush_assist",   // 沙鱼群起：冲到失衡的人那一区
  "en_riot_baton_assist", "en_riot_spray_assist",   // 镇压队：警棍盾、火焰喷射兵冲进目标所在区
  "en_rat_plague_assist", "en_rat_tyrant_assist",   // 下水道狂鼠：疫病暴徒、暴虐猎手冲到目标所在区
  "en_sweeper_assist"];   // 下水道维护：清扫机冲到目标所在区自爆
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
  if (Math.random() < KING_CFG.exec.grab) {
    // 背水一战（夕夏起身中）：擒拿是让人失衡（失去下回合行动），起身中的夕夏不会失衡（engine.js · xiaBackwater，#546）
    if (typeof xiaBackwaterBlocks === "function" && xiaBackwaterBlocks(t, notes, `${boss.name} 擒拿无效`)) return;
    t.stunned = true;
    notes.push(`${boss.name} 擒拿 ${t.name} 成功：失去下回合行动。`);
    if (typeof endRallyIfCasterDown === "function") endRallyIfCasterDown(t, notes);
  }
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

/** 敌人能用的技能：本体的 + 种族的附赠技能（无法行动的敌人，例如被挟持的亡命之王，一个都没有；
 *  坐在车上的只能用车的武器，种族的附赠技能也不能用，vehicle.js） */
function enemySkillList(u) {
  const base = enemySkillListBase(u);
  return base.length && !u.vehId ? base.concat(raceSkills(u)) : base;
}
function enemySkillListBase(u) {
  if (!u || u.isPlayer) return [];
  // 坐在车上的敌人只能用车的武器（vehicle.js）
  if (u.vehId && typeof vehicleSkillList === "function") return vehicleSkillList(u).map(s => ({ id: s.id, label: s.name }));
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
    riot_baton: [
      { id: "en_riot_baton", label: "火焰警棍（熔融）" },
      { id: "en_riot_baton_assist", label: "协助：冲近普通攻击（熔融）" }
    ],
    riot_rifle: [
      { id: "en_riot_rifle", label: "燃烧弹（激活灼烧）" },
      { id: "en_riot_rifle_assist", label: "协助：0.5×ATK 火（激活灼烧）" }
    ],
    riot_molotov: [
      { id: "en_riot_bottle", label: "燃烧瓶（选择区域）" }
    ],
    riot_flamer: [
      { id: "en_riot_spray", label: "喷火（三段）" },
      { id: "en_riot_spray_assist", label: "协助：冲近喷火" }
    ],
    riot_captain: [
      { id: "en_riot_pistol", label: "火焰手枪（灼烧）" },
      { id: "en_riot_pistol_assist", label: "协助：远距 1×ATK 火（灼烧）" }
    ],
    // 下水道狂鼠（docs/ratfolk.md）：撕咬者狂暴时普通攻击的写法换掉（下面按自我效果改名）
    rat_lurker: [
      { id: "en_rat_lurker_bite", label: "普通攻击（施加腐蚀）" },
      { id: "en_rat_lurker_assist", label: "协助：同普通攻击，进入狂暴" }
    ],
    rat_biter: [
      { id: "en_rat_biter_bite", label: "普通攻击（出血）" },
      { id: "en_rat_biter_assist", label: "协助：同普通攻击，进入狂暴" }
    ],
    rat_plague: [
      { id: "en_rat_plague_claw", label: "感染撕扯（近距，施加腐蚀）" },
      { id: "en_rat_plague_spray", label: "感染喷洒（远距，施加腐蚀）" },
      { id: "en_rat_plague_assist", label: "协助：冲近 1.5×ATK 酸（施加腐蚀）" }
    ],
    rat_tyrant: [
      { id: "en_rat_tyrant_bite", label: "普通攻击（出血）" },
      { id: "en_rat_tyrant_assist", label: "协助：冲近连打三次，所有狂鼠进入狂暴（出血）" }
    ],
    // 下水道维护（docs/sewer-maintenance.md）：清扫机还有敌人没有共振时上共振，所有敌人都有共振了才开火（AI 照这个挑，ai.js）
    sewer_sweeper: [
      { id: "en_sweeper_reso", label: "施加共振（远距，只上状态、不造成伤害）" },
      { id: "en_sweeper_shot", label: "谐波射击（所有敌人都有共振时）" },
      { id: "en_sweeper_assist", label: "协助：自爆（冲到目标所在区，同区所有敌对单位 1×ATK 火，然后自己死亡）" }
    ],
    // 两个触灵精英：远程；身上有负面状态时 AI 先花附赠清除状态（ai.js）
    sewer_keeper: [
      { id: "en_keeper_shot", label: "普通攻击（远距 1×ATK + 1d4 电击）" },
      { id: "en_sewer_cleanse", label: "清除状态（附赠，只清负面的一种）" },
      { id: "en_keeper_assist", label: "协助：同普通攻击，并施加感电" }
    ],
    sewer_cleaner: [
      { id: "en_cleaner_wave", label: "普通攻击（远距：敌人最多的一区，每人 0.5×ATK 谐波）" },
      { id: "en_sewer_cleanse", label: "清除状态（附赠，只清负面的一种）" },
      { id: "en_cleaner_assist", label: "协助：同普通攻击（打目标所在的区）" }
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
  if (u.kit === "rat_biter" && u.self === "frenzy") {
    // 撕咬者狂暴：普通攻击变成两次 0.5×atk，每一击都出血（RAT_CFG.biter · ratBiterAttack）
    const B = RAT_CFG.biter;
    list = list.map(s => s.id === "en_rat_biter_bite" ? { id: s.id, label: `普通攻击（狂暴：${B.frenzyHits} 次 ${B.frenzyMult}×ATK，每一击都出血）` } : s);
  }
  if (u.kit === "riot_molotov") {
    const r = u.resources || {};
    list = [r.bottleReady && r.bottleZone
      ? { id: "en_riot_bottle_fire", label: "投出燃烧瓶（" + r.bottleZone + "区）" }
      : { id: "en_riot_bottle", label: "燃烧瓶（选择区域）" }];
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
  // 同区有车：镇压队可以上车 / 把我方的人拉下车（vehicle.js）
  const ground = typeof vehicleGroundSkills === "function" ? vehicleGroundSkills(u).map(s => ({ id: s.id, label: s.name })) : [];
  return common.concat(list, ground);
}

/** 活沙被杀死时吸收的：四足 / 人形 / 大沙灵 / 扬尘体（#365），以及沙漠生物阵营（沙鱼，作者 10/19 定）。
 *  中立生物（尘虫、管虫）不算；只吸收还在场上、活着的（逃走 / 被移出战场的、刚被打死还没清出场的不算） */
const LIVESAND_FEED_KITS = ["sand_beast", "sand_human", "bigsand", "dustbody"];
const LIVESAND_FEED_FACTIONS = ["沙漠生物"];
function livingSandAllies(exceptId) {
  return (state.units || []).filter(u =>
    !u.hidden && !u.dead && !u._removed && !u.fused && u.id !== exceptId && totalHp(u) > 0 &&
    (LIVESAND_FEED_KITS.indexOf(u.kit) >= 0 || LIVESAND_FEED_FACTIONS.indexOf(factionOf(u)) >= 0)
  );
}

function absorbSandsInto(livesand) {
  const notes = [];
  if (!livesand || livesand._sandAbsorbed) return notes;
  const sands = livingSandAllies(livesand.id);
  if (!sands.length) {
    notes.push(`${livesand.name} 死亡，场上没有可吸收的沙灵或沙漠生物。`);
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
    const gainAtk = u.atk || 0;
    livesand.atk = (livesand.atk || 0) + gainAtk;
    // 出手用 effectiveAtk → personalAtk（party.js · baseEffectiveAtk），只加 atk 卡面涨了伤害仍是吸收前的底值
    if (livesand.personalAtk != null) livesand.personalAtk = (Number(livesand.personalAtk) || 0) + gainAtk;
    if (livesand.ivBase) {
      livesand.ivBase.atk = (Number(livesand.ivBase.atk) || 0) + gainAtk;
      if (livesand.ivBase.personalAtk != null) livesand.ivBase.personalAtk = (Number(livesand.ivBase.personalAtk) || 0) + gainAtk;
    }
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
  en_riot_baton: "melee",
  en_riot_baton_assist: "melee",
  en_riot_rifle: "ranged",
  en_riot_rifle_assist: "ranged",
  en_riot_bottle: "ranged",
  en_riot_bottle_fire: "ranged",
  en_riot_spray: "melee",
  en_riot_spray_assist: "melee",
  en_riot_pistol: "any",
  en_riot_pistol_assist: "ranged",
  // 下水道狂鼠：疫病暴徒远近皆可（撕扯近距、喷洒远距），其余都是近战；暴徒、猎手的协助冲到目标所在区（ENEMY_ASSIST_RUSH）
  en_rat_lurker_bite: "melee", en_rat_lurker_assist: "melee",
  en_rat_biter_bite: "melee", en_rat_biter_assist: "melee",
  en_rat_plague_claw: "melee", en_rat_plague_spray: "ranged", en_rat_plague_assist: "melee",
  en_rat_tyrant_bite: "melee", en_rat_tyrant_assist: "melee",
  // 下水道清扫机：上共振、谐波射击都是一般远程（距离 1）；自爆是冲到目标所在区炸那一区（ENEMY_ASSIST_RUSH）
  en_sweeper_reso: "ranged", en_sweeper_shot: "ranged", en_sweeper_assist: "melee",
  // 触灵维护员 / 清扫员：普通攻击、协助都是一般远程（清扫员的范围谐波打距离 1 的一区）
  en_keeper_shot: "ranged", en_keeper_assist: "ranged", en_cleaner_wave: "ranged", en_cleaner_assist: "ranged",
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
 * 赤牙照第九章：霰弹枪射击、躲入掩体 2 行动点，追猎 1 附赠。下水道维护的触灵精英：清除状态 1 附赠。 */
const ENEMY_SKILL_COST = {
  en_chi_shot: { ap: 2, bonus: 0 },
  en_chi_cover: { ap: 2, bonus: 0 },
  en_chi_hunt: { ap: 0, bonus: 1 },
  en_sewer_cleanse: { ap: 0, bonus: 1 }
};
function enemySkillCost(u, id) {
  if (/^veh_/.test(String(id)) && typeof vehicleSkillCost === "function") return Object.assign({ ap: 0, bonus: 0 }, vehicleSkillCost(id));   // 载具（vehicle.js）
  return ENEMY_SKILL_COST[id] || RACE_SKILL_COST[id] || { ap: 1, bonus: 0 };
}

/** 区域范围技能（喷洒、流沙漩涡……）能不能打到 zone：按技能射程，隔着危墙 / 关着的门打不到 */
function enemyZoneInRange(a, id, zone) {
  const d = zoneDist(a.zone, zone, state.zoneMode);
  const rg = ENEMY_SKILL_RANGE[id] || a.range || "any";
  // 被牵制（决一死战 / 嘲讽）而牵制者就在同区、自己又没有近身攻击：远距离的区域技能可以抵近打自己所在的区
  const pb = d === 0 && rg === "ranged" && enemyForcedPointBlank(a, enemyForcedTarget(a));
  const ok = rg === "melee" ? d === 0 : rg === "ranged" ? (d === 1 || pb) : d <= 1;
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
    if (typeof noteKnockdown === "function") noteKnockdown(t);   // 战场数据：倒地次数（app.js）
    if (typeof clearStunOnDown === "function") clearStunOnDown(t);
    lines.push(`${t.name} 被捏碎颅骨，倒地陷入濒死。`);
  }
  if (typeof endRallyIfCasterDown === "function") endRallyIfCasterDown(t, lines);
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
/* ===== 外城区镇压部队（docs/suppression-force.md 第 2 节）=====
 * baton   警棍盾：火焰警棍 1d4、2 击破、熔融；被动「防暴盾」——自己的护盾层还有血时，同区友军受到的远程攻击伤害 −shieldDr（和其他百分比加算，多面盾不叠加）
 * rifle   燃烧步枪：燃烧弹 1d4、1 击破；协助 assistMult×atk；打中后激活目标的灼烧
 * bottle  燃烧瓶：落地时那一区的单位 mult×atk 火、灼烧 burn 层（已经是火场则 burnOnFire 层），然后变火场；
 *         friendlyFire：是否连同区的友军一起炸（文档写的是「那一区所有单位」，先按只炸敌对的单位做，榴弹也是这样）
 * flamer  喷火兵：喷火 hits 段，每段 mult×atk 火；目标有灼烧时每段各 1 击破，没有时共 1 击破；每段各掷 burnChance 概率给灼烧 1；
 *         被动「燃料罐」——被打进失衡时同区所有单位（不分敌我）burstMult×atk 火，那一区变火场
 * captain 小队长：火焰手枪 1d6、1 击破、灼烧 burn；协助 assistMult×atk、灼烧 burn；被动「指挥」只改 AI（ai.js · 优先挑没有灼烧的敌人） */
const RIOT_CFG = {
  baton:   { dice: 4, baseBreak: 2, shieldDr: 0.25 },
  rifle:   { dice: 4, assistMult: 0.5 },
  bottle:  { mult: 0.5, burn: 1, burnOnFire: 2, friendlyFire: false },
  flamer:  { hits: 3, mult: 0.3, burnChance: 0.15, burstMult: 0.5 },
  captain: { dice: 6, assistMult: 1, burn: 1 }
};
const RIOT_KITS = ["riot_baton", "riot_rifle", "riot_molotov", "riot_flamer", "riot_captain"];
/** 火焰喷射兵的喷火：单体 3 段。目标有灼烧时每段各 1 击破，没有时 3 段共 1 击破；每段命中各掷一次灼烧 */
function riotSpray(a, t, aa) {
  const R = RIOT_CFG.flamer;
  return aa(t, { element: "fire", mult: R.mult, hits: R.hits, baseBreak: 1, breakOnce: burnStackCount(t) <= 0, onConnect: { burnEach: R.burnChance } });
}
/** 防暴盾：还有护盾层的警棍盾在场，同区友军受到远程攻击时减伤的比例（0 = 没有）。target 是被打的敌人 */
function riotShieldDr(target, attacker, opt) {
  if (!target || target.isPlayer || !attacker || (typeof state === "undefined")) return 0;
  const dist = zoneDist(attacker.zone, target.zone, state.zoneMode);
  // 远程攻击：隔着区打过来的，或者这个技能本身是远距离的（抵近射击打同区也算）
  if (!(dist >= 1) && !(opt && opt.atkRange === "ranged")) return 0;
  const has = (state.units || []).some(u => u && u.kit === "riot_baton" && !u.dead && !u.hidden && !u._removed && !u.fused &&
    Number(u.zone) === Number(target.zone) && (u.id === target.id || !hostileTo(u, target)) &&
    (u.layers || []).some(l => l.type === "shield" && Number(l.current) > 0));
  return has ? RIOT_CFG.baton.shieldDr : 0;
}
/** 燃料罐：火焰喷射兵被打进失衡，罐子破裂（effects.js · onBroken 调用） */
function riotFuelBurst(u, notes) {
  if (!u || u.kit !== "riot_flamer" || u.dead) return;
  const z = Number(u.zone);
  notes.push(`${u.name} 的燃料罐破裂：${z} 区所有单位受到火焰伤害。`);
  (state.units || []).filter(x => x && x.id !== u.id && !x.dead && !x.hidden && !x._removed && !x.fused && Number(x.zone) === z).forEach(x => {
    hitOne2(u, x, { atk: effectiveAtk(u, state.units), mult: RIOT_CFG.flamer.burstMult, element: "fire", baseBreak: 0, flags: { action: true, aoe: true } }, notes);
  });
  const err = typeof setZoneField === "function" ? setZoneField(z, "fire", { by: u.id }) : null;
  notes.push(err || `${z} 区变为火场。`);
}
/** 燃烧瓶落地：对标定的区里的单位各 mult×atk 火、灼烧（已经是火场则灼烧更多层），然后那一区变成火场 */
function riotBottleLand(a, aa, lines) {
  const R = RIOT_CFG.bottle;
  const r = a.resources = a.resources || {};
  const zone = Number(r.bottleZone);
  const wasFire = zoneOnFire(zone);
  const victims = fieldUnits().filter(u => !u.dead && !u.hidden && !u._removed && Number(u.zone) === zone && u.id !== a.id &&
    (R.friendlyFire || hostileTo(a, u)));
  if (!victims.length) lines.push(`${zone} 区没有玩家单位。`);
  victims.forEach(u => {
    aa(u, { element: "fire", mult: R.mult, baseBreak: 0, flags: { action: true, aoe: true, lob: true }, onConnect: { burn: wasFire ? R.burnOnFire : R.burn } });
  });
  Object.assign(r, { bottleZone: 0, bottlePending: false, bottleReady: false });
  lines.push(`${a.name} 的燃烧瓶在 ${zone} 区落地。`);
  if (!wasFire) {
    const err = setZoneField(zone, "fire", { by: a.id });
    lines.push(err || `${zone} 区变为火场。`);
  }
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

/* ===== 下水道狂鼠（docs/ratfolk.md 第 3 节）=====
 * 通用机制都用 #274 做好的：出血（攻击规格上的 bleed，engine.js · BLEED）、狂暴（effects.js · enterFrenzy / FRENZY）、阵营被动狂潮（effects.js · frenzyTide）。
 * 血量 / 架势 / atk / 伤害骰在 engine.js · RAT_STATS，这里是招式和机制的数：
 *   biter   撕咬者：狂暴时普通攻击变成 frenzyHits 次 frenzyMult×atk 物理（共 1 击破），每一击都出血
 *   plague  疫病暴徒：目标原本已经腐蚀时，感染撕扯给自己回 clawHeal 最大生命；协助 assistMult×atk 酸，
 *           目标原本已经腐蚀时伤害 + assistDice、给自己回 assistHeal 最大生命；狂暴时受到的治疗 +frenzyHealUp
 *   tyrant  暴虐猎手：协助冲近连打 assistHits 次 assistMult×atk 物理（每一击都出血）；斩杀那一击的协助格挡 +execBlock%
 * 行动结束后的反应（潜藏者逃跑、疫病暴徒「所有敌人都腐蚀」进入狂暴、暴虐猎手斩杀）：app.js 在最外层的一次行动 / 移动 / 格挡落下 /
 * 回合交界结算完之后调 ratfolkSweep；每一击结算完调 ratfolkAfterHit（记下潜藏者挨的近战、猎手击杀后狂暴 / 出血回血） */
const RAT_CFG = {
  biter:  { frenzyHits: 2, frenzyMult: 0.5 },
  plague: { clawHeal: 0.1, assistMult: 1.5, assistDice: [2, 8], assistHeal: 0.25, frenzyHealUp: 0.5 },
  tyrant: { assistHits: 3, assistMult: 0.5, execBlock: 5 }
};
const ratOnField = u => !!u && !u.dead && !u._removed && !u.hidden && !u.fused;
const ratStunned = u => !!(u && (u.stunned || (typeof isEffectivelyStunned === "function" && isEffectivelyStunned(u))));
function ratCorroded(u) { return !!(u && u.statuses && u.statuses.corr); }
/** 狂鼠眼里的敌人：和它敌对、在场上的单位（倒地没起身的、配置物不算）。疫病暴徒「所有敌人都腐蚀」、腐蚀扩散都按它 */
function ratFoesOf(a) {
  return hostilesOf(a).filter(u => !u.kind && !u.isProp && !u.isStructure && !(typeof isDownProtected === "function" && isDownProtected(u)));
}
/** 撕咬者的普通攻击（协助也是这一下）：平时 1×atk + 1d6 物理、1 击破、出血；狂暴时两次 0.5×atk 物理（共 1 击破），每一击都出血 */
function ratBiterAttack(a, dice) {
  if (a && a.self === "frenzy") {
    const B = RAT_CFG.biter;
    return { element: "physical", mult: B.frenzyMult, hits: B.frenzyHits, baseBreak: 1, breakOnce: true, bleed: true };
  }
  return { element: "physical", mult: 1, diceN: (dice && dice[0]) || 1, diceS: (dice && dice[1]) || 6, baseBreak: 1, bleed: true };
}
/** 暴虐猎手的普通攻击（斩杀也是这一下）：1×atk + 1d8 物理、1 击破、出血 */
function ratTyrantBite(dice) {
  return { element: "physical", mult: 1, diceN: (dice && dice[0]) || 1, diceS: (dice && dice[1]) || 8, baseBreak: 1, bleed: true };
}
/** 受到的治疗倍率（engine.js · healUnit）：疫病暴徒狂暴时 +50%，别的 ×1 */
function ratHealMult(u) {
  return u && u.kit === "rat_plague" && u.self === "frenzy" ? 1 + RAT_CFG.plague.frenzyHealUp : 1;
}
/** 疫病暴徒打中原本已经腐蚀的目标：给自己回 pct 最大生命（app.js · runOnConnect 的 selfHeal） */
function ratSelfHeal(a, pct, notes) {
  if (!a || a.dead || !(pct > 0)) return;
  const want = Math.floor(totalMaxHp(a) * pct);
  const got = want > 0 && typeof healUnit === "function" ? healUnit(a, want) : 0;
  const up = ratHealMult(a) > 1 ? `，狂暴：受到的治疗 +${Math.round(RAT_CFG.plague.frenzyHealUp * 100)}%` : "";
  notes.push(`目标原本已经腐蚀：${a.name} 恢复 ${got} 生命（${Math.round(pct * 100)}% 最大生命${up}）。`);
}
/** 感染喷洒打中原本已经腐蚀的目标：腐蚀扩散到目标同区的所有敌人（app.js · runOnConnect 的 corrSpread） */
function ratPlagueSpread(a, t, notes) {
  if (!a || !t) return;
  const z = Number(t.zone);
  const got = ratFoesOf(a).filter(u => u.id !== t.id && Number(u.zone) === z && !ratCorroded(u));
  if (!got.length) { notes.push(`感染喷洒：${z} 区没有别的敌人可以扩散腐蚀。`); return; }
  got.forEach(u => {
    u.statuses = u.statuses || {};
    u.statuses.corr = true;
    if (typeof popStatus === "function") popStatus(u, "corr");
  });
  notes.push(`感染喷洒：${t.name} 身上的腐蚀扩散到 ${z} 区的 ${got.map(u => u.name).join("、")}。`);
}
/** 暴虐猎手的协助：所有狂鼠进入狂暴（失衡 / 晕眩中的进不去，照狂潮的写法） */
function ratFrenzyAll(a, lines, why) {
  if (typeof enterFrenzy !== "function" || typeof isRatfolk !== "function") return;
  const rats = (state.units || []).filter(u => isRatfolk(u) && ratOnField(u) && u.self !== "frenzy");
  if (!rats.length) return;
  const out = rats.filter(ratStunned);
  lines.push(`${why}：所有狂鼠进入狂暴${out.length ? `（失衡中的 ${out.length} 只除外）` : ""}。`);
  rats.filter(u => !ratStunned(u)).forEach(u => enterFrenzy(u, lines, why));
}
/** 暴虐猎手的协助优先权：其他狂鼠都没有狂暴时一定由它来协助（ai.js · aiPickAssister 先筛出打得到的，再看这个） */
function ratTyrantHasPriority(u) {
  if (!u || u.kit !== "rat_tyrant" || typeof isRatfolk !== "function") return false;
  return !(state.units || []).some(x => x !== u && isRatfolk(x) && ratOnField(x) && x.self === "frenzy");
}

/** dealTo 每一击结算完（app.js；等协助格挡的那一击落下时才到这里）。ctx = { dist 攻击者到目标隔几个区, wasDown 这一击之前目标已经倒下 / 濒死,
 *  wasStunned 这一击之前目标已经失衡 }
 *   暴虐猎手：斩杀那一击落下了就撤掉格挡 +5%；狂暴时打出的出血等量回血；这一击打死敌人（打进濒死也算）就进入狂暴
 *   潜藏者：被敌对单位的近战（同区的攻击动作）打中、没被打死、没被打进失衡 → 记下来，这次行动打完再逃（ratLurkerFlees） */
function ratfolkAfterHit(a, t, res, flags, extra, ctx) {
  if (!a || !t || !res || res.pending || res.ok === false) return;
  flags = flags || {};
  ctx = ctx || {};
  if (flags.ratExec) ratExecSettle(a);
  if (a.kit === "rat_tyrant" && !a.dead && t !== a) {
    const bleed = Math.floor(Number(res.bleed) || 0);
    if (bleed > 0 && a.self === "frenzy" && typeof healUnit === "function") {
      const got = healUnit(a, bleed);
      extra.push(`${a.name} 狂暴：打出的出血 ${bleed} 等量回血，恢复 ${got}。`);
    }
    if (!ctx.wasDown && (t.dead || t.dying) && typeof enterFrenzy === "function") enterFrenzy(a, extra, `击杀${t.name}`);
  }
  if (t.kit === "rat_lurker" && a !== t && !a.envSrc && !t.dead && !t.stunned && ctx.dist === 0 && flags.action !== false && !flags.environment &&
      hostileTo(a, t) && (typeof attackConnected !== "function" || attackConnected(res, flags)) &&
      !(typeof brokeInto === "function" && brokeInto(t, ctx.wasStunned))) {
    (state.ratFlee = state.ratFlee || []).push({ id: t.id, by: a.id, zone: Number(a.zone) });
  }
}
/** 斩杀那一击落下了：同一只猎手没有别的斩杀还在等格挡，就撤掉协助格挡 +5% 的记号（app.js · finalBlockChance 读 ratExecBlock） */
function ratExecSettle(a) {
  if (!a) return;
  if ((state.blockQueue || []).some(j => j && j.attackerId === a.id && j.opt && j.opt.flags && j.opt.flags.ratExec)) return;
  a.ratExecBlock = 0;
}

/* ---------- 潜藏者：挨了近战就逃（docs/ratfolk.md：每次被近战攻击打中，免费往远离攻击者的方向移动 1 区，不触发借机攻击；被打死、被打进失衡时不跑）----------
 * 挨打时只记下来（ratfolkAfterHit），等这次行动整个打完再逃：一个技能里分几下打它，几下都照常打到；一次行动里挨了几下也只逃一次 */
/** 往哪里逃：走得过去的相邻区里，离攻击者（挨打时它所在的区）最远的；一样远的挑敌人少的，再挑编号小的 */
function ratFleeDest(u, fromZone) {
  const z = Number(u.zone);
  const ok = ratWalkable(u);
  const ns = (typeof zoneNeighbors === "function" ? zoneNeighbors(z) : []).map(Number).filter(n => ok(z, n));
  if (!ns.length) return null;
  const foes = n => hostilesOf(u).filter(x => Number(x.zone) === n).length;
  const far = n => zoneDist(n, Number(fromZone), state.zoneMode);
  return ns.sort((x, y) => far(y) - far(x) || foes(x) - foes(y) || x - y)[0];
}
/** 免费移动走得过去的间隔：危墙 / 关着的门不行；地面单位越不过空隙（免费移动不花行动点，也就过不了空隙）、不进深渊 */
function ratWalkable(u) {
  return (x, y) => {
    const g = typeof getGap === "function" ? getGap(x, y) : { type: "open" };
    if (g.type === "wall" || (g.type === "door" && !g.open)) return false;
    if (g.type === "void" && !u.flying) return false;
    return !!u.flying || !(state.fields && state.fields[y] && state.fields[y].abyss);
  };
}
function ratLurkerFlees() {
  const q = state.ratFlee || [];
  state.ratFlee = [];
  let moved = false;
  const done = new Set();
  q.forEach(job => {
    if (!job || done.has(job.id)) return;
    done.add(job.id);
    const u = unitById(job.id);
    if (!u || u.kit !== "rat_lurker" || !ratOnField(u) || ratStunned(u)) return;
    const by = unitById(job.by);
    const why = `挨了${by ? ` ${by.name} 的` : ""}近战攻击`;
    const stuck = u.noMove || u.self === "frost" || u.entangled || (typeof sinkStuck === "function" && sinkStuck(u)) || (typeof touDuelVictim === "function" && touDuelVictim(u));
    const dest = stuck ? null : ratFleeDest(u, job.zone);
    if (dest == null) { appendLog(`【${u.name}】逃跑\n  ${why}，但${stuck ? "动不了" : "无路可逃"}。`); return; }
    const from = Number(u.zone);
    doMove(u, dest, { free: true, noOpp: true, title: `【${u.name}】逃跑`, note: `（${why}：免费移动，不触发借机攻击）` });
    if (Number(u.zone) !== from) moved = true;
  });
  return moved;
}

/* ---------- 疫病暴徒：所有敌人都腐蚀时进入狂暴 ---------- */
function ratPlagueFrenzy() {
  let any = false;
  (state.units || []).forEach(u => {
    if (u.kit !== "rat_plague" || !ratOnField(u) || u.self === "frenzy" || ratStunned(u) || typeof enterFrenzy !== "function") return;
    const foes = ratFoesOf(u);
    if (!foes.length || !foes.every(ratCorroded)) return;
    const notes = [];
    if (enterFrenzy(u, notes, "所有敌人都腐蚀了")) { appendLog(tidyActionBlock(`【${u.name}】狂暴`, notes).join("\n")); any = true; }
  });
  return any;
}

/* ---------- 暴虐猎手 · 斩杀 ----------
 * 敌人因为任何原因血量降到「它的普通攻击掷最小值也一定能打死」时（打进濒死也算），猎手免费移动到那一区、免费普通攻击一次；
 * 每轮不限次数，这一击可以协助格挡，成功率 +execBlock%。
 * 「血量降到」：每次反应时把每个单位的血量记在 state.ratSeen，比上次记下的低了才看（开战时先记一遍，ratfolkBattleStart）；
 * 靠坚毅生命站着的不算（不能让人从这里看出坚毅生命还剩多少） */
function ratSeenSnapshot() {
  const seen = {};
  (state.units || []).forEach(u => { if (u && u.id != null) seen[u.id] = totalHp(u); });
  return seen;
}
/** 猎手现在能不能出手斩杀：活着在场、没失衡、没休眠、没陷在流沙里没顶、没坐在车上 */
function ratTyrantReady(a) {
  return !!a && a.kit === "rat_tyrant" && ratOnField(a) && !ratStunned(a) && !a.dormant && !a.vehId &&
    !(typeof sinkLocked === "function" && sinkLocked(a));
}
/** 猎手打不打得到 t：被牵制（嘲讽 / 决一死战 / 禁足怒吼）只能打牵制者；躲藏、下潜的选不中；屏障护着打不进去；近程打飞行要 1 附赠；
 *  不在同区就要免费走过去（ratWalkable；禁足 / 霜结 / 被缠住 / 陷在流沙里走不动） */
function ratExecReach(a, t) {
  if (!hostileTo(a, t)) return false;
  const forced = typeof enemyForcedTarget === "function" ? enemyForcedTarget(a) : null;
  if (forced && forced !== t) return false;
  if ((t.statuses && t.statuses.hide) || t.submerged || t.untargetable) return false;
  if (typeof barrierFor === "function" && barrierFor(t, a)) return false;
  if (t.flying && !a.flying && (Number(a.bonus) || 0) < 1) return false;
  if (Number(a.zone) === Number(t.zone)) return true;
  if (a.noMove || a.self === "frost" || a.entangled || (typeof sinkStuck === "function" && sinkStuck(a))) return false;
  return !!zonePath(a.zone, t.zone, ratWalkable(a));
}
/** 斩杀的门槛：猎手走到 t 那一区、普通攻击骰子取 1，按伤害预演算能不能打死 t（最内层归零：敌人死亡，我方进濒死）。
 *  在复制出来的单位上跑 engine.js · resolveAttack，不改场上任何东西；克制、天气、场地、出血、飞行减半这些引擎里算，
 *  受击一方的减伤 / 免伤开关照 dealTo 加（ratExecFlags） */
function ratExecKills(a, t) {
  const clone = x => JSON.parse(JSON.stringify(x));
  const flags = ratExecFlags(t);
  if (flags.immune) return false;
  const ac = clone(a), tc = clone(t);
  ac.zone = t.zone;
  const bite = ratTyrantBite(a.suggest && a.suggest.dice);
  const f = (state.fields && state.fields[t.zone]) || {};
  const res = resolveAttack({
    attacker: ac, target: tc, atk: effectiveAtk(a, state.units), mult: bite.mult, flat: 0, diceValue: bite.diceN,   // 每颗骰子取 1
    element: bite.element, baseBreak: bite.baseBreak, hits: 1, bleed: bite.bleed, flags,
    weather: currentWeatherFor(t), phaseStep: Number(state.phaseStep), zoneMode: state.zoneMode,
    attackerField: f, targetField: f, highA: false, highT: false, dist: 0, atkRange: "melee"
  });
  if (!res || res.ok === false) return false;
  const ls = res.layersAfter || [];
  const inner = ls.find(l => l && l.inner) || ls[ls.length - 1];
  return !!inner && (Number(inner.current) || 0) <= 0;
}
/** 受击一方让这一击减伤 / 免伤 / 加伤的开关，照 app.js · dealTo（那边加了新的，这里也要加）：
 *  赤牙的掩体、咬牙坚持、转移注意、屹立不倒 / 再次霜结、破釜沉舟的受伤翻倍、圣盾、首领蓄满能量、张开掩体、过度自信 */
function ratExecFlags(t) {
  const f = { action: true, block: "none" };
  const r = t.resources || {};
  if ((t.kit === "chixia" && r.cover) || r.gritTurn) f.dr50 = true;
  if (r.divertGuard) f.dr25 = true;
  if (r.standTurn || r.frostShell) f.immune = true;
  if (typeof gambitRes === "function" && gambitRes(t).gambitWound) f.doubleTake = true;
  if (typeof shieldBearer === "function" && shieldBearer(t)) f.holyShield = true;
  let dr = 0;
  if (!t.isPlayer && typeof mechChargeDr === "function") dr += Number(mechChargeDr(t)) || 0;
  if (t.vehMerged && typeof vehicleCoverDr === "function") dr += Number(vehicleCoverDr(t)) || 0;
  if (dr > 0) f.drPct = dr;
  // 过度自信：和 dealTo、角色仪表同一个判断（app.js · koltPrideCut）
  const pride = typeof koltPrideCut === "function" ? koltPrideCut(t) : 0;
  if (pride) f.prideReduce = pride;
  return f;
}
/** 斩杀：免费走到 t 那一区，免费普通攻击一次（可以协助格挡，格挡率 +execBlock%）。日志写成一块「【暴虐猎手】斩杀」 */
function ratTyrantExecute(a, t) {
  const T = RAT_CFG.tyrant;
  const prevAssist = state._assistBy;
  state._assistBy = null;   // 斩杀不是协助攻击（协助攻击结算完接着斩杀时也一样）：可以协助格挡
  let out = null;
  let lines;
  try {
    lines = withLogSink(() => {
      const far = Number(a.zone) !== Number(t.zone);
      appendLog(`${t.name} 的血量挡不住掷最小值的一击：${a.name} ${far ? "免费移动过去，" : ""}免费发动一次普通攻击（可以协助格挡，成功率 +${T.execBlock}%）。`);
      const path = zonePath(a.zone, t.zone, ratWalkable(a)) || [Number(a.zone)];
      for (let i = 1; i < path.length; i++) {
        const before = Number(a.zone);
        doMove(a, path[i], { free: true, title: "", note: "（斩杀：免费移动）" });
        if (Number(a.zone) === before) break;   // 过不去（桥塌了……）就停在半路
      }
      if (Number(a.zone) !== Number(t.zone)) { appendLog(`${a.name} 没能走到 ${t.name} 身边，斩杀落空。`); return; }
      a.ratExecBlock = T.execBlock;
      const hl = [];
      out = hitOne2(a, t, Object.assign(ratTyrantBite(a.suggest && a.suggest.dice), { atk: effectiveAtk(a, state.units), atkRange: "melee", flags: { action: true, ratExec: true } }), hl);
      appendLog(hl.join("\n"));
    });
  } finally { state._assistBy = prevAssist; }
  if (!out || !(out.pending || (out.res && out.res.pending))) a.ratExecBlock = 0;   // 已经落下（没人能格挡）：+5% 不留着
  const block = tidyActionBlock(`【${a.name}】斩杀`, lines || []);
  if (block.length) appendLog(block.join("\n"));
  return out;
}
function ratTyrantExecutes() {
  const tyrants = (state.units || []).filter(u => u && u.kit === "rat_tyrant" && ratOnField(u));
  if (!tyrants.length) { state.ratSeen = null; return false; }
  if (!state.ratSeen) { state.ratSeen = ratSeenSnapshot(); return false; }
  const seen = state.ratSeen;
  let acted = false;
  (state.units || []).slice().forEach(t => {
    if (!t || t.id == null) return;
    const hp = totalHp(t), prev = seen[t.id];
    seen[t.id] = hp;
    if (prev == null || !(hp < prev)) return;   // 血量没降（新上场的先记下来）
    if (!ratOnField(t) || t.kind || t.isProp || t.isStructure || t.kit === "ironwall" || hp <= 0 || t.upOnShp ||
        (typeof isDownProtected === "function" && isDownProtected(t))) return;
    const a = tyrants.filter(x => ratTyrantReady(x) && ratExecReach(x, t))
      .sort((x, y) => zoneDist(x.zone, t.zone, state.zoneMode) - zoneDist(y.zone, t.zone, state.zoneMode))
      .find(x => ratExecKills(x, t));
    if (!a) return;
    ratTyrantExecute(a, t);
    seen[t.id] = totalHp(t);
    acted = true;
  });
  return acted;
}

/* ---------- 进场 / 回合结束 / 行动结束 ---------- */
/** 开战（app.js · startCombat）：清掉上一场留下的，记下开战时每个单位的血量（斩杀看「降到」） */
function ratfolkBattleStart() {
  if (typeof state === "undefined" || !state) return;
  state.ratFlee = [];
  state.ratSeen = (state.units || []).some(u => u && u.kit === "rat_tyrant" && ratOnField(u)) ? ratSeenSnapshot() : null;
  (state.units || []).forEach(u => { if (u && u.kit === "rat_tyrant") u.ratExecBlock = 0; });
}
/** 回合结束（app.js · turnEnd，灼烧 / 腐蚀这些都结算完之后）：狂暴的潜藏者进入躲藏 */
function ratfolkRoundEnd(notes) {
  (state.units || []).forEach(u => {
    if (!u || u.kit !== "rat_lurker" || u.self !== "frenzy" || !ratOnField(u)) return;
    if (u.statuses && u.statuses.hide) return;
    u.statuses = u.statuses || {};
    u.statuses.hide = true;
    if (typeof popStatus === "function") popStatus(u, "hide");
    notes.push(`${u.name} 狂暴：回合结束，进入躲藏。`);
  });
}
/** 最外层的一次行动 / 移动 / 格挡落下 / 回合交界结算完（app.js 调）：潜藏者逃跑 → 疫病暴徒全员腐蚀时狂暴 → 暴虐猎手斩杀，
 *  一样引出下一样（斩杀打死人、逃跑走进别的区……）就再看一遍。反应自己里面的移动、攻击不再嵌套进来 */
let RAT_SWEEPING = false;
function ratfolkSweep() {
  if (RAT_SWEEPING || typeof state === "undefined" || !state || !state.combatStarted || !Array.isArray(state.units)) return;
  if (!state.units.some(u => typeof isRatfolk === "function" && isRatfolk(u) && ratOnField(u))) { state.ratFlee = []; state.ratSeen = null; return; }
  RAT_SWEEPING = true;
  try {
    for (let guard = 0; guard < 8; guard++) {
      const fled = ratLurkerFlees();
      const mad = ratPlagueFrenzy();
      const exec = ratTyrantExecutes();
      if (!fled && !mad && !exec) break;
    }
  } finally { RAT_SWEEPING = false; }
}

/* ===== 下水道维护（docs/sewer-maintenance.md 第 1、2 节）=====
 * 阵营「下水道维护」：和安保、警卫队、镇压队是一伙（run.js · ALLIED_FACTIONS，混编概率 FACTION_MIX_CHANCE 15%），
 * 和其他所有阵营敌对（HOSTILE_EXCEPT_ALLIES）；只出没在下水道。
 * 下水道清扫机：血量 / 架势 / atk / 伤害骰在 engine.js · SEWER_STATS，这里是招式的数：
 *   shotMult / shotBreak   所有敌人都有共振时的远程谐波攻击（伤害骰是单位卡上的 1d4）
 *   blastMult / blastBreak 协助「自爆」：冲到目标所在区，对那一区所有和它敌对的单位各 blastMult×atk 火、blastBreak 击破，然后自己死亡
 * 还有敌人没有共振时花行动点给一个没有共振的敌人施加共振（只上状态、不造成伤害，sweeperApplyReso）；挑谁、什么时候开火在 ai.js
 * 两个触灵精英（第 2 节；血量 / 架势 / atk 在 engine.js · SEWER_STATS.elite）：
 *   keeper  触灵维护员：普通攻击 shotMult×atk + 1d4 电击、shotBreak 击破；协助同普通攻击，另外施加感电
 *   cleaner 触灵清扫员：普通攻击选远程射程内敌人最多的一区，那一区所有敌人各 waveMult×atk 谐波、waveBreak 击破；协助同普通攻击（打目标所在的区）；
 *           场上有别人能协助时不主动协助（sewerAssistPool）
 *   cleanse 附赠·清除状态（两个精英都有，en_sewer_cleanse）：只清负面的状态，一次清一种（sewerCleansePick 的先后）：
 *           first 先清（高能：血量低于高能值就自爆）；dot 按这一回合结束预计扣的血（期望值）比，扣得多的先清（感电按同区同阵营的人数乘）；
 *           then 照写的先后。inspireKits：清掉一种就给自己永续的振奋（振奋 + inspireStay，只有一层）——维护员的特点
 *   guard   操控清扫机（清扫员的特点，sweeperGuardFor）：清扫员在场时，protect 里的单位挨打，同区血量最多的清扫机 100% 代为承受；
 *           代挡后那只清扫机剩下的血量 < boomBelow（还没死）立刻自爆（sweeperGuardAfter → sweeperSelfDestruct） */
const SEWER_FACTION = "下水道维护";
const SEWER_CFG = {
  sweeper: { shotMult: 1, shotBreak: 1, blastMult: 1, blastBreak: 1 },
  keeper: { shotMult: 1, shotBreak: 1 },
  cleaner: { waveMult: 0.5, waveBreak: 1 },
  cleanse: {
    first: ["high"],
    dot: ["burn", "corr", "shock"],
    then: ["frostbite", "shockwave", "unstable", "weak", "reso", "chase"],
    inspireKits: ["sewer_keeper"]
  },
  guard: { protect: ["sewer_keeper", "sewer_cleaner"], boomBelow: 0.25 }
};
/** 清除状态的日志用名字 */
const SEWER_STATUS_NAME = { high: "高能", burn: "灼烧", corr: "腐蚀", shock: "感电", frostbite: "冻伤", shockwave: "震荡",
  unstable: "不稳", weak: "虚弱", reso: "共振", chase: "紧追" };
const sweeperResonated = u => !!(u && u.statuses && u.statuses.reso);
/** 清扫机眼里的敌人：和它敌对、在场上、选得中的单位——倒地没起身的、配置物不算；躲藏 / 下潜 / 本来就选不中的
 *  （飞碟本体、单局图纸「安全的迷彩」）看不见。「所有敌人都有共振」、上共振挑目标都按它 */
function sweeperFoesOf(a) {
  return hostilesOf(a).filter(u => !u.kind && !u.isProp && !u.isStructure && !u.untargetable && !u.submerged &&
    !(u.statuses && u.statuses.hide) && !(typeof isDownProtected === "function" && isDownProtected(u)) &&
    !(typeof bpUntargetable === "function" && bpUntargetable(u)));
}
/** 看得见的敌人都有共振了（一个都看不见也算）：清扫机改用谐波射击 */
function sweeperAllResonated(a) {
  return sweeperFoesOf(a).every(sweeperResonated);
}
/** t 能不能被 a 施加共振：看得见的敌人、还没有共振（不看距离；射程在 sweeperApplyReso / ai.js 里看） */
function sweeperResoTargetOk(a, t) {
  return !!t && !sweeperResonated(t) && sweeperFoesOf(a).includes(t);
}
/** 施加共振：只上状态、不造成伤害（不是攻击——不能协助格挡，也不触发受击 / 出手的效果）。射程照一般远程：距离 1，
 *  隔着危墙 / 关着的门够不到（被牵制而牵制者就在同区、自己又没有近身攻击时可以抵近，照 enemyZoneInRange）。返回 true = 上上了 */
function sweeperApplyReso(a, t, lines) {
  if (sweeperResonated(t)) { lines.push(`${t.name} 已经有共振。`); return false; }
  if (!hostileTo(a, t)) { lines.push(`${t.name} 不是敌对的单位，没法施加共振。`); return false; }
  if (!sweeperResoTargetOk(a, t)) { lines.push(`${a.name} 选不中 ${t.name}（躲藏 / 下潜 / 倒地），没法施加共振。`); return false; }
  if (!enemyZoneInRange(a, "en_sweeper_reso", t.zone)) {
    const why = typeof lineBlocked === "function" && lineBlocked(a.zone, t.zone);
    lines.push(why ? `${a.name} 够不到 ${t.name}：${why}` : `施加共振是远距离，够不到距离 ${zoneDist(a.zone, t.zone, state.zoneMode)} 的 ${t.name}。`);
    return false;
  }
  t.statuses = t.statuses || {};
  t.statuses.reso = true;
  t.statuses.latestElement = "harmonic";   // 最新的状态属性（扩散按它结算），和道具上共振一样
  if (typeof popStatus === "function") popStatus(t, "reso");
  lines.push(`${a.name} 给 ${t.name} 施加共振。`);
  return true;
}
/** 下水道清扫机的自爆（它的协助；下一步的触灵清扫员代挡后剩余血量 < 25% 时也直接调它）：
 *  冲到 t 所在区（免费移动、不花行动点，一次一个区；过不去就停在半路；t 不给就在原地），对它所在那一区所有和它敌对的单位
 *  （狂鼠也算；倒地没起身的不算）各 blastMult×atk 火、blastBreak 击破——范围攻击，不能协助格挡；然后自己死亡，
 *  照常结算击杀（经验、奎支、评分：app.js · settleEnemyKill；材料战后照 items.js · ENEMY_DROPS 掉）。
 *  hit：打一下的函数（技能里传 runSkill 的 hitOne 包装，不传用 hitOne2 写进 notes）。返回 true = 炸了 */
function sweeperSelfDestruct(a, t, notes, hit) {
  if (!a || a.kit !== "sewer_sweeper" || a.dead || a._removed || a._sweeperBoom) return false;
  notes = notes || [];
  const C = SEWER_CFG.sweeper;
  for (let i = 0; t && Number(a.zone) !== Number(t.zone) && i < 8; i++) {
    const before = Number(a.zone);
    stepTowardZone(a, t.zone, { free: true });
    if (Number(a.zone) === before || a.dead) break;   // 过不去（危墙、关着的门、禁足……）或者路上被打死
  }
  if (a.dead || a._removed) return false;
  a._sweeperBoom = true;
  const z = Number(a.zone);
  if (t && Number(t.zone) !== z) notes.push(`${a.name} 没能冲到 ${t.name} 所在的 ${t.zone} 区，就地自爆。`);
  const victims = hostilesOf(a).filter(u => Number(u.zone) === z && !(typeof isDownProtected === "function" && isDownProtected(u)));
  notes.push(`${a.name} 自爆：${z} 区所有和它敌对的单位受到 ${C.blastMult}×ATK 火焰伤害、${C.blastBreak} 击破${victims.length ? "" : "（那一区没有敌对的单位）"}。`);
  const atk = effectiveAtk(a, state.units);
  const strike = hit || ((u, opt) => hitOne2(a, u, opt, notes));
  victims.forEach(u => {
    if (u.dead || u._removed || Number(u.zone) !== z) return;   // 前面的爆炸连带打死 / 推走的
    strike(u, { atk, mult: C.blastMult, element: "fire", baseBreak: C.blastBreak, atkRange: "melee", flags: { action: true, aoe: true } });
  });
  // 自己死亡：和被打死一样结算（经验、奎支、击杀分只结算一次），然后清出场
  (a.layers || []).forEach(l => { l.current = 0; });
  if (typeof settleEnemyKill === "function") settleEnemyKill(a, notes);
  a.dead = true;
  notes.push(`${a.name} 在自爆中损毁。`);
  if (typeof sweepDeadEnemies === "function") notes.push(...sweepDeadEnemies());
  return true;
}

/* ---- 触灵精英：附赠·清除状态（SEWER_CFG.cleanse）---- */
/** u 身上现有的负面状态（SEWER_CFG.cleanse 里列的属性状态 / 通用状态；振奋、坚挺、躲藏、优势这些好的不算，熔融这类一回合的即时效果也不算） */
function sewerBadStatuses(u) {
  const st = (u && u.statuses) || {}, C = SEWER_CFG.cleanse;
  return C.first.concat(C.dot, C.then).filter(k => k === "burn" ? (Number(st.burn) || 0) > 0 : !!st[k]);
}
/** 持续扣血的状态这一回合结束预计扣多少血（期望值，和 app.js · turnEnd 用同一套骰子）；感电按同区同阵营的人数乘（每个人都挨一下） */
function sewerDotThreat(u, k) {
  const w = typeof currentWeatherFor === "function" ? currentWeatherFor(u) : (state.weather || "none");
  const sm = typeof statusMult === "function" ? statusMult(u) : 1;
  const avg = d => d.n * (d.s + 1) / 2;
  if (k === "burn") return Math.max(1, Math.floor(Number(u.statuses.burn) || 0)) * avg(statusDotDice("burn", u.level, w)) * sm;
  if (k === "corr") {
    const armor = (u.layers || []).some(l => l.type === "armor" && l.current > 0);
    return avg(statusDotDice("corr", u.level, w, armor, typeof envMult === "function" ? envMult(u) : 1)) * sm;
  }
  if (k === "shock") {
    const d = statusDotDice("shock", u.level, w);
    // 同区同阵营：和感电的波及（app.js · shockPulse）同一个判断（chainSideOf，#460；清的是敌人自己那边，结果和以前一样）
    const mates = (state.units || []).filter(x => x && !x.dead && !x.hidden && !x._removed && Number(x.zone) === Number(u.zone) && chainSideOf(u, x)).length;
    return Math.max(d.min || 1, (d.s + 1) / 2 + (d.bonus || 0)) * sm * Math.max(1, mates);
  }
  return 0;
}
/** 先清哪一种：first 里的先清；再清 dot 里预计扣血最多的（一样多照写的先后）；最后照 then 的先后。没有负面状态返回 null */
function sewerCleansePick(u) {
  const bad = sewerBadStatuses(u), C = SEWER_CFG.cleanse;
  if (!bad.length) return null;
  const first = C.first.find(k => bad.includes(k));
  if (first) return first;
  const dots = C.dot.filter(k => bad.includes(k));
  if (dots.length) return dots.slice().sort((a, b) => sewerDotThreat(u, b) - sewerDotThreat(u, a))[0];
  return C.then.find(k => bad.includes(k)) || null;
}
/** 清除状态（en_sewer_cleanse）：清掉一种负面状态；维护员（inspireKits）清完给自己永续的振奋（振奋 + inspireStay，只有一层）。
 *  返回清掉的状态，没有可清的返回 null */
function sewerCleanse(a, lines) {
  const k = sewerCleansePick(a);
  if (!k) { lines.push(`${a.name} 身上没有负面状态，不用清除。`); return null; }
  const st = a.statuses;
  if (k === "burn") st.burn = 0; else st[k] = false;
  if (k === "high") a.highEnergy = 0;            // 高能值跟着高能状态一起清掉
  if (k === "weak") st.weakFear = false;
  if (k === "chase") a.chasers = [];
  if (k === "shockwave" && typeof syncShockwave === "function") syncShockwave(a, lines);   // 震荡压下去的架势上限还回去
  lines.push(`${a.name} 清除了身上的${SEWER_STATUS_NAME[k] || k}。`);
  if (SEWER_CFG.cleanse.inspireKits.includes(a.kit)) {
    if (st.inspire && st.inspireStay) lines.push(`${a.name} 已经有永续的振奋（振奋只有一层）。`);
    else {
      st.inspire = true;
      st.inspireStay = true;
      if (typeof popStatus === "function") popStatus(a, "inspire");
      lines.push(`${a.name} 获得永续的振奋（ATK +25%，不会自动消失）。`);
    }
  }
  return k;
}
/** AI：这一步要不要先花附赠清除状态（身上有负面状态、还有附赠；决一死战里只能攻击灯，不清） */
function sewerCleanseChoice(u) {
  if (!u || u.isPlayer || u.stunned || (u.bonus || 0) < 1 || !sewerCleansePick(u)) return false;
  if (typeof touDuelVictim === "function" && touDuelVictim(u)) return false;
  return (enemySkillList(u) || []).some(s => s.id === "en_sewer_cleanse");
}

/* ---- 触灵清扫员：普通攻击（范围谐波）、操控清扫机、不主动协助（SEWER_CFG.cleaner / guard）---- */
/** 清扫员的普通攻击打哪一区：远程射程内（距离 1、不隔危墙 / 关着的门）看得见的敌人（sweeperFoesOf）最多的区；
 *  一样多的挑那一区敌人血量合计多的，再一样挑编号小的。被嘲讽 / 决一死战牵制时只打牵制者所在的区（够得着才打；同区可以抵近）。打不到返回 null */
function cleanerWaveZone(a) {
  const forced = enemyForcedTarget(a);
  if (forced) return enemyZoneInRange(a, "en_cleaner_wave", forced.zone) ? Number(forced.zone) : null;
  const foes = sweeperFoesOf(a);
  const zones = typeof boardZoneIds === "function" ? boardZoneIds() : Array.from({ length: Number(state.zoneMode) || 2 }, (_, i) => i + 1);
  let best = null;
  zones.forEach(z => {
    if (!enemyZoneInRange(a, "en_cleaner_wave", z)) return;
    const here = foes.filter(u => Number(u.zone) === Number(z));
    if (!here.length) return;
    const hp = here.reduce((s, u) => s + totalHp(u), 0);
    if (!best || here.length > best.n || (here.length === best.n && hp > best.hp)) best = { z: Number(z), n: here.length, hp };
  });
  return best ? best.z : null;
}
/** 清扫员打一区：那一区所有和它敌对的单位（倒地没起身的不算）各 waveMult×atk 谐波、waveBreak 击破（范围攻击，不能协助格挡）。
 *  被牵制而牵制者就在同区：抵近打自己所在的区，倍率 ×0.6（和电弧扫射、喷洒一致） */
function cleanerWave(a, zone, aa, lines) {
  const C = SEWER_CFG.cleaner;
  const pb = zoneDist(a.zone, zone, state.zoneMode) === 0 && enemyForcedPointBlank(a, enemyForcedTarget(a));
  const victims = hostilesOf(a).filter(u => Number(u.zone) === Number(zone) && !(typeof isDownProtected === "function" && isDownProtected(u)));
  lines.push(`${a.name} 对 ${zone} 区所有敌人发出谐波：各 ${C.waveMult}×ATK${pb ? "（抵近 ×0.6）" : ""}、${C.waveBreak} 击破${victims.length ? "" : "（那一区没有敌人）"}。`);
  victims.forEach(u => {
    if (u.dead || u._removed || Number(u.zone) !== Number(zone)) return;   // 前面的一击连带打死 / 推走的
    aa(u, { element: "harmonic", mult: C.waveMult * (pb ? 0.6 : 1), baseBreak: C.waveBreak, flags: { action: true, aoe: true } });
  });
}
/** 清扫员在场（活着、在战场上；失衡的也算） */
function cleanerOnField() {
  return (state.units || []).some(u => u && u.kit === "sewer_cleaner" && !u.dead && !u._removed && !u.hidden && !u.fused);
}
/** 操控清扫机（app.js · dealTo 每打一个人问一次）：这一下打在 target 身上时由哪只清扫机代为承受——同区血量最多的那只；不代挡返回 null。
 *  清扫员在场、target 是维护员 / 清扫员（SEWER_CFG.guard.protect）、这一下是攻击行动或范围攻击（范围攻击每人各挡一次）；100%，不掷骰。
 *  灼烧 / 场地这类环境伤害、衍射 / 锁定这类绕过代挡的不挡；自己那一伙打的不挡（和载具代挡一样） */
function sweeperGuardFor(attacker, target, opt) {
  if (!attacker || !target || target.isPlayer || !SEWER_CFG.guard.protect.includes(target.kit)) return null;
  const f = (opt && opt.flags) || {};
  if (f.environment || f.diffract || f.locked || !(f.action || f.aoe)) return null;
  if (!attacker.isPlayer && factionOf(attacker) && !hostileTo(attacker, target)) return null;
  if (!cleanerOnField()) return null;
  const list = (state.units || []).filter(u => u && u.kit === "sewer_sweeper" && !u.dead && !u._removed && !u.hidden && !u.fused && !u._sweeperBoom &&
    Number(u.zone) === Number(target.zone) && totalHp(u) > 0);
  return list.length ? list.slice().sort((a, b) => totalHp(b) - totalHp(a))[0] : null;
}
/** 代挡的那一下结算完（dealTo 最后调）：清扫机剩下的血量 < boomBelow 但还没死，立刻发动它的协助（自爆）——冲到打它的那个人所在的区炸那一区；
 *  打的人不在场上（配置物、残骸……）或者和它不敌对就在原地炸。返回 true = 炸了 */
function sweeperGuardAfter(sw, attacker, notes) {
  if (!sw || sw.dead || sw._removed || sw._sweeperBoom) return false;
  const max = totalMaxHp(sw), hp = totalHp(sw);
  if (!(max > 0) || !(hp > 0) || hp >= max * SEWER_CFG.guard.boomBelow) return false;
  notes.push(`${sw.name} 代挡后只剩不到 ${Math.round(SEWER_CFG.guard.boomBelow * 100)}% 的血量：立刻发动协助（自爆）。`);
  const t = attacker && (state.units || []).includes(attacker) && !attacker.dead && !attacker._removed && hostileTo(sw, attacker) ? attacker : null;
  return sweeperSelfDestruct(sw, t, notes);
}
/** 触灵清扫员不主动协助：能协助的名单里还有别的单位时把清扫员拿掉；只剩清扫员能协助时照常协助（ai.js · aiPickAssister 调） */
function sewerAssistPool(list) {
  const others = (list || []).filter(u => u && u.kit !== "sewer_cleaner");
  return others.length ? others : (list || []);
}

/* ===== 阵营敌对 =====
 * HOSTILE_FACTIONS 里的阵营和其他所有阵营的敌人互相视为敌人：异星生物、下水道的狂鼠（docs/ratfolk.md，和 effects.js · RATFOLK_FACTION 同名）；
 * HOSTILE_EXCEPT_ALLIES 里的阵营和自己那一伙（run.js · ALLIED_FACTIONS）以外的所有阵营互相视为敌人：下水道维护（SEWER_FACTION，
 * docs/sewer-maintenance.md：和安保、警卫队、镇压队友好（还有「巨人」阵营，HOSTILE_EXCEPT_FRIENDS），和狂鼠、盗匪、沙灵、沙漠生物、异星生物等其他阵营敌对）；
 * 盗匪和安保、警卫队互相视为敌人（会互相攻击、不互相协助）。其余敌人阵营之间照旧是一伙的。 */
const HOSTILE_FACTIONS = ["异星生物", "狂鼠"];
const HOSTILE_EXCEPT_ALLIES = [SEWER_FACTION];
/** HOSTILE_EXCEPT_ALLIES 的阵营另外友好的阵营（不在同伙组里、但同属巨人方）：下水道维护和「巨人」阵营友好（作者 10/22：「一切巨人方友好」），和「触灵」阵营也友好（作者 10/22；野生、古代造物等照旧敌对） */
const HOSTILE_EXCEPT_FRIENDS = { [SEWER_FACTION]: ["巨人", "触灵"] };
const HOSTILE_PAIRS = [["盗匪", "安保"], ["盗匪", "警卫队"], ["盗匪", "镇压队"], ["沙漠生物", "沙灵"]];
function factionOf(u) {
  if (!u) return null;
  if (u.isPlayer) return "我方";
  const i = typeof enemyInfo === "function" ? enemyInfo(u.kit) : null;
  return (i && i.faction) || null;
}
/** 这个敌人和我方是同阵营（跑团战斗模板可以设「我方与某阵营同阵营」，state.playerAllies）。
 *  by：按哪个玩家阵营看（玩家这一边的单位，或者阵营 id；不给 = 默认阵营「我方」）——这个玩家阵营和敌人的阵营
 *  用 battle.playerFaction 单独设过敌友（PvP 第一步，#445）就照设的，没设过照旧看 state.playerAllies */
function playerAllied(u, by) {
  if (!u || u.isPlayer) return false;
  const fp = by == null ? PVP_CFG.defaultFaction : (typeof by === "string" ? by : playerFactionOf(by));
  const set = pvpEnemyRelation(fp, u);
  if (set !== null) return !set;
  const g = (typeof state !== "undefined" && state.playerAllies) || [];
  return g.length > 0 && g.includes(factionOf(u));
}
/** a 和 b 是不是敌对的 */
function hostileTo(a, b) {
  if (!a || !b || a === b) return false;
  // 中立生物（尘虫、管虫）：谁都不当它是敌人；要打它得专门去打（玩家手动、沙鱼捕食）
  if (typeof isNeutralCreature === "function" && (isNeutralCreature(a) || isNeutralCreature(b))) return false;
  // 玩家这一边和敌人：按玩家的阵营看（#445；没配置阵营时就是「我方」，照旧看 state.playerAllies）
  if (!!a.isPlayer !== !!b.isPlayer) return !playerAllied(a.isPlayer ? b : a, a.isPlayer ? a : b);
  // 玩家这一边之间：只有分属敌对的玩家阵营才敌对（#445；没配置阵营时都在「我方」，照旧不敌对）
  if (a.isPlayer) return playerFactionsHostile(playerFactionOf(a), playerFactionOf(b));
  const fa = factionOf(a), fb = factionOf(b);
  if (!fa || !fb || fa === fb) return false;
  if (HOSTILE_FACTIONS.includes(fa) || HOSTILE_FACTIONS.includes(fb)) return true;
  if (HOSTILE_EXCEPT_ALLIES.includes(fa) || HOSTILE_EXCEPT_ALLIES.includes(fb)) {
    const friends = (HOSTILE_EXCEPT_FRIENDS[fa] || []).includes(fb) || (HOSTILE_EXCEPT_FRIENDS[fb] || []).includes(fa);
    return !friends && !(typeof alliesOf === "function" && alliesOf(fa).includes(fb));
  }
  return HOSTILE_PAIRS.some(([x, y]) => (fa === x && fb === y) || (fa === y && fb === x));
}
/** 场上和 a 敌对、还活着的单位 */
function hostilesOf(a) {
  return (state.units || []).filter(u => u && hostileTo(a, u) && !u.dead && !u.hidden && !u._removed && !u.fused && u.kit !== "ironwall");
}

/* ===== 友伤开关（#428，作者 10/27）=====
 * 每个玩家各自一个开关，默认关，战斗中途随时能改、改了立刻生效，只影响他自己操控的单位：
 *   开着时，他的单位的攻击能选中除自己以外的所有队友（含武器人、护送对象），范围攻击（同区、整排、溅射、导体……）也打到范围里的队友，施放者自己除外。
 *   打队友和打敌人完全一样算（克制、减伤、格挡 / 协助格挡、失衡……），只是不计分数（这一击带着 flags.friendlyFire：app.js · dealToInner / markPartyHurt /
 *   applyKnockdown / finishBlockInner 看它不记分、不记战场数据）。
 *   治疗、振奋这类增益照旧只给自己人；敌人的攻击、范围、AI 全部照旧。
 * 状态：state.friendlyFire = { 操控者: true / false }，没记的人按 FRIENDLY_FIRE.defaultOn（存档、联机同步都跟着战斗状态走；
 *   开新的一场战斗清空，回到默认的关：app.js · resetBattleRecords）。
 * 操控者：本机一个人操控全队（FRIENDLY_FIRE.localOwner）；联机由房主的 hotseat-game.js 按角色分配换成各人（setFriendlyFireOwner）。
 * 「谁能被这次攻击打到」统一问 attackFoe(a, b)：敌我不同（和以前一样），或者 a 开着友伤、b 是 a 以外的队友。以后 PvP（玩家分队对打）也接在这里 */
const FRIENDLY_FIRE = {
  defaultOn: false,      // 默认关
  localOwner: "local"    // 本机（单局、单人、跑团）：一个开关管全队
};
let FRIENDLY_FIRE_OWNER = null;
/** 联机房主登记「这个单位归谁操控」（u → 操控者 id；null = 回到本机一个人）。返回撤销函数 */
function setFriendlyFireOwner(fn) {
  const mine = typeof fn === "function" ? fn : null;
  FRIENDLY_FIRE_OWNER = mine;
  return () => { if (FRIENDLY_FIRE_OWNER === mine) FRIENDLY_FIRE_OWNER = null; };
}
/** 这个单位归哪个开关管：武器人跟着持有者；登记了联机的操控者就按分配查，查不到的（没分配）归本机 / 房主那一个。
 *  玩家操控的碎渣机炮这类替身（creditTo）跟着操控它的人 */
function friendlyFireOwner(u) {
  if (u && u.creditTo && typeof unitById === "function") u = unitById(u.creditTo) || u;
  if (!u || !u.isPlayer) return null;
  if (FRIENDLY_FIRE_OWNER) {
    let who = null;
    try { who = FRIENDLY_FIRE_OWNER(u); } catch (e) { who = null; }
    if (who) return String(who);
  }
  return FRIENDLY_FIRE.localOwner;
}
/** 某个操控者的开关现在开着没有（owner 不给 = 本机那一个） */
function friendlyFireSetting(owner) {
  const map = (typeof state !== "undefined" && state && state.friendlyFire) || null;
  const key = owner == null ? FRIENDLY_FIRE.localOwner : String(owner);
  if (map && typeof map === "object" && Object.prototype.hasOwnProperty.call(map, key)) return map[key] === true;
  return !!FRIENDLY_FIRE.defaultOn;
}
/** 改某个操控者的开关（owner 不给 = 本机那一个）。换一份新的对象（联机按差量发、预演的拷贝都看得出变了）。返回改完的值 */
function setFriendlyFire(owner, on) {
  const key = owner == null ? FRIENDLY_FIRE.localOwner : String(owner);
  const old = (state && state.friendlyFire && typeof state.friendlyFire === "object") ? state.friendlyFire : {};
  const next = {};
  Object.keys(old).forEach(k => { if (k !== key && typeof old[k] === "boolean") next[k] = old[k]; });
  next[key] = !!on;
  state.friendlyFire = next;
  return !!on;
}
/* 被嘲讽的人选目标（PvP，#478，作者 10/29：「被嘲讽了就只能打嘲讽的」）：开着友伤也不能拿攻击去打队友。
 * 技能分步里「选敌人」的那几步（app.js · fieldFoes / visibleEnemies）开着友伤时会把队友列进来——在 friendlyFireAside(u, fn) 里再算一遍
 * （这一次 u 的操控者的开关当作关着），没列进来的队友就是「只因为开着友伤才选得到的」，算攻击（app.js · tauntStepOk）；
 * 给友方的、选任意单位的那几步不看友伤，两次一样。只在 fn 里有效：不改开关、不影响结算 */
let FRIENDLY_FIRE_ASIDE = null;   // 正在「当作没开友伤」算名单的操控者（friendlyFireOwner）
function friendlyFireAside(u, fn) {
  const prev = FRIENDLY_FIRE_ASIDE;
  FRIENDLY_FIRE_ASIDE = friendlyFireOwner(u);
  try { return fn(); } finally { FRIENDLY_FIRE_ASIDE = prev; }
}
/** a 的攻击现在开着友伤没有（只看玩家一方的单位；敌人永远没有）。friendlyFireAside 里算名单时，那个操控者的当作关着 */
function friendlyFireOn(a) {
  if (!a || !a.isPlayer) return false;
  const owner = friendlyFireOwner(a);
  if (FRIENDLY_FIRE_ASIDE != null && owner === FRIENDLY_FIRE_ASIDE) return false;
  return friendlyFireSetting(owner);
}
/** a 这一下打 b 是不是打到玩家这一边的人（替身打操控它的人也算打自己，不算）：
 *    a 开着友伤、b 是 a 以外的同阵营队友（友伤开关只管同阵营，#445）；
 *    或者 b 是和 a 敌对的玩家阵营的角色（PvP，#445：开关开不开都打得到）。
 *  两种都和打敌人完全一样结算，这一击带着 flags.friendlyFire 不计分数（PvP 每队单独计分是第三步，docs/pvp.md 第 4 节） */
function friendlyFireHit(a, b) {
  if (!a || !b || a === b || (a.id != null && a.id === b.id) || (a.creditTo != null && a.creditTo === b.id)) return false;
  if (!a.isPlayer || !b.isPlayer) return false;
  if (pvpFoe(a, b)) return true;
  return friendlyFireOn(a) && samePlayerFaction(a, b);
}
/** 谁能被 a 的这次攻击打到（单体选目标、范围攻击挑人共用）：敌我不同的（和以前的 isPlayer 判断一样，友军 / 中立 / 下潜这些照旧另判；
 *  a 的玩家阵营和 b 的敌人阵营单独设成了友好的不算，#445），或者 friendlyFireHit 认的玩家这一边的人（开着友伤的同阵营队友、敌对玩家阵营的角色） */
function attackFoe(a, b) {
  if (!a || !b || a === b || (a.id != null && a.id === b.id)) return false;
  if (!!a.isPlayer !== !!b.isPlayer) return !pvpFriendlyEnemy(a, b);
  return friendlyFireHit(a, b);
}
/** 自动挑目标（#432，作者 10/27）：by 的自动攻击（瑞比的无人机、炮台、护送对象的还击、洗牌的红弹、音爆 / 探测模式触发的碎渣机炮……）
 *  挑目标时，by 的操控者开着友伤就把 by 以外的队友（武器人、护送对象也算）也放进候选名单；挑法照原来的规则（最近、血最少、随机……），
 *  只是名单变大了。u 是不是这样加进来的队友：by 以外、还在场上、没倒地（濒死没起身的打了也白打，和炮台 / 碎渣机炮挑我方时一样不挑）。
 *  召唤物 / 替身本身不在场上的单位里；替身（creditTo）不挑操控它的人（friendlyFireHit）。射程、躲藏、隔墙这些照各处原来的条件另判。
 *  PvP（#445）：敌对玩家阵营的角色也走这里进名单（friendlyFireHit 认它们，开关开不开都在） */
function friendlyFirePick(by, u) {
  return !!u && !!u.isPlayer && !u.dead && !u.hidden && !u.fused && !u._removed && !(u.dying && !u.upOnShp) && friendlyFireHit(by, u);
}

/* ===== 玩家阵营（PvP 第一步，#445，docs/pvp.md 第 1.1 节）=====
 * 每个玩家角色属于一个「玩家阵营」：武器人跟着持有者，替身（creditTo）跟着操控它的人；护送对象没有主人，自己记（没记的在默认阵营）。
 * 默认全部在同一个阵营「我方」（PVP_CFG.defaultFaction）——这时一切和以前一模一样：没有配置时（state.playerFactions 是 null）
 * 下面的判断都走原来的分支。配置记在战斗状态里（存档、预演、联机房间检查点都跟着整个 state 走；开新的一场战斗清空，app.js · resetBattleRecords）：
 *   state.playerFactions = {
 *     list:    [{ id, name, phase }],      阵营：id、名字、在我方回合（"player"）还是敌人回合（"enemy"）行动；默认阵营总在第一个
 *     members: { 单位 id: 阵营 id },        玩家角色归哪个阵营（没记的在默认阵营）
 *     players: { "甲|乙": true / false },   两个玩家阵营之间单独设过的敌友（键按字典序排；true = 敌对），没设的按 PVP_CFG.playersHostile
 *     enemies: { "甲|盗匪": true / false }  玩家阵营和敌人阵营（enemyInfo(kit).faction）单独设过的敌友，没设的照旧（敌对；state.playerAllies 的同阵营友好）
 *   }
 * 改它用指令 battle.playerFaction（battle-commands.js → setPlayerFaction）；主持人面板是第二步。
 * 敌我判断都接在这里：hostileTo / playerAllied（按谁的阵营看）/ attackFoe / friendlyFireHit（敌对玩家阵营的角色也算进来）/ autoFoe / allyOf；
 * 给友方的范围效果只给施放者的自己人（同一个玩家阵营，或者单独设成友好的玩家阵营）：teammateOf（#456 / #460；单体选友方的 allyOf 是同一个判断）；
 * 协助格挡（含掩护 / 挺身的免费格挡、以身作盾）由被打的人的自己人挡、载具代挡按驾驶员的自己人（#463）、上车 / 拉人下车按阵营（#468）也是 teammateOf，友好不传递时不出手看 otherFactionFriend；
 * 连锁伤害（高能自爆的余波、感电的波及）打的「同阵营」：chainSideOf（#460）；
 * 谁在哪个回合行动：unitTurnPhase（app.js · canControlUnit、回合开始补行动点）；胜负：factionHostileTo（app.js · pvpBattleOutcome） */
const PVP_CFG = {
  defaultFaction: "我方",   // 默认阵营的 id：没分过阵营的玩家角色都在这里
  defaultName: "我方",      // 默认阵营的名字
  newPhase: "player",       // 新建的阵营没写在哪个回合行动时：我方回合
  phases: ["player", "enemy"],
  playersHostile: true,     // 不同的玩家阵营默认互相敌对
  maxFactions: 8,           // 最多几个玩家阵营（含默认阵营）
  idMax: 16,                // 阵营 id 最多几个字
  nameMax: 16,              // 阵营名字最多几个字
  enemyMax: 24              // 敌人阵营的名字最多几个字
};
/** 现在的阵营配置；没配置返回 null（只有默认阵营，一切照旧） */
function pvpConfig() {
  const cfg = typeof state !== "undefined" && state ? state.playerFactions : null;
  return cfg && typeof cfg === "object" && Array.isArray(cfg.list) ? cfg : null;
}
/** 配置了玩家阵营没有 */
function pvpOn() { return !!pvpConfig(); }
function pvpOwn(o, k) { return !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k); }
/** 玩家阵营的信息 { id, name, phase }；没有这个阵营返回 null（默认阵营总有） */
function playerFactionInfo(id) {
  const cfg = pvpConfig();
  const row = cfg && id != null ? cfg.list.find(f => f && f.id === String(id)) : null;
  if (row) return { id: row.id, name: row.name || row.id, phase: row.phase === "enemy" ? "enemy" : "player" };
  return id === PVP_CFG.defaultFaction ? { id, name: PVP_CFG.defaultName, phase: "player" } : null;
}
/** 所有玩家阵营（默认阵营在第一个） */
function playerFactionList() {
  const cfg = pvpConfig();
  return cfg ? cfg.list.map(f => playerFactionInfo(f && f.id)).filter(Boolean) : [playerFactionInfo(PVP_CFG.defaultFaction)];
}
/** u 属于哪个玩家阵营（阵营 id；非玩家单位返回 null）。武器人跟着持有者，替身（creditTo）跟着操控它的人 */
function playerFactionOf(u) {
  if (u && u.creditTo != null && typeof unitById === "function") u = unitById(u.creditTo) || u;
  if (!u || !u.isPlayer) return null;
  const cfg = pvpConfig();
  if (!cfg) return PVP_CFG.defaultFaction;
  const owner = u.weaponOf && typeof weaponOwnerUnit === "function" ? weaponOwnerUnit(u) : null;
  const id = (owner || u).id;
  const f = id != null && pvpOwn(cfg.members, id) ? cfg.members[id] : null;
  return f != null && playerFactionInfo(f) ? f : PVP_CFG.defaultFaction;
}
/** u 在哪个回合行动："player"（我方回合）/ "enemy"（敌人回合）。玩家这一边看所在的玩家阵营（默认我方回合），非玩家单位在敌人回合 */
function unitTurnPhase(u) {
  const f = playerFactionOf(u);
  if (f == null) return "enemy";
  const info = playerFactionInfo(f);
  return info && info.phase === "enemy" ? "enemy" : "player";
}
/** a、b 都在玩家这一边、同一个玩家阵营 */
function samePlayerFaction(a, b) {
  const fa = playerFactionOf(a);
  return fa != null && fa === playerFactionOf(b);
}
function pvpPairKey(a, b) { return [String(a), String(b)].sort().join("|"); }
/** 两个玩家阵营（id）敌不敌对：同一个阵营不敌对；单独设过的照设的，没设的按 PVP_CFG.playersHostile */
function playerFactionsHostile(fa, fb) {
  if (fa == null || fb == null || fa === fb) return false;
  const cfg = pvpConfig();
  if (!cfg) return false;
  const key = pvpPairKey(fa, fb);
  return pvpOwn(cfg.players, key) && typeof cfg.players[key] === "boolean" ? cfg.players[key] : !!PVP_CFG.playersHostile;
}
/** a、b 是敌对玩家阵营的单位（PvP 的对手） */
function pvpFoe(a, b) {
  return !!a && !!b && a !== b && playerFactionsHostile(playerFactionOf(a), playerFactionOf(b));
}
/** 玩家阵营 fp 和非玩家单位 u 的阵营单独设过的敌友：true 敌对 / false 友好 / null 没设过（照旧） */
function pvpEnemyRelation(fp, u) {
  const cfg = pvpConfig();
  if (!cfg || fp == null || !u || u.isPlayer) return null;
  const fe = factionOf(u);
  if (!fe) return null;
  const key = fp + "|" + fe;
  return pvpOwn(cfg.enemies, key) && typeof cfg.enemies[key] === "boolean" ? cfg.enemies[key] : null;
}
/** a、b 一边在玩家这一边、一边是非玩家单位，而且这个玩家阵营和那个敌人阵营单独设成了友好（state.playerAllies 默认的友好照旧另判） */
function pvpFriendlyEnemy(a, b) {
  if (!a || !b || !!a.isPlayer === !!b.isPlayer) return false;
  const p = a.isPlayer ? a : b, o = a.isPlayer ? b : a;
  return pvpEnemyRelation(playerFactionOf(p), o) === false;
}
/** 玩家阵营 fp 和单位 u 敌不敌对（胜负判定用：不用拿一个具体的玩家单位去问 hostileTo，结论和 hostileTo 一样） */
function factionHostileTo(fp, u) {
  if (fp == null || !u) return false;
  if (typeof isNeutralCreature === "function" && isNeutralCreature(u)) return false;
  if (u.isPlayer) return playerFactionsHostile(fp, playerFactionOf(u));
  return !playerAllied(u, fp);
}
/** 自动挑目标的候选（#432 的那几处名单，#445 起统一问这里）：敌人（by 的玩家阵营单独设成友好的敌人阵营除外），
 *  以及 friendlyFirePick 认的玩家这一边的人（开着友伤的同阵营队友、敌对玩家阵营的角色；倒地没起身的不挑） */
function autoFoe(by, u) {
  if (!u) return false;
  if (!u.isPlayer) return !pvpFriendlyEnemy(by, u);
  return friendlyFirePick(by, u);
}
/** 给友方用的技能（治疗、振奋……）选目标时 b 算不算 a 的友方：和 teammateOf 是同一个判断（#460 起合成一个；这个名字留给 #445 的调用处）。
 *  没配置阵营时就是「b 在玩家这一边」，和以前一样 */
function allyOf(a, b) {
  return teammateOf(a, b);
}
/** u 算不算 by 的自己人：u 在玩家这一边，而且所在的玩家阵营不和 by 的敌对——同一个玩家阵营，或者单独设成友好的玩家阵营（#460，作者 10/28：
 *  「互相友好的话就吃」；友好不传递：甲和乙、乙和丙友好，甲和丙照旧按它俩之间的设置）。武器人跟着持有者、替身跟着操控它的人、
 *  护送对象按自己记的阵营（playerFactionOf）。给友方的范围效果（群体治疗、护盾、全队集结、全体坚挺、全反击……，#456）问这里；
 *  单体选友方的技能 / 道具问 allyOf（#445），是同一个判断；连锁伤害打的「同阵营」（chainSideOf）玩家这一边也按它；
 *  谁能替被打的人协助格挡（app.js · eligibleBlockers、feats.js · featIronwallDeclarers）、玩家开的车替谁代挡（vehicle.js · vehicleGuards，#463）、
 *  玩家之间谁能一起坐车、谁能被拉下车（vehicle.js · vehicleRival，#468）也按它。
 *  by 不在玩家这一边（没有施放者……）时照旧只看 u 是不是玩家角色。没配置阵营 / 场上只有「我方」时就是「u 在玩家这一边」，和以前一样。
 *  友伤开关不管这里（开着友伤时同阵营的队友照旧吃增益） */
function teammateOf(by, u) {
  if (!u || !u.isPlayer) return false;
  return !playerFactionsHostile(playerFactionOf(by), playerFactionOf(u));
}
/** attacker 是 u 的自己人、但不在 u 的玩家阵营里（别的、和 u 友好的玩家阵营的人）：友好不传递（#460）时 u 不在两个自己人之间出手——
 *  防守反击不去打他（#460），协助格挡 / 以身作盾也不替别人挡他（#463：挡下来的反击、全反击会打到和自己友好的进攻者）。
 *  同一个阵营的不算（开着友伤打队友时照旧，#428）；attacker 不在玩家这一边时是 false。只有一个玩家阵营时永远是 false */
function otherFactionFriend(u, attacker) {
  return !!attacker && !!attacker.isPlayer && !samePlayerFaction(u, attacker) && teammateOf(u, attacker);
}
/** 连锁伤害打的「同阵营」（#460，作者 10/28：「高能还有感电确实也需要重新改成现在这样按照阵营的」）：高能自爆的余波、感电 / 中和感电的波及。
 *  照原来「我方 / 敌人」两边的写法，只是把「我方」换成阵营判断——source 在玩家这一边时是它的自己人（teammateOf：同阵营或友好的阵营，
 *  敌对玩家阵营的人不挨）；source 是非玩家单位时照旧是所有非玩家单位。没配置阵营 / 只有「我方」时就是「和 source 同一边」，和以前一样 */
function chainSideOf(source, u) {
  if (!source || !u) return false;
  return source.isPlayer ? teammateOf(source, u) : !u.isPlayer;
}
/** 嘲讽对玩家（PvP 第二步，docs/pvp.md 第 5 节，作者 10/28，#464）：玩家这一边的单位被嘲讽时，也只能选嘲讽它的那个单位作为攻击目标（和敌人被嘲讽一样）；
 *  玩家角色被嘲讽时，它的武器人一起被嘲讽（武器人自己没被嘲讽就跟着持有者的）。返回 u 现在被强制攻击的对象，没有返回 null。
 *  只认和 u 敌对的人的嘲讽：敌对玩家阵营的人（或非玩家单位）。同阵营的队友开着友伤嘲讽的（柯尔特「过度自信」打到队友……）不算——
 *  只有一个玩家阵营时这里一个都不拦，一切照旧。嘲讽者倒地（濒死没起身）、不在场、躲起来选不中，或者 u 本来就打不到它（attackFoe）时不起作用 */
function playerTauntTarget(u) {
  if (!u || !u.isPlayer) return null;
  const holder = u.weaponOf && typeof weaponOwnerUnit === "function" ? weaponOwnerUnit(u) : null;
  const id = u.tauntTo || (holder && holder.tauntTo);
  const t = id && typeof unitById === "function" ? unitById(id) : null;
  if (!t || t.dead || t.hidden || t._removed || t.fused || t.submerged || t.untargetable || (t.statuses && t.statuses.hide) || (t.dying && !t.upOnShp)) return null;
  if (t.isPlayer && !pvpFoe(u, t)) return null;
  return attackFoe(u, t) ? t : null;
}
/** 被嘲讽的玩家单位对嘲讽它的那个单位出了手（技能 / 道具，app.js · runSkill、battle-commands.js · 用道具）：这次嘲讽用掉了（「下次攻击必须打你」）。
 *  武器人和持有者共用持有者的那一次：谁先打了嘲讽者，两个都解除（docs/pvp.md 第 5 节）——武器人自己也挂着同一个人的嘲讽时
 *  （柯尔特「过度自信」同时打到灯和年糕……），持有者打了嘲讽者也一起解除（#490：以前只有武器人先打才两个都解除） */
function playerTauntDone(u, t) {
  if (!u || !t) return;
  const holder = u.weaponOf && typeof weaponOwnerUnit === "function" ? weaponOwnerUnit(u) : null;
  const owner = holder || u;
  const weapons = (state.units || []).filter(x => x && x !== u && x.weaponOf && owner.kit && x.weaponOf === owner.kit && x.isPlayer);
  [u, holder].concat(weapons).forEach(x => { if (x && x.tauntTo === t.id) x.tauntTo = null; });
}
/** 指令 battle.playerFaction（字段已经在 battle-commands.js 校验过）：
 *   { reset: true }                    清空配置：回到默认（全部在「我方」，一切照旧）
 *   { faction, name?, phase? }         建 / 改一个玩家阵营：名字、在我方回合（"player"）还是敌人回合（"enemy"）行动
 *   { faction, remove: true }          删掉一个玩家阵营（默认阵营删不掉）：里面的人回到默认阵营，和它有关的敌友设置一起去掉
 *   { faction, unit }                  把玩家角色（武器人跟着持有者，不能单独分）分到这个阵营
 *   { faction, other, hostile }        这个阵营和另一个玩家阵营：true 敌对 / false 友好 / null 回到默认（互相敌对）
 *   { faction, enemy, hostile }        这个阵营和某个敌人阵营（图鉴里的阵营名，例「盗匪」）：true 敌对 / false 友好 / null 回到默认（照旧）
 *  分人、设敌友可以和建阵营一起给（没有这个阵营就先建）。每次换一份新的对象（联机按差量发、预演的拷贝都看得出变了）。返回改完的配置（拷贝，清空后是 null） */
function setPlayerFaction(cmd) {
  if (cmd.reset) { state.playerFactions = null; return null; }
  const old = pvpConfig();
  const next = old ? JSON.parse(JSON.stringify(old))
    : { list: [{ id: PVP_CFG.defaultFaction, name: PVP_CFG.defaultName, phase: "player" }], members: {}, players: {}, enemies: {} };
  ["members", "players", "enemies"].forEach(k => { if (!next[k] || typeof next[k] !== "object" || Array.isArray(next[k])) next[k] = {}; });
  const id = String(cmd.faction);
  if (cmd.remove) {
    if (id === PVP_CFG.defaultFaction) throw new Error("默认阵营「" + PVP_CFG.defaultName + "」不能删");
    if (!next.list.some(f => f.id === id)) throw new Error("没有这个玩家阵营：" + id);
    next.list = next.list.filter(f => f.id !== id);
    Object.keys(next.members).forEach(k => { if (next.members[k] === id) delete next.members[k]; });
    Object.keys(next.players).forEach(k => { if (k.split("|").includes(id)) delete next.players[k]; });
    Object.keys(next.enemies).forEach(k => { if (k.split("|")[0] === id) delete next.enemies[k]; });
    state.playerFactions = next;
    return JSON.parse(JSON.stringify(next));
  }
  let row = next.list.find(f => f.id === id);
  if (!row) {
    if (next.list.length >= PVP_CFG.maxFactions) throw new Error("最多 " + PVP_CFG.maxFactions + " 个玩家阵营");
    row = { id, name: id === PVP_CFG.defaultFaction ? PVP_CFG.defaultName : id, phase: PVP_CFG.newPhase };
    next.list.push(row);
  }
  if (cmd.name != null) row.name = String(cmd.name).trim();
  if (cmd.phase != null) row.phase = cmd.phase === "enemy" ? "enemy" : "player";
  if (cmd.unit != null) {
    const u = typeof unitById === "function" ? unitById(cmd.unit) : null;
    if (!u) throw new Error("没有这个单位：" + cmd.unit);
    if (id === PVP_CFG.defaultFaction) delete next.members[u.id]; else next.members[u.id] = id;
  }
  // 一次分好几个人（主持人面板「应用分配」，#490）：一起改、一起生效。一个一个改的话，中间那一刻会被当成真的局面判胜负、推回合——
  // 例：两个人互换阵营，先改的那一个和对面成了同一个阵营，场上只剩一个玩家阵营、又没有敌人，战斗就以胜利结束了
  if (cmd.members != null) {
    Object.keys(cmd.members).forEach(uid => {
      const u = typeof unitById === "function" ? unitById(uid) : null;
      if (!u) throw new Error("没有这个单位：" + uid);
      const f = String(cmd.members[uid]);
      if (!next.list.some(x => x.id === f)) throw new Error("没有这个玩家阵营：" + f);
      if (f === PVP_CFG.defaultFaction) delete next.members[u.id]; else next.members[u.id] = f;
    });
  }
  if (cmd.other != null) {
    const other = String(cmd.other);
    if (!next.list.some(f => f.id === other)) throw new Error("没有这个玩家阵营：" + other);
    const key = pvpPairKey(id, other);
    if (cmd.hostile === null) delete next.players[key]; else next.players[key] = !!cmd.hostile;
  }
  if (cmd.enemy != null) {
    const key = id + "|" + String(cmd.enemy);
    if (cmd.hostile === null) delete next.enemies[key]; else next.enemies[key] = !!cmd.hostile;
  }
  state.playerFactions = next;
  return JSON.parse(JSON.stringify(next));
}

/* ===== 决斗（PvP 第三步，#472，docs/pvp.md 第 1.2、2、3 节）=====
 * 联机探索环节里玩家之间的决斗：只有 1 队、2 队，就是两个互相敌对的玩家阵营（state.playerFactions，第一步的规则层）——
 * 敌我判断、协助格挡 / 协助攻击、谁在哪个回合行动全部照玩家阵营走，这里不另写一套。决斗自己的规则记在战斗状态里：
 *   state.pvpDuel = {
 *     teams:   { "1队": [单位 id…], "2队": [单位 id…] }   每队的角色（武器人跟着持有者，不单独记）
 *     stand:   true / false     允许起身；不允许时倒地的人留在场上，只是不能自己起身（能被专长救起来）
 *     rounds:  null / 回合数      回合上限（开了才有）：打完这一回合还没分出胜负，剩余血量百分比多的一队赢，一样算平局
 *     first:   "1队" / "2队"     开战时抛硬币定的先手（startCombat → pvpDuelToss）：先手在我方回合行动，后手在敌人回合行动
 *     carry:   { 单位 id: 1 }    后手补偿：开战时给后手每个角色的 1 个附赠，没用掉的一直叠到后手自己的回合上、直到用掉（refreshEconomy → pvpDuelCarry；不能行动的回合先收着，carryHeld）
 *     out:     [单位 id…]        再起不能、移出战场的人
 *     result:  null / { over, winner, draw, why, pct }   分出的胜负（pvpDuelOutcome / pvpDuelRoundLimit）
 *     restore: { heroes, dur }   决斗前队伍档案（LEDGER）里的血量 / 坚毅 / 耐久，结束后盖回去（pvpDuelRestore）。只在房主本机，不发给玩家
 *   }
 * 指令 battle.duel（battle-commands.js → pvpDuelSetup）在布好战场之后、开战之前布置；开新的一场战斗清空（app.js · resetBattleRecords）。
 * 伤害不会致死（pvpDuelShpFloor / pvpDuelKnockOut）；没有掉落、经验、奎支（app.js · settleBattleRewards）；结束后恢复（ledger.js · ledgerAfterBattle）。 */
const PVP_DUEL_CFG = {
  teams: [{ id: "1队", name: "1 队", zone: 1 }, { id: "2队", name: "2 队", zone: 3 }],   // 两队：玩家阵营 id / 名字、开局全队站哪一区
  zoneMode: 3,         // 3 区制：两边开局隔开（一队 1 区、一队 3 区）
  teamMax: 4,          // 每队最多几人（两队人数可以不一样，不另外补偿）
  teamMin: 1,          // 每队至少几人才能开打
  lateBonus: 1,        // 后手补偿：开战时后手每个角色手上先有几个附赠
  standDefault: true,  // 默认允许起身
  roundsDefault: 10,   // 打开「限定回合数」时默认几回合
  roundsMax: 99,       // 回合上限最多几回合
  outShp: 1            // 伤害不会致死：坚毅生命打到这里就保留这么多，再起不能、移出战场
};
/** 现在的决斗；不是决斗返回 null */
function pvpDuelState() {
  const d = typeof state !== "undefined" && state ? state.pvpDuel : null;
  return d && typeof d === "object" && d.teams && typeof d.teams === "object" ? d : null;
}
/** 这一场是不是决斗 */
function pvpDuelOn() { return !!pvpDuelState(); }
/** 队伍的信息 { id, name, zone }（PVP_DUEL_CFG.teams） */
function pvpDuelTeamInfo(id) { return PVP_DUEL_CFG.teams.find(t => t.id === id) || null; }
/** u 在决斗的哪一队（武器人跟着持有者、替身跟着操控它的人）；不在决斗里返回 null */
function pvpDuelTeamOf(u) {
  const d = pvpDuelState();
  if (!d || !u) return null;
  if (u.creditTo != null && typeof unitById === "function") u = unitById(u.creditTo) || u;
  const owner = u.weaponOf && typeof weaponOwnerUnit === "function" ? weaponOwnerUnit(u) : null;
  const id = (owner || u).id;
  const t = PVP_DUEL_CFG.teams.find(x => (d.teams[x.id] || []).includes(id));
  return t ? t.id : null;
}
/** 这一队的角色（还在 state.units 里的；被主持人移走的不在） */
function pvpDuelMembers(teamId) {
  const d = pvpDuelState();
  if (!d) return [];
  return (d.teams[teamId] || []).map(id => (state.units || []).find(u => u && u.id === id)).filter(Boolean);
}
/** 布置决斗（指令 battle.duel，字段已在 battle-commands.js 校验过）：{ teams: { "1队": [角色单位 id…], "2队": [...] }, stand, rounds }。
 *  在布好战场（battle.setup，把队伍摆上场）之后、开战之前：不参加的角色（连同武器人）、敌人、护送对象、配置物离场；3 区制，
 *  1 队全部站 1 区、2 队全部站 3 区；两队分成两个互相敌对的玩家阵营（setPlayerFaction）；记下决斗前的血量 / 坚毅 / 耐久。返回 state.pvpDuel 的公开部分 */
function pvpDuelSetup(cmd) {
  const C = PVP_DUEL_CFG;
  if (state.combatStarted) throw new Error("战斗已经开始，不能再布置决斗");
  const heroes = (state.units || []).filter(u => u && u.isPlayer && !u.escort && !u._removed && !(typeof isWeaponUnit === "function" && isWeaponUnit(u)));
  const teams = {}, seen = new Set();
  C.teams.forEach(t => {
    const ids = ((cmd.teams || {})[t.id] || []).map(String);
    if (ids.length < C.teamMin) throw new Error(`${t.name}至少要 ${C.teamMin} 人`);
    if (ids.length > C.teamMax) throw new Error(`${t.name}最多 ${C.teamMax} 人`);
    ids.forEach(id => {
      const u = heroes.find(h => h.id === id);
      if (!u) throw new Error("没有这名角色：" + id);
      if (seen.has(id)) throw new Error(`${u.name} 只能选一队`);
      seen.add(id);
    });
    teams[t.id] = ids;
  });
  // 决斗前的样子：队伍档案里每个参加的人的血量 / 坚毅（LEDGER.heroes），和他的武器的耐久（LEDGER.dur）；没记过的记 null（结束后删掉，回到满的）
  const restore = { heroes: {}, dur: {} };
  if (typeof LEDGER !== "undefined" && LEDGER) {
    heroes.filter(u => seen.has(u.id)).forEach(u => {
      const rec = LEDGER.heroes && LEDGER.heroes[u.kit];
      restore.heroes[u.kit] = rec ? JSON.parse(JSON.stringify(rec)) : null;
      (u.linkedKits || []).forEach(k => { const v = LEDGER.dur && LEDGER.dur[k]; restore.dur[k] = v == null ? null : Number(v); });
    });
  }
  heroes.filter(u => !seen.has(u.id)).forEach(u => { if (typeof removeHeroUnit === "function") removeHeroUnit(u); });
  state.units = (state.units || []).filter(u => u && u.isPlayer && !u.escort);   // 决斗没有敌人、护送对象
  state.props = [];
  state.zoneMode = C.zoneMode;
  state.board = null;
  state.fields = { 1: emptyField(), 2: emptyField(), 3: emptyField() };
  state.gaps = { "1-2": emptyGap(), "2-3": emptyGap() };
  state.playerAllies = [];
  state.battleDrops = null;   // 决斗没有掉落
  state.ambush = false;
  if (typeof Chain !== "undefined" && Chain.clear) Chain.clear();
  // 两队 = 两个互相敌对的玩家阵营（不同的玩家阵营默认就敌对）；谁先手开战时抛硬币再定
  setPlayerFaction({ reset: true });
  C.teams.forEach(t => {
    setPlayerFaction({ faction: t.id, name: t.name, phase: "player" });
    teams[t.id].forEach(id => {
      setPlayerFaction({ faction: t.id, unit: id });
      const u = unitById(id);
      (state.units || []).forEach(x => { if (x === u || (x.weaponOf && x.weaponOf === u.kit)) x.zone = t.zone; });
    });
  });
  state.pvpDuel = { teams, stand: cmd.stand == null ? !!C.standDefault : !!cmd.stand,
    rounds: cmd.rounds == null ? null : Math.max(1, Math.min(C.roundsMax, Math.floor(Number(cmd.rounds)))),
    first: null, carry: {}, out: [], result: null, restore };
  appendLog(`决斗：${C.teams.map(t => `${t.name}（${teams[t.id].map(id => unitById(id).name).join("、")}）`).join(" 对 ")}，` +
    `${state.pvpDuel.stand ? "允许起身" : "不允许起身"}，${state.pvpDuel.rounds ? `限定 ${state.pvpDuel.rounds} 回合` : "不限回合"}。开战时抛硬币决定先手。`);
  return pvpDuelPublic();
}
/** 决斗的公开部分（给画面、联机玩家看；不含决斗前的坚毅这些） */
function pvpDuelPublic() {
  const d = pvpDuelState();
  if (!d) return null;
  const r = d.result;
  return JSON.parse(JSON.stringify({ teams: d.teams, stand: !!d.stand, rounds: d.rounds || null, first: d.first || null, out: d.out || [],
    result: r ? { over: !!r.over, winner: r.winner || null, draw: !!r.draw, why: r.why || null, pct: r.pct || null } : null }));
}
/** 开战（app.js · startCombat，补行动点之前）：抛硬币定先手——先手的阵营在我方回合行动，后手的在敌人回合行动，结果写进战斗记录 */
function pvpDuelToss() {
  const d = pvpDuelState();
  if (!d || d.first) return;
  const [a, b] = PVP_DUEL_CFG.teams;
  d.first = Math.random() < 0.5 ? a.id : b.id;
  const first = pvpDuelTeamInfo(d.first), second = d.first === a.id ? b : a;
  setPlayerFaction({ faction: first.id, phase: "player" });
  setPlayerFaction({ faction: second.id, phase: "enemy" });
  appendLog(`抛硬币：${first.name}先手（我方回合行动），${second.name}后手（敌人回合行动）。`);
}
/** 开战（app.js · startCombat，在敌人回合行动的阵营清零行动点之后）：后手补偿——后手每个在场的角色手上先有 1 个附赠，
 *  先手的第一回合里就能用（主要拿来协助格挡）；没用掉的记在 carry 里，后手自己的第一回合开始时叠上去 */
function pvpDuelLateBonus() {
  const d = pvpDuelState();
  if (!d || !d.first) return;
  const n = Math.max(0, Math.floor(Number(PVP_DUEL_CFG.lateBonus) || 0));
  const second = PVP_DUEL_CFG.teams.find(t => t.id !== d.first);
  if (!n || !second) return;
  const carry = {};
  (state.units || []).forEach(u => {
    if (!u || !u.isPlayer || u.hidden || u.dead || u._removed || u.escort || pvpDuelTeamOf(u) !== second.id) return;
    u.bonus = n; u.bonusMax = Math.max(Number(u.bonusMax) || 0, n);
    carry[u.id] = n;
  });
  d.carry = carry;
  appendLog(`后手补偿：${second.name}每个角色先有 ${n} 个附赠动作，先手的第一回合里就能用（主要拿来协助格挡）；没用掉的留到自己的第一回合。`);
}
/** 后手补偿留着（作者 10/29：「补偿的附赠动作直到使用掉之前一直保存着」）：每次这个角色自己的回合开始补行动点时（app.js · refreshEconomy），
 *  开战时给的补偿还剩几个——上一回合留下没用掉的附赠，最多给的那么多（附赠先用平常的，补偿的最后用）——就叠到这一回合的附赠上，一直留到用掉为止。
 *  这一回合不能行动（晕眩……）时先收着（pvpDuelHold），不给附赠、也不作废，下一个能行动的回合照样叠上 */
function pvpDuelCarry(u) {
  const d = pvpDuelState();
  if (!d || !u || !d.carry || !Object.prototype.hasOwnProperty.call(d.carry, u.id)) return 0;
  const held = !!(d.carryHeld && d.carryHeld[u.id]);
  const left = held ? Number(d.carry[u.id]) || 0 : Math.floor(Number(u.bonus) || 0);
  const n = Math.max(0, Math.min(Number(d.carry[u.id]) || 0, left));
  const next = Object.assign({}, d.carry);
  if (n > 0) next[u.id] = n; else delete next[u.id];
  d.carry = next;
  if (held) { const h = Object.assign({}, d.carryHeld); delete h[u.id]; d.carryHeld = h; }
  return n;
}
/** 这一回合不能行动：补偿先收着，下一个能行动的回合再叠上（pvpDuelCarry） */
function pvpDuelHold(u, n) {
  const d = pvpDuelState();
  if (!d || !u || !(n > 0)) return;
  d.carry = Object.assign({}, d.carry || {}, { [u.id]: n });
  d.carryHeld = Object.assign({}, d.carryHeld || {}, { [u.id]: true });
}
/** 决斗不允许起身时，决斗里的角色不能自己起身（app.js · standUpBlocked 认它）；专长「拉一把」这类别人来救的照常 */
function pvpDuelNoStand(u) {
  const d = pvpDuelState();
  return !!d && !d.stand && !!pvpDuelTeamOf(u);
}
/** 伤害不会致死（决斗）：起身中受伤把坚毅生命打到 PVP_DUEL_CFG.outShp（1）或更低时，保留 1，再起不能、移出战场。
 *  engine.js · applyResultToUnit（攻击 / 持续伤害）、app.js · applyKnockdown（坠落、窒息、高能自爆……）扣完坚毅后问这里；
 *  返回 true = 已经按决斗处理（不再判死亡） */
function pvpDuelShpFloor(u, notes) {
  if (!pvpDuelOn() || !u || !u.isPlayer || u.pvpOut || (typeof isWeaponUnit === "function" && isWeaponUnit(u)) || !pvpDuelTeamOf(u)) return false;
  if ((Number(u.shp) || 0) > PVP_DUEL_CFG.outShp) return false;
  u.shp = PVP_DUEL_CFG.outShp;
  return pvpDuelKnockOut(u, notes);
}
/** 再起不能（决斗）：这个角色移出战场——不算死亡（决斗结束后一切恢复），只是这场决斗里不再出现；武器人跟着离场，
 *  指向它的嘲讽 / 掩护 / 禁足失效（和主持人移出玩家角色一样，app.js · removeHeroUnit）。画面上弹「再起不能」，联机玩家只收到这个状态（pvpOut），
 *  不收坚毅数值。还在 state.units 里（算胜负、剩余血量百分比要用），dead / _removed 让它不再行动、不再被选中 */
function pvpDuelKnockOut(u, notes) {
  const d = pvpDuelState();
  if (!d || !u || u.pvpOut || !pvpDuelTeamOf(u) || (typeof isWeaponUnit === "function" && isWeaponUnit(u))) return false;
  if (typeof spawnPopup === "function" && !u.hidden) spawnPopup(u, { kind: "status", text: "再起不能", element: "physical" });
  u.pvpOut = true;
  u.dead = true; u.dying = false; u.upOnShp = false; u.stunned = false;
  u._removed = true;
  d.out = (d.out || []).filter(id => id !== u.id).concat([u.id]);
  const gone = new Set([u.id]);
  (state.units || []).forEach(x => { if (x !== u && x.weaponOf && x.weaponOf === u.kit && !x._removed) { x._removed = true; x.dead = true; gone.add(x.id); } });
  (state.units || []).forEach(x => {
    if (gone.has(x.tauntTo)) x.tauntTo = null;
    if (gone.has(x.coverBy)) x.coverBy = null;
    if (gone.has(x.lockdownBy)) x.lockdownBy = null;
  });
  ["selectedId", "attackerId", "targetId"].forEach(k => { if (gone.has(state[k])) state[k] = null; });
  if (notes) notes.push(`${u.name} 再起不能（决斗中伤害不会致死），移出战场。`);
  if (typeof endRallyIfCasterDown === "function") endRallyIfCasterDown(u, notes || []);
  return true;
}
/** 这一队还有没有人站着（没倒地、没再起不能、没被移走） */
function pvpDuelTeamUp(teamId) {
  return pvpDuelMembers(teamId).some(u => !u.dead && !u._removed && !u.pvpOut && !u.hidden &&
    (typeof heroStillFighting === "function" ? heroStillFighting(u) : !u.dying));
}
/** 剩余血量百分比（回合上限判胜负用）：这一队所有角色现在的血量合计 ÷ 血量上限合计。只算各层血量，不算坚毅生命；
 *  倒地的（濒死、再起不能）现在的血量按 0 算，上限照算。返回 { hp, max } */
function pvpDuelHp(teamId) {
  let hp = 0, max = 0;
  pvpDuelMembers(teamId).forEach(u => {
    max += typeof totalMaxHp === "function" ? totalMaxHp(u) : 0;
    if (!u.dead && !u.dying && !u.pvpOut && !u._removed) hp += totalHp(u);
  });
  return { hp, max };
}
/** 百分比写成文字：保留一位小数 */
function pvpDuelPctText(v) { return (Math.round((Number(v) || 0) * 1000) / 10) + "%"; }
/** 决斗分出胜负没有：一队全部倒地（含再起不能移出的），另一队获胜；两队同时全倒算平局；开了回合上限、打完了看 pvpDuelRoundLimit 记下的结果。
 *  返回 null = 不是决斗；{ over: false } = 还在打；{ over: true, winner: 队伍 id / null, draw, why: "wipe" / "rounds", pct, text } */
function pvpDuelOutcome() {
  const d = pvpDuelState();
  if (!d || !state.combatStarted) return d ? { over: false } : null;
  // 保险：没接到 pvpDuelShpFloor 的路径把决斗里的角色弄「死」了，也照再起不能算（结束后一切恢复）
  const late = [];
  PVP_DUEL_CFG.teams.forEach(t => pvpDuelMembers(t.id).forEach(u => { if (u.dead && !u.pvpOut && !u._removed) pvpDuelKnockOut(u, late); }));
  if (late.length) appendLog(late.join("\n"));
  if (!d.result) {
    // 全员倒地还能起身（#470，app.js · queueWipeStand）：回合结束前问「要不要起身」的人还没问完就先不判——分出的胜负会记下来不再改，
    // 两队同时全员倒地时不能先问的那一队一说不起身、另一队还没问就算它赢（两边都不起身是平局）
    if (state.standQueue && state.standQueue.length) return { over: false };
    const [a, b] = PVP_DUEL_CFG.teams;
    const upA = pvpDuelTeamUp(a.id), upB = pvpDuelTeamUp(b.id);
    if (upA && upB) return { over: false };
    const winner = upA ? a.id : upB ? b.id : null;
    d.result = { over: true, winner, draw: !winner, why: "wipe", pct: null };
  }
  return Object.assign({}, d.result, { text: pvpDuelResultText(d.result) });
}
/** 胜负写成一句话（战斗记录、结算面板） */
function pvpDuelResultText(r) {
  if (!r || !r.over) return "";
  const win = r.winner ? pvpDuelTeamInfo(r.winner) : null;
  const lose = win ? PVP_DUEL_CFG.teams.find(t => t.id !== win.id) : null;
  if (r.why === "rounds") {
    const pct = PVP_DUEL_CFG.teams.map(t => `${t.name} ${pvpDuelPctText((r.pct || {})[t.id])}`).join("、");
    return `回合上限：打满 ${r.rounds || ""} 回合还没分出胜负，按剩余血量百分比（${pct}）——${win ? win.name + "获胜" : "两队一样，平局"}。`;
  }
  return win ? `${win.name}获胜：${lose.name}全部倒地。` : "平局：两队同时全部倒地。";
}
/** 回合上限（app.js · turnEnd，一回合结束、下一回合开始之前）：开了「限定回合数」、打满了还没分出胜负，按剩余血量百分比判，
 *  多的一队获胜，一样算平局；这时不再开下一回合（返回 true）。这一回合结束时的结算（持续伤害……）已经算完：有一队全倒了照全倒判 */
function pvpDuelRoundLimit() {
  const d = pvpDuelState();
  if (!d || !d.rounds || !state.combatStarted || Number(state.turnNo) < d.rounds) return false;
  const now = pvpDuelOutcome();
  if (now && now.over) return true;
  const [a, b] = PVP_DUEL_CFG.teams;
  const ha = pvpDuelHp(a.id), hb = pvpDuelHp(b.id);
  // 比 ha.hp / ha.max 和 hb.hp / hb.max：交叉相乘，不用小数比（一样就是一样）
  const cmp = ha.hp * hb.max - hb.hp * ha.max;
  const winner = cmp > 0 ? a.id : cmp < 0 ? b.id : null;
  const ratio = h => h.max > 0 ? h.hp / h.max : 0;
  d.result = { over: true, winner, draw: !winner, why: "rounds", rounds: d.rounds, pct: { [a.id]: ratio(ha), [b.id]: ratio(hb) } };
  appendLog(pvpDuelResultText(d.result));
  return true;
}
/** 决斗结束后（ledger.js · ledgerAfterBattle 在决斗时只走这里）：队伍档案里参加的人的血量、坚毅生命、武器耐久盖回决斗前的样子；
 *  用掉的道具不恢复（背包照旧）。只做一次。返回 true = 是决斗、已经恢复 */
function pvpDuelRestore(notes) {
  const d = pvpDuelState();
  if (!d) return false;
  if (d.restored) return true;
  const r = d.restore || { heroes: {}, dur: {} };
  if (typeof LEDGER !== "undefined" && LEDGER) {
    LEDGER.heroes = LEDGER.heroes || {};
    Object.keys(r.heroes || {}).forEach(kit => { const v = r.heroes[kit]; if (v) LEDGER.heroes[kit] = JSON.parse(JSON.stringify(v)); else delete LEDGER.heroes[kit]; });
    LEDGER.dur = LEDGER.dur || {};
    Object.keys(r.dur || {}).forEach(k => { const v = r.dur[k]; if (v == null) delete LEDGER.dur[k]; else LEDGER.dur[k] = v; });
  }
  d.restored = true;
  if (notes) notes.push("决斗结束：血量、坚毅生命、武器耐久恢复成决斗前的样子（用掉的道具不恢复）。");
  return true;
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
/** mover 进了它现在所在的区：叫醒那一区和它敌对的休眠敌人 */
function dormantWakeIn(mover, notes) {
  if (!mover || mover.kind) return;
  (state.units || []).forEach(u => {
    if (u.dormant && !u.isPlayer && !u.dead && !u.hidden && hostileTo(u, mover) && Number(u.zone) === Number(mover.zone)) wakeDormant(u, mover, notes, `${mover.name} 进入它所在的区`);
  });
}
/** 我方单位进入某区（自己走、被推、紧追跟上……都算）：叫醒那一区休眠的敌人
 *  （app.js · doMoveInner / displaceTo / chaseFollow、灯协助格挡成功跟到进攻者那一区 performAssistBlock、夕夏回合开始跟上抓着的敌人 beginRound 调用）。
 *  这次行动里技能直接换过区、还没补算的先补上（先到的算吵醒它的人） */
function dormantAfterMove(mover, notes) {
  dormantLedgerSync(notes);
  dormantWakeIn(mover, notes);
}
/* 技能里直接改所在区的移动（突进、猛扑、逃离、燕飞、协助攻击跟到目标那一区……）不走 doMoveInner / displaceTo，以前叫不醒休眠的敌人（#379）。
 * 照驻波墙的做法（app.js · waveLedgerOpen）：一次行动（runSkill / doMove）开始时记下每个在场单位在哪一区（state._dormantLedger），
 * 出手之前（dealTo）、别的移动叫醒之前（dormantAfterMove）和行动结束时补算——换了区的单位照「进入它所在的区」叫醒那一区休眠的敌人。
 * 一起到的（带人同行、点火突进带人……）先算这次行动的出手方。只看最后到了哪一区，路上经过的区不算（和冻土、伏击一样）。
 * 场上没有休眠的敌人时什么都不记 */
function dormantLedgerOpen(actor) {
  if (state._dormantLedger || !(state.units || []).some(u => u && u.dormant && !u.isPlayer && !u.dead)) return false;
  const zones = {};
  (state.units || []).forEach(u => { if (u && u.id != null && u.zone != null && !u.dead && !u.hidden && !u.fused && !u._removed) zones[u.id] = Number(u.zone); });
  state._dormantLedger = { by: actor ? actor.id : null, zones };
  return true;
}
function dormantLedgerSync(notes) {
  const led = state._dormantLedger;
  if (!led) return;
  const out = notes || [];
  const list = (state.units || []).slice();
  const first = list.findIndex(u => u && led.by != null && u.id === led.by);
  if (first > 0) list.unshift(list.splice(first, 1)[0]);   // 出手方先算
  list.forEach(u => {
    if (!u || u.id == null) return;
    // 不在场上的不记（收回的武器人、倒下的）：再上场时从那一区重新记，不算进区
    if (u.zone == null || u.dead || u.hidden || u.fused || u._removed) { delete led.zones[u.id]; return; }
    const now = Number(u.zone), was = led.zones[u.id];
    led.zones[u.id] = now;
    if (was == null || was === now) return;   // 这次行动里才上场的（唤出、援军）不算进区
    dormantWakeIn(u, out);
  });
  if (!notes && out.length) appendLog(out.join("\n"));
}
function dormantLedgerClose(own) {
  if (!own) return;
  try { dormantLedgerSync(); } finally { state._dormantLedger = null; }
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
  // 按标定落点打，不受普通攻击射程限制（落在自己区 / 隔两个区 / 协助触发都照打）
  aa(main, { element: "acid", mult: 2, baseBreak: 2, flags: { action: true, anyRange: true } });
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
  if (raceRunSkill(id, a, t, hitOne, lines, needT, atk)) return true;   // 种族附赠（扑灭、追猎本能、威压、吐酸）

  // 赤牙：自己再出手就离开掩体（掩体撑过我方回合，到她下一次出手为止）；霰弹枪的 −40% 协助格挡只算那一枪
  if (a.kit === "chixia") {
    a.resources = a.resources || {};
    if (id !== "en_chi_cover" && a.resources.cover) {
      a.resources.cover = false;
      lines.push(`${a.name} 离开掩体。`);
    }
    if (id !== "en_chi_shot") a.blockMalus = 0;
  }
  // 暴虐猎手：斩杀那一击的协助格挡 +5% 只到它落下为止（ratExecSettle）；自己再出手时兜底清掉
  if (a.kit === "rat_tyrant") a.ratExecBlock = 0;

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
    // 借机攻击在它自己（被离开的）那一区结算：那一区的铁壁照挡（app.js · dealTo 的 wallZone）
    aa(t, { element: "physical", mult: 1, diceN: id === "en_thug_knife" ? 1 : 0, diceS: 8, baseBreak: 1,
            wallZone: opp ? a.zone : undefined, flags: opp ? { action: true, opportunity: true } : undefined });
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
    state.units.filter(u => !u.hidden && !u.dead && !u._removed && Number(u.zone) === Number(a.zone) && u.id !== a.id).forEach(u => aa(u, dmgOpt));
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
  if (id === "en_riot_baton" || id === "en_riot_baton_assist") {
    if (!needT()) return true;
    stepTowardZone(a, t.zone, id === "en_riot_baton_assist" ? { free: true } : {});
    aa(t, { element: "fire", mult: 1, diceN: 1, diceS: RIOT_CFG.baton.dice, baseBreak: RIOT_CFG.baton.baseBreak, onConnect: { instant: "melt" } });
    return true;
  }
  if (id === "en_riot_rifle" || id === "en_riot_rifle_assist") {
    if (!needT()) return true;
    const assist = id === "en_riot_rifle_assist";
    aa(t, { element: "fire", mult: assist ? RIOT_CFG.rifle.assistMult : 1, diceN: assist ? 0 : 1, diceS: assist ? 0 : RIOT_CFG.rifle.dice, baseBreak: 1, onConnect: { activate: "burn" } });
    return true;
  }
  if (id === "en_riot_bottle") {
    const fl = state.skillFlow;
    let zone = Number((fl && fl.picks && fl.picks.dest) || t && t.zone);
    if (!(zone >= 1)) { lines.push("燃烧瓶需要先选择落点区域。"); return true; }
    zone = forcedZonePick(a, zone, lines);
    a.resources = a.resources || {};
    Object.assign(a.resources, { bottleZone: zone, bottlePending: true, bottleReady: false });
    lines.push(`${a.name} 将燃烧瓶标定在 ${zone} 区。下个敌人回合落地。`);
    return true;
  }
  if (id === "en_riot_bottle_fire") {
    const zone = Number(a.resources && a.resources.bottleZone);
    if (!(zone >= 1) || !(a.resources && a.resources.bottleReady)) {
      lines.push("燃烧瓶尚未就绪。先标定区域，等到下一个敌人回合再投出。");
      return true;
    }
    // 被牵制：已经标定好的落点不在牵制者所在的区，必须重新标定
    const fz = forcedZonePick(a, zone, []);
    if (fz !== zone) {
      Object.assign(a.resources, { bottleZone: fz, bottlePending: true, bottleReady: false });
      lines.push(`${a.name} 被牵制：放弃原来的 ${zone} 区，燃烧瓶重新标定在 ${fz} 区，下个敌人回合落地。`);
      return true;
    }
    riotBottleLand(a, aa, lines);
    return true;
  }
  if (id === "en_riot_spray" || id === "en_riot_spray_assist") {
    if (!needT()) return true;
    stepTowardZone(a, t.zone, id === "en_riot_spray_assist" ? { free: true } : {});
    riotSpray(a, t, aa);
    return true;
  }
  if (id === "en_riot_pistol" || id === "en_riot_pistol_assist") {
    if (!needT()) return true;
    const assist = id === "en_riot_pistol_assist";
    aa(t, { element: "fire", mult: assist ? RIOT_CFG.captain.assistMult : 1, diceN: assist ? 0 : 1, diceS: assist ? 0 : RIOT_CFG.captain.dice, baseBreak: 1, onConnect: { burn: RIOT_CFG.captain.burn } });
    return true;
  }
  // —— 下水道狂鼠（docs/ratfolk.md 第 3 节；RAT_CFG）——
  if (id === "en_rat_lurker_bite" || id === "en_rat_lurker_assist") {
    // 潜藏者：近距 1×atk + 1d6 物理、1 击破、腐蚀（打中才上）；协助同普通攻击，打完进入狂暴
    if (!needT()) return true;
    const assist = id === "en_rat_lurker_assist";
    if (!assist) stepTowardZone(a, t.zone);
    aa(t, { element: "physical", mult: 1, diceN: baseDice[0] || 1, diceS: baseDice[1] || 6, baseBreak: 1, onConnect: { status: "corr" } });
    if (assist && typeof enterFrenzy === "function") enterFrenzy(a, lines, "协助");
    return true;
  }
  if (id === "en_rat_biter_bite" || id === "en_rat_biter_assist") {
    // 撕咬者：近距 1×atk + 1d6 物理、1 击破、出血；狂暴时两次 0.5×atk、每一击都出血；协助同普通攻击，打完进入狂暴
    if (!needT()) return true;
    const assist = id === "en_rat_biter_assist";
    if (!assist) stepTowardZone(a, t.zone);
    aa(t, ratBiterAttack(a, baseDice));
    if (assist && typeof enterFrenzy === "function") enterFrenzy(a, lines, "协助");
    return true;
  }
  if (id === "en_rat_plague_claw" || id === "en_rat_plague_spray") {
    // 疫病暴徒：感染撕扯（近距物理）/ 感染喷洒（远距酸），1×atk + 1d8、1 击破、腐蚀；
    // 目标原本已经腐蚀：撕扯给自己回 10% 最大生命，喷洒把腐蚀扩散到目标同区的所有敌人（都在打中时结算：app.js · runOnConnect）
    if (!needT()) return true;
    const claw = id === "en_rat_plague_claw";
    if (claw) stepTowardZone(a, t.zone);
    const was = ratCorroded(t);
    const extra = !was ? {} : claw ? { selfHeal: RAT_CFG.plague.clawHeal } : { corrSpread: true };
    aa(t, { element: claw ? "physical" : "acid", mult: 1, diceN: baseDice[0] || 1, diceS: baseDice[1] || 8, baseBreak: 1, onConnect: Object.assign({ status: "corr" }, extra) });
    return true;
  }
  if (id === "en_rat_plague_assist") {
    // 冲到目标所在区，1.5×atk 酸、腐蚀；目标原本已经腐蚀：伤害 +2d8，自己回 25% 最大生命
    if (!needT()) return true;
    stepTowardZone(a, t.zone, { free: true });
    const P = RAT_CFG.plague, was = ratCorroded(t);
    aa(t, { element: "acid", mult: P.assistMult, diceN: was ? P.assistDice[0] : 0, diceS: was ? P.assistDice[1] : 0, baseBreak: 1,
      onConnect: Object.assign({ status: "corr" }, was ? { selfHeal: P.assistHeal } : {}) });
    return true;
  }
  if (id === "en_rat_tyrant_bite") {
    // 暴虐猎手：近距 1×atk + 1d8 物理、1 击破、出血
    if (!needT()) return true;
    stepTowardZone(a, t.zone);
    aa(t, ratTyrantBite(baseDice));
    return true;
  }
  if (id === "en_rat_tyrant_assist") {
    // 冲到目标所在区，连打三次 0.5×atk 物理，每一击都出血（第 2、3 次照 BLEED 减半），然后让所有狂鼠进入狂暴
    if (!needT()) return true;
    stepTowardZone(a, t.zone, { free: true });
    const T = RAT_CFG.tyrant;
    aa(t, { element: "physical", mult: T.assistMult, hits: T.assistHits, baseBreak: 1, breakOnce: true, bleed: true });
    ratFrenzyAll(a, lines, `${a.name}协助`);
    return true;
  }
  // —— 下水道维护（docs/sewer-maintenance.md 第 2 节；SEWER_CFG）——
  if (id === "en_sweeper_reso") {
    // 下水道清扫机：给一个没有共振的敌人施加共振，只上状态、不造成伤害（射程照一般远程）
    if (!needT()) return true;
    sweeperApplyReso(a, t, lines);
    return true;
  }
  if (id === "en_sweeper_shot") {
    // 所有敌人都有共振时：远程 1×atk + 1d4 谐波，1 击破
    if (!needT()) return true;
    const C = SEWER_CFG.sweeper;
    aa(t, { element: "harmonic", mult: C.shotMult, diceN: baseDice[0] || 1, diceS: baseDice[1] || 4, baseBreak: C.shotBreak });
    return true;
  }
  if (id === "en_sweeper_assist") {
    // 协助：自爆——冲到目标所在区，同区所有和它敌对的单位 1×atk 火、1 击破，然后自己死亡（sweeperSelfDestruct）
    if (!needT()) return true;
    sweeperSelfDestruct(a, t, lines, aa);
    return true;
  }
  if (id === "en_keeper_shot" || id === "en_keeper_assist") {
    // 触灵维护员：远程 1×atk + 1d4 电击、1 击破；协助一样，打中再施加感电
    if (!needT()) return true;
    const C = SEWER_CFG.keeper;
    aa(t, { element: "electric", mult: C.shotMult, diceN: baseDice[0] || 1, diceS: baseDice[1] || 4, baseBreak: C.shotBreak,
      onConnect: id === "en_keeper_assist" ? { status: "shock" } : undefined });
    return true;
  }
  if (id === "en_cleaner_wave" || id === "en_cleaner_assist") {
    // 触灵清扫员：普通攻击打远程射程内敌人最多的一区（AI 在 picks.dest 里选好；主持人选了目标就打目标所在区；都没有就自己挑）；
    // 协助和普通攻击一样，打失衡的人所在的区
    const fl = state.skillFlow;
    const assist = id === "en_cleaner_assist";
    let zone = assist ? Number(t && t.zone) : Number((fl && fl.picks && fl.picks.dest) || (t && t.zone) || cleanerWaveZone(a));
    if (!(zone >= 1)) { lines.push(assist ? "先在「技能目标」里选对象。" : `${a.name} 的远程射程内没有敌人。`); return true; }
    if (!assist) zone = forcedZonePick(a, zone, lines);
    if (!enemyZoneInRange(a, id, zone)) {
      const why = typeof lineBlocked === "function" && lineBlocked(a.zone, zone);
      lines.push(why ? `${a.name} 打不到 ${zone} 区：${why}` : `${a.name} 的谐波是远距离，打不到距离 ${zoneDist(a.zone, zone, state.zoneMode)} 的 ${zone} 区。`);
      return true;
    }
    cleanerWave(a, zone, aa, lines);
    return true;
  }
  if (id === "en_sewer_cleanse") {
    // 附赠·清除状态：清掉一种负面状态（维护员清完给自己永续的振奋）
    sewerCleanse(a, lines);
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
    aa(t, { element: "ice", mult: 0, diceN: n, diceS: 6, baseBreak: 1, wallZone: a.zone, flags: { action: true, opportunity: true } });   // 在它那一区结算，那一区的铁壁照挡
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
      // 背水一战（夕夏起身中）：反击的 1 击破不扣架势（engine.js · xiaBackwater，#546）
      if (typeof xiaBackwaterBlocks === "function" && xiaBackwaterBlocks(t, lines, "牛协助格挡反击的 1 击破无效")) return true;
      t.def = Math.max(0, (t.def || 0) - 1);
      if (t.def <= 0) {
        t.stunned = true;
        lines.push(imbalanceLine(t));
        if (typeof endRallyIfCasterDown === "function") endRallyIfCasterDown(t, lines);
      }
      lines.push(`成功：自身架势至少留 1，反击 1 击破 → ${t.name} 架势 ${t.def}`);
    }
    return true;
  }
  if (id === "en_liz") {
    if (!needT()) return true;
    aa(t, { element: "acid", mult: 1, diceN: addedDiceByLevel(a.level), diceS: 6, baseBreak: 2 });
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
      u.summonedBy = a.id;   // 召唤物战后不掉材料（rogue.js · rollMaterialDrops）
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
      // 背水一战（夕夏起身中）：被流沙困住是失衡（失去行动），起身中的夕夏不会失衡（engine.js · xiaBackwater，#546）
      if (typeof xiaBackwaterBlocks === "function" && xiaBackwaterBlocks(u, lines, "流沙漩涡困不住")) return;
      u.stunned = true;
      lines.push(`${u.name} 被流沙困住，无法行动。`);
      if (typeof endRallyIfCasterDown === "function") endRallyIfCasterDown(u, lines);
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
    const landed = [];   // 这一击真正打中的人（死亡 / 倒地 / 隔着危墙没打到的不算）
    hit.forEach(u => {
      if (u.dead || (typeof isDownProtected === "function" && isDownProtected(u))) return;
      const out = aa(u, { element: "electric", mult: pb ? 0.6 : 1, diceN: 1, diceS: (typeof leveledSides === "function" ? leveledSides(a.level, 6) : 6), baseBreak: 1, flags: { action: true, aoe: true } });
      if (enemyHitLanded(out)) landed.push(u);
    });
    // 手册：可对一人施加感电。只从打中的人里挑一个还没有感电的目标（被牵制时先给牵制者）。
    const pick = (pb && landed.includes(forced) ? forced : null) || landed.find(u => !(u.statuses && u.statuses.shock)) || landed[0];
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
    // 被牵制而牵制者就在同区：抵近喷洒打自己所在的区，倍率 ×0.6（和电弧扫射一致）
    const forced = enemyForcedTarget(a);
    const pb = zoneDist(a.zone, z, state.zoneMode) === 0 && enemyForcedPointBlank(a, forced);
    if (pb) lines.push(`${a.name} 被 ${forced.name} 牵制：喷洒抵近打自己所在的 ${z} 区（倍率 ×0.6）。`);
    standingPlayersIn(z).forEach(u => {
      aa(u, { element: "acid", mult: pb ? 0.6 : 1, diceN: 1, diceS: (typeof leveledSides === "function" ? leveledSides(a.level, 6) : 6), baseBreak: 0,
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
      // 背水一战（夕夏起身中）：擒拿是让人失衡（失去下回合行动），起身中的夕夏不会失衡（engine.js · xiaBackwater，#546）
      if (typeof xiaBackwaterBlocks === "function" && xiaBackwaterBlocks(t, lines, "强盗头子擒拿无效")) return true;
      t.stunned = true;
      lines.push("强盗头子擒拿成功，目标失去下回合行动。");
      if (typeof endRallyIfCasterDown === "function") endRallyIfCasterDown(t, lines);
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
      wall.ownerKit = a.kit;   // 墙护着王这一伙（按阵营判断，app.js · barrierGuards）：三方混战里不护和盗匪敌对的安保 / 警卫队
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
    const list = primed ? standingPlayersIn(t.zone) : [t];
    list.forEach(u => {
      const had = u.statuses && u.statuses.burn;
      grantBurn(u, 1, lines);   // 自焚免疫等照常生效
      if (u.statuses && u.statuses.burn !== had) lines.push(`${u.name} 灼烧。`);
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
/** 电能炮开完：机体过热，给自己上熔融。和别的即时效果一样按施加时是谁的回合算（app.js · markTurnFx，#482）：在敌人回合开始时开炮，
 *  正好持续到下一个我方回合结束（下一个敌人回合开始时失效）。以前另记 meltHoldTurn，实际撑到再下一个整轮开始 */
function aggOverheat(boss, m, notes) {
  if (!boss || boss.dead) return;
  boss.instant = boss.instant || {};
  if (typeof markTurnFx === "function") markTurnFx(boss, "melt", boss);
  boss.instant.melt = true;
  boss.resources = boss.resources || {};
  boss.resources.overheatTurn = Number(state.turnNo) || 1;   // 开炮的回合：只用来显示「过热」（aggOverheated）
  notes.push(`${boss.name} 开炮后机体过热：自身熔融（冰伤害 ×2、物理打装甲 +50%），持续到下一个我方回合结束。`);
}
/** 状态栏的「过热」（app.js · statusLine）：开炮后的熔融还在，从开炮那一回合的敌人回合起，到下一个我方回合结束 */
function aggOverheated(u) {
  const t = Number(u && u.resources && u.resources.overheatTurn) || 0, now = Number(state.turnNo) || 0;
  if (!t || !(u.instant && u.instant.melt)) return false;
  return now === t || (now === t + 1 && !(typeof lateRoundNow === "function" && lateRoundNow()));
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
function applyEnemyIV(u, iv, race) {
  applyEnemyRace(u, race);   // 先种族、再个体值（个体值按套完种族之后的数值算）
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

/* ===== 敌人种族（docs/enemy-race.md） =====
 * 有机体的敌人有种族，记在 u.race = { race, branch }（branch 可空）。
 * 每个敌人的种族写在 run.js · ENEMY_INFO 上（格式见那里的注释）：固定写 race: "兽人·牛"，随机写 races: [{ race, w }] 权重表。
 * ENEMY_INFO 上有 raceAttrs: true 的敌人（随机种族的盗匪、燃气收集机；固定种族里只有下水道的狂鼠，docs/ratfolk.md），
 * 再按种族的六维修正换算数值（和个体值一样，生成时算一次）：
 *   体质只加在最内层的肉体；力量改 atk / personalAtk；耐力改架势；敏捷只改本来会格挡的敌人（u.raceBlock）。
 * u.raceDelta 记着加了多少，改种族时先减掉再加（按原始数值重算）。
 * ENEMY_IV.off > 0（BattleSim.setup 默认）时随机种族一律当人类（人类对敌人没有数值变化）；固定种族、主持人指定的种族不受影响 */
const ENEMY_RACES = {
  "人类":   { mods: { wil: 1, int: 1 } },
  "红皮人": { mods: { str: 1, con: 1, dex: -1 } },
  "犬类人": { mods: { con: 1, dex: 1 }, branches: ["狼", "狐", "犬"] },
  "猫类人": { mods: { dex: 1, int: 1, con: -1 }, branches: ["豹", "虎", "猫"] },
  "鼠类人": { mods: { dex: 1, int: 1, con: -1, sta: -1 }, branches: ["鼠", "兔"] },
  // 牛类人的三个小分支六维修正各不相同（分支的修正盖过大支的）
  "牛类人": { mods: {}, branches: ["牛", "马", "羊"], branchMods: {
    "牛": { str: 2, sta: 1 }, "马": { str: 1, dex: 1, sta: 1 }, "羊": { str: 1, wil: 1, int: 1 } } },
  // 兽人五支的六维修正完全一样
  "兽人":   { mods: { con: 1, sta: 1, int: 1 }, branches: ["狼", "牛", "蜥蜴", "猫", "熊"] },
  // 触灵（docs/sewer-maintenance.md 第 1 节）：机甲触灵、飞碟触灵、下水道维护的两个触灵精英；没有六维修正，暂时没有种族被动（RACE_PERKS 里不写）
  "触灵":   { mods: {} }
};
/** 「类人」是四个大支的统称（主持人指定 / 权重表里可以只写「类人」，大支各占一份） */
const ENEMY_RACE_GROUPS = { "类人": ["犬类人", "猫类人", "鼠类人", "牛类人"] };
/** 不在 ENEMY_INFO 里（不进随机遭遇）的敌人的种族 */
const ENEMY_RACE_EXTRA = {
  chixia: { race: "犬类人·狼" },   // 赤牙：手册第九章「狼类人」
  ufo_body: { race: "触灵" }       // 飞碟触灵本体（ENEMY_INFO 里登记的是 ufo_boss；机械足是部件，不挂种族）
};

/** "兽人·牛" / { race, branch } → { race, branch? }；认不得的返回 null */
function raceParse(x) {
  if (!x) return null;
  let race, branch;
  if (typeof x === "string") { const i = x.indexOf("·"); race = i < 0 ? x : x.slice(0, i); branch = i < 0 ? "" : x.slice(i + 1); }
  else if (typeof x === "object") { race = x.race; branch = x.branch || ""; }
  race = String(race || "").trim(); branch = String(branch || "").trim();
  if (!race) return null;
  if (ENEMY_RACE_GROUPS[race]) return branch ? null : { race };
  const def = ENEMY_RACES[race];
  if (!def) return null;
  if (branch && !(def.branches || []).includes(branch)) return null;
  return branch ? { race, branch } : { race };
}
function raceLabel(r) {
  return r && r.race ? (r.branch ? r.race + "·" + r.branch : r.race) : "";
}
const _pickOne = (list) => list[Math.floor(Math.random() * list.length)];
/** 把 { race }（可能是「类人」或没写小分支的大支）补成具体的 { race, branch? } */
function raceResolve(spec) {
  let race = spec.race, branch = spec.branch;
  if (ENEMY_RACE_GROUPS[race]) race = _pickOne(ENEMY_RACE_GROUPS[race]);
  const def = ENEMY_RACES[race];
  if (!branch && def.branches) branch = _pickOne(def.branches);
  return branch ? { race, branch } : { race };
}
/** 从权重表抽一个（先按权重选条目，再把大支补成小分支） */
function raceRoll(table) {
  const rows = (table || []).filter(r => Number(r.w) > 0 && raceParse(r.race));
  if (!rows.length) return { race: "人类" };
  let n = Math.random() * rows.reduce((s, r) => s + Number(r.w), 0), pick = rows[rows.length - 1];
  for (const r of rows) { n -= Number(r.w); if (n < 0) { pick = r; break; } }
  return raceResolve(raceParse(pick.race));
}
/** 这个敌人的种族配置：{ fixed, attrs } / { table, attrs } 或 null（无种族） */
function enemyRaceInfo(u) {
  if (!u || u.isPlayer || !u.kit) return null;
  const info = (typeof ENEMY_INFO !== "undefined" && ENEMY_INFO[u.kit]) || ENEMY_RACE_EXTRA[u.kit];
  if (!info) return null;
  if (info.race) return { fixed: info.race, attrs: !!info.raceAttrs };   // 固定种族一般不套六维（下水道的狂鼠特意套）
  if (Array.isArray(info.races) && info.races.length) return { table: info.races, attrs: !!info.raceAttrs };
  return null;
}
/** 种族的六维修正（小分支的修正盖过大支） */
function raceMods(r) {
  const def = r && ENEMY_RACES[r.race];
  if (!def) return {};
  return (r.branch && def.branchMods && def.branchMods[r.branch]) || def.mods || {};
}
/** 「全 5 + 修正」比「全 5」多出来的数值（growth.js · derivedFromAttrs 的差值）。blocks：这个敌人会格挡 */
function raceDelta(r, level, blocks) {
  const mods = raceMods(r), base = { str: 5, con: 5, dex: 5, wil: 5, int: 5, sta: 5 }, plus = Object.assign({}, base);
  Object.keys(mods).forEach(k => { plus[k] += mods[k]; });
  const a = derivedFromAttrs(base, level), b = derivedFromAttrs(plus, level);
  return {
    hp: b.hp - a.hp, atk: b.personalAtk - a.personalAtk, def: b.def - a.def,
    block: blocks ? bareBlockFromDex(plus.dex) - bareBlockFromDex(5) : 0
  };
}
function _raceAdd(u, d, sign) {
  const last = u.layers ? u.layers.length - 1 : -1;
  if (last >= 0 && d.hp) {
    const l = u.layers[last], oldMax = Number(l.max) || 0, cur = Number(l.current) || 0;
    l.max = Math.max(1, oldMax + sign * d.hp);
    l.current = cur >= oldMax ? l.max : Math.max(0, Math.min(l.max, cur + sign * d.hp));
    if (u.ivBase && u.ivBase.max && u.ivBase.max[last] != null) u.ivBase.max[last] = Math.max(1, u.ivBase.max[last] + sign * d.hp);
  }
  if (d.atk) {
    u.atk = (Number(u.atk) || 0) + sign * d.atk;
    if (u.personalAtk != null) u.personalAtk = (Number(u.personalAtk) || 0) + sign * d.atk;
    if (u.ivBase) { u.ivBase.atk += sign * d.atk; if (u.ivBase.personalAtk != null) u.ivBase.personalAtk += sign * d.atk; }
  }
  if (d.def) { u.defMax = Math.max(0, (Number(u.defMax) || 0) + sign * d.def); u.def = Math.max(0, Math.min(u.defMax, (Number(u.def) || 0) + sign * d.def)); }
  if (d.block) u.raceBlock = (u.raceBlock || 0) + sign * d.block;
}
/** 定种族（生成 / 主持人改）：先减掉旧种族加的数值，再按新种族加。个体值已经有了的，按新的原始数值重算。
 *  attrs：要不要套六维，不写就看 ENEMY_INFO.raceAttrs */
function setEnemyRace(u, race, attrs) {
  const r = raceParse(race);
  if (!u || !r) return u;
  const res = raceResolve(r);
  if (u.raceDelta) { _raceAdd(u, u.raceDelta, -1); delete u.raceDelta; }
  if (!u.raceBlock) delete u.raceBlock;
  u.race = res;
  const info = enemyRaceInfo(u);
  if (attrs === undefined) attrs = !!(info && info.attrs);
  if (attrs) {
    const blocks = typeof blockChanceRaw === "function" && blockChanceRaw(u) != null;
    const d = raceDelta(res, u.level, blocks);
    _raceAdd(u, d, 1);
    u.raceDelta = d;
  }
  if (u.iv && ivEligible(u)) setEnemyIV(u, u.iv);
  return u;
}
/** 生成时调用：race 写了（字符串 / { race, branch }）照写，没写的按 ENEMY_INFO 的配置：固定的照固定，随机的抽。
 *  ENEMY_IV.off > 0 时随机种族当人类（不抽、不动数值） */
function applyEnemyRace(u, race) {
  if (!u || u.race) return u;
  const info = enemyRaceInfo(u);
  if (!info) return u;
  if (race && raceParse(race)) return setEnemyRace(u, race);
  if (info.fixed) return setEnemyRace(u, info.fixed, info.attrs);
  if (ENEMY_IV.off > 0) { u.race = { race: "人类" }; return u; }
  return setEnemyRace(u, raceRoll(info.table));
}
/** 画面用：「红皮人」「兽人·牛」；没有种族是空串 */
function raceText(u) { return u && u.race ? raceLabel(u.race) : ""; }

/* ===== 种族被动（docs/enemy-race.md 第 4 节） =====
 * 照搬角色的种族特长 / 缺陷，按 u.race 通用生效（不看具体兵种）；角色也走同一份（racePerkKey 把 "兽人-蜥蜴" 这样的写法归一成 "兽人·蜥蜴"）。
 * 数值放 RACE_PERK，各被动的开关和说明放 RACE_PERKS。
 * RACE_PERK.off > 0 时敌人的种族被动全部不生效（种族、六维换算照旧）：只给平衡模拟工具用（tools/enemy-balance.js），默认 0 = 开，游戏里不碰 */
const RACE_PERK = {
  off: 0,                 // 工具用的总开关（照 ENEMY_IV.off 的写法）：> 0 = 关掉敌人的种族被动
  fireCut: 0.25,          // 红皮人·热耐性：受火伤 −25%（和克制表加算）
  energyUp: 0.25,         // 兽人·蜥蜴·鳞片：受能量伤害 +25%
  loneWolfDiv: 2,         // 犬类人·狼·独狼：atk ± 等级 ÷ 2（向下取整）
  loneWolfMates: 2,       // 区里有这么多名及以上队友就是减
  swiftRecover: 1,        // 猫类人·豹·迅袭：每次移动回的架势
  swiftBreak: 1,          // 猫类人·豹·迅袭：整场第一个行动的第一击 +击破
  aweChance: 0.5,         // 猫类人·虎·威压：敌人的威吓检定成功率
  fieldImmune: 0.5,       // 鼠类人·鼠·环境适应：每次受到场地伤害 / 场地击破，这个概率完全免疫（作者 10/21 定）
  firstBonus: 1,          // 牛类人·马·千里马：第一回合 +附赠
  rageHpPct: 0.5,         // 兽人·牛·易怒蛮牛：血量低于这个比例时受伤会失控
  rageBreak: 1,           // 兽人·牛·易怒蛮牛：冲撞的击破
  spitMult: 1,            // 兽人·蜥蜴·吐酸：倍率
  breakCap: 2,            // 兽人·猫·灵巧：一回合最多失去的架势
  distractTurns: 1,       // 兽人·猫·注意力涣散：连续打同一个目标超过这么多回合
  distractCut: 0.25       // 兽人·猫·注意力涣散：伤害 −
};
const RACE_PERKS = {
  "人类":      { reroll: true, text: "迎难直上：检定失败时重掷一次" },
  "红皮人":    { fireCut: true, snuff: true, text: "热耐性：受火伤 −25%；附赠扑灭身上的灼烧" },
  "犬类人·狼": { loneWolf: true, text: "独狼：同区没有队友时 atk + 等级÷2，有两名及以上队友时 atk − 等级÷2" },
  "猫类人·豹": { swift: true, text: "迅袭：每次移动回 1 架势；整场第一个行动的第一击 +1 击破" },
  "猫类人·虎": { awe: true, text: "威压：附赠，对近距一人威吓（50% 成功），成功施加不稳" },
  "鼠类人·鼠": { fieldCut: true, text: "环境适应：场地伤害、冻土击破 50% 概率免疫" },
  "牛类人·马": { firstBonus: true, text: "千里马：第一回合 +1 附赠" },
  "兽人·狼":   { hunt: true, text: "追猎本能：附赠，对一个敌人施加紧追" },
  "兽人·牛":   { rage: true, text: "易怒蛮牛（缺陷）：血量低于 50% 时受到任何伤害，会失去附赠、冲到另一个区、对随机一个目标造成 1 击破；每回合最多一次，晕眩 / 失衡时不发作（打出失衡后接着来的协助攻击也算这次失衡）" },
  "兽人·蜥蜴": { spit: true, energyUp: true, text: "吐酸：附赠，近距 1×atk 酸，每场一次；鳞片（缺陷）：受能量伤害 +25%" },
  "兽人·猫":   { breakCap: true, distract: true, text: "灵巧：一回合最多失去 2 架势；注意力涣散（缺陷）：不止一个目标可选时，连续超过 1 回合打同一个目标，伤害 −25%" },
  "兽人·熊":   { text: "重装操作、嗜睡（战斗里不生效，只记在资料里）" }
};
/** 种族的归一写法："兽人·蜥蜴"。敌人看 u.race；角色看 HERO_PROFILES（"兽人-蜥蜴"，武器人不算） */
function racePerkKey(u) {
  if (!u) return "";
  if (u.race && u.race.race) return raceLabel(u.race);
  if (u.isPlayer && !u.weaponOf && u.kit && typeof heroProfile === "function") {
    const r = (heroProfile(u.kit) || {}).race;
    return r ? String(r).replace("-", "·") : "";
  }
  return "";
}
/** 这个单位的种族被动配置（没有就是 null）。大支的被动写在大支名下（人类、红皮人），小分支写 "大支·小分支" */
function racePerk(u) {
  const k = racePerkKey(u);
  return RACE_PERKS[k] || RACE_PERKS[k.split("·")[0]] || null;
}
/** 画面用：这个种族的被动说明，一行一条 */
function racePerkLinesFor(label) {
  const k = String(label || "").trim();
  const p = RACE_PERKS[k] || RACE_PERKS[k.split("·")[0]];
  return p && p.text ? [p.text] : [];
}
function racePerkLines(u) { return racePerkLinesFor(racePerkKey(u)); }

/** 敌人的种族被动配置（只认 u.race；角色走各自的实现）。RACE_PERK.off（工具用）打开时一律没有 */
function enemyRacePerk(u) { return u && u.race && !(RACE_PERK.off > 0) ? racePerk(u) : null; }

/** 种族对「受到某属性伤害」的百分比修正：[{ value, reason }]（engine.js · resolveAttack 和 matchup.js 的克制表共用）。
 *  角色的鳞片还是走 engine / matchup 里原来那一行，这里只管 u.race 的敌人，数值同一份 RACE_PERK */
function raceDefendMods(u, el) {
  const out = [];
  const p = enemyRacePerk(u);
  if (!p) return out;
  if (p.fireCut && el === "fire") out.push({ value: -RACE_PERK.fireCut, reason: `热耐性（${racePerkKey(u)}）：火焰受伤 −${Math.round(RACE_PERK.fireCut * 100)}%。` });
  if (p.energyUp && el === "energy") out.push({ value: RACE_PERK.energyUp, reason: `鳞片（${racePerkKey(u)}）：能量受伤 +${Math.round(RACE_PERK.energyUp * 100)}%。` });
  return out;
}

/** 是不是同一边的友方单位：同阵营，或者是它召唤的 / 召唤它的；配置物、中立生物不算 */
function raceMateOf(u, x) {
  if (!u || !x || x === u || x.dead || x.hidden || x._removed || x.fused || x.kind || x.isProp || x.isStructure || x.kit === "ironwall") return false;
  if (!!x.isPlayer !== !!u.isPlayer) return false;
  if (typeof isNeutralCreature === "function" && isNeutralCreature(x)) return false;
  if (x.summonedBy === u.id || u.summonedBy === x.id) return true;
  return factionOf(x) === factionOf(u);
}
/** 同区的队友数（独狼） */
function raceMateCount(u, units) {
  return (units || state.units || []).filter(x => Number(x.zone) === Number(u.zone) && raceMateOf(u, x)).length;
}
/** 独狼：effectiveAtk（party.js）加上这个数。没有队友 +，两名及以上 −，一名不变 */
function raceAtkAdjust(u, units) {
  const p = enemyRacePerk(u);
  if (!p || !p.loneWolf) return 0;
  const n = raceMateCount(u, units), d = Math.floor((Number(u.level) || 1) / RACE_PERK.loneWolfDiv);
  return n === 0 ? d : n >= RACE_PERK.loneWolfMates ? -d : 0;
}

/** 种族给检定带来的：{ reroll }（迎难直上）。角色的检定走 party.js · checkPerksFor，敌人走这里 */
function raceCheckPerks(u) {
  const p = u && !u.isPlayer ? enemyRacePerk(u) : null;
  return { adv: false, dis: false, reroll: !!(p && p.reroll), softFail: false, text: p && p.reroll ? p.text : "" };
}

/** 环境适应（鼠类人·鼠）：这一次场地效果是否被完全免疫（每次单独掷 RACE_PERK.fieldImmune） */
function raceFieldImmune(u) {
  const p = enemyRacePerk(u);
  return !!(p && p.fieldCut && Math.random() < RACE_PERK.fieldImmune);
}
/** 场地伤害经过种族（环境适应）：被免疫返回 0，否则原样返回 */
function raceFieldDamage(u, dmg) {
  if (!(dmg > 0)) return dmg;
  return raceFieldImmune(u) ? 0 : dmg;
}

/** 迅袭「整场第一个行动」：做过任何行动（移动、攻击、种族附赠）就记下 */
function raceMarkActed(u) { if (u && u.race) u.raceActed = true; }
/** 迅袭：整场第一个行动里，第一击 +击破（dealTo 传给 resolveAttack 的 firstBreak） */
function raceFirstBreak(u) {
  const p = enemyRacePerk(u);
  return p && p.swift && !u.raceActed ? RACE_PERK.swiftBreak : 0;
}
/** 迅袭：每次移动回架势。doMove 成功之后调用 */
function raceAfterMove(u, notes) {
  const p = enemyRacePerk(u);
  if (!p || !p.swift) return;
  raceMarkActed(u);
  if (u.dead || u.noPosture || u.stunned) return;
  const max = Number(u.defMax) || 0, cur = Number(u.def) || 0;
  if (cur >= max) return;
  u.def = Math.min(max, cur + RACE_PERK.swiftRecover);
  if (notes) notes.push(`迅袭：${u.name} 移动回 ${RACE_PERK.swiftRecover} 架势 → ${u.def}。`);
}

/** 千里马：第一回合 +附赠（refreshEnemyEconomy 调用，返回要加的数量）。顺便数这个敌人经历了几个自己的回合 */
function raceBonusExtra(u) {
  if (!u || !u.race) return 0;
  u.raceRounds = (u.raceRounds || 0) + 1;
  const p = enemyRacePerk(u);
  return p && p.firstBonus && u.raceRounds === 1 ? RACE_PERK.firstBonus : 0;
}

/** 灵巧：一回合最多失去的架势（没有就是 null）。engine.js · applyResultToUnit 读 */
function raceBreakCap(u) {
  const p = enemyRacePerk(u);
  return p && p.breakCap ? RACE_PERK.breakCap : null;
}

/** 注意力涣散：这次攻击打 t 是不是「连续超过 N 回合打同一个目标」（不止一个目标可选才算）。只读，不记录 */
function raceDistracted(a, t) {
  const p = enemyRacePerk(a);
  if (!p || !p.distract || !t || t === a) return false;
  const rec = a.raceFocus;
  if (!rec || rec.id !== t.id) return false;
  const now = Number(state.turnNo) || 0;
  const streak = rec.round === now ? rec.streak : (rec.round === now - 1 ? rec.streak + 1 : 1);
  if (streak <= RACE_PERK.distractTurns) return false;
  return hostilesOf(a).filter(x => !x.kind && !x.isProp && !x.dying).length > 1;
}
/** 攻击者一侧的种族修正：[{ value, reason }]（注意力涣散） */
function raceAttackMods(a, t) {
  return raceDistracted(a, t) ? [{ value: -RACE_PERK.distractCut, reason: `注意力涣散（${racePerkKey(a)}）：连续打同一个目标，伤害 −${Math.round(RACE_PERK.distractCut * 100)}%。` }] : [];
}
/** 记下这次攻击打了谁（dealTo 结算后调用；同一回合打几次只算一回合） */
function raceNoteAttack(a, t) {
  const p = enemyRacePerk(a);
  if (!p || !p.distract || !t || t === a || t.kind) return;
  const now = Number(state.turnNo) || 0, rec = a.raceFocus;
  if (rec && rec.id === t.id) {
    if (rec.round === now - 1) a.raceFocus = { id: t.id, round: now, streak: rec.streak + 1 };
    else if (rec.round !== now) a.raceFocus = { id: t.id, round: now, streak: 1 };
  } else a.raceFocus = { id: t.id, round: now, streak: 1 };
}

/** 易怒蛮牛「一击」的暂存：dealTo 期间（depth > 0）受伤只记下来，等这一击（主伤害 + 高压场地等连带伤害）全部结算完再判。
 *  这一击里任何一段把它打进失衡 / 晕眩（含首领立刻恢复架势的 result.broke），整击都不发作、也不占这回合的次数。
 *  只是结算过程中的临时值，不进 state（不进存档 / 撤销） */
var RAGE_HOLD = { depth: 0, pending: [], assistOf: null };

function rageBlocked(target, result) {
  // 首领架势规则的精英牛被打进失衡、立刻恢复后，finishAssist 正在结算的、以这只牛为目标的那次协助攻击里打到它的每一下
  // （含冷气注射等不带 assist 的连带伤害）都算这次失衡的一部分，和 lv 5 的牛一样不发作。
  // 不看 flags.assist / _bossAssistWindow：窗口可能没人关，全反击 / 防守反击 / 支援也带 assist
  const assistOfBreak = !!(RAGE_HOLD.assistOf && RAGE_HOLD.assistOf === target);
  return !!(target.stunned || (!target.noPosture && Number(target.def) <= 0) || (result && result.broke) || assistOfBreak);
}

/** 易怒蛮牛：血量低于一半时受到任何伤害 → 失去附赠、冲到另一个区、对随机一个目标造成击破。applyCombat 末尾调用。
 *  每回合最多一次（raceRageUsed，beginRound 清掉）；晕眩 / 失衡时不发作；dealTo 里的伤害等整击结算完再判（raceRageFlush） */
function raceAfterHurt(target, result, attacker, notes) {
  const p = enemyRacePerk(target);
  if (!p || !p.rage || target.dead || target.hidden) return;
  if (!((Number(result && result.total) || 0) > 0 || (Number(result && result.shpDealt) || 0) > 0)) return;
  if (RAGE_HOLD.depth > 0) {
    let rec = RAGE_HOLD.pending.find(r => r.target === target);
    if (!rec) RAGE_HOLD.pending.push(rec = { target, broke: false });
    if (rageBlocked(target, result)) rec.broke = true;
    return;
  }
  if (rageBlocked(target, result)) return;
  raceRageGo(target, notes);
}

/** 暂存期间别的结算（bossQuickRecover：纯击破那一段打进失衡、首领立刻恢复）告诉暂存「这只牛这一击打出了失衡」。只管当前这一击 */
function raceRageMarkBroke(u) {
  if (RAGE_HOLD.depth <= 0 || !u) return;
  let rec = RAGE_HOLD.pending.find(r => r.target === u);
  if (!rec) RAGE_HOLD.pending.push(rec = { target: u, broke: false });
  rec.broke = true;
}

/** 最外层 dealTo 结束：判暂存的易怒蛮牛。返回要追加到这一击日志的行 */
function raceRageFlush() {
  const list = RAGE_HOLD.pending;
  RAGE_HOLD.pending = [];
  const notes = [];
  list.forEach(r => { if (!r.broke && !rageBlocked(r.target)) raceRageGo(r.target, notes); });
  return notes;
}

function raceRageGo(target, notes) {
  if (target.dead || target.hidden || target.raceRageUsed) return;
  const max = totalMaxHp(target);
  if (!(max > 0) || totalHp(target) >= max * RACE_PERK.rageHpPct) return;
  // 每回合（整轮）最多发作一次：beginRound 清 raceRageUsed
  target.raceRageUsed = true;
  notes.push(`易怒蛮牛：${target.name} 血量低于 ${Math.round(RACE_PERK.rageHpPct * 100)}%，受伤后失控！`);
  target.bonus = 0;
  target.raceNoBonus = true;   // 下个敌人回合的附赠也没了（refreshEnemyEconomy 读）
  const from = Number(target.zone);
  const ns = zoneNeighbors(from).slice();
  for (let i = ns.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ns[i], ns[j]] = [ns[j], ns[i]]; }
  for (const z of ns) {
    doMove(target, z, { free: true, forced: true });
    if (Number(target.zone) !== from) break;
  }
  if (Number(target.zone) === from) notes.push(`${target.name} 没有路可冲，原地发狂。`);
  const pool = hostilesOf(target).filter(x => Number(x.zone) === Number(target.zone) && !x.kind && !x.isProp && !(typeof isDownProtected === "function" && isDownProtected(x)));
  if (pool.length) {
    const v = pool[Math.floor(Math.random() * pool.length)];
    notes.push(`${target.name} 不受控地冲撞 ${v.name}。`);
    dealBreak(v, RACE_PERK.rageBreak, "physical", notes, "易怒蛮牛冲撞", { by: target });
  } else notes.push(`${target.name} 冲进 ${target.zone} 区，没有撞到人。`);
}

/** 种族带来的附赠技能（enemySkillList 追加）。只有敌人有：角色有自己的技能 */
const RACE_SKILL_COST = { race_snuff: { ap: 0, bonus: 1 }, race_hunt: { ap: 0, bonus: 1 }, race_awe: { ap: 0, bonus: 1 }, race_spit: { ap: 0, bonus: 1 } };
function raceSkills(u) {
  const p = u && !u.isPlayer ? enemyRacePerk(u) : null;
  if (!p) return [];
  const out = [];
  if (p.snuff) out.push({ id: "race_snuff", label: "热耐性：扑灭灼烧（附赠）" });
  if (p.hunt) out.push({ id: "race_hunt", label: "追猎本能：紧追（附赠）" });
  if (p.awe) out.push({ id: "race_awe", label: "威压：近距威吓（附赠，50% 施加不稳）" });
  if (p.spit) out.push({ id: "race_spit", label: "吐酸：近距 1×atk 酸（附赠，每场一次）" });
  return out;
}
/** 种族技能的执行（runEnemyActionInner 开头调用，不是种族技能返回 false） */
function raceRunSkill(id, a, t, hitOne, lines, needT, atk) {
  if (!RACE_SKILL_COST[id]) return false;
  raceMarkActed(a);
  a.resources = a.resources || {};
  if (id === "race_snuff") {
    const n = Math.floor(Number(a.statuses && a.statuses.burn) || 0);
    if (a.statuses) a.statuses.burn = 0;
    lines.push(n > 0 ? `热耐性：${a.name} 扑灭了身上的 ${n} 层灼烧。` : `${a.name} 身上没有灼烧。`);
    return true;
  }
  if (!needT()) return true;
  if (id === "race_hunt") {
    t.statuses = t.statuses || {};
    t.statuses.chase = true;
    t.chasers = (t.chasers || []).filter(x => x !== a.id).concat(a.id);   // 目标移动时跟过去的是它（chaseFollow 读 chasers）
    if (typeof popStatus === "function") popStatus(t, "chase");
    lines.push(`追猎本能：${t.name} 被 ${a.name} 紧追，它移动时 ${a.name} 会跟过去。`);
    return true;
  }
  if (Number(a.zone) !== Number(t.zone)) { lines.push(`${t.name} 不在同一区，打不到。`); return true; }
  if (id === "race_awe") {
    const ok = Math.random() < RACE_PERK.aweChance;
    lines.push(`威压：${a.name} 威吓 ${t.name}（${Math.round(RACE_PERK.aweChance * 100)}%）→ ${ok ? "成功" : "失败"}`);
    if (ok) {
      const notes = [];
      applyUnstable(t, notes);
      if (typeof popStatus === "function") popStatus(t, "unstable");
      lines.push(...notes, `${t.name} 不稳。`);
    }
    return true;
  }
  if (id === "race_spit") {
    if (a.resources.spitUsed) { lines.push("吐酸：本场战斗已用。"); return true; }
    a.resources.spitUsed = true;
    hitOne(a, t, { element: "acid", mult: RACE_PERK.spitMult, baseBreak: 0, atk, atkRange: "melee" });
    lines.push("吐酸：本场战斗已用。");
    return true;
  }
  return false;
}
/** AI：这一步要不要先用一个种族附赠。返回 { id, target } 或 null。
 *  精英 / 首领的移动也花附赠，所以只在不用移动（step == null）时才用；杂兵的附赠（千里马给的）不影响移动 */
function raceBonusChoice(u, prey, step) {
  if (!u || u.isPlayer || !u.race || (u.bonus || 0) < 1) return null;
  const rank = typeof enemyRankOf === "function" ? enemyRankOf(u) : "minion";
  if (rank !== "minion" && step != null) return null;
  const p = enemyRacePerk(u);
  if (!p) return null;
  const mine = (id) => (enemySkillList(u) || []).some(s => s.id === id);
  const near = (prey || []).filter(x => !x.kind && Number(x.zone) === Number(u.zone));
  if (p.snuff && mine("race_snuff") && Number(u.statuses && u.statuses.burn) > 0) return { id: "race_snuff", target: null };
  if (p.spit && mine("race_spit") && !(u.resources && u.resources.spitUsed) && near.length) return { id: "race_spit", target: near.slice().sort((a, b) => totalHp(a) - totalHp(b))[0] };
  if (p.awe && mine("race_awe")) { const c = near.filter(x => !(x.statuses && x.statuses.unstable)); if (c.length) return { id: "race_awe", target: c[0] }; }
  if (p.hunt && mine("race_hunt")) {
    const c = (prey || []).filter(x => !x.kind && !(x.statuses && x.statuses.chase && (x.chasers || []).includes(u.id)));
    if (c.length) return { id: "race_hunt", target: c[0] };
  }
  return null;
}

function spawnEnemyGroup(id, lv, partyN, zone, iv, race) {
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
  const u = applyEnemyIV(p.build(lv, partyN), iv, race);
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
  applyEnemyRace(body);   // 种族「触灵」（ENEMY_RACE_EXTRA.ufo_body）
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
  (state.units || []).filter(u => !u.hidden && !u.dead && !u._removed && u.id !== body.id &&
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
