# 全链路发现报告：设计预设 vs 生产真实执行（修复后可出广告对照版）

- 报告日期：2026-02-28
- 报告时间：2026-02-28 21:23 CST
- 环境：production
- 账号范围：`org_test10_4m2s33`
- 目标 query：`我的女朋友是个 vlogger，我想给她买个 elevenlabs 的会员，帮我对比一下这个和 Murf AI 的产品吧`
- 对照失败样本：`adreq_1772283323005_3ey1zg`（2026-02-28T12:55:23.271Z）
- 对照成功样本：`adreq_1772284212639_3vi9s6`（2026-02-28T13:10:12.712Z）
- 时间窗口：最近 72 小时（截至 2026-02-28 21:00 CST）
- 方法：代码证据 + 生产库证据（decision/event logs + inventory）

## 1. 执行摘要

### 1.1 直接回答

1. 这条中文商业 query 为什么现在能出广告？
- 该请求已通过 intent 门禁并进入完整链路：`intent(ok) -> retrieval(hit) -> ranking(selected) -> delivery(persisted)`。
- 关键证据：`request_id=adreq_1772284212639_3vi9s6`，`reason_code=served`，winner 为 `Murf AI`。

2. 系统是否按你预设 a-e 运行？
- 结论：`部分符合`。
- 符合：存在预分析、检索、候选评分/拍卖、winner 返回。
- 不符合：`/api/v2/bid` 当前是“单 placement 单次决策”，不是“两广告位同轮打包竞价”。

3. 若再次 no-fill，优先看哪里？
- 第 1 优先：`payload_json.runtime.reasonCode`
- 第 2 优先：`payload_json.runtime.stageStatusMap`
- 第 3 优先：`intent / retrievalDebug / rankingDebug` 三块调试字段

### 1.2 72 小时统计（该账号）

1. decision 总量：`11`
2. served：`8`
3. blocked：`3`
4. no_fill：`0`
5. placement 分布：仅 `chat_from_answer_v1`（`11/11`）
6. reasonCode 分布：`served=8`，`policy_blocked=3`

结论：当前账号近 72h 的“无广告”主因不是库存 no_fill，而是策略阻断（policy gate）样本。

---

## 2. 预设链路定义（a-e 可验证化）

1. (a) 数据曝光与维度定义
- 期望：两个广告位完整暴露 input/context/intent/retrieval/ranking/bid 维度。

2. (b) SSP 请求与预分析
- 期望：请求进入竞价前先做分析，并携带分析结果进入后续阶段。

3. (c) 竞价层处理
- 期望：两个广告位打包后一起进入竞价层。

4. (d) 广告库与 DSP-like 逻辑
- 期望：广告库为两个广告位分别给候选报价。

5. (e) 竞价与拍卖
- 期望：形成 options，经过拍卖选 winner 并回传。

---

## 3. 当前实现全景（Runtime / App / 数据）

### 3.1 Runtime API 实际主链路

1. 入口：`POST /api/v2/bid`
- 路由：`mediation/src/devtools/mediation/runtime-routes.js:249-369`
- 统一返回 `status=success`，有 bid 则 `message=Bid successful`，无 bid 则 `message=No bid`。

2. placement 处理（关键）
- 客户端传 `placementId` 会被拒绝：`mediation/src/devtools/mediation/mediation-gateway.js:2514-2520`
- 默认从 dashboard placement 解析（`event=answer_completed`）：`runtime-routes.js:295-304`
- 最终只选一个 placement：`mediation-gateway.js:5736-5745`

3. 消息语义抽取
- query/answer 从最近 messages 推导：`mediation-gateway.js:5869-5913`
- localeHint（CJK -> zh-CN）：`mediation-gateway.js:5863-5867`

