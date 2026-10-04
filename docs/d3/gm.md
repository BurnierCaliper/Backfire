# D3 主持人规则和工具面板

`gm-commands.js` 注册 14 个 `gm.*` 指令。输入经 `Commands.validate` 做严格 JSON 往返；模块只信任房间通过 `configure({requireHost})` 注入的私有身份上下文，不接收指令内的主持人声明。全部参数检查先于状态修改。房间负责串行排队、演出、玩家协助询问及 AI / 手动阶段协调。

## 指令参数

所有指令支持可选布尔值 `silent`，缺省为 `false`。执行返回 `{publicSummary, notes, ...}`：前者是可公开的普通文本，静默时为 `null`；`notes` 包含主持人详情，不能广播给玩家。旧规则产生的详细日志也被捕获到 `notes`，由房间决定使用公开记录的安全模板。

| 指令 | 数据 |
| --- | --- |
| `gm.spawnEnemy` | `enemyId, level, zone, count?`；从既有敌库生成，返回 `ids, eligibleEnemyRound` |
| `gm.removeUnit` | `actor, mode: "remove" / "kill"`；仅敌人 |
| `gm.editUnit` | `actor, patch`；单位任何一方 |
| `gm.addProp` | `kind, zone, level?, faction?, link?` |
| `gm.editProp` | `id, patch`：`zone, level, faction, link, hp, maxHp, movable` |
| `gm.removeProp` | `id, mode: "remove" / "destroy"` |
| `gm.editGap` | `key, patch`：`type, hp, maxHp, open, level, lastFrom` |
| `gm.setField` | `zone, patch`：既有 `emptyField()` 字段，主场地效果互斥 |
| `gm.setWeather` | `weather?, sandDir?, phaseStep?, lock?` |
| `gm.setEncounter` | `encounter?`（既有遭遇编号）、`zoneMode?`；只能战前调用，编号通过房间的 `setEncounter(cmd,context)` 执行既有设置流程 |
| `gm.forceAttack` | `input`：原后台的显式 `dmAtk / dmTgt / dmEle / dmMult / dmSplash / dmFlat / dmBrk / dmSplashBrk / dmDiceN / dmDiceS / dmSkipBlock / hits` |
| `gm.setManual` | `actors: "all" / [敌人编号], enabled` |
| `gm.enemyAct` | `actor, action: "move", dest`，或 `actor, action: "skill", skill, target?, picks?` |
| `gm.enemyEndTurn` | 无额外参数；调用房间 `enemyEndTurn(context)` 协调钩子 |

单位补丁支持 `layers`（与当前层数一致的 `{current?,max?}` 数组）、`hp`（最内层当前生命的简写）、`shp/shpMax`、`def/defMax`、`ap/apMax`、`bonus/bonusMax`、`atk`、`level`、`zone`、`statuses`、`self`、`highEnergy`、`flying`、`stun/stunned`、`dying`、`dead`。`hp` 与 `layers` 不能混传；未知字段拒绝。当前生命/坚毅/架势/行动点超过对应上限时夹到上限，负数直接拒绝。等级为 1–25，行动点和附赠行动及其上限为非负安全整数；一次生成最多 100 组，安排攻击最多 1000 颗骰子，限制只作用于这条新增输入边界。

`atk` 编辑个人攻击基础值，同时更新旧缓存字段，仍由既有武器与状态公式计算实际攻击。面板明确标示“个人 ATK”。将敌人的最内层生命归零或设为倒下会经过正常击杀结算；需要无死亡效果离场时使用“移出”。`dead:false` 沿用既有复活函数；已结算过的敌人保留 `_xpGiven`，不会复活刷取同一份奖励。

## 生效与结算

- 战前生成允许首个敌人回合行动；玩家回合生成允许本轮即将开始的敌人回合行动；敌人回合中生成必须等下一轮。权限侧车记录 `eligibleEnemyRound`，不向原单位或旧存档增加字段。
- “移出”直接解除战场成员关系，无击杀、经验、掉落、自爆等死亡效果。移出飞碟本体同时移出关联机械足。“击杀”复用 `settleEnemyKill` 和 `sweepDeadEnemies`；爆炸桶等的“摧毁”复用 `destroyProp`。
- 手动动作只接受该敌人当前技能表中的主动技能；校验敌人回合、手动开关、生成时机、失衡、行动预算、移动阻挡、射程和分步选择，再调用既有 `BattleCommands.execute` / `runSkill` / `doMove`。
- 杂兵移动消耗行动点，精英/首领通常消耗附赠行动；酸液等例外沿用现规则。赤牙技能文字与原 `runSkill` 扣点存在历史差异，此阶段保持实际原规则，不解析标签另加费用。
- 全体手动开关也作用于未来生成的敌人；指定敌人可以覆盖全体默认。切换不补充点数。房间在敌方 AI 循环和手动结束协调时重新读取开关。
- `snapshot()` / `restore(data,context)` 保存临时侧车，恢复也要求私有主持人上下文；房间可以放入新的在线会话快照，原 TRPG 存档格式不变。`reset()` 用于新房间/重置，`beginEnemyRound` / `enemyMayAct` / `isManual` 供房间驱动读取。

## 界面和验证

`OnlineGMUI.mount({getView,submit,subscribe})` 只在 `active && isHost` 时创建浮动工具面板，没有自动启动逻辑。`getView()` 提供主持人的完整 `state`；工具表单只读现有规则列表，所有写入均提交序列化指令。普通玩家不会创建这套 DOM。敌人动作与安排攻击提交后收起面板，避免遮住既有玩家协助弹框。

新增规则测试覆盖身份伪造、非法混合补丁无突变、登场时机、真实自爆死亡与移出、飞碟整包移出、真实配置物效果、静默日志、SHP、预算/射程/技能分步、临时快照、手动开关和有效攻击基础。新增 Chromium 组件测试覆盖权限可见性、表单 JSON、静默默认、分步技能、私有数据提交、HTML 注入、错误显示及 390px 布局。房间网络、动画和实际多人协助的整体协调由 D3 集成测试另行验证。
