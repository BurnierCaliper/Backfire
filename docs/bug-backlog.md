# Bug 待修清单（第二轮查 bug，main `cef510b`，2026-10-16）

来源：协助者的全面排查报告（五个方向：专长、单局 / 每日挑战、工坊 / 长休、敌人 / 地形、战斗规则 / 评分 / 联机），去重后高 15 · 中 44 · 低 52，另有一批「需要作者确认」。
复现脚本和每个方向的完整说明在报告目录的 `feats/`、`rogue/`、`workshop/`、`enemies/`、`combat/`（各自的 `findings.md`）。

2026-10-17 跑团开场前先修了 H3、H11、H13、H14 和联机的四条「中」，接着修了会改坏跑团存档的 H1、H15（见下面打勾的），其余记在这里以后修。
修掉一条就把它打勾，写上提交 / PR，并在 README「规则改动记录」里记一笔。

## 已修

- [x] **H9** （回归 63b90d7）首领没攒满标记「立刻恢复」后，飞碟触灵本体的协助攻击打不到它 —— 立刻恢复时开 `_bossAssistWindow`，`dealTo` 的本体判断认「失衡或协助窗口」，协助结算完关上（app.js · `bossQuickRecover` / `dealTo` / `finishAssist`；tests/boss-quick-recover.test.js）
- [x] **H10** （回归 63b90d7）首领 / 10 级以上精英打出第 1 个标记时，「打进失衡时」的效果全不触发 —— 立刻恢复时记 `_brokeNow`，过载爆炸 / 失衡分 / 冲阵·乘势·荒原行者 / 猫爪挥打 / 霜取 / 拆卸 / 叮咬统一读 `brokeInto()`（app.js · `brokeInto` / `dealTo` / `dealBreak`；tests/boss-quick-recover.test.js）
- [x] **H2** 单局「休整」补给不够又没钱就卡死 —— 营地画面补给不够时，「开始长休」换成可点的「硬撑着过夜」并写明后果，点了走 `camp()` 原有的硬撑流程；跑团主持人安排（`opt.force`）的营地不变；联机投票的「休整」选项本来就能硬撑（rest-report.js · `campHtml`；tests/h2-camp-forced.test.js）
- [x] **H7** 蚁型戒备兵种大酸液弹的主目标那一下常被射程判定吞掉 —— `antFireShell` 主目标那一下加 `flags.anyRange`，按标定落点打（tests/h7-ant-shell.test.js）
- [x] **H12** 高能自爆、深渊 / 空隙坠落、流沙窒息弄死的敌人不走击杀结算 —— `applyKnockdown` 里敌人倒地时补调 `settleEnemyKill`（`_xpGiven` 保证只结算一次），经验、奎支、击杀数、亡命之王「手下被打倒」都正常（app.js · `applyKnockdown`；tests/env-kill-settle.test.js）
- [x] **H5** 流沙没顶（下陷 3 层）挡不住出手，还不扣行动点 —— `runSkill` 在 `snapshot()` 之前用 `costBlockReason` 挡住付不起消耗的行动；`baseBlockReason` / 联机 `baseReason` 提前灰掉按钮（tests/quicksand-lock.test.js）
- [x] **H8** 跑团模板「我方同阵营」的友军在敌人回合从不行动 —— ai.js 新增 `actors()`（敌人 + 友军，中立生物仍不行动），`actingOrder()` 改用它；`foes()` 不变（胜负判定、剩余敌人数照旧不含友军）；友军打死的敌人没有经验 / 掉落 / 击杀分（app.js · `settleEnemyKill`；tests/ally-acts.test.js）
- [x] **H4** 专长「拉一把」永远用不了（医疗包没有 `heal` 字段）—— `ITEM_CATALOG` 的医疗包补上结构化治疗骰 `heal: { n, s, flat }`，用道具 / 休整用道具 / 拉一把都读这一处（`itemHealSpec` / `rollItemHeal`）；拉一把只认有 `heal` 的友方道具，强心注射剂不算（items.js、ledger.js、feats.js · `featHealItems`；tests/feat-pickup.test.js）
- [x] **H1** 从跑团战斗点顶栏「标题」出来 `TRPG.active` 不清，之后同一页的单局 / 每日挑战 / 训练场按跑团规则走、写进跑团空位 —— 跑团战斗里点「标题」走跑团自己的离开流程（放弃没打完的战斗、存团、关跑团规则）；另外不管从哪条路回到标题都会关掉跑团模式（screens.js、trpg-ui.js · `TrpgFlow.leave` / `titleFromBattle`；tests/save-leak.test.js）
- [x] **H15** 训练场里撤退 / 全员倒地照常结算并写存档 —— 训练场的战斗不结算耐久、不写队伍记忆 / 跑团空位（game.js · `trainingActive`；tests/save-leak.test.js）
- [x] **H6** 被爆炸桶 / 危墙倒塌 / 可燃气爆燃打失衡的敌人我方不能协助攻击 —— main「作者试玩反馈（10/19）」（app.js · `assistBreaker` / `queueAssistAttack`）
- [x] **H3** 跑团模式：专长、兼修、没分配的专长点不进队伍记忆，下一场开打或读档就全丢 —— game.js `packHero` / `applyCampaignToField`；旧档按等级补回丢掉的专长点（tests/bugfix-round2.test.js）
- [x] **H11** 战斗预演不还原队伍档案（格挡弹窗真扣武器耐久、「挺身」预演用掉短休次数）—— game.js `simulate` 还原 LEDGER 的耐久 / 短休 / 长休 / 钱包 / 工坊（tests/bugfix-round2.test.js）
- [x] **H13** 联机玩家有十来个技能的分步选不了 —— online-view.js `pickKeys` 补齐；测试会扫 app.js / feats.js / items.js 的分步 key，新加的漏了就报错（tests/online-view.test.js）
- [x] **H14** 「本人分步选择」问的单位倒地起不来时热座 / 联机永久卡死 —— hotseat-game.js `ownedChoice` 找不到主人时按武器归属 / 主持人兜底（tests/hotseat-bridge.test.js）
- [x] 中 · 联机玩家看不到以身作盾和龙哥手杖协助选项（询问选项的 `ironwall` / `heal` 被白名单丢掉）
- [x] 中 · 联机玩家战斗中用不了维修工具包（`dest` 是武器 kit 字符串，被丢掉）
- [x] 中 · 龙哥没窥探到的子弹颜色发给所有玩家（现在发 `unknown`）
- [x] 中 · 聊天敏感词过滤太宽（含「坚毅」两字、"this hp" 的整条消失；现在只拦「坚毅生命」、单独成词的 SHP 和后台 / 令牌字样）

