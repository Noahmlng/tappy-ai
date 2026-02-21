# Mediation 模块设计文档（当前版本）

- 文档版本：v3.0
- 最近更新：2026-02-21
- 文档类型：Design Doc（策略分析 + 具体设计 + 演进规划）
- 当前焦点：当前版本（接入与适配基线）

## 0. 文档定位（Metadata）

本文件同时承载三层信息：
1. 策略与上下文：为什么现在要这么做。
2. 当前版本具体设计：现在到底怎么做。
3. 未来规划：优化项与 SSP 过渡怎么走。

### 0.1 关联文档

1. AI Assistant Placement Framework：`/Users/zeming/Documents/chat-ads-main/docs/ai-assistant-placement-framework.md`

## 1. 模块使命与边界

### 1.1 模块使命

Mediation 的核心使命：
1. 让 AI 应用低成本、低摩擦接入广告网络。
2. 在兼容现有生态前提下，输出更高质量机会。
3. 为后续 SSP 化沉淀标准与能力资产。

### 1.2 模块边界

Mediation 负责：
1. 标准接入框架设计。
2. 外部输入到内部统一模型映射。
3. 多供给源适配与统一回传语义。
4. 基础 placement 编排与路由。
5. 请求-事件闭环基础能力。

Mediation 当前不负责：
1. 完整 SSP 交易层。
2. 完整 DSP 决策层。
3. 高复杂竞价与全量风控。

## 2. 策略层与关键 Context

### 2.1 当前 Context

1. 冷启动阶段，应用方与广告商数量有限。
2. 早期难以直接规模接入 DSP 与大型 Ads Network。
3. 现阶段供给以广告联盟 + 模拟广告库为主。

### 2.2 为什么是 Mediation First

1. 先解决“接得上、跑得通”。
2. 用统一模型避免后续 SSP 阶段返工。
3. 先做稳定闭环，再扩展复杂能力。

### 2.3 Fundamental Design Principles

1. 单入口：应用只接 Mediation。
2. 单模型：外部输入统一到内部机会模型。
3. 单语义：对应用输出统一响应语义。
4. 双链路：请求同步、事件异步，主链路 fail-open。
5. 可演进：结构必须可平滑升级到 SSP 能力。

## 3. 当前版本具体设计（按 Agent Plan 可拆分结构）

### 3.1 本章目标与阅读方式

本章按“可拆分 agent plan 模块”重排，不再按散点能力堆叠。每个模块都用同一结构表达：
1. 职责边界（负责什么，不负责什么）。
2. 输入合同（最小必填语义）。
3. 处理规则（必须冻结的决策逻辑）。
4. 输出合同（下一模块可直接消费）。
5. 审计与版本锚点（可回放、可治理）。

### 3.2 模块链路总览（Execution Graph）

当前版本执行链路固定为：
1. `Module A: SDK Ingress & Opportunity Sensing`
2. `Module B: Schema Translation & Signal Normalization`
3. `Module C: Policy & Safety Governor`
4. `Module D: Supply Orchestrator & Adapter Layer`
5. `Module E: Delivery Composer`
6. `Module F: Event & Attribution Processor`
7. `Module G: Audit & Replay Controller`
8. `Module H: Config & Version Governance`（横切，不在单一节点执行）

链路原则：
1. 同步主链只保证 `Request -> Delivery`。
2. 异步侧链负责 `Event -> Archive`。
3. 主链与侧链通过 `responseReference` 关联。
4. 所有关键决策点必须可审计、可回放、可版本定位。

#### 3.2.1 整体框架：Mediation 与 Ads Network 交互（推荐先看）

边界定义：
1. `Mediation` 负责：机会识别、统一 schema、策略门禁、供给编排、统一 Delivery、事件闭环、审计回放。
2. `Ads Network` 负责：网络侧请求接入、拍卖/竞价、DSP 请求分发、候选结果返回。
3. 当前版本里，`Module D (Supply Orchestrator + Adapter)` 承担连接 Ads Network 的网关职责。
4. 未来向 SSP 过渡时，可把 `Module D` 内部进一步拆成交易子模块（请求、拍卖结果、结算对账）。

请求来回与数据职责：
1. Mediation -> Ads Network：发送标准化机会请求（network bid request）。
2. Ads Network -> Mediation：返回候选结果/无填充/错误（source response）。
3. Mediation -> App：输出 Delivery（`served/no_fill/error + responseReference`）。
4. App -> Mediation：回传 Event（`impression/click/failure`）。
5. Mediation（可选）-> Ads Network：回传归因/结果确认（按网络能力）。
6. 闭环完成判定在 Mediation 内部：`Delivery + terminal Event` 关联后归档。
7. Mediation 主链内部顺序固定为：`Module A -> Module B -> Module C -> Module D -> Module E`。

```mermaid
flowchart LR
    subgraph APP["Application Layer"]
        APP_REQ["App SDK Request"]
        APP_DEL["App Receives Delivery"]
        APP_EVT["App Event Callback"]
    end

    subgraph MED["Our Product: Mediation"]
        A["A SDK Ingress + Opportunity Sensing"]
        B["B Schema Translation + Signal Normalization"]
        C["C Policy + Safety Governor"]
        D["D Supply Orchestrator + Adapter"]
        E["E Delivery Composer"]
        F["F Event Processor"]
        LOOP{"Loop Complete?<br/>Delivery + Terminal Event"}
        TO["Write failure(timeout)"]
        AR["Archive"]
        G["Audit/Replay"]
    end

    subgraph NET["Ads Network Layer"]
        NG["Network Gateway"]
        AX["SSP/Exchange Auction"]
        DSP["DSP Bidders"]
    end

    APP_REQ -->|Opportunity Request| A
    A -->|Opportunity Seed| B
    B -->|Unified Opportunity Schema| C
    C -->|Routable Opportunity| D
    C -->|Policy blocked result| E

    D -->|Network Bid Request| NG
    NG -->|Auction Request| AX
    AX -->|Bid Request| DSP
    DSP -->|Bid Response| AX
    AX -->|Auction Result| NG
    NG -->|Source Response| D

    D -->|Normalized Candidate| E
    E -->|Delivery Response + responseReference| APP_DEL
    APP_DEL -->|User/Agent interaction outcome| APP_EVT

    APP_EVT -->|impression/click/failure + responseReference| F
    F --> LOOP
    LOOP -->|yes| AR
    LOOP -->|timeout/no terminal event| TO
    TO --> AR

    F -. optional attribution callback .-> NG
    AR --> G
```

一句话理解：
1. Ads Network 给的是供给结果，Mediation 给 App 的是统一交付结果（Delivery）。
2. Delivery 不是闭环终点；闭环终点是 Event 到达并与 Delivery 关联后归档。
3. 审计层负责把 Mapping/Routing/Delivery/Event 串成可回放证据链。

### 3.3 Module A: SDK Ingress & Opportunity Sensing

#### 3.3.1 职责边界

1. 承接 SDK 请求入口并做基础规范化。
2. 识别当前对话/任务中是否存在广告机会（opportunity sensing）。
3. 生成机会种子对象，交给下游做标准化翻译。

不负责：
1. 交易级路由决策。
2. 最终 Delivery 组装。
3. 事件归因与结算逻辑。

#### 3.3.2 输入合同（最小）

1. 应用与会话基础信息。
2. placement 触发信息（与 `/Users/zeming/Documents/chat-ads-main/docs/ai-assistant-placement-framework.md` 对齐）。
3. 请求时间与接入通道。
4. 最小追踪上下文（trace key 初始化所需）。

#### 3.3.3 处理规则

1. 统一入口接收后先做输入校验，再进入机会识别。
2. 缺失非关键字段时受控降级，不阻断主链路。
3. 机会识别结果必须给出确定状态：命中机会 / 未命中机会 / 受策略阻断。

#### 3.3.4 输出合同

1. 机会种子对象（状态初始为 `received`）。
2. 机会触发解释摘要（用于审计与排障）。
3. 追踪主键与请求级时间戳。

#### 3.3.5 Ingress Request Envelope（接入请求壳层合同，当前版本冻结）

目标：
1. 给 SDK 一个稳定、可自检的接入壳层，避免“能发请求但语义不完整”。
2. 在进入机会识别前完成最小可信与最小可用校验。
3. 为后续 `Module B` 映射提供结构化输入，不让下游补洞。

