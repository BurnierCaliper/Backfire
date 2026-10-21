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

## 高

全部修完（见上面「已修」）。

## 中（全部修完，2026-10-20）

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
- [x] 闪光震撼弹打 10 级起精英，没攒满标记的失衡不立刻恢复 —— items.js · `itemStun` 排完协助攻击后走 `bossQuickRecover`；tests/misc-six-125.test.js
- [x] 下潜逃走的沙鱼战后照样掉材料 —— rogue.js · `rollMaterialDrops` 和 bestiary.js 只认 `dead`，逃走的（只有 `_removed`）不掉、不记击杀；tests/desert-ai-117.test.js
- [x] 投掷罐对下潜中的单位照样生效 —— items.js · `useEffectItem` 跳过下潜中的单位；tests/desert-ai-117.test.js
- [x] 跑团工坊不能同时做（每做一样推进一次时间）—— trpg.js · `trpgCraft` 支持 `jobs`，一起开工、时间按最久的算（tests/misc-six-125.test.js）
- [x] 长休结算把回满了的人标成「守夜 · 没有恢复」—— ledger.js · `restReport` 只标真的没恢复的人（荒野向导 / 武器人守夜不标）（tests/misc-six-125.test.js）

**敌人 / 地形（7）**
- [x] 沙鱼捕食隔区猎物时先付行动点、原地咬空（夜晚每回合空过） —— desert.js · `sandFishPlan` 猎物不同区时先规划移动；tests/desert-ai-117.test.js
- [x] 精英没附赠时 AI 仍规划移动、整步空过 —— ai.js · `aiPlanBase` 付不起移动（`canPayMove`）就不规划移动；tests/desert-ai-117.test.js
- [x] 播撒者被嘲讽 / 决一死战牵制时抵近射击不生效、每次空放 —— enemies.js · `enemyZoneInRange` / `en_spread`：被牵制且牵制者同区时喷洒抵近打自己所在的区，×0.6
- [x] 决一死战数同区敌人时把中立生物和友军算进去 —— app.js · `touDuelEnemies` 只数 `hostileTo` 灯的单位
- [x] 连续战斗换区域时上一场的危墙 / 空隙留下来 —— run.js · `buildEncounterField` 重置所有间隔（tests/misc-six-125.test.js）
- [x] 联机玩家战场里没有流沙 / 沙珊瑚台地 —— online-view.js 场地白名单补上，online-battle.js 画出来（2026-10-18）
- [x] 强盗头子被打倒不算「手下被打倒」—— app.js · `settleEnemyKill`，README 写明手下 = 狂徒 / 强盗头子（tests/misc-six-125.test.js）

**战斗规则 / 技能 / 评分 / 训练场（15）**
- [x] 战斗中修武器两条路规则不一致 —— 耐久都走 `ledgerRepair`、倒地武器人都走 `useRepairKit`（items.js、ledger.js；tests/misc-six-125.test.js）
- [x] （尾巴）震荡弹打得到下潜中的单位 —— items.js · `useEffectItem`（tests/misc-six-125.test.js）
- [x] （尾巴）被嘲讽的播撒者 AI 规划移动而不是喷洒 —— ai.js · `inSkillReach` 认抵近（tests/misc-six-125.test.js）
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

## 第三轮排查：单机（2026-10）

范围：专长、单局 / 每日挑战、工坊 / 长休、敌人 / 地形、战斗规则 / 评分 / 训练场（issue #130；联机另查）。已在上面「已修」「中」列过的不重复。
**说明：本轮排查环境不允许运行 `node`（含 `node --test`），所以下面每一条都是「读代码判断」，没有一条用测试复现。** 复现步骤是推演出来的，没跑过；修之前请先写一个在现有代码上失败的测试。
条目格式：问题 / 位置 / 复现 / 应该 vs 实际 / 确认方式。

### 高（1）

- [x] **H-1 跑团诊所装的义体不进队伍记忆，下一场开战或读档就丢，钱照扣**（已修 issue #134：`packHero` 存 `cyberware` / `cyberOverinstall`，`applyCampaignToField` 读回并重算血量层 / 坚毅上限；tests/cyberware-campaign-memory.test.js）
  - 位置：`game.js` · `packHero`（约 3961）/ `applyCampaignToField`（约 4028）；写入端 `trpg.js` · `trpgCyberwareAct` / `trpgCyberwareInstall`。
  - 复现：跑团开诊所给某角色装义体 → `GAME.rememberCampaign()` 后重摆队伍，或存档读档 → `u.cyberware` 为空，血量 / 坚毅上限变回没装的样子。
  - 应该：义体（和 `cyberOverinstall`）跟着队伍记忆走，和 `cyberPlan` 一样；实际：丢失，钱不退。单局存在 `h.cyberware`（rogue.js:514、1577）所以没事。
  - 确认方式：读代码判断（`game.js` 里 grep 不到 `cyberware`）；`tests/cyberware-trpg.test.js` 没有持久化往返测试。

### 中（10）

- [x] **M-1 `tools/playtest.js` 的 ARENA 模式一开跑就抛错（上一轮报的「不能用」）**（已修 issue #134：接任务前 `run.stage` 设成 `"board"`；tests/playtest-arena.test.js）：位置 `tools/playtest.js:405-406`（先 `run.stage = "task"` 再 `R.acceptTask(run, "main")`）、`rogue.js:438`（`acceptTask` 要求 `stage === "board"`）。复现 `ARENA=1:5:1 node tools/playtest.js`。应该能连打 battle / elite / boss 出胜率；实际第一场接任务就抛「现在不在任务板前，不能接任务」。修法：接任务前把 `run.stage` 设成 `"board"`。`BOSSTEST` / `ARENA` 没有任何测试。确认方式：读代码判断（核对了两处源码，没能运行）。
- [x] **M-2 乘势会误伤中立生物和友军**（已修 issue #141：`featAfterHit` 只对 `hostileTo` 的单位生效；tests/third-round-solo-m.test.js）：给「同区其他架势 = 1 的敌人」各 1 点击破，没按 `hostileTo` 筛。位置 `feats.js:725` · `featAfterHit`，用的 `app.js:5085` · `visibleEnemies`（只看 `!u.isPlayer`）。复现：乘势角色把敌人 A 打进失衡，同区有架势 1 的 `dust_bug` 或友军 `guard_sword`。应该只对敌对生效。读代码判断。
- [x] **M-3 长线养成「每日任务」有 4 种永远完成不了**（已修 issue #141：长休 / 检定成功 / 购买 / 我方改天气分别写入进度，`growthDailyBump` + `playerWeatherChanges`；其余每场固定增量和裸 `Math.random()` 没动；tests/third-round-solo-m.test.js）：`long_rest` / `check_ok` / `shop` / `weather` 注释写着在休息 / 检定 / 购买 / 改天气时结算，但全仓库没有这些写入；其余项是每场固定增量（击杀 20 杂兵每场 +4、「无死亡通关」打赢就 +1 不看倒地），和说明不符。抽到那四项则「三个全完成」奖励拿不到。位置 `rogue.js:2522` `GROWTH_GENERAL_POOL`、`2575` `updateGrowthDailyProgress`、`2620` `completeGrowthDailyTask`（还用裸 `Math.random()` 掷材料，没走 `withRng`，`2625`）。读代码判断。
- [x] **M-4 每日挑战记录的「队伍」在有人阵亡后不对，全灭时是空数组**（已修 issue #141：开局记 `run.daily.party`，`dailyRecord` 读它；tests/third-round-solo-m.test.js）：`dailyRecord` 存 `run.party.map(h => h.kit)`，阵亡者已被 `SaveStore.killHero` 移到 `run.fallen`。位置 `rogue.js:2780` · `dailyRecord`，调用点 `2722` · `endRun`（团灭走 `captureParty`、力竭走 `exhaustDeath`）。应取 `party` + `fallen` 或开局记下。读代码判断。
- [x] **M-5 飞碟触灵 10 级起被动召唤的看守不记 `summonedBy`**（已修 issue #141：补 `summonedBy`，顺带补 `en_bigsand_summon` 的沙灵；tests/third-round-solo-m.test.js）：自爆炸不到它们，材料掉落过滤（`rogue.js:1062` 用 `!u.summonedBy`）也不一致（技能版 `ufo_summon` 有记）。位置 `app.js:1779-1790` · `beginRound`；对照 `enemies.js:1953`、`2302-2309` · `detonateUfo`。README 1464 写「自爆也炸它召唤的看守」。可参照 `tests/audit-P5-enemies.test.js:432`。读代码判断。
- [x] **M-6 AI 的「后撤」和「接近」不看危墙 / 关着的门，被拦下后整回合不出手**（已修 issue #144：后撤只选 `walkableNeighbors`，`stepToward` 跳过墙 / 关门，走不通改原地行动；测试 tests/bugfix-m6-m10.test.js）：`doMove` 被 `canCross` 拦下不扣行动点、`sig` 不变，`enemyPhase` 直接 break。A：dist=1 的远程敌人被贴脸会选相邻无我方单位的区后撤，不查是否隔墙；B：目标挑选（`lowest` / `topAtk` / `nearest`）不看墙，近战敌人朝墙那边的人移动被拦。位置 `ai.js` · `aiStep`（约 286-293）/ `aiPlanBase`（`if (step != null) return move(step)`）。`tests/ai-positioning.test.js:37` 用三区所以没覆盖。应像 `firingStep` 用 `walkableNeighbors` 筛。复现：两区制 `gaps["1-2"]` 设 wall，`guard_gun` 在 1 区、我方 `[1,1]`，`EnemyAI.plan` 返回移到 2 区，执行后 zone / ap 都不变。读代码判断。
- [x] **M-7 沙鱼夜间 / 饥饿「追猎」隔着墙 / 关门 / 深渊的猎物，整回合被走不通的移动占掉**（已修 issue #144：`sandFishPlan` 路径按能否通过算，走不通的猎物换掉；测试 tests/bugfix-m6-m10.test.js）：`sandFishPlan` 的 `zonePath` 不看间隔，只查 `coralAvoid` 和付不付得起。猎物在墙那边时每回合都返回「移动」，沙鱼从不攻击眼前的玩家。位置 `desert.js` · `sandFishPlan`。应用 `walkableNeighbors` 同款判断。读代码判断。
- [x] **M-8 护送人物「委托人」把中立生物、友军、下潜单位算成「敌人」**（已修 issue #144：`foes` 用 `hostileTo` 并排除下潜单位；测试 tests/bugfix-m6-m10.test.js）：`escort.js` · `escortAct` 的 `foes` 只排除 `isPlayer/dead/hidden/_removed/ironwall/untargetable`。同区只有一只尘虫也会「躲开」；还击按血量最低挑，沙漠里几乎总选尘虫（desert.js 文件头写「谁都不会主动打它们」），也会选打不到的下潜 / 距离 2 / 友军。应用 `hostileTo` 口径并筛打得到的。读代码判断。
- [x] **M-9 跑团工坊同时开工时，打下手的人还能同时做自己的东西**（已修 issue #144：`trpgCraft` 把打下手的人也登记为忙；测试 tests/bugfix-m6-m10.test.js）：`trpg.js:123-135` · `trpgCraft` 的 `busy` 只登记 `j.kit` 不登记 `j.helper`；同一个人给两件打下手也不拦。对照 `docs/workshop-design.md` 第 5 节和单局 `rogue.js:1756-1763`（已拦「已经在忙了」）。读代码判断。
- [x] **M-10 跑团补给不够只能硬撑时，护送 VIP 仍被治满血**（已修 issue #144：`trpgLongRest` 只在长休成功时才治 VIP；测试 tests/bugfix-m6-m10.test.js）：`trpg.js:394-398` · `trpgLongRest` 无条件调 `trpgTaskRestEscort`（`trpg-tasks.js:367`），长休 `ok:false`（队员没恢复）时 VIP 仍清伤、日志写「血量回满」。单局只在长休成功时才走。应 `r.report.ok` 为假时不治。读代码判断。