## 高（未修）

| # | 问题 | 位置 |
|---|---|---|
| H2 | 单局「休整」补给不够又没钱就卡死：「开始长休」禁用，「硬撑着过夜」没有入口 | `rogue-ui.js:939-954`、`rest-report.js:47`、`rogue.js:2259-2263` |
| H9 | （回归 63b90d7）首领没攒满标记「立刻恢复」后，飞碟触灵本体的协助攻击打不到它 | `app.js:10476 / 7609` |
| H10 | （回归 63b90d7）首领 / 10 级以上精英打出第 1 个标记时，「打进失衡时」的效果全不触发 | `app.js:4654 / 7844-7854` |


## 中（未修，40 条）

**专长（8）**
- [x] 荒原行者「击落到你所在区域」从不生效 —— 引擎击破飞行单位时先把 `flying` 清掉，`featAfterHit` 永远看到 false；`dealTo` 结算前记下是否飞行并传入（app.js · `dealTo`、feats.js · `featAfterHit`；tests/feat-bugs-104.test.js）
- [x] 以身作盾失衡中也能宣布、不承担击破 —— 失衡中的人不再出现在可宣布名单（feats.js · `featIronwallDeclarers`）；击破由宣布者承担本来就生效，补了回归测试（tests/feat-bugs-104.test.js）
- [x] 热座 / 联机的移动校验不认荒原行者 —— `checkMove` 对荒原行者不再要求行动点（酸液地面、空隙只要附赠），和 `doMove` 一致（hotseat-validation.js；tests/feat-bugs-104.test.js）
- [x] 跑团专长点不记来源等级（低等级那点能选高层）—— 每个点记 `featPointLevels`，选专长按来源等级判断；旧档按升级表补（feats.js · `featPointLevelsOf`、growth.js、trpg.js、game.js；tests/feat-bugs-107.test.js）
- [x] 硬骨头受伤时每重算一次属性就掉血（义体反而回满）—— main #78（fix/hard-bone-recompute）
- [x] 多面手三次熟练能选同一项 —— 三项同组、互相排除；已熟练的项照专长说明仍可升级（feats.js、rogue.js · `choiceOptions` / `choose`；tests/feat-bugs-107.test.js）
- [x] 警戒对友军 / 中立生物也触发、同区多人只有一个出手 —— 只认 `hostileTo` 敌对，同区每个有警戒的人各自出手（feats.js · `featAlertOnEnter`；tests/feat-bugs-107.test.js）
- [x] 兼修·鼓劲选「全部友方」只扣附赠不扣行动点 —— `skillCost` 也认 `feat_rouse` 分步（party.js、feats.js · `featDelegateBaseOf`；tests/feat-bugs-104.test.js）

