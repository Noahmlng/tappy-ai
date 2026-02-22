# Mediation Contract Catalog (A-H)

- Version: v1.0
- Date: 2026-02-21
- Source index: `/Users/zeming/Documents/chat-ads-main/docs/design/mediation/INDEX.md`
- Source modules: `/Users/zeming/Documents/chat-ads-main/docs/design/mediation/modules/`

## Catalog Usage

1. 本文是 A-H 合同速查索引，不替代模块原文细则。
2. 每个模块固定给出：核心接口、输入合同、输出合同、关键事件、原因码段、版本锚点字段。
3. 后续实现任务默认以本文合同名作为接口与测试命名基线。

## Global Keys

1. 主链路主键：`traceKey`、`requestKey`、`attemptKey`、`opportunityKey`。
2. Delivery/Event 关联键：`responseReference`、`renderAttemptId`。
3. 闭环键：`closureKey = responseReference + "|" + renderAttemptId`（F/G）。
4. 版本锚点总原则：由 H 注入 `versionAnchorSnapshot`，A->G 全链路透传。

## Module A: SDK Ingress & Opportunity Sensing

### 核心接口

1. `trigger(placement_id, app_context)`（同步入口）
2. `createOpportunity(opportunity_v1)`（机会对象创建）

### 输入合同

1. `aTriggerRequestLite`
2. `opportunity_v1`

### 输出合同

1. `aTriggerSyncResultLite`
2. `aCreateOpportunityResultLite`
3. `aOpportunityCreatedEventLite`
4. `aOpportunityEventAckLite`

### 关键事件

1. `opportunity_created`

### 原因码段

1. 触发与入口：`a_trg_*`
2. 创建机会：`a_cop_*`
3. 事件发送与 ACK：`a_oc_emit_*`

### 版本锚点字段

1. `ingressEnvelopeVersion`
2. `triggerContractVersion`
3. `createOpportunityContractVersion`
4. `opportunityEventContractVersion`
5. `triggerTaxonomyVersion`
6. `dedupFingerprintVersion(a_dedup_v1)`

### 引用章节

1. `module-a-sdk-ingress-opportunity-sensing.md` `3.3.10`~`3.3.30`

## Module B: Schema Translation & Signal Normalization

### 核心接口

1. `A -> B` 输入归一（`bIngressPacketLite`）
2. 统一对象输出（`bNormalizedOpportunityLite`）
3. OpenRTB 投影与审计输出

### 输入合同

1. `bIngressPacketLite`

### 输出合同

1. `bNormalizedOpportunityLite`
2. `mappingAuditSnapshotLite`
3. `projectionAuditSnapshotLite`
4. `redactionSnapshotLite`
5. `bucketAuditSnapshotLite`

### 关键事件

1. `signal_normalized`（`bSignalNormalizedEventLite`）
2. `bSignalNormalizedEventAckLite`

### 原因码段

1. 通用与合同：`b_missing_*`, `b_invalid_*`, `b_optional_*`
2. 冲突裁决：`b_conflict_*`
3. 投影：`b_proj_*`
4. 脱敏：`b_redaction_*`
5. 分桶：`b_bucket_*`, `b_appctx_*`
6. 事件采样与发送：`b_sig_evt_*`

### 版本锚点字段

1. `bInputContractVersion`
2. `schemaVersion`
3. `mappingProfileVersion`
4. `enumDictVersion`
5. `conflictPolicyVersion`
6. `openrtbProjectionVersion`
7. `redactionPolicyVersion`
8. `bucketDictVersion`
9. `signalNormalizedEventContractVersion`
10. `samplingRuleVersion`

### 引用章节

1. `module-b-schema-translation-signal-normalization.md` `3.4.6`~`3.4.43`

## Module C: Policy & Safety Governor

### 核心接口

1. `evaluate(opportunity_v1, policy_snapshot) -> governor_decision`

### 输入合同

1. `cPolicyInputLite`

### 输出合同

1. `cPolicyDecisionLite`
2. `constraintsLite`
3. `policyAuditSnapshotLite`

### 关键事件

1. 无独立业务事件；关键审计对象：`policyAuditSnapshotLite`

### 原因码段

1. 策略与输入校验：`c_*`（如 `c_missing_required_field`, `c_invalid_version_anchor`）

### 版本锚点字段

