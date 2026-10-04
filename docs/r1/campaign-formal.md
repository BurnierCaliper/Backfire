# R1 可复现平衡测量报告

报告状态：**MEASURED_WITH_LIMITS**。默认无等级强化。评分、经验倍率及敌人/经济配置未调参。

源码 SHA256：`87789ca16f86302db1e4ef042daf821cbb05996e8104a04db8a0889f98224247`；配置 SHA256：`7d817a30ff56d7a49786956068e0fe00d27f4783ea93828ca6ea2e9435dcefab`；清单 SHA256：`55dbb5d254b9053aa35fd234ececa96df187417b8d0db38a359d23374da822b2`。
提交：`10c00638002843f77e68b899cd23d41241c94478`；Node：v24.18.0；命令：`C:\Program Files\nodejs\node.exe E:\Codex\Projects\Backfire\tools\balance-report.js run --manifest docs/r1/manifest.json --suite campaign --set all --workers 4 --out docs/r1/campaign-formal`。

单场胜率分母为所有成功执行场次（包括败/撤退/超时），异常单列。分位数仅含胜局最终得分；区间为 Wilson 95%。整局通关率分母为全部合法开局；首领胜率分母为实际进入该首领战的次数。

策略与假设：
- 单场：BattleSim BASIC_POLICY; attack lowest-HP in-range target, move, assist/block; no consumables, no tactical lookahead. Preset levels, full health, no cybernetics; not natural progression or human performance.
- 整局：Existing SMART one-action lookahead optimizes score gain, ally HP and enemy status. Main-attribute/first legal upgrade choices; constrained route, shop, rest and smith heuristics. Avoids risky elite side tasks when alternatives exist; after the main task, falls back to the best-paying legal side task if only excluded risky tasks remain, without forcing a stage. No battle consumables; summon skills disabled unless explicitly enabled. Not a complete player AI or human win-rate estimate.
- 两组固定清单互不重叠；独立验证集不参与拟合。未到达后期幕不产生虚构记录。超时保留为未解决样本，不能当撤退或失败继续结算。

## 样本与异常

请求 135；完成 135；异常 0；超时 5。
- 5 个样本达到预先声明的回合/步骤上限，已单列为 timeout 并纳入成功执行分母；没有当作合法败局或撤退继续结算。它们限制胜率解释，不是脚本异常；不能据此宣称所有整局达到合法游戏结局。
- campaign/validation 第 3 幕首领未覆盖：sand_aggregate。需另列定向场景，不能计入本随机样本。

## 单场矩阵

|集|幕|类型|人数|请求/执行/异常|胜/败/撤/超时|胜率 (Wilson 95%)|P25/P50/P75/P90|S/A/B/C/D|
|---|---:|---|---:|---|---|---|---|---|

## 自然成长整局

|集|开局人数|请求/合法开局/合法终局|通关 (Wilson 95%)|失败/超时/异常|
|---|---:|---|---|---|
|baseline|2|30/30/30|0/30 0.0% (0.0%–11.4%)|30/0/0|
|baseline|3|30/30/30|0/30 0.0% (0.0%–11.4%)|30/0/0|
|baseline|4|30/30/28|0/30 0.0% (0.0%–11.4%)|28/2/0|
|validation|2|15/15/15|0/15 0.0% (0.0%–20.4%)|15/0/0|
|validation|3|15/15/13|0/15 0.0% (0.0%–20.4%)|13/2/0|
|validation|4|15/15/14|0/15 0.0% (0.0%–20.4%)|14/1/0|

|集|开局人数|幕|到达/合法开局|首领胜/进入|首领胜率 (Wilson 95%)|
|---|---:|---:|---|---|---|
|baseline|2|1|30/30 (100.0%)|0/6|0.0% (0.0%–39.0%)|
|baseline|2|2|0/30 (0.0%)|0/0|无样本/无法估计 (无样本/无法估计)|
|baseline|2|3|0/30 (0.0%)|0/0|无样本/无法估计 (无样本/无法估计)|
|baseline|2|4|0/30 (0.0%)|0/0|无样本/无法估计 (无样本/无法估计)|
|baseline|3|1|30/30 (100.0%)|5/9|55.6% (26.7%–81.1%)|
|baseline|3|2|5/30 (16.7%)|2/3|66.7% (20.8%–93.9%)|
|baseline|3|3|2/30 (6.7%)|0/1|0.0% (0.0%–79.3%)|
|baseline|3|4|0/30 (0.0%)|0/0|无样本/无法估计 (无样本/无法估计)|
|baseline|4|1|30/30 (100.0%)|10/17|58.8% (36.0%–78.4%)|
|baseline|4|2|10/30 (33.3%)|4/6|66.7% (30.0%–90.3%)|
|baseline|4|3|4/30 (13.3%)|1/3|33.3% (6.1%–79.2%)|
|baseline|4|4|1/30 (3.3%)|0/1|0.0% (0.0%–79.3%)|
|validation|2|1|15/15 (100.0%)|1/2|50.0% (9.5%–90.5%)|
|validation|2|2|1/15 (6.7%)|0/0|无样本/无法估计 (无样本/无法估计)|
|validation|2|3|0/15 (0.0%)|0/0|无样本/无法估计 (无样本/无法估计)|
|validation|2|4|0/15 (0.0%)|0/0|无样本/无法估计 (无样本/无法估计)|
|validation|3|1|15/15 (100.0%)|4/6|66.7% (30.0%–90.3%)|
|validation|3|2|4/15 (26.7%)|3/3|100.0% (43.9%–100.0%)|
|validation|3|3|3/15 (20.0%)|0/1|0.0% (0.0%–79.3%)|
|validation|3|4|0/15 (0.0%)|0/0|无样本/无法估计 (无样本/无法估计)|
|validation|4|1|15/15 (100.0%)|7/12|58.3% (32.0%–80.7%)|
|validation|4|2|7/15 (46.7%)|3/3|100.0% (43.9%–100.0%)|
|validation|4|3|3/15 (20.0%)|1/1|100.0% (20.7%–100.0%)|
|validation|4|4|1/15 (6.7%)|0/1|0.0% (0.0%–79.3%)|

## 上限诊断

计数完成与游戏合法终局分开报告；超时表示预设计算上限，不能推断必败或规则故障。保留末轮单位状态（含坚毅起身）、地形和日志供独立诊断。以下样本均未追加经验、未当作撤退推进。

|场景/种子|幕/类型|上限类型|上限|记录回合|
|---|---|---|---:|---:|
|R1-v1:campaign:baseline:4:016|1/boss|battle_round_limit|25|26|
|R1-v1:campaign:baseline:4:021|2/battle|battle_round_limit|25|26|
|R1-v1:campaign:validation:3:004|1/elite|battle_round_limit|25|26|
|R1-v1:campaign:validation:3:014|3/battle|battle_round_limit|25|26|
|R1-v1:campaign:validation:4:013|2/battle|battle_round_limit|25|26|

## 限制与原始记录

真实玩家水平不能从这两种自动策略外推。单场预设等级、满状态，并非整局成长。SMART 直接优化评分、默认不使用部分武器人召唤和战斗道具，均会影响结果。首领类型覆盖仅按实际出现记录，未覆盖种类需要另建明确标记的定向场景，不能并入随机样本。

同名前缀的 .json 包含完整配置、源码哈希、全部种子/队伍、战斗前后等级/武器等级、天气/地形、补给/经济、伤亡与终局原因；.csv 包含原始场景行，.battles.csv 包含所有战斗行。元数据（时间戳、耗时）不属于复现比较。
