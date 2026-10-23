/* Antlerscale: Backfire · 配置物图鉴 / 效果图鉴（规则 / 数据）
 *
 * 和敌人图鉴（bestiary.js）放在同一个图鉴界面里（bestiary-ui.js 顶上的「敌人 / 配置物 / 效果」切换）。
 * 配置物和效果是规则说明，不需要遭遇过，一直都能查。角色、专长、义体图鉴也在这里（见文件后半）。
 * 文字按《游戏规则》第五章（伤害属性、血量层）、第七章（效果系统）、第八章（攻击效果、飞行、配置物）整理；
 * 和手册不同的地方以游戏里的实现为准（碎渣机炮每次使用也 −1 耐久；超充能电池摧毁时炸同区所有单位，不分敌我）。
 * 铁壁 / 防护罩 / 废铁墙是技能造出来的配置物，手册配置物一节里没有，按技能说明写。 */
"use strict";

/** 效果分类：顺序就是图鉴里标签的顺序 */
const CODEX_EFFECT_GROUPS = [
  { id: "element", name: "伤害属性", note: "七种伤害属性的特性，以及对五种血量层的克制倍率。" },
  { id: "layer", name: "血量层", note: "五种血量层的特性。" },
  { id: "status", name: "属性状态", note: "分属七种属性，占用角色的效果位，持续生效。" },
  { id: "common", name: "通用状态", note: "不归属于任何属性，由技能、种族特长、装备等施加，不占用效果位。" },
  { id: "instant", name: "即时效果", note: "只在单个回合生效，和持续性状态效果区分。" },
  { id: "self", name: "自我效果", note: "影响自身，同时只能存在一种，前一种解除之前无法进入下一种。" },
  { id: "attack", name: "攻击效果", note: "附着在下一次攻击上；七种属性攻击效果占用效果位，穿刺 / 猛击 / 弱点特效不占。" },
  { id: "field", name: "场地效果", note: "只对单个区域生效，不会波及相邻区域。" },
  { id: "weather", name: "天气效果", note: "对全局生效，同时只能存在一种，持续到被覆盖。" },
  { id: "unit", name: "单位特殊性", note: "飞行、下潜等单位本身的特殊规则。" }
];

/** 伤害属性的核心特性（克制倍率由 engine.js 的 CHART 现算） */
const CODEX_ELEMENT_TRAIT = {
  fire: "对肉体效果绝佳。",
  acid: "对装甲效果绝佳。",
  electric: "对护盾效果绝佳。",
  ice: "击破架势后造成冰冻——使敌人下次受到攻击伤害时额外 +50%。",
  energy: "直伤高，但削韧少。",
  physical: "直伤低，但削韧高。",
  harmonic: "对晕眩状态的敌人造成伤害时，额外对次外层造成同样的一次伤害。"
};
const CODEX_LAYER_TRAIT = {
  flesh: "无特殊机制。",
  armor: "对除酸和冰以外的伤害具有 25% 减伤；受物理伤害时击破 +1。",
  shield: "一个回合内未受到伤害就会完全恢复。",
  sand: "总是自动恢复等于角色等级数值的血量；火和能量造成的伤害可以阻止其恢复。",
  spirit: "无特殊机制。"
};

