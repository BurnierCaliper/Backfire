# 第 3 幕沙之聚合体：定向预设诊断

**仅作定向诊断，不补入自然成长整局或随机矩阵统计。** 这些种子已在正式单场验证集中计数，本次重跑不是新增独立样本。

目的：整局独立验证未自然覆盖第 3 幕的 sand_aggregate，因此从既有单场验证报告中按清单顺序，各挑选一个 2/3/4 人、无等级强化、遭遇该 preset 的固定种子重跑。

假设：预设角色等级与敌方等级相同、满血、预设武器等级与升级选择、BASIC_POLICY，不代表自然成长或真人策略。

来源：[正式单场报告](matrix-formal.md)；原始记录 `docs/r1/matrix-formal.json`（证据压缩包内同名文件）。来源文件 SHA256：`de2fb246e67bfad4cf7a1bacfc68de870ddceb02db1adea5ef5d1eedee160ea3`。
来源源码 SHA256：`87789ca16f86302db1e4ef042daf821cbb05996e8104a04db8a0889f98224247`；本次源码 SHA256：`87789ca16f86302db1e4ef042daf821cbb05996e8104a04db8a0889f98224247`；本次配置 SHA256：`7d817a30ff56d7a49786956068e0fe00d27f4783ea93828ca6ea2e9435dcefab`。
诊断脚本 SHA256（与工具相同文本归一规则）：`685eded58df8bc2c278884d0db62acf4b15d75cc3d7fb1acef3719a77c4ba304`。

|人数|来源种子|队伍|敌方/我方等级|结局|回合|原始/最终分|评价|核心结果与来源一致|
|---:|---|---|---|---|---:|---|---|---|
|2|R1-v1:matrix:validation:3:boss:2:001|ras、chuan|12/12|win|4|790/790|D|是|
|3|R1-v1:matrix:validation:3:boss:3:000|helu、hiaki、kolt|12/12|win|6|1412/1412|C|是|
|4|R1-v1:matrix:validation:3:boss:4:000|kolt、yuito、hiaki、ruby|12/12|win|8|1524/1524|C|是|

完整阵容、实际单位等级、武器等级、地形、天气、终态、源记录身份与执行配置见同名前缀 JSON/CSV。自然成长整局第 3 幕对应首领的覆盖缺口仍然保留；这里只确认选定预设场景可以重放。
