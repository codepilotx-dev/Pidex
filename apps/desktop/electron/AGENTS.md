# AGENTS.md

## 适用范围

本文件适用于 `apps/desktop/electron/`，补充根目录 [`AGENTS.md`](../../../AGENTS.md) 的 Electron 主进程与桌面集成细则，不得弱化根规则。

## 职责与目录

- 职责边界：Electron 只承载桌面壳、preload、安全策略、Agent sidecar 生命周期、安装包及真实 OS 集成（窗口、托盘、通知、深链、剪贴板，以及 Browser、Computer Use、Voice、Appshots 等系统能力 adapter）。
- 业务隔离：桌面业务能力统一通过 Agent sidecar 和 typed bridge 获取，禁止通过启动 CLI 子进程复制 Agent 调用链；Desktop 专属能力的会话状态、审批、权限、工具结果和持久业务数据仍归 Agent 与共享契约所有，禁止把 Provider、session、SQLite 等业务状态移入 Electron。
- 目录划分：`src/main.ts` 只保留单实例、应用生命周期和依赖装配；`src/sidecar/` 负责 sidecar command、readiness 和 supervisor；`src/windows/` 负责窗口创建与外观控制；`src/ipc/` 负责 IPC 注册与桌面集成；`src/security/` 负责 cookie 与导航策略；`src/settings/` 负责设置契约与持久化；`src/logging/` 负责日志。

## 安全、IPC 与设置持久化

- 进程隔离：必须保持 `contextIsolation: true`、Renderer 禁用 Node，并启用 sandbox。
- 类型化 Preload 与 IPC：新增系统能力时必须先集中定义 IPC contract（channel、参数和返回类型），在主进程验证 Renderer 输入，再由 preload 暴露最小、明确、类型化的方法并同步更新 preload 与 Renderer 共享契约；禁止暴露任意 channel、Electron 对象、Node 模块、凭据或任意文件系统访问。
- 运行时安全：必须保留 URL allowlist、导航拦截、auth cookie 验证和 API key 剪贴板 60 秒清理。
- 外观设置迁移与恢复：`appearance-settings.json` 当前持久化版本为 7（V1～V5 按既有语义重置为当前默认值，V6 保留已知设置并迁移到 V7，高于 V7 的文件原样保留并拒绝覆盖）。只有 JSON 已损坏的 `appearance-settings.json` 可按既有恢复逻辑精确删除并重建；该例外不得扩大到父目录、数据库、可解析但不受支持的版本或未知文件。设置重置日志遵循根文件脱敏要求。

## Sidecar 与打包

- 必须保留 watchdog、ready stdout/health probe、就绪超时、断线重连、`/api/shutdown` 和优雅退出，并保持开发与 packaged sidecar 路径兼容。
- 必须保留 Agent executable、Renderer、model snapshot、third-party notices/licenses 的 `extraResources` 布局。

## Windows 标题栏

- Windows 主窗口继续使用 `titleBarStyle: "hidden"` 和 Electron Window Controls Overlay（通过 `createWindowsTitleBarOverlay` 统一创建）；Renderer 绘制菜单栏，Windows/Electron 只绘制原生最小化、最大化和关闭按钮，禁止改回完整原生标题栏或全自绘窗口按钮。
- Window Controls Overlay 高度固定为 `36px`，背景保持完全透明以透出 Renderer 菜单栏；Electron 只能根据当前主题的 `ink` 更新原生窗口按钮图标色，禁止重新加入 Renderer DOM 颜色或高度回写 IPC。
- 修改标题栏高度、主题、overlay 参数或窗口装配后，必须同时验证 Electron 与 Renderer，并完整重启桌面开发进程（禁止只依赖 Vite 热更新验收）。

## 验证

- 类型检查：`bun run --cwd apps/desktop/electron typecheck`；Electron 行为变化时运行相关 Bun 测试。
- 构建：`bun run build:desktop`；只有用户明确要求或安装包行为在范围内时才运行 `bun run package:win`。
- 标题栏变化必须在 Windows 浅色、深色和自定义主题下验证无颜色断层、无高度跳变，并确认原生窗口按钮行为不变。
