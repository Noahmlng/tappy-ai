# Prod-Only 剪枝发布说明（Mediation API）

- 更新时间：2026-02-25
- 适用仓库：`/Users/zeming/Documents/tappy-ai-mediation`
- 影响范围：`mediation`、`apps/runtime-api`、`apps/control-plane-api`

## 1. 目标

本次发布将 Mediation API 收敛为 prod-only 运行模式：

1. 运行时只接受 Supabase 持久化。
2. CORS 改为 fail-closed（非白名单 Origin 直接 403）。
3. `/api/v1/dev/reset` 下线（返回 404）。
4. 保持 runtime/control-plane 双项目部署。

## 2. Breaking Changes

1. CORS 行为变更：
   - 非白名单 `Origin` 请求（含预检）返回 `403`。
   - 错误码：`CORS_ORIGIN_FORBIDDEN`。
2. 删除开发重置接口：
   - `/api/v1/dev/reset` 不再可用（`404`）。
3. 运行时配置收敛：
   - 必需 env：`SUPABASE_DB_URL`、`MEDIATION_ALLOWED_ORIGINS`。
   - provider 凭据保留可选：`OPENROUTER_API_KEY`、`OPENROUTER_MODEL`、`CJ_TOKEN`、`PARTNERSTACK_API_KEY`。

## 3. 部署配置

两个 API 项目都需要配置：

1. `SUPABASE_DB_URL=<prod db>`
2. `MEDIATION_ALLOWED_ORIGINS=https://<dashboard-prod-domain>`

白名单范围固定为正式 Dashboard 域名，不包含 preview 域名。

## 4. 测试与验证

1. 集成/端到端测试改为 Supabase 测试库：
   - `SUPABASE_DB_URL_TEST=<non-prod db>`
2. 集成测试入口会先执行表级清理：
   - `mediation/scripts/test-db-cleanup.js`
3. 新增 CORS 守卫验证：
   - 非白名单 `OPTIONS` -> `403`
   - 非白名单普通请求 -> `403`
   - 无 `Origin` 的 server-to-server 请求 -> `200`

## 5. 回滚策略

1. 应用层回滚：
   - Runtime API 与 Control-plane API 分别在 Vercel 回滚到上一稳定部署。
2. 配置层回滚：
   - 恢复上一版 env 配置（尤其 `MEDIATION_ALLOWED_ORIGINS`）。
3. 数据层：
   - 本次不包含破坏性 schema 变更，优先通过应用层回滚恢复服务。
