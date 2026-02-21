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