const CODEX_PROPS = [
  {"id": "bridge", "name": "不稳桥梁", "place": "间隔", "movable": false, "lines": ["每次有单位通过时，桥梁失去1d6耐久。", "拥有10~30点耐久，取决于战斗。", "桥梁被摧毁后，变为空隙。", "带有飞行的单位无视此效果。"]},
  {"id": "wall", "name": "危墙", "place": "间隔", "movable": false, "lines": ["有一定耐久值1～15，DM自行调整。", "相邻区域可以用近距离或远距离攻击到它，远距离还可以在不相邻的区域攻击到（三区制下）危墙被摧毁之前，任何行动无法影响到墙对面。", "危墙被摧毁时，对倒下方向所在区域所有单位造成1d10伤害和2击破，每五级增加1d10。", "受到击破时损失等量耐久值。", "摧毁方向只看最后一击来源区域。"]},
  {"id": "door", "name": "机关门", "place": "间隔", "movable": false, "lines": ["无限耐久值。", "受按钮或者拉杆控制开关。", "关闭时无法通过或者影响对面的区域。", "按钮和拉杆都需要消耗行动点来操作。", "可能存在定时门。"]},
  {"id": "button", "name": "按钮", "place": "区域", "movable": false, "lines": ["使用行动点可以按下，在回合结束前触发对应的装置效果。", "无限耐久。", "攻击也会触发它。"]},
  {"id": "lever", "name": "拉杆", "place": "区域", "movable": false, "lines": ["使用行动点可以切换状态，触发对应的装置效果。", "无限耐久。", "攻击也会触发它。"]},
  {"id": "battery", "name": "超充能电池", "place": "区域", "movable": true, "lines": ["具有阵营标签。", "拥有15+3*等级点装甲生命值。", "存在期间为所有机械类同阵营单位增加5+2*等级点护盾。", "并且同阵营所有单位的护盾类型生命总是会在回合结束时回满，无论是否被攻击或者是完全击穿。", "摧毁时对同区域所有单位（不分敌我）造成等级*1d4点电击伤害。"]},
  {"id": "boom", "name": "爆炸桶", "place": "区域", "movable": true, "lines": ["拥有3点耐久。", "受到火焰伤害时扣除3耐久。", "受到能量和雷电伤害时扣除1耐久。", "耐久归零时在所在区域产生剧烈爆炸，造成1d20+等级点火焰伤害和2击破。"]},
  {"id": "acid", "name": "酸液桶", "place": "区域", "movable": true, "lines": ["拥有3点耐久。", "受到谐波伤害时扣除3耐久。", "受到其余伤害扣除1耐久。", "耐久少于3时每回合对同区域随机单位造成4+等级点酸液伤害。", "耐久归零时在所在区域产生酸液地面。"]},
  {"id": "scrap", "name": "碎渣机炮", "place": "区域", "movable": false, "lines": ["可以被狂徒或者玩家单位操控。", "操控消耗1行动点。", "对一个2距离内的敌人发射碎渣，造成1d4次6+等级点物理伤害，造成2击破。", "耐久5，每次受到攻击或使用后减少1耐久。"]},
  {"id": "coral_branch", "name": "沙珊瑚枝", "place": "区域", "movable": false, "lines": ["沙珊瑚单独伸出来的一根分支，拥有 30+4×(等级−1) 点装甲生命值。", "白天没有动作。", "夜晚 / 沙暴：每回合结束缠住同区一个地面单位（最多同时 2 个，不分阵营）。", "被缠住的不能移动、位移也带不走，每回合开始受到 等级+1d6 物理伤害。", "珊瑚枝被摧毁，或一回合内被打掉 25% 耐久（砍断触须），被缠住的单位脱困。", "可燃气通道：白天被火焰打中不掉耐久、反而回复同样多（吸热）；夜晚 / 沙暴被火焰打中，同区所有单位（不分敌我）受到 等级+2d6 火焰 +1 击破，珊瑚自己也挨这一下。每根珊瑚每回合最多爆燃一次。", "打碎掉金属（10 级起 2 个）。"]},
  {"id": "death_statue", "name": "死亡雕像", "place": "区域", "movable": false, "lines": ["被沙珊瑚缠住时死掉的单位，被珊瑚分泌的金属骨骼覆盖而成（我方只有真正死亡才会留下）。", "拥有 20+3×(等级−1) 点装甲生命值。", "掩体：同区的单位挨其他区打来的远程攻击时，协助格挡 +10%（同区几座都只算一次）。", "打碎掉金属。"]},
  {"id": "coral_tentacle", "name": "沙珊瑚触须", "place": "区域", "movable": false, "lines": ["夜晚从沙珊瑚台地的缝隙里伸出来，拥有 8+3×(等级−1) 点装甲生命值。", "砍断它，被它缠住的单位就脱困。"]},
  {"id": "fortress", "name": "移动堡垒", "place": "区域", "movable": true, "lines": ["镇压部队的装甲车，可以上下车的载具配置物：自己不会行动，占1枚代币（带车的遭遇少1枚代币的敌人）。镇压部队的遭遇有30%出现，一场最多一台，开战时一定有一个敌人坐在车上当驾驶员。", "纯装甲：42+11*(等级-1)+2*⌊等级/5⌋，按队伍人数缩放；架势5，每10级+1，两个晕眩标记；ATK 7+(等级-1)；开炮骰1d6起，每5级升一档。", "4个座位，镇压队所有兵种都能上。上车花1行动点，下车不花。第一个上车的是驾驶员，驾驶员下车或倒下时按上车顺序递补。", "驾驶员和堡垒合并成一个单位：堡垒装甲在最外层，驾驶员自己的血量层在里面，架势和晕眩标记用堡垒的；刺骨这类打内层的效果可以直接打到驾驶员。炮手藏在车里，选不中。车上的人只能用车的武器。", "驾驶员：附赠移动一个区，移动后可以撞一个单位（0.75×atk物理，2击破）；行动点开炮，或者张开掩体（到下次行动前代挡100%，堡垒受伤-25%）。", "炮手（行动点二选一）：开炮——2距离内一个目标，1×atk+开炮骰火，1击破，50%灼烧1；焚烧——同区所有敌对单位0.5×atk火，每个被打的单位各有35%灼烧1。", "代挡：堡垒在场时（空车也算），同区同阵营的单位挨打，每次各掷40%，成功由堡垒承受伤害和击破；范围攻击每人各掷一次。车被哪一方占着就替哪一方挡，空车替最后坐在车上的一方。", "被摧毁时殉爆：同区所有单位（不分敌我）1×atk火、灼烧1；车里的人立刻失衡（精英也直接晕眩），再受2×atk火和灼烧。", "抢车：敌我不能同车。同区花1行动点把对方一人拉下车（我方过困难「运动」检定，敌人25%）；车上没有对方的人以后才能上车（我方过普通「载具驾驶」检定，敌人直接上）。"]},
  {"id": "turret", "name": "防卫自律炮台", "place": "区域", "movable": false, "lines": ["行动，自动攻击。", "每回合对一个atk最高的敌对单位造成高能，以及2次等级点能量伤害。", "困难数据操作可以改写阵营。", "拥有25+2*等级点装甲生命值。"]},
  {"id": "ironwall", "name": "铁壁", "place": "区域", "source": "川川「铁壁」", "lines": ["川川把武器变形为大圆盾，为同区域的所有我方角色在一回合内阻挡敌人的攻击。", "盾牌拥有 atk+1d6 点装甲；盾牌被击破后川川自身受到 3 击破。", "回合结束时盾牌未被击破则积攒 2 电能。", "至少 3 电能时可以额外消耗 1 电能，为铁壁外层增加 atk 点护盾。"]},
  {"id": "dome", "name": "防护罩", "place": "区域", "source": "生存职责「防护罩」", "lines": ["在同区域释放血量为 atk+10 的护盾罩（护盾类型）。", "对该区域我方的攻击先打罩，也完全挡住范围攻击。", "每场一次。"]},
  {"id": "scrapwall", "name": "废铁墙", "place": "区域", "source": "亡命之王「回防命令」", "lines": ["亡命之王下令后，所有人回到他所在的区筑起废铁墙，挡住范围攻击。", "耐久由命令掷骰决定。"]}
];

