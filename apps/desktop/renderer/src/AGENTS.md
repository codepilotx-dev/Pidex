# AGENTS.md

## 适用范围

本文件适用于 `apps/desktop/renderer/src/`，补充 [`../AGENTS.md`](../AGENTS.md) 的源码目录、React 状态边界与全部组件/Button/CSS 样式契约，不得弱化上级规则。

## UI 目录与模块边界

- 页面编排与分包：遵循 `Routes.tsx`、`App.tsx` 和 workbench registry 的现有页面编排与 lazy import 边界，保持 Review、Conversation 和 workbench 面板的 lazy chunk 可解析。
- 功能目录划分：Session 按 `conversation/`、`composer/`、`timeline/`、`approvals/`、`workflow/`、`summary/`、`subagents/`、`state/` 维护；Review 按 `workspace/`、`diff/`、`comments/`、`source/`、`state/` 维护（diff 解析、inline/split 展示、虚拟列表和评论逻辑只能有一个实现来源）；Layout 按 `shell/`、`dock/`、`tabs/`、`panels/` 维护。
- 聚合组件控制：不继续显著扩大 2000 行以上的聚合组件；仅当抽取是本次行为所需或能直接降低修改风险时，抽出涉及的独立职责。
- 视觉复用：必须复用 `components/ui/`、design-system token 和已有 feature 组件，禁止创建局部视觉体系。

## 状态与副作用

- React component 必须保持声明式；网络、IPC、持久化和 subscription 副作用放入 service、hook 或既有 feature state 层。
- UI component 不得直接解释新的 server wire 格式；事件必须先经过 Agent adapter、`session-view` projection 或既有 reducer。
- 设置变化必须经过现有 settings hook、storage helper 和 `desktop-client`，并验证本地更新及经过 service boundary 的持久化往返。

## 组件与样式契约

- 动作按钮适用边界：所有文字动作按钮及“图标 + 文字”动作按钮必须复用 `components/ui/Button`（统一高度、内边距、圆角、边框和主题自适应背景）。`primary` / `secondary` 只允许在真实 Action Button 内表达动作强调（危险、选中、禁用、加载和焦点状态可保留语义差异），不得用于把 selector、card、row、disclosure 或 toggle 伪装成动作按钮；纯图标工具按钮、导航、标签页、分段控件和开关必须使用各自组件，禁止套用动作按钮容器。
- `Button` 与 `ButtonGroup` 实现机制：基础规则、尺寸和变体统一定义在 `Button.tsx`，由根部 `<ButtonStyles />` 挂载一次并处于 `@layer primitives`（不维护独立 Button 样式表）。默认不输出任何 `class`（包括 `class=""`）及 `ui-button`、`icon-button`、`data-ui` 等身份标记；仅在调用方显式传入 `className` 时，通过支持 `tw:` 前缀和自定义 utility 的冲突合并器生成 `class`（在 `utilities` 层覆盖）。外观全部由属性驱动：`data-size`（高度、内边距、间距、默认图标）、`data-variant`（背景、文字、边框、状态）、`data-shape`（默认 `round`，胶囊 `pill`）、`data-icon-only`、`data-icon-size`、`data-layout`、`data-grow`、`data-shrink`、`data-color` 与 `data-position`；禁止补回基础/尺寸/圆角/变体/状态 utility，禁止以内联 `style` 下发固定尺寸与内边距。
- `sidebar` 预设与非动作可点击元素：`data-position="sidebar"` 是绑定属性（而非容器）的命名外观预设，携带整组侧栏入口外观（选中、悬停、展开态与文字色），右侧区域可直接复用，禁止在 Feature 样式里按该属性二次改样式。HTML 的 `button` 语义不等于动作 Button 视觉语义：可点击卡片、缩略图、文件胶囊和实体行必须保留原生 `button`/`a` 语义并由 Feature 单独拥有几何、hover 和 focus；禁止附加 `.ui-button`、`.interactive-row` 或 Button 的 `data-size`/`data-variant` 组合，禁止仅切换 Button 颜色变体掩盖冲突，也禁止改用 `div onClick` 规避约束。
- CSS 层级与 Tailwind 约定：基础组件自身拥有外观、交互状态与变体并通过语义化 props 驱动（特殊差异允许通过显式 `className` 覆盖，禁止通过跨层后代选择器覆盖基础组件外观）。除 `Button` 外，其他基础组件确需的私有样式就近维护在 `components/ui/<Component>.css` 并由组件 TSX 直接引入，置于 `@layer primitives`（必要时允许 `@layer overrides`）。业务特征样式按功能置于 `styles/features/*.css`，共享宿主机制（伪元素、运行时几何、第三方生成 DOM、`color-mix` 表面）置于 `styles/primitives/*.css`；普通业务布局使用 TSX 中的 `tw:` utility 并消费 `styles/tailwind.css` 里的 `--cpx-sys-*` 映射；禁止新增 `.scss`。
- 排版、设计文档与交互回归：排版使用 `tw:type-*` 角色，`tw:type-weight-*` 只能单独使用、不能与 `tw:type-*` 同元素。修改 Renderer token、颜色、排版、圆角、阴影或样式白名单时，按需读取 [`docs/design/renderer-token-system.md`](../../../../docs/design/renderer-token-system.md)、[`docs/design/renderer-color-system.md`](../../../../docs/design/renderer-color-system.md) 和相关 style contract。UI 修改时按相关性验证桌面窗口尺寸、快捷键、键盘焦点、主题、`reduced-motion`、popover 定位和会话恢复。
