/* Antlerscale: Backfire · 首领机制（可以复用的模块）
 *
 * 敌人单位上挂 u.mechanics = [{ type: "execution" | "share", ...配置 }]，规则在回合开始时自动结算。
 * 每个首领用哪几种机制、数字多少都写在自己的配置里（不写的取 BOSS_MECH_DEFAULTS）。
 * 运行时状态记在同一个对象的 .st 里（跟着单位一起存档 / 快照 / 联机同步）。
 *
 * 「标记类」机制共用一套流程（BOSS_MECH_TYPES 里登记）：
 *   标记一名我方单位 → 倒计时 turns 回合 → 在回合开始时落下（phase："enemy" 敌人回合开始 / "player" 我方回合开始）
 *   · 被标记的人一倒地（濒死 / 死亡）立刻转标给别人，倒计时不变
 *   · 该落下时首领失衡 / 晕眩：推迟一回合（下一回合同一时机再判）
 *   · 落下之后：then = "repeat" 重新标记再倒数（interval 回合，times 限次数）/ "once" 只放一次；hook 接首领专属的后续（BOSS_MECH_HOOKS）
 *   · 无视射程、阻隔、屏障和躲藏（锁定的机制伤害，flags.locked）
 *
 * ── 死刑 execution ──
 *   标记血量上限最高的单位（红框）；落下时对它打 hits 里的每一段，每段都是独立的攻击、各自可以协助格挡
 *   （协助格挡成功这一段全免，空手格挡成功挨一半，没挡住挨全额）。
 *
 * ── 分担 share ──
 *   随机标记一名我方单位（黄框）；落下时以「他当时所在的区」为准，伤害池 pool 由这个区里所有还站着的友方单位
 *   平均分担（人越多每人挨得越少）；不能格挡。
 *
 * ── 远离 spread ──
 *   标记我方全员（紫框）；落下时每个还站着的被标记者在自己当时所在的区爆炸一次，对这个区里所有还站着的友方单位
 *   各造成 blast 伤害、不能格挡。同一个区有几个标记就炸几次，每个人每次都挨——要分开站。
 *   被标记的人倒下了，他的标记就没了（不转给别人）。
 *
 * ── 踩塔 tower ──
 *   标记 count 个区域（区域边框 + 倒计时）；落下时每座塔：区里还站着的友方 ≥ need → 这些人各挨一下不高的 soak 伤害；
 *   人数不够（没人踩塔）→ 失败惩罚 fail：默认对我方全员造成巨额伤害（kind "raid"），也可以接首领专属的惩罚（kind "hook"）。
 *   都不能格挡。 */
"use strict";

