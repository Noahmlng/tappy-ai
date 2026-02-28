# 全链路发现报告：设计全景 vs 生产真实执行（no-fill / 链路偏离）

- 报告日期：2026-02-28
- 环境：production
- 账号范围：`org_test10_4m2s33`
- 目标 query：`我女朋友是个 vlogger，我想给她买个 Elevenlabs 的会员，帮我对比下 Elevenlabs 和 Murf AI`
- 时间窗口：最近 72 小时（并补充历史对照样本）
- 方法：代码证据 + 生产日志证据 + 离线可复现实验

## 1. 执行摘要

### 1.1 结论（直接回答你的两个问题）

1. 为什么没有 fill，卡在哪里？  
当前这条请求并不是进入检索后 no-fill，而是在检索前被策略门禁拦截：`policy_blocked`。  
主因是 intent 预分析得分仅 `0.06`，低于 `chat_from_answer_v1` 阈值 `0.2`，因此 `retrieval/ranking` 阶段被标记为 `blocked`，未执行正常检索拍卖链路。

2. 系统是否按你预设链路在运行？  
部分符合，部分不符合。  
- 符合：存在“意图分析 -> 检索 -> ranking -> winner”的链路能力。  
- 不符合：生产 `/api/v2/bid` 是单 placement 单次决策，不是“两广告位同轮打包竞价”；且你这次请求在 intent 门禁处提前终止，后续“DSP-like 检索/拍卖”未进入。

### 1.2 本次请求关键证据

- 目标请求：`adreq_1772278514099_ziqa81`（`2026-02-28T11:35:14.256Z`）
- 决策结果：`result=blocked`，`reasonDetail=policy_blocked`
- runtime：
  - `intent.score=0.06`
  - `intent.class=non_commercial`
  - `intent.llm.fallbackReason=missing_llm_config`
  - `rankingDebug.intentBelowThreshold=true`
  - `rankingDebug.threshold=0.2`
  - `stageStatusMap.retrieval=blocked`
  - `stageStatusMap.ranking=blocked`
- 预检库存：`precheck.inventory.ready=true`，`totalOffers=584`（排除“库存空”）

### 1.3 根因分级

- P0：意图门禁误判（中文商业语义未命中规则词 + LLM 路径缺配置回退）
- P1：`/v2/bid` 外部接入为单次单 placement，simple-chat-app 未形成 second slot 调用分支
- P2：契约与实现有偏差点（文档与 schema 对 `placementId` 定义不一致），提升了理解成本

---

## 2. 预设链路定义（按 a-e）

你给出的预设拆解如下：

1. 数据曝光与维度定义：广告位应暴露完整输入/上下文/意图/检索/竞价维度。  
2. SSP 请求与预分析：SSP 在发起请求时先做分析。  
3. 竞价层处理：两个广告位信息打包后发到竞价层。  
4. 广告库与 DSP-like：广告库按 DSP-like 逻辑给两广告位报价。  
5. 拍卖与最终 bid：候选 options 参与 bidding/auction，返回最终 bid。

本报告以以上 5 段为 Expected 侧，与 production Actual 对照。

---

## 3. 当前实现全景图（Runtime / simple-chat-app / DB）

## 3.1 Runtime（`POST /api/v2/bid` 实际链路）

1. 入口与请求归一：
   - `runtime-routes.js:253-326`
   - `normalizeV2BidPayload` 禁止客户端传 `placementId`：`mediation-gateway.js:2514-2520`
2. placement 解析：
   - 默认按 `event='answer_completed'` 解析 dashboard 默认位：`runtime-routes.js:296-304`
   - `pickPlacementForRequest` 仅返回一个 placement：`mediation-gateway.js:5736-5745`
3. opportunity-first 执行：
   - 主流程：`evaluateV2BidOpportunityFirst`：`mediation-gateway.js:5973-6407`
   - `evaluateV2BidRequest` 直接调用它：`mediation-gateway.js:6409-6410`
4. 预分析（intent）：
   - `scoreIntentOpportunityFirst`：`intent-scoring.js:115-155`
   - 规则词主要英文：`intent-scoring.js:3-18`
   - 低分时走 LLM fallback：`intent-scoring.js:125-127`
   - LLM 配置缺失回退：`llm-intent-service.js:242-247`
