/* Antlerscale: Backfire · 敌人图鉴（规则 / 数据）
 *
 * 图鉴是整个游戏共用的（不分单局 / 跑团 / 存档），记在本机的 localStorage 里。
 * 一场战斗结束（胜利 / 落败 / 撤退）时，场上出现过的敌人都记为「遭遇过」：之后图鉴里能看到它的能力和数值。
 * 没遭遇过的敌人只显示「？？？」和出没的阵营 / 区域，看不到能力机制。
 *
 * BESTIARY_TEXT：每种敌人的行动方式和能力说明（按主持人手册第十章整理，赤牙按第九章；
 *   faction / regions 只在遭遇表 ENEMY_INFO 里没有的敌人身上写；数值不写在这里，
 *   图鉴里的血量 / 架势 / atk 由 engine.js 的 enemyPresets().build 按等级、人数现算，和战斗里一致）。 */
"use strict";

const BESTIARY_KEY = "backfire.bestiary.v1";

const BESTIARY_TEXT = {
  // —— 杂兵 ——
  guard_sword: { move: "近距离，主动贴近", abilities: [
    "电击挥砍：atk + 伤害骰 电击，1 击破（伤害骰随等级从 1d4 升到 1d20+20）",
    "协助攻击：近距 3 + 伤害骰 电击"] },
  guard_gun: { move: "远距离，主动远离", abilities: [
    "远距射击：atk + 1d4 能量，1 击破",
    "近距砸枪：atk/2 + 1d4 物理",
    "协助攻击：远距 atk/2 能量"] },
  patrol_car: { move: "远近皆可，主动开到 atk 最高的敌人那一区", abilities: [
    "近距谐波扫射：区域内所有单位 1×atk 谐波",
    "远距谐波射击：一人 1×atk 谐波，1 击破",
    "每回合可以替队友协助格挡一次（成功率 40%）",
    "协助攻击：无限距离 1×atk 谐波"] },
  boomcar: { move: "近距离，主动贴近", abilities: [
    "引爆：贴近一回合后自爆，atk + 1d6 范围能量，2 击破（不分敌我）",
    "被摧毁时：同区 atk/2 能量，1 击破"] },
  buoy: { move: "飞行，主动接近最近的敌人", abilities: ["电击：近距 1d4 + atk 电，1 击破"] },
  dumpdrone: { move: "飞行，保持距离 1", abilities: ["倾倒废液：远距 1d4 + atk 酸，并施加腐蚀"] },
  mine_guard: { move: "近距离，主动贴近；酸液地面不影响移动", abilities: [
    "酸液挥砍：atk + 伤害骰 酸，1 击破（伤害骰随等级从 1d4 升到 1d20+20）",
    "目标身上有腐蚀、或自己站在酸液地面上时：打中后对目标那一区的其他敌对单位溅射 0.5×atk 酸（不打同阵营）",
    "协助攻击：近距 3 + 伤害骰 酸"] },
  thug_knife: { move: "近距离，主动贴近", abilities: [
    "匕首：atk + 1d8 物理，1 击破",
    "借机攻击：敌人试图离开本区时立刻出手",
    "协助攻击：近距 atk 物理"] },
  thug_hammer: { move: "近距离，主动贴近", abilities: [
    "砸锤：atk + 1d6 物理，2 击破",
    "协助：冲到目标那一区，造成 atk/2 物理"] },
  crow: { move: "飞行，主动接近血量最低的人；通常 4–6 只一群", abilities: ["声波：近距 1d4 + atk 谐波，1 击破"] },
  sand_beast: { move: "近距离，主动贴近", abilities: ["扑咬：atk + 1d4 物理，1 击破", "协助攻击：1d8 + atk 物理"] },
  sand_human: { move: "远距离，不主动移动", abilities: ["沙弹：atk + 1d4 物理，1 击破", "协助攻击：1d8 + atk 物理"] },
  swarm: { move: "飞行，接近血量最低的人；通常 3–5 只一群", abilities: ["撞击：近距 2d4 + atk 物理，1 击破，用完自己死亡"] },
  // —— 精英 ——
  mecha_mg: { move: "远近皆可", abilities: [
    "枪管近战：atk + 1d6 物理，2 击破",
    "机枪点射：远距 1d4 次 atk 物理，每次 1 击破",
    "协助：远近皆可 2×atk，并回满自己的护盾"] },
  mecha_gl: { move: "远距离，主动远离", abilities: [
    "榴弹：选一个区，atk + 1d4 范围火焰，2 击破（先标定，之后落地）",
    "喷火协助：对目标所在区 atk/2 火焰"] },
  bandit_boss: { move: "远近皆可，追最弱的人；会主动和亡命之王同区", abilities: [
    "在场时所有狂徒集火血量最低的人",
    "能量匕首：近距 atk + 1d6 能量，1 击破",
    "自制火枪：远距 atk + 1d8 火焰，2 击破",
    "协助：远离并拔枪，所有狂徒立刻各做一次协助"] },
  captain_wolf: { move: "近距离，主动贴近", abilities: [
    "冰爪：atk + 1d4 冰，1 击破",
    "离场借机：有人离开本区时 1d6 冰，1 击破",
    "协助：移动到目标那一区，普通攻击一次"] },
  captain_ox: { move: "远近皆可，主动接近", abilities: [
    "冲撞：atk + 1d4 冰，2 击破",
    "队友被打时替他协助格挡（40%），成功仍扣自己架势（最少留 1），并反击 1 击破",
    "协助：仅近距，普通攻击一次"] },
  captain_lizard: { move: "远距离", abilities: ["酸弹：atk + 1d6 酸，2 击破", "协助：远距 2×atk 酸"] },
  ant_guard: { move: "远距离；不受酸液地面影响（不吃伤害，移动不受限）", abilities: [
    "酸液喷枪：远距 atk + 1d6 酸，1 击破，并施加腐蚀",
    "站在酸液地面上时汲取酸，改用大酸液弹：先标定一个区，下个敌人回合发射——区内随机一人 2×atk 酸 2 击破，同区其他人 等级 + 1d6 酸",
    "协助攻击：远距 1×atk 酸，1 击破；大酸液弹蓄力中则立刻对标定的区发射（不看距离）"] },
  bigsand: { move: "近距离", abilities: [
    "沙击：atk + 1d4 物理，1 击破",
    "场上沙灵不足三只时，召唤四足或人形沙灵 1d4 只",
    "同区没有敌人时，治疗血量最低的沙灵 2d4",
    "协助：任意距离 1.5×atk"] },
  livesand: { move: "不移动，远近皆可", abilities: [
    "每回合一次 atk 物理",
    "被杀死时吸收场上所有活着的沙灵，获得它们的全部血量和 atk（每吸收一只 def +1），变成巨型活沙",
    "巨型活沙：近距沙子穿刺至多两个目标各 atk 物理 1 击破；远距流沙漩涡，区内全员 atk 物理 2 击破并失去行动",
    "巨型活沙三回合内没被打死：每回合对所有区域的所有单位打一次 atk 物理",
    "可以对自己协助：对被击破单位所在区打一次 atk 物理"] },
  giant: { move: "远近皆可", abilities: [
    "近距砸击：atk + 1d8 物理，2 击破",
    "远距能量：atk + 1d8 能量，1 击破",
    "协助：近距捏碎颅骨，让目标倒地"] },
  patrolboat: { move: "飞行", abilities: [
    "电弧扫射：距离 1 的所有敌人 1d6 + atk 电，并可对其中一人施加感电",
    "回合开始时若在飞行则给自己过载：过载期间被击破，坠机之外再吃一次过载爆炸"] },
  spreader: { move: "飞行，保持距离 1", abilities: [
    "喷洒：一区内全员 1d6 + atk 酸，并施加腐蚀",
    "每回合开始在自己所在区生成酸液地面（对自己无效）"] },
  watchcrow: { move: "飞行，远距离", abilities: [
    "能量射线：远距 1d8 + atk 能量，并施加高能",
    "每回合一次，把第一次受到的攻击伤害转成能量反弹回去"] },
  dustbody: { move: "飞行，接近最近的敌人", abilities: [
    "磨蚀：近距 1d6 + atk 物理，1 击破",
    "卷扬：距离 1 的一人 1d6 + atk 谐波，并推到相邻区",
    "沙尘每回合回复等于等级的量；被击落的那一回合不回复"] },
  // —— 首领 ——
  ufo_boss: { move: "五只机械足分开算血", abilities: [
    "毁掉一只机械足立刻对它击破 1",
    "五足齐全：每回合踩踏，随机两名角色 atk + 1d4 物理，2 击破",
    "剩三足：每回合对远或近其中一区激光，atk 范围能量，1 击破",
    "剩一足：准备自爆，一回合后对所有角色 3×atk 火焰",
    "十级后每回合召唤一个同级的机器人看守",
    "协助：立刻激光 atk/2 能量；可以对自己协助"] },
  sand_aggregate: { move: "三个阶段，行动方式各不相同", abilities: [
    "一阶段（最外层沙尘）：不主动移动；近距沙爪或远距砂岩，atk + 1d8 物理，3 击破。最外层沙尘击穿时自己受 1 击破并进入二阶段",
    "二阶段：每回合两动，主动接近；近距机械臂 atk + 1d10 电，2 击破，之后必定蓄力电能炮（蓄一回合，近距 atk + 1d20 电 2 击破，远距衰减），开炮后过热跳过一次行动。装甲击破进入三阶段",
    "三阶段：主动逃离，每回合两动，必定吸引碎片一次并攻击一次；有人血量低于 50% 时用肉体操控（贴近，atk 物理，逼目标普攻队友，并让他下回合失去行动点）",
    "吸引碎片两次后装甲回满，回到二阶段"] },
  outlaw_king: { move: "每次出场带匕首狂徒、锤狂徒、强盗头子各一", abilities: [
    "对他的攻击总被同区的其他狂徒挡下",
    "攻击命令：远距枪击 atk + 1d4 火焰，所有狂徒的目标切到这个人",
    "处死命令：近距酸液剑 atk + 1d6 酸；强盗头子还活着时 50% 擒拿，成功则目标失去下回合行动",
    "回防命令：所有人回到他所在区筑废铁墙（挡住范围攻击）；他用电击霰弹打另一区全员",
    "哗变：强盗头子血量降到 25%、和王同区且同区没有其他狂徒时，会抓住王让他无法行动、易伤 25%；王被挟持时被杀，强盗头子晋升为王，atk 和 def 翻倍"] },
  chixia: { faction: "天网指挥官", regions: ["外城区", "沙漠"], move: "远近皆可；部队天气：酷暑 + 灼烧层数加倍", abilities: [
    "匕首攻击（1 行动点）：近距 0.75×atk 火焰，1 击破",
    "躲入掩体（2 行动点）：这一回合受击伤害 −50% 且不吃击破，并为下回合预热霰弹枪；用完结束回合",
    "引火（1 行动点）：任意距离施加灼烧；已预热则对同区所有敌方施加灼烧",
    "霰弹枪射击（2 行动点，需预热）：近距 2×atk 火焰 2 击破，远距 1.5×atk 1 击破；对它的协助格挡成功率 −40%",
    "追猎（附赠）：指定一个目标，他移动时她自动跟到同区",
    "格挡（附赠）：受击时给自己格挡，成功率 70%",
    "剿灭（协助）：接自己造成的晕眩，冲向目标零距离射击 2.5×atk 火焰，然后免费移动一次"] }
};
/** 不进图鉴的（玩家空白卡、首领的部件） */
const BESTIARY_SKIP = ["blank_pc", "ufo_leg"];
const BESTIARY_RANK_NAME = { minion: "杂兵", elite: "精英", boss: "首领" };
const BESTIARY_RANK_NOTE = {
  elite: "10 级及以上的精英架势打六折（上面的数字已经算进去），攒满 2 个晕眩标记才真正跳过回合。",
  boss: "首领架势打六折（上面的数字已经算进去），攒满 2 个晕眩标记才真正跳过回合。"
};

