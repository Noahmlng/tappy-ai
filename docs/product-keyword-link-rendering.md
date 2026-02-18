# 商品词渲染为可跳转入口：项目实现说明

## 结论（这个项目实际怎么做）
项目不是直接把词替换成 `<a>` 标签，而是走了这条链路：

1. LLM 返回正文文本，同时在文本里追加一个 ````sponsor` 代码块（JSON）。
2. 前端流式渲染时，专门识别 `sponsor` 代码块，避免逐字打字机动画把它“打散”。
3. `MarkdownRenderer` 从完整文本里提取 sponsor JSON，用 `key` 在前文中定位商品词。
4. 找到该词后，把这段词替换成 `SponsorBadge` 组件（带 `AD` 标识）。
5. 用户点击词或 `AD` 打开商品卡片弹层；点击卡片主体后 `window.open(sponsor.url)` 跳转。

所以“可跳转链接”在这个项目里是通过组件交互实现的，不是纯 `<a>` 文本链接替换。

## 关键代码位置
- 聊天消息使用 Markdown 渲染：`/Users/zeming/Downloads/chat-main-vien/src/views/ChatView.vue`
- 流式阶段的 sponsor 块缓冲逻辑：`/Users/zeming/Downloads/chat-main-vien/src/views/ChatView.vue`
- sponsor 提取与关键词插入：`/Users/zeming/Downloads/chat-main-vien/src/components/MarkdownRenderer.vue`
- 关键词点击、弹层、最终跳转：`/Users/zeming/Downloads/chat-main-vien/src/components/SponsorBadge.vue`
- 卡片展示字段：`/Users/zeming/Downloads/chat-main-vien/src/components/SponsorCard.vue`

## 数据格式约定（LLM 需要输出）
最关键是 LLM 输出中要带下面这种块（字段可扩展，但这些字段当前实现会用到）：

````markdown
推荐你看看这款耳机，降噪和佩戴都不错。

```sponsor
{
  "key": "耳机",
  "name": "Sony WH-1000XM5",
  "desc": "行业领先主动降噪，长续航",
  "price": "$399",
  "url": "https://example.com/product/sony-wh1000xm5",
  "image_url": "https://example.com/1.jpg,https://example.com/2.jpg",
  "video_url": "https://example.com/review-video"
}
```
````

说明：
- `key`：要在上文命中的“商品词”。
- `url`：最终跳转地址（`SponsorBadge` 用它打开新窗口）。
- `image_url`：逗号分隔图片 URL，卡片里会轮播。

## 前端执行流程（按时序）
1. `ChatView` 收到 Dify SSE 文本分片后，逐字符入队。
2. `typeWriter` 检测到代码围栏起始 ``\`\`\`sponsor`` 后，进入 sponsor 缓冲模式；直到遇到结束符 ``\n\`\`\``` 才一次性写入消息内容。
3. 消息内容交给 `MarkdownRenderer`。
4. `MarkdownRenderer` 先正则提取所有 sponsor 代码块并 `JSON.parse`。
5. 对每个 sponsor，使用 `key` 在已累计文本中做 `lastIndexOf`，命中后把这段关键词替换为 `SponsorBadge` 段。
6. 其他普通文本走 `renderMarkdown`，常规 markdown 链接仍会转成 `<a href="...">`。
7. `SponsorBadge` 点击后显示 `SponsorCard`；点击卡片主体打开 `sponsor.url`。

## 迁移到你其他项目的最小实现清单
1. 复用 sponsor 输出协议：让 LLM 输出 ``\`\`\`sponsor`` JSON + `key`。
2. 在流式渲染层增加 sponsor 缓冲，避免 sponsor 代码块被逐字渲染破坏。
3. 在 markdown 渲染层做“先抽 sponsor，再插回关键词位置”的分段渲染。
4. 做一个可点击关键词组件，内部负责商品卡片和跳转。
5. 保留兜底：`JSON.parse` 失败时按普通文本显示，不要让整条消息渲染崩溃。

## 已知边界
- 当前命中策略是 `lastIndexOf(key)`：如果同一关键词在文本中出现多次，只会替换最后一次。
- sponsor 块里 `key` 若在文本中找不到，会跳过插入并仅输出普通文本（控制台会告警）。
- 这套实现依赖 LLM 严格输出合法 JSON sponsor 块。