const BOSS_MECH_DEFAULTS = {
  execution: {
    name: "死刑",
    phase: "enemy",        // 落下时机："enemy" / "player"
    turns: 3,              // 标记后过几回合落下（第 1 回合标记、turns = 3 → 第 4 回合的那个时机落下）
    firstTurn: 1,          // 第几回合开始第一次标记
    pick: "maxHp",         // 选谁：BOSS_MECH_PICKS 里的名字
    hits: [{ mult: 3 }],   // 每一段：{ mult（× 首领 atk）, flat（固定伤害，可和 mult 叠加）, element, baseBreak, atk（另指定攻击力） }
    then: "repeat",        // 落下之后："repeat" 重新标记 / "once" 只放一次
    interval: null,        // repeat 时下一次标记后过几回合落下（不写 = turns）
    times: 0,              // repeat 最多放几次（0 = 不限）
    hook: null             // 落下之后额外调用 BOSS_MECH_HOOKS[hook](boss, mech, notes)
  },
  share: {
    name: "分担",
    phase: "enemy",
    turns: 3,
    firstTurn: 1,
    pick: "random",        // 随机一名我方单位
    pool: { mult: 4 },     // 伤害池：{ mult（× 首领 atk）, flat, atk }，同区的友方平均分担（每人向上取整）
    element: null,         // 不写 = 首领的属性
    baseBreak: 0,          // 每人另外挨几点击破
    then: "repeat",
    interval: null,
    times: 0,
    hook: null
  },
  tower: {
    name: "踩塔",
    phase: "enemy",
    turns: 3,
    firstTurn: 1,
    pick: "randomZone",    // 随机区域（不选深渊）
    count: 1,              // 一次标几座塔（几个不同的区）
    need: 1,               // 每座塔至少要几个人踩
    soak: { mult: 0.5 },   // 踩塔的人每人挨的伤害：{ mult（× 首领 atk）, flat, atk }
    fail: { kind: "raid", mult: 4 },   // 没人踩（人数不够）：raid = 我方全员各挨 mult × atk + flat；hook = 调 BOSS_MECH_HOOKS[fail.hook](boss, mech, zone, notes)
    element: null,
    baseBreak: 0,
    then: "repeat",
    interval: null,
    times: 0,
    hook: null
  },
  spread: {
    name: "远离",
    phase: "enemy",
    turns: 3,
    firstTurn: 1,
    pick: "all",           // 全员
    blast: { mult: 1 },    // 每一次爆炸对同区每个友方的伤害：{ mult（× 首领 atk）, flat, atk }
    element: null,         // 不写 = 首领的属性
    baseBreak: 0,          // 每次爆炸每人另外挨几点击破
    then: "repeat",
    interval: null,
    times: 0,
    hook: null
  }
};

/** 选标记目标的规则（以后的首领可以加别的选法） */
const BOSS_MECH_PICKS = {
  maxHp: (list) => list.slice().sort((a, b) => unitMaxHp(b) - unitMaxHp(a))[0] || null,
  random: (list) => list.length ? list[Math.floor(Math.random() * list.length)] : null,
  all: (list) => list.slice(),   // 多目标机制用：全员
  // 区域机制用：从能选的区里随机挑 n 个不同的区
  randomZone: (zones, boss, m, n) => {
    const left = zones.slice(), out = [];
    while (left.length && out.length < (n || 1)) out.push(left.splice(Math.floor(Math.random() * left.length), 1)[0]);
    return out;
  }
};
/** 能放区域机制的区：棋盘上的区，深渊不算 */
function mechZoneOptions() {
  const ids = typeof boardZoneIds === "function" ? boardZoneIds() : Array.from({ length: Number(state.zoneMode) || 2 }, (_, i) => i + 1);
  return ids.map(Number).filter(z => !((state.fields || {})[z] && state.fields[z].abyss));
}
/** 首领专属的后续（落下之后调用），按名字注册 */
const BOSS_MECH_HOOKS = {};
/** 落下时现算分段的首领（死刑 hitsHook），按名字注册 */
const BOSS_MECH_HITS = {};

function unitMaxHp(u) { return ((u && u.layers) || []).reduce((a, l) => a + (Number(l.max) || 0), 0); }

/** 能被标记的我方单位：还站着的角色和武器人（护送对象、单人模式的伙伴不算） */
function executionCandidates() {
  return (state.units || []).filter(u => u.isPlayer && !u.hidden && !u.fused && !u._removed && !u.dead && !u.dying &&
    !u.escort && !u.isPartner);
}
function mechConfig(m) {
  const base = BOSS_MECH_DEFAULTS[m && m.type] || {};
  return Object.assign({}, base, m || {});
}
function bossMechList(u, type) {
  return ((u && u.mechanics) || []).filter(m => m && (!type || m.type === type));
}
function mechBossAlive(u) { return !!u && !u.dead && !u._removed && !u.hidden; }
function mechAtk(boss, spec) {
  if (spec && spec.atk != null) return Number(spec.atk) || 0;
  return typeof effectiveAtk === "function" ? effectiveAtk(boss, state.units) : Number(boss.atk) || 0;
}

