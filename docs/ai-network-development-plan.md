# AI Native Ad Network 开发计划（主文档）

- 文档版本：v0.3
- 最近更新：2026-02-21
- 维护方式：此文档作为项目长期路线图，后续阶段调整与优先级变更均在此增量更新。

## 0. 当前战略前提（已确认）

1. 当前阶段不单独建设 SSP。
2. 以 SDK 为核心承载 S Network 能力（请求、决策、库存路由、结算、上报）。
3. 采用“先整体框架、再子模块细化”的推进方式。
4. 低优先级模块可先用简化实现保证链路跑通；核心模块必须先写清楚细粒度逻辑。

## 1. 总体目标

打造一个 AI 原生的广告基础设施：先在应用侧完成可运行闭环（Placement -> 请求 -> 决策 -> 展示 -> 上报 -> 结算），再逐步增强 DSP 能力与竞价能力。

## 2. 三层架构（当前主线）

### 2.1 第一层：Placement 定义与数据上报

职责：
1. 定义 Placement 合同（surface、format、trigger、frequency cap、disclosure）。
2. 统一上报 evaluate/event（impression/click/dismiss 等）。
3. 保证 requestId 级可追踪（decision log 与 event log 能闭环）。

当前范围：
1. Attach（`attach.post_answer_render`）优先。
2. Next-Step（`next_step.intent_card`）作为次优先可控开启。

### 2.2 第二层：SDK / S Network 执行层

职责：
1. 发起并规范化 bid/evaluate 请求。
2. 执行受控拍卖（策略 gate + 排序）。
3. 库存定义、基础风控与反作弊门槛。
4. 结算与收益统计。
5. 库存网络请求路由（联盟 / DSP / 自有库存）。

### 2.3 第三层：DSP 能力层

职责：
1. DSP 定价策略与推导定价。
2. 广告主管理（campaign/adgroup/bid/budget）。
3. 模拟商品库与出价系统。

说明：
1. 该层先做“可模拟、可验证”的最小系统，不一开始追求完整 RTB。

## 3. 优先级原则（P0/P1/P2）

### 3.1 P0（Important parts，当前就写细）

1. Placement 合同与策略判定链路（enabled/intent/topic/cooldown/frequency/revenue gate）。
2. 受控拍卖核心（候选召回、排序规则、no_fill/blocked 原因枚举）。
3. Inventory 路由与标准化（多网络 connector、统一 offer schema、去重）。
4. 可追踪性（requestId 贯通 evaluate/events/decision logs）。
5. 结算最小闭环（至少有可审计的收入记账路径与口径）。

### 3.2 P1（重要但可先简化）

1. Fraud/IVT：先规则化 baseline（黑名单域名、异常频次、低质量流量阈值）。
2. DSP 定价策略：先从可解释规则模型开始（base bid + multipliers）。
3. Next-Step 高级语义能力：先保留基础向量召回 + 可控阈值。

### 3.3 P2（优先级较低，先跑通）

1. 复杂竞价机制（多轮实时竞价、高级 pacing）。
2. 深度运营功能（复杂 AB 平台、自动调参）。
3. 非核心体验层高级形态（intervention/takeover 深度玩法）。

## 4. 迭代 Loop 计划

## Loop 1：基础合同与决策闭环（P0）

目标：
1. 固化 Placement/Request/Response/Event 基础合同。
2. 固化决策原因枚举与日志结构。
3. 跑通 Attach 主链路（evaluate + event + dashboard 可观测）。

交付：
1. 合同文档与 schema 对齐。
2. 决策日志字段冻结（result/reason/reasonDetail/requestId）。
3. Fail-open 行为验收（广告失败不阻塞主对话）。

## Loop 2：库存路由与受控拍卖（P0）

目标：
1. 完成多库存源并行拉取与统一归一化。
2. 完成受控拍卖主逻辑（策略 gate + 排序）。
3. 形成可解释 no_fill/blocked 产物。

交付：
1. Connector 插件化入口与健康状态。
2. 排序规则文档化（相关性优先，商业信号次之）。
3. 快照降级与熔断策略验收。

## Loop 3：结算与基础风控（P0 + P1）

目标：
1. 建立最小结算账本口径（impression/click -> revenue）。
2. 建立基础 fraud/IVT 规则门槛（先规则后模型）。

交付：
1. 可追溯的计费事件流定义。
2. 风控拦截原因与审计字段。
3. 指标口径冻结（CTR/eCPM/fillRate/revenue）。

## Loop 4：DSP 模拟基础（P1）

目标：
1. 建立最小广告主与出价管理结构。
2. 接入模拟商品库与模拟 bid book。
3. 将 DSP 输出并入现有受控拍卖链路。

交付：
1. campaign/adgroup/ad/bid/budget 最小数据模型。
2. 可配置定价策略规则。
3. 端到端模拟压测场景。

## Loop 5：优化与扩展（P2）

目标：
1. 逐步增强竞价机制与运营能力。
2. 按业务价值决定是否推进 intervention/takeover 深化。

## 5. 关键设计约束

1. 主对话链路优先，广告链路必须 fail-open。
2. 策略与参数在服务端集中管理，不在客户端硬编码。
3. 所有关键决策必须可审计、可解释、可复盘。
4. 先保证稳定和可观测，再做复杂优化。

## 6. 下一步对话式细化方式

后续每次只细化一个模块，采用固定输出模板：
1. 模块边界（输入/输出/不负责什么）。
2. 决策逻辑（规则、阈值、优先级、降级策略）。
3. 数据合同（字段、枚举、必填项）。
4. 失败与回退（fail-open/fallback）。
5. 验收标准（测试场景与日志检查点）。

## 7. 变更记录

### 2026-02-21（v0.3）

1. 明确“当前阶段不单独做 SSP，SDK 内含 S Network 能力”。
2. 将路线图改为三层架构：Placement 上报层 / SDK 执行层 / DSP 能力层。
3. 新增 P0/P1/P2 优先级原则，明确“低优先级先简化实现”。
4. 新增 Loop 1~5 迭代计划，并要求 P0 模块先写细逻辑再实现。