Envelope 采用“六块壳层”：
1. `EnvelopeMeta`（required）
   - 请求身份、应用身份、接入时间、接入通道、SDK 声明版本。
2. `PlacementTrigger`（required）
   - placement 身份、触发位置、触发时机、触发类型。
3. `ContextSnapshot`（required）
   - 会话最小上下文、交互主体类型、人/agent 当前阶段。
4. `UserPolicyHints`（optional）
   - 用户设置、应用偏好、实验分桶、调试标记。
5. `TraceBootstrap`（required）
   - trace 初始化信息、上游引用、请求链路关联键。
6. `IntegrityHints`（required）
   - 来源可信信息、签名/令牌校验结果、重放防护标记。

冻结规则：
1. 先冻结六块结构与 required/optional，不在当前版本冻结细字段枚举。
2. required 块缺失时不得进入机会识别主流程。
3. optional 块缺失时走默认策略，不阻断主链路。

#### 3.3.6 Envelope 校验层级与处理动作（当前版本）

Ingress 校验分三层，按顺序执行：
1. `L1 Structural Validation`
   - 校验 Envelope 结构完整性（六块壳层是否满足 required）。
   - 失败动作：直接拒绝并返回结构错误码。
2. `L2 Semantic Validation`
   - 校验关键语义可解释性（placement 可识别、触发类型有效、时间窗口合理）。
   - 失败动作：进入受控降级或受控拒绝（按原因码矩阵）。
3. `L3 Trust Validation`
   - 校验来源可信、重放风险、基础鉴权状态。
   - 失败动作：标记高风险并默认 fail-closed（除非配置显式放行）。

约束：
1. 校验结果必须结构化输出给后续模块，不允许只输出文本日志。
2. 同请求在同规则版本下校验结果必须确定性一致。

#### 3.3.7 Envelope 输出与错误语义（当前版本）

`Module A` 输出分两类：
1. `accepted opportunity seed`
   - 包含：机会种子、校验摘要、trace key、规则版本、初始状态 `received`。
2. `rejected/blocked ingress result`
   - 包含：拒绝类型、原因码、是否可重试、审计关联键。

错误语义最小分类：
1. `structure_invalid`
2. `semantic_invalid`
3. `source_untrusted`
4. `replay_suspected`
5. `policy_blocked_at_ingress`

#### 3.3.8 Envelope 版本与兼容规则（当前版本）

1. Envelope 独立版本线：`ingressEnvelopeVersion`。
2. 向后兼容变更优先走 optional 扩展。
3. 破坏兼容才升级主版本，并提供迁移窗口。
4. 单请求必须记录 `ingressEnvelopeVersion`，保证回放可复现。

#### 3.3.9 验收基线（Module A / Envelope）

1. SDK 可在本地按壳层合同完成请求自检。
2. required 缺失可在 Ingress 层被稳定拦截，不进入 `Module B`。
3. optional 缺失不会造成主链路不可用。
4. 同类异常可命中稳定错误码并在分钟级检索。
5. Ingress 输出可被 `Module B` 直接消费，无需二次补齐。

#### 3.3.10 Auth + Source Trust（仅 Mediation 层，当前版本冻结）

范围边界（避免越界）：
1. 本设计只定义 Mediation Ingress 的“请求鉴权 + 来源可信分级 + 风险处置”。
2. 不定义 DSP/SSP 内部竞价风控细节，不替代 Ads Network 的反作弊系统。
3. 本层目标是“先挡伪流量、再标可信度、再把结果结构化传给下游”。

目标：
1. 在冷启动阶段降低伪流量进入机会识别主链路的概率。
2. 统一来源可信口径，避免同来源在不同链路得到不同处理结果。
3. 给 `Module B/C/D` 输出可消费的可信快照，而非仅日志。

#### 3.3.11 鉴权模型（Ingress Auth Model）

鉴权对象：
1. `app_identity`：应用身份。
2. `sdk_identity`：SDK 发行身份与版本声明。
3. `channel_identity`：接入通道身份。
4. `request_integrity`：请求完整性与签名一致性。

鉴权结果分级：
1. `auth_pass_strong`：强通过（身份与完整性均可信）。
2. `auth_pass_basic`：基础通过（身份可信但完整性能力有限）。
3. `auth_soft_fail`：软失败（可疑但可受控放行）。
4. `auth_hard_fail`：硬失败（拒绝进入主链路）。

约束：
1. 鉴权结果必须落到结构化字段，不允许仅文本备注。
2. `auth_hard_fail` 默认 fail-closed，禁止进入机会识别。
3. `auth_soft_fail` 需绑定风险标记和降级策略后才可继续。

#### 3.3.12 来源可信分级（Source Trust Tier）

当前版本冻结四级可信分层：
1. `T0 Trusted`
   - 已验证应用/渠道，历史行为稳定。
   - 处理动作：正常放行。
2. `T1 Provisionally Trusted`
   - 新接入或样本不足，但鉴权通过。
   - 处理动作：放行 + 强审计 + 可选限流。
3. `T2 Suspect`
   - 命中异常模式、重放风险或身份不一致。
   - 处理动作：默认降级（限流/降权/受控 no-fill），保留人工复核入口。
4. `T3 Blocked`
   - 明确伪造或高风险来源。
   - 处理动作：直接拦截并返回标准拒绝结果。

分级原则：
1. 同请求在同规则版本下分级必须确定性一致。
2. 分级决策必须记录原因码与证据摘要。
3. `T2/T3` 不得静默处理，必须可审计可检索。

#### 3.3.13 风险处置矩阵（Mediation 行为）

按“鉴权结果 + 信任等级”执行统一动作：
1. `auth_pass_strong + T0/T1`
   - 动作：进入主链路。
2. `auth_pass_basic + T1`
   - 动作：进入主链路但附加风险标签与速率控制。
3. `auth_soft_fail + T2`
   - 动作：进入受控降级路径（限制触发频率、限制供给路由、强化审计）。
4. `auth_hard_fail` 或 `T3`
   - 动作：立即拒绝，不进入 `Module B`。

最小原因码集（当前版本）：
1. `auth_token_invalid`
2. `auth_signature_mismatch`
3. `auth_expired_or_replayed`
4. `source_identity_mismatch`
5. `source_trust_blocked`

#### 3.3.14 输出合同与下游消费（A -> B/C/D）

`Module A` 额外输出 `authTrustSnapshot`：
1. `authResult`（strong/basic/soft/hard）
2. `trustTier`（T0/T1/T2/T3）
3. `riskFlags`（重放、身份不一致、异常频率等）
4. `authReasonCode`（最小原因码）
5. `authPolicyVersion`（鉴权策略版本）

下游消费约束：
1. `Module B`：只做映射承载，不改写鉴权结论。
2. `Module C`：可根据 `authTrustSnapshot` 执行策略加强。
3. `Module D`：可根据信任等级执行路由降级，但不得放行 `T3`。

#### 3.3.15 观测与验收基线（Auth + Trust）

核心指标：
1. `auth_pass_rate`
2. `hard_fail_rate`
3. `soft_fail_to_block_rate`
4. `suspect_source_repeat_rate`
5. `false_block_review_overturn_rate`

验收基线：
1. 伪造/重放请求可在 Ingress 层稳定拦截。
2. 来源可信分级可在分钟级检索并回放。
3. `T2/T3` 请求不会误入正常主链路。
4. 鉴权模块故障时默认 fail-safe（不放大风险流量）。
5. Auth/Trust 结果可被下游稳定消费，不引入字段歧义。

#### 3.3.16 Idempotency / De-dup（仅 Mediation Ingress，当前版本冻结）

范围边界：
1. 本设计只覆盖 Mediation Ingress 的重复请求治理。
2. 不约束 Ads Network 内部重复请求处理，不依赖 DSP 侧幂等语义。
3. 目标是“同一业务请求只产生一次有效机会与一次下游调用语义”。

目标：
1. 解决重试、网络抖动、客户端重复发送导致的重复机会问题。
2. 保证同请求在同策略版本下结果可复现。
3. 减少重复下游调用，稳定统计口径与审计口径。

#### 3.3.17 幂等键与去重指纹（冻结）

幂等键优先级（高 -> 低）：
1. `clientRequestId`（SDK 显式提供，首选）。
2. `idempotencyKey`（接入方显式提供）。
3. `canonicalFingerprint`（平台按标准字段计算）。

`canonicalFingerprint` 最小组成：
1. app identity
2. session identity
3. placement identity
4. trigger type + trigger time bucket
5. normalized request payload hash

