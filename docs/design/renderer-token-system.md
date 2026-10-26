# Renderer Design Token 规范

本文定义 Renderer 的统一 Token 选择规则。颜色语义继续以
[`renderer-color-system.md`](./renderer-color-system.md) 为唯一规范；本文只补充排版、间距、圆角、动效、阴影和层级。

## 目标与边界

Token 的职责是让人和 Agent 根据语义做出同一个选择，而不是保存每一个历史像素值。
Renderer 只使用三层变量：

1. `--cpx-sys-*`：跨 Feature 公共语义，任何 Renderer 消费方可使用。
2. `--cpx-comp-*`：基础组件内部槽位，仅对应组件样式可使用；Feature 不得消费其几何 Token。
3. Feature 局部变量：在拥有该布局的选择器内声明，仅用于运行时尺寸、响应式公式、Diff 坐标等无法静态归入系统刻度的值。

禁止新增无命名空间的全局 `--control-*`、`--layout-*`、`--app-icon-*`、`--menu-*`，也禁止按页面或实例命名新的系统 Token。

## Oreo 设计语言适配

Oreo Agentic UI Library 作为 Pidex 的视觉参考，不形成平行 Token 或组件体系。其 Foundation 直接映射到现有 `--cpx-sys-*`：Color 使用 surface、foreground、border、tone 与 interaction 语义，Typography 使用现有角色刻度，Shadow 仅用于瞬时浮层和持续覆盖工作区的交互面，Radius、Space 与 Motion 继续使用本规范的公共刻度。

Pidex 保留现有信息架构、Coding / Working / Chat 模式、鲸鱼品牌和桌面交互契约。首页、空状态与引导页使用宽松节奏；Workbench、侧栏、终端、Review 和设置使用紧凑节奏。Oreo 中的 Button、Shortcuts、Chip、Tag、Avatar、Loading、Prompt、Sidebar、Navbar 与 Pop-up 优先复用现有基础组件；只有真实调用方无法表达时才扩展公共组件。

### UI-Design 视觉体系落地

Pidex 全面采用 UI-Design 视觉体系（基于 `F:\CodeProject\UI-Design`）：

1. **基础 Token 统一**：
   - 统一使用 `--cpx-sys-*` 与 `--cpx-comp-*` 契约，杜绝平行 Token 体系。
   - 恢复 Apple HIG 风格的优雅基础圆角（4px ~ 28px、pill 9999px）与无光学校正（optical scale 1.0）。
   - 恢复多阶轻盈半透明投影（Resting、Raised、Floating、Control、Prominent）及毛玻璃模糊（8px / 16px / 24px）。
2. **基础组件与业务组件全面对齐**：
   - 基础控件（`Button`、`Input`、`Switch`、`Card`、`SegmentedControl`、`Modal`、`Popover` 等）统一接入系统圆角、投影与微动效。
   - 业务组件（Composer、ModelSelect、Session 消息卡片、Sidebar、Settings 等）移除私有几何与投影变量，直接收敛至语义 Token。
3. **外观设置保留与默认配色选择**：
   - V6 保留式升级至 V7；有效 V6/V7 设置不因迁移记录缺失而重置。旧 pending 记录仅完成记账并保留当前设置及原备份，completed、未知或不可读记录继续保留。
   - 设置页通过浅色、深色主题下拉中的 `Codex` 与 `Codex(new)` 选择原版或新版默认配色，不再显示独立的应用与恢复按钮；选择新配色保留自定义字体与字号。V1～V5 和损坏 JSON 仍遵守既有恢复契约。

## 固定选择流程

新增或修改样式时必须依次回答：

1. **内容角色**：这是 caption、label、正文、标题还是 code？
2. **组件/布局角色**：这是组件内部槽位、普通 Feature 间距，还是跨 Feature 的布局约束？
3. **密度**：在 4px 刻度中选择最接近的紧凑、默认或宽松节奏。
4. **状态与动效**：变化属于即时反馈、退出、状态切换、进入、面板还是持续加载？
5. **层级**：元素属于局部、sticky、dock、composer、modal、popover、tooltip 还是 toast？