5. 门禁与检索：
   - 若 `intent.score < intentThreshold`，直接 `policy_blocked`：`mediation-gateway.js:6144-6152`
   - 仅通过门禁后才调用 `retrieveOpportunityCandidates`：`mediation-gateway.js:6155-6171`
6. ranking / auction：
   - ranking：`opportunity-ranking.js:153-284`
   - 候选按 `auctionScore` 排序 + rank dominance 保护：`opportunity-ranking.js:216-241`
7. 输出与落库：
   - 决策写 `mediation_runtime_decision_logs` + event 写 `mediation_runtime_event_logs`：`mediation-gateway.js:6331-6353`、`6606-6620`

## 3.2 Simple-chat-app 接入行为（本次客户）

1. 前端每轮只调用一次 `/api/ads/bid`：`public/app.js:217-318`
2. 后端 `/api/ads/bid` 只代理一次 `/v2/bid`：`server.js:430-523`
3. 有 bid 时才上报 impression/click 事件：`public/app.js:260-273`
4. 未见 second slot（`chat_intent_recommendation_v1`）独立触发逻辑。

## 3.3 数据库存储（本次可观测）

1. 决策日志表：`mediation_runtime_decision_logs`
2. 事件日志表：`mediation_runtime_event_logs`
3. 可用库存快照：`offer_inventory_serving_snapshot`

---

## 4. 逐环对照矩阵（Expected vs Actual vs Evidence vs Impact）

| 环节 | Expected（你的预设） | Actual（生产真实） | Evidence | Impact | 判定 |
|---|---|---|---|---|---|
| a. 维度曝光 | 两广告位都暴露完整维度 | `/v2/bid` 单次只产出一个 placement 的维度；但该 placement runtime 维度较完整（intent/retrieval/ranking/stage/budget） | `mediation-gateway.js:6284-6309`；决策日志 `payload_json.runtime.*` | 可观测深度够，但“跨双位同轮维度”不存在 | 部分 |
| b. SSP 预分析 | SSP 前置分析并驱动后续 | 存在预分析（rule + 可选 LLM fallback）；本次 LLM 配置缺失，回退 rule，得分 0.06 | `intent-scoring.js:122-127`；`llm-intent-service.js:242-247`；request `adreq_1772278514099_ziqa81` | 直接触发阈值拦截，后续不跑检索 | 是（但实现方式与你预设不同） |
| c. 竞价层打包 | 两个广告位打包后一起送竞价 | 实际是单 placement 单次决策；`pickPlacementForRequest` 返回单个 placement | `mediation-gateway.js:5736-5745`；`runtime-routes.js:321-326` | 不会同轮返回两个广告位结果 | 否 |
| d. 广告库 / DSP-like | 两位各自向广告库请求，产候选报价 | 能力上有 DSP-like：本地库存检索 + ranking；但本次请求未进入检索 | `opportunity-retrieval.js:141-236`、`306-417`；`opportunity-ranking.js:153-284`；本次 `stageStatusMap.retrieval=blocked` | 本次链路中该阶段“有能力但未执行” | 部分 |
| e. 拍卖出价 | 生成 options 后拍卖选 winner | 有 ranked/options + winner 逻辑；本次因 policy gate 未进入 | `opportunity-ranking.js:209-270`；本次 `ranking=blocked` | 你看到的是“无填充”，实为“未进拍卖” | 部分 |

---

## 5. no-fill 根因树（主因 / 次因 / 排除项）

## 5.1 主因（P0）

1. 意图分数过低导致预检拦截  
   - 目标请求：`intentScore=0.06`，阈值 `0.2`，`reasonCode=policy_blocked`
   - 阶段状态：`retrieval=blocked`、`ranking=blocked`
2. 低分来源  
   - 规则词库偏英文，中文商业 query 未命中关键商业 token：`intent-scoring.js:3-18`
   - LLM 路径回退 `missing_llm_config`，未完成语义补偿：`llm-intent-service.js:242-247`

## 5.2 次因（P1）