### 低（21）

**专长**
- [x] **L-1 【已修 #149：`ledgerRestoreAll` 补清 `shortOnce`】主持人「全员复原」不刷新 `LEDGER.shortOnce`**（以身作盾、挺身等「每次短休 N 次」的专长）：`ledger.js:788-803` · `ledgerRestoreAll` 清了 `shortUsed` / `restOnce` 漏了 `shortOnce`；对照长休 `765`、短休 `523`；入口 `trpg-commands.js:17`、`battle-commands.js:201`。读代码判断。
- [x] **L-2 【已修 #149：走原技能时 `featSkillTargetWhy` 不再调专长自己的 `targetWhy`】兼修后的勾索仍拉不动首领**：兼修改走原技能「拉拽」（`app.js:12852` · `displaceTo` 无首领限制），但 `feats.js:539-555` · `featSkillTargetWhy` 最后仍调勾索自己的 `targetWhy`（`feats.js:199`）拦首领。战地包扎同理，影响很小。读代码判断。
- [x] **L-3 【已修 #149：`featSkills` 涉猎版按 1 级取说明并去掉原技能的「每场 N 次」】涉猎专长在技能栏的说明沿用原技能文字，次数 / 加强与实际不符**：`feats.js:516-523` · `featSkills` 取 `roleSkillDef(...).hint`（`party.js:1050-1100`、`app.js:7164`）。震慑写「每场两三次」实际 1 次；续时 / 硬撑 / 看破写两次实际 1 次；加固 15 级「可自选血量种类」、鼓劲 15 级加强都被 `_dabbleNerf` 关掉但仍显示。读代码判断。
- [x] **L-4 【已修 #149：新增 `trpgSmithFee`，不填费用时带巧手匠人默认八折，界面默认值同步】跑团「找工匠升级」不打八折**（巧手匠人说明与 README 写商店和工匠都 8 折）：`trpg.js:511` · `trpgUpgradeWeapon` 的 `smith` 模式直接用 `info.labor` 或主持人填的费用，界面默认值也是原价（`trpg-ui.js:295-307`）。可能是有意让主持人定。读代码判断。

**单局**
- [x] **L-5 【已修 #149：新增 `ROGUE_CONFIG.eliteOverCap`（默认 1），精英战可超过本幕上限】精英战的 +1 级加成常被本幕等级上限吞掉**：`rogue.js:76-81` · `enemyLevel`，`min(b, round(a+(b-a)*t) + bonus)`，`actDay≥6` 后精英与普通战同级；`ROGUE_CONFIG.eliteLevelBonus` 注释写「精英比同时期普通战斗高几级」。可能是有意封顶。读代码判断。
- [x] **L-6 【已修 #149：`finishBattle` 校验 `run.stage` 和当前节点】`finishBattle` 没有阶段保护**：`acceptTask` / `camp` / `restAtNode` / `afterVictory` 都校验 `run.stage`，只有 `rogue.js:931` · `finishBattle`（及 `rogue-commands.js` 的 `actions.finishBattle`）没有。任务板上调用会在 `advanceNode` 的 `run.task.hunt` 抛 TypeError，非战斗节点调用会把节点「打完」并推进。UI 重复触发才会遇到。读代码判断。
- [x] **L-7 【已修 #149：新增 `canShortRestAtNode`，按钮灰掉写原因，`restAtNode` 也拒绝】休息点「短休」在没人有次数时仍可点，白白过一站**：`rogue.js:1445` · `restAtNode`，按钮 `rogue-ui.js:378`。`ledgerShortRest` 只写「次数已用完」，`advanceNode` 照走。应灰掉或提示。读代码判断。
- [x] **L-8 休息点遭遇战（被偷袭）打赢后不计这场战斗的时间**：撤退 / 败北会 `passHours(NODE.battle.hours)`，打赢只走 `doLongRest`。`rogue.js:931` 起 `finishBattle` 的 ambush 分支。可能是有意并进长休。读代码判断。**已定：不改（作者 10/21 确认）。**

**工坊 / 长休**
- [x] **L-9 死亡角色能制作，也能给别人打下手**：`trpg.js:105-121` · `trpgCraftOdds` 用 `trpgHeroes()`（含死人）；长休、钱包平分、专长计数都只认活人。主持人手动操作，可能有意放宽。读代码判断。**已修（#164，作者定禁掉）：死亡角色不能制作也不能打下手，工坊页打下手人选不列死人；复活后照常。**
- [x] **L-10 对死亡角色用医疗包，道具白扣**：`ledger.js:853-866` · `ledgerHealItem`，先 `bagAdd(-1)` 再 `healHeroFlesh`（对死人直接 return），日志「实际恢复 0」。应提示「已死亡」且不扣。读代码判断。**已修（#150）：先判断死亡，提示「已死亡」，不扣道具。**
- [x] **L-11 长休不恢复死亡角色的武器耐久，README 写「全部武器耐久回满」**：`ledger.js:736` 只在 `!h.dead` 里 `restoreDurability`；`ledgerAfterBattle`（402）照样给死人武器每场 −1。可能有意，README 没写。读代码判断。**已修（#164，作者定）：战后结算跳过死亡角色的武器，不扣也不恢复；README 补了说明。**
- [x] **L-12 守夜日志文字和实际不符**：`ledger.js:760` 写「除守夜者外，武器耐久回满」，实际守夜的是角色时他自己的武器照样回满（737），只有武器人守夜那把才不回。读代码判断。**已修（#150）：角色守夜写「全部武器耐久回满」，武器人守夜才写「除守夜的那把武器外」。**
- [x] **L-13 README「休整」一节过时（#150 已改：过 0 点刷新短休、白天睡 8 小时不换天、维修按点数；「战斗里维修包不会混进去」那句改成维修工具包战斗中也能用）**：README.md:236-237 附近——「每满 24 小时刷新短休次数」实际过 0 点刷新；「长休后进入下一天」实际白天睡 8 小时不换天；「维修工具包 +10 耐久」实际按点数修；「战斗里使用道具……维修包不会混进去」实际 `repair_kit` 带 `combat:true`。读文档与代码判断。
- [x] **L-14 医疗包 hint 说「治疗内层生命」，实际会溢到外层（#150 已修：hint 改成「从内层往外补，可以治到外层」）**：`items.js:5-6` 的 hint vs `healUnit` 注释「可以治到外层（作者定）」。读代码判断。
- [x] **L-15 强心注射剂对「起身中」的人恢复 0 却照扣坚毅 6，日志不提示（#150 已修：起身中不让用，提示原因，不扣坚毅和道具）**：`items.js:398-402`；`healUnit` 对 `upOnShp` 直接返回 0（`engine.js:1426`），`selfShpCost` 仍扣。医疗包分支有说明，这里没有。读代码判断。
- [x] **L-16 跑团里不花钱的操作选了「由谁付」，日志仍写「由 X 付，钱包剩 N」（#150 已修：钱包没变就不写这句）**：`trpg-commands.js:64` · `PAYABLE` 含 `repair` / `craft` / `teachRecipe`，`trpgPayWith` 末尾无条件追加。钱不会错，文字误导。读代码判断。

