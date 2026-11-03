# AGENTS.md

## 适用范围

本文件适用于 `apps/agent/`，补充根目录 [`AGENTS.md`](../../AGENTS.md) 的 Agent 实现与验证细则，不得弱化根规则。

## 职责与模块边界

- 入口与架构：Agent 保持 Bun + Effect 模块化单体；`src/index.ts` 是可执行入口，`src/Bootstrap.ts` 是 composition root，两者均不得承载业务逻辑。
- 目录职责：`src/transport/` 放置 HTTP、RPC、SSE、projection 与 Renderer proxy；`src/session/` 放置会话状态与历史；`src/orchestration/` 放置执行编排。Review、GitHub、orchestration 和 subagent 的新职责必须归入对应领域目录，禁止继续扩大单文件聚合服务。
- 执行内核与 Provider：Harness 是 Agent 内部由 Pidex 自主维护的执行内核，不建立 Pi 上游同步或版本对齐流程；Provider、模型请求与 OAuth 统一使用 `pi-ai`。
- 跨端与展示边界：Agent 向客户端输出稳定的状态、进度、审批、问题、Review 和工具结果，禁止输出依赖 React、DOM 或 TUI 的展示结构；只有浏览器、窗口、剪贴板、系统通知等真实 OS 集成才通过明确的 adapter/capability 区分。
- CLI 复用约束：未来 CLI 的进程部署方式留给单独架构决策，其领域能力必须复用 Agent service/runtime 和 v4 协议；禁止为 CLI 自动化新增平行 Provider runtime、会话存储、审批引擎或直接 SQL 路径。

## 存储与恢复

- 目录分层：SQLite 按 `storage/database/`、`storage/repositories/`、`storage/events/`、`storage/recovery/` 分层；实际 SQL 必须位于领域 repository，`AgentDatabase` 只负责连接、最终 schema、repository 装配和恢复入口。
- 事务与连接：所有 repository 必须复用同一 SQLite 连接和事务状态，业务状态与 transactional outbox event 必须在同一 transaction 中提交；保留 WAL、外键、`busy_timeout`、事件顺序、SSE replay、checkpoint 和 interrupted recovery。
- Schema 与文件保护：新数据库一次性创建当前最终 schema，已知旧 schema 通过顺序、事务化迁移升级并保留数据；遵守根文件的兼容基线与禁删规则，禁止删除数据库、`-wal`、`-shm` 或父目录来恢复启动。
- 凭据存储：凭据必须经过现有加密凭据仓库和 Bun secrets 流程，禁止写入 SQLite、event、日志或错误。

## RPC v4

- `transport/rpc/RpcRouter.ts` 只负责连接状态、鉴权、capability、registry 分派和统一安全错误编码。
- 方法实现按领域放入 `transport/rpc/handlers/`；handler 只负责参数解码和调用领域 service，禁止直接执行 SQL。

## 工具、Harness 与权限实现

- 工具基础设施与垂直拆分：`src/tool/ToolRegistry.ts`、`ToolExecutor.ts` 和 `ToolExposurePlan.ts` 只维护通用工具定义、注册、暴露、执行与权限基础设施，禁止继续堆入可独立拆分的工具业务逻辑。新增一等内建工具以 `src/tool/<ToolName>/` 为垂直边界，按实际需要放置 definition、schema、prompt、formatter、安全校验和辅助逻辑（禁止制造空壳文件）；修改集中式工具文件时，仅当抽取是本次行为所需或能直接降低修改风险时才抽到对应工具目录。
- 生命周期工具与 UI 边界：提问、Skills、Plan 和子 Agent 等产品生命周期工具由对应领域 service 持有，并通过 orchestration adapter callback 暴露，禁止在 `src/tool/` 中复制状态机或 checkpoint 实现；工具 UI 归客户端所有，Agent 禁止放置 React 展示组件。
- 统一注册与判权链：新增工具及 Harness 内置/适配工具都必须接入 `ToolRegistry -> ToolExposurePlan -> ToolExecutor -> PermissionDecisionEngine` 链路（保持审批、沙箱、幂等、延迟暴露和中断恢复语义），并复用 `ApprovalService`、`Reviewer`、`PermissionGrantStore`；禁止以独立工具工厂绕过注册、建立平行权限系统、重复命令解析器或新增平行权限存储。
- 宿主事实与 Hook 校验：权限能力来自已注册元数据，`inspectInput` 的 `permissionFacts` / `authorizationScope` 是宿主事实，工具参数中的 `__ruleRequiresApproval` 等字段不得影响权限。Hook 输入改写必须回到注册校验与最终判权；`never-review` 仅免除工具自身审批，不能绕过 Hook、硬拒绝或受保护资源。
- 路径与补丁授权：路径授权必须按实际目标匹配并通过 `WorkspaceService` 调用级视图使用；读取授权不能用于写入，预览不能消费一次性授权，执行时消费并防止并发复用。多文件补丁在执行前校验全部路径，并保留冻结队列权限语义。
- 外部参考映射：参考成熟工具实现时，必须先映射 Pidex 现有领域边界、权限模型和桌面架构，禁止机械复制目录、命名或重复逻辑。

## 能力发现与插件流程

- 单点生成与上下文注入：每个新任务开始时，由 `src/prompt/CapabilityCatalog.ts` 单点读取 `ToolRegistry -> ToolExposurePlan -> ToolExecutor` 在当前模式、profile、allowlist 与可用性下确定的范围，在 `AgentRuntimeService` 冻结 turn composition 前把延迟工具（准确名称、简短描述与含 MCP server 的来源）和 Skill 目录注入真实模型上下文，普通工具继续通过既有工具声明暴露；主 Agent、子 Agent 与 `promptPreview` 共用同一生成函数，禁止新增平行注册表、旁路扫描或各写一份清单。
- 容量上限与分页：能力目录必须有界（总长 `8,000` 字符、单条描述 `160` 字符）；超限必须明确告知还有未展示能力并给出分页发现方式，禁止静默截断。
- 搜索激活与冻结恢复：延迟工具先搜索再调用，`ToolSearch` 命中或 `select:<exact-name>` 精确选择即通过既有 `addedToolNames` 链路激活，在下一次模型请求中提供完整 schema（完整说明、参数与 Skill 正文按需加载，不预加载）。激活由冻结的 deferred envelope 与 `validateDeferredActivation` 校验；恢复旧 turn 只绑定已冻结目录，禁止因实时注册表、插件或 MCP 变化扩大能力范围。
- 插件 Skill 与流程指令：插件 Skill 根目录经 `SkillService` 的 `pluginSkillRoots` 回调获取时必须传入当前工作区（无项目聊天只加载全局来源，禁用插件不得进入运行时目录）；目录标明插件来源，保持现有 Skill 身份、同名优先级与选择参数。插件流程指令只提供“发现并遵循”的提示词约束，需要强制顺序的能力必须由宿主状态机实现。

## 验证

- 类型检查：`bun run --cwd apps/agent typecheck`。
- 行为变化时运行：`bun run --cwd apps/agent test`。
- 入口、编译或 sidecar 产物变化时运行：`bun run build:agent`。
- 修改 RPC、schema、outbox、recovery，或工具注册、能力目录、激活与冻结恢复后，必须运行相关 Agent 回归测试和根目录 `bun run typecheck`。
