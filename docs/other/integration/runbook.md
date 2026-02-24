# External Integration Workflow Runbook

- Version: v1.0
- Last Updated: 2026-02-24
- Scope: 外部开发者从开通到生产上线的标准对接流程

## 1. Workflow Overview

标准流程分 5 个阶段：

1. 开通与合同对齐
2. Sandbox / Staging 接入
3. 联调与验收
4. 生产灰度上线
5. 运营与变更管理

## 2. Phase 1: 开通与合同对齐

输入：业务目标、使用场景、目标 placement。

动作：

1. 双方确认 API 版本与字段契约。
2. 发放 `MEDIATION_API_KEY`、环境 base URL（runtime key-only，scope 由 key 解析）。
3. 定义故障 SLA、升级通道、值班联系人。

产出物：

1. 集成参数表（placementId/env）。
2. 对接群与升级通讯录。
3. 里程碑日期（联调开始、UAT、上线窗口）。

## 3. Phase 2: Sandbox / Staging 接入

动作：

1. 实现 `config -> evaluate -> events` 三接口。
2. 接入 requestId 全链路日志。
3. 实现 fail-open（广告失败不阻塞主流程）。

退出条件：

1. 能稳定返回 `requestId`。
2. 事件上报成功率达到约定阈值。
3. 错误重试符合策略（仅网络/5xx）。

## 4. Phase 3: 联调与验收

动作：

1. 按测试计划执行 P0/P1 用例。
2. 核对 `served/blocked/no_fill/error` 分布。
3. 做一次降级演练（模拟 API 超时）。

退出条件：

1. P0 全通过。
2. 无 Sev-1 / Sev-2 未闭环问题。
3. 已完成上线与回滚预案签字。

## 5. Phase 4: 生产灰度上线

动作：

1. 小流量灰度（建议 5% -> 20% -> 50% -> 100%）。
2. 每个阶段观察核心指标：错误率、延迟、事件上报成功率。
3. 任一阈值越线时立即停止放量。

建议阈值（可按业务调整）：

1. `evaluate` 5xx > 1%（5 分钟窗口）触发暂停。
2. `events` ack 成功率 < 99% 触发回退。
3. p95 延迟超过基线 30% 持续 10 分钟触发回退。

## 6. Phase 5: 运营与变更管理

动作：

1. 版本升级采用提前公告 + 双版本兼容窗口。
2. 每次字段新增/弃用有明确生效日期。
3. 每周复盘：fill/CTR/no_fill 结构与异常类型。

## 7. Incident Escalation

分级建议：

1. Sev-1：全量不可用或严重收入损失，15 分钟内拉齐双方 on-call。
2. Sev-2：部分功能退化，30 分钟内响应。
3. Sev-3：单场景异常，工作日处理。

事件模板（最少字段）：

1. 发生时间（UTC）
2. 影响范围（appId / placementId / region）
3. 关键 requestId 示例
4. 当前缓解动作
5. 下一次更新时间

## 8. Ready-for-Production Checklist

- [ ] 三接口已接通：`config/evaluate/events`
- [ ] requestId 全链路可追踪
- [ ] fail-open 已验证
- [ ] 重试策略与幂等策略已上线
- [ ] 灰度与回滚计划已确认
- [ ] 值班通讯录与升级机制已生效
