## 4. 当前版本交付包（Deliverables, MVP Only）

当前版本只交付“可走通、可联调、可回放”的最小集合，不做一应俱全设计。

1. 模块化主链框架（A-H）与边界说明。
2. 统一 Opportunity Schema（六块骨架 + 状态机）基线说明。
3. 外部输入映射与冲突优先级规则（含 B 输入/输出合同 + 六块 required 矩阵 + Canonical 枚举字典 + 字段级冲突裁决引擎 + mappingAudit 快照 + C 输入合同 + C 执行顺序/短路机制 + C 输出合同 + Policy 原因码体系 + Policy 审计快照 + D 输入合同 + Adapter 注册与能力声明 + request adapt 子合同 + candidate normalize 子合同 + error normalize 体系）。
4. 两类供给源最小适配合同（adapter 四件事）与编排基线（含 Route Plan 触发/裁决/短路口径 + D 输出合同 + 路由审计快照）。
5. Delivery / Event Schema 分离与 `responseReference` 关联口径（含 E 层 compose 输入合同 + render_plan 输出合同 + 候选消费与最终渲染决策规则 + 渲染能力门禁矩阵 + 追踪注入与事件合同 + E 层验证与拦截规则 + E 层错误码与降级矩阵 + E 输出合同与状态更新）。
6. Request -> Delivery -> Event -> Archive 最小闭环与回放基线。
7. 可观测与审计最小模型（单机会对象 + 四段决策点）。
8. 配置与版本治理基线（三线分离：schema/route/placement + Config Resolution Contract：global/app/placement 合并顺序、字段覆盖规则、缺失/非法值处置、`resolvedConfigSnapshot` + GET `/config` 合同：请求必填键、最小响应字段、`ETag/If-None-Match`、`TTL/304` 语义、过期重验证动作 + POST `/config/publish` 合同：发布状态机、原子性边界、回滚粒度、失败补偿 + 版本兼容门禁合同：`schema -> sdk -> adapter` 校验顺序、`allow/degrade/reject` 动作、标准原因码 + 版本锚点注入与冻结点：必注入锚点集合、A-H 冻结点、禁止中途切换、回放对账锚点约束 + 灰度规则合同：app/placement/sdk/adapter 选择器、分流键、百分比策略、熔断回退条件）。
9. 最小接入指南 + 最小链路清单 + 联调检查清单。
10. Module A MVP 裁剪结论（必要模块已实现边界 + 延后模块索引）。
11. Module F 输入合同（`POST /events` 批量 envelope + 单事件必填字段 + 逐条 ACK + 部分成功语义）、事件类型字典分层（`billing/diagnostics` + unknown 处理）、幂等去重基线（幂等键公式 + 优先级 + 去重窗口 + 状态机）、终态闭环规则（`responseReference + renderAttemptId`、超时补写、`impression/failure` 互斥优先级）、归因计费映射合同（`billableFacts/attributionFacts` 映射 + 单尝试唯一计费 + 冲突裁决）、F 输出合同（`fToGArchiveRecordLite` 字段 + 状态 + 版本锚点 + 关联键）、F->G->Archive 写入一致性合同（`recordKey` 幂等写入语义 + 写入顺序 + 部分失败补偿 + 最终一致状态）、G append 接口合同（请求体 + 幂等键 + 异步 ACK + 可重试原因码 + AuditRecord 字段级 required 矩阵）与 G replay 合同（查询参数 + 过滤器 + `summary/full` + 分页排序 + 空结果语义 + 回放确定性规则）。