1. `cInputContractVersion`
2. `schemaVersion`
3. `mappingProfileVersion`
4. `enumDictVersion`
5. `conflictPolicyVersion`
6. `policySnapshotVersion`
7. `policySnapshotId`
8. `policyPackVersion`
9. `policyRuleVersion`
10. `resolvedConfigRef`
11. `configHash`

### 引用章节

1. `module-c-policy-safety-governor.md` `3.5.4`~`3.5.20`

## Module D: Supply Orchestrator & Adapter Layer

### 核心接口

1. `request adapt`
2. `candidate normalize`
3. `error normalize`
4. `source trace`
5. Route Plan / Execution Strategy（`waterfall`/`bidding`/`hybrid`）

### 输入合同

1. `dOrchestrationInputLite`
2. `executionStrategyLite`
3. `adapterRegistryEntryLite`

### 输出合同

1. `dToEOutputLite`
2. `auctionDecisionLite`
3. `routeConclusion`
4. `routeAuditSnapshotLite`

### 关键事件

1. 无独立业务事件；关键审计对象：`routeAuditSnapshotLite`

### 原因码段

1. 路由/输入/策略/候选：`d_*`

### 版本锚点字段

1. `dInputContractVersion`
2. `dOutputContractVersion`
3. `routingPolicyVersion`
4. `fallbackProfileVersion`
5. `executionStrategyVersion`
6. `constraintSetVersion`
7. `policySnapshotVersion`
8. `configSnapshotId`
9. `resolvedConfigRef`
10. `configHash`
11. `effectiveAt`

### 引用章节

1. `module-d-supply-orchestrator-adapter-layer.md` `3.6.5`~`3.6.33`

## Module E: Delivery Composer

### 核心接口

1. `compose(auction_result, placement_spec, device_capabilities) -> render_plan`

### 输入合同

1. `eComposeInputLite`
2. `dToEOutputLite`
3. `placementSpecLite`
4. `deviceCapabilitiesLite`

### 输出合同

1. `renderPlanLite`
2. `eDeliveryResponseLite`（E 对 App 最终输出）
3. `eToFEventLite`（E -> F 事件输出）
4. `renderCapabilityGateSnapshotLite`
5. `eValidationSnapshotLite`
6. `eErrorDegradeDecisionSnapshotLite`

### 关键事件

1. 渲染追踪：`ad_render_started`, `ad_rendered`, `ad_render_failed`
2. 映射到 F：`impression`, `click`, `failure`

### 原因码段

1. no-fill：`e_nf_*`
2. error：`e_er_*`
3. 过程门禁/校验：`e_gate_*`, `e_policy_*`, `e_material_*`, `e_ui_*`, `e_disclosure_*`, `e_compose_*`

### 版本锚点字段

1. `eComposeInputContractVersion`
2. `renderPlanContractVersion`
3. `eDeliveryContractVersion`
4. `renderPolicyVersion`
5. `placementConfigVersion`
6. `trackingInjectionVersion`
7. `uiConstraintProfileVersion`
8. `dOutputContractVersion`
9. `routingPolicyVersion`
10. `constraintSetVersion`
11. `eventContractVersion`

### 引用章节

1. `module-e-delivery-composer.md` `3.7.4`~`3.7.40`

## Module F: Event & Attribution Processor

### 核心接口

1. `POST /events`
2. 事件归一 + 去重 + 终态闭环 + 计费归因

### 输入合同

1. `eventBatchRequestLite`
2. `sdkEventLite`

### 输出合同

1. `eventBatchAckLite` / `ackItemLite`
2. `billableFactLite`
3. `attributionFactLite`
4. `factDecisionAuditLite`
5. `fToGArchiveRecordLite`

### 关键事件

1. SDK 输入 canonical：`opportunity_created`, `auction_started`, `ad_filled`, `impression`, `click`, `interaction`, `postback`, `error`
2. F 归一终态：`impression`, `failure`

### 原因码段

1. 事件校验/ACK：`f_event_*`, `f_dedup_*`
2. 闭环与冲突：`f_terminal_*`, `f_billing_*`
3. 输出归档：`f_output_*`

### 版本锚点字段

1. `eventContractVersion`
2. `mappingRuleVersion`
3. `dedupFingerprintVersion`
4. `closureRuleVersion`
5. `billingRuleVersion`
6. `archiveContractVersion`
7. `factVersion`

### 引用章节

1. `module-f-event-attribution-processor.md` `3.8.4`~`3.8.30`

## Module G: Audit & Replay Controller

### 核心接口

1. `append(AuditRecord)`
2. `replay(opportunity_key | time_range)`

### 输入合同

