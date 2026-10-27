// 混编遇敌里的敌人实际贡献（接 enemy-threat.js / issue #401）：用游戏自己的 rollEncounter
// 抽含目标敌人的真实遭遇，对比「保留目标」vs「去掉目标、用等代币中立尘虫填充」，
// 并统计团队机制是否真正打出来（吸收、甩尾推人、标定榴弹、自爆、警戒高能、弦蚣追打/分裂……）。
// 不改任何游戏数值。固定种子。
//
//   node tools/enemy-threat.js --mixed
//   node tools/enemy-threat.js --mixed --kits livesand,sandfish_drive --levels 15 --samples 5 --out docs/balance/try-mixed
//   node tools/enemy-threat-mixed.js --smoke
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const { Worker, isMainThread, parentPort } = require("node:worker_threads");
const H = require("../tests/headless");
const B = require("./balance-common");

const MIXED = {
  version: "enemy-threat-mixed-v1",
  seedPrefix: "ETM1027",
  samples: 40,
  levels: [15, 20],
  sizes: [2, 3, 4],
  maxRounds: 30,
  workers: 4,
  out: "docs/balance/enemy-threat-mixed-1027",
  aloneJson: "docs/balance/enemy-threat-1026.json",
  maxSampleTries: 400,
  filler: "dust_bug" // 等代币中立填充（tokens=0，一只顶一枚被去掉的代币占位）
};

/** 目标敌人：团队角色、抽样区域、机制、额外变体 */
const TARGETS = [
  { kit: "livesand", regions: ["沙漠"], mech: "absorb",
    wantAllies: ["sand_beast", "sand_human", "bigsand", "dustbody", "sandfish_drive", "sandfish_ambush", "sandfish_lead"],
    variants: ["day", "night", "sand"],
    note: "死亡吸收沙灵/沙漠生物成巨型活沙；不吸收其他活沙" },
  { kit: "sandfish_drive", regions: ["沙漠"], mech: "push",
    wantAllies: ["sandfish_ambush", "sandfish_lead"],
    variants: ["day", "night", "sand"],
    note: "白天甩尾推向伏咬；失衡群起；夜晚/沙暴乱咬" },
  { kit: "sewer_cleaner", regions: ["下水道"], mech: "guard",
    wantAllies: ["sewer_sweeper", "sewer_keeper"],
    note: "代挡下水道清扫机；低血自爆" },
  { kit: "sewer_keeper", regions: ["下水道"], mech: "cleanse",
    wantAllies: ["sewer_sweeper", "sewer_cleaner"],
    note: "净化减益、叠鼓舞" },
  { kit: "mecha_gl", regions: ["天网设施", "巨人城"], mech: "mark",
    note: "标定榴弹；无团队协同，基线" },
  { kit: "boomcar", regions: ["外城区", "巨人城"], mech: "explode",
    note: "贴脸自爆；护盾随等级、护甲层写死 3（疑似）" },
  { kit: "captain_lizard", regions: ["外城区", "巨人城"], mech: null,
    note: "无团队角色，基线" },
  { kit: "meteor_centipede", regions: ["第三采矿场"], mech: "centipede",
    wantAllies: ["meteor_spider"],
    variants: ["natural", "glow"],
    eliteAssume: true, // #381/#389 未合：按精英 2 代币假设另测
    note: "命中后衍蛛追打；微光下死亡分裂衍蛛" },
  { kit: "sand_human", regions: ["沙漠"], mech: "fodder",
    wantAllies: ["livesand", "bigsand"],
    note: "活沙饲料；大沙灵召唤池" },
  { kit: "guard_gun", regions: ["外城区", "巨人城"], mech: null,
    note: "无团队角色，基线" },
  { kit: "alarm_bot", regions: ["第三采矿场"], mech: "alarm",
    wantAllies: ["meteor_miner"],
    variants: ["natural", "threeWay"],
    note: "开场休眠，打已高能单位；搭配陨石开采机 / 三方" }
];
const TARGET_BY = Object.fromEntries(TARGETS.map(t => [t.kit, t]));

function appearance(c, kit) {
  const C = c.Rogue.CONFIG, info = c.enemyInfo(kit) || {}, regions = info.regions || [], out = [];
  const total = C.acts + (C.extraActs || 0);
  const levelsOf = act => act <= C.acts ? C.actLevels[act - 1] : (C.extraActLevels || [])[act - C.acts - 1];
  for (let act = 1; act <= total; act++) {
    const places = [[C.regions[(act - 1) % C.regions.length], "main"]];
    if (act <= C.acts && C.altRegions && C.altRegions[act]) places.push([C.altRegions[act], "alt"]);
    if (act >= 2 && C.sewer) places.push([C.sewer.region, "sewer"]);
    places.filter(([r]) => regions.includes(r)).forEach(([region, kind]) => out.push({ act, region, kind, levels: levelsOf(act) ? [...levelsOf(act)] : null }));
  }
  return out;
}
function enemyMeta(c, kit) {
  const info = c.enemyInfo(kit) || {};
  return {
    name: (c.enemyPresets().find(x => x.id === kit) || {}).name || kit,
    faction: info.faction || "—",
    rank: c.enemyRankOf({ kit }) || "minion",
    tokens: c.enemyTokens(kit),
    group: info.group || 1,
    regions: info.regions || [],
    appear: appearance(c, kit)
  };
}

const STATUS = { burn: "灼烧", corr: "腐蚀", frostbite: "冻伤", shock: "感电", shockwave: "震荡", reso: "共振", unstable: "不稳", weak: "虚弱", chase: "紧追", high: "高能" };

const isHero = (c, u) => !!u && u.isPlayer && !u.escort && !c.isWeaponUnit(u);