/* ---------- 记录（本机 localStorage） ---------- */
function bestiaryStore() {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (e) { return null; }
}
function bestiaryLoad() {
  const st = bestiaryStore();
  let d = null;
  try { d = st ? JSON.parse(st.getItem(BESTIARY_KEY) || "null") : null; } catch (e) { d = null; }
  if (!d || typeof d !== "object" || !d.kits || typeof d.kits !== "object") d = { kits: {} };
  return d;
}
function bestiarySave(d) {
  const st = bestiaryStore();
  try { if (st) st.setItem(BESTIARY_KEY, JSON.stringify(d)); } catch (e) { /* 存不了就算了，下次还能记 */ }
}
/** 图鉴里用的 kit：飞碟的机械足算进飞碟触灵 */
function bestiaryKitOf(u) {
  if (!u || u.isPlayer || u.isProp || !u.kit) return null;
  if (u.kit === "ufo_leg" || u.kit === "ufo_body") return "ufo_boss";
  return BESTIARY_SKIP.includes(u.kit) ? null : u.kit;
}
/** 一场战斗结束：场上出现过的敌人都记为遭遇过（次数、见过的等级、打倒几只） */
function bestiaryRecordBattle(outcome) {
  const units = (state.units || []).filter(u => !u.isPlayer && !u.isProp && (!u.hidden || u.dead));
  if (!units.length) return [];
  const d = bestiaryLoad();
  const now = Date.now();
  const fresh = [];
  const seenThis = new Set();
  units.forEach(u => {
    const kit = bestiaryKitOf(u);
    if (!kit) return;
    const e = d.kits[kit] || (fresh.push(kit), { met: 0, kills: 0, minLv: null, maxLv: null, first: now });
    if (!seenThis.has(kit)) { e.met += 1; seenThis.add(kit); }
    const lv = Number(u.level) || 1;
    e.minLv = e.minLv == null ? lv : Math.min(e.minLv, lv);
    e.maxLv = e.maxLv == null ? lv : Math.max(e.maxLv, lv);
    if (u.dead || u._removed) e.kills += 1;
    e.last = now;
    e.lastOutcome = outcome || null;
    d.kits[kit] = e;
  });
  bestiarySave(d);
  if (fresh.length && typeof appendLog === "function") {
    appendLog(`敌人图鉴：新收录 ${fresh.map(k => bestiaryName(k)).join("、")}。`);
  }
  return fresh;
}
function bestiaryPreset(kit) { return (typeof enemyPresets === "function" ? enemyPresets() : []).find(p => p.id === kit) || null; }
function bestiaryName(kit) {
  if (kit === "ufo_boss") return "飞碟触灵";
  const p = bestiaryPreset(kit);
  return p ? p.name : kit;
}
function bestiaryRank(kit) {
  if (typeof ENEMY_INFO !== "undefined" && ENEMY_INFO[kit] && ENEMY_INFO[kit].boss) return "boss";
  if (kit === "ufo_boss" || kit === "sand_aggregate" || kit === "chixia") return "boss";
  return (typeof ENEMY_RANK !== "undefined" && ENEMY_RANK[kit]) || "minion";
}