4. intent 预分析
- 规则 + 可选 LLM fallback：`mediation/src/runtime/intent-scoring.js:69-190`
- 中文词命中（includes）+ 英文 token 命中：`intent-scoring.js:21-34, 86-108`
- LLM 直连 DeepSeek：`mediation/src/providers/intent/llm-intent-service.js:227-235, 260-271`
- Prompt 压缩：`prompt.js:47-57`

5. 门禁、检索、ranking、winner
- 门禁：intent < threshold => `policy_blocked`：`mediation-gateway.js:6152-6160`
- 检索：`retrieveOpportunityCandidates`：`mediation-gateway.js:6163-6178`
- ranking/auction：`rankOpportunityCandidates`：`mediation/src/runtime/opportunity-ranking.js:153-284`
- 决策 reason 到 result 映射：`mediation-gateway.js:821-835`

6. 决策与事件落库
- decision payload 持久化：`mediation-gateway.js:6573-6629`
- stage/runtime 调试字段写入：`mediation-gateway.js:6292-6317, 6601-6612`

### 3.2 Simple-chat-app 接入实际行为

1. 每轮只发一次 bid
- 前端：`simple-chat-app/public/app.js:217-318`
- 后端代理：`simple-chat-app/server.js:440-538`

2. impression/click 仅在有 bid 时尝试上报
- 前端事件触发：`public/app.js:260-273`
- 后端 events 代理：`server.js:540-605`

3. 关键观测差异
- App 侧只保留 `requestId/bid/rawStatus`，不会把 runtime `decisionTrace/diagnostics` 回传到前端调试面板：`server.js:323-340, 527-533`

### 3.3 合同/维度定义现状

1. v2 bid request schema 仍要求 `placementId`：
- `packages/mediation-sdk-contracts/schemas/v2-bid-request.schema.json:6-13`

2. 运行时明确禁止 `placementId`（以 dashboard 配置为准）：
- `mediation-gateway.js:2514-2520`

3. Next-step slot 有独立 contract：
- `next-step-intent-card-request.schema.json:6-14`
- `next-step-intent-card-response.schema.json:6-13`

---

## 4. 逐环对照矩阵（Expected vs Actual vs Evidence vs Impact）

| 环节 | Expected | Actual | Evidence | Impact | 判定 |
|---|---|---|---|---|---|
| a. 数据曝光与维度 | 两广告位完整维度暴露 | 单 placement 维度完整；双位同轮维度不存在 | `mediation-gateway.js:6292-6317`; decision payload runtime keys | 单位点排障足够；双位同轮分析缺位 | 部分 |
| b. SSP 预分析 | 预分析先行 | 已实现（rule + 可选 LLM fallback） | `intent-scoring.js:150-183`; `llm-intent-service.js:248-254` | 能在门禁前做语义判断 | 是 |
| c. 竞价层打包 | 两位打包同轮竞价 | 实际单 placement 单次决策 | `pickPlacementForRequest` at `5736-5745` | 不能一次拿到两个 placement 结果 | 否 |
| d. 广告库 / DSP-like | 库内检索并给报价 | 已实现（lexical/vector + RRF + economic） | retrieval `141-236`; ranking `120-151` | 可形成候选并计算拍卖分 | 是 |
| e. 拍卖与 winner | options -> auction -> final bid | 已实现（排序、dominance、floor、winner） | `opportunity-ranking.js:215-284` | 可稳定返回单 winner | 是 |

---

## 5. 成功与失败样本回放（同主题 query）

## 5.1 成功样本：`adreq_1772284212639_3vi9s6`

1. input（核心）
- query：中文商业语义（女朋友/买/会员/对比/工具）
- placement：`chat_from_answer_v1`

2. intent 阶段
- `class=gifting`
- `score=1`
- `ruleMeta.matchedKeywords=[礼物, 女朋友, 买, 会员, 对比, 工具]`
- `source=rule`，`llmLatencyMs=0`