/** 给敌人挂上一个机制（主持人后台 / 测试 / 首领配置用） */
function addBossMechanic(u, cfg) {
  if (!u) return null;
  u.mechanics = u.mechanics || [];
  const m = Object.assign({ type: "execution" }, cfg || {});
  u.mechanics.push(m);
  return m;
}
function removeBossMechanics(u, type) {
  if (!u || !u.mechanics) return;
  u.mechanics = u.mechanics.filter(m => type && m.type !== type);
  if (!u.mechanics.length) delete u.mechanics;
}

/* ---------- 标记类机制的公共流程 ---------- */
function mechWhen(c, due) { return `第 ${due} 回合${c.phase === "player" ? "我方" : "敌人"}回合开始时落下`; }
function mechMark(boss, m, notes, why) {
  const c = mechConfig(m);
  const T = BOSS_MECH_TYPES[m.type];
  const pick = BOSS_MECH_PICKS[c.pick] || BOSS_MECH_PICKS[T.pick];
  m.st = m.st || {};
  if (T.zone) {
    const zones = [].concat(pick(mechZoneOptions(), boss, m, Math.max(1, Number(c.count) || 1)) || []);
    m.st.zones = zones;
    m.st.targetId = null;
    if (zones.length && notes) notes.push(`${boss.name}「${c.name}」${why || "标记"}了 ${zones.map(z => z + " 区").join("、")}${T.markNote ? T.markNote(zones, boss, m) : ""}：${mechWhen(c, m.st.due)}。`);
    return zones[0] || null;
  }
  if (T.multi) {
    const list = [].concat(pick(executionCandidates(), boss, m) || []);
    m.st.targetIds = list.map(u => u.id);
    m.st.targetId = null;
    if (list.length && notes) notes.push(`${boss.name}「${c.name}」${why || "标记"}了 ${list.map(u => u.name).join("、")}${T.markNote ? T.markNote(list, boss, m) : ""}：${mechWhen(c, m.st.due)}。`);
    return list[0] || null;
  }
  const t = pick(executionCandidates(), boss, m);
  m.st.targetId = t ? t.id : null;
  if (t && notes) notes.push(`${boss.name}「${c.name}」${why || "锁定"}了 ${t.name}${T.markNote ? T.markNote(t, boss, m) : ""}：${mechWhen(c, m.st.due)}。`);
  return t;
}
function mechTarget(m) {
  const id = m && m.st && m.st.targetId;
  return id ? (state.units || []).find(u => u.id === id) || null : null;
}
function mechStanding(u) { return !!u && !u.dead && !u.dying && !u.hidden && !u._removed && !u.fused; }
/** 多目标机制：还站着的被标记者 */
function mechTargets(m) {
  const ids = (m && m.st && m.st.targetIds) || [];
  return ids.map(id => (state.units || []).find(u => u.id === id)).filter(mechStanding);
}
function markedMechs(boss) { return bossMechList(boss).filter(m => BOSS_MECH_TYPES[m.type]); }

/** 还没开始的就开始；被标记的人倒下了就转标。战斗中任何时候调用都安全 */
function bossMechSync(notes) {
  if (!state.combatStarted) return notes;
  notes = notes || [];
  const turn = Number(state.turnNo) || 1;
  (state.units || []).forEach(boss => {
    if (boss.isPlayer) return;
    markedMechs(boss).forEach(m => {
      const c = mechConfig(m);
      if (!mechBossAlive(boss)) { if (m.st) m.st.targetId = null; return; }
      m.st = m.st || {};
      if (m.st.done) return;
      if (m.st.due == null) {
        if (turn < (Number(c.firstTurn) || 1)) return;
        m.st.due = turn + Math.max(0, Number(c.turns) || 0);
        m.st.casts = m.st.casts || 0;
        mechMark(boss, m, notes);
        return;
      }
      if (BOSS_MECH_TYPES[m.type].multi || BOSS_MECH_TYPES[m.type].zone) return;   // 多目标：倒下的人标记就没了，不转给别人；区域标记不用转
      const t = mechTarget(m);
      if (!t || t.dead || t.dying || t.hidden || t._removed) {
        const old = t ? t.name : null;
        const nt = mechMark(boss, m, null);
        // 死刑：还在等格挡的后几段一起转过去（换了目标，能格挡的人也重新算）
        if (t && nt) (state.blockQueue || []).forEach(job => {
          if (job.attackerId === boss.id && job.targetId === t.id && job.opt && job.opt.flags && job.opt.flags.mechId === m.st.uid) { job.targetId = nt.id; job.tried = []; }
        });
        if (nt && old && nt.name !== old) notes.push(`${old} 倒下了，「${c.name}」转到 ${nt.name} 身上（第 ${m.st.due} 回合落下）。`);
        else if (nt && !old) notes.push(`「${c.name}」锁定了 ${nt.name}。`);
      }
    });
  });
  return notes;
}

