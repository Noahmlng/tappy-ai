# Frontend Design Skills (ChatGPT Style Baseline)

## 1. 目标

将 `front-design-reference/ChatGPT主页.html` 与 `front-design-reference/ChatGPT对话页面.html` 的视觉与交互规律抽象成可复用的前端设计规范，用于本项目后续页面实现与评审。

## 2. 样本与方法

- 样本文件:
  - `front-design-reference/ChatGPT主页.html`
  - `front-design-reference/ChatGPT对话页面.html`
  - `front-design-reference/ChatGPT 主页_files/root-l3vlcojm.css`
  - `front-design-reference/ChatGPT对话页面_files/root-l3vlcojm.css`
  - `front-design-reference/ChatGPT对话页面_files/conversation-small-fkx6dtwt.css`
- 方法:
  - 抽取 CSS token 与组件规则（变量、尺寸、间距、半径、状态色、动效）。
  - 从 HTML class/data-testid 抽取关键组件约束。
  - 使用 Playwright 对离线页面做 `computed style` 采样（1280x720 视口）。

## 3. 设计 DNA（必须遵守）

- 以 `4px` 作为全局空间单位（`--spacing: 4px`）。
- 圆角以 `8px` 与 `10px` 为主，消息气泡使用 `18px`。
- 交互控件优先“轻背景 + hover 浅底色”，默认无重边框。
- 顶栏、侧栏、输入区和正文区用 token 统一，不写硬编码颜色。
- 所有按钮需要清晰的 `hover/focus/disabled` 状态。
- 小而密的按钮保持 32/36/40 三档尺寸体系，不随意发明新高度。

## 4. 设计令牌（Core Tokens）

### 4.1 Spacing

- `--spacing: 4px`
- 高频倍率（由样本统计）:
  - `*1 = 4px`
  - `*1.5 = 6px`
  - `*2 = 8px`
  - `*2.5 = 10px`
  - `*3 = 12px`
  - `*4 = 16px`
  - `*6 = 24px`
  - `*8 = 32px`
  - `*9 = 36px`
  - `*10 = 40px`
  - `*12 = 48px`
  - `*16 = 64px`

### 4.2 Radius

- `--radius-xs: 2px`
- `--radius-sm: 4px`
- `--radius-md: 6px`
- `--radius-lg: 8px`
- `--radius-xl: 12px`
- `--radius-2xl: 16px`
- 组件特化:
  - 侧栏菜单项: `10px`
  - 头部图标按钮: `8px`
  - 用户消息气泡: `18px`
  - composer 圆形按钮: 超大半径（胶囊/圆）

### 4.3 Typography

- 基础字号:
  - `--text-xs: 12px`
  - `--text-sm: 14px`
  - `--text-base: 16px`
  - `--text-lg: 18px`
  - `--text-xl: 20px`
  - `--text-2xl: 24px`
- 首页主标题:
  - `font-size: 28px`
  - `line-height: 34px`
  - `letter-spacing: 0.38px`
  - `font-weight: 400`
- 常规正文:
  - `16/24`

### 4.4 Color（Light Baseline）

- 主文本: `#0d0d0d`
- 次文本: `#5d5d5d`
- 三级文本: `#8f8f8f`
- 主表面: `#ffffff` / `#f9f9f9`
- 次表面: `#f3f3f3` / `#ececec`
- 边框:
  - `--border-light: #0000001a`
  - `--border-medium: #00000026`
  - `--border-heavy: #0d0d0d26`
- 焦点边框色: `--interactive-border-focus: #0d0d0d`

### 4.5 Motion

- 常规微交互:
  - `--default-transition-duration: .15s`
  - `--default-transition-timing-function: cubic-bezier(.4,0,.2,1)`
- 结构性过渡:
  - `--spring-fast-duration: .667s`
  - `--spring-common-duration: .667s`
  - `--spring-bounce-duration: .833s`

## 5. 布局规范（Page Structure）

### 5.1 全局壳层

- 侧栏固定宽度: `260px`（`--sidebar-width`）。
- 主内容区宽度: `100% - 260px`。
- 顶栏高度:
  - 主值 `52px`
  - 在某些上下文可到 `56px`
- 顶栏内边距:
  - `p-2 = 8px`

### 5.2 对话正文宽度

- 内容最大宽度:
  - 默认 `40rem`（640px）
  - 大屏 `48rem`（768px）
- 正文左右内边距（thread content margin）:
  - 默认: `16px`
  - 小屏容器: `24px`
  - 大屏容器: `64px`

### 5.3 输入区（Composer）

- 输入区底部重叠补偿: `--composer-overlap-px: 28px`（某些状态可到 `55px`）。
- 文本输入区（ProseMirror）关键值:
  - `font-size: 16px`
  - `line-height: 24px`
  - `margin-top: 16px`
  - `padding-bottom: 16px`
- 主页示例（1280x720）:
  - `#prompt-textarea` 采样宽度约 `494px`

## 6. 组件规范（Component Rules）

### 6.1 顶栏按钮

