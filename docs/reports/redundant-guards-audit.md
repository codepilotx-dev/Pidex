# 冗余判空与错误吞噬审计报告（复核修订）

## 范围与判据

- 仓库：`F:/CodeProject/CodePilotX`；复核日期：2026-11-02。只修改本报告，未修改业务代码。
- 原审计涉及 Agent、Electron、Renderer、共享包及未提交改动；本次重点静态复核高影响结论，不代表对所有候选完成重新审计。保留原条目编号用于对照，代码位置以路径和符号为准，不依赖易漂移的旧行号。
- **确定缺陷**：已有具体调用链能说明错误行为或恢复/数据风险；不表示修复方案已全部设计完成。
- **可等价简化**：已有证据支持去除重复工作且保持业务语义；仍须满足类型检查、事务和错误顺序约束。
- **需要补证据**：调用方、异常出口、类型窄化或兼容语义尚未闭合；不得据此直接删代码。原误判明确撤回，记录在本类以防再次作为删除依据。
- 校验应按信任边界与输入变化安排：同一输入不重复做无效工作；判权前输入校验、Hook 改写后的重校验及最终判权必须保留。**“没有日志”不代表校验没有效果，“有类型”不代表运行时不会失败。**
- `exactOptionalPropertyTypes`、`noUncheckedIndexedAccess` 会要求条件 spread 或索引判空；不能一概当冗余。Renderer 的 `strict: false` 也不能成为取消 IPC 校验的理由。

## 一、确定缺陷

### 1.1 Goal 异步结算失败被丢弃，且可能失去恢复资格

位置：`apps/agent/src/session/TurnRunner.ts`、`apps/agent/src/orchestration/GoalContinuationCoordinator.ts`。

`settle()` 的异步失败被 `.catch(() => undefined)` 丢弃；协调器的 `finally` 无条件调用 `markProcessing(..., 'settled')`。如果结算决策写入前抛错、而最终标记成功，记录会退出只查询 pending/claimed 的后续处理范围。并非所有异常都会导致该结果，例如最终标记自身也可能失败。

修复边界：保留异步执行；区分成功完成、正常跳过和异常失败，保证失败记录有明确的后续处理语义，并记录安全的诊断分类。**只补日志不足以解决恢复问题，也不能仅删除 catch 让异步拒绝无人处理。** 是否保留可选 `goals` 构造参数另归需要补证据，不与本缺陷捆绑。

### 2.6 fork 主路径丢失已支持的业务错误码

位置：`apps/agent/src/session/fork/ThreadMessageForkService.ts`，主路径 `catch`。

同文件的 `safeError(cause)` 已处理 `NOT_GIT`、`HISTORY_UNSUPPORTED` 和 `WORKTREE_*`，其他分支已复用；主路径却回滚后统一返回 `INTERNAL_ERROR`，丢失可供客户端使用的失败分类。

修复方向：捕获 cause 并复用现有安全映射，保留回滚行为。未知异常仍映射为 `INTERNAL_ERROR`，不得把原始异常直接返回客户端。回滚自身失败的处理不在本条已证明的修复范围内。

### 2.17 列表与详情的 turn 状态映射不一致

位置：`apps/agent/src/session/ThreadHistoryService.ts` 的 `turnStatus`、`apps/agent/src/transport/ThreadProjection.ts` 的同名映射。

详情支持 `waiting_subagents → waiting-subagents` 和 `cancelled → cancelled`，列表均回退为 `stopped`。`waiting_subagents` 有真实持久化写入路径，因此会产生列表与打开后的状态差异。

修复方向：统一已有持久状态的展示语义，优先复用适合两处调用的映射；是否需要移动到共享包由实际消费者决定，不为两个 Agent 内调用强行新增跨包 API。

### 3.1 composer 文件授权白名单挡住工作区的两个入口

位置：`apps/desktop/electron/src/preload.cts` 的 `grantComposerPaths`、`getPathForFile`。

`pendingComposerDropPaths` 只由真实 OS 文件拖放/粘贴的 `getPathForFile` 写入。工作区文件树「发送到对话框」及 `@` 文件引用直接调用 `grantComposerFilePaths → bridge.grantComposerPaths`，没有相应登记，因而被拒绝。

修复边界：白名单保护 renderer 不能凭任意路径字符串让宿主读盘，必须保留这一机密性边界。工作区来源须由宿主根据真实工作区与目标路径验证；不能相信 renderer 自报的 source 字段，也不能只放行带工作区前缀的字符串。最终授权方案需在实施前补齐路径解析、工作区归属及现有授权接口的调用链。