/* ---------- 机制计数（只读 wrap） ---------- */
function instrumentMech(c, job, m) {
  m.mech = {
    absorbs: 0, absorbedUnits: 0, giant: 0,
    pushes: 0, pushHazard: 0,
    marksSet: 0, markHits: 0,
    explodes: 0, explodeDmg: 0,
    alarms: 0, highApplied: 0,
    followUps: 0, splits: 0, spiderRevives: 0,
    cleanses: 0, guards: 0, sweeperBooms: 0
  };
  // 巨型活沙探针（只在 keep 臂、目标为 livesand 时填）
  m.giant = {
    transformed: 0, absorbAttempts: 0, diedWithoutFeed: 0,
    absorbedUnits: 0, absorbNames: [],
    snapshots: [], // 变巨瞬间属性
    giantEnemyTurns: 0, // 变巨后活着的敌人回合数
    giantDmg: 0, // 变巨后对英雄造成的伤害合计
    giantPhaseDmgs: [], // 每个敌人回合的伤害
    skillsUsed: { melee: 0, vortex: 0, pulse: 0 },
    survivedToPulse: 0
  };
  const wrap = (name, fn) => {
    const orig = c[name];
    if (typeof orig !== "function") return;
    c[name] = (...args) => fn(orig, args);
  };
  wrap("absorbSandsInto", (orig, args) => {
    const livesand = args[0];
    m.giant.absorbAttempts++;
    const notes = orig(...args);
    const text = (notes || []).join("\n");
    if (text.includes("吸收")) {
      m.mech.absorbs++;
      m.mech.absorbedUnits += (notes || []).filter(n => String(n).startsWith("吸收 ")).length;
    }
    if (text.includes("巨型") || text.includes("吸收后复活")) {
      m.mech.giant++;
      m.giant.transformed = 1;
      if (livesand) {
        const layers = (livesand.layers || []).map(l => ({
          type: l.type, current: Number(l.current) || 0, max: Number(l.max) || 0
        }));
        const sand = layers.find(l => l.type === "sand") || layers[0] || { current: 0, max: 0 };
        const shield = layers.filter(l => l.type === "shield").reduce((s, l) => s + l.current, 0);
        const armor = layers.filter(l => l.type === "armor").reduce((s, l) => s + l.current, 0);
        const absN = (notes || []).filter(n => String(n).startsWith("吸收 "));
        m.giant.absorbedUnits = absN.length;
        m.giant.absorbNames = absN.map(n => {
          const m2 = String(n).match(/^吸收 ([^：:]+)/);
          return m2 ? m2[1].trim() : "?";
        });
        const dice = livesand.dice || [0, 0];
        m.giant.snapshots.push({
          hp: layers.reduce((s, l) => s + l.current, 0),
          hpMax: layers.reduce((s, l) => s + l.max, 0),
          sandHp: sand.current, sandMax: sand.max,
          shield, armor,
          layers,
          atk: Number(livesand.atk) || 0,
          def: Number(livesand.def) || 0,
          defMax: Number(livesand.defMax) || 0,
          dice: Array.isArray(dice) ? [...dice] : [0, 0],
          skills: ["en_giant_sand_melee", "en_giant_sand_vortex", "en_giant_sand_pulse@3"],
          absorbedUnits: absN.length,
          absorbNames: m.giant.absorbNames.slice()
        });
        livesand._etGiantTracked = true;
      }
    } else if (text.includes("没有可吸收")) {
      m.giant.diedWithoutFeed++;
    }
    return notes;
  });
  wrap("runOnConnect", (orig, args) => {
    const [a, t, spec] = args;
    const z0 = t && Number(t.zone);
    const out = orig(...args);
    if (a && !a.isPlayer && t && t.isPlayer && spec && (spec.dest != null || /甩尾|扫开|推/.test(spec.reason || ""))) {
      m.mech.pushes++;
      const z1 = Number(t.zone);
      if (z0 !== z1) {
        const feats = (c.S.state.features || []).filter(f => Number(f.zone) === z1);
        if (feats.some(f => /quicksand|流沙|hazard|陷阱|coral/i.test(f.id || f.kind || f.name || ""))) m.mech.pushHazard++;
      }
    }
    if (spec && spec.status === "high" && t && t.isPlayer) m.mech.highApplied++;
    return out;
  });
  wrap("explodeBoomcar", (orig, args) => {
    m.mech.explodes++;
    const before = heroTaken(c);
    const out = orig(...args);
    m.mech.explodeDmg += Math.max(0, heroTaken(c) - before);
    return out;
  });
  wrap("alarmApplyHigh", (orig, args) => {
    m.mech.alarms++;
    return orig(...args);
  });
  wrap("alienOnDeath", (orig, args) => {
    const [u, notes] = args;
    const n0 = (notes || []).length;
    const out = orig(...args);
    const added = ((notes || []).slice(n0)).join("\n");
    if (/分裂成/.test(added)) m.mech.splits++;
    if (/复活/.test(added) || (u && u._linger)) { /* counted at spiderRoundEnd */ }
    return out;
  });
  wrap("spiderFollowUp", (orig, args) => {
    m.mech.followUps++;
    return orig(...args);
  });
  wrap("spiderRoundEnd", (orig, args) => {
    const notes = args[0] || [];
    const n0 = notes.length;
    const out = orig(...args);
    m.mech.spiderRevives += notes.slice(n0).filter(n => /复活了/.test(n)).length;
    return out;
  });
  // 下水道：清扫机自爆 / 代挡 / 净化
  wrap("sweeperSelfDestruct", (orig, args) => { m.mech.sweeperBooms++; return orig(...args); });
  // 巨型技能使用次数（runSkill 全局入口）
  wrap("runSkill", (orig, args) => {
    const id = args[0];
    const out = orig(...args);
    const aid = c.S.state && c.S.state.attackerId;
    const actor = aid && (c.S.state.units || []).find(u => u.id === aid);
    if (actor && actor.kit === "livesand" && actor.resources && actor.resources.giant) {
      if (id === "en_giant_sand_melee") m.giant.skillsUsed.melee++;
      if (id === "en_giant_sand_vortex") m.giant.skillsUsed.vortex++;
      if (id === "en_giant_sand_pulse") m.giant.skillsUsed.pulse++;
    }
    return out;
  });
  // 标定榴弹：资源写入
  const origApply = c.applyCombat;
  if (typeof origApply === "function") {
    c.applyCombat = (...args) => {
      const [t, res, a] = args;
      if (a && a.kit === "mecha_gl" && t && t.isPlayer && res && res.ok) {
        // 发射后 glZone 已清；用「同区能量范围伤」近似：攻击者本回合刚开过 glReady
        if (a.resources && (a.resources._etMarkHit || a.resources.glZone === Number(t.zone))) m.mech.markHits++;
      }
      return origApply(...args);
    };
  }
  // 钩 skill 路径里设定标定
  wrap("resolveEnemySkill", (orig, args) => {
    // may not exist — try enemy skill dispatcher names
    return orig(...args);
  });
  // Patch mecha gl zone set by wrapping a thin poll in startEnemyPhase below
  return m;
}
function heroTaken(c) {
  const S = c.S.state;
  return (S.units || []).filter(u => isHero(c, u)).reduce((s, u) => s + (((S.battleStats || {})[u.id] || {}).taken || 0), 0);
}

