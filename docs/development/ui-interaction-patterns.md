# Renderer UI 交互术语与实现规范

本文是 Pidex Desktop Renderer 的交互语义真源。术语描述用户看到的行为，
不要求每个术语都对应一个通用 React 组件。公共视觉和可访问性放在
`components/ui/`，涉及领域数据、持久化或复杂状态的交互保留在对应 feature。

## 术语与代码映射

| 术语                            | 中文                                 | 规范实现                                             |
| ------------------------------- | ------------------------------------ | ---------------------------------------------------- |
| Reorder                         | 拖动排序                             | Taskboard `BoardColumn` 的任务移动逻辑               |
| Drop Zone                       | 拖放区域                             | Composer 文件拖入区域                                |
| Placeholder                     | 拖拽占位符                           | Taskboard 卡片槽位的 `data-drag-insert` 状态         |
| Cross-list Transfer             | 跨列表转移                           | Taskboard 跨状态列 `onMove`                          |
| Read More                       | 展开全文                             | `CollapsibleUserMarkdown`                            |
| Collapse                        | 独立折叠区块                         | 各 feature 的受控 disclosure 状态                    |
| Tree View                       | 树形视图                             | Workspace 与 Review 文件树                           |
| Tooltip                         | 工具提示                             | `components/ui/Tooltip`                              |
| Popover                         | 弹出浮层                             | `components/ui/AnchoredPopover` 或专用搜索 Popover   |
| Dropdown                        | 下拉菜单                             | `PopoverMenu`；选值场景使用 `SettingsDropdown`       |
| Spinner                         | 旋转加载指示器                       | `components/ui/Spinner`                              |
| Skeleton                        | 骨架屏                               | `SkeletonRegion` 与 `SkeletonBlock`                  |
| Shimmer                         | 骨架屏流光                           | `SkeletonBlock` 的默认伪元素动画                     |
| Button Loading                  | 按钮加载状态                         | `Button loading`                                     |
| Page Loader                     | 页面加载器                           | `FullScreenWhaleLoading`                             |
| Action Button                   | 文字动作按钮                         | `components/ui/Button`                               |
| Icon Action                     | 纯图标工具动作                       | `components/ui/IconButton`                           |
| Navigation / Menu / Compact Row | 导航、菜单或紧凑列表行               | 对应专用组件；确属共享紧凑行时使用 `interactive-row` |
| Clickable Surface               | 可点击卡片、缩略图、文件胶囊或实体行 | 原生 `button`/`a` 语义与 Feature 自有视觉            |
| Persistent Choice               | 持久模式或多项选择                   | `SegmentedControl`、`Select`、Toggle 等对应控件      |

## 拖拽交互

- 同列排序与跨列移动复用同一个任务 payload、落点计算和 `onMove` 调用，不在
  React 组件中复制持久化逻辑。
- 只有有效 MIME payload 进入目标区域时才显示放置反馈。文件 Drop Zone 只接收
  `Files`；Taskboard task move 与 sidebar thread copy 使用各自的 payload。
- 拖动中的卡片可以临时抬起并使用浮层微投影；静止卡片保持扁平、零阴影。
- 插入位置必须在松手前可见，移动失败后恢复原状态并给出不泄露内部错误的提示。
- 键盘用户必须能通过任务菜单完成上移、下移和跨状态移动。

## 展开与树形导航

- Read More 只用于长正文原地展开，入口使用“展开全文”，展开后使用“收起”。
- Collapse 区块彼此独立，触发器使用 `aria-expanded` 和稳定的
  `aria-controls`。只有产品明确要求互斥时才使用 Accordion 语义。
- 折叠后不可见内容中的交互元素不得继续进入 Tab 顺序。
- Tree View 的容器使用 `role="tree"`，行使用 `role="treeitem"`、`aria-level`；
  目录提供 `aria-expanded`，可选择文件提供 `aria-selected`。
- Workspace Tree 与 Review Tree 共享交互语义，但不合并数据模型、异步加载或
  Review 状态图标。

## 浮层与选择

- Tooltip 只承载简短说明，悬停和键盘聚焦均可触发。路径全文、图表数据点、
  Markdown 链接标题等内容元数据可继续使用原生 `title`。
- 普通锚定说明或少量操作使用 `AnchoredPopover`，统一 Portal、surface、碰撞边距、
  尺寸变量和可选箭头。
- 命令列表使用 `PopoverMenu`/Radix DropdownMenu；单项表单选择使用
  `SettingsDropdown`/Radix Select。不要因视觉相似互换它们的键盘语义。
- 搜索型、Hover Card 或具有专用焦点管理的 Popover 可以保留 feature 组件，但必须
  复用 `popover-surface`、`popoverSizing` 和浮层阴影 token。

## 加载状态

- 未知时长的局部等待使用 `Spinner`；独立状态传 `label`，已有可见状态文案时作为
  装饰元素使用。
- 提交按钮使用 `loading`，由 Button 同时提供 Spinner、`aria-busy` 和禁用语义，
  不在调用方重复拼装。
- 结构化内容首次加载使用 `SkeletonRegion` 和 `SkeletonBlock`。Shimmer 是 Skeleton
  的默认视觉反馈，不单独渲染；reduced-motion 下停止流光。
- 页面或会话核心内容尚未准备完成时使用 `FullScreenWhaleLoading`；`fullscreen`
  覆盖整窗，`contained` 只替代主内容区。禁止用按钮 Spinner 代替页面加载器。

## 容易混淆的边界

- HTML 的 `button` 语义不等于动作 Button 视觉。可点击卡片、缩略图、文件胶囊和
  实体行保留原生 `button` 键盘语义，但由 Feature 单独拥有几何、hover 和 focus，
  不附加 `.ui-button` 或 `.interactive-row`。
- `Button` 用于提交、确认、重试、清除等一次性动作；纯图标工具动作使用
  `IconButton`；持久模式选择使用 `SegmentedControl`、`Select` 或 Toggle。
- 禁止通过把 `primary` 改为 `ghost` 掩盖错误的视觉所有权，也禁止改用
  `div onClick` 规避按钮样式冲突。
- Placeholder 表示拖动落点；Skeleton 表示尚未返回的数据结构。
- Skeleton 定义占位布局；Shimmer 只是其加载动效。
- Tooltip 是短说明；Popover 是锚定内容；Dropdown 是菜单或选择行为。
- Spinner 表示局部未知时长等待；Button Loading 绑定一次操作；Page Loader
  表示页面或核心区域尚不可用。
- Collapse 允许多个区块同时展开；Accordion 一次只展开一个。