### 3.7 设置加载失败仍开放默认状态的保存链

位置：`apps/desktop/renderer/src/features/settings/UseDesktopSettings.ts`。

加载失败分支设置 `settingsLoaded = true`，界面保留默认状态。自动保存 effect 首次会跳过，但后续有效设置变化仍可调用 `storeDesktopSettings(effectiveSettings)`，存在用默认状态覆盖未成功加载设置的风险。不是加载失败后立即发生覆盖。

修复方向：让加载失败与加载成功保持可区分，成功取得设置前不开放会覆盖旧设置的保存路径，并提供可见失败反馈或重试入口。不得通过清空存储恢复。具体 UI 只列影响面，由用户验收。

## 二、可等价简化

### 2.2 存在性守卫不应构建完整 thread snapshot

位置：`apps/agent/src/session/ThreadService.ts` 的 `get` 及仅用于守卫的调用方；`apps/agent/src/storage/repositories/ThreadRepository.ts` 的 `getThread`。

`getThread` 查询 thread、活动 turns、该 thread 的全部 items，并构建活动 turn 的 item 数据和 root agent。原报告“逐条解析全部 items”过于绝对：全部 items 被加载，解析发生在纳入返回 turns 的 items 上。

可用轻量存在性查询替代纯守卫用途，保持原位置的 `THREAD_NOT_FOUND`/404 与检查顺序。优先查找并复用现有轻量 repository 查询；仅在没有合适入口时新增。消费 snapshot 的调用方继续使用 `getThread`。这是明确的查询精简机会，尚未测量收益，不能声称固定加速比例。原 2.3、2.5 不随本条自动获准删除。

### 1.8 已窄化的 `input.before` 不需要可选链与默认值

位置：`apps/agent/src/session/ThreadGoalService.ts` 的 `markControlChange`。

`!input.before` 分支 ensure 后返回，后面的 objective/budget 比较可直接读取 `input.before.objective`、`input.before.tokenBudget`。保留创建目标的 early return 和现有比较语义。

### 2.4 同一事务内已读/未读操作的第二次存在性判断

位置：`apps/agent/src/session/ThreadHistoryService.ts` 的 `markRead`、`markUnread`。

事务内首次确认 thread 存在，随后只修改 read state，再取回列表项；在该事务和写入不删除 thread 的前提下，第二个 404 分支重复。可去掉重复运行时检查，但必须继续返回更新后的列表项，并用符合类型系统的方式表达该不变量。不要通过删除返回值重新查询来改变响应内容。

## 三、需要补证据

### 关键结论修正

| 原编号        | 候选与复核结论                                                                                                                             | 实施前需要的证据或约束                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1           | 工具链重复解析确实存在，但撤回“只留 `ToolCatalog.execute` 最后一关”的建议。`PiToolAdapter.prepareArguments` 也 parse，原“三次”漏计该阶段。 | `ToolExecutor.execute` 在 catalog 执行前已规范化、检查并判权；Hook 改写会重新进入 execute。列清 prepare/execute/授权预览/Shell/catalog 直接调用及各次输入是否变化，保留判权前校验。不能把 catalog 当作所有工具唯一执行收口。     |
| 1.2           | verifier 外层 catch 把异常归为 `provider_failed`，有诊断分类问题；不能因 `Promise<GoalVerifierOutcome>` 就认定它不会拒绝。                 | `runGoalVerifier` 的主要请求在 try 内，准备部分并非全部受其保护，注入的 verifier 也可能拒绝。确认异常来源和安全诊断出口后再决定 catch 的去留；不得用类型断言证明不会抛错。模型查找 `.catch(() => null)` 同样需单独核对错误契约。 |
| 1.3           | `identity` 判空保留；撤回“生产必然有值”的过强结论。                                                                                        | `ExecuteHarnessRun` 中 `providerGoal` 明确是可选变量，初始为 undefined。核实每个 context 钩子、目标变化和回调安装时序，再收紧生命周期回调及 `applyModelTerminal` 的相关类型。不能仅删判空，也不能仅把类型改必填掩盖实际缺值。    |
| 2.3           | `validateAdmission` 中的检查不一定可直接删除。                                                                                             | `this.get` 与 resolver 之间还有空消息检查。删除后“不存在的 thread + 空消息”会从 404 变为 `EMPTY_MESSAGE`。优先沿用 2.2 的轻量守卫，若调整顺序需明确行为决定；`steerTurn` 单独核对。                                              |
| 2.8           | `ThreadRead/Definition.ts` 通用失败缺少内部诊断是候选，但 `AgentError` 第四参数是 `details`，不是 `cause`。                                | 核实工具错误、日志及 RPC 的序列化路径，选择已有的安全诊断方式；禁止直接把原始 SQLite/projection 异常塞进 details 或对外返回。                                                                                                    |
| 2.10          | 撤回“zod 输出必然纯 JSON，因此 stringify 不会抛”的证明。                                                                                   | Zod 本身不保证无循环引用、BigInt、转换输出或自定义序列化行为。核对可注册 schema、所有输入来源和日志契约，再决定保留、缩小或移除 catch。                                                                                          |
| 3.6           | **撤回冗余结论：IPC 的输入校验继续保留。**                                                                                                 | `requireWriteInput` 等检查未知输入的对象形状、标识符及字段类型；manager/session 并未完整重复这些检查。静默拒绝仍能阻止非法输入进入业务；catch 同时防止 fire-and-forget 异常击穿主进程。是否增加反馈是独立产品需求。              |
| 4.1           | **撤回缺陷结论：`decodeReference` 的 kind/value 两个 early return 是独立校验。**                                                           | 合并条件仅是风格选择，不纳入整改；无需为了减少 if 改动。                                                                                                                                                                         |
| 4.6（Errors） | **撤回简化建议：保留 `String(error ?? '')`。**                                                                                             | 该分支还接收数字、布尔值、没有字符串 message 的对象等。null/undefined 返回空字符串是 `errorMessageOr` 触发 fallback 的语义，不能改成 `'null'`/`'undefined'`。                                                                    |