/** 基础伤害/控场计数（复用 solo 思路，混合场把伤害按 kit 分桶） */
function instrument(c, job) {
  const S = c.S;
  const m = { dmg: 0, direct: 0, dot: 0, friendly: 0, brk: 0, hits: 0, hitDmg: 0, staggers: 0, downs: 0,
    heroTurns: 0, stunTurns: 0, loseApTurns: 0, unstableTurns: 0, downTurns: 0, status: {}, statusSeen: 0,
    enemyPhases: 0, unitRounds: 0, tokenRounds: 0, phaseDmg: [], kits: {},
    targetDmg: 0, targetDot: 0, targetBrk: 0, targetStaggers: 0, targetDowns: 0 };
  const now = { key: null, phase: 0, weight: 1, inCombat: 0 };
  const wrap = (name, fn) => { const orig = c[name]; if (typeof orig !== "function") throw new Error("missing " + name); c[name] = (...args) => fn(orig, args); };
  const kitOf = u => (u && (u.kit || u.name)) || "?";
  const bucket = key => m.kits[key] || (m.kits[key] = { dmg: 0, dot: 0, brk: 0, downs: 0, staggers: 0 });
  const heroes = () => S.state.units.filter(u => isHero(c, u));
  const isTarget = key => key === job.kit;
  wrap("applyCombat", (orig, args) => {
    const [t, res, a] = args;
    const mine = t && t.isPlayer && !t.escort && res && res.ok && !res.pending && !(typeof c.isDownProtected === "function" && c.isDownProtected(t));
    if (!mine) return orig(...args);
    const friendly = !!(a && a.isPlayer);
    const key = friendly ? null : a ? kitOf(a) : "dot";
    const before = heroes().map(u => [u, Number(u.def) || 0, !!u.stunned]);
    const prev = now.key; now.key = key || now.key; now.inCombat++;
    let out;
    try { out = orig(...args); } finally { now.key = prev; now.inCombat--; }
    const dmg = Math.floor(Number(res.total) || 0) + Math.floor(Number(res.shpDealt) || 0);
    const brk = before.reduce((s, [u, d]) => s + Math.max(0, d - (Number(u.def) || 0)), 0);
    const stg = before.filter(([u, , st]) => !st && u.stunned).length;
    if (friendly) { m.friendly += dmg; return out; }
    const k = bucket(key);
    if (a) { k.dmg += dmg; m.direct += dmg; if (dmg > 0) { m.hits++; m.hitDmg += dmg; } } else { k.dot += dmg; m.dot += dmg; }
    k.brk += brk; k.staggers += stg;
    m.dmg += dmg; m.brk += brk; m.staggers += stg;
    if (isTarget(key)) { if (a) m.targetDmg += dmg; else m.targetDot += dmg; m.targetBrk += brk; m.targetStaggers += stg; }
    if (now.phase) m.phaseDmg[now.phase - 1] = (m.phaseDmg[now.phase - 1] || 0) + dmg;
    // 巨型活沙：变巨后对英雄的伤害
    if (a && a.kit === "livesand" && a.resources && a.resources.giant && a._etGiantTracked && dmg > 0) {
      m.giant.giantDmg += dmg;
      if (now._giantPhaseIdx != null) {
        m.giant.giantPhaseDmgs[now._giantPhaseIdx] = (m.giant.giantPhaseDmgs[now._giantPhaseIdx] || 0) + dmg;
      }
    }
    // mecha mark hit heuristic: attacker mecha_gl damaging hero while gl was armed
    if (a && a.kit === "mecha_gl" && a.resources && (a.resources.glReady || a.resources._firedGl)) {
      m.mech && (m.mech.markHits++);
      if (a.resources) a.resources._firedGl = true;
    }
    return out;
  });
  wrap("dealBreak", (orig, args) => {
    const [u, , , , , opt] = args, by = opt && opt.by;
    if (!isHero(c, u) || !by || by.isPlayer || now.inCombat) return orig(...args);
    const d0 = Number(u.def) || 0, st0 = !!u.stunned;
    const out = orig(...args);
    const brk = Math.max(0, d0 - (Number(u.def) || 0)), stg = !st0 && u.stunned ? 1 : 0;
    const k = bucket(kitOf(by));
    k.brk += brk; k.staggers += stg; m.brk += brk; m.staggers += stg;
    if (by.kit === job.kit) { m.targetBrk += brk; m.targetStaggers += stg; }
    return out;
  });
  wrap("applyKnockdown", (orig, args) => {
    const u = args[0], hero = isHero(c, u), down0 = hero && !!u.dying;
    const out = orig(...args);
    if (hero && !down0 && u.dying) {
      m.downs++;
      if (now.key) bucket(now.key).downs++;
      if (now.key === job.kit) m.targetDowns++;
    }
    return out;
  });
  wrap("startPlayerPhase", (orig, args) => {
    heroes().filter(u => !u.dead && !u.hidden).forEach(u => {
      m.heroTurns++;
      if (u.dying && !u.upOnShp) { m.downTurns++; return; }
      if (u.stunned) m.stunTurns++;
      else {
        if (u.loseApNext) m.loseApTurns++;
        if (u.statuses && u.statuses.unstable) m.unstableTurns++;
      }
    });
    now.phase = 0;
    return orig(...args);
  });
  wrap("startEnemyPhase", (orig, args) => {
    m.enemyPhases++;
    now.phase = m.enemyPhases;
    const live = c.EnemyAI.foes().filter(u => u.kit === job.kit);
    m.unitRounds += live.length;
    m.tokenRounds += live.length * now.weight;
    // mecha: track mark set
    (c.S.state.units || []).filter(u => u.kit === "mecha_gl" && !u.dead).forEach(u => {
      if (u.resources && u.resources.glPending && u.resources.glZone && !u.resources._etMarked) {
        u.resources._etMarked = true;
        if (m.mech) m.mech.marksSet++;
      }
      if (u.resources && u.resources.glReady) u.resources._firedGl = true;
    });
    // 巨型活沙存活敌人回合
    now._giantPhaseIdx = null;
    const giants = (c.S.state.units || []).filter(u =>
      u.kit === "livesand" && u._etGiantTracked && u.resources && u.resources.giant && !u.dead && !u.hidden && !u._removed
    );
    if (giants.length) {
      now._giantPhaseIdx = m.giant.giantPhaseDmgs.length;
      m.giant.giantPhaseDmgs.push(0);
      m.giant.giantEnemyTurns += giants.length;
      giants.forEach(g => {
        if ((g.resources.giantTurns || 0) >= 3) m.giant.survivedToPulse = 1;
      });
    }
    return orig(...args);
  });
  wrap("endEnemyTurn", (orig, args) => {
    heroes().filter(u => !u.dead && !u.hidden).forEach(u => {
      m.statusSeen++;
      Object.keys(STATUS).forEach(k => { const v = u.statuses && u.statuses[k]; if (v) m.status[k] = (m.status[k] || 0) + 1; });
    });
    return orig(...args);
  });
  instrumentMech(c, job, m);
  return { m, now };
}

/* ---------- 抽样真实遭遇 ---------- */
function encHasKit(enc, kit) {
  return (enc.enemies || []).some(e => e.preset === kit || e.id === kit);
}
function encKits(enc) {
  const out = [];
  (enc.enemies || []).forEach(e => {
    const id = e.preset || e.id;
    const n = Math.max(1, Number(e.count) || 1);
    for (let i = 0; i < n; i++) out.push(id);
  });
  return out;
}
function cloneEnc(enc) { return B.clone(enc); }

/** 去掉目标，按被去掉的代币数塞入等量 dust_bug 占位（中立、0 代币、不进攻） */
function dropTarget(c, enc, kit) {
  const out = cloneEnc(enc);
  const tok = Math.max(1, Number(c.enemyTokens(kit)) || 1);
  const fillers = [];
  const kept = [];
  (out.enemies || []).forEach(e => {
    const id = e.preset || e.id;
    if (id === kit) {
      const n = Math.max(1, Number(e.count) || 1);
      const slots = tok * n;
      for (let i = 0; i < slots; i++) fillers.push({ preset: MIXED.filler, count: 1, zone: e.zone || 2 });
    } else kept.push(e);
  });
  out.enemies = kept.concat(fillers);
  out.name = (out.name || "遭遇") + `（去掉 ${kit}）`;
  out._dropped = kit;
  return out;
}

/** 拒绝抽样：固定种子序列下 rollEncounter 直到含 kit */
function sampleEncounter(c, job) {
  const t = TARGET_BY[job.kit];
  const regions = (t && t.regions) || (c.enemyInfo(job.kit) || {}).regions || ["外城区"];
  const seedBase = `${MIXED.seedPrefix}:enc:${job.kit}:${job.variant || "nat"}:${job.index}`;
  // 变体强制
  const force = {};
  if (job.variant === "sand") force.weather = "sand";
  if (job.variant === "glow") force.weather = "glow";
  if (job.variant === "day") force.weather = "none";
  if (job.variant === "night") force.weather = "none"; // 夜晚靠 clock
  if (job.variant === "threeWay") force.threeWay = true;

  for (let tryI = 0; tryI < MIXED.maxSampleTries; tryI++) {
    c.S.RNG.install(`${seedBase}:try:${tryI}`);
    const region = regions[tryI % regions.length];
    let enc;
    try {
      enc = c.rollEncounter(Object.assign({ region }, force));
    } catch (e) { continue; }
    if (!encHasKit(enc, job.kit)) continue;
    // 可选：希望有盟友时，优先留下有盟友的（前 80% tries 要求；之后放宽）
    if (t && t.wantAllies && t.wantAllies.length && tryI < MIXED.maxSampleTries * 0.8) {
      const kits = new Set(encKits(enc));
      if (!t.wantAllies.some(a => kits.has(a))) continue;
    }
    // glow 变体：强制天气
    if (job.variant === "glow") enc.weather = "glow";
    if (job.variant === "sand") enc.weather = "sand";
    if (job.variant === "day") enc.weather = "none";
    return enc;
  }
  // 合成兜底：保证能跑
  return craftEncounter(c, job);
}

