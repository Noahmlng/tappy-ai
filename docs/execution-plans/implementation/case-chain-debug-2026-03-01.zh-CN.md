# 线上两条 Case 全链路可解释复盘（2026-03-01）

## 1. 结论先行

1. Case 1（`adreq_1772374177663_50rqvo`）的 `no_fill` 不是“库存里没有 ElevenLabs/Murf”，而是：
- 召回阶段 topK（`vectorTopK=28`/`finalTopK=24`）未召回到这两个品牌；
- 进入排名的 24 个候选又被相关性门槛拦截（`relevance_blocked_strict`，strict=0.58），最终 `eligibleCount=0`。

2. Case 2（`adreq_1772374218951_ydcvt5`）返回 Seamless 的核心原因是：
- 当前检索窗口里入围的是 Seamless/Kixie（不是 ElevenLabs/Murf）；
- 在入围候选中，Seamless 的 `auctionScore=0.525587` 最高，且跨 placement 综合分最高（`compositeScore=0.55902`），因此被选为 winner。

3. ElevenLabs/Murf 在活跃库存中均存在（`active`），但“存在库存”不等于“进入本轮候选集”。本次两条 case 的关键问题在召回窗口与词法匹配策略，而不在最终 95/5 winner 公式。

---

## 2. 取证范围与方法

- 目标 requestId：
  - `adreq_1772374177663_50rqvo`（no-fill）
  - `adreq_1772374218951_ydcvt5`（served: Seamless）
- 数据源（只读）：
  - `mediation_runtime_decision_logs`
  - `opportunity_records`
  - `offer_inventory_serving_snapshot`
  - `offer_inventory_norm`
  - `offer_inventory_embeddings`
- 重放函数（同代码路径）：
  - `retrieveOpportunityCandidates(...)`
  - `rankOpportunityCandidates(...)`
  - `scoreCandidateRelevance(...)`

证据文件：
- [/Users/zeming/Documents/tappy-ai-mediation/mediation/output/debug/case-chain-debug-2026-03-01.json](/Users/zeming/Documents/tappy-ai-mediation/mediation/output/debug/case-chain-debug-2026-03-01.json)

---

## 3. 前端链路边界（为什么你在页面看不到中间分）

线上站点 `https://simple-chatbot-phi.vercel.app/` 的前端调用链是：
- `/api/chat/stream`
- `/api/ads/bid`
- `/api/ads/events`

前端脚本（页面 `/app.js`）观测到：
- `fetch('/api/ads/bid')` 发起广告请求；
- 渲染侧只消费 `bidResult.bid` + `requestId`；
- 页面可见返回字段仅精简层（`ok/requestId/bid/rawStatus/upstreamStatus/.../noFillReason`）。

结论：完整中间计算结果需要通过 `requestId` 回查 runtime decision logs，而不是看前端响应体。

---

## 4. 全局库存事实（ElevenLabs/Murf）

- 活跃库存总量：`20107`
  - `partnerstack=87`
  - `house=20020`
  - `cj=0`
- 关键词命中：
  - `eleven_hits=1`
  - `murf_hits=1`

对应 active 记录：
- `partnerstack:link:part_ibEi6epXfn1DOL` → `Eleven Labs Inc.`
- `partnerstack:link:part_qMk29jl2d3FF7h` → `Murf AI`

且两者在 `offer_inventory_embeddings` 中都有 embedding（`has_embedding=true`）。

---

## 5. Case 1：`adreq_1772374177663_50rqvo`（no-fill）

### 5.1 输入上下文

- query：vlogger + youtube 多语言翻译 + 购买工具（长 query）
- answer：助手推荐 HeyGen/Rask/Captions 等
- placement（最终日志）：`chat_from_answer_v1`

### 5.2 Intent 判定与阈值

- `intent.score=1`
- `intent.class=gifting`
- `stageStatusMap.intent=ok`

说明：Intent 本身没有阻塞。

### 5.3 Retrieval 召回结果

