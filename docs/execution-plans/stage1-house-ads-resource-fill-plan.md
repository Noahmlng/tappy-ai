# Stage 1 House Ads 模拟广告库资源填充计划

- 文档版本：v0.2
- 最近更新：2026-02-21
- 适用阶段：`docs/execution-plans/ai-network-development-plan.md` Stage 1（Mediation 冷启动）
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
projects/tappy-ai-mediation/data/house-ads/
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

## 10. 具体填充方法（可直接执行）

下面是“怎么搜、怎么爬、怎么补”的执行版 SOP。

### 10.1 搜索填充（Brand Discovery）怎么做

目标：先拿到“品牌 + 官方域名 + 行业”的主数据，再扩展 creative。

执行步骤：
1. 先准备行业词表（`vertical_l1` + `vertical_l2`）。
2. 每个行业跑三类查询：品牌发现、官方站点确认、合作信号补充。
3. 只保留可验证到官方域名的品牌；其余进入待审池。

#### 10.1.1 查询模板（建议中英文双语）

品牌发现查询（找品牌名）：
1. `"top {vertical_l2} brands"`
2. `"best {vertical_l2} brands official"`
3. `"leading {vertical_l2} companies"`
4. `"热门 {vertical_l2} 品牌"`
5. `"{vertical_l2} 品牌 排行"`

官方站点确认（找官网域名）：
1. `"{brand_name} official site"`
2. `site:{candidate_domain} "{brand_name}"`
3. `"{brand_name} 官网"`

合作信号补充（后续素材生成时用）：
1. `"{brand_name} affiliate program"`
2. `"{brand_name} partners"`
3. `"{brand_name} referral program"`
4. `"{brand_name} 联盟"`

#### 10.1.2 搜索批处理策略

1. 每个 `vertical_l2` 先抓前 `100~200` 条结果。
2. 对品牌名做标准化（大小写、符号、公司后缀清洗）。
3. 用 `brand_name + domain` 做候选唯一键。
4. 命中多域名时优先选择：
   - 有“official site”证据的域名
   - HTTPS 可访问
   - 首页标题与品牌名一致
5. 无法确定官网的条目进入 `manual_review_queue`。

#### 10.1.3 搜索产出物

1. `raw/brand-seeds/search-YYYYMMDD.jsonl`
2. 每条最少含：
   - `brand_name`
   - `candidate_domains[]`
   - `vertical_l1/l2`
   - `evidence_queries[]`
   - `evidence_urls[]`
   - `source_confidence`

### 10.2 爬虫填充（Creative Material Crawl）怎么做

目标：基于已确认品牌域名，提取可生成两类 creative 的素材。

前置约束：
1. 只爬“已确认官方域名”的站点。
2. 遵循 robots 和速率限制（避免封禁和法律风险）。
3. 仅采集公开信息，不采集登录后内容。

#### 10.2.1 爬虫入口与路径策略

入口页面（优先级）：
1. `/`
2. `/shop` `/products` `/collections` `/category`
3. `/pricing` `/plans`（SaaS 类）
4. `/deals` `/offers` `/sale`
5. `/affiliate` `/partners`（若存在）

路径规则：
1. 最大深度：`2`（首页 -> 一级列表 -> 二级详情）。
2. 每域最大页面数：`30`（首批阶段）。
3. 仅保留同域 URL。
4. 去掉 query tracking 参数后再去重。

#### 10.2.2 字段抽取规则（两类 creative）

链接型 creative 抽取：
1. `title`：页面标题或主 H1（长度 8~80）。
2. `description`：meta description 或首段摘要（长度 20~180）。
3. `target_url`：规范化后的 canonical URL。
4. `cta_text`：按行业模板生成（如“查看详情”“立即了解”）。

商品推荐型 creative 抽取：
1. `item_id`：`brand_id + hash(canonical_url)`。
2. `title`：商品标题/H1。
3. `snippet`：卖点摘要（价格、用途、风格标签）。
4. `target_url`：商品或集合页 URL。
5. `price_hint`：页面可解析价格则填；否则空字符串。
6. `match_tags`：由标题、类目、面向人群、用途规则化提取。

#### 10.2.3 动态站点处理

1. 静态页面优先用 HTML parser（快）。
2. 页面空壳或 JS 渲染时，降级到浏览器渲染抓取（Playwright）。
3. 若仍无法抽取，打标 `crawl_unresolved` 进入人工池。

#### 10.2.4 爬虫产出物

1. `raw/crawl-pages/YYYYMMDD/{brand_id}.jsonl`
2. `raw/crawl-signals/YYYYMMDD/{brand_id}.json`
3. 最终写入：
   - `curated/link-creatives.jsonl`
   - `curated/product-creatives.jsonl`

### 10.3 除搜索/爬虫外的补充渠道

1. 开放品牌目录（行业协会、公开榜单、商店榜单）。
2. 现有联盟返回的 merchant/program 列表（可做品牌主数据补全）。
3. 历史运行日志中已出现的品牌与域名（去重后回灌主库）。
4. 人工导入白名单（重点行业品牌包）。

补充原则：
1. 所有外部来源统一走“域名验证 + 字段标准化 + 两类 creative 补齐”。
2. 不允许绕过主数据合同直接进生产快照。

### 10.4 质量门禁（必须通过才发布）

字段校验：
1. 必填缺失直接拒绝。
2. URL 非法或不可规范化直接拒绝。
3. `brand_id` 未命中主数据直接拒绝。

内容校验：
1. 重复度高（同品牌标题高度相似）做去重。
2. 敏感词或违规类目命中则打 `policy_blocked`。
3. 语言不匹配（非 zh/en）打 `needs_review`。

结构校验：
1. 每个品牌必须同时存在：
   - `>=1` 条链接型 creative
   - `>=1` 条商品推荐型 creative
2. 任意品牌缺一种格式，整批快照不可发布。

### 10.5 每周执行节奏（含数量配额）

Week 1（打样）：
1. 搜索发现 `800` 品牌候选。
2. 确认官网并入库 `500` 品牌。
3. 500 品牌配齐两类 creative。

Week 2（扩容）：
1. 搜索新增 `1500` 候选。
2. 入库累计 `1500` 品牌。
3. 行业覆盖达到 `>=12`。

Week 3（达标）：
1. 再新增入库 `1500` 品牌，累计 `>=3000`。
2. creative 完整率维持 `100%`。
3. 抽样通过率 `>=98%`。

Week 4（稳定）：
1. 固化“周更”节奏：每周净增 `300~500` 品牌。
2. 发布节奏固定为 `weekly snapshot`。

## 11. 最小脚本清单（建议实现）

为避免纯人工执行，建议最小脚本化如下：

1. `scripts/house-ads/build-search-jobs.js`
   - 输入：行业词表
   - 输出：搜索任务队列（query 列表）
2. `scripts/house-ads/merge-search-results.js`
   - 输入：搜索结果原始文件
   - 输出：`raw/brand-seeds/*.jsonl`
3. `scripts/house-ads/verify-brand-domain.js`
   - 输入：候选品牌 + 域名
   - 输出：已确认品牌主数据
4. `scripts/house-ads/crawl-brand-pages.js`
   - 输入：已确认品牌主数据
   - 输出：页面与信号原始数据
5. `scripts/house-ads/generate-creatives.js`
   - 输入：crawl signals + brand 主数据
   - 输出：两类 creative 文件
6. `scripts/house-ads/qa-and-publish.js`
   - 输入：curated 数据
   - 输出：快照目录 + 质量报告 + manifest
