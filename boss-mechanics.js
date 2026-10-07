/* Antlerscale: Backfire · 首领机制（可以复用的模块）
 *
 * 敌人单位上挂 u.mechanics = [{ type: "execution", ...配置 }]，规则在回合开始时自动结算。
 * 每个首领用哪几种机制、数字多少都写在自己的配置里（不写的取 BOSS_MECH_DEFAULTS）。
 * 运行时状态记在同一个对象的 .st 里（跟着单位一起存档 / 快照 / 联机同步）。
 *
 * ── 死刑 execution ──
 *   标记我方「血量上限最高」的单位（卡片边框圈红、显示倒计时），倒计时到了在回合开始时对它打一次高额伤害。
 *   · 落下时机 phase："enemy" 敌人回合开始（敌人行动前）/ "player" 我方回合开始（我方回满行动点之后、行动之前）
 *   · 每一段都是独立的攻击，各自可以被协助格挡：协助格挡成功这一段全免，空手格挡成功挨一半，没挡住挨全额
 *   · 被标记的人一倒地（濒死 / 死亡）立刻转标给其他还站着的、血量上限最高的单位，倒计时不变
 *   · 该落下时首领失衡 / 晕眩：推迟一回合（下一回合同一时机再判）
 *   · 落下之后：then = "repeat" 重新标记再倒数（times 限次数）/ "once" 只放一次；hook 可以接首领专属的后续（BOSS_MECH_HOOKS）
 *   · 无视射程、阻隔和屏障、躲藏（锁定的处刑），也不受范围攻击的限制 */
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
  }
};

/** 选标记目标的规则（以后的首领可以加别的选法） */
const BOSS_MECH_PICKS = {
  maxHp: (list) => list.slice().sort((a, b) => unitMaxHp(b) - unitMaxHp(a))[0] || null
};
/** 首领专属的后续（落下之后调用），按名字注册 */
const BOSS_MECH_HOOKS = {};

function unitMaxHp(u) { return ((u && u.layers) || []).reduce((a, l) => a + (Number(l.max) || 0), 0); }

/** 能被死刑标记的我方单位：还站着的角色和武器人（护送对象、单人模式的伙伴不算） */
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

/* ---------- 死刑 ---------- */
function executionMark(boss, m, notes, why) {
  const c = mechConfig(m);
  const pick = BOSS_MECH_PICKS[c.pick] || BOSS_MECH_PICKS.maxHp;
  const t = pick(executionCandidates(), boss, m);
  m.st = m.st || {};
  m.st.targetId = t ? t.id : null;
  if (t && notes) notes.push(`${boss.name}「${c.name}」${why || "锁定"}了 ${t.name}（血量上限 ${unitMaxHp(t)}）：第 ${m.st.due} 回合${c.phase === "player" ? "我方" : "敌人"}回合开始时落下。`);
  return t;
}
function executionTarget(m) {
  const id = m && m.st && m.st.targetId;
  return id ? (state.units || []).find(u => u.id === id) || null : null;
}
/** 还没开始的就开始；被标记的人倒下了就转标。战斗中任何时候调用都安全 */
function bossMechSync(notes) {
  if (!state.combatStarted) return notes;
  notes = notes || [];
  const turn = Number(state.turnNo) || 1;
  (state.units || []).forEach(boss => {
    if (boss.isPlayer) return;
    bossMechList(boss, "execution").forEach(m => {
      const c = mechConfig(m);
      if (!mechBossAlive(boss)) { if (m.st) m.st.targetId = null; return; }
      m.st = m.st || {};
      if (m.st.done) return;
      if (m.st.due == null) {
        if (turn < (Number(c.firstTurn) || 1)) return;
        m.st.due = turn + Math.max(0, Number(c.turns) || 0);
        m.st.casts = m.st.casts || 0;
        executionMark(boss, m, notes);
        return;
      }
      const t = executionTarget(m);
      if (!t || t.dead || t.dying || t.hidden || t._removed) {
        const old = t ? t.name : null;
        const nt = executionMark(boss, m, null);
        // 还在等格挡的后几段一起转过去（换了目标，能格挡的人也重新算）
        if (t && nt) (state.blockQueue || []).forEach(job => {
          if (job.attackerId === boss.id && job.targetId === t.id && job.opt && job.opt.flags && job.opt.flags.execution) { job.targetId = nt.id; job.tried = []; }
        });
        if (nt && old && nt.name !== old) notes.push(`${old} 倒下了，「${c.name}」转到 ${nt.name} 身上（第 ${m.st.due} 回合落下）。`);
        else if (nt && !old) notes.push(`「${c.name}」锁定了 ${nt.name}。`);
      }
    });
  });
  return notes;
}

