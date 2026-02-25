# Production Ready 收口部署方案（Vercel：Mediation API + Dashboard，No Chatbot）

- 更新时间：2026-02-25 17:37:16 CST
- 适用范围：`/Users/zeming/Documents/mediation-main` 当前主仓
- 部署范围：仅 `projects/tappy-ai-mediation` 与 `projects/mediation-dashboard`

## 1. 目标与结论

目标是把系统收口到“用户侧只感知 production，不再感知 staging”的上线形态。

当前结论：

1. API 已具备 Vercel Function 拆分入口（`api/runtime.js`、`api/control-plane.js`），外部 API 契约保持不变。
2. 鉴权关键链路已改为 DB-first read-through，跨实例 key/session 漂移风险已收敛。
3. CORS 与 reset 路由已做生产默认收口（allowlist + reset 默认关闭）。
4. Final Check 主门禁已按无 Chatbot 范围复核通过（API integration、API functional p0、Dashboard build）。

## 2. 耦合问题判定（无 Chatbot 版本）

### 2.1 真耦合（已处理）

1. API 入口曾是长驻 `listen` 形态，不适合 Vercel 多实例函数部署。
2. 控制面鉴权数据曾偏内存态，多实例下会出现新 key/新 session 短时不可见。
3. 安全边界偏开发态（CORS `*`、reset 入口默认可开）。

### 2.2 假耦合（文档/变量心智）

1. Dashboard 实际生产必需变量只有 `VITE_MEDIATION_CONTROL_PLANE_API_BASE_URL`。
2. 过去“变量很多”的主因来自 API 历史开发变量，不是 Chatbot 依赖。
3. Chatbot 不部署时，门禁与部署流程可完全剥离，不影响 API + Dashboard 闭环。

## 3. 对外 API 与行为约束（锁定）

对外保持以下契约：

1. `GET /api/v1/mediation/config`
2. `POST /api/v2/bid`
3. `POST /api/v1/sdk/events`

说明：

1. 不恢复 `POST /api/v1/sdk/evaluate`。
2. 收益口径以 `mediation_settlement_conversion_facts` + Dashboard settlement 聚合为准。
3. provider key 可缺省，缺省时允许降级 no-bid/house ads，不阻断 API 可用性。

## 4. 环境变量最小集（No Chatbot）

### 4.1 Mediation API（生产必需）

```bash
SUPABASE_DB_URL=<supabase-postgres-url>
MEDIATION_SETTLEMENT_STORAGE=supabase
MEDIATION_PRODUCTION_MODE=true
MEDIATION_REQUIRE_DURABLE_SETTLEMENT=true
MEDIATION_REQUIRE_RUNTIME_LOG_DB_PERSISTENCE=true
MEDIATION_DASHBOARD_AUTH_REQUIRED=true
MEDIATION_RUNTIME_AUTH_REQUIRED=true
MEDIATION_STRICT_MANUAL_INTEGRATION=true
MEDIATION_DEV_RESET_ENABLED=false
MEDIATION_ALLOWED_ORIGINS=https://dashboard.<your-domain>
MEDIATION_API_SERVICE_ROLE=all
```

### 4.2 Mediation API（可选）

```bash
MEDIATION_DASHBOARD_SESSION_TTL_SECONDS=2592000
MEDIATION_CONTROL_PLANE_REFRESH_THROTTLE_MS=1000
MEDIATION_V2_INVENTORY_FALLBACK=true
OPENROUTER_API_KEY=
OPENROUTER_MODEL=stepfun/step-3.5-flash:free
CJ_TOKEN=
PARTNERSTACK_API_KEY=
```

### 4.3 Dashboard（生产必需）

```bash
VITE_MEDIATION_CONTROL_PLANE_API_BASE_URL=https://control-plane.<your-domain>/api
VITE_MEDIATION_RUNTIME_API_BASE_URL=https://runtime.<your-domain>/api
```

## 5. Vercel 三项目部署方案（not now）

### 5.1 项目创建