**敌人 / 地形**
- [x] **L-17 高压巡逻艇电弧扫射的「感电」可能落在没被打到的人身上（#153 已修：感电只在这一击打中的人里挑，死亡 / 倒地 / 隔墙的不算）**：`enemies.js` · `en_boat_arc` 的 `hit = allPlayers().filter(距离1)` 不排除死亡 / 倒地 / 隔墙，`pick` 直接上 `shock`；`ai.js`（`special === "boat"`）也只看 `zdist === 1`。读代码判断。
- [x] **L-18 赤牙「引火」直接写 `statuses.burn`，绕过 `grantBurn`（#153 已修：改走 `grantBurn`，预热版只点站着的人）**：`enemies.js:1785-1789` · `en_chi_ignite`，自焚（`self === "burn"`）免疫失效；预热版名单也不排除死亡 / 倒地。赤牙目前没接 AI（README 128），只在主持人手动时出现。读代码判断。
- [x] **L-19 图鉴 / 单位卡写固定骰，实际每 5 级升档（#153 已修：图鉴伤害骰旁注明「基础骰，每 5 级升一档 / 骰数每 5 级 +1」）**：`engine.js` · `unitOf` 的 `suggest.dice` vs `enemies.js` 用 `leveledSides` 的 `en_buoy` / `en_dump` / `en_swarm` / `en_crow` / `en_boat_arc` / `en_spread` / `en_watch` / `en_dust_grind` / `en_dust_lift`，牛队长冲撞、狼队长借机骰数随 `addedDiceByLevel` 增加；`bestiaryStats` 读 `suggest.dice` 不随等级。README 1578 只提蜂群。例：15 级浮标图鉴写 1d4 实际 1d8。读代码判断。
- [x] **L-20 AI 把「离开酸液地面 / 越过空隙」当附赠移动规划，实际扣行动点（#153 已修：`canPayMove(u, dest)` 按实际消耗判断，精英 / 首领用行动点移动要多留 1 点出手）**：`ai.js` · `canPayMove`（精英 / 首领只看 `bonus >= 1`）vs `app.js` · `doMoveInner`（酸液非行走者 / `overVoid` 走 `spendAp`）。1 行动点 + 1 附赠的精英站在酸液上会把唯一行动点花在移动上。规则本身没问题，是 AI 没算这笔代价。读代码判断。
- [x] **L-21 已 `_removed` 但没 `dead` 的单位仍在范围效果名单里（#153 已修：`fieldUnits` / `visibleEnemies` 和各同区范围名单排除 `_removed`；逃走的仍不算击杀）**：`desert.js:142`（尘虫迁走）、`205` / `214`（沙鱼下潜逃走）不像 `removeEnemyFromField` 那样清出 `state.units`；`fieldUnits()` / `visibleEnemies()` / 爆炸桶、电池、危墙倒塌的 `filter(!hidden && !dead)` 都不滤 `_removed`，范围效果仍波及并在日志出现名字。影响小，未验证打死后是否结算经验。读代码判断。

### 战斗规则 / 技能 / 评分 / 训练场

补查（issue #156）：这一节**真的用 `node --test` 写了临时测试跑过**（临时测试没有提交；用 `tests/headless.js` 加载整套规则）。
覆盖：11 个角色（含武器人）的全部技能在 1 级和 15 级各跑一遍（打距离 0 / 距离 1，对照技能说明、行动点 / 附赠消耗、有没有抛错）；评分（溢出、失衡、招式疲劳、基准分、各评级线、速杀 / 无伤）；训练场（所有角色 × 1/5/15 级，8 种天气 × 8 种场地，重新开始）；击杀归属（#114）在道具、反伤、借机、协助攻击、持续伤害下是否成立；另外 88 场随机自动对局检查「各分项加起来 = 总分」、分数有限、日志里没有 NaN / undefined。
条目格式同上：问题 / 位置 / 复现 / 应该 vs 实际 / 确认方式。「测试复现」= 写了临时测试在现有代码上跑出了所述结果。

### 高（0）

没有。技能数值 / 射程 / 消耗和说明对得上（见最后的「已核对」），没有跑出抛错或会卡死战斗的东西。

### 中（5）

- [x] **战-M1** （已修 #175：`kolt_aa` 射程改成随刀头变化，写进 `SKILL_RANGE_BY_STATE`：电钻 0–0、酸液炮 1–1，射程预检就拒绝，不扣点不记分）**柯尔特电钻普攻（`kolt_aa`）能选距离 1 的敌人，打不到却照扣 1 行动点，还记 10 个行动分**：位置 `engine.js:357` · `SKILL_RANGE.kolt_aa = { min: 0, max: 1 }`（给酸液炮模式留的），但电钻模式（默认）走 `app.js` · `kolt_aa` 分支的 `atkRange: "melee"`，同区才打得到；`runSkillInner` 的射程预检按 0–1 放行，行动点扣完才在 `hitOne` 里拒绝。复现：柯尔特（电钻）在 1 区，敌人在 2 区，`runSkill("kolt_aa")` → 日志「消耗 1 行动点（剩 0/1）→ ✗ 柯尔特 是近距离攻击，打不到距离 1 的 狂徒（锤）」，`battleScore.total` 0 → 10（`action`）。应该：像夕夏 / 川川 / 龙哥那样在射程预检拒绝，不扣点；实际：行动点白扣（1 行动点的角色等于整回合没了）。对照：`xia_aa` / `chuan_aa` 同样场景不扣点。修法：给 `kolt_aa` 加 `SKILL_RANGE_BY_STATE`（电钻 0–0、酸液炮 1–1），顺带检查 `torque_*` 同类。确认方式：测试复现（tests/ 下没有柯尔特打距离 1 的测试）。
- [x] **战-M2** （已修 #175：`itemApplyStatus` 的 burn 分支补 `markStatusOwner`）**燃烧瓶（`fx_burn`）挂的灼烧不记所有者，灼烧打死的敌人算上一个打它的人**：位置 `items.js:500-503` · `itemApplyStatus` 的 `key === "burn"` 分支只调 `grantBurn`，没有 `markStatusOwner`，末尾 `popStatus`（里面才记所有者）又被 `key !== "burn"` 跳过；腐蚀喷雾 / 电解液罐走另一条分支，有记。复现：A、B 在场，B 先打过敌人（`_lastHitBy = B`），A 对敌人所在区用燃烧瓶，把敌人血压到 1，过两个回合灼烧把它烧死 → 击杀算 B（`kills`：A 0、B 1）；换成腐蚀喷雾 / 电解液罐、凝固汽油罐场地，击杀算 A。应该：#114「持续伤害算状态所有者」，算 A；实际：算 B。确认方式：测试复现。
- [x] **战-M3** （已修 #175：`useItemOn` 用效果道具期间记 `state._itemUserId`，`actingPlayerId` 回落到它，道具的即时伤害 / 状态按使用者归属）**道具的即时伤害打死敌人，击杀不算使用者（冰锥弹的刺骨）**：位置 `items.js:371` · `useItemOn` → `useEffectItem` → `applyInstantEffect(… "sting")` → `effects.js` · `stingPulse` → `applyTypedDot`。使用道具不开 `actionAcc`，`applyTypedDotIn` 回落到 `actingPlayerId()` = null，`_lastHitBy` 不更新。复现：B 先打过敌人，A 对血量 1 的敌人用冰锥弹 → 敌人被刺骨打死，`kills`：A 0、B 1；对照投掷手榴弹（`bomb_e` / `bomb_a`，走 `dealTo(actor, …)`）击杀算 A。应该：算使用道具的 A（和技能里「玩家行动中顺带的伤害 = 行动的人」一致）；实际：算上一个打过它的人，没人打过就不记击杀。其他即时效果道具（铝热弹、超频针等）这次没复现出致死，但走同一条路径。确认方式：测试复现（冰锥弹）；其余读代码。
- [x] **战-M4** （已修 #175：`setupField` 生成假人和精英牛时包 `ENEMY_IV.off++ / --`）**训练场的假人血量带「个体值」，同等级不同角色假人血量差 ±10%，和「同一套布置 / 对照输出循环」的说明不符**：位置 `training.js:88-90`（`setupField` 里直接 `spawnEnemyGroup`）；`sim.js` 的 `BattleSim.setup` 为了确定的数字会 `ENEMY_IV.off++`，但 `setupField` 在 `setup` 之后才生成假人，没包这一层；种子里带角色名（`dpt:${kit}:${level}:setup`），所以每个角色掷出的个体值不同。复现：`Training.setupField(kit, 10, {})`，11 个角色的假人总血量 ruby 364 / yuito 408 / hiaki 380 / tou 389 / xia 376 / chuan 432 / nora 357 / kolt 389 / helu 364 / ras 376 / longge 368；1 级是 95–115，5 级 214–254。同一角色重开是同一个数（固定种子）。应该：假人血量 = 同等级精英牛的固定总血量（文件头注释、README、`tools/dpt.js` 都这么写），各角色可比；实际：差 ±10%，拿训练场数字横向比较角色输出会被误导。修法：`setupField` 里生成假人和精英牛时包 `ENEMY_IV.off++ / --`。确认方式：测试复现。
- [x] **战-M5** （已修 #175：`applyResultToUnit` 写 `result.breakSpent`＝实际扣掉的架势，击破分 / 击破数按它算；已失衡的敌人再打不再加击破分，按作者定的「实际扣多少算多少」）**击破分和「击破」统计按名义击破算，不看实际扣掉的架势**：位置 `app.js:8169-8170`（`addScore("brk", res.breakDealt × 10)`、`st.brk += res.breakDealt`）；而 `engine.js:1332` · `applyResultToUnit` 里真正扣的是 `spent`（训练假人、背水一战、猫的灵巧、坚挺都会把它改小甚至清零）。复现 A：训练场里夕夏普攻假人 → 假人架势一点没掉（`def` 仍 1000000），战场数据「击破」2、评分 `brk` 20。复现 B：敌人已经失衡（`def` 0）再被夕夏普攻 → 每一击仍 +20 分（连打 3 下 `brk` 20 → 40 → 60，失衡分只给一次）。应该：按实际扣掉的架势算（至少训练场的假人不该有击破数 / 分）；实际：按名义算。「已失衡的敌人再打还算击破」是不是有意的放「需要作者确认」。确认方式：测试复现。

