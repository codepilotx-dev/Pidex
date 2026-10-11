# AGENTS.md

## 适用范围

本文件适用于 `apps/desktop/electron/`，并补充仓库根目录规则。本文件只能增加 Electron 实现细则，不得弱化根规则。

## 职责与目录

- Electron 只负责窗口、preload、安全 cookie、Agent sidecar 生命周期、桌面集成和安装包。
- `src/main.ts` 只保留单实例、应用生命周期和依赖装配。
- Sidecar command、readiness 和 supervisor 放在 `src/sidecar/`。
- 窗口创建与外观控制放在 `src/windows/`。
- IPC 注册与桌面集成放在 `src/ipc/`。
- Cookie 与导航策略放在 `src/security/`。
- 设置契约与持久化放在 `src/settings/`，日志放在 `src/logging/`。
- 禁止把 Provider、session、SQLite 或其他 Agent 业务状态移入 Electron。
- Electron 只承载桌面壳与真实 OS 集成，包括窗口、托盘、通知、深链、剪贴板，以及 Browser、Computer Use、Voice、Appshots 等系统能力 adapter。
- 桌面业务能力继续通过 Agent sidecar 和 typed bridge 获取，禁止通过启动 CLI 子进程复制 Agent 调用链。
- Desktop 专属能力可以有 Electron 实现，但其会话状态、审批、权限、工具结果和持久业务数据仍归 Agent 与共享契约所有。

## 安全与 IPC

- 必须保持 `contextIsolation: true`、Renderer 禁用 Node，并使用 sandbox。
- preload 只能暴露最小、明确、类型化的方法，禁止暴露任意 channel、Electron 对象、Node 模块、凭据或任意文件系统访问。
- 新增系统能力时必须先定义集中式 IPC contract，再由 preload 暴露最小类型化接口。
- 新 IPC 必须集中定义 channel、参数和返回类型，验证 Renderer 输入，并同步更新 preload 与 Renderer 共享契约。
- 必须保留 URL allowlist、导航拦截、auth cookie 验证和 API key 剪贴板 60 秒清理。
- 外观设置当前持久化版本为 7。V1～V5 按既有语义重置为当前默认值，V6 保留已知设置并迁移到 V7；高于 V7 的文件必须原样保留并拒绝覆盖。
- 只有 JSON 已损坏的 `appearance-settings.json` 可以按既有恢复逻辑精确删除并重建；该例外不得扩大到父目录、数据库、可解析但不受支持的版本或未知文件。
- 设置重置日志不得包含路径、文件内容、凭据或会话内容。

## Sidecar 与打包

- 必须保留 watchdog、ready stdout/health probe、就绪超时、断线重连、`/api/shutdown` 和优雅退出。
- 必须保持开发与 packaged sidecar 路径兼容。
- 必须保留 Agent executable、Renderer、model snapshot、third-party notices/licenses 的 `extraResources` 布局。

## Windows 标题栏

- Windows 主窗口必须继续使用 `titleBarStyle: "hidden"` 和 Electron Window Controls Overlay，禁止改回完整原生标题栏或全自绘窗口按钮。
- Window Controls Overlay 必须通过 `createWindowsTitleBarOverlay` 统一创建，背景保持完全透明，高度保持 `36px`。
- Electron 只能根据当前主题的 `ink` 更新原生窗口按钮图标色，禁止重新加入 Renderer DOM 颜色或高度回写 IPC。
- 修改标题栏主题、overlay 参数或窗口装配后，必须完整重启桌面开发进程。禁止只依赖 Vite 热更新验收。

## 验证

- 类型检查：`bun run --cwd apps/desktop/electron typecheck`。
- Electron 行为变化时运行相关 Bun 测试。
- 构建：`bun run build:desktop`。
- 只有用户明确要求或安装包行为在范围内时，才运行 `bun run package:win`。
- 标题栏变化必须在 Windows 浅色、深色和自定义主题下验证无颜色断层、无高度跳变，并确认原生窗口按钮行为不变。
