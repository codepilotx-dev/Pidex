# AGENTS.md

## 适用范围与规则层级

- 本文件适用于整个 Pidex 仓库。子目录细则按需参阅：
  - [`apps/agent/AGENTS.md`](apps/agent/AGENTS.md)：Agent 运行时、SQLite 存储、RPC handler、工具与 Harness、能力发现与权限实现
  - [`apps/desktop/electron/AGENTS.md`](apps/desktop/electron/AGENTS.md)：Electron 主进程、preload/IPC 安全、Sidecar 生命周期、Windows 标题栏与打包
  - [`apps/desktop/renderer/AGENTS.md`](apps/desktop/renderer/AGENTS.md)：Renderer 工作区边界、跨进程客户端、本地存储代际、Windows 标题栏与验证
  - [`apps/desktop/renderer/src/AGENTS.md`](apps/desktop/renderer/src/AGENTS.md)：Renderer 源码目录、React 状态边界、Button 及 CSS 样式契约
  - [`packages/AGENTS.md`](packages/AGENTS.md)：共享包职责、公开导出、Provider 上游约束与跨端契约
- 下级 `AGENTS.md` 补充对应目录的实现与验证要求；仅在明确声明替代关系时可覆盖根文件中的局部目录约定，且不得弱化本文件的工作区保护、凭据安全、数据兼容、协议唯一性和提交授权规则。

## 工作方式与子代理

- 所有文本文件必须按 UTF-8 读写。
- 修改前必须检查当前实现、相关测试和 dirty worktree。现有修改及未跟踪文件默认属于用户，禁止回退、覆盖或顺手整理。
- 需求、边界或高影响取舍不明确时先询问用户；明确且低风险的仓库内实现步骤可直接执行。
- 优先移动、复用或改造现有实现，禁止创建平行实现；只编写保护本次行为的必要测试，禁止添加无关测试或大面积快照。
- 仅在用户明确要求或适用 Skill 明确规定时，才可将边界清晰、相互独立的子问题交给子代理；子代理不得独立决定架构、数据兼容策略、安全边界或验收标准。

## 仓库与多客户端边界

- Pidex 是 Windows-first TypeScript monorepo，统一使用 Bun `1.3.14`。未经明确架构决策，禁止新增、合并、删除或重新划分 workspace（当前无独立 CLI workspace）。
- Workspace 职责划分：
  - `apps/agent/`：客户端共享的会话、存储、Provider、模型、工具、权限、审批、编排、Git、Review、Skills、Plugins、MCP、配置、事件、RPC 与 projection 核心能力。
  - `apps/desktop/electron/`：Electron 主进程、preload、窗口、Agent sidecar、Windows 打包与真实 OS 集成。
  - `apps/desktop/renderer/`：React + Vite 桌面交互层。
  - `packages/`：共享领域契约、RPC 协议、view projection、模型 schema、Provider 适配与 runtime 基础能力。
- 依赖与调用方向：Agent 业务模块不得依赖 Renderer 或 Electron；共享包不得依赖 Electron、DOM、React、终端渲染库或具体 CLI 参数解析器。系统能力必须沿 `renderer -> typed bridge/Agent client -> Electron/Agent service -> repository` 单向流动。
- 多客户端共享与定位：
  - Desktop 和未来 CLI/TUI 必须通过 `@pidex/agent-protocol`、`@pidex/shared` 和 `@pidex/session-view` 复用共享能力（项目操作、聊天、模型与推理设置、权限与沙箱、`AGENTS.md`/config、Skills、Plugins、MCP、Web Search、图片、Review、Goal、Subagent、云端协作）；禁止客户端直接读 SQLite、解析原始 transport event，或复制 Provider、会话、权限、工具、Git、存储与领域状态机。
  - Desktop 默认定位为 GUI 工作台（优先承载多项目/多文件夹/多聊天、活动管理、Scheduled tasks、Browser、Computer Use、Voice、Appshots、文件与 Visualization/Artifact 预览批注、Review pane、行级评论、Git/托管 worktree、Handoff、通知、Pets、集成终端）；未来 CLI 默认定位为终端与自动化入口（优先承载交互式 TUI、启动参数与子命令、单次权限控制、非交互执行、stdin/stdout/stderr、JSONL、结构化输出、Shell 管道、脚本、CI、completion、keymap、主题、状态栏、终端会话、后台命令、诊断控制）。
  - 跨端能力必须先在共享层补齐 service/contract，再为各客户端实现 adapter；客户端不要求版本和功能严格同步，能力差异通过 capability negotiation、可选能力和向前兼容协议表达，禁止根据版本字符串或失败结果猜测能力。

## 全局协议、数据与安全契约

