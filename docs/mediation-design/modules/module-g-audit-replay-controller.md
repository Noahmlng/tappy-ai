### 3.9 Module G: Audit & Replay Controller

#### 3.9.1 审计单元

最小审计单元固定为“单机会对象”，必须贯穿全生命周期。

#### 3.9.2 四段关键决策点（冻结）

1. `Mapping`
2. `Routing`
3. `Delivery`
4. `Event`

每段最小字段：
1. 决策类型
2. 时间戳与耗时
3. 输入摘要与输出摘要
4. 状态与原因码
5. 规则版本
6. 关联键（trace key + `responseReference`）

#### 3.9.3 回放基线

1. 支持按 `responseReference` 或 trace key 回放单请求全链路。
2. 回放覆盖 `Request -> Mapping -> Routing -> Delivery -> Event -> Archive`。
3. 审计写入失败不得阻塞主链路，走异步补偿。

