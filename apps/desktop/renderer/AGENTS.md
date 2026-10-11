# AGENTS.md

## 适用范围

本文件适用于 `apps/desktop/renderer/`，并补充仓库根目录规则。本文件只能增加 Renderer 实现细则，不得弱化根规则。

## Workspace 与客户端边界

- `shared/` 保存跨 Renderer/preload 的明确契约，`src/` 保存 UI 实现，`test/` 保存 Renderer 测试。
- 系统能力只能通过 typed preload bridge 或 Agent client 使用。禁止直接访问 Node、Electron、SQLite、凭据或文件系统。
- RPC wire 契约来自 `@pidex/agent-protocol`，thread 领域模型来自 `@pidex/shared/thread`。
- Desktop client 稳定入口为 `src/services/desktop-client/index.ts`。入口只负责环境选择、组合和导出。
- 必须复用现有 `agentRpcClient`、`agentThreadAdapter`、desktop client 和 session-view projection，禁止创建第二套 transport 或状态协议。
- Renderer 优先提供多项目、多聊天、Review、Artifact、Visualization、Worktree、Scheduled task、通知和系统能力的桌面可视化工作台。
- 所有共享行为继续经过 `desktop-client`、Agent RPC 和 `session-view`，禁止在组件、Hook 或状态仓库内复制 CLI/Agent 逻辑。
- Review pane、文件预览、行级评论和项目导航属于桌面交互层；其数据真源和变更操作仍由共享 service/contract 提供。
- 禁止在 Renderer 中模拟 `codex exec`、Shell 管道、JSONL 或 CI runner。桌面需要相同底层能力时，必须通过 Agent service 增加可复用接口并提供桌面交互。
- 跨端功能必须根据协议 capability 显示、降级或隐藏，禁止根据 User-Agent、应用版本字符串或失败结果猜测能力。
- 必须保留 desktop-first 布局。除非任务明确要求，禁止新增移动端、窄视口或未来 CLI/TUI 的 Renderer 兼容分支。

## 数据代际

- Renderer 只能清理明确列出的 Pidex localStorage/sessionStorage 键和前缀。
- 禁止调用 `localStorage.clear()` 或删除其他 origin 所有者的数据。
- 数据 epoch 已淘汰旧 UI state。禁止重新加入 v3、legacy plan、旧 Review expansion 或旧单问题兼容分支。

## 组件与样式契约

- 所有文字动作按钮及“图标 + 文字”动作按钮必须复用 `components/ui/Button`，并使用统一高度、内边距、圆角、边框和主题自适应背景。`primary` / `secondary` 只允许在真实 Action Button 内表达动作强调，不得用于把 selector、card、row、disclosure 或 toggle 伪装成动作按钮。
- 危险、选中、禁用、加载和焦点状态可以保留语义差异。纯图标工具按钮、导航、标签页、分段控件和开关必须使用各自组件，禁止套用动作按钮容器。
- HTML 的 `button` 语义不等于动作 Button 视觉语义。可点击卡片、缩略图、文件胶囊和实体行必须保留正确的原生 `button`/`a` 语义，并由 Feature 单独拥有几何、hover 和 focus；禁止附加 `.ui-button` 或 `.interactive-row`，禁止仅切换 Button 颜色变体掩盖冲突，也禁止改用 `div onClick` 规避约束。
- 修改 Renderer token、颜色、排版、圆角、阴影或样式白名单时，分别读取 `docs/design/renderer-token-system.md`、`docs/design/renderer-color-system.md` 和相关 style contract；非样式任务无需读取这些文档。

## Windows 标题栏

- `.desktop-menubar` 的最终计算背景色是 Windows 标题栏颜色真源，透明 Window Controls Overlay 必须直接透出该背景。
- Renderer 菜单栏高度 token 必须固定为 `36px`，并与 Windows 原生窗口控制区一致。禁止重新依赖 DOM 实测高度或 `titlebar-area-height` 回写。
- 修改菜单栏高度、标题栏主题 token、主题派生色或 Workbench 区域色时，必须同步检查 Renderer token、最终计算样式和 Electron overlay。
- 标题栏变化必须在 Windows 浅色、深色和自定义主题下验证无颜色断层、无高度跳变，并确认原生窗口按钮行为不变。

## 测试与验证

- 首屏 JS/CSS 体积只作信息统计，不设体积门禁；完整功能、视觉和交互效果优先，允许更长的加载时间，禁止为缩减体积删除或降级已要求的效果。
- 测试重点是状态转换、client contract 和具体回归，放在现有 `test/` 目录。
- 类型检查：`bun run --cwd apps/desktop/renderer typecheck`。
- 完整测试：`bun run --cwd apps/desktop/renderer test`。
- UI、lazy import、Vite、TypeScript project reference 或 asset pipeline 变化时运行：`bun run build:renderer`。
- 样式变化时运行：`bun run --cwd apps/desktop/renderer css:check`。
- 禁止为了通过检查而盲目更新 CSS、style 或 test 基线。
