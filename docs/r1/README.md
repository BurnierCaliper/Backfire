# R1：多人平衡测量与结算一致性

依据 [已批准 PRD v0.2](../PRD-roadmap-v0.1.md)，本期交付可信的测量工具和评估证据。评分公式、门槛、按幕增量、速杀/无伤奖励和经验倍率均保持不变，后续由玩家测试决定是否手调。任务节点的新类型已记入 R2，尚未实现。

## 交付与结果

- 网页与无界面共用 `settleBattleRewards`，修正模拟漏发评价经验，并防止同场重复发奖；不新增玩家存档字段。
- 修复经济模拟的分岔、检定、守夜/偷袭流程；真实整局模拟可在常规任务偏好无候选时接受剩余合法任务。
- 预先冻结 5,400 个单场样本及 135 个整局样本；保存实际队伍、等级、天气/地形、原始/最终分、升级选择、经济、结局及源码/配置哈希。
- 原始手册的勘误核对见 [资料审查](source-review.md)。PDF 可见勘误优先于被覆盖的旧文字层。

| 评估 | 样本 | 胜/通关 | 败 | 主动撤退终局 | 超时 | 脚本异常 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 满状态单场矩阵 | 5,400 | 3,536 | 1,815 | 0 | 49 | 0 |
| 自然成长整局 | 135 | 0 | 130 | 0 | 5 | 0 |

单场为四幕 × 普通/精英/首领 × 2/3/4 人，36 格各有 100 个基线种子与 50 个独立验证种子。整局为每种人数 30 个基线、15 个验证种子，两组均覆盖全部 10 名角色，每名在每种人数中至少出现两次。

| 开局人数 | 单场胜/总数 | 单场超时 | 整局通关/总数 | 到达第 2/3/4 幕的整局数 |
| --- | ---: | ---: | ---: | --- |
| 2 | 846/1,800 | 11 | 0/45 | 1 / 0 / 0 |
| 3 | 1,246/1,800 | 21 | 0/45 | 9 / 5 / 0 |
| 4 | 1,444/1,800 | 17 | 0/45 | 17 / 7 / 2 |

这组结果只描述所记录的自动策略。单场使用预设等级、满状态和 BASIC；整局使用 SMART，偏重即时评分与状态收益，默认不使用战斗道具和部分召唤。**不能将 0/135 自动通关外推为真实玩家通关率，也不能据此直接决定平衡参数。**

## 如何解释报告

详细的基线/验证集、逐幕/人数/类型胜率、Wilson 95% 区间、胜局得分分位数和既有评价分布分别在 [单场报告](matrix-formal.md) 与 [整局报告](campaign-formal.md)。

两份正式报告状态为 `MEASURED_WITH_LIMITS`：单场上限 30 回合，整局每战上限 25 回合、流程上限 2,000 步。超时保留终态，不领取终局奖励，不当作失败或撤退继续推进。胜率分母包含超时；异常单列，出现异常会阻止报告通过。整局过程中的主动撤退属于战斗记录，不等于整局主动撤退终局。

自然成长验证集第 3 幕没有遇到沙之聚合体。该幕地区巨人城的首领池为空，游戏会回退至全部首领；这是抽样缺口。[另列的定向诊断](boss-coverage-diagnostic.md)只能核验该首领的预设战斗，不补造自然成长轨迹，不混入上述样本。后期幕次的自然成长样本较少，未到达的战斗不产生记录。

经济脚本另完成 2/3/4 人各 20 局、共 60 局流程；它假定战斗全胜，评价经验固定按 ×1，不模拟受伤或首领阶段，不代表战斗胜率。

## 证据与重跑

最终完整验证：`REQUIRE_UI=1 npm test` 共 316 项，315 通过、0 失败、1 项因原有专精功能关闭而跳过；34 项真实 Chromium UI 测试均执行。专项奖励/采样/经济回归 34/34 通过；升级边界聚焦验证 1/1 通过。

- [固定种子与队伍清单](manifest.json)：两组互不重叠，验证集不用于拟合评分；本期没有候选参数。
- [原始 JSON/CSV 与测试日志](evaluation-evidence.zip)：解压到本目录即可检查原始记录；压缩包中的 `SHA256SUMS.json` 校验每个文件。
- [压缩包校验凭据](evidence-receipt.json)：包含压缩包及各输入文件的 SHA-256。`package_evidence.py` 可重新打包并验证 CRC 和逐文件内容。
- [验证与独立审查](verification.md)、[超时诊断](timeout-review.md)：记录回归证据和测量边界。
- [独立完整性校验](verification-receipt.json)：`node docs/r1/verify-evidence.js` 检查完整清单、满血假设、零异常、哈希一致及现有规则源码未改变。

在仓库根目录运行（游戏本身无新增运行时依赖）：

```sh
node tools/balance-report.js manifest --out docs/r1/manifest.json
node tools/balance-report.js run --manifest docs/r1/manifest.json --suite matrix --set all --workers 4 --out docs/r1/matrix-formal
node tools/balance-report.js run --manifest docs/r1/manifest.json --suite campaign --set all --workers 4 --out docs/r1/campaign-formal
node tools/economy.js 20
npm test
npm run test:ui
```

`npm run test:ui` 必须找到 Playwright 与其 Chromium，否则失败；可使用现有全局安装或通过 `NODE_PATH` 指向现有依赖。它执行真实浏览器测试，包括评分/经验、刷新继续与 390px 手机操作。普通 `npm test` 在缺少浏览器环境时仍按原约定跳过 UI，因此需检查输出，不能把跳过视为 UI 验收。

指定单个固定场景重跑：

```sh
node tools/balance-report.js run --manifest docs/r1/manifest.json --suite matrix --set baseline --id R1-v1:matrix:baseline:1:boss:4:000 --out docs/r1/replay
```

无 `--diagnostic-boost` 时绝不增加角色等级。显式强化只允许单场诊断，不得与基线合并。改变回合上限属于新的诊断条件，保留原正式报告。比较重跑时核对清单、源码/配置哈希、策略版本和核心记录；源码哈希以 UTF-8 去 BOM、CRLF 转 LF 后计算，时间戳、机器路径、耗时与 Git 工作区状态不属于战斗结果。

本报告在开发分支提交前生成，所以 provenance 中的 commit 指向审查基线；实际评估代码以完整 sourceHashes 为准。提交、推送不会改变这些源码内容，审阅者可从 PR 对应代码复算。
