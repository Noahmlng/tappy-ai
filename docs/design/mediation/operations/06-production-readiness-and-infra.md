## 6. 生产化上线必需项与基础设施设计（P0）

本章定义“执行完开发计划后可直接上线”所需的最小生产能力。  
结论：Mediation 不是纯 SDK 工程，服务端必须具备持久化、幂等状态、异步事件与可观测治理能力，才能满足 A-H 合同。

### 6.1 目标与边界

目标：
1. 支撑 `Request -> Delivery -> Event -> Archive -> Replay` 全链路线上稳定运行。
2. 满足 A-H 对幂等、回放、版本锚点、审计、回滚的强约束。
3. 提供可运维、可扩展、可合规的上线基线。

非目标：
1. 本章不定义完整多地域全球架构。
2. 本章不展开 DSP/SSP 深度交易细节（见后续优化文档）。

### 6.2 最小生产拓扑（MVP 上线版）

1. `mediation-api`（同步面）：
   - 承接 SDK ingress（A/E）与配置接口（H）。
2. `mediation-event-ingest`（异步入口）：
   - 承接 `POST /events`（F）并写入事件流。
3. `mediation-worker`（异步处理面）：
   - 处理 F 归因计费、G 归档写入、补偿任务。
4. `mediation-replay-api`：
   - 承接 G replay 请求与争议回放查询。
5. `config-publish-worker`：
   - 处理 H 发布状态机、灰度执行、回滚任务。

### 6.3 必需基础服务（上线阻断项）

1. `PostgreSQL`（必需）：
   - 配置版本线、发布记录、审计与归档事实、回放索引。
2. `Redis`（必需）：
   - 幂等窗口、去重状态、热缓存、短时熔断状态。
3. `Message Queue`（必需，Kafka/NATS/Redis Streams 三选一）：
   - E->F、F->G、发布补偿、重试与死信队列。
4. `Object Storage`（建议）：
   - 大体积审计快照、回放附件、历史归档压缩包。
5. `Secrets Manager`（必需）：
   - Ads network 凭据、加密密钥、发布令牌管理。

没有上述 1~3，则不满足“可上线”标准，只能作为本地 demo。

### 6.4 最小数据模型（冻结）

关系型核心表（建议最小集）：
1. `config_snapshots`
2. `config_publish_operations`
3. `opportunity_records`
4. `delivery_records`
5. `event_records`
6. `archive_records`
7. `audit_records`
8. `replay_jobs`
9. `idempotency_keys`
10. `dead_letter_records`

最小索引要求：
1. `responseReference + renderAttemptId`（闭环主键）
2. `recordKey`（F/G 幂等）
3. `traceKey/requestKey/opportunityKey`
4. `anchorHash + versionAnchorSnapshotRef`
5. `createdAt + tenant/app/placement`

### 6.5 可用性与容灾设计

1. 所有写路径默认主从（或托管高可用）数据库部署。
2. 异步任务必须支持“至少一次投递 + 幂等消费”。
3. 所有关键写操作必须具备重试与死信补偿路径。
4. 配置发布必须支持原子切换与一键回滚。
5. 日志、指标、追踪与审计数据分层保留策略：
   - 热数据（7~30 天）
   - 温数据（90~180 天）
   - 冷归档（按合规要求）

### 6.6 安全、权限与合规

1. 接口鉴权：
   - SDK 请求鉴权（appKey/token）
   - 内部服务鉴权（mTLS 或 service token）
2. 发布权限模型：
   - 至少区分 `publisher` / `reviewer` / `admin`。
3. 敏感字段治理：
   - 遵循 B 脱敏合同，日志默认脱敏后落盘。
4. 数据加密：
   - 传输层 TLS
   - 存储层静态加密（尤其事件与审计表）
5. 合规审计：
   - 配置发布、回滚、权限拒绝、关键决策必须可追溯。

### 6.7 可观测性与 SLO

关键 SLI（最小）：
1. 请求可用率（A/E）
2. 事件 ACK 成功率（F）
3. 闭环完成率（F/G）
4. 回放成功率与确定性一致率（G）
5. 配置发布成功率与回滚成功率（H）

最小 SLO（建议起步）：
1. `p95 request latency <= 300ms`（不含外部供给超时补偿）
2. `event ack success >= 99.9%`
3. `closed-loop completion >= 99.5%`
4. `replay determinism pass >= 99.99%`

告警分级：
1. P0：主链不可用、闭环中断、发布失败不可回滚
2. P1：去重异常、回放错误率升高、配置漂移
3. P2：单网络劣化、缓存命中下降、延迟抖动

### 6.8 发布、灰度与回滚

1. 环境分层：
   - `dev -> staging -> preprod -> prod`
2. 发布门禁：
   - 仅在 `test:functional:p0=100%` 且 `test:e2e=100%` 后允许推进。
3. 灰度策略：
   - 先 tenant 白名单，再百分比分流，再全量。
4. 回滚策略：
   - 配置回滚优先（H）
   - 代码回滚次之（镜像回滚）
5. 变更冻结窗口：
   - 生产高峰期间禁止非紧急发布。

### 6.9 数据对账与财务侧准备

1. 账务事实来源必须以 F/G 归档记录为准。
2. 同一 `recordKey` 禁止重复计费。
3. 提供日级与小时级对账导出能力。
4. 差异处理必须有 `diff reason code` 与重跑流程。
5. 争议回放需绑定固定版本锚点（禁止事后漂移）。

### 6.10 运维运行手册（上线前必须完成）

1. 故障剧本：
   - DB 故障、MQ 堆积、Redis 失效、外部网络不可用、发布失败。
2. 应急动作：
   - 降级开关、只读模式、临时熔断、快速回滚。
3. 恢复验证：
   - 主链恢复、事件恢复、闭环补偿、回放一致性复检。

### 6.11 上线阻断清单（Go/No-Go）

必须全部满足：
1. 基础服务就绪：PostgreSQL/Redis/MQ 全部上线可用。
2. 安全就绪：鉴权、权限、密钥托管、TLS、审计链全部开启。
3. 测试就绪：P0 矩阵 100%，E2E 100%，关键 chaos 测试通过。
4. 运维就绪：监控告警、runbook、oncall 值班、回滚演练完成。
5. 业务就绪：对账链路可用，争议回放可执行。

未满足任一条，结论均为 `No-Go`。