约束：
1. 同优先级键冲突时按稳定规则裁决（固定排序 + 版本化算法）。
2. 指纹算法版本化管理：`dedupFingerprintVersion`。
3. 幂等键缺失时必须回落到平台指纹，不允许直接放弃去重。

#### 3.3.18 去重窗口与状态机（冻结）

去重窗口（当前版本）：
1. `inflight window`：请求处理中窗口（防并发重复进入）。
2. `result reuse window`：结果复用窗口（重复请求直接复用结果）。
3. `late retry window`：迟到重试窗口（超窗口按新请求处理，但保留关联）。

去重状态机：
1. `new`：首次进入。
2. `inflight_duplicate`：命中处理中重复请求。
3. `reused_result`：命中结果复用窗口并返回复用结果。
4. `expired_retry`：超出去重窗口，按新请求处理并标记重试来源。

状态约束：
1. 同一幂等键同一时刻只允许一个 `new/inflight` 主处理实例。
2. `inflight_duplicate` 不得触发新的下游 supply 调用。
3. 所有状态迁移必须记录时间戳、原因码、策略版本。

#### 3.3.19 重复请求处理动作（Mediation 行为）

动作矩阵：
1. 命中 `inflight_duplicate`
   - 动作：挂起等待主实例结果或返回受控“处理中”语义（按接入模式）。
2. 命中 `reused_result`
   - 动作：直接复用上次标准输出（含 `responseReference` 关联信息）。
3. 命中 `expired_retry`
   - 动作：创建新机会对象，但写入 `retryOf` 关联键用于审计串联。
4. 幂等校验失败（键异常/格式非法）
   - 动作：进入受控拒绝或降级路径，返回标准错误码。

最小原因码集：
1. `duplicate_inflight`
2. `duplicate_reused_result`
3. `dedup_window_expired`
4. `idempotency_key_invalid`
5. `idempotency_store_unavailable`

#### 3.3.20 存储与一致性约束（Ingress De-dup Store）

1. 幂等与去重依赖独立 `dedup store`，作为 Ingress 基础设施。
2. `dedup store` 至少保证：原子写入、原子锁定、状态可查询。
3. 存储异常时默认 fail-safe：
   - 高风险来源（T2/T3）默认拒绝。
   - 低风险来源（T0/T1）按配置受控放行并强审计标记。
4. 任何“受控放行”都必须写入 `dedup_degraded=true` 标记，供后续排查与口径隔离。

#### 3.3.21 输出合同与观测基线（Idempotency / De-dup）

`Module A` 增补输出 `dedupSnapshot`：
1. `idempotencyKeyType`（client/idempotencyKey/fingerprint）
2. `dedupState`（new/inflight_duplicate/reused_result/expired_retry）
3. `dedupReasonCode`
4. `dedupWindowProfile`
5. `dedupPolicyVersion`

下游消费约束：
1. `Module B` 承载 `dedupSnapshot`，不得重算去重结论。
2. `Module D` 仅当 `dedupState=new/expired_retry` 才允许发起 supply 调用。
3. 审计层必须能按幂等键回放所有重复请求分支。

核心指标：
1. `duplicate_request_rate`
2. `inflight_duplicate_rate`
3. `reused_result_rate`
4. `duplicate_supply_call_prevented_rate`
5. `dedup_degraded_rate`

验收基线：
1. 同一请求重试不会重复触发供给调用。
2. 重复请求可稳定复用结果且可审计追溯。
3. 去重策略异常时不会无痕放大重复流量。
4. 幂等结果在同策略版本下可复现。

#### 3.3.22 Opportunity Trigger Taxonomy（机会触发类型字典，当前版本冻结）

范围边界：
1. 本字典只定义 Mediation Ingress 如何识别“机会触发”。
2. 不定义 DSP/SSP 的投放策略，不替代下游竞价逻辑。
3. 目标是统一“什么算一次机会”，避免不同 SDK/应用各自解释。

字典目标：
1. 统一触发语义与命名，保障跨应用、跨 SDK 一致性。
2. 为去重、策略门禁、路由提供稳定前置标签。
3. 让机会识别结果可审计、可比较、可复现。

#### 3.3.23 触发类型分层（冻结）

当前版本冻结两级结构：`triggerCategory` + `triggerType`。

`triggerCategory`（一级）：
1. `explicit_intent`：用户/agent 明确表达商业探索意图。
2. `workflow_transition`：工作流阶段切换产生可触达窗口。
3. `contextual_opportunity`：上下文信号触发机会（非明确意图）。
4. `system_scheduled`：系统按规则定时/定点触发（如 checkpoint）。
5. `policy_forced`：策略侧强制触发或强制抑制后的替代触发。

`triggerType`（二级最小集）：
1. `explicit_query_commercial`
2. `task_stage_entry`
3. `task_stage_exit`
4. `result_summary_checkpoint`
5. `agent_handoff_point`
6. `context_affinity_hit`
7. `time_or_frequency_slot`
8. `policy_override_trigger`

约束：
1. 每个请求必须命中一个主 `triggerType`。
2. 可附加次级 trigger 列表，但主 trigger 只能唯一。
3. 未识别类型统一映射 `unknown_trigger` 并进入受控降级。

#### 3.3.24 机会成立判定（What Counts as Opportunity）

机会成立条件（同时满足）：
1. `triggerType` 合法且可解释。
2. placement 与触发类型在兼容矩阵中允许组合。
3. 当前会话处于可触达窗口（不命中硬抑制策略）。
4. 去重状态允许新机会产生（非 `inflight_duplicate/reused_result` 主路径）。

机会不成立条件（任一命中）：
1. 触发类型非法或不在冻结字典。
2. placement-触发组合不兼容。
3. 命中强抑制策略（如频控硬阈值、高风险来源封禁）。
4. 命中重复请求复用路径且不应新建机会对象。

输出结论：
1. `opportunity_eligible`
2. `opportunity_ineligible`
3. `opportunity_blocked_by_policy`

#### 3.3.25 Trigger Metadata 合同（A 层输出）

`Module A` 增补 `triggerSnapshot`：
1. `triggerCategory`
2. `triggerType`
3. `triggerSource`（user/agent/system/policy）
4. `triggerEvidence`（最小证据摘要）
5. `triggerConfidenceBand`（high/medium/low）
6. `triggerDecision`（eligible/ineligible/blocked）
7. `triggerPolicyVersion`
8. `triggerTaxonomyVersion`

下游消费约束：
1. `Module B` 仅承载并映射，不改写主 trigger 决策。
2. `Module C` 可基于 `triggerDecision` 与 `triggerConfidenceBand` 做策略加强。
3. `Module D` 仅对 `eligible` 机会进入正常路由；其他状态走受控路径。

#### 3.3.26 版本治理与兼容规则（Trigger Taxonomy）

1. 字典独立版本线：`triggerTaxonomyVersion`。
2. 新增触发类型优先“追加”，避免重定义已有语义。
3. 删除或重命名触发类型属于破坏性变更，需主版本升级。
4. 任一请求都必须记录 `triggerTaxonomyVersion` 以支持回放复现。

#### 3.3.27 观测指标与验收基线（Trigger Taxonomy）

核心指标：
1. `trigger_coverage_rate`
2. `unknown_trigger_rate`
3. `eligible_trigger_rate`
4. `trigger_to_delivery_conversion_rate`
5. `cross_sdk_trigger_consistency_rate`

验收基线：
1. 不同 SDK/应用对同类场景应命中一致 trigger 类型。
2. `unknown_trigger_rate` 受控并可持续下降。
3. 触发判定与去重/策略结果无冲突（无同请求多判定）。
4. 单请求可回放“触发 -> 判定 -> 下游处理”完整链路。

#### 3.3.28 Sensing Decision Output Contract（识别结果输出合同，当前版本冻结）

范围边界：
1. 本合同只定义 `Module A -> Module B/C` 的结构化识别结果输出。
2. 不定义下游竞价决策，不替代 `Module C` 的策略裁决。
3. 目标是让识别结果从“描述性文本”升级为“可计算合同对象”。

合同目标：
1. 固定命中类型、置信带、阻断原因、版本快照四类关键字段。
2. 保证同请求同规则版本下识别输出可复现。
3. 为策略门禁、路由和审计提供统一输入，不做二次猜测。

#### 3.3.29 合同对象结构（`sensingDecision`）

`sensingDecision` 必须作为 `Module A` 标准输出对象，字段分层如下：