const CODEX_EFFECTS = [
  {"group": "status", "element": "fire", "name": "灼烧", "lines": ["每回合结束时，按灼烧层数受到 1d4 × 层数 的火焰伤害，然后灼烧 +1。", "每 5 级提高伤害骰一次。"]},
  {"group": "status", "element": "electric", "name": "感电", "lines": ["每次受到攻击时，对同区域所有同阵营单位造成 1d4−1 电击伤害。回合结束的时候总是自动触发一次。", "每 5 级提高一次伤害骰，并在骰子加值上再减 1。", "伤害最低不低于 1。"]},
  {"group": "status", "element": "acid", "name": "腐蚀", "lines": ["每回合结束时受到 2d4 腐蚀伤害。", "对具有装甲血量的单位，伤害骰提升一次。", "每 5 级提高伤害骰一次。（d12 再提升为 d20）"]},
  {"group": "status", "element": "ice", "name": "冻伤", "lines": ["回合结束时受到 1 击破。此次击破视为寒冰伤害。"]},
  {"group": "status", "element": "physical", "name": "震荡", "lines": ["架势条上限减少 2。 "]},
  {"group": "status", "element": "energy", "name": "高能", "lines": ["每次受到能量伤害都会积攒 1d4+1 高能值。", "单位血量低于高能值时自爆，秒杀单位，同时额外造成 AOE × (高能值 ÷ 2) 的伤害。", "每 5 级提高骰子。"]},
  {"group": "status", "element": "harmonic", "name": "共振", "lines": ["受到共振影响的单位：", "每次受到伤害或治疗时，将半值共享给其他受到共振的单位。", "每次受到状态效果或即时效果时，完整共享给其他受到共振的单位。", "不分敌我。", "共振产生的共享效果不会回传。"]},
  {"group": "common", "name": "不稳", "lines": ["下回合附赠动作 −1（最少 0，可被其他附赠加成抵掉），且仅剩1def的情况也会失衡晕眩。叠加两个不稳则转换为晕眩。 触发一次后消失"]},
  {"group": "common", "name": "晕眩", "lines": ["跳过回合。触发一次后消失"]},
  {"group": "common", "name": "紧追", "lines": ["施加者会在目标移动时与其移动到同区域。此移动不消耗附赠动作，无触发次数上限"]},
  {"group": "common", "name": "虚弱", "lines": ["atk −25%"]},
  {"group": "common", "name": "振奋", "lines": ["atk +25%"]},
  {"group": "common", "name": "坚挺", "lines": ["架势值不会低于 1，一回合生效"]},
  {"group": "common", "name": "躲藏", "lines": ["不会被选做攻击目标。单位发动攻击或受到伤害后解除"]},
  {"group": "common", "name": "优势", "lines": ["攻击和格挡或是检定都可以得到一个优势骰，取最大值"]},
  {"group": "field", "element": "fire", "name": "火场", "lines": ["区域内所有单位每回合开始时按火场层数受到 1d4 × 层数 火焰伤害，触发后火场 +1。", "每 5 级提高伤害骰一次。对飞行单位无效。"]},
  {"group": "field", "element": "electric", "name": "高压场地", "lines": ["区域内所有单位每次受到伤害时额外受到 1d4 闪电伤害。每 5 级提高伤害骰一次。", "高压区域内的「不稳」会直接变成「晕眩」。"]},
  {"group": "field", "element": "acid", "name": "酸液地面", "lines": ["区域内所有单位每回合开始受到 2d4 酸液伤害。每 5 级提高伤害骰一次。", "从酸液地面的区域离开时需要消耗行动点，而非附赠动作。", "对飞行单位无效。"]},
  {"group": "field", "element": "ice", "name": "冻土", "lines": ["区域内单位的血量属性克制被强制修改为对冰 25% 易伤（对其他属性不变）。", "从冻土区域主动尝试离开的单位需要进行简单难度运动检定。失败则无法离开区域，还会受到 1 冰属性击破。", "进入冻土区域也会受到 1 冰属性击破。", "对飞行单位无效。"]},
  {"group": "field", "element": "physical", "name": "塌陷区域", "lines": ["此区域内累计出现 5 点击破后塌陷，对区域内所有单位造成 2 击破 + 1d10 物理伤害。", "每 4 级伤害骰增加一个 d10。", "塌陷触发后重置击破计数器。", "对飞行单位无效。"]},
  {"group": "field", "element": "energy", "name": "能量场", "lines": ["区域内单位回合开始时获得 1 点额外行动点。", "场地按 单位数 × 1d4 累积高能值（每 5 级骰子升级）。", "回合开始时，若血量最低的单位血量低于场地当前高能值，该单位自爆（立即失去所有生命值），场地高能值随即清零。每回合最多触发一次。", "若某单位自身带有高能状态，判定其自爆阈值时需将场地高能值一并计入；该单位因此自爆时，场地高能值同样清零。"]},
  {"group": "field", "element": "harmonic", "name": "干涉场", "lines": ["区域内单位：", "每次受到克制伤害时，使下一次受到的伤害 +25%，可叠加。", "每次受到劣势伤害时，使下一次受到的伤害 −25%，可叠加。", "一旦受到相反方向的伤害，叠层立即清空，并以另一侧的初始修正重新开始。"]},
  {"group": "field", "name": "治愈场地", "lines": ["所在单位回合开始时治疗1d4点生命。每5级增加1d4治疗量。"]},
  {"group": "field", "name": "高地", "lines": ["高地对低地发起的远程攻击造成额外25%伤害并且减少协助格挡10%成功率。反之减少25%伤害并且增加10%协助格挡成功率。非高地的区域皆视为低地。"]},
  {"group": "field", "name": "深渊", "lines": ["无法站在此区域。进入此区域的地面单位会坠落并且失去10%最大生命值的生命，飞行单位在深渊被击坠时总计失去30%最大生命值的生命。如果战斗开始时2区制的其中一个区域为深渊，那么所有地面单位会在同一个区域出现。"]},
  {"group": "field", "name": "损毁地面", "lines": ["区域内每有一个地面单位都会每回合损失1d6耐久。拥有20～50点耐久。塌陷区域触发的伤害会直接摧毁地面，变成深渊。"]},
  {"group": "field", "name": "隔离区", "lines": ["区域内不受天气效果影响。"]},
  {"group": "field", "element": "physical", "name": "流沙", "lines": ["站在里面会下陷（0–3 层）：走进去 +1；回合结束时这回合花过行动点再 +1，一个行动点都没花 −1。", "每回合开始失去 生命上限 × 5% × 下陷层数（窒息，不分属性）。", "下陷 2 层起自己走不出去；3 层没顶，不能用行动点和附赠动作、不能协助。", "同伴可以花附赠动作拉人出来；被位移带出去也会脱困。飞行单位、沙灵和沙漠生物不受影响。"]},
  {"group": "field", "element": "physical", "name": "沙珊瑚台地", "lines": ["战斗在沙珊瑚上面进行：自带高地效果。", "夜晚 / 沙暴：每回合开始从缝隙里伸出一根沙珊瑚触须（同区最多 2 根），缠住台地上随机一个地面单位（不分阵营）。", "被缠住的不能移动、位移也带不走，每回合开始受到 等级+1d6 物理伤害；砍断触须才能脱困。", "沙漠生物有躲开珊瑚的习性，沙灵不会躲。"]},
  {"group": "field", "name": "空隙（间隔）", "lines": ["无法通过地面移动通过，飞行单位或是带有飞行/空中/跃过描述的移动技能可以通过。如果桥梁摧毁后地面单位被迫进行地面移动，地面单位坠落，受到最大生命10%点伤害，移动会不生效。消耗行动点并通过成功的运动检定可以通过。"]},
  {"group": "weather", "element": "fire", "name": "酷暑", "lines": ["火焰及酸液伤害 +25%，寒冰伤害 −25%", "灼烧和火场和自焚每回合层数再加 1，自焚层数上限变为10。", "腐蚀伤害骰 +1 个", "冻伤状态会在触发一次之后结束"]},
  {"group": "weather", "element": "ice", "name": "雪天", "lines": ["寒冰和物理伤害 +25%，火焰及酸液伤害 −25%", "灼烧每回合不再增加层数", "腐蚀伤害骰数量减半", "冻伤和冻土击破效果翻倍", "霜结效果额外得到全属性10%减伤率。"]},
  {"group": "weather", "element": "acid", "name": "酸雨", "lines": ["酸液和闪电伤害 +25%；除酸液、闪电、能量外所有伤害 −25%", "腐蚀及酸液地面伤害骰 +1 个", "酸雨中装甲的减伤效果全部失效", "溅射效果的单位会在回合开始时恢复等级点生命。"]},
  {"group": "weather", "element": "electric", "name": "雷鸣", "lines": ["闪电和能量伤害 +25%", "感电伤害骰去掉减值", "成功的协助格挡可以额外造成 等级 × 1d4 闪电伤害的反伤", "导体效果变为每两次攻击就会有一次攻击额外目标。"]},
  {"group": "weather", "element": "energy", "name": "微光", "lines": ["能量伤害 +25%", "除能量外的所有属性受到嬗变，反转克制表（负变正，正变负）", "所有单位造成的击破 −1（不会导致击破变成 0）", "高能值累积时累积 +1", "蓄能状态下，高能值在连续两个回合结束时都超过血量才会导致自爆。"]},
  {"group": "weather", "element": "physical", "name": "沙暴", "lines": ["闪电和酸液伤害 −25%", "沙尘血量恢复效果翻倍", "具有方向：从 1 区吹向 2 区，或反之，总是对释放者所在区域顺风。", "顺风的地面单位每回合多一个附赠行动", "顺风的空中单位每回合多一个行动点", "逆风的空中单位每回合失去一个行动点"]},
  {"group": "weather", "element": "harmonic", "name": "相位", "lines": ["以四回合为周期循环：波谷 → 平衡 → 波峰 → 平衡", "波谷：全场所有伤害 −50%（和其他增减伤加算），击破 −1", "平衡：无特殊效果", "波峰：全场所有伤害 +50%，击破 +1", "相位下，谐波对晕眩敌人的每一层血量层都造成伤害。", "计数器从第一次释放后持续运行，即使被其他天气覆盖也不停止。", "再次释放时，接入当前计数器状态。"]},
  {"group": "weather", "element": "physical", "name": "常态", "lines": ["没有任何效果。可以覆盖其他天气。"]},
  {"group": "instant", "element": "fire", "name": "熔融", "lines": ["使单位的外层血量开始熔化。", "装甲：受物理伤害变为 +50%，但失去 +1 击破的额外效果", "沙尘：受到额外 +1 击破", "护盾：若一回合内累计受到护盾最大值一半的伤害则立刻失效，下回合以一半护盾值恢复", "冰属性攻击对熔融状态的敌人会造成 ×2 伤害和 +1 击破，并立刻结束熔融状态。"]},
  {"group": "instant", "element": "ice", "name": "刺骨", "lines": ["立刻对单位的肉体 / 星灵 / 沙尘层造成 10% 本层血量上限的冰属性伤害。", "目标被击破时再次造成一次此伤害。", "电属性攻击对此目标将有 50% 的伤害转移到最内层的肉体 / 星灵 / 沙尘血量上。", "受到火属性伤害后立刻解除效果，并且对内层血量造成 10% 本层血量上限的火属性伤害。"]},
  {"group": "instant", "element": "acid", "name": "中和", "lines": ["清除目标的属性持续性状态效果，并按不同状态效果结算。可以同时有多个结算效果。", "目标身上每存在超过 1 个的状态效果，中和的整体伤害提高 7%。对于自我效果，也会清除，但没有额外作用。", "灼烧：立刻结算伤害，骰子取最大值", "腐蚀：立刻结算伤害，骰子取最大值", "震荡：立刻造成 2 点击破", "感电：立刻造成一次伤害。若目标有护盾血量，立刻使护盾失效，下回合结束时恢复满", "高能：立刻触发高能的爆炸，即使没有达到血线", "冻伤：立刻结算 2 点冰属性击破", "共振：共振对中和的结算伤害完整生效，并在最后被清除"]},
  {"group": "instant", "element": "electric", "name": "过载", "lines": ["单位的护盾值此回合内翻倍，下回合开始时清零。", "单位的装甲血量受到近距离攻击时，反伤 50% 此次受到的攻击伤害的闪电伤害。", "单位进行的复数次攻击行动额外攻击一次。", "若过载期间被击破，发生过载爆炸，单位受到 等级 × 1d4 点电属性伤害。"]},
  {"group": "instant", "element": "physical", "name": "错位", "lines": ["打乱单位的血量层，使最外层和下面的一层互换位置。", "错位状态下的单位，每次受到克制伤害的攻击会受到 1 击破。"]},
  {"group": "instant", "element": "energy", "name": "扩散", "lines": ["单位如果身上有状态效果，则此回合内对其发动的攻击变为该状态效果对应属性进行伤害结算。", "如果有多个状态效果，总是以「最新施加」的状态效果进行属性结算。"]},
  {"group": "instant", "element": "harmonic", "name": "折射", "lines": ["受到折射影响的单位，血量层被击穿并产生溢出伤害时，溢出伤害 × 1.5。", "此效果可能对一次伤害生效多次（每击穿一层触发一次）。"]},
  {"group": "self", "element": "fire", "name": "自焚", "lines": ["点燃自己。每回合开始时损失10%生命值上限的生命值，不致死。通过任何方式造成火属性伤害时得到伤害值20%的治疗，使用shp站起时，损失和治疗都以shp计算，此方式治疗的shp战斗后不保留。造成的火焰伤害+10%，受到的冰和火伤害降低10%。免疫灼烧。触发此效果后层数+1。最高5层。晕眩后效果结束。"]},
  {"group": "self", "element": "ice", "name": "霜结", "lines": ["将自己包裹在冰之中。受到的物理，酸，能量，谐波，冰伤害减少25%。无法自行移动，造成的冰冻伤害+25%，使用冰属性攻击时恢复1架势值。每回合开始时受到1点冰属性击破，免疫冻伤。霜结效果下再次使用霜结会在下回合开始前完全免受伤害，击破和位移。晕眩后效果结束。"]},
  {"group": "self", "element": "acid", "name": "溅射", "lines": ["用酸液覆盖自身。使用酸属性单体攻击时会在同区域对敌人造成25%的溅射伤害。受到的酸和火伤害减少25%。免疫腐蚀。你在任意移动后失去15%最大生命值的生命。晕眩后效果结束。"]},
  {"group": "self", "element": "electric", "name": "导体", "lines": ["使自身变为超导体。复数攻击次数的动作，攻击次数+1。免疫感电。你每三次攻击都会让第三次攻击额外击中一个随机敌对目标。你的移动不消耗附赠动作。你的架势条上限仅为3。晕眩后效果结束。"]},
  {"group": "self", "element": "physical", "name": "千钧", "lines": ["用武器功能或其他方式增加武器重量。所有攻击技能的攻击倍率增加0.2，并且可以消耗附赠动作再加0.2。每个攻击行动造成总击破增加1点。免受其他单位的位移效果。增加10%格挡成功率。无法通过任何方式恢复架势条。晕眩后效果结束。"]},
  {"group": "self", "element": "energy", "name": "蓄能", "lines": ["主动让自身充满能量。每回合开始时自身积累等级点高能值。能量和谐波和电攻击造成的伤害提高等于高能值占血量上限的百分比。受到谐波伤害增加25%。高能值超过血量时立刻触发和高能状态效果同样的自爆。晕眩后效果消失，但累计的高能值不清零。"]},
  {"group": "self", "element": "harmonic", "name": "多普勒", "lines": ["自身按照特定频率发出波。移动后同回合内下一击谐波攻击的伤害产生变动。移动接近了敌人时，伤害增加25%。移动远离了敌人时，伤害减少25%。同理，接近一个区域后受到来自那个区域的伤害增加25%，反之减少25%。自身受到击破时，施加同量的击破给同区域的所有单位，不分敌我。晕眩后效果消失。"]},
  {"group": "attack", "element": "fire", "name": "爆燃", "lines": ["攻击杀死敌人时爆燃，对同区域敌人造成等于此次溢出伤害的对应属性伤害（按各自目标重新结算属性克制）。", "若被杀死的单位带有灼烧，额外按其灼烧层数，对同区域敌人追加一次灼烧伤害。"]},
  {"group": "attack", "element": "ice", "name": "破冰", "lines": ["攻击对架势超过上限 50%或处于冰冻（克制表效果）的单位，伤害 +25%。", "若目标带有冻伤，使冻伤在本回合结束时造成的击破值，改为与本次攻击造成的击破值一致。"]},
  {"group": "attack", "element": "electric", "name": "雷击", "lines": ["这次攻击行动中，每一次伤害判定都会额外把该次伤害的 25% 转移到全场当前血量最高的敌人身上，无视距离。", "若被转移到的单位带有感电，额外对其造成一次与转移伤害等量的电击伤害。"]},
  {"group": "attack", "element": "acid", "name": "蚀刻", "lines": ["此次攻击伤害 −25%，使目标接下来受到此次攻击属性的伤害 +10%，并视为受该属性克制。", "若目标处于腐蚀状态，额外再叠加一层：接下来受到酸属性伤害 +10%，并视为受酸属性克制。", "可叠加（多次挂载各自独立叠加加成）。"]},
  {"group": "attack", "element": "energy", "name": "倒流", "lines": ["攻击者恢复此次攻击造成伤害量的 25%。", "若目标带有高能，额外恢复等于目标高能值 50% 的生命值，并使目标高能值减少等量。"]},
  {"group": "attack", "element": "physical", "name": "惯性", "lines": ["攻击命中后，攻击者与目标朝同一方向移动 1 距离——方向由攻击者指定：两区制下即切换至另一区；三区制下从当前区域选择一个相邻区域。", "若目标带有震荡，额外造成 2 点物理击破。"]},
  {"group": "attack", "element": "harmonic", "name": "衍射", "lines": ["此次攻击的发起区域可以任意指定，不受角色实际所在区域限制；且无论如何一定命中目标——无视格挡、协助格挡、区域护盾、墙体或任何阻挡效果。", "若目标带有共振，使这次伤害通过共振共享的部分回传一次（例外：共振通常不会回传，见 7.1）。"]},
  {"group": "attack", "name": "穿刺", "lines": ["攻击对次外层造成伤害，而非最外层"]},
  {"group": "attack", "name": "猛击", "lines": ["攻击造成击破 ×2，但同时对自己造成一半的击破"]},
  {"group": "attack", "name": "弱点特效", "lines": ["对克制属性额外 +25% 伤害；对一般或劣势伤害均额外 −25%"]},
  {"group": "unit", "name": "飞行", "lines": ["只有在单位描述中明确写出「飞行」，或在战斗中使用技能进入飞行状态的单位，才是飞行单位。", "架势被击破：强制被击落，并立刻扣除等于 20% 最大血量的血量", "近程攻击：需额外消耗附赠动作；不消耗则无法指定飞行单位为目标", "AOE 攻击：可以攻击到飞行单位，即使是近程 AOE 也不需要消耗附赠动作", "伤害减免：受到的所有攻击行动伤害减半。状态效果不受影响", "场地效果：见各场地条目，多数地面场地对飞行单位无效"]},
  {"group": "unit", "name": "下潜", "lines": ["钻进沙层 / 地下，定位和飞行类似：任何单位都可以带，单位描述或技能里写明「下潜」的才算。", "下潜中不能被选为攻击目标，范围攻击也打不到。", "例外：谐波攻击（单体、范围都算）和塌陷区域的伤害照样打得到；被这两种打到时下潜被迫解除，并受到 1 击破。", "自己发动攻击时浮上来，下潜解除（主动解除，没有代价）。", "沙鱼的声呐能找到沙下的尘虫、管虫（捕食），不算把它们打出来。"]}
];

