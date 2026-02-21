# Stage 1 House Ads 模拟广告库资源填充计划

- 文档版本：v0.1
- 最近更新：2026-02-21
- 适用阶段：`docs/ai-network-development-plan.md` Stage 1（Mediation 冷启动）
- 目标定位：在 DSP / 大型 Ads Network 尚未快速接入前，以“仓库化模拟广告库”先完成供给填充能力。

## 1. 决策输入（本轮冻结）

1. Stage 1 优先建设“算力需求池（House Ads 模拟广告库）”。
2. 模拟库要覆盖几千个品牌，并尽可能包罗常见行业。
3. 库内每个品牌必须配齐两类 creative：
   - 链接型（用于 `attach.post_answer_render`）
   - 商品推荐型（用于 `next_step.intent_card`）
4. 本轮明确不做：
   - 决策引擎与 NoBid 优化
   - 快反直客机制
   - 算路自动化（先按仓库填充方式运行）

## 2. 本期目标与验收口径

### 2.1 目标

1. 建立可持续扩容的 House Ads 主数据仓库（可版本化、可回滚）。
2. 在 4 周内形成 `>= 3000` 品牌的可投放模拟库存。
3. 实现品牌级“creative 完整率 100%”（每品牌两类 creative 都存在）。
4. 覆盖至少 `20` 个行业大类，避免库存过度集中。

### 2.2 核心验收指标（Stage 1）

1. 品牌规模：`brand_count >= 3000`。
2. creative 完整率：`brands_with_both_formats / brand_count = 100%`。
3. 行业覆盖：`vertical_count >= 20`。
4. 可用率：抽样校验后 `valid_creative_rate >= 98%`（URL、字段、去重、格式通过）。
5. 填充表现（模拟链路）：两类 placement 的 `served` 占比稳定达到目标基线（建议先设 `>= 95%`）。

## 3. 数据模型（先冻结最小合同）

## 3.1 Brand 主数据（`brands.jsonl`）

必填字段：
1. `brand_id`（稳定主键）
2. `brand_name`
3. `vertical_l1`（一级行业）
4. `vertical_l2`（二级行业）
5. `market`（如 `US` / `GLOBAL`）
6. `official_domain`
7. `source_confidence`（0~1）
8. `status`（`active` / `paused`）

## 3.2 链接型 creative（`link-creatives.jsonl`）

必填字段：
1. `creative_id`
2. `brand_id`
3. `placement_key`（固定 `attach.post_answer_render`）
4. `title`
5. `description`
6. `target_url`
7. `cta_text`
8. `disclosure`（`Sponsored`）
9. `language`（`zh-CN` / `en-US`）
10. `status`

## 3.3 商品推荐型 creative（`product-creatives.jsonl`）

必填字段：
1. `creative_id`
2. `brand_id`
3. `placement_key`（固定 `next_step.intent_card`）
4. `item_id`
5. `title`
6. `snippet`
7. `target_url`
8. `merchant_or_network`
9. `price_hint`
10. `match_tags`（数组）
11. `disclosure`（`Sponsored`）
12. `language`
13. `status`

## 4. 资源填充策略（仓库化，不依赖实时算路）

## 4.1 采集策略（双通道）

1. 搜索累积通道（优先）
   - 先按行业关键词批量检索品牌清单，沉淀主数据。
2. 爬虫采集通道（补充）
   - 对已入库品牌抓取公开可用的基础描述、落地页、类目标签。
3. 人工审核通道（兜底）
   - 处理低置信度品牌、冲突域名、重复品牌。

## 4.2 行业覆盖优先级（建议首批）

1. 消费电子
2. 家居家电
3. 美妆个护
4. 服饰鞋包
5. 母婴
6. 运动户外
7. 食品饮料
8. 汽车与出行
9. 教育培训
10. 金融服务
11. 办公软件/SaaS
12. 开发者工具
13. 游戏娱乐
14. 旅游酒店
15. 本地生活
16. 医疗健康
17. 宠物
18. 家装建材
19. 艺术文创
20. B2B 服务

## 5. 生产流程（Pipeline）

1. Seed 建库
   - 生成品牌候选池，写入 `raw/brand-seeds/`。
2. 标准化
   - 清洗品牌名、域名、行业标签；生成 `brand_id`。
3. 去重与合并
   - 同域名、同品牌别名、同落地页聚合。
4. creative 生成
   - 每品牌生成链接型 + 商品推荐型 creative；按模板产出多变体。
5. 质量门禁
   - URL 可用性、字段完整性、重复度、敏感词校验。
6. 发布快照
   - 产出版本目录与 `manifest.json`，供 runtime 按版本加载。

## 6. 仓库目录建议

```text
projects/ad-aggregation-platform/data/house-ads/
  raw/
    brand-seeds/
  curated/
    brands.jsonl
    link-creatives.jsonl
    product-creatives.jsonl
  snapshots/
    2026-02-xx/
      manifest.json
      brands.jsonl
      link-creatives.jsonl
      product-creatives.jsonl
  reports/
    coverage-YYYYMMDD.json
    quality-YYYYMMDD.json
```

## 7. 四周落地节奏（执行版）

1. Week 1（合同冻结 + 首批样本）
   - 冻结三类数据文件结构。
   - 完成 `500` 品牌样本入库与两类 creative 跑通。
2. Week 2（规模扩容）
   - 扩容到 `1500` 品牌，完成行业覆盖 `>= 12`。
3. Week 3（达成阶段目标）
   - 达到 `3000` 品牌、creative 完整率 `100%`、行业覆盖 `>= 20`。
4. Week 4（稳定化）
   - 加入抽样质检与周更机制，形成可持续扩容流程（冲刺 `5000` 可选）。

## 8. 风险与控制

1. 数据重复高：引入“域名 + 品牌名 + URL”三键去重。
2. 素材质量不稳：对低置信度项强制人工复核。
3. 行业分布失衡：按行业配额补齐，不允许单类目过度集中。
4. 字段漂移：固定合同版本，新增字段走版本升级，不做隐式变更。

## 9. 当前阶段输出件（Definition of Done）

1. 一份可发布的 House Ads 快照（含 3000+ 品牌）。
2. 两类 placement 对应 creative 文件齐全且可被 runtime 消费。
3. 覆盖/质量报告可复现（脚本重复执行结果稳定）。
4. 主文档已登记本计划入口与范围边界（本轮不做项已写明）。
