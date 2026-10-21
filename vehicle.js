/* 角鳞 · 载具配置物（上下车、驾驶员合并、代挡、殉爆、抢车）
 *
 * 第一台车是镇压部队的移动堡垒（规则见 docs/suppression-force.md 第 3 节）。写成通用的：
 *   VEHICLES 一张表一台车（座位数、数值公式、代挡、各种招式的倍率），以后加别的载具照 fortress 的格式补一项；
 *   VEHICLE_RULES 是所有载具共用的规则（上车 / 拉人的花费、检定、敌人拉人的成功率）。
 *
 * 数据：车是 state.props 里的一个配置物（kind = 载具表的键，isVehicle = true），身上的 veh 记着座位、阵营、架势和掩体：
 *   veh.seats  按上车顺序排的单位 id，第 0 个是驾驶员，其余是炮手
 *   veh.side   车现在属于哪一方（"enemy" / "player"）；空车 = 最后坐在车上的一方
 *   veh.def / defMax / stunned / stunMarks  车的架势和晕眩标记。空车也不重置：车里的人走光时保留当时的值，之后谁上车就接着用
 *   p.hp / p.maxHp  车体装甲。没有驾驶员时它就是真值；有驾驶员时真值在驾驶员身上那一层 veh 装甲里，每次 vehicleSync 抄回来
 * 驾驶员和车合并成一个单位（照瑞比的银翼机甲，app.js · enterMecha / exitMecha）：
 *   车的装甲拼在驾驶员血量层的最外层（layer.veh = 车 id），驾驶员自己的层在里面；
 *   架势、两个晕眩标记用车的，敌我驾驶员都一样（app.js · isBossUnit 认合并后的驾驶员）；
 *   刺骨这类打内层的效果直接打驾驶员；驾驶员的内层被打空 = 驾驶员倒下，车的装甲留着，按上车顺序换人接任。
 *   画面上只有一张卡：合并后的单位画成车的卡片（vehicleCardOf），车自己的配置物卡片藏起来；没人驾驶时照旧画配置物卡片。
 * 炮手（fused = true）藏在车里：选不中、不被范围波及，轮到他们时用车上的武器。 */

const VEHICLES = {
  fortress: {
    name: "移动堡垒",
    faction: "镇压队",                         // 敌方只有这个阵营的单位能上车；空车替它代挡
    seats: 4,
    appear: 0.3,                               // 这个阵营的遭遇里出现的概率，一场最多一台
    tokens: 0,                                 // 占几枚代币：0 = 不占（规则：车加在抽满代币的遭遇上）。只给平衡模拟工具用（照 RACE_PERK.off 的写法；
                                               //   tools/enemy-balance.js 改成 1 测「车占 1 枚代币」），游戏里不碰；> 0 时带车的遭遇退掉这么多代币的敌人（vehiclePayTokens）
    armor: { base: 42, perLevel: 11, per5: 2 },    // 纯装甲 = base + perLevel×(等级−1) + per5×⌊等级/5⌋，按队伍人数 scaleHp
    def: { base: 5, every: 10 },               // 架势 = base + ⌊等级/every⌋
    stunMarks: 2,                              // 晕眩标记（BOSS_STUN_MARKS，和首领一样）
    atk: { base: 7, perLevel: 1 },             // ATK = base + perLevel×(等级−1)
    die: { sides: 6, every: 5 },               // 开炮骰：1d6 起，每 every 级升一档
    cover: { chance: 0.4, openChance: 1, openDr: 0.25 },   // 代挡概率；张开掩体时的代挡概率、堡垒受伤减免
    ram: { mult: 0.75, baseBreak: 2 },         // 驾驶员撞击（附赠：移动一个区，然后撞一个单位）
    cannon: { range: 2, mult: 1, baseBreak: 1, burnChance: 0.5, burn: 1 },   // 开炮：距离 range 以内，mult×atk + 开炮骰 火
    burn: { mult: 0.5, burn: 1 },              // 焚烧：同区所有敌对单位
    blast: { mult: 1, burn: 1, ejectMult: 2, ejectBurn: 1 }   // 殉爆：同区所有单位；车里的人再吃 ejectMult×atk
  }
};

const VEHICLE_RULES = {
  boardAp: 1,                                  // 上车花几个行动点（下车不花）
  pullAp: 1,                                   // 拉人下车花几个行动点
  pullEnemyChance: 0.25,                       // 敌人拉人的成功率
  pullCheck: { prof: "运动", diff: 2 },        // 我方拉人：困难「运动」检定（diff = ROGUE_CHECKS.chance 的列：0 简单 / 1 普通 / 2 困难）
  boardCheck: { prof: "载具驾驶", diff: 1 },   // 我方上车：普通「载具驾驶」检定
  unskilledChance: null,                       // 没有熟练时的成功率：null = 照熟练项检定表（困难 / 普通检定无法尝试）；填数 = 一律按这个概率
  aiLeavePct: 0.25                             // 镇压队 AI：车的装甲低于这个比例就跳车
};

function vehicleCfg(kind) { return VEHICLES[kind] || null; }
function isVehicleProp(p) { return !!(p && p.isVehicle && VEHICLES[p.kind]); }
function vehicleProps() { return ((typeof state !== "undefined" && state.props) || []).filter(isVehicleProp); }
function vehicleById(id) { return vehicleProps().find(p => p.id === id) || null; }
/** 单位坐的车（没坐车返回 null） */
function vehicleOf(u) { return u && u.vehId ? vehicleById(u.vehId) : null; }
const vehicleSideOfUnit = (u) => (u && u.isPlayer ? "player" : "enemy");