1. 双广告位非同轮默认行为  
   - `/v2/bid` 路径按默认 placement 选一个位（该账号最近 72h 仅看到 `chat_from_answer_v1`）
   - `chat_intent_recommendation_v1` 在系统中存在，但该账号/该接入流未触发常态调用

## 5.3 次因（P2）

1. 契约理解偏差风险  
   - 文档明确 `/v2/bid` 禁止 `placementId`（正确）
   - 但 schema 文件仍要求 `placementId`（历史残留/契约漂移）

## 5.4 已排除项

1. 不是库存空  
   - 预检 `totalOffers=584, ready=true`
   - 库存中存在 `Murf AI` 与 `Eleven Labs Inc.`
2. 不是系统普遍 no_fill  
   - 72h 全局：`served=109`，`blocked=25`，`no_fill=1`（且该 no_fill 是 `rank_below_floor`）
3. 不是 runtime HTTP 错误  
   - 本次有正常 decision/event 落库，属于业务级 blocked

---

## 6. 双广告位行为核对（为何未同轮返回）

## 6.1 事实

1. simple-chat-app 每轮只有一次 `/v2/bid` 请求。
2. `/v2/bid` 解析 placement 时默认走 `answer_completed` 语义。
3. `pickPlacementForRequest` 返回单个 placement，非多位打包。

## 6.2 对本账号的观测

1. 最近 72h：`chat_from_answer_v1` 共 3 次（2 served + 1 blocked）
2. 最近 72h：`chat_intent_recommendation_v1` 为 0 次
3. 同 request/session（`adreq_1772278514099_ziqa81`）仅一条 decision event，无 second slot 轨迹

## 6.3 推断（基于证据）

推断：你预设中的“两广告位同轮回传”当前不属于 `/v2/bid` 的默认外部契约行为；second slot 更像是独立触发路径，而非本次集成代码中的同轮并发路径。

---

## 7. 可观测性与契约偏差清单

## 7.1 可观测性现状

1. 优点  
   - `decision_logs` runtime 字段完整，足以定位“卡在意图门禁还是检索/排名/交付”。
2. 缺口  
   - 对“multi-slot 预期”没有同一 request 的多 placement 聚合视图，因为当前契约本身即单 placement 决策。

## 7.2 契约偏差

1. 文档 vs schema  
   - 文档：`/v2/bid` 禁止传 `placementId`（`03-api-sdk-reference.md:39-41`）
   - 运行时：确实禁止（`mediation-gateway.js:2514-2520`）
   - schema：仍将 `placementId` 设为 required（`v2-bid-request.schema.json:6-13`）
2. 设计预设 vs 生产外部接口  
   - 预设倾向“多位打包竞价”
   - 生产外部接口是“单次 winner/no-bid 决策”

---

## 8. 附录（SQL、请求样例、字段字典、requestId 轨迹）

## 8.1 目标 requestId 轨迹

### A) 决策日志（核心字段）

- `request_id`: `adreq_1772278514099_ziqa81`
- `placement_id`: `chat_from_answer_v1`
- `result`: `blocked`
- `runtime.reasonCode`: `policy_blocked`
- `runtime.intent.score`: `0.06`
- `runtime.intent.llm.fallbackReason`: `missing_llm_config`
- `runtime.rankingDebug.intentBelowThreshold`: `true`
- `runtime.rankingDebug.threshold`: `0.2`
- `runtime.stageStatusMap`: `intent=ok`, `retrieval=blocked`, `ranking=blocked`, `delivery=persisted`

### B) 事件日志（同 request）

- 仅 1 条 `event_type=decision`，`event=v2_bid_request`，`result=blocked`
- 无 `sdk_event impression/click`（因为没有 bid 返回）

## 8.2 SQL 样例（本报告使用）