/** 合成典型编队（真实抽不到时 / eliteAssume / 机制专项） */
function craftEncounter(c, job) {
  const t = TARGET_BY[job.kit];
  const region = ((t && t.regions) || ["外城区"])[0];
  const layout = "front2";
  const rows = [];
  const add = (preset, count, zone) => rows.push({ preset, count: count || 1, zone: zone || 2 });
  add(job.kit, 1, 2);
  if (job.kit === "livesand") {
    add("sand_beast", 1, 2); add("sand_human", 1, 2); add("bigsand", 1, 2);
    add("dustbody", 1, 2); add("sandfish_drive", 1, 2);
  } else if (job.kit === "sandfish_drive") {
    add("sandfish_ambush", 1, 3); add("sandfish_lead", 1, 2); add("sandfish_drive", 1, 2);
  } else if (job.kit === "sewer_cleaner" || job.kit === "sewer_keeper") {
    add("sewer_sweeper", 1, 2);
    if (job.kit === "sewer_cleaner") add("sewer_keeper", 1, 2);
    else add("sewer_cleaner", 1, 2);
  } else if (job.kit === "meteor_centipede") {
    add("meteor_spider", 2, 2); // group 2 → count is groups; use two rows
    add("meteor_spider", 1, 2);
  } else if (job.kit === "alarm_bot") {
    add("meteor_miner", 1, 2); add("meteor_spider", 1, 2);
  } else if (job.kit === "sand_human") {
    add("livesand", 1, 2); add("sand_beast", 1, 2);
  } else if (job.kit === "boomcar") {
    add("guard_gun", 1, 2); add("thug_knife", 1, 2);
  } else if (job.kit === "mecha_gl") {
    add("mecha_mg", 1, 2);
  } else if (job.kit === "captain_lizard") {
    add("guard_sword", 1, 2); add("guard_gun", 1, 2);
  } else if (job.kit === "guard_gun") {
    add("guard_sword", 1, 2); add("boomcar", 1, 2);
  }
  const weather = job.variant === "glow" ? "glow" : job.variant === "sand" ? "sand" : "none";
  const zoneMode = job.variant === "threeWay" ? 3 : 2;
  let enc = c.finishEncounter({
    name: `合成 · ${job.kit}`, region, faction: null, tier: "normal",
    tokens: 4, mixed: false, enemies: rows, layout, vehicles: []
  }, { zoneMode, weather });
  // 保留 finish 带来的区域天气覆盖；变体再强制
  if (job.variant === "glow") enc.weather = "glow";
  if (job.variant === "sand") enc.weather = "sand";
  enc._crafted = true;
  return enc;
}

function applyClock(c, job) {
  // #416 盲区：solo 把 hours 清零、clock 停在白天。混编按变体设 clock。
  if (job.variant === "night" || job.variant === "sand") {
    c.S.LEDGER.clock = 20 * 60; // 20:00 夜晚；沙暴本身也按夜，双保险
  } else if (job.variant === "day") {
    c.S.LEDGER.clock = 10 * 60; // 10:00 白天
  } else {
    // natural：保留遭遇天气；clock 用白天，让 weather=sand 单独体现漠汛夜
    c.S.LEDGER.clock = 10 * 60;
  }
}

function prepare(c, job) {
  const R = c.Rogue, partySeed = `${MIXED.seedPrefix}:party:${job.size}:${job.index}`;
  c.S.RNG.install(partySeed + ":setup");
  const run = R.newRun({ party: B.partyFor(partySeed, job.size), seed: partySeed });
  run.act = 3; run.actDay = 0; R.makeBoard(run); R.acceptTask(run, "main");
  run.task.nodes[run.task.index] = { type: "battle", done: false };
  const spec = R.battleSpec(run);
  if (!spec) throw new Error("Missing battle specification");
  const level = job.level;
  run.party.forEach(h => {
    const from = h.level || 1; h.level = level; h.xp = 0; h.hp = null; h.shp = null;
    R.queueLevelRewards(h, from, level, [], run);
    Object.keys(h.weaponLevels || {}).forEach(k => { h.weaponLevels[k] = Math.max(1, Math.min(10, Math.round(level * 0.6))); });
  });
  B.chooseLevels(R, run, []);
  run.party.forEach(h => { h.hp = null; h.shp = null; h.weaponState = {}; });
  c.S.LEDGER.dur = {}; c.S.LEDGER.weapons = {}; c.S.LEDGER.heroes = {}; c.S.LEDGER.hours = 0;
  applyClock(c, job);
  return { run, spec };
}

function runMixedJob(job) {
  const row = {
    mode: "mixed", group: "unit", kit: job.kit, level: job.level, size: job.size,
    index: job.index, arm: job.arm, variant: job.variant || "natural", outcome: "error"
  };
  try {
    const c = H.load();
    const { m, now } = instrument(c, job);
    const { spec } = prepare(c, job);
    spec.level = job.level;
    let enc = sampleEncounter(c, job);
    const crafted = !!enc._crafted;
    if (job.arm === "drop") enc = dropTarget(c, enc, job.kit);
    // 保留天气 / 配置物 / 载具（修 #416 中性战场盲区）
    spec.encounter = enc;
    spec.seed = `${MIXED.seedPrefix}:battle:${job.kit}:${job.variant || "nat"}:${job.arm}:${job.level}:${job.size}:${job.index}`;
    // eliteAssume：不改 ENEMY_INFO，只在报告里标注；战场仍按游戏 1 代币生成的真实/合成编队
    c.BattleSim.setup(spec);
    applyClock(c, job); // setup 可能重置
    const S = c.S.state, heroes = S.units.filter(u => isHero(c, u));
    const foesAll = S.units.filter(u => !u.isPlayer && !u.hidden && !u.dead && !(c.enemyInfo(u.kit) || {}).neutral);
    const targets = foesAll.filter(u => u.kit === job.kit);
    if (job.arm === "keep" && !targets.length) throw new Error("No target enemy on field");
    if (job.arm === "drop" && targets.length) throw new Error("Target still on field after drop");
    now.weight = Math.max(1, Number(c.enemyTokens(job.kit)) || 1);
    // eliteAssume 对照：报告用 2 代币折算（不改生成）
    if (job.eliteAssume) now.weight = 2;
    const maxHp = u => (u.layers || []).reduce((s, l) => s + Math.max(0, Number(l.max) || 0), 0);
    Object.assign(row, {
      party: heroes.map(u => u.kit),
      heroLevels: heroes.map(u => u.level),
      zoneMode: S.zoneMode, weather: S.weather, light: S.light || null,
      clock: c.S.LEDGER.clock, crafted,
      features: (enc.features || []).map(f => f.id || f.kind || f.name || "?").slice(0, 12),
      vehicles: (enc.vehicles || []).map(v => v.id || v.kit || v).slice(0, 8),
      enemies: foesAll.map(u => u.kit),
      enemyCounts: foesAll.reduce((a, u) => { a[u.kit] = (a[u.kit] || 0) + 1; return a; }, {}),
      targetUnits: targets.length,
      units: foesAll.length,
      heroHp: heroes.reduce((s, u) => s + maxHp(u), 0),
      heroDef: heroes.reduce((s, u) => s + (Number(u.defMax) || 0), 0),
      foeHp: foesAll.reduce((s, u) => s + maxHp(u), 0)
    });
    // boomcar 装甲疑点：记录上场时的层
    if (job.kit === "boomcar" && targets[0]) {
      row.boomLayers = (targets[0].layers || []).map(l => ({ type: l.type, max: l.max }));
    }
    const res = c.BattleSim.run({ maxRounds: MIXED.maxRounds });
    row.outcome = res.winner === "player" ? "win" : res.winner === "enemy" ? "lose" : res.winner === "timeout" ? "timeout" : "error";
    const taken = heroes.reduce((s, u) => s + (((S.battleStats || {})[u.id] || {}).taken || 0), 0);
    Object.assign(row, { rounds: res.rounds, deaths: heroes.filter(u => u.dead).length, takenGame: taken }, B.clone(m));
    if (c.__errors.length) throw new Error(`Rule console.error: ${c.__errors.join(" | ")}`);
  } catch (e) { row.outcome = "error"; row.error = e.stack || String(e); }
  return B.clone(row);
}

/* ---------- 计划 ---------- */
function variantsFor(t) {
  if (t.variants && t.variants.length) return t.variants;
  return ["natural"];
}
function planMixed(opt = {}) {
  const n = opt.samples || MIXED.samples;
  const levels = opt.levels || MIXED.levels;
  const sizes = opt.sizes || MIXED.sizes;
  const kits = opt.kits || TARGETS.map(t => t.kit);
  const jobs = [];
  for (const kit of kits) {
    const t = TARGET_BY[kit];
    if (!t) throw new Error("Unknown mixed kit: " + kit);
    for (const variant of variantsFor(t)) {
      for (const level of levels) for (const size of sizes) for (let i = 0; i < n; i++) {
        for (const arm of ["keep", "drop"]) {
          jobs.push({ mode: "mixed", kit, level, size, index: i, arm, variant, eliteAssume: !!t.eliteAssume && variant !== "natural" ? false : !!t.eliteAssume });
        }
      }
    }
  }
  return jobs;
}