/** 车的数值（等级、队伍人数）：{ armor, def, atk, dieSides } */
function vehicleStats(kind, level, party) {
  const c = VEHICLES[kind];
  const lv = Math.max(1, Number(level) || 1);
  return {
    armor: scaleByParty(c.armor.base + c.armor.perLevel * (lv - 1) + c.armor.per5 * milestone(lv, 5), party),
    def: c.def.base + milestone(lv, c.def.every),
    atk: c.atk.base + c.atk.perLevel * (lv - 1),
    dieSides: upgradeDieSides(c.die.sides, dieStep(lv, c.die.every))
  };
}

/** 做一台空车（不放进场上）。party = 队伍人数（缺省看 state.partySize） */
function makeVehicleProp(kind, zone, level, party) {
  const c = VEHICLES[kind];
  const lv = Math.max(1, Number(level) || 1);
  const n = party != null ? party : (typeof state !== "undefined" ? state.partySize : 2);
  const s = vehicleStats(kind, lv, n);
  return {
    id: "p" + Math.random().toString(36).slice(2, 9),
    kind, name: c.name, zone: Number(zone) || 1, level: lv,
    faction: "enemy", movable: false, hp: s.armor, maxHp: s.armor, link: "1-2",
    isVehicle: true,
    veh: { seats: [], side: "enemy", atk: s.atk, dieSides: s.dieSides, def: s.def, defMax: s.def, stunned: false, stunMarks: 0, stunMarked: false, cover: false }
  };
}
/** 做一台车放到场上 */
function vehicleSpawn(kind, zone, level, party) {
  const p = makeVehicleProp(kind, zone, level, party);
  state.props = state.props || [];
  state.props.push(p);
  return p;
}

/* ---------- 座位 ---------- */
/** 车里的人（按上车顺序，死了 / 离场的不算） */
function vehicleOccupants(p) {
  if (!p || !p.veh) return [];
  return (p.veh.seats || []).map(id => (state.units || []).find(u => u.id === id))
    .filter(u => u && u.vehId === p.id && !u.dead && !u._removed);
}
function vehiclePilot(p) { return vehicleOccupants(p)[0] || null; }
function vehicleIsPilot(u) { return !!(u && u.vehId && u.vehMerged); }
/** 车属于哪一方（有人看第一个乘员，空车看最后坐在车上的一方） */
function vehicleSide(p) {
  const pilot = vehiclePilot(p);
  return pilot ? vehicleSideOfUnit(pilot) : ((p && p.veh && p.veh.side) || "enemy");
}
/** 现在的车体装甲（有驾驶员时看合并层） */
function vehicleArmor(p) {
  const pilot = vehiclePilot(p);
  const layer = pilot ? (pilot.layers || []).find(l => l.veh === p.id) : null;
  return layer ? { cur: Math.max(0, Number(layer.current) || 0), max: Math.max(1, Number(layer.max) || 1) } : { cur: Math.max(0, Number(p.hp) || 0), max: Math.max(1, Number(p.maxHp) || 1) };
}

/** 驾驶员和车合并：装甲拼在最外层，架势 / 晕眩标记用车的（敌我驾驶员一样） */
function vehicleMerge(p, u) {
  if (!p || !u || u.vehMerged) return;
  u._vehPre = { def: u.def, defMax: u.defMax, stunned: !!u.stunned, stunMarks: Number(u.stunMarks) || 0 };
  const layer = { type: "armor", current: Math.max(0, Number(p.hp) || 0), max: Math.max(1, Number(p.maxHp) || 1), veh: p.id };
  u.layers = [layer].concat((u.layers || []).filter(l => l.veh !== p.id));
  u.def = p.veh.def; u.defMax = p.veh.defMax;
  u.stunned = !!p.veh.stunned;
  u.stunMarks = Number(p.veh.stunMarks) || 0;
  u._bossMarked = !!(p.veh.stunned && p.veh.stunMarked);   // 车这次失衡已经记过标记：换人接着用，不再多记一个
  u._bossRefill = false;
  u.vehMerged = true;
  p.zone = Number(u.zone);
}
/** 驾驶员和车分开：剩下的装甲、架势、晕眩标记还给车（车走空了也留着，不重置），驾驶员换回自己的 */
function vehicleUnmerge(p, u) {
  if (!p || !u || !u.vehMerged) return;
  const layer = (u.layers || []).find(l => l.veh === p.id);
  if (layer) {
    p.hp = Math.max(0, Math.floor(Number(layer.current) || 0));
    p.maxHp = Math.max(1, Math.floor(Number(layer.max) || p.maxHp));
    u.layers = u.layers.filter(l => l !== layer);
  }
  p.veh.def = Number(u.def) || 0; p.veh.defMax = Number(u.defMax) || p.veh.defMax;
  p.veh.stunned = !!u.stunned; p.veh.stunMarks = Number(u.stunMarks) || 0;
  p.veh.stunMarked = !!(u.stunned && u._bossMarked);
  const pre = u._vehPre;
  if (pre) { u.def = pre.def; u.defMax = pre.defMax; u.stunned = pre.stunned; u.stunMarks = pre.stunMarks; }
  delete u._vehPre;
  u.vehMerged = false;
  u._bossMarked = false; u._bossRefill = false;
}

/** 显示用：「乘员 n / 4」 */
function vehicleSeatText(p) {
  return `乘员 ${vehicleOccupants(p).length} / ${VEHICLES[p.kind].seats}`;
}
/** 悬停说明：谁在车里、谁是驾驶员（只有名字，不下发坚毅等数值） */
function vehicleRosterLines(p) {
  const occ = vehicleOccupants(p);
  if (!occ.length) return ["车上没有人"];
  return occ.map((u, i) => `${i === 0 ? "驾驶员" : "炮手"}：${u.name}`);
}
/** 显示用：和车合并的驾驶员画成车的卡片——名字、外观、等级、ATK 按车，卡片上写乘员 n / 4、驾驶员是谁。
 *  不是合并后的驾驶员返回 null（game.js · snapUnit、online-view.js · projectUnit 共用） */
