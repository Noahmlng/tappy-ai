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
- 能力：`listPartnerships`、`listLinksByPartnership`、`listOffers`、`fetchOffers`。
- 内置：基础超时控制 + 429/5xx 重试 + links fallback。

4. `connectors/cj/`
- CJ API connector（Bearer 认证）。
- 能力：`listOffers`、`listProducts`、`listLinks`、`fetchOffers`。
- 内置：多 endpoint fallback、基础超时控制、429/5xx 重试、products/links/offers 合并去重。

5. `offers/`
- UnifiedOffer 归一化层（跨网络统一内部结构）。
- 能力：`normalizeUnifiedOffer`、`normalizeUnifiedOffers`、`mapPartnerStackToUnifiedOffer`、`mapCjToUnifiedOffer`。
- 两个 connector 的 `fetchOffers` 已统一走该层输出。

6. `runtime/`
- Runtime 检索链路（`query/answerText -> LLM-NER -> 多网络检索 -> 合并 -> ads[]`）。
- 入口：`runtime/index.js` -> `runAdsRetrievalPipeline(adRequest, options)`。
- `testAllOffers=true` 时走旁路：跳过匹配过滤与排序截断，仅保留 URL/ID/状态合法性校验。
- 当前 `adResponse.placementId` 固定返回 `attach.post_answer_render`。
- 当前 `ads[]` 输出顺序按网络分组：默认 `partnerstack -> cj -> 其他`。