required：
1. `decisionOutcome`
   - 枚举：`opportunity_eligible` / `opportunity_ineligible` / `opportunity_blocked_by_policy`。
2. `hitType`
   - 枚举：`explicit_hit` / `workflow_hit` / `contextual_hit` / `scheduled_hit` / `policy_forced_hit` / `no_hit`。
3. `confidenceBand`
   - 枚举：`high` / `medium` / `low`。
4. `decisionTimestamp`
   - 识别结果生成时间。
5. `decisionEngineVersion`
   - 识别引擎或规则版本。
6. `sensingDecisionContractVersion`
   - 合同版本号。
7. `traceKey`
   - 关联审计和回放主键。

conditional required：
1. `blockReasonCode`
   - 当 `decisionOutcome=opportunity_blocked_by_policy` 时必填。
2. `ineligibleReasonCode`
   - 当 `decisionOutcome=opportunity_ineligible` 时必填。

optional：
1. `evidenceSummary`
   - 命中证据摘要（不含敏感原文）。
2. `relatedSnapshotRefs`
   - 指向 `triggerSnapshot` / `authTrustSnapshot` / `dedupSnapshot` 的引用。
3. `routingHint`
   - 给 `Module C/D` 的非强制提示（例如 cautious / normal）。

#### 3.3.30 判定一致性与字段约束（冻结）

一致性约束：
1. `hitType=no_hit` 时，`decisionOutcome` 不得为 `opportunity_eligible`。
2. `decisionOutcome=opportunity_blocked_by_policy` 时，必须提供 `blockReasonCode`。
3. `decisionOutcome=opportunity_ineligible` 时，必须提供 `ineligibleReasonCode`。
4. 同请求在同版本下 `decisionOutcome/hitType/confidenceBand` 必须确定性一致。

冲突约束：
1. `triggerSnapshot.triggerDecision` 与 `sensingDecision.decisionOutcome` 不一致时，`sensingDecision` 为主裁决并记录 `decision_conflict_resolved`。
2. 冲突必须带原因码与版本快照，不得静默覆盖。

#### 3.3.31 下游消费合同（A -> B/C/D）

1. `Module B`
   - 承载并映射 `sensingDecision`，不得改写核心字段（outcome/hitType/confidenceBand）。
2. `Module C`
   - 基于 `decisionOutcome + confidenceBand + blockReasonCode` 执行策略加强或拦截确认。
3. `Module D`
   - 仅当 `decisionOutcome=opportunity_eligible` 且未命中硬阻断时允许进入正常供给路由。

消费边界：
1. 下游可追加派生字段，但不得回写 `Module A` 的原始识别结论。
2. 任一模块的派生动作都需保留原始 `sensingDecision` 快照。

#### 3.3.32 原因码最小集与版本治理

`blockReasonCode` 最小集：
1. `blocked_by_policy_hard_cap`
2. `blocked_by_risk_tier`
3. `blocked_by_frequency_hard_limit`
4. `blocked_by_compliance_rule`

`ineligibleReasonCode` 最小集：
1. `no_valid_trigger`
2. `trigger_placement_incompatible`
3. `dedup_reused_path`
4. `context_window_not_reachable`

版本治理：
1. 合同独立版本线：`sensingDecisionContractVersion`。
2. 原因码追加可小版本升级，重命名/删除需主版本升级。
3. 单请求必须记录：`sensingDecisionContractVersion` + `decisionEngineVersion` + `triggerTaxonomyVersion`。

#### 3.3.33 观测指标与验收基线（Sensing Decision）

核心指标：
1. `decision_contract_completeness_rate`
2. `decision_conflict_rate`
3. `blocked_reason_coverage_rate`
4. `ineligible_reason_coverage_rate`
5. `decision_reproducibility_rate`

验收基线：
1. A 层输出必须结构化完整，禁止以文本替代关键字段。
2. 同请求重放时 `decisionOutcome/hitType/confidenceBand` 一致。
3. 被阻断和不成立请求都可追溯到标准原因码。
4. B/C/D 可直接消费合同字段，无需推断性补齐。

#### 3.3.34 Fail-open / Fail-closed Matrix in A（A 层异常处置矩阵，当前版本冻结）

范围边界：
1. 仅定义 `Module A` 内部异常处置，不覆盖 `Module C/D` 的独立策略与路由逻辑。
2. 目标是把“受控降级”变成可执行矩阵，避免线上同类异常出现不一致处理。

处置目标：
1. 高风险异常默认 fail-closed，优先控制风险扩散。
2. 低风险或可恢复异常可 fail-open，但必须带降级标记与审计证据。
3. 同异常、同版本、同风险分级下处置结果必须确定性一致。

#### 3.3.35 处置模式与动作定义（冻结）

处置模式：
1. `fail_open`：允许请求继续，但必须走受控路径并标记降级。
2. `fail_closed`：在 A 层终止主路径，不进入正常机会链路。

动作定义：
1. `continue_normal`：正常继续 A -> B -> C。
2. `continue_degraded`：降级继续（限制字段、限制策略、强化审计）。
3. `short_circuit_reuse`：短路复用/等待（用于 dedup 重复请求路径）。
4. `block_noop`：返回受控不可投放结果（ineligible/blocked）。
5. `block_reject`：直接拒绝请求（结构/鉴权/高风险失败）。

#### 3.3.36 A 层异常处置矩阵（冻结）

| 异常类型 | 典型原因码 | 默认模式 | 默认动作 | 例外条件 |
|---|---|---|---|---|
| 结构缺失/结构非法 | `structure_invalid` | `fail_closed` | `block_reject` | 无 |
| 鉴权硬失败/来源封禁 | `auth_token_invalid`, `source_trust_blocked` | `fail_closed` | `block_reject` | 无 |
| 重放高置信命中 | `auth_expired_or_replayed` | `fail_closed` | `block_reject` | 无 |
| ingress 硬策略阻断 | `policy_blocked_at_ingress` | `fail_closed` | `block_noop` | 无 |
| 去重命中处理中重复 | `duplicate_inflight` | `fail_open` | `short_circuit_reuse` | 无 |
| 去重命中结果复用 | `duplicate_reused_result` | `fail_open` | `short_circuit_reuse` | 无 |
| 语义弱信号/未知触发 | `semantic_invalid`, `no_valid_trigger` | `fail_open` | `continue_degraded` | 若来源为 `T2/T3` 升级为 `fail_closed + block_noop` |
| 去重存储不可用 | `idempotency_store_unavailable` | `fail_open` | `continue_degraded` | 若来源为 `T2/T3` 升级为 `fail_closed + block_reject` |
| A 层内部超时/依赖轻故障 | `ingress_internal_timeout` | `fail_open` | `continue_degraded` | 若同时命中高风险标记则升级 `fail_closed` |

执行优先级（高 -> 低）：
1. 安全与可信阻断（auth/trust/replay）
2. 合规与硬策略阻断
3. 去重短路路径
4. 语义与基础设施降级放行
5. 正常放行

#### 3.3.37 输出合同与观测基线（A 层异常处置）

`Module A` 增补 `aLayerDispositionSnapshot`：
1. `dispositionMode`（fail_open/fail_closed）
2. `dispositionAction`（continue_normal/continue_degraded/short_circuit_reuse/block_noop/block_reject）
3. `dispositionReasonCode`
4. `dispositionPriority`
5. `dispositionPolicyVersion`
6. `dispositionTimestamp`

下游约束：
1. `Module B` 仅承载处置快照，不改写处置模式与动作。
2. `Module C/D` 必须尊重 `fail_closed` 结果，不得强行恢复正常路由。
3. 审计层必须能按 `traceKey + dispositionPolicyVersion` 回放处置决策。

核心指标：
1. `a_fail_open_rate`
2. `a_fail_closed_rate`
3. `a_disposition_consistency_rate`
4. `a_degraded_path_rate`
5. `a_exception_to_supply_leak_rate`

验收基线：
1. 同类异常在同版本下处置一致，无随机分叉。
2. `fail_closed` 请求不会误入 `Module D` 正常供给路径。
3. `fail_open` 请求都带有明确降级标记与原因码。
4. 异常处置可在分钟级检索并完整回放。

#### 3.3.38 Context Extraction Boundary（上下文抽取边界，当前版本冻结）