function vehicleCardOf(u) {
  const p = u && u.vehMerged ? vehicleOf(u) : null;
  if (!p) return null;
  return { kind: p.kind, name: p.name, level: p.level, atk: p.veh.atk, seatText: vehicleSeatText(p), pilot: u.name, roster: vehicleRosterLines(p) };
}
/** 显示用：这台车的配置物卡片要不要藏起来（有驾驶员时只画合并后的那张车的卡片） */
function vehiclePropHidden(p) { return isVehicleProp(p) && !!vehiclePilot(p); }

/** 让车的数据跟上驾驶员：位置、装甲、归属。炮手跟着车走 */
function vehicleSync() {
  vehicleProps().forEach(p => {
    // 驾驶员没走下车 / 倒下的流程就死了或离场（直接判死、移出战场）：先把车的装甲、架势、晕眩标记收回车上，下一个人接着用
    (state.units || []).forEach(u => { if (u && u.vehMerged && u.vehId === p.id && (u.dead || u._removed)) { vehicleUnmerge(p, u); u.vehId = null; } });
    const occ = vehicleOccupants(p);
    p.veh.seats = occ.map(u => u.id);
    const pilot = occ[0];
    if (!pilot) { p.faction = p.veh.side; return; }
    if (!pilot.vehMerged) { pilot.fused = false; vehicleMerge(p, pilot); }
    p.zone = Number(pilot.zone);
    occ.forEach(u => { u.zone = pilot.zone; });
    const a = vehicleArmor(p);
    p.hp = a.cur; p.maxHp = a.max;
    p.veh.side = vehicleSideOfUnit(pilot);
    p.faction = p.veh.side;
  });
}

/** 离开座位（下车 / 被拉下车 / 倒下）：驾驶员离开时装甲还给车，按上车顺序换人接任。返回日志 */
function vehicleRemoveSeat(p, u, notes) {
  notes = notes || [];
  if (!p || !u) return notes;
  const wasPilot = !!u.vehMerged;
  const lastSide = vehicleSideOfUnit(u);
  vehicleSync();
  if (wasPilot) vehicleUnmerge(p, u);
  p.veh.seats = (p.veh.seats || []).filter(id => id !== u.id);
  u.vehId = null; u.vehMerged = false; u.fused = false;
  u.zone = p.zone;
  p.veh.cover = false;   // 驾驶员换人 / 离开：掩体收起来
  if (wasPilot) {
    const next = vehicleOccupants(p)[0];
    if (next) {
      next.fused = false;
      vehicleMerge(p, next);
      next.zone = p.zone;
      notes.push(`${next.name} 接任驾驶员。`);
    }
  }
  if (!vehicleOccupants(p).length) {
    p.veh.side = lastSide;   // 空车替最后坐在车上的一方代挡
    p.faction = lastSide;
    // 车的架势和晕眩标记不重置：vehicleUnmerge 已经把当时的值还给车，下一个上车的人接着用
  }
  return notes;
}

/* ---------- 上车 / 下车 / 拉人 ---------- */
/** 这个单位现在不能上这台车的原因（能上返回 null）。只看座位和阵营，不看行动点 */
function vehicleBoardError(u, p) {
  if (!u || !isVehicleProp(p)) return "没有这台车。";
  const c = VEHICLES[p.kind];
  if (u.dead || u.dying) return `${u.name} 现在上不了车。`;
  if (u.vehId) return `${u.name} 已经在车上了。`;
  if (Number(u.zone) !== Number(p.zone)) return `要和${p.name}同区才能上车。`;
  if (!u.isPlayer && factionOf(u) !== c.faction) return `只有${c.faction}能上${p.name}。`;
  const occ = vehicleOccupants(p);
  if (occ.some(o => vehicleSideOfUnit(o) !== vehicleSideOfUnit(u))) return `${p.name}上还有${u.isPlayer ? "敌人" : "对方的人"}，先把他们拉下车。`;
  if (occ.length >= c.seats) return `${p.name}的座位满了（${occ.length} / ${c.seats}）。`;
  if (u.isPlayer && !vehicleCheckOdds(u, VEHICLE_RULES.boardCheck).chance) return `${u.name} 没有「${VEHICLE_RULES.boardCheck.prof}」熟练，做不了普通难度的检定。`;
  return null;
}
/** 上车（规则已经验过）：第一个上车的是驾驶员，其余是炮手 */
function vehicleBoard(u, p, notes) {
  notes = notes || [];
  const first = !vehicleOccupants(p).length;
  p.veh.seats = (p.veh.seats || []).filter(id => id !== u.id).concat(u.id);
  u.vehId = p.id;
  u.zone = p.zone;
  p.veh.side = vehicleSideOfUnit(u);
  p.faction = p.veh.side;
  p.veh.cover = false;
  if (first) {
    u.fused = false;
    vehicleMerge(p, u);
    notes.push(`${u.name} 坐上${p.name}，成为驾驶员。`);
  } else {
    u.vehMerged = false;
    u.fused = true;   // 炮手藏在车里：选不中，不被范围波及
    notes.push(`${u.name} 坐上${p.name}（炮手）。`);
  }
  return notes;
}
/** 下车（不花行动点），落在车所在的区 */
function vehicleLeave(u, notes) {
  notes = notes || [];
  const p = vehicleOf(u);
  if (!p) return notes;
  notes.push(`${u.name} 下车。`);
  return vehicleRemoveSeat(p, u, notes);
}
/** 这个人现在不能把车上这个人拉下车的原因 */
function vehiclePullError(actor, p, occ) {
  if (!actor || !isVehicleProp(p)) return "没有这台车。";
  if (!occ || occ.vehId !== p.id) return "那个人不在这台车上。";
  if (actor.vehId) return `${actor.name} 自己在车上，不能拉人。`;
  if (Number(actor.zone) !== Number(p.zone)) return `要和${p.name}同区才能拉人下车。`;
  if (vehicleSideOfUnit(actor) === vehicleSideOfUnit(occ)) return `${occ.name} 是自己人。`;
  if (actor.isPlayer && !vehicleCheckOdds(actor, VEHICLE_RULES.pullCheck).chance) return `${actor.name} 没有「${VEHICLE_RULES.pullCheck.prof}」熟练，做不了困难难度的检定。`;
  return null;
}
/** 拉人下车：我方过困难「运动」检定，敌人按固定成功率。成功把 occ 拉下车（驾驶员被拉下，换人接任）。返回日志 */
function vehiclePull(actor, p, occ, notes) {
  notes = notes || [];
  let ok;
  if (actor.isPlayer) {
    const r = vehicleRollCheck(actor, VEHICLE_RULES.pullCheck);
    notes.push(`${actor.name} 想把 ${occ.name} 拉下车：${r.text}`);
    ok = r.ok;
  } else {
    ok = Math.random() < VEHICLE_RULES.pullEnemyChance;
    notes.push(`${actor.name} 想把 ${occ.name} 拉下车（成功率 ${Math.round(VEHICLE_RULES.pullEnemyChance * 100)}%）${ok ? "，成功。" : "，失败。"}`);
  }
  if (!ok) return notes;
  notes.push(`${occ.name} 被拉下${p.name}。`);
  vehicleRemoveSeat(p, occ, notes);
  return notes;
}

