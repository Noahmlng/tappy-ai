# Source

当前已包含两个基础模块：

1. `config/`
- 运行时环境变量读取与校验（`OPENROUTER_API_KEY`、`OPENROUTER_MODEL`、`CJ_TOKEN`、`PARTNERSTACK_API_KEY`）。

2. `ner/`
- 基于 LLM 的 NER 服务封装，输出结构化 JSON。
- 入口：`ner/index.js` -> `extractEntitiesWithLlm(input, options)`
- 输出实体字段：`entityText`、`entityType`、`confidence`、`normalizedText`