**单局 / 每日挑战（5）**
- [x] 图鉴专长详情永远不显示每日挑战选取率（`window.Rogue` 不存在）—— 改读顶层的 `Rogue.featPickRates()`（bestiary-ui.js · `pickRateNote`；tests/feat-pickrate-124.test.js）
- [x] 战斗种子随机数被画面效果消耗（骰子取决于停了多久 / 开没开特效）—— 画面效果（粒子、音效、骰子滚动动画、动画令牌）改用独立的 `fxRandom()`，不碰种子随机数（run.js、attack-fx.js、hit-fx.js、sfx.js、weather-fx.js、routemap.js、game.js、online-ui.js；tests/fx-random-124.test.js）
- [x] 第三采矿场悬赏目标从别的区域抽、随从和目标互相敌对 —— 目标只从本区域敌人表里抽（没有 2 代币以上的就取本区域代币最多的），随从跟着目标阵营（run.js · `bountyCandidates`；tests/bounty.test.js）
- [x] 联机单局客制化图纸装不上（永远「奎支不够」）—— `installBlueprint` 加进个人指令，扣付钱角色自己的钱包（online-rogue.js；tests/online-single-124.test.js）
- [x] 联机单局房主选的守夜人 / 长休安排被丢掉 —— 房主投长休 / 休整时记下安排，该选项胜出时一起执行（online-rogue.js · `vote` / `tryResolve`、rogue-ui.js · `act`；tests/online-single-124.test.js）

**工坊 / 长休（5）**
- [ ] 闪光震撼弹打 10 级起精英，没攒满标记的失衡不立刻恢复
- [x] 下潜逃走的沙鱼战后照样掉材料 —— rogue.js · `rollMaterialDrops` 和 bestiary.js 只认 `dead`，逃走的（只有 `_removed`）不掉、不记击杀；tests/desert-ai-117.test.js
- [x] 投掷罐对下潜中的单位照样生效 —— items.js · `useEffectItem` 跳过下潜中的单位；tests/desert-ai-117.test.js
- [ ] 跑团工坊不能同时做（每做一样推进一次时间）
- [ ] 长休结算把回满了的人标成「守夜 · 没有恢复」

**敌人 / 地形（7）**
- [x] 沙鱼捕食隔区猎物时先付行动点、原地咬空（夜晚每回合空过） —— desert.js · `sandFishPlan` 猎物不同区时先规划移动；tests/desert-ai-117.test.js
- [x] 精英没附赠时 AI 仍规划移动、整步空过 —— ai.js · `aiPlanBase` 付不起移动（`canPayMove`）就不规划移动；tests/desert-ai-117.test.js
- [x] 播撒者被嘲讽 / 决一死战牵制时抵近射击不生效、每次空放 —— enemies.js · `enemyZoneInRange` / `en_spread`：被牵制且牵制者同区时喷洒抵近打自己所在的区，×0.6
- [x] 决一死战数同区敌人时把中立生物和友军算进去 —— app.js · `touDuelEnemies` 只数 `hostileTo` 灯的单位
- [ ] 连续战斗换区域时上一场的危墙 / 空隙留下来
- [x] 联机玩家战场里没有流沙 / 沙珊瑚台地 —— online-view.js 场地白名单补上，online-battle.js 画出来（2026-10-18）
- [ ] 强盗头子被打倒不算「手下被打倒」