范围边界：
1. 仅定义 `Module A` 在 Ingress 阶段可抽取的上下文范围与处理方式。
2. 不做跨系统全量数据回拉，不扩展到 DSP/SSP 侧数据处理。
3. 目标是平衡三件事：隐私安全、时延预算、信号有效性。

设计目标：
1. 防止过度抽取导致隐私风险与合规风险。
2. 防止无边界抽取导致时延失控与资源浪费。
3. 防止信号泛滥导致机会识别噪声过高、判定不稳定。

#### 3.3.39 抽取窗口模型（Window Model）

当前版本冻结三层窗口：
1. `turn_window`
   - 当前交互回合的最小必要上下文（优先级最高）。
2. `session_window`
   - 当前会话内有限历史窗口（用于意图连续性与去重辅助）。
3. `task_window`
   - 当前任务阶段的结构化摘要窗口（不拉取全量历史原文）。

窗口规则：
1. 默认先用 `turn_window`，仅在证据不足时升级到 `session_window`。
2. `task_window` 只允许结构化摘要进入，不允许原文大段透传。
3. 任一窗口升级必须记录原因码与升级层级。
4. 超出窗口的数据不得进入 A 层识别输入。

#### 3.3.40 脱敏与最小必要原则（Data Minimization + Redaction）

敏感度分层（用于抽取前判定）：
1. `S0 Public`：可直接使用。
2. `S1 Internal`：可使用但需最小化。
3. `S2 Sensitive`：默认摘要化或哈希化后使用。
4. `S3 Restricted`：默认不进入识别链路，仅保留“存在性标记”。

脱敏规则（冻结）：
1. 识别链路优先消费“结构化标签/摘要”，不消费高敏原文。
2. `S2` 数据进入时必须执行脱敏动作（mask/hash/coarse-grain）。
3. `S3` 数据禁止直接进入 `triggerEvidence` 与 `evidenceSummary`。
4. 所有脱敏动作必须记录 `redactionPolicyVersion` 与动作类型。

最小必要约束：
1. 无法证明对触发判定有增益的字段不得抽取。
2. 同类信号重复抽取时只保留单次有效证据引用。
3. 抽取字段集合必须可配置并可灰度发布。

#### 3.3.41 负载预算与降级策略（Latency/Volume Guardrail）

预算维度：
1. `context_token_budget`：上下文处理 token 预算。
2. `context_time_budget_ms`：A 层上下文抽取时延预算。
3. `context_field_budget`：允许进入判定的字段数量预算。

预算超限处理（按顺序）：
1. 优先裁剪低优先级窗口（task -> session -> turn）。
2. 再降级证据粒度（原文 -> 摘要 -> 标签）。
3. 仍超限时输出 `continue_degraded`，并附带 `context_budget_exceeded`。

约束：
1. 超限降级不得破坏必需字段（trigger/decision/dedup/auth 核心字段）。
2. 降级动作必须写入 `aLayerDispositionSnapshot` 与审计记录。

#### 3.3.42 输出合同与验收基线（Context Boundary）

`Module A` 增补 `contextBoundarySnapshot`：
1. `windowProfile`（turn/session/task 使用情况）
2. `extractionScopeVersion`
3. `redactionPolicyVersion`
4. `sensitivityStats`（S0-S3 命中分布）
5. `budgetUsage`（token/time/field）
6. `budgetDecision`（within_budget/degraded/exceeded_blocked）
7. `boundaryReasonCode`

下游消费约束：
1. `Module B` 仅承载边界快照，不反向请求超边界上下文。
2. `Module C` 可使用 `budgetDecision` 与 `sensitivityStats` 强化策略判断。
3. 审计层必须可回放“抽取窗口 -> 脱敏动作 -> 预算决策”链路。

核心指标：
1. `context_budget_exceeded_rate`
2. `sensitive_data_redaction_coverage_rate`
3. `window_upgrade_rate`
4. `context_extraction_latency_p95`
5. `signal_overload_drop_rate`

验收基线：
1. 抽取范围可配置、可回放、可审计，且无跨边界泄漏。
2. `S2/S3` 数据处理满足脱敏约束，不直接进入可识别原文证据。
3. A 层抽取时延在预算内，超限时按固定策略降级。
4. 抽取结果可稳定支持 trigger 与 sensing 判定，不引入随机漂移。

### 3.4 Module B: Schema Translation & Signal Normalization

#### 3.4.1 统一 Opportunity Schema（共同语言）

当前版本冻结六块骨架：
1. `RequestMeta`
2. `PlacementMeta`
3. `UserContext`
4. `OpportunityContext`
5. `PolicyContext`
6. `TraceContext`

冻结方式：
1. 每块区分 required / optional。
2. 新能力优先放 optional，不破坏主语义。
3. 顶层冻结 `schemaVersion` 与 `state`。

#### 3.4.2 状态机（冻结）

`state` 固定枚举：
1. `received`
2. `routed`
3. `served`
4. `no_fill`
5. `error`

迁移约束：
1. 起始必须 `received`。
2. 终态必须为 `served/no_fill/error` 之一。
3. 任一迁移必须记录时间戳、原因码、规则版本。

#### 3.4.3 外部输入映射与冲突优先级

映射原则：
1. 先映射后决策。
2. 枚举必须归一后才可进入内部模型。
3. 同请求同规则版本下结果必须确定性一致。

冲突优先级（高 -> 低）：
1. `App Explicit`
2. `Placement Config`
3. `Default Policy`

冲突记录要求（每个语义位点）：
1. 原值（raw value）。
2. 归一值（normalized value）。
3. 冲突动作与原因码。
4. 生效规则版本。

#### 3.4.4 旧 SSP 与新增 AI 信号对齐

1. 必兼容旧 SSP 基础语义：请求、placement、环境、响应/回传基础口径。
2. 当前增量 AI 信号：workflow 阶段、human/agent 主体、意图快照、任务上下文。
3. 对外不支持的新信号先内部沉淀，不破坏现有兼容性。

#### 3.4.5 输出合同

1. 可交易的统一机会对象（SSP-like request profile 基底）。
2. 映射审计记录（支持回放）。
3. 下游可直接消费的标准枚举与状态。

### 3.5 Module C: Policy & Safety Governor

#### 3.5.1 职责边界

1. 对统一机会对象做合规、频控、敏感类目与授权范围审查。
2. 给出“可路由”或“受控拦截”结论。
3. 作为路由前置门禁，防止不合规请求进入供给层。

#### 3.5.2 处理规则

1. 强约束命中时允许 fail-closed。
2. 弱约束命中时标记风险并进入受控降级。
3. 所有拦截与放行动作必须输出标准原因码。

#### 3.5.3 输出合同

1. `routable opportunity` 或 `policy-blocked result`。
2. 策略命中轨迹（用于审计与回放）。

### 3.6 Module D: Supply Orchestrator & Adapter Layer

#### 3.6.1 供给范围（当前最小）

1. 广告联盟供给源。
2. 模拟广告库供给源。

#### 3.6.2 Supply Adapter 标准合同（冻结）

每个 adapter 至少实现四件事：
1. `request adapt`
2. `candidate normalize`
3. `error normalize`
4. `source trace`

边界约束：
1. 私有字段只能进 `extensions`。
2. `extensions` 不得污染主语义与核心口径。

#### 3.6.3 路由与降级模型（规则 DAG）

1. 当前版本固定规则 DAG，不引入复杂优化器。
2. 路由顺序固定：`Primary -> Secondary -> Fallback`。
3. 每次切换必须记录原因：`no_fill/timeout/error/policy_block`。

超时与状态：
1. 超时触发下一路由，不阻塞主链路。
2. `no_fill` 为正常无候选。
3. `error` 为处理异常（可重试/不可重试分类）。

可用性边界：
1. 默认 fail-open。
2. 强策略场景允许 fail-closed。

#### 3.6.4 输出合同

1. 标准候选结果集合或空结果。
2. 路由轨迹与降级轨迹。
3. 状态更新（进入 `routed` 并最终走向终态）。

### 3.7 Module E: Delivery Composer

#### 3.7.1 Delivery Schema 职责

1. 只描述“本次返回”。
2. 不承载后续行为事件语义。
3. 输出必须对齐 placement 展示约束与 fail-open 策略。

#### 3.7.2 Delivery / Event 分离（核心冻结）

1. `Delivery Schema`：同步返回对象。
2. `Event Callback Schema`：异步行为对象。
3. 两者只通过 `responseReference` 关联，不相互复制负载。

#### 3.7.3 输出合同