/* ---------- 检定（熟练项检定表，party.js · checkPerksFor 的优势 / 劣势 / 重掷） ---------- */
function vehicleCheckOdds(u, chk) {
  const level = typeof unitProfLevel === "function" ? unitProfLevel(u, chk.prof) : 0;
  const table = typeof ROGUE_CHECKS !== "undefined" ? ROGUE_CHECKS.chance : [[0.5, 0, 0, 0], [1, 0.5, 0.25, 0.125], [1, 1, 0.5, 0.25], [1, 1, 0.75, 0.5]];
  let base = (table[level] || [])[chk.diff] || 0;
  if (level === 0 && VEHICLE_RULES.unskilledChance != null) base = VEHICLE_RULES.unskilledChance;
  const hpLow = totalHp(u) * 2 < totalMaxHp(u);
  const perks = u.isPlayer && typeof checkPerksFor === "function" ? checkPerksFor(u.kit, chk.prof, hpLow) : {};
  let chance = perks.adv ? 1 - (1 - base) * (1 - base) : perks.dis ? base * base : base;
  if (perks.reroll) chance = 1 - (1 - chance) * (1 - chance);
  return { level, base, chance: base ? chance : 0, perks };
}
function vehicleRollCheck(u, chk) {
  const odds = vehicleCheckOdds(u, chk);
  const roll = () => Math.random() < odds.base;
  const once = () => (odds.perks.adv ? (roll() || roll()) : odds.perks.dis ? (roll() && roll()) : roll());
  let ok = odds.base >= 1 || once();
  let rerolled = false;
  if (!ok && odds.perks.reroll) { rerolled = true; ok = once(); }
  const lv = ["没有熟练", "一级熟练", "二级熟练", "三级熟练"][odds.level] || "";
  const diff = ["简单", "普通", "困难", "极难"][chk.diff] || "";
  return { ok, text: `${diff}「${chk.prof}」检定（${lv}，成功率 ${Math.round(odds.chance * 100)}%）${rerolled ? "，失败后重掷" : ""}${ok ? "，成功。" : "，失败。"}` };
}

/* ---------- 代挡 ---------- */
/** 车替 u 代挡的单位范围：车上的人不算（他们本来就在车里）；同区同阵营（敌方 = 车的阵营，我方 = 所有我方单位） */
function vehicleGuards(p, u) {
  if (!p || !u || u.kind || u.isStructure || u.vehId || u.dead || u._removed || u.hidden || u.fused) return false;
  if (Number(u.zone) !== Number(p.zone)) return false;
  if (vehicleSide(p) === "player") return !!u.isPlayer;
  return !u.isPlayer && factionOf(u) === VEHICLES[p.kind].faction;
}
/** 这一下攻击打在 target 身上时，车要不要代挡。返回 null（不代挡），或 { vehicle, unit }（驾驶员替车挨打）/ { vehicle, struct }（空车） */
function vehicleGuard(attacker, target, opt) {
  if (!attacker || !target) return null;
  const f = (opt && opt.flags) || {};
  if (f.vehBypass || f.environment || f.diffract || f.locked) return null;
  if (!(f.action || f.aoe)) return null;
  const props = vehicleProps();
  if (!props.length) return null;
  const atkSide = vehicleSideOfUnit(attacker);
  for (const p of props) {
    if (p._destroyed || !vehicleGuards(p, target)) continue;
    const side = vehicleSide(p);
    if (atkSide === side) continue;   // 自己人打的不代挡
    const pilot = vehiclePilot(p);
    if (!pilot && !(p.hp > 0)) continue;
    const c = VEHICLES[p.kind];
    const chance = p.veh.cover ? c.cover.openChance : c.cover.chance;
    if (!(Math.random() < chance)) continue;
    return pilot ? { vehicle: p, unit: pilot, chance } : { vehicle: p, struct: makeStructProxy("prop:" + p.id, [p.zone], attacker), chance };
  }
  return null;
}
/** 张开掩体期间，合并后的驾驶员（车）受到的伤害减免（0 = 没有） */
function vehicleCoverDr(u) {
  const p = vehicleOf(u);
  if (!p || !u.vehMerged || !p.veh.cover) return 0;
  return VEHICLES[p.kind].cover.openDr;
}