/** 回合开始：phase = "enemy" / "player"。到时间的死刑落下（首领失衡则推迟一回合） */
function bossMechPhaseStart(phase, notes) {
  if (!state.combatStarted) return notes;
  notes = notes || [];
  bossMechSync(notes);
  const turn = Number(state.turnNo) || 1;
  (state.units || []).forEach(boss => {
    if (boss.isPlayer || !mechBossAlive(boss)) return;
    bossMechList(boss, "execution").forEach(m => {
      const c = mechConfig(m);
      if (!m.st || m.st.done || m.st.due == null || c.phase !== phase || turn < m.st.due) return;
      if (boss.stunned) {
        m.st.due = turn + 1;
        notes.push(`${boss.name} 失衡，「${c.name}」被打断蓄力，推迟一回合（第 ${m.st.due} 回合落下）。`);
        return;
      }
      castExecution(boss, m, notes);
    });
  });
  return notes;
}

function castExecution(boss, m, notes) {
  const c = mechConfig(m);
  bossMechSync(notes);
  const t = executionTarget(m);
  m.st.casts = (Number(m.st.casts) || 0) + 1;
  if (!t) {
    notes.push(`${boss.name}「${c.name}」落空：没有能打的目标。`);
  } else {
    notes.push(`【${c.name}】${boss.name} 对 ${t.name} 执行${c.name}！（${(c.hits || []).length} 段）`);
    if (typeof spawnPopup === "function") spawnPopup(t, { kind: "status", text: c.name + "！", element: (c.hits[0] && c.hits[0].element) || boss.element || "physical" });
    // 段与段之间先把日志写出去，免得都堆在回合开始那一块里
    if (notes.length) { appendLog(notes.join("\n")); notes.length = 0; }
    (c.hits || []).forEach((h, i) => {
      if (!t || t.dead) return;
      const atk = h.atk != null ? Number(h.atk) : (typeof effectiveAtk === "function" ? effectiveAtk(boss, state.units) : Number(boss.atk) || 0);
      const out = dealTo(boss, t, {
        atk, mult: h.mult != null ? Number(h.mult) : (h.flat ? 0 : 1), flat: Number(h.flat) || 0, hits: 1,
        element: h.element || boss.element || "physical",
        baseBreak: h.baseBreak != null ? Number(h.baseBreak) : 1,
        flags: { action: true, execution: true, execHit: i + 1, execHits: c.hits.length }
      });
      if (out && !out.pending && out.res) appendLog(`${c.name} 第 ${i + 1}/${c.hits.length} 段 → ${t.name}：${Math.floor(Number(out.res.total) || 0)} 伤害。`);
    });
  }
  // 落下之后
  const limit = Number(c.times) || 0;
  if (c.then === "repeat" && (!limit || m.st.casts < limit)) {
    m.st.due = (Number(state.turnNo) || 1) + Math.max(1, Number(c.interval != null ? c.interval : c.turns) || 1);
    m.st.targetId = null;
    executionMark(boss, m, notes, "重新锁定");
  } else {
    m.st.done = true;
    m.st.targetId = null;
  }
  if (c.hook && BOSS_MECH_HOOKS[c.hook]) BOSS_MECH_HOOKS[c.hook](boss, m, notes);
  return notes;
}

/** 画面用：这个单位身上的死刑标记 [{ name, left（还剩几回合）, phase, by }]；没有就是空数组 */
function executionMarksOn(u) {
  if (!u || !state.combatStarted) return [];
  const turn = Number(state.turnNo) || 1;
  const out = [];
  (state.units || []).forEach(boss => {
    if (boss.isPlayer || !mechBossAlive(boss)) return;
    bossMechList(boss, "execution").forEach(m => {
      if (!m.st || m.st.done || m.st.targetId !== u.id) return;
      const c = mechConfig(m);
      out.push({ name: c.name, left: Math.max(0, m.st.due - turn), phase: c.phase, by: boss.name, delayed: !!boss.stunned });
    });
  });
  return out;
}
/** 首领身上：「死刑 → 某某 · 2 回合」 */
function executionCastsBy(boss) {
  if (!boss || boss.isPlayer || !state.combatStarted) return [];
  const turn = Number(state.turnNo) || 1;
  return bossMechList(boss, "execution").filter(m => m.st && !m.st.done && m.st.due != null).map(m => {
    const c = mechConfig(m);
    const t = executionTarget(m);
    return { name: c.name, left: Math.max(0, m.st.due - turn), target: t ? t.name : "", phase: c.phase };
  });
}