1. 返回状态：`served` / `no_fill` / `error`。
2. `responseReference`（必填）。
3. 可被下游事件与审计直接关联的最小返回快照。

### 3.8 Module F: Event & Attribution Processor

#### 3.8.1 事件合同（当前最小集）

事件最小集冻结：
1. `impression`
2. `click`
3. `failure`

必填语义：
1. `responseReference`
2. 事件类型
3. 事件时间
4. 状态与原因码（适用时）

#### 3.8.2 处理规则

1. 事件必须先归一再归因。
2. 无 `responseReference` 事件进入隔离轨道，不进标准口径。
3. 事件窗口超时时系统补写 `failure` 终态，保证闭环可完成。

#### 3.8.3 输出合同

1. 事件归一记录与关联结果。
2. 闭环终态更新信号。

### 3.9 Module G: Audit & Replay Controller

#### 3.9.1 审计单元

最小审计单元固定为“单机会对象”，必须贯穿全生命周期。

#### 3.9.2 四段关键决策点（冻结）

1. `Mapping`
2. `Routing`
3. `Delivery`
4. `Event`

每段最小字段：
1. 决策类型
2. 时间戳与耗时
3. 输入摘要与输出摘要
4. 状态与原因码
5. 规则版本
6. 关联键（trace key + `responseReference`）

#### 3.9.3 回放基线

1. 支持按 `responseReference` 或 trace key 回放单请求全链路。
2. 回放覆盖 `Request -> Mapping -> Routing -> Delivery -> Event -> Archive`。
3. 审计写入失败不得阻塞主链路，走异步补偿。

### 3.10 Module H: Config & Version Governance（横切模块）

#### 3.10.1 三条版本线分离（冻结）

1. `Schema Version`
2. `Routing Strategy Version`
3. `Placement Config Version`

治理规则：
1. 三线独立发布、独立回滚、独立审计。
2. 任一线升级不得隐式修改其他两线行为。
3. 单请求必须记录三线版本快照。

#### 3.10.2 兼容与回滚

1. schema 变更优先 optional 扩展，破坏兼容才升主版本。
2. 路由策略先灰度再放量，监控 `served/no_fill/error` 与延迟。
3. 回滚顺序按最小影响面：placement -> routing -> schema。

### 3.11 数据闭环模型（Request -> Delivery -> Event -> Archive）

#### 3.11.1 闭环完成条件（冻结）

1. 存在有效 Delivery（`served/no_fill/error`）。
2. 存在终态 Event（当前最小集：`impression/click/failure`）。
3. 二者通过同一 `responseReference` 关联。
4. 窗口超时时系统补写 `failure` 完成闭环。

#### 3.11.2 闭环价值

1. 支撑优化策略验证与质量评估。
2. 支撑对账、审计与争议回放。
3. 作为向 SSP 过渡的数据资产底座。

### 3.12 最小输入接入指南与最小链路清单

#### 3.12.1 SDK 最小接入指南

1. 注册应用与 placement 基础信息。
2. 接入同步请求入口（Delivery）。
3. 接入异步事件回传入口（Event Callback）。
4. 完成联调检查（状态机、追踪、回传关联）。
5. 完成发布检查（灰度配置、回滚预案、审计可见性）。

#### 3.12.2 当前版本最小链路清单

请求链路（同步）：
1. 统一入口接收。
2. 机会识别。
3. schema 翻译与映射归一。
4. 策略门禁。
5. 供给路由与候选归一。
6. Delivery 返回。

事件链路（异步）：
1. impression/click/failure 上报。
2. 事件归一与归因关联。
3. 归档写入与审计回放。
4. 闭环终态确认。

### 3.13 Agent Plan 拆分建议（直接可执行）

为后续拆分具体 agent plan，建议以模块为单位立项，每个 plan 至少包含：目标、输入合同、输出合同、规则版本、审计点、验收标准。

1. Plan-A：`SDK Ingress & Opportunity Sensing`
2. Plan-B：`Schema Translation & Signal Normalization`
3. Plan-C：`Policy & Safety Governor`
4. Plan-D：`Supply Orchestrator & Adapter Layer`
5. Plan-E：`Delivery Composer`
6. Plan-F：`Event & Attribution Processor`
7. Plan-G：`Audit & Replay Controller`
8. Plan-H：`Config & Version Governance`

## 4. 当前版本交付包（Deliverables）

1. 标准接入框架说明。
2. 统一机会建模 Schema 说明。
3. 外部输入映射规则说明。
4. 两类供给适配说明。
5. 回传 Schema 边界说明（Delivery vs Event Callback）。
6. 数据闭环说明。
7. 旧 SSP vs 新 AI 内容边界说明。
8. 最小接入指南与最小链路清单。
9. 联调与发布检查清单。
10. 路由与降级策略模型说明（规则 DAG + fallback 顺序 + 阈值策略）。
11. 可观测与审计模型说明（单机会对象 + 四段关键决策点）。
12. 配置与版本治理说明（三线分离：schema/route/placement）。
13. Agent Plan 模块框架说明（A-H 模块链路）。
14. 模块化链路说明（SDK 接入与机会识别 -> SSP-like 关键信息构建）。
15. Mediation 与 Ads Network 交互边界与流程图说明。
16. Module A Ingress Request Envelope 合同与校验规则说明。
17. Module A Auth + Source Trust 鉴权与可信分级说明（Mediation 范围）。
18. Module A Idempotency / De-dup 幂等与去重规则说明（Mediation 范围）。
19. Module A Opportunity Trigger Taxonomy 机会触发类型字典说明（Mediation 范围）。
20. Module A Sensing Decision Output Contract 识别结果输出合同说明（Mediation 范围）。
21. Module A Fail-open / Fail-closed 异常处置矩阵说明（Mediation 范围）。
22. Module A Context Extraction Boundary 上下文抽取边界说明（Mediation 范围）。

## 5. 优化项与 SSP 过渡（Plan）

### 5.1 优化项：编排与路由扩展

1. 扩展 placement 类型与场景覆盖。
2. 扩展供给路由和回退策略。
3. 在不破坏当前版本标准前提下提升匹配效率。

### 5.2 优化项：返回与回传能力增强

1. 扩展回传事件体系与追踪能力。
2. 强化可观测与审计体系。
3. 为 SSP 过渡准备更完整信号输出结构。

### 5.3 标准化交易接口与 SSP 过渡

1. 把当前稳定能力模块化产品化。
2. 将流量质量、机会分析、意图识别、用户建模逐步升级到 SSP 能力。

#### 5.3.1 标准化交易接口目标（SSP Transition）

1. 将当前 Mediation 的“机会编排接口”升级为“可交易接口”。
2. 对外提供可被 DSP/Ads Network 稳定消费的标准请求、标准回传、标准结算语义。
3. 在兼容旧 SSP 输入标准的同时，输出 AI 场景增量信号，形成差异化质量资产。

#### 5.3.2 交易接口分层（建议标准）

向 SSP 过渡时，接口建议拆成六层并独立版本化：

1. `Bid Opportunity Interface`（请求接口）：
   - 表达可交易机会、上下文、策略约束、时延预算。
2. `Bid Decision Interface`（响应接口）：
   - 表达出价、素材候选、有效期、响应状态与拒绝原因。
3. `Auction Result Interface`（结果通知接口）：
   - 表达中标/未中标、价格结果、清算依据、结果时间。
4. `Delivery Callback Interface`（交付回传接口）：
   - 表达交付状态与展示确认，不承载行为转化语义。
5. `Event Callback Interface`（行为事件接口）：
   - 表达 `impression/click/failure` 最小闭环事件及扩展事件。
6. `Settlement & Reconciliation Interface`（结算对账接口）：
   - 表达账单口径、分润规则、对账批次、差异处理状态。

#### 5.3.3 信息采集层面需要补充的关键项

当前版本已有基础闭环，但向 SSP 过渡仍需补强以下采集维度：

1. 交易上下文信号：
   - `auction_type`、`pricing_model`、`currency`、`floor_policy_snapshot`、`timeout_budget`。
2. 供给路径信号：
   - `source_path`、`adapter_hop`、`fallback_path`、`path_latency_breakdown`。
3. 质量与可见性信号：
   - `view_opportunity_level`、`placement_quality_tier`、`traffic_quality_flags`。
4. 交互与任务信号：
   - `workflow_stage`、`agent_or_human_actor`、`intent_confidence_band`。