/* ---------- 汇总 ---------- */
function summarize(rows) {
  const ok = rows.filter(r => r.outcome !== "error");
  const n = ok.length;
  const sum = f => ok.reduce((a, r) => a + (Number(f(r)) || 0), 0);
  const avg = f => n ? sum(f) / n : null;
  const ratio = (f, g) => sum(g) ? sum(f) / sum(g) : null;
  const outcomes = { win: 0, lose: 0, timeout: 0, error: 0 };
  rows.forEach(r => { outcomes[r.outcome] = (outcomes[r.outcome] || 0) + 1; });
  const status = {};
  ok.forEach(r => Object.keys(r.status || {}).forEach(k => { status[k] = (status[k] || 0) + r.status[k]; }));
  const seen = sum(r => r.statusSeen);
  Object.keys(status).forEach(k => { status[k] = seen ? status[k] / seen : 0; });
  const mech = {};
  ok.forEach(r => Object.keys(r.mech || {}).forEach(k => { mech[k] = (mech[k] || 0) + (Number(r.mech[k]) || 0); }));
  Object.keys(mech).forEach(k => { mech[k] = n ? mech[k] / n : 0; });
  const craftedRate = n ? ok.filter(r => r.crafted).length / n : 0;
  return {
    n: rows.length, ok: n, outcomes,
    winRate: n ? outcomes.win / n : null,
    rounds: avg(r => r.rounds),
    share: avg(r => r.heroHp ? r.dmg / r.heroHp : 0),
    dmg: avg(r => r.dmg), direct: avg(r => r.direct), dot: avg(r => r.dot),
    targetShare: avg(r => r.heroHp ? (r.targetDmg + r.targetDot) / r.heroHp : 0),
    targetDmg: avg(r => r.targetDmg + r.targetDot),
    brk: avg(r => r.brk), staggers: avg(r => r.staggers), downs: avg(r => r.downs), deaths: avg(r => r.deaths),
    stunShare: ratio(r => r.stunTurns, r => r.heroTurns),
    lostShare: ratio(r => 2 * r.stunTurns + r.loseApTurns + r.unstableTurns, r => 2 * r.heroTurns),
    heroHp: avg(r => r.heroHp), units: avg(r => r.units), targetUnits: avg(r => r.targetUnits),
    tokenRounds: avg(r => r.tokenRounds),
    status, mech, craftedRate,
    weatherMix: weatherHist(ok), featureRate: avg(r => (r.features || []).length > 0 ? 1 : 0)
  };
}
function weatherHist(rows) {
  const h = {};
  rows.forEach(r => { const w = r.weather || "none"; h[w] = (h[w] || 0) + 1; });
  return h;
}
function pairKey(r) { return [r.kit, r.variant || "natural", r.level, r.size, r.index].join("|"); }

function summarizeMixed(rows) {
  // 按 kit|variant|level|size|arm 与 all-size；并做 keep-drop 成对 Δ
  const by = new Map();
  const add = (k, r) => { if (!by.has(k)) by.set(k, []); by.get(k).push(r); };
  rows.forEach(r => {
    add([r.kit, r.variant, r.level, r.size, r.arm].join("|"), r);
    add([r.kit, r.variant, r.level, "all", r.arm].join("|"), r);
  });
  const summary = {};
  by.forEach((list, k) => { summary[k] = summarize(list); });

  // 成对差分：同一 index 的 keep vs drop
  const deltas = {};
  const groups = new Map();
  rows.forEach(r => {
    const k = pairKey(r);
    if (!groups.has(k)) groups.set(k, {});
    groups.get(k)[r.arm] = r;
  });
  const deltaList = new Map(); // kit|variant|level|size → list of delta
  groups.forEach((pair, k) => {
    if (!pair.keep || !pair.drop) return;
    if (pair.keep.outcome === "error" || pair.drop.outcome === "error") return;
    const d = {
      dShare: (pair.keep.heroHp ? pair.keep.dmg / pair.keep.heroHp : 0) - (pair.drop.heroHp ? pair.drop.dmg / pair.drop.heroHp : 0),
      dWin: (pair.keep.outcome === "win" ? 1 : 0) - (pair.drop.outcome === "win" ? 1 : 0),
      dStun: (pair.keep.heroTurns ? pair.keep.stunTurns / pair.keep.heroTurns : 0) - (pair.drop.heroTurns ? pair.drop.stunTurns / pair.drop.heroTurns : 0),
      dLost: (pair.keep.heroTurns ? (2 * pair.keep.stunTurns + pair.keep.loseApTurns + pair.keep.unstableTurns) / (2 * pair.keep.heroTurns) : 0)
        - (pair.drop.heroTurns ? (2 * pair.drop.stunTurns + pair.drop.loseApTurns + pair.drop.unstableTurns) / (2 * pair.drop.heroTurns) : 0),
      dDmg: pair.keep.dmg - pair.drop.dmg,
      targetShare: pair.keep.heroHp ? (pair.keep.targetDmg + pair.keep.targetDot) / pair.keep.heroHp : 0,
      mech: pair.keep.mech || {}
    };
    const parts = k.split("|"); // kit variant level size index
    const gk = [parts[0], parts[1], parts[2], parts[3]].join("|");
    const gkAll = [parts[0], parts[1], parts[2], "all"].join("|");
    if (!deltaList.has(gk)) deltaList.set(gk, []);
    if (!deltaList.has(gkAll)) deltaList.set(gkAll, []);
    deltaList.get(gk).push(d);
    deltaList.get(gkAll).push(d);
  });
  deltaList.forEach((list, k) => {
    const n = list.length;
    const avg = f => n ? list.reduce((a, x) => a + (Number(f(x)) || 0), 0) / n : null;
    const mech = {};
    list.forEach(d => Object.keys(d.mech || {}).forEach(key => { mech[key] = (mech[key] || 0) + (Number(d.mech[key]) || 0); }));
    Object.keys(mech).forEach(key => { mech[key] = n ? mech[key] / n : 0; });
    deltas[k] = { n, dShare: avg(x => x.dShare), dWin: avg(x => x.dWin), dStun: avg(x => x.dStun), dLost: avg(x => x.dLost), dDmg: avg(x => x.dDmg), targetShare: avg(x => x.targetShare), mech };
  });
  return { summary, deltas };
}

/* ---------- 报告 ---------- */
const pct = x => x == null ? "—" : (x * 100).toFixed(1) + "%";
const pct0 = x => x == null ? "—" : (x * 100).toFixed(0) + "%";
const f1 = x => x == null ? "—" : Number(x).toFixed(1);
const f2 = x => x == null ? "—" : Number(x).toFixed(2);
const MARK = "<!-- 手写分析：重跑工具时，这一行以下的内容保留 -->";