/** 回合开始：phase = "enemy" / "player"。到时间的机制落下（首领失衡则推迟一回合） */
function bossMechPhaseStart(phase, notes) {
  if (!state.combatStarted) return notes;
  notes = notes || [];
  bossMechSync(notes);
  const turn = Number(state.turnNo) || 1;
  (state.units || []).forEach(boss => {
    if (boss.isPlayer || !mechBossAlive(boss)) return;
    markedMechs(boss).forEach(m => {
      const c = mechConfig(m);
      if (!m.st || m.st.done || m.st.due == null || c.phase !== phase || turn < m.st.due) return;
      if (boss.stunned) {
        m.st.due = turn + 1;
        notes.push(`${boss.name} 失衡，「${c.name}」被打断蓄力，推迟一回合（第 ${m.st.due} 回合落下）。`);
        return;
      }
      if (boss.resources && boss.resources.hostage) {
        m.st.due = turn + 1;
        notes.push(`${boss.name} 被挟持，「${c.name}」推迟一回合（第 ${m.st.due} 回合落下）。`);
        return;
      }
      castBossMech(boss, m, notes);
    });
  });
  return notes;
}

function castBossMech(boss, m, notes) {
  const c = mechConfig(m);
  bossMechSync(notes);
  m.st.casts = (Number(m.st.casts) || 0) + 1;
  m.st.uid = `${boss.id}:${m.type}:${m.st.casts}`;   // 这一次落下的编号（格挡队列里认它）
  const T = BOSS_MECH_TYPES[m.type];
  const t = T.zone ? (m.st.zones || []) : T.multi ? mechTargets(m) : mechTarget(m);
  if (!t || ((T.multi || T.zone) && !t.length)) notes.push(`${boss.name}「${c.name}」落空：没有能打的目标。`);
  else T.cast(boss, m, c, t, notes);
  // 落下之后
  const limit = Number(c.times) || 0;
  if (c.then === "repeat" && (!limit || m.st.casts < limit)) {
    m.st.due = (Number(state.turnNo) || 1) + Math.max(1, Number(c.interval != null ? c.interval : c.turns) || 1);
    m.st.targetId = null;
    m.st.targetIds = null;
    m.st.zones = null;
    mechMark(boss, m, notes, T.multi || T.zone ? "重新标记" : "重新锁定");
  } else {
    m.st.done = true;
    m.st.targetId = null;
    m.st.targetIds = null;
    m.st.zones = null;
  }
  if (c.hook && BOSS_MECH_HOOKS[c.hook]) BOSS_MECH_HOOKS[c.hook](boss, m, notes);
  return notes;
}
/** 段与段之间先把日志写出去，免得都堆在回合开始那一块里 */
function flushMechNotes(notes) { if (notes.length) { appendLog(notes.join("\n")); notes.length = 0; } }