### 低（5）

- [x] **战-L1** （已修 #175：`skillTargetError` 里预检友军和近战打飞行附赠不足，不扣点不记分）**攻击友军（跑团「我方同阵营」）/ 近战打飞行目标附赠不足：行动点先扣、后拒绝，还记行动分**：位置 `app.js:7752`（友军）、`7819`（飞行附赠不足）在 `dealTo` 里才拒绝；`skillTargetError` 只给龙哥 / 小朋友的技能（`app.js:11112-11118`）预检了「飞行要多 1 附赠」。复现：`state.playerAllies = ["安保"]`，夕夏 `xia_aa` 打机器人看守 → 「消耗 1 行动点 → ✗ 是友军，不会被我方攻击」，评分 +10；夕夏附赠为 0 时打飞行敌人同理。UI 上多半点不到友军（`hostileTo` 筛选），但规则层 / 联机命令能到；和战-M1 同一类问题，修法也类似（预检里拒绝）。确认方式：测试复现。
- [x] **战-L2** （已修 #175：`scoreAct` 记 `state.scoreActLv` 见过的最高等级，`resetBattleRecords` 重置）**评分的「第几幕」按场上现存敌人的最高等级算，死掉被移出场的敌人不算，分数线会越打越低**：位置 `app.js:2901` · `scoreAct`（`state.units` 里 `!isPlayer`）；`removeEnemyFromField`（`app.js:4953`）3 秒后把死敌人移出 `state.units`。基准分 `scorePar` 用 `scoreSeen` 缓存住了第一次见到的敌人，幕数没缓存。复现：12 级狂徒 + 3 级狂徒（单局之外的战斗：跑团 / 原型 / 训练），`scoreAct()` = 3，各评级线 B 960 / A 1150 / S 1340；把 12 级的移出 `state.units`（模拟计时器）后 `scoreAct()` = 1，B 760 / A 950 / S 1150。打赢最后一个杂兵时结算的评价线就是低的那一套。单局由 `battleSpec` 写 `state.scoreAct`，不受影响。应该：开战（或敌人第一次出现）时记住幕数，和 `scoreSeen` 一样。确认方式：测试复现（用手动移出单位模拟计时器，没跑真实的 3 秒计时）。
- [ ] **战-L3 规则层不校验增益 / 治疗技能的目标阵营：应急处理、缓冲、掩护、助威对敌人也生效**：位置 `app.js` · `runSkillInner` 的 `role_firstaid`（`needT()` 只判有没有目标）、`role_buffer`、`role_cover`，`yuito_inspire`；阵营校验只在界面（`SKILL_TARGET_SIDE`）和热座（`hotseat-validation.js:157`）。复现：`runSkill("role_firstaid")` 目标是敌人 → 「应急处理：狂徒（锤） 恢复 17」；`role_buffer` 给敌人 6 点护盾；`yuito_inspire` 让敌人「本回合振奋」。正常界面选不到，只有绕过界面的调用（联机 / 命令接口没有 `skillTargetError` 的阵营检查时）能触发。确认方式：测试复现；联机命令路径是否另有校验没查。
- [ ] **战-L4 「同区」范围型职责技能被当成点选目标做射程检查**：`role_dome`（防护罩）、`role_lockdown`（禁足怒吼）、`role_breakwave`（破势）、`role_sturdy`（不倒战意）在选中了距离 1 的敌人时报「该技能不能打距离 1 的目标」，不选目标才行。位置 `app.js:11366` 一带的通用射程检查（这几个技能没登记 `SKILL_RANGE`，靠提示文字里的「同区」解析）。界面上这几个技能不需要选目标，一般碰不到；复现是直接 `runSkill` 时 `targetId` 指着一个距离 1 的敌人。确认方式：测试复现；影响很小。
- [ ] **战-L5 部分职责技能的说明文字不写等级成长，和实际数值差很大**：`party.js:1075` · `role_firstaid` 的 hint 写「1d4+2」，15 级实际 4d4+5（`skill-text.js:357` 写了「每 5 级骰子 +1d4+1」，按钮 hint 没写）；`xia_prep` 的 hint 写「+1d6（每5级提高骰子）」，15 级实际 1d12，写法含糊。数值本身对得上 `skill-text.js`，只是按钮上的短说明会误导。确认方式：测试复现（1 级 / 15 级各跑一遍）。

### 需要作者确认

- [x] **（主人 10/21 已定，#187：打中立生物的伤害 / 击破 / 失衡 / 溢出分降到 1/4，`SCORE_RULES.neutralMul`；基准分照旧不算）打中立生物（尘虫、管虫）也拿伤害分 / 击破分 / 失衡分 / 溢出分**：测试：夕夏普攻尘虫 → `battleScore.parts` = `{ action 10, dmg 16, brk 20, stagger 50, bonus 15 }`，连打死它再 +溢出 7、`kills` 0、经验 0；基准分 `scorePar` 明确**不算**中立生物（README / 代码注释：「不是要打的敌人」）。也就是说「不算进基准、不给经验掉落击杀分」，但打它的伤害 / 击破 / 失衡分照拿，一只尘虫可以白送 50 分失衡分。是不是要对中立生物也不记（或一视同仁都记）？位置 `app.js:8165-8190`（`applyCombat` 里的加分）和 `app.js:3030-3045`（`trackHealBy` 里的失衡分）都没按 `hostileTo` / `isNeutralCreature` 筛。友军（同阵营）打不到，不涉及。
- [x] **（主人 10/21 已定，#187：算格挡者的击杀；雷鸣协助格挡、哔哩哩、铁壁过载 / 雷鸣三处都传了 `by`）反伤打死敌人的击杀归属（#114 没写这一类）**：雷鸣天气下成功的协助格挡反伤（`app.js:6779-6780`）、哔哩哩格挡反伤（`app.js:8109`）、铁壁过载 / 雷鸣反伤（`app.js:3209-3214`）都是 `applyTypedDot(attacker, …)`，没传 `by`，又发生在敌人回合（`actingPlayerId()` = null），所以 `_lastHitBy` 不变。测试：雷鸣、Helumica 协助格挡成功，反伤 14 点打死血量 1 的狂徒 → 没人打过它时击杀不算任何人（经验 / 奎支照给），先被柯尔特打过则算柯尔特，都不算格挡的 Helumica。#114 写的「直接攻击 = 出手的玩家……没有所有者的场地 / 天气 / 流沙 = 不改」，格挡反伤是玩家的格挡造成的，算不算格挡者的击杀？
- **已失衡的敌人再被打，每一击是否还算击破分**（见战-M5 复现 B）：连打失衡中的敌人每下 +20；失衡分本身只给一次。
- **拆装部件（`torque_swap`）换完刀头才发现打不到：行动点、换刀头、强制收回全部照做**：测试：柯尔特（电钻）和敌人同区，`torque_swap` 换成酸液炮（远距离）后「✗ 扭矩 是远距离攻击，打不到距离 0」，行动点 −1、刀头换了、扭矩已收回。说明写「更换刀头，再打对应距离」，可能就是这个意思（先换后打）；只是想确认换完打不到还要不要收回。位置 `app.js` · `torque_swap` 分支。

