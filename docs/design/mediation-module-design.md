# Mediation 模块设计文档（主文件）

- 文档版本：v4.48（结构化拆分版）
- 最近更新：2026-02-21
- 文档类型：Main Doc（入口 + 索引 + 治理）
- 详细设计：迁移至 `docs/design/mediation/` 子文件体系

## 1. 文档定位

该文件不再承载完整细节正文，职责是：
1. 作为统一入口。
2. 维护阅读顺序与索引。
3. 定义跨文件更新治理规则（agent-friendly）。

## 2. 阅读路径

1. 全局导航：`docs/design/mediation/INDEX.md`
2. 核心上下文：
   - `docs/design/mediation/core/00-metadata.md`
   - `docs/design/mediation/core/01-mission-and-context.md`
   - `docs/design/mediation/core/02-execution-graph.md`
3. 模块设计：
   - `docs/design/mediation/modules/module-a-sdk-ingress-opportunity-sensing.md`
   - `docs/design/mediation/modules/module-b-schema-translation-signal-normalization.md`
   - `docs/design/mediation/modules/module-c-policy-safety-governor.md`
   - `docs/design/mediation/modules/module-d-supply-orchestrator-adapter-layer.md`
   - `docs/design/mediation/modules/module-e-delivery-composer.md`
   - `docs/design/mediation/modules/module-f-event-attribution-processor.md`
   - `docs/design/mediation/modules/module-g-audit-replay-controller.md`
   - `docs/design/mediation/modules/module-h-config-version-governance.md`
4. 运行与规划：
   - `docs/design/mediation/operations/01-closed-loop-model.md`
   - `docs/design/mediation/operations/02-sdk-integration-guide-and-minimal-checklist.md`
   - `docs/design/mediation/operations/03-agent-plan-split.md`
   - `docs/design/mediation/operations/04-mvp-deliverables.md`
   - `docs/design/mediation/operations/05-optimization-and-ssp-transition.md`
   - `docs/design/mediation/operations/06-production-readiness-and-infra.md`
5. 历史变更：`docs/design/mediation/CHANGELOG.md`

## 3. Agent-Friendly 治理规则

1. 单模块改动：只改对应模块文件。
2. 跨模块改动：至少同时更新两侧合同文件 + `operations/01-closed-loop-model.md`（如涉及状态/事件闭环）。
3. 任何契约变更必须同步更新：
   - required/optional
   - reasonCode/冲突裁决
   - version anchors
   - 审计/回放关联键
4. 优化项与 MVP 分离：
   - MVP 合同写在模块文件主干
   - 优化项写在 `operations/05-optimization-and-ssp-transition.md`
5. 每次文档改动都要追加变更记录到 `docs/design/mediation/CHANGELOG.md`。

## 4. 兼容说明

1. 原单文件版本的全部内容已按章节迁移到 `docs/design/mediation/`。
2. 历史版本记录（v0.x ~ v3.x）完整保留在 `docs/design/mediation/CHANGELOG.md`。
3. 后续评审与实现请以子文件为准，本主文件仅做导航与治理。