/* ---------- 死刑 ---------- */
function castExecution(boss, m, c, t, notes) {
  // 可选 hitsHook：落下这一刻再决定分几段（BOSS_MECH_HITS[名字](boss, mech, target) → hits），例如亡命之王按还活着的手下数
  if (c.hitsHook && BOSS_MECH_HITS[c.hitsHook]) c = Object.assign({}, c, { hits: BOSS_MECH_HITS[c.hitsHook](boss, m, t) || [] });
  // 可选 far：目标和首领不同区时每一段改用 far 的倍率 / 骰子（电能炮隔区衰减）
  const far = !!(c.far && typeof zoneDist === "function" && zoneDist(boss.zone, t.zone, state.zoneMode) >= 1);
  notes.push(`【${c.name}】${boss.name} 对 ${t.name} 执行${c.name}！（${(c.hits || []).length} 段${far ? "，隔区衰减" : ""}）`);
  if (typeof spawnPopup === "function") spawnPopup(t, { kind: "status", text: c.name + "！", element: (c.hits[0] && c.hits[0].element) || boss.element || "physical" });
  flushMechNotes(notes);
  const zoneAtCast = Number(t.zone);
  m.st.lastTargetId = t.id;
  (c.hits || []).forEach((h, i) => {
    if (!t || t.dead) return;
    const seg = far ? Object.assign({}, h, c.far) : h;
    // 可选 byId：这一段由别的单位出手（亡命之王的手下各补一刀；格挡反击打的是出手的人）
    const by = seg.byId ? (state.units || []).find(u => u.id === seg.byId && mechStanding(u)) : null;
    if (seg.byId && !by) return;
    const out = dealTo(by || boss, t, {
      atk: mechAtk(boss, seg), mult: seg.mult != null ? Number(seg.mult) : (seg.flat ? 0 : 1), flat: Number(seg.flat) || 0, hits: 1,
      diceN: seg.diceS ? (Number(seg.diceN) || 1) : 0, diceS: Number(seg.diceS) || 0,
      element: seg.element || boss.element || "physical",
      baseBreak: seg.baseBreak != null ? Number(seg.baseBreak) : 1,
      flags: { action: true, locked: true, execution: true, execName: c.name, mechId: m.st.uid, execHit: i + 1, execHits: c.hits.length }
    });
    if (out && !out.pending && out.res) appendLog(`${c.name} 第 ${i + 1}/${c.hits.length} 段${by ? `（${by.name}）` : ""} → ${t.name}：${Math.floor(Number(out.res.total) || 0)} 伤害。`);
  });
  // 可选 splash：目标落下时所在区的其他友方各挨 splash × atk（范围伤害，不能格挡）
  const sp = Number(c.splash) || 0;
  if (sp > 0) {
    const dmg = Math.max(0, Math.round(sp * mechAtk(boss, {})));
    const group = (state.units || []).filter(u => u.isPlayer && u !== t && mechStanding(u) && Number(u.zone) === zoneAtCast);
    if (group.length) appendLog(`${c.name} 波及 ${zoneAtCast} 区：${group.map(u => u.name).join("、")} 各挨 ${dmg}（范围，不能格挡）。`);
    group.forEach(u => {
      const out = dealTo(boss, u, {
        atk: 0, mult: 0, flat: dmg, hits: 1, element: (c.hits[0] && c.hits[0].element) || boss.element || "physical", baseBreak: 0,
        flags: { action: true, locked: true, aoe: true, mechId: m.st.uid, blockResolved: true, block: "none" }
      });
      if (out && out.res) appendLog(`${c.name} 波及 → ${u.name}：${Math.floor(Number(out.res.total) || 0)} 伤害。`);
    });
  }
}
/** 蓄满能量的首领这回合受到的减伤（机制配置 chargeDr：倒数到 0、这回合就要落下时生效）。没有就是 0 */
function mechChargeDr(u) {
  if (!u || u.isPlayer || !state.combatStarted || u.stunned) return 0;
  const turn = Number(state.turnNo) || 1;
  return markedMechs(u).reduce((best, m) => {
    const c = mechConfig(m);
    if (!(Number(c.chargeDr) > 0) || !m.st || m.st.done || m.st.due == null || m.st.due > turn) return best;
    return Math.max(best, Number(c.chargeDr));
  }, 0);
}