function codexPct(v) { return (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.round(Math.abs(v) * 100) + "%"; }

/** 伤害属性 / 血量层条目：由 CHART 现算克制倍率，和战斗里一致 */
function codexChartEntries() {
  const out = [];
  if (typeof CHART === "undefined" || typeof ELE === "undefined" || typeof LAYER === "undefined") return out;
  Object.keys(ELE).forEach(el => {
    const row = CHART[el] || {};
    out.push({ group: "element", element: el, name: ELE[el] + "属性",
      lines: [CODEX_ELEMENT_TRAIT[el] || ""].filter(Boolean),
      chart: Object.keys(LAYER).map(l => ({ layer: l, name: LAYER[l], value: Number(row[l]) || 0 })) });
  });
  Object.keys(LAYER).forEach(l => {
    out.push({ group: "layer", layer: l, name: LAYER[l], lines: [CODEX_LAYER_TRAIT[l] || ""].filter(Boolean),
      chart: Object.keys(ELE).map(el => ({ element: el, name: ELE[el], value: Number((CHART[el] || {})[l]) || 0 })) });
  });
  return out;
}

/** 效果图鉴的全部条目（带 id、分类名），按分类顺序排 */
function codexEffectEntries() {
  const all = codexChartEntries().concat(CODEX_EFFECTS);
  const order = CODEX_EFFECT_GROUPS.map(g => g.id);
  return all.map((e, i) => Object.assign({ id: e.group + ":" + e.name, groupName: (CODEX_EFFECT_GROUPS.find(g => g.id === e.group) || {}).name || "" }, e, { _i: i }))
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a._i - b._i);
}
function codexPropEntries() {
  return CODEX_PROPS.map(p => Object.assign({ group: p.source ? "skill" : p.place === "间隔" ? "gap" : "zone" }, p));
}
/** 搜索：名字、分类、说明文字里有关键词就算 */
function codexMatch(e, q) {
  q = String(q || "").trim();
  if (!q) return true;
  const hay = [e.name, e.groupName, e.source, (e.lines || []).join(" ")].concat(e.element && typeof ELE !== "undefined" ? [ELE[e.element]] : []).join(" ");
  return q.split(/\s+/).every(w => hay.indexOf(w) >= 0);
}

