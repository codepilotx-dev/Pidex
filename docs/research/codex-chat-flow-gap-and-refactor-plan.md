# CodePilotX 普通 Chat 对话流与 Codex 对比

## 研究基线

- CodePilotX 基线：`b71d070b0703218f1e96a444796f889115d4c53f`
- Codex 基线：`61a44880`（本地仓库 `D:\GitHubProject\Agent\codex`）
- 目标客户端：CodePilotX Desktop，协议保持 `thread-rpc-v4`
- Codex Desktop 的排队交互来自用户确认；本地 Codex 仓库主要用于验证 core、app-server 和 TUI 的 Turn/steer 语义。

## 基线差距（重构前）

CodePilotX 已经拥有持久 SQLite Turn、输入队列、事务 outbox、SSE cursor replay、Pi session、审批与提问 checkpoint，但普通 Chat 的 admission 与 runtime steering 没有形成一条一致链路：

1. `apps/agent/src/session/ThreadService.ts` 的 `submit()` 同时决定新 Turn、排队和 guide。
2. guide 先写入持久 mailbox，`executeTurn()` 通常只在一次完整运行前后读取 mailbox。
3. 旧的两层 Pi runtime 都提供了 `steer()`，但主 ThreadService 当时没有调用；当前由唯一 `AgentRuntime` 门面承接。
4. `turn/steer` 没有复用 `turn/start` 的附件校验和绑定流程。
5. `turn/interrupt` 接受可选 Turn ID，但 handler 没有用它进行精确匹配。
6. Renderer 根据本地 `running/waiting` 快照选择 queue 或 guide，并提前推断提交结果。
7. 排队 UI 支持编辑、删除、重排和转 guide，能力多于目标 FIFO 模型。

## Codex 可验证语义

本地 Codex 的关键实现：

- `codex-rs/app-server/src/turn_processor.rs`：`turn/start`、`turn/steer`、`turn/interrupt` 使用独立请求。
- `codex-rs/core/src/session/mod.rs`：steer 精确匹配活动 Turn，并拒绝不支持 steer 的 Turn 类型。
- `codex-rs/core/src/input_queue.rs`：活动 Turn 的输入和后续输入分开维护。
- `codex-rs/core/src/turn.rs`：steer 在下一模型采样边界进入仍在运行的 Turn。
- `codex-rs/core/src/tasks/mod.rs`：interrupt 采用协作取消和统一终态发布。
- `codex-rs/core/src/request_permissions.rs`：请求权限与实际授予权限分离，并限制授权作用域。
- `codex-rs/core/src/request_user_input_spec.rs`：结构化问题具有数量、选项和自动决议约束。

不复制 Codex 的 Rust 锁结构、rollout JSONL、旧版协议分支或仅内存 follow-up 队列。CodePilotX 继续使用现有 TypeScript/Bun 模块、SQLite、outbox 和 v4 projection。

## 目标状态机

```text
idle
  └─ turn/start ───────────────→ running

running
  ├─ turn/steer ───────────────→ pending steer
  │                                └─ next model boundary → consumed in same Turn
  ├─ queue/add ────────────────→ persisted FIFO follow-up
  ├─ turn/interrupt ───────────→ interrupting → interrupted
  ├─ permission/question ──────→ waiting → running
  └─ no pending input ─────────→ completed

completed
  └─ next FIFO follow-up ──────→ new running Turn
```

必须满足：

- start、steer、follow-up 是明确意图，服务端不得根据时序静默改变含义。
- 同一 Thread 的 admission、terminalize 和 interrupt 经过同一串行 gate。
- `inputId` 是所有重试和竞态恢复的幂等键。
- 已接受 steer 在 runtime 边界消费前保持可恢复；消费后成为该 Turn 历史。
- 未执行 follow-up 持久化并可编辑、删除；claim 后不可编辑。
- 手工中断或 Turn 失败时队列暂停，不自动执行用户可能已经不再需要的输入。

## 本次实现结果

前七个阶段已经落到当前分支；第八阶段的 canonical context/compaction lineage 仍按计划留作独立重构：