/* ---------- 分担 ---------- */
/** 伤害池总量（× 首领现在的 atk） */
function sharePool(boss, c) {
  const p = c.pool || {};
  return Math.max(0, Math.round((Number(p.mult) || 0) * mechAtk(boss, p) + (Number(p.flat) || 0)));
}
/** 和 t 同区、能一起分担的友方单位（还站着的我方单位，含武器人和护送对象） */
function shareGroup(t) {
  if (!t) return [];
  return (state.units || []).filter(u => u.isPlayer && !u.hidden && !u.fused && !u._removed && !u.dead && !u.dying &&
    Number(u.zone) === Number(t.zone));
}
function castShare(boss, m, c, t, notes) {
  const group = shareGroup(t);
  const pool = sharePool(boss, c);
  const each = group.length ? Math.ceil(pool / group.length) : 0;
  const element = c.element || boss.element || "physical";
  notes.push(`【${c.name}】${boss.name} 砸向 ${t.name} 所在的 ${t.zone} 区：伤害池 ${pool}，${group.length} 人分担，每人 ${each}（不能格挡）。`);
  if (typeof spawnPopup === "function") spawnPopup(t, { kind: "status", text: c.name + "！", element });
  flushMechNotes(notes);
  group.forEach(u => {
    const out = dealTo(boss, u, {
      atk: 0, mult: 0, flat: each, hits: 1, element, baseBreak: Number(c.baseBreak) || 0,
      flags: { action: true, locked: true, share: true, mechId: m.st.uid, blockResolved: true, block: "none" }
    });
    if (out && out.res) appendLog(`${c.name} → ${u.name}：分到 ${each}，实际 ${Math.floor(Number(out.res.total) || 0)} 伤害。`);
  });
}

/* ---------- 远离 ---------- */
/** 每一次爆炸对同区每个友方的伤害（× 首领现在的 atk） */
function spreadBlast(boss, c) {
  const b = c.blast || {};
  return Math.max(0, Math.round((Number(b.mult) || 0) * mechAtk(boss, b) + (Number(b.flat) || 0)));
}
function castSpread(boss, m, c, marked, notes) {
  const dmg = spreadBlast(boss, c);
  const element = c.element || boss.element || "physical";
  // 先按落下这一刻每个被标记者站的区定好爆炸点，再一个一个炸
  const blasts = marked.map(u => ({ by: u, zone: Number(u.zone) }));
  const perZone = {};
  blasts.forEach(b => { perZone[b.zone] = (perZone[b.zone] || 0) + 1; });
  notes.push(`【${c.name}】${boss.name} 引爆了 ${blasts.length} 个标记：` +
    Object.keys(perZone).map(z => `${z} 区 ${perZone[z]} 次`).join("、") + `，每次对同区每个友方 ${dmg}（不能格挡）。`);
  flushMechNotes(notes);
  blasts.forEach((b, i) => {
    if (typeof spawnPopup === "function") spawnPopup(b.by, { kind: "status", text: "爆炸！", element });
    const group = (state.units || []).filter(u => u.isPlayer && mechStanding(u) && Number(u.zone) === b.zone);
    group.forEach(u => {
      const out = dealTo(boss, u, {
        atk: 0, mult: 0, flat: dmg, hits: 1, element, baseBreak: Number(c.baseBreak) || 0,
        flags: { action: true, locked: true, spread: true, mechId: m.st.uid, blockResolved: true, block: "none" }
      });
      if (out && out.res) appendLog(`${c.name} 第 ${i + 1}/${blasts.length} 次爆炸（${b.by.name}，${b.zone} 区）→ ${u.name}：${Math.floor(Number(out.res.total) || 0)} 伤害。`);
    });
  });
}

