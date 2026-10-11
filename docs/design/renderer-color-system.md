# Renderer 颜色语义规范

## 目标与分层

颜色用于表达空间层级、交互状态和业务含义，而不是装饰页面。Renderer 只有三层颜色来源：

1. **主题输入**：用户设置的强调色、背景、前景和对比度，只由主题派生器读取。
2. **系统语义颜色**：`--cpx-sys-color-*`，是 feature、页面和业务组件选择颜色的唯一入口。
3. **组件私有实现**：`--cpx-comp-*`，只允许在 `src/styles/components/`、基础浮层和对应基础组件内部组合尺寸、边框、阴影与系统语义色；feature 不得引用其中的颜色值。

新增颜色不是禁区，但必须先证明现有语义无法表达，再在系统层定义稳定含义。禁止用页面名、功能名、组件实例名或视觉描述（例如 `lighter-green-card`）创建公共颜色。

桌面配色沿用这三层来源，并对齐本地参考包的通用桌面主题：浅色默认 `surface=#ffffff`、`ink=#1f1f1f`、对比度 40；深色默认 `surface=#111111`、`ink=#eeeeee`、对比度 60；两者 `accent=#0169cc`。新设置和 `Codex(new)` 预设使用这些默认值，原版 Codex 与代码语法主题保留。用户保存的 V6/V7 配色、字体与字号继续保留；不得通过识别旧默认色偷偷迁移用户设置，也不得新增平行变量命名。

现有派生器统一生成 surface、foreground、border 与 accent 角色：浅色编辑器背景向白色混合 12%，深色向 ink 混合 7%；panel 使用参考 panel 公式，raised 使用 elevatedPrimary，control 使用 controlOpaque。次级文字为 ink 的 65% 透明度，三级文字和边框随对比度派生；深色细边框透明度为 `0.03 + 0.02 × 归一化对比度`。强调前景在深色中向白色提亮，柔和背景、hover 和 active 使用独立的强调派生；文字继续执行现有 4.5:1 对比度校正，Diff 不复用强调色背景算法。

外观页强调色支持默认、蓝 `#3566F0`、绿 `#19B79E`、黄 `#FDCD54`、粉 `#FA70AB`、橙 `#FF8771`、紫 `#AB5EFF`、黑/白及自定义。默认与黑/白均使用浅色 `#000000`、深色 `#FFFFFF`，但通过可选 `accentPreset` 分别记住选择；`accent` 始终保存实际 HEX。V6/V7 缺失、无效或与实际颜色不匹配的预设字段按自定义处理，保留实际颜色，不根据 HEX 猜测预设，也不升级设置版本。

仅自定义模式显示色盘与六位 HEX 输入；从预设切入自定义使用当前所选代码主题的强调色 seed，seed 未就绪时禁用该选项。已有自定义输入保留，切换代码主题后使用新 seed 并恢复自定义模式。合法 HEX 实时保存，不完整或非法输入不持久化，失焦恢复有效值。预设切换只影响强调色；背景、前景与自定义强调色共用中性胶囊，容器使用 `fg-primary`、`border-default` 与透明背景，实际颜色仅绘制在圆形色点上。

## 公共语义角色

### 空间与文字

| 角色                                 | 使用场景                                       | 禁止场景                           |
| ------------------------------------ | ---------------------------------------------- | ---------------------------------- |
| `surface-canvas`                     | 页面、主工作区                                 | 卡片、输入框                       |
| `surface-recessed`                   | 侧栏、代码底板、下沉区域                       | 浮层                               |
| `surface-panel`                      | 常驻面板、卡片、文档流摘要、审批容器           | 模态和覆盖工作区的浮动摘要         |
| `surface-control`                    | 输入框、选择器、Composer 输入面                | 页面底色                           |
| `surface-raised`                     | Modal、Popover、Dropdown、Toast、悬浮 Composer | 常驻卡片                           |
| `surface-editor`                     | Diff、编辑器、预格式化代码                     | 普通正文                           |
| `fg-primary`                         | 标题、正文、关键值                             | 元信息                             |
| `fg-secondary`                       | 说明、次要操作                                 | 禁用信息                           |
| `fg-tertiary`                        | 时间、来源、低优先级元信息                     | 正文                               |
| `fg-disabled`                        | 不可交互内容                                   | 可操作内容                         |
| `message-user-bg`                    | 静态用户消息背景                               | hover、selected、active 等交互状态 |
| `border-subtle/default/strong/focus` | 同级分隔、容器、强调边界、键盘焦点             | 用边框颜色假装业务状态             |

