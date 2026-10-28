# AGENTS.md

## 适用范围

本文件适用于 `apps/desktop/renderer/`，补充根目录 [`AGENTS.md`](../../../AGENTS.md) 的 Renderer 工作区细则，不得弱化根规则。UI 目录结构、React 状态规则与全部组件/Button/CSS 样式契约见 [`src/AGENTS.md`](src/AGENTS.md)。

## Workspace 与客户端边界

- 目录与隔离：`shared/` 保存跨 Renderer/preload 的明确契约，`src/` 保存 UI 实现，`test/` 保存 Renderer 测试。系统能力只能通过 typed preload bridge 或 Agent client 使用，禁止直接访问 Node、Electron、SQLite、凭据或文件系统。
- 契约与通信复用：RPC wire 契约来自 `@pidex/agent-protocol`，thread 领域模型来自 `@pidex/shared/thread`。Desktop client 稳定入口为 `src/services/desktop-client/index.ts`（只负责环境选择、组合和导出）；必须复用现有 `agentRpcClient`、`agentThreadAdapter`、`desktop-client` 和 `session-view` projection，禁止创建第二套 transport 或状态协议。
- 桌面工作台职责：Renderer 承载多项目、多聊天、Review pane、文件预览、行级评论、Artifact、Visualization、Worktree、Scheduled task、通知和系统能力的桌面可视化交互，其数据真源和变更操作仍由共享 service/contract 提供；禁止在组件、Hook 或状态仓库内复制 CLI/Agent 业务逻辑，禁止在 Renderer 中模拟 `codex exec`、Shell 管道、JSONL 或 CI runner（需相同底层能力时必须通过 Agent service 增加可复用接口）。
- 能力协商与布局：跨端功能必须根据协议 capability 显示、降级或隐藏，禁止根据 User-Agent、应用版本字符串或失败结果猜测能力。保持 desktop-first 布局，除非任务明确要求，禁止新增移动端、窄视口或未来 CLI/TUI 的 Renderer 兼容分支。

## 本地存储与数据代际

- Renderer 只能清理明确列出的 Pidex `localStorage` / `sessionStorage` 键和前缀，严禁调用 `localStorage.clear()` 或删除其他 origin 所有者的数据。
- 数据 epoch 已淘汰旧 UI state，禁止重新加入 v3、legacy plan、旧 Review expansion 或旧单问题（AskUserQuestion）兼容分支。

## Windows 标题栏

- `.desktop-menubar` 的最终计算背景色是 Windows 标题栏颜色真源，透明 Window Controls Overlay 必须直接透出该背景。
- Renderer 菜单栏高度 token 固定为 `36px`，并与 Windows 原生窗口控制区一致；禁止重新依赖 DOM 实测高度或 `titlebar-area-height` 回写。
- 修改菜单栏高度、标题栏主题 token、主题派生色或 Workbench 区域色时，必须同步检查 Renderer token、最终计算样式和 Electron overlay，并在完整重启桌面进程后于 Windows 浅色、深色和自定义主题下验证无颜色断层、无高度跳变，且确认原生窗口按钮行为不变。

## 测试与验证

- 首屏体积策略：首屏 JS/CSS 体积只作信息统计、不设体积门禁；完整功能、视觉和交互效果优先（允许更长加载时间），禁止为缩减体积删除或降级已要求的效果。
- 测试重点：聚焦状态转换、client contract 和具体回归，统一放在现有 `test/` 目录。
- 验证命令：类型检查 `bun run --cwd apps/desktop/renderer typecheck`；完整测试 `bun run --cwd apps/desktop/renderer test`；样式变化时运行 `bun run --cwd apps/desktop/renderer css:check`；UI、lazy import、Vite、TypeScript project reference 或 asset pipeline 变化时运行 `bun run build:renderer`。禁止为了通过检查而盲目更新 CSS、style 或 test 基线。
