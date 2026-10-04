# R1 可复现平衡测量报告

报告状态：**MEASURED_WITH_LIMITS**。默认无等级强化。评分、经验倍率及敌人/经济配置未调参。

源码 SHA256：`87789ca16f86302db1e4ef042daf821cbb05996e8104a04db8a0889f98224247`；配置 SHA256：`7d817a30ff56d7a49786956068e0fe00d27f4783ea93828ca6ea2e9435dcefab`；清单 SHA256：`55dbb5d254b9053aa35fd234ececa96df187417b8d0db38a359d23374da822b2`。
提交：`10c00638002843f77e68b899cd23d41241c94478`；Node：v24.18.0；命令：`C:\Program Files\nodejs\node.exe E:\Codex\Projects\Backfire\tools\balance-report.js run --manifest docs/r1/manifest.json --suite matrix --set all --workers 4 --out docs/r1/matrix-formal`。

单场胜率分母为所有成功执行场次（包括败/撤退/超时），异常单列。分位数仅含胜局最终得分；区间为 Wilson 95%。整局通关率分母为全部合法开局；首领胜率分母为实际进入该首领战的次数。

策略与假设：
- 单场：BattleSim BASIC_POLICY; attack lowest-HP in-range target, move, assist/block; no consumables, no tactical lookahead. Preset levels, full health, no cybernetics; not natural progression or human performance.
- 整局：Existing SMART one-action lookahead optimizes score gain, ally HP and enemy status. Main-attribute/first legal upgrade choices; constrained route, shop, rest and smith heuristics. Avoids risky elite side tasks when alternatives exist; after the main task, falls back to the best-paying legal side task if only excluded risky tasks remain, without forcing a stage. No battle consumables; summon skills disabled unless explicitly enabled. Not a complete player AI or human win-rate estimate.
- 两组固定清单互不重叠；独立验证集不参与拟合。未到达后期幕不产生虚构记录。超时保留为未解决样本，不能当撤退或失败继续结算。

## 样本与异常

请求 5400；完成 5400；异常 0；超时 49。
- 49 个样本达到预先声明的回合/步骤上限，已单列为 timeout 并纳入成功执行分母；没有当作合法败局或撤退继续结算。它们限制胜率解释，不是脚本异常；不能据此宣称所有整局达到合法游戏结局。

## 单场矩阵

