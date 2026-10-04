# D1：本地指令入口

本期基于 `main`，开发分支为 `feat/online-d1-commands`，对应 [PR #2](https://github.com/BurnierCaliper/Backfire/pull/2)。需求以 [联机 PRD v1.1](../PRD-online.md) 和作者确认的 D1 范围为准；实现前登记的完整入口清单在 [PR 描述](pr-description.md)。

## 调用约定

```js
dispatch({ type: "skill", actor: unit.id, skill: "技能 id", target: target.id, picks: {} });
dispatch({ type: "run", action: "acceptTask", which: "main" }, { run });
dispatch({ type: "trpg", action: "adjustKuizhi", amount: 100, why: "任务报酬" });
```

`cmd` 只能包含 JSON 数据，进入处理器前会复制。禁止函数、DOM、循环引用、非有限数值、访问器及未定义值。未知指令和未知动作均拒绝；调用方不能指定任意函数名或属性路径。同步规则仍同步返回，异步适配仍返回 Promise，规则异常原样交给原界面处理。

第二参数 `context` 是本机持有的完整会话或适配器，包括当前 `run`、战斗入口、保存/恢复接口等。它不属于可序列化载荷，也不允许由未来网络客户端提供。跨指令依赖的状态属于完整权威状态，不能用玩家显示视图替代。D1 日志是诊断记录，并非自足的存档或跨版本回放文件；复现需相同初始状态、种子和规则版本。

## 指令表

| 类型 | 内容与执行位置 |
| --- | --- |
| `skill` / `move` / `standUp` / `useItem` | 单位 id、目标 id、技能及完整分步选择、目的区、物品；`battle-commands.js` |
| `startCombat` / `openingChoice` / `endTurn` | 开战、原开场选择、结束我方回合；`endTurn` 与 `battle.endPlayerTurn` 使用同一规则 |
| `blockAnswer` / `assistAnswer` / `koltSwapAnswer` / `retreat` | 原反应、取消和撤退回答；不改变提示及演出顺序 |
| `battle.*` | 敌方逐步执行、回合衔接、奖励结算、战后处理、模式建立、撤销、继续；`BattleCommands.types` 列出实际类型 |
| `battle.panel` | 原背包、休息、时间、存档槽、队伍、敌人、场地、配置物和遭遇；`BattleCommands.panelActions` 为白名单 |
| `run` | Roguelike 决策；`RogueCommands.actions` |
| `run.query` | 原查询中的惰性补写与临时单位计算，保持原调用顺序和随机数消耗；`RogueCommands.queries` |
| `run.session` / `screen` | 选队、开局/续局、保存、战斗协调、结束与原画面导航；`RogueCommands.sessionActions`、`screens.js` |
| `trpg` / `trpg.ui` | 探索规则和存档/模式协调；`trpg-commands.js`、`trpg-ui.js` |
| `backstage` / `calc` | 既有后台、计算器与配置面板；字段和动作白名单在 `trpg-commands.js` |
| `orderMove` / `orderSwapAccept` | 仅登记为 D2 保留类型；D1 调用会拒绝，不执行调序 |

`Commands.catalog()` 可读取当前装载页面的类型表。规则执行由处理器负责，按钮只收集参数和处理原交互反馈。战斗预览继续在原快照沙盒内执行并恢复，不向正式指令日志写入预览；悬停、打开面板、未提交输入等展示行为保持原样。

## 权威状态与显示视图

`Commands.projectView(authority, projector, recipient)` 先复制完整状态，再调用显式的接收人投影函数，返回值也脱离权威引用。通过该接口产生的视图不能直接作为 `dispatch` 的执行上下文。该约定用于分离职责，并不是网络鉴权实现。

D1 不做隐藏信息过滤，也不发送任何状态。D3 必须对 **结果、演出事件（含 `tape.pop.snap`）、战斗日志、重同步和私信历史** 全部按接收人生成视图；规则结算始终使用房主完整状态。客户端显示数据不得送回规则层继续计算，本地完整调试日志也不得作为玩家广播内容。

## 单位归属接口

`Commands.unitRoster(units, assignments, previousUnitIds)` 接受「单位 id → 操作者 id」映射，返回每个在场且分配操作者的单位。一个操作者可对应任意多名角色及武器人；武器人沿现有 `weaponOf` 的主人角色代号（也兼容单位 id）继承操作者。隐藏、移出或已死亡的单位不作为在场可操作单位返回。可选的 `previousUnitIds` 以单位 id 保留已有位置，移除离场单位，并把新上场单位追加到末尾；整个接口只返回临时数据，没有向角色、单局或存档写入新字段。

此接口只生成在场可操作名单，不实现顺序格子。D2 按 PRD v1.1：角色和已上场武器人各占一格，主持人代操作单位同样占格；中途上场武器人追加，离场移除。扣过行动点或附赠行动（包括协助格挡）及完成行动的格子锁定；其余单位只能调到固定格之后，空位直接移动，跨操作者互换需同意，跑团主持人可直接调整。必须以实际扣点事件判定，不能用选技能、预览或取消判定。

## 调试和验收

打开 `game.html?debug=1` 或 `index.html?debug=1`，展开左下「本机调试」，点击「导出指令日志」。导出 JSON 包含最近 1,000 条指令、执行结果摘要或错误及序号。记录仅在当前页面内存中，刷新清空；不改变游戏存档，也不上传。

新增测试覆盖核心边界、固定种子的完整战斗/单局流程与旧直接调用等价、JSON 往返、跑团/后台/面板以及真实浏览器下载。原测试断言保持原样。验收运行 `npm test` 与 `npm run test:ui`；后者缺少浏览器时失败，不能用跳过代替通过。大体积日志、截图及导出数据通过本目录 `.gitignore` 排除。

D1 合并后才开始 D2，每阶段单独 PR，由作者评审合并。D3 在线跑团、D4 合作单局按该顺序进行。

### 最终验收记录（2026-10-03）

实现提交 `ad1d544`，基于 `main` 的 `1e781c8`。新增 52 项测试，既有测试文件的断言未修改。

- `npm test`：368 项，367 通过，1 项为原有禁用专精测试的跳过；无失败。
- `npm run test:ui`：真实 Chromium 执行 38 项，全部通过，无跳过。包括实际 JSON 文件下载、选目标后才提交技能、单局开局和计算器配置。
- 固定种子完整战斗、单局流程及 JSON 往返等价；专项覆盖既有跑团、后台、配置面板和八组真实单人/多人开战配置。
- 原评分/数值数据与存档模块未修改；新增文件最大约 20 KB，测试日志及导出文件未提交。