/* ---------- 被摧毁：殉爆 ---------- */
/** 车的装甲打空：同区所有单位（不分敌我）1×atk 火、灼烧；车里的人被甩出来，立刻失衡（精英也直接晕眩），再吃 2×atk 火和灼烧 */
function vehicleDestroy(p, notes) {
  notes = notes || [];
  if (!p || p._destroyed) return notes;
  p._destroyed = true;
  const c = VEHICLES[p.kind];
  const atk = p.veh.atk;
  const zone = Number(p.zone);
  vehicleSync();
  const crew = vehicleOccupants(p);
  const pilot = crew[0];
  if (pilot) vehicleUnmerge(p, pilot);
  crew.forEach(u => { u.vehId = null; u.vehMerged = false; u.fused = false; u.zone = zone; });
  p.veh.seats = [];
  p.hp = 0;
  state.props = (state.props || []).filter(x => x.id !== p.id);
  notes.push(`${p.name}被摧毁，殉爆：${zone} 区所有单位（不分敌我）${c.blast.mult}×ATK 火并灼烧${crew.length ? `；车里的 ${crew.map(u => u.name).join("、")} 被甩出来，立刻失衡，再受 ${c.blast.ejectMult}×ATK 火和灼烧` : ""}。`);
  const fake = unitOf(p.name, p.level, [{ type: "armor", hp: 1 }], 0, atk);
  fake.zone = zone; fake.envSrc = true; fake.isPlayer = p.veh.side === "player";
  const hit = (u, mult, burn) => {
    if (!u || u.dead || u._removed) return;
    const out = dealTo(fake, u, { atk, mult, element: "fire", baseBreak: 0, flags: { action: true, aoe: true, environment: true, blockResolved: true, vehBypass: true, anyRange: true } });
    (out && out.extra || []).forEach(s => notes.push("  " + s));
    if (!u.dead && burn) { grantBurn(u, burn, notes); }
  };
  const victims = (state.units || []).filter(u => u && !u.dead && !u._removed && !u.hidden && !u.fused && Number(u.zone) === zone);
  victims.forEach(u => hit(u, c.blast.mult, c.blast.burn));
  crew.forEach(u => {
    if (u.dead || u._removed) return;
    // 立刻失衡：精英 / 首领不看晕眩标记，直接晕眩（先把标记垫到只差一个，这次失衡正好攒满，不会被「标记没满、立刻恢复架势」抹掉）
    const maxMarks = typeof BOSS_STUN_MARKS !== "undefined" ? BOSS_STUN_MARKS : 2;
    if (typeof isBossUnit === "function" && isBossUnit(u)) u.stunMarks = Math.max(Number(u.stunMarks) || 0, maxMarks - 1);
    if (!u.stunned && u.def > 0) dealBreak(u, u.def, "fire", notes, "殉爆");
    else u.stunned = true;
    if (typeof isBossUnit === "function" && isBossUnit(u)) { u.stunMarks = maxMarks; u._bossRefill = false; }
    hit(u, c.blast.ejectMult, c.blast.ejectBurn);
  });
  return notes;
}

/** 每次结算后整理：装甲打空的车殉爆；驾驶员内层被打空，倒下让位。返回日志（sweepDeadEnemies 调用） */
function vehicleSweep(notes) {
  notes = notes || [];
  vehicleProps().forEach(p => {
    if (p._destroyed) return;
    const pilot = vehiclePilot(p);
    if (pilot && typeof isInnerDepleted === "function" && isInnerDepleted(pilot) && !pilot.dead) {
      notes.push(`${pilot.name} 倒下。`);
      vehicleRemoveSeat(p, pilot, notes);
    }
    vehicleSync();
    if (!(vehicleArmor(p).cur > 0)) vehicleDestroy(p, notes);
  });
  return notes;
}
/** 玩家驾驶员被打倒（applyKnockdown 调用）：离开座位，车上下一个人接任 */
function vehiclePilotDown(u, notes) {
  const p = vehicleOf(u);
  if (!p || !u.vehMerged) return notes || [];
  notes = notes || [];
  notes.push(`${u.name} 倒下。`);
  return vehicleRemoveSeat(p, u, notes);
}

/* ---------- 招式 ---------- */
function vehicleSkillCost(id) {
  const k = String(id || "").split(":")[0];
  if (k === "veh_board") return { ap: VEHICLE_RULES.boardAp };
  if (k === "veh_pull") return { ap: VEHICLE_RULES.pullAp };
  if (k === "veh_leave") return {};
  if (k === "veh_ram") return { bonus: 1 };
  return { ap: 1 };   // veh_fire / veh_burn / veh_cover
}
// 车上招式的射程：开炮看炮的射程（载具表里最远的那台），撞击先移动一个区所以最远打到距离 1
SKILL_RANGE.veh_fire = { min: 0, max: Math.max.apply(null, Object.keys(VEHICLES).map(k => VEHICLES[k].cannon.range)) };
SKILL_RANGE.veh_ram = { min: 0, max: 1 };
SKILL_TARGET_SIDE.veh_fire = "enemy";
SKILL_TARGET_SIDE.veh_ram = "enemy";
/** u 是 a 能打的敌对单位（车里的炮手藏着，选不中；开车的驾驶员就是车，选得中） */
function vehicleHostile(a, u) { return !!u && !u.dead && !u._removed && !u.hidden && !u.fused && hostileTo(a, u); }