- `apps/agent/src/session/TurnCoordinator.ts:24` 提供 Thread 级串行 admission gate、精确活动 Turn、steer admission 开关和 terminal promise。
- `apps/agent/src/session/TurnRunner.ts:20` 成为普通 Chat 唯一 Turn terminalize 入口，统一完成终态事务、outbox 发布、临时 Turn 权限清理和 terminal promise 解析。
- `apps/agent/src/session/ThreadService.ts:402-505` 将 start、follow-up、steer 分成明确入口；附件使用同一校验/绑定链路，`inputId` 负责幂等和竞态对账。
- `apps/agent/src/orchestration/AgentRuntimeService.ts` 将持久 mailbox 注入 live Harness，并在 Pi session flush 的同一 SQLite 事务中标记 `steer-consumed`。
- 中断时，已 consumed steer 留在原 Turn；未 consumed steer 保留原 `inputId`，转换为队首 FIFO follow-up，并随队列一起暂停。
- `apps/agent/src/transport/rpc/handlers/Thread.ts:182-248` 接通精确 `turn/steer`、必填 Turn ID 的 `turn/interrupt` 和显式 `queue/add`，删除 reorder 与 queue-to-steer RPC。
- 权限交互区分 requested/granted permissions，进程内 grant store 实现 tool-call、Turn 和 Thread 隔离的运行会话生命周期，并在实际 Shell 权限判断处求安全交集。
- 结构化提问保存 1–3 题 canonical payload，支持自由输入和自动决议；审批、权限、问题与 Hook 信任的 response、resolved outbox 和 interaction operation 在同一 SQLite 事务提交后才唤醒 runner。
- Desktop 的活动 Turn 默认发送为 steer；`Ctrl+Enter` 和发送菜单为 follow-up；队列栏只保留查看、编辑、删除和暂停恢复。

已增加或调整的行为测试覆盖：

- Pi steer 在模型边界 one-at-a-time 消费并保留稳定 `inputId`。
- Pi session flush 与 `steer-consumed` mailbox 状态同事务提交，失败时两者一起回滚。
- FIFO 重启恢复、版本冲突、暂停/恢复，以及中断时 pending steer 转队首 follow-up。
- RPC start/steer/queue/add/interrupt 独立分发和精确 Turn ID。
- tool-call、Turn、session 权限生命周期与权限安全求交。
- rich questions、结构化答案、自动决议和工具暴露开关。
- interaction operation 写入失败时，问题状态、checkpoint 与 resolved outbox 整体回滚。
- Enter steer、`Ctrl+Enter` follow-up、发送菜单和队列编辑/删除。

## 协议目标

- `turn/start`：只启动空闲 Thread。
- `turn/steer`：要求精确 `turnId`，支持文本和附件。
- `queue/add`：显式创建持久 follow-up。
- `queue/update`、`queue/remove`、`queue/resume`：保留。
- `queue/reorder`、`queue/steer`：删除。
- `turn/interrupt.turnId`：必填，并等待真实 terminal。
- 对外输入类型使用 `start | steer | follow-up`，数据库中的旧编码只作为 repository 私有细节。

## Desktop 目标

- 活动 Turn 中，Enter 和发送按钮默认 steer。
- `Ctrl+Enter` 和发送菜单的“排队到下一轮”调用 `queue/add`。
- 队列栏显示、编辑、删除未执行消息，并在暂停时提供恢复。
- 不提供拖拽重排或把排队消息转为 steer。
- 只有服务端 admission 确认后才清空 Composer；响应不确定时以原 `inputId` 对账。

## 权限与提问

- `request_permissions` 支持 tool-call、Turn 和当前 Agent 运行会话作用域。
- 运行会话授权只保存在进程内并按 Thread 隔离，重启即清空。
- 实际权限必须是基础权限、请求权限和用户授权的安全交集。
- `request_user_input` 支持 1–3 个问题、每题 2–3 个选项、自由输入和 60–240 秒自动决议。
- 普通 Chat 继续由设置决定是否暴露提问工具；Plan 模式始终开放；subagent 不暴露。

## 不在首轮切换中的内容

上下文归一化和压缩 lineage 在主对话流稳定后单独实施。届时以 Pi session entry 和 canonical item 构建唯一历史投影，修复缺失 tool output，并以 checkpoint 加后缀恢复；不恢复旧 timeline 或双协议兼容层。

## 验收重点

- steer 在同一 Turn 的下一模型边界生效。
- steer 附件不会丢失，结束竞态不会重复或静默改为其他消息。
- interrupt 精确匹配 Turn，响应时 runtime 已停止，终态后没有 late delta。
- FIFO 可跨重启恢复，未执行消息可编辑/删除，claim 后返回版本冲突。
- 权限作用域不会跨越约定边界。
- 普通 Chat 的结构化提问设置和 Plan 模式默认行为保持一致。
