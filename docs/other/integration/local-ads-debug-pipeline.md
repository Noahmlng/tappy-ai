# Local Ads Debug Pipeline（经验沉淀）

- Version: v1.0
- Last Updated: 2026-02-24
- Scope: External Client + Gateway + Dashboard 本地联调（重点排查 `No bid`）

## 1. 目标

把“广告不出 / 看起来是 no bid”拆成可快速定位的问题类型，避免重复踩坑。

## 2. 两种运行模式（先选一种）

### A) 生产近似模式（严格鉴权 + DB 持久化）

用途：验证真实 onboarding/鉴权链路。

特征：
- `MEDIATION_STRICT_MANUAL_INTEGRATION=true`
- `MEDIATION_REQUIRE_RUNTIME_LOG_DB_PERSISTENCE=true`
- `MEDIATION_SETTLEMENT_STORAGE=supabase`
- 默认需要有效 API key。

### B) 本地快速排障模式（推荐日常联调）

用途：先确认“机制和渲染链路是通的”。

建议启动（示例）：

```bash
cd /Users/zeming/Documents/mediation-main
set -a; source ./mediation/.env; set +a
MEDIATION_RUNTIME_AUTH_REQUIRED=false \
MEDIATION_DASHBOARD_AUTH_REQUIRED=false \
MEDIATION_STRICT_MANUAL_INTEGRATION=false \
MEDIATION_REQUIRE_RUNTIME_LOG_DB_PERSISTENCE=false \
MEDIATION_REQUIRE_DURABLE_SETTLEMENT=false \
MEDIATION_SETTLEMENT_STORAGE=state_file \
HOUSE_ADS_SOURCE=file \
node ./mediation/src/devtools/mediation/mediation-gateway.js
```

## 3. 标准联调 Pipeline（可复用）

### Step 1) 启动三服务

```bash
cd /Users/zeming/Documents/mediation-main
npm run dev:dashboard
npm --prefix /Users/zeming/Documents/mediation-chatbot run dev -- --port 3001
# Gateway 按上面的 A/B 模式单独启动
```

默认地址：
- Gateway: `http://127.0.0.1:3100`
- External Client: `http://127.0.0.1:3001`
- Dashboard: `http://127.0.0.1:3002`

### Step 2) 做链路前健康检查

```bash
curl -sS http://127.0.0.1:3100/api/health | jq .
curl -sS http://127.0.0.1:3100/api/v1/dashboard/network-health | jq .
```

### Step 3) 创建/确认有效 runtime key（严格模式必做）

1. Dashboard 注册/登录拿 access token  
2. 调 `POST /api/v1/public/credentials/keys` 创建 staging key  
3. 把 key 注入 External Client：`VITE_ADS_API_KEY=...`

注意：
- `POST /api/v1/dev/reset` 之后，旧 key 可能失效（本次联调踩坑点）。
- 每次 reset 后建议重新签发 key，或先验证 key 是否可用。

### Step 4) 先打一次 API 冒烟，再做 UI

```bash
curl -sS -X POST http://127.0.0.1:3100/api/v2/bid \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <YOUR_KEY>" \
  -d '{
    "userId":"u1",
    "chatId":"c1",
    "placementId":"chat_inline_v1",
    "messages":[
      {"role":"user","content":"best iphone deals"},
      {"role":"assistant","content":"I can help"}
    ]
  }' | jq .
```

预期：
- `status=success`
- `message` 为 `Bid successful` 或 `No bid`
- 有 `requestId`

### Step 5) UI 实测（External Client -> Dashboard）

1. 在 External Client 发送商业意图 query。  
2. 观察是否出现 `Sponsored` 卡片。  
3. 在 Dashboard Logs 确认同一 `requestId` 的 `decision`。  
4. 在 Dashboard Events 确认 `sdk_event/impression`（点击后应出现 `click`）。

### Step 6) 用 requestId 闭环核验

```bash
curl -sS "http://127.0.0.1:3100/api/v1/dashboard/decisions?requestId=<REQUEST_ID>" | jq .
curl -sS "http://127.0.0.1:3100/api/v1/dashboard/events?requestId=<REQUEST_ID>" | jq .
curl -sS http://127.0.0.1:3100/api/v1/dashboard/metrics/summary | jq .
```

## 4. `No bid` 快速分型（核心经验）

### 类型 1：伪 no bid（实际是鉴权失败）

现象：
- External Client Turn Trace 是 `ads_bid_empty`
- 浏览器 console 有 `401 /api/v2/bid`

根因：
- API key 无效/过期/被 reset 后失效。

处理：
- 重新签发 key 并重启 External Client（带新 `VITE_ADS_API_KEY`）。

### 类型 2：`placement_unavailable`（scope 丢失）

现象：
- `/dashboard/decisions` 中 `runtime.reason=placement_unavailable`
- `appId/accountId/placementId` 为空或不匹配

根因：
- 请求没落到正确 app/account scope。

处理：
- 检查 key 绑定的 `accountId/appId/environment`。
- 检查 request 头和 placementId 是否在 scope 内。

### 类型 3：数据源错位（以为读 file，实际读 supabase）

现象：
- 本地有大量 `house` offers 文件，但仍 no bid。
- 运行日志显示 `settlement store mode: supabase` 且 house 读取走 DB。

根因：
- `HOUSE_ADS_SOURCE` 未按预期设置，或 Supabase 库数据不完整。

处理：
- 本地排障优先设 `HOUSE_ADS_SOURCE=file`。
- 严格模式下同步检查 Supabase `house_ads_offers` 数据量与状态。

## 5. 成功判定（Done Definition）

满足以下 4 条即可判定链路打通：

1. `POST /api/v2/bid` 返回 `Bid successful` 且有 `requestId`。  
2. External Client 页面出现 `Sponsored` 卡片。  
3. `decisions` 有同 `requestId` 的 `result=served`。  
4. `events` 有同 `requestId` 的 `sdk_event/impression`（点击后有 `click`）。

## 6. 建议的日常执行顺序

1. 用模式 B 做快速联调，先拿到 1 次完整 served 闭环。  
2. 再切模式 A 做严格鉴权 + DB 持久化验证。  
3. 每次 reset 后先做 API 冒烟，再做 UI。  
4. 所有排障都以 `requestId` 为主线追踪，避免“看页面猜原因”。  
