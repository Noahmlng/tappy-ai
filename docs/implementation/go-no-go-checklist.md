# Go/No-Go Checklist (INFRA-010)

- Date: 2026-02-21
- Decision rule: 必须全部满足；任一阻断项失败即 `No-Go`。

## 1. 基础服务阻断项

- [ ] Supabase Postgres（`bkqjenmznafkqqwvwrad`）可连接并完成 migration
- [ ] Redis 可用（幂等键空间/TTL 策略已生效）
- [ ] MQ 可用（topic/retry/DLQ 策略已生效）
- [ ] 关键依赖健康检查接口返回正常

## 2. 安全阻断项

- [ ] 接口鉴权开启（未授权请求稳定拒绝）
- [ ] 服务间 token 鉴权开启（kid 轮转机制已验证）
- [ ] Secrets 托管落地（无生产明文秘钥）
- [ ] 审计日志完整（deny/发布/回滚可追溯）

## 3. 测试阻断项

- [ ] `npm --prefix ./projects/ad-aggregation-platform run test:integration` 全部通过
- [ ] 关键链路 smoke/E2E 通过（Request -> Delivery -> Event -> Archive -> Replay）
- [ ] 发布门禁工作流可执行并通过
- [ ] 回滚演练模板已填写并评审

## 4. 可观测与运维阻断项

- [ ] SLI/SLO 指标可查询（request/event/closed-loop/replay/publish）
- [ ] P0/P1 告警规则上线并验证触发
- [ ] Oncall 与 runbook 已确认
- [ ] 冻结窗口策略已设置

## 5. 业务与财务阻断项

- [ ] 日级对账链路可执行
- [ ] 差异可定位到 `recordKey` 与版本锚点
- [ ] 争议回放流程可执行且可审计
- [ ] 计费口径与归档事实对齐

## 6. 最终结论

- [ ] Go
- [ ] No-Go

结论填写规则：

1. 仅当上方所有阻断项均通过时，才可勾选 `Go`。
2. 任一项失败或未验证，必须勾选 `No-Go`。