/* ---------- 角色图鉴 ---------- */
/** 每名角色的介绍和游玩难度（1–5 星）。技能 / 被动 / 被动升级的文字都来自 skill-text.js，和战斗里显示的一致 */
const HERO_CODEX = {
  ruby: { stars: 4, intro: "骇入战场的机甲驾驶员。平时用电流和短路骚扰敌人，同区有明特时可以合体成飞行机甲，换用火力强大的银翼系列技能。机甲每回合都要烧纳米能源，而能源主要靠场上的高能自爆补充，所以什么时候合体、能撑几回合，需要提前算好。" },
  yuito: { stars: 3, intro: "用咖啡战斗的医生。把咖啡豆磨成咖啡液，就能泡出冰美式、意式浓缩、酸萃这些攻击或辅助用的咖啡。可以「牵挂」一名队友：替他扛下将要打破架势的击破，治疗骰也取最高值。适合想当后援、照顾前排的玩家。" },
  hiaki: { stars: 4, intro: "双刀剑客，火属性大太刀【丹生谷】和冰属性打刀【鳴門】可以随时切换，也能把其中一把分出去变成武器人并肩作战。技能会随拔刀、居合、胁构三种刀势派生出不同效果。顺好刀势的节奏后，输出和格挡都很强。" },
  tou: { stars: 2, intro: "站在最前面的盾。「决一死战」逼同区唯一的敌人只能打他，而且伤害骰取最低；圣盾点每回合自动回复，挨打时消耗一点就能把伤害减半。规则直白，站好位置就能发挥作用，最适合新手。" },
  xia: { stars: 3, intro: "开着引擎往前冲的近战。拉响引擎后多数技能都会变强，但一回合不攻击引擎就会熄火，所以要一直保持进攻。濒死起身后引擎总是开着，越到绝境越凶。被动升级后加入燃油槽，火属性伤害的爆发会更高，玩法也稍微复杂一些。" },
  chuan: { stars: 3, fullName: "哈雷 川川 托马斯", intro: "攻守兼备的电工。用技能积攒电能，再换成铁壁、电站超频这类强力技能。他施加的护盾被打破时，会把同区敌人全部推到另一区并造成击破，可以用来解围或者控场。需要规划电能怎么花、护盾放在哪里。" },
  nora: { stars: 4, intro: "拿着注射器的远程冰属性辅助。武器系统在温和和残忍两种状态之间随机切换，同一个技能在两种状态下效果不同。针尖留在敌人身上会形成「刺入」，配合冷气注射打出额外的冰伤。状态不由自己决定，要临场应变。" },
  kolt: { stars: 2, intro: "爱出风头的改装狂。电钻（电）和酸液炮（酸）两种刀头可以随时更换，换刀头时顺手打一下同区敌人。他打过的敌人都会被嘲讽来打他，满血时受到的伤害降低。思路简单：抢仇恨、换刀头打克制。" },
  helu: { stars: 5, intro: "战场分析师。用聚焦锁定敌人的血量层，按照正确的步骤攻击就能直接抹掉整层血量，再附加 2 击破。精英和首领需要走更多步，用符合当前天气的属性攻击可以推进步数。还能扫描环境、预测敌人的下一步行动。需要整队配合他的节奏，上限极高。" },
  ras: { stars: 5, intro: "一颗行走的炸弹。体内能量每回合都在累积，必须用技能把它引流成光能，否则超过 100% 就会进入不稳态：所有攻击的攻击次数翻倍，但再受伤就会倒地甚至死亡。场上的高能爆炸能帮她回收光能。她是在悬崖边跳舞的高风险输出。" },
  longge: { stars: 4, intro: "拄着枪管手杖的典当行老板。手杖近战，解开保险后可以改用霰弹枪远程射击。6 发红蓝胶囊弹顺序随机：红弹火攻，蓝弹冰攻，也都能拿来治疗。靠「窥探」提前看到后面子弹的颜色，再决定这一发用来打人还是救人。另外他会吐酸，但怕能量属性。" }
};