浅色主题中 `surface-recessed` 向深色方向派生，`surface-control` 与 `surface-raised` 向浅色方向派生；暗色主题保持相反的明度关系，使下沉、控件和浮起语义在自定义背景与对比度下仍然成立。常驻容器通过相邻表面与 1px 边框形成层级，不加阴影。

`message-user-bg` 默认由 `fg-primary` 以 5% 透明度混合派生，使静态用户消息随主题前景、背景和对比度变化保持克制但可辨识。它不属于空间 surface，也不属于交互状态；静态内容不得借用 `hover`、`selected` 或 `active`，主题调整交互反馈时不应连带改变历史消息。

持续覆盖工作区的悬浮 Composer 和绝对定位线程环境摘要使用 `surface-raised` 与 `--cpx-sys-shadow-prominent`。Modal、Popover、Dropdown、Toast 等瞬时浮层使用 `surface-raised` 与 `--cpx-sys-shadow-floating`。当线程摘要位于 Popover 内时，由 Popover 外壳负责 elevation，摘要内容保持透明且不重复投影。

### Workbench 区域

Workbench 大区域使用独立的公共区域 token，布局 Feature 不直接绑定基础 surface：

| 区域                  | 语义 token                              | 默认来源                                                                                 |
| --------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| 窗口标题/菜单栏       | `--cpx-sys-color-workbench-titlebar-bg` | 跟随侧栏背景（`--cpx-sys-color-workbench-sidebar-bg`）                                   |
| 左侧栏                | `--cpx-sys-color-workbench-sidebar-bg`  | 浅色为 `gray-2`（`--cpx-ref-gray-2`），深色为 Deep（`--cpx-sys-color-surface-recessed`） |
| 主工作区              | `--cpx-sys-color-workbench-main-bg`     | `--cpx-sys-color-surface-canvas`                                                         |
| 右侧 Dock、底部 Panel | `--cpx-sys-color-workbench-panel-bg`    | `--cpx-sys-color-workbench-main-bg`                                                      |

`surface-panel` 仍用于工作区内部的常驻卡片、摘要和审批容器，不代表右侧 Dock 或底部 Panel 的外层底色。Feature 只消费公开区域 token，不消费颜色类 `--cpx-comp-*`，也不直接选择基础 surface。默认值相同的区域仍保持独立 token，以允许主题覆盖并避免组件耦合；工作区 toolbar/header 保持透明并继承 `workbench-main-bg`，不使用 titlebar token。

Workbench 大区域之间的持久结构边界使用 `border-default`；toolbar、章节、卡片和容器内部细分隔使用 `border-subtle`；强调轮廓使用 `border-strong`，键盘焦点使用 `border-focus`。暗色模式的“线条更深”实际表现为相对深色背景更亮、对比度更高；同一物理边界只能由一个容器绘制，禁止父子容器叠加边框。不得通过全局改写 `border-default` 或创建页面专属同值 token 修复单一消费点。

### 业务与交互语义