### 已核对、没发现问题（测试对照过）

- 各角色主要技能的倍率 / 击破 / 射程 / 消耗和说明一致：瑞比普攻（两次 0.5atk 能量、共 1 击破）与扳机（施加高能）、结人普攻（1atk 冰 +1 击破、豆→液）、绯秋拔刀（1atk +1 击破）与居合（移动后 1.5atk，无击破）、灯普攻 / 圣战起始（移动 + 错位）、夕夏普攻（1d4+atk，2 击破；引擎时火焰 3 击破）、川川普攻（两次 atk/2+1d4 共 1 击破；耗电能变三次共 2 击破）、电能鞭（atk/2 +1 击破 +1 电能）、诺拉针尖 / 普攻、柯尔特普攻（0.3/0.3/0.4atk 三次，2 击破）、拉斯缪尔普攻（两次 0.5atk，共 1 击破，+20% 能量）与泄能、龙哥手杖普攻 / 冷气穿刺（刺骨 = 肉体上限 10%）/ 吐酸（附赠、每场一次）；武器人的主要技能（明特、拿铁、丹生谷、年糕、柏妮尔、哔哩哩、维塔斯、扭矩、Ecmo、EDC30k、小朋友）同样对照过，**没有抛错**。
- 全部技能 × 距离 0 / 1 × 1 级 / 15 级（约 400 次调用）没有抛错；行动点 / 附赠消耗与 hint 里写的「附赠 / 行动点」一致（除上面战-M1、战-L1 的白扣）。
- 招式疲劳：同一角色连续回合用同一招，实测 −0 / −10% / −25% / −40% / −40%（封顶），回合内第二次同招沿用同一档，中间换了别的招则重置；协助格挡 / 协助攻击不吃疲劳。
- 评分：溢出分 `floor(溢出 × 1.5)`；失衡分每次失衡只给一次；基准分不含中立生物、友军、飞碟本体；88 场随机对局（11 个角色 × 4 种敌人组合 × 2 个种子）每场「各分项相加 = 总分」，分数有限、非负，个人得分加起来等于总分，击杀数 = 死亡敌人数，日志里没有 NaN / undefined / [object]。
- 训练场：11 个角色 × 1/5/15 级、8 种天气 × 8 种场地（含高地、三层血量、算克制）布置都不抛错；重新开始后假人血量不变（同一个种子）；假人不借机、不协助攻击（#105 修过的保持住）。
- 击杀归属（#114）在这些情形下成立：A 打过 B 补刀、灼烧 / 腐蚀 / 电解液、火场 / 酸液地面场地（所有者）、借机攻击、手榴弹（`bomb_e` / `bomb_a`）、流沙、深渊、高能余波（已有 `tests/kill-credit.test.js`，这次补跑了道具和反伤）。例外见战-M2、战-M3 和「需要作者确认」。
- 借机攻击：对离开的、失衡 / 隐藏的敌人不触发，普通敌人触发；协助攻击名单排除濒死 / 失衡的玩家和训练假人。

## 第三轮排查：联机（2026-10）

范围：`online-*.js`、`hotseat*.js`、`relay/worker.js`、`online.css`。**只排查没改代码。**
说明：这轮读了 `online-view.js`、`online-game.js`、`online-rogue.js`、`online-actions.js`、`hotseat-game.js`、`relay/worker.js`，以及 `online-ui.js` 前 640 行和 `online-battle.js` 前 150 行、`online.css` 的响应式段落。`online-gm-ui.js`、`hotseat-ui.js`、`hotseat-authority.js`、`hotseat-validation.js` 和 `online-battle.js` / `online-ui.js` 的其余部分当时只翻过或没读，**已在下面「补查（#157）」补上**。
确认方式分两种：「测试复现」= 写了临时 `node --test` 跑过（临时测试没提交）；「读代码」= 只读代码判断，没跑过。环境没装 Playwright，**手机宽度（390px）一条都没实测**，界面类全是读代码。
坚毅生命（shp）：白名单这一侧没有找到把具体数值发给玩家的路径（`online-view.js` 现有测试 29 条通过，聊天过滤、`scrubHidden`、`projectTape` 的 `visibleHp` 都看过）；有两处拿不准的放在最后「需要作者确认」。

### 高（0）

没找到能确认的「卡死 / 数据泄露」级问题。

### 中（2）

- [x] **联机玩家按钮灰掉的原因几乎都被换成一句笼统的话**（已修 #135：`safeError` 原句照给，只用 `text()` 敏感词过滤挡提到坚毅生命 / SHP / 后台的句子；见 tests/online-view.test.js）
  - 位置：`online-view.js:477` `safeError`（被 `projectActionMenu` 的 `option.reason`（:467）、`projectPacket` 的 `out.error`（:610）调用）；原因文字来自 `hotseat-validation.js:66` `baseReason`、`app.js` `SKILL_REQUIREMENT`（:10768）、`costBlockReason`（:5280）。
  - 复现：对 `OnlineView.safeError` 传这些真实规则文字，看返回值。「陷在流沙里没顶，不能行动」「纳米能源不足 20」「咖啡液不足 2」「没有咖啡液」「只能在居合架势下使用」「已经在待命」「热锅只能用丹生谷发动」「这个单位没有这项可用技能」，全部返回「操作未生效，请检查当前权限与可用选项」。
  - 应该 / 实际：单机里这些技能按钮灰掉时直接写原因（缺咖啡液、要换架势……）；联机玩家只看到同一句笼统的话，不知道为什么用不了。白名单本意是防止泄露坚毅数值，但原因文字本身没有数值——建议改成「按已知句式放行」或让 `reason` 走 `text()` 的敏感词过滤而不是整句换掉。
  - 确认方式：测试复现。
- [x] **转发服务的房间最长 24 小时，到点房间和恢复令牌一起作废，「离开并保存」的跑团第二天回不去**（**已定：不改**，主人答复，见「需要作者确认」）
  - 位置：`relay/worker.js:138`（`ttl = Math.min(86400, …)`）、`:263` `alarm`（过期后 `deleteAll`）；主持人恢复走 `online-game.js:245` `doResume` → `RelayTransport.resumeHost`。
  - 复现：开房后超过 24 小时（或把 `ROOM_TTL_SECONDS` 设成 60 试），主持人点「恢复上次房间」，得到「房间不存在或已过期」；玩家手里的恢复令牌也一并作废。
  - 应该 / 实际：主持人界面写的是「离开并保存」，存档在本机，但房间码和座位不保存；超过一天就得重新开房、所有人重新加入、重新分配角色。`ROOM_TTL_SECONDS` 还被硬限在 86400，部署时改不了。另外过期是从创建时起算，不是从最后活动起算，连续玩了 24 小时的房间也会被踢。
  - 确认方式：读代码判断。拿不准是不是有意设计（防止占房间），也放进「需要作者确认」。

### 低（9）

- [x] **错误原因映射会把不相干的句子分到错误类别**（已修 #135：映射表整个去掉，原句照给）
  - 位置：`online-view.js:480-496` `safeError` 的正则表。
  - 复现：`safeError("本回合无法移动")` → 「当前不能移动到该区域」（实际是「本回合不能移动」，不是区域问题）；`safeError("目标已失衡，不能再选")` → 「失衡中，无法行动」（说的是目标，不是行动者）；`safeError("濒死中，请先起身")` → 「当前状态不允许该行动」（丢了「先起身」）；`/失衡/`、`/移动/`、`/相邻|移动/` 太宽。
  - 应该 / 实际：该按原句放行或映射到对的类别。
  - 确认方式：测试复现。
- [x] **战场公开记录对玩家不够完整**（已修 #145：移动写去向、用道具写名称和对象、起身写清楚，回合开始带回合数，胜负撤退进记录，不带坚毅数值；回合开始的持续伤害 / 倒下摘要跟在「第 N 回合开始」那一行）
  - 位置：`online-game.js:498` `actionLabel`、`:539-543` `onActionSettled`、`online-view.js:345` `projectLogs`。
  - 现象：移动、起身、用道具在记录里只写「甲 · 移动」「甲 · 使用道具」，没有去哪一区、用了什么道具、对谁；`projectLogs` 认的 `round` / `victory` / `defeat` / `retreat` / `spawn` / `remove` 这些类型主机一条都不产生（只有 `action` / `phase` / `gm`）；`round` 就算产生也只会写「回合开始」，不带回合数（测试里 `{kind:"round",turn:2}` 输出 `"回合开始"`）；回合开始的灼烧、感电等持续伤害、击倒没有单独的行，只能从「被打倒」弹字里看。
  - 应该 / 实际：和单机战斗记录对照，玩家想知道刚才发生了什么。
  - 确认方式：部分测试复现（`round` 文字），其余读代码。