|集|幕|类型|人数|请求/执行/异常|胜/败/撤/超时|胜率 (Wilson 95%)|P25/P50/P75/P90|S/A/B/C/D|
|---|---:|---|---:|---|---|---|---|---|
|baseline|1|battle|2|100/100/0|60/40/0/0|60.0% (50.2%–69.1%)|399/449/546/641|0/0/0/2/58|
|baseline|1|battle|3|100/100/0|93/7/0/0|93.0% (86.3%–96.6%)|604/681/820/979|0/0/2/34/57|
|baseline|1|battle|4|100/100/0|98/2/0/0|98.0% (93.0%–99.4%)|837/904/1054/1218|0/0/8/81/9|
|baseline|1|elite|2|100/100/0|37/63/0/0|37.0% (28.2%–46.8%)|436/520/648/776|0/0/0/4/33|
|baseline|1|elite|3|100/100/0|80/20/0/0|80.0% (71.1%–86.7%)|718/811/911/1021|0/1/1/46/32|
|baseline|1|elite|4|100/100/0|95/4/0/1|95.0% (88.8%–97.8%)|932/1069/1231/1342|1/4/18/69/3|
|baseline|1|boss|2|100/100/0|0/100/0/0|0.0% (0.0%–3.7%)|无样本/无样本/无样本/无样本|0/0/0/0/0|
|baseline|1|boss|3|100/100/0|21/79/0/0|21.0% (14.2%–30.0%)|1446/1504/1590/1625|1/10/9/1/0|
|baseline|1|boss|4|100/100/0|79/19/0/2|79.0% (70.0%–85.8%)|1853/1960/2120/2213|69/10/0/0/0|
|baseline|2|battle|2|100/100/0|45/55/0/0|45.0% (35.6%–54.8%)|436/505/612/702|0/0/0/2/43|
|baseline|2|battle|3|100/100/0|66/32/0/2|66.0% (56.3%–74.5%)|585/693/787/963|1/0/2/2/61|
|baseline|2|battle|4|100/100/0|87/12/0/1|87.0% (79.0%–92.2%)|841/926/1062/1483|5/2/2/24/54|
|baseline|2|elite|2|100/100/0|36/62/0/2|36.0% (27.3%–45.8%)|464/513/656/768|0/0/0/1/35|
|baseline|2|elite|3|100/100/0|63/35/0/2|63.0% (53.2%–71.8%)|618/674/831/1197|0/1/1/9/52|
|baseline|2|elite|4|100/100/0|80/19/0/1|80.0% (71.1%–86.7%)|886/1026/1218/1554|4/1/6/32/37|
|baseline|2|boss|2|100/100/0|65/31/0/4|65.0% (55.3%–73.6%)|886/977/1034/1412|0/0/2/25/38|
|baseline|2|boss|3|100/100/0|95/5/0/0|95.0% (88.8%–97.8%)|1070/1142/1250/1400|1/2/1/87/4|
|baseline|2|boss|4|100/100/0|98/2/0/0|98.0% (93.0%–99.4%)|1650/1736/1838/1934|9/39/43/7/0|
|baseline|3|battle|2|100/100/0|57/43/0/0|57.0% (47.2%–66.3%)|518/646/794/840|0/0/0/0/57|
|baseline|3|battle|3|100/100/0|84/16/0/0|84.0% (75.6%–89.9%)|832/952/1159/1317|0/0/1/13/70|
|baseline|3|battle|4|100/100/0|88/10/0/2|88.0% (80.2%–93.0%)|1220/1301/1447/1622|2/1/4/50/31|
|baseline|3|elite|2|100/100/0|50/50/0/0|50.0% (40.4%–59.6%)|657/739/934/1075|0/0/0/2/48|
|baseline|3|elite|3|100/100/0|78/20/0/2|78.0% (68.9%–85.0%)|970/1077/1259/1374|0/0/0/20/58|
|baseline|3|elite|4|100/100/0|86/12/0/2|86.0% (77.9%–91.5%)|1353/1478/1680/1900|3/3/10/61/9|
|baseline|3|boss|2|100/100/0|40/60/0/0|40.0% (30.9%–49.8%)|878/992/1183/1491|0/1/1/6/32|
|baseline|3|boss|3|100/100/0|58/39/0/3|58.0% (48.2%–67.2%)|1137/1400/1878/2119|3/6/11/14/24|
|baseline|3|boss|4|100/100/0|65/34/0/1|65.0% (55.3%–73.6%)|1624/1879/2687/2930|27/3/6/29/0|
|baseline|4|battle|2|100/100/0|85/14/0/1|85.0% (76.7%–90.7%)|805/897/1099/1412|0/1/1/3/80|
|baseline|4|battle|3|100/100/0|91/6/0/3|91.0% (83.8%–95.2%)|1082/1183/1428/1568|1/0/2/11/77|
|baseline|4|battle|4|100/100/0|94/5/0/1|94.0% (87.5%–97.2%)|1488/1575/1703/1950|4/1/2/60/27|
|baseline|4|elite|2|100/100/0|79/21/0/0|79.0% (70.0%–85.8%)|765/853/992/1057|0/0/0/2/77|
|baseline|4|elite|3|100/100/0|92/7/0/1|92.0% (85.0%–95.9%)|1068/1194/1420/1561|0/0/2/13/77|
|baseline|4|elite|4|100/100/0|95/5/0/0|95.0% (88.8%–97.8%)|1569/1670/1820/2145|4/2/9/66/14|
|baseline|4|boss|2|100/100/0|0/100/0/0|0.0% (0.0%–3.7%)|无样本/无样本/无样本/无样本|0/0/0/0/0|
|baseline|4|boss|3|100/100/0|0/100/0/0|0.0% (0.0%–3.7%)|无样本/无样本/无样本/无样本|0/0/0/0/0|
|baseline|4|boss|4|100/100/0|0/100/0/0|0.0% (0.0%–3.7%)|无样本/无样本/无样本/无样本|0/0/0/0/0|
|validation|1|battle|2|50/50/0|26/23/0/1|52.0% (38.5%–65.2%)|408/474/519/559|0/0/0/0/26|
|validation|1|battle|3|50/50/0|40/10/0/0|80.0% (67.0%–88.8%)|592/749/918/990|0/0/0/20/20|
|validation|1|battle|4|50/50/0|47/2/0/1|94.0% (83.8%–97.9%)|832/965/1137/1210|1/1/2/37/6|
|validation|1|elite|2|50/50/0|28/22/0/0|56.0% (42.3%–68.8%)|452/528/569/643|0/0/1/1/26|
|validation|1|elite|3|50/50/0|41/9/0/0|82.0% (69.2%–90.2%)|637/769/825/855|0/0/0/22/19|
|validation|1|elite|4|50/50/0|49/1/0/0|98.0% (89.5%–99.6%)|1004/1081/1305/1485|3/2/9/34/1|
|validation|1|boss|2|50/50/0|3/47/0/0|6.0% (2.1%–16.2%)|1091/1098/1215/1284|0/0/1/2/0|
|validation|1|boss|3|50/50/0|23/25/0/2|46.0% (33.0%–59.6%)|1319/1486/1685/1767|4/6/9/4/0|
|validation|1|boss|4|50/50/0|43/7/0/0|86.0% (73.8%–93.0%)|1850/1974/2097/2213|36/6/1/0/0|
|validation|2|battle|2|50/50/0|24/25/0/1|48.0% (34.8%–61.5%)|374/427/531/763|0/0/0/0/24|
|validation|2|battle|3|50/50/0|37/11/0/2|74.0% (60.4%–84.1%)|574/640/816/904|0/0/1/1/35|
|validation|2|battle|4|50/50/0|39/10/0/1|78.0% (64.8%–87.2%)|814/1002/1246/1501|1/0/3/16/19|
|validation|2|elite|2|50/50/0|14/36/0/0|28.0% (17.5%–41.7%)|422/487/756/908|0/0/0/1/13|
|validation|2|elite|3|50/50/0|33/16/0/1|66.0% (52.2%–77.6%)|658/769/890/1095|1/0/0/3/29|
|validation|2|elite|4|50/50/0|38/11/0/1|76.0% (62.6%–85.7%)|808/931/1228/1420|1/1/2/12/22|
|validation|2|boss|2|50/50/0|41/9/0/0|82.0% (69.2%–90.2%)|844/972/1077/1381|0/0/1/18/22|
|validation|2|boss|3|50/50/0|48/2/0/0|96.0% (86.5%–98.9%)|1091/1151/1234/1371|0/1/1/44/2|
|validation|2|boss|4|50/50/0|48/1/0/1|96.0% (86.5%–98.9%)|1714/1778/1891/2040|7/22/18/1/0|
|validation|3|battle|2|50/50/0|36/13/0/1|72.0% (58.3%–82.5%)|603/701/807/1006|0/0/0/1/35|
|validation|3|battle|3|50/50/0|46/4/0/0|92.0% (81.2%–96.8%)|791/926/1158/1260|0/0/0/6/40|
|validation|3|battle|4|50/50/0|48/2/0/0|96.0% (86.5%–98.9%)|1180/1374/1535/1707|0/0/4/27/17|
|validation|3|elite|2|50/50/0|31/19/0/0|62.0% (48.2%–74.1%)|588/713/863/1085|0/0/0/1/30|
|validation|3|elite|3|50/50/0|41/9/0/0|82.0% (69.2%–90.2%)|986/1185/1329/1479|0/2/0/14/25|
|validation|3|elite|4|50/50/0|46/4/0/0|92.0% (81.2%–96.8%)|1269/1405/1670/1933|1/1/7/29/8|
|validation|3|boss|2|50/50/0|12/38/0/0|24.0% (14.3%–37.4%)|1007/1040/1208/1403|0/0/1/1/10|
|validation|3|boss|3|50/50/0|27/23/0/0|54.0% (40.4%–67.0%)|1222/1412/1717/1880|0/2/3/14/8|
|validation|3|boss|4|50/50/0|29/21/0/0|58.0% (44.2%–70.6%)|1664/1960/2742/3093|13/1/7/8/0|
|validation|4|battle|2|50/50/0|31/19/0/0|62.0% (48.2%–74.1%)|767/861/1016/1216|0/0/0/0/31|
|validation|4|battle|3|50/50/0|43/5/0/2|86.0% (73.8%–93.0%)|1117/1195/1324/1435|1/0/0/1/41|
|validation|4|battle|4|50/50/0|46/3/0/1|92.0% (81.2%–96.8%)|1640/1708/1852/2071|3/1/2/35/5|
|validation|4|elite|2|50/50/0|46/3/0/1|92.0% (81.2%–96.8%)|802/924/1024/1186|0/0/0/2/44|
|validation|4|elite|3|50/50/0|46/3/0/1|92.0% (81.2%–96.8%)|1103/1243/1424/1622|1/0/0/9/36|
|validation|4|elite|4|50/50/0|46/3/0/1|92.0% (81.2%–96.8%)|1503/1587/1743/1829|1/1/1/31/12|
|validation|4|boss|2|50/50/0|0/50/0/0|0.0% (0.0%–7.1%)|无样本/无样本/无样本/无样本|0/0/0/0/0|
|validation|4|boss|3|50/50/0|0/50/0/0|0.0% (0.0%–7.1%)|无样本/无样本/无样本/无样本|0/0/0/0/0|
|validation|4|boss|4|50/50/0|0/50/0/0|0.0% (0.0%–7.1%)|无样本/无样本/无样本/无样本|0/0/0/0/0|