1. `mediation-runtime-api`
   - Root Directory: `projects/tappy-ai-mediation`
   - Local Config: `vercel.runtime.json`
2. `mediation-control-plane-api`
   - Root Directory: `projects/tappy-ai-mediation`
   - Local Config: `vercel.control-plane.json`
3. `mediation-dashboard`
   - Root Directory: `projects/mediation-dashboard`

### 5.2 预览部署顺序

```bash
# Runtime API preview
vercel deploy /Users/zeming/Documents/mediation-main/projects/tappy-ai-mediation --local-config /Users/zeming/Documents/mediation-main/projects/tappy-ai-mediation/vercel.runtime.json -y

# Control-plane API preview
vercel deploy /Users/zeming/Documents/mediation-main/projects/tappy-ai-mediation --local-config /Users/zeming/Documents/mediation-main/projects/tappy-ai-mediation/vercel.control-plane.json -y

# Dashboard preview
vercel deploy /Users/zeming/Documents/mediation-main/projects/mediation-dashboard -y
```

### 5.3 生产部署顺序（烟测通过后）

```bash
# Runtime API production
vercel deploy /Users/zeming/Documents/mediation-main/projects/tappy-ai-mediation --local-config /Users/zeming/Documents/mediation-main/projects/tappy-ai-mediation/vercel.runtime.json --prod -y

# Control-plane API production
vercel deploy /Users/zeming/Documents/mediation-main/projects/tappy-ai-mediation --local-config /Users/zeming/Documents/mediation-main/projects/tappy-ai-mediation/vercel.control-plane.json --prod -y

# Dashboard production
vercel deploy /Users/zeming/Documents/mediation-main/projects/mediation-dashboard --prod -y
```

说明：先部署 runtime 与 control-plane API，拿到两个生产域名后回填 Dashboard 的 `VITE_MEDIATION_CONTROL_PLANE_API_BASE_URL` 与 `VITE_MEDIATION_RUNTIME_API_BASE_URL`，再重新部署 Dashboard。

## 6. Final Check 门禁（无 Chatbot）

预部署执行：

```bash
npm --prefix projects/tappy-ai-mediation run test:integration
npm --prefix projects/tappy-ai-mediation run test:functional:p0
npm --prefix projects/mediation-dashboard run build
```

通过标准：

1. 命令全部通过。
2. 外部链路 `config -> v2/bid -> events(postback)` 可复现收益增长。
3. Dashboard `Home + Usage + Quick Start` 可访问，收益与 settlement 聚合一致。

## 7. 部署后烟测清单（Preview/Prod 均执行）

1. API 健康检查（两个域名都验证）：

```bash
curl -sS https://runtime.<your-domain>/api/health
curl -sS https://control-plane.<your-domain>/api/health
```

预期：`ok=true`。

2. 外部开发者闭环：
   - Dashboard 注册/登录
   - 创建 API key
   - `config -> v2/bid -> events(postback)`
   - Usage 收益增长

3. 幂等性：同一 `idempotency_key` 重放 postback 不重复入账。
4. 鉴权：无权 token/key 返回 401/403，且 deny 可审计。
5. 负向 payload：缺字段/非法字段返回稳定错误契约。

## 8. 回滚策略

1. API 回滚：Vercel 切回上一稳定 deployment。
2. Dashboard 回滚：切回上一稳定 deployment（API 保持不变）。
3. 数据层：本次仅兼容增强，无破坏性 schema 变更，优先应用层回滚。

## 9. 拆分路线（为后续项目拆分预埋）

1. 阶段一（单仓拆文件）：拆 `mediation-gateway.js` 为 `runtime-api`、`control-plane-api`、`auth-store`、`settlement-store`、`http-adapter`。
2. 阶段二（拆包不拆部署）：提取 `packages/mediation-runtime-core` 与 `packages/control-plane-core`。
3. 阶段三（拆服务部署）：`mediation-runtime-api` 与 `control-plane-api` 分项目独立扩缩容。