只有完成前一项后才选择下一项；颜色 tone、交互状态和层级不能用几何大小互相替代。

## 公共语义

### 排版

排版先按内容职责分为展示、结构、交互、阅读和代码五条层级，再通过 `--cpx-sys-type-*` 使用。系统字体优先使用 `MiSans`，并回退到平台系统字体；代码字体优先使用 `JetBrains Mono`，并回退到等宽系统字体。字重遵循稳定的 `400 / 500 / 600`。排版采用无单位行高（如 `1.2 / 1.333 / 1.429 / 1.5` 等）与字符间距角色（`--cpx-sys-letter-spacing-*`）。需要单独设置属性时，复用角色所依赖的 `--cpx-sys-font-size-*`、`--cpx-sys-line-height-*`、`--cpx-sys-letter-spacing-*` 和 `--cpx-sys-font-weight-*`，不得写裸字号或行高。

| 角色         | 默认字号 / 行高 / 字重 / 字距                 | 内容职责                                 | 默认前景色                         |
| ------------ | --------------------------------------------- | ---------------------------------------- | ---------------------------------- |
| `display`    | `28 / 1.14 / 600 / -0.70px`                   | Coding、Working 与 Chat 首页 Hero        | `fg-primary`                       |
| `caption`    | `12 / 1.40 / 400 / 0px`                       | 时间、路径、计数和辅助状态               | `fg-tertiary`                      |
| `label`      | `12 / 1.30 / 500 / 0.45px`                    | 分组名、字段标签和短状态标签             | 按上下文选择 secondary 或 tertiary |
| `body-sm`    | `13 / 1.45 / 400 / 0px`                       | 次级说明、工具活动和侧栏辅助文字         | `fg-secondary`                     |
| `control`    | `13 / 1.20 / 500 / -0.05px`                   | Button、Input、Menu、紧凑导航和文件行    | `fg-primary`                       |
| `body`       | `14 / 1.50 / 400 / -0.05px`                   | 普通 UI 正文、评论和表单说明             | `fg-primary`                       |
| `row-title`  | `14 / 1.50 / 500 / -0.05px`                   | 设置行、卡片行和普通对象名称             | `fg-primary`                       |
| `reading`    | `14 / 1.50 / 400 / -0.05px`                   | 用户消息、Agent 最终回答和 Markdown 长文 | `fg-primary`                       |
| `body-lg`    | `16 / 1.50 / 400 / -0.12px`                   | 首页 Prompt 和短引导正文                 | `fg-primary`                       |
| `heading-sm` | `16 / 1.25 / 600 / -0.25px`                   | Section、Dialog、Popover 和 Markdown H3  | `fg-primary`                       |
| `heading-md` | `18 / 1.25 / 600 / -0.25px`                   | 重点卡片和详情页局部主标题               | `fg-primary`                       |
| `heading-lg` | `20 / 1.20 / 600 / -0.45px`                   | Markdown H2 和强信息分区                 | `fg-primary`                       |
| `heading-xl` | `24 / 1.14 / 600 / -0.70px`                   | 一级页面、Setup 主标题和 Markdown H1     | `fg-primary`                       |
| `metric`     | `20 / 1.20 / 600 / -0.45px`                   | 金额、用量和统计值；使用 tabular figures | `fg-primary`                       |
| `code`       | `13 / 1.50 / 400 / 0px`（随代码字号动态更新） | 代码、命令、Diff 和终端                  | 按语法或上下文选择                 |

普通正文使用 `400`，控件、标签和行标题使用 `500`，结构标题、指标和真正的强调使用 `600`。选中态通过背景和前景色表达，不得为了选中而改变普通列表项字重。UI 文本不得借用 `reading` 获取额外行距，工具活动也不得借用 `body` 与最终回答争夺层级。

