# Ad Aggregation Platform

该子项目对应开发计划中的第一大模块：应用侧广告聚合平台。

## 第一阶段目标

- 提供 AI Native App 可集成的广告位协议。
- 支持从外部资源池拉取候选广告（联盟 / DSP / 自有库存）。
- 支持广告位配置与触发参数管理。

## 当前仓库内交付（结构化基础）

- `schemas/placement.schema.json`：广告位定义
- `schemas/ad-request.schema.json`：应用发起广告请求协议
- `schemas/ad-response.schema.json`：平台返回广告协议
- `schemas/next-step-intent-card-request.schema.json`：`next_step.intent_card` 请求协议
- `schemas/next-step-intent-card-response.schema.json`：`next_step.intent_card` 响应协议
- `schemas/web-search-events.schema.json`：Web Search 链路事件协议
- `schemas/web-search-config.schema.json`：Web Search 链路配置协议
- `schemas/follow-up-events.schema.json`：Follow-up 链路事件协议
- `schemas/follow-up-config.schema.json`：Follow-up 链路配置协议
- `config/default-placements.json`：默认广告位配置
- `config/default-web-search-chain.json`：Web Search 默认配置
- `config/default-follow-up-chain.json`：Follow-up 默认配置
- `docs/phase-1-scope.md`：阶段范围与后续实现清单
- `archive/temporary-docs/sdk-placement-settings-draft.md`：SDK placement 与 trigger 参数设计雏形（归档）
- `docs/sdk-integration-document-spec.md`：SDK 接入文档写作规范与模板
- `docs/next-step-intent-card-contract.md`：`next_step.intent_card` 接口协议（含示例）
- `docs/e2e-next-step-scenarios.md`：Next-Step E2E 场景集（购物/送礼偏好/无商业意图/敏感话题）
- `docs/local-mediation-gateway.md`：本地 Gateway（Dashboard + Mediation 联调）

## 下步实现建议

1. 建立 connectors（联盟/DSP 适配层）
2. 建立 placement config service（配置中心）
3. 建立 trigger engine（触发策略）
4. 建立 delivery API（统一广告输出）

## 环境变量（Production Ready：API + Dashboard）

可复制 `mediation/.env.example` 作为模板。当前上线模式下：

- 生产必需（MVP 首发）：
  - `SUPABASE_DB_URL`
  - `MEDIATION_SETTLEMENT_STORAGE=supabase`
  - `MEDIATION_PRODUCTION_MODE=true`
  - `MEDIATION_REQUIRE_DURABLE_SETTLEMENT=true`
  - `MEDIATION_REQUIRE_RUNTIME_LOG_DB_PERSISTENCE=true`
  - `MEDIATION_DASHBOARD_AUTH_REQUIRED=true`
  - `MEDIATION_RUNTIME_AUTH_REQUIRED=true`
  - `MEDIATION_STRICT_MANUAL_INTEGRATION=true`
  - `MEDIATION_DEV_RESET_ENABLED=false`
  - `MEDIATION_ALLOWED_ORIGINS=<dashboard domain>`
- 供应侧 provider key 为可选：
  - `OPENROUTER_API_KEY` / `CJ_TOKEN` / `PARTNERSTACK_API_KEY` 缺省时允许降级到 no-bid/house ads，不阻断 API 启动。
- 服务边界控制：
  - `MEDIATION_API_SERVICE_ROLE`：`all`（默认）/ `runtime` / `control_plane`
- 本地开发专用：
  - `MEDIATION_GATEWAY_HOST`、`MEDIATION_GATEWAY_PORT` 只用于本地 `dev:gateway`，Vercel 不需要。

House Ads（Supabase）相关可调参数：

- `HOUSE_ADS_SOURCE`：`supabase`（默认）或 `file`
- `HOUSE_ADS_DB_CACHE_TTL_MS`：House offers DB 读取缓存时间（毫秒）
- `HOUSE_ADS_DB_FETCH_LIMIT`：House offers 单次抓取上限

校验命令：

```bash
npm --prefix ./mediation run check:env
```

## House Ads Brand/Offer 库（Supabase）

本项目新增了 House Ads 品牌维表和 Offer 事实表迁移：

- `migrations/0005_house_ads_brand_offer_library.sql`

执行迁移：

```bash
npm --prefix ./mediation run db:migrate
```

## 联调与 Smoke Test

本地联调脚本：

```bash
npm --prefix ./mediation run smoke:ads
```

- 默认 `mock` 模式，不依赖真实网络和密钥，验证一条 query 能返回 `ads[]`。

真实链路 smoke test（会调用 OpenRouter + 联盟接口）：

```bash
npm --prefix ./mediation run smoke:ads:live -- --query="best iphone deals" --answerText="iPhone offers"
```

Next-Step E2E 场景集（购物 / 送礼偏好 / 无商业意图 / 敏感话题）：

```bash
npm --prefix ./mediation run e2e:next-step
```

Meyka 金融场景三段测试（连通性 / 百级 RPM / 收益合理性）：

```bash
# local
npm --prefix ./mediation run meyka:suite -- --env=local

# deployed API (preview/prod)
npm --prefix ./mediation run meyka:suite -- \
  --env=prod \
  --gatewayUrl=https://<api-domain>/api \
  --accountId=<account_id> \
  --appId=<app_id> \
  --runtimeKey=<runtime_api_key> \
  --dashboardToken=<dashboard_access_token>
```

## 本地 Mediation Gateway

用于本地联调 Dashboard 与 Mediation 的配置/决策/指标接口：

```bash
npm --prefix ./mediation run dev:gateway
```

默认监听：`http://127.0.0.1:3100`

## Vercel 部署入口

- Runtime API 入口：`apps/runtime-api/api/[...path].js`
- Control-plane API 入口：`apps/control-plane-api/api/[...path].js`
- Runtime Vercel config：`apps/runtime-api/vercel.json`
- Control-plane Vercel config：`apps/control-plane-api/vercel.json`
- 本地 CLI 入口：`src/devtools/mediation/mediation-gateway.js`（直接执行时才会 `listen`）
