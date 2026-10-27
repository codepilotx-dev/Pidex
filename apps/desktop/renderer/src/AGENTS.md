# AGENTS.md

## 适用范围

本文件适用于 `apps/desktop/renderer/src/`，并补充 Renderer workspace 规则。本文件只能增加源码实现细则，不得弱化上级规则。

## UI 与模块边界

- 必须遵循 `Routes.tsx`、`App.tsx` 和 workbench registry 的现有页面编排与 lazy import 边界。
- Session 代码按 `conversation/`、`composer/`、`timeline/`、`approvals/`、`workflow/`、`summary/`、`subagents/`、`state/` 维护。
- Review 代码按 `workspace/`、`diff/`、`comments/`、`source/`、`state/` 维护。
- Layout 代码按 `shell/`、`dock/`、`tabs/`、`panels/` 维护。
- Review diff 解析、inline/split 展示、虚拟列表和评论逻辑只能有一个实现来源。
- 不继续显著扩大 2000 行以上的聚合组件；仅当抽取是本次行为所需，或能直接降低本次修改风险时，抽出涉及的独立职责。
- 必须复用 `components/ui/`、design-system token 和已有 feature 组件，禁止创建局部视觉体系。

## 状态与副作用

- React component 必须保持声明式。网络、IPC、持久化和 subscription 副作用放入 service、hook 或既有 feature state 层。
- UI component 不得直接解释新的 server wire 格式。事件必须先经过 Agent adapter、session-view projection 或既有 reducer。
- 设置变化必须经过现有 settings hook、storage helper 和 desktop client。
- 禁止重新加入旧 UI state、legacy plan、v3 Review expansion 或旧 AskUserQuestion shape。

## 体验与回归

- 基础组件自身拥有其外观、交互状态与变体，调用方通过语义化 props 驱动，特殊差异允许通过显式传入的 `className` 覆盖，并合并冲突 utility；普通业务布局使用 TSX 中的 `tw:` utility，并消费 `styles/tailwind.css` 里的 `--cpx-sys-*` 映射。禁止通过跨层后代选择器覆盖基础组件外观。
- Button 与 ButtonGroup 的基础规则、尺寸和变体统一在 `Button.tsx` 中定义，通过支持 `tw:` 前缀和自定义 utility 的冲突合并器接受调用方覆盖，不维护独立 Button 样式表。
- 其他基础组件确需 CSS 的私有样式就近维护在 `components/ui/<Component>.css` 中并由组件 TSX 直接引入；规则放置于 `@layer primitives`（必要时允许 `@layer overrides`），禁止破坏级联层级或绕过样式契约。
- 业务特征样式按所属功能置于 `styles/features/*.css`，共享宿主机制置于 `styles/primitives/*.css`（伪元素、运行时几何、第三方生成 DOM、`color-mix` 表面）；Renderer 不再编译 Sass，禁止新增 `.scss`。
- 排版用 `tw:type-*` 角色；`tw:type-weight-*` 只能单独使用，不能与 `tw:type-*` 同元素。
- UI 修改时按相关性验证桌面窗口尺寸、快捷键、键盘焦点、主题、reduced-motion、popover 定位和会话恢复。
- 设置修改时必须验证本地更新，以及经过 service boundary 的持久化往返。
- 必须保持 Review、Conversation 和 workbench 面板的 lazy chunk 可解析。