会话 Markdown 使用 `--cpx-sys-line-height-prose`（1.625）和正常字距；全局 `reading` 默认值保持不变。会话标题按正文字号的 1.5 / 1.25 / 1.125 倍显示，行内代码使用 `--cpx-sys-radius-inline-code`（6px），不改变其他 UI 宿主的排版。

界面字号与代码字号设置仍是两个独立主题输入。UI 默认字号是 `14px`，运行时先计算 `delta = uiFontSize - 14`，再将同一差值应用到 `12 / 13 / 14 / 16 / 18 / 20 / 24 / 28px` 完整刻度，因此所有语义角色在 UI 字号 `11–16px` 范围内保持相对层级。代码字号在 `8–24px` 范围独立更新 `--cpx-sys-font-size-code`，不参与 UI delta；新设置默认使用 `13px`，已有用户设置原样保留。

颜色与排版角色互相独立：正文和关键值使用 `--cpx-sys-color-fg-primary`，说明使用 `fg-secondary`，时间、路径和其他辅助元信息使用 `fg-tertiary`，`fg-disabled` 只用于真实禁用态。业务成功、警告和错误继续使用对应 tone，不以异常字号或额外粗体代替状态语义。

### 图标

功能图标按是否与文字同行选择尺寸，不按页面或按钮颜色选择：

| 用途 | 尺寸 | 适用范围 |
| --- | --- | --- |
| 同行功能图标 | 中文界面宽高为 `1em`，English 界面为 `1cap`；不收缩 | 图文按钮、设置及其他导航、菜单、选择器、标签、文件行、面包屑、折叠标题、状态文字；箭头和加载替换态保持一致 |
| 纯图标操作 | 现有 `12 / 16 / 20 CSS px` 档位 | 独立工具按钮、关闭、清除、发送与停止；`iconSize` 只用于此类按钮 |
| 控件结构 | 各组件自身几何 | Checkbox 勾选、Radio 圆点、Switch 旋钮、Slider 手柄 |
| 品牌和内容 | 原有槽位 | 头像、鲸鱼、Provider／插件／Skill Logo、宠物、插图、内容图片、图表及原生窗口按钮 |

尺寸统一跟随用户设置解析后的界面语言：`zh-CN` 使用 `1em`，`en-US` 使用 `1cap`（跟随系统时使用现有 LocaleProvider 的解析结果）。复用根元素 `lang` 与继承变量，不检测标签内容；项目名、分支名、动态标签及 Portal 弹层保持同一语言规则。同行图标继续消费对应标签的字体上下文。多行说明行以主标题字号为准；保留侧栏、菜单等对齐列的占位宽度，仅缩放图形。样式只作用于组件拥有的图标槽位，不得全局覆盖 SVG／图片，也不得把固定图标 token 改为字体单位。普通 Lucide 图标继续使用描边 1.6；品牌占位 Lucide 标记 `data-icon-kind="artwork"` 并保留描边 2。

### 指针目标

桌面控件以 WCAG 2.2 SC 2.5.8 为基线。按钮、菜单项、选项和标签页的有效目标至少为 24×24 CSS px；小图标不代表小热区。透明区域必须实际接收指针，不能被相邻目标覆盖或父容器裁切。Checkbox／Radio 的关联标签属于同一操作目标。

嵌套关闭操作必须留出独立区域；虚拟列表应同步更新行尺寸。Review 行内操作、回合导航、分隔拖柄和自定义滚动条也纳入尺寸检查。正文内联链接按 Inline 例外判断；小目标如依赖间距例外，必须验证以包围盒中心绘制的直径 24px 圆不与其他目标或其他小目标的圆相交。键盘可操作本身不构成例外。

具体影响面、对照入口和人工验收见 [桌面交互验收](./desktop-interaction-acceptance.md)。

### 间距

普通 padding、margin 和 gap 只使用开放 4px 刻度：