/* ---------- 踩塔 ---------- */
function mechDamage(boss, spec) {
  spec = spec || {};
  return Math.max(0, Math.round((Number(spec.mult) || 0) * mechAtk(boss, spec) + (Number(spec.flat) || 0)));
}
function towerSoakers(z) {
  return (state.units || []).filter(u => u.isPlayer && mechStanding(u) && Number(u.zone) === Number(z));
}
function mechHit(boss, u, dmg, element, baseBreak, m, extra) {
  return dealTo(boss, u, {
    atk: 0, mult: 0, flat: dmg, hits: 1, element, baseBreak: Number(baseBreak) || 0,
    flags: Object.assign({ action: true, locked: true, mechId: m.st.uid, blockResolved: true, block: "none" }, extra || {})
  });
}
function castTower(boss, m, c, zones, notes) {
  const element = c.element || boss.element || "physical";
  const need = Math.max(1, Number(c.need) || 1);
  const soak = mechDamage(boss, c.soak);
  const fail = c.fail || {};
  notes.push(`【${c.name}】${boss.name} 的塔落下：${zones.map(z => `${z} 区（${towerSoakers(z).length}/${need} 人）`).join("、")}。`);
  flushMechNotes(notes);
  zones.forEach(z => {
    const soakers = towerSoakers(z);
    if (soakers.length >= need) {
      appendLog(`${z} 区的塔有 ${soakers.length} 人踩住：每人挨 ${soak}（不能格挡）。`);
      soakers.forEach(u => {
        if (typeof spawnPopup === "function") spawnPopup(u, { kind: "status", text: "踩塔", element });
        const out = mechHit(boss, u, soak, element, c.baseBreak, m, { tower: true });
        if (out && out.res) appendLog(`${c.name}（${z} 区）→ ${u.name}：${Math.floor(Number(out.res.total) || 0)} 伤害。`);
      });
      return;
    }
    // 没人踩（人数不够）：失败惩罚
    appendLog(`${z} 区的塔没人踩住（${soakers.length}/${need} 人）！${c.name}失败。`);
    if (fail.kind === "hook") {
      if (fail.hook && BOSS_MECH_HOOKS[fail.hook]) { const n2 = []; BOSS_MECH_HOOKS[fail.hook](boss, m, z, n2); n2.forEach(t => appendLog(t)); }
      return;
    }
    const big = mechDamage(boss, fail);
    const all = (state.units || []).filter(u => u.isPlayer && mechStanding(u));
    appendLog(`塔爆发：我方全员各挨 ${big}（不能格挡）。`);
    all.forEach(u => {
      if (typeof spawnPopup === "function") spawnPopup(u, { kind: "status", text: "塔爆发！", element });
      const out = mechHit(boss, u, big, element, fail.baseBreak, m, { towerFail: true });
      if (out && out.res) appendLog(`${c.name}失败 → ${u.name}：${Math.floor(Number(out.res.total) || 0)} 伤害。`);
    });
  });
}

/** 标记类机制登记表：pick 默认选法、cast 落下时做什么、markNote 标记时补一句、multi 一次标记多人 */
const BOSS_MECH_TYPES = {
  execution: { pick: "maxHp", cast: castExecution, markNote: (t) => `（血量上限 ${unitMaxHp(t)}）` },
  share: { pick: "random", cast: castShare, markNote: (t, boss, m) => `（伤害池 ${sharePool(boss, mechConfig(m))}，到时同区的友方平均分担）` },
  tower: { pick: "randomZone", zone: true, cast: castTower, markNote: (zones, boss, m) => { const c = mechConfig(m); return `（每座塔至少 ${Math.max(1, Number(c.need) || 1)} 人踩住，每人挨 ${mechDamage(boss, c.soak)}；没人踩则${(c.fail || {}).kind === "hook" ? "触发严重惩罚" : `全员各挨 ${mechDamage(boss, c.fail)}`}）`; } },
  spread: { pick: "all", multi: true, cast: castSpread, markNote: (list, boss, m) => `（到时每人在自己的区爆炸一次，每次对同区每个友方 ${spreadBlast(boss, mechConfig(m))}，要分开站）` }
};