/** 巨型活沙变巨瞬间属性 + 变巨后每敌人回合伤害（只看 keep 臂） */
function summarizeGiant(rows) {
  const keep = rows.filter(r => r.arm === "keep" && r.outcome !== "error" && r.giant);
  const by = new Map();
  const add = (k, r) => { if (!by.has(k)) by.set(k, []); by.get(k).push(r); };
  keep.forEach(r => {
    add([r.variant, r.level, r.size].join("|"), r);
    add([r.variant, r.level, "all"].join("|"), r);
    add(["all", r.level, r.size].join("|"), r);
    add(["all", r.level, "all"].join("|"), r);
  });
  const out = {};
  by.forEach((list, k) => {
    const n = list.length;
    const xf = list.filter(r => r.giant.transformed);
    const snaps = xf.flatMap(r => r.giant.snapshots || []);
    const avg = (xs, f) => xs.length ? xs.reduce((a, x) => a + (Number(f(x)) || 0), 0) / xs.length : null;
    const heroHpEach = avg(list, r => r.heroHp && (r.party || []).length ? r.heroHp / r.party.length : 0);
    // 每敌人回合伤害：只对变巨成功且至少活过 1 敌人回合的场
    const perTurn = [];
    xf.forEach(r => {
      const turns = r.giant.giantEnemyTurns || 0;
      if (turns > 0) perTurn.push(r.giant.giantDmg / turns);
      else perTurn.push(0);
    });
    const dmgPerTurn = perTurn.length ? perTurn.reduce((a, x) => a + x, 0) / perTurn.length : null;
    const skills = { melee: 0, vortex: 0, pulse: 0 };
    xf.forEach(r => {
      const s = r.giant.skillsUsed || {};
      skills.melee += s.melee || 0; skills.vortex += s.vortex || 0; skills.pulse += s.pulse || 0;
    });
    Object.keys(skills).forEach(key => { skills[key] = xf.length ? skills[key] / xf.length : 0; });
    out[k] = {
      n, transformed: xf.length, transformRate: n ? xf.length / n : 0,
      diedWithoutFeed: avg(list, r => r.giant.diedWithoutFeed),
      absorbAttempts: avg(list, r => r.giant.absorbAttempts),
      absorbedUnits: avg(xf, r => r.giant.absorbedUnits), // 变巨时吸了几只
      absorbedUnitsAll: avg(list, r => r.giant.absorbedUnits),
      // 变巨瞬间
      hp: avg(snaps, s => s.hp), hpMax: avg(snaps, s => s.hpMax),
      sandHp: avg(snaps, s => s.sandHp), sandMax: avg(snaps, s => s.sandMax),
      shield: avg(snaps, s => s.shield), armor: avg(snaps, s => s.armor),
      atk: avg(snaps, s => s.atk), def: avg(snaps, s => s.def), defMax: avg(snaps, s => s.defMax),
      dice: snaps.length ? [
        avg(snaps, s => (s.dice && s.dice[0]) || 0),
        avg(snaps, s => (s.dice && s.dice[1]) || 0)
      ] : [0, 0],
      // 变巨后
      giantEnemyTurns: avg(xf, r => r.giant.giantEnemyTurns),
      giantDmg: avg(xf, r => r.giant.giantDmg),
      dmgPerEnemyTurn: dmgPerTurn,
      dmgPerTurnShareOfHero: (dmgPerTurn != null && heroHpEach) ? dmgPerTurn / heroHpEach : null,
      heroHpEach,
      survivedToPulseRate: xf.length ? xf.filter(r => r.giant.survivedToPulse).length / xf.length : 0,
      skillsPerBattle: skills,
      skills: ["en_giant_sand_melee（近·至多2目标·atk物理1击破）", "en_giant_sand_vortex（远·区内全员·atk物理2击破+失去行动）", "en_giant_sand_pulse（存活≥3敌人回合后·全域atk物理）"]
    };
  });
  return out;
}

function markdownGiant(report) {
  const g = report.giantProbe;
  if (!g) return "";
  const l = [];
  const f1 = x => x == null ? "—" : Number(x).toFixed(1);
  const f2 = x => x == null ? "—" : Number(x).toFixed(2);
  const pct = x => x == null ? "—" : (x * 100).toFixed(1) + "%";
  l.push("## 4. 巨型活沙变巨瞬间属性与变巨后每回合伤害", "",
    "只测量，不改数值。探针 `--probe-livesand-giant`：沙漠 keep 臂，变体 day / night / sand；等级 15 / 20；人数 2 / 3 / 4。", "",
    "### 代码公式（`enemies.js` · `absorbSandsInto`）", "",
    "- 饲料：`LIVESAND_FEED_KITS` = 沙灵四足/人形、大沙灵、扬尘体；`LIVESAND_FEED_FACTIONS` = 沙漠生物（沙鱼）。**不吸收其他活沙**、尘虫/管虫。",
    "- 活沙本体预设（`engine.js`）：沙尘 `scaleHp(20+(lv-1), p)`，架势 4（再经 `unitOf`/`scaleDef`），ATK **固定 7**，骰子 `[0,0]`（技能不掷骰，纯 `mult×atk`）。",
    "- 变巨时对每只饲料：沙尘层 `current/max += totalHp(饲料)`；`atk += 饲料.atk`；`def`/`defMax` **各 +1**；饲料当场死亡。",
    "- 复活：`resources.giant=true`，`giantTurns=0`，改名「巨型活沙」，`dead=false`。无护盾/护甲层（仍是单层 sand）。",
    "- 技能：近距穿刺（至多 2 目标，各 atk 物理 1 击破）；远距流沙漩涡（区内全员 atk 物理 2 击破+失去行动）；**存活满 3 个敌人回合**后解锁全域沙暴（全场 atk 物理）。", "",
    "### 变巨率 / 吸收数 / 存活（keep，人数合并）", "",
    "|变体|等级|变巨率|吸单位/次变巨|无饲料死亡/场|巨型存活敌人回合|撑到脉冲率|变巨后总伤|每敌人回合伤|占单角色满血%|",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const v of ["day", "night", "sand"]) {
    for (const L of (report.options && report.options.levels) || [15, 20]) {
      const s = g[`${v}|${L}|all`];
      if (!s) continue;
      l.push(`|${v}|${L}|${pct(s.transformRate)}|${f2(s.absorbedUnits)}|${f2(s.diedWithoutFeed)}|${f2(s.giantEnemyTurns)}|${pct(s.survivedToPulseRate)}|${f1(s.giantDmg)}|${f1(s.dmgPerEnemyTurn)}|${pct(s.dmgPerTurnShareOfHero)}|`);
    }
  }
  l.push("", "### 变巨瞬间平均属性（成功变巨的场）", "",
    "|变体|等级|人数|HP(当前/max)|盾|甲|架势|ATK|骰子|吸单位|",
    "|---|---:|---:|---:|---:|---:|---:|---:|---|---:|");
  for (const v of ["day", "night", "sand"]) {
    for (const L of (report.options && report.options.levels) || [15, 20]) {
      for (const sz of (report.options && report.options.sizes) || [2, 3, 4]) {
        const s = g[`${v}|${L}|${sz}`];
        if (!s || !s.transformed) continue;
        l.push(`|${v}|${L}|${sz}|${f1(s.hp)}/${f1(s.hpMax)}|${f1(s.shield)}|${f1(s.armor)}|${f1(s.def)}/${f1(s.defMax)}|${f1(s.atk)}|${f1(s.dice[0])}d${f1(s.dice[1])}|${f2(s.absorbedUnits)}|`);
      }
    }
  }
  l.push("", "### 按人数的每回合伤害（变体合并 all）", "",
    "|等级|人数|变巨率|HP|ATK|架势|存活回合|每回合伤|占单角色满血%|角色满血|",
    "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const L of (report.options && report.options.levels) || [15, 20]) {
    for (const sz of (report.options && report.options.sizes) || [2, 3, 4]) {
      const s = g[`all|${L}|${sz}`];
      if (!s) continue;
      l.push(`|${L}|${sz}|${pct(s.transformRate)}|${f1(s.hp)}|${f1(s.atk)}|${f1(s.def)}/${f1(s.defMax)}|${f2(s.giantEnemyTurns)}|${f1(s.dmgPerEnemyTurn)}|${pct(s.dmgPerTurnShareOfHero)}|${f1(s.heroHpEach)}|`);
    }
  }
  l.push("");
  return l.join("\n");
}

function aloneLookup(alone, kit, level) {
  if (!alone || !alone.summary) return null;
  return alone.summary[`${kit}|${level}|all`] || null;
}