```sql
-- 1) 目标请求详情
select created_at, request_id, placement_id, result, reason,
       payload_json->'runtime'->>'reasonCode' as reason_code,
       payload_json->'runtime'->'intent'->>'score' as intent_score,
       payload_json->'runtime'->'intent'->'llm'->>'fallbackReason' as llm_fallback_reason,
       payload_json->'runtime'->'rankingDebug'->>'threshold' as threshold,
       payload_json->'runtime'->'stageStatusMap' as stage_status_map
from mediation_runtime_decision_logs
where request_id = 'adreq_1772278514099_ziqa81';

-- 2) 同 request 的 event 轨迹
select created_at, event_type, event, kind, request_id, session_id, placement_id, result
from mediation_runtime_event_logs
where request_id = 'adreq_1772278514099_ziqa81'
order by created_at asc;

-- 3) 72h placement 分布（账号）
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

-- 4) 库存品牌覆盖检查
select offer_id, network, title, target_url, market, language, availability
from offer_inventory_serving_snapshot
where lower(title) like '%eleven%'
   or lower(title) like '%murf%'
   or lower(target_url) like '%eleven%'
   or lower(target_url) like '%murf%';
```

## 8.3 字段字典（本次定位最关键）

1. `payload_json.runtime.reasonCode`：最终失败/成功原因（`served/policy_blocked/rank_below_floor/...`）  
2. `payload_json.runtime.stageStatusMap`：各阶段状态（`intent/retrieval/ranking/delivery/...`）  
3. `payload_json.runtime.intent.*`：意图得分、类别、来源、LLM fallback 信息  
4. `payload_json.runtime.retrievalDebug.*`：检索命中计数与检索参数  
5. `payload_json.runtime.rankingDebug.*`：排序/拍卖调试信息（例如 `intentBelowThreshold`、`scoreFloor`）  

## 8.4 离线复现实验（同 query）

1. 检索能力验证（绕过线上 gate 直接跑 retrieval）  
   - `fusedHitCount=24`，命中 `Murf AI` 候选，库存非空。
2. ranking 验证  
   - `intentScore=0.82` 时：`reasonCode=served`，winner=`Murf AI`  
   - `intentScore=0.06` 时：`reasonCode=rank_below_floor`  
3. 结论  
   - 线上真实失败点是“意图门禁提前拦截”；不是“检索库没有 ElevenLabs/Murf”。

## 8.5 验证场景矩阵（本轮调研结果）

| 场景 | 结果 | 证据 |
|---|---|---|
| 1. 中文商业 query（当前失败样例） | blocked (`policy_blocked`) | `adreq_1772278514099_ziqa81` |
| 2. 英文商业 query（对照） | served | `adreq_1772278427402_vwqnxu` (`best iphone deals`) |
| 3. 强品牌词（ElevenLabs/Murf） | 库存有命中；离线可 served | `offer_inventory_serving_snapshot` + 离线 ranking |
| 4. 非商业 query | 预期 blocked，72h 样本确有大量 `policy_blocked` | 72h blocked 分布查询 |
| 5. 双广告位同轮 | 当前未形成同轮常态 | 账号 72h placement 分布 + simple-chat-app 单调用 |
| 6. LLM config 缺失 vs 存在 | 缺失时回退 rule 并压低意图分 | `fallbackReason=missing_llm_config` + `llm-intent-service.js:242-247` |

---

## 9. 最小验证回归矩阵（用于后续改造验收）

1. 中文商业 query（目标样例）  
   - 验收：`reasonCode` 不再固定 `policy_blocked`；至少进入 `retrieval=hit/miss`，而非 `retrieval=blocked`。
2. 强品牌词 query（ElevenLabs/Murf）  
   - 验收：在 intent 达阈值时可稳定产出 winner（served）。
3. second slot 场景  
   - 验收：明确是“同轮双位”还是“两次独立触发”；日志需能分辨两个 placement 的 request 轨迹。
4. 契约一致性  
   - 验收：`/v2/bid` 文档、schema、运行时三者关于 `placementId` 规则一致。

---

## 10. 结论归档

1. 本次问题本质：`policy_blocked`（intent gate），不是库存 no-fill。  
2. 你的“两个广告位同轮出价并回传”预设，当前并非 `/v2/bid` 外部默认实现。  
3. 现网链路具备检索+ranking+winner 能力，但本请求未进入该阶段。  
4. 优先排查方向：intent 分析链路（中文商业识别 + LLM 配置可用性）与 second slot 触发模型定义。