- `filters.networks=[partnerstack, house]`
- `languageMatchMode=locale_or_base`（`en-us/en`）
- `vectorHitCount=28`
- `lexicalHitCount=0`
- `fusedHitCount=24`
- 网络分布（过滤后）：`house=27`, `partnerstack=1`

说明：召回高度偏向 house，partnerstack 只有 1 条进入 fused top24。

### 5.4 Ranking / Relevance Gate

- `relevanceGate.gateStage=blocked`
- `blockedReason=relevance_blocked_strict`
- `strictThreshold=0.58`
- `relaxedThreshold=0.44`
- `strictEligibleCount=0`
- `relaxedEligibleCount=0`
- `filteredCount=24`

说明：24 个候选全被相关性门槛过滤，导致 `eligibleCount=0`。

### 5.5 Multi-placement 决策与最终映射

- `multiPlacement.evaluatedCount=2`
- 两个 placement 都 `reasonCode=inventory_no_match`
- `selectionReason=best_no_fill_after_gate`
- `winnerPlacementId=''`
- 最终：`result=no_fill`, `reasonCode=inventory_no_match`

### 5.6 为什么没出 ElevenLabs/Murf（本 case）

- 词法匹配：
  - ElevenLabs：`lexical_match=false`
  - Murf：`lexical_match=false`
- 向量全库 rank：
  - Murf：`vector_rank=10839`, `vector_score=0.0786`
  - ElevenLabs：`vector_rank=20085`, `vector_score=0.0399`

结论：两者都远在 `vectorTopK=28` 之外，没进候选池；随后候选池还被 strict gate 全拦截。

---

## 6. Case 2：`adreq_1772374218951_ydcvt5`（served: Seamless）

### 6.1 输入上下文

- query 是“case1 长 query + follow-up：how do you feel about Elevenlabs and Murf AI?”
- placement（最终日志）：`chat_intent_recommendation_v1`

### 6.2 Intent 判定与阈值

- `intent.score=1`
- `intent.class=gifting`
- `stageStatusMap.intent=ok`

说明：Intent 不阻塞。

### 6.3 Retrieval 召回结果

- `vectorHitCount=28`
- `lexicalHitCount=0`
- `fusedHitCount=24`
- 网络分布（过滤后）：`house=24`, `partnerstack=4`

说明：比 case1 多了几条 partnerstack，但词法仍是 0，依赖向量召回。

### 6.4 Ranking / Relevance Gate

- `relevanceGate.gateStage=relaxed`
- `strictThreshold=0.62`
- `relaxedThreshold=0.48`
- `strictEligibleCount=0`
- `relaxedEligibleCount=2`
- `filteredCount=22`

入围 top2：
1. Seamless：
   - `relevanceScore=0.53581`
   - `rankScore=0.637534`
   - `auctionScore=0.525587`
2. Kixie：
   - `relevanceScore=0.533901`
   - `rankScore=0.636865`
   - `auctionScore=0.524884`

说明：两者都在 relaxed 阶段过门槛，Seamless 的 auctionScore 最高。

### 6.5 Multi-placement 决策与最终映射

- 95/5 权重已生效：`relevanceWeight=0.95`, `bidWeight=0.05`
- `chat_from_answer_v1`：`compositeScore=0.557204`
- `chat_intent_recommendation_v1`：`compositeScore=0.55902`
- `selectionReason=weighted_relevance_bid`
- `winnerPlacementId=chat_intent_recommendation_v1`
- 最终广告：`Seamless`

### 6.6 为什么没出 ElevenLabs/Murf（本 case）

- 词法匹配：
  - ElevenLabs：`lexical_match=false`
  - Murf：`lexical_match=false`
- 向量全库 rank：
  - Murf：`vector_rank=1898`, `vector_score=0.1793`
  - ElevenLabs：`vector_rank=20090`, `vector_score=0.0359`

结论：Murf 虽然比 case1 明显更近，但仍远超 `topK=28`；ElevenLabs 依旧非常靠后，两者都没进入本轮 24 候选，无法参与后续拍卖。

---

## 7. 根因归纳（跨两条 case）