/** 乘员在车上能用的招式（界面和 AI 共用）：[{ id, name, hint }] */
function vehicleRideSkills(u) {
  const p = vehicleOf(u);
  if (!p) return [];
  const c = VEHICLES[p.kind];
  const out = [
    { id: "veh_fire", name: "开炮", hint: `距离${c.cannon.range}以内 · ${c.cannon.mult}atk + 1d${p.veh.dieSides} 火 ${c.cannon.baseBreak}击破 · ${Math.round(c.cannon.burnChance * 100)}% 灼烧 ${c.cannon.burn}` },
    { id: "veh_burn", name: "焚烧", hint: `同区所有敌对单位 ${c.burn.mult}atk 火 · 灼烧 ${c.burn.burn}` }
  ];
  if (u.vehMerged) {
    out.push({ id: "veh_cover", name: "张开掩体", hint: `到驾驶员下次行动前：同区同阵营代挡 ${Math.round(c.cover.openChance * 100)}% · 堡垒受伤 −${Math.round(c.cover.openDr * 100)}%` });
    out.push({ id: "veh_ram", name: "冲撞", hint: `附赠 · 移动一个区，然后撞一个单位 · ${c.ram.mult}atk 物理 ${c.ram.baseBreak}击破 · 距离1以内` });
  }
  out.push({ id: "veh_leave", name: "下车", hint: "不耗行动点 · 落在车所在的区" });
  return out;
}
/** 没坐车的人能做的车上动作：上车、拉人下车（同区的车） */
function vehicleGroundSkills(u) {
  const out = [];
  if (!u || u.vehId) return out;
  vehicleProps().forEach(p => {
    if (p._destroyed || Number(p.zone) !== Number(u.zone)) return;
    const occ = vehicleOccupants(p);
    const foes = occ.filter(o => vehicleSideOfUnit(o) !== vehicleSideOfUnit(u));
    if (foes.length) {
      foes.forEach((o, i) => out.push({ id: `veh_pull:${p.id}:${o.id}`, name: `拉 ${o.name} 下车`, hint: `同区 · ${u.isPlayer ? `困难「${VEHICLE_RULES.pullCheck.prof}」检定` : `成功率 ${Math.round(VEHICLE_RULES.pullEnemyChance * 100)}%`} · 把对方一人拉下车${i === 0 && vehicleIsPilot(o) ? "（驾驶员）" : ""}` }));
    } else {
      out.push({ id: `veh_board:${p.id}`, name: `上车 ${p.name}（${occ.length} / ${VEHICLES[p.kind].seats}）`, hint: `同区 · ${u.isPlayer ? `普通「${VEHICLE_RULES.boardCheck.prof}」检定` : "直接上车"} · 第一个上车的是驾驶员` });
    }
  });
  return out;
}
/** 单位能用的全部车上招式（乘员 = 车上的招式；没坐车 = 上车 / 拉人） */
function vehicleSkillList(u) {
  return u && u.vehId ? vehicleRideSkills(u) : vehicleGroundSkills(u);
}

/** 这个人现在不能用这个车上招式的原因（能用返回 null）；t = 已经选好的目标（可以没有） */
function vehicleSkillWhy(a, id, t) {
  const parts = String(id).split(":");
  const k = parts[0];
  if (!a) return "先选人。";
  if (k === "veh_board") {
    const p = vehicleById(parts[1]);
    return vehicleBoardError(a, p);
  }
  if (k === "veh_pull") {
    const p = vehicleById(parts[1]);
    const occ = vehicleOccupants(p).find(o => o.id === parts[2]);
    return vehiclePullError(a, p, occ);
  }
  const p = vehicleOf(a);
  if (!p) return `${a.name} 不在车上。`;
  const c = VEHICLES[p.kind];
  if (k === "veh_leave") return null;
  if ((k === "veh_cover" || k === "veh_ram") && !a.vehMerged) return `只有驾驶员能${k === "veh_cover" ? "张开掩体" : "冲撞"}。`;
  if (t && t.id && !t.isStructure && (k === "veh_fire" || k === "veh_ram")) {
    if (!hostileTo(a, t)) return `${t.name} 不是敌对的单位。`;
    const d = zoneDist(a.zone, t.zone, state.zoneMode);
    if (k === "veh_fire" && d > c.cannon.range) return `开炮只打距离 ${c.cannon.range} 以内的目标。`;
    if (k === "veh_ram" && d > 1) return "冲撞要先移动一个区：目标得在同区或相邻的区。";
  }
  return null;
}

/** 执行车上招式（行动点 / 附赠已经由调用方扣过）。hitOne 是技能结算里统一的出手函数 */
function runVehicleSkill(id, a, t, hitOne, lines, needT) {
  const parts = String(id).split(":");
  const k = parts[0];
  const why = vehicleSkillWhy(a, id, t);
  if (why) { lines.push(why); return true; }
  if (k === "veh_board") {
    const p = vehicleById(parts[1]);
    if (a.isPlayer) {
      const r = vehicleRollCheck(a, VEHICLE_RULES.boardCheck);
      lines.push(`${a.name} 想坐上${p.name}：${r.text}`);
      if (!r.ok) return true;
    }
    vehicleBoard(a, p, lines);
    return true;
  }
  if (k === "veh_pull") {
    const p = vehicleById(parts[1]);
    const occ = vehicleOccupants(p).find(o => o.id === parts[2]);
    vehiclePull(a, p, occ, lines);
    return true;
  }
  if (k === "veh_leave") { vehicleLeave(a, lines); return true; }
  const p = vehicleOf(a);
  const c = VEHICLES[p.kind];
  if (k !== "veh_cover") p.veh.cover = false;   // 驾驶员再次行动：掩体收起
  if (k === "veh_cover") {
    p.veh.cover = true;
    lines.push(`${a.name} 张开${p.name}的掩体：到驾驶员下次行动前，同区同阵营代挡 ${Math.round(c.cover.openChance * 100)}%，堡垒受伤 −${Math.round(c.cover.openDr * 100)}%。`);
    return true;
  }
  const atk = p.veh.atk;
  if (k === "veh_ram") {
    if (!needT()) return true;
    if (Number(a.zone) !== Number(t.zone)) {
      stepTowardZone(a, t.zone, { free: true });
      vehicleSync();
      if (Number(a.zone) !== Number(t.zone)) { lines.push(`${p.name}没能开到 ${t.zone} 区。`); return true; }
      lines.push(`${p.name}开到 ${t.zone} 区。`);
    }
    hitOne(a, t, { atk, mult: c.ram.mult, element: "physical", baseBreak: c.ram.baseBreak, atkRange: "melee", flags: { action: true, anyRange: true } });
    return true;
  }
  if (k === "veh_fire") {
    if (!needT()) return true;
    const burn = Math.random() < c.cannon.burnChance;
    const d = zoneDist(a.zone, t.zone, state.zoneMode);
    hitOne(a, t, {
      atk, mult: c.cannon.mult, diceN: 1, diceS: p.veh.dieSides, element: "fire", baseBreak: c.cannon.baseBreak,
      atkRange: d >= 1 ? "ranged" : "any", flags: { action: true, anyRange: true },
      onConnect: burn ? { burn: c.cannon.burn } : null
    });
    return true;
  }
  if (k === "veh_burn") {
    const foes = (state.units || []).filter(u => vehicleHostile(a, u) && Number(u.zone) === Number(a.zone));
    if (!foes.length) { lines.push(`${a.zone} 区没有敌对的单位。`); return true; }
    foes.forEach(u => hitOne(a, u, { atk, mult: c.burn.mult, element: "fire", baseBreak: 0, atkRange: "any", flags: { action: true, aoe: true }, onConnect: { burn: c.burn.burn } }));
    return true;
  }
  lines.push("未实现的载具招式：" + id);
  return true;
}