- [x] **按钮灰掉却没写原因（联机单局 / 跑团商店、工匠、诊所、积分）**（已修 #135：按钮旁写「还差 N 奎支 / N 积分」「卖完了」「先选付款人」；转账按钮本来就不按钱灰掉，没改）
  - 位置：`online-ui.js:312`（`shopBuy`：没付款人、钱不够、卖完都只是 `disabled`，只有「卖完了」会改字）、`:314`（`shopRedeem` 积分不够）、`:503-510`（`rogueAct` 的「兑换」「买」「升到 N 级」「治疗」「装上」在 `purse < price` 时灰掉）、`:331`（转账）。
  - 复现：钱不够时点进商店，按钮灰着，旁边没写「还差 N 奎支」。
  - 应该 / 实际：单机商店钱不够会有提示；联机只灰掉。
  - 确认方式：读代码。
- [x] **任务日志面板和背包 / 资料面板共用一个容器，任务更新会把正在看的背包盖掉**（已修 #145：只在容器里还是任务日志时才刷新）
  - 位置：`online-ui.js:626-640` `observeQuests`（`questBoxOpen && !bagBox.hidden` 时重写 `bagBox.innerHTML`）、`openQuests`（:615）。
  - 复现：打开任务日志（`questBoxOpen = true`），不关，直接点「背包」或「角色资料」（`bagBox` 内容换成背包），主持人这时推进一个任务 → 背包内容被换回任务日志。
  - 应该 / 实际：只在任务日志真的显示着的时候刷新。
  - 确认方式：读代码。
- [x] **任务提示一次只提示最后一条**（已修 #145：多条变动合成一句）
  - 位置：`online-ui.js:629-640` `observeQuests`（`msg` 在循环里被反复覆盖）。
  - 复现：一个包里同时有「任务完成」和「新任务」，只弹排在后面的那条。
  - 应该 / 实际：至少合并成一句或排队。
  - 确认方式：读代码。
- [x] **联机玩家单位卡不显示「起身（起身中）」状态，主机卡有**（已修 #135：`projectUnit` 发 `upOnShp` 布尔值，`online-battle.js` 不再写死 false，不发任何坚毅数值）
  - 位置：`online-battle.js:27`（`upOnShp: false` 写死）、`online-view.js` `projectUnit` 不发 `upOnShp`；单机 `unit-card.js:124`、`game.js:2587`、`game.js:4241` 显示「起身 / 起身中」。
  - 复现：我方角色用坚毅起身后，主机卡片有「起身」标，玩家的卡片没有；但夏的角色仪表里的 `back`（= `upOnShp`，`hud-icons.js:269`）会被 `projectHud` 当布尔值发出去——同一个状态夏发、别的角色不发，不一致（这条是读代码推的，没跑）。
  - 应该 / 实际：统一。这是布尔状态不是数值，但涉及坚毅，**先问作者**要不要给玩家看，见「需要作者确认」。
  - 确认方式：读代码。
- [x] **`offlineTick` 的 `ask.options[0]` 没判空**（已修 #145：选项为空就跳过，不再抛错，也不挡回合超时）
  - 位置：`online-game.js:557-560`。
  - 现象：`ask.eligible && ask.kind === "choice"` 但 `ask.options` 为空时（`ownedChoice` 传了空选项，或者选项被 `projectView` 过滤）`option.helper` 抛 TypeError，`setInterval(offlineTick, 250)` 每 250 毫秒报一次，且这个循环到不了后面的「掉线玩家回合超时」逻辑。
  - 复现：没找到真实会产生空选项的技能，没测，属于防御性问题。
  - 确认方式：读代码判断，没复现。
- [x] **转发服务对玩家限速太紧时会直接断线**（已修 #145：先拒绝并回「发送太快」，同一窗口被拒超过 60 条才断开，数值在 `relay/worker.js` 的 `RATE` 常量）
  - 位置：`relay/worker.js:170`（玩家 10 秒内超过 120 帧或 256 KB 就 `close=true` 断开）。
  - 现象：玩家端每一步技能分步都是一次 `actionOptions` 请求，加上聊天、`sheetData`、`messageHistory`，正常使用离 120 帧还远，但页面异常（重复渲染自动请求）时会被服务器直接关连接而不是只拒绝这一条。不确定会不会触发。
  - 确认方式：读代码判断，没复现。
- [ ] **手机宽度（390px）**
  - 位置：`online.css:158`（650px 以下）、`:332-374`（760px 以下）、`:402`（820px 以下）。
  - 现象：没实测。读 CSS 的担心：650px 以下聊天栏占 `38vh` 并把 `.ol-stage` 的 `bottom` 设成 `38vh`，而 760px 以下又有「收起成一条」的 `ol-side-folded` 规则，两套规则在 651–760 与 ≤650 之间怎么叠没验证；`.ol-battle .g-field` 最小高度 380px + 技能栏 `position: sticky`（>820px）。需要有人在 390px 实机看一遍战斗画面、商店、联机单局任务板。
  - 确认方式：读代码，**未实测**。

### 补查（#157）：主持人界面 / 热座 / 联机战斗画面

范围：`online-gm-ui.js`、`hotseat-ui.js`、`hotseat-authority.js`、`hotseat-validation.js`（连带读了 `hotseat.js`、`hotseat-game.js · validate`、`gm-commands.js`）、`online-battle.js` 全文、`online-ui.js` 640 行以后。**只排查没改代码。**
确认方式：「测试复现」= 写了临时 `node --test`（`tests/headless.js` + 真实 `HotseatValidation`）跑过，**临时测试没提交**；「读代码」= 只读没跑。环境没装 Playwright，**界面类（主持人面板、热座卡片、战斗画面）全是读代码，没在浏览器里点过**。
坚毅生命（shp）：这批文件里没有找到把具体数值发给玩家的路径。`online-battle.js · snapUnit` 把 `shp` / `shpMax` 写死成 0；临时测试里对 4 名角色跑 `SkillText.sheetData()` → `OnlineView.projectSheets`，结果里没有坚毅数值（只有一句规则说明「濒死并且起身……」）；主持人面板只在 `view.isHost` 时挂载，写着「坚毅生命（仅主持人）」的字段玩家端看不到；主持人改单位写进公共记录的只有「主持人更新了单位数据」。要留意的一点：`projectSheets` 的 `scrubHidden` 只按**键名**去掉，不看文字——以后哪个说明文字里拼进了坚毅数值就拦不住。
联机单局（rogue）没有主持人，主持人面板不挂载，下面的主持人条目都只针对联机跑团。

#### 高（0）

没找到能确认的「卡死 / 数据泄露」级问题。

#### 中（5）

- [x] **联机的移动校验把消耗写死成「1 附赠」，和单机 `moveBaseCost` 不一致：导体 / 探测模式 0 附赠被拦，酸液地面离开反而要求附赠和行动点都有**
  - **已修（#176）**：`descriptor` 的 `__move` 改用 `moveBaseCost`，越过空隙另按 1 行动点（`voidMoveCost`）；测试 tests/hotseat-validation.test.js。
  - 位置：`hotseat-validation.js:47`（`__move` 的 `cost: { bonus: 1 }`）、`:169-185` `checkMove`；单机 `app.js:137` `moveBaseCost`、`:4501-4514` `doMoveInner`；技能栏的消耗标签走 `game.js:589`（用 `moveBaseCost`），灰掉的原因走校验（`online-actions.js:63`）。
  - 复现（测试复现）：角色（测试用瑞比）设 `self = "conductor"`、`bonus = 0`、走到相邻区 → 校验报「附赠行动不足」；单机 `moveBaseCost` 返回 `{}`（导体 / 探测模式下移动不耗附赠）。站在酸液地面、`bonus = 0`、`ap = 2` → 校验报「附赠行动不足」，`moveBaseCost` 返回 `{ ap: 1 }`，单机 `doMove` 能走，扣 1 行动点。
  - 应该 / 实际：应该和单机一样——导体 / 探测模式免费，离开酸液地面只耗 1 行动点（荒原行者 / 酸液地面行者例外）。实际联机玩家技能栏上「移动」的消耗标签写「行动点」，同时灰掉、原因写「附赠行动不足」；导体角色用光附赠就不能移动。空隙同理（单机只扣 1 行动点，联机还要有 1 附赠）。
  - 确认方式：测试复现。
- [x] **深渊的方向判反了：联机拦的是「从深渊走出来」，放行「走进深渊」**
  - **已修（#176）**：`checkMove` 改按目的区 `fields[dest].abyss` 判断，和单机一致。
  - 位置：`hotseat-validation.js:175-176`（取的是出发区 `fields[from]` 的 `abyss`）；单机 `app.js:4461-4464`（取目的区 `toF.abyss`，注释写「万一站在里面，可以走出来」）。
  - 复现（测试复现）：地面单位在 1 区、2 区是深渊，走 2 区 → 校验通过，单机 `doMove` 拒绝（「深渊不能站人」），单位没动；地面单位在深渊 2 区走 1 区 → 校验报「深渊只有飞行单位才能通过」，单机 `doMove` 能走。
  - 应该 / 实际：联机玩家点「移动」选深渊区，指令被接受、主持人那边记录一条移动，但单位没动；被推进深渊后留下的地面单位联机走不出来。（被推进去通常会坠落，所以后一种少见。）
  - 确认方式：测试复现。