/** 角色图鉴条目：按角色卡（Lv1）生成完整资料（SkillText.heroSheet），加上介绍和难度 */
function codexHeroEntries() {
  if (typeof livePartyCards !== "function") return [];
  const ST = (typeof window !== "undefined" && window.SkillText) || (typeof SkillText !== "undefined" ? SkillText : null);
  const cards = livePartyCards();
  return cards.filter(c => c.attrs && HERO_CODEX[c.kit]).map(card => {
    const u = JSON.parse(JSON.stringify(card));
    // 1 级数值用规则实际算出来的（applyLevelStats，和上场时一样），不照抄卡面：瑞比卡面架势 3，按耐力算是 4。
    // 不用 spawnLiveCard（会消耗随机数，图鉴可能在战斗中打开）
    u.layers = (card.layers || []).map(l => ({ type: l.type, current: Number(l.hp) || 0, max: Number(l.hp) || 0 }));
    u.linkedKits = (card.linkedKits || (typeof defaultLinkedKits === "function" ? defaultLinkedKits(card.kit) : [])).slice();
    u.weaponLevels = {};
    if (typeof applyLevelStats === "function") { try { applyLevelStats(u); } catch (e) { /* 用卡面值 */ } }
    let sheet = null;
    try { sheet = ST ? ST.heroSheet(u, []) : null; } catch (e) { sheet = null; }
    const prof = typeof heroProfile === "function" ? heroProfile(card.kit) : null;
    // 职责技能：主 / 副职责各自的 1–4 号技能（开局有主职责 1 号，之后 5 / 10 / 15 级按路线选）
    const roleSkills = [];
    const roles = card.roles || {};
    [["主职责", roles.primary], ["副职责", roles.secondary]].forEach(([label, role], i) => {
      if (!role || (i === 1 && role === roles.primary)) return;
      for (let n = 1; n <= 4; n++) {
        const def = typeof roleSkillDef === "function" ? roleSkillDef(role, n, u) : null;
        if (!def) continue;
        const text = (ST && ST.skillText(def.id)) || def.hint || "";
        roleSkills.push({ id: def.id, name: def.name, role, label, n, cost: ST ? ST.skillCostText(def.id) : "", text });
      }
    });
    return Object.assign({ roleSkills, id: card.kit, kit: card.kit, name: card.name, enName: card.enName || "",
      race: prof ? prof.race : "", job: prof ? prof.job : "", profs: prof ? Object.assign({}, prof.profs) : {},
      note: card.note || "", sheet }, HERO_CODEX[card.kit], {
      group: HERO_CODEX[card.kit].stars <= 2 ? "easy" : HERO_CODEX[card.kit].stars === 3 ? "mid" : "hard",
      groupName: "难度 " + HERO_CODEX[card.kit].stars + " 星",
      // 搜索用：介绍、种族职业、被动和技能的名字与说明
      lines: [HERO_CODEX[card.kit].intro, HERO_CODEX[card.kit].fullName || "", prof ? prof.race + " " + prof.job : ""].concat(sheet ? [].concat(
        sheet.passives.map(x => x.name + " " + x.text + " " + (x.next || "")),
        sheet.skills.now.concat(sheet.skills.later).map(x => x.name + " " + x.text),
        sheet.weapons.map(w => w.name), roleSkills.map(x => x.name + " " + x.text)) : [])
    });
  });
}
/** 被动升级的解锁条件：武器等级（growth.js · PASSIVE_PLUS_LEVEL） */
function codexPlusLevel(n) {
  return typeof PASSIVE_PLUS_LEVEL !== "undefined" ? PASSIVE_PLUS_LEVEL[n] || null : null;
}