/* ---------- 遭遇：开战时的车 ---------- */
/** 这场遭遇要不要带车：遭遇里有这台车的阵营，按 appear 掷骰，一场最多一台。返回 [{ kind }]（写进 spec.vehicles） */
function vehicleRollEncounter(spec) {
  const rows = (spec && spec.enemies) || [];
  const out = [];
  Object.keys(VEHICLES).forEach(kind => {
    if (out.length) return;
    const c = VEHICLES[kind];
    const has = rows.some(r => { const i = typeof enemyInfo === "function" ? enemyInfo(r.preset) : null; return i && i.faction === c.faction; });
    if (has && Math.random() < c.appear) out.push({ kind });
  });
  return out;
}
/** 车占代币（VEHICLES.*.tokens > 0，只给平衡模拟工具用；默认 0 时什么都不做、不掷骰）：带车的遭遇从敌人里退掉这么多代币。
 *  picks = 抽到的先后（finishEncounter 排站位之前记下的：三区制的站位会把敌人拆成一只一行再打乱）。从最后抽到的往前退，
 *  这台车的阵营至少留一个人（开局要有驾驶员，vehicleEncounterSetup）；退掉的是 2 枚代币的精英、多退了的，
 *  从同一个池子补抽回去（pool = rollEncounter 抽敌人用的池子；没给就用这场遭遇里有的阵营）——和一开始就少抽这么多代币一样。
 *  实际退掉几枚记在 spec.vehicles[0].tokens，也是返回值 */
function vehiclePayTokens(spec, picks, pool) {
  const v = ((spec && spec.vehicles) || [])[0];
  const c = v && VEHICLES[v.kind];
  const want = c ? Math.max(0, Math.floor(Number(c.tokens) || 0)) : 0;
  if (!want) return 0;
  const rows = spec.enemies || (spec.enemies = []);
  const info = (k) => enemyInfo(k) || {};
  const size = (r) => Math.max(1, Number(r.count) || 1);
  const crew = () => rows.reduce((n, r) => n + (info(r.preset).faction === c.faction ? size(r) : 0), 0);
  let paid = 0, zone = null;
  for (let i = (picks || []).length - 1; i >= 0 && paid < want; i--) {
    const p = picks[i];
    if (info(p.preset).faction === c.faction && crew() - size(p) < 1) continue;   // 最后一个镇压队员留着当驾驶员
    // 两区制：抽到的那一行原样在；三区制：按兵种从后往前拿掉这么多只
    let left = size(p);
    const at = rows.indexOf(p);
    if (at >= 0) { zone = p.zone; rows.splice(at, 1); left = 0; }
    for (let j = rows.length - 1; j >= 0 && left > 0; j--) {
      if (rows[j].preset !== p.preset) continue;
      zone = rows[j].zone; left -= size(rows[j]); rows.splice(j, 1);
    }
    if (left < size(p)) paid += enemyTokens(p.preset);
  }
  if (paid > want) {
    const have = new Set(rows.map(r => info(r.preset).faction));
    const from = pool && pool.length ? pool : regionPool(spec.region).filter(k => have.has(info(k).faction));
    pickByTokens(from, paid - want).forEach(e => {
      if (zone != null) e.zone = zone;
      rows.push(e);
      paid -= enemyTokens(e.preset);
    });
  }
  v.tokens = paid;
  return paid;
}
/** 开战时把车摆上场：停在驾驶员所在的区，从这场遭遇里这个阵营的敌人中随机挑一个坐上去当驾驶员。返回摆好的车 */
function vehicleEncounterSetup(spec, made, level, party) {
  const rows = (spec && Array.isArray(spec.vehicles)) ? spec.vehicles : [];
  const out = [];
  rows.slice(0, 1).forEach(v => {
    const c = VEHICLES[v.kind];
    if (!c) return;
    const crew = (made || []).filter(u => u && !u.isPlayer && !u.dead && factionOf(u) === c.faction);
    if (!crew.length) return;
    const driver = crew[Math.floor(Math.random() * crew.length)];
    const p = vehicleSpawn(v.kind, v.zone || driver.zone, v.level != null ? v.level : level, party);
    driver.zone = p.zone;
    vehicleBoard(driver, p);
    out.push(p);
  });
  return out;
}

/* ---------- AI（镇压队） ---------- */
function vehicleRiderActs(u) { return !!(u && u.vehId && u.fused && !u.dead && !u._removed && !u.isPlayer); }
/** 车上的炮手也要在敌人回合行动（他们 fused，不在 ai.js 的 unitAlive 里） */
function vehicleRiderActors() {
  return (state.units || []).filter(vehicleRiderActs);
}
/** 驾驶员每回合有 1 个附赠（移动 / 冲撞用）：refreshEnemyEconomy 末尾调用 */
function vehicleEconomy(u) {
  if (!u || u.isPlayer || !u.vehMerged) return;
  u.bonus = Math.max(1, Number(u.bonus) || 0);
  u.bonusMax = Math.max(u.bonus, Number(u.bonusMax) || 0);
}