/* ---------- 画面用 ---------- */
/** 这个单位身上的标记 [{ type, name, left（还剩几回合）, phase, by, delayed, pool, group }]；没有就是空数组 */
function bossMarksOn(u) {
  if (!u || !state.combatStarted) return [];
  const turn = Number(state.turnNo) || 1;
  const out = [];
  (state.units || []).forEach(boss => {
    if (boss.isPlayer || !mechBossAlive(boss)) return;
    markedMechs(boss).forEach(m => {
      if (!m.st || m.st.done) return;
      const multi = BOSS_MECH_TYPES[m.type].multi;
      if (multi ? !(m.st.targetIds || []).includes(u.id) || !mechStanding(u) : m.st.targetId !== u.id) return;
      const c = mechConfig(m);
      const mark = { type: m.type, name: c.name, left: Math.max(0, m.st.due - turn), phase: c.phase, by: boss.name, delayed: !!boss.stunned };
      if (m.type === "share") { mark.pool = sharePool(boss, c); mark.group = shareGroup(u).length; }
      // 远离：这个人现在所在的区里有几个标记（= 到时这里炸几次，每次每人都挨）
      if (multi) { mark.blast = spreadBlast(boss, c); mark.stack = mechTargets(m).filter(x => Number(x.zone) === Number(u.zone)).length; }
      out.push(mark);
    });
  });
  return out;
}
function executionMarksOn(u) { return bossMarksOn(u).filter(x => x.type === "execution"); }
function shareMarksOn(u) { return bossMarksOn(u).filter(x => x.type === "share"); }
function spreadMarksOn(u) { return bossMarksOn(u).filter(x => x.type === "spread"); }
/** 首领身上：「死刑 → 某某 · 2 回合」「分担 → 某某 · 1 回合」 */
function bossCastsBy(boss) {
  if (!boss || boss.isPlayer || !state.combatStarted) return [];
  const turn = Number(state.turnNo) || 1;
  return markedMechs(boss).filter(m => m.st && !m.st.done && m.st.due != null).map(m => {
    const c = mechConfig(m);
    const T = BOSS_MECH_TYPES[m.type];
    const t = T.multi || T.zone ? null : mechTarget(m);
    const target = T.zone ? (m.st.zones || []).map(z => z + "区").join("、") : T.multi ? `全员（${mechTargets(m).length}）` : t ? t.name : "";
    return { type: m.type, name: c.name, left: Math.max(0, m.st.due - turn), target, phase: c.phase };
  });
}
function executionCastsBy(boss) { return bossCastsBy(boss); }
/** 区域上的标记（踩塔）：[{ type, name, left, phase, by, need, have, soak, fail, delayed }] */
function bossZoneMarks(z) {
  if (!state.combatStarted) return [];
  const turn = Number(state.turnNo) || 1;
  const out = [];
  (state.units || []).forEach(boss => {
    if (boss.isPlayer || !mechBossAlive(boss)) return;
    markedMechs(boss).forEach(m => {
      if (!BOSS_MECH_TYPES[m.type].zone || !m.st || m.st.done || !(m.st.zones || []).map(Number).includes(Number(z))) return;
      const c = mechConfig(m);
      out.push({ type: m.type, name: c.name, left: Math.max(0, m.st.due - turn), phase: c.phase, by: boss.name, delayed: !!boss.stunned,
        need: Math.max(1, Number(c.need) || 1), have: towerSoakers(z).length, soak: mechDamage(boss, c.soak),
        fail: (c.fail || {}).kind === "hook" ? null : mechDamage(boss, c.fail) });
    });
  });
  return out;
}

/* ---------- 各首领专属的分段 / 后续（函数写在 enemies.js，这里加载时登记，读档后也找得到） ---------- */
if (typeof kingExecutionHits === "function") BOSS_MECH_HITS.kingExecution = kingExecutionHits;
if (typeof kingExecutionGrab === "function") BOSS_MECH_HOOKS.kingGrab = kingExecutionGrab;
if (typeof aggOverheat === "function") BOSS_MECH_HOOKS.aggOverheat = aggOverheat;