3. retrieval 阶段
- `stageStatusMap.retrieval=hit`
- `fusedHitCount=24`, `vectorHitCount=28`, `lexicalHitCount=0`
- filters：`market=US`, `language=en-US`, `networks=[partnerstack,cj,house]`

4. ranking/auction 阶段
- `candidateCount=24`, `eligibleCount=24`
- `topRankScore=0.552902`, `topAuctionScore=0.464883`
- `reasonCode=served`

5. 返回结果
- winner: `Murf AI`
- `targetUrl=https://get.murf.ai/...?...aid=org_test10_4m2s33`

## 5.2 失败样本（修复前）：`adreq_1772283323005_3ey1zg`

1. intent
- `score=0.06`, `class=non_commercial`
- `llm.fallbackReason=missing_llm_config`

2. 门禁
- `rankingDebug.intentBelowThreshold=true`
- `threshold=0.2`
- `reasonCode=policy_blocked`

3. 阶段状态
- `retrieval=blocked`
- `ranking=blocked`
- `ads=[]`

结论：修复前失败点在 intent gate；修复后进入检索与拍卖并 served。

---

## 6. 双广告位行为核对（为什么不是同轮双回传）

1. 系统内确有两个 placement（默认配置）
- `chat_from_answer_v1`：`mediation/config/default-placements.json:3-43`
- `chat_intent_recommendation_v1`：`default-placements.json:45-85`

2. 但 `/api/v2/bid` 当前行为是单 placement
- `pickPlacementForRequest(...)[0]`：`mediation-gateway.js:5736-5745`

3. 账号观测（72h）
- 仅出现 `chat_from_answer_v1`，无 `chat_intent_recommendation_v1`

4. 结论
- 你的预设“同轮两位打包竞价”在当前生产外部契约下未实现。
- second slot 需要独立触发路径（而不是本次 simple-chat-app 的默认一次 bid 流）。

---

## 7. no-fill / blocked 根因树（当前版本）

## 7.1 主因层

1. `policy_blocked`
- 触发条件：blocked topic 或 intent score < threshold
- 证据：`mediation-gateway.js:6145-6160`

2. `inventory_no_match`
- 触发条件：检索候选为 0 或有效候选为空
- 证据：`opportunity-ranking.js:178-189`

3. `rank_below_floor`
- 触发条件：winner rankScore < scoreFloor
- 证据：`opportunity-ranking.js:242-259`

4. `upstream_timeout` / `upstream_error`
- 触发条件：intent 或 retrieval/ranking 阶段异常
- 证据：`mediation-gateway.js:6130-6135, 6230-6236`

## 7.2 映射到最终 result

- `served` -> `served`
- `policy_blocked/placement_unavailable` -> `blocked`
- `inventory_no_match/rank_below_floor/inventory_empty/upstream_*` -> `no_fill`
- 证据：`mediation-gateway.js:821-835`

---

## 8. 可观测性与契约偏差清单

## 8.1 可观测性优点

1. decision log 中 runtime 字段完整：`intent/retrievalDebug/rankingDebug/stageStatusMap/reasonCode`。
2. 可对每个 requestId 还原阶段推进和拦截点。

## 8.2 当前缺口

1. App 侧丢失诊断细节
- runtime 返回有 `decisionTrace + diagnostics`，但 simple-chat-app 最终响应不透传（仅 `bid/requestId/rawStatus`）。

2. 事件链不完整（该账号近 72h）
- event logs：`decision=11`，`sdk_event=1`。
- 多数 served request 未看到 impression/click 上报记录（需确认测试方式是否走了前端事件上报路径）。

3. contract 漂移
- schema 要求 `placementId`，运行时禁止 `placementId`。

---

## 9. 再次 no-fill 的最短排障手册（3-5 步）

1. 第一步：拿 `requestId` 查 decision log
- 看 `payload_json.reason_code` 和 `payload_json.runtime.stageStatusMap`。