### 其余候选：保留定位，不沿用未经充分证明的“应删”指令

下表保留原报告其余候选与各自缺失的证据。表内“待确认”不代表已确定缺陷，也不代表已证明可等价删除。

| 原编号              | 候选位置/行为                                                                                                            | 需要补齐的证据或处理边界                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1（附带）         | `TurnRunner` 可选 `goals` 参数                                                                                           | 核对所有构造和测试入口，再决定是否收紧构造契约；与异步恢复缺陷分开处理。                                                                     |
| 1.4                 | `PiToolAdapter` 的 blocker `typeof`                                                                                      | 参数验证不能自动给 execute 回调建立静态窄化；核对参数类型与所有调用入口。领域层对 blocker 的业务约束不能仅因 TypeBox 存在就删除。            |
| 1.5                 | `AgentRuntimeService` 写 notice 后读取并 fallback                                                                        | 核对 repository 对字段的规范化和事件所需对象。可研究直接使用写入值，但未证明“读不到时 insertEvent 同样必失败”，不能作为确定的数据丢失结论。  |
| 1.6                 | ~~`RightDockPanels` 的 parsedBudget 二次判空~~                                                                           | 已关闭：Goal 编辑面板不再解析总数，改为追加量算术 `resolveGoalBudgetAppend`，二次判空随旧输入一并删除。                                      |
| 1.7                 | `AgentHarness` context 钩子的 cast                                                                                       | 核实泛型事件与返回类型之间的相关性；运行时分支不会自动让泛型 result 变成 ContextResult。在保留多钩子链式结果传递的前提下证明可简化。         |
| 1.9                 | `ExecutionRepository.settleGoalObservation` 返回 hasWaiting                                                              | 重新搜索所有调用、测试与返回契约；确认无人消费后可删字段，classification 的类型收紧另行验证。                                                |
| 1.10                | `ThreadService` 的 hub.listen 探测                                                                                       | 核对 EventHub 契约和所有构造路径，若只是测试 null stub 导致，修复最小测试替身后再简化生产判断。                                              |
| 2.5                 | 设置写入链多层存在性检查                                                                                                 | 检查各 repository 的直接调用、返回 snapshot 用途、事务边界及 404 契约。不能只留一层便假定其他调用受保护。                                    |
| 2.7                 | 数据目录迁移、ProjectTrustStore、EnvironmentDeltaStore 重新抛错                                                          | 是否丢失可用诊断需追踪日志与最终错误出口；进程拥有文件不代表异常中不含敏感路径。可考虑内部 cause，但必须验证不会对外泄漏。                   |
| 2.9                 | 非文件工具 post hook 失败无记录                                                                                          | 检查 Hook 执行器是否已有统一诊断；如补日志，保留工具已执行成功的结果且不记录敏感参数。                                                       |
| 2.11                | ToolExecutor permissionConfig 的重复 fallback                                                                            | 核对所有私有调用路径及上下文类型。运行时已填充不自动改变对象属性的可选类型；先让类型准确表达不变量。                                         |
| 2.12                | ToolExecutor 的固定 openai/gpt-5 fallback                                                                                | 重新搜索直接执行、授权预览、恢复及测试调用，证明 model 必填的边界；避免把可疑 fallback 的潜在风险写成已触发的生产故障。                      |
| 2.13                | Shell 的 parseShellInput 重复校验                                                                                        | Shell 走独立执行路径，不能假定一定经过 catalog 最后解析。核对规范化前后字段及 Hook 重入，保留信任边界校验和实际字段变换。                    |
| 2.14                | escalationToken 残留输入字段                                                                                             | 核对冻结工具定义、恢复、共享契约及现有拒绝语义；删除字段会改变输入兼容/错误分类，不是无条件等价精简。                                        |
| 2.15                | Bookmark、runtime-composition、PlanApproval 重查 sqlite_master                                                           | 确认同一连接是否可能在迁移/初始化前后复用，以及现有 capability 缓存失效规则；无证据时不承诺按 Database 永久缓存安全。                        |
| 2.16                | ThreadRepository 与 RepositoryCore 权限/设置解码重复                                                                     | 对照完整实现、导出和依赖方向；确认语义完全相同后复用，不能顺带改变兼容解码。                                                                 |
| 2.18                | repository 的 parse/stringify 本地副本                                                                                   | 分开确认等价副本；PermissionRuleRepository 对 undefined 的行为不同，不能机械替换。核实真实入参与 SQLite 绑定语义。                           |
| 2.19                | Compaction/CompactionUtils 的 safeJsonStringify                                                                          | 两处当前为局部函数，需核对完整函数及导出后依赖，才可复用；ContextUsageBreakdown 删除 catch 的建议另需证明输入可序列化。                      |
| 2.20                | ApprovalService.emit、ArtifactService.listByItem、WorkspaceRepository 两个 setter、BrowserBounds、WorkbenchLayoutStorage | 全仓无文本调用只是线索，需区分私有死代码、公开导出、动态接线及有意保留的平台能力。仅测试调用也不能直接证明代码应删除。                       |
| 2.21                | PermissionDecisionEngine 两判断器的公共前缀                                                                              | 核实两个判断器的职责和后续语义是否一致；少量重复不是功能缺陷，不为消除重复强行抽象。                                                         |
| 3.2                 | GitBoardActions catch 与客户端错误信封                                                                                   | 核对 try 范围内除网络客户端外的状态更新、回调及所有实现是否可能抛错；Promise 返回类型不保证不拒绝。                                          |
| 3.3                 | LocalEnvironmentSettings 子集条件                                                                                        | 核对当前组件前置 return 与输入是否为同一渲染快照；成立则是局部分支删除，不牵连其他环境状态处理。                                             |
| 3.4                 | TerminalPanel 可选调用 ackTerminalOutput                                                                                 | 核对 TerminalClient 接口、构造与 mock 的完整性；确认方法恒存在后可去掉外层可选调用，保留内部 capability 判断。                               |
| 3.5                 | effectiveThreadId 默认 home 后判空                                                                                       | 区分局部已默认的变量与 `resolveIntegratedTerminalToggleAction` 原始 threadId 参数；不能连带删除后者的空值行为。                              |
| 3.8                 | UseThreadBookmarks 的加载失败与 null                                                                                     | 核对 null 在 UI 和重试中的含义，不能直接写成“没有书签”；先确认是否确有错误展示缺失。                                                         |
| 3.9                 | UseModelProviderController 模型切换失败反馈                                                                              | 已有 toast 不能叫“静默”。核对现有文案和诊断链，再判断需要补哪一类上下文，避免暴露 Provider 敏感信息。                                        |
| 3.10                | Renderer 六份 errorMessage                                                                                               | 对照各自空值 fallback 和非 Error 值处理，等价者复用 shared helper；不一刀切改变展示文案。                                                    |
| 3.11                | Browser bounds IPC no-op 链                                                                                              | 核对 preload/IPC 的公开契约、所有宿主调用与实际 Browser 布局归属；决定接线还是删除需要功能依据，不是任选其一。                               |
| 3.12                | GitBoard projectId filter 后判空/断言                                                                                    | 证明所有 action 只接收过滤后的集合，再用类型谓词表达有效项；保留 pending 竞态判断。                                                          |
| 4.2                 | ThreadResultCard 局部 record/isRecord                                                                                    | 比较 null、数组和返回对象类型等完整语义，确认可直接复用 Guards，不仅比较函数外形。                                                           |
| 4.3                 | RPC Dispatcher missing handler 分支                                                                                      | 核对公开 dispatcher 是否只接收经 registry 验证且不会变动的表；模块初始化校验不能自动证明所有公共调用安全。协议错误兜底不因仅测试覆盖就删除。 |
| 4.4                 | Permission preset 的 default fallback                                                                                    | 核对持久化/外部输入入口、运行时校验及 custom 分支；`as const` 是类型约束，不等于运行时冻结。                                                 |
| 4.5                 | 空对象 schema filter 与 exactParams                                                                                      | 检查 schema 是否被直接 decode、导出或复用；dispatcher 的 excess-property 选项并不自动覆盖其他解码入口。                                      |
| 4.6（Client）       | 动态 import、definition 查空、响应 id 文案                                                                               | 分别验证运行时导入图、打包语义和未知输入边界。id 校验保留；是否回显外部值需按错误出口与脱敏规则判断。                                        |
| 4.6（Interactions） | createServerRequestMessage 对已类型化输入 decode                                                                         | 检查公共构造器的运行时契约与实际调用；只有测试调用不能证明验证冗余。                                                                         |
| 4.6（Clipboard）    | require 包装 normalize                                                                                                   | 内联仅是结构选择，未知输入拒绝仍要保留；无 cause 不自动代表缺陷。                                                                            |
| 4.6（图标）         | split('/').at(-1) 的 fallback                                                                                            | 非空 split 数组支持运行时简化，但需确认静态返回类型仍满足函数契约，不为删 fallback 添加无意义断言。                                          |
| 4.6（Goal limits）  | ThreadGoalWireLimits 与 renderer 硬编码 4000                                                                             | 核对两者限制对象和语义是否一致，确认后复用已有常量；不能以暂时无消费者为由先删共享约束。                                                     |