/* ---------- 专长图鉴（#52） ---------- */
/** 专长条目：直接读 feats.js · FEATS，文字和选专长时看到的一样。全部列出（不做解锁），探索专长也列，带标签 */
const CODEX_FEAT_TIER_MARK = ["①", "②", "③", "④"];
const CODEX_ROLE_SKILL_NO = ["", "一", "二", "三", "四"];
/** 次数：每场 / 每次短休 / 每长休（战斗动作看 skill，被动看专长上的 short / rest）；说明里自己写清楚的（还魂、决不后退……）返回 "" */
function codexFeatUses(f) {
  const s = f.skill || {};
  if (s.short || f.short) return `每次短休 ${s.short || f.short} 次`;
  if (s.rest || f.rest) return `每长休 ${s.rest || f.rest} 次${s.rest ? "（同一场最多 1 次）" : ""}`;
  if (s.uses) return `每场 ${s.uses} 次`;
  return "";
}
function codexCostText(c) {
  if (!c) return "";
  const out = [];
  if (c.ap) out.push(`行动点 ${c.ap}`);
  if (c.bonus) out.push(`附赠 ${c.bonus}`);
  return out.join(" + ") || "不花行动";
}
/** 消耗：另写的削弱版看 skill.cost；直接调用原技能的涉猎专长看原技能 */
function codexFeatCost(f) {
  if (!f.skill) return "";
  if (f.skill.cost) return codexCostText(f.skill.cost);
  if (f.dabble && typeof skillCost === "function") { try { return codexCostText(skillCost(f.dabble.base)); } catch (e) { return ""; } }
  return "";
}
function codexFeatEntries() {
  if (typeof FEATS === "undefined") return [];
  return Object.keys(FEATS).map(id => {
    const f = FEATS[id];
    const lv = typeof FEAT_TIER_LEVEL !== "undefined" ? FEAT_TIER_LEVEL[f.tier] : null;
    const kindName = f.dabble ? "涉猎" : (typeof FEAT_KIND_NAME !== "undefined" && FEAT_KIND_NAME[f.kind]) || "专长";
    let dabbleFrom = "";
    if (f.dabble) {
      let base = null;
      try { base = typeof roleSkillDef === "function" ? roleSkillDef(f.dabble.role, f.dabble.n, null) : null; } catch (e) { base = null; }
      dabbleFrom = `${f.dabble.role}职责 ${CODEX_ROLE_SKILL_NO[f.dabble.n] || f.dabble.n} 号技能${base ? "「" + base.name + "」" : ""}的涉猎版；已经会这个技能的角色不能选`;
    }
    const tags = [];
    if (f.repeatable) tags.push("可以重复选");
    if (f.explore) tags.push("跑团规则（探索）");
    if (f.trpgOnly) tags.push("只在跑团模式");
    if (typeof f.requires === "function") tags.push("有选取前提");
    return {
      id: "feat:" + id, featId: id, name: f.name, tier: f.tier, level: lv,
      group: "t" + f.tier, groupName: `专长${CODEX_FEAT_TIER_MARK[f.tier - 1] || ""}${lv ? " · " + lv + " 级" : ""}`,
      kindName, uses: codexFeatUses(f), cost: codexFeatCost(f), dabbleFrom, tags,
      lines: [f.text || ""].filter(Boolean)
    };
  }).sort((a, b) => a.tier - b.tier);
}