1. **主要瓶颈在召回，不在最终 winner 公式**
- 95/5 公式只对“已入围候选”生效。
- ElevenLabs/Murf 两条都未入围 top24，公式无法触达。

2. **词法检索对长 query 的 AND 约束极强**
- `websearch_to_tsquery('simple', query)` 在长 query 下几乎不会匹配品牌页文案，导致 `lexicalHitCount=0`。

3. **向量窗口过窄（相对库规模）**
- 2w+ active 库里 `vectorTopK=28`，品牌必须非常靠前才能进入 fused。
- Murf 在 case2 是 `rank 1898`，远超窗口。

4. **from_answer placement 的严格门槛会放大 no-fill**
- case1 在 `chat_from_answer_v1` 上被 `relevance_blocked_strict` 全拦。

---

## 8. 可复现 SQL 与重放命令

### 8.1 决策日志（按 requestId）

```sql
select request_id, created_at, app_id, account_id, placement_id, result,
       payload_json->'runtime'->>'reasonCode' as reason_code,
       payload_json->'runtime'->'stageStatusMap' as stage_status_map,
       payload_json->'runtime'->'intent' as intent,
       payload_json->'runtime'->'retrievalDebug' as retrieval_debug,
       payload_json->'runtime'->'rankingDebug' as ranking_debug,
       payload_json->'runtime'->'multiPlacement' as multi_placement
from mediation_runtime_decision_logs
where request_id in ('adreq_1772374177663_50rqvo','adreq_1772374218951_ydcvt5');
```

### 8.2 机会快照（按 request_key）

```sql
select request_key, placement_id, state,
       payload->'messageContext' as message_context,
       payload->'intent' as intent
from opportunity_records
where request_key in ('adreq_1772374177663_50rqvo','adreq_1772374218951_ydcvt5');
```

### 8.3 Eleven/Murf 库存与 embedding

```sql
select offer_id, network, title, target_url, availability
from offer_inventory_serving_snapshot
where lower(title) like '%eleven%'
   or lower(title) like '%murf%'
   or lower(target_url) like '%eleven%'
   or lower(target_url) like '%murf%';
```

### 8.4 词法匹配检查

```sql
with q as (
  select websearch_to_tsquery('simple', $query) as tsq
)
select n.offer_id,
       ts_rank_cd(to_tsvector('simple', coalesce(n.title,'') || ' ' || coalesce(n.description,'') || ' ' || coalesce(array_to_string(n.tags,' '),'')), q.tsq) as lexical_score,
       (to_tsvector('simple', coalesce(n.title,'') || ' ' || coalesce(n.description,'') || ' ' || coalesce(array_to_string(n.tags,' '),'')) @@ q.tsq) as lexical_match
from offer_inventory_norm n, q
where n.offer_id in ('partnerstack:link:part_ibEi6epXfn1DOL','partnerstack:link:part_qMk29jl2d3FF7h');
```

### 8.5 向量 rank 检查

```sql
with ranked as (
  select n.offer_id,
         row_number() over (order by (e.embedding <=> $query_vector::vector) asc) as vector_rank,
         1 - (e.embedding <=> $query_vector::vector) as vector_score
  from offer_inventory_embeddings e
  join offer_inventory_norm n on n.offer_id=e.offer_id
  where n.availability='active'
    and n.network in ('partnerstack','house')
    and upper(n.market)='US'
    and lower(n.language) in ('en-us','en')
)
select * from ranked
where offer_id in ('partnerstack:link:part_ibEi6epXfn1DOL','partnerstack:link:part_qMk29jl2d3FF7h');
```

---

## 9. 直接回答你的两个问题

1. **“case1 为什么没出 ElevenLabs/Murf？”**
- 两者虽然在库，但本轮都没进召回 top24（向量 rank 太靠后 + 词法不匹配），随后整体候选又被 strict gate 清空。

2. **“case2 为什么相关性看起来低却出了 Seamless？”**
- 因为本轮进入候选池的是 Seamless/Kixie，而 ElevenLabs/Murf 不在池内；在池内比较时 Seamless 的综合拍卖分最高，95/5 只在这个池内生效。