- [x] **校验漏了「被沙珊瑚缠住」和「流沙下陷 2 层以上」：指令被放行，执行时被规则层拒绝，玩家看到的是成功**
  - **已修（#176）**：`checkMove` 加 `entangled` / `sinkStuck` 校验，原因用单机日志同一句回给玩家。
  - 位置：`hotseat-validation.js:169-185` `checkMove`（没有 `entangled`、`sinkStuck`）；单机 `app.js:4467-4476`。基础校验里只有 `sinkLocked`（3 层）。
  - 复现（测试复现）：`unit.entangled = {…}` 或下陷 2 层（`QUICKSAND.stuckAt = 2`）→ 联机校验通过，单机 `doMove` 拒绝，位置没变。
  - 应该 / 实际：应该在校验里直接回原因（「被……缠住了，动不了」「下陷 N 层，自己走不出流沙」），玩家端技能栏上灰掉。实际指令返回成功，单位没动，单机写的原因只进主持人的战斗记录，玩家端看不到。是否还写了一条「甲 · 移动」的公共记录，读代码没看清（`online-game.js` `onActionSettled`），没确认。
  - 确认方式：测试复现（校验通过、单机拒绝）；玩家端看到什么读代码，未实测。
- [x] **（已定：不做，主人 2026-10-21 在 #186 决定「不用」二次确认 / 撤销）主持人在联机里没有撤销，而面板上最危险的几个按钮没有二次确认**
  - 位置：`hotseat-game.js:162`（`undo` 一律「热座不能撤销」）、`game.js:400` `canUndo`（`!hotseat()`）；`online-gm-ui.js:64`「击杀」「移出」、`:86`「移除配置物」「摧毁配置物」、`:97`「安排攻击」、`:82`「应用单位修改」，点击直接 `send`。
  - 复现：读代码。单机跑团主持人可撤回 10 步（`game.js:387`），联机主持人点错「击杀」「移出」就收不回；「击杀」会结算死亡效果 / 奖励，「摧毁」会引爆。
  - 应该 / 实际：联机没有撤销是已知的设计；但至少危险按钮该有一次确认（`online-ui.js` 里已有 `askConfirm` 的样式可参考），或者给「移出 / 击杀」之类写清楚后果。实际现在一点就执行。
  - 确认方式：读代码。要不要补确认、补什么，放进「需要作者确认」。
- [x] **热座（同一台设备）里协助询问有 20 秒倒计时，而且不会自动切到该回答的操作员（#186 已修：主人定「去掉」。热座的询问不限时，和单机一样等人回答——`hotseat.js · openAsk` 的 `untimed`；联机的 20 秒和掉线兜底 `offlineTick` 不变；自动切操作员没做，主人没要求）**
  - 位置：`hotseat.js:425`（`deadline: now + 20000`）、`:430` `tick`（到时间 `timeout`）；`hotseat-ui.js:164`（当前操作员不是被问的人时只写「正在等待某某回应」）、`:119`（切操作员要手动用 `#hs-player`）。
  - 复现：读代码。本机两人轮流，A 的角色打出失衡 → 询问发给 B 的单位；屏幕仍是 A 的视角，卡片上只有倒计时和「正在等待 B 回应」，要自己去顶栏换成 B 再点「我来」。20 秒没点就当作不协助（`askTimeout`）。
  - 应该 / 实际：联机时每个人各用各的设备，20 秒合理；同一台设备要传手柄、换视角，20 秒容易错过，错过就静默放弃协助。单机的协助询问没有倒计时（`game.js` 里没有 `deadline`）。建议热座（非联机）不限时，或者询问一出来就提示 / 自动切到被问的操作员。
  - 确认方式：读代码。

#### 低（9）

- [ ] **主持人面板：焦点在带 `id` 的输入框里时，面板不跟着状态更新；焦点在没有 `id` 的元素上时，任何推送都会重画并清掉填了一半的表单**
  - 位置：`online-gm-ui.js:107`（`if (open && focused && !busy && …) return;` 只看 `document.activeElement.id`）。
  - 复现：读代码。「安排攻击」页填了倍率、固定伤害，再点「波及其他单位」的复选框（`name="ogm-hit"`，没有 `id`）→ 焦点 id 为空 → 之后玩家那边来一次推送（聊天、断线重连）`render()` 重画，已填的数字全部回到默认值，勾选也没了。反过来，焦点停在某个下拉框上时，「在场敌人」「行动 / 附赠」这些读数不更新，「敌人回合手动阶段开始」后「执行技能」仍灰着，直到点别处。
  - 应该 / 实际：填写中的表单应该保留；读数应该更新。注释写的是「Preserve the pending form」，但实现只覆盖了带 `id` 的控件。
  - 确认方式：读代码，没实测。
- [ ] **主持人面板：点任何一个按钮都会校验当前页所有输入框（`reportValidity`），「击杀」「移出」会被「生成敌人」的输入挡住**
  - 位置：`online-gm-ui.js:117`。
  - 复现：读代码。「敌人」页把「数量」改成 0 或在「血量水平 %」里填 5.5，再点某只敌人的「击杀」→ 浏览器弹校验气泡，指令没发出。
  - 应该 / 实际：只该校验这条指令用到的输入。
  - 确认方式：读代码。
- [ ] **主持人面板：执行敌人技能 / 移动 / 安排攻击后面板自动关闭**
  - 位置：`online-gm-ui.js:119`（`["gm.enemyAct","gm.forceAttack"].includes(type)` → `open = false`）。
  - 复现：读代码。手动控制 3 只敌人、每只 2 个动作，要重新点开「主持人工具」约 6 次。目的是不挡住玩家的反应询问（协助 / 格挡），但没有询问时也关。
  - 应该 / 实际：只在真的弹出询问时才收起。
  - 确认方式：读代码。
- [ ] **换房间不重置「商店开张」「大字」的记录，新房间第一次提示可能误弹或被吞**
  - 位置：`online-ui.js:754-763` `observeShop`（`shopSeen` 在 `render()` 换房间那段（:910-914）里没清）、`:815-819` `playTitle`（`titlePrimed`、`lastTitle` 同样没清）。
  - 复现：读代码。同一个页面里先退出房间 A 再进房间 B：`shopSeen` 还是 A 的商店编号，B 第一个包里的商店编号不同 → 误弹「开张了」；`lastTitle` 是 A 的 `title-1`，B 主持人发的第一条大字编号也叫 `title-1`（`hotseat.js:163` 每个房间从 1 数起）→ 被当成已播过，**这条大字不显示**；`titlePrimed` 已经是 true，进房时 B 里已经有的旧大字会补播一次。
  - 应该 / 实际：任务（`questSeen`）和长休（`restSeen`）已经在换房间时重置了，这三个漏了。
  - 确认方式：读代码。
- [ ] **战斗画面的数字键 / 空格在弹窗开着时仍然生效**
  - 位置：`online-battle.js:339-351` `onKey`（只判断 `el.isConnected` 和输入框，不看有没有弹窗）。
  - 复现：读代码。轮到自己时打开背包 / 任务日志 / 掷骰窗口，焦点在窗口里的文字上（不是按钮、输入框），按数字键 → 战斗画面选了技能；按空格 → 结束行动（有一次确认）。「结束行动」确认框开着时按数字键，会在框后面开始选技能。
  - 应该 / 实际：弹窗开着时战斗快捷键应该让出来。提示栏文字「选择技能（1–9）。悬停技能看说明，空格结束行动」在触屏上也没有意义。
  - 确认方式：读代码。
- [ ] **队伍栏的角色按钮点了没有任何反应**
  - 位置：`online-battle.js:231`（渲染成 `<button data-ob-unit>`，`title` 是「你的角色 / 队友」），`:297-308` 点击处理里没有处理 `data-ob-unit`。
  - 复现：读代码。点队伍栏的角色名，什么都不发生；按钮样式有悬停和可点的外观。
  - 应该 / 实际：要么做成「点一下在战场上高亮这个角色」，要么改成不可点的元素。
  - 确认方式：读代码。
- [ ] **中立生物（沙漠）在联机玩家画面里画成整张敌人卡，下潜的也不收起**
  - 位置：`online-battle.js:22-41` `snapUnit`（没有 `neutral` / `neutralTags` / `submerged` / `leaveIn`）、`:207`（只分玩家 / 敌人两排）；单机 `game.js:176-186`、`:694`、`:736` `paintSandStir`（迷你名牌、下潜的折进区角「沙下动静」）。
  - 复现（部分测试复现）：临时测试里 `dust_bug` 设 `submerged = true` 过 `OnlineView.projectUnit`，`submerged` 保留（技能说明徽章里能看到「下潜」），`isNeutralCreature` 为真；但 `snapUnit` 不用它。其余读代码。
  - 应该 / 实际：夜晚下潜的尘虫在单机里不画名牌，只显示「沙下动静 ×N」；联机玩家看到的是普通整卡（带一个「下潜」徽章），没有「已发现 / 摊平」标签，也没有「几回合后离开」。沙漠遭遇才会碰到，只影响显示，规则上玩家选不中下潜的单位。
  - 确认方式：读代码 + 部分测试（投影保留 `submerged`）。没在浏览器里看。