| Token                  | 值                                      |
| ---------------------- | --------------------------------------- |
| `--cpx-sys-space-1..8` | `4 / 8 / 12 / 16 / 20 / 24 / 28 / 32px` |

页面边距、阅读宽度、Composer 安全区和侧栏缩进等跨 Feature 约束使用 `--cpx-sys-layout-*`。响应式 `vh/vw`、运行时面板宽度或拖拽边界必须声明为拥有选择器的局部变量；不得把实例尺寸提升为系统 Token。

### 圆角

圆角采用“基础刻度 + 语义角色”双层结构。基础刻度是唯一数值来源：

| 基础 Token                     |   数值 | 映射语义角色与使用场景                                     |
| ------------------------------ | -----: | ---------------------------------------------------------- |
| `--cpx-sys-radius-2xs` / `xs`  |    5px | `indicator` / `compact`：状态指示点、微型标签、徽标        |
| `--cpx-sys-radius-sm`          |    8px | `item`：菜单项、侧边栏导航行、Tooltip                      |
| `--cpx-sys-radius-md`          |   10px | `control` / `item-lg`：普通按钮、输入框、分段控件          |
| `--cpx-sys-radius-lg`          |   14px | `container` / `floating`：卡片容器、下拉浮层、Popover 面板 |
| `--cpx-sys-radius-xl` / `2xl`  |   18px | `prominent`：对话框（Modal）、Composer 悬浮容器、消息气泡  |
| `--cpx-sys-radius-3xl` / `4xl` |   24px | 大型展示容器、导引面板                                     |
| `--cpx-sys-radius-full`        | 9999px | `pill`：胶囊按钮、Switch 开关、标签胶囊、药丸触发器        |

光学校正统一为 `1.0`（纯净几何圆角，无超椭圆畸变）。`full` 只用于真正的胶囊、圆形控件、Badge、Chip、Toggle track 等，不得用于普通卡片、列表行、Dialog 或矩形表面。嵌套表面优先继承外层半径，或根据 `inner radius = max(outer radius - inset, 0)` 计算并映射到最近的已有 Token。

### 动效

时长按 `fast (160ms) / normal (220ms) / slow (340ms)` 体系，并搭配 standard 与 entrance 缓动：

- 标准缓动：`--cpx-sys-ease-standard: cubic-bezier(0.4, 0, 0.2, 1);`
- 入场缓动：`--cpx-sys-ease-entrance: cubic-bezier(0.22, 1, 0.36, 1);`
- 交互微动效（按钮、列表项、开关状态等）使用 `160ms`。
- 展开、抽屉与浮层动画使用 `220ms` 或 `340ms`。
- `data-reduce-motion="on"` 下所有系统时长自动归零。

### 阴影与层级

分级轻量投影与边缘高光（Dark 模式下自动反转透明度并增强对比度）：

- 边缘高光与常驻表面：`--cpx-sys-shadow-resting` / `--cpx-sys-shadow-raised`（浅色 `inset 0 1px 0 rgba(255, 255, 255, 0.7)` / 深色 `inset 0 1px 0 rgba(238, 238, 238, 0.04)`）。
- 悬浮控件与分段激活钮：`--cpx-sys-shadow-control`（默认使用 `none`，平直沉稳）。
- 浮层与模态弹窗：`--cpx-sys-shadow-floating`（`0 16px 48px rgb(0 0 0 / 24%)`，纯黑半透明阴影杜绝光晕）。
- 毛玻璃背景模糊：`--cpx-sys-blur-sm` (8px)、`--cpx-sys-blur-md` (16px)、`--cpx-sys-blur-lg` (24px)。

全局层级固定为 `local < sticky < dock < composer < modal < popover < tooltip < toast`。`-1..5` 只允许在明确 stacking context 内表达局部兄弟顺序；其他值必须使用系统层级 Token。