/* ---------- 义体图鉴（#262） ---------- */
/** 义体条目：读 cyberware.js 的正式目录（示例不列），文字由义体种类表生成（cyberware.js · cyberwareCodexInfo），和诊所、战斗里一致。
 *  按种类分组（CYBERWARE_KINDS 的顺序，以后加了新种类自动多一个标签）；每条写名称、等级、效果、改造率、坚毅生命的消耗、诊所规则。
 *  只写固定的规则文字：可以写坚毅生命的具体消耗，不显示任何角色当前的坚毅生命，也没有能推出它的数字 */
function codexCyberwareEntries() {
  if (typeof cyberwareCatalog !== "function" || typeof cyberwareCodexInfo !== "function") return [];
  const kinds = typeof CYBERWARE_KINDS !== "undefined" ? Object.keys(CYBERWARE_KINDS) : [];
  return cyberwareCatalog().filter(d => !d.example).map(d => {
    const info = cyberwareCodexInfo(d);
    return {
      id: "cw:" + d.id, cwId: d.id, name: d.name, tier: d.tier, vol: d.vol, line: d.line, kind: d.kind, kindName: info.kindName,
      element: d.element || null, group: d.kind, groupName: info.kindName, short: info.short, tags: info.tags,
      effect: info.effect, use: info.use, rate: info.rate, rateSamples: info.rateSamples, grit: info.grit, clinic: info.clinic,
      price: d.price, removePrice: d.removePrice, hpCut: d.hpCut,
      lines: [].concat(info.effect, [info.use, info.rate], info.grit, info.clinic)
    };
  }).sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
}
/** 义体图鉴的分组标签：全部 + 每个种类一个 */
function codexCyberwareGroups() {
  return typeof CYBERWARE_KINDS === "undefined" ? [] : Object.keys(CYBERWARE_KINDS).map(k => ({ id: k, name: CYBERWARE_KINDS[k].name || k }));
}