/** 按等级、人数算出来的数值（和战斗里一样用 enemyPresets().build） */
function bestiaryStats(kit, level, partySize) {
  const p = bestiaryPreset(kit);
  if (!p) return null;
  let u;
  try { u = p.build(Math.max(1, Number(level) || 1), Math.max(1, Number(partySize) || 2)); } catch (e) { return null; }
  if (Array.isArray(u)) u = u[0];
  if (!u) return null;
  const sg = u.suggest || {};
  return {
    layers: (u.layers || []).map(l => ({ type: l.type, name: (typeof LAYER !== "undefined" && LAYER[l.type]) || l.type, hp: Number(l.max) || 0 })),
    def: Number(u.defMax != null ? u.defMax : u.def) || 0,
    atk: Number(u.atk) || 0,
    range: u.range || "any",
    element: sg.element || "physical",
    elementName: (typeof ELE !== "undefined" && ELE[sg.element]) || sg.element || "物理",
    dice: Array.isArray(sg.dice) ? sg.dice : null,
    flying: !!u.flying
  };
}

/** 图鉴的整张表：[{ kit, name, rank, faction, regions, seen, rec, text }]（按 杂兵 → 精英 → 首领 排） */
function bestiaryEntries() {
  const d = bestiaryLoad();
  const order = { minion: 0, elite: 1, boss: 2 };
  const list = (typeof enemyPresets === "function" ? enemyPresets() : [])
    .filter(p => !BESTIARY_SKIP.includes(p.id))
    .map(p => {
      const info = (typeof ENEMY_INFO !== "undefined" && ENEMY_INFO[p.id]) || {};
      const rank = bestiaryRank(p.id);
      return {
        kit: p.id, name: bestiaryName(p.id), rank, rankName: BESTIARY_RANK_NAME[rank] || rank,
        faction: info.faction || (BESTIARY_TEXT[p.id] || {}).faction || "", regions: info.regions || (BESTIARY_TEXT[p.id] || {}).regions || [],
        seen: !!d.kits[p.id], rec: d.kits[p.id] || null,
        text: BESTIARY_TEXT[p.id] || null, rankNote: BESTIARY_RANK_NOTE[rank] || ""
      };
    });
  return list.sort((a, b) => (order[a.rank] - order[b.rank]) || 0);
}
function bestiaryProgress() {
  const all = bestiaryEntries();
  return { seen: all.filter(e => e.seen).length, total: all.length };
}
/** 清空图鉴（设置 / 测试用） */
function bestiaryReset() { bestiarySave({ kits: {} }); }