全局层级固定为 `local < sticky < dock < composer < modal < popover < tooltip < toast`。`-1..5` 只允许在明确 stacking context 内表达局部兄弟顺序；其他值必须使用系统层级 Token。

## Tailwind 消费方式

组件与页面外观写在 TSX 的 `tw:` utility 里，Token 通过 `src/styles/tailwind.css` 的 `@theme` / `@theme inline` 映射消费。

- 引用运行时变量（浅色/深色/自定义主题会改变的值）写在 `@theme inline`，例如 `--color-app-panel: var(--cpx-sys-color-surface-panel)`，让 utility 直接用 `var(--cpx-sys-color-*)`，而不是复制一份静态值。
- 静态值（如 `--spacing: 0.25rem`）写在普通 `@theme`；`--*: initial` 先清空 Tailwind 默认调色板，使 `--cpx-sys-*` 成为唯一真源。
- 排版用 `@utility type-*` 消费完整字体角色（`tw:type-title-md`、`tw:type-caption` 等），不在页面里逐条拼字号与字重。
- 颜色、圆角、阴影、模糊、语义层级、面板尺寸、图标尺寸与动效时长都有对应映射：`tw:bg-app-*`、`tw:rounded-control`、`tw:shadow-md`、`tw:z-popover`、`tw:max-w-conversation`、`tw:size-icon-md`、`tw:duration-state`。
- 普通间距沿用 4px 刻度：`--cpx-sys-space-N` 对应 `tw:gap-N` / `tw:px-N`。不在刻度上的控件几何用命名间距条目，例如 `--spacing-control-block: var(--cpx-comp-input-padding-block)` → `tw:py-control-block`。
- 每个 utility 与变体都必须带 `tw:` 前缀，且前缀在最前（`tw:hover:bg-app-hover`、`tw:data-[expanded=false]:grid-rows-[0fr]`）。漏写时 Tailwind 不报错也不生成规则，契约检查会直接失败。
- 无法用 utility 表达的规则（伪元素、`color-mix` 计算的表面、需要被 `transitionend`/`getComputedStyle`/测试读取的属性、第三方生成 DOM）写入 `src/styles/primitives/<name>.css`，由 `src/styles/tailwind.css` 加载到 `primitives` 层，并在文件头注释说明原因。

## 自动契约与例外

`scripts/CheckStyleContracts.ts` 的 `featureTokenContract` 扫描 `src/styles/features`、`src/styles/lazy` 下的残留 CSS、TS/TSX inline style 和 Tailwind arbitrary value，并验证例外重复与 stale 状态。同一脚本还校验 `tw:` 前缀、`type-*` 与 `tw:type-weight-*` 的组合、全源动效契约、单一样式入口图（`src/styles/tailwind.css`）与 `@layer` 顺序。Renderer 已不再编译 Sass：所有样式都是原生 CSS。

例外必须同时包含文件、属性、精确值和具体原因。可接受场景包括 Diff 行号的 `ch` 对齐、运行时拖拽边界、图表坐标、动态色板对比描边和第三方内部尺寸。不能因为迁移困难、希望保留任意历史像素或检查失败而新增例外。

## 示例

```tsx
<div
  className={cx(
    'feature-toolbar tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:rounded-control tw:z-sticky',
    'tw:transition-opacity tw:duration-state tw:ease-standard',
  )}
>
  <h2 className="feature-title tw:type-title-sm tw:text-app-text">{title}</h2>
  <p className="feature-description tw:type-body-sm tw:text-app-text-soft">{description}</p>
  <span className="feature-meta tw:type-caption tw:text-app-text-meta">{count}</span>
</div>
```

```css
/* 只在 utility 表达不了时使用：运行时几何、第三方 DOM、伪元素。 */
@layer primitives {
  .feature-empty-state {
    --empty-state-padding: clamp(var(--cpx-sys-space-3), 4vh, var(--cpx-sys-space-6));

    padding: var(--empty-state-padding);
  }
}
```