function markdownMixed(report) {
  const P = report.provenance, o = report.options, l = [];
  const alone = report.alone || {};
  l.push(`# 混编遇敌里的敌人实际贡献（接 #401 / 单一兵种报告）`, "",
    "只测量，不改任何数值。由 `tools/enemy-threat.js --mixed` 生成。重跑覆盖到「手写分析」标记为止。", "",
    `- 版本：提交 \`${P.commit || "未知"}\`${P.dirty ? "（有未提交改动）" : ""}；规则 SHA256 \`${(P.sourceHash || "").slice(0, 16)}…\`；工具 ${MIXED.version}`,
    `- 命令：\`${P.command}\``,
    `- 样本：每格（敌人 × 变体 × 等级 × 人数 × keep/drop）**${o.samples} 场**；等级 ${o.levels.join(" / ")}；人数 ${o.sizes.join(" / ")}；共 ${report.rows} 场，异常 ${report.errors}。`,
    `- 种子前缀 \`${MIXED.seedPrefix}\`。遭遇用游戏 \`rollEncounter\` 拒绝抽样（含目标）；抽不到时用合成编队兜底（json 里 \`crafted\`）。`,
    "- **keep**：原遭遇（保留天气 / 配置物 / 载具 / 昼夜）。**drop**：去掉目标，按被去掉代币数塞入等量中立 \`dust_bug\` 占位。",
    "- **贡献 Δ**：同种子 keep − drop 的整场伤害占比、胜率、失衡、失去行动。机制计数只看 keep 臂。",
    "- 变体：活沙 / 赶潮沙鱼 day/night/sand；弦蚣 natural/glow；警戒 natural/threeWay。修 #416：不再把 clock 卡在白天、天气清空。",
    "- 对照「单独 4 代币」数字来自 \`enemy-threat-1026.json\`（同等级 all 人数）。", "");

  l.push("## 1. 总表（15 / 20 级，人数合并）", "");
  l.push("|敌人|变体|等级|单独占比|混编 keep 占比|Δ 占比（keep−drop）|目标自身占比|keep 胜率|Δ 胜率|失衡 keep|Δ 失去行动|机制（/场）|合成率|");
  l.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|");
  for (const t of TARGETS.filter(x => report.kits.includes(x.kit))) {
    for (const v of variantsFor(t)) {
      for (const L of o.levels) {
        const keep = report.summary[`${t.kit}|${v}|${L}|all|keep`];
        const drop = report.summary[`${t.kit}|${v}|${L}|all|drop`];
        const d = report.deltas[`${t.kit}|${v}|${L}|all`];
        if (!keep) continue;
        const a = aloneLookup(alone, t.kit, L);
        const mech = formatMech(keep.mech, t.mech);
        l.push(`|${report.meta[t.kit].name}（\`${t.kit}\`）|${v}|${L}|${a ? pct(a.share) : "—"}|**${pct(keep.share)}**|${d ? pct(d.dShare) : "—"}|${pct(keep.targetShare)}|${pct(keep.winRate)}|${d ? pct(d.dWin) : "—"}|${pct(keep.stunShare)}|${d ? pct(d.dLost) : "—"}|${mech}|${pct0(keep.craftedRate)}|`);
      }
    }
  }
  l.push("");
  l.push("## 2. 机制是否打出（keep 臂，人数合并，取最高等级）", "");
  l.push("|敌人|变体|吸收次|吸收单位|巨型|推人|推进危险|标定|标定命中|自爆|自爆伤|警戒高能|衍蛛追打|分裂|衍蛛复活|清扫自爆|");
  l.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  const hi = Math.max(...o.levels);
  for (const t of TARGETS.filter(x => report.kits.includes(x.kit))) {
    for (const v of variantsFor(t)) {
      const keep = report.summary[`${t.kit}|${v}|${hi}|all|keep`];
      if (!keep || !keep.mech) continue;
      const m = keep.mech;
      l.push(`|${report.meta[t.kit].name}|${v}|${f2(m.absorbs)}|${f2(m.absorbedUnits)}|${f2(m.giant)}|${f2(m.pushes)}|${f2(m.pushHazard)}|${f2(m.marksSet)}|${f2(m.markHits)}|${f2(m.explodes)}|${f1(m.explodeDmg)}|${f2(m.alarms)}|${f2(m.followUps)}|${f2(m.splits)}|${f2(m.spiderRevives)}|${f2(m.sweeperBooms)}|`);
    }
  }
  l.push("");
  l.push("## 3. 自爆小车护甲层（代码核对）", "",
    "预设 `engine.js` · `boomcar`：`shield = scaleHp(5+(lv-1)*2, p)`，`armor = scaleHp(3, p)`。",
    "护盾随等级涨，护甲基数写死 3（只随人数 `scaleHp`），**等级升到 20 护甲仍是 3**（2 人队）。",
    "见手写分析是否判为疑似 bug。", "");
  // 采样一层
  if (report.boomcarLayers) {
    l.push("本跑抽样（keep 臂上场层）：");
    report.boomcarLayers.forEach(x => l.push(`- 等级 ${x.level} 人数 ${x.size}：${x.layers.map(L => `${L.type} ${L.max}`).join(" + ")}`));
    l.push("");
  }
  if (report.giantProbe) {
    l.push(markdownGiant(report));
  }
  return l.join("\n");
}
function formatMech(mech, kind) {
  if (!mech) return "—";
  const parts = [];
  if (kind === "absorb" || mech.absorbs) parts.push(`吸收 ${f2(mech.absorbs)}（单位 ${f2(mech.absorbedUnits)}，巨型 ${f2(mech.giant)}）`);
  if (kind === "push" || mech.pushes) parts.push(`推 ${f2(mech.pushes)}（危 ${f2(mech.pushHazard)}）`);
  if (kind === "mark" || mech.marksSet) parts.push(`标定 ${f2(mech.marksSet)}/${f2(mech.markHits)}`);
  if (kind === "explode" || mech.explodes) parts.push(`自爆 ${f2(mech.explodes)}（伤 ${f1(mech.explodeDmg)}）`);
  if (kind === "alarm" || mech.alarms) parts.push(`警戒 ${f2(mech.alarms)}`);
  if (kind === "centipede" || mech.followUps || mech.splits) parts.push(`追打 ${f2(mech.followUps)} / 分裂 ${f2(mech.splits)}`);
  if (kind === "guard" || mech.sweeperBooms) parts.push(`清扫炸 ${f2(mech.sweeperBooms)}`);
  return parts.join("；") || "—";
}

function provenance(argv) {
  const files = [...H.RULE_FILES, "tests/headless.js", "tools/balance-common.js", "tools/enemy-threat.js", "tools/enemy-threat-mixed.js"];
  const sourceHashes = Object.fromEntries(files.filter(f => fs.existsSync(path.join(H.ROOT, f))).map(f => [f, B.hash(B.normalizeSource(fs.readFileSync(path.join(H.ROOT, f), "utf8")))]));
  let commit = null, dirty = null;
  try {
    commit = cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: H.ROOT, encoding: "utf8" }).trim();
    dirty = !!cp.execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: H.ROOT, encoding: "utf8" }).trim();
  } catch (_) {}
  return { commit, dirty, sourceHash: B.hash(sourceHashes), sourceHashes, node: process.version, command: ["node", "tools/enemy-threat.js", "--mixed", ...argv].join(" ") };
}