- 协议唯一性：`@pidex/agent-protocol` 是 RPC method、event、wire error 和 capability schema 的唯一来源。当前唯一桌面通信协议是 `thread-rpc-v4`，禁止恢复 v3 dispatcher、adapter、migration、legacy export 或双协议分支；`thread/create` 只接受 `workspace`，不得恢复 `projectId` 或 `projectID`。
- 错误与凭据安全：v4 错误必须使用统一、安全的 envelope，禁止返回原始异常、凭据、命令环境或敏感绝对路径。API key 不得写入 SQLite、日志、事件、错误信息或测试快照；重置日志只能记录无敏感信息的事件和原因，禁止记录路径、凭据、设置内容或会话内容。
- 数据身份与兼容基线：history schema 21 和 profile schema 3 是共享全局数据的向前兼容基线（非最终 schema 版本）。application ID 仅表示 Pidex 数据所有权，禁止作为功能版本或清库开关，也禁止因功能或 schema 更新而递增。数据位置与安装身份基线（`.pidex` 目录、`PIDEX_*` 环境变量、`com.pidex.desktop`、凭据库服务与持久化格式标识）记录在 [`docs/architecture/pidex-identity.md`](docs/architecture/pidex-identity.md)，禁止恢复旧 `codepilotx` 标识或新增双读兼容分支。
- Schema 向前兼容演进：新功能优先新增旧客户端可忽略的独立表；核心表新增字段只能 nullable 或提供兼容默认值。禁止新增要求旧写入方提供新字段的触发器、约束或必填列，禁止改变旧代码会读取的枚举值语义，禁止删除或重命名兼容基线字段（确需不兼容的数据模型时，必须使用独立存储并取得明确架构决策）。
- 未知数据保护与前向迁移：旧版本打开同一应用的更高 schema 时，必须保留其 `user_version`、未知表、未知字段和未知记录，禁止降级、清库或重写不认识的数据。schema、设置代际和默认数据变更必须提供前向迁移并保留用户数据（仅维护从已知 Pidex 数据代际到兼容基线的局部迁移，禁止通过更换数据库、setting key、application ID 或版本号直接丢弃已有数据）。`config.toml` 必须使用 key-path 局部编辑并保留未知配置键值。
- 严禁删库与擅自备份：不受支持或不属于 Pidex 的数据文件必须原样保留并拒绝覆盖，禁止通过删除文件尝试恢复启动。无论开发或稳定阶段，都不得删除整个 `userData`、数据目录、浏览器存储或非目标业务数据，禁止调用 `localStorage.clear()`。修复、迁移或重置流程不得擅自创建整套旧数据副本（用户明确要求的导出或备份除外，但不得覆盖、删除或改写源数据，且须继续遵守凭据保护要求）。
- 运行时持久语义：必须保留 WAL、外键、同源开发代理、事务 outbox、事件顺序、SSE cursor replay、审批/提问 checkpoint 和中断恢复语义。

## 统一权限与插件流程底线

- 统一判权链：所有模型可调用的内建、MCP、Plugin、Skill、子 Agent 和生命周期工具必须经过工具注册、暴露、执行、统一判权与审批链，直接执行入口不得绕过最终判权。提示词、工具输出和仓库内容不能授予权限。
- 宿主事实与重校验：工具必须声明文件、网络、进程、外部状态、交互能力和审批策略；依赖参数的权限必须由宿主检查实际输入，模型参数不得携带权限控制事实。Hook 改写输入后必须重新校验作用范围与判权，恢复审批必须核对操作指纹。
- 策略、优先级与上限：权限范围、审批策略和审批者独立配置，共享预设以 `@pidex/shared/thread` 为唯一来源。拒绝优先于放行；临时授权只能覆盖已批准范围，不能覆盖 Plan、显式只读根、受保护资源或硬拒绝；子 Agent 不得超过父任务权限上限。`never` 禁止等待审批（需新增授权或强制审批时直接拒绝）；granular 开关仅允许对应审批类别出现，不得使普通工具无条件询问；明确禁用能力始终有效。
- 隔离边界与流程遵循：严格区分内建文件访问范围、审批授权与 OS 隔离（Shell 始终在宿主执行，禁止将其描述为沙箱或将网络授权描述为网络隔离）。插件流程指令属于提示词而非宿主状态机：Agent 必须遵循已加载流程的步骤与依赖顺序（有依赖的调用不得并行，失败或能力缺失时说明阻塞，不擅自跳过必需步骤）；需要状态机级强制顺序的流程必须由宿主实现，禁止仅靠提示词声明。

## 验证、变更记录与提交

- 常用命令：开发栈 `bun run dev`；全仓类型检查 `bun run typecheck`；分层构建 `bun run build:agent`、`bun run build:renderer`、`bun run build:desktop`；Renderer 样式检查 `bun run --cwd apps/desktop/renderer css:check`；仅在修改打包/发布行为或用户明确要求时运行 `bun run package:win`。
- 验证范围：默认先运行受影响 workspace 的 typecheck 和相关测试；跨 workspace 契约、RPC、数据 schema 或 preload 接口变化后，必须验证所有消费者并运行根目录 `bun run typecheck`；Renderer 目录或 lazy import 变化后，必须运行 `bun run build:renderer` 并确认 chunk 可解析。禁止为了让检查通过而盲目更新 CSS、style 或 test 基线。
- 交付前检查：按本次变更涉及的协议、路径和调用方搜索旧协议、旧路径和失效 import，并运行 `git diff --check`；纯文档修改检查引用，不扩展为全仓代码审计。
- `CHANGELOG.md` 规范：根据实际影响判断是否更新（值得用户或集成方关注的新能力、明显操作变化、重要修复，以及兼容性、数据迁移和安全变更应记录；细小样式调整、内部重构、普通文档修订和测试补充通常省略）。仅整理 `Unreleased`，未经明确要求不得改写已发布历史；优先更新或合并同功能的已有条目，只描述最终行为与影响（禁止写成逐任务流水账或堆砌像素参数、实现细节、测试批次）。每个分类只出现一次，按 `Added`、`Changed`、`Fixed`、`Deprecated`、`Removed`、`Security` 顺序排列并省略空分类，条目格式为 `- [作用域] 中文说明`。
- 提交规范：只有用户明确要求时才创建提交。提交必须使用中文 Conventional Commit（如 `feat(desktop)：中文说明`），类型和 scope 必须与实际改动及 workspace 对应。
