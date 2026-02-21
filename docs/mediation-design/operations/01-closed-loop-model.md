### 3.11 数据闭环模型（Request -> Delivery -> Event -> Archive）

#### 3.11.1 闭环完成条件（冻结）

1. 存在有效 Delivery（`served/no_fill/error`）。
2. 存在终态 Event（当前最小终态：`impression/failure`，`click` 不作为闭环终态）。
3. 二者通过同一 `responseReference` 关联。
4. 终态闭环主键冻结为 `responseReference + renderAttemptId`（见 `3.8.17`）。
5. 终态等待窗口 `120s` 内无终态事件时，系统补写 `failure`（见 `3.8.18`）。
6. 同一闭环主键下 `impression/failure` 互斥，按优先级裁决（见 `3.8.19`）。
7. Archive 标准写入对象冻结为 `fToGArchiveRecordLite`（见 `3.8.26` / `3.9.4`）。

#### 3.11.2 闭环价值

1. 支撑优化策略验证与质量评估。
2. 支撑对账、审计与争议回放。
3. 作为向 SSP 过渡的数据资产底座。