5. 结算与对账信号：
   - `settlement_reference`、`billing_scope`、`reconciliation_batch_id`、`dispute_reason`。
6. 合规与授权信号：
   - `consent_scope`、`policy_decision_code`、`restricted_category_flags`。

#### 5.3.4 Schema 层面增补建议（按六块模型）

保持六块统一模型不变，向 SSP 过渡时以“子结构扩展 + optional 字段”方式增强：

1. `RequestMeta` 增补：
   - `transactionContext`（auction/pricing/currency/timeout）。
   - `requestSLA`（tmax、重试预算、降级预算）。
2. `PlacementMeta` 增补：
   - `placementQualityProfile`（quality tier、view opportunity、历史稳定性）。
   - `commercialConstraintProfile`（频控档位、展示密度约束）。
3. `UserContext` 增补：
   - `interactionRole`（human/agent/agent-chain）。
   - `sessionIntentWindow`（多轮意图窗口摘要与置信区间）。
4. `OpportunityContext` 增补：
   - `marketabilitySignals`（可交易性标签、推荐可解释信号）。
   - `executionStageSignals`（任务执行阶段与转化窗口）。
5. `PolicyContext` 增补：
   - `complianceSnapshot`（授权范围、敏感类目策略快照）。
   - `pricingGuardrail`（价格底线策略与策略命中原因）。
6. `TraceContext` 增补：
   - `auctionReference`、`settlementReference`、`reconciliationReference`。
   - `decisionLineage`（映射/路由/拍卖/结算的版本链路）。

#### 5.3.5 当前缺口识别（Collection + Schema）

1. 缺少交易级上下文快照：
   - 当前侧重机会与回传，交易参数采集不完整。
2. 缺少供给路径可解释性：
   - 现有 trace 可回放，但未标准化供给路径拆分指标。
3. 缺少结算级关联键：
   - 已有 `responseReference`，但结算/对账 reference 尚未纳入标准最小集。
4. 缺少质量分层标准：
   - 已有策略与路由，但缺统一的 `placement quality tier` 与 view-opportunity 档位。
5. 缺少接口层分离：
   - Delivery/Event 已分离，但交易结果通知与结算接口仍需单独标准化。

#### 5.3.6 演进落地顺序（建议）

1. Step A（采集与 schema 增强）：
   - 先补齐交易上下文采集与 schema optional 增量，不改变对外兼容。
2. Step B（交易接口灰度）：
   - 引入 `Auction Result Interface` 与 `Settlement/Reconciliation Interface` 草案并灰度。
3. Step C（质量标准化）：
   - 建立质量分层标准与供给路径解释标准，形成可外部消费的质量信号包。
4. Step D（SSP 阶段）：
   - 将六层交易接口版本化发布，提供稳定 SLA 与兼容矩阵。

#### 5.3.7 过渡验收基线

1. 接口层：
   - 六层交易接口都有独立版本与回滚策略。
2. 采集层：
   - 单机会对象可关联到交易、交付、行为、结算四类 reference。
3. Schema 层：
   - 增量字段全部以后向兼容方式引入，接入方无感升级可运行。
4. 运营层：
   - 可对账、可追责、可回放，且能按质量分层输出稳定报表。

### 5.4 优化项路线拆分（当前持续优化 + 未来优化项）

#### 5.4.1 当前正在持续优化的部分

1. 映射与归一稳定性：
   - 冲突裁决一致性、枚举归一覆盖率、异常输入容错能力。
2. 路由与降级可靠性：
   - timeout/no-fill/error 处理准确性、fallback 命中质量、延迟控制。
3. 回传与闭环完整性：
   - `responseReference` 关联成功率、事件丢失率、归档完整率。
4. 可观测与审计效率：
   - 原因码质量、回放成功率、分钟级排障检索能力。
5. placement 触发质量：
   - 触发准确度、去重与频控效果、用户体验影响控制。
6. 配置与版本发布质量：
   - 灰度稳定性、回滚时效、跨版本兼容一致性。

#### 5.4.2 未来具体优化项

1. 交易接口能力增强：
   - 补全拍卖结果、结算对账接口与标准差异处理流程。
2. 流量质量分层体系：
   - 建立 `placement quality tier`、`view opportunity level` 的统一分层标准。
3. Agent 场景策略增强：
   - 增强 human/agent/agent-chain 场景下的触达策略与解释能力。
4. 预测与排序能力升级：
   - 从规则加权逐步升级到可解释的模型化排序与收益预测。
5. 质量信号产品化输出：
   - 形成可被外部网络消费的质量信号包与稳定 SLA。
6. 对账与运营自动化：
   - 建立差异检测、争议处理、账务回溯的自动化闭环。
7. 实验平台化：
   - 建立跨 placement、跨策略、跨供给的统一实验与回收框架。

#### 5.4.3 按核心模块拆分的优化重点

1. `SDK Ingress & Opportunity Sensing`
   - 当前：提升机会识别准确率、降低误触发、优化入口延迟。
   - 未来：支持更复杂的 agent workflow 入口与跨平台接入协议。
2. `Schema Translation & Signal Normalization`
   - 当前：提升映射覆盖率与冲突裁决一致性，强化信号可解释性。
   - 未来：补全交易上下文与质量分层字段，形成稳定的 SSP-like request profile。
3. `Supply Orchestrator` + `Delivery Composer`
   - 当前：提升路由命中质量与返回稳定性，降低 timeout/no-fill 波动。
   - 未来：扩展交易接口层，支持拍卖结果通知与结算对账联动。
4. `Event & Attribution Processor` + `Audit & Replay Controller`
   - 当前：提升事件关联完整率与分钟级排障效率。
   - 未来：实现对账自动化与争议回放自动化。

## 6. 变更记录

### 2026-02-21（v3.0）

1. 在 `3.3` 新增 Context Extraction Boundary，明确 A 层上下文抽取边界仅在 Mediation Ingress 范围生效。
2. 冻结三层抽取窗口模型（turn/session/task）与窗口升级规则。
3. 新增敏感度分层（S0-S3）、脱敏规则与最小必要抽取约束。
4. 新增上下文预算护栏（token/time/field）及超限降级流程。
5. 新增 `contextBoundarySnapshot` 输出合同、核心指标与验收基线，并更新交付包条目。

### 2026-02-21（v2.9）

1. 在 `3.3` 新增 A 层异常处置矩阵（Fail-open / Fail-closed Matrix in A）。
2. 固化处置模式与动作定义（continue/degrade/short-circuit/block），避免“受控降级”语义歧义。
3. 新增“异常类型 -> 默认模式/动作 -> 例外条件”的统一矩阵与执行优先级。
4. 新增 `aLayerDispositionSnapshot` 输出合同及 A->B/C/D 约束。
5. 增加处置一致性核心指标与验收基线，并更新交付包条目。

### 2026-02-21（v2.8）

1. 在 `3.3` 新增 Sensing Decision Output Contract，固化 A->B/C 的结构化识别结果输出。
2. 冻结合同对象 `sensingDecision` 的 required/conditional/optional 字段集。
3. 明确命中类型、置信带、阻断原因、不成立原因与冲突裁决约束。
4. 新增 A->B/C/D 的消费边界，禁止下游改写 A 层原始识别结论。
5. 增加 `sensingDecisionContractVersion` 版本治理、核心指标与验收基线，并更新交付包条目。

### 2026-02-21（v2.7）

1. 在 `3.3` 新增 Opportunity Trigger Taxonomy 设计，冻结“什么算机会”的触发字典边界（Mediation 范围）。
2. 新增两级触发结构（`triggerCategory` + `triggerType`）与最小触发类型集。
3. 定义机会成立/不成立条件与标准输出结论（eligible/ineligible/blocked）。
4. 新增 `triggerSnapshot` 输出合同及 A->B/C/D 消费约束。
5. 增加 `triggerTaxonomyVersion` 版本治理规则、核心指标与验收基线，并更新交付包条目。

### 2026-02-21（v2.6）

1. 在 `3.3` 新增 Idempotency / De-dup 设计，明确仅覆盖 Mediation Ingress 范围。
2. 冻结幂等键优先级与平台去重指纹规则，并引入 `dedupFingerprintVersion`。
3. 新增去重窗口与状态机（`new/inflight_duplicate/reused_result/expired_retry`）。
4. 新增重复请求处理矩阵、最小原因码、`dedup store` 一致性约束与降级策略。
5. 新增 `dedupSnapshot` 输出合同、核心指标与验收基线，并更新交付包条目。