- [ ] **主持人面板的状态下拉和单机后台比有缺项；联机主持人是否还能用单机的单位编辑器没确认**
  - 位置：`online-gm-ui.js:14-15`、`:66-83` `unitMarkup`；单机 `app.js:1085-1175` 单位编辑器（即时效果：熔融 / 刺骨 / 过载 / 错位 / 扩散 / 折射、「结算中和」、挂下一击的属性专属攻击效果、改名、加一层血量、复制单位、回满架势）。
  - 现象：联机面板没有这些。`hotseat-game.js:158-163` 对主持人放行了 `calc` / `backstage`（跑团模式），所以主持人很可能还能用主界面里的单机编辑器——但没在浏览器里确认，也没确认这些改动会同步给玩家。
  - 确认方式：读代码，没实测。放进「需要作者确认」。
- [ ] **`hotseat-ui.js` 的「我来 / 不协助」靠按钮下标取选项，选项刷新的瞬间点击会取到别的选项或 `undefined`**
  - 位置：`hotseat-ui.js:264-268`（`(view.ask.options || [])[Number(b.dataset.option)]`，按钮上本来就带着 `data-helper`）。
  - 复现：读代码，没复现。`render()` 先更新 `view` 再重画 DOM，两者之间点到旧按钮、而选项数组已变短，`selected` 为 `undefined`，点「我来」时 `selected.helper` 抛错，函数是 `async`，没有人接，面板上没有任何提示。
  - 应该 / 实际：直接用按钮上的 `data-helper`，并且 `try/catch` 后写进 `notice`。
  - 确认方式：读代码判断，窗口很窄，没复现。

### 补查：390px 手机实测（2026-10-21，Chromium 真转发房间：主持人 1440 宽 + 玩家 390×844）

大厅 / 探索 / 选行动顺序 / 我方行动四个画面都没有横向溢出、没有页面报错。

- [x] **中 · 玩家战斗画面的战场框太矮**（已修 #176：≤820px 战场框 `min-height: 50dvh`，选目标时自动滚到目标所在区；tests/online-ui.test.js；浏览器测试在修复环境里没装 Playwright，未跑过）：`.ol-battle .g-field`（`.ol-field`）在手机上只有约 209px 高，内容约 730px、框内滚动；一次只看得到一个区的一部分，敌人要在小框里往下滚才看得到。
  - 应该：手机上战场框更高（例如占屏幕一半），或按区横向切换 / 选目标时自动滚到目标所在区。
  - 确认方式：浏览器实测（截图）。
- [x] **低 · 触屏上的提示写「悬停 / 空格」**（已修 #176：`OnlineBattle.isTouch()`，触屏写「点技能看说明」、结束行动不显示「空格」）：技能栏下方「选择技能（1–9）。悬停技能看说明，空格结束行动」，结束行动按钮下写「空格」；手机没有悬停和空格键。应该：触屏设备换成「点技能看说明」、不显示快捷键。确认方式：浏览器实测。
- [x] **低 · 选行动顺序弹层边缘透出底下的字**（已修 #176：联机里 `.hs-overlay` 背景改不透明）：弹层上下边缘能看到底下战斗画面的「第 1 回合」「等待开始」。确认方式：浏览器实测。

#### 校验对照小结（`hotseat-validation.js` vs 单机）

- 已抽测：41 个技能（`skillList` 里能列出的玩家技能，不带目标、不带分步选择提交）里 17 个校验通过，执行后全都扣了点数，没发现「校验过了但是空操作」；`needsTarget` 的手写名单没有发现缺项（样本小，不代表名单完整，以后加技能时要同步这份名单）。
- 起身（`standUp`）与单机 `standUpBlocked` 一致；道具（`checkItem`）没有逐件对照，只读了流程。
- 联机能做、单机不能做的：没找到。单机能做、联机被拦的：上面「中」的前两条之一（导体 / 酸液移动），以及深渊走出。

### 需要作者确认

主人的答复（#135）：
- **道具说明里的坚毅数值**（`ledger.js:20-27` 食物 / 睡袋说明里的恢复量，经 `projectBagDetail` 发给玩家）：**保留**。
- **起身状态（`upOnShp`）要不要给联机玩家看**：**给玩家看**，已改（#135，见上面「低 · 起身状态」那条）。只发布尔值。
- **房间 24 小时上限**：**已定：不改**。
- **房主只能在原浏览器恢复**：**不做移交**。
- **联机单局投票要所有在线的人都投**：**改**——只算有角色的人，旁观者不算票也不用等；界面写「需要 X / Y 人投票」。已改（#135，`online-rogue.js · voterIds`）。

补查（#157）新增的待确认（主人 2026-10-21 在 #186 已全部决定）：
- 联机主持人面板的「击杀」「移出」「摧毁配置物」「安排攻击」要不要加二次确认（联机没有撤销）：**已定：不做**。
- 联机跑团玩家没有武器升级 / 工坊 / 商人的入口：**已定：是 bug，补上**（#186 已改）。联机单局本来就有；联机跑团商人本来就有，补了武器升级和工坊（主持人开放开关 + 玩家自己操作，钱从这名角色的钱包出）。跑团里「学配方」仍由主持人教，玩家端只看。
- 热座（同一台设备）的协助询问是否取消 20 秒倒计时：**已定：去掉**（#186 已改）。
- 联机主持人在跑团模式下的单位编辑器：**已定：统一成单机那套**（#186 已改，联机面板补齐了名称、即时效果、挂攻击效果、加 / 删层、层类型、中和、回满架势、复制单位）。

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

第三轮（单机，2026-10，都是读代码判断）：
- 任务奎支报酬按完成时人数算（`rogue.js:458` · `completeTask`），水和物资按接任务时人数发，中途死人报酬少 1/n
- 守夜者不恢复，但全队力竭小时数（`LEDGER.hours`，`ledger.js:759-761`）被清零，守夜者的力竭也清零；README 守夜段没提力竭
- 单局 `run.day` 与 `LEDGER.clock` 各走各的（`rogue.js:2642` · `advanceDays`），短休次数两处都刷新
- 长线养成每日任务按真实日期换题，跨 0 点进度清零（`rogue.js:2537` · `growthDailyKey`），同「每日挑战用本机日期」
- 每日挑战统计只在打完 / 全灭时写（`rogue.js:2722`），中途放弃不计，选取率有幸存者偏差
- 专长选项缓存键是「角色:已有专长数」（`rogue.js:2753` · `dailyFeatOffer`），同时欠两项专长时共用一组选项；正常 UI 流程碰不到
- 眼尖 / 舌灿莲花的优势直接盖掉劣势（`feats.js:139`、`215` 写 `adv = true; dis = false`），`party.js:590` 约定「优劣相抵」
- 拾荒者额外战利品固定按「普通战斗」档掷、不掷材料（`rogue.js:976-978`），精英 / 首领战是否沿用那一档
- 跃迁 / 推搡 / 勾索的位移走 `displaceTo`，不触发离开区域的借机（`app.js:4340`）
- 荒野向导「旅行时间 −1/3」只接了单局 `travelHours`（`rogue.js:493`），跑团路线估时（`world-travel.js`）没接
- 涉猎专长「每场 2 次以上 → 每场 1 次」的归类是否符合 `feats.js` 文件头的次数规则
- 维修工具包修好的武器人同一场再倒下不再扣 −2（`items.js:344-359` · `useRepairKit` 没清 `_durCounted`），README「被击败 −2」是每场一次还是每次倒下？
- 「全员复原」（`ledger.js:788-803`）除回满外还复活死人、清短休 / 长休一次技能，但不刷新 `shortOnce`、力竭时数、义体短休次数，范围是否有意
- 后台改「距上次长休」不触发 80 小时力竭致死，小数被取整（`trpg.js` · `trpgBackstageApply` 的 `edit.hours`）
- 短休次数上限读 `u.note` 里的「熊」不读种族资料（`ledger.js:69` · `shortRestCap`），以后只写 `HERO_PROFILES` 会漏
- 榴弹机甲喷火协助 `en_gl_assist` 没有 `aoe` 标记，每人单独一击、可被协助格挡、同区打不到；图鉴写「对目标所在区 atk/2」
- 亡命之王「处死命令」擒拿（50%）不看这一击是否打中（`en_king_kill`），`en_dump` / `en_watch` / `en_giant_sand_vortex` 已改成打中才上
- 危墙倒塌（`destroyGap` 传 `flags.environment`）打得到下潜单位，爆炸桶 / 电池打不到（`app.js:7774`）；README 1035 没写危墙倒塌
- 赤牙「剿灭」的「可立刻免费移动一次」只写在日志里没给移动（赤牙手动操作）
- `en_bigsand_summon` 召唤的沙灵不记 `summonedBy`，战后材料掉落会计入；飞碟技能召唤的看守不掉（`rogue.js:1062`）