function parseArgs(argv) {
  const out = {}, allowed = ["samples", "levels", "sizes", "kits", "out", "workers", "smoke"];
  // --smoke / --probe-livesand-giant are flags
  const flags = new Set();
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--smoke") { flags.add("smoke"); continue; }
    if (argv[i] === "--probe-livesand-giant") { flags.add("probeLivesandGiant"); continue; }
    if (argv[i] === "--mixed") continue;
    args.push(argv[i]);
  }
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!key.startsWith("--") || !allowed.includes(key.slice(2))) throw new Error("Unknown argument: " + key);
    if (key === "--smoke") { flags.add("smoke"); continue; }
    const v = args[++i];
    if (v == null || v.startsWith("--")) throw new Error("Missing value for " + key);
    out[key.slice(2)] = v;
  }
  const levels = out.levels ? out.levels.split(",").map(x => B.positiveInt(x, "level")) : MIXED.levels;
  const sizes = out.sizes ? out.sizes.split(",").map(Number) : MIXED.sizes;
  if (sizes.some(s => ![2, 3, 4].includes(s))) throw new Error("Sizes must be 2, 3, 4");
  const kits = out.kits ? out.kits.split(",") : null;
  if (kits) {
    const bad = kits.filter(k => !TARGET_BY[k]);
    if (bad.length) throw new Error("Unknown mixed kit: " + bad.join(","));
  }
  return {
    samples: out.samples ? B.positiveInt(out.samples, "samples") : MIXED.samples,
    levels, sizes, kits,
    workers: out.workers ? B.positiveInt(out.workers, "workers") : MIXED.workers,
    out: out.out || MIXED.out,
    _outSet: !!out.out,
    smoke: flags.has("smoke"),
    probeLivesandGiant: flags.has("probeLivesandGiant")
  };
}

function outPath(file) {
  const root = path.resolve(H.ROOT, "docs/balance"), resolved = path.resolve(H.ROOT, file);
  if (!resolved.startsWith(root + path.sep)) throw new Error("Reports must be inside docs/balance/");
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

function buildMixedReport(rows, opt, meta) {
  const c = H.load();
  const kits = [...new Set(rows.map(r => r.kit))];
  const metaOf = Object.fromEntries(kits.map(k => [k, enemyMeta(c, k)]));
  const { summary, deltas } = summarizeMixed(rows);
  let alone = null;
  try { alone = JSON.parse(fs.readFileSync(path.join(H.ROOT, MIXED.aloneJson), "utf8")); } catch (_) {}
  const boomcarLayers = rows.filter(r => r.kit === "boomcar" && r.arm === "keep" && r.boomLayers)
    .reduce((acc, r) => {
      const key = r.level + ":" + r.size;
      if (!acc.seen.has(key)) { acc.seen.add(key); acc.list.push({ level: r.level, size: r.size, layers: r.boomLayers }); }
      return acc;
    }, { seen: new Set(), list: [] }).list;
  return {
    schema: "backfire-enemy-threat-mixed-v1",
    generatedAt: new Date().toISOString(),
    config: MIXED, targets: TARGETS,
    options: { samples: opt.samples, levels: opt.levels, sizes: opt.sizes, kits: opt.kits },
    provenance: meta,
    rows: rows.length,
    errors: rows.filter(r => r.outcome === "error").length,
    timeouts: rows.filter(r => r.outcome === "timeout").length,
    kits, meta: metaOf, summary, deltas, alone, boomcarLayers,
    errorSamples: rows.filter(r => r.outcome === "error").slice(0, 8).map(r => ({
      kit: r.kit, variant: r.variant, arm: r.arm, level: r.level, size: r.size, index: r.index, error: r.error
    }))
  };
}

function writeMixedReport(file, report) {
  fs.writeFileSync(file + ".json", JSON.stringify(report, (k, v) => typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v) + "\n");
  const old = fs.existsSync(file + ".md") ? fs.readFileSync(file + ".md", "utf8") : "";
  const tail = old.includes(MARK) ? old.slice(old.indexOf(MARK)) : MARK + "\n";
  fs.writeFileSync(file + ".md", markdownMixed(report) + "\n" + tail);
}

if (!isMainThread) parentPort.on("message", msg => parentPort.postMessage({ i: msg.i, row: runMixedJob(msg.job) }));

async function runJobs(jobs, workers = 1, onRow) {
  const rows = Array(jobs.length);
  if (workers <= 1) {
    jobs.forEach((j, i) => { rows[i] = runMixedJob(j); if (onRow) onRow(rows[i], i); });
    return rows;
  }
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, () => new Promise((resolve, reject) => {
    const w = new Worker(__filename);
    const send = () => {
      if (next >= jobs.length) { w.terminate().then(resolve, reject); return; }
      const i = next++;
      w.postMessage({ i, job: jobs[i] });
    };
    w.on("message", ({ i, row }) => { rows[i] = row; if (onRow) onRow(row, i); send(); });
    w.on("error", reject);
    send();
  })));
  return rows;
}

async function main(argv = process.argv.slice(2)) {
  const opt = parseArgs(argv);
  if (opt.smoke) {
    opt.samples = 1;
    opt.levels = [15];
    opt.sizes = [2];
    opt.kits = opt.kits || ["livesand", "sandfish_drive", "boomcar"];
    opt.workers = 1;
    if (!opt._outSet) opt.out = "docs/balance/enemy-threat-mixed-smoke";
  }
  if (opt.probeLivesandGiant) {
    opt.kits = ["livesand"];
    // 只要 keep 臂（巨型探针不需要 drop）
    const file = outPath(opt.out || MIXED.out);
    const meta = provenance(argv.concat(["--probe-livesand-giant"]));
    let jobs = planMixed(opt).filter(j => j.arm === "keep");
    let done = 0;
    const rows = await runJobs(jobs, opt.workers, () => {
      if (++done % 50 === 0 || done === jobs.length) console.error(`GiantProbe ${done}/${jobs.length}`);
    });
    const giantProbe = summarizeGiant(rows);
    // 合并进已有报告（保留总表与手写分析）
    let report;
    try {
      report = JSON.parse(fs.readFileSync(file + ".json", "utf8"));
    } catch (_) {
      report = buildMixedReport(rows, opt, meta);
    }
    report.giantProbe = giantProbe;
    report.giantProbeMeta = {
      samples: opt.samples, levels: opt.levels, sizes: opt.sizes,
      variants: ["day", "night", "sand"], rows: rows.length,
      errors: rows.filter(r => r.outcome === "error").length,
      provenance: meta, formula: "enemies.js:absorbSandsInto / livingSandAllies"
    };
    // 选项里记下探针等级人数，供 markdownGiant 用
    report.options = report.options || {};
    report.options.levels = opt.levels;
    report.options.sizes = opt.sizes;
    // 写 json；md：在 MARK 前插入/替换 §4，保留手写分析
    fs.writeFileSync(file + ".json", JSON.stringify(report, (k, v) => typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v) + "\n");
    const old = fs.existsSync(file + ".md") ? fs.readFileSync(file + ".md", "utf8") : "";
    const giantMd = markdownGiant(report);
    let body, tail;
    if (old.includes(MARK)) {
      body = old.slice(0, old.indexOf(MARK)).trimEnd();
      tail = old.slice(old.indexOf(MARK));
    } else {
      body = old.trimEnd();
      tail = "\n" + MARK + "\n";
    }
    // 去掉旧 §4（若有）
    body = body.replace(/\n## 4\. 巨型活沙[\s\S]*$/m, "");
    fs.writeFileSync(file + ".md", body + "\n\n" + giantMd + "\n" + tail);
    console.log(`${report.giantProbeMeta.errors ? "ERRORS" : "OK"}: giant probe → ${file}.md（${rows.length} 场，异常 ${report.giantProbeMeta.errors}）`);
    return report.giantProbeMeta.errors ? 1 : 0;
  }
  const file = outPath(opt.out);
  const meta = provenance(argv);
  const jobs = planMixed(opt);
  let done = 0;
  const rows = await runJobs(jobs, opt.workers, () => {
    if (++done % 100 === 0 || done === jobs.length) console.error(`Mixed ${done}/${jobs.length}`);
  });
  const report = buildMixedReport(rows, opt, meta);
  writeMixedReport(file, report);
  console.log(`${report.errors ? "ERRORS" : "OK"}: ${file}.md（${rows.length} 场，异常 ${report.errors}）`);
  return report.errors ? 1 : 0;
}

module.exports = {
  MIXED, TARGETS, TARGET_BY, planMixed, runMixedJob, runJobs, summarizeMixed,
  buildMixedReport, markdownMixed, parseArgs, main, sampleEncounter, dropTarget, craftEncounter, summarizeGiant, markdownGiant
};

if (isMainThread && require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(e => { console.error(e.stack || String(e)); process.exitCode = 1; });
}