- 模型切换按钮（`model-switcher-dropdown-button`）:
  - 高度 `36px`
  - 圆角 `8px`
  - 左右 padding `10px`
  - 文本 `18/28`
  - 图文间距 `4px`
- 分享按钮（`share-chat-button`）:
  - 高度 `36px`
  - 圆角 `8px`
  - 左右 padding `12px`
  - 文本 `14/20`
- 选项按钮（`conversation-options-button`）:
  - `36x36`
  - 圆角 `8px`
  - 触屏规格升级到 `40x40`（`touch:h-10 touch:w-10`）

### 6.2 通用按钮体系

- `.btn`:
  - 最小高度 `36px`
  - 水平 padding `12px`
  - 字号 `14px`
  - 字重 `500`
  - 胶囊形圆角
- `.btn-small`:
  - 高度 `28px`
  - 水平 padding `10px`
  - 字号 `12px`
- `.btn-large`:
  - 高度 `44px`
  - 水平 padding `16px`

### 6.3 侧栏菜单项（`.__menu-item`）

- 最小高度: `36px`（`data-size=large` 时 `40px`）。
- padding:
  - 默认 `10px`（inline）+ `6px`（block）
  - large: 左/右可调整为 `8px` 起。
- 圆角: `10px`
- 字号: `14px`
- 行高: `20px`
- 常见间距:
  - 菜单项横向 gap: `6px` / `8px`
  - 与外壳 margin-inline: `6px`

### 6.4 Composer 左侧操作按钮（`.composer-btn`）

- 尺寸: `36x36`
- 最小宽度: `36px`
- 文本规格: `14/20`
- 形态: 圆形/胶囊
- 按下态: `background-color: var(--interactive-bg-secondary-press)`
- disabled: `opacity: .3`

### 6.5 消息气泡与回合动作

- 用户气泡（`.user-message-bubble-color`）:
  - 圆角 `18px`
  - 默认 padding `16px 6px`（`px-4 py-1.5`）
  - 多行时纵向 padding 提升为 `12px`（`data-[multiline]:py-3`）
  - 最大宽度: `70%`
  - 背景/前景色来自主题 token：`--theme-user-msg-bg` / `--theme-user-msg-text`
- 回合操作小按钮（复制/赞踩）:
  - `32x32`（内部 icon 20）
  - 圆角 `8px`
  - 默认透明，hover 上浅底色

## 7. 响应式规范（Responsive）

- 触屏命中面积优先:
  - 桌面 `36x36` -> 触屏 `40x40`
- 正文边距会随容器升级:
  - `16 -> 24 -> 64`
- 正文最大宽度:
  - `40rem -> 48rem`（大屏）
- 侧栏宽度固定 260，不跟随正文伸缩。

## 8. 可访问性与状态规范

- 焦点可见:
  - `outline-width: 1.5px`
  - `outline-offset: 2.5px`
  - `outline-color: var(--text-primary)`
- disabled 态:
  - 典型 `opacity: .5`（`.btn`）
  - 或 `opacity: .3`（`.composer-btn`）
  - 必须同时禁止交互（`pointer-events: none` 或 `cursor: not-allowed`）
- 交互状态最小集合:
  - `default`
  - `hover`
  - `focus-visible`
  - `active`
  - `disabled`

## 9. 落地到本项目的实现建议（直接可用）

建议先定义一层 design token，然后组件只消费 token，不写魔法数字。

```css
:root {
  --fd-space: 4px;
  --fd-sidebar-width: 260px;
  --fd-header-height: 52px;
  --fd-thread-max: 40rem;
  --fd-thread-max-lg: 48rem;
  --fd-thread-margin: calc(var(--fd-space) * 4);
  --fd-thread-margin-sm: calc(var(--fd-space) * 6);
  --fd-thread-margin-lg: calc(var(--fd-space) * 16);
  --fd-radius-sm: 8px;
  --fd-radius-md: 10px;
  --fd-radius-chat-bubble: 18px;
  --fd-text-primary: #0d0d0d;
  --fd-text-secondary: #5d5d5d;
  --fd-surface-0: #ffffff;
  --fd-surface-1: #f9f9f9;
  --fd-border-light: #0000001a;
  --fd-transition-fast: .15s cubic-bezier(.4,0,.2,1);
}
```

## 10. 验收清单（Definition of Done）

- 侧栏宽度必须是 `260px`。
- 顶栏高度必须是 `52px`（允许特定页面 `56px`）。
- 所有头部图标按钮桌面 `36x36`、触屏 `40x40`。
- 用户消息气泡必须 `18px` 圆角，宽度不超过 `70%`。
- 对话正文最大宽度按 `40rem/48rem` 规则切换。
- 所有按钮必须有 `hover + focus-visible + disabled`。
- 组件间距全部可映射回 `4px` 基准倍率，不出现随意像素。

## 11. 版本

- Version: `frontend-design-skills-chatgpt v1.0`
- Date: `2026-02-25`
- Evidence: 参考 HTML/CSS + Playwright 计算样式采样结果
