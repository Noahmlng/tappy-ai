### 3.11 数据闭环模型（Request -> Delivery -> Event -> Archive）

#### 3.11.1 闭环完成条件（冻结）

1. 存在有效 Delivery（`served/no_fill/error`）。
2. 存在终态 Event（当前最小集：`impression/click/failure`）。
3. 二者通过同一 `responseReference` 关联。
4. 窗口超时时系统补写 `failure` 完成闭环。

#### 3.11.2 闭环价值

1. 支撑优化策略验证与质量评估。
2. 支撑对账、审计与争议回放。
3. 作为向 SSP 过渡的数据资产底座。

