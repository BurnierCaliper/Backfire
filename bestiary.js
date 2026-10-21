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
  mine_overseer: { move: "近距离，主动贴近", abilities: [
    "火焰重锤：atk + 1d6 火，2 击破，打中施加灼烧 1",
    "协助：冲到目标那一区，造成 atk/2 火，1 击破"] },
  flint_sweeper: { move: "远距离，主动远离", abilities: [
    "发射火石（连击）：1d6 发，每发单独结算、单独格挡，0.5×atk + 1d4 火，只有第一发 1 击破；没被嘲讽就尽量分给远距离的不同的人。发数在回合开始掷好，2 发以上名牌上提示「连击」",
    "站在火场里时：每一发打中都施加灼烧 1",
    "协助：远距爆炸火石 1.5×atk 火，带爆燃"] },
  alarm_bot: { move: "不会主动移动；开场休眠", abilities: [
    "休眠：不行动、不协助。我方单位进入它所在的区（走进来、被推进来都算），或同阵营的友方（不含异星生物）受到伤害时解除休眠",
    "解除休眠时：对吵醒它的单位施加高能",
    "电涌：对所有高能的敌人（不限距离）各 3 段 0.3×atk + 1d4 能量，共 1 击破",
    "施加高能时目标已经高能：改为造成 1 点能量伤害",
    "协助：对所有高能的敌人各 1×atk 能量"] },
  meteor_miner: { move: "飞行，保持距离 1；开场带蓄能", abilities: [
    "能量射线：远距 1×atk 能量，1 击破，带倒流",
    "被我方打死时：给杀它的人施加高能，并把自己的高能值转过去",
    "协助：同普通攻击"] },
  sandfish_lead: { move: "近距离，主动贴近；沙鱼群的领头", abilities: [
    "白天·撞击：近距 1×atk + 1d6 物理，2 击破（10 级起 3）——负责把猎物拍晕",
    "夜晚 / 沙暴·撕咬：近距 1.5×atk + 1d8 物理，1 击破",
    "群起：沙鱼打出失衡时，每只还能出手的沙鱼都冲到失衡的人那一区协助攻击（每只每回合一次）",
    "声呐：每个敌人回合开始探测一次附近的尘虫（白天 6%、夜晚 35%）；血量低于一半（夜晚不管血量）就去捕食",
    "母系：它倒下后鱼群失去协调，不再群起、不再探测，每回合每只沙鱼 30% 下潜逃走",
    "富集变种（所有沙鱼都可能是）：名字前加「富集」，装甲 ×1.5；打倒奎支 ×5 并掉武器升级材料；第 3 回合起每回合 30% 下潜逃走（什么都不掉）",
    "吞噬：尘虫 / 管虫失衡时，离得最近的沙鱼冲过去吞掉，回复猎物剩下的生命，用掉行动点"] },
  sandfish_drive: { move: "近距离，主动贴近；从不下潜（故意吵）", abilities: [
    "白天·甩尾：近距 0.5×atk + 1d4 物理，1 击破，打中就把人推到相邻区（优先推向埋伏的伏咬沙鱼、领潮、流沙）",
    "夜晚 / 沙暴·乱咬：近距 1×atk + 1d6 物理，不额外击破",
    "群起：甩尾 / 乱咬"] },
  sandfish_ambush: { move: "白天下潜埋伏、不主动移动；夜晚主动出击", abilities: [
    "下潜：开场在沙下，每个敌人回合开始重新下潜；只有谐波和塌陷打得到",
    "白天·腾咬：有猎物走进或被推进它的区，立刻破沙咬一口：1×atk + 1d6 物理，1 击破（目标下陷中或这回合被推过 +1）",
    "夜晚 / 沙暴·猛咬：近距 1.75×atk + 1d6 物理，不额外击破",
    "群起：腾咬 / 猛咬"] },
  // 富集变种不单列：任何沙鱼都有 10%（沙暴 25%）是富集个体，见 README
  dust_bug: { move: "中立生物：不攻击、不占代币，不算胜负", abilities: [
    "白天在沙面晒背；每回合第一次挨打后摊平：之后到下回合开始受到的伤害 −50%（击破照常）",
    "夜晚 / 沙暴下潜迁徙：2–3 回合后钻走离开战场",
    "被打失衡就会被附近的沙鱼吞掉（沙鱼回复它剩下的生命并跳过行动）——可以拿来喂沙鱼"] },
  tube_worm: { move: "中立生物：不攻击、不移动、不占代币", abilities: [
    "所在的区变成流沙；同区 2 只以上「沸腾」，相邻区也变成流沙；管虫死光后流沙每回合 50% 消退",
    "一直在震动，沙鱼的声呐总能发现它；被打失衡就会被沙鱼吞掉"] },
  meteor_spider: { move: "近距离，主动贴近；通常两只一组", abilities: [
    "撕咬：近距 1×atk 能量，1 击破",
    "除自己之外，场上每有一只活着的陨体衍蛛，atk +25%",
    "死亡时 25% 把天气变成微光",
    "微光下死亡、场上还有活着的衍蛛：留在场上，下回合结束时以 50% 血量、1 架势复活；衍蛛全部死亡就不再复活",
    "协助：撕咬，并施加高能"] },
  meteor_centipede: { move: "远距离，不会主动移动；专打血量最低的人", abilities: [
    "弦振射线：远距 1×atk 能量，1 击破，施加高能；场上每只陨体衍蛛立刻对同一个人免费打 1 点能量",
    "微光下死亡：分裂成 1–3 只陨体衍蛛",
    "协助：同普通攻击，衍蛛的追打次数翻倍"] },
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
  gas_collector: { move: "近距离，主动接近：每回合先移动再行动", abilities: [
    "点燃燃气：所在区不是火场（也不是固有场地）时，对同区的人 0.5×atk 火，并把这一区变成火场",
    "喷火：所在区是火场时，对近距离一人 3 段 0.5×atk 火，共 1 击破",
    "目标身上有灼烧时，每一段攻击回复 3% 血量上限 × 灼烧层数",
    "协助：冲到目标那一区，先施加灼烧 1，再喷火"] },
  ant_hunter: { move: "远距离，主动远离；有人进入它所在的区时（走进来、被推进来都算）用附赠行动退开，并给进来的人灼烧 1", abilities: [
    "灼热子弹：远距 atk + 1d8 火，1 击破，穿刺",
    "敌人回合开始：天气不是酷暑而且能改，就花 1 行动点把天气变为酷暑",
    "协助：狙击 1×atk + 目标血量上限 10% 的火，穿刺 + 爆燃"] },
  bigsand: { move: "近距离", abilities: [
    "沙击：atk + 1d4 物理，1 击破",
    "场上沙灵（含大沙灵自己和其他精英沙灵）不足三只时，召唤四足或人形沙灵 1d4 只",
    "同区没有敌人时，治疗血量最低的沙灵 2d4",
    "协助：任意距离 1.5×atk"] },
  livesand: { move: "不移动，远近皆可", abilities: [
    "每回合一次 atk 物理",
    "被杀死时吸收场上所有活着的沙灵和沙漠生物（沙鱼），获得它们的全部血量和 atk（每吸收一只 def +1），变成巨型活沙",
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
    "沙尘爆裂（一阶段 · 远离）：标记我方全员，到时每个被标记的人在自己的区爆炸一次，炸到同区每个人（不能格挡）——要分开站",
    "狂暴连打（一阶段）：花 1 行动点盯上一个随机的人（被嘲讽就盯牵制者），下个敌人回合冲到他的区连打 4 击（每击 atk + 1d8 物理、1 击破）。出手时被嘲讽会转火；每击都能协助格挡，成功率 +10%；4 击全被挡下它自己受 4 击破",
    "二阶段：每回合两动，主动接近；近距机械臂 atk + 1d10 电，2 击破。装甲击破进入三阶段",
    "电能炮（二阶段 · 死刑）：锁定血量上限最高的人，下一个敌人回合开始时开炮，分两段（atk + 1d20 电，每段都能协助格挡）；目标不在它所在的区就衰减为 0.5×atk + 1d10；目标同区的其他人被波及 0.5×atk（不能格挡）。开炮前的那个我方回合它蓄满能量，受到的伤害 −50%；开炮后过热，自身熔融到下一个我方回合结束",
    "三阶段：主动逃离，每回合两动，必定吸引碎片一次并攻击一次；有人血量低于 50% 时用肉体操控（贴近，atk 物理，逼目标普攻队友，并让他下回合失去行动点）",
    "吸引碎片两次后装甲回满，回到二阶段"] },
  outlaw_king: { move: "每次出场带匕首狂徒、锤狂徒、强盗头子各一，还有两波狂徒援军", abilities: [
    "对他的攻击总被同区的其他狂徒挡下",
    "攻击命令：远距枪击 atk + 1d4 火焰（骰子每 5 级升一档），所有狂徒的目标切到这个人",
    "处死命令：近距酸液剑 atk + 1d6 酸（骰子每 5 级升一档）；强盗头子还活着时 50% 擒拿，成功则目标失去下回合行动",
    "公开处刑（死刑，1 行动点）：标记血量上限最高的人，两回合后的敌人回合开始时落下：王先砍一刀（1.5×atk + 1d6 酸），每个还站着的手下再各补一刀；每一刀都能协助格挡。强盗头子还在就试着擒拿。落下后过一回合才会再用",
    "齐射（回防命令之后）：狂徒们拔枪瞄准我方每个角色，下一个敌人回合开始时王朝每人各开一枪（atk + 1d8 物理，2 击破，每枪都能协助格挡——站在一起、留着附赠动作互相挡）；这一回合他的行动点用在齐射上",
    "狂徒援军：开场就写着援军要赶来（第 3、6 回合各来匕首、锤狂徒一个，到王身边集合）；场上的敌人全灭、战斗结束就不来了",
    "回防命令：手下被打倒过，他下次行动就改成回防（每 3 回合最多一次）。所有手下回到他所在区筑废铁墙（挡住范围攻击）；他用电击霰弹打相邻一区全员",
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
    if (u.dead) e.kills += 1;   // 下潜逃走的（只有 _removed）不是击杀
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

/** 伤害骰随等级变化的敌人（enemies.js 里用 leveledSides / addedDiceByLevel 的）：图鉴的「伤害骰」是 1 级基础骰，旁边注明怎么变 */
const BESTIARY_DICE_SCALE = {
  buoy: "每 5 级升一档", dumpdrone: "每 5 级升一档", swarm: "每 5 级升一档", crow: "每 5 级升一档",
  patrolboat: "每 5 级升一档", spreader: "每 5 级升一档", watchcrow: "每 5 级升一档", dustbody: "每 5 级升一档",
  captain_ox: "骰数每 5 级 +1", captain_wolf: "借机骰数每 5 级 +1"
};

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
    diceScale: BESTIARY_DICE_SCALE[kit] || "",
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
        text: BESTIARY_TEXT[p.id] || null, rankNote: BESTIARY_RANK_NOTE[rank] || "",
        // 可能掉的制作材料（items.js · enemyDropTable）：[{ id, name, chance 期望份数 }]，图鉴详情「可能掉落」一节显示（bestiary-ui.js · dropsSection）
        drops: typeof enemyDropTable === "function" ? enemyDropTable(p.id) : []
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
