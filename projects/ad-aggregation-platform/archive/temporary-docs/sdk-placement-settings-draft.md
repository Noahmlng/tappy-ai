# SDK Placement & Trigger Settings Draft

- Version: v0.1 (Draft)
- Last Updated: 2026-02-17
- Scope: SDK 层广告位选择与触发参数设计雏形

## 1. 目标

1. 在 SDK 层提供可配置的 Placement 开关与选择机制。
2. 在 SDK 层提供统一参数模型，控制广告触发时机。
3. 明确 intent 强度阈值与分层策略，避免触发不稳定。
4. 与当前协议兼容（`placementId`, `intentThreshold`, `frequencyCap` 等）。

## 2. 非目标

1. 本文不定义具体 UI 渲染样式。
2. 本文不约束联盟/DSP 的具体竞价策略。
3. 本文不涉及计费结算系统实现细节。

## 3. SDK 配置模型（草案）

建议将 SDK 配置拆成三层：

1. `global`: 全局策略（默认阈值、敏感话题策略、全局频控）。
2. `placements`: 每个 placement 的开关与参数。
3. `runtimeOverrides`: 单次请求级别覆盖（实验、AB、debug）。

示例（TypeScript 形态）：

```ts
export type IntentBand = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'

export interface SdkConfig {
  appId: string
  global?: {
    defaultIntentThreshold?: number
    defaultCooldownSeconds?: number
    strictSensitiveTopicBlock?: boolean
    maxAdsPerTurn?: number
  }
  placements: PlacementPolicy[]
}

export interface PlacementPolicy {
  placementId: string
  placementKey?: string // e.g. attach.post_answer_render
  enabled: boolean
  priority?: number
  surface: 'CHAT_INLINE' | 'CHAT_CARD' | 'SIDEBAR' | 'FOLLOW_UP' | 'AGENT_PANEL'
  format: 'TEXT_LINK' | 'CARD' | 'LIST' | 'NATIVE_BLOCK'
  trigger: {
    intentThreshold: number
    minExpectedRevenue?: number
    cooldownSeconds?: number
    minConfidence?: number
    allowedIntentBands?: IntentBand[]
  }
  frequencyCap?: {
    maxPerSession?: number
    maxPerUserPerDay?: number
  }
  targeting?: {
    allowedTopics?: string[]
    blockedTopics?: string[]
    locales?: string[]
  }
}
```

## 4. Placement 选择策略

## 4.1 基础规则

1. SDK 默认不渲染未显式启用（`enabled=false`）的 placement。
2. 同一 surface 可以启用多个 placement，通过 `priority` 决定候选顺序。
3. 每次事件触发只从「当前 surface + enabled=true」中筛选候选 placement。

## 4.2 选择流程

1. 输入事件上下文（query、intentScore、topic、session state）。
2. 过滤不匹配 surface 的 placement。
3. 过滤 `enabled=false` placement。
4. 执行 trigger 判定（intent、收益、cooldown、频控、topic 安全）。
5. 对通过判定的 placement 按 `priority` 排序。
6. 输出一个或多个可触发 placement（受 `global.maxAdsPerTurn` 限制）。

## 5. 触发参数与 Intent 强度

## 5.1 参数分层

1. 硬门槛参数（必须满足）
- `intentThreshold`
- `cooldownSeconds`
- `frequencyCap`
- `blockedTopics`

2. 软约束参数（用于排序或降级）
- `minExpectedRevenue`
- `minConfidence`
- `allowedIntentBands`

## 5.2 Intent 强度分段（建议默认值）

1. `LOW`: [0.00, 0.35)
2. `MEDIUM`: [0.35, 0.60)
3. `HIGH`: [0.60, 0.80)
4. `VERY_HIGH`: [0.80, 1.00]

建议映射：

1. `attach.*` 默认允许 `MEDIUM/HIGH/VERY_HIGH`
2. `next_step.*` 默认允许 `HIGH/VERY_HIGH`
3. `intervention.*` 默认允许 `VERY_HIGH`
4. `takeover.*` 除 `VERY_HIGH` 外，应增加显式用户确认门槛