### 已有保留理由与其他待观察项

这些条目不进入删除清单；其中尚未闭合的性能或产品问题也不写成确定缺陷。

- 原 1.11：Goal 的预算受限重推导需要表达“下一请求超预算”；收尾结算的 `!signal.aborted` 防止 Stop 后推进控制修订。保留这些语义。
- 原 4.7：协议边界的 Effect decode、持久化 approval policy 解码、用户文本的 decodeURIComponent、用户文件 JSON.parse、旧 GitBoardState 解析、模型原始 patch 解析及关闭连接上的 PRAGMA 均有真实失败来源。
- 原 4.7：Visualization 的整体尺寸限制不能仅因各字段已有长度限制便认定浪费；需核对总量约束、输入对象范围及可序列化契约。保留返回 null 而不抛错的既有语义。
- 原 4.7：preload browser snapshot 校验涉及跨进程契约，不能只凭一侧可信或类型声明删除。
- 原第五节第 1 项：`saved.instructionSources ?? []` 有旧 project 行 NULL 来源，保留。
- 原第五节第 2 项：`queueStateMeta(...)` 默认值须排除缺行及初始化状态后再判断，暂留。
- 原第五节第 3 项：按钮 disabled 与 handler 中 busy 判断可能承担不同的交互/竞态职责，保留 handler 校验。
- 原第五节第 4 项：Composer 与 Goal 面板的预算解析失败行为不同，现已有明确产品意图——Composer 只负责创建时设定有限/不限额，面板只负责追加与取消上限，各自保留独立校验，不算重复判空。

## 后续处理顺序与验收边界

1. 优先解决确定缺陷中的设置覆盖风险、Goal 结算恢复语义和 fork 安全错误映射。
2. composer 来源授权先完成宿主验证方案，再改入口；列表/详情状态映射统一既有语义。
3. 等价简化逐项进行，保留错误优先级、类型约束与返回内容；工具解析优化待调用链证据补齐后再实施。
4. 需要补证据的条目不得成批删除。已经撤回的 IPC、独立字段校验及 Errors fallback 不再作为整改目标。

本报告未运行测试、性能基准或 UI 自动化；查询开销有静态证据，性能收益没有量化。后续代码变更按受影响工作区执行必要验证；UI 只列影响面交由用户验收。本次为普通报告修订，不更新 CHANGELOG。