1. `fToGArchiveRecordLite`（来自 F）
2. `gAppendRequestLite` + `gAuditRecordLite`
3. `gReplayQueryLite`

### 输出合同

1. `gAppendAckLite`
2. `gReplayResultLite`
3. `replayDiffSummaryLite`

### 关键事件

1. 无独立业务事件；关键输出为 append ACK 与 replay diff 结论

### 原因码段

1. 归档写入：`g_archive_*`, `g_ingest_*`
2. append：`g_append_*`
3. replay：`g_replay_*`, `g_replay_diff_*`

### 版本锚点字段

1. `appendContractVersion`
2. `auditRecordVersion`
3. `auditRuleVersion`
4. `auditContractVersion`
5. `replayContractVersion`
6. `replayExecutionMode` + `pinnedVersions`
7. `resolvedReplayAsOfAt` / `snapshotCutoffAt`

### 引用章节

1. `module-g-audit-replay-controller.md` `3.9.4`~`3.9.24`

## Module H: Config & Version Governance

### 核心接口

1. `resolve(global, app, placement, context) -> resolvedConfigSnapshot`
2. `GET /config`
3. `POST /config/publish`
4. `evaluateVersionGate(gateInput, resolvedConfigSnapshot) -> versionGateDecision`
5. `injectVersionAnchors(gateDecision, resolvedConfigSnapshot, moduleVersions) -> versionAnchorSnapshot`
6. `evaluateRolloutSelector(requestContext, rolloutPolicy) -> rolloutDecision`

### 输入合同

1. `configResolveRequestLite`
2. `hGetConfigRequestLite`
3. `hConfigPublishRequestLite`
4. `hVersionGateInputLite`
5. `hVersionAnchorInjectInputLite`
6. `hRolloutGateInputLite`

### 输出合同

1. `resolvedConfigSnapshot`
2. `hGetConfigResponseLite`（或 `304` 语义）
3. `hConfigPublishResponseLite`
4. `hVersionGateDecisionLite`
5. `versionAnchorSnapshot`
6. `hRolloutDecisionLite`
7. `hConfigDecisionAuditSnapshotLite`
8. `hConfigFailureDecisionSnapshotLite`

### 关键事件

1. 无独立业务事件；关键快照对象：
2. `hConfigDecisionAuditSnapshotLite`
3. `hConfigFailureDecisionSnapshotLite`
4. `versionAnchorSnapshot`（A->G 透传锚点快照）

### 原因码段

1. 配置解析与缓存：`h_cfg_*`
2. 发布与回滚：`h_publish_*`
3. 版本门禁：`h_gate_*`
4. 锚点注入与冻结：`h_anchor_*`
5. 灰度与熔断：`h_rollout_*`
6. 决策主原因码：`h_cfg_decision_*`

### 版本锚点字段

1. 三线主版本：`schemaVersion`, `routingStrategyVersion`, `placementConfigVersion`
2. 配置版本：`globalConfigVersion`, `appConfigVersionOrNA`, `placementSourceVersionOrNA`
3. 合同版本：`configResolutionContractVersion`, `getConfigContractVersion`, `publishContractVersion`, `versionGateContractVersion`, `versionAnchorContractVersion`, `rolloutContractVersion`, `auditSnapshotContractVersion`, `failureAuditContractVersion`
4. 模块规则版本：`enumDictVersion`, `mappingRuleVersion`, `policyRuleVersion`, `routingPolicyVersion`, `deliveryRuleVersion`, `eventContractVersion`, `dedupFingerprintVersion`, `closureRuleVersion`, `billingRuleVersion`, `archiveContractVersion`
5. 锚点摘要：`anchorHash`, `freezeState`, `anchorSet`

### 引用章节

1. `module-h-config-version-governance.md` `3.10.3`~`3.10.53`

## Cross-Module Reason Code Prefix Map

1. Module A: `a_*`
2. Module B: `b_*`
3. Module C: `c_*`
4. Module D: `d_*`
5. Module E: `e_*`
6. Module F: `f_*`
7. Module G: `g_*`
8. Module H: `h_*`

## Cross-Module Anchor Flow (for follow-up tasks)

1. H 生成 `versionAnchorSnapshot` 并在 A 入口注入。
2. A/B/C/D/E/F 只读透传或按冻结点追加，禁止覆盖。
3. F 输出到 G/Archive 必须携带最终锚点或可还原引用。
4. G replay/dispute 默认以归档锚点为准，禁止用当前线上版本替换历史锚点。
