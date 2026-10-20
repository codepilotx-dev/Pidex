# 统一权限控制

权限由“访问范围 × 审批策略 × 审批者”组成，三者独立配置；Plan 仍是独立执行上限。共享预设集中在 `packages/shared/src/thread/Permission.ts`：请求批准为 workspace-write/on-request/user，帮我批准为 workspace-write/on-request/auto_review，完全访问为 danger-full-access/never/user。三个持久化字段必须同时匹配预设；任一不同（包括完全访问搭配自动审查者）都显示为自定义。旧的 untrusted/on-failure 继续兼容读取。

`approval/rules/list`、`approval/rules/revoke` 与 `approval/rules/upsert` 通过 `permission.rules.v1` capability 暴露规则管理。规则效果为 allow/ask/deny，范围为用户、当前项目、当前聊天；匹配对象为已注册工具、宿主解析后的真实文件读写目标、完整命令或安全 argv 前缀、精确网络域名、具体 MCP server/tool。用户与项目规则保存到 config.json 的 `permission_rules`（key-path 局部编辑，保留未知内容）；聊天规则与旧聊天授权撤销记录使用独立表并通过前向迁移建立。项目规则仅在项目受信任时生效；高版本未知库缺少可选表时隐藏 capability，不修改库。旧项目授权与旧聊天授权继续按 Allow 展示和撤销，撤销不删除审批历史。

## 判权顺序

参数、能力可用性与 Plan/显式只读限制先校验。完全访问随后直接通过权限门禁，不运行权限规则、静态风险拒绝或 Guardian。其余配置按 Deny → Ask → 匹配的 Allow/已有授权 → 预设与风险判断执行；自定义 never 只拒绝剩余需要审批的请求。

- 请求批准：工作区内低风险操作直接执行；编辑外部文件、外部目录执行命令、检测到联网及中高风险/未知操作询问用户。普通外部读取仅在检测到敏感风险时询问。
- 帮我批准：低风险操作直接执行，包括工作区外低风险操作；联网与风险/未知操作交独立 Guardian，无法判断或不可用时询问用户。
- 工具、MCP 和 Skill 按实际风险处理，来源本身不构成强制审批。显式 Ask 和 Hook 要求询问不能被普通 Allow 覆盖；完全访问跳过权限性质的 Ask/Deny，保留 Hook 输入改写和生命周期。
- 完全访问不改变 Plan，也不关闭输入校验、取消处理、凭据保护或工具自身功能约束。

## 执行链与授权

ToolExecutor 在 Hook 改写后加载宿主规则事实，PermissionDecisionEngine 统一判定；ApprovalService 负责人工 checkpoint、恢复和 Guardian。恢复一次批准时核对操作指纹，输入和目标改变需重新批准。

菜单提供允许一次、在此会话中允许、始终允许。一次批准只覆盖当前调用；会话批准绑定聊天与工作区并支持重启恢复；始终允许写入当前项目的 permission_rules，同项目聊天共享。A 项目授权不用于 B 项目；从 A 操作外部 B 也不构成 B 的授权。无工作区时仅提供允许一次。

命令菜单生成完整命令与有效 cwd 的精确规则，不自动生成 argv 前缀；手动配置的安全 argv 前缀继续支持。多目标与混合操作必须全部匹配，文件路径先由宿主规范化。聊天规则以 history schema 66 新增可空 workspace 字段；无法确认原工作区的旧记录保留展示但不自动授予权限。旧 approval_rules 与审批历史不删除，通过统一适配参与判定和撤销。

WorkspaceService 仅为本次文件调用开放目标路径，实际执行仍等待统一判权。Shell 始终在宿主执行；命令检测可识别 curl 等明显联网意图，无法保证发现脚本、子进程或重定向的真实联网和文件访问，不提供 OS 沙箱或网络隔离。

## Guardian

Guardian 异步评分按 turn 保存失效代际：作废、拒绝、转人工、turn 结束或授权版本变化后，迟到的低风险结果不得恢复有效；缓存与等待共用同一套校验，同时核对动作 hash、授权版本、turn、有效代际和取消信号。同一调用 ID 更换命令后不得使用旧评分；当前动作已有高风险评分时不得被旧 low 覆盖。新增权限、敏感动作、强制人工审批与受保护资源不走低风险快速放行。同步审查结论同样绑定请求开始时的授权版本。

授权证据只来自宿主确认的用户操作和当前聊天真实用户消息；子聊天同时读取根聊天授权上下文。仓库文件（包括 `AGENTS.md`）、工具参数、任务摘要和模型理由都是不可信证据。Guardian 不可用、超时、输出无效或证据不足时，`on-request` 转人工；`never`、不允许该类审批的 granular 与 untrusted 保守策略拒绝。用户取消立即终止，不创建新的人工审批；保留精确重试、熔断中断、事务 outbox 和 checkpoint 恢复链路。

## 来源与适配

参考 ZCode 提交 `872ad96` 的 `apps/zcode-cli/packages/core/src/tool/executor/permission-capability.ts`、`permission-input-recheck.ts` 和 `permission-rules.ts`，适配其宿主能力事实、来源不可由模型覆盖、输入变更重新判权的实现方式。对应改动位于 Pidex 的 ToolRegistry、ToolExecutor 和 PermissionDecisionEngine，继续复用已有命令解析器与审批存储；没有搬入整套 ZCode 权限系统，完全访问的提前放行采用 Pidex 当前产品定义。

ZCode 使用 Apache-2.0，保留[许可证](../licenses/ZCode-Apache-2.0.txt)。Pidex 的新增实现及改动不代表 ZCode 上游原版。
