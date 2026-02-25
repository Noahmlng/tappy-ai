# 10 - Release and Rollback Runbook

- Owner: Release Manager + Integrations
- Last Updated: 2026-02-22

## 1. Release Preconditions

- [ ] P0 测试全通过
- [ ] API key、环境 URL、appId/placementId 校验完成
- [ ] 灰度计划与回滚阈值已批准
- [ ] 双方值班人在线并可升级

## 2. Release Steps

1. 冻结非必要改动。
2. 在生产流量外（dry-run / replay）完成 smoke。
3. 生产灰度：5% -> 20% -> 50% -> 100%。
4. 每档至少观察 15-30 分钟。
5. 达标后继续放量，否则立即停止。

## 3. Rollback Triggers

| Trigger | Threshold | Action |
| --- | --- | --- |
| v2/bid 5xx 上升 | >1% (5m) | 立即回退上一版本 |
| events ack 下滑 | <99% (10m) | 停止放量并回退 |
| p95 延迟劣化 | >30% baseline (10m) | 触发回退 |
| 业务告警 | 关键漏记/重复风险 | 触发回退 |

## 4. Rollback Steps

1. 停止继续放量。
2. 切回上一个稳定版本（配置 + 客户端）。
3. 清点受影响 requestId 范围。
4. 验证关键指标恢复（错误率、延迟、事件成功率）。
5. 发布回滚完成通知。

## 5. Post-Incident Follow-up

1. 24 小时内提交 incident summary。
2. 72 小时内完成 RCA 与修复计划。
3. 将防再发动作并入下一轮发布门禁。