**战斗规则 / 技能 / 评分 / 训练场（15）**
- [ ] 战斗中修武器两条路规则不一致
- [x] 盾击突进 / 全速撞击打屏障后的敌人，震荡却留在目标身上 —— app.js · `waveThenHit` 目标被屏障护着时不施加震荡；tests/skill-edges-119.test.js
- [x] 巨刃划空改砍屏障能隔墙 —— app.js · `chuan_blade` 改砍屏障前判 `lineBlocked`，挡住就不出手、不耗电能；tests/skill-edges-119.test.js
- [x] 收发代理锁定打不到的目标白扣纳米 —— app.js · 回合结束的无人机激光锁定前筛距离 ≤1 / 躲藏 / 下潜 / 友军 / 飞碟本体；tests/skill-edges-119.test.js
- [x] 特盛乱打瞬斩写「无视距离」实际打不到距离 2 —— app.js · `setHiakiStance` 瞬斩加 `skillRange`；tests/skill-edges-119.test.js
- [x] 决一死战只拦范围攻击（多目标单体、协助、借机仍打灯以外的人） —— app.js · `dealTo` 去掉「仅范围攻击」的限制，所有攻击都只打得到灯
- [x] 猛击反震不看屹立不倒 / 坚挺 / 决不后退 / 背水一战 —— engine.js · `applyResultToUnit` 反震改走 `dealBreak`（夏背水一战起身时不扣）；`dealBreak` 加 `opt.keepSelf`（tests/hit-protect-120.test.js）
- [x] 决不后退发动后仍按被击破结算（机甲被击落、挨击落真伤）—— `applyResultToUnit` 扣完架势后实际没失衡就清掉 `broke` / `knockdownHp`，击落真伤改在这之后结算（tests/hit-protect-120.test.js）
- [x] （回归）行动结束才判的高能自爆溢出分 / 余波分没人拿 —— 技能收尾的 `paintSkillLog` 先把行动记账清了，`runSkill` 里 `flushHighBooms` 之前把它恢复回来（`state._endedAcc`），判完再清（app.js · paintSkillLog / runSkill；tests/score-fixes.test.js）
- [x] 飞碟触灵基准分多算 515 —— 本体血量池是五条腿血量的镜像（syncUfoBody），腿已经算过，基准分里本体只算击杀分（app.js · scorePar；tests/score-fixes.test.js）。注：「515」是原 issue 的数字，我只在 1 级验证（多算 100 = 本体镜像血量）
- [x] 基准分把中立生物、友军算进去（S 线虚高）—— scorePar 跳过 `isNeutralCreature` 和 `playerAllied` 的单位（app.js · scorePar；tests/score-fixes.test.js）
- [x] 训练场：聚焦抹层把假人抹成 0/0 —— 补满时按 setupField 记下的原始层重建、去掉封死和聚焦（training.js · refillDummy；tests/training-bugs-105.test.js）
- [x] 训练场：假人会借机 / 协助攻击 —— opportunityStrike、eligibleAssisters 排除 trainingDummy（app.js）
- [x] 训练场：顶栏「重新开始」把训练状态带进普通战斗 —— 训练场里点「重新开始」重开这一场训练（training.js · restart；game.js · g-restart）
- [x] 训练场：「架势无限」不成立 —— 假人架势每次结算补满，击破、不稳、道具失衡、GM 失衡都排除假人，卡片写「架势 ∞」（app.js · defText 等；engine.js；items.js；game.js）

## 低（52 条）

见报告各方向 `findings.md`：专长 6、单局 4、工坊 7、敌人 7、战斗 / 评分 / 联机 / 训练场 27，另 `tools/playtest.js` 的 ARENA 模式不能用。多是日志 / 说明文字和实际不一致、边角情况。

## 需要作者确认（四十多条）

规则没写清、可能是有意的，各方向 `findings.md` 末尾都有。例如：
- 每日挑战用本机日期（不同时区不同种子）
- 长休结算不列燃油 / 电能
- 星灵组织掉率和 README 不一致
- 还魂和力竭 3 的先后
- 兼修·磨刀反而变弱
- 首领第 1 个标记的协助窗口是否按失衡处理
- 技能里的移动只结算深渊
- 三方混战的分边
