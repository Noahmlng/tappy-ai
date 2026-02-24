# Source

当前已包含两个基础模块：

1. `config/`
- 运行时环境变量读取与校验（`OPENROUTER_API_KEY`、`OPENROUTER_MODEL`、`CJ_TOKEN`、`PARTNERSTACK_API_KEY`）。

2. `ner/`
- 基于 LLM 的 NER 服务封装，输出结构化 JSON。
- 入口：`ner/index.js` -> `extractEntitiesWithLlm(input, options)`
- 输出实体字段：`entityText`、`entityType`、`confidence`、`normalizedText`

3. `connectors/partnerstack/`
- PartnerStack API connector（Bearer 认证）。
- 能力：`listPartnerships`、`listLinksByPartnership`、`listOffers`、`fetchOffers`、`fetchLinksCatalog`、`healthCheck`。
- 内置：基础超时控制 + 429/5xx 重试 + links fallback。

4. `connectors/cj/`
- CJ API connector（Bearer 认证）。
- 能力：`listOffers`、`listProducts`、`listLinks`、`fetchOffers`、`fetchLinksCatalog`、`healthCheck`。
- 内置：多 endpoint fallback、基础超时控制、429/5xx 重试、products/links/offers 合并去重。

5. `offers/`
- UnifiedOffer 归一化层（跨网络统一内部结构）。
- 能力：`normalizeUnifiedOffer`、`normalizeUnifiedOffers`、`mapPartnerStackToUnifiedOffer`、`mapCjToUnifiedOffer`。
- 两个 connector 的 `fetchOffers` 已统一走该层输出。
- 内置：URL canonicalization（参数排序、追踪参数清理）与“同商家同商品”去重。

6. `runtime/`
- Runtime 检索链路（`query/answerText -> LLM-NER -> 多网络检索 -> 合并 -> ads[]`）。
- 入口：`runtime/index.js` -> `runAdsRetrievalPipeline(adRequest, options)`。
- `testAllOffers=true` 时走旁路：跳过匹配过滤与排序截断，仅保留 URL/ID/状态合法性校验。
- 对 `next_step.intent_card`：默认使用 Affiliate links catalog（PartnerStack `listLinksByPartnership` + CJ `listLinks`）作为商品库来源。
- 对 `next_step.intent_card`：在检索前先构建 `IntentCardCatalog`（统一 `item_id/title/url/network/category/tags`），再回填给候选用于匹配与追踪。
- `adResponse.placementId` 与输入 placement 对齐返回（例如 `attach.post_answer_render` / `next_step.intent_card`）。
- 输出顺序：`next_step.intent_card` 按排序结果直接输出；其他 placement 仍按网络分组（默认 `partnerstack -> cj -> 其他`）。
- 非 `testAllOffers` 模式下 v1 排序：相关性优先，其次质量（`qualityScore`），再次商业信号（`bidValue/epc/cpc`），最后可用性与新鲜度作为平局兜底。
- 最小可观测日志事件：`ads_pipeline_result`（字段：`requestId`、`entities`、`networkHits`、`adCount`、`errorCodes`）。
- 内置健康检查与降级：单网失败不影响总返回，支持熔断冷却与快照回退。
- 可通过 runtime 参数调节：`healthFailureThreshold`、`circuitOpenMs`、`healthCheckIntervalMs`，或用 `disableNetworkDegradation=true` 关闭。

7. `cache/`
- 查询缓存（query cache）：缓存整条 pipeline 输出，降低重复查询抖动。
- Offer 快照缓存（offer snapshot cache）：网络报错或空返回时回退到最近快照。
- Runtime 可通过 `options.disableQueryCache`、`options.disableOfferSnapshotCache` 控制开关。

8. `intent/`
- Next-Step 意图推理模块（LLM + JSON Schema 校验）。
- 入口：`intent/index.js` -> `inferIntentWithLlm(input, options)`。
- 输出字段：`intent_class`、`intent_score`、`preference_facets`、`constraints`、`inference_trace`。
- 失败策略：统一回退到 `non_commercial`（score=0, facets=[]）。

9. `intent-card/`
- IntentCardCatalog 归一化模块（面向 `next_step.intent_card`）。
- 入口：`intent-card/index.js`。
- 能力：`normalizeIntentCardCatalog`、`enrichOffersWithIntentCardCatalog`、`summarizeIntentCardCatalog`。
- 向量检索：`createIntentCardVectorIndex(catalog)` + `retrieveIntentCardTopK(index, { query, facets, topK })`。

10. `sdk/`
- 外部开发者前端 SDK shared client。
- 入口：`sdk/client.js` -> `createAdsSdkClient(options)`。
- 核心方法：
  - `fetchConfig`（`/api/v1/mediation/config`）
  - `requestBid`（`/api/v2/bid`）
  - `reportEvent`（`/api/v1/sdk/events`）
  - `runAttachFlow` / `runNextStepFlow`（内部统一执行 `config -> v2/bid -> events`，并内置 fail-open）。
