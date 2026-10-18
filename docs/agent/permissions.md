# 统一权限控制

权限由“访问范围 × 审批策略 × 审批者”组成，三者独立配置；Plan 仍是独立执行上限。共享预设集中在 `packages/shared/src/thread/Permission.ts`：请求批准为 workspace-write/on-request/user，帮我批准为 workspace-write/on-request/auto_review，完全访问为 danger-full-access/never/user。三个持久化字段必须同时匹配预设；任一不同（包括完全访问搭配自动审查者）都显示为自定义。旧的 untrusted/on-failure 继续兼容读取。

`approval/rules/list`、`approval/rules/revoke` 与 `approval/rules/upsert` 通过 `permission.rules.v1` capability 暴露规则管理。规则效果为 allow/ask/deny，范围为用户、当前项目、当前聊天；匹配对象为已注册工具、宿主解析后的真实文件读写目标、完整命令或安全 argv 前缀、精确网络域名、具体 MCP server/tool。用户与项目规则保存到 config.json 的 `permission_rules`（key-path 局部编辑，保留未知内容）；聊天规则与旧聊天授权撤销记录使用独立表并通过前向迁移建立。项目规则仅在项目受信任时生效；高版本未知库缺少可选表时隐藏 capability，不修改库。旧项目授权与旧聊天授权继续按 Allow 展示和撤销，撤销不删除审批历史。

## 判权顺序

固定顺序为：硬拒绝、Plan、显式只读根、禁用能力 → Deny 规则 → Ask 规则 → 强制审批与受保护资源 → 有界 Allow 规则与已有授权 → 普通预设策略。

- 破坏性动作（`permissionFacts.destructive`）属于强制审批：Allow 规则、持续允许与临时授权都不能免除，`never` 策略下拒绝。

- Deny 优先于 Ask，Ask 优先于 Allow；跨用户、项目与聊天来源同样成立。
- 显式 Ask 始终人工批准：Guardian、持续允许规则和临时授权都不能覆盖；`never` 或对应 granular 类别禁用时直接拒绝。
- Allow 只免除其匹配范围内的普通审批，不能扩大文件范围、解除强制审批或提高子 Agent 权限。
- 文件规则按宿主真实路径匹配，多路径写入必须全部落在规则范围内；符号链接先解析再匹配。
- 命令规则复用 `simpleCommandArgv`；复杂 Shell 只支持完整命令，不新增解析器。

## 执行链

注册元数据声明能力和审批策略；inspectInput 返回宿主 permissionFacts 与 authorizationScope。ToolExecutor 在 Hook 与输入改写之后、最终执行之前加载宿主规则事实，覆盖普通工具、Shell、MCP 和生命周期工具；PermissionDecisionEngine 保持纯判定。ApprovalService 负责审批恢复、临时授权与 Guardian 调用，不复制判权逻辑。

Hook 改写输入后重新走注册 schema、路径检查和统一判权。新审批预览返回操作指纹；恢复时检查指纹与当前 Deny 规则。保留旧 checkpoint 的无指纹读取路径及 SDK RunState 绑定；已审批的 Hook 结果不重复执行，以保留中断恢复语义。

临时授权复用 PermissionGrantStore。内建文件工具根据实际目标匹配授权，WorkspaceService 只给本次调用授权路径；预览不消费，执行前才消费。读取授权不能写入，写入授权包含必要的读取；多文件补丁全部预检查。显式只读根、Plan、受保护资源与硬拒绝始终有效。

文件范围只约束内建文件工具。Shell 是宿主进程，没有 OS 沙箱；网络授权表示审批范围，没有网络隔离。

`on-request` 只对“已在当前范围内”的普通 Shell 命令直接执行，因此静态风险分类是唯一防线：调用点必须把工作区根传给 `analyzeShellRisk`，否则工作区外绝对路径与工作区外 cwd 无法判定；工作区外路径、外部状态破坏（远程仓库、分支、发布、云资源、包发布撤回）与已记录的静态风险都会产生宿主动作事实 `destructive`，进入强制审批，`never` 策略下直接拒绝，Guardian 快速路径与旧授权匹配都不接受破坏性动作。

## Guardian

Guardian 异步评分按 turn 保存失效代际：作废、拒绝、转人工、turn 结束或授权版本变化后，迟到的低风险结果不得恢复有效；缓存与等待共用同一套校验，同时核对动作 hash、授权版本、turn、有效代际和取消信号。同一调用 ID 更换命令后不得使用旧评分；当前动作已有高风险评分时不得被旧 low 覆盖。新增权限、敏感动作、强制人工审批与受保护资源不走低风险快速放行。同步审查结论同样绑定请求开始时的授权版本。

授权证据只来自宿主确认的用户操作和当前聊天真实用户消息；子聊天同时读取根聊天授权上下文。仓库文件（包括 `AGENTS.md`）、工具参数、任务摘要和模型理由都是不可信证据。Guardian 不可用、超时、输出无效或证据不足时，`on-request` 转人工；`never`、不允许该类审批的 granular 与 untrusted 保守策略拒绝。用户取消立即终止，不创建新的人工审批；保留精确重试、熔断中断、事务 outbox 和 checkpoint 恢复链路。

## 来源与适配

参考 ZCode 提交 `872ad96` 的 `apps/zcode-cli/packages/core/src/tool/executor/permission-capability.ts`、`permission-input-recheck.ts` 和 `permission-rules.ts`，适配其宿主能力事实、来源不可由模型覆盖、输入变更重新判权的实现方式。对应改动位于 Pidex 的 ToolRegistry、ToolExecutor 和 PermissionDecisionEngine，继续复用已有命令解析器与审批存储；没有搬入整套 ZCode 权限系统，也没有采用 yolo 提前跳过 deny 的顺序。

ZCode 使用 Apache-2.0，保留[许可证](../licenses/ZCode-Apache-2.0.txt)。Pidex 的新增实现及改动不代表 ZCode 上游原版。