| Tone      | 唯一含义                           | 典型场景                     |
| --------- | ---------------------------------- | ---------------------------- |
| `accent`  | 当前选择、焦点、主要交互           | 选中导航、焦点环、当前配置   |
| `info`    | 中性信息、来源、无风险进行中       | 提示、来源、同步中           |
| `success` | 已成功、已通过、已连接             | 完成状态、批准、Diff added   |
| `warning` | 需注意、等待判断、可恢复风险       | 待审批、限额提醒             |
| `danger`  | 失败、拒绝、破坏性操作             | 删除、权限拒绝、Diff removed |
| `skill`   | Agent、Skill、Plugin、工具能力身份 | 能力标签、工具身份           |

每个彩色 tone 使用一致的角色族：基础色用于小图标或状态点，`*-fg` 用于短文字，`*-subtle-bg` 与 `*-subtle-border` 成对用于状态容器。大面积实色背景、仅靠红绿区分状态、用 `success` 表示“当前选中”都不允许。

Hover、selected、active 是交互阶段，不是业务状态；使用统一的 `hover`、`selected`、`active`，不得在 feature 中临时混合强调色。

主按钮与发送按钮使用 ink 背景和反向前景，普通侧栏选中项保持中性；强调实色按钮和 Switch 选中轨道使用 accent，链接及强调文字使用 `accent-fg`，键盘焦点使用 `border-focus`。基础组件的柔和强调按钮使用强调前景的 10% 透明背景，hover 为 15%；Switch 未选中轨道为 ink 的 10% 透明背景，滑块保持白色；滚动条默认使用 `border-default`，hover/active 使用 `border-strong`。文本选区保留半透明背景，避免实色选区遮蔽内容。

## Agent 选择流程

1. 先判断内容是否有明确业务含义；有则从六个 tone 中选择，没有则保持 neutral。
2. 根据空间位置选择一种 surface；不要为同级卡片轮换颜色。
3. 根据阅读优先级选择一种 foreground，并按容器关系选择 border。
4. 只有真实交互才叠加 hover、selected、active 或 focus。
5. 找不到角色时停止编码，补充语义定义、明暗主题算法、适用和禁用场景后再新增 system token。

同一容器最多使用一个业务 tone，且必须同时提供文字、图标或标签线索。状态卡片的标准组合是：

```tsx
<div
  className="connection-state tw:rounded-md tw:border tw:border-app-warning-border tw:bg-app-warning-subtle tw:text-app-warning-fg"
  data-tone="warning"
/>
```

错误示例：

```tsx
// feature 越权消费组件内部颜色
'bg-[var(--cpx-comp-input-bg)]'

// 无主题语义、不能适配明暗模式
'tw:text-[#3d8f72]'

// 在调用点发明另一套状态强度（设计系统里没有对应语义色）
'tw:bg-[color-mix(in_srgb,var(--cpx-sys-color-warning)_9%,var(--cpx-sys-color-surface-panel))]'
```

## 例外与自动检查

`css:check` 对 `src/styles/features/` 和 `src/styles/lazy/` 强制执行：

- 禁止引用颜色类 `--cpx-comp-*`；尺寸、圆角等非颜色组件契约不受此规则影响。
- 禁止十六进制、RGB、HSL 等裸颜色。
- 禁止在 feature 中混合两个系统语义颜色，或用局部颜色变量自行派生新色阶。
- TSX 通过 `tw:bg-app-*` / `tw:text-app-*` / `tw:border-app-*` 消费语义颜色；命名不在 `tailwind.css` 的 `@theme inline` 里时，说明该语义色还没有映射，应先补映射，而不是在调用点写任意值。
- 色盘、图表数据色和第三方终端等确实无法由单个语义角色表达的算法，必须在 `style-contracts.json` 记录精确的文件与 token、字面值或局部变量，并写明原因。
- 每个例外必须被真实代码使用；代码迁移后未删除的 stale 例外会导致检查失败。禁止文件级通配、数量基线和“为了通过检查”批量刷新例外。

新增 system tone 的评审必须同时回答：它表达什么、与现有 tone 的差异、哪些场景禁止使用、浅色与暗色如何派生、文字对比度是否至少达到 WCAG AA，以及旧 Agent 是否可以安全忽略它。
