/* Antlerscale: Backfire · 技能 / 被动的完整说明（照作者给的角色卡原文）
 * 角色资料面板（showHeroSheet）和战斗里技能按钮的悬停说明都读这里。
 * 角色卡上没写、后来升级加的技能，按规则实际做的写。
 * 协助格挡的成功率不写死在文字里：由 blockChance 按「空手（敏捷）+ 武器加成」现算。
 *
 *   skillText(id, unit)  → 一个技能的完整说明（找不到返回 null，界面退回技能条上的短提示）
 *   kitInfo(kit)         → { passives: [{ name, text }], assistAttack, assistBlock, growth }
 *   skillCostText(id)    → "行动点" / "附赠动作" / "行动点 + 附赠动作" / "不消耗行动" */
(function (root) {
  "use strict";

  const KIT = {
    ruby: {
      passives: [
        { name: "纳米科技", text: "拥有纳米能源值，初始 40 点，最多 100 点。每次你造成的高能发生自爆，得到 40 点纳米能源。纳米能源不足时无法进入机甲模式。" },
        { name: "银翼", text: "明特在场时可以作为机甲，同区域下能够使本体进入机甲模式。机甲模式飞行，解锁并且只能使用银翼系列技能，银翼系列技能同时消耗两个单位的行动点。机甲模式下每回合结束消耗 20 点纳米能源。机甲模式的生命值为瑞比作为内层，明特生命值作为外层；架势值按照明特的架势计算，算作一个单位。被击落时结束机甲模式，且两个单位分别受到坠落伤害。" }
      ],
      assistAttack: "用武器发射一发高伤害能量激光，造成一次 1×atk+1d4 的能量伤害加上 2 次 0.25×atk 的能量伤害，获得 20 点纳米能源。机甲状态下不会收回武器，发射一枚高伤害能量炮，对目标造成一次 1.5×atk 的能量伤害，对同区域其他敌人造成 0.5×atk 的能量伤害，获得 20 点纳米能源。",
      assistBlock: "成功时获得 20 点纳米能源。"
    },
    mint: {
      weapon: true,
      passives: [],
      growth: "每级提高 4 装甲；每偶数级提高 1 耐久；每五级提高 1 架势值。",
      assistBlock: "成功时获得 20 点纳米能源。"
    },
    yuito: {
      passives: [
        { name: "研磨机", text: "可以制造「咖啡」来攻击或辅助。需要把咖啡豆转化成「咖啡液」使用，初始拥有一颗咖啡豆。" },
        { name: "思念", text: "可以对队友施加牵挂，一次只能有一名队友处于牵挂状态。牵挂状态的友方受到的来自结人的治疗骰取最高值，并且即将被击破架势条时，结人代为承担该次击破。" }
      ],
      assistAttack: "对目标造成 1×atk 的冰冻伤害，并且获得 1 颗咖啡豆。",
      assistBlock: "成功时将一个咖啡豆转化为一个咖啡液。无论成功与否，对保护对象施加牵挂。"
    },
    latte: {
      weapon: true,
      passives: [],
      growth: "每级提高 4 装甲；每偶数级提高 1 耐久；每五级提高 1 架势值。",
      assistBlock: "用身体挡下攻击。"
    },
    hiaki: {
      passives: [
        { name: "佩刀", text: "有两把刀，使用不同的刀造成的攻击属性和击破各不同：大太刀【丹生谷】（火）和打刀【鳴門】（冰）。初始默认使用【丹生谷】。使用武器生物化可以单独分出其中一把，并还能使用另一把。使用【鳴門】造成的击破加一。两把刀的武器人共享行动点和附赠动作。" },
        { name: "剑术", text: "技能有不同的派生，来自于不同刀势：拔刀、居合、胁构，初始为拔刀。" }
      ],
      assistAttack: "选择一把刀，冲向敌人并且造成 1.5×atk 的对应属性伤害，进入拔刀。",
      assistBlock: "成功后进入居合。居合下协助格挡必定成功并且进入胁构。胁构下协助格挡成功时反伤 1 点击破并进入拔刀。"
    },
    niu: {
      weapon: true,
      passives: [{ name: "火属性", text: "大太刀【丹生谷】，攻击带火焰。" }],
      growth: "每级提高 4 装甲；每偶数级提高 1 耐久；每五级提高 1 架势值。",
      assistBlock: "成功后变回武器。"
    },
    naruto: {
      weapon: true,
      passives: [{ name: "冰属性", text: "打刀【鳴門】，攻击带冰冻。" }],
      growth: "每级提高 4 装甲；每偶数级提高 1 耐久；每五级提高 1 架势值。",
      assistBlock: "成功后变回武器。"
    },
    tou: {
      passives: [
        { name: "决一死战", text: "如果你所在的区域只有一名敌人，这个敌人必须攻击你，且这个敌人的伤害掷骰取最低值。" },
        { name: "圣盾荣耀", text: "拥有圣盾点，每回合开始时获得 1 点，最多 3 点。拥有圣盾点时，受到伤害会减少 1 圣盾点并且使这一次伤害减半。空手无法使用圣盾点。对年糕也生效。" }
      ],
      assistAttack: "移动至目标位置，对目标造成 1×atk 的物理伤害，获得 1 圣盾点。",
      assistBlock: "如果失败可以仅一次消耗 1 圣盾点重掷。成功时移动至发动攻击的敌方单位所在区域。"
    },
    mochi: {
      weapon: true,
      passives: [],
      growth: "每级提高 5 装甲；每偶数级提高 1 耐久；每五级提高 1 架势值。",
      assistBlock: "成功时会冲去咬住敌人，使其失去移动能力 1 回合。"
    },
    xia: {
      passives: [
        { name: "启动引擎", text: "引擎发动后的部分技能发生变化。一回合没有进行攻击后解除。" },
        { name: "背水一战", text: "濒死后继续战斗时总是启动引擎，同时不会失去架势值。" }
      ],
      assistAttack: "启动引擎，武器喷火，迅速移动到与失衡敌人相同的区域，使用武器底部的刺穿刺敌人身体（穿刺），造成 1d8+atk 的火焰伤害。",
      assistBlock: "格挡成功时对攻击者造成 1 点击破。启动引擎时格挡成功率 +10%，格挡成功还会对敌人造成 atk/2 的火焰伤害。"
    },
    berniel: {
      weapon: true,
      passives: [],
      growth: "每次升级装甲提升 6；每偶数等级提升 1 耐久；每五级提高 1 架势值。",
      assistBlock: "用脚下的刺尝试挡住敌人攻击。夕夏引擎启动时，成功则对攻击发起者造成 1×atk 的物理伤害。"
    },
    chuan: {
      passives: [
        { name: "发电站", text: "使用技能可以积攒电能，以发动强力技能。" },
        { name: "磁场护盾", text: "自身或施加的护盾被破坏时，立刻将同区域所有敌人推至另一个区域，同时造成 1 击破。" }
      ],
      assistAttack: "武器变形为双刀，移动到同一区域并且冲过去挥舞充能的双刀，造成两次 atk/2+1d4 的电击伤害，积攒 2 电能。若有至少 3 电能，则最后补上一击重斩，造成 1×atk+1d10 的电击伤害；重斩消耗 2 电能。",
      assistBlock: "武器变形为盾牌格挡，格挡成功时攻击者受到 2 击破，积攒 1 电能。"
    },
    bili: {
      weapon: true,
      passives: [],
      growth: "每次升级护盾提升 4；每偶数等级提升 1 耐久；每五级提高 1 架势值。",
      assistBlock: "用磁力反弹敌人的攻击。如果成功则反伤此次伤害的 50%，并且不失去架势。"
    },
    nora: {
      passives: [
        { name: "冷气注射", text: "对已有冻伤的单位使用附加冻伤的技能时，不造成冻伤，而是造成额外一次 1d4+等级 的冰属性伤害。把针尖发射出去留在单位身上会造成特殊的「刺入」效果，对部分技能有影响；与单位距离超过 1 时刺入自动结束。一次只能刺入一个对象，造成新的刺入时会自动解除上一个。" },
        { name: "双相冲动", text: "武器系统不稳定，表现出温和和残忍两种状态，部分技能在不同状态下表现不一。每个回合开始时都有 1/3 的概率变为另一个状态。以随机一种状态进入战斗。击杀单位后改变一次状态。" }
      ],
      assistAttack: "距离 1，如果与目标同区则先移动至其他区域再发动攻击：发射出针尖，对敌人造成 1×atk 的冰冻伤害和 1 冻伤，施加刺入。",
      assistBlock: "成功时对攻击发起者造成刺入。"
    },
    vitas: {
      weapon: true,
      passives: [],
      growth: "生命为装甲（内层）+ 护盾（外层）。每级提升 1 装甲、4 护盾；每偶数等级提升 1 耐久；每五级提高 1 架势值。",
      assistBlock: "成功时切换当前双相状态。"
    },
    kolt: {
      passives: [
        { name: "更换刀头", text: "通过更改刀头，可以改变攻击 / 格挡 / 协助攻击的性质。电钻伤害类型为电，酸液炮伤害类型为酸。更换后即刻对一名同区域内的敌人造成 0.5×atk 的对应属性伤害（不管换成哪种刀头都打近距离）。进入战斗的时候可以自行决定初始刀头。" },
        { name: "过度自信", text: "想要表现自己：柯尔特或扭矩使用单体攻击指向的敌人单位会受到嘲讽并尝试攻击柯尔特。柯尔特生命值大于等于血量上限时受到的伤害减少 25%。" }
      ],
      assistAttack: "移动至敌人的区域，对敌人造成 1×atk 的刀头对应属性伤害，立刻可以进行一次更换刀头。",
      assistBlock: "成功时对敌人造成 1 点击破，然后可以进行一次更换刀头。"
    },
    torque: {
      weapon: true,
      passives: [{ name: "犬形态", text: "柯尔特的武器生物化为犬形态，攻击按当前刀头发动。" }],
      growth: "每级提高 6 装甲。",
      assistBlock: "成功率 60%。挡下攻击。"
    },
    helu: {
      passives: [
        { name: "聚焦", text: "通过分析可以了解敌人的固有频率，从而发现可能的结构弱点。受到聚焦影响的敌人血量层因为结构弱点被发现，按照特定步骤攻击可以抹去对应血量层，并造成 2 击破。步骤数：普通敌人 1、精英 2、首领 3。使用符合天气（当前天气下增伤）的属性攻击受聚焦的敌人时，总是推进 1 步。" },
        { name: "环境监测", text: "通过超声波可以捕捉到附近环境的地质结构、特殊构造乃至状态。环境的信息对你可见；通过捕捉物体运动信息，你可以预测受到聚焦影响的敌人的下一步行动。" }
      ],
      assistAttack: "任意距离，对敌人造成 1×atk 的谐波伤害。对其中一种血量层造成聚焦；如果敌人已有聚焦，直接推进序列一次。并且对该敌人所在的区域进行环境扫描。",
      assistBlock: "成功后借助这一次攻击的机会分析敌人，对此敌人其中一种血量层造成聚焦。"
    },
    ecmo: {
      weapon: true,
      passives: [{ name: "飞行", text: "蝙蝠形态的武器生物，飞行单位。" }],
      assistBlock: "用剧烈的音波尝试偏转敌人攻击。成功时自身不扣除架势值。"
    },
    ras: {
      passives: [
        { name: "能量流向", text: "每次场上发生任何高能值导致的爆炸后，你都会回收等于该高能值的等量光能。光能可以用于释放你的技能。" },
        { name: "事故幸存", text: "那场爆炸改变了你的身体，体内不断在累积能量，需要通过手电筒上的装置把能量引流成光能来防止自爆。回合开始时累积 20%，技能也会累积；超过 100% 时进入不稳定状态，届时受到任何伤害都会致死。不稳态下所有攻击的攻击次数翻倍。累积能量转光能 = 累积能量百分比 × 血量上限。" }
      ],
      assistAttack: "强光点射，对敌人造成 2 次 0.5×atk 的能量伤害。如果有光能，则额外追加一次把光能全部一比一打出的能量伤害。",
      assistBlock: "无论成功与否都累积 20% 能量。"
    },
    edc: {
      weapon: true,
      passives: [],
      growth: "每级提升 4 装甲；每五级提升 1 耐久。",
      assistBlock: "用强光干扰敌人的攻击。"
    }
  };

  const SKILL = {
    /* 瑞比 / 明特 */
    ruby_aa: "对一个距离 1 的敌人造成两次 0.5×atk 的能量伤害，总计造成 1 击破。",
    ruby_trigger: "对一个距离 1 以内的敌人施加高能。",
    ruby_summon: "武器生物化：唤出明特（M1NT-C4D）作为独立单位。收回时需要和瑞比同区域。",
    ruby_surge: "对一个距离 1 的敌人造成 1×atk 的电击伤害和 1 击破。打到护盾时获得 10 点纳米能源。",
    ruby_short: "对一个距离 1 以内的敌人施加感电。",
    wing_aa: "银翼 · 普通攻击：对一个距离 1 以内的敌人造成 1 次 1×atk+1d4 的能量伤害以及 1 击破，对同区域其他敌人造成 0.3×atk 的能量伤害。（同时消耗瑞比和明特的行动点）",
    wing_steal: "银翼 · 电力夺取：使用电线攻击同区域的每个敌人，各造成 0.5×atk 的电击伤害。每对一个敌人造成伤害，获得 10 点纳米能源。（同时消耗两个单位的行动点）",
    wing_surge: "银翼 · 电流激荡：对一个距离 1–2 的敌人造成 1×atk 的电击伤害和 1 击破。打到护盾时获得 20 点纳米能源。",
    ruby_unmecha: "立刻解除机甲模式，分开瑞比与明特。",
    mint_mecha: "不消耗行动点。需要和瑞比同区域。变为机甲，进入机甲模式。每回合结束时消耗 20 点纳米能源，可以随时解除。",
    mint_steal: "使用电线攻击一个距离 1 以内的敌人，造成 1×atk 的电击伤害，获得 20 点纳米能源。",
    mint_banish: "对同区域一个敌人造成两次 0.5×atk 的电击伤害，共 1 击破，并把它推开 1 格。",
    mint_return: "变回武器回到瑞比手里。需要和瑞比同区域。",
    /* 结人 / 拿铁 */
    yuito_aa: "对一个距离 1 的敌人造成 1×atk 的冰冻伤害和 1 击破，将一个咖啡豆转化为咖啡液。",
    yuito_amer: "冰美式：使用一个咖啡液。使一个距离 1 以内的同伴恢复 2d4 生命和 1 架势（每五级提高骰子）；或者对距离 1 的一个区域内所有敌人造成 0.75×atk 的冰冻伤害和 1 击破。",
    yuito_espresso: "意式浓缩：使用一个咖啡液。使一名友方行动点 +1；或者对一个敌人造成 1×atk 的酸液伤害和 2 击破。",
    yuito_extract: "酸萃：使用一个咖啡液。使一个区域变为酸液地面；区域内友方恢复生命（骰数随等级增加），敌人受到同样骰数的酸液伤害。",
    yuito_summon: "武器生物化：唤出拿铁作为独立单位。",
    latte_puff: "「毛球」攻击：对一个距离 1 的敌人造成 1×atk 的酸液伤害和 1 击破，将一个咖啡豆转化为咖啡液。",
    latte_ice: "制冰机：使天气变为雪天。",
    latte_love: "爱意：移动到一名友方的区域，为其恢复 2d4 生命和 1 架势，并对其施加牵挂。",
    latte_return: "变回武器回到结人手里。需要和结人同区域。",
    /* 绯秋 / 丹生谷 / 鳴門 */
    hiaki_aa: "按刀势发动：拔刀状态下对一个同区域的敌人挥出一刀，造成 1×atk 的对应属性伤害和 1 击破；居合下先移动 1 距离，然后对一个同区域的敌人挥出一刀，造成 1.5×atk 的对应属性伤害；胁构状态下对一个同区域的敌人刺一刀，造成 1×atk 的对应属性伤害和 2 击破。",
    hiaki_sheath: "收刀：选择一把刀使用，进入居合状态。",
    hiaki_summon: "武器生物化：分出当前手里的刀作为独立单位，另一把仍可持用。",
    hiaki_flash: "一闪：仅居合可用。对同区域所有敌人造成 1×atk 的对应属性伤害和 1 击破，然后进入拔刀。",
    hiaki_pot: "热锅：仅持【丹生谷】时可用。对同区域施加熔融。",
    niu_slash: "斩炎：对一个同区域敌人造成 1×atk 的火焰伤害和 1 击破，施加灼烧，变回武器。",
    niu_tsubame: "燕返：对一个距离 1 的敌人造成 1×atk 的火焰伤害和 1 击破，然后收回并换持【丹生谷】，【鳴門】出场。",
    niu_return: "变回武器回到绯秋手里。需要和绯秋同区域。",
    naruto_wind: "寒风：对一个距离 1 的敌人造成 1×atk 的冰冻伤害和 1 击破，施加冻伤，变回武器。",
    naruto_fly: "燕飞：对一个同区域敌人造成 0.5×atk 的冰冻伤害和 1 击破，然后移动 1 格。",
    naruto_return: "变回武器回到绯秋手里。需要和绯秋同区域。",
    /* 灯 / 年糕 */
    tou_aa: "挥出钢剑，对同区域的一个敌人造成 1×atk 的物理伤害和 1 击破。通过消耗圣盾点可以把射程变为距离 1。",
    tou_start: "圣战起始：移动 1 以内的距离，对一个同区域敌人施加错位。通过消耗圣盾点可以让另一个同区域单位一起移动。",
    tou_sonic: "声波切割：消耗 1 圣盾点。对同区域一个目标造成 1×atk 的谐波伤害、对距离 1 的一个目标造成 0.5×atk 的谐波伤害，可以只选其一。",
    tou_ultra: "超音波：对同区域施加折射。",
    tou_summon: "武器生物化：唤出年糕作为独立单位。",
    mochi_pounce: "猛扑：跃向一个距离 1 的敌人，或是把同区域的一个敌人带走，并且造成 1×atk+1d4 的物理伤害和 1 击破。",
    mochi_roar: "吼叫：对一个同区域的敌人造成 1×atk+1d4 的谐波伤害以及 1 击破，然后迫使其移动至其他区域。",
    mochi_boom: "音爆：对同区域每个敌人造成 0.5×atk 的谐波伤害和 1 击破。可以再消耗一次圣盾点重复一次。",
    mochi_return: "变回武器回到灯手里。需要和灯同区域。",
    /* 夕夏 / 柏妮尔 */
    xia_aa: "近距离，对单个敌人造成 1d4+atk 的物理伤害和 2 点击破。引擎发动时变为火焰伤害，并且总共造成 3 点击破。",
    xia_engine: "拉响引擎：发动引擎。",
    xia_execute: "处决：只能对晕眩中的敌人使用，需要引擎处于启动状态。将武器底部的刺刺入敌人身体，再加足马力撕扯开（穿刺），造成 1d8+1.5×atk 的火焰伤害。",
    xia_ram: "全速撞击：需要引擎处于启动状态。使武器喷出火焰，移动至多 2 距离，对移动结束所在区域的一个敌人造成 1×atk 的物理伤害、1 击破以及震荡。此外，每移动 1 距离额外造成 1 击破。",
    xia_selfburn: "引火烧身：需要引擎处于启动状态。进入自焚状态，可选立刻移动 1 距离。",
    xia_crush: "狂怒碾压：需要引擎处于启动状态。对同区域敌人造成 1.5×atk 的物理伤害和 3 点击破。如果敌人没有死亡或失衡，夕夏会抓在敌人身上：无法主动移动且总是和该敌人保持同区域，无法协助攻击和协助格挡，无法获得行动点和附赠动作，每回合开始自动再次对同一敌人使用此技能，直到敌人死亡。自动使用时杀死该敌人后返还 1 行动点和 1 附赠动作。",
    xia_summon: "武器生物化：唤出柏妮尔作为独立单位。",
    berniel_spit: "喷火：对近距离的所有敌人喷出火焰，造成 atk/2 的范围伤害。引擎发动时对每个敌人造成 1 击破。",
    berniel_ignite: "燃点：对距离 1 以内的一个敌人造成灼烧。引擎启动的状态下造成 2 层灼烧。",
    berniel_dash: "点火突进：喷火并飞行移动到另一个区域，可以带着同一个区域的另一个角色或敌人一起移动，并启动引擎。引擎已发动时还会对原先区域的任意一个敌人造成 1×atk 的伤害。",
    berniel_flare: "焰袭：需要引擎处于启动状态，并且与夕夏处于不同区域。喷出火焰加速，在空中旋转着变身为武器，夕夏接住顺势发动强力的挥击：对单个近距离敌人造成夕夏持武器 atk×1.5+1d6 的火焰伤害和 2 击破。此技能强制变回武器。",
    berniel_return: "变回武器回到夕夏手里。需要和夕夏同区域。",
    /* 川川 / 哔哩哩&滋啦啦 */
    chuan_aa: "挥舞双刃对近距离的单个敌人造成两次 atk/2+1d4 的电击伤害，总计 1 击破。如果自身有电能，此技能消耗 1 电能，伤害变为三次，击破提升为总计 2 点。",
    chuan_whip: "电击鞭：将美工刀充电，延长并且像鞭子一样抽击距离 1 以内的敌人，造成 atk/2 的能量伤害和 1 击破，积攒 1 电能。若有电能，在抽击命中敌人时可以选择消耗 1 电能，将自己拉至敌人同区域。",
    chuan_wall: "铁壁：消耗 1 电能。将武器变形为大圆盾，为同区域的所有我方角色在一回合内阻挡敌人的攻击。盾牌拥有 atk+1d6 点装甲；盾牌被击破后自身受到 3 击破。回合结束时盾牌未被击破则积攒 2 电能。铁壁也受过载和雷鸣的反伤增益。拥有至少 3 电能时，可以选择额外消耗 1 电能，为铁壁的生命值外层增加 atk 点护盾。",
    chuan_over: "电站超频：让便携式发电站背包超频，对一个任意单位（可以是自己）施加过载，获得 1 电能。如果已有至少 3 电能，不获得电能，而是使目标额外获得 atk/2 点护盾。",
    chuan_pulse: "高能脉冲：对自身施加蓄能状态效果（每回合开始高能 +等级；能量、谐波、电伤害按高能值占血量上限的比例提高）。",
    chuan_blade: "巨刃划空：1 距离以内。消耗 3 点电能。把两把美工刀合并为超长巨刃全力挥向敌人并撕裂防护盾，造成 2×atk 的电击伤害和 2 击破，对配置物伤害翻倍。击穿敌人血量层或摧毁配置物时返还 1 电能。",
    chuan_summon: "武器生物化：唤出哔哩哩&滋啦啦作为独立单位。",
    bili_beam: "电光束：对一个任意距离的敌人造成 1×atk 的电击伤害，施加感电。",
    bili_magnet: "磁力移动：将一个目标由远距离吸到近距离，或是由近距离推向远距离，造成 1 击破。",
    bili_field: "磁场盾：消耗川川 1 电能张开磁力盾牌，为同区域的所有友方角色施加 atk+1d4 点护盾。额外消耗 1 点电能，使护盾量再增加等于川川等级的护盾。",
    bili_storm: "雷电风暴：消耗所有电能，对一个目标造成「电能×2」次 0.4×atk 的电击伤害，每消耗 2 电能造成 1 击破。如果目标有感电，则获得 2 点电能。",
    bili_return: "变回武器回到川川手里。需要和川川同区域。",
    /* 诺拉 / 维塔斯 */
    nora_aa: "对一个距离 1 的敌人造成 1×atk 的冰冻伤害以及 1 击破。如果有刺入的单位，则只能选择刺入的目标：温和状态下对目标造成 1d6+等级 的治疗，残忍状态下对目标造成 1×atk+1d4 的冰冻伤害、冻伤以及 1 击破。",
    nora_needle: "发射针尖：对一个距离 1 以内的单位发射出针尖，造成刺入。温和状态下使自身移动至目标同区域，残忍状态下造成 1 冻伤。",
    nora_summon: "武器生物化：唤出维塔斯作为独立单位。",
    nora_soothe: "安抚：消耗附赠动作。安抚维塔斯，状态转换为温和。空手情况下需要和维塔斯同区域。",
    nora_indwell: "留置针：对刺入的单位造成刺骨即时效果和 1 冻伤。",
    nora_pressure: "压力升高：下回合开始必定切换为残忍状态，下一击具有衍射。",
    nora_sonic: "声波震击：对同区域的所有敌人造成 0.5×atk 的谐波伤害以及 1 击破。如果场上存在刺入单位，则额外对刺入单位造成 0.5×atk 的谐波伤害以及 1 击破。",
    vitas_infuse: "加压灌输：对刺入的目标生效。温和下造成 2d4+2 治疗且恢复 1 架势；残忍下造成 1×atk 的冰冻伤害、1 击破和两次 1 冻伤。每五级治疗提升 1d4。",
    vitas_rip: "扯下：对刺入的目标生效。直接扯下针尖，特殊频率震动的针尖对目标造成 1.5×atk 的谐波伤害和 2 击破，结束刺入效果。",
    vitas_slash: "针尖剑斩：对一个同区域敌人造成 1×atk 的谐波伤害和 1 击破。如果有刺入单位，则只能对刺入单位使用，且会先移动至同区域再发动攻击。",
    vitas_dance: "寒气剑舞：只能在场上没有刺入单位的情况下使用。对敌人造成 3 次 0.2×atk 的冰冻伤害，总计 1 击破。温和状态下额外为同区域所有友方恢复 0.5×atk 生命；残忍状态下每一击造成 1 冻伤。",
    vitas_return: "变回武器回到诺拉手里。需要和诺拉同区域。",
    /* 柯尔特 / 扭矩 */
    kolt_aa: "按照刀头模式发动。电钻：对同区域一个敌人造成 3 次 0.4×atk 的电击伤害，共 2 击破。酸液炮：对距离 1 的一个敌人造成 1×atk 的酸液伤害以及 1 击破。",
    kolt_short: "直流短接：需要在电钻模式。先可以移动至多 1 距离，然后对同区域施加高压场地。",
    kolt_chase: "紧追：消耗附赠动作，对一个敌人施加紧追。之后它每次移动（自己走或被推开），柯尔特都会自动跟到它所在的区域，不耗行动（间隔挡住则跟不上）。",
    kolt_scrap: "废物利用：捡起地上的东西武装自己。获得上一个被摧毁的敌人血量层等量的对应血量，最多为柯尔特生命上限的 50%：肉体或星灵则恢复生命；装甲 / 护盾 / 沙尘则额外获得对应血量层（战斗结束后消失）。腐坏抛射记下的腐蚀伤害也在这一次一起领取（不受 50% 限制）。",
    kolt_rot: "腐坏抛射：需要在酸液炮模式。对一个距离 1 的敌人发射酸液攻击，造成腐蚀（不造成伤害，但仍会触发「过度自信」的嘲讽）。这份腐蚀每次造成伤害时都会记录下对血量层造成的伤害，并在下一次使用「废物利用」时为柯尔特获得对应生命值。",
    kolt_mod: "「非法」改装：需要在电钻模式。对一个 1 距离以内的任意单位施加过载。",
    kolt_summon: "武器生物化：唤出扭矩（犬形态）作为独立单位。",
    torque_boost: "强化输出：按照刀头模式发动。电钻模式下会突进，移动 1 距离然后对该区域的一名敌人（自选）造成 1d4+1 次 0.5×atk 的电击伤害，共 2 击破。酸液炮模式下进入蓄力，可以选择任意一个区域（不限距离），下回合开始自动对选定的区域发动范围攻击，造成 1×atk 的酸液伤害，对每个敌人造成 1 击破，并施加「下一击必须攻击柯尔特」的嘲讽。",
    torque_swap: "拆装部件：更换刀头，然后对一个对应距离的敌人造成一次 1×atk 的对应伤害以及 1 点击破，立刻收回武器。",
    torque_strip: "拆卸模式：需要电钻模式。对一个同区域的敌人进行拆卸，造成 2 点击破，把等于扭矩 atk×1 的敌人外层血量转移到一名同区域友方单位身上。这次攻击如果造成了失衡，转移量提升至 1.5×atk。",
    torque_return: "变回武器回到柯尔特手里。需要和柯尔特同区域。",
    /* Helumica / Ecmo */
    helu_aa: "远距离，对一名敌人造成 1×atk 的谐波伤害和 1 击破。对有聚焦的敌人总是直接命中聚焦对应的血量层。",
    helu_wave: "驻波：用特定频率的波影响周遭环境，进入相位。如果分析过当前战场，进入相位后再次使用此技能可以向前推进一个阶段。",
    helu_storm: "大气干扰：用特定频率的波影响周遭环境，进入沙暴。如果分析过当前战场（用过环境扫描），进入沙暴后再次使用此技能可以调转沙暴风向。",
    helu_scan: "环境扫描：选择任意一个区域，从下面选一项。扫描出配置物：随机找到一个爆炸桶 / 酸液桶 / 超充能电池 / 碎渣机炮。配置物：爆炸桶、酸液桶直接引爆；超充能电池可以提取 5+2×等级 点护盾给任意一名友方，或者直接引爆；碎渣机炮被操控，攻击一名选定的敌人；防卫自律炮台立刻向 Helumica 的敌人开一炮；按钮 / 拉杆远程触发。地形：相邻的不稳桥梁或危墙耐久 −10。场地：火场、酸液地面、治愈场地立刻结算一次回合开始效果；冻土对区里所有地面单位造成 1 点冰属性击破；塌陷区域计数 +5；能量场立刻累积一次高能；干涉场让区里所有单位的下次伤害叠一层 +25% 或 −25%（自选）；损毁地面耐久 −20。高地、深渊、隔离区没有效果。",
    helu_summon: "武器生物化：唤出 Ecmo/7418（蝙蝠）作为独立单位。",
    ecmo_bite: "叮咬：对同区域的一名敌人造成 1×atk 的物理伤害和 1 击破。如果造成失衡则返还行动点。",
    ecmo_focus: "频谱分析：对一个任意敌人的任意血量层造成聚焦。",
    ecmo_boom: "音爆：在所在区域引发音爆，对所有同区域敌人造成 0.5×atk 的谐波伤害，触发所有同区域配置物。对聚焦的血量层造成两次而非一次伤害。",
    ecmo_return: "变回武器回到 Helumica 手里。需要和 Helumica 同区域。",
    /* 拉斯缪尔 / EDC30k */
    ras_aa: "发出激光，对一个远距离敌人造成 2 次 0.5×atk 的能量伤害，总计 1 击破，累积 20% 能量。",
    ras_dump: "泄能：对一个任意距离的敌人施加高能，并且把 20% 能量转化为光能（数值等于 20% 的血量上限）。",
    ras_flee: "逃离：武器缠绕雷电，逃离所在位置。移动 1 距离，累积 20% 能量，对原区域的一名敌人造成 1×atk 的电击伤害。不稳状态下移动距离不设限。使用此技能移动时不会触发借机攻击。",
    ras_super: "不稳超导：转换 20% 累积能量为光能，为自身施加导体效果。如果已经处于不稳态，该技能可以免费释放。",
    ras_rampage: "失控暴走：累积 40% 能量。如果因此进入不稳态，使同区域变为能量场；如果已经在不稳态，全场所有区域都会变成能量场！（固有场地、深渊、损毁地面不会被改变）",
    ras_summon: "武器生物化：唤出 EDC30k 作为独立单位。",
    edc_drain: "引流：需要和拉斯缪尔同区域。将拉斯缪尔的累积能量完全转为光能；如果拉斯缪尔已经进入不稳态，则转化率提高 25%。",
    edc_shock: "电流冲击：对一个距离 1 的敌人造成 1×atk 的电击伤害以及 1 击破。如果有光能，则额外造成等同于光能数值的一次电击伤害和 1 击破。",
    edc_flash: "爆闪：释放所有光能，对同区域的每个敌人造成「光能/2」的能量伤害和 1 击破。",
    edc_return: "变回武器回到拉斯缪尔手里。需要和拉斯缪尔同区域。",
    /* 通用 */
    bare_aa: "空手攻击：对同区域一个敌人造成 1×atk 的物理伤害。没有武器在手时只能发动空手攻击和空手格挡。",
    assist_block: "消耗附赠动作，为同区域被攻击的队友尝试格挡。",
    /* 职责技能（玩家手册第二步「职责」） */
    xia_prep: "准备：下回合伤害掷骰额外 +1d6（每 5 级提高骰子），对复数攻击只生效一次。可以空手使用。",
    role_refine: "精益求精：下一击带弱点特效。每场限一次（15 级后两次）。",
    role_pierce: "一击制敌：下一击带穿刺。每场限一次。",
    role_gambit: "破釜沉舟：下回合攻击双倍伤害，但直到你下一次行动前受到的伤害也翻倍。每场限一次。",
    role_activate: "激活：触发目标身上一种状态。DoT 结算一次；震荡造成 1 击破；高能造成等于高能值的能量伤害。",
    role_spread: "传播：复制一个单位身上的所有状态效果，施加到另一个单位。",
    role_double_dot: "加倍计量：使一个敌人身上所有状态此回合效果翻倍。每场限一次。",
    role_self_doom: "自我毁灭（开关）：持续整局。你施加状态的技能效率翻倍，但你自己也会受到一层。可再开一次关闭。",
    hiaki_allin: "全力以赴：你的下一击击破带有猛击效果。每场限一次（5 级两次，10 级三次）。",
    role_breakwave: "破势：对所有同区域、架势等于 1 的敌人造成 1 无属性击破（15 级改为架势 ≤ 2）。",
    role_halve: "折戟：对一个敌人造成其当前架势半值的击破（向下取整）。每场限一次。",
    role_omen: "击破预告：使一个敌人下回合受到双倍击破；若未能击破其架势，自己被击破。成功则返还使用次数。每场限一次。",
    tou_taunt: "嘲讽：使距离 1 以内的一个敌人下次攻击目标转为自己。每场两次（5 级三次；10 级起一回合内可多次使用；15 级四次）。可以空手使用。",
    role_lockdown: "禁足怒吼：同区域所有敌人此回合无法移动，且无法攻击坦克以外的目标。",
    role_grit: "咬牙坚持：此回合自身减伤率 +50%。每场两次。",
    role_stand: "屹立不倒：此回合不受任何来源的任何伤害和击破。每场一次。",
    role_cover: "掩护：选择一个队友，此回合内免费自动为其发动协助格挡，可以发动多次。",
    role_fear: "恐惧怒吼：对距离 1 以内所有敌人施加此回合虚弱。每场两次（15 级三次）。",
    role_guard_strike: "防守反击：此回合第一次成功协助格挡还会反击一次协助攻击。",
    role_all_reflect: "全反击：此回合全队成功的协助格挡，都把伤害与击破全额反给敌人。每场一次。",
    role_firstaid: "应急处理：为距离 1 以内一名友方恢复 1d4+2 生命，对半血以下友方总是取最大值。每 5 级骰子 +1d4+1。",
    role_buffer: "缓冲：为距离 1 以内一名友方施加 2d4+4 点护盾。每场一次（15 级两次）。",
    role_dome: "防护罩：在同区域释放血量为 atk+10 的护盾罩，对该区域我方的攻击先打罩，也完全挡住范围攻击。每场一次。",
    role_renew: "续命：使任意距离一名友方恢复最大生命的 50%；若已濒死，改为立刻起身并恢复 25%。每场一次。",
    role_lock: "锁定：锁定一种场上的天气或场地，使其此回合一定不会被修改。每场一次（5 级两次，10 级三次）。",
    role_shelter: "保释：使一名任意友方此回合豁免天气与场地。每场两次（15 级三次）。",
    role_harsh: "恶劣环境：使一名单位受到双倍场地或天气效果。每场一次。",
    role_apocalypse: "末日：整场战斗天气与场地效果翻倍，无法停止。每场一次。",
    role_pull: "拉拽：使一个目标从任意距离移动到此区域。",
    role_boost: "借力：使任意位置的其他友方移动任意距离。",
    role_shake: "撼动：使同区域所有敌人受到不稳。每场一次。",
    role_rearrange: "重整：重新安排距离 1 以内所有单位所在区域，每单位最多移动 1 距离；还可最多为两个单位添加或去除飞行（对首领无效）。每场一次。",
    yuito_inspire: "助威：使一个其他友方此回合获得振奋（10 级后可用行动点施加持续全局的振奋）。可以空手使用。",
    role_sturdy: "不倒战意：使一个同区域友方此回合获得坚挺（15 级后可用行动点让全部友方此回合获得坚挺）。",
    role_gold: "黄金时间：使一个单位身上一种即时效果延长一回合。每场两次。",
    role_rally: "全队集结：所有同区域队员得到符合其主职责的增益，持续到自己晕眩或濒死。直伤 +15 atk；异常 +1 附赠动作；击破造成击破 +1；坦克 +15% 全属性减伤率；护卫 +15% 格挡成功率；生存 +50% 治疗量与护盾施加量；环境手免费锁定天气；控场可以免费任意移动友方单位。一次长休限一次。"
  };

  function kitInfo(kit) { return KIT[kit] || null; }
  function skillText(id) {
    if (!id) return null;
    if (SKILL[id]) return SKILL[id];
    return null;
  }
  function skillCostText(id) {
    const c = typeof skillCost === "function" ? skillCost(id) : null;
    if (!c) return "";
    const parts = [];
    if (c.ap) parts.push(c.ap > 1 ? `${c.ap} 行动点` : "行动点");
    if (c.bonus) parts.push("附赠动作");
    return parts.length ? parts.join(" + ") : "不消耗行动";
  }

  const ROLE_NAME = { primary: "主职责", secondary: "副职责" };
  const layerName = (t) => (typeof LAYER_NAMES !== "undefined" && LAYER_NAMES[t]) || ({ flesh: "肉体", armor: "装甲", shield: "护盾", sand: "沙尘", spirit: "星灵" })[t] || t;
  function layersOf(u) {
    return (u.layers || []).map(l => ({
      type: l.type, name: layerName(l.type),
      cur: l.current != null ? Math.max(0, Number(l.current) || 0) : (Number(l.hp) || 0),
      max: l.max != null ? Number(l.max) || 0 : (Number(l.hp) || 0)
    }));
  }
  function skillRows(u) {
    let list = [];
    try { list = skillList(u) || []; } catch (e) { list = []; }
    const seen = {};
    const rows = list.filter(s => s && s.id && !seen[s.id] && (seen[s.id] = true)).map(s => ({
      id: s.id, name: s.name, cost: skillCostText(s.id), hint: s.hint || "", text: skillText(s.id) || s.hint || ""
    }));
    // 还没到等级的技能：用高等级的副本列出来，标上解锁等级（只列角色自己的技能，职责技能按升级选择）
    const later = [];
    try {
      const probe = Object.assign({}, u, { level: 99, roles: null, role2: null, resources: Object.assign({}, u.resources || {}) });
      (skillList(probe) || []).forEach(s => {
        if (!s || !s.id || seen[s.id] || !s.minLv || s.minLv <= (u.level || 1)) return;
        seen[s.id] = true;
        later.push({ id: s.id, name: s.name, minLv: s.minLv, cost: skillCostText(s.id), hint: s.hint || "", text: skillText(s.id) || s.hint || "" });
      });
    } catch (e) { /* 预览失败就不列 */ }
    later.sort((a, b) => a.minLv - b.minLv);
    return { now: rows, later };
  }
  /** 武器人（不管在不在场）的资料 */
  function weaponSheet(owner, kit, units) {
    let w = units.find(x => x.kit === kit && !x.fused && !x._removed);
    const out = !!(w && !w.hidden);
    if (!w || w.hidden) {
      // 不在场：只读地按卡片 + 武器等级算一份（不碰战场单位，也不消耗随机数）
      const card = typeof livePartyCards === "function" ? livePartyCards().find(c => c.kit === kit) : null;
      if (!card) return null;
      const lv = (owner.weaponLevels && owner.weaponLevels[kit]) || card.level || 1;
      const g = (typeof WEAPON_GROWTH !== "undefined" && WEAPON_GROWTH[kit]) || null;
      w = JSON.parse(JSON.stringify(card));
      w.level = lv;
      w.layers = (card.layers || []).map(l => {
        let hp = Number(l.hp) || 0;
        if (g && l.type === g.layer) hp = g.baseHp + g.hp * (lv - 1);
        const ex = g && (g.extra || []).find(e => e.layer === l.type);
        if (ex) hp = ex.baseHp + ex.hp * (lv - 1);
        return { type: l.type, current: hp, max: hp };
      });
      if (g) { w.defMax = w.def = g.baseDef + Math.floor(lv / 5); }
      try { if (typeof computeWeaponAtk === "function") w.atk = computeWeaponAtk(kit, owner.attrs, lv); } catch (e) { /* 用卡片值 */ }
      w.weaponOf = w.weaponOf || owner.kit;
      w.hidden = false;
    }
    let dur = null;
    try { if (typeof weaponDur === "function") dur = weaponDur(kit); } catch (e) { dur = null; }
    const info = kitInfo(kit) || {};
    return {
      kit, name: w.name, level: w.level || 1, out,
      atk: Number(w.atk) || 0, def: w.defMax != null ? w.defMax : w.def,
      layers: layersOf(w), durability: dur,
      blockBonus: (typeof WEAPON_BLOCK_BONUS !== "undefined" && WEAPON_BLOCK_BONUS[kit]) || 0,
      blockAlone: typeof blockChance === "function" ? blockChance(w) : null,
      passives: info.passives || [], assistBlock: info.assistBlock || "", growth: info.growth || "",
      skills: skillRows(w)
    };
  }
  /** 一名角色的完整资料（读当前战场 state.units 里的单位） */
  function heroSheet(u, units) {
    units = units || (typeof state !== "undefined" ? state.units : []) || [];
    const info = kitInfo(u.kit) || {};
    const prof = typeof heroProfile === "function" ? heroProfile(u.kit) : null;
    const rest = typeof heroRestCost === "function" ? heroRestCost(u) : null;
    let atk = Number(u.atk) || 0;
    try { if (typeof effectiveAtk === "function") atk = effectiveAtk(u, units); } catch (e) { /* 用面板值 */ }
    const roles = u.roles || {};
    return {
      kit: u.kit, name: u.name, enName: u.enName || "", level: u.level || 1, xp: u.xp || 0,
      xpNext: typeof xpToNext === "function" ? xpToNext(u.level || 1) : null,
      race: prof ? prof.race : "", job: prof ? prof.job : "", note: u.note || "",
      roles: Object.keys(ROLE_NAME).filter(k => roles[k]).map(k => ({ label: ROLE_NAME[k], role: roles[k] })),
      attrs: Object.assign({}, u.attrs || {}), attrPoints: u.attrPoints || 0,
      atk, personalAtk: Number(u.personalAtk) || 0, weaponAtk: Number(u.weaponAtk) || 0,
      def: u.def, defMax: u.defMax != null ? u.defMax : u.def,
      layers: layersOf(u), shp: u.shp, shpMax: u.shpMax, cyber: u.cyber,
      block: typeof blockBreakdown === "function" ? blockBreakdown(u) : null,
      unarmed: typeof isUnarmed === "function" ? isUnarmed(u) : false,
      rest, status: typeof resourceText === "function" ? resourceText(u) : "",
      passives: info.passives || [], assistAttack: info.assistAttack || "", assistBlock: info.assistBlock || "",
      skills: skillRows(u),
      weapons: (u.linkedKits || []).map(k => weaponSheet(u, k, units)).filter(Boolean)
    };
  }
  /** 当前队伍所有角色的资料 */
  function sheetData() {
    const units = (typeof state !== "undefined" && state.units) || [];
    const heroes = typeof partyHeroes === "function" ? partyHeroes() : units.filter(u => u.isPlayer && u.attrs);
    return heroes.filter(u => u.attrs).map(u => heroSheet(u, units));
  }

  root.SkillText = { KIT, SKILL, kitInfo, skillText, skillCostText, heroSheet, sheetData };
})(typeof window !== "undefined" ? window : globalThis);