## 自然成长整局

|集|开局人数|请求/合法开局/合法终局|通关 (Wilson 95%)|失败/超时/异常|
|---|---:|---|---|---|

|集|开局人数|幕|到达/合法开局|首领胜/进入|首领胜率 (Wilson 95%)|
|---|---:|---:|---|---|---|

## 上限诊断

计数完成与游戏合法终局分开报告；超时表示预设计算上限，不能推断必败或规则故障。保留末轮单位状态（含坚毅起身）、地形和日志供独立诊断。以下样本均未追加经验、未当作撤退推进。

|场景/种子|幕/类型|上限类型|上限|记录回合|
|---|---|---|---:|---:|
|R1-v1:matrix:baseline:1:elite:4:034|1/elite|battle_round_limit|30|31|
|R1-v1:matrix:baseline:1:boss:4:000|1/boss|battle_round_limit|30|31|
|R1-v1:matrix:baseline:1:boss:4:012|1/boss|battle_round_limit|30|31|
|R1-v1:matrix:baseline:2:battle:3:035|2/battle|battle_round_limit|30|31|
|R1-v1:matrix:baseline:2:battle:3:047|2/battle|battle_round_limit|30|31|
|R1-v1:matrix:baseline:2:battle:4:085|2/battle|battle_round_limit|30|31|
|R1-v1:matrix:baseline:2:elite:2:015|2/elite|battle_round_limit|30|31|
|R1-v1:matrix:baseline:2:elite:2:061|2/elite|battle_round_limit|30|31|
|R1-v1:matrix:baseline:2:elite:3:004|2/elite|battle_round_limit|30|31|
|R1-v1:matrix:baseline:2:elite:3:083|2/elite|battle_round_limit|30|31|
|R1-v1:matrix:baseline:2:elite:4:020|2/elite|battle_round_limit|30|31|
|R1-v1:matrix:baseline:2:boss:2:006|2/boss|battle_round_limit|30|31|
|R1-v1:matrix:baseline:2:boss:2:044|2/boss|battle_round_limit|30|31|
|R1-v1:matrix:baseline:2:boss:2:068|2/boss|battle_round_limit|30|31|
|R1-v1:matrix:baseline:2:boss:2:077|2/boss|battle_round_limit|30|31|
|R1-v1:matrix:baseline:3:battle:4:000|3/battle|battle_round_limit|30|31|
|R1-v1:matrix:baseline:3:battle:4:091|3/battle|battle_round_limit|30|31|
|R1-v1:matrix:baseline:3:elite:3:052|3/elite|battle_round_limit|30|31|
|R1-v1:matrix:baseline:3:elite:3:068|3/elite|battle_round_limit|30|31|
|R1-v1:matrix:baseline:3:elite:4:047|3/elite|battle_round_limit|30|31|
|R1-v1:matrix:baseline:3:elite:4:096|3/elite|battle_round_limit|30|31|
|R1-v1:matrix:baseline:3:boss:3:012|3/boss|battle_round_limit|30|31|
|R1-v1:matrix:baseline:3:boss:3:094|3/boss|battle_round_limit|30|31|
|R1-v1:matrix:baseline:3:boss:3:096|3/boss|battle_round_limit|30|31|
|R1-v1:matrix:baseline:3:boss:4:041|3/boss|battle_round_limit|30|31|
|R1-v1:matrix:baseline:4:battle:2:056|4/battle|battle_round_limit|30|31|
|R1-v1:matrix:baseline:4:battle:3:012|4/battle|battle_round_limit|30|31|
|R1-v1:matrix:baseline:4:battle:3:074|4/battle|battle_round_limit|30|31|
|R1-v1:matrix:baseline:4:battle:3:094|4/battle|battle_round_limit|30|31|
|R1-v1:matrix:baseline:4:battle:4:017|4/battle|battle_round_limit|30|31|
|R1-v1:matrix:baseline:4:elite:3:026|4/elite|battle_round_limit|30|31|
|R1-v1:matrix:validation:1:battle:2:034|1/battle|battle_round_limit|30|31|
|R1-v1:matrix:validation:1:battle:4:031|1/battle|battle_round_limit|30|31|
|R1-v1:matrix:validation:1:boss:3:045|1/boss|battle_round_limit|30|31|
|R1-v1:matrix:validation:1:boss:3:049|1/boss|battle_round_limit|30|31|
|R1-v1:matrix:validation:2:battle:2:027|2/battle|battle_round_limit|30|31|
|R1-v1:matrix:validation:2:battle:3:027|2/battle|battle_round_limit|30|31|
|R1-v1:matrix:validation:2:battle:3:029|2/battle|battle_round_limit|30|31|
|R1-v1:matrix:validation:2:battle:4:021|2/battle|battle_round_limit|30|31|
|R1-v1:matrix:validation:2:elite:3:037|2/elite|battle_round_limit|30|31|
|R1-v1:matrix:validation:2:elite:4:007|2/elite|battle_round_limit|30|31|
|R1-v1:matrix:validation:2:boss:4:024|2/boss|battle_round_limit|30|31|
|R1-v1:matrix:validation:3:battle:2:014|3/battle|battle_round_limit|30|31|
|R1-v1:matrix:validation:4:battle:3:013|4/battle|battle_round_limit|30|31|
|R1-v1:matrix:validation:4:battle:3:044|4/battle|battle_round_limit|30|31|
|R1-v1:matrix:validation:4:battle:4:048|4/battle|battle_round_limit|30|31|
|R1-v1:matrix:validation:4:elite:2:014|4/elite|battle_round_limit|30|31|
|R1-v1:matrix:validation:4:elite:3:046|4/elite|battle_round_limit|30|31|
|R1-v1:matrix:validation:4:elite:4:031|4/elite|battle_round_limit|30|31|

## 限制与原始记录

真实玩家水平不能从这两种自动策略外推。单场预设等级、满状态，并非整局成长。SMART 直接优化评分、默认不使用部分武器人召唤和战斗道具，均会影响结果。首领类型覆盖仅按实际出现记录，未覆盖种类需要另建明确标记的定向场景，不能并入随机样本。

同名前缀的 .json 包含完整配置、源码哈希、全部种子/队伍、战斗前后等级/武器等级、天气/地形、补给/经济、伤亡与终局原因；.csv 包含原始场景行，.battles.csv 包含所有战斗行。元数据（时间戳、耗时）不属于复现比较。