function vehicleAiPlan(u) {
  if (!u || u.isPlayer || u.dead) return undefined;
  if (u.vehId) return vehicleRidePlan(u);
  const f = typeof factionOf === "function" ? factionOf(u) : null;
  if (!f) return undefined;
  const cars = vehicleProps().filter(p => !p._destroyed && Number(p.zone) === Number(u.zone) && VEHICLES[p.kind].faction === f);
  if (!cars.length || (u.ap || 0) < 1 || u.stunned) return undefined;
  const mk = (sid, p, label, target) => ({
    thunk: () => { state.attackerId = u.id; state.targetId = target ? target.id : null; runSkill(sid); },
    meta: { actorId: u.id, targetId: target ? target.id : undefined, skillName: label, skillId: sid },
    ai: { kind: "vehicle", sid, target }
  });
  for (const p of cars) {
    const occ = vehicleOccupants(p);
    const foes = occ.filter(o => vehicleSideOfUnit(o) !== "enemy");
    if (foes.length) {
      // 我方占着车：先拉驾驶员，把车抢回去
      const pick = foes[0];
      if (!vehiclePullError(u, p, pick)) return mk(`veh_pull:${p.id}:${pick.id}`, p, `把 ${pick.name} 拉下${p.name}`, null);
      continue;
    }
    const armor = vehicleArmor(p);
    if (armor.cur <= armor.max * VEHICLE_RULES.aiLeavePct) continue;   // 快炸的车不上
    if (!vehicleBoardError(u, p) && vehicleAiWantsBoard(u, p)) return mk(`veh_board:${p.id}`, p, `上车 ${p.name}`, null);
  }
  return undefined;
}
/** 什么时候上车：车是空的就上去开；近战兵（警棍盾、喷火兵）身边有敌人就先打；其余有座位就上 */
function vehicleAiWantsBoard(u, p) {
  if (!vehicleOccupants(p).length) return true;
  if (u.range === "melee") return !(state.units || []).some(x => vehicleHostile(u, x) && Number(x.zone) === Number(u.zone));
  return true;
}

function vehicleTargetsFor(a, p, maxD) {
  return (state.units || []).filter(x => vehicleHostile(a, x) && !(x.dying && !x.upOnShp) &&
    zoneDist(a.zone, x.zone, state.zoneMode) <= maxD && !lineBlocked(a.zone, x.zone));
}
/** 炮手 / 驾驶员挑开炮的目标：镇压小队长在场时优先没有灼烧的，其次近的，再次血少的 */
function vehiclePickTarget(a, list) {
  const captain = (state.units || []).some(x => x.kit === "riot_captain" && !x.dead && !x._removed && !x.hidden);
  const burning = (x) => (Number(x.statuses && x.statuses.burn) || 0) > 0 || x.self === "burn";
  return list.slice().sort((x, y) =>
    (captain ? (burning(x) - burning(y)) : 0) ||
    (zoneDist(a.zone, x.zone, state.zoneMode) - zoneDist(a.zone, y.zone, state.zoneMode)) ||
    (totalHp(x) - totalHp(y)))[0] || null;
}

function vehicleRidePlan(u) {
  const p = vehicleOf(u);
  if (!p) return undefined;
  const c = VEHICLES[p.kind];
  const mk = (sid, label, target) => ({
    thunk: () => { state.attackerId = u.id; state.targetId = target ? target.id : null; runSkill(sid); },
    meta: { actorId: u.id, targetId: target ? target.id : undefined, skillName: label, skillId: sid },
    ai: { kind: "attack", sid, target }
  });
  const armor = vehicleArmor(p);
  // 车快炸了：跳车（下车不花行动点）
  if (armor.cur <= armor.max * VEHICLE_RULES.aiLeavePct) return mk("veh_leave", "跳车", null);
  const hereFoes = vehicleTargetsFor(u, p, 0);
  const near = vehicleTargetsFor(u, p, c.cannon.range);
  if (u.vehMerged && (u.bonus || 0) >= 1 && !hereFoes.length) {
    // 同区没人：邻区有人就撞过去；够不着的先开过去
    const adj = vehicleTargetsFor(u, p, 1).filter(x => Number(x.zone) !== Number(u.zone));
    const ram = vehiclePickTarget(u, adj);
    if (ram) return mk("veh_ram", `冲撞 ${ram.name}`, ram);
  }
  if ((u.ap || 0) >= 1) {
    if (hereFoes.length >= 2) return mk("veh_burn", "焚烧", null);
    const shot = vehiclePickTarget(u, near);
    if (shot) return mk("veh_fire", `开炮 → ${shot.name}`, shot);
    if (u.vehMerged && !p.veh.cover && armor.cur < armor.max * 0.5) return mk("veh_cover", "张开掩体", null);
  }
  if (u.vehMerged && !u.noMove && (u.bonus || 0) >= 1 && !near.length) {
    // 谁都够不着：朝最近的敌人开一格
    const foes = (state.units || []).filter(x => vehicleHostile(u, x));
    const nearest = foes.sort((x, y) => zoneDist(u.zone, x.zone, state.zoneMode) - zoneDist(u.zone, y.zone, state.zoneMode))[0];
    if (nearest) {
      const path = typeof zonePath === "function" ? zonePath(Number(u.zone), Number(nearest.zone)) : null;
      const dest = path && path.length > 1 ? path[1] : null;
      if (dest != null && !lineBlocked(u.zone, dest)) return {
        thunk: () => { state.attackerId = u.id; doMove(u, dest); },
        meta: { actorId: u.id, skillName: `移动到 ${dest} 区` },
        ai: { kind: "move", dest: Number(dest), target: nearest }
      };
    }
  }
  return null;
}
