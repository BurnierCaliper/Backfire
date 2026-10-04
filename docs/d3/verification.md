# D3 验收记录

基线：D2 合并后的 `main`（`04e9ef2`）。所有 D2 及更早测试断言保持原样。新增测试分为规则、协调、投影和实际浏览器链路；模拟适配器的测试不会作为公网证据。

## 环境与命令

Windows、Node.js 24、Playwright Chromium，Cloudflare 本地测试使用真实 Miniflare/workerd 和 SQLite Durable Objects。先执行 `npm ci --prefix relay`，再执行 `npm test` 与 `npm run test:ui`。本次设置 `REQUIRE_UI=1`，缺少浏览器即失败；Playwright 来自环境已有安装，未将依赖目录放入仓库。

2026-10-04，完整运行结果：

| 检查 | 结果 |
| --- | --- |
| `npm test` | **570 项，569 通过、0 失败、1 项原有跳过**（`ROLE_PATH_CHOICE` 未开启），约 215 秒 |
| `npm run test:ui` | **77/77 通过，0 失败、0 跳过**，约 214 秒 |
| `npm --prefix relay run check` | Wrangler dry-run 通过；18.67 KiB / gzip 5.63 KiB，未部署 |
| 原测试与文件检查 | 原有测试断言未修改；新增文件最大约 50 KB，未提交依赖、构建产物、截图或缓存 |

相比 D2 新增 120 项测试，其中 23 项为真实浏览器测试。

## 证据范围

| 检查 | 自动测试 |
| --- | --- |
| 转发身份、房间人数、协议版本、重连令牌、限流、分片、SQLite 进程重启 | `tests/relay.test.js` |
| 三个隔离 Chromium 会话、真实 WebSocket、30 秒房主断线及刷新恢复、390px | `tests/relay-ui.test.js` |
| 真实 `game.html` 三端开房、分配、越权拒绝、分步召唤、4v3 行动、混合 AI / 手动敌人、结算和原槽返回探索、询问中房主刷新 | `tests/online-session-ui.test.js` |
| 主持人增删改、合法点数、移出与正常死亡、生成时机、队列和旧后台入口 | `tests/gm-commands.test.js`、`tests/online-legacy.test.js`、`tests/online-host.test.js` |
| 原始结果、快照、日志、错误、重同步和私信过滤；只读菜单、差异编码不接触权威状态 | `tests/online-view.test.js`、`tests/online-actions.test.js`、`tests/online-wire.test.js` |
| 序号与去重、动画中重同步、旧异步任务失效、断线 RPC 不重发 | `tests/online-coordinator.test.js`、`tests/online-ui.test.js` |
| 顺序锁与武器稳定身份恢复、询问剩余时间/已拒绝回答/掉线暂停、完整消息历史及按收件人分页 | `tests/online-recovery.test.js`、`tests/online-ask-recovery.test.js`、`tests/online-history.test.js` |
| 手机视口布局、输入保留、物资/天气/结算显示、消息分页、UI 不访问规则入口 | `tests/online-gm-ui.test.js`、`tests/online-ui.test.js` |

体积测试按收件人统计完整动作产生的逻辑 DTO，测量点在投影和差异编码之后、转发分片之前，同时断言单包与整动作合计均不超过 50 KiB。没有用分片后的小帧冒充动作体积达标。

最近一次三端定向运行中，4v3 双击攻击每名玩家接收合计 27,381 B，最大单包 11,299 B；移动合计 24,183 B，最大单包 8,101 B。消息编号和姓名长度可能使字节数略有变化，测试直接约束上限。

询问中刷新使用真实后台攻击：一名玩家先拒绝，等待 2.2 秒，房主刷新并从本机保存恢复；剩余倒计时没有重置为 20 秒，已拒绝者仍拒绝，新编号阻止旧回答。另一名玩家回答后仅结算保存的那一击，攻击编号未增长、附赠行动仅扣一次、顺序格锁定。没有通过改时间或改存档数据制造浏览器通过结果。

## 待公网和设备验收

- 尚未部署公网转发服务；Cloudflare 账号只做可用性检查，未修改其已有配置。
- 仍需主持人加两名玩家，其中一台真实手机，完成公网遭遇与返回探索，并复测私信、30 秒断线及恢复。
- Chromium 390px 测试不能代表 Android Chrome、iOS Safari 真机体验。
- 正常公网下操作到全员结果小于 1 秒的指标尚未测量。演出时长另计。
- 原面板操作默认发安全摘要；静默勾选在新增主持人工具中。房主恢复会作废未确认的顺序互换，需要重新申请。
- 房主恢复和全部消息历史依赖原浏览器本机存储；存储失败会显示提示。房间有效期为 24 小时，过期可由房主用原跑团存档重开。

上述剩余项目不以本地自动测试替代。PR #4 保持草稿，等待公网部署授权与实机验收；本期不合并，也不开始 D4。