## 5.3 阈值建议（v0.1）

1. `attach.post_answer_render`: `intentThreshold=0.50`
2. `next_step.intent_card`: `intentThreshold=0.65`
3. `intervention.search_parallel`: `intentThreshold=0.80`

这些阈值作为 SDK 默认值，业务方可覆盖。

## 6. 判定引擎伪代码

```ts
function evaluatePlacements(event, context, config) {
  const candidates = config.placements
    .filter((p) => p.enabled)
    .filter((p) => p.surface === event.surface)

  const eligible = []

  for (const p of candidates) {
    if (context.intentScore < p.trigger.intentThreshold) continue
    if (!passCooldown(p.placementId, context)) continue
    if (!passFrequencyCap(p.placementId, context)) continue
    if (!passTopicSafety(p, context)) continue
    if (!passIntentBand(p.trigger.allowedIntentBands, context.intentScore)) continue

    const score = scorePlacement(p, context)
    eligible.push({ placement: p, score })
  }

  return eligible
    .sort((a, b) => (b.score - a.score) || ((a.placement.priority ?? 999) - (b.placement.priority ?? 999)))
    .slice(0, config.global?.maxAdsPerTurn ?? 1)
}
```

## 7. 与现有 schema 的兼容方案

当前 `placement.schema.json` 已有：

1. `placementId`
2. `surface`
3. `format`
4. `trigger.intentThreshold`
5. `trigger.minExpectedRevenue`
6. `trigger.cooldownSeconds`
7. `frequencyCap`

建议在不破坏兼容的前提下逐步扩展：

1. 增加 `enabled`（默认 `true`，便于灰度）
2. 增加 `priority`（默认 `100`）
3. 增加 `trigger.allowedIntentBands`（可选）
4. 增加 `targeting.locales`（可选）

旧配置未提供这些字段时，SDK 使用默认值。

## 8. SDK API 草案

```ts
const sdk = createAdsSdk({
  appId: 'chatbot-prod',
  global: {
    defaultIntentThreshold: 0.55,
    maxAdsPerTurn: 1,
    strictSensitiveTopicBlock: true
  },
  placements: [
    {
      placementId: 'chat_inline_v1',
      placementKey: 'attach.post_answer_render',
      enabled: true,
      priority: 10,
      surface: 'CHAT_INLINE',
      format: 'NATIVE_BLOCK',
      trigger: {
        intentThreshold: 0.50,
        cooldownSeconds: 120,
        allowedIntentBands: ['MEDIUM', 'HIGH', 'VERY_HIGH']
      },
      frequencyCap: {
        maxPerSession: 2,
        maxPerUserPerDay: 6
      }
    }
  ]
})

const decision = sdk.evaluate({
  surface: 'CHAT_INLINE',
  event: 'answer_completed'
}, {
  sessionId: 's_123',
  userId: 'u_456',
  intentScore: 0.72,
  topic: 'consumer_electronics'
})
```

## 9. 建议落地步骤

1. Step A: 在 schema 中引入 `enabled/priority` 并兼容旧配置。
2. Step B: 在 runtime 中新增 `evaluatePlacements()` 决策模块。
3. Step C: 将 `default-placements.json` 升级为可表达 Intent 分段。
4. Step D: 增加 decision log（未触发原因）便于调参与排查。

## 10. 待讨论决策点

1. Intent 分段阈值是否全局统一，还是按 vertical（如 travel/ecommerce/SaaS）分别配置。
2. 同轮对话最多触发 1 个 placement，还是允许「1 主 + 1 轻量 attach」。
3. `minExpectedRevenue` 是否作为硬门槛（过滤）还是软排序因子。
4. `intervention/takeover` 是否必须二次确认（避免打断核心对话）。
5. 租户侧（app integrator）可开放哪些参数，哪些必须平台托管。