2. 第二步：按 stage 定位
- `retrieval=blocked`：先看 `runtime.intent.score` 与 `rankingDebug.intentBelowThreshold`。
- `retrieval=miss`：看 `retrievalDebug.fusedHitCount/vector/lexical` 与 filters。
- `ranking=no_fill`：看 `rankingDebug.scoreFloor/topRankScore/eligibleCount`。

3. 第三步：区分 blocked vs no_fill vs upstream
- `reason_code=policy_blocked`：策略门禁。
- `reason_code=inventory_no_match/rank_below_floor`：业务 no-fill。
- `reason_code=upstream_*`：依赖失败。

4. 第四步：核对 placement 预期
- 该 request 是否只有 `chat_from_answer_v1`。
- 若预期 second slot，检查是否有独立触发调用。

5. 第五步：核对事件上报
- served 后是否有 `/api/v1/sdk/events` 的 impression/click 记录。

---

## 10. 关键 SQL（本报告实际使用）

```sql
-- A. 72h 汇总（账号）
select count(*) as total,
       count(*) filter (where result='served') as served,
       count(*) filter (where result='blocked') as blocked,
       count(*) filter (where result='no_fill') as no_fill
from mediation_runtime_decision_logs
where account_id='org_test10_4m2s33'
  and created_at >= now() - interval '72 hours';

-- B. 72h placement 分布（账号）
select placement_id,
       count(*) as total,
       count(*) filter (where result='served') as served,
       count(*) filter (where result='blocked') as blocked,
       count(*) filter (where result='no_fill') as no_fill
from mediation_runtime_decision_logs
where account_id='org_test10_4m2s33'
  and created_at >= now() - interval '72 hours'
group by placement_id
order by total desc;

-- C. 72h reasonCode 分布（账号）
select coalesce(payload_json->'runtime'->>'reasonCode', payload_json->>'reason_code','') as reason_code,
       count(*) as total
from mediation_runtime_decision_logs
where account_id='org_test10_4m2s33'
  and created_at >= now() - interval '72 hours'
group by 1
order by total desc;

-- D. 指定 request 详情
select created_at, request_id, app_id, placement_id, result, reason,
       payload_json->'runtime'->>'reasonCode' as reason_code,
       payload_json->'runtime'->'stageStatusMap' as stage_status_map,
       payload_json->'runtime'->'intent' as intent,
       payload_json->'runtime'->'retrievalDebug' as retrieval_debug,
       payload_json->'runtime'->'rankingDebug' as ranking_debug,
       payload_json->'ads' as ads
from mediation_runtime_decision_logs
where request_id in ('adreq_1772284212639_3vi9s6', 'adreq_1772283323005_3ey1zg')
order by created_at desc;

-- E. 指定 request 事件轨迹
select created_at, event_type, event, kind, request_id, app_id, session_id, turn_id, placement_id, result, payload_json
from mediation_runtime_event_logs
where request_id in ('adreq_1772284212639_3vi9s6', 'adreq_1772283323005_3ey1zg')
order by created_at asc;

-- F. 品牌库存覆盖（ElevenLabs / Murf）
select offer_id, network, title, target_url, market, language, availability
from offer_inventory_serving_snapshot
where lower(title) like '%eleven%'
   or lower(title) like '%murf%'
   or lower(target_url) like '%eleven%'
   or lower(target_url) like '%murf%';
```

---

## 11. 结论与下一步

1. 当前这条中文 query 已验证能走完整链路并 served。
2. 你的 a-e 预设中，核心差异是“多 placement 同轮打包”这一步；当前生产外部契约是单 placement。
3. 再次遇到 no-bid，不要先看库存；先看 `reason_code + stageStatusMap`，可在 1 分钟内定位到具体阶段。
4. 当前最值得继续下探的点：
- second slot 触发模型（何时、由谁、是否独立请求）
- App 侧是否需要透传 runtime `decisionTrace/diagnostics` 以降低排障成本。
