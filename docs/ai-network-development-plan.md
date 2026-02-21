# AI Native Ad Network 开发计划（主文档）

- 文档版本：v0.4
- 最近更新：2026-02-21
- 维护方式：此文档作为长期路线图；每次方向变化均以“阶段目标 -> 关键能力 -> 可交付项 -> 验收口径”更新。

## 0. 战略定位（当前共识）

1. 长期目标仍是打造新的 AI Native Network。
2. 近期必须先把第一个差异化竞争点做深做牢，并且能被市场明确感知。
3. 当前执行策略：先做强 Mediation，再升级 SSP，同时持续观察 DSP 层机会。

## 1. 三阶段路径

### 1.1 第一阶段：接入与标准化（Mediation First）

目标：
1. 让 AI 应用以低摩擦方式接入广告网络。
2. 在兼容现有 SSP 生态的前提下，提供更高质量的上游信号。
3. 形成可被 DSP 感知的流量价值提升。

核心工作：
1. 新的数据上报标准（先对齐，再创新）。
2. 动态广告位能力（Dynamic Placement）。
3. Mediation 兼容与增强层（对 SSP 兼容 + 质量增强输出）。

#### 1.1(a) 数据上报标准

原则：
1. 先对齐现有 SSP 输入标准，确保可直接接入主流 Network。
2. 在兼容层之上增加 AI Native 扩展字段，逐步形成我们的标准。

建议采用“双轨标准”：
1. `compat` 轨：保留主流 SSP 可直接消费字段（便于快速接入与验证）。
2. `native` 轨：补充 AI 场景关键字段（Intent/上下文/机会质量/交互深度）。

第一批关键字段（示意）：
1. 请求标识：`requestId`, `sessionId`, `turnId`, `placementKey`.
2. 机会上下文：`surface`, `format`, `viewOpportunity`, `renderTiming`.
3. 意图相关：`intentClass`, `intentScore`, `intentConfidence`.
4. 质量信号：`trafficQualityHint`, `interactionDepth`, `contextSafety`.
5. 可追踪性：`eventType`, `eventTs`, `billingCandidate`, `traceId`.

#### 1.1(b) 动态广告位与 Mediation

目标：
1. 兼容现有 SSP 的 placement/payload 结构。
2. 提供动态广告位编排，提升请求匹配质量和展示效率。
3. 通过质量增强信号提升 DSP 对请求价值的判断。

Mediation 的核心职责：
1. 适配：不同 SSP 协议的字段映射与路由。
2. 增强：注入意图、上下文、机会质量等 AI Native 信号。
3. 策略：按 placement 与场景做受控分发、降级与回退。

阶段一可交付项：
1. 对外统一请求合同（兼容 + 扩展）。
2. 动态 placement 引擎（基础规则版）。
3. Mediation 适配器（先接最关键 SSP/Network）。
4. 质量信号闭环看板（至少可看到质量提升趋势）。

---

### 1.2 第二阶段：升级为 SSP（Market Object）

目标：
1. 从“连接层”升级为“交易对象层”。
2. 将 Mediation 能力产品化为 SSP Market Object。
3. 以可信质量信号形成品牌化 SSP 信源。

Market Object 的四个核心能力：
1. `Traffic Quality Assessment`：流量质量判断与分层。
2. `View Opportunity Analysis`：可见机会与曝光机会强度建模。
3. `Intent Recognition`：用户意图识别与可商业化程度评估。
4. `User Modeling`：可解释、可控的用户特征建模。

阶段目标结果：
1. 给 DSP 提供更低风险、更高质量的 Bid Request。
2. 在质量、稳定性、可解释性上形成 SSP 的品牌信誉。

阶段二可交付项：
1. SSP 对外 Bid Request 合同（标准化版本）。
2. 质量评分系统与风控基线。
3. 机会分析与意图建模服务化输出。
4. 面向 DSP 的质量证明口径（可审计的 lift 指标）。

---

### 1.3 第三阶段：探索自建 DSP（Observe and Decide）

现状判断：
1. 当前工作与 DSP 相关，但尚不能证明对 DSP 形成颠覆性改变。
2. 传统 DSP 能力（历史识别、意图分析）可能被模型迭代快速覆盖。

阶段策略：
1. 保持“且看且走”，不提前锁死自建 DSP 结论。
2. 持续观察 DSP 双向影响（我们对 DSP、DSP 对我们）。
3. 用小规模实验验证价值，再决定是否进入 DSP 建设。

进入自建 DSP 的建议门槛（Decision Gates）：
1. 我们的质量信号在 win-rate / ROI / 风险指标上持续显著优于市场基线。
2. SSP 阶段已形成稳定供给、稳定需求和可复用交易模型。
3. 自建 DSP 的边际收益明显高于“继续强化 SSP”的收益。

## 2. 当前执行策略（Now）

1. 锚定阶段一：优先把 Mediation 层做强做稳。
2. 并行预研阶段二关键能力，但不抢跑重型 SSP 工程化建设。
3. 对阶段三只做观察与实验，不做提前承诺。

## 3. 设计过程中的优先级策略

### 3.1 低优先级模块（先简化实现）

原则：
1. 以“可运行、可观测、可替换”为目标。
2. 先用规则与轻量实现跑通，再逐步模型化和系统化。

适用范围（当前）：
1. 非核心高级策略（复杂竞价、自动调参）。
2. 非关键体验层扩展能力。
3. 低价值长尾适配器。

### 3.2 核心模块（Important parts，先写细逻辑）

当前必须细化的模块：
1. 数据上报标准（compat + native 双轨字段定义）。
2. 动态 placement 与 Mediation 决策流程。
3. 质量增强信号定义与生成逻辑。
4. requestId 级可追踪链路（evaluate -> event -> billing candidate）。
5. 阶段一到阶段二的升级接口（避免后续重构断层）。

## 4. Loop 式推进方式

Loop-A（阶段一合同）：冻结上报标准、枚举和校验规则。  
Loop-B（阶段一引擎）：实现动态 placement + 基础 mediation 路由。  
Loop-C（阶段一证明）：建立质量提升观测与对比口径。  
Loop-D（阶段二原型）：实现 SSP Market Object 的四项能力最小闭环。  
Loop-E（阶段三观察）：持续进行 DSP 机会实验与进入门槛评估。

## 5. 关键约束

1. 任何阶段都不能牺牲可追踪性与可审计性。
2. 兼容优先，创新增量必须可灰度回退。
3. 主业务链路优先，商业化链路默认 fail-open。
4. 所有“质量提升”必须有可复现的指标证明，而非仅叙事。

## 6. 后续对话细化模板（固定）

后续每轮只细化一个子模块，输出固定五块：
1. 模块边界（负责/不负责）。
2. 输入输出合同（字段、枚举、校验）。
3. 决策逻辑（规则、阈值、回退）。
4. 可观测性（日志、指标、审计点）。
5. 验收标准（测试场景与通过条件）。

## 7. 变更记录

### 2026-02-21（v0.4）

1. 按新口径重写三阶段路线：Mediation First -> SSP Market Object -> DSP Explore。
2. 删除“当前不做 SSP”的冲突表述，改为“先做强 Mediation，再升级 SSP”。
3. 新增“双轨标准（compat/native）”与“阶段切换门槛（Decision Gates）”。
4. 明确低优先级先简化、核心模块先细化的执行原则。