### 2026-02-21（v2.5）

1. 在 `3.3` 新增 Auth + Source Trust 设计，明确仅覆盖 Mediation Ingress 范围。
2. 冻结 Ingress 鉴权结果分级（strong/basic/soft/hard）与来源可信分层（T0/T1/T2/T3）。
3. 新增“鉴权结果 + 信任等级”处置矩阵，明确放行、降级、拦截边界。
4. 新增 `authTrustSnapshot` 下游输出合同，约束 A->B/C/D 消费方式。
5. 增加 Auth/Trust 的核心观测指标与验收基线，并更新交付包条目。

### 2026-02-21（v2.4）

1. 在 `3.3` 新增 Ingress Request Envelope 设计（六块壳层 + required/optional 冻结边界）。
2. 增加 Ingress 三层校验模型（结构/语义/可信）及失败处理动作。
3. 增加 Module A 输出与错误语义分类（accepted seed vs rejected/blocked）。
4. 增加 Envelope 独立版本线 `ingressEnvelopeVersion` 与兼容规则。
5. 在交付包新增 Module A Envelope 合同说明条目。

### 2026-02-21（v2.3）

1. 将 `3.2.1` 流程图中的 `A/B/C` 合并节点拆分为独立模块：`Module A`、`Module B`、`Module C`。
2. 在主流程中明确模块级数据交接：`Opportunity Seed -> Unified Opportunity Schema -> Policy Gate`。
3. 增加策略拦截分支（`Policy blocked result -> Delivery`），避免“只看可路由路径”的误读。
4. 在“请求来回与数据职责”补充主链内部固定顺序：`A -> B -> C -> D -> E`。

### 2026-02-21（v2.2）

1. 将 “Mediation 与 Ads Network 交互流程”从后置章节上移到 `3.2.1`，作为第 3 章整体框架讲解入口。
2. 删除后部重复内容，保留单一权威版本，减少阅读跳转。
3. 保持流程图语义不变，仅调整信息架构顺序，提升团队同步效率。

### 2026-02-21（v2.1）

1. 新增 `3.14`：补充 Mediation 与 Ads Network 的职责边界定义，明确“谁负责交易，谁负责交付与闭环”。
2. 新增主流程 Mermaid 图，标注我们产品与 Ads Network 间的请求/响应来回链路。
3. 明确闭环位置：闭环完成发生在 Mediation 内部 `Delivery + terminal Event -> Archive`，而非仅以供给返回为完成。
4. 更新交付包清单，新增“Ads Network 交互边界与流程图说明”。

### 2026-02-21（v2.0）

1. 将第 3 章重排为“按 Agent Plan 可拆分结构”，统一模块表达模板（职责/输入/规则/输出/审计版本）。
2. 以 A-H 模块重建执行顺序，替代原先按能力散点展开的阅读顺序。
3. 将统一 schema、映射优先级、adapter 合同、Delivery/Event 分离、闭环、路由、审计、版本治理挂接到对应模块。
4. 新增 `3.13` 模块级 plan 拆分建议，便于下一步直接分配子模块设计任务。

### 2026-02-21（v1.9）

1. 以模块链路重构 `3.11`，补充每个核心模块的输入、关键动作与输出。
2. 新增“链路视角”说明，明确如何服务 `SDK 接入与机会识别` 与 `SSP-like bid request key information` 构建。
3. 补回并完善当前版本交付包，新增模块化链路说明条目。
4. 在 `5.4` 增加按核心模块拆分的优化重点，形成可执行的优化路线视图。

### 2026-02-21（v1.8）

1. 新增 `3.11`：补充 Media Agents 层核心模块清单与当前优先落地建议。
2. 新增 `5.4`：拆分优化项路线，明确“当前持续优化”与“未来具体优化项”。
3. 在交付包中加入 Media Agents 模块说明项。

### 2026-02-21（v1.7）

1. 按统一口径去除阶段编号概念，统一为“当前版本 + 优化项”表达。
2. 将“后续规划”重构为“优化项与 SSP 过渡”，避免多套阶段定义并行。
3. 保留原有设计内容与约束，不改变已定义的核心能力边界。

### 2026-02-21（v1.6）

1. 细化 `5.3` 向 SSP 过渡准备，新增标准化交易接口分层蓝图（请求/响应/拍卖结果/回传/结算）。
2. 增加信息采集补强清单，识别交易、供给路径、质量、结算、合规等关键缺口。
3. 增加按六块模型的 schema 增补建议，并给出演进顺序与过渡验收基线。

### 2026-02-21（v1.5）

1. 新增 `3.10` 配置与版本治理，明确其作为稳定迭代与接入兼容的基础能力。
2. 冻结三条版本线分离管理：`schema version`、`routing strategy version`、`placement config version`。
3. 新增兼容性发布规则、版本快照记录、分层回滚策略与验收基线。
4. 在交付包加入配置与版本治理说明。

### 2026-02-21（v1.4）

1. 新增 `3.9` 可观测与审计模型，明确其在排障与运营可控中的基础地位。
2. 冻结“单机会对象”为最小审计单元，并要求全生命周期可追踪。
3. 冻结四段关键决策点：映射、路由、返回、回传。
4. 新增最小审计字段集、可观测视图与验收基线，并加入交付包。

### 2026-02-21（v1.3）

1. 新增关联文档索引，链接回 AI Assistant Placement Framework。
2. 明确 Mediation 设计文档与 placement 产品规范之间的双向对齐关系。

### 2026-02-21（v1.2）

1. 新增 `3.8` 路由与降级策略模型，明确其为当前版本线上可用性核心。
2. 冻结路由引擎形态为规则 DAG，并定义主路由/次路由/fallback 固定顺序。
3. 新增超时阈值、`no_fill` 与 `error` 处理口径，以及 fail-open/fail-closed 边界。
4. 补充路由策略验收基线，并加入交付包清单。

### 2026-02-21（v1.1）

1. 重构 `3.5` 为可判定的数据闭环模型：`Request -> Delivery -> Event -> Archive`。
2. 新增机会对象可追溯约束，要求关键关联键、状态、原因码、规则版本可追踪。
3. 冻结闭环完成条件：有 Delivery 且有终态 Event，并通过同一 `responseReference` 关联。
4. 增加超时兜底终态与单请求全链路回放基线，保障闭环完整性与可排障性。

### 2026-02-21（v1.0）

1. 强化 `3.4.5`：将“回传冲突解决”升级为 Delivery/Event 职责分离设计，并补充重要性说明。
2. 新增 `3.4.6`：冻结 `responseReference` 关联规则与事件最小集（`impression`/`click`/`failure`）。
3. 增加验收基线，确保“返回链路”和“事件链路”解耦且可闭环。

### 2026-02-21（v0.9）

1. 在 `3.4` 新增 “Supply Adapter 标准合同（当前版本冻结）”，明确其作为扩展供给的核心前置条件。
2. 冻结四项必选职责：`request adapt`、`candidate normalize`、`error normalize`、`source trace`。
3. 新增 `extensions` 边界约束：私有字段可保留但不得污染主语义。
4. 新增 Adapter 最小交付检查，作为接入验收基线。

### 2026-02-21（v0.8）

1. 在 `3.3` 补充“输入映射与冲突优先级”的重要性说明，明确其与可复现性的关系。
2. 冻结来源优先级（`app 显式 > placement 配置 > 默认策略`）及冲突裁决约束。
3. 新增枚举归一规范与映射审计记录要求（原值 + 归一值 + 冲突处理 + 规则版本）。

### 2026-02-21（v0.7）

1. 在 `3.2` 明确“统一 Opportunity Schema”的重要性定位（共同语言，避免路由/回传/闭环语义发散）。
2. 冻结六块骨架在当前版本的 required/optional 边界，保持概念层定义。
3. 新增 `schemaVersion` 与 `state`（received/routed/served/no_fill/error）及状态迁移约束。

### 2026-02-21（v0.6）

1. 新增三项核心章节：统一机会建模 Schema、数据闭环、旧 SSP vs 新 AI 内容边界。
2. 将当前版本章节重排为“框架 -> Schema -> 映射 -> 适配 -> 闭环 -> 对接边界 -> 接入清单”。
3. 保留策略分析与优化项规划，避免文档仅剩执行层内容。

### 2026-02-21（v0.5）

1. 重构为“策略 + 上下文 + 当前版本设计 + 后续规划”的一体化设计文档。
