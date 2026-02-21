### 3.10 Module H: Config & Version Governance（横切模块）

#### 3.10.1 三条版本线分离（冻结）

1. `Schema Version`
2. `Routing Strategy Version`
3. `Placement Config Version`

治理规则：
1. 三线独立发布、独立回滚、独立审计。
2. 任一线升级不得隐式修改其他两线行为。
3. 单请求必须记录三线版本快照。

#### 3.10.2 兼容与回滚

1. schema 变更优先 optional 扩展，破坏兼容才升主版本。
2. 路由策略先灰度再放量，监控 `served/no_fill/error` 与延迟。
3. 回滚顺序按最小影响面：placement -> routing -> schema。

